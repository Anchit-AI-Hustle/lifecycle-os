/**
 * Readers in each country (2026-10-12).
 * ---------------------------------------------------------------------------
 * The operator's decision: a market whose store sends this (US) server to
 * another country's store - Lenskart India, UAE, Saudi Arabia, Thailand - is
 * read by a small server that RUNS in that country (readers/). The request
 * really originates there; nothing about it pretends anything.
 *
 * Everything here is EXECUTED:
 *   - the shipped reader handler (readers/lib/handler.js createReader) served
 *     on 127.0.0.1 over a real socket, its signature, clock, address and body
 *     rules driven with real requests;
 *   - the shipped importer (core.importCatalog -> catalog-import.js) with
 *     CATALOG_READERS / CATALOG_READER_SECRET set, against the fixture stores;
 *   - scripts/market-probe.js probeBrand through the same reader.
 *
 * WHERE A REQUEST COMES FROM is modelled by the CONNECTION, never by a header
 * the reader could send: the fixture stores listen on a second socket (the
 * "IN entrance", tests/lib/catalog-fixture-stores.js) and a request arriving on
 * it is a request from India. The test's IN reader is DIALLED to that socket
 * by a code-level hook of createReader (`hooks.dial`), which nothing in a
 * request can set; the production export `handler` is built without hooks.
 *
 * Run: npx playwright test tests/catalog-readers.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const http = require('http');
const dns = require('dns');

const NATIVE_FETCH = global.fetch;
const { startStores, PUBLIC_ADDR } = require('./lib/catalog-fixture-stores.js');
const core = require('../api/_shared/brand-workspace-core.js');
const imp = require('../api/_shared/catalog-import.js');
const client = require('../api/_shared/catalog-reader-client.js');
const reader = require('../readers/lib/handler.js');
const ssrf = require('../readers/lib/ssrf.js');
const probe = require('../scripts/market-probe.js');

const PHONE = { ok: true, provider: 'mobile-pin', mode: 'device', user_id: 'device:abc', token: 'MPINtokenFIXTURE0123456789abcdefghijklmnopqrs' };
const SECRET = 'reader-secret-for-the-spec-0123456789abcdef';

test.describe.configure({ mode: 'serial' });

let st;
const servers = [];
test.beforeAll(async () => { st = await startStores(); });
test.afterAll(async () => {
  for (const s of servers) await new Promise((r) => s.close(() => r()));
  if (st) await st.close();
});

/** The fixture hosts resolve to a documentation-range public address; anything else is the real resolver. */
const fixtureResolve = async (host) => (/\.example$/i.test(host)
  ? (/^internal-rebind\./i.test(host) ? [{ address: '10.0.0.7', family: 4 }] : [{ address: PUBLIC_ADDR, family: 4 }])
  : dns.promises.lookup(host, { all: true, verbatim: true }));

