// @ts-check
/**
 * Regenerate is a new generation, for the mail and the landing page too
 * (2026-10-26, Codex on #369): "Regenerate mailer" wrote new words in the
 * same theme and template, because the mailer and landing branches of
 * generateSingleAsset hashed the same slot inputs. They now carry a take, as
 * the ads branch already did; an ordinary rebuild stays the same design.
 * Executed: the shipped previewEntry and generateSingleAsset over an inline
 * slot, the model refused (template copy), no network.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM_PATH = path.join(ROOT, 'api', '_shared', 'llm.js');
require(LLM_PATH);
const realLlm = require.cache[LLM_PATH].exports;
require.cache[LLM_PATH].exports = Object.assign(async () => { throw new Error('no model in this test'); }, realLlm);
test.afterAll(() => { require.cache[LLM_PATH].exports = realLlm; });
const P = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

const brand = { id: 'w-oak-regen', name: 'Oak Bakers', industry: 'bakery', website: 'https://oak.example', palette: { primary: '#C2410C', accent: '#1F5C99', surface: '#FFFFFF', ink: '#222222' }, regions: [{ code: 'IN', currency: 'INR', home: true }] };
const entry = () => ({ id: 'oak-regen-1', date: '2026-11-05', market: 'IN', brand, channels: ['email', 'landing_page'], cohort: { name: 'Champions' }, objective: 'premium bundle expansion', heroProduct: { title: 'Seeded Rye Loaf' } });
const looks = (htmls) => htmls.map((h) => `${(String(h).match(/data-theme="([a-z]+)"/) || [])[1]}/${(String(h).match(/data-template="([a-z]+)"/) || [])[1]}`).join(' ');
const mails = (r) => (((r.campaign || {}).assets || {}).email || {}).variants || r.email_variants || [];
const pages = (r) => (((r.campaign || {}).assets || {}).landing_pages || []).map((l) => l.html);

test('regenerating the mail or the landing page draws a new design; a rebuild draws the same one', async () => {
  test.setTimeout(240000);
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error('offline in this test: ' + u); };
  try {
    const a = await P.previewEntry({ entry: entry() });
    const again = await P.previewEntry({ entry: entry() });
    const base = looks(mails(a).map((v) => v.html));
    expect(base.split(' ').length, 'four mails drawn').toBe(4);
    expect(base).not.toMatch(/undefined/);
    expect(looks(mails(again).map((v) => v.html)), 'a rebuild is the same design').toBe(base);
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      const r = await P.generateSingleAsset({ entry: entry(), assetType: 'mailer' });
      seen.add(looks(mails(r).map((v) => v.html)));
      await new Promise((ok) => setTimeout(ok, 5));
    }
    expect([...seen].some((x) => x !== base), `regenerate kept ${base}`).toBe(true);
    const lpBase = looks(pages(a));
    const lpSeen = new Set();
    for (let i = 0; i < 3; i++) {
      const r = await P.generateSingleAsset({ entry: entry(), assetType: 'landing' });
      lpSeen.add(looks(pages(r)));
      await new Promise((ok) => setTimeout(ok, 5));
    }
    expect([...lpSeen].some((x) => x !== lpBase), `landing regenerate kept ${lpBase}`).toBe(true);
  } finally { global.fetch = realFetch; }
});
