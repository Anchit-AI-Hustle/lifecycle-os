---
name: ad-copy-matrix
description: Ad copy matrix — give a brief, get 20 ad copy variations across angles and awareness levels.
argument-hint: "[product + offer + audience, e.g. 'sleep product, 10% first order, stressed professionals']"
---

# Ad copy matrix

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Generate the matrix for: `$ARGUMENTS`.

## Method
Build a 5x4 matrix — 5 angles x 4 awareness levels = 20 distinct variations (distinct IDEAS, not synonym swaps):
- Angles: Feeling/end-state · Ritual/moment · Origin/craft (one-of-one, made-to-order) · Proof/specific detail · Contrast (vs the alternative the audience uses today).
- Awareness: Unaware (story-first) · Problem-aware (name the pain) · Solution-aware (why product, why this form) · Product-aware (offer-forward).
Each cell: Hook (<=10 words) + Primary text (<=25 words) + CTA. Product facts only from the brief or the catalog — no invented claims, prices or review counts. Happiness-first voice: the end-state leads, never the ingredient spec.

## Output
1) The 20-cell table (ID A1-E4 | Hook | Primary | CTA). 2) Top 5 picks with one-line reasons. 3) Test plan: which 3 cells to run first and what each isolates. Then offer /ad-creative to render them.

## Brand guardrails (always)
- Palette #D0473E / #6A33D8 / #111111 / #FFFFFF; Montserrat headlines + Instrument Sans body.
- BANNED: wellness journey, transform, liquid gold, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No em/en dashes in output copy.
- Zero fabrication: never invent numbers, benchmarks, reviews, prices or URLs. Missing input -> ask for it or mark [DATA REQUIRED].
- Mega-prompt discipline: be clear, concise and highly specific; every claim quotes the exact figure or line it came from.
