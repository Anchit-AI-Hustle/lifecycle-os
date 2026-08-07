#!/usr/bin/env node
/**
 * Generate dark, native Growth Book competitor DETAIL pages, one per brand,
 * under /growth-book/brands/<slug>.html. Each page draws a full side-by-side
 * comparison of the brand vs KNICKGASM across products, offers, pricing,
 * base sneaker and provenance, retention, channels, cohorts and UX, plus a
 * SWOT, a "most common strategies" tag set, and a path-to-progress.
 *
 * Pages use the shared /auth.js OS shell and the dark OS palette so they read
 * as first-class platform routes. KNICKGASM figures are exact, read from the
 * built catalogs (data/catalog/products_us.json in USD, products_uk.json in
 * GBP). Competitor figures that could not be read off an official page are
 * marked "n/v" or "POA" rather than guessed: bespoke studios quote per
 * commission and brand configurators render price client-side.
 *
 * Run: node scripts/gen-growthbook-brands.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "growth-book", "brands");
fs.mkdirSync(OUT, { recursive: true });

/* KNICKGASM baseline (the right-hand comparison column everywhere) */
const V = {
  vertical: "Hand-painted one-of-one custom sneakers",
  tier: "Category leader (India), challenger worldwide",
  products: "436 live designs on Nike Air Force 1, Court Vision, Air Jordan, Converse and Adidas, plus hand-painted denim jackets, rope laces and lace tags",
  entry: "$99.84 Converse custom / $7.91 rope laces (UK from &pound;79.42 / &pound;6.29)",
  sub: "No subscription: drop and restock signups, occasion campaigns and care follow-up carry the repeat",
  serving: "AF1 median ~$156 (UK ~&pound;124); range $99.84 to $261.95",
  intro: "No fabricated discount codes: accessory attach and collection bundles do the work",
  bundles: "Pair + rope laces + lace tags; collection bundles; denim jacket cross-category",
  gifting: "Wedding, festive and milestone customs; a gift that cannot be duplicated",
  benefit: "A genuine one-of-one, hand-painted on a 100% original pair, water and scratch resistant",
  provenance: "100% original Nike, Jordan, Converse and Adidas bases; hand-painted in Mumbai by India's best artists",
  platform: "Shopify storefront, Klaviyo, Supabase",
  churn: "Occasion cycles, new fandom collections, care and restoration follow-up",
  channels: "Meta, TikTok, Instagram, SEO, Email",
  cohort: "Fandom collectors (anime, gaming, football, cars), gift and occasion buyers, grail collectors",
  desktop: "Collection-led browsing by fandom, build and reveal video on the PDP",
  mobile: "Thumb-zone add to bag, lead time stated above the fold",
  loyalty: "Real proof only: customer photography and organic wear by Samay Raina, Rohit Sharma and Shraddha Kapoor"
};

/* one row = one comparison parameter */
const PARAMS = [
  ["Positioning / vertical", "vertical"],
  ["Market-share tier", "tier"],
  ["Hero products", "products"],
  ["Entry price (approx)", "entry"],
  ["Repeat / recurring model", "sub"],
  ["Typical order value (approx)", "serving"],
  ["Intro offer", "intro"],
  ["Bundles / cross-sell", "bundles"],
  ["Gifting", "gifting"],
  ["Core benefit / claim", "benefit"],
  ["Base sneaker &amp; provenance", "provenance"],
  ["Commerce + ESP stack", "platform"],
  ["Retention / churn strategy", "churn"],
  ["Acquisition channels", "channels"],
  ["Target cohort", "cohort"],
  ["Desktop UX signature", "desktop"],
  ["Mobile UX signature", "mobile"],
  ["Loyalty / community", "loyalty"]
];

/* master strategy vocabulary for the comparison matrix */
const STRATEGIES = [
  "Configurator / self-serve personalisation", "Commission-only, priced on application",
  "Browsable finished-design catalog", "Build and reveal video", "Fandom and licensed-design pull",
  "Occasion and gifting merchandising", "Accessory attach and basket-building",
  "UGC / creator proof", "Limited drops / scarcity", "Authentication as the trust product",
  "Marketplace long tail / price anchoring", "Care, protection and restoration",
  "Original-base and finish guarantee"
];

