---
description: UTM generator — describe the campaign, get a clean, consistent tracking spec.
argument-hint: "[campaign description, e.g. 'Meta reels, US, July kicks push, 3 creatives']"
---

# UTM generator

Build the tracking spec for: `$ARGUMENTS`.

## Conventions (enforce — consistency beats cleverness)
- Lowercase only, hyphens inside values, no spaces, no PII ever.
- utm_source = platform (meta, google, tiktok, klaviyo, webengage); utm_medium = paid-social | cpc | email | sms | organic-social | referral; utm_campaign = {region}-{yyyymm}-{theme} (e.g. us-202607-kicks-push); utm_content = {format}-{creative-slug} (reel-steam-hero); utm_term = audience/keyword slug.
- One row per URL actually shipping (each creative x placement x audience combination the user names).

## Output
1) The convention block (so the team reuses it). 2) A table: Placement | Final URL with full query string | What it isolates. 3) GA4 note: where each dimension lands (session_source/medium, session_campaign). Base URLs come from the user or the verified store URLs (knickgasm.com etc.) — never invented paths.

## Brand guardrails (always)
- Palette #6A33D8 / #D0473E / #111111 / #F7F5F2; Montserrat headlines + Instrument Sans body.
- BANNED: streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No em/en dashes in output copy.
- Zero fabrication: never invent numbers, benchmarks, reviews, prices or URLs. Missing input -> ask for it or mark [DATA REQUIRED].
- Mega-prompt discipline: be clear, concise and highly specific; every claim quotes the exact figure or line it came from.
