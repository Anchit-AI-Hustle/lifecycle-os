"use strict";
/**
 * Live competitor pricing snapshot for the Market Study "Live pricing" tab.
 *
 * Prices were fetched LIVE on 9 July 2026 (~12:54 to 13:05 UTC) from each
 * brand's official product page or its official Shopify /products/<handle>.json
 * storefront endpoint. Prices are volatile and promo-driven, so every row
 * carries a Source URL, a Confidence rating and the fetch time; re-run the
 * research agent before quoting these in a live decision. Blocked rows (bot
 * walls / geo / JS-only pricing) are marked "Needs manual verification" or
 * "Unavailable" and were NOT guessed. Currencies are kept as sold (USD vs GBP),
 * never converted.
 */

var FETCHED = "9 Jul 2026 ~13:00 UTC";
var F = FETCHED; // short alias for the per-row column

// 16 columns, in the exact requested order:
// Brand | Product | Market | Source | Regular | One-Time | Subscription |
// First-Order/Starter | Refill/Recurring | Servings | Price/Serving |
// Offer/Gifts | Guarantee | Confidence | Fetched | Notes
var HEADERS = [
  "Brand", "Product", "Market", "Source", "Regular", "One-Time", "Subscription",
  "First-Order / Starter", "Refill / Recurring", "Servings", "Price / Serving",
  "Offer / Gifts", "Guarantee", "Confidence", "Fetched", "Notes"
];

