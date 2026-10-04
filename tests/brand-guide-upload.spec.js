/**
 * Upload the brand's GUIDELINES - and give every asset as a file OR a URL.
 * ---------------------------------------------------------------------------
 * The operator's words: "ensure user can upload a document for the design
 * schema to be followed too with all details like logo file or url, etc -
 * keep options for files and urls both where either are required".
 *
 * Everything here is EXECUTED: the real onboarding.html in Chromium, reading
 * real documents built byte by byte in tests/brand-guide-fixtures.js (a PDF
 * with text on three pages and an embedded logo, a DOCX zip, a DESIGN.md, a
 * W3C token file, a CSS file, PNGs, a WOFF made from a real TrueType font, an
 * SVG carrying a script), with pdf.js served from node_modules at the exact
 * jsdelivr URL the page asks for. A linked document the host will not hand
 * to a browser goes through the SHIPPED op=document-fetch (api/public-config
 * .js, in this process), behind the real SSRF guard.
 *
 * The states are production's: no DATABASE_URL and the Supabase project
 * paused, signed out ("device") or signed in with a mobile number and PIN on
 * this device ("phone"). `page.on('dialog')` is registered first: any dialog
 * fails. Every list assertion counts what it read first.
 *
 * Run: npx playwright test tests/brand-guide-upload.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const F = require('./brand-guide-fixtures');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://app.example.test';
const DOCS = 'https://docs.harbourlight.example';      // sends CORS: the browser reads it directly
const NOCORS = 'https://drive.harbourlight.example';   // sends none: read through op=document-fetch
const PAUSED = 'paused-project.supabase.co';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const PDFJS_RX = /^https:\/\/cdn\.jsdelivr\.net\/npm\/pdfjs-dist@4\.10\.38\/build\/(pdf(?:\.worker)?\.min\.mjs)$/;
const STATUS = { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' };
const USER_A = { id: 'dev-guideA0001', phone: '+919876543210', name: 'Asha' };
const USER_B = { id: 'dev-guideB0002', phone: '+919812345678', name: 'Bala' };
const TOKEN_A = 'DEVICEtokenGUIDEa0123456789abcdefghijklmnopq';
const TOKEN_B = 'DEVICEtokenGUIDEb0123456789abcdefghijklmnopq';

const BOOK = F.pdf(F.BOOK_PAGES);
const LOGO_PNG = F.png(64, 64, F.LOGO_RGB(64, 64));
const ICON_PNG = F.png(96, 96, () => [26, 107, 60]);
const WIDE_PNG = F.png(96, 48, () => [26, 107, 60]);
const TINY_PNG = F.png(16, 16, () => [26, 107, 60]);
const HERO_PNG = F.png(240, 160, () => [251, 250, 246]);
const TTF = F.ttf();
const WOFF = F.woffFromTtf(TTF);

/* ── the server, in this process: production's configuration ─────────────── */
const ENV_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'DATABASE_URL', 'NEON_DATABASE_URL', 'POSTGRES_URL'];
function serverWorld() {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SUPABASE_URL = 'https://' + PAUSED;
  process.env.SUPABASE_ANON_KEY = 'anon-key-for-test';
  // The module cache is put back EXACTLY as it was on restore: a spec that runs
  // later in this worker (credits-comp-accounts) holds references to the
  // modules it loaded, and a fresh copy left behind would split one module's
  // state into two (found in CI: its listed-number balance answered 401).
  const cacheBefore = new Map(Object.entries(require.cache));
  const mods = ['../api/public-config.js', '../api/_shared/brand-workspace-core.js', '../api/_shared/brand-document-fetch.js', '../api/_shared/mobile-auth-core.js'].map((m) => require.resolve(m));
  for (const m of mods) delete require.cache[m];
  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  dns.lookup = async (host, opts) => (/\.example$/.test(String(host)) ? [{ address: '93.184.216.34', family: 4 }] : realLookup(host, opts));
  const net = { asked: [], escaped: [], emitted: 0, cancelled: false };
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname === PAUSED) throw new Error('getaddrinfo ENOTFOUND ' + PAUSED);
    if (u.origin === NOCORS) {
      net.asked.push({ url: String(url), redirect: init && init.redirect });
      if (u.pathname === '/book.pdf') return new Response(BOOK, { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="harbourlight-brand-book.pdf"' } });
      if (u.pathname === '/to-metadata') return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
      if (u.pathname === '/endless' || u.pathname === '/liar') {
        // Chunked, no (or a false) Content-Length, far past the cap: 64 MB if read to the end.
        net.emitted = 0; net.cancelled = false;
        const stream = new ReadableStream({
          pull(c) { if (net.emitted >= 64 * 1048576) { c.close(); return; } net.emitted += 65536; c.enqueue(new Uint8Array(65536)); },
          cancel() { net.cancelled = true; },
        });
        return new Response(stream, { status: 200, headers: u.pathname === '/liar' ? { 'content-type': 'application/pdf', 'content-length': '1000' } : { 'content-type': 'application/pdf' } });
      }
      if (u.pathname === '/login') return new Response('<html><body>Sign in</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response('', { status: 404 });
    }
    net.escaped.push(String(url));
    throw new Error('a request left the test world: ' + url);
  };
  const handler = require('../api/public-config.js');
  return {
    handler, net,
    restore() {
      global.fetch = realFetch; dns.lookup = realLookup;
      for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
      for (const k of Object.keys(require.cache)) if (!cacheBefore.has(k)) delete require.cache[k];
      for (const [k, v] of cacheBefore) require.cache[k] = v;
    },
  };
}
async function callShipped(handler, { method, url, headers, body }) {
  const u = new URL(url, HOST);
  const out = { code: 0, body: null, headers: {} };
  const res = {
    statusCode: 200,
    setHeader(k, v) { out.headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return out.headers[String(k).toLowerCase()]; },
    status(c) { out.code = c; this.statusCode = c; return res; },
    json(b) { out.body = b; out.json = true; if (!out.code) out.code = 200; return res; },
    send(b) { out.body = b; if (!out.code) out.code = 200; return res; },
    end() { if (!out.code) out.code = 200; return res; },
  };
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) lower[String(k).toLowerCase()] = v;
  await handler({ method, url: u.pathname + u.search, headers: lower, query: Object.fromEntries(u.searchParams), body: body || {} }, res);
  return out;
}

