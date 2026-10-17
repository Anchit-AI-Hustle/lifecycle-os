/**
 * A brand's own hashtags are typed on the Voice step, saved with the brand,
 * shown again, and carried by every social post.
 * ---------------------------------------------------------------------------
 * social-core.js brandTags() reads brand_data.hashtags (2026-10-17), and
 * nothing let an operator set them: every brand's fallback posts carried only
 * its name and product. The Voice step of /onboarding now has a Hashtags
 * field. What this file EXECUTES:
 *
 *   1. the wizard's normaliser equals social-core tagWord() over the same
 *      inputs (the page's own function in Chromium, the module in Node);
 *   2. the real page, signed out with the database unreachable (the device
 *      store): type hashtags, save, reload, and the device row's
 *      brand_data.hashtags holds them, marked as the person's, and the field
 *      shows them again;
 *   3. that SAVED row, handed to social-core runDaily with every model down:
 *      the posts carry those hashtags.
 *
 * Run: npx playwright test tests/brand-hashtags-field.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const SC = require.resolve(path.join(ROOT, 'api', '_shared', 'social-core.js'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const HOST = 'http://app.example.test';
const DEVICE_KEY = 'lifecycle.brand.device.workspaces';
const DEAD = { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } };
const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];

const NAME = 'Kettlemoor Brewing';
const TYPED = '#KraftHaus, small batch\n#krafthaus  BREW&co ##déjà';
const EXPECTED = ['KraftHaus', 'Small', 'Batch', 'BREWAndCo', 'Deja'];

/** The repo served as a real host, signed out, its database not answering. */
async function harness(page) {
  const log = { dialogs: [], errors: [], writes: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  page.on('request', (r) => { if (/action=brand&op=(save|activate)\b/.test(r.url())) log.writes.push(r.url()); });
  await page.addInitScript(() => {
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async () => ({ error: null }),
          signOut: async () => ({}),
        },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      }),
    };
  });
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    if (/\/auth\/v1\/health/.test(route.request().url())) return route.abort('addressunreachable');
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const u = route.request().url();
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
    });
  });
  await page.route(HOST + '/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action');
    const op = u.searchParams.get('op');
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (!action && !u.searchParams.has('health')) return json(DEAD);
    if (action === 'auth') return op === 'status' ? json({ ok: true, mode: 'device', reason: 'no_database_url', host: '' }) : json({ ok: true });
    if (action !== 'brand') return json({ ok: true });
    if (op === 'presets') return json({ ok: true, presets: [] });
    if (op === 'defaults') return json({ ok: true, brand: {} });
    return json({ ok: false, error: 'session_verification_unavailable', backend_unreachable: true, message: 'The database this deployment points at (paused-project.supabase.co) is not answering.' }, 503);
  });
  return log;
}