var ROWS = [
  ["<b>KNICKGASM</b>", "Coffee Collection (30-day)", "US", "knickgasm.com", "$49.99", "$44.99", "n/s", "-", "-", "40", "$1.12", "6 free gifts on kits", "n/v (UK 90-day)", "{L}", F, "Price + servings from official products.json; HTML PDP was 429."],
  ["<b>KNICKGASM</b>", "Coffee Collection (60-day kit)", "US", "knickgasm.com", "$149.99", "$99.99", "n/s", "-", "-", "120", "$0.83", "2-pack bundle", "n/v", "{L}", F, "Bundle variant, same source."],
  ["<b>KNICKGASM</b>", "Coffee Collection (30-day kit)", "UK", "knickgasm.com", "£44.99", "£29.99", "refill kit", "-", "£29.99/cycle", "40", "£0.75", "33% off; pause/cancel", "90-day money-back", "{C}", F, "Rendered PDP verified live."],
  ["<b>KNICKGASM</b>", "Coffee Collection (60-day kit)", "UK", "knickgasm.com", "£134.99", "£59.99", "refill kit", "-", "£59.99/cycle", "120", "£0.50", "53% off (~£19.99/pack)", "90-day money-back", "{C}", F, "Rendered PDP verified live."],
  ["RYZE Superfoods", "Mushroom Coffee (single bag)", "US", "ryzesuperfoods.com", "$45", "$27", "$36", "-", "$36", "30", "$0.90", "Free duffle, jar, magnet; free ship", "30-day money-back", "{C}", F, "Rendered PDP; all fields verified."],
  ["RYZE Superfoods", "Mushroom Coffee Starter Kit (2x)", "US", "ryzesuperfoods.com", "$80", "$49.50", "$66", "$49.50", "$66", "60", "$0.83", "+ free creamer & gifts", "30-day money-back", "{C}", F, "Ritual Set (60 serv) also $57.60 sale."],
  ["Everyday Dose", "Coffee+ (30) + free starter kit + creamer", "US", "everydaydose.com", "n/s", "$65", "n/v", "$65 bundle", "n/v", "30", "$2.17", "Free starter kit + creamer", "n/v", "{L}", F, "HTML 403; price+servings from products.json."],
  ["MUD\\WTR", ":rise Original Starter Kit (90)", "US", "mudwtr.com", "n/s", "$145", "$99.99", "$145", "$99.99/cycle", "90", "$1.61 / $1.11 sub", "Frother + guide", "n/v", "{L}", F, "Price from .json, sub % from .js; HTML 429."],
  ["MUD\\WTR", "Coffee Refill Bag (30)", "US", "mudwtr.com", "n/s", "$40", "n/v", "-", "$40", "30", "$1.33", "-", "n/v", "{L}", F, "Coffee-design refill (not hand-painted)."],
  ["Four Sigmatic", "Original Mushroom Coffee (instant)", "US", "us.foursigmatic.com", "$50", "$50", "$40", "$35 (1st)", "$40", "30", "$1.67 / $1.33 sub", "Subscribe & Save", "n/v", "{L}", F, "Geo-redirect; price .json, sub % .js; HTML 429."],
  ["Four Sigmatic", "Mushroom Coffee Starter Kit", "US", "us.foursigmatic.com", "$80", "$80", "n/v", "$80", "-", "~30 + gear", "~$2.67", "Kit + accessories", "n/v", "{L}", F, "Kit contents/servings not in feed."],
  ["Laird Superfood", "PERFORM Mushroom Coffee (ground, 12oz)", "US", "lairdsuperfood.com", "n/s", "$20", "$16", "-", "$16", "n/v", "n/v", "Sub 20%; 4-pack $76", "n/v", "{L}", F, "Ground (not instant); servings not published."],
  ["AG1 (Athletic Greens)", "AG1 powder (30-day) + Welcome Kit", "US", "drinkag1.com", "$99", "$99", "$79/mo", "-", "$79/mo", "30", "$3.30 / $2.63 sub", "Welcome kit: 5 packs, shaker, D3+K2", "90-day money-back", "{L}", F, "NEEDS MANUAL VERIFICATION - site 429/bot-walled on every path; figures are snippet-sourced, not a live fetch."],
  ["Gruns", "Gruns Low Sugar (28 packs)", "US", "gruns.co", "$79.99", "$79.99", "~$55.99", "$59.99 (1st)", "~$55.99", "28", "$2.86 / $2.14", "$20 off 1st; 30% off sub", "30-day", "{L}", F, "One-time .json; sub computed from on-page badge."],
  ["Bloom Nutrition", "Greens & Superfoods (30ct)", "US", "bloomnu.com", "$33.99", "$33.99", "$30.59", "-", "$30.59", "30", "$1.13 / $1.02", "Promo codes; sub 10% off", "n/v", "{C}", F, "Sub price confirmed in PDP JSON."],
  ["Huel", "Huel Daily Greens", "US", "huel.com", "n/s", "$56.50", "$45", "-", "$45", "30", "$1.88 / $1.50", "Free bottle + t-shirt", "Love-it money-back", "{C}", F, "Rendered PDP verified live."],
  ["Ka'Chava", "Whole Body Meal Shake (Chocolate)", "US", "kachava.com", "n/s", "$59.95", "~$50.96", "-", "~$50.96 (15% off)", "15", "$4.00 / ~$3.40", "Free variety pack on sub", "30-day Love-It", "{C}", F, "Rendered PDP; per-serving printed $3.99."],
  ["Amazing Grass", "Super Greens Original (30)", "US", "amazinggrass.com", "n/s", "$26.99", "~$22.94", "~$22.94 (1st)", "sub % n/v", "30", "$0.90 / ~$0.76", "15% off 1st; volume breaks", "n/v", "{L}", F, "Cheapest per-serving greens; 60-serv $43.99 ($0.73)."],
  ["Organifi", "Green Juice", "US", "organifishop.com", "$80.40", "$69.95", "~$62.96", "15% off 1st (SMS)", "~$62.96", "30", "$2.33 / ~$2.10", "Build-a-bundle; buy-3", "60-day money-back", "{C}", F, "Rendered PDP (301 from organifi.com)."],
  ["Supergreen Tonik", "SuperGreen TONIK (1-month)", "US", "supergreentonik.com", "$87", "$87", "none", "$87", "-", "30", "$2.85", "Free US ship; Mint/Berry", "365-day money-back", "{C}", F, "3-mo $227 ($2.52); 6-mo $377 ($2.09)."],
  ["Cymbiotika", "Super Greens", "US", "cymbiotika.com", "n/s", "$78", "up to 30% off (site)", "-", "n/v", "n/v", "n/v", "Site: subs up to 30% off", "60-day money-back (site)", "{L}", F, "Price from products.json; servings not in feed."],
  ["Dose (Dosedaily)", "Dose for your Liver / Cholesterol (2oz daily shot)", "US", "dosedaily.co", "n/s", "$90", "n/v", "-", "n/v", "n/v", "n/v", "Bundles $99-$160", "6-month clinical study (not MBG)", "{L}", F, "Correct functional 'Dose' = dosedaily.co; price from .json."],
  ["Moon Juice", "Magnesi-Om (Berry)", "US", "moonjuice.com", "n/s", "$44", "~$30.89 (30% off 1st)", "30% off 1st sub", "~10% off recurring", "30", "$1.47", "Sub 30% off first 3 + free ship", "n/v", "{L}", F, "One-time $44 from .json (live); sub % from snippet."],
  ["Apothekary", "Mind Over Matter (reishi/lion's mane/chaga)", "US", "apothekary.com", "$39", "$19.50", "n/s", "15% off 1st", "-", "20", "$0.98", "'Last Chance' 50% off (clearance)", "n/v", "{C}", F, "Rendered PDP; flagged clearance markdown."],
  ["Pique", "Sun Goddess Dunks (14ct)", "US", "piquelife.com", "n/s", "$48", "~15% off", "-", "~15% off", "14", "$3.43", "Lock-in sub price", "90-day risk-free", "{L}", F, "Price from products.json; sub % from snippet."],
  ["Clevr Colorways", "Dunks SuperLatte", "US", "clevrblends.com", "n/v", "n/v", "30% off (Subscribe & Save)", "-", "-", "~14", "n/v", "Subscribe & Save 30%", "n/v", "{L}", F, "NEEDS MANUAL VERIFICATION - HTTP 403 bot-block on PDP + .json; no reliable single-unit price."],
  ["Javy Coffee", "Coffee Concentrate (Original)", "US", "javvycoffee.com", "$24.95", "$24.95", "$17.47 (one variant)", "up to 38% off 1st", "n/v", "n/v (concentrate)", "n/v", "Up to 38% off 1st + free ship", "n/v", "{L}", F, "javycoffee.com redirects to javvycoffee.com; concentrate servings not on page."],
  ["Javy Coffee", "Protein Coffee", "US", "javvycoffee.com", "$39.95", "$39.95", "n/s", "see 1st-order offer", "-", "20", "$2.00", "Same 1st-order offer", "n/v", "{L}", F, "Servings on listing; per-serving computed."],
  ["Chamberlain Coffee", "Organic Ceremonial Dunks", "US", "chamberlaincoffee.com", "n/s", "$30", "n/v", "-", "n/v", "n/v", "n/v", "Dunks + coffee bundle $48", "n/v", "{L}", F, "No dedicated adaptogen line; dunks is the nearest functional SKU (.json)."],
  ["VitaCup", "Slim Protein Coffee Shake", "US", "vitacup.com", "n/s", "$29.95", "n/v", "-", "n/v", "n/v", "n/v", "Functional coffee line", "n/v", "{L}", F, "Functional hero from products.json."],
  ["Lifeboost", "Mindflow Morning Coffee (x1)", "US", "lifeboostcoffee.com", "n/s", "$27.99", "n/v", "-", "n/v", "n/v", "n/v", "Upgrade kit x3 $64.78", "n/v", "{L}", F, "Functional 'Mindflow' coffee from products.json."],
  ["Shroomi", "Lion's Mane Mushroom Coffee (roast, 10oz)", "US", "shroomihealth.com", "n/s", "$36.99", "n/v", "-", "n/v", "n/v", "n/v", "4-pack bundle $123.96", "n/v", "{L}", F, "Ground coffee; servings not in feed."],
  ["NeuRoast", "Classic Roast Ground Mushroom Coffee", "US", "neuroast.com", "$21.98", "$21.98", "n/v", "-", "n/v", "n/v", "n/v", "'3 for $40' email offer", "n/v", "{L}", F, "Entire line SOLD OUT at fetch; price listed not purchasable."],
  ["Spacegoods", "Rainbow Dust (1 bag)", "UK", "spacegoods.com", "n/s", "£49", "n/v", "-", "n/v", "~30", "~£1.63", "2 bags £79 (was £98); 3 £99 (was £147)", "n/v", "{L}", F, "Price from products.json; servings ~30 not label-verified."],
  ["DIRTEA", "DIRTEA Coffee (pouch)", "UK", "dirteaworld.com", "n/s", "£38", "n/v", "-", "n/v", "~30", "~£1.27", "75g pouch £19.99; travel 5x £10", "n/v", "{L}", F, "Price from products.json; servings not in feed."],
  ["London Nootropics", "Mojo Coffee (60 lace tags)", "UK", "londonnootropics.com", "£60", "£60", "£48", "starter bundle (n/p)", "£48", "60", "£1.00 / £0.80", "Sub 20% off; free UK ship >£30", "n/v", "{C}", F, "Rendered PDP verified live."],
  ["Rheal Superfoods", "Organic Clean Greens", "UK", "rhealsuperfoods.com", "n/s", "£25", "n/v", "-", "n/v", "~30", "~£0.83", "-", "n/v", "{L}", F, "Price from products.json; servings ~30 not label-verified."],
  ["Free Soul", "Vegan Protein (for women)", "UK", "freesoul.com", "£27.49", "£27.49", "£21.99", "free 1st-sub ship", "£21.99", "~20", "~£1.37 / £1.10", "Sub 20% off", "30-day refund", "{L}", F, "Price live; servings computed from 600g/30g."],
  ["Ancient + Brave", "True Collagen", "UK", "ancientandbrave.earth", "£32", "£32", "£25.60 (1st 3)", "£25.60 + free scoop/jar", "£28.80", "~40", "£0.80 / £0.64", "20% off 1st 3; free scoop+jar", "30-day confidence", "{C}", F, "Rendered PDP verified live."],
  ["Nuzest", "Good Green Vitality (300g)", "US", "nuzest-usa.com", "$95", "$95", "none", "-", "-", "30", "$3.17", "-", "n/v", "{C}", F, "No subscription; 600g/60 = $190."],
  ["Nuzest", "Good Green Vitality (300g)", "UK", "nuzest.co.uk", "£75", "£75", "none", "-", "-", "30", "£2.50", "-", "n/v", "{C}", F, "750g/75 = £150 (£2.00, best value)."],
  ["Beyond Craft", "Mushroom Coffee (hero)", "-", "-", "Unavailable", "Unavailable", "Unavailable", "-", "-", "n/v", "n/v", "-", "-", "{L}", F, "NOT REACHED this run - not assigned to a fetch batch; retry against official site to complete coverage."]
];

