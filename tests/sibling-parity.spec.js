// The remaining capability gaps against the single-tenant sibling, closed.
//
// Four things existed there and not here: ads-insight-engine (turn fetched ad
// rows into findings), competitive-benchmark-core (own vs competitor with a
// hard public/private boundary), motion-design (one depth and motion system for
// every renderer) and the order-attribution CLI.
//
// Each port carries the same risk the earlier ones did: the sibling is
// single-tenant, so anything it could safely hardcode becomes a cross-brand
// leak here. The load-bearing case is WHOSE STOREFRONT IS "OURS".
//
// Run: npx playwright test tests/sibling-parity.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const shared = (f) => require(path.join(ROOT, 'api', '_shared', f));
const src = (f) => fs.readFileSync(path.join(ROOT, 'api', '_shared', f), 'utf8');
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const bench = shared('competitive-benchmark-core.js');
const engine = shared('ads-insight-engine.js');
const motion = shared('motion-design.js');

/* ═══ all four arrived ════════════════════════════════════════════════════ */

test('the four missing modules exist and load', () => {
  for (const f of ['ads-insight-engine.js', 'competitive-benchmark-core.js', 'motion-design.js']) {
    expect(fs.existsSync(path.join(ROOT, 'api', '_shared', f)), `${f} is missing`).toBe(true);
  }
  expect(fs.existsSync(path.join(ROOT, 'scripts', 'order-attribution.js'))).toBe(true);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(pkg.scripts.attribution).toContain('order-attribution');
});

test('no sibling brand token rode along in any of them', () => {
  // Assembled, not written out: tests/ ships inside the deployed output root.
  const token = ['vah', 'dam'].join('');
  for (const f of ['ads-insight-engine.js', 'competitive-benchmark-core.js', 'motion-design.js']) {
    expect(src(f).toLowerCase(), `${f} carries the sibling's name`).not.toContain(token);
  }
  expect(fs.readFileSync(path.join(ROOT, 'scripts', 'order-attribution.js'), 'utf8').toLowerCase())
    .not.toContain(token);
});

/* ═══ whose storefront is "ours" ══════════════════════════════════════════ */

test('the own storefront comes from the active brand, never a hardcoded host', () => {
  // The sibling hardcoded five storefront hosts as OWN_STOREFRONT. Ported
  // unchanged, every tenant's "own baseline" would be read from that company's
  // shop, and the whole comparison would silently be them vs the competitor.
  const s = codeOnly(src('competitive-benchmark-core.js'));
  expect(s).not.toMatch(/OWN_STOREFRONT/);
  expect(s).not.toMatch(/myshopify\.com|www\.[a-z]+teas?\.com/i);
  expect(s).toMatch(/function ownStorefront/);

  expect(bench.ownStorefront({ regions: [{ code: 'US', store_url: 'https://shop.example.com' }] }, 'US'))
    .toEqual({ host: 'shop.example.com', exact_market: true });
});

test('a brand with no store URL gets a marker, not somebody else\'s shop', () => {
  for (const b of [null, {}, { name: 'X' }, { name: 'X', regions: [] }]) {
    expect(bench.ownStorefront(b, 'US').host, 'a host was invented').toBe('');
  }
});

test('a store URL for another market is used but reported as not market-specific', () => {
  // Using it is reasonable; presenting it AS the market's store would not be.
  const out = bench.ownStorefront({ regions: [{ code: 'IN', store_url: 'https://in.example.com' }] }, 'US');
  expect(out.host).toBe('in.example.com');
  expect(out.exact_market).toBe(false);
});

/* ═══ the public/private boundary ═════════════════════════════════════════ */

test('no competitor performance figure can be produced, only nulls with a reason', () => {
  const own = {
    catalog: { readable: true, products: 120, price_min: 10, price_median: 20, price_max: 40 },
    paid_media: { active_creatives: 7, spend: 500, ctr_pct: 1.2, cpm: 8, cpc: 0.6 },
    commerce: { aov: 42 },
  };
  const comp = { storefront: { readable: true, products: 300, price_min: 12, price_median: 25, price_max: 60 }, meta_ads: { active_creatives: 11 } };
  const out = bench.compare(own, comp);

  for (const r of out.own_only) {
    expect(r.competitor, `${r.metric} produced a competitor figure`).toBeNull();
    expect(r.reason).toMatch(/never estimated/i);
  }
  // Catalogue IS comparable, because both sides are read the same way.
  const cat = out.comparable.find((r) => r.metric === 'catalog_size');
  expect(cat.own).toBe(120);
  expect(cat.competitor).toBe(300);
  // Creative counts are collected differently and must say so.
  const ads = out.comparable.find((r) => r.metric === 'active_meta_creatives');
  expect(ads.note).toMatch(/not strictly like for like/i);
});

