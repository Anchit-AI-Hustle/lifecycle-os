// Brand data isolation — every feature shows the ACTIVE brand's own data, or
// an honest empty state. Never another brand's, never tenant zero's, never a
// deployment-level dataset dressed up as the brand's.
//
// WHAT THIS PROTECTS. A brand called SNITCH onboarded, opened Data Analysis and
// read another company's tea, coffee and supplement campaigns with real dollar
// figures. That specific file is gone, but the SHAPE of the bug is what recurs:
// a service-role read with no workspace filter, a write with no workspace
// stamp, a bundled dataset used as a fallback, or a prompt with another brand's
// industry baked into it. Every one of those is silent - the page renders, the
// numbers look plausible, and nothing fails.
//
// So these tests drive the REAL modules with a fake PostgREST in front of them
// and assert on the URLs and bodies that actually go over the wire. A renamed
// field or a dropped filter fails here, not in front of a customer.
//
// Run: npx playwright test tests/brand-data-scope.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const wsScope = require('../api/_shared/workspace-scope.js');

// ── 1. SCOPED_TABLES must match the migrations ──────────────────────────────
//
// The list is the whole mechanism: a table with workspace_id that is missing
// from it is read unfiltered and written NULL by every service-role path. It
// was hand-maintained in two places and had already drifted by ~20 tables. This
// re-derives the truth from the migration files themselves.

function tablesGivenWorkspaceId() {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const found = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');

    // Form A: a `foreach t in array array[ 'a', 'b', … ] loop` that runs
    // `alter table … add column … workspace_id` over the list.
    if (/add column if not exists workspace_id/i.test(sql)) {
      for (const m of sql.matchAll(/foreach\s+\w+\s+in\s+array\s+array\[([\s\S]*?)\]\s*loop/gi)) {
        for (const q of m[1].matchAll(/'([a-z0-9_]+)'/gi)) found.add(q[1]);
      }
      // Form B: a direct `alter table public.X add column … workspace_id`.
      for (const m of sql.matchAll(/alter\s+table\s+public\.([a-z0-9_]+)\s+add\s+column\s+if\s+not\s+exists\s+workspace_id/gi)) {
        found.add(m[1]);
      }
    }
    // Form C: the column is declared in the CREATE TABLE itself.
    for (const m of sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi)) {
      if (/^\s*workspace_id\s/im.test(m[2])) found.add(m[1]);
    }
  }
  return found;
}

// Tables that carry workspace_id but are deliberately NOT routed through the
// generic scoping helpers, because a dedicated module owns them and passes the
// workspace explicitly on every call. Listing them here is the honest way to
// exempt them: the exemption is visible and has a reason attached.
const OWNED_ELSEWHERE = new Set([
  'workspace_connections',            // workspace-connections-core, explicit ws on every call
  'workspace_connection_secrets',     // ditto; REVOKEd from anon/authenticated entirely
  'workspace_ai_routing',
  'payment_gateway_connections',      // payments-core, explicit ws
  'payment_oauth_states',
  'brand_competitor_refresh',         // competitor-universe, explicit ws
  'credit_wallets', 'credit_ledger',  // credits-core, wallet resolved per (user, workspace)
  'credit_orders', 'credit_prices',
  'telesuite_items', 'telesuite_runs', // telesuite-core, context() resolves + checks role
  'brand_catalog', 'brand_catalog_products', 'brand_members',
  'brand_user_prefs', 'brand_workspace_members',
  'workspace_members',                // membership of the legacy text workspace
]);

test('SCOPED_TABLES covers every table the migrations give a workspace_id', () => {
  const declared = tablesGivenWorkspaceId();
  expect(declared.size).toBeGreaterThan(20);   // the derivation itself must work

  const missing = [...declared]
    .filter((t) => !wsScope.SCOPED_TABLES.has(t) && !OWNED_ELSEWHERE.has(t))
    .sort();

  expect(missing, `these tables carry workspace_id but are not in SCOPED_TABLES, so every service-role read of them crosses brands and every write lands NULL: ${missing.join(', ')}`).toEqual([]);
});

