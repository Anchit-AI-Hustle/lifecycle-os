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
  { key: "knowledge-base",      icon: "\u{1F4D8}", label: "Studio-to-Doorstep Knowledge Base", file: "features/knowledge-base.html" },
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
'  .nav-link.active{background:var(--knickgasm-lava);color:var(--brand-on-accent,var(--knickgasm-green));font-weight:700;}',
'  .card{background:var(--knickgasm-card);border:1px solid var(--line);border-radius:14px;}',
'  .metric{background:#fff;border:1px solid var(--line);border-radius:12px;}',
'  .metric .mv{font-family:"Montserrat",Georgia,serif;color:var(--brand-primary-text,var(--knickgasm-green));}',
'  table.grid-tbl{border-collapse:collapse;width:100%;font-size:13px;min-width:820px;table-layout:fixed;}',
'  table.grid-tbl th,table.grid-tbl td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere;}',
'  table.grid-tbl th{background:var(--knickgasm-green);color:var(--knickgasm-chalk);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;}',
'  table.grid-tbl tr:nth-child(even) td{background:#faf7f0;}',
'  table.grid-tbl tr:last-child td{border-bottom:0;}',
'  .tier-1{color:var(--brand-primary-text,var(--knickgasm-green));font-weight:700;} .tier-2{color:var(--knickgasm-lava-ink);font-weight:700;} .tier-3{color:var(--soft);font-weight:700;}',
'  .tierbadge{display:inline-flex;flex-direction:column;line-height:1.12;border-radius:8px;padding:4px 9px;text-align:center;}',
'  .tierbadge b{font-size:11px;font-weight:800;} .tierbadge i{font-style:normal;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;opacity:.85;}',
'  .tb1{background:rgba(0,74,43,.10);color:var(--brand-primary-text,var(--knickgasm-green));} .tb2{background:rgba(171,135,67,.18);color:#8a6a2f;} .tb3{background:rgba(23,23,23,.07);color:var(--soft);}',
'  td.num{font-variant-numeric:tabular-nums;font-weight:700;color:var(--knickgasm-ink);white-space:nowrap;}',
'  .rtab{cursor:pointer;border:1.5px solid var(--line);background:#fff;color:var(--knickgasm-ink);border-radius:999px;padding:7px 18px;font-family:inherit;font-size:13px;font-weight:700;transition:all .12s;}',
'  .rtab:hover{border-color:var(--knickgasm-lava);} .rtab.on{background:var(--knickgasm-green);color:var(--knickgasm-chalk);border-color:var(--knickgasm-green);}',
'  .mstab{cursor:pointer;border:1.5px solid var(--line);background:#fff;color:var(--knickgasm-ink);border-radius:999px;padding:5px 14px;font-family:inherit;font-size:12px;font-weight:700;transition:all .12s;}',
'  .mstab:hover{border-color:var(--knickgasm-lava);} .mstab.on{background:var(--knickgasm-lava-ink);color:#fff;border-color:var(--knickgasm-lava-ink);}',
'  .av-card{background:var(--knickgasm-card);border:1px solid var(--line);border-radius:16px;padding:22px;}',
'  .av-face{width:56px;height:56px;border-radius:999px;background:var(--knickgasm-green);display:inline-flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0;box-shadow:0 0 0 3px rgba(171,135,67,.35);}',
'  .av-quote{font-family:"Montserrat",Georgia,serif;font-style:italic;color:var(--brand-primary-text,var(--knickgasm-green));border-left:3px solid var(--knickgasm-lava);padding-left:12px;margin:12px 0;}',
'  .av-q{cursor:pointer;text-align:left;background:#faf6ec;border:1px solid var(--line);border-radius:9px;padding:8px 11px;font-size:12.5px;color:var(--knickgasm-ink);transition:background .12s,border-color .12s;font-family:inherit;}',
'  .av-q:hover{border-color:var(--knickgasm-lava-ink);} .av-q.on{background:var(--knickgasm-lava);color:var(--brand-on-accent,var(--knickgasm-green));font-weight:700;border-color:var(--knickgasm-lava-ink);}',
'  .av-bubble{display:none;margin-top:12px;background:var(--knickgasm-green);color:var(--knickgasm-chalk);border-radius:12px;border-top-left-radius:3px;padding:13px 15px;font-size:13.5px;line-height:1.55;}',
'  .av-roster{display:flex;flex-wrap:wrap;gap:10px;}',
'  .av-chip{display:flex;align-items:center;gap:8px;cursor:pointer;background:#fff;border:1.5px solid var(--line);border-radius:999px;padding:6px 14px 6px 6px;font-family:inherit;font-size:13px;color:var(--knickgasm-ink);transition:border-color .12s;}',
'  .av-chip:hover{border-color:var(--knickgasm-lava);} .av-chip.on{border-color:var(--knickgasm-green);background:var(--knickgasm-chalk);}',
'  .av-chip .f{width:32px;height:32px;border-radius:999px;background:var(--knickgasm-green);display:inline-flex;align-items:center;justify-content:center;font-size:17px;}',
'  .chat{background:#fff;border:1px solid var(--line);border-radius:16px;min-height:280px;max-height:52vh;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:10px;}',
'  .msg{max-width:82%;padding:11px 15px;border-radius:14px;font-size:14px;line-height:1.55;white-space:pre-wrap;}',
'  .msg.user{align-self:flex-end;background:var(--knickgasm-green);color:var(--knickgasm-chalk);border-bottom-right-radius:4px;}',
'  .msg.bot{align-self:flex-start;background:var(--knickgasm-chalk);color:var(--knickgasm-ink);border:1px solid var(--line);border-bottom-left-radius:4px;}',
'  .msg.bot a{color:var(--brand-primary-text,var(--knickgasm-green));font-weight:600;}',
'  .prompt-chip{cursor:pointer;background:#faf6ec;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:12.5px;color:var(--knickgasm-ink);font-family:inherit;}',
'  .prompt-chip:hover{border-color:var(--knickgasm-lava);}',
'  .askbar{display:flex;gap:8px;margin-top:12px;}',
'  .askbar input{flex:1;border:1.5px solid var(--knickgasm-lava);border-radius:12px;padding:11px 14px;font-family:inherit;font-size:14px;color:var(--knickgasm-ink);background:#fff;}',
'  .mic{min-width:46px;border:1.5px solid var(--knickgasm-lava);background:var(--brand-surface,var(--knickgasm-chalk));color:var(--brand-primary-text,var(--knickgasm-green));border-radius:12px;cursor:pointer;font-size:16px;}',
'  .mic.on{background:#c0392b;color:#fff;border-color:#c0392b;}',
'  .pill{display:inline-block;border-radius:999px;padding:2px 11px;font-size:11px;font-weight:700;border:1px solid var(--line);}',
'  .btn-primary{background:var(--knickgasm-green);color:var(--knickgasm-chalk);border-radius:10px;font-weight:700;transition:filter .12s;} .btn-primary:hover{filter:brightness(1.15);}',
'  .btn-lava{background:var(--knickgasm-lava);color:var(--brand-on-accent,var(--knickgasm-green));border-radius:10px;font-weight:800;transition:filter .12s;} .btn-lava:hover{filter:brightness(1.05);}',
'  .wire{border:2px dashed var(--knickgasm-lava);border-radius:12px;background:repeating-linear-gradient(45deg,#fff,#fff 12px,#faf6ec 12px,#faf6ec 24px);padding:16px;min-height:96px;}',
'  .wire .wl{font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:11.5px;color:var(--brand-primary-text,var(--knickgasm-green));font-weight:700;letter-spacing:.02em;}',
'  details.blueprint{background:var(--knickgasm-ink);border-radius:12px;overflow:hidden;border:1px solid var(--line);}',
'  details.blueprint>summary{list-style:none;cursor:pointer;padding:13px 18px;color:var(--knickgasm-chalk);font-family:"Montserrat",Georgia,serif;font-size:16px;background:var(--knickgasm-green);display:flex;align-items:center;justify-content:space-between;}',
'  details.blueprint>summary::-webkit-details-marker{display:none;}',
'  details.blueprint[open]>summary .plus{transform:rotate(45deg);}',
'  details.blueprint pre{margin:0;padding:18px;overflow-x:auto;color:#e8ede9;font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:12.5px;line-height:1.6;}',
'  .code-out{font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;font-size:12.5px;line-height:1.55;}',
'  .flow-node{background:#fff;border:1px solid var(--line);border-radius:9px;padding:9px 12px;font-size:12.5px;}',
'  a{color:var(--brand-primary-text,var(--knickgasm-green));} a:hover{color:var(--knickgasm-lava-ink);}',
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
'      <div class="text-[10.5px] tracking-[.18em] uppercase font-bold text-knickgasm-lava">Lifecycle OS</div>',
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
    slug: "shoe-surgeon", name: "The Shoe Surgeon", category: "Bespoke commission studio", tier: 1,
    desktopUX: "Portfolio-led site built to impress rather than to sell: full-bleed build photography, collaboration case studies and a build-class booking flow. Gap: there is no catalog and no checkout for a finished pair, so the only path is an enquiry form.",
    mobileUX: "Editorial gallery that scrolls beautifully and converts nothing directly. No price, no add-to-bag, no lead time; the mobile journey ends at a contact form.",
    stack: { checkout: "Custom, enquiry-led", subscription: "None", analytics: "GA4", esp: "Klaviyo" },
    churnHook: "Reputation and a waiting list carry repeat demand instead of any lifecycle programme.",
    wires: [
      ["[SCREENSHOT: Desktop build gallery]", "Full-bleed commission photography with material call-outs and collaboration credits, no price anywhere on the page."],
      ["[SCREENSHOT: Enquiry form]", "Commission request form asking for silhouette, budget range and timeline, replacing a product page entirely."],
      ["[SCREENSHOT: Build class booking]", "Workshop and build-class scheduling, a secondary revenue line that also functions as brand marketing."],
      ["[SCREENSHOT: Mobile gallery scroll]", "Long image scroll with no persistent action; the buy decision cannot be made on the page."]
    ],
    swot: {
      s: ["Defines the craft ceiling of the entire category", "Collaboration and press equity that cannot be bought"],
      w: ["Nothing browsable and nothing buyable today", "Capacity is structurally capped by hands and hours"],
      o: ["Finished designs at listed prices, which they will never sell", "Committed lead times against an open-ended queue"],
      t: ["Studio-scale customisers serving the same appetite faster", "Brand configurators absorbing the mainstream personalisation demand"]
    },
    path: [
      "Serve the customer who wants a one-of-one this month rather than next year.",
      "Publish a real price on a real finished design, which the commission model structurally cannot do.",
      "Keep KNICKGASM's own craft proof visible so the price gap reads as access, not as lower quality."
    ]
  },
  {
    slug: "nike-by-you", name: "Nike By You", category: "Brand configurator", tier: 1,
    desktopUX: "Full 3D configurator with panel-by-panel colour and material selection, saved builds and a share link. Best-in-class build experience, and the single largest personalisation funnel in footwear.",
    mobileUX: "Native app configurator with smooth rotation and quick colour switching. The build is delightful; the ceiling arrives the moment a customer wants an image rather than a colour.",
    stack: { checkout: "Nike.com and Nike app", subscription: "None", analytics: "First-party", esp: "Nike membership" },
    churnHook: "Membership programme, app engagement and launch calendar rather than any subscription mechanic.",
    wires: [
      ["[SCREENSHOT: Desktop 3D configurator]", "Rotatable shoe with a panel list on the left and a swatch tray on the right; every option is a colour or a material."],
      ["[SCREENSHOT: Saved build gallery]", "Member-saved builds with share links, turning personalisation into a social artefact."],
      ["[SCREENSHOT: Mobile app builder]", "Thumb-driven panel selection with a persistent price and add-to-bag bar."],
      ["[SCREENSHOT: Build summary]", "Order summary showing the made-to-order build window before checkout, the mechanic KNICKGASM should match in clarity."]
    ],
    swot: {
      s: ["The largest personalisation funnel in the world", "Official supply, brand trust and local fulfilment in every market"],
      w: ["Colour swaps only, no artwork of any kind is possible", "Every build reads as a variant, never as a one-of-one"],
      o: ["Artwork demand it creates and then refuses to serve", "Fandom subjects a brand-owned library will never carry"],
      t: ["Independent customisers absorbing the graduates", "Marketplace listings undercutting on price"]
    },
    path: [
      "Target the configurator graduate directly: they wanted a design and were offered a colour.",
      "Show artwork the configurator structurally cannot produce, on the same silhouettes.",
      "Match their base credibility with the 100% original claim, then out-design them."
    ]
  },
  {
    slug: "converse-by-you", name: "Converse By You", category: "Brand configurator", tier: 2,
    desktopUX: "Canvas-led builder with colour, print and patch libraries and a clear preview. Strong entry-level experience on a silhouette that takes print well.",
    mobileUX: "Competent mobile builder, template-bound. Every choice is drawn from a fixed library, so two customers can and do arrive at the same pair.",
    stack: { checkout: "Converse.com", subscription: "None", analytics: "First-party", esp: "Brand CRM" },
    churnHook: "Seasonal brand campaigns rather than lifecycle marketing.",
    wires: [
      ["[SCREENSHOT: Canvas builder]", "Chuck Taylor preview with colour pickers per panel and a scrollable print library beneath."],
      ["[SCREENSHOT: Patch library]", "Grid of licensed and seasonal patches, the closest the configurator gets to artwork."],
      ["[SCREENSHOT: Mobile preview]", "Rotating preview with a persistent price bar and a build-time note."],
      ["[SCREENSHOT: Build window notice]", "Made-to-order lead time stated before checkout, exactly the transparency a custom purchase needs."]
    ],
    swot: {
      s: ["Canvas takes print exceptionally well", "Accessible entry price into personalisation"],
      w: ["Templated prints, not painted artwork", "No character, portrait or scene work is possible"],
      o: ["Painted artwork on the identical silhouette", "Fandom subjects a licensed library cannot include"],
      t: ["Independent painters on the same Chuck at lower prices", "Marketplace listings with unverified bases"]
    },
    path: [
      "Merchandise KNICKGASM Converse customs from $99.84 (UK from &pound;79.42) against the same silhouette.",
      "Show the difference between a printed template and a hand-painted panel, side by side.",
      "Own the fandom subjects a brand-licensed library will never carry."
    ]
  },
  {
    slug: "vans-customs", name: "Vans Customs", category: "Brand configurator", tier: 2,
    desktopUX: "Playful builder with the widest print and material library of the configurators, plus genuine skate and music subculture credibility behind it.",
    mobileUX: "Strong mobile builder tuned for a young audience. Still template-bound: personalisation here reads as selection, not creation.",
    stack: { checkout: "Vans.com", subscription: "None", analytics: "First-party", esp: "Brand CRM" },
    churnHook: "Community and subculture programmes rather than lifecycle automation.",
    wires: [
      ["[SCREENSHOT: Print library grid]", "Wide pattern and material library applied per panel, with live preview."],
      ["[SCREENSHOT: Silhouette switcher]", "Authentic, Old Skool and Slip-On toggles carrying the same library across shapes."],
      ["[SCREENSHOT: Mobile build bar]", "Persistent price and add-to-bag with the build window stated inline."],
      ["[SCREENSHOT: Community campaign block]", "Subculture campaign content sitting alongside the builder, doing the brand work the product cannot."]
    ],
    swot: {
      s: ["Genuine subculture credibility in skate and music", "Broadest print and material library of the configurators"],
      w: ["Still a template; no painted artwork", "Personalisation reads as selection rather than creation"],
      o: ["Customers who exhausted the library and still wanted something specific", "Subjects a licensed library cannot include"],
      t: ["Independent painters on the same silhouettes", "Fandom-led studios with deeper subject matter"]
    },
    path: [
      "Answer the customer who finished the builder and still did not get the thing they pictured.",
      "Lead with subjects a brand library will never license.",
      "Use the same subculture language without inheriting the template ceiling."
    ]
  },
  {
    slug: "ceeze", name: "Ceeze", category: "Artist commission studio", tier: 2,
    desktopUX: "Portfolio gallery with athlete and music placements front and centre, and an enquiry path in place of a buy path. Credibility is high, friction is total.",
    mobileUX: "Instagram-first discovery with the site acting as an archive. No price, no lead time, no checkout.",
    stack: { checkout: "Enquiry and DM-led", subscription: "None", analytics: "GA4", esp: "None visible" },
    churnHook: "Personal relationship and reputation instead of lifecycle marketing.",
    wires: [
      ["[SCREENSHOT: Placement gallery]", "High-profile client pairs presented as an archive, establishing credibility rather than availability."],
      ["[SCREENSHOT: Commission enquiry]", "Short enquiry form asking for the idea, the pair and the timeline."],
      ["[SCREENSHOT: Instagram-first funnel]", "Social profile doing the discovery work the site does not attempt."],
      ["[SCREENSHOT: Archive grid]", "Past commissions with no path to order anything similar."]
    ],
    swot: {
      s: ["Genuine artist credibility and high-profile placement", "A personal relationship with every client"],
      w: ["Capacity is one artist's hands", "No catalog, no listed price, no committed date"],
      o: ["Studio volume across many fandoms at once", "International express fulfilment they do not offer"],
      t: ["Studio-scale customisers meeting the same demand faster", "Configurators absorbing the mainstream"]
    },
    path: [
      "Publish many builds a week rather than one, across different fandoms.",
      "Make every filmed design immediately buyable rather than an example of past work.",
      "Commit to 10 to 15 days made-to-order against an open-ended queue."
    ]
  },
  {
    slug: "kickstradomis", name: "Kickstradomis", category: "Artist commission studio", tier: 2,
    desktopUX: "Gallery-led site with a recognisable house style and long-running sport associations. Enquiry rather than checkout, as with every commission studio.",
    mobileUX: "Social-first discovery; the site is an archive rather than a storefront.",
    stack: { checkout: "Enquiry-led", subscription: "None", analytics: "GA4", esp: "None visible" },
    churnHook: "Reputation and sport ties rather than any lifecycle system.",
    wires: [
      ["[SCREENSHOT: House-style gallery]", "Instantly recognisable painted style across a grid of past commissions."],
      ["[SCREENSHOT: Sport placement feature]", "Athlete pairs presented as the proof of credibility."],
      ["[SCREENSHOT: Enquiry path]", "Contact route replacing a product page."],
      ["[SCREENSHOT: Mobile archive]", "Long scroll of past work with no action available."]
    ],
    swot: {
      s: ["Instantly recognisable style", "Deep sport and athlete relationships"],
      w: ["The single-artist ceiling on capacity", "Nothing browsable and nothing buyable"],
      o: ["Breadth of subject matter rather than one house style", "A catalog that can be searched instead of a queue that must be joined"],
      t: ["Studios offering reliability and a date", "Marketplace price pressure at the low end"]
    },
    path: [
      "Compete on breadth of subject matter across anime, gaming, football, cars and celebrity.",
      "Offer a searchable catalog instead of a queue.",
      "Promise reliability and a date, which no single artist can."
    ]
  },
  {
    slug: "etsy-customs", name: "Etsy custom-sneaker sellers", category: "Marketplace long tail", tier: 1,
    desktopUX: "Marketplace search and listing grid where thousands of independent painters compete on thumbnail, review count and price. This is where most first-time custom buyers begin.",
    mobileUX: "Marketplace app browsing driven by reviews and price. Base originality and paint durability are rarely evidenced and frequently overstated.",
    stack: { checkout: "Etsy marketplace", subscription: "None", analytics: "Marketplace analytics", esp: "Marketplace messaging" },
    churnHook: "Marketplace favourites and coupons; no seller owns the customer relationship.",
    wires: [
      ["[SCREENSHOT: Marketplace search grid]", "Dozens of near-identical hand-painted AF1 listings sorted by price and review count."],
      ["[SCREENSHOT: Listing detail]", "Seller-written specification with no verifiable claim about the base pair or the finish."],
      ["[SCREENSHOT: Review wall]", "Review volume doing the trust work that provenance evidence should be doing."],
      ["[SCREENSHOT: Coupon banner]", "Marketplace-level discounting that anchors the whole category's price expectation."]
    ],
    swot: {
      s: ["Enormous aggregate supply and search visibility", "Sets the price anchor buyers arrive with"],
      w: ["Base originality frequently unverified", "Paint durability and delivery are unmanaged and unpredictable"],
      o: ["Originality and finish claims this tier cannot make", "A studio that answers, with a stated window"],
      t: ["Continued downward price pressure", "Category reputation damage from poor-quality pairs"]
    },
    path: [
      "Never answer this tier with a discount; answer it with the 100% original base.",
      "Show the water and scratch resistant finish being applied, on camera.",
      "State the 10 to 15 day window and then keep it, which the long tail rarely does."
    ]
  },
  {
    slug: "stockx", name: "StockX", category: "Sneaker resale marketplace", tier: 1,
    desktopUX: "Bid-ask market interface with full price history, sizing liquidity and an authentication promise. Ruthlessly efficient for buying a pair that already exists.",
    mobileUX: "App-first with price alerts and a drop calendar. Fast, transparent and completely impersonal, which is exactly its appeal.",
    stack: { checkout: "Proprietary marketplace", subscription: "None", analytics: "First-party", esp: "App push and email" },
    churnHook: "Drop calendar, price alerts and portfolio-style engagement.",
    wires: [
      ["[SCREENSHOT: Bid-ask interface]", "Live market with lowest ask, highest bid and sale history per size."],
      ["[SCREENSHOT: Authentication badge]", "Verification promise presented as the core trust product."],
      ["[SCREENSHOT: Price alert flow]", "Alerts that bring buyers back without any brand relationship."],
      ["[SCREENSHOT: Drop calendar]", "Release schedule turning scarcity into a repeat visit mechanic."]
    ],
    swot: {
      s: ["Authentication is a genuinely valuable trust product", "Unmatched liquidity and price transparency"],
      w: ["Nothing unique is ever produced", "Rare, but never singular; no craft and no story"],
      o: ["Gifting, where duplication is precisely the problem", "Grail budget redirected toward Jordan and Samba customs"],
      t: ["Nothing here threatens a customiser directly; it competes for the same budget"]
    },
    path: [
      "Compete on singular versus rare, the one argument a marketplace cannot answer.",
      "Own gifting and occasion demand, which resale serves badly.",
      "Point the grail budget at Air Jordan and Adidas Samba customs."
    ]
  },
  {
    slug: "goat", name: "GOAT", category: "Sneaker resale marketplace", tier: 2,
    desktopUX: "Editorial merchandising layered over a resale catalog, which raises perceived quality above a pure market interface.",
    mobileUX: "Strong app browsing with editorial content and clean authentication messaging.",
    stack: { checkout: "Proprietary marketplace", subscription: "None", analytics: "First-party", esp: "App push and email" },
    churnHook: "Editorial content and app engagement rather than lifecycle flows.",
    wires: [
      ["[SCREENSHOT: Editorial home]", "Curated stories sitting above the resale catalog, doing brand work a market interface cannot."],
      ["[SCREENSHOT: Product page]", "Sizing, condition and authentication messaging on a resale listing."],
      ["[SCREENSHOT: App browse]", "Editorial-led discovery in a mobile-first surface."],
      ["[SCREENSHOT: Authentication explainer]", "Verification process presented as the reason to trust the platform."]
    ],
    swot: {
      s: ["Editorial curation raises perceived quality", "Authentication plus a strong app experience"],
      w: ["Produces nothing unique", "Competes on access and hype, not on creation"],
      o: ["Their editorial standard as the bar for KNICKGASM design storytelling", "Gifting budget won on uniqueness"],
      t: ["Competes for the same discretionary sneaker spend"]
    },
    path: [
      "Raise KNICKGASM's design storytelling to their editorial standard.",
      "Argue uniqueness against curation, which is a different and stronger claim.",
      "Take gifting budget with a pair that cannot be bought twice."
    ]
  },
  {
    slug: "crepdog-crew", name: "CrepDog Crew", category: "India resale and drops", tier: 2,
    desktopUX: "Drop-led merchandising with strong youth energy and community framing; authentication carries the trust in a market that needs it.",
    mobileUX: "Social-first with drop reminders. Built for speed and scarcity rather than for considered browsing.",
    stack: { checkout: "Shopify", subscription: "None", analytics: "GA4", esp: "Klaviyo-class ESP" },
    churnHook: "Drop cadence and community membership rather than replenishment.",
    wires: [
      ["[SCREENSHOT: Drop landing]", "Countdown-led release page with limited stock framing."],
      ["[SCREENSHOT: Authentication note]", "Verification messaging positioned as the core reason to buy here."],
      ["[SCREENSHOT: Community feed]", "Customer wear and community content used as the primary proof asset."],
      ["[SCREENSHOT: Mobile drop reminder]", "Push and reminder mechanics that bring the same buyers back for the next release."]
    ],
    swot: {
      s: ["Strong youth reach and community credibility in India", "Authentication as a trust product where it matters most"],
      w: ["Produces nothing unique", "Competes on hype and access, both of which expire"],
      o: ["Grail budget won on singular rather than rare", "Gifting and occasion, which resale serves badly"],
      t: ["Competes directly for the Indian collector wallet"]
    },
    path: [
      "Take grail budget with a pair that is singular rather than merely rare.",
      "Use the same community language without depending on drop scarcity.",
      "Own wedding, festive and gifting demand, which resale cannot serve well."
    ]
  },
  {
    slug: "vegnonveg", name: "VegNonVeg", category: "India sneaker and streetwear retail", tier: 2,
    desktopUX: "Editorial retail merchandising with genuine cultural curation, plus physical stores that anchor the brand's standing.",
    mobileUX: "Clean retail browsing; the experience is considered rather than drop-driven.",
    stack: { checkout: "Shopify", subscription: "None", analytics: "GA4", esp: "Klaviyo-class ESP" },
    churnHook: "Curation, community and store experience rather than automated lifecycle.",
    wires: [
      ["[SCREENSHOT: Editorial home]", "Curated streetwear merchandising that reads as a magazine rather than a catalog."],
      ["[SCREENSHOT: Collaboration page]", "Brand collaborations presented as cultural moments."],
      ["[SCREENSHOT: Store locator]", "Physical retail anchoring the online brand."],
      ["[SCREENSHOT: Mobile product grid]", "Straightforward retail browsing with no personalisation layer."]
    ],
    swot: {
      s: ["Arguably India's most culturally credible sneaker retailer", "Curation and community rather than discounting"],
      w: ["Sells only pairs that already exist", "No customisation capability at all"],
      o: ["Their curation standard applied to KNICKGASM collection merchandising", "Uniqueness as the competing argument"],
      t: ["Competes for the same discretionary sneaker budget"]
    },
    path: [
      "Match their curation standard in how KNICKGASM merchandises collections.",
      "Compete for the same wallet on uniqueness, never on price.",
      "Treat them as the local proof that curation beats discounting."
    ]
  }
];

