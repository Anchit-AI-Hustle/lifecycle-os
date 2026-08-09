#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
// build-catalog.js — Convert Shopify CSV exports → compact JSON per region
//
// Input:  Knickgasm Product Catalog RegionWise/products_export_{usa,uk,global}.csv
// Output: data/catalog/products_{us,uk,global}.json
//
// Each CSV is a standard Shopify export with multi-row per product:
//   - Row with Image Position=1 → primary image
//   - Multiple rows per Handle → variants/images (we deduplicate)
//   - Only products with Status=active are included
//
// Output JSON per product:
//   { n, i, imgs, t, h, price, compare_at, category, subtitle, paint, tasting_notes, type }
//   i    = primary image (Image Position 1)
//   imgs = full real-image gallery (position-ordered, de-duplicated, capped 10)
//
// Run: node scripts/build-catalog.js
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSV_DIR = path.join(ROOT, 'Knickgasm Product Catalog RegionWise');
const OUT_DIR = path.join(ROOT, 'data', 'catalog');

// Region mapping: filename → market code
const REGIONS = [
  { file: 'products_export_usa.csv',    market: 'us' },
  { file: 'products_export_uk.csv',     market: 'uk' },
  { file: 'products_export_global.csv', market: 'global' }
];

// ── Minimal CSV parser (handles quoted fields with commas/newlines) ─────────
function parseCSV(text) {
  const rows = [];
  let i = 0;
  const len = text.length;

  function parseField() {
    if (i >= len || text[i] === '\n' || text[i] === '\r') return '';
    if (text[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let val = '';
      while (i < len) {
        if (text[i] === '"') {
          if (i + 1 < len && text[i + 1] === '"') {
            val += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          val += text[i];
          i++;
        }
      }
      return val;
    } else {
      // Unquoted field
      let val = '';
      while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
        val += text[i];
        i++;
      }
      return val;
    }
  }

  while (i < len) {
    const row = [];
    while (i < len && text[i] !== '\n' && text[i] !== '\r') {
      row.push(parseField());
      if (i < len && text[i] === ',') i++; // skip comma
    }
    // Skip line endings
    while (i < len && (text[i] === '\n' || text[i] === '\r')) i++;
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      rows.push(row);
    }
  }
  return rows;
}

// ── Tag categorization (matches the SPA's existing tag logic) ───────────────
function deriveTags(tagsStr, type, title) {
  const tags = [];
  const tl = (tagsStr || '').toLowerCase();
  const titleL = (title || '').toLowerCase();

  // Category tags — KNICKGASM's real customisation taxonomy.
  //
  // These keys are SEMANTIC: downstream code reasons about what a tag MEANS
  // (cohort rules in api/_shared/rfm-core.js and brain-analysis.js pick
  // products by tag intent). An earlier pass kept the previous brand's key
  // names and changed only the detection rules, which silently made "sleep"
  // mean wedding pairs and "immunity" mean football pairs - every consumer then
  // reasoned on a lie. Keys and meaning must change together.
  const both = tl + ' ' + titleL;
  if (both.includes('air force') || both.includes('airforce') || both.includes('af1')) tags.push('af1');
  if (both.includes('jordan')) tags.push('jordan');
  if (both.includes('dunk') || both.includes('court vision') || both.includes('air max') || both.includes('ebernon')) tags.push('nike-other');
  if (both.includes('converse') || both.includes('chuck')) tags.push('converse');
  if (both.includes('adidas') || both.includes('samba') || both.includes('stan smith')) tags.push('adidas');
  if (both.includes('anime') || both.includes('demon slayer') || both.includes('jujutsu') || both.includes('jujustu') || both.includes('dragon ball') || both.includes('naruto') || both.includes('one piece') || both.includes('cartoon') || both.includes('goku') || both.includes('tanjiro')) tags.push('anime');
  if (both.includes('football') || both.includes('soccer') || both.includes('cricket') || both.includes('basketball') || both.includes('sport') || both.includes('united') || both.includes('madrid') || both.includes('cr7')) tags.push('sport');
  if (both.includes('car') || both.includes('gtr') || both.includes('bmw') || both.includes('porsche') || both.includes('ferrari') || both.includes('f1') || both.includes('nfs')) tags.push('auto');
  if (both.includes('game') || both.includes('gaming') || both.includes('mario') || both.includes('valorant') || both.includes('spiderman') || both.includes('batman') || both.includes('marvel')) tags.push('gaming');
  if (both.includes('wedding') || both.includes('bride') || both.includes('groom') || both.includes('carnival') || both.includes('couple')) tags.push('wedding');
  if (both.includes('pet') || both.includes('dog') || both.includes('doggo') || both.includes('cat ')) tags.push('pets');
  if (both.includes('bling') || both.includes('crystal') || both.includes('pearl') || both.includes('rhinestone')) tags.push('bling');
  if (both.includes('dye') || both.includes('aesthetic') || both.includes('butterfly') || both.includes('pastel') || both.includes('floral')) tags.push('aesthetic');
  if (both.includes('celebrity') || both.includes('concert') || both.includes('taylor swift') || both.includes('eras')) tags.push('celebrity');
  if (both.includes('lace') || both.includes('accessor') || both.includes('care kit') || both.includes('cleaner') || both.includes('crease')) tags.push('accessories');
  if (both.includes('denim') || both.includes('jacket')) tags.push('apparel');
  if (both.includes('embroider')) tags.push('embroidery');
  if (both.includes('gift')) tags.push('gift');
  if (both.includes('bestseller') || both.includes('best-seller') || both.includes('best seller')) tags.push('bestseller');

  // Deduplicate
  return [...new Set(tags)];
}

