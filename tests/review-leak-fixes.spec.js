/**
 * Six brand-leak paths a read-only review of main found (2026-10-11), each
 * EXECUTED here - the shipped browser code in Chromium, the shipped server
 * modules and routers in Node - and each mutation-verified (restoring the
 * defect fails the test that names it).
 *
 *   1. A preset's offerings reached a brand matched by host, slug prefix or
 *      name containment ("Boathouse Coffee" -> boAt, "Apple Pie Bakery" ->
 *      Apple). Now: only the template the record says it was made from
 *      (brand_data.template) AND the same host, browser and server alike.
 *   2. The buyer agent fell back to unjudged smart_products rows, and its
 *      knowledge sync scraped tenant zero's site for every brand.
 *   3. A blocking identity conflict (legal entity, logo, social, claims,
 *      imagery from another domain) was refused only at activation; every
 *      generator still printed it.
 *   4. An anonymous server-to-server call naming another workspace was
 *      answered as tenant zero.
 *   5. brandIdentity() hashed too little, and a null identity replayed.
 *   6. Every mailer image slot was painted tenant zero's red.
 *
 * Run: npx playwright test tests/review-leak-fixes.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRESETS = path.join(ROOT, 'data', 'brands', 'presets');
const ORIGIN = 'http://app.example.test';

/* ── 1. preset offerings: the template the record names, on its host ─────── */