/* ── the page ─────────────────────────────────────────────────────────────── */
function sessionFor(user, token) {
  return {
    token, mode: 'device', provider: 'mobile-pin', user: { id: user.id, name: user.name, phone: user.phone },
    expires: new Date(Date.now() + 80 * 86400000).toISOString(), storage: { mode: 'device', reason: STATUS.reason, host: '', message: STATUS.message },
  };
}
async function open(page, world, opts) {
  const o = opts || {};
  const log = { dialogs: [], errors: [], api: [], docFetch: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.type() + ': ' + d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  await page.addInitScript((seed) => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
    try {
      if (sessionStorage.getItem('__seeded')) return;
      sessionStorage.setItem('__seeded', '1');
      if (seed.session) localStorage.setItem('lifecycle.auth.session', JSON.stringify(seed.session));
      // Both accounts exist on this device; which one is signed in is the session.
      const users = {};
      for (const u of seed.users) users[u.phone] = Object.assign({}, u, { salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null });
      localStorage.setItem('lifecycle.auth.device.users', JSON.stringify(users));
    } catch (_) {}
  }, { session: o.session || null, users: [USER_A, USER_B] });
  await page.route(/^https?:\/\/(?!app\.example\.test)/, async (route) => {
    const req = route.request();
    const u = req.url();
    const m = PDFJS_RX.exec(u);
    if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build', m[1])) });
    if (/\/auth\/v1\/health/.test(u)) return route.abort('addressunreachable');
    if (u.startsWith(DOCS)) {
      const p = new URL(u).pathname;
      const cors = { 'access-control-allow-origin': '*' };
      const files = {
        '/DESIGN.md': ['text/markdown', Buffer.from(F.DESIGN_MD)],
        '/logo.png': ['image/png', LOGO_PNG],
        '/hero.png': ['image/png', HERO_PNG],
        '/fonts/harbour.woff': ['font/woff', WOFF],
      };
      return files[p] ? route.fulfill({ status: 200, contentType: files[p][0], headers: cors, body: files[p][1] }) : route.fulfill({ status: 404, headers: cors, body: '' });
    }
    // A host that sends no CORS headers: a browser's read of it fails exactly
    // like this (TypeError: Failed to fetch). route.fulfill() would answer it
    // permissively, so the refusal is modelled as the failure the page sees.
    if (u.startsWith(NOCORS)) return route.abort('failed');
    if (req.resourceType() !== 'script') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
  });
  await page.route(HOST + '/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname.startsWith('/api/')) {
      const action = u.searchParams.get('action') || '';
      const op = u.searchParams.get('op') || '';
      const json = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
      log.api.push(action + ':' + op);
      if (!action && !u.searchParams.has('health')) return json({ supabase: { url: 'https://' + PAUSED, anonKey: 'anon' } });
      if (action === 'auth') return op === 'status' ? json(STATUS) : json({ ok: false, error: 'no_database', message: 'No database is configured.' }, 503);
      if (action === 'brand' && op === 'presets') return json({ ok: true, presets: [] });
      if (action === 'brand' && op === 'document-fetch') {
        let body = {};
        try { body = req.postDataJSON() || {}; } catch (_) { body = {}; }
        const out = await callShipped(world.handler, { method: req.method(), url: u.pathname + u.search, headers: await req.allHeaders(), body });
        log.docFetch.push({ url: body.url, code: out.code });
        if (out.json) return json(out.body, out.code);
        return route.fulfill({ status: out.code, contentType: 'application/octet-stream', headers: { 'x-document-type': out.headers['x-document-type'], 'x-document-name': out.headers['x-document-name'], 'x-document-url': out.headers['x-document-url'] }, body: out.body });
      }
      return json({ ok: true });
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto(HOST + '/onboarding.html' + (o.query || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded && window.BrandContext.storage && window.BrandContext.storage().known && window.BrandDocument, null, { timeout: 20000 });
  await page.waitForSelector('#docBlock');
  await page.waitForTimeout(250);
  return log;
}
const row = (page, field) => page.locator(`[data-doc-field="${field}"]`).first();
async function upload(page, sel, name, mimeType, buffer) {
  await page.setInputFiles(sel, { name, mimeType, buffer });
}
async function readBook(page) {
  await upload(page, '#docFile', 'harbourlight-brand-book.pdf', 'application/pdf', BOOK);
  await page.waitForSelector('[data-doc-field="palette.primary"]', { timeout: 30000 });
}

let world;
test.beforeAll(() => { world = serverWorld(); });
test.afterAll(() => { if (world) world.restore(); });


/* ═══ 1. the PDF brand book: read, not paraphrased ═══════════════════════ */
test('a PDF brand book: every stated value with its page and verbatim line; a print or prose colour is not a value', async ({ page }) => {
  const log = await open(page, world);
  await readBook(page);
  const got = async (f) => (await row(page, f).textContent()).replace(/\s+/g, ' ');
  // Identity, page 1.
  expect(await got('name')).toContain('Harbourlight Goods');
  expect(await got('name')).toContain('harbourlight-brand-book.pdf · p.1 · l.2');
  expect(await got('tagline')).toContain('Light, made by hand');
  expect(await got('website')).toContain('https://harbourlight.example');
  // Colours, page 2: the role the document GIVES, the line it gives it on.
  expect(await got('palette.primary')).toContain('#1a6b3c');
  expect(await got('palette.primary')).toContain('p.2 · l.2');
  expect(await got('palette.primary')).toContain('HEX #1A6B3C');
  expect(await got('palette.accent')).toContain('#b8531f');
  expect(await got('palette.accent')).toContain('p.2 · l.5 — “Accent: Copper #B8531F”');
  expect(await got('palette.ink')).toContain('#15201c');
  expect(await got('palette.surface')).toContain('#fbfaf6');
  // CMYK only: reported as print, the conversion labelled DERIVED, never a role.
  const print = (await page.locator('[data-doc-print-only]').allTextContents()).join(' ');
  expect(print).toContain('CMYK 20 0 5 0');
  expect(print).toContain('print only, no screen value stated');
  expect(print).toContain('DERIVED from CMYK 20 0 5 0');
  const roles = (await page.locator('[data-doc-field^="palette."]').allTextContents()).join(' ');
  expect(roles.length).toBeGreaterThan(40);
  expect(roles, 'a CMYK conversion was presented as a stated hex').not.toContain('#ccfff2');
  // A colour named in prose is not a value: the marker, with the line.
  const named = (await page.locator('[data-doc-named="muted"]').textContent()).replace(/\s+/g, ' ');
  expect(named).toContain('grey');
  expect(named).toContain('[DATA REQUIRED BEFORE LAUNCH: palette.muted');
  expect(named).toContain('p.2 · l.10');
  // Type and voice, page 3.
  expect(await got('typography.heading')).toContain('Fraunces');
  expect(await got('typography.heading')).toContain('p.3 · l.2');
  expect(await got('typography.body')).toContain('Inter');
  expect(await got('voice.tone')).toContain('warm, plain-spoken, never hyped');
  expect(await got('voice.banned')).toContain('game-changer, hurry, last chance');
  expect(await got('brand_data.legal_entity')).toContain('Harbourlight Goods Ltd.');
  // The logo: the embedded image on the page that names the logo.
  await expect(page.locator('[data-doc-logo="0"]')).toHaveAttribute('aria-pressed', 'true');
  const logoRow = await got('logo_url');
  expect(logoRow).toContain('p.1');
  expect(logoRow).toContain('Our logo');
  // Component rules, with their lines.
  const comps = (await page.locator('[data-doc-field="components"]').allTextContents()).join(' | ').replace(/\s+/g, ' ');
  expect(comps).toContain('button-primary rounded 6px');
  expect(comps).toContain('button-primary backgroundColor #1a6b3c');
  expect(comps).toContain('container width 1200px');
  expect(comps).toContain('Spacing base 8px');
  // A component's colour ("Buttons: background #1A6B3C, text #FFFFFF") is the
  // component's: it never becomes, or competes for, a palette role.
  const alsoNamed = (await page.locator('[data-doc-field="palette.extra"]').allTextContents()).join(' | ');
  expect(alsoNamed, 'a button rule was read as a palette colour').not.toMatch(/button|#ffffff/i);
  const rules = (await page.locator('[data-doc-field="logo-rule"]').allTextContents()).join(' | ');
  expect(rules).toContain('keep 24px clear');
  // Nothing applied yet: the form still holds the wizard's placeholder.
  await expect(page.locator('input[data-path="name"]')).toHaveValue('');
  expect(log.dialogs).toEqual([]);
  expect(log.errors).toEqual([]);
});

/* ═══ 2. apply: typed wins, everything else is applied, listed, revertible ═ */
test('Apply fills every stated field except a typed one, says which, shows the hard rules, and Revert undoes it', async ({ page }) => {
  const log = await open(page, world);
  await page.fill('input[data-path="name"]', 'Harbour Typed');
  await readBook(page);
  await page.click('#docApply');
  await page.waitForSelector('#docRevert');
  await expect(page.locator('input[data-path="name"]')).toHaveValue('Harbour Typed');
  await expect(row(page, 'name').locator('[data-doc-status]')).toHaveAttribute('data-doc-status', 'kept');
  await expect(row(page, 'palette.primary').locator('[data-doc-status]')).toHaveAttribute('data-doc-status', 'applied');
  await expect(row(page, 'tagline').locator('[data-doc-status]')).toHaveAttribute('data-doc-status', 'applied');
  await expect(page.locator('input[data-path="tagline"]')).toHaveValue('Light, made by hand');
  // The design rules are visible: exact fills, AA text tokens DERIVED with ratios.
  const rules = (await page.locator('#docRules').textContent()).replace(/\s+/g, ' ');
  expect(rules).toContain('The exact colours pass the design rules');
  const derived = page.locator('[data-doc-derived-token="--brand-accent-text"]');
  await expect(derived).toContainText('DERIVED from #b8531f');
  await expect(derived).toContainText(':1 on #');
  // A logo file kept on this device, with the hosted-URL marker said once beside it.
  await expect(page.locator('[data-asset-note="logo"]')).toContainText('[DATA REQUIRED BEFORE LAUNCH: hosted logo URL');
  // The operator takes the document's name over their own.
  await row(page, 'name').locator('[data-doc-take="name"]').click();
  await expect(page.locator('input[data-path="name"]')).toHaveValue('Harbourlight Goods');
  // Revert: everything as it was before Apply.
  await page.click('#docRevert');
  await expect(page.locator('input[data-path="name"]')).toHaveValue('Harbour Typed');
  await expect(page.locator('input[data-path="tagline"]')).toHaveValue('');
  await page.locator('.step-pip[data-step="2"]').click();
  await expect(page.locator('input[type=text][data-path="palette.primary"]')).toHaveValue('#1F5FD0');
  expect(log.dialogs).toEqual([]);
  expect(log.errors).toEqual([]);
});

test('Apply is all or nothing: when the device store refuses a file part-way, every field it had written is put back and the kept files removed', async ({ page }) => {
  const log = await open(page, world);
  await page.fill('input[data-path="name"]', 'Harbour Typed');
  await readBook(page);
  // The logo is kept; then the device store refuses the brand book itself
  // (a full disk, a private window that drops IndexedDB part-way).
  await page.evaluate(() => {
    const F = window.BrandContext.files;
    const real = F.put.bind(F);
    window.__puts = [];
    F.put = async (brandId, slot, blob, info) => {
      if (slot === 'document') throw Object.assign(new Error('The device store is full, so the brand book could not be kept.'), { name: 'QuotaExceededError' });
      const meta = await real(brandId, slot, blob, info);
      window.__puts.push({ brandId, slot, id: meta.id });
      return meta;
    };
  });
  await page.click('#docApply');
  await expect(page.locator('#docBlock')).toContainText('Nothing from harbourlight-brand-book.pdf was applied; the brand is exactly as it was');
  await expect(page.locator('#docBlock')).toContainText('The device store is full');
  expect(await page.locator('#docRevert').count(), 'a Revert was offered for an apply that did not happen').toBe(0);
  await expect(page.locator('input[data-path="name"]')).toHaveValue('Harbour Typed');
  await expect(page.locator('input[data-path="tagline"]'), 'a field from the failed apply stayed').toHaveValue('');
  const left = await page.evaluate(async () => {
    const puts = window.__puts;
    const ids = [];
    for (const p of puts) ids.push(...(await window.BrandContext.files.list(p.brandId)).map((f) => f.id));
    return { puts: puts.map((p) => p.slot), ids };
  });
  expect(left.puts, 'the logo was never kept, so the test proved nothing').toEqual(['logo']);
  expect(left.ids, 'a file from the failed apply stayed on the device').toEqual([]);
  await page.locator('.step-pip[data-step="2"]').click();
  await expect(page.locator('input[type=text][data-path="palette.primary"]')).toHaveValue('#1F5FD0');
  expect(log.dialogs).toEqual([]);
  expect(log.errors).toEqual([]);
});

test('the applied document becomes the brand: saved with its origins, activated, and painted as --brand-* tokens', async ({ page }) => {
  const log = await open(page, world);
  await readBook(page);
  await page.click('#docApply');
  await page.waitForSelector('#docRevert');
  await page.click('[data-go="next"]');                         // saves (device store)
  await page.waitForSelector('input[type=text][data-path="palette.primary"]');
  await expect(page.locator('input[type=text][data-path="palette.primary"]')).toHaveValue('#1a6b3c');
  const stored = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lifecycle.brand.device.workspaces') || 'null');
    return d && d.workspaces[0];
  });
  expect(stored.palette.primary).toBe('#1a6b3c');
  expect(stored.brand_data.field_origins['palette.primary']).toMatchObject({ origin: 'document', source: 'harbourlight-brand-book.pdf', page: 2, line: 2 });
  expect(stored.brand_data.field_origins['palette.accent'].quote).toBe('Accent: Copper #B8531F');
  expect(stored.brand_data.design_components.components['button-primary']).toMatchObject({ rounded: '6px', backgroundColor: '#1a6b3c', padding: '12px 24px' });
  expect(stored.brand_data.brand_files.logo.id).toMatch(/^[0-9a-f]{64}$/);
  expect(stored.logo_url).toBeFalsy();
  // Activate: the exact colours are the tokens on <html>.
  await page.locator('.step-pip[data-step="6"]').click();
  await page.waitForSelector('#activate');
  await page.click('#activate');
  await page.waitForURL(HOST + '/', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--brand-primary').trim() !== '', null, { timeout: 15000 });
  const tok = await page.evaluate(() => ['--brand-primary', '--brand-accent', '--brand-ink', '--brand-surface', '--brand-font-head'].map((k) => document.documentElement.style.getPropertyValue(k).trim()));
  expect(tok.slice(0, 4)).toEqual(['#1a6b3c', '#b8531f', '#15201c', '#fbfaf6']);
  expect(tok[4]).toContain('Fraunces');
  expect(log.dialogs).toEqual([]);
});

/* ═══ 3. a later "Read my site" never overwrites the document silently ═════ */
test('a site value applied over a document value is held back and shown side by side for the operator', async ({ page }) => {
  await open(page, world);
  await readBook(page);
  await page.click('#docApply');
  await page.waitForSelector('#docRevert');
  // Exactly what "Read my site" does when Use is pressed: set the field and record the site as its source.
  await page.evaluate(() => {
    const st = document.querySelector('.step-pip[data-step="2"]');
    st.click();
  });
  await page.waitForSelector('input[type=text][data-path="palette.primary"]');
  await page.evaluate(() => {
    // The extraction panel's own "Use as primary" select, driven as the page drives it.
    const sel = document.createElement('select');
    sel.setAttribute('data-xrole', '#00a651');
    sel.innerHTML = '<option value=""></option><option value="primary">primary</option>';
    document.getElementById('stepCard').appendChild(sel);
    sel.value = 'primary';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const box = page.locator('[data-doc-conflict="palette.primary"]');
  await expect(box).toContainText('#1a6b3c');
  await expect(box).toContainText('#00a651');
  await expect(page.locator('input[type=text][data-path="palette.primary"]')).toHaveValue('#1a6b3c');
  // The operator's choice is THEIRS from here: it is saved as a typed value.
  await box.locator('[data-doc-which="other"]').click();
  await expect(page.locator('input[type=text][data-path="palette.primary"]')).toHaveValue('#00a651');
  await expect(page.locator('[data-doc-conflict]')).toHaveCount(0);
});

/* ═══ 4. the structured formats, with line provenance ═════════════════════ */
for (const fx of [
  { name: 'DESIGN.md', type: 'text/markdown', body: () => Buffer.from(F.DESIGN_MD), primary: 'l.5', heading: 'l.12', extra: async (page) => {
    const comps = (await page.locator('[data-doc-field="components"]').allTextContents()).join(' | ');
    expect(comps).toContain('{colors.primary}');
    expect(await page.locator('[data-doc-field="palette.accent"]').textContent()).toContain('#b8531f');
    // A DERIVED token in the file is not taken as a stated colour.
    const all = (await page.locator('#docBlock').textContent());
    expect(all).toContain('Skipped colors.on-primary (marked DERIVED in the file)');
  } },
  { name: 'tokens.json', type: 'application/json', body: () => Buffer.from(F.TOKENS_JSON), primary: 'l.5', heading: 'l.', extra: async (page) => {
    expect(await page.locator('[data-doc-field="palette.surface"]').textContent()).toContain('#fbfaf6');
    expect(await page.locator('[data-doc-field="typography.body"]').textContent()).toContain('Inter');
  } },
  { name: 'brand.css', type: 'text/css', body: () => Buffer.from(F.CSS), primary: 'l.3', heading: 'l.7', extra: async (page) => {
    expect(await page.locator('[data-doc-field="typography.body"]').textContent()).toContain('Inter');
    expect(await page.locator('[data-doc-field="font-file"]').textContent()).toContain('https://cdn.harbourlight.example/fonts/harbour-sans.woff2');
  } },
]) {
  test(`a ${fx.name} reads its colours and type with the line each is on`, async ({ page }) => {
    const log = await open(page, world);
    await upload(page, '#docFile', fx.name, fx.type, fx.body());
    await page.waitForSelector('[data-doc-field="palette.primary"]');
    const p = (await row(page, 'palette.primary').textContent()).replace(/\s+/g, ' ');
    expect(p).toContain('#1a6b3c');
    expect(p).toContain(fx.name + ' · ' + fx.primary);
    expect((await row(page, 'typography.heading').textContent())).toContain('Fraunces');
    expect((await row(page, 'typography.heading').textContent())).toContain(fx.heading);
    await fx.extra(page);
    expect(log.errors).toEqual([]);
  });
}

test('a DOCX reads its paragraphs, its shaded swatch cells and its embedded logo', async ({ page }) => {
  await open(page, world);
  await upload(page, '#docFile', 'style-guide.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', F.docx());
  await page.waitForSelector('[data-doc-field="palette.primary"]');
  expect(await row(page, 'name').textContent()).toContain('Harbourlight Goods');
  expect((await row(page, 'palette.primary').textContent()).replace(/\s+/g, ' ')).toContain('#1a6b3c');
  expect(await row(page, 'typography.heading').textContent()).toContain('Fraunces');
  await expect(page.locator('[data-doc-logo="0"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-doc-logo="0"]')).toContainText('logo');
});

/* ═══ 5. a document by URL: direct when the host allows, else the server ═══ */
test('a linked document is read directly when its host allows a browser, and through op=document-fetch when not', async ({ page }) => {
  const log = await open(page, world);
  await page.fill('#docUrl', DOCS + '/DESIGN.md');
  await page.click('#docUrlRun');
  await page.waitForSelector('[data-doc-field="palette.primary"]');
  expect((await row(page, 'palette.primary').textContent())).toContain('DESIGN.md · l.5');
  expect(log.docFetch, 'a CORS host was proxied through the server').toEqual([]);
  // No CORS: the shipped op fetches it, behind the SSRF guard, and the bytes come back.
  await page.fill('#docUrl', NOCORS + '/book.pdf');
  await page.click('#docUrlRun');
  await page.waitForFunction(() => /harbourlight-brand-book\.pdf/.test((document.getElementById('docBlock') || {}).innerText || ''), null, { timeout: 30000 });
  expect(log.docFetch).toEqual([{ url: NOCORS + '/book.pdf', code: 200 }]);
  expect(world.net.asked.some((a) => a.url === NOCORS + '/book.pdf' && a.redirect === 'manual')).toBe(true);
  expect((await row(page, 'palette.primary').textContent()).replace(/\s+/g, ' ')).toContain('harbourlight-brand-book.pdf · p.2 · l.2');
  // An empty link is a sentence, not a dead click.
  await page.fill('#docUrl', '');
  await page.click('#docUrlRun');
  await expect(page.locator('#docStatus')).toContainText('Paste the address of your brand guidelines first');
  expect(world.net.escaped).toEqual([]);
});

/* ═══ 6. the server op: SSRF guard on every hop ═══════════════════════════ */
test('op=document-fetch refuses loopback, private and metadata addresses, and a redirect onto one', async () => {
  const ask = (url) => callShipped(world.handler, { method: 'POST', url: '/api/public-config?action=brand&op=document-fetch', headers: { origin: HOST }, body: { url } });
  for (const bad of ['http://127.0.0.1/brand.pdf', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/book.pdf', 'http://[::1]/x.pdf', 'file:///etc/passwd', 'http://localhost/x.pdf']) {
    const out = await ask(bad);
    expect(out.code, bad).toBe(400);
    expect(out.body.message, bad).toMatch(/private or internal|Only http and https|not a valid URL/);
  }
  const before = world.net.asked.length;
  const redirected = await ask(NOCORS + '/to-metadata');
  expect(redirected.code).toBe(400);
  expect(redirected.body.message).toMatch(/private or internal/);
  expect(world.net.asked.length - before, 'the private hop was requested').toBe(1);
  const page = await ask(NOCORS + '/login');
  expect(page.code).toBe(415);
  expect(page.body.message).toMatch(/web page, not a document/);
  const dl = require('../api/_shared/brand-document-fetch.js').downloadUrl;
  expect(dl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')).toBe('https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp');
  expect(dl('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit')).toBe('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/export?format=docx');
  expect(world.net.escaped).toEqual([]);
});

/* ═══ 7. file OR URL on every asset; refusals are sentences ═══════════════ */
test('logo, app icon and imagery each take a file or a URL; a refused file is a sentence', async ({ page }) => {
  const log = await open(page, world);
  const note = (k) => page.locator(`[data-asset-note="${k}"]`);
  await upload(page, '[data-asset-file="logo"]', 'notes.txt', 'text/plain', Buffer.from('not an image'));
  await expect(note('logo')).toContainText('has to be a PNG, JPG, WebP, SVG or GIF image');
  await upload(page, '[data-asset-file="logo"]', 'tiny.png', 'image/png', TINY_PNG);
  await expect(note('logo')).toContainText('at least 32 px on its shorter side');
  await upload(page, '[data-asset-file="favicon"]', 'wide.png', 'image/png', WIDE_PNG);
  await expect(note('favicon')).toContainText('has to be square');
  await upload(page, '[data-asset-file="logo"]', 'logo.png', 'image/png', LOGO_PNG);
  await expect(note('logo')).toContainText('Kept on this device');
  await expect(note('logo')).toContainText('[DATA REQUIRED BEFORE LAUNCH: hosted logo URL, ');
  await expect(page.locator('[data-asset-prev="logo"] img')).toHaveCount(1);
  await upload(page, '[data-asset-file="favicon"]', 'icon.png', 'image/png', ICON_PNG);
  await expect(note('favicon')).toContainText('hosted app icon URL');
  await upload(page, '[data-asset-file="image"]', 'hero.png', 'image/png', HERO_PNG);
  await expect(page.locator('[data-asset-prev="image"]')).toContainText('1 uploaded image(s)');
  // A URL instead: used as-is once it loads.
  await page.fill('input[data-asset-url="logo"]', DOCS + '/logo.png');
  await page.locator('input[data-asset-url="logo"]').dispatchEvent('change');
  await expect(note('logo')).toContainText('Loaded (64×64 px)');
  await expect(page.locator('input[data-path="logo_url"]')).toHaveValue(DOCS + '/logo.png');
  await page.click('[data-asset-add="image"]');
  await expect(note('image')).toContainText('Paste the address of an image first');
  await page.fill('input[data-asset-url="image"]', DOCS + '/hero.png');
  await page.click('[data-asset-add="image"]');
  await expect(note('image')).toContainText('Loaded (240×160 px)');
  await page.fill('input[data-asset-url="logo"]', DOCS + '/missing.png');
  await page.locator('input[data-asset-url="logo"]').dispatchEvent('change');
  await expect(note('logo')).toContainText('did not load as an image');
  // A paste that does not load never blanks the mark: the logo that was there
  // is put back, in the field and in the record.
  await expect(note('logo')).toContainText('The logo you had is kept.');
  await expect(page.locator('input[data-path="logo_url"]')).toHaveValue(DOCS + '/logo.png');
  await page.fill('input[data-asset-url="logo"]', 'not an address');
  await page.locator('input[data-asset-url="logo"]').dispatchEvent('change');
  await expect(note('logo')).toContainText('That is not a web address. The logo you had is kept.');
  await expect(page.locator('input[data-path="logo_url"]')).toHaveValue(DOCS + '/logo.png');
  // The icon was an uploaded FILE (no URL): a failed paste leaves the file in use.
  await page.fill('input[data-asset-url="favicon"]', DOCS + '/missing-icon.png');
  await page.locator('input[data-asset-url="favicon"]').dispatchEvent('change');
  await expect(note('favicon')).toContainText('The app icon you had is kept.');
  await expect(page.locator('input[data-path="favicon_url"]')).toHaveValue('');
  await expect(page.locator('[data-asset-prev="favicon"] img')).toHaveCount(1);
  await page.fill('input[data-path="name"]', 'Harbourlight Goods');
  await page.click('[data-go="next"]');
  await expect.poll(() => page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lifecycle.brand.device.workspaces') || 'null');
    const w = d && d.workspaces && d.workspaces[0];
    return w ? { logo: w.logo_url, icon: w.favicon_url, file: !!(w.brand_data.brand_files.favicon && w.brand_data.brand_files.favicon.id) } : null;
  })).toEqual({ logo: DOCS + '/logo.png', icon: '', file: true });
  expect(log.dialogs).toEqual([]);
  expect(log.errors).toEqual([]);
});

test('an uploaded SVG is stripped of scripts and handlers, and only ever shown as an image', async ({ page }) => {
  const log = await open(page, world);
  await upload(page, '[data-asset-file="logo"]', 'mark.svg', 'image/svg+xml', Buffer.from(F.EVIL_SVG));
  await expect(page.locator('[data-asset-note="logo"]')).toContainText('scripts and event handlers were removed');
  await expect(page.locator('[data-asset-prev="logo"] img')).toHaveCount(1);
  await page.waitForTimeout(300);
  // What was KEPT, read straight out of IndexedDB.
  const svg = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('lifecycle-brand-files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res) => { const t = db.transaction('files').objectStore('files').getAll(); t.onsuccess = () => res(t.result); });
    const rec = all.find((x) => x.slot === 'logo');
    return { type: rec && rec.type, text: rec ? await rec.blob.text() : '', flags: [window.__svgOnload, window.__svgScript, window.__svgHref] };
  });
  expect(svg.type).toBe('image/svg+xml');
  expect(svg.text).toContain('<rect');
  expect(svg.text).not.toMatch(/<script|onload|javascript:/i);
  expect(svg.flags).toEqual([undefined, undefined, undefined]);
  expect(await page.locator('svg[onload], #stepCard svg script').count()).toBe(0);
  expect(log.errors).toEqual([]);
});

test('a font is a file or a URL, and it actually loads; a file that is not a font is refused', async ({ page }) => {
  const log = await open(page, world);
  await page.fill('input[data-path="name"]', 'Harbourlight Goods');
  await page.locator('.step-pip[data-step="3"]').click();
  await page.waitForSelector('[data-asset-file="font:heading"]', { state: 'attached' });
  await upload(page, '[data-asset-file="font:heading"]', 'NotAFont.woff2', 'font/woff2', LOGO_PNG);
  await expect(page.locator('[data-asset-note="font:heading"]')).toContainText('is not a font this browser can load');
  await upload(page, '[data-asset-file="font:heading"]', 'HarbourHead-Regular.ttf', 'font/ttf', TTF);
  await expect(page.locator('[data-asset-note="font:heading"]')).toContainText('hosted font URL');
  expect(await page.evaluate(() => document.fonts.check('16px "HarbourHead"'))).toBe(true);
  await upload(page, '[data-asset-file="font:body"]', 'HarbourBody.woff', 'font/woff', WOFF);
  await expect(page.locator('[data-asset-prev="font:body"]')).toContainText('HarbourBody');
  expect(await page.evaluate(() => document.fonts.check('16px "HarbourBody"'))).toBe(true);
  // A URL instead: loaded with the FontFace API from the address given.
  await page.fill('[data-font-url="body"]', DOCS + '/fonts/harbour.woff');
  await page.click('[data-font-load="body"]');
  await expect(page.locator('[data-asset-note="font:body"]')).toContainText('loaded from docs.harbourlight.example');
  expect(await page.evaluate(() => document.fonts.check('16px "harbour"'))).toBe(true);
  await page.fill('[data-font-url="heading"]', 'http://docs.harbourlight.example/fonts/harbour.woff');
  await page.click('[data-font-load="heading"]');
  await expect(page.locator('[data-asset-note="font:heading"]')).toContainText('has to be https');
  expect(log.errors).toEqual([]);

  // The FILE reaches the brand record, not only brand_files: the saved
  // typography names the https URL every generated asset declares in
  // @font-face. The heading font is a file on this device, so it has no src
  // (its assets carry the hosted-font marker instead).
  await page.click('[data-go="next"]');
  await expect.poll(() => page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('lifecycle.brand.device.workspaces') || 'null');
    return d && d.workspaces && d.workspaces[0] ? d.workspaces[0].typography : null;
  })).toMatchObject({ body: { family: 'HarbourBody', google: false, src: DOCS + '/fonts/harbour.woff', format: 'woff' } });
  const typo = await page.evaluate(() => JSON.parse(localStorage.getItem('lifecycle.brand.device.workspaces')).workspaces[0].typography);
  expect(typo.heading.family).toBe('HarbourHead');
  expect(typo.heading.src, 'a file only on this device was given a URL').toBeUndefined();

  // The record, built into the real assets: every one declares the face.
  const face = `@font-face{font-family:'HarbourBody';src:url('${DOCS}/fonts/harbour.woff') format('woff');font-display:swap}`;
  const brand = { id: '44444444-4444-4444-8444-444444444444', name: 'Harbourlight Goods', palette: { primary: '#1a6b3c', accent: '#b8531f', ink: '#15201c', surface: '#fbfaf6' }, typography: typo, voice: {}, regions: [{ code: 'US', store_url: 'https://harbourlight.example', home: true }], claims: [] };
  const runtime = require('../api/_shared/brand-runtime.js');
  expect(runtime.fontImport(typo)).toContain(face);
  expect(runtime.brandBlock(brand), 'the prompt never tells a writer to load the face').toContain(face);
  const { buildFallbackLanding } = require('../api/_shared/landing-fallback.js');
  expect(buildFallbackLanding({ id: 'cid-font', region: 'us', brand }), 'the /lp fallback page').toContain(face);
  const sbPlan = require('../api/_shared/smart-brain-plan.js');
  const lp = sbPlan.lpHtml({ brand, market: 'US', heroProduct: { title: 'Lantern' } }, { landing: { headline: 'Light, made by hand' } }, 'cid-font', null);
  expect(lp, 'the /lp/:id page').toContain(face);
  // The html stage's own renderer (the path every provider being down takes).
  const LLM = require.resolve('../api/_shared/llm.js');
  const realLlm = require.cache[LLM];
  const real = require(LLM);
  const down = async () => { throw new Error('every provider is down'); };
  for (const k of Object.keys(real)) down[k] = real[k];
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: down };
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error('no network in this test: ' + u); };
  try {
    const stage = require('../api/ai/pipeline/html.js');
    const out = await callShipped(stage, {
      method: 'POST', url: '/api/ai/pipeline/html',
      headers: { origin: 'https://app.example.test', referer: 'https://app.example.test/studio', authorization: 'Bearer ' + TOKEN_A, 'x-lifecycle-token': TOKEN_A },
      body: { variant: 'A', brand, market: 'US', plan: {}, strategy: {} },
    });
    expect(out.code, JSON.stringify(out.body).slice(0, 300)).toBe(200);
    expect(out.body._heuristic).toBe(true);
    expect(String(out.body.html || ''), 'the mailer').toContain(face);
  } finally {
    global.fetch = realFetch;
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if (realLlm) require.cache[LLM] = realLlm; else delete require.cache[LLM];
  }
});