/** A reader on 127.0.0.1. `entrance`: which socket of the stores it is dialled to ('IN' = the IN entrance). */
async function startReader({ env, entrance = 'IN', noHooks = false } = {}) {
  let calls = 0;
  const h = reader.createReader({
    env: Object.assign({ READER_SECRET: SECRET, READER_COUNTRY: 'IN', READER_REGION: 'bom1' }, env || {}),
    hooks: noHooks ? undefined : {
      resolve: fixtureResolve,
      dial: () => ({ protocol: 'http:', hostname: '127.0.0.1', port: entrance === 'IN' ? st.inPort : st.port }),
    },
  });
  const srv = http.createServer((req, res) => { calls += 1; h(req, res); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  return { base: `http://127.0.0.1:${srv.address().port}`, port: srv.address().port, calls: () => calls, close: () => new Promise((r) => srv.close(() => r())) };
}

/** POST a read, signed (or not) as given. */
async function ask(base, { url, ts = Date.now(), secret = SECRET, sig, accept, path = '/api/read', method = 'POST', signFor } = {}) {
  const headers = { 'content-type': 'application/json' };
  const s = sig !== undefined ? sig : (secret ? client.sign(secret, String(ts), signFor || url) : null);
  if (s) headers['x-reader-signature'] = s;
  const r = await NATIVE_FETCH(base + path, { method, headers, body: method === 'POST' ? JSON.stringify({ url, ts, accept }) : undefined });
  let j = null; try { j = await r.json(); } catch (_) { j = null; }
  return { status: r.status, j };
}

const ENV = ['CATALOG_READERS', 'CATALOG_READER_SECRET', 'VERCEL_REGION'];
/** The importer's world: fixture stores on global.fetch, the reader on its real socket. */
function importerWorld(readers, secret) {
  st.reset();
  const saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  delete process.env.VERCEL_REGION;
  if (readers) process.env.CATALOG_READERS = JSON.stringify(readers); else delete process.env.CATALOG_READERS;
  if (secret) process.env.CATALOG_READER_SECRET = secret; else delete process.env.CATALOG_READER_SECRET;
  st.install({ passthrough: (input, init) => {
    const u = String(input && input.url ? input.url : input);
    if (/^http:\/\/127\.0\.0\.1:\d+\//.test(u)) return NATIVE_FETCH(input, init);
    throw new Error('a request left the fixture world: ' + u);
  } });
  return { restore() { st.restore(); for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } } };
}
const said = (cov) => (cov && cov.sentences ? cov.sentences.join(' ') : '');
const lens = 'https://lensworld.example';

/* ── the reader, on its own ─────────────────────────────────────────────── */

test('the reader refuses an unsigned, forged, wrongly-scoped, expired or future-dated request, and a reader with no (or a short) READER_SECRET reads nothing', async () => {
  const R = await startReader();
  const url = `${lens}/robots.txt`;
  st.reset();
  // A correctly signed read works (the baseline every refusal is measured against).
  const good = await ask(R.base, { url });
  expect(good.status).toBe(200);
  expect(good.j.ok).toBe(true);
  expect(Buffer.from(good.j.body_base64, 'base64').toString('utf8')).toContain('Sitemap:');
  st.reset();
  for (const [name, o] of [
    ['unsigned', { url, sig: null, secret: null }],
    ['forged with another secret', { url, secret: 'another-secret-0123456789abcdefghijkl' }],
    ['malformed signature', { url, sig: 'zz' }],
    ['signed for another URL', { url, signFor: `${lens}/` }],
    ['expired (121 s old)', { url, ts: Date.now() - 121000 }],
    ['from the future (121 s ahead)', { url, ts: Date.now() + 121000 }],
  ]) {
    const r = await ask(R.base, o);
    expect(r.status, name).toBe(401);
    expect(r.j.ok, name).toBe(false);
  }
  expect(st.hits['lensworld.example'] || [], 'a refused request fetched nothing').toHaveLength(0);
  for (const bad of ['', 'short-secret-0123456789']) {
    const U = await startReader({ env: { READER_SECRET: bad } });
    const r = await ask(U.base, { url, secret: bad || 'x' });
    expect(r.status).toBe(401);
    expect(r.j.error).toBe('reader_unconfigured');
  }
  expect(st.hits['lensworld.example'] || []).toHaveLength(0);
  // A read is a POST; health fetches nothing and says where it runs.
  expect((await ask(R.base, { url, method: 'GET' })).status).toBe(405);
  const h = await NATIVE_FETCH(R.base + '/api/health').then((x) => x.json());
  expect(h).toEqual({ ok: true, country: 'IN', region: 'bom1' });
  const h2 = await NATIVE_FETCH(R.base + '/health').then((x) => x.json());
  expect(h2.country).toBe('IN');
  expect(st.hits['lensworld.example'] || []).toHaveLength(0);
});

test('the reader refuses a non-public target, directly AND as a redirect hop, and never connects to it', async () => {
  const R = await startReader();
  st.reset();
  for (const url of [
    'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
    'http://10.1.2.3/', 'http://192.168.0.1/', 'http://localhost/', 'http://metadata.google.internal/',
    'https://internal-rebind.example/', `${lens}:8080/`, 'ftp://lensworld.example/x', 'file:///etc/passwd',
  ]) {
    const r = await ask(R.base, { url });
    expect(r.status, url).toBe(400);
    expect(r.j.ok, url).toBe(false);
  }
  // A public store that redirects onto the metadata address, and onto a name
  // that resolves to a private address: refused at the hop, with the hops said.
  for (const p of ['/__go-metadata', '/__go-private-name']) {
    const r = await ask(R.base, { url: `${lens}${p}` });
    expect(r.status, p).toBe(400);
    expect(r.j.error, p).toBe('private_address');
    expect(r.j.hops, p).toEqual([{ url: `${lens}${p}`, status: 302 }]);
  }
  // The dialler sends EVERY connection to the fixture socket, so a target
  // that got past the guard would show up there under its own host.
  expect(Object.keys(st.hits).filter((h) => h !== 'lensworld.example')).toEqual([]);
  expect((st.hits['lensworld.example'] || []).map((h) => h.path).sort()).toEqual(['/__go-metadata', '/__go-private-name']);
  // At most five redirects.
  const loop = await ask(R.base, { url: `${lens}/__loop/0` });
  expect(loop.status).toBe(200);
  expect(loop.j).toMatchObject({ ok: false, error: 'too_many_redirects' });
  expect(loop.j.hops).toHaveLength(6);
});

test('the reader\'s address rules are the importer\'s (assertPublicUrl) for every literal address', async () => {
  const urls = ['http://127.0.0.1/', 'http://169.254.169.254/', 'http://[::1]/', 'http://[::ffff:7f00:1]/', 'http://[fe80::1]/', 'http://[fd00::1]/',
    'http://10.0.0.1/', 'http://172.16.5.4/', 'http://172.32.0.1/', 'http://100.64.0.1/', 'http://192.0.0.8/', 'http://224.0.0.1/', 'http://0.0.0.0/',
    'http://93.184.216.34/', 'http://8.8.8.8/', 'http://[2606:4700::1111]/', 'http://[64:ff9b::a00:1]/', 'http://localhost/', 'http://x.internal/', 'http://8.8.8.8:8443/'];
  for (const u of urls) {
    const a = await core.assertPublicUrl(u).then(() => 'ok', () => 'refused');
    const b = await ssrf.check(u).then(() => 'ok', () => 'refused');
    expect(b, u).toBe(a);
  }
});

test('the reader cuts a body at 8 MB, sends only Host / User-Agent / Accept (the importer\'s own user agent), and says where it runs', async () => {
  const R = await startReader();
  st.reset();
  const r = await ask(R.base, { url: `${lens}/__big`, accept: 'text/html' });
  expect(r.status).toBe(200);
  expect(r.j.truncated).toBe(true);
  expect(Buffer.from(r.j.body_base64, 'base64').length).toBe(8 * 1024 * 1024);
  expect(r.j.reader).toEqual({ country: 'IN', region: 'bom1' });
  const hit = st.hits['lensworld.example'][0];
  expect(hit.from).toBe('IN');
  expect(reader.USER_AGENT).toBe(imp.USER_AGENT);
  expect(hit.ua).toBe(imp.USER_AGENT);
  expect(hit.cookie).toBeNull();
  expect(hit.lang).toBeNull();
  expect(hit.forwarded).toBeNull();
  // Every header the store received: nothing that could describe a person or a place.
  expect(hit.headers.filter((k) => !['host', 'user-agent', 'accept', 'connection'].includes(k))).toEqual([]);
});

/* ── the importer through a reader ──────────────────────────────────────── */

test('a market whose store geo-redirects THIS server is read whole through a reader in that country: IN rows filed under IN in INR, said per market, the same user agent and no disguise', async () => {
  test.setTimeout(150_000);
  const R = await startReader();
  const w = importerWorld({ IN: R.base }, SECRET);
  st.stores['lensworld.example'].geo = 'US';
  try {
    const T = st.stores['lensworld.example'].truth;
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: lens, brand: { website: lens } });
    const inRows = r.products.filter((p) => p.region === 'in');
    expect(inRows).toHaveLength(T.inProducts - T.inStale - T.inWrongCurrency);
    expect(new Set(inRows.map((p) => p.currency))).toEqual(new Set(['INR']));
    expect(inRows.every((p) => /^https:\/\/lensworld\.example\/frame-/.test(p.product_url))).toBe(true);
    expect(r.markets.find((m) => m.code === 'IN')).toMatchObject({ complete: true, blocked: false, read_from: 'a server in IN' });
    expect(r.coverage.sentences[0]).toContain(`IN: ${inRows.length} of 600 (read from a server in IN)`);
    expect(said(r.coverage)).toContain(`IN: read from a server in IN (reader 127.0.0.1:${R.port})`);
    expect(said(r.coverage)).not.toContain('sent requests for its IN pages');
    // The other markets were read directly, as before; only IN went through its reader.
    expect(r.products.filter((p) => p.region === 'ae')).toHaveLength(T.ae);
    const all = st.hits['lensworld.example'] || [];
    const frames = all.filter((h) => /^\/frame-\d+\.html$/.test(h.path));
    expect(frames.length).toBeGreaterThan(500);
    expect(frames.every((h) => h.from === 'IN')).toBe(true);
    // AE's product PAGES were read by AE's own step, directly (IN's step reads
    // the other markets' sitemaps only to count them, through IN's reader).
    const aePages = all.filter((h) => /^\/en-ae\/.*\.html$/.test(h.path));
    expect(aePages.length).toBeGreaterThan(0);
    expect(aePages.every((h) => h.from === '')).toBe(true);
    expect(R.calls()).toBeGreaterThan(500);
    // No disguise anywhere: the platform's own user agent, no cookie, no
    // forwarded address, no Accept-Language but Node's own "*" on direct reads.
    expect([...new Set(all.map((h) => h.lang))].filter((x) => x && x !== '*')).toEqual([]);
    expect(all.every((h) => !h.cookie && !h.forwarded && h.ua === imp.USER_AGENT)).toBe(true);
    expect(frames.every((h) => h.lang === null)).toBe(true);
  } finally { w.restore(); }
});

