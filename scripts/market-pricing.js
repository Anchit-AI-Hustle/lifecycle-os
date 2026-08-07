"use strict";
/**
 * Live competitor pricing snapshot for the Market Study "Live pricing" tab.
 *
 * KNICKGASM rows are read straight off the built catalogs
 * (data/catalog/products_us.json in USD, products_uk.json in GBP) so they are
 * exact, not estimated. Competitor rows were checked on 9 July 2026 (~12:54 to
 * 13:05 UTC) against each brand's official product page. Custom-sneaker pricing
 * is commission-led and highly variable, so any figure we could not read off an
 * official page is marked "Needs manual verification" or "Unavailable" and was
 * NOT guessed. Bespoke one-off studios quote per commission and are recorded as
 * POA rather than given a fake number. Currencies are kept as sold (USD vs GBP),
 * never converted.
 */

var FETCHED = "9 Jul 2026 ~13:00 UTC";
var F = FETCHED; // short alias for the per-row column

// 16 columns, in the exact requested order:
// Brand | Product | Market | Source | Regular | Now / Sale | Base sneaker |
// Customisation type | Lead time | Sizes | Price band | Offer / Gifts |
// Guarantee | Confidence | Fetched | Notes
var HEADERS = [
  "Brand", "Product", "Market", "Source", "Regular", "Now / Sale", "Base sneaker",
  "Customisation", "Lead time", "Sizes", "Price band", "Offer / Gifts",
  "Guarantee", "Confidence", "Fetched", "Notes"
];

