# KNICKGASM — Landing Pages & Creative System

How KNICKGASM landing pages are generated, served, and kept on-brand, plus the creative rules every image and page must follow.

## The landing-page system

The OS generates brand-compliant HTML landing pages and serves them from a single serverless route. Pages are produced by the ad/landing-page generators, the Smart Brain approval flow (which LLM-writes a mailer + Meta/Google/TikTok ads + a landing page per approved slot), and the `/landing-page` command.

### Airbrush presell matrix

`landing-pages/airbrush-matrix/` holds the **8 angles x 8 variants** presell grid. Each angle is a design collection, targeting the distinct reason a buyer commissions a one-of-one pair:

- **anime** — fandom identity; the Naruto, Demon Slayer, and One Piece grails.
- **football** — club and player loyalty; CR7, Messi, Manchester United customs.
- **cars** — build culture; BMW, Ferrari, GT-R pairs.
- **gaming** — player identity and streamer culture.
- **wedding** — occasion; pairs customised to the outfit, planned around the 10 to 15 day build.
- **gifting** — buying for someone else; denim jackets, accessories, occasion commissions.
- **pets** — the personal-portrait commission.
- **bling** — crystal and embroidery finish work on top of a painted base.

Each collection folder carries `VariantA` through `VariantE` (with B1-B4 sub-variants) plus its own `index.html`. **Grail-Drop presell** pages (`landing-pages/final/*grail-drop*`, `knickgasm-grail-drop-presell-v5-variant{A,B}.html`) sit alongside the matrix and run the drop narrative for the high-ticket silhouettes.

Each presell page leads with the felt reason someone wants this exact pair, then earns it with the craft: original base, hand-painted by India's best artists, sealed water and scratch resistant finish, made to order in 10 to 15 days. Stay inside the brand's restraint (real craft proof, never an exaggerated claim; no banned phrases).

### Agent landing pages

- **`/lp/agent`** — the agent-generated landing page surface.
- **`/lp/best`** — the best-performing / canonical variant surface.

## The `/lp/:id` serving contract

Generated landing pages are served at **`/lp/:id`**, routed through `api/calendar.js` (`?action=lp&id=`). When the Smart Brain approves a calendar slot, it mirrors the generated assets into `ads_generated` and `landing_pages_generated`, and the landing page becomes reachable at `/lp/:campaignId`.

Any tool that produces a landing page must therefore:
1. Emit a self-contained HTML document (inline CSS/JS, no external framework dependency).
2. Register/mirror it so it resolves under `/lp/:id`.
3. Pass a stable id (campaign id) so the URL is durable.

Platform push to ad networks remains **Phase 2** (`push_status: not_integrated_phase_2`); generation and serving are live today.

## Creative rules (pages and imagery)

Non-negotiable, identical to the brand foundation:

- **Palette:** only lava red `#D0473E`, drip purple `#6A33D8`, near-black `#111111`, chalk `#FFFFFF`. No off-palette tints.
- **Typography:** Headings Montserrat (fallback Raleway, Georgia, serif); Body Instrument Sans (fallback Helvetica Neue, Arial, sans-serif). No other font as the primary family.
- **No on-image text.** Image-generation prompts must instruct "NO text" — copy is laid over images with real type, never baked into the generated pixels. (The image cascade — Gemini native to Gemini Imagen to OpenAI to Pollinations — carries this instruction.)
- **Single-studio provenance imagery.** Show the making: the Mumbai studio bench, the artist's hand mid-brushstroke, airbrush gradients on the toe box, masking tape coming off, the cured pair under studio light, the lace-up. Prefer warm, sensory, story-led visuals over stocky product-on-white unless the layout calls for a clean hero.
- **Show the real base.** Product imagery must read as a genuine Air Force 1, Jordan Low, Dunk, Court Vision, Converse, or Samba. Never render a generic or invented silhouette.
- **Copy discipline.** Banned phrases and em/en dashes are forbidden on pages exactly as in mailers; use the preferred lexicon (ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted).
- **Offer framing follows the playbook** — one-time commission framing for every pair, replenishment framing for accessories and care, discounts only for the Curious Switcher / discount-responsive cohort (see `04-offers-and-mechanics.md`).
- **Every price is region-correct.** USD from `products_us.json`, GBP from `products_uk.json`. Never carry a price across regions.

## Related surfaces

- **Mailer Studio** (`/studio`) produces the email counterparts under the same brand contract; landing pages should visually rhyme with the mailer that drives to them.
- Layout archetypes and 4-variant generation live in the Mailer Studio; landing pages reuse the same palette, type, and voice so a campaign feels like one piece across email, ad, and page.
