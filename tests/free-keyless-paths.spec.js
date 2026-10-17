// @ts-check
/**
 * Every feature works with NO API key, on a free keyless or code-only path
 * (2026-10-17). Four places still assumed a key, each driven here as shipped:
 *
 *   1. The Studio's design-to-HTML path POSTed the uploaded image to
 *      api.anthropic.com straight from the browser with no key, so it always
 *      failed. It now asks the app's own /api/ai/generate (mode mailer_full),
 *      whose cascade ends on the free keyless model; the template stays the
 *      fallback.
 *   2. The pipeline's images stage is covered in pipeline-executed.spec.js
 *      (the shared cascade, URLs not base64, FREE_GENERATION=off).
 *   3. TeleSuite transcription answers 503 with no audio key: the page now
 *      offers live transcription in the browser (its own SpeechRecognition),
 *      which fills the transcript box; a browser without it gets one sentence.
 *   4. The connections pages said "Not connected" for every AI card with no
 *      mention that generation works: a line says the free models are on (and
 *      only when they are), and ?health names the free text model.
 *
 * FREE_GENERATION is 'off' for every test (tests/playwright.config.js); a case
 * that needs it on sets it and puts it back.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const F = require('./lib/brand-invariant-fixtures');
const BT = require('./lib/brand-theme-harness');
const B = F.QUILL;
BT.define('free-quill', { name: B.name, slug: B.slug, palette: B.palette || {}, typography: B.typography || {}, regions: B.regions || [], record: F.recordOf(B) });

function withFree(value, fn) {
  const saved = process.env.FREE_GENERATION;
  process.env.FREE_GENERATION = value;
  const undo = () => { if (saved === undefined) delete process.env.FREE_GENERATION; else process.env.FREE_GENERATION = saved; };
  let out;
  try { out = fn(); } catch (e) { undo(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(undo);
  undo();
  return out;
}

/* ── a localhost preview: auth.js lets the server judge, so a page sends ─── */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) { server.closeAllConnections && server.closeAllConnections(); await new Promise((r) => server.close(r)); } });

