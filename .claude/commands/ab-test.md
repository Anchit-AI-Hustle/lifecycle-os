---
description: A/B test analyzer — paste results, get statistical significance and the next test.
argument-hint: "[variant names + visitors + conversions (or opens/clicks), e.g. 'A 4200/310, B 4180/365']"
---

# A/B test analyzer

Analyze: `$ARGUMENTS`.

## Method
1. Compute per-variant conversion rate, absolute and relative lift, and a two-proportion z-test p-value + 95% CI. Show the arithmetic — never hand-wave significance.
2. Verdict: significant winner / not yet significant (state the additional sample size needed for 80% power at the observed effect) / flat.
3. Diagnose WHY the winner won (which element differed, mapped to the conversion stack) — hypothesis, clearly labelled as one.
4. Design the next test: single-variable, biggest remaining lever, with hypothesis ("Because we saw X, changing Y will move Z by ~N%"), success metric and required sample size.

## Output
1) Result table. 2) Verdict + confidence. 3) Next test card (Hypothesis | Change | Metric | Sample needed | Runtime estimate). If the data cannot support a verdict, say so — never fabricate certainty.

## Brand guardrails (always)
- Palette #D0473E / #6A33D8 / #111111 / #FFFFFF; Montserrat headlines + Instrument Sans body.
- BANNED: streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No em/en dashes in output copy.
- Zero fabrication: never invent numbers, benchmarks, reviews, prices or URLs. Missing input -> ask for it or mark [DATA REQUIRED].
- Mega-prompt discipline: be clear, concise and highly specific; every claim quotes the exact figure or line it came from.