/* Reference matrix data (share tier, AOV, D-180 retention, primary hook,
   core tech stack one-liner, churn strategy) merged onto each competitor. */
const REF = {
  "shoe-surgeon":    { tier: 1, tierLabel: "High", price: "POA (commission)", lead: "Commission-length", hook: "Craft ceiling and collaboration halo",        stackShort: "Custom site / enquiry-led",        churnShort: "Reputation and waiting list, no lifecycle" },
  "nike-by-you":     { tier: 1, tierLabel: "High", price: "Brand list (n/v)", lead: "Brand-stated",      hook: "The largest personalisation funnel there is", stackShort: "Nike.com / Nike app",              churnShort: "Membership programme and app engagement" },
  "converse-by-you": { tier: 2, tierLabel: "Med",  price: "Brand list (n/v)", lead: "Brand-stated",      hook: "Accessible canvas personalisation",           stackShort: "Converse.com",                     churnShort: "Seasonal brand campaigns" },
  "vans-customs":    { tier: 2, tierLabel: "Med",  price: "Brand list (n/v)", lead: "Brand-stated",      hook: "Subculture credibility plus print library",   stackShort: "Vans.com",                         churnShort: "Community and subculture programmes" },
  "ceeze":           { tier: 2, tierLabel: "Med",  price: "POA (commission)", lead: "Commission-length", hook: "Named artist, high-profile placement",        stackShort: "Enquiry and DM-led",               churnShort: "Personal relationship and reputation" },
  "kickstradomis":   { tier: 2, tierLabel: "Med",  price: "POA (commission)", lead: "Commission-length", hook: "Recognisable house style and sport ties",     stackShort: "Enquiry-led custom site",          churnShort: "Reputation and sport association" },
  "etsy-customs":    { tier: 1, tierLabel: "High", price: "Long tail (n/v)",  lead: "Seller-stated",     hook: "Price anchoring at enormous scale",           stackShort: "Etsy marketplace",                 churnShort: "Marketplace favourites, no owned relationship" },
  "stockx":          { tier: 1, tierLabel: "High", price: "Market (n/v)",     lead: "Ships from stock",  hook: "Authentication and market liquidity",         stackShort: "Proprietary marketplace",          churnShort: "Drop calendar and price alerts" },
  "goat":            { tier: 2, tierLabel: "Med",  price: "Market (n/v)",     lead: "Ships from stock",  hook: "Editorial curation over resale",              stackShort: "Proprietary marketplace",          churnShort: "Editorial content and app engagement" },
  "crepdog-crew":    { tier: 2, tierLabel: "Med",  price: "Market (n/v)",     lead: "Ships from stock",  hook: "Drop culture and community in India",         stackShort: "Shopify storefront",               churnShort: "Drop cadence and community" },
  "vegnonveg":       { tier: 2, tierLabel: "Med",  price: "Retail (n/v)",     lead: "Ships from stock",  hook: "Cultural curation and physical retail",       stackShort: "Shopify plus physical stores",     churnShort: "Curation, community and store experience" }
};
COMPETITORS.forEach(function (c) {
  const r = REF[c.slug];
  if (r) { c.tier = r.tier; c.tierLabel = r.tierLabel; c.price = r.price; c.lead = r.lead; c.hook = r.hook; c.stackShort = r.stackShort; c.churnShort = r.churnShort; }
});

