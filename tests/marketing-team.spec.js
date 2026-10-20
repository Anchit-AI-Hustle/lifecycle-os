// The marketing team (2026-10-20): ten departments, every step tied to the feature that does it,
// and the work Smart Brain now does for every send. Executed: the registry against the routes the
// deployment serves, the UTM / A/B maths against known values, a real campaign built through the
// shipped smart-brain-plan (template path, no model), the site audit over a fixture site through the
// shipped crawler, and /marketing-team in Chromium at 1280 and 390.
//
// Run: npx playwright test tests/marketing-team.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const H = require('./lib/brand-theme-harness.js');

const ROOT = path.resolve(__dirname, '..');
const MT = require(path.join(ROOT, 'api', '_shared', 'marketing-team.js'));
const MTS = require(path.join(ROOT, 'api', '_shared', 'marketing-team-server.js'));
const PLAN = path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js');

// The 40 steps of the screenshot the operator sent, by department, verbatim.
const SCREENSHOT = {
  strategy: ['Marketing strategy', 'Goal setting', 'Channel planning', 'Growth roadmap'],
  intel: ['Market research', 'ICP development', 'Competitor analysis', 'Customer insights'],
  brand: ['Brand strategy', 'Positioning', 'Messaging', 'Offer development'],
  content: ['Content strategy', 'Content creation', 'Content distribution', 'Thought leadership'],
  seo: ['SEO & AEO', 'Keyword research', 'Content optimisation', 'Technical SEO'],
  social: ['Social media strategy', 'LinkedIn growth', 'Community building', 'Influencer & PR'],
  paid: ['Paid ads strategy', 'Campaign creation', 'Audience targeting', 'Optimisation'],
  email: ['Email strategy', 'Email creation', 'Automation', 'Retention & expansion'],
  conversion: ['Lead generation', 'Funnel design', 'Landing pages', 'Conversion optimisation'],
  analytics: ['Analytics & reporting', 'Performance analysis', 'A/B testing', 'Forecasting'],
};

test('every step of the screenshot is in the registry, in its department, and more steps beside them', () => {
  expect(MT.DEPARTMENTS.map((d) => d.id)).toEqual(Object.keys(SCREENSHOT));
  const ids = new Set();
  for (const d of MT.DEPARTMENTS) {
    const names = d.steps.map((s) => s.name);
    for (const want of SCREENSHOT[d.id]) expect(names, `${d.name} is missing "${want}"`).toContain(want);
    for (const s of d.steps) {
      expect(ids.has(s.id), `step id ${s.id} twice`).toBe(false); ids.add(s.id);
      expect(['built', 'partial', 'not_built']).toContain(s.status);
      if (s.status !== 'built') expect(String(s.gap || '').length, `${s.name} is ${s.status} and does not say what is missing`).toBeGreaterThan(30);
      expect(String(s.does).length).toBeGreaterThan(30);
      expect(s.where.length).toBeGreaterThan(0);
    }
  }
  const all = MT.DEPARTMENTS.flatMap((d) => d.steps);
  expect(all.length, 'not limited to the 40').toBeGreaterThan(40);
  // A link to a page is distinct within a step.
  for (const s of all) expect(new Set(s.where).size, s.id).toBe(s.where.length);
});

