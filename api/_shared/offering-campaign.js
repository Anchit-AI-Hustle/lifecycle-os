'use strict';
/**
 * offering-campaign.js — turn ANY offering into campaign mechanics.
 *
 * The generator assumed the thing being promoted is a PRODUCT: it built a
 * `heroProduct`, wrote "Shop the edit", and framed copy around owning an item.
 * That is wrong for most of the platform's brands. A marathon is not shopped,
 * it is REGISTERED FOR, and the campaign has to ramp toward its date and stop
 * afterwards. A daily briefing is SUBSCRIBED to. A section is READ.
 *
 * This module is the single place that decides, for one offering on one send
 * date: which phase the campaign is in, what the call to action actually is,
 * what urgency is honest, and what the prompt must be told.
 *
 * The load-bearing rule: a date-bound offering whose date has PASSED returns
 * `viable: false`. Advertising a finished event is worse than sending nothing,
 * so the caller must skip the slot rather than generate for it.
 */

const KINDS = require('./offering-kinds.js');

const DAY = 86400000;

/** Whole days from sendDate to the offering's date (negative = already past). */
function daysUntil(startsAt, sendDate) {
  if (!startsAt) return null;
  const start = new Date(startsAt);
  const send = sendDate ? new Date(sendDate) : new Date();
  if (isNaN(start.getTime()) || isNaN(send.getTime())) return null;
  const a = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const b = Date.UTC(send.getUTCFullYear(), send.getUTCMonth(), send.getUTCDate());
  return Math.round((a - b) / DAY);
}

/**
 * Event ramp. Each phase changes the JOB of the send, not just its wording:
 * announce builds awareness, early-bird converts intent, last-call closes,
 * day-of drives attendance, follow-up retains for next time.
 */
const EVENT_PHASES = [
  { id: 'save-the-date', min: 45, max: Infinity, job: 'Build awareness and get the date into their calendar.', cta: 'Save the date', urgency: 'none' },
  { id: 'announce',      min: 15, max: 44,  job: 'Announce properly: what it is, who it is for, why attend.', cta: 'See the details', urgency: 'none' },
  { id: 'early-bird',    min: 8,  max: 14,  job: 'Convert intent while there is comfortable time to decide.', cta: 'Register now', urgency: 'soft' },
  { id: 'last-call',     min: 2,  max: 7,   job: 'Close the undecided. Registration is about to end.', cta: 'Register before it closes', urgency: 'real' },
  { id: 'day-before',    min: 1,  max: 1,   job: 'Practical: timing, venue, what to bring. Drive turnout.', cta: 'Get ready', urgency: 'real' },
  { id: 'day-of',        min: 0,  max: 0,   job: 'It is today. Logistics and encouragement only, no selling.', cta: 'Join today', urgency: 'real' },
  { id: 'follow-up',     min: -7, max: -1,  job: 'Thank attendees, share results, point at what is next.', cta: 'See how it went', urgency: 'none' },
];

function eventPhase(days) {
  if (days === null) return null;
  return EVENT_PHASES.find((p) => days >= p.min && days <= p.max) || null;
}

const KIND_DEFAULTS = {
  product:   { cta: 'Shop now',        verb: 'buy',       noun: 'product' },
  event:     { cta: 'Register now',    verb: 'register for', noun: 'event' },
  programme: { cta: 'Subscribe',       verb: 'subscribe to', noun: 'programme' },
  section:   { cta: 'Start reading',   verb: 'read',      noun: 'section' },
  plan:      { cta: 'See plans',       verb: 'subscribe to', noun: 'plan' },
  service:   { cta: 'Start your brief', verb: 'commission', noun: 'service' },
};

/**
 * Plan one send for one offering.
 * @returns {{viable:boolean, reason?:string, kind:string, phase:string, job:string,
 *            cta:string, cta_url:string|null, urgency:string, days_until:number|null,
 *            promptLines:string[]}}
 */
