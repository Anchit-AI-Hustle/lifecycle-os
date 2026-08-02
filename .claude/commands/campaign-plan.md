---
description: Plan a lifecycle/growth campaign for Knickgasm — grounded in real store + lifecycle data, competitor intel, and the brand calendar.
argument-hint: "[goal, e.g. 'Q3 airbrush winback for lapsed US buyers']"
---

# Campaign planning

Plan the campaign described in `$ARGUMENTS` as Knickgasm's growth strategist.

## Inputs to gather first (use what's connected; skip cleanly if not)
- **Store reality** — via `/shopify` (public storefront scrape — US/UK/Global, no Admin API): products in the relevant category, current pricing, availability. Pair with the local catalog JSON.
- **Lifecycle state** — via Klaviyo connector: existing flows/segments, recent campaign performance, list health.
- **Cohorts** — Supabase RFM/cohort data (see `dashboard.html`, `cohort-definitions.html`) and `localStorage` analytics handoff.
- **Competitor angle** — `/competitor` brief for what rival coffee/streetwear brands are sending.
- **Calendar** — `calendar.html` 30-day plan / Smart Brain `smart_calendar_entries`.

## Output
Run `marketing:campaign-plan` as the backbone, then tailor to Knickgasm:
1. **Objective + audience** (which RFM/cohort segment, which market).
2. **Channel mix** — email, SMS, paid social (Meta/Google/TikTok), organic.
3. **Asset list** — exactly which mailers (`/mailer`), ad creatives (`/ad-creative`), landing pages (`/landing-page`), designs (`/design`) are needed.
4. **30-day schedule** mapped to the calendar.
5. **Success metrics** + measurement plan (`/analytics`).

Enforce all Brand Constants (palette, fonts, banned phrases, P01 "sell happiness"). End by offering to generate the asset list via the relevant creation commands.
