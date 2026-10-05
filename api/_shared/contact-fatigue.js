'use strict';
/**
 * contact-fatigue.js — ONE contact policy for every channel, and the one place
 * a frequency cap is computed.
 * ---------------------------------------------------------------------------
 * The operator's roadmap: "if a user received an SMS at 10:00 AM, the
 * Algorithmic Calendar must automatically suppress scheduled marketing emails
 * or WhatsApp messages for 48 hours to prevent opt-out spikes."
 *
 * Until 2026-10-04 the cap was computed in FOUR places, each with its own
 * literals and none of them cross-channel in time:
 *   cohort-engine.js      FREQUENCY {2,3} over an ESP's `sends_7d` counter
 *   lib/smart-brain/services.js   frequency_cap {2,3} hard-coded per slot, and
 *                         a slot with no discount "did not count toward the
 *                         cap" - so a cohort could be mailed daily, every slot
 *                         SAFE, although spec §10 says caps apply to
 *                         promotional AND lifecycle marketing
 *   scenario-model.js     SEGMENT_SEND_CEILING 4 sends per segment per week,
 *                         one ABOVE the spec's absolute cap of 3
 *   the mailer calendar   no cap at all: cadence up to 7 a week per cohort
 * They all read this module now. Its storage is contact-ledger.js; this file
 * does no I/O, so the browser-free planners and the preflight gate evaluate
 * the same rules over whatever history they were handed.
 *
 * ── THE MODEL ──────────────────────────────────────────────────────────────
 * A TOUCH is one message that reached one person: channel (email | sms |
 * whatsapp | push | in_app), message class (promotional | transactional |
 * triggered-lifecycle), when, and who - a per-workspace salted SHA-256 of the
 * address or number and/or the ESP's own profile id. Never the address.
 * Touches of one person are linked across channels by ANY shared identifier,
 * so an SMS recorded by Klaviyo profile id and an email recorded by address
 * hash are one person when one record carries both.
 *
 * ── THE RULES (defaults STATED here, editable per brand within the spec) ──
 *   caps          spec §10: preferred 2, absolute 3 marketing touches per
 *                 rolling 7 days, ACROSS channels. A brand may tighten either,
 *                 never loosen: above-preferred is a per-send decision with a
 *                 recorded override, not a standing setting.
 *   classes       promotional is held to the preferred cap; a triggered
 *                 lifecycle send (cart, browse, back-in-stock - high intent by
 *                 construction) to the absolute cap; both COUNT. Transactional
 *                 is never counted and never suppressed, by anything here.
 *   cool-down     after a promotional SMS or WhatsApp, no promotional email,
 *                 WhatsApp or SMS for 48 h (the operator's rule).
 *   quiet hours   21:00-08:00 in the recipient's region, for the channels that
 *                 interrupt (SMS, WhatsApp, push) - the window US TCPA sets for
 *                 telemarketing messages. Evaluated only when the region or an
 *                 IANA zone is KNOWN; a region with several zones (US) is quiet
 *                 if it is quiet in any of them. Unknown is said, not guessed.
 *
 * ── WHAT IS NEVER SAID ─────────────────────────────────────────────────────
 * No history is "eligibility unknown — no send history", never "everyone is
 * eligible". A ledger that could not be read is "unavailable" with its reason,
 * never "0 suppressed". A count is only ever a count of rows it was handed.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');

const CHANNELS = Object.freeze(['email', 'sms', 'whatsapp', 'push', 'in_app']);
const MESSAGE_CLASSES = Object.freeze(['promotional', 'transactional', 'triggered-lifecycle']);
/** The classes the caps count (spec §10: promotional + lifecycle marketing). */
const MARKETING = Object.freeze(['promotional', 'triggered-lifecycle']);
const CHANNEL_LABEL = { email: 'email', sms: 'SMS', whatsapp: 'WhatsApp', push: 'push', in_app: 'in-app' };

const HOUR = 3600000;
const DAY = 86400000;
const WINDOW_DAYS = 7;          // spec §10: a ROLLING 7 days. Not a setting.

/** What no brand may loosen. */
const SPEC = Object.freeze({ promotional_per_7d: 2, absolute_per_7d: 3 });

