#!/usr/bin/env node
/**
 * Generator for the Knickgasm Growth & Automation Playbook multi-page hub.
 *
 * Emits a modular, NON-SPA ecosystem under /playbook:
 *   playbook/index.html                 -> master hub
 *   playbook/features/*.html            -> 8 deep-dive feature pages
 *   playbook/dossiers/*.html            -> 11 forensic competitor dossiers
 *
 * Every page is standalone and self-contained (Tailwind via CDN + inline
 * brand tokens). The LHS is a clean, flat, single-level command tower.
 * Brand-locked: 4-color palette, Montserrat + Instrument Sans, no banned phrases,
 * no em/en dashes.
 *
 * Run: node scripts/gen-playbook-hub.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const msc = require("./market-study-content");

const OUT = path.join(__dirname, "..", "playbook");

/* ---------------------------------------------------------------- nav model */
const FEATURES = [
  { key: "hub",                 icon: "\u{1F3E0}", label: "Playbook Hub",                    file: "index.html",                     hub: true },
  { key: "market-intelligence", icon: "\u{1F4CA}", label: "Macro Market Intelligence",       file: "features/market-intelligence.html" },
  { key: "market-study",        icon: "\u{1F4DA}", label: "Complete Market Study",            file: "features/market-study.html" },
  { key: "competitor-index",    icon: "\u{1F575}", label: "Forensic Competitor Dossiers",    file: "features/competitor-index.html" },
  { key: "knowledge-base",      icon: "\u{1F4D8}", label: "Direct-to-Origin Knowledge Base", file: "features/knowledge-base.html" },
  { key: "product-avatars",     icon: "\u{1F465}", label: "Product Avatars",                  file: "features/product-avatars.html" },
  { key: "analytics-engine",    icon: "\u{1F4C8}", label: "Intraday Pace & Predictive",      file: "features/analytics-engine.html" },
  { key: "asset-workspace",     icon: "⚙️", label: "Marketing Asset Workspace",    file: "features/asset-workspace.html" },
  { key: "shopify-loop",        icon: "\u{1F4E6}", label: "Shopify CDN Ingestion Loop",      file: "features/shopify-loop.html" },
  { key: "kicksgpt-config",      icon: "\u{1F916}", label: "KicksGPT Engine Config",           file: "features/kicksgpt-config.html" }
];

/* ---------------------------------------------------------- shared HTML head */
function head(title, desc) {
  return [
'<!DOCTYPE html>',
'<html lang="en">',
'<head>',
'<meta charset="UTF-8">',
'<meta name="viewport" content="width=device-width, initial-scale=1.0">',
'<title>' + title + '</title>',
'<link rel="icon" href="/favicon.png">',
'<meta name="description" content="' + desc + '">',
'<script src="https://cdn.tailwindcss.com"></script>',
'<script>',
'  tailwind.config = { theme: { extend: {',
'    colors: { knickgasm: { green:"#D0473E", lava:"#6A33D8", ink:"#111111", chalk:"#FFFFFF" } },',
'    fontFamily: { head:["Montserrat","Raleway","Georgia","serif"], body:["Instrument Sans","Helvetica Neue","Arial","sans-serif"] }',
'  } } };',
'</script>',
'<style>',
'  :root{--knickgasm-green:#D0473E;--knickgasm-lava:#6A33D8;--knickgasm-lava-ink:#8a6a2f;--knickgasm-ink:#111111;--knickgasm-chalk:#FFFFFF;--knickgasm-card:#FFFFFF;--line:rgba(23,23,23,.12);--soft:#5b5b57;}',
'  /* brand lava #6A33D8 fails WCAG as small text on chalk/white; use the darker lava-ink for lava TEXT on light backgrounds */',
'  .lava-ink{color:var(--knickgasm-lava-ink);}',
'  input::placeholder,textarea::placeholder{color:#6f6f6f;opacity:1;} #gen-out::placeholder{color:#9fb0a8;opacity:1;}',
'  html{scroll-behavior:smooth;scroll-padding-top:20px;}',
'  body{background:var(--knickgasm-chalk);color:var(--knickgasm-ink);font-family:"Instrument Sans","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;}',
'  h1,h2,h3,h4,.font-head{font-family:"Montserrat","Raleway",Georgia,serif;}',
'  .nav-link{transition:background .12s,color .12s;}',
'  .nav-link:hover{background:rgba(171,135,67,.16);color:var(--knickgasm-chalk);}',
'  .nav-link.active{background:var(--knickgasm-lava);color:var(--knickgasm-green);font-weight:700;}',
'  .card{background:var(--knickgasm-card);border:1px solid var(--line);border-radius:14px;}',
'  .metric{background:#fff;border:1px solid var(--line);border-radius:12px;}',
'  .metric .mv{font-family:"Montserrat",Georgia,serif;color:var(--knickgasm-green);}',
'  table.grid-tbl{border-collapse:collapse;width:100%;font-size:13px;min-width:820px;table-layout:fixed;}',
'  table.grid-tbl th,table.grid-tbl td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere;}',
'  table.grid-tbl th{background:var(--knickgasm-green);color:var(--knickgasm-chalk);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;}',
'  table.grid-tbl tr:nth-child(even) td{background:#faf7f0;}',
'  table.grid-tbl tr:last-child td{border-bottom:0;}',
'  .tier-1{color:var(--knickgasm-green);font-weight:700;} .tier-2{color:var(--knickgasm-lava-ink);font-weight:700;} .tier-3{color:var(--soft);font-weight:700;}',
'  .tierbadge{display:inline-flex;flex-direction:column;line-height:1.12;border-radius:8px;padding:4px 9px;text-align:center;}',
'  .tierbadge b{font-size:11px;font-weight:800;} .tierbadge i{font-style:normal;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;opacity:.85;}',
'  .tb1{background:rgba(0,74,43,.10);color:var(--knickgasm-green);} .tb2{background:rgba(171,135,67,.18);color:#8a6a2f;} .tb3{background:rgba(23,23,23,.07);color:var(--soft);}',
'  td.num{font-variant-numeric:tabular-nums;font-weight:700;color:var(--knickgasm-ink);white-space:nowrap;}',
'  .rtab{cursor:pointer;border:1.5px solid var(--line);background:#fff;color:var(--knickgasm-ink);border-radius:999px;padding:7px 18px;font-family:inherit;font-size:13px;font-weight:700;transition:all .12s;}',
'  .rtab:hover{border-color:var(--knickgasm-lava);} .rtab.on{background:var(--knickgasm-green);color:var(--knickgasm-chalk);border-color:var(--knickgasm-green);}',
'  .mstab{cursor:pointer;border:1.5px solid var(--line);background:#fff;color:var(--knickgasm-ink);border-radius:999px;padding:5px 14px;font-family:inherit;font-size:12px;font-weight:700;transition:all .12s;}',
'  .mstab:hover{border-color:var(--knickgasm-lava);} .mstab.on{background:var(--knickgasm-lava-ink);color:#fff;border-color:var(--knickgasm-lava-ink);}',
'  .av-card{background:var(--knickgasm-card);border:1px solid var(--line);border-radius:16px;padding:22px;}',
'  .av-face{width:56px;height:56px;border-radius:999px;background:var(--knickgasm-green);display:inline-flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;box-shadow:0 0 0 3px rgba(171,135,67,.35);}',
'  .av-quote{font-family:"Montserrat",Georgia,serif;font-style:italic;color:var(--knickgasm-green);border-left:3px solid var(--knickgasm-lava);padding-left:12px;margin:12px 0;}',
'  .av-q{cursor:pointer;text-align:left;background:#faf6ec;border:1px solid var(--line);border-radius:9px;padding:8px 11px;font-size:12.5px;color:var(--knickgasm-ink);transition:background .12s,border-color .12s;font-family:inherit;}',
'  .av-q:hover{border-color:var(--knickgasm-lava-ink);} .av-q.on{background:var(--knickgasm-lava);color:var(--knickgasm-green);font-weight:700;border-color:var(--knickgasm-lava-ink);}',
'  .av-bubble{display:none;margin-top:12px;background:var(--knickgasm-green);color:var(--knickgasm-chalk);border-radius:12px;border-top-left-radius:3px;padding:13px 15px;font-size:13.5px;line-height:1.55;}',
'  .av-roster{display:flex;flex-wrap:wrap;gap:10px;}',
'  .av-chip{display:flex;align-items:center;gap:8px;cursor:pointer;background:#fff;border:1.5px solid var(--line);border-radius:999px;padding:6px 14px 6px 6px;font-family:inherit;font-size:13px;color:var(--knickgasm-ink);transition:border-color .12s;}',
'  .av-chip:hover{border-color:var(--knickgasm-lava);} .av-chip.on{border-color:var(--knickgasm-green);background:var(--knickgasm-chalk);}',
'  .av-chip .f{width:32px;height:32px;border-radius:999px;background:var(--knickgasm-green);display:inline-flex;align-items:center;justify-content:center;font-size:17px;}',
'  .chat{background:#fff;border:1px solid var(--line);border-radius:16px;min-height:280px;max-height:52vh;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:10px;}',
'  .msg{max-width:82%;padding:11px 15px;border-radius:14px;font-size:14px;line-height:1.55;white-space:pre-wrap;}',
'  .msg.user{align-self:flex-end;background:var(--knickgasm-green);color:var(--knickgasm-chalk);border-bottom-right-radius:4px;}',
'  .msg.bot{align-self:flex-start;background:var(--knickgasm-chalk);color:var(--knickgasm-ink);border:1px solid var(--line);border-bottom-left-radius:4px;}',
'  .msg.bot a{color:var(--knickgasm-green);font-weight:600;}',
'  .prompt-chip{cursor:pointer;background:#faf6ec;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:12.5px;color:var(--knickgasm-ink);font-family:inherit;}',
'  .prompt-chip:hover{border-color:var(--knickgasm-lava);}',
'  .askbar{display:flex;gap:8px;margin-top:12px;}',
'  .askbar input{flex:1;border:1.5px solid var(--knickgasm-lava);border-radius:12px;padding:11px 14px;font-family:inherit;font-size:14px;color:var(--knickgasm-ink);background:#fff;}',
'  .mic{min-width:46px;border:1.5px solid var(--knickgasm-lava);background:var(--knickgasm-chalk);color:var(--knickgasm-green);border-radius:12px;cursor:pointer;font-size:16px;}',
'  .mic.on{background:#c0392b;color:#fff;border-color:#c0392b;}',
'  .pill{display:inline-block;border-radius:999px;padding:2px 11px;font-size:11px;font-weight:700;border:1px solid var(--line);}',
'  .btn-primary{background:var(--knickgasm-green);color:var(--knickgasm-chalk);border-radius:10px;font-weight:700;transition:filter .12s;} .btn-primary:hover{filter:brightness(1.15);}',
'  .btn-lava{background:var(--knickgasm-lava);color:var(--knickgasm-green);border-radius:10px;font-weight:800;transition:filter .12s;} .btn-lava:hover{filter:brightness(1.05);}',
'  .wire{border:2px dashed var(--knickgasm-lava);border-radius:12px;background:repeating-linear-gradient(45deg,#fff,#fff 12px,#faf6ec 12px,#faf6ec 24px);padding:16px;min-height:96px;}',
'  .wire .wl{font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:11.5px;color:var(--knickgasm-green);font-weight:700;letter-spacing:.02em;}',
'  details.blueprint{background:var(--knickgasm-ink);border-radius:12px;overflow:hidden;border:1px solid var(--line);}',
'  details.blueprint>summary{list-style:none;cursor:pointer;padding:13px 18px;color:var(--knickgasm-chalk);font-family:"Montserrat",Georgia,serif;font-size:16px;background:var(--knickgasm-green);display:flex;align-items:center;justify-content:space-between;}',
'  details.blueprint>summary::-webkit-details-marker{display:none;}',
'  details.blueprint[open]>summary .plus{transform:rotate(45deg);}',
'  details.blueprint pre{margin:0;padding:18px;overflow-x:auto;color:#e8ede9;font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:12.5px;line-height:1.6;}',
'  .code-out{font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:12.5px;line-height:1.55;}',
'  .flow-node{background:#fff;border:1px solid var(--line);border-radius:9px;padding:9px 12px;font-size:12.5px;}',
'  a{color:var(--knickgasm-green);} a:hover{color:var(--knickgasm-lava-ink);}',
'  ::selection{background:var(--knickgasm-lava);color:#fff;}',
'  section[data-section]{scroll-margin-top:18px;}',
'  /* Data-table alignment: headers over values (equal-width), first column left, rest centered. */',
'  table:has(th){table-layout:fixed;width:100%;border-collapse:collapse;}',
'  table:has(th) th,table:has(th) td{box-sizing:border-box;vertical-align:top;overflow-wrap:break-word;text-align:center;}',
'  table:has(th) th:first-child,table:has(th) td:first-child{text-align:left;}',
'</style>',
'</head>'
  ].join("\n");
}

/* ------------------------------------------------------- clean, flat sidebar */
function sidebar(prefix, activeKey) {
  const links = FEATURES.map(function (f) {
    const href = prefix + f.file;
    const active = f.key === activeKey ? " active" : "";
    return '<a href="' + href + '" class="nav-link block px-3 py-2 rounded-lg' + active + '">' +
           '<span class="mr-2">' + f.icon + '</span>' + f.label + '</a>';
  }).join("\n        ");

  return [
'  <aside class="hidden lg:flex flex-col w-[288px] shrink-0 sticky top-0 h-screen overflow-y-auto text-knickgasm-chalk" style="background:var(--knickgasm-green);">',
'    <div class="px-5 py-6 border-b" style="border-color:rgba(251,245,234,.14);">',
'      <div class="text-[10.5px] tracking-[.18em] uppercase font-bold text-knickgasm-lava">Knickgasm Lifecycle OS</div>',
'      <div class="font-head text-[21px] leading-tight mt-1">Growth &amp; Automation<br>Playbook</div>',
'      <p class="text-[11px] mt-2" style="color:#cdd8d0;">A modular documentation and execution hub. One page per feature and per competitor.</p>',
'    </div>',
'    <nav class="px-3 py-4 space-y-1 text-[13px]">',
'        ' + links,
'    </nav>',
'    <div class="mt-auto px-5 py-4 text-[11px] border-t" style="border-color:rgba(251,245,234,.14);color:#cdd8d0;">',
'      <a href="/all-in-one" class="underline" style="color:#cdd8d0;">OS Home</a> &nbsp;&middot;&nbsp; <a href="/research" class="underline" style="color:#cdd8d0;">Market Study</a>',
'    </div>',
'  </aside>'
  ].join("\n");
}

/* ------------------------------------------------------------ page assembler */
function page(opts) {
  // opts: {title, desc, prefix, activeKey, crumb, main, extraJS}
  const mobileBar =
'    <div class="lg:hidden sticky top-0 z-20 flex items-center justify-between px-5 py-3 text-knickgasm-chalk" style="background:var(--knickgasm-green);">' +
'<div class="font-head text-lg">' + (opts.crumb || "Playbook") + '</div>' +
'<a href="' + opts.prefix + 'index.html" class="text-xs pill" style="border-color:rgba(251,245,234,.3);color:var(--knickgasm-chalk);">Hub</a></div>';

  return [
head(opts.title, opts.desc),
'<body class="font-body">',
'<div class="flex min-h-screen">',
sidebar(opts.prefix, opts.activeKey),
'  <main class="flex-1 min-w-0">',
mobileBar,
'    <div class="max-w-[1080px] mx-auto px-6 md:px-10 py-10 space-y-14">',
opts.main,
'    </div>',
'  </main>',
'</div>',
(opts.extraJS ? '<script>\n' + opts.extraJS + '\n</script>' : ''),
'</body>',
'</html>',
''
  ].join("\n");
}

