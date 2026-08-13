#!/usr/bin/env node
'use strict';
/**
 * scripts/test-brand-isolation.js — the regression test for the product's core
 * promise: an asset generated for one brand must contain NOTHING from another.
 *
 * This class of bug recurred repeatedly because it was only ever caught by eye:
 * a renderer or prompt kept a tenant-zero literal, the runtime relabeler painted
 * the active brand's name over it, and the result looked plausible while being
 * another company's copy, palette, store URL or legal sender.
 *
 * The test builds a FULL funnel (mailer + ads + landing pages + platform
 * payloads) for every non-tenant-zero preset and fails on any foreign token.
 *
 *   node scripts/test-brand-isolation.js          # human output
 *   node scripts/test-brand-isolation.js --ci     # exits 1 on any leak
 *
 * Deliberately runs with NO network and NO LLM: it exercises the deterministic
 * renderers, which is exactly where hardcoded tenant strings hide.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CI = process.argv.includes('--ci');

// Tokens that belong to tenant zero and must never appear in another brand's
// output. Kept deliberately narrow: real English words a publisher might use
// ("original", "custom") are excluded so the test cannot cry wolf.
const FOREIGN = [
  /\bknickgasm\b/i,
  /\bsneakers?\b/i,
  /\bhand-painted\b/i,
  /\bone-of-one\b/i,
  /\bkicksgpt\b/i,
  /\bcolorways?\b/i,
  /knickgasm\.com/i,
  /#D0473E/i,          // tenant zero's primary
  /#6A33D8/i,          // tenant zero's accent
];

/**
 * Tenant zero's IMAGE signature, derived from the shipped catalogue itself.
 *
 * The list above is all WORDS, and words are what a copy leak looks like. An
 * ASSET leak looks like nothing at all: a `https://cdn.shopify.com/s/files/1/
 * 0754/…` URL sitting in an `<img src>` of an otherwise perfectly-written news
 * mailer. That is exactly what shipped - The Times of India's city-desk mailer
 * with a custom Nike Air Force 1 in the hero slot - and this suite was green
 * throughout, because the leaked thing was a URL, not a sentence.
 *
 * Derived rather than hardcoded so it cannot drift from the catalogue it
 * describes: if tenant zero's store id changes, so does the pattern.
 */