function deepFreeze(o) {
  if (o && typeof o === 'object') { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

const DEFAULT_RULES = deepFreeze({
  promotional_per_7d: SPEC.promotional_per_7d,
  absolute_per_7d: SPEC.absolute_per_7d,
  class_cap: { promotional: 'preferred', 'triggered-lifecycle': 'absolute' },
  cooldowns: [{
    id: 'sms-whatsapp-promotional-48h',
    after_channels: ['sms', 'whatsapp'], after_classes: ['promotional'],
    suppress_channels: ['email', 'whatsapp', 'sms'], suppress_classes: ['promotional'],
    hours: 48,
  }],
  quiet_hours: { enabled: true, start: 21, end: 8, channels: ['sms', 'whatsapp', 'push'], classes: ['promotional', 'triggered-lifecycle'] },
  // ESP event name -> what that event MEANS (a message reached a person on a
  // channel). Empty by default: this platform does not assert any ESP's event
  // vocabulary; a brand states which of ITS events are sends.
  event_map: {},
});

/** Spec §11: the IANA zones per region. A region not listed is "unknown". */
const REGION_ZONES = deepFreeze({
  US: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'],
  UK: ['Europe/London'], GB: ['Europe/London'],
  IN: ['Asia/Kolkata'],
});

/* ── rules ────────────────────────────────────────────────────────────────── */

function int(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}
function subset(list, allowed) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const x of list) {
    const raw = String(x == null ? '' : x).toLowerCase().trim();
    const s = allowed === CHANNELS ? (channelOf(raw) || raw) : raw;
    if (allowed.indexOf(s) >= 0 && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

/**
 * A brand's stored or carried rules, held to the spec. Returns the effective
 * rules plus every place the input was not taken as asked, with why: a rule
 * this platform silently rewrote would be a rule nobody set.
 */
function normaliseRules(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = clone(DEFAULT_RULES);
  const adjustments = [];
  const note = (field, asked, used, why) => adjustments.push({ field, asked, used, why });
  const KNOWN = ['promotional_per_7d', 'absolute_per_7d', 'class_cap', 'cooldowns', 'quiet_hours', 'event_map', 'updated_at', 'updated_by'];

  if (src.absolute_per_7d !== undefined) {
    const n = int(src.absolute_per_7d);
    if (n === null || n < 0) note('absolute_per_7d', src.absolute_per_7d, out.absolute_per_7d, 'not a whole number of sends, so the default stands');
    else if (n > SPEC.absolute_per_7d) note('absolute_per_7d', n, SPEC.absolute_per_7d, `the campaign contract (spec §10) sets the absolute cap at ${SPEC.absolute_per_7d} per rolling 7 days; a brand may tighten it, never loosen it`);
    else out.absolute_per_7d = n;
  }
  if (src.promotional_per_7d !== undefined) {
    const n = int(src.promotional_per_7d);
    if (n === null || n < 0) note('promotional_per_7d', src.promotional_per_7d, out.promotional_per_7d, 'not a whole number of sends, so the default stands');
    else if (n > SPEC.promotional_per_7d) note('promotional_per_7d', n, SPEC.promotional_per_7d, `the campaign contract (spec §10) sets the preferred cap at ${SPEC.promotional_per_7d} per rolling 7 days; going above it is a per-send decision with a recorded override, not a standing rule`);
    else out.promotional_per_7d = n;
  }
  if (out.promotional_per_7d > out.absolute_per_7d) {
    note('promotional_per_7d', out.promotional_per_7d, out.absolute_per_7d, 'the preferred cap cannot sit above the absolute cap');
    out.promotional_per_7d = out.absolute_per_7d;
  }

  if (src.class_cap !== undefined) {
    const cc = src.class_cap && typeof src.class_cap === 'object' ? src.class_cap : {};
    for (const k of Object.keys(cc)) {
      const v = String(cc[k] || '');
      if (k === 'transactional') { note('class_cap.transactional', cc[k], null, 'transactional messages are never counted against the caps and never suppressed by them'); continue; }
      if (MARKETING.indexOf(k) < 0) { note(`class_cap.${k}`, cc[k], undefined, 'not a message class'); continue; }
      if (v !== 'preferred' && v !== 'absolute') { note(`class_cap.${k}`, cc[k], out.class_cap[k], 'a class is held to "preferred" or "absolute"'); continue; }
      if (k === 'promotional' && v === 'absolute') { note('class_cap.promotional', v, 'preferred', 'spec §10: a promotional send above the preferred cap needs a documented override per send'); continue; }
      out.class_cap[k] = v;
    }
  }

  if (src.cooldowns !== undefined) {
    if (!Array.isArray(src.cooldowns)) note('cooldowns', src.cooldowns, out.cooldowns.length, 'a list of cool-down rules is expected, so the default stands');
    else {
      out.cooldowns = [];
      src.cooldowns.forEach((c, i) => {
        if (i >= 8) { if (i === 8) note('cooldowns', src.cooldowns.length, 8, 'at most 8 cool-down rules are applied'); return; }
        const r = c && typeof c === 'object' ? c : {};
        const after = subset(r.after_channels, CHANNELS);
        const suppress = subset(r.suppress_channels, CHANNELS);
        const afterCls = subset(r.after_classes || ['promotional'], MARKETING);
        const suppCls = subset(r.suppress_classes || ['promotional'], MARKETING);
        const hours = int(r.hours);
        if (!after || !after.length || !suppress || !suppress.length) { note(`cooldowns[${i}]`, c, null, 'a cool-down needs the channels that start it and the channels it suppresses'); return; }
        if (hours === null || hours < 1 || hours > 168) { note(`cooldowns[${i}].hours`, r.hours, null, 'a cool-down lasts 1 to 168 hours'); return; }
        if (Array.isArray(r.after_classes) && r.after_classes.indexOf('transactional') >= 0) note(`cooldowns[${i}].after_classes`, 'transactional', null, 'a transactional message never starts a cool-down');
        if (Array.isArray(r.suppress_classes) && r.suppress_classes.indexOf('transactional') >= 0) note(`cooldowns[${i}].suppress_classes`, 'transactional', null, 'a transactional message is never suppressed');
        if (!afterCls.length || !suppCls.length) { note(`cooldowns[${i}]`, c, null, 'a cool-down applies to marketing classes only'); return; }
        out.cooldowns.push({
          id: String(r.id || `cooldown-${i + 1}`).slice(0, 60),
          after_channels: after, after_classes: afterCls, suppress_channels: suppress, suppress_classes: suppCls, hours,
        });
      });
    }
  }

  if (src.quiet_hours !== undefined) {
    const q = src.quiet_hours && typeof src.quiet_hours === 'object' ? src.quiet_hours : null;
    if (!q) note('quiet_hours', src.quiet_hours, out.quiet_hours, 'quiet hours are an object, so the default stands');
    else {
      if (q.enabled !== undefined) out.quiet_hours.enabled = q.enabled === true || q.enabled === 'true';
      for (const f of ['start', 'end']) {
        if (q[f] === undefined) continue;
        const n = int(q[f]);
        if (n === null || n < 0 || n > 23) note(`quiet_hours.${f}`, q[f], out.quiet_hours[f], 'an hour of the day, 0 to 23');
        else out.quiet_hours[f] = n;
      }
      if (q.channels !== undefined) {
        const ch = subset(q.channels, CHANNELS);
        if (ch) out.quiet_hours.channels = ch; else note('quiet_hours.channels', q.channels, out.quiet_hours.channels, 'a list of channels');
      }
      if (q.classes !== undefined) {
        const cl = subset(q.classes, MARKETING);
        if (Array.isArray(q.classes) && q.classes.indexOf('transactional') >= 0) note('quiet_hours.classes', 'transactional', null, 'a transactional message is never held by quiet hours');
        if (cl) out.quiet_hours.classes = cl; else note('quiet_hours.classes', q.classes, out.quiet_hours.classes, 'a list of marketing classes');
      }
    }
  }

  if (src.event_map !== undefined) {
    const m = src.event_map && typeof src.event_map === 'object' && !Array.isArray(src.event_map) ? src.event_map : null;
    if (!m) note('event_map', src.event_map, {}, 'an object of ESP event name -> {channel, message_class}');
    else {
      Object.keys(m).slice(0, 50).forEach((name) => {
        const v = m[name] && typeof m[name] === 'object' ? m[name] : {};
        const ch = channelOf(v.channel);
        const cl = MESSAGE_CLASSES.indexOf(String(v.message_class || '')) >= 0 ? String(v.message_class) : null;
        if (!name || name.length > 120 || !ch || !cl) { note(`event_map.${String(name).slice(0, 40)}`, v, null, 'an event maps to one of the five channels and one of the three classes'); return; }
        out.event_map[name] = { channel: ch, message_class: cl };
      });
    }
  }

  for (const k of Object.keys(src)) if (KNOWN.indexOf(k) < 0) note(k, '(set)', undefined, 'not a rule this platform applies, so it was ignored');
  return { rules: out, adjustments };
}

/** The effective rules, in sentences an operator can check against what they meant. */
function describeRules(rules) {
  const r = normaliseRules(rules).rules;
  const lines = [
    `Promotional cap ${r.promotional_per_7d} and absolute cap ${r.absolute_per_7d} marketing touches per person per rolling 7 days, counted across email, SMS, WhatsApp, push and in-app together.`,
    `Promotional sends are held to the ${r.class_cap.promotional} cap; triggered lifecycle sends to the ${r.class_cap['triggered-lifecycle']} cap. Transactional messages are never counted and never suppressed.`,
  ];
  for (const c of r.cooldowns) {
    lines.push(`After a ${c.after_classes.join('/')} ${c.after_channels.map((x) => CHANNEL_LABEL[x]).join(' or ')} touch, no ${c.suppress_classes.join('/')} ${c.suppress_channels.map((x) => CHANNEL_LABEL[x]).join(', ')} for ${c.hours} h.`);
  }
  if (!r.cooldowns.length) lines.push('No cross-channel cool-down is set.');
  const q = r.quiet_hours;
  lines.push(q.enabled
    ? `Quiet hours ${pad(q.start)}:00-${pad(q.end)}:00 in the recipient's own time zone for ${q.channels.map((x) => CHANNEL_LABEL[x]).join(', ') || 'no channel'}, when the region is known.`
    : 'Quiet hours are off.');
  return lines;
}
function pad(n) { return String(n).padStart(2, '0'); }

/* ── classification ───────────────────────────────────────────────────────── */

/** Adapter channel id -> the channel a subscriber experiences. */
const DISPATCH_CHANNEL = Object.freeze({
  klaviyo_email: 'email', klaviyo_sms: 'sms',
  webengage_email: 'email', webengage_sms: 'sms', webengage_push: 'push', webengage_inapp: 'in_app',
  ac_campaign: 'email', cio_transactional: 'email',
});

/**
 * The channel a send reaches a person on, or null when it is not a message to
 * a subscriber at all (an ad, a social post, a profile update, a suppression)
 * or when the platform decides it (an event that starts a flow).
 */
function channelOf(id) {
  const s = String(id == null ? '' : id).toLowerCase().trim().replace(/-/g, '_');
  if (s === 'inapp') return 'in_app';
  if (CHANNELS.indexOf(s) >= 0) return s;
  return DISPATCH_CHANNEL[s] || null;
}

/**
 * The message class from any of the names this repo uses for it. Anything
 * not recognised is PROMOTIONAL - counted, at the tighter cap - because
 * failing open here would turn a typo into an uncapped send.
 */
function classOf(v) {
  const s = String(v == null ? '' : v).toLowerCase().trim().replace(/_/g, '-');
  if (s === 'transactional') return 'transactional';
  if (['triggered-lifecycle', 'triggered', 'lifecycle', 'trigger', 'high-intent'].indexOf(s) >= 0) return 'triggered-lifecycle';
  return 'promotional';
}

/** The default class a dispatch channel carries when the job states none. */
function defaultClassFor(dispatchChannel) {
  return String(dispatchChannel || '') === 'cio_transactional' ? 'transactional' : 'promotional';
}

/** How many marketing touches a person may already have had before this one is refused. */
function capFor(messageClass, rules) {
  const r = normaliseRules(rules).rules;
  const c = classOf(messageClass);
  if (c === 'transactional') return Infinity;
  return r.class_cap[c] === 'absolute' ? r.absolute_per_7d : r.promotional_per_7d;
}

/* ── pseudonymous identity ────────────────────────────────────────────────── */

/**
 * The salt is per WORKSPACE. CONTACT_HASH_SALT is a deployment secret mixed IN,
 * never a replacement: until 2026-10-04 setting it made the salt the same for
 * every workspace (`CONTACT_HASH_SALT || workspaceId`), so one address hashed
 * identically in two tenants and one could confirm the other's list - the
 * exact thing the per-workspace salt exists to prevent. With no secret set the
 * output is byte-for-byte what it always was.
 */
function saltFor(workspaceId) {
  const secret = String(process.env.CONTACT_HASH_SALT || '');
  const ws = String(workspaceId || '');
  return secret ? `${secret}:${ws}` : ws;
}
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function hashEmail(email, workspaceId) {
  return sha(`${saltFor(workspaceId)}:${String(email).trim().toLowerCase()}`);
}
/** Digits only, `+` kept, `00` read as `+`. Matched in the form the source gives it. */
function normPhone(p) {
  const s = String(p == null ? '' : p).trim();
  const plus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  if (!plus && d.startsWith('00')) d = d.slice(2);
  return d.length >= 7 && d.length <= 15 ? `+${d}` : null;
}
function hashPhone(phone, workspaceId) {
  const e = normPhone(phone);
  return e ? sha(`${saltFor(workspaceId)}:tel:${e}`) : null;
}
const isHash = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
const EMAILISH = /@/;
const PHONEISH = /^\+?[\d\s().-]{7,24}$/;

function cleanRegion(v) { const s = String(v || '').toUpperCase().trim(); return /^[A-Z]{2,6}$/.test(s) ? s : null; }
function cleanZone(v) {
  const s = String(v || '').trim();
  if (!s || s.length > 64) return null;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: s }); return s; } catch (_) { return null; }
}

