#!/usr/bin/env python3
"""
poll_12h_ingest.py — pure-GET 12-hour polling ingestion for Shopify, Klaviyo and
WebEngage into the isolated Supabase tables (shopify_orders, klaviyo_events,
webengage_events). No webhooks, no push: every run pulls only the last 12h and
UPSERTs (dedupe on the platform's own id), so running it twice a day is safe.

Run as an independent worker on a 12h cron:
    python ingest/poll_12h_ingest.py

Env (all read from the environment; never hardcode):
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY            (service role bypasses RLS)
  SHOPIFY_STORE_DOMAIN (e.g. knickgasm.myshopify.com), SHOPIFY_ADMIN_TOKEN
  KLAVIYO_API_KEY  (+ optional KLAVIYO_REVISION, default 2024-10-15)
  WEBENGAGE_EXPORT_URL (a GET data-export/events endpoint), WEBENGAGE_API_KEY

Safeguards: READ-ONLY remote calls (GET only); each platform is isolated in its
own try/except so one failure never blocks the others; 429 / rate-limit and
transient errors get bounded ret(backoff); explicit cursor / Link-header
pagination so a busy 12h window is fully drained, not truncated to one page.
"""
import os
import sys
import json
import time
import gzip
import datetime as dt
from urllib.parse import urlparse, parse_qs

try:
    import requests
except ImportError:
    sys.exit("poll_12h_ingest requires 'requests' (pip install requests)")

WINDOW_HOURS = int(os.environ.get("POLL_WINDOW_HOURS", "12"))
NOW = dt.datetime.now(dt.timezone.utc)
SINCE = NOW - dt.timedelta(hours=WINDOW_HOURS)
SINCE_ISO = SINCE.replace(microsecond=0).isoformat()          # 2026-07-13T00:00:00+00:00


def log(platform, msg):
    print(f"[{dt.datetime.now(dt.timezone.utc).isoformat()}] {platform}: {msg}", flush=True)


# ── Supabase upsert (PostgREST + service role) ───────────────────────────────
def supa_env():
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("SMART_BRAIN_SUPABASE_URL") or "").rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("SUPABASE_SERVICE_KEY") or "")
    return url, key


def upsert(table, rows, conflict_col):
    """Batch upsert into Supabase; ON CONFLICT (conflict_col) merges (dedupe)."""
    url, key = supa_env()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required for upsert")
    if not rows:
        return 0
    headers = {
        "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    endpoint = f"{url}/rest/v1/{table}?on_conflict={conflict_col}"
    written = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i + 500]
        for attempt in range(5):
            r = requests.post(endpoint, headers=headers, data=json.dumps(batch), timeout=60)
            if r.status_code in (429, 500, 502, 503):
                wait = 2 * (attempt + 1)
                log(table, f"upsert {r.status_code}; backoff {wait}s")
                time.sleep(wait)
                continue
            if not r.ok:
                raise RuntimeError(f"upsert {r.status_code}: {r.text[:300]}")
            written += len(batch)
            break
    return written


def get_with_retry(url, headers=None, params=None, timeout=45, label=""):
    """GET with bounded backoff on 429 / transient errors. READ-ONLY."""
    for attempt in range(5):
        r = requests.get(url, headers=headers or {}, params=params or None, timeout=timeout)
        if r.status_code == 429 or r.status_code >= 500:
            wait = 2 * (attempt + 1)
            log(label, f"GET {r.status_code}; backoff {wait}s")
            time.sleep(wait)
            continue
        return r
    return r  # last response (caller inspects)


# ── Shopify: GET /admin/api/2026-04/orders.json?created_at_min=... (Link pages) ─
def poll_shopify():
    domain = os.environ.get("SHOPIFY_STORE_DOMAIN", "").strip()
    token = os.environ.get("SHOPIFY_ADMIN_TOKEN", "").strip()
    if not domain or not token:
        log("shopify", "skipped — set SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_TOKEN")
        return {"platform": "shopify", "skipped": True}
    api_version = os.environ.get("SHOPIFY_API_VERSION", "2026-04")
    url = f"https://{domain}/admin/api/{api_version}/orders.json"
    headers = {"X-Shopify-Access-Token": token, "Accept": "application/json"}
    params = {"status": "any", "created_at_min": SINCE_ISO, "limit": 250}
    rows, pages = [], 0
    while url and pages < 100:
        r = get_with_retry(url, headers=headers, params=params, label="shopify")
        params = None  # subsequent pages come fully-formed from the Link header
        if not r.ok:
            raise RuntimeError(f"{r.status_code}: {r.text[:200]}")
        for o in (r.json().get("orders") or []):
            rows.append({
                "shopify_order_id": str(o.get("id")),
                "email": o.get("email"),
                "total_price": o.get("total_price"),
                "currency": o.get("currency"),
                "created_at_shopify": o.get("created_at"),
                "raw_payload": o,
            })
        pages += 1
        # Link-header cursor pagination.
        link = r.headers.get("Link", "")
        nxt = None
        for part in link.split(","):
            if 'rel="next"' in part:
                nxt = part[part.find("<") + 1:part.find(">")]
        url = nxt
    written = upsert("shopify_orders", rows, "shopify_order_id")
    log("shopify", f"{len(rows)} orders in window over {pages} page(s) -> {written} upserted")
    return {"platform": "shopify", "fetched": len(rows), "upserted": written, "pages": pages}