test('the smart-brain adapter uses the same list, not a copy of it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/smart-brain/services.js'), 'utf8');
  // A second hand-maintained literal is how the two drifted apart the first
  // time. It must import the one list.
  expect(src).toMatch(/WORKSPACE_SCOPED\s*=\s*require\([^)]*workspace-scope[^)]*\)\.SCOPED_TABLES/);
  const services = require('../lib/smart-brain/services.js');
  expect(services.SmartBrainDbAdapter.scoped('ci_ads')).toBe(true);
  expect(services.SmartBrainDbAdapter.scoped('kb_top_emails')).toBe(true);
  expect(services.SmartBrainDbAdapter.scoped('webengage_events')).toBe(true);
});

// ── 2. The generic Supabase client scopes reads and writes ──────────────────
//
// supa.js holds the service-role key and is the client behind the CI
// collectors, the Klaviyo mirror, PageDeck and the dashboards - ~40 call sites,
// none of which take a request to scope themselves with. The scoping is applied
// in the client so it cannot be forgotten at a call site.

function withFakeSupabase(handler, fn) {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const out = handler(String(url), opts);
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify(out === undefined ? [] : out),
      json: async () => (out === undefined ? [] : out),
    };
  };
  const restore = () => { global.fetch = realFetch; };
  return Promise.resolve(fn(calls)).finally(restore);
}

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';

function supaWithEnv() {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  delete require.cache[require.resolve('../api/_shared/supa.js')];
  return require('../api/_shared/supa.js');
}

/** Run `fn` as if serving a request whose active workspace is `ws`. */
function asWorkspace(ws, fn) {
  const scope = require('../api/_shared/request-scope.js');
  return scope.run({ __workspaceId: ws, headers: {}, query: {} }, fn);
}

test('supa.select filters a scoped table by the caller workspace', async () => {
  const supa = supaWithEnv();
  wsScope.invalidate();
  await withFakeSupabase(() => [], async (calls) => {
    await asWorkspace(WS_A, () => supa.select('ci_ads', { order: 'last_seen.desc', limit: 5 }));
    const read = calls.find((c) => c.url.includes('/ci_ads'));
    expect(read, 'ci_ads was never read').toBeTruthy();
    expect(read.url, 'a competitive-intelligence read that is not filtered by workspace returns every brand\'s captured ads').toContain(`workspace_id=eq.${WS_A}`);
  });
});

test('supa.select returns nothing, not everything, when no workspace resolves', async () => {
  const supa = supaWithEnv();
  wsScope.invalidate();
  // brand_workspaces is empty, so not even the oldest-workspace fallback can
  // attribute this read. Every other table would happily return rows.
  const handler = (url) => (url.includes('brand_workspaces') ? [] : [{ id: 'row-from-another-brand' }]);
  await withFakeSupabase(handler, async (calls) => {
    const rows = await asWorkspace(null, () => supa.select('ci_emails', { limit: 5 }));
    expect(rows).toEqual([]);
    expect(calls.some((c) => c.url.includes('/ci_emails')), 'an unscoped read must not be issued at all').toBe(false);
  });
});

test('an unscoped table is read exactly as before', async () => {
  const supa = supaWithEnv();
  wsScope.invalidate();
  await withFakeSupabase(() => [], async (calls) => {
    await asWorkspace(WS_A, () => supa.select('connector_sync_runs', { limit: 5 }));
    const read = calls.find((c) => c.url.includes('/connector_sync_runs'));
    expect(read.url).not.toContain('workspace_id');
  });
});

test('supa.insert stamps the workspace onto a scoped write', async () => {
  const supa = supaWithEnv();
  wsScope.invalidate();
  await withFakeSupabase(() => [{ id: 1 }], async (calls) => {
    await asWorkspace(WS_B, () => supa.insert('ci_ads', [{ headline: 'x' }]));
    const write = calls.find((c) => c.method === 'POST');
    expect(write.body[0].workspace_id, 'a row written without a workspace is accepted by the database and then readable by nobody').toBe(WS_B);
  });
});

test('supa.update cannot patch across brands', async () => {
  const supa = supaWithEnv();
  wsScope.invalidate();
  await withFakeSupabase(() => [], async (calls) => {
    await asWorkspace(WS_A, () => supa.update('ci_ads', { active: false }, { id: 'eq.999' }));
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch.url, 'the id of another brand\'s row is all an unscoped PATCH needs').toContain(`workspace_id=eq.${WS_A}`);
  });
});

