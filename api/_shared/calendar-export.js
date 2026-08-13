'use strict';

/**
 * Calendar → spreadsheet export.
 *
 * Turns a rolling-plan (Smart Brain / Automated Calendar entries, or any entry
 * carrying date + cohort + heroProduct) into a Google-Sheets-importable CSV with
 * one row per send and these columns:
 *
 *   Date · Day · Mailer Theme & Setting · Hero Product(s) · Supporting Products ·
 *   Why (data basis) · Target Cohort / Audience · Audience Count ·
 *   Expected Sent · Expected Delivered · Expected Opened · Expected Open % ·
 *   Expected CTR % · Expected Clicks · Expected Metrics Basis ·
 *   Product Links (real) · Product Image Links (real) · Mailer + Asset Prompts
 *
 * Everything is deterministic and sourced from real data — the ACTIVE BRAND's own
 * catalogue (brand-catalog-server: its brand_catalog_products rows, or the
 * shipped files when the brand IS tenant zero) for links/images/prices, the shared
 * master-prompt builder for the per-asset prompts, and a documented cohort-tier
 * benchmark model for the expected metrics. No LLM call, so it is instant and
 * reproducible.
 */

const { buildMasterPrompt, regionFacts } = require('./master-prompt.js');
const catalogServer = require('./brand-catalog-server.js');
const GR = require('./calendar-guardrails.js');

// ── Catalog ------------------------------------------------------------------
// Whose products go in the sheet is decided by brand-catalog-server, not by a
// path on disk: data/catalog/products_*.json is TENANT ZERO'S catalogue, and an
// export built for another brand listed that brand's sends against this one's
// sneakers, prices, PDP links and photos. An entry carries the brand it was
// planned for, so every lookup here is scoped to it; a brand with no catalogue
// exports honest empty product columns rather than a foreign product row.
function catalog(market, brand) {
  return catalogServer.productsFor(market, { brand: brand || null }).products;
}
function storeBase(market) {
  const f = regionFacts(String(market || 'US').toUpperCase());
  return 'https://' + (f.store || 'knickgasm.com');
}

