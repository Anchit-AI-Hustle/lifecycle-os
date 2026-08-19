'use strict';
/**
 * brand-suggest.js — AI-written OPTIONS for a brand-setup field.
 * ---------------------------------------------------------------------------
 * The onboarding wizard asks an operator to type a tone, a preferred
 * vocabulary, a banned-phrase list and notes for the writer, against nothing
 * but a placeholder. Most people stall there, and a stalled field becomes an
 * empty one, which becomes a `[DATA REQUIRED BEFORE LAUNCH: ...]` marker in
 * every asset the platform later generates.
 *
 * So this offers OPTIONS. Not answers.
 *
 * ── THE LINE THIS MODULE DOES NOT CROSS ────────────────────────────────────
 * Everywhere else in this repo, a brand value is either read from that brand's
 * own site (with its source URL) or typed by the operator. A model's opinion is
 * neither, and it must never be mistaken for either. So:
 *
 *   1. NOTHING IS APPLIED. Every option comes back as a candidate with
 *      `origin: 'suggestion'`. The wizard renders them as chips; a value only
 *      enters the brand record when the operator clicks one, at which point it
 *      is THEIRS and is claimed as user-origin like anything else they typed.
 *
 *   2. A SUGGESTION IS NEVER A FACT. The prompt forbids inventing anything
 *      checkable - no product names, prices, URLs, certifications, awards,
 *      ratings, review counts, founding dates, materials or origin claims.
 *      Tone and vocabulary are matters of preference, which is exactly why
 *      they are the fields this is offered for. `verifiedClaimsOnly()` strips
 *      any option that smuggles one in anyway.
 *
 *   3. IT SAYS SO ON EVERY RESPONSE. `disclaimer` rides on the payload and the
 *      wizard prints it above the chips, because a chip that looks identical to
 *      an extracted candidate would quietly launder a guess into provenance.
 *
 * ── WHY BANNED PHRASES ARE OFFERED AT ALL ──────────────────────────────────
 * The standing rule is that `voice.banned` can never be MACHINE-FILLED, and
 * that rule is enforced in the database by `brand_context_apply()`. It is about
 * a machine writing the field, not about a human choosing from a list: banned
 * phrases are a compliance guardrail, and the operator has to own each one.
 * Nothing here writes that field. The suggestions are a menu, the click is the
 * decision, and the click records the operator as the origin.
 *
 * Suggestions for a REGULATED category are deliberately conservative: the
 * prompt is told that a health, financial or medical brand's banned list is a
 * legal instrument and to suggest only wording restrictions it can justify.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const callLLM = require('./llm.js');
const runtime = require('./brand-runtime.js');

/** Fields this will write options for, and the shape each one wants back. */
const FIELDS = {
  'voice.tone': {
    label: 'Tone',
    kind: 'line',
    count: 6,
    asks: 'Six alternative TONE descriptions, each a short phrase a writer could follow, e.g. the shape of "warm, plain spoken, never hyped". Make them genuinely different from each other in register, not six rewordings of one idea.',
  },
  'voice.preferred': {
    label: 'Preferred vocabulary',
    kind: 'terms',
    count: 12,
    asks: 'Twelve individual WORDS OR SHORT PHRASES this brand would plausibly want to use often. Single terms, not sentences. No product names.',
  },
  'voice.banned': {
    label: 'Banned phrases',
    kind: 'terms',
    count: 12,
    asks: 'Twelve words or phrases this brand should NEVER use. Favour hype, false-urgency and unsupportable-claim language. If the brand is in a regulated category (health, medical, financial, childcare), include the wording that category cannot legally claim, and say which in the reason.',
  },
  'voice.notes': {
    label: 'Notes for the writer',
    kind: 'para',
    count: 5,
    asks: 'Five short instructions to a copywriter about HOW to write for this brand: structure, what a testimonial should read like, what to lead with. One or two sentences each.',
  },
  tagline: {
    label: 'Tagline',
    kind: 'line',
    count: 6,
    asks: 'Six possible taglines. Each must be sayable out loud, under nine words, and must not state anything checkable about the product.',
  },
  positioning: {
    label: 'Positioning',
    kind: 'para',
    count: 4,
    asks: 'Four one-sentence positioning statements: who this is for and what it gives them. No market-size or ranking claims.',
  },
};

