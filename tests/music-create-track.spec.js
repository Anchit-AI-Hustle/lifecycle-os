/**
 * /music can MAKE a track for the active brand (2026-10-14).
 *
 * The operator, on production /music with Lenskart active: the page showed only
 * the "brand music beds is not on the record" marker - "option to create is
 * also missing - can redirect to suno or integrate suno is better". Suno has
 * no public API (an invite-only partner programme, July 2026), so the page
 * offers both honest routes:
 *   - Generate here: the documented ElevenLabs Music endpoint behind
 *     /api/brain?action=music-compose (metered at audio.music);
 *   - Open in Suno: the brief is copied and suno.com/create opens.
 * The brief is written from the ACTIVE brand's record (name, industry,
 * tagline, voice tone, home market) and is editable.
 *
 * EXECUTED in Chromium on the shipped page with a device brand: the brief names
 * this brand and nobody else; Suno opens with the brief on the clipboard; on a
 * deployment that can run it, Generate posts the edited brief and plays the
 * audio that comes back; with no key the server's sentence is shown; signed
 * out against a paused backend nothing is sent and the reason is said.
 *
 * Run: npx playwright test tests/music-create-track.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const DEVICE_KEY = 'lifecycle.brand.device.workspaces';
const BRAND = {
  id: 'local-lensbrand01', slug: 'lensbrand', name: 'Lensbrand', status: 'active', onboarding_step: 6,
  tagline: 'Eyewear for every face', industry: 'Eyewear retail', website: 'https://lensbrand.example',
  palette: { primary: '#1D3A8A', accent: '#16A3A3', ink: '#14161C', surface: '#FFFFFF', surface_alt: '#F3F6FB' },
  typography: { heading: { family: 'Inter', stack: "'Inter',system-ui,sans-serif", google: true }, body: { family: 'Inter', stack: "'Inter',system-ui,sans-serif", google: true } },
  voice: { tone: 'clear, friendly and modern', preferred: [], banned: [], no_em_dashes: true, notes: '' },
  regions: [{ code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://lensbrand.example', home: true }],
  asset_hosts: [], brand_data: {}, owner_id: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', storage: 'device',
};

async function harness(page, host, opts) {
  const o = opts || {};
  const log = { compose: [], errors: [], popups: [] };
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.addInitScript((s) => {
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ error: null }), signOut: async () => ({}),
    } }) };
    localStorage.setItem(s.key, JSON.stringify({ version: 1, active_id: s.brand.id, workspaces: [s.brand] }));
    window.__copied = [];
    try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(String(t)); } } }); } catch (_) {}
    window.__opened = [];
    window.open = function (u) { window.__opened.push(String(u)); return {}; };
  }, { key: DEVICE_KEY, brand: BRAND });
  await page.route(/^https?:\/\//, (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin === host) {
      if (u.pathname.startsWith('/api/')) {
        const action = u.searchParams.get('action');
        const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
        if (action === 'music-compose') {
          log.compose.push(JSON.parse(req.postData() || '{}'));
          if (o.noKey) return json({ ok: false, error: 'music_unconfigured', message: 'Generating a track here needs ELEVENLABS_API_KEY set on this deployment. Until then, use Open in Suno: the brief is copied for you.' }, 501);
          return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('ID3fakemusic') });
        }
        if (!action && !u.searchParams.has('health')) return json(o.dead ? { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } } : {});
        if (action === 'auth') return json({ ok: true, mode: 'google', pin_signin: false });
        // The localhost preview asks the server (the device store serves only
        // the no-session states); a paused backend refuses as production does.
        if (action === 'brand' && !o.dead) {
          const op = u.searchParams.get('op');
          if (op === 'presets') return json({ ok: true, presets: [] });
          if (op === 'defaults') return json({ ok: true, brand: {} });
          return json({ ok: true, brand: BRAND, workspaces: [BRAND], active_id: BRAND.id });
        }
        if (action === 'brand') return json({ ok: false, error: 'session_verification_unavailable', backend_unreachable: true, message: 'not answering' }, 503);
        return json({ ok: true });
      }
      const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\//, ''));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    if (/\/auth\/v1\/health/.test(u.href)) return route.abort('addressunreachable');
    if (req.resourceType() !== 'script') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
  });
  await page.goto(host + '/music.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((id) => window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.id === id, BRAND.id, { timeout: 20000 });
  return log;
}

test('the brief is the active brand\'s, and Open in Suno copies it and opens Suno\'s Create page', async ({ page }) => {
  const log = await harness(page, 'http://localhost:4977', {});
  await expect(page.locator('[data-mk-brand]')).toHaveText('Lensbrand');
  const brief = page.locator('#mkPrompt');
  await expect(brief).toHaveValue(/For the brand Lensbrand/);
  const v = await brief.inputValue();
  expect(v).toMatch(/clear, friendly and modern/);
  expect(v).toMatch(/Eyewear for every face/);
  expect(v).toMatch(/Home market: IN/);
  expect(v).toMatch(/Instrumental only/);
  expect(v, 'another brand leaked into the brief').not.toMatch(/KNICKGASM|sneaker/i);
  expect(v).not.toMatch(/[–—]/);
  // The tenant-zero beds are still gated for this brand.
  await expect(page.locator('[data-track]')).toHaveCount(0);

  await page.selectOption('#mkUse', 'jingle');
  await expect(page.locator('#mkInstr')).not.toBeChecked();
  await expect(page.locator('#mkSecs')).toHaveValue('30');
  await expect(brief).toHaveValue(/sung hook/);
  await brief.fill('My own edited brief for an eyewear jingle');
  await page.click('#mkSuno');
  await expect(page.locator('#mkStatus')).toContainText('paste it into the Style box');
  expect(await page.evaluate(() => window.__opened)).toEqual(['https://suno.com/create']);
  expect(await page.evaluate(() => window.__copied)).toEqual(['My own edited brief for an eyewear jingle']);
  expect(log.compose).toEqual([]);
  expect(log.errors).toEqual([]);
});

test('Generate here sends the edited brief once and plays the track that comes back', async ({ page }) => {
  const log = await harness(page, 'http://localhost:4977', {});
  await page.fill('#mkSecs', '15');
  await page.locator('#mkPrompt').fill('Short confident ad bed');
  await page.click('#mkGenerate');
  await expect(page.locator('[data-made-track] audio')).toHaveCount(1);
  expect(log.compose).toEqual([{ prompt: 'Short confident ad bed', seconds: 15, instrumental: true }]);
  const src = await page.locator('[data-made-track] audio').getAttribute('src');
  expect(src).toMatch(/^blob:/);
  await expect(page.locator('[data-made-track] a[download]')).toHaveAttribute('download', 'lensbrand-track.mp3');
  await expect(page.locator('#mkStatus')).toContainText('Done');
  expect(log.errors).toEqual([]);
});

test('with no music key the server\'s own sentence is shown, naming what to set and the Suno route', async ({ page }) => {
  const log = await harness(page, 'http://localhost:4977', { noKey: true });
  await page.click('#mkGenerate');
  await expect(page.locator('#mkStatus')).toContainText('ELEVENLABS_API_KEY');
  await expect(page.locator('#mkStatus')).toContainText('Open in Suno');
  expect(log.compose).toHaveLength(1);
  await expect(page.locator('[data-made-track]')).toHaveCount(0);
});

test('signed out against a paused backend nothing is sent, and the page says why', async ({ page }) => {
  const log = await harness(page, 'http://app.example.test', { dead: true });
  await page.click('#mkGenerate');
  await expect(page.locator('#mkStatus')).not.toBeEmpty();
  await page.waitForTimeout(400);
  expect(log.compose, 'a metered request left a signed-out page').toEqual([]);
  // Suno still works signed out: it needs nothing from this server.
  await page.click('#mkSuno');
  expect(await page.evaluate(() => window.__opened)).toEqual(['https://suno.com/create']);
});
