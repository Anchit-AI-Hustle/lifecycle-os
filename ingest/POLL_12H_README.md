# 12-Hour Pure-GET Polling Ingestion

`poll_12h_ingest.py` pulls the **last 12 hours** of data from Shopify, Klaviyo and
WebEngage using **GET requests only** (no webhooks, no push) and UPSERTs into three
isolated Supabase tables. Idempotent — running it twice a day dedupes on each
platform's own id.

## Tables (migration `supabase/migrations/20260713110000_polling_ingestion_tables.sql`)
| Table | Unique id | Hot columns | Full source |
|---|---|---|---|
| `shopify_orders` | `shopify_order_id` | email, total_price, currency, created_at_shopify | `raw_payload` jsonb |
| `klaviyo_events` | `klaviyo_event_id` | metric_name, profile_id, timestamp | `raw_payload` jsonb |
| `webengage_events` | `webengage_event_id` | event_name, user_id, event_time | `raw_payload` jsonb |

All three carry GIN (`raw_payload`) + B-Tree (time / name / id) indexes.

## Run
```bash
pip install requests
python ingest/poll_12h_ingest.py         # once per 12h window (cron: 0 0,12 * * *)
```

## Env
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY          # service role bypasses RLS for the upsert
SHOPIFY_STORE_DOMAIN (knickgasm.myshopify.com), SHOPIFY_ADMIN_TOKEN   # read_orders/read scope
KLAVIYO_API_KEY  (+ optional KLAVIYO_REVISION, default 2024-10-15)
WEBENGAGE_EXPORT_URL (a GET data-export/events endpoint), WEBENGAGE_API_KEY
POLL_WINDOW_HOURS  # optional, default 12
```
A platform with missing credentials is **skipped** (logged), never fatal.

## Safeguards
- **Read-only**: GET only; never mutates remote state.
- **Isolation**: each platform runs in its own try/except — one failure never blocks
  the others. Non-zero exit only if *every* configured platform fails.
- **Rate limits**: 429 / 5xx get bounded exponential backoff.
- **Pagination**: Shopify `Link: rel="next"` header loop; Klaviyo `links.next` cursor
  loop — a busy 12h window is fully drained, not truncated to one page.

## Status of the three connectors (2026-07-13)
- **Klaviyo** — live (`KLAVIYO_API_KEY` set); `/api/events` GET + cursor works today.
- **Shopify** — needs a read-scoped **Admin API token** (`SHOPIFY_ADMIN_TOKEN`); until
  then the app uses the public storefront + the CSV market exports.
- **WebEngage** — needs a GET **data-export** endpoint + key; the app also has a
  Storage-bucket drain (`/api/cron/webengage`) as an alternative bulk path.

The Node app reads these tables via `api/_shared/webengage-core.js` (+ the KicksGPT
`webengage_performance` tool); Klaviyo/Shopify read helpers can point here next so
the app serves stored data instead of recomputing per query.