/** Anything a customer could check is a fact, and facts do not come from here. */
const UNCHECKABLE = [
  /\b\d+(?:[.,]\d+)?\s*%/,                       // percentages
  // Any COUNT, not just a big one. This first required three digits, so
  // "trusted in 47 countries" passed the filter - and a small number is no less
  // checkable than a large one, it is just less impressive.
  /\b\d[\d,]*\+?\s*(?:customers|reviews|users|sold|countries|farms|stores|locations|years)\b/i,
  /\b\d(?:\.\d)?\s*\/\s*5\b|\b\d(?:\.\d)?\s*stars?\b/i,
  /\bsince\s+(?:18|19|20)\d\d\b/i,
  /\b(?:award[- ]winning|certified|patented|clinically proven|number one|#1|world'?s (?:best|largest)|india'?s largest)\b/i,
  /\bhttps?:\/\//i,
  // No leading \b on the symbol alternation. `$`, `£`, `€` and `₹` are not word
  // characters, so `\b$` requires a word char immediately before the symbol and
  // "from just $19" slipped straight through - caught by the test below, which
  // is the only reason this is not still shipping.
  /(?:\brs\.?\s?|₹|\$|£|€)\s?\d/i,
];

function verifiedClaimsOnly(options) {
  const kept = [], dropped = [];
  for (const o of options) {
    const hit = UNCHECKABLE.find((rx) => rx.test(o.value));
    if (hit) dropped.push({ value: o.value, why: 'states something a customer could check, which a suggestion may never do' });
    else kept.push(o);
  }
  return { kept, dropped };
}

/**
 * Everything the model is allowed to know: this brand's own record. No other
 * brand, no preset, no tenant zero.
 */
function brandBrief(brand) {
  const b = brand || {};
  const bits = [];
  if (b.name) bits.push(`Name: ${b.name}`);
  if (b.industry) bits.push(`Industry: ${b.industry}`);
  if (b.tagline) bits.push(`Tagline it already uses: ${b.tagline}`);
  if (b.positioning) bits.push(`Positioning: ${b.positioning}`);
  const sells = (b.offerings || []).slice(0, 8)
    .map((o) => (typeof o === 'string' ? o : (o && (o.name || o.kind)))).filter(Boolean);
  if (sells.length) bits.push(`It sells: ${sells.join(', ')}`);
  const regions = (b.regions || []).map((r) => r && r.code).filter(Boolean);
  if (regions.length) bits.push(`Regions: ${regions.join(', ')}`);
  const v = b.voice || {};
  if (v.tone) bits.push(`Tone already recorded: ${v.tone}`);
  if ((v.preferred || []).length) bits.push(`Words it already prefers: ${v.preferred.slice(0, 12).join(', ')}`);
  if ((v.banned || []).length) bits.push(`Words it already bans: ${v.banned.slice(0, 12).join(', ')}`);
  return bits;
}

const SYSTEM = [
  'You write OPTIONS for one field of a brand profile. The operator picks one, edits it, or ignores all of them.',
  'You are given only that brand\'s own record. You know nothing else about the company, and you must not pretend otherwise.',
  'HARD RULES:',
  '1. Never state anything a customer could check: no product names you were not given, no prices, URLs, ratings, review counts, awards, certifications, founding dates, materials, ingredients, origins or rankings.',
  '2. Tone and vocabulary are preferences, so those you may propose freely. Facts you may not.',
  '3. Never use an em dash or an en dash. Use commas, colons or plain hyphens.',
  '4. If the record is thin, write options that stay general rather than inventing specifics to fill them out.',
  'Answer as JSON only: {"options":[{"value":"...","why":"one short line on when this fits"}]}',
].join('\n');

/**
 * @returns {Promise<{ok:boolean, field?:string, options?:Array, dropped?:Array,
 *                    disclaimer?:string, provider?:string, note?:string}>}
 */
async function suggest(field, brand, { count } = {}) {
  const spec = FIELDS[field];
  if (!spec) {
    return { ok: false, error: 'unknown_field', note: `No suggestions are defined for "${field}".`, fields: Object.keys(FIELDS) };
  }

  const b = brand && !runtime.isUnresolved(brand) ? brand : null;
  const brief = b ? brandBrief(b) : [];
  if (!brief.length) {
    // With nothing recorded, options would be about a generic company rather
    // than this one, which is worse than an empty field because it looks like
    // an answer.
    return {
      ok: false, error: 'no_brand_context', options: [],
      note: 'Add at least a brand name and industry first. With nothing recorded, any options would describe a generic company rather than yours.',
    };
  }

  const n = Math.max(3, Math.min(15, count || spec.count));
  let raw;
  try {
    raw = await callLLM({
      systemPrompt: SYSTEM,
      userMessage: [
        `FIELD: ${spec.label}`,
        `WHAT TO WRITE: ${spec.asks}`,
        `HOW MANY: ${n}`,
        '',
        'THE BRAND, in full:',
        brief.map((l) => '  ' + l).join('\n'),
      ].join('\n'),
      responseFormat: { type: 'json_object' },
      maxTokens: 1200,
      temperature: 0.85,
      stage: 'brand-suggest',
    });
  } catch (e) {
    // An unreachable model is not "no ideas". Say which it was.
    return { ok: false, error: 'no_provider', options: [], note: `No text provider answered, so there are no options to show: ${e.message}. Connect a provider on the Connections page, or fill this field in by hand.` };
  }

  let parsed = [];
  try {
    const j = callLLM.parseJSON(typeof raw === 'string' ? raw : (raw && raw.text) || '');
    parsed = Array.isArray(j) ? j : (j.options || j.values || []);
  } catch (_) {
    return { ok: false, error: 'unparseable', options: [], note: 'The provider answered with something that was not the requested JSON. Nothing is shown rather than a half-parsed list.' };
  }

  const seen = new Set();
  const options = parsed
    .map((o) => (typeof o === 'string' ? { value: o, why: '' } : o))
    .filter((o) => o && typeof o.value === 'string' && o.value.trim())
    .map((o) => ({
      value: scrubDashes(String(o.value).trim()).slice(0, spec.kind === 'terms' ? 60 : 400),
      why: scrubDashes(String(o.why || '').trim()).slice(0, 200),
      origin: 'suggestion',
    }))
    .filter((o) => {
      const k = o.value.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, n);

  const { kept, dropped } = verifiedClaimsOnly(options);

  return {
    ok: true,
    field,
    label: spec.label,
    kind: spec.kind,
    options: kept,
    // Reported, not silently removed: a filter that hides its own work looks
    // like a model that never misbehaves.
    dropped,
    disclaimer: 'These are suggestions written by a model from your brand record. They are not read from your website and they are not facts about your brand. Nothing is saved until you pick one, and anything you pick becomes yours to stand behind.',
  };
}

/** The house rule, applied here too. */
function scrubDashes(s) {
  return String(s).replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',');
}

module.exports = { suggest, FIELDS, verifiedClaimsOnly, brandBrief, UNCHECKABLE };
