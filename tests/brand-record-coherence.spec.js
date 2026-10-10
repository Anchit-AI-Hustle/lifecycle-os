/**
 * A brand record describes ONE brand (2026-10-10).
 * ---------------------------------------------------------------------------
 * The operator: "check each current brand context information - all messed
 * up and mixed up". The only brand in the live project was named Mamaearth,
 * slugged food-for-thought, with https://www.nike.in as its website, its
 * social profiles, imagery, app icon and legal entity read from mamaearth.in,
 * and its catalogue imported from delichic.co.in (tests/fixtures/
 * live-mixed-brand.js, reconstructed from read-only SELECTs). Every field had a
 * source; nothing compared the sources.
 *
 * What is EXECUTED here, and what each part pins:
 *
 *   1. The rule (api/_shared/brand-coherence.js) over the live record and
 *      over records built to each shape: the identity source is the website's
 *      registrable domain, a value read from another domain is a conflict,
 *      identity fields block and design fields warn, a typed value is the
 *      person's, a site value the person accepted is still that site's, a
 *      brand with no website and two sources is a mix, a kept conflict is
 *      recorded and no longer counted.
 *   2. Parity: the block in brand-context.js is the server's block (text), and
 *      the browser's answer equals the server's for every shipped preset, the
 *      live record and the synthetic records (output, in Chromium).
 *   3. The server, through the SHIPPED handle() over tests/lib/fake-supabase.js
 *      with brand_workspace_save modelled from its migration: a slug follows
 *      the name on create and is never taken from the body (the sync of a
 *      device row built from a preset sends one); a mixed record is refused
 *      activation (409 coherence_blocked naming each field) unless a reason is
 *      given, and the override is recorded with who and why.
 *   4. The wizard (onboarding.html + brand-context.js) in Chromium, on the
 *      DEVICE path (no backend) and the ACCOUNT path (the localhost preview,
 *      every brand op answered by the shipped handle()), for each way a record
 *      got mixed: Read my site on another domain, a gallery preset on an
 *      existing brand and under a typed name, a name typed after a read, a
 *      brand document of another brand, "Onboard another brand" (edit vs
 *      create), two tabs, a device row with a preset's slug, a value kept as
 *      "user" from an earlier read - and the repair: Keep (recorded), Clear,
 *      "This brand is <domain>", "Clear everything from <domain>", the slug,
 *      and activation with a reason.
 *   5. The shipped brands: every preset, tenant zero and the observed data,
 *      checked for one brand's identity in another's record.
 *
 * Run: npx playwright test tests/brand-record-coherence.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COH = require(path.join(ROOT, 'api', '_shared', 'brand-coherence.js'));
const OWNERSHIP = require(path.join(ROOT, 'scripts', 'lib', 'brand-ownership.js'));
const LIVE = require('./fixtures/live-mixed-brand.js');
const { FakeSupabase, makeReq, makeRes, envScope, BASE, ANON_KEY, SERVICE_KEY } = require('./lib/fake-supabase.js');

// Independent tests (each builds its own page, store and fake project), so a
// runner with more than one worker spreads the Chromium drives across them.
test.describe.configure({ mode: 'parallel' });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const HOST = 'http://app.example.test';
const DEVICE_KEY = 'lifecycle.brand.device.workspaces';
const clone = (o) => JSON.parse(JSON.stringify(o));

const PRESET_DIR = path.join(ROOT, 'data', 'brands', 'presets');
const PRESETS = fs.readdirSync(PRESET_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => JSON.parse(fs.readFileSync(path.join(PRESET_DIR, f), 'utf8')));
const DEFAULT_BRAND = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', '_default.json'), 'utf8'));

/* A site read from a page on `url`: the field record the wizard writes. */
const read = (value, url, origin) => ({ value, source_url: url, origin: origin || 'site-parse', signal: 'fixture' });

/* Records built to each shape the rule has to judge. */
const SYNTH = {
  coherent: {
    name: 'Lumen Coffee', slug: 'lumen-coffee', website: 'https://www.lumencoffee.com', logo_url: 'https://cdn.shopify.com/s/files/lumen.svg',
    regions: [{ code: 'US', store_url: 'https://www.lumencoffee.com', home: true }],
    brand_data: {
      social: [{ platform: 'instagram', url: 'https://www.instagram.com/lumencoffee/', source_url: 'https://www.lumencoffee.com/' }],
      legal_entity: 'Lumen Coffee LLC',
      brand_extraction: { applied: { name: read('Lumen Coffee', 'https://www.lumencoffee.com/'), logo_url: read('https://cdn.shopify.com/s/files/lumen.svg', 'https://shop.lumencoffee.com/', 'site-render'), 'brand_data.legal_entity': read('Lumen Coffee LLC', 'https://lumencoffee.com/about') } },
    },
  },
  // nike.in and nike.com are one brand (the same label under another suffix).
  sameLabel: { name: 'Nike', website: 'https://www.nike.in', brand_data: { brand_extraction: { applied: { name: read('Nike', 'https://about.nike.com/en') } } } },
  // A typed value after a read is the person's: the read record is history.
  typedAfterRead: { name: 'Harbourlight', website: 'https://harbourlight.example', brand_data: { field_origin: { tagline: 'user' }, brand_extraction: { applied: { tagline: read('Buy 1 Get 1 free', 'https://othershop.example/') } } }, tagline: 'Lamps for long evenings' },
  // "Use your site's" marks the field 'user', and it is STILL that site's value.
  acceptedFromOtherSite: { name: 'Harbourlight', website: 'https://harbourlight.example', logo_url: 'https://www.nike.in/logo.svg',
    brand_data: { field_origin: { logo_url: 'user' }, field_origins: { logo_url: { origin: 'user', at: 'x' } }, brand_extraction: { applied: { logo_url: Object.assign(read('https://www.nike.in/logo.svg', 'https://www.nike.in/', 'site-render'), { replaced: 'https://harbourlight.example/l.svg' }) } } } },
  noWebsite: { name: 'Two Sources', brand_data: { brand_extraction: { applied: { name: read('Two Sources', 'https://alpha.example/'), tagline: read('From beta', 'https://beta.example/') } } }, tagline: 'From beta' },
  kept: { name: 'Lumen Coffee', website: 'https://lumencoffee.com', tagline: 'Buy 1 Get 1 free',
    brand_data: { coherence: { accepted: [{ id: 'cross_domain:tagline:mamaearth.in', at: 'x', origin: 'user' }] }, brand_extraction: { applied: { tagline: read('Buy 1 Get 1 free', 'https://mamaearth.in/') } } } },
  template: { name: 'Acme Tea', slug: 'acme-tea', website: 'https://knickgasm.com', logo_url: 'https://knickgasm.com/logo.svg',
    brand_data: { template: { slug: 'knickgasm', name: 'KNICKGASM' }, field_origin: { website: 'preset', logo_url: 'preset', name: 'user' } } },
  documentOther: { name: 'Lumen Coffee', website: 'https://lumencoffee.com', brand_data: { brand_document: { name: 'other-book.md', describes: { name: 'Orbit Tea', website: 'https://orbittea.example' } } } },
  slugFromEarlierName: { name: 'Mamaearth', slug: 'food-for-thought', website: 'https://mamaearth.in', brand_data: {} },
  hm: { name: 'H&M', slug: 'hm', website: 'https://www2.hm.com', brand_data: {} },
  sharedCdnOnly: { name: 'Lumen', website: 'https://lumen.example', logo_url: 'https://res.cloudinary.com/x/lumen.png', brand_data: { imagery: [{ url: 'https://res.cloudinary.com/x/hero.jpg' }] } },
};

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE RULE
   ═══════════════════════════════════════════════════════════════════════════ */

