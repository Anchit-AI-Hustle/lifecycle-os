'use strict';
/**
 * social-gateway-core.js — the Social Integration Gateway: view + update, draft first.
 * ---------------------------------------------------------------------------
 * One place that READS and UPDATES the brand's social and ad accounts - Meta
 * (Instagram + Facebook + Ads), TikTok, TikTok Ads, Pinterest, YouTube, and the
 * existing Google Ads adapter - on top of the machinery this repo already has:
 * the adapters (api/_shared/adapters/), the OAuth vault (oauth-core.js), the
 * secrets store (workspace-connections-core.js) and the convergent dispatch
 * queue (dispatch-core.js). It adds no serverless function: it is mounted on
 * api/brain.js ?action=social-gateway&op=..., and its token refresh rides the
 * EXISTING daily cron (?action=cron).
 *
 *   READ     op=read      organic post metrics, ad spend / CTR / ROAS, comments,
 *                         mentions - through the adapter's endpoint table, so an
 *                         unverified endpoint is refused and LIVE_CONNECTORS off
 *                         means nothing is read. Metric snapshots are kept so
 *                         underperformance is measured against the brand's OWN
 *                         history.
 *   WRITE    every write is a dispatch JOB: organic posts, comment replies and
 *            moderation, draft/paused ads, and the LIVE APPROVAL that turns a
 *            paused ad on. Nothing here sends; the queue does, behind all three
 *            switches (LIVE_CONNECTORS, the workspace's publishing toggle and the
 *            platform's <PLATFORM>_ALLOW_WRITES). Missing one, the job builds the
 *            exact request and stops, naming the switch.
 *   INBOUND  recordInbound(): called by platform-webhooks.js AFTER the signature
 *            over the raw bytes verified. Idempotent by event id (a retried
 *            delivery is recorded once), routed to the workspace that owns the
 *            account, logged to platform_sync_log.
 *   REFRESH  refreshDueTokens(): from the daily cron, every OAuth connection
 *            whose token expires within 7 days, through the adapter's own
 *            documented refresh. A refusal marks the connection needs_reauth
 *            and the hub says so; a platform that did not answer is retried.
 *   FLAGS    op=underperformance: a creative below the brand's OWN median (the
 *            2026-08-19 fatigue rule - under three rows there is no median and
 *            it says so) or below a threshold the OPERATOR set for this
 *            workspace. No universal threshold is presented as a fact. A flag
 *            OFFERS a regeneration with its credit price; accepting it records
 *            the approval and names the metered call - nothing spends or
 *            publishes by itself.
 *
 * PRODUCTION RIGHT NOW (no database, no platform keys): every op answers the
 * honest state - connected:false, what to connect, which switch is off - in the
 * Klaviyo pattern, never an error frame and never an empty success.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const brandCore = require('./brand-workspace-core.js');
const connections = require('./workspace-connections-core.js');
const oauth = require('./oauth-core.js');
const registry = require('./adapters/registry.js');
const { liveConnectorsEnabled } = require('./live-connectors.js');
const catalog = require('./credit-catalog.js');

/** The platforms the gateway shows, in the order the hub renders them. */
const GATEWAY = ['meta', 'tiktok', 'tiktok_ads', 'pinterest', 'youtube', 'google_ads'];
const READ_KINDS = ['post_metrics', 'ad_metrics', 'comments', 'mentions'];
const REFRESH_WINDOW_DAYS = 7;

/** A paid draft, and the live-approval channel that turns it on. */
const LIVE_APPROVAL = {
  meta_ad: 'meta_live_approval',
  pinterest_campaign_draft: 'pinterest_live_approval',
  tiktok_ads_ad: 'tiktok_ads_live_approval',
  youtube_video_upload: 'youtube_live_approval',
};

/** The regeneration a flag offers, by kind: an existing catalog price, never a new one. */
const REGEN_FEATURE = { paid: 'ads.generate', organic: 'social.post' };

/* ── storage: service role, only after the caller's rights were checked ──── */

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: String(url).replace(/\/$/, ''), key } : null;
}

async function svc(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = serviceEnv();
  if (!e) { const err = new Error('SUPABASE_SERVICE_ROLE_KEY is not set, so the gateway has nowhere to keep what it reads.'); err.status = 503; err.code = 'gateway_store_unavailable'; throw err; }
  const headers = { apikey: e.key, authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) {
    const err = new Error(`gateway store ${method} -> ${res.status}`);
    err.status = res.status === 409 ? 409 : 502;
    err.duplicate = res.status === 409 || /23505|duplicate key/i.test(String(text));
    throw err;
  }
  return json;
}

const enc = encodeURIComponent;
const iso = (ms) => new Date(ms).toISOString();

/* ── the honest platform view ─────────────────────────────────────────────── */

/**
 * One platform as the hub renders it: what it is, whether it is connected for
 * this brand, which switches stand between it and a live write, and what to do
 * next. `conn` is the brand's connection row, or null.
 */