/**
 * Raw recipient / event / contact -> a pseudonymous identity. The address and
 * the number are hashed and DROPPED; a profile id that is itself an address
 * or a number (some ESPs key users by email) is hashed as one, so nothing that
 * leaves this function is a mailing list. Idempotent on its own output.
 */
function identityOf(workspaceId, raw, { provider = null } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {
    provider: String(r.provider || provider || '').toLowerCase().slice(0, 40) || null,
    external_profile_id: null,
    email_hash: null,
    phone_hash: null,
    region: cleanRegion(r.region || r.market),
    timezone: cleanZone(r.timezone || r.time_zone),
    cohort_key: r.cohort_key ? String(r.cohort_key).slice(0, 80) : null,
  };
  const email = r.email || r.email_address;
  const phone = r.phone || r.phone_number || r.msisdn;
  if (email && EMAILISH.test(String(email))) out.email_hash = hashEmail(email, workspaceId);
  if (phone) out.phone_hash = hashPhone(phone, workspaceId);
  if (!out.email_hash && isHash(r.email_hash)) out.email_hash = String(r.email_hash).toLowerCase();
  if (!out.phone_hash && isHash(r.phone_hash)) out.phone_hash = String(r.phone_hash).toLowerCase();
  const pid = r.external_profile_id != null ? r.external_profile_id : r.profile_id != null ? r.profile_id : r.user_id != null ? r.user_id : r.userId;
  if (pid != null && String(pid).trim() !== '') {
    const s = String(pid).trim().slice(0, 200);
    if (EMAILISH.test(s)) out.email_hash = out.email_hash || hashEmail(s, workspaceId);
    else if (PHONEISH.test(s) && normPhone(s)) out.phone_hash = out.phone_hash || hashPhone(s, workspaceId);
    // A long run of digits that is no phone number is still not stored as
    // typed: it is kept as a salted hash, so it links records and says nothing.
    else if (PHONEISH.test(s)) out.external_profile_id = `h:${sha(`${saltFor(workspaceId)}:pid:${s}`)}`;
    else out.external_profile_id = s;
  }
  return out;
}
function hasIdentity(id) { return !!(id && (id.external_profile_id || id.email_hash || id.phone_hash)); }

