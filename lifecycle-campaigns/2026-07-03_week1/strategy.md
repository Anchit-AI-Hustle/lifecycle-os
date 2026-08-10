# KNICKGASM UK — Lifecycle Email Strategy, Week 1 (Thu 3 – Wed 9 July 2026)

Two cohorts, three sends each, all at **09:00 UK**. Objective for both: **open → click → purchase**, with the coffee-ART collection as the priority conversion for cohort A and the new denim-jacket category as the priority news beat for cohort B. All emails are Klaviyo paste-ready HTML in `emails/`, brand-audited (4-colour palette, Montserrat/Instrument Sans, banned-phrase-free, no founder voice, no health language, catalog pricing only).

## The week at a glance

| # | Send | Cohort | Email (file) | Play | Product focus | Offer mechanic |
|---|---|---|---|---|---|---|
| 1 | **Thu 3 Jul** | A — Non-Buyers/Non-Engagers | `2026-07-03_cohortA_story-intro-coffee.html` | Brand-story re-introduction | coffee-ART collection (soft) | Craft story, catalog prices from £89.09, gentle CTA |
| 2 | **Thu 3 Jul** | B — Custom Buyers/Non-Engagers | `2026-07-03_cohortB_winback-wimbledon.html` | Warm win-back + Wimbledon fortnight | 4 real court-and-pitch pairs | Honest was/now catalog prices, zero pressure |
| 3 | **Sun 6 Jul** | A | `2026-07-06_cohortA_gifts-unboxing-subscription.html` | Unboxing education + gifting | Coffee Cartoon AF1 + the finishing pieces | What actually arrives; £6.29 laces, £7.27 tags, £13.63 care kit |
| 4 | **Sun 6 Jul** | B | `2026-07-06_cohortB_coffee-launch-tea-lovers.html` | New-collection news for existing owners | coffee-ART across AF1, Jordan 1, Court Vision, Sambas | Range £89.09 to £152.73; second pair for the rotation |
| 5 | **Wed 9 Jul** | A | `2026-07-09_cohortA_pack-of-3-offer.html` | Offer-forward, the three-piece | Pair + rope laces + care kit | The full kit priced openly; welcome window closes Sunday |
| 6 | **Wed 9 Jul** | B | `2026-07-09_cohortB_supplements-launch.html` | New-category, first-to-know | Denim Jackets (Juice WRLD, Pop Smoke, Travis Scott) | £51.19 each; easy sneaker re-entry in the PS |

> File names are historic slugs and are kept so Klaviyo campaign references, the calendar manifest and
> the QA scripts keep resolving. Read them as: send 3 = the unboxing send, send 6 = the new-category launch.

## Subject lines (primary + alternates + preheader)

**1 · Cohort A · Thu 3 Jul — story intro**
- Primary: *Everyone has white AF1s*
- Alt 1: *Yours came out of an art studio*
- Alt 2: *One artist, one pair, one of one*
- Preheader: A quiet introduction to KNICKGASM, and the coffee-ART collection: mocha and deep-brown artwork hand-painted onto 100% original Nikes.

**2 · Cohort B · Thu 3 Jul — win-back**
- Primary: *Your pair never mentions how long it's been*
- Alt 1: *Grass courts, strawberries, and a fresh set of laces*
- Alt 2: *The rotation missed you*
- Preheader: It's the Wimbledon fortnight in England. Court Vision customs, GOAT pairs, and the laces that finish them.

**3 · Cohort A · Sun 6 Jul — the unboxing**
- Primary: *What actually turns up in the box*
- Alt 1: *We opened one for you. Here is everything inside.*
- Alt 2: *A one-of-one pair, rope laces, and a care kit*
- Preheader: Hand-painted, water and scratch resistant, painted after you order and shipped worldwide. Coffee Cartoon AF1 at £117.36.

**4 · Cohort B · Sun 6 Jul — coffee-ART collection**
- Primary: *The coffee-ART collection is on the site*
- Alt 1: *Mocha, deep brown, cartoon coffee, hand-painted*
- Alt 2: *Some news for your shelf*
- Preheader: Coffee artwork across AF1, Jordan 1 Lows, Court Vision and Adidas Sambas. From £89.09.

**5 · Cohort A · Wed 9 Jul — the three-piece**
- Primary: *The pair, the laces, the care kit*
- Alt 1: *Three pieces, one finished fit*
- Alt 2: *What we would put in a first order*
- Preheader: Coffee Cartoon AF1 £117.36, Chunky Rope Laces £6.29, Ultimate Sneaker Care Kit £13.63. This week's welcome note closes Sunday.

**6 · Cohort B · Wed 9 Jul — denim jackets**
- Primary: *We've painted something that isn't a shoe*
- Alt 1: *After the sneakers: our first denim jackets*
- Alt 2: *Same artists, new canvas*
- Preheader: Juice WRLD, Pop Smoke and Travis Scott hand-painted denim jackets, £51.19 each. Our custom owners hear it first.

## Why this sequence

**Cohort A (never bought, not opening):** Day 0 earns attention with the craft story, not an offer, because non-engagers have already seen and ignored offers. Day 3 converts attention into a concrete decision with the unboxing, since a tangible "here is what turns up, here is how long it takes" beats an abstract discount for a first purchase on a made-to-order product. Day 6 closes the week with the clearest honest package (pair plus the two pieces that finish it) and a soft deadline. Escalation: story → proof → offer.

**Cohort B (owns a custom pair, gone quiet):** Day 0 reactivates on familiar ground, their own kind of pair, honest was/now prices, and a seasonal reason to look this specific week (the Wimbledon fortnight) with zero pressure. Day 3 delivers genuine news, a whole new collection, bridged through the silhouettes they already own. Day 6 gives a second news beat, a new category on a new canvas, plus an easy low-ticket sneaker re-entry in the PS. Familiarity → news → news + easy path back.

**Priority CTA discipline:** cohort A's week ladders into one destination, the coffee-ART collection, with accessories used only as basket-builders and never as the headline. Cohort B's week ladders into the newest thing they have not seen: collection first, category second. Accessories & Care is one-time only in both cohorts and never framed as a repeat commitment.

**Made-to-order honesty everywhere:** each send states plainly that the pair is painted after the order and that production runs 10 to 15 days before express shipping. No dated delivery promise appears anywhere.

## ⚠️ Verify before sending (2 minutes in Klaviyo)

1. **Confirm the product URLs resolve** — all handles come from `data/catalog/products_uk.json`, so they should, but click through once:
   - `https://knickgasm.com/collections/coffee-air-forces` (emails 1, 3, 4, 5)
   - `https://knickgasm.com/products/juice-wrld-denim-jacket` (email 6)
   - `https://knickgasm.com/products/sneaker-care-kit` and `/products/rope-laces` (emails 3, 5, 6 PS)
2. **Send a test to yourself** — confirm the catalog images load (they are the exact CDN URLs from the catalog file, `?v=` params intact) and that fonts fall back gracefully where Montserrat/Instrument Sans are not installed.
3. **"Closes Sunday"** in email 5 refers to Sun 13 July — adjust if you want a different window.
4. Footer uses Klaviyo tags `{{ organization.full_address }}` and `{% unsubscribe %}` — these populate automatically in Klaviyo.

## Sending today (Thu 3 Jul)

Emails **1** and **2** are today's sends — paste each HTML into a Klaviyo campaign, pick the primary subject (alternates are for A/B testing if list size allows), target your two cohort lists, send at 09:00 UK or ASAP.
