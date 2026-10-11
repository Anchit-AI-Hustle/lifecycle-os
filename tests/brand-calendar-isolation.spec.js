const { test, expect } = require('@playwright/test');
const plan = require('../api/_shared/smart-brain-plan');
const scope = require('../api/_shared/request-scope');
const { smartConfig } = require('../lib/smart-brain/services');
const zero = require('../api/_shared/brand-runtime').defaultBrand();

const deli = {
  id: 'device:deli', carried: true, storage: 'device', name: 'Deli Chic', slug: zero.slug,
  website: 'https://deli.example.com', industry: 'Food',
  palette: { primary: '#8B1E1E', accent: '#B45309', surface: '#FFFDF8', ink: '#1A1A1A' },
  regions: [{ code: 'IN', currency: 'INR', home: true }],
};
// Rows a plan made for THIS record carry its fingerprint (2026-10-11); the
// tests below that are about products, not records, stamp them as such.
const stampFor = (brand) => plan.__test_brandIdentity(brand);
let stampBrand = deli;
const old = (name, support = []) => ({ id: name, status: 'tentative', payload: { heroProduct: { title: name }, supportingProducts: support.map(title => ({ title })), __brand_identity: stampFor(stampBrand) } });
async function read(brand, rows) {
  const config = smartConfig({ calendarDays: 7, workspace_id: null });
  const db = { connected: true, select: async () => rows };
  return scope.run({ headers: {}, __brand: brand }, () => plan.getPlan({ _ctxFallback: { config, db } }));
}

test('a renamed sneaker preset with no catalog plans without products, even when old sneaker campaigns are stored', async () => {
  const result = await read(deli, [old('Bayern Munich F.C. x Nike Air Force 1')]);
  expect(result.entries.every(e => !e.heroProduct || !e.heroProduct.title || /DATA REQUIRED/.test(e.heroProduct.title))).toBe(true);
  expect(result.stored).toBe(false);
  expect(result.note).toContain('DATA REQUIRED');
  expect(JSON.stringify(result)).not.toMatch(/Nike|Af1|pasture-raised|two hours/i);
});

test('an old preset slug or partially matching name never substitutes for a catalog', async () => {
  for (const brand of [deli, { ...deli, name: 'Food For Thought Deli Chic', slug: 'knickgasm-special' }]) {
    const result = await read(brand, []);
    expect(result.entries.every(e => !e.heroProduct || !e.heroProduct.title || /DATA REQUIRED/.test(e.heroProduct.title))).toBe(true);
  }
});

test('each stored campaign must use only this brand’s own heroes and supporting products', async () => {
  const brand = { ...deli, offerings: [{ kind: 'product', name: 'Fixture Fresh Chicken' }] };
  stampBrand = brand;
  const result = await read(brand, [old('Fixture Fresh Chicken'), old('Nike Air Force 1'), old('Fixture Fresh Chicken', ['Nike Air Force 1'])]);
  expect(result.stored).toBe(true);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].heroProduct.title).toBe('Fixture Fresh Chicken');
  expect(JSON.stringify(result)).not.toContain('Nike');
});


test('a saved product-free strategy stays saved for its own brand', async () => {
  const fresh = await read(deli, []);
  const rows = fresh.entries.map((entry, i) => ({ id: 'saved-' + i, status: 'approved', payload: entry }));
  const result = await read(deli, rows);
  expect(result.stored).toBe(true);
  expect(result.entries).toHaveLength(rows.length);
  expect(result.entries.every(entry => entry.status === 'approved')).toBe(true);
});

