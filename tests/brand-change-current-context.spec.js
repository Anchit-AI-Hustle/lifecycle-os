/**
 * A brand set up or changed uses ONLY its current context (2026-10-11).
 * ---------------------------------------------------------------------------
 * The operator: "ensure if any brand is set up or changed, then it only uses
 * the updated context and correct brand specific and brand relevant schema and
 * assets", then "if anywhere one url is being referenced in the brand, the
 * same url only must be referenced ... throughout that brand", then "each
 * brand must have its own unique and real brand identity". Live evidence: the
 * only workspace was renamed Mamaearth -> DelhiChic -> Deli Chic -> Lenskart
 * (lenskart.com) while keeping a catalogue from delichic.co.in read off
 * nike.in, and stored slots, pages and working state kept the earlier brand's
 * copy and images.
 *
 * ONE fingerprint (api/_shared/brand-identity.js, byte for byte in
 * brand-context.js) says which version of a brand an artefact was made for,
 * and ONE site rule (brand-coherence.js: siteOf / urlOnSite / sameBrand) says
 * which values are this brand's. Every case here runs the SHIPPED code: the
 * brand router over tests/lib/brand-save-fake.js, the /lp resolver and route,
 * the review library, the context pack, the KB router, and the pages in
 * Chromium. Each fix is mutation-checked (see CLAUDE.md, 2026-10-11).
 * ---------------------------------------------------------------------------
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const req = (rel) => require(path.join(ROOT, rel));
const COH = req('api/_shared/brand-coherence.js');
const BI = req('api/_shared/brand-identity.js');
const F = require('./lib/brand-invariant-fixtures.js');
const { makeReq, makeRes, envScope, BASE, ANON_KEY, SERVICE_KEY, FakeSupabase } = require('./lib/fake-supabase.js');

test.describe.configure({ mode: 'parallel' });

const clone = (o) => JSON.parse(JSON.stringify(o));
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.owner.sig';
const OWNER = 'aaaaaaaa-0000-4000-8000-0000000000c7';
const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'BRAND_RENDER', 'SMART_BRAIN_SUPABASE_URL']);
const QUILL_SITE = 'https://quillforth-gazette.example';
const OTHER = 'https://brambleweld-larder.example';
const read = (value, url, origin) => ({ value, source_url: url, origin: origin || 'site-parse', signal: 'fixture' });

/** Quillforth as a record a read of its OWN site produced (so it is established at quillforth-gazette.example). */
function quillRecord(extra) {
  const r = F.recordOf(F.QUILL);
  r.brand_data = { brand_extraction: { source: QUILL_SITE + '/', applied: { name: read(F.QUILL.name, QUILL_SITE + '/') } }, claims: F.QUILL.claims };
  delete r.claims; delete r.offerings; delete r.competitors; delete r.legal_entity;
  return Object.assign(r, extra || {});
}

function world() {
  const db = req('tests/lib/brand-save-fake.js').makeDb(TOKEN, OWNER);
  db.install();
  process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.BRAND_RENDER = 'off';
  return db;
}
const core = req('api/_shared/brand-workspace-core.js');
async function brandOp(op, body, method) {
  const r = makeReq({ token: TOKEN, query: { action: 'brand', op }, body, method: method || (body ? 'POST' : 'GET') });
  const res = makeRes();
  await core.handle(r, res);
  return { status: res.code, json: res.payload };
}

test.beforeEach(() => ENV.save());
test.afterEach(() => ENV.restore());

/* ═══════════════════════════════════════════════════════════════════════════
   1. ONE fingerprint
   ═══════════════════════════════════════════════════════════════════════════ */

function blockOf(text, name, indent) {
  const B = `/* ${name}:BEGIN */`, E = `/* ${name}:END */`;
  const i = text.indexOf(indent + B), j = text.indexOf(indent + E);
  expect(i, `the ${name} block is missing`).toBeGreaterThanOrEqual(0);
  return text.slice(i, j + indent.length + E.length).split('\n').map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n');
}