async function openLocal(page, file, api) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}),
    }, from: () => { const b = {}; ['select', 'eq', 'order', 'limit'].forEach((k) => { b[k] = () => b; }); b.maybeSingle = async () => ({ data: null, error: null }); b.then = (r) => Promise.resolve({ data: [], error: null }).then(r); return b; } }) };
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
  });
  await page.route(/\/api\//, (route) => {
    const u = new URL(route.request().url());
    const ans = api(u, route.request());
    if (ans) return route.fulfill({ status: ans.status || 200, contentType: 'application/json', body: JSON.stringify(ans.body) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.goto(base + '/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind === 'local', null, { timeout: 15000 });
  return errors;
}

/* ═══ 1. the Studio: design -> HTML goes through /api/ai/generate ═════════ */

const SPEC = {
  variant_a: {
    sections: [
      { id: 's1', type: 'hero', copy: { eyebrow: 'Weekend edition', headline: 'The weekend edition is back', subcopy: 'Long reads for a slow Sunday.', cta: 'Read the weekend edition' }, image_slot: 'hero' },
      { id: 's2', type: 'feature', copy: { headline: 'Why it matters', subcopy: 'The stories the week did not have room for.', cta: 'Start reading' }, image_slot: 'none' },
    ],
    subject_lines: ['The weekend edition is back'], preheader: 'Long reads for a slow Sunday.',
    copy_framework: { cta_verb: 'Read' },
  },
};

test('the Studio writes a design reference into an email through /api/ai/generate, never a provider; a refusal keeps the template', async ({ page }) => {
  test.setTimeout(120_000);
  await BT.install(page, 'free-quill');
  const provider = [];
  const asked = [];
  let answer = { status: 200, body: { ok: true, mode: 'mailer_full', provider: 'pollinations', model: 'openai', data: SPEC } };
  await page.route(/api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com/, (route) => { provider.push(route.request().url()); return route.abort('failed'); });
  await page.route(/\/api\/ai\/generate/, (route) => {
    asked.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
  });
  await BT.open(page, 'studio', 'free-quill');
  await page.waitForFunction(() => typeof window.analyzeImageAndBuildEmail === 'function', null, { timeout: 20_000 });

  const prod = B.catalogue[0];
  const run = () => page.evaluate(async (p) => {
    const prods = [{ n: p.title, i: p.image, p: p.price }];
    return window.analyzeImageAndBuildEmail('data:image/png;base64,iVBORw0KGgoAAAA', prods, 'Bring lapsed readers back with the weekend edition', window.RegionContext && window.RegionContext.home);
  }, prod);

  const email = await run();
  expect(provider, 'the page called a model provider directly').toEqual([]);
  expect(asked.length).toBe(1);
  expect(asked[0].mode).toBe('mailer_full');
  expect(asked[0].campaign_brief).toMatch(/weekend edition/);
  expect(asked[0].selected_products[0].name).toBe(prod.title);
  expect(asked[0].markets.length).toBe(1);
  // No image bytes leave for a route that reads text only.
  expect(JSON.stringify(asked[0])).not.toMatch(/base64/);
  expect(email).toMatch(/^<!DOCTYPE html>/);
  expect(email).toContain('The weekend edition is back');
  expect(email).toContain('Read the weekend edition');
  expect(email).toContain(prod.image);
  expect(email).toContain(B.name);
  expect(email).not.toMatch(/data:image\/[a-z]+;base64/);
  const status = await page.locator('#analyzeStatus').textContent();
  expect(status).toMatch(/pollinations/);

  // The route refuses: the caller keeps the built-in template (null), said once.
  answer = { status: 503, body: { ok: false, error: 'all_providers_failed', message: 'No model answered.' } };
  const fell = await run();
  expect(fell).toBeNull();
  expect(await page.locator('#analyzeStatus').textContent()).toMatch(/template/);
  expect(provider).toEqual([]);
});

/* ═══ 3. TeleSuite: no audio key, transcribe live in the browser ═════════ */

const TS = require(path.join(ROOT, 'api/_shared/telesuite-core.js'));

async function transcriptionRefusal() {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await TS.OPS.transcription({}, { audio: { name: 'call.mp3', mime: 'audio/mpeg', data: 'AAAA' } });
    throw new Error('transcription ran with no key');
  } catch (e) {
    if (/ran with no key/.test(e.message)) throw e;
    return e;
  } finally { if (saved !== undefined) process.env.GEMINI_API_KEY = saved; }
}

function telesuiteApi(refusal, runs) {
  return (u, req) => {
    if (/\/api\/public-config$/.test(u.pathname) && !u.searchParams.get('action')) return { body: { ok: true } };
    if (u.searchParams.get('action') !== 'telesuite') return null;
    const op = u.searchParams.get('op');
    if (op === 'registry') return { body: { ok: true, subfeatures: TS.SUBFEATURES, groups: [...new Set(TS.SUBFEATURES.map((s) => s.group))], prices: [] } };
    if (op === 'transcription') {
      const body = JSON.parse(req.postData() || '{}');
      runs.push(body.input || {});
      const pasted = String((body.input || {}).transcript || '').trim();
      if (pasted) return { body: { ok: true, run_id: 'r1', result: { transcript: pasted, source: 'pasted' }, provider: 'none' } };
      // The router's own shape for a thrown refusal (telesuite-core handle()).
      return { status: refusal.status, body: { ok: false, error: refusal.message, code: refusal.code } };
    }
    return null;
  };
}

for (const vp of [{ w: 390, h: 844 }, { w: 1280, h: 900 }]) {
  test(`TeleSuite at ${vp.w}px: with no audio key the page offers live transcription in the browser and fills the transcript box`, async ({ page }) => {
    test.setTimeout(90_000);
    const refusal = await transcriptionRefusal();
    expect(refusal.status).toBe(503);
    expect(refusal.code).toBe('transcription_unavailable');
    expect(refusal.message).toMatch(/Transcribe live in the browser \(free\)/);

    await page.setViewportSize({ width: vp.w, height: vp.h });
    // The browser's speech recognition, scripted: two final phrases, then the end.
    await page.addInitScript(() => {
      window.__srStarted = 0;
      function FakeSR() { this.continuous = false; this.interimResults = false; this.lang = ''; }
      FakeSR.prototype.start = function () {
        const self = this; window.__srStarted++; window.__srLang = self.lang; window.__srContinuous = self.continuous;
        const res = (t) => { const r = [{ transcript: t }]; r.isFinal = true; return r; };
        setTimeout(() => self.onresult && self.onresult({ resultIndex: 0, results: [res('Agent: Hello, thanks for calling.')] }), 50);
        setTimeout(() => self.onresult && self.onresult({ resultIndex: 1, results: [res('x'), res('Customer: I want to renew my plan.')] }), 100);
        setTimeout(() => self.onend && self.onend(), 160);
      };
      FakeSR.prototype.stop = function () { if (this.onend) setTimeout(() => this.onend(), 0); };
      Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeSR });
      Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: FakeSR });
    });
    const runs = [];
    const errors = await openLocal(page, 'telesuite.html#transcription', telesuiteApi(refusal, runs));
    await page.waitForSelector('#run', { timeout: 20_000 });
    // An audio file attached, the server cannot transcribe it.
    await page.setInputFiles('input[data-f="audio"]', { name: 'call.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3fakeaudio') });
    await page.click('#run');
    const offer = page.locator('#outDictate [data-dictate]');
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await expect(offer).toHaveText('Transcribe live in the browser (free)');
    await expect(page.locator('#out')).toContainText('cannot transcribe an audio file');
    await expect(page.locator('#out [data-failure]')).toHaveCount(0);

    await offer.click();
    const box = page.locator('#form textarea[data-f="transcript"]');
    await expect(box).toHaveValue('Agent: Hello, thanks for calling.\nCustomer: I want to renew my plan.', { timeout: 5000 });
    expect(await page.evaluate(() => [window.__srStarted, window.__srContinuous])).toEqual([1, true]);
    await expect(page.locator('#outDictate [data-dictate-status]')).toContainText('press Run');

    // The free path: the pasted transcript runs and costs nothing.
    await page.setInputFiles('input[data-f="audio"]', []);
    await page.click('#run');
    await expect(page.locator('#out .transcript')).toContainText('I want to renew my plan', { timeout: 10_000 });
    expect(runs[runs.length - 1].transcript).toMatch(/renew my plan/);

    // The form offers it too, before any refusal.
    await expect(page.locator('#formDictate [data-dictate]')).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, 'the page scrolls sideways').toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

