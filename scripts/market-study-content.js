"use strict";
/**
 * Market Study content, single source of truth for all four regional reports
 * (US, UK, Global/Rest-of-World, India). Transcribed from the final analyst
 * PDFs shared 9 July 2026 (the fuller 12/13-section versions).
 *
 *   reportInnerHTML(region) -> on-page report block (categorized sub-tabs +
 *                              card / grid-tbl / lava-ink styling + confidence chips)
 *   docHTML(region)         -> clean standalone HTML (reference)
 *   docxDocumentXml(region) -> WordprocessingML body for the downloadable .docx
 *
 * Brand rules: no em/en dashes, straight quotes, four-colour palette. Only
 * sourced facts, all speculative ("Guessing") content is excluded.
 */

var pricing = require("./market-pricing.js");

var REGIONS = ["US", "UK", "Global", "India"];

var META = {
  US: {
    file: "US_Custom_Sneaker_Market_Study",
    panelTitle: "US Custom Sneaker Market Study",
    docTitle: "The U.S. Custom Sneaker &amp; Sneaker-Personalisation Market",
    sub: "Sneaker retail and resale, one-of-one customisation, and sneaker care, with a competitor teardown of the hand-painted-custom arena",
    prep: "Growth &amp; Digital Production, KNICKGASM (US market)"
  },
  UK: {
    file: "UK_Custom_Sneaker_Market_Study",
    panelTitle: "UK Custom Sneaker Market Study",
    docTitle: "The U.K. Custom Sneaker &amp; Sneaker-Personalisation Market",
    sub: "Sneaker retail and resale, one-of-one customisation and restoration, a full competitive teardown of the UK arena",
    prep: "Growth &amp; Digital Production, KNICKGASM UK (VI Consumer Ltd)"
  },
  Global: {
    file: "Global_RestOfWorld_Custom_Sneaker_Market_Study",
    panelTitle: "Global (Rest-of-World) Custom Sneaker Market Study",
    docTitle: "The Global (Rest-of-World) Custom Sneaker Market",
    sub: "Every region except the US, UK and India, a full teardown of where KNICKGASM wins vs is merely shipping",
    prep: "Growth &amp; Digital Production, KNICKGASM (Global / knickgasm.com)"
  },
  India: {
    file: "India_Custom_Sneaker_Market_Study",
    panelTitle: "India Sneaker Culture &amp; Customisation Market Study",
    docTitle: "The India Sneaker Culture &amp; Customisation Market",
    sub: "Sneaker retail, resale and streetwear D2C, plus the customisation and care layer, a full competitive teardown of the home market",
    prep: "Growth &amp; Digital Production, KNICKGASM (India / home market)"
  }
};

/* Category sub-tabs, in display order. Only categories with content render. */
var CATS = [
  ["overview", "Overview"],
  ["market", "Market &amp; demand"],
  ["competitors", "Competitors"],
  ["strategy", "Strategy &amp; white space"],
  ["regulatory", "Regulatory"],
  ["sources", "Sources"]
];
/* section-number -> category, per region */
var CATMAP = {
  US: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "competitors", 8: "market", 9: "strategy", 10: "regulatory", 11: "strategy", 12: "sources" },
  UK: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "competitors", 8: "market", 9: "strategy", 10: "regulatory", 11: "strategy", 12: "sources" },
  Global: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "competitors", 8: "competitors", 9: "market", 10: "strategy", 11: "regulatory", 12: "strategy", 13: "sources" },
  India: { 1: "overview", 2: "overview", 3: "market", 4: "market", 5: "competitors", 6: "competitors", 7: "competitors", 8: "market", 9: "strategy", 10: "regulatory", 11: "strategy", 12: "sources" }
};

var TAGNAME = { C: "Certain", L: "Likely" };
var TAGCSS = {
  C: "background:rgba(0,74,43,.12);color:#D0473E",
  L: "background:rgba(171,135,67,.20);color:#8a6a2f"
};
function tagChip(t) {
  return '<span style="display:inline-block;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;border-radius:6px;padding:1px 7px;margin-right:6px;vertical-align:middle;' + TAGCSS[t] + '">' + TAGNAME[t] + "</span>";
}
function applyTags(s, mode) {
  return String(s).replace(/\{([CL])\}/g, function (_, t) {
    return mode === "page" ? tagChip(t) : "<strong>[" + TAGNAME[t] + "]</strong> ";
  });
}

/* ---- renderers over the node model ---- */
function renderNodes(nodes, mode) {
  var out = [];
  nodes.forEach(function (n) {
    var type = n[0];
    if (type === "sec") {
      var num = n[1], title = n[2], sub = n[3];
      if (mode === "page") {
        out.push('<div class="mt-8"><div class="text-[11px] tracking-[.16em] uppercase font-bold lava-ink">Section ' + num + '</div><h2 class="font-head text-2xl md:text-3xl text-knickgasm-green mt-1">' + title + "</h2>" + (sub ? '<p class="text-sm mt-2 max-w-3xl" style="color:var(--soft);">' + sub + "</p>" : "") + "</div>");
      } else {
        out.push("<h2>" + num + ". " + title + "</h2>" + (sub ? "<p><em>" + sub + "</em></p>" : ""));
      }
    } else if (type === "sub") {
      if (mode === "page") out.push('<div class="text-[11px] uppercase tracking-[.06em] font-bold mt-4" style="color:var(--soft);">' + n[1] + "</div>");
      else out.push("<h3>" + n[1] + "</h3>");
    } else if (type === "head") {
      if (mode === "page") out.push('<div class="mt-8"><h2 class="font-head text-2xl md:text-3xl text-knickgasm-green mt-1">' + n[1] + "</h2>" + (n[2] ? '<p class="text-sm mt-2 max-w-3xl" style="color:var(--soft);">' + n[2] + "</p>" : "") + "</div>");
      else out.push("<h2>" + n[1] + "</h2>" + (n[2] ? "<p><em>" + n[2] + "</em></p>" : ""));
    } else if (type === "card") {
      var paras = n[1].map(function (p) { return "<p>" + applyTags(p, mode) + "</p>"; }).join("");
      if (mode === "page") out.push('<div class="card p-5"><div class="text-sm space-y-2" style="color:var(--knickgasm-ink);">' + paras + "</div></div>");
      else out.push(paras);
    } else if (type === "bul") {
      var items = n[1].map(function (it) { return "<li>" + applyTags(it, mode) + "</li>"; }).join("");
      if (mode === "page") out.push('<div class="card p-5"><ul class="space-y-2 text-sm" style="color:var(--knickgasm-ink);list-style:disc;padding-left:18px;">' + items + "</ul></div>");
      else out.push("<ul>" + items + "</ul>");
    } else if (type === "tbl") {
      var headers = n[1], rows = n[2], note = n[3];
      var thead = "<tr>" + headers.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr>";
      var tbody = rows.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + applyTags(c, mode) + "</td>"; }).join("") + "</tr>"; }).join("");
      if (mode === "page") {
        var mw = headers.length >= 10 ? (headers.length * 96) + "px" : (headers.length >= 6 ? "920px" : (headers.length >= 4 ? "760px" : "560px"));
        out.push('<div class="card overflow-x-auto"><table class="grid-tbl" style="min-width:' + mw + ';"><thead>' + thead + "</thead><tbody>" + tbody + "</tbody></table></div>" + (note ? '<p class="text-[12px] mt-1" style="color:var(--soft);">' + applyTags(note, mode) + "</p>" : ""));
      } else {
        out.push('<table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;width:100%;"><thead>' + thead + "</thead><tbody>" + tbody + "</tbody></table>" + (note ? "<p><em>" + applyTags(note, mode) + "</em></p>" : ""));
      }
    } else if (type === "cards") {
      var cols = n[1], list = n[2];
      if (mode === "page") {
        var cls = cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2";
        var cch = list.map(function (it) { return '<div class="card p-5"><h4 class="font-head text-knickgasm-green">' + it[0] + '</h4><p class="text-sm mt-1" style="color:var(--knickgasm-ink);">' + applyTags(it[1], mode) + "</p></div>"; }).join("");
        out.push('<div class="grid gap-4 ' + cls + '">' + cch + "</div>");
      } else {
        out.push(list.map(function (it) { return "<h3>" + it[0] + "</h3><p>" + applyTags(it[1], mode) + "</p>"; }).join(""));
      }
    }
  });
  return out.join("\n");
}

/* =====================================================================
   CONTENT, transcribed from the final PDFs (9 July 2026)
   ===================================================================== */
var REPORTS = {};

