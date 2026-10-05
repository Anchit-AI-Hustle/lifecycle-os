'use strict';

/**
 * KNICKGASM Smart Brain service layer.
 *
 * The module is intentionally dependency-light so it can run inside one Vercel
 * serverless function. It exposes clean service contracts for KB, Analysis,
 * Competitor Benchmarking, Calendar Intelligence, Generation, and Review.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildEntryAnalysis, buildGenerationAnalysis, explainConfidence } = require('../../api/_shared/output-reasoning');
// The one contact policy (2026-10-04): the plan-time cap, the per-slot
// eligibility and the numbers both use are read from it, not re-typed here.
const fatigue = require('../../api/_shared/contact-fatigue.js');
// Per-market daily attributed-email revenue target in USD (spec §24a). Drives
// per-slot revenue-feasibility so sub-threshold cohorts are flagged, not assumed
// viable. US floor is $1,000/day per the product owner (2026-07-12); other
// markets default to $1,500 until set. Region-aware so each market's feasibility
// is judged against ITS OWN target, never a single blanket number.
const DAILY_REVENUE_TARGET_USD = { US: 1000, UK: 1500, GLOBAL: 1500, DEFAULT: 1500 };
function dailyRevenueTargetFor(market) {
  const m = String(market || '').toUpperCase();
  return DAILY_REVENUE_TARGET_USD[m] || DAILY_REVENUE_TARGET_USD.DEFAULT;
}
let reviewRecovery = null;
try { reviewRecovery = require('../../api/_shared/review-recovery.js'); } catch (_) { reviewRecovery = null; }

const DEFAULT_CONFIG = {
  markets: ['US', 'UK'],
  // Rolling horizon the Smart Brain plans + prebuilds ahead. 90 days so every
  // slot in the next quarter always exists AND has its assets prebuilt (see the
  // convergent prebuild queue in api/_shared/smart-brain-plan.js). Was 15.
  calendarDays: 90,
  // Daily freshness window: near-term tentative slots (this many days out) have
  // their prebuilt mailer/ads/landing assets REGENERATED every daily sync so the
  // reviewer always sees creatives built against the latest competitor
  // benchmarks + campaign data (as of the last sync). Slots beyond the window
  // stay built-once until they materially re-plan (bounds daily generation cost).
  prebuildRefreshDays: 7,
  performanceThresholds: {
    email: { openRate: 0.22, clickRate: 0.018, conversionRate: 0.006, revenuePerRecipient: 0.08 },
    meta: { ctr: 0.009, cvr: 0.012, roas: 1.6 },
    google: { ctr: 0.025, cvr: 0.018, roas: 1.8 },
    tiktok: { ctr: 0.007, cvr: 0.008, roas: 1.3 },
    landing_page: { conversionRate: 0.018 },
  },
  confidence: {
    minHumanVerificationConfidence: 0.82,
    weeklyRecalibrationDays: 7,
  },
  capacity: {
    emailPerMarketPerWeek: 4,
    paidCampaignsPerMarketPerWeek: 5,
  },
  // Reach + per-user frequency policy the daily planner targets. Each send aims
  // for minRecipients..targetRecipients real recipients (widening from the core
  // cohort to adjacent/broad audiences at ESP time when the core cohort is
  // smaller than the floor). Per-user weekly frequency is held to
  // minPerUserPerWeek..maxPerUserPerWeek — the calendar rotates cohorts so the
  // whole base is covered at that cadence; the hard per-user cap is enforced at
  // ESP send time (Phase 2), the planner sizes + documents the target here.
  frequency: {
    minRecipientsPerSend: 20000,
    targetRecipientsPerSend: 30000,
    minPerUserPerWeek: 2,
    maxPerUserPerWeek: 3,
  },
  // Sends scheduled PER DAY PER MARKET. 3-4 distinct cohorts a day keeps the whole
  // base covered at the 2-3/user/week cadence and underpins the >=70-80k USD/month
  // (~1000-1500 USD/day) revenue target. Each cohort is a separate calendar row
  // (MAILER 1/N ... N/N), deduped by the ESP suppression waterfall.
  cohortsPerDay: 4,
  // Rough revenue model for the monthly projection surfaced in the console KPIs.
  // Blended revenue-per-recipient for an at-cap lifecycle send; deliberately
  // conservative. Real numbers replace this once ESP send data flows in.
  revenuePerRecipient: 0.06,
  tableNames: {
    products: 'smart_products',
    assets: 'smart_assets',
    campaigns: 'smart_campaigns',
    campaignAssets: 'smart_campaign_assets',
    campaignMetrics: 'smart_campaign_metrics',
    users: 'smart_users',
    orders: 'smart_orders',
    events: 'smart_events',
    competitors: 'smart_competitor_campaigns',
    mvtResults: 'smart_mvt_results',
    feedback: 'smart_feedback',
    generatedCampaigns: 'smart_generated_campaigns',
    runs: 'smart_brain_runs',
    calendarEntries: 'smart_calendar_entries',
    adsGenerated: 'ads_generated',
    landingPagesGenerated: 'landing_pages_generated',
    mailersGenerated: 'mailers_generated',
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return { ...base };
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v;
  }
  return out;
}

function smartConfig(overrides = {}) {
  let fileConfig = {};
  const cfgPath = path.join(process.cwd(), 'smart-brain.config.json');
  if (fs.existsSync(cfgPath)) {
    try { fileConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) { fileConfig = {}; }
  }
  return deepMerge(deepMerge(DEFAULT_CONFIG, fileConfig), overrides);
}

function idFor(prefix, input) {
  return `${prefix}_${crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 12)}`;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function round(n, digits = 4) { return Number.isFinite(+n) ? Number((+n).toFixed(digits)) : 0; }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function asArray(x) { return Array.isArray(x) ? x : []; }
function norm(s) { return String(s || '').trim(); }
function slug(s) { return norm(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'campaign'; }

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (quote && c === '"' && next === '"') { cell += '"'; i++; continue; }
    if (c === '"') { quote = !quote; continue; }
    if (!quote && c === ',') { row.push(cell); cell = ''; continue; }
    if (!quote && (c === '\n' || c === '\r')) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}

function readCsvIfExists(rel) {
  const p = path.join(process.cwd(), rel);
  if (!fs.existsSync(p)) return [];
  return parseCsv(fs.readFileSync(p, 'utf8'));
}

function loadFestivals() {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'festivals.json'), 'utf8')); }
  catch (_) { return {}; }
}

// Content tables that belong to exactly ONE brand workspace. The service-role
// key bypasses RLS, so the database policies added in
// 20260810120000_scope_content_to_workspace.sql cannot protect these paths on
// their own - the adapter has to scope them itself. Every select against one of
// these is filtered by workspace (the one exception, a guarded point lookup by
// an id that is itself the capability, is documented on isPointLookup below),
// and every write is stamped with it. A write that is NOT stamped lands with
// workspace_id NULL and is invisible to the scoped policies, so stamping is
// not optional.
// There is exactly ONE list, in api/_shared/workspace-scope.js, derived from the
// migrations and checked against them by tests/workspace-scope.spec.js. This
// used to be a hand-copied duplicate with "keep in sync" in a comment above it,
// and the two had already drifted apart by twenty-odd tables - so the adapter
// read ci_*, kb_top_emails, klaviyo_* and webengage_events across every brand
// while the comment said it did not. Importing removes the drift as a category.
const WORKSPACE_SCOPED = require('../../api/_shared/workspace-scope.js').SCOPED_TABLES;

class SmartBrainDbAdapter {
  constructor(config = smartConfig(), workspaceId = null) {
    this.config = config;
    // The workspace every read and write in this instance belongs to. Callers
    // that act for a signed-in operator pass their ACTIVE workspace; the daily
    // cron has no user, so it falls back to the oldest workspace (tenant zero),
    // which is exactly what the backfill assigned historical rows to.
    this.workspaceId = workspaceId || (config && config.workspace_id) || process.env.SMART_BRAIN_WORKSPACE_ID || null;
    this._wsPromise = null;
    // Environment first, data/linked-db.json LAST. The file used to outrank
    // SUPABASE_URL here (the same defect brain-core.js and public-config.js
    // carried), so a deployment pointed at its own database still addressed
    // whatever project the file named. The file ships empty now; the order
    // is fixed anyway so a future re-pin cannot reintroduce it.
    let linked = {};
    try { linked = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'linked-db.json'), 'utf8')); } catch (_) {}
    this.url = (process.env.SMART_BRAIN_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || linked.url || '').replace(/\/$/, '');
    // Key precedence: a SERVICE-ROLE key must always win — it is the only key
    // that bypasses RLS, and without it every write is silently blocked (the
    // plan stays stored:false). The linked file's keys come AFTER the env's
    // anon key as well, so the URL and the key are always a matched pair from
    // the same source — an env URL with a file key is a guaranteed 401.
    this.key = process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY
      || process.env.SMART_BRAIN_SUPABASE_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_KEY
      || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || linked.serviceRoleKey || linked.service_role_key
      || linked.anonKey || '';
    this.usingServiceRole = Boolean(process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY || process.env.SMART_BRAIN_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || linked.serviceRoleKey || linked.service_role_key);
  }
  /** Resolve (and cache) the workspace this adapter writes to. */
  async workspace() {
    if (this.workspaceId) return this.workspaceId;
    if (!this._wsPromise) {
      this._wsPromise = (async () => {
        if (!this.connected) return null;
        // The oldest-workspace default is the CRON's, never a person's
        // (2026-09-29, review). A request served for a signed-in caller with
        // no workspace - a mobile+PIN account, whose brands live on its device
        // - reached here with workspace_id null and was handed tenant zero's
        // rows: its plan, its campaigns, its revenue figures in team-chat and
        // agent-analyze, its calendar in smart-brain-plan and sync-daily. The
        // router had stamped `null` correctly; this default turned it back
        // into the oldest workspace one layer down. Same rule as
        // workspace-scope.resolve(): a user with no workspace gets NOTHING
        // scoped (select returns [], a write refuses).
        try {
          const rs = require('../../api/_shared/request-scope.js');
          const req = rs.currentRequest && rs.currentRequest();
          if (req && require('../../api/_shared/workspace-scope.js').requestHasUser(req)) return null;
        } catch (_) { /* outside a request: the scheduler's default applies */ }
        try {
          const r = await fetch(`${this.url}/rest/v1/brand_workspaces?select=id&order=created_at.asc&limit=1`, { headers: this.headers() });
          if (!r.ok) return null;
          const rows = await r.json().catch(() => []);
          return (rows[0] && rows[0].id) || null;
        } catch (_) { return null; }
      })();
    }
    this.workspaceId = await this._wsPromise;
    return this.workspaceId;
  }
  static scoped(table) { return WORKSPACE_SCOPED.has(String(table || '')); }

  /**
   * The ONE shape of read that may cross workspaces: a point lookup by an id
   * that is itself the capability, limit 1.
   *
   * /lp/<campaign_id> is a public link. The id is a sha1 over the entry, it is
   * minted without a workspace (smart-brain-plan.js, smart-brain.html), and the
   * database already serves the row to the anon role by id for exactly this
   * route (20260719120000, `using (true)` on smart_generated_campaigns). The
   * adapter's own filter defeated that: with no workspace in the config it
   * resolved the OLDEST workspace, so another tenant's persisted campaign was
   * never found and every bare link fell to the fallback page - which then
   * wore tenant zero's brand. The row's own workspace_id is the authority for
   * whose brand renders, and the caller reads it OFF THE ROW.
   *
   * Refused (with a warning, returning nothing) unless the filters name one of
   * these ids with `eq.` and the limit is 1: a read that could list, page or
   * search across brands never gets through here.
   */
  static isPointLookup(params) {
    const ID_KEYS = ['id', 'payload->>campaign_id', 'generated_campaign_id'];
    const f = (params && params.filters) || {};
    const byId = Object.entries(f).some(([k, v]) => ID_KEYS.includes(k) && /^eq\.\S+$/.test(String(v)));
    return byId && Number(params && params.limit) === 1;
  }

  get connected() { return Boolean(this.url && this.key); }
  headers() { return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }; }
  async select(table, params = {}) {
    if (!this.connected) return null;
    const search = new URLSearchParams({ select: params.select || '*' });
    if (params.limit) search.set('limit', String(params.limit));
    if (params.order) search.set('order', params.order);
    for (const [k, v] of Object.entries(params.filters || {})) search.set(k, v);
    // Never read across brands. An unresolvable workspace returns nothing
    // rather than everything - the safe direction when scoping fails.
    if (SmartBrainDbAdapter.scoped(table)) {
      if (params.anyWorkspace) {
        if (!SmartBrainDbAdapter.isPointLookup(params)) {
          try { console.warn(`[smart-brain-db] select ${table}: anyWorkspace is only for a point lookup by id with limit 1 - returning []`); } catch (_) {}
          return [];
        }
      } else {
        const ws = await this.workspace();
        if (!ws) { try { console.warn(`[smart-brain-db] select ${table}: no workspace resolved - returning []`); } catch (_) {} return []; }
        search.set('workspace_id', `eq.${ws}`);
      }
    }
    const r = await fetch(`${this.url}/rest/v1/${table}?${search}`, { headers: this.headers() });
    if (!r.ok) {
      // Degrade gracefully: a failed read (missing table, wrong project, key
      // mismatch, transient error) returns no rows instead of throwing and
      // blanking the whole calendar. Writes still surface warnings elsewhere.
      let detail = ''; try { detail = (await r.text()).slice(0, 160); } catch (_) {}
      // A PAGED read cannot degrade to []: an empty page means "no more rows",
      // so a failed page 3 would end the read and pass it off as complete.
      if (params.throwOnError) throw new Error(`select ${table} failed: ${r.status} ${detail}`);
      try { console.warn(`[smart-brain-db] select ${table} failed: ${r.status} ${detail} — returning []`); } catch (_) {}
      return [];
    }
    return r.json();
  }
  /** Stamp rows with the adapter's workspace for scoped tables. */
  async stamp(table, rows) {
    if (!SmartBrainDbAdapter.scoped(table)) return rows;
    const ws = await this.workspace();
    if (!ws) return rows;
    return (Array.isArray(rows) ? rows : [rows]).map((r) => (
      r && typeof r === 'object' && r.workspace_id ? r : Object.assign({}, r, { workspace_id: ws })
    ));
  }
  /**
   * A row for a scoped table with no workspace to stamp it with is refused,
   * not written unstamped (2026-09-29, review). stamp() returned the rows
   * untouched when no workspace resolved, so a mobile+PIN account's sync,
   * feedback and approval wrote smart_calendar_entries, smart_feedback,
   * smart_generated_campaigns and the mailer/ad/landing mirrors with NO
   * workspace_id: invisible to every brand, still in the table, and one
   * backfill away from being attributed to tenant zero. update() and delete()
   * already refused in this case; the two row-creating writes now match.
   */
  async _insertScope(table) {
    if (!SmartBrainDbAdapter.scoped(table)) return { ok: true };
    const ws = await this.workspace();
    if (!ws) return { ok: false, refused: 'no_workspace', warning: `Supabase write ${table} refused: no workspace resolved, so the row would belong to no brand` };
    return { ok: true, ws };
  }
  async insert(table, rows) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    const scope = await this._insertScope(table);
    if (!scope.ok) return scope;
    const body = await this.stamp(table, rows);
    const r = await fetch(`${this.url}/rest/v1/${table}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!r.ok) return { ok: false, warning: `Supabase insert ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async upsert(table, rows, onConflict = 'id', { resolution = 'merge-duplicates' } = {}) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    // resolution='ignore-duplicates' makes an insert that NEVER overwrites an existing
    // row — used by syncDaily so a slot approved mid-window is not clobbered back to tentative.
    const headers = { ...this.headers(), Prefer: `return=representation,resolution=${resolution}` };
    const scope = await this._insertScope(table);
    if (!scope.ok) return scope;
    const body = await this.stamp(table, rows);
    const r = await fetch(`${this.url}/rest/v1/${table}?on_conflict=${onConflict}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) return { ok: false, warning: `Supabase upsert ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  /**
   * The workspace filter a write must carry, or a refusal.
   *
   * select() and stamp() were scoped and update()/delete() were not, which is
   * the half of the problem nobody sees: a PATCH filtered by `id=eq.<uuid>`
   * crosses brands exactly as freely as an unfiltered SELECT, and a DELETE does
   * it destructively. The id of another brand's row is all it takes, and both
   * come back 200 with a row count that looks right.
   */
  async _writeScope(table) {
    if (!SmartBrainDbAdapter.scoped(table)) return { ok: true };
    const ws = await this.workspace();
    if (!ws) return { ok: false, warning: `Supabase write ${table} refused: no workspace resolved, so the write could land on another brand's row` };
    return { ok: true, ws };
  }
  async update(table, filters, patch) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    const scope = await this._writeScope(table);
    if (!scope.ok) return scope;
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(filters || {})) search.set(k, v);
    if (scope.ws) search.set('workspace_id', `eq.${scope.ws}`);
    const r = await fetch(`${this.url}/rest/v1/${table}?${search}`, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(patch) });
    if (!r.ok) return { ok: false, warning: `Supabase update ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async delete(table, filters) {
    if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };
    const scope = await this._writeScope(table);
    if (!scope.ok) return scope;
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(filters || {})) search.set(k, v);
    // Guard: refuse an unfiltered DELETE (would wipe the table).
    if (![...search.keys()].length) return { ok: false, warning: `Supabase delete ${table} refused: no filters` };
    if (scope.ws) search.set('workspace_id', `eq.${scope.ws}`);
    const r = await fetch(`${this.url}/rest/v1/${table}?${search}`, { method: 'DELETE', headers: this.headers() });
    if (!r.ok) return { ok: false, warning: `Supabase delete ${table} failed: ${r.status} ${await r.text()}` };
    return { ok: true, rows: await r.json().catch(() => []) };
  }
  async ownData() {
    if (this.connected) {
      const t = this.config.tableNames;
      const [products, assets, campaigns, campaignAssets, campaignMetrics, users, ordersRead, events, mvtResults, feedback] = await Promise.all([
        this.select(t.products, { limit: 5000 }), this.select(t.assets, { limit: 5000 }),
        this.select(t.campaigns, { limit: 5000 }), this.select(t.campaignAssets, { limit: 10000 }),
        this.select(t.campaignMetrics, { limit: 20000 }), this.select(t.users, { limit: 20000 }),
        this.readOrderHistoryRows(), this.select(t.events, { limit: 50000 }),
        this.select(t.mvtResults, { limit: 5000 }).catch(() => []), this.select(t.feedback, { limit: 5000 }).catch(() => []),
      ]);
      // The smart_products table is empty in this deployment, which left the
      // planner with no product scores and a placeholder hero ("<Brand>
      // Assortment") instead of real catalogue items. Fall back to the BUILT
      // catalogue for tenant zero (real titles, handles, prices, types) so the
      // plan names actual products. Other brands never read this file: their
      // catalogue is their own offerings (see smart-brain-plan.js).
      // Only the OWNER of that file may fall back to it (2026-09-29, review):
      // an empty smart_products table for any other caller - a mobile+PIN
      // account with no workspace, or another brand's workspace - used to
      // plan over tenant zero's 436 products. The same helper that gates the
      // bundled sales export decides, so the two cannot disagree.
      let ownsBuilt = false;
      if (!(products && products.length)) {
        try { ownsBuilt = await require('../../api/_shared/market-analytics.js').ownsBundledExport(await this.workspace()); } catch (_) { ownsBuilt = false; }
      }
      const prods = (products && products.length) ? products : (ownsBuilt ? this.builtCatalogProducts() : []);
      // Orders are read ONCE, paged to the end (#141 review: one capped read
      // came back as 1,000 rows under the server's max_rows and was taken for
      // the whole table). The same rows serve the cohorts, the product scores
      // and the model, and the window travels with them.
      const orders = ordersRead.rows;
      const orderHistory = await this.orderHistory({ orders, products: prods, window: ordersRead.window });
      const engagement = await this.engagementContacts().catch(() => null);
      return { source: 'supabase', products: prods, assets, campaigns, campaignAssets, campaignMetrics, users, orders, events, mvtResults, feedback, orderHistory, engagement };
    }
    const local = this.localFallbackData();
    local.orderHistory = await this.orderHistory({ orders: local.orders, products: local.products });
    return local;
  }
  /**
   * Read a scoped table in pages, so a large table is read whole rather than
   * as whichever rows the first request returns. Ordered, because offset
   * paging over an unordered result can skip or repeat rows.
   *
   * The server decides how many rows a page holds, not the request: PostgREST
   * answers at most `max_rows` (1,000 in supabase/config.toml) whatever
   * `limit` asked for (#141 review). So the offset advances by the rows
   * actually RECEIVED, and only an EMPTY page ends the read - a short page is
   * as likely to be the server's cap as the end of the table.
   *
   * Stops at `maxRows` and reports whether that ceiling was actually hit (one
   * probe row past it), so a table of exactly `maxRows` rows is not called
   * truncated. A page that fails is reported as `error`, never read as the end.
   */
  async selectPaged(table, { order, pageSize = 1000, maxRows = 200000 } = {}) {
    const rows = [];
    try {
      while (rows.length < maxRows) {
        const limit = Math.min(pageSize, maxRows - rows.length);
        const page = await this.select(table, { limit, order, throwOnError: true, filters: rows.length ? { offset: String(rows.length) } : {} });
        if (!Array.isArray(page) || !page.length) return { rows, hitCeiling: false };
        rows.push(...page.slice(0, maxRows - rows.length));
      }
      const probe = await this.select(table, { limit: 1, order, throwOnError: true, filters: { offset: String(rows.length) } });
      return { rows, hitCeiling: Array.isArray(probe) && probe.length > 0 };
    } catch (e) {
      return { rows, hitCeiling: false, error: String((e && e.message) || e).slice(0, 200) };
    }
  }
  /**
   * Every synced order this workspace has, newest first, up to a ceiling
   * (config.replenishment.maxOrderRows, default 200,000). Review finding on
   * #135: this used to be ONE read with limit=20000 and no order, so a larger
   * brand was measured on an arbitrary subset and nothing said so. When the
   * ceiling IS hit, the oldest day read may be partial, so it is dropped: what
   * remains is a COMPLETE window from `complete_from`, and the analysis says
   * that orders before it were not read.
   */
  async readOrderHistoryRows() {
    const RM = require('../../api/_shared/replenishment-model.js');
    const cfg = (this.config && this.config.replenishment) || {};
    const read = await this.selectPaged(this.config.tableNames.orders, {
      order: 'created_at.desc,id.desc',
      pageSize: cfg.orderPageSize || 1000,
      maxRows: cfg.maxOrderRows || 200000,
    });
    if (!read.hitCeiling && !read.error) return { rows: read.rows, window: { truncated: false, complete_from: null, rows_read: read.rows.length } };
    // The ceiling was hit, or a page failed part-way: the newest rows read are
    // kept as a COMPLETE window (the oldest day may be partial, so it goes) and
    // the gap is stated. A read that failed on its first page has no window.
    let oldest = Infinity;
    for (const o of read.rows) { const d = RM.dayOf(o && o.created_at); if (d != null && d < oldest) oldest = d; }
    const rows = Number.isFinite(oldest) ? read.rows.filter((o) => { const d = RM.dayOf(o && o.created_at); return d != null && d > oldest; }) : [];
    return {
      rows,
      window: Object.assign(
        { truncated: true, complete_from: Number.isFinite(oldest) ? RM.isoOf(oldest + 1) : null, rows_read: read.rows.length },
        read.error ? { read_error: read.error } : {},
      ),
    };
  }
  /**
   * This workspace's contact evidence for trigger eligibility, keyed by
   * CUSTOMER id (review finding on #135).
   *
   * The evidence lives in subscriber_engagement_scores - the deliverability
   * layer's per-workspace table (opens, clicks, sends in 7 days, bounces,
   * complaints, suppression) - not in smart_users, which carries none of it.
   * Read through select(), so it is filtered to this workspace like every
   * scoped table: another brand's bounce never touches this brand's audience.
   *
   * Joined to a customer in two exact ways and no fuzzy one:
   *   1. the ESP profile id IS the customer id (a store customer id synced as
   *      the ESP's external id);
   *   2. the customer's email (from smart_users) hashed by the SAME
   *      cohort-engine.hashEmail() with the same workspace salt that wrote
   *      email_hash.
   * A customer neither join finds stays unchecked, and the slot says so.
   * Returns null when there is no workspace to read for.
   */
  async engagementContacts() {
    if (!this.connected) return null;
    const ws = await this.workspace();
    if (!ws) return null;
    const CE = require('../../api/_shared/cohort-engine.js');
    const cfg = (this.config && this.config.replenishment) || {};
    const paged = { pageSize: cfg.contactPageSize || 1000, maxRows: cfg.maxContactRows || 200000 };
    const engRead = await this.selectPaged('subscriber_engagement_scores', Object.assign({ order: 'id.asc' }, paged));
    const eng = engRead.rows;
    const map = new Map();
    const status = { rows: eng.length, truncated: !!(engRead.hitCeiling || engRead.error), read_error: engRead.error || null };
    if (!eng.length) return Object.assign({ map, via_profile_id: 0, via_email_hash: 0 }, status);
    // EVERY row a customer has, from every provider and through both joins,
    // merged by cohort-engine.mergeContactEvidence() - fail closed, and the
    // same answer whatever order the rows arrive in (#141 review: last row
    // won, so one provider's clean row could erase another's complaint).
    const byProfile = new Map();
    const byHash = new Map();
    const push = (m, k, r) => { const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); };
    for (const r of eng) {
      if (!r) continue;
      if (r.external_profile_id != null && r.external_profile_id !== '') push(byProfile, String(r.external_profile_id), r);
      if (r.email_hash) push(byHash, String(r.email_hash), r);
    }
    const evidence = new Map();
    for (const [id, rows] of byProfile) evidence.set(id, new Set(rows));
    const us = (await this.selectPaged(this.config.tableNames.users, Object.assign({ order: 'id.asc' }, paged))).rows;
    let viaHash = 0;
    for (const u of us) {
      if (!u || u.id == null) continue;
      const h = u.email_hash || (u.email ? CE.hashEmail(u.email, ws) : null);
      const hits = h ? byHash.get(String(h)) : null;
      if (!hits) continue;
      const id = String(u.id);
      const set = evidence.get(id) || new Set();
      for (const r of hits) set.add(r);
      evidence.set(id, set);
      viaHash += 1;
    }
    for (const [id, set] of evidence) map.set(id, CE.mergeContactEvidence([...set]));
    return Object.assign({ map, via_profile_id: byProfile.size, via_email_hash: viaHash }, status);
  }
  /**
   * The order history the replenishment model may read for THIS workspace.
   *
   * One door, three answers, in this order:
   *   1. the workspace's own synced orders (smart_orders, already filtered to
   *      this workspace by select());
   *   2. ONLY when that is empty AND market-analytics.ownsBundledExport() says
   *      this workspace is tenant zero: the order export compiled into this
   *      build - the same helper that gates the bundled sales export and the
   *      shipped catalogue, so the three can never be gated differently;
   *   3. otherwise the explicit no-history state.
   * A request that carries a person (a phone account, a signed-in user with
   * no workspace) gets 3: it is never asked about the bundled export at all,
   * because "no workspace" is not tenant zero - with or without a Supabase
   * project. A caller that already knows the brand is not tenant zero passes
   * `allowBundled: false` and is never asked either. Only a call with no person
   * in scope and no Supabase project (a script, a build step) takes the
   * helper's own documented single-tenant answer.
   */
  async orderHistory({ orders, products, allowBundled = true, window: given = null } = {}) {
    const RM = require('../../api/_shared/replenishment-model.js');
    let rows = orders;
    let window = given || { truncated: false, complete_from: null };
    if (rows === undefined) {
      if (this.connected) {
        const read = await this.readOrderHistoryRows();
        rows = read.rows;
        window = read.window;
      } else rows = [];
    }
    const own = RM.linesFromSmartOrders(rows || [], products || []);
    if (own.lines.length) return RM.history('workspace_orders', own, Object.assign({ label: 'This workspace\'s own synced orders (smart_orders)' }, window));
    let owns = false;
    if (allowBundled) {
      try {
        const mkt = require('../../api/_shared/market-analytics.js');
        if (this.connected) {
          const ws = await this.workspace();
          owns = ws ? await mkt.ownsBundledExport(ws) : false;
        } else {
          let person = false;
          try {
            const req = require('../../api/_shared/request-scope.js').currentRequest();
            person = !!(req && require('../../api/_shared/workspace-scope.js').requestHasUser(req));
          } catch (_) { person = false; }
          owns = person ? false : await mkt.ownsBundledExport();
        }
      } catch (_) { owns = false; }
    }
    if (owns) {
      const bundled = RM.loadBundledExport();
      if (bundled && bundled.lines.length) return bundled;
    }
    return RM.noHistory(owns
      ? `${RM.NO_HISTORY_MARKER} No synced orders, and the order export compiled into this build could not be read.`
      : `${RM.NO_HISTORY_MARKER} This workspace has no synced orders (smart_orders). Connect its store or import its order export; another brand's orders are never used.`);
  }
  /** Tenant zero's built catalogue (data/catalog/products_us.json), mapped to
   *  the smart_products shape the analysis service expects. */
  builtCatalogProducts() {
    if (this._builtCatalog) return this._builtCatalog;
    let rows = [];
    try {
      const p = path.join(process.cwd(), 'data', 'catalog', 'products_us.json');
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const list = Array.isArray(raw) ? raw : (raw.products || []);
      rows = list.filter(Boolean).map((x, i) => ({
        id: x.h || x.handle || `cat_${i}`,
        sku: x.sku || x.h || x.handle || `cat_${i}`,
        title: x.n || x.title || '',
        handle: x.h || x.handle || '',
        price: x.price != null ? x.price : null,
        category: (Array.isArray(x.t) && x.t[0]) || x.type || '',
        type: x.type || '',
        image: x.i || x.image || '',
        active: true,
      })).filter((x) => x.title);
    } catch (_) { rows = []; }
    this._builtCatalog = rows;
    return rows;
  }
  async competitorData() {
    if (this.connected) {
      const competitors = await this.select(this.config.tableNames.competitors, { limit: 5000, order: 'observed_at.desc' }).catch(() => []);
      return { source: 'supabase', competitors };
    }
    return { source: 'local-empty', competitors: [] };
  }
  localFallbackData() {
    const productsRaw = readCsvIfExists('input/uploaded_by_anchit/shopify_products.csv')
      .concat(readCsvIfExists('Knickgasm Product Catalog RegionWise/products_export_usa.csv'))
      .concat(readCsvIfExists('Knickgasm Product Catalog RegionWise/products_export_uk.csv'));
    const ordersRaw = readCsvIfExists('input/uploaded_by_anchit/shopify_orders.csv');
    const customersRaw = readCsvIfExists('input/uploaded_by_anchit/shopify_customers.csv');
    const campaignsRaw = readCsvIfExists('input/uploaded_by_anchit/klaviyo_campaigns.csv').concat(readCsvIfExists('data/klaviyo/campaigns.csv'));
    const products = productsRaw.slice(0, 500).map((p, i) => ({
      id: p.id || p.ID || p.Handle || `local_product_${i}`,
      sku: p.Variant_SKU || p['Variant SKU'] || p.SKU || p.Handle || `SKU-${i}`,
      title: p.Title || p.title || p.Name || p.Handle || `KNICKGASM Product ${i + 1}`,
      handle: p.Handle || p.handle || slug(p.Title || p.Name || `product-${i}`),
      category: p.Type || p['Product Category'] || p.Category || 'Sneaker & Streetwear',
      market: /uk/i.test(p.__file || '') ? 'UK' : 'US',
      price: num(p['Variant Price'] || p.Price || p.price, 0),
      tags: String(p.Tags || p.tags || '').split(',').map((x) => x.trim()).filter(Boolean),
    }));
    const campaigns = campaignsRaw.slice(0, 500).map((c, i) => ({
      id: c.id || c.Campaign_ID || c.Name || `local_campaign_${i}`,
      name: c.Name || c.Campaign || c.subject || c.Subject || `Lifecycle Campaign ${i + 1}`,
      channel: c.channel || c.Channel || 'email',
      market: c.market || c.Market || 'US',
      campaign_type: c.type || c.Type || 'lifecycle',
      subject: c.Subject || c.subject || c.Name || '',
      sent_at: c.Sent_At || c['Send Time'] || c.date || '',
      cohort_key: c.segment || c.Segment || 'All Customers',
    }));
    // No Supabase connection means no real performance metrics source. We do
    // NOT fabricate sends/opens/clicks/revenue — an empty metrics set is the
    // honest state (rollups compute to zero and campaigns simply don't clear
    // performance thresholds until real metrics are connected).
    const campaignMetrics = [];
    // User and order monetary fields come from the CSV only. When a column is
    // absent we leave the value at 0 (unknown) rather than inventing a spend or
    // order count from the row index.
    const users = customersRaw.slice(0, 1000).map((u, i) => ({
      id: u.id || u.ID || u.Email || `user_${i}`,
      email: u.Email || u.email || '',
      market: u.Country || u.country || 'US',
      total_spend: num(u['Total Spent'] || u.total_spend, 0),
      orders_count: num(u['Orders Count'] || u.orders_count, 0),
      last_order_at: u['Last Order Date'] || u.last_order_at || '',
      accepts_marketing: u['Accepts Marketing'] !== 'no',
      tags: String(u.Tags || '').split(',').map((x) => x.trim()).filter(Boolean),
    }));
    const orders = ordersRaw.slice(0, 2000).map((o, i) => ({
      id: o.id || o.Name || `order_${i}`,
      user_id: o.Customer_ID || o.Email || `user_${i % Math.max(users.length, 1)}`,
      market: o.Country || o['Shipping Country'] || 'US',
      total: num(o.Total || o['Total Price'] || o.Subtotal, 0),
      created_at: o.Created_At || o['Created at'] || o.created_at || '',
      product_sku: o.SKU || '',
    }));
    return { source: 'local-csv (no performance metrics)', products, assets: [], campaigns, campaignAssets: [], campaignMetrics, users, orders, events: [], mvtResults: [], feedback: [] };
  }
}