function planSend(offering, sendDate) {
  const o = KINDS.normalizeOffering(offering);
  if (!o) {
    return { viable: false, reason: 'offering is missing the fields its kind requires', kind: null, promptLines: [] };
  }
  const kind = o.kind;
  const base = KIND_DEFAULTS[kind] || KIND_DEFAULTS.product;
  const dateBound = KINDS.isDateBound(kind);
  const days = dateBound ? daysUntil(o.starts_at, sendDate) : null;

  // A finished event must never be promoted. Follow-up is a deliberate, bounded
  // window (up to 7 days after); beyond that the slot is simply not viable.
  if (kind === 'event' && days !== null && days < -7) {
    return {
      viable: false,
      reason: `"${o.name}" happened on ${String(o.starts_at).slice(0, 10)}, ${Math.abs(days)} days before this send. A past event is never promoted; pick another offering or drop the slot.`,
      kind, days_until: days, promptLines: [],
    };
  }

  const phase = kind === 'event' ? eventPhase(days) : null;
  const cta = (phase && phase.cta) || base.cta;
  const ctaUrl = o.registration_url || o.signup_url || o.enquiry_url || o.url || null;

  const lines = [];
  lines.push(`- Offering: ${o.name} (kind: ${kind}${o.city ? `, ${o.city}` : ''})`);
  if (kind === 'event') {
    lines.push(`- Event date: ${String(o.starts_at).slice(0, 10)}${o.venue ? ` at ${o.venue}` : ''} — ${days} day(s) after this send.`);
    lines.push(`- Campaign phase: ${phase ? phase.id : 'unscheduled'}. Job of THIS send: ${phase ? phase.job : 'introduce the event'}`);
    lines.push('- This is an EVENT, not a product. Do not write shopping copy, prices as the hook, or "buy". The reader is deciding whether to ATTEND.');
    if (phase && phase.urgency === 'real') {
      lines.push('- Urgency is REAL here and comes from the date itself. State the date plainly; never invent scarcity beyond it.');
    } else {
      lines.push('- Do NOT manufacture urgency: the date is far enough away that pressure would be dishonest.');
    }
    if (phase && phase.id === 'follow-up') {
      lines.push('- The event has already happened. Thank people and report what occurred. Never invite registration for a finished event.');
    }
  } else if (kind === 'programme') {
    lines.push(`- Cadence: ${o.cadence || 'recurring'}${o.duration ? `, running ${o.duration}` : ''}.`);
    lines.push('- This is a RECURRING PROGRAMME. The ask is a commitment to a habit, not a one-off purchase. Sell the routine and what changes by the end.');
  } else if (kind === 'section') {
    lines.push('- This is a CONTENT SECTION. The ask is a read and a return visit. No price, no purchase language.');
  } else if (kind === 'plan') {
    lines.push(`- This is a SUBSCRIPTION PLAN${o.period ? ` (${o.period})` : ''}. Lead with what access unlocks; renewal matters more than first sale.`);
  } else if (kind === 'service') {
    lines.push(`- This is a SERVICE${o.lead_time ? `, lead time ${o.lead_time}` : ''}. The ask is an enquiry or brief, not an instant checkout. Set the delivery expectation honestly.`);
  } else {
    lines.push('- This is a PRODUCT. Standard merchandising applies.');
  }
  lines.push(`- Call to action MUST be "${cta}"${ctaUrl ? ` linking to ${ctaUrl}` : ' (no URL supplied: write the CTA as plain text, never invent a link)'}.`);

  return {
    viable: true, kind,
    phase: phase ? phase.id : (dateBound ? 'recurring' : 'evergreen'),
    job: phase ? phase.job : `Drive the reader to ${base.verb} this ${base.noun}.`,
    cta, cta_url: ctaUrl,
    urgency: phase ? phase.urgency : 'none',
    days_until: days,
    offering: o,
    promptLines: lines,
  };
}

/**
 * Pick the best offering for a send date: the nearest viable upcoming
 * date-bound offering wins (its window is the one that closes), otherwise an
 * evergreen one. Returns null when the brand has nothing promotable.
 */
function pickForDate(offerings, sendDate) {
  const split = KINDS.forCalendar(offerings, sendDate);
  const dated = split.upcoming
    .map((o) => planSend(o, sendDate))
    .filter((p) => p.viable && p.phase !== 'unscheduled');
  if (dated.length) {
    dated.sort((a, b) => (a.days_until ?? 1e9) - (b.days_until ?? 1e9));
    return dated[0];
  }
  for (const o of split.evergreen) {
    const p = planSend(o, sendDate);
    if (p.viable) return p;
  }
  return null;
}

module.exports = { planSend, pickForDate, daysUntil, eventPhase, EVENT_PHASES, KIND_DEFAULTS };