/* ═══ 8. device storage: per account, deleted with the brand, never in an email ═ */
test('files stay on this device under the account, survive a reload, are invisible to another account, and go with the brand', async ({ page, context }) => {
  await open(page, world, { session: sessionFor(USER_A, TOKEN_A) });
  await page.fill('input[data-path="name"]', 'Harbourlight Goods');
  await upload(page, '[data-asset-file="logo"]', 'logo.png', 'image/png', LOGO_PNG);
  await expect(page.locator('[data-asset-note="logo"]')).toContainText('Kept on this device');
  await page.click('[data-go="next"]');                     // saves: the pending files move to the brand's id
  await page.waitForSelector('input[type=text][data-path="palette.primary"]');
  const id = await page.evaluate(() => window.BrandContext.device.list()[0].id);
  expect(id).toMatch(/^local-/);
  const keys = async () => page.evaluate(async (bid) => (await window.BrandContext.files.list(bid)).map((f) => f.slot), id);
  await expect.poll(keys).toEqual(['logo']);
  const ns = await page.evaluate(() => window.BrandContext.files.namespace());
  expect(ns).toBe('lifecycle.brand.device.workspaces.' + USER_A.id);
  // The reload keeps it, and the preview paints it from IndexedDB.
  await page.goto(HOST + '/onboarding.html?id=' + encodeURIComponent(id), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded && window.BrandDocument);
  await expect.poll(keys).toEqual(['logo']);
  await expect(page.locator('[data-asset-prev="logo"] img')).toHaveAttribute('src', /^blob:/);
  // What a generated asset is handed: the marker's name, never the bytes.
  const carried = await page.evaluate(() => JSON.stringify(window.BrandContext.carry()));
  expect(JSON.parse(carried).pending_hosting).toEqual(['logo']);
  expect(carried).not.toMatch(/data:|base64|blob:/);
  // Another person signs in on the same browser: none of A's files.
  await page.evaluate((s) => localStorage.setItem('lifecycle.auth.session', JSON.stringify(s)), sessionFor(USER_B, TOKEN_B));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded);
  expect(await page.evaluate(() => window.BrandContext.files.namespace())).toBe('lifecycle.brand.device.workspaces.' + USER_B.id);
  expect(await keys()).toEqual([]);
  // A again; deleting the brand deletes its files.
  await page.evaluate((s) => localStorage.setItem('lifecycle.auth.session', JSON.stringify(s)), sessionFor(USER_A, TOKEN_A));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded);
  await expect.poll(keys).toEqual(['logo']);
  await page.evaluate((bid) => window.BrandContext.api('delete', { body: { id: bid } }), id);
  expect(await keys()).toEqual([]);
  void context;
});

