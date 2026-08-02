# output/ — compiled analysis exports

This folder holds the **complete-analysis** Excel workbook that compiles every
table of every dashboard page into one file.

There are two ways to fill it:

## 1. From the dashboard (browser)
Dashboard → **Export…** → *Complete analysis — every page* → **Excel** →
**Download**. Your browser saves the workbook to your Downloads folder; move it
here if you want it tracked. This reflects whatever data is loaded in the tab
(seed, uploaded CSVs, or a linked DB).

## 2. Live from the linked database (recommended for "always fresh")
```bash
# one-shot — writes output/knickgasm-complete-analysis.xlsx (+ a dated copy)
npm run export:complete

# keep it continuously fresh (re-export every 300s as new data lands)
npm run export:complete -- --watch=300
```

`scripts/export-complete.js` pulls the **live** analytical views
(`v_orders_daily`, `v_customers_by_region`, `v_campaign_performance`) straight
from the Supabase schema you linked, so the file always mirrors the real,
current state of the data — this is the "live integration / live linking /
triggering on data updates" path. Point a Google Sheet `IMPORTRANGE`, a
OneDrive-synced Excel, or a BI tool at the **stable** filename
(`knickgasm-complete-analysis.xlsx`) and it refreshes each run.

### Config
Set in `.env.local` (preferred) or the environment:
```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...        # or SUPABASE_ANON_KEY for RLS-readable views
UPLOAD_SCHEMA=uploaded_by_anchit     # the schema you chose when linking
```
If unset, the script falls back to `data/linked-db.public.json` written by the
dashboard's **Link database** flow.

> Excel keeps the retention colour-coding (lava heat scale) and clickable
> campaign links; CSV exports are plain text.

The dated workbooks (`knickgasm-complete-analysis-YYYY-MM-DD.xlsx`) are ignored by
git; only this README is tracked.