test('an uploaded food catalog supplies the plan and its categories, without a preset fallback', async () => {
  const ws = require('../api/_shared/workspace-scope');
  const catalogs = require('../api/_shared/brand-catalog-server');
  const original = { brand: ws.brandForWorkspace, resolve: catalogs.resolve, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  try {
    process.env.SUPABASE_URL = 'https://supabase.example.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
    ws.brandForWorkspace = async () => ({ ...deli, id: 'ws-deli', carried: false, storage: 'server' });
    catalogs.resolve = async ({ brand, workspaceId }) => {
      expect(workspaceId).toBe('ws-deli');
      expect(brand.owns_shipped).toBe(false);
      return { source: 'brand', products: [{ n: 'Fixture Fresh Chicken', h: 'fixture-chicken', type: 'Fresh Cuts', price: null, i: '' }] };
    };
    const config = smartConfig({ calendarDays: 7, workspace_id: 'ws-deli' });
    const result = await plan.getPlan({ _ctxFallback: { config, db: { connected: true, select: async () => [] } } });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every(entry => entry.heroProduct.title === 'Fixture Fresh Chicken')).toBe(true);
    expect(result.entries.every(entry => entry.heroProduct.category === 'Fresh Cuts' && entry.cta === 'Order Fresh Cuts')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Nike|pasture-raised|two hours/i);
  } finally {
    ws.brandForWorkspace = original.brand;
    catalogs.resolve = original.resolve;
    for (const [name, value] of [['SUPABASE_URL', original.url], ['SUPABASE_SERVICE_ROLE_KEY', original.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});


// The live record, 2026-10-11: one workspace renamed Mamaearth -> DelhiChic,
// whose stored slots were made for the earlier record (and, before that, for
// tenant zero's sneakers). A slot made for another record is never shown, even
// when its products happen to match the brand's own.
test('a slot stored for an earlier version of the record is not shown, and the plan is made afresh', async () => {
  const brand = { ...deli, offerings: [{ kind: 'product', name: 'Fixture Fresh Chicken' }] };
  const earlier = { ...brand, name: 'Mamaearth', website: 'https://mamaearth.example.in' };
  const mine = { id: 'mine', status: 'tentative', payload: { heroProduct: { title: 'Fixture Fresh Chicken' }, __brand_identity: stampFor(brand) } };
  const theirs = { id: 'theirs', status: 'approved', payload: { heroProduct: { title: 'Fixture Fresh Chicken' }, brand: { name: 'Mamaearth' }, __brand_identity: stampFor(earlier) } };
  const unstamped = { id: 'unstamped', status: 'tentative', payload: { heroProduct: { title: 'Fixture Fresh Chicken' } } };
  const result = await read(brand, [mine, theirs, unstamped]);
  expect(result.stored).toBe(true);
  expect(result.entries.map(e => e.id)).toEqual(['mine']);
  const onlyOld = await read(brand, [theirs, unstamped]);
  expect(onlyOld.stored).toBe(false);
  expect(JSON.stringify(onlyOld)).not.toContain('Mamaearth');
  expect(onlyOld.entries.length).toBeGreaterThan(0);
  expect(onlyOld.entries.every(e => e.__brand_identity === stampFor(brand))).toBe(true);
});

test('the fingerprint moves with the name, the website, the legal sender, the catalogue source, the palette, the type, the voice, the claims and the markets', () => {
  const base = {
    ...deli, legal_entity: 'Deli Chic Foods Pvt Ltd', catalog_source: { url: 'https://deli.example.com' },
    typography: { heading: { family: 'Fraunces' }, body: { family: 'Mulish' } },
    voice: { tone: 'warm', banned: ['guilt-free'] }, claims: ['Made fresh daily in Pune'],
  };
  const a = stampFor(base);
  expect(a).toMatch(/^bi2:[0-9a-f]{24}$/);
  expect(stampFor({ ...base })).toBe(a);
  // Key order does not move it; a value does.
  expect(stampFor({ ...base, palette: { ink: base.palette.ink, surface: base.palette.surface, accent: base.palette.accent, primary: base.palette.primary } })).toBe(a);
  for (const changed of [
    { name: 'Mamaearth' }, { website: 'https://www.nike.in' }, { legal_entity: 'Honasa Consumer Ltd' }, { catalog_source: { url: 'https://www.nike.in' } },
    { palette: { ...base.palette, primary: '#D0473E' } }, { palette: { ...base.palette, accent: '#6A33D8' } },
    { typography: { ...base.typography, heading: { family: 'Montserrat' } } }, { typography: { ...base.typography, body: { family: 'Instrument Sans' } } },
    { voice: { ...base.voice, tone: 'bold, energetic' } }, { voice: { ...base.voice, banned: ['guilt-free', 'superfood'] } },
    { claims: ['India\'s largest sneaker customisers'] }, { approved_claims: [{ text: 'Clinically proven' }] },
    { regions: [{ code: 'UK', currency: 'GBP', home: true }] }, { regions: [{ code: 'IN', currency: 'USD', home: true }] },
  ]) {
    expect(stampFor({ ...base, ...changed }), JSON.stringify(changed)).not.toBe(a);
  }
});

test('with no identity for the brand in scope, a stored or stamped slot is never replayed unchecked', () => {
  const other = plan.__test_slotForOtherRecord;
  const row = { id: 'r1', payload: { __brand_identity: stampFor(deli) } };
  expect(other({ id: 'r1' }, row, null), 'a stored row with no current identity').toBe(true);
  expect(other({ id: 'x', __brand_identity: stampFor(deli) }, null, null), 'a stamped inline slot with no current identity').toBe(true);
  expect(other({ id: 'x' }, null, null), 'an unstamped slot built in this request').toBe(false);
  expect(other({ id: 'r1' }, row, stampFor(deli)), 'the same record').toBe(false);
});

test('a stored slot is built with the CURRENT record, never the brand it was planned under', async () => {
  const current = { ...deli, name: 'Deli Chic' };
  const entry = { id: 's1', brand: { name: 'Mamaearth', legal_entity: 'Honasa Consumer Ltd, Gurgaon' } };
  const config = smartConfig({ calendarDays: 7, workspace_id: null });
  await scope.run({ headers: {}, __brand: current }, () => plan.__test_stampBrand(entry, config));
  expect(entry.brand.name).toBe('Deli Chic');
  expect(JSON.stringify(entry)).not.toContain('Mamaearth');
});
