#!/usr/bin/env node
'use strict';
/**
 * scripts/harvest-presets.js — read every preset brand's own site end to end
 * and write what it published beside the preset.
 *
 *   node scripts/harvest-presets.js                  # every preset needing it
 *   node scripts/harvest-presets.js --slug nike      # one
 *   node scripts/harvest-presets.js --max-pages 20
 *
 * WHERE THIS CAN RUN. It fetches real brand websites, so it needs an
 * environment with public internet access. The Claude Code container's egress
 * proxy refuses those hosts, so a run there reports `unreachable` per brand and
 * writes nothing. That is the correct outcome, not a failure to handle: a
 * harvest file full of empty fields would be indistinguishable from a brand
 * that publishes nothing.
 *
 * WHAT IT WRITES. `data/brands/presets/<slug>.harvest.json`, holding CANDIDATES
 * with their source URLs plus the image library. It does NOT modify the preset
 * itself: applying a harvested value is a separate, deliberate step through
 * `brand_field_provenance`, which refuses to overwrite anything a human set.
 * Harvest is evidence; the operator still decides.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'data', 'brands', 'presets');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

(async () => {
  const harvester = require(path.join(ROOT, 'api', '_shared', 'brand-harvest.js'));
  const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'));

  const only = arg('slug', '');
  const maxPages = Number(arg('max-pages', 12));
  const targets = index.presets.filter((p) => (only ? p.slug === only : p.needs_extraction));

  if (!targets.length) {
    console.log(only ? `No preset matched --slug ${only}.` : 'No preset is marked needs_extraction.');
    return;
  }

  console.log(`\nHarvesting ${targets.length} preset brand site(s), ${maxPages} pages each.\n`);

  const done = [];
  const blocked = [];

  for (const p of targets) {
    process.stdout.write(`  ${p.slug.padEnd(16)} ${p.website} ... `);
    let out;
    try {
      out = await harvester.harvest(p.website, { maxPages });
    } catch (e) {
      out = { ok: false, reachable: false, error: String((e && e.message) || e) };
    }

    if (!out.reachable) {
      // Never print a number we do not have, and never write a file that would
      // read as "this brand publishes nothing".
      console.log('UNREACHABLE');
      console.log(`      ${out.note || out.error || 'no reason reported'}`);
      blocked.push({ slug: p.slug, why: out.note || out.error });
      continue;
    }

    const file = path.join(DIR, `${p.slug}.harvest.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
    const imgs = (out.images && out.images.total) || 0;
    console.log(`${out.pages_visited} page(s), ${imgs} image(s)`);
    done.push({ slug: p.slug, pages: out.pages_visited, images: imgs });
  }

  console.log(`\n  harvested: ${done.length}   unreachable: ${blocked.length}\n`);

  if (blocked.length) {
    console.log('  These were not read, and nothing was written for them:');
    for (const b of blocked) console.log(`    ${b.slug.padEnd(16)} ${String(b.why || '').slice(0, 120)}`);
    console.log('\n  If every brand is unreachable, this environment cannot reach the public');
    console.log('  internet. Run it from the deployment, or from a machine that can.\n');
    // A run that read nothing is a failure to report, not a success with zeros.
    if (!done.length) process.exitCode = 1;
  }
})().catch((e) => { console.error(e); process.exit(1); });
