'use strict';
/**
 * offering-kinds.js — what a brand actually SELLS or PROMOTES.
 *
 * The platform modelled a brand's catalogue as "products" only. That is a D2C
 * assumption: for a publisher the catalogue is sections and newsletters, for a
 * health vertical it is events (a marathon, a yoga day), recurring programmes
 * (a daily morning briefing, an 8-week training plan) and subscriptions. Those
 * are the things campaigns are actually built around, and a product-shaped
 * store could not hold them, so non-commerce brands had no catalogue at all.
 *
 * An OFFERING is the generic unit. Every offering has a `kind`, and the kind
 * decides which fields matter and how the lifecycle calendar treats it:
 *
 *   product    evergreen, has price/SKU                -> promote any time
 *   event      date-bound, one or recurring occurrence -> campaign ramps to the date
 *   programme  recurring cadence (daily/weekly/season) -> subscribe + retain
 *   section    an always-on content vertical           -> habit + frequency
 *   plan       a subscription or membership tier       -> convert + renew
 *   service    a booked, delivered engagement          -> enquire + schedule
 *
 * The calendar cares about ONE thing above all: whether an offering is
 * date-bound. A marathon on 15 February must ramp before it and stop after;
 * a sneaker does not. `isDateBound(kind)` is that switch.
 */

const KINDS = {
  product: {
    label: 'Product',
    hint: 'A physical or digital item with a price, e.g. a SKU in a store.',
    dateBound: false,
    // What the store states about it travels with it (2026-10-23): its own
    // page, currency, weight or size, claim phrases and metrics (rating, reads,
    // the store's popularity rank), so every asset can show them.
    fields: ['name', 'handle', 'price', 'compare_at', 'currency', 'region', 'image', 'type', 'tags', 'url', 'unit_spec', 'piece_count', 'servings', 'claims', 'metrics'],
    required: ['name'],
    lifecycle: 'Evergreen. Promote on merchandising logic, seasonality and stock.',
  },
  event: {
    label: 'Event',
    hint: 'Happens on a date: a marathon, a yoga day, a summit, an awards night, a concert.',
    dateBound: true,
    fields: ['name', 'starts_at', 'ends_at', 'venue', 'city', 'recurrence', 'registration_url', 'capacity', 'price', 'image'],
    required: ['name', 'starts_at'],
    lifecycle: 'Ramps to the date: announce, early-bird, last-call, day-of, and a post-event follow-up. Never promote after it has passed.',
  },
  programme: {
    label: 'Programme',
    hint: 'Runs on a cadence: a daily morning briefing, a weekly newsletter, an 8-week training plan.',
    dateBound: true,
    fields: ['name', 'cadence', 'starts_at', 'duration', 'signup_url', 'image'],
    required: ['name', 'cadence'],
    lifecycle: 'Acquire subscribers, then retain on cadence. Drop-off is the metric, not repeat purchase.',
  },
  section: {
    label: 'Section',
    hint: 'An always-on content vertical: Markets, Health & Fitness, Sports.',
    dateBound: false,
    fields: ['name', 'url', 'topics', 'image'],
    required: ['name'],
    lifecycle: 'Habit formation and frequency. Measured in sessions and return visits.',
  },
  story: {
    label: 'Story',
    hint: 'An article, report or story the brand publishes: what a media brand offers its readers.',
    dateBound: false,
    fields: ['name', 'url', 'image', 'type', 'author', 'read_time', 'published_at', 'topics', 'metrics'],
    required: ['name'],
    lifecycle: 'A read, then a return visit, then a subscription. Measured in reads and return visits.',
  },
  plan: {
    label: 'Plan',
    hint: 'A subscription or membership tier.',
    dateBound: false,
    fields: ['name', 'price', 'period', 'benefits', 'signup_url'],
    required: ['name'],
    lifecycle: 'Convert, onboard, renew. Churn is the metric.',
  },
  service: {
    label: 'Service',
    hint: 'A booked, delivered engagement: a custom commission, a consultation.',
    dateBound: false,
    fields: ['name', 'price_from', 'lead_time', 'enquiry_url', 'image'],
    required: ['name'],
    lifecycle: 'Enquiry to booking to delivery. Lead time drives the promise.',
  },
};

const ALL = Object.keys(KINDS);

function isKind(k) { return Object.prototype.hasOwnProperty.call(KINDS, String(k || '')); }
function isDateBound(k) { return !!(KINDS[k] && KINDS[k].dateBound); }
function spec(k) { return KINDS[k] || null; }

/* A kind word a record states that is not one of ours names one of ours
   (2026-11-08, asset brand-fit review). Every one used to become a PRODUCT: a
   news brand's "subscription" newsletter was sold with "Shop now", a studio's
   offering read "Take another look at service" and its page was dropped. Only
   words that say the kind outright; anything else is still a product. */
const KIND_ALIASES = {
  subscription: 'plan', membership: 'plan', tier: 'plan', pass: 'plan',
  article: 'story', report: 'story',
  consultation: 'service', commission: 'service', booking: 'service',
  race: 'event', conference: 'event', summit: 'event', webinar: 'event', workshop: 'event',
};
function kindOf(src) {
  const k = String((src && src.kind) || '').trim().toLowerCase();
  if (isKind(k)) return k;
  if (/^(newsletter|briefing|digest|podcast)$/.test(k)) return src.cadence ? 'programme' : 'section';
  return KIND_ALIASES[k] || 'product';
}

/** Normalise one offering; returns null if it cannot satisfy its kind's required fields. */
function normalizeOffering(input) {
  const src = input && typeof input === 'object' ? input : {};
  const kind = kindOf(src);
  const s = KINDS[kind];
  const out = { kind };
  for (const f of s.fields) if (src[f] !== undefined && src[f] !== null && src[f] !== '') out[f] = src[f];
  if (src.name && !out.name) out.name = src.name;
  // Every offering keeps the page the record gives it, whatever its kind: a
  // plan, a section or a service without its `url` sent every button to the
  // homepage and hid the page from the other-brand check.
  if (!out.url && /^https?:\/\//i.test(String(src.url || ''))) out.url = src.url;
  // Provenance travels with the offering: a claim about a real event needs one.
  if (src.source) out.source = src.source;
  for (const r of s.required) if (!out[r]) return null;
  return out;
}

/**
 * Split offerings by what the calendar needs to know. Date-bound offerings that
 * have already passed are returned separately rather than silently promoted -
 * advertising a finished marathon is worse than advertising nothing.
 */
function forCalendar(offerings, now) {
  const today = now ? new Date(now) : new Date();
  const evergreen = [];
  const upcoming = [];
  const past = [];
  for (const raw of Array.isArray(offerings) ? offerings : []) {
    const o = normalizeOffering(raw);
    if (!o) continue;
    if (!isDateBound(o.kind)) { evergreen.push(o); continue; }
    const when = o.starts_at ? new Date(o.starts_at) : null;
    if (!when || isNaN(when.getTime())) { evergreen.push(o); continue; }
    (when >= today ? upcoming : past).push(o);
  }
  upcoming.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  return { evergreen, upcoming, past };
}

// The page an offering sends a reader to, by its kind's own field.
function pageOf(o) {
  if (!o) return '';
  for (const f of ['url', 'registration_url', 'signup_url', 'enquiry_url', 'product_url']) if (/^https?:\/\//i.test(String(o[f] || ''))) return String(o[f]);
  return '';
}

module.exports = { KINDS, ALL, isKind, isDateBound, spec, normalizeOffering, forCalendar, pageOf };
