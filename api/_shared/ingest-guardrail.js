'use strict';
/**
 * ingest-guardrail.js — two-phase filter that keeps the daily learning agent
 * ON-CONTEXT: US/UK D2C custom sneakers, sneaker retail, streetwear & sneaker
 * care ONLY. Everything else (generic ecommerce listicles, unrelated tech, off-geo pricing, random
 * social chatter) is dropped BEFORE it reaches the KB / vector space.
 *
 *   Phase 1  deterministic pre-filter (NO LLM, no tokens): brand whitelist,
 *            geo + currency gate (US/UK · $/£), relevance lexicon, junk
 *            blocklist. This is the cheap first wall.
 *   Phase 2  LLM gatekeeper (only on Phase-1 survivors): a strict D2C+streetwear
 *            relevance judgement. Fails OPEN when no LLM is configured — a
 *            missing key must never silently drop real data — but says so.
 *
 * assess(item)          -> Phase 1 verdict {keep, phase, reason, signals}
 * gatekeep(item,{llm})  -> Phase 1 then (if kept & llm) Phase 2 -> final verdict
 * filterItems(items)    -> {kept, dropped, total} for batch ingestion
 * BRAND_WHITELIST / RELEVANT / BLOCK exported for reuse + tests.
 *
 * An item is any {title?, text?/raw_text?/body?, url?, brand?, source?}.
 */

let callLLM = null; try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }

// Competitor + adjacent US/UK D2C streetwear brands we DO learn from. Seeded from
// the competitor list in competitor-core.js + close category adjacents. Match is
// substring on the lowercased haystack (name or domain fragment).
const BRAND_WHITELIST = [
  'knickgasm', 'shoe surgeon', 'shoesurgeon', 'the shoe surgeon', 'kickstradomis', 'sierato',
  'mache', 'mache customs', 'ceeze', 'freehand profit', 'dank customs', 'chef sneakers',
  'shoes your daddy', 'comet', 'moreiarty', 'vandy the pink', 'warren lotas', 'sole retriever',
  'crep protect', 'jason markk', 'reshoevn8r', 'angelus direct', 'angelus paint',
  'stockx', 'goat', 'flight club', 'kicks crew', 'sneaker n stuff', 'sneakersnstuff',
  'vegnonveg', 'superkicks', 'crepdogcrew', 'limited edt', 'hypebeast', 'complex sneakers',
];

// Relevance lexicon: the category + the D2C/lifecycle-marketing angle we care about.
const RELEVANT = [
  'sneaker', 'sneakers', 'kicks', 'dunk', 'dunks', 'jordan', 'air force', 'airforce', 'af1', 'court vision',
  'converse', 'samba', 'adidas', 'nike', 'silhouette', 'colorway', 'colourway', 'grail', 'drop', 'resale',
  'custom sneaker', 'customiser', 'customizer', 'hand-painted', 'hand painted', 'one-of-one', 'one of one',
  'airbrush', 'sneaker art', 'coffee-art', 'embroidery', 'crystal', 'bling', 'swarovski', 'denim jacket',
  'sneaker care', 'sneaker cleaner', 'restoration', 'reglue', 'sole swap', 'laces', 'lace tag', 'shoe tree',
  'streetwear', 'hypebeast', 'collab', 'collaboration', 'limited edition', 'made to order', 'anime', 'fandom',
  // D2C / lifecycle marketing relevance
  'd2c', 'dtc', 'subscription', 'retention', 'lifecycle', 'klaviyo', 'abandoned cart', 'ltv', 'repeat purchase',
  'winback', 'win-back', 'cohort', 'email marketing', 'sms marketing', 'loyalty program', 'replenishment', 'churn',
];

// Hard junk / off-context blocklist — if the item is DOMINATED by these with no
// relevance signal and no whitelisted brand, it is dropped.
const BLOCK = [
  'crypto', 'blockchain', 'nft', 'web3', 'stock market', 'forex', 'real estate', 'mortgage',
  'video game', 'sports betting', 'casino', 'dating app', 'devops', 'kubernetes',
  'javascript framework', 'gpu', 'iphone', 'android update', 'operating system',
  'political', 'election', 'celebrity gossip', 'horoscope',
];