async function openWith(page, brand) {
  const slugsFetched = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    if (u.pathname === '/t.html') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><script>' +
        'window.__B=' + JSON.stringify(brand) + ';' +
        'window.BrandContext={brand:window.__B,ready:function(){return Promise.resolve(window.__B)},' +
        'isTenantZero:function(){return false},catalogForGeneration:function(){return null},' +
        'device:{isDeviceId:function(id){return /^local-/.test(String(id))}}};' +
        '</script><script src="/brand-catalog.js"></script><script src="/brand-demo.js"></script></head><body></body></html>' });
    }
    if (u.pathname === '/brand-catalog.js' || u.pathname === '/brand-demo.js') {
      return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, u.pathname.slice(1)), 'utf8') });
    }
    if (u.pathname === '/api/public-config' && u.searchParams.get('op') === 'presets') {
      const slug = u.searchParams.get('slug');
      if (slug) {
        slugsFetched.push(slug);
        const f = path.join(PRESETS, slug.replace(/[^a-z0-9-]/g, '') + '.json');
        if (!fs.existsSync(f)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false}' });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, preset: JSON.parse(fs.readFileSync(f, 'utf8')) }) });
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(Object.assign({ ok: true }, JSON.parse(fs.readFileSync(path.join(PRESETS, 'index.json'), 'utf8')))) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(ORIGIN + '/t.html');
  const got = await page.evaluate(() => Promise.all([
    window.BrandCatalog.load('us'),
    window.BrandCatalog.loadOfferings(),
    window.BrandDemo.ready(),
  ]).then(([cat, offs, demo]) => ({
    source: cat.source, n: cat.products.length, reason: cat.reason,
    names: cat.products.map((p) => p.name || p.title || ''),
    offerings: offs.evergreen.length + offs.upcoming.length + offs.past.length,
    demoOfferings: (demo.offerings || []).length,
  })));
  return { got, slugsFetched };
}

const LOOKALIKES = [
  { name: 'Boathouse Coffee', slug: 'boathouse-coffee', preset: 'boat' },
  { name: 'Puma Pets', slug: 'puma-pets', preset: 'puma' },
  { name: 'Zara Home Decor', slug: 'zara-home-decor', preset: 'zara' },
  { name: 'Apple Pie Bakery', slug: 'apple-pie-bakery', preset: 'apple' },
];

test.describe('1. a preset\'s offerings reach only a brand made from that template, on its host', () => {
  for (const L of LOOKALIKES) {
    test(L.name + ' gets no preset offerings and says the catalogue is missing', async ({ page }) => {
      // Each lookalike shares a slug prefix and name words with a preset; one
      // (Apple Pie Bakery) even names the preset's own site. None was made
      // from that template.
      const presetSite = JSON.parse(fs.readFileSync(path.join(PRESETS, L.preset + '.json'), 'utf8')).website;
      const brand = { id: 'local-' + L.slug, slug: L.slug, name: L.name, storage: 'device', website: L.preset === 'apple' ? presetSite : '', regions: [{ code: 'US', home: true }] };
      const { got, slugsFetched } = await openWith(page, brand);
      expect(slugsFetched, 'no preset record was fetched for ' + L.name).toEqual([]);
      expect(got.source).toBe('none');
      expect(got.n).toBe(0);
      expect(got.reason).toContain('[DATA REQUIRED BEFORE LAUNCH: product catalogue, ' + L.name);
      expect(got.offerings).toBe(0);
      expect(got.demoOfferings).toBe(0);
    });
  }

  test('the same name AND host, but no template on the record: nothing', async ({ page }) => {
    const apple = JSON.parse(fs.readFileSync(path.join(PRESETS, 'apple.json'), 'utf8'));
    const { got, slugsFetched } = await openWith(page, { id: 'local-apple', slug: 'apple', name: apple.name, website: apple.website, storage: 'device' });
    expect(slugsFetched).toEqual([]);
    expect(got.n).toBe(0);
  });

  test('a template on the record but a different host: nothing', async ({ page }) => {
    const { got, slugsFetched } = await openWith(page, { id: 'local-apple-pie', slug: 'apple-pie', name: 'Apple Pie Bakery', website: 'https://applepie.example', storage: 'device', template: 'apple' });
    expect(slugsFetched).toEqual([]);
    expect(got.n).toBe(0);
  });

  test('positive control: made from the apple template on apple.com gets apple\'s offerings', async ({ page }) => {
    const apple = JSON.parse(fs.readFileSync(path.join(PRESETS, 'apple.json'), 'utf8'));
    expect(apple.offerings.length).toBeGreaterThan(0);
    const { got, slugsFetched } = await openWith(page, { id: 'local-mine', slug: 'my-store', name: 'My Store', website: apple.website, storage: 'device', brand_data: { template: { slug: 'apple', name: apple.name, website: apple.website } } });
    expect(slugsFetched).toContain('apple');
    expect(got.source).toBe('offerings');
    expect(got.n).toBe(apple.offerings.length);
    expect(got.demoOfferings).toBe(apple.offerings.length);
  });

  test('server twin: _resolveBrandOfferings takes the same rule', () => {
    const plan = require('../api/_shared/smart-brain-plan.js');
    const resolve = plan.__test_resolveBrandOfferings;
    expect(typeof resolve, 'smart-brain-plan exports _resolveBrandOfferings').toBe('function');
    const apple = JSON.parse(fs.readFileSync(path.join(PRESETS, 'apple.json'), 'utf8'));
    // name + website equal, no template: not the preset's
    expect(resolve({ name: apple.name, website: apple.website })).toEqual([]);
    expect(resolve({ name: 'Apple Pie Bakery', website: apple.website })).toEqual([]);
    expect(resolve({ name: 'Apple Pie Bakery', website: 'https://pie.example', brand_data: { template: { slug: 'apple' } } })).toEqual([]);
    expect(resolve({ name: 'Mine', website: apple.website, brand_data: { template: { slug: 'apple' } } }).length).toBe(apple.offerings.length);
  });
});

/* ── 2. the buyer agent: its own catalogue or none; its own site or nothing ─ */

function agentWorld() {
  const core = require('../api/_shared/brain-core.js');
  const inst = core.db();
  const calls = { upserts: [], prompts: [], fetched: [], uas: [] };
  const ZERO_ROWS = [{ sku: 'Z1', title: 'Tenant Zero Painted Sneaker', category: 'sneakers', price: 99, tags: ['grail'], url: 'https://www.knickgasm.com/products/z1', active: true }];
  const saved = { select: inst.select, upsert: inst.upsert, insert: inst.insert };
  inst.select = async (table) => {
    if (table === 'smart_agents') return [{ id: 'ag-1', name: 'Advisor', persona: {}, catalog_scope: {} }];
    if (table === 'smart_products') return ZERO_ROWS;
    return [];
  };
  inst.upsert = async (table, rows) => { calls.upserts.push({ table, rows }); return rows; };
  inst.insert = async () => [];
  const llmPath = require.resolve('../api/_shared/llm.js');
  const agentPath = require.resolve('../api/_shared/brain-agent.js');
  const savedLlm = require.cache[llmPath];
  const fake = async (o) => { calls.prompts.push(String(o.systemPrompt || '') + '\n' + String(o.userMessage || '')); return { text: 'Here is what I can say.', provider: 'scripted' }; };
  require.cache[llmPath] = { id: llmPath, filename: llmPath, loaded: true, exports: fake };
  delete require.cache[agentPath];
  const agents = require(agentPath);
  const savedFetch = global.fetch;
  const dns = require('dns').promises;
  const savedLookup = dns.lookup;
  dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  global.fetch = async (url, init) => {
    const u = new URL(String(url));
    calls.fetched.push(u.href);
    calls.uas.push(((init && init.headers) || {})['User-Agent'] || '');
    const html = (t, links) => new Response('<!doctype html><html><head><title>' + t + '</title></head><body><h1>' + t + '</h1><p>Single-estate teas from our own gardens.</p>' + (links || '') + '</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (u.hostname === 'otherbrand.example') {
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /private\n', { status: 200, headers: { 'content-type': 'text/plain' } });
      if (u.pathname === '/') return html('Otherbrand Teas', '<a href="/about">About</a><a href="/private/x">x</a>');
      if (u.pathname === '/about') return html('About Otherbrand Teas');
      return new Response('', { status: 404 });
    }
    throw new Error('unrouted host in test: ' + u.href);
  };
  const restore = () => {
    Object.assign(inst, saved); global.fetch = savedFetch; dns.lookup = savedLookup;
    if (savedLlm) require.cache[llmPath] = savedLlm; else delete require.cache[llmPath];
    delete require.cache[agentPath];
  };
  return { agents, calls, restore };
}
const OTHER = { id: 'ws-other', slug: 'otherbrand-teas', name: 'Otherbrand Teas', website: 'https://otherbrand.example', owns_shipped: false, regions: [{ code: 'IN', home: true, currency: 'INR' }], palette: {}, typography: {}, voice: {} };
function inScope(brand, fn) {
  const rs = require('../api/_shared/request-scope.js');
  return rs.run({ headers: {}, query: {}, body: {}, __brand: brand }, fn);
}

test.describe('2. the buyer agent reads only the active brand\'s catalogue and site', () => {
  test('chat: a brand with no catalogue of its own is offered no smart_products rows', async () => {
    const w = agentWorld();
    try {
      await inScope(OTHER, () => w.agents.chat({ agentId: 'ag-1', message: 'What should I buy?' }));
      expect(w.calls.prompts.length).toBe(1);
      const p = w.calls.prompts[0];
      expect(p).not.toContain('Tenant Zero Painted Sneaker');
      expect(p).not.toContain('knickgasm.com');
      expect(p).toContain('[DATA REQUIRED BEFORE LAUNCH: product catalogue, Otherbrand Teas]');
    } finally { w.restore(); }
  });

  test('team copilot: the same rule', async () => {
    const w = agentWorld();
    try {
      await inScope(OTHER, () => w.agents.teamChat({ message: 'Draft a plan for next week' }));
      const p = w.calls.prompts.join('\n');
      expect(w.calls.prompts.length).toBeGreaterThan(0);
      expect(p).not.toContain('Tenant Zero Painted Sneaker');
      expect(p).toContain('[DATA REQUIRED BEFORE LAUNCH: product catalogue, Otherbrand Teas]');
    } finally { w.restore(); }
  });

  test('syncKnowledge reads the active brand\'s own site, honours robots.txt, with the platform\'s user agent', async () => {
    const w = agentWorld();
    try {
      const out = await inScope(OTHER, () => w.agents.syncKnowledge('ag-1'));
      expect(w.calls.fetched.some((u) => /knickgasm/i.test(u)), w.calls.fetched.join('\n')).toBe(false);
      expect(w.calls.fetched.every((u) => new URL(u).hostname === 'otherbrand.example')).toBe(true);
      expect(w.calls.fetched).toContain('https://otherbrand.example/robots.txt');
      expect(w.calls.fetched.some((u) => u.includes('/private'))).toBe(false);
      const UA = require('../api/_shared/site-crawl.js').DEFAULTS.userAgent;
      expect(new Set(w.calls.uas)).toEqual(new Set([UA]));
      expect(out.knowledge_items).toBeGreaterThan(0);
      const rows = w.calls.upserts.filter((x) => x.table === 'smart_agent_knowledge').flatMap((x) => x.rows);
      expect(rows.length).toBe(out.knowledge_items);
      for (const r of rows) {
        expect(new URL(r.source_url).hostname).toBe('otherbrand.example');
        expect(JSON.stringify(r)).not.toMatch(/knickgasm|Tenant Zero/i);
      }
    } finally { w.restore(); }
  });

  test('syncKnowledge with no website on the record does nothing and says so', async () => {
    const w = agentWorld();
    try {
      const out = await inScope(Object.assign({}, OTHER, { website: '' }), () => w.agents.syncKnowledge('ag-1'));
      expect(out.knowledge_items).toBe(0);
      expect(out.note).toContain('Otherbrand Teas has no website on its record');
      expect(w.calls.fetched).toEqual([]);
      expect(w.calls.upserts).toEqual([]);
    } finally { w.restore(); }
  });
});

/* ── 3. a blocking identity conflict never reaches generation ────────────── */

test.describe('3. another domain\'s legal entity, logo and social never reach a prompt or an asset', () => {
  const A = require('./agents-harness');
  const H = require('./router-harness');
  const F = require('./lib/brand-invariant-fixtures');
  const FOREIGN_LEGAL = 'Foreigncorp Wellness Pvt Ltd, Ludhiana 141001';
  const FOREIGN_SOCIAL = 'https://www.instagram.com/foreigncorp_official';
  const FOREIGN_LOGO = 'https://cdn.foreigncorp.example/foreigncorp-logo.png';

  function mixedRow(ws, accepted) {
    const row = F.workspaceRow(F.QUILL, ws);
    row.logo_url = FOREIGN_LOGO;
    row.brand_data = Object.assign({}, row.brand_data, {
      legal_entity: FOREIGN_LEGAL,
      social: [{ platform: 'instagram', url: FOREIGN_SOCIAL, source_url: 'https://foreigncorp.example/' }],
      field_origins: {
        'brand_data.legal_entity': { url: 'https://foreigncorp.example/about', origin: 'site-parse', signal: 'json-ld:Organization.address' },
        logo_url: { url: 'https://foreigncorp.example/', origin: 'site-parse', signal: 'header logo' },
      },
      coherence: accepted ? { accepted: accepted.map((id) => ({ id })) } : {},
    });
    delete row.legal_entity;
    return row;
  }
  async function drive(accepted) {
    const w = await A.world({});
    try {
      const uid = 'user-mixed', tok = H.jwtShaped(uid), ws = 'ws-mixed';
      w.db.addUser(tok, uid, 'mixed@example.test').addWorkspace(ws, uid, mixedRow(ws, accepted)).setActive(uid, ws);
      w.db.workspaces['ws-oldest'].created_at = '2026-01-01T00:00:00.000Z';
      w.db.syncIdentityTables();
      const o = new URL(F.QUILL.website).origin;
      w.db.route((u) => u.startsWith(o) || u.startsWith('https://foreigncorp.example'), () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => 'not found', json: async () => ({}) }));
      const auth = { state: 'anonymous', headers: { authorization: 'Bearer ' + tok } };
      const out = [];
      const runs = [
        ['/api/calendar', { action: 'smart-brain-preview' }, { entry: { id: 'mx-slot', date: '2026-10-20', market: 'IN', cohort: { name: 'At Risk', size: 400, rules: ['last order 90-180 days'] }, objective: 'reactivation', channels: ['email', 'landing_page'] } }, true],
        ['/api/calendar', { action: 'trigger-mailer' }, { entry: { date: '2026-10-20', market: 'IN', segment: 'At-Risk', archetype: 'hero-led-editorial', content_type: 'winback', hero_product: 'Quillforth Ward Atlas Print' } }, true],
        ['/api/brain', { action: 'team-chat' }, { message: 'Write the email footer for this week.' }, false],
      ];
      for (const [p, q, json, down] of runs) {
        w.reset();
        w.llm.down = down;
        const res = await w.request(p, Object.assign({ query: q, json, method: 'POST' }, auth));
        w.llm.down = false;
        out.push({ id: q.action, status: res.status, text: res.text || '', prompts: w.llm.calls.map((c) => c.prompt || '').join('\n') });
      }
      return out;
    } finally { await w.close(); }
  }

  test('a record whose legal entity, logo and social came from another domain: none of them is printed or briefed', async () => {
    const runs = await drive(null);
    for (const r of runs) {
      expect(r.status, r.id + ' ran: ' + r.text.slice(0, 200)).toBeLessThan(300);
      const hay = r.text + '\n' + r.prompts;
      expect(hay.length, r.id + ' produced something to judge').toBeGreaterThan(200);
      expect(hay, r.id).not.toContain('Foreigncorp');
      expect(hay, r.id).not.toContain('foreigncorp_official');
      expect(hay, r.id).not.toContain('foreigncorp-logo');
    }
    const all = runs.map((r) => r.text + r.prompts).join('\n');
    expect(all).toContain('[DATA REQUIRED BEFORE LAUNCH: legal entity, Quillforth Gazette]');
  });

  test('positive control: the same values, KEPT by the person, are this brand\'s and are used', async () => {
    const runs = await drive(['cross_domain:brand_data.legal_entity:foreigncorp.example', 'cross_domain:logo_url:foreigncorp.example', 'cross_domain:brand_data.social:foreigncorp.example']);
    const all = runs.map((r) => r.text + r.prompts).join('\n');
    expect(all).toContain('Foreigncorp Wellness Pvt Ltd');
  });
});