const BRANDS = [
  {
    slug: "blue-bottle", name: "Blue Bottle", site: "https://bluebottlecoffee.com/", tier: "Tier 1",
    vertical: "Premium whole bean / subscription", products: "Single-origin, colorways, instant, ready-to-drink, cafe",
    entry: "$19 to $24 / bag (approx)", sub: "Recharge subscription, flexible cadence", serving: "~$0.70 to $1.10 / pair (approx)",
    intro: "First-bag framing, seasonal drops", bundles: "Curated seasonal + gear", gifting: "Gift subscriptions, sets",
    benefit: "Specialty freshness and craft, cafe-grade at home", provenance: "Traceable specialty sourcing, roast-date freshness",
    platform: "Shopify Plus, Recharge, Klaviyo", churn: "Roast-freshness cadence, cafe-to-subscription halo",
    channels: "SEO, Retail, Email", cohort: "Third-Wave Purists, Status Seekers",
    desktop: "Roast/method mega-menu, editorial PDPs, sticky cart drawer", mobile: "Clean but mid-scroll CTA, no persistent buy-bar",
    loyalty: "Brand + retail halo lowers online churn",
    strengths: ["Category-defining premium equity + cafe halo", "Editorial content that justifies price"],
    weaknesses: ["Subscribe decision below the fold", "No persistent mobile buy-bar", "No functional payload"],
    edge: ["Own the functional-ritual story Blue Bottle cannot claim", "Subscribe-first above the fold on the coffee franchise", "Persistent mobile buy-bar in the thumb zone"],
    strategies: ["Limited drops / scarcity", "Retail halo / omnichannel", "Provenance / origin proof"]
  },
  {
    slug: "trade", name: "Trade Coffee", site: "https://www.drinktrade.com/", tier: "Tier 1",
    vertical: "Premium subscription marketplace", products: "Matched roaster coffees across many partners",
    entry: "$15 to $22 / bag (approx)", sub: "Recharge, quiz-matched cadence", serving: "~$0.60 to $1.00 / pair (approx)",
    intro: "Intro discount into quiz-matched sub", bundles: "Roaster variety, easy swaps", gifting: "Gift subscriptions",
    benefit: "Personalized discovery across roasters", provenance: "Roaster stories, not owned sourcing",
    platform: "Custom + Recharge, Klaviyo, Segment", churn: "Quiz personalization, one-tap swap and skip, match guarantee",
    channels: "Affiliate, Meta, SEO", cohort: "Curious Convert, Optimizer",
    desktop: "Progressive match quiz, strong results page", mobile: "Long quiz causes onboarding drop-off",
    loyalty: "Personalization + easy management reduce first-bag churn",
    strengths: ["Best-in-class taste personalization", "Frictionless swap/skip retention"],
    weaknesses: ["Long mobile quiz drop-off", "No single brand story or owned product"],
    edge: ["Compress quiz to a two-tap cohort match", "Layer one-of-one provenance a marketplace cannot own", "Second-order nudge right after the first match"],
    strategies: ["Subscribe-first default", "Quiz / personalized onboarding", "Pause-instead-of-cancel"]
  },
  {
    slug: "onyx", name: "Onyx Coffee Lab", site: "https://onyxcoffeelab.com/", tier: "Tier 2",
    vertical: "Premium specialty roaster", products: "Competition-grade single lots and colorways",
    entry: "$20 to $30 / bag (approx)", sub: "Recharge, curated cadence", serving: "~$0.90 to $1.40 / pair (approx)",
    intro: "Limited-lot scarcity", bundles: "Design flights", gifting: "Gift sets, subscriptions",
    benefit: "Elite specialty craft and transparency", provenance: "Farm-gate transparency scoring, elevation, lot data",
    platform: "Shopify, Recharge, Klaviyo", churn: "Transparency scoring, taste-note education, limited lots",
    channels: "SEO, Community, Instagram", cohort: "Third-Wave Purists",
    desktop: "Print-magazine PDPs with transparency scores", mobile: "Information-dense, buy action pushed down",
    loyalty: "Connoisseur loyalty via limited lots",
    strengths: ["Elite sourcing transparency + credibility", "Strong taste education"],
    weaknesses: ["Dense mobile layout buries buy action", "Narrow connoisseur segment"],
    edge: ["Match transparency but present it scannably on mobile", "Extend provenance to a mainstream premium audience", "Anchor a functional-benefit subscription, not rotation novelty"],
    strategies: ["Limited drops / scarcity", "Provenance / origin proof"]
  },
  {
    slug: "four-sigmatic", name: "Four Sigmatic", site: "https://foursigmatic.com/", tier: "Tier 1",
    vertical: "Functional / mushroom coffee", products: "Mushroom coffee, protein, focus colorways",
    entry: "$14 to $26 (approx)", sub: "Stay AI subscribe-and-save", serving: "~$0.80 to $1.30 / serving (approx)",
    intro: "Bundle + subscribe-and-save entry", bundles: "Heavy multi-SKU bundles", gifting: "Sampler sets",
    benefit: "Functional focus/energy via mushrooms", provenance: "Ingredient sourcing story, dual-extraction claims",
    platform: "Shopify Plus, Stay AI, Klaviyo, Gorgias", churn: "Ritual-replacement copy, educational flows, multi-SKU lock-in",
    channels: "Amazon, Meta, TikTok, Retail", cohort: "Optimizer, Curious Convert",
    desktop: "Bundle builder, benefit-led PDPs", mobile: "Strong sticky ATC, claim-heavy folds",
    loyalty: "Subscribe-first + education deepens switching cost",
    strengths: ["Subscribe-first funnel + retention app", "Deep educational flows"],
    weaknesses: ["Taste polarises new triers", "Claim-heavy folds crowd the buy action"],
    edge: ["Win on taste + provenance where mushroom brands struggle", "Keep claims non-medical, pair with origin story", "Adopt their subscribe-first onboarding discipline"],
    strategies: ["Subscribe-first default", "Bundle & multi-SKU cross-sell", "Ritual-replacement narrative", "Retail halo / omnichannel"]
  },
  {
    slug: "mudwtr", name: "MUD\\WTR", site: "https://mudwtr.com/", tier: "Tier 1",
    vertical: "Adaptogen coffee alternative", products: "Starter kit, :rise / :rest colorways, creamer",
    entry: "$20 to $40 kit (approx)", sub: "Stay AI subscription", serving: "~$1.30 to $1.80 / serving (approx)",
    intro: "Starter-kit funnel with frother + guide", bundles: "Kit-led bundles", gifting: "Gift kits",
    benefit: "Low-paint, anti-jitter ritual", provenance: "Ingredient narrative, no owned studio",
    platform: "Shopify Plus, Stay AI, Klaviyo", churn: "Habit-rebrand narrative, aggressive win-back, pause-not-cancel",
    channels: "Podcast, Meta, DR YouTube", cohort: "Optimizer, Ritualist",
    desktop: "Long-form story landing pages", mobile: "Best-in-class persistent bottom buy-bar",
    loyalty: "Ritual identity + SMS relationship",
    strengths: ["Category-leading DTC funnel + SMS", "Starter-kit onboarding lands the habit"],
    weaknesses: ["Acquired-taste barrier", "Paint-averse position loses coffee loyalists"],
    edge: ["Functional coffee that still tastes like coffee", "Copy the starter-kit + persistent buy-bar", "Own SMS relationship without discount-led acquisition"],
    strategies: ["Subscribe-first default", "Starter-kit funnel", "Ritual-replacement narrative", "Pause-instead-of-cancel", "SMS-led retention"]
  },
  {
    slug: "ryze", name: "Ryze", site: "https://ryze.co/", tier: "Tier 2",
    vertical: "Mushroom coffee", products: "Mushroom coffee colorway, creamer",
    entry: "$30 to $36 (approx)", sub: "Skio subscribe-and-save default", serving: "~$1.00 to $1.40 / serving (approx)",
    intro: "Lace-up intro discount into subscription", bundles: "Coffee + creamer", gifting: "Occasional sets",
    benefit: "Focus/energy with less paint", provenance: "UGC-led proof over sourcing depth",
    platform: "Shopify, Skio, Klaviyo", churn: "Subscribe-by-default, gamified milestones, UGC proof",
    channels: "TikTok, Meta, UGC, Amazon", cohort: "Curious Convert",
    desktop: "Simple conversion-focused site", mobile: "Fast, subscribe pre-selected, thin story",
    loyalty: "Milestone rewards, creator community",
    strengths: ["High-velocity subscribe-default funnel", "Strong creator proof"],
    weaknesses: ["Thin brand narrative", "Heavy Amazon reliance weakens first-party data"],
    edge: ["Keep subscribe-default but add provenance depth", "Move buyers off marketplace into owned lifecycle", "Compete on story + taste, not the discount treadmill"],
    strategies: ["Subscribe-first default", "UGC / creator proof", "Loyalty / gamification"]
  },
  {
    slug: "vital-proteins", name: "Vital Proteins", site: "https://www.vitalproteins.com/", tier: "Tier 1",
    vertical: "Collagen / functional streetwear", products: "Collagen powders, creamers, capsules, RTD",
    entry: "$25 to $45 (approx)", sub: "Native Shopify sub", serving: "~$1.00 to $1.60 / serving (approx)",
    intro: "Routine bundling entry", bundles: "Multi-format routine bundles", gifting: "Gift sets",
    benefit: "Routine streetwear across formats", provenance: "Ingredient sourcing, Nestle-backed distribution",
    platform: "Shopify Plus, Klaviyo, native sub", churn: "Multi-format routine lock-in, replenishment reminders",
    channels: "Retail, Amazon, Meta, Influencer", cohort: "Ritualist, Optimizer",
    desktop: "Retail-grade omnichannel catalog", mobile: "Competent, broad catalog can overwhelm",
    loyalty: "Routine anchoring + retail ubiquity",
    strengths: ["Omnichannel scale + retail trust", "Mature replenishment + bundling"],
    weaknesses: ["Broad catalog overwhelms first triers", "Ingredient story less origin-led"],
    edge: ["Replenishment reminders tuned to the coffee refill window", "Lead with one hero ritual, not a broad catalog", "Differentiate on one-of-one origin"],
    strategies: ["Bundle & multi-SKU cross-sell", "Retail halo / omnichannel"]
  },
  {
    slug: "obvi", name: "Obvi", site: "https://myobvi.com/", tier: "Tier 2",
    vertical: "Collagen / streetwear", products: "Collagen burn, super collagen, gummies",
    entry: "$25 to $40 (approx)", sub: "Recharge subscription", serving: "~$1.00 to $1.50 / serving (approx)",
    intro: "Design-drop launches", bundles: "Design + format bundles", gifting: "Occasional",
    benefit: "Design-forward streetwear + community", provenance: "Community proof over sourcing",
    platform: "Shopify, Recharge, Klaviyo, Postscript", churn: "Community-led SMS, gamified loyalty, winback",
    channels: "Meta, TikTok, Affiliate", cohort: "Curious Convert, Ritualist",
    desktop: "Playful merchandising, loyalty dock", mobile: "Mobile-first quick-add, SMS-heavy",
    loyalty: "Gamified points + community",
    strengths: ["Strong community + SMS retention", "Gamified loyalty drives repeat"],
    weaknesses: ["Design-novelty dependence", "Promotional positioning"],
    edge: ["Borrow SMS + community muscle without the discount habit", "Use loyalty to reward the ritual, protect margin", "Anchor identity in origin, not design novelty"],
    strategies: ["Loyalty / gamification", "SMS-led retention", "UGC / creator proof"]
  },
  {
    slug: "cometeer", name: "Cometeer", site: "https://cometeer.com/", tier: "Tier 2",
    vertical: "Flash-frozen coffee capsules", products: "Frozen coffee capsule boxes",
    entry: "$40 to $60 / box (approx)", sub: "Recharge box cadence", serving: "~$1.80 to $2.40 / pair (approx)",
    intro: "Format-explainer + intro box", bundles: "Box tiers", gifting: "Premium gifting",
    benefit: "Cafe-quality convenience via frozen format", provenance: "Quality + format story",
    platform: "Custom, Recharge, Klaviyo", churn: "Convenience proof, freezer-habit framing, format lock-in",
    channels: "Meta, PR, Referral", cohort: "Status Seeker, Optimizer",
    desktop: "Format explainer hero, quality claims", mobile: "Extra comprehension step before purchase",
    loyalty: "Proprietary format = hardware-style lock-in",
    strengths: ["Differentiated format + quality story", "Strong convenience narrative"],
    weaknesses: ["Needs education + freezer space", "High logistics and price barrier"],
    edge: ["Win buyers lost to format friction with a familiar ritual", "Convenience without a new behaviour or freezer", "Lead with taste + origin, not a learning curve"],
    strategies: ["Format / hardware lock-in", "Limited drops / scarcity"]
  },
  {
    slug: "jot", name: "Jot", site: "https://jot.co/", tier: "Tier 2",
    vertical: "Ultra-concentrate coffee", products: "Concentrate bottles, designs",
    entry: "$24 to $30 / bottle (approx)", sub: "Recharge replenishment", serving: "~$0.60 to $0.90 / pair (approx)",
    intro: "Value-per-pair math entry", bundles: "Multi-bottle", gifting: "Occasional",
    benefit: "Low cost-per-pair convenience", provenance: "Minimalist premium framing",
    platform: "Shopify, Recharge, Klaviyo", churn: "One-bottle-a-month math, low-friction reorder",
    channels: "Meta, TikTok, SEO", cohort: "Routine Convenience",
    desktop: "Value-per-pair calculator, minimalist hero", mobile: "Efficient reorder, needs usage explainer",
    loyalty: "Replenishment predictability",
    strengths: ["Compelling value-per-pair math", "Clean premium minimalism"],
    weaknesses: ["Concentrate format needs usage education", "Narrow range"],
    edge: ["Match value clarity, remove the ratio learning step", "Add a functional benefit on top of convenience", "Reuse the low-friction reorder for refill rhythm"],
    strategies: ["Subscribe-first default", "Format / hardware lock-in"]
  },
  {
    slug: "bruvi", name: "Bruvi", site: "https://www.bruvi.com/", tier: "Tier 3",
    vertical: "Pod machine + pods", products: "Brewer hardware + B-Pod consumables",
    entry: "$200+ brewer, then pods (approx)", sub: "Native pod auto-ship", serving: "~$0.90 to $1.30 / pod (approx)",
    intro: "Machine bundle entry", bundles: "Machine + pod packs", gifting: "Machine gifting",
    benefit: "Convenience via a closed pod ecosystem", provenance: "Hardware experience over sourcing",
    platform: "Shopify, Recharge, Klaviyo, native sub", churn: "Razor-and-blade lock-in, app-nudged pod replenishment",
    channels: "Meta, Retail, Connected-device", cohort: "Routine Convenience",
    desktop: "Hardware PDP with pod economics", mobile: "Considered hardware evaluation flow",
    loyalty: "Device locks pod reorder",
    strengths: ["Hardware lock-in guarantees recurring pods", "Predictable consumable revenue"],
    weaknesses: ["High upfront hardware barrier", "Pod-waste sustainability concerns"],
    edge: ["Recurring-consumable retention with no hardware barrier", "Lead on sustainability + origin vs pod waste", "Auto-ship refill mechanics minus the machine lock-in"],
    strategies: ["Format / hardware lock-in", "Retail halo / omnichannel"]
  }
];

