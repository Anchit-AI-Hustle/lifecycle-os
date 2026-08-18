'use strict';
/**
 * demo-mode.js — what the platform shows before anyone has set up a brand.
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES. Until a workspace is active there are two bad
 * answers and this platform has given both at different times:
 *
 *   show tenant zero's data   the original bug. A new operator opened /social
 *                             and saw another company's products, with that
 *                             company's real product URLs. Fixed, repeatedly.
 *   show nothing              the current behaviour. Correct, and it makes the
 *                             app impossible to evaluate: every page is empty
 *                             and nothing demonstrates what the feature does.
 *
 * The third answer is a DEMO BRAND: synthetic, obviously synthetic, and
 * labelled as such on every value it produces.
 *
 * ── THE RULES THAT KEEP THIS SAFE ──────────────────────────────────────────
 *
 * 1. THE BRANDS ARE INVENTED. Northmark Supply, Clearwater Daily and Solvent
 *    do not exist. Using a REAL company here would put another business's name
 *    and colours in front of an operator as though this platform had data about
 *    them, which is the exact failure check-foreign-brands.js exists to catch.
 *
 * 2. EVERY DEMO VALUE CARRIES ITS BRAND NAME. An example mailer says it is for
 *    Northmark Supply. That is what makes it unmistakably an example rather
 *    than something the operator half-remembers configuring.
 *
 * 3. `demo: true` RIDES ON EVERY RECORD, and `mode: 'demo'` on every envelope.
 *    A caller cannot accidentally treat this as real data without ignoring a
 *    field that is present on every single row.
 *
 * 4. NOTHING IS WRITTEN. Demo mode is computed per request and never persisted,
 *    so it cannot end up in a workspace's tables, in a dispatch job, or in an
 *    export. There is no code path from here into anything that sends.
 *
 * 5. IT DISAPPEARS THE MOMENT A BRAND EXISTS. `isDemo()` is false as soon as a
 *    workspace resolves, so this can never mask a real brand's empty state -
 *    which would hide a genuine sync failure behind pleasant fake numbers.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

/**
 * Three sectors on purpose. A single commerce example teaches an operator that
 * this is a commerce tool, and the lifecycle mechanics of a publisher (renewals,
 * not restocks) and of B2B SaaS (trials and seats) are genuinely different.
 */
const DEMO_BRANDS = [
  {
    id: 'demo-northmark',
    slug: 'northmark-supply',
    name: 'Northmark Supply',
    sector: 'D2C commerce',
    tagline: 'Field-tested gear for people who are outside anyway.',
    website: 'https://example.com/northmark',
    palette: {
      primary: '#1F5F4B', accent: '#C2622D', ink: '#16211D', surface: '#FFFFFF',
      surface_alt: '#F4F7F5', muted: '#5A6B64', line: '#DDE5E1',
      ok: '#1a7f37', warn: '#8a6d1f', err: '#b3261e',
    },
    typography: { heading: 'Georgia, serif', body: 'system-ui, sans-serif' },
    voice: { tone: 'Plain, practical, unshowy. Explains the trade-off rather than selling past it.' },
    offering_kinds: ['product'],
    catalog: [
      { kind: 'product', name: 'Ridgeline 30L Pack', price: '148.00', currency: 'USD' },
      { kind: 'product', name: 'Fell Merino Base Layer', price: '92.00', currency: 'USD' },
      { kind: 'product', name: 'Tarn Insulated Flask', price: '34.00', currency: 'USD' },
      { kind: 'product', name: 'Coastal Shell Jacket', price: '265.00', currency: 'USD' },
    ],
    cohorts: ['First purchase, 0-30 days', 'Repeat buyer', 'Lapsed 90 days', 'High value'],
  },
  {
    id: 'demo-clearwater',
    slug: 'clearwater-daily',
    name: 'Clearwater Daily',
    sector: 'News & publishing',
    tagline: 'The morning read for one river valley.',
    website: 'https://example.com/clearwater',
    palette: {
      primary: '#8C2233', accent: '#25506E', ink: '#1B1B1B', surface: '#FFFFFF',
      surface_alt: '#F6F4F1', muted: '#5C5C5C', line: '#E2DED8',
      ok: '#1a7f37', warn: '#8a6d1f', err: '#b3261e',
    },
    typography: { heading: 'Georgia, serif', body: 'system-ui, sans-serif' },
    voice: { tone: 'Direct and sourced. Attributes every figure and never editorialises in a headline.' },
    // A publisher sells access and attention, not SKUs. The lifecycle is
    // renewal and reading depth, which is a different calendar entirely.
    offering_kinds: ['section', 'plan'],
    catalog: [
      { kind: 'plan', name: 'Weekday digital', price: '6.00', currency: 'USD', period: 'month' },
      { kind: 'plan', name: 'Full access + archive', price: '14.00', currency: 'USD', period: 'month' },
      { kind: 'section', name: 'Council & planning' },
      { kind: 'section', name: 'River & weather' },
    ],
    cohorts: ['Trial, week 1', 'Active subscriber', 'Renewal due 14 days', 'Churned 60 days'],
  },
  {
    id: 'demo-solvent',
    slug: 'solvent',
    name: 'Solvent',
    sector: 'B2B SaaS',
    tagline: 'Reconciliation that finishes before the meeting does.',
    website: 'https://example.com/solvent',
    palette: {
      primary: '#3B3A8C', accent: '#0F7A6B', ink: '#141420', surface: '#FFFFFF',
      surface_alt: '#F5F5FA', muted: '#5B5B70', line: '#E1E1EC',
      ok: '#1a7f37', warn: '#8a6d1f', err: '#b3261e',
    },
    typography: { heading: 'system-ui, sans-serif', body: 'system-ui, sans-serif' },
    voice: { tone: 'Specific and unhurried. Leads with the mechanism, not the adjective.' },
    offering_kinds: ['plan', 'service'],
    catalog: [
      { kind: 'plan', name: 'Team', price: '49.00', currency: 'USD', period: 'seat/month' },
      { kind: 'plan', name: 'Business', price: '89.00', currency: 'USD', period: 'seat/month' },
      { kind: 'service', name: 'Migration assistance' },
    ],
    cohorts: ['Trial day 1-14', 'Activated, single seat', 'Expansion candidate', 'Renewal risk'],
  },
];