async function openWizard(page, query) {
  await page.goto(HOST + '/onboarding.html' + (query || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.storage && window.BrandContext.storage().known && window.BrandContext.loaded, null, { timeout: 20000 });
  await page.waitForTimeout(250);
}

const deviceRow = (page) => page.evaluate((k) => {
  const d = JSON.parse(localStorage.getItem(k) || 'null');
  return d && Array.isArray(d.workspaces) ? d.workspaces[0] || null : null;
}, DEVICE_KEY);

test('the wizard normalises hashtags by the same rule as social-core tagWord()', async ({ page }) => {
  const { tagWord } = require(SC);
  await harness(page);
  await openWizard(page);
  const tokens = ['KraftHaus', 'small', 'BREW&co', 'déjà', 'rock-n-roll', '2026', 'NYC', 'café crème', 'x'.repeat(31), 'ABC_def', 'ünïcödé'];
  const inPage = await page.evaluate((list) => list.map((t) => (window.__onboardingHashtags(t)[0] || '')), tokens);
  // tagWord answers one tag per input; the wizard splits on spaces first, so
  // inputs with a space are compared as the wizard would store each word.
  expect(inPage.length).toBe(tokens.length);
  tokens.forEach((t, i) => {
    if (/\s/.test(t)) return;
    expect(inPage[i], `"${t}"`).toBe(tagWord(t).replace(/^#/, ''));
  });
  const split = await page.evaluate(() => window.__onboardingHashtags('café crème'));
  expect(split).toEqual(['café', 'crème'].map((w) => tagWord(w).replace(/^#/, '')));
  expect(await page.evaluate((s) => window.__onboardingHashtags(s), TYPED)).toEqual(EXPECTED);
});

test('hashtags typed on the Voice step are saved to the device row, shown again after a reload, and carried by the social posts', async ({ page }) => {
  test.setTimeout(120_000);
  const log = await harness(page);
  await openWizard(page);
  expect(await page.evaluate(() => (window.LifecycleAuth.backend || {}).kind), 'the fixture never reached the unreachable state').toBe('unreachable');

  await page.fill('[data-path="name"]', NAME);
  await page.click('[data-go="next"]');
  await page.waitForSelector('input[type="text"][data-path="palette.primary"]');
  await page.click('[data-go="next"]');
  await page.waitForSelector('select[data-font-slot="heading"]');
  await page.click('[data-go="next"]');
  await page.waitForSelector('[data-hashtags]');
  await expect(page.locator('[data-hashtags-help]')).toHaveText('Used on social posts. Leave empty and posts use only your brand name and product.');
  await expect(page.locator('label[for="hashtagsInput"]')).toContainText('Hashtags');
  await page.fill('[data-hashtags]', TYPED);
  await page.locator('[data-hashtags]').blur();
  await expect(page.locator('[data-hashtags]')).toHaveValue(EXPECTED.map((h) => '#' + h).join(' '));
  await page.click('[data-go="next"]');
  await page.waitForSelector('#doImport');
  await page.click('[data-go="next"]');
  await page.waitForSelector('#saveDraft');
  await page.click('#saveDraft');
  await expect(page.locator('#toast')).toContainText(/saved as a draft on this device/i, { timeout: 8000 });

  let row = await deviceRow(page);
  expect(row, 'nothing was saved to the device store').not.toBeNull();
  expect(row.name).toBe(NAME);
  expect(row.brand_data && row.brand_data.hashtags, 'the hashtags were not saved').toEqual(EXPECTED);
  expect(row.brand_data.field_origin['brand_data.hashtags'], 'typing did not make the field the person\'s').toBe('user');
  expect(row.brand_data.field_origins['brand_data.hashtags'].origin).toBe('user');

  // Reload: the saved brand opens, and the field shows what was saved.
  await openWizard(page, '?step=6');
  await expect(page.locator('#title')).toHaveText('Edit ' + NAME);
  await page.click('.step-pip[data-step="4"]');
  await page.waitForSelector('[data-hashtags]');
  await expect(page.locator('[data-hashtags]')).toHaveValue(EXPECTED.map((h) => '#' + h).join(' '));
  row = await deviceRow(page);
  expect(row.brand_data.hashtags).toEqual(EXPECTED);

  expect(log.dialogs).toEqual([]);
  expect(log.writes, 'a brand write left for a server that is not there').toEqual([]);
  expect(log.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e))).toEqual([]);

  // The saved record, through social-core with every model down.
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  const realLlm = require.cache[LLM]; const realSc = require.cache[SC];
  const real = require(LLM);
  const down = async () => { throw new Error('ALL PROVIDERS FAILED'); };
  Object.assign(down, real);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: down };
  delete require.cache[SC];
  try {
    const out = await require(SC).runDaily({ brand: row, dry_run: true, date: '2026-10-20' });
    const posts = out.posts.filter((p) => p.key !== 'blog');
    expect(posts.length, 'no posts were built').toBeGreaterThan(5);
    const listed = EXPECTED.map((h) => '#' + h);
    const feed = out.posts.find((p) => p.key === 'instagram_feed');
    expect(feed.hashtags.slice(0, listed.length), 'the feed post does not lead with the brand\'s own hashtags').toEqual(listed);
    expect(feed.hashtags).toContain('#KettlemoorBrewing');
    for (const p of posts) {
      if (!(p.hashtags || []).length) continue;
      const first = p.key === 'youtube_shorts' ? p.hashtags[1] : p.hashtags[0];
      expect(first, `${p.key} does not carry the brand's first hashtag`).toBe(listed[0]);
    }
  } finally {
    require.cache[LLM] = realLlm; if (realSc) require.cache[SC] = realSc; else delete require.cache[SC];
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});