test('a reader that is DOWN is said in a sentence and the market falls back to the direct read, with the geo-redirect sentence as before', async () => {
  test.setTimeout(150_000);
  const R = await startReader();
  await R.close();
  const w = importerWorld({ IN: R.base }, SECRET);
  st.stores['lensworld.example'].geo = 'US';
  try {
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: lens, brand: { website: lens } });
    expect(r.products.filter((p) => p.region === 'in')).toHaveLength(0);
    expect(said(r.coverage)).toContain(`IN's reader (127.0.0.1:${R.port}) could not be used: it could not be reached`);
    expect(said(r.coverage)).toContain('lensworld.example sent requests for its IN pages to its US store (/en-us/)');
    expect(said(r.coverage)).toContain('IN\'s own catalogue needs the import run from a server in IN, or a CSV of it.');
    expect(r.coverage.sentences[0]).toContain('IN: 0 of 600 (sent to the US store from here)');
  } finally { w.restore(); }
});

test('a reader that REFUSES the importer (its secret is not the importer\'s) is said and the market is read directly; with no CATALOG_READER_SECRET no reader is called at all', async () => {
  test.setTimeout(150_000);
  const R = await startReader({ env: { READER_SECRET: 'the-readers-own-secret-0123456789abcdef' } });
  let w = importerWorld({ IN: R.base }, SECRET);
  st.stores['lensworld.example'].geo = 'US';
  try {
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: lens, brand: { website: lens } });
    expect(said(r.coverage)).toContain('could not be used: it refused the request (401 bad_signature)');
    expect(said(r.coverage)).toContain('sent requests for its IN pages to its US store');
  } finally { w.restore(); }
  const before = R.calls();
  w = importerWorld({ IN: R.base }, '');
  st.stores['lensworld.example'].geo = 'US';
  try {
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: lens, brand: { website: lens } });
    expect(said(r.coverage)).toContain(`A reader is configured for IN (127.0.0.1:${R.port}), but CATALOG_READER_SECRET is not set or is shorter than 32 characters, so IN was read directly`);
    expect(R.calls()).toBe(before);
  } finally { w.restore(); }
});

