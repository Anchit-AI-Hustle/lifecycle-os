#!/usr/bin/env node
'use strict';
/**
 * scripts/check-design-md.js — validate our DESIGN.md against Google's OWN linter.
 *
 *   node scripts/check-design-md.js          report
 *   node scripts/check-design-md.js --fail   exit 1 on any error (CI gate)
 *
 * WHY THIS AND NOT A HAND-WRITTEN ASSERTION. DESIGN.md is an existing open
 * format (google-labs-code/design.md, Apache-2.0), not one this repo invented,
 * and it ships a linter: `npx @google/design.md lint`. Our own tests can only
 * check the shape we THINK the spec has. This checks the shape the spec
 * actually has, using the spec's own tool - including its WCAG contrast rule,
 * which is the same rule the brand tokens are built on.
 *
 * The linter is fetched on demand rather than added as a dependency: it is a
 * verification tool, not something the product ships, and the deploy must not
 * grow a package it never imports. When it cannot be reached the check reports
 * SKIPPED and exits 0 - a network failure is not a format failure, and a gate
 * that fails closed on an unreachable CDN teaches people to ignore it.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FAIL = process.argv.includes('--fail');
const ROOT = path.join(__dirname, '..');

/* A site that publishes a real, complete design system: an identity colour, a
   distinct action colour, two font families, a radius scale and a spacing
   scale. The point is to exercise the tokens we EMIT, so a fixture that
   published nothing would prove nothing. */
const SITE = {
  'https://northwind.example/': `<!doctype html><html><head>
    <meta name="theme-color" content="#1F4E79">
    <title>Northwind Books</title>
    <meta name="description" content="Independent publisher.">
    <style>:root{--brand-primary:#1F4E79;--radius-sm:4px;--radius-md:8px;--radius-lg:16px;--space-1:4px;--space-2:8px;--space-3:16px}
      body{font-family:'Source Serif 4',Georgia,serif;color:#1A1A1A;background:#FFFFFF}
      h1,h2{font-family:'Inter',sans-serif;font-weight:700}
      .btn{background:#C8102E;color:#fff}</style>
    </head><body><h1>Northwind Books</h1><p>Independent publisher since 1994.</p></body></html>`,
};

async function main() {
  const bx = require(path.join(ROOT, 'api', '_shared', 'brand-extract.js'));
  const pack = require(path.join(ROOT, 'api', '_shared', 'brand-context-pack.js'));

  // The real fetchImpl contract: { ok, status, body, url, contentType }.
  const fetchImpl = async (u) => {
    const key = u.split('#')[0];
    const body = SITE[key] || SITE[key.replace(/\/$/, '')] || SITE[key + '/'] || null;
    if (!body) return { ok: false, status: 404, body: '' };
    return { ok: true, status: 200, body, url: key, contentType: 'text/html; charset=utf-8' };
  };

  const brand = { name: 'Northwind Books', website: 'https://northwind.example/', palette: {}, typography: {} };
  const report = await bx.extractBrand(brand.website, { brand, voice: false, maxPages: 6, fetchImpl });
  const doc = pack.renderDesignMd(report, brand, { brand_key: 'northwind.example|northwindbooks' });

  // A document that omitted everything would lint clean and prove nothing.
  if (!/^colors:/m.test(doc.markdown) || !/^typography:/m.test(doc.markdown)) {
    console.error('FAIL: the renderer emitted no colour or typography tokens for a site that publishes both.');
    console.error('The linter would pass a document of pure omissions, so this is checked here instead.');
    process.exit(FAIL ? 1 : 0);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'designmd-'));
  const file = path.join(tmp, 'DESIGN.md');
  fs.writeFileSync(file, doc.markdown);

  let raw;
  try {
    raw = execFileSync('npx', ['--yes', '@google/design.md@latest', 'lint', file],
      { encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const out = String((e && (e.stdout || e.message)) || '');
    // A non-zero exit with parseable findings is a real result; anything else
    // (offline, npx refused, timeout) is an unreachable tool, not a failure.
    if (!out.includes('"summary"')) {
      console.log('SKIPPED: @google/design.md could not be run here (offline or unavailable).');
      console.log('  ' + String((e && e.message) || '').split('\n')[0].slice(0, 160));
      process.exit(0);
    }
    raw = out;
  }

  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  const findings = parsed.findings || [];
  const summary = parsed.summary || {};
  for (const f of findings.filter((x) => x.severity !== 'info')) {
    console.log(`  [${f.severity}] ${f.rule} :: ${f.path || ''} :: ${String(f.message || '').slice(0, 160)}`);
  }
  console.log(`DESIGN.md vs the official linter — errors: ${summary.errors || 0}, warnings: ${summary.warnings || 0}, infos: ${summary.infos || 0}`);

  if ((summary.errors || 0) > 0 || (summary.warnings || 0) > 0) {
    console.error('\nFAIL: our DESIGN.md does not conform to google-labs-code/design.md.');
    process.exit(FAIL ? 1 : 0);
  }
  console.log('OK: conforms to the spec, including its WCAG contrast rule.');
}

main().catch((e) => { console.error('check-design-md crashed:', e && e.message); process.exit(FAIL ? 1 : 0); });