function platformRow(view, conn) {
  const live = liveConnectorsEnabled();
  const connected = !!(conn && Array.isArray(conn.secret_fields) && conn.secret_fields.length);
  const publishing = !!(conn && conn.config && (conn.config.publishing_enabled === true || conn.config.publishing_enabled === 'true'));
  const needsReauth = !!(conn && (conn.status === 'needs_reauth' || conn.revoked_at));
  const switches = {
    live_connectors: live,
    workspace_publishing: publishing,
    platform_writes: view.write_switch ? !!view.write_switch_on : null,
  };
  const next = [];
  if (!connected) {
    next.push(view.auth_kind === 'oauth'
      ? `Connect ${view.label} with its sign-in on the Publishing page.`
      : `Paste the ${view.label} credential on the Connections page.`);
    if (view.platform_prereq && view.platform_prereq.what) next.push(view.platform_prereq.what);
    const envs = Object.keys((view.platform_prereq && view.platform_prereq.env) || {});
    if (envs.length) next.push(`The deployment needs ${envs.join(' and ')} set.`);
  } else {
    if (needsReauth) next.push(`${view.label} needs to be reconnected: ${(conn && conn.last_check_note) || 'its token could not be refreshed.'}`);
    if (!live) next.push('LIVE_CONNECTORS is off on this deployment (the default), so nothing is read from or written to any platform.');
    if (!publishing) next.push(`Live publishing is off for ${view.label} on this brand; writes build the exact request and stop.`);
    if (view.write_switch && !view.write_switch_on) next.push(`${view.write_switch} is not set to 1 on the deployment, so ${view.label} writes build the exact request and stop.`);
  }
  if (view.unverified_operations.length) next.push(`${view.unverified_operations.length} ${view.label} call(s) are unverified against its documentation and refuse to send: ${view.unverified_operations.join(', ')}.`);
  return {
    id: view.id,
    label: view.label,
    category: view.category,
    connection_provider: view.connection_provider,
    auth_kind: view.auth_kind,
    connected,
    status: !conn ? 'not_connected' : needsReauth ? 'needs_reauth' : (conn.status || 'active'),
    account: conn ? (conn.external_account_label || conn.external_account_id || null) : null,
    token_expires_at: conn ? conn.token_expires_at || null : null,
    last_check_note: conn ? conn.last_check_note || '' : '',
    switches,
    write_switch: view.write_switch,
    can_write_now: connected && !needsReauth && live && publishing && (view.write_switch ? !!view.write_switch_on : true),
    endpoints: view.endpoint_table,
    unverified_operations: view.unverified_operations,
    webhook: view.webhook,
    channels: view.channels,
    next,
  };
}

function gatewayViews() {
  return registry.registryView().filter((v) => GATEWAY.indexOf(v.id) >= 0)
    .sort((a, b) => GATEWAY.indexOf(a.id) - GATEWAY.indexOf(b.id));
}

const CONN_COLS = 'provider,status,config,secret_fields,last_check_ok,last_check_note,last_checked_at,token_expires_at,refresh_expires_at,connect_kind,external_account_id,external_account_label,oauth_scopes,revoked_at';

async function status(auth, workspaceId) {
  const views = gatewayViews();
  let rows = null;
  let store = { reachable: true, note: '' };
  if (workspaceId) {
    try {
      rows = await brandCore.restAs(auth.token, `workspace_connections?select=${CONN_COLS}&workspace_id=eq.${enc(workspaceId)}`);
    } catch (err) {
      store = { reachable: false, note: `The connections for this brand could not be read (${err.message}). Every platform is shown as not connected until they can be.` };
    }
  }
  const by = {};
  for (const r of Array.isArray(rows) ? rows : []) by[r.provider] = r;
  return {
    ok: true,
    workspace_id: workspaceId || null,
    live_connectors: liveConnectorsEnabled(),
    store,
    platforms: views.map((v) => platformRow(v, by[v.connection_provider] || null)),
    // Which channels create a paused/draft/private object, and the approval
    // channel that turns each on - so the console lists exactly those drafts.
    live_approval: Object.assign({}, LIVE_APPROVAL),
    note: liveConnectorsEnabled() ? '' : 'LIVE_CONNECTORS is off on this deployment, which is the default: nothing is read from or written to any platform until it is on.',
  };
}

/* ── reads ────────────────────────────────────────────────────────────────── */

/**
 * The brand's credentials for one platform, fresh. The workspace was checked
 * against the caller's own rights (getWorkspace, through RLS) before this runs,
 * which is what entitles the service-role read of the secret.
 */