REPORTS.US = [
  ["sec", 1, "Scope, method &amp; how to read this"],
  ["card", [
    "{C} \"Sneakers\" is not one market, it is three businesses with different buyers, margins, supply chains and legal exposure. This report anchors on the single arena where they collide and where KNICKGASM actually competes in the US: the custom sneaker and sneaker-personalisation segment, meaning hand-painted one-of-one pairs built on original silhouettes, the brand-run configurators that sit above the mass market, and the care and restoration layer that keeps a pair alive.",
    "{L} This is the highest-leverage cut because KNICKGASM's US growth engine is a browsable catalog of finished one-of-one designs, not a commission queue. 436 live SKUs, 349 of them on the Nike Air Force 1."
  ]],
  ["bul", [
    "Market structure for US sneaker retail and resale (the base pairs), for customisation as a service, and for sneaker care, with the honest gaps in third-party sizing shown rather than filled with guesses.",
    "A tiered competitive landscape and deep-dive profiles across bespoke commission studios, brand configurators, the independent-seller long tail and the care and restoration set.",
    "Side-by-side comparison tables: price band, base sneaker, artwork depth, lead time and DTC mechanics.",
    "Consumer demand signals, the DTC playbook, the US legal frame (trademark, licensed characters, first-sale and advertising substantiation) and a white-space read."
  ]],
  ["card", ["{C} Method: KNICKGASM figures are read directly from the built catalogs (data/catalog/products_us.json in USD, products_uk.json in GBP), so every price, silhouette count and collection in this report matches the live storefront. Competitor pages were retrieved July 2026. Warning: third-party sizing for custom sneakers specifically does not exist in a form we can cite, because customisation is folded into general footwear or resale numbers. Rather than quote a number we cannot stand behind, those cells are marked as a data dependency."]],

  ["sec", 2, "Executive summary"],
  ["card", ["{C} The centre of gravity is not the shoe, it is the design. Buyers in this arena are not shopping for footwear they lack, they are buying a wearable object that says something specific about them: the series they love, the club they support, the game they play, the person they are marrying. The pair is the canvas; the artwork is the product."]],
  ["bul", [
    "<b>The arena splits three ways.</b> Bespoke commission studios at the top (POA, months-long), brand configurators in the middle (templated colour swaps, no artwork), and an enormous independent long tail at the bottom (cheap, inconsistent, often on non-original bases). Almost nobody sells a finished, browsable one-of-one at a listed price.",
    "<b>That gap is exactly where KNICKGASM sits.</b> 436 live SKUs, a median Air Force 1 custom at ~$156, a stated 10 to 15 day made-to-order window, and a base that is always a 100% original Nike, Jordan, Converse or Adidas pair.",
    "<b>Fandom is the demand engine, not footwear need.</b> The collections that carry the catalog are anime, cars, football and sport, gaming, wedding, pets, bling, Taylor Swift, celebrity, embroidery and the coffee-ART collection, which is hand-painted coffee imagery on AF1s, not a drink.",
    "<b>The playbook is unusually consistent.</b> Process video as the primary creative asset, the reveal as the hook, gifting and occasion as the seasonal spike, and care and restoration as the retention loop.",
    "<b>KNICKGASM's structural edge is under-exploited.</b> Most rivals are a single artist with a commission DM. KNICKGASM has a production studio, a catalog deep enough to browse, express shipping to 60+ countries, and organic wear by Samay Raina, Rohit Sharma and Shraddha Kapoor. No single-artist studio can copy that.",
    "<b>The legal line is the real battleground.</b> Growth here rests on licensed and trademarked imagery and on modifying branded product. Staying clean on originality, disclaimers and design provenance is both the risk and the trust differentiator."
  ]],

  ["sec", 3, "Market sizing (US, with global context)", "Where a defensible figure exists it is given; where it does not, the dependency is named rather than filled."],
  ["tbl", ["Segment", "What we can state", "Direction", "Source"], [
    ["KNICKGASM US catalog", "436 live SKUs; 349 Air Force 1, 35 Court Vision, 19 Converse, 9 Adidas, 8 Air Jordan, 3 denim jackets, 3 accessory SKUs", "Stable, added to per drop", "data/catalog/products_us.json"],
    ["KNICKGASM US price band", "$7.91 (rope laces) to $261.95 (top AF1); AF1 median ~$156", "Premium mid-market", "data/catalog/products_us.json"],
    ["KNICKGASM UK price band", "&pound;6.29 to &pound;208.37; AF1 median ~&pound;124", "Premium mid-market", "data/catalog/products_uk.json"],
    ["US sneaker resale (the base-pair pool)", "[DATA REQUIRED BEFORE LAUNCH: US sneaker resale market size, cited firm, US]", "Growing", "To be sourced"],
    ["US sneaker customisation as a service", "[DATA REQUIRED BEFORE LAUNCH: US custom-sneaker service market size, cited firm, US]", "No firm sizes this cleanly", "To be sourced"],
    ["US sneaker care and cleaning", "[DATA REQUIRED BEFORE LAUNCH: US sneaker care market size, cited firm, US]", "Growing with resale", "To be sourced"],
    ["Brand-run configurators", "Nike By You, Converse By You and Vans Customs exist at national scale; unit volumes are not published", "Mass, templated", "Brand sites"]
  ], "Custom sneakers are not broken out by the research firms; they are folded into footwear or resale. Do not quote a made-up number in external material, source it or leave the dependency visible."],
  ["sub", "3.1 The base pair, mature, branded, and not ours to invent"],
  ["card", ["{C} Every custom starts as somebody else's shoe. The Air Force 1 carries 349 of the 436 live SKUs because it is the flattest, most paintable, most culturally legible canvas in footwear. Court Vision and Converse are the accessible bases; Jordan and Adidas Samba are the grail bases. Sourcing 100% original pairs is a cost line and a trust asset at the same time, and it is the single clearest separator from the independent long tail."]],
  ["sub", "3.2 Customisation, where the value actually is"],
  ["card", ["{C} The paint is the margin. A Court Vision custom lists from $103.67 and an Air Jordan custom from $174.97, a spread that has almost nothing to do with the cost of the base and almost everything to do with what the design and the silhouette signal. This is why the category behaves like art commerce rather than footwear retail: the same base carries a 2.5x price range depending on the design on it."]],
  ["sub", "3.3 Care and restoration, the retention layer"],
  ["card", ["{L} A hand-painted pair raises an obvious question at checkout: will it survive being worn. Water and scratch resistant finishing is the answer at the point of sale, and rope laces, lace tags and care products are the answer afterwards. At $7.91 and $9.14 the accessories are not a revenue line, they are the reason a customer comes back to the site between grail purchases."]],

  ["sec", 4, "Category dynamics &amp; demand trends"],
  ["cards", 2, [
    ["Fandom is the buying trigger", "{C} The catalog is organised by what people love, not by what they need: anime, cars, football and sport, gaming, pets, celebrity, Taylor Swift. A customer arrives searching for a character or a club, not for a shoe. Collection pages, not silhouette pages, are the real front door."],
    ["Occasion and gifting", "{C} Wedding customs, birthday gifts and milestone pairs are the highest-intent, least price-sensitive demand in the category. They also carry a hard deadline, which makes the stated 10 to 15 day made-to-order window a conversion asset rather than a friction point, provided it is said early and kept."],
    ["The grail instinct", "{L} Collectors buy one-of-one for the same reason they buy limited releases: nobody else has it. Air Jordan and Adidas Samba customs are the grail tier of the catalog and the highest average order value, and they should be merchandised as pairs that will not exist twice, not as a more expensive shoe."],
    ["Originality is the trust arms race", "{C} The independent long tail is inconsistent on whether the base is genuine and whether the paint survives a month. Made on 100% original Nike, Jordan, Converse and Adidas, hand-painted by India's best artists, water and scratch resistant is the whole differentiation sentence, and every one of those clauses is checkable."],
    ["Process is the content", "{C} The strongest creative in the category is the build itself: masking, base coat, line work, the reveal. It is cheap to shoot, it proves the craft claim, and it converts better than a product still because it answers the durability doubt visually."],
    ["Made-to-order is the model", "{C} Nothing here ships from a shelf, which changes the entire operating rhythm: capacity planning by artist, honest lead times, and proactive in-progress updates. The category's most common complaint is silence during the wait, not the wait itself."]
  ]],

  ["sec", 5, "Competitive landscape, the tiers", "The arena around KNICKGASM's US business sorts into five tiers; KNICKGASM straddles two."],
  ["cards", 2, [
    ["Tier 1, Bespoke commission studios", "<b>The craft ceiling.</b> The Shoe Surgeon, Ceeze, Kickstradomis, Mache, Dank Customs, Freaker Sneaks. Full deconstructs, exotic leathers, artist name on the pair. Priced on application, delivered on a commission timeline. They set the cultural benchmark and cannot serve a customer who wants to buy today."],
    ["Tier 2, Brand-run configurators", "<b>The mass alternative.</b> Nike By You, Converse By You, Vans Customs, adidas personalisation. Enormous reach, official supply, and a fundamentally different product: template colour swaps, no artwork, no one-of-one. They educate the market that customisation exists and then leave the artwork demand unmet."],
    ["Tier 3, Independent hand-painters and marketplaces", "<b>KNICKGASM's direct fight for search and price.</b> Etsy sellers, Instagram artist accounts, local studios. Huge in aggregate, wildly variable on base originality, paint durability and delivery. This tier sets the price anchor buyers arrive with."],
    ["Tier 4, Sneaker retail and resale", "<b>The wallet competitor.</b> StockX, GOAT, and in India CrepDog Crew, VegNonVeg, Superkicks, Hypefly. They do not customise, but they compete for the same discretionary sneaker spend and they are where a customer goes when they want a known pair rather than a unique one."],
    ["Tier 5, Sneaker care, restoration and supplies", "<b>The adjacency.</b> Jason Markk, Crep Protect, Reshoevn8r on care; Angelus Direct on paints and finishers. Not competitors, but they own the after-purchase relationship KNICKGASM already sells into with rope laces, lace tags and care kits."]
  ]],
  ["card", ["{L} Where KNICKGASM sits: at the intersection of Tier 1 craft and Tier 3 accessibility. A genuinely hand-painted one-of-one, bought off a catalog at a listed price, on a guaranteed original base, delivered in 10 to 15 days. No pure-play in the arena occupies that overlap."]],

  ["sec", 6, "Competitor deep-dive profiles"],
  ["cards", 2, [
    ["KNICKGASM (anchor)", "India's largest sneaker customiser, selling worldwide. <b>Range:</b> 436 live SKUs across anime, cars, football and sport, gaming, wedding, pets, bling, Taylor Swift, celebrity, embroidery, crystal work and the coffee-ART collection, plus hand-painted denim jackets and accessories. <b>Bases:</b> 100% original Nike Air Force 1 (349 SKUs), Court Vision, Air Jordan, Converse, Adidas. <b>Price:</b> $103.67 to $261.95 for a custom pair, AF1 median ~$156; denim jackets $64.35; rope laces $7.91. <b>Build:</b> hand-painted in Mumbai, water and scratch resistant finish, 10 to 15 day made-to-order. <b>Reach:</b> express shipping to 60+ countries. <b>Strengths:</b> catalog depth no single artist can match; a real studio rather than one pair of hands; organic wear by Samay Raina, Rohit Sharma and Shraddha Kapoor; a full price ladder from under $10 to over $260. <b>Openings:</b> brand meaning spread across many fandoms is less single-minded than a named-artist studio; licensed-character designs need a standing IP posture."],
    ["The Shoe Surgeon", "The name that defines the ceiling. Full deconstruct-and-rebuild work, exotic leathers, high-profile collaborations, and a build-class business that teaches the craft. Priced per commission, never listed. <b>Openings:</b> nothing to browse and nothing to buy today; the waiting list is the product. A customer who wants a one-of-one this month cannot be served here, and that customer is KNICKGASM's."],
    ["Ceeze", "Artist-led commission studio with strong athlete and music placement. Hand-painted, one client at a time, priced on application. <b>Openings:</b> capacity is one artist's hands; no catalog, no repeatable price, no international express fulfilment."],
    ["Kickstradomis", "Long-running custom artist with a recognisable house style and deep sport ties. Commission-only. <b>Openings:</b> same structural ceiling as every single-artist studio, demand outruns capacity and there is no browsable inventory."],
    ["Nike By You", "The largest customisation funnel in the world, and the clearest proof that mainstream demand for personalisation exists. Official bases, brand-guaranteed supply, national reach. <b>Openings:</b> it is colour selection, not artwork. No character work, no illustration, no one-of-one. Customers who exhaust the configurator and still want a design are precisely KNICKGASM's inbound."],
    ["Converse By You / Vans Customs", "The accessible end of brand-run personalisation, on canvas silhouettes that take print well. <b>Openings:</b> templated prints and patches. KNICKGASM's Converse customs ($99.84 to $138.79) compete directly here on the same silhouette, and win on the fact that the design is painted rather than printed to a template."],
    ["Etsy and the independent long tail", "Thousands of independent sellers listing hand-painted AF1s. This is where the price anchor is set and where most first-time buyers of a custom start looking. <b>Openings:</b> the base is often unverified or not original, paint durability varies enormously, and delivery is unmanaged. The honest response is not a lower price, it is the originality and finish claim, stated plainly."],
    ["Sneaker retail and resale (Tier 4)", "StockX and GOAT globally; CrepDog Crew, VegNonVeg, Superkicks and Hypefly in India. They own the known-pair purchase and the authentication trust cue. <b>Openings:</b> none of them make anything unique. They are the alternative use of the same budget, which means KNICKGASM's creative has to argue for uniqueness over hype, not for cheapness."]
  ]],

  ["sec", 7, "Side-by-side comparison tables", "KNICKGASM figures are exact from the built catalog. Competitor figures are bands or POA, never invented."],
  ["sub", "7.1 The custom arena, price, base, artwork depth"],
  ["tbl", ["Player", "Price band", "Base sneaker", "Artwork depth", "Lead time"], [
    ["<b>KNICKGASM</b>", "$99.84 to $261.95 (AF1 median ~$156)", "100% original Nike, Jordan, Converse, Adidas", "Full hand-painted illustration, embroidery, crystal work", "10 to 15 days"],
    ["The Shoe Surgeon", "POA (commission)", "Client-supplied or sourced", "Full deconstruct and rebuild", "Commission-length"],
    ["Ceeze / Kickstradomis", "POA (commission)", "Client-supplied", "Hand-painted, artist-signed", "Commission-length"],
    ["Nike By You", "Brand list price", "Nike, official", "Colour swaps only, no artwork", "Brand-stated build window"],
    ["Converse By You / Vans Customs", "Brand list price", "Converse, Vans, official", "Templated prints and patches", "Brand-stated build window"],
    ["Etsy independents", "Long tail, seller-set", "Varies, originality often unverified", "Hand-painted, quality varies widely", "Seller-stated"],
    ["StockX / GOAT (context)", "Market price", "Original, authenticated", "None, retail pairs", "Ships from stock"]
  ]],
  ["sub", "7.2 Positioning &amp; hero claim"],
  ["tbl", ["Player", "Positioning", "Hero claim (paraphrased)"], [
    ["<b>KNICKGASM</b>", "One-of-one you can actually buy", "Hand-painted on 100% original pairs, water and scratch resistant, shipped worldwide"],
    ["The Shoe Surgeon", "The craft ceiling", "Bespoke footwear as luxury object"],
    ["Ceeze", "The artist's hand", "A pair painted personally, for you"],
    ["Nike By You", "Make it yours", "Pick your colours on an icon"],
    ["Vans Customs", "Express yourself", "Prints and patches on your Vans"],
    ["Etsy independents", "Affordable custom", "A painted pair, cheaper"],
    ["StockX / GOAT", "The known grail", "Verified pairs, market pricing"]
  ]],
  ["sub", "7.3 DTC &amp; commercial mechanics"],
  ["tbl", ["Player", "How you buy", "Lead time", "Acquisition offer", "Channels"], [
    ["<b>KNICKGASM</b>", "Browse a finished-design catalog, buy at a listed price", "10 to 15 days", "Accessory attach (rope laces, lace tags), collection bundles", "DTC + express shipping to 60+ countries"],
    ["Bespoke studios", "Enquire, quote, queue", "Commission-length", "None, demand exceeds capacity", "DM and enquiry form"],
    ["Nike By You", "Configurator", "Brand-stated", "Member perks", "Brand site and app"],
    ["Vans / Converse", "Configurator", "Brand-stated", "Seasonal", "Brand site"],
    ["Etsy independents", "Marketplace listing", "Seller-stated", "Coupon-led", "Marketplace"],
    ["StockX / GOAT", "Marketplace bid or buy", "Ships from stock", "First-order codes", "App and web"]
  ]],
  ["sub", "7.4 Originality and finish, who can actually claim what"],
  ["tbl", ["Player", "Base originality", "Finish durability posture"], [
    ["<b>KNICKGASM</b>", "100% original branded pairs, stated on every product", "Water and scratch resistant paint system, stated at point of sale"],
    ["Bespoke studios", "Client-supplied or sourced originals", "Craft-led, case by case"],
    ["Nike By You / Vans / Converse", "Official, by definition", "Factory finish, but no artwork to protect"],
    ["Etsy independents", "Varies, frequently unverified", "Varies, the category's most common complaint"],
    ["StockX / GOAT", "Authenticated originals", "n/a, unaltered retail pairs"]
  ], "Strategic read: originality plus finish durability is the only claim pair that separates KNICKGASM from the long tail and from the configurators at the same time. Say both, every time, and never soften either."],

  ["sec", 8, "Consumer demand signals"],
  ["bul", [
    "<b>Who buys:</b> the collections tell you. Anime, gaming and football designs skew younger and self-purchase; wedding, pets and celebrity designs skew gift and occasion; bling and crystal work skew statement and event.",
    "<b>What they search:</b> character, club, game and artist names far more than silhouette names. Collection and design pages carry discovery; the AF1 is what they find when they get there.",
    "<b>What they pay for:</b> uniqueness first, then proof it will last. The originality of the base and the water and scratch resistant finish are the two objections that decide the sale.",
    "<b>Where the seasonality is:</b> gifting peaks and wedding season. Both carry hard dates, which makes lead-time honesty a revenue decision, not a service one.",
    "<b>Top complaint in the category:</b> not the wait, the silence during it. Proactive in-progress updates on a made-to-order pair are the cheapest retention lever available."
  ]],

  ["sec", 9, "The DTC playbook, what the winners do"],
  ["bul", [
    "<b>Sell the design, not the shoe.</b> Merchandise by fandom and occasion. The customer arrives for a character or a moment; the silhouette is a spec they check second.",
    "<b>Answer the durability objection in the creative.</b> Show the paint being applied and the finish being sealed. It is the only thing that beats a cheaper listing on a marketplace.",
    "<b>State the lead time everywhere.</b> On the ad, on the collection page, on the product page, in the confirmation email. 10 to 15 days accepted up front converts; 10 to 15 days discovered at checkout abandons.",
    "<b>Lead the range with the accessible tier.</b> Converse and Court Vision customs bring a first-time buyer in; Air Force 1 and Jordan carry the second purchase and the gift.",
    "<b>Attach the accessories by default.</b> Rope laces at $7.91 and lace tags at $9.14 lift basket value without discounting the pair.",
    "<b>Use organic proof, not manufactured proof.</b> Worn by Samay Raina, Rohit Sharma and Shraddha Kapoor is a real, checkable trust cue. Do not pad it with invented review counts.",
    "<b>Own the after-purchase.</b> Care guidance, restoration and re-paint conversations are how a one-of-one purchase becomes a relationship rather than a transaction."
  ]],

  ["sec", 10, "US legal &amp; compliance frame (the real battleground)"],
  ["card", ["{C} This category grows on other people's intellectual property and other people's branded product. That is both its biggest risk and, handled well, a genuine trust position."]],
  ["cards", 3, [
    ["Trademark and the modified pair", "Customising and reselling a lawfully purchased branded pair sits in a contested space. The defensible posture is to be explicit that a pair is an original brand product that has been hand-painted by KNICKGASM, to never imply a brand partnership or endorsement, and to keep the brand's own marks out of KNICKGASM's own branding, packaging and ad creative."],
    ["Licensed characters and likeness", "Anime, gaming, film, club crest and celebrity designs are the demand engine and the exposure. Keep a standing register of which designs are original artwork, which are fan interpretation, and which would need a licence, and be prepared to retire a design quickly rather than defend it. Likeness-based designs carry the sharpest risk."],
    ["Advertising substantiation", "The FTC expects claims to be substantiated. Everything KNICKGASM says can be: 100% original bases, hand-painted, water and scratch resistant, express shipping to 60+ countries, worn organically by named public figures. What must never appear is an invented discount, a fabricated review count, or a durability claim stronger than the finish actually delivers."]
  ]],
  ["card", ["{L} Net: the safest growth path is explicit originality language, no implied brand affiliation, a maintained design-provenance register, and claims that are all independently checkable. That posture is also the cleanest differentiator against a long tail that does none of it."]],

  ["sec", 11, "Strategic implications &amp; white space"],
  ["sub", "Where the open space is"],
  ["cards", 2, [
    ["Browsable one-of-one at a listed price", "Every bespoke studio makes you enquire. Every configurator refuses to make artwork. Nobody else lets a customer see 436 finished one-of-one designs and buy one today. That is the position, lead with it rather than with craft language everyone claims."],
    ["Fandom depth as a moat", "A single artist paints what they like. A studio with a catalog can cover anime, football, gaming, cars, pets, wedding and celebrity at once and let search find it. Collection depth is the asset; keep expanding it deliberately rather than opportunistically."],
    ["Occasion and gifting", "Wedding and gift customs are high-intent, deadline-driven and under-served by a category that mostly cannot commit to a date. A guaranteed-by window is a product, not a policy."],
    ["Care, restoration and the second life", "The accessories and care layer turns a one-off grail purchase into a repeatable relationship, and it directly answers the durability objection that stops first purchases. Almost no custom studio does this at all."]
  ]],
  ["sub", "Where to be careful"],
  ["bul", [
    "<b>Design provenance discipline.</b> Licensed and likeness-based designs are the category norm and the highest-risk element. Keep the register current and retire quickly.",
    "<b>Lead-time integrity.</b> The 10 to 15 day window is a promise the whole brand rests on. Missing it on a gift or a wedding pair costs more than the order.",
    "<b>Do not out-cheap, out-prove.</b> The marketplace long tail will always be cheaper. Compete on original bases, a durable finish and a studio that answers, never on price."
  ]],

  ["sec", 12, "Sources &amp; notes"],
  ["card", ["Primary sources: the built KNICKGASM catalogs (data/catalog/products_us.json, products_uk.json) for every price, silhouette count and collection cited here; knickgasm.com product and collection pages; and competitor pages retrieved July 2026 (theshoesurgeon.com, ceeze.com, kickstradomis.com, nike.com, converse.com, vans.com, etsy.com, stockx.com, goat.com, jasonmarkk.com, crepprotect.com, angelusdirect.com). Third-party market sizing for custom sneakers specifically is not available in citable form and is marked as a data dependency rather than estimated. Confidence tags reflect source strength."]]
];

