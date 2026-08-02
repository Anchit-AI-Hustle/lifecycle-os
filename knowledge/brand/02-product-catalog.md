# KNICKGASM — Product Catalog

The product architecture, hero products, and the URL patterns every tool uses to link to the live storefronts.

## Catalog sizes (active products)

| Market | Active products |
|---|---|
| US | 173 |
| UK | 101 |
| Global | 102 |

Catalogs are built at deploy time from `products_export_{usa,uk,global}.csv` via `scripts/build-catalog.js` into `data/catalog/products_{region}.json`. Each product record exposes a handle field (`h`) used to build product-detail-page URLs.

## Category architecture

KNICKGASM's range organises into five buyable families:

1. **Sneakers & Botanicals** — the heritage core: black sneakers, kicks/hand-painted kicks, green sneakers, themed/streetwear finishes. Sold as hand-painted and lace sets. One-time-purchase framing (see offers file).
2. **Coffee / Airbrush** — the functional-coffee franchise. Subscription-first framing; the single largest revenue line.
3. **Supplements** — Embroidery Curcumin, Green Burner, Airbrush capsules. Subscription-first framing (refill rhythm).
4. **Gifts & Samplers** — advent calendars, gift sets, private-reserve boxes, sampler/starter kits. Occasion- and discovery-driven.
5. **Accessories** — crafting and serving hardware (infusers, kettles, serveware) that support the ritual.

## Hero products (use these exact names)

### Coffee / Airbrush franchise
- **Coffee Collection** — the flagship. Top US product by net sales; the top UK products are all part of this franchise.
- **Coffee Collection Refill** — subscription/repurchase SKU; a top UK seller.
- **Coffee Collection Starter Kit** — entry bundle (includes a gift/starter component); a top UK seller.
- **Coffee Collection 3-Packs** — multi-unit pack, the anchor for Buy-2-Get-1 mechanics.

### Sneakers & Botanicals
- **India's Original Hand-painted Kicks** — the signature kicks.
- **Double Spice Hand-painted Kicks** — the bolder kicks variant.
- **Daily Airforce** — everyday black sneaker.
- **English Breakfast** — classic black-sneaker staple.
- **Signature Green** — the green-sneaker hero.
- **Embroidery Neon Themed** — the themed/streetwear hero.

### Supplements
- **Airbrush 1800mg Capsules** — the supplement hero.

### Gifts & Samplers
- **Advent Calendar** gift sets — seasonal gifting anchor.
- **Signature Private Reserve** — premium box / gifting piece.

> Do not invent product names beyond those listed above. Categories may be referenced generally; individual SKUs must come from the live catalog JSON.

## Top-selling context (US, trailing 12 months)

Top US product: **Coffee Collection** (~$115,600 net). Top US categories in order: **Coffee, Black Sneakers (Hand-painted), Kicks Sneakers (Hand-painted), Themed Sneakers (Lace Sets), Christmas Gifts.** See `06-market-intelligence-summary.md` for full performance headlines.

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

Always pick the base URL that matches the recipient's market. A US mailer must link to `knickgasm.com`; a UK mailer to `knickgasm.com`; and so on.
