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
          if (o.synth) {
            // What the shipped route answers with free generation on: the same
            // music-synth.js, composed server-side as a compact WAV.
            const body = JSON.parse(req.postData() || '{}');
            const out = require(path.join(ROOT, 'music-synth.js')).renderBytes(String(body.prompt || ''), Number(body.seconds) || 30, { compact: true });
            return route.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.from(out.bytes) });
          }
          if (o.job) return json({ ok: true, pending: true, job: 'platform:pjob123', provider: 'replicate', model: 'lucataco/ace-step', quality: 'studio', sung: '[chorus]\nLensbrand', message: '' }, 202);
          return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('ID3fakemusic') });
        }
        if (action === 'music-job') {
          log.jobs = (log.jobs || 0) + 1;
          if (u.searchParams.get('id') !== 'platform:pjob123') return json({ ok: false, error: 'job_invalid' }, 400);
          if (log.jobs < 2) return json({ ok: true, pending: true, status: 'processing' }, 202);
          return route.fulfill({ status: 200, contentType: 'audio/mpeg', headers: { 'X-Music-Provider': 'replicate', 'X-Music-Quality': 'studio', 'Access-Control-Expose-Headers': 'X-Music-Provider, X-Music-Quality' }, body: Buffer.from('ID3sungsong') });
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
  const audioSrc = await page.locator('[data-made-track] audio').getAttribute('src');
  expect(audioSrc).toMatch(/^blob:/);
  await expect(page.locator('[data-made-track] a[download]')).toHaveAttribute('download', 'lensbrand-track.mp3');
  await expect(page.locator('#mkStatus')).toContainText('Done');
  expect(log.errors).toEqual([]);
});

// Everything is charged (2026-10-17, the operator: "everything will cost the
// user credits - but it should be done for free in the backend"): the page has
// ONE way to make a track, the metered route, and the server composes it. The
// in-browser "Generate here, free" button and its uncharged fallback are gone.
test('with no music key and free generation off, the server\'s sentence is shown and nothing is made on the page', async ({ page }) => {
  const log = await harness(page, 'http://localhost:4977', { noKey: true });
  await page.fill('#mkSecs', '15');
  await page.click('#mkGenerate');
  await expect(page.locator('#mkStatus')).toContainText('ELEVENLABS_API_KEY');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-made-track]')).toHaveCount(0);
  expect(log.compose).toHaveLength(1);
  expect(log.errors).toEqual([]);
});

/** Reads the blob behind the made track in the page and decodes its WAV header and samples. */
async function readMade(page, index) {
  return page.evaluate(async (i) => {
    const audios = document.querySelectorAll('[data-made-track] audio');
    const src = audios[i].getAttribute('src');
    const buf = await (await fetch(src)).arrayBuffer();
    const v = new DataView(buf);
    const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const dataBytes = v.getUint32(40, true);
    let peak = 0;
    for (let o = 44; o < 44 + dataBytes; o += 2) { const x = Math.abs(v.getInt16(o, true)); if (x > peak) peak = x; }
    return { src, riff: tag(0), wave: tag(8), channels: v.getUint16(22, true), rate: v.getUint32(24, true), dataBytes, peak };
  }, index);
}

for (const width of [390, 1280]) {
  test(`at ${width}px Generate here (metered) plays the WAV the server composed; the page has no uncharged generator`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    const log = await harness(page, 'http://localhost:4977', { synth: true });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#mkFree'), 'an uncharged generator is still on the page').toHaveCount(0);
    expect(await page.evaluate(() => typeof window.MusicSynth), 'the page loads a generator that bypasses credits').toBe('undefined');
    await expect(page.locator('#mkGenerate')).toHaveAttribute('data-credit-feature', 'audio.music');
    await expect(page.locator('body')).not.toContainText(/no credits|for free|, free\b/i);
    await page.fill('#mkSecs', '15');
    await page.locator('#mkPrompt').fill('Calm minimal underscore at 84 BPM for an eyewear film');
    await page.click('#mkGenerate');
    await expect(page.locator('[data-made-track] audio')).toHaveCount(1, { timeout: 30000 });
    const a = await readMade(page, 0);
    expect([a.riff, a.wave]).toEqual(['RIFF', 'WAVE']);
    expect(a.channels).toBe(1); expect(a.rate).toBe(22050);
    expect(a.dataBytes).toBe(15 * 22050 * 2);
    expect(a.peak, 'the track is silent').toBeGreaterThan(20000);
    await expect(page.locator('[data-made-track] a[download]').first()).toHaveAttribute('download', 'lensbrand-track.wav');
    expect(log.compose).toEqual([{ prompt: 'Calm minimal underscore at 84 BPM for an eyewear film', seconds: 15, instrumental: true }]);
    expect(log.errors).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(0);
  });
}

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

// A Replicate song still rendering (2026-10-25): the route answers 202 with a
// job, the page says it is still being made, polls ?action=music-job and plays
// the track when it lands, labelled with what made it and what it sang.
test('a track still rendering is polled until it lands, then plays with what made it and what it sang', async ({ page }) => {
  test.setTimeout(60_000);
  const log = await harness(page, 'http://localhost:4977', { job: true });
  await page.fill('#mkSecs', '20');
  await page.locator('#mkPrompt').fill('A sung jingle for Lensbrand');
  await page.click('#mkGenerate');
  await expect(page.locator('#mkStatus')).toContainText('still being made');
  await expect(page.locator('[data-made-track] audio')).toHaveCount(1, { timeout: 30_000 });
  expect(log.jobs).toBe(2);
  expect(log.compose).toHaveLength(1);
  await expect(page.locator('[data-made-track]')).toContainText('Composed on Replicate');
  await expect(page.locator('[data-made-track] details pre')).toHaveText('[chorus]\nLensbrand');
  const bytes = await page.evaluate(async () => { const src = document.querySelector('[data-made-track] audio').getAttribute('src'); return new TextDecoder().decode(await (await fetch(src)).arrayBuffer()); });
  expect(bytes).toBe('ID3sungsong');
  expect(log.errors).toEqual([]);
});