function tierSpan(t) { return '<span class="tier-' + t + '">Tier ' + t + '</span>'; }
function tierBadge(c) { return '<span class="tierbadge tb' + c.tier + '"><b>Tier ' + c.tier + '</b><i>' + c.tierLabel + '</i></span>'; }

/* master competitor matrix (used on hub + competitor-index) */
function competitorMatrix(dossierPrefix) {
  const rows = COMPETITORS.map(function (c) {
    const href = dossierPrefix + "dossiers/" + c.slug + ".html";
    return '<tr>' +
      '<td><a href="' + href + '" class="font-semibold" style="color:var(--brand-primary-text,var(--knickgasm-green));text-decoration:underline;">' + c.name + '</a><div class="text-[11px]" style="color:var(--soft);">' + c.category + '</div></td>' +
      '<td>' + tierBadge(c) + '</td>' +
      '<td>' + c.price + '</td>' +
      '<td>' + c.lead + '</td>' +
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
'              <th>Brand Name</th><th>Arena Tier</th><th>Price posture</th><th>Lead time</th><th>Primary Hook</th><th>Commerce Stack</th><th>Retention Strategy</th><th>Deep-Dive</th>',
'            </tr></thead>',
'            <tbody>',
'              ' + rows,
'            </tbody>',
'          </table>',
'        </div>'
  ].join("\n");
}

/* ------------------------------------------------------ cohort data + cards */
/* The `roast` key is a legacy field name kept so downstream consumers keep
   working; it now carries the cohort's DESIGN preference (rendered as
   "Design preference"), not a coffee roast. */
const COHORTS = [
  { id: "fandom-collectors", n: "Fandom Collectors", tag: "Loyalist", income: "$60k to $140k", roast: "Anime, gaming, football, cars",
    desc: "Buys the design, not the shoe. Arrives searching a character, a club or a game. Full-margin, protect from a discount habit. Hook: the design nobody else will own." },
  { id: "grail-collectors", n: "Grail Collectors", tag: "High-intent", income: "$100k to $220k", roast: "Air Jordan and Adidas Samba customs",
    desc: "Buys rarity and craft. Compares against resale grails and bespoke commissions. Highest order value in the catalog. Hook: singular beats rare, on a 100% original base." },
  { id: "occasion-gifters", n: "Occasion &amp; Gift Buyers", tag: "Seasonal", income: "$70k to $180k", roast: "Wedding, milestone, celebrity, bling",
    desc: "Buys for a person and a date. Least price-sensitive, most deadline-sensitive demand in the range. Hook: a gift that cannot be duplicated, delivered on time." },
  { id: "curious-first-timers", n: "Curious First-Timers", tag: "Switcher", income: "$45k to $95k", roast: "Converse and Court Vision customs",
    desc: "Has seen cheaper painted pairs and is weighing the risk. Price-aware and proof-hungry. Hook: the original base, the durable finish, and a stated 10 to 15 day window." }
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
      '<div><div class="text-[11px] uppercase font-bold" style="color:var(--soft);">Design preference</div><div class="mt-0.5">' + c.roast + '</div></div></div>' +
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
    '001': { name:'Fandom Collectors', hook:'the design they already love', hero:'Air Force 1 custom', sub:'anime, gaming and football collections', price:'156' },
    '002': { name:'Grail Collectors', hook:'a pair that is singular, not merely rare', hero:'Air Jordan custom', sub:'grail tier', price:'205' },
    '003': { name:'Occasion and Gift Buyers', hook:'a gift that cannot be duplicated', hero:'wedding custom', sub:'wedding and gifting collection', price:'156' },
    '004': { name:'Curious First-Timers', hook:'a first one-of-one without the risk', hero:'Converse custom', sub:'entry tier', price:'100' }
  };
  function mailerBlock(a, market){
    var store = STORE[market], cur = CUR[market];
    return [
'<!-- Knickgasm mailer :: '+a.name+' :: '+market+' -->',
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;font-family:Instrument Sans,Helvetica Neue,Arial,sans-serif;color:#111111;">',
'  <tr><td align="center" style="padding:28px 16px;">',
'    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid rgba(23,23,23,.12);border-radius:12px;overflow:hidden;">',
'      <tr><td style="background:#D0473E;padding:22px 28px;"><span style="font-family:Montserrat,Georgia,serif;color:#FFFFFF;font-size:24px;">Knickgasm</span></td></tr>',
'      <tr><td style="padding:34px 28px 8px;"><h1 style="margin:0;font-family:Montserrat,Georgia,serif;color:#D0473E;font-size:28px;line-height:1.15;">There is a moment when the right pair stops being a shoe.</h1></td></tr>',
'      <tr><td style="padding:8px 28px 20px;"><p style="margin:0;font-size:15px;line-height:1.6;color:#111111;">Made for '+a.hook+'. The '+a.hero+' is hand-painted by our artists in Mumbai on a 100% original pair, finished water and scratch resistant, and made to order in 10 to 15 days.</p></td></tr>',
'      <tr><td style="padding:0 28px 26px;"><a href="https://'+store+'/collections/best-sellers" style="display:inline-block;background:#6A33D8;color:#FFFFFF;font-weight:800;text-decoration:none;border-radius:9px;padding:13px 26px;font-size:14px;">See the designs, from '+cur+a.price+'</a></td></tr>',
'      <tr><td style="border-top:1px solid rgba(23,23,23,.12);padding:16px 28px;"><p style="margin:0;font-size:12px;color:#5b5b57;">One of one. Hand-painted on original pairs. Express shipping to 60+ countries. Knickgasm.</p></td></tr>',
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
'  A '+a.hero+' painted by hand on a 100% original pair, for '+a.hook+'.',
'  Water and scratch resistant. Made to order in 10 to 15 days. Nobody else will own it.',
'',
'HEADLINE:  One of one, on an original pair',
'DESCRIPTION:  '+a.sub.charAt(0).toUpperCase()+a.sub.slice(1)+', hand-painted in Mumbai, shipped express.',
'CTA:  Shop now',
'LANDING:  https://'+store+'/collections/best-sellers',
'PRICE POINT:  from '+cur+a.price+'',
'',
'PALETTE:  #D0473E lava red / #6A33D8 drip purple / #111111 ink / #FFFFFF white',
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
'    { "t": "0-2s", "shot": "blank white original pair on the workbench, first stroke of colour landing", "text": "It starts as an original" },',
'    { "t": "2-5s", "shot": "macro of the brush and airbrush passes building the '+a.hero+' design", "text": "Hand-painted in Mumbai" },',
'    { "t": "5-8s", "shot": "finished pair turned to camera, then worn out of frame", "text": "One of one. Yours only." }',
'  ],',
'  "cta": { "label": "Shop now", "url": "https://'+store+'/collections/best-sellers" },',
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
hero("Lifecycle OS", "The Growth &amp; Automation Playbook",
  "The master hub for how Knickgasm grows a hand-painted custom sneaker business. This is a modular, multi-page ecosystem: every feature and every competitor lives in its own deep-dive file, and this hub links out to all of them. KNICKGASM figures are read from the built catalogs; third-party market sizing is marked as a dependency rather than estimated."),

// Feature 01
'      <section data-section id="market" class="space-y-4">',
secHead("Feature 01", "Macro Market Intelligence War Room", "The US custom sneaker opportunity, framed top-down."),
'        <div class="grid gap-4 sm:grid-cols-3">',
metricCard("Live SKUs", "436", "Finished one-of-one designs in the built catalog."),
metricCard("AF1 median", "$156", "Median US price of an Air Force 1 custom (UK ~&pound;124).", "lava"),
metricCard("Countries", "60+", "Markets reached by express shipping.", "green"),
'        </div>',
'        <div class="flex flex-wrap gap-3">' + linkBtn("./features/market-intelligence.html", "Open Comprehensive Market Report &rarr;") + linkBtn("./features/market-study.html", "Read the Complete Market Study &rarr;", true) + '</div>',
'      </section>',

// Feature 02
'      <section data-section id="competitors" class="space-y-4">',
secHead("Feature 02", "Forensic Competitor Dossiers", "Eleven players across bespoke commission studios, brand configurators, the marketplace long tail, resale and Indian sneaker retail. Each brand name and deep-dive link opens its own independent dossier file covering desktop vs mobile UX, wireframes, commerce stack, and a Knickgasm battle card."),
competitorMatrix("./"),
'        <div>' + linkBtn("./features/competitor-index.html", "Open the full dossier index &rarr;") + '</div>',
'      </section>',

// Feature 03 + 04
'      <section data-section id="knowledge" class="space-y-4">',
secHead("Feature 03 &amp; 04", "Knowledge Base &amp; Product Avatars", "The craft truth behind the premium, and the product characters that carry it to the shopper."),
'        <div class="grid gap-4 md:grid-cols-3">',
'          <div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Made-to-order in 10 to 15 days</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Every pair is painted after it is ordered, in the Mumbai studio, then finished and shipped express. The window is stated before checkout, never discovered at it.</p></div>',
'          <div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Original bases, durable finish</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Every design is painted on a 100% original Nike, Jordan, Converse or Adidas pair and sealed with a water and scratch resistant finish. Both claims are checkable, which is the whole differentiation.</p></div>',
'          <div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Accessory and care attach</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Rope laces at $7.91 and lace tags at $9.14 lift basket value without discounting the pair, and open the care conversation that brings a grail buyer back.</p></div>',
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

'      <footer class="pt-8 border-t text-[12.5px]" style="border-color:var(--line);color:var(--soft);">Knickgasm Growth &amp; Automation Playbook hub. Modular by design: every feature and competitor is its own file. KNICKGASM figures are read from the built catalogs; competitor intelligence is directional and labelled, and unverifiable figures are marked rather than estimated.</footer>'
  ].join("\n");

  return page({ title: "Knickgasm Growth & Automation Playbook", desc: "Master hub for the Knickgasm custom-sneaker growth and automation playbook: market intelligence, competitor dossiers, knowledge base, cohorts, analytics, asset workspace, Shopify loop, and KicksGPT config.", prefix: "", activeKey: "hub", crumb: "Playbook Hub", main: main });
}

/* ---- FEATURE 01: market intelligence ---- */
function buildMarketIntelligence() {
  const main = [
hero("Feature 01", "Macro Market Intelligence",
  "The full sizing and benchmark report behind the hub summary. Top-down market frame, lifecycle benchmarks, and the cross-tier read that positions Knickgasm in the custom-sneaker arena."),
'      <section data-section id="sizing" class="space-y-4">',
secHead("Sizing", "What we can state, and what we still owe", "Custom sneakers are not broken out by any research firm, so the catalog facts are exact and the third-party sizing is named as a dependency."),
'        <div class="grid gap-4 sm:grid-cols-3">',
metricCard("Live SKUs", "436", "Finished one-of-one designs across every collection."),
metricCard("Price band", "$99.84 to $261.95", "Full custom pair, US. UK &pound;79.42 to &pound;208.37.", "lava"),
metricCard("Lead time", "10 to 15 days", "Made-to-order, stated before checkout.", "green"),
'        </div>',
'        <div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Reading the arena</h3><ul class="mt-2 space-y-2 text-sm" style="color:var(--knickgasm-ink);">' +
'<li><b style="color:var(--brand-primary-text,var(--knickgasm-green));">The gap is structural.</b> Bespoke studios will not list a price, configurators will not paint artwork, and the marketplace long tail will not guarantee an original base.</li>' +
'<li><b style="color:var(--brand-primary-text,var(--knickgasm-green));">Demand is created for us.</b> Brand configurators educate an enormous audience that personalisation is worth paying for, then stop at colour.</li>' +
'<li><b style="color:var(--brand-primary-text,var(--knickgasm-green));">Third-party sizing is a dependency.</b> [DATA REQUIRED BEFORE LAUNCH: US custom-sneaker service market size, cited firm, US]. Own order data is the better source and should be wired in first.</li></ul></div>',
'      </section>',
'      <section data-section id="benchmarks" class="space-y-4">',
secHead("Benchmarks", "The catalog, tier by tier", "The real price ladder, read from the built catalogs rather than estimated."),
'        <div class="card overflow-x-auto"><table class="grid-tbl" style="min-width:560px;">' +
'<thead><tr><th>Tier</th><th>US price</th><th>UK price</th></tr></thead><tbody>' +
'<tr><td>Accessories (rope laces, lace tags)</td><td>$7.91 to $9.14</td><td>&pound;6.29 to &pound;7.27</td></tr>' +
'<tr><td>Hand-painted denim jackets</td><td>$64.35</td><td>&pound;51.19</td></tr>' +
'<tr><td>Entry customs (Converse, Court Vision)</td><td>$99.84 to $152.06</td><td>&pound;79.42 to &pound;120.96</td></tr>' +
'<tr><td>Core customs (Air Force 1, 349 SKUs)</td><td>$115.47 to $261.95</td><td>&pound;91.85 to &pound;208.37</td></tr>' +
'<tr><td>Grail customs (Air Jordan, Adidas)</td><td>$153.60 to $226.29</td><td>&pound;122.18 to &pound;180.00</td></tr>' +
'<tr><td>Lead time, every made-to-order pair</td><td>10 to 15 days</td><td>10 to 15 days</td></tr>' +
'</tbody></table></div>',
'        <div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">The Knickgasm edge</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">A browsable catalog of finished one-of-one designs, every one painted on a 100% original pair and sealed with a water and scratch resistant finish, delivered in 10 to 15 days. Rivals hold that position only in halves. Lead with the base and the finish, never with a discount. Prices are read from the built catalogs.</p></div>',
'        <div class="flex flex-wrap gap-3">' + linkBtn("./market-study.html", "Read the complete market study &rarr;") + linkBtn("./competitor-index.html", "See the competitor grid &rarr;", true) + '</div>',
'      </section>'
  ].join("\n");
  return page({ title: "Macro Market Intelligence :: Knickgasm Playbook", desc: "Catalog-true sizing and lifecycle benchmarks for the US custom-sneaker arena, with third-party dependencies named rather than estimated.", prefix: "../", activeKey: "market-intelligence", crumb: "Market Intelligence", main: main });
}

/* ---- FEATURE: complete market study (renders the four regional studies from market-study-content.js) ---- */
function buildMarketStudy() {
  // brand matrix rows from the study; slug links to the dossier where one exists
  const SM = [
    ["The Shoe Surgeon", "shoe-surgeon", "Bespoke commission studio", "Tier 1 (craft ceiling)", "Press, collaborations, Instagram", "Custom site, enquiry-led", "Reputation and a waiting list carry demand; there is no lifecycle programme and nothing to buy today"],
    ["Nike By You", "nike-by-you", "Brand-run configurator", "Tier 1 (mass personalisation)", "Brand marketing, app, retail", "Nike.com + Nike app", "Membership and launch calendar drive return visits; the product itself stops at colour selection"],
    ["Converse By You", "converse-by-you", "Brand-run configurator", "Tier 2 (accessible)", "Brand, retail, social", "Converse.com", "Seasonal campaigns rather than lifecycle; templated prints and patches, no painted artwork"],
    ["Vans Customs", "vans-customs", "Brand-run configurator", "Tier 2 (youth reach)", "Brand, skate and music culture", "Vans.com", "Subculture community programmes; widest print library of the configurators but still a template"],
    ["Ceeze", "ceeze", "Artist commission studio", "Tier 2 (named artist)", "Instagram, athlete placement", "Enquiry and DM-led", "Personal relationship and reputation; capacity is one artist's hands and there is no catalog"],
    ["Kickstradomis", "kickstradomis", "Artist commission studio", "Tier 2 (house style)", "Instagram, sport partnerships", "Enquiry-led custom site", "Reputation and sport association; same single-artist ceiling on capacity and no listed price"],
    ["Etsy custom-sneaker sellers", "etsy-customs", "Marketplace long tail", "Tier 1 (price anchor)", "Marketplace search, Pinterest, social", "Etsy marketplace", "Marketplace favourites and coupons; no seller owns the customer and base originality is rarely evidenced"],
    ["StockX", "stockx", "Sneaker resale marketplace", "Tier 1 (liquidity)", "App, SEO, drop calendar", "Proprietary marketplace", "Drop calendar and price alerts; authentication is the trust product and nothing unique is produced"],
    ["GOAT", "goat", "Sneaker resale marketplace", "Tier 2 (curation)", "App, editorial, social", "Proprietary marketplace", "Editorial curation and app engagement raise perceived quality over a pure market interface"],
    ["CrepDog Crew", "crepdog-crew", "India resale and drops", "Tier 2 (community)", "Instagram, community, drops", "Shopify", "Drop cadence and community membership; competes for grail budget on hype rather than uniqueness"]
  ];

  const smRows = SM.map(function (r) {
    return '<tr><td><a href="../dossiers/' + r[1] + '.html" style="color:var(--brand-primary-text,var(--knickgasm-green));text-decoration:underline;font-weight:600;">' + r[0] + '</a></td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td><td>' + r[5] + '</td><td>' + r[6] + '</td></tr>';
  }).join("\n              ");

  const COH = [
    { n: "Cohort A: The Fandom Collector", driver: "Design-driven", demo: "Age 18 to 34, broadly balanced by gender. Anime, gaming, football and motorsport communities; buys identity, not footwear.", geo: "High-index: California, New York, Texas, Illinois, plus every major metro with a convention or club culture.", mech: "Price elasticity low to moderate once the design is right. Core driver: the specific subject. Very high reactivation on a new collection in their fandom. Churn trigger: the catalog stops speaking their language.", map: "Anime, gaming, football and sport, cars and celebrity collections on Air Force 1." },
    { n: "Cohort B: The Grail Collector", driver: "Rarity-driven", demo: "Age 25 to 45, skews male. Already buys resale grails and compares KNICKGASM against StockX and bespoke commissions.", geo: "High-index: coastal US metros, London, Dubai, Mumbai and Delhi.", mech: "Price elasticity very low; price is a signal. Core driver: nobody else has this pair. Moderate reactivation, needs a genuinely new grail rather than a discount. Churn trigger: the range starts to feel repeatable.", map: "Air Jordan and Adidas Samba customs, bling and crystal work." },
    { n: "Cohort C: The Occasion and Gift Buyer", driver: "Date-driven", demo: "Age 25 to 55, skews female for gifting. Buying for a wedding, a birthday, an anniversary or a milestone.", geo: "Broad; peaks with festive and wedding seasons in every market, strongest in India and the GCC.", mech: "Price elasticity very low, deadline sensitivity very high. Core driver: a gift that cannot be duplicated. Reactivation is annual and calendar-led. Churn trigger: a missed date, which costs far more than the order.", map: "Wedding, pets, celebrity and personalised designs, plus denim jackets." },
    { n: "Cohort D: The Curious First-Timer", driver: "Trial-driven, proof-gated", demo: "Age 18 to 30, price-aware, has already seen cheaper painted pairs online and is weighing the risk.", geo: "Broad, including Tier-II and Tier-III cities in India and non-metro markets everywhere.", mech: "Price elasticity high, but the objection is trust rather than price. Core driver: uniqueness gated by the fear the paint will crack. Moderate to high reactivation once the first pair survives real wear. Churn trigger: a surprise lead time or a finish that fails.", map: "Converse and Court Vision customs, with rope laces and lace tags attached." }
  ];

  const cohCards = COH.map(function (c) {
    return '<div class="card p-6"><div class="flex items-center justify-between flex-wrap gap-2"><h3 class="font-head text-xl text-knickgasm-green">' + c.n + '</h3><span class="pill" style="background:var(--knickgasm-chalk);color:var(--knickgasm-lava-ink);">' + c.driver + '</span></div>' +
      '<dl class="mt-3 text-sm grid gap-2" style="color:var(--knickgasm-ink);">' +
      '<div><dt class="text-[11px] uppercase font-bold" style="color:var(--soft);">Demographics</dt><dd class="mt-0.5">' + c.demo + '</dd></div>' +
      '<div><dt class="text-[11px] uppercase font-bold" style="color:var(--soft);">Geography</dt><dd class="mt-0.5">' + c.geo + '</dd></div>' +
      '<div><dt class="text-[11px] uppercase font-bold" style="color:var(--soft);">Mechanics</dt><dd class="mt-0.5">' + c.mech + '</dd></div>' +
      '<div><dt class="text-[11px] uppercase font-bold" style="color:var(--soft);">Product mapping</dt><dd class="mt-0.5"><b style="color:var(--brand-primary-text,var(--knickgasm-green));">' + c.map + '</b></dd></div>' +
      '</dl></div>';
  }).join("\n          ");

  // ---- region-tabbed competitor set ----
  const REGIONS = ["US", "UK", "Global", "India"];
  const MB = [
    { n: "The Shoe Surgeon", s: "shoe-surgeon", v: "Bespoke commission studio", t: "Tier 1", r: ["US", "Global"], site: "theshoesurgeon.com", aov: "POA", hook: "Craft ceiling, collaboration halo", churn: "Reputation and waiting list", detail: true },
    { n: "Nike By You", s: "nike-by-you", v: "Brand configurator", t: "Tier 1", r: ["US", "UK", "Global"], site: "nike.com", aov: "Brand list (n/v)", hook: "Mass personalisation at brand scale", churn: "Membership and app engagement", detail: true },
    { n: "Converse By You", s: "converse-by-you", v: "Brand configurator", t: "Tier 2", r: ["US", "UK", "Global"], site: "converse.com", aov: "Brand list (n/v)", hook: "Accessible canvas personalisation", churn: "Seasonal brand campaigns", detail: true },
    { n: "Vans Customs", s: "vans-customs", v: "Brand configurator", t: "Tier 2", r: ["US", "UK", "Global"], site: "vans.com", aov: "Brand list (n/v)", hook: "Subculture reach, widest print library", churn: "Community programmes", detail: true },
    { n: "Ceeze", s: "ceeze", v: "Artist commission studio", t: "Tier 2", r: ["US"], site: "ceeze.com", aov: "POA", hook: "Named artist, athlete placement", churn: "Personal relationship", detail: true },
    { n: "Kickstradomis", s: "kickstradomis", v: "Artist commission studio", t: "Tier 2", r: ["US"], site: "kickstradomis.com", aov: "POA", hook: "House style, sport ties", churn: "Reputation and sport association", detail: true },
    { n: "Etsy custom-sneaker sellers", s: "etsy-customs", v: "Marketplace long tail", t: "Tier 1", r: ["US", "UK", "Global"], site: "etsy.com", aov: "Long tail (n/v)", hook: "Price anchoring at scale", churn: "Marketplace favourites, no owned relationship", detail: true },
    { n: "StockX", s: "stockx", v: "Sneaker resale marketplace", t: "Tier 1", r: ["US", "UK", "Global"], site: "stockx.com", aov: "Market (n/v)", hook: "Authentication and liquidity", churn: "Drop calendar, price alerts", detail: true },
    { n: "GOAT", s: "goat", v: "Sneaker resale marketplace", t: "Tier 2", r: ["US", "UK", "Global"], site: "goat.com", aov: "Market (n/v)", hook: "Editorial curation over resale", churn: "Editorial content, app engagement", detail: true },
    { n: "CrepDog Crew", s: "crepdog-crew", v: "India resale and drops", t: "Tier 2", r: ["India", "Global"], site: "crepdogcrew.com", aov: "Market (n/v)", hook: "Drop culture and community", churn: "Drop cadence, community", detail: true },
    { n: "VegNonVeg", s: "vegnonveg", v: "India sneaker and streetwear retail", t: "Tier 2", r: ["India"], site: "vegnonveg.com", aov: "Retail (n/v)", hook: "Cultural curation, physical retail", churn: "Curation and store experience", detail: true },
    { n: "Superkicks", s: "superkicks", v: "India retail and sneaker care", t: "Tier 3", r: ["India"], site: "superkicks.in", aov: "Retail (n/v)", hook: "Retail plus the care adjacency", churn: "Care replenishment, store community", detail: false },
    { n: "Hypefly", s: "hypefly", v: "India sneaker resale", t: "Tier 3", r: ["India"], site: "hypefly.co.in", aov: "Market (n/v)", hook: "Authenticated grails in India", churn: "Authentication guarantee", detail: false },
    { n: "Crep Protect", s: "crep-protect", v: "Sneaker care and protection (UK)", t: "Tier 3", r: ["UK", "Global"], site: "crepprotect.com", aov: "Retail (n/v)", hook: "Normalised paying to protect a pair", churn: "Consumable replenishment", detail: false },
    { n: "Angelus Direct", s: "angelus", v: "Leather paints and finishers (supply)", t: "Tier 3", r: ["US", "Global"], site: "angelusdirect.com", aov: "Retail (n/v)", hook: "What most hand-painters buy", churn: "Supply-side repeat", detail: false }
  ];

  const VAH_MB = { n: "KNICKGASM", v: "Hand-painted one-of-one custom sneakers", t: "Category leader (India)", r: ["US", "UK", "Global", "India"], site: "knickgasm.com", aov: "AF1 median ~$156 (UK ~&pound;124)", hook: "Browsable one-of-one on a 100% original base", churn: "Occasion cycles, new collections, care follow-up" };
  function mbRow(b, vah) {
    const nameCell = vah ? "<b>" + b.n + "</b>"
      : (b.detail ? '<a href="../dossiers/' + b.s + '.html" style="color:var(--brand-primary-text,var(--knickgasm-green));text-decoration:underline;font-weight:600;">' + b.n + '</a>'
        : '<a href="https://' + b.site + '" target="_blank" rel="noopener" style="color:var(--brand-primary-text,var(--knickgasm-green));text-decoration:underline;font-weight:600;">' + b.n + '</a>');
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
      '<p class="text-[12.5px] mt-1" style="color:var(--knickgasm-ink);"><b class="text-knickgasm-green">Retention:</b> ' + b.churn + '</p>' +
      '<p class="text-[12.5px] mt-2"><a href="' + link + '"' + target + ' style="color:var(--brand-primary-text,var(--knickgasm-green));text-decoration:underline;font-weight:600;">' + cta + '</a></p></div>';
  }
  const briefCards = MB.map(briefCard).join("\n          ");
  const regionTabs = REGIONS.map(function (r, i) { return '<button type="button" class="rtab' + (i === 0 ? " on" : "") + '" data-region="' + r + '">' + r + '</button>'; }).join("");

  const regionBlocks = REGIONS.map(function (r) {
    return '<div data-region-report="' + r + '"' + (r === "US" ? "" : ' style="display:none"') + ' class="space-y-3">' + msc.reportInnerHTML(r) + '</div>';
  }).join("\n");
  const main = [
"<header class=\"space-y-3\"><span class=\"text-[11px] tracking-[.18em] uppercase font-bold lava-ink\">Market Study</span><h1 class=\"font-head text-4xl md:text-5xl text-knickgasm-green leading-[1.05]\">Custom Sneaker Market Study</h1><p class=\"text-[15px] max-w-3xl\" style=\"color:var(--soft);\">The custom sneaker, configurator, resale and sneaker-care landscape with a competitor teardown, catalog-true sizing, a DTC playbook and a white-space read. Pick a region, then browse by category tab. All four studies (US, UK, Global rest-of-world and India) are live, each with PDF and DOC downloads.</p></header>",
"<div class=\"flex flex-wrap items-center gap-2 mt-4\" id=\"regionTabs\"><span class=\"text-[11px] uppercase tracking-widest font-bold lava-ink\" style=\"margin-right:4px\">Region</span>" + regionTabs + "<span class=\"text-[12px]\" style=\"color:var(--soft);margin-left:6px\">Showing <b class=\"text-knickgasm-green\" id=\"mktRegionLabel\">US</b></span></div>",
regionBlocks,
"<div class=\"mt-8\"><div class=\"text-[11px] tracking-[.16em] uppercase font-bold lava-ink\">Competitor set</div><h2 class=\"font-head text-2xl md:text-3xl text-knickgasm-green mt-1\">Competitors by region</h2><p class=\"text-sm mt-2 max-w-3xl\" style=\"color:var(--soft);\">Each competitor in the selected region, filtered by the tabs above. Open a comparison or visit the live site for products, offers and creatives.</p></div>",
"<div class=\"card overflow-x-auto\"><table class=\"grid-tbl\" style=\"min-width:940px;\"><thead><tr><th>Brand</th><th>Arena role</th><th>Tier</th><th>Price posture</th><th>Primary hook</th><th>Retention strategy</th></tr></thead><tbody>" + marketRows + "</tbody></table></div>",
"<div class=\"grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4\">" + briefCards + "</div>"
  ].join("\n");
  return page({ title: "Complete Market Study :: Knickgasm Playbook", desc: "Full custom-sneaker market studies for US, UK, Global and India: sizing, competitor teardown, strategy and white space, in categorized tabs with PDF and DOC downloads.", prefix: "../", activeKey: "market-study", crumb: "Market Study", main: main, extraJS: JS_MARKET + JS_MSCAT });
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
hero("Feature 03", "Studio-to-Doorstep Knowledge Base",
  "The craft truth behind the premium. Every asset the OS produces quotes these facts, and KicksGPT ingests this page as verified source."),
'      <section data-section id="supply" class="space-y-4">',
secHead("Build pipeline", "Order to doorstep", "What actually happens in the 10 to 15 days between checkout and delivery."),
'        <div class="flex flex-wrap items-center gap-2">' +
'<span class="flow-node">100% original pair sourced</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">Prep, mask and base coat</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">Hand-painted artwork, embroidery or crystal work</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">Water and scratch resistant finish, cured</span><span class="lava-ink font-bold">&rarr;</span>' +
'<span class="flow-node">Boxed with laces and tags, shipped express</span></div>',
'        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">' +
metricCard("10-15 days", "Made-to-order build window", "") +
metricCard("100%", "Original Nike, Jordan, Converse and Adidas bases", "") +
metricCard("436", "Finished one-of-one designs live", "") +
metricCard("60+", "Countries reached by express shipping", "") +
'        </div>',
'      </section>',
'      <section data-section id="verify" class="space-y-4">',
secHead("Verification", "What we can prove", "How each claim is backed. Rule for copy: state only what is checkable, and never imply a brand partnership."),
'        <div class="grid gap-4 md:grid-cols-3">' +
'<div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Original base</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Every design is painted on a 100% original branded pair. Describe it as an original brand product hand-painted by KNICKGASM, and never as a collaboration or endorsement.</p></div>' +
'<div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Durable finish</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Water and scratch resistant, applied and cured in the studio. Claim it plainly and show it being applied; never claim more than the finish delivers.</p></div>' +
'<div class="card p-5"><h3 class="font-head text-lg text-knickgasm-green">Design provenance register</h3><p class="text-sm mt-2" style="color:var(--knickgasm-ink);">Every design is logged as original artwork, fan interpretation, or licence-required. Retire quickly rather than defend, and keep the register regional.</p></div>' +
'        </div>',
'      </section>',
'      <section data-section id="crosssell" class="space-y-4">',
secHead("Cross-sell", "Accessory, apparel and grail logic", "The bridges that turn a one-time buyer into a returning one, without a subscription."),
'        <div class="card overflow-x-auto"><table class="grid-tbl" style="min-width:640px;">' +
'<thead><tr><th>From (first purchase)</th><th>Bridge product</th><th>To (anchor)</th><th>Trigger</th></tr></thead><tbody>' +
'<tr><td>Rope laces / lace tags</td><td>Converse or Court Vision custom</td><td>Air Force 1 custom</td><td>Accessory buyer sees the design that matches their fandom</td></tr>' +
'<tr><td>Converse / Court Vision custom</td><td>Air Force 1 custom</td><td>Air Jordan or Adidas grail</td><td>First pair survives real wear; the durability doubt is gone</td></tr>' +
'<tr><td>Air Force 1 custom</td><td>Hand-painted denim jacket</td><td>Matching pair and jacket set</td><td>Cross-category, same fandom, same artist</td></tr>' +
'<tr><td>Gift buyer</td><td>Self-purchase invitation</td><td>Their own one-of-one</td><td>Post-occasion follow-up, plus care guidance on the pair they gifted</td></tr>' +
'</tbody></table></div>',
'        <div>' + linkBtn("./product-avatars.html", "Meet the product avatars these convert &rarr;") + '</div>',
'      </section>',
'      <section data-section id="cohorts" class="space-y-4">',
secHead("Buyer cohorts", "The four audiences", "The demographic and behavioural segments every brief targets. Product avatars are the persuasion layer that speaks to these buyers."),
cohortCards(),
'        <details class="blueprint" open><summary><span>schemas/cohort-profile.json <span class="text-[11px] font-body opacity-70">JSON Schema</span></span><span class="plus text-knickgasm-lava text-xl leading-none transition-transform">+</span></summary><pre>' + COHORT_SCHEMA + '</pre></details>',
'      </section>'
  ].join("\n");
  return page({ title: "Studio-to-Doorstep Knowledge Base :: Knickgasm Playbook", desc: "Knickgasm build-pipeline facts, claim verification rules, cross-sell logic across accessories, customs and apparel, and the four buyer cohorts.", prefix: "../", activeKey: "knowledge-base", crumb: "Knowledge Base", main: main });
}