async function credentialsFor(workspaceId, adapterId) {
  if (!serviceEnv()) return { ok: false, connected: false, note: 'This deployment has no store for connections (SUPABASE_SERVICE_ROLE_KEY is not set), so no platform is connected.' };
  const provider = registry.connectionProviderFor(adapterId);
  const conn = await connections.getConnectionAsService(workspaceId, provider);
  const A = registry.adapterFor(adapterId);
  if (!conn) return { ok: false, connected: false, note: `${A.label} is not connected on this brand.` };
  const fresh = await oauth.ensureFreshToken(workspaceId, adapterId, { connection: conn });
  if (!fresh.ok) return { ok: false, connected: true, reconnect_required: !!fresh.reconnect_required, note: fresh.note };
  const cfg = conn.config && typeof conn.config === 'object' ? conn.config : {};
  return { ok: true, connected: true, conn, credentials: Object.assign({}, cfg, fresh.credentials) };
}

async function read(auth, workspaceId, q) {
  const adapterId = String(q.provider || '').toLowerCase();
  const A = registry.adapterFor(adapterId);
  if (!A || GATEWAY.indexOf(adapterId) < 0) { const e = new Error(`"${adapterId}" is not a platform the gateway reads.`); e.status = 400; throw e; }
  const kind = String(q.kind || '').toLowerCase();
  if (READ_KINDS.indexOf(kind) < 0) { const e = new Error(`kind must be one of ${READ_KINDS.join(', ')}.`); e.status = 400; throw e; }
  const ws = await brandCore.getWorkspace(auth, workspaceId);
  if (!ws) { const e = new Error('That brand is not one you can see.'); e.status = 404; throw e; }

  const c = await credentialsFor(workspaceId, adapterId);
  if (!c.ok) return Object.assign({ ok: false, provider: adapterId, kind }, c);
  const adapter = new A({ workspaceId, credentials: c.credentials, connection: c.conn });

  const ids = list(q.ids || q.id);
  let out;
  if (kind === 'post_metrics') out = await adapter.readPostMetrics({ ids, surface: q.surface, days: q.days });
  else if (kind === 'ad_metrics') out = await adapter.readAdMetrics({ ad_account_id: q.ad_account_id, ad_ids: list(q.ad_ids), since: q.since, until: q.until, date_preset: q.date_preset, columns: list(q.columns) });
  else if (kind === 'comments') out = await adapter.listComments({ surface: q.surface, object_id: q.object_id, limit: q.limit });
  else out = await adapter.listMentions({ ig_user_id: q.ig_user_id, comment_id: q.comment_id });

  const result = Object.assign({ provider: adapterId, kind, connected: true }, out);
  // Metrics are kept so a flag can be measured against this brand's OWN
  // history. A store that refuses is said, and the read still answers.
  if (out && out.ok && (kind === 'post_metrics' || kind === 'ad_metrics')) {
    const rows = kind === 'post_metrics' ? out.metrics : out.rows;
    result.snapshots = await keepSnapshots(workspaceId, adapterId, rows).catch((err) => ({ stored: 0, note: `Not kept: ${err.message}` }));
  }
  // Logged when the platform was actually asked. A read the switch or the
  // verification table withheld never left, and is not "a failed read".
  if (out && out.sent !== false && out.supported !== false) {
    await syncLog(workspaceId, adapterId, `read:${kind}`, !!out.ok, out.ok ? countOf(out) : 0, out.error || out.note).catch(() => {});
  }
  return result;
}

function list(v) {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  return String(v == null ? '' : v).split(',').map((s) => s.trim()).filter(Boolean);
}
function countOf(out) { return (out.metrics || out.rows || out.comments || out.mentions || []).length; }

