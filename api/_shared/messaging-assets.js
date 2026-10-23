'use strict';
/**
 * messaging-assets.js - SMS, WhatsApp and push as real asset types (2026-10-23).
 * ---------------------------------------------------------------------------
 * Nothing in the app wrote an SMS, a WhatsApp message or a push notification:
 * Smart Brain built email, ads and landing pages only, so a brand that sends
 * texts had to write them by hand outside the platform. This module is the one
 * place those three are made, for Smart Brain's build (template path and model
 * path) and for the standalone generator (api/ai/generate.js modes sms,
 * whatsapp, push), so the two can never disagree.
 *
 * The rules, each enforced here rather than asked of a model:
 *   - A channel is built ONLY when the brand's own record says it sends on it
 *     (`channels` / `messaging_channels`, top level or in brand_data). A brand
 *     that states nothing gets nothing new: its plan is unchanged.
 *   - The message line comes from the model's answer when there is one, else
 *     from the brand's own lines (the same helpers the template mailer uses:
 *     headlineFor, audienceLine, defaultCta). The BUILDER, never the model,
 *     adds the sender, the link and the opt-out, so a message cannot ship
 *     without them.
 *   - A link is the slot's own page (smart-brain-plan.slotLinks). A slot with
 *     no page on record gets no link: the sentence that would carry it is
 *     dropped and the gap goes to data_gaps. No placeholder is ever visible in
 *     a finished message, and nothing (offer, price, code) is invented.
 *
 * NOT a function file (api/_shared/ is outside the Hobby 12-function cap).
 */

const specs = require('./asset-specs.js');
const MS = specs.MESSAGING;

const CHANNELS = Object.freeze(['sms', 'whatsapp', 'push']);
const ALIAS = {
  sms: 'sms', text: 'sms', texts: 'sms', 'text message': 'sms', 'text messages': 'sms', mms: 'sms',
  whatsapp: 'whatsapp', 'whats app': 'whatsapp', wa: 'whatsapp', 'whatsapp business': 'whatsapp',
  push: 'push', 'push notification': 'push', 'push notifications': 'push', app_push: 'push', 'app push': 'push',
  web_push: 'push', 'web push': 'push', mobile_push: 'push', notifications: 'push',
};

/** The messaging channels the brand's own record says it sends on. Nothing stated = []. */
function channelsOf(brand) {
  const b = brand && typeof brand === 'object' ? brand : {};
  const d = b.brand_data && typeof b.brand_data === 'object' ? b.brand_data : {};
  const out = new Set();
  for (const list of [b.channels, d.channels, b.messaging_channels, d.messaging_channels]) {
    for (const x of Array.isArray(list) ? list : []) {
      if (x && typeof x === 'object' && x.enabled === false) continue;
      const raw = x && typeof x === 'object' ? (x.channel || x.key || x.name) : x;
      const k = ALIAS[String(raw == null ? '' : raw).trim().toLowerCase()];
      if (k) out.add(k);
    }
  }
  return CHANNELS.filter((c) => out.has(c));
}

/** A plan's channel list plus the messaging channels the brand states (never for a brand that states none). */
function withStated(channels, brand) {
  const base = Array.isArray(channels) ? channels.slice() : [];
  for (const c of channelsOf(brand)) if (!base.includes(c)) base.push(c);
  return base;
}

/** Which messaging channels a slot plans. */
function plannedOn(entry) {
  const ch = (entry && Array.isArray(entry.channels)) ? entry.channels : [];
  return CHANNELS.filter((c) => ch.includes(c));
}

/* ── SMS encoding: 3GPP TS 23.038 ────────────────────────────────────────── */

// The GSM 7-bit default alphabet and its extension table (each extension
// character costs two septets: the escape and the character).
const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€\f';

