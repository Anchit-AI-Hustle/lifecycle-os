'use strict';
/**
 * workspace-scope.js — brand isolation for code paths that use the SERVICE-ROLE
 * key.
 *
 * The RLS policies added in 20260810120000_scope_content_to_workspace.sql are
 * the guarantee for anything using a user token. They do NOT protect the
 * server: the service-role key bypasses RLS entirely. So every server path that
 * touches a workspace-scoped table has to scope itself, and this is the one
 * helper that does it.
 *
 * Two obligations, both easy to forget and both silent when missed:
 *   READ  - filter by workspace, or you return another brand's rows.
 *   WRITE - stamp the workspace, or the row lands with workspace_id NULL and
 *           becomes invisible to every scoped policy (it is not an error; the
 *           row simply disappears from the app).
 *
 * `resolve()` prefers an explicitly supplied workspace, then the request's, and
 * finally the oldest workspace - which is what the backfill assigned historical
 * rows to, so unattributed server jobs (the daily cron) stay consistent.
 */

/**
 * Every table the content-scoping migrations gave a `workspace_id` column.
 *
 * This list is NOT a matter of taste. `supabase/migrations/*_scope_*.sql` add
 * the column, backfill it to tenant zero and put an `is_brand_member` policy on
 * it; a table that has the column but is missing HERE is read unfiltered by
 * every service-role path and written with workspace_id NULL, which means one
 * brand reads another brand's rows and its own writes become invisible. Both
 * failures are silent.
 *
 * `tests/workspace-scope.spec.js` re-derives the list from the migration files
 * and fails when the two drift, so adding a table to a migration without adding
 * it here breaks the build instead of leaking at runtime.
 *
 * Keep in sync with lib/smart-brain/services.js WORKSPACE_SCOPED.
 */
const SCOPED_TABLES = new Set([
  // 20260810120000 — the campaign pipeline.
  'kb_knowledge', 'brand_assets', 'smart_calendar_entries',
  'smart_generated_campaigns', 'ads_generated',
  'landing_pages_generated', 'mailers_generated',
  // 20260810160000 — the rest of the brand's content.
  'competitor_brands', 'competitor_emails_classified', 'competitor_landing_pages',
  'ci_ads', 'ci_emails', 'ci_funnels', 'ci_landing_pages', 'ci_offers',
  'ci_screenshots', 'ci_creative_tags', 'ci_asset_versions',
  'kb_campaigns', 'kb_files', 'kb_top_emails', 'kb_daily_digest',
  'cohorts', 'calendar_slots', 'campaign_specs', 'calendar_feedback',
  'social_posts_generated', 'smart_products', 'smart_campaigns',
  'smart_generated_assets', 'smart_cohorts', 'smart_orders', 'smart_users',
  'smart_events', 'smart_competitor_campaigns', 'smart_competitor_signals',
  'smart_sales_history', 'smart_festivals', 'smart_funnels',
  'klaviyo_campaigns', 'klaviyo_events', 'klaviyo_metrics', 'klaviyo_segments',
  'shopify_orders', 'webengage_events', 'performance_metrics',
  'pagedeck_pages', 'pagedeck_experiments', 'pagedeck_competitor_pages',
  'mvt_experiments', 'saved_items', 'uploaded_files',
  // 20260813121000 — the per-brand competitor universe.
  'brand_competitors',
  // 20260814090000 — the singletons, the analytics control plane and the
  // competitive-intelligence brand register.
  'lifecycle_brand_kit',
  'analytics_hourly_runs', 'analytics_anomaly_state',
  'analytics_action_outcomes', 'analytics_alert_settings',
  'brands',
  'smart_calendar', 'smart_calendar_reviews', 'smart_assets',
  'smart_campaign_assets', 'smart_campaign_metrics', 'smart_review_queue',
  'smart_feedback', 'smart_confidence', 'smart_library_scores',
  'smart_mvt_results', 'smart_recalibrations',
  'smart_agents', 'smart_agent_sessions', 'smart_agent_messages',
  'smart_agent_knowledge',
  // 20260814090000 §3b — the backbone tables whose workspace_id was a legacy
  // TEXT column defaulting to the literal 'knickgasm'.
  'activity_logs', 'exports', 'agent_runs',
  // 20260814100000 — the brand context pack and the field-provenance record.
  // brand-context-pack.js already filters both explicitly on every call, so this
  // is defence in depth rather than the primary guard: a pack is a whole brand's
  // design system, knowledge base and repository list in one row, and a
  // service-role read of it that forgot the filter would hand one brand's
  // complete context to another.
  'brand_context_packs', 'brand_field_provenance',
]);

