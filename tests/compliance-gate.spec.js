// The brand safety and regulatory compliance gate, EXECUTED.
//
// api/_shared/compliance-lint.js is a deterministic linter: rule packs keyed
// by jurisdiction x sector, selected from the ACTIVE brand's own record, each
// rule citing the regulation or code section it enforces. It is wired into
// three places and every one is driven here as it ships:
//
//   1. the campaign builder's own check (smart-brain-plan.checkAssetContracts,
//      the pass that fills `contract_check`, which the review panel renders);
//   2. the dispatch preflight gate (preflight-core.run), which can BLOCK, and
//      the queue (dispatch-core.enqueue), where a compliance block is overridden
//      only with the operator's id AND a reason on the audit;
//   3. the copywriter's brief (copyPrompt and the pipeline briefing), built
//      from the same context, so the writer and the checker cannot disagree.
//
// Campaigns are BUILT (the noLLM builder path tests/generation-quality.spec.js
// uses, and once the scripted-model path) for a fictional dietary-supplement
// brand in the US and the UK and for a fictional sneaker brand, then copy with
// each violation class is put into the finished assets and the builder's own
// check is run on them. Every assertion is on what the gate RETURNED: the rule
// id, the severity, the words matched and where, the citation, the offered
// disclaimer. Nothing here reads a source file.
//
// The fixture brands, their approved claims and their citations are fiction
// (example.org); the regulatory citations are the module's own table.
//
// Run: npx playwright test tests/compliance-gate.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const sbPlan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const cl = require(path.join(ROOT, 'api', '_shared', 'compliance-lint.js'));
const preflight = require(path.join(ROOT, 'api', '_shared', 'preflight-core.js'));
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const TENANT_ZERO = require(path.join(ROOT, 'data', 'brands', '_default.json'));
const TOI_HEALTH = require(path.join(ROOT, 'data', 'brands', 'presets', 'toi-health-fitness.json'));

/* ── the world ──────────────────────────────────────────────────────────── */

const SLEEP_CLAIM = 'Clinically shown to support restful sleep in a randomised trial of 120 adults';
const SLEEP_URL = 'https://example.org/calmroot/sleep-trial';
const MAGNESIUM_CLAIM = 'Magnesium contributes to normal psychological function';
const NHC_URL = 'https://www.gov.uk/government/publications/great-britain-nutrition-and-health-claims-nhc-register';

