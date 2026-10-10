/**
 * A catalogue the coherence rule calls ANOTHER brand's never reaches
 * generation (2026-10-10).
 * ---------------------------------------------------------------------------
 * Production, /brain, the brand "Mamaearth" (market IN): Smart Brain's mailers
 * said "Uncompromising Chicken Black Pepper Salami", "Real black-pepper
 * infusion", "100% premium chicken, no pork" - Deli Chic's products. The live
 * record (tests/fixtures/live-mixed-brand.js) is named Mamaearth, its website
 * nike.in, and its catalogue was imported from delichic.co.in.
 * brand-coherence.js already called that catalogue a BLOCKING identity
 * conflict, but only at activation; every planner and writer read the rows as
 * this brand's products.
 *
 * The rule now (brand-coherence.js catalogIdentity / catalogRowForeign, the
 * coherence rule's OWN verdict, ported byte for byte to the browser): a
 * catalogue conflict the person has not kept excludes the catalogue from
 * generation, and each row is judged by the page it was read from. Where it is
 * enforced, each EXECUTED here:
 *   1. brand-catalog-server resolve()/productsFor() - every renderer's rows;
 *   2. smart-brain-plan: offerings, the plan, buildCampaign (the hero), the
 *      stored-plan read, preview, approve, and Daily Sync (stale slots
 *      archived) - through the SHIPPED api/calendar.js router over the fake
 *      project, with the scripted model recording every prompt;
 *   3. brand-runtime.carriedBrand + brain-agent's device chat - the carried
 *      record and the catalogue a device sends;
 *   4. the browser: BrandContext.catalogForGeneration, BrandCatalog.load and
 *      the onboarding wizard's "Clear that" (which now removes the imported
 *      rows from the device), in Chromium.
 * A coherent brand (its catalogue on its own domain) and a conflict the person
 * KEPT still get their products; a record whose catalogue source was cleared
 * keeps only the rows read from its own site.
 *
 * Run: npx playwright test tests/catalog-identity-generation.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const A = require('./agents-harness');
const H = require('./router-harness');
const LIVE = require('./fixtures/live-mixed-brand.js');

const ROOT = A.ROOT;
const COH = require(path.join(ROOT, 'api', '_shared', 'brand-coherence.js'));
const clone = (o) => JSON.parse(JSON.stringify(o));

/* Deli Chic-like rows, as the import filed them (product page on delichic.co.in). */
const DELI_SITE = 'https://delichic.co.in';
const DELI = [
  { handle: 'chicken-black-pepper-salami', title: 'Uncompromising Chicken Black Pepper Salami', product_type: 'Cold cuts', price: 449 },
  { handle: 'smoked-chicken-ham', title: 'Smoked Chicken Ham No Pork', product_type: 'Cold cuts', price: 399 },
].map((p) => Object.assign(p, {
  image_url: `${DELI_SITE}/wp-content/uploads/2026/06/${p.handle}.jpg`,
  product_url: `${DELI_SITE}/product/${p.handle}/`, source_url: `${DELI_SITE}/product/${p.handle}/`,
}));
/* Anything of Deli Chic's that may not appear in another brand's output or prompt. */
const FOREIGN = [/salami/i, /chicken/i, /black[ -]pepper/i, /no pork/i, /cold cuts/i, /wp-content\/uploads/i];
const foreignIn = (hay) => FOREIGN.filter((re) => re.test(String(hay || ''))).map(String);
const MARKER = /\[DATA REQUIRED BEFORE LAUNCH: product catalogue, Mamaearth/;
const KEPT_ID = 'cross_domain:catalog_source:delichic.co.in';

/* The four records. */
const RECORDS = {
  // The live record, as stored.
  mixed: () => clone(LIVE),
  // The same rows under the brand that owns them: its products are used.
  coherent: () => ({ name: 'Deli Chic', website: DELI_SITE, regions: [{ code: 'IN', currency: 'INR', store_url: DELI_SITE, home: true }],
    palette: { primary: '#7a1f2b', accent: '#c9a227', ink: '#1d1b1b', surface: '#ffffff' }, typography: {}, voice: { tone: 'warm' },
    catalog_source: { url: DELI_SITE, kind: 'site_crawl', region: 'in', row_count: 2 }, brand_data: {} }),
  // The live record, with the catalogue conflict KEPT by the person.
  kept: () => { const r = clone(LIVE); r.brand_data.coherence = { accepted: [{ id: KEPT_ID, at: '2026-10-10T00:00:00.000Z', origin: 'user' }] }; return r; },
  // The live record repaired to mamaearth.in, its catalogue source cleared; the
  // rows the old import left stay in the table beside one of its own.
  cleared: () => { const r = clone(LIVE); r.website = 'https://mamaearth.in'; r.catalog_source = {}; return r; },
  // The live record with OFFERINGS saved on it: one read off Deli Chic's
  // catalogue, one the person typed.
  offered: () => { const r = clone(LIVE); r.brand_data.offerings = [
    { kind: 'product', name: DELI[0].title, url: DELI[0].product_url, source: { type: 'workspace_catalog', workspace_id: 'ws-offered' } },
    { kind: 'product', name: 'Vitamin C Daily Glow Face Wash' },
  ]; return r; },
};
const OWN_ROW = { handle: 'onion-hair-oil', title: 'Onion Hair Oil for Hair Growth', product_type: 'Hair oil', price: 399,
  image_url: 'https://mamaearth.in/cdn/shop/files/onion-oil.jpg', product_url: 'https://mamaearth.in/product/onion-hair-oil', source_url: 'https://mamaearth.in/product/onion-hair-oil' };

function wsRow(rec, id) {
  const r = clone(rec);
  delete r.id;
  return Object.assign(r, { id, slug: r.slug || id, status: 'active', created_at: '2026-09-20T00:00:00.000Z' });
}

async function makeWorld() {
  const w = await A.world({});
  const toks = {};
  for (const key of Object.keys(RECORDS)) {
    const uid = 'user-' + key;
    const tok = H.jwtShaped(uid);
    const ws = 'ws-' + key;
    w.db.addUser(tok, uid, key + '@example.test').addWorkspace(ws, uid, wsRow(RECORDS[key](), ws)).setActive(uid, ws);
    toks[key] = tok;
    for (const p of DELI.concat(key === 'cleared' ? [OWN_ROW] : [])) {
      w.db.insert('brand_catalog_products', Object.assign({ workspace_id: ws, region: 'in', sku: p.handle, collections: [], currency: 'INR' }, p));
    }
  }
  // Each brand's own site answers 404, so a review crawl finds nothing and invents nothing.
  for (const o of ['https://www.nike.in', 'https://nike.in', 'https://mamaearth.in', 'https://www.mamaearth.in', DELI_SITE]) {
    w.db.route((u) => u.startsWith(o), () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => 'not found', json: async () => ({}) }));
  }
  w.db.workspaces['ws-oldest'].created_at = '2026-01-01T00:00:00.000Z';
  w.db.syncIdentityTables();
  w.authFor = (key) => ({ state: 'anonymous', headers: { authorization: 'Bearer ' + toks[key] } });
  w.prompts = () => w.llm.calls.map((c) => c.prompt || '').join('\n=====\n');
  w.mod = (rel) => require(path.join(ROOT, rel));
  w.brandOf = (key) => w.mod('api/_shared/workspace-scope.js').brandForWorkspace({ url: A.BASE, key: A.SERVICE_KEY }, 'ws-' + key);
  return w;
}

