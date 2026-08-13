// competitor-universe — where the competitor set comes from, and what it refuses.
//
// A competitor name is a factual claim about a real company, so the valuable
// behaviour here is not "it returns a list". It is:
//   * a brand whose record names nobody gets a DATA REQUIRED gap, not names;
//   * the search is described by the brand's OWN industry, never a hardcoded one;
//   * one brand's universe can never appear in another's;
//   * the same company is stored once, keyed by domain.
//
// Everything runs against an in-memory store and a stubbed model, with no
// network at all, because that is exactly the behaviour that must hold when the
// network IS involved. It also proves the point of the change: none of this
// needs a Google credential.
//
// Run: npx playwright test tests/competitor-universe.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const universe = require('../api/_shared/competitor-universe.js');
const core = require('../api/_shared/competitor-core.js');

const TENANT_ZERO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/_default.json'), 'utf8'));
const PUBLISHER = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/presets/economic-times.json'), 'utf8'));

// Fixture domains for the paths that must ACCEPT a candidate.
//
// They deliberately do not use .example or .test: those are reserved names, the
// validator rejects them by design (a model that answers "example.com" has
// invented the company), and that rejection is tested below. These are nonsense
// strings under a real TLD, so they exercise the accept path without this test
// file naming any real company as anybody's competitor.
const FIXTURE_ONE = 'zzq-northwind-press.com';
const FIXTURE_TWO = 'zzq-harbour-media.com';

/**
 * The storage port, in memory. Keyed by workspace exactly as the table's unique
 * index is, so a test that "leaks" one brand's rows into another would have to
 * do it through the code under test rather than through a sloppy fake.
 */
function memoryStore(workspaces) {
  const rows = new Map();          // workspace_id -> row[]
  let seq = 0;
  const listOf = (ws) => (rows.get(String(ws)) || []);
  return {
    kind: 'memory',
    calls: { insert: 0, patch: 0 },
    async list(ws) { return listOf(ws).map((r) => Object.assign({}, r)); },
    async insert(ws, incoming) {
      this.calls.insert++;
      const bucket = rows.get(String(ws)) || [];
      const made = incoming.map((r) => Object.assign({ id: `c${++seq}`, workspace_id: String(ws), is_active: true }, r));
      // The database enforces (workspace_id, dedupe_key); so does this.
      const keys = new Set(bucket.map((r) => universe.dedupeKey(r)));
      const kept = made.filter((r) => !keys.has(universe.dedupeKey(r)));
      rows.set(String(ws), bucket.concat(kept));
      return kept;
    },
    async patch(ws, id, patch) {
      this.calls.patch++;
      const bucket = rows.get(String(ws)) || [];
      const hit = bucket.find((r) => r.id === id);
      if (hit) Object.assign(hit, patch);
      return hit || null;
    },
    async workspace(ws) { return (workspaces || {})[String(ws)] || null; },
    async activeWorkspaces() { return Object.values(workspaces || {}).filter((w) => w.status === 'active'); },
    async refreshState() { return this.__refresh ? Object.values(this.__refresh) : []; },
    async setRefresh(ws, row) {
      this.__refresh = this.__refresh || {};
      this.__refresh[String(ws)] = Object.assign({ workspace_id: String(ws) }, row);
      return row;
    },
  };
}

/** A model that answers with whatever the test hands it. */
function stubLlm(text, meta) {
  return async () => Object.assign({ text: typeof text === 'string' ? text : JSON.stringify(text) }, meta || { provider: 'stub', model: 'stub-1' });
}

const wsRow = (id, brand, status) => Object.assign({}, brand, { id, status: status || 'active', brand_data: {} });

// ── The refusal that matters most ───────────────────────────────────────────

test('a brand whose record names no competitor gets a gap, not invented names', async () => {
  const derived = universe.deriveFromBrandRecord(PUBLISHER);

  expect(derived.candidates).toHaveLength(0);
  expect(derived.gaps.join(' ')).toContain('[DATA REQUIRED BEFORE LAUNCH: competitor set');
  expect(derived.gaps.join(' ')).toContain('The Economic Times');
});

test('seeding a brand with nothing in its record stores nothing at all', async () => {
  const store = memoryStore({ wsPub: wsRow('wsPub', PUBLISHER) });
  const out = await universe.seedForWorkspace(store, 'wsPub');

  expect(out.ok).toBe(true);
  expect(out.added).toBe(0);
  expect(out.status_line).toContain('NOT LAUNCH READY');
  expect(out.gaps.join(' ')).toContain('DATA REQUIRED BEFORE LAUNCH');
  expect(await store.list('wsPub')).toHaveLength(0);
});

