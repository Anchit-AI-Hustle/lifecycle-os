// Mailers and landing pages on phones and tablets, Safari included (2026-10-17).
//
// The operator: "Devices: phones, tablets and Safari have not been tested yet -
// test and fix any issues if there are". Measured first: the four mailer
// variants (Text and Text + Visual, product-led and brand-led) had no viewport
// meta, so a phone laid them out 980px wide and shrank the copy to about 40%;
// the card's own style attribute was the second on its tag and was dropped; a
// square hero photo pushed the button below the first screen on every phone
// and tablet; and the text mailer printed its button twice in a row.
//
// Executed: Smart Brain's shipped buildCampaign (template path), every mailer
// it makes and its landing pages opened in the browser at each device size. In
// CI the iphone-se, iphone-12 and ipad projects run this on WebKit (Safari's
// engine) and pixel-5 on Chromium; the desktop-1280 project runs it on Chromium
// at the same sizes.
//
// Run: npx playwright test tests/asset-devices.spec.js --project=desktop-1280
const { test, expect, devices } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLAN = path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js');
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION'];
const IMG = (n) => `https://palmgrove.example/cdn/${n}.jpg`;
const BRAND = {
  id: 'device:palmgrove', slug: 'palmgrove-coffee', name: 'Palmgrove Coffee', website: 'https://palmgrove.example', industry: 'Single-origin coffee roaster and store',
  tagline: 'Roasted on Tuesdays, at your door by Friday',
  palette: { primary: '#5A2E1B', accent: '#E0A43B', ink: '#2A1D16', surface: '#FFF9F1' },
  regions: [{ code: 'IN', currency: 'INR', store_url: 'https://palmgrove.example', home: true }],
  claims: ['Roasted in small batches every Tuesday', 'Shipped within three days of roasting'],
  logo_url: IMG('logo'),
  legal_entity: 'Palmgrove Coffee Pvt Ltd, Coorg 571201, India',
};
const TODAY = new Date().toISOString().slice(0, 10);
const SLOT = {
  id: 'devices-1', date: TODAY, market: 'IN', objective: 'reactivation', brand: BRAND,
  cohort: { name: 'At Risk', size: 900, rules: ['r'] }, channels: ['email', 'meta', 'landing_page'],
  confidence: 0.6, offer: { depth: 'none', pct: 0 },
  heroProduct: { sku: 'P1', title: 'Palmgrove Estate Medium Roast', handle: 'estate-medium', category: 'Coffee', image: IMG('estate'), price: 650 },
  supportingProducts: [{ sku: 'P2', title: 'Palmgrove Dark Roast', handle: 'dark', category: 'Coffee', image: IMG('dark'), price: 700 }],
};

let ASSETS = null;
test.beforeAll(async () => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const c = await require(PLAN).buildCampaign(SLOT, smartConfig({}), { noLLM: true, withCreatives: false });
    const email = c.assets.email || {};
    ASSETS = (email.variants || []).map((v) => ({ name: 'mailer ' + (v.name || v.label), html: v.html, mail: true, text: /^Text ·/.test(v.name || '') }))
      .concat(email.html ? [{ name: 'mailer (main)', html: email.html, mail: true }] : [])
      .concat((c.assets.landing_pages || []).filter((l) => l && l.html).map((l, i) => ({ name: 'landing page ' + (i + 1), html: l.html })));
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#b9a99a"/></svg>';
const SIZES = [
  ['iPhone SE', devices['iPhone SE']], ['iPhone 12', devices['iPhone 12']], ['Pixel 5', devices['Pixel 5']],
  ['iPad', devices['iPad (gen 7)']], ['iPad landscape', devices['iPad (gen 7) landscape']],
];

async function measure(page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const over = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1) over.push(el.tagName + ' ' + Math.round(r.right));
    }
    const runs = [...document.querySelectorAll('p, li, td, h1, h2, h3, a, span, div')]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 12) && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none' && !el.closest('[style*="display:none"]'))
      .map((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), text: el.textContent.trim().slice(0, 40) }));
    const ctas = [...document.querySelectorAll('a')].filter((a) => /shop now|start|buy|explore|discover|order/i.test(a.textContent) && a.getBoundingClientRect().height > 0);
    const hero = document.querySelector('img[data-mail-hero]');
    return {
      vw, vh, scrollW: document.documentElement.scrollWidth, over: over.slice(0, 5),
      body: runs.filter((r) => r.size < 12 && !/receiving this|unsubscribe|Pvt Ltd|team$/i.test(r.text)),
      ctaTop: ctas.length ? Math.min(...ctas.map((a) => a.getBoundingClientRect().top)) : null,
      ctaTexts: ctas.map((a) => a.textContent.trim()),
      heroH: hero ? hero.getBoundingClientRect().height : null,
    };
  });
}

