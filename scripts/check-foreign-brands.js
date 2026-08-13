#!/usr/bin/env node
'use strict';
/**
 * scripts/check-foreign-brands.js — no other company's name or numbers, anywhere.
 *
 *   node scripts/check-foreign-brands.js         report
 *   node scripts/check-foreign-brands.js --fail  exit 1 on any hit (CI gate)
 *
 * WHY THIS EXISTS. This platform is developed alongside sibling lifecycle-OS
 * repos built for other companies. Logic gets ported between them, and every
 * port is a chance for a foreign brand's name, domain, palette or P&L figure to
 * ride along inside a comment, a preset, a sample payload or a demo number.
 * Once that lands it is invisible until a customer sees another company's
 * revenue on their own dashboard.
 *
 * Being absent is not something you can check by eye across ~1,400 files, so it
 * is checked here on every build. The rule is absolute: a foreign brand token
 * or figure is a BLOCKER regardless of which file it sits in.
 *
 * NOTE ON THE FRAGMENTS BELOW. The forbidden tokens are assembled from pieces
 * rather than written out. scripts/ sits inside the deployed output root
 * (vercel.json sets outputDirectory "."), so a literal here would itself be a
 * publicly fetchable occurrence of the very string this file exists to remove.
 * Assembling at load time keeps the match exact while keeping the literal out
 * of every served byte. Do not "tidy" these back into plain strings.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAIL_MODE = process.argv.includes('--fail');

/** Foreign company tokens. Add a fragment pair, never a literal. */
const FOREIGN_TOKENS = [
  ['vah', 'dam'].join(''),
];

/**
 * Financial and operational figures belonging to a foreign company. These are
 * the numbers most likely to be pasted in from a sibling repo's dashboard or a
 * shared deck, and they are the most damaging: a revenue line reads as this
 * brand's own the moment it renders.
 */
const FOREIGN_FIGURES = [
  { rx: /\bRs\.?\s*267\s*Cr\b/i, what: "another company's FY revenue line" },
  { rx: /\b267\s*Cr\b/i, what: "another company's FY revenue line" },
  { rx: /\bRs\.?\s*68\s*Cr\b/i, what: "another company's logistics cost line" },
  { rx: /\bRs\.?\s*50\s*Cr\b/i, what: "another company's ad spend line" },
  { rx: /\b150\s+farms\b/i, what: "another company's sourcing claim" },
  { rx: /\b130\s+countries\b/i, what: "another company's distribution claim" },
];

/** Directories that are not ours to police (vendored, generated, or metadata). */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'test-results', '.next', 'dist', 'build',
  'ios', 'android', '.vercel', 'coverage',
]);

/** Binary and lockfile extensions - nothing readable to check. */
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tgz|woff2?|ttf|eot|mp4|mp3|wav|xlsx?|docx?|pptx?|duckdb|db|sqlite)$/i;

/** This guard names the fragments on purpose; it must not flag itself. */
const SELF = path.relative(ROOT, __filename);

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github' && e.name !== '.agents' && e.name !== '.claude') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(abs, out);
    } else if (e.isFile()) {
      if (SKIP_EXT.test(e.name)) continue;
      if (e.name === 'package-lock.json') continue;
      out.push(abs);
    }
  }
  return out;
}

const findings = [];

for (const abs of walk(ROOT, [])) {
  const rel = path.relative(ROOT, abs);
  if (rel === SELF) continue;

  let src;
  try { src = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
  if (src.indexOf(String.fromCharCode(0)) !== -1) continue;   // binary that slipped the extension filter

  for (const token of FOREIGN_TOKENS) {
    const rx = new RegExp(token, 'gi');
    const hits = [...src.matchAll(rx)];
    if (!hits.length) continue;
    const line = src.slice(0, hits[0].index).split('\n').length;
    findings.push({
      rel, line,
      detail: `foreign brand token "${hits[0][0]}"${hits.length > 1 ? ` (${hits.length} occurrences)` : ''}`,
    });
  }

  for (const { rx, what } of FOREIGN_FIGURES) {
    const m = rx.exec(src);
    if (!m) continue;
    const line = src.slice(0, m.index).split('\n').length;
    findings.push({ rel, line, detail: `${what}: "${m[0].trim()}"` });
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
if (!findings.length) {
  console.log('OK: no foreign brand names or figures in the tree.');
  process.exit(0);
}

const byFile = {};
for (const f of findings) (byFile[f.rel] = byFile[f.rel] || []).push(f);
for (const rel of Object.keys(byFile).sort()) {
  console.log(`\n${rel}`);
  for (const f of byFile[rel]) console.log(`  line ${String(f.line).padEnd(6)} ${f.detail}`);
}
console.log(`\n${'─'.repeat(72)}`);
console.log(`Files with foreign brand content: ${Object.keys(byFile).length}   findings: ${findings.length}`);

if (FAIL_MODE) {
  console.error('\nFAIL: another company\'s name or numbers are present. This product must never show them.');
  process.exit(1);
}
