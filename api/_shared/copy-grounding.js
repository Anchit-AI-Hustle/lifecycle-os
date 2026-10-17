// Copy a model wrote is held to the brand's own words before it is used.
//
// Production, 2026-10-17, Parwah (a care and daily-living brand): the mailer's
// "What you get" read "Essential nutrients / High-quality ingredients /
// Scientific research" and its body "Rich in essential nutrients". None of it
// is on the brand's record or in its catalogue: the copy prompt already says
// "describe the product only with words the brand itself uses", and the model
// wrote them anyway. A prompt is a request; this is the check.
//
// The rule, deterministic and stated:
//   - The FACTS are what the brand says about itself and its product: name,
//     tagline, industry, claims (plain and cited), named offerings, preferred
//     words, and the catalogue row's title, type and description.
//   - A CLAIM WORD is a word that asserts a quality or an outcome (nutrients,
//     quality, scientific, proven, natural, best ...). A sentence or a benefit
//     that uses a claim word the facts do not contain is dropped, never
//     rewritten (rewriting is how a sentence becomes one nobody wrote).
//   - A benefit must also be mostly the brand's words: at least half of its
//     content words appear in the facts. A dropped benefit is replaced by one
//     of the brand's own claims, verbatim, not yet used; with none left, the
//     list is shorter. An empty list renders no "What you get" section.
'use strict';

const STOP = new Set(('a an and the for with your you our from that this into onto have has will can are was were been being its it '
  + 'all any each every more most very just only also over under than then them they their there here what when where which who '
  + 'why how not but yet out off per via get gets got make makes made take takes keep keeps stay stays help helps feel feels '
  + 'now new today day days week back again ever never always like').split(' '));

// Words that state a quality, an ingredient, a result or a standing: each is a
// fact about the product, so each must be the brand's.
const CLAIM_WORDS = ('nutrient nutrients nutrition nutritious vitamin vitamins mineral minerals protein fibre fiber '
  + 'ingredient ingredients formula formulation formulated quality high-quality premium luxury luxurious '
  + 'pure purest natural organic fresh freshest clean authentic genuine original handmade handcrafted crafted artisanal '
  + 'scientific science research researched clinical clinically proven tested certified approved recommended '
  + 'doctor doctors expert experts dermatologist award award-winning best finest leading top trusted favourite favorite '
  + 'healthy healthier health wellness immunity immune energy boost boosts boosting cure cures heal heals healing '
  + 'safe safest effective guaranteed guarantee instant instantly sustainable eco-friendly vegan gluten sugar-free '
  + 'durable waterproof lightweight comfortable ergonomic secure').split(' ');
const CLAIM = new Set(CLAIM_WORDS);

function stem(w) {
  return w.replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '');
}
function words(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function content(text) { return words(text).filter((w) => w.length >= 4 && !STOP.has(w)); }

/** Everything the brand states about itself and this product, as one bag of stems. */
function factsFor(brand, product) {
  const b = brand || {};
  const p = product || {};
  const parts = [b.name, b.tagline, b.industry, b.description,
    ...(Array.isArray(b.claims) ? b.claims : []),
    ...(Array.isArray(b.approved_claims) ? b.approved_claims.map((c) => (c && c.text) || c) : []),
    ...(Array.isArray(b.offerings) ? b.offerings.map((o) => [o && o.name, o && o.kind, o && o.description].join(' ')) : []),
    ...((b.voice && Array.isArray(b.voice.preferred)) ? b.voice.preferred : []),
    p.title, p.n, p.category, p.type, p.subtitle, p.description, p.tags];
  const bag = new Set();
  for (const part of parts) for (const w of words(part)) { bag.add(w); bag.add(stem(w)); }
  return { bag, claims: [...new Set([...(Array.isArray(b.claims) ? b.claims : []), ...(Array.isArray(b.approved_claims) ? b.approved_claims.map((c) => (c && c.text) || '') : [])].filter(Boolean).map(String))] };
}

const has = (facts, w) => facts.bag.has(w) || facts.bag.has(stem(w));

/** The claim words a piece of copy uses that the facts do not contain. */
function unbacked(text, facts) {
  const ws = words(text);
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const pair = i + 1 < ws.length ? w + '-' + ws[i + 1] : '';
    const hit = CLAIM.has(w) ? w : (CLAIM.has(stem(w)) ? stem(w) : '');
    if (pair && CLAIM.has(pair) && !has(facts, ws[i + 1])) out.push(pair);
    else if (hit && !has(facts, w)) out.push(w);
  }
  return [...new Set(out)];
}