REPORTS.UK = [
  ["sec", 1, "Scope, method &amp; how to read this"],
  ["card", ["{C} \"Sneakers\" is not one market, it is several with different buyers, margins and legal exposure. This report anchors on the arena where they collide and where KNICKGASM actually competes in the UK: hand-painted one-of-one customisation on original silhouettes, the brand-run configurators above it, the independent-artist long tail below it, and the care and restoration layer beside it."]],
  ["bul", [
    "Market structure for UK sneaker retail and resale, for customisation as a service and for sneaker care, with the gaps in third-party sizing shown rather than filled.",
    "A five-tier competitive landscape plus deep-dive profiles across bespoke studios, configurators, independent artists and the UK care set.",
    "Comparison tables: price band, base sneaker, artwork depth, lead time and DTC mechanics, all in GBP as sold.",
    "Consumer demand signals, the UK DTC playbook, the ASA/CAP advertising frame plus UK trademark and import considerations, and a white-space read."
  ]],
  ["card", ["{C} Method: KNICKGASM UK figures are read directly from data/catalog/products_uk.json in GBP, never converted from USD. Competitor pages were retrieved July 2026. Where a figure could not be read off an official page it is marked, not estimated."]],

  ["sec", 2, "Executive summary"],
  ["card", ["{C} The UK arena is bifurcated. There is a large, mature market for buying known pairs, which KNICKGASM does not compete in and should not, and a much smaller but fast-moving market for making a pair mean something, which is where every pound of KNICKGASM's UK opportunity sits."]],
  ["bul", [
    "<b>Price is not the UK battleground, proof is.</b> KNICKGASM's UK customs run &pound;79.42 to &pound;208.37 with an AF1 median around &pound;124. That is comfortably above a marketplace listing and comfortably below a commission, and the gap is justified by originality and finish, not by discounting.",
    "<b>The configurators have already educated the market.</b> Nike By You, Converse By You and Vans Customs have taught UK buyers that personalisation exists. They have also taught them it means colour swaps. The customer who wants an actual illustration is left unserved, and that customer is the entire opportunity.",
    "<b>The independent-artist tier is the price anchor.</b> UK buyers arrive having seen cheaper painted pairs online. The answer is the base and the finish, said plainly and shown in the creative, never a discount.",
    "<b>Shipping is a strength, not a caveat.</b> Express worldwide delivery to 60+ countries from Mumbai puts a UK order on the same footing as a domestic one, provided the 10 to 15 day made-to-order window is stated up front.",
    "<b>KNICKGASM's copy-proof edges are three.</b> A browsable catalog of 436 finished one-of-one designs; a guaranteed 100% original base on every pair; and a water and scratch resistant finish stated at the point of sale.",
    "<b>Claims are the battleground.</b> The ASA/CAP code is materially stricter than US practice on substantiation and on implied endorsement. Any suggestion of a Nike or Adidas partnership, and any invented discount or review count, is the most likely trigger for a ruling."
  ]],

  ["sec", 3, "Market sizing (UK, with global context)", "Defensible figures only; dependencies named where sizing does not exist in citable form."],
  ["tbl", ["Segment", "What we can state", "Direction", "Source"], [
    ["KNICKGASM UK catalog", "436 live SKUs, identical range to US, priced in GBP", "Stable, added to per drop", "data/catalog/products_uk.json"],
    ["KNICKGASM UK custom price band", "&pound;79.42 to &pound;208.37; AF1 median ~&pound;124", "Premium mid-market", "data/catalog/products_uk.json"],
    ["KNICKGASM UK entry points", "Rope laces &pound;6.29, lace tags &pound;7.27, denim jackets &pound;51.19", "Basket-builders", "data/catalog/products_uk.json"],
    ["UK sneaker resale", "[DATA REQUIRED BEFORE LAUNCH: UK sneaker resale market size, cited firm, UK]", "Growing", "To be sourced"],
    ["UK customisation as a service", "[DATA REQUIRED BEFORE LAUNCH: UK custom-sneaker service market size, cited firm, UK]", "Not sized by any firm", "To be sourced"],
    ["UK sneaker care", "[DATA REQUIRED BEFORE LAUNCH: UK sneaker care market size, cited firm, UK]", "Growing with resale", "To be sourced"]
  ], "As in the US, customisation is folded into general footwear numbers. Leave the dependency visible rather than quoting an unsourced figure in external material."],
  ["sub", "3.1 The base pair in the UK"],
  ["card", ["{C} The same 349 Air Force 1 designs carry the UK catalog, at &pound;91.85 to &pound;208.37. Converse customs from &pound;79.42 are the cheapest full custom pair available in the UK range and the natural acquisition SKU; Air Jordan customs at &pound;139.18 to &pound;180.00 are the grail tier."]],
  ["sub", "3.2 Customisation, the real battleground"],
  ["card", ["{C} UK demand for personalisation is proven by the scale of the brand configurators. What is not served is artwork. A buyer who has used Nike By You and still wants a character, a crest or a portrait on the panel has, in practice, three options: commission a UK artist and wait, gamble on a marketplace listing, or buy a finished KNICKGASM design at a listed price. Only the third is a normal e-commerce experience."]],
  ["sub", "3.3 Care and restoration, a mature UK adjacency"],
  ["card", ["{L} The UK has a well-developed sneaker care market, which is useful rather than threatening: it means UK buyers already accept that a good pair needs looking after. That makes the water and scratch resistant claim legible and makes rope laces, lace tags and care guidance an easy attach."]],

  ["sec", 4, "Category dynamics &amp; demand trends"],
  ["cards", 2, [
    ["Football and fandom lead in the UK", "{C} Club, player and match-day designs land harder in the UK than almost anywhere, alongside anime and gaming. Merchandise the football and sport collection as a UK-first entry point rather than treating the catalog as region-neutral."],
    ["The configurator ceiling", "{C} Brand configurators convert enormous volume and stop at colour. They are the best possible top of funnel for KNICKGASM, because they create the appetite and then refuse to satisfy it. Creative should speak directly to the person who has already tried one."],
    ["Occasion buying", "{C} Wedding, birthday and milestone pairs are the highest-intent UK demand and the least price-sensitive, but they come with a hard date. The 10 to 15 day window plus express shipping has to be stated as a delivery promise, with an honest cut-off."],
    ["The marketplace price anchor", "{C} Cheaper painted pairs are one search away. Competing on price loses; competing on the base and the finish wins, and both are demonstrable on camera."],
    ["Care culture is already established", "{L} UK buyers are used to cleaning and protecting sneakers. That lowers the education cost on the durability question and makes the accessories a natural second purchase."],
    ["Advertising scrutiny is higher", "{C} ASA/CAP requires substantiation and forbids implied endorsement. Everything KNICKGASM claims is substantiable; the discipline is to never let creative drift into implying a brand partnership or into invented offers."]
  ]],

  ["sec", 5, "Competitive landscape, the tiers", "The UK arena sorts into five tiers; KNICKGASM straddles two."],
  ["cards", 2, [
    ["Tier 1, Bespoke commission studios", "<b>The craft ceiling.</b> UK and international commission artists working one client at a time, priced on application. They define the top of the craft conversation and cannot serve volume or deadlines."],
    ["Tier 2, Brand-run configurators", "<b>The mass alternative.</b> Nike By You, Converse By You, Vans Customs. Huge UK reach, official supply, colour swaps only. The best free education KNICKGASM's category gets."],
    ["Tier 3, Independent artists and marketplaces", "<b>The price anchor.</b> Etsy sellers and Instagram artist accounts shipping into the UK. Variable base originality and paint durability; this is where the objection KNICKGASM has to answer is created."],
    ["Tier 4, UK sneaker retail and resale", "<b>The wallet competitor.</b> StockX, GOAT and the UK boutique scene. They own the known-pair purchase and the authentication trust cue; they make nothing unique."],
    ["Tier 5, Care, restoration and supplies", "<b>The adjacency.</b> Crep Protect, Jason Markk, Reshoevn8r, Angelus. Not competitors, but they own the after-purchase relationship and they have already normalised paying to protect a pair."]
  ]],
  ["card", ["{L} Where KNICKGASM sits: Tier 1 craft delivered with Tier 3 accessibility, on a guaranteed original base, at a listed GBP price, in 10 to 15 days. No UK pure-play occupies that overlap."]],

  ["sec", 6, "Competitor deep-dive profiles"],
  ["cards", 2, [
    ["KNICKGASM UK (anchor)", "The same 436-SKU catalog, priced in GBP and shipped express from Mumbai. <b>Range:</b> anime, cars, football and sport, gaming, wedding, pets, bling, Taylor Swift, celebrity, embroidery, crystal work, coffee-ART. <b>Price:</b> customs &pound;79.42 to &pound;208.37, AF1 median ~&pound;124; denim jackets &pound;51.19; rope laces &pound;6.29. <b>Build:</b> 100% original bases, hand-painted, water and scratch resistant, 10 to 15 day made-to-order. <b>Strengths:</b> catalog depth, guaranteed original base, a stated finish claim, and express delivery to 60+ countries. <b>Openings:</b> a UK buyer needs the delivery promise made explicitly; and the football and sport collection is under-merchandised for this market relative to its likely pull."],
    ["Nike By You (UK)", "The dominant personalisation funnel in the market. Official Nike bases, brand trust, national reach, and a configurator that stops at colour. <b>Openings:</b> no artwork of any kind. Every customer who finishes a build and still wants a design on the panel is KNICKGASM's inbound."],
    ["Converse By You / Vans Customs (UK)", "The accessible configurator tier on canvas silhouettes. Templated prints and patches. <b>Openings:</b> KNICKGASM's Converse customs from &pound;79.42 sit on the same silhouette and offer painted artwork rather than a template, at a comparable premium-but-not-bespoke price."],
    ["UK commission artists", "Independent studios taking one commission at a time, priced on application, often with long queues. <b>Openings:</b> no catalog, no listed price, no committed date. They win the customer who wants their own idea painted; they cannot win the customer who wants a finished design now."],
    ["Etsy and international independents", "Painted pairs listed into the UK from everywhere, at the bottom of the price range. <b>Openings:</b> unverified bases, unmanaged delivery, and no durability claim anyone stands behind. This is the tier the originality and finish message exists to answer."],
    ["StockX / GOAT (UK)", "Where a UK buyer goes for a known grail with an authentication guarantee. <b>Openings:</b> nothing unique is ever produced. KNICKGASM's argument against them is uniqueness versus hype, and it works best on gifting and occasion demand."],
    ["Crep Protect", "UK-founded sneaker care, widely stocked, and the reason UK buyers already accept protecting a pair as normal. <b>Read:</b> not a competitor. It validates the durability conversation and makes KNICKGASM's care accessories an easier attach."],
    ["Angelus Direct (supply side)", "The paints and finishers most hand-painters use, including at the bottom of the market. <b>Read:</b> supply-side, but a useful reminder that materials alone are not a moat. The moat is the studio, the base sourcing and the finishing process."]
  ]],

  ["sec", 7, "Side-by-side comparison tables", "GBP as sold, never converted. KNICKGASM figures exact from the built UK catalog."],
  ["sub", "7.1 The UK custom arena, price, base, artwork depth"],
  ["tbl", ["Player", "Price band", "Base sneaker", "Artwork depth", "Lead time"], [
    ["<b>KNICKGASM UK</b>", "&pound;79.42 to &pound;208.37 (AF1 median ~&pound;124)", "100% original Nike, Jordan, Converse, Adidas", "Full hand-painted illustration, embroidery, crystal work", "10 to 15 days"],
    ["UK commission artists", "POA", "Client-supplied", "Hand-painted, artist-signed", "Commission-length"],
    ["Nike By You", "Brand list price", "Nike, official", "Colour swaps only", "Brand-stated"],
    ["Converse By You / Vans Customs", "Brand list price", "Converse, Vans, official", "Templated prints and patches", "Brand-stated"],
    ["Etsy / international independents", "Long tail, seller-set", "Varies, often unverified", "Hand-painted, quality varies", "Seller-stated"],
    ["StockX / GOAT (context)", "Market price", "Authenticated originals", "None", "Ships from stock"]
  ]],
  ["sub", "7.2 Positioning &amp; hero claim"],
  ["tbl", ["Player", "Positioning", "Hero claim (paraphrased)"], [
    ["<b>KNICKGASM UK</b>", "One-of-one you can actually buy", "Hand-painted on 100% original pairs, water and scratch resistant, delivered express"],
    ["Nike By You", "Make it yours", "Pick your colours on an icon"],
    ["Vans Customs", "Express yourself", "Prints and patches on your Vans"],
    ["UK commission artists", "The artist's hand", "Your idea, painted personally"],
    ["Etsy independents", "Affordable custom", "A painted pair, cheaper"],
    ["StockX / GOAT", "The known grail", "Verified pairs, market pricing"]
  ]],
  ["sub", "7.3 DTC &amp; commercial mechanics"],
  ["tbl", ["Player", "How you buy", "Lead time", "Acquisition offer", "Channels"], [
    ["<b>KNICKGASM UK</b>", "Browse finished designs, buy at a listed GBP price", "10 to 15 days", "Accessory attach, collection bundles", "DTC + express worldwide"],
    ["Nike By You", "Configurator", "Brand-stated", "Member perks", "Brand site and app"],
    ["Converse / Vans", "Configurator", "Brand-stated", "Seasonal", "Brand site"],
    ["UK commission artists", "Enquire and queue", "Commission-length", "None", "DM and enquiry form"],
    ["Etsy independents", "Marketplace listing", "Seller-stated", "Coupon-led", "Marketplace"],
    ["StockX / GOAT", "Marketplace bid or buy", "From stock", "First-order codes", "App and web"]
  ]],
  ["sub", "7.4 Originality and finish, who can actually claim what"],
  ["tbl", ["Player", "Base originality", "Finish durability posture"], [
    ["<b>KNICKGASM UK</b>", "100% original branded pairs, stated on every product", "Water and scratch resistant, stated at point of sale"],
    ["Nike By You / Vans / Converse", "Official by definition", "Factory finish, no artwork to protect"],
    ["UK commission artists", "Client-supplied originals", "Craft-led, case by case"],
    ["Etsy / independents", "Varies, frequently unverified", "Varies, the category's most common complaint"],
    ["StockX / GOAT", "Authenticated originals", "n/a, unaltered pairs"]
  ], "The strategic crux: in the UK the differentiation cannot be price and cannot be craft language, because everyone claims craft. It has to be the two checkable facts, an original base and a durable finish."],

  ["sec", 8, "Consumer demand signals"],
  ["bul", [
    "<b>Football and sport designs</b> should be treated as a UK-first entry point rather than one collection among many.",
    "<b>Configurator graduates</b> are the highest-quality inbound: they have already decided personalisation is worth paying for and have already hit its ceiling.",
    "<b>Occasion demand</b> (wedding, milestone, gifting) is high-intent and deadline-bound; the delivery promise is the conversion mechanic.",
    "<b>The durability objection</b> is the single most common reason a UK custom purchase stalls, and it is answered visually, not verbally.",
    "<b>Silence during the build</b> is the top service complaint in made-to-order categories; in-progress updates are cheap retention."
  ]],

  ["sec", 9, "The UK DTC playbook, what the winners do"],
  ["bul", [
    "<b>Speak to the configurator graduate.</b> Creative that starts from you have already picked your colours, now put something on them converts a warm, pre-educated audience.",
    "<b>Make the delivery promise explicit.</b> 10 to 15 days made-to-order plus express shipping, with an honest cut-off for dated occasions, stated before checkout.",
    "<b>Show the paint, not just the pair.</b> Process and finish footage is what beats the cheaper marketplace listing.",
    "<b>Lead acquisition with Converse and Court Vision customs.</b> The lowest-friction full custom in GBP, with Air Force 1 and Jordan carrying the second purchase.",
    "<b>Attach rope laces and lace tags by default</b> at &pound;6.29 and &pound;7.27 rather than discounting the pair.",
    "<b>Keep every claim ASA/CAP-clean.</b> No implied brand partnership, no invented offer, no fabricated review count. Everything KNICKGASM says is already substantiable, keep it that way."
  ]],

  ["sec", 10, "UK legal &amp; advertising frame (the compliance battleground)"],
  ["card", ["{C} The UK is materially stricter than US practice on advertising substantiation, and getting this wrong is the most likely cause of a forced takedown or a public ruling."]],
  ["bul", [
    "<b>ASA/CAP:</b> claims must be substantiated and must not mislead. Made on 100% original pairs, hand-painted, water and scratch resistant, shipped to 60+ countries and worn organically by named public figures are all substantiable. Invented discounts, review counts and percentages are not, and must never appear.",
    "<b>Implied endorsement:</b> nothing in creative, packaging or naming may suggest a partnership with Nike, Jordan, Converse or Adidas. Describe the pair as an original brand product hand-painted by KNICKGASM, and keep third-party marks out of KNICKGASM's own branding.",
    "<b>Intellectual property:</b> character, club-crest, film and likeness designs carry real exposure in the UK. Maintain the design-provenance register, distinguish original artwork from fan interpretation, and retire rather than defend.",
    "<b>Import and delivery:</b> UK orders ship internationally, so duties, delivery windows and returns handling on a made-to-order item must be stated clearly at the point of sale, not discovered afterwards."
  ]],
  ["card", ["{L} Turned around, compliance is a moat: the custom sneaker brand that will not get an ASA ruling, and can prove every claim it makes, is a genuine trust position in a category full of unverifiable listings."]],

  ["sec", 11, "Strategic implications &amp; white space"],
  ["card", ["{L} Stop competing on being a custom. Everyone in the arena is a custom. Compete on the two things almost nobody else can evidence."]],
  ["bul", [
    "<b>A guaranteed original base,</b> the claim the marketplace long tail cannot make.",
    "<b>A water and scratch resistant finish,</b> stated at the point of sale and shown in the creative.",
    "<b>A browsable catalog of 436 finished one-of-one designs,</b> an identity no commission studio can claim.",
    "<b>Football and sport as the UK entry collection,</b> currently under-merchandised for this market.",
    "<b>Occasion and gifting with a committed date,</b> the under-served, high-intent, low-price-sensitivity lane."
  ]],

  ["sec", 12, "Sources &amp; notes"],
  ["card", ["Primary sources: the built KNICKGASM UK catalog (data/catalog/products_uk.json) for every GBP price, silhouette count and collection cited here; knickgasm.com product and collection pages; and competitor pages retrieved July 2026 (nike.com, converse.com, vans.com, etsy.com, stockx.com, goat.com, crepprotect.com, jasonmarkk.com, angelusdirect.com). Third-party sizing for UK sneaker customisation is not available in citable form and is marked as a data dependency rather than estimated. No competitor copy is reproduced."]]
];