/** How many parts a message is sent as, and in which encoding. */
function smsSegments(text) {
  const s = String(text == null ? '' : text);
  let units = 0;
  const nonGsm = [];
  for (const ch of s) {
    if (GSM7.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else if (!nonGsm.includes(ch)) nonGsm.push(ch);
  }
  if (!nonGsm.length) {
    const segments = !s ? 0 : (units <= MS.sms.gsm7.single ? 1 : Math.ceil(units / MS.sms.gsm7.part));
    return { encoding: 'GSM-7', units, segments, per_segment: segments > 1 ? MS.sms.gsm7.part : MS.sms.gsm7.single, non_gsm: [] };
  }
  // UCS-2 counts UTF-16 code units: an emoji outside the BMP is two.
  const u = s.length;
  const segments = u <= MS.sms.ucs2.single ? 1 : Math.ceil(u / MS.sms.ucs2.part);
  return { encoding: 'UCS-2', units: u, segments, per_segment: segments > 1 ? MS.sms.ucs2.part : MS.sms.ucs2.single, non_gsm: nonGsm.slice(0, 12) };
}

/* ── placeholders: never visible in a finished message ───────────────────── */

const MARKER = /\[DATA REQUIRED BEFORE LAUNCH:[^\]]*\]/i;
const MERGE = /\{\{[^}]*\}\}|\{%[^%]*%\}/;

/** Sentences of `text` with no marker or merge tag; each dropped one is a gap. */
function dropPlaceholderSentences(text, gaps) {
  const s = String(text == null ? '' : text).trim();
  if (!s || (!MARKER.test(s) && !MERGE.test(s))) return s;
  const parts = s.match(/[^.!?]+[.!?]*\s*/g) || [s];
  const kept = [];
  for (const p of parts) {
    const m = p.match(MARKER);
    if (m) { if (Array.isArray(gaps)) gaps.push(m[0]); continue; }
    if (MERGE.test(p)) { if (Array.isArray(gaps)) gaps.push(`A merge tag (${(p.match(MERGE) || [''])[0]}) the platform would fill: the sentence was left out.`); continue; }
    kept.push(p);
  }
  return kept.join('').replace(/\s+/g, ' ').trim();
}

/* ── the brand's own lines ───────────────────────────────────────────────── */

function svc() { return require('../../lib/smart-brain/services.js'); }

function brandOf(entry) {
  const b = (entry && entry.brand) || null;
  try { return require('./brand-runtime.js').scopedBrand(b, { allowTenantZero: true }) || b || {}; } catch (_) { return b || {}; }
}

