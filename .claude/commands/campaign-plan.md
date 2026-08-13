---
name: campaign-plan
description: Plan a lifecycle/growth campaign for the active brand — grounded in its real store + lifecycle data, competitor intel, and the brand calendar.
argument-hint: "[goal, e.g. 'Q3 winback for lapsed US buyers']"
---

# Campaign planning

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Plan the campaign described in `$ARGUMENTS` as the active brand's growth strategist.

## Inputs to gather first (use what's connected; skip cleanly if not)
- **Store reality** — via `/shopify` (public storefront scrape — US/UK/Global, no Admin API): products in the relevant category, current pricing, availability. Pair with the local catalog JSON.
- **Lifecycle state** — via Klaviyo connector: existing flows/segments, recent campaign performance, list health.
- **Cohorts** — Supabase RFM/cohort data (see `dashboard.html`, `cohort-definitions.html`) and `localStorage` analytics handoff.
- **Competitor angle** — `/competitor` brief for what rival brands in the same category are sending.
- **Calendar** — `calendar.html` 30-day plan / Smart Brain `smart_calendar_entries`.

## Output
Run `marketing:campaign-plan` as the backbone, then tailor to the active brand:
1. **Objective + audience** (which RFM/cohort segment, which market).
2. **Channel mix** — email, SMS, paid social (Meta/Google/TikTok), organic.
3. **Asset list** — exactly which mailers (`/mailer`), ad creatives (`/ad-creative`), landing pages (`/landing-page`), designs (`/design`) are needed.
4. **30-day schedule** mapped to the calendar.
5. **Success metrics** + measurement plan (`/analytics`).

Enforce all Brand Constants (palette, fonts, banned phrases, P01 "sell happiness"). End by offering to generate the asset list via the relevant creation commands.
