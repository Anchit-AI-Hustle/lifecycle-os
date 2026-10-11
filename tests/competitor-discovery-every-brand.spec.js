// Competitor discovery works for every onboarded brand, from what the brand
// ITSELF publishes, and a workspace renamed into another brand does not show
// the old brand's competitors (2026-10-11). EXECUTED.
//
// Production, /competitor-benchmarking#discover, brand "Deli Chic", market IN:
// "Find & add new brands" answered "Nothing added. [DATA REQUIRED BEFORE
// LAUNCH: brand industry or offerings, Deli Chic, IN]" and "Seed from brand
// record" added nothing. discoveryBrief() refused unless `industry` or
// `offerings[].kind` was set, and nothing in the platform fills `industry` -
// so competitor benchmarking worked for no onboarded brand, beside records
// whose tagline was the site's own description and whose catalogue was
// imported. And the live workspace once "Deli Chic" is "Lenskart" now, still
// listing a deli's competitors.
//
// Every case below runs the SHIPPED api/competitor.js on a real http.Server
// (tests/router-harness.js) over the fake project (tests/lib/fake-supabase.js
// with brand_workspace_save from tests/lib/brand-save-fake.js), the caller's
// own token reading under RLS, and a scripted llm.js that records every prompt
// it is handed. The page case drives competitor-benchmarking.html in Chromium
// with its /api/ calls answered by the same shipped handlers.
//
// Run: npx playwright test tests/competitor-discovery-every-brand.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const H = require('./router-harness');
const { BASE, ANON_KEY, SERVICE_KEY, makeReq, makeRes } = require('./lib/fake-supabase.js');
const { makeDb } = require('./lib/brand-save-fake.js');

const ROOT = H.ROOT;
const LLM = path.join(ROOT, 'api/_shared/llm.js');
const UNI = require(path.join(ROOT, 'api/_shared/competitor-universe.js'));
const COH = require(path.join(ROOT, 'api/_shared/brand-coherence.js'));
const RUNTIME = require(path.join(ROOT, 'api/_shared/brand-runtime.js'));
const core = require(path.join(ROOT, 'api/_shared/brand-workspace-core.js'));

const TOKEN = H.jwtShaped('aaaaaaaa-0000-4000-8000-00000000c0de');
const OWNER = 'aaaaaaaa-0000-4000-8000-00000000c0de';
const WS = 'bbbbbbbb-0000-4000-8000-00000000c0de';
const SITE = 'https://www.quillmere-larder.com';
const clone = (o) => JSON.parse(JSON.stringify(o));

/** A brand with only a name, a website and a home market: nothing it sells is stated. */
function bareRecord(extra) {
  return Object.assign({
    name: 'Quillmere Larder', slug: 'quillmere-larder', website: SITE, tagline: '', industry: '', status: 'active',
    regions: [{ code: 'IN', home: true, currency: 'INR', store_url: SITE }],
    palette: { primary: '#1d4ed8', accent: '#b45309', ink: '#111827', surface: '#ffffff', surface_alt: '#f8fafc', muted: '#4b5563' },
    typography: { heading: { family: 'Arial' }, body: { family: 'Arial' } },
    voice: { tone: 'plain', banned: [] }, asset_hosts: [], catalog_source: {},
    brand_data: { field_origin: { website: 'user' }, field_origins: { website: { origin: 'user' } } },
  }, extra || {});
}

/** The model: records the prompt and answers with whatever the case hands it. */
function scriptedModel(answer) {
  const calls = [];
  const fn = async (o) => {
    calls.push({ system: String(o.systemPrompt || ''), user: String(o.userMessage || ''), json: !!(o.responseFormat && o.responseFormat.type === 'json_object'), stage: o.stage });
    return { text: JSON.stringify(answer || { brands: [] }), provider: 'scripted', model: 'scripted' };
  };
  return { fn, calls };
}

let srv, restoreEnv, realLlmEntry;
test.beforeAll(async () => {
  restoreEnv = H.routerEnv({ SUPABASE_URL: BASE, SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, BRAND_RENDER: 'off' });
  require(LLM);
  realLlmEntry = require.cache[LLM].exports;
  srv = await H.serve('api/competitor.js');
});
test.afterAll(async () => {
  await srv.close();
  require.cache[LLM].exports = realLlmEntry;
  restoreEnv();
});