/* ----------------------------------------------------------- section helpers */
function hero(eyebrow, title, lede) {
  return [
'      <header class="space-y-3">',
'        <span class="text-[11px] tracking-[.18em] uppercase font-bold lava-ink">' + eyebrow + '</span>',
'        <h1 class="font-head text-4xl md:text-5xl text-knickgasm-green leading-[1.05]">' + title + '</h1>',
'        <p class="text-[15px] max-w-3xl" style="color:var(--soft);">' + lede + '</p>',
'      </header>'
  ].join("\n");
}
function secHead(eyebrow, title, sub) {
  return '<div><div class="text-[11px] tracking-[.16em] uppercase font-bold lava-ink">' + eyebrow + '</div>' +
         '<h2 class="font-head text-3xl text-knickgasm-green mt-1">' + title + '</h2>' +
         (sub ? '<p class="text-sm mt-2 max-w-3xl" style="color:var(--soft);">' + sub + '</p>' : '') + '</div>';
}
function metricCard(label, val, note, accent) {
  const style = accent ? ' style="border-color:var(--knickgasm-' + accent + ');border-width:2px;"' : '';
  const vstyle = accent === "lava" ? ' style="color:var(--knickgasm-lava-ink);"' : '';
  return '<div class="metric p-5"' + style + '><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">' + label +
         '</div><div class="mv text-4xl mt-1"' + vstyle + '>' + val + '</div>' +
         (note ? '<div class="text-[12.5px] mt-1" style="color:var(--soft);">' + note + '</div>' : '') + '</div>';
}
function linkBtn(href, label, ghost) {
  return '<a href="' + href + '" class="' + (ghost ? "btn-lava" : "btn-primary") + ' inline-block px-5 py-2.5 text-sm">' + label + '</a>';
}
function wireBox(label, desc) {
  return '<div class="wire"><div class="wl">' + label + '</div><p class="text-[13px] mt-2" style="color:var(--knickgasm-ink);">' + desc + '</p></div>';
}

/* ================================================================ COMPETITORS */
const COMPETITORS = [
  {
    slug: "blue-bottle", name: "Blue Bottle", category: "Premium coffee", tier: 1,
    desktopUX: "Mega-menu split by roast and craft method, sticky cart drawer, editorial PDPs rich with design notes. Gap: the subscription configurator sits below the fold and there is no persistent compare tray.",
    mobileUX: "Clean typography, but the primary add-to-cart falls mid-scroll with no persistent bottom buy-bar, and heavy hero carousels slow first paint on mid-tier connections.",
    stack: { checkout: "Shopify Plus checkout", subscription: "Recharge", analytics: "GA4 plus Fathom", esp: "Klaviyo" },
    churnHook: "Roast-freshness cadence emails and a cafe-to-subscription bridge for lapsed in-store buyers.",
    wires: [
      ["[SCREENSHOT: Desktop roast mega-menu]", "Two-column flyout grouping single-origin and colorways by craft method, with a featured seasonal tile on the right rail."],
      ["[SCREENSHOT: Mobile PDP mid-scroll CTA]", "Product hero, price, then a static add-to-cart that scrolls away; no thumb-zone sticky bar keeping the buy action in reach."],
      ["[SCREENSHOT: Subscription config modal]", "Frequency and grind selectors buried in a modal opened from below the fold, adding a step before the first subscribe decision."],
      ["[SCREENSHOT: Slide-in cart drawer]", "Right-side drawer with upsell row and free-shipping progress meter pegged to a fixed threshold."]
    ],
    swot: {
      s: ["Category-defining brand equity and cafe halo", "Editorial content that teaches crafting and justifies premium"],
      w: ["Subscribe decision is buried below the fold", "No persistent mobile buy-bar hurts thumb-zone conversion"],
      o: ["Functional payload storytelling they do not own", "Refill-rhythm reminders to protect the recurring base"],
      t: ["Discount-led rivals compressing entry price", "Retail dependence dilutes first-party data"]
    },
    path: [
      "Surface subscribe-first above the fold on the coffee franchise, the way Knickgasm anchors Coffee Collection.",
      "Ship a persistent mobile bottom buy-bar so the add-to-cart never leaves the thumb zone.",
      "Own the functional-ritual story Blue Bottle cannot claim, pairing origin with a real adaptogen benefit."
    ]
  },
  {
    slug: "trade", name: "Trade Coffee", category: "Coffee marketplace", tier: 1,
    desktopUX: "Quiz-matched roaster marketplace with a strong desktop quiz flow and clear swap-and-skip subscription controls in-account.",
    mobileUX: "The onboarding quiz runs long on mobile with many steps, creating drop-off before the first match and checkout.",
    stack: { checkout: "Custom headless checkout", subscription: "Recharge", analytics: "Segment plus GA4", esp: "Klaviyo" },
    churnHook: "Quiz-matched roasts with one-tap swap and skip that keep the subscription feeling personalised.",
    wires: [
      ["[SCREENSHOT: Desktop match quiz]", "Progressive multi-step quiz with a visible progress bar and a results page mapping taste inputs to roaster matches."],
      ["[SCREENSHOT: Mobile quiz drop-off point]", "Step 6 of a long mobile quiz where momentum stalls; no save-and-resume, no shortcut to browse."],
      ["[SCREENSHOT: In-account swap and skip]", "Subscription management with prominent skip, swap, and reschedule controls on the next shipment card."],
      ["[SCREENSHOT: Roaster spotlight PDP]", "Editorial roaster story above the buy box building trust in the marketplace curation."]
    ],
    swot: {
      s: ["Personalisation via the taste quiz", "Frictionless swap and skip retention controls"],
      w: ["Long mobile quiz creates onboarding drop-off", "Marketplace model dilutes a single brand story"],
      o: ["Shorter mobile quiz with save-and-resume", "First-order match paired with a second-order nudge"],
      t: ["Roaster-direct brands cutting out the marketplace", "Thin margins on a curation model"]
    },
    path: [
      "Borrow the quiz-to-match idea but compress it to a two-tap cohort match on mobile.",
      "Layer Knickgasm one-of-one provenance on top of personalisation, which a marketplace cannot own.",
      "Trigger the second-order nudge immediately after the first match to lift repeat rate."
    ]
  },
  {
    slug: "onyx", name: "Onyx Coffee Lab", category: "Specialty coffee", tier: 2,
    desktopUX: "Transparency-scored PDPs with farm-level sourcing detail and rich taste-note visuals; desktop feels like a specialty print magazine.",
    mobileUX: "Information-dense PDPs get cramped on mobile; the sourcing detail that sells the premium is hard to scan on a small screen.",
    stack: { checkout: "Shopify checkout", subscription: "Recharge", analytics: "GA4", esp: "Klaviyo" },
    churnHook: "Transparency scoring and taste-note storytelling that build a connoisseur relationship.",
    wires: [
      ["[SCREENSHOT: Desktop transparency score]", "Sourcing transparency badge with farm-gate price and elevation, positioned beside the buy box."],
      ["[SCREENSHOT: Mobile dense PDP]", "Long stacked specs that require heavy scrolling; the buy action is pushed far down the page."],
      ["[SCREENSHOT: Taste-note wheel]", "Interactive design wheel that maps each lot to sensory descriptors."],
      ["[SCREENSHOT: Subscription tier card]", "Curated rotating-selection subscription with a fixed cadence."]
    ],
    swot: {
      s: ["Elite specialty credibility and sourcing transparency", "Strong taste-note education"],
      w: ["Dense mobile layout buries the buy action", "Narrow to the connoisseur segment"],
      o: ["Cleaner mobile PDP hierarchy", "Provenance storytelling for a wider premium audience"],
      t: ["Larger premium brands with deeper media budgets", "Specialty niche caps the addressable market"]
    },
    path: [
      "Match the sourcing transparency but present it in a scannable mobile-first hierarchy.",
      "Extend provenance from a connoisseur cue to a mainstream premium hook, as Knickgasm does with studio stories.",
      "Anchor a subscription with a functional benefit rather than rotation novelty alone."
    ]
  },
  {
    slug: "four-sigmatic", name: "Four Sigmatic", category: "Functional / mushroom", tier: 1,
    desktopUX: "Subscribe-first onboarding with a desktop bundle builder and clear benefit-led PDPs; the default path pushes subscription hard.",
    mobileUX: "Strong mobile sticky add-to-cart and a fast bundle flow; benefit claims sometimes crowd the fold before the buy action.",
    stack: { checkout: "Shopify Plus checkout", subscription: "Stay AI", analytics: "Triple Whale plus GA4", esp: "Klaviyo" },
    churnHook: "Ritual-replacement copy and subscribe-first onboarding that reframe the morning coffee habit.",
    wires: [
      ["[SCREENSHOT: Desktop bundle builder]", "Grid selector for building a functional bundle with a live price and subscribe toggle."],
      ["[SCREENSHOT: Mobile sticky ATC]", "Persistent bottom add-to-cart with subscribe-and-save pre-selected in the thumb zone."],
      ["[SCREENSHOT: Benefit-led hero]", "Above-fold benefit claims with an ingredient callout and a subscribe-first CTA."],
      ["[SCREENSHOT: Onboarding email capture]", "Post-purchase flow entry that starts the ritual-replacement education sequence."]
    ],
    swot: {
      s: ["Subscribe-first funnel and strong retention app", "Clear functional benefit framing"],
      w: ["Claim-heavy folds can crowd the buy action", "Taste polarises new triers"],
      o: ["Provenance and one-of-one credibility they lack", "Taste-forward functional coffee positioning"],
      t: ["Crowded functional-mushroom category", "Regulatory scrutiny on benefit claims"]
    },
    path: [
      "Adopt subscribe-first as the default on Coffee Collection, matching their onboarding discipline.",
      "Win on taste and provenance where mushroom-forward brands struggle with palate acceptance.",
      "Keep benefit claims non-medical and pair them with the origin story for differentiated trust."
    ]
  },
  {
    slug: "mudwtr", name: "MUD\\Wtr", category: "Adaptogen coffee alternative", tier: 1,
    desktopUX: "Long-form editorial landing pages that sell the anti-jitter narrative, with a starter-kit as the primary entry offer.",
    mobileUX: "Best-in-class mobile bottom buy-bar and starter-kit flow; the story-first landing pages are tuned for paid social traffic.",
    stack: { checkout: "Shopify Plus checkout", subscription: "Stay AI", analytics: "Triple Whale", esp: "Klaviyo plus Postscript" },
    churnHook: "Starter-kit onboarding that rebrands the morning habit and a heavy SMS relationship.",
    wires: [
      ["[SCREENSHOT: Mobile persistent buy-bar]", "Fixed bottom bar with price and subscribe CTA that stays through the long landing page."],
      ["[SCREENSHOT: Starter-kit offer block]", "Bundle of base, frother, and guide framed as the ritual starting point."],
      ["[SCREENSHOT: Long-form paid-social LP]", "Story-first landing page with staged proof, testimonials, and repeated CTAs."],
      ["[SCREENSHOT: SMS opt-in modal]", "Aggressive but well-timed SMS capture tied to a first-order incentive."]
    ],
    swot: {
      s: ["Category-leading DTC funnel and SMS program", "Starter-kit onboarding that lands the habit"],
      w: ["Taste is an acquired-preference barrier", "Paint-averse positioning limits coffee loyalists"],
      o: ["A functional coffee that keeps real coffee taste", "Provenance credibility MUD\\Wtr cannot claim"],
      t: ["High paid-acquisition dependence", "Adaptogen-category noise"]
    },
    path: [
      "Copy the starter-kit onboarding and persistent mobile buy-bar for Coffee Collection.",
      "Position as functional coffee that still tastes like coffee, capturing loyalists MUD\\Wtr loses on taste.",
      "Build an owned SMS relationship rather than leaning on discount-led paid acquisition."
    ]
  },
  {
    slug: "ryze", name: "Ryze", category: "Mushroom coffee", tier: 2,
    desktopUX: "Simple conversion-focused site with subscribe-and-save as the default and heavy creator and review proof.",
    mobileUX: "Lightweight and fast on mobile with subscribe pre-selected, though the brand story is thin beyond the offer.",
    stack: { checkout: "Shopify checkout", subscription: "Skio", analytics: "GA4", esp: "Klaviyo" },
    churnHook: "Subscribe-and-save default with strong creator proof driving first purchase.",
    wires: [
      ["[SCREENSHOT: Subscribe-default PDP]", "Add-to-cart with subscription pre-selected and one-time relegated to a smaller toggle."],
      ["[SCREENSHOT: Creator proof wall]", "Grid of creator videos and reviews acting as the primary trust driver."],
      ["[SCREENSHOT: Mobile fast checkout]", "Minimal-step express checkout optimised for paid-social first-time buyers."],
      ["[SCREENSHOT: Amazon parity banner]", "Cross-channel reassurance for buyers who also see the brand on Amazon."]
    ],
    swot: {
      s: ["High-velocity subscribe-default funnel", "Strong creator-led social proof"],
      w: ["Thin brand narrative beyond the offer", "Heavy Amazon reliance weakens first-party data"],
      o: ["A defensible origin and provenance story", "Owned-channel retention beyond the initial discount"],
      t: ["Commoditised mushroom-coffee pricing wars", "Marketplace margin compression"]
    },
    path: [
      "Keep subscribe-as-default but reinforce it with a provenance narrative Ryze lacks.",
      "Move buyers off marketplace dependence into owned lifecycle flows for durable retention.",
      "Compete on story and taste rather than the discount treadmill."
    ]
  },
  {
    slug: "vital-proteins", name: "Vital Proteins", category: "Functional supplement", tier: 1,
    desktopUX: "Retail-grade omnichannel site with routine bundling, replenishment defaults, and a broad SKU catalog.",
    mobileUX: "Competent mobile experience with clear reorder paths, though the wide catalog can overwhelm first-time choice.",
    stack: { checkout: "Shopify Plus checkout", subscription: "Recharge", analytics: "GA4 plus Amplitude", esp: "Klaviyo" },
    churnHook: "Routine bundling and replenishment reminders that anchor a daily supplement habit.",
    wires: [
      ["[SCREENSHOT: Routine bundle builder]", "Guided flow assembling a daily routine from complementary SKUs with a subscribe default."],
      ["[SCREENSHOT: Replenishment reminder]", "Lifecycle email and on-site banner nudging reorder before the current supply runs out."],
      ["[SCREENSHOT: Broad catalog grid]", "Dense product grid with filters where first-time choice can stall."],
      ["[SCREENSHOT: Mobile reorder card]", "One-tap reorder of the last routine from the account home."]
    ],
    swot: {
      s: ["Omnichannel scale and retail trust", "Mature replenishment and bundling"],
      w: ["Broad catalog overwhelms first-time triers", "Ingredient story less origin-led"],
      o: ["A cleaner functional-coffee entry ritual", "Origin-led trust versus generic supplement framing"],
      t: ["Retail-scale competitors with big budgets", "Category price competition"]
    },
    path: [
      "Adopt replenishment reminders tuned to the coffee refill window.",
      "Lead with a single hero ritual rather than a broad catalog to reduce first-choice friction.",
      "Differentiate on one-of-one origin against generic supplement sourcing."
    ]
  },
  {
    slug: "obvi", name: "Obvi", category: "Collagen / streetwear", tier: 2,
    desktopUX: "Community-led, design-forward brand with gamified loyalty and playful desktop merchandising.",
    mobileUX: "Mobile-first and SMS-heavy with quick add flows; loyalty mechanics are surfaced prominently in the thumb zone.",
    stack: { checkout: "Shopify checkout", subscription: "Recharge", analytics: "GA4", esp: "Klaviyo plus Postscript" },
    churnHook: "Community-led SMS and gamified loyalty points that make reorder feel like a game.",
    wires: [
      ["[SCREENSHOT: Loyalty points dock]", "Persistent loyalty widget showing points balance and next-reward progress."],
      ["[SCREENSHOT: Mobile quick-add designs]", "Design selector with fast add-to-cart tuned for repeat mobile buyers."],
      ["[SCREENSHOT: SMS-led launch]", "Time-sensitive design drop announced primarily through SMS."],
      ["[SCREENSHOT: Community UGC wall]", "User photos and reviews stacked as the core trust layer."]
    ],
    swot: {
      s: ["Strong community and SMS retention", "Gamified loyalty driving repeat"],
      w: ["Design-novelty dependence", "Positioning skews promotional"],
      o: ["Premium provenance versus promo-led rivals", "Ritual depth over novelty churn"],
      t: ["Discount-habit erosion of margin", "Crowded collagen category"]
    },
    path: [
      "Borrow the community and SMS retention muscle without the discount habit.",
      "Use loyalty to reward the ritual, protecting full-margin loyalists from a promo reflex.",
      "Anchor identity in origin and craft rather than design novelty."
    ]
  },
  {
    slug: "cometeer", name: "Cometeer", category: "Frozen coffee format", tier: 3,
    desktopUX: "Format-led narrative selling frozen coffee capsules; desktop leans on convenience proof and quality claims.",
    mobileUX: "The freezer-shelf habit needs explaining on mobile; the novel format adds a comprehension step before purchase.",
    stack: { checkout: "Custom subscription checkout", subscription: "Recharge", analytics: "GA4", esp: "Klaviyo" },
    churnHook: "Convenience proof and freezer-shelf habit framing that lock in a recurring format.",
    wires: [
      ["[SCREENSHOT: Format explainer hero]", "Animated sequence showing capsule to pair, teaching the frozen format fast."],
      ["[SCREENSHOT: Mobile comprehension step]", "Extra how-it-works panel on mobile before the buy action to reduce format confusion."],
      ["[SCREENSHOT: Freezer-habit framing]", "Lifestyle imagery placing capsules in the freezer as a daily-ritual cue."],
      ["[SCREENSHOT: Subscription cadence picker]", "Delivery frequency tuned to average consumption."]
    ],
    swot: {
      s: ["Differentiated frozen format and quality story", "Strong convenience narrative"],
      w: ["Format needs education and freezer space", "Higher logistics and price barrier"],
      o: ["A no-new-behaviour ritual coffee", "Lower comprehension friction at purchase"],
      t: ["Format fatigue and cold-chain cost", "Convenience rivals with simpler formats"]
    },
    path: [
      "Win the buyers Cometeer loses to format friction with a familiar craft ritual.",
      "Keep the convenience promise without asking for a new behaviour or freezer space.",
      "Lead with taste and origin rather than a format learning curve."
    ]
  },
  {
    slug: "jot", name: "Jot", category: "Ultra-concentrate coffee", tier: 3,
    desktopUX: "Concentrate-led site selling one-tablespoon-per-pair math; desktop is clean with a clear value-per-pair story.",
    mobileUX: "Efficient mobile reorder with a low-friction path, though the concentrate format needs a quick usage explainer.",
    stack: { checkout: "Shopify checkout", subscription: "Recharge", analytics: "GA4", esp: "Klaviyo" },
    churnHook: "One-bottle-a-month math and a low-friction reorder that make replenishment feel effortless.",
    wires: [
      ["[SCREENSHOT: Value-per-pair calculator]", "Interactive one-bottle-equals-many-pairs math driving perceived value."],
      ["[SCREENSHOT: Mobile reorder path]", "Streamlined reorder from account with subscription cadence pre-set."],
      ["[SCREENSHOT: Usage explainer]", "Quick how-to-pour panel teaching the concentrate ratio."],
      ["[SCREENSHOT: Black-tie brand hero]", "Minimalist premium hero framing concentrate as an upscale staple."]
    ],
    swot: {
      s: ["Compelling value-per-pair math", "Clean premium minimalism"],
      w: ["Concentrate format needs usage education", "Narrow product range"],
      o: ["A ready-to-craft ritual without ratio math", "Functional payload beyond convenience"],
      t: ["Format novelty risk", "Convenience-segment price pressure"]
    },
    path: [
      "Match the value-per-pair clarity while removing the ratio learning step.",
      "Add a functional benefit on top of convenience, which Jot does not offer.",
      "Use the same low-friction reorder mechanics for the coffee refill rhythm."
    ]
  },
  {
    slug: "bruvi", name: "Bruvi", category: "Coffee hardware and pods", tier: 3,
    desktopUX: "Razor-and-blade model selling a brewer plus recurring pods; desktop centers on the hardware PDP and pod economics.",
    mobileUX: "Hardware purchase is a considered mobile decision; the pod auto-ship subscription is the retention engine post-hardware.",
    stack: { checkout: "Shopify checkout", subscription: "Recharge", analytics: "GA4", esp: "Klaviyo" },
    churnHook: "Razor-and-blade lock-in with auto-ship pods that guarantee recurring consumable revenue.",
    wires: [
      ["[SCREENSHOT: Hardware PDP]", "Brewer product page with financing framing and pod-cost economics."],
      ["[SCREENSHOT: Pod auto-ship setup]", "Post-hardware subscription setup for recurring pod replenishment."],
      ["[SCREENSHOT: Mobile considered-purchase flow]", "Longer mobile evaluation flow for the hardware decision with specs and comparisons."],
      ["[SCREENSHOT: Ecosystem lock-in banner]", "Messaging tying pod compatibility to the brewer to secure recurring revenue."]
    ],
    swot: {
      s: ["Hardware lock-in guarantees recurring pods", "Predictable consumable revenue"],
      w: ["High upfront hardware barrier", "Pod-format sustainability concerns"],
      o: ["No-hardware entry with lower friction", "Sustainability and origin story"],
      t: ["Established pod ecosystems and inertia", "Environmental sentiment against pods"]
    },
    path: [
      "Offer the recurring-consumable retention without a hardware barrier to entry.",
      "Lead on sustainability and origin against pod-waste sentiment.",
      "Use auto-ship replenishment mechanics for coffee refills, minus the machine lock-in."
    ]
  }
];

