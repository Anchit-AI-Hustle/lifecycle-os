#!/usr/bin/env node
'use strict';

/**
 * seed-smart-products.js — load the REAL product catalog into the linked DB's
 * smart_products table, so the Smart Brain's product selection + generation run
 * on actual KNICKGASM products (not just fallbacks).
 *
 * Source of truth: data/catalog/products_{us,uk,global}.json (built by
 * `npm run build` from the real products_export_*.csv). Maps each catalog row
 * to the smart_products shape defined in 20260609_smart_brain.sql:
 *   id, sku, title, handle, category, market, price, tags(jsonb), metadata(jsonb)
 *
 * Connection: reuses the brain's linked-DB adapter (api/_shared/brain-core.js →
 * data/linked-db.json, overridable via SMART_BRAIN_SUPABASE_URL /
 * SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY). Idempotent upsert on id.
 *
 * Usage:
 *   node scripts/seed-smart-products.js              # upsert all regions
 *   DRY_RUN=1 node scripts/seed-smart-products.js     # map + print, no writes
 *   REGIONS=us,uk node scripts/seed-smart-products.js # subset
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REGION_FILES = { US: 'products_us.json', UK: 'products_uk.json', Global: 'products_global.json' };

function loadCatalog(region) {
  const file = path.join(ROOT, 'data', 'catalog', REGION_FILES[region]);
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : (raw.products || []);
}

// Map one catalog row → smart_products row. Catalog fields:
// n(name) i(image) t(tags[]) h(handle) price type subtitle paint tasting_notes form pairs packaging
function toSmartProduct(p, market) {
  const handle = p.h || (p.n || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const tags = []
    .concat(Array.isArray(p.t) ? p.t : [])
    .concat(p.form ? [String(p.form).toLowerCase()] : [])
    .concat(p.paint ? [`paint:${String(p.paint).toLowerCase()}`] : [])
    .filter(Boolean);
  return {
    id: `prod_${market.toLowerCase()}_${handle}`.slice(0, 120),
    sku: handle,
    title: p.n || p.title || handle,
    handle,
    category: p.type || (Array.isArray(p.t) ? p.t[0] : null) || 'sneaker',
    market,
    price: Number(p.price) || null,
    tags,
    metadata: {
      image: p.i || null, subtitle: p.subtitle || null, paint: p.paint || null,
      tasting_notes: p.tasting_notes || null, form: p.form || null, pairs: p.pairs || null,
      packaging: p.packaging || null,
      url: handle ? `${({ US: 'https://knickgasm.com', UK: 'https://knickgasm.com', Global: 'https://knickgasm.com' })[market]}/products/${handle}` : null,
    },
    updated_at: new Date().toISOString(),
  };
}

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

(async () => {
  const regions = (process.env.REGIONS ? process.env.REGIONS.split(',') : ['US', 'UK', 'Global'])
    .map((r) => r.trim()).map((r) => (r.toLowerCase() === 'us' ? 'US' : r.toLowerCase() === 'uk' ? 'UK' : 'Global'));

  const rows = [];
  for (const region of regions) {
    const cat = loadCatalog(region);
    cat.forEach((p) => { if (p && (p.n || p.title)) rows.push(toSmartProduct(p, region)); });
    console.log(`  ${region}: ${cat.length} catalog products`);
  }
  // de-dupe by id (a product can repeat across regional files)
  const byId = new Map(); rows.forEach((r) => byId.set(r.id, r));
  const unique = [...byId.values()];
  console.log(`Mapped ${unique.length} unique smart_products rows.`);

  if (process.env.DRY_RUN) {
    console.log('DRY_RUN — sample row:\n', JSON.stringify(unique[0], null, 2));
    console.log(`(no writes) would upsert ${unique.length} rows to smart_products`);
    return;
  }

  const { db } = require('../api/_shared/brain-core.js');
  let written = 0;
  for (const part of chunk(unique, 400)) {
    await db().upsert('smart_products', part, 'id');
    written += part.length;
    process.stdout.write(`  upserted ${written}/${unique.length}\r`);
  }
  console.log(`\n✓ Seeded ${written} products into smart_products.`);
})().catch((e) => { console.error('seed failed:', e.message); process.exit(1); });
