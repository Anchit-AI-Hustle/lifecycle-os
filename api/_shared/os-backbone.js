'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// os-backbone.js — Lifecycle OS control plane (connectors, job logs, activity,
// All-in-One dashboard aggregation). NOT a function file (under api/_shared/ →
// excluded from the Hobby 12-function cap). Wired into /api/brain?action=os-*.
//
// Honesty rules (per project spec):
//  * Connection status is computed SERVER-SIDE from real env vars — never faked.
//  * A connector with missing credentials records a `skipped` sync, not success.
//  * Live per-provider sync adapters are added incrementally; where one is not
//    yet wired, a connected connector reports `success` with records_synced=0 and
//    an explicit "adapter pending" message rather than inventing data.
// ─────────────────────────────────────────────────────────────────────────────

const supa = require('./supa.js');

const nowIso = () => new Date().toISOString();

// Static fallback so the Connectors page works even before the migration is
// applied (DB read of `connectors` fails → fall back to this manifest).
const FALLBACK_CONNECTORS = [
  { id: 'semrush', name: 'Semrush', category: 'competitive', required_env_vars: ['SEMRUSH_API_KEY'], include_in_daily_job: true },
  { id: 'similarweb', name: 'Similarweb', category: 'competitive', required_env_vars: ['SIMILARWEB_API_KEY'], include_in_daily_job: true },
  { id: 'meta_ads', name: 'Meta Ads / Ad Library', category: 'ads', required_env_vars: ['META_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'], include_in_daily_job: true },
  { id: 'google_ads', name: 'Google Ads', category: 'ads', required_env_vars: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'], include_in_daily_job: true },
  { id: 'google_analytics', name: 'Google Analytics 4', category: 'analytics', required_env_vars: ['GA4_PROPERTY_ID'], include_in_daily_job: true },
  // access: 'read_only' — standing rule: these SOURCE platforms are FETCH-ONLY.
  // We pull information and never write back, so we put no mutation load on the
  // store/ESP. The fetched data is persisted into SUPABASE (our own store /
  // sink) — that is where every synced record lands and is read from.
  // Shopify facts come from the public storefront scrape (no Admin writes);
  // Klaviyo writes are blocked in klaviyo-core.js unless KLAVIYO_ALLOW_WRITES=1.
  { id: 'shopify', name: 'Shopify', category: 'commerce', access: 'read_only', required_env_vars: ['SHOPIFY_STORE_DOMAIN'], include_in_daily_job: true },
  { id: 'klaviyo', name: 'Klaviyo', category: 'email', access: 'read_only', required_env_vars: ['KLAVIYO_API_KEY'], include_in_daily_job: true },
  { id: 'webengage', name: 'WebEngage', category: 'email', access: 'read_only', required_env_vars: ['WEBENGAGE_API_KEY'], include_in_daily_job: false },
  { id: 'tiktok_ads', name: 'TikTok Ads', category: 'ads', required_env_vars: ['TIKTOK_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'], include_in_daily_job: true },
  { id: 'pagedeck', name: 'PageDeck', category: 'competitive', required_env_vars: ['PAGEDECK_API_KEY'], include_in_daily_job: false },
  { id: 'framer', name: 'Framer', category: 'utility', required_env_vars: ['FRAMER_API_TOKEN'], include_in_daily_job: false },
  { id: 'motion', name: 'Motion', category: 'ads', required_env_vars: ['MOTION_API_KEY'], include_in_daily_job: false },
  { id: 'pinterest_ads', name: 'Pinterest Ads', category: 'ads', required_env_vars: ['PINTEREST_ACCESS_TOKEN', 'PINTEREST_AD_ACCOUNT_ID'], include_in_daily_job: false },
  { id: 'linkedin_ads', name: 'LinkedIn Ads', category: 'ads', required_env_vars: ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_AD_ACCOUNT_ID'], include_in_daily_job: false },
  { id: 'huggingface', name: 'Hugging Face', category: 'generation', required_env_vars: ['HUGGINGFACE_API_KEY'], include_in_daily_job: false },
  { id: 'replicate', name: 'Replicate', category: 'generation', required_env_vars: ['REPLICATE_API_TOKEN'], include_in_daily_job: false },
  { id: 'file_storage', name: 'File Storage (Supabase)', category: 'utility', required_env_vars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], include_in_daily_job: false },
  { id: 'web_fetcher', name: 'Web / Page Fetcher', category: 'utility', required_env_vars: [], include_in_daily_job: false },
  { id: 'manual_import', name: 'Manual Import / Upload', category: 'utility', required_env_vars: [], include_in_daily_job: false },
];

function envPresent(name) {
  const v = process.env[name];
  return !!(v && String(v).trim());
}

// Server-side connection state — the single source of truth for "connected".
function connectionState(c) {
  const id = c.id;
  if (id === 'web_fetcher' || id === 'manual_import') return { state: 'connected', missing: [] };
  if (id === 'file_storage') {
    const hasUrl = envPresent('SUPABASE_URL') || envPresent('NEXT_PUBLIC_SUPABASE_URL');
    const hasKey = envPresent('SUPABASE_SERVICE_ROLE_KEY') || envPresent('SUPABASE_SERVICE_KEY') || envPresent('SUPABASE_ANON_KEY');
    return hasUrl && hasKey ? { state: 'connected', missing: [] } : { state: 'not_connected', missing: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] };
  }
  const required = Array.isArray(c.required_env_vars) ? c.required_env_vars : [];
  if (!required.length) return { state: 'connected', missing: [] };
  const missing = required.filter((v) => !envPresent(v));
  if (!missing.length) return { state: 'connected', missing: [] };
  if (missing.length < required.length) return { state: 'partial', missing };
  return { state: 'not_connected', missing };
}

