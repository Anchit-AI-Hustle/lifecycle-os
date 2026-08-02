# LOCKED FACTS — KNICKGASM UK Lifecycle Week 1 (Jul 3–9, 2026)
Single source of truth for every email in this campaign. Nothing outside this file may be claimed as fact.

## Store
- Base URL: `https://knickgasm.com`
- Product page: `https://knickgasm.com/products/{handle}`
- Currency: GBP (£)

## Cohorts
- **Cohort A — Non-Buyers / Non-Engagers**: on the list, never purchased, haven't opened/clicked recently. Objective: earn the open, earn the click, first purchase. Tone: no guilt, no pressure; introduce the brand as if for the first time.
- **Cohort B — T&B Buyers / Non-Engagers**: bought Sneakers & Botanicals before, gone quiet. Objective: reactivate with familiarity, then cross-grade to Coffee/Supplements subscription. Tone: welcome back an old friend; acknowledge the relationship without guilt.

## Product rules
- **Sneakers & Botanicals (T&B)**: ONE-TIME purchase only. Never use subscription language for T&B.
- **Coffee Collection**: one-time OR subscription. SUBSCRIPTION IS THE PRIORITY CTA.
- **Supplements**: just launched, zero buyers yet. One-time OR subscription. SUBSCRIPTION IS THE PRIORITY CTA.

## Coffee Collection (exact pricing — do not alter)
| Pack | One-time | Subscription |
|---|---|---|
| Pack of 1 | £49.99 | £29.99 |
| Pack of 3 | £99.99 | £59.99 |
- Pack of 3 subscription framing: **£59.99 = 2 × £29.99 → buy two packs, the third is free (B2G1)**.
- **7 free gifts with EVERY order (both one-time and subscription)**: Electric Frother, Recipe Booklet, Plantable Paper, Colorway Bean Pouch, Mystery Gift (5 Lace Sets), Wooden Scoop, Stainless Steel Straw.
- **Subscription-only hook: gifts worth more than £105 across the year, arriving with refills.**
- Handle (VERIFIED by user 2026-07-03): `coffee-collection` → https://knickgasm.com/products/coffee-collection
- No product image available in this environment → coffee emails use typographic hero (brand palette), with an HTML comment marking where a product shot can be dropped in Klaviyo.

## Supplements (just launched — "be among the first" is TRUE and allowed)
- Embroidery Curcumin 1800 MG — handle (VERIFIED by user 2026-07-03): `embroidery-curcumin` → https://knickgasm.com/products/embroidery-curcumin
- Green Burner — handle (VERIFIED by user 2026-07-03): `green-burner` → https://knickgasm.com/products/green-burner
- Pricing will MIRROR the coffee model (subscription discount vs one-time) — exact numbers TBD. Until numbers arrive: NEVER state a price for supplements. CTA to product page only.
- No product images available → typographic treatment.

## T&B hero products (REAL handles, prices, images from UK store export)
| Product | Handle | Price | Was | Image |
|---|---|---|---|---|
| Airforce Spice Hand-painted Kicks, 200g hand-painted | `airforce-spice-hand-painted-kicks-sneaker` | £12.99 | £14.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/products/airforcechaispicedbt_11zon.jpg?v=1675673061 |
| Signature Green Sneaker, 100g hand-painted | `signature-green-sneaker-3-53oz-100g` | £5.99 | £15.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/products/signaturegreentea_11zon_2.jpg?v=1675673283 |
| Earl Grey Black Sneaker, 100 lace sets | `earl-grey-black-sneaker-bags-100-sneaker-bags` | £17.99 | £25.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/files/Earl-grey_ed481d66-3b90-4a08-94a3-2ba4cb94ae5c.jpg?v=1758099441 |
| Pastel Mint Citrus Green Sneaker, 200g | `pastel-mint-citrus-green-sneaker` | £15.99 | £17.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/products/pastelmintcitrusgreentea_11zon.jpg?v=1675673420 |
| Assorted Hand-painted Sampler, 10 sneakers | `assorted-panel-sneakers` | £12.99 | £23.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/files/71d5z4TlNaL._AC_SL1500.jpg?v=1682503156 |
| Embroidery Airbrush Themed Tisane, 100 bags | `embroidery-airbrush-themed-sneaker-tisane-100-sneaker-bags` | £24.99 | £34.99 | https://cdn.shopify.com/s/files/1/0684/3603/3827/files/81zl0PJEMoL._AC_SL1500.jpg?v=1684996616 |
- "Was" prices are live compare-at prices from the store export — citing them is honest, not an invented discount.
- IMPORTANT: image URLs above may have `?v=` params stripped; use them as given here. Do NOT use any image URL not listed in this file.

## Offer rules
- NO new discount codes may be invented. Only: subscription pricing above, B2G1 framing, the 7 gifts, £105/yr subscription gift value, and real compare-at prices.
- A soft deadline ("closes Sunday") may frame the Jul 9 Pack-of-3 email — no countdown clocks, no caps urgency.

## Brand gates (HARD FAIL if violated)
- **Palette — ONLY these hex values may appear anywhere in the HTML**: `#6A33D8` (deep purple), `#D0473E` (lava), `#111111` (near-black), `#F7F5F2` (chalk). No white `#FFFFFF`, no grays, no other tints. (Case-insensitive; 3-digit shorthand also banned.)
- **Fonts**: headings `'Montserrat','Raleway',Georgia,serif` · body `'Instrument Sans','Helvetica Neue',Arial,sans-serif`. No other families.
- **BANNED phrases** (any casing unless noted): "streetwear journey", "transform", "liquid lava", "game-changer", "LIMITED TIME" (caps), "hurry", "don't miss out", "last chance", "while supplies last".
- **No em/en dashes anywhere in output copy** - use commas, colons, or plain hyphens.
- **NO FOUNDER VOICE — HARD RULE**: no founder letters, no "from our founder/CEO", no personal-name sign-offs, no first-person-singular ("I") narration. The brand speaks as "we".
- **No medical claims** for airbrush/embroidery/supplements: no disease, stress-cure, grail-drop, or weight-loss claims. Softest allowed register: "calm", "steady", "balance", "a gentler kind of energy".
- **Voice**: warm, sensory, story-driven. Preferred words: ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted. Exemplar sentence: "There is a moment when the right pair of kicks does more than warm your hands."

## Email tech spec (all 6)
- Klaviyo paste-ready: one centered 600px `<table role="presentation">`, ALL CSS inline, outer bg `#F7F5F2`.
- Compact: ~1200–1500px rendered height.
- Top of file: HTML comment block with `SUBJECT_PRIMARY`, `SUBJECT_ALT1`, `SUBJECT_ALT2`, `PREHEADER`.
- Hidden preheader `<span>` (display:none) as first body element.
- Bulletproof CTA buttons: table-cell with bgcolor + inline-styled `<a>`, padding ≥ 12px 28px.
- All `<img>` need `alt`, explicit `width`, `style="display:block;max-width:100%"`.
- Footer: KNICKGASM® UK · address placeholder `{{ organization.full_address }}` · unsubscribe link `href="{% unsubscribe %}"` (Klaviyo tags).
- Where a Klaviyo discount code could slot, use literal `{{CODE}}` only if the slot brief calls for it (none do this week).