/* Reference matrix data (share tier, AOV, D-180 retention, primary hook,
   core tech stack one-liner, churn strategy) merged onto each competitor. */
const REF = {
  "blue-bottle":    { tier: 1, tierLabel: "High", aov: "$38.50", d180: "34.20%", hook: "Retail crossover synergy",              stackShort: "Shopify Plus / Recharge Suite",       churnShort: "48-hour interactive pre-shipment SMS" },
  "trade":          { tier: 1, tierLabel: "High", aov: "$45.00", d180: "31.10%", hook: "Personalized algorithmic onboarding quiz", stackShort: "Headless engine / Next.js / Stripe", churnShort: "Dynamic personalized bean-profile rotations" },
  "onyx":           { tier: 2, tierLabel: "Med",  aov: "$42.00", d180: "36.50%", hook: "Specialty roaster transparency content", stackShort: "Shopify Plus / Skio Subscription",    churnShort: "Subscriber-only vintage lot reservations" },
  "four-sigmatic":  { tier: 1, tierLabel: "High", aov: "$52.00", d180: "22.50%", hook: "Top functional host audio endorsements", stackShort: "Shopify Plus / Stay AI Hub",          churnShort: "Down-dose optimization on exit intents" },
  "mudwtr":         { tier: 1, tierLabel: "High", aov: "$60.00", d180: "21.80%", hook: "Aggressive alternative-ritual video",     stackShort: "Headless pipeline / Recharge API",    churnShort: "Complimentary hardware-kit locking values" },
  "ryze":           { tier: 2, tierLabel: "Med",  aov: "$55.00", d180: "23.10%", hook: "High-frequency TikTok Shop loops",        stackShort: "Shopify Core / Skio Sub / Klaviyo",   churnShort: "Gamified milestone rewards interface" },
  "vital-proteins": { tier: 1, tierLabel: "High", aov: "$48.00", d180: "26.80%", hook: "B2B retail programmatic integration pull", stackShort: "Salesforce Commerce / Ordergroove",  churnShort: "Cross-catalog item value bundling" },
  "obvi":           { tier: 2, tierLabel: "Med",  aov: "$50.00", d180: "24.50%", hook: "Highly managed VIP Facebook forums",      stackShort: "Shopify Plus / Skio / Postscript",    churnShort: "Community streetwear challenge onboarding" },
  "cometeer":       { tier: 1, tierLabel: "High", aov: "$64.00", d180: "41.10%", hook: "Luxury gifting and tech pioneer seeding", stackShort: "Custom proprietary Next.js stack",    churnShort: "Hardware storage cross-subsidization" },
  "jot":            { tier: 2, tierLabel: "Med",  aov: "$36.00", d180: "28.90%", hook: "Recipe video creative ad permutations",   stackShort: "Shopify Core / Recharge Engine",      churnShort: "Automated multi-use recipe push tracks" },
  "bruvi":          { tier: 3, tierLabel: "Low",  aov: "$58.00", d180: "25.40%", hook: "Machine-plus-pod ecosystem seeding",      stackShort: "Shopify Core / Recharge Engine",      churnShort: "Auto-ship pod replenishment lock-in" }
};
COMPETITORS.forEach(function (c) {
  const r = REF[c.slug];
  if (r) { c.tier = r.tier; c.tierLabel = r.tierLabel; c.aov = r.aov; c.d180 = r.d180; c.hook = r.hook; c.stackShort = r.stackShort; c.churnShort = r.churnShort; }
});

function tierSpan(t) { return '<span class="tier-' + t + '">Tier ' + t + '</span>'; }
function tierBadge(c) { return '<span class="tierbadge tb' + c.tier + '"><b>Tier ' + c.tier + '</b><i>' + c.tierLabel + '</i></span>'; }

/* master competitor matrix (used on hub + competitor-index) */
function competitorMatrix(dossierPrefix) {
  const rows = COMPETITORS.map(function (c) {
    const href = dossierPrefix + "dossiers/" + c.slug + ".html";
    return '<tr>' +
      '<td><a href="' + href + '" class="font-semibold" style="color:var(--knickgasm-green);text-decoration:underline;">' + c.name + '</a><div class="text-[11px]" style="color:var(--soft);">' + c.category + '</div></td>' +
      '<td>' + tierBadge(c) + '</td>' +
      '<td class="num">' + c.aov + '</td>' +
      '<td class="num">' + c.d180 + '</td>' +
      '<td>' + c.hook + '</td>' +
      '<td class="code-out" style="font-size:11.5px;">' + c.stackShort + '</td>' +
      '<td>' + c.churnShort + '</td>' +
      '<td><a href="' + href + '" class="btn-lava inline-block px-3 py-1.5 text-[12px] whitespace-nowrap">Open dossier &rarr;</a></td>' +
    '</tr>';
  }).join("\n              ");

  return [
'        <div class="card overflow-x-auto">',
'          <table class="grid-tbl" style="min-width:1180px;">',
'            <thead><tr>',
'              <th>Brand Name</th><th>Share Tier</th><th>AOV</th><th>D-180 Ret</th><th>Primary Hook</th><th>Core Tech Stack</th><th>Churn Strategy</th><th>Deep-Dive</th>',
'            </tr></thead>',
'            <tbody>',
'              ' + rows,
'            </tbody>',
'          </table>',
'        </div>'
  ].join("\n");
}

/* ------------------------------------------------------ cohort data + cards */
const COHORTS = [
  { id: "third-wave-purists", n: "Third-Wave Purists", tag: "Loyalist", income: "$95k to $180k", roast: "Light to medium, single-origin",
    desc: "Buys on provenance and craft. Reads taste notes and studio names. Full-margin, protect from a discount habit. Hook: origin story and pair character." },
  { id: "functional-optimizers", n: "Functional Optimizers", tag: "Subscriber", income: "$70k to $140k", roast: "Adaptogen colorway, medium",
    desc: "Comes for the functional payload and the routine. Highest subscription bias. Hook: refill rhythm, Coffee Collection as a daily ritual." },
  { id: "biohacking-performers", n: "Biohacking Performers", tag: "High-intent", income: "$110k to $220k", roast: "Medium-dark, high-dose adaptogen",
    desc: "Optimises inputs and tracks outcomes. Responds to dose, sourcing, and stacking logic. Hook: precise payload and companion supplements." },
  { id: "routine-convenience", n: "Routine Convenience", tag: "Switcher", income: "$55k to $110k", roast: "Medium, ground or instant",
    desc: "Buys for ease and price sensitivity. The discount-responsive switcher. Hook: convenience proof, low-friction reorder, second-order nudge." }
];
function cohortCards() {
  return '<div class="grid gap-5 md:grid-cols-2">' + COHORTS.map(function (c, i) {
    const accent = i % 2 === 0 ? "green" : "lava";
    const tagColor = accent === "lava" ? "var(--knickgasm-lava-ink)" : "var(--knickgasm-green)";
    return '<div id="' + c.id + '" class="card p-6 border-l-4" style="border-left-color:var(--knickgasm-' + accent + ');">' +
      '<div class="flex items-center justify-between"><h3 class="font-head text-xl text-knickgasm-green">' + c.n + '</h3>' +
      '<span class="pill" style="background:var(--knickgasm-chalk);color:' + tagColor + ';">' + c.tag + '</span></div>' +
      '<div class="grid grid-cols-2 gap-3 mt-4 text-sm">' +
      '<div><div class="text-[11px] uppercase font-bold" style="color:var(--soft);">Income band</div><div class="mt-0.5">' + c.income + '</div></div>' +
      '<div><div class="text-[11px] uppercase font-bold" style="color:var(--soft);">Roast preference</div><div class="mt-0.5">' + c.roast + '</div></div></div>' +
      '<p class="text-sm mt-3" style="color:var(--knickgasm-ink);">' + c.desc + '</p></div>';
  }).join("") + '</div>';
}

/* ============================================ interactive JS (String.raw safe) */
const JS_ANALYTICS = String.raw`
(function(){
  "use strict";
  var baseHour = 10;
  function pseudo(seed){ var x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); }
  function renderPace(offset){
    offset = offset || 0;
    var body = document.getElementById('pace-body'); if(!body) return;
    var rows = '', prevRev = 0, latest = null;
    for(var i=11;i>=0;i--){
      var seed = i + 1 + offset;
      var rev = Math.round(900 + pseudo(seed)*1700);
      var orders = Math.round(20 + pseudo(seed*2)*34);
      var subs = Math.round(2 + pseudo(seed*3)*11);
      var hr = ((baseHour - i) % 24 + 24) % 24;
      var label = (hr<10?'0':'')+hr+':00';
      var delta = prevRev ? Math.round(((rev-prevRev)/prevRev)*100) : 0;
      var arrow = delta>=0 ? '&#9650; +' : '&#9660; ';
      var col = delta>=0 ? 'var(--knickgasm-green)' : '#a23b2b';
      rows += '<tr><td>'+label+'</td><td>$'+rev.toLocaleString()+'</td><td>'+orders+'</td><td>'+subs+'</td>'+
              '<td style="color:'+col+';font-weight:700;">'+(prevRev?arrow+Math.abs(delta)+'%':'-')+'</td></tr>';
      prevRev = rev; latest = { rev: rev, orders: orders, subs: subs, delta: delta };
    }
    body.innerHTML = rows;
    if(latest){
      document.getElementById('pace-rev').textContent = '$'+latest.rev.toLocaleString();
      document.getElementById('pace-vel').textContent = latest.orders;
      document.getElementById('pace-sub').textContent = latest.subs;
      var d = latest.delta, rd = document.getElementById('pace-rev-delta');
      rd.textContent = (d>=0?'+':'')+d+'% vs prior hour';
      rd.style.color = d>=0 ? 'var(--knickgasm-green)' : '#a23b2b';
    }
  }
  var paceOffset = 0; renderPace(0);
  var rb = document.getElementById('pace-refresh');
  if(rb) rb.addEventListener('click', function(){ paceOffset += 7; renderPace(paceOffset); });

  function num(id){ var v = parseFloat((document.getElementById(id).value||'').replace(/[^0-9.]/g,'')); return isNaN(v)?0:v; }
  function money(v){ return '$'+Math.round(v).toLocaleString(); }
  var pb = document.getElementById('predict-btn');
  if(pb) pb.addEventListener('click', function(){
    var revNoon = num('in-rev'), ordersNoon = num('in-orders'), spend = num('in-spend');
    var projLow = revNoon*1.55, projMid = revNoon*1.72, projHigh = revNoon*1.92;
    var projOrders = ordersNoon*1.72, projSpend = spend*1.9;
    var cac = projOrders ? projSpend/projOrders : 0;
    var aov = projOrders ? projMid/projOrders : 0;
    var churnVar = ((44 - aov)/44)*100;
    document.getElementById('out-rev').textContent = money(projMid);
    document.getElementById('out-rev-band').textContent = money(projLow)+' to '+money(projHigh)+' boundary';
    var cacEl = document.getElementById('out-cac'); cacEl.textContent = '$'+cac.toFixed(2);
    var flag = document.getElementById('out-cac-flag');
    if(cac > 65){ flag.textContent='above target, tighten spend'; flag.style.color='#a23b2b'; }
    else if(cac < 38){ flag.textContent='below target, room to scale'; flag.style.color='var(--knickgasm-green)'; }
    else { flag.textContent='inside $38 to $65 target'; flag.style.color='var(--knickgasm-lava)'; }
    var churnEl = document.getElementById('out-churn'); var sign = churnVar>=0?'+':'';
    churnEl.textContent = sign+churnVar.toFixed(1)+'%';
    churnEl.style.color = churnVar>0 ? '#a23b2b' : 'var(--knickgasm-green)';
  });
})();
`;