/* ── 4. an anonymous call naming a workspace gets THAT workspace's brand ─── */

test.describe('4. a request with no verified caller is answered as no brand: never the workspace it names, never tenant zero', () => {
  const A = require('./agents-harness');
  const F = require('./lib/brand-invariant-fixtures');
  const ZERO_NAME = F.ZERO.name;

  async function brandFor(workspaceId, headers) {
    const w = await A.world({});
    try {
      w.db.addUser('tok-bramble', 'user-bramble', 'b@example.test').addWorkspace('ws-bramble', 'user-bramble', F.workspaceRow(F.BRAMBLE, 'ws-bramble'));
      w.db.workspaces['ws-oldest'].created_at = '2026-01-01T00:00:00.000Z';
      w.db.syncIdentityTables();
      // The router hands the core req.__brand; record what it resolved.
      const growth = require(require('path').join(A.ROOT, 'api/_shared/growth-os-core.js'));
      const seen = [];
      const real = growth.handle;
      growth.handle = async (req, res) => { seen.push(req.__brand || null); return res.json({ ok: true }); };
      try {
        // Server to server: no Origin, no bearer, a workspace named.
        const res = await w.request('/api/brain', { query: Object.assign({ action: 'growth-os' }, workspaceId ? { workspace_id: workspaceId } : {}), method: 'GET', headers });
        expect(res.status, res.text).toBe(200);
      } finally { growth.handle = real; }
      expect(seen.length, 'the core was reached').toBe(1);
      return seen[0];
    } finally { await w.close(); }
  }

  // CHANGED ON PURPOSE (2026-10-20, found on production): an anonymous caller
  // that named a workspace used to be answered AS that workspace, which let
  // anyone read or write any brand by naming it. Now only the scheduler is.
  test('naming another brand\'s workspace anonymously is not that brand, and not tenant zero', async () => {
    const b = await brandFor('ws-bramble');
    expect(b && b.unresolved).toBe(true);
    expect(JSON.stringify(b)).not.toContain(F.BRAMBLE.name);
    expect(JSON.stringify(b)).not.toContain(ZERO_NAME);
  });

  test('the scheduler naming a workspace is answered as that brand\'s own record', async () => {
    const b = await brandFor('ws-bramble', { authorization: 'Bearer ' + require('./router-harness').CRON });
    expect(b && b.name).toBe(F.BRAMBLE.name);
    expect(require('../api/_shared/brand-runtime.js').homeRegion(b)).toBe('UK');
  });

  test('an anonymous request naming no workspace is no brand; code with no request (a worker) keeps the shipped default', async () => {
    const rt = require('../api/_shared/brand-runtime.js');
    const anon = { headers: {}, query: {}, body: {} };
    const b = await rt.resolve(anon, { auth: { ok: false, status: 401 }, workspace_id: null, named_workspace: '' });
    expect(b && b.unresolved).toBe(true);
    expect(JSON.stringify(b)).not.toContain(ZERO_NAME);
    const worker = await rt.resolve(null, { auth: { ok: false, status: 401 }, workspace_id: null, named_workspace: '' });
    expect(worker && worker.name).toBe(ZERO_NAME);
  });

  test('naming a workspace that cannot be read is the unresolved placeholder, never tenant zero', async () => {
    const b = await brandFor('ws-does-not-exist');
    expect(b && b.unresolved).toBe(true);
    expect(JSON.stringify(b)).not.toContain(ZERO_NAME);
  });

  test('calendar export: an entry with no brand and none in scope states the gap, not tenant zero\'s market or store', () => {
    const ex = require('../api/_shared/calendar-export.js');
    const csv = ex.buildExportCsv([{ id: 'e1', date: '2026-10-20', cohort: { name: 'At Risk', size: 0 }, heroProduct: { title: 'A product', handle: 'a-product' } }]);
    expect(csv).toContain('[DATA REQUIRED BEFORE LAUNCH: region store URL, this brand]');
    expect(csv).toContain('[DATA REQUIRED BEFORE LAUNCH: brand name');
    expect(csv).not.toMatch(/knickgasm\.com/i);
  });

  test('social run: a workspace that only carries tenant zero\'s slug is not planned for tenant zero\'s market', async () => {
    // Undecided (an id, tenant zero's slug, no owns_shipped): the product-facts
    // gate refuses it, and the run's market must follow that same answer.
    const llmPath = require.resolve('../api/_shared/llm.js');
    const savedLlm = require.cache[llmPath];
    const savedFetch = global.fetch;
    require.cache[llmPath] = { id: llmPath, filename: llmPath, loaded: true, exports: async () => { throw new Error('no model in this test'); } };
    global.fetch = async (u) => { throw new Error('no network in this test: ' + u); };
    const socialPath = require.resolve('../api/_shared/social-core.js');
    delete require.cache[socialPath];
    try {
      const social = require(socialPath);
      const copy = { id: 'ws-copycat', slug: F.ZERO.slug, name: 'Copycat Kicks', website: 'https://copycat.example', regions: [{ code: 'IN', home: true }], palette: {}, typography: {}, voice: {} };
      const out = await social.runDaily({ dry_run: true, platforms: ['instagram'], date: '2026-10-20', brand: copy });
      expect(out.market, 'market of the run').not.toBe('UK');
      expect(JSON.stringify(out.focus || {})).not.toMatch(/knickgasm/i);
    } finally {
      if (savedLlm) require.cache[llmPath] = savedLlm; else delete require.cache[llmPath];
      global.fetch = savedFetch;
      delete require.cache[socialPath];
    }
  });
});

