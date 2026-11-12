/**
 * Every build writes down the decision behind each asset.
 * ---------------------------------------------------------------------------
 * EXECUTED: the shipped builder (template path, network blocked) for a store, a
 * publisher and a bare name, then api/_shared/asset-decisions.js over the result.
 *   - one item per asset of the send, each with a stable id
 *     <slot>:<type>:<placement>:<variant> used once, and a revision that is the
 *     hash of what a person receives;
 *   - building the same slot twice gives the same ids and the same digest;
 *     changing one asset changes that asset's revision and the digest only;
 *   - with no measured result of the brand's own the record is PROVISIONAL and
 *     says which data is missing; one own campaign with figures makes it
 *     evidenced, and that item is labelled measured;
 *   - what was seen of others is labelled observed, never measured;
 *   - a fact the build did not have is a gap in words, never a value.
 *
 * Run: npx playwright test tests/asset-decisions.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AD = require(path.join(ROOT, 'api', '_shared', 'asset-decisions.js'));
const preset = (slug) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', slug + '.json'), 'utf8'));
const HERO = { title: 'Kay Beauty Hydrating Foundation', handle: 'p1', price: 1399, compare_at: 1599, currency: 'INR', product_url: 'https://www.nykaa.com/products/p1', image_url: 'https://www.nykaa.com/img/1.jpg', description: 'Enriched with hyaluronic acid to keep skin hydrated for up to 12 hours.' };

async function build(brand, extra) {
  const realFetch = global.fetch; const saved = {};
  for (const k of Object.keys(process.env)) if (/_API_KEY|^AWS_|^ANTHROPIC_|^OLLAMA|^SUPABASE/.test(k)) { saved[k] = process.env[k]; delete process.env[k]; }
  global.fetch = async (u) => { throw new Error('network blocked: ' + u); };
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const entry = Object.assign({ id: 'dec-' + (brand.slug || 'x'), date: '2026-11-14', market: 'IN', objective: 'reactivation', brand: JSON.parse(JSON.stringify(brand)), cohort: { name: 'At Risk', size: 1500, rules: ['no order in 90 days'] }, channels: ['email', 'meta', 'google', 'landing_page'], supportingProducts: [] }, extra || {});
    const campaign = await require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js')).buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
    return { campaign, entry };
  } finally { global.fetch = realFetch; for (const [k, v] of Object.entries(saved)) process.env[k] = v; }
}

test('a store\'s send records one decision per asset, each with a stable id, a revision and what it is judged by', async () => {
  const { campaign: c } = await build(preset('nykaa'), { heroProduct: HERO });
  const d = c.decisions;
  expect(d.version).toBe('asset-decision.v1');
  const A = c.assets;
  const expected = A.email.variants.length + A.landing_pages.length + A.ads.length + A.social_posts.length + Object.keys(A.onsite).length + A.display_banners.length + (A.google_display ? 1 : 0) + (A.music ? 1 : 0) + (A.messages || []).length;
  expect(d.count).toBe(expected);
  expect(d.items.length).toBe(expected);
  const ids = d.items.map((x) => x.asset_id);
  expect(new Set(ids).size, 'an asset id is used twice').toBe(ids.length);
  for (const x of d.items) {
    expect(x.asset_id).toMatch(/^dec-nykaa:[a-z]+:[a-z0-9.-]+:[a-z0-9-]+$/);
    expect(x.revision).toMatch(/^[0-9a-f]{16}$/);
    expect(['passed', 'failed', 'not checked']).toContain(x.check);
  }
  // shared facts are the send's own
  expect(d.shared.audience).toMatchObject({ cohort: 'At Risk', size: 1500 });
  expect(d.shared.product).toBe('Kay Beauty Hydrating Foundation');
  expect(d.shared.purpose).toBe('reactivation');
  expect(d.shared.offer).toBeNull();
  expect(d.shared.offer_note).toBe('no offer on this send');
  // no baseline was measured: the gap is said, no number stands in
  expect(d.shared.baseline).toBeNull();
  expect(d.shared.baseline_gap).toMatch(/DATA REQUIRED/);
  // each mail variant names the look it was given and what else was considered
  const mail = d.items.filter((x) => x.type === 'email');
  expect(mail.length).toBe(4);
  for (const m of mail) { expect(m.format.theme).toBeTruthy(); expect(m.contract).toBe('email.mailer'); expect(m.kpi).toMatch(/click/); expect(m.hypothesis).toMatch(/differ by/); }
  expect(mail.some((m) => m.rejected.length > 0)).toBe(true);
  // the music is a brief, and is called one
  expect(d.items.find((x) => x.type === 'music').expected_artifact).toMatch(/brief/);
  // the revision is the hash of the asset itself
  const first = A.email.variants[0];
  // the subject and preheader are delivered beside the HTML, so they are hashed with it
  const lead = [first.subject || A.email.subject || '', first.preheader || first.preview_text || A.email.preheader || A.email.preview_text || ''];
  expect(d.items[0].revision).toBe(require('crypto').createHash('sha256').update((lead.some(Boolean) ? lead.join('\n') + '\n' : '') + first.html).digest('hex').slice(0, 16));
});

test('with no result of the brand\'s own the record is provisional and says so; observed evidence is never called measured; one own campaign with figures makes it evidenced', async () => {
  const { campaign: c, entry } = await build(preset('nykaa'), { heroProduct: HERO });
  const d = c.decisions;
  expect(d.state).toBe('provisional');
  expect(d.state_note).toMatch(/No measured result of this brand's own/);
  expect(d.evidence.filter((e) => e.basis === 'measured')).toEqual([]);
  expect(d.gaps.join(' ')).toMatch(/own campaign performance/);
  const seen = d.evidence.find((e) => e.kind === 'reference_mail');
  expect(seen.basis).toBe('observed');
  expect(seen.sample).toBe(c.mail_study.emails);
  expect(seen.note).toMatch(/not this brand's named competitors/);
  expect(d.items.every((x) => /provisional draft|contract not met/.test(x.status))).toBe(true);

  const withWin = Object.assign({}, entry, { ownDataReference: { name: 'Winback August', hooks: ['Back in stock'], performance: { clickRate: 0.041, openRate: 0.38, recipients: 12000 } } });
  const d2 = AD.build(c, withWin);
  expect(d2.state).toBe('evidenced');
  const own = d2.evidence.find((e) => e.basis === 'measured');
  expect(own).toMatchObject({ kind: 'own_campaign', label: 'Winback August' });
  expect(own.figures).toBeTruthy();
  // the assets did not change, so neither did their ids, revisions or the digest
  expect(d2.manifest_digest).toBe(d.manifest_digest);
});

test('the same slot built twice has the same ids and digest; changing one asset changes that revision and the digest, and nothing else', async () => {
  const a = await build(preset('nykaa'), { heroProduct: HERO });
  const b = await build(preset('nykaa'), { heroProduct: HERO });
  expect(b.campaign.decisions.items.map((x) => x.asset_id)).toEqual(a.campaign.decisions.items.map((x) => x.asset_id));
  expect(b.campaign.decisions.manifest_digest).toBe(a.campaign.decisions.manifest_digest);
  const changed = JSON.parse(JSON.stringify(a.campaign));
  changed.assets.social_posts[0].caption += ' Edited.';
  const d3 = AD.build(changed, a.entry);
  const was = a.campaign.decisions.items; const now = d3.items;
  const moved = now.filter((x, i) => x.revision !== was[i].revision).map((x) => x.asset_id);
  expect(moved).toEqual([was.find((x) => x.type === 'social').asset_id]);
  expect(d3.manifest_digest).not.toBe(a.campaign.decisions.manifest_digest);
});

test('a publisher and a bare name get a record too, and a missing product is a gap in words', async () => {
  for (const brand of [preset('times-of-india'), { slug: 'bare', name: 'Bare Fixture Co', palette: { primary: '#1F6F5C', accent: '#1F6F5C', ink: '#1A1A1A', surface: '#FFFFFF' }, typography: {}, voice: {}, regions: [] }]) {
    const { campaign: c } = await build(brand);
    const d = c.decisions;
    expect(d.count, brand.name).toBeGreaterThan(5);
    expect(new Set(d.items.map((x) => x.asset_id)).size).toBe(d.count);
    if (!d.shared.product) expect(d.shared.product_gap, brand.name).toMatch(/DATA REQUIRED/);
    expect(JSON.stringify(d.shared), brand.name).not.toMatch(/undefined|\[object Object\]/);
    expect(d.state).toBe('provisional');
  }
});
