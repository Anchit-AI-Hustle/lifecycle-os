/**
 * The asset design benchmarks are readable from /knowledge-base.
 * ---------------------------------------------------------------------------
 * WHY. knowledge/benchmarks/00-methodology.md ... 05-commerce-and-lifestyle-
 * brands.md (how other publications, market data services and stores build
 * their mailers, ads and landing pages) existed in the repository and no page
 * linked them, so the knowledge base never showed them (2026-10-17).
 *
 * WHAT IS EXECUTED HERE, in Chromium over the deployment's own rewrites:
 *   - /knowledge-base with a brand active on this device lists SIX benchmark
 *     links, titled by each file's own first heading;
 *   - every link is clicked and lands on the document viewer (brand-doc.html
 *     at /doc?md=...), which renders THAT file's heading and says it is
 *     research about other brands;
 *   - the document matching the brand's business model is marked "Matches
 *     your brand": the model is the one the shipped classifier
 *     (asset-playbooks.businessModel) gives the brand's own record, answered
 *     through the page's real request to /api/kb?action=asset-playbook;
 *   - a failed call, or an answer about another brand than the one active
 *     here, marks none and draws no failure frame;
 *   - the viewer refuses any other path under knowledge/.
 * No assertion reads a source file.
 *
 * Run: npx playwright test tests/kb-benchmark-docs.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const K = require(path.join(ROOT, 'brand-knowledge.js'));
const playbooks = require(path.join(ROOT, 'api', '_shared', 'asset-playbooks.js'));
const TOI = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'times-of-india.json'), 'utf8'));
const ET = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'economic-times.json'), 'utf8'));
const BARE = {
  slug: 'bare-fixture', name: 'Bare Fixture Co',
  palette: { primary: '#1F6F5C', accent: '#1F6F5C', ink: '#1A1A1A', surface: '#FFFFFF' },
  typography: {}, voice: {}, regions: [],
};

const BENCH_DIR = path.join(ROOT, 'knowledge', 'benchmarks');
const FILES = fs.readdirSync(BENCH_DIR).filter((f) => /\.md$/.test(f)).sort();
const HEADINGS = Object.fromEntries(FILES.map((f) => [f, ((fs.readFileSync(path.join(BENCH_DIR, f), 'utf8').match(/^#\s+(.+)$/m) || [])[1] || '').trim()]));

const HOST = 'http://app.example.test';
const ACCOUNT = 'dev-bench001';
const DEVICE_ID = 'local-bench000000001';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function rewrite(p) {
  for (const r of VERCEL.rewrites || []) {
    if (!r.source || !r.destination || r.destination.startsWith('/api/')) continue;
    const rx = new RegExp('^' + r.source.split(/(:[a-zA-Z]+\*?)/).map((s) => (s.startsWith(':') ? (s.endsWith('*') ? '.+' : '[^/]+') : esc(s))).join('') + '$');
    if (rx.test(p)) return r.destination.split('?')[0];
  }
  return p;
}
/** A path the deployment would not ship is not served here either. */
const IGNORED = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

/**
 * A phone sign-in kept on this device with `brand` active (production's
 * shape). `playbook` decides how /api/kb?action=asset-playbook answers:
 *   'own'   - the shipped classifier over the brand's own record;
 *   'other' - an answer about another brand;
 *   'fail'  - a 500.
 */
async function install(page, brand, playbook) {
  const ctx = page.context();
  const seed = Object.assign({}, brand, { id: DEVICE_ID, status: 'active', storage: 'device', owner_id: null });
  const calls = [];
  await ctx.addInitScript((a) => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) } }) };
    try {
      if (sessionStorage.getItem('__bench_seeded')) return;
      sessionStorage.setItem('__bench_seeded', '1');
      const expires = new Date(Date.now() + 80 * 86400000).toISOString();
      localStorage.setItem('lifecycle.auth.device.users', JSON.stringify({ '+919876543210': { id: a.account, phone: '+919876543210', cc: '+91', local: '9876543210', name: 'Bench', salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: expires, pinSetAt: expires } }));
      localStorage.setItem('lifecycle.auth.session', JSON.stringify({ token: 'DEVICEtokenFIXTURE0123456789abcdefghijklmnopq', mode: 'device', provider: 'mobile-pin', user: { id: a.account, name: 'Bench', phone: '+919876543210' }, expires, storage: { mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' } }));
      localStorage.setItem('lifecycle.brand.device.workspaces.' + a.account, JSON.stringify({ version: 1, active_id: a.seed.id, workspaces: [a.seed] }));
    } catch (_) {}
  }, { seed, account: ACCOUNT });
  const hostRx = new RegExp('^https?:\\/\\/(?!' + esc(new URL(HOST).host) + ')');
  await ctx.route(hostRx, (route) => {
    if (/\/auth\/v1\/health/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
  });
  await ctx.route(HOST + '/**', (route) => {
    const u = new URL(route.request().url());
    const p = rewrite(u.pathname === '/' ? '/index.html' : u.pathname);
    const rel = decodeURIComponent(p).replace(/^\//, '');
    const f = path.join(ROOT, rel);
    if (IGNORED.some((g) => rel === g || rel.startsWith(g.replace(/\/$/, '') + '/'))) return route.fulfill({ status: 404, body: 'not deployed' });
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  const generic = {
    ok: true, supabase: { url: 'https://live.supabase.co', anonKey: 'anon' },
    brand: null, workspaces: [], active_id: null, needs_onboarding: false,
    presets: [], products: [], entries: [], items: [], rows: [], campaigns: [], connections: [], providers: [], runs: [], packs: [], brands: [],
  };
  await ctx.route(/\/api\//, (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/kb' && u.searchParams.get('action') === 'asset-playbook') {
      calls.push(u.search);
      if (playbook === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'boom' }) });
      const subject = playbook === 'other' ? TOI : brand;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand: subject.name, businessModel: playbooks.businessModel(subject), assetType: 'mailer', market: 'Global' }) });
    }
    if (u.searchParams.get('action') === 'auth') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(generic) });
  });
  return calls;
}