test('a discovery run that finds nothing real reports the gap and writes nothing', async () => {
  const store = memoryStore({ wsPub: wsRow('wsPub', PUBLISHER) });

  // Everything the model returned is unusable: a placeholder domain, a name
  // with no site, and the brand's own homepage.
  const out = await universe.refreshWorkspace(store, 'wsPub', {
    llm: stubLlm({ brands: [
      { name: 'Acme Media Group', websiteUrl: 'https://example.com' },
      { name: 'Some Rival' },
      { name: 'The Economic Times', websiteUrl: 'https://economictimes.indiatimes.com' },
    ] }),
  });

  expect(out.added).toBe(0);
  expect(out.rejected).toBe(3);
  expect(out.gaps.join(' ')).toContain('[DATA REQUIRED BEFORE LAUNCH: competitor set');
  expect(await store.list('wsPub')).toHaveLength(0);
});

test('a discovery run the model cannot answer is a gap, never a fallback list', async () => {
  const store = memoryStore({ wsPub: wsRow('wsPub', PUBLISHER) });
  const out = await universe.refreshWorkspace(store, 'wsPub', {
    llm: async () => { throw new Error('all providers exhausted'); },
  });

  expect(out.added).toBe(0);
  expect(out.gaps.join(' ')).toContain('DATA REQUIRED BEFORE LAUNCH');
  expect(out.note).toContain('Nothing was invented');
  expect(await store.list('wsPub')).toHaveLength(0);
});

test('unparseable model output is a gap, not a partially-read list', () => {
  const parsed = universe.parseDiscovery('sorry, I cannot help with that', PUBLISHER, {});
  expect(parsed.candidates).toHaveLength(0);
  expect(parsed.error).toBe('unparseable_discovery_response');
  expect(parsed.gap).toContain('DATA REQUIRED BEFORE LAUNCH');
});

// ── Seeding uses the brand's OWN record ─────────────────────────────────────

test('seeding reads the brand\'s own market study, tier by tier', async () => {
  const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO) });
  const out = await universe.seedForWorkspace(store, 'wsZero');

  expect(out.added).toBeGreaterThan(10);
  const rows = await store.list('wsZero');
  const names = rows.map((r) => r.name);

  // Named in this brand's own Tier 2, with the URL its record carries.
  expect(names).toContain('Moreiarty');
  expect(rows.find((r) => r.name === 'Moreiarty').domain).toBe('moreiarty.in');
  // Every stored row can say where it came from.
  for (const r of rows) {
    expect(r.source).toBe('brand_record');
    expect(String(r.evidence)).toMatch(/market study|brand record/i);
  }
});

test('a tier the brand says does NOT compete with it is never seeded', async () => {
  const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO) });
  const out = await universe.seedForWorkspace(store, 'wsZero');
  const names = (await store.list('wsZero')).map((r) => r.name.toLowerCase()).join(' ');

  // Tenant zero's Tier 1 note says the athletic majors supply the blank canvas
  // and "are not competitors for the customisation job". Reading names out of
  // it would put its own suppliers in its rival list.
  expect(names).not.toContain('adidas');
  expect(names).not.toContain('puma');
  expect(out.notes.join(' ')).toContain('does not compete');
});

test('a competitor the record names without a website is stored WITH its gap', async () => {
  const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO) });
  await universe.seedForWorkspace(store, 'wsZero');
  const row = (await store.list('wsZero')).find((r) => r.name === 'Sneakboo');

  expect(row).toBeTruthy();
  expect(row.domain).toBe('');
  expect(row.verification).toBe('unverified');
  expect(row.data_gaps.join(' ')).toContain('[DATA REQUIRED BEFORE LAUNCH: competitor website, Sneakboo');
});

test('prose that is not a company name is refused rather than tidied into one', () => {
  const { names, rejected } = universe.namesFromNote(
    'Direct competitors: Northwind Press, Harbour Media, and the official programmes Something By You.'
  );
  expect(names).toContain('Northwind Press');
  expect(names).toContain('Harbour Media');
  // "the official programmes Something By You" is a sentence fragment, not a
  // company. Storing it would invent one.
  expect(names.join(' ')).not.toContain('official programmes');
  expect(rejected.join(' ')).toContain('official programmes');
});

