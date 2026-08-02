---
description: Generate a brand-compliant Knickgasm HTML landing page that conforms to the /lp/:id serving contract.
argument-hint: "[offer, e.g. 'coffee collection PDP-style LP for Meta traffic, US']"
---

# Landing page generation

Build an HTML landing page for: `$ARGUMENTS`.

## Contract
- Pages are served at **`/lp/:campaignId`** via `api/calendar.js?action=lp&id=` and mirrored into the **`landing_pages_generated`** table.
- Single self-contained HTML doc (inline CSS/JS), mobile-first, fast.
- Use real catalog data + correct market store base for CTAs (`{storeBase}/products/{handle}` or `/collections/{slug}`).

## Hard constraints (brand asset code engine)
- Exact `@font-face` (Montserrat headings, Instrument Sans body), the 4-color palette, logo + footer block per the strict HTML/CSS contract.
- **No banned phrases.** P01: hero leads with the emotional payoff; product details support, don't headline.
- Carry the portable master prompt; append a Change Log after edits.

## Structure
Hero (happiness-first) → benefit/ritual section → product + social proof (story-style testimonials) → FAQ/objection handling → CTA. Match the visual weight of the ad creative driving traffic to it.

Offer to register the LP under a campaign and deploy via `/ship`.