/** The identifiers that make two records one person. */
function personKeys(id) {
  const k = [];
  if (id.external_profile_id) k.push(`p:${id.provider || 'esp'}:${id.external_profile_id}`);
  if (id.email_hash) k.push(`e:${id.email_hash}`);
  if (id.phone_hash) k.push(`t:${id.phone_hash}`);
  return k;
}
/** One stable, non-identifying key per record: the ledger's dedupe column. */
function subjectKey(id) {
  return sha(['subject', id.provider || '', id.external_profile_id || '', id.email_hash || '', id.phone_hash || ''].join('|'));
}

/* ── time ─────────────────────────────────────────────────────────────────── */

function toMs(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
function iso(ms) { return ms == null || !Number.isFinite(ms) ? null : new Date(ms).toISOString(); }

const FMT = new Map();
function localHM(ms, zone) {
  let f = FMT.get(zone);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); FMT.set(zone, f); }
  const parts = f.formatToParts(new Date(ms));
  const get = (t) => Number((parts.find((p) => p.type === t) || {}).value);
  return { h: get('hour') % 24, m: get('minute') };
}
function isQuietHour(h, q) {
  if (q.start === q.end) return false;
  return q.start > q.end ? (h >= q.start || h < q.end) : (h >= q.start && h < q.end);
}
function zonesFor(region, timezone) {
  if (timezone) return [timezone];
  return region && REGION_ZONES[region] ? REGION_ZONES[region].slice() : [];
}
/** The first moment, on a 15-minute grid, when it is quiet in none of the zones. */
function quietEnds(at, zones, q) {
  for (let t = at, i = 0; i < 4 * 48; i += 1, t += 15 * 60000) {
    if (!zones.some((z) => isQuietHour(localHM(t, z).h, q))) return t;
  }
  return null;
}

/* ── evaluation ───────────────────────────────────────────────────────────── */

/** A ledger row or a carried touch, as the judge reads it. Any raw identifier is hashed here and never kept. */
function normTouch(t, workspaceId) {
  if (!t || typeof t !== 'object') return null;
  const channel = channelOf(t.channel);
  const at = toMs(t.occurred_at != null ? t.occurred_at : t.at);
  if (!channel || at == null) return null;
  return { channel, message_class: classOf(t.message_class), at, keys: personKeys(identityOf(workspaceId, t)), cohort_key: t.cohort_key || null };
}

/** The most touches any rolling window containing `at` would hold, the candidate included. */
function windowPeak(times, at, W) {
  const ends = [at].concat(times.filter((t) => t > at && t < at + W));
  let peak = 0;
  for (const e of ends) {
    const c = times.filter((t) => t > e - W && t <= e).length + 1;
    if (c > peak) peak = c;
  }
  return peak;
}

