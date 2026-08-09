# DEVELOPMENT.md — How Lifecycle OS is built

A build-narrative + code-level architecture guide for engineers working on this
repo. It documents **how** the system is put together and **why** the load-bearing
decisions were made. It complements — rather than repeats — the other docs:

- `README.md` — product overview + the 3-stage pipeline (start here).
- `docs/PRD.md` — vision, origin story, feature-by-feature rationale.
- `docs/ARCHITECTURE.md` / `docs/UNIFIED-ARCHITECTURE.md` — system + consolidation roadmap.
- `REPLICATION.md` — clone-to-running runbook (routes, env vars, pitfalls).
- `CLAUDE.md` — the brand/voice + engineering-rules bible.
- `docs/SMART_BRAIN.md` — the autopilot loop in depth.

> If a statement here disagrees with the code, the **code is authoritative** — see
> §13 for known doc drift.

---

## 1. What it is, and its lineage

Lifecycle OS is a D2C retention + marketing-generation platform for KNICKGASM
India. One workflow, three stages: **Data Analysis → Marketing Calendar → Mailer
Studio (4 variants)**, plus an autopilot ("Smart Brain") that runs the loop daily.

It was **forked from `marketing_mailers__html_architect`** so the original Mailer
Studio (`lifecycle_mailer_architect_v34.html`) keeps shipping untouched in production;
the retention dashboard, calendar generator, Smart Brain, competitor intelligence,
and mobile shells were layered on top. That lineage explains the shape of the repo:
a very large, battle-tested single-file mailer app at the centre, with newer
capabilities built around it as separate static apps + serverless routers.

---

## 2. Tech stack & platform

- **Frontend:** ~43 standalone, self-contained **static HTML apps** at the repo
  root (inline `<script>`/`<style>`, no bundler for the core). They're wired into
  clean routes by `vercel.json` rewrites and share root-level client JS
  (`auth.js`, `agent-widget.js`, `chart-enhance.js`, `table-sort.js`, `copilot.js`,
  `sw.js`, `theme.css`). This "no build step for the app" choice keeps deploys
  instant and each page independently shippable.
- **Two sub-apps use real frameworks** and deploy separately:
  `marketing_automation/` (React 19 + Vite + Tailwind + an Express `server.ts`) and
  `competitor-intelligence-hub/` (Next.js app-router + Tailwind + shadcn).
- **Backend:** Node.js ≥20 (CommonJS) as **Vercel Serverless Functions** under
  `api/`.
- **Data pipeline:** Python (`duckdb` + `pandas`) under `ingest/`, `mailer_system/`,
  and `scripts/_*.py`.
- **Hosting:** Vercel, single project (`framework: null`, `outputDirectory: "."`,
  `buildCommand: "npm run build"`). Deploy: `npm run deploy` (`vercel --prod`) or
  auto-deploy on `main`.
- **Databases:** two-tier (see §8) — **DuckDB** as the local analytics warehouse,
  **Supabase (Postgres/PostgREST)** as the runtime store. There is deliberately
  **no Supabase SDK**; a hand-rolled PostgREST client (`api/_shared/supa.js`) keeps
  the serverless bundle small.
- **LLM:** an 8-provider, tier-routed cascade (see §6).

---

## 3. The dominant constraint: the 12-function Hobby cap

The single most influential architectural rule in this codebase: **Vercel's Hobby
plan allows at most 12 Serverless Functions.** Every backend decision bends around it.

There are **exactly 12** function files (everything under `api/` not in `_shared/`):

```
api/ai/generate.js          api/ai/image.js
api/ai/pipeline/strategy.js  api/ai/pipeline/variant.js
api/ai/pipeline/images.js    api/ai/pipeline/html.js
api/ai/pipeline/score.js     api/brain.js
api/calendar.js              api/competitor.js
api/kb.js                    api/public-config.js
```

How dozens of capabilities fit into 12 files:

1. **`?action=` routers.** `brain.js`, `calendar.js`, `competitor.js`, and `kb.js`
   are each a single function that dispatches to many sub-handlers by query param
   (e.g. `/api/brain?action=generate`). One function, many endpoints.
2. **The `_shared/` underscore trick.** All heavy logic (~70 files) lives in
   `api/_shared/*.js`. Vercel's function scanner **ignores** underscore-prefixed
   paths, so they ship as plain imports, not as billable functions.
