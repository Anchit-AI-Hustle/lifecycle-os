'use strict';
// A PRODUCT'S OWN STORY, IN THE STORE'S OWN WORDS (2026-11-08).
//
// The operator, after a simulation of every asset: "ads are still awful -
// landing pages also very basic - no information on why to buy those products
// or details like that which increase sales", then "even update for mailers".
// The store's description ("cold-pressed from wild rosehip seeds, rich in
// vitamin A, absorbs in under a minute, use 3 to 4 drops at night") was on the
// landing page once and in no ad, no benefit list and no answer to "how do I
// use it". With no model answering, the reasons to buy are already in the
// catalogue: this module sorts them.
//
// Every line it returns is a SENTENCE OF THE STORE'S OWN DESCRIPTION, verbatim
// (tidied of markup and spacing only). Nothing is paraphrased, combined or
// invented, so nothing here can be a claim the brand did not make. Sentences
// are sorted by what they do for a buyer:
//   what     - the first sentence: what the product is
//   benefits - what it does for you (an effect, a feel, a fit, a result)
//   inside   - what it is made of or holds
//   how      - how to use it (an instruction)
//   specs    - label/value pairs the row states (type, size, weight, variants)
// Store boilerplate (shipping, returns, "click", links, disclaimers) is left out.

const MARKER = /\[\s*DATA REQUIRED/i;
const BOILER = /\b(ship|shipping|deliver|delivery|dispatch|return|refund|exchange|cash on delivery|\bcod\b|click|tap here|add to cart|buy now|shop now|order now|sku|disclaimer|terms|policy|subscribe|newsletter|follow us|whatsapp|call us|email us|customer care|warranty card|limited stock|hurry|while stocks?)\b/i;
const HOW = /^(use|apply|wear|drink|brew|steep|add|mix|take|wash|rinse|pair|massage|spray|plug|charge|install|store|serve|cook|heat|pour|shake|dab|gently|simply|just|for best results|directions?|how to use|to use)\b/i;
const HOW_ANY = /\b(how to use|directions|apply|massage into|leave on|times a day|once a day|twice a day|every morning|every night|at night|before bed|drops? (on|onto|into))\b/i;
const INSIDE = /\b(made (from|with|of|in)|crafted (from|with|in)|contains?|ingredients?|rich in|packed with|blend of|infused with|pressed from|sourced from|derived from|formulated with|material|fabric|cotton|linen|wool|leather|steel|aluminium|aluminum|glass|ceramic|bamboo|silk|beans?|leaves|grown in|roasted)\b/i;
const BENEFIT = /\b(helps?|keeps?|leaves?|absorbs?|protects?|lasts?|fits?|feels?|gives?|reduces?|boosts?|softens?|hydrates?|nourish\w*|smooth\w*|soothe?s?|brightens?|strengthens?|repairs?|lightweight|light|durable|waterproof|water.resistant|breathable|comfortable|comfort|easy|quick\w*|fast|without|no (greasy|sticky|added|harsh)|in (under|just|about) \d|all day|long.lasting|every day|daily|perfect for|ideal for|great for|designed (for|to)|so you|lets you|you can|you get|stays?|holds?|works?|charges?|cleans?|refreshes?)\b/i;

function clean(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[–—]/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/([.!?])\s*\.(?=\s|$)/g, '$1')
    .replace(/^[\s.]+/, '')
    .trim();
}

