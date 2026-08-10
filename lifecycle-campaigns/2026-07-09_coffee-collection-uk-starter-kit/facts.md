# LOCKED FACTS - Coffee Collection UK Launch Kit · KNICKGASM UK · 9 Jul 2026

Single source of truth for the four assets in this campaign (strategy, Meta ad, landing page, email).
Nothing outside this file may be claimed as fact. Every product figure below comes from the repo
catalog `data/catalog/products_uk.json` (GBP, UK region file); brand claims come from
`api/_shared/master-prompt.js` BRAND_BLOCK.

## Store
- Market: UK
- Base URL: `https://knickgasm.com`
- Currency: GBP (£)
- Brand: KNICKGASM, India's largest sneaker customisers

## Collection (the offer for this run)
- Collection: **Coffee Collection**, hand-painted coffee-art custom sneakers
- Collection URL (real slug): `https://knickgasm.com/collections/coffee-air-forces`
- These are SNEAKERS with coffee-inspired artwork. No drink, brewing, serving,
  or consumption language anywhere in any asset.

## Products (verified from `data/catalog/products_uk.json`, prices GBP)

| Product (exact catalog name) | Price | Compare-at | Handle |
|---|---|---|---|
| Coffee (Rope Laces) x Nike Court Vision | £89.09 | £104.00 | `nike-court-vision-x-coffee-with-chunky-rope-laces-1` |
| Nike Court Vision Mid x Mocha | £97.01 | £115.49 | `nike-court-vision-mid-x-coffee-mocha` |
| Coffee Dip x Nike Air Force 1 | £108.27 | £145.15 | `nike-air-force-1-coffee-dip-rope-laces` |
| Coffee Cartoon (Brown Swoosh) x Nike Air Force 1 | £117.36 | £156.48 | `nike-air-force-1-x-coffee-brown-swoosh` |
| Coffee (Black Swoosh) x Nike Air Force 1 | £117.36 | £156.48 | `nike-air-force-1-x-coffee-black-swoosh` |
| Cartooned Coffee Dip x Nike Air Force 1 | £117.36 | £156.48 | `nike-air-force-1-cartooned-x-coffee-dip-rope-laces` |
| Coffee Black Studded Swoosh x Nike Air Force 1 | £130.97 | £174.63 | `nike-air-force-1-x-coffee-x-black-swoosh` |
| Nike Air Jordan 1 Lows x Coffee | £141.91 | £190.26 | `nike-air-jordan-1-lows-x-coffee-dip-rope-laces` |
| Cartoon Coffee Nike Air Jordan 1 Lows | £148.27 | £182.70 | `nike-air-jordan-1-lows-x-cartooned-coffee-dip-rope-laces` |
| Adidas Sambas x mocha coffee | £152.73 | £161.82 | `adidas-sambas-x-coffee-dip` |

Also catalog-verified (mocha colourway pairs surfaced by the same search, usable if an asset
needs an extra tile, same rules apply):

| Product (exact catalog name) | Price | Compare-at | Handle |
|---|---|---|---|
| Nike Air Force 1 x Mocha | £115.82 | £154.42 | `nike-air-force-1-x-mocha-pastel` |
| Mocha Brown Comic x Nike Air Force 1 | £117.36 | £156.48 | `nike-air-force-1-x-brown-comic` |

- Price range across the core collection: **£89.09 to £152.73**
- Product URL pattern: `https://knickgasm.com/products/{handle}`
- Image URLs: ONLY the `cdn.shopify.com/s/files/1/0754/4094/7522/...` URLs recorded in the
  catalog JSON for these exact handles. Never invent an image URL.

## Approved brand claims (BRAND_BLOCK, usable verbatim)
- Made on 100% original brand sneakers
- Hand-painted by India's best artists
- One-of-one custom sneakers
- Water & scratch resistant designs
- Express shipping worldwide (60+ countries)
- Worn by Samay Raina, Rohit Sharma, Shraddha Kapoor (organic)

## Claim rules (compliance)
- ZERO drink language: nothing brewed, roasted, sipped, poured or served, no cup or drink
  framing, no "coffee order" framing. Coffee appears ONLY as art, colourway, and culture.
- No invented discounts, percentages, review counts, ratings, guarantees, delivery-time
  promises, or scarcity. Compare-at prices may be shown only as recorded in the catalog.
- No counterfeit or replica implication: always "made on 100% original brand sneakers".
- No health or medical language of any kind. KNICKGASM sells artwork on footwear.
- If a figure is not in this file, it may not appear in an asset.

## Brand constants (enforced in all assets)
- Palette (ONLY): `#D0473E` lava red (primary accent) · `#6A33D8` drip purple (secondary) ·
  `#111111` ink (text + primary buttons, white text on ink) · `#FFFFFF` white (background)
- Headings: `'Montserrat','Raleway',Arial,sans-serif` (700/800)
- Body: `'Instrument Sans','Helvetica Neue',Arial,sans-serif`
- No em/en dashes anywhere in copy (commas, colons, plain hyphens only).
- Banned phrases: wellness journey, transform, liquid gold, game-changer, LIMITED TIME (caps),
  hurry, don't miss out, last chance, while supplies last.
- Preferred: custom, hand-painted, one-of-one, grail, canvas, colorway, drop, rotation, crafted, original.
- Never black or dark-neutral section backgrounds (use red or white); WCAG-AA contrast.

## The offer + CTA (single, consistent across all assets)
- Offer: the Coffee Collection, hand-painted coffee-art customs on 100% original Nike AF1,
  Jordan 1, Court Vision and Adidas Sambas, from £89.09, express shipped to the UK.
- Shared hook (message spine for ad, landing page, email):
  **"Coffee tones, hand-painted on original Nikes."**
- Primary CTA copy: **Shop the Coffee Collection** → `https://knickgasm.com/collections/coffee-air-forces`
- Product CTAs deep-link to `https://knickgasm.com/products/{handle}` from the table above.
