// scripts/audit-pages.js, EXECUTED: the page audit is driven over fixture
// pages and its findings are asserted, so a rule that silently stops seeing
// text fails here instead of shipping a green CI.
//
// Two post-merge review findings on PR #102 (both P2), each reproduced first:
//
//   1. stripBrandGatedBlocks() ran inside visibleText(), BEFORE every text
//      rule. A block gated to one tenant (data-ms-built-for / data-shipped-for)
//      is that tenant's own material, so it is rightly exempt from the CHROME
//      rules (tenant vocabulary, the hardcoded brand name) - the rules that
//      ask "what does every OTHER tenant see". It is not exempt from the rules
//      that apply EVERYWHERE: rule 2 says a fabricated rating is a blocker
//      everywhere, and the owning tenant still reads that block. Stripping it
//      once, up front, exempted it from all of them.
//
//   2. The balanced walk ran on RAW html. A gated start tag inside a comment or
//      a JavaScript string has no matching close, so the walk advanced to the
//      end of the file and everything after it - blockers included - was never
//      inspected. The walk now runs on markup with comments, scripts and styles
//      already removed, and it fails CLOSED: an unbalanced gated tag strips
//      nothing and is reported, so a malformed gate can never earn an exemption.
//
// Nothing in the fixtures is typed from memory: the banned phrase and the
// tenant word come from data/brands/_default.json and the audit's own lists.
//
// Run: npx playwright test tests/audit-pages.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const audit = require(path.join(ROOT, 'scripts', 'audit-pages.js'));
const ZERO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', '_default.json'), 'utf8'));

/* ── fixture vocabulary, derived ───────────────────────────────────────────── */

// A word the audit's OWN tenant-vocabulary rule matches, taken from the
// record's preferred list rather than typed here.
const tenantVocab = new RegExp(audit.TENANT_VOCAB.source, 'i');
const TENANT_WORD = (ZERO.voice.preferred || []).find((w) => tenantVocab.test(w));
// A banned phrase that is ONLY banned: not also wrong-industry vocabulary (rule
// 1 would add a second finding) and not a technical homonym (`transform`).
const BANNED = (ZERO.voice.banned || []).find((p) => !audit.WRONG_INDUSTRY.includes(String(p).toLowerCase()) && !/transform/i.test(p));

test('the derived fixture vocabulary exists (a fixture built from nothing would test nothing)', () => {
  expect(TENANT_WORD, 'no preferred word matches the tenant-vocab rule').toBeTruthy();
  expect(BANNED, 'no banned phrase to plant').toBeTruthy();
  expect(typeof audit.auditPage).toBe('function');
});

const rulesOf = (findings) => findings.map((f) => f.rule);
const page = (inner) => `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head><body><main>${inner}</main></body></html>`;

/* ── 1. a gated block is exempt from the CHROME rules, not from the rules that apply everywhere ── */

test.describe('a block gated to one tenant', () => {
  const GATED = page(`
    <h1>Plan your calendar</h1>
    <section data-shipped-for="${ZERO.slug}">
      <h2>${ZERO.name} gallery</h2>
      <p>Rated 4.9/5 by our ${TENANT_WORD} community. ${BANNED} today – it is here.</p>
    </section>
    <p>Pick a cohort and a date.</p>`);

  test('still reports the fabricated rating, the banned phrase and the dash it carries (the owner sees them)', () => {
    const findings = audit.auditPage('fixture-gated.html', GATED);
    const rules = rulesOf(findings);
    expect(rules).toContain('fabricated-proof');
    expect(rules).toContain('banned-phrase');
    expect(rules).toContain('dash');
    const proof = findings.find((f) => f.rule === 'fabricated-proof');
    expect(proof.severity).toBe('BLOCKER');
    expect(proof.detail).toContain('Rated 4.9/5');
    const banned = findings.find((f) => f.rule === 'banned-phrase');
    expect(banned.severity).toBe('BLOCKER');
    expect(banned.detail.toLowerCase()).toContain(String(BANNED).toLowerCase());
  });

  test('is NOT chrome: its tenant vocabulary and its brand name do not count against the shell', () => {
    const rules = rulesOf(audit.auditPage('fixture-gated.html', GATED));
    expect(rules).not.toContain('tenant-vocab');
    expect(rules).not.toContain('tenant-zero-vocabulary');
    expect(rules).not.toContain('hardcoded-brand');
  });

  test('the same words OUTSIDE the gate are chrome and are reported (the chrome rules still work)', () => {
    const findings = audit.auditPage('fixture-chrome.html', page(`<h1>${ZERO.name} planner</h1><p>Pick a ${TENANT_WORD}.</p>`));
    const rules = rulesOf(findings);
    expect(rules).toContain('tenant-vocab');
    expect(rules).toContain('hardcoded-brand');
    expect(findings.find((f) => f.rule === 'tenant-vocab').severity).toBe('BLOCKER');
  });

  test('a data-ms-built-for block takes the same treatment', () => {
    const findings = audit.auditPage('fixture-ms.html', page(`
      <div data-ms-built-for="${ZERO.slug}"><div class="ms-report"><p>Rated 4.7/5 in the ${TENANT_WORD} market.</p></div></div>
      <p>Choose a market.</p>`));
    const rules = rulesOf(findings);
    expect(rules).toContain('fabricated-proof');
    expect(rules).not.toContain('tenant-vocab');
  });
});