test('every page a step names is one the deployment serves', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const routed = new Set([...(v.rewrites || []), ...(v.redirects || [])].map((r) => r.source));
  for (const w of MT.paths()) {
    const p = w.replace(/[?#].*$/, '');
    // cleanUrls is off: a path is served only by a rewrite, a redirect or a file at that exact path.
    const ok = routed.has(p) || fs.existsSync(path.join(ROOT, p.replace(/^\//, '')));
    expect(ok, `${w} does not resolve`).toBe(true);
  }
});

test('the browser loads the same module the server runs', () => {
  expect(fs.readFileSync(path.join(ROOT, 'marketing-team.js'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'api', '_shared', 'marketing-team.js'), 'utf8'));
});

test('UTM tags go only on the brand\'s own links, never on a marker, placeholder, unsubscribe or a link already tagged', () => {
  const p = MT.utmFor('email', '2026-10-20 IN reactivation', 'email a');
  expect(p).toEqual({ utm_source: 'email', utm_medium: 'email', utm_campaign: '2026-10-20-in-reactivation', utm_content: 'email-a' });
  expect(MT.utmUrl('https://shop.example/p?x=1#top', p)).toBe('https://shop.example/p?x=1&utm_source=email&utm_medium=email&utm_campaign=2026-10-20-in-reactivation&utm_content=email-a#top');
  const html = [
    '<a href="https://shop.example/a">a</a>', '<a href="https://other.example/b">b</a>', '<a href="{{landing_page_url}}">c</a>',
    '<a href="https://shop.example/unsubscribe">u</a>', '<a href="mailto:x@shop.example">m</a>', '<a href="https://shop.example/c?utm_source=x">t</a>',
    '<a href="[DATA REQUIRED BEFORE LAUNCH: region store URL, X, IN]">d</a>', '<a href="https://shop.example/q?a=1&amp;b=2">q</a>',
  ].join('');
  const r = MT.tagLinks(html, p, (h) => h === 'shop.example');
  expect(r.tagged).toBe(2);
  expect(r.html).toContain('href="https://shop.example/a?utm_source=email&amp;utm_medium=email');
  expect(r.html).toContain('href="https://shop.example/q?a=1&amp;b=2&amp;utm_source=email');
  for (const kept of ['https://other.example/b"', '{{landing_page_url}}"', 'https://shop.example/unsubscribe"', 'mailto:x@shop.example"', 'utm_source=x"', 'region store URL, X, IN]"']) expect(r.html).toContain(kept);
});

test('the A/B maths agrees with the textbook values', () => {
  const r = MT.abTest({ visitors: 1000, conversions: 100 }, { visitors: 1000, conversions: 130 });
  expect(r.ok).toBe(true);
  expect(r.z).toBeCloseTo(2.1027, 3);           // pooled: 0.03 / sqrt(0.115 * 0.885 * 2/1000)
  expect(r.p_value).toBeCloseTo(0.0355, 3);
  expect(r.significant).toBe(true); expect(r.winner).toBe('B');
  const tie = MT.abTest({ visitors: 500, conversions: 50 }, { visitors: 500, conversions: 55 });
  expect(tie.significant).toBe(false); expect(tie.winner).toBe(null);
  expect(MT.abTest({ visitors: 10, conversions: 11 }, { visitors: 10, conversions: 1 }).ok).toBe(false);
  // 4% baseline, 20% relative lift, 95% / 80%: the standard formula gives 10,314 per arm.
  expect(MT.sampleSize(0.04, 0.2)).toBe(10314);
  expect(MT.sampleSize(0, 0.2)).toBe(null);
});

/* ── a real build ──────────────────────────────────────────────────── */
const NEWS = {
  id: 'device:gazette', slug: 'gazette', name: 'Ledgerline Gazette', website: 'https://ledgerline.example', industry: 'news publishing',
  tagline: 'Pune news, checked twice by the desk', palette: { primary: '#7B2D5E', accent: '#C8A13B', ink: '#2A1F33', surface: '#FBF7EF' },
  regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Reporters in all 14 Pune wards'],
  offerings: [{ kind: 'subscription', name: 'Morning Ledger', url: 'https://ledgerline.example/ledger' }],
  legal_entity: 'Ledgerline Media LLP, Pune, India',
};
const BARE = { id: 'device:bare', slug: 'bareco', name: 'Bareco', regions: [{ code: 'IN', home: true }] };
const slot = (brand, extra) => Object.assign({
  id: 'mt-' + brand.slug, date: '2026-10-20', market: 'IN', objective: 'reactivation', brand,
  cohort: { name: 'At Risk', size: 1200, rules: ['no order in 90 days'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'],
  confidence: 0.6, offer: { depth: 'none', pct: 0 },
}, extra || {});
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
async function build(entry) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    return await require(PLAN).buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
  } finally { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const hrefs = (html) => [...String(html || '').matchAll(/\shref="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

test('every send: brand links tagged, ads with a tracked destination, a KPI on the brand\'s own baseline, a sized test, SEO-ready pages, and a record per department', async () => {
  const c = await build(slot(NEWS, { ownEvidence: { campaigns: [0.03, 0.05, 0.04].map((r, i) => ({ name: 'own ' + i, performance: { clickRate: r } })) } }));
  const own = (u) => /^https?:\/\/(www\.)?ledgerline\.example\//i.test(u + '/');
  const all = [c.assets.email.html, ...c.assets.email.variants.map((v) => v.html), ...c.assets.landing_pages.map((l) => l.html)].flatMap(hrefs).filter(own);
  expect(all.length).toBeGreaterThan(5);
  for (const u of all) expect(u, 'an untagged link to the brand\'s own site').toMatch(/[?&]utm_source=(email|landing_page)&utm_medium=(email|referral)&utm_campaign=2026-10-20-in-reactivation/);
  expect(c.tracking.utm_campaign).toBe('2026-10-20-in-reactivation');
  for (const ad of c.assets.ads) {
    expect(ad.destination_url, `${ad.platform} ${ad.creative_type}`).toMatch(new RegExp(`^https://ledgerline\\.example/ledger\\?utm_source=${ad.platform === 'google' ? 'google&utm_medium=cpc' : ad.platform === 'youtube' ? 'youtube&utm_medium=paid_video' : ad.platform + '&utm_medium=paid_social'}`));
    if (ad.platform === 'google') expect(ad.final_url).toBe(ad.destination_url);
  }
  // The landing page forwards the visitor's own UTMs to its links.
  for (const lp of c.assets.landing_pages) expect(lp.html).toContain('data-utm-forward');
  // KPI: the median of the brand's own campaigns, a target labelled as one.
  expect(c.measurement.baseline.value).toBe(0.04);
  expect(c.measurement.target.value).toBe(0.044);
  expect(c.measurement.target.basis).toMatch(/planning target, not a prediction/);
  expect(c.measurement.read_on).toBe('2026-10-27');
  // Test plan: sized from that baseline; the cohort is too small, and it says so.
  expect(c.test_plan.per_variant).toBe(10314);
  expect(c.test_plan.readable).toBe(false);
  expect(c.test_plan.note).toMatch(/directional/);
  expect(c.test_plan.tests.map((t) => t.asset)).toEqual(['email', 'landing_page']);
  // SEO: the pages carry a description, Open Graph and Organization data from the brand's own lines.
  for (const lp of c.assets.landing_pages) {
    expect(lp.seo_check.fixes, JSON.stringify(lp.seo_check.findings)).toBe(0);
    expect(lp.html).toMatch(/<meta name="description" content="[^"]{50,160}">/);
    expect(lp.html).toContain('"@type":"Organization","name":"Ledgerline Gazette","url":"https://ledgerline.example"');
  }
  // One record per per-slot step, in the registry's departments.
  const perSlot = MT.DEPARTMENTS.flatMap((d) => d.steps.filter((s) => s.per_slot).map((s) => s.id));
  const recorded = c.departments.departments.flatMap((d) => d.steps.map((s) => s.id));
  expect(recorded).toEqual(perSlot);
  const st = Object.fromEntries(c.departments.departments.flatMap((d) => d.steps.map((s) => [s.id, s])));
  for (const id of ['goal-setting', 'tracking', 'campaign-creation', 'ab-testing', 'seo-aeo', 'icp', 'audience-targeting', 'landing-pages'])
    expect(st[id].state, `${id}: ${st[id].says}`).toBe('done');
  expect(st.icp.says).toContain('At Risk (1,200 people)');
  // The asset contracts still hold on the finished assets.
  expect(c.contract_check && c.contract_check.blocking).toBe(0);
});

test('with no own history and no store, a send says what is missing instead of inventing a baseline or a link', async () => {
  const c = await build(slot(BARE));
  expect(c.measurement.baseline).toBe(null);
  expect(c.measurement.target).toBe(null);
  expect(c.measurement.data_gap).toMatch(/^\[DATA REQUIRED BEFORE LAUNCH: baseline click rate/);
  expect(c.test_plan.per_variant).toBe(null);
  for (const ad of c.assets.ads) expect(ad.destination_url).toMatch(/^\[DATA REQUIRED BEFORE LAUNCH:/);
  const st = Object.fromEntries(c.departments.departments.flatMap((d) => d.steps.map((s) => [s.id, s])));
  expect(st['campaign-creation'].state).toBe('gap');
  expect(st.positioning.state).toBe('gap');
  expect(st.tracking.state).toBe('gap');
});

/* ── the site audit, through the shipped crawler ───────────────────── */
function fixtureSite() {
  const page = (title, desc, body, extra) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>${desc ? `<meta name="description" content="${desc}">` : ''}${extra || ''}</head><body>${body}</body></html>`;
  const site = {
    'https://shop.example/robots.txt': { ct: 'text/plain', body: 'User-agent: *\nDisallow: /private\nSitemap: https://shop.example/sitemap.xml\n' },
    'https://shop.example/sitemap.xml': { ct: 'application/xml', body: '<?xml version="1.0"?><urlset><url><loc>https://shop.example/</loc></url><url><loc>https://shop.example/teas</loc></url><url><loc>https://shop.example/about</loc></url></urlset>' },
    'https://shop.example/': { ct: 'text/html', body: page('Smoked tea from Glenmarrow | Shop', 'Smoked and black teas from one Glenmarrow garden, packed the week they are picked.', '<h1>Smoked tea</h1><img src="/a.jpg" alt="Tea"><a href="/teas">Teas</a><a href="/about">About</a>', '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Shop"}</script>') },
    'https://shop.example/teas': { ct: 'text/html', body: page('Smoked tea from Glenmarrow | Shop', '', '<h1>Teas</h1><h1>More teas</h1><img src="/b.jpg">') },
    'https://shop.example/about': { ct: 'text/html', body: page('About', 'Short.', '<p>No heading here.</p>') },
  };
  return async (u) => {
    const r = site[String(u).replace(/#.*$/, '')];
    if (!r) return { ok: false, status: 404, body: '' };
    return { ok: true, status: 200, body: r.body, url: u, contentType: r.ct };
  };
}

test('the site audit reads the brand\'s own site and reports each issue with how many pages have it', async () => {
  const out = await MTS.siteAudit({ name: 'Shop', website: 'https://shop.example/' }, { fetchImpl: fixtureSite() });
  expect(out.ok, JSON.stringify(out)).toBe(true);
  expect(out.pages_read).toBe(3);
  const iss = Object.fromEntries(out.issues.map((i) => [`${i.id}:${i.level}`, i.pages]));
  expect(iss['description:fix']).toBe(1);          // /teas
  expect(iss['description:improve']).toBe(1);      // /about ("Short.")
  expect(iss['h1:fix']).toBe(1);                   // /about
  expect(iss['h1:improve']).toBe(1);               // /teas (two)
  expect(iss['alt:fix']).toBe(1);                  // /teas image
  expect(iss['canonical:improve']).toBe(3);
  expect(out.duplicate_titles).toEqual([{ title: 'Smoked tea from Glenmarrow | Shop', pages: 2 }]);
  expect(out.schema_types).toEqual(['Organization']);
  expect(out.answer_engines).toEqual({ organization: true, faq: false, product: false, article: false });
  expect(out.top_terms[0]).toEqual({ term: 'smoked', pages: 3 });
  expect(out.terms_note).toMatch(/No search volume/);
  // No website on the record: nothing is read.
  let called = 0;
  const none = await MTS.siteAudit({ name: 'Bare' }, { fetchImpl: async () => { called += 1; return { ok: false, status: 404, body: '' }; } });
  expect(none.error).toBe('website_required'); expect(called).toBe(0);
});

/* ── the page ──────────────────────────────────────────────────────── */
const NAME = H.define('marketing-team-page', {
  name: 'Brambleweld Larder', slug: 'brambleweld-larder', website: 'https://brambleweld.example',
  palette: { primary: '#2f5d50', accent: '#c9822b', ink: '#1d1d1b', surface: '#ffffff' },
  regions: [{ code: 'UK', currency: 'GBP', home: true }],
});

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`/marketing-team at ${vp.width}: ten departments, every step, the A/B and UTM tools work, nothing wider than the screen`, async ({ page }) => {
    await page.setViewportSize(vp);
    const errors = []; page.on('pageerror', (e) => errors.push(String(e.message)));
    page.on('dialog', (d) => { errors.push('dialog ' + d.message()); d.dismiss(); });
    await H.install(page, NAME);
    await H.open(page, 'marketing-team.html', NAME);
    await page.waitForFunction(() => document.querySelectorAll('[data-dept]').length === 10);
    const steps = await page.locator('[data-step]').count();
    expect(steps).toBe(MT.DEPARTMENTS.flatMap((d) => d.steps).length);
    await expect(page.locator('[data-step="keyword-research"] .gap')).toContainText('not connected');
    await page.getByRole('tab', { name: 'A/B test' }).click();
    for (const [id, v] of [['abNa', '1000'], ['abXa', '100'], ['abNb', '1000'], ['abXb', '130']]) await page.fill('#' + id, v);
    await page.click('#abRun');
    await expect(page.locator('#abOut')).toContainText('B converts better (p = 0.0355');
    await page.fill('#ssP', '4'); await page.click('#ssRun');
    await expect(page.locator('#ssOut')).toContainText('10,314 per variant');
    await page.getByRole('tab', { name: 'UTM builder' }).click();
    await page.fill('#utmUrl', 'https://brambleweld.example/jam');
    await page.selectOption('#utmCh', 'meta');
    await page.fill('#utmCamp', 'Autumn jam');
    await page.click('#utmRun');
    await expect(page.locator('[data-utm-result]')).toHaveText('https://brambleweld.example/jam?utm_source=meta&utm_medium=paid_social&utm_campaign=autumn-jam');
    expect(page.url()).toContain('tool=utm');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
