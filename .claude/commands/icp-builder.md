---
description: ICP builder — paste product info and customer quotes, get a sharp ICP.
argument-hint: "[product + any real customer quotes/reviews/survey lines]"
---

# ICP builder

Build the ICP from: `$ARGUMENTS`.

## Method
1. Separate inputs: product facts vs REAL customer language (quotes). The ICP is built from their words — flag if fewer than 5 real quotes were provided and say confidence is limited.
2. Extract from quotes: the trigger moment (what happened right before buying), the job-to-be-done, the feeling sought (this brand sells the feeling), objections voiced, competing alternatives named, identity markers.
3. Synthesize ONE primary ICP (not three vague ones): who, trigger, desired end-state, top 2 objections, where they are reachable, price sensitivity signals — each field citing the quote(s) it came from.
4. Anti-ICP: who looks adjacent but churns/costs (from evidence like refund or complaint language).

## Output
1) ICP card (fields + supporting quote per field). 2) Anti-ICP card. 3) Message box: the one sentence this person needs to hear, in their own words where possible. 4) Confidence note (quote coverage per field).

## Brand guardrails (always)
- Palette #6A33D8 / #D0473E / #111111 / #F7F5F2; Montserrat headlines + Instrument Sans body.
- BANNED: streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No em/en dashes in output copy.
- Zero fabrication: never invent numbers, benchmarks, reviews, prices or URLs. Missing input -> ask for it or mark [DATA REQUIRED].
- Mega-prompt discipline: be clear, concise and highly specific; every claim quotes the exact figure or line it came from.