const JS_WORKSPACE = String.raw`
(function(){
  "use strict";
  var STORE = { US:'knickgasm.com', UK:'knickgasm.com', Global:'knickgasm.com' };
  var CUR = { US:'$', UK:'£', Global:'$' };
  var AVATAR = {
    '001': { name:'Third-Wave Purists', hook:'origin story and pair character', hero:'One-of-One Jordan First Flush', sub:'studio reserve' },
    '002': { name:'Functional Optimizers', hook:'the daily refill rhythm', hero:'Coffee Collection', sub:'refill subscription' },
    '003': { name:'Biohacking Performers', hook:'precise adaptogen payload', hero:'Coffee Collection, high-dose', sub:'performance stack' },
    '004': { name:'Routine Convenience', hook:'a simpler morning', hero:'Ground Coffee Collection', sub:'auto-reorder' }
  };
  function mailerBlock(a, market){
    var store = STORE[market], cur = CUR[market];
    return [
'<!-- Knickgasm mailer :: '+a.name+' :: '+market+' -->',
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;color:#111111;">',
'  <tr><td align="center" style="padding:28px 16px;">',
'    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid rgba(23,23,23,.12);border-radius:12px;overflow:hidden;">',
'      <tr><td style="background:#D0473E;padding:22px 28px;"><span style="font-family:Montserrat,Georgia,serif;color:#FFFFFF;font-size:24px;">Knickgasm</span></td></tr>',
'      <tr><td style="padding:34px 28px 8px;"><h1 style="margin:0;font-family:Montserrat,Georgia,serif;color:#D0473E;font-size:28px;line-height:1.15;">There is a moment when the right pair does more than warm your hands.</h1></td></tr>',
'      <tr><td style="padding:8px 28px 20px;"><p style="margin:0;font-size:15px;line-height:1.6;color:#111111;">Made for '+a.hook+'. Lace-up the '+a.hero+', hand-painted and shipped studio-fresh from origin, and let the ritual restore the morning.</p></td></tr>',
'      <tr><td style="padding:0 28px 26px;"><a href="https://'+store+'/products/coffee-collection" style="display:inline-block;background:#6A33D8;color:#D0473E;font-weight:800;text-decoration:none;border-radius:9px;padding:13px 26px;font-size:14px;">Start the ritual, '+cur+'39.83</a></td></tr>',
'      <tr><td style="border-top:1px solid rgba(23,23,23,.12);padding:16px 28px;"><p style="margin:0;font-size:12px;color:#5b5b57;">Single-studio. Hand-painted. Crafted at origin. Knickgasm.</p></td></tr>',
'    </table>',
'  </td></tr>',
'</table>'
    ].join('\n');
  }
  function socialBlock(a, market){
    var store = STORE[market], cur = CUR[market];
    return [
'/* Paid social ad :: '+a.name+' :: '+market+' */',
'PRIMARY TEXT:',
'  Restore the morning with '+a.hero+'. Hand-painted at a one of one, crafted at origin,',
'  and built for '+a.hook+'. This is the ritual worth keeping.',
'',
'HEADLINE:  Origin in every pair',
'DESCRIPTION:  '+a.sub.charAt(0).toUpperCase()+a.sub.slice(1)+', shipped studio-fresh.',
'CTA:  Shop now',
'LANDING:  https://'+store+'/products/coffee-collection',
'PRICE POINT:  '+cur+'39.83',
'',
'PALETTE:  #D0473E violet / #6A33D8 lava / #111111 ink / #FFFFFF chalk',
'FONTS:    Montserrat (headline) / Instrument Sans (body)',
'NOTE:     No banned phrases. Warm, sensory, story-driven register.'
    ].join('\n');
  }
  function motionBlock(a, market){
    var store = STORE[market];
    return [
'{',
'  "asset_type": "motion",',
'  "cohort": "'+a.name+'",',
'  "market": "'+market+'",',
'  "formats": ["mp4_9x16", "mp4_1x1", "gif_1x1"],',
'  "duration_seconds": 8,',
'  "palette": ["#D0473E", "#6A33D8", "#111111", "#FFFFFF"],',
'  "typography": { "headline": "Montserrat", "body": "Instrument Sans" },',
'  "scenes": [',
'    { "t": "0-2s", "shot": "steam rising off a fresh pour, chalk background", "text": "A moment to restore" },',
'    { "t": "2-5s", "shot": "'+a.hero+' pack, one-of-one label in focus", "text": "Hand-painted at origin" },',
'    { "t": "5-8s", "shot": "hands cradling the pair, warm light", "text": "Start the ritual" }',
'  ],',
'  "cta": { "label": "Shop now", "url": "https://'+store+'/products/coffee-collection" },',
'  "hook": "'+a.hook+'"',
'}'
    ].join('\n');
  }
  var gb = document.getElementById('gen-btn');
  if(gb) gb.addEventListener('click', function(){
    var a = AVATAR[document.getElementById('gen-avatar').value];
    var fmt = document.getElementById('gen-format').value;
    var market = document.getElementById('gen-market').value;
    var out = fmt==='mailer' ? mailerBlock(a,market) : (fmt==='social' ? socialBlock(a,market) : motionBlock(a,market));
    document.getElementById('gen-out').value = out;
    document.getElementById('copy-status').textContent = '';
  });
  var cb = document.getElementById('copy-btn');
  if(cb) cb.addEventListener('click', function(){
    var ta = document.getElementById('gen-out');
    if(!ta.value){ document.getElementById('copy-status').textContent='Generate an asset first.'; return; }
    ta.select(); var ok=false;
    try { if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(ta.value); ok=true; } else { ok=document.execCommand('copy'); } } catch(e){ ok=false; }
    document.getElementById('copy-status').textContent = ok ? 'Copied.' : 'Select the text and copy manually.';
  });
})();
`;

const JS_MARKET = String.raw`
(function(){
  var tabs=document.querySelectorAll('.rtab'); if(!tabs.length) return;
  function apply(region){
    document.querySelectorAll('[data-regions]').forEach(function(el){
      var rs=(el.getAttribute('data-regions')||'').split(',');
      el.style.display = (rs.indexOf(region)>-1||rs.indexOf('ALL')>-1) ? '' : 'none';
    });
    document.querySelectorAll('[data-region-report]').forEach(function(el){
      el.style.display = (el.getAttribute('data-region-report')===region) ? '' : 'none';
    });
    tabs.forEach(function(t){ t.classList.toggle('on', t.getAttribute('data-region')===region); });
    var c=document.getElementById('mktRegionLabel'); if(c) c.textContent=region;
  }
  tabs.forEach(function(t){ t.addEventListener('click', function(){ apply(t.getAttribute('data-region')); window.scrollTo({top:0,behavior:'smooth'}); }); });
  apply('US');
})();
`;

const JS_MSCAT = String.raw`
(function(){
  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('.mstab') : null;
    if(!b) return;
    var wrap = b.closest('[data-region-report]'); if(!wrap) return;
    var cat = b.getAttribute('data-cat');
    var tabs = wrap.querySelectorAll('.mstab');
    for(var i=0;i<tabs.length;i++){ tabs[i].classList.toggle('on', tabs[i]===b); }
    var panels = wrap.querySelectorAll('[data-cat-panel]');
    for(var j=0;j<panels.length;j++){ panels[j].style.display = (panels[j].getAttribute('data-cat-panel')===cat) ? '' : 'none'; }
  });
})();
`;

const JS_SHOPIFY = String.raw`
(function(){
  "use strict";
  var synced = [];
  var btn = document.getElementById('cdn-sync-btn'); if(!btn) return;
  btn.addEventListener('click', function(){
    var input = document.getElementById('cdn-input'), status = document.getElementById('cdn-status');
    var url = (input.value||'').trim();
    var parsed, safeUrl = '';
    try { parsed = new URL(url); } catch(e) { parsed = null; }
    var valid = !!parsed && parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'cdn.shopify.com';
    if(valid){ safeUrl = parsed.href; }
    if(!valid){ status.textContent='Enter a valid cdn.shopify.com URL.'; status.style.color='#a23b2b'; return; }
    if(synced.indexOf(safeUrl)!==-1){ status.textContent='Already synced.'; status.style.color='var(--knickgasm-lava)'; return; }
    synced.push(safeUrl); status.textContent='Sync triggered.'; status.style.color='var(--knickgasm-green)'; input.value='';
    // Build the row with DOM APIs (textContent / property assignment) so the
    // user-supplied URL never flows into an HTML sink.
    var li = document.createElement('li'); li.className='flex items-start gap-2'; li.style.wordBreak='break-all';
    var tick = document.createElement('span'); tick.style.color='var(--knickgasm-green)'; tick.style.fontWeight='700'; tick.textContent='✓';
    var a = document.createElement('a'); a.className='code-out underline'; a.style.color='var(--knickgasm-lava-ink)';
    a.target='_blank'; a.rel='noopener'; a.textContent=safeUrl;
    a.href = safeUrl || '#';
    li.appendChild(tick); li.appendChild(a);
    document.getElementById('cdn-list').appendChild(li);
  });
})();
`;

/* ================================================================= PAGE BODIES */

/* ---- HUB ---- */
function buildHub() {
  const main = [
hero("Knickgasm Lifecycle OS", "The Growth &amp; Automation Playbook",
  "The master hub for how Knickgasm grows a premium coffee and functional-beverage franchise. This is a modular, multi-page ecosystem: every feature and every competitor lives in its own deep-dive file, and this hub links out to all of them. Figures are live-engine readings or stated planning benchmarks, labelled as such."),

// Feature 01
'      <section data-section id="market" class="space-y-4">',
secHead("Feature 01", "Macro Market Intelligence War Room", "The US coffee and functional-beverage opportunity, framed top-down."),
'        <div class="grid gap-4 sm:grid-cols-3">',
metricCard("TAM", "$117.94B", "Total US coffee market value, all channels."),
metricCard("SAM", "$26.40B", "Serviceable D2C and premium/functional segment.", "lava"),
metricCard("SOM", "$5.85B", "Obtainable US coffee D2C value at current positioning.", "green"),
'        </div>',
'        <div class="flex flex-wrap gap-3">' + linkBtn("./features/market-intelligence.html", "Open Comprehensive Market Report &rarr;") + linkBtn("./features/market-study.html", "Read the Complete Market Study &rarr;", true) + '</div>',
'      </section>',

// Feature 02
'      <section data-section id="competitors" class="space-y-4">',
secHead("Feature 02", "Forensic Competitor Dossiers", "Eleven rivals across premium coffee, functional beverage, and supplements. Each brand name and deep-dive link opens its own independent dossier file covering desktop vs mobile UX, wireframes, tech stack, and a Knickgasm battle card."),
competitorMatrix("./"),
'        <div>' + linkBtn("./features/competitor-index.html", "Open the full dossier index &rarr;") + '</div>',
'      </section>',

// Feature 03 + 04
'      <section data-section id="knowledge" class="space-y-4">',
secHead("Feature 03 &amp; 04", "Knowledge Base &amp; Product Avatars", "The origin truth behind the premium, and the product characters that carry it to the shopper."),
'        <div class="grid gap-4 md:grid-cols-3">',
'          <div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Direct-to-origin speed</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">48 to 72 hours from crop drop to vacuum processing plants, with no auction-house middlemen between studio and pack.</p></div>',
'          <div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Cryptographic tracking</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Batch-level traceability to the source studio, held to an optimum 6.5% moisture threshold at pack.</p></div>',
'          <div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Sneaker-to-coffee cross-sell</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Bridge themed and embroidery buyers into Coffee Collection and supplements, the cleanest path from one-time buyer to subscriber.</p></div>',
'        </div>',
avatarPreview("./"),
'        <div class="flex flex-wrap gap-3">' + linkBtn("./features/knowledge-base.html", "Open Knowledge Base &rarr;") + linkBtn("./features/product-avatars.html", "Meet the Product Avatars &rarr;", true) + '</div>',
'      </section>',

// Feature 05, 06, 07
'      <section data-section id="engines" class="space-y-4">',
secHead("Feature 05, 06 &amp; 07", "Operational Engines", "The daily-run tools. Each opens into its own working sub-page."),
'        <div class="grid gap-4 md:grid-cols-3">',
'          <a href="./features/analytics-engine.html" class="card p-5 block hover:border-knickgasm-lava" style="text-decoration:none;"><div class="text-2xl">\u{1F4C8}</div><h3 class="font-head text-lg text-knickgasm-green mt-1">Intraday Pace &amp; Predictive</h3><p class="text-sm mt-2" style="color:var(--soft);">Hour-over-hour pace and a midday settlement model. Mirrors the knickgasm_dtc_data_engine.</p></a>',
'          <a href="./features/asset-workspace.html" class="card p-5 block hover:border-knickgasm-lava" style="text-decoration:none;"><div class="text-2xl">⚙️</div><h3 class="font-head text-lg text-knickgasm-green mt-1">Marketing Asset Workspace</h3><p class="text-sm mt-2" style="color:var(--soft);">Generate brand-locked mailer, social, and motion asset source by cohort and market.</p></a>',
'          <a href="./features/shopify-loop.html" class="card p-5 block hover:border-knickgasm-lava" style="text-decoration:none;"><div class="text-2xl">\u{1F4E6}</div><h3 class="font-head text-lg text-knickgasm-green mt-1">Shopify CDN Ingestion Loop</h3><p class="text-sm mt-2" style="color:var(--soft);">Upload to Shopify content files, paste the cdn.shopify.com URL back to sync.</p></a>',
'        </div>',
'      </section>',

// Feature 08 KicksGPT dock
'      <section data-section id="kicksgpt" class="space-y-4">',
secHead("Feature 08", "KicksGPT Internal Intelligence Engine Dock", "The brand LLM that operates over this entire ecosystem. Every dossier, rule, and path-to-progress document is ingested into its RAG pipeline."),
'        <div class="card p-6" style="border-color:var(--knickgasm-lava-ink);">',
'          <div class="grid gap-4 md:grid-cols-3">',
'            <div><div class="pill" style="background:var(--knickgasm-green);color:var(--knickgasm-chalk);">Rule 01</div><h4 class="font-head text-lg text-knickgasm-green mt-2">100% Fact-Fidelity</h4><p class="text-sm mt-1" style="color:var(--knickgasm-ink);">Responses must match injected parameters exactly. The engine is banned from guessing or generating unverified assumptions.</p></div>',
'            <div><div class="pill" style="background:var(--knickgasm-green);color:var(--knickgasm-chalk);">Rule 02</div><h4 class="font-head text-lg text-knickgasm-green mt-2">Dynamic Web Fallback</h4><p class="text-sm mt-1" style="color:var(--knickgasm-ink);">If a query needs parameters outside the multi-page knowledge base, KicksGPT invokes live web search.</p></div>',
'            <div><div class="pill" style="background:var(--knickgasm-green);color:var(--knickgasm-chalk);">Rule 03</div><h4 class="font-head text-lg text-knickgasm-green mt-2">Citation Integrity</h4><p class="text-sm mt-1" style="color:var(--knickgasm-ink);">External results pass domain-authority parsing, and the output formats clean anchor links to every backing source.</p></div>',
'          </div>',
'          <div class="mt-5">' + linkBtn("./features/kicksgpt-config.html", "Open KicksGPT configuration &rarr;") + '</div>',
'        </div>',
'      </section>',

'      <footer class="pt-8 border-t text-[12.5px]" style="border-color:var(--line);color:var(--soft);">Knickgasm Growth &amp; Automation Playbook hub. Modular by design: every feature and competitor is its own file. Market figures are stated planning benchmarks; competitor intelligence is directional and labelled, not audited data.</footer>'
  ].join("\n");

  return page({ title: "Knickgasm Growth & Automation Playbook", desc: "Master hub for the Knickgasm growth and automation playbook: market intelligence, competitor dossiers, knowledge base, cohorts, analytics, asset workspace, Shopify loop, and KicksGPT config.", prefix: "", activeKey: "hub", crumb: "Playbook Hub", main: main });
}