test.describe('the coherence rule', () => {
  test('the live record is reported as the mix it is, field by field, with every source', () => {
    const c = COH.brandCoherence(LIVE);
    expect(c.identity).toEqual({ website: 'https://www.nike.in', host: 'nike.in', domain: 'nike.in' });
    expect(c.blocking).toBe(true);
    const ids = c.conflicts.map((x) => x.id);
    // Identity read from mamaearth.in and a catalogue imported from delichic.co.in: blocks.
    for (const id of ['cross_domain:name:mamaearth.in', 'cross_domain:tagline:mamaearth.in', 'cross_domain:favicon_url:mamaearth.in',
      'cross_domain:brand_data.legal_entity:mamaearth.in', 'cross_domain:brand_data.social:mamaearth.in',
      'cross_domain:brand_data.imagery:mamaearth.in', 'cross_domain:catalog_source:delichic.co.in']) {
      expect(ids, id).toContain(id);
      expect(c.conflicts.find((x) => x.id === id).severity, id).toBe('block');
    }
    // Design values read from mamaearth.in and the first read's home market: warn.
    for (const id of ['cross_domain:palette.surface:mamaearth.in', 'cross_domain:typography.heading:mamaearth.in', 'cross_domain:regions.home:delichic.co.in']) {
      expect(c.conflicts.find((x) => x.id === id).severity, id).toBe('warn');
    }
    expect(c.conflicts.find((x) => x.id === 'cross_domain:brand_data.social:mamaearth.in').count).toBe(6);
    expect(c.conflicts.find((x) => x.kind === 'slug_name').expected).toBe('mamaearth');
    // The logo IS nike.in's, the website's: not a conflict. The typed primary
    // is the person's, so the fourth site's read beside it is history, not a source.
    expect(ids.some((x) => /:logo_url:/.test(x))).toBe(false);
    expect(ids.some((x) => /fourth-site/.test(x))).toBe(false);
    expect(ids.some((x) => /:palette\.primary:/.test(x))).toBe(false);
    // Every conflict names where it came from.
    for (const x of c.conflicts.filter((y) => y.kind === 'cross_domain')) expect(x.source_url, x.id).toMatch(/^https:\/\//);
    expect(c.summary).toMatch(/mixes brands/);
  });

  test('one brand reads as one brand, across suffixes, shared CDNs and social platforms', () => {
    for (const k of ['coherent', 'sameLabel', 'sharedCdnOnly', 'hm']) {
      const c = COH.brandCoherence(SYNTH[k]);
      expect(c.conflicts, k + ': ' + c.conflicts.map((x) => x.message).join(' ')).toEqual([]);
      expect(c.ok, k).toBe(true);
    }
  });

  test('a typed value is the person\'s; a site value the person accepted is still that site\'s', () => {
    expect(COH.brandCoherence(SYNTH.typedAfterRead).conflicts).toEqual([]);
    const acc = COH.brandCoherence(SYNTH.acceptedFromOtherSite);
    expect(acc.conflicts.map((x) => x.id)).toEqual(['cross_domain:logo_url:nike.in']);
    expect(acc.blocking).toBe(true);
  });

  test('no website and two sources: every sourced value is a conflict, and no website is chosen', () => {
    const c = COH.brandCoherence(SYNTH.noWebsite);
    expect(c.identity).toBeNull();
    expect(c.conflicts.map((x) => x.kind)).toEqual(['mixed_sources', 'mixed_sources']);
    expect(c.blocking).toBe(true);
    expect(c.conflicts[0].message).toMatch(/no website to say which is the brand/);
  });

  test('a kept conflict is recorded, reported as kept, and no longer counted', () => {
    const c = COH.brandCoherence(SYNTH.kept);
    expect(c.conflicts).toEqual([]);
    expect(c.accepted).toEqual(['cross_domain:tagline:mamaearth.in']);
  });

  test('a template\'s identity under another name, and a brand book of another brand, are conflicts', () => {
    const t = COH.brandCoherence(SYNTH.template);
    // The template's website and logo, and the typed name that matches neither.
    expect(t.conflicts.map((x) => x.id).sort()).toEqual(['name_domain:name:knickgasm.com', 'template:logo_url:template:knickgasm', 'template:website:template:knickgasm']);
    expect(t.blocking).toBe(true);
    const d = COH.brandCoherence(SYNTH.documentOther);
    expect(d.conflicts.map((x) => x.id)).toEqual(['document:brand_data.brand_document:orbittea.example']);
    expect(d.blocking).toBe(true);
  });

  test('a slug made from an earlier name is a warning that names the slug the name makes', () => {
    const c = COH.brandCoherence(SYNTH.slugFromEarlierName);
    expect(c.conflicts).toEqual([expect.objectContaining({ kind: 'slug_name', severity: 'warn', value: 'food-for-thought', expected: 'mamaearth' })]);
    expect(c.blocking).toBe(false);
  });

  test('"another domain" is the preset harvester\'s rule: one suffix list, one registrable domain', () => {
    expect(COH.MULTI_LABEL_SUFFIXES.slice().sort()).toEqual(Array.from(OWNERSHIP.MULTI_LABEL_SUFFIXES).sort());
    const hosts = ['www.nike.in', 'about.nike.com', 'delichic.co.in', 'press.example.co.uk', 'economictimes.indiatimes.com', 'a.b.c.com.au', 'localhost', '127.0.0.1', 'sony.co.jp'];
    for (const h of hosts) expect(COH.registrableDomain(h), h).toBe(OWNERSHIP.registrableDomain(h.replace(/^www\./, '')));
    expect(COH.sameBrand('nike.in', 'nike.com')).toBe(true);
    expect(COH.sameBrand('hmgroup.com', 'hm.com')).toBe(true);
    expect(COH.sameBrand('notnike.com', 'nike.com')).toBe(false);
    expect(COH.sameBrand('mamaearth.in', 'nike.in')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. PARITY: the browser judges a brand exactly as the server does
   ═══════════════════════════════════════════════════════════════════════════ */

function blockOf(text, indent) {
  const B = '/* BRAND-COHERENCE:BEGIN */', E = '/* BRAND-COHERENCE:END */';
  const i = text.indexOf(indent + B), j = text.indexOf(indent + E);
  expect(i, 'the BRAND-COHERENCE block is missing').toBeGreaterThanOrEqual(0);
  return text.slice(i, j + indent.length + E.length).split('\n').map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n');
}

test('parity: brand-context.js carries the server\'s rule, byte for byte', () => {
  const srv = blockOf(fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-coherence.js'), 'utf8'), '');
  const web = blockOf(fs.readFileSync(path.join(ROOT, 'brand-context.js'), 'utf8'), '  ');
  expect(srv.length).toBeGreaterThan(8000);
  expect(web).toBe(srv);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 + 4. HARNESS: the device path and the account path
   ═══════════════════════════════════════════════════════════════════════════ */

const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.owner.sig';
const OWNER = 'aaaaaaaa-0000-4000-8000-0000000000c1';

/* The fake project with brand_workspace_save and the provenance functions, as
   the migrations define them: tests/lib/brand-save-fake.js (shared with
   catalog-store-identity.spec.js). */
const makeDb = () => require('./lib/brand-save-fake.js').makeDb(TOKEN, OWNER);

const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'BRAND_RENDER']);
async function callHandle(db, { query, body, method, token }) {
  const req = makeReq({ token: token === undefined ? TOKEN : token, query, body, method: method || (body ? 'POST' : 'GET') });
  const res = makeRes();
  await core.handle(req, res);
  return { status: res.code, json: res.payload };
}

/* ── canned reads of four sites: what Read my site returns for each ── */
const SITES = {
  'nike.in': { name: 'Nike', tagline: 'Just Do It', logo: 'https://prod-assets.nike.in/nike-logo.svg', primary: '#111111', ig: 'https://www.instagram.com/nike/', legal: 'Nike India Pvt Ltd' },
  'mamaearth.in': { name: 'Mamaearth', tagline: 'Buy 1 Get 1 free', logo: '', icon: 'https://mamaearth.in/cdn/shop/files/favicon.png', primary: '#00aeef', ig: 'https://www.instagram.com/mamaearth.in/', legal: 'Capital Cyberscape, Gurgaon' },
  'lumencoffee.com': { name: 'Lumen Coffee', tagline: 'Roasted this week', logo: 'https://www.lumencoffee.com/logo.svg', primary: '#1a6b3c', ig: 'https://www.instagram.com/lumencoffee/', legal: 'Lumen Coffee LLC' },
};
function cannedRead(url) {
  const host = COH.hostOf(url);
  const site = SITES[COH.registrableDomain(host)];
  const field = (v, sig) => (v ? { value: v, signal: sig, source_url: url, confidence: 'declared', candidates: [{ value: v, signal: sig, source_url: url }] } : { value: '', marker: '[DATA REQUIRED BEFORE LAUNCH: x]', candidates: [] });
  const apply = {
    'palette.primary': { value: site.primary, source: { page: url, role: 'primary call to action', viewport: 'desktop' } },
    'brand_data.imagery': { value: [{ url: 'https://' + host + '/hero.jpg', page: url, role: 'hero' }], source: { page: url, role: 'imagery' } },
  };
  if (site.logo) apply.logo_url = { value: site.logo, source: { page: url, role: 'logo' } };
  if (site.icon) apply.favicon_url = { value: site.icon, source: { page: url, role: 'icon' } };
  return {
    ok: true, start: url, pages_visited: 1, stylesheets: [], coverage_note: '', limits: [],
    read: { method: 'rendered', renderer: 'chromium', wall_ms: 1000 },
    rendered: { apply, regression: {}, manifest: {}, screenshots: {} },
    fields: {
      name: field(site.name, 'opengraph:og:site_name'), tagline: field(site.tagline, 'opengraph:og:description'),
      logo: field(site.logo, 'computed: logo'),
      social: { candidates: [{ platform: 'instagram', value: site.ig, source_url: url, signal: 'json-ld:sameAs' }] },
      legal: { candidates: [{ value: site.legal, source_url: url, signal: 'json-ld:Organization' }] },
      palette: { proposed: {}, sources: {}, conflicts: [] }, typography: { heading: [], body: [], scale: [] },
      claims: { candidates: [] },
    },
  };
}

function presetsAnswer(u) {
  const req = makeReq({ token: null, query: Object.fromEntries(u.searchParams), method: 'GET' });
  const res = makeRes();
  return core.handle(req, res).then(() => res.payload);
}

let localServer, localBase;
test.beforeAll(async () => {
  localServer = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => localServer.listen(0, '127.0.0.1', r));
  localBase = 'http://127.0.0.1:' + localServer.address().port;
});
test.afterAll(async () => { if (localServer) await new Promise((r) => localServer.close(r)); });

/**
 * Open the wizard. `account`: the localhost preview, every brand op answered
 * by the shipped handle() over `db`. Otherwise the device path (a configured
 * backend that does not answer: brands are kept in this browser).
 */
async function openWizard(page, { account = null, query = '', seed = null } = {}) {
  const log = { dialogs: [], errors: [], extracts: [], brandOps: [] };
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
  await page.addInitScript((rows) => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
    if (rows && !sessionStorage.getItem('seeded')) { localStorage.setItem('lifecycle.brand.device.workspaces', JSON.stringify(rows)); sessionStorage.setItem('seeded', '1'); }
  }, seed);
  await page.route(/^https?:\/\/(?!app\.example\.test|127\.0\.0\.1)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.abort('addressunreachable');
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});' : 'window.tailwind=window.tailwind||{};' });
  });
  await page.route(HOST + '/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, async (route) => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action');
    const op = u.searchParams.get('op');
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (!action && !u.searchParams.has('health')) return json(account ? { ok: true } : { supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } });
    if (action === 'auth') {
      if (op === 'status') return json({ ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only.' });
      return json({ ok: false, error: 'invalid_session' }, 401);
    }
    if (action !== 'brand') return json({ ok: true });
    if (op === 'presets' || op === 'defaults') return json(await presetsAnswer(u));
    if (op === 'extract') {
      const body = route.request().postDataJSON() || {};
      log.extracts.push(body.url);
      return json(cannedRead(body.url));
    }
    if (!account) return json({ ok: false, error: 'session_verification_unavailable', message: 'The database is not answering.' }, 503);
    log.brandOps.push(op);
    let body = null;
    try { body = route.request().postDataJSON(); } catch (_) { body = null; }
    const out = await callHandle(account, { query: Object.fromEntries(u.searchParams), body: body || undefined, method: route.request().method() });
    return json(out.json, out.status);
  });
  await page.goto((account ? localBase : HOST) + '/onboarding.html' + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded && window.BrandContext.coherence, null, { timeout: 20000 });
  await page.waitForSelector('[data-path="name"], #wsList', { timeout: 15000 });
  await page.waitForTimeout(200);
  return log;
}

const deviceRows = (page) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } }, DEVICE_KEY);
const wizardBrand = (page) => page.evaluate(() => window.__brandForTest ? window.__brandForTest() : null);

