---
description: Campaign audit — paste campaign data, get wasted spend and leaks with exact figures.
argument-hint: "[paste campaign/ad-set/ad rows, or say 'use Snowflake' for the live warehouse]"
---

# Campaign audit

Audit the campaign data in: `$ARGUMENTS`.

## Inputs
Campaign/ad-set/ad rows (spend, impressions, reach, clicks, link clicks, purchases, revenue). If the user says "use Snowflake", read the live Meta/Google/TikTok tables the Ads Dashboard uses (KNICKGASM_DB.MAPLEMONK/.MAPLEMONK1, DATON.RAW) instead of pasted data.

## Method (in order)
1. Portfolio baseline: total spend, CPM, CPC, link CTR, CPA, ROAS — computed, not assumed.
2. Wasted spend: entities with spend but zero results for their objective; frequency > 3 with declining CTR (fatigue); overlapping audiences duplicated across ad sets.
3. Leaks: click -> landing-page-view drop-off > 15%; CPC > 1.25x portfolio average; spend concentrated in bottom-quartile CTR creatives.
4. Rank findings by dollars at stake, largest first. Each finding: the exact rows + figures behind it, dollars affected, and ONE specific action.

## Output
1) Verdict line (total wasted spend found). 2) Findings table (Finding | Evidence | $ at stake | Action). 3) Top 3 reallocation moves. Nothing without evidence.

## Brand guardrails (always)
- Palette #6A33D8 / #D0473E / #111111 / #F7F5F2; Montserrat headlines + Instrument Sans body.
- BANNED: streetwear journey, transform, liquid lava, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No em/en dashes in output copy.
- Zero fabrication: never invent numbers, benchmarks, reviews, prices or URLs. Missing input -> ask for it or mark [DATA REQUIRED].
- Mega-prompt discipline: be clear, concise and highly specific; every claim quotes the exact figure or line it came from.
