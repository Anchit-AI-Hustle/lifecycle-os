# KNICKGASM — Product Catalog

The product architecture, hero products, and the URL patterns every tool uses to link to the live storefronts.

## Catalog sizes (active products)

| Market | Active products |
|---|---|
| US | 436 |
| UK | 436 |
| Global | 436 |

All three regions carry the same made-to-order design library; they differ by currency and shipping, not by assortment. Catalogs are built at deploy time from `products_export_{usa,uk,global}.csv` via `scripts/build-catalog.js` into `data/catalog/products_{region}.json`. Each product record exposes a handle field (`h`) used to build product-detail-page URLs, plus `type` (the base silhouette) and `price` (USD in `products_us.json`, GBP in `products_uk.json`).

## Base silhouettes (the `type` field)

Every custom is painted on a 100% original sneaker. The library is concentrated in a handful of bases:

| Base | Approx. designs | Role |
|---|---|---|
| Nike Air Force 1 | 349 | The workhorse canvas; most collections live here. |
| Nike Court Vision | 35 | The accessible entry silhouette (roughly $107 to $132). |
| Converse | 19 | Canvas base; best for embroidery and line-art designs. |
| Adidas Samba | 9 | The premium terrace silhouette (roughly $192 to $204). |
| Nike Air Jordan 1 Low | 8 | The grail tier (roughly $175 to $226). |
| Nike Dunk, Air Max, AF1 Mids, others | 1 each | Occasional one-off bases. |
| Laces / Denim Jackets | 3 each | Accessories and apparel, see below. |

## Category architecture

KNICKGASM's range organises into five buyable families:

1. **Custom Sneakers (design collections)** — the core: one-of-one hand-painted pairs organised by theme (anime, football and sport, cars, gaming, celebrity, coffee-ART, wedding and occasion, pets, Taylor Swift). Made-to-order framing, 10 to 15 day build (see offers file).
2. **Coffee-ART Collection** — hand-painted coffee motifs (cartoon-coffee, coffee-dip fades, mocha colourways) across AF1, Jordan Lows, Court Vision, and Sambas. A named collection of PAINT designs, not a drink. The single largest collection line.
3. **Finish add-ons** — changeable embroidered swooshes, crystal and bling work, rope-lace pairings applied on top of a painted base.
4. **Gifts & Occasion** — wedding pairs customisable to the outfit, anniversary and birthday commissions, denim jackets, gift bundles. Occasion- and discovery-driven.
5. **Accessories & Care** — chunky rope laces, custom lace tags, and the Ultimate Sneaker Care Kit that keep a finished pair wearable.

## Hero products (use these exact names)

All names and prices below are taken from `data/catalog/products_us.json` (USD).

### Coffee-ART collection
- **Coffee Cartoon (Brown Swoosh) x Nike Air Force 1** — $147.54. The flagship coffee-ART pair.
- **Nike Air Jordan 1 Lows x Coffee** — $178.40. The grail-tier coffee piece.
- **Adidas Sambas x mocha coffee** — $192.00. The terrace-silhouette coffee piece.
- **Coffee (Rope Laces) x Nike Court Vision** — $112.00. The entry-price coffee-ART on-ramp.

### Anime & gaming
- **Naruto : Madara x Nike Air Force 1** — $222.39. The anime grail.
- **Luffy x Zoro x Nike Air Jordan 1 Lows** — $219.54.
- **Tanjiro Demon Slayer x Converse** — $138.79.
- **Nike Court Vision x Gyarados Pokémon** — $107.33.

### Football, sport & cars
- **CR7 x Nike Air Force 1** — bestseller-tagged football pair.
- **Manchester United F.C. x Nike Air Force 1** — club-fandom hero.
- **Messi x Adidas Sambas** — $203.43.
- **BMW Custom x Nike Air Force 1** — bestseller-tagged car pair.

### Celebrity & pop culture
- **Nike Air Force 1 x Taylor Swift All Eras** — $201.02.
- **Nike Dunk Low Indigo Haze x Taylor Swift** — $217.81.
- **The Weeknd x Converse** — $138.79.

### Occasion, bling & embroidery
- **Wedding Carnival (customisable with the outfit) x Nike Air Force 1** — $234.08. The wedding anchor.
- **Crystal Sapphire Dragon x Nike Air Force 1** — $191.81. The bling hero.
- **Changeable Embroidered Swooshes x Nike Air Force 1** — $122.77.

### Denim jackets
- **Travis Scott Denim Jacket** / **Pop Smoke Denim Jacket** / **Denim Jacket - Juice WRLD** — $64.35 each.

### Accessories & care
- **Ultimate Sneaker Care Kit** — $17.13. The repeat-purchase SKU.
- **Chunky Rope Laces For Sneakers** — $7.91.
- **Lace Tags (Custom)** — $9.14.

> Do not invent product names or prices beyond those listed above. Collections may be referenced generally; individual SKUs and every price must come from the live catalog JSON (`products_us.json` for USD, `products_uk.json` for GBP).

## Top-selling context (US, trailing 12 months)

Top US collection: the **coffee-ART collection** (~$115,600 net). Top US categories in order: **Coffee-ART, Anime customs, Football & Sport customs, Car & Gaming customs, Occasion & Gifting.** See `06-market-intelligence-summary.md` for full performance headlines.

## Market store URLs (VERIFIED)

| Market | Store base URL |
|---|---|
| US | `knickgasm.com` |
| UK | `knickgasm.com` |
| IN (India) | `knickgasm.com` |
| EU | `knickgasm.com` |
| AU | `knickgasm.com` |
| Global / ME | `knickgasm.com` |

### URL patterns

- **Product detail page (PDP):** `{base}/products/{handle}` — where `{handle}` is the `h` field in the catalog JSON.
- **Collection page:** `{base}/collections/{slug}` — resolved via the `heroMap` in `collectionUrl()`.

Always pick the base URL that matches the recipient's market, and quote prices in that market's currency: a US mailer links to `knickgasm.com` and quotes USD from `products_us.json`; a UK mailer quotes GBP from `products_uk.json`. Never carry a price across regions.