// Sentences of the description, each ending in its own stop.
function sentences(text) {
  const t = clean(text);
  if (!t) return [];
  const parts = t.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/);
  const out = [];
  const seen = new Set();
  for (let p of parts) {
    p = p.replace(/^[\s.,;:•*\-]+/, '').replace(/\s*\.(\s*\.)+$/, '.').trim();
    if (!p) continue;
    // Judged as the store wrote it, before a stop is added: an attribute list
    // with a stop added would read as a sentence.
    try { if (!require('./mailer-format.js').isProse(p)) continue; } catch (_) { /* keep */ }
    if (!/[.!?]$/.test(p)) p += '.';
    const words = p.split(/\s+/).length;
    if (words < 3 || p.length > 220) continue;
    if (MARKER.test(p) || /https?:\/\/|www\./i.test(p)) continue;
    if (BOILER.test(p)) continue;
    // A heading glued onto a list ("Key benefits. ...") is not a sentence, and
    // neither is a store's attribute list ("Trendy Maroon Brown Gradient Full
    // Rim Round Tints Sunglasses."): mailer-format.isProse decides, as it does
    // for every caption.
    if (!/[a-z]/.test(p)) continue;
    const k = p.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function kindOf(s) {
  if (HOW.test(s) || HOW_ANY.test(s)) return 'how';
  if (BENEFIT.test(s)) return 'benefit';
  if (INSIDE.test(s)) return 'inside';
  return 'other';
}

/**
 * story(product, { name }) -> { what, benefits, inside, how, specs, any }
 * `product` is a catalogue row or a slot's hero ({ title, description,
 * body_html, subtitle, type, category, size, weight, variants }).
 */
function story(product, opts = {}) {
  const p = product || {};
  const empty = { what: '', benefits: [], inside: [], how: [], specs: [], any: false };
  if (!p || p.placeholder || MARKER.test(String(p.title || ''))) return empty;
  const src = [p.description, p.body_html, p.body, p.subtitle].find((x) => String(x || '').trim()) || '';
  const list = sentences(src);
  const out = { what: '', benefits: [], inside: [], how: [], specs: [], any: false };
  list.forEach((s, i) => {
    const k = kindOf(s);
    if (i === 0 && k !== 'how') { out.what = s; if (k === 'benefit') return; return; }
    if (k === 'how') out.how.push(s);
    else if (k === 'benefit') out.benefits.push(s);
    else if (k === 'inside') out.inside.push(s);
    else out.benefits.push(s);
  });
  // The first sentence also reads as a reason when it is one ("A lightweight
  // face oil that absorbs in under a minute."); it stays `what`, and is the
  // last resort for a reason when the description has no other.
  if (!out.benefits.length && out.what && BENEFIT.test(out.what)) out.benefits.push(out.what);
  const spec = (label, v) => { const t = String(v == null ? '' : v).trim(); if (t && !MARKER.test(t) && t.length <= 60) out.specs.push({ label, value: t }); };
  const type = p.type || p.product_type || (p.category && !/[,;|]/.test(String(p.category)) ? p.category : '');
  spec('Type', type);
  spec('Size', p.size);
  spec('Weight', p.weight);
  const vs = Array.isArray(p.variants) ? p.variants.map((v) => String((v && (v.title || v.name)) || '').trim()).filter((t) => t && !/^default/i.test(t)) : [];
  if (vs.length > 1) spec('Options', vs.slice(0, 6).join(', '));
  out.benefits = out.benefits.slice(0, 4);
  out.inside = out.inside.slice(0, 2);
  out.how = out.how.slice(0, 2);
  out.any = !!(out.what || out.benefits.length || out.inside.length || out.how.length);
  void opts;
  return out;
}

// The first line from `lines` that fits `max` characters, whole; else ''.
function fitting(max, ...lines) {
  for (const l of [].concat(...lines)) { const t = String(l || '').trim(); if (t && t.length <= max) return t; }
  return '';
}

// Questions a buyer asks, answered ONLY with the store's own sentences.
// The page is about one product, so a question says "it" (2026-11-08: "What is
// Rosehip Face Oil 30-millilitre made of?"); a size the name already states is
// not asked.
function faq(st, name) {
  const out = [];
  const n = String(name || '');
  if (st.how[0]) out.push({ q: 'How do I use it?', a: st.how.join(' ') });
  if (st.inside[0]) out.push({ q: 'What is it made of?', a: st.inside.join(' ') });
  const size = st.specs.find((s) => s.label === 'Size' || s.label === 'Weight');
  const fold = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (size && fold(n).indexOf(fold(size.value)) < 0) out.push({ q: 'What size is it?', a: `${size.value}.` });
  const opts = st.specs.find((s) => s.label === 'Options');
  if (opts) out.push({ q: 'Which options does it come in?', a: `${opts.value}.` });
  return out;
}

module.exports = { story, sentences, fitting, faq, clean };