// KNICKGASM operates US(.com) · UK(.co.uk) · IN(.in) · Global(.global), so the
// knowledge base spans all four. Accepted currencies: $, £, ₹ (+ a generic
// global signal). Truly off-target competitor geos (EU/AU/CA/JP) with no known
// brand and no vertical relevance are still dropped as noise.
const OK_CURRENCY = /(\$|\busd\b|£|\bgbp\b|₹|\binr\b)/i;
const BAD_CURRENCY = /(€|\beur\b|¥|\bjpy\b|\bcny\b|a\$|\baud\b|c\$|\bcad\b)/i;
const TARGET_GEO = /(united states|u\.s\.|\bus\b|\busa\b|america|united kingdom|\buk\b|britain|england|\.co\.uk|\bindia\b|\.in\b|knickgasmindia|\.global\b)/i;
const OFF_TARGET_GEO = /(\.eu\b|\.de\b|\.fr\b|\.au\b|\.ca\b|\.jp\b|europe|germany|france|australia|\bcanada\b|japan)/i;

function haystack(item) {
  return [item && item.title, (item && (item.text || item.raw_text || item.body)) || '', item && item.url, item && item.brand, item && item.source]
    .filter(Boolean).join(' \n ').toLowerCase();
}
function hits(hay, list) { const found = []; for (const w of list) if (hay.includes(w)) found.push(w); return found; }

// ── Phase 1: deterministic pre-filter ───────────────────────────────────────
function assess(item) {
  const hay = haystack(item || {});
  if (!hay.trim()) return { keep: false, phase: 1, reason: 'empty content' };
  const rel = hits(hay, RELEVANT);
  const blk = hits(hay, BLOCK);
  const brand = BRAND_WHITELIST.find((b) => hay.includes(b)) || null;
  // Currency gate: an off-target currency (€/¥/A$/C$) with no $/£/₹ and no known
  // brand is off-market pricing. ₹ (India) is IN-scope, so it passes.
  if (BAD_CURRENCY.test(hay) && !OK_CURRENCY.test(hay) && !brand) return { keep: false, phase: 1, reason: 'off-target currency (not $/£/₹)', signals: { brand } };
  // Geo gate: an explicit off-target geo (EU/AU/CA/JP) with no US/UK/IN/Global
  // signal and no known brand.
  if (OFF_TARGET_GEO.test(hay) && !TARGET_GEO.test(hay) && !brand) return { keep: false, phase: 1, reason: 'off-target geo (not US/UK/IN/Global)', signals: { brand } };
  // Junk-dominated with no relevance and not a whitelisted brand.
  if (blk.length >= 2 && rel.length === 0 && !brand) return { keep: false, phase: 1, reason: `junk/off-context (${blk.slice(0, 3).join(', ')})`, signals: { brand } };
  // Must carry a category/D2C relevance signal OR come from a whitelisted brand.
  if (rel.length === 0 && !brand) return { keep: false, phase: 1, reason: 'no custom-sneaker/sneaker-retail/streetwear/sneaker-care or D2C signal' };
  return { keep: true, phase: 1, reason: brand ? `whitelisted brand: ${brand}` : `relevant (${rel.slice(0, 4).join(', ')})`, signals: { brand, relevanceHits: rel.length } };
}

// ── Metadata classification (zero-drift tags stored on every kept item) ──────
// Deterministic {market, vertical} so every KB row carries a hard tag and the
// analysis layer can inject a metadata filter (RAG sandbox) — the AI physically
// cannot read outside the custom-sneaker / sneaker-retail / streetwear /
// sneaker-care  ·  US/UK box. Kept in sync with the digest prompt in api/kb.js.
const VERTICALS = {
  'Custom Sneakers': ['custom sneaker', 'customiser', 'customizer', 'hand-painted', 'hand painted', 'one-of-one', 'one of one', 'sneaker art', 'airbrush', 'shoe surgeon', 'shoesurgeon', 'kickstradomis', 'mache', 'ceeze', 'freehand profit', 'coffee-art'],
  'Sneaker Retail': ['stockx', 'goat', 'flight club', 'kicks crew', 'sneakersnstuff', 'vegnonveg', 'superkicks', 'resale', 'resell', 'raffle', 'restock', 'drop calendar', 'air force 1', 'dunk', 'jordan', 'samba'],
  'Sneaker Care': ['sneaker care', 'cleaner', 'crep protect', 'jason markk', 'reshoevn8r', 'angelus', 'restoration', 'reglue', 'sole swap', 'protectant', 'shoe tree', 'crease guard'],
  Streetwear: ['streetwear', 'hypebeast', 'denim jacket', 'apparel', 'hoodie', 'graphic tee', 'embroidery', 'bling', 'swarovski', 'vandy the pink', 'warren lotas', 'collab', 'limited edition'],
};
function classify(item) {
  const hay = haystack(item || {});
  // Market from currency + geo signals (US · UK · IN · Global — KNICKGASM's stores).
  let market = null;
  if (/₹|\binr\b|\.in\b|\bindia\b|knickgasmindia/i.test(hay)) market = 'IN';
  else if (/£|\bgbp\b|\.co\.uk|united kingdom|\buk\b|britain|england/i.test(hay)) market = 'UK';
  else if (/\$|\busd\b|united states|\bus\b|\busa\b|america/i.test(hay)) market = 'US';
  else if (/\.global\b|knickgasm\.global|worldwide|international/i.test(hay)) market = 'Global';
  // Vertical = the category with the most keyword hits (Streetwear as the catch-all).
  let vertical = null, best = 0;
  for (const [v, kws] of Object.entries(VERTICALS)) {
    const n = hits(hay, kws).length;
    if (n > best) { best = n; vertical = v; }
  }
  if (!vertical && hits(hay, RELEVANT).length) vertical = 'Streetwear';
  return { market, vertical };
}