/** Today's snapshot per creative, with the job and calendar slot it came from. */
async function keepSnapshots(workspaceId, provider, rows) {
  const clean = (Array.isArray(rows) ? rows : []).filter((r) => r && r.external_id && r.values && Object.keys(r.values).length);
  if (!clean.length) return { stored: 0 };
  const ids = clean.map((r) => r.external_id);
  const jobs = await svc(`dispatch_jobs?select=id,external_id,asset_ref,scheduled_for,created_at,channel&workspace_id=eq.${enc(workspaceId)}&external_id=in.(${ids.map((i) => `"${String(i).replace(/"/g, '')}"`).map(enc).join(',')})`).catch(() => []);
  const byExt = {};
  for (const j of Array.isArray(jobs) ? jobs : []) byExt[j.external_id] = j;
  const day = new Date().toISOString().slice(0, 10);
  const body = clean.map((r) => {
    const j = byExt[r.external_id] || null;
    return {
      workspace_id: workspaceId, provider, kind: r.kind === 'paid' ? 'paid' : 'organic', surface: r.surface || null,
      external_id: String(r.external_id), name: r.name || null, metrics: r.values, captured_on: day,
      job_id: j ? j.id : null, asset_ref: j ? j.asset_ref : null,
      slot_date: j ? String(j.scheduled_for || j.created_at || '').slice(0, 10) || null : null,
    };
  });
  await svc('social_metric_snapshots?on_conflict=workspace_id,provider,kind,external_id,captured_on', { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=minimal' });
  return { stored: body.length };
}

async function syncLog(workspaceId, provider, operation, ok, records, note, detail) {
  if (!workspaceId || !serviceEnv()) return;
  await svc('platform_sync_log', {
    method: 'POST',
    body: [{ workspace_id: workspaceId, provider, direction: 'inbound', operation, ok, records: records || 0, note: String(note || '').slice(0, 500), detail: detail || null }],
    prefer: 'return=minimal',
  });
}

/* ── underperformance ─────────────────────────────────────────────────────── */

/** The metrics a flag is computed on, higher is better for every one. */
const PAID_METRICS = ['ctr', 'roas'];
const ORGANIC_PRIMARY = ['views', 'reach', 'impressions', 'likes'];
const MIN_ROWS_FOR_MEDIAN = 3;

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Pure. `rows` are MetricRows (latest per creative); `thresholds` is the
 * operator's own `{ paid: { roas_min, ctr_min }, organic: { views_min } }` or
 * null. Returns the flags and, per group, whether a median was available.
 *
 * Two bases, reported in their own words:
 *   own_median          below this brand's own median for the metric, among
 *                       at least three creatives of the same platform and
 *                       kind. Fewer than three: no median, said, no flag.
 *   operator_threshold  below a number the operator set for this workspace.
 * A metric the platform did not return is skipped, never read as zero, and a
 * ROAS is never inferred for organic content.
 */
function computeUnderperformance(rows, thresholds) {
  const t = thresholds || {};
  const groups = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.external_id || !r.values) continue;
    const key = `${r.provider || 'unknown'}|${r.kind === 'paid' ? 'paid' : 'organic'}|${r.surface || ''}`;
    (groups[key] = groups[key] || []).push(r);
  }
  const flags = [];
  const groupsOut = [];
  for (const key of Object.keys(groups)) {
    const [provider, kind, surface] = key.split('|');
    const members = groups[key];
    const metrics = kind === 'paid' ? PAID_METRICS.slice() : [ORGANIC_PRIMARY.find((m) => members.filter((r) => isNum(r.values[m])).length >= MIN_ROWS_FOR_MEDIAN) || ORGANIC_PRIMARY.find((m) => members.some((r) => isNum(r.values[m])))].filter(Boolean);
    for (const metric of metrics) {
      const vals = members.filter((r) => isNum(r.values[metric]));
      const g = { provider, kind, surface: surface || null, metric, rows: vals.length };
      if (vals.length >= MIN_ROWS_FOR_MEDIAN) {
        g.available = true;
        g.median = round(median(vals.map((r) => Number(r.values[metric]))));
        for (const r of vals) {
          const v = Number(r.values[metric]);
          if (v < g.median) flags.push(flag(r, provider, kind, metric, v, 'own_median', { median: g.median, of: vals.length }));
        }
      } else {
        g.available = false;
        g.reason = `${vals.length} ${label(provider)} ${kind} creative(s) report ${metric}; a median needs at least ${MIN_ROWS_FOR_MEDIAN}, so none is computed and nothing is flagged against one.`;
      }
      const min = thresholdFor(t, kind, metric);
      if (min != null) {
        for (const r of vals) {
          const v = Number(r.values[metric]);
          if (v < min) flags.push(flag(r, provider, kind, metric, v, 'operator_threshold', { threshold: min }));
        }
      }
      groupsOut.push(g);
    }
  }
  return { flags, groups: groupsOut };
}

function isNum(v) { return v != null && v !== '' && Number.isFinite(Number(v)); }
function round(n) { return Math.round(n * 10000) / 10000; }
function label(provider) { const A = registry.adapterFor(provider); return A ? A.label : provider; }
function thresholdFor(t, kind, metric) {
  const v = t && t[kind] && t[kind][`${metric}_min`];
  return isNum(v) && Number(v) > 0 ? Number(v) : null;
}

function flag(r, provider, kind, metric, value, basis, extra) {
  const name = metric === 'ctr' ? 'CTR' : metric === 'roas' ? 'ROAS' : metric;
  const reason = basis === 'own_median'
    ? `${name} ${value} is below this brand's own median ${name} of ${extra.median} across ${extra.of} ${label(provider)} ${kind} creatives.`
    : `${name} ${value} is below the threshold of ${extra.threshold} set for this brand.`;
  return {
    provider, kind, surface: r.surface || null, external_id: String(r.external_id), name: r.name || null,
    metric, value, basis, median: extra.median != null ? extra.median : null, threshold: extra.threshold != null ? extra.threshold : null,
    reason, job_id: r.job_id || null, asset_ref: r.asset_ref || null, slot_date: r.slot_date || null,
    offer: regenOffer(kind),
  };
}

/** The regeneration a flag OFFERS: its price from the catalog, never run by itself. */
function regenOffer(kind) {
  const q = catalog.quote(REGEN_FEATURE[kind] || 'social.post');
  return {
    action: 'regenerate', feature_key: q.key, label: q.label, credits: q.total,
    requires_approval: true, runs_automatically: false,
    note: `Regenerating spends ${q.total} credits (${q.label}) and only after an editor approves it. Nothing is regenerated or published by the flag itself.`,
  };
}