REPORTS.Global = [
  ["sec", 1, "Scope, method &amp; how to read this"],
  ["card", [
    "{C} \"Sneakers\" is not one market, it is several with different buyers, duty regimes and legal exposure. This report anchors on the arena where they collide: hand-painted one-of-one customisation on original silhouettes, the brand configurators above it, the independent long tail below it, and sneaker care beside it.",
    "{C} Central framing: Global ex-US/UK/India is not one market but a dozen unlike ones. This study organises them by a single decision, where KNICKGASM can realistically win versus where it is merely shipping. KNICKGASM already offers express delivery to 60+ countries."
  ]],
  ["bul", [
    "Structural read of the rest-of-world custom-sneaker opportunity, with the gaps in third-party sizing named rather than filled.",
    "A five-tier competitive landscape, a global footprint matrix (which player is actually present in which region) and deep-dive profiles.",
    "Region-by-region analysis of EU-ex-UK, Canada, Australia/NZ, the GCC, East Asia and the long tail, each with a winnable or shipping-only verdict.",
    "Consumer signals, the global go-to-market playbook, the customs-and-IP patchwork, and a white-space read."
  ]],

  ["sec", 2, "Executive summary"],
  ["card", ["{C} Outside the US, UK and India, KNICKGASM rarely meets a like-for-like competitor. It meets brand configurators everywhere, marketplace listings everywhere, and a handful of local artists in each city. What it almost never meets is another studio shipping a browsable catalog of finished one-of-one pairs internationally. Rest-of-world is therefore a distribution and trust problem, not a competitive one."]],
  ["bul", [
    "<b>The competitive set is thin but the friction is real.</b> Duties, delivery windows, sizing conventions and returns on a made-to-order item do more to lose a rest-of-world sale than any rival does.",
    "<b>Concentration beats coverage.</b> Shipping to 60+ countries is an operational fact, not a strategy. Four markets fully served will outperform sixty lightly served.",
    "<b>The winnable four.</b> EU-ex-UK, Canada, Australia and New Zealand, and the GCC are high-income, streetwear-literate and gifting-heavy. Fund these.",
    "<b>The shipping-only set.</b> Much of East Asia has dense local customisation scenes and strong domestic sneaker culture; much of LatAm and Africa carries duty and delivery economics that break the unit. Fulfil demand, do not buy it.",
    "<b>Fandom translates, references do not.</b> Anime, gaming and football designs travel almost everywhere. Region-specific celebrity and cricket references do not. Merchandise by what travels.",
    "<b>Gifting is the universal high-margin lane.</b> A one-of-one pair is an unusually good gift precisely because it cannot be duplicated, and gifting demand is the least price-sensitive demand in every market studied."
  ]],

  ["sec", 3, "Market sizing (global, rest-of-world context)", "Defensible figures only; dependencies named where citable sizing does not exist."],
  ["tbl", ["Segment", "What we can state", "Direction", "Source"], [
    ["KNICKGASM international reach", "Express shipping to 60+ countries", "Operationally live", "knickgasm.com"],
    ["KNICKGASM global range", "436 live SKUs, one catalog served in USD and GBP", "Stable, added to per drop", "data/catalog/"],
    ["Global custom-sneaker services", "[DATA REQUIRED BEFORE LAUNCH: global custom-sneaker service market size, cited firm, Global]", "Not sized by any firm", "To be sourced"],
    ["Global sneaker resale", "[DATA REQUIRED BEFORE LAUNCH: global sneaker resale market size, cited firm, Global]", "Growing", "To be sourced"],
    ["Regional demand ranking", "[DATA REQUIRED BEFORE LAUNCH: per-country order and revenue split, KNICKGASM, Global]", "Available from own order data", "Internal analytics"],
    ["Brand configurator reach", "Nike By You, Converse By You, Vans Customs operate across most affluent markets", "Mass, templated", "Brand sites"]
  ], "The most useful rest-of-world sizing KNICKGASM has is its own order data by country. Prioritise wiring that in over buying a third-party report that will not break out customisation anyway."],
  ["sub", "3.1 Europe, the biggest rest-of-world pool"],
  ["card", ["{C} Western Europe is high-income, streetwear-literate and football-obsessed, which lines up directly with the deepest collections in the catalog. It is also the region where duty and returns expectations are most formalised, so the delivery and returns promise has to be explicit."]],
  ["sub", "3.2 Asia-Pacific, split sharply"],
  ["card", ["{L} Australia and New Zealand are straightforwardly winnable: English-language, high-income, gifting-heavy and streetwear-native. East Asia is a different proposition, with dense domestic sneaker cultures and local customisation scenes that are closer to the customer than an inbound shipment can be."]],
  ["sub", "3.3 Middle East, small base, high margin, gifting-led"],
  ["card", ["{L} The GCC is not large in unit terms but it is exceptionally strong on premium gifting and on statement pieces, which maps onto the bling, crystal-work and celebrity collections and onto the grail tier of the catalog."]],

  ["sec", 4, "Category dynamics &amp; demand trends"],
  ["cards", 2, [
    ["Configurators are the global top of funnel", "{C} Nike By You and its peers operate in nearly every affluent market and everywhere teach the same lesson: personalisation is desirable and colour swaps are its limit. That is free, global, permanent demand generation for artwork-led customisation."],
    ["Local artists are close, but small", "{C} Almost every major city has independent customisers. They win on proximity and on painting a customer's own idea. They lose on catalog, on capacity and on any kind of delivery commitment, which is exactly the gap an international studio fills."],
    ["Fandom is the portable asset", "{L} Anime, gaming and football designs need no localisation. Region-specific celebrity references do. Build rest-of-world merchandising around the collections that travel and stop treating the catalog as uniform."],
    ["Gifting is the universal lane", "{L} A one-of-one pair is a strong gift in every market studied, and gifting demand is the least price-sensitive and highest-margin demand available. It is also the most deadline-sensitive, which makes the delivery promise load-bearing."],
    ["Duty and delivery decide the unit", "{C} On an international made-to-order order, duties and delivery windows are the difference between a good margin and a refund. State them, do not discover them."],
    ["IP exposure varies by market", "{C} Character, crest and likeness designs carry different risk in different jurisdictions. One catalog, many legal regimes, means the design-provenance register has to be regional, not global."]
  ]],

  ["sec", 5, "Competitive landscape, the tiers", "The rest-of-world arena sorts into five tiers; KNICKGASM competes mainly against Tier 2 configurators and Tier 3 local artists."],
  ["cards", 2, [
    ["Tier 1, International bespoke studios", "<b>The craft ceiling.</b> The Shoe Surgeon and its peers take commissions from anywhere. Priced on application, delivered on a commission timeline. Prestige competitors, not volume competitors."],
    ["Tier 2, Brand-run configurators", "<b>Present everywhere.</b> Nike By You, Converse By You, Vans Customs. Official supply, local fulfilment, colour swaps only. The single largest source of pre-educated demand KNICKGASM has."],
    ["Tier 3, Local independent customisers", "<b>The proximity competitor.</b> City-level artists in every major market. Close to the customer, strong on bespoke ideas, weak on catalog, capacity and delivery commitment."],
    ["Tier 4, Global sneaker marketplaces", "<b>The wallet competitor.</b> StockX, GOAT and regional equivalents. They own the known-pair purchase and the authentication cue; they produce nothing unique."],
    ["Tier 5, Care, restoration and supplies", "<b>The adjacency.</b> Crep Protect, Jason Markk, Reshoevn8r, Angelus Direct. Globally distributed, and useful to KNICKGASM because they have already normalised investing in a pair's upkeep."]
  ]],
  ["card", ["{L} Where KNICKGASM sits: a Tier 1 craft product delivered with Tier 2 accessibility and Tier 3 breadth of subject matter, shipped internationally. The edge is strongest where gifting and premiumisation matter (EU, GCC, ANZ) and weakest where a strong local scene already serves the same need."]],

  ["sec", 6, "Global footprint matrix", "Where each named player is actually present, and what it means for KNICKGASM outside its three core markets."],
  ["tbl", ["Player", "Home", "Actually present in", "What it competes on"], [
    ["Nike By You", "US, global", "Nearly every affluent market", "Official supply, brand trust, colour choice"],
    ["Converse By You", "US, global", "Most affluent markets", "Canvas silhouettes, templated prints"],
    ["Vans Customs", "US, global", "Most affluent markets", "Prints and patches, youth reach"],
    ["The Shoe Surgeon", "US", "Global commissions", "Craft ceiling, prestige"],
    ["Ceeze / Kickstradomis", "US", "Global commissions", "Named-artist hand"],
    ["Local independent customisers", "Every major city", "City-level", "Proximity, bespoke ideas"],
    ["Etsy independents", "Marketplace", "Ships almost anywhere", "Price"],
    ["StockX / GOAT", "US", "Global", "Authenticated known pairs"],
    ["Crep Protect / Jason Markk", "UK / US", "Global retail", "Care and protection"],
    ["Angelus Direct", "US", "Global supply", "Paints and finishers"],
    ["<b>KNICKGASM</b>", "India (Mumbai)", "60+ countries by express shipping", "Browsable one-of-one, original bases, durable finish"]
  ], "Presence is certain where a brand operates its own storefront; local-artist coverage is inferred from the structure of the category, not counted."],

  ["sec", 7, "Region-by-region deep dive"],
  ["cards", 2, [
    ["Europe (ex-UK), the biggest prize", "{C} High-income, streetwear-literate, football-obsessed. <b>Who is there:</b> brand configurators at scale, dense local artist scenes in Berlin, Paris, Amsterdam and Milan, and the full marketplace long tail. <b>KNICKGASM read:</b> Winnable. Lead with the football and sport, anime and gaming collections, make duties and delivery explicit, and treat the configurator graduate as the target audience."],
    ["Canada, a US mirror", "{L} Buys like the US, shares its references and its platforms. <b>Who is there:</b> the same configurators and marketplaces, fewer local studios. <b>KNICKGASM read:</b> Winnable, low-friction. Replicate the US merchandising almost unchanged; the work is delivery and duty clarity, not positioning."],
    ["Australia &amp; New Zealand, streetwear-native", "{L} English-language, high-income, strong gifting culture, sneaker-literate. <b>Who is there:</b> configurators, a small but real local custom scene, marketplaces. <b>KNICKGASM read:</b> Winnable. The main constraint is shipping time, so the 10 to 15 day build plus express transit must be stated as a total, not as two numbers."],
    ["GCC / Middle East, gifting &amp; statement", "{L} Small in units, exceptional on premium gifting and statement pieces. <b>Who is there:</b> luxury retail, configurators, limited local customisation. <b>KNICKGASM read:</b> Winnable, gifting-led. Merchandise bling, crystal work, celebrity and the grail tier; presentation and packaging carry disproportionate weight here."],
    ["East Asia, present, not winning", "{L} Dense domestic sneaker cultures, strong local customisation scenes and buyers who are close to their own artists. <b>KNICKGASM read:</b> Shipping-only. Fulfil the demand that arrives, do not fund acquisition against a scene that is physically closer to the customer than Mumbai is."]
  ]],

  ["sec", 8, "Selected competitor profiles"],
  ["cards", 2, [
    ["KNICKGASM Global (anchor)", "India's largest sneaker customiser, shipping express to 60+ countries. 436 live SKUs across anime, cars, football and sport, gaming, wedding, pets, bling, Taylor Swift, celebrity, embroidery, crystal work and coffee-ART, on 100% original Nike, Jordan, Converse and Adidas bases, water and scratch resistant, 10 to 15 day made-to-order. <b>Strengths:</b> catalog depth and international fulfilment that no single-artist studio can match; a real production studio; organic wear by Samay Raina, Rohit Sharma and Shraddha Kapoor. <b>Openings:</b> spread thin across 60+ countries dilutes focus; concentrate on the winnable four."],
    ["Nike By You (global)", "The largest personalisation funnel in the world and the reason rest-of-world buyers already understand the category. Official bases, local fulfilment, brand trust. <b>Openings:</b> colour only. It creates the appetite for artwork and then refuses to serve it, in every market simultaneously."],
    ["The Shoe Surgeon (global commissions)", "The international craft ceiling, taking commissions from anywhere. <b>Openings:</b> POA and commission-length everywhere it operates; it cannot serve a dated gift or a customer who wants to browse."],
    ["Local independent customisers", "Present in every major city, strong on proximity and on painting a customer's own idea. <b>Openings:</b> one pair of hands, no catalog, no delivery commitment. KNICKGASM's answer is breadth and reliability, not craft one-upmanship."],
    ["Etsy and cross-border independents", "The global price floor, shipping almost anywhere. <b>Openings:</b> unverified bases and unmanaged delivery. In markets where duties already inflate the landed price, the cheap listing gets less attractive, not more, which favours KNICKGASM."],
    ["StockX / GOAT (global)", "The known-pair purchase with an authentication guarantee, available in every winnable market. <b>Openings:</b> nothing unique is produced. The argument against them is strongest on gifting, where duplication is precisely the problem."],
    ["Crep Protect / Jason Markk (global care)", "Widely distributed sneaker care that has normalised paying to protect a pair. <b>Read:</b> not competitors. They make KNICKGASM's finish claim and care accessories easier to sell everywhere."],
    ["Regional luxury and gifting retail", "In the GCC especially, premium gifting runs through luxury retail and mall channels. <b>Read:</b> the relevant competitor for gifting budget is a luxury gift, not another sneaker. Presentation and packaging have to compete at that level."]
  ]],

  ["sec", 9, "Consumer demand signals"],
  ["bul", [
    "<b>Configurator graduates exist in every market,</b> and they are the most efficient rest-of-world audience available.",
    "<b>Fandom travels, references do not.</b> Anime, gaming and football designs need no localisation; region-specific celebrity work does.",
    "<b>Gifting is universal, high-margin and deadline-bound,</b> which makes the delivery promise the central conversion mechanic abroad.",
    "<b>Landed cost matters more than list price.</b> Duties and delivery are what actually decide an international basket.",
    "<b>Uniqueness is the portable argument.</b> It works in every market, needs no translation, and cannot be matched by a marketplace or a configurator."
  ]],

  ["sec", 10, "The global go-to-market playbook"],
  ["bul", [
    "<b>Fund the winnable four.</b> Concentrate merchandising and spend on EU-ex-UK, Canada, ANZ and the GCC. Treat everywhere else as fulfilment, not acquisition.",
    "<b>Wire in own order data by country</b> before buying any third-party sizing. It is the only rest-of-world number that will ever break out customisation.",
    "<b>Quote a total delivery promise,</b> build time plus transit, with duties stated. Two separate numbers read as a hidden delay.",
    "<b>Merchandise by what travels.</b> Football and sport for Europe, anime and gaming everywhere, bling and celebrity for the GCC, gifting bundles for all four.",
    "<b>Localise the compliance, not the product.</b> One catalog, a regional design-provenance register, and regional claim wording.",
    "<b>Do not fund acquisition against dense local scenes.</b> In East Asia, fulfil what arrives and spend the budget where proximity is not the competitor's advantage."
  ]],

  ["sec", 11, "Customs, IP and claims patchwork", "One catalog, many regimes; never port a market's creative abroad without a compliance pass."],
  ["tbl", ["Region", "What governs", "Posture"], [
    ["EU", "Consumer rights on distance selling, returns and duties; EU trademark law", "State duties and returns on a made-to-order item explicitly; keep the design register current"],
    ["Canada", "Consumer protection and customs valuation", "Total landed cost stated before checkout"],
    ["Australia / NZ", "Consumer guarantees, import thresholds", "Clear delivery promise and returns terms; long transit must be stated, not implied"],
    ["GCC", "Import documentation and gifting expectations", "Presentation-grade packaging and conservative claim wording"],
    ["East Asia", "Strong local IP enforcement, dense domestic scenes", "Shipping-only; be conservative on licensed-character designs"]
  ]],

  ["sec", 12, "Strategic implications &amp; white space"],
  ["bul", [
    "Nobody else ships a browsable catalog of finished one-of-one pairs internationally; that is the whole rest-of-world position.",
    "Gifting is an underworked, high-margin global lane that suits a product which by definition cannot be duplicated.",
    "Configurator graduates are a free, permanent, globally distributed audience created by the largest brands in footwear.",
    "Concentration beats coverage: four markets fully served will outperform sixty lightly served."
  ]],
  ["card", ["{L} Net: the rest-of-world story is focus. Four markets to win, a gifting-and-uniqueness playbook to win them with, an explicit landed-cost and delivery promise, a regional design-provenance register, and the discipline not to buy demand where a local artist is simply closer."]],

  ["sec", 13, "Sources &amp; notes"],
  ["card", ["Primary sources: the built KNICKGASM catalogs (data/catalog/products_us.json, products_uk.json) for range, price bands and collections; knickgasm.com for shipping reach and build times; brand configurator pages (nike.com, converse.com, vans.com); commission-studio pages (theshoesurgeon.com and peers); marketplace pages (etsy.com, stockx.com, goat.com); care and supply pages (crepprotect.com, jasonmarkk.com, angelusdirect.com), all retrieved July 2026. Third-party sizing for custom sneakers is not available in citable form and is marked as a data dependency. Per-country demand should be sourced from KNICKGASM's own order data, not purchased. No competitor copy is reproduced."]]
];

