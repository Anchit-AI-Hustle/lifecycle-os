---
name: landing-page
description: Generate a brand-compliant HTML landing page for the active brand that conforms to the /lp/:id serving contract.
argument-hint: "[offer, e.g. '<collection> PDP-style LP for Meta traffic, US']"
---

# Landing page generation

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


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
