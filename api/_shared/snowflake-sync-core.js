'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Snowflake → Supabase daily-mirror core (NOT a function file — under
// api/_shared/, so excluded from the Hobby 12-function cap).
//
// The browser NEVER queries Snowflake directly. This server-side core pulls
// historical / deep-metric datasets from the Snowflake SQL REST API on a daily
// cadence and mirrors them into the Supabase table `snowflake_metrics_mirror`.
// The Knickgasm3DConnectorEngine then reads that mirror for its "historical /
// metric" data tier (Shopify stays the live source for catalog + pricing).
//
// Trigger surfaces (see api/brain.js):
//   • POST /api/snowflake-sync         → runSync()   (webhook / pub-sub, CRON_SECRET)
//   • GET  ?action=snowflake-metrics   → readMirror() (what the engine reads)
//   • piggy-backed on GET ?action=cron → runSync()   (no 3rd Hobby cron added)
//
// Until SNOWFLAKE_* env vars are set, every op returns a typed, inspectable
// { connected:false, would_request } stub — the exact pattern klaviyo-core.js
// uses — so callers work end-to-end and only need a credential to go live.
// ─────────────────────────────────────────────────────────────────────────────

let supa = null;
try { supa = require('./supa.js'); } catch (_) { supa = null; }

const MIRROR_TABLE = 'snowflake_metrics_mirror';
const REGIONS = ['us', 'uk', 'global'];

function cfg() {
  return {
    account: (process.env.SNOWFLAKE_ACCOUNT || '').trim(),
    user: (process.env.SNOWFLAKE_USER || '').trim(),
    pat: (process.env.SNOWFLAKE_PAT || '').trim(),
    warehouse: (process.env.SNOWFLAKE_WAREHOUSE || '').trim(),
    database: (process.env.SNOWFLAKE_DATABASE || '').trim(),
    schema: (process.env.SNOWFLAKE_SCHEMA || 'ANALYTICS').trim(),
    role: (process.env.SNOWFLAKE_ROLE || '').trim(),
    query: (process.env.SNOWFLAKE_SYNC_QUERY || '').trim(),
  };
}

const { liveConnectorsEnabled } = require('./live-connectors.js');
// Live connectors default OFF (LIVE_CONNECTORS=on to enable). While off, this
// reports not-configured so no live Snowflake sync is ever attempted.
function isConfigured() {
  const c = cfg();
  return liveConnectorsEnabled() && !!(c.account && c.user && c.pat && c.warehouse && c.database);
}

// The packaged default daily query. Expected to yield columns:
//   METRIC (string), REGION (string), VALUE (number),
//   WINDOW (string), CAPTURED_AT (timestamp/string)
function defaultQuery(c) {
  if (c.query) return c.query;
  return `select metric, region, value, window, captured_at
          from ${c.database}.${c.schema}.daily_marketing_metrics
          where captured_at >= dateadd('day', -90, current_timestamp())`;
}

function sqlApiUrl(c) {
  // Snowflake SQL REST API v2. Account host form: <account>.snowflakecomputing.com
  const host = /snowflakecomputing\.com$/i.test(c.account)
    ? c.account
    : `${c.account}.snowflakecomputing.com`;
  return `https://${host}/api/v2/statements`;
}

async function fetchWithTimeout(url, init, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

// ── Snowflake pull ───────────────────────────────────────────────────────────
async function pullFromSnowflake() {
  const c = cfg();
  const url = sqlApiUrl(c);
  const payload = {
    statement: defaultQuery(c),
    warehouse: c.warehouse,
    database: c.database,
    schema: c.schema,
    role: c.role || undefined,
    timeout: 60,
  };
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      // PAT / OAuth bearer. Snowflake accepts a Programmatic Access Token here.
      Authorization: `Bearer ${c.pat}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Snowflake-Authorization-Token-Type': 'PROGRAMMATIC_ACCESS_TOKEN',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = (json && (json.message || json.code)) || text || res.statusText;
    const err = new Error(`snowflake ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  // SQL API returns { resultSetMetaData:{rowType:[{name}]}, data:[[...]] }
  const cols = ((json && json.resultSetMetaData && json.resultSetMetaData.rowType) || []).map(
    (r) => String(r.name || '').toLowerCase(),
  );
  const rows = (json && json.data) || [];
  return rows.map((row) => {
    const obj = {};
    cols.forEach((name, i) => { obj[name] = row[i]; });
    const region = String(obj.region || 'global').toLowerCase();
    return {
      metric: String(obj.metric || 'unknown'),
      region: REGIONS.includes(region) ? region : 'global',
      value: Number(obj.value || 0),
      window: String(obj.window || '30d'),
      captured_at: String(obj.captured_at || new Date().toISOString()),
    };
  });
}

// ── Supabase mirror upsert ─────────────────────────────────────────────────────
async function upsertMirror(rows) {
  if (!supa || !rows.length) return { upserted: 0 };
  // Content-key each row so re-runs are idempotent.
  const enriched = rows.map((r) => ({
    key: `${r.region}:${r.metric}:${r.window}:${r.captured_at}`,
    metric: r.metric,
    region: r.region,
    value: r.value,
    window: r.window,
    captured_at: r.captured_at,
    synced_at: new Date().toISOString(),
  }));
  await supa.rest(MIRROR_TABLE, {
    method: 'POST',
    body: enriched,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  return { upserted: enriched.length };
}

/**
 * Run one Snowflake → Supabase mirror pull. Safe to call from the webhook and
 * from the daily cron. Never throws for the not-configured case — returns a
 * typed stub instead.
 */
async function runSync(opts = {}) {
  if (!isConfigured()) {
    const c = cfg();
    return {
      ok: true,
      connected: false,
      queued: false,
      reason: 'SNOWFLAKE_* env not set',
      would_request: {
        method: 'POST',
        url: c.account ? sqlApiUrl(c) : 'https://<SNOWFLAKE_ACCOUNT>.snowflakecomputing.com/api/v2/statements',
        body: { statement: defaultQuery(c), warehouse: c.warehouse || '<SNOWFLAKE_WAREHOUSE>' },
      },
    };
  }
  const started = Date.now();
  try {
    const rows = await pullFromSnowflake();
    const { upserted } = await upsertMirror(rows);
    return { ok: true, connected: true, queued: true, pulled: rows.length, upserted, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, connected: true, error: e.message, status: e.status || 0, ms: Date.now() - started };
  }
}

/**
 * Read the mirror for the engine's historical/metric tier.
 * region: us|uk|global · metric: string · window: e.g. 30d
 */
async function readMirror({ region = 'global', metric = '', window = '' } = {}) {
  if (!supa) {
    return { ok: false, connected: false, reason: 'Supabase not configured', rows: [] };
  }
  const filters = {};
  if (region) filters.region = `eq.${region}`;
  if (metric) filters.metric = `eq.${metric}`;
  if (window) filters.window = `eq.${window}`;
  try {
    const rows = await supa.rest(MIRROR_TABLE, {
      method: 'GET',
      query: Object.assign(
        { select: 'metric,region,value,window,captured_at', order: 'captured_at.desc', limit: '500' },
        Object.fromEntries(Object.entries(filters)),
      ),
    });
    return { ok: true, connected: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    // Table may not exist yet (migration not applied) → behave like not-configured
    // so the engine shows its "run the sync first" stub rather than a hard error.
    return { ok: false, connected: false, reason: e.message, rows: [] };
  }
}

module.exports = { isConfigured, runSync, readMirror, MIRROR_TABLE };
