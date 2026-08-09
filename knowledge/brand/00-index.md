# KNICKGASM Brand Knowledge Base

This directory is the **source of truth** for brand voice, products, offers, and lifecycle targeting used by every tool in the Lifecycle OS — the Mailer Studio, the marketing calendar, KicksGPT, the Smart Brain daily loop, the ad/landing-page generators, and the competitor-intelligence stack. Any agent, prompt, or human editing brand output should ground its decisions here first.

## What this is

KNICKGASM is India's largest sneaker customiser: a premium, direct-to-consumer studio that hand-paints one-of-one artwork onto 100% original Nike Air Force 1, Air Jordan, Dunk, Court Vision, Converse, and Adidas Samba silhouettes, extended into custom denim jackets and a sneaker-accessories line (chunky rope laces, custom lace tags, the Ultimate Sneaker Care Kit). This knowledge base captures the brand's story, visual and verbal identity, product architecture, real store performance, lifecycle cohort model, offer mechanics, landing-page/creative system, and market intelligence — everything a growth tool needs to produce on-brand, correctly-targeted work.

Every fact in these files is consistent with the authoritative constants in the repo `CLAUDE.md`. Where those two disagree, `CLAUDE.md` wins and this base must be corrected.

## How it is organised

Read top to bottom for onboarding, or jump to the file that answers your question.

| # | File | Answers |
|---|---|---|
| 00 | [00-index.md](./00-index.md) | What this base is and where to find things (this file). |
| 01 | [01-brand-foundation.md](./01-brand-foundation.md) | Brand story, positioning, mission, palette, typography, banned/preferred lexicon, approved claims, copy-voice samples. |
| 02 | [02-product-catalog.md](./02-product-catalog.md) | Base silhouettes, design collections, hero products, store URLs + PDP/collection patterns, catalog sizes. |
| 03 | [03-lifecycle-cohorts.md](./03-lifecycle-cohorts.md) | RFM segments, UK engagement cohorts A-F, lifecycle stages, product/behavioral cohorts, avatar mapping. |
| 04 | [04-offers-and-mechanics.md](./04-offers-and-mechanics.md) | Commission-first vs accessory-replenishment framing, thresholds, gifting/occasion mechanics, discount discipline. |
| 05 | [05-landing-pages-and-creative.md](./05-landing-pages-and-creative.md) | Landing-page system, presell matrices, `/lp/:id` contract, creative rules. |
| 06 | [06-market-intelligence-summary.md](./06-market-intelligence-summary.md) | US/UK performance headlines, market-intel pointers, competitor-capture data engine. |

## The four buyer avatars (used throughout)

All targeting ultimately resolves to one of four buyer avatars. The names are used verbatim across the OS; only the definitions below are editable.

- **The Streetwear Optimiser** — buys for the build: original base silhouette, paint technique (airbrush gradients, brush linework), sealed water and scratch resistant finish, add-ons like embroidery and crystal work.
- **The Ritual Loyalist** — buys for routine: a daily-wear pair kept in rotation, care kits and replacement rope laces, repeat commissions in the same collection.
- **The Gifting Connector** — buys for status and occasion: wedding and anniversary pairs, birthday customs, denim jackets, gifting bundles.
- **The Curious Switcher** — buys for discovery: the entry-price silhouettes (Court Vision, Converse), accessories, a first custom before committing to a full commission.

## Non-negotiables (quick reference)

- **Palette (only these four):** lava red `#D0473E`, drip purple `#6A33D8`, near-black `#111111`, chalk `#FFFFFF`.
- **Type:** Headings Montserrat (fallback Raleway, Georgia, serif); Body Instrument Sans (fallback Helvetica Neue, Arial, sans-serif).
- **Banned phrases:** streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No em/en dashes in output copy. (Matched literally in `api/_shared/scenario-model.js`.)
- **Preferred lexicon:** ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted.
- **Approved claims only:** 100% original bases, hand-painted one-of-one, water and scratch resistant paint system, 10 to 15 day made-to-order build, express shipping to 60+ countries, worn organically by Samay Raina / Rohit Sharma / Shraddha Kapoor.