async function readSite(page, url) {
  await page.fill('#xUrl', url);
  await page.click('#xRun');
}

test('parity: the browser\'s answer equals the server\'s, for every shipped brand and every shape', async ({ page }) => {
  await openWizard(page);
  const records = [LIVE, DEFAULT_BRAND].concat(PRESETS, Object.values(SYNTH));
  const web = await page.evaluate((rs) => rs.map((r) => window.BrandContext.coherence(r)), records);
  expect(web.length).toBe(records.length);
  expect(records.length).toBeGreaterThan(45);
  records.forEach((r, i) => expect(web[i], r.name).toEqual(JSON.parse(JSON.stringify(COH.brandCoherence(r)))));
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE SERVER, executed
   ═══════════════════════════════════════════════════════════════════════════ */

test.describe('the server', () => {
  let db;
  test.beforeEach(() => {
    ENV.save();
    db = makeDb().install();
    process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    db.route(() => true, () => ({}));
  });
  test.afterEach(() => { db.restore(); ENV.restore(); });

  test('a slug follows the name: a preset\'s or another brand\'s slug in the body is never taken', async () => {
    // Exactly what syncDeviceToAccount() sends for a device row built from the
    // KNICKGASM preset and renamed: the row's own slug rides in the body.
    const made = await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: { name: 'Acme Tea', slug: 'knickgasm', palette: {} } } });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    expect(made.json.brand.slug).toBe('acme-tea');
    const id = made.json.brand.id;
    const again = await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: { id, name: 'Acme Tea', slug: 'apple' } } });
    expect(again.json.brand.slug, 'an update took a slug that is not the name\'s').toBe('acme-tea');
    const renamed = await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: { id, name: 'Acme Tea House' } } });
    expect(renamed.json.brand.slug, 'a rename changed the slug by itself').toBe('acme-tea');
    const repaired = await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: { id, name: 'Acme Tea House', slug: 'acme-tea-house' } } });
    expect(repaired.json.brand.slug, 'the repair "Use acme-tea-house" was refused').toBe('acme-tea-house');
  });

  test('save says what disagrees; activation of a mix is refused, then recorded when a reason is given', async () => {
    // The first brand an account saves is made active by the save itself
    // (before the person has seen anything), so the mix is the SECOND brand.
    await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: { name: 'Lumen Coffee', website: 'https://lumencoffee.com' } } });
    const row = clone(LIVE);
    delete row.id;
    const saved = await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: Object.assign(row, { status: 'draft' }) } });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    expect(saved.json.brand.coherence.blocking).toBe(true);
    expect(saved.json.brand.coherence.conflicts.length).toBeGreaterThan(8);
    const id = saved.json.brand.id;
    const list = await callHandle(db, { query: { action: 'brand', op: 'list' } });
    expect(list.json.workspaces.find((w) => w.id === id).coherence).toEqual(expect.objectContaining({ ok: false, blocking: true }));

    const refused = await callHandle(db, { query: { action: 'brand', op: 'activate' }, body: { id } });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('coherence_blocked');
    expect(refused.json.message).toMatch(/Brand name was read from mamaearth\.in; this brand's website is nike\.in\./);
    expect(refused.json.message).toMatch(/Catalogue was imported from delichic\.co\.in/);
    expect((db.table('brand_user_prefs').find((p) => p.user_id === OWNER) || {}).active_workspace_id, 'a refused activation still activated').not.toBe(id);

    const ok = await callHandle(db, { query: { action: 'brand', op: 'activate' }, body: { id, coherence_override: { reason: 'Demo account: the operator is rebuilding this brand.' } } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const stored = db.table('brand_workspaces').find((w) => w.id === id);
    const ov = stored.brand_data.coherence.overrides;
    expect(ov).toHaveLength(1);
    expect(ov[0]).toEqual(expect.objectContaining({ by: OWNER, reason: 'Demo account: the operator is rebuilding this brand.' }));
    expect(ov[0].conflicts).toContain('cross_domain:name:mamaearth.in');
    expect(db.table('brand_user_prefs').find((p) => p.user_id === OWNER).active_workspace_id).toBe(id);
  });

  test('a coherent brand activates with no override, and a warning never blocks', async () => {
    const b = clone(SYNTH.slugFromEarlierName);
    b.palette = { primary: '#1F5FD0', accent: '#B8531F', ink: '#111111', surface: '#FFFFFF', surface_alt: '#F6F7F9', muted: '#5A6270' };
    const saved = await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: b } });
    const ok = await callHandle(db, { query: { action: 'brand', op: 'activate' }, body: { id: saved.json.brand.id } });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE WIZARD: every path that mixed a record, and the repair
   ═══════════════════════════════════════════════════════════════════════════ */