test('a generated mailer for a brand whose logo is only on the device carries the hosted-URL marker and no base64', async () => {
  const runtime = require('../api/_shared/brand-runtime.js');
  const auth = { ok: true, provider: 'mobile-pin', mode: 'device', user_id: 'device:abc' };
  // Exactly what the page carries (the test above asserts carry() for real).
  const carried = { name: 'Harbourlight Goods', palette: { primary: '#1a6b3c', accent: '#b8531f', ink: '#15201c', surface: '#fbfaf6' }, typography: {}, voice: {}, regions: [], pending_hosting: ['logo'], logo_url: 'data:image/png;base64,iVBORw0KGgo=' };
  const b = runtime.carriedBrand({ brand: carried }, auth);
  expect(b.logo_url, 'a data: URL survived into the record a generator reads').toBe('');
  expect(b.pending_hosting).toEqual(['logo']);
  const block = runtime.brandBlock(b);
  expect(block).toContain('[DATA REQUIRED BEFORE LAUNCH: hosted logo URL, Harbourlight Goods]');
  expect(block, 'the logo bytes reached the prompt').not.toMatch(/;base64,|data:image\/|iVBORw0KGgo/);
  // The html stage's own renderer (the path every provider being down takes), executed.
  const LLM = require.resolve('../api/_shared/llm.js');
  const realLlm = require.cache[LLM];
  const real = require(LLM);
  const down = async () => { throw new Error('every provider is down'); };
  for (const k of Object.keys(real)) down[k] = real[k];
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: down };
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error('no network in this test: ' + u); };
  try {
    const stage = require('../api/ai/pipeline/html.js');
    const out = await callShipped(stage, {
      method: 'POST', url: '/api/ai/pipeline/html',
      headers: { origin: 'https://app.example.test', referer: 'https://app.example.test/studio', authorization: 'Bearer ' + TOKEN_A, 'x-lifecycle-token': TOKEN_A },
      body: { variant: 'A', brand: carried, market: 'US', plan: {}, strategy: {} },
    });
    expect(out.code, JSON.stringify(out.body).slice(0, 300)).toBe(200);
    expect(out.body._heuristic).toBe(true);
    const mail = String(out.body.html || '');
    expect(mail.length).toBeGreaterThan(1500);
    expect(mail).toContain('[DATA REQUIRED BEFORE LAUNCH: hosted logo URL, Harbourlight Goods]');
    expect(mail, 'base64 reached a generated mailer').not.toMatch(/;base64,|data:image|blob:|iVBORw0KGgo/);
  } finally {
    global.fetch = realFetch;
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    if (realLlm) require.cache[LLM] = realLlm; else delete require.cache[LLM];
  }
});