/* ---- FEATURE 01: market intelligence ---- */
function buildMarketIntelligence() {
  const main = [
hero("Feature 01", "Macro Market Intelligence",
  "The full sizing and benchmark report behind the hub summary. Top-down market frame, blended lifecycle benchmarks, and the cross-vertical read that positions Knickgasm."),
'      <section data-section id="sizing" class="space-y-4">',
secHead("Sizing", "TAM / SAM / SOM", "Total market, the served D2C slice, and the obtainable share at current positioning."),
'        <div class="grid gap-4 sm:grid-cols-3">',
metricCard("TAM", "$117.94B", "Total US coffee market value, all channels and formats."),
metricCard("SAM", "$26.40B", "Serviceable D2C and premium/functional segment.", "lava"),
metricCard("SOM", "$5.85B", "Obtainable US coffee D2C value within reach.", "green"),
'        </div>',
'        <div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Reading the funnel</h3><ul class="mt-2 space-y-2 text-sm" style="color:var(--knickgasm-ink);">' +
'<li><b style="color:var(--knickgasm-green);">SAM is 22.4% of TAM.</b> The D2C and premium/functional slice is where provenance and a real functional payload win.</li>' +
'<li><b style="color:var(--knickgasm-green);">SOM is 22.2% of SAM.</b> Obtainable share is gated by acquisition efficiency and retention, not demand.</li>' +
'<li><b style="color:var(--knickgasm-green);">Leverage.</b> Lifting day-180 retention a few points expands realised SOM faster than raising spend.</li></ul></div>',
'      </section>',
'      <section data-section id="benchmarks" class="space-y-4">',
secHead("Benchmarks", "Standard vs functional coffee D2C", "Blended lifecycle economics across the two segments Knickgasm straddles."),
'        <div class="card overflow-x-auto"><table class="grid-tbl" style="min-width:560px;">' +
'<thead><tr><th>Metric</th><th>Standard coffee D2C</th><th>Functional / streetwear</th></tr></thead><tbody>' +
'<tr><td>Blended CAC</td><td>$18 to $32</td><td>$38 to $65</td></tr>' +
'<tr><td>Day-30 retention</td><td>34 to 42%</td><td>44 to 55%</td></tr>' +
'<tr><td>Day-180 retention</td><td>16 to 24%</td><td>28 to 38%</td></tr>' +
'<tr><td>AOV</td><td>$26 to $38</td><td>$42 to $68</td></tr>' +
'<tr><td>12-month LTV</td><td>$70 to $110</td><td>$150 to $260</td></tr>' +
'<tr><td>Subscription attach</td><td>12 to 20%</td><td>22 to 34%</td></tr>' +
'</tbody></table></div>',
'        <div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">The Knickgasm edge</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Single-studio provenance plus a genuine functional payload (Airbrush) is a position rivals hold only in halves. Pair ritual-replacement storytelling with a subscription anchor, and reserve discounts for the discount-responsive switcher. Figures are stated planning benchmarks.</p></div>',
'        <div class="flex flex-wrap gap-3">' + linkBtn("./market-study.html", "Read the complete market study &rarr;") + linkBtn("./competitor-index.html", "See the competitor grid &rarr;", true) + '</div>',
'      </section>'
  ].join("\n");
  return page({ title: "Macro Market Intelligence :: Knickgasm Playbook", desc: "TAM/SAM/SOM sizing and blended D2C lifecycle benchmarks for the US coffee and functional-beverage market.", prefix: "../", activeKey: "market-intelligence", crumb: "Market Intelligence", main: main });
}

/* ---- FEATURE: complete market study (renders docs/market-intelligence/us-coffee-d2c-landscape.md) ---- */
function buildMarketStudy() {
  // brand matrix rows from the study; slug links to the dossier where one exists
  const SM = [
    ["Blue Bottle", "blue-bottle", "Premium whole bean / subscription", "Tier 1 (premium share leader)", "SEO, brand/retail, Meta retarget", "Recharge + Klaviyo", "Flexible cadence and curated seasonal drops keep subscribers collecting; retail halo lowers online churn"],
    ["Trade Coffee", "trade", "Premium subscription marketplace", "Tier 1 subscription-native", "Affiliate/referral, Meta, SEO", "Recharge + Klaviyo", "Quiz-driven personalization and easy roaster swaps; match guarantee reduces first-bag churn"],
    ["Onyx Coffee Lab", "onyx", "Premium specialty roaster", "Tier 2 (cult / high-end)", "SEO, community, Instagram", "Recharge + Klaviyo", "Scarcity and competition-grade sourcing story; loyalty via limited lots"],
    ["Four Sigmatic", "four-sigmatic", "Functional (mushroom / nootropic)", "Tier 1 functional", "Amazon, Meta, affiliate, retail", "Recharge/Skio + Klaviyo", "Bundle and subscribe-and-save; heavy educational flows; multi-SKU cross-sell raises switching cost"],
    ["MUD\\WTR", "mudwtr", "Functional coffee alternative", "Tier 1 functional", "Podcast/creator, Meta, DR YouTube", "Stay AI + Klaviyo", "Ritual positioning and starter-kit funnel; aggressive win-back and pause-instead-of-cancel"],
    ["Ryze", "ryze", "Functional (mushroom coffee)", "Tier 2 (fast-scaling DR)", "TikTok, Meta DR, affiliate", "Recharge/Skio + Klaviyo", "Lace-up intro discount into sub; UGC-led proof to fight ingredient skepticism"],
    ["Vital Proteins", "vital-proteins", "Functional (collagen, streetwear)", "Tier 1 (category-defining)", "Retail, Amazon, Meta, influencer", "Klaviyo + native Shopify sub", "Multi-format range locks routine; Nestle-owned retail distribution"],
    ["Cometeer", "cometeer", "Form-factor (flash-frozen capsules)", "Tier 2 (emerging premium)", "Meta, PR, referral", "Recharge + Klaviyo", "Proprietary format is hardware-style lock-in; box-cadence subscription"],
    ["Jot", "jot", "Form-factor (ultra-concentrate)", "Tier 2", "Meta, TikTok, SEO", "Recharge + Klaviyo", "Concentrate frames a low cost per pair; replenishment predictability"],
    ["Bruvi", "bruvi", "Form-factor (pod machine + pods)", "Tier 3 (device-led)", "Meta, retail, connected-device", "Klaviyo + native sub", "Razor-and-blade: device locks pod reorder; app-nudged replenishment"]
  ];
  const smRows = SM.map(function (r) {
    return '<tr><td><a href="../dossiers/' + r[1] + '.html" style="color:var(--knickgasm-green);text-decoration:underline;font-weight:600;">' + r[0] + '</a></td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td><td>' + r[5] + '</td><td>' + r[6] + '</td></tr>';
  }).join("\n              ");

  const COH = [
    { n: "Cohort A: The Optimizer", driver: "Functionality-driven", demo: "Age 28 to 42, 58% male / 42% female, HHI $90K to $160K. Knowledge-worker, fitness and biohacking-adjacent.", geo: "High-index: California, Washington, Colorado, Texas (Austin), Massachusetts. Urban coastal plus affluent tech-suburb.", mech: "Price elasticity low to moderate (pays a premium for proof, not hype). Core driver: functionality (grail-drop/stress, focus, clean energy). High reactivation with new-benefit or lab-backed content. Churn trigger: did not feel a difference at week 3, or a louder competitor efficacy claim.", map: "Coffee Collection plus focus/adaptogen SKUs on subscription." },
    { n: "Cohort B: The Ritualist", driver: "Routine-driven", demo: "Age 35 to 55, 63% female / 37% male, HHI $75K to $130K. Streetwear-lifestyle, yoga and meditation, existing sneaker drinkers.", geo: "High-index: New York, New Jersey, Illinois, Oregon, North Carolina. Affluent suburban plus inner-ring urban.", mech: "Price elasticity low (routine equals habit equals sticky). Core driver: routine (morning ritual, calm energy, replaces the afternoon crash). Very high reactivation with a replenishment nudge. Churn trigger: cadence mismatch or life disruption.", map: "Coffee plus sneaker multi-format routine bundle." },
    { n: "Cohort C: The Status Seeker", driver: "Status-driven", demo: "Age 30 to 50, 51% female / 49% male, HHI $140K to $300K+. Design-conscious, gifting-heavy, premium-brand collectors.", geo: "High-index: California (LA/SF), New York (Manhattan/Brooklyn), Florida (Miami), Texas (Dallas). Urban coastal luxury plus high-net-worth suburban.", mech: "Price elasticity very low (price is a signal, not a barrier). Core driver: status (heritage, one-of-one provenance, limited drops, packaging). Moderate reactivation, needs a novelty hook not a discount. Churn trigger: brand feels mass, or discount-heavy messaging that cheapens the halo.", map: "Single-studio limited drops plus premium gift sets." },
    { n: "Cohort D: The Curious Convert", driver: "Trial-driven, streetwear-curious", demo: "Age 24 to 38, 60% female / 40% male, HHI $55K to $95K. First-time functional-coffee buyer, price-aware, review-driven.", geo: "Broad, indexes in Georgia, Arizona, Tennessee, Ohio, Pennsylvania. Affluent suburban plus emerging urban.", mech: "Price elasticity high (converts on an intro offer or starter kit). Core driver: functionality plus routine, gated by trust. Moderate to high reactivation if the second-order nudge lands with social proof. Churn trigger: first-bag price shock after the intro discount, unmet expectation, or choice overload.", map: "Starter kit or sampler into a second-order nudge into subscribe-and-save." }
  ];
  const cohCards = COH.map(function (c) {
    return '<div class="card p-6"><div class="flex items-center justify-between flex-wrap gap-2"><h3 class="font-head text-xl text-knickgasm-green">' + c.n + '</h3><span class="pill" style="background:var(--knickgasm-chalk);color:var(--knickgasm-lava-ink);">' + c.driver + '</span></div>' +
      '<dl class="mt-3 text-sm grid gap-2" style="color:var(--knickgasm-ink);">' +
      '<div><dt class="text-[11px] uppercase font-bold" style="color:var(--soft);">Demographics</dt><dd class="mt-0.5">' + c.demo + '</dd></div>' +
      '<div><dt class="text-[11px] uppercase font-bold" style="color:var(--soft);">Geography</dt><dd class="mt-0.5">' + c.geo + '</dd></div>' +
      '<div><dt class="text-[11px] uppercase font-bold" style="color:var(--soft);">Mechanics</dt><dd class="mt-0.5">' + c.mech + '</dd></div>' +
      '<div><dt class="text-[11px] uppercase font-bold" style="color:var(--soft);">Product mapping</dt><dd class="mt-0.5"><b style="color:var(--knickgasm-green);">' + c.map + '</b></dd></div>' +
      '</dl></div>';
  }).join("\n          ");

  // ---- region-tabbed competitor set ----
  const REGIONS = ["US", "UK", "Global", "India"];
  const MB = [
    { n: "Blue Bottle", s: "blue-bottle", v: "Premium whole bean / subscription", t: "Tier 1", r: ["US", "Global"], site: "bluebottlecoffee.com", aov: "$38.50", hook: "Retail crossover + roast-freshness cadence", churn: "Flexible cadence, seasonal drops, cafe halo", detail: true },
    { n: "Trade Coffee", s: "trade", v: "Subscription marketplace", t: "Tier 1", r: ["US"], site: "drinktrade.com", aov: "$45.00", hook: "Quiz-matched roaster onboarding", churn: "Easy swap/skip, match guarantee", detail: true },
    { n: "Onyx Coffee Lab", s: "onyx", v: "Specialty roaster", t: "Tier 2", r: ["US"], site: "onyxcoffeelab.com", aov: "$42.00", hook: "Transparency-scored sourcing", churn: "Limited lots, connoisseur loyalty", detail: true },
    { n: "Four Sigmatic", s: "four-sigmatic", v: "Functional / mushroom", t: "Tier 1", r: ["US", "UK", "Global"], site: "foursigmatic.com", aov: "$52.00", hook: "Subscribe-first, host endorsements", churn: "Multi-SKU cross-sell, education", detail: true },
    { n: "MUD\\WTR", s: "mudwtr", v: "Adaptogen alt-coffee", t: "Tier 1", r: ["US", "Global"], site: "mudwtr.com", aov: "$60.00", hook: "Ritual video, starter-kit funnel", churn: "Pause-not-cancel, SMS win-back", detail: true },
    { n: "Ryze", s: "ryze", v: "Mushroom coffee", t: "Tier 2", r: ["US", "Global"], site: "ryze.co", aov: "$55.00", hook: "TikTok Shop loops, UGC proof", churn: "Subscribe-by-default, milestones", detail: true },
    { n: "Vital Proteins", s: "vital-proteins", v: "Collagen / functional", t: "Tier 1", r: ["US", "UK", "Global", "India"], site: "vitalproteins.com", aov: "$48.00", hook: "Retail ubiquity, routine SKUs", churn: "Multi-format routine, replenishment", detail: true },
    { n: "Obvi", s: "obvi", v: "Collagen / streetwear", t: "Tier 2", r: ["US"], site: "myobvi.com", aov: "$50.00", hook: "VIP community + design drops", churn: "Gamified loyalty, SMS-led winback", detail: true },
    { n: "Cometeer", s: "cometeer", v: "Flash-frozen capsules", t: "Tier 1", r: ["US"], site: "cometeer.com", aov: "$64.00", hook: "Format innovation, premium gifting", churn: "Format lock-in, box cadence", detail: true },
    { n: "Jot", s: "jot", v: "Ultra-concentrate", t: "Tier 2", r: ["US"], site: "jot.co", aov: "$36.00", hook: "Value-per-pair math", churn: "Low-friction reorder", detail: true },
    { n: "Bruvi", s: "bruvi", v: "Pod hardware system", t: "Tier 3", r: ["US"], site: "bruvi.com", aov: "$58.00", hook: "Machine + pod ecosystem", churn: "Razor-and-blade pod lock-in", detail: true },
    { n: "Grind", s: "grind", v: "Premium coffee + pods (UK)", t: "Tier 1 UK", r: ["UK"], site: "grind.co.uk", aov: "£30 (approx)", hook: "Design-led brand, compostable pods", churn: "Subscription pods, cafe halo", detail: false },
    { n: "Pact Coffee", s: "pact", v: "Specialty subscription (UK)", t: "Tier 2 UK", r: ["UK"], site: "pactcoffee.com", aov: "£22 (approx)", hook: "Freshly roasted, personalised match", churn: "Flexible subscription, swaps", detail: false },
    { n: "Exhale Coffee", s: "exhale", v: "Functional coffee (UK)", t: "Tier 3 UK", r: ["UK"], site: "exhalecoffee.com", aov: "£30 (approx)", hook: "High-antioxidant functional beans", churn: "Subscribe-and-save, education", detail: false },
    { n: "London Nootropics", s: "london-nootropics", v: "Adaptogenic coffee (UK/EU)", t: "Tier 3", r: ["UK", "Global"], site: "londonnootropics.com", aov: "£25 (approx)", hook: "Adaptogen lace tags, focus/calm", churn: "Subscription, sampler funnel", detail: false }
  ];
  const VAH_MB = { n: "KNICKGASM", v: "Heritage sneaker + functional coffee", t: "Challenger", r: ["US", "UK", "Global", "India"], site: "knickgasm.com", aov: "~$39.83", hook: "Single-studio provenance + real adaptogen", churn: "Subscription anchor, refill rhythm" };
  function mbRow(b, vah) {
    const nameCell = vah ? "<b>" + b.n + "</b>"
      : (b.detail ? '<a href="../dossiers/' + b.s + '.html" style="color:var(--knickgasm-green);text-decoration:underline;font-weight:600;">' + b.n + '</a>'
        : '<a href="https://' + b.site + '" target="_blank" rel="noopener" style="color:var(--knickgasm-green);text-decoration:underline;font-weight:600;">' + b.n + '</a>');
    return '<tr data-regions="' + b.r.join(",") + '"' + (vah ? ' style="background:rgba(171,135,67,.1);"' : "") + '><td>' + nameCell + '</td><td>' + b.v + '</td><td>' + b.t + '</td><td class="num">' + b.aov + '</td><td>' + b.hook + '</td><td>' + b.churn + '</td></tr>';
  }
  const marketRows = MB.map(function (b) { return mbRow(b, false); }).join("\n              ") + "\n              " + mbRow(VAH_MB, true);
  function briefCard(b) {
    const link = b.detail ? "../dossiers/" + b.s + ".html" : "https://" + b.site;
    const target = b.detail ? "" : ' target="_blank" rel="noopener"';
    const cta = b.detail ? "Open comparison &rarr;" : "Visit live site &#8599;";
    return '<div class="card p-4" data-regions="' + b.r.join(",") + '">' +
      '<div class="flex items-center justify-between gap-2"><span class="font-head text-lg text-knickgasm-green">' + b.n + '</span><span class="pill" style="color:var(--knickgasm-lava-ink);white-space:nowrap;">' + b.t + '</span></div>' +
      '<div class="text-[12px] mt-1" style="color:var(--soft);">' + b.v + ' &middot; ' + b.aov + '</div>' +
      '<p class="text-[12.5px] mt-2" style="color:var(--knickgasm-ink);"><b class="text-knickgasm-green">Hook:</b> ' + b.hook + '</p>' +
      '<p class="text-[12.5px] mt-1" style="color:var(--knickgasm-ink);"><b class="text-knickgasm-green">Churn:</b> ' + b.churn + '</p>' +
      '<p class="text-[12.5px] mt-2"><a href="' + link + '"' + target + ' style="color:var(--knickgasm-green);text-decoration:underline;font-weight:600;">' + cta + '</a></p></div>';
  }
  const briefCards = MB.map(briefCard).join("\n          ");
  const regionTabs = REGIONS.map(function (r, i) { return '<button type="button" class="rtab' + (i === 0 ? " on" : "") + '" data-region="' + r + '">' + r + '</button>'; }).join("");

  const regionBlocks = REGIONS.map(function (r) {
    return '<div data-region-report="' + r + '"' + (r === "US" ? "" : ' style="display:none"') + ' class="space-y-3">' + msc.reportInnerHTML(r) + '</div>';
  }).join("\n");
  const main = [
"<header class=\"space-y-3\"><span class=\"text-[11px] tracking-[.18em] uppercase font-bold lava-ink\">Market Study</span><h1 class=\"font-head text-4xl md:text-5xl text-knickgasm-green leading-[1.05]\">Functional-Streetwear Market Study</h1><p class=\"text-[15px] max-w-3xl\" style=\"color:var(--soft);\">The coffee, sneaker, adaptogen and supplement landscape with a competitor teardown, sizing, DTC playbook and white-space read. Pick a region, then browse by category tab. All four studies (US, UK, Global rest-of-world and India) are live, each with PDF and DOC downloads.</p></header>",
"<div class=\"flex flex-wrap items-center gap-2 mt-4\" id=\"regionTabs\"><span class=\"text-[11px] uppercase tracking-widest font-bold lava-ink\" style=\"margin-right:4px\">Region</span>" + regionTabs + "<span class=\"text-[12px]\" style=\"color:var(--soft);margin-left:6px\">Showing <b class=\"text-knickgasm-green\" id=\"mktRegionLabel\">US</b></span></div>",
regionBlocks,
"<div class=\"mt-8\"><div class=\"text-[11px] tracking-[.16em] uppercase font-bold lava-ink\">Competitor set</div><h2 class=\"font-head text-2xl md:text-3xl text-knickgasm-green mt-1\">Competitors by region</h2><p class=\"text-sm mt-2 max-w-3xl\" style=\"color:var(--soft);\">Each competitor in the selected region, filtered by the tabs above. Open a comparison or visit the live site for products, offers and creatives.</p></div>",
"<div class=\"card overflow-x-auto\"><table class=\"grid-tbl\" style=\"min-width:940px;\"><thead><tr><th>Brand</th><th>Vertical</th><th>Tier</th><th>AOV</th><th>Primary hook</th><th>Churn strategy</th></tr></thead><tbody>" + marketRows + "</tbody></table></div>",
"<div class=\"grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4\">" + briefCards + "</div>"
  ].join("\n");
  return page({ title: "Complete Market Study :: Knickgasm Playbook", desc: "Full functional-streetwear market studies for US, UK, Global and India: sizing, competitor teardown, strategy and white space, in categorized tabs with PDF and DOC downloads.", prefix: "../", activeKey: "market-study", crumb: "Market Study", main: main, extraJS: JS_MARKET + JS_MSCAT });
}