// ── Phase 2: LLM gatekeeper (strict — the Context Guard) ─────────────────────
const P2_SYS = `You are a hyper-focused data compliance engineer for a D2C Market Intelligence platform. Your single job is to analyze incoming data and classify whether it is strictly valuable or junk.

Strict Context Bounds:
1. Industry Focus: ONLY custom/bespoke sneaker studios, sneaker retail and resale, streetwear, and sneaker-care brands. Discard beauty, food and drink, general fitness equipment, or generic SaaS.
2. Core Strategy Pillars: Only accept data regarding: Offer Architecture (Pricing, Subscriptions, Bundles), Digital Acquisition Hooks (Ads, Landing Pages), Retention Flows (SMS/Email experiments), and physical retail expansion in the US/UK.
3. Definition of Junk (Reject if ANY are true):
- The data is a general marketing quote or "thought leadership" post without hard numbers or tangible changes.
- The strategy is about general e-commerce (e.g., "How to optimize Shopify checkout for any store").
- The change is a minor backend bug fix or routine site maintenance with zero strategy impact.

Output Requirement: output EXACTLY this JSON, no conversational text:
{"is_actionable_context": true/false, "rejection_reason": "reason ONLY if false, else empty string"}`;

async function phase2(item) {
  if (!callLLM) return { relevant: true, skipped: true, reason: 'no LLM configured — Phase 2 skipped (kept)' };
  const body = String((item && (item.text || item.raw_text || item.body)) || '').slice(0, 6000);
  const user = `TITLE: ${(item && item.title) || ''}\nURL: ${(item && item.url) || ''}\nCONTENT:\n"""\n${body}\n"""\nReturn the JSON verdict.`;
  try {
    const out = await callLLM({ systemPrompt: P2_SYS, userMessage: user, responseFormat: { type: 'json_object' }, maxTokens: 120, temperature: 0, timeoutMs: 20000, stage: 'ingest-guardrail', tier: 'fast' });
    if (!out || !out.ok || !out.text) return { relevant: true, skipped: true, reason: 'LLM unavailable — kept' };
    const j = JSON.parse(out.text.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, '$1'));
    const actionable = j.is_actionable_context !== false;
    return { relevant: actionable, reason: actionable ? '' : (j.rejection_reason || 'not actionable D2C context') };
  } catch (e) { return { relevant: true, skipped: true, reason: `Phase 2 error (${e.message}) — kept` }; }
}

// ── Combined gate ────────────────────────────────────────────────────────────
async function gatekeep(item, { llm = true } = {}) {
  const p1 = assess(item);
  if (!p1.keep) return { keep: false, phase: 1, reason: p1.reason, p1 };
  const meta = classify(item);   // zero-drift tags travel with every kept item
  if (!llm) return { keep: true, phase: 1, reason: p1.reason, meta, p1 };
  const p2 = await phase2(item);
  if (!p2.relevant) return { keep: false, phase: 2, reason: `LLM gatekeeper: ${p2.reason || 'not actionable'}`, meta, p1, p2 };
  return { keep: true, phase: p2.skipped ? 1 : 2, reason: p2.skipped ? p1.reason : 'actionable D2C context', meta, p1, p2 };
}

async function filterItems(items, opts) {
  const kept = [], dropped = [];
  for (const it of (items || [])) { const v = await gatekeep(it, opts); (v.keep ? kept : dropped).push({ item: it, verdict: v }); }
  return { kept, dropped, total: (items || []).length };
}

module.exports = { assess, phase2, classify, gatekeep, filterItems, BRAND_WHITELIST, RELEVANT, BLOCK, VERTICALS };
