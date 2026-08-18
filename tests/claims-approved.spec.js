// A claim a customer reads must be one the brand actually approved.
//
// The 17 Aug audit flagged "rated 4.9/5 by over 250,000 sneaker drinkers" in a
// shipped fallback landing page as an advertising-standards exposure (ASCI in
// India, FTC in the US) if it ever rendered to a real customer. Sweeping for it
// found more of the same shape, and something worse than a number:
//
//   "Certified B Corp"      - a real certification, held by real companies,
//                             asserted for one that does not hold it
//   "Judge.me verified reviews"
//   "Worn by <two named people>"
//   "Rated 4.9 / 5", "250,000+ five-star reviews", "Studio-fresh within 72 hours"
//
// None of these are in data/brands/_default.json, which lists SIX approved
// claims, and CLAUDE.md says: never assert anything else as fact.
//
// The structural cause was a comment in brand-facts.js declaring the proof bar
// "an APPROVED brand constant ... NOT gated here", plus evidence-policy.js
// hardcoding a celebrity endorsement into the very paragraph that forbids
// inventing one. Claims now come from the brand record.
//
// Run: npx playwright test tests/claims-approved.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
const policy = require(path.join(ROOT, 'api', '_shared', 'evidence-policy.js'));

/* Assertions of fact that no brand record in this repo supports. Each is a
   thing a regulator, a competitor or a customer could check. */
const UNAPPROVED = [
  [/\b4\.9\s*(?:\/|of)\s*5\b|\brated 4\.9\b/i, 'a 4.9 rating'],
  [/250,?000\s*\+?\s*(?:five-star|plus|reviews|reviewers)/i, 'a 250,000 review count'],
  [/judge\.me/i, 'a Judge.me verification'],
  [/\bcertified b[- ]corp\b|\bb[- ]corp\b/i, 'a B Corp certification'],
  [/\bsamay raina\b|\brohit sharma\b|\bshraddha kapoor\b/i, 'a named celebrity endorsement'],
];

/* Surfaces a customer can actually reach, or prompts that write what they read.
   Generated artefacts under mailers/ ads/ landing-pages/ are tenant zero's own
   past output and are not rewritten by this rule. */
const SURFACES = [
  'landing-page-agent.html', 'connector-3d.html', 'storefront-3d.html',
  'api/_shared/evidence-policy.js', 'api/_shared/landing-fallback.js',
  'api/_shared/lp-compiler.js', 'api/ai/generate.js', 'data/design-intelligence.js',
];

/** Prose explaining the bug has to name it; the rule is about live strings. */
function codeOnly(src, isHtml) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  if (isHtml) s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  return s;
}

for (const rel of SURFACES) {
  test(`${rel} asserts nothing the brand record does not approve`, () => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) return;                       // file may be retired
    const src = codeOnly(fs.readFileSync(full, 'utf8'), rel.endsWith('.html'));
    const found = UNAPPROVED.filter(([rx]) => rx.test(src)).map(([, label]) => label);
    expect(found, `${rel} still asserts ${found.join(', ')}`).toEqual([]);
  });
}

/* ═══ the record is the source ═════════════════════════════════════════════ */

test('the evidence policy quotes the brand record, and adds nothing to it', () => {
  const zero = runtime.defaultBrand();
  const approved = (zero.claims || []).map((c) => String((c && c.text) || c));
  expect(approved.length, 'tenant zero should still declare claims').toBeGreaterThan(0);

  const sentence = policy.claimSentence(zero);
  for (const c of approved) {
    expect(sentence, `an approved claim went missing: ${c}`).toContain(c);
  }
  // And nothing extra rides along.
  for (const [rx, label] of UNAPPROVED) {
    expect(rx.test(sentence), `the policy still supplies ${label}`).toBe(false);
  }
});

test('a brand with no claims is told it has none, not handed somebody else\'s', () => {
  const s = policy.claimSentence({ claims: [] });
  expect(s).toMatch(/NO pre-approved claims/i);
  for (const [rx, label] of UNAPPROVED) {
    expect(rx.test(s), `an empty brand was handed ${label}`).toBe(false);
  }
});

test('the standing export carries prohibitions but no borrowed facts', () => {
  // EVIDENCE_RULES is used where no brand is available. It must not smuggle one.
  expect(policy.EVIDENCE_RULES).toMatch(/NEVER invent/i);
  for (const [rx, label] of UNAPPROVED) {
    expect(rx.test(policy.EVIDENCE_RULES), `the brandless export supplies ${label}`).toBe(false);
  }
});

test('nothing claims there is an approved proof constant outside the record', () => {
  // The comment that licensed the spread. Its correction is the fix; this stops
  // the idea being reintroduced in the same words.
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-facts.js'), 'utf8');
  expect(src).not.toMatch(/is an APPROVED brand constant and\s*\n?\s*\*?\s*is NOT gated here/i);
});