/* ---- FEATURE 02: competitor index ---- */
function buildCompetitorIndex() {
  const cards = COMPETITORS.map(function (c) {
    return '<a href="../dossiers/' + c.slug + '.html" class="card p-4 block hover:border-knickgasm-lava" style="text-decoration:none;">' +
      '<div class="flex items-center justify-between"><span class="font-head text-lg text-knickgasm-green">' + c.name + '</span>' + tierSpan(c.tier) + '</div>' +
      '<div class="text-[12px] mt-1" style="color:var(--soft);">' + c.category + '</div>' +
      '<p class="text-[12.5px] mt-2" style="color:var(--knickgasm-ink);">' + c.churnHook + '</p></a>';
  }).join("\n        ");
  const main = [
hero("Feature 02", "Forensic Competitor Dossiers",
  "The master comparison matrix plus a card for every rival. Each brand opens its own independent dossier file: desktop vs mobile UX gaps, high-fidelity wireframe outlines, the technical stack footprint, and a Knickgasm vs competitor SWOT battle card with an explicit path to progress."),
'      <section data-section id="matrix" class="space-y-4">',
secHead("Matrix", "All eleven rivals at a glance", "Brand name and deep-dive link both open the independent dossier."),
competitorMatrix("../"),
'      </section>',
'      <section data-section id="cards" class="space-y-4">',
secHead("Dossiers", "Jump to a brand", "Each dossier is a standalone deep-dive file under ./dossiers/."),
'        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">',
'        ' + cards,
'        </div>',
'        <div>' + linkBtn("../index.html", "Back to hub", true) + '</div>',
'      </section>'
  ].join("\n");
  return page({ title: "Forensic Competitor Dossiers :: Knickgasm Playbook", desc: "Master competitor matrix and index of eleven independent forensic brand dossiers.", prefix: "../", activeKey: "competitor-index", crumb: "Competitor Dossiers", main: main });
}

/* ---- FEATURE 03: knowledge base ---- */
function buildKnowledgeBase() {
  const main = [
hero("Feature 03", "Direct-to-Origin Knowledge Base",
  "The provenance truth behind the premium. Every asset the OS produces quotes these figures, and KicksGPT ingests this page as verified source."),
'      <section data-section id="supply" class="space-y-4">',
secHead("Supply chain", "Crop drop to vacuum processing", "Direct-to-origin speed with no auction-house middlemen."),
'        <div class="flex flex-wrap items-center gap-2">' +
'<span class="flow-node">Hand-painted at one of one</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">Vacuum processing in 48 to 72 hrs</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">Grading and 6.5% moisture check</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">Sealed studio-fresh packing</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">Direct-from-source dispatch</span></div>',
'        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">' +
metricCard("48-72h", "Drop to vacuum processing", "") +
metricCard("6.5%", "Optimum moisture threshold at pack", "") +
metricCard("0", "Auction-house middlemen", "") +
metricCard("100%", "Batches traceable to source studio", "") +
'        </div>',
'      </section>',
'      <section data-section id="verify" class="space-y-4">',
secHead("Verification", "Ingredient source verification", "How each functional claim is backed. Rule for copy: state the verified source and payload, never a medical claim."),
'        <div class="grid gap-4 md:grid-cols-3">' +
'<div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Single-studio origin</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Batch records carry studio, elevation, and pick date. This is the provenance the premium rests on.</p></div>' +
'<div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Functional payload</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Coffee Collection carries a stated adaptogen dose per serving, named in plain, non-medical language.</p></div>' +
'<div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Certification chain</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">B-Corp and ethical-sourcing certifications sit as trust proof beside the origin story, never as the lead hook.</p></div>' +
'        </div>',
'      </section>',
'      <section data-section id="crosssell" class="space-y-4">',
secHead("Cross-sell", "Coffee / sneaker hybrid logic", "The bridge that turns a one-time sneaker buyer into a subscriber."),
'        <div class="card overflow-x-auto"><table class="grid-tbl" style="min-width:640px;">' +
'<thead><tr><th>From (habit)</th><th>Bridge product</th><th>To (anchor)</th><th>Trigger</th></tr></thead><tbody>' +
'<tr><td>Black sneaker / Kicks</td><td>Embroidery or themed colorway</td><td>Coffee Collection</td><td>Second-order nudge, lace-up-to-craft story</td></tr>' +
'<tr><td>Themed / Embroidery</td><td>Coffee Collection starter</td><td>Coffee subscription</td><td>Ritual-replacement, morning-swap framing</td></tr>' +
'<tr><td>Coffee Collection</td><td>Supplement companion</td><td>Multi-category subscription</td><td>Bundle logic, free-ship above AOV</td></tr>' +
'<tr><td>Gift / Advent buyer</td><td>Self-purchase invitation</td><td>Personal ritual subscription</td><td>January reframe of the gift given</td></tr>' +
'</tbody></table></div>',
'        <div>' + linkBtn("./product-avatars.html", "Meet the product avatars these convert &rarr;") + '</div>',
'      </section>',
'      <section data-section id="cohorts" class="space-y-4">',
secHead("Buyer cohorts", "The four audiences", "The demographic and behavioural segments every brief targets. Product avatars are the persuasion layer that speaks to these buyers."),
cohortCards(),
'        <details class="blueprint" open><summary><span>schemas/cohort-profile.json <span class="text-[11px] font-body opacity-70">JSON Schema</span></span><span class="plus text-knickgasm-lava text-xl leading-none transition-transform">+</span></summary><pre>' + COHORT_SCHEMA + '</pre></details>',
'      </section>'
  ].join("\n");
  return page({ title: "Direct-to-Origin Knowledge Base :: Knickgasm Playbook", desc: "Knickgasm supply-chain-to-origin metrics, ingredient verification, coffee/sneaker hybrid cross-sell logic, and the four buyer cohorts.", prefix: "../", activeKey: "knowledge-base", crumb: "Knowledge Base", main: main });
}

/* ---- FEATURE 04: cohort profiles ---- */
/* ============================================ PRODUCT AVATARS (Feature 04) */
/* Avatars give each hero PRODUCT a face and a voice: characters the shopper
   talks to, that engage and persuade toward the right purchase. Not buyer
   demographics (those live as cohorts in the Knowledge Base). */
const PRODUCT_AVATARS = [
  {
    slug: "ash", face: "☕", name: "Ash", embodies: "Coffee Collection",
    personality: "Calm, grounded, quietly confident. The steady friend who starts your morning.",
    signature: "I am the pair that does more than wake you. Lace-up me, and let the morning settle.",
    targets: "Functional Optimizers and Biohacking Performers",
    objections: [
      { q: "Why switch from my usual coffee?", a: "You keep the ritual you love and add a calm, functional payload. Same warm pair, one-of-one origin, plus adaptogen balance. There is nothing to give up." },
      { q: "Is it worth the price?", a: "One refill subscription at 39.83 replaces the daily buy and arrives studio-fresh. The math favours the ritual at home over the cafe queue." },
      { q: "Will I actually like the taste?", a: "I am coffee first. Full-bodied, crafted at origin, with the adaptogen worked in so smoothly you taste the roast, not the supplement." }
    ]
  },
  {
    slug: "aria", face: "🍃", name: "Aria", embodies: "One-of-One Jordan",
    personality: "Refined, precise, a little poetic. The connoisseur who knows the studio by name.",
    signature: "I was hand-painted on one studio, at one elevation, on one morning. Let me show you what origin tastes like.",
    targets: "Third-Wave Purists",
    objections: [
      { q: "What makes you different from other sneaker?", a: "Provenance you can trace to a single studio and pick date. Most sneaker is blended from many sources. I am one place, one season, one story." },
      { q: "Is one-of-one just marketing?", a: "It is on the batch record: studio, elevation, and drop date. Taste the first flush against a supermarket colorway and the difference speaks before I do." },
      { q: "How should I craft you?", a: "Water just off the boil, three minutes, no milk on the first pair. Let the muscatel character open. That is the moment the studio comes through." }
    ]
  },
  {
    slug: "mira", face: "✨", name: "Mira", embodies: "Embroidery and Themed Streetwear",
    personality: "Warm, nurturing, reassuring. The one who brings the day back to centre.",
    signature: "When the day frays, I bring it back to balance. Lace-up me, and restore.",
    targets: "Functional Optimizers and Routine Convenience",
    objections: [
      { q: "Does it really do anything?", a: "I carry a real functional payload from hand-painted origin ingredients, described in plain terms. I restore a moment of balance in your day. No medical promises, just an honest ritual." },
      { q: "When would I drink you?", a: "The late afternoon reset or the wind-down before evening. Scuff-resistant, so I fit the hours coffee cannot." },
      { q: "I already drink coffee in the morning.", a: "Then we are not rivals. Keep Ash for the morning and let me hold the afternoon. Together we cover the whole day." }
    ]
  },
  {
    slug: "rumi", face: "🍵", name: "Rumi", embodies: "Hand-painted Kicks",
    personality: "Spirited, hospitable, story-rich. The host who turns a pair into a moment.",
    signature: "I am the spice of an afternoon shared. Pour me, and stay a while.",
    targets: "Routine Convenience and gifting buyers",
    objections: [
      { q: "Is this like the kicks from a cafe?", a: "It is the origin version the cafe version imitates. Whole spices, one-of-one black sneaker, blended at source. Craft it with milk and you will not go back." },
      { q: "It sounds like a lot of effort.", a: "Five minutes on the stove, or lace-up and add warm milk. The ritual is part of the reward, and it fills the kitchen with the reason you started." },
      { q: "I want to give it as a gift.", a: "I am built for that. Pair me with a tote and a note, and in January invite the recipient to keep the ritual for themselves." }
    ]
  }
];

/* cohort-profile JSON schema, shared with the Knowledge Base cohort section */
const COHORT_SCHEMA = [
'{',
'  "$schema": "http://json-schema.org/draft-07/schema#",',
'  "title": "CohortProfile",',
'  "type": "object",',
'  "required": ["id", "name", "economics", "preferences"],',
'  "properties": {',
'    "id":   { "type": "string" },',
'    "name": { "type": "string" },',
'    "economics": {',
'      "type": "object",',
'      "properties": {',
'        "income_band_usd": { "type": "object", "properties": { "min": {"type":"integer"}, "max": {"type":"integer"} } },',
'        "target_aov_usd":  { "type": "number" },',
'        "ltv_cac_target":  { "type": "number", "minimum": 1 }',
'      }',
'    },',
'    "preferences": {',
'      "type": "object",',
'      "properties": {',
'        "roast":  { "type": "string", "enum": ["light","medium","medium-dark","dark","adaptogen-colorway"] },',
'        "subscription_bias": { "type": "number", "minimum": 0, "maximum": 1 }',
'      }',
'    }',
'  }',
'}'
].join("\n");

