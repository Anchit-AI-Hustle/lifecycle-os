// Each asset type is built to its OWN contract, and the finished artefact is
// judged against it.
//
// WHAT THIS REPLACED. asset-specs.js already held the real dimensions and copy
// limits for every placement, and exactly ONE file consumed it: master-prompt.js,
// which pastes it into a prompt. So the rules reached the model as prose, every
// renderer re-typed the numbers itself (ad-creative.js clamped to its own
// literal 125/40/30 and 30/90), and nothing ever checked what came back. A
// Google headline three characters over the limit was discovered by Google.
//
// Two rules keep this honest, and both are asserted below:
//   · numbers are READ from asset-specs.js, never re-typed;
//   · a limit this repo cannot source does NOT block. Only a constraint the
//     repo already enforces against a real platform may fail an asset.
//
// Run: npx playwright test tests/asset-contracts.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const contracts = require(path.join(ROOT, 'api', '_shared', 'asset-contracts.js'));
const specs = require(path.join(ROOT, 'api', '_shared', 'asset-specs.js'));
const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'asset-contracts.js'), 'utf8');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/* ═══ every asset type has its own logic, not one shared pipeline ═════════ */

test('each contract carries its own structure, design rules and algorithm', () => {
  const all = contracts.list();
  expect(all.length).toBeGreaterThanOrEqual(6);
  for (const c of all) {
    expect(c.structure.length, `${c.id} has no structure`).toBeGreaterThan(0);
    expect(c.design.length, `${c.id} has no design rules`).toBeGreaterThan(0);
    expect(c.algorithm.length, `${c.id} has no creation algorithm`).toBeGreaterThan(2);
  }
});

test('the mediums are genuinely different, not one set of rules relabelled', () => {
  const byId = Object.fromEntries(contracts.list().map((c) => [c.id, c]));
  const j = (c) => c.design.concat(c.algorithm).join(' ').toLowerCase();

  // Email cannot run scripts; a landing page owns its scroll. If these two ever
  // produce the same rules, the split has collapsed into decoration.
  expect(j(byId['email.mailer'])).toMatch(/outlook|images disabled|column/);
  expect(j(byId['landing.page'])).toMatch(/scroll|javascript/);
  expect(j(byId['email.mailer'])).not.toMatch(/scroll-driven/);

  // Search has no layout at all; social is layout-first.
  expect(j(byId['ad.google.rsa'])).toMatch(/no layout to design/);
  expect(j(byId['ad.meta.static'])).toMatch(/placement|feed|thumbnail/);

  // Video is judged on motion, static on the frame.
  expect(j(byId['ad.meta.video'])).toMatch(/first second|silent|hook/);
});

test('a static ad and a video ad are separate contracts', () => {
  // They were one asset with a shared photo until the creative key became
  // <platform>:<creative_type>. The contracts must not re-merge them.
  expect(contracts.check({ platform: 'meta', creative_type: 'video', primary_text: 'a', headline: 'b', creative: { motion_html: '<div/>' } }).contract)
    .toBe('ad.meta.video');
  expect(contracts.check({ platform: 'meta', creative_type: 'static', primary_text: 'a', headline: 'b' }).contract)
    .toBe('ad.meta.static');
});

/* ═══ numbers are read, never re-typed ════════════════════════════════════ */

test('every copy limit is read from asset-specs, not written here', () => {
  const meta = contracts.CONTRACTS['ad.meta.static'].structure;
  expect(meta.find((s) => s.slot === 'primary_text').max).toBe(specs.ADS.meta.copy.primaryText);
  expect(meta.find((s) => s.slot === 'headline').max).toBe(specs.ADS.meta.copy.headline);
  expect(meta.find((s) => s.slot === 'description').max).toBe(specs.ADS.meta.copy.description);

  const mailer = contracts.CONTRACTS['email.mailer'].design.join(' ');
  expect(mailer).toContain(String(specs.MAILER.desktop.contentWidth));
  expect(mailer).toContain(String(specs.MAILER.mobile.tapTargetPx));
});