// ── 3. The bundled Shopify export belongs to exactly one workspace ──────────
//
// data/analytics/market-data.json is tenant zero's store. The assistant offered
// it to the model as "REAL sales performance from our Shopify order exports",
// so any brand asking for its best seller was answered with another company's
// catalogue, stated as measured fact.

test('market analytics refuses to report the bundled export to another brand', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  delete require.cache[require.resolve('../api/_shared/market-analytics.js')];
  delete require.cache[require.resolve('../api/_shared/supa.js')];
  wsScope.invalidate();
  const market = require('../api/_shared/market-analytics.js');

  // The oldest workspace (tenant zero) is WS_A; the caller is WS_B.
  await withFakeSupabase((url) => (url.includes('brand_workspaces') ? [{ id: WS_A }] : []), async () => {
    const perf = await asWorkspace(WS_B, () => market.performance('US'));
    expect(perf.ok, 'another brand must not receive tenant zero\'s revenue and best sellers').toBe(false);
    expect(perf.scope).toBe('other_workspace');
    expect(perf.error).toMatch(/belongs to a different brand workspace/i);
    expect(JSON.stringify(perf), 'not one figure from the other brand\'s export may appear').not.toMatch(/top_products|monthly_trend|net_sales/);

    const aud = await asWorkspace(WS_B, () => market.audience('US'));
    expect(aud.ok).toBe(false);
    expect(aud.purchasing_customers).toBeUndefined();
  });

  wsScope.invalidate();
  await withFakeSupabase((url) => (url.includes('brand_workspaces') ? [{ id: WS_A }] : []), async () => {
    const own = await asWorkspace(WS_A, () => market.performance('US'));
    expect(own.ok, 'the workspace the export DOES belong to still reads it').toBe(true);
  });
});

// ── 4. Two brands never collide on a calendar slot id ───────────────────────
//
// smart_calendar_entries.id is the primary key and was derived from
// date + market + cohort alone - values every brand shares.

test('calendar slot ids are namespaced per workspace', () => {
  const plan = require('../api/_shared/smart-brain-plan.js');
  const brandA = { id: WS_A, slug: 'brand-a', name: 'Brand A', regions: [{ code: 'US' }] };
  const brandB = { id: WS_B, slug: 'brand-b', name: 'Brand B', regions: [{ code: 'US' }] };
  const offering = [{ kind: 'product', name: 'Item', url: 'https://example.com/item' }];

  const a = plan.__test_offeringPlanEntries(brandA, offering, '2026-09-01', 3, plan.__test_workspaceNs(WS_A, false));
  const b = plan.__test_offeringPlanEntries(brandB, offering, '2026-09-01', 3, plan.__test_workspaceNs(WS_B, false));
  expect(a.length).toBeGreaterThan(0);
  expect(b.length).toBeGreaterThan(0);

  const idsA = new Set(a.map((e) => e.id));
  const overlap = b.map((e) => e.id).filter((id) => idsA.has(id));
  expect(overlap, `two brands generated the same primary key: ${overlap.join(', ')} - whichever synced second lost its slots and patched the other brand's row`).toEqual([]);

  // Tenant zero keeps its historical ids, because /lp/<campaign_id> URLs are
  // already published against them.
  const zero = plan.__test_offeringPlanEntries(brandA, offering, '2026-09-01', 1, plan.__test_workspaceNs(WS_A, true));
  expect(zero[0].id).toMatch(/^cal_2026-09-01_us_[a-z-]+$/);
});

// ── 5. The Knowledge Base router, driven end to end ─────────────────────────
//
// api/kb.js holds the service-role key and had no workspace filter on ANY of
// its reads: the KB list, the top-emails library, the competitor set and the
// captured-mail archive were all platform-wide. Its ingest path additionally
// called `wsScope.stamp('kb_knowledge', row, …)` with `row` undefined and threw
// the result away, so every ingested document was written with workspace_id
// NULL - accepted, and then readable by nobody.

function kbEnv() {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  delete require.cache[require.resolve('../api/kb.js')];
  return require('../api/kb.js');
}