class KnowledgeBaseService {
  constructor(config) { this.config = config; }
  build(data) {
    const assetByCampaign = new Map();
    for (const ca of asArray(data.campaignAssets)) {
      const list = assetByCampaign.get(ca.campaign_id) || [];
      const asset = asArray(data.assets).find((a) => String(a.id) === String(ca.asset_id)) || ca;
      list.push(asset);
      assetByCampaign.set(ca.campaign_id, list);
    }
    const metricByCampaign = new Map();
    for (const m of asArray(data.campaignMetrics)) {
      const list = metricByCampaign.get(m.campaign_id) || [];
      list.push(normalizeMetric(m));
      metricByCampaign.set(m.campaign_id, list);
    }
    const indexedCampaigns = asArray(data.campaigns).map((c) => {
      const metrics = metricByCampaign.get(c.id) || [];
      const rollup = rollupMetrics(metrics);
      return {
        ...c,
        assets: assetByCampaign.get(c.id) || [],
        metrics,
        performance: rollup,
        hooks: extractHooks(c, assetByCampaign.get(c.id) || []),
        angles: extractAngles(c),
        formats: [...new Set((assetByCampaign.get(c.id) || []).map((a) => a.format || a.asset_type).filter(Boolean))],
      };
    });
    return {
      source: data.source,
      indexed_at: new Date().toISOString(),
      catalog: asArray(data.products),
      brandAssets: asArray(data.assets).filter((a) => /brand|logo|font|kit/i.test(`${a.asset_type || ''} ${a.tags || ''}`)),
      indexedCampaigns,
      userCount: asArray(data.users).length,
      orderCount: asArray(data.orders).length,
    };
  }
}

