// The last three ported modules, plus the guard for the mistake I kept making.
//
// Twice while porting I mounted a route that called a function which did not
// exist — `runtime.brandForWorkspace` (it lives on workspace-scope) and
// `dailyView` / `analyse` / `handle` (the real names are dayCalendar / revenue /
// runTool). Both were inside try/catch or simply never exercised, so every
// existing test still passed and the route would have failed only in production.
//
// The last test in this file walks every `require('./_shared/x.js').fn(` call in
// api/brain.js and asserts the function is really exported. That is the general
// form of the bug, not the two instances of it.
//
// Run: npx playwright test tests/ported-modules.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const shared = (n) => require(path.join(ROOT, 'api', '_shared', n));

/* ═══ nothing carried another company across ══════════════════════════════ */

const PORTED = [
  'shopify-core.js', 'journey-core.js', 'platform-agents-core.js',
  'reference-intel.js', 'daily-calendar-core.js', 'revenue-analysis-core.js',
  'agent-builder-core.js',
];

test('no ported module names the sibling company', () => {
  // Assembled, not written out: tests/ ships inside the deployed output root.
  const token = ['vah', 'dam'].join('');
  for (const f of PORTED) {
    const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', f), 'utf8').toLowerCase();
    expect(src.includes(token), `${f} still names the sibling`).toBe(false);
  }
});

test('no ported module points at another deployment', () => {
  // The Agent Builder spec defaulted its server URL to the sibling's production
  // host. Emitted, it would have told a customer's agent to call another
  // company's infrastructure.
  for (const f of PORTED) {
    const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', f), 'utf8');
    const hosts = [...src.matchAll(/https:\/\/([a-z0-9-]+)\.vercel\.app/gi)].map((m) => m[1]);
    for (const h of hosts) {
      expect(h.includes(['vah', 'dam'].join('')), `${f} hardcodes ${h}.vercel.app`).toBe(false);
    }
  }
});

test('blockers address the operator, not the deployment owner', () => {
  // "Set X in Vercel env" is not actionable by a brand operator using a hosted
  // platform: they do not have the deployment.
  for (const f of PORTED) {
    const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', f), 'utf8');
    expect(src, `${f} still tells the reader to edit Vercel env`).not.toMatch(/in Vercel env/);
  }
});

/* ═══ Agent Builder refuses rather than guessing ══════════════════════════ */

test('the OpenAPI spec refuses to emit without a resolvable origin', () => {
  const ab = shared('agent-builder-core.js');
  const before = { a: process.env.AGENT_BUILDER_PUBLIC_ORIGIN, v: process.env.VERCEL_URL, p: process.env.PUBLIC_BASE_URL };
  delete process.env.AGENT_BUILDER_PUBLIC_ORIGIN;
  delete process.env.VERCEL_URL;
  delete process.env.PUBLIC_BASE_URL;

  const out = ab.openApiSpec({});
  expect(out.ok).toBe(false);
  expect(out.error).toBe('agent_builder_origin_unresolved');

  if (before.a) process.env.AGENT_BUILDER_PUBLIC_ORIGIN = before.a;
  if (before.v) process.env.VERCEL_URL = before.v;
  if (before.p) process.env.PUBLIC_BASE_URL = before.p;
});

test('the spec is titled for the resolved brand, and for nobody when unresolved', () => {
  const ab = shared('agent-builder-core.js');
  const withBrand = ab.openApiSpec({ origin: 'https://x.example.com', brand: { name: 'Northmark Supply' } });
  expect(withBrand.info.title).toContain('Northmark Supply');

  const without = ab.openApiSpec({ origin: 'https://x.example.com' });
  // Generic, never a brand picked on the caller's behalf: an LLM reads this
  // title and then speaks as whoever it names.
  expect(without.info.title).toBe('Lifecycle OS — growth tools');
});

test('the bridge is closed until a key is set', () => {
  const ab = shared('agent-builder-core.js');
  const before = process.env.AGENT_BUILDER_API_KEY;
  delete process.env.AGENT_BUILDER_API_KEY;
  const gate = ab.authorize({ headers: {} });
  // An unauthenticated business-data endpoint is worse than no integration.
  expect(gate.ok).toBe(false);
  expect(gate.status).toBe(503);
  if (before !== undefined) process.env.AGENT_BUILDER_API_KEY = before;
});

test('mutating tools are not exposed without an explicit opt-in', () => {
  const ab = shared('agent-builder-core.js');
  const before = process.env.AGENT_BUILDER_ALLOW_WRITES;
  delete process.env.AGENT_BUILDER_ALLOW_WRITES;
  // An external agent steered by whoever is talking to it must not be able to
  // generate campaigns or spend model quota.
  for (const t of ab.exposedTools()) expect(t.mutates, `${t.name} is mutating and exposed`).toBeFalsy();
  if (before !== undefined) process.env.AGENT_BUILDER_ALLOW_WRITES = before;
});

/* ═══ the general form of the bug I kept shipping ═════════════════════════ */

test('every _shared function api/brain.js calls actually exists', () => {
  const brain = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
  // require('./_shared/<mod>.js').<fn>(
  const calls = [...brain.matchAll(/require\('\.\/_shared\/([a-z0-9-]+\.js)'\)\.([A-Za-z_$][\w$]*)\s*\(/g)]
    .map((m) => ({ mod: m[1], fn: m[2] }));
  expect(calls.length, 'the scan found no calls, so it is proving nothing').toBeGreaterThan(5);

  const missing = [];
  for (const c of calls) {
    let mod;
    try { mod = shared(c.mod); } catch (e) { missing.push(`${c.mod} does not load: ${e.message}`); continue; }
    if (typeof mod[c.fn] !== 'function') missing.push(`${c.mod} exports no ${c.fn}()`);
  }
  // A route calling a name that does not exist fails only in production, and
  // inside a try/catch it fails silently forever.
  expect([...new Set(missing)]).toEqual([]);
});

test('every ported module loads', () => {
  for (const f of PORTED) expect(() => shared(f), `${f} does not load`).not.toThrow();
});
