---
name: competitor-teardown
description: Competitor teardown — paste a rival's page/ad, get angles to beat them.
argument-hint: "[competitor URL or pasted page/ad copy, e.g. 'https://...  their bestseller PDP']"
---

# Competitor teardown

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Tear down: `$ARGUMENTS`.

## Method
1. Fetch/read the rival asset. Extract: value prop, headline formula, offer, price anchor, proof stack, objections handled, CTA, tone.
2. Cross-reference the competitor KB (/competitor router, captured-email intel in the Google Sheet) for their known campaigns and cadence — cite what is actually there; no guessing at their performance.
3. Gap map: what they claim vs what the active brand can truthfully claim better (origin, one-of-one, freshness, certifications) — verify every the active brand claim against the catalog/site before using it.
4. Produce beat-them angles: for each, the rival's exact line, the counter-positioning, and a ready-to-run headline + hook in the active brand voice.

## Output
1) Their playbook in 5 bullets (each quoting their copy). 2) Gap table (They say | We can truthfully say | Proof source). 3) 5 attack angles with headlines. 4) One thing NOT to copy and why.

## Brand guardrails (always)
- Palette #D0473E / #6A33D8 / #111111 / #FFFFFF; Montserrat headlines + Instrument Sans body.
- BANNED: wellness journey, transform, liquid gold, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No em/en dashes in output copy.
- Zero fabrication: never invent numbers, benchmarks, reviews, prices or URLs. Missing input -> ask for it or mark [DATA REQUIRED].
- Mega-prompt discipline: be clear, concise and highly specific; every claim quotes the exact figure or line it came from.
