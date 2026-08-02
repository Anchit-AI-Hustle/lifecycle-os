# KNICKGASM Brand Knowledge Base

This directory is the **source of truth** for brand voice, products, offers, and lifecycle targeting used by every tool in the KNICKGASM Lifecycle OS — the Mailer Studio, the marketing calendar, KicksGPT, the Smart Brain daily loop, the ad/landing-page generators, and the competitor-intelligence stack. Any agent, prompt, or human editing brand output should ground its decisions here first.

## What this is

KNICKGASM is a premium, direct-to-consumer Indian heritage sneaker brand, extended into a functional-coffee line (Coffee Collection) and a small supplements range. This knowledge base captures the brand's story, visual and verbal identity, product architecture, real store performance, lifecycle cohort model, offer mechanics, landing-page/creative system, and market intelligence — everything a growth tool needs to produce on-brand, correctly-targeted work.

Every fact in these files is consistent with the authoritative constants in the repo `CLAUDE.md`. Where those two disagree, `CLAUDE.md` wins and this base must be corrected.

## How it is organised

Read top to bottom for onboarding, or jump to the file that answers your question.

| # | File | Answers |
|---|---|---|
| 00 | [00-index.md](./00-index.md) | What this base is and where to find things (this file). |
| 01 | [01-brand-foundation.md](./01-brand-foundation.md) | Brand story, positioning, mission, palette, typography, banned/preferred lexicon, copy-voice samples. |
| 02 | [02-product-catalog.md](./02-product-catalog.md) | Product categories, hero products, store URLs + PDP/collection patterns, catalog sizes. |
| 03 | [03-lifecycle-cohorts.md](./03-lifecycle-cohorts.md) | RFM segments, UK engagement cohorts A-F, lifecycle stages, product/behavioral cohorts, avatar mapping. |
| 04 | [04-offers-and-mechanics.md](./04-offers-and-mechanics.md) | Subscription-first vs one-time framing, thresholds, gifting/seasonal mechanics, discount discipline. |
| 05 | [05-landing-pages-and-creative.md](./05-landing-pages-and-creative.md) | Landing-page system, presell matrices, `/lp/:id` contract, creative rules. |
| 06 | [06-market-intelligence-summary.md](./06-market-intelligence-summary.md) | US/UK performance headlines, market-intel pointers, competitor-capture data engine. |

## The four buyer avatars (used throughout)

All targeting ultimately resolves to one of four buyer avatars:

- **The Streetwear Optimiser** — buys for functionality (Coffee Collection, supplements, adaptogens).
- **The Ritual Loyalist** — buys for routine (daily kicks, morning craft, subscription refills).
- **The Gifting Connector** — buys for status and occasion (gift sets, advent calendars, samplers).
- **The Curious Switcher** — buys for discovery (samplers, new arrivals, the discount-responsive entry point).

## Non-negotiables (quick reference)

- **Palette (only these four):** deep purple `#6A33D8`, lava `#D0473E`, near-black `#111111`, chalk `#F7F5F2`.
- **Type:** Headings Montserrat (fallback Raleway, Georgia, serif); Body Instrument Sans (fallback Helvetica Neue, Arial, sans-serif).
- **Banned phrases:** streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No em/en dashes in output copy.
- **Preferred lexicon:** ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted.
