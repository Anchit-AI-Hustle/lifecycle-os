---
description: Email sequence — give ICP and offer, get the full nurture flow (routes to /email-flow for Klaviyo build-out).
argument-hint: "[ICP + offer, e.g. 'US non-engagers 60d, 15% winback offer']"
---

# Email sequence

Design the nurture flow for: `$ARGUMENTS`.

## Method
1. Lock ICP + goal (welcome, winback, abandon, post-purchase). Pull the cohort's real size/definition from the repo's cohort definitions when named — never assume list size.
2. Sequence architecture: number of sends, spacing, and the JOB of each email (feel -> proof -> offer -> nudge -> last word). Respect the frequency cap: promotional cap 2 (absolute 3) per rolling 7 days.
3. Per email: subject (2 options: feeling-led + curiosity-led), preview text, one-sentence premise, body outline in KNICKGASM voice (tiny personal stories, not review dumps), single CTA, and Text vs Text+Graphics type.
4. Exit/skip logic: who leaves the flow on purchase/click, suppression rules.

## Output
1) Flow map (trigger -> emails with day offsets -> exits). 2) Per-email cards. 3) Measurement plan (per-email open/click/cvr targets stated as TARGETS, not predictions). Then offer /email-flow to build it in Klaviyo and /mailer to render the HTML.

## Brand guardrails (always)
- Palette #6A33D8 / #D0473E / #111111 / #F7F5F2; Montserrat headlines + Instrument Sans body.
- BANNED: streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No em/en dashes in output copy.
- Zero fabrication: never invent numbers, benchmarks, reviews, prices or URLs. Missing input -> ask for it or mark [DATA REQUIRED].
- Mega-prompt discipline: be clear, concise and highly specific; every claim quotes the exact figure or line it came from.
