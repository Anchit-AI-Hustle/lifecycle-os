#!/usr/bin/env node
'use strict';

/**
 * seed-brand-assets.js — populate the `brand_assets` approved-assets service
 * (migration 20260711120000_brand_assets.sql) with REAL, origin-validated US
 * product imagery for the July asset pipeline.
 *
 * Source of truth: data/catalog/products_us.json (built by `npm run build` from
 * KNICKGASM's real products_export_usa.csv). Each catalog image is a live Shopify
 * store asset; we canonicalise it to the brand-owned CDN host
 * (www.knickgasm.com/cdn/shop/files/...) so it PREFIX-validates against the KNICKGASM
 * allowlist, then persist it via api/_shared/brand-assets-core.js.
 *
 * The hard rule (brand-assets-core): NEVER fabricate a URL. A SKU with no
 * catalog image (e.g. double_spice_353oz, not in the active US catalog) is
 * written as status='placeholder' — never an invented link.
 *
 * Outputs (always): a JSON snapshot (data/brand-assets/us.json) the offline
 * mailer generator consumes, and a SQL seed (supabase/seed/brand_assets_us.sql)
 * that applies the rows without live creds. If SUPABASE_* env is present it also
 * upserts live (idempotent on the natural key).
 *
 * Usage:
 *   node scripts/seed-brand-assets.js            # write snapshot + SQL (+ live upsert if env)
 *   DRY_RUN=1 node scripts/seed-brand-assets.js  # resolve + print, no writes
 */

const fs = require('fs');
const path = require('path');
const core = require('../api/_shared/brand-assets-core.js');

const ROOT = path.join(__dirname, '..');
const US_PDP = 'https://www.knickgasm.com/products/';

// SKU → US handle map (verified against the built catalog; handles are the real
// catalog `h` field, NOT guessed). double_spice_353oz has no active US catalog
// handle → intentionally left unmapped so it becomes a labelled placeholder.
const SKU_MAP = {
  spiderman_af1:        'indias-original-hand-painted-kicks-sneaker-100-sneaker-bags',
  manutd_af1:         'indias-original-hand-painted-kicks-sneaker-hand-painted-12oz',
  gtr_af1:         'indias-original-hand-painted-kicks-sneaker-30-sneaker-bags',
  double_spice_353oz:       null, // not in active US catalog → placeholder (never invented)
  demon_slayer_af1:    'embroidery-neon-themed-sneaker-100-sneaker-bags',
  dbz_af1:         'daily-airforce-black-sneaker-12oz',
  jordan1_golf:     'signature-green-sneaker-hand-painted-12oz',
  taylor_af1:   'classic-english-breakfast-black-hand-painted-sneaker-12oz',
  rope_laces_af1: 'castleton-classic-jordan-second-flush-black-sneaker-dj-354',
  care_kit:      'assorted-sneaker-bags-sampler-2-x-20-variants',
};

// Brand-owned US logo (replaces the .co.uk logo for US mailers — per brief).
const US_LOGO = 'https://www.knickgasm.com/cdn/shop/files/logo-website_3.png?v=1754032931';

function loadCatalog() {
  const p = path.join(ROOT, 'data', 'catalog', 'products_us.json');
  if (!fs.existsSync(p)) {
    console.error('data/catalog/products_us.json missing — run `npm run build` first.');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Array.isArray(raw) ? raw : (raw.products || []);
}

function main() {
  const cat = loadCatalog();
  const byHandle = Object.fromEntries(cat.map((p) => [p.h, p]));
  const rows = [];

  // Brand logo asset.
  rows.push(core.buildRow({
    sku_key: 'logo', asset_type: 'logo', url: US_LOGO,
    alt: 'KNICKGASM logo (US)', width: 1000, height: null,
    source_pdp: 'https://www.knickgasm.com', region: 'us',
  }));

  for (const [sku, handle] of Object.entries(SKU_MAP)) {
    const prod = handle ? byHandle[handle] : null;
    if (!prod || !prod.i) {
      rows.push(core.placeholderRow({
        sku_key: sku, asset_type: 'product',
        alt: prod ? `${prod.n} (no image in catalog)` : `${sku}: no verified US handle`,
        source_pdp: handle ? US_PDP + handle : null, region: 'us',
      }));
      continue;
    }
    rows.push(core.buildRow({
      sku_key: sku, asset_type: 'product', url: prod.i,
      alt: prod.n, width: 1000, height: 1000,
      source_pdp: US_PDP + handle, region: 'us',
    }));
  }

  const verified = rows.filter((r) => r.status === 'verified');
  const placeholder = rows.filter((r) => r.status === 'placeholder');
  console.log(`Resolved ${rows.length} brand_assets rows: ${verified.length} verified, ${placeholder.length} placeholder.`);
  placeholder.forEach((r) => console.log(`  placeholder: ${r.sku_key}/${r.asset_type} — ${r.alt}`));

  if (process.env.DRY_RUN) {
    console.log('DRY_RUN — sample verified row:\n', JSON.stringify(verified[0], null, 2));
    return Promise.resolve();
  }

  // 1) JSON snapshot (source for the offline mailer generator).
  const snapDir = path.join(ROOT, 'data', 'brand-assets');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(path.join(snapDir, 'us.json'), JSON.stringify(rows, null, 2));
  console.log(`✓ wrote data/brand-assets/us.json (${rows.length} rows)`);

  // 2) SQL seed (idempotent upsert on the natural key).
  const sql = [
    '-- brand_assets_us.sql — generated by scripts/seed-brand-assets.js',
    '-- REAL, origin-validated US product imagery. Do not hand-edit; re-run the seeder.',
    'insert into public.brand_assets (sku_key, asset_type, url, alt, width, height, source_pdp, origin_validated, status, region) values',
    rows.map((r) => `  (${sqlStr(r.sku_key)}, ${sqlStr(r.asset_type)}, ${sqlStr(r.url)}, ${sqlStr(r.alt)}, ${sqlNum(r.width)}, ${sqlNum(r.height)}, ${sqlStr(r.source_pdp)}, ${r.origin_validated}, ${sqlStr(r.status)}, ${sqlStr(r.region)})`).join(',\n'),
    'on conflict (sku_key, asset_type, url) do update set',
    '  alt = excluded.alt, width = excluded.width, height = excluded.height,',
    '  source_pdp = excluded.source_pdp, origin_validated = excluded.origin_validated,',
    '  status = excluded.status, region = excluded.region;',
    '',
  ].join('\n');
  const seedDir = path.join(ROOT, 'supabase', 'seed');
  fs.mkdirSync(seedDir, { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'brand_assets_us.sql'), sql);
  console.log('✓ wrote supabase/seed/brand_assets_us.sql');

  // 3) Live upsert when Supabase env is present.
  let supaOk = false;
  try { require('../api/_shared/supa.js').env(); supaOk = true; } catch { /* no creds */ }
  if (!supaOk) {
    console.log('· Supabase env not set — skipped live upsert (snapshot + SQL written).');
    return Promise.resolve();
  }
  return core.upsertAssets(rows).then((res) => {
    console.log(`✓ upserted ${(res || []).length} rows into brand_assets.`);
  });
}

function sqlStr(v) { return v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`; }
function sqlNum(v) { return v == null ? 'null' : Number(v); }

Promise.resolve().then(main).catch((e) => { console.error('seed-brand-assets failed:', e.message); process.exit(1); });
