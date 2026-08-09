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
    slug: "shoe-surgeon", name: "The Shoe Surgeon", site: "https://theshoesurgeon.com/", tier: "Tier 1",
    vertical: "Bespoke commission studio", products: "Full deconstruct-and-rebuild commissions, exotic leathers, build classes",
    entry: "POA (quoted per commission)", sub: "None: every pair is a new commission", serving: "POA, the bespoke ceiling of the arena",
    intro: "None; demand exceeds capacity", bundles: "Build classes and workshops", gifting: "Bespoke gifting at commission prices",
    benefit: "Footwear as a luxury object, rebuilt from the ground up", provenance: "Client-supplied or sourced originals, rebuilt in-house",
    platform: "Custom site, enquiry-led", churn: "Reputation and waiting list rather than lifecycle marketing",
    channels: "Press, collaborations, Instagram", cohort: "Collectors, athletes, artists",
    desktop: "Portfolio-led, enquiry rather than checkout", mobile: "Editorial gallery, no buy path",
    loyalty: "Named-artist prestige and collaboration halo",
    strengths: ["Defines the craft ceiling of the whole category", "Collaboration and press equity money cannot buy"],
    weaknesses: ["Nothing to browse and nothing to buy today", "Commission-length lead times and POA pricing", "Capacity is structurally capped"],
    edge: ["Serve the customer who wants a one-of-one this month, not next year", "Publish a real price on a real finished design", "Keep the craft proof visible so the gap reads as access, not quality"],
    strategies: ["Commission-only, priced on application", "Build and reveal video", "UGC / creator proof"]
  },
  {
    slug: "nike-by-you", name: "Nike By You", site: "https://www.nike.com/", tier: "Tier 1",
    vertical: "Brand-run configurator", products: "Air Force 1, Dunk and running silhouettes with selectable panel colours",
    entry: "Brand list price (n/v, configurator renders client-side)", sub: "None", serving: "n/v: verify in a browser before quoting",
    intro: "Member perks", bundles: "None", gifting: "Gift cards and configurator gifting",
    benefit: "Make an icon yours, in your colours", provenance: "Official Nike product, made to order by Nike",
    platform: "Nike.com and the Nike app", churn: "Membership programme and app engagement",
    channels: "Brand marketing, app, retail", cohort: "Mainstream personalisation buyers",
    desktop: "Full 3D configurator, panel-by-panel colour selection", mobile: "Native app configurator, strong build flow",
    loyalty: "Nike membership ecosystem",
    strengths: ["The largest personalisation funnel in the world", "Official supply, brand trust and local fulfilment everywhere"],
    weaknesses: ["Colour swaps only, no artwork of any kind", "No illustration, character or portrait work is possible", "Every build looks like a variant, never a one-of-one"],
    edge: ["Target the configurator graduate: they wanted a design and got a colour", "Show artwork the configurator structurally cannot produce", "Match their base credibility with the 100% original claim, then out-design them"],
    strategies: ["Configurator / self-serve personalisation", "Limited drops / scarcity"]
  },
  {
    slug: "converse-by-you", name: "Converse By You", site: "https://www.converse.com/", tier: "Tier 2",
    vertical: "Brand-run configurator", products: "Chuck Taylor and Chuck 70 with selectable colours, prints and patches",
    entry: "Brand list price (n/v, configurator renders client-side)", sub: "None", serving: "n/v: verify in a browser before quoting",
    intro: "Seasonal campaigns", bundles: "None", gifting: "Configurator gifting",
    benefit: "Put your prints and patches on a Chuck", provenance: "Official Converse product",
    platform: "Converse.com", churn: "Brand campaigns rather than lifecycle",
    channels: "Brand marketing, retail, social", cohort: "Younger self-expression buyers",
    desktop: "Canvas-led builder with print and patch libraries", mobile: "Competent builder, template-bound",
    loyalty: "Brand affinity rather than programme",
    strengths: ["Canvas silhouettes take print exceptionally well", "Accessible entry price into personalisation"],
    weaknesses: ["Templated prints, not painted artwork", "No character, portrait or scene work", "Every option is drawn from a fixed library"],
    edge: ["KNICKGASM Converse customs sit on the same silhouette from $99.84 (&pound;79.42) with painted artwork", "Show the difference between a printed template and a painted panel", "Own the fandom subjects a licensed template library will never carry"],
    strategies: ["Configurator / self-serve personalisation"]
  },
  {
    slug: "vans-customs", name: "Vans Customs", site: "https://www.vans.com/", tier: "Tier 2",
    vertical: "Brand-run configurator", products: "Authentic, Old Skool, Slip-On with prints, patches and material swaps",
    entry: "Brand list price (n/v, configurator renders client-side)", sub: "None", serving: "n/v: verify in a browser before quoting",
    intro: "Seasonal campaigns", bundles: "None", gifting: "Configurator gifting",
    benefit: "Express yourself on a Vans silhouette", provenance: "Official Vans product",
    platform: "Vans.com", churn: "Brand and community programmes",
    channels: "Brand marketing, skate and music culture, social", cohort: "Youth self-expression buyers",
    desktop: "Playful builder with wide print library", mobile: "Strong mobile builder, template-bound",
    loyalty: "Deep subculture affinity",
    strengths: ["Genuine subculture credibility in skate and music", "Broadest print and material library of the configurators"],
    weaknesses: ["Still a template, no painted artwork", "Personalisation reads as selection, not creation"],
    edge: ["Answer the customer who exhausted the library and still wanted something specific", "Lead with subjects a licensed library cannot include", "Use the same subculture language without the template ceiling"],
    strategies: ["Configurator / self-serve personalisation", "Fandom and licensed-design pull"]
  },
  {
    slug: "ceeze", name: "Ceeze", site: "https://ceeze.com/", tier: "Tier 2",
    vertical: "Artist commission studio", products: "Hand-painted commissioned pairs, artist collaborations",
    entry: "POA (quoted per commission)", sub: "None", serving: "POA",
    intro: "None; commission queue", bundles: "None", gifting: "Commissioned gift pairs",
    benefit: "A pair painted personally, by a named artist", provenance: "Client-supplied originals, painted by hand",
    platform: "Custom site, enquiry and DM-led", churn: "Personal relationship and reputation",
    channels: "Instagram, athlete and music placement", cohort: "Collectors and high-profile clients",
    desktop: "Portfolio gallery, enquiry path", mobile: "Instagram-first discovery",
    loyalty: "The artist's name on the pair",
    strengths: ["Genuine artist credibility and high-profile placement", "Personal relationship with every client"],
    weaknesses: ["Capacity is one artist's hands", "No catalog, no listed price, no committed date", "No international express fulfilment"],
    edge: ["Studio volume means many builds a week rather than one", "Every design KNICKGASM films is already buyable", "Committed 10 to 15 day made-to-order beats an open-ended queue"],
    strategies: ["Commission-only, priced on application", "Build and reveal video", "UGC / creator proof"]
  },
  {
    slug: "kickstradomis", name: "Kickstradomis", site: "https://kickstradomis.com/", tier: "Tier 2",
    vertical: "Artist commission studio", products: "Hand-painted commissioned pairs with a recognisable house style",
    entry: "POA (quoted per commission)", sub: "None", serving: "POA",
    intro: "None; commission queue", bundles: "None", gifting: "Commissioned gift pairs",
    benefit: "A distinctive painted style, made for you", provenance: "Client-supplied originals, hand-painted",
    platform: "Custom site, enquiry-led", churn: "Reputation and sport ties",
    channels: "Instagram, sport partnerships", cohort: "Athletes, fans, collectors",
    desktop: "Gallery-led, enquiry rather than checkout", mobile: "Social-first discovery",
    loyalty: "House style and long-running sport association",
    strengths: ["Instantly recognisable style", "Deep sport and athlete relationships"],
    weaknesses: ["Same structural ceiling as any single-artist studio", "Demand outruns capacity", "Nothing browsable or buyable"],
    edge: ["Breadth of subject matter across many fandoms, not one house style", "A catalog that can be searched rather than a queue that has to be joined", "Reliability and a date, which a single artist cannot promise"],
    strategies: ["Commission-only, priced on application", "Build and reveal video"]
  },
  {
    slug: "etsy-customs", name: "Etsy custom-sneaker sellers", site: "https://www.etsy.com/", tier: "Tier 1",
    vertical: "Marketplace long tail", products: "Thousands of independent hand-painted sneaker listings",
    entry: "Long tail, seller-set (n/v: no single price exists)", sub: "None", serving: "n/v: sample as a band, never quote a number",
    intro: "Coupon and sale-led", bundles: "Seller-specific", gifting: "Personalised gifting listings",
    benefit: "A painted pair, cheaper", provenance: "Seller-sourced; base originality frequently unverified",
    platform: "Etsy marketplace", churn: "Marketplace favourites and coupons, no owned relationship",
    channels: "Marketplace search, Pinterest, social", cohort: "Price-led first-time custom buyers",
    desktop: "Marketplace search and listing grid", mobile: "Marketplace app, review-driven",
    loyalty: "Marketplace loyalty, not brand loyalty",
    strengths: ["Enormous aggregate supply and search visibility", "Sets the price anchor buyers arrive with"],
    weaknesses: ["Base originality frequently unverified", "Paint durability varies enormously", "Delivery is unmanaged and quality is unpredictable"],
    edge: ["Do not answer this tier with a discount, answer it with the 100% original base", "Show the water and scratch resistant finish being applied", "A studio that answers, with a stated 10 to 15 day window"],
    strategies: ["Marketplace long tail / price anchoring", "Fandom and licensed-design pull"]
  },
  {
    slug: "stockx", name: "StockX", site: "https://stockx.com/", tier: "Tier 1",
    vertical: "Sneaker resale marketplace", products: "Authenticated resale of released pairs",
    entry: "Market price (n/v: moves per listing)", sub: "None", serving: "n/v: per-SKU market pricing",
    intro: "First-order codes", bundles: "None", gifting: "Gift cards",
    benefit: "The known grail, verified", provenance: "Authenticated original pairs, unaltered",
    platform: "Proprietary marketplace", churn: "Drop calendar and price-alert engagement",
    channels: "App, SEO, social, drop calendar", cohort: "Hype-led collectors and resellers",
    desktop: "Bid-ask market interface", mobile: "App-first with price alerts",
    loyalty: "Authentication trust and market liquidity",
    strengths: ["Authentication is a genuinely valuable trust product", "Unmatched liquidity and price transparency"],
    weaknesses: ["Nothing unique is ever produced", "Rare, but never singular", "No craft, no story, no personalisation"],
    edge: ["Compete on singular versus rare, the argument a marketplace cannot answer", "Own gifting, where duplication is precisely the problem", "Point the grail budget at Air Jordan and Adidas Samba customs"],
    strategies: ["Authentication as the trust product", "Limited drops / scarcity"]
  },
  {
    slug: "goat", name: "GOAT", site: "https://www.goat.com/", tier: "Tier 2",
    vertical: "Sneaker resale marketplace", products: "Authenticated resale, new and used, plus apparel",
    entry: "Market price (n/v: moves per listing)", sub: "None", serving: "n/v: per-SKU market pricing",
    intro: "First-order codes", bundles: "None", gifting: "Gift cards",
    benefit: "Verified pairs with editorial curation", provenance: "Authenticated original pairs, unaltered",
    platform: "Proprietary marketplace", churn: "Editorial content and app engagement",
    channels: "App, editorial, social", cohort: "Style-led collectors",
    desktop: "Editorial merchandising over a resale catalog", mobile: "Strong app browsing experience",
    loyalty: "Curation and authentication",
    strengths: ["Editorial curation raises perceived quality", "Authentication plus a strong app experience"],
    weaknesses: ["Produces nothing unique", "Competes on access and hype, not on creation"],
    edge: ["Use their editorial standard as the bar for KNICKGASM's own design storytelling", "Argue uniqueness against curation", "Take gifting budget with a pair that cannot be bought twice"],
    strategies: ["Authentication as the trust product", "UGC / creator proof"]
  },
  {
    slug: "crepdog-crew", name: "CrepDog Crew", site: "https://crepdogcrew.com/", tier: "Tier 2",
    vertical: "India sneaker resale and drops", products: "Resale originals, streetwear, drops",
    entry: "Market price (n/v: moves per listing)", sub: "None", serving: "n/v: per-SKU resale pricing",
    intro: "Drop-led", bundles: "Occasional", gifting: "Occasional gifting",
    benefit: "Access to grails in India, authenticated", provenance: "Resale originals, authenticated",
    platform: "Shopify storefront", churn: "Drop cadence and community",
    channels: "Instagram, community, drops", cohort: "Indian sneakerheads and youth collectors",
    desktop: "Drop-led merchandising", mobile: "Social-first, drop reminders",
    loyalty: "Community standing and drop access",
    strengths: ["Strong youth reach and community credibility in India", "Authentication as a trust product in a market that needs it"],
    weaknesses: ["Produces nothing unique", "Competes on hype and access, both of which expire"],
    edge: ["Take grail budget with a pair that is singular rather than merely rare", "Use the same community language without depending on drop scarcity", "Own gifting and occasion, which resale serves badly"],
    strategies: ["Authentication as the trust product", "Limited drops / scarcity", "UGC / creator proof"]
  },
  {
    slug: "vegnonveg", name: "VegNonVeg", site: "https://www.vegnonveg.com/", tier: "Tier 2",
    vertical: "India sneaker and streetwear retail", products: "Authorised originals, streetwear apparel, collaborations",
    entry: "Retail price (n/v: per-SKU)", sub: "None", serving: "n/v: per-SKU retail pricing",
    intro: "Seasonal", bundles: "Occasional", gifting: "Gift cards",
    benefit: "Curated sneaker culture, done properly", provenance: "Authorised original product",
    platform: "Shopify storefront plus physical stores", churn: "Curation, community and store experience",
    channels: "Retail, Instagram, community", cohort: "Indian sneaker and streetwear buyers",
    desktop: "Editorial retail merchandising", mobile: "Clean retail browsing",
    loyalty: "Cultural credibility and store community",
    strengths: ["Arguably India's most culturally credible sneaker retailer", "Curation and community rather than discounting"],
    weaknesses: ["Sells only pairs that already exist", "No customisation capability at all"],
    edge: ["Match their curation standard in how KNICKGASM merchandises collections", "Compete for the same wallet on uniqueness, never on price", "Treat them as the proof that curation beats discounting in this market"],
    strategies: ["Browsable finished-design catalog", "UGC / creator proof"]
  },
  {
    slug: "crep-protect", name: "Crep Protect", site: "https://www.crepprotect.com/", tier: "Tier 3",
    vertical: "Sneaker care and protection", products: "Protect spray, cleaning kits, wipes, insoles",
    entry: "Retail price (n/v: PDP renders client-side)", sub: "None", serving: "n/v: verify before quoting",
    intro: "Bundle kits", bundles: "Care kits and multi-packs", gifting: "Care gift sets",
    benefit: "Keep a pair looking new", provenance: "Own-brand care formulations",
    platform: "Shopify storefront plus wide retail distribution", churn: "Consumable replenishment",
    channels: "Retail, Amazon, social", cohort: "Anyone who owns sneakers they care about",
    desktop: "Product-led care catalog", mobile: "Simple, replenishment-friendly",
    loyalty: "Habit and consumable repeat",
    strengths: ["Normalised paying to protect a pair, globally", "Wide retail distribution and strong habit formation"],
    weaknesses: ["Not a competitor: no product of its own to personalise", "Commodity pressure from own-label alternatives"],
    edge: ["Their existence makes the water and scratch resistant claim legible to buyers", "Rope laces and lace tags are the natural KNICKGASM equivalent attach", "Own the care conversation for hand-painted pairs specifically, which they cannot"],
    strategies: ["Care, protection and restoration", "Accessory attach and basket-building"]
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
'  <p class="mt-2 max-w-3xl text-[14px]" style="color:#9fb0a8;">' + b.vertical + '. Full side-by-side comparison across products, offers, pricing, base sneaker and provenance, retention and UX. KNICKGASM figures are exact, read from the built catalogs. Competitor figures that could not be read off an official page are marked n/v or POA, never guessed.</p>',
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
  return page(b.name + " vs KNICKGASM :: Market Study", "Full comparison of " + b.name + " vs KNICKGASM: products, offers, pricing, base sneaker and provenance, retention and UX.", main);
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
'  <p class="mt-2 max-w-3xl text-[14px]" style="color:#9fb0a8;">A dedicated page per brand across the custom-sneaker arena: bespoke studios, brand configurators, the marketplace long tail, resale and sneaker care. Products, offers, pricing, base sneaker and provenance, retention, channels, cohorts and UX, each compared directly to KNICKGASM.</p>',
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