/* ═══ 1. the rule ═══════════════════════════════════════════════════════════ */

test.describe('the rule: the coherence verdict decides whose catalogue it is', () => {
  test('the live record\'s catalogue is excluded; a coherent, a kept and a cleared one are not', () => {
    const mixed = COH.catalogIdentity(RECORDS.mixed());
    expect(mixed.excluded).toBe(true);
    expect(mixed.domain).toBe('delichic.co.in');
    expect(mixed.conflict_id).toBe(KEPT_ID);
    expect(mixed.marker).toBe('[DATA REQUIRED BEFORE LAUNCH: product catalogue, Mamaearth]');
    expect(mixed.sentence).toMatch(/imported from delichic\.co\.in/);
    // It is brandCoherence's own conflict, not a second comparison.
    expect(COH.brandCoherence(RECORDS.mixed()).conflicts.map((c) => c.id)).toContain(mixed.conflict_id);
    for (const p of DELI) expect(COH.catalogRowForeign(p, mixed), p.title).toBe(true);

    const coherent = COH.catalogIdentity(RECORDS.coherent());
    expect(coherent.excluded).toBe(false);
    for (const p of DELI) expect(COH.catalogRowForeign(p, coherent)).toBe(false);

    const kept = COH.catalogIdentity(RECORDS.kept());
    expect(kept.excluded).toBe(false);
    expect(kept.kept).toEqual(['delichic.co.in']);
    for (const p of DELI) expect(COH.catalogRowForeign(p, kept)).toBe(false);

    const cleared = COH.catalogIdentity(RECORDS.cleared());
    expect(cleared.excluded).toBe(false);
    for (const p of DELI) expect(COH.catalogRowForeign(p, cleared), 'a row read from another brand\'s site, with the source cleared').toBe(true);
    expect(COH.catalogRowForeign(OWN_ROW, cleared)).toBe(false);
    // A row with no page of its own belongs to the catalogue it arrived in.
    expect(COH.catalogRowForeign({ title: 'typed' }, mixed)).toBe(true);
    expect(COH.catalogRowForeign({ title: 'typed' }, coherent)).toBe(false);
  });

  test('the carried record keeps what the verdict needs, the kept ids included', () => {
    const rt = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
    const mixed = rt.carriedBrand({ brand: RECORDS.mixed() }, { user_id: 'u1' });
    expect(COH.catalogIdentity(mixed).excluded).toBe(true);
    const kept = rt.carriedBrand({ brand: RECORDS.kept() }, { user_id: 'u1' });
    expect(kept.brand_data.coherence.accepted).toEqual([{ id: KEPT_ID }]);
    expect(COH.catalogIdentity(kept).excluded).toBe(false);
    // An id that is not a conflict id is not carried.
    const junk = rt.carriedBrand({ brand: Object.assign(RECORDS.mixed(), { brand_data: { coherence: { accepted: [{ id: 'anything goes here' }] } } }) }, { user_id: 'u1' });
    expect(junk.brand_data.coherence.accepted).toEqual([]);
  });
});