REPORTS.India = [
  ["sec", 1, "Scope, method &amp; how to read this"],
  ["card", [
    "{C} \"Sneakers\" is not one market in India either. This report anchors on the arena where KNICKGASM actually competes at home: sneaker culture and the customisation layer on top of it, alongside the retail and resale businesses that own the base pairs and the care and restoration services that keep them alive.",
    "{C} Central framing: India is not a smaller US market. The base pairs are more expensive relative to income, sneaker culture is younger and more community-driven, and KNICKGASM is not a challenger here, it is the largest sneaker customiser in the country. The home-market question is not whether customisation is understood, it is whether the premium is."
  ]],
  ["bul", [
    "Structure of Indian sneaker retail, resale and streetwear D2C, and where the customisation and care layer sits on top of it.",
    "A five-tier competitive landscape plus deep-dive profiles across sneaker retail, resale, local customisers and the care set.",
    "Comparison tables: who owns which wallet, and where KNICKGASM competes for it.",
    "Consumer demand signals, the India D2C playbook, the legal frame (trademark, licensed characters, advertising standards) and a white-space read."
  ]],

  ["sec", 2, "Executive summary"],
  ["card", ["{C} India is where KNICKGASM is strongest and least replaceable. It is the largest sneaker customiser in the country, painting in Mumbai on 100% original pairs, with a 436-design catalog and organic wear by Samay Raina, Rohit Sharma and Shraddha Kapoor. No domestic competitor operates at that scale or with that depth of range."]],
  ["bul", [
    "<b>The base pair is the constraint, not the paint.</b> Original Nike, Jordan, Converse and Adidas pairs carry a meaningful cost in India, which sets the floor under every custom and makes sourcing a genuine operational advantage.",
    "<b>Retail and resale own the known-pair wallet.</b> VegNonVeg, Superkicks, CrepDog Crew, Hypefly and Culture Circle are where a customer goes for a pair that already exists. They compete for budget, never for uniqueness.",
    "<b>Local customisers are numerous and small.</b> Individual artists on Instagram take commissions city by city. They win on painting a customer's own idea and on proximity; they cannot offer a catalog, a listed price or a committed date.",
    "<b>Celebrity and community proof is unusually powerful at home.</b> Organic wear by Samay Raina, Rohit Sharma and Shraddha Kapoor is a real trust cue in a market where sneaker culture is community-led and visible.",
    "<b>Occasion demand is a distinct Indian opportunity.</b> Wedding customs, festive gifting and milestone pairs are high-intent, deadline-bound and less price-sensitive than everyday purchase.",
    "<b>The premium has to be earned in the open.</b> A domestic buyer can find a cheaper painted pair. The originality of the base and the durability of the finish are the two things that justify the difference, and both must be shown, not asserted."
  ]],

  ["sec", 3, "Market sizing (India, with global context)", "Defensible figures only; dependencies named where citable sizing does not exist."],
  ["tbl", ["Segment", "What we can state", "Direction", "Source"], [
    ["KNICKGASM range", "436 live SKUs; 349 Air Force 1, 35 Court Vision, 19 Converse, 9 Adidas, 8 Air Jordan, plus denim jackets and accessories", "Stable, added to per drop", "data/catalog/"],
    ["KNICKGASM position", "India's largest sneaker customiser; painted in Mumbai; ships to 60+ countries", "Category leader at home", "knickgasm.com"],
    ["Collections", "Anime, cars, football and sport, wedding, pets, bling, gaming, coffee-ART, Taylor Swift, celebrity, embroidery", "Breadth is the moat", "data/catalog/"],
    ["India sneaker retail and resale", "[DATA REQUIRED BEFORE LAUNCH: India sneaker retail and resale market size, cited firm, India]", "Growing fast", "To be sourced"],
    ["India customisation as a service", "[DATA REQUIRED BEFORE LAUNCH: India custom-sneaker service market size, cited firm, India]", "Not sized by any firm", "To be sourced"],
    ["India sneaker care", "[DATA REQUIRED BEFORE LAUNCH: India sneaker care and restoration market size, cited firm, India]", "Emerging", "To be sourced"]
  ], "As elsewhere, customisation is not broken out by any research firm. KNICKGASM's own order data is the better source for home-market demand shape."],
  ["sub", "3.1 The base pair, expensive and decisive"],
  ["card", ["{C} An original Air Force 1, Jordan, Converse or Adidas pair is a significant input cost in India, and it is non-negotiable: the moment a customiser substitutes a replica, the entire trust proposition collapses. Reliable sourcing of genuine bases at scale is one of the least visible and most valuable parts of the business."]],
  ["sub", "3.2 Customisation, a leader-led category"],
  ["card", ["{C} Unlike the US and UK, where the customisation conversation is dominated by foreign configurators, India's customisation category has a domestic leader. That changes the strategic job from proving the category exists to defending the premium against a long tail of individual artists, and from acquisition-at-any-cost to building the catalog and the reliability that no individual can match."]],
  ["sub", "3.3 Care and restoration, an emerging layer"],
  ["card", ["{L} Sneaker cleaning and restoration is a younger service category in India than in the UK or US. That is an opening rather than a gap: rope laces, lace tags and care guidance can be sold as part of owning a hand-painted pair rather than as a separate habit that has to be taught first."]],

  ["sec", 4, "Category dynamics &amp; demand trends"],
  ["cards", 2, [
    ["Sneaker culture is community-led", "{C} Indian sneaker culture runs through communities, drops and visible wear rather than through mass advertising. That makes organic celebrity wear and real customer photography far more valuable than polished studio-only creative."],
    ["Fandom is the buying trigger", "{C} Anime, gaming, football and cricket, cars and celebrity designs are what customers search for. The Air Force 1 is what they discover underneath. Collection pages, not silhouette pages, are the front door at home too."],
    ["Wedding and festive are structural", "{C} Wedding customs and festive gifting are a genuinely distinct Indian demand pattern, high-intent and deadline-bound. They reward a committed delivery date more than any discount would."],
    ["Price sensitivity is real and answerable", "{C} A cheaper painted pair is always findable. The answer is the base and the finish, demonstrated on camera, not a lower price. Discounting a one-of-one damages the premium it depends on."],
    ["The local-artist long tail", "{L} Individual customisers are close to their customers and good at bespoke briefs. The competitive answer is not to out-craft them, it is catalog depth, consistent finishing and a delivery commitment they structurally cannot offer."],
    ["Export credibility works in reverse", "{L} A Mumbai studio shipping express to 60+ countries is a domestic trust cue as much as an operational fact. It says the work meets a standard that travels."]
  ]],

  ["sec", 5, "Competitive landscape, the tiers", "The India arena sorts into five tiers; KNICKGASM leads one and competes for the wallet in two others."],
  ["cards", 2, [
    ["Tier 1, Customisation (KNICKGASM's category)", "<b>Led at home.</b> KNICKGASM plus a long tail of individual artists. The only tier where a one-of-one hand-painted pair is actually produced, and the only one where KNICKGASM is the incumbent rather than the challenger."],
    ["Tier 2, Sneaker retail", "<b>The wallet competitor.</b> VegNonVeg, Superkicks, Mainstreet Marketplace and the boutique scene. Authorised originals, strong community standing, no customisation. They own the everyday sneaker purchase."],
    ["Tier 3, Sneaker resale and grails", "<b>The grail wallet.</b> CrepDog Crew, Hypefly, Culture Circle. Authentication is their trust product. They compete directly with KNICKGASM's Jordan and Samba tier for the same collector budget, on hype rather than uniqueness."],
    ["Tier 4, Brand configurators (inbound)", "<b>Category educators.</b> Nike By You and peers, to the extent they reach Indian buyers. They normalise personalisation and stop at colour, which is useful."],
    ["Tier 5, Care, restoration and supplies", "<b>The emerging adjacency.</b> Domestic cleaning and restoration services plus imported care brands. Small but growing, and the natural home for KNICKGASM's accessories and care guidance."]
  ]],
  ["card", ["{L} Where KNICKGASM sits: the incumbent of Tier 1, competing for budget against Tiers 2 and 3 and benefiting from the education Tier 4 provides. The defensive job is the long tail of individual artists; the offensive job is taking grail budget from resale."]],

  ["sec", 6, "Competitor deep-dive profiles"],
  ["cards", 2, [
    ["KNICKGASM (anchor)", "India's largest sneaker customiser. <b>Range:</b> 436 live SKUs across anime, cars, football and sport, wedding, pets, bling, gaming, coffee-ART, Taylor Swift, celebrity, embroidery and crystal work, plus hand-painted denim jackets and accessories. <b>Bases:</b> 100% original Nike Air Force 1, Court Vision, Air Jordan, Converse, Adidas. <b>Build:</b> hand-painted in Mumbai by India's best artists, water and scratch resistant, 10 to 15 day made-to-order. <b>Reach:</b> express shipping to 60+ countries. <b>Proof:</b> worn organically by Samay Raina, Rohit Sharma and Shraddha Kapoor. <b>Strengths:</b> category leadership at home, catalog depth no individual artist can approach, a real studio, and export credibility that reads as quality domestically. <b>Openings:</b> defending the premium against a cheaper long tail; keeping licensed-character designs on a maintained provenance register; care and restoration is under-built relative to the opportunity."],
    ["VegNonVeg", "One of India's most culturally credible sneaker and streetwear retailers, with strong community standing and curation. <b>Read:</b> a wallet competitor, not a customisation competitor. They sell pairs that exist; KNICKGASM sells pairs that do not exist anywhere else. Their strength is a reminder that curation and community, not discounting, is how credibility is built in this market."],
    ["Superkicks", "Sneaker and streetwear retail with a strong care and accessories adjacency. <b>Read:</b> the most relevant retailer to KNICKGASM's care layer. Their presence proves domestic willingness to spend on protecting a pair, which supports the accessories and care attach."],
    ["CrepDog Crew", "Resale and drops with strong youth reach. <b>Read:</b> competes for the grail budget that would otherwise go to a Jordan or Samba custom. Their trust product is authentication; KNICKGASM's is originality plus uniqueness, which is a stronger argument for a gift."],
    ["Hypefly", "Sneaker resale built on authentication. <b>Read:</b> same grail-wallet competition. The counter-argument is straightforward: a resale grail is rare, a KNICKGASM pair is singular."],
    ["Culture Circle", "Luxury and sneaker resale aimed at the premium end. <b>Read:</b> competes for premium discretionary spend and for gifting budget. Presentation and packaging need to hold up against a luxury gift, not against another sneaker."],
    ["Independent Indian customisers", "A long tail of individual artists taking commissions through Instagram. <b>Strengths:</b> proximity, bespoke briefs, lower prices. <b>Openings:</b> one pair of hands, inconsistent finishing, no catalog, no committed date, and frequently no guarantee that the base is genuine. This is the tier the originality and finish message exists to answer."],
    ["Cleaning and restoration services", "A young but growing domestic service layer. <b>Read:</b> not a competitor. A natural partner category and the obvious extension of KNICKGASM's care accessories into a repeat relationship."]
  ]],

  ["sec", 7, "Side-by-side comparison tables"],
  ["sub", "7.1 India sneaker arena, players and roles"],
  ["tbl", ["Player", "Type", "What they sell", "Trust product", "Tier"], [
    ["<b>KNICKGASM</b>", "Customisation studio", "Hand-painted one-of-one pairs, denim, accessories", "Original base + durable finish", "Tier 1 (leader)"],
    ["VegNonVeg", "Retail", "Authorised originals, streetwear", "Curation and community", "Tier 2"],
    ["Superkicks", "Retail + care", "Authorised originals, care products", "Retail credibility", "Tier 2"],
    ["CrepDog Crew", "Resale / drops", "Resale originals", "Authentication", "Tier 3"],
    ["Hypefly", "Resale", "Grails", "Authentication", "Tier 3"],
    ["Culture Circle", "Luxury resale", "Premium grails", "Authentication and luxury framing", "Tier 3"],
    ["Independent customisers", "Individual artists", "Commissioned pairs", "Personal relationship", "Tier 1 long tail"]
  ]],
  ["sub", "7.2 KNICKGASM's price ladder at home"],
  ["tbl", ["Tier", "What it is", "Role in the range"], [
    ["Accessories", "Rope laces, lace tags", "Basket-builder and free-gift lever"],
    ["Apparel", "Hand-painted denim jackets", "Cross-category and gifting"],
    ["Entry custom", "Converse and Court Vision customs", "First one-of-one purchase"],
    ["Core custom", "Air Force 1 customs, 349 designs", "The bulk of the catalog and the brand's signature"],
    ["Grail custom", "Air Jordan and Adidas Samba customs", "Highest order value, collector and gift demand"]
  ], "The ladder is unusually complete for a customisation business, which is what lets a first-time accessory buyer become a grail buyer without ever leaving the brand."],
  ["sub", "7.3 Where KNICKGASM competes, the wallet map"],
  ["tbl", ["Wallet", "Who owns it now", "KNICKGASM's weapon", "Verdict"], [
    ["One-of-one customisation", "KNICKGASM, plus a long tail of individual artists", "Catalog depth, original bases, durable finish, committed dates", "<b>Led</b>"],
    ["Grail and collector spend", "CrepDog Crew, Hypefly, Culture Circle", "A pair that is singular rather than merely rare", "Contestable"],
    ["Everyday sneaker purchase", "VegNonVeg, Superkicks, mainstream retail", "n/a, this is not the fight", "Avoid"],
    ["Gifting and occasion", "Luxury retail and general gifting", "A gift that cannot be duplicated, delivered to a date", "<b>Winnable</b>"]
  ], "The two wallets worth attacking are grail spend and gifting. Everyday sneaker retail is a volume game with none of KNICKGASM's advantages."],

  ["sec", 8, "Consumer demand signals"],
  ["bul", [
    "<b>Fandom drives search:</b> anime, gaming, football and cricket, cars, celebrity. The design is the query; the silhouette is the spec.",
    "<b>Wedding and festive are structural demand,</b> deadline-bound and less price-sensitive than everyday purchase.",
    "<b>Visible organic wear converts,</b> Samay Raina, Rohit Sharma and Shraddha Kapoor are worth more at home than any produced endorsement would be.",
    "<b>The durability question is the stall point,</b> and it is answered by showing the finish, not by describing it.",
    "<b>Care is an emerging habit,</b> which makes accessories and care guidance an easier attach now than it would have been three years ago."
  ]],

  ["sec", 9, "The India D2C playbook, what wins"],
  ["bul", [
    "<b>Defend the premium in the open.</b> Show the original base and the finishing process. Never answer a cheaper painted pair with a discount.",
    "<b>Merchandise by fandom and occasion,</b> not by silhouette. Wedding and festive should be planned campaigns, not seasonal afterthoughts.",
    "<b>Use organic proof.</b> Real wear by real public figures and real customer photography beats produced creative in a community-led market.",
    "<b>Commit to the date.</b> 10 to 15 days made-to-order, stated up front, with proactive in-progress updates. Silence is the category's top complaint.",
    "<b>Attack grail budget, not everyday retail.</b> The Jordan and Samba tier competes with resale on uniqueness, which is an argument resale cannot answer.",
    "<b>Build the care layer.</b> Rope laces, lace tags and care guidance turn a one-off grail into a repeat relationship, and the domestic habit is only now forming.",
    "<b>Let export credibility work at home.</b> Shipping express to 60+ countries is a quality signal to an Indian buyer, not just an operations fact."
  ]],

  ["sec", 10, "India legal &amp; advertising frame"],
  ["bul", [
    "<b>Trademark and modified product:</b> be explicit that a pair is an original brand product hand-painted by KNICKGASM. Never imply a partnership or endorsement by Nike, Jordan, Converse or Adidas, and keep third-party marks out of KNICKGASM's own branding and packaging.",
    "<b>Licensed characters and likeness:</b> anime, film, club and celebrity designs are the demand engine and the exposure. Maintain a design-provenance register that separates original artwork, fan interpretation and designs that would need a licence, and retire quickly rather than defend.",
    "<b>Advertising standards:</b> claims must be truthful and substantiable. Made on 100% original pairs, hand-painted, water and scratch resistant, shipped to 60+ countries and worn organically by named public figures all are. Invented discounts, review counts and percentages are not, and must never appear.",
    "<b>Practical rule:</b> everything KNICKGASM actually does is provable. The compliance work is not softening claims, it is refusing to add unprovable ones."
  ]],
  ["card", ["{L} In a market where the long tail makes unverifiable promises, being the brand whose every claim can be checked is a commercial asset, not a constraint."]],

  ["sec", 11, "Strategic implications &amp; white space"],
  ["card", ["{L} At home the question is not whether customisation is understood. It is whether the premium is justified in public, every time."]],
  ["bul", [
    "Catalog depth is the moat against the individual-artist long tail; keep expanding collections deliberately rather than opportunistically.",
    "Grail-tier customs (Jordan, Samba) are the direct answer to resale, and uniqueness is an argument authentication cannot match.",
    "Wedding, festive and gifting are the highest-intent, least price-sensitive demand in the home market and deserve planned campaigns.",
    "Care and restoration is the under-built retention layer, and the domestic habit is forming now.",
    "Export credibility, 60+ countries from a Mumbai studio, is an under-used domestic trust cue."
  ]],

  ["sec", 12, "Sources &amp; notes"],
  ["card", ["Primary sources: the built KNICKGASM catalogs (data/catalog/products_us.json, products_uk.json) for range, silhouette counts, price ladder and collections; knickgasm.com for build time, shipping reach and brand claims; and public pages for the Indian retail and resale set (vegnonveg.com, superkicks.in, crepdogcrew.com, hypefly.co.in, culturecircle.in) retrieved July 2026. Third-party sizing for Indian sneaker retail, customisation and care is not available in citable form and is marked as a data dependency rather than estimated. No competitor copy is reproduced."]]
];