const CALMROOT = {
  id: 'ws_calmroot', slug: 'calmroot', name: 'Calmroot',
  industry: 'Dietary supplements',
  palette: { primary: '#2F6B4F', accent: '#C9822B', ink: '#1A1A1A', surface: '#FFFFFF', surface_alt: '#F3F6F4', line: '#DDE5E0' },
  typography: { heading: "'Fraunces',Georgia,serif", body: "'Inter',Arial,sans-serif" },
  voice: { tone: 'calm, plain, evidence-led', banned: ['miracle', 'detox'] },
  claims: ['Third-party tested for purity'],
  approved_claims: [
    { text: SLEEP_CLAIM, citation: { source: 'Calmroot sleep trial report (fixture)', url: SLEEP_URL }, regions: ['US'] },
    { text: MAGNESIUM_CLAIM, citation: { source: 'GB NHC Register', url: NHC_URL }, register: 'GB NHC Register', regions: ['UK'] },
  ],
  regions: [
    { code: 'US', currency: 'USD', symbol: '$', store_url: 'https://calmroot.example', home: true },
    { code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://calmroot.example/uk' },
  ],
};

const NORTHLINE = {
  id: 'ws_northline', slug: 'northline', name: 'Northline',
  industry: 'Custom sneakers / D2C',
  palette: { primary: '#0B4F8A', accent: '#E8A33D', ink: '#141414', surface: '#FFFFFF', surface_alt: '#F4F6F8', line: '#DDE3E8' },
  typography: { heading: "'Spectral',Georgia,serif", body: "'Public Sans',Arial,sans-serif" },
  voice: { tone: 'bold', banned: ['knock-off'] },
  claims: ['Hand-finished in Leeds'],
  social: { instagram: 'https://instagram.com/northline' },
  regions: [{ code: 'US', currency: 'USD', symbol: '$', store_url: 'https://northline.example', home: true }, { code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://northline.example/uk' }],
};

function slot(brand, market, extra) {
  return Object.assign({
    id: `comp-${brand.slug}-${market}`, date: '2026-09-02', market,
    objective: 'reactivation and replenishment',
    cohort: { name: 'At Risk', size: 2000, rules: ['last order over 90 days'] },
    channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
    confidence: 0.8,
    heroProduct: { sku: 'A', title: 'Alpha 01', handle: 'alpha-01' },
    offer: { code: null, depth: 'none', pct: 0, why: 'n/a' },
    rationale: 'Lapsed buyers.',
    brand,
  }, extra || {});
}

const BUILT = {};
/** A campaign the app builds itself, on the noLLM path, cloned so a test may edit it. */
async function built(brand, market) {
  const key = `${brand.slug}:${market}`;
  if (!BUILT[key]) {
    const entry = slot(brand, market);
    BUILT[key] = { campaign: await sbPlan.buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false }), entry };
  }
  return { campaign: structuredClone(BUILT[key].campaign), entry: slot(brand, market) };
}

/** Put copy into the finished mailer as a reader would see it: a paragraph before </body>. */
function intoMailer(campaign, html, subject) {
  const e = campaign.assets.email;
  if (subject != null) e.subject = subject;
  e.html = /<\/body>/i.test(e.html) ? e.html.replace(/<\/body>/i, `${html}</body>`) : `${e.html}${html}`;
  return e;
}

const ids = (findings) => findings.map((f) => f.id);
/** Every rule a finding reports, including the ones merged into it ("also"). */
const ruleIds = (findings) => findings.flatMap((f) => [f.id].concat((f.also || []).map((a) => a.id)));
const byId = (findings, id) => findings.filter((f) => f.id === id);
const lintAs = (brand, market, asset, extra) => cl.lint(asset, Object.assign({ brand, market }, extra || {}));

/* ═══ 1. which rules apply is read off the brand record ═════════════════════ */

test('the packs are read off the brand record: a supplement brand gets the US health pack in the US and CAP sections 12 and 15 in the UK; a sneaker brand gets neither', () => {
  expect(lintAs(CALMROOT, 'US', 'x').packs).toEqual(['generic', 'us.ftc', 'us.fda-ftc.health']);
  expect(lintAs(CALMROOT, 'UK', 'x').packs).toEqual(['generic', 'uk.cap', 'uk.cap15', 'uk.cap12']);
  const us = lintAs(CALMROOT, 'US', 'x');
  expect(us.selection.sectors).toEqual([{ id: 'dietary_supplement', from: 'brand record: industry "Dietary supplements" names "Dietary supplements"' }]);
  expect(us.selection.jurisdictions).toEqual([{ code: 'US', from: "the asset's market (US)" }]);

  for (const brand of [NORTHLINE, TENANT_ZERO]) {
    for (const market of ['US', 'UK']) {
      const r = lintAs(brand, market, 'x');
      expect(r.packs, `${brand.name} ${market}`).not.toContain('us.fda-ftc.health');
      expect(r.packs).not.toContain('uk.cap15');
      expect(r.packs).not.toContain('uk.cap12');
      expect(r.selection.sectors).toEqual([]);
    }
  }
  expect(lintAs(NORTHLINE, 'US', 'x').packs).toEqual(['generic', 'us.ftc']);
  expect(lintAs(NORTHLINE, 'UK', 'x').packs).toEqual(['generic', 'uk.cap']);
});

test('compliance.sectors on the record outranks its industry, and a record with no industry is reported, never passed', () => {
  const declared = Object.assign({}, NORTHLINE, { industry: 'Lifestyle', compliance: { sectors: ['food'] } });
  const r = lintAs(declared, 'US', 'x');
  expect(r.packs).toContain('us.fda-ftc.health');
  expect(r.selection.sectors).toEqual([{ id: 'food', from: 'brand record: compliance.sectors' }]);
  // brand_data is where a persisted workspace keeps it.
  const persisted = Object.assign({}, NORTHLINE, { industry: 'Lifestyle', brand_data: { compliance: { sectors: ['dietary_supplement'] } } });
  expect(lintAs(persisted, 'US', 'x').packs).toContain('us.fda-ftc.health');

  const silent = Object.assign({}, NORTHLINE, { industry: '' });
  const s = lintAs(silent, 'US', { subject: 'Cures anxiety' });
  expect(s.verdict).toBe('warn');
  expect(s.findings.map((f) => [f.id, f.severity])).toEqual([['compliance.sector_unknown', 'WARN']]);
  expect(s.findings[0].fix).toMatch(/this is not a pass/);

  const none = cl.lint({ subject: 'Hello' }, { market: 'US' });
  expect(none.findings.map((f) => [f.id, f.severity])).toEqual([['compliance.no_brand', 'WARN']]);
});

test('a regulated brand in a market with no shipped pack is told so; a send with no single market is judged by every pack shipped', () => {
  const toi = lintAs(TOI_HEALTH, 'IN', { subject: 'A beginner-friendly training plan for the monsoon' });
  expect(toi.selection.sectors.map((s) => s.id)).toEqual(['health']);
  expect(toi.packs).toEqual(['generic']);
  expect(byId(toi.findings, 'compliance.jurisdiction_unsupported')).toHaveLength(1);
  expect(byId(toi.findings, 'compliance.jurisdiction_unsupported')[0].severity).toBe('WARN');
  expect(toi.limits.join(' ')).toMatch(/No regulatory pack is shipped for IN/);
  // A sneaker brand in India is told nothing it could act on: no health pack would apply anyway.
  expect(lintAs(TENANT_ZERO, 'IN', { subject: 'Grail drop' }).findings).toEqual([]);

  for (const market of ['GLOBAL', '']) {
    const g = lintAs(CALMROOT, market, 'x');
    expect(g.packs, `market "${market}"`).toEqual(['generic', 'us.ftc', 'us.fda-ftc.health', 'uk.cap', 'uk.cap15', 'uk.cap12']);
    expect(g.selection.jurisdictions.map((j) => j.code)).toEqual(['US', 'UK']);
  }
});

/* ═══ 2. a clean campaign passes with zero findings ═════════════════════════ */

test('a campaign the app builds for a supplement brand (US and UK) and for a sneaker brand passes the gate with zero findings', async () => {
  test.setTimeout(120_000);
  for (const [brand, market, packs] of [
    [CALMROOT, 'US', ['generic', 'us.ftc', 'us.fda-ftc.health']],
    [CALMROOT, 'UK', ['generic', 'uk.cap', 'uk.cap15', 'uk.cap12']],
    [NORTHLINE, 'US', ['generic', 'us.ftc']],
  ]) {
    const { campaign } = await built(brand, market);
    const comp = campaign.contract_check.compliance;
    const label = `${brand.name} ${market}`;
    expect(comp, `${label}: no compliance verdict on the campaign`).toBeTruthy();
    expect(comp.packs.map((p) => p.id), label).toEqual(packs);
    expect(comp.findings, `${label}: ${JSON.stringify(comp.findings).slice(0, 400)}`).toEqual([]);
    expect(comp.verdict).toBe('pass');
    // A check that inspects nothing passes everything: every asset was read.
    const assets = 1 + campaign.assets.ads.length + campaign.assets.landing_pages.length;
    expect(comp.checked, `${label}: assets linted`).toBe(assets);
    for (const ad of campaign.assets.ads) expect(ad.compliance_check.fields, `${label} ${ad.platform} ${ad.creative_type}: no copy read`).toBeGreaterThan(0);
    expect(campaign.assets.email.compliance_check.fields).toBeGreaterThanOrEqual(3);
    // And the asset contracts beside it are still clean.
    expect(campaign.contract_check.blocking, label).toBe(0);
    expect(campaign.contract_check.warnings, label).toBe(0);
  }
});

/* ═══ 3. each violation class, through the builder's own check ══════════════ */

test('US supplement: a disease claim BLOCKS with its exact words, offsets and the FDA citation; the campaign summary carries it for the review panel', async () => {
  const { campaign, entry } = await built(CALMROOT, 'US');
  intoMailer(campaign, '<p>Every night it cures your anxiety.</p>', 'Cures anxiety and treats insomnia');
  const summary = sbPlan.checkAssetContracts(campaign, entry);
  const f = campaign.assets.email.compliance_check.findings;

  const subject = byId(f, 'us.fda.disease_claim').filter((x) => x.field === 'subject');
  expect(subject.map((x) => [x.matched, x.offsets])).toEqual([
    ['Cures anxiety', { start: 0, end: 13 }],
    ['treats insomnia', { start: 18, end: 33 }],
  ]);
  for (const x of subject) {
    expect(x.severity).toBe('BLOCK');
    expect(x.pack).toBe('us.fda-ftc.health');
    expect(x.citation.map((c) => c.id)).toEqual(['cfr21.101.93g', 'usc21.343r6', 'ftc.health']);
    expect(x.citation[0]).toMatchObject({ cite: '21 CFR 101.93(g)', url: 'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-F/section-101.93' });
    expect(x.fix).toMatch(/no disclaimer or citation makes this claim permissible/);
  }
  // In the HTML, the offsets point back into the raw markup.
  const inMarkup = byId(f, 'us.fda.disease_claim').find((x) => x.field === 'html');
  expect(inMarkup.matched).toBe('cures your anxiety');
  expect(campaign.assets.email.html.slice(inMarkup.raw_offsets.start, inMarkup.raw_offsets.end)).toBe('cures your anxiety');

  expect(summary.compliance.verdict).toBe('block');
  expect(summary.compliance.blocking).toBeGreaterThanOrEqual(3);
  expect(summary.blocking).toBeGreaterThanOrEqual(3);
  const v = summary.violations.filter((x) => x.rule === 'us.fda.disease_claim');
  expect(v.length).toBe(3);
  expect(v.every((x) => x.asset === 'email' && x.level === 'block' && x.compliance === true)).toBe(true);
  expect(campaign.assets.email.contract_check.ok).toBe(false);
  expect(summary.compliance.findings.filter((x) => x.id === 'us.fda.disease_claim').map((x) => x.asset)).toEqual(['email', 'email', 'email']);
});

test('UK supplement: the same claim breaks CAP 15.6.2 and CAP 12.11, reported ONCE with every rule cited', async () => {
  const { campaign, entry } = await built(CALMROOT, 'UK');
  intoMailer(campaign, '', 'Cures anxiety');
  sbPlan.checkAssetContracts(campaign, entry);
  const f = campaign.assets.email.compliance_check.findings.filter((x) => x.field === 'subject');
  expect(f).toHaveLength(1);
  expect(f[0]).toMatchObject({ id: 'uk.cap15.disease_claim', severity: 'BLOCK', matched: 'Cures anxiety', offsets: { start: 0, end: 13 } });
  expect(f[0].also.map((a) => a.id)).toEqual(['uk.cap12.medicinal_claim']);
  expect(f[0].citation.map((c) => c.cite)).toEqual(['CAP Code rule 15.6.2', 'Regulation (EU) No 1169/2011, Article 7(3) (assimilated law)', 'CAP Code rule 12.11']);
  expect(f[0].citation[0].url).toBe('https://www.asa.org.uk/type/non_broadcast/code_section/15.html');
});

test('a negated disease claim is a reference to review (WARN), not a pass and not a block; a negation in another clause negates nothing', () => {
  const neg = lintAs(CALMROOT, 'US', { html: '<p>Calmroot does not cure anxiety. It doesn\'t treat insomnia either.</p>' });
  expect(neg.findings.map((x) => [x.id, x.severity, x.matched])).toEqual([
    ['us.fda.disease_reference', 'WARN', 'cure anxiety'],
    ['us.fda.disease_reference', 'WARN', 'treat insomnia'],
  ]);
  expect(neg.verdict).toBe('warn');
  for (const subject of ['Not just a tea: it cures anxiety', 'No sugar, it cures anxiety']) {
    const r = lintAs(CALMROOT, 'US', { subject });
    expect(r.findings.map((x) => [x.id, x.severity]), subject).toEqual([['us.fda.disease_claim', 'BLOCK']]);
  }
});

test('weight loss: unsubstantiated in the US, unauthorised in the UK, and a rate or amount is barred outright in the UK', async () => {
  const us = lintAs(CALMROOT, 'US', { subject: 'Melts belly fat while you sleep' });
  expect(us.findings).toHaveLength(1);
  expect(us.findings[0]).toMatchObject({ id: 'us.ftc.health_claim_unsubstantiated', severity: 'BLOCK', matched: 'Melts belly fat' });
  expect(us.findings[0].marker).toBe('[DATA REQUIRED BEFORE LAUNCH: approved claim + citation, Melts belly fat while you sleep, Calmroot]');
  expect(us.findings[0].citation.map((c) => c.url)).toEqual(['https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance']);

  const ukFat = lintAs(CALMROOT, 'UK', { subject: 'Melts belly fat while you sleep' });
  expect(ukFat.findings.map((x) => [x.id, x.severity])).toEqual([['uk.cap15.health_claim_unauthorised', 'BLOCK']]);
  expect(ukFat.findings[0].marker).toBe('[DATA REQUIRED BEFORE LAUNCH: GB NHC Register authorisation, Melts belly fat while you sleep, Calmroot]');

  const { campaign, entry } = await built(CALMROOT, 'UK');
  intoMailer(campaign, '<p>Lose 5 kg in 2 weeks.</p>');
  sbPlan.checkAssetContracts(campaign, entry);
  const rate = byId(campaign.assets.email.compliance_check.findings, 'uk.cap15.weight_loss_rate');
  expect(rate).toHaveLength(1);
  expect(rate[0]).toMatchObject({ severity: 'BLOCK', matched: 'Lose 5 kg in 2 weeks' });
  expect(rate[0].citation.map((c) => c.cite)).toEqual(['CAP Code rule 15.6.6', 'Regulation (EC) No 1924/2006, Article 12(b) (assimilated law)']);
  expect(rate[0].fix).toMatch(/no approval makes it acceptable/);
});

test('US supplement: a structure/function claim needs the 21 CFR 101.93(c) disclaimer verbatim, linked by an asterisk or adjacent; the exact text is OFFERED, never inserted', async () => {
  const { campaign, entry } = await built(CALMROOT, 'US');
  const before = campaign.assets.email.html;
  intoMailer(campaign, '<p>Supports restful sleep.</p>');
  sbPlan.checkAssetContracts(campaign, entry);
  const missing = byId(campaign.assets.email.compliance_check.findings, 'us.fda.sf_disclaimer_missing');
  expect(missing).toHaveLength(1);
  expect(missing[0]).toMatchObject({ severity: 'BLOCK', matched: 'Supports restful sleep', offer: cl.DISCLAIMER_SINGULAR });
  expect(cl.DISCLAIMER_SINGULAR).toBe('This statement has not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.');
  expect(missing[0].citation.map((c) => c.cite)).toEqual(['21 CFR 101.93(c)-(d)', '21 U.S.C. 343(r)(6)']);
  expect(campaign.assets.email.html, 'the gate inserted the disclaimer itself').toBe(`${before.replace(/<\/body>/i, '<p>Supports restful sleep.</p></body>')}`);
  expect(campaign.assets.email.html).not.toContain('has not been evaluated');

  // Two statements: the plural form is the one offered.
  const two = lintAs(CALMROOT, 'US', { html: '<p>Supports restful sleep. Boosts immunity.</p>' });
  expect(byId(two.findings, 'us.fda.sf_disclaimer_missing')[0].offer).toBe(cl.DISCLAIMER_PLURAL);
  expect(byId(two.findings, 'us.fda.sf_disclaimer_missing')[0].related.map((r) => r.matched)).toEqual(['Supports restful sleep', 'Boosts immunity']);

  // Linked by the asterisk: no disclaimer finding (the claim itself still needs its evidence).
  const linked = lintAs(CALMROOT, 'US', { html: `<p>Supports restful sleep.*</p><p style="font-size:12px">*${cl.DISCLAIMER_SINGULAR}</p>` });
  expect(ids(linked.findings).filter((x) => /sf_disclaimer/.test(x))).toEqual([]);
  expect(ids(linked.findings)).toEqual(['us.ftc.health_claim_unsubstantiated']);

  // Present but linked to nothing.
  const unlinked = lintAs(CALMROOT, 'US', { html: `<p>Supports restful sleep.</p><p>Shop now.</p><p>${cl.DISCLAIMER_SINGULAR}</p>` });
  expect(byId(unlinked.findings, 'us.fda.sf_disclaimer_unlinked').map((x) => [x.severity, x.matched])).toEqual([['BLOCK', 'Supports restful sleep']]);

  // A paraphrase is not the prescribed text.
  const para = lintAs(CALMROOT, 'US', { html: '<p>Supports restful sleep.* *Not evaluated by the FDA.</p>' });
  expect(byId(para.findings, 'us.fda.sf_disclaimer_wording')).toHaveLength(1);
  expect(byId(para.findings, 'us.fda.sf_disclaimer_wording')[0].fix).toMatch(/paraphrased \("Not evaluated by the FDA"\)/);
  // The disclaimer's own "diagnose, treat, cure, or prevent any disease" is not a disease claim.
  expect(ids(linked.findings)).not.toContain('us.fda.disease_claim');
  expect(ids(linked.findings)).not.toContain('us.fda.disease_reference');
});

test('an approved claim WITH its citation passes word for word, only in the market it is approved for', async () => {
  const { campaign, entry } = await built(CALMROOT, 'US');
  intoMailer(campaign, `<p>${SLEEP_CLAIM}. ${cl.DISCLAIMER_SINGULAR}</p>`);
  sbPlan.checkAssetContracts(campaign, entry);
  const cc = campaign.assets.email.compliance_check;
  expect(cc.findings, JSON.stringify(cc.findings)).toEqual([]);
  expect(cc.matched_claims).toEqual([expect.objectContaining({ text: SLEEP_CLAIM, citation: { source: 'Calmroot sleep trial report (fixture)', url: SLEEP_URL }, source: 'brand record: approved_claims[0]' })]);

  // The same words in the UK: approved for the US only. The clinical claim and
  // the health claim inside it need the same thing (an approval valid HERE),
  // so they are ONE finding citing both rules.
  const uk = lintAs(CALMROOT, 'UK', { html: `<p>${SLEEP_CLAIM}.</p>` });
  expect(uk.findings).toHaveLength(1);
  // The reported span covers both rules' words.
  expect(uk.findings[0]).toMatchObject({ id: 'uk.cap15.health_claim_unauthorised', severity: 'BLOCK', matched: 'Clinically shown to support restful sleep' });
  const clinical = uk.findings[0].also.find((a) => a.id === 'generic.uncited_clinical_claim');
  expect(clinical.fix).toMatch(/approved only for US \(brand record: approved_claims\[0\]\)/);
  expect(uk.findings[0].citation.map((c) => c.id)).toEqual(expect.arrayContaining(['cap.15.1.1', 'gb.nhc', 'spec.1.1', 'cap.12.1']));
  // The UK register wording passes in the UK, as an authorised claim.
  const reg = lintAs(CALMROOT, 'UK', { html: `<p>${MAGNESIUM_CLAIM}.</p>` });
  expect(reg.findings).toEqual([]);
  expect(reg.matched_claims.map((c) => [c.text, c.register])).toEqual([[MAGNESIUM_CLAIM, 'GB NHC Register']]);
  // A truncated approved claim is not the approved claim.
  const cut = lintAs(CALMROOT, 'US', { html: `<p>Clinically shown to support restful sleep.* *${cl.DISCLAIMER_SINGULAR}</p>` });
  expect(ruleIds(cut.findings)).toContain('generic.uncited_clinical_claim');
  expect(cut.verdict).toBe('block');
});

test('a clinical claim, a trial count, "dermatologist tested" and a statistic with nothing approved behind them BLOCK with the DATA REQUIRED marker; an approved claim with no citation is not evidence', async () => {
  const { campaign, entry } = await built(CALMROOT, 'US');
  intoMailer(campaign, '<p>Clinically proven. Backed by 24 trials. Dermatologist tested. 93% of users slept better.</p>');
  sbPlan.checkAssetContracts(campaign, entry);
  const f = campaign.assets.email.compliance_check.findings.filter((x) => x.field === 'html');
  expect(f.map((x) => [x.id, x.severity, x.matched])).toEqual([
    ['generic.uncited_clinical_claim', 'BLOCK', 'Clinically proven'],
    ['generic.uncited_clinical_claim', 'BLOCK', '24 trials'],
    ['generic.uncited_clinical_claim', 'BLOCK', 'Dermatologist tested'],
    ['generic.unverified_claim', 'BLOCK', '93% of users'],
  ]);
  expect(f.map((x) => x.marker)).toEqual([
    '[DATA REQUIRED BEFORE LAUNCH: approved claim + citation, Clinically proven, Calmroot]',
    '[DATA REQUIRED BEFORE LAUNCH: approved claim + citation, Backed by 24 trials, Calmroot]',
    '[DATA REQUIRED BEFORE LAUNCH: approved claim + citation, Dermatologist tested, Calmroot]',
    '[DATA REQUIRED BEFORE LAUNCH: approved claim + citation, 93% of users slept better, Calmroot]',
  ]);
  expect(f[0].citation.map((c) => c.id)).toEqual(['spec.1.1', 'spec.1.9', 'ftc.health']);
  // An uncited approval of a clinical claim is reported as exactly that.
  const uncited = Object.assign({}, CALMROOT, { claims: ['Clinically tested formula'] });
  const r = lintAs(uncited, 'US', { subject: 'Clinically tested formula' });
  expect(r.findings.map((x) => [x.id, x.title])).toEqual([['generic.uncited_clinical_claim', 'Clinical claim approved without a citation']]);
  expect(r.findings[0].fix).toMatch(/matches brand record: claims\[0\], which carries no citation/);
});

test('the brand\'s own banned list, an objective superlative, a guaranteed outcome and an unqualified "best"', async () => {
  const { campaign, entry } = await built(CALMROOT, 'US');
  intoMailer(campaign, '<p>A miracle in a capsule. It detoxes overnight.</p><p>The #1 sleep blend. Best results guaranteed.</p>');
  sbPlan.checkAssetContracts(campaign, entry);
  const f = campaign.assets.email.compliance_check.findings.filter((x) => x.field === 'html');
  expect(f.map((x) => [x.id, x.severity, x.matched])).toEqual([
    ['generic.banned_phrase', 'BLOCK', 'miracle'],
    ['generic.banned_phrase', 'BLOCK', 'detoxes'],
    ['generic.objective_superlative', 'BLOCK', '#1'],
    ['generic.guaranteed_outcome', 'BLOCK', 'results guaranteed'],
    ['generic.unqualified_absolute', 'WARN', 'Best'],
  ]);
  expect(f[0].citation).toEqual([expect.objectContaining({ id: 'brand.banned', cite: 'Brand record: voice.banned' })]);
  expect(f[2].citation.map((c) => c.id)).toEqual(['spec.1.10', 'ftc.substantiation', 'spec.1.1']);
  // The same superlative in the UK cites the CAP Code's substantiation rule.
  expect(byId(lintAs(CALMROOT, 'UK', { subject: 'The #1 sleep blend' }).findings, 'generic.objective_superlative')[0].citation.map((c) => c.cite)).toContain('CAP Code rule 3.7');
});

test('a deadline or a stock count BLOCKS unless the offer on record backs it', async () => {
  const { campaign, entry } = await built(NORTHLINE, 'US');
  intoMailer(campaign, '<p>Ends tonight: only 3 left.</p>');
  sbPlan.checkAssetContracts(campaign, entry);
  const f = byId(campaign.assets.email.compliance_check.findings, 'generic.unbacked_urgency');
  expect(f.map((x) => [x.matched, x.title])).toEqual([
    ['Ends tonight', 'Deadline with no end date on record'],
    ['only 3 left', 'Scarcity with no stock level on record'],
  ]);
  expect(f[0].marker).toBe('[DATA REQUIRED BEFORE LAUNCH: offer end date behind "Ends tonight", US, Northline]');

  const backed = Object.assign(slot(NORTHLINE, 'US'), { offer: { code: 'NL10', pct: 0.1, ends_at: '2026-09-02T23:59:00-04:00', stock: 3 } });
  sbPlan.checkAssetContracts(campaign, backed);
  expect(byId(campaign.assets.email.compliance_check.findings, 'generic.unbacked_urgency')).toEqual([]);
});

test('endorsements: an undisclosed creator or testimonial WARNS in the US, creator content WARNS in the UK, and the brand\'s own handle is not an endorser', () => {
  const us = lintAs(NORTHLINE, 'US', { primary_text: 'Worn by Jordan Lee all season. Follow @northline.' });
  expect(us.findings.map((x) => [x.id, x.severity, x.matched])).toEqual([['us.ftc.endorsement_disclosure', 'WARN', 'Worn by Jordan']]);
  expect(us.findings[0].citation.map((c) => c.cite)).toEqual(['16 CFR 255.5']);
  expect(lintAs(NORTHLINE, 'US', { primary_text: 'Worn by Jordan Lee all season. #ad' }).findings).toEqual([]);
  const quote = lintAs(NORTHLINE, 'US', { html: '<p>“These are the only pair I wear now” — Sam Patel</p>' });
  expect(ids(quote.findings)).toEqual(['us.ftc.endorsement_disclosure']);

  const uk = lintAs(NORTHLINE, 'UK', { caption: 'Our brand ambassador Jordan Lee breaks in the new pair.' });
  expect(uk.findings.map((x) => [x.id, x.severity])).toEqual([['uk.cap.endorsement_identifiable', 'WARN']]);
  expect(uk.findings[0].citation[0]).toMatchObject({ cite: 'CAP Code rules 2.1 and 2.3', url: 'https://www.asa.org.uk/type/non_broadcast/code_section/02.html' });
  // A UK testimonial from a customer is not creator content.
  expect(lintAs(NORTHLINE, 'UK', { html: '<p>“These are the only pair I wear now” — Sam Patel</p>' }).findings).toEqual([]);

  // A supplement's results testimonial is read as typical.
  const results = lintAs(CALMROOT, 'US', { html: '<p>“My sleep is so much deeper since week one” — Dana R.</p>' });
  expect(ids(results.findings)).toEqual(expect.arrayContaining(['us.ftc.endorsement_disclosure', 'us.ftc.testimonial_typicality']));
  expect(byId(results.findings, 'us.ftc.testimonial_typicality')[0].citation.map((c) => c.cite)).toContain('16 CFR 255.2(b)');
});

test('words are matched on Unicode boundaries: German "bestätigt", "manicure" and "secure" are not claims; copy that is not English is reported, not passed', () => {
  // JavaScript's \b would read "ä" as a boundary and find "best" in "bestätigt".
  expect(lintAs(NORTHLINE, 'US', { subject: 'Bestätigt von unseren Kunden' }).findings).toEqual([]);
  expect(lintAs(CALMROOT, 'US', { html: '<p>Secure checkout. Our manicure kit prevents chipped nails. Procure yours today.</p>' }).findings).toEqual([]);

  const fr = lintAs(CALMROOT, 'US', { subject: 'Une cure de magnésium pour retrouver un sommeil profond et apaisé chaque nuit' });
  expect(fr.findings.map((x) => [x.id, x.severity])).toEqual([['compliance.language_unchecked', 'WARN']]);
  expect(fr.verdict).toBe('warn');
  // A brand in no regulated sector has no English-only health lexicon to fail.
  expect(lintAs(NORTHLINE, 'US', { subject: 'Une paire unique, peinte à la main, pour chaque saison de la ville' }).findings).toEqual([]);
});

test('HTML is read as the reader sees it: alt text and Outlook\'s conditional content are linted, style blocks and comments are not', () => {
  const html = [
    '<html><head><title>Cures anxiety</title><style>.x{content:"cures anxiety"}</style></head><body>',
    '<!-- treats insomnia -->',
    '<!--[if mso]><table><tr><td>It treats insomnia</td></tr></table><![endif]-->',
    '<img src="https://calmroot.example/a.png" alt="Cures anxiety fast">',
    '<p style="display:none;font-size:1px">Cures&nbsp;anxiety in the preheader</p>',
    '</body></html>',
  ].join('');
  const r = lintAs(CALMROOT, 'US', { html });
  const d = byId(r.findings, 'us.fda.disease_claim');
  expect(d.map((x) => x.matched)).toEqual(['treats insomnia', 'Cures anxiety', 'Cures anxiety']);
  for (const x of d) {
    const raw = html.slice(x.raw_offsets.start, x.raw_offsets.end);
    expect(raw.replace('&nbsp;', ' ')).toBe(x.matched);
  }
  // The subject and preheader fields are copy too.
  const sp = lintAs(CALMROOT, 'US', { subject: 'Calm, tonight', preheader: 'It cures anxiety' });
  expect(byId(sp.findings, 'us.fda.disease_claim').map((x) => x.field)).toEqual(['preheader']);
});

test('a sneaker brand never gets the supplement pack, whatever its copy says', async () => {
  const { campaign, entry } = await built(NORTHLINE, 'US');
  intoMailer(campaign, '<p>It cures anxiety and supports restful sleep.</p>');
  sbPlan.checkAssetContracts(campaign, entry);
  const comp = campaign.contract_check.compliance;
  expect(comp.packs.map((p) => p.id)).toEqual(['generic', 'us.ftc']);
  expect(comp.findings.filter((x) => /^us\.fda|^us\.ftc\.health|^uk\.cap1[25]/.test(x.id))).toEqual([]);
});

test('validation never rewrites copy: every field the gate read is byte for byte what it was handed', async () => {
  const { campaign, entry } = await built(CALMROOT, 'US');
  intoMailer(campaign, '<p>Cures anxiety. Clinically proven. Ends tonight. A miracle.</p>', 'Supports restful sleep');
  campaign.assets.ads[0].primary_text = 'The #1 sleep blend, guaranteed results.';
  const strip = (c) => JSON.stringify(c.assets, (k, v) => (k === 'contract_check' || k === 'compliance_check' ? undefined : v));
  const before = strip(campaign);
  sbPlan.checkAssetContracts(campaign, entry);
  expect(campaign.contract_check.compliance.verdict).toBe('block');
  expect(strip(campaign)).toBe(before);
});

/* ═══ review findings on #138 (the linter), each failing before its fix ═════ */

test('REVIEW P1: one claim approved separately per region keeps its evidence per region; a UK approval never inherits a US study', () => {
  const brand = Object.assign({}, CALMROOT, {
    approved_claims: [
      { text: SLEEP_CLAIM, citation: { source: 'Calmroot sleep trial report (fixture)', url: SLEEP_URL }, regions: ['US'] },
      { text: SLEEP_CLAIM, register: 'GB NHC Register', regions: ['UK'] },
    ],
  });
  // The UK approval is a register entry with no study behind it, so the
  // clinical half of the sentence has nothing to cite in the UK.
  const uk = lintAs(brand, 'UK', { html: `<p>${SLEEP_CLAIM}.</p>` });
  expect(ruleIds(uk.findings)).toContain('generic.uncited_clinical_claim');
  expect(JSON.stringify(uk.findings)).not.toContain(SLEEP_URL);
  expect(JSON.stringify(uk.matched_claims)).not.toContain(SLEEP_URL);
  const ukBrief = cl.brief({ brand, market: 'UK' });
  expect(ukBrief).not.toContain(SLEEP_URL);
  expect(ukBrief).toContain(`"${SLEEP_CLAIM}" [approved on the brand record; no evidence citation, so never present it as clinical or scientific] [GB NHC Register]`);
  // The US keeps its own evidence, and the UK's register entry is not the US's.
  const us = lintAs(brand, 'US', { html: `<p>${SLEEP_CLAIM}. ${cl.DISCLAIMER_SINGULAR}</p>` });
  expect(us.findings).toEqual([]);
  expect(us.matched_claims.map((c) => [c.citation && c.citation.url, c.register])).toEqual([[SLEEP_URL, null]]);
  // A market-wide uncited string beside a US-cited copy: the US uses the cited one.
  const both = Object.assign({}, CALMROOT, { claims: [SLEEP_CLAIM], approved_claims: [{ text: SLEEP_CLAIM, citation: { source: 'study', url: SLEEP_URL }, regions: ['US'] }] });
  expect(lintAs(both, 'US', { html: `<p>${SLEEP_CLAIM}. ${cl.DISCLAIMER_SINGULAR}</p>` }).findings).toEqual([]);
  expect(ruleIds(lintAs(both, 'UK', { html: `<p>${SLEEP_CLAIM}.</p>` }).findings)).toContain('generic.uncited_clinical_claim');
  // A send with no single market may reach the UK: a US-only study is not its evidence.
  const global = lintAs(brand, 'GLOBAL', { html: `<p>${SLEEP_CLAIM}. ${cl.DISCLAIMER_SINGULAR}</p>` });
  expect(ruleIds(global.findings)).toContain('generic.uncited_clinical_claim');
  expect(JSON.stringify(global.matched_claims)).not.toContain(SLEEP_URL);
});

test('REVIEW P1: a sector the gate cannot classify is reported UNCHECKED, naming the value, and never treated as classified', () => {
  const declared = Object.assign({}, NORTHLINE, { compliance: { sectors: ['cannabis'] } });
  const r = lintAs(declared, 'US', { subject: 'Cures anxiety' });
  expect(r.verdict).toBe('warn');
  expect(r.findings.map((f) => [f.id, f.severity])).toEqual([['compliance.sector_unrecognised', 'WARN']]);
  expect(r.findings[0].fix).toContain('"cannabis"');
  expect(r.selection.sector_basis).toBe('unrecognised');

  const industry = Object.assign({}, NORTHLINE, { industry: 'Nootropic gummies' });
  const r2 = lintAs(industry, 'US', { subject: 'Cures anxiety' });
  expect(r2.findings.map((f) => f.id)).toEqual(['compliance.sector_unrecognised']);
  expect(r2.findings[0].fix).toContain('"Nootropic gummies"');

  // A value the table does recognise is classified, so its packs apply.
  const pharma = Object.assign({}, NORTHLINE, { compliance: { sectors: ['pharmaceutical'] } });
  const r3 = lintAs(pharma, 'US', { subject: 'Cures anxiety' });
  expect(r3.packs).toContain('us.fda-ftc.health');
  expect(r3.findings.map((f) => f.id)).toEqual(['us.fda.disease_claim']);
  // A sector the record names that IS recognised beside one that is not: both said.
  const mixed = Object.assign({}, NORTHLINE, { compliance: { sectors: ['food', 'tobacco'] } });
  const r4 = lintAs(mixed, 'US', { subject: 'Cures anxiety' });
  expect(r4.findings.map((f) => f.id).sort()).toEqual(['compliance.sector_unrecognised', 'us.fda.disease_claim']);

  // An industry the gate KNOWS carries no shipped sector pack is classified as such, with its basis.
  const sneaker = lintAs(NORTHLINE, 'US', { subject: 'Grail drop' });
  expect(sneaker.findings).toEqual([]);
  expect(sneaker.selection.sector_basis).toBe('no-regulated-sector');
  expect(sneaker.selection.sector_from).toBe('brand record: industry "Custom sneakers / D2C" names "sneakers"');
});

test('REVIEW P2: a guaranteed outcome BLOCKS even when it is on the approved list with a citation', () => {
  const brand = Object.assign({}, CALMROOT, {
    approved_claims: [{ text: 'Guaranteed weight loss in 30 days', citation: { source: 'fixture', url: 'https://example.org/calmroot/wl' }, regions: ['US'] }],
  });
  const r = lintAs(brand, 'US', { subject: 'Guaranteed weight loss in 30 days' });
  expect(ruleIds(r.findings)).toContain('generic.guaranteed_outcome');
  expect(r.verdict).toBe('block');
  const g = r.findings.find((f) => ruleIds([f]).includes('generic.guaranteed_outcome'));
  expect(g.severity).toBe('BLOCK');
  // And the writer is never handed it as usable.
  const brief = cl.brief({ brand, market: 'US' });
  expect(brief).not.toContain('"Guaranteed weight loss in 30 days"');
  expect(brief).toContain('Never promise a guaranteed result or outcome.');
});

test('REVIEW P1: a recorded offer backs only what it says: the deadline window and the stock number are compared with the copy, from an injectable now', () => {
  const at = (subject, offer, now) => lintAs(NORTHLINE, 'US', { subject }, { offer, now: now || '2026-10-01T10:00:00Z' });
  const urgency = (r) => r.findings.filter((f) => f.id === 'generic.unbacked_urgency').map((f) => [f.severity, f.matched]);
  // 2026-10-01 is a Thursday.
  expect(urgency(at('Today only', { ends_at: '2026-12-31' }))).toEqual([['BLOCK', 'Today only']]);
  expect(urgency(at('Today only', { ends_at: '2026-10-01T23:59:00Z' }))).toEqual([]);
  expect(urgency(at('Ends tonight', { ends_at: '2026-10-01T23:30:00-04:00' }))).toEqual([]);
  expect(urgency(at('Ends tonight', { ends_at: '2026-10-02T23:30:00Z' }))).toEqual([['BLOCK', 'Ends tonight']]);
  expect(urgency(at('48 hours only', { ends_at: '2026-10-02T20:00:00Z' }))).toEqual([]);
  expect(urgency(at('48 hours only', { ends_at: '2026-10-04T10:00:00Z' }))).toEqual([['BLOCK', '48 hours only']]);
  expect(urgency(at('Ends this weekend', { ends_at: '2026-10-04T23:00:00Z' }))).toEqual([]);
  expect(urgency(at('Ends this weekend', { ends_at: '2026-10-07T23:00:00Z' }))).toEqual([['BLOCK', 'Ends this weekend']]);
  // An offer that has already ended backs no deadline at all.
  const ended = at('Limited time offer', { ends_at: '2026-09-30T23:00:00Z' });
  expect(urgency(ended)).toEqual([['BLOCK', 'Limited time offer']]);
  expect(ended.findings[0].fix).toMatch(/ended/);
  // Stock: the number in the copy is the number on record, or it is not backed.
  expect(urgency(at('Only 500 left', { stock: 1 }))).toEqual([['BLOCK', 'Only 500 left']]);
  expect(urgency(at('Only 3 left', { stock: 40 }))).toEqual([['BLOCK', 'Only 3 left']]);
  expect(urgency(at('Only 1 left', { stock: 1 }))).toEqual([]);
  // A qualitative line cannot be measured against a number: said, not passed.
  expect(urgency(at('Selling fast', { stock: 40 }))).toEqual([['WARN', 'Selling fast']]);
});

test('REVIEW P2: alt text and every copy field asset-specs defines are linted (a Pin carries alt_text publicly)', () => {
  const fields = ['alt_text', 'alt', 'image_alt', 'subject_line', 'from_name', 'cta_text', 'cta_label', 'seo_title', 'meta_description', 'og_title', 'og_description', 'h1', 'first_comment', 'cover_text'];
  for (const k of fields) {
    const r = lintAs(CALMROOT, 'US', { [k]: 'Cures anxiety' });
    expect(r.findings.map((f) => [f.id, f.field]), k).toEqual([['us.fda.disease_claim', k]]);
  }
  expect(lintAs(CALMROOT, 'US', { headings: ['Calm, nightly', 'Cures anxiety'] }).findings.map((f) => f.field)).toEqual(['headings[1]']);
  expect(lintAs(CALMROOT, 'US', { body_html: '<p>It cures anxiety.</p>' }).findings.map((f) => f.field)).toEqual(['body_html']);
  // A disclosure in the hashtags is read too, so a disclosed creator post is not warned.
  expect(lintAs(NORTHLINE, 'US', { caption: 'Worn by Jordan Lee all season.', hashtags: ['#ad', '#northline'] }).findings).toEqual([]);
  expect(lintAs(NORTHLINE, 'US', { caption: 'Worn by Jordan Lee all season.', hashtags: '#ad #northline' }).findings).toEqual([]);
});

/* ═══ 4. the preflight gate and the queue ═══════════════════════════════════ */

const CONN = { oauth_scopes: ['campaigns:write', 'templates:write'], config: { publishing_enabled: true }, secret_fields: ['access_token'], status: 'active' };
const gateRun = (extra) => preflight.run(Object.assign({
  provider: 'klaviyo', channel: 'klaviyo_email', mode: 'publish', connection: CONN,
  message_priority: 'transactional', mapping_missing: [],
}, extra || {}));

test('the preflight gate BLOCKS on a compliance finding and carries every finding, packs and selection on the check', async () => {
  const out = await gateRun({
    brand: CALMROOT, market: 'US',
    payload: { subject: 'Cures anxiety', html: '<p>Supports restful sleep.</p><a href="https://calmroot.example/u">Unsubscribe</a>' },
  });
  const c = out.checks.find((x) => x.id === 'compliance');
  expect(c.status).toBe('block');
  expect(c.label).toBe('Brand safety and compliance');
  expect(ids(c.findings)).toEqual(expect.arrayContaining(['us.fda.disease_claim', 'us.ftc.health_claim_unsubstantiated', 'us.fda.sf_disclaimer_missing']));
  expect(c.packs).toEqual(['generic', 'us.ftc', 'us.fda-ftc.health']);
  expect(c.detail).toMatch(/^3 blocking, 0 warning\(s\): Disease claim \("Cures anxiety"\)/);
  expect(c.remediation).toMatch(/^Remove "Cures anxiety"/);
  expect(out.verdict).toBe('block');
  expect(out.blocking.join(' ')).toMatch(/Brand safety and compliance: 3 blocking/);

  const sf = await gateRun({ brand: CALMROOT, market: 'US', payload: { subject: 'Sleep, sorted', html: '<p>Supports restful sleep.</p>' } });
  // The offered disclaimer is in the remediation an operator reads.
  expect(sf.checks.find((x) => x.id === 'compliance').remediation).toContain(`Required text: ${cl.DISCLAIMER_SINGULAR}`);

  const clean = await gateRun({ brand: CALMROOT, market: 'US', payload: { subject: 'Your order is on its way', html: '<p>Thanks for your order.</p>' } });
  expect(clean.checks.find((x) => x.id === 'compliance')).toMatchObject({ status: 'pass', detail: 'No findings in 2 copy field(s). Rule packs: generic, us.ftc, us.fda-ftc.health.' });
  const silent = await gateRun({ brand: CALMROOT, market: 'US', channel: 'klaviyo_event', payload: { metric: 'Placed Order', properties: { value: 10 } } });
  expect(silent.checks.find((x) => x.id === 'compliance').status).toBe('skip');
});

/**
 * The dispatch queue over the in-memory PostgREST (tests/lib/fake-supabase.js):
 * a supplement workspace with a Klaviyo connection, read as the service. `fn`
 * gets the world; the environment and fetch are restored whatever happens.
 */
async function withQueue(fn) {
  const { FakeSupabase, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');
  const connections = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
  const dispatch = require(path.join(ROOT, 'api', '_shared', 'dispatch-core.js'));
  const wsScope = require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js'));
  const ENV = envScope(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY', 'CONNECTION_SECRET_KEY', 'LIVE_CONNECTORS']);
  ENV.save();
  const realFetch = global.fetch;
  try {
    process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.CONNECTION_SECRET_KEY = 'c'.repeat(64);
    for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'LIVE_CONNECTORS']) delete process.env[k];
    const WS = 'ws-compliance-gate';
    const db = new FakeSupabase();
    // The workspace's own row is the brand the copy is linted as when the
    // router hands none over: a supplement brand, read as the service.
    db.addUser('tok-c', 'user-c', 'c@example.test')
      .addWorkspace(WS, 'user-c', { name: 'Calmroot', industry: 'Dietary supplements', voice: { banned: ['miracle'] }, regions: CALMROOT.regions })
      .setActive('user-c', WS).syncIdentityTables();
    const conn = db.insert('workspace_connections', {
      workspace_id: WS, provider: 'klaviyo', category: 'lifecycle', auth_kind: 'oauth', label: 'Klaviyo',
      config: { publishing_enabled: true }, secret_fields: ['access_token'], secret_hint: 'ss-1', status: 'active', connect_kind: 'oauth',
      oauth_scopes: ['templates:write', 'campaigns:write', 'events:write'], token_expires_at: new Date(Date.now() + 3600_000).toISOString(), revoked_at: null,
    });
    db.insert('workspace_connection_secrets', Object.assign({ connection_id: conn.id, workspace_id: WS }, connections.encryptSecrets({ access_token: 'kl-access-1' })));
    db.install();
    connections._resolvedCache.clear();
    wsScope.invalidate();
    const AUTH = { ok: true, token: 'tok-c', user_id: 'user-c', email: 'c@example.test' };
    const SPEC = (extra) => Object.assign({
      channel: 'klaviyo_email', skip_mapping: true, asset_ref: 'mailer-c1', message_priority: 'transactional', market: 'US',
      payload: { subject: 'Cures anxiety', html: '<p>Your calm is in the post.</p><a href="https://calmroot.example/u">Unsubscribe</a>', from_email: 'hello@calmroot.example', list_id: 'L1' },
    }, extra || {});
    await fn({ db, dispatch, WS, AUTH, SPEC });
    expect(db.external(), 'the gate sent nothing anywhere').toHaveLength(0);
    db.restore();
  } finally {
    global.fetch = realFetch;
    ENV.restore();
    require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js')).invalidate();
  }
}
const complianceOf = (out) => out.preflight.checks.find((x) => x.id === 'compliance');

test('the queue: a compliance block never becomes a job; an override needs a reason, and the audit keeps who, why and every finding', async () => {
  await withQueue(async ({ db, dispatch, WS, AUTH, SPEC }) => {
    const refused = await dispatch.enqueue(AUTH, WS, SPEC());
    expect(refused).toMatchObject({ ok: false, blocked: true });
    expect(refused.message).toMatch(/Brand safety and compliance: 1 blocking/);
    const check = complianceOf(refused);
    expect(check.status).toBe('block');
    expect(check.findings.map((f) => [f.id, f.matched])).toEqual([['us.fda.disease_claim', 'Cures anxiety']]);
    expect(db.table('dispatch_jobs')).toHaveLength(0);

    const noReason = await dispatch.enqueue(AUTH, WS, SPEC({ override_preflight: true }));
    expect(noReason).toMatchObject({ ok: false, blocked: true, error: 'override_reason_required' });
    expect(noReason.message).toMatch(/only with a reason/);
    expect(db.table('dispatch_jobs')).toHaveLength(0);
    expect(db.table('preflight_audits')).toHaveLength(0);

    const forced = await dispatch.enqueue(AUTH, WS, SPEC({ override_preflight: true, override_note: 'Legal sign-off LG-77: copy approved for a clinical audience only' }));
    expect(forced.ok).toBe(true);
    const job = db.table('dispatch_jobs')[0];
    expect(job).toMatchObject({ status: 'queued', preflight_verdict: 'block' });
    const audit = db.table('preflight_audits')[0];
    expect(audit).toMatchObject({ job_id: job.id, verdict: 'block', overridden_by: 'user-c', override_note: 'Legal sign-off LG-77: copy approved for a clinical audience only' });
    const audited = audit.checks.find((x) => x.id === 'compliance');
    expect(audited.findings[0]).toMatchObject({ id: 'us.fda.disease_claim', matched: 'Cures anxiety', severity: 'BLOCK' });
    expect(audited.findings[0].citation.map((c) => c.cite)).toEqual(['21 CFR 101.93(g)', '21 U.S.C. 343(r)(6)', 'FTC Health Products Compliance Guidance (December 2022); FTC Act sections 5 and 12 (15 U.S.C. 45, 52)']);

    // The brand the ROUTER resolved for THIS workspace is the one linted as.
    const sneaker = await dispatch.enqueue(AUTH, WS, SPEC({ asset_ref: 'mailer-c2' }), { brand: Object.assign({}, NORTHLINE, { id: WS }) });
    expect(sneaker.ok).toBe(true);
    expect(complianceOf(sneaker)).toMatchObject({ status: 'pass', packs: ['generic', 'us.ftc'] });
  });
});

/* ═══ review findings on #138, each failing before its fix ═════════════════ */

test('REVIEW P1: a brand that is not this workspace\'s (resolve()\'s tenant-zero fallback) is never linted as; the workspace\'s own row is read, and with no readable row the send is UNCHECKED and blocked, never passed', async () => {
  await withQueue(async ({ db, dispatch, WS, AUTH, SPEC }) => {
    // brand-runtime.resolve() hands back tenant zero (a record with no id)
    // when it cannot read the workspace. Linted as that, a supplement's
    // disease claim would pass under a sneaker brand's packs.
    const fallback = await dispatch.enqueue(AUTH, WS, SPEC({ asset_ref: 'mailer-f1' }), { brand: TENANT_ZERO });
    expect(fallback).toMatchObject({ ok: false, blocked: true });
    expect(complianceOf(fallback).packs).toContain('us.fda-ftc.health');
    expect(complianceOf(fallback).findings.map((f) => f.id)).toEqual(['us.fda.disease_claim']);
    // Another workspace's brand record is not this workspace's either.
    const foreign = await dispatch.enqueue(AUTH, WS, SPEC({ asset_ref: 'mailer-f2' }), { brand: NORTHLINE });
    expect(complianceOf(foreign).status).toBe('block');
    expect(complianceOf(foreign).selection.brand).toBe('Calmroot');

    // The workspace row cannot be read at all: unchecked, and a block an
    // operator can override with a reason, never a pass as somebody else.
    // (The service read of the row is what fails; the caller's own membership
    // read, which the queue makes first, still answers.)
    const wsScope = require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js'));
    const realRead = wsScope.brandForWorkspace;
    wsScope.brandForWorkspace = async () => null;
    try {
      const down = await dispatch.enqueue(AUTH, WS, SPEC({ asset_ref: 'mailer-f3', payload: Object.assign(SPEC().payload, { subject: 'Your order is on its way' }) }), { brand: TENANT_ZERO });
      expect(down).toMatchObject({ ok: false, blocked: true });
      expect(complianceOf(down)).toMatchObject({ status: 'block' });
      expect(complianceOf(down).detail).toMatch(/could not be read/);
      expect(complianceOf(down).findings).toBeUndefined();
      expect(db.table('dispatch_jobs').filter((j) => j.asset_ref === 'mailer-f3')).toHaveLength(0);
    } finally { wsScope.brandForWorkspace = realRead; }
  });
});

test('REVIEW P1: a backed deadline and stock line pass at dispatch, because the offer is read SERVER-SIDE from the campaign the job names; a body-supplied offer is never read', async () => {
  test.setTimeout(120_000);
  const today = new Date().toISOString().slice(0, 10);
  const offer = { code: 'NL10', pct: 0.1, depth: 'light', why: 'test', ends_at: `${today}T23:59:59Z`, stock: 10 };
  // The builder stamps the offer it built with on the campaign it persists.
  const entry = Object.assign(slot(NORTHLINE, 'US'), { offer });
  const campaign = await sbPlan.buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
  expect(campaign.offer).toMatchObject({ ends_at: offer.ends_at, stock: 10 });

  await withQueue(async ({ db, dispatch, WS, AUTH, SPEC }) => {
    db.insert('smart_generated_campaigns', { id: campaign.campaign_id, workspace_id: WS, payload: campaign, status: 'approved' });
    const urgent = (extra) => SPEC(Object.assign({ payload: Object.assign(SPEC().payload, { subject: 'Today only: only 10 left' }) }, extra));
    const brand = { brand: Object.assign({}, NORTHLINE, { id: WS }) };

    const backed = await dispatch.enqueue(AUTH, WS, urgent({ asset_ref: 'mailer-o1', campaign_id: campaign.campaign_id }), brand);
    expect(complianceOf(backed).findings || []).toEqual([]);
    expect(backed.ok).toBe(true);

    // No campaign named: nothing on record backs the lines.
    const unbacked = await dispatch.enqueue(AUTH, WS, urgent({ asset_ref: 'mailer-o2' }), brand);
    expect(complianceOf(unbacked).findings.map((f) => f.id)).toEqual(['generic.unbacked_urgency', 'generic.unbacked_urgency']);
    // An offer in the request body is the caller's claim, not the record's.
    const bodyOffer = await dispatch.enqueue(AUTH, WS, urgent({ asset_ref: 'mailer-o3', offer }), brand);
    expect(complianceOf(bodyOffer).status).toBe('block');
    // Another workspace's campaign is not read.
    db.insert('smart_generated_campaigns', { id: 'campaign_elsewhere', workspace_id: 'ws-other', payload: campaign, status: 'approved' });
    const elsewhere = await dispatch.enqueue(AUTH, WS, urgent({ asset_ref: 'mailer-o4', campaign_id: 'campaign_elsewhere' }), brand);
    expect(complianceOf(elsewhere).status).toBe('block');
  });
});

/* ═══ 5. the writer is briefed with the rules the gate applies ══════════════ */

test('the copywriter is briefed from the same context: the disclaimer verbatim, the approved claims with their citations, and only the packs that apply', () => {
  const us = sbPlan.__test_copyPrompt(slot(CALMROOT, 'US'));
  expect(us).toContain('COMPLIANCE for Calmroot in US');
  expect(us).toContain(`*${cl.DISCLAIMER_SINGULAR}`);
  expect(us).toContain(`"${SLEEP_CLAIM}" [citation: Calmroot sleep trial report (fixture) ${SLEEP_URL}]`);
  expect(us).toContain('21 CFR 101.93(g)');
  expect(us).not.toContain(MAGNESIUM_CLAIM);          // approved for the UK only

  const uk = sbPlan.__test_copyPrompt(slot(CALMROOT, 'UK'));
  expect(uk).toContain(`"${MAGNESIUM_CLAIM}" [citation: GB NHC Register ${NHC_URL}] [GB NHC Register]`);
  expect(uk).toContain('CAP Code rule 15.6.6');
  expect(uk).not.toContain(SLEEP_CLAIM);
  expect(uk).not.toContain('Food and Drug Administration');

  const sneaker = sbPlan.__test_copyPrompt(slot(NORTHLINE, 'US'));
  expect(sneaker).toContain('COMPLIANCE for Northline in US');
  expect(sneaker).not.toContain('21 CFR');
  expect(sneaker).toContain('"Hand-finished in Leeds"');

  // What the brief calls approved, the gate passes: writer and checker agree.
  for (const [brand, market, text] of [[CALMROOT, 'US', `${SLEEP_CLAIM}. ${cl.DISCLAIMER_SINGULAR}`], [CALMROOT, 'UK', MAGNESIUM_CLAIM], [NORTHLINE, 'US', 'Hand-finished in Leeds']]) {
    expect(lintAs(brand, market, { html: `<p>${text}</p>` }).findings, `${brand.name} ${market}`).toEqual([]);
  }
});

test('the scripted-model path: copy a model wrote is linted in the build, and the prompt it was given carried the compliance brief', async () => {
  test.setTimeout(120_000);
  const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
  const PLAN = require.resolve(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
  const realLlm = require.cache[LLM];
  const realPlan = require.cache[PLAN];
  const real = require(LLM);
  const prompts = [];
  const copy = {
    email: { subject: 'Cures anxiety, naturally', preheader: 'Sleep, sorted', hook: 'h', hero_headline: 'Supports restful sleep', intro_paragraph: 'A calmer evening, every evening.', body_paragraph: 'Clinically proven.', benefits: ['Calm'], rating: null, reviews: [], badges: [], guarantee: '', faq: [], cta: 'Shop now', image_brief: 'a cup on a table' },
    landing: { hero_headline: 'Sleep, sorted', hero_sub: 'Calm, nightly', why_title: 'Why', why_bullets: ['Calm'], proof_quote: '', proof_author: '', faq: [], cta: 'Shop now', image_brief: 'b' },
    ads: {
      meta: { primary_text: 'The #1 sleep blend.', headline: 'Sleep, sorted', image_brief: 'c' },
      google: { headlines: ['Sleep, sorted', 'Calmroot', 'Calm nightly'], descriptions: ['Calm in a cup tonight.', 'Order today.'], image_brief: 'd' },
      tiktok: { script: 'Calm in a cup', caption: 'Calm nightly', image_brief: 'e' },
    },
  };
  const stub = async (opts) => {
    prompts.push(opts);
    const strategy = /strategy/.test(String(opts.stage || ''));
    return { text: JSON.stringify(strategy ? { angle: 'calm', framework: 'PAS', hook_thesis: 'x', target_emotion: 'calm', proof_points: [], differentiator: 'x', dos: [], donts: [] } : copy), provider: 'scripted', model: 'scripted' };
  };
  Object.assign(stub, real);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
  delete require.cache[PLAN];
  try {
    const plan = require(PLAN);
    const c = await plan.buildCampaign(slot(CALMROOT, 'US'), smartConfig({}), { withCreatives: false });
    expect(c.copywriter.provider).toBe('scripted');
    const comp = c.contract_check.compliance;
    expect(comp.verdict).toBe('block');
    const where = (id) => comp.findings.filter((f) => f.id === id).map((f) => `${f.asset}/${f.field}`);
    expect(where('us.fda.disease_claim')).toContain('email/subject');
    expect(where('generic.objective_superlative')).toEqual(expect.arrayContaining([expect.stringMatching(/^ad:meta:/)]));
    expect(comp.findings.some((f) => f.id === 'generic.uncited_clinical_claim')).toBe(true);
    const writer = prompts.find((p) => /smart-brain-copy/.test(String(p.stage || '')));
    expect(writer, 'the copywriter was never called').toBeTruthy();
    expect(writer.userMessage).toContain('COMPLIANCE for Calmroot in US');
    expect(writer.userMessage).toContain(cl.DISCLAIMER_SINGULAR);
  } finally {
    require.cache[LLM] = realLlm;
    if (realPlan) require.cache[PLAN] = realPlan; else delete require.cache[PLAN];
  }
});

/* ═══ 6. the review panel shows it ══════════════════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server; let base;
test.beforeAll(async () => {
  const brand = Object.assign({}, CALMROOT, { tokens: core.tokens({ palette: CALMROOT.palette, typography: CALMROOT.typography }) });
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, brand, workspaces: [] })); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

test('the review panel lists every finding with its rule, the words matched, the fix, the required text and a link to the source', async ({ page }) => {
  const { campaign, entry } = await built(CALMROOT, 'US');
  intoMailer(campaign, '<p>Supports restful sleep.</p>', 'Cures anxiety');
  sbPlan.checkAssetContracts(campaign, entry);
  await page.goto(base + '/smart-brain.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof renderPreview === 'function' && typeof complianceHTML === 'function', null, { timeout: 20000 });
  const out = await page.evaluate(({ campaign, entry }) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderPreview({ campaign, ads: campaign.assets.ads }, entry, 0, { target: host });
    const panel = host.querySelector('.cmp-panel');
    const rows = [...host.querySelectorAll('.cmp-row')].map((r) => ({
      rule: r.dataset.rule, severity: r.dataset.severity, text: r.textContent.replace(/\s+/g, ' ').trim(),
      links: [...r.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    }));
    return { verdict: panel && panel.dataset.verdict, head: panel ? panel.textContent.replace(/\s+/g, ' ') : '', rows };
  }, { campaign, entry });
  expect(out.verdict).toBe('block');
  expect(out.head).toMatch(/Blocked: 3 compliance finding\(s\) must be fixed before this campaign can be published/);
  expect(out.head).toMatch(/US FDA and FTC rules for foods, dietary supplements and health products/);
  const disease = out.rows.find((r) => r.rule === 'us.fda.disease_claim');
  expect(disease.severity).toBe('BLOCK');
  expect(disease.text).toContain('“Cures anxiety”');
  expect(disease.links).toContain('https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-F/section-101.93');
  const sf = out.rows.find((r) => r.rule === 'us.fda.sf_disclaimer_missing');
  expect(sf.text).toContain(`Required text: ${cl.DISCLAIMER_SINGULAR}`);

  // A clean campaign says so in one line, with no rows.
  const clean = await built(CALMROOT, 'US');
  const cleanOut = await page.evaluate(({ campaign, entry }) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    renderPreview({ campaign, ads: campaign.assets.ads }, entry, 0, { target: host });
    return { verdict: host.querySelector('.cmp-panel').dataset.verdict, rows: host.querySelectorAll('.cmp-row').length, text: host.querySelector('.cmp-panel').textContent.replace(/\s+/g, ' ') };
  }, clean);
  expect(cleanOut).toMatchObject({ verdict: 'pass', rows: 0 });
  expect(cleanOut.text).toMatch(/No compliance findings across \d+ asset\(s\)/);
});
