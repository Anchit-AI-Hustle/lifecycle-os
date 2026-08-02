# KNICKGASM Analytics — Streamlit in Snowflake

A native Snowflake app (Streamlit-in-Snowflake) for **Data Analysis + Ads
Analytics**. It runs **inside** Snowflake and authenticates through the logged-in
session (`get_active_session()`), so there are **no keys, no PAT, no Supabase** —
it reads the warehouse tables the Daton / Maplemonk pipelines already load,
read-only.

- **Charts:** Altair (not Plotly).
- **Data:** pulled from Snowflake (replacing the Supabase-backed path) —
  `KNICKGASM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS`, the Meta `..._AGE_AND_GENDER` /
  `..._PLATFORM_AND_DEVICE` cohort tables, and the `DATON.RAW.TIKTOK_ADS_USA_*`
  report + breakdown tables. Google via `KNICKGASM_DB.MAPLEMONK.GOOGLE_ADS_USA`.
- **Sections (sidebar):**
  - **Data Analysis** — sources & connector status, portfolio KPIs, budget
    pacing vs the Target $1,000/day & Costco $300/day caps, the full **metric
    catalog** (definition + formula per metric) and a live **accuracy
    calculator** (coverage + agreement vs the platform-reported value).
  - **Ads Analytics** — Overview (priority metrics), Campaign/Ad rows, Cohorts
    (age×gender, device, country) for the Costco + Target US accounts.

## One source of truth (parity with the web app)

The metric catalog in `streamlit_app.py` is a field-for-field mirror of the web
app's `api/_shared/ad-metrics-catalog.js` (same keys, categories, formulas). A
metric is **defined once and computed identically** on both surfaces, so the
Snowflake native app and the web dashboard (`/ads-dashboard`, reading the same
tables via `/api/brain?action=ads-snowflake` + `?action=ad-metrics`) never
diverge. The single source of truth is the Snowflake tables + this one catalog.

## Deploy (mints the URL)

Fastest — **Snowsight → Projects → Streamlit → + Streamlit App**: choose
`KNICKGASM_DB.APPS` and a warehouse, paste `streamlit_app.py` (single file — no extra
modules to stage), add `altair` in the Packages picker, Run. Snowflake creates
the app and its URL on save.

Scripted — run `deploy.sql` (creates the stage + `CREATE STREAMLIT`). Upload
`streamlit_app.py` and `environment.yml` to the stage first.

**App URL** (once created — object name kept stable so the URL doesn't change):
`https://app.snowflake.com/uxdeihw/mo06981/#/streamlit-apps/KNICKGASM_DB.APPS.KNICKGASM_ADS_ANALYSIS`

## Scope note

This SiS app is the **analytics** surface (Data Analysis + Ads). The full
marketing OS (Mailer Studio, calendars, KicksGPT, generation, landing pages)
remains the web app at `knickgasm-lifecycle-os.anchit-tandon.com` — unchanged by
this folder, and it renders the SAME analysis via the web dashboard. Adding
these files does not touch any web route or the Vercel build.
