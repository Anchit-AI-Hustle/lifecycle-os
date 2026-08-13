// Ads plumbing — no other company's advertising data, and no bundled defaults.
//
// WHY THESE EXIST. This repo was copied from a sibling lifecycle-OS project
// built for a different company and rebranded by search-and-replace, so the
// brand NAME was rewritten while the business underneath it was not. The ads
// surfaces carried that company's real Meta / Google / TikTok history: a
// registry of nineteen warehouse feeds with platform account ids and lifetime
// spend, eighty-six days of daily spend, named campaigns with revenue and ROAS,
// ad rows naming individual creators, and its warehouse schema hardcoded as the
// default table names. A brand that onboarded here read all of it as its own.
//
// Every test below fails against that code and passes against the fix. They are
// deliberately about PROVENANCE, not about rendering: the bug was never that a
// panel looked wrong, it was that it looked right while showing the wrong
// company's numbers.
//
// Run: npx playwright test tests/ads-data-provenance.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Assembled from fragments for the same reason scripts/check-foreign-brands.js
// assembles its tokens: tests/ sits inside the deployed output root
// (vercel.json sets outputDirectory "."), so a literal here would itself be a
// served occurrence of the string these tests exist to keep out.
const FOREIGN_SCHEMA = ['MAPLE', 'MONK'].join('');
const FOREIGN_TABLE = ['USA', 'TEA', 'ADS', 'ADS', 'INSIGHTS'].join('_');
const FOREIGN_SF_ACCOUNT = ['UXD', 'EIHW'].join('') + '-' + ['MO', '06981'].join('');
const FOREIGN_RETAILER = ['cost', 'co'].join('');