/** One person, one send: every reason it may not go now, each with when it could. */
function judge(rules, touches, send) {
  const reasons = [];
  const W = WINDOW_DAYS * DAY;
  const past = touches.filter((t) => t.at <= send.at);

  for (const cd of rules.cooldowns) {
    if (cd.suppress_channels.indexOf(send.channel) < 0 || cd.suppress_classes.indexOf(send.cls) < 0) continue;
    const hits = past.filter((t) => cd.after_channels.indexOf(t.channel) >= 0 && cd.after_classes.indexOf(t.message_class) >= 0 && send.at - t.at < cd.hours * HOUR);
    if (!hits.length) continue;
    const latest = hits.reduce((a, t) => (t.at > a.at ? t : a));
    reasons.push({
      code: 'cooldown', until: iso(latest.at + cd.hours * HOUR),
      detail: `A ${latest.message_class} ${CHANNEL_LABEL[latest.channel]} touch at ${iso(latest.at)} opens a ${cd.hours} h cool-down on ${cd.suppress_channels.map((x) => CHANNEL_LABEL[x]).join(', ')}.`,
    });
  }

  const cap = send.cls === 'transactional' ? Infinity : (rules.class_cap[send.cls] === 'absolute' ? rules.absolute_per_7d : rules.promotional_per_7d);
  const counted = touches.filter((t) => MARKETING.indexOf(t.message_class) >= 0).map((t) => t.at);
  const peak = windowPeak(counted, send.at, W);
  const breach = (limit) => peak > limit;
  const clearsAt = (limit) => {
    const exits = counted.map((t) => t + W).filter((t) => t > send.at).sort((a, b) => a - b);
    for (const t of exits) if (windowPeak(counted, t, W) <= limit) return iso(t);
    return null;
  };
  const channelsIn = Array.from(new Set(touches.filter((t) => MARKETING.indexOf(t.message_class) >= 0 && t.at > send.at - W && t.at < send.at + W).map((t) => CHANNEL_LABEL[t.channel]))).join(', ');
  // `until` is when THIS class's own cap clears, which for a promotional send
  // is the preferred cap even when the absolute one is what it breached: the
  // moment the absolute cap clears it is still over the preferred one.
  if (breach(rules.absolute_per_7d)) {
    reasons.push({ code: 'absolute_cap', until: clearsAt(Math.min(cap, rules.absolute_per_7d)), detail: `This would be marketing touch ${peak} in a rolling 7 days (${channelsIn || 'all channels'}); the absolute cap is ${rules.absolute_per_7d}.` });
  } else if (cap === rules.promotional_per_7d && breach(rules.promotional_per_7d)) {
    reasons.push({ code: 'promotional_cap', until: clearsAt(rules.promotional_per_7d), detail: `This would be marketing touch ${peak} in a rolling 7 days (${channelsIn || 'all channels'}); the promotional cap is ${rules.promotional_per_7d}, and going above it needs a documented override (spec §10).` });
  }

  let quietUnchecked = false;
  const q = rules.quiet_hours;
  if (q.enabled && q.channels.indexOf(send.channel) >= 0 && q.classes.indexOf(send.cls) >= 0) {
    const zones = zonesFor(send.region, send.timezone);
    if (!zones.length) quietUnchecked = true;
    else {
      const quietIn = zones.filter((z) => isQuietHour(localHM(send.at, z).h, q));
      if (quietIn.length) {
        const lt = localHM(send.at, quietIn[0]);
        reasons.push({ code: 'quiet_hours', until: iso(quietEnds(send.at, zones, q)), detail: `${pad(lt.h)}:${pad(lt.m)} in ${quietIn.join(', ')} is inside quiet hours (${pad(q.start)}:00-${pad(q.end)}:00 local).` });
      }
    }
  }
  return { allowed: reasons.length === 0, reasons, quiet_unchecked: quietUnchecked };
}

const SEVERITY = ['absolute_cap', 'cooldown', 'promotional_cap', 'quiet_hours'];
const REASON_PHRASE = {
  absolute_cap: (r, n) => `${n} over the absolute cap (${r.absolute_per_7d} per rolling 7 days)`,
  cooldown: (r, n) => `${n} by the cross-channel cool-down`,
  promotional_cap: (r, n) => `${n} over the promotional cap (${r.promotional_per_7d} per rolling 7 days)`,
  quiet_hours: (r, n) => `${n} held by quiet hours`,
};