function normalizeMetric(m) {
  const sends = num(m.sends || m.recipients || m.delivered || m.impressions, 0);
  const impressions = num(m.impressions || sends, sends);
  const clicks = num(m.clicks, 0);
  const conversions = num(m.conversions || m.orders, 0);
  const spend = num(m.spend, 0);
  const revenue = num(m.revenue || m.attributed_revenue, 0);
  return {
    ...m,
    openRate: round(num(m.open_rate, num(m.opens, 0) / Math.max(sends, 1))),
    clickRate: round(num(m.click_rate || m.ctr, clicks / Math.max(impressions || sends, 1))),
    conversionRate: round(num(m.conversion_rate || m.cvr, conversions / Math.max(clicks || impressions || sends, 1))),
    revenuePerRecipient: round(revenue / Math.max(sends, 1)),
    // ROAS is undefined without spend (e.g. owned email) — report null (N/A),
    // never a sentinel like 999 that would masquerade as a real ratio.
    roas: spend > 0 ? round(revenue / spend, 2) : null,
    revenue,
    spend,
    sends,
    impressions,
    clicks,
    conversions,
  };
}

function rollupMetrics(metrics) {
  const total = metrics.reduce((a, m) => ({
    sends: a.sends + num(m.sends), impressions: a.impressions + num(m.impressions), clicks: a.clicks + num(m.clicks), conversions: a.conversions + num(m.conversions), revenue: a.revenue + num(m.revenue), spend: a.spend + num(m.spend), opens: a.opens + num(m.opens),
  }), { sends: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0, spend: 0, opens: 0 });
  return normalizeMetric(total);
}
function extractHooks(c, assets) {
  return [...new Set([c.subject, c.headline, c.hook, ...assets.map((a) => a.hook || a.alt || a.title)].filter(Boolean).map(String).slice(0, 8))];
}
function extractAngles(c) {
  const text = `${c.name || ''} ${c.subject || ''} ${c.campaign_type || ''}`.toLowerCase();
  return ['gift', 'anime', 'football', 'sport', 'gaming', 'wedding', 'pets', 'bling', 'air force', 'jordan', 'accessories', 'sale', 'holiday', 'drop'].filter((x) => text.includes(x));
}

class AnalysisService {
  constructor(config) { this.config = config; }
  analyze(kb, data) {
    const cohorts = buildCohorts(data.users, data.orders);
    const winningCampaigns = kb.indexedCampaigns.filter((c) => campaignClearsThreshold(c, this.config.performanceThresholds));
    const productScores = scoreProducts(kb.catalog, data.orders, winningCampaigns);
    const channelBenchmarks = buildChannelBenchmarks(kb.indexedCampaigns);
    const mvtLearnings = summarizeMvt(data.mvtResults);
    const replenishment = analyseReplenishment(data);
    return {
      analyzed_at: new Date().toISOString(),
      thresholds: this.config.performanceThresholds,
      cohorts,
      winningCampaigns,
      productScores,
      channelBenchmarks,
      mvtLearnings,
      replenishment,
      dailyInsights: buildDailyInsights({ cohorts, winningCampaigns, productScores, channelBenchmarks, mvtLearnings, replenishment }),
    };
  }
}

/**
 * Repurchase intervals from this data's own order history (replenishment-model.js).
 *
 * `data.orderHistory` is what SmartBrainDbAdapter.orderHistory() resolved - the
 * workspace's own orders, tenant zero's bundled export behind
 * ownsBundledExport(), or the no-history state. A caller that assembled `data`
 * itself gets its own `orders` read the same way (never the bundled export:
 * only the adapter's gate may hand that out). Contacts are attached so the
 * planner can apply the engagement tiers and the cross-channel cap per person.
 */
function analyseReplenishment(data) {
  try {
    const RM = require('../../api/_shared/replenishment-model.js');
    const hist = data && data.orderHistory
      ? data.orderHistory
      : (() => {
        const read = RM.linesFromSmartOrders((data && data.orders) || [], (data && data.products) || []);
        return read.lines.length ? RM.history('workspace_orders', read) : RM.noHistory();
      })();
    // Eligibility evidence comes from subscriber_engagement_scores (the
    // deliverability layer's per-workspace table), joined to customers by
    // engagementContacts(). smart_users carries none of those fields, so a
    // DB-backed run never decides eligibility from it; a caller that assembled
    // `data` itself (no adapter) may hand rows that carry their own evidence.
    const contacts = data && data.engagement ? data.engagement.map : ((data && data.users) || []);
    return RM.analyse(hist, { contacts });
  } catch (e) {
    // The model is additive: a failure here must never take the plan down,
    // and it must not read as "no history" either.
    return { state: 'error', error: String((e && e.message) || e).slice(0, 200), products: [], note: 'The replenishment model could not run; no trigger is planned.' };
  }
}