async function openKb(page, brand) {
  await page.goto(HOST + '/knowledge-base');
  await page.waitForFunction((n) => !!(window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.name === n), brand.name, { timeout: 20_000 });
}
const LINKS = '[data-kb-benchmarks] a[href]';

test('the knowledge base lists the six benchmark documents, and each opens in the viewer at its own heading', async ({ page }) => {
  test.setTimeout(120_000);
  expect(FILES.length).toBe(6);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  await install(page, TOI, 'own');
  await openKb(page, TOI);
  const section = page.locator('[data-kb-benchmarks]');
  await expect(section).toBeVisible();
  // Research about others, never this brand's facts, and it says so.
  await expect(section).toContainText('describe how other publications and stores build assets');
  await expect(section).toContainText('only what your brand states');

  const links = await page.locator(LINKS).evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href'), text: a.textContent })));
  expect(links).toHaveLength(6);
  for (const [i, f] of FILES.entries()) {
    const target = new URL(links[i].href, HOST);
    expect(target.pathname).toBe('/doc');
    expect(target.searchParams.get('md')).toBe('/knowledge/benchmarks/' + f);
    expect(links[i].text, f).toContain(HEADINGS[f]);
  }

  for (const [i, f] of FILES.entries()) {
    if (i) await openKb(page, TOI);
    await Promise.all([page.waitForURL(/\/doc\?md=/), page.locator(LINKS).nth(i).click()]);
    await page.waitForFunction(() => { const m = document.getElementById('kd-main'); return m && m.getAttribute('aria-busy') === 'false'; }, null, { timeout: 25_000 });
    await expect(page.locator('#kd-title'), f).toHaveText(HEADINGS[f]);
    expect((await page.locator('#kd-body').innerText()).length, f).toBeGreaterThan(400);
    await expect(page.locator('#kd-eyebrow')).toHaveText('Asset design benchmark');
    await expect(page.locator('#kd-meta')).toContainText('other publications and stores');
    await expect(page.locator('#kd-meta')).toContainText('only what your brand states');
  }
  expect(errors).toEqual([]);
});

for (const c of [
  { brand: TOI, file: '04-information-and-market-data-brands.md', label: 'a news brand' },
  { brand: ET, file: '04-information-and-market-data-brands.md', label: 'a market data brand' },
  { brand: BARE, file: '05-commerce-and-lifestyle-brands.md', label: 'a brand with no stated model (commerce)' },
]) {
  test(`${c.label} sees ${c.file} marked as matching`, async ({ page }) => {
    test.setTimeout(60_000);
    const calls = await install(page, c.brand, 'own');
    await openKb(page, c.brand);
    const marked = page.locator('[data-kb-benchmarks] a[data-match]');
    await expect(marked).toHaveCount(1, { timeout: 15_000 });
    expect(new URL(await marked.getAttribute('href'), HOST).searchParams.get('md')).toBe('/knowledge/benchmarks/' + c.file);
    await expect(marked).toContainText('Matches your brand');
    expect(calls.length).toBeGreaterThan(0);
  });
}

for (const mode of ['fail', 'other']) {
  test(`an asset-playbook answer that ${mode === 'fail' ? 'fails' : 'is about another brand'} marks none and shows no failure`, async ({ page }) => {
    test.setTimeout(60_000);
    const calls = await install(page, BARE, mode);
    await openKb(page, BARE);
    await expect.poll(() => calls.length, { message: 'the page asked for the playbook' }).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    await expect(page.locator(LINKS)).toHaveCount(6);
    await expect(page.locator('[data-kb-benchmarks] [data-match]')).toHaveCount(0);
    await expect(page.locator('[data-kb-benchmarks] .vh-failure')).toHaveCount(0);
    expect(await page.locator('[data-kb-benchmarks]').innerText()).not.toContain('Matches your brand');
  });
}

test('the viewer opens the benchmarks folder by path and nothing else under knowledge/', () => {
  for (const f of FILES) expect(K.docFromPath('/doc', '?md=' + encodeURIComponent('/knowledge/benchmarks/' + f)), f).toEqual({ mode: 'md', value: '/knowledge/benchmarks/' + f });
  for (const bad of [
    '/knowledge/brand/01-brand-foundation.md',
    '/knowledge/benchmarks/../brand/01-brand-foundation.md',
    '/knowledge/benchmarks/sub/x.md',
    '/knowledge/benchmarks//x.md',
    '/knowledge/retention/x.md',
    'https://evil.example/knowledge/benchmarks/x.md',
  ]) expect(K.docFromPath('/doc', '?md=' + encodeURIComponent(bad)).mode, bad).toBe('unknown');
});