var ROWS = [
  ["<b>KNICKGASM</b>", "Spiderman x Nike Air Force 1", "US", "knickgasm.com", "$216.34", "$167.68", "Nike Air Force 1 (original)", "Hand-painted, water &amp; scratch resistant", "10 to 15 days", "UK3 to UK12", "AF1 core", "Free rope laces on kicks orders", "Made-to-order, sizing exchange", "{C}", F, "Exact figures from the built US catalog."],
  ["<b>KNICKGASM</b>", "Air Force 1 customs (whole range)", "US", "knickgasm.com", "-", "$115.47 to $261.95 (median ~$156)", "Nike Air Force 1 (original)", "Hand-painted one-of-one", "10 to 15 days", "UK3 to UK12", "$115 to $262", "Collection bundles", "Made-to-order", "{C}", F, "349 live AF1 SKUs in products_us.json."],
  ["<b>KNICKGASM</b>", "Air Jordan customs", "US", "knickgasm.com", "-", "$174.97 to $226.29", "Nike Air Jordan (original)", "Hand-painted one-of-one", "10 to 15 days", "UK3 to UK12", "Grail tier", "-", "Made-to-order", "{C}", F, "8 live Jordan SKUs; highest average order value in the range."],
  ["<b>KNICKGASM</b>", "Court Vision customs", "US", "knickgasm.com", "-", "$103.67 to $152.06", "Nike Court Vision (original)", "Hand-painted one-of-one", "10 to 15 days", "UK3 to UK12", "Entry tier", "-", "Made-to-order", "{C}", F, "35 SKUs; the accessible way into a one-of-one pair."],
  ["<b>KNICKGASM</b>", "Converse customs", "US", "knickgasm.com", "-", "$99.84 to $138.79", "Converse Chuck (original)", "Hand-painted on canvas", "10 to 15 days", "UK3 to UK12", "Entry tier", "-", "Made-to-order", "{C}", F, "19 SKUs; canvas takes line-work better than leather."],
  ["<b>KNICKGASM</b>", "Adidas Samba customs", "US", "knickgasm.com", "-", "$153.60 to $203.43", "Adidas (original)", "Hand-painted one-of-one", "10 to 15 days", "UK3 to UK12", "AF1 core to grail", "-", "Made-to-order", "{C}", F, "9 SKUs; the fastest-trending silhouette in the range."],
  ["<b>KNICKGASM</b>", "Travis Scott Denim Jacket", "US", "knickgasm.com", "$85.81", "$64.35", "n/a (denim)", "Hand-painted denim", "10 to 15 days", "S to XXL", "Apparel", "Pairs with a matching custom", "Made-to-order", "{C}", F, "Three jacket SKUs, all at the same price point."],
  ["<b>KNICKGASM</b>", "Chunky Rope Laces For Sneakers", "US", "knickgasm.com", "$10.55", "$7.91", "n/a (accessory)", "Colour-matched rope laces", "Ships from stock", "One size", "Accessory", "Basket-builder / free-gift lever", "n/a", "{C}", F, "Lowest price point in the catalog; the natural AOV add-on."],
  ["<b>KNICKGASM</b>", "Lace Tags (Custom)", "US", "knickgasm.com", "$12.19", "$9.14", "n/a (accessory)", "Engraved lace tags", "Ships from stock", "One size", "Accessory", "Attach-rate play", "n/a", "{C}", F, "Second accessory SKU; pairs with rope laces."],
  ["<b>KNICKGASM</b>", "Air Force 1 customs (whole range)", "UK", "knickgasm.com", "-", "&pound;91.85 to &pound;208.37 (median ~&pound;124)", "Nike Air Force 1 (original)", "Hand-painted one-of-one", "10 to 15 days", "UK3 to UK12", "AF1 core", "Express worldwide shipping", "Made-to-order", "{C}", F, "Same 436-SKU catalog, GBP pricing from products_uk.json."],
  ["<b>KNICKGASM</b>", "Air Jordan customs", "UK", "knickgasm.com", "-", "&pound;139.18 to &pound;180.00", "Nike Air Jordan (original)", "Hand-painted one-of-one", "10 to 15 days", "UK3 to UK12", "Grail tier", "-", "Made-to-order", "{C}", F, "Grail tier lands below the UK bespoke-studio floor."],
  ["<b>KNICKGASM</b>", "Converse customs", "UK", "knickgasm.com", "-", "&pound;79.42 to &pound;110.40", "Converse Chuck (original)", "Hand-painted on canvas", "10 to 15 days", "UK3 to UK12", "Entry tier", "-", "Made-to-order", "{C}", F, "Cheapest full custom pair in the UK range."],
  ["<b>KNICKGASM</b>", "Denim jackets", "UK", "knickgasm.com", "&pound;68.25", "&pound;51.19", "n/a (denim)", "Hand-painted denim", "10 to 15 days", "S to XXL", "Apparel", "-", "Made-to-order", "{C}", F, "Juice WRLD, Pop Smoke and Travis Scott jackets, one price."],
  ["<b>KNICKGASM</b>", "Rope laces / lace tags", "UK", "knickgasm.com", "&pound;8.39 / &pound;9.70", "&pound;6.29 / &pound;7.27", "n/a (accessory)", "Laces and engraved tags", "Ships from stock", "One size", "Accessory", "Basket-builder", "n/a", "{C}", F, "The two UK accessory SKUs."],
  ["Nike By You", "Air Force 1 Low By You", "US", "nike.com", "n/v", "n/v", "Nike Air Force 1", "Configurator, panel colour swaps only", "Nike-stated build window", "Full US run", "Brand-run", "Nike member perks", "Nike returns policy", "{L}", F, "NEEDS MANUAL VERIFICATION - configurator prices are JS-only, not readable from the fetched HTML. Not a one-of-one: no artwork, no hand-painting."],
  ["Converse By You", "Chuck Taylor All Star By You", "US", "converse.com", "n/v", "n/v", "Converse Chuck Taylor", "Configurator, colour/print swaps", "Brand-stated build window", "Full US run", "Brand-run", "-", "Converse returns policy", "{L}", F, "NEEDS MANUAL VERIFICATION - price only rendered inside the builder."],
  ["Vans Customs", "Authentic / Old Skool Customs", "US", "vans.com", "n/v", "n/v", "Vans Authentic, Old Skool", "Configurator, prints and patches", "Brand-stated build window", "Full US run", "Brand-run", "-", "Vans returns policy", "{L}", F, "NEEDS MANUAL VERIFICATION - builder is JS-only. Closest mass-market analogue to a custom, but templated."],
  ["The Shoe Surgeon", "Bespoke commissions and build classes", "US", "theshoesurgeon.com", "POA", "POA", "Client-supplied or sourced", "Full deconstruct and rebuild, exotic leathers", "Commission-length", "Made to the client", "Bespoke ceiling", "-", "Commission terms", "{L}", F, "Prices quoted per commission, not listed. Recorded as POA rather than guessed. Sets the ceiling of the arena."],
  ["Ceeze", "One-off artist commissions", "US", "ceeze.com", "POA", "POA", "Client-supplied", "Hand-painted, artist-led", "Commission-length", "Client pair", "Bespoke ceiling", "-", "Commission terms", "{L}", F, "Commission-only artist studio; no public price list to fetch."],
  ["Kickstradomis", "Artist customs", "US", "kickstradomis.com", "POA", "POA", "Client-supplied", "Hand-painted, artist-led", "Commission-length", "Client pair", "Bespoke ceiling", "-", "Commission terms", "{L}", F, "Commission-only; no catalog pricing published."],
  ["Sierato", "Artist customs and drops", "US", "sierato.com", "n/v", "n/v", "Sourced originals", "Hand-painted drops", "Drop-dependent", "Limited runs", "Bespoke to grail", "-", "n/v", "{L}", F, "NEEDS MANUAL VERIFICATION - drop pages were empty at fetch time."],
  ["Etsy custom-sneaker sellers", "Independent hand-painted AF1 listings", "US", "etsy.com", "n/v", "n/v", "Seller-sourced, originality varies", "Hand-painted, quality varies widely", "Seller-stated", "Seller-stated", "Long tail", "Coupon-led", "Etsy buyer protection", "{L}", F, "NEEDS MANUAL VERIFICATION - marketplace, thousands of sellers, no single price. The main price-anchoring pressure on the category."],
  ["CrepDog Crew", "Sneaker retail and drops", "India / Global", "crepdogcrew.com", "n/v", "n/v", "Resale originals", "None (retail, not custom)", "Ships from stock", "Full run", "Retail", "Drop-led", "Store policy", "{L}", F, "NEEDS MANUAL VERIFICATION - resale pricing moves per SKU. Competes for the same sneakerhead wallet, not on customisation."],
  ["VegNonVeg", "Sneaker and streetwear retail", "India", "vegnonveg.com", "n/v", "n/v", "Authorised originals", "None (retail)", "Ships from stock", "Full run", "Retail", "Seasonal sale", "Store policy", "{L}", F, "NEEDS MANUAL VERIFICATION - retail catalog, not a customiser."],
  ["Superkicks", "Sneaker retail and care", "India", "superkicks.in", "n/v", "n/v", "Authorised originals", "None (retail) + care products", "Ships from stock", "Full run", "Retail", "-", "Store policy", "{L}", F, "NEEDS MANUAL VERIFICATION. Relevant as the care/restoration adjacency, not the custom fight."],
  ["Hypefly", "Sneaker resale", "India", "hypefly.co.in", "n/v", "n/v", "Resale originals", "None (resale)", "Ships from stock", "Full run", "Resale", "-", "Authentication guarantee", "{L}", F, "NEEDS MANUAL VERIFICATION - grail resale prices are per-listing."],
  ["Jason Markk", "Essential sneaker cleaning kit", "US", "jasonmarkk.com", "n/v", "n/v", "n/a (care)", "n/a", "Ships from stock", "One size", "Care", "Bundle kits", "n/v", "{L}", F, "NEEDS MANUAL VERIFICATION. Listed because sneaker care is the adjacency KNICKGASM already sells into."],
  ["Crep Protect", "Protect spray and cleaning kits", "UK", "crepprotect.com", "n/v", "n/v", "n/a (care)", "n/a", "Ships from stock", "One size", "Care", "Bundle kits", "n/v", "{L}", F, "NEEDS MANUAL VERIFICATION - PDP price is rendered client-side."],
  ["Angelus Direct", "Leather paints and finishers", "US", "angelusdirect.com", "n/v", "n/v", "n/a (supplies)", "n/a", "Ships from stock", "n/a", "Supplies", "-", "n/v", "{L}", F, "NEEDS MANUAL VERIFICATION. Supply-side, not a competitor; it is what most hand-painters buy, including at the low end of Etsy."],
  ["UK bespoke customisers (set)", "Commissioned one-off pairs", "UK", "-", "Unavailable", "Unavailable", "Client-supplied", "Hand-painted, commission-led", "Commission-length", "Client pair", "Bespoke", "-", "-", "{L}", F, "NOT REACHED this run - no UK bespoke studio was assigned to a fetch batch; retry against official sites to complete coverage."]
];

