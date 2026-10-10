'use strict';
/**
 * brand_catalog_merge(), as supabase/migrations/20261010002000_catalog_import_merge.sql
 * defines it, installed on a tests/lib/fake-supabase.js project. Moved here
 * from catalog-import-complete.spec.js (2026-10-10) so the store-identity
 * spec writes through the SAME model of the merge.
 */
const { response } = require('./fake-supabase.js');

function installMerge(db) {
  const editorOf = (ws, who) => {
    const w = db.workspaces[ws];
    if (!w) return false;
    if (w.owner_id === who.id) return true;
    return db.members.some((m) => m.workspace_id === ws && m.user_id === who.id && (m.role === 'owner' || m.role === 'editor'));
  };
  db.rpc.brand_catalog_merge = (a, who) => {
    if (who !== 'service' && !editorOf(a.p_workspace, who)) return response(403, { code: '42501', message: 'not authorized to write this workspace\'s catalog' });
    if (!Array.isArray(a.p_rows)) return response(400, { message: 'p_rows must be a jsonb array' });
    const t = db.table('brand_catalog_products');
    const now = db.tick();
    let inserted = 0, updated = 0, staled = 0;
    // (workspace, region, handle, sku) with NULL equal to NULL, indexed once per call.
    const keyOf = (h, k) => JSON.stringify([h == null ? null : String(h), k == null ? null : String(k)]);
    const index = new Map();
    for (const x of t) {
      if (x.workspace_id !== a.p_workspace || x.region !== a.p_region) continue;
      const k = keyOf(x.handle, x.sku);
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(x);
    }
    for (const r of a.p_rows) {
      if (!r.title) continue;
      const handle = r.handle || null, sku = r.sku || null;
      const cols = {
        title: r.title, description: r.description || null, product_type: r.product_type || null, collections: r.collections || [],
        price: r.price == null || r.price === '' ? null : Number(r.price), compare_at: r.compare_at == null || r.compare_at === '' ? null : Number(r.compare_at),
        currency: r.currency || null, image_url: r.image_url || null, image_urls: r.image_urls || [], variants: r.variants || [],
        product_url: r.product_url || null, in_stock: r.in_stock == null ? null : !!r.in_stock, tags: r.tags || [], raw: r.raw || {},
        source: r.source || 'manual', source_url: r.source_url || null,
        import_batch: a.p_run, last_seen_run: a.p_run, last_seen_at: now, stale_at: null, updated_at: now,
      };
      const hits = index.get(keyOf(handle, sku)) || [];
      if (hits.length) { for (const h of hits) Object.assign(h, cols); updated += 1; }
      else { index.set(keyOf(handle, sku), [db.insert('brand_catalog_products', Object.assign({ workspace_id: a.p_workspace, region: a.p_region, handle, sku }, cols))]); inserted += 1; }
    }
    if (a.p_complete) {
      for (const x of db.table('brand_catalog_products')) {
        if (x.workspace_id !== a.p_workspace || x.region !== a.p_region || x.stale_at || x.last_seen_run === a.p_run) continue;
        if (!(a.p_family || []).includes(x.source)) continue;
        x.stale_at = now; staled += 1;
      }
    }
    if (a.p_state || a.p_source) {
      for (const w of db.table('brand_workspaces').filter((x) => x.id === a.p_workspace)) {
        if (a.p_state) w.catalog_import = a.p_state;
        if (a.p_source) w.catalog_source = a.p_source;
      }
    }
    const live = db.table('brand_catalog_products').filter((x) => x.workspace_id === a.p_workspace && x.region === a.p_region && !x.stale_at).length;
    return { ok: true, inserted, updated, staled, run: a.p_run, region: a.p_region, live };
  };
}

module.exports = { installMerge };