/* one-line strategic synthesis shown per region above the report */
var SYNTH = {
  US: "The gap is structural: bespoke studios will not list a price, configurators will not paint artwork, and the marketplace long tail will not guarantee an original base. KNICKGASM is the only one selling a browsable finished one-of-one, on a 100% original pair, water and scratch resistant, in 10 to 15 days.",
  UK: "Price is not the UK fight, proof is. Lead with the two checkable facts, an original base and a durable finish, speak directly to the Nike By You graduate who wanted artwork and got colour swaps, and make the total delivery promise explicit.",
  Global: "Shipping to 60+ countries is an operational fact, not a strategy. Concentrate on the winnable four (EU-ex-UK, Canada, ANZ, GCC), merchandise the collections that travel, quote a total landed promise, and do not buy demand where a local artist is simply closer.",
  India: "KNICKGASM is the incumbent at home, so the job flips: defend the premium against the individual-artist long tail with catalog depth and provable claims, take grail budget from resale on uniqueness, and own wedding, festive and gifting."
};

/* =====================================================================
   D2C GROWTH ENGINE, per region + a universal (all-industry) playbook.
   Rendered in its own "D2C growth" sub-tab. Synthesised from the report
   evidence above (sourced facts, no speculation).
   ===================================================================== */
var D2C_LEVERS = [
  ["Blended + paid CAC", "Cost to acquire a customer", ""],
  ["LTV : CAC ratio", "Whether acquisition is profitable", ""],
  ["Drop signups &amp; repeat window", "Whether a one-of-one buyer comes back", ""],
  ["AOV", "Basket size per order", ""],
  ["Repeat / reorder rate", "Loyalty and habit", ""],
  ["First-order conversion", "Funnel efficiency", ""],
  ["Review volume &amp; rating", "Trust proxy", ""]
];
function leversTbl(moveCol) {
  var rows = D2C_LEVERS.map(function (r, i) { return [r[0], r[1], moveCol[i]]; });
  return ["tbl", ["Lever (tracked &amp; measured)", "What it measures", "How the region's brands improve it"], rows];
}

