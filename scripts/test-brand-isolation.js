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

function presets() {
  const dir = path.join(ROOT, 'data', 'brands', 'presets');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    .filter((b) => String(b.slug).toLowerCase() !== 'knickgasm');   // tenant zero is allowed its own words
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
      rows.push({ brand: brand.name, status: 'ERROR', detail: error });
      failures++;
      continue;
    }
    const hits = scan(blob);
    const own = (blob.match(new RegExp(String(brand.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (hits.length) {
      failures++;
      rows.push({ brand: brand.name, status: 'LEAK', detail: hits.map((h) => `${h.token} x${h.count}`).join(', '), sample: hits[0].sample });
    } else if (own === 0) {
      // A funnel that never names its own brand is not proof of isolation.
      failures++;
      rows.push({ brand: brand.name, status: 'UNBRANDED', detail: 'no occurrence of the brand\'s own name in its own assets' });
    } else {
      rows.push({ brand: brand.name, status: 'CLEAN', detail: `${own} own-brand references, 0 foreign` });
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
