#!/usr/bin/env node
'use strict';
/**
 * Lowers tests/brand-theme-baseline/<page>.json from an inventory run.
 *
 *   BRAND_THEME_INVENTORY=/tmp/bt npx playwright test tests/brand-theme-every-page.spec.js --project=desktop-1280
 *   node tests/lib/brand-theme-baseline.js /tmp/bt            # print what would change
 *   node tests/lib/brand-theme-baseline.js /tmp/bt --write    # apply it
 *
 * One file per page (or Studio sequence), so fixes to different pages never
 * touch the same file. --write only ever LOWERS a page: a page that measured
 * more than its file holds is reported and left alone (the ratchet only
 * shrinks), a page that measured clean has its file deleted, and a page with
 * no file is never given one (it was clean; fix it instead). --init, used
 * once to create the baseline, is the only mode that writes new files. Only
 * full runs (all five palettes) count; a scoped run is diagnostic.
 */
const fs = require('fs');
const path = require('path');
const H = require('./brand-theme-harness');

const dir = process.argv[2];
const init = process.argv.includes('--init');
const write = init || process.argv.includes('--write');
if (!dir) { console.error('usage: brand-theme-baseline.js <inventory dir> [--write|--init]'); process.exit(2); }
const FULL = Object.keys(H.PALETTES).length;
const base = H.readBaseline();

let changes = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!rec.key || !rec.kinds) continue;
  if ((rec.palettesMeasured || []).length !== FULL) { console.log('skip (scoped run):', rec.key); continue; }
  const counts = Object.fromEntries(Object.entries(rec.kinds).filter(([, n]) => n > 0).sort());
  const was = base[rec.key];
  const file = H.baselineFile(rec.key);
  if (!Object.keys(counts).length) {
    if (was) { console.log('clean, delete:', path.relative(H.ROOT, file)); changes++; if (write) fs.unlinkSync(file); }
    continue;
  }
  if (!was && !init) { console.log('NO BASELINE (it was clean; fix it instead), left alone:', rec.key, JSON.stringify(counts)); continue; }
  if (was && Object.entries(counts).some(([k, n]) => n > (was[k] || 0))) {
    console.log('ROSE, left alone:', rec.key, JSON.stringify(counts), 'baseline', JSON.stringify(was));
    continue;
  }
  const same = was && JSON.stringify(Object.fromEntries(Object.entries(was).filter(([k]) => k !== '__file').sort())) === JSON.stringify(counts);
  if (same) continue;
  console.log((was ? 'lower: ' : 'new: ') + path.relative(H.ROOT, file), JSON.stringify(counts));
  changes++;
  if (write) {
    fs.mkdirSync(H.BASELINE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ key: rec.key, counts }, null, 2) + '\n');
  }
}
console.log(changes + ' change(s)' + (write ? ' written' : ' (dry run; --write to apply)'));
