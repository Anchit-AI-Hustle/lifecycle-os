/**
 * The brand knowledge documents belong to the ACTIVE brand and open at a real
 * address.
 * ---------------------------------------------------------------------------
 * WHY. Production, 2026-10-05, a phone sign-in in device mode with the brand
 * "Deli Chic" active. /knowledge-base's "Brand Knowledge Base" box said "The
 * canonical Deli Chic truth every tool reads from" and its six cards linked
 * tenant zero's static files under knowledge/brand/. auth.js intercepted every
 * `a[href$=".md"]` and wrote the file into an about:blank window: "KNICKGASM -
 * Brand Foundation", a sneaker studio in Mumbai and its endorsers, in tenant
 * zero's fonts and hexes. Three defects at once: another brand saw tenant
 * zero's documents; the document had no URL; and the shell's rename put the
 * active brand's name on the box, which made the leak read as the brand's own.
 *
 * WHAT IS EXECUTED HERE.
 *   - the rules op (`?action=brand&op=platform-rules`) through the SHIPPED
 *     public-config router, unauthenticated, with every network call guarded:
 *     the cohort table is checked against rfm-core.segmentFor() over the whole
 *     quintile space, the objectives against services.objectiveFor(), the offer
 *     slots against calendar-guardrails.offerFor(), the contracts against
 *     asset-contracts.list();
 *   - brand-knowledge.js's build() for three records (a preset, a brand with
 *     almost nothing on it, tenant zero);
 *   - the real pages in Chromium with a phone sign-in kept on this device and
 *     the brand ACTIVE in the device store (the production state), every card
 *     clicked, every document route opened, every opened window counted, and
 *     the rendered text and the COMPUTED colours of every element read.
 * No assertion reads a source file.
 *
 * Run: npx playwright test tests/brand-docs-per-brand.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const http = require('http');
const H = require('./router-harness');

const ROOT = H.ROOT;
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const K = require(path.join(ROOT, 'brand-knowledge.js'));
const rfm = require(path.join(ROOT, 'api', '_shared', 'rfm-core.js'));
const guardrails = require(path.join(ROOT, 'api', '_shared', 'calendar-guardrails.js'));
const contracts = require(path.join(ROOT, 'api', '_shared', 'asset-contracts.js'));
const services = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));

const ZERO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', '_default.json'), 'utf8'));
const TOI = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'times-of-india.json'), 'utf8'));
/** A brand with almost nothing on its record: a name and a palette that passes
 *  the design rules (an ACTIVE brand must), and no other fact at all. */
const BARE = {
  slug: 'bare-fixture', name: 'Bare Fixture Co',
  palette: { primary: '#1F6F5C', accent: '#1F6F5C', ink: '#1A1A1A', surface: '#FFFFFF' },
  typography: {}, voice: {}, regions: [],
};

/* ── tenant zero's signature, derived from its record where it can be ───── */

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ZERO_SIGNS = (() => {
  const out = [
    { label: 'name ' + ZERO.name, rx: new RegExp(esc(ZERO.name), 'i') },
    { label: 'store host', rx: new RegExp(esc(new URL(ZERO.website).hostname.replace(/^www\./, '')), 'i') },
    { label: 'Mumbai studio', rx: /mumbai studio/i },
    { label: 'sneaker', rx: /\bsneakers?\b/i },
    { label: 'Air Force', rx: /\bair force\b/i },
    { label: 'Jordan', rx: /\bjordans?\b/i },
    { label: 'Dunk', rx: /\bdunks?\b/i },
    { label: 'Samba', rx: /\bsambas?\b/i },
    { label: 'Samay Raina', rx: /samay raina/i },
    { label: 'Rohit Sharma', rx: /rohit sharma/i },
  ];
  String(ZERO.legal_entity || '').split(/,\s*/).map((s) => s.trim()).filter((s) => s && !/^india$/i.test(s))
    .forEach((p) => out.push({ label: 'legal entity: ' + p, rx: new RegExp(esc(p), 'i') }));
  return out;
})();
function hits(str) { return ZERO_SIGNS.filter((s) => s.rx.test(str)).map((s) => s.label + ' ... ' + (str.match(s.rx) || [''])[0]); }

/** Tenant zero's colours as a browser computes them: its primary, its accent
 *  and the text forms derived from them (#D0473E, #6A33D8, #c6433b). */
const ZERO_RGB = (() => {
  const t = core.tokens(ZERO);
  const hexes = [...new Set([ZERO.palette.primary, ZERO.palette.accent, t['--brand-primary-text'], t['--brand-accent-text']].map((h) => String(h).toLowerCase()))];
  const rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
  return hexes.map((h) => ({ hex: h, rgb: rgb(h) }));
})();
const rgbOf = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

/* ── the shipped router, for the one op the documents ask the server ───── */

let routerSrv = null;
test.beforeAll(async () => { routerSrv = await H.serve('api/public-config.js'); });
test.afterAll(async () => { if (routerSrv) await routerSrv.close(); });

