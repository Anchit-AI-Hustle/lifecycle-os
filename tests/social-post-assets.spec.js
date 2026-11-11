// SOCIAL POSTS AS A SEND'S OWN ASSET (2026-11-11). The operator: "For asset
// generation, also add assets like social media posts. Like we've kept ads,
// we've kept landing pages, keep social media posts also, and individually for
// Instagram, Meta, LinkedIn, and other platforms also to be included, like
// TikTok, etc."
//
// Every Smart Brain build carries campaign.assets.social_posts: one organic
// post per platform (api/_shared/social-assets.js). EXECUTED: the shipped
// buildCampaign for a store, a publisher with an article, a publisher with no
// product and a bare name; all 40 starter brands; the /brain preview in
// Chromium (the pane, Copy, Download).
// Run: npx playwright test tests/social-post-assets.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'ANTHROPIC_BASE_URL'];
const SA = require(path.join(ROOT, 'api', '_shared', 'social-assets.js'));
const SPECS = require(path.join(ROOT, 'api', '_shared', 'social-core.js')).PLATFORM_SPECS;

const preset = (slug) => { const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', slug + '.json'), 'utf8')); b.id = 'device:' + slug; if (!b.regions || !b.regions.length) b.regions = [{ code: 'IN', currency: 'INR', home: true }]; return b; };
const FOUNDATION = { sku: 'S1', title: 'Kay Beauty Hydrating Foundation 30ml', handle: 'p1', image: 'https://www.nykaa.com/img/1.jpg', price: 1399, compare_at: 1599, url: 'https://www.nykaa.com/products/p1', category: 'Foundation', description: '<p>A lightweight liquid foundation with medium buildable coverage.</p><p>Enriched with hyaluronic acid to keep skin hydrated for up to 12 hours.</p><p>Blends easily and gives a natural satin finish.</p><p>Apply 2 pumps with a damp sponge and blend outwards.</p>' };
const STORY = { title: 'Rupee slips past 84 as oil climbs: what it means for your EMIs', handle: 'rupee-84', image: 'https://timesofindia.indiatimes.com/img/21.jpg', price: null, url: 'https://timesofindia.indiatimes.com/business/rupee-84', category: 'Business', offering_kind: 'story', description: 'The rupee closed at a record low on Thursday. Here is how that feeds into fuel prices and home loan rates.' };
const ORDER = ['instagram_feed', 'instagram_reels', 'facebook', 'linkedin', 'tiktok', 'x', 'pinterest', 'youtube_shorts', 'threads'];

async function build(brand, o) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error(`network blocked: ${u}`); };
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const entry = Object.assign({ id: 'soc-' + (brand.slug || 'x'), date: '2026-11-14', market: 'IN', objective: 'reactivation', brand: JSON.parse(JSON.stringify(brand)), cohort: { name: 'At Risk', size: 1500, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 } }, o || {});
    return await require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js')).buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const whole = (p) => p.caption + (p.hashtags.length ? '\n\n' + p.hashtags.join(' ') : '');

