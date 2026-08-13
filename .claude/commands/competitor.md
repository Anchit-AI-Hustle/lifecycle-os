---
name: competitor
description: Sync competitor email intel and produce a competitive brief against the active brand's own competitor set.
argument-hint: "[ask, e.g. 'what are rival brands sending for summer bling kicks?']"
---

# Competitor intelligence

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Handle: `$ARGUMENTS`.

## Pipeline
- **Captured competitor emails** live in a Google Sheet + Supabase, synced via `api/competitor.js` (`?action=list|html|poll|sync`, logic in `_shared/competitor-core.js`). The 34-brand seed list is the canonical set.
- To refresh, trigger the sync (`?action=sync`, `CRON_SECRET`-protected) or poll latest.
- For market/traffic context, use **SimilarWeb** (traffic, channel mix) and **Ahrefs** (keywords, backlinks) connectors.

## Output
Run **`marketing:competitive-brief`** as the structure:
1. What rivals are doing (offers, cadence, creative angles, subject lines).
2. Gaps + opportunities for the active brand.
3. Concrete recommendations → feed into `/campaign-plan`.

Be honest about coverage (which brands actually have recent data vs. stale/empty).