/* ═══ 1. the rules are READ from the modules that apply them ═══════════════ */

test('platform-rules answers signed out, from the shipped router, and reaches no network', async () => {
  const guard = H.netGuard({ supabase: false });
  try {
    const anon = await H.request(routerSrv.port, { path: '/api/public-config?action=brand&op=platform-rules' });
    expect(anon.status).toBe(200);
    expect(anon.out.ok).toBe(true);

    // Every RFM segment rfm-core can emit, and each printed cell is the one
    // segmentFor() assigns: walk the whole quintile space through it.
    const seen = new Map();
    for (let r = 1; r <= 5; r++) for (let f = 1; f <= 5; f++) for (let m = 1; m <= 5; m++) {
      const s = rfm.segmentFor(r, f, m);
      if (!seen.has(s.key)) seen.set(s.key, new Set());
      seen.get(s.key).add(`${r}:${Math.round((f + m) / 2)}`);
    }
    const served = anon.out.cohorts.rfm;
    expect(served.map((s) => s.key).sort()).toEqual([...seen.keys()].sort());
    for (const s of served) {
      expect(new Set(s.cells), `${s.name}: the printed rule is not the one segmentFor applies`).toEqual(seen.get(s.key));
      expect(s.objective).toBe(services.objectiveFor(s.name, null));
      expect(s.offer).toEqual(guardrails.offerFor(s.name, s.objective, { name: 'this brand', offers: undefined }));
      // No codes on a brand that declared none: every discounted slot is the marker.
      if (s.offer.pct > 0) expect(s.offer.code).toBe('');
    }
    expect(anon.out.cohorts.default_objective).toBe(services.objectiveFor('', null));
    expect(anon.out.contracts.map((c) => c.id)).toEqual(contracts.list().map((c) => c.id));
    expect(anon.out.contracts.find((c) => c.id === 'ad.google.rsa').structure.some((x) => x.verified)).toBe(true);

    // A carried offers block picks THAT brand's code per slot, and the marker
    // names THAT brand where it has none.
    const offers = { codes: [{ code: 'FIXBACK', rate: 0.15, slot: 'winback' }, { code: 'FIXTEN', rate: 0.1, slot: 'general' }] };
    const carried = await H.request(routerSrv.port, { path: '/api/public-config?action=brand&op=platform-rules', json: { brand: { name: 'Fixture Brand', offers } } });
    expect(carried.status).toBe(200);
    const atRisk = carried.out.cohorts.rfm.find((s) => s.key === 'at_risk');
    expect(atRisk.offer).toEqual(guardrails.offerFor('At Risk', atRisk.objective, { name: 'Fixture Brand', offers }));
    expect(atRisk.offer.code).toBe('FIXBACK');
    expect(carried.out.offers.platform_cap).toBe(guardrails.DISCOUNT_CAP);
    const markerless = await H.request(routerSrv.port, { path: '/api/public-config?action=brand&op=platform-rules', json: { brand: { name: 'Fixture Brand' } } });
    expect(markerless.out.cohorts.rfm.find((s) => s.key === 'at_risk').offer.data_gaps[0]).toMatch(/^\[DATA REQUIRED BEFORE LAUNCH: discount code for the "winback" offer slot, Fixture Brand\]$/);

    expect(guard.calls.map((c) => c.url), 'the rules op reached the network').toEqual([]);
  } finally { guard.restore(); }
});

/* ═══ 2. a document is built from the brand's own record ══════════════════ */

function flat(out) {
  const parts = [out.title, out.lede];
  const walk = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v === 'object') { if (typeof v.text === 'string') parts.push(v.text); Object.keys(v).forEach((k) => { if (k !== 'text') walk(v[k]); }); return; }
  };
  walk(out.blocks);
  return parts.join('\n');
}
async function rulesFor(brand) {
  const r = await H.request(routerSrv.port, { path: '/api/public-config?action=brand&op=platform-rules', json: { brand: { name: brand.name, offers: brand.offers || null } } });
  return r.out;
}

test('build(): a preset and a bare brand get their own facts or the marker, never tenant zero\'s', async () => {
  for (const brand of [TOI, BARE]) {
    const rules = await rulesFor(brand);
    for (const d of K.DOCS) {
      const out = K.build(d.id, { brand, storage: 'device', rules, catalog: { rows: [] }, tokens: core.tokens(brand), nouns: {} });
      const read = flat(out);
      expect(out.title, `${brand.name} / ${d.id}`).toBe(brand.name + ' · ' + d.title);
      expect(hits(read), `${brand.name} / ${d.id} carries tenant zero`).toEqual([]);
    }
  }
  const bare = flat(K.build('foundation', { brand: BARE, rules: await rulesFor(BARE) }));
  for (const f of ['tagline', 'website', 'legal entity', 'logo URL', 'brand story', 'voice tone', 'verifiable claims']) {
    expect(bare).toContain(`[DATA REQUIRED BEFORE LAUNCH: ${f}, ${BARE.name}]`);
  }
  const toi = flat(K.build('foundation', { brand: TOI, rules: await rulesFor(TOI) }));
  expect(toi).toContain(TOI.tagline);
  TOI.claims.forEach((c) => expect(toi).toContain(c));
  TOI.voice.banned.forEach((w) => expect(toi).toContain(w));
  // A rules op that could not be read prints nothing in their place.
  const blind = flat(K.build('cohorts', { brand: TOI, rules: null, rulesError: 'unreachable' }));
  expect(blind).toMatch(/could not be read from the platform: unreachable/);
  expect(blind).not.toMatch(/Champions/);
});