test('a reader the store STILL treats as outside the market is detected exactly as a direct read is: nothing filed under IN, the reader named, never a disguise', async () => {
  test.setTimeout(150_000);
  const R = await startReader({ entrance: 'main' });   // configured "IN", but its connections do not come from IN
  const w = importerWorld({ IN: R.base }, SECRET);
  st.stores['lensworld.example'].geo = 'US';
  try {
    const r = await core.importCatalog(PHONE, { region: 'in', kind: 'storefront', url: lens, brand: { website: lens } });
    expect(r.products.filter((p) => p.region === 'in')).toHaveLength(0);
    const redirected = r.products.filter((p) => p.region === 'us' && /\/en-us\/frame-0\d{3}\.html$/.test(p.product_url));
    expect(redirected.length).toBeGreaterThan(0);
    expect(redirected.every((p) => p.currency === 'USD')).toBe(true);
    expect(said(r.coverage)).toContain(`these requests were made by the reader configured for IN (127.0.0.1:${R.port}), which says it runs in IN`);
    expect(said(r.coverage)).toContain('The store did not treat the reader\'s requests as coming from IN');
    expect(r.coverage.sentences[0]).toContain('(sent to the US store even from there)');
  } finally { w.restore(); }
});

test('scripts/market-probe.js asks the market\'s reader when one is configured, and says which markets were reached through it', async () => {
  test.setTimeout(120_000);
  const R = await startReader();
  const w = importerWorld({ IN: R.base }, SECRET);
  st.stores['lensworld.example'].geo = 'US';
  try {
    const out = await probe.probeBrand({ name: 'Lensworld', url: lens, region: 'IN' }, { steps: 0, fetchImpl: st.routeFetch });
    expect(out.error).toBe('');
    const IN = out.markets.find((m) => String(m.code).toUpperCase() === 'IN');
    expect(IN.read_from).toBe(`the reader 127.0.0.1:${R.port} (a server in IN)`);
    expect(IN.verdict).toBe('reachable');
    const US = out.markets.find((m) => String(m.code).toUpperCase() === 'US');
    expect(US.read_from).toBe('this machine');
    expect(probe.summary([out], 'the spec')).toContain(`(read through the reader 127.0.0.1:${R.port} (a server in IN))`);
  } finally { w.restore(); }
});
