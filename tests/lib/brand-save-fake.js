'use strict';
/**
 * A fake project (tests/lib/fake-supabase.js) with brand_workspace_save and the
 * provenance functions, statement for statement as the migrations define
 * them. Moved here from brand-record-coherence.spec.js (2026-10-10) so other
 * specs save a brand through the same model.
 */
const { FakeSupabase } = require('./fake-supabase.js');
const clone = (o) => JSON.parse(JSON.stringify(o));

function makeDb(TOKEN, OWNER) {
  const db = new FakeSupabase();
  db.addUser(TOKEN, OWNER, 'owner@example.test');
  db.mayRead = (user, wsId) => {
    if (!user || !wsId) return false;
    const ws = db.table('brand_workspaces').find((r) => r.id === wsId);
    return !!ws && ws.owner_id === user.id;
  };
  const RANK = { user: 50, document: 40, 'site-render': 30, 'site-parse': 20, preset: 10, default: 0 };
  const prov = (ws, field) => db.table('brand_field_provenance').find((r) => r.workspace_id === ws && r.field === field) || null;
  const putProv = (ws, field, rec) => {
    const have = prov(ws, field);
    if (have) Object.assign(have, rec); else db.table('brand_field_provenance').push(Object.assign({ workspace_id: ws, field }, rec));
  };
  // supabase/migrations/20261004170000_brand_workspace_save.sql, statement for statement.
  db.rpc.brand_workspace_save = (a, who) => {
    const w = db.table('brand_workspaces').find((r) => r.id === a.p_workspace);
    if (!w || w.owner_id !== who.id) return { ok: false, error: 'not_found' };
    if (a.p_expected && w.updated_at !== a.p_expected) return { ok: false, error: 'stale', reason: 'row' };
    for (const [k, v] of Object.entries(a.p_seen || {})) {
      const have = (prov(w.id, k) || {}).origin || null;
      if (have !== (v || null)) return { ok: false, error: 'stale', reason: 'owner', field: k };
    }
    for (const [k, v] of Object.entries(a.p_origins || {})) {
      const have = (prov(w.id, k) || {}).origin;
      if (have && (RANK[have] || 0) > (RANK[(v && v.origin) || ''] || 0)) return { ok: false, error: 'precedence', field: k, owner: have };
    }
    const cols = ['slug', 'name', 'legal_name', 'tagline', 'industry', 'website', 'logo_url', 'favicon_url', 'palette', 'typography', 'voice', 'regions', 'asset_hosts', 'catalog_source', 'brand_data', 'status', 'onboarding_step'];
    for (const c of cols) if (a.p_row && a.p_row[c] !== undefined) w[c] = clone(a.p_row[c]);
    w.updated_at = db.tick();
    for (const k of a.p_typed || []) putProv(w.id, k, { origin: 'user', signal: 'supplied by the operator', source_url: null });
    for (const [k, v] of Object.entries(a.p_origins || {})) {
      const o = (v && v.origin) || '';
      if (['document', 'site-render', 'site-parse', 'preset'].includes(o)) putProv(w.id, k, { origin: o, source_url: v.source_url || null, signal: v.signal || null });
    }
    return { ok: true, row: clone(w) };
  };
  db.rpc.brand_fields_claim_user = (a) => { for (const f of a.p_fields || []) putProv(a.p_workspace, f, { origin: 'user' }); return null; };
  db.rpc.brand_fields_record_origin = (a) => {
    for (const [f, v] of Object.entries(a.p_fields || {})) {
      const have = (prov(a.p_workspace, f) || {}).origin;
      const o = (v && v.origin) || '';
      if (!have || (RANK[o] || 0) > (RANK[have] || 0)) putProv(a.p_workspace, f, { origin: o, source_url: (v && v.source_url) || null });
    }
    return null;
  };
  // A brand_workspaces insert stamps updated_at like the column default.
  const insert = db.rest.bind(db);
  db.rest = (table, qs, method, body, headers, who) => {
    if (table === 'brand_workspaces' && method === 'POST') for (const r of (Array.isArray(body) ? body : [body])) r.updated_at = db.tick();
    return insert(table, qs, method, body, headers, who);
  };
  return db;
}

module.exports = { makeDb };
