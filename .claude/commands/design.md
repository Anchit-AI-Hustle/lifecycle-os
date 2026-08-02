---
description: Create static/social design assets for Knickgasm via Canva, Figma, or Adobe Express.
argument-hint: "[asset, e.g. 'Instagram carousel for new hightop launch']"
---

# Design generation

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
