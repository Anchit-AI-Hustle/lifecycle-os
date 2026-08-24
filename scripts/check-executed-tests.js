#!/usr/bin/env node
'use strict';
/**
 * check-executed-tests.js — a ratchet on tests that only READ the source.
 * ---------------------------------------------------------------------------
 * WHY. A standing rule in this repo is that a test should EXECUTE the logic it
 * guards. The reason is not style. On 23 Aug 2026 the two tests guarding the
 * unauthenticated-LLM-proxy finding both asserted on source text: that
 * `requireCaller(req, res)` appears in the handler, and that its index is below
 * the first provider call. Changing
 *
 *     if (!(await requireCaller(req, res))) return;   ->   await requireCaller(req, res);
 *
 * puts the open proxy back — the gate runs, its refusal is discarded, and the
 * six-provider cascade spends real keys for an anonymous caller. Both source
 * tests still PASSED. Only the executed ones failed.
 *
 * WHAT THIS IS NOT. "Source assertion" is not a synonym for "bad test". Some
 * claims genuinely are about a file:
 *
 *   - a comp account's email address must not appear in a file the browser
 *     downloads,
 *   - a foreign brand's product names must not appear in the deployed output,
 *   - a migration must contain the revoke that takes an anon grant back.
 *
 * Those are file properties and a file check is the RIGHT tool. So this script
 * does not forbid them and cannot tell them apart automatically — that judgement
 * belongs to whoever writes the test.
 *
 * WHAT IT DOES. It counts them per file and holds the line. A count that falls
 * is fine and needs no action. A count that RISES fails, which forces a moment
 * of "is this a claim about the file, or about what the code does at runtime?"
 * at the point where the answer is cheapest to act on.
 *
 * Update BASELINE deliberately when adding a genuine file-property assertion.
 *
 * WHAT IT MISSES. The match is on the NAME of the variable being asserted, so a
 * file read into a differently-named variable is not counted — three added to
 * credit-pack-pricing.spec.js on 2026-08-24 (`env`, `block`) slipped past it.
 * That is a known limit, not a claim to be complete: this is a ratchet against
 * the common shape, and widening the name list means re-baselining every file.
 * Treat the number as a trend, never as an audit.
 *
 * Run: node scripts/check-executed-tests.js [--fail]
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TESTS = path.join(ROOT, 'tests');

/**
 * An assertion whose subject is text read off disk. Matched on the VARIABLE
 * being asserted, because that is what distinguishes `expect(src).toMatch(...)`
 * from `expect(result.status).toBe(401)` — the first is reading a file, the
 * second is reading a return value.
 */
const SOURCE_ASSERT = /expect\(\s*(?:src|source|js|html|code|body|file|sql|css|text|contents)\b[^)]*\)\s*\.\s*(?:not\s*\.\s*)?(?:toMatch|toContain|toBe|toEqual)/g;

/**
 * Recorded on 2026-08-23, after converting the two AI-route security tests from
 * source assertions to executed requests. Every entry is a debt, not a target:
 * the right direction is down, and a file that drops off entirely is a win.
 */
const BASELINE = {
  'brand-asset-content.spec.js': 13,
  'brand-context-pack.spec.js': 13,
  'brand-data-scope.spec.js': 11,
  'brand-suggest.spec.js': 11,
  'security-endpoints.spec.js': 11,
  'generation-quality.spec.js': 8,
  'journey-join.spec.js': 8,
  'motion-ad-mobile.spec.js': 8,
  'brand-crud.spec.js': 7,
  'oauth-adapters.spec.js': 7,
  'platform-agents.spec.js': 6,
  'problem-statement.spec.js': 5,
  'smart-brain-assets.spec.js': 5,
  'studio.spec.js': 5,
  'brand-catalog-scope.spec.js': 4,
  'brand-presets.spec.js': 4,
  'reference-intel.spec.js': 4,
  'workspace-connections.spec.js': 4,
  'asset-vs-element-prompts.spec.js': 3,
  'credits-comp-accounts.spec.js': 3,
  'onboarding-review-loop.spec.js': 3,
  'preset-gallery-no-swap.spec.js': 3,
  'shopify-scope.spec.js': 3,
  'ad-rows.spec.js': 2,
  'asset-no-black-background.spec.js': 2,
  'brand-extract.spec.js': 2,
  'brand-harvest.spec.js': 2,
  'competitor-dashboard.spec.js': 2,
  'data-analysis.spec.js': 2,
  'domain-intel.spec.js': 2,
  'asset-contracts.spec.js': 1,
  'brand-fallback.spec.js': 1,
  'claims-approved.spec.js': 1,
  'creative-evidence.spec.js': 1,
  'credits-comp-ui.spec.js': 1,
  'generation-display.spec.js': 1,
  'growth-os.spec.js': 1,
  'payments-gateway.spec.js': 1,
  'ported-modules.spec.js': 1,
  'public-surface.spec.js': 1,
  'sibling-parity.spec.js': 1,
  'social-brand-scope.spec.js': 1,
  'table-overlap.spec.js': 1,
};

function counts() {
  const out = {};
  for (const f of fs.readdirSync(TESTS).filter((x) => x.endsWith('.spec.js')).sort()) {
    const body = fs.readFileSync(path.join(TESTS, f), 'utf8');
    const n = (body.match(SOURCE_ASSERT) || []).length;
    if (n) out[f] = n;
  }
  return out;
}

function main() {
  const now = counts();
  const files = [...new Set([...Object.keys(BASELINE), ...Object.keys(now)])].sort();

  const risen = [], fallen = [], added = [];
  for (const f of files) {
    const was = BASELINE[f] || 0;
    const is = now[f] || 0;
    if (is > was) (was === 0 ? added : risen).push(`${f}: ${was} -> ${is}`);
    else if (is < was) fallen.push(`${f}: ${was} -> ${is}`);
  }

  const total = Object.values(now).reduce((a, b) => a + b, 0);
  const base = Object.values(BASELINE).reduce((a, b) => a + b, 0);
  console.log(`source-text assertions: ${total} across ${Object.keys(now).length} files (baseline ${base})`);

  if (fallen.length) {
    console.log(`\nconverted to executed tests (${fallen.length}):`);
    for (const l of fallen) console.log('  ' + l);
    console.log('  → lower the BASELINE in scripts/check-executed-tests.js to lock it in.');
  }

  const bad = [...risen, ...added];
  if (!bad.length) { console.log('\nOK: no new source-only assertions.'); return 0; }

  console.error(`\nFAIL: ${bad.length} file(s) gained a source-text assertion:`);
  for (const l of bad) console.error('  ' + l);
  console.error(
    '\nIs the new assertion a claim about the FILE (a secret must not appear in\n'
    + 'shipped output, a migration must contain a revoke) or about what the code\n'
    + 'DOES at runtime? The first is legitimate — raise the baseline. The second\n'
    + 'passes even when the behaviour is broken: execute it instead.',
  );
  return 1;
}

const code = main();
if (process.argv.includes('--fail')) process.exit(code);