function cleanLine(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
function sentence(s) {
  const t = cleanLine(s);
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The lines a template message is made from: all the brand's own, or true by the audience's definition. */
function templateLines(entry) {
  const S = svc();
  const b = brandOf(entry);
  const name = cleanLine(b.name);
  const hp = entry && entry.heroProduct;
  const real = hp && !hp.placeholder && hp.title && !MARKER.test(String(hp.title)) ? String(hp.title) : '';
  let subj = '';
  try { subj = real ? S.sayableProduct(entry, real) : ''; } catch (_) { subj = real; }
  let headline = ''; let aud = ''; let cta = 'Learn more';
  try { headline = S.headlineFor(entry); } catch (_) { headline = ''; }
  try { aud = S.audienceLine(entry, name, subj); } catch (_) { aud = ''; }
  try { cta = S.defaultCta(entry) || cta; } catch (_) { /* keep */ }
  const tagline = cleanLine(b.tagline);
  const claims = (Array.isArray(b.claims) ? b.claims : []).map(cleanLine).filter(Boolean);
  // The one line a message says: why it reaches the reader now, else the
  // send's headline naming the product, else the brand's own words.
  const say = aud || (subj ? `${headline}: ${subj}` : '') || tagline || claims[0] || headline;
  return { name, subj, headline: cleanLine(headline), say: cleanLine(say), cta: cleanLine(cta), tagline, claims, legal: cleanLine(b.legal_entity || b.legal_name || '') };
}

/** The slot's own page, or '' with the gap recorded. */
function linkFor(link, brand, market, gaps) {
  const s = String(link || '').trim();
  if (/^https:\/\//i.test(s) && !MARKER.test(s) && !MERGE.test(s)) return s;
  const name = (brand && brand.name) || 'this brand';
  const m = s.match(MARKER);
  gaps.push(m ? m[0] : `[DATA REQUIRED BEFORE LAUNCH: region store URL, ${name}, ${market || 'all'}]`);
  return '';
}

function languageOf(brand, market) {
  let loc = '';
  try { loc = require('./brand-locale.js').localeFor(brand, market).locale || ''; } catch (_) { loc = ''; }
  return loc ? loc.replace('-', '_') : 'en';
}

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60); }

/**
 * Build the messaging assets a slot plans.
 * @param entry  the slot (its brand, market, channels, objective, hero)
 * @param opts   { copy: the model's `messaging` answer or null, link: the slot's page, channels?: override }
 * @returns {{ messages: Array, data_gaps: string[] }}
 */
function build(entry, opts) {
  const o = opts || {};
  const want = Array.isArray(o.channels) ? o.channels.filter((c) => CHANNELS.includes(c)) : plannedOn(entry);
  const out = { messages: [], data_gaps: [] };
  if (!want.length) return out;
  const brand = brandOf(entry);
  const market = (entry && entry.market) || '';
  const L = templateLines(entry);
  const model = o.copy && typeof o.copy === 'object' ? o.copy : {};
  const gaps = out.data_gaps;
  const link = linkFor(o.link, brand, market, gaps);
  const name = L.name || cleanLine(brand.name);
  if (!name) gaps.push('[DATA REQUIRED BEFORE LAUNCH: brand name, this brand]');
  if (!L.legal && want.some((c) => c !== 'push')) gaps.push(`[DATA REQUIRED BEFORE LAUNCH: legal sender, ${name || 'this brand'}]`);
  const source = (k) => (model[k] && typeof model[k] === 'object' && Object.keys(model[k]).some((x) => cleanLine(model[k][x]))) ? 'model' : 'template';
  const pick = (v, fallback) => { const t = dropPlaceholderSentences(v, gaps); return t || fallback; };

  if (want.includes('sms')) {
    const m = model.sms || {};
    // The line is CHOSEN so the whole text fits one part, never cut: the
    // model's line first, then the brand's own lines in order. With none that
    // fits, the first is kept and the contract says how many parts it takes.
    const finish = typeof o.finish === 'function' ? o.finish : (t) => t;
    const prefix = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:,-]\\s*`, 'i');
    const compose = (line) => {
      const body = dropPlaceholderSentences(line, []).replace(prefix, '');
      const parts = [body ? (name ? `${name}: ${sentence(body)}` : sentence(body)) : (name ? `${name}:` : '')];
      if (link) parts.push(`${L.cta}: ${link}`);
      parts.push(MS.sms.opt_out);
      return { body, text: finish(parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()) };
    };
    const modelLine = dropPlaceholderSentences(m.text, gaps);
    const candidates = [modelLine, L.say, L.subj ? `${L.headline}: ${L.subj}` : '', L.tagline, ...L.claims, L.headline]
      .map(cleanLine).filter((x, i, a) => x && a.indexOf(x) === i);
    const tried = candidates.map(compose);
    const chosen = tried.find((t) => smsSegments(t.text).segments <= 1) || tried[0] || compose('');
    out.messages.push({
      contract: 'sms.message', channel: 'sms', id: `sms_${slug(entry && entry.id) || 'slot'}`, source: modelLine && chosen === tried[0] ? 'model' : 'template',
      sender: name, legal_sender: L.legal || null, text: chosen.text, line: chosen.body, link: link || null, cta: L.cta,
      opt_out: MS.sms.opt_out, message_class: 'promotional', encoding: smsSegments(chosen.text),
    });
  }
  if (want.includes('whatsapp')) {
    const m = model.whatsapp || {};
    const header = pick(m.header, L.headline || name);
    const body = pick(m.body, [L.say, L.tagline && L.tagline !== L.say ? L.tagline : ''].filter(Boolean).map(sentence).join(' '));
    const btnText = cleanLine(pick(m.button, L.cta));
    const buttons = link ? [{ type: 'URL', text: btnText, url: link }] : [];
    const footer = MS.whatsapp.opt_out;
    out.messages.push({
      contract: 'whatsapp.message', channel: 'whatsapp', id: `wa_${slug(entry && entry.id) || 'slot'}`, source: source('whatsapp'),
      sender: name, legal_sender: L.legal || null,
      // The fields the compliance and unit passes read, and the template as it
      // is submitted for approval (no variables: every value is filled).
      headline: header, body, cta: btnText, footer,
      template: {
        name: slug([name, entry && entry.objective, entry && entry.date].filter(Boolean).join(' ')) || 'marketing_message',
        category: MS.whatsapp.category, language: languageOf(brand, market),
        components: [
          { type: 'HEADER', format: 'TEXT', text: header },
          { type: 'BODY', text: body },
          { type: 'FOOTER', text: footer },
        ].concat(buttons.length ? [{ type: 'BUTTONS', buttons }] : []),
      },
      link: link || null, buttons, opt_out: footer, message_class: 'promotional',
      note: 'A marketing message outside the 24-hour customer service window is sent only as an approved template: submit this template for approval before the send.',
    });
  }
  if (want.includes('push')) {
    const m = model.push || {};
    const title = pick(m.title, L.headline || name);
    const body = pick(m.body, L.say !== title ? L.say : (L.tagline || ''));
    out.messages.push({
      contract: 'push.notification', channel: 'push', id: `push_${slug(entry && entry.id) || 'slot'}`, source: source('push'),
      sender: name, title, body, link: link || null, deep_link: link || null, message_class: 'promotional',
      note: 'The reader opts out of push in the device or app settings; truncation of the title and body varies by device.',
    });
  }
  out.data_gaps = [...new Set(gaps)];
  return out;
}

/** After a pass changed a message's fields: the SMS part count and the WhatsApp template follow them. */
function syncTemplate(m) {
  if (!m || typeof m !== 'object') return m;
  if (m.channel === 'sms') m.encoding = smsSegments(m.text);
  if (m.template && Array.isArray(m.template.components)) {
    for (const comp of m.template.components) {
      if (comp.type === 'HEADER') comp.text = m.headline;
      else if (comp.type === 'BODY') comp.text = m.body;
      else if (comp.type === 'FOOTER') comp.text = m.footer;
      else if (comp.type === 'BUTTONS') for (const b of comp.buttons || []) { if (b.type === 'URL') { b.text = m.cta; if (m.link) b.url = m.link; } }
    }
  }
  if (m.channel === 'push' && m.link) m.deep_link = m.link;
  return m;
}

/** The output contract fragment the copy prompt gains for the channels a slot plans (null when none). */
function copySchema(entry) {
  const want = plannedOn(entry);
  if (!want.length) return null;
  const of = {};
  if (want.includes('sms')) of.sms = { type: 'object', of: { text: { type: 'string', note: `ONE sentence to the reader, at most ${MS.sms.gsm7.single - 60} characters, plain GSM characters (no emoji). No brand name prefix, no link, no opt-out: the builder adds them.` } } };
  if (want.includes('whatsapp')) of.whatsapp = { type: 'object', of: { header: { type: 'string', max: MS.whatsapp.header_text }, body: { type: 'string', max: MS.whatsapp.body, note: 'two or three short sentences, the brand\'s own facts only, no variables like {{1}}' }, button: { type: 'string', max: MS.whatsapp.button_text, note: 'the action on the link button' } } };
  if (want.includes('push')) of.push = { type: 'object', of: { title: { type: 'string', note: 'a few words; truncation varies by device' }, body: { type: 'string', note: 'one sentence' } } };
  return { type: 'object', of };
}

module.exports = {
  CHANNELS, channelsOf, withStated, plannedOn, smsSegments, dropPlaceholderSentences, templateLines, build, copySchema, syncTemplate,
};