var D2C = {
  US: [
    ["head", "D2C growth engine (US)", "How the US players track, measure and grow direct-to-consumer sales, and what they have done versus what they are doing now."],
    ["card", ["The US arena runs on process content and provable claims. The configurators generate the appetite, the marketplaces set the price anchor, and the studios that win are the ones that can show the work and commit to a date."]],
    ["sub", "Levers, how the players track, measure and improve D2C sales"],
    leversTbl([
      "Process and reveal video as the primary creative; collection pages tuned to fandom search; configurator graduates as the warm audience",
      "A complete price ladder from $7.91 accessories to $261.95 grails, so a first purchase can grow rather than repeat flat",
      "Drop and restock signups, new-collection launches, and care follow-ups replacing the subscription mechanic a one-of-one product cannot use",
      "Rope laces and lace tags attached by default; collection bundles; denim jackets as a cross-category add",
      "Occasion and gifting cycles, care follow-up, and new fandom collections as the reason to return",
      "The durability objection answered in the creative; the 10 to 15 day window stated before checkout, not at it",
      "Real customer photography and organic wear (Samay Raina, Rohit Sharma, Shraddha Kapoor) rather than manufactured proof"
    ]),
    ["sub", "What the players have done (past plays)"],
    ["bul", [
      "Bespoke studios built reputation through high-profile commissions and collaborations, turning craft into a personal brand.",
      "Brand configurators normalised paying extra for a personalised pair, at enormous scale and with no artwork attached.",
      "The marketplace long tail established the price anchor buyers now arrive with.",
      "KNICKGASM built the thing none of them did: a browsable catalog of 436 finished one-of-one designs at listed prices."
    ]],
    ["sub", "What the players are doing now (current plays)"],
    ["bul", [
      "Competing on provable specifics, base originality and finish durability, rather than on generic craft language.",
      "Treating process and reveal video as the core acquisition asset because it answers the durability doubt visually.",
      "Merchandising by fandom and occasion rather than by silhouette, because that is how customers actually search.",
      "Building the care and accessories layer to turn a one-off grail purchase into a repeat relationship."
    ]]
  ],
  UK: [
    ["head", "D2C growth engine (UK)", "How the UK arena tracks, measures and grows D2C sales, and what has changed."],
    ["card", ["The UK set is shaped by two forces: brand configurators that have pre-educated an enormous audience and stopped at colour, and an advertising regime that rewards claims you can actually prove. Both favour a studio with checkable facts."]],
    ["sub", "Levers, how the players track, measure and improve D2C sales"],
    leversTbl([
      "Configurator-graduate targeting; football and sport collections as the UK entry point; process video as the proof asset",
      "A GBP price ladder from &pound;6.29 to &pound;208.37, so first purchase and grail purchase are the same relationship",
      "Drop and restock signups plus care follow-up, in place of a subscription mechanic that does not fit a one-of-one product",
      "Rope laces at &pound;6.29 and lace tags at &pound;7.27 attached by default; denim jackets as a cross-category add",
      "Occasion cycles (wedding, gifting) and new collections; care guidance as the between-purchase contact",
      "The total delivery promise, build plus transit, stated before checkout; the durability objection answered in creative",
      "Substantiable proof only, real customer photography and organic celebrity wear, never invented counts or percentages"
    ]),
    ["sub", "What the players have done (past plays)"],
    ["bul", [
      "Brand configurators built mass UK awareness that personalisation is worth paying for.",
      "UK commission artists built credibility for hand-painted work, one client at a time.",
      "Care brands normalised spending money to protect a pair, which makes the finish claim legible.",
      "Cross-border marketplace sellers set a low price anchor that every premium studio now has to answer."
    ]],
    ["sub", "What the players are doing now (current plays)"],
    ["bul", [
      "Targeting the configurator graduate directly: the customer who picked colours and still wanted a design.",
      "Making the delivery promise explicit, including duties and an honest cut-off for dated occasions.",
      "Keeping every claim ASA/CAP-clean, no implied brand partnership, no invented offers or review counts.",
      "Merchandising football and sport as a UK-first collection rather than treating the catalog as region-neutral."
    ]]
  ],
  Global: [
    ["head", "D2C growth engine (Global / rest-of-world)", "How the winnable markets are actually won, past versus now."],
    ["card", ["Rest-of-world is decided by landed cost, delivery clarity and gifting, not by competitive pressure. In most of these markets the real rival is friction, not another studio."]],
    ["sub", "Levers, how the players track, measure and improve D2C sales"],
    leversTbl([
      "Configurator graduates exist in every market; fandom collections that need no localisation carry acquisition",
      "Gifting demand is the least price-sensitive and highest-margin available; concentrate spend on the winnable four",
      "Drop and restock signups, plus regional new-collection launches, as the return mechanic",
      "Gift bundles, accessories and denim as basket-builders that survive an international shipping cost",
      "Occasion cycles by region; care guidance as between-purchase contact; own order data as the retention signal",
      "A total landed promise, build plus transit plus duties, stated before checkout",
      "Real customer photography from the destination market; organic celebrity wear as portable proof"
    ]),
    ["sub", "What the players have done (past plays)"],
    ["bul", [
      "Brand configurators localised fulfilment and normalised personalisation in nearly every affluent market.",
      "Commission studios took international briefs and built prestige without ever building capacity.",
      "Marketplaces made cross-border painted pairs available everywhere, with all the trust problems that implies.",
      "KNICKGASM built express delivery to 60+ countries off a single Mumbai studio and a single catalog."
    ]],
    ["sub", "What the players are doing now (current plays)"],
    ["bul", [
      "Concentrating on the winnable four (EU-ex-UK, Canada, ANZ, GCC) rather than chasing country coverage.",
      "Quoting total landed cost and total delivery time rather than list price and build time separately.",
      "Merchandising the collections that travel (anime, gaming, football) and regionalising only where it pays.",
      "Keeping a regional design-provenance register instead of one global assumption about licensed imagery."
    ]]
  ],
  India: [
    ["head", "D2C growth engine (India)", "How the home market is actually won, past versus now."],
    ["card", ["India D2C here is decided by whether the premium is visibly justified and whether the date is kept. KNICKGASM is the incumbent, so the levers are defensive on price and offensive on grail and gifting budget."]],
    ["sub", "Levers, how the players track, measure and improve D2C sales"],
    leversTbl([
      "Community and creator content, organic celebrity wear, fandom collection pages; never paid discounting",
      "A ladder from accessories to grail customs so a first purchase can grow; gifting as the high-margin lane",
      "Drop and restock signups, festive and wedding campaigns, and care follow-up as the return mechanic",
      "Rope laces, lace tags and denim jackets attached by default; occasion bundles at festive peaks",
      "Wedding and festive cycles; care guidance; new collections as the reason to come back",
      "Original-base and finish proof shown on camera; the 10 to 15 day window committed to up front",
      "Real customer photography and organic wear by Samay Raina, Rohit Sharma and Shraddha Kapoor"
    ]),
    ["sub", "What the players have done (past plays)"],
    ["bul", [
      "Retailers such as VegNonVeg and Superkicks built sneaker culture credibility through curation and community.",
      "Resale platforms built authentication into a trust product and captured grail spend.",
      "Individual customisers proved domestic demand for hand-painted pairs, one commission at a time.",
      "KNICKGASM turned that demand into a catalog, a studio and an export business."
    ]],
    ["sub", "What the players are doing now (current plays)"],
    ["bul", [
      "Defending the premium in public with process and base-originality proof rather than with discounts.",
      "Planning wedding and festive as campaigns with committed delivery dates, not as seasonal afterthoughts.",
      "Attacking grail budget with the one argument resale cannot answer: singular beats rare.",
      "Building the care and restoration layer while the domestic habit is still forming."
    ]]
  ]
};

var D2C_UNIVERSAL = [
  ["head", "Universal D2C strategy, every brand, any industry", "The non-negotiable moves that hold across regions and categories, distilled from the four studies."],
  ["bul", [
    "<b>Sell a relationship, not a one-off product.</b> Where a subscription does not fit, build the equivalent: drop signups, new-collection launches, occasion cycles and after-purchase care.",
    "<b>Instrument the whole funnel.</b> Track CAC (blended and paid), LTV, LTV:CAC, contribution margin, cohort retention, repeat rate and AOV; decide on LTV:CAC, not on vanity revenue.",
    "<b>Guard CAC like the category-killer it is.</b> Lean on retention, referrals, owned channels and organic content before scaling paid.",
    "<b>De-risk the first purchase.</b> Answer the objection that actually stalls the sale, and answer it visually wherever you can.",
    "<b>Build a real proof engine.</b> Customer photography, organic wear and process footage. Never invent a review count or a percentage.",
    "<b>Lead with one named, provable differentiator,</b> and keep every claim compliant with the local regulator. Compliance is itself a trust moat.",
    "<b>Win the real shelf of your market,</b> wherever demand actually converts, whether that is search, a marketplace, a community or a physical counter.",
    "<b>Raise AOV and LTV deliberately</b> with bundles, cross-sell and gifting; make the second purchase obvious.",
    "<b>Own first-party data and email/SMS;</b> reduce dependence on rented audiences and shifting ad platforms.",
    "<b>Be honest about timing and cost.</b> On a made-to-order product, a stated wait converts and a discovered wait abandons.",
    "<b>Treat creative, offers and funnels as always-on experiments,</b> measure, iterate, kill what does not move the levers above."
  ]]
];

function d2cInnerHTML(region, mode) {
  return renderNodes(D2C[region], mode) + "\n" + renderNodes(D2C_UNIVERSAL, mode);
}

/* =====================================================================
   SOCIAL COMMERCE & SHORT-FORM VIDEO (TikTok / Reels).
   Rendered in its own "Social & content" sub-tab. Transcribed from the
   KNICKGASM Strategic TikTok & Reels Marketing Blueprint (multi-market,
   Jul 2026). Where the blueprint carried performance figures that could
   not be re-verified, the figure has been replaced by the signal to
   track rather than reproduced. Shared core + a short per-region intro.
   ===================================================================== */
var SOCIAL_CORE = [
  ["sub", "Why custom sneakers are unusually strong short-form material"],
  ["card", ["{C} Short-form video is a format built for transformation, and a hand-painted sneaker is a transformation with a beginning, a middle and a reveal. A blank white Air Force 1 becoming a finished one-of-one is the entire narrative arc of a good clip, and it doubles as proof of the two claims that decide the sale: that the base is a real branded pair, and that the finish is applied properly enough to survive being worn."]],
  ["tbl", ["Content format", "Why it works for a custom-sneaker brand", "Signal to track"], [
    ["Build time-lapse", "Compresses ten days of work into fifteen seconds and proves the pair is genuinely hand-painted", "Watch-through rate to the reveal"],
    ["The reveal", "The strongest hook in the category: blank pair to finished design in one cut", "Hook retention in the first three seconds"],
    ["Fandom edit", "Matches a design to the series, club, game or artist the viewer already follows", "Saves and shares, and collection-page sessions"],
    ["Unboxing", "Answers the is-it-real question before the customer has to ask it", "Comment sentiment on authenticity"],
    ["Care and durability", "Directly answers the objection that stalls a first purchase", "Product-page conversion after exposure"],
    ["Occasion story", "Wedding, gift and milestone pairs, where the emotional payoff is the product", "Occasion-collection traffic and lead time enquiries"]
  ], "Do not attach borrowed performance percentages to these formats. Track the signal in the third column against KNICKGASM's own analytics and let the numbers be real."],
  ["cards", 2, [
    ["The process aesthetic &amp; ASMR", "{C} The category's native visual language is close and quiet: masking tape being lifted, a brush loading colour, an airbrush pass across a panel, the squeak of a lace being threaded. Macro close-ups with high-fidelity audio lower purchase scepticism through sheer craft evidence, and they cost almost nothing to shoot because the work is happening anyway."],
    ["Fandom is the distribution engine", "{C} A custom pair is a piece of fan art that can be worn, which means it travels inside communities that already exist: anime, gaming, football, cars, motorsport, music. Content that speaks the fandom's language gets carried by the fandom. Content that speaks generic sneaker language gets carried by nobody."]
  ]],
  ["sub", "Multi-market cultural dynamics"],
  ["card", ["{C} The formats travel further than the references do. A build time-lapse and a reveal work identically in London, Toronto, Sydney, Dubai and Mumbai. What does not travel is the subject: club crests and football references land hardest in the UK and Europe, anime and gaming land close to universally, cricket and regional celebrity land at home, and statement work (bling, crystal, celebrity) over-indexes in the GCC. Build one production system and vary only the design being revealed."]],
  ["sub", "How the strongest players in the arena win on social"],
  ["tbl", ["Player type", "Core creative &amp; social strategy", "Operational reality behind it"], [
    ["Bespoke commission studios", "Artist-as-personality, high-profile client reveals, craft-flex detail shots", "No catalog and no listed price; social generates commissions, not orders"],
    ["Brand configurators", "Polished campaign film, athlete and celebrity placement, product-launch cadence", "Enormous budget, official supply, and a product that stops at colour"],
    ["Independent customisers", "Founder-led build videos, direct DMs, community replies", "One pair of hands; social demand routinely exceeds capacity"],
    ["Resale marketplaces", "Drop calendars, authentication content, hype and scarcity", "Nothing unique is produced; the content sells access, not creation"],
    ["<b>KNICKGASM</b>", "Build and reveal at studio volume across many fandoms, plus real customer wear and organic celebrity sightings", "A production studio and a 436-design catalog, so every clip has something to click through to"]
  ]],
  ["cards", 2, [
    ["Studio volume is the unfair advantage", "{C} A single artist can post one build a week. A studio painting many pairs at once can post several a day, across different fandoms, each pointing to a product page that already exists. That is a structural content advantage, and it is the main reason catalog depth and content strategy are the same decision."],
    ["Every clip needs a destination", "{C} The commission studios' content ends in a DM and the marketplaces' content ends in a drop reminder. KNICKGASM's should end in a product page for the exact pair on screen. If a design is worth filming it should be buyable, and if it is sold out the collection it belongs to should be the fallback."],
    ["Real wear beats produced endorsement", "{C} Organic sightings on Samay Raina, Rohit Sharma and Shraddha Kapoor are worth more than staged placement precisely because they were not staged. Use them as they are, with no embellishment and no invented reach figures."],
    ["Answer durability on camera", "{L} The most common reason a first custom purchase stalls is the suspicion that the paint will crack. Showing the finishing process and the water and scratch resistant result addresses it more efficiently than any amount of copy."]
  ]],
  ["sub", "The six-step high-converting vertical-video ad"],
  ["tbl", ["Step", "Tactical objective", "Creative execution for KNICKGASM"], [
    ["1. Hook (0 to 3s)", "Stop the scroll with visual tension", "A blank white Air Force 1 in frame with the first stroke of colour landing, or a hard cut straight to the finished reveal"],
    ["2. Native delivery", "Feel like creator content, not an ad", "Handheld, natural light, the artist's hands and workbench rather than a studio set"],
    ["3. Real use case", "Show the pair in the life it is bought for", "The pair worn out, at a match, at a convention, at a wedding, on the person it was painted for"],
    ["4. Single-core message", "One clear idea per ad", "One only: it is hand-painted on an original pair, or it is a design nobody else will ever own"],
    ["5. Proof &amp; friction reduction", "Answer the objection on screen", "The finishing pass and the water and scratch resistant claim; the stated 10 to 15 day made-to-order window"],
    ["6. Goal-aligned CTA", "Direct to a low-friction next step", "The product page for the exact pair shown, or the collection it belongs to. Never a fabricated discount code"]
  ]],
  ["sub", "Awareness versus conversion, matching format to objective"],
  ["tbl", ["Dimension", "Awareness build", "Conversion build"], [
    ["Objective", "Make the category and the brand legible to people who have never bought a custom", "Move a warm viewer to a specific product page"],
    ["Placement &amp; format", "High-reach placements, sound-on sensory work, longer reveals", "Retargeting and shopping placements, tight cuts, one design per ad"],
    ["Creative", "The craft: masking, line work, airbrush passes, the reveal", "The specific pair, its price, its base silhouette and the delivery window"],
    ["What to measure", "Hook retention, watch-through to the reveal, saves and shares", "Product-page sessions, add-to-cart, and completed orders on the featured design"]
  ], "Match creative to objective: sensory craft footage builds the category, single-design cuts sell the pair. Measure each on its own metric rather than judging awareness creative on last-click."],
  ["sub", "Camera-ready unboxing &amp; presentation"],
  ["card", ["{C} For a made-to-order product, the box is the first physical proof that the wait was worth it, and it is the moment most likely to be filmed by the customer. It should be built for a vertical lens: the pair presented face-up and undamaged, the design visible the instant the lid lifts, protective wrap that does not fight the reveal, the rope laces and lace tags presented as part of the pair rather than loose in the bottom, and a short handwritten or printed note naming the design. Engineered this way, the unboxing produces the organic content that no ad budget buys."]],
  ["bul", [
    "<b>Pure ASMR unboxing,</b> no speaking, close-ups of the lid lifting, tissue moving and laces being threaded.",
    "<b>Conversational storytelling,</b> a customer or creator explaining why they chose that design while opening the box.",
    "<b>Before and after,</b> the blank silhouette against the finished pair, cut tight to the reveal."
  ]],
  ["card", ["{C} Production discipline matters: soft, even lighting so the paint reads true and highlights do not blow out the finish, steady overhead angles for the top-down design shot, tight B-roll of texture (brush marks, embroidery stitching, crystal work), and clean ambient audio via an external microphone. Keep on-screen text inside standard safe zones so captions and localised voiceovers can be swapped across US, UK and rest-of-world without re-editing the B-roll, which lowers content cost and keeps creative fresh across ad managers."]],
  ["sub", "Actionable social programs for KNICKGASM"],
  ["cards", 2, [
    ["The studio build channel", "A high-volume series shot inside the Mumbai studio: masking, base coats, line work, embroidery and crystal setting, finishing and the reveal. It is the cheapest content KNICKGASM can make because the work is already happening, and it is the most persuasive because it is the durability and originality proof in visual form."],
    ["Fandom-native drops", "Time content releases to the moments the fandom is already excited: a season premiere, a derby, a game launch, a tour date. The design is the post; the collection page is the destination."],
    ["Occasion storytelling", "Wedding, milestone and gift pairs told as short documentary cuts, from the brief to the reveal on the day. This is the highest-intent demand in the catalog and the content that best explains why a made-to-order wait is worth taking."],
    ["Real-wear proof", "Customer photography and organic sightings, including wear by Samay Raina, Rohit Sharma and Shraddha Kapoor, used exactly as they occurred with no embellishment and no invented reach claims."],
    ["Care and second life", "Short, useful content on protecting, cleaning and re-lacing a hand-painted pair, with rope laces and lace tags as the natural attach. It answers the durability objection and creates a reason to contact a customer between grail purchases."]
  ]],
  ["card", ["Sources: KNICKGASM Strategic TikTok &amp; Reels Marketing Blueprint (Multi-Market Creative &amp; Ad Optimization, Jul 2026), the built KNICKGASM catalogs for every product, price and collection referenced, and knickgasm.com for build times, shipping reach and brand claims. Performance figures that could not be re-verified have been replaced by the signal to track rather than reproduced; no reach, view-count or conversion percentage is asserted here. Download the full blueprint from the button at the top of this tab."]]
];