test('the fingerprint is ONE rule: the browser carries the server\'s block byte for byte, Smart Brain uses it, and its SHA-256 is Node\'s', () => {
  const srv = blockOf(fs.readFileSync(path.join(ROOT, 'api/_shared/brand-identity.js'), 'utf8'), 'BRAND-IDENTITY', '');
  const web = blockOf(fs.readFileSync(path.join(ROOT, 'brand-context.js'), 'utf8'), 'BRAND-IDENTITY', '  ');
  expect(srv.length).toBeGreaterThan(3000);
  expect(web).toBe(srv);
  expect(req('api/_shared/smart-brain-plan.js').__test_brandIdentity, 'Smart Brain keeps a second fingerprint').toBe(BI.brandIdentity);
  for (const s of ['', 'abc', 'Quillforth\u0001quillforth-gazette.example', 'héllo 世界 😀', 'x'.repeat(5000)]) {
    expect(BI.sha256(s)).toBe(crypto.createHash('sha256').update(s).digest('hex'));
  }
  const a = BI.brandIdentity(quillRecord({ id: 'w1' }));
  expect(a).toMatch(/^bi2:[0-9a-f]{24}$/);
  // A version change of any identity input is a new fingerprint.
  for (const change of [{ name: 'Quillforth Daily' }, { website: 'https://quillforth.example' }, { palette: { primary: '#123456' } }, { voice: { tone: 'loud' } }]) {
    expect(BI.brandIdentity(quillRecord(Object.assign({ id: 'w1' }, change))), JSON.stringify(change)).not.toBe(a);
  }
  expect(BI.staleSentence('landing page', 'Mamaearth', 'Lenskart')).toMatch(/made for "Mamaearth".*now "Lenskart".*not shown, reused or published as "Lenskart"'s.*kept, not deleted/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Where the record is WRITTEN: one brand per record, one record per brand,
      one site per brand
   ═══════════════════════════════════════════════════════════════════════════ */

test.describe('the brand router', () => {
  let db;
  test.beforeEach(() => { db = world(); });
  test.afterEach(() => db.restore());

  test('a record established at its site is never turned into another brand, and a second record of the same site is refused', async () => {
    const made = await brandOp('save', { brand: quillRecord() });
    expect(made.status, JSON.stringify(made.json)).toBe(200);
    const id = made.json.brand.id;
    const before = clone(db.table('brand_workspaces').find((w) => w.id === id));

    const moved = await brandOp('save', { brand: { id, name: F.BRAMBLE.name, website: OTHER } });
    expect(moved.status).toBe(409);
    expect(moved.json.code).toBe('brand_change_refused');
    expect(moved.json.message).toMatch(/brambleweld-larder\.example is another brand.*start a new brand from brambleweld-larder\.example.*"Quillforth Gazette" is kept as it is/);
    const renamed = await brandOp('save', { brand: { id, name: F.BRAMBLE.name } });
    expect(renamed.status).toBe(409);
    expect(renamed.json.message).toMatch(/"Brambleweld Larder" is not a name of the brand at quillforth-gazette\.example/);
    const after = db.table('brand_workspaces').find((w) => w.id === id);
    expect(after.name).toBe(before.name);
    expect(after.website).toBe(before.website);
    expect(after.updated_at, 'a refused change wrote the record').toBe(before.updated_at);

    // A correction of the SAME brand is allowed: another page of its site.
    const same = await brandOp('save', { brand: { id, website: 'https://www.quillforth-gazette.example/en' } });
    expect(same.status, JSON.stringify(same.json)).toBe(200);

    const second = await brandOp('save', { brand: { name: 'Quillforth Gazette Again', website: 'https://www.quillforth-gazette.example' } });
    expect(second.status).toBe(409);
    expect(second.json.code).toBe('brand_exists');
    expect(second.json.message).toMatch(/"Quillforth Gazette" is already the brand at quillforth-gazette\.example.*Open the existing brand/);
    expect(db.table('brand_workspaces').length).toBe(1);
  });

  test('a URL TYPED on another site is refused with a sentence; values READ from another site are set aside, kept, never applied', async () => {
    const made = await brandOp('save', { brand: quillRecord() });
    const id = made.json.brand.id;
    const store = await brandOp('save', { brand: { id, regions: [{ code: 'IN', currency: 'INR', store_url: OTHER, home: true }] } });
    expect(store.status).toBe(409);
    expect(store.json.code).toBe('url_off_site');
    expect(store.json.message).toMatch(/The IN store URL https:\/\/brambleweld-larder\.example is on brambleweld-larder\.example; this brand's website is quillforth-gazette\.example.*Make brambleweld-larder\.example the website, start a new brand from it/);
    // A logo is a FILE, judged by the page it was found on (the coherence
    // rule's own answer): a typed one hosted elsewhere is the person's, and a
    // logo READ from another site's page is set aside below.
    expect((await brandOp('save', { brand: { id, logo_url: 'https://res.cloudinary.com/q/qfg.svg' } })).status).toBe(200);

    // What a read of ANOTHER site put on the record (the live shape).
    const stored = db.table('brand_workspaces').find((w) => w.id === id);
    const mixed = clone(stored);
    mixed.catalog_source = { url: OTHER, row_count: 54, coverage: { base: 'https://www.nike.in' } };
    mixed.brand_data.imagery = [{ url: OTHER + '/hero.jpg', page: OTHER + '/' }, { url: QUILL_SITE + '/front.jpg', page: QUILL_SITE + '/' }];
    mixed.brand_data.social = [{ platform: 'instagram', url: 'https://www.instagram.com/brambleweld/', source_url: OTHER + '/' }];
    mixed.brand_data.design_system = { version: 1, buttons: {} };
    mixed.brand_data.field_origins = { 'brand_data.design_system': { origin: 'site-render', url: OTHER + '/' } };
    const saved = await brandOp('save', { brand: mixed });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    let row = db.table('brand_workspaces').find((w) => w.id === id);
    expect(row.catalog_source || {}, 'another site\'s catalogue is still this brand\'s').toEqual({});
    expect(row.brand_data.imagery.map((x) => x.page)).toEqual([QUILL_SITE + '/']);
    expect(row.brand_data.social || []).toEqual([]);
    expect(row.brand_data.design_system, 'another site\'s design system is still applied').toBeUndefined();
    const aside = row.brand_data.coherence.set_aside;
    expect(aside.map((e) => e.field).sort()).toEqual(['brand_data.design_system', 'brand_data.imagery', 'brand_data.social', 'catalog_source']);
    expect(aside.find((e) => e.field === 'catalog_source').value).toEqual(expect.objectContaining({ url: OTHER, row_count: 54 }));
    expect(aside.every((e) => e.domain === 'brambleweld-larder.example' && e.site === 'quillforth-gazette.example' && /brambleweld-larder\.example/.test(e.reason))).toBe(true);
    // Its rows stay in the table and are still another brand's, page-less ones included.
    const verdict = COH.catalogIdentity(row);
    expect(verdict.excluded).toBe(true);
    expect(verdict.sentence).toMatch(/imported from brambleweld-larder\.example, not from quillforth-gazette\.example/);
    expect(COH.catalogRowForeign({ title: 'Damson Chutney' }, verdict), 'a row with no page from the set-aside catalogue is used').toBe(true);
    expect(COH.catalogRowForeign({ product_url: QUILL_SITE + '/p/ledger' }, verdict)).toBe(false);

    // A form that never saw the history cannot erase it.
    const stale = clone(row); stale.brand_data = { claims: F.QUILL.claims };
    expect((await brandOp('save', { brand: stale })).status).toBe(200);
    row = db.table('brand_workspaces').find((w) => w.id === id);
    expect((row.brand_data.coherence || {}).set_aside || [], 'the set-aside history was dropped by a save').toHaveLength(aside.length);
  });

  test('the shell paints only this site\'s values, and carries the fingerprint stored artefacts are judged by', async () => {
    const r = quillRecord();
    r.logo_url = OTHER + '/mark.svg';
    r.palette = Object.assign({}, F.QUILL.palette, { primary: '#B5562B' });
    r.brand_data.field_origins = { logo_url: { origin: 'site-parse', url: OTHER + '/' }, 'palette.primary': { origin: 'site-render', url: OTHER + '/' } };
    r.brand_data.field_origin = { logo_url: 'site-parse', 'palette.primary': 'site-render' };
    // Inserted as the live record was (it predates the write rule).
    db.table('brand_workspaces').push(Object.assign(r, { id: 'ws-q', owner_id: OWNER, status: 'draft', created_at: db.tick(), updated_at: db.tick() }));
    const list = await brandOp('list');
    const shell = list.json.workspaces.find((w) => w.id === 'ws-q');
    expect(shell.logo_url, 'another site\'s logo is painted in the rail').toBe('');
    expect(String(shell.palette.primary || ''), 'another site\'s colour is painted').not.toBe('#B5562B');
    expect(shell.tokens['--brand-primary']).not.toBe('#B5562B');
    expect(shell.withheld.map((x) => x.field).sort()).toEqual(['logo_url', 'palette.primary']);
    expect(shell.identity).toBe(BI.brandIdentity(db.table('brand_workspaces').find((w) => w.id === 'ws-q')));
    // Generation reads the same: the design system and palette from another site never reach a renderer.
    const rt = req('api/_shared/brand-runtime.js');
    const g = rt.normalizeBrand(Object.assign(clone(r), { brand_data: Object.assign(clone(r.brand_data), { design_system: { version: 1 }, field_origins: Object.assign(clone(r.brand_data.field_origins), { 'brand_data.design_system': { origin: 'site-render', url: OTHER + '/' } }) }) }));
    expect(g.palette.primary).toBeUndefined();
    expect(req('api/_shared/design-system.js').resolve(g).present, 'a design system measured on another site was applied').toBe(false);
  });

  test('a starter template is never a brand with its own website: its colours, name and store block, and generation withholds them', () => {
    const rec = quillRecord({ palette: { primary: '#D0473E', accent: '#6A33D8', ink: '#111111', surface: '#FFFFFF' } });
    rec.brand_data.template = { slug: 'knickgasm', name: 'KNICKGASM', website: 'https://knickgasm.com', demo: true };
    rec.brand_data.field_origin = { 'palette.primary': 'preset', 'palette.accent': 'preset', 'typography.heading': 'preset' };
    const c = COH.brandCoherence(rec);
    expect(c.blocking).toBe(true);
    const ids = c.conflicts.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['template:palette.primary:template:knickgasm', 'template:typography.heading:template:knickgasm']));
    expect(c.conflicts.find((x) => x.field === 'palette.primary').message).toMatch(/KNICKGASM starter template \(knickgasm\.com\); this brand's website is quillforth-gazette\.example/);
    const g = COH.forGeneration(rec);
    expect(g.palette.primary).toBeUndefined();
    expect(g.typography.heading).toBeUndefined();
    // A demo OF the template (its own website) is the template, not a mix.
    const demo = Object.assign(clone(rec), { name: 'KNICKGASM', website: 'https://knickgasm.com', brand_data: { template: rec.brand_data.template, field_origin: rec.brand_data.field_origin } });
    expect(COH.brandCoherence(demo).conflicts.filter((x) => x.kind === 'template')).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Where stored artefacts are USED
   ═══════════════════════════════════════════════════════════════════════════ */

test.describe('stored artefacts made for another version of the brand', () => {
  let db;
  test.beforeEach(() => {
    db = new FakeSupabase();
    db.addUser(TOKEN, OWNER, 'owner@example.test');
    db.install();
    process.env.SUPABASE_URL = BASE; process.env.SUPABASE_ANON_KEY = ANON_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    // The oldest workspace is tenant zero's; Quillforth is another tenant.
    db.table('brand_workspaces').push({ id: 'ws-zero', name: 'Zero', slug: 'zero', owner_id: OWNER, created_at: '2026-01-01T00:00:00Z', brand_data: {} });
    const q = F.workspaceRow(F.QUILL, 'ws-q');
    db.table('brand_workspaces').push(Object.assign(q, { owner_id: OWNER, created_at: '2026-09-20T00:00:00Z' }));
  });
  test.afterEach(() => db.restore());

  test('/lp/<id> serves a page only for the brand version it was made for; otherwise 410 with the sentence, the page kept', async () => {
    const plan = req('api/_shared/smart-brain-plan.js');
    const now = await plan.currentBrandInfo({ workspace_id: 'ws-q' }, null);
    expect(now.ident).toMatch(/^bi2:/);
    expect(now.name).toBe('Quillforth Gazette');
    const page = (stamp, name) => ({ id: 'camp-q', workspace_id: 'ws-q', status: 'approved', payload: { campaign_id: 'camp-q', brand_identity: stamp, brand_name: name, assets: { landing_pages: [{ variant: 'A', html: '<!doctype html><title>Quillforth page</title>' }] } } });
    db.table('smart_generated_campaigns').push(page(now.ident, 'Quillforth Gazette'));
    let out = await plan.landingPageResolve('camp-q', {});
    expect(out.html).toBe('<!doctype html><title>Quillforth page</title>');

    // The brand changes (its palette and voice: a new version of its record).
    const ws = db.table('brand_workspaces').find((w) => w.id === 'ws-q');
    ws.palette = Object.assign({}, ws.palette, { primary: '#1F4E79' });
    req('api/_shared/workspace-scope.js').invalidate && req('api/_shared/workspace-scope.js').invalidate();
    out = await plan.landingPageResolve('camp-q', {});
    expect(out.html, 'a page made for the earlier version was served as the current brand\'s').toBeNull();
    expect(out.diag.brand_changed).toBe(true);
    expect(out.diag.message).toMatch(/This landing page was made for "Quillforth Gazette" as it was then .* not shown, reused or published/);

    // The shipped route says it, in nobody's colours, and keeps the row.
    const cal = req('api/calendar.js');
    const res = makeRes(); res.send = (b) => { res.payload = b; return res; };
    await cal(makeReq({ query: { action: 'lp', id: 'camp-q' }, method: 'GET' }), res);
    expect(res.code).toBe(410);
    expect(String(res.payload)).toMatch(/data-brand-changed>This landing page was made for &quot;Quillforth Gazette&quot;/);
    expect(String(res.payload)).not.toMatch(/#7B2D5E|#1F4E79|Quillforth page/i);
    expect(db.table('smart_generated_campaigns')).toHaveLength(1);
    // An unstamped page (made before fingerprints) is not replayed either.
    db.table('smart_generated_campaigns')[0] = page(undefined, undefined);
    expect((await plan.landingPageResolve('camp-q', {})).html).toBeNull();
  });

  test('a stored review read from another site is never this brand\'s proof, and a scan of an earlier website is not an answer about this one', async () => {
    const reviews = req('api/_shared/brand-reviews.js');
    const brand = F.recordOf(F.QUILL);
    db.table('brand_review_library').push(
      { workspace_id: 'ws-q', region: 'IN', quote: 'The ward ledger is the best thing in my inbox.', author: 'Asha P.', source_url: QUILL_SITE + '/reviews', created_at: db.tick() },
      { workspace_id: 'ws-q', region: 'IN', quote: 'This damson chutney is my favourite.', author: 'Tom R.', source_url: OTHER + '/reviews', created_at: db.tick() });
    const got = await reviews.reviewsForBrand({ brand, workspaceId: 'ws-q', market: 'IN', limit: 2, allowCrawl: false });
    expect(got.reviews.map((r) => r.quote)).toEqual(['The ward ledger is the best thing in my inbox.']);
    expect(got.limits.join(' ')).toMatch(/1 stored review\(s\) were read from another site than quillforth-gazette\.example/);

    // No usable review, and the last scan was of ANOTHER website: this site is read.
    db.table('brand_review_library').splice(0);
    db.table('brand_review_scan').push({ workspace_id: 'ws-q', region: 'IN', last_run_at: new Date().toISOString(), found: 0, last_note: 'site:brambleweld-larder.example no testimonials published' });
    db.route((u) => u.startsWith(QUILL_SITE), (u) => {
      const { response } = require('./lib/fake-supabase.js');
      if (/robots\.txt/.test(u)) return response(200, 'User-agent: *\nAllow: /', { 'content-type': 'text/plain' });
      return response(200, '<!doctype html><html><head><title>Q</title></head><body>No reviews</body></html>', { 'content-type': 'text/html' });
    });
    db.clearCalls();
    await reviews.reviewsForBrand({ brand, workspaceId: 'ws-q', market: 'IN', limit: 2 });
    expect(db.external().some((c) => c.url.startsWith(QUILL_SITE)), 'an earlier website\'s scan was taken as an answer about this site').toBe(true);
    // A recent scan of THIS site is an answer.
    db.table('brand_review_scan')[0].last_note = 'site:quillforth-gazette.example no testimonials published';
    db.clearCalls();
    const again = await reviews.reviewsForBrand({ brand, workspaceId: 'ws-q', market: 'IN', limit: 2 });
    expect(db.external()).toEqual([]);
    expect(again.limits.join(' ')).toMatch(/published no testimonials/);
  });

  test('a context pack about another site or name is reported, never used or applied', async () => {
    const pack = req('api/_shared/brand-context-pack.js');
    const brand = F.recordOf(F.QUILL);
    const old = { id: 'pk1', workspace_id: 'ws-q', site_url: OTHER, brand_name: F.BRAMBLE.name, brand_key: pack.packKey(OTHER, F.BRAMBLE.name).brand_key,
      status: 'done', stage: 'done', design_md: '---\nname: Brambleweld Larder\n---', design: { colors: { primary: '#2E6B4A' } }, knowledge: { ingested: 9 }, catalog: { imported: 54, url: OTHER }, sources: [OTHER + '/'] };
    const store = pack.memoryStore({ workspaceId: 'ws-q', brand, pack: old });
    const ctx = await pack.contextFor(store, 'ws-q');
    expect(ctx.current).toBe(false);
    expect(ctx.hidden).toBe(true);
    expect(ctx.design_md).toBeNull();
    expect(ctx.design).toEqual({});
    expect(ctx.catalog).toEqual({});
    expect(ctx.stale_note).toMatch(/describes https:\/\/brambleweld-larder\.example as "Brambleweld Larder"/);
    const block = pack.contextBlock(ctx);
    expect(block).toMatch(/NOT CURRENT/);
    expect(block).not.toMatch(/2E6B4A|54 row/);
    const applied = await pack.applyPack(store, 'ws-q', { 'palette.primary': '#2E6B4A' }, {});
    expect(applied).toEqual(expect.objectContaining({ ok: false, code: 'brand_changed' }));
    expect(applied.message).toMatch(/Nothing from it was applied/);
  });

  test('the KB guardrail judges relevance by the brand\'s OWN vocabulary, through the shipped KB router', async () => {
    const guard = req('api/_shared/ingest-guardrail.js');
    const bramble = Object.assign(F.recordOf(F.BRAMBLE), { owns_shipped: false });
    const sneaker = { title: 'Custom Air Force 1 drop', text: 'Hand-painted one-of-one sneakers, a grail colorway for your rotation.', url: 'https://kicks.example/af1' };
    const chutney = { title: 'Small batch damson chutney', text: 'Why small batch hedgerow preserves win repeat purchase.', url: 'https://food.example/damson' };
    expect((await guard.gatekeep(sneaker, { llm: false, brand: bramble })).keep, 'a sneaker article was kept for a preserves brand').toBe(false);
    expect((await guard.gatekeep(chutney, { llm: false, brand: bramble })).keep).toBe(true);
    const bare = await guard.gatekeep(sneaker, { llm: false, brand: { name: 'Ozzlewick', owns_shipped: false } });
    expect(bare.reason).toMatch(/Phase 1 relevance check skipped: Ozzlewick states no industry, offerings, vocabulary or competitors/);
    // Tenant zero keeps its own lists.
    expect((await guard.gatekeep(sneaker, { llm: false })).keep).toBe(true);

    // Through the router: the workspace's own record decides.
    db.table('brand_workspaces').push(Object.assign(F.workspaceRow(F.BRAMBLE, 'ws-b'), { owner_id: OWNER, created_at: '2026-09-21T00:00:00Z' }));
    db.route((u) => u.startsWith('https://kicks.example'), () => require('./lib/fake-supabase.js').response(200,
      '<html><head><title>Custom Air Force 1 drop</title></head><body>Hand-painted one-of-one sneakers, a grail colorway for your rotation.</body></html>', { 'content-type': 'text/html' }));
    // As the scheduler: since 2026-10-20 an anonymous caller naming a workspace
    // is not given it (found on production), and the scheduler still is.
    const kb = req('api/kb.js');
    const res = makeRes();
    const prevCron = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'cron-secret-for-kb-guardrail-test';
    try {
      await kb(makeReq({ query: { action: 'ingest', workspace_id: 'ws-b' }, body: { url: 'https://kicks.example/af1', workspace_id: 'ws-b' }, method: 'POST', headers: { authorization: 'Bearer cron-secret-for-kb-guardrail-test' } }), res);
    } finally { if (prevCron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prevCron; }
    expect(res.payload, JSON.stringify(res.payload)).toEqual(expect.objectContaining({ ok: true, filtered: true }));
    expect(res.payload.reason).toMatch(/Brambleweld Larder's own vocabulary/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. The pages, in Chromium
   ═══════════════════════════════════════════════════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const HOST = 'http://app.example.test';
const DEVICE_KEY = 'lifecycle.brand.device.workspaces';
const PAL_B = { primary: '#2E6B4A', accent: '#B5562B', ink: '#1E2A22', surface: '#FFFDF6', surface_alt: '#F6F1E4', muted: '#4A5A50' };
const PAL_Q = { primary: '#7B2D5E', accent: '#C8A13B', ink: '#2A1F33', surface: '#FBF7EF', surface_alt: '#F3ECDD', muted: '#5A4E63' };
function deviceRow(id, b, palette) {
  const r = F.recordOf(b);
  const data = { claims: r.claims || [], legal_entity: r.legal_entity || '' };
  delete r.claims; delete r.legal_entity; delete r.offerings; delete r.competitors;
  return Object.assign(r, { id, palette, status: 'active', onboarding_step: 6, brand_data: data, asset_hosts: [], catalog_source: {}, storage: 'device', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
}

async function wire(context, log, extra, host) {
  const H0 = host || HOST;
  await context.addInitScript(() => {
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) };
    try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); } catch (_) {}
  });
  await context.route((u) => !String(u).startsWith(H0), (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.abort('addressunreachable');
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});' : 'window.tailwind=window.tailwind||{};' });
  });
  await context.route(H0 + '/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/')) {
      const action = u.searchParams.get('action'), op = u.searchParams.get('op');
      const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) }).then(() => true);
      if (extra && await extra(u, route, json)) return;
      if (!action && !u.searchParams.has('health')) return json({ supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } });
      if (action === 'auth') return op === 'status' ? json({ ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only.' }) : json({ ok: false, error: 'invalid_session' }, 401);
      if (log) log.api.push(action + ':' + (op || ''));
      return json({ ok: false, error: 'session_verification_unavailable', message: 'The database is not answering.' }, 503);
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
}
async function seed(page, rows, active) {
  await page.goto(HOST + '/about.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [DEVICE_KEY, { version: 1, active_id: active, workspaces: rows }]);
}
const brandReady = (page, name) => page.waitForFunction((n) => window.BrandContext && window.BrandContext.loaded && window.BrandContext.brand && window.BrandContext.brand.name === n && !!window.BrandContext.brand.identity, name, { timeout: 20000 });

test('/assets lists only THIS brand version\'s assets and copies a prompt built from its own record, never tenant zero\'s', async ({ browser }) => {
  const context = await browser.newContext();
  const errors = [];
  await wire(context, { api: [] });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const B = deviceRow('local-bwl', F.BRAMBLE, PAL_B);
  await seed(page, [B], B.id);
  await page.goto(HOST + '/assets.html', { waitUntil: 'domcontentloaded' });
  await brandReady(page, 'Brambleweld Larder');
  await page.evaluate(() => {
    // The earlier, unscoped libraries (another brand's, any brand's).
    localStorage.setItem('vhd_logs', JSON.stringify([{ id: 1, date: '2026-09-01T00:00:00Z', prompt: 'KNICKGASM sneaker drop', type: 'drop', markets: ['US'], _full: { campaign_title: 'KNICKGASM AF1 drop' } }]));
    localStorage.setItem('lp-mailers', JSON.stringify([{ hero: 'Mamaearth B1G1 page', region: 'IN' }]));
    // Assets of EARLIER versions of this brand: one under another fingerprint,
    // one kept under the id alone (before versions were recorded).
    const id = window.BrandContext.brand.id;
    localStorage.setItem('lp-lib-mailers::' + id + '::0123456789abcdef01234567', JSON.stringify([{ hero: 'Old Brambleweld page', region: 'UK' }]));
    localStorage.setItem('lp-lib-mailers::' + id, JSON.stringify([{ hero: 'Unversioned Brambleweld page', region: 'UK' }]));
    // This version's own.
    localStorage.setItem('lp-lib-mailers::' + id + '::' + window.BrandContext.brand.identity.replace(/^bi2:/, ''), JSON.stringify([{ hero: 'Damson chutney season', region: 'UK', created_at: '2026-10-10T00:00:00Z' }]));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await brandReady(page, 'Brambleweld Larder');
  await page.waitForSelector('[data-act="prompt"]', { timeout: 20000 });
  const names = await page.$$eval('#grid .asset', (els) => els.map((e) => e.textContent || '').join(' | '));
  expect(names).toMatch(/Damson chutney season/);
  for (const other of ['KNICKGASM AF1 drop', 'Mamaearth B1G1 page', 'Old Brambleweld page', 'Unversioned Brambleweld page']) expect(names, other + ' was listed as this brand\'s').not.toContain(other);
  await page.click('[data-act="prompt"]');
  const copied = await page.waitForFunction(() => window.__copied, null, { timeout: 5000 }).then((h) => h.jsonValue());
  expect(copied).toContain('Brambleweld Larder');
  expect(copied).toContain('#2E6B4A');
  expect(copied).toMatch(/currency GBP/);
  for (const z of ['KNICKGASM', '#D0473E', 'Montserrat', 'B-Corp', 'sneaker']) expect(copied, 'tenant zero in the copied prompt: ' + z).not.toContain(z);
  expect(errors).toEqual([]);
  await context.close();
});

test('/assets keeps an earlier version\'s shared assets reachable: listed on request, labelled, while another brand\'s stay out', async ({ browser }) => {
  // Production, 2026-10-14, Lenskart: "51 asset(s) ... not listed" beside tabs
  // that all read 0, and no way to reach any of them ("saying 51 but showing 0").
  const context = await browser.newContext();
  const errors = [];
  await wire(context, { api: [] });
  const B = deviceRow('local-bwl', F.BRAMBLE, PAL_B);
  await context.addInitScript((wsId) => {
    const rows = {
      landing_pages_generated: [
        { hero: 'Old Brambleweld page', market: 'UK', paired_with: 'mailer', created_at: '2026-09-01T00:00:00Z', workspace_id: wsId, payload: { brand_identity: 'bi2:0123456789abcdef01234567' } },
        { hero: 'Pre-stamp Brambleweld page', market: 'UK', paired_with: 'mailer', created_at: '2026-08-01T00:00:00Z', payload: {} },
        { hero: 'Quillforth front page', market: 'IN', paired_with: 'mailer', created_at: '2026-09-02T00:00:00Z', workspace_id: 'local-other', payload: { brand_identity: 'bi2:ffffffffffffffffffffffff' } },
      ],
      mailers_generated: [], ads_generated: [],
    };
    const chain = (t) => ({ select: () => ({ order: () => ({ limit: async () => ({ data: rows[t] || [], error: null }) }), eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) });
    window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) }, from: chain }) };
  }, B.id);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await seed(page, [B], B.id);
  await page.goto(HOST + '/assets.html', { waitUntil: 'domcontentloaded' });
  await brandReady(page, 'Brambleweld Larder');
  const note = page.locator('[data-hidden-assets]');
  await expect(note).toContainText('2 assets were made for an earlier version of Brambleweld Larder', { timeout: 20000 });
  await expect(note).toContainText('1 asset belongs to another brand');
  await expect(page.locator('#grid')).toContainText('Show the 2 from earlier versions');
  expect(await page.locator('#grid .asset').count()).toBe(0);
  await page.click('[data-toggle-earlier]');
  await expect(page.locator('#grid .asset')).toHaveCount(2);
  const names = await page.$$eval('#grid .asset', (els) => els.map((e) => e.textContent || '').join(' | '));
  expect(names).toContain('Old Brambleweld page');
  expect(names).toContain('Pre-stamp Brambleweld page');
  expect(names, 'another brand\'s asset was listed under this one').not.toContain('Quillforth front page');
  await expect(page.locator('#grid [data-earlier-version]')).toHaveCount(2);
  await expect(page.locator('[data-tabn="all"]')).toHaveText('2');
  await page.click('[data-toggle-earlier]');
  await expect(page.locator('#grid .asset')).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test('another tab switching the active brand repaints every open page as the new brand, with nothing of the old one cached', async ({ browser }) => {
  const context = await browser.newContext();
  await wire(context, { api: [] });
  const Q = deviceRow('local-qfg', F.QUILL, PAL_Q);
  const B = deviceRow('local-bwl', F.BRAMBLE, PAL_B);
  const tab1 = await context.newPage();
  await seed(tab1, [Q, B], Q.id);
  const tab2 = await context.newPage();
  await tab2.goto(HOST + '/assets.html', { waitUntil: 'domcontentloaded' });
  await brandReady(tab2, 'Quillforth Gazette');
  const qKey = await tab2.evaluate(() => window.LCStore.key('k'));
  await tab2.evaluate(() => { window.__sameDocument = true; });
  await tab1.goto(HOST + '/about.html', { waitUntil: 'domcontentloaded' });
  await brandReady(tab1, 'Quillforth Gazette');
  await tab1.evaluate((id) => window.BrandContext.setActive(id), B.id);
  await brandReady(tab2, 'Brambleweld Larder');
  await tab2.waitForFunction(() => !window.__sameDocument, null, { timeout: 15000 });
  await brandReady(tab2, 'Brambleweld Larder');
  const painted = await tab2.evaluate(() => ({
    primary: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim().toUpperCase(),
    key: window.LCStore.key('k'),
  }));
  expect(painted.primary).toBe('#2E6B4A');
  expect(painted.key).not.toBe(qKey);
  await context.close();
});

for (const mode of ['account', 'device']) {
  test(`"Set up from my website" runs the readers on that site only, in order (${mode} path)`, async ({ browser }) => {
    const context = await browser.newContext();
    const calls = [];
    const SITE = 'https://brambleweld-larder.example';
    // The account path is the localhost preview: every brand op is the SHIPPED
    // router over the fake project; the readers that would reach the network
    // (extract, catalogue import, context pack) answer canned.
    const host = mode === 'account' ? 'http://127.0.0.1:9' : HOST;
    let db = null;
    if (mode === 'account') {
      ENV.save();
      db = world();
      db.table('brand_workspaces').push(Object.assign(F.workspaceRow(F.BRAMBLE, 'ws-bwl'), { owner_id: OWNER, palette: PAL_B, onboarding_step: 1, created_at: db.tick(), updated_at: db.tick() }));
      db.table('brand_user_prefs').push({ user_id: OWNER, active_workspace_id: 'ws-bwl' });
    }
    await wire(context, null, async (u, route, json) => {
      const action = u.searchParams.get('action'), op = u.searchParams.get('op');
      if (mode === 'account' && !action && !u.searchParams.has('health')) return json({ ok: true });
      if (action !== 'brand') return false;
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch (_) { body = {}; }
      if (op === 'presets' || op === 'defaults') return json({ ok: true, presets: [] });
      if (op === 'extract') {
        calls.push('extract:' + body.url);
        return json({ ok: true, start: body.url, pages_visited: 3, stylesheets: [], limits: [], read: { method: 'parsed' },
          fields: { name: { value: 'Brambleweld Larder', source_url: SITE + '/', signal: 'og:site_name', candidates: [{ value: 'Brambleweld Larder', source_url: SITE + '/', signal: 'og:site_name' }] },
            storefront: { detected: true, platform: { id: 'shopify', name: 'Shopify', confidence: 'declared', source_url: SITE + '/' }, cms: null, conflicts: [], note: 'The site declares Shopify.', catalog_route: { note: 'Shopify publishes its own product feed.' } },
            tagline: { value: '', marker: '[DATA REQUIRED BEFORE LAUNCH: tagline, Brambleweld Larder]', candidates: [] },
            logo: { value: '', marker: '[DATA REQUIRED BEFORE LAUNCH: logo URL, Brambleweld Larder]', candidates: [] },
            palette: { proposed: {}, sources: {}, conflicts: [] }, typography: { heading: [], body: [], scale: [] }, claims: { candidates: [] }, social: { candidates: [] }, legal: { candidates: [] } } });
      }
      if (op === 'catalog-import') { calls.push('catalog-import:' + body.url + ':' + body.region); return json({ ok: true, imported: 12, own: 12, complete: true, coverage: { complete: true, sentences: ['Found 12 of the 12 products the site declares.'] } }); }
      if (op === 'catalog-status') return json({ ok: true });
      if (op === 'context-build') { calls.push('context-build'); return json({ ok: true, done: true, pack: { site_url: SITE, stage: 'done' } }); }
      if (op === 'context-pack') return json({ ok: true, pack: { site_url: SITE, stage: 'done' }, current: true });
      if (mode !== 'account') return false;
      if (op === 'save') calls.push('save');
      const r = makeReq({ token: TOKEN, query: Object.fromEntries(u.searchParams), body: route.request().method() === 'POST' ? body : undefined, method: route.request().method() });
      const res = makeRes();
      await core.handle(r, res);
      return json(res.payload, res.code);
    }, host);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    try {
      let target = host + '/onboarding.html?step=1&id=';
      if (mode === 'device') {
        const B = deviceRow('local-bwl', F.BRAMBLE, PAL_B);
        await page.goto(HOST + '/about.html', { waitUntil: 'domcontentloaded' });
        await page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [DEVICE_KEY, { version: 1, active_id: B.id, workspaces: [B] }]);
        target += B.id;
      } else target += 'ws-bwl';
      await page.goto(target, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#xSetup', { timeout: 20000 });
      await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded && window.BrandContext.brand && /bwl/.test(window.BrandContext.brand.id || ''), null, { timeout: 20000 });
      await page.waitForFunction(() => document.querySelector('[data-path="name"]') && document.querySelector('[data-path="name"]').value === 'Brambleweld Larder', null, { timeout: 20000 });
      await page.fill('#xUrl', SITE);
      // ONE run, every step in the wizard's order, shown as it goes, ending on
      // Review (2026-10-11): the step buttons are for viewing and editing.
      const seen = [];
      await page.exposeFunction('__seenStep', (k) => { if (!seen.includes(k)) seen.push(k); });
      await page.evaluate(() => {
        new MutationObserver(() => {
          const r = document.querySelector('[data-setup-log] li[data-state="running"]');
          if (r) window.__seenStep(r.getAttribute('data-setup-step'));
        }).observe(document.getElementById('setupRun'), { childList: true, subtree: true, attributes: true });
      });
      await page.click('#xSetup');
      await page.waitForFunction(() => {
        const run = document.querySelector('[data-setup-run]');
        const review = document.querySelector('[data-setup-log] li[data-setup-step="review"]');
        return run && !run.hasAttribute('aria-busy') && review && review.getAttribute('data-state') !== 'running';
      }, null, { timeout: 30000 });
      await page.waitForFunction(() => /[?&]step=6\b/.test(location.search), null, { timeout: 10000 });
      const steps = await page.$$eval('[data-setup-log] li', (els) => els.map((e) => [e.getAttribute('data-setup-step'), e.getAttribute('data-state'), e.querySelector('.srun-text').textContent]));
      expect(calls[0]).toBe('extract:' + SITE);
      expect(steps[0][2]).toMatch(/Found Brambleweld Larder on brambleweld-larder\.example.*sell on Shopify/);
      // A parsed read proposed no colours or type: the brand's own values stay,
      // and the rows say so (never "applied from the site").
      expect(steps.slice(1, 4).map((s) => s[0] + ':' + s[1])).toEqual(['colour:done', 'type:done', 'voice:done']);
      expect(steps[1][2]).toMatch(/Kept the colours already on this brand/);
      expect(steps.slice(1, 4).map((s) => s[2]).join(' ')).not.toMatch(/Applied|observed from the site/);
      if (mode === 'device') {
        // On this device no server can read the brand: the action says so instead of pretending.
        expect(steps.map((s) => s[0])).toEqual(['brand', 'colour', 'type', 'voice', 'catalog', 'review']);
        expect(steps[4][1]).toBe('skipped');
        expect(calls).toEqual(['extract:' + SITE]);
      } else {
        expect(calls.filter((c) => c !== 'save'), JSON.stringify(steps)).toEqual(['extract:' + SITE, 'catalog-import:' + SITE + ':uk', 'context-build']);
        expect(calls.indexOf('save'), 'the brand was not saved before the import read it').toBeLessThan(calls.indexOf('catalog-import:' + SITE + ':uk'));
        expect(steps.map((s) => s[0] + ':' + s[1]).slice(4)).toEqual(['catalog:done', 'pack:done', steps[6][0] + ':' + steps[6][1]]);
        expect(steps[6][0]).toBe('review');
        expect(steps[4][2]).toMatch(/Brought in 12 products from brambleweld-larder\.example/);
      }
      // Each step was shown working, in order, before the next.
      const order = ['brand', 'colour', 'type', 'voice', 'catalog', 'pack', 'review'];
      const shown = seen.filter((k) => order.includes(k));
      expect(shown, 'steps were not shown running in the wizard\'s order').toEqual(order.filter((k) => shown.includes(k)));
      expect(shown.length, 'the run did not show its steps one by one').toBeGreaterThanOrEqual(mode === 'device' ? 4 : 6);
      // Each finished step offers View and edit, and it opens that step.
      await page.click('[data-setup-edit="2"]');
      await page.waitForFunction(() => /[?&]step=2\b/.test(location.search), null, { timeout: 5000 });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      if (db) { db.restore(); ENV.restore(); }
    }
  });
}