function campaignClearsThreshold(c, thresholds) {
  const channel = String(c.channel || 'email').toLowerCase();
  const t = thresholds[channel] || thresholds.email;
  const p = c.performance || {};
  if (channel === 'email') return p.openRate >= t.openRate && p.clickRate >= t.clickRate && (p.conversionRate >= t.conversionRate || p.revenuePerRecipient >= t.revenuePerRecipient);
  return p.clickRate >= (t.ctr || 0) && p.conversionRate >= (t.cvr || 0) && p.roas >= (t.roas || 0);
}
function daysSince(dateish) {
  const t = new Date(dateish || 0).getTime();
  if (!t) return 9999;
  return Math.floor((Date.now() - t) / 86400000);
}
function cohortName(u) {
  const recency = daysSince(u.last_order_at || u.last_seen_at);
  const spend = num(u.total_spend || u.lifetime_value);
  const orders = num(u.orders_count || u.order_count);
  if (orders >= 4 && recency <= 90 && spend >= 180) return 'Champions';
  if (orders >= 3 && recency <= 120) return 'Loyalists';
  if (orders <= 1 && recency <= 45) return 'New Buyers';
  if (recency > 180 && spend >= 100) return 'Winback High-LTV';
  if (recency > 120) return 'At-Risk';
  return 'Nurture';
}
function buildCohorts(users, orders) {
  const byUser = new Map();
  for (const u of asArray(users)) byUser.set(String(u.id || u.email), { ...u });
  for (const o of asArray(orders)) {
    const id = String(o.user_id || o.customer_id || o.email || 'unknown');
    const u = byUser.get(id) || { id, market: o.market, total_spend: 0, orders_count: 0 };
    u.total_spend = num(u.total_spend) + num(o.total);
    u.orders_count = num(u.orders_count) + 1;
    if (!u.last_order_at || new Date(o.created_at) > new Date(u.last_order_at)) u.last_order_at = o.created_at;
    byUser.set(id, u);
  }
  const grouped = new Map();
  for (const u of byUser.values()) {
    const name = cohortName(u);
    const g = grouped.get(name) || { name, count: 0, revenue: 0, markets: {}, rules: [] };
    g.count += 1; g.revenue += num(u.total_spend || u.lifetime_value);
    const market = norm(u.market || u.country || 'Global');
    g.markets[market] = (g.markets[market] || 0) + 1;
    grouped.set(name, g);
  }
  return [...grouped.values()].map((g) => ({ ...g, revenue: round(g.revenue, 2), avgLtv: round(g.revenue / Math.max(g.count, 1), 2), rules: cohortRules(g.name) })).sort((a, b) => b.revenue - a.revenue);
}
function cohortRules(name) {
  const map = {
    Champions: ['orders_count >= 4', 'last_order_at <= 90 days', 'total_spend >= premium threshold'],
    Loyalists: ['orders_count >= 3', 'last_order_at <= 120 days'],
    'New Buyers': ['orders_count <= 1', 'first/last order <= 45 days'],
    'Winback High-LTV': ['last_order_at > 180 days', 'total_spend >= high-LTV threshold'],
    'At-Risk': ['last_order_at > 120 days'],
    Nurture: ['all remaining opted-in profiles'],
  };
  return map[name] || [];
}
function scoreProducts(products, orders, winningCampaigns) {
  const score = new Map();
  for (const p of asArray(products)) score.set(p.sku || p.id, { product: p, orderCount: 0, revenue: 0, winningMentions: 0, score: 0 });
  for (const o of asArray(orders)) {
    const key = o.product_sku || o.sku || o.variant_sku;
    if (!score.has(key)) continue;
    const s = score.get(key); s.orderCount += 1; s.revenue += num(o.total || o.line_total);
  }
  for (const c of asArray(winningCampaigns)) {
    const key = c.hero_sku || c.product_sku;
    if (score.has(key)) score.get(key).winningMentions += 1;
  }
  return [...score.values()].map((s) => ({ ...s, score: round(s.orderCount * 1.5 + s.revenue / 100 + s.winningMentions * 10, 2) })).sort((a, b) => b.score - a.score).slice(0, 50);
}
function buildChannelBenchmarks(campaigns) {
  const groups = {};
  for (const c of asArray(campaigns)) {
    const ch = String(c.channel || 'email').toLowerCase();
    groups[ch] ||= [];
    groups[ch].push(c.performance || {});
  }
  return Object.fromEntries(Object.entries(groups).map(([ch, ms]) => [ch, {
    count: ms.length,
    avgClickRate: round(ms.reduce((a, m) => a + num(m.clickRate), 0) / Math.max(ms.length, 1)),
    avgConversionRate: round(ms.reduce((a, m) => a + num(m.conversionRate), 0) / Math.max(ms.length, 1)),
    // Only campaigns with spend have a ROAS; average over those, null if none.
    avgRoas: (() => {
      const withRoas = ms.filter((m) => Number.isFinite(m.roas));
      return withRoas.length ? round(withRoas.reduce((a, m) => a + Math.min(m.roas, 20), 0) / withRoas.length, 2) : null;
    })(),
  }]));
}
function summarizeMvt(rows) {
  return asArray(rows).map((r) => ({ variable: r.variable || r.test_name, winner: r.winner || r.winning_variant, lift: num(r.lift || r.relative_lift), confidence: num(r.confidence, 0.5) })).filter((r) => r.confidence >= 0.7).slice(0, 25);
}
function buildDailyInsights({ cohorts, winningCampaigns, productScores, mvtLearnings, replenishment }) {
  const out = [
    `${winningCampaigns.length} own campaigns clear current performance thresholds and are eligible for creative reuse.`,
    `Top cohort by revenue is ${cohorts[0]?.name || 'N/A'} (${cohorts[0]?.count || 0} profiles).`,
    `Highest-scored hero product is ${productScores[0]?.product?.title || 'N/A'}.`,
    `${mvtLearnings.length} statistically useful MVT learnings are active in generation rules.`,
  ];
  if (replenishment && replenishment.state && replenishment.state !== 'error') {
    try { const line = require('../../api/_shared/replenishment-model.js').insight(replenishment); if (line) out.push(line); } catch (_) { /* additive */ }
  }
  return out;
}

class CompetitorBenchmarkingService {
  constructor(config) { this.config = config; }
  benchmark(data) {
    const competitors = asArray(data.competitors).map((c) => ({ ...c, channel: String(c.channel || c.campaign_type || 'unknown').toLowerCase() }));
    const byChannel = {};
    const hooks = {};
    for (const c of competitors) {
      byChannel[c.channel] ||= { count: 0, activeBrands: new Set(), formats: {} };
      byChannel[c.channel].count += 1;
      if (c.brand) byChannel[c.channel].activeBrands.add(c.brand);
      const fmt = c.format || c.asset_type || 'unknown';
      byChannel[c.channel].formats[fmt] = (byChannel[c.channel].formats[fmt] || 0) + 1;
      for (const h of [c.hook, c.headline, c.subject].filter(Boolean)) hooks[h] = (hooks[h] || 0) + 1;
    }
    return {
      source: data.source,
      isolated: true,
      observed_at: new Date().toISOString(),
      byChannel: Object.fromEntries(Object.entries(byChannel).map(([k, v]) => [k, { ...v, activeBrands: [...v.activeBrands] }])),
      trendingHooks: Object.entries(hooks).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([hook, count]) => ({ hook, count })),
      note: 'Competitive benchmarks inform prioritization only; they are not used to qualify own campaign-library winners.',
    };
  }
}

/**
 * The hero used when a brand's analysis carries no product scores at all.
 *
 * It is a MARKER, not a product: it names the gap, the brand it belongs to and
 * that it spans every market, and it carries `placeholder:true` so anything
 * downstream can refuse to ship it. It deliberately reads as unusable — an
 * operator who sees it in a subject line knows immediately that the catalogue
 * was never wired, which a plausible-looking invented product name would hide.
 */
function placeholderHero(brand) {
  const name = (brand && brand.name) ? String(brand.name) : 'all';
  return {
    product: {
      title: `[DATA REQUIRED BEFORE LAUNCH: product catalogue, ${name}, all markets]`,
      sku: null, handle: null, category: null, placeholder: true,
    },
    score: 0,
  };
}

/**
 * Every read of a slot's hero title goes through here.
 *
 * `entry.heroProduct.title` threw a bare TypeError on a slot planned without a
 * hero, which killed the whole generation with a message that named neither the
 * brand nor the missing data. A generation that cannot name its hero must still
 * produce an asset that SAYS so.
 */
function heroTitleOf(entry) {
  const t = entry && entry.heroProduct && entry.heroProduct.title;
  if (t) return String(t);
  const brandName = (entry && entry.brand && entry.brand.name) || 'all';
  const market = (entry && entry.market) || 'all';
  return `[DATA REQUIRED BEFORE LAUNCH: hero product, ${brandName}, ${market}]`;
}

class CalendarIntelligenceService {
  constructor(config) { this.config = config; this.festivals = loadFestivals(); }
  generate({ analysis, competitorBenchmarks, startDate = todayIso(), days = this.config.calendarDays, feedback = [], brand = null, contactLedger = null }) {
    const entries = [];
    // The brand's contact rules (or the stated defaults): the caps below and
    // every slot's eligibility are judged against these numbers.
    const contactRules = fatigue.normaliseRules(contactLedger && contactLedger.rules).rules;
    const cohorts = analysis.cohorts.length ? analysis.cohorts : [{ name: 'Nurture', count: 0 }];
    // WHOSE PRODUCT IS THIS? The fallback here used to be a literal tenant-zero
    // assortment, so a brand whose analysis carried no product scores got a
    // 90-day calendar in which every slot in every market planned a campaign
    // for another company's product — named in the slot title, the subject
    // line, the ad copy and the landing page. A missing catalogue is a DATA
    // GAP, and this repo states data gaps rather than borrowing a value.
    const products = analysis.productScores.length ? analysis.productScores : [placeholderHero(brand)];
    const winners = analysis.winningCampaigns;
    const feedbackMap = summarizeFeedback(feedback);
    // 3-4 distinct cohorts per day per market (config.cohortsPerDay). Cohort +
    // product picks rotate on an ABSOLUTE day number (not the offset from a
    // moving startDate) so a given calendar date always resolves to the SAME
    // cohorts across daily syncs → stable ids, no churn.
    const perDay = Math.max(1, Math.min(this.config.cohortsPerDay || 3, cohorts.length));
    const fq = this.config.frequency || {};
    for (let d = 0; d < days; d++) {
      const date = addDays(startDate, d);
      const epoch = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) || d;
      for (const market of this.config.markets) {
        const festival = festivalOn(this.festivals, market, date);
        for (let k = 0; k < perDay; k++) {
          const cohort = cohorts[(epoch + k) % cohorts.length];
          // Vary the hero per cohort-slot (k) with a stride coprime-ish to the
          // catalog size so 4 same-day sends don't all share one hero.
          const product = products[(epoch + k + market.length) % products.length].product;
          // 1-2 supporting products for a bundle, distinct from the hero.
          const supporting = [1, 2]
            .map((o) => products[(epoch + k + o) % products.length].product)
            .filter((p) => (p.sku || p.id) !== (product.sku || product.id))
            .filter((p, i, a) => a.findIndex((q) => (q.sku || q.id) === (p.sku || p.id)) === i)
            .slice(0, 2);
          const winningTemplate = winners[(epoch + k + entries.length) % Math.max(winners.length, 1)] || null;

          // Every slot ships the FULL funnel so no asset is ever missing from a
          // preview/approval: mailer + Meta + Google + TikTok ads + landing page.
          const channels = ['email', 'meta', 'google', 'tiktok', 'landing_page'];
          const objective = objectiveFor(cohort.name, festival);
          const offer = offerDecision(cohort.name, objective, brand);
          // Reach plan: aim each send at min..target real recipients. If the core
          // cohort is smaller than the floor, the send widens to adjacent/broad
          // audiences at ESP time to still reach the minimum.
          const minR = fq.minRecipientsPerSend || 20000;
          const targetR = fq.targetRecipientsPerSend || 30000;
          const cohortSize = cohort.count || 0;
          // Zero-fabrication reach: only report a recipient count when a REAL
          // cohort base is present. With no ESP/Klaviyo feed wired (blocker B3)
          // the true eligible count is unknown, so planned_recipients stays null
          // and the note flags the data dependency instead of inventing ~20k.
          const hasRealBase = cohortSize > 0;
          const reach = {
            cohort_size: hasRealBase ? cohortSize : null,
            cohort_size_estimated: !hasRealBase,
            min_recipients: minR,
            target_recipients: targetR,
            planned_recipients: hasRealBase ? Math.min(cohortSize, targetR) : null,
            meets_floor_from_core: hasRealBase ? cohortSize >= minR : false,
            // The cadence target, never above the policy's absolute cap.
            per_user_per_week: {
              min: Math.min(fq.minPerUserPerWeek || 2, contactRules.absolute_per_7d),
              max: Math.min(fq.maxPerUserPerWeek || contactRules.absolute_per_7d, contactRules.absolute_per_7d),
            },
            // Filled by the plan-time pass below (contact-fatigue.planCaps) per
            // (market, cohort); per-PERSON capping across channels is the
            // slot's `eligibility`, judged against the contact ledger.
            frequency_cap: { per_rolling_7d: contactRules.promotional_per_7d, absolute_max: contactRules.absolute_per_7d, sends_in_rolling_7d: null, over_preferred: false, over_cap: false, status: null, window_complete: null, enforced_at: 'plan-time per-(market,cohort) check + per-person contact ledger (eligibility) + preflight at dispatch' },
            widen_note: hasRealBase
              ? (cohortSize >= minR
                ? 'Core cohort alone meets the recipient floor.'
                : `Core cohort (${cohortSize}) is below the ${minR} floor; widen to adjacent/broad audiences at ESP to reach the minimum.`)
              : `[DATA REQUIRED BEFORE LAUNCH: real eligible-segment size for "${cohort.name}" in ${market}. Wire the ESP/Klaviyo feed (B3); reach is not estimated to avoid fabrication.]`,
          };
          // Revenue feasibility per slot. A send's projected revenue = real
          // recipients × blended revenue-per-recipient, compared to this slot's
          // share of the daily target. Tiny cohorts (the honest reality without a
          // wider eligible base) are flagged, never silently treated as viable.
          const rpr = this.config.revenuePerRecipient || 0.06;
          const dailyTarget = dailyRevenueTargetFor(market);
          const perSendTarget = round((dailyTarget / Math.max(1, this.config.cohortsPerDay || 3)), 0);
          const projectedRevenue = hasRealBase ? round(cohortSize * rpr, 2) : null;
          const feasibility = {
            daily_target: dailyTarget,
            per_send_target: perSendTarget,
            projected_revenue: projectedRevenue,
            currency: 'USD',
            status: !hasRealBase
              ? 'DATA REQUIRED'
              : (projectedRevenue >= perSendTarget
                ? 'FEASIBLE'
                : ((cohortSize >= minR * 0.25 || projectedRevenue >= perSendTarget * 0.5)
                  ? 'REQUIRES MORE ELIGIBLE REACH'
                  : 'NOT FEASIBLE')),
            note: hasRealBase
              ? `~${cohortSize} recipients × $${rpr}/recipient ≈ $${projectedRevenue} vs ~$${perSendTarget}/send (${market} target $${dailyTarget}/day).`
              : `No real eligible-segment size yet (wire the ESP feed, B3). ${market} daily target $${dailyTarget}.`,
          };
          const mvtPlan = buildMvtPlan(analysis.mvtLearnings, channels);
          const competitorCtx = competitorContext(competitorBenchmarks, channels);
          // Confidence VARIES per slot from real signals (no flat 0.70). The old
          // model gave every row the winner bonus + nothing else, so scores
          // collapsed to base+0.18. Now graduated cohort reach (which honestly
          // PENALISES thin cohorts), product score, festival weight and offer
          // depth spread the score across its true range.
          const pscore = products.find((p) => (p.product && (p.product.sku || p.product.id)) === (product.sku || product.id))?.score;
          const conf = explainConfidence([
            { when: !!winningTemplate, label: 'Informed by a prior own-campaign winner', delta: 0.10, detail: winningTemplate ? `Patterns from "${winningTemplate.name}".` : '' },
            { when: (festival?.weight >= 7), label: 'High-weight festival window', delta: 0.08, detail: festival ? `Timed to ${festival.name} (weight ${festival.weight}).` : '' },
            { when: (festival && festival.weight >= 4 && festival.weight < 7), label: 'Seasonal window', delta: 0.04, detail: festival ? `Aligned to ${festival.name}.` : '' },
            { when: (cohortSize >= 5000), label: 'Large addressable cohort', delta: 0.10, detail: `${cohortSize} profiles gives statistically stable reach.` },
            { when: (cohortSize >= 1000 && cohortSize < 5000), label: 'Solid cohort size', delta: 0.06, detail: `${cohortSize} profiles is a workable base.` },
            { when: (cohortSize > 0 && cohortSize < 100), label: 'Thin cohort — low statistical reach', delta: -0.10, detail: `${cohortSize} profiles is well below a viable send size.` },
            { when: (typeof pscore === 'number' && pscore >= 0.8), label: 'Top-scored hero product', delta: 0.08, detail: `Hero product scores ${round(pscore, 2)} on the affinity model.` },
            { when: (typeof pscore === 'number' && pscore > 0 && pscore < 0.4), label: 'Lower-scored hero product', delta: -0.05, detail: `Hero product scores only ${round(pscore, 2)}.` },
            { when: (offer && offer.pct >= 0.15), label: 'At-cap incentive', delta: 0.04, detail: `${Math.round((offer.pct || 0) * 100)}% offer is the strongest allowed nudge.` },
            { when: (feedbackMap.positive > feedbackMap.negative), label: 'Positive reviewer feedback trend', delta: 0.06, detail: 'Recent human approvals outweigh rejections for similar slots.' },
          ]);
          const analysisObj = buildEntryAnalysis({
            cohort: { name: cohort.name, size: cohort.count },
            product: { title: product.title, sku: product.sku || product.id, score: products.find((p) => (p.product && (p.product.sku || p.product.id)) === (product.sku || product.id))?.score, category: product.category },
            festival,
            ownCampaign: winningTemplate ? { name: winningTemplate.name, performance: winningTemplate.performance } : null,
            competitor: competitorCtx,
            mvt: mvtPlan,
            channels,
            objective,
            market,
            confidence: conf,
            dataSource: analysis.source || 'preview',
            feedback: feedbackMap,
          });
          // Full "why this decision" object for the per-row decision panel.
          const decision = buildDecision({ cohort, product, supporting, festival, objective, offer, market, reach });

          entries.push({
            id: idFor('cal', { date, market, cohort: cohort.name }),
            date,
            market,
            status: 'needs_human_verification',
            confidence: conf.score,
            cohort: { name: cohort.name, size: cohort.count, rules: cohort.rules || [] },
            reach,
            feasibility,
            mailer_index: k + 1,
            mailer_total: perDay,
            channels,
            objective,
            offer,
            festival: festival ? { name: festival.name, weight: festival.weight, tags: festival.tags || [] } : null,
            // `placeholder` travels with the hero. Without it the only way to
            // tell a real product from a stated data gap is to string-match the
            // marker out of the title, which every consumer would have to get
            // right independently.
            heroProduct: {
              // `|| null`, not bare `||`: these rows are stored as jsonb, and an
              // undefined key disappears on serialisation, so a consumer cannot
              // tell "no sku" from "field never existed".
              sku: product.sku || product.id || null, title: product.title,
              handle: product.handle, category: product.category,
              ...(product.placeholder ? { placeholder: true } : {}),
            },
            supportingProducts: supporting.map((p) => ({ sku: p.sku || p.id, title: p.title, handle: p.handle, category: p.category })),
            ownDataReference: winningTemplate ? { campaign_id: winningTemplate.id, name: winningTemplate.name, hooks: winningTemplate.hooks, performance: winningTemplate.performance } : null,
            // The EVIDENCE the copywriter is briefed with (creative-evidence.js).
            // `ownDataReference` is one rotating winner, chosen to vary the
            // rationale between slots; that made a fine citation and a poor
            // brief. A writer needs the SET — enough campaigns to see a pattern,
            // and enough spread to tell a strong angle from a tiring one, which
            // is why the below-median tail is included rather than filtered out
            // here. Trimmed to keep the ~180-slot prebuild payload small.
            ownEvidence: winners.length
              ? { campaigns: winners.slice(0, 8).map((c) => ({ campaign_id: c.id, name: c.name, hooks: c.hooks, performance: c.performance })) }
              : null,
            competitorContext: competitorCtx,
            mvtPlan,
            rationale: buildCalendarRationale({ cohort, product, festival, winningTemplate }),
            analysis: analysisObj,
            decision,
          });
        }
      }
    }
    // Low-rated-product review recovery: if any product has a REAL rating below
    // the threshold (3.5), also schedule a review-invitation send to the
    // finished-packet, last-order cohort for that product. Fires only when real
    // rating data is present (productScores carry a rating) — never invents a
    // low rating or a send.
    if (reviewRecovery) {
      try {
        const extra = reviewRecovery.reviewRecoverySlots({ productScores: analysis.productScores || [], markets: this.config.markets, startDate, idFor });
        if (extra.length) entries.push(...extra);
      } catch (_) { /* review recovery is additive; never break the base plan */ }
    }
    // Plan-time frequency cap (spec §10): preferred 2, absolute 3 marketing
    // sends per (market, cohort) per rolling 7 days, with the spec's own
    // statuses (SAFE / REDUCE_AUDIENCE / BLOCKED) on every slot. Computed by
    // contact-fatigue.planCaps, the same pass the mailer calendar and the V1
    // plan use, so the three planners cannot count differently.
    //
    // WHAT COUNTS (2026-10-04). Until today a slot counted only if it CARRIED
    // A DISCOUNT; a nurture send with none "did not count toward the cap", so
    // a cohort could be planned daily with every slot SAFE. Spec §10: caps
    // apply to promotional AND lifecycle marketing, excluding transactional
    // only - so every scheduled send counts, and a review invitation counts as
    // triggered lifecycle. (The discount decision still drives the offer; it
    // no longer decides whether a person is being contacted.)
    //
    // WINDOW EDGE. The count only sees slots inside THIS plan, so a slot in the
    // first six days has an incomplete look-back; `window_complete` says so.
    // History from before the window is the contact ledger's job: each slot's
    // `eligibility` below.
    applyContactPolicy(entries, contactLedger, contactRules, startDate, this.config);
    return { generated_at: new Date().toISOString(), start_date: startDate, days, entries, review: { dailyAutomation: true, weeklyHumanRecalibrationRequired: true } };
  }
}
/** A calendar slot as the contact policy reads it. */
function contactSlotOf(e) {
  const size = e && e.cohort && Number(e.cohort.size) > 0 && e.cohort.estimated !== true ? Number(e.cohort.size) : null;
  return {
    date: e.date,
    // A Smart Brain slot carries a date, not a send time: it is judged at
    // 09:00 UTC on that date, and says so.
    at: `${e.date}T09:00:00Z`,
    time_basis: 'the slot date at 09:00 UTC (a Smart Brain slot carries no send time)',
    market: e.market,
    cohort_key: (e.cohort && e.cohort.name) || '',
    cohort_size: size,
    channel: 'email',
    message_class: e.message_class || (e.review_recovery ? 'triggered-lifecycle' : 'promotional'),
  };
}

