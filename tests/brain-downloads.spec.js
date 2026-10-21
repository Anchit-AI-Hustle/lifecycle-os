// What /brain hands you is the asset, opened from disk (2026-10-20).
//
// The operator: "Check the downloaded output of all files in the smart brain -
// issues: images not loading, icons not loading, html codes loading instead of
// output". Reproduced in Chromium before the fix: an ad's Download saved its
// JSON under a .html name, so it opened as a wall of code, and the video
// creative's HTML inside that JSON was half-parsed into broken <img src=\"...\">
// tags; "Download all" pasted every document and that JSON into one page.
//
// Executed: a campaign the app builds, rendered by the console's own
// renderPreview, every download control pressed, every saved file opened from
// file:// the way a person opens it, its images loaded (the brand's host is
// answered), its text read.
//
// Run: npx playwright test tests/brain-downloads.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const sbPlan = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));

const BRAND = {
  id: 'device:brewline', slug: 'brewline', name: 'Brewline Coffee', website: 'https://brewline.example', industry: 'coffee',
  tagline: 'Small-batch coffee roasted weekly', logo_url: 'https://brewline.example/logo.png',
  palette: { primary: '#6B3E26', accent: '#E0A458', ink: '#2B1D14', surface: '#FFF8F0' },
  regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Roasted every Monday'],
};
const SLOT = {
  id: 'dl-1', date: '2026-10-21', market: 'IN', objective: 'reactivation', brand: BRAND,
  cohort: { name: 'At Risk', size: 900, rules: ['no order in 90 days'] },
  channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], offer: { depth: 'none', pct: 0 },
};
const PHOTO = 'https://brewline.example/img/malabar.jpg';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];