var NOTE = "All prices fetched LIVE on " + FETCHED + " from official product pages or official Shopify products.json endpoints. Prices are volatile and promo-driven; treat as a point-in-time snapshot and re-fetch before quoting. n/s = not shown on page, n/v = not verified live, n/p = not priced on that page. Currencies as sold (USD/GBP), not converted. {C} High/Medium (official page), {L} Low or needs-manual-verification (bot-walled / JS-only / snippet).";

var ANALYSIS = [
  ["sub", "Competitive read (from the live snapshot above)"],
  ["cards", 2, [
    ["Cheapest first-order offer", "Apothekary Mind Over Matter at $19.50 (a 50% clearance markdown) is the lowest absolute entry price; among sustained offers, RYZE ($27 single bag) and Amazing Grass (~$22.94) lead. KNICKGASM UK's £29.99 30-day kit is the aggressive entry in GBP."],
    ["Cheapest recurring / refill", "In greens, Bloom ($1.02/serving) and Amazing Grass (~$0.76) are the lowest per-serving recurring. In adaptogen coffee, KNICKGASM UK (£0.50 to £0.75/serving on the kits) and RYZE ($0.83 to $0.90) are the lowest recurring per-pair."],
    ["Highest premium-priced", "Ka'Chava ($4.00/serving) and Nuzest US ($3.17), then AG1 ($3.30 one-time / $2.63 sub) and Pique dunks ($3.43) sit at the premium ceiling."],
    ["Best value per serving", "Amazing Grass ($0.73 to $0.90) and Bloom ($1.02 to $1.13) win on greens; KNICKGASM Coffee Collection is the standout on adaptogen-coffee value at $0.83 to $1.12 (US) and £0.50 to £0.75 (UK) per pair, well under Four Sigmatic ($1.33 to $1.67), MUD\\WTR ($1.11 to $1.61) and London Nootropics (£0.80 to £1.00)."],
    ["Most aggressive starter kit", "RYZE ($49.50 for 60 servings + gifts) and KNICKGASM's 60-day kits (US $99.99 / UK £59.99, 120 servings) offer the deepest per-serving step-down; MUD\\WTR's $145 90-serving kit is the priciest entry."],
    ["Strongest bundle / gift", "RYZE (duffle + jar + creamer + magnet), AG1 (welcome kit: travel packs + shaker + D3+K2) and Huel (free bottle + t-shirt) lead on gift stacking; KNICKGASM's 6-free-gifts on kits is directly comparable."]
  ]],
  ["sub", "KNICKGASM's price positioning"],
  ["bul", [
    "<b>Absolute price:</b> mid-pack. KNICKGASM US Coffee Collection ($44.99 one-time) sits between the mushroom-coffee challengers (RYZE $27, Four Sigmatic $50) and the greens premium tier (AG1 $99, Ka'Chava $59.95).",
    "<b>Price per serving:</b> KNICKGASM is one of the best-value adaptogen coffees on a per-pair basis, $0.83 to $1.12 (US) and £0.50 to £0.75 (UK), undercutting Four Sigmatic, MUD\\WTR and London Nootropics per pair while carrying a real KSM-66 + sneaker heritage.",
    "<b>Starter-kit value:</b> competitive. The 60-day kits ($99.99 / £59.99, 120 servings + 6 free gifts) match RYZE's gift-heavy starter economics.",
    "<b>Recurring price:</b> KNICKGASM's refill-kit model is priced at or below the challenger set per serving; the main gap is that a discrete always-on subscription discount is less prominent than RYZE / Four Sigmatic's explicit 20 to 40% sub badges.",
    "<b>Subscription competitiveness:</b> opportunity, not weakness, most rivals lead with a loud subscribe-and-save %; KNICKGASM can surface an equally clear recurring price and a longer guarantee (its 90-day UK money-back already beats RYZE/Four Sigmatic's 30-day).",
    "<b>Perceived premium:</b> KNICKGASM reads premium but not top-of-ceiling, it is materially cheaper per pair than AG1/Ka'Chava/Pique while telling a stronger origin + clinical story, so it is fairly-to-underpriced on value, not overpriced."
  ]],
  ["sub", "Recommended pricing / offer strategy"],
  ["bul", [
    "Lead marketing with <b>price-per-pair</b>, not pack price: at roughly $1 (and £0.50 to £0.75 in the UK) KNICKGASM beats most named rivals per serving and that is the number to headline.",
    "Make the recurring offer <b>as legible as RYZE/Four Sigmatic</b>: a single, prominent subscribe price and % saving, plus keep the 90-day guarantee front-and-centre (longer than the category's 30-day norm).",
    "Hold the <b>6-free-gifts kit</b> as the acquisition hero (it matches RYZE's gift stack and AG1's welcome kit) and anchor the 120-serving kit's ~$0.83 / £0.50 per-pair as the value proof.",
    "Do <b>not</b> chase the sub-$1 greens floor (Amazing Grass/Bloom), that is a different category; compete on adaptogen-coffee value + origin authenticity where KNICKGASM already wins per pair.",
    "Position explicitly against the premium ceiling (AG1, Ka'Chava): 'the same daily streetwear ritual, real origin and KSM-66, at a third of the per-serving price.'"
  ]],
  ["sub", "Brands that could not be verified live (and why)"],
  ["bul", [
    "<b>AG1</b> - drinkag1.com bot-walls every path (persistent 429 on fetch + curl); figures are snippet-sourced, needs manual browser verification.",
    "<b>Clevr Colorways</b> - HTTP 403 bot-block on PDP and products.json; no reliable single-unit price captured.",
    "<b>Beyond Craft</b> - not reached this run (not assigned to a fetch batch); retry against its official site to complete coverage.",
    "<b>Servings/price-per-serving unverified</b> for several coffee SKUs (Laird, Four Sigmatic kit, Javy concentrate, MUD\\WTR, Cymbiotika, Dose, Shroomi, Spacegoods, DIRTEA, Rheal, VitaCup, Lifeboost, Chamberlain, NeuRoast): the price is live but the pack serving-count was not on the fetched feed, so per-pair is either computed-from-title or left n/v.",
    "Everything marked {L} / 'Needs manual verification' should be re-fetched from a browser-rendered path before use in an external claim."
  ]],
  ["card", ["Method: five research passes fetched official product pages via WebFetch and, where sites bot-walled the HTML (429/403), via each store's official Shopify /products/&lt;handle&gt;.json and .js endpoints through the session proxy. No price was taken from model memory or cache; unverifiable prices are marked, not guessed. Snapshot time: " + FETCHED + "."]]
];

// Returns the node array for the "Live pricing" tab (consumed by renderNodes).
function nodes() {
  return [
    ["head", "Live competitor pricing (fetched " + FETCHED + ")", "A point-in-time, source-linked price scan of KNICKGASM and the functional-coffee / greens / adaptogen / streetwear-powder set. Prices are volatile, re-fetch before quoting."],
    ["card", [NOTE]],
    ["tbl", HEADERS, ROWS, "Every brand in the research scope appears above; blocked/unverifiable rows are marked rather than dropped or guessed."]
  ].concat(ANALYSIS);
}

module.exports = { nodes: nodes, FETCHED: FETCHED, HEADERS: HEADERS, ROWS: ROWS };