/* ── 2. the walk runs on markup, not on comments and strings, and fails closed ── */

test.describe('an apparent gated start tag that is not an element', () => {
  // Two assertions each, on purpose. The blocker after the tag must be seen;
  // AND the tag must not be reported as an unbalanced gate - a comment is not a
  // gate, and a warning on a legitimate comment is the kind people learn to
  // ignore. Only walking MARKUP (code stripped first) satisfies both; the
  // fail-closed walk alone would keep the blocker and add the noise.
  test('inside an html comment does not swallow the rest of the page', () => {
    const rules = rulesOf(audit.auditPage('fixture-comment.html', page(`
      <!-- <div data-shipped-for="x"> -->
      <p>Rated 4.9/5</p>`)));
    expect(rules).toContain('fabricated-proof');
    expect(rules).not.toContain('gated-unbalanced');
  });

  test('inside a script string does not swallow the rest of the page', () => {
    const rules = rulesOf(audit.auditPage('fixture-script.html', page(`
      <script>var s = '<div data-shipped-for="x">'; var t = "<section data-ms-built-for=\\"y\\">";</script>
      <p>Rated 4.9/5</p>`)));
    expect(rules).toContain('fabricated-proof');
    expect(rules).not.toContain('gated-unbalanced');
  });

  test('inside a style block does not swallow the rest of the page', () => {
    const rules = rulesOf(audit.auditPage('fixture-style.html', page(`
      <style>/* <div data-shipped-for="x"> */ p{margin:0}</style>
      <p>Rated 4.9/5</p>`)));
    expect(rules).toContain('fabricated-proof');
    expect(rules).not.toContain('gated-unbalanced');
  });
});

test.describe('a REAL gated element that never closes', () => {
  const UNBALANCED = page(`
    <div data-shipped-for="${ZERO.slug}">
      <p>Our ${TENANT_WORD} gallery.</p>
    <p>Rated 4.9/5</p>`);

  test('strips nothing: the blocker after it is reported and the exemption is void', () => {
    const findings = audit.auditPage('fixture-unbalanced.html', UNBALANCED);
    const rules = rulesOf(findings);
    expect(rules).toContain('fabricated-proof');
    // Fail CLOSED: an unbalanced gate earns no exemption, so the tenant word
    // inside it is chrome until the markup is fixed.
    expect(rules).toContain('tenant-vocab');
  });

  test('is reported as a warning naming the tag, so it gets fixed rather than hidden', () => {
    const findings = audit.auditPage('fixture-unbalanced.html', UNBALANCED);
    const warn = findings.find((f) => f.rule === 'gated-unbalanced');
    expect(warn).toBeTruthy();
    expect(warn.severity).toBe('WARN');
    expect(warn.detail).toContain('data-shipped-for');
    expect(warn.line).toBeGreaterThan(0);
  });

  test('a balanced gate beside it is still honoured (one bad gate does not void the others)', () => {
    const findings = audit.auditPage('fixture-mixed.html', page(`
      <section data-shipped-for="${ZERO.slug}"><p>${TENANT_WORD} one</p></section>
      <div data-shipped-for="${ZERO.slug}"><p>open</p>
      <p>Rated 4.9/5</p>`));
    const rules = rulesOf(findings);
    expect(rules).toContain('fabricated-proof');
    expect(rules).toContain('gated-unbalanced');
    // The word inside the BALANCED gate is exempt; nothing else on the page
    // carries tenant vocabulary, so the chrome rule stays quiet.
    expect(rules).not.toContain('tenant-vocab');
  });
});

test('nested elements of the gated tag name are walked, not cut at the first close', () => {
  const findings = audit.auditPage('fixture-nested.html', page(`
    <div data-shipped-for="${ZERO.slug}"><div><div>${TENANT_WORD}</div></div><p>${TENANT_WORD} still inside</p></div>
    <p>Choose a date.</p>`));
  expect(rulesOf(findings)).not.toContain('tenant-vocab');
});

/* ── the real pages ────────────────────────────────────────────────────────── */

test('the shipped pages carry no blocker under the corrected rules (what npm run audit:pages:ci asserts)', () => {
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
  expect(files.length).toBeGreaterThan(40);
  const blockers = [];
  for (const f of files) {
    const findings = audit.auditPage(f, fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const x of findings) if (x.severity === 'BLOCKER') blockers.push(`${f}: ${x.rule} ${x.detail}`);
  }
  expect(blockers).toEqual([]);
});