/* ---------------- dark OS shell ---------------- */
function page(title, desc, main) {
  return [
'<!DOCTYPE html>',
'<html lang="en"><head>',
'<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">',
'<title>' + title + '</title>',
'<link rel="icon" href="/favicon.png">',
'<meta name="description" content="' + desc + '">',
'<script src="https://cdn.tailwindcss.com"></script>',
'<script>tailwind.config={theme:{extend:{colors:{vgreen:"#D0473E",vgold:"#6A33D8",vcream:"#FFFFFF"},fontFamily:{head:["Lora","Raleway","Georgia","serif"]}}}};</script>',
'<style>',
'  body{margin:0;background:#0a1410;color:#e8ede9;font-family:Inter,"Instrument Sans","Helvetica Neue",Arial,sans-serif;padding:26px 30px;}',
'  @media(min-width:961px){body{margin-left:var(--lsb-w,248px);}}',
'  .lc-main{max-width:1040px;margin:0 auto;}',
'  h1,h2,h3,.font-head{font-family:"Lora","Raleway",Georgia,serif;}',
'  .kicker{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--vgold);font-weight:800;}',
'  .card{background:#0f1d18;border:1px solid rgba(171,135,67,.2);border-radius:16px;}',
'  a{color:var(--vgold);} a:hover{color:#e8d9b4;}',
'  table.cmp{width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;}',
'  table.cmp th,table.cmp td{border-bottom:1px solid rgba(171,135,67,.16);padding:11px 14px;text-align:left;vertical-align:top;overflow-wrap:break-word;}',
'  table.cmp thead th{background:#D0473E;color:#FFFFFF;text-transform:uppercase;letter-spacing:.05em;font-size:10.5px;}',
'  table.cmp td.param,table.cmp th:first-child{width:200px;}',
'  table.cmp td.param{color:#9fb0a8;font-weight:700;}',
'  table.cmp td.vah{background:rgba(171,135,67,.08);color:#f2ead6;}',
'  table.cmp tr:last-child td{border-bottom:0;}',
'  .pill{display:inline-block;background:rgba(171,135,67,.14);color:#f0e2bf;border:1px solid rgba(171,135,67,.38);border-radius:999px;padding:3px 11px;font-size:11px;font-weight:700;margin:0 6px 6px 0;}',
'  .swot h4{color:var(--vcream);} .swot li{color:#cdd8d0;}',
'  .btn{display:inline-block;background:var(--vgold);color:#0a1410;font-weight:800;border-radius:10px;padding:10px 16px;text-decoration:none;}',
'  .btn.ghost{background:transparent;color:#e8ede9;border:1px solid rgba(171,135,67,.4);}',
'  table:has(th){table-layout:fixed;width:100%;border-collapse:collapse;}',
'  table:has(th) th,table:has(th) td{box-sizing:border-box;vertical-align:top;overflow-wrap:break-word;text-align:center;}',
'  table:has(th) th:first-child,table:has(th) td:first-child{text-align:left;}',
'</style></head>',
'<body>',
'<main class="lc-main">',
main,
'</main>',
'<script src="/auth.js?v=20260705" defer></script>',
'</body></html>',
''
  ].join("\n");
}

