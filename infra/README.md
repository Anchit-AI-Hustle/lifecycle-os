# DTC Data Engine — Live Dashboard Setup

The dashboard at `/reports/dashboard.html` reads from a Supabase Postgres project
and subscribes to realtime change feeds, so it updates within seconds when the
sync script writes new rows.

## One-time setup

### 1. Provision Supabase

Create a Supabase project (free tier is fine). From the project dashboard:

- **Settings → API**: copy the **Project URL** + **anon (public) key**
- **Settings → Database → Connection string**: copy the **URI** form (this is
  the `SUPABASE_DATABASE_URL` the sync script uses — needs the service role for
  writes; use the **session pooler** URL with the postgres role for simplicity)

### 2. Run the schema

```bash
psql "$SUPABASE_DATABASE_URL" -f infra/supabase_schema.sql
```

This creates the `dtc` schema with 5 fact tables, 6 views, RLS read-only
policies, and adds the fact tables to the `supabase_realtime` publication.

### 3. Wire the dashboard

The dashboard reads its Supabase creds from `window.__DTC_CFG__`. For Vercel:

1. Add a `Deployment Configuration` step to inject the values at build time, or
2. Edit the inline `<script>` block at the bottom of `reports/dashboard.html`
   with your Project URL + anon key (anon key is safe to publish — RLS makes
   the tables read-only).

### 4. Sync data

```bash
pip install duckdb psycopg2-binary
export SUPABASE_DATABASE_URL="postgres://..."
export DUCKDB_PATH="./knickgasm_dtc.duckdb"
python ingest/sync_to_supabase.py
```

You can schedule this via cron / a Vercel Cron Function / a GitHub Action.
Every run writes a row to `dtc.sync_log` so the dashboard can show "last sync".

## What the dashboard shows

| Section | Source view | Realtime trigger |
|---|---|---|
| Revenue & Orders | `v_revenue_30d`, `v_revenue_daily` | `fact_daily_orders` |
| Channel mix & CAC | `v_channel_summary` | `fact_channel_perf` |
| Retention & cohorts | `v_retention_summary` | `fact_cohort_retention` |
| Email & CRM | `v_email_top_flows` | `fact_klaviyo_perf` |
| Last sync pill | `v_last_sync` | `sync_log` |

## Schema map

```
dtc.fact_daily_orders        (market, order_date)         ← Matrixify orders
dtc.fact_channel_perf        (channel, market, week)      ← Shopify Analytics
dtc.fact_cohort_retention    (cohort_month, market)       ← Shopify customer_cohorts
dtc.fact_klaviyo_perf        (flow_id, week)              ← Klaviyo flows
dtc.fact_top_products        (month, market, sku)         ← Shopify product_performance
dtc.sync_log                                              ← appended by ingest
```

Every fact table is RLS-protected; the anon key can only `select`. Writes
require the service-role key, which only the sync script uses.