const PALETTE_OK = { primary: '#1F5FD0', accent: '#B8531F', ink: '#111111', surface: '#FFFFFF', surface_alt: '#F6F7F9', muted: '#5A6270' };
const TYPE_OK = { heading: { family: 'Lora', stack: "'Lora',Georgia,serif", google: true, weights: '500;600;700' }, body: { family: 'Inter', stack: "'Inter',system-ui,sans-serif", google: true, weights: '400;500;600;700' } };
function deviceRow(id, b) {
  return Object.assign({ id, slug: COH.slugify(b.name), status: 'draft', onboarding_step: 1, palette: PALETTE_OK, typography: TYPE_OK, voice: { tone: '', preferred: [], banned: [], no_em_dashes: true, notes: '' }, regions: [], asset_hosts: [], catalog_source: {}, brand_data: {}, storage: 'device', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }, b);
}
const conflictIds = (page) => page.$$eval('[data-coherence] [data-conflict]', (els) => els.map((e) => e.getAttribute('data-conflict')));

for (const mode of ['device', 'account']) {
  test.describe(`the wizard, ${mode} path`, () => {
    let db;
    test.beforeEach(() => {
      ENV.save();
      process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
      process.env.BRAND_RENDER = 'off';
      db = mode === 'account' ? makeDb().install() : null;
      if (db) db.route(() => true, () => ({}));
    });
    test.afterEach(() => { if (db) db.restore(); ENV.restore(); });

    /** Make a brand "Nike" whose website is nike.in, read from its own site, saved. */
    async function nikeBrand(page) {
      await page.fill('[data-path="website"]', 'https://www.nike.in');
      await readSite(page, 'https://www.nike.in');
      await page.waitForFunction(() => /Rendered your site|Read \d page/.test(document.getElementById('toast').textContent || ''), null, { timeout: 15000 });
      await page.waitForTimeout(300);
    }
    async function savedRecord(page, log) {
      if (mode === 'device') {
        const d = await deviceRows(page);
        return d && d.workspaces[0];
      }
      return db.table('brand_workspaces')[0] || null;
    }

    test('Read my site on ANOTHER domain asks which brand it is for, and nothing is read until the person picks', async ({ page }) => {
      const log = await openWizard(page, { account: db });
      await nikeBrand(page);
      let rec = await savedRecord(page, log);
      expect(rec && rec.name, 'the first read did not save the brand').toBe('Nike');
      expect(log.extracts).toEqual(['https://www.nike.in']);

      // The live mechanism: website typed nike.in, then a read of mamaearth.in.
      await readSite(page, 'https://mamaearth.in/collections/b1g1-offer');
      await page.waitForSelector('[data-domain-switch="mamaearth.in"]');
      expect(log.extracts, 'the other site was read before the person said which brand it is').toEqual(['https://www.nike.in']);
      await page.waitForTimeout(300);
      rec = await savedRecord(page, log);
      expect(rec.name).toBe('Nike');
      expect(JSON.stringify(rec)).not.toMatch(/mamaearth/);

      // The person says mamaearth.in IS this brand's website: the read runs,
      // and what nike.in gave the record is listed, never kept silently.
      await page.click('[data-dswitch="website"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-coherence] [data-conflict]').length > 0, null, { timeout: 15000 });
      expect(log.extracts).toEqual(['https://www.nike.in', 'https://mamaearth.in/collections/b1g1-offer']);
      const ids = await conflictIds(page);
      expect(ids, 'the nike.in logo stayed on a mamaearth.in brand without a word').toContain('cross_domain:logo_url:nike.in');
      // One click clears everything nike.in gave this record.
      await page.click('[data-coh-clear-domain="nike.in"]');
      await page.waitForTimeout(400);
      expect(await conflictIds(page)).not.toContain('cross_domain:logo_url:nike.in');
      await page.waitForTimeout(300);
      rec = await savedRecord(page, log);
      expect(rec.website).toMatch(/mamaearth\.in/);
      expect(rec.logo_url || '', 'the cleared logo was saved').not.toMatch(/nike/);
      expect(rec.brand_data.brand_extraction.source, 'the record of reads still names the first read').toMatch(/mamaearth\.in/);
      const c = COH.brandCoherence(rec);
      expect(c.conflicts.filter((x) => x.domain === 'nike.in'), JSON.stringify(c.conflicts)).toEqual([]);
      expect(log.dialogs).toEqual([]);
      expect(log.errors).toEqual([]);
    });

    test('"Start a new brand" from another domain leaves the first brand exactly as it was', async ({ page }) => {
      const log = await openWizard(page, { account: db });
      await nikeBrand(page);
      await readSite(page, 'https://mamaearth.in/');
      await page.waitForSelector('[data-domain-switch]');
      await page.click('[data-dswitch="new"]');
      await page.waitForFunction(() => /Rendered your site|Read \d page/.test(document.getElementById('toast').textContent || '') && document.querySelector('[data-path="name"]').value === 'Mamaearth', null, { timeout: 15000 });
      await page.waitForTimeout(500);
      const all = mode === 'device' ? (await deviceRows(page)).workspaces : db.table('brand_workspaces');
      expect(all.map((w) => w.name).sort()).toEqual(['Mamaearth', 'Nike']);
      for (const w of all) expect(COH.brandCoherence(w).conflicts.filter((x) => x.kind === 'cross_domain'), w.name).toEqual([]);
      expect(all.find((w) => w.name === 'Mamaearth').slug).toBe('mamaearth');
      expect(log.errors).toEqual([]);
    });

    test('a gallery preset on an EXISTING brand changes its design only, never its name, website, slug or regions', async ({ page }) => {
      const log = await openWizard(page, { account: db });
      await page.fill('[data-path="name"]', 'Harbourlight Goods');
      await page.fill('[data-path="website"]', 'https://harbourlight.example');
      await page.click('[data-go="next"]');
      await page.waitForSelector('input[type="text"][data-path="palette.primary"]');
      await page.click('[data-go="back"]');
      await page.waitForSelector('[data-preset="knickgasm"]', { timeout: 15000 });
      await page.click('[data-preset="knickgasm"]');
      await page.waitForFunction(() => /template's colours/.test(document.getElementById('toast').textContent || ''), null, { timeout: 15000 });
      expect(await page.inputValue('[data-path="name"]')).toBe('Harbourlight Goods');
      expect(await page.inputValue('[data-path="website"]')).toBe('https://harbourlight.example');
      await page.click('[data-go="next"]');
      await page.waitForTimeout(400);
      let rec = await savedRecord(page, log);
      expect(rec.slug).toBe('harbourlight-goods');
      expect(rec.website).toBe('https://harbourlight.example');
      expect((rec.palette.primary || '').toUpperCase(), 'the template\'s design was not applied').toBe('#D0473E');
      expect(JSON.stringify(rec.regions)).not.toMatch(/knickgasm/);

      expect(log.errors).toEqual([]);
    });

    test('a NEW brand from a preset takes the slug of the name typed over it, and the template\'s identity is listed', async ({ page }) => {
      const log = await openWizard(page, { account: db });
      await page.waitForSelector('[data-preset="knickgasm"]', { timeout: 15000 });
      await page.click('[data-preset="knickgasm"]');
      await page.waitForFunction(() => document.querySelector('[data-path="name"]') && document.querySelector('[data-path="name"]').value === 'KNICKGASM', null, { timeout: 15000 });
      await page.fill('[data-path="name"]', 'Acme Tea');
      await page.dispatchEvent('[data-path="name"]', 'change');
      await page.waitForSelector('[data-coherence] [data-conflict="template:website:template:knickgasm"]');
      expect(await page.getAttribute('[data-coherence]', 'data-blocking')).toBe('true');
      await page.click('[data-go="next"]');
      await page.waitForTimeout(500);
      const rec = await savedRecord(page, log);
      expect(rec.name).toBe('Acme Tea');
      expect(rec.slug, 'the preset\'s slug rode into a brand typed over it').toBe('acme-tea');
      expect(rec.brand_data.template).toEqual(expect.objectContaining({ slug: 'knickgasm', name: 'KNICKGASM' }));
      expect(COH.brandCoherence(rec).blocking).toBe(true);
      expect(log.errors).toEqual([]);
    });

    test('"Onboard another brand" starts from a blank record, not a copy of the one on screen', async ({ page }) => {
      const seed = mode === 'device' ? { version: 1, active_id: 'local-live01', workspaces: [deviceRow('local-live01', Object.assign(clone(LIVE), { id: 'local-live01', status: 'draft' }))] } : null;
      if (db) {
        const r = clone(LIVE); r.id = undefined; r.status = 'draft';
        const made = await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: r } });
        await callHandle(db, { query: { action: 'brand', op: 'activate' }, body: { id: made.json.brand.id, coherence_override: { reason: 'fixture' } } });
      }
      const log = await openWizard(page, { account: db, seed, query: '?step=6' });
      await page.waitForSelector('#newBrand', { timeout: 15000 });
      expect(await page.locator('[data-path="name"]').count(), 'the wizard did not open on the review step').toBe(0);
      await page.click('#newBrand');
      await page.waitForSelector('[data-path="name"]');
      expect(await page.inputValue('[data-path="name"]')).toBe('');
      await page.fill('[data-path="name"]', 'Second Harbour');
      await page.click('[data-go="next"]');
      await page.waitForTimeout(500);
      const all = mode === 'device' ? (await deviceRows(page)).workspaces : db.table('brand_workspaces');
      const fresh = all.find((w) => w.name === 'Second Harbour');
      expect(fresh, 'the new brand was not saved as its own record').toBeTruthy();
      const bd = fresh.brand_data || {};
      for (const k of ['social', 'imagery', 'legal_entity', 'brand_extraction', 'design_system']) expect(bd[k], 'the new brand inherited ' + k).toBeUndefined();
      expect(fresh.regions || []).toEqual([]);
      expect(fresh.favicon_url || '').toBe('');
      expect(JSON.stringify(fresh)).not.toMatch(/mamaearth|nike|delichic/);
      expect(all.length).toBe(2);
      expect(log.errors).toEqual([]);
    });

    test('the live record: the list badges it, the review lists each conflict, and the repair is the person\'s', async ({ page }) => {
      let id = 'local-live01';
      let seed = null;
      if (mode === 'device') seed = { version: 1, active_id: '', workspaces: [deviceRow(id, Object.assign(clone(LIVE), { id, status: 'draft', palette: PALETTE_OK }))] };
      else {
        // A first brand is made active by its own save, so the mix is the second.
        await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: { name: 'Lumen Coffee', website: 'https://lumencoffee.com', palette: PALETTE_OK } } });
        const r = clone(LIVE); delete r.id; r.status = 'draft'; r.palette = PALETTE_OK;
        id = (await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: r } })).json.brand.id;
      }
      const log = await openWizard(page, { account: db, seed, query: '?id=' + id + '&step=6' });
      await page.waitForSelector('[data-coherence]', { timeout: 15000 });
      await page.waitForSelector('#wsList [data-ws]', { timeout: 15000 });
      expect(await page.getAttribute(`#wsList [data-ws="${id}"] [data-coherence-badge]`, 'data-coherence-badge')).toBe('block');
      expect(await page.getAttribute('[data-coherence]', 'data-blocking')).toBe('true');
      const ids = await conflictIds(page);
      expect(ids).toEqual(expect.arrayContaining(['cross_domain:name:mamaearth.in', 'cross_domain:catalog_source:delichic.co.in']));
      // A device row keeps the slug it was saved with; an account row is
      // created with the slug its NAME makes (the server ignores the body's).
      if (mode === 'device') expect(ids).toContain('slug_name:slug:');
      else expect(ids).not.toContain('slug_name:slug:');

      // Activate is refused with no reason, and nothing is activated.
      await page.click('#activate');
      await page.waitForFunction(() => /mixes brands/.test(document.getElementById('toast').textContent || ''));
      const activeBefore = mode === 'device' ? (await deviceRows(page)).active_id : (db.table('brand_user_prefs').find((p) => p.user_id === OWNER) || {}).active_workspace_id;
      expect(activeBefore || '').not.toBe(id);

      // The person decides: mamaearth.in IS the brand; clear what nike.in and delichic.co.in gave it; the slug follows the name.
      await page.click('[data-coh-is="mamaearth.in"]');
      await page.waitForTimeout(250);
      await page.click('[data-coh-clear-domain="nike.in"]');
      await page.waitForTimeout(250);
      await page.click('[data-coh-clear-domain="delichic.co.in"]');
      await page.waitForTimeout(250);
      if (mode === 'device') { await page.click('[data-coh-slug="mamaearth"]'); await page.waitForTimeout(250); }
      // The asset host list still names nike hosts: kept on purpose, recorded.
      for (const kid of await page.$$eval('[data-coh-keep]', (els) => els.map((e) => e.getAttribute('data-coh-keep')))) {
        await page.click(`[data-coh-keep="${kid}"]`);
        await page.waitForTimeout(150);
      }
      await page.waitForSelector('[data-coherence][data-blocking="false"]');
      await page.waitForTimeout(500);
      const rec = mode === 'device' ? (await deviceRows(page)).workspaces.find((w) => w.id === id) : db.table('brand_workspaces').find((w) => w.id === id);
      const c = COH.brandCoherence(rec);
      expect(c.blocking, JSON.stringify(c.conflicts)).toBe(false);
      expect(rec.website).toMatch(/^https:\/\/mamaearth\.in/);
      expect(rec.slug).toBe('mamaearth');
      expect(rec.catalog_source || {}).toEqual({});
      expect(rec.name).toBe('Mamaearth');
      expect((rec.brand_data.coherence || {}).accepted.length).toBeGreaterThan(0);
      expect(log.errors).toEqual([]);
      expect(log.dialogs).toEqual([]);
    });

    test('activating a mix with a reason is recorded on the brand', async ({ page }) => {
      let id = 'local-live02';
      let seed = null;
      if (mode === 'device') seed = { version: 1, active_id: '', workspaces: [deviceRow(id, Object.assign(clone(LIVE), { id, status: 'draft', palette: PALETTE_OK }))] };
      else {
        // A first brand is made active by its own save, so the mix is the second.
        await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: { name: 'Lumen Coffee', website: 'https://lumencoffee.com', palette: PALETTE_OK } } });
        const r = clone(LIVE); delete r.id; r.status = 'draft'; r.palette = PALETTE_OK;
        id = (await callHandle(db, { query: { action: 'brand', op: 'save' }, body: { brand: r } })).json.brand.id;
      }
      await openWizard(page, { account: db, seed, query: '?id=' + id + '&step=6' });
      await page.waitForSelector('#cohReason');
      await page.fill('#cohReason', 'Keeping it while the operator checks with the client.');
      await page.click('#activate');
      // The wizard leaves for the app once the brand is live, so the RECORD is what is read.
      const recOf = async () => {
        if (mode === 'account') return db.table('brand_workspaces').find((w) => w.id === id);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        const d = await deviceRows(page).catch(() => null);
        return d && d.active_id === id ? d.workspaces.find((w) => w.id === id) : null;
      };
      await expect.poll(async () => { const r = await recOf(); return !!(r && r.brand_data && r.brand_data.coherence && r.brand_data.coherence.overrides); }, { timeout: 15000 }).toBe(true);
      const rec = await recOf();
      expect(rec.brand_data.coherence.overrides[0].reason).toBe('Keeping it while the operator checks with the client.');
      expect(rec.brand_data.coherence.overrides[0].conflicts).toContain('cross_domain:name:mamaearth.in');
    });
  });
}

