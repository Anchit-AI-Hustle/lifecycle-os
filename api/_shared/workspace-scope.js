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

const SCOPED_TABLES = new Set([
  // Content that belongs to exactly ONE brand. Every table here carries a
  // workspace_id column; a read must filter by it and a write must stamp it.
  // Keep this list in sync with api/_shared/workspace-scope.js SCOPED_TABLES -
  // a table with workspace_id that is MISSING here reads across brands and
  // writes NULL (invisible rows), which is exactly how competitor rows and
  // social posts previously landed unattributed.
  'kb_knowledge', 'brand_assets', 'smart_calendar_entries',
  'smart_generated_campaigns', 'smart_generated_assets', 'ads_generated',
  'landing_pages_generated', 'mailers_generated', 'social_posts_generated',
  'competitor_brands', 'competitor_emails_classified', 'competitor_landing_pages',
  'smart_competitor_campaigns', 'smart_competitor_signals', 'smart_products',
  'smart_orders', 'smart_users', 'smart_events', 'smart_campaigns',
  'smart_cohorts', 'smart_festivals', 'smart_funnels', 'smart_sales_history',
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
  return defaultWorkspaceId(env);
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

module.exports = {
  brandForWorkspace, SCOPED_TABLES, isScoped, resolve, defaultWorkspaceId, filterFor, stamp };
