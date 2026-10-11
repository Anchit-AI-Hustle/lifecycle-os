#!/usr/bin/env node
'use strict';
/**
 * scripts/catalog-probe.js — read ONE store with the SHIPPED catalogue importer,
 * no database, and report exactly what it walked.
 * ---------------------------------------------------------------------------
 * Why: the agent containers that edit this repo cannot reach brand hosts
 * (2026-10-11: lenskart.com and nykaa.com both answered with the egress
 * proxy's refusal), so the live sitemap shapes behind "21 URLs" could only be
 * modelled. GitHub's runners can reach them. .github/workflows/catalog-probe.yml
 * runs this on a dispatch, read-only.
 *
 * What it runs: brand-workspace-core.rowsFromStore() - the same reader the
 * import op, the device import, the chain and the daily refresh use, with its
 * SSRF guard, its honest user agent, robots.txt (RFC 9309) and Retry-After -
 * step after step from its own cursor until the store is read, the step limit
 * is reached, or a step reads nothing new. Nothing is written anywhere but
 * the output directory.
 *
 * Output (in --out): coverage.json (every step's coverage), sample.json (the
 * first rows read, every field), sitemaps.json (the sitemap tree the importer
 * walked: each sitemap, index or urlset, and how many entries it declared),
 * summary.md (also appended to $GITHUB_STEP_SUMMARY when set).
 *
 *   node scripts/catalog-probe.js --url https://www.example.com --region IN [--steps 6] [--budget 50000] [--out dir]
 */
const fs = require('fs');
const path = require('path');

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; o[k] = v; }
  }
  return o;
}

async function probe({ url, region, steps = 6, budgetMs = 50000, sample = 25 }) {
  const core = require('../api/_shared/brand-workspace-core.js');
  const scope = { website: url, regions: region ? [{ code: String(region).toUpperCase(), home: true }] : [] };
  const reg = require('../api/_shared/catalog-import.js').canonRegion(region || '');
  if (!reg) throw new Error(`"${region}" is not a market code the importer knows.`);
  const out = { url, region: reg, steps: [], rows: [], sitemaps: [], complete: false, found: 0 };
  let cursor = null;
  for (let i = 0; i < steps; i++) {
    const t = Date.now();
    const r = await core.rowsFromStore(url, reg, scope, { cursor, budgetMs });
    out.steps.push({ step: i + 1, ms: Date.now() - t, rows: r.rows.length, complete: !!r.complete, progressed: r.progressed !== false, coverage: r.coverage });
    if (out.rows.length < sample) out.rows.push(...r.rows.slice(0, sample - out.rows.length));
    const sm = (r.cursor && r.cursor.sm) || null;
    const tree = (sm && sm.sources) || (r.coverage && r.coverage.sitemap && r.coverage.sitemap.sources) || [];
    if (tree.length >= out.sitemaps.length) out.sitemaps = tree;
    out.found = r.coverage ? r.coverage.found : out.found;
    out.complete = !!r.complete;
    if (r.complete || r.progressed === false) break;
    cursor = r.cursor;
  }
  return out;
}

function summary(o) {
  const last = o.steps[o.steps.length - 1] || {};
  const cov = last.coverage || {};
  const lines = [
    `## Catalogue probe: ${o.url} (${o.region.toUpperCase()})`,
    '',
    `${o.steps.length} step(s); ${o.found} products read; ${o.complete ? 'complete' : 'not complete'}.`,
    '',
    '### Coverage (last step, the importer\'s own sentences)',
    ...(cov.sentences || []).map((x) => `- ${x}`),
    '',
    `### Sitemaps walked (${o.sitemaps.length})`,
    '| sitemap | kind | entries | product sitemap |',
    '|---|---|---|---|',
    ...o.sitemaps.slice(0, 80).map((s) => `| ${s.url} | ${s.kind} | ${s.declared} | ${s.products ? 'yes' : ''} |`),
    '',
    `### Sample rows (${o.rows.length})`,
    '| title | price | currency | image | url |',
    '|---|---|---|---|---|',
    ...o.rows.slice(0, 15).map((r) => `| ${String(r.title || '').replace(/\|/g, '/')} | ${r.price == null ? '' : r.price} | ${r.currency || ''} | ${r.image_url ? 'yes' : ''} | ${r.product_url || ''} |`),
  ];
  return lines.join('\n') + '\n';
}

async function main() {
  const a = args(process.argv.slice(2));
  if (!a.url) { console.error('Usage: node scripts/catalog-probe.js --url <store url> --region <market> [--steps N] [--budget ms] [--out dir]'); process.exit(2); }
  const dir = path.resolve(a.out || 'catalog-probe-out');
  fs.mkdirSync(dir, { recursive: true });
  const o = await probe({ url: a.url, region: a.region || '', steps: Math.max(1, Math.min(20, Number(a.steps) || 6)), budgetMs: Math.max(5000, Math.min(110000, Number(a.budget) || 50000)) });
  fs.writeFileSync(path.join(dir, 'coverage.json'), JSON.stringify(o.steps, null, 2));
  fs.writeFileSync(path.join(dir, 'sample.json'), JSON.stringify(o.rows, null, 2));
  fs.writeFileSync(path.join(dir, 'sitemaps.json'), JSON.stringify(o.sitemaps, null, 2));
  const md = summary(o);
  fs.writeFileSync(path.join(dir, 'summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
}

if (require.main === module) main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
module.exports = { probe, summary };