test('a ratio is omitted rather than shown as infinity', () => {
  const out = bench.compare(
    { catalog: { readable: true, products: 5 }, paid_media: {}, commerce: {} },
    { storefront: { readable: true, products: 0 }, meta_ads: {} },
  );
  const cat = out.comparable.find((r) => r.metric === 'catalog_size');
  expect(cat.ratio).toBeNull();
});

test('the storefront reader cannot be pointed at an internal address', async () => {
  // This fetches an operator-supplied domain FROM THE SERVER, which is the
  // feature and also an SSRF primitive. Same guard as the catalogue importer.
  expect(codeOnly(src('competitive-benchmark-core.js'))).toMatch(/assertPublicUrl/);
  for (const host of ['169.254.169.254', 'localhost', '127.0.0.1', '10.0.0.5']) {
    const out = await bench.storefront(host);
    expect(out.readable, `${host} was fetched`).toBe(false);
    expect(String(out.error)).toMatch(/refused|no domain/i);
  }
});

/* ═══ findings quote their figures, or are not emitted ════════════════════ */

test('no rows means no insights, not a plausible observation', () => {
  const out = engine.deriveInsights([]);
  expect(out.insights).toEqual([]);
  expect(out.note).toMatch(/nothing is inferred/i);
  expect(engine.deriveActionables([]).actions).toEqual([]);
});

test('a null conversion count is unknown, never zero sales', () => {
  const rows = [
    { campaign_name: 'A', spend: 100, impressions: 5000, clicks: 50 },
    { campaign_name: 'B', spend: 200, impressions: 9000, clicks: 90 },
  ];
  const out = engine.deriveInsights(rows);
  const noCov = out.insights.find((i) => i.id === 'no-conversion-coverage');
  expect(noCov, 'silently treated missing conversions as measurable').toBeTruthy();
  expect(noCov.detail).toMatch(/property of the source, not a result of zero sales/i);
  // And it must NOT have claimed wasted spend from rows it cannot judge.
  expect(out.insights.find((i) => i.id === 'zero-conversion-spend')).toBeFalsy();
});

test('zero-conversion spend is only claimed where conversions were measured', () => {
  const rows = [
    { campaign_name: 'Dead', spend: 300, impressions: 9000, clicks: 40, conversions: 0 },
    { campaign_name: 'Live', spend: 200, impressions: 8000, clicks: 60, conversions: 12 },
  ];
  const out = engine.deriveInsights(rows);
  const dead = out.insights.find((i) => i.id === 'zero-conversion-spend');
  expect(dead.severity).toBe('critical');
  expect(dead.detail).toContain('Dead');
  expect(dead.evidence[0]).toMatchObject({ name: 'Dead', spend: 300 });
});

test('outliers are judged against this account, not an invented benchmark', () => {
  const s = codeOnly(src('ads-insight-engine.js'));
  expect(s).toMatch(/median/);
  // An "industry average" would be a figure we cannot source.
  expect(s).not.toMatch(/industry (average|benchmark)\s*=|INDUSTRY_[A-Z]/);
});

test('an action is only proposed when there is something specific to do', () => {
  const out = engine.deriveActionables([
    { campaign_name: 'A', spend: 100, impressions: 5000, clicks: 50, conversions: 3 },
  ]);
  for (const a of out.actions) {
    expect(a.why, 'an action with no figures behind it').toBeTruthy();
    expect(a.action).not.toMatch(/monitor performance/i);
  }
});

/* ═══ the motion system belongs to no particular palette ══════════════════ */