test('a slot with no recorded limit says so instead of inventing one', () => {
  const intro = contracts.CONTRACTS['email.mailer'].structure.find((s) => s.slot === 'intro_paragraph');
  expect(intro.max).toBeNull();
  expect(intro.source).toMatch(/no limit recorded/i);
});

/* ═══ only a limit this repo enforces may block ═══════════════════════════ */

test('an unverified limit warns and never fails the asset', () => {
  const out = contracts.check({
    platform: 'meta', creative_type: 'static',
    primary_text: 'x'.repeat(specs.ADS.meta.copy.primaryText + 50),
    headline: 'fine', description: 'd',
  });
  expect(out.violations.some((v) => v.slot === 'primary_text')).toBe(true);
  expect(out.violations.find((v) => v.slot === 'primary_text').level).toBe('warn');
  expect(out.ok, 'an unsourced limit failed an asset').toBe(true);
  expect(out.violations.find((v) => v.slot === 'primary_text').message).toMatch(/Advisory/);
});

test('a verified limit blocks, and names where the enforcement lives', () => {
  const out = contracts.check({
    platform: 'google',
    headlines: ['a'.repeat(31), 'short one', 'another angle'],
    descriptions: ['fine'],
  });
  expect(out.ok).toBe(false);
  expect(out.blocking).toBe(1);
  expect(out.violations[0].message).toMatch(/DROPS a headline over 30/);

  const h = contracts.CONTRACTS['ad.google.rsa'].structure.find((s) => s.slot === 'headlines');
  expect(h.verified).toBe(true);
  expect(h.source).toMatch(/google-ads-adapter\.js/);
});

test('the verified set is exactly what the repo actually enforces', () => {
  // Every verified source must name a file that exists and really contains the
  // enforcement, or "verified" is just a more confident kind of guess.
  for (const [key, claim] of Object.entries(contracts.VERIFIED_SOURCES)) {
    const file = (claim.match(/[\w/.-]+\.js/) || [])[0];
    expect(file, `${key} names no file`).toBeTruthy();
    expect(fs.existsSync(path.join(ROOT, file)), `${key} names a file that does not exist: ${file}`).toBe(true);
  }
  const adapter = fs.readFileSync(path.join(ROOT, 'api/_shared/adapters/google-ads-adapter.js'), 'utf8');
  expect(adapter).toMatch(/length <= 30/);
  expect(adapter).toMatch(/slice\(0, 15\)/);
});

/* ═══ the medium-specific failures ════════════════════════════════════════ */

test('a video ad with no artefact is blocked, and reported once', () => {
  const out = contracts.check({ platform: 'meta', creative_type: 'video', primary_text: 'a', headline: 'b' });
  expect(out.ok).toBe(false);
  const artefact = out.violations.filter((v) => v.slot === 'motion_html');
  // Reporting one problem twice makes a reviewer distrust the count.
  expect(artefact, 'the same missing artefact was reported more than once').toHaveLength(1);
});

test('the artefact is found wherever the pipeline actually puts it', () => {
  // buildCampaign attaches it to creative.motion_html, not the top-level slot.
  expect(contracts.check({ platform: 'meta', creative_type: 'video', primary_text: 'a', headline: 'b', creative: { motion_html: '<div/>' } }).ok).toBe(true);
  expect(contracts.check({ platform: 'tiktok', script: 's', caption: 'c', creative: { video: 'x.mp4' } }).ok).toBe(true);
});

test('a mailer that only works with images on is flagged', () => {
  const out = contracts.check({ subject: 'S', preheader: 'P', html: '<table><img src="x.jpg"></table>' });
  expect(out.contract).toBe('email.mailer');
  expect(out.violations.some((v) => /alt text/i.test(v.message))).toBe(true);
});