3. **Folding standalones.** Health/pipeline probes that were once their own routes
   are now `?health=1` / `?pipeline=1` modes on `public-config.js`.

This is **enforced in CI**: `ci.yml` has a Function-count guard that fails the build
if the count of non-`_shared` files under `api/` exceeds 12. **Rule of thumb: never
add a 13th `api/*.js` — add an `?action=` to an existing router, or logic under
`api/_shared/`.** (REPLICATION pitfall #6.)

---

## 4. Architecture — the 3 core stages

```
Stage 01 Data Analysis  ──▶  Stage 02 Marketing Calendar  ──▶  Stage 03 Mailer Studio
 dashboard.html (/rfm)        calendar.html (/plan)              lifecycle_mailer_architect_v34.html (/studio)
 client-side RFM/cohorts      /api/calendar?action=generate      /api/ai/pipeline/* (5-stage)
```

- **Stage 01 — Data Analysis** (`dashboard.html`, route `/rfm`): upload CSV/XLSX
  (campaigns/customers/orders/products) or run on a synthetic seed; computes 9 RFM
  segments, channel mix, retention cohorts, cross-sell affinity, and 10
  severity-ranked insights; CSV export. Mostly client-side; persists analytics
  state to `localStorage` for Stage 02. Ported from
  `knickgasm_dtc_data_engine/reports/retention-intelligence.html`.
- **Stage 02 — Marketing Calendar** (`calendar.html`, route `/plan`): reads the
  Stage-01 state, POSTs to `/api/calendar?action=generate` → a 30-day,
  segment-aware, festival-aware, capacity-guarded plan. Each row is one-click
  buildable via `?action=trigger-mailer`. Festivals from `data/festivals.json`.
- **Stage 03 — Mailer Studio** (`lifecycle_mailer_architect_v34.html`, routes
  `/studio` `/app` `/mailer`): the original 778 KB mailer app. Produces **4 variants**
  per send — **A** Image·Hero, **B** Image·Lifestyle, **T1** Text·Editorial,
  **T2** Text·Founder-note — by driving the 5-stage pipeline (§5).

### Secondary apps/modules (one line each)
- **Smart Brain** (`smart-brain.html` `/brain` + `api/brain.js`) — daily autopilot:
  analyze → plan → prebuild → review → approve (see §7).
- **Competitor intelligence** (`competitor-benchmarking.html` `/competitor` +
  `api/competitor.js`) — IMAP-ingests competitor marketing emails into Supabase and
  benchmarks offers/funnels. `competitor-intelligence-hub/` is a separate Next.js
  deployment.
- **Ingest** (`ingest/*.py`) — load Matrixify/Shopify/Klaviyo/WebEngage CSVs into
  DuckDB; `sync_to_supabase.py` pushes aggregates to Supabase; `run_all.py`
  orchestrates.
- **mailer_system** (Python) — metrics-triggered campaign generator writing to
  `outputs/` + `campaign_log.json`.
- **marketing_automation** (React 19 SPA) — interactive campaign compiler with an
  Express server that compiles local templates and scrapes assets for offline use.
- **growth-book** (`/growth-book`) & **playbook** (`/playbook/`) — generated static
  competitor teardowns / dossiers (built by `scripts/gen-*.js`).
- **Agent widget** (`agent-widget.js`, `agent.html` `/agent`) — embeddable Shopify
  voice+chat concierge; per-collection/product agents from `?action=agents`.

---

## 5. The mailer-generation pipeline — think → lock → execute

The 4-variant generation runs as five discrete serverless stages under
`api/ai/pipeline/`, on a deliberate philosophy: **Stage 1 does all the thinking and
locks it; Stages 2–5 are pure executors** ("Bad upstream thinking = broken
downstream mailer").

1. **`strategy.js` — Master Strategic Lock.** Locks products, theme, vibe,
   structure, image style, and the A/B variant concepts. Everything downstream reads
   this lock and does not re-decide.
2. **`variant.js` — execution.** Produces layout/sections/copy/image-requirements
   for one variant. Variant A is the product-first control; Variant B is
   deliberately structurally opposite (for real divergence).
3. **`images.js` — image gen.** Up to 3 images per call (hero/product/lifestyle),
   3× retry, `gpt-image-1` or Pollinations FLUX.
4. **`html.js` — production HTML email** from the locked plan; images are injected
   client-side via placeholder strings (`IMAGE_HERO_URL`, `IMAGE_PRODUCT_URL`,
   `IMAGE_LIFESTYLE_URL`).
5. **`score.js` — quality gate.** Scores both variants on `strategy_alignment`,
   `content_density`, `copy_quality`, and divergence. `PASS_THRESHOLD = 7`,
   `DIVERGENCE_MIN = 8`; emits a retry signal that drives `regenerate_counter`.

Text (`api/ai/generate.js`) and images (`api/ai/image.js`) are the two general-purpose
generators used outside the pipeline. `image.js` **never 502s** — on total provider
failure it returns an on-brand placeholder data URI.

Every generated asset carries a **`master_prompt`** (from `lib/.../master-prompt.js`):
one self-contained prompt that reproduces top-quality output on a blank
ChatGPT/Claude/Gemini — the single source of truth for "how this asset was made."

---

## 6. The LLM cascade (`api/_shared/llm.js`)

Single source of truth: `module.exports = callLLM`. An **8-provider, tier-routed
waterfall** in strict descending-accuracy order:

```
anthropic → openai → gemini → grok → groq → cerebras → ollama → sakana
                                   (fast tier skips grok)
```

- **Tiers** per call: `premium` / `standard` / `fast` (legacy `maxpower`→premium,
  `budget`→standard). July-2026 default models (all env-overridable): premium =
  `claude-opus-4-8 / gpt-5.5 / gemini-3.1-pro / grok-4.3`; standard =
  `claude-sonnet-5 / gpt-5-mini / gemini-3.5-flash / grok-4.1-fast`; fast =
  `claude-haiku-4-5 / gpt-5-nano / gemini-2.5-flash`.
- **Demotion logic (`classifyFailure`):** 429/402/billing-400 = quota → demote;
  404/model-error = within-provider demote; **plain 400 = request bug → abort the
  whole cascade** (don't waste every provider on a malformed call); 401/403 = auth →
  skip provider; 5xx/timeout = transient.
- **Resilience:** OpenAI rotates 3 keys (`OPENAI_API_KEY`/`_2`/`_3`) before
  demoting; Gemini gets +30% timeout and one 4 s 429-retry; env keys are stripped of
  BOM/zero-width chars; an anti-cache `GEN_SEED` is appended to every message; a
  multi-strategy `parseJSON` repairs truncated JSON. `ollama`/`sakana` are optional
  tail rungs, skipped unless their `*_BASE_URL` env is set.

The design rationale lives in `docs/quality-upgrade-blueprint.md`.

---

## 7. Smart Brain — the daily autopilot

`api/brain.js` (+ `lib/smart-brain/services.js`, `api/_shared/brain-*.js`,
`smart-brain-plan.js`) runs a persistent loop with a human-in-the-loop gate:

**analyze → plan → prebuild → review → decide/recalibrate → approve.**

- **90-day rolling horizon** with a convergent background **prebuild** worker: one
  batch per call, self-refiring until the window is built, then idling; a 7-day
  near-term refresh window keeps the front of the calendar current.
- **HITL:** `?action=review` / `decide` / `recalibrate`; MVT weight learning and
  confidence tracking feed back into planning.
- A `DAILY_REVENUE_TARGET_USD = 1500` feasibility gate governs how aggressive the
  plan is. Console UI at `smart-brain.html`.

**generateAll + connector pre-flight** (recent work): `smart-brain.html`'s
`generateAll()` builds final assets for all visible unbuilt slots one at a time,
yields to repaint each step, is cancellable (`window.__SB_GEN_CANCEL`), and **aborts
cleanly if `sbPreflight()` fails**. Pre-flight (`api/_shared/connector-check.js`,
`checkTextProviders`) is **presence-based** — it verifies provider keys without
spending tokens, mirrors `llm.js`'s provider identity exactly, and tracks recent
quota hits (5-min TTL) so the UI degrades gracefully instead of letting every job
429.

---

## 8. Data layer

```
CSV/XLSX exports (Matrixify · Shopify Analytics · Klaviyo · WebEngage)
        │  ingest/*.py  (duckdb + pandas)
        ▼
   DuckDB  knickgasm_dtc.duckdb   ← local analytics warehouse (LIFECYCLE_DuckDB_DDL.sql: 4 schemas, 46 tables)
        │  ingest/sync_to_supabase.py  (aggregate → push)
        ▼
   Supabase (Postgres / PostgREST)  ← runtime store, read by serverless via api/_shared/supa.js
```

- **DuckDB** is the heavy local warehouse (raw transactional loads, upsert via
  `INSERT ... SELECT * FROM df`). **Supabase** holds the runtime tables the app reads
  live: Smart Brain (`smart_calendar`, `smart_cohorts`, `smart_generated_assets`,
  `smart_generated_campaigns`, `smart_feedback`, `smart_confidence`,
  `smart_mvt_results`, `smart_festivals`, `smart_library_scores`) and mailer
  (`mailers_generated`, `app_users`, `lifecycle_products`, `lifecycle_collections`,
  `lifecycle_brand_kit`, `lifecycle_market_config`, `kb_knowledge`). Migrations in
  `supabase/migrations/` (timestamped + `COMBINED_RUN_THIS.sql`).
- **Product catalog** is built at deploy by `scripts/build-catalog.js` from
  `Knickgasm Product Catalog RegionWise/products_export_{usa,uk,global}.csv` →
  `data/catalog/products_{us,uk,global}.json` (active-only, primary image + gallery
  capped at 10). Counts: US 173 · UK 101 · Global 102.
- **Festivals** (`data/festivals.json`) — market-keyed cultural moments, each
  `{ date, name, weight 1-10, tags, archetype_hint, recommended_segments }`;
  CDN-cached 1 h with CORS `*`.
- **`schemas/cohort-profile.json`** — the canonical JSON-Schema 2020-12 "KNICKGASM
  Cohort Profile" (identity, demographics, geo, purchase vectors, lifecycle-health
  flags, cohort assignments).

---

## 9. Guardrails (why generated output stays on-brand)

- **Brand palette (4 colours only):** `#D0473E` deep purple · `#6A33D8` lava ·
  `#111111` ink · `#FFFFFF` chalk. Type: Montserrat headings + Instrument Sans body.
  Enforced in the image-prompt preambles in `api/ai/image.js`
  (`IMAGE_PROMPT_PREAMBLE`, `DESIGN_PROMPT_PREAMBLE`, `AD_PROMPT_PREAMBLE`,
  `QUALITY_SUFFIX`) and the pipeline HTML system prompts.
- **Banned phrases + no-dash rule** (`api/_shared/scenario-model.js`): `BANNED_RX`
  (streetwear journey, liquid lava, game-changer, hurry, don't miss out, last chance,
  while supplies last), `BANNED_TRANSFORM_RX`, `BANNED_CAPS_RX` (LIMITED TIME).
  `sanitizeBrand()` rewrites offenders; `scrubDashes()` strips em/en dashes
  (product-owner rule, 2026-07-04). A dev-only tripwire `assertNoBanned()` throws
  outside production; `api/ai/generate.js`'s `deepScrubDashes()` walks every
  generated JSON string (skipping URL-like values).
- **Calendar guardrails** (`api/_shared/calendar-guardrails.js`, pure/deterministic):
  15% `DISCOUNT_CAP` backed by a real code registry (`VIP15`, `NEW15`, `CART15`,
  `IAMBACK`, `SAVE15` min $75, `HELLO10`…); offer depth by cohort intent; ESP-pending
  gating (no fabricated cohort sizes); progressive suppression (never over-mail);
  "sneakers & botanicals only" scope; revenue-per-recipient surfacing.

---

## 10. Mobile — one super app

The whole OS ships as **one installable PWA + native Capacitor shells that render the
live deployment**, so **every web deploy is automatically a mobile release**.

- **PWA:** `manifest.webmanifest` + `sw.js` (service worker; `must-revalidate`, must
  never cache `/api/*`).
- **Capacitor:** `capacitor.config.json` — `appId com.knickgasm.lifecycleos`,
  `webDir mobile-shell`, `server.url` = the live deployment. `mobile-shell/index.html`
  is only a splash/offline fallback. Native projects in `android/` (Gradle) and
  `ios/` (`ios/App/Podfile`); a second scaffold lives at `mobile/`.
- **npm:** `mobile:sync`, `mobile:android`, `mobile:android:open`, `mobile:ios:open`.
- **CI:** `.github/workflows/mobile-builds.yml` ("Mobile Builds") — Android job
  (Node 22 — Capacitor 8 CLI requires ≥22 even though the app targets Node 20; Java
  21 to match `capacitor.build.gradle`) → `cap sync android` → `gradlew
  assembleDebug` → APK; iOS job (macOS, `continue-on-error`) → `cap sync ios` →
  `pod install` → unsigned IPA. Both publish to the fixed `mobile-latest` release
  tag (stable download URLs in the README).

---

## 11. Build / dev / test / deploy

- **Build:** `npm run build` = `scripts/build-catalog.js` (regenerates the catalog
  JSON). Runs on Vercel per `vercel.json buildCommand`.
- **Local dev:** use `vercel dev`. (The `npm run dev` script is a no-op stub that
  just holds a port open — it does **not** serve the app.)
- **Tests:** Playwright (`npm test`), specs in `tests/`, report in `tests/report/`.
  `npm run test:scenarios` runs the scenario harnesses. (Adding a test suite was the
  top item in `OPTIMISATION_NOTES.md`; it now exists.)
- **CI (`.github/workflows/`):**
  - `ci.yml` (**CI**) — HTML smoke test, `node --check` over all JS, the
    **12-function guard**, `npm run build`, then a Playwright `e2e` job.
  - `mobile-builds.yml` — §10.
  - `daily-sync.yml` (**Daily Intelligence Sync**, `30 6 * * *`) — POSTs
    `/api/brain?action=cron` with `CRON_SECRET`; exists because Hobby cron only fires
    once/day, so this adds a second daily run.
  - `alerts.yml` (**Revenue Alerts**) — anomaly/pulse/eod schedules self-route to the
    matching `?action=alerts-*`.
  - `competitor-hub-sync.yml` — manual fallback for the external Competitor Hub sync.
  - `sync-main.yml` — auto-merges `final-product` → `main` so production (which
    tracks `main`) always ships.
- **Deploy:** Vercel, auto on `main` or `npm run deploy`. Env vars are managed in
  Vercel only; `.env.example` is the full reference and REPLICATION §3 lists them.
  `vercel.json` carries ~70 route rewrites, redirects, security headers, and the 2
  Vercel crons (`/api/brain?action=cron` @ midnight IST; `/api/cron/social`).

---

## 12. Security posture

- **Service-role keys never reach the browser** — `public-config.js` returns only the
  Supabase URL + anon key (CDN-cached 5 min).
- **Cron/sync endpoints fail closed** — `competitor.js` sync requires `CRON_SECRET`
  in production; Smart Brain cron actions are `CRON_SECRET`-guarded.
- **Headers** — `vercel.json` sets X-Frame-Options, HSTS, a Permissions-Policy, and
  `no-store` on `/api/*`.
- **Google Sheets access** via Workload Identity Federation
  (`docs/workload-identity-federation.md`) rather than long-lived service-account
  keys.

---

## 13. Known doc drift (code is authoritative)

- **README's cascade line** ("OpenAI → Anthropic → Gemini → xAI → Groq → Cerebras")
  is **stale**. The real order is Anthropic-first, 8 providers, tier-routed — see
  `api/_shared/llm.js` and §6 above.
- `OPTIMISATION_NOTES.md` predates the Playwright suite and some module work; treat
  it as historical Mailer-Studio changelog.

---

## 14. Where to make common changes

| I want to… | Go to |
|---|---|
| Add a backend capability | an existing `?action=` router (`brain/calendar/competitor/kb`) or `api/_shared/` — **never a 13th `api/*.js`** |
| Change how mailers are generated | `api/ai/pipeline/*` (respect think→lock→execute) |
| Change provider order / models | `api/_shared/llm.js` |
| Add/adjust a banned phrase or the dash rule | `api/_shared/scenario-model.js` |
| Change discount caps / codes / suppression | `api/_shared/calendar-guardrails.js` |
| Tune the autopilot loop | `api/brain.js` + `lib/smart-brain/services.js` + `api/_shared/brain-*.js` |
| Adjust brand colours/prompt preambles | `api/ai/image.js` + pipeline HTML prompts |
| Add a route alias | `vercel.json` rewrites |
| Change the catalog build | `scripts/build-catalog.js` |
| Ship a mobile build | push touching `android/**` etc. → Mobile Builds workflow |