/* ═══ 2. the server, executed ══════════════════════════════════════════════ */

test.describe('the server', () => {
  let w;
  test.beforeAll(async () => { w = await makeWorld(); });
  test.afterAll(async () => { if (w) await w.close(); });

  test('brand-catalog-server: every renderer\'s rows follow the verdict', async () => {
    w.reset();
    const bcs = w.mod('api/_shared/brand-catalog-server.js');
    const titles = (r) => (r.products || []).map((p) => p.n);
    const out = {};
    for (const key of Object.keys(RECORDS)) {
      const brand = await w.brandOf(key);
      expect(brand && brand.name, key).toBeTruthy();
      out[key] = { brand, resolved: await bcs.resolve({ brand, workspaceId: 'ws-' + key }), bare: await bcs.resolve({ workspaceId: 'ws-' + key }) };
    }
    // The live record: nothing, the marker, and the domain it came from.
    for (const r of [out.mixed.resolved, out.mixed.bare]) {
      expect(r.source).toBe('none');
      expect(r.products).toEqual([]);
      expect(r.reason).toMatch(MARKER);
      expect(r.reason).toMatch(/imported from delichic\.co\.in/);
    }
    // The sync half, with no scope and inside a pinned one.
    expect(bcs.productsFor('IN', { brand: out.mixed.brand }).source).toBe('none');
    const pinned = await bcs.withCatalog({ brand: out.mixed.brand, workspaceId: 'ws-mixed' }, async () => bcs.productsFor('IN', { brand: out.mixed.brand }));
    expect(pinned.products).toEqual([]);
    expect(pinned.reason).toMatch(MARKER);
    // A catalogue of its own, a kept one, and a cleared source with one own row.
    expect(titles(out.coherent.resolved).sort()).toEqual(DELI.map((p) => p.title).sort());
    expect(titles(out.kept.resolved).sort()).toEqual(DELI.map((p) => p.title).sort());
    expect(titles(out.kept.bare).sort()).toEqual(DELI.map((p) => p.title).sort());
    expect(titles(out.cleared.resolved)).toEqual([OWN_ROW.title]);
    expect(titles(out.cleared.bare)).toEqual([OWN_ROW.title]);
    const cpin = await bcs.withCatalog({ brand: out.cleared.brand, workspaceId: 'ws-cleared' }, async () => bcs.productsFor('IN', { brand: out.cleared.brand }));
    expect(titles(cpin)).toEqual([OWN_ROW.title]);
    // A generation pinned from a record that says nothing about its catalogue
    // (a preset-shaped brand) still answers a renderer that names the FULL
    // record by that record's verdict: the sync half judges too.
    const thin = (key) => ({ id: 'ws-' + key, name: out[key].brand.name, owns_shipped: false });
    const late = await bcs.withCatalog({ brand: thin('mixed'), workspaceId: 'ws-mixed' }, async () => ({
      scope: bcs.currentScope().source, rows: bcs.productsFor('IN', { brand: out.mixed.brand }),
    }));
    expect(late.scope, 'the thin record pinned the rows').toBe('brand');
    expect(late.rows.products).toEqual([]);
    expect(late.rows.reason).toMatch(MARKER);
    const lateCleared = await bcs.withCatalog({ brand: thin('cleared'), workspaceId: 'ws-cleared' }, async () => bcs.productsFor('IN', { brand: out.cleared.brand }));
    expect(titles(lateCleared)).toEqual([OWN_ROW.title]);
  });

  async function plan(key, action, body) {
    w.reset();
    const res = await w.request('/api/calendar', Object.assign({ query: { action }, json: body || { days: 14 } }, w.authFor(key)));
    return { res, answer: res.text || '', prompts: w.prompts() };
  }

  test('Smart Brain plans the live record from lifecycle strategy with the marker, never from Deli Chic\'s products', async () => {
    test.setTimeout(240_000);
    for (const action of ['smart-brain-sync-daily', 'smart-brain-plan']) {
      const { res, answer, prompts } = await plan('mixed', action);
      expect(res.status, answer.slice(0, 300)).toBe(200);
      expect(foreignIn(answer), `${action}: the plan names Deli Chic's products`).toEqual([]);
      expect(foreignIn(prompts), `${action}: a prompt names Deli Chic's products`).toEqual([]);
      expect(answer, `${action}: no catalogue marker`).toMatch(/DATA REQUIRED BEFORE LAUNCH: product catalogue, Mamaearth/);
      expect(answer, `${action}: the plan does not say where the catalogue came from`).toMatch(/imported from delichic\.co\.in/);
    }
  });

  test('a coherent brand, a kept conflict and a cleared source still plan from their own products', async () => {
    test.setTimeout(240_000);
    for (const [key, want, not] of [['coherent', /Uncompromising Chicken Black Pepper Salami/, null], ['kept', /Uncompromising Chicken Black Pepper Salami/, null], ['cleared', /Onion Hair Oil/, /Salami/]]) {
      const { res, answer } = await plan(key, 'smart-brain-sync-daily');
      expect(res.status, answer.slice(0, 300)).toBe(200);
      expect(answer, `${key}: its own products are not in the plan`).toMatch(want);
      if (not) expect(answer, `${key}: a row read from another brand's site was planned`).not.toMatch(not);
    }
  });

  test('an offering read off the excluded catalogue is not planned; one the person typed is', async () => {
    test.setTimeout(240_000);
    const { res, answer, prompts } = await plan('offered', 'smart-brain-sync-daily');
    expect(res.status, answer.slice(0, 300)).toBe(200);
    expect(foreignIn(answer)).toEqual([]);
    expect(foreignIn(prompts)).toEqual([]);
    expect(answer).toMatch(/Vitamin C Daily Glow Face Wash/);
  });

  test('a slot stored from the excluded catalogue: hidden, previewed with the marker, refused at approval, archived by Daily Sync', async () => {
    test.setTimeout(300_000);
    w.reset();
    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const offering = { kind: 'product', name: DELI[0].title, url: DELI[0].product_url, source: { type: 'workspace_catalog', workspace_id: 'ws-mixed' } };
    const payload = (id, extra) => Object.assign({
      id, date, market: 'IN', cohort: { name: 'Nurture', size: 0, estimated: true }, objective: 'second-order activation',
      theme: `${DELI[0].title} (product)`, heroOffering: offering, offering, heroProduct: { title: DELI[0].title, category: 'Cold cuts' },
      channels: ['email', 'meta', 'google', 'landing_page'], cta: 'Order Cold cuts',
    }, extra || {});
    const stale = 'cal_stale_mixed', locked = 'cal_stale_approved';
    const camp = (id) => ({ id, workspace_id: 'ws-mixed', status: 'prebuilt', payload: { campaign_id: id, copywriter: { provider: 'scripted' },
      assets: { email: { html: `<p>${DELI[0].title}: Real black-pepper infusion, 100% premium chicken, no pork.</p>` }, ads: [], landing_pages: [{ html: `<h1>${DELI[0].title}</h1>` }] } } });
    w.db.insert('smart_generated_campaigns', camp('camp_stale_prebuilt'));
    w.db.insert('smart_generated_campaigns', camp('camp_stale_final'));
    w.db.insert('smart_calendar_entries', { id: stale, workspace_id: 'ws-mixed', date, market: 'IN', status: 'tentative', confidence: 0.5,
      payload: payload(stale, { __prebuilt: { campaign_id: 'camp_stale_prebuilt', at: '2026-10-09T00:00:00.000Z' } }), change_log: [] });
    w.db.insert('smart_calendar_entries', { id: locked, workspace_id: 'ws-mixed', date, market: 'IN', status: 'approved', confidence: 0.5,
      payload: payload(locked), generated_campaign_id: 'camp_stale_final', change_log: [] });

    // The stored plan does not show either slot.
    let r = await plan('mixed', 'smart-brain-plan');
    expect(r.res.status).toBe(200);
    expect(foreignIn(r.answer), 'the stored plan still shows a slot built from Deli Chic\'s catalogue').toEqual([]);

    // Preview builds again with the marker; nothing saved for the slot is replayed.
    for (const id of [stale, locked]) {
      r = await plan('mixed', 'smart-brain-preview', { id });
      expect(r.res.status, r.answer.slice(0, 300)).toBe(200);
      const j = JSON.parse(r.answer);
      expect(j.stale, id).toBe(true);
      expect(j.persisted).toBe(false);
      expect(foreignIn(r.answer), `${id}: the preview carries Deli Chic's product`).toEqual([]);
      expect(foreignIn(r.prompts), `${id}: a prompt carries Deli Chic's product`).toEqual([]);
      expect(r.answer).toMatch(MARKER);
      expect(j.note).toMatch(/imported from delichic\.co\.in/);
      expect(j.campaign.data_gaps.join(' ')).toMatch(MARKER);
    }
    expect(w.db.table('smart_generated_campaigns').map((c) => c.id).sort(), 'the preview stored a campaign').toEqual(['camp_stale_final', 'camp_stale_prebuilt']);

    // Approval refuses, in a sentence, and records nothing.
    r = await plan('mixed', 'smart-brain-approve', { id: stale });
    expect(r.res.status).toBe(409);
    expect(JSON.parse(r.answer).error).toBe('catalogue_excluded');
    expect(JSON.parse(r.answer).message).toMatch(/delichic\.co\.in/);
    expect(w.db.find('smart_calendar_entries', (x) => x.id === stale).status).toBe('tentative');

    // Daily Sync archives the writable slot with the reason; the approved one is the reviewer's.
    r = await plan('mixed', 'smart-brain-sync-daily');
    expect(r.res.status).toBe(200);
    const row = w.db.find('smart_calendar_entries', (x) => x.id === stale);
    expect(row.status).toBe('archived');
    expect(row.change_log.map((c) => c.kind)).toContain('catalogue_excluded');
    expect(w.db.find('smart_calendar_entries', (x) => x.id === locked).status).toBe('approved');
    expect(foreignIn(r.answer)).toEqual([]);
  });

  test('an inline slot naming Deli Chic\'s product is built with the marker, and a coherent brand\'s is built with its product', async () => {
    test.setTimeout(240_000);
    const entry = (ws) => ({ id: 'inline-1', date: '2026-10-20', market: 'IN', cohort: { name: 'Nurture', size: 0 }, objective: 'second-order activation',
      heroOffering: { kind: 'product', name: DELI[0].title, url: DELI[0].product_url, source: { type: 'workspace_catalog', workspace_id: ws } },
      heroProduct: { title: DELI[0].title, category: 'Cold cuts' }, channels: ['email', 'landing_page'] });
    let r = await plan('mixed', 'smart-brain-preview', { entry: entry('ws-mixed') });
    expect(r.res.status, r.answer.slice(0, 300)).toBe(200);
    expect(foreignIn(r.answer)).toEqual([]);
    expect(foreignIn(r.prompts)).toEqual([]);
    expect(r.answer).toMatch(MARKER);
    r = await plan('coherent', 'smart-brain-preview', { entry: entry('ws-coherent') });
    expect(r.res.status, r.answer.slice(0, 300)).toBe(200);
    expect(r.answer + r.prompts).toMatch(/Uncompromising Chicken Black Pepper Salami/);
  });

  test('a device\'s catalogue sent to the buyer agent is judged before a row reaches the prompt', async () => {
    w.reset();
    const agent = w.mod('api/_shared/brain-agent.js');
    const rt = w.mod('api/_shared/brand-runtime.js');
    const rows = DELI.map((p) => ({ title: p.title, product_type: p.product_type, price: p.price, currency: 'INR', product_url: p.product_url, source_url: p.source_url }));
    expect(typeof agent.deviceChat, 'brain-agent exports deviceChat').toBe('function');
    await agent.deviceChat({ brand: rt.carriedBrand({ brand: RECORDS.mixed() }, { user_id: 'u1' }), catalog: rows, message: 'What should I buy?' }).catch(() => null);
    expect(w.llm.calls.length, 'the agent never reached the model').toBeGreaterThan(0);
    expect(foreignIn(w.prompts())).toEqual([]);
    expect(w.prompts()).toMatch(MARKER);
    w.reset();
    await agent.deviceChat({ brand: rt.carriedBrand({ brand: RECORDS.kept() }, { user_id: 'u1' }), catalog: rows, message: 'What should I buy?' }).catch(() => null);
    expect(w.prompts()).toMatch(/Uncompromising Chicken Black Pepper Salami/);
  });
});