/**
 * The plan-time cap and the per-slot eligibility, applied to a finished list
 * of slots. Exported so the offering-plan path in smart-brain-plan.js, which
 * builds its slots without this service, is held to the same policy.
 */
function applyContactPolicy(entries, contactLedger, rules, startDate, config) {
  const list = Array.isArray(entries) ? entries : [];
  const r = fatigue.normaliseRules(rules || (contactLedger && contactLedger.rules)).rules;
  const slots = list.map(contactSlotOf);
  const caps = fatigue.planCaps(slots, r, { planStart: startDate });
  const ctx = contactLedger || { available: false, reason: 'not_supplied', note: 'no contact ledger was supplied to this plan' };
  const elig = fatigue.eligibilityForPlan(slots, Object.assign({}, ctx, { rules: r }));
  const fq = (config && config.frequency) || {};
  const targetR = fq.targetRecipientsPerSend || 30000;
  list.forEach((e, i) => {
    if (!e.reach) e.reach = {};
    e.reach.frequency_cap = Object.assign(e.reach.frequency_cap || {}, caps[i]);
    e.message_class = slots[i].message_class;
    const el = elig[i];
    e.reach.eligibility = Object.assign(el, { label: fatigue.eligibilityLabel(el) });
    // Planned recipients are ELIGIBLE recipients: a count from the ledger,
    // never the cohort's size standing in for it. Unknown stays null.
    const eligible = el && el.status === 'computed' && Number.isFinite(el.eligible) ? el.eligible : null;
    e.reach.planned_recipients = eligible != null ? Math.min(eligible, targetR) : null;
    if (e.feasibility && e.feasibility.status !== 'DATA REQUIRED') {
      if (eligible != null) {
        const rpr = (config && config.revenuePerRecipient) || 0.06;
        const proj = round(eligible * rpr, 2);
        const per = e.feasibility.per_send_target;
        e.feasibility.projected_revenue = proj;
        e.feasibility.status = proj >= per ? 'FEASIBLE' : (proj >= per * 0.5 ? 'REQUIRES MORE ELIGIBLE REACH' : 'NOT FEASIBLE');
        e.feasibility.note = `~${eligible} eligible recipients (after the contact rules) × $${rpr}/recipient ≈ $${proj} vs ~$${per}/send.`;
      } else {
        e.feasibility.note = `${e.feasibility.note || ''} A ceiling, not a forecast: it assumes every profile in the cohort is eligible, and eligibility is unknown (${el ? el.label : 'no contact ledger'}).`.trim();
      }
    }
  });
  return list;
}

function festivalOn(festivals, market, date) {
  const mmdd = date.slice(5);
  return [...(festivals[market] || []), ...(festivals.Global || [])].find((f) => f.date === mmdd || f.date_iso === date) || null;
}
/**
 * Cohort → campaign objective.
 *
 * THE DEFECT THIS REPLACES. The old test was `/winback|at-risk/i`, with a
 * hyphen. `rfm-core.segmentFor()` — the function that actually names this
 * repo's cohorts — emits "At Risk" with a SPACE, so it never matched. Nor did
 * "Can't Lose Them", "Hibernating", "Lost", "About to Sleep", "Need Attention"
 * or "Promising", because none of them contain the four literals that were
 * tested for. Eight of the eleven canonical segments fell through to the
 * default, and the default is the objective for somebody who has never bought.
 *
 * The cost was not cosmetic: it briefs the copywriter, picks the offer depth
 * and shapes every asset on the slot. A customer three months from churning was
 * being sent an introduction to the brand, while the reviewer saw a plausible
 * campaign and approved it.
 *
 * Ordered most-specific first, and matched on the segment's own words rather
 * than on punctuation. Names the app does not produce still land on the
 * education default, which is the right answer for an unknown audience.
 */
