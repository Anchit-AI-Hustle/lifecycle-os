// One analyst agent per platform, ported from the single-tenant sibling.
//
// The port's risk sits in a single sentence of the system prompt. The original
// opened with "You are the <platform> analyst for <company> (premium D2C <their
// category>)". Ported unchanged, EVERY tenant's analyst introduces itself as
// that company and reasons about that sector — the identical defect that once
// art-directed every brand's ad imagery with one company's persona.
//
// Run: npx playwright test tests/platform-agents.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'api', '_shared', 'platform-agents-core.js');
const agents = require(MODULE);

const code = () => fs.readFileSync(MODULE, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

/* ═══ whose analyst is it ═════════════════════════════════════════════════ */

test('no company name is baked into the analyst prompt', () => {
  const src = code();
  // Assembled, not written out: tests/ ships inside the deployed output root,
  // so a literal here would be the very occurrence it is checking for.
  expect(src.toLowerCase()).not.toContain(['vah', 'dam'].join(''));
  // And nothing else has quietly taken its place as a hardcoded identity.
  expect(src).not.toMatch(/analyst for [A-Z][A-Za-z]+ \(/);
});

test('the identity is derived from the resolved brand', () => {
  const src = code();
  expect(src).toMatch(/function analystIdentity/);
  expect(src).toMatch(/analystIdentity\(brand\)/);
  // The brand has to reach analyse(), or the function is decoration.
  expect(src).toMatch(/analyse\(agent, collected, \{ question, tier, timeoutMs, brand \}\)/);
});

test('an unresolved brand is told to assume nothing, not handed a default', () => {
  const src = fs.readFileSync(MODULE, 'utf8');
  const fn = src.slice(src.indexOf('function analystIdentity'), src.indexOf('async function analyse'));
  // Defaulting here is how a news publisher's analyst starts reasoning about
  // sneakers. The honest fallback is to work from the numbers alone.
  expect(fn).toMatch(/Do NOT guess/);
  expect(fn).toMatch(/isUnresolved/);
  expect(fn).not.toMatch(/defaultBrand/);
});

/* ═══ the seven agents ════════════════════════════════════════════════════ */

test('every platform in the stack has an agent, and each owns exactly one', () => {
  const ids = agents.AGENTS.map((a) => a.id);
  for (const p of ['shopify', 'meta', 'google', 'tiktok', 'klaviyo', 'webengage', 'pagedeck']) {
    expect(ids, `${p} has no agent`).toContain(p);
  }
  expect(new Set(ids).size, 'two agents share an id').toBe(ids.length);
  for (const a of agents.AGENTS) {
    expect(typeof a.collect, `${a.id} has no collector`).toBe('function');
    expect(a.group, `${a.id} has no group`).toBeTruthy();
  }
});

/* ═══ no data, no thinking ════════════════════════════════════════════════ */

test('a disconnected agent skips the model entirely', async () => {
  const before = process.env.LIVE_CONNECTORS;
  delete process.env.LIVE_CONNECTORS;          // nothing can be connected

  const out = await agents.runAgent('shopify', { market: 'US', days: 7 });
  expect(out.connected).toBe(false);
  expect(out.analysed).toBe(false);
  // It must not speculate about what the numbers might have looked like, and it
  // must not spend model quota to say nothing.
  expect(out.insights).toEqual([]);
  expect(out.summary).toMatch(/not connected/i);
  expect(out.summary).toMatch(/no figures are estimated/i);
  // The one honest action is the one that would produce data.
  expect(out.action_items).toHaveLength(1);
  expect(out.action_items[0].priority).toBe('P0');
  expect(out.action_items[0].action).toMatch(/connect/i);

  if (before !== undefined) process.env.LIVE_CONNECTORS = before;
});

test('a disconnected agent invents no metrics', async () => {
  const before = process.env.LIVE_CONNECTORS;
  delete process.env.LIVE_CONNECTORS;
  const out = await agents.runAgent('klaviyo', {});
  // An empty object, never plausible-looking zeros presented as measurements.
  expect(out.metrics).toEqual({});
  expect(out.blocker).toBeTruthy();
  if (before !== undefined) process.env.LIVE_CONNECTORS = before;
});

test('runAll reports coverage rather than hiding what was blocked', async () => {
  const before = process.env.LIVE_CONNECTORS;
  delete process.env.LIVE_CONNECTORS;
  const out = await agents.runAll({ market: 'US' });

  // Asserting an ABSOLUTE connected count was wrong: this ran green alone and
  // failed in the full suite, because other specs set env vars (a service-role
  // key flips the WebEngage collector to connected) and Playwright shares the
  // process. The invariant is what actually matters and it holds either way -
  // every agent is accounted for, and none is silently dropped.
  expect(out.coverage.total).toBe(agents.AGENTS.length);
  expect(out.agents).toHaveLength(agents.AGENTS.length);
  expect(out.coverage.connected + out.coverage.blocked).toBe(out.coverage.total);

  // And the thing the coverage block exists to prevent: a blocked agent is
  // REPORTED with its reason, never omitted so the page reads "nothing to
  // report".
  for (const a of out.agents.filter((x) => !x.connected)) {
    expect(a.blocker, `${a.agent} is blocked with no reason`).toBeTruthy();
    expect(a.insights, `${a.agent} speculated while disconnected`).toEqual([]);
  }

  if (before !== undefined) process.env.LIVE_CONNECTORS = before;
});

/* ═══ the blocker addresses the right reader ══════════════════════════════ */

test('blockers point a brand operator at their own Connections page', () => {
  const src = code();
  // The sibling said "Set <X> in Vercel env", which an operator using this
  // platform cannot act on — they do not have the deployment.
  expect(src).toMatch(/Connections page/);
  expect(src).not.toMatch(/in Vercel env\.`\)/);
});

/* ═══ the route resolves the brand for real ═══════════════════════════════ */

test('the route resolves the brand through a function that exists', () => {
  // brandForWorkspace lives on workspace-scope, not brand-runtime. Calling it
  // on the wrong module inside a try/catch would silently pass brand:null
  // forever and quietly defeat the whole fix.
  const brain = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
  const block = brain.slice(brain.indexOf("case 'platform-agents'"), brain.indexOf("case 'journey'"));
  expect(block).toMatch(/workspace-scope\.js/);
  expect(block).toMatch(/brandForWorkspace\(/);

  const scope = require(path.join(ROOT, 'api', '_shared', 'workspace-scope.js'));
  expect(typeof scope.brandForWorkspace).toBe('function');
});