test('the search is described by the brand\'s own industry, not a hardcoded one', () => {
  const prompt = universe.discoveryPrompt(PUBLISHER, { existingDomains: [], limit: 10 });

  expect(prompt.ok).toBe(true);
  expect(prompt.user).toContain('Business news / digital publishing');
  expect(prompt.user).toContain('The Economic Times');
  // The sheet-era discovery hardcoded a sneaker category list and sneaker
  // exemplars, so every brand on the platform would have been handed sneaker
  // competitors.
  expect(prompt.user.toLowerCase()).not.toMatch(/sneaker|streetwear|knickgasm|custom sneakers/);
  // And it must invite an empty answer, so "find 20" cannot become "invent 20".
  expect(prompt.user).toContain('{"brands":[]}');
});

test('a brand that has not said what it does is not sent to discovery at all', () => {
  const brief = universe.discoveryBrief({ name: 'Blank Co', regions: [{ code: 'US' }] });
  expect(brief.ok).toBe(false);
  expect(brief.gap).toContain('[DATA REQUIRED BEFORE LAUNCH: brand industry or offerings');
});

// ── Isolation: one brand's universe is never another's ──────────────────────

test('one brand\'s competitors never appear in another brand\'s universe', async () => {
  const store = memoryStore({
    wsZero: wsRow('wsZero', TENANT_ZERO),
    wsPub: wsRow('wsPub', PUBLISHER),
  });

  await universe.seedForWorkspace(store, 'wsZero');
  await universe.seedForWorkspace(store, 'wsPub');

  const zero = await universe.listUniverse(store, 'wsZero');
  const pub = await universe.listUniverse(store, 'wsPub');

  expect(zero.total).toBeGreaterThan(10);
  expect(pub.total).toBe(0);
  const pubText = JSON.stringify(pub);
  for (const leak of ['Moreiarty', 'VegNonVeg', 'Kickstradomis', 'Superkicks', 'sneaker']) {
    expect(pubText.toLowerCase()).not.toContain(leak.toLowerCase());
  }
});

test('a workspace whose brand record cannot be read is refused, not given tenant zero\'s', async () => {
  // The store knows about tenant zero but NOT about the workspace being seeded.
  // brand-runtime.resolve() would fall back to the default brand here, which is
  // right for a generator and catastrophic here: it would seed one brand's
  // market study into a stranger's workspace.
  const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO) });
  const out = await universe.seedForWorkspace(store, 'wsUnknown');

  expect(out.ok).toBe(false);
  expect(out.error).toBe('brand_record_unavailable');
  expect(out.added).toBe(0);
  expect(await store.list('wsUnknown')).toHaveLength(0);
});

test('a workspace row that answers with a different id is refused', async () => {
  // A store that returns the wrong row (a stale cache, a mis-scoped query) must
  // not be trusted just because it returned something.
  const store = memoryStore({});
  store.workspace = async () => wsRow('wsZero', TENANT_ZERO);
  const brand = await universe.brandForWorkspace(store, 'wsSomeoneElse');
  expect(brand).toBe(null);
});

test('discovery for one brand excludes that brand\'s own hosts only', () => {
  const zeroPrompt = universe.discoveryPrompt(TENANT_ZERO, { existingDomains: [] });
  const pubPrompt = universe.discoveryPrompt(PUBLISHER, { existingDomains: [] });

  expect(zeroPrompt.exclude.join(' ')).toContain('knickgasm.com');
  expect(pubPrompt.exclude.join(' ')).not.toContain('knickgasm.com');
  expect(pubPrompt.exclude.join(' ')).toContain('economictimes.indiatimes.com');
});

// ── De-duplication by domain ────────────────────────────────────────────────

test('the same company written four ways is one row', () => {
  const existing = [{ id: 'a', name: 'Northwind Press', domain: 'northwind.example', website: 'https://northwind.example' }];
  const { fresh, skipped } = universe.dedupe(existing, [
    { name: 'Northwind Press', website: 'https://www.northwind.example' },
    { name: 'northwind press', website: 'http://northwind.example/' },
    { name: 'NORTHWIND', website: 'https://northwind.example/about?utm=x' },
    { name: 'Harbour Media', website: 'https://harbour.example' },
  ]);

  expect(fresh.map((c) => c.name)).toEqual(['Harbour Media']);
  expect(skipped).toHaveLength(3);
  expect(skipped.every((s) => s.reason === 'duplicate')).toBe(true);
});