const OBJECTIVES = [
  // A replenishment TRIGGER (replenishment-model.js): the customer's own
  // purchase history says they are about to buy again. First, because the
  // name says exactly what the job is and nothing below should re-read it.
  // A one-order customer's next order is Order #2 - the second-order job;
  // anyone who has already bought twice is replenishing.
  [/^replenishment due: second order\b/i, 'second-order activation'],
  [/^replenishment due\b/i, 'replenishment'],
  // Was a good customer and has now gone quiet. The highest-value save there is.
  [/can'?t lose|cannot lose/i, 'high-value reactivation'],
  // Lapsed or lapsing buyers. They know the brand; the job is to bring them back.
  [/winback|win-back|at[-\s]?risk|hibernat|lapsed|dormant/i, 'reactivation and replenishment'],
  [/lost|churn/i, 'last-chance reactivation'],
  // Still active but the gap between orders is stretching. Cheaper to hold than
  // to win back, so it gets its own objective rather than being lumped in above.
  [/about to sleep|need[s]? attention|slipping|declining/i, 'pre-lapse retention'],
  // Bought once, or nearly. The whole job is order two.
  //
  // Ahead of the loyalty rule on purpose: "Potential Loyalist" contains
  // "Loyal", and matching it there would brief a recent, mid-frequency buyer
  // with a premium bundle expansion — an upsell aimed at someone who has not
  // yet formed the habit being upsold.
  [/new|promising|potential/i, 'second-order activation'],
  // Best customers. Expansion, not discounting.
  [/champion|loyal/i, 'premium bundle expansion'],
];

function objectiveFor(cohort, festival) {
  if (festival) return 'seasonal conversion moment';
  const name = String(cohort || '');
  for (const [re, objective] of OBJECTIVES) if (re.test(name)) return objective;
  // Never purchased, engaged non-buyers, prospects, and anything unrecognised.
  return 'education-led conversion';
}
/* ── replenishment slots ───────────────────────────────────────────────────── */

/** The two trigger cohorts. Names are matched by OBJECTIVES above and by the
 *  offer guardrails' replenishment slot, and they key the frequency cap. */
const REPLENISHMENT_COHORT_NAMES = { second_order: 'Replenishment due: second order', repeat: 'Replenishment due: repeat' };

/** A trigger slot's product: one this audience last bought in the slot's
 *  product group, named from the brand's own catalogue when it lists that SKU,
 *  else from the brand's own order line, else a marker. Never another product. */
function replenishmentHero(top, market, catalog) {
  if (!top) return { sku: null, title: `[DATA REQUIRED BEFORE LAUNCH: product, replenishment due, ${market}]`, handle: null, category: null, placeholder: true };
  const rows = asArray(catalog).map((x) => (x && x.product) || x).filter(Boolean);
  const hit = top.sku ? rows.find((p) => [p.sku, p.handle, p.id].some((k) => k != null && String(k) === String(top.sku))) : null;
  if (hit && hit.title) return { sku: hit.sku || hit.id || top.sku, title: hit.title, handle: hit.handle || null, category: hit.category || top.type || null };
  if (top.title) return { sku: top.sku || null, title: top.title, handle: null, category: top.type || null };
  return { sku: top.sku || null, title: `[DATA REQUIRED BEFORE LAUNCH: product title, ${top.sku || top.type}, ${market}]`, handle: null, category: top.type || null, placeholder: true };
}

/**
 * Turn the customers a replenishment analysis says are due inside
 * [startDate, startDate + days) into calendar slots: one per market, per week,
 * per trigger cohort (second order / repeat). Each slot carries the evidence -
 * the product, n, the median interval, the lead time and why - so a reviewer
 * reads the measurement, not a claim.
 *
 * The audience is EXACTLY the due customers who pass the engagement tiers and
 * the cross-channel cap (cohort-engine.triggerEligibility). It is never widened
 * to reach a broadcast floor: widening a trigger mails people who are not due.
 */
function replenishmentEntries({ replenishment, startDate, days, markets, brand = null, config = smartConfig(), catalog = [], festivals = null, winners = [], mvtLearnings = [], competitorBenchmarks = null } = {}) {
  const RM = require('../../api/_shared/replenishment-model.js');
  const CE = require('../../api/_shared/cohort-engine.js');
  if (!replenishment || replenishment.state !== 'ok') return { entries: [], due: null };
  const due = RM.dueBuckets(replenishment, { startDate, days, markets });
  const contacts = replenishment.contacts instanceof Map ? replenishment.contacts : new Map();
  const fq = config.frequency || {};
  const channels = ['email', 'landing_page'];
  const bt = replenishment.backtest || {};
  const synthetic = !!(replenishment.source && replenishment.source.synthetic);
  const entries = [];
  const withheld = [];
  for (const b of due.buckets) {
    // One product group per slot: the name says which, and `slot_key` keeps
    // two groups due the same day apart in the plan's id (the cohort slug in
    // a calendar id is cut at 32 characters, so the name alone cannot).
    const cohortName = `${REPLENISHMENT_COHORT_NAMES[b.cohort]} · ${b.group_label}`;
    const slotKey = `repl-${b.cohort === 'second_order' ? '2nd' : 'rep'}-${crypto.createHash('sha1').update(String(b.group)).digest('hex').slice(0, 8)}`;
    const objective = objectiveFor(cohortName, null);
    const offer = offerDecision(cohortName, objective, brand);
    const elig = CE.triggerEligibility(b.customer_ids, contacts, { messagePriority: offer.pct > 0 ? 'promotional' : 'high_intent' });
    if (!elig.eligible) {
      withheld.push({ market: b.market, cohort: b.cohort, send_date: b.send_date, due: elig.audience, excluded: elig.excluded });
      continue;
    }
    const size = elig.eligible;
    // The hero comes from the LEAD group (the one most of this audience is due
    // for); supporting products are the next most-bought in that group, then
    // the top of the next group - so a slot about one product never fronts
    // another.
    const lead = b.products[0] || {};
    const leadBought = lead.last_bought || [];
    const hero = replenishmentHero(leadBought[0], b.market, catalog);
    const supporting = leadBought.slice(1, 3).concat(b.products.slice(1).map((p) => (p.last_bought || [])[0]).filter(Boolean))
      .slice(0, 2).map((h) => replenishmentHero(h, b.market, catalog)).filter((p) => !p.placeholder);
    const ids = elig.eligible_ids.slice(0, 500);
    const festival = festivals ? festivalOn(festivals, b.market, b.send_date) : null;
    const reach = {
      cohort_size: size,
      cohort_size_estimated: false,
      trigger: true,
      min_recipients: null,
      target_recipients: null,
      planned_recipients: size,
      meets_floor_from_core: null,
      per_user_per_week: { min: fq.minPerUserPerWeek || 2, max: fq.maxPerUserPerWeek || 3 },
      frequency_cap: { per_rolling_7d: 2, absolute_max: 3, sends_in_rolling_7d: null, over_preferred: false, over_cap: false, status: null, window_complete: null, enforced_at: 'plan-time per-(market,cohort) check + per-contact cohort-engine.frequencyCheck where send history exists + ESP send-time suppression' },
      widen_note: `Trigger audience: exactly the ${size} customer(s) in ${b.market} whose predicted repurchase window opens ${b.window.from} to ${b.window.to}. Never widened to reach a recipient floor; widening a trigger mails people who are not due.`,
      eligibility: { due: elig.audience, eligible: size, excluded: elig.excluded, unchecked: elig.unchecked, engagement: elig.engagement, frequency: elig.frequency },
    };
    const dailyTarget = dailyRevenueTargetFor(b.market);
    const feasibility = {
      daily_target: dailyTarget,
      per_send_target: null,
      projected_revenue: null,
      currency: 'USD',
      status: 'NOT APPLICABLE',
      note: 'A replenishment trigger reaches only the customers due in this window. It is not sized against the broadcast per-send target, and no revenue is projected for it.',
    };
    const conf = explainConfidence([
      { when: bt.verdict && bt.verdict.selected === 'model', label: 'Per-customer model beat the baseline in the holdout', delta: 0.08, detail: bt.verdict ? bt.verdict.reason : '' },
      { when: (lead.n_customers || 0) >= 100, label: 'Interval measured from a large repeat-buyer base', delta: 0.06, detail: `${lead.n_customers} repeat buyers, ${lead.n_intervals} intervals.` },
      { when: (lead.n_customers || 0) > 0 && lead.n_customers < 100, label: 'Interval measured from a modest repeat-buyer base', delta: 0.02, detail: `${lead.n_customers} repeat buyers (minimum ${replenishment.min_repeat_customers}).` },
      { when: synthetic, label: 'History is demo sample data, not real sales', delta: -0.15, detail: (replenishment.source && replenishment.source.label) || '' },
      { when: elig.unchecked === elig.audience, label: 'No per-contact engagement or send history', delta: -0.04, detail: 'Engagement tiers and the cross-channel cap are applied at ESP send time for this audience.' },
    ]);
    const evidence = {
      model: RM.MODEL_VERSION,
      method: replenishment.method ? replenishment.method.selected : 'baseline',
      method_reason: replenishment.method ? replenishment.method.reason : '',
      send_date: b.send_date,
      trigger_window: b.window,
      products: b.products,
      audience: {
        due: elig.audience,
        eligible: size,
        customer_ids: ids,
        // Each recipient's own last-bought SKU in this product group, and the
        // title the order line gave it: what the ESP personalises from.
        last_bought: Object.fromEntries(ids.filter((id) => b.last_bought[id]).map((id) => [id, b.last_bought[id]])),
        skus: b.skus,
        truncated: elig.eligible_ids.length > 500,
      },
      backtest: bt.state ? {
        state: bt.state, holdout_weeks: bt.holdout_weeks, cutoff: bt.cutoff, holdout_end: bt.holdout_end,
        model: bt.model ? { mae_days: bt.model.mae_days, hit_rate: bt.model.hit_rate, coverage: bt.model.coverage } : null,
        baseline: bt.baseline ? { mae_days: bt.baseline.mae_days, hit_rate: bt.baseline.hit_rate, coverage: bt.baseline.coverage } : null,
        selected: bt.verdict ? bt.verdict.selected : 'baseline',
      } : null,
      source: replenishment.source ? { kind: replenishment.source.kind, label: replenishment.source.label, synthetic, history_end: replenishment.source.history_end } : null,
      product_group: { key: b.group, label: b.group_label },
      personalisation: 'audience.last_bought maps each recipient to the SKU they last bought in this product group, for the ESP to personalise from; the creative\'s hero is the SKU most of this audience last bought.',
    };
    const why = `${size} customer(s) in ${b.market} are due to buy ${lead.product || hero.title} again: median ${lead.median_days} days between purchases (p25 ${lead.p25_days}, p75 ${lead.p75_days}) across ${lead.n_customers} repeat buyers, ${evidence.method === 'model' ? 'personalised per customer' : 'the product median for everyone (the per-customer model did not beat it in the backtest)'}.`;
    const rules = [
      `last purchase of the product group + ${lead.lead ? lead.lead.trigger_fraction : TRIGGER_FRACTION_FALLBACK} of the predicted interval falls in ${b.window.from}..${b.window.to}`,
      'not past the p75-equivalent point of the predicted interval (lapsing customers are left to the reactivation cohorts)',
      b.cohort === 'second_order' ? 'exactly one order so far (the next order is Order #2)' : 'two or more orders so far',
    ];
    const decision = buildDecision({ cohort: { name: cohortName, count: size }, product: hero, supporting, festival, objective, offer, market: b.market, reach });
    decision.topic = { choice: hero.title, why };
    decision.product.why = `Hero is the SKU most of this audience last bought in ${b.group_label}; each recipient's own last-bought SKU is carried in audience.last_bought.`;
    entries.push({
      id: idFor('cal', { date: b.send_date, market: b.market, cohort: cohortName }),
      date: b.send_date,
      market: b.market,
      status: 'needs_human_verification',
      confidence: conf.score,
      cohort: { name: cohortName, key: CE.REPLENISHMENT_COHORT.key, trigger: b.cohort, slot_key: slotKey, product_group: b.group_label, size, rules },
      reach,
      feasibility,
      channels,
      objective,
      offer,
      festival: festival ? { name: festival.name, weight: festival.weight, tags: festival.tags || [] } : null,
      heroProduct: hero,
      supportingProducts: supporting,
      ownDataReference: null,
      ownEvidence: asArray(winners).length
        ? { campaigns: winners.slice(0, 8).map((c) => ({ campaign_id: c.id, name: c.name, hooks: c.hooks, performance: c.performance })) }
        : null,
      competitorContext: competitorContext(competitorBenchmarks, channels),
      mvtPlan: buildMvtPlan(mvtLearnings || [], channels),
      rationale: `Replenishment trigger. ${why} Sent at the point a quarter of repeat buyers had already re-bought, so most are reached first.`,
      analysis: buildEntryAnalysis({
        cohort: { name: cohortName, size },
        product: { title: hero.title, sku: hero.sku, category: hero.category },
        festival,
        channels,
        objective,
        market: b.market,
        confidence: conf,
        dataSource: (replenishment.source && replenishment.source.kind) || 'replenishment-model',
      }),
      decision,
      replenishment: evidence,
    });
  }
  return { entries, due: Object.assign({}, due, { buckets: undefined, slots: entries.length, withheld, insight: RM.insight(replenishment, due) }) };
}
const TRIGGER_FRACTION_FALLBACK = 'the p25 share';

function confidenceFor({ winningTemplate, festival, feedbackMap, cohort }) {
  let c = 0.52;
  if (winningTemplate) c += 0.18;
  if (festival?.weight >= 7) c += 0.08;
  if ((cohort.count || 0) > 1000) c += 0.08;
  if (feedbackMap.positive > feedbackMap.negative) c += 0.06;
  return round(Math.min(c, 0.96), 2);
}
// A missing competitor set is a normal state, not a failure: a brand whose
// record names no competitors is documented to get an empty universe rather
// than somebody else's list. Reading `bench.byChannel` off an absent benchmark
// threw, and the throw came out of the planner — so one unconfigured feature
// took down the whole 90-day calendar for every market. Absent benchmarks now
// produce slots with `benchmark: null`, which is what an empty set means.
function competitorContext(bench, channels) {
  const b = bench || {};
  const byChannel = b.byChannel || {};
  const hooks = Array.isArray(b.trendingHooks) ? b.trendingHooks : [];
  return channels.filter((c) => c !== 'landing_page')
    .map((channel) => ({ channel, benchmark: byChannel[channel] || null, trendingHooks: hooks.slice(0, 3) }));
}
function buildMvtPlan(learnings, channels) {
  const variables = ['hook', 'offer_depth', 'hero_visual', 'cta', 'landing_page_length'];
  return variables.slice(0, Math.min(3, channels.length)).map((variable, i) => ({ variable, variants: [`control_${variable}`, `challenger_${variable}_${i + 1}`], apply_prior_learning: learnings.find((l) => l.variable === variable) || null }));
}
function summarizeFeedback(feedback) {
  return asArray(feedback).reduce((a, f) => { /reject|bad|negative/i.test(f.verdict || f.rating) ? a.negative++ : a.positive++; return a; }, { positive: 0, negative: 0 });
}
function buildCalendarRationale({ cohort, product, festival, winningTemplate }) {
  const parts = [`Targets ${cohort.name} using ${product.title || product.sku}.`];
  if (winningTemplate) parts.push(`Reuses patterns from high-performing own campaign "${winningTemplate.name}".`);
  if (festival) parts.push(`Aligned to ${festival.name}.`);
  return parts.join(' ');
}
// Discount decision for a slot. The DEPTH is the platform's call, derived from
// the cohort; the CODE is the brand's, selected from its own registry. This used
// to be a second copy of the same rules carrying ten literal codes - one brand's
// real ones, including a KNICKGASM10 handed to every tenant - which is not only
// the wrong company's name but a code that fails at the customer's checkout.
// One implementation now, in calendar-guardrails, so the two cannot drift.
function offerDecision(cohortName, objective, brand) {
  const GR = require('../../api/_shared/calendar-guardrails.js');
  const o = GR.offerFor(cohortName, objective, brand);
  return { depth: o.depth, pct: o.pct, code: o.code, min: o.min, slot: o.slot, why: o.rationale, data_gaps: o.data_gaps || [] };
}
function designArchetypeFor(objective) {
  const s = String(objective || '').toLowerCase();
  if (/reactivation|winback/.test(s)) return 'founder-note';
  if (/premium|bundle|expansion/.test(s)) return 'gift-bundle-showcase';
  if (/activation|second-order|education/.test(s)) return 'hero-spotlight';
  if (/seasonal|festival/.test(s)) return 'editorial-lookbook';
  return 'hero-spotlight';
}
// Full, human-readable "why this decision" object for the per-row detail panel:
// theme, topic, product (hero + bundle), offer/coupon, and design selection.
function buildDecision({ cohort, product, supporting, festival, objective, offer, market, reach }) {
  const sup = (supporting || []).map((p) => p.title).filter(Boolean);
  return {
    theme: { choice: objective + (festival ? ` · ${festival.name}` : ''), why: `Objective "${objective}" fits ${cohort.name}${festival ? ` and lands in the ${festival.name} window (weight ${festival.weight}/10)` : ''}.` },
    topic: { choice: product.title, why: `${product.title} is the top-scored hero for ${cohort.name} in ${market}.` },
    product: { hero: product.title, supporting: sup, why: sup.length ? `Hero ${product.title}, bundled with ${sup.join(' and ')} to lift average order value.` : `Single hero ${product.title}; no bundle needed for this cohort.` },
    offer: { code: offer.code || null, depth: offer.depth, pct: offer.pct, why: offer.why },
    design: { variants: '2 Text + 2 Text + Visual', archetype: designArchetypeFor(objective), why: `${objective} reads best as a ${designArchetypeFor(objective)} layout, rendered in this brand's own palette and typography with its own product photography.` },
    reach: { planned_recipients: reach.planned_recipients, per_user_per_week: reach.per_user_per_week, why: reach.widen_note },
  };
}

class GenerationService {
  constructor(config) { this.config = config; }
  generate(entry) {
    const baseName = `${entry.market} ${entry.objective} · ${heroTitleOf(entry)}`;
    const campaignId = idFor('campaign', entry);
    const audience = buildAudienceSpec(entry);
    const funnel = buildFunnelSpec(entry);
    const email = entry.channels.includes('email') ? buildEmailAsset(entry, campaignId) : null;
    const landing = entry.channels.includes('landing_page') ? buildLandingPageAsset(entry, campaignId) : [];
    const ads = buildAdAssets(entry, campaignId);
    return {
      schema_version: 'smart-campaign.v1',
      campaign_id: campaignId,
      name: baseName,
      status: entry.confidence >= this.config.confidence.minHumanVerificationConfidence ? 'ready_for_human_final_check' : 'needs_human_verification',
      approval: { required: true, reason: 'Launch-state safety policy requires human verification for every campaign before final.' },
      // Complete "why this was generated" analysis carried onto the campaign so
      // the reviewer sees the data-grounded reasoning, not just the assets.
      analysis: buildGenerationAnalysis(entry),
      market: entry.market,
      objective: entry.objective,
      cohort: entry.cohort,
      audience,
      retargeting: buildRetargetingSpec(entry),
      similarAudienceLogic: buildSimilarAudienceSpec(entry),
      funnel,
      assets: { email, landing_pages: landing, ads },
      platform_ready: {
        google_ads: ads.filter((a) => a.platform === 'google').map(platformAdObject),
        meta_ads: ads.filter((a) => a.platform === 'meta').map(platformAdObject),
        tiktok_ads: ads.filter((a) => a.platform === 'tiktok').map(platformAdObject),
        lifecycle_messaging: email ? [platformEmailObject(email, audience)] : [],
      },
      no_live_push: true,
      created_at: new Date().toISOString(),
    };
  }
}
function buildAudienceSpec(entry) {
  const spec = { name: `${entry.market}_${slug(entry.cohort.name)}`, market: entry.market, inclusion_rules: entry.cohort.rules || [], exclusions: ['unsubscribed users', 'recent purchasers inside suppression window', 'users with unresolved support escalation'] };
  const personalisation = replenishmentPersonalisation(entry);
  if (personalisation) spec.personalisation = personalisation;
  return spec;
}

/** The ESP merge field a replenishment send's hero slot reads. */
const REPLENISHMENT_MERGE_FIELD = 'replenishment_product_title';

/**
 * Each recipient's own last-bought product, as ESP merge data (#141 review).
 *
 * The calendar entry knew which SKU every recipient last bought in the slot's
 * product group (`replenishment.audience.last_bought`); the built campaign did
 * not, so the message that goes to the ESP fronted the group's most common
 * SKU for everyone. The data now travels with the audience:
 *   values    { <hashed profile id>: { sku, title } } - keyed by
 *             cohort-engine.hashProfileId() with the same per-workspace salt
 *             as the engagement table's email_hash; never a raw id or email
 *   field     the merge field the email's hero slot reads
 *   fallback  the group hero, for any recipient the ESP cannot match
 * A title is used only if the brand's own order line gave one; a SKU with no
 * title falls back to the group hero rather than printing a code.
 */
function replenishmentPersonalisation(entry) {
  const r = entry && entry.replenishment;
  const aud = r && r.audience;
  if (!aud || !aud.last_bought || !Object.keys(aud.last_bought).length) return null;
  const CE = require('../../api/_shared/cohort-engine.js');
  const ws = (entry.brand && entry.brand.id) || entry.workspace_id || '';
  const hero = entry.heroProduct || {};
  const skus = aud.skus || {};
  const values = {};
  for (const id of Object.keys(aud.last_bought).sort()) {
    const sku = aud.last_bought[id];
    const title = skus[sku] || null;
    values[CE.hashProfileId(id, ws)] = title ? { sku, title } : { sku, title: hero.title || null, title_is_fallback: true };
  }
  return {
    field: REPLENISHMENT_MERGE_FIELD,
    sku_field: 'replenishment_sku',
    keyed_by: 'profile_hash',
    hash: 'cohort-engine.hashProfileId(customer id): sha256 over the per-workspace salt (CONTACT_HASH_SALT, else the workspace id), the same salt as email_hash',
    fallback: { sku: hero.sku || null, title: hero.title || null },
    values,
  };
}

/** The hero slot for a personalised send: the merge field with the group hero as default. */
function personalisedHero(entry) {
  const p = replenishmentPersonalisation(entry);
  if (!p) return null;
  const fallback = String(heroTitleOf(entry)).replace(/'/g, '’');
  return `{{ ${p.field}|default:'${fallback}' }}`;
}

function buildRetargetingSpec(entry) {
  return { windows: [{ name: 'site_view_no_purchase_14d', days: 14 }, { name: 'email_click_no_purchase_7d', days: 7 }, { name: 'cart_no_purchase_3d', days: 3 }], message: `Retarget ${heroTitleOf(entry)} viewers with proof-led bundle or replenishment angle.` };
}
function buildSimilarAudienceSpec(entry) {
  return { seed: `${entry.cohort.name} purchasers in ${entry.market}`, similarity: '1-3% platform lookalike/equivalent', guardrails: ['exclude active purchasers already in lifecycle flow', 'separate prospecting from retargeting budget'] };
}
function buildFunnelSpec(entry) {
  return { steps: [{ step: 'creative', goal: 'earn click with cohort-specific hook' }, { step: 'landing_page', goal: 'convert with product proof, offer framing, reviews' }, { step: 'mailer_follow_up', goal: 'recover non-purchasers with education and urgency-safe reminder' }] };
}
function safeCopy(text) {
  // Full CLAUDE.md banned-phrase list (kept in sync with api/_shared/scenario-model.js
  // sanitizeBrand) — the prior regex missed game-changer / last chance /
  // while supplies last.
  return String(text || '')
    .replace(/LIMITED TIME/g, 'time-bound')
    .replace(/wellness journey|liquid gold|game[\s-]?changer|hurry|don'?t miss out|last chance|while supplies last/gi, 'a premium pick')
    .replace(/\btransform(ing|ed|s|ation)?\b/gi, 'elevate');
}
// The heuristic (no-LLM) asset builders below render for ANY brand: name,
// palette and store come from the entry's stamped brand, falling back to
// tenant zero's record only when the entry genuinely has no brand.
function entryBrand(entry) {
  // The unresolved placeholder (every field a DATA REQUIRED marker) is a
  // brand for this purpose: it renders visibly incomplete rather than as
  // tenant zero (2026-09-29).
  if (entry && entry.brand && (entry.brand.id || entry.brand.unresolved === true)) return entry.brand;
  try { return require('../../api/_shared/brand-runtime.js').defaultBrand(); } catch (_) { return { name: 'the brand', palette: {} }; }
}
/**
 * The palette this brand's assets are painted in.
 *
 * P and A are SECTION GROUNDS, so they go through sectionGround(): "never
 * black / #111111 / dark-neutral section backgrounds" is a design HARD rule,
 * and a brand record can carry a near-black primary the same way a bad literal
 * can (smart-brain-plan's mailer fallback was `pal.primary || '#111111'` and
 * shipped black emails). A deep BRAND colour is still allowed - the classifier
 * separates a dark brand colour from a neutral.
 *
 * ON_P and ON_A are the text on those grounds, DERIVED rather than assumed to
 * be the surface. Assuming it is how a 2.77:1 button label ships.
 */
function brandPalette(entry) {
  const p = (entryBrand(entry).palette) || {};
  const core = (() => { try { return require('../../api/_shared/brand-workspace-core.js'); } catch (_) { return null; } })();
  const ground = (...c) => (core ? core.sectionGround(...c) : (c.find(Boolean) || '#FFFFFF'));
  const on = (bg, surf, ink) => { try { return core ? core.textOn(bg, surf, ink) : surf; } catch (_) { return surf; } };
  const SURF = p.surface || '#FFFFFF';
  const INK = p.ink || '#111111';
  // The chain ends at the brand's OWN surface, never at a literal from some
  // other brand's palette - that is how one tenant's red ends up on another
  // tenant's page. A is a CONTROL fill (the CTA), so it is not gated: a brand
  // whose accent is near-black gets a black button, and what matters is that
  // its label reads.
  const P = ground(p.primary, p.accent, SURF);
  const A = p.accent || p.primary || P;
  return { P, A, INK, SURF, ON_P: on(P, SURF, INK), ON_A: on(A, SURF, INK) };
}

/**
 * Where this landing page's CTA goes, for THIS brand in THIS market.
 *
 * The template rendered its call to action as a bare `<button>` with no form
 * and no handler, so the one thing the page exists to do did nothing when
 * clicked. It is now a link — and the destination is resolved from the brand's
 * own region record. A brand with no store URL for the market gets the marker
 * rather than another brand's storefront, and `#` rather than a fabricated
 * link, so a dead CTA is visible instead of a plausible wrong one.
 */
function storeHref(entry) {
  try {
    const facts = require('../../api/_shared/brand-runtime.js').regionFacts(entryBrand(entry), entry && entry.market);
    if (facts && facts.store) return `https://${facts.store}`;
  } catch (_) { /* fall through to the honest empty link */ }
  return '#';
}

function buildEmailAsset(entry, campaignId) {
  const b = entryBrand(entry);
  const pal = brandPalette(entry);
  const bName = b.name || 'the brand';
  const t = b.typography || {};
  const HEAD = (t.heading && t.heading.stack) || "'Montserrat','Raleway',Georgia,serif";
  const BODY = (t.body && t.body.stack) || "'Instrument Sans','Helvetica Neue',Arial,sans-serif";
  const ctaLabel = entry.cta || 'See more';
  // A COHORT NAME IS NOT SOMETHING YOU SAY TO THE CUSTOMER.
  //
  // `entry.cohort.name` is an internal RFM classification — rfm-core emits
  // "At Risk", "Hibernating", "About to Sleep", "Can't Lose Them", "Lost". It
  // told the planner who to write to, and it was interpolated straight into the
  // words the reader receives: "Alpha 01 for At Risk", "Lost: Alpha 01 is here",
  // "Why About to Sleep keep coming back to it."
  //
  // That is three defects at once. It tells a customer how the business has
  // classified them, it is not English, and it is a fact about internal
  // analytics leaving the building. The segment still decides the objective, the
  // offer depth and the hero — it just never speaks.
  //
  // The reader is addressed as "you", which is both true and sayable for every
  // one of the eleven segments.
  // A replenishment trigger names EACH recipient's own last-bought product:
  // the hero slot is the ESP merge field, the group hero only its fallback.
  const heroSlot = personalisedHero(entry) || heroTitleOf(entry);
  const subject = safeCopy(`${entry.festival ? `${entry.festival.name}: ` : ''}${heroSlot}, chosen for you`);
  const preheader = safeCopy(`A ${bName} pick, chosen for you.`);
  const meta = `<!--\nSUBJECT_PRIMARY: ${subject}\nPREHEADER: ${preheader}\n-->\n`;
  // TABLE-BASED, and not as a stylistic preference.
  //
  // This template was <main>/<section> with `max-width` on the wrapper, an
  // `opacity` eyebrow and an inline-block <a> for the CTA. Outlook on Windows
  // renders with the WORD engine: it ignores max-width, so the mailer spanned
  // the full window; it ignores opacity, so the eyebrow rendered at full
  // strength; and it drops background on an inline-block anchor, so the CTA
  // arrived as bare underlined text with no button behind it. The app was
  // asking other models for table-based email while generating this itself.
  //
  // What changed, and why each part:
  //   - 600px table, fixed. The width every ESP and client agrees on.
  //   - bgcolor attribute BESIDE the CSS background on every coloured cell,
  //     because Word reads the attribute and not the declaration.
  //   - The CTA is a cell with bgcolor, with the <a> filling it. Colour comes
  //     from the cell, so it survives even where the anchor's style does not.
  //   - A hidden preheader span, so the inbox preview is the line we wrote
  //     rather than the first words of the eyebrow.
  //   - Letter-spacing instead of opacity for the eyebrow: same intent, and it
  //     degrades to plain text rather than to a different colour.
  const preheaderSpan = `<span style="display:none;font-size:1px;color:${pal.SURF};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader}</span>`;
  const cell = (bg, inner, pad) => `<tr><td bgcolor="${bg}" style="background-color:${bg};padding:${pad}">${inner}</td></tr>`;
  const body = [
    `<p style="margin:0 0 10px;font-family:${BODY};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${pal.ON_P}">${bName}</p>`,
    `<h1 style="margin:0 0 12px;font-family:${HEAD};font-size:26px;line-height:1.25;font-weight:500;color:${pal.ON_P}">${subject}</h1>`,
    `<p style="margin:0;font-family:${BODY};font-size:15px;line-height:1.5;color:${pal.ON_P}">${preheader}</p>`,
  ].join('');
  const main = [
    `<h2 style="margin:0 0 12px;font-family:${HEAD};font-size:20px;line-height:1.3;font-weight:500;color:${pal.P}">${heroSlot}</h2>`,
    `<p style="margin:0 0 24px;font-family:${BODY};font-size:15px;line-height:1.6;color:${pal.INK}">Chosen for you, and carried through the landing page and the follow-up so the promise does not change between them.</p>`,
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td bgcolor="${pal.P}" style="background-color:${pal.P};border-radius:2px"><a href="{{landing_page_url}}" style="display:block;padding:14px 26px;font-family:${BODY};font-size:14px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;color:${pal.ON_P};text-decoration:none">${ctaLabel}</a></td></tr></table>`,
  ].join('');
  const html = `${meta}<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>`
    + `<body style="margin:0;padding:0;background-color:${pal.SURF};color:${pal.INK}">${preheaderSpan}`
    + `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="${pal.SURF}" style="background-color:${pal.SURF}"><tr><td align="center" style="padding:0">`
    + `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px">`
    + cell(pal.P, body, '36px 32px')
    + cell(pal.SURF, main, '32px')
    + `</table></td></tr></table></body></html>`;
  return {
    id: `${campaignId}_email`, type: 'html_email', platform_targets: ['klaviyo', 'webengage'],
    subject, preheader, html,
    text: `${subject}\n${preheader}\n${ctaLabel}: {{landing_page_url}}`,
  };
}
function buildLandingPageAsset(entry, campaignId) {
  // Two variants, always: A = conversion/proof-led, B = story/editorial-led.
  // applyCopy() gives B a distinct headline + the real catalog product photo so
  // the pair is a genuine A/B (message + imagery). B is served at /lp/:id?v=b.
  const mk = (variant, title, blurb, sections) => ({
    id: `${campaignId}_landing_${variant.toLowerCase()}`, variant, type: 'landing_page',
    path: variant === 'A' ? `/lp/${campaignId}` : `/lp/${campaignId}?v=b`,
    title,
    html: (function () {
      const b = entryBrand(entry); const pal = brandPalette(entry);
      const bName = b.name || 'the brand';
      const kindLine = (entry.offering && entry.offering.kind) ? `${bName}'s own ${entry.offering.kind}` : `${bName}'s own catalogue`;
      const ctaLabel = entry.cta || 'See more';
      return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:Arial,sans-serif;color:${pal.INK};background:${pal.SURF}"><section style="padding:56px 24px;background:${pal.P};color:${pal.ON_P};text-align:center"><p style="letter-spacing:.18em;text-transform:uppercase">${bName}</p><h1>${title}</h1><p>${blurb}</p></section><section style="max-width:920px;margin:auto;padding:40px 24px"><h2>Why this edit</h2><ul><li>Selected from ${kindLine}.</li><li>Proof-led storytelling; reviews render only from approved data.</li><li>Retargeting and mailer follow-up are aligned to this same page promise.</li></ul><a href="${storeHref(entry)}" style="display:inline-block;background:${pal.A};color:${pal.ON_A};border:0;padding:16px 24px;font-weight:bold;text-decoration:none;border-radius:2px">${ctaLabel}</a></section></body></html>`;
    })(),
    sections,
  });
  const titleA = safeCopy(`${heroTitleOf(entry)} · ${entry.market} Edit`);
  const titleB = safeCopy(`The story behind ${heroTitleOf(entry)}`);
  return [
    mk('A', titleA, safeCopy(entry.rationale || ''), ['hero', 'proof', 'product_grid', 'reviews', 'faq', 'sticky_cta']),
    mk('B', titleB, safeCopy(`Why this one, and what went into it.`), ['story_hero', 'ritual', 'single_product_spotlight', 'founder_note', 'reviews', 'sticky_cta']),
  ];
}
function buildAdAssets(entry, campaignId) {
  const hero = heroTitleOf(entry);
  // Ads ship in exactly TWO creative types — STATIC and VIDEO — never text-only.
  // (A paid ad is a designed image or a video, not a paragraph.) Static carries an
  // image design spec + overlay; Video carries a shot-by-shot storyboard + script.
  // Both follow paid-social benchmarking (Meta/TikTok/Google ad libraries): a hook
  // that lands in ~1.5s, Z-pattern visual hierarchy, social proof, ONE sticky CTA,
  // brand palette only, platform text-safe zones, and no fabricated offer/claim.
  const _b = entryBrand(entry);
  const _pal = brandPalette(entry);
  const _bName = _b.name || 'the brand';
  const _kind = (entry.offering && entry.offering.kind) || (entry.heroProduct && entry.heroProduct.category) || 'pick';
  const _cta = entry.cta || 'Shop Now';
  const _claim = (Array.isArray(_b.claims) && _b.claims[0]) || '';
  // Same rule as the mailer above: the segment chose the angle, it does not
  // appear in the words. `benefitLed` also no longer asserts repeat purchase —
  // "keep coming back to" is a claim about behaviour this build cannot evidence.
  const prodLed = safeCopy(`${hero}, chosen for you. The ${_bName} edit.`);
  const benefitLed = safeCopy(`Meet ${hero}. From ${_bName}'s own ${_kind}.`);
  const BRAND = `brand palette only (primary ${_pal.P}, accent ${_pal.A}, surface ${_pal.SURF}); real packshot or offering imagery from ${_bName}'s own assets; WCAG-AA contrast; NO text baked into the base image (overlays are added in-platform)`;
  /**
   * Responsive-search copy. Google assembles the combination, so each line has
   * to stand alone — these are independent claims, never a sentence split
   * across slots. De-duplicated and length-filtered against the platform's own
   * limits (30 / 90), because Google DROPS an over-long line rather than
   * truncating it: it would silently not exist.
   */
  const rsaCopy = () => {
    const claims = Array.isArray(_b.claims) ? _b.claims.filter(Boolean).map(String) : [];
    const pick = (arr, max) => {
      const seen = new Set(); const out = [];
      for (const raw of arr) {
        const t = safeCopy(String(raw || '')).trim();
        if (!t || t.length > max) continue;               // dropped, not shortened
        const k = t.toLowerCase();
        if (seen.has(k)) continue;                        // a duplicate wastes a slot
        seen.add(k); out.push(t);
      }
      return out;
    };
    const headlines = pick([
      hero,
      _bName,
      `${entry.market} Edit`,
      _kind && _kind !== 'pick' ? _kind : '',
      _cta,
      ...claims,                                          // only the ones that fit
    ], 30).slice(0, 15);
    const descriptions = pick([
      prodLed,
      benefitLed,
      ...claims,
    ], 90).slice(0, 4);
    return { headlines, descriptions };
  };
  const staticAd = (platform, aspect, placement) => ({
    id: `${campaignId}_${platform}_static`, platform, creative_type: 'static', variant: 'Static', format: 'static_image',
    // `caption` is the post text. Meta and Google do not use it, but TikTok's
    // in-feed card is a post and has nothing else to carry the words.
    placement, aspect, headline: safeCopy(hero), primary_text: prodLed, caption: prodLed, cta: _cta,
    creative_brief: `STATIC ${aspect} for ${placement}: hero visual of ${hero} on ${BRAND}. Above-the-fold hook readable in 1.5s; headline overlay top (Z-pattern), a proof chip ONLY from supplied approved data, and one high-contrast CTA button bottom-right.`,
    overlay: { headline: safeCopy(hero), proof: _claim, cta: _cta },
  });
  // A video ad still needs the ad unit's TEXT.
  //
  // This carried a caption and a hook but no primary_text and no headline, and
  // Meta requires both on a video ad exactly as it does on a static one — they
  // are the same fields in the same form, the creative below them is simply
  // moving. So every video ad this app generated was, on the platform, an
  // untitled post: the contract check reported it as two blocking violations on
  // every single build. The angle is the benefit-led one, which keeps the
  // static/video pair a real A/B rather than the same line twice.
  const videoAd = (platform, placement) => ({
    id: `${campaignId}_${platform}_video`, platform, creative_type: 'video', variant: 'Video', format: 'video',
    placement, aspect: '9:16', duration_s: 15, caption: benefitLed, cta: _cta,
    headline: safeCopy(hero), primary_text: benefitLed,
    hook: safeCopy(`${hero} is here`),
    storyboard: [
      { t: '0-2s', scene: `HOOK: extreme close-up of ${hero}, on-screen hook text, sound-on stinger` },
      { t: '3-7s', scene: `the ${entry.objective} moment, in ${_bName}'s own world and palette` },
      { t: '8-12s', scene: 'proof: hero visual + claims drawn ONLY from the brand record' },
      { t: '13-15s', scene: `CTA end-card: ${_bName} logo + ${_cta} to the landing page` },
    ],
    script: `0-2s hook line; 3-7s benefit (${entry.objective}); 8-12s proof; 13-15s CTA to the landing page.`,
  });
  // Every relevant paid channel ships BOTH a Static AND a Video ad (two independent
  // creative types). The core paid mix (Meta, Google, YouTube, TikTok) always gets
  // both; Pinterest is added when the slot plans it. video_first orders the pair the
  // way the platform is consumed (video-native placements lead with the video).
  const AD_PLATFORMS = [
    { key: 'meta',      s_aspect: '1:1',    s_place: 'Feed 1:1 / 4:5',                v_place: 'Reels / Stories',            video_first: false },
    { key: 'google',    s_aspect: '1.91:1', s_place: 'Responsive Display / Demand Gen', v_place: 'Demand Gen video',        video_first: false },
    { key: 'youtube',   s_aspect: '1.91:1', s_place: 'Masthead / Companion banner',   v_place: 'Shorts / In-stream',         video_first: true  },
    { key: 'tiktok',    s_aspect: '9:16',   s_place: 'In-feed image card',            v_place: 'In-Feed video',              video_first: true  },
    { key: 'pinterest', s_aspect: '2:3',    s_place: 'Standard Pin',                  v_place: 'Idea / Video Pin',           video_first: false },
  ];
  const CORE = new Set(['meta', 'google', 'youtube', 'tiktok']); // always run both types
  const chans = entry.channels || [];
  const out = [];
  AD_PLATFORMS.forEach((p) => {
    if (!CORE.has(p.key) && !chans.includes(p.key)) return;
    const s = staticAd(p.key, p.s_aspect, p.s_place);
    const v = videoAd(p.key, p.v_place);
    // A GOOGLE AD IS A RESPONSIVE SEARCH AD, AND ONE HEADLINE IS NOT ONE.
    //
    // Every Google ad this app built carried a single `headline` and no
    // `headlines`/`descriptions` arrays at all — while asset-contracts.js
    // routes it to `ad.google.rsa`, which declares both as REQUIRED lists, and
    // google-ads-adapter.js refuses to build a request below 3 headlines and 2
    // descriptions. So the console approved an ad the adapter would then not
    // send, and the reviewer had no way to know.
    //
    // Everything below is derived from facts the brand record already holds —
    // the hero, the brand name, the offering kind, the market, the CTA and the
    // brand's OWN verified claims. Nothing is invented to reach the count: if
    // the brand supplies too little to fill three distinct lines, the array is
    // short and the contract blocks and says so, which is the correct outcome.
    if (p.key === 'google') { Object.assign(s, rsaCopy()); Object.assign(v, rsaCopy()); }
    out.push(...(p.video_first ? [v, s] : [s, v]));
  });
  return out;
}
function platformAdObject(a) { return { external_platform: a.platform, creative_id: a.id, format: a.format, copy: a, destination_url: '{{landing_page_url}}', push_status: 'not_integrated_phase_2' }; }
function platformEmailObject(email, audience) { return { external_platforms: email.platform_targets, message_id: email.id, audience, subject: email.subject, html: email.html, push_status: 'not_integrated_phase_2' }; }

class ReviewService {
  constructor(config) { this.config = config; }
  review(calendar, campaigns) {
    const needsHuman = campaigns.filter((c) => c.approval.required || c.status !== 'final');
    return {
      daily_review_completed_at: new Date().toISOString(),
      calendar_entries_reviewed: calendar.entries.length,
      generated_campaigns: campaigns.length,
      human_verification_required: needsHuman.length,
      weekly_recalibration: { required: true, minimum_frequency_days: this.config.confidence.weeklyRecalibrationDays, checklist: ['approve/reject calendar direction', 'validate cohorts and suppression rules', 'review performance thresholds', 'approve competitive benchmark use', 'sign off on generated assets'] },
      policy: 'Daily automated review updates plans without human involvement; every campaign still needs human verification before final, and full-system recalibration is mandatory weekly.',
    };
  }
}

async function runDailySmartBrain({ config: cfg = {}, startDate = todayIso(), days, persist = false } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const ownData = await db.ownData();
  const competitorData = await db.competitorData();
  const kb = new KnowledgeBaseService(config).build(ownData);
  const analysis = new AnalysisService(config).analyze(kb, ownData);
  const competitorBenchmarks = new CompetitorBenchmarkingService(config).benchmark(competitorData);
  const calendar = new CalendarIntelligenceService(config).generate({ analysis, competitorBenchmarks, startDate, days: days || config.calendarDays, feedback: ownData.feedback });
  const generator = new GenerationService(config);
  const campaigns = calendar.entries.map((entry) => generator.generate(entry));
  const review = new ReviewService(config).review(calendar, campaigns);
  const result = { ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', kb, analysis, competitorBenchmarks, calendar, campaigns, review };
  if (persist) {
    result.persistence = await db.insert(config.tableNames.runs, [{ id: idFor('run', { startDate, days, at: Date.now() }), payload: result, created_at: new Date().toISOString() }]);
  }
  return result;
}

function schemaAssumptions(config = smartConfig()) {
  return {
    tables: config.tableNames,
    required_contracts: {
      products: ['id', 'sku', 'title', 'handle', 'category', 'market', 'price', 'tags jsonb'],
      assets: ['id', 'asset_type', 'format', 'url', 'title', 'tags jsonb', 'metadata jsonb'],
      campaigns: ['id', 'name', 'channel', 'market', 'campaign_type', 'subject/headline', 'sent_at', 'cohort_key'],
      campaign_assets: ['campaign_id', 'asset_id', 'role'],
      campaign_metrics: ['campaign_id', 'creative_id', 'channel', 'market', 'sends/impressions', 'opens', 'clicks', 'conversions', 'revenue', 'spend', 'observed_at'],
      users: ['id', 'email/phone hash allowed', 'market', 'total_spend', 'orders_count', 'last_order_at', 'accepts_marketing', 'tags jsonb'],
      orders: ['id', 'user_id', 'market', 'total', 'created_at', 'product_sku'],
      competitor_campaigns: ['id', 'brand', 'channel', 'campaign_type', 'asset_type', 'hook/headline/subject', 'asset_url', 'observed_at'],
      generated_campaigns: ['id', 'payload jsonb', 'status', 'human_verified_at', 'created_at'],
      feedback: ['id', 'target_type', 'target_id', 'verdict', 'notes', 'created_at'],
    },
  };
}

module.exports = { smartConfig, SmartBrainDbAdapter, KnowledgeBaseService, AnalysisService, CompetitorBenchmarkingService, CalendarIntelligenceService, GenerationService, ReviewService, runDailySmartBrain, schemaAssumptions, applyContactPolicy, contactSlotOf };