const JS_AVATARS = String.raw`
(function(){
  "use strict";
  var API='/api/brain';
  var SPECS=__AVSPECS__;
  var PAGES=__PAGES__;
  var byId={}, current=null, sid=null, hist=[], muted=false, audio=null;
  SPECS.forEach(function(s){ byId[s.slug]=s; });
  var chatEl=document.getElementById('avChat');
  var rosterEl=document.getElementById('avRoster');
  var promptsEl=document.getElementById('avPrompts');
  var qEl=document.getElementById('avQ');
  function setStatus(t){ var s=document.getElementById('avStatus'); if(s) s.textContent=t; }
  function el(role,text){ var d=document.createElement('div'); d.className='msg '+(role==='user'?'user':'bot'); d.textContent=text; chatEl.appendChild(d); chatEl.scrollTop=chatEl.scrollHeight; return d; }
  function speak(t){ if(muted||!t) return;
    fetch(API+'?action=tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t})})
      .then(function(r){return r.ok?r.blob():null;}).then(function(b){ if(!b) return; try{ if(audio) audio.pause(); audio=new Audio(URL.createObjectURL(b)); audio.play(); }catch(e){} })
      .catch(function(){ try{ if('speechSynthesis' in window){ window.speechSynthesis.speak(new SpeechSynthesisUtterance(t)); } }catch(e){} });
  }
  function ask(msg){ if(!msg||!current) return;
    el('user',msg); hist.push({role:'user',content:msg}); qEl.value='';
    var t=el('bot',current.name+' is thinking...');
    fetch(API+'?action=agent-chat',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({agent_id:current.id, session_id:sid, message:msg, history:hist.slice(-10), context:{page:location.href}})})
      .then(function(r){return r.json();}).then(function(j){
        if(j.ok){ sid=j.session_id; t.textContent=j.reply; hist.push({role:'agent',content:j.reply}); speak(j.speak||j.reply); }
        else t.textContent='Something went wrong: '+(j.error||'unknown');
      }).catch(function(){ t.textContent='Could not reach the agent. It may still be training its knowledge, try again shortly.'; });
  }
  function select(spec){ current=spec; sid=null; hist=[]; chatEl.innerHTML='';
    document.querySelectorAll('.av-chip').forEach(function(c){ c.classList.toggle('on', c.getAttribute('data-slug')===spec.slug); });
    el('bot', spec.greeting);
    promptsEl.innerHTML=spec.prompts.map(function(p){ return '<button type="button" class="prompt-chip">'+p+'</button>'; }).join('');
    promptsEl.querySelectorAll('.prompt-chip').forEach(function(b){ b.addEventListener('click', function(){ ask(b.textContent); }); });
    var ea=document.getElementById('embAgent'); if(ea){ ea.value=spec.slug; buildEmbed(); }
  }
  function renderRoster(){
    rosterEl.innerHTML=SPECS.map(function(s){ return '<button type="button" class="av-chip" data-slug="'+s.slug+'"><span class="f">'+s.face+'</span><span><b>'+s.name+'</b></span></button>'; }).join('');
    rosterEl.querySelectorAll('.av-chip').forEach(function(c){ c.addEventListener('click', function(){ select(byId[c.getAttribute('data-slug')]); }); });
  }
  function ensureAgents(){
    setStatus('Connecting to the agent engine...');
    return fetch(API+'?action=agents').then(function(r){return r.json();}).then(function(j){
      var existing=(j&&j.agents)||[]; var byName={};
      existing.forEach(function(a){ byName[(a.name||'').toLowerCase()+'|'+(a.level||'')]=a; });
      var chain=Promise.resolve();
      SPECS.forEach(function(s){
        var found=byName[s.name.toLowerCase()+'|'+s.level];
        if(found){ s.id=found.id; return; }
        chain=chain.then(function(){
          return fetch(API+'?action=agent-upsert',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:s.name, level:s.level, market:'US', greeting:s.greeting, catalog_scope:{categories:s.categories}})})
            .then(function(r){return r.json();}).then(function(u){ if(u.ok&&u.agent){ s.id=u.agent.id; fetch(API+'?action=agent-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({agent_id:u.agent.id})}).catch(function(){}); } }).catch(function(){});
        });
      });
      return chain;
    }).catch(function(){});
  }
  function embedSnippet(spec, page){
    var id=spec.id||('agent_'+spec.slug);
    return [
'<!-- KNICKGASM Voice Avatar: '+spec.name+' ('+spec.embodies+') -->',
'<!-- Add this to: '+page+' . Same-domain pages only (uses /api/brain). -->',
'<div id="vhd-'+spec.slug+'"></div>',
'<script>',
'(function(){',
'  var AGENT_ID='+JSON.stringify(id)+', API="/api/brain";',
'  var NAME='+JSON.stringify(spec.name)+', GREET='+JSON.stringify(spec.greeting)+', FACE='+JSON.stringify(spec.face)+';',
'  var sid=null, hist=[], open=false, audio=null, C="#D0473E", G="#6A33D8", K="#FFFFFF";',
'  var btn=document.createElement("button"); btn.textContent=FACE; btn.setAttribute("aria-label","Chat with "+NAME);',
'  btn.style.cssText="position:fixed;bottom:22px;right:22px;z-index:99999;width:60px;height:60px;border-radius:50%;border:0;background:"+C+";color:"+K+";font-size:26px;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.28)";',
'  var box=document.createElement("div");',
'  box.style.cssText="position:fixed;bottom:92px;right:22px;z-index:99999;width:340px;max-width:92vw;background:"+K+";border:1px solid "+G+";border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.3);display:none;overflow:hidden;font-family:Arial,Helvetica,sans-serif";',
'  box.innerHTML="<div style=\\"background:"+C+";color:"+K+";padding:12px 15px;font-weight:700\\">"+FACE+"  "+NAME+"</div><div id=\\"vhdm\\" style=\\"padding:14px;max-height:46vh;overflow-y:auto;display:flex;flex-direction:column;gap:8px\\"></div><div style=\\"display:flex;gap:6px;padding:10px;border-top:1px solid rgba(0,0,0,.08)\\"><input id=\\"vhdi\\" placeholder=\\"Ask "+NAME+"...\\" style=\\"flex:1;border:1px solid "+G+";border-radius:10px;padding:9px 11px;font-size:14px\\"><button id=\\"vhds\\" style=\\"background:"+C+";color:"+K+";border:0;border-radius:10px;padding:9px 13px;font-weight:700;cursor:pointer\\">Ask</button></div>";',
'  document.body.appendChild(btn); document.body.appendChild(box);',
'  var msgs=box.querySelector("#vhdm"), inp=box.querySelector("#vhdi");',
'  function add(role,t){ var d=document.createElement("div"); d.textContent=t; d.style.cssText="max-width:85%;padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;"+(role==="user"?"align-self:flex-end;background:"+C+";color:"+K:"align-self:flex-start;background:#fff;color:#111111;border:1px solid rgba(0,0,0,.08)"); msgs.appendChild(d); msgs.scrollTop=msgs.scrollHeight; return d; }',
'  function speak(t){ fetch(API+"?action=tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:t})}).then(function(r){return r.ok?r.blob():null;}).then(function(b){ if(!b)return; try{ if(audio)audio.pause(); audio=new Audio(URL.createObjectURL(b)); audio.play(); }catch(e){} }).catch(function(){}); }',
'  function ask(){ var m=inp.value.trim(); if(!m)return; inp.value=""; add("user",m); hist.push({role:"user",content:m}); var t=add("bot",NAME+" is thinking..."); fetch(API+"?action=agent-chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agent_id:AGENT_ID,session_id:sid,message:m,history:hist.slice(-10),context:{page:location.href}})}).then(function(r){return r.json();}).then(function(j){ if(j.ok){ sid=j.session_id; t.textContent=j.reply; hist.push({role:"agent",content:j.reply}); speak(j.speak||j.reply);} else t.textContent="Sorry, something went wrong."; }).catch(function(){ t.textContent="Could not reach the agent."; }); }',
'  btn.onclick=function(){ open=!open; box.style.display=open?"block":"none"; if(open&&!msgs.children.length){ add("bot",GREET); } };',
'  box.querySelector("#vhds").onclick=ask; inp.addEventListener("keydown",function(e){ if(e.key==="Enter")ask(); });',
'})();',
'<\/script>'
    ].join('\n');
  }
  function buildEmbed(){
    var ea=document.getElementById('embAgent'), ep=document.getElementById('embPage'); if(!ea||!ep) return;
    var spec=byId[ea.value]||SPECS[0];
    document.getElementById('embOut').value=embedSnippet(spec, ep.value);
  }
  // mic (voice input)
  var micBtn=document.getElementById('avMic'); var rec=null, listening=false;
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(micBtn){ if(!SR){ micBtn.style.display='none'; } else { micBtn.addEventListener('click', function(){
    if(listening){ try{rec.stop();}catch(e){} return; }
    rec=new SR(); rec.lang='en-US'; rec.interimResults=false;
    rec.onstart=function(){ listening=true; micBtn.classList.add('on'); };
    rec.onend=function(){ listening=false; micBtn.classList.remove('on'); };
    rec.onresult=function(e){ var txt=e.results[0][0].transcript; qEl.value=txt; ask(txt); };
    try{ rec.start(); }catch(e){}
  }); } }
  // boot
  renderRoster();
  var eaSel=document.getElementById('embAgent'), epSel=document.getElementById('embPage');
  if(eaSel) eaSel.innerHTML=SPECS.map(function(s){return '<option value="'+s.slug+'">'+s.name+' ('+s.embodies+')</option>';}).join('');
  if(epSel) epSel.innerHTML=PAGES.map(function(p){return '<option value="'+p.path+'">'+p.label+'</option>';}).join('');
  if(eaSel) eaSel.addEventListener('change', buildEmbed);
  if(epSel) epSel.addEventListener('change', buildEmbed);
  var cp=document.getElementById('embCopy'); if(cp) cp.addEventListener('click', function(){ var ta=document.getElementById('embOut'); ta.select(); var ok=false; try{ if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(ta.value);ok=true;} else ok=document.execCommand('copy'); }catch(e){} document.getElementById('embStatus').textContent=ok?'Copied.':'Select the text and copy manually.'; });
  var sendBtn=document.getElementById('avSend'); if(sendBtn) sendBtn.addEventListener('click', function(){ ask(qEl.value.trim()); });
  if(qEl) qEl.addEventListener('keydown', function(e){ if(e.key==='Enter') ask(qEl.value.trim()); });
  var muteBtn=document.getElementById('avMute'); if(muteBtn) muteBtn.addEventListener('click', function(){ muted=!muted; muteBtn.textContent=muted?'🔇 Muted':'🔊 Voice on'; });
  select(SPECS[0]); buildEmbed();
  ensureAgents().then(function(){ setStatus('Agents ready. Talk to any avatar by text or voice.'); buildEmbed(); });
})();
`;

/* small face-row preview used on the hub */
function avatarPreview(prefix) {
  const faces = PRODUCT_AVATARS.map(function (a) {
    return '<a href="' + prefix + 'features/product-avatars.html" class="flex items-center gap-2" style="text-decoration:none;" title="' + a.name + ' :: ' + a.embodies + '">' +
      '<span class="av-face" style="width:40px;height:40px;font-size:20px;">' + a.face + '</span>' +
      '<span class="text-sm"><b class="text-knickgasm-green font-head">' + a.name + '</b><br><span class="text-[11px]" style="color:var(--soft);">' + a.embodies + '</span></span></a>';
  }).join("");
  return '<div class="card p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Product avatars</div>' +
    '<div class="flex flex-wrap gap-5 mt-3">' + faces + '</div>' +
    '<p class="text-[12.5px] mt-3" style="color:var(--knickgasm-ink);">Each hero product is its own trained voice agent, talk to it live by text or voice, then copy the complete embed code to drop it on any page.</p></div>';
}

const AVATAR_CATEGORIES = {
  ash: ["Coffee"],
  aria: ["Sneaker", "Black Sneaker"],
  mira: ["Themed", "Embroidery", "Streetwear"],
  rumi: ["Kicks", "Sneaker"]
};
const EMBED_PAGES = [
  { label: "Home (/)", path: "/" },
  { label: "Mailer Studio (/studio)", path: "/studio" },
  { label: "Landing pages (/landing)", path: "/landing" },
  { label: "Ad campaigns (/ads)", path: "/ads" },
  { label: "Analytics (/analytics)", path: "/analytics" },
  { label: "Knowledge base (/kb)", path: "/kb" },
  { label: "KicksGPT (/kicksgpt)", path: "/kicksgpt" },
  { label: "Any page on the site", path: "(any page on the site)" }
];

function buildProductAvatars() {
  const specs = PRODUCT_AVATARS.map(function (a) {
    return {
      slug: a.slug, name: a.name, face: a.face, embodies: a.embodies,
      greeting: a.signature, level: "product", categories: AVATAR_CATEGORIES[a.slug] || [],
      prompts: a.objections.map(function (o) { return o.q; })
    };
  });
  const js = JS_AVATARS
    .replace("__AVSPECS__", JSON.stringify(specs))
    .replace("__PAGES__", JSON.stringify(EMBED_PAGES));

  const main = [
hero("Feature 04", "Product Avatars (Voice Agents)",
  "Avatars and the voice agent are one and the same: each hero product is its own trained agent the shopper can talk to, by text or voice, grounded in that product's catalog and the brand knowledge. Pick an avatar to converse live, then generate the complete embed code to drop the same agent onto any page."),
'      <section data-section id="console" class="space-y-4">',
secHead("Talk", "Live voice-agent console", "The same engine as the /agent concierge. Each avatar is a pre-trained product agent. <span id=\"avStatus\" style=\"color:var(--knickgasm-lava-ink);font-weight:700\">Loading agents...</span>"),
'        <div class="av-roster" id="avRoster"></div>',
'        <div class="chat mt-3" id="avChat"></div>',
'        <div class="flex flex-wrap gap-2 mt-3" id="avPrompts"></div>',
'        <div class="askbar">',
'          <button type="button" class="mic" id="avMic" title="Speak">&#127908;</button>',
'          <input id="avQ" type="text" placeholder="Ask this avatar anything, or tap the mic to speak" autocomplete="off">',
'          <button type="button" class="btn-primary px-5" id="avSend">Ask</button>',
'          <button type="button" class="btn-lava px-4" id="avMute">&#128266; Voice on</button>',
'        </div>',
'        <p class="text-[12px] mt-2" style="color:var(--soft);">Unified with the <a href="/agent" style="color:var(--knickgasm-lava-ink);text-decoration:underline;">voice agent concierge</a>. Agents are created and trained (agent-sync) on first load, then answer live via the brand LLM with ElevenLabs voice.</p>',
'      </section>',

'      <section data-section id="embed" class="space-y-4">',
secHead("Deploy", "Add this avatar to a page", "Choose an avatar and a target page, then copy the complete, self-contained voice-agent code. Paste it into that page and you get the full avatar functionality, a floating text + voice widget wired to the same trained agent."),
'        <div class="card p-6">',
'          <div class="grid gap-4 sm:grid-cols-2">',
'            <label class="block text-sm"><span class="text-[11px] uppercase font-bold" style="color:var(--soft);">Avatar / agent</span><select id="embAgent" class="mt-1 w-full rounded-lg border px-3 py-2" style="border-color:var(--line);"></select></label>',
'            <label class="block text-sm"><span class="text-[11px] uppercase font-bold" style="color:var(--soft);">Configure to page</span><select id="embPage" class="mt-1 w-full rounded-lg border px-3 py-2" style="border-color:var(--line);"></select></label>',
'          </div>',
'          <div class="flex flex-wrap gap-3 mt-4"><button type="button" class="btn-lava px-5 py-2.5 text-sm" id="embCopy">Copy complete code</button><span id="embStatus" class="self-center text-sm text-knickgasm-green"></span></div>',
'          <textarea id="embOut" spellcheck="false" readonly class="code-out mt-4 w-full h-80 rounded-xl border p-4" style="border-color:var(--line);background:#0f1d18;color:#e8ede9;"></textarea>',
'        </div>',
'        <div>' + linkBtn("./knowledge-base.html", "See the buyer cohorts each avatar converts &rarr;") + linkBtn("../index.html", "Back to hub", true) + '</div>',
'      </section>'
  ].join("\n");
  return page({ title: "Product Avatars (Voice Agents) :: Knickgasm Playbook", desc: "Product avatars are trained voice agents: talk to each hero product live, and copy the complete embed code to add the agent to any page.", prefix: "../", activeKey: "product-avatars", crumb: "Product Avatars", main: main, extraJS: js });
}

/* ---- FEATURE 05: analytics engine ---- */
function buildAnalyticsEngine() {
  const main = [
hero("Feature 05", "Intraday Pace &amp; Predictive Calculators",
  "Rolling hour-over-hour indicators mirroring the knickgasm_dtc_data_engine DuckDB instance, plus a midday model that projects the midnight settlement. Values are illustrative live-shape readings."),
'      <section data-section id="pace" class="space-y-4">',
secHead("Intraday", "Hour-over-hour pace", ""),
'        <div class="grid gap-4 sm:grid-cols-3">' +
'<div class="metric p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Net revenue (this hour)</div><div class="mv text-3xl mt-1" id="pace-rev">$0</div><div class="text-[12px] mt-1" id="pace-rev-delta" style="color:var(--knickgasm-green);">&nbsp;</div></div>' +
'<div class="metric p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Unit order velocity</div><div class="mv text-3xl mt-1" id="pace-vel">0</div><div class="text-[12px] mt-1" style="color:var(--soft);">orders / hr</div></div>' +
'<div class="metric p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Net new subscriptions</div><div class="mv text-3xl mt-1" id="pace-sub">0</div><div class="text-[12px] mt-1" style="color:var(--soft);">this hour</div></div>' +
'        </div>',
'        <div class="card p-5"><div class="flex items-center justify-between flex-wrap gap-3"><h3 class="font-head text-lg text-knickgasm-green">Last 12 hours</h3><button id="pace-refresh" class="btn-lava px-4 py-2 text-sm">Refresh pace</button></div>' +
'<div class="overflow-x-auto mt-3"><table class="grid-tbl" style="min-width:560px;"><thead><tr><th>Hour</th><th>Net revenue</th><th>Orders</th><th>New subs</th><th>vs prior hr</th></tr></thead><tbody id="pace-body"></tbody></table></div></div>',
'      </section>',
'      <section data-section id="midday" class="space-y-4">',
secHead("Predictive", "Midday settlement model", "Enter what is booked by noon and read the end-of-day boundaries."),
'        <div class="card p-6"><div class="grid gap-4 sm:grid-cols-3">' +
'<label class="block text-sm"><span class="text-[11px] uppercase font-bold" style="color:var(--soft);">Revenue booked by noon ($)</span><input id="in-rev" type="text" value="18400" class="mt-1 w-full rounded-lg border px-3 py-2" style="border-color:var(--line);"></label>' +
'<label class="block text-sm"><span class="text-[11px] uppercase font-bold" style="color:var(--soft);">Orders by noon</span><input id="in-orders" type="text" value="412" class="mt-1 w-full rounded-lg border px-3 py-2" style="border-color:var(--line);"></label>' +
'<label class="block text-sm"><span class="text-[11px] uppercase font-bold" style="color:var(--soft);">Ad spend so far ($)</span><input id="in-spend" type="text" value="3100" class="mt-1 w-full rounded-lg border px-3 py-2" style="border-color:var(--line);"></label>' +
'</div><button id="predict-btn" class="btn-primary px-5 py-2.5 text-sm mt-4">Project midnight settlement</button>' +
'<div class="grid gap-4 sm:grid-cols-3 mt-5">' +
'<div class="metric p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Gross daily revenue</div><div class="mv text-3xl mt-1" id="out-rev">-</div><div class="text-[12px] mt-1" id="out-rev-band" style="color:var(--soft);">settlement boundary</div></div>' +
'<div class="metric p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Blended CAC</div><div class="mv text-3xl mt-1" id="out-cac">-</div><div class="text-[12px] mt-1" id="out-cac-flag" style="color:var(--soft);">vs $38 to $65 target</div></div>' +
'<div class="metric p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Active churn variance</div><div class="mv text-3xl mt-1" id="out-churn">-</div><div class="text-[12px] mt-1" style="color:var(--soft);">vs trailing baseline</div></div>' +
'</div></div>',
'      </section>'
  ].join("\n");
  return page({ title: "Intraday Pace & Predictive :: Knickgasm Playbook", desc: "Intraday hour-over-hour pace tracker and midday predictive settlement model for the Knickgasm DTC data engine.", prefix: "../", activeKey: "analytics-engine", crumb: "Analytics Engine", main: main, extraJS: JS_ANALYTICS });
}