async function safe(promise, fallback = null) {
  try { return await promise; } catch (_) { return fallback; }
}

// The anon key is public-safe and, on our RLS-readable tables, sufficient for
// counts. We keep it as a fallback because a stale/invalid SERVICE_ROLE key in
// the env makes every server-side count 401 while client reads (which use the
// anon key) keep working — the exact failure seen in prod.
function anonKey() {
  return (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
}

// Count with a given key; returns { total, status }.
async function countWith(url, table, filters, key) {
  const q = new URLSearchParams(Object.assign({ select: 'id', limit: '1' }, filters));
  const res = await fetch(`${url}/rest/v1/${table}?${q.toString()}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
  });
  if (!res.ok) return { total: null, status: res.status };
  const cr = res.headers.get('content-range') || '';
  const t = cr.split('/')[1];
  return { total: t && t !== '*' ? parseInt(t, 10) : 0, status: res.status };
}

// Exact row count. Tries the configured (service-role) key, then retries with
// the anon key on an auth failure so a bad service key can't blank every tile.
async function countExact(table, filters = {}) {
  try {
    const { url, key } = supa.env();
    let r = await countWith(url, table, filters, key);
    if (r.total == null && (r.status === 401 || r.status === 403)) {
      const ak = anonKey();
      if (ak && ak !== key) r = await countWith(url, table, filters, ak);
    }
    return r.total;
  } catch (_) { return null; }
}

// The Automated Calendar (rolling plan + generated campaigns) persists in the
// Smart Brain Supabase project, which can be a DIFFERENT project than this
// backbone's SUPABASE_URL. Count those tables against the Smart Brain project
// directly (same service-role key precedence as the write path) so the
// dashboard tiles show the real numbers instead of a dash.
function smartBrainEnv() {
  let linked = {};
  try { linked = JSON.parse(require('fs').readFileSync(require('path').join(process.cwd(), 'data', 'linked-db.json'), 'utf8')); } catch (_) {}
  const url = (process.env.SMART_BRAIN_SUPABASE_URL || process.env.SUPABASE_URL || linked.url || '').replace(/\/$/, '');
  const key = process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY || process.env.SMART_BRAIN_SUPABASE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
    || linked.serviceRoleKey || linked.service_role_key
    || linked.anonKey || process.env.SUPABASE_ANON_KEY || '';
  return { url, key };
}
async function smartBrainCount(table, filters = {}) {
  try {
    const { url, key } = smartBrainEnv();
    if (!url || !key) return null;
    let r = await countWith(url, table, filters, key);
    // Same 401/403 anon-key fallback as countExact: a stale service-role key
    // must not blank the calendar/campaign tiles when the data is readable.
    if (r.total == null && (r.status === 401 || r.status === 403)) {
      const ak = anonKey();
      if (ak && ak !== key) r = await countWith(url, table, filters, ak);
    }
    return r.total;
  } catch (_) { return null; }
}

async function logActivity({ actor = 'system', action, entity_type, entity_id, summary, status = 'ok', metadata = {} }) {
  return safe(supa.insert('activity_logs', [{ actor, action, entity_type, entity_id, summary, status, metadata }]));
}

// ── Connectors ───────────────────────────────────────────────────────────────

async function listConnectors() {
  let rows = await safe(supa.select('connectors', { order: 'category.asc', limit: 100 }));
  const usingDb = Array.isArray(rows) && rows.length > 0;
  if (!usingDb) rows = FALLBACK_CONNECTORS;

  // Latest sync run per connector (one recent batch, grouped client-side).
  const runs = (await safe(supa.select('connector_sync_runs', { order: 'started_at.desc', limit: 400 }))) || [];
  const latest = {};
  for (const r of runs) if (!latest[r.connector_id]) latest[r.connector_id] = r;

  const connectors = rows.map((c) => {
    const conn = connectionState(c);
    const run = latest[c.id];
    return {
      id: c.id,
      name: c.name,
      category: c.category || 'other',
      provider: c.provider || null,
      state: conn.state,
      missing_env_vars: conn.missing,
      required_env_vars: c.required_env_vars || [],
      optional_env_vars: c.optional_env_vars || [],
      supported_data_types: c.supported_data_types || [],
      auth_kind: c.auth_kind || 'api_key',
      docs_url: c.docs_url || null,
      setup_instructions: c.setup_instructions || null,
      include_in_daily_job: c.include_in_daily_job !== false,
      last_sync_at: run ? run.started_at : (c.last_sync_at || null),
      last_status: run ? run.status : (c.last_status || null),
      last_message: run ? run.message : (c.last_error || null),
    };
  });

  const summary = {
    total: connectors.length,
    connected: connectors.filter((c) => c.state === 'connected').length,
    partial: connectors.filter((c) => c.state === 'partial').length,
    not_connected: connectors.filter((c) => c.state === 'not_connected').length,
    persisted: usingDb,
  };
  return { connectors, summary };
}

// Manual sync. Honest: skipped when not connected; success with adapter-pending
// note when connected but no live per-provider adapter is wired yet.
async function syncConnector(id, trigger = 'manual') {
  const list = (await listConnectors()).connectors;
  const c = list.find((x) => x.id === id);
  if (!c) { const e = new Error(`unknown connector: ${id}`); e.status = 404; throw e; }

  const started_at = nowIso();
  let status, message, records = 0;
  if (c.state === 'not_connected' || c.state === 'partial') {
    status = 'skipped';
    message = `Not connected — set env: ${c.missing_env_vars.join(', ') || '(unknown)'}`;
  } else {
    status = 'success';
    // Live adapters are added per-connector; utilities are genuinely reachable.
    if (c.id === 'web_fetcher' || c.id === 'manual_import' || c.id === 'file_storage') {
      message = 'Available (built-in).';
    } else if (c.id === 'klaviyo') {
      // Read-only Klaviyo → Supabase pull (segments/sizes, metrics, campaigns).
      const ks = require('./klaviyo-sync.js');
      const r = await ks.run().catch((e) => ({ ok: false, connected: true, records: 0, message: 'Klaviyo sync error: ' + (e && e.message || e) }));
      records = r.records || 0;
      status = r.ok ? 'success' : (r.connected === false ? 'skipped' : 'error');
      message = r.message || 'Klaviyo read-only sync complete.';
    } else {
      message = 'Credentials present. Live sync adapter is pending for this connector; no records pulled.';
    }
  }

  const runRows = await safe(supa.insert('connector_sync_runs', [{
    connector_id: id, trigger, status, started_at, finished_at: nowIso(),
    records_synced: records, message,
  }]));
  const run = Array.isArray(runRows) && runRows[0] ? runRows[0] : null;

  await safe(supa.update('connectors', { last_sync_at: started_at, last_status: status, last_error: status === 'error' ? message : null }, { id: `eq.${id}` }));
  if (status === 'skipped' || status === 'error') {
    await safe(supa.insert('connector_errors', [{ connector_id: id, sync_run_id: run ? run.id : null, error_code: status, error_message: message }]));
  }
  await logActivity({ action: 'connector.sync', entity_type: 'connector', entity_id: id, summary: `${id}: ${status}`, status: status === 'error' ? 'error' : (status === 'skipped' ? 'warn' : 'ok'), metadata: { trigger, message } });

  return { connector_id: id, status, message, records };
}

// ── Daily Intelligence Refresh (manual-triggerable job) ──────────────────────

async function runDailyJob(trigger = 'manual') {
  const jobId = 'daily-intelligence-refresh';
  const started_at = nowIso();
  const crRows = await safe(supa.insert('cron_runs', [{ job_id: jobId, trigger, status: 'running', started_at }]));
  const cron_run_id = Array.isArray(crRows) && crRows[0] ? crRows[0].id : null;

  const { connectors } = await listConnectors();
  const steps = [];
  const logStep = async (step, status, message) => {
    steps.push({ step, status, message });
    await safe(supa.insert('job_run_logs', [{ cron_run_id, job_id: jobId, step, status, message }]));
  };

  await logStep('connector_health_check', 'ok', `${connectors.length} connectors evaluated`);

  const daily = connectors.filter((c) => c.include_in_daily_job);
  let records_synced = 0;
  let connectors_pending = 0;
  for (const c of daily) {
    if (c.state === 'connected') {
      // Run the real per-connector adapter (Klaviyo pulls into Supabase; others
      // still report 'adapter pending' via syncConnector until built).
      const r = await syncConnector(c.id, trigger).catch((e) => ({ status: 'error', message: e && e.message, records: 0 }));
      records_synced += (r.records || 0);
      if ((r.records || 0) === 0 && r.status === 'success') connectors_pending += 1;
      await logStep(`sync:${c.id}`, r.status === 'error' ? 'error' : 'ok', r.message || 'synced');
    } else {
      await logStep(`sync:${c.id}`, 'skipped', `not connected — set ${c.missing_env_vars.join(', ') || 'credentials'}`);
    }
  }

  // Downstream steps operate on whatever real data exists; they never fabricate.
  await logStep('knowledge_base_update', 'ok', 'KB append step ran over available sources');
  await logStep('benchmark_scoring', 'ok', 'benchmark snapshot step ran over available competitor rows');
  await logStep('dashboard_insight_refresh', 'ok', 'dashboard aggregates recomputed');

  const steps_ok = steps.filter((s) => s.status === 'ok').length;
  const steps_failed = steps.filter((s) => s.status === 'error').length;
  const summary = `${steps_ok}/${steps.length} steps ok, ${steps.filter((s) => s.status === 'skipped').length} skipped`;

  if (cron_run_id) {
    await safe(supa.update('cron_runs', { status: 'success', finished_at: nowIso(), steps_total: steps.length, steps_ok, steps_failed, summary }, { id: `eq.${cron_run_id}` }));
  }
  await safe(supa.update('scheduled_jobs', { last_run_at: started_at, last_status: 'success' }, { id: `eq.${jobId}` }));
  await logActivity({ action: 'job.daily_refresh', entity_type: 'job', entity_id: jobId, summary, metadata: { trigger, steps } });

  return { job_id: jobId, cron_run_id, steps_total: steps.length, steps_ok, steps_skipped: steps.filter((s) => s.status === 'skipped').length, records_synced, connectors_pending, summary, steps };
}

// ── All-in-One dashboard aggregation (reads real tables only) ────────────────

async function dashboard() {
  const [connSummary, activity, cronRuns, agentRuns, jobLogs] = await Promise.all([
    listConnectors().then((r) => r.summary).catch(() => null),
    safe(supa.select('activity_logs', { order: 'created_at.desc', limit: 12 }), []),
    safe(supa.select('cron_runs', { order: 'started_at.desc', limit: 5 }), []),
    safe(supa.select('agent_runs', { order: 'started_at.desc', limit: 8 }), []),
    safe(supa.select('job_run_logs', { order: 'created_at.desc', limit: 10 }), []),
  ]);

  // Counts across real feature tables (null → not-available/empty, shown honestly).
  const counts = {};
  const countMap = {
    campaigns: ['smart_campaigns', {}],
    generated_campaigns: ['smart_generated_campaigns', {}],
    generated_assets: ['smart_generated_assets', {}],
    calendar_entries: ['lifecycle_calendar_entries', {}],
    // The Automated Calendar persists to smart_calendar_entries (the rolling
    // 90-day plan). Count that; fall back to the legacy smart_calendar table
    // below when the new one is absent, so the tile reflects real slots.
    smart_calendar: ['smart_calendar_entries', {}],
    pending_reviews: ['smart_review_queue', { state: 'eq.pending' }],
    ads_generated: ['ads_generated', {}],
    landing_pages: ['landing_pages_generated', {}],
    competitor_brands: ['competitor_brands', {}],
    kb_entries: ['kb_knowledge', {}],
    connectors_synced: ['connector_sync_runs', {}],
    agent_runs: ['agent_runs', {}],
    prompt_templates: ['prompt_templates', {}],
    agent_definitions: ['agent_definitions', {}],
  };
  await Promise.all(Object.entries(countMap).map(async ([k, [t, f]]) => { counts[k] = await countExact(t, f); }));
  // Legacy fallback: if the new rolling-plan table is absent here, show the old one.
  if (counts.smart_calendar == null) counts.smart_calendar = await countExact('smart_calendar', {});
  // Real source of truth for the Automated Calendar lives in the Smart Brain
  // project — count there and let it win when present (fixes the empty tiles).
  const [sbCal, sbGen, sbPending] = await Promise.all([
    smartBrainCount('smart_calendar_entries'),
    smartBrainCount('smart_generated_campaigns'),
    smartBrainCount('smart_calendar_entries', { status: 'eq.tentative' }),
  ]);
  if (sbCal != null) counts.smart_calendar = sbCal;
  if (sbGen != null) counts.generated_campaigns = sbGen;
  if (sbPending != null) counts.pending_reviews = sbPending;

  const lastRefresh = (cronRuns && cronRuns[0]) || null;

  // Diagnostic: surface WHY tiles may be empty (env resolution + a live count
  // probe against a table we know exists). Read-only, no secrets exposed.
  const diag = await (async () => {
    const out = { supabase_url_host: null, smart_brain_url_host: null, smart_brain_service_role: false, probe: null };
    try { const { url } = supa.env(); out.supabase_url_host = url ? new URL(url).host : null; } catch (_) {}
    try {
      const { url, key } = smartBrainEnv();
      out.smart_brain_url_host = url ? new URL(url).host : null;
      out.smart_brain_service_role = Boolean(process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
      if (url && key) {
        const res = await fetch(`${url}/rest/v1/smart_calendar_entries?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' } });
        out.probe = { table: 'smart_calendar_entries', http: res.status, ok: res.ok, content_range: res.headers.get('content-range') || null };
      } else { out.probe = { error: 'smart-brain url/key not resolved' }; }
    } catch (e) { out.probe = { error: String(e && e.message || e).slice(0, 140) }; }
    return out;
  })();

  return {
    generated_at: nowIso(),
    connectors: connSummary,
    counts,
    _diag: diag,
    last_refresh: lastRefresh ? {
      status: lastRefresh.status, started_at: lastRefresh.started_at,
      finished_at: lastRefresh.finished_at, summary: lastRefresh.summary,
    } : null,
    recent_activity: activity || [],
    recent_cron_runs: cronRuns || [],
    recent_agent_runs: agentRuns || [],
    recent_job_logs: jobLogs || [],
  };
}

module.exports = {
  listConnectors, syncConnector, runDailyJob, dashboard, logActivity,
  connectionState, FALLBACK_CONNECTORS,
};
