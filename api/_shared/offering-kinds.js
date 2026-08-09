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
    fields: ['name', 'handle', 'price', 'compare_at', 'image', 'type', 'tags'],
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

/** Normalise one offering; returns null if it cannot satisfy its kind's required fields. */
function normalizeOffering(input) {
  const src = input && typeof input === 'object' ? input : {};
  const kind = isKind(src.kind) ? src.kind : 'product';
  const s = KINDS[kind];
  const out = { kind };
  for (const f of s.fields) if (src[f] !== undefined && src[f] !== null && src[f] !== '') out[f] = src[f];
  if (src.name && !out.name) out.name = src.name;
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

module.exports = { KINDS, ALL, isKind, isDateBound, spec, normalizeOffering, forCalendar };