# ── Klaviyo: GET /api/events?filter=greater-than(datetime,...) (cursor pages) ──
def poll_klaviyo():
    key = os.environ.get("KLAVIYO_API_KEY", "").strip()
    if not key:
        log("klaviyo", "skipped — set KLAVIYO_API_KEY")
        return {"platform": "klaviyo", "skipped": True}
    revision = os.environ.get("KLAVIYO_REVISION", "2024-10-15")
    headers = {"Authorization": f"Klaviyo-API-Key {key}", "revision": revision, "accept": "application/vnd.api+json"}
    url = "https://a.klaviyo.com/api/events/"
    params = {"filter": f"greater-than(datetime,{SINCE_ISO})", "sort": "datetime", "page[size]": 200}
    rows, pages = [], 0
    while url and pages < 200:
        r = get_with_retry(url, headers=headers, params=params, label="klaviyo")
        params = None
        if not r.ok:
            raise RuntimeError(f"{r.status_code}: {r.text[:200]}")
        body = r.json()
        for e in (body.get("data") or []):
            attrs = e.get("attributes", {}) or {}
            rel = (e.get("relationships") or {})
            metric_id = (((rel.get("metric") or {}).get("data") or {}).get("id"))
            profile_id = (((rel.get("profile") or {}).get("data") or {}).get("id"))
            rows.append({
                "klaviyo_event_id": str(e.get("id")),
                "metric_name": attrs.get("metric_id") or metric_id or (attrs.get("event_properties", {}) or {}).get("$event_name"),
                "profile_id": profile_id or attrs.get("profile_id"),
                "timestamp": attrs.get("datetime") or attrs.get("timestamp"),
                "raw_payload": e,
            })
        nxt = ((body.get("links") or {}).get("next"))
        url = nxt
        pages += 1
    written = upsert("klaviyo_events", rows, "klaviyo_event_id")
    log("klaviyo", f"{len(rows)} events in window over {pages} page(s) -> {written} upserted")
    return {"platform": "klaviyo", "fetched": len(rows), "upserted": written, "pages": pages}


# ── WebEngage: GET a bulk/data-export events endpoint filtered to the window ───
# WebEngage's public surface is export-oriented and account-specific, so the exact
# GET endpoint is provided via env (WEBENGAGE_EXPORT_URL). We pass the 12h window
# and accept either NDJSON, a JSON array, or a gzipped body.
def poll_webengage():
    export_url = os.environ.get("WEBENGAGE_EXPORT_URL", "").strip()
    api_key = os.environ.get("WEBENGAGE_API_KEY", "").strip()
    if not export_url or not api_key:
        log("webengage", "skipped — set WEBENGAGE_EXPORT_URL + WEBENGAGE_API_KEY (GET data-export endpoint)")
        return {"platform": "webengage", "skipped": True}
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    params = {"from": SINCE_ISO, "to": NOW.replace(microsecond=0).isoformat()}
    r = get_with_retry(export_url, headers=headers, params=params, label="webengage")
    if not r.ok:
        raise RuntimeError(f"{r.status_code}: {r.text[:200]}")
    body = r.content
    try:
        text = gzip.decompress(body).decode("utf-8")
    except OSError:
        text = body.decode("utf-8", errors="replace")
    events = []
    t = text.strip()
    if t.startswith("["):
        events = json.loads(t)
    else:
        for line in t.splitlines():
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    rows = []
    for e in events:
        eid = e.get("id") or e.get("event_id") or e.get("messageId") or e.get("eventId")
        if not eid:
            continue
        rows.append({
            "webengage_event_id": str(eid),
            "event_name": e.get("event_name") or e.get("eventName") or e.get("name"),
            "user_id": e.get("userId") or e.get("user_id") or e.get("uid"),
            "event_time": e.get("eventTime") or e.get("event_time") or e.get("timestamp"),
            "raw_payload": e,
        })
    written = upsert("webengage_events", rows, "webengage_event_id")
    log("webengage", f"{len(rows)} events in window -> {written} upserted")
    return {"platform": "webengage", "fetched": len(rows), "upserted": written}


def main():
    log("poll", f"window {SINCE_ISO} -> {NOW.replace(microsecond=0).isoformat()} ({WINDOW_HOURS}h)")
    results, failures = [], []
    for fn in (poll_shopify, poll_klaviyo, poll_webengage):
        try:
            results.append(fn())
        except Exception as e:                       # isolate: one platform's failure never blocks the others
            name = fn.__name__.replace("poll_", "")
            log(name, f"FAILED: {type(e).__name__}: {e}")
            failures.append({"platform": name, "error": str(e)})
    log("poll", f"done. ok={len(results)} failed={len(failures)} :: {json.dumps(results)}")
    if failures:
        log("poll", f"failures: {json.dumps(failures)}")
    # Non-zero exit only if EVERY platform failed (so a cron alerts on total outage
    # but tolerates a single-platform hiccup).
    if failures and not any(not r.get("skipped") for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