/* ═══ 3. the browser ═══════════════════════════════════════════════════════ */

const HOST = 'http://app.example.test';
const DEVICE_KEY = 'lifecycle.brand.device.workspaces';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const PALETTE_OK = { primary: '#7a1f2b', accent: '#c9a227', ink: '#1d1b1b', surface: '#ffffff', surface_alt: '#fbf7f2', muted: '#5f5a55' };

function deviceRow(id, rec) {
  return Object.assign({ legal_name: null, tagline: '', industry: '', logo_url: null, favicon_url: null, voice: {}, asset_hosts: [], brand_data: {}, onboarding_step: 6, owner_id: null,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' }, rec, { id, storage: 'device', status: 'active', palette: PALETTE_OK });
}

async function openPage(page, file, { rec, id, query = '' }) {
  const errors = [];
  const dialogs = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  const seed = { version: 1, active_id: id, workspaces: [deviceRow(id, rec)] };
  const cat = { products: DELI.map((p) => Object.assign({ region: 'in', sku: p.handle, currency: 'INR' }, p)), source: { url: DELI_SITE, kind: 'site_crawl' }, owned: true, region: 'in' };
  await page.addInitScript(([key, s, catKey, c]) => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, JSON.stringify(s)); localStorage.setItem(catKey, JSON.stringify(c)); sessionStorage.setItem('seeded', '1'); }
  }, [DEVICE_KEY, seed, DEVICE_KEY + '.catalog.' + id, cat]);
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.abort('addressunreachable');
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});' : 'window.tailwind=window.tailwind||{};' });
  });
  await page.route(HOST + '/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/')) return route.fallback();
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => {
    const u = new URL(route.request().url());
    const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
    const action = u.searchParams.get('action');
    if (!action && !u.searchParams.has('health')) return json({ supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } });
    if (action === 'auth') return u.searchParams.get('op') === 'status' ? json({ ok: true, mode: 'device', reason: 'no_database_url', host: '' }) : json({ ok: false, error: 'invalid_session' }, 401);
    if (action === 'brand' && /presets|defaults/.test(u.searchParams.get('op') || '')) return json({ ok: true, presets: [] });
    return json({ ok: false, error: 'session_verification_unavailable', message: 'The database is not answering.' }, 503);
  });
  await page.goto(HOST + '/' + file + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded && window.BrandContext.catalogForGeneration, null, { timeout: 20000 });
  if (!(await page.evaluate(() => !!window.BrandCatalog))) await page.addScriptTag({ url: HOST + '/brand-catalog.js' });
  return { errors, dialogs };
}