function fresh(mod) {
  const p = require.resolve(mod);
  delete require.cache[p];
  return require(p);
}
/** Loads a core module with a clean env, so nothing leaks in from the runner. */
function withEnv(vars, fn) {
  const saved = {};
  const keys = Object.keys(vars);
  for (const k of keys) { saved[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

// ── 1. The bundled datasets are gone ─────────────────────────────────────────

test('no bundled ad dataset ships in the repo', () => {
  // data/ads/ held five files: an ad-account registry, a daily/campaign
  // snapshot, a 91KB "master KB" of one company's handover (named employees,
  // named creators, launch runbooks), 125 real ad rows, and the raw warehouse
  // extract they were built from. None named a workspace, so none could ever be
  // filtered to the brand looking at it.
  expect(fs.existsSync(path.join(ROOT, 'data', 'ads')), 'data/ads/ is back').toBe(false);
});

test('nothing still fetches the deleted ad datasets', () => {
  // A dangling fetch is not harmless: it is the seam a file gets restored into.
  const suspects = ['ads-dashboard.html', 'ad-campaigns-master.html', 'auth.js', 'analysis-registry.js'];
  for (const f of suspects) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    expect(/fetch\(\s*["']\/data\/ads\//.test(src), `${f} still fetches a deleted ad dataset`).toBe(false);
    expect(/href=["']\/data\/ads\//.test(src), `${f} still links a deleted ad dataset`).toBe(false);
  }
});

test('the snapshot builder is gone and npm no longer scripts it', () => {
  expect(fs.existsSync(path.join(ROOT, 'scripts', 'build-ads-live-snapshot.js'))).toBe(false);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(Object.keys(pkg.scripts || {})).not.toContain('build:ads-snapshot');
});

// ── 2. No hardcoded warehouse: env, or nothing ───────────────────────────────

test('an unconfigured deployment has NO ad sources at all', () => {
  // The registry used to return nineteen feeds unconditionally, so every
  // deployment "had" another advertiser's accounts before it configured a
  // thing. With no SF_* var set the honest answer is: none.
  withEnv({
    SF_META_ADS_TABLE: null, SF_GOOGLE_ADS_TABLE: null, SF_GOOGLE_ADGROUP_AD_TABLE: null,
    SF_TIKTOK_AD_TABLE: null, SF_TIKTOK_CAMPAIGN_TABLE: null, SF_TIKTOK_ADS_TABLE: null,
    SNOWFLAKE_DATABASE: null,
  }, () => {
    const snow = fresh('../api/_shared/ads-snowflake-core.js');
    expect(snow.adSources()).toEqual([]);
    expect(snow.hasSources()).toBe(false);
    const s = snow.sources();
    for (const platform of Object.keys(s)) {
      for (const [feed, table] of Object.entries(s[platform])) {
        expect(table, `${platform}.${feed} has a bundled default table name`).toBeNull();
      }
    }
  });
});

test('an unconfigured deployment names the env var instead of guessing a table', async () => {
  await withEnv({ SF_META_ADS_TABLE: null, SF_GOOGLE_ADS_TABLE: null, SF_TIKTOK_AD_TABLE: null }, async () => {
    const snow = fresh('../api/_shared/ads-snowflake-core.js');
    const res = await snow.accounts({});
    expect(res.ok).toBe(false);
    expect(res.no_sources).toBe(true);
    expect(res.rows || []).toEqual([]);
    // It must say what to set, or the empty state is just a dead end.
    expect(res.hint).toMatch(/SF_META_ADS_TABLE/);
    expect(res.need_env).toBeTruthy();
  });
});

test('a configured table is used verbatim and none other is invented', async () => {
  await withEnv({
    SF_META_ADS_TABLE: 'ACME_DB.RAW.META_ADS', SF_GOOGLE_ADS_TABLE: null,
    SF_TIKTOK_AD_TABLE: null, SF_META_ACTION_TABLES: null,
  }, async () => {
    const snow = fresh('../api/_shared/ads-snowflake-core.js');
    const srcs = snow.adSources();
    expect(srcs).toHaveLength(1);
    expect(srcs[0].table).toBe('ACME_DB.RAW.META_ADS');
    const res = await snow.accounts({ since: '2026-01-01', until: '2026-02-01' });
    expect(res.would_query).toContain('ACME_DB.RAW.META_ADS');
    expect(res.would_query).not.toContain(FOREIGN_SCHEMA);
    expect(res.would_query).not.toContain(FOREIGN_TABLE);
  });
});

test('a source describes only what was configured, never whose account it is', () => {
  withEnv({ SF_META_ADS_TABLE: 'ACME_DB.RAW.META_ADS' }, () => {
    const snow = fresh('../api/_shared/ads-snowflake-core.js');
    const d = snow.describeAccount(snow.adSources()[0]);
    // A bundled label, account id, region, spend or "purpose" is a claim about
    // a business this module cannot know anything about.
    for (const key of ['label', 'account_id', 'region', 'verified', 'purpose', 'used_for', 'fresh_to']) {
      expect(d[key], `describeAccount still asserts ${key}`).toBeUndefined();
    }
    expect(d.table).toBe('ACME_DB.RAW.META_ADS');
    expect(d.env).toBe('SF_META_ADS_TABLE');
  });
});

// ── 3. Budgets and naming vocabulary are policy, not product ─────────────────

test('no daily budget cap is assumed', () => {
  withEnv({ ADS_DAILY_BUDGET_CAP: null }, () => {
    const snow = fresh('../api/_shared/ads-snowflake-core.js');
    const b = snow.budgets();
    expect(b.daily_cap).toBeNull();
    expect(b.configured).toBe(false);
    expect(b.note).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
    // The old shape hardcoded two named retail accounts and their caps.
    expect(b.target).toBeUndefined();
    expect(b[FOREIGN_RETAILER]).toBeUndefined();
  });
});

test('pacing without a configured cap judges no day as over', async () => {
  await withEnv({ ADS_DAILY_BUDGET_CAP: null, SF_META_ADS_TABLE: null }, async () => {
    fresh('../api/_shared/ads-snowflake-core.js');
    const sop = fresh('../api/_shared/ads-sop-core.js');
    const res = await sop.pacing({});
    expect(res.cap_usd == null).toBe(true);
    expect((res.days || []).some((d) => d.over)).toBe(false);
  });
});

test('naming rule 6 does not run against a vocabulary nobody configured', () => {
  withEnv({ ADS_SOP_TOKENS: null }, () => {
    const sop = fresh('../api/_shared/ads-sop-core.js');
    // A perfectly reasonable name for ANY brand must not be flagged just
    // because it is absent from one advertiser's product list.
    const ad = sop.parseAdName('2026-08-01_prospecting_hoodie_broad_instagram_1234567890');
    expect(ad.issues.filter((i) => i.rule === 6)).toEqual([]);
    expect(ad.compliant).toBe(true);

    // The structural rules still apply — they hold for anyone.
    const bad = sop.parseAdName('2026-08-01_Prospecting Hoodie_broad_instagram');
    expect(bad.issues.some((i) => i.rule === 1)).toBe(true);   // space
    expect(bad.issues.some((i) => i.rule === 2)).toBe(true);   // uppercase
    expect(bad.issues.some((i) => i.rule === 3)).toBe(true);   // no videoid

    const ref = sop.reference();
    expect(ref.tokens).toEqual({});
    expect(ref.tokens_note).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
  });
});

test('a workspace CAN configure its own naming vocabulary', () => {
  withEnv({ ADS_SOP_TOKENS: JSON.stringify({ platform: ['meta', 'tiktok'] }) }, () => {
    const sop = fresh('../api/_shared/ads-sop-core.js');
    expect(sop.parseCampaignName('2026-08_meta_conv_prospecting').issues.filter((i) => i.rule === 6)).toEqual([]);
    const off = sop.parseCampaignName('2026-08_pinterest_conv_prospecting');
    expect(off.issues.some((i) => i.rule === 6)).toBe(true);
  });
});

// ── 4. Live view: empty state, never a snapshot ──────────────────────────────

test('the live view returns nothing and says what to connect', async () => {
  await withEnv({
    SF_META_ADS_TABLE: null, SF_GOOGLE_ADS_TABLE: null, SF_TIKTOK_AD_TABLE: null,
    META_ACCESS_TOKEN: null, META_AD_ACCOUNT_ID: null, ADS_LIVE_ACCOUNTS: null,
  }, async () => {
    fresh('../api/_shared/ads-snowflake-core.js');
    const live = fresh('../api/_shared/ads-live-core.js');
    for (const [name, res] of [['today', await live.today({})], ['daily', await live.daily({})]]) {
      expect(res.ok, `${name} claims success with no source`).toBe(false);
      expect(res.no_sources, `${name} does not report the missing source`).toBe(true);
      expect(res.rows || res.ads || []).toEqual([]);
      // The empty state must name the platform to connect.
      expect(res.hint).toMatch(/META_ACCESS_TOKEN/);
      expect(res.hint).toMatch(/SF_META_ADS_TABLE/);
    }
  });
});

// ── 5. Deployment scope is stated, not implied ───────────────────────────────

test('warehouse payloads declare they are deployment-level, not the brand"s own', async () => {
  await withEnv({ SF_META_ADS_TABLE: 'ACME_DB.RAW.META_ADS' }, async () => {
    const snow = fresh('../api/_shared/ads-snowflake-core.js');
    expect(snow.DATA_SCOPE.level).toBe('deployment');
    expect(snow.status().data_scope.level).toBe('deployment');
    const res = await snow.accounts({});
    expect(res.data_scope.level).toBe('deployment');
    // And it must point a reader at the per-workspace path rather than just
    // disclaiming: a caveat with no route is how the wrong number gets used.
    expect(snow.DATA_SCOPE.note).toMatch(/workspace/i);
  });
});

// ── 6. No source file carries the foreign warehouse or Snowflake account ─────

test('no ads source file names the foreign warehouse schema or Snowflake account', () => {
  const files = [
    'api/_shared/ads-snowflake-core.js', 'api/_shared/ads-live-core.js',
    'api/_shared/ads-sop-core.js', 'ads-dashboard.html', 'ad-campaigns-master.html',
    'docs/snowflake-connect.md', 'api/brain.js', 'analysis-registry.js',
  ];
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    expect(src.includes(FOREIGN_SCHEMA), `${f} names the foreign warehouse schema`).toBe(false);
    expect(src.includes(FOREIGN_TABLE), `${f} names the foreign ad-insights table`).toBe(false);
    expect(src.toUpperCase().includes(FOREIGN_SF_ACCOUNT), `${f} names the foreign Snowflake account`).toBe(false);
    // A hardcoded Snowsight deep link is a link into somebody else's account.
    expect(/app\.snowflake\.com\/streamlit\/[a-z0-9]/i.test(src), `${f} deep-links a specific Snowflake app`).toBe(false);
  }
});

// ── 7. The retired URL is redirected, never dropped ──────────────────────────

test('the retired ads-master URLs redirect rather than 404', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const redirects = vercel.redirects || [];
  const rewrites = vercel.rewrites || [];
  for (const src of ['/ads-master', '/ad-campaigns-master', '/ads-kb', '/ad-campaigns-master.html']) {
    const r = redirects.find((x) => x.source === src);
    expect(r, `${src} shipped as a URL and must still resolve`).toBeTruthy();
    expect(r.destination).toBe('/data-analysis?tab=live-ads');
    expect(rewrites.some((x) => x.source === src), `${src} is still rewritten to the retired page`).toBe(false);
  }
  // The file itself stays as a redirect stub, and must not be a dashboard.
  const stub = fs.readFileSync(path.join(ROOT, 'ad-campaigns-master.html'), 'utf8');
  expect(stub).toMatch(/http-equiv="refresh"/);
  expect(stub.length).toBeLessThan(8000);
});
