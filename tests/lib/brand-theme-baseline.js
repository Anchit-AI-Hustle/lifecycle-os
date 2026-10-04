#!/usr/bin/env node
'use strict';
/**
 * Prints the tests/brand-theme-baseline.json entries an inventory run measured.
 *
 *   BRAND_THEME_INVENTORY=/tmp/bt npx playwright test tests/brand-theme-every-page.spec.js --project=desktop-1280
 *   node tests/lib/brand-theme-baseline.js /tmp/bt            # print
 *   node tests/lib/brand-theme-baseline.js /tmp/bt --write    # merge into the baseline
 *
 * --write only ever LOWERS a page (--init, once, also adds pages): an entry that measured more than the
 * baseline holds is reported and left alone (the ratchet only shrinks), and a
 * page that measured clean is removed. Only full runs (all five palettes)
 * count; a scoped run is diagnostic.
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const init = process.argv.includes('--init');
const write = init || process.argv.includes('--write');
if (!dir) { console.error('usage: brand-theme-baseline.js <inventory dir> [--write]'); process.exit(2); }
const FILE = path.join(__dirname, '..', 'brand-theme-baseline.json');
const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const FULL = 5;

const measured = {};
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!rec.key || !rec.kinds) continue;
  if ((rec.palettesMeasured || []).length !== FULL) { console.log('skip (scoped run):', rec.key); continue; }
  measured[rec.key] = rec.kinds;
}
const out = Object.assign({}, base);
for (const [key, kinds] of Object.entries(measured)) {
  const clean = Object.fromEntries(Object.entries(kinds).filter(([, n]) => n > 0));
  const was = base[key];
  if (!Object.keys(clean).length) {
    if (was) console.log('clean, remove:', key);
    delete out[key];
    continue;
  }
  if (was && Object.entries(clean).some(([k, n]) => n > (was[k] || 0))) {
    console.log('ROSE, left alone:', key, JSON.stringify(clean), 'baseline', JSON.stringify(was));
    continue;
  }
  if (!was && !init) { console.log('NOT IN BASELINE (it was clean; fix it instead), left alone:', key, JSON.stringify(clean)); continue; }
  out[key] = clean;
}
const sorted = {};
for (const k of Object.keys(out).sort()) sorted[k] = out[k];
if (write) {
  fs.writeFileSync(FILE, JSON.stringify(sorted, null, 2) + '\n');
  console.log('wrote', FILE, Object.keys(sorted).filter((k) => !k.startsWith('_')).length, 'entries');
} else {
  console.log(JSON.stringify(sorted, null, 2));
}
