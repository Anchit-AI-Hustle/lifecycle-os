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
  'kb_knowledge', 'brand_assets', 'smart_calendar_entries',
  'smart_generated_campaigns', 'ads_generated', 'landing_pages_generated',
  'mailers_generated',
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

/** Resolve the workspace for this call. */
async function resolve(env, req, explicit) {
  if (explicit) return explicit;
  const q = (req && req.query) || {};
  const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
  const fromReq = q.workspace_id || body.workspace_id;
  if (fromReq) return String(fromReq);
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

module.exports = { SCOPED_TABLES, isScoped, resolve, defaultWorkspaceId, filterFor, stamp };