test('re-seeding the same brand adds nothing the second time', async () => {
  const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO) });
  const first = await universe.seedForWorkspace(store, 'wsZero');
  // Re-derived in full, not short-circuited: the record can grow, and the only
  // thing that stops a duplicate is the dedupe.
  const again = await universe.seedForWorkspace(store, 'wsZero');

  expect(first.added).toBeGreaterThan(0);
  expect(again.added).toBe(0);
  expect(again.skipped).toBe(first.added);
  expect((await store.list('wsZero')).length).toBe(first.added);
});

test('a competitor added to the record later is picked up on the next seed', async () => {
  const brand = JSON.parse(JSON.stringify(TENANT_ZERO));
  const store = memoryStore({ wsZero: wsRow('wsZero', brand) });
  const first = await universe.seedForWorkspace(store, 'wsZero');

  // The operator adds one to their own brand record.
  const grown = Object.assign({}, brand, { competitors: [{ name: 'Northwind Kicks', website: `https://${FIXTURE_TWO}` }] });
  const second = await universe.seedForWorkspace(store, 'wsZero', { brand: grown });

  expect(second.added).toBe(1);
  expect((await store.list('wsZero')).length).toBe(first.added + 1);
});

test('the activation hook leaves an already-populated brand untouched', async () => {
  const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO) });
  await universe.seedForWorkspace(store, 'wsZero');
  const inserts = store.calls.insert;

  const again = await universe.seedForWorkspace(store, 'wsZero', { onlyIfEmpty: true });
  expect(again.added).toBe(0);
  expect(store.calls.insert).toBe(inserts);
});

test('a name-only row is upgraded when its domain turns up, not duplicated', async () => {
  const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO) });
  await universe.seedForWorkspace(store, 'wsZero');
  const before = (await store.list('wsZero')).length;

  const out = await universe.addCompetitors(store, 'wsZero', [{
    name: 'Sneakboo', website: 'https://sneakboo.example', domain: 'sneakboo.example',
    source: 'discovery', verification: 'unverified', data_gaps: [],
  }]);

  expect(out.added).toBe(0);
  expect(out.upgraded).toBe(1);
  const rows = await store.list('wsZero');
  expect(rows.length).toBe(before);
  expect(rows.filter((r) => r.name === 'Sneakboo')).toHaveLength(1);
  expect(rows.find((r) => r.name === 'Sneakboo').domain).toBe('sneakboo.example');
});

test('discovery de-duplicates against what the workspace already holds', async () => {
  const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO) });
  await universe.seedForWorkspace(store, 'wsZero');
  const before = (await store.list('wsZero')).length;

  const out = await universe.refreshWorkspace(store, 'wsZero', {
    llm: stubLlm({ brands: [
      { name: 'Moreiarty', websiteUrl: 'https://www.moreiarty.in' },     // already held
      { name: 'Kickstradomis', websiteUrl: 'https://kickstradomis.com' }, // already held
      { name: 'Northwind Kicks', websiteUrl: `https://${FIXTURE_ONE}` },
    ] }),
  });

  expect(out.added).toBe(1);
  expect((await store.list('wsZero')).length).toBe(before + 1);
});

test('normalizeDomain strips everything that is not the host', () => {
  const n = universe.normalizeDomain;
  expect(n('https://www.Example.co.uk/path?a=b#c')).toBe('example.co.uk');
  expect(n('HTTP://EXAMPLE.COM')).toBe('example.com');
  expect(n('example.com:443/x')).toBe('example.com');
  expect(n('')).toBe('');
});

// ── What discovery is NOT allowed to contribute ─────────────────────────────

test('a positioning line is never taken from the model', () => {
  const parsed = universe.parseDiscovery(JSON.stringify({ brands: [{
    name: 'Northwind Press', websiteUrl: `https://${FIXTURE_ONE}`,
    positioning: 'Premium', category: 'Luxury news', country: 'Atlantis',
    rating: 4.9, price: '$99',
  }] }), PUBLISHER, { provider: 'stub' });

  expect(parsed.candidates).toHaveLength(1);
  const c = parsed.candidates[0];
  // Positioning, ratings and prices are claims about another company that
  // nobody has checked. Only the name, the homepage, and OUR reason for
  // searching survive.
  expect(c.positioning).toBe(null);
  expect(c.category).toBe(PUBLISHER.industry);
  expect(c.verification).toBe('unverified');
  expect(JSON.stringify(c)).not.toContain('4.9');
  expect(JSON.stringify(c)).not.toContain('Atlantis');
  expect(c.data_gaps.join(' ')).toContain('competitor website verification');
});