/** Union-find over identifiers: every record that shares any key is one person. */
function grouper() {
  const parent = new Map();
  const find = (k) => { let r = k; while (parent.get(r) !== r) r = parent.get(r); let c = k; while (parent.get(c) !== r) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
  const add = (keys) => {
    if (!keys.length) return null;
    for (const k of keys) if (!parent.has(k)) parent.set(k, k);
    const root = find(keys[0]);
    for (const k of keys.slice(1)) { const r2 = find(k); if (r2 !== root) parent.set(r2, root); }
    return find(keys[0]);
  };
  return { add, find, has: (k) => parent.has(k) };
}

/**
 * Would this send to these recipients be allowed now?
 *
 * @param {Object} o
 * @param {Object} [o.rules]          the brand's rules (normalised here)
 * @param {Array}  [o.touches]        ledger rows / carried history
 * @param {Array}  [o.candidates]     recipient identities (raw or hashed), or null when the platform resolves the audience
 * @param {Object} o.send             { channel, message_class, at, region }
 * @param {Object} [o.ledger]         { available, reason, note, workspace_touches, truncated }
 * @param {Array}  [o.shared_touches] touches every candidate has (a plan's own earlier sends)
 * @param {string} [o.workspaceId]    salts any raw identifier in candidates
 */
function evaluate(o) {
  const opts = o || {};
  const { rules } = normaliseRules(opts.rules);
  const send = opts.send || {};
  const channel = channelOf(send.channel);
  const cls = classOf(send.message_class);
  const at = toMs(send.at) != null ? toMs(send.at) : (toMs(opts.now) != null ? toMs(opts.now) : Date.now());
  const ledger = Object.assign({ available: Array.isArray(opts.touches) }, opts.ledger || {});
  const cands = Array.isArray(opts.candidates) ? opts.candidates : null;
  const total = cands ? cands.length : null;
  const base = { channel, message_class: cls, evaluated_for: iso(at), total, ledger_source: ledger.source || null };
  const empty = { eligible: null, suppressed: null, deferred: null, by_reason: null, earliest_allowed_at: null };

  if (!channel) {
    return Object.assign(base, empty, { status: 'not_a_message', computed: false,
      note: 'Not a message to a subscriber on a known channel, so the contact rules do not apply to it here.' });
  }
  if (cls === 'transactional') {
    return Object.assign(base, { status: 'exempt', computed: true, eligible: total, suppressed: 0, deferred: 0, by_reason: {}, earliest_allowed_at: null,
      note: 'Transactional: never counted against the promotional caps and never suppressed by them, by a cool-down or by quiet hours.' });
  }
  // Quiet hours need no history: a recipient whose region is known can be
  // held until morning whether or not the ledger can be read. Judged here for
  // the two states that cannot judge the history-based rules, so "unknown"
  // never hides a send scheduled into somebody's night.
  const quietOnly = () => {
    if (!cands) return {};
    let deferred = 0; let unchecked = 0; let until = null;
    for (const c of cands) {
      const id = identityOf(opts.workspaceId, c);
      const v = judge(Object.assign({}, rules, { cooldowns: [] }), [], { channel, cls, at, region: id.region, timezone: id.timezone });
      if (v.quiet_unchecked) unchecked += 1;
      const q = v.reasons.find((r) => r.code === 'quiet_hours');
      if (q) { deferred += 1; const u = toMs(q.until); if (u != null && (until == null || u > until)) until = u; }
    }
    return deferred || unchecked ? { deferred, quiet_hours_unchecked: unchecked, earliest_allowed_at: deferred ? iso(until) : null, by_reason: deferred ? { quiet_hours: deferred } : null } : {};
  };
  const quietTail = (q) => (q.deferred ? ` ${q.deferred} of ${total} held by quiet hours until ${q.earliest_allowed_at}.` : '')
    + (q.quiet_hours_unchecked ? ` Quiet hours could not be checked for ${q.quiet_hours_unchecked}: their region is not known.` : '');
  if (!ledger.available) {
    const q = quietOnly();
    return Object.assign(base, empty, q, { status: 'unavailable', computed: false, reason: ledger.reason || 'not_supplied',
      note: `Eligibility unknown: the contact ledger is unavailable${ledger.note ? ` (${ledger.note})` : ''}. No suppression was computed, so none is shown as zero.${quietTail(q)}` });
  }
  const touches = (Array.isArray(opts.touches) ? opts.touches : []).map((t) => normTouch(t, opts.workspaceId)).filter(Boolean);
  const shared = (Array.isArray(opts.shared_touches) ? opts.shared_touches : []).map((t) => normTouch(t, opts.workspaceId)).filter(Boolean);
  const history = touches.length > 0 || Number(ledger.workspace_touches) > 0;
  if (!history) {
    const q = quietOnly();
    return Object.assign(base, empty, q, { status: 'unknown', computed: false, reason: 'no_history', note: `Eligibility unknown — no send history.${quietTail(q)}` });
  }
  if (!cands) {
    return Object.assign(base, empty, { status: 'unknown', computed: false, reason: 'recipients_unknown',
      note: 'Eligibility unknown — the recipients of this send are resolved by the platform, not known here, so no suppression was computed.' });
  }

  const g = grouper();
  const byRoot = new Map();
  for (const t of touches) {
    const root = g.add(t.keys);
    if (root) { if (!byRoot.has(root)) byRoot.set(root, []); byRoot.get(root).push(t); }
  }
  // Roots can merge after a touch was filed; re-file by the final root.
  const filed = new Map();
  for (const [root, list] of byRoot) { const r = g.find(root); if (!filed.has(r)) filed.set(r, []); filed.get(r).push(...list); }

  const by = {};
  let suppressed = 0; let deferred = 0; let unchecked = 0; let latestUntil = null; let unidentified = 0;
  const results = [];
  for (const c of cands) {
    const id = identityOf(opts.workspaceId, c);
    const keys = personKeys(id);
    if (!keys.length) unidentified += 1;
    let own = [];
    if (keys.length) {
      const seen = new Set();
      for (const k of keys) {
        if (!g.has(k)) continue;                    // a key no touch carried
        const r = g.find(k);
        if (!seen.has(r) && filed.has(r)) { seen.add(r); own = own.concat(filed.get(r)); }
      }
    }
    const verdict = judge(rules, own.concat(shared), { channel, cls, at, region: id.region, timezone: id.timezone });
    if (verdict.quiet_unchecked) unchecked += 1;
    const primary = verdict.reasons.slice().sort((a, b) => SEVERITY.indexOf(a.code) - SEVERITY.indexOf(b.code))[0];
    if (primary) {
      by[primary.code] = (by[primary.code] || 0) + 1;
      if (primary.code === 'quiet_hours') deferred += 1; else suppressed += 1;
      const until = verdict.reasons.map((r) => toMs(r.until)).filter((x) => x != null);
      const u = until.length ? Math.max(...until) : null;
      if (u != null && (latestUntil == null || u > latestUntil)) latestUntil = u;
    }
    if (opts.detail) results.push({ key: keys[0] || null, allowed: verdict.allowed, reasons: verdict.reasons });
  }
  const eligible = cands.length - suppressed - deferred;
  const out = Object.assign(base, {
    status: 'computed', computed: true, eligible, suppressed, deferred, by_reason: by,
    earliest_allowed_at: suppressed + deferred ? iso(latestUntil) : null,
    quiet_hours_unchecked: unchecked,
    unidentified,
    truncated: !!ledger.truncated,
  });
  out.note = sentence(rules, out);
  if (opts.detail) out.results = results;
  return out;
}

function sentence(rules, ev) {
  const parts = SEVERITY.filter((c) => ev.by_reason[c]).map((c) => REASON_PHRASE[c](rules, ev.by_reason[c]));
  const tail = [];
  if (ev.quiet_hours_unchecked) tail.push(`Quiet hours could not be checked for ${ev.quiet_hours_unchecked}: their region is not known.`);
  if (ev.unidentified) tail.push(`${ev.unidentified} recipient(s) carried no identifier, so no history could be matched to them.`);
  if (ev.truncated) tail.push('The ledger read was truncated, so these counts are a lower bound.');
  const head = ev.suppressed + ev.deferred
    ? `${ev.suppressed + ev.deferred} of ${ev.total} recipient(s) held back: ${parts.join('; ')}. ${ev.eligible} eligible${ev.earliest_allowed_at ? `; all clear by ${ev.earliest_allowed_at}` : ''}.`
    : `All ${ev.total} recipient(s) are inside the contact rules for this ${CHANNEL_LABEL[ev.channel]} ${ev.message_class} send.`;
  return [head].concat(tail).join(' ');
}

/* ── the planners ─────────────────────────────────────────────────────────── */

/**
 * Plan-time cap status for a count of planned sends to one cohort in a
 * rolling 7 days - the statuses spec §10 names. Used by every planner, so the
 * Smart Brain plan, the mailer calendar and the V1 plan cannot disagree.
 */
function capStatus(count, messageClass, rules) {
  const r = normaliseRules(rules).rules;
  const cls = classOf(messageClass);
  const counted = MARKETING.indexOf(cls) >= 0;
  const overPref = counted && count > r.promotional_per_7d;
  const overAbs = counted && count > r.absolute_per_7d;
  let status = 'SAFE';
  if (overAbs) status = 'BLOCKED';
  else if (overPref) status = r.class_cap[cls] === 'absolute' ? 'SAFE_WITH_DOCUMENTED_OVERRIDE' : 'REDUCE_AUDIENCE';
  return { counted, status, over_preferred: overPref, over_cap: overAbs, per_rolling_7d: r.promotional_per_7d, absolute_max: r.absolute_per_7d, message_class: cls };
}

/**
 * The plan-time cap for every slot of a plan: how many marketing sends the
 * PLAN itself puts on each (market, cohort) inside a rolling 7 days, and the
 * spec status that implies. `slots` are { date | at, market, cohort_key,
 * message_class, who? }; returns one cap object per slot, in order.
 */
function planCaps(slots, rules, { planStart = null } = {}) {
  const r = normaliseRules(rules).rules;
  const list = Array.isArray(slots) ? slots : [];
  const dayNum = (s) => { const t = toMs(s.at != null ? s.at : `${s.date}T00:00:00Z`); return t == null ? NaN : Math.floor(t / DAY); };
  const keyOf = (s) => `${s.market || ''}|${s.cohort_key || ''}`;
  const days = list.map(dayNum);
  const startDn = planStart ? dayNum({ date: planStart }) : Math.min(...days.filter(Number.isFinite));
  const counts = new Map();
  list.forEach((s, i) => { if (Number.isFinite(days[i]) && MARKETING.indexOf(classOf(s.message_class)) >= 0) { const k = keyOf(s); if (!counts.has(k)) counts.set(k, []); counts.get(k).push(days[i]); } });
  return list.map((s, i) => {
    const dn = days[i];
    const st = capStatus(0, s.message_class, r);
    if (!Number.isFinite(dn)) return Object.assign(st, { sends_in_rolling_7d: null, window_complete: null, action: 'No date, so the plan-time cap could not be counted for this slot.' });
    const count = (counts.get(keyOf(s)) || []).filter((d) => d <= dn && d > dn - WINDOW_DAYS).length;
    const cap = capStatus(count, s.message_class, r);
    const who = s.who || `"${s.cohort_key || 'cohort'}" (${s.market || 'market'})`;
    let action;
    if (!cap.counted) action = 'Transactional: never counted against the frequency cap.';
    else if (cap.status === 'BLOCKED') action = `Reduce or delay: ${count} marketing sends to ${who} inside a rolling 7 days exceeds the absolute cap of ${r.absolute_per_7d}. Absolute-cap fail means NOT LAUNCH READY for this slot.`;
    else if (cap.status === 'REDUCE_AUDIENCE') action = `${count} marketing sends to ${who} inside a rolling 7 days is above the preferred cap of ${r.promotional_per_7d} and within the absolute cap of ${r.absolute_per_7d}. Allowed only with a documented high-intent segment, a business reason and a recorded override; without one, reduce the audience or delay the send.`;
    else if (cap.status === 'SAFE_WITH_DOCUMENTED_OVERRIDE') action = `${count} marketing sends to ${who} inside a rolling 7 days is above the preferred cap of ${r.promotional_per_7d}; a triggered lifecycle send is held to the absolute cap of ${r.absolute_per_7d}, so it may go with its trigger recorded as the documented reason.`;
    else action = `${count} marketing send(s) to ${who} inside a rolling 7 days is at or under the preferred cap of ${r.promotional_per_7d}.`;
    const complete = Number.isFinite(startDn) ? (dn - startDn) >= WINDOW_DAYS - 1 : null;
    if (complete === false) action += ' Look-back is partial: this slot sits in the first six days of the plan window, so marketing sends made before the window opened are not counted here.';
    return Object.assign(cap, { sends_in_rolling_7d: count, window_complete: complete, action });
  });
}

/**
 * Per-slot ELIGIBILITY: how many of the cohort the contact ledger leaves
 * sendable at the slot's time, and why the rest are held back. `slots` are
 * { at, channel, message_class, cohort_key, cohort_size, market, time_basis };
 * `ctx` is what contact-ledger.contextFor() returns (or a carried equivalent).
 * Each slot is judged over the ledger's history PLUS the plan's own earlier
 * sends to the same cohort, so a cohort the plan already mailed twice this
 * week is not reported as fresh.
 */
function eligibilityForPlan(slots, ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : { available: false, reason: 'not_supplied', note: 'no contact ledger was supplied to this plan' };
  const list = Array.isArray(slots) ? slots : [];
  const keyOf = (s) => `${s.market || ''}|${s.cohort_key || ''}`;
  const times = list.map((s) => toMs(s.at));
  const byKey = new Map();
  list.forEach((s, i) => { const k = keyOf(s); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); });
  const touches = Array.isArray(c.touches) ? c.touches : [];
  const taggedBy = new Map();
  for (const t of touches) {
    if (!t || !t.cohort_key) continue;
    if (!taggedBy.has(t.cohort_key)) taggedBy.set(t.cohort_key, []);
    taggedBy.get(t.cohort_key).push(t);
  }
  return list.map((s, i) => {
    const projected = (byKey.get(keyOf(s)) || []).filter((j) => times[j] != null && times[i] != null && times[j] < times[i])
      .map((j) => ({ channel: list[j].channel, message_class: list[j].message_class, at: times[j] }));
    return slotEligibility(c, s, projected, taggedBy);
  });
}

