// Suggested options for a brand-setup field.
//
// The wizard asks an operator to invent a tone, a vocabulary and a banned list
// against a placeholder. Most people stall, and a stalled field becomes an
// empty one, which becomes a [DATA REQUIRED BEFORE LAUNCH: ...] marker in every
// asset generated afterwards. So the wizard offers options.
//
// The whole risk is that an option gets mistaken for a FACT. Everywhere else in
// this repo a brand value is either read from that brand's own site (with its
// source URL) or typed by the operator. A model's opinion is neither.
//
// Run: npx playwright test tests/brand-suggest.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sug = require(path.join(ROOT, 'api', '_shared', 'brand-suggest.js'));
const html = fs.readFileSync(path.join(ROOT, 'onboarding.html'), 'utf8');

const BRAND = {
  name: 'Northmark Supply',
  industry: 'outdoor equipment',
  offerings: [{ name: 'trail packs' }],
  regions: [{ code: 'US' }],
  voice: { tone: '', preferred: [], banned: [] },
};

/* ═══ nothing is suggested about a brand that has said nothing ════════════ */

test('an unresolved brand gets a reason, not generic options', async () => {
  const out = await sug.suggest('voice.tone', null);
  expect(out.ok).toBe(false);
  expect(out.error).toBe('no_brand_context');
  expect(out.options).toEqual([]);
  // Generic options would look like an answer, which is worse than a blank.
  expect(out.note).toMatch(/generic company rather than yours/i);
});

test('an unknown field is refused and says what it does cover', async () => {
  const out = await sug.suggest('palette.primary', BRAND);
  expect(out.ok).toBe(false);
  expect(out.error).toBe('unknown_field');
  expect(out.fields).toContain('voice.tone');
  // Colour is NOT suggestible: a palette is a brand fact with a source, not a
  // preference, and proposePalette/brand-extract already own that path.
  expect(out.fields).not.toContain('palette.primary');
});

/* ═══ a suggestion may never state something checkable ════════════════════ */

test('anything a customer could check is stripped, and counted', () => {
  const { kept, dropped } = sug.verifiedClaimsOnly([
    { value: 'warm, plain spoken, never hyped' },
    { value: 'rated 4.9/5 by 250,000 people' },
    { value: 'award-winning since 1994' },
    // Not 130: that exact figure is a foreign brand's distribution claim, and
    // check-foreign-brands scans tests/ too because tests/ ships inside the
    // deployed output root. The gate caught this fixture before it landed.
    { value: 'trusted in 47 countries' },
    { value: 'from just $19' },
    { value: 'see https://example.com/proof' },
    { value: 'quietly confident, technical when it helps' },
  ]);
  expect(kept.map((k) => k.value)).toEqual([
    'warm, plain spoken, never hyped',
    'quietly confident, technical when it helps',
  ]);
  expect(dropped).toHaveLength(5);
  for (const d of dropped) expect(d.why).toMatch(/could check/i);
});

test('the brief hands the model this brand and nothing else', () => {
  const brief = sug.brandBrief(BRAND).join('\n');
  expect(brief).toContain('Northmark Supply');
  expect(brief).toContain('outdoor equipment');
  expect(brief).toContain('trail packs');
  // No preset, no default brand, no other tenant can reach the prompt.
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-suggest.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  expect(src).not.toMatch(/defaultBrand|presets|_default\.json/);
});

/* ═══ banned phrases: offered, never machine-filled ═══════════════════════ */

test('banned phrases are offered as options and written by nobody but the operator', () => {
  // The standing rule is that voice.banned can never be MACHINE-FILLED. A menu
  // is not a machine filling a field; the click is the decision. What must be
  // true is that this module never writes, and the wizard only writes on click.
  expect(sug.FIELDS['voice.banned']).toBeTruthy();
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-suggest.js'), 'utf8');
  // No persistence anywhere in the module: no supabase, no upsert, no save.
  expect(src).not.toMatch(/supabase|upsert|\.save\(|INSERT INTO/i);

  // And the wizard applies a suggestion only from the click handler.
  expect(html).toMatch(/function useSuggestion/);
  expect(html).toMatch(/data-use-suggest/);
  // What the operator picks is recorded as THEIRS, not as a derived value.
  const fn = html.slice(html.indexOf('function useSuggestion'), html.indexOf('function bindSuggest'));
  expect(fn).toMatch(/chosen by the operator/);
  expect(fn).toMatch(/confidence: 'user'/);
});

/* ═══ a suggestion never dresses up as evidence ═══════════════════════════ */

test('every option is marked as a suggestion and the payload says so', async () => {
  const out = await sug.suggest('voice.tone', BRAND);
  // With no provider configured in CI this returns no_provider, which is itself
  // the behaviour under test: it must not fabricate a list to fill the gap.
  if (!out.ok) {
    expect(['no_provider', 'unparseable']).toContain(out.error);
    expect(out.options).toEqual([]);
    expect(out.note).toBeTruthy();
    return;
  }
  expect(out.disclaimer).toMatch(/not read from your website/i);
  expect(out.disclaimer).toMatch(/not facts/i);
  for (const o of out.options) expect(o.origin).toBe('suggestion');
});

test('a dead provider is reported as a dead provider, not as no ideas', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-suggest.js'), 'utf8');
  expect(src).toMatch(/no_provider/);
  expect(src).toMatch(/An unreachable model is not "no ideas"/);
});

/* ═══ the UI keeps suggestions visually separate from extracted values ════ */

test('the wizard renders options distinctly from extracted candidates', () => {
  expect(html).toMatch(/\.sug-opt\{[^}]*border:1px dashed/);
  expect(html).toMatch(/data-credit-feature="brand.suggest"/);
  // The disclaimer is printed, not just returned.
  expect(html).toMatch(/esc\(s\.disclaimer/);
  // Dropped options are surfaced rather than silently swallowed.
  expect(html).toMatch(/were dropped for stating something a customer could check/);
});

test('every suggestible field on the voice step has a suggest control', () => {
  for (const f of ['voice.tone', 'voice.preferred', 'voice.banned', 'voice.notes']) {
    expect(html, `${f} has no suggest control`).toContain(`suggestBlock('${f}')`);
  }
});

/* ═══ the route exists, is free, and is reachable ═════════════════════════ */

test('the op is mounted on the existing router and priced in the catalog', () => {
  const core = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'), 'utf8');
  expect(core).toMatch(/case 'suggest':/);
  expect(core).toMatch(/brand-suggest\.js'\)\.suggest\(/);
  // Listed in the op index, or an operator hitting a typo gets no hint.
  expect(core).toMatch(/'extract', 'suggest'/);

  // A feature key missing from the catalog THROWS rather than running free, so
  // the key has to exist for the button to work at all.
  const cat = require(path.join(ROOT, 'api', '_shared', 'credit-catalog.js'));
  const row = cat.FEATURES.find((r) => r.key === 'brand.suggest');
  expect(row, 'brand.suggest is not in the credit catalog').toBeTruthy();
  expect(row.cost).toBe(0);
});

test('no new serverless function was added', () => {
  const files = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js'));
  const nested = ['ai', 'cron'].flatMap((d) => {
    const p = path.join(ROOT, 'api', d);
    if (!fs.existsSync(p)) return [];
    return fs.readdirSync(p, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory()
        ? fs.readdirSync(path.join(p, e.name)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${e.name}/${f}`)
        : (e.name.endsWith('.js') ? [`${d}/${e.name}`] : [])));
  });
  expect(files.length + nested.length, 'the Hobby function cap is 12').toBeLessThanOrEqual(12);
});