/* ── 6. a mailer's image slot sits on the brand's own ground ─────────────── */

test.describe('6. a mailer image slot is painted with the brand\'s ground, never tenant zero\'s red', () => {
  const F = require('./lib/brand-invariant-fixtures');
  const ZERO_HEX = Object.values(F.ZERO.palette || {}).filter((h) => /^#[0-9a-f]{6}$/i.test(String(h)))
    .filter((h) => !/^#f{6}$/i.test(h)); // white is anybody's
  for (const B of [F.BRAMBLE, F.QUILL]) {
    test('the visual mailer for ' + B.name + ' carries none of tenant zero\'s colours', () => {
      const ct = require('../api/_shared/calendar-trigger.js');
      const core = require('../api/_shared/brand-workspace-core.js');
      const html = ct.helpers.renderTextVariant({ style: 'visual', brand: F.recordOf(B), market: (B.regions[0] || {}).code, subject: 'A note', hero_prompt: 'the product on a table, natural light', hero_product: B.catalogue[0].title, body_blocks: [{ heading: 'Hello', body: 'A short note.' }] });
      const slot = (html.match(/<img[^>]*PASTE_IMAGE_URL_HERE[^>]*>/) || [''])[0];
      expect(slot, 'the hero slot was rendered').not.toBe('');
      const want = core.sectionGround(B.palette.primary, B.palette.accent, B.palette.surface);
      expect(slot).toContain('background:' + want + ';');
      for (const hex of ZERO_HEX) expect(html.toLowerCase(), hex).not.toContain(hex.toLowerCase());
    });
  }
  test('a slot handed no ground carries no background at all', () => {
    const MF = require('../api/_shared/mailer-format.js');
    const s = MF.assetSlot({ kind: 'image', slot: 'hero', displayW: 600, displayH: 300, prompt: 'x' });
    expect(s).not.toMatch(/background:/);
    // A dark-neutral ground is never a section background.
    expect(MF.assetSlot({ kind: 'image', slot: 'hero', displayW: 600, displayH: 300, prompt: 'x', ground: '#111111' })).not.toMatch(/background:/);
  });
});
