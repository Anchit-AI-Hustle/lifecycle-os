# Lifecycle OS Analytics — Streamlit in Snowflake

A native Snowflake app (Streamlit-in-Snowflake) for **Data Analysis + Ads
Analytics**. It runs **inside** Snowflake and authenticates through the logged-in
session (`get_active_session()`), so there are **no keys, no PAT, no Supabase** —
it reads the warehouse tables this account's ad pipelines already load,
read-only.

- **Charts:** Altair (not Plotly).
- **Data:** pulled from Snowflake (replacing the Supabase-backed path). No table
  name is hardcoded. Each source resolves in this order:
  1. an explicit environment override — `SF_META_ADS_TABLE`,
     `SF_META_AGE_GENDER_TABLE`, `SF_META_DEVICE_TABLE`, `SF_GOOGLE_ADS_TABLE`,
     `SF_TIKTOK_{CAMPAIGN,ADGROUP,AD,AGE_GENDER,COUNTRY}_TABLE`;
  2. otherwise **discovery** against `INFORMATION_SCHEMA.TABLES` in the session's
     current database, by name pattern (`%META%ADS%INSIGHTS%`, `%GOOGLE_ADS%`,
     `%TIKTOK%CAMPAIGN%REPORT%`, …).

  A source that resolves to neither is reported as
  `[DATA REQUIRED BEFORE LAUNCH: ...]` in the Sources tab and is never queried.
  The resolved name is always shown, so a wrong discovery match is visible rather
  than silent.
- **Ad accounts** are read from the data (`select distinct account_name`), never
  declared in code, so the Account filter can only offer accounts this warehouse
  actually contains.
- **Budget pacing** needs `ADS_DAILY_BUDGET_CAPS`, a JSON object of
  `{"account-name": daily_cap_usd}`. It is empty by default: a cap is a
  commercial decision belonging to whoever owns the account, and an unconfigured
  deployment shows the missing-data marker rather than pacing real spend against
  a number nobody in this business agreed to. Caps are reference/alerting only
  and are never written back to any ad platform.
- **Sections (sidebar):**
  - **Data Analysis** — sources & connector status, portfolio KPIs, budget
    pacing, the full **metric catalog** (definition + formula per metric) and a
    live **accuracy calculator** (coverage + agreement vs the platform-reported
    value).
  - **Ads Analytics** — Overview (priority metrics), Campaign/Ad rows, Cohorts
    (age×gender, device, country).

## One source of truth (parity with the web app)

The metric catalog in `streamlit_app.py` is a field-for-field mirror of the web
app's `api/_shared/ad-metrics-catalog.js` (same keys, categories, formulas). A
metric is **defined once and computed identically** on both surfaces, so the
Snowflake native app and the web dashboard (`/ads-dashboard`, reading the same
tables via `/api/brain?action=ads-snowflake` + `?action=ad-metrics`) never
diverge. The single source of truth is the Snowflake tables + this one catalog.

## Which branch owns this folder

`CLAUDE.md` describes a permanently separate distribution branch,
`snowflake-streamlit-app`, that must never be merged into main, and
`.github/workflows/protect-main-from-sis.yml` enforces that. **These files are
not that branch.** They are committed on `main` (added by "Rename the product to
Lifecycle OS; homepage becomes a platform explainer") and ship with every deploy
of the web app, which is why they are held to the same no-foreign-data standard
as the rest of the tree and are covered by `npm run check:foreign:ci`. The
protected branch is a different, fuller SiS distribution; changes here do not
reach it and must be ported by hand.

## Deploy (mints the URL)

Fastest — **Snowsight → Projects → Streamlit → + Streamlit App**: choose your
database and schema and a warehouse, paste `streamlit_app.py` (single file — no
extra modules to stage), add `altair` in the Packages picker, Run. Snowflake
creates the app and its URL on save.

Scripted — run `deploy.sql` (creates the stage + `CREATE STREAMLIT`). Upload
`streamlit_app.py` and `environment.yml` to the stage first. Keep the Streamlit
object name stable so the app URL does not change between deploys.

## Scope note

This SiS app is the **analytics** surface (Data Analysis + Ads). The full
marketing OS (Mailer Studio, calendars, KicksGPT, generation, landing pages)
remains the web app at `lifecycle-os.anchit-tandon.com` — unchanged by
this folder, and it renders the SAME analysis via the web dashboard. Adding
these files does not touch any web route or the Vercel build.