/** Sentences of `text` that state nothing the facts do not; `dropped` says what went and why. */
function groundText(text, facts, dropped, field) {
  const s = String(text || '').trim();
  if (!s) return s;
  const parts = s.match(/[^.!?]+[.!?]*\s*/g) || [s];
  const kept = [];
  for (const part of parts) {
    const bad = unbacked(part, facts);
    if (bad.length) dropped.push({ field, text: part.trim(), words: bad });
    else kept.push(part);
  }
  return kept.join('').trim();
}

/** A benefit list held to the facts, refilled from the brand's own claims. */
function groundList(list, facts, dropped, field, max) {
  const items = (Array.isArray(list) ? list : []).map((x) => String(x || '').trim()).filter(Boolean);
  const kept = [];
  for (const it of items) {
    const bad = unbacked(it, facts);
    const cw = content(it);
    const mine = cw.filter((w) => has(facts, w)).length;
    if (bad.length || (cw.length && mine / cw.length < 0.5)) { dropped.push({ field, text: it, words: bad.length ? bad : ['not the brand\'s words'] }); continue; }
    kept.push(it);
  }
  const lower = new Set(kept.map((k) => k.toLowerCase()));
  for (const c of facts.claims) {
    if (kept.length >= (max || 3)) break;
    if (!lower.has(c.toLowerCase())) { kept.push(c); lower.add(c.toLowerCase()); }
  }
  return kept.slice(0, max || 3);
}

/**
 * Holds one model answer (the copy JSON the copywriter returns) to the facts,
 * in place. Returns the list of what was dropped, so the campaign can say so.
 */
function groundCopy(copy, brand, product) {
  const dropped = [];
  if (!copy || typeof copy !== 'object') return dropped;
  const facts = factsFor(brand, product);
  const e = copy.email || {};
  for (const f of ['hero_subline', 'hook', 'intro_paragraph', 'body_paragraph', 'ps', 'preheader']) {
    if (typeof e[f] === 'string') e[f] = groundText(e[f], facts, dropped, 'email.' + f);
  }
  if (Array.isArray(e.benefits)) e.benefits = groundList(e.benefits, facts, dropped, 'email.benefits', 3);
  const l = copy.landing || {};
  for (const f of ['hero_sub']) if (typeof l[f] === 'string') l[f] = groundText(l[f], facts, dropped, 'landing.' + f);
  if (Array.isArray(l.why_bullets)) l.why_bullets = groundList(l.why_bullets, facts, dropped, 'landing.why_bullets', 3);
  const a = copy.ads || {};
  if (a.meta) for (const f of ['primary_text', 'description']) if (typeof a.meta[f] === 'string') a.meta[f] = groundText(a.meta[f], facts, dropped, 'ads.meta.' + f);
  if (a.google && Array.isArray(a.google.descriptions)) {
    a.google.descriptions = a.google.descriptions.filter((d) => {
      const bad = unbacked(d, facts);
      if (bad.length) dropped.push({ field: 'ads.google.descriptions', text: d, words: bad });
      return !bad.length;
    });
  }
  if (a.tiktok && typeof a.tiktok.caption === 'string') a.tiktok.caption = groundText(a.tiktok.caption, facts, dropped, 'ads.tiktok.caption');
  return dropped;
}

module.exports = { groundCopy, factsFor, unbacked, CLAIM_WORDS };
