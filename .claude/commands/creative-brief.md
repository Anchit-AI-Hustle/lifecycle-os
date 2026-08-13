---
name: creative-brief
description: Creative brief — give an angle, get a designer-ready brief (works standalone or feeding /ad-creative and /design).
argument-hint: "[angle/concept, e.g. 'morning ritual replaces doomscroll, Reels']"
---

# Creative brief

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Write the designer-ready brief for: `$ARGUMENTS`.

## Sections (all mandatory — a designer should need NOTHING else)
1. Objective + single success metric.
2. Audience + the one feeling to evoke (this brand sells happiness/calm, not ingredients).
3. Key message (one sentence) + support points (each with its verified source: catalog, site, approved reviews only).
4. Mandatories: 4-color palette, Montserrat/Instrument Sans, logo rules, packaging must be the REAL SKU (no AI-invented boxes), no banned phrases.
5. Format specs: sizes (1080x1080, 1080x1920, 1200x628 as relevant), platform safe-areas, max text coverage.
6. Motion spec (for video/Reels): hook in first 0.8s, shot list with camera moves, kinetic-type moments, CTA card — use the motion standard in scripts/lib/motion-ad.js (motionBrief) as the template.
7. References: 2-3 described directions (not links to rip), each with what to take from it.
8. Deliverables + naming: {brand}_{product}_{platform}_{format}_{WxH}.{ext}.

## Output
The 8-section brief, tight enough to hand off unedited. Offer next steps: /ad-creative (generation) or /design (Canva/Figma).

## Brand guardrails (always)
- Palette #D0473E / #6A33D8 / #111111 / #FFFFFF; Montserrat headlines + Instrument Sans body.
- BANNED: wellness journey, transform, liquid gold, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No em/en dashes in output copy.
- Zero fabrication: never invent numbers, benchmarks, reviews, prices or URLs. Missing input -> ask for it or mark [DATA REQUIRED].
- Mega-prompt discipline: be clear, concise and highly specific; every claim quotes the exact figure or line it came from.
