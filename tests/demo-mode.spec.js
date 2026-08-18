// What the platform shows before anyone has set up a brand.
//
// Two failures bracket this feature, and it has to avoid BOTH:
//
//   showing tenant zero's data   the original bug, hit repeatedly: a new
//                                operator saw another company's products with
//                                that company's real URLs
//   showing nothing              correct, and it made the app impossible to
//                                evaluate - every page empty, nothing to see
//
// Demo mode is the third answer, and these tests are the guardrails that stop
// it becoming either of the first two.
//
// Run: npx playwright test tests/demo-mode.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const demo = require(path.join(ROOT, 'api', '_shared', 'demo-mode.js'));
const runtime = require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js'));

/* ═══ the brands are invented ═════════════════════════════════════════════ */

test('no demo brand is a real company, and none is tenant zero', () => {
  const zero = runtime.defaultBrand();
  const zeroName = String(zero.name || '').toLowerCase();
  for (const b of demo.DEMO_BRANDS) {
    expect(b.name.toLowerCase(), 'a demo brand must not be tenant zero').not.toBe(zeroName);
    // example.com is reserved by RFC 2606 precisely so it can be used here.
    expect(b.website, `${b.name} must not point at a real domain`).toMatch(/^https:\/\/example\.com\//);
  }
});

test('no demo value is borrowed from tenant zero', () => {
  const zero = runtime.defaultBrand();
  const zeroTokens = [
    ...(zero.claims || []).map((c) => String((c && c.text) || c)),
    ...((zero.catalog || []).map((p) => p && p.name).filter(Boolean)),
    String(zero.tagline || ''),
  ].filter((s) => s && s.length > 8).map((s) => s.toLowerCase());

  const blob = JSON.stringify(demo.DEMO_BRANDS).toLowerCase();
  for (const t of zeroTokens) {
    expect(blob.includes(t), `a demo brand reuses tenant zero's "${t.slice(0, 40)}"`).toBe(false);
  }
});

test('every demo brand ships a light surface and a distinct primary', () => {
  // The palette gate blocks dark-neutral surfaces on activation; a demo brand
  // that could not itself be activated would be teaching the wrong thing.
  for (const b of demo.DEMO_BRANDS) {
    expect(b.palette.surface.toUpperCase()).toBe('#FFFFFF');
    expect(b.palette.primary).not.toBe(b.palette.ink);
    expect(b.palette.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
  }
});

test('the demo set covers more than commerce', () => {
  // One commerce example teaches an operator this is a commerce tool. A
  // publisher renews and a SaaS expands; those are different calendars.
  const sectors = new Set(demo.DEMO_BRANDS.map((b) => b.sector));
  expect(sectors.size).toBeGreaterThan(2);
  const kinds = new Set(demo.DEMO_BRANDS.flatMap((b) => b.offering_kinds));
  expect(kinds.has('product')).toBe(true);
  expect(kinds.has('plan')).toBe(true);
});

/* ═══ every value announces itself ════════════════════════════════════════ */

test('every row is flagged demo and names its own brand', () => {
  for (const b of demo.DEMO_BRANDS) {
    const out = demo.overview(b, { days: 5 });
    expect(out.mode).toBe('demo');
    expect(out.demo).toBe(true);
    expect(out.demo_notice).toMatch(/does not exist/i);
    for (const key of ['entries', 'cohorts', 'campaigns', 'posts', 'catalog']) {
      expect(out[key].length, `${b.name}.${key} should not be empty`).toBeGreaterThan(0);
      for (const row of out[key]) {
        // Callers destructure rows out of envelopes, so the flag has to be on
        // the row, not only on the wrapper.
        expect(row.demo, `${b.name}.${key} row is not flagged`).toBe(true);
        expect(row.brand, `${b.name}.${key} row does not name its brand`).toBe(b.name);
      }
    }
  }
});

test('a demo audience size is labelled illustrative, not measured', () => {
  // Inventing a segment size is the exact fabrication the campaign spec bans.
  // A round number plus an explicit basis is an example; 31,847 is a claim.
  for (const c of demo.cohorts(demo.DEMO_BRANDS[0])) {
    expect(c.size_basis).toMatch(/illustrative/i);
    expect(c.size % 500, 'a demo size should be round enough to read as an example').toBe(0);
  }
});

/* ═══ it vanishes the moment a brand exists ═══════════════════════════════ */

test('demo mode is off as soon as a workspace resolves', () => {
  expect(demo.isDemo(null)).toBe(true);
  expect(demo.isDemo('')).toBe(true);
  expect(demo.isDemo('4f1c9a2e-0000-0000-0000-000000000000')).toBe(false);
});

test('demo mode is not a setting, so it cannot be left switched on', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'demo-mode.js'), 'utf8');
  const fn = src.slice(src.indexOf('function isDemo'), src.indexOf('function demoBrand'));
  // Its only input is the workspace id. An env var or a flag here would let a
  // real brand's empty state be masked by pleasant fake numbers.
  expect(fn).not.toMatch(/process\.env/);
  expect(fn).toMatch(/return\s+!workspaceId/);
});