/* ═══ 9. an account brand HOSTS its files, with the person's own token ═════ */
test('for an account brand a file is uploaded to the brand-assets bucket under its workspace, and the https URL is what is kept', async ({ page }) => {
  await open(page, world);
  const WSID = '33333333-3333-4333-8333-333333333333';
  const seen = [];
  await page.route('https://live.supabase.co/storage/v1/object/**', async (route) => {
    const r = route.request();
    seen.push({ url: r.url(), method: r.method(), auth: r.headers().authorization, apikey: r.headers().apikey, type: r.headers()['content-type'], upsert: r.headers()['x-upsert'], bytes: (r.postDataBuffer() || Buffer.alloc(0)).length });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"Key":"ok"}' });
  });
  const out = await page.evaluate(async ({ ws, b64 }) => {
    window.__SUPABASE__ = { url: 'https://live.supabase.co', anonKey: 'anon-public' };
    // An account session: a Supabase JWT (three segments) is what storage takes.
    window.LifecycleAuth.apiToken = () => 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    const sha = await window.BrandDocument.sha256(bytes);
    const hosted = await window.BrandContext.files.host(ws, { blob, type: 'image/png', sha256: sha, id: sha, slot: 'logo' });
    const device = await window.BrandContext.files.host('local-abc123', { blob, type: 'image/png', sha256: sha, id: sha, slot: 'logo' });
    // The brand book: private, never offered to the public bucket.
    const book = await window.BrandContext.files.host(ws, { blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }), type: 'application/pdf', sha256: 'f'.repeat(64), id: 'f'.repeat(64), slot: 'document' });
    return { hosted, device, book, sha };
  }, { ws: WSID, b64: LOGO_PNG.toString('base64') });
  expect(out.hosted).toEqual({ hosted: true, url: `https://live.supabase.co/storage/v1/object/public/brand-assets/${WSID}/${out.sha}.png` });
  expect(out.device).toEqual({ hosted: false, reason: 'device' });
  expect(out.book).toEqual({ hosted: false, reason: 'private' });
  expect(seen).toEqual([{ url: `https://live.supabase.co/storage/v1/object/brand-assets/${WSID}/${out.sha}.png`, method: 'POST', auth: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl', apikey: 'anon-public', type: 'image/png', upsert: 'true', bytes: LOGO_PNG.length }]);
  expect(out.sha).toBe(require('crypto').createHash('sha256').update(LOGO_PNG).digest('hex'));
});

/* ═══ 10. review round 1 (Codex on 309c5bc), each reproduced first ═════════ */

test('signed in to an account: Apply hosts the logo, and the private brand book is never uploaded', async ({ page }) => {
  // The account state: the localhost preview (auth.js kind "local"), where the
  // wizard saves to the SERVER and so a brand has a workspace id to host under.
  const http = require('http');
  const srv = http.createServer((req, res) => {
    const file = path.join(ROOT, (req.url || '/').split('?')[0].replace(/^\//, '') || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const WSID = '55555555-5555-4555-8555-555555555555';
  const rows = {};
  const uploads = [];
  const saves = [];
  try {
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const u = route.request().url();
      const m = PDFJS_RX.exec(u);
      if (m) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build', m[1])) });
      if (/\/storage\/v1\/object\//.test(u)) {
        // Writes only: the previews then GET the hosted logo from its public URL.
        if (route.request().method() !== 'GET') uploads.push(new URL(u).pathname);
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"Key":"ok"}' });
      }
      if (route.request().resourceType() !== 'script') return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
    });
    await page.route(base + '/api/**', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const op = u.searchParams.get('op') || '';
      const json = (b, s) => route.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.searchParams.get('action') !== 'brand') return json({ ok: true });
      const core = require('../api/_shared/brand-workspace-core.js');
      const full = (r) => Object.assign({}, r, { tokens: core.tokens(r), fonts_href: core.fontsHref(r), readiness: core.readiness(r, { products: 0 }), products: 0 });
      if (op === 'save') {
        const b = (req.postDataJSON() || {}).brand || {};
        saves.push(b);
        rows[WSID] = Object.assign({}, b, { id: WSID, slug: b.slug || 'harbourlight' });
        return json({ ok: true, brand: full(rows[WSID]) });
      }
      if (op === 'get') return rows[WSID] ? json({ ok: true, brand: full(rows[WSID]) }) : json({ ok: false, error: 'workspace_not_found' }, 404);
      if (op === 'active') return json({ ok: true, brand: null, needs_onboarding: true, workspaces: [] });
      if (op === 'list') return json({ ok: true, workspaces: [], active_id: null });
      return json({ ok: true, presets: [], pack: null });
    });
    await page.goto(base + '/onboarding.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind === 'local' && window.BrandContext && window.BrandContext.loaded && window.BrandDocument, null, { timeout: 20000 });
    expect(await page.evaluate(() => window.BrandContext.storage().mode)).toBe('server');
    await page.evaluate(() => {
      window.__SUPABASE__ = { url: 'https://live.supabase.co', anonKey: 'anon-public' };
      window.LifecycleAuth.apiToken = () => 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
    });
    await page.fill('input[data-path="name"]', 'Harbour Typed');
    await page.click('[data-go="next"]');                               // saved to the account: the brand has its id
    await page.waitForSelector('input[type=text][data-path="palette.primary"]');
    await page.locator('.step-pip[data-step="1"]').click();
    await readBook(page);
    await page.click('#docApply');
    await page.waitForSelector('#docRevert');
    await expect(page.locator('[data-asset-note="logo"]')).toContainText('Hosted at live.supabase.co');
    await page.click('[data-go="next"]');
    await page.waitForSelector('input[type=text][data-path="palette.primary"]');
    const last = saves[saves.length - 1];
    const sha = require('crypto').createHash('sha256').update(BOOK).digest('hex');
    // The logo went to the public bucket under this workspace; the book did not, by any path.
    expect(uploads.length).toBe(1);
    expect(uploads[0]).toMatch(new RegExp(`^/storage/v1/object/brand-assets/${WSID}/[0-9a-f]{64}\\.png$`));
    expect(uploads.join(' '), 'the private brand book was uploaded to a public bucket').not.toContain(sha);
    expect(last.logo_url).toBe('https://live.supabase.co' + uploads[0].replace('/object/brand-assets/', '/object/public/brand-assets/'));
    expect(last.brand_data.brand_files.document).toMatchObject({ id: sha, hosted_url: '' });
    expect(await page.evaluate(async (id) => (await window.BrandContext.files.list(id)).map((f) => f.slot).sort(), WSID)).toEqual(['document', 'logo']);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('a linked document is cut off at the cap however the host describes it, and the stream is cancelled', async () => {
  const ask = (url) => callShipped(world.handler, { method: 'POST', url: '/api/public-config?action=brand&op=document-fetch', headers: { origin: HOST }, body: { url } });
  const cap = require('../api/_shared/brand-document-fetch.js').MAX_BYTES;
  for (const p of ['/endless', '/liar']) {
    const out = await ask(NOCORS + p);
    expect(out.code, p).toBe(413);
    expect(out.body.message, p).toMatch(/at most 4 MB/);
    // Read up to the cap and one chunk past it - never the 64 MB on offer.
    expect(world.net.emitted, `${p}: bytes pulled from the host`).toBeLessThanOrEqual(cap + 3 * 65536);
    expect(world.net.cancelled, `${p}: the host's stream was not cancelled`).toBe(true);
  }
});

test('in the browser too, a CORS download is cut off at the cap and its stream cancelled, and the server is not asked to fetch it again', async ({ page }) => {
  await open(page, world);
  const out = await page.evaluate(async () => {
    const BD = window.BrandDocument;
    const cap = 2 * 1048576;
    BD.LIMITS.document = cap;                                 // the shipped reader, a smaller cap for the test
    const realFetch = window.fetch;
    const runs = {};
    for (const kind of ['endless', 'liar', 'declared']) {
      const net = { emitted: 0, cancelled: false, server: 0 };
      window.fetch = async (url, init) => {
        if (!/\/guide-/.test(String(url))) return realFetch(url, init);
        // 64 MB if read to the end; pulled a chunk at a time.
        const stream = new ReadableStream({
          pull(c) { if (net.emitted >= 64 * 1048576) { c.close(); return; } net.emitted += 65536; c.enqueue(new Uint8Array(65536)); },
          cancel() { net.cancelled = true; },
        });
        const headers = { 'content-type': 'application/pdf' };
        if (kind === 'liar') headers['content-length'] = '1000';
        if (kind === 'declared') headers['content-length'] = String(64 * 1048576);
        return new Response(stream, { status: 200, headers });
      };
      let error = null;
      try { await BD.readUrl('https://cdn.harbourlight.example/guide-' + kind + '.pdf', { viaServer: async () => { net.server++; throw new Error('asked the server'); } }); }
      catch (e) { error = { code: e.code, message: e.message }; }
      runs[kind] = { error, emitted: net.emitted, cancelled: net.cancelled, server: net.server };
    }
    window.fetch = realFetch;
    return { cap, runs };
  });
  for (const [kind, r] of Object.entries(out.runs)) {
    expect(r.error && r.error.code, kind).toBe('too_large');
    expect(r.error.message, kind).toMatch(/larger than 2 MB.*download was stopped/);
    expect(r.emitted, `${kind}: bytes pulled from the host`).toBeLessThanOrEqual(out.cap + 3 * 65536);
    expect(r.cancelled, `${kind}: the host's stream was not cancelled`).toBe(true);
    expect(r.server, `${kind}: an oversized file was fetched again through the server`).toBe(0);
  }
  // A declared length past the cap is refused before a byte is read.
  expect(out.runs.declared.emitted).toBeLessThanOrEqual(65536);
});

test('a typed value the document repeats stays typed, so a later document cannot take it', async ({ page }) => {
  await open(page, world);
  await page.fill('input[data-path="tagline"]', 'Light, made by hand');
  await readBook(page);
  await page.click('#docApply');
  await page.waitForSelector('#docRevert');
  await expect(row(page, 'tagline').locator('[data-doc-status]')).toHaveAttribute('data-doc-status', 'same');
  await page.fill('input[data-path="name"]', 'Harbourlight Goods');
  await page.click('[data-go="next"]');
  await page.waitForSelector('input[type=text][data-path="palette.primary"]');
  const origin = await page.evaluate(() => JSON.parse(localStorage.getItem('lifecycle.brand.device.workspaces')).workspaces[0].brand_data.field_origins.tagline.origin);
  expect(origin).toBe('user');
});

test('an unticked "never use em dashes" is the operator\'s, and a guideline that says otherwise does not tick it', async ({ page }) => {
  await open(page, world);
  await page.locator('.step-pip[data-step="4"]').click();
  await page.waitForSelector('input[data-path="voice.no_em_dashes"]');
  await page.uncheck('input[data-path="voice.no_em_dashes"]');
  await page.locator('.step-pip[data-step="1"]').click();
  await readBook(page);
  await page.click('#docApply');
  await page.waitForSelector('#docRevert');
  await expect(row(page, 'voice.no_em_dashes').locator('[data-doc-status]')).toHaveAttribute('data-doc-status', 'kept');
  await page.locator('.step-pip[data-step="4"]').click();
  await expect(page.locator('input[data-path="voice.no_em_dashes"]')).not.toBeChecked();
});