var SOCIAL = {
  US: [
    ["head", "Social commerce &amp; short-form video (US)", "Positioning, the US social-commerce shift, and the TikTok / Reels playbook for the market."],
    ["card", ["{C} The US is where the category's language was set: sneaker culture, the reveal, the flex. It is also where the brand configurators have pre-educated the largest audience and where the marketplace long tail has set the lowest price anchor. US creative should therefore do two jobs at once, speak to the person who has already personalised a pair and hit the ceiling of colour swaps, and answer the durability suspicion the cheap listings created. Lead with the build, the reveal and the finish."]]
  ],
  UK: [
    ["head", "Social commerce &amp; short-form video (UK)", "The UK and Europe social-commerce shift and the creator-led playbook."],
    ["card", ["{C} The UK rewards two things the rest of the arena under-uses: football and sport fandom, which lands harder here than almost anywhere, and provable claims, because the advertising regime is stricter. Lead with club and match-day designs as the entry point, keep every claim substantiable (original bases, hand-painted, water and scratch resistant, express delivery), and never imply a brand partnership. TikTok and Reels carry discovery; the collection page carries the sale."]]
  ],
  Global: [
    ["head", "Social commerce &amp; short-form video (Global)", "The same production system applied across the winnable rest-of-world markets."],
    ["card", ["{L} Across the affluent rest-of-world markets the format travels even where the reference does not. Build time-lapses, reveals and unboxings work identically in Berlin, Toronto, Sydney and Dubai; only the design on screen should change. Pair the content with an explicit total delivery promise, because in an international basket the unanswered question is never craft, it is when it arrives and what it lands at."]]
  ],
  India: [
    ["head", "Social commerce &amp; short-form video (India)", "Home-market heritage, community, and how the creator playbook is tuned for India."],
    ["card", [
      "{C} KNICKGASM is India's largest sneaker customiser, hand-painting one-of-one pairs in Mumbai on 100% original Nike Air Force 1, Jordan, Court Vision, Converse and Adidas bases, with a water and scratch resistant finish and a 10 to 15 day made-to-order window, shipping express to 60+ countries. Trust markers are organic and checkable: wear by Samay Raina, Rohit Sharma and Shraddha Kapoor.",
      "{C} At home the market is community-led rather than advertising-led, which changes what converts. Real customer photography, studio build footage and organic sightings outperform polished campaign film. Merchandise by fandom (anime, gaming, football and cricket, cars, celebrity) and by occasion (wedding, festive, milestone), and treat the export reach, 60+ countries from a Mumbai studio, as a domestic quality signal rather than an operations footnote."
    ]]
  ]
};

function socialInnerHTML(region, mode) {
  return renderNodes(SOCIAL[region], mode) + "\n" + renderNodes(SOCIAL_CORE, mode);
}

// Live competitor pricing snapshot (shared across regions; US + UK rows).
function pricingInnerHTML(mode) {
  return renderNodes(pricing.nodes(), mode);
}

/* ---- confidence legend (page) ---- */
function legendPage() {
  return '<div class="card p-5"><div class="text-[11px] uppercase tracking-[.06em] font-bold" style="color:var(--soft);">How to read the confidence tags</div><div class="mt-2 text-sm space-y-1" style="color:var(--knickgasm-ink);">' +
    "<div>" + tagChip("C") + "Cited source, competitor page, or retrieved figure.</div>" +
    "<div>" + tagChip("L") + "Strong inference across multiple named sources.</div>" +
    '</div><p class="text-[12px] mt-2" style="color:var(--soft);">Every figure here is sourced or a strong multi-source inference; speculative points have been excluded.</p></div>';
}

/* group a region's nodes into ordered category buckets */
function groupByCat(region) {
  var map = CATMAP[region];
  var groups = {};
  var cur = "overview";
  REPORTS[region].forEach(function (n) {
    if (n[0] === "sec") cur = map[n[1]] || "overview";
    if (!groups[cur]) groups[cur] = [];
    groups[cur].push(n);
  });
  return groups;
}

/* ---- public: the on-page report block inner HTML for a region ---- */
function reportInnerHTML(region) {
  var m = META[region];
  var base = "/docs/market-study/" + m.file;
  var head = '<div class="card p-5" style="border-color:var(--knickgasm-lava);"><div class="flex flex-wrap items-center gap-3"><div class="flex-1 min-w-[220px]"><div class="font-head text-lg text-knickgasm-green">' + m.panelTitle + '</div><div class="text-[12.5px]" style="color:var(--soft);">Prepared for ' + m.prep + " &middot; 9 July 2026 &middot; confidence-tagged throughout.</div></div>" +
    '<a class="btn-primary px-5 py-2.5 text-sm" href="' + base + '.pdf" download>Download PDF</a>' +
    '<a class="btn-lava px-5 py-2.5 text-sm" href="' + base + '.docx" download>Download DOC</a></div></div>';
  var synth = '<div class="card p-5" style="background:rgba(0,74,43,.05);"><div class="text-[11px] uppercase tracking-[.06em] font-bold lava-ink">KNICKGASM position, ' + region + '</div><p class="text-sm mt-1" style="color:var(--knickgasm-ink);">' + SYNTH[region] + "</p></div>";

  var groups = groupByCat(region);
  var present = CATS.filter(function (c) { return groups[c[0]] && groups[c[0]].length; });
  // insert the synthetic "D2C growth" tab right after Strategy & white space
  var ordered = [];
  var blueprintBtn = '<div class="card p-5" style="border-color:var(--knickgasm-lava);"><div class="flex flex-wrap items-center gap-3"><div class="flex-1 min-w-[220px]"><div class="font-head text-lg text-knickgasm-green">Strategic TikTok &amp; Reels Marketing Blueprint</div><div class="text-[12.5px]" style="color:var(--soft);">Multi-market creative &amp; ad optimization &middot; the full source document.</div></div><a class="btn-lava px-5 py-2.5 text-sm" href="/docs/market-study/KNICKGASM_Social_TikTok_Reels_Blueprint.docx" download>Download blueprint (DOC)</a></div></div>';
  present.forEach(function (c) {
    ordered.push({ key: c[0], label: c[1], html: renderNodes(groups[c[0]], "page") });
    if (c[0] === "strategy") {
      ordered.push({ key: "d2c", label: "D2C growth", html: d2cInnerHTML(region, "page") });
      ordered.push({ key: "social", label: "Social &amp; content", html: blueprintBtn + "\n" + socialInnerHTML(region, "page") });
      ordered.push({ key: "pricing", label: "Live pricing", html: pricingInnerHTML("page") });
    }
  });
  var tabs = ordered.map(function (c, i) {
    return '<button type="button" class="mstab' + (i === 0 ? " on" : "") + '" data-cat="' + c.key + '">' + c.label + "</button>";
  }).join("");
  var tabbar = '<div class="flex flex-wrap gap-2 mt-4" data-ms-cattabs>' + tabs + "</div>";
  var panels = ordered.map(function (c, i) {
    return '<div data-cat-panel="' + c.key + '" class="space-y-3 mt-4"' + (i === 0 ? "" : ' style="display:none"') + ">" + c.html + "</div>";
  }).join("\n");

  return head + "\n" + legendPage() + "\n" + synth + "\n" + tabbar + "\n" + panels;
}

/* ---- public: standalone HTML (reference) ---- */
function docHTML(region) {
  var m = META[region];
  var css = "body{font-family:Georgia,'Times New Roman',serif;color:#111111;line-height:1.45;max-width:760px;margin:0 auto;padding:24px;}" +
    "h1{color:#D0473E;font-size:26px;margin-bottom:2px;}h2{color:#D0473E;font-size:18px;border-bottom:2px solid #6A33D8;padding-bottom:3px;margin-top:26px;}h3{color:#D0473E;font-size:14px;margin-top:16px;}" +
    "table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0;}th{background:#D0473E;color:#FFFFFF;text-align:left;padding:5px;}td{border:1px solid #ccc;padding:5px;vertical-align:top;}" +
    "ul{margin:6px 0;}li{margin:3px 0;}p{margin:6px 0;}.kick{color:#8a6a2f;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;font-size:11px;}.sub{color:#555;font-style:italic;}" +
    "table{table-layout:fixed;}table th,table td{text-align:center;}table th:first-child,table td:first-child{text-align:left;}";
  var body = renderNodes(REPORTS[region], "doc");
  return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + m.panelTitle + "</title><style>" + css + "</style></head><body>" +
    '<p class="kick">Market Research and Competitive Study</p>' +
    "<h1>" + m.docTitle + "</h1>" +
    '<p class="sub">' + m.sub + "</p>" +
    "<p>Prepared for: " + m.prep + " &middot; Date: 9 July 2026 &middot; Confidence-tagged: [Certain] (cited) / [Likely] (strong multi-source inference). Speculative points excluded.</p>" +
    '<p><strong>KNICKGASM position (' + region + "):</strong> " + SYNTH[region] + "</p><hr>" +
    body +
    d2cInnerHTML(region, "doc") +
    socialInnerHTML(region, "doc") +
    pricingInnerHTML("doc") +
    "</body></html>";
}

/* =====================================================================
   DOCX (WordprocessingML) renderer, so downloads work without LibreOffice
   ===================================================================== */
function decodeEntities(s) {
  return String(s)
    .replace(/&#8377;/g, "₹").replace(/&rarr;/g, "→")
    .replace(/&middot;/g, "·").replace(/&pound;/g, "£")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
}
function xesc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function wRun(text, bold, colour) {
  var props = "";
  if (bold) props += "<w:b/>";
  if (colour) props += '<w:color w:val="' + colour + '"/>';
  var rpr = props ? "<w:rPr>" + props + "</w:rPr>" : "";
  return "<w:r>" + rpr + '<w:t xml:space="preserve">' + xesc(text) + "</w:t></w:r>";
}
function toRuns(raw) {
  var s = String(raw).replace(/\{C\}/g, "<b>[Certain]</b> ").replace(/\{L\}/g, "<b>[Likely]</b> ");
  s = decodeEntities(s);
  var parts = s.split(/(<b>|<\/b>)/);
  var bold = false, out = "";
  parts.forEach(function (p) {
    if (p === "<b>") { bold = true; return; }
    if (p === "</b>") { bold = false; return; }
    if (!p) return;
    out += wRun(p, bold);
  });
  return out;
}
function pHead(text, sz) {
  return '<w:p><w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="004A2B"/><w:sz w:val="' + sz + '"/></w:rPr><w:t xml:space="preserve">' + xesc(decodeEntities(text)) + "</w:t></w:r></w:p>";
}
function pItalic(text) {
  return '<w:p><w:r><w:rPr><w:i/><w:color w:val="555555"/></w:rPr><w:t xml:space="preserve">' + xesc(decodeEntities(text)) + "</w:t></w:r></w:p>";
}
function pRuns(runsXml) { return "<w:p>" + runsXml + "</w:p>"; }
function pBullet(runsXml) {
  return '<w:p><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>' + wRun("•  ") + runsXml + "</w:p>";
}
function wTable(headers, rows) {
  var borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map(function (e) {
    return "<w:" + e + ' w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>';
  }).join("");
  var tblPr = '<w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/><w:tblBorders>' + borders + "</w:tblBorders></w:tblPr>";
  var grid = "<w:tblGrid>" + headers.map(function () { return "<w:gridCol/>"; }).join("") + "</w:tblGrid>";
  function cell(inner, fill) {
    var shd = fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + fill + '"/>' : "";
    return "<w:tc><w:tcPr>" + shd + "</w:tcPr><w:p>" + inner + "</w:p></w:tc>";
  }
  var hr = "<w:tr>" + headers.map(function (h) { return cell(wRun(decodeEntities(h), true, "FBF5EA"), "004A2B"); }).join("") + "</w:tr>";
  var body = rows.map(function (r) {
    return "<w:tr>" + r.map(function (c) { return cell(toRuns(c)); }).join("") + "</w:tr>";
  }).join("");
  return "<w:tbl>" + tblPr + grid + hr + body + "</w:tbl>";
}
function docxDocumentXml(region) {
  var m = META[region];
  var body = pHead(m.docTitle, 34) + pItalic(m.sub) +
    pRuns(wRun("Prepared for: " + decodeEntities(m.prep) + ".  9 July 2026.  Confidence-tagged: [Certain] (cited) / [Likely] (strong multi-source inference). Speculative points excluded.")) +
    pRuns(wRun("KNICKGASM position (" + region + "): ", true) + wRun(SYNTH[region]));
  REPORTS[region].concat(D2C[region]).concat(D2C_UNIVERSAL).concat(SOCIAL[region]).concat(SOCIAL_CORE).concat(pricing.nodes()).forEach(function (n) {
    var t = n[0];
    if (t === "sec") { body += pHead(n[1] + ". " + n[2], 28); if (n[3]) body += pItalic(n[3]); }
    else if (t === "head") { body += pHead(n[1], 28); if (n[2]) body += pItalic(n[2]); }
    else if (t === "sub") { body += pHead(n[1], 24); }
    else if (t === "card") { n[1].forEach(function (p) { body += pRuns(toRuns(p)); }); }
    else if (t === "bul") { n[1].forEach(function (it) { body += pBullet(toRuns(it)); }); }
    else if (t === "tbl") { body += wTable(n[1], n[2]); if (n[3]) body += pItalic(decodeEntities(String(n[3]).replace(/\{C\}/g, "[Certain] ").replace(/\{L\}/g, "[Likely] "))); }
    else if (t === "cards") { n[2].forEach(function (it) { body += pHead(it[0], 24); body += pRuns(toRuns(it[1])); }); }
  });
  var sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body + sect + "</w:body></w:document>";
}

module.exports = { REGIONS: REGIONS, META: META, reportInnerHTML: reportInnerHTML, docHTML: docHTML, docxDocumentXml: docxDocumentXml };