function slotEligibility(c, s, projected, taggedBy) {
  const send = { channel: s.channel || 'email', message_class: s.message_class, at: s.at };
  const ledger = { available: !!c.available, reason: c.reason, note: c.note, workspace_touches: c.workspace_touches, truncated: c.truncated, source: c.source };
  const touches = Array.isArray(c.touches) ? c.touches : [];
  const extra = { time_basis: s.time_basis || null, cohort_key: s.cohort_key || null };
  const members = c.members && s.cohort_key && Array.isArray(c.members[s.cohort_key]) ? c.members[s.cohort_key] : null;
  if (members) {
    const ev = evaluate({ rules: c.rules, touches, candidates: members, send, ledger, shared_touches: projected, workspaceId: c.workspace_id });
    return Object.assign(ev, extra, { basis: 'members' });
  }
  const pre = evaluate({ rules: c.rules, touches, candidates: null, send, ledger });
  if (pre.status !== 'unknown' || pre.reason !== 'recipients_unknown') return Object.assign(pre, extra);

  // No member list: judge every person the ledger has seen in THIS cohort, and
  // one person the ledger has never seen (who carries only the plan's own
  // earlier sends). The cohort's size then splits into the two.
  const seen = new Map();
  for (const t of (taggedBy && taggedBy.get(s.cohort_key)) || []) {
    const id = identityOf(c.workspace_id, t);
    const k = personKeys(id)[0];
    if (k && !seen.has(k)) seen.set(k, id);
  }
  const known = Array.from(seen.values());
  const ev = evaluate({ rules: c.rules, touches, candidates: known, send, ledger, shared_touches: projected, workspaceId: c.workspace_id });
  const fresh = judge(normaliseRules(c.rules).rules, projected.map((t) => normTouch(t)).filter(Boolean), { channel: channelOf(send.channel), cls: classOf(send.message_class), at: toMs(send.at) });
  const size = Number.isFinite(Number(s.cohort_size)) && s.cohort_size != null ? Number(s.cohort_size) : null;
  const held = ev.suppressed + ev.deferred;
  if (size == null) {
    return Object.assign(ev, extra, {
      status: 'partial', basis: 'ledger-tagged', eligible: null, cohort_size: null,
      note: `${held} profile(s) of this cohort held back by the contact rules (${known.length} seen in the ledger); the cohort's size is not known, so how many remain eligible is not stated.`,
    });
  }
  const unseen = Math.max(0, size - known.length);
  const unseenHeld = fresh.allowed ? 0 : unseen;
  const primary = fresh.reasons.slice().sort((a, b) => SEVERITY.indexOf(a.code) - SEVERITY.indexOf(b.code))[0];
  const by = Object.assign({}, ev.by_reason);
  if (unseenHeld && primary) by[primary.code] = (by[primary.code] || 0) + unseenHeld;
  const suppressed = ev.suppressed + (primary && primary.code !== 'quiet_hours' ? unseenHeld : 0);
  const deferred = ev.deferred + (primary && primary.code === 'quiet_hours' ? unseenHeld : 0);
  const out = Object.assign(ev, extra, {
    basis: 'cohort-size-minus-ledger', total: size, cohort_size: size,
    eligible: Math.max(0, size - suppressed - deferred), suppressed, deferred, by_reason: by,
  });
  out.note = sentence(normaliseRules(c.rules).rules, out)
    + ` ${known.length} of the ${size} were seen in the ledger; the rest have no recorded touch and are judged on this plan's own earlier sends.`;
  return out;
}