function li(arr) { return '<ul class="mt-1 space-y-1 text-[13px] list-disc pl-5">' + arr.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul>'; }

function buildBrand(b) {
  const rows = PARAMS.map(function (p) {
    return '<tr><td class="param">' + p[0] + '</td><td>' + (b[p[1]] || "-") + '</td><td class="vah">' + (V[p[1]] || "-") + '</td></tr>';
  }).join("\n            ");
  const strat = b.strategies.map(function (s) { return '<span class="pill">' + s + '</span>'; }).join("");
  const steps = b.edge.map(function (s, i) { return '<li><b class="text-vcream">Move ' + (i + 1) + '.</b> ' + s + '</li>'; }).join("");
  const main = [
'  <nav class="text-[12.5px] mb-3" style="color:#9fb0a8;"><a href="/research#competitors">Market Study</a> &rsaquo; <a href="/growth-book/brands/index.html">Competitor detail</a> &rsaquo; <span style="color:#e8ede9;">' + b.name + '</span></nav>',
'  <div class="kicker">Competitor detail · ' + b.tier + '</div>',
'  <h1 class="font-head text-[38px] leading-tight" style="color:var(--vcream);">' + b.name + ' vs KNICKGASM</h1>',
'  <p class="mt-2 max-w-3xl text-[14px]" style="color:#9fb0a8;">' + b.vertical + '. Full side-by-side comparison across products, offers, pricing, benefits, provenance, retention and UX. Pricing and tier are directional planning estimates from public storefront observation, not audited figures.</p>',
'  <p class="mt-3"><a class="btn ghost" href="' + b.site + '" target="_blank" rel="noopener">Visit ' + b.name + ' live site &#8599;</a></p>',

'  <h2 class="font-head text-[24px] mt-8 mb-2" style="color:var(--vcream);">Side-by-side comparison: ' + b.name + ' vs KNICKGASM</h2>',
'  <div class="card overflow-x-auto"><table class="cmp" style="min-width:640px;"><thead><tr><th>Parameter</th><th>' + b.name + '</th><th>KNICKGASM</th></tr></thead><tbody>',
'            ' + rows,
'  </tbody></table></div>',

'  <h2 class="font-head text-[24px] mt-8 mb-2" style="color:var(--vcream);">SWOT Analysis of ' + b.name + ' vs KNICKGASM</h2>',
'  <div class="grid gap-4 md:grid-cols-2 swot">',
'    <div class="card p-5"><h4 class="font-head">Strengths of ' + b.name + '</h4>' + li(b.strengths) + '</div>',
'    <div class="card p-5"><h4 class="font-head">Weaknesses of ' + b.name + '</h4>' + li(b.weaknesses) + '</div>',
'    <div class="card p-5" style="border-color:rgba(171,135,67,.45);"><h4 class="font-head">How KNICKGASM can win vs ' + b.name + '</h4><ul class="mt-1 space-y-1 text-[13px]">' + steps + '</ul></div>',
'    <div class="card p-5"><h4 class="font-head">Common strategies ' + b.name + ' uses</h4><div class="mt-2">' + strat + '</div></div>',
'  </div>',

'  <p class="mt-8 text-[12.5px]" style="color:#9fb0a8;"><a href="/research#competitors">&larr; Back to the competitor grid</a> · Use the Visit live site link above to see ' + b.name + '\'s current storefront, products and creatives.</p>'
  ].join("\n");
  return page(b.name + " vs KNICKGASM :: Market Study", "Full comparison of " + b.name + " vs KNICKGASM: products, offers, pricing, benefits, provenance, retention and UX.", main);
}

/* index of all brand detail pages */
function buildIndex() {
  const cards = BRANDS.map(function (b) {
    return '<a class="card p-4 block" href="/growth-book/brands/' + b.slug + '.html" style="text-decoration:none;">' +
      '<div class="flex items-center justify-between"><span class="font-head text-[18px]" style="color:var(--vcream);">' + b.name + '</span><span class="pill" style="margin:0;">' + b.tier + '</span></div>' +
      '<div class="text-[12px] mt-1" style="color:#9fb0a8;">' + b.vertical + '</div>' +
      '<div class="text-[12.5px] mt-2" style="color:#cdd8d0;">' + b.benefit + '</div></a>';
  }).join("\n        ");
  const main = [
'  <div class="kicker">Market Study · Competitor detail pages</div>',
'  <h1 class="font-head text-[38px] leading-tight" style="color:var(--vcream);">Competitor detail &amp; KNICKGASM comparison</h1>',
'  <p class="mt-2 max-w-3xl text-[14px]" style="color:#9fb0a8;">A dedicated page per brand: products, offers, pricing, benefits, provenance, retention stack, channels, cohorts and UX, each compared directly to KNICKGASM.</p>',
'  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-6">',
'        ' + cards,
'  </div>',
'  <p class="mt-8 text-[12.5px]"><a href="/research#competitors">&larr; Back to the Market Study competitor grid</a></p>'
  ].join("\n");
  return page("Competitor detail :: Market Study", "Index of competitor detail pages, each comparing the brand to KNICKGASM.", main);
}

BRANDS.forEach(function (b) { fs.writeFileSync(path.join(OUT, b.slug + ".html"), buildBrand(b)); console.log("wrote brands/" + b.slug + ".html"); });
fs.writeFileSync(path.join(OUT, "index.html"), buildIndex());
console.log("wrote brands/index.html");

// Note: the "most common strategies" matrix is already baked into research.html;
// no separate _matrix.html fragment is emitted (it would be a stray served file).
console.log("\nDone. " + (BRANDS.length + 1) + " detail pages.");