test.describe('the browser', () => {
  test('a device brand with another brand\'s catalogue: no rows for generation, the marker, and "Clear that" removes them', async ({ page }) => {
    const id = 'local-mixed01';
    const log = await openPage(page, 'onboarding.html', { rec: RECORDS.mixed(), id, query: '?id=' + id + '&step=6' });
    const gen = await page.evaluate((i) => window.BrandContext.catalogForGeneration(i), id);
    expect(gen.products).toEqual([]);
    expect(gen.excluded.domain).toBe('delichic.co.in');
    expect(gen.excluded.marker).toMatch(MARKER);
    // The browser's verdict is the server's, and the shell carries it.
    expect(await page.evaluate(() => window.BrandContext.brand.catalog_identity)).toEqual(JSON.parse(JSON.stringify((() => { const v = COH.catalogIdentity(RECORDS.mixed()); return { excluded: v.excluded, domain: v.domain, allowed: v.allowed, marker: v.marker, sentence: v.sentence }; })())));
    const loaded = await page.evaluate(() => window.BrandCatalog.invalidate() || window.BrandCatalog.load('in'));
    expect(loaded.products).toEqual([]);
    expect(loaded.source).toBe('none');
    expect(loaded.reason).toMatch(MARKER);
    expect(loaded.reason).toMatch(/delichic\.co\.in/);
    expect(foreignIn(JSON.stringify(loaded))).toEqual([]);

    await page.waitForSelector(`[data-coh-clear="${KEPT_ID}"]`, { timeout: 15000 });
    await page.click(`[data-coh-clear="${KEPT_ID}"]`);
    await page.waitForFunction(() => /removed the 2 product/.test(document.getElementById('toast').textContent || ''), null, { timeout: 10000 });
    const left = await page.evaluate((k) => localStorage.getItem(k), DEVICE_KEY + '.catalog.' + id);
    expect(left, 'the imported products stayed beside the brand after Clear').toBeNull();
    expect(await page.evaluate((i) => window.BrandContext.catalogForGeneration(i), id)).toBeNull();
    expect(log.errors).toEqual([]);
    expect(log.dialogs).toEqual([]);
  });

  test('a device brand that KEPT the catalogue, and the Smart Brain console\'s kept-plan filter', async ({ page }) => {
    const id = 'local-kept001';
    const log = await openPage(page, 'smart-brain.html', { rec: RECORDS.kept(), id });
    const gen = await page.evaluate((i) => window.BrandContext.catalogForGeneration(i), id);
    expect(gen.products.map((p) => p.title).sort()).toEqual(DELI.map((p) => p.title).sort());
    expect(gen.excluded).toBeNull();
    const loaded = await page.evaluate(() => window.BrandCatalog.invalidate() || window.BrandCatalog.load('in'));
    expect(loaded.source).toBe('device');
    expect(loaded.products.length).toBe(2);
    // A kept slot from that catalogue is this brand's under a kept verdict ...
    const slot = { id: 's1', heroOffering: { kind: 'product', name: DELI[0].title, url: DELI[0].product_url, source: { type: 'workspace_catalog' } } };
    expect(await page.evaluate((s) => window.foreignSlot(s), slot)).toBe(false);
    // What the page carries to the server says where the catalogue came from
    // and that the person kept it, so the server judges it as the device does.
    const carried = await page.evaluate(() => window.BrandContext.carry());
    expect(carried.catalog_source.url).toBe(DELI_SITE);
    expect(carried.brand_data.coherence.accepted).toEqual([{ id: KEPT_ID }]);
    const rt = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
    expect(COH.catalogIdentity(rt.carriedBrand({ brand: carried }, { user_id: 'u1' })).excluded).toBe(false);
    expect(log.errors).toEqual([]);
  });

  test('the device carries the live record\'s catalogue source, so the server excludes it too', async ({ page }) => {
    const id = 'local-mixed03';
    await openPage(page, 'smart-brain.html', { rec: RECORDS.mixed(), id });
    const carried = await page.evaluate(() => window.BrandContext.carry());
    expect(carried.catalog_source.url).toBe(DELI_SITE);
    const rt = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));
    expect(COH.catalogIdentity(rt.carriedBrand({ brand: carried }, { user_id: 'u1' })).excluded).toBe(true);
  });

  test('an ACCOUNT brand: BrandCatalog reads the server\'s verdict off the shell and shows none of the rows', async ({ page }) => {
    const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
    const shellOf = (rec, id) => core.shellPayload(Object.assign(clone(rec), { id }));
    const rows = DELI.map((p) => Object.assign({ region: 'in', sku: p.handle, currency: 'INR' }, p)).concat([Object.assign({ region: 'in' }, OWN_ROW)]);
    await page.route(HOST + '/**', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/blank') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>b</title>' });
      const f = path.join(ROOT, u.pathname.replace(/^\//, ''));
      return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'text/plain', body: fs.readFileSync(f) });
    });
    await page.goto(HOST + '/blank');
    await page.addScriptTag({ content: 'var module = {};\n' + fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-coherence.js'), 'utf8') + '\nwindow.__COH = module.exports;' });
    const run = (brand) => page.evaluate(async ([b, r]) => {
      window.BrandCatalog = undefined;
      window.BrandContext = { brand: b, ready: async () => b, coherenceLib: window.__COH, isTenantZero: () => false, device: { isDeviceId: () => false },
        api: async () => ({ ok: true, products: r }) };
      const s = document.createElement('script'); s.src = '/brand-catalog.js?' + Math.random();
      await new Promise((ok) => { s.onload = ok; document.head.appendChild(s); });
      return window.BrandCatalog.load('in');
    }, [brand, rows]);
    const mixed = await run(shellOf(RECORDS.mixed(), 'ws-a1'));
    expect(mixed.source).toBe('none');
    expect(mixed.products).toEqual([]);
    expect(mixed.reason).toMatch(MARKER);
    expect(foreignIn(JSON.stringify(mixed))).toEqual([]);
    const kept = await run(shellOf(RECORDS.kept(), 'ws-a2'));
    expect(kept.source).toBe('brand');
    expect(kept.products.map((p) => p.n)).toEqual(expect.arrayContaining(DELI.map((p) => p.title)));
    const cleared = await run(shellOf(RECORDS.cleared(), 'ws-a3'));
    expect(cleared.products.map((p) => p.n)).toEqual([OWN_ROW.title]);
  });

  test('the Smart Brain console drops a kept slot planned from an excluded catalogue', async ({ page }) => {
    const id = 'local-mixed02';
    const log = await openPage(page, 'smart-brain.html', { rec: RECORDS.mixed(), id });
    const slot = { id: 's1', heroOffering: { kind: 'product', name: DELI[0].title, url: DELI[0].product_url, source: { type: 'workspace_catalog' } } };
    const typed = { id: 's2', heroOffering: { kind: 'product', name: 'A product the person typed' } };
    expect(await page.evaluate((s) => window.foreignSlot(s), slot)).toBe(true);
    expect(await page.evaluate((s) => window.foreignSlot(s), typed)).toBe(false);
    expect(await page.evaluate((s) => window.foreignSlot(s), { id: 's3', strategy_only: true })).toBe(false);
    // A slot read off the excluded catalogue with no page of its own follows that catalogue.
    expect(await page.evaluate((s) => window.foreignSlot(s), { id: 's4', heroOffering: { kind: 'product', name: 'x', source: { type: 'workspace_catalog' } } })).toBe(true);
    // The plan a phone sign-in kept on this device is read back without it.
    const kept = await page.evaluate(([a, b]) => {
      Object.defineProperty(window, 'LifecycleAuth', { configurable: true, value: { session: { provider: 'mobile-pin', mode: 'device', user: { id: 'u-dev' } }, backend: { kind: 'local' } } });
      localStorage.setItem(devicePlanKey(), JSON.stringify({ at: 'x', entries: [a, b] }));
      const v = readDevicePlan();
      return v ? v.entries.map((e) => e.id) : null;
    }, [slot, typed]);
    expect(kept).toEqual(['s2']);
    expect(log.errors).toEqual([]);
  });
});
