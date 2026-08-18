// Domain naming, adapted from Google's ADK marketing-agency sample — with its
// availability check replaced.
//
// The sample decides whether a domain is free by GOOGLE-SEARCHING it and
// treating a thin result page as available. That is wrong in both directions:
// a parked or defensively-held domain returns nothing and reads as free, while
// an unregistered name that happens to match a known company returns a full
// page and gets discarded. Registration state is a registry question, so this
// uses RDAP (RFC 7482/9082) and reports anything it could not determine as
// UNKNOWN rather than as available.
//
// Run: npx playwright test tests/domain-intel.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const domain = require(path.join(ROOT, 'api', '_shared', 'domain-intel.js'));

/* ── a stubbed registry, so the state machine is testable without a network ── */

function withFetch(impl, fn) {
  const real = global.fetch;
  global.fetch = impl;
  return Promise.resolve(fn()).finally(() => { global.fetch = real; });
}
const reply = (status, body) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

/* ═══ the three answers, and only three ═══════════════════════════════════ */

test('RDAP 404 means the registry holds nothing: available', async () => {
  await withFetch(reply(404, null), async () => {
    const out = await domain.availability('some-unregistered-name.com');
    expect(out.state).toBe('available');
    expect(out.method).toBe('rdap');
  });
});

test('RDAP 200 means registered, with whatever the registry disclosed', async () => {
  await withFetch(reply(200, {
    events: [{ eventAction: 'expiration', eventDate: '2027-04-01T00:00:00Z' }],
    entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar']]] }],
  }), async () => {
    const out = await domain.availability('example.com');
    expect(out.state).toBe('registered');
    expect(out.registrar).toBe('Example Registrar');
    expect(out.expires).toBe('2027-04-01T00:00:00Z');
  });
});

test('any other status is UNKNOWN, never available', async () => {
  // A rate limit or a registry outage says nothing about the domain. Reporting
  // it as free is how somebody designs a brand around a name they cannot buy.
  for (const status of [429, 500, 503, 403, 400]) {
    await withFetch(reply(status, null), async () => {
      const out = await domain.availability('whatever.com');
      expect(out.state, `status ${status} must not resolve to a verdict`).toBe('unknown');
      expect(out.detail).toMatch(/not the same as available/i);
    });
  }
});

test('a network failure is unknown, and says why DNS silence is not proof', async () => {
  await withFetch(async () => { throw new Error('ECONNREFUSED'); }, async () => {
    const out = await domain.availability('unreachable-check.com');
    // DNS can prove a domain EXISTS; it can never prove one is free, because
    // parked and freshly registered domains publish no records.
    expect(out.state).toBe('unknown');
    expect(out.detail).toMatch(/parked and newly registered/i);
  });
});

test('a malformed input is rejected rather than looked up', async () => {
  for (const bad of ['', 'not a domain', 'http://', 'x', null]) {
    const out = await domain.availability(bad);
    expect(out.state).toBe('unknown');
  }
});

test('a batch reports its unknowns instead of burying them', async () => {
  let n = 0;
  await withFetch(async () => {
    n += 1;
    if (n === 1) return { status: 404, ok: false, json: async () => null };
    if (n === 2) return { status: 200, ok: true, json: async () => ({}) };
    return { status: 429, ok: false, json: async () => null };
  }, async () => {
    const out = await domain.checkMany(['a.com', 'b.com', 'c.com'], { gapMs: 0 });
    expect(out.summary).toEqual({ available: 1, registered: 1, unknown: 1 });
    expect(out.note).toMatch(/not as available/i);
  });
});

/* ═══ candidates come from the brand, not from thin air ═══════════════════ */

const BRAND = {
  name: 'Northmark Supply',
  industry: 'outdoor equipment',
  offerings: [{ name: 'trail packs' }, { name: 'insulated flasks' }],
};

test('candidates are derived from the brand record', () => {
  const out = domain.suggest(BRAND, { count: 12 });
  expect(out.ok).toBe(true);
  expect(out.derived_from).toContain('northmark');
  expect(out.derived_from).toContain('trail');
  // Every candidate is a real domain shape, and each says where it came from.
  for (const c of out.candidates) {
    expect(c.domain).toMatch(/^[a-z0-9-]+\.[a-z]+$/);
    expect(c.why).toBeTruthy();
  }
});

test('a brand with nothing recorded gets a marker, not invented names', () => {
  const out = domain.suggest(null);
  expect(out.ok).toBe(false);
  expect(out.candidates).toEqual([]);
  expect(out.note).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
});