const THRESHOLD_KEYS = { paid: ['ctr_min', 'roas_min'], organic: ['views_min', 'reach_min', 'impressions_min', 'likes_min'] };

function normalizeThresholds(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = { paid: {}, organic: {} };
  for (const kind of Object.keys(THRESHOLD_KEYS)) {
    for (const k of THRESHOLD_KEYS[kind]) {
      const v = src[kind] && src[kind][k];
      if (v == null || v === '') continue;
      if (!isNum(v) || Number(v) <= 0) { const e = new Error(`${kind}.${k} must be a positive number.`); e.status = 400; throw e; }
      out[kind][k] = Number(v);
    }
  }
  return out;
}

async function getThresholds(auth, workspaceId) {
  const rows = await brandCore.restAs(auth.token, `social_gateway_settings?select=thresholds,updated_at&workspace_id=eq.${enc(workspaceId)}&limit=1`);
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  return row ? { thresholds: row.thresholds || { paid: {}, organic: {} }, updated_at: row.updated_at } : { thresholds: null, updated_at: null };
}

async function saveThresholds(auth, workspaceId, input) {
  await brandCore.assertCanWrite(auth, workspaceId, 'set its underperformance thresholds');
  const clean = normalizeThresholds(input);
  await brandCore.restAs(auth.token, 'social_gateway_settings?on_conflict=workspace_id', {
    method: 'POST',
    body: [{ workspace_id: workspaceId, thresholds: clean, updated_by: auth.user_id, updated_at: new Date().toISOString() }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  return clean;
}

/** Latest snapshot per creative for this brand, read as the caller (RLS). */
async function latestSnapshots(auth, workspaceId) {
  const rows = await brandCore.restAs(auth.token, `social_metric_snapshots?select=provider,kind,surface,external_id,name,metrics,captured_on,job_id,asset_ref,slot_date&workspace_id=eq.${enc(workspaceId)}&order=captured_on.desc&limit=1000`);
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = `${r.provider}|${r.kind}|${r.external_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ provider: r.provider, kind: r.kind, surface: r.surface, external_id: r.external_id, name: r.name, values: r.metrics || {}, job_id: r.job_id, asset_ref: r.asset_ref, slot_date: r.slot_date });
  }
  return out;
}

async function underperformance(auth, workspaceId, body) {
  const ws = await brandCore.getWorkspace(auth, workspaceId);
  if (!ws) { const e = new Error('That brand is not one you can see.'); e.status = 404; throw e; }
  const t = await getThresholds(auth, workspaceId).catch(() => ({ thresholds: null }));
  const rows = await latestSnapshots(auth, workspaceId);
  const out = computeUnderperformance(rows, t.thresholds);
  let stored = 0;
  if (out.flags.length && serviceEnv()) {
    const now = new Date().toISOString();
    // The decision columns are left out, so a recompute never reopens a flag
    // an editor already approved or dismissed.
    const rowsOut = out.flags.map((f) => ({
      workspace_id: workspaceId, provider: f.provider, kind: f.kind, external_id: f.external_id, metric: f.metric, basis: f.basis,
      value: f.value, median: f.median, threshold: f.threshold, reason: f.reason, offer: f.offer,
      job_id: f.job_id, asset_ref: f.asset_ref, slot_date: f.slot_date, updated_at: now,
    }));
    await svc('social_creative_flags?on_conflict=workspace_id,provider,external_id,metric,basis', { method: 'POST', body: rowsOut, prefer: 'resolution=merge-duplicates,return=minimal' })
      .then(() => { stored = rowsOut.length; }).catch(() => {});
  }
  void body;
  return Object.assign({ ok: true, workspace_id: workspaceId, creatives: rows.length, thresholds: t.thresholds, stored }, out);
}

async function listFlags(auth, workspaceId) {
  return brandCore.restAs(auth.token, `social_creative_flags?select=id,provider,kind,external_id,metric,basis,value,median,threshold,reason,offer,status,job_id,asset_ref,slot_date,decided_by,decided_at,updated_at&workspace_id=eq.${enc(workspaceId)}&order=slot_date.desc.nullslast,updated_at.desc&limit=200`);
}

/**
 * An editor's decision on a flag. APPROVING the regeneration records who and
 * when, and answers with the metered call the console makes next - the
 * gateway itself spends nothing and publishes nothing.
 */
async function decideFlag(auth, workspaceId, flagId, decision) {
  await brandCore.assertCanWrite(auth, workspaceId, decision === 'regen_approved' ? 'approve a regeneration' : 'dismiss a flag');
  if (!flagId) { const e = new Error('flag_id is required.'); e.status = 400; throw e; }
  const rows = await svc(`social_creative_flags?id=eq.${enc(flagId)}&workspace_id=eq.${enc(workspaceId)}&status=eq.open&select=*`, {
    method: 'PATCH', body: { status: decision, decided_by: auth.user_id, decided_at: new Date().toISOString() }, prefer: 'return=representation',
  });
  const f = Array.isArray(rows) && rows[0];
  if (!f) return { ok: false, error: 'not_open', message: 'That flag is not open on this brand: it was already decided, or it is not this brand\'s.' };
  if (decision !== 'regen_approved') return { ok: true, flag: f };
  const offer = f.offer || regenOffer(f.kind);
  return {
    ok: true,
    flag: f,
    next: {
      feature_key: offer.feature_key, credits: offer.credits,
      how: 'Regenerate this creative from the console that made it; the run is metered there, on your session, at the price above.',
      asset_ref: f.asset_ref || null, external_id: f.external_id, provider: f.provider,
    },
  };
}

/* ── live approval ────────────────────────────────────────────────────────── */

/**
 * Turn a paid draft on. The draft must be a job THIS brand ran that the
 * platform accepted; the approval is itself a dispatch job, so it carries the
 * operator (dispatch-core stamps approved_by from the session), runs the
 * preflight, and is behind all three switches like any other write.
 */
async function liveApprove(auth, workspaceId, body) {
  await brandCore.assertCanWrite(auth, workspaceId, 'approve a paused ad or draft going live');
  const jobId = String((body && body.job_id) || '');
  if (!jobId) { const e = new Error('job_id is required: the dispatch job that created the paused ad or private video.'); e.status = 400; throw e; }
  const rows = await svc(`dispatch_jobs?select=id,provider,channel,status,external_id,external_status,asset_ref&id=eq.${enc(jobId)}&workspace_id=eq.${enc(workspaceId)}&limit=1`);
  const job = Array.isArray(rows) && rows[0];
  if (!job) return { ok: false, error: 'job_not_found', message: 'That job is not one of this brand\'s.' };
  const channel = LIVE_APPROVAL[job.channel];
  if (!channel) return { ok: false, error: 'not_a_draft', message: `${job.channel} does not create a paused or private object, so there is nothing to approve.` };
  if (job.status !== 'succeeded' || !job.external_id) return { ok: false, error: 'draft_not_created', message: 'The draft was not created on the platform (the job did not succeed), so there is nothing to approve.' };
  if (job.channel === 'meta_ad' && job.external_status === 'creative_only') return { ok: false, error: 'not_an_ad', message: 'That job created a Meta creative with no ad set, so there is no ad to activate.' };
  const out = await require('./dispatch-core.js').enqueue(auth, workspaceId, {
    channel,
    asset: { external_id: job.external_id, source_job_id: job.id, note: String((body && body.note) || '').slice(0, 300) },
    idempotency_key: `live:${job.id}`,
    asset_ref: job.asset_ref || null,
    asset_kind: 'live_approval',
    override_preflight: !!(body && body.override_preflight),
    override_note: body && body.override_note,
  });
  return Object.assign({ approved_by: auth.user_id, source_job_id: job.id, live_channel: channel }, out);
}

/* ── inbound webhooks ─────────────────────────────────────────────────────── */

/**
 * Record a VERIFIED delivery. Called by platform-webhooks.js after the adapter
 * checked the signature over the raw bytes, never before.
 *
 *   - the event id is the adapter's (the digest of the verified bytes unless
 *     the platform names one), and the unique (provider, event_id) index makes
 *     a redelivery a recorded duplicate rather than a second event;
 *   - the workspace is the one whose connection names the account the event
 *     is about; an account nobody connected is kept unrouted, not guessed;
 *   - a routed event is written to platform_sync_log, and a publish-status
 *     event reconciles the job whose external id it names.
 *
 * Never throws: a store that is down is reported, and the receiver goes on.
 */
async function recordInbound(provider, adapter, event, bytes) {
  try {
    if (!serviceEnv()) return { recorded: false, reason: 'store_unavailable' };
    const eventId = adapter.webhookEventId(event, bytes);
    const items = adapter.webhookItems(event) || [];
    const accountId = adapter.webhookAccountId(event);
    const workspaceId = accountId ? await workspaceForAccount(provider, accountId) : null;
    const first = items[0] || {};
    try {
      await svc('social_inbound_events', {
        method: 'POST',
        body: [{
          provider, event_id: eventId, workspace_id: workspaceId, account_id: accountId,
          event_type: String(first.field || (event && (event.object || event.event)) || '') || null,
          kind: items.length > 1 ? 'batch' : (first.kind || 'other'),
          items, payload: event,
        }],
        prefer: 'return=minimal',
      });
    } catch (err) {
      if (err.duplicate) return { recorded: false, duplicate: true, event_id: eventId, workspace_id: workspaceId };
      throw err;
    }
    let reconciled = 0;
    for (const it of items) {
      if (it.kind !== 'publish_status' || !it.object_id || !workspaceId) continue;
      const done = await svc(`dispatch_jobs?workspace_id=eq.${enc(workspaceId)}&provider=eq.${enc(provider)}&external_id=eq.${enc(it.object_id)}&select=id`, {
        method: 'PATCH', body: { external_status: String(it.status || 'updated').slice(0, 80), updated_at: new Date().toISOString() }, prefer: 'return=representation',
      }).catch(() => []);
      reconciled += Array.isArray(done) ? done.length : 0;
    }
    if (workspaceId) {
      await syncLog(workspaceId, provider, `webhook:${first.field || 'event'}`, true, items.length, `Verified delivery ${eventId.slice(0, 19)}`, { event_id: eventId, items: items.map((i) => ({ kind: i.kind, object_id: i.object_id })) }).catch(() => {});
    }
    return { recorded: true, duplicate: false, event_id: eventId, workspace_id: workspaceId, items: items.length, reconciled };
  } catch (err) {
    return { recorded: false, reason: 'store_failed', note: String((err && err.message) || err).slice(0, 200) };
  }
}

/** The workspace whose connection names this platform account, or null. */
async function workspaceForAccount(provider, accountId) {
  const conn = registry.connectionProviderFor(provider);
  const id = enc(String(accountId));
  const rows = await svc(`workspace_connections?select=workspace_id&provider=eq.${enc(conn)}&or=(external_account_id.eq.${id},config->>page_id.eq.${id},config->>ig_user_id.eq.${id})&limit=2`);
  // Two brands claiming one account is not resolved by picking one.
  return Array.isArray(rows) && rows.length === 1 ? rows[0].workspace_id : null;
}

/* ── token refresh, from the existing daily cron ──────────────────────────── */

/**
 * Refresh every OAuth connection whose access token expires within the window.
 * A refusal marks the connection needs_reauth with the platform's reason, which
 * the hub shows; a platform that did not answer (network, 429, 5xx) is noted
 * and retried on the next run, because a blip is not a revoked grant.
 */
async function refreshDueTokens({ withinDays = REFRESH_WINDOW_DAYS, limit = 25 } = {}) {
  if (!serviceEnv()) return { ok: false, skipped: true, note: 'SUPABASE_SERVICE_ROLE_KEY is not set, so there are no stored connections to refresh.' };
  if (!connections.cryptoConfigured()) return { ok: false, skipped: true, note: connections.secretsStorageError() || 'CONNECTION_SECRET_KEY is not set, so no stored token can be read.' };
  const horizon = iso(Date.now() + withinDays * 86400000);
  const due = await svc(
    `workspace_connections?select=id,workspace_id,provider,status,config,token_expires_at,refresh_failure_count,secret_fields,revoked_at`
    + `&connect_kind=eq.oauth&status=eq.active&revoked_at=is.null&token_expires_at=lte.${enc(horizon)}&order=token_expires_at.asc&limit=${Math.min(Number(limit) || 25, 100)}`,
  );
  const results = [];
  for (const c of Array.isArray(due) ? due : []) {
    const adapterId = registry.adapterIdForConnection(c.provider);
    const A = adapterId && registry.adapterFor(adapterId);
    if (!A) continue;
    const secrets = await connections.secretsAsService(c.id).catch(() => null);
    if (!secrets) {
      await mark(c, 'needs_reauth', `${A.label}: the stored token could not be read (it was encrypted under a different CONNECTION_SECRET_KEY). Reconnect it.`);
      results.push({ provider: c.provider, workspace_id: c.workspace_id, ok: false, needs_reauth: true });
      continue;
    }
    const adapter = new A({ workspaceId: c.workspace_id, credentials: secrets, connection: c });
    let r;
    try { r = await adapter.refreshCredentials(); } catch (err) { r = { ok: false, transient: true, note: String((err && err.message) || err) }; }
    if (r && r.ok) {
      await connections.saveConnectionAsService({
        workspace_id: c.workspace_id, provider: c.provider, fields: r.credentials,
        meta: Object.assign({ token_expires_at: r.expires_at || null, last_refresh_at: new Date().toISOString(), refresh_failure_count: 0, revoked_at: null },
          r.refresh_expires_at ? { refresh_expires_at: r.refresh_expires_at } : {},
          Array.isArray(r.granted_scopes) && r.granted_scopes.length ? { oauth_scopes: r.granted_scopes } : {}),
      });
      await connections.patchConnectionAsService(c.workspace_id, c.provider, { last_check_ok: true, last_checked_at: new Date().toISOString(), last_check_note: `Token refreshed; it now expires ${r.expires_at ? r.expires_at.slice(0, 10) : 'on the platform\'s schedule'}.` });
      results.push({ provider: c.provider, workspace_id: c.workspace_id, ok: true, expires_at: r.expires_at || null });
    } else if (r && r.transient) {
      await connections.patchConnectionAsService(c.workspace_id, c.provider, {
        refresh_failure_count: Number(c.refresh_failure_count || 0) + 1, last_check_ok: false, last_checked_at: new Date().toISOString(),
        last_check_note: `${A.label} refresh did not complete and will be retried: ${String((r && r.note) || '').slice(0, 200)}`,
      });
      results.push({ provider: c.provider, workspace_id: c.workspace_id, ok: false, retry: true });
    } else {
      await mark(c, 'needs_reauth', `${A.label} could not be refreshed: ${String((r && r.note) || 'the platform refused the refresh.').slice(0, 220)} Reconnect it on the Publishing page.`);
      results.push({ provider: c.provider, workspace_id: c.workspace_id, ok: false, needs_reauth: true });
    }
  }
  return {
    ok: true,
    due: Array.isArray(due) ? due.length : 0,
    refreshed: results.filter((x) => x.ok).length,
    needs_reauth: results.filter((x) => x.needs_reauth).length,
    retry: results.filter((x) => x.retry).length,
    window_days: withinDays,
    results,
  };
}

async function mark(c, statusValue, note) {
  await connections.patchConnectionAsService(c.workspace_id, c.provider, {
    status: statusValue, refresh_failure_count: Number(c.refresh_failure_count || 0) + 1,
    last_check_ok: false, last_checked_at: new Date().toISOString(), last_check_note: note.slice(0, 300),
  });
}

/* ── the router (mounted at /api/brain?action=social-gateway) ─────────────── */

const OPS = ['status', 'read', 'inbox', 'underperformance', 'flags', 'thresholds', 'thresholds-save', 'regen-approve', 'flag-dismiss', 'live-approve'];

/**
 * `auth` is the caller requireUser() verified; `workspaceId` is the one the
 * router resolved for that caller (never re-read from the request here).
 */
async function handle(req, res, { auth, workspaceId, body } = {}) {
  const q = (req && req.query) || {};
  const b = body && typeof body === 'object' ? body : {};
  const op = String(q.op || b.op || 'status').toLowerCase();
  if (OPS.indexOf(op) < 0) return res.status(400).json({ ok: false, error: 'unknown_gateway_operation', available: OPS });

  // A brand kept on this device (a phone sign-in with no server workspace)
  // has no connections on the server. Its status is the honest one, and
  // anything that would read or write a platform says why it cannot.
  if (!workspaceId) {
    if (op === 'status') {
      const out = await status(auth, null);
      return res.status(200).json(Object.assign(out, {
        storage: 'device',
        note: 'This brand is kept on this device, and platform accounts are connected to a brand workspace on the server, so nothing is connected here. ' + (out.note || ''),
      }));
    }
    return res.status(409).json({ ok: false, error: 'no_active_brand', message: 'Platform accounts belong to a brand workspace on the server; this brand is kept on this device, so there is no account to read or write.' });
  }

  try {
    switch (op) {
      case 'status': return res.status(200).json(await status(auth, workspaceId));
      case 'read': return res.status(200).json(await read(auth, workspaceId, Object.assign({}, q, b)));
      case 'inbox': {
        const rows = await brandCore.restAs(auth.token, `social_inbound_events?select=id,provider,event_type,kind,account_id,items,received_at&workspace_id=eq.${enc(workspaceId)}&order=received_at.desc&limit=${Math.min(Number(q.limit || b.limit) || 50, 200)}`);
        return res.status(200).json({ ok: true, events: Array.isArray(rows) ? rows : [] });
      }
      case 'underperformance': return res.status(200).json(await underperformance(auth, workspaceId, b));
      case 'flags': return res.status(200).json({ ok: true, flags: (await listFlags(auth, workspaceId)) || [] });
      case 'thresholds': return res.status(200).json(Object.assign({ ok: true, keys: THRESHOLD_KEYS }, await getThresholds(auth, workspaceId)));
      case 'thresholds-save': return res.status(200).json({ ok: true, thresholds: await saveThresholds(auth, workspaceId, b.thresholds || b) });
      case 'regen-approve': {
        const out = await decideFlag(auth, workspaceId, String(b.flag_id || q.flag_id || ''), 'regen_approved');
        return res.status(out.ok ? 200 : 409).json(out);
      }
      case 'flag-dismiss': {
        const out = await decideFlag(auth, workspaceId, String(b.flag_id || q.flag_id || ''), 'dismissed');
        return res.status(out.ok ? 200 : 409).json(out);
      }
      case 'live-approve': {
        const out = await liveApprove(auth, workspaceId, b);
        return res.status(out.ok ? 200 : 409).json(out);
      }
      default: return res.status(400).json({ ok: false, error: 'unknown_gateway_operation', available: OPS });
    }
  } catch (err) {
    const statusCode = err && err.status ? err.status : 500;
    return res.status(statusCode).json({ ok: false, error: err.code || 'gateway_operation_failed', message: err.message || 'The gateway operation failed.' });
  }
}

module.exports = {
  handle,
  status,
  read,
  recordInbound,
  refreshDueTokens,
  computeUnderperformance,
  normalizeThresholds,
  liveApprove,
  decideFlag,
  regenOffer,
  GATEWAY,
  LIVE_APPROVAL,
  OPS,
  REFRESH_WINDOW_DAYS,
  MIN_ROWS_FOR_MEDIAN,
};