/** The fake project with this record as the owner's active workspace, and the model swapped. */
function world(record, o) {
  const opts = o || {};
  const db = makeDb(TOKEN, OWNER);
  db.addWorkspace(WS, OWNER, Object.assign(clone(record), { updated_at: '2026-10-11T00:00:00.000Z' }));
  db.setActive(OWNER, WS);
  db.syncIdentityTables();
  for (const r of opts.catalog || []) db.insert('brand_catalog_products', Object.assign({ workspace_id: WS, region: 'in' }, r));
  for (const r of opts.knowledge || []) db.insert('kb_knowledge', Object.assign({ workspace_id: WS, added_by: 'brand-context-pack', status: 'summarized', tags: ['brand-site'] }, r));
  for (const r of opts.competitors || []) db.insert('brand_competitors', Object.assign({ workspace_id: WS, is_active: true, source: 'discovery', verification: 'unverified', data_gaps: [] }, r));
  db.install();
  const model = scriptedModel(opts.answer);
  require.cache[LLM].exports = model.fn;
  try { require(path.join(ROOT, 'api/_shared/workspace-scope.js')).invalidate(); } catch (_) {}
  return {
    db, model,
    rows: () => db.table('brand_competitors').filter((r) => r.workspace_id === WS),
    restore() { db.restore(); require.cache[LLM].exports = realLlmEntry; },
  };
}

function call(action, method) {
  return H.request(srv.port, {
    method: method || 'POST', path: '/api/competitor' + H.qs({ action, workspace_id: WS }),
    json: (method || 'POST') === 'POST' ? {} : undefined, headers: { authorization: `Bearer ${TOKEN}` },
  });
}

const ANSWER = { brands: [{ name: 'Zzq Charcuterie House', websiteUrl: 'https://zzq-charcuterie-house.com' }] };

/* ── 1. what the brand says about itself ─────────────────────────────────── */