test('motion helpers take palette ROLES, not one brand\'s colour names', () => {
  const s = src('motion-design.js');
  // The sibling's API said cardLift(gold) / ctaShineFace(green, gold), which
  // teaches every call site to think in one company's palette.
  expect(s).toMatch(/cardLift\(accent\)/);
  expect(s).toMatch(/ctaShineFace\(primary, accent\)/);
  expect(s).toMatch(/adDepthLayers\(accent\)/);
  expect(codeOnly(s)).not.toMatch(/\bgold\b|\bgreen\b/i);
});

test('every colour in a motion helper comes from its argument', () => {
  const face = motion.emailDepth.ctaShineFace('#1F5FD0', '#8A4B12');
  expect(face).toContain('#1F5FD0');
  expect(face).toContain('#8A4B12');
  // No brand hex may be baked in anywhere in the module.
  const hexes = (codeOnly(src('motion-design.js')).match(/#[0-9a-f]{6}\b/gi) || []);
  expect(hexes, `hardcoded colours: ${hexes.join(' ')}`).toEqual([]);
});

test('an email animation hides content only inside the gate that animates it', () => {
  // A client that keeps embedded styles but strips animation would otherwise
  // paint the mailer permanently invisible.
  const css = motion.emailMotionCss();
  const gateAt = css.indexOf(motion.EMAIL_MOTION_GATE);
  expect(gateAt).toBeGreaterThanOrEqual(0);
  const before = css.slice(0, gateAt);
  expect(before).not.toMatch(/opacity:\s*0/);
  expect(css).toMatch(/mx-rise\{opacity:0/);
});

/* ═══ the routes are mounted ══════════════════════════════════════════════ */

test('ads-analysis and the benchmark actions are reachable', () => {
  const brain = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
  expect(brain).toMatch(/case 'ads-analysis':/);
  expect(brain).toMatch(/ads-insight-engine\.js/);

  const comp = fs.readFileSync(path.join(ROOT, 'api', 'competitor.js'), 'utf8');
  expect(comp).toMatch(/action === 'benchmark'/);
  expect(comp).toMatch(/action === 'benchmark-set'/);
  // The benchmark must resolve the workspace, or it would read one brand's
  // universe for another.
  const block = comp.slice(comp.indexOf("action === 'benchmark'"), comp.indexOf('COMPETITIVE INTELLIGENCE'));
  expect(block).toMatch(/universeContext\(req, url\)/);
  expect(block).toMatch(/brandForWorkspace\(/);
});

test('the benchmark set refuses to run without a resolved workspace', async () => {
  const out = await bench.benchmarkSet({ market: 'US' });
  expect(out.ok).toBe(false);
  expect(out.error).toBe('workspace_unresolved');
  expect(out.note).toMatch(/never substituted/i);
});

/* ═══ the parity claim itself, made checkable ═════════════════════════════ */

test('the sibling agent actions are covered by one action with ops', () => {
  // The sibling exposes agent-openapi / agent-status / agent-run as three
  // separate actions. Here they are three ops on one, which is the same
  // capability through a different door - and this asserts it rather than
  // leaving "covered" as something written in a commit message.
  const brain = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
  const block = brain.slice(brain.indexOf("case 'agent-builder':"), brain.indexOf("case 'agent-builder':") + 2200);
  expect(block).toMatch(/op === 'spec'/);           // agent-openapi
  expect(block).toMatch(/op === 'status'/);         // agent-status
  expect(block).toMatch(/ab\.runTool\(/);           // agent-run
  // And the execution path authorises on the agent key, not a browser session.
  expect(block).toMatch(/ab\.authorize\(req\)/);

  const ab = shared('agent-builder-core.js');
  for (const fn of ['openApiSpec', 'runTool', 'status', 'authorize']) {
    expect(typeof ab[fn], `${fn} is not callable`).toBe('function');
  }
});

test('no new serverless function was added for any of this', () => {
  const api = path.join(ROOT, 'api');
  const count = (dir, prefix = '') => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
    if (e.name.startsWith('_')) return n;
    if (e.isDirectory()) return n + count(path.join(dir, e.name), `${prefix}${e.name}/`);
    return n + (e.name.endsWith('.js') ? 1 : 0);
  }, 0);
  expect(count(api), 'the Hobby function cap is 12').toBeLessThanOrEqual(12);
});