test('docFromPath(): routes, ids, and a brand knowledge file is never a platform document', () => {
  expect(K.docFromPath('/kb/brand/foundation', '')).toEqual({ mode: 'doc', id: 'foundation' });
  expect(K.docFromPath('/brand-doc.html', '?doc=offers')).toEqual({ mode: 'doc', id: 'offers' });
  expect(K.docFromPath('/kb/brand', '')).toEqual({ mode: 'index' });
  expect(K.docFromPath('/kb/brand/nope', '').mode).toBe('unknown');
  expect(K.docFromPath('/doc', '?md=/docs/feature-audit-2026-07-12.md')).toEqual({ mode: 'md', value: '/docs/feature-audit-2026-07-12.md' });
  for (const bad of ['/knowledge/brand/01-brand-foundation.md', '/docs/../knowledge/brand/01-brand-foundation.md', 'https://evil.example/x.md', '//evil.example/docs/x.md']) {
    expect(K.docFromPath('/doc', '?md=' + encodeURIComponent(bad)).mode, bad).toBe('unknown');
  }
});

/* ═══ 3. the real pages, with a phone sign-in kept on this device ═════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
/** The deployment's own rewrites, parameters included, so /kb/brand/<doc> is
 *  served exactly as Vercel serves it: the file, with the address unchanged. */
function rewrite(p) {
  for (const r of VERCEL.rewrites || []) {
    if (!r.source || !r.destination || r.destination.startsWith('/api/')) continue;
    const rx = new RegExp('^' + r.source.split(/(:[a-zA-Z]+\*?)/).map((s) => (s.startsWith(':') ? (s.endsWith('*') ? '.+' : '[^/]+') : esc(s))).join('') + '$');
    if (rx.test(p)) return r.destination.split('?')[0];
  }
  return p;
}
const HOST = 'http://app.example.test';
const LOCAL = 'http://localhost:4598';
const ACCOUNT_WS = '00000000-0000-4000-8000-0000000000d0';
const DEVICE_ID = 'local-docs0000000001';
const ACCOUNT = 'dev-docs0001';
/** Synthetic rows that name no brand's real product. */
const CATALOG = [
  { region: 'IN', sku: 'FX-1', handle: 'fixture-edition-one', title: 'Fixture Edition One', product_type: 'Fixture plan', price: '199.00', currency: 'INR', product_url: 'https://timesofindia.indiatimes.com/fixture-one' },
  { region: 'IN', sku: 'FX-2', handle: 'fixture-edition-two', title: 'Fixture Edition Two', product_type: 'Fixture plan', price: null, currency: 'INR', product_url: '' },
];

/**
 * Two states, both real:
 *   device (default) - a phone sign-in on a deployment with no database
 *            (production's shape): the brand is kept on THIS device, served
 *            at HOST. A brand on the device is never tenant zero, whatever
 *            its record says (BrandContext.isTenantZero).
 *   server - an ACCOUNT brand answered by the server, which stamps
 *            `owns_shipped` (the localhost preview is the one browser state
 *            that takes the server path), served at LOCAL.
 * Returns the origin the pages are served from.
 */