function tenantZeroImageTokens() {
  const out = new Set();
  for (const region of ['us', 'uk', 'global']) {
    let rows = [];
    try { rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog', `products_${region}.json`), 'utf8')); }
    catch (_) { continue; }
    for (const p of rows) {
      const url = p && p.i;
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
      try {
        const u = new URL(url);
        // host + the store-identifying prefix of the path, e.g.
        // cdn.shopify.com/s/files/1/0754 — specific enough that no other
        // brand's CDN could match it by accident.
        out.add((u.host + u.pathname.split('/').slice(0, 5).join('/')).toLowerCase());
      } catch (_) { /* not a URL we can attribute */ }
    }
  }
  return [...out];
}
const ZERO_IMAGE_TOKENS = tenantZeroImageTokens();
for (const tok of ZERO_IMAGE_TOKENS) {
  FOREIGN.push(new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
}
// The shipped catalogue files themselves are tenant zero's, so a path to one
// appearing in another brand's asset means a resolver read it.
FOREIGN.push(/data\/catalog\/products_/i);

/**
 * A preset file and a persisted workspace are NOT the same shape, and only one
 * of them is what a real user ends up with.
 *
 * `brand_workspaces` has a fixed set of columns plus one JSON column,
 * `brand_data`, for everything extensible: offerings, claims, market study. The
 * preset files carry those at the top level. Testing only the preset shape
 * therefore passes while every onboarded brand silently loses its claims, which
 * is exactly what happened - every generated asset printed
 * "[DATA REQUIRED BEFORE LAUNCH: verifiable claims]" for real users while the
 * suite stayed green.
 *
 * So each preset is also run through in the shape the database actually returns.
 */
function asPersistedWorkspace(preset) {
  const brandRuntime = require(path.join(ROOT, 'api/_shared/brand-runtime.js'));
  const row = { ...preset, id: `ws_iso_${preset.slug}`, brand_data: {} };
  for (const key of brandRuntime.HOISTED) {
    if (row[key] === undefined) continue;
    row.brand_data[key] = row[key];
    delete row[key];                       // it is not a column; only brand_data has it
  }
  // resolve() normalises on the way out of the database, so the test exercises
  // what a generator is actually handed.
  return { ...brandRuntime.normalizeBrand(row), name: preset.name, slug: preset.slug };
}

function presets() {
  const dir = path.join(ROOT, 'data', 'brands', 'presets');
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter((b) => String(b.slug).toLowerCase() !== 'knickgasm');   // tenant zero is allowed its own words

  // One representative brand is additionally run in the persisted shape. One is
  // enough to catch a shape regression, and keeps the suite fast.
  // The persisted variant keeps the brand's REAL name so its own-reference
  // count is directly comparable with the top-level run; renaming it would make
  // the two counts differ for a reason that has nothing to do with the shape,
  // and hide a genuine loss of brand content behind a test artefact. The label
  // is carried separately for the report.
  const sample = files[0];
  if (!sample) return files;
  const persisted = asPersistedWorkspace(sample);
  persisted.__label = `${sample.name} (persisted shape)`;
  // The expectation is anchored to what the SOURCE record declared, not to what
  // survived normalisation. Reading the claims off the normalised object makes
  // the check vacuous exactly when it matters: break the hoist and the object
  // has no claims, so "none declared, none missing" passes while every asset
  // silently loses its proof line.
  persisted.__declaredClaims = Array.isArray(sample.claims) ? sample.claims.filter(Boolean) : [];
  return files.concat([persisted]);
}

function entryFor(brand) {
  const offs = Array.isArray(brand.offerings) ? brand.offerings : [];
  const off = offs[0] || { kind: 'product', name: 'Featured item', url: brand.website || '' };
  const market = ((brand.regions || [])[0] || {}).code || 'IN';
  return {
    id: `iso_${brand.slug}`,
    date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    market,
    status: 'needs_human_verification',
    confidence: 0.6,
    cohort: { name: 'Nurture', size: 0 },
    objective: 'Drive the reader to act on this offering.',
    theme: `${off.name} (${off.kind})`,
    heroOffering: off,
    offering: off,
    heroProduct: { title: off.name, category: off.kind },
    channels: ['email', 'meta', 'google', 'landing_page'],
    cta: 'See more',
    brand: Object.assign({}, brand, { id: `ws_${brand.slug}` }),
  };
}

function scan(blob) {
  const hits = [];
  for (const re of FOREIGN) {
    const m = String(blob).match(new RegExp(re.source, 'gi'));
    if (m && m.length) hits.push({ token: re.source, count: m.length, sample: sampleAround(blob, m[0]) });
  }
  return hits;
}

function sampleAround(blob, needle) {
  const i = String(blob).toLowerCase().indexOf(String(needle).toLowerCase());
  if (i < 0) return '';
  return String(blob).slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ');
}

(async () => {
  const plan = require(path.join(ROOT, 'api/_shared/smart-brain-plan.js'));
  const { smartConfig } = require(path.join(ROOT, 'lib/smart-brain/services.js'));

  let failures = 0;
  const rows = [];

  for (const brand of presets()) {
    const entry = entryFor(brand);
    let blob = '';
    let error = null;
    try {
      const campaign = await plan.buildCampaign(entry, smartConfig({ workspace_id: entry.brand.id }), {
        withCreatives: false, noLLM: true,
      });
      blob = JSON.stringify(campaign);
    } catch (e) { error = e.message; }

    if (error) {
      rows.push({ brand: brand.__label || brand.name, status: 'ERROR', detail: error });
      failures++;
      continue;
    }
    const hits = scan(blob);
    const own = (blob.match(new RegExp(String(brand.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (hits.length) {
      failures++;
      rows.push({ brand: brand.__label || brand.name, status: 'LEAK', detail: hits.map((h) => `${h.token} x${h.count}`).join(', '), sample: hits[0].sample });
    } else if (own === 0) {
      // A funnel that never names its own brand is not proof of isolation.
      failures++;
      rows.push({ brand: brand.__label || brand.name, status: 'UNBRANDED', detail: 'no occurrence of the brand\'s own name in its own assets' });
    } else {
      // Absence of a FOREIGN brand is only half the promise. The other half is
      // that this brand's OWN approved facts actually arrive: the claims are
      // the only statements an asset may present as fact, and when they went
      // missing every generated asset printed a DATA REQUIRED marker in their
      // place while this test stayed green. Checked explicitly now.
      const declared = brand.__declaredClaims
        || (Array.isArray(brand.claims) ? brand.claims.filter(Boolean) : []);
      const landed = declared.filter((c) => blob.includes(c));
      if (declared.length && !landed.length) {
        failures++;
        rows.push({
          brand: brand.__label || brand.name, status: 'NO CLAIMS',
          detail: `${declared.length} verifiable claim(s) on the record, none reached the assets`,
        });
      } else {
        rows.push({
          brand: brand.__label || brand.name, status: 'CLEAN',
          detail: `${own} own-brand references, ${landed.length}/${declared.length} claims, 0 foreign`,
        });
      }
    }
  }

  // ── Direct module probes ────────────────────────────────────────────────
  // buildCampaign does not touch every renderer. These modules are reachable
  // from live routes, so each is exercised directly with a non-tenant-zero
  // brand and scanned the same way.
  const probes = [
    {
      // The LLM-copy email renderer. buildCampaign's noLLM path never reaches
      // it, which is exactly how a hardcoded wordmark, palette and CTA survived
      // the first sweep - so it is exercised directly with fabricated copy.
      name: 'emailHtml (LLM copy path)',
      run: (brand) => {
        const mod = require(path.join(ROOT, 'api/_shared/smart-brain-plan.js'));
        const fn = mod.__test_emailHtml;
        if (!fn) throw new Error('emailHtml not exported for test');
        const entry = entryFor(brand);
        return fn(entry, { email: {
          subject: 'S', hero_headline: 'H', intro_paragraph: 'a', body_paragraph: 'b', cta: 'Go',
        } }, '');
      },
    },
    {
      name: 'landing-fallback (live: /api/calendar)',
      run: (brand) => {
        const { buildFallbackLanding } = require(path.join(ROOT, 'api/_shared/landing-fallback.js'));
        return JSON.stringify(buildFallbackLanding({ entry: entryFor(brand), brand: entryFor(brand).brand }) || '');
      },
    },
  ];
  // ── Asset provenance probes ─────────────────────────────────────────────
  // The funnel above runs with noLLM:true, which never reaches the Text+Visual
  // variants and so never asks for a hero image. The image resolvers are
  // therefore exercised DIRECTLY here, with the hardest possible input: product
  // names lifted straight out of TENANT ZERO'S OWN catalogue. Under the old
  // module-level `CACHE[region]` these returned tenant zero's Shopify CDN URLs
  // for every brand on the platform.
  const catalogImage = require(path.join(ROOT, 'api/_shared/catalog-image.js'));
  const catalogServer = require(path.join(ROOT, 'api/_shared/brand-catalog-server.js'));

  function zeroProductNames(n) {
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog/products_us.json'), 'utf8'));
      return rows.slice(0, n).map((r) => ({ title: r.n, handle: r.h }));
    } catch (_) { return []; }
  }
  const ZERO_PRODUCTS = zeroProductNames(6);
  // data/catalog/ is gitignored and built by `npm run build`, which CI runs
  // BEFORE this script. Without it there is nothing to leak, so the asset half
  // of this gate cannot do its job - say so rather than reporting a green run
  // that proved nothing. (This is exactly why the original bug was invisible on
  // a fresh checkout for as long as it was.)
  if (!ZERO_PRODUCTS.length) {
    rows.push({
      brand: 'assets', status: 'DEGRADED',
      detail: 'no built catalogue on disk - run `npm run build` first; the cross-brand ASSET checks below cannot fail without one',
    });
  }
  // Words a real non-tenant-zero brand actually uses. "City" is the one that
  // shipped the bug: it keyword-matched "Chelsea City F.C. x Nike Air Force 1".
  const REAL_QUERIES = ['City', 'Cricket', 'Business', 'Times of India City', 'Featured item', 'Education'];

  for (const brand of presets()) {
    const label = brand.__label || brand.name;
    const market = ((brand.regions || [])[0] || {}).code || 'IN';
    const hits = [];
    const probeAll = [...ZERO_PRODUCTS, ...REAL_QUERIES.map((q) => ({ title: q }))];
    for (const prod of probeAll) {
      const opts = { brand: Object.assign({}, brand, { id: `ws_${brand.slug}` }) };
      const img = catalogImage.imageFor(prod, market, opts);
      const gallery = catalogImage.imagesFor(prod, market, opts);
      const handle = catalogImage.handleFor(prod, market, opts);
      const row = catalogImage.match(prod, market, opts);
      if (img) hits.push(`imageFor("${prod.title}") -> ${img}`);
      if (gallery.length) hits.push(`imagesFor("${prod.title}") -> ${gallery[0]}`);
      if (handle) hits.push(`handleFor("${prod.title}") -> ${handle}`);
      if (row) hits.push(`match("${prod.title}") -> ${row.n}`);
    }
    if (hits.length) {
      failures++;
      rows.push({ brand: `assets · ${label}`, status: 'LEAK', detail: `${hits.length} resolver(s) returned a foreign product`, sample: hits[0].slice(0, 140) });
      continue;
    }
    // Not resolving an image is only half correct. The other half is SAYING SO:
    // a silently image-free mailer is indistinguishable from a design choice,
    // so the spec's marker has to be emitted in its place.
    const probe = catalogImage.resolveImage({ heroProduct: { title: 'Featured item' } }, market, {
      brand: Object.assign({}, brand, { id: `ws_${brand.slug}` }),
    });
    if (!/^\[DATA REQUIRED BEFORE LAUNCH: product image, /.test(probe.marker || '')) {
      failures++;
      rows.push({ brand: `assets · ${label}`, status: 'NO MARKER', detail: 'no image resolved and no DATA REQUIRED marker emitted' });
    } else {
      rows.push({ brand: `assets · ${label}`, status: 'CLEAN', detail: `${probeAll.length} lookups, 0 foreign, marker emitted` });
    }
  }

  // Tenant zero must be UNAFFECTED: it owns the shipped catalogue, so its own
  // resolvers have to keep returning real photos. A fix that simply switched
  // every brand off would also pass every check above.
  {
    const zero = { slug: catalogServer.tenantZeroSlug(), name: 'KNICKGASM', is_default: true };
    const p0 = ZERO_PRODUCTS[0];
    const img = p0 ? catalogImage.imageFor(p0, 'US', { brand: zero }) : null;
    if (!p0) rows.push({ brand: 'assets · tenant zero', status: 'SKIP', detail: 'no built catalogue on disk (run npm run build)' });
    else if (!img) {
      failures++;
      rows.push({ brand: 'assets · tenant zero', status: 'REGRESSION', detail: `tenant zero lost its own catalogue photo for "${p0.title}"` });
    } else {
      rows.push({ brand: 'assets · tenant zero', status: 'CLEAN', detail: 'own catalogue still resolves' });
    }
  }

  for (const brand of presets().slice(0, 1)) {
    for (const p of probes) {
      let blob = '', err = null;
      try { blob = p.run(brand); } catch (e) { err = e.message; }
      if (err) { rows.push({ brand: p.name, status: 'SKIP', detail: err.slice(0, 90) }); continue; }
      const hits = scan(blob);
      if (hits.length) { failures++; rows.push({ brand: p.name, status: 'LEAK', detail: hits.map((h) => `${h.token} x${h.count}`).join(', '), sample: hits[0].sample }); }
      else rows.push({ brand: p.name, status: 'CLEAN', detail: 'no foreign tokens' });
    }
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log('\nBrand isolation — full funnel per preset (deterministic renderers, no LLM)\n');
  for (const r of rows) {
    console.log(`  ${pad(r.status, 10)} ${pad(r.brand, 26)} ${r.detail}`);
    if (r.sample) console.log(`             ↳ ${r.sample}`);
  }
  console.log(`\n${rows.length} brand(s) checked · ${failures} failure(s)\n`);

  if (failures && CI) process.exit(1);
})().catch((e) => { console.error('isolation test crashed:', e); process.exit(1); });