test('suggestions are stable for the same brand', () => {
  // A reshuffle on every visit makes the list feel arbitrary and makes a
  // half-finished choice impossible to return to.
  const a = domain.suggest(BRAND, { count: 20 }).candidates.map((c) => c.domain);
  const b = domain.suggest(BRAND, { count: 20 }).candidates.map((c) => c.domain);
  expect(a).toEqual(b);
});

test('nothing is claimed about availability at suggestion time', () => {
  const out = domain.suggest(BRAND, {});
  for (const c of out.candidates) {
    expect(c).not.toHaveProperty('available');
    expect(c).not.toHaveProperty('state');
  }
  expect(out.note).toMatch(/has been checked yet|separate, authoritative step/i);
});

test('the module does not decide availability from a search engine', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'domain-intel.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  // The sample's approach, explicitly not carried over.
  expect(src).not.toMatch(/google\.com\/search|googleapis\.com\/customsearch|bing\.com/i);
  expect(src).toMatch(/rdap/i);
});

/* ═══ a domain is a sending asset here ════════════════════════════════════ */

test('sending readiness is wired to the deliverability engine', async () => {
  const out = await domain.sendingReadiness('not a domain at all');
  expect(out.ok).toBe(false);
});

test('readiness names the records that are missing, with a reason each', async () => {
  const deliver = require(path.join(ROOT, 'api', '_shared', 'deliverability-core.js'));
  const real = deliver.auditDomain;
  deliver.auditDomain = async () => ({
    ok: true,
    domain: 'mail.example.com',
    score: 40,
    grade: 'D',
    score_breakdown: { partial: false },
    records: [
      { type: 'SPF', found: true, passed: true },
      { type: 'DKIM', found: false, passed: false },
      { type: 'DMARC', found: false, passed: false },
      { type: 'MX', found: true, passed: true },
      { type: 'BIMI', found: false, passed: false },
    ],
    blacklists: { checked: true, listed: [] },
  });

  const out = await domain.sendingReadiness('mail.example.com');
  expect(out.ok).toBe(true);
  expect(out.to_do.map((t) => t.record).sort()).toEqual(['DKIM', 'DMARC']);
  for (const t of out.to_do) expect(t.why).toBeTruthy();
  expect(out.verdict).toMatch(/not ready to send/i);

  deliver.auditDomain = real;
});

/* ═══ the logo brief ══════════════════════════════════════════════════════ */

const { logoBrief, initials } = require(path.join(ROOT, 'api', '_shared', 'logo-brief.js'));

const LOGO_BRAND = {
  name: 'Northmark Supply',
  industry: 'outdoor equipment',
  palette: { primary: '#1F4B3F', accent: '#D98F2B', ink: '#111111', surface: '#FFFFFF' },
  typography: { heading: 'Söhne' },
  offerings: [{ name: 'trail packs' }],
};

test('the logo brief names the brand palette by exact value', () => {
  // "On brand" means nothing to an image model.
  const out = logoBrief(LOGO_BRAND, { style: 'mark' });
  expect(out.ok).toBe(true);
  expect(out.prompt).toContain('#1F4B3F');
  expect(out.prompt).toContain('#D98F2B');
});

test('a brand with no colour gets black and white, not an invented hue', () => {
  const out = logoBrief({ name: 'X', industry: 'y' });
  expect(out.prompt).toMatch(/single flat black on white/i);
  expect(out.prompt).toMatch(/Do not invent a brand colour/i);
  expect(out.missing.join(' ')).toMatch(/DATA REQUIRED BEFORE LAUNCH: brand primary colour/);
});

test('a mark carries no lettering, and a wordmark states the exact string', () => {
  // Image models deform letterforms, so a mark is the safe default and any
  // lettering has to be pinned.
  expect(logoBrief(LOGO_BRAND, { style: 'mark' }).prompt).toMatch(/carries NO lettering/);
  expect(logoBrief(LOGO_BRAND, { style: 'wordmark' }).prompt).toContain('must read exactly "Northmark Supply"');
  expect(logoBrief(LOGO_BRAND, { style: 'monogram' }).prompt).toContain('must read exactly "NS"');
  expect(initials('Northmark Supply')).toBe('NS');
});

test('the brief forbids what makes a logo unusable', () => {
  const p = logoBrief(LOGO_BRAND, {}).prompt;
  for (const rule of [/no photographic/i, /no 3D/i, /no gradients/i, /single colour|one-colour/i, /16 pixels/]) {
    expect(p).toMatch(rule);
  }
});

test('no brand means no logo, and a reason', () => {
  const out = logoBrief(null);
  expect(out.ok).toBe(false);
  expect(out.note).toMatch(/no identity to design for/i);
  expect(out.prompt).toBeUndefined();
});

test('an unknown style falls back to a mark rather than erroring', () => {
  expect(logoBrief(LOGO_BRAND, { style: 'holographic' }).style).toBe('mark');
});
