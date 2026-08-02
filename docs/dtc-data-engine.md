# DTC Data Engine — Live Dashboard Setup

> Merged into Lifecycle-OS from the standalone `knickgasm_dtc_data_engine` repo.
> The DTC engine is an **offline/local** pipeline (see `.vercelignore` — `ingest/`,
> `reports/`, `queries/` are in the repo but not deployed to Vercel). It ingests
> Shopify/Matrixify/Klaviyo/WebEngage exports into DuckDB, aggregates them, and
> syncs fact rows to Supabase, where a realtime dashboard reads them.

The dashboard at `reports/dashboard.html` reads from a Supabase Postgres project
and subscribes to realtime change feeds, so it updates within seconds when the
sync script writes new rows.

## Pipeline at a glance

```
exports (CSV) → ingest/ingest_*.py → DuckDB (knickgasm_dtc.duckdb)
              → queries/metrics.sql aggregation
              → ingest/sync_to_supabase.py → Supabase dtc.* fact tables
              → reports/dashboard.html (realtime subscriber)
```

## One-time setup

### 1. Provision Supabase

Use the project's existing Supabase (the same one Lifecycle-OS uses) or a fresh
free-tier project. From the project dashboard:

- **Settings → API**: copy the **Project URL** + **anon (public) key**
- **Settings → Database → Connection string**: copy the **URI** form (this is the
  `SUPABASE_DATABASE_URL` the sync script uses — writes need the service role;
  use the **session pooler** URL with the postgres role for simplicity)

### 2. Run the schema

The `dtc.*` schema (5 fact tables, 6 views, RLS read-only policies, realtime
publication) ships as a Lifecycle migration:

```bash
psql "$SUPABASE_DATABASE_URL" -f supabase/migrations/20260621000000_dtc_data_engine_schema.sql
```

…or paste that file into the Supabase Dashboard → SQL Editor → Run. It is
idempotent — safe to re-run.

### 3. Wire the dashboard

`reports/dashboard.html` reads its Supabase creds from `window.__DTC_CFG__`. Edit
the inline `<script>` block at the bottom of the file with your Project URL +
anon key. The anon key is safe to publish — RLS makes the `dtc.*` tables
read-only.

### 4. Sync data

```bash
pip install duckdb psycopg2-binary
export SUPABASE_DATABASE_URL="postgres://..."
export DUCKDB_PATH="./knickgasm_dtc.duckdb"
python ingest/sync_to_supabase.py
```

Schedule this via cron or a GitHub Action. Every run writes a row to
`dtc.sync_log` so the dashboard can show "last sync".

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
dtc.fact_cohort_retention    (cohort_month, market)       ← Shopify customer cohorts
dtc.fact_klaviyo_perf        (flow_id, week)              ← Klaviyo flows
dtc.fact_top_products        (month, market, sku)         ← Shopify product performance
dtc.sync_log                                              ← appended by ingest
```

Every fact table is RLS-protected; the anon key can only `select`. Writes require
the service-role key, which only the sync script uses.

> **Note:** `dtc.*` is a separate schema from the `lifecycle.*` / `public.*`
> tables created by the other migrations (the Mailer Studio, Smart Brain, KB).
> They coexist in one Supabase project without collision.