test('a stored row always says where it came from', async () => {
  const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO) });
  await universe.refreshWorkspace(store, 'wsZero', {
    llm: stubLlm({ brands: [{ name: 'Northwind Kicks', websiteUrl: `https://${FIXTURE_ONE}` }] }, { provider: 'groq', model: 'llama' }),
  });
  const row = (await store.list('wsZero')).find((r) => r.name === 'Northwind Kicks');
  expect(row.source).toBe('discovery');
  expect(row.evidence).toContain('groq/llama');
  expect(row.evidence).toContain('has not been checked');
});

// ── The scheduled sweep ─────────────────────────────────────────────────────

test('the sweep covers brands in rotation and stays inside its budget', async () => {
  const store = memoryStore({
    wsA: wsRow('wsA', TENANT_ZERO),
    wsB: wsRow('wsB', PUBLISHER),
    wsC: wsRow('wsC', Object.assign({}, PUBLISHER, { name: 'Third Brand' })),
    wsDraft: wsRow('wsDraft', PUBLISHER, 'draft'),
  });
  const seen = [];
  const llm = async (opts) => { seen.push(opts.userMessage); return { text: '{"brands":[]}', provider: 'stub' }; };

  const first = await universe.refreshDueWorkspaces({ store, llm, maxWorkspaces: 2 });
  expect(first.due).toBe(2);
  expect(first.refreshed).toBe(2);

  // A brand refreshed an hour ago is not due again; the untouched one is.
  const second = await universe.refreshDueWorkspaces({ store, llm, maxWorkspaces: 2, now: Date.now() + 3600e3 });
  expect(second.refreshed).toBe(1);

  // A draft workspace is never swept: it has no live brand to research for.
  expect(Object.keys(store.__refresh || {})).not.toContain('wsDraft');
});

test('one workspace failing does not stop the sweep', async () => {
  const store = memoryStore({ wsA: wsRow('wsA', TENANT_ZERO), wsB: wsRow('wsB', PUBLISHER) });
  let n = 0;
  const llm = async () => { n++; if (n === 1) throw new Error('provider down'); return { text: '{"brands":[]}' }; };

  const out = await universe.refreshDueWorkspaces({ store, llm, maxWorkspaces: 2 });
  expect(out.refreshed).toBe(2);
});

// ── No Google credential is involved anywhere ───────────────────────────────

test('the universe needs no Google credential, and says so when asked to export', async () => {
  const saved = {};
  for (const k of ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GCP_WORKLOAD_IDENTITY_PROVIDER', 'GCP_SERVICE_ACCOUNT_EMAIL', 'VERCEL_OIDC_TOKEN']) {
    saved[k] = process.env[k]; delete process.env[k];
  }
  try {
    // This is the exact state production is in, and the state that produced
    // "Error: Google auth not configured" on a marketing dashboard.
    expect(core.sheetsConfigured()).toBe(false);

    const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO) });
    const out = await universe.seedForWorkspace(store, 'wsZero');
    expect(out.added).toBeGreaterThan(10);

    const exported = await universe.exportToSheet(await store.list('wsZero'));
    expect(exported.ok).toBe(true);
    expect(exported.configured).toBe(false);
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

// ── Subscription write-back stays inside the workspace ──────────────────────

test('a subscription outcome is recorded against the right brand\'s row only', async () => {
  const store = memoryStore({ wsZero: wsRow('wsZero', TENANT_ZERO), wsPub: wsRow('wsPub', PUBLISHER) });
  await universe.seedForWorkspace(store, 'wsZero');

  const ok = await universe.markSubscribed(store, 'wsZero', { domain: 'https://www.moreiarty.in', status: 'Subscribed' });
  expect(ok.ok).toBe(true);
  expect((await store.list('wsZero')).find((r) => r.domain === 'moreiarty.in').subscription_status).toBe('Subscribed');

  // The same domain, asked for from a workspace that does not track it.
  const miss = await universe.markSubscribed(store, 'wsPub', { domain: 'moreiarty.in' });
  expect(miss.ok).toBe(false);
  expect(miss.error).toContain('not found');
});