test('a brand with only a tagline read off its OWN site is searched from that quote, verbatim, and the row says what it was based on', async () => {
  const quote = 'Small-batch cured meats and charcuterie, made in Pune';
  const rec = bareRecord({
    tagline: quote,
    brand_data: {
      field_origin: { website: 'user', tagline: 'site-parse' },
      field_origins: { website: { origin: 'user' }, tagline: { url: SITE + '/', origin: 'site-parse', signal: 'meta:description' } },
    },
  });
  const w = world(rec, { answer: ANSWER });
  try {
    const r = await call('discover');
    expect(r.status, r.text).toBe(200);
    expect(w.model.calls.length, 'the discovery model was not reached: ' + r.text).toBe(1);
    const p = w.model.calls[0];
    expect(p.user).toContain(`How the company describes itself on its own site: "${quote}" (${SITE}/)`);
    // Never paraphrased into an industry, and the output contract still closes the prompt.
    expect(p.user).not.toMatch(/Industry, as the company describes itself/);
    expect(p.user.trim().endsWith('=== END OUTPUT REQUIREMENT ===')).toBe(true);
    expect(p.json).toBe(true);
    expect(r.out.added).toBe(1);
    const row = w.rows().find((x) => x.domain === 'zzq-charcuterie-house.com');
    expect(row, JSON.stringify(w.rows())).toBeTruthy();
    // No industry was declared, so no category is made up; the evidence names the basis.
    expect(row.category == null || row.category === '').toBe(true);
    expect(row.evidence).toContain('searched from Quillmere Larder');
    expect(row.evidence).toContain('own site\'s description of itself');
    expect(row.evidence).not.toMatch(/as a competitor in "/);
    expect(row.brand_identity).toBe(UNI.competitorIdentity(rec));
  } finally { w.restore(); }
});

test('a tagline read from ANOTHER company\'s site does not count, even when the record was activated with an override', async () => {
  const foreign = 'https://www.other-beauty-site.com/collections/b1g1';
  const rec = bareRecord({
    tagline: 'Buy 1 Get 1 free on every serum',
    brand_data: {
      field_origin: { website: 'user', tagline: 'site-parse' },
      field_origins: { website: { origin: 'user' }, tagline: { url: foreign, origin: 'site-parse', signal: 'opengraph:og:description' } },
      brand_extraction: { source: foreign, applied: { tagline: { value: 'Buy 1 Get 1 free on every serum', origin: 'site-parse', source_url: foreign } } },
    },
  });
  // The person overrode every blocking conflict at activation, so the
  // generation scrub (brand-runtime) keeps the tagline: excluding it here is
  // discovery's own rule, judged by the coherence rule's sameBrand().
  const ids = COH.brandCoherence(rec).conflicts.filter((c) => c.severity === 'block').map((c) => c.id);
  expect(ids.length, 'the fixture has no blocking conflict to override').toBeGreaterThan(0);
  rec.brand_data.coherence = { overrides: [{ at: '2026-10-11T00:00:00Z', by: OWNER, reason: 'fixture', conflicts: ids }] };
  expect(RUNTIME.normalizeBrand(clone(rec)).tagline).toBe(rec.tagline);
  const w = world(rec, { answer: ANSWER });
  try {
    const r = await call('discover');
    expect(r.status, r.text).toBe(200);
    expect(w.model.calls.length, 'another site\'s words reached the discovery model').toBe(0);
    expect(r.out.needs).toBe('industry');
    expect((r.out.gaps || [])[0]).toContain('[DATA REQUIRED BEFORE LAUNCH: brand industry or offerings, Quillmere Larder, IN]');
    expect(w.rows()).toEqual([]);
  } finally { w.restore(); }
});

test('its OWN live catalogue rows describe it; another site\'s rows and stale rows do not', async () => {
  const rec = bareRecord({ catalog_source: { url: SITE, kind: 'shopify_public', region: 'in' } });
  const catalog = [
    { title: 'Pepper Salami 200g', product_type: 'Cured meats', source_url: SITE + '/products/pepper-salami', product_url: SITE + '/products/pepper-salami', stale_at: null },
    { title: 'Smoked Ham 150g', product_type: 'Cured meats', source_url: SITE + '/products/smoked-ham', product_url: SITE + '/products/smoked-ham', stale_at: null },
    { title: 'Aged Gouda Wedge', product_type: 'Cheese', source_url: SITE + '/products/aged-gouda', product_url: SITE + '/products/aged-gouda', stale_at: null },
    { title: 'Zoom Runner 5', product_type: 'Running shoes', source_url: 'https://www.stride-athletic.com/products/zoom-runner-5', product_url: 'https://www.stride-athletic.com/products/zoom-runner-5', stale_at: null },
    { title: 'Old Lime Pickle', product_type: 'Pickles', source_url: SITE + '/products/old-lime-pickle', product_url: SITE + '/products/old-lime-pickle', stale_at: '2026-10-01T00:00:00.000Z' },
  ];
  const w = world(rec, { catalog, answer: ANSWER });
  try {
    const r = await call('discover');
    expect(r.status, r.text).toBe(200);
    expect(w.model.calls.length, r.text).toBe(1);
    const u = w.model.calls[0].user;
    expect(u).toContain('Product types in its own catalogue: Cured meats, Cheese.');
    expect(u).toContain('"Pepper Salami 200g"');
    expect(u, 'another site\'s product reached the prompt').not.toMatch(/Running shoes|Zoom Runner/);
    expect(u, 'a stale row reached the prompt').not.toMatch(/Pickle/);
    expect(w.rows().find((x) => x.domain === 'zzq-charcuterie-house.com').evidence).toContain('own catalogue');
  } finally { w.restore(); }
});

test('the context pack\'s page descriptions from its OWN domain describe it; a page filed from another site does not', async () => {
  const rec = bareRecord();
  const knowledge = [
    { url: SITE + '/', title: 'Home', summary: 'Cured meats, cheeses and deli boxes delivered across Maharashtra.' },
    { url: 'https://www.stride-athletic.com/', title: 'Stride', summary: 'Performance running shoes for every runner.' },
  ];
  const w = world(rec, { knowledge, answer: ANSWER });
  try {
    const r = await call('discover');
    expect(r.status, r.text).toBe(200);
    expect(w.model.calls.length, r.text).toBe(1);
    const u = w.model.calls[0].user;
    expect(u).toContain(`A page of its own site describes itself as: "Cured meats, cheeses and deli boxes delivered across Maharashtra." (${SITE}/)`);
    expect(u).not.toContain('running shoes');
  } finally { w.restore(); }
});

test('with NOTHING of its own (a template\'s tagline is not its own) the run is refused with the marker, no model, nothing stored', async () => {
  const rec = bareRecord({
    tagline: 'A template line nobody at this brand wrote',
    brand_data: { field_origin: { website: 'user', tagline: 'preset' }, field_origins: { website: { origin: 'user' }, tagline: { origin: 'preset', source: 'a gallery template' } } },
  });
  const w = world(rec, { answer: ANSWER });
  try {
    const r = await call('discover');
    expect(r.status, r.text).toBe(200);
    expect(w.model.calls.length).toBe(0);
    expect(r.out.needs).toBe('industry');
    expect(r.out.brand_name).toBe('Quillmere Larder');
    expect((r.out.gaps || [])[0]).toContain('[DATA REQUIRED BEFORE LAUNCH: brand industry or offerings, Quillmere Larder, IN]');
    expect(r.out.note).toContain('what Quillmere Larder sells');
    expect(w.rows()).toEqual([]);
  } finally { w.restore(); }
});

/* ── 2. a workspace renamed into another brand ───────────────────────────── */

test('a workspace renamed into another brand hides the old brand\'s competitors (said, never deleted) and seeds fresh', async () => {
  const OLD = { name: 'Quillmere Larder', website: SITE };
  const rec = bareRecord({
    name: 'Brightlens Eyewear', slug: 'brightlens-eyewear', website: 'https://www.brightlens-eyewear.com',
    regions: [{ code: 'IN', home: true, currency: 'INR', store_url: 'https://www.brightlens-eyewear.com' }],
    // Typed by the person: the record's own statement of what it sells.
    tagline: 'Prescription glasses and sunglasses, fitted at home',
    brand_data: { field_origin: { website: 'user', tagline: 'user' }, competitors: [{ name: 'Zzq Frames', website: 'https://zzq-frames.com' }] },
  });
  const old = UNI.competitorIdentity(OLD);
  expect(old).not.toBe(UNI.competitorIdentity(rec));
  const w = world(rec, {
    competitors: [
      { name: 'Zzq Deli Co', website: 'https://zzq-deli-co.com', domain: 'zzq-deli-co.com', brand_identity: old },
      { name: 'Zzq Smokehouse', website: 'https://zzq-smokehouse.com', domain: 'zzq-smokehouse.com', brand_identity: null },
      { name: 'Zzq Frames', website: 'https://zzq-frames.com', domain: 'zzq-frames.com', brand_identity: old },
    ],
    answer: { brands: [] },
  });
  try {
    const list = await call('brands', 'GET');
    expect(list.status, list.text).toBe(200);
    expect(list.out.brands).toEqual([]);
    expect(list.out.hidden.count).toBe(3);
    expect(list.out.hidden.note).toContain('Nothing was deleted');
    expect(list.out.hidden.note).toContain('Brightlens Eyewear');

    // Seed: the current brand's own record names Zzq Frames, which takes its
    // old row back re-stamped (the unique key would refuse a second one).
    const seed = await call('seed');
    expect(seed.status, seed.text).toBe(200);
    expect(seed.out.added).toBe(1);
    expect(seed.out.restored).toBe(1);
    expect(w.rows().length, 'a row was deleted or duplicated').toBe(3);
    expect(w.rows().find((x) => x.domain === 'zzq-frames.com').brand_identity).toBe(UNI.competitorIdentity(rec));

    const after = await call('brands', 'GET');
    expect(after.out.brands.map((b) => b.brandName)).toEqual(['Zzq Frames']);
    expect(after.out.hidden.count).toBe(2);

    // Discovery runs fresh: the hidden rows are not "already known" to it.
    const disc = await call('discover');
    expect(disc.status, disc.text).toBe(200);
    const u = w.model.calls.map((c) => c.user).join('\n');
    expect(u).toContain('zzq-frames.com');
    expect(u).not.toContain('zzq-deli-co.com');
    expect(u).not.toContain('zzq-smokehouse.com');
  } finally { w.restore(); }
});

/* ── 3. the page: say what it sells, saved to the ACTIVE brand, run again ── */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

test('the page: the industry gap asks "What does <brand> sell?", saves it to the active brand as typed, and runs discovery again', async ({ page }) => {
  test.setTimeout(90_000);
  const rec = bareRecord({ tagline: 'Our own words, typed', brand_data: { field_origin: { website: 'user', tagline: 'preset' }, field_origins: { website: { origin: 'user' }, tagline: { origin: 'preset' } } } });
  const w = world(rec, { answer: ANSWER });
  const log = { dialogs: [], errors: [], saves: [] };
  try {
    page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
    page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
    await page.addInitScript(() => {
      window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
    });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
      if (route.request().resourceType() !== 'script') return route.abort('failed');
      const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(route.request().url());
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm ? 'const noop=()=>{};export const animate=noop;export const scroll=noop;export const inView=noop;export const stagger=noop;export default new Proxy({},{get:()=>noop});' : 'window.tailwind=window.tailwind||{};' });
    });
    await page.route(/^http:\/\/127\.0\.0\.1:9\/.*/, async (route) => {
      const u = new URL(route.request().url());
      const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/competitor') {
        // The shipped router, as the signed-in owner of the active workspace.
        if (!u.searchParams.get('workspace_id')) u.searchParams.set('workspace_id', WS);
        const method = route.request().method();
        const r = await H.request(srv.port, { method, path: u.pathname + u.search, json: method === 'POST' ? (route.request().postDataJSON ? (() => { try { return route.request().postDataJSON() || {}; } catch (_) { return {}; } })() : {}) : undefined, headers: { authorization: `Bearer ${TOKEN}` } });
        return route.fulfill({ status: r.status, contentType: 'application/json', body: r.text });
      }
      if (u.pathname.startsWith('/api/')) {
        const action = u.searchParams.get('action');
        const op = u.searchParams.get('op');
        if (action === 'auth') return op === 'status' ? json({ ok: true, mode: 'google', pin_signin: false }) : json({ ok: false, error: 'invalid_session' }, 401);
        if (action !== 'brand') return json({ ok: true });
        let body = null;
        try { body = route.request().postDataJSON(); } catch (_) { body = null; }
        if (op === 'save') log.saves.push(body);
        const res = makeRes();
        await core.handle(makeReq({ token: TOKEN, query: Object.fromEntries(u.searchParams), body: body || undefined, method: route.request().method() }), res);
        return json(res.payload, res.code);
      }
      const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    });
    await page.goto('http://127.0.0.1:9/competitor-benchmarking.html#discover', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.id, null, { timeout: 20000 });

    await page.click('#bd-discover');
    const form = page.locator('#bd-industry');
    await expect(form).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#bd-industry-label')).toHaveText('What does Quillmere Larder sell?');
    await expect(page.locator('#bd-status')).toContainText('[DATA REQUIRED BEFORE LAUNCH: brand industry or offerings, Quillmere Larder, IN]');
    expect(w.model.calls.length).toBe(0);

    await page.fill('#bd-industry-input', 'Cured meats and charcuterie');
    await page.click('#bd-industry-save');
    await expect(page.locator('#bd-status')).toContainText('+1 added', { timeout: 20000 });
    await expect(form).toBeHidden();

    // Saved to the ACTIVE brand, as the person's own, every other field intact.
    const row = w.db.table('brand_workspaces').find((x) => x.id === WS);
    expect(row.industry).toBe('Cured meats and charcuterie');
    expect(row.tagline).toBe('Our own words, typed');
    expect(row.website).toBe(SITE);
    expect(row.palette.primary).toBe('#1d4ed8');
    expect(row.regions.map((x) => x.code)).toEqual(['IN']);
    const prov = w.db.table('brand_field_provenance').find((x) => x.workspace_id === WS && x.field === 'industry');
    expect(prov && prov.origin).toBe('user');
    expect(log.saves.length).toBe(1);
    expect(Object.keys(log.saves[0].brand).sort()).toEqual(['id', 'industry']);

    // And discovery ran again, from what was typed.
    expect(w.model.calls.length).toBe(1);
    expect(w.model.calls[0].user).toContain('Industry, as the company describes itself: Cured meats and charcuterie.');
    expect(log.dialogs).toEqual([]);
    expect(log.errors).toEqual([]);
  } finally { w.restore(); }
});