/* ═══ nothing here can act ════════════════════════════════════════════════ */

test('demo mode never writes and never sends', () => {
  // Comments have to be stripped first. The module's own header explains that
  // nothing here can reach "a dispatch job", and a scan that reads prose fails
  // on the sentence promising the property it is checking for.
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'demo-mode.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
  for (const forbidden of ['fetch(', 'supa', 'dispatch', 'insert', 'restAs', 'process.env']) {
    expect(src.toLowerCase().includes(forbidden.toLowerCase()), `demo-mode code must not reference ${forbidden}`).toBe(false);
  }
});

test('an action that generates or sends refuses instead of pretending', () => {
  // Simulating a send is worse than refusing one: it teaches an operator the
  // thing works before it can.
  const brain = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
  const block = brain.slice(brain.indexOf('workspace_unresolved') - 2000, brain.indexOf('workspace_unresolved') + 2000);
  expect(block).toMatch(/const WRITES\s*=/);
  expect(block).toMatch(/no_active_brand/);
  expect(block).toMatch(/setup_url/);

  const WRITES = /^(generate|dispatch-|deliverability-|cohort-optimize|agentic-run|social-run|calendar-generate|decide|feedback|recalibrate|approve|reject|asset|video-|tts|snowflake-sync|os-run|agent-upsert|agent-sync)/;
  for (const a of ['agentic-run', 'dispatch-enqueue', 'generate', 'video-generate', 'calendar-generate']) {
    expect(WRITES.test(a), `${a} must not be served as demo data`).toBe(true);
  }
  for (const a of ['cohorts', 'calendar', 'social-list', 'campaigns', 'benchmarks']) {
    expect(WRITES.test(a), `${a} should be readable in demo mode`).toBe(false);
  }
});

/* ═══ the calendar is usable ══════════════════════════════════════════════ */

test('the demo calendar honours the requested window and never looks stale', () => {
  const now = Date.parse('2026-08-18T00:00:00Z');
  const rows = demo.calendar(demo.DEMO_BRANDS[0], 30, now);
  expect(rows).toHaveLength(30);
  expect(rows[0].date).toBe('2026-08-18');
  expect(rows[29].date).toBe('2026-09-16');
  // Dates are relative to now, so a demo never shows last year's plan.
  const live = demo.calendar(demo.DEMO_BRANDS[0], 3);
  expect(live[0].date).toBe(new Date().toISOString().slice(0, 10));
});

test('the demo calendar is bounded', () => {
  expect(demo.calendar(demo.DEMO_BRANDS[0], 5000).length).toBeLessThanOrEqual(90);
  expect(demo.calendar(demo.DEMO_BRANDS[0], 0).length).toBeGreaterThan(0);
  expect(demo.calendar(demo.DEMO_BRANDS[0], -3).length).toBeGreaterThan(0);
});

test('a named demo brand is selectable, and an unknown name falls back', () => {
  expect(demo.demoBrand('clearwater-daily').name).toBe('Clearwater Daily');
  expect(demo.demoBrand('demo-solvent').name).toBe('Solvent');
  expect(demo.demoBrand('nonsense').name).toBe(demo.DEMO_BRANDS[0].name);
  expect(demo.demoBrand('').name).toBe(demo.DEMO_BRANDS[0].name);
});
