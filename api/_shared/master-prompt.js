'use strict';

/**
 * Master-prompt builder — the single, portable "copy anywhere" prompt.
 *
 * Every generated asset (mailer / ad / landing page) carries a `master_prompt`:
 * one self-contained block a human can paste into a BLANK ChatGPT, Claude, or
 * Gemini session and get the same top-tier, on-brand output the app produces —
 * with zero prior context. So the brand rules, catalog facts, regional details,
 * and the exact output contract are all baked into the string itself.
 *
 * This module is also the single source of truth for the brand constraint block
 * (BRAND_BLOCK) — other prompt sites should import it rather than re-deriving it.
 */

const assetSpecs = require('./asset-specs');

// ── Brand constants ─────────────────────────────────────────────────────────
// DERIVED, never hand-written. The single source of brand truth is
// data/brands/_default.json (tenant zero); brand-runtime.brandBlock() renders
// it into the prompt block below at require-time. A hardcoded copy here is what
// previously let the palette be right in the CSS and wrong in the prompt.
//
// Per-request, brand-aware callers should prefer brandRuntime.brandBlock(brand)
// with the resolved workspace; BRAND_BLOCK stays exported as tenant zero's
// block so existing callers keep working unchanged.
const brandRuntime = require('./brand-runtime.js');
const BRAND_BLOCK = brandRuntime.brandBlock(brandRuntime.defaultBrand());

// ── Regional facts ──────────────────────────────────────────────────────────
const REGION = {
  US: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: '$', locale: 'en-US' },
  UK: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: '£', locale: 'en-GB' },
  IN: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: '₹', locale: 'en-IN' },
  EU: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: '€', locale: 'en-IE' },
  AU: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: 'A$', locale: 'en-AU' },
  Global: { store: 'knickgasm.com', presell: 'knickgasm.com', currency: '$', locale: 'en' },
};
function regionFacts(market) { return REGION[market] || REGION.Global; }

