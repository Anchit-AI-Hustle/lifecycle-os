---
name: analytics
description: Build a growth/performance report for the active brand — RFM, cohorts, channel performance — from Supabase + connected analytics.
argument-hint: "[report, e.g. 'monthly retention + channel ROAS, US']"
---

# Analytics & reporting

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Produce the report described in `$ARGUMENTS`.

## Data sources
- **Supabase (Postgres)** — primary store: RFM/cohort tables, captured competitor emails, KB. Query via `/db` or the supabase skill. The dashboards (`dashboard.html`) already compute RFM/cohorts.
- **Store** — product/price/availability via `/shopify` (public storefront scrape, US/UK/Global). Note: no order/AOV data without Admin API — use Supabase/ingested data for sales truth.
- **Klaviyo** — email/SMS engagement + revenue attribution.
- **Marketing analytics connectors** — Amplitude (product analytics), Supermetrics (cross-channel pull), SimilarWeb/Ahrefs (acquisition/SEO).

## Method
Run **`marketing:performance-report`** as the structure, then populate with real numbers from the sources above. Flag data gaps honestly rather than estimating.

## Output
Executive summary → key metrics vs prior period → segment/cohort breakdown → channel performance → recommended next actions (link to `/campaign-plan`). Visualize where it aids the reader.