async function install(page, brand, opts) {
  const o = opts || {};
  const server = !!o.server;
  const origin = server ? LOCAL : HOST;
  // On the CONTEXT, so a window the page opens is served the same way.
  const ctx = page.context();
  const seed = Object.assign({}, brand, { id: DEVICE_ID, status: 'active', storage: 'device', owner_id: null });
  await ctx.addInitScript((a) => {
    window.__prints = 0;
    window.print = function () { window.__prints++; };
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) } }) };
    if (a.server) return;
    try {
      if (sessionStorage.getItem('__docs_seeded')) return;   // a navigation keeps what the page wrote
      sessionStorage.setItem('__docs_seeded', '1');
      const expires = new Date(Date.now() + 80 * 86400000).toISOString();
      localStorage.setItem('lifecycle.auth.device.users', JSON.stringify({ '+919876543210': { id: a.account, phone: '+919876543210', cc: '+91', local: '9876543210', name: 'Docs', salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: expires, pinSetAt: expires } }));
      localStorage.setItem('lifecycle.auth.session', JSON.stringify({ token: 'DEVICEtokenFIXTURE0123456789abcdefghijklmnopq', mode: 'device', provider: 'mobile-pin', user: { id: a.account, name: 'Docs', phone: '+919876543210' }, expires, storage: { mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' } }));
      localStorage.setItem('lifecycle.brand.device.workspaces.' + a.account, JSON.stringify({ version: 1, active_id: a.seed.id, workspaces: [a.seed] }));
      if (a.catalog) localStorage.setItem('lifecycle.brand.device.workspaces.' + a.account + '.catalog.' + a.seed.id, JSON.stringify({ products: a.catalog, source: null, owned: true }));
    } catch (_) {}
  }, { seed, account: ACCOUNT, catalog: o.catalog || null, server });
  const hostRx = new RegExp('^https?:\\/\\/(?!' + esc(new URL(origin).host) + ')');
  await ctx.route(hostRx, (route) => {
    if (/\/auth\/v1\/health/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.tailwind=window.tailwind||{};' });
  });
  await ctx.route(origin + '/**', (route) => {
    const u = new URL(route.request().url());
    const p = rewrite(u.pathname === '/' ? '/index.html' : u.pathname);
    const f = path.join(ROOT, decodeURIComponent(p).replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  // The server's answer for an account brand: the record, its tokens, and
  // the server's own word on whether it is tenant zero.
  const account = server ? Object.assign({}, brand, { id: ACCOUNT_WS, status: 'active', owns_shipped: o.ownsShipped === true, tokens: core.tokens(brand), fonts_href: core.fontsHref(brand) }) : null;
  // The localhost preview takes the server path only with no Supabase
  // configured (auth.js decides `local`); a configured project there would
  // read as "signed out" and route brand ops to the device.
  const generic = {
    ok: true, supabase: server ? null : { url: 'https://live.supabase.co', anonKey: 'anon' },
    brand: account, workspaces: account ? [account] : [], active_id: account ? account.id : null, needs_onboarding: false,
    presets: [], products: [], entries: [], items: [], rows: [], campaigns: [], connections: [], providers: [], runs: [], packs: [],
  };
  await ctx.route(/\/api\//, async (route) => {
    const u = new URL(route.request().url());
    // The documents' one server call goes to the SHIPPED router.
    if (u.pathname === '/api/public-config' && u.searchParams.get('action') === 'brand' && u.searchParams.get('op') === 'platform-rules') {
      const req = route.request();
      if (o.rulesDelayMs) await new Promise((res) => setTimeout(res, o.rulesDelayMs));
      const r = await H.request(routerSrv.port, { path: u.pathname + u.search, method: req.method(), raw: req.postData() || null });
      return route.fulfill({ status: r.status, contentType: 'application/json', body: r.text });
    }
    if (!server && u.searchParams.get('action') === 'auth') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' }) });
    if (server && u.searchParams.get('op') === 'context-pack') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, pack: null }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(generic) });
  });
  return origin;
}

async function settled(page, slug) {
  await page.waitForFunction((s) => !!(window.BrandContext && window.BrandContext.brand && String(window.BrandContext.brand.slug || '').toLowerCase() === s), slug, { timeout: 20_000 });
}
async function docReady(page) {
  await page.waitForFunction(() => { const m = document.getElementById('kd-main'); return m && m.getAttribute('aria-busy') === 'false'; }, null, { timeout: 25_000 });
}

/** Everything a person could read, and every element's computed colours. */
const READ = (zero) => {
  const props = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color', 'box-shadow', 'background-image', 'fill', 'stroke'];
  const colourHits = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      for (const z of zero) if (v.indexOf(z.rgb) >= 0) colourHits.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''} ${p} ${z.hex}`);
    }
  }
  const attrs = [];
  document.querySelectorAll('[title],[alt],[aria-label],[placeholder]').forEach((el) => ['title', 'alt', 'aria-label', 'placeholder'].forEach((a) => { if (el.hasAttribute(a)) attrs.push(el.getAttribute(a)); }));
  return { title: document.title, pageText: document.body.innerText + '\n' + attrs.join('\n'), colourHits: [...new Set(colourHits)] };
};

/** Watch every window this context opens. */
function windows(context) {
  const opened = [];
  context.on('page', (p) => opened.push(p));
  return opened;
}

for (const fixture of [
  { label: 'The Times of India (a device preset)', brand: TOI, catalog: CATALOG },
  { label: 'a bare brand', brand: BARE, catalog: null },
]) {
  test(`with ${fixture.label} active: every card and every document is that brand's, at a real address`, async ({ page, context }) => {
    test.setTimeout(240_000);
    const brand = fixture.brand;
    const tokens = core.tokens(brand);
    const opened = windows(context);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await install(page, brand, { catalog: fixture.catalog });

    await page.goto(HOST + '/knowledge-base.html');
    await settled(page, brand.slug);
    await page.waitForTimeout(600);
    // The box: links whose ADDRESS is the document's (copy-link, middle-click
    // and share all read the href, not a click handler), in the brand's tokens.
    const cards = await page.$$eval('#brandKbGrid a', (as) => as.map((a) => ({ href: a.getAttribute('href'), label: a.firstChild.textContent.trim() })));
    expect(cards.length).toBe(K.DOCS.length + 1);
    expect(cards.slice(0, K.DOCS.length).map((c) => c.href)).toEqual(K.DOCS.map((d) => '/kb/brand/' + d.id));
    const kb = await page.evaluate(READ, ZERO_RGB);
    expect(kb.colourHits, 'tenant zero\'s colours on /knowledge-base').toEqual([]);
    expect(hits(kb.pageText), 'tenant zero on /knowledge-base').toEqual([]);
    const lede = await page.locator('.bkb-lede').innerText();
    expect(lede).toContain(brand.name);
    expect(await page.locator('.bkb-cta').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgbOf(tokens['--brand-primary']));

    // Every card, pressed the way a person presses it.
    for (let i = 0; i < cards.length; i++) {
      await page.goto(HOST + '/knowledge-base.html');
      await settled(page, brand.slug);
      const before = opened.length;
      await page.locator('#brandKbGrid a').nth(i).click();
      await page.waitForURL((u) => u.pathname !== '/knowledge-base.html', { timeout: 10_000 }).catch(() => {});
      expect(opened.slice(before).map((p) => p.url()), `card "${cards[i].label}" opened a window instead of the document`).toEqual([]);
      const u = new URL(page.url());
      expect(u.protocol).toBe('http:');
      expect(u.pathname + u.search).toBe(cards[i].href);
    }

    // Every document route, opened directly (bookmarked, shared).
    for (const d of K.DOCS) {
      await page.goto(HOST + '/kb/brand/' + d.id);
      await docReady(page);
      await page.waitForTimeout(200);
      const seen = await page.evaluate(READ, ZERO_RGB);
      expect(page.url()).toBe(HOST + '/kb/brand/' + d.id);
      expect(seen.title, d.id).toContain(brand.name);
      expect(seen.title, d.id).toContain(d.title);
      expect(seen.pageText, d.id).toContain(brand.name);
      expect(hits(seen.title + '\n' + seen.pageText), `tenant zero in /kb/brand/${d.id}`).toEqual([]);
      expect(seen.colourHits, `tenant zero's colours in /kb/brand/${d.id}`).toEqual([]);
      // The colours ARE this brand's tokens: headings in its primary-as-text,
      // the print button in its primary with its derived on-primary label.
      const h2 = page.locator('#kd-body h2').first();
      expect(await h2.evaluate((el) => getComputedStyle(el).color)).toBe(rgbOf(tokens['--brand-primary-text']));
      expect(await page.locator('#kd-print').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgbOf(tokens['--brand-primary']));
      expect(await page.locator('#kd-print').evaluate((el) => getComputedStyle(el).color)).toBe(rgbOf(tokens['--brand-on-primary']));
      // The rail names the document's own row, not Home.
      expect(await page.evaluate(() => (document.querySelector('#lifecycle-nav .lnav-link.active') || {}).textContent || '')).toMatch(/Brand Documents/);
    }

    // What a brand that did not provide a fact is shown.
    await page.goto(HOST + '/kb/brand/foundation');
    await docReady(page);
    const foundation = await page.locator('#kd-body').innerText();
    if (brand === BARE) {
      expect(foundation).toContain(`[DATA REQUIRED BEFORE LAUNCH: tagline, ${brand.name}]`);
      expect(foundation).toContain(`[DATA REQUIRED BEFORE LAUNCH: verifiable claims, ${brand.name}]`);
    } else {
      expect(foundation).toContain(brand.tagline);
      expect(foundation).toContain(brand.claims[0]);
    }
    await page.goto(HOST + '/kb/brand/catalog');
    await docReady(page);
    const catalog = await page.locator('#kd-body').innerText();
    if (fixture.catalog) {
      expect(catalog).toContain('Fixture Edition One');
      expect(catalog).toContain(`[DATA REQUIRED BEFORE LAUNCH: price, ${brand.name}, IN]`);
    } else expect(catalog).toContain(`[DATA REQUIRED BEFORE LAUNCH: product catalogue, ${brand.name}]`);
    await page.goto(HOST + '/kb/brand/cohorts');
    await docReady(page);
    expect(await page.locator('#kd-body').innerText()).toContain('Champions');

    // Save as PDF prints THIS page from its own address, never a window.
    await page.goto(HOST + '/kb/brand/offers');
    await docReady(page);
    const before = opened.length;
    await page.locator('#kd-print').click();
    expect(await page.evaluate(() => window.__prints)).toBe(1);
    expect(opened.length).toBe(before);
    expect(page.url()).toBe(HOST + '/kb/brand/offers');

    // No window was ever opened, so none could be blank, data: or blob:.
    expect(opened.map((p) => p.url())).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('Save as PDF prints the whole document alone, even one that arrived after the page settled', async ({ page }) => {
  test.setTimeout(120_000);
  // The rules answer slowly (a phone on a poor network), so the document is
  // drawn after the shell's scroll-reveal has armed. A heading below the fold
  // that waits for a scroll to fade in prints as a blank band.
  await install(page, BARE, { rulesDelayMs: 4500 });
  await page.goto(HOST + '/kb/brand/creative');
  await docReady(page);
  await page.waitForTimeout(800);
  await page.emulateMedia({ media: 'print' });
  const print = await page.evaluate(() => ({
    rail: getComputedStyle(document.getElementById('lifecycle-nav')).display,
    toolbar: getComputedStyle(document.querySelector('[data-kd-noprint]')).display,
    margin: getComputedStyle(document.body).marginLeft,
    faded: Array.from(document.querySelectorAll('#kd-body h2, #kd-body h3, #kd-body table')).filter((h) => +getComputedStyle(h).opacity < 1).map((h) => h.textContent.slice(0, 40)),
    headings: document.querySelectorAll('#kd-body h2').length,
  }));
  await page.emulateMedia({ media: 'screen' });
  expect(print.rail).toBe('none');
  expect(print.toolbar).toBe('none');
  expect(print.margin).toBe('0px');
  expect(print.headings).toBeGreaterThan(5);
  expect(print.faded, 'a part of the document prints invisible').toEqual([]);
});

/** The shipped markdown's first paragraph, as the viewer prints it. */
function firstParagraph(d) {
  const md = fs.readFileSync(path.join(ROOT, d.file.replace(/^\//, '')), 'utf8');
  const first = K.parseMarkdown(md).find((b) => b.t === 'p');
  return { md, h1: ((md.match(/^#\s+(.+)$/m) || [])[1] || '').trim(), first: first.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim() };
}

test('tenant zero (the server\'s answer, owns_shipped) still gets its own shipped documents, at the same addresses', async ({ page }) => {
  test.setTimeout(120_000);
  const at = await install(page, ZERO, { server: true, ownsShipped: true });
  for (const d of K.DOCS) {
    await page.goto(at + '/kb/brand/' + d.id);
    await docReady(page);
    const { h1, first } = firstParagraph(d);
    expect(await page.locator('#kd-title').innerText()).toBe(h1);
    const docText = (await page.locator('#kd-body').innerText()).replace(/\s+/g, ' ');
    expect(docText.length, d.id).toBeGreaterThan(500);
    // Its OWN content: the file's first paragraph, as written.
    expect(docText, d.id).toContain(first);
  }
});

for (const impostor of [
  { label: 'a brand on this device made from the KNICKGASM template', opts: {} },
  { label: 'an account workspace the server says is NOT tenant zero', opts: { server: true, ownsShipped: false } },
]) {
  test(`${impostor.label} gets documents built from its own record, never the shipped files`, async ({ page }) => {
    test.setTimeout(120_000);
    // Tenant zero's record under another workspace: the slug says "knickgasm",
    // and a slug is the client's. Only the server's owns_shipped is believed.
    const at = await install(page, ZERO, impostor.opts);
    for (const d of K.DOCS) {
      await page.goto(at + '/kb/brand/' + d.id);
      await docReady(page);
      const { h1, first } = firstParagraph(d);
      expect(await page.locator('#kd-title').innerText(), d.id).toBe(ZERO.name + ' · ' + d.title);
      expect(await page.locator('#kd-title').innerText(), d.id).not.toBe(h1);
      const docText = (await page.locator('#kd-body').innerText()).replace(/\s+/g, ' ');
      expect(docText, `${d.id} rendered the shipped file`).not.toContain(first);
    }
  });
}

test('the written feature audit opens at a real address, for the workspace it was written about only', async ({ page, context }) => {
  test.setTimeout(120_000);
  const opened = windows(context);
  await install(page, TOI);
  await page.goto(HOST + '/app-audit.html');
  await settled(page, TOI.slug);
  await page.waitForTimeout(600);
  // The audit page offers no link to it for another brand.
  expect(await page.locator('a[href*="feature-audit"]').count(), 'the audit is offered to another brand').toBe(0);
  // Its address, opened directly, refuses too, and shows none of it.
  await page.goto(HOST + '/doc?md=/docs/feature-audit-2026-07-12.md');
  await docReady(page);
  const refused = await page.evaluate(READ, ZERO_RGB);
  expect(refused.title + refused.pageText).toMatch(/not shown for The Times of India/);
  expect(hits(refused.title + '\n' + refused.pageText)).toEqual([]);
  expect(refused.pageText).not.toMatch(/Feature Quality Audit/);
  expect(opened.map((p) => p.url())).toEqual([]);
});

test('the workspace the audit was written about opens it in the viewer, at /doc?md=', async ({ page, context }) => {
  test.setTimeout(120_000);
  const opened = windows(context);
  const at = await install(page, ZERO, { server: true, ownsShipped: true });
  // A link to the raw file (as the docs and old pages carry) is retargeted
  // to the viewer, in the same tab.
  await page.goto(at + '/app-audit.html');
  await settled(page, ZERO.slug);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p><a id="t-zaudit" href="/docs/feature-audit-2026-07-12.md">Audit</a></p>'));
  await page.locator('#t-zaudit').click();
  await page.waitForURL(/\/doc\?md=/, { timeout: 10_000 }).catch(() => {});
  expect(new URL(page.url()).searchParams.get('md')).toBe('/docs/feature-audit-2026-07-12.md');
  expect(opened.map((p) => p.url()), 'the audit opened a window').toEqual([]);
  await docReady(page);
  expect(await page.locator('#kd-title').innerText()).toMatch(/Feature Quality Audit/);
  expect((await page.locator('#kd-body').innerText()).length).toBeGreaterThan(2000);
});

/* ═══ growth-book: tenant zero's competitor studies ═══════════════════════ */

const GROWTH_BOOK = fs.readdirSync(path.join(ROOT, 'growth-book', 'brands')).filter((f) => f.endsWith('.html')).sort();

test('growth-book: another brand never sees a frame of tenant zero\'s competitor studies, and is shown its own set', async ({ page }) => {
  test.setTimeout(300_000);
  expect(GROWTH_BOOK.length, 'no growth-book pages found').toBeGreaterThan(10);
  await page.addInitScript(() => {
    window.__frames = { n: 0, leaks: [] };
    const RX = /knickgasm|sneaker|air force|jordan|samay raina/i;
    const tick = () => {
      const study = document.getElementById('gb-study');
      if (study) {
        window.__frames.n++;
        const visible = getComputedStyle(study).visibility === 'visible' && study.getBoundingClientRect().height > 0;
        const m = study.textContent.match(RX);
        if (visible && m && window.__frames.leaks.length < 5) window.__frames.leaks.push(m[0]);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await install(page, TOI);
  for (const f of GROWTH_BOOK) {
    await page.goto(HOST + '/growth-book/brands/' + f);
    await settled(page, TOI.slug);
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gb-hold'), null, { timeout: 15_000 });
    await page.waitForTimeout(300);
    const frames = await page.evaluate(() => window.__frames);
    expect(frames.n, `${f}: no frame sampled`).toBeGreaterThan(2);
    expect(frames.leaks, `${f}: a frame showed tenant zero's study`).toEqual([]);
    const seen = await page.evaluate(READ, ZERO_RGB);
    expect(hits(seen.title + '\n' + seen.pageText), `tenant zero on ${f}`).toEqual([]);
    expect(seen.colourHits, `tenant zero's colours on ${f}`).toEqual([]);
    expect(seen.title).toContain(TOI.name);
    // The Times of India's record names no competitors: its own state, said.
    expect(seen.pageText).toContain(`[DATA REQUIRED BEFORE LAUNCH: competitor set, ${TOI.name}]`);
  }
});

test('growth-book: tenant zero (the server\'s answer) still reads its own studies', async ({ page }) => {
  test.setTimeout(120_000);
  const at = await install(page, ZERO, { server: true, ownsShipped: true });
  await page.goto(at + '/growth-book/brands/stockx.html');
  await settled(page, ZERO.slug);
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-gb-hold'), null, { timeout: 15_000 });
  expect(await page.locator('#gb-study h1').innerText()).toBe('StockX vs ' + ZERO.name);
  expect(await page.locator('#gb-own').isHidden()).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('gb-study')).visibility)).toBe('visible');
});

/* ═══ the rail offers a market's study only for a market the brand serves ═ */

test('the rail\'s per-market study rows follow the active brand\'s own markets', async ({ page }) => {
  test.setTimeout(120_000);
  const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('#lifecycle-nav a[data-id^="research-"]')).filter((a) => a.getAttribute('data-id') !== 'research-all' && a.offsetParent !== null && !(a.closest('.lnav-item') || a).hidden).map((a) => a.getAttribute('data-study-region') || a.getAttribute('data-id')).sort());
  await install(page, TOI);
  await page.goto(HOST + '/research');
  await settled(page, TOI.slug);
  await page.waitForTimeout(400);
  expect(await rows()).toEqual(['IN']);
  const bare = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 } });
  const p2 = await bare.newPage();
  await install(p2, BARE);
  await p2.goto(HOST + '/research');
  await settled(p2, BARE.slug);
  await p2.waitForTimeout(400);
  expect(await p2.evaluate(() => Array.from(document.querySelectorAll('#lifecycle-nav a[data-id^="research-"]')).filter((a) => a.getAttribute('data-id') !== 'research-all' && a.offsetParent !== null && !(a.closest('.lnav-item') || a).hidden).length)).toBe(0);
  // Its Market Study names the gap for THIS brand, unpadded.
  expect(await p2.locator('#msRegionTabs [data-region-none]').innerText()).toBe(`[DATA REQUIRED BEFORE LAUNCH: regions, ${BARE.name}]`);
  await bare.close();
});

test('a .md link anywhere lands on a real address, and generated markdown opens at one too', async ({ page, context }) => {
  test.setTimeout(120_000);
  const opened = windows(context);
  await install(page, TOI);
  await page.goto(HOST + '/knowledge-base.html');
  await settled(page, TOI.slug);
  // A link to tenant zero's own file, pressed on another brand: the ACTIVE
  // brand's document, in this tab, and no window of any kind.
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p><a id="t-md" href="/knowledge/brand/01-brand-foundation.md">Doc</a></p>'));
  await page.locator('#t-md').click();
  await page.waitForURL(/\/kb\/brand\/foundation$/, { timeout: 10_000 }).catch(() => {});
  expect(opened.map((p) => p.url()), 'a .md link opened a window').toEqual([]);
  expect(new URL(page.url()).pathname).toBe('/kb/brand/foundation');
  await docReady(page);
  expect(hits(await page.evaluate(() => document.title + '\n' + document.body.innerText))).toEqual([]);
  expect(await page.locator('#kd-title').innerText()).toBe(TOI.name + ' · Brand Foundation');

  // The files auth.js retargets on every page are exactly the documents the
  // viewer knows (auth.js keeps its own copy of the table).
  await page.goto(HOST + '/knowledge-base.html');
  await settled(page, TOI.slug);
  const table = await page.evaluate((files) => files.map((f) => (typeof window.__docViewerFor === 'function' ? window.__docViewerFor('/knowledge/brand/' + f) : null)), Object.keys(K.ZERO_FILES));
  expect(table).toEqual(Object.keys(K.ZERO_FILES).map((f) => K.hrefFor(K.ZERO_FILES[f])));

  // A platform document under /docs/ lands on the viewer at its own address
  // (and this one, written about another workspace, says so and shows none
  // of itself to this brand).
  await page.goto(HOST + '/knowledge-base.html');
  await settled(page, TOI.slug);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p><a id="t-audit" href="/docs/feature-audit-2026-07-12.md">Audit</a></p>'));
  await Promise.all([page.waitForURL(/\/doc\?md=/), page.locator('#t-audit').click()]);
  await docReady(page);
  expect(new URL(page.url()).searchParams.get('md')).toBe('/docs/feature-audit-2026-07-12.md');
  expect(await page.locator('#kd-eyebrow').innerText()).toMatch(/platform document/i);
  expect(hits(await page.evaluate(() => document.title + '\n' + document.body.innerText))).toEqual([]);

  // window.__mdToPdf (the social blog export): a real address, rendered in
  // this brand's tokens, never an about:blank window.
  await page.goto(HOST + '/knowledge-base.html');
  await settled(page, TOI.slug);
  const [win] = await Promise.all([context.waitForEvent('page'), page.evaluate(() => window.__mdToPdf('# Fixture blog title\n\nA paragraph of the post.', 'Fixture post'))]);
  await win.waitForLoadState();
  const u = new URL(win.url());
  expect(u.origin).toBe(HOST);
  expect(u.pathname).toBe('/doc');
  expect(u.searchParams.get('local')).toMatch(/^[a-z0-9]+$/);
  await docReady(win);
  expect(await win.locator('#kd-title').innerText()).toBe('Fixture blog title');
  expect(await win.locator('#kd-body').innerText()).toContain('A paragraph of the post.');
  expect((await win.evaluate(READ, ZERO_RGB)).colourHits).toEqual([]);
  expect(opened.map((p) => p.url()).every((x) => /^http:\/\//.test(x))).toBe(true);
});

test('/research never paints the built brand\'s study for another brand, not even before the brand settles', async ({ page }) => {
  test.setTimeout(120_000);
  // Sampled every frame from the first one: any frame in which the study block
  // is visible while it still holds the built brand's text is a leak.
  await page.addInitScript(() => {
    window.__frames = { n: 0, leaks: [] };
    const RX = /knickgasm|sneaker|air force|jordan/i;
    const tick = () => {
      const host = document.getElementById('brand-study');
      if (host) {
        window.__frames.n++;
        const visible = getComputedStyle(host).visibility === 'visible' && host.getBoundingClientRect().height > 0;
        const m = host.textContent.match(RX);
        if (visible && m && window.__frames.leaks.length < 5) window.__frames.leaks.push(m[0]);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await install(page, TOI);
  await page.goto(HOST + '/research');
  await settled(page, TOI.slug);
  await page.waitForFunction(() => document.getElementById('brand-study').getAttribute('data-ms-rendered-for') === 'times-of-india', null, { timeout: 20_000 });
  await page.waitForTimeout(300);
  const frames = await page.evaluate(() => window.__frames);
  expect(frames.n, 'no frame was sampled').toBeGreaterThan(3);
  expect(frames.leaks, 'a frame showed the built brand\'s study').toEqual([]);
  const seen = await page.evaluate(READ, ZERO_RGB);
  expect(hits(seen.pageText)).toEqual([]);
  expect(seen.colourHits).toEqual([]);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('brand-study')).visibility)).toBe('visible');
});