function isScoped(table) { return SCOPED_TABLES.has(String(table || '')); }

const CACHE = { id: null, at: 0 };
const TTL = 60_000;

/** The oldest workspace: tenant zero, and the backfill target. */
async function defaultWorkspaceId(env) {
  if (CACHE.id && Date.now() - CACHE.at < TTL) return CACHE.id;
  if (!env || !env.url || !env.key) return null;
  try {
    const r = await fetch(`${env.url}/rest/v1/brand_workspaces?select=id&order=created_at.asc&limit=1`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const id = (rows[0] && rows[0].id) || null;
    if (id) { CACHE.id = id; CACHE.at = Date.now(); }
    return id;
  } catch (_) { return null; }
}

/**
 * The signed-in caller's ACTIVE workspace, from their JWT + brand_user_prefs.
 * This is the authoritative answer when a user request arrives without an
 * explicit workspace_id - falling back to the oldest workspace instead served
 * TENANT ZERO'S data into other brands' screens whenever the client forgot
 * (or was too stale) to stamp the request.
 */
const PREF_CACHE = new Map();
const PREF_TTL = 60_000;

function userIdFromReq(req) {
  try {
    const h = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
    const m = /^Bearer\s+(.+)$/i.exec(String(h));
    if (!m) return null;
    const parts = m[1].split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return payload && payload.sub ? String(payload.sub) : null;
  } catch (_) { return null; }
}

async function activeWorkspaceForUser(env, userId) {
  if (!userId || !env || !env.url || !env.key) return null;
  const hit = PREF_CACHE.get(userId);
  if (hit && Date.now() - hit.at < PREF_TTL) return hit.id;
  try {
    const r = await fetch(`${env.url}/rest/v1/brand_user_prefs?user_id=eq.${encodeURIComponent(userId)}&select=active_workspace_id&limit=1`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    const id = (rows[0] && rows[0].active_workspace_id) || null;
    PREF_CACHE.set(userId, { id, at: Date.now() });
    return id;
  } catch (_) { return null; }
}

/** Resolve the workspace for this call. */
async function resolve(env, req, explicit) {
  if (explicit) return explicit;
  const q = (req && req.query) || {};
  const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
  const fromReq = q.workspace_id || body.workspace_id;
  if (fromReq) return String(fromReq);
  // A signed-in user's request resolves to THEIR active workspace. Only a
  // request with no user at all (cron, internal jobs) may use the default.
  const userId = userIdFromReq(req);
  if (userId) {
    const ws = await activeWorkspaceForUser(env, userId);
    // A user with no active workspace gets NOTHING scoped, never another
    // brand's rows - return null so scoped reads come back empty.
    return ws || null;
  }
  // Userless: cron, the collectors in workers/, the seed scripts. WORKSPACE_ID
  // lets an operator run one of those FOR a specific brand; without it they
  // read and write tenant zero, which is where the backfill put every
  // historical row. Deliberately last, so it can never override a real user.
  const pinned = String(process.env.WORKSPACE_ID || '').trim();
  if (pinned) return pinned;
  return defaultWorkspaceId(env);
}

/**
 * The workspace for the request currently being served, for code that is too
 * deep in the stack to have been handed `req`.
 *
 * The generic Supabase helper (`supa.js`) is called from ~40 sites across the
 * competitive-intelligence collectors, the Klaviyo mirror, PageDeck and the
 * dashboards, and none of them take a request. Threading `req` through all of
 * them is the change nobody finishes, and every site anyone forgets reads
 * ACROSS BRANDS in silence - which is exactly how one advertiser's spend ended
 * up on every brand's Paid Media table.
 *
 * `request-scope.js` (AsyncLocalStorage) already carries the request for the
 * LLM key lookup, for the same reason. This reuses it. Outside a wrapped
 * handler - a test, a script, the cron worker - there is no store, and the
 * behaviour is the documented userless one: the oldest workspace.
 *
 * A router that resolved the workspace once already puts it on
 * `req.__workspaceId`; that wins, so a request never resolves twice and never
 * disagrees with the guard its own router applied.
 */
async function currentWorkspaceId(env) {
  let req = null;
  try { req = require('./request-scope.js').currentRequest(); } catch (_) { req = null; }
  if (req && req.__workspaceId) return String(req.__workspaceId);
  return resolve(env, req);
}

/**
 * Append the workspace filter to a PostgREST query string.
 * Returns null when the table is scoped but no workspace could be resolved -
 * the caller must then return NOTHING rather than an unscoped result set.
 */
async function filterFor(table, env, req, explicit) {
  if (!isScoped(table)) return '';
  const ws = await resolve(env, req, explicit);
  if (!ws) return null;
  return `&workspace_id=eq.${encodeURIComponent(ws)}`;
}

/** Stamp rows destined for a scoped table. */
async function stamp(table, rows, env, req, explicit) {
  if (!isScoped(table)) return rows;
  const ws = await resolve(env, req, explicit);
  if (!ws) return rows;
  const list = Array.isArray(rows) ? rows : [rows];
  const out = list.map((r) => (r && typeof r === 'object' && r.workspace_id ? r : Object.assign({}, r, { workspace_id: ws })));
  return Array.isArray(rows) ? out : out[0];
}


/**
 * The BRAND RECORD for a workspace, read with the service-role key.
 *
 * Server-side generation (the daily cron, prebuild, approve) has no user token,
 * so it cannot go through the RLS-protected brand router - but it still must
 * build assets from the RIGHT brand. Without this, every generated mailer and
 * ad fell back to tenant zero and carried that brand's palette, voice, claims
 * and logo into another company's workspace.
 *
 * Returns null when it cannot resolve one; callers must then decline to
 * generate rather than quietly using a default brand.
 */
const BRAND_CACHE = new Map();
const BRAND_TTL = 60_000;

async function brandForWorkspace(env, workspaceId) {
  const id = String(workspaceId || '');
  if (!id || !env || !env.url || !env.key) return null;
  const hit = BRAND_CACHE.get(id);
  if (hit && Date.now() - hit.at < BRAND_TTL) return hit.brand;
  try {
    const r = await fetch(`${env.url}/rest/v1/brand_workspaces?id=eq.${encodeURIComponent(id)}&select=*&limit=1`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    // Normalise here too, not only in brandRuntime.resolve(). This is the
    // SERVICE-ROLE boundary - cron, the prebuild queue, approve, the social run
    // and the brand LLM all reach a workspace through this function and never
    // touch resolve(). Hoisting in only one of the two places left every
    // scheduled and background generation handing generators an unhoisted row,
    // so an onboarded brand's claims and offerings vanished on exactly the
    // paths that build most of its assets.
    const raw = rows[0] || null;
    const brand = raw ? require('./brand-runtime.js').normalizeBrand(raw) : null;
    if (brand) BRAND_CACHE.set(id, { brand, at: Date.now() });
    return brand;
  } catch (_) { return null; }
}

/**
 * Drop every cached answer that a brand write can invalidate.
 *
 * Three caches here can each serve a stale read straight after a write:
 *   PREF_CACHE  - the user's ACTIVE workspace. `brand.activate` changes it, so
 *                 without this a brand switch kept resolving to the previous
 *                 workspace for a whole minute: the user switches brand, clicks
 *                 Run Daily Sync, and reads and writes the old brand's plan.
 *   BRAND_CACHE - the workspace ROW that cron, prebuild, approve and the social
 *                 run build assets from. `brand.save` PATCHes that row, so
 *                 generation right after onboarding used the old palette,
 *                 voice and claims.
 *   CACHE       - the oldest workspace, which only a delete can change.
 *
 * `userId` and `workspaceId` are both optional; anything not supplied is
 * cleared wholesale, because a stale entry is worse than a re-read.
 */
function invalidate({ userId, workspaceId } = {}) {
  if (userId) PREF_CACHE.delete(String(userId)); else PREF_CACHE.clear();
  if (workspaceId) BRAND_CACHE.delete(String(workspaceId)); else BRAND_CACHE.clear();
  CACHE.id = null; CACHE.at = 0;
}

module.exports = {
  brandForWorkspace, SCOPED_TABLES, isScoped, resolve, currentWorkspaceId,
  defaultWorkspaceId, filterFor, stamp, invalidate };
