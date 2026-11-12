// ON-SITE AND DISPLAY ASSETS; APPROVED SENDS GAIN NEW ASSET KINDS; THE "WHY" TABLE (2026-11-12).
// The operator, on production /brain (Lenskart, an approved slot): "dont see the
// social media posts in smart brain still", "add any more assets if required as
// per industry standards", "also fix the broken UI" (labels drawn over their
// values in "Why these?"), "also fix INP issue".
//
// EXECUTED: the shipped buildCampaign (a store, a publisher, a bare name, a brand
// whose primary is near-black), every banner drawn in Chromium and measured, the
// shipped top-up over a campaign saved before these kinds existed, and the
// /brain preview and "Why these?" panel in Chromium.
// Run: npx playwright test tests/site-assets.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'ANTHROPIC_BASE_URL'];
const ST = require(path.join(ROOT, 'api', '_shared', 'site-assets.js'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const preset = (slug) => { const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', slug + '.json'), 'utf8')); b.id = 'device:' + slug; if (!b.regions || !b.regions.length) b.regions = [{ code: 'IN', currency: 'INR', home: true, store_url: b.website }]; return b; };
const FOUNDATION = { sku: 'S1', title: 'Kay Beauty Hydrating Foundation 30ml', handle: 'p1', image: 'https://www.nykaa.com/img/1.jpg', price: 1399, compare_at: 1599, url: 'https://www.nykaa.com/products/p1', category: 'Foundation', description: '<p>A lightweight liquid foundation with medium buildable coverage.</p><p>Enriched with hyaluronic acid to keep skin hydrated for up to 12 hours.</p>' };
const SIZES = ['300x250', '336x280', '728x90', '970x250', '300x600', '160x600', '320x50', '320x100'];

async function build(brand, o) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error(`network blocked: ${u}`); };
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const entry = Object.assign({ id: 'site-' + (brand.slug || 'x'), date: '2026-11-14', market: 'IN', objective: 'reactivation', brand: JSON.parse(JSON.stringify(brand)), cohort: { name: 'At Risk', size: 1500, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], confidence: 0.6 }, o || {});
    const campaign = await require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js')).buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
    return { campaign, entry };
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('a store\'s send carries its on-site assets, a banner per Google size and a responsive display ad, each inside its limits', async () => {
  const { campaign: c } = await build(preset('nykaa'), { heroProduct: FOUNDATION });
  const on = c.assets.onsite;
  expect(Object.keys(on)).toEqual(['announcement_bar', 'hero_banner', 'popup']);
  expect(on.announcement_bar.text).toBe('Kay Beauty Hydrating Foundation: ₹1,399, was ₹1,599');
  expect(on.announcement_bar.text.length).toBeLessThanOrEqual(ST.BAR_MAX);
  expect(on.hero_banner.headline).toBe('Kay Beauty Hydrating Foundation');
  expect(on.hero_banner.sub[0]).toBe('Enriched with hyaluronic acid to keep skin hydrated for up to 12 hours.');
  expect(on.hero_banner.image_url).toBe('https://www.nykaa.com/img/1.jpg');
  expect(on.popup.dismiss).toBe('Not now');
  for (const o of Object.values(on)) {
    expect(o.link, o.key).toMatch(/^https:\/\/www\.nykaa\.com\/products\/p1\?.*utm_medium=onsite/);
    expect(o.html, o.key).toMatch(new RegExp(`data-onsite="${o.key}"`));
    expect(o.contract_check.ok, o.key).toBe(true);
    // written for everyone: never the cohort's line
    expect(JSON.stringify([o.text, o.headline, o.sub, o.body]), o.key).not.toMatch(/It has been a while|whenever you are ready|DATA REQUIRED|undefined/);
  }
  expect(c.assets.display_banners.map((b) => b.size)).toEqual(SIZES);
  for (const b of c.assets.display_banners) {
    expect(b.destination_url, b.size).toMatch(/utm_medium=display/);
    expect(b.upload).toEqual(ST.UPLOAD);
    expect(b.contract_check.ok, b.size).toBe(true);
    expect([b.headline, 'Kay Beauty Hydrating Foundation', 'Nykaa']).toContain(b.headline === 'Nykaa' ? 'Nykaa' : 'Kay Beauty Hydrating Foundation');
  }
  // the smallest banner takes a line that fits whole, never a cut one
  expect(c.assets.display_banners.find((b) => b.size === '320x50').headline).toBe('Nykaa');
  const g = c.assets.google_display;
  expect(g.short_headlines.length).toBeGreaterThanOrEqual(1);
  expect(g.short_headlines.length).toBeLessThanOrEqual(5);
  for (const h of g.short_headlines) expect(h.length, h).toBeLessThanOrEqual(30);
  expect(g.long_headline.length).toBeLessThanOrEqual(90);
  expect(g.long_headline).toBe('Kay Beauty Hydrating Foundation: Enriched with hyaluronic acid to keep skin hydrated for up to 12 hours'.length <= 90 ? 'Kay Beauty Hydrating Foundation: Enriched with hyaluronic acid to keep skin hydrated for up to 12 hours' : g.long_headline);
  for (const d of g.descriptions) expect(d.length, d).toBeLessThanOrEqual(90);
  expect(g.limits.unverified).toEqual(['description', 'business_name']);
  expect(g.contract_check.ok).toBe(true);
  expect(c.contract_check.blocking).toBe(0);
  expect(c.contract_check.by_contract['display.banner']).toBe(8);
});

test('a publisher and a bare name: only what the record states, no picture invented, with no page no display ad is built', async () => {
  const { campaign: toi } = await build(preset('times-of-india'), {});
  expect(toi.assets.onsite.hero_banner.headline).toBe('The Times of India');
  expect(toi.assets.onsite.hero_banner.image_url).toBeUndefined();
  for (const b of toi.assets.display_banners) {
    expect(b.image_url).toBeUndefined();
    expect(b.html).not.toMatch(/<img/);
    expect(b.contract_check.violations).toEqual([]);   // the missing photo is one data gap, not a finding per banner
  }
  const bare = { id: 'device:oz', slug: 'ozzlewick', name: 'Ozzlewick', regions: [{ code: 'IN', currency: 'INR', home: true }] };
  const { campaign: oz } = await build(bare, {});
  expect(oz.data_gaps.join(' ')).toMatch(/page to link from on-site and display assets, Ozzlewick/);
  // A display ad is a link: with no page on record none is built, and the gap is said.
  expect(oz.assets.display_banners).toEqual([]);
  expect(oz.assets.google_display == null).toBe(true);
  expect(JSON.stringify([oz.assets.onsite, oz.assets.display_banners.map((b) => [b.headline, b.sub])])).not.toMatch(/DATA REQUIRED|undefined|Kay Beauty|Times of India/);
  // the check itself
  expect(ST.check({ type: 'google_responsive_display', short_headlines: ['x'.repeat(31)], long_headline: 'y'.repeat(91), descriptions: [], business_name: 'B' }).filter((v) => v.level === 'block').map((v) => v.slot).sort()).toEqual(['descriptions', 'final_url', 'long_headline', 'short_headlines']);
  expect(ST.check({ type: 'display_banner', size: '123x45', headline: 'Hello', destination_url: 'http://x.example' }).filter((v) => v.level === 'block').map((v) => v.slot).sort()).toEqual(['destination_url', 'size']);
});

test('every banner and on-site asset drawn in Chromium: nothing outside its frame, no dark ground, the button stands off its band', async ({ page }) => {
  const dark = { id: 'device:onyx', slug: 'onyxline', name: 'Onyxline', website: 'https://onyxline.example', tagline: 'Tools that last a working life', claims: ['Repairable by design'], palette: { primary: '#0d0d0d', accent: '#111111', surface: '#ffffff', ink: '#111111' }, regions: [{ code: 'IN', currency: 'INR', home: true, store_url: 'https://onyxline.example' }] };
  const LONG = { sku: 'L1', title: 'Onyxline Professional Cordless Hammer Drill Driver Kit 18V', handle: 'drill', image: 'https://onyxline.example/img/1.jpg', price: 12999, url: 'https://onyxline.example/products/drill', category: 'Drills', description: '<p>A brushless motor that drives through masonry without stalling.</p>' };
  const cases = [await build(preset('nykaa'), { heroProduct: FOUNDATION }), await build(dark, { heroProduct: LONG }), await build(preset('times-of-india'), {})];
  await page.route(/^https?:\/\//, (r) => (/\.(jpg|png)(\?|$)/.test(r.request().url()) ? r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#c9a"/></svg>' }) : r.abort()));
  let measured = 0;
  for (const { campaign: c } of cases) {
    const docs = c.assets.display_banners.map((b) => ({ name: 'banner ' + b.size, w: b.width, h: b.height, html: b.html, banner: true }))
      .concat(Object.values(c.assets.onsite).map((o) => ({ name: 'onsite ' + o.key, w: 390, h: 700, html: o.html })), Object.values(c.assets.onsite).map((o) => ({ name: 'onsite wide ' + o.key, w: 1100, h: 700, html: o.html })));
    for (const d of docs) {
      await page.setViewportSize({ width: d.w, height: d.h });
      await page.setContent(d.html);
      const m = await page.evaluate((banner) => {
        const lum = (rgb) => { const v = rgb.match(/[\d.]+/g).slice(0, 3).map((x) => { x = +x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const bg = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return 'rgb(255, 255, 255)'; };
        const out = { over: [], low: [], dark: [], texts: 0, sw: document.documentElement.scrollWidth - innerWidth, sh: document.documentElement.scrollHeight - innerHeight, btn: null };
        const root = document.querySelector('.ad') || document.body;
        const R = root.getBoundingClientRect();
        for (const el of document.querySelectorAll('.ad span, .bar *, .bar, .hero *, .card *')) {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (!own) continue;
          out.texts += 1;
          const r = el.getBoundingClientRect();
          if (banner && (r.right > R.right + 0.5 || r.bottom > R.bottom + 0.5 || r.left < R.left - 0.5 || r.top < R.top - 0.5)) out.over.push(el.className);
          const cr = ratio(getComputedStyle(el).color, bg(el));
          if (cr < 4.5) out.low.push(el.className + ' ' + cr.toFixed(2));
        }
        for (const el of document.querySelectorAll('.ad, .bar, .hero, .veil, .card')) { const c = getComputedStyle(el).backgroundColor; const v = c.match(/[\d.]+/g).slice(0, 3).map(Number); if (Math.max(...v) < 60 && Math.max(...v) - Math.min(...v) < 30) out.dark.push(el.className + ' ' + c); }
        const btn = document.querySelector('.btn');
        if (btn) out.btn = ratio(getComputedStyle(btn).backgroundColor, bg(btn.parentElement));
        return out;
      }, !!d.banner);
      measured += m.texts;
      expect(m.over, `${c.brand_name || ''} ${d.name}: text outside the frame`).toEqual([]);
      expect(m.low, `${d.name}: text under AA`).toEqual([]);
      expect(m.dark, `${d.name}: a dark-neutral ground`).toEqual([]);
      expect(m.sw, `${d.name}: wider than its frame`).toBeLessThanOrEqual(0);
      if (d.banner) expect(m.sh, `${d.name}: taller than its frame`).toBeLessThanOrEqual(0);
      if (m.btn != null) expect(m.btn, `${d.name}: the button does not stand off its band`).toBeGreaterThanOrEqual(1.5);
    }
  }
  expect(measured).toBeGreaterThan(120);
});

test('a send approved before these kinds existed gains them on view, and nothing it was approved with changes', async () => {
  const { campaign, entry } = await build(preset('nykaa'), { heroProduct: FOUNDATION });
  const saved = JSON.parse(JSON.stringify(campaign));
  delete saved.assets.social_posts; delete saved.assets.onsite; delete saved.assets.display_banners; delete saved.assets.google_display;
  const before = JSON.stringify([saved.assets.email, saved.assets.landing_pages, saved.assets.ads]);
  const SBP = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
  const added = SBP.__test_topUpSavedCampaign(saved, entry);
  expect(added.sort()).toEqual(['display_banners', 'google_display', 'onsite', 'social_posts']);
  expect(saved.assets.social_posts.map((p) => p.key)).toEqual(campaign.assets.social_posts.map((p) => p.key));
  expect(saved.assets.social_posts[0].caption).toBe(campaign.assets.social_posts[0].caption);
  expect(saved.assets.display_banners.length).toBe(8);
  expect(saved.assets_added_on_view.sort()).toEqual(['display_banners', 'google_display', 'onsite', 'social_posts']);
  expect(JSON.stringify([saved.assets.email, saved.assets.landing_pages, saved.assets.ads])).toBe(before);
  // a second view adds nothing again
  expect(SBP.__test_topUpSavedCampaign(saved, entry)).toEqual([]);
});

test('the /brain preview shows On-site and Display ads as their own groups; "Why these?" answers the press first and its labels never sit on their values', async ({ page }) => {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { campaign: c } = await build(preset('nykaa'), { heroProduct: FOUNDATION });
    await page.route(/\/api\//, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"offline"}' }));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/smart-brain.html`);
    await page.waitForFunction(() => typeof renderPreview === 'function');   // eslint-disable-line no-undef
    await page.waitForFunction(() => [...document.styleSheets].some((s) => /theme\.css/.test(s.href || '')));
    const got = await page.evaluate((campaign) => {
      const host = document.createElement('div'); host.id = 'site-host'; document.body.appendChild(host);
      // eslint-disable-next-line no-undef
      renderPreview({ campaign }, { id: 'site-slot', channels: ['email', 'meta', 'landing_page'], __device: true }, 0, { target: host });
      const label = (k) => { const t = host.querySelector(`.pvgroups .pvtab[data-group="${k}"]`); return t ? t.textContent : ''; };
      return { site: label('site'), display: label('display'), siteIds: [...host.querySelectorAll('[id^="pv-site-"]')].map((x) => x.id), dspIds: [...host.querySelectorAll('[id^="pv-dsp-"]')].map((x) => x.id) };
    }, JSON.parse(JSON.stringify(c)));
    expect(got.site).toMatch(/On-site\s*3/);
    expect(got.display).toMatch(/Display ads\s*9/);
    expect(got.siteIds).toEqual(['pv-site-announcement_bar', 'pv-site-hero_banner', 'pv-site-popup']);
    expect(got.dspIds).toEqual(SIZES.map((s) => 'pv-dsp-' + s).concat('pv-dsp-responsive'));
    await page.locator('#site-host .pvtab[data-group="display"]').click();
    await expect(page.locator('#pv-dsp-responsive [data-google-display]')).toContainText(c.assets.google_display.long_headline);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#pv-dsp-300x250 button', { hasText: /^⬇ Download$/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/banner-300x250\.html$/);
    expect(fs.readFileSync(await dl.path(), 'utf8')).toContain('data-banner="300x250"');

    // "Why these?": the press is answered before the panel is built, and the
    // label column is as wide as its words.
    const first = await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      PLAN.length = 0; PLAN.push({ id: 'why-1', date: '2027-01-23', market: 'IN', cohort: { name: 'Engaged' }, objective: 'Turn interest into a first step with Vincent Chase Online.', rationale: 'Chosen to turn interest into a first step with Vincent Chase Online for Engaged (size not measured).', confidence: 0.53, heroProduct: { title: 'Vincent Chase Online VC E000274' }, channels: ['email'] });
      const t = document.createElement('table'); t.id = 'plantable';
      t.innerHTML = '<tbody><tr class="exprow" id="exprow-0" style="display:none"><td colspan="9"><div class="expbody" id="expbody-0"></div></td></tr></tbody>';
      document.body.appendChild(t);
      window.viewDecision(0);
      return document.getElementById('expbody-0').textContent.trim();
    });
    expect(first, 'the panel was built inside the press').toMatch(/^Opening/);
    await expect(page.locator('#expbody-0 [data-why-table]')).toBeVisible();
    const rows = await page.locator('#expbody-0 [data-why-table] tr').evaluateAll((trs) => trs.map((tr) => { const [a, b] = [...tr.children].map((td) => td.getBoundingClientRect()); const r = document.createRange(); r.selectNodeContents(tr.children[0]); const words = r.getBoundingClientRect(); return { label: tr.children[0].textContent.trim(), labelRight: words.right, cellRight: a.right, valueLeft: b.left }; }));
    expect(rows.map((r) => r.label)).toEqual(['Cohort', 'Data basis', 'Timing', 'Offer', 'Confidence']);
    for (const r of rows) {
      expect(r.labelRight, r.label + ': the label runs out of its cell').toBeLessThanOrEqual(r.cellRight + 0.5);
      expect(r.valueLeft, r.label + ': the value starts under the label').toBeGreaterThanOrEqual(r.labelRight);
    }
  } finally {
    server.closeAllConnections && server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
