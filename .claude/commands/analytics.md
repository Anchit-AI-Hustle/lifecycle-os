---
description: Build a Knickgasm growth/performance report — RFM, cohorts, channel performance — from Supabase + connected analytics.
argument-hint: "[report, e.g. 'monthly retention + channel ROAS, US']"
---

# Analytics & reporting

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