test('a preheader that repeats the subject is flagged', () => {
  const out = contracts.check({ subject: 'Same line', preheader: 'same line', html: '<table></table>' });
  expect(out.violations.some((v) => v.slot === 'preheader')).toBe(true);
});

test('a landing page that hides itself without JavaScript is blocked', () => {
  const out = contracts.check({ hero_headline: 'H', path: '/lp/x', variant: 'A', html: '<div class="sx card">copy</div>' });
  expect(out.ok).toBe(false);
  expect(out.violations[0].message).toMatch(/permanently blank/);
});

test('duplicate Google headlines are reported as a wasted slot', () => {
  const out = contracts.check({ platform: 'google', headlines: ['Same', 'same', 'Other'], descriptions: ['d'] });
  expect(out.violations.some((v) => /duplicated/.test(v.message))).toBe(true);
});

/* ═══ an unknown asset type is reported, not silently passed ══════════════ */

test('an asset with no contract says so rather than reading as approved', () => {
  const out = contracts.check({ some: 'thing' });
  expect(out.contract).toBeNull();
  expect(out.note).toMatch(/Reported rather than passed silently/);
});

/* ═══ it is wired into the pipeline and into the brief ════════════════════ */

test('the campaign builder judges every finished asset', () => {
  const plan = fs.readFileSync(path.join(ROOT, 'api/_shared/smart-brain-plan.js'), 'utf8');
  expect(plan).toMatch(/function checkAssetContracts/);
  expect(plan).toMatch(/checkAssetContracts\(campaign\)/);
  // It must run on the finished artefacts, after they are built.
  const call = plan.indexOf('checkAssetContracts(campaign);');
  expect(call).toBeGreaterThan(plan.indexOf('attachMasterPrompts(campaign, entry);'));
  // And it must not silently rewrite copy to fit.
  const fn = plan.slice(plan.indexOf('function checkAssetContracts'), plan.indexOf('// ── Master prompts'));
  expect(fn).not.toMatch(/\.slice\(0,|truncat/i);
});

test('the writer is briefed with the same rules the validator enforces', () => {
  const plan = fs.readFileSync(path.join(ROOT, 'api/_shared/smart-brain-plan.js'), 'utf8');
  expect(plan).toMatch(/asset-contracts\.js/);
  expect(plan).toMatch(/EACH ASSET IS BUILT TO ITS OWN CONTRACT/);
  const b = contracts.brief('ad.google.rsa');
  expect(b).toMatch(/STRUCTURE:/);
  expect(b).toMatch(/HOW THIS ASSET IS MADE:/);
  expect(b).toContain('max 30 characters');
});

/* ═══ the renderer no longer carries another brand's copy ═════════════════ */

test('the ad renderer reads the spec instead of re-typing it', () => {
  const ad = fs.readFileSync(path.join(ROOT, 'scripts/lib/ad-creative.js'), 'utf8');
  expect(ad).toMatch(/require\('\.\.\/\.\.\/api\/_shared\/asset-specs\.js'\)/);
  expect(ad).toMatch(/META_COPY\.primaryText/);
  // The literals it used to clamp with are gone.
  expect(codeOnly(ad)).not.toMatch(/clamp\([^)]*,\s*125\)/);
});

test('an empty ad field becomes a marker, not another brand\'s claim', () => {
  // codeOnly, because the comment above the fix QUOTES the strings it removed
  // in order to explain them, and a raw scan matches the explanation. Third
  // time this pattern has bitten in this repo.
  const ad = codeOnly(fs.readFileSync(path.join(ROOT, 'scripts/lib/ad-creative.js'), 'utf8'));
  // These shipped into ANY brand's ad whenever a field came through empty.
  expect(ad).not.toMatch(/Single-studio, hand-painted at origin/);
  expect(ad).not.toMatch(/One-of-One, Hand-Painted/);
  expect(ad).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
});