let server; let base; let campaign;
test.beforeAll(async () => {
  test.setTimeout(120_000);
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  try { campaign = await sbPlan.buildCampaign(SLOT, smartConfig({}), { noLLM: true, withCreatives: false }); }
  finally { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
  // A brand with a catalogue: its static ads carry the product photograph.
  for (const ad of campaign.assets.ads) if (ad.creative_type === 'static') ad.creative = Object.assign({}, ad.creative, { image: PHOTO });
  // A brand whose site wrote its logo protocol-relative, as many stores do.
  for (const v of campaign.assets.email.variants) v.html = v.html.replace(/src="https:\/\/brewline\.example\/logo\.png"/, 'src="//brewline.example/logo.png"');
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true,"workspaces":[]}'); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

async function open(context) {
  await context.route('https://brewline.example/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await context.route(/fonts\.(googleapis|gstatic)\.com|google\.com\/s2|pollinations/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const page = await context.newPage();
  await page.goto(base + '/smart-brain.html', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof renderPreview === 'function', null, { timeout: 20000 });
  await page.evaluate((c) => {
    const host = document.createElement('div'); document.body.appendChild(host);
    renderPreview({ campaign: c }, { id: 'dl-1', date: '2026-10-21', market: 'IN', channels: ['email', 'meta'] }, 0, { target: host });
  }, campaign);
  return page;
}
async function save(page, fn, dir, file) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.evaluate(fn)]);
  const sug = d.suggestedFilename();
  const p = path.join(dir, file ? file + path.extname(sug) : sug);
  await d.saveAs(p);
  return { path: p, name: d.suggestedFilename() };
}
// What a person sees when they open a saved file (and every frame inside it).
async function inspect(context, file) {
  const p = await context.newPage();
  await p.goto('file://' + file);
  await p.waitForTimeout(1200);
  const out = await p.evaluate(() => {
    const read = (d) => ({
      text: d.body ? d.body.innerText : '',
      imgs: [...d.images].map((i) => ({ src: i.getAttribute('src') || '', ok: i.complete && i.naturalWidth > 0 })),
    });
    const frames = [...document.querySelectorAll('iframe')].map((f) => { try { return read(f.contentDocument); } catch (e) { return { error: String(e) }; } });
    return Object.assign(read(document), { frames });
  });
  await p.close();
  return out;
}
const looksLikeCode = (t) => /^\s*[{[]\s*"/.test(t) || /"master_prompt"\s*:/.test(t) || /\\n|\\"/.test(t);

test('every single-asset download opens as the asset: no code, no broken image, the right file type', async ({ browser }, info) => {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await open(context);
  const items = await page.evaluate(() => window.__SB_EXPORTS.map((x) => ({ name: x.name, ext: x.ext })));
  expect(items.filter((i) => /^ad-/.test(i.name) && i.ext === 'html').length, 'every ad has a page download').toBe(campaign.assets.ads.length);
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    const f = await save(page, `sbDownload(${i})`, info.outputDir, `item-${i}`);
    if (it.ext === 'json') {
      expect(f.name, it.name).toMatch(/\.json$/);
      expect(() => JSON.parse(fs.readFileSync(f.path, 'utf8')), it.name).not.toThrow();
      continue;
    }
    expect(f.name, it.name).toMatch(/\.html$/);
    const seen = await inspect(context, f.path);
    expect(looksLikeCode(seen.text), `${it.name} opened as code: ${seen.text.slice(0, 120)}`).toBe(false);
    for (const img of seen.imgs.concat(...seen.frames.map((x) => x.imgs || []))) {
      expect(img.src, `${it.name}: an escaped image address`).not.toMatch(/\\"|^\/\//);
      expect(img.ok, `${it.name}: image did not load: ${img.src}`).toBe(true);
    }
    if (/^ad-.*Static$/.test(it.name)) {
      expect(seen.imgs.map((x) => x.src), `${it.name} shows its photograph`).toContain(PHOTO);
      expect(seen.text).toContain('Brewline Coffee');
    }
    if (/^ad-.*Video$/.test(it.name)) expect(seen.frames.length, `${it.name} carries its playable creative`).toBe(1);
  }
  await context.close();
});

test('Download all is one file of framed assets, each rendering on its own, and never the ad JSON', async ({ browser }, info) => {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await open(context);
  const htmlItems = await page.evaluate(() => window.__SB_EXPORTS.filter((x) => x.ext === 'html').length);
  const f = await save(page, () => sbDownloadAll(), info.outputDir, 'all');
  const seen = await inspect(context, f.path);
  expect(seen.frames.length).toBe(htmlItems);
  expect(looksLikeCode(seen.text), seen.text.slice(0, 200)).toBe(false);
  for (const fr of seen.frames) {
    expect(fr.error).toBeUndefined();
    expect(looksLikeCode(fr.text), fr.text.slice(0, 160)).toBe(false);
    for (const img of fr.imgs) expect(img.ok, `image did not load: ${img.src}`).toBe(true);
  }
  expect(seen.frames.flatMap((x) => x.imgs).map((x) => x.src)).toContain(PHOTO);
  await context.close();
});

test('the ZIP carries a page per ad beside its data, and its index is the brand\'s, not tenant zero\'s', async ({ browser }) => {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await open(context);
  const files = await page.evaluate((c) => {
    // The brand is active: its tokens are on the page and its record is the context's.
    const r = document.documentElement.style;
    r.setProperty('--vh-primary', '#6B3E26'); r.setProperty('--vh-bg', '#FFF8F0'); r.setProperty('--vh-ink', '#2B1D14'); r.setProperty('--vh-accent-text', '#8A5A1E');
    window.BrandContext = Object.create(window.BrandContext || {}, { brand: { value: { name: 'Brewline Coffee' } } });
    PLAN = [{ id: 'dl-1', date: '2026-10-21', market: 'IN', cohort: { name: 'At Risk' } }];
    PREVIEW_CACHE['dl-1'] = { campaign: c };
    let captured = null; const real = window.zipStore;
    window.zipStore = (fl) => { captured = fl.map((x) => ({ name: x.name, data: String(x.data) })); return real(fl); };
    try { sbZipAll(); } finally { window.zipStore = real; }
    return captured;
  }, campaign);
  expect(files, 'the ZIP was built').toBeTruthy();
  const names = files.map((x) => x.name);
  const adHtml = names.filter((n) => /\/ad_.*\.html$/.test(n));
  expect(adHtml.length).toBe(campaign.assets.ads.length);
  expect(names.filter((n) => /\/ad_.*\.json$/.test(n)).length).toBe(campaign.assets.ads.length);
  for (const n of adHtml) expect(looksLikeCode(files.find((x) => x.name === n).data.replace(/<[^>]+>/g, ' ')), n).toBe(false);
  const index = files.find((x) => x.name === 'index.html').data;
  expect(index).not.toMatch(/KNICKGASM|#D0473E|#6A33D8/i);
  expect(index).toContain('Brewline Coffee campaign calendar');
  expect(index).toContain('#6B3E26');
  for (const m of files.filter((x) => /mailer_.*\.html$/.test(x.name))) expect(m.data, m.name).not.toMatch(/src="\/\//);
  await context.close();
});