test('TeleSuite in a browser with no speech recognition says to paste the transcript, in one sentence', async ({ page }) => {
  test.setTimeout(90_000);
  const refusal = await transcriptionRefusal();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined });
  });
  const runs = [];
  const errors = await openLocal(page, 'telesuite.html#transcription', telesuiteApi(refusal, runs));
  await page.waitForSelector('#run', { timeout: 20_000 });
  await page.setInputFiles('input[data-f="audio"]', { name: 'call.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3fakeaudio') });
  await page.click('#run');
  await expect(page.locator('#outDictate')).toContainText('no built-in speech recognition', { timeout: 15_000 });
  await expect(page.locator('#outDictate')).toContainText('Paste the transcript');
  await expect(page.locator('[data-dictate]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

/* ═══ 4. the connections pages and ?health say the free models are on ════ */

const WC = require(path.join(ROOT, 'api/_shared/workspace-connections-core.js'));

function listAnswer() {
  return { ok: true, workspace_id: 'ws-1', connections: [], routing: { entries: [], use_platform_fallback: true },
    providers: WC.registryView(true), free_generation: WC.freeGenerationView(true), secrets_storage: { encrypted: true, store: true } };
}

for (const file of ['brand-connections.html', 'connectors.html']) {
  test(`${file}: the free-models line shows only when FREE_GENERATION is on, and marks no AI card connected`, async ({ page }) => {
    test.setTimeout(90_000);
    for (const free of ['on', 'off']) {
      const answer = withFree(free, listAnswer);
      expect(answer.free_generation.on).toBe(free === 'on');
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await openLocal(page, file, (u) => {
        if (/\/api\/public-config$/.test(u.pathname) && !u.searchParams.get('action')) return { body: { ok: true } };
        if (u.searchParams.get('action') === 'connections') {
          const op = u.searchParams.get('op');
          if (op === 'list') return { body: answer };
          if (op === 'registry') return { body: { ok: true, providers: WC.registryView(false), categories: ['ai'] } };
        }
        if (u.searchParams.get('action') === 'os-connectors') return { body: { ok: true, connectors: [], summary: {} } };
        return null;
      });
      const line = page.locator('[data-free-generation]');
      if (free === 'on') {
        await expect(line).toHaveCount(1, { timeout: 15_000 });
        await expect(line).toContainText('free keyless models');
        await expect(line).toContainText('one request per 30 seconds');
        await expect(line).toContainText('connects no provider');
        // No AI card claims a connection it does not have.
        const ai = file === 'connectors.html' ? '#ai-providers' : '#platforms';
        await expect(page.locator(ai)).not.toContainText('Connected');
      } else {
        await page.waitForTimeout(1500);
        await expect(line).toHaveCount(0);
      }
    }
  });
}

test('the connections registry (public) carries no free-model state; ?health names the free text model only when it is on', async () => {
  expect(WC.freeGenerationView(false)).toBeNull();
  const KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'CRON_SECRET'];
  const saved = {}; for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.CRON_SECRET = 'cron-free-test-secret';
  try {
    const handler = require(path.join(ROOT, 'api/public-config.js'));
    const health = async () => {
      const res = { statusCode: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, removeHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
      await handler({ method: 'GET', url: '/api/public-config?health=1', query: { health: '1' }, headers: { authorization: 'Bearer cron-free-test-secret' }, body: null }, res);
      return res;
    };
    const on = await withFree('on', health);
    expect(on.statusCode).toBe(200);
    expect(on.body.providers.text.active).toBe('pollinations (free)');
    expect(on.body.providers.text.free_generation).toBe(true);
    const off = await withFree('off', health);
    expect(off.body.providers.text.active).toBe('none');
  } finally { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
});