/** A minimal req/res pair shaped like Vercel's. */
function reqRes({ method = 'GET', query = {}, body = null, headers = {} } = {}) {
  const res = { statusCode: 200, payload: null, headers: {} };
  return {
    req: { method, query, body, headers: Object.assign({ authorization: 'Bearer fake-user-jwt' }, headers) },
    res: {
      setHeader(k, v) { res.headers[k] = v; },
      status(c) { res.statusCode = c; return this; },
      json(p) { res.payload = p; return this; },
      end() { return this; },
    },
    out: res,
  };
}

// The workspace resolution path reads brand_user_prefs with the caller's `sub`.
// A signed JWT is not needed: workspace-scope only base64-decodes the payload.
function jwtFor(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64({ sub })}.sig`;
}

test('the KB list is filtered to the caller workspace', async () => {
  const kb = kbEnv();
  wsScope.invalidate();
  const handler = (url) => {
    if (url.includes('brand_user_prefs')) return [{ active_workspace_id: WS_B }];
    if (url.includes('brand_workspaces')) return [{ id: WS_A }];
    return [{ id: 'doc', title: 'another brand\'s document' }];
  };
  await withFakeSupabase(handler, async (calls) => {
    const { req, res, out } = reqRes({ query: { action: 'list' }, headers: { authorization: `Bearer ${jwtFor('user-b')}` } });
    await kb(req, res);
    const read = calls.find((c) => c.url.includes('/kb_knowledge'));
    expect(read, 'kb_knowledge was never read').toBeTruthy();
    expect(read.url, 'the Knowledge Base listed every brand\'s ingested documents').toContain(`workspace_id=eq.${WS_B}`);
    expect(out.statusCode).toBe(200);
  });
});

test('the competitor set cannot be patched or deleted across brands', async () => {
  const kb = kbEnv();
  wsScope.invalidate();
  const handler = (url) => {
    if (url.includes('brand_user_prefs')) return [{ active_workspace_id: WS_B }];
    if (url.includes('brand_workspaces')) return [{ id: WS_A }];
    return [{ id: 7, name: 'Rival' }];
  };
  await withFakeSupabase(handler, async (calls) => {
    const { req, res } = reqRes({
      method: 'PATCH', query: { action: 'brands', id: '7' }, body: { priority: 1 },
      headers: { authorization: `Bearer ${jwtFor('user-b')}` },
    });
    await kb(req, res);
    const patch = calls.find((c) => c.method === 'PATCH' && c.url.includes('competitor_brands'));
    expect(patch, 'no PATCH was issued').toBeTruthy();
    expect(patch.url, 'a bare id was enough to edit another brand\'s competitor row').toContain(`workspace_id=eq.${WS_B}`);
  });
});

test('an ingested document is stamped with the workspace that ingested it', async () => {
  const kb = kbEnv();
  wsScope.invalidate();
  const handler = (url) => {
    if (url.includes('brand_user_prefs')) return [{ active_workspace_id: WS_B }];
    if (url.includes('brand_workspaces')) return [{ id: WS_A, name: 'Brand A' }];
    if (url.includes('kb_knowledge')) return [{ id: 'row-1' }];
    return [];
  };
  await withFakeSupabase(handler, async (calls) => {
    const { req, res } = reqRes({
      method: 'POST', query: { action: 'ingest' },
      body: { url: 'https://example.com/article' },
      headers: { authorization: `Bearer ${jwtFor('user-b')}` },
    });
    await kb(req, res).catch(() => {});   // the page fetch fails offline; the write happens first
    const write = calls.find((c) => c.method === 'POST' && c.url.includes('kb_knowledge'));
    expect(write, 'the queued kb_knowledge row was never written').toBeTruthy();
    expect(write.body.workspace_id, 'a document written with workspace_id NULL is readable by no brand at all, including the one that ingested it').toBe(WS_B);
    expect(write.url, 'url_hash alone is globally unique, so two brands ingesting the same page overwrite each other').toContain('on_conflict=workspace_id,url_hash');
  });
});

test('the brand kit is per workspace, not a shipped singleton', async () => {
  const kb = kbEnv();
  wsScope.invalidate();
  const handler = (url) => {
    if (url.includes('brand_user_prefs')) return [{ active_workspace_id: WS_B }];
    if (url.includes('brand_workspaces')) return [{ id: WS_A }];
    return [];
  };
  await withFakeSupabase(handler, async (calls) => {
    const { req, res, out } = reqRes({ query: { action: 'brand-kit' }, headers: { authorization: `Bearer ${jwtFor('user-b')}` } });
    await kb(req, res);
    const read = calls.find((c) => c.url.includes('lifecycle_brand_kit'));
    expect(read.url, 'every brand read tenant zero\'s palette, typography and voice from id=1').not.toContain('id=eq.1');
    expect(read.url).toContain(`workspace_id=eq.${WS_B}`);
    expect(out.payload.brand_kit, 'a brand with no kit of its own gets nothing, not somebody else\'s').toBe(null);
  });
});

// ── 6. Data Analysis reports measured figures or an empty state ─────────────

function analysisCore() {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  process.env.KLAVIYO_API_KEY = 'deployment-klaviyo-key';   // the key that must NOT be used
  process.env.LIVE_CONNECTORS = 'on';
  for (const m of ['../api/_shared/data-analysis-core.js', '../api/_shared/supa.js', '../api/_shared/klaviyo-core.js', '../api/_shared/webengage-core.js']) {
    delete require.cache[require.resolve(m)];
  }
  return require('../api/_shared/data-analysis-core.js');
}

test('the mailer view never reports the deployment Klaviyo account as the brand\'s', async () => {
  const core = analysisCore();
  wsScope.invalidate();
  const handler = (url) => {
    if (url.includes('brand_user_prefs')) return [{ active_workspace_id: WS_B }];
    if (url.includes('brand_workspaces')) return [{ id: WS_A }];
    return [];
  };
  try {
    await withFakeSupabase(handler, async (calls) => {
      const scope = require('../api/_shared/request-scope.js');
      const out = await scope.run(
        { headers: { authorization: `Bearer ${jwtFor('user-b')}` }, query: {}, __workspaceId: WS_B },
        () => core.mailer({ market: 'US', hours: 72 }),
      );
      expect(calls.some((c) => c.url.includes('a.klaviyo.com')), 'the deployment Klaviyo key was used on behalf of a brand that did not connect it').toBe(false);
      expect(out.data_scope.level).toBe('unconnected');
      expect(out.data_scope.basis).toBe('unset');
      expect(out.campaigns).toEqual([]);
      expect(out.note).toMatch(/Connect Klaviyo or WebEngage/i);
    });
  } finally {
    delete process.env.KLAVIYO_API_KEY;
    delete process.env.LIVE_CONNECTORS;
  }
});

test('action outcomes are read scoped, and platform activity is not reshaped into them', async () => {
  const core = analysisCore();
  wsScope.invalidate();
  const handler = (url) => {
    if (url.includes('brand_user_prefs')) return [{ active_workspace_id: WS_B }];
    if (url.includes('brand_workspaces')) return [{ id: WS_A }];
    if (url.includes('analytics_action_outcomes')) return [];             // this brand has none
    if (url.includes('activity_logs')) return [{ id: 'log-1', action: 'connector.sync', status: 'ok' }];
    return [];
  };
  await withFakeSupabase(handler, async (calls) => {
    const scope = require('../api/_shared/request-scope.js');
    const out = await scope.run(
      { headers: { authorization: `Bearer ${jwtFor('user-b')}` }, query: {}, __workspaceId: WS_B },
      () => core.actions(),
    );
    const read = calls.find((c) => c.url.includes('analytics_action_outcomes'));
    expect(read.url, 'incremental revenue and ROI were readable by every signed-in brand').toContain(`workspace_id=eq.${WS_B}`);
    expect(out.actions, 'platform log lines were reshaped into this brand\'s marketing actions').toEqual([]);
    expect(out.kpis.actions_tracked).toBe(0);
    expect(out.data_scope.basis).toBe('unset');
  });
});

// ── 7. No generator carries a shipped brand's identity ──────────────────────
//
// The literal wordmark of the brand this repo was FORKED from survived the
// rebrand in three generators - the landing-page renderer, the ad-creative
// canvas and the /api/ai/generate landing-page system prompt - and was printed
// onto every workspace's output. A search-and-replace rebrand cannot catch a
// string that is spelled with spaces between the letters, so this asserts on
// the mechanism instead: these generators must read the ACTIVE brand.

test('no generator prints a shipped wordmark instead of the active brand', () => {
  const GENERATORS = [
    'landing-pages.html',
    'ad-campaigns.html',
    'api/ai/generate.js',
    'api/_shared/landing-page-core.js',
    'api/_shared/smart-brain-plan.js',
  ];
  // Written apart so this file's own source cannot match the pattern it bans.
  const FORKED_FROM = new RegExp(['V', 'A', 'H', 'D', 'A', 'M'].join('\\s*'), 'i');
  for (const rel of GENERATORS) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(FORKED_FROM.test(src), `${rel} still carries the forked-from brand's wordmark; every workspace's generated asset would print it`).toBe(false);
  }
});

test('the landing-page renderers resolve the brand rather than hardcoding one', () => {
  for (const rel of ['landing-pages.html', 'ad-campaigns.html']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(src, `${rel} must read the active brand`).toMatch(/window\.BrandContext\s*&&\s*window\.BrandContext\.brand/);
    expect(src, `${rel} must print a marker rather than a shipped name when no brand is active`).toMatch(/DATA REQUIRED BEFORE LAUNCH: brand name/);
  }
});

test('the /api/ai/generate landing-page prompt is built from the active brand', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/ai/generate.js'), 'utf8');
  // The palette, typography, voice and wordmark rules must all come from the
  // resolved brand rather than from a literal in the prompt.
  expect(src).toMatch(/_lpPaletteRule/);
  expect(src).toMatch(/_lpTypeRule/);
  expect(src).toMatch(/_lpBannedRule/);
  expect(src).toMatch(/header wordmark "\$\{_lpName\}"/);
  // And a brand without a store for the market gets a marker, not tenant zero's.
  expect(src).toMatch(/DATA REQUIRED BEFORE LAUNCH: region store URL, all, \$\{lpRegion\}/);
});

test('WORKSPACE_ID pins a userless job, and never overrides a real user', async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const env = { url: 'https://fake.supabase.co', key: 'service-role-test-key' };
  wsScope.invalidate();
  process.env.WORKSPACE_ID = WS_B;
  try {
    await withFakeSupabase((url) => (url.includes('brand_user_prefs') ? [{ active_workspace_id: WS_A }] : [{ id: WS_A }]), async () => {
      // A collector or seed script: no request at all.
      expect(await wsScope.resolve(env, null)).toBe(WS_B);
      // A real signed-in user still wins; an env var must not redirect their
      // reads into another brand's workspace.
      wsScope.invalidate();
      const req = { headers: { authorization: `Bearer ${jwtFor('user-a')}` }, query: {} };
      expect(await wsScope.resolve(env, req)).toBe(WS_A);
    });
  } finally {
    delete process.env.WORKSPACE_ID;
    wsScope.invalidate();
  }
});

test('every route serving the bundled export gates on who owns it', () => {
  // The export is compiled into the build and describes exactly one store. Four
  // routes read it, and each has to answer the ownership question BEFORE it
  // reports a figure, otherwise the caveat is the only thing standing between a
  // brand and another company's revenue.
  const GATED = [
    ['api/brain.js', /alerts-preview[\s\S]{0,900}?ownsBundledExport\(\)/],
    ['api/brain.js', /analysis-narrative[\s\S]{0,900}?ownsBundledExport\(\)/],
    ['api/public-config.js', /validate[\s\S]{0,900}?ownsBundledExport\(\)/],
    ['api/_shared/brand-llm.js', /validate_data_accuracy[\s\S]{0,1200}?ownsBundledExport\(\)/],
    ['api/_shared/brand-llm.js', /analyst_insights[\s\S]{0,1600}?ownsBundledExport\(\)/],
  ];
  for (const [rel, re] of GATED) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    expect(re.test(src), `${rel} serves the bundled tenant-zero export without checking which workspace is asking`).toBe(true);
  }
});

test('the assistant reads the workspace\'s own Klaviyo account, never the deployment key', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/_shared/brand-llm.js'), 'utf8');
  // klaviyo.dispatch(op, params) with no third argument falls back to
  // KLAVIYO_API_KEY inside klaviyo-core.
  expect(src).toMatch(/credentialsForCurrentRequest\('klaviyo'\)/);
  expect(src).toMatch(/klaviyo\.dispatch\(a\.op,\s*a,\s*creds\)/);
  expect(src).not.toMatch(/klaviyo\.dispatch\(a\.op,\s*a\)/);
});