async function check(context, label) {
  await context.route(/^https?:\/\//, (r) => (r.request().resourceType() === 'image'
    ? r.fulfill({ contentType: 'image/svg+xml', body: SVG }) : r.abort()));
  for (const a of ASSETS) {
    const page = await context.newPage();
    await page.setContent(a.html, { waitUntil: 'load' });
    const m = await measure(page);
    const where = `${a.name} on ${label} (${m.vw}x${m.vh})`;
    // The page is laid out at the device's own width: the viewport meta is read.
    expect(m.scrollW, `${where}: the page is wider than the screen`).toBeLessThanOrEqual(m.vw + 1);
    expect(m.over, `${where}: something runs past the right edge`).toEqual([]);
    // Copy is readable without zooming.
    expect(m.body, `${where}: body copy under 12px`).toEqual([]);
    // The button is on the first screen.
    expect(m.ctaTop, `${where}: no button`).not.toBeNull();
    expect(m.ctaTop, `${where}: the first button is below the first screen`).toBeLessThan(m.vh);
    // The same button is never printed twice in a row.
    if (a.text) {
      const html = a.html.replace(/\s+/g, ' ');
      expect(/→<\/a>\s*<\/p>\s*<p[^>]*>\s*<a[^>]*>[^<]*→<\/a>/.test(html), `${where}: two buttons back to back`).toBe(false);
    }
    await page.close();
  }
}

test('every mailer and landing page reads on this device: its own width, readable copy, the button on the first screen', async ({ browser, page }, info) => {
  test.setTimeout(180_000);
  expect(ASSETS.filter((a) => a.mail).length, 'the four mailer variants and the main mailer').toBeGreaterThanOrEqual(5);
  expect(ASSETS.filter((a) => !a.mail).length, 'a landing page').toBeGreaterThanOrEqual(1);
  if (info.project.name !== 'desktop-1280') {
    // A device project (WebKit for the iPhones and the iPad): the page fixture IS the device.
    await check(page.context(), info.project.name);
    return;
  }
  for (const [label, d] of SIZES) {
    const { defaultBrowserType, ...use } = d;   // Chromium here; the device projects run WebKit
    const ctx = await browser.newContext(use);
    try { await check(ctx, label); } finally { await ctx.close(); }
  }
});

test('the mobile rules: a mail without a viewport gets one, the hero is capped on a narrow screen, two style attributes on the card are merged', async () => {
  const MF = require(path.join(ROOT, 'api', '_shared', 'mailer-format.js'));
  const raw = '<!doctype html><html><body><table role="presentation" width="100%"><tr><td>'
    + '<table role="presentation" width="600" style="max-width:600px;" cellpadding="0" style="background:#fff;border:1px solid #eee;"><tr><td><img data-mail-hero src="https://x.example/a.jpg"></td></tr></table>'
    + '</td></tr></table></body></html>';
  const out = MF.fluid(raw);
  expect(out).toContain('name="viewport"');
  expect(out).toMatch(/img\[data-mail-hero\][^}]*max-height/);
  const card = out.match(/<table role="presentation"[^>]*max-width:600px[^>]*>/)[0];
  expect((card.match(/\bstyle="/g) || []).length).toBe(1);
  expect(card).toContain('background:#fff');
  expect(MF.article('Arya Tea')).toBe('an');
  expect(MF.article('Palmgrove')).toBe('a');
});
