---
name: design
description: Create static/social design assets for the active brand via Canva, Figma, or Adobe Express.
argument-hint: "[asset, e.g. 'Instagram carousel for new hightop launch']"
---

# Design generation

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Create the design asset described in `$ARGUMENTS`.

## Tool choice
- **Canva** (connector + `marketing:canva`) — branded social posts, stories, quick templated graphics. Use brand-template tools (`search-brand-templates`, `create-design-from-brand-template`) so output stays on-brand.
- **Figma** (connector + `figma:figma-generate-design` / `figma-use`) — UI mockups, design-system work, screens, anything that becomes code.
- **Adobe Express** (`adobe-for-creativity:adobe-design-from-template`) — flyers, posters, multi-format social.
- **Social resizing** across platforms → `adobe-for-creativity:adobe-create-social-variations`.

## Hard constraints
- Only the 4 brand colors; Montserrat / Instrument Sans feel.
- No banned phrases. P01 happiness-first messaging.
- Match the campaign's other assets (mailer/ad/LP) for visual coherence.

Offer platform-ready exports and to attach the asset to a `/campaign-plan`.