var NOTE = "KNICKGASM rows are exact, read from the built catalogs (products_us.json in USD, products_uk.json in GBP) on " + FETCHED + ". Competitor rows were checked against official product pages at the same time. Custom-sneaker pricing is commission-led and volatile; treat this as a point-in-time snapshot and re-fetch before quoting. n/s = not shown on page, n/v = not verified live, POA = price on application (quoted per commission, never listed). Currencies as sold (USD/GBP), not converted. {C} High (catalog or official page), {L} Low or needs-manual-verification (JS-only builder, commission-only, or marketplace).";

var ANALYSIS = [
  ["sub", "Competitive read (from the live snapshot above)"],
  ["cards", 2, [
    ["Cheapest way into the brand", "Rope laces at $7.91 (&pound;6.29) and lace tags at $9.14 (&pound;7.27) are the lowest entry points in the whole catalog. They are not margin drivers, they are the basket-builder and the free-gift lever that makes a first order feel generous."],
    ["Cheapest full custom pair", "Converse customs from $99.84 (&pound;79.42) and Court Vision from $103.67 (&pound;82.46) are the accessible one-of-one tier, the pairs that convert a first-time buyer who is not yet ready for an AF1 grail."],
    ["The core price band", "Air Force 1 customs carry the range: $115.47 to $261.95, median ~$156 (UK &pound;91.85 to &pound;208.37, median ~&pound;124). 349 of the 436 live SKUs sit here, so this band effectively is the KNICKGASM price."],
    ["Grail tier", "Air Jordan customs ($174.97 to $226.29) and Adidas Samba customs ($153.60 to $203.43) are the collector end of the catalog and the highest average order value, without ever approaching bespoke-studio commission pricing."],
    ["The bespoke ceiling", "The Shoe Surgeon, Ceeze and Kickstradomis quote per commission rather than listing prices. They define the ceiling of the arena and set the cultural benchmark for craft, but they cannot serve a customer who wants to click and buy a finished pair today."],
    ["The price floor", "Independent Etsy sellers are the real downward pressure. They compete on price alone and vary wildly on base-sneaker originality and paint durability, which is exactly where KNICKGASM's 100% original base and water &amp; scratch resistant finish do the work."]
  ]],
  ["sub", "KNICKGASM's price positioning"],
  ["bul", [
    "<b>Absolute price:</b> mid-pack and deliberately so. A median AF1 custom at ~$156 sits well above a templated brand configurator and well below a bespoke commission, which is the only band where a genuinely hand-painted one-of-one can be bought off the shelf.",
    "<b>Against brand configurators (Nike By You, Converse By You, Vans Customs):</b> those are colour swaps on a template, not artwork. KNICKGASM is not competing on price there, it is competing on the fact that no two pairs exist twice.",
    "<b>Against bespoke studios:</b> commission studios are POA and months-long. KNICKGASM ships a finished one-of-one in 10 to 15 days at a listed price, which is a completely different purchase decision.",
    "<b>Against the Etsy long tail:</b> the honest differentiators are the base (100% original Nike, Jordan, Converse, Adidas) and the finish (water &amp; scratch resistant), not a lower price. Do not race to the floor.",
    "<b>Apparel and accessories:</b> denim jackets at $64.35 (&pound;51.19) and the two accessory SKUs give the catalog a full price ladder from under $10 to over $260, which most single-silhouette customisers do not have.",
    "<b>Range depth:</b> 436 live SKUs across anime, cars, football, gaming, wedding, pets, bling, Taylor Swift, celebrity, embroidery and the coffee-ART collection. Almost no competitor in the arena carries a browsable finished-designs catalog at this depth."
  ]],
  ["sub", "Recommended pricing / offer strategy"],
  ["bul", [
    "Lead with the <b>base sneaker and the finish</b>, not a discount: 100% original Nike Air Force 1 or Jordan, hand-painted by India's best artists, water &amp; scratch resistant. That is the sentence that justifies the gap over the Etsy floor.",
    "Use <b>Converse and Court Vision customs as the entry rung</b> in acquisition creative, and let Air Force 1 and Jordan carry retention and gifting, where the grail framing does more work than the price.",
    "Make the <b>10 to 15 day made-to-order window</b> a stated promise everywhere, including on ads. Buyers accept a wait when they know the pair is being painted for them; they abandon when the wait is a surprise at checkout.",
    "Attach <b>rope laces and lace tags</b> to every kicks order as the standard basket-builder. At $7.91 and $9.14 they lift average order value without ever reading as a discount.",
    "Position explicitly between the two poles: 'a genuine one-of-one, on an original pair, without a commission queue or a commission price.'"
  ]],
  ["sub", "Brands that could not be verified live (and why)"],
  ["bul", [
    "<b>Nike By You, Converse By You, Vans Customs</b> - the configurator price is rendered client-side and is not in the fetched HTML; needs a browser-rendered check.",
    "<b>The Shoe Surgeon, Ceeze, Kickstradomis</b> - commission-only studios that publish no price list. Recorded as POA rather than given an invented figure.",
    "<b>Etsy custom-sneaker sellers</b> - a marketplace of thousands of independent listings, so there is no single price to record; sample it as a band, not a number.",
    "<b>Retail and resale (CrepDog Crew, VegNonVeg, Superkicks, Hypefly)</b> - per-SKU resale pricing moves constantly; these are wallet competitors, not customisation competitors.",
    "<b>Care and supplies (Jason Markk, Crep Protect, Angelus Direct)</b> - PDP prices render client-side; listed here because sneaker care and restoration is the adjacency KNICKGASM already sells into.",
    "Everything marked {L} / 'Needs manual verification' should be re-fetched from a browser-rendered path before use in an external claim."
  ]],
  ["card", ["Method: KNICKGASM figures were read directly from the built catalogs (data/catalog/products_us.json and products_uk.json), so they match the live storefront exactly. Competitor pages were fetched via WebFetch; where a site rendered pricing only in a client-side builder, or quotes per commission, the row is marked rather than estimated. No price was taken from model memory. Snapshot time: " + FETCHED + "."]]
];

// Returns the node array for the "Live pricing" tab (consumed by renderNodes).
function nodes() {
  return [
    ["head", "Live competitor pricing (fetched " + FETCHED + ")", "A point-in-time, source-linked price scan of KNICKGASM against the custom-sneaker arena: bespoke commission studios, brand-run configurators, the independent-seller long tail, sneaker retail/resale and the care and restoration adjacency. Prices are volatile, re-fetch before quoting."],
    ["card", [NOTE]],
    ["tbl", HEADERS, ROWS, "Every brand in the research scope appears above; blocked, commission-only or unverifiable rows are marked rather than dropped or guessed."]
  ].concat(ANALYSIS);
}

module.exports = { nodes: nodes, FETCHED: FETCHED, HEADERS: HEADERS, ROWS: ROWS };
