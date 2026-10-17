// The 20 things every website needs, checked on this one (2026-10-17).
//
// The operator, with a checklist screenshot ("20 things you MUST have Claude do
// when you're building a website"): "Ensure all 20 points are implemented".
// Each point below is checked on what ships: the files Vercel serves, the
// vercel.json it reads, and the pages run in Chromium. Points other gates
// already own are named with their gate rather than tested twice:
//   13 colour contrast  -> contrast-rendered, design-system, asset-no-black-background
//   14 mobile friendly  -> mobile-space-every-page, asset-devices
//
// Run: npx playwright test tests/site-essentials.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const VERCEL = JSON.parse(read('vercel.json'));
const TRACKED = cp.execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const IGNORED = read('.vercelignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const served = (f) => !IGNORED.some((g) => f === g || f.startsWith(g.replace(/\/$/, '') + '/'));
// Every root page the deployment serves (and the custom 404).
const PAGES = TRACKED.filter((f) => f.endsWith('.html') && !f.includes('/')).concat(fs.existsSync(path.join(ROOT, '404.html')) && !TRACKED.includes('404.html') ? ['404.html'] : []);
// Exempt by name, with the reason: the frozen 3 July snapshot must never change,
// and _sbtest is a test harness page robots.txt keeps out of every index.
const FROZEN = new Set(['diff-version.html', '_sbtest.html']);
const head = (f) => { const s = read(f); const i = s.search(/<\/head>/i); return i > 0 ? s.slice(0, i) : s.slice(0, 6000); };
const codeless = (s) => s.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
async function open(page, file, opts) {
  const o = opts || {};
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  if (o.gpc) await page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true }));
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => (route.request().resourceType() === 'script'
    ? route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }) : route.abort('failed')));
  await page.route('http://app.example.test/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (u.pathname.startsWith('/_vercel/')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* vercel */' });
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: null, workspaces: [] }) }));
  await page.route(/\/api\/public-config/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.goto('http://app.example.test/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(o.wait || 900);
  return requests;
}

/* 1, 2. Privacy policy and terms, linked from the public home page ─────────── */
test('1-2. a privacy policy and terms of service are served, allowed to be indexed, and linked from the home page', () => {
  for (const f of ['privacy.html', 'terms.html']) {
    expect(TRACKED, f).toContain(f);
    expect(codeless(read(f)).replace(/<[^>]+>/g, ' ').split(/\s+/).length, `${f} is a real document`).toBeGreaterThan(300);
  }
  expect(read('privacy.html')).toMatch(/id="cookies"/);
  const home = read('index.html');
  expect(home).toMatch(/href="\/privacy(\.html)?"/);
  expect(home).toMatch(/href="\/terms(\.html)?"/);
  expect(read('robots.txt')).toMatch(/Allow: \/privacy\.html[\s\S]*Allow: \/terms\.html/);
});

/* 3. No secret in anything the browser can download ───────────────────────── */
test('3. no API key, service key or private key is in any file the deployment serves', () => {
  const KEY = [
    /\bsk-(proj-)?[A-Za-z0-9_-]{24,}/, /\bAIza[0-9A-Za-z_-]{35}\b/, /\bgsk_[A-Za-z0-9]{40,}/, /\bxai-[A-Za-z0-9]{40,}/,
    /\bsk-ant-[A-Za-z0-9_-]{20,}/, /\bghp_[A-Za-z0-9]{36}\b/, /\bAKIA[0-9A-Z]{16}\b/,
    // A real key body, not a documentation placeholder like "MIIE...".
    /-----BEGIN [A-Z ]*PRIVATE KEY-----(\\n|\s)*[A-Za-z0-9+/=]{200,}/,
  ];
  const hits = [];
  let scanned = 0;
  for (const f of TRACKED.filter(served).filter((x) => /\.(html|js|json|css|txt|xml|md|webmanifest)$/.test(x))) {
    let s; try { s = read(f); } catch (_) { continue; }
    scanned += 1;
    for (const re of KEY) if (re.test(s)) hits.push(`${f}: ${re}`);
    // A Supabase service-role JWT (its payload says role service_role).
    for (const m of s.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
      try { if (/service_role/.test(Buffer.from(m[1], 'base64url').toString())) hits.push(`${f}: service-role JWT`); } catch (_) { /* not a JWT */ }
    }
  }
  expect(scanned, 'files scanned').toBeGreaterThan(300);
  expect(hits).toEqual([]);
  // The config route hands the browser the public anon key only (a server key never).
  expect(read('api/public-config.js')).not.toMatch(/anonKey\s*:\s*[^,\n]*SERVICE_ROLE/);
});

/* 4. HTTPS everywhere ─────────────────────────────────────────────────────── */
test('4. HTTPS is forced (HSTS on every path) and no page loads anything over plain http', () => {
  const all = (VERCEL.headers || []).find((h) => h.source === '/(.*)');
  const hsts = all && all.headers.find((h) => h.key === 'Strict-Transport-Security');
  expect(hsts && hsts.value).toMatch(/max-age=(\d+)/);
  expect(Number(/max-age=(\d+)/.exec(hsts.value)[1])).toBeGreaterThanOrEqual(31536000);
  const bad = [];
  for (const f of PAGES) {
    for (const m of read(f).matchAll(/<(script|img|iframe|link|source|video|audio)\b[^>]*\b(src|href)=["']http:\/\/(?!localhost|127\.0\.0\.1)[^"']+/gi)) bad.push(`${f}: ${m[0].slice(0, 90)}`);
  }
  expect(bad).toEqual([]);
});

/* 5, 19. Cookie consent, and analytics only after it ──────────────────────── */
test('5, 19. a cookie and storage notice; analytics and speed measurement load only after "Allow analytics", never on "Essential only" or under Global Privacy Control', async ({ browser }) => {
  const analyticsAsked = (reqs) => reqs.filter((u) => /\/_vercel\/(insights|speed-insights)\//.test(u));
  // First visit: the notice, and nothing measured yet.
  let ctx = await browser.newContext();
  let page = await ctx.newPage();
  let reqs = await open(page, 'index.html');
  const bar = page.locator('#lc-consent');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Allow analytics');
  await expect(bar.locator('a[href="/privacy.html#cookies"]')).toHaveCount(1);
  expect(analyticsAsked(reqs), 'nothing measured before a choice').toEqual([]);
  // Allow: both scripts load, the choice is kept, and the next page asks nothing.
  await bar.getByRole('button', { name: 'Allow analytics' }).click();
  await page.waitForTimeout(300);
  expect(analyticsAsked(reqs).length).toBe(2);
  await expect(bar).toHaveCount(0);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('lifecycle.consent.v1')));
  expect(kept).toMatchObject({ analytics: true });
  const page2 = await ctx.newPage();
  const reqs2 = await open(page2, 'privacy.html');
  await expect(page2.locator('#lc-consent')).toHaveCount(0);
  expect(analyticsAsked(reqs2).length, 'a kept "allow" measures every page').toBe(2);
  // The privacy page lets the choice be changed.
  await page2.locator('#consent-change').click();
  await expect(page2.locator('#lc-consent')).toBeVisible();
  await ctx.close();

  // Essential only: nothing measured, now or on the next page.
  ctx = await browser.newContext();
  page = await ctx.newPage();
  reqs = await open(page, 'onboarding.html');
  await page.locator('#lc-consent').getByRole('button', { name: 'Essential only' }).click();
  const p3 = await ctx.newPage();
  const reqs3 = await open(p3, 'index.html');
  expect(analyticsAsked(reqs.concat(reqs3))).toEqual([]);
  await expect(p3.locator('#lc-consent')).toHaveCount(0);
  await ctx.close();

  // Global Privacy Control: treated as essential only, without asking.
  ctx = await browser.newContext();
  page = await ctx.newPage();
  reqs = await open(page, 'index.html', { gpc: true });
  await expect(page.locator('#lc-consent')).toHaveCount(0);
  expect(analyticsAsked(reqs)).toEqual([]);
  await ctx.close();

  // No page loads either script by itself (outside the consent).
  for (const f of PAGES) expect(read(f), f).not.toMatch(/src="\/_vercel\/(insights|speed-insights)\//);
});

/* 6, 7, 8. Title, description, social preview image and favicon on every page */
test('6-8. every page has a title, a meta description (60-160 characters), a social preview image and a favicon', () => {
  const bad = [];
  for (const f of PAGES) {
    if (FROZEN.has(f)) continue;
    const h = head(f);
    const title = (/<title[^>]*>([^<]+)<\/title>/i.exec(h) || [])[1];
    const desc = (/<meta\s+name="description"\s+content="([^"]*)"/i.exec(h) || [])[1];
    if (!title || !title.trim()) bad.push(`${f}: no title`);
    if (!desc) bad.push(`${f}: no description`);
    else if (desc.length < 60 || desc.length > 160) bad.push(`${f}: description is ${desc.length} characters`);
    if (!/property="og:image"/.test(h)) bad.push(`${f}: no og:image`);
    if (!/rel="icon"/.test(h)) bad.push(`${f}: no favicon`);
  }
  expect(PAGES.length).toBeGreaterThan(60);
  expect(bad).toEqual([]);
  // A browser that asks for /favicon.ico gets the mark, not a 404.
  expect((VERCEL.redirects || []).some((r) => r.source === '/favicon.ico' && fs.existsSync(path.join(ROOT, r.destination)))).toBe(true);
});

/* 9. Sitemap and robots agree ──────────────────────────────────────────────── */
test('9. robots.txt names the sitemap, and every sitemap URL is a page robots.txt allows', () => {
  const robots = read('robots.txt');
  expect(robots).toMatch(/^Sitemap: https:\/\/\S+\/sitemap\.xml$/m);
  const allows = [...robots.matchAll(/^Allow: (\S+)$/gm)].map((m) => m[1]);
  const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  expect(locs.length).toBeGreaterThan(0);
  for (const p of locs) expect(allows.some((a) => (a.endsWith('$') ? p === a.slice(0, -1) : p.startsWith(a))), p).toBe(true);
});

/* 10. Alt text on every image ──────────────────────────────────────────────── */
test('10. every image in the page markup has alt text, and the main pages render none without it', async ({ page }) => {
  const bad = [];
  for (const f of PAGES) {
    for (const m of codeless(read(f)).matchAll(/<img\b[^>]*>/gi)) if (!/\balt=/i.test(m[0])) bad.push(`${f}: ${m[0].slice(0, 80)}`);
  }
  expect(bad).toEqual([]);
  for (const f of ['index.html', 'onboarding.html', 'smart-brain.html', 'assets.html', 'privacy.html', '404.html']) {
    await open(page, f);
    const missing = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.outerHTML.slice(0, 80)));
    expect(missing, f).toEqual([]);
  }
});

/* 11, 12. Small images, cached; a light public page ───────────────────────── */
test('11-12. every image a page uses is under 300 KB, /assets images are cached, and the public home page is light', () => {
  const big = [];
  const refs = new Set();
  for (const f of PAGES.concat(['auth.js'])) for (const m of read(f).matchAll(/(?:src|href)=["'](\/[^"'?#]+\.(?:png|jpe?g|webp|gif|svg))/g)) refs.add(m[1]);
  for (const r of refs) {
    const p = path.join(ROOT, r);
    if (fs.existsSync(p) && fs.statSync(p).size > 300 * 1024) big.push(`${r}: ${Math.round(fs.statSync(p).size / 1024)} KB`);
  }
  expect(refs.size).toBeGreaterThan(5);
  expect(big).toEqual([]);
  // An image nothing uses is not deployed.
  expect(served('image.png')).toBe(false);
  expect((VERCEL.headers || []).some((h) => /^\/assets\//.test(h.source) && h.headers.some((x) => x.key === 'Cache-Control' && /max-age=\d{4,}/.test(x.value)))).toBe(true);
  // The public page: small HTML, no render-blocking script.
  const home = read('index.html');
  expect(Buffer.byteLength(home)).toBeLessThan(60 * 1024);
  for (const m of home.matchAll(/<script\b[^>]*\bsrc=[^>]*>/gi)) expect(m[0], 'a script on the home page blocks rendering').toMatch(/\b(defer|async)\b/);
});

/* 15. A custom 404 ─────────────────────────────────────────────────────────── */
test('15. a custom 404 page: not indexed, wears the brand tokens, and leads home with one clear button', async ({ page }) => {
  const s = read('404.html');
  expect(s).toMatch(/<meta name="robots" content="noindex">/);
  // Nothing in vercel.json catches every path first (the 404 would never show).
  expect((VERCEL.rewrites || []).filter((r) => /^\/\(\.\*\)$|^\/:path\*$/.test(r.source))).toEqual([]);
  await open(page, '404.html');
  await expect(page.locator('h1')).toHaveText('This page does not exist');
  const home = page.locator('[data-404-home]');
  await expect(home).toHaveAttribute('href', '/');
  const box = await home.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
});

/* 16. No broken internal link ──────────────────────────────────────────────── */
test('16. every internal link on every page and in the menu reaches a file, a rewrite or a redirect', () => {
  const files = new Set(TRACKED.map((f) => '/' + f).concat(['/404.html']));
  const pat = (src) => new RegExp('^' + src.replace(/[.+^${}|[\]\\]/g, '\\$&').replace(/\\\(/g, '(').replace(/\(\.\*\)/g, '.*')
    .replace(/:[a-zA-Z_]+\*/g, '.*').replace(/:[a-zA-Z_]+(\([^)]*\))?/g, '[^/]+').replace(/\?/g, '\\?') + '/?$');
  const routes = [...(VERCEL.rewrites || []), ...(VERCEL.redirects || [])].filter((r) => !r.has).map((r) => { try { return pat(r.source); } catch (_) { return null; } }).filter(Boolean);
  const ok = (p) => p === '/' || files.has(p) || files.has(p + '.html') || routes.some((r) => r.test(p));
  const broken = [];
  let checked = 0;
  for (const f of PAGES.concat(['auth.js'])) {
    const s = read(f);
    for (const re of [/(?:href|src)\s*=\s*["'](\/[^"'#?\s<>{}$+]*)/g, /href\s*:\s*["'](\/[^"'#?\s]*)/g]) {
      for (const m of s.matchAll(re)) {
        const p = decodeURI(m[1]);
        // Vercel's own analytics paths, the /api/ routes (router specs) and the
        // /lp/ prefix a page appends a campaign id to are not files.
        if (p.startsWith('//') || p.startsWith('/api/') || p.startsWith('/_vercel/') || p === '/lp/') continue;
        checked += 1;
        if (!ok(p)) broken.push(`${f}: ${p}`);
      }
    }
  }
  expect(checked).toBeGreaterThan(500);
  expect([...new Set(broken)]).toEqual([]);
});

/* 17. Form validation ──────────────────────────────────────────────────────── */
test('17. fields are checked as the person leaves them, in words beside the field, and a form with a bad field is not sent', async ({ page }) => {
  await open(page, 'privacy.html');
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<form id="f" onsubmit="window.__sent=1;return false">'
      + '<input id="web" type="url"><input id="host" type="text" inputmode="url"><input id="mail" type="email">'
      + '<input id="num" type="number" min="0" max="3"><input id="need" required><input id="other"><button id="go">Send</button></form>');
  });
  const probe = (id, v) => page.evaluate(([i, x]) => { const el = document.getElementById(i); el.focus(); el.value = x; el.blur(); const m = el.getAttribute('data-lc-msg'); return { invalid: el.getAttribute('aria-invalid'), msg: m ? document.getElementById(m).textContent : '' }; }, [id, v]);
  expect(await probe('web', 'not a site')).toMatchObject({ invalid: 'true', msg: expect.stringContaining('web address') });
  expect(await probe('web', 'yourbrand.com')).toEqual({ invalid: null, msg: '' });            // a bare domain is fine; the app adds https
  expect(await probe('host', 'https://shop.yourbrand.co.uk/x?y=1')).toEqual({ invalid: null, msg: '' });
  expect(await probe('host', 'two words')).toMatchObject({ invalid: 'true' });
  expect(await probe('mail', 'name@')).toMatchObject({ invalid: 'true', msg: expect.stringContaining('email') });
  expect(await probe('mail', 'name@yourbrand.com')).toEqual({ invalid: null, msg: '' });
  expect(await probe('num', '7')).toMatchObject({ invalid: 'true', msg: 'Enter 3 or less.' });
  expect(await probe('other', 'anything')).toEqual({ invalid: null, msg: '' });
  // The field is described by its message for a screen reader.
  await probe('num', '9');
  const described = await page.evaluate(() => { const el = document.getElementById('num'); return document.getElementById(el.getAttribute('aria-describedby')).textContent; });
  expect(described).toBe('Enter 3 or less.');
  // Submit with an empty required field: not sent, focus on the field.
  await page.evaluate(() => { document.getElementById('num').value = '2'; document.getElementById('web').value = ''; document.getElementById('host').value = 'yourbrand.com'; });
  await page.click('#go');
  expect(await page.evaluate(() => window.__sent || 0)).toBe(0);
  expect(await page.evaluate(() => document.activeElement.id)).toBe('need');
  await page.fill('#need', 'yes');
  await page.click('#go');
  expect(await page.evaluate(() => window.__sent || 0)).toBe(1);
});

/* 18. Spam protection on the one form a stranger can send ─────────────────── */
test('18. the public website assistant turns away a filled honeypot and link spam before any database or model call', async () => {
  const embed = require(path.join(ROOT, 'api', '_shared', 'agent-embed.js'));
  embed._resetRate();
  const realFetch = global.fetch;
  const called = [];
  global.fetch = async (u) => { called.push(String(u)); throw new Error('no network in this test'); };
  const run = async (body, ip) => {
    const res = { code: 0, out: null, status(c) { this.code = c; return this; }, json(o) { this.out = o; return this; } };
    await embed.publicChat({ method: 'POST', headers: { 'x-forwarded-for': ip || '203.0.113.9' }, query: {} }, res, Object.assign({ workspace_id: 'ws1', agent_id: 'agent_brand' }, body), {});
    return res;
  };
  try {
    let r = await run({ message: 'What sizes do you have?', hp: 'http://spam.example' });
    expect(r.code).toBe(200);
    expect(r.out).toMatchObject({ ok: true, spam: true });
    r = await run({ message: 'buy http://a.example http://b.example http://c.example now' });
    expect(r.out).toMatchObject({ error: 'too_many_links' });
    expect(called, 'nothing was looked up for spam').toEqual([]);
    // A real question is not spam, and goes on to the brand lookup.
    expect(embed.spamReason({ message: 'Do you ship to Pune?' }, '198.51.100.7')).toBe('');
  } finally { global.fetch = realFetch; embed._resetRate(); }
  // The widget sends the honeypot field, and a person never sees it.
  const w = read('agent-widget.js');
  expect(w).toMatch(/id="vah-hp"[^']*tabindex="-1"[^']*aria-hidden="true"/);
  expect(w).toMatch(/hp: \(\(document\.getElementById\('vah-hp'\)/);
});

/* 20. One clear call to action ─────────────────────────────────────────────── */
test('20. the home page has exactly one primary call to action, visible on the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'index.html');
  const primary = page.locator('main .btn-primary, .cta .btn-primary');
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText(/Set up or choose a brand/);
  await expect(primary).toHaveAttribute('href', '/onboarding');
  const box = await primary.boundingBox();
  expect(box.y + box.height).toBeLessThan(800);
});