const BY_ID = new Map(DEMO_BRANDS.map((b) => [b.id, b]));

/** Marked on every record so no caller can consume one unknowingly. */
const DEMO_FLAG = { demo: true };

const NOTICE = 'Example data for a brand that does not exist. Set up your own brand and every screen switches to it.';

/**
 * Is this request running without a brand? The ONLY input is whether a
 * workspace resolved: demo mode is never a setting, so it cannot be left on.
 */
function isDemo(workspaceId) { return !workspaceId; }

/** The demo brand for a request. Stable per session hint so pages agree. */
function demoBrand(hint) {
  if (hint && BY_ID.has(String(hint))) return BY_ID.get(String(hint));
  const s = String(hint || '');
  if (s) {
    const found = DEMO_BRANDS.find((b) => b.slug === s || b.name.toLowerCase() === s.toLowerCase());
    if (found) return found;
  }
  return DEMO_BRANDS[0];
}

/**
 * Wrap any payload as a demo response. The notice and the flag are added at the
 * envelope AND on each row, because callers destructure rows out of envelopes
 * and the flag has to survive that.
 */
function envelope(payload, brand) {
  const b = brand || DEMO_BRANDS[0];
  const tag = (row) => (row && typeof row === 'object' && !Array.isArray(row)
    ? Object.assign({}, row, DEMO_FLAG, { brand: row.brand || b.name })
    : row);
  const out = { ok: true, mode: 'demo', demo: true, demo_notice: NOTICE, brand: { id: b.id, name: b.name, sector: b.sector, palette: b.palette } };
  for (const [k, v] of Object.entries(payload || {})) {
    out[k] = Array.isArray(v) ? v.map(tag) : tag(v);
  }
  return out;
}

/* ── example content, per feature ─────────────────────────────────────────── */

const DAY = 86400000;
const dayStr = (offset, from) => new Date((from || Date.now()) + offset * DAY).toISOString().slice(0, 10);

/**
 * A calendar the operator can read. Dates are relative to now so it never looks
 * stale, and every entry names the demo brand.
 */
function calendar(brand, days, now) {
  const b = brand || DEMO_BRANDS[0];
  const n = Math.min(Math.max(Number(days) || 7, 1), 90);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const cohort = b.cohorts[i % b.cohorts.length];
    const item = b.catalog[i % b.catalog.length];
    out.push({
      id: `demo-slot-${i + 1}`,
      date: dayStr(i, now),
      market: 'US',
      brand: b.name,
      cohort,
      theme: `${item.name} — ${cohort}`,
      channel: i % 4 === 3 ? 'sms' : 'email',
      status: i === 0 ? 'ready' : 'planned',
      demo: true,
    });
  }
  return out;
}

function cohorts(brand) {
  const b = brand || DEMO_BRANDS[0];
  // Sizes are ROUND and obviously illustrative. A demo that shows 31,847 reads
  // as a measurement; 4,000 reads as an example, which is what it is.
  const sizes = [4000, 12000, 6000, 1500];
  return b.cohorts.map((name, i) => ({
    key: `demo-${i + 1}`, name, brand: b.name,
    size: sizes[i % sizes.length],
    size_basis: 'illustrative example, not a measurement',
    demo: true,
  }));
}

function campaigns(brand, count) {
  const b = brand || DEMO_BRANDS[0];
  const n = Math.min(Math.max(Number(count) || 3, 1), 12);
  return Array.from({ length: n }, (_, i) => {
    const item = b.catalog[i % b.catalog.length];
    return {
      id: `demo-campaign-${i + 1}`,
      brand: b.name,
      subject: `${b.name}: ${item.name}`,
      cohort: b.cohorts[i % b.cohorts.length],
      channel: 'email',
      status: 'example',
      demo: true,
    };
  });
}

function posts(brand, count) {
  const b = brand || DEMO_BRANDS[0];
  const n = Math.min(Math.max(Number(count) || 4, 1), 20);
  const platforms = ['instagram', 'linkedin', 'facebook', 'x'];
  return Array.from({ length: n }, (_, i) => ({
    id: `demo-post-${i + 1}`,
    brand: b.name,
    platform: platforms[i % platforms.length],
    caption: `[Example for ${b.name}] ${b.catalog[i % b.catalog.length].name}`,
    status: 'example',
    demo: true,
  }));
}

/** Everything a dashboard needs, in one call. */
function overview(brand, opts) {
  const b = brand || DEMO_BRANDS[0];
  const o = opts || {};
  return envelope({
    entries: calendar(b, o.days || 7, o.now),
    cohorts: cohorts(b),
    campaigns: campaigns(b, 3),
    posts: posts(b, 4),
    catalog: b.catalog.map((c) => Object.assign({}, c, { brand: b.name, demo: true })),
  }, b);
}

module.exports = {
  DEMO_BRANDS, NOTICE, DEMO_FLAG,
  isDemo, demoBrand, envelope,
  calendar, cohorts, campaigns, posts, overview,
};