/** A short label for a slot's eligibility, for a pill or a cell. */
function eligibilityLabel(e) {
  if (!e) return 'Eligibility unknown';
  if (e.status === 'unavailable') return 'Eligibility unknown: contact ledger unavailable';
  if (e.status === 'unknown') return e.reason === 'no_history' ? 'Eligibility unknown — no send history' : 'Eligibility unknown';
  if (e.status === 'exempt') return 'Transactional: not capped';
  if (e.status === 'not_a_message') return 'Not a subscriber message';
  if (e.status === 'partial') return `${e.suppressed + (e.deferred || 0)} held back · eligible unknown`;
  return `${Number(e.eligible).toLocaleString('en-US')} eligible · ${Number(e.suppressed + (e.deferred || 0)).toLocaleString('en-US')} held back`;
}

module.exports = {
  CHANNELS, MESSAGE_CLASSES, MARKETING, DEFAULT_RULES, SPEC, REGION_ZONES, WINDOW_DAYS,
  normaliseRules, describeRules,
  channelOf, classOf, defaultClassFor, capFor,
  saltFor, hashEmail, hashPhone, normPhone, identityOf, hasIdentity, personKeys, subjectKey, isHash,
  evaluate, capStatus, planCaps, eligibilityForPlan, eligibilityLabel,
  // exposed for the executed spec
  _judge: judge, _windowPeak: windowPeak, _localHM: localHM,
};