// ── Find column index by partial header match ───────────────────────────────
function colIdx(headers, ...patterns) {
  for (const pat of patterns) {
    const pl = pat.toLowerCase();
    const idx = headers.findIndex(h => h.toLowerCase().includes(pl));
    if (idx >= 0) return idx;
  }
  return -1;
}

// ── Process one CSV file ────────────────────────────────────────────────────
function processCSV(filePath, market) {
  console.log(`Processing ${path.basename(filePath)} → ${market}...`);
  const raw = fs.readFileSync(filePath, 'utf8');
  // Remove BOM if present
  const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
  const rows = parseCSV(text);
  if (rows.length < 2) {
    console.warn(`  ⚠ No data rows found`);
    return [];
  }

  const headers = rows[0].map(h => h.trim());
  const data = rows.slice(1);

  // Locate columns
  const iHandle      = colIdx(headers, 'Handle');
  const iTitle       = colIdx(headers, 'Title');
  const iTags        = colIdx(headers, 'Tags');
  const iPublished   = colIdx(headers, 'Published');
  const iPrice       = colIdx(headers, 'Variant Price');
  const iCompareAt   = colIdx(headers, 'Variant Compare At Price');
  const iImageSrc    = colIdx(headers, 'Image Src');
  const iImagePos    = colIdx(headers, 'Image Position');
  const iStatus      = colIdx(headers, 'Status');
  const iType        = colIdx(headers, 'Type');
  const iCategory    = colIdx(headers, 'Product Category');
  const iSubtitle    = colIdx(headers, 'Subtitle (product.metafields.custom.subtitle)', 'Product Card Subtitle');
  const iPaint    = colIdx(headers, 'Paint (product.metafields.custom.paint)', 'Paint content');
  const iTasting     = colIdx(headers, 'Design Notes');
  const iForm        = colIdx(headers, 'Form (product.metafields.custom.form)');
  const iCups        = colIdx(headers, 'No. of Pairs');
  const iPackaging   = colIdx(headers, 'Packaging');

  if (iHandle < 0 || iTitle < 0) {
    console.error(`  ✗ Missing Handle or Title column`);
    return [];
  }

  // Group rows by Handle
  const grouped = new Map();
  for (const row of data) {
    const handle = (row[iHandle] || '').trim();
    if (!handle) continue;
    if (!grouped.has(handle)) grouped.set(handle, []);
    grouped.get(handle).push(row);
  }

  // Process each product
  const products = [];
  for (const [handle, prodRows] of grouped) {
    // Use first row for product-level fields
    const first = prodRows[0];

    // Filter: only active products
    const status = iStatus >= 0 ? (first[iStatus] || '').trim().toLowerCase() : 'active';
    if (status !== 'active') continue;

    const title = (first[iTitle] || '').trim();
    if (!title) continue;

    const tags = iTags >= 0 ? (first[iTags] || '').trim() : '';
    const type = iType >= 0 ? (first[iType] || '').trim() : '';
    const price = iPrice >= 0 ? (first[iPrice] || '').trim() : '';
    const compareAt = iCompareAt >= 0 ? (first[iCompareAt] || '').trim() : '';

    // Collect ALL real product images (Shopify CDN), ordered by Image Position
    // and de-duplicated. `i` stays the primary (position 1) for single-image
    // callers; `imgs` is the full gallery so mailer / ad / landing builders can
    // pull DISTINCT real photos per section instead of repeating one hero shot.
    // These are the actual PDP gallery photos — real packets, boxes and packs,
    // never fabricated.
    const imgPairs = [];
    for (const row of prodRows) {
      const src = iImageSrc >= 0 ? (row[iImageSrc] || '').trim() : '';
      if (!src) continue;
      const posN = parseInt(iImagePos >= 0 ? (row[iImagePos] || '') : '', 10);
      imgPairs.push({ src, pos: isFinite(posN) ? posN : 9999 });
    }
    imgPairs.sort((a, b) => a.pos - b.pos);
    const imgs = [...new Set(imgPairs.map((x) => x.src))].slice(0, 10);
    const image = imgs[0] || '';

    // Extract metafields from first row
    const subtitle   = iSubtitle >= 0 ? (first[iSubtitle] || '').trim() : '';
    const paint   = iPaint >= 0 ? (first[iPaint] || '').trim() : '';
    const design    = iTasting >= 0 ? (first[iTasting] || '').trim() : '';
    const form       = iForm >= 0 ? (first[iForm] || '').trim() : '';
    const pairs       = iCups >= 0 ? (first[iCups] || '').trim() : '';
    const packaging  = iPackaging >= 0 ? (first[iPackaging] || '').trim() : '';

    const derivedTags = deriveTags(tags, type, title);
    if (!derivedTags.length) derivedTags.push('general');

    const product = {
      n: title,
      i: image,
      t: derivedTags,
      h: handle
    };
    // Full real-image gallery (only when there is more than the primary).
    if (imgs.length > 1) product.imgs = imgs;
    // Only include price fields if they have values
    if (price) product.price = price;
    if (compareAt && compareAt !== price) product.compare_at = compareAt;
    if (type) product.type = type;
    if (subtitle) product.subtitle = subtitle;
    if (paint) product.paint = paint;
    if (design) product.tasting_notes = design;
    if (form) product.form = form;
    if (pairs) product.pairs = pairs;
    if (packaging) product.packaging = packaging;

    products.push(product);
  }

  console.log(`  ✓ ${products.length} active products (from ${grouped.size} total handles)`);
  return products;
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  // Ensure output directory exists
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let totalProducts = 0;

  for (const region of REGIONS) {
    const csvPath = path.join(CSV_DIR, region.file);
    if (!fs.existsSync(csvPath)) {
      console.warn(`⚠ CSV not found: ${region.file} — skipping`);
      continue;
    }

    const products = processCSV(csvPath, region.market);
    const outPath = path.join(OUT_DIR, `products_${region.market}.json`);
    fs.writeFileSync(outPath, JSON.stringify(products), 'utf8');
    const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
    console.log(`  → ${outPath} (${sizeKB} KB, ${products.length} products)`);
    totalProducts += products.length;
  }

  console.log(`\n✓ Build complete: ${totalProducts} total products across ${REGIONS.length} regions`);
}

// Export shared helpers so the live storefront scraper reuses identical
// categorization (scripts/scrape-catalog.js). Only run the CSV build when this
// file is executed directly, not when required.
module.exports = { deriveTags };

if (require.main === module) {
  main();
}