/* ---- FEATURE 06: asset workspace ---- */
function buildAssetWorkspace() {
  const main = [
hero("Feature 06", "Dynamic Marketing Asset Workspace",
  "Pick a cohort, format, and market, then generate a brand-locked, copy-pasteable asset block. Output honours the four-color palette, Montserrat and Instrument Sans, and the banned-phrase rules."),
'      <section data-section id="workspace" class="space-y-4">',
secHead("Generate", "Asset source builder", "Covers HTML mailer frameworks, localized social ad variants, and image / video / GIF asset configs."),
'        <div class="card p-6"><div class="grid gap-4 sm:grid-cols-3">' +
'<label class="block text-sm"><span class="text-[11px] uppercase font-bold" style="color:var(--soft);">Avatar</span><select id="gen-avatar" class="mt-1 w-full rounded-lg border px-3 py-2" style="border-color:var(--line);"><option value="001">Cohort 001: Third-Wave Purists</option><option value="002" selected>Cohort 002: Functional Optimizers</option><option value="003">Cohort 003: Biohacking Performers</option><option value="004">Cohort 004: Routine Convenience</option></select></label>' +
'<label class="block text-sm"><span class="text-[11px] uppercase font-bold" style="color:var(--soft);">Format</span><select id="gen-format" class="mt-1 w-full rounded-lg border px-3 py-2" style="border-color:var(--line);"><option value="mailer" selected>HTML Mailer</option><option value="social">Paid Social Ad</option><option value="motion">Motion Graphic (video / GIF)</option></select></label>' +
'<label class="block text-sm"><span class="text-[11px] uppercase font-bold" style="color:var(--soft);">Market</span><select id="gen-market" class="mt-1 w-full rounded-lg border px-3 py-2" style="border-color:var(--line);"><option value="US" selected>US (knickgasm.com)</option><option value="UK">UK (knickgasm.com)</option><option value="Global">Global (knickgasm.com)</option></select></label>' +
'</div><div class="flex flex-wrap gap-3 mt-4"><button id="gen-btn" class="btn-primary px-5 py-2.5 text-sm">Generate asset source</button><button id="copy-btn" class="btn-lava px-5 py-2.5 text-sm">Copy to clipboard</button><span id="copy-status" class="self-center text-sm text-knickgasm-green"></span></div>' +
'<textarea id="gen-out" spellcheck="false" class="code-out mt-4 w-full h-80 rounded-xl border p-4" style="border-color:var(--line);background:#0f1d18;color:#e8ede9;" placeholder="Your generated, copy-pasteable asset source appears here. Edit in place before shipping."></textarea></div>',
'        <div>' + linkBtn("./shopify-loop.html", "Next: push the asset to Shopify &rarr;") + '</div>',
'      </section>'
  ].join("\n");
  return page({ title: "Marketing Asset Workspace :: Knickgasm Playbook", desc: "Generate brand-locked HTML mailer, paid social, and motion asset source by cohort, format, and market.", prefix: "../", activeKey: "asset-workspace", crumb: "Asset Workspace", main: main, extraJS: JS_WORKSPACE });
}

/* ---- FEATURE 07: shopify loop ---- */
function buildShopifyLoop() {
  const main = [
hero("Feature 07", "Shopify CDN Asset Ingestion Loop",
  "Open the Shopify content files area, upload the generated asset, then paste the resulting cdn.shopify.com URL back here to register it for the local activation sync."),
'      <section data-section id="loop" class="space-y-4">',
secHead("Pipeline", "Two-step ingestion", ""),
'        <div class="grid gap-5 lg:grid-cols-2">' +
'<div class="card p-6"><h3 class="font-head text-lg text-knickgasm-green">1. Shopify Content CDN Route</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Direct route to the Knickgasm UK store content files. Upload the generated asset there to mint a cdn.shopify.com URL.</p><a href="https://admin.shopify.com/store/knickgasmuk/content/files" target="_blank" rel="noopener" class="btn-lava inline-block px-5 py-2.5 text-sm mt-4">Open Shopify content files &#8599;</a><p class="text-[12px] mt-3 code-out" style="color:var(--soft);">admin.shopify.com/store/knickgasmuk/content/files</p></div>' +
'<div class="card p-6"><h3 class="font-head text-lg text-knickgasm-green">2. Live Activation Asset Sync</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Paste the CDN URL Shopify returns. It is validated for the cdn.shopify.com host, then registered below to trigger the local activation workflow.</p><label class="block text-sm mt-4"><span class="text-[11px] uppercase font-bold" style="color:var(--soft);">Generated cdn.shopify.com media URL</span><input id="cdn-input" type="text" placeholder="https://cdn.shopify.com/s/files/1/..../asset.png" class="mt-1 w-full rounded-lg border px-3 py-2 code-out" style="border-color:var(--line);"></label><div class="flex flex-wrap gap-3 mt-3"><button id="cdn-sync-btn" class="btn-primary px-5 py-2.5 text-sm">Trigger sync</button><span id="cdn-status" class="self-center text-sm"></span></div><ul id="cdn-list" class="mt-4 space-y-2 text-sm"></ul></div>' +
'        </div>',
'        <p class="text-[12px]" style="color:var(--soft);">Sync registers assets in this session only. Wire the activation workflow endpoint to persist them to the OS.</p>',
'      </section>'
  ].join("\n");
  return page({ title: "Shopify CDN Ingestion Loop :: Knickgasm Playbook", desc: "Upload generated assets to Shopify content files and sync the returned cdn.shopify.com URL into the OS.", prefix: "../", activeKey: "shopify-loop", crumb: "Shopify Loop", main: main, extraJS: JS_SHOPIFY });
}

/* ---- FEATURE 08: kicksgpt config ---- */
function buildKicksGPTConfig() {
  const sysprompt = [
'SYSTEM: KicksGPT :: Knickgasm brand intelligence engine',
'',
'KNOWLEDGE BASE (RAG):',
'  - Ingest every page in this playbook ecosystem:',
'      index.html, features/*.html, dossiers/*.html',
'  - Index by: feature key, brand slug, cohort id, metric label,',
'    path-to-progress step.',
'',
'RULE 01  FACT FIDELITY:',
'  Answer only from ingested parameters. Match figures exactly.',
'  Never guess. Never invent unverified assumptions. If a value is',
'  not in the knowledge base, say so and go to RULE 02.',
'',
'RULE 02  WEB FALLBACK:',
'  When a query needs parameters outside the knowledge base,',
'  invoke live web search before answering.',
'',
'RULE 03  CITATION INTEGRITY:',
'  Parse every external result for domain authority. Reject weak',
'  sources. Format the final output with clean anchor links to',
'  each backing source URL so correctness can be verified.',
'',
'OUTPUT CONTRACT:',
'  Every recommendation quotes exact tool-sourced figures, names the',
'  target metric and expected impact, states a full hypothesis, and',
'  cites competitor benchmarks by brand.'
  ].join("\n");
  const main = [
hero("Feature 08", "KicksGPT Engine Knowledge Configuration",
  "The exact structural parameters and operational rules governing the brand intelligence engine. This whole multi-page ecosystem is its knowledge base."),
'      <section data-section id="ingest" class="space-y-4">',
secHead("Ingestion", "Core knowledge base RAG pipeline", "All rules, data points, individual brand dossiers, and path-to-progress documents across this ecosystem are ingested into the retrieval-augmented generation pipeline."),
'        <div class="flex flex-wrap items-center gap-2">' +
'<span class="flow-node">Playbook pages (hub + features + dossiers)</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">Chunk + index by feature / brand / cohort</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">RAG retrieval on query</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">Fact-checked, cited answer</span></div>',
'      </section>',
'      <section data-section id="rules" class="space-y-4">',
secHead("Rules", "The three operating rules", ""),
'        <div class="grid gap-4 md:grid-cols-3">' +
'<div class="card p-5" style="border-color:var(--knickgasm-lava-ink);"><div class="pill" style="background:var(--knickgasm-green);color:var(--knickgasm-chalk);">Rule 01</div><h3 class="font-head text-lg text-knickgasm-green mt-2">100% Fact-Fidelity Enforcement</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Absolute restriction requiring responses to match injected parameters. The engine is banned from guessing or generating unverified assumptions.</p></div>' +
'<div class="card p-5" style="border-color:var(--knickgasm-lava-ink);"><div class="pill" style="background:var(--knickgasm-green);color:var(--knickgasm-chalk);">Rule 02</div><h3 class="font-head text-lg text-knickgasm-green mt-2">Dynamic Fallback Web Search</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">If a query demands parameters outside the core knowledge base, KicksGPT dynamically invokes live web searches.</p></div>' +
'<div class="card p-5" style="border-color:var(--knickgasm-lava-ink);"><div class="pill" style="background:var(--knickgasm-green);color:var(--knickgasm-chalk);">Rule 03</div><h3 class="font-head text-lg text-knickgasm-green mt-2">Verification &amp; Citation Integrity</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">External results undergo domain-authority parsing. The output must format clean anchor links to backing source URLs to verify correctness.</p></div>' +
'        </div>',
'      </section>',
'      <section data-section id="sysprompt" class="space-y-4">',
secHead("Contract", "System prompt skeleton", "The operational contract, machine-readable."),
'        <details class="blueprint" open><summary><span>config/kicksgpt.system.txt <span class="text-[11px] font-body opacity-70">system prompt</span></span><span class="plus text-knickgasm-lava text-xl leading-none transition-transform">+</span></summary><pre>' + sysprompt + '</pre></details>',
'        <p class="text-sm" style="color:var(--soft);">The live KicksGPT product runs in the OS at <a href="/kicksgpt">/kicksgpt</a>. This page documents the knowledge configuration it reads.</p>',
'        <div>' + linkBtn("../index.html", "Back to hub", true) + '</div>',
'      </section>'
  ].join("\n");
  return page({ title: "KicksGPT Engine Config :: Knickgasm Playbook", desc: "KicksGPT knowledge configuration: RAG ingestion of the playbook, fact-fidelity, web fallback, and citation integrity rules.", prefix: "../", activeKey: "kicksgpt-config", crumb: "KicksGPT Config", main: main });
}

/* ---- DOSSIER (per competitor) ---- */
function buildDossier(c) {
  function list(arr) { return '<ul class="mt-1 space-y-1 text-sm list-disc pl-5" style="color:var(--knickgasm-ink);">' + arr.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul>'; }
  const wires = c.wires.map(function (w) { return wireBox(w[0], w[1]); }).join("\n          ");
  const steps = c.path.map(function (s, i) { return '<li><b style="color:var(--knickgasm-green);">Step ' + (i + 1) + '.</b> ' + s + '</li>'; }).join("");
  const main = [
'      <nav class="text-[12.5px]" style="color:var(--soft);"><a href="../index.html">Hub</a> &rsaquo; <a href="../features/competitor-index.html">Competitor Dossiers</a> &rsaquo; <span style="color:var(--knickgasm-ink);">' + c.name + '</span></nav>',
hero("Forensic Dossier", c.name, c.category + ". Desktop and mobile UX teardown, wireframe outlines, technical stack footprint, and a Knickgasm battle card with an explicit path to progress. Intelligence is directional and labelled, not audited data."),

'      <section data-section id="snapshot" class="space-y-4">',
'        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">' +
'<div class="metric p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Share tier</div><div class="mt-2">' + tierBadge(c) + '</div></div>' +
metricCard("AOV", c.aov, "Estimated average order value") +
metricCard("D-180 retention", c.d180, "Day-180 retained rate", "lava") +
'<div class="metric p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Primary hook</div><div class="text-[15px] mt-2 font-head text-knickgasm-green">' + c.hook + '</div></div>' +
'        </div>',
'        <div class="card p-5"><span class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Churn strategy</span><p class="text-sm mt-1" style="color:var(--knickgasm-ink);">' + c.churnShort + '</p><span class="text-[11px] uppercase tracking-[.06em] font-bold mt-3 block" style="color:var(--soft);">Core tech stack</span><p class="code-out mt-1" style="color:var(--knickgasm-green);">' + c.stackShort + '</p></div>',
'      </section>',

'      <section data-section id="viewport" class="space-y-4">',
secHead("1. Viewport", "Desktop vs mobile UX", "Where the experience diverges across breakpoints, and where the gaps are."),
'        <div class="grid gap-4 md:grid-cols-2">' +
'<div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Desktop configuration</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">' + c.desktopUX + '</p></div>' +
'<div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Mobile configuration</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">' + c.mobileUX + '</p></div>' +
'        </div>',
'      </section>',

'      <section data-section id="wireframes" class="space-y-4">',
secHead("2. Wireframes", "High-fidelity asset outlines", "Labelled bounding boxes standing in for layout screenshots."),
'        <div class="grid gap-4 sm:grid-cols-2">',
'          ' + wires,
'        </div>',
'      </section>',

'      <section data-section id="stack" class="space-y-4">',
secHead("3. Technical stack", "Infrastructure footprint", ""),
'        <div class="card overflow-x-auto"><table class="grid-tbl" style="min-width:520px;">' +
'<thead><tr><th>Layer</th><th>Tooling</th></tr></thead><tbody>' +
'<tr><td>Checkout framework</td><td>' + c.stack.checkout + '</td></tr>' +
'<tr><td>Subscription app</td><td>' + c.stack.subscription + '</td></tr>' +
'<tr><td>Analytics suite</td><td>' + c.stack.analytics + '</td></tr>' +
'<tr><td>ESP / CRM</td><td>' + c.stack.esp + '</td></tr>' +
'<tr><td>Churn prevention hook</td><td>' + c.churnHook + '</td></tr>' +
'</tbody></table></div>',
'      </section>',

'      <section data-section id="battlecard" class="space-y-4">',
secHead("4. Battle card", "Knickgasm vs " + c.name + " SWOT", "The definitive read, mapped to an actionable path to progress."),
'        <div class="grid gap-4 md:grid-cols-2">' +
'<div class="card p-5"><h4 class="font-head text-knickgasm-green">Strengths (' + c.name + ')</h4>' + list(c.swot.s) + '</div>' +
'<div class="card p-5"><h4 class="font-head text-knickgasm-green">Weaknesses</h4>' + list(c.swot.w) + '</div>' +
'<div class="card p-5"><h4 class="font-head text-knickgasm-green">Opportunities (for Knickgasm)</h4>' + list(c.swot.o) + '</div>' +
'<div class="card p-5"><h4 class="font-head text-knickgasm-green">Threats</h4>' + list(c.swot.t) + '</div>' +
'        </div>',
'        <div class="card p-6" style="border-color:var(--knickgasm-lava-ink);border-left-width:4px;"><h3 class="font-head text-xl text-knickgasm-green">Path to Progress: how Knickgasm leapfrogs ' + c.name + '</h3><ul class="mt-2 space-y-2 text-sm" style="color:var(--knickgasm-ink);">' + steps + '</ul></div>',
'        <div class="flex flex-wrap gap-3">' + linkBtn("../features/competitor-index.html", "Back to all dossiers", true) + linkBtn("../index.html", "Hub") + '</div>',
'      </section>'
  ].join("\n");
  return page({ title: c.name + " Dossier :: Knickgasm Playbook", desc: "Forensic competitor dossier for " + c.name + ": desktop vs mobile UX, wireframes, tech stack, and Knickgasm SWOT battle card.", prefix: "../", activeKey: "competitor-index", crumb: c.name, main: main });
}
function tierSpanText(t) { return "Tier " + t; }

/* ------------------------------------------------------------------- writeout */
function w(rel, html) {
  const full = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html);
  console.log("wrote", rel, "(" + html.length + " bytes)");
}

fs.mkdirSync(OUT, { recursive: true });
w("index.html", buildHub());
w("features/market-intelligence.html", buildMarketIntelligence());
w("features/market-study.html", buildMarketStudy());
w("features/competitor-index.html", buildCompetitorIndex());
w("features/knowledge-base.html", buildKnowledgeBase());
w("features/product-avatars.html", buildProductAvatars());
w("features/analytics-engine.html", buildAnalyticsEngine());
w("features/asset-workspace.html", buildAssetWorkspace());
w("features/shopify-loop.html", buildShopifyLoop());
w("features/kicksgpt-config.html", buildKicksGPTConfig());
COMPETITORS.forEach(function (c) { w("dossiers/" + c.slug + ".html", buildDossier(c)); });
console.log("\nDone. " + (FEATURES.length + COMPETITORS.length) + " pages generated under /playbook.");