test('a store\'s send carries one post per platform, each in that platform\'s shape and inside its limits', async () => {
  const c = await build(preset('nykaa'), { heroProduct: FOUNDATION });
  const posts = c.assets.social_posts;
  expect(posts.map((p) => p.key)).toEqual(ORDER);
  const by = Object.fromEntries(posts.map((p) => [p.key, p]));
  for (const p of posts) {
    const sp = SPECS[p.key];
    expect(whole(p).length, p.key).toBeLessThanOrEqual(sp.char_limit);
    expect(p.hashtags.length, p.key).toBeLessThanOrEqual(sp.hashtags[1]);
    expect(p.platform).toBe(sp.platform);
    expect(p.media.aspect).toBe(sp.aspect);
    expect(p.contract_check.ok, p.key).toBe(true);
    expect(p.caption, p.key).not.toMatch(/DATA REQUIRED|\{\{|undefined/);
    // an organic post never speaks to one cohort
    expect(p.caption, p.key).not.toMatch(/It has been a while|whenever you are ready|Thank you for your first order/);
    // every sentence is the store's own, or the name and price it states
    for (const line of p.caption.split(/\n+/).map((l) => l.replace(/^• /, '').trim()).filter(Boolean)) {
      if (/^Shop now: /.test(line) || /^https:\/\//.test(line)) continue;
      const srcs = [FOUNDATION.description.replace(/<[^>]+>/g, ' '), 'Kay Beauty Hydrating Foundation, ₹1,399, was ₹1,599.'];
      const okLine = line.split(/(?<=[.!?])\s+/).every((s) => /^https:\/\//.test(s) || srcs.some((src) => src.includes(s.replace(/[.!]$/, ''))));
      expect(okLine, `${p.key}: "${line}" is not the store's own sentence`).toBe(true);
    }
  }
  // Instagram and TikTok captions carry no link; the others carry the slot's page, tagged as organic
  for (const k of ['instagram_feed', 'instagram_reels', 'tiktok']) { expect(by[k].caption).not.toMatch(/https?:\/\//); expect(by[k].link).toBeUndefined(); }
  expect(by.instagram_feed.caption).toMatch(/Shop now: link in bio\.$/);
  for (const k of ['facebook', 'linkedin', 'x', 'youtube_shorts', 'threads']) {
    expect(by[k].link, k).toMatch(new RegExp(`^https://www\\.nykaa\\.com/products/p1\\?utm_source=${SPECS[k].platform}&utm_medium=social&utm_campaign=2026-11-14-in-reactivation&utm_content=social-`));
    expect(by[k].caption, k).toContain(by[k].link);
  }
  // each platform reads its own way
  expect(by.instagram_feed.caption.split('\n\n').length).toBeGreaterThanOrEqual(4);
  expect(by.x.caption.length).toBeLessThanOrEqual(280);
  expect(by.pinterest.title).toBe('Kay Beauty Hydrating Foundation');
  expect(by.youtube_shorts.title.length).toBeLessThanOrEqual(100);
  expect(new Set(posts.map((p) => p.caption)).size).toBeGreaterThanOrEqual(7);
  // the price as the store states it, with its struck price
  expect(by.facebook.caption).toContain('Kay Beauty Hydrating Foundation, ₹1,399, was ₹1,599.');
  // hashtags are words the record states
  expect(by.instagram_feed.hashtags).toEqual(['#Nykaa', '#Foundation', '#KayBeauty', '#BeautyRetail']);
  // the picture is the product's own photo; a video post uses the send's Story video
  expect(by.instagram_feed.media).toMatchObject({ kind: 'image', aspect: '4:5', image_url: 'https://www.nykaa.com/img/1.jpg' });
  expect(by.tiktok.media.kind).toBe('video');
  expect(by.tiktok.media.source).toMatch(/Story video/);
  // judged with every other asset
  expect(c.contract_check.by_contract['social.instagram_feed']).toBe(1);
  expect(c.contract_check.blocking).toBe(0);
});

test('a publisher: an article\'s headline and standfirst; with no article, its own claim and sections; no picture is invented', async () => {
  const a = await build(preset('times-of-india'), { cohort: { name: 'Hibernating', size: 900, rules: ['r'] }, heroProduct: STORY });
  const by = Object.fromEntries(a.assets.social_posts.map((p) => [p.key, p]));
  expect(by.instagram_feed.caption).toBe(`${STORY.title}\n\n${STORY.description}\n\nStart reading: link in bio.`);
  expect(by.x.caption.startsWith(STORY.title + ' https://timesofindia.indiatimes.com/business/rupee-84?utm_source=x&utm_medium=social')).toBe(true);
  expect(by.pinterest.title).toBe(STORY.title);
  expect(by.instagram_feed.hashtags.slice(0, 2)).toEqual(['#TheTimesOfIndia', '#Business']);
  const n = await build(preset('times-of-india'), { cohort: { name: 'Hibernating', size: 900, rules: ['r'] } });
  const nb = Object.fromEntries(n.assets.social_posts.map((p) => [p.key, p]));
  expect(nb.instagram_feed.caption).toBe('General news coverage from The Times of India.\n\nIndia · City · Videos · TOI+\n\nStart reading: link in bio.');
  expect(nb.instagram_feed.media.image_url).toBeUndefined();
  expect(nb.instagram_feed.media.gap).toMatch(/DATA REQUIRED BEFORE LAUNCH: image for social posts, The Times of India/);
  expect(n.data_gaps.join(' ')).toMatch(/image for social posts/);
  for (const p of n.assets.social_posts) expect(p.caption).not.toMatch(/It has been a while/);
});

test('a bare name, and every starter brand: a post for each platform, inside its limits, nothing invented', async () => {
  test.setTimeout(240_000);
  const bare = await build({ id: 'device:orrin', slug: 'orrin', name: 'Orrin', regions: [{ code: 'IN', currency: 'INR', home: true }] });
  expect(bare.assets.social_posts.map((p) => p.key)).toEqual(ORDER);
  for (const p of bare.assets.social_posts) { expect(p.caption).toMatch(/Orrin|link in bio/); expect(p.link).toBeUndefined(); expect(p.caption).not.toMatch(/https?:/); }
  expect(bare.data_gaps.join(' ')).toMatch(/page to link from social posts, Orrin/);
  for (const f of fs.readdirSync(path.join(ROOT, 'data', 'brands', 'presets')).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
    const c = await build(preset(f.replace('.json', '')));
    expect(c.assets.social_posts.map((p) => p.key), f).toEqual(ORDER);
    for (const p of c.assets.social_posts) {
      expect(whole(p).length, `${f} ${p.key}`).toBeLessThanOrEqual(SPECS[p.key].char_limit);
      expect(p.caption, `${f} ${p.key}`).not.toMatch(/DATA REQUIRED|\{\{|undefined|\[object/);
      expect(p.caption.trim().length, `${f} ${p.key}`).toBeGreaterThan(0);
      expect(SA.check(p).filter((v) => v.level === 'block'), `${f} ${p.key}`).toEqual([]);
      for (const h of p.hashtags) expect(h, `${f} ${p.key}`).toMatch(/^#[A-Za-z0-9À-￿]{3,30}$/);
    }
  }
});

test('the check holds a post to its platform: over the limit, a marker, a link where none is tappable', () => {
  const base = { key: 'x', caption: 'A line.', hashtags: [], link: 'https://a.example/' };
  expect(SA.check(base)).toEqual([]);
  expect(SA.check(Object.assign({}, base, { caption: 'x'.repeat(281) })).map((v) => v.level)).toEqual(['block']);
  expect(SA.check(Object.assign({}, base, { caption: '[DATA REQUIRED BEFORE LAUNCH: price, X]' }))[0].level).toBe('block');
  expect(SA.check({ key: 'instagram_feed', caption: 'See https://a.example/', hashtags: [] })[0]).toMatchObject({ level: 'warn', slot: 'caption' });
  expect(SA.check({ key: 'pinterest', caption: 'ok', title: 't'.repeat(101), hashtags: [] })[0]).toMatchObject({ level: 'block', slot: 'title' });
});

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
test('the /brain preview shows the posts as their own group, one pane per platform, and copies and downloads the post', async ({ page }) => {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const c = await build(preset('nykaa'), { heroProduct: FOUNDATION });
    await page.route(/\/api\//, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"offline"}' }));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/smart-brain.html`);
    await page.waitForFunction(() => typeof window.renderPreview === 'function' || typeof renderPreview === 'function');
    const got = await page.evaluate((campaign) => {
      const host = document.createElement('div');
      host.id = 'soc-host';
      document.body.appendChild(host);
      // eslint-disable-next-line no-undef
      renderPreview({ campaign }, { id: 'soc-slot', channels: ['email', 'meta', 'landing_page'], __device: true }, 0, { target: host });
      const tab = host.querySelector('.pvgroups .pvtab[data-group="social"]');
      const label = tab ? tab.textContent : '';
      if (tab) tab.click();
      return { label, ids: [...host.querySelectorAll('[id^="pv-soc-"]')].map((x) => x.id) };
    }, JSON.parse(JSON.stringify(c)));
    expect(got.label).toMatch(/Social posts\s*9/);
    expect(got.ids).toEqual(ORDER.map((k) => 'pv-soc-' + k));
    const ig = c.assets.social_posts.find((p) => p.key === 'instagram_feed');
    // the caption keeps its own line breaks
    expect(await page.locator('#pv-soc-instagram_feed [data-social-caption]').evaluate((el) => [el.textContent, getComputedStyle(el).whiteSpace])).toEqual([ig.caption, 'pre-wrap']);
    await expect(page.locator('#pv-soc-instagram_feed [data-social-tags]')).toHaveText(ig.hashtags.join(' '));
    await expect(page.locator('#pv-soc-instagram_feed')).toContainText(`${whole(ig).length} of 2200 characters`);
    await expect(page.locator('#pv-soc-pinterest [data-social-title]')).toHaveText('Kay Beauty Hydrating Foundation');
    await expect(page.locator('#pv-soc-instagram_feed img')).toHaveAttribute('src', 'https://www.nykaa.com/img/1.jpg');
    // tokens only: the card's ground is the panel token
    const ground = await page.evaluate(() => {
      const b = document.querySelector('#pv-soc-instagram_feed .socpost');
      const probe = document.createElement('div'); probe.style.background = 'var(--vh-panel)'; document.body.appendChild(probe);
      return [getComputedStyle(b).backgroundColor, getComputedStyle(probe).backgroundColor];
    });
    expect(ground[0]).toBe(ground[1]);
    await page.locator('#pv-soc-instagram_feed button', { hasText: 'Copy' }).click();
    await expect.poll(() => page.evaluate(() => window.__copied.slice(-1)[0])).toBe(SA.plain(ig));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#pv-soc-linkedin button', { hasText: /^⬇ Download$/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/social-linkedin\.txt$/);
    expect(fs.readFileSync(await dl.path(), 'utf8')).toBe(SA.plain(c.assets.social_posts.find((p) => p.key === 'linkedin')));
    // the page is no wider than a phone with the posts open
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(392);
  } finally {
    server.closeAllConnections && server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