// ── Product context ─────────────────────────────────────────────────────────
function productLines(products = [], currency = '', brandName = brandRuntime.defaultBrand().name) {
  const list = (Array.isArray(products) ? products : []).filter(Boolean).slice(0, 8);
  if (!list.length) return `(no specific products supplied. Refer to ${brandName} only by the offerings named in this brief. Do NOT invent a product name, price, or URL.)`;
  const rows = list.map((p) => {
    const title = String(p.title || p.name || p.t || '').trim();
    if (!title || /\[DATA REQUIRED/i.test(title)) return '';
    const price = p.price ?? p.p;
    const cat = p.category || p.cat || p.c || '';
    const unit = p.unit_spec || (p.specs && p.specs.weight) || '';
    const pcs = p.piece_count || (p.specs && p.specs.piece_count) || '';
    // Proof only from what the store states (offering-intelligence), never a stored badge.
    let badge = '';
    try { badge = require('./offering-intelligence.js').enrich(Object.assign({ title, product_url: p.product_url || p.url }, p)).proof.map((x) => x.text).join('; '); } catch (_) { badge = ''; }
    const claims = Array.isArray(p.claims) && p.claims.length ? `its page says: ${p.claims.slice(0, 4).join(', ')}` : '';
    const readTime = p.read_time || '';
    const author = p.author ? `by ${p.author}` : '';
    const page = /^https?:\/\//i.test(String(p.product_url || p.url || '')) ? String(p.product_url || p.url) : '';
    const details = [
      price != null ? `${currency}${price}${unit ? ' for ' + require('./unit-words.js').spellUnits(String(unit).replace(/^(\d+(?:\.\d+)?)([a-z])/i, '$1 $2')) : ''}` : '',
      pcs,
      claims,
      readTime,
      author,
      badge,
      cat,
      page ? `page: ${page}` : '',
    ].filter(Boolean).join(' · ');
    return `- ${title}${details ? ` (${details})` : ''}`;
  }).filter(Boolean);
  return rows.length ? rows.join('\n') : `(no specific products supplied. Refer to ${brandName} only by the offerings named in this brief. Do NOT invent a product name, price, or URL.)`;
}

function promptProducts(products) {
  return (Array.isArray(products) ? products : []).filter((p) => p && String(p.title || p.name || p.t || '').trim() && !/\[DATA REQUIRED/i.test(String(p.title || p.name || p.t)));
}
/* The offerings the brand's own record names, for a send with no product
   (2026-11-08). The product fallback says "refer to the brand only by the
   offerings named in this brief", and an events, services, news or club brand's
   brief named none: the outside model wrote about "Ridgefest" with no idea it
   runs the Sahyadri 50. Only offerings on the brand's own site, never another
   template's (template-offerings), each with its own page when it has one. */
function offeringLines(brand) {
  if (!brand || isShippedDefault(brand)) return '';
  let list = Array.isArray(brand.offerings) ? brand.offerings : [];
  try {
    const TPL = require('./template-offerings.js');
    const foreign = TPL.foreignTemplateOfferings(brand);
    list = list.filter((o) => !TPL.offeringFromOtherTemplate(o, foreign));
  } catch (_) { /* keep the record's own list */ }
  let coh = null;
  try { coh = require('./brand-coherence.js'); } catch (_) { coh = null; }
  const home = String(brand.website || '');
  const homeDom = coh && home ? coh.registrableDomain(coh.hostOf(/^https?:/i.test(home) ? home : `https://${home}`)) : '';
  const K = require('./offering-kinds.js');
  const rows = [];
  for (const o of list.slice(0, 8)) {
    const name = String((o && o.name) || '').trim();
    if (!name || /\[DATA REQUIRED/i.test(name)) continue;
    const page = K.pageOf(o);
    if (page && coh && homeDom) { const d = coh.registrableDomain(coh.hostOf(page)); if (d && !coh.sameBrand(d, homeDom)) continue; }
    const kind = (K.normalizeOffering(o) || {}).kind || '';
    const label = { plan: 'subscription or membership', programme: 'recurring programme', section: 'section', story: 'story', service: 'service', event: 'event' }[kind] || '';
    rows.push(`- ${name}${label || page ? ` (${[label, page ? `page: ${page}` : ''].filter(Boolean).join(' · ')})` : ''}`);
  }
  return rows.length ? `WHAT ${String(brand.name || 'THE BRAND').toUpperCase()} OFFERS (its own record; name only these, with no price or date this brief does not state):\n${rows.join('\n')}` : '';
}

/**
 * A person pastes this into a blank Claude, ChatGPT, or Gemini session.
 * The app's own gap marker is for the operator's record, not for the asset
 * a model writes back, so it is rewritten as "leave it out".
 */
function forExternalModel(block) {
  let s = String(block || '');
  s = s.replace(
    /If a fact you need was not supplied, write \[DATA REQUIRED BEFORE LAUNCH:[^\]]*\] in its place instead of inventing one\./,
    'If a fact you need was not supplied, leave that line or section out. Never invent it. Never print a bracket marker, a placeholder, or an unfilled tag such as {{name}}.'
  );
  s = s.replace(/\[DATA REQUIRED BEFORE LAUNCH:[^\]]*\]/g, 'not on record (leave it out; do not invent it)');
  s = s.replace(
    /FOOTER: "Privacy Policy" and "Terms of Service" must be plain labels with href="#" and no target\/onclick routing\./,
    'FOOTER: link Privacy and Terms only to https addresses this brief lists. If none are listed, print the words as text with no link. Never use href="#".'
  );
  return s;
}

function factText(v) {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!t || /\[DATA REQUIRED BEFORE LAUNCH:/i.test(t) || /\{\{/.test(t) || /^data:/i.test(t)) return '';
  return t.slice(0, 500);
}

function offerLine(offer) {
  const o = offer && typeof offer === 'object' ? offer : null;
  if (!o) return 'OFFER: none supplied in this brief. Invent no discount, code, deadline, or stock line.';
  let pct = Number(o.pct);
  if (Number.isFinite(pct) && pct > 0 && pct < 1) pct *= 100;
  pct = Number.isFinite(pct) && pct > 0 ? Math.round(pct) : 0;
  const code = factText(o.code);
  const bits = [];
  if (o.depth && o.depth !== 'none') bits.push(String(o.depth));
  if (pct) bits.push(`${pct}% off`);
  if (code) bits.push(`code ${code}`);
  if (!bits.length) return 'OFFER: none on record. Invent no discount, code, deadline, or stock line.';
  return `OFFER (use exactly this and add nothing): ${bits.join(', ')}.`;
}

function linkLines(links, brand) {
  const rows = [];
  const seen = new Set();
  const add = (label, v) => {
    const t = factText(v);
    if (!t || !/^https?:\/\//i.test(t) || seen.has(t)) return;
    seen.add(t);
    rows.push(`- ${label}: ${t}`);
  };
  const L = links && typeof links === 'object' ? links : {};
  add('Homepage', brand && brand.website);
  add('Store', L.store);
  add('Page for this send', L.pdp || L.pdpUrl);
  add('Collection or offering', L.collectionUrl);
  if (!rows.length) return 'LINKS: none on record. Do not invent a URL, a /products/ path, or an href="#". Omit the button, or print its words as text.';
  return `LINKS (the only addresses you may use):\n${rows.join('\n')}`;
}

function writtenLines(written) {
  if (!written || typeof written !== 'object') return '';
  const rows = [];
  const add = (label, v) => {
    if (Array.isArray(v)) {
      const items = v.map(factText).filter(Boolean);
      if (items.length) rows.push(`- ${label}: ${items.join(' | ')}`);
      return;
    }
    const t = factText(v);
    if (t) rows.push(`- ${label}: ${t}`);
  };
  add('Subject', written.subject);
  add('Preheader', written.preheader);
  add('Headline', written.headline);
  add('Primary text', written.primary_text);
  add('Description', written.description);
  add('Caption', written.caption);
  add('Button', written.cta);
  add('Message', written.text || written.body);
  add('Title', written.title);
  add('Shots', written.shots);
  if (!rows.length) return '';
  return `LINES THIS SEND ALREADY USES (reproduce these facts; do not add a fact, name, price, or number they do not state):\n${rows.join('\n')}`;
}

function banBlock(brand) {
  let model = 'commerce';
  try { model = assetPlaybooks.businessModel(promptBrand(brand)); } catch (_) { model = 'commerce'; }
  const lines = [
    'BANS:',
    '- State only facts written in this brief. No invented claim, testimonial, review, rating, reviewer name, statistic, subscriber or reader count, guarantee, deadline, stock line, or another brand\'s name.',
    '- No unfilled tag (for example {{name}} or {{landing_page_url}}) and no bracket marker in anything a person reads.',
    '- No href="#", no guessed product path, and no URL this brief does not list.',
    '- Write units the way a person says them ("500 millilitres", not "500ml"). A model code stays as written.',
    '- Grounds are the brand colour or its surface. Never a black or dark-neutral section background.',
  ];
  const v = (brand && brand.voice) || {};
  if (v.no_em_dashes !== false) lines.push('- No em dashes or en dashes in the copy. Use commas, colons, or plain hyphens.');
  if (model !== 'commerce') lines.push('- This brand is not a shop. Do not write about an order, a cart, a checkout, or a customer, and do not use shop wording.');
  return lines.join('\n');
}

/** Section order from the playbook, without other brands' names or sample headlines. */
function externalPlaybook(brand, assetType, variant, market) {
  const t = String(assetType || 'mailer').toLowerCase();
  const key = t === 'ad' ? 'ad_meta' : (t === 'landing_page' || t === 'lp') ? 'landing_page' : (variant === 'V1' ? 'mailer_v1' : 'mailer_v2');
  let pb = null;
  try { pb = assetPlaybooks.playbookFor(brand, key); } catch (_) { pb = null; }
  if (!pb) return '';
  const plain = (s) => String(s || '')
    .replace(/\s*e\.g\.\s*"[^"]*"/gi, '')
    .replace(/"[^"]{8,}"/g, '')
    .replace(/Sensory copywriting explaining what makes this piece unique\.?/i, 'How it is made, only in words this brief already uses.')
    .replace(/\d+\s+to\s+\d+\s+punchy[^.]+/i, 'Updates this brief already states.')
    .replace(/\s+/g, ' ')
    .trim();
  const sections = (pb.sections || []).map((s, i) => `  ${i + 1}. ${s.name}: ${plain(s.purpose)} Only facts this brief states.${s.required ? '' : ' Omit the section otherwise.'}`).join('\n');
  const lines = [
    `STRUCTURE (order only; every fact comes from this brief, never from another brand):`,
    sections,
    'A section you cannot fill from this brief is left out. Do not invent a story, a number, a desk, a quote, or another brand to fill it.',
    assetPlaybooks.BORROW_RULE,
  ];
  if (pb.businessModel === 'market_data') {
    try { lines.push(`Close with this disclaimer, exactly, and write nothing that contradicts it: "${assetPlaybooks.financialDisclaimer(market, brand)}"`); } catch (_) {}
  }
  return lines.filter(Boolean).join('\n');
}

// ── Brand-derived creative facts ────────────────────────────────────────────
// Everything a contract needs that used to be hardcoded tenant-zero copy
// (audio beds, audience, proposition, palette hexes) now derives from the
// ACTIVE brand record, with an explicit DATA-REQUIRED marker where the brand
// has not supplied the fact — never another brand's value.
/**
 * The brand a prompt is FOR (2026-10-10): the record passed, else the brand
 * the request resolved, else tenant zero only with nothing in scope. Every
 * site here tested `brand.id`, so a carried device brand worked and the
 * UNRESOLVED placeholder (a signed-in account with no workspace) was briefed
 * as tenant zero - its name, palette, claims, legal sender and audio beds.
 */
function promptBrand(brand) {
  try { return brandRuntime.scopedBrand(brand || null, { allowTenantZero: true }) || brandRuntime.defaultBrand(); } catch (_) { return brand || brandRuntime.defaultBrand(); }
}
/** The shipped default record itself (no request, no workspace): tenant zero's own prompt. */
function isShippedDefault(b) { return !b || b === brandRuntime.defaultBrand(); }

function creativeFacts(brand) {
  const zero = brandRuntime.defaultBrand();
  const b = promptBrand(brand);
  let isZero = isShippedDefault(b);
  if (!isZero) { try { isZero = require('./brand-catalog-server.js').isTenantZeroBrand(b) === true; } catch (_) { isZero = false; } }
  const name = b.name || zero.name || 'the brand';
  const p = b.palette || {};
  const hexes = ['primary', 'accent', 'surface', 'ink'].map((k) => p[k]).filter(Boolean);
  // Markers are UNPADDED: `field, <brand>` (2026-10-05), never "all, all".
  const paletteList = hexes.length ? hexes.join(' / ') : `[DATA REQUIRED BEFORE LAUNCH: brand palette, ${name}]`;
  const t = b.typography || {};
  const fonts = `${(t.heading && t.heading.family) || '[DATA REQUIRED BEFORE LAUNCH: heading font]'} headings / ${(t.body && t.body.family) || '[DATA REQUIRED BEFORE LAUNCH: body font]'} body`;
  const claims = (Array.isArray(b.claims) && b.claims.length)
    ? b.claims.map((c) => require('./unit-words.js').spellUnits(String(c))).join(' · ')
    : `[DATA REQUIRED BEFORE LAUNCH: verifiable brand claims, ${name}]`;
  const industry = b.industry || 'its industry';
  // The named .wav beds are tenant zero's own repo assets. No other brand may
  // be scored to them; a brand without a bed on file gets a marker, not a loan.
  const audio = isZero
    ? `a ${name}-owned original bed from /assets/media/ (knickgasm-brand-beat.wav 32s hero · knickgasm-reels-loop.wav 16s short · knickgasm-ad-underscore.wav 22s under-voiceover) — 90 BPM, F minor, seamless loop, royalty-free for paid media. State the bed by filename and the beat-sync points`
    : `a ${name}-owned, original, royalty-free audio bed; if none is on file for this brand, write [DATA REQUIRED BEFORE LAUNCH: brand audio bed, ${name}] instead of naming one`;
  return { name, isZero, paletteList, fonts, claims, industry, audio };
}

// ── Per-asset output contracts ──────────────────────────────────────────────
// The visual cascade for every visual asset, in the order the operator chose:
const VISUAL_CASCADE = `VISUALS: use only a hosted image or video URL this brief lists, the product's own photograph first. With none listed, leave the picture out: never a generated, placeholder or invented image. A photograph carries no words baked into it (text lives in the layout) unless the asset is an ad creative.`;
/* What a picture may be, by the brand's own kind of business (2026-11-08,
   asset brand-fit review). Every mailer and landing page prompt carried one
   commerce cascade ("product image ... e.g. a Shopify product video", "product
   photography", "describe an auto-generated GIF the team can produce"): a news
   or market-data brand was told to picture a product it does not sell, against
   its own image policy (asset-playbooks.IMAGE_POLICIES), and the outside model
   was told to make a GIF the output requirement forbids it to embed. */
function visualsFor(brand) {
  const model = brand ? assetPlaybooks.businessModel(brand) : 'commerce';
  if (model === 'commerce') return VISUAL_CASCADE;
  const pol = assetPlaybooks.imagePolicyFor(brand) || {};
  const order = (pol.sourceOrder || []).map((x) => String(x).replace(/^\d+\.\s*/, '').replace(/[.\s]+$/, '')).join('; ');
  const never = (pol.never || []).map((x) => String(x).replace(/^NEVER\s+/i, '').replace(/[.\s]+$/, '')).join('; ');
  // The policy's own prose carries dashes; the prompt that bans them does not.
  return `VISUALS: only a hosted image URL this brief lists, and of this kind, in this order: ${order}. A kind with no URL listed is left out: never a generated, placeholder or invented image.${never ? ` Never ${never}.` : ''}`.replace(/\s*[\u2013\u2014]\s*/g, ', ');
}

/*
 * These describe what the FINISHED email contains, not what to write about it.
 *
 * V2 previously opened item 2 with "Section-by-section layout: for each section
 * give the COPY and the VISUAL". That is an instruction to produce a PLAN, and
 * it sat in the same prompt as a deliverable line saying "not a
 * section-by-section outline". Given a contradiction, a model resolves it, and
 * a breakdown is easier to produce than a finished email — so the outline is
 * what came back. Both halves now ask for the same artefact.
 */
const assetPlaybooks = require('./asset-playbooks.js');

/*
 * These describe what the FINISHED email contains, not what to write about it.
 *
 * V2 previously opened item 2 with "Section-by-section layout: for each section
 * give the COPY and the VISUAL". That is an instruction to produce a PLAN, and
 * it sat in the same prompt as a deliverable line saying "not a
 * section-by-section outline". Given a contradiction, a model resolves it, and
 * a breakdown is easier to produce than a finished email — so the outline is
 * what came back. Both halves now ask for the same artefact.
 */
function mailerContract(variant, cf, brand, market) {
  cf = cf || creativeFacts(null);
  const model = brand ? assetPlaybooks.businessModel(brand) : 'commerce';

  if (model === 'market_data') {
    const disclaimer = assetPlaybooks.financialDisclaimer(market, brand);
    if (variant === 'V1') {
      return `ASSET: Email mailer, VARIANT V1 (TYPOGRAPHIC, no imagery).
A high-signal financial intelligence briefing that stands on its own with zero images: typography, data hierarchy, and editorial clarity do all the work.
It must CONTAIN, in this order:
1. Subject lines and preheader (3 subject options and 1 preheader, in their own sections before the HTML, inside the limits the OUTPUT REQUIREMENT states).
2. Session dateline and reading time, only when this brief states them.
3. Market Pulse: index figures strictly from numbers this brief states. Name no index it does not name.
4. Lead Catalyst / The Big Move: only a development this brief states.
5. Sector Watchlist: only sectors this brief names. Otherwise omit the list.
6. A membership callout only when this brief states a membership. One primary button.
7. Regulatory Disclaimer, exactly: "${disclaimer}".
Leave out any section this brief cannot fill. Do not invent a figure, a ticker, a quote, or a reader count.
Compact and executive-ready. Because there are no images, every structural cue has to be typographic: weight, size, rules and generous space.`;
    }
    return `ASSET: Email mailer, VARIANT V2 (TYPOGRAPHIC + VISUAL).
The same financial intelligence persuasion as V1, laid out with verified data visuals. A finished email, not a layout plan.
It must CONTAIN, in this order:
1. Subject lines and preheader (3 options and 1 preheader, in their own sections before the HTML).
2. Executive Terminal Masthead: date, edition name, estimated read time.
3. Market Pulse & Benchmark Bar: key index benchmarks from supplied numbers.
4. Lead Catalyst Story: only a development this brief states, with a hosted chart only when this brief gives its URL. NEVER hallucinate fake charts or fictional tickers.
5. Sector Radar: only sectors this brief names. Otherwise omit the list.
6. A premium card only when this brief states one, with one primary button.
7. Regulatory Compliance Footer: "${disclaimer}".
Email-client-safe throughout: bgcolor on every coloured cell for Outlook, and around two to three scrolls in total.
Leave out any section this brief cannot fill. Do not invent a figure, a ticker, a quote, or a reader count.
${visualsFor(brand)}`;
  }

  if (model === 'news_media') {
    if (variant === 'V1') {
      return `ASSET: Email mailer, VARIANT V1 (TYPOGRAPHIC, no imagery).
An authoritative editorial news briefing that stands on its own with zero images: typography, journalistic hierarchy, and smart brevity do all the work.
It must CONTAIN, in this order:
1. Subject lines and preheader (3 subject options and 1 preheader, in their own sections before the HTML, inside the limits the OUTPUT REQUIREMENT states).
2. Publication masthead line (date, edition, read time).
3. Lead Story: headline, context, and a bolded "Why it matters" paragraph.
4. Bulletin Radar: only updates this brief states. Otherwise omit the list.
5. A membership line only when this brief states a membership. One primary button.
6. Editorial colophon. Leave out any section this brief cannot fill. Do not invent a reader count, a logo, or a quote.
Compact and scannable. Because there are no images, every structural cue has to be typographic: weight, size, rules and generous space.`;
    }
    return `ASSET: Email mailer, VARIANT V2 (TYPOGRAPHIC + VISUAL).
The same editorial briefing as V1, laid out with imagery. A finished email, not a layout plan.
It must CONTAIN, in this order:
1. Subject lines and preheader (3 options and 1 preheader, in their own sections before the HTML).
2. Publication masthead with reading time and edition name.
3. Lead Story: headline, opening context, editorial photo as an <img> pointing at a hosted story image, and bolded "Why it matters".
4. By The Numbers / Data snippet (only from supplied numbers).
5. Quick Scans / Bulletin Radar: only updates this brief states.
6. A member perk only when this brief states one, with one primary button.
7. Colophon and reader feedback, only when this brief states them.
Email-client-safe throughout: bgcolor on every coloured cell for Outlook, and around two to three scrolls in total.
Leave out any section this brief cannot fill. Do not invent a reader count, a logo, a quote, a chart, a ticker, or a number.
${visualsFor(brand)}`;
  }

  if (variant === 'V1') {
    return `ASSET: Email mailer, VARIANT V1 (text only, no imagery except the logo).
A finished email a person can read, built only from the facts in this brief. Not a copy deck and not a description of an email.
It contains, and a part with no fact is left out:
1. Subject lines and a preheader (3 subjects and 1 preheader, inside the limits the OUTPUT REQUIREMENT states). The preheader does not repeat the subject.
2. The brand logo, linked to the homepage this brief lists, then the headline and the opening line this brief states.
3. The body, using only the lines and claims this brief states. Do not list the same benefit twice.
4. One call to action, in the button words this brief states, linking only to a URL this brief lists.
5. The legal sender and an unsubscribe line.
No product photograph. No testimonial, rating, review count, or guarantee unless this brief states one.`;
  }
  return `ASSET: Email mailer, VARIANT V2 (text and a real photograph).
The same email as the text-only variant, with imagery. A finished email, not a layout plan.
It contains, and a part with no fact is left out:
1. Subject lines and a preheader (3 subjects and 1 preheader) before the HTML.
2. The logo linked to the homepage, the headline, and the hero product's own photograph as an <img> using a hosted https URL this brief lists. No URL listed: omit the picture. Never a placeholder service, never an invented URL, never base64.
3. The product's name, the store's own description, and its price only when this brief states them. Other products this brief lists, each with its own photo, name, price, and its own page.
4. The brand's own claims, only the ones written above. The offer bar only when an offer is written above.
5. One closing button to a URL this brief lists, then the legal footer.
Do not write a problem the brief does not state, a sensory after-state, or a testimonial. Score any motion to ${cf.audio}. Never a licensed or trending track.
Email-client-safe throughout: bgcolor on every coloured cell for Outlook, and around two to three scrolls in total.
${visualsFor(brand)}`;
}

// The studio compositor (ad-campaigns.html) renders ONE still PNG per size with
// the text overlay baked in. Be honest about that: list the exact static sizes
// it produces and treat motion as an OPTIONAL hand-off brief, never a delivered
// asset. The text fields (headlines/captions/scripts) are still authored as copy.
function adContract(platform, cf, brand, market) {
  cf = cf || creativeFacts(null);
  const model = brand ? assetPlaybooks.businessModel(brand) : 'commerce';
  // Copy-field limits per platform (authored text). Produced creative SIZES are
  // sourced from asset-specs.js (single source of truth) so every placement size
  // stays canonical and complete across the whole app.
  const copyGuide = {
    google: `Google (Responsive Search + Performance Max): ${copyLimits('google')}; business name.`,
    meta: `Meta (Facebook/Instagram Feed + Reels + Stories): ${copyLimits('meta')}.`,
    instagram: 'Instagram (Feed + Reels + Stories): caption with hook in first line + hashtags.',
    tiktok: `TikTok (In-Feed + Spark): native-feeling video script with a 0-2s hook, on-screen text beats, caption, and 3 hashtag options. AUDIO: score it to ${cf.audio}. Give the exact beat-sync moments (which cut lands on which downbeat). NEVER specify a trending/licensed sound for a paid ad. Always burn in captions: most feed views start muted. The produced creative is a cover keyframe (the script is a brief for a separate shoot/edit).`,
  };
  const sizeKey = assetSpecs.ADS[platform] ? platform : 'meta';
  // onlyProduced: list ONLY the sizes the compositor actually renders, so the
  // prompt never claims deliverables the flow does not generate.
  const spec = (copyGuide[platform] || copyGuide.meta) + ' PRODUCED at each placement: ' + assetSpecs.adSpecText(sizeKey, { onlyProduced: true });

  const complianceRule = model === 'market_data'
    ? `\nFINANCIAL COMPLIANCE RULE: Absolutely NO guaranteed return claims (e.g. "make 10x in 24 hours" or "guaranteed profits"). Visuals must use authentic terminal UI stills, macro data textures, or trading desk photography with unreadable numbers. Include regulatory disclaimer: "${assetPlaybooks.financialDisclaimer(market, brand)}".`
    : (model === 'news_media'
      ? '\nEDITORIAL COMPLIANCE RULE: No fake breaking-news alerts or simulated politician/celebrity portraits. Lead with intellectual curiosity, depth, and smart brevity.'
      : '');

  return `ASSET: Paid ad creative for ${platform.toUpperCase()}: a full ad, not just a picture.
Write every text field the platform requires, inside the limits below, using only the lines and claims in this brief. The still creative uses a hosted photograph this brief lists. Overlay wording is the headline and the offer this brief states, in ${cf.fonts}, using only ${cf.paletteList}. On a 9:16 frame keep text clear of the bottom 20%. If this brief names no audience, do not invent one: speak to the cohort named above, or to the brand's readers in general.
${complianceRule}
Platform spec: ${spec}
Deliver: (a) every text field, each on its own line; (b) for each static size, the still and the overlay wording; (c) the destination, which is a URL this brief lists, or omitted.
One still per size. Never base64. Never a placeholder image service. Never an invented URL. A video is a separate story brief, not this still. Audio, if a video is asked for: ${cf.audio}. Never a trending or licensed track.`;
}

function messageContract(channel) {
  const ch = String(channel || 'sms').toLowerCase();
  const L = assetSpecs.MESSAGING || {};
  if (ch === 'whatsapp') {
    const w = L.whatsapp || {};
    return `ASSET: ONE WhatsApp marketing template, ready to submit for approval.
Shape: HEADER (text, at most ${w.header_text || 60} characters), BODY (at most ${w.body || 1024} characters), FOOTER exactly "Reply STOP to opt out", and one URL button (label at most ${w.button_text || 25} characters) only when this brief lists an https link.
Category MARKETING. Language from the market. No {{1}} and no other unfilled tag: every value is written out.
The message names the brand, uses only lines this brief states, and adds no offer, price, or claim the brief does not.`;
  }
  if (ch === 'push') {
    return `ASSET: ONE push notification.
Title and body, each a finished sentence from the lines this brief states. The body does not repeat the title. The deep link is an https URL this brief lists, or omitted.
Do not invent a character limit, a badge count, or an offer.`;
  }
  const sms = (L.sms && L.sms.gsm7) || { single: 160 };
  return `ASSET: ONE SMS, one GSM-7 part when the characters allow it (at most ${sms.single} characters including spaces).
The finished text includes the brand name, the line, the link when this brief lists one, and exactly "Reply STOP to opt out."
No emoji. No curly quotes. No offer, price, or claim the brief does not state. If the words would not fit, choose a shorter line this brief already states. Never cut a word in half.`;
}

function storyContract() {
  return `ASSET: ONE story video, 9:16, at most 30 seconds.
Order: a hook, then each product this brief lists on its own photograph with its name and its price (only when a price is stated), then the lines this brief states, then an end card with the button words.
Each photographed shot has one camera move (a push-in, a pan, a pull-out, or a rise), never the same move twice in a row. The end card is still.
On-screen words and spoken words are only lines this brief states. Say each line once. No URL on screen. No bracket marker.
Do not ask for a scene, a person, or a result the brief does not describe. No black or dark-neutral ground: use the brand colour or its surface.`;
}

function landingContract(facts, cf, brand, market) {
  cf = cf || creativeFacts(null);
  const model = brand ? assetPlaybooks.businessModel(brand) : 'commerce';

  const storeNote = 'Every button uses an https URL this brief lists. Never invent a /products/ path. Never use href="#".';
  if (model === 'market_data') {
    const disclaimer = assetPlaybooks.financialDisclaimer(market, brand);
    return `ASSET: Landing page for this market-data publication, one self-contained HTML document.
Sections, in order, omitting any section this brief cannot fill: a bar only if an offer is stated · hero (the headline and opening line this brief states, one button) · a sample only from copy this brief states · the brand's own claims · FAQ only from stated facts · regulatory disclaimer, exactly: "${disclaimer}" · one closing button · legal footer.
No subscriber count, no institutional logos, no testimonials, and no guarantee unless this brief states them. ${storeNote}
Mobile-first. CSS in one style block. No external font or script.
${visualsFor(brand)}`;
  }

  if (model === 'news_media') {
    return `ASSET: Landing page for this news publication, one self-contained HTML document.
Sections, in order, omitting any section this brief cannot fill: a bar only if an offer is stated · hero (the headline and the mail's opening line, one button) · the publication's own reasons or claims · a sample only from copy this brief states · FAQ only from stated facts · one closing button · legal footer.
No reader count, no subscriber logos, and no reader quotes unless this brief quotes them. ${storeNote}
Mobile-first. CSS in one style block. No external font or script.
${visualsFor(brand)}`;
  }

  const currency = facts.currency ? `Prices use ${facts.currency}, and only a price this brief states.` : 'State no price unless this brief states one.';
  return `ASSET: Landing page, one self-contained HTML document, in the structure listed below.
Sections a reader meets: an offer bar only when an offer is stated · hero (headline, the opening line, one button) · the brand's own claims · the product's own details and price · a buy box only when a price is stated · other products this brief lists, each to its own page · reviews only when this brief quotes them · about the brand, from its own description · FAQ only from stated facts · one closing button · legal footer.
${currency} Proof uses only these claims: ${cf.claims}. ${storeNote}
Mobile-first. CSS in one style block. No external font or script.
${visualsFor(brand)}`;
}

/**
 * Build the single portable master prompt for one asset.
 * @param {object} o
 * @param {'mailer'|'ad'|'landing_page'} o.assetType
 * @param {string} [o.market]
 * @param {string} [o.brief]      campaign brief / objective
 * @param {Array}  [o.products]
 * @param {string} [o.variant]    mailer: 'V1' | 'V2'
 * @param {string} [o.platform]   ad: 'google'|'meta'|'instagram'|'tiktok'
 * @param {string} [o.cohort]
 * @param {string} [o.extra]      any extra constraints to append
 * @returns {string}
 */
function buildMasterPrompt(o = {}) {
  const { assetType = 'mailer', brief = '', products = [], variant = 'V2', platform = 'meta', extra = '', brand = null } = o;
  const cohortName = (o.cohort && typeof o.cohort === 'object') ? String(o.cohort.name || '') : String(o.cohort || '');
  // A prompt with no market named is built for the brand's HOME market (tenant
  // zero's own when no brand was resolved), never for a literal 'US'.
  const pb = promptBrand(brand);
  const market = o.market || brandRuntime.homeRegion(pb);

  // Multi-tenant: when the caller resolved an active brand workspace, the whole
  // prompt is built from THAT brand instead of tenant zero. `brand` comes from
  // _shared/brand-runtime.js `resolve(req)`.
  let BLOCK = BRAND_BLOCK;
  let brandName = brandRuntime.defaultBrand().name;
  let facts = regionFacts(market);
  const cf = creativeFacts(pb);
  if (!isShippedDefault(pb)) {
    try {
      BLOCK = brandRuntime.brandBlock(pb);
      brandName = pb.name || 'this brand';
      // A brand with no store for this market is told to invent nothing, never
      // handed tenant zero's store URL.
      facts = brandRuntime.regionFacts(pb, market) || { store: '', presell: '', currency: '', locale: 'en' };
    } catch (_) { /* fall back to tenant zero rather than failing a generation */ }
  }
  if (!brandName || /\[DATA REQUIRED/i.test(brandName)) brandName = 'this brand';
  const storeRaw = String((facts && facts.store) || '').trim();
  const storeBit = (!storeRaw || /\[DATA REQUIRED/i.test(storeRaw))
    ? 'no store URL on record (do not invent one)'
    : (/^https?:\/\//i.test(storeRaw) ? storeRaw : `https://${storeRaw}`);
  const currencyBit = facts && facts.currency && !/\[DATA REQUIRED/i.test(String(facts.currency))
    ? facts.currency
    : 'not stated (do not invent a price)';

  const kind = String(assetType || 'mailer').toLowerCase();
  const channel = String(o.channel || kind).toLowerCase();
  let contract;
  if (kind === 'ad') contract = adContract(String(platform).toLowerCase(), cf, pb, market);
  else if (kind === 'landing_page' || kind === 'lp') contract = landingContract(facts, cf, pb, market);
  else if (kind === 'message' || kind === 'sms' || kind === 'whatsapp' || kind === 'push') contract = messageContract(channel);
  else if (kind === 'story' || kind === 'video') contract = storyContract();
  else contract = mailerContract(variant === 'V1' ? 'V1' : 'V2', cf, pb, market);

  const portable = !(kind === 'message' || kind === 'sms' || kind === 'whatsapp' || kind === 'push' || kind === 'story' || kind === 'video');
  const benchmarkBlock = portable ? externalPlaybook(pb, kind, variant === 'V1' ? 'V1' : 'V2', market) : '';
  const job = factText(brief);

  // The whole string is what a person pastes. The app's gap marker is rewritten
  // out of it so an external model is told to leave a gap, not to print it.
  return forExternalModel([
    `You are the senior lifecycle creative director for ${brandName}. Produce the finished asset, ready to ship. Follow every rule exactly.`,
    ``,
    deliverable(assetType, platform, variant, channel),
    ``,
    BLOCK,
    ``,
    // The cohort is the planner's segment name ("At Risk", "Winback"): the
    // outside model is told who it is for and never to print the label.
    `MARKET: ${market} · Store: ${storeBit} · Currency: ${currencyBit}${cohortName ? ` · Audience: the "${cohortName}" segment (an internal label: write to them as "you" and never print it)` : ''}`,
    job ? `\nCAMPAIGN BRIEF:\n${job}` : '',
    ``,
    offerLine(o.offer),
    ``,
    linkLines(o.links, pb),
    ``,
    writtenLines(o.written),
    ``,
    `PRODUCTS IN SCOPE:\n${productLines(products, facts.currency, brandName)}`,
    promptProducts(products).length ? '' : offeringLines(pb),
    ``,
    contract,
    ``,
    benchmarkBlock,
    ``,
    banBlock(pb),
    ``,
    `QUALITY BAR: specific, and only as specific as the facts in this brief. No banned phrases. No medical or financial promise this brief does not state. Do not ask questions. Where a fact is missing, leave it out.`,
    extra ? `\nADDITIONAL CONSTRAINTS:\n${String(extra).trim()}` : '',
    ``,
    outputFormat(kind, platform, brandName, market, channel),
  ].filter((l) => l !== '').join('\n')).trim();
}

/**
 * WHAT THE OPERATOR IS OWED, STATED FIRST.
 *
 * These prompts are built to be pasted into ChatGPT, Gemini or Claude and come
 * back with the FINISHED THING. That was not what happened: a mailer prompt
 * pasted into Gemini returned a product photograph, because the copy the
 * operator grabbed was an element brief and nothing in the prompt said which
 * kind it was.
 *
 * So an asset prompt now opens by naming its deliverable in one line, before
 * any brand block or product list, and closes by pinning the output format. A
 * model that reads only the first and last paragraph still produces the right
 * artefact.
 *
 * The distinction this enforces:
 *   ASSET prompt    returns the complete, usable artefact (the whole mailer,
 *                   the whole landing page, the whole ad unit).
 *   ELEMENT prompt  returns one part of it (a hero photograph, a headline).
 *                   Those live on `creative_brief` and are labelled as such.
 */
function deliverable(assetType, platform, variant, channel) {
  const t = String(assetType || 'mailer').toLowerCase();
  if (t === 'ad') {
    return `DELIVERABLE: ONE COMPLETE ${String(platform).toUpperCase()} AD UNIT, ready to upload. Not a concept, not a moodboard, not only an image brief. Every field the platform requires, plus the creative, plus the reasoning.`;
  }
  if (t === 'landing_page' || t === 'lp') {
    return 'DELIVERABLE: ONE COMPLETE, SELF-CONTAINED LANDING PAGE as a single HTML document I can save and open. Not a wireframe, not a section list, not a description of a page.';
  }
  if (t === 'message' || t === 'sms' || t === 'whatsapp' || t === 'push') {
    const ch = String(channel || t).toUpperCase();
    return `DELIVERABLE: ONE COMPLETE ${ch} MESSAGE, ready to send. Not a campaign plan and not an image. The finished message.`;
  }
  if (t === 'story' || t === 'video') {
    return 'DELIVERABLE: ONE COMPLETE STORY VIDEO, at most 30 seconds, 9:16. Not a still, not an email, not a plan. The finished story: its shots, its on-screen words and its spoken words.';
  }
  return `DELIVERABLE: ONE COMPLETE EMAIL MAILER (${variant === 'V1' ? 'text-only' : 'text and visual'}), ready to paste into an ESP. Not a plan, not a section-by-section outline, not only a hero image. The finished email.`;
}

/**
 * The last thing the model reads, and the most literal.
 *
 * "Produce a mailer" is ambiguous to a model that can also produce a picture of
 * one. Naming the artefact, the container and what must NOT come back removes
 * the ambiguity.
 */
/*
 * Since 2026-10-11 the closing block IS the shared OUTPUT REQUIREMENT
 * (output-contract.js), so a pasted asset prompt ends exactly like every
 * prompt the app sends: the deliverable, how to mark missing data, what not to
 * return, and the container LAST. The mailer used to say "ONE email HTML
 * document" and, two lines later, "Before the HTML, give: 3 subject lines...":
 * a format that cannot be both. It is four labelled sections now, the last of
 * which is the HTML document. Character limits are READ from asset-contracts.
 */
const OC = require('./output-contract.js');
function copyLimits(platform) {
  const L = require('./asset-contracts.js').slotLimit;
  const p = String(platform || 'meta').toLowerCase();
  if (p === 'google') return `headlines 3-15, each at most ${L('ad.google.rsa', 'headlines')} characters; descriptions 2-4, each at most ${L('ad.google.rsa', 'descriptions')}; path1 and path2 at most ${L('ad.google.rsa', 'path1')} each`;
  if (p === 'tiktok') return `script (the hook in the first second); caption at most ${L('ad.tiktok.video', 'caption')} characters; 3 hashtag options`;
  return `primary text at most ${L('ad.meta.static', 'primary_text')} characters; headline at most ${L('ad.meta.static', 'headline')}; description at most ${L('ad.meta.static', 'description')}`;
}
const OMIT_MISSING = 'omit any fact this brief does not state. Never invent a price, discount, code, date, rating, review, reviewer, claim, statistic, product, URL or image. Never print a bracket marker, a placeholder, or an unfilled tag into the asset.';
function outputSpec(assetType, platform, brandName, market, channel) {
  const t = String(assetType || 'mailer').toLowerCase();
  const base = { kind: 'asset', brand: brandName, region: market, missing: OMIT_MISSING,
    forbid: ['a preamble or an explanation of what you did', 'base64 or data: URIs (Never base64: every image is a hosted URL supplied in this prompt)', 'a placeholder image service or an invented image URL'] };
  if (t === 'message' || t === 'sms' || t === 'whatsapp' || t === 'push') {
    const ch = String(channel || t).toUpperCase();
    return Object.assign(base, { id: 'master-prompt.message.' + String(channel || t).toLowerCase(), format: 'sections',
      returns: `ONE complete ${ch} message, ready to send.`,
      formatRule: 'OUTPUT FORMAT: the finished message as plain text, under the heading MESSAGE.',
      lines: ['MESSAGE: the text exactly as the reader receives it, including the sender and the opt-out where the contract above requires them.'] });
  }
  if (t === 'story' || t === 'video') {
    return Object.assign(base, { id: 'master-prompt.story', format: 'sections',
      returns: 'ONE complete story video script, at most 30 seconds, ready to produce.',
      formatRule: 'OUTPUT FORMAT: these labelled sections, in order:',
      lines: [
        '1. SHOTS: one line per shot, with its seconds, its on-screen words, and its camera move.',
        '2. SPOKEN: the words said in each shot, each line once.',
        '3. END CARD: the closing line and the button words.',
      ] });
  }
  if (t === 'ad') {
    return Object.assign(base, { id: 'master-prompt.ad.' + String(platform || 'meta').toLowerCase(), format: 'sections',
      returns: `ONE complete ${String(platform || 'meta').toUpperCase()} ad unit, ready to upload: its copy, its creative and the reasoning.`,
      formatRule: 'OUTPUT FORMAT: return ALL of these, in this order, each starting with its exact heading on its own line:',
      lines: [
        `1. COPY: every field this platform requires, each on its own line (${copyLimits(platform)}).`,
        '2. CREATIVE: a complete, self-contained HTML block that renders the ad unit at the correct aspect ratio, using ONLY hosted image URLs I have supplied (never base64, never a placeholder service).',
        '3. IMAGE BRIEF: the shot description, only if a photograph still needs to be produced.',
        '4. WHY: two lines on the angle and who it is for.',
      ] });
  }
  if (t === 'landing_page' || t === 'lp') {
    return Object.assign(base, { id: 'master-prompt.landing', format: 'html',
      returns: 'ONE complete, self-contained landing page as a single HTML document I can save and open.',
      formatRule: 'OUTPUT FORMAT: ONE HTML document, complete and self-contained.',
      lines: [
        'It must start with <!doctype html> and end with </html>. All CSS inline in a <style> block. No external stylesheet, no framework, no build step.',
        'Every image is an <img> pointing at a hosted URL I supplied. Never base64. Never a placeholder image service. If I supplied no image for a slot, leave the slot out rather than inventing a source.',
        'The page must render correctly with JavaScript disabled.',
      ] });
  }
  const L = require('./asset-contracts.js').slotLimit;
  return Object.assign(base, { id: 'master-prompt.mailer', format: 'sections',
    returns: 'ONE complete email mailer, ready to paste into an ESP: its subject lines, preheader, plain-text version and HTML.',
    formatRule: 'OUTPUT FORMAT: ONE email HTML document, complete and paste-ready, returned as the LAST of four labelled sections: SUBJECT LINES, PREHEADER, PLAIN TEXT, HTML.',
    lines: [
      `SUBJECT LINES: 3, one per line, each at most ${L('email.mailer', 'subject')} characters. PREHEADER: 1, at most ${L('email.mailer', 'preheader')} characters. PLAIN TEXT: the whole email as text.`,
      'HTML: Table-based layout (Outlook renders with the Word engine), max 600px content column, all CSS inline on the elements. No <style> in the head that the layout depends on, no flexbox or grid, no JavaScript.',
      'Every image is an <img> with a hosted URL I supplied plus real alt text. Never base64: Gmail clips a message past roughly 102KB and the mailer would be cut mid-layout.',
      'The email must read completely with images disabled.',
    ] });
}
function outputFormat(assetType, platform, brandName, market, channel) {
  return OC.block(outputSpec(assetType, platform, brandName || 'this brand', market, channel));
}

/* ═══ Element prompts ═════════════════════════════════════════════════════
 *
 * The other half of the same fix. An image brief is a perfectly good prompt —
 * it just does not produce a mailer, and the operator who pastes it has no way
 * to know that from the text. So an element prompt now says, in its first line,
 * that it produces ONE PART, names the part, names the asset the part belongs
 * to, and points at the prompt that produces the whole thing.
 *
 * Deliberately NOT wrapped in the brand block: this is a shot description going
 * to an image model, and burying it under six paragraphs of typography rules is
 * how a hero photograph comes back with text baked into it.
 */
const PROMPT_KIND = { ASSET: 'asset', ELEMENT: 'element' };

const ELEMENT_LABEL = {
  image: 'ONE STILL PHOTOGRAPH',
  hero: 'ONE HERO PHOTOGRAPH',
  video: 'ONE VIDEO CLIP',
  copy: 'ONE BLOCK OF COPY',
};

/**
 * Wrap a raw element brief so it announces what it produces.
 * @param {string} brief   the shot/copy description as authored
 * @param {object} o
 * @param {'image'|'hero'|'video'|'copy'} [o.produces]
 * @param {string} [o.partOf]  human name of the asset this element sits inside
 * @returns {string}
 */
function buildElementPrompt(brief, o = {}) {
  const text = String(brief || '').trim();
  if (!text) return '';
  const produces = ELEMENT_LABEL[String(o.produces || 'image').toLowerCase()] || ELEMENT_LABEL.image;
  const partOf = String(o.partOf || 'the finished asset').trim();
  const head = `DELIVERABLE: ${produces} — ONE ELEMENT of ${partOf}, not the asset itself. Do not return an email, an ad unit or a page. Return only this element.`;
  const foot = (produces === ELEMENT_LABEL.copy)
    ? 'OUTPUT: the copy only, as plain text. No commentary, no JSON, no HTML.'
    : (produces === ELEMENT_LABEL.video
      ? 'OUTPUT: the clip only. One clip. No text baked into the frames unless the brief asks for it, no watermark, no logo.'
      : 'OUTPUT: the image only. No text baked into the image, no watermark, no logo, no border, no collage of options. One frame.');
  return [head, '', text, '', foot].join('\n');
}

/**
 * The one call a UI needs: everything copyable for an asset, each labelled with
 * what it returns. A surface that renders this list cannot show an element
 * prompt without also showing the asset prompt beside it.
 *
 * An ASSET row does not carry its own text — it carries `from`, the field on
 * the asset that already holds it. Copying a ~5KB prompt into a second place on
 * the same object is how the two drift, and it doubles a payload that is
 * already ~180 slots wide in the prebuild queue. An ELEMENT row DOES carry
 * text, because the wrapped form exists nowhere else.
 *
 * @param {object} asset   a built asset (email / ad / landing page)
 * @param {'mailer'|'ad'|'landing_page'} assetType
 * @param {object} [opt]
 * @param {boolean} [opt.inline]  also resolve `text` on asset rows
 * @returns {Array<{id,label,kind,produces,from?,text?}>}
 */
function promptsFor(asset, assetType, opt = {}) {
  const a = asset || {};
  const t = String(assetType || 'mailer').toLowerCase();
  const out = [];
  const assetName = t === 'ad'
    ? `a complete ${String(a.platform || '').toUpperCase() || 'paid'} ad unit`
    : (t === 'landing_page' || t === 'lp') ? 'a complete landing page' : 'a complete email mailer';

  const asAsset = (id, from, label, produces) => {
    const text = String(a[from] || '').trim();
    if (!text) return;
    const row = { id, label, kind: PROMPT_KIND.ASSET, produces, from };
    if (opt.inline) row.text = text;
    out.push(row);
  };
  const asElement = (id, label, produces, text) => {
    const s = String(text || '').trim();
    if (s) out.push({ id, label, kind: PROMPT_KIND.ELEMENT, produces, text: s });
  };

  // The complete artefact ALWAYS comes first. Ordering is not cosmetic here:
  // the operator copies the first thing that looks like the job.
  if (t === 'message' || t === 'sms' || t === 'whatsapp' || t === 'push') {
    asAsset('master_prompt', 'master_prompt', `Complete ${a.channel || 'message'}`, 'the whole message');
    return out;
  }
  if (t === 'mailer') {
    asAsset('master_prompt_v2', a.master_prompt_v2 ? 'master_prompt_v2' : 'master_prompt',
      'Complete mailer, text and visual', 'the whole email');
    asAsset('master_prompt_v1', 'master_prompt_v1', 'Complete mailer, text only', 'the whole email');
  } else {
    asAsset('master_prompt', 'master_prompt',
      `Complete ${t === 'ad' ? 'ad unit' : 'landing page'}`, `the whole ${t === 'ad' ? 'ad' : 'page'}`);
    if (t === 'ad') asAsset('story_prompt', 'story_prompt', 'Complete story video', 'the whole story video');
  }

  // Then the parts, each stating that it is a part.
  asElement('creative_brief', 'Hero image only', 'one photograph',
    buildElementPrompt(a.creative_brief || (a.creative && a.creative.brief), { produces: 'hero', partOf: assetName }));
  asElement('script', 'Video clip only', 'one clip',
    buildElementPrompt(a.script, { produces: 'video', partOf: assetName }));

  return out;
}

// `brandBlockFor(brand)` lets any prompt site swap tenant zero's block for the
// caller's active brand without importing brand-runtime directly.
function brandBlockFor(brand) {
  const pb = promptBrand(brand);
  if (isShippedDefault(pb)) return BRAND_BLOCK;
  try { return require('./brand-runtime.js').brandBlock(pb); }
  catch (_) { return BRAND_BLOCK; }
}

module.exports = {
  buildMasterPrompt, BRAND_BLOCK, brandBlockFor, regionFacts, REGION,
  buildElementPrompt, promptsFor, deliverable, outputFormat, PROMPT_KIND,
  auditAsset: require('./asset-auditor.js').auditAsset,
};