// Significant words in a product name, minus ultra-common ones that would
// otherwise inflate a match (so "citrus" alone never wins over a real Earl Grey).
const STOP = new Set(['sneaker', 'sneakers', 'the', 'and', 'with', 'count', 'pack', 'loose', 'panel', 'bags', 'bag', 'oz', 'gm', 'g', 'ct', 'premium', 'box', 'gift', 'set']);
function tokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
}
function fromRow(p, market) {
  return {
    title: p.n, handle: p.h, image: (/^https?:\/\//.test(p.i || '') ? p.i : null),
    price: p.price != null ? p.price : null, type: p.type || (p.t && p.t[0]) || 'product',
    url: p.h ? `${storeBase(market)}/products/${p.h}` : storeBase(market),
  };
}
// Resolve a real catalog product: exact handle, then exact title, then the
// product that shares the MOST meaningful words with the hero name (token
// overlap, needs >= 2 shared words to be a confident PDP match). If nothing is
// confident we NEVER substitute a wrong product — we return the hero title with
// a real store-search link and no image, so a link is always honest.
function resolveProduct(ref, market, brand) {
  const arr = catalog(market, brand);
  if (!arr.length || !ref) return null;
  let handle = null, title = null;
  if (typeof ref === 'string') { handle = ref; title = ref.replace(/[-_]+/g, ' '); }
  else { const hp = ref.heroProduct || ref; handle = hp.handle || hp.h || null; title = hp.title || hp.n || null; }
  let p = handle && arr.find((x) => x.h === handle);
  if (!p && title) p = arr.find((x) => (x.n || '').toLowerCase() === String(title).toLowerCase());
  if (!p && title) {
    const ht = tokens(title);
    if (ht.length) {
      let best = null, bestScore = 0;
      for (const x of arr) {
        const xt = new Set(tokens(x.n));
        let score = 0; for (const w of ht) if (xt.has(w)) score++;
        // tie-break toward the more specific (shorter) name
        if (score > bestScore || (score === bestScore && best && (x.n || '').length < (best.n || '').length && score > 0)) { best = x; bestScore = score; }
      }
      const need = ht.length <= 1 ? 1 : 2;
      if (best && bestScore >= need) p = best;
    }
  }
  if (p) return fromRow(p, market);
  // No confident catalog match — honest soft fallback (real store search, no image).
  const t = title || (typeof ref === 'string' ? ref : (ref.title || ''));
  return { title: t, handle: null, image: null, price: null, type: (ref && (ref.category || (ref.heroProduct && ref.heroProduct.category))) || 'product', url: `${storeBase(market)}/search?q=${encodeURIComponent(t)}` };
}

// Deterministic hash so the same slot always picks the same supporting set.
function stableIndex(str, n) {
  if (n <= 1) return 0;
  let h = 0; const s = String(str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

// Two complementary catalog products: prefer a DIFFERENT type than the hero
// (cross-sell), favouring bestsellers, then fill from the same type. Always real
// catalog rows, never the hero itself.
function supportingProducts(heroResolved, entry, market, n = 2) {
  const arr = catalog(market, entry && entry.brand);
  if (!arr.length) return [];
  const heroHandle = heroResolved && heroResolved.handle;
  const heroType = (heroResolved && heroResolved.type) || '';
  const pool = arr.filter((x) => x.h && x.h !== heroHandle && /^https?:\/\//.test(x.i || ''));
  const isBest = (x) => Array.isArray(x.t) && x.t.some((tag) => /bestseller|best-seller/i.test(tag));
  const cross = pool.filter((x) => (x.type || '') !== heroType);
  const ranked = [...cross.filter(isBest), ...cross.filter((x) => !isBest(x)), ...pool.filter((x) => (x.type || '') === heroType)];
  const seed = entry.id || entry.date || '';
  const out = [], seen = new Set();
  for (let i = 0; i < ranked.length && out.length < n; i++) {
    const p = ranked[(stableIndex(seed, ranked.length) + i) % ranked.length];
    if (!p || seen.has(p.h)) continue;
    seen.add(p.h);
    out.push({ title: p.n, handle: p.h, image: p.i, price: p.price != null ? p.price : null, url: `${storeBase(market)}/products/${p.h}` });
  }
  return out;
}

// ── Expected-metrics hypothesis ---------------------------------------------
// Documented cohort-engagement benchmark model for KNICKGASM D2C email. Rates are
// applied to the audience count (the send list). deliverability, open rate (on
// delivered) and CTR (clicks on delivered) step down as engagement drops — the
// realistic pattern for D2C sneaker/streetwear lifecycle email. These are planning
// hypotheses, to be replaced by measured Klaviyo rates once flows are live.
const TIERS = [
  { re: /champion/i,                          deliver: 0.99, open: 0.48, ctr: 0.045, label: 'Champions (most engaged): near-perfect deliverability, top-quartile opens' },
  { re: /loyal/i,                             deliver: 0.99, open: 0.42, ctr: 0.038, label: 'Loyalists: high deliverability + opens, strong click intent' },
  { re: /nurture/i,                           deliver: 0.98, open: 0.30, ctr: 0.022, label: 'Nurture: mid-funnel, average opens, building click habit' },
  { re: /at.?risk/i,                          deliver: 0.97, open: 0.20, ctr: 0.014, label: 'At-Risk: cooling engagement, opens dipping, clicks soft' },
  { re: /winback/i,                           deliver: 0.96, open: 0.18, ctr: 0.012, label: 'Winback: lapsed buyers, list decay lowers deliverability + opens' },
  { re: /(non.?buyer|non.?engager)/i,         deliver: 0.95, open: 0.12, ctr: 0.008, label: 'Non-Buyers / Non-Engagers: coldest tier, re-permission + curiosity subject discipline' },
  { re: /(t\s*&\s*b|t and b|sneaker.*buyer)/i,    deliver: 0.96, open: 0.16, ctr: 0.011, label: 'T&B Buyers / Non-Engagers: prior buyers gone quiet, familiarity lifts opens vs cold' },
];
function tierFor(cohortName) {
  const c = String(cohortName || '');
  return TIERS.find((t) => t.re.test(c)) || { deliver: 0.97, open: 0.25, ctr: 0.018, label: 'General lifecycle audience: blended mid-engagement benchmark' };
}
function expectedMetrics(cohortName, audience) {
  const t = tierFor(cohortName);
  const sent = Math.max(0, Math.round(+audience || 0));
  const delivered = Math.round(sent * t.deliver);
  const opened = Math.round(delivered * t.open);
  const clicks = Math.round(delivered * t.ctr);
  return {
    sent, delivered, opened, clicks,
    openPct: delivered ? +(opened / delivered * 100).toFixed(1) : 0,
    ctrPct: delivered ? +(clicks / delivered * 100).toFixed(1) : 0,
    basis: `${t.label}. Assumes deliverability ${Math.round(t.deliver * 100)}%, open ${Math.round(t.open * 100)}% of delivered, CTR ${(t.ctr * 100).toFixed(1)}% of delivered (clicks). Planning hypothesis, swap for live Klaviyo rates when flows run.`,
  };
}

// ── Column derivations -------------------------------------------------------
function dayName(dateStr) {
  const d = new Date((dateStr || '') + 'T00:00:00Z');
  if (isNaN(d)) return '';
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
}
function themeAndSetting(entry, hero) {
  const festival = entry.festival && (entry.festival.name || entry.festival);
  const objective = entry.objective || entry.play_name || 'Lifecycle send';
  const cat = (hero && hero.type) || (entry.heroProduct && entry.heroProduct.category) || 'product';
  const setting = `${cat} ritual moment`;
  return [festival ? `${festival} moment` : null, objective, setting].filter(Boolean).join(' · ');
}
function whyBasis(entry) {
  const parts = [];
  if (entry.rationale) parts.push(String(entry.rationale));
  const a = entry.analysis;
  if (a && Array.isArray(a.confidence && a.confidence.factors)) {
    const fac = a.confidence.factors.filter((f) => f.on || f.when).map((f) => f.label).filter(Boolean);
    if (fac.length) parts.push('Confidence drivers: ' + fac.join('; ') + '.');
  }
  if (entry.confidence != null) {
    const c = typeof entry.confidence === 'object' ? entry.confidence.score : entry.confidence;
    if (c != null) parts.push(`Model confidence ${Math.round(c * 100)}%.`);
  }
  if (entry.ownDataReference && entry.ownDataReference.name) parts.push(`Reuses own-data winner: ${entry.ownDataReference.name}.`);
  return parts.join(' ') || 'Planned from cohort objective and product-mix rotation.';
}
// Deterministic, brand-safe subject / preheader / CTA suggestion per send.
// (The live generator writes richer LLM copy; this gives the export a concrete
// starting line even when built without an LLM call.) No banned phrases, no
// em/en dashes.
function suggestCopy(cohortName, hero, offer) {
  const c = String(cohortName || '').toLowerCase();
  const prod = (hero && hero.title) || 'your pick';
  const off = offer && offer.pct > 0 ? ` ${Math.round(offer.pct * 100)}% off` : '';
  let subject, preheader, cta;
  if (/vip|champion|prestige|single.?studio/.test(c)) { subject = `Your VIP pick: ${prod}`; cta = 'Claim my VIP offer'; }
  else if (/cart|abandon|checkout|recovery/.test(c)) { subject = `You left something behind`; cta = 'Complete my order'; }
  else if (/winback|lapsed|at.?risk|non.?engager/.test(c)) { subject = `It has been a while, come back and see what is new`; cta = 'Claim my welcome-back offer'; }
  else if (/new sub|first.?purchase|activation|non.?buyer/.test(c)) { subject = `Welcome, ${prod} awaits`; cta = 'Get started'; }
  else if (/gift|gifting|high.?aov/.test(c)) { subject = `A gift they will actually keep`; cta = 'Browse gifts'; }
  else if (/replenish|subscribe|repeat|loyal/.test(c)) { subject = `Never run out of ${prod}`; cta = 'Start my subscription'; }
  else if (/browse|discovery|sampler|variety/.test(c)) { subject = `Not sure where to start? Try ${prod}`; cta = 'Try the sampler'; }
  else { subject = `${prod}, picked for you`; cta = 'See more'; }
  preheader = off ? `A quiet upgrade, with${off} today.` : `A quiet upgrade, chosen for you.`;
  return { subject, preheader, cta };
}

// AOV basis for revenue-per-recipient: the hero product price when known, else
// the store 90-day AOV. Real number, never fabricated.
function aovFor(hero) {
  const p = hero && hero.price != null ? Number(hero.price) : NaN;
  return Number.isFinite(p) && p > 0 ? p : 42.73; // store 90d AOV fallback
}

function assetPrompts(entry, market, hero, supporting) {
  const base = {
    market: String(market || 'US').toUpperCase(),
    cohort: (entry.cohort && entry.cohort.name) || entry.cohort_label || '',
    brief: entry.rationale || entry.objective || '',
    products: [hero, ...supporting].filter(Boolean).map((p) => ({ title: p.title, price: p.price, handle: p.handle, category: p.type })),
  };
  const section = (label, o) => `### ${label}\n${buildMasterPrompt(o)}`;
  const imageNote = hero && hero.image
    ? `\n\n### IMAGE ASSETS (real, drop straight in)\nHero image: ${hero.image}\n${supporting.filter((s) => s.image).map((s) => `${s.title}: ${s.image}`).join('\n')}\nAll product images above are real hosted catalog URLs; use them as the mailer/ad/LP hero and product shots. Any generated image must be text-free and on-palette.`
    : '';
  return [
    section('MAILER PROMPT', { ...base, assetType: 'mailer', variant: 'V2' }),
    section('META AD PROMPT', { ...base, assetType: 'ad', platform: 'meta' }),
    section('GOOGLE AD PROMPT', { ...base, assetType: 'ad', platform: 'google' }),
    section('TIKTOK AD PROMPT', { ...base, assetType: 'ad', platform: 'tiktok' }),
    section('LANDING PAGE PROMPT', { ...base, assetType: 'landing_page' }),
  ].join('\n\n') + imageNote;
}

const COLUMNS = [
  'Date', 'Day', 'Mailer Theme & Setting', 'Hero Product(s)', 'Supporting Products',
  'Why (data basis)', 'Target Cohort / Audience', 'Size Status', 'Audience Count',
  'Offer Depth', 'Discount Code', 'Suggested Subject', 'Suggested Preheader', 'Suggested CTA',
  'Suppression',
  'Expected Sent', 'Expected Delivered', 'Expected Opened', 'Expected Open %',
  'Expected CTR %', 'Expected Clicks', 'Expected Rev / Recipient', 'Expected Metrics Basis',
  'Product Links (real)', 'Product Image Links (real)', 'Mailer + Asset Prompts',
];

// ctx (optional) threads the running window state so suppression is progressive:
//   { index, priorCohorts:[names] } for the send's position in the sorted plan.
function buildRow(entry, ctx = {}) {
  const market = entry.market || 'US';
  const hero = resolveProduct(entry.heroProduct || entry.hero_handle || entry.hero_product, market, entry.brand)
    || (entry.heroProduct ? { title: entry.heroProduct.title, handle: entry.heroProduct.handle || null, image: null, price: null, type: entry.heroProduct.category || 'product', url: storeBase(market) } : null);
  const supporting = hero ? supportingProducts(hero, entry, market, 2) : [];
  const cohortName = (entry.cohort && entry.cohort.name) || entry.cohort_label || entry.cohort_key || '';
  const audience = (entry.cohort && (entry.cohort.size != null ? entry.cohort.size : entry.cohort.count)) || entry.audience_count || 0;

  // Guardrail: offer depth + the correct semantic (at-or-below-cap) code.
  const offer = GR.offerFor(cohortName, entry.objective || entry.play_name || '');
  const offerLabel = offer.pct > 0
    ? `${Math.round(offer.pct * 100)}% off${offer.min ? ` (min $${offer.min})` : ''}${offer.pct >= GR.DISCOUNT_CAP ? ' (at cap)' : ''}`
    : 'No discount';

  // Guardrail: ESP-pending gating — withhold the revenue projection until the
  // real size lands in Klaviyo, rather than project off a placeholder count.
  const pending = GR.isEspPending(entry.cohort || cohortName) || !(+audience > 0);
  const em = expectedMetrics(cohortName, audience);
  const rpr = GR.revenuePerRecipient({ aov: aovFor(hero), deliverRate: 0.97, ctr: (em.ctrPct || 0) / 100 });
  const copy = suggestCopy(cohortName, hero, offer);
  const suppression = GR.suppressionFor(ctx.index || 0, ctx.priorCohorts || [], entry.suppress || null);
  const allProducts = [hero, ...supporting].filter(Boolean);

  const blank = pending ? '' : undefined;
  return {
    'Date': entry.date || '',
    'Day': dayName(entry.date),
    'Mailer Theme & Setting': themeAndSetting(entry, hero),
    'Hero Product(s)': hero ? hero.title : (entry.heroProduct && entry.heroProduct.title) || '',
    'Supporting Products': supporting.map((s) => s.title).join('; '),
    'Why (data basis)': whyBasis(entry) + ' ' + offer.rationale,
    'Target Cohort / Audience': cohortName,
    'Size Status': pending ? 'Size pending Klaviyo (ESP)' : 'Sized',
    'Audience Count': pending && !(+audience > 0) ? 'to ESP' : audience,
    'Offer Depth': offerLabel,
    'Discount Code': offer.code || '—',
    'Suggested Subject': copy.subject,
    'Suggested Preheader': copy.preheader,
    'Suggested CTA': copy.cta,
    'Suppression': suppression,
    'Expected Sent': pending ? blank : em.sent,
    'Expected Delivered': pending ? blank : em.delivered,
    'Expected Opened': pending ? blank : em.opened,
    'Expected Open %': pending ? blank : em.openPct,
    'Expected CTR %': pending ? blank : em.ctrPct,
    'Expected Clicks': pending ? blank : em.clicks,
    'Expected Rev / Recipient': pending ? blank : `$${rpr.toFixed(2)}`,
    'Expected Metrics Basis': pending
      ? 'Cohort size resolves in Klaviyo (affinity / behavioural / product-type segment). Revenue projection withheld until the real size lands, so nothing is fabricated.'
      : `${em.basis} Rev/recipient uses AOV $${aovFor(hero).toFixed(2)}.`,
    'Product Links (real)': allProducts.map((p) => `${p.title}: ${p.url}`).join('\n'),
    'Product Image Links (real)': allProducts.filter((p) => p.image).map((p) => `${p.title}: ${p.image}`).join('\n'),
    'Mailer + Asset Prompts': assetPrompts(entry, market, hero, supporting),
  };
}

// ── CSV serialisation --------------------------------------------------------
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}
function toCSV(rows) {
  const head = COLUMNS.map(csvCell).join(',');
  const body = rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(',')).join('\r\n');
  // UTF-8 BOM so Google Sheets / Excel read it as UTF-8 on import.
  return '﻿' + head + '\r\n' + body + '\r\n';
}

function buildExportCsv(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && e.date);
  list.sort((a, b) => String(a.date + (a.market || '')).localeCompare(String(b.date + (b.market || ''))));
  // Progressive suppression: each send excludes the cohorts already mailed
  // earlier in the (per-market) window.
  const priorByMarket = {};
  const rows = list.map((entry, index) => {
    const mk = entry.market || 'US';
    const priorCohorts = (priorByMarket[mk] || []).slice();
    const row = buildRow(entry, { index, priorCohorts });
    const name = (entry.cohort && entry.cohort.name) || entry.cohort_label || entry.cohort_key || '';
    if (name) (priorByMarket[mk] = priorByMarket[mk] || []).push(name);
    return row;
  });
  return toCSV(rows);
}

module.exports = { buildExportCsv, buildRow, expectedMetrics, resolveProduct, COLUMNS };
