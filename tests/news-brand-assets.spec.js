// @ts-check
/**
 * A news brand's assets are a news brand's (2026-11-03). Production /brain for
 * The Times of India: every ad's button read "Order again" and every ad and
 * the Story video wore article photos of real people lifted from its home
 * page. Executed through the shipped buildCampaign (template path).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function toi() {
  const b = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'data/brands/presets/times-of-india.json'), 'utf8'));
  b.id = 'ws-toi';
  b.imagery = (b.brand_assets || []).map((a) => ({ url: a.url, page: a.found_on || b.website, role: a.role }));
  return b;
}

test('a news brand never gets "Order again", and no ad wears its article photos', async () => {
  const plan = require(path.join(ROOT, 'api/_shared/smart-brain-plan.js'));
  const { smartConfig } = require(path.join(ROOT, 'lib/smart-brain/services.js'));
  const brand = toi();
  expect(brand.imagery.some((r) => /toiimg\.com\/thumb/.test(r.url))).toBe(true);   // the site read DID record article photos
  for (const objective of ['Second-order activation', 'Education', 'Reactivation', 'Pre-lapse retention', 'Premium bundle expansion']) {
    const entry = { id: 's-' + objective, date: '2026-11-05', market: 'IN', objective, cohort: { name: 'New Customers' }, channels: ['email', 'landing_page', 'meta', 'google', 'tiktok'], brand, strategy_only: true,
      heroProduct: { title: '[DATA REQUIRED BEFORE LAUNCH: product catalogue, The Times of India, IN]', placeholder: true } };
    entry.cta = plan.__test_strategyCta ? plan.__test_strategyCta(objective, brand) : undefined;
    expect(entry.cta).not.toMatch(/order|shop|buy/i);
    const c = await plan.buildCampaign(entry, smartConfig({}), { noLLM: true });
    const s = JSON.stringify(c);
    expect(s, objective).not.toMatch(/Order again/);
    expect(s, objective).not.toMatch(/toiimg\.com\/thumb/);
  }
});

test('a commerce brand keeps its own site photographs and "Order again"', () => {
  const plan = require(path.join(ROOT, 'api/_shared/smart-brain-plan.js'));
  const I = require(path.join(ROOT, 'api/_shared/brand-imagery.js'));
  const shop = { name: 'Brewfold', industry: 'coffee roaster', website: 'https://brewfold.example', imagery: [{ url: 'https://brewfold.example/a.jpg', page: 'https://brewfold.example/', role: 'hero' }] };
  expect(I.ownImageUrls(shop)).toEqual(['https://brewfold.example/a.jpg']);
  expect(plan.__test_strategyCta('Second-order activation', shop)).toBe('Order again');
  // A news brand's own UPLOAD is still used.
  const up = Object.assign(toi(), { imagery: [{ url: 'https://cdn.example/brand.jpg', page: 'x', source: 'upload' }] });
  expect(I.ownImageUrls(up)).toEqual(['https://cdn.example/brand.jpg']);
});