/* ---- FEATURE 04: cohort profiles ---- */
/* ============================================ PRODUCT AVATARS (Feature 04) */
/* Avatars give each hero PRODUCT a face and a voice: characters the shopper
   talks to, that engage and persuade toward the right purchase. Not buyer
   demographics (those live as cohorts in the Knowledge Base). */
const PRODUCT_AVATARS = [
  {
    slug: "ace", face: "\u{1F3C0}", name: "Ace", embodies: "Air Force 1 Customs",
    personality: "Confident, warm, a little theatrical. The one who knows the pair is the point.",
    signature: "I am the pair nobody else owns. Same silhouette you know, painted so it could only ever be yours.",
    targets: "Fandom Collectors and Curious First-Timers",
    objections: [
      { q: "Why not just buy a normal Air Force 1?", a: "Because a normal pair says nothing about you. I start as the same 100% original Nike Air Force 1, then get hand-painted with the thing you actually care about. Nobody will ever walk past you in me." },
      { q: "Will the paint crack when I wear them?", a: "No. I am finished with a water and scratch resistant paint system, applied and sealed by hand in the Mumbai studio. I am built to be worn, not shelved." },
      { q: "Ten to fifteen days feels like a long wait.", a: "It is, and it is the honest number. Nobody is pulling me off a shelf. An artist is painting me for you, then finishing and drying me properly. That is the wait, and it is stated before you pay, never after." }
    ]
  },
  {
    slug: "juno", face: "\u{1F451}", name: "Juno", embodies: "Air Jordan and Adidas Samba Grails",
    personality: "Precise, collected, quietly superior. The connoisseur who knows exactly what they are holding.",
    signature: "Rare is a number. I am a count of one. There is a difference, and you already know it.",
    targets: "Grail Collectors",
    objections: [
      { q: "How are you different from a resale grail?", a: "A resale grail is rare. There are still hundreds of them, and a marketplace will price every one. I am singular. One base, one design, one pair, and no second listing anywhere." },
      { q: "Is the base pair genuine?", a: "Always. Every KNICKGASM pair starts as a 100% original Nike, Jordan, Converse or Adidas. That is not a nice-to-have in this category, it is the whole trust proposition." },
      { q: "Why are you priced where you are?", a: "Between a template you can configure and a commission you have to queue for. You get the artwork of the second at a listed price, with a date attached." }
    ]
  },
  {
    slug: "iris", face: "\u{2728}", name: "Iris", embodies: "Wedding, Bling and Crystal Work",
    personality: "Warm, ceremonial, a little sentimental. The one who understands the day matters more than the shoe.",
    signature: "Somebody will remember the day. I am the part of it they get to keep and wear.",
    targets: "Occasion and Gift Buyers",
    objections: [
      { q: "Will it arrive in time?", a: "That is the only question that matters for a dated pair, so ask it early. Ten to fifteen days to paint, then express shipping to 60+ countries. Order against the date, not against the mood, and it will be there." },
      { q: "Is this a serious gift or a novelty?", a: "It is hand-painted crystal and embroidery work on an original pair, made once for one person. Novelty is a thing you laugh at. I am a thing somebody keeps." },
      { q: "What if the design is not quite right?", a: "Tell us before the brush touches the leather. The catalog is 436 finished designs precisely so you can see exactly what you are getting before you commit." }
    ]
  },
  {
    slug: "kobi", face: "\u{1F3AE}", name: "Kobi", embodies: "Anime, Gaming and Sport Collections",
    personality: "Fast, funny, deeply online. The one who already knows the reference before you finish saying it.",
    signature: "You have watched it, played it, shouted at it on a Sunday. Now wear it.",
    targets: "Fandom Collectors and Curious First-Timers",
    objections: [
      { q: "Do you have my series or my club?", a: "The catalog runs across anime, gaming, football and sport, cars, pets, celebrity and more, 436 designs live right now. Start at the collection, not the silhouette, and you will find yourself faster." },
      { q: "Are these officially licensed?", a: "Most designs are original hand-painted artwork by KNICKGASM artists, made as fan work rather than licensed merchandise, and never sold as an official brand collaboration. If a design is retired for that reason, the collection is the place to look next." },
      { q: "Can I actually wear these out?", a: "That is the point. Water and scratch resistant finish on an original pair. Wear them to the match, to the convention, to the queue at midnight." }
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
'        "design_family": { "type": "string", "enum": ["anime","gaming","football-sport","cars","wedding","pets","bling","celebrity","embroidery","coffee-art"] },',
'        "base_silhouette": { "type": "string", "enum": ["air-force-1","court-vision","air-jordan","converse","adidas"] },',
'        "gift_intent": { "type": "number", "minimum": 0, "maximum": 1 }',
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
    '<p class="text-[12.5px] mt-3" style="color:var(--knickgasm-ink);">Each hero collection is its own trained voice agent, talk to it live by text or voice, then copy the complete embed code to drop it on any page.</p></div>';
}

const AVATAR_CATEGORIES = {
  ace: ["Air Force 1", "Court Vision", "Bestsellers"],
  juno: ["Air Jordan", "Adidas", "Grails"],
  iris: ["Wedding", "Bling", "Embroidery", "Gifts"],
  kobi: ["Anime", "Gaming", "Football", "Cars"]
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
'<div class="metric p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Net revenue (this hour)</div><div class="mv text-3xl mt-1" id="pace-rev">$0</div><div class="text-[12px] mt-1" id="pace-rev-delta" style="color:var(--brand-primary-text,var(--knickgasm-green));">&nbsp;</div></div>' +
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
  const steps = c.path.map(function (s, i) { return '<li><b style="color:var(--brand-primary-text,var(--knickgasm-green));">Step ' + (i + 1) + '.</b> ' + s + '</li>'; }).join("");
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
'        <div class="card p-5"><span class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">Churn strategy</span><p class="text-sm mt-1" style="color:var(--knickgasm-ink);">' + c.churnShort + '</p><span class="text-[11px] uppercase tracking-[.06em] font-bold mt-3 block" style="color:var(--soft);">Core tech stack</span><p class="code-out mt-1" style="color:var(--brand-primary-text,var(--knickgasm-green));">' + c.stackShort + '</p></div>',
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