/* ── paths only the device store has ───────────────────────────────────── */

test.describe('the device store', () => {
  test('a name typed after a read is the person\'s: kept by the next read, and checked against the website', async ({ page }) => {
    const log = await openWizard(page);
    await page.fill('[data-path="website"]', 'https://www.lumencoffee.com');
    await readSite(page, 'https://www.lumencoffee.com');
    await page.waitForFunction(() => document.querySelector('[data-path="name"]').value === 'Lumen Coffee', null, { timeout: 15000 });
    await page.fill('[data-path="name"]', 'Orbit Tea');
    await page.dispatchEvent('[data-path="name"]', 'change');
    await page.waitForSelector('#cohSlot [data-conflict="name_domain:name:lumencoffee.com"][data-severity="warn"]');
    expect(await page.getAttribute('#cohSlot [data-coherence]', 'data-blocking')).toBe('false');
    await readSite(page, 'https://www.lumencoffee.com/about');
    await page.waitForFunction(() => /kept 1|kept \d/.test(document.getElementById('toast').textContent || ''), null, { timeout: 15000 });
    expect(await page.inputValue('[data-path="name"]'), 'a re-read replaced a typed name').toBe('Orbit Tea');
    expect(log.errors).toEqual([]);
  });

  test('a brand document of ANOTHER brand is not applied until the person says it is this brand\'s', async ({ page }) => {
    const log = await openWizard(page);
    await page.fill('[data-path="name"]', 'Lumen Coffee');
    await page.fill('[data-path="website"]', 'https://www.lumencoffee.com');
    await page.click('[data-go="next"]');
    await page.waitForSelector('input[type="text"][data-path="palette.primary"]');
    await page.click('[data-go="back"]');
    const book = ['# Orbit Tea brand guidelines', '', 'Brand name: Orbit Tea', 'Website: https://orbittea.example', 'Tagline: Leaves with a long way to go', ''].join('\n');
    await page.setInputFiles('#docFile', { name: 'orbit-tea-brand-book.md', mimeType: 'text/markdown', buffer: Buffer.from(book) });
    await page.waitForSelector('#docApply', { timeout: 15000 });
    await page.click('#docApply');
    await page.waitForSelector('[data-doc-identity]');
    expect(await page.inputValue('[data-path="name"]')).toBe('Lumen Coffee');
    expect(await page.inputValue('[data-path="website"]')).toBe('https://www.lumencoffee.com');
    await page.click('[data-doc-identity-cancel]');
    await page.waitForSelector('[data-doc-identity]', { state: 'detached' });
    expect(await page.inputValue('[data-path="tagline"]'), 'a cancelled document still applied').toBe('');
    // Applied anyway, it is recorded as describing another brand, and blocks.
    await page.click('#docApply');
    await page.click('[data-doc-identity-go]');
    await page.waitForSelector('#docRevert', { timeout: 15000 });
    await page.click('[data-go="next"]');
    await page.waitForTimeout(500);
    const row = (await deviceRows(page)).workspaces[0];
    expect(row.brand_data.brand_document.describes).toEqual({ name: 'Orbit Tea', website: 'https://orbittea.example' });
    expect(COH.brandCoherence(row).conflicts.map((x) => x.id)).toContain('document:brand_data.brand_document:orbittea.example');
    expect(log.errors).toEqual([]);
  });

  test('a device row with a preset\'s slug: the badge says so on load, and "Use <slug>" repairs it', async ({ page }) => {
    const id = 'local-preset01';
    const seed = { version: 1, active_id: id, workspaces: [deviceRow(id, { name: 'Acme Tea', slug: 'knickgasm', website: 'https://acmetea.example' })] };
    await openWizard(page, { seed, query: '?id=' + id + '&step=6' });
    await page.waitForSelector(`#wsList [data-ws="${id}"] [data-coherence-badge="warn"]`);
    await page.click('[data-coh-slug="acme-tea"]');
    await page.waitForTimeout(400);
    expect((await deviceRows(page)).workspaces[0].slug).toBe('acme-tea');
  });

  test('the device store refuses to activate a mix with no reason, and records the reason it is given', async ({ page }) => {
    const id = 'local-live03';
    const seed = { version: 1, active_id: '', workspaces: [deviceRow(id, Object.assign(clone(LIVE), { id, status: 'draft', palette: PALETTE_OK }))] };
    await openWizard(page, { seed });
    const refused = await page.evaluate(async (wid) => { try { await window.BrandContext.setActive(wid); return null; } catch (e) { return { code: e.code, status: e.status, message: e.message }; } }, id);
    expect(refused).toEqual(expect.objectContaining({ code: 'coherence_blocked', status: 409 }));
    expect(refused.message).toMatch(/Brand name was read from mamaearth\.in/);
    expect((await deviceRows(page)).active_id || '').not.toBe(id);
    await page.evaluate((wid) => window.BrandContext.setActive(wid, { coherence_override: { reason: 'Checked with the client.' } }), id);
    const d = await deviceRows(page);
    expect(d.active_id).toBe(id);
    expect(d.workspaces[0].brand_data.coherence.overrides[0]).toEqual(expect.objectContaining({ reason: 'Checked with the client.' }));
  });

  test('a device row saves with the name\'s slug, never the body\'s', async ({ page }) => {
    await openWizard(page);
    const row = await page.evaluate(async () => (await window.BrandContext.api('save', { body: { brand: { name: 'Orbit Tea', slug: 'knickgasm' } } })).brand);
    expect(row.slug).toBe('orbit-tea');
  });

  test('two tabs editing two brands keep two records: nothing of one lands in the other', async ({ browser }) => {
    const ctx = await browser.newContext();
    const a = await ctx.newPage(), b = await ctx.newPage();
    const seed = { version: 1, active_id: 'local-a', workspaces: [
      deviceRow('local-a', { name: 'Alpha Lamps', website: 'https://alphalamps.example', tagline: 'A' }),
      deviceRow('local-b', { name: 'Beta Bags', website: 'https://betabags.example', tagline: 'B' }),
    ] };
    await openWizard(a, { seed, query: '?id=local-a' });
    await openWizard(b, { query: '?id=local-b' });
    await a.fill('[data-path="tagline"]', 'Light for long evenings');
    await b.fill('[data-path="tagline"]', 'Bags that last');
    await a.click('[data-go="next"]');
    await b.click('[data-go="next"]');
    await a.waitForTimeout(500);
    const rows = (await deviceRows(a)).workspaces;
    const A = rows.find((w) => w.id === 'local-a'), B = rows.find((w) => w.id === 'local-b');
    expect([A.name, A.tagline, A.website]).toEqual(['Alpha Lamps', 'Light for long evenings', 'https://alphalamps.example']);
    expect([B.name, B.tagline, B.website]).toEqual(['Beta Bags', 'Bags that last', 'https://betabags.example']);
    for (const w of rows) expect(COH.brandCoherence(w).ok, w.name).toBe(true);
    await ctx.close();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. THE SHIPPED BRANDS
   ═══════════════════════════════════════════════════════════════════════════ */

test.describe('every brand the repo ships is one brand', () => {
  /* Warnings a shipped brand carries on purpose, each with its reason. Any
     other conflict, and every block, fails. */
  const EXPLAINED = {
    'apple|cross_domain:asset_hosts:cdn-apple.com': 'store.storeimages.cdn-apple.com is Apple\'s own image CDN, declared by hand with no page recorded',
    'toi-health-fitness|name_domain:name:indiatimes.com': 'TOI is The Times of India\'s own abbreviation; the site is its health section on timesofindia.indiatimes.com',
  };
  const ALL = PRESETS.map((p) => [p.slug, p]).concat([['_default', DEFAULT_BRAND]]);

  test('no preset, and not tenant zero, holds another brand\'s identity', () => {
    expect(ALL.length).toBeGreaterThan(40);
    const found = [];
    for (const [slug, p] of ALL) {
      const c = COH.brandCoherence(p);
      for (const x of c.conflicts) if (!EXPLAINED[slug + '|' + x.id]) found.push(`${slug}: ${x.severity} ${x.message}`);
      expect(c.blocking, slug).toBe(false);
    }
    expect(found).toEqual([]);
  });

  test('no preset carries tenant zero\'s claims, voice, legal entity, store or URL scheme', () => {
    const tz = DEFAULT_BRAND;
    const own = (s) => String(s || '').trim().toLowerCase();
    const tzClaims = new Set((tz.claims || []).map(own));
    const tzBanned = new Set((tz.voice.banned || []).filter((w) => w.split(' ').length > 1 || w.length > 8).map(own));
    const tzPreferred = new Set((tz.voice.preferred || []).map(own));
    for (const p of PRESETS) {
      if (p.slug === 'knickgasm') continue;   // tenant zero's own preset
      const t = JSON.stringify(p).toLowerCase();
      expect(t, p.slug).not.toContain('knickgasm');
      expect(t, p.slug).not.toContain(own(tz.legal_entity && (tz.legal_entity.name || tz.legal_entity)).slice(0, 24) || '@@none');
      for (const c of p.claims || []) expect(tzClaims.has(own(c)), p.slug + ' claim ' + c).toBe(false);
      for (const w of (p.voice && p.voice.banned) || []) expect(tzBanned.has(own(w)), p.slug + ' banned ' + w).toBe(false);
      expect(((p.voice && p.voice.preferred) || []).filter((w) => tzPreferred.has(own(w))), p.slug).toEqual([]);
      expect(own(p.voice && p.voice.tone)).not.toBe(own(tz.voice.tone));
      // A Shopify URL scheme is a fact about a Shopify store; tenant zero's was on every preset.
      const shopify = /shopify/.test(String((p.catalog_source || {}).kind));
      for (const r of p.regions || []) {
        if (!shopify) expect(r.pdp_pattern, p.slug + ' ' + r.code + ' carries a /products/{handle} scheme its site does not have').toBeUndefined();
        expect(COH.sameBrand(COH.registrableDomain(COH.hostOf(r.store_url)), COH.registrableDomain(COH.hostOf(p.website))), p.slug + ' region store ' + r.store_url).toBe(true);
      }
      for (const o of p.offerings || []) {
        const u = o.url || o.enquiry_url;
        if (u) expect(COH.sameBrand(COH.registrableDomain(COH.hostOf(u)), COH.registrableDomain(COH.hostOf(p.website))), p.slug + ' offering ' + u).toBe(true);
      }
    }
  });

  test('every preset is its own file\'s brand, and its observation was read from its own site', () => {
    for (const p of PRESETS) {
      const of = path.join(ROOT, 'data', 'brands', 'observed', p.slug + '.observed.json');
      expect(fs.existsSync(of), p.slug + ' has no observation').toBe(true);
      const o = JSON.parse(fs.readFileSync(of, 'utf8'));
      expect(o.slug).toBe(p.slug);
      expect(COH.sameBrand(COH.registrableDomain(COH.hostOf(o.start)), COH.registrableDomain(COH.hostOf(p.website))), p.slug + ' observed from ' + o.start).toBe(true);
      for (const r of o.reads || []) if (r.ok && r.owned) expect(r.owned.ok, p.slug + ' read ' + r.url + ' that is not its own').not.toBe(false);
      if (o.logo_url && p.logo_url === o.logo_url) {
        const owned = OWNERSHIP.ownership(o.logo_url, p.website, (o.reads || []).filter((r) => r.link_hosts).map((r) => ({ page: r.url, link_hosts: r.link_hosts })));
        const asset = (p.brand_assets || []).find((a) => a.url === p.logo_url);
        expect(owned.ok || !!(asset && COH.sameBrand(COH.registrableDomain(COH.hostOf(asset.found_on)), COH.registrableDomain(COH.hostOf(p.website)))), p.slug + ' logo ' + p.logo_url).toBe(true);
      }
    }
  });

  test('the shipped presets are what the build script writes', () => {
    const { execFileSync } = require('child_process');
    const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'presets-'));
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-brand-presets.js'), '--out', out], { stdio: 'pipe' });
    for (const p of PRESETS) {
      expect(JSON.parse(fs.readFileSync(path.join(out, p.slug + '.json'), 'utf8')), p.slug).toEqual(p);
    }
  });
});
