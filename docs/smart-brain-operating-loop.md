# Smart Brain — Operating Loop & Module Contracts

> **Superseded for the brain layer:** the production Smart Brain lives on `main`
> (`api/brain.js`, `api/_shared/brain-*.js`, `/brain` console — see
> `docs/SMART_BRAIN.md`). The brain endpoints/loop described here were an earlier
> PR design. The parts of this runbook that remain live in this PR are the
> **Competitive-Intelligence collectors** (`/api/competitor?action=ci-*`,
> `workers/collect-*`, the `ci-daily` cron) and the `ci_*` data model.

This is the runbook for the KNICKGASM Lifecycle OS "Smart Brain" and the
Competitive-Intelligence collection stream. It documents **how the system runs
day-to-day**, the **clean contracts** between modules, and the **schema
assumptions** for the linked backend DB.

Full system design lives in
[`competitive-intelligence-and-smart-brain.md`](./competitive-intelligence-and-smart-brain.md).
This file is the operational companion.

---

## 1. The two streams (never mixed)

```
        OWN-DATA STREAM (Smart Brain)                 COMPETITOR STREAM (real-time)
  ┌───────────────────────────────────────┐   ┌──────────────────────────────────────┐
  │ Linked backend DB  ─► kb_campaigns     │   │ Collectors (Playwright / IMAP / APIs)  │
  │   (catalog, assets, history, metrics,  │   │   Meta · Google · TikTok · inboxes ·   │
  │    user-level data)                    │   │   MailCharts · Milled · Wayback        │
  │                                        │   │            │ POST                       │
  │ brain-analysis ─► cohorts / perf /     │   │            ▼                            │
  │   threshold-cleared library            │   │ ci-collect ─► dedup + versions          │
  │            │                           │   │ ci-offers  ─► ci_offers                  │
  │            ▼                           │   │ ci-enrich  ─► tags                       │
  │ brain-calendar ─► 15-day calendar ◄────┼───┤ benchmarkFeed()  (READ-ONLY aggregate)  │
  │            │                           │   └──────────────────────────────────────┘
  │            ▼                           │
  │ brain-generate ─► campaign_specs       │   The competitor stream feeds the calendar
  │   (platform-ready)                     │   ONLY as aggregate signals (offer mix,
  │            │                           │   counts). No row-level competitor data
  │            ▼                           │   ever enters own-data scoring.
  │ HITL verify ─► status: final           │
  └───────────────────────────────────────┘
```

**Hard rule:** `brain-*` modules never `require` or read `ci_*` tables except
through `brain-calendar.benchmarkFeed()`, which returns only aggregate counts.
`ci-*` modules never touch own-data (`kb_*`, `cohorts`, `calendar_*`,
`campaign_specs`) tables.

---

## 2. Module contracts (all under `api/_shared/`, zero function cost)

| Module | Owns | Key exports |
|---|---|---|
| `supa.js` | Supabase REST + content-hash helpers | `select/insert/update/rest/sha1/hashObj` |
| `ci-collect.js` | normalize → hash → dedup → store + version | `collectAd/collectEmail/collectLanding` |
| `ci-offers.js` | offer detection + the marketing query | `detectOffers/extractAndStore/query` |
| `ci-enrich.js` | AI enrichment + facet tags | `enrichOne/enrichBatch` |
| `ci-funnel.js` | Ad→LP→Email→Offer timelines | `rebuildForBrand/rebuildAll/getForBrand` |
| `brain-analysis.js` | scoring, thresholds, cohorts, daily pass | `dailyAnalysis/rescoreLibrary/topPerformers/upsertCohort` |
| `brain-calendar.js` | 15-day calendar, review, MVT, feedback | `generate/dailyReview/applyMvtWinners/recordFeedback` |
| `brain-generate.js` | per-slot funnel + platform payload + HITL | `generateForSlot/generateApproved/verifySpec` |

These are wired into the existing `?action=` routers so the Hobby 12-function
cap is untouched:

- **`/api/competitor`** → `ci-collect-ad|ci-collect-email|ci-collect-landing`,
  `ci-ads|ci-emails|ci-landing`, `ci-offers`, `ci-enrich`,
  `ci-funnel|ci-funnel-rebuild`.
- **`/api/calendar`** → `analyze`, `rescore-library`, `cohorts`,
  `top-performers`, `brain-generate`, `daily-review`, `mvt-apply`, `feedback`,
  `calendar`, `gen-slot`, `gen-approved`, `verify`, `recalibrate`.
- **`/api/kb`** → `index-campaigns`, `kb-campaigns`.

---

## 3. The DAILY loop (automated — no human)

Driven by Vercel Cron (see `vercel.json` → `crons`). Vercel automatically sends
`Authorization: Bearer $CRON_SECRET`, which the routers verify.

| Time (UTC) | Cron path | What runs |
|---|---|---|
| 02:00 | `/api/calendar?action=daily-review` | `dailyAnalysis()` (re-score library against current thresholds, refresh cohort signals, derive winning hooks/angles/formats) → re-score every tentative/reviewed calendar slot → apply pending human feedback → fold in MVT winners. Logs to `recalibration_log` (`kind=daily_review`). |
| 03:00 | `/api/competitor?action=ci-daily` | Combined competitor pass (one Hobby cron slot): mirror new emails from the legacy Sheet into `ci_emails` (`ci-email-bridge.sync`), then enrich the freshest un-enriched emails + ads via the LLM waterfall and fan out facet tags. |

> Hobby caps cron jobs at **2**, so the competitor daily work is combined into
> `ci-daily`. On Pro, split it into `ci-email-sync`, `ci-enrich&type=email`, and
> `ci-enrich&type=ad` for finer scheduling.

The competitor **collection** itself runs continuously from the external
collectors (`workers/collect-ads.js`, `collect-landing.js`, `collect-wayback.js`)
and the IMAP→Sheet→`ci_emails` bridge. Ad/landing collectors write straight to
Supabase via the shared core; emails flow Sheet → `ci_emails` through
`/api/competitor?action=ci-email-sync` (or the `ci-daily` cron). All paths are
idempotent — dedup + versioning happen DB-side.

**Generation** is intentionally NOT on the daily cron — assets are generated for
**approved** slots on demand (`gen-slot` / `gen-approved`) so LLM/image spend is
deliberate and tied to human approval.

---

## 4. The WEEKLY loop (human recalibration — mandatory)

Even as confidence grows and per-campaign verification load drops, a human MUST
recalibrate the whole system once a week. This is a hard floor.

1. Review the week's `recalibration_log` daily entries + calendar drift.
2. Adjust performance thresholds (`analysis_config.performance_thresholds`) and
   cohort definitions (`POST /api/calendar?action=cohorts`).
3. Re-generate the rolling calendar:
   `POST /api/calendar?action=brain-generate { "days": 15 }`.
4. Record the recalibration:
   `POST /api/calendar?action=recalibrate { "user_email": "...", "scope": ["calendar","cohorts","filters","thresholds"], "summary": {...} }`
   → writes `recalibration_log` (`kind=weekly_recalibration`, `next_due_at` +7d).

`next_due_at` on the latest `weekly_recalibration` row is the system's "is a
human overdue?" signal — surface it in the UI and block full automation if past.

---

## 5. Human-in-the-loop verification

- Every generated `campaign_specs` row starts `status='needs_review'` with
  `verification.required = true`. **No campaign is ever auto-final at launch.**
- `confidence` (0–0.85, capped) rises with the count of previously-`final`
  specs on that channel (`brain-generate.currentConfidence`). It is exposed so
  the UI can *reduce how many* specs a human must open — e.g. spot-check a
  sample once confidence > 0.6 — but the weekly recalibration is never removed.
- `POST /api/calendar?action=verify&id=<specId> { "user_email": "...", "approve": true }`
  → `verified` → `final`.

---

## 6. Generation output is platform-ready (Phase 2 plugs in, no refactor)

`campaign_specs.platform_payload` is normalized per channel with
`provider_targets` arrays (`klaviyo`/`webengage`/`google_ads`/
`meta_marketing_api`/`tiktok_business_api`). Phase 2 adds thin adapters that
read `platform_payload` and push live. **No adapter is built now** — the schema
is the contract.

---

## 7. Schema assumptions for the linked backend DB

The Smart Brain **never** queries the production DB directly. It consumes a
**provided, linked, read-only** DB assumed to contain, in a usable shape:

| Domain | Assumed contents | Lands in |
|---|---|---|
| Catalog | products, variants, handles, pricing, regions | `data/catalog/*` + KB |
| Brand assets / kit | logos, palette, fonts, imagery refs | KB (`kb_knowledge`) |
| Historical campaigns | mailers/ads/LPs with **linked assets** (creative id, hook, angle, format) | `kb_campaigns.assets` |
| Performance metrics | channel / campaign / **creative**-level KPIs (impr, ctr, opens, orders, revenue, roas, cac, conv) | `kb_campaigns.metrics`, `performance_metrics` |
| User-level data | RFM, lifecycle stage, product affinity, market | `cohorts.definition` + `.size` |
| Sales / festival history | past years' festival + sale moments + weights | `calendar_events` → `getMoments()` |

A sync job (push or pull) maps the linked DB into these tables via
`POST /api/kb?action=index-campaigns` (campaigns, upsert on `source_db_id`),
`POST /api/calendar?action=cohorts` (cohort definitions + computed size), and a
`performance_metrics` upsert. Until those tables are populated,
`brain-analysis` falls back to safe defaults (`DEFAULT_THRESHOLDS`) and
`brain-calendar` falls back to `FALLBACK_MOMENTS`, so the loop always runs.

---

## 8. Quick start (after the migration is applied)

```bash
# 1. apply the schema
#    supabase/migrations/20260617_competitive_intel_and_brain.sql

# 2. index own campaign library (sync job posts the linked DB rows)
curl -XPOST "$BASE/api/kb?action=index-campaigns" -d '{"items":[ ... ]}'

# 3. define cohorts
curl -XPOST "$BASE/api/calendar?action=cohorts" \
  -d '{"cohort_key":"uk-lapsed-sneaker","name":"UK lapsed sneaker","market":"UK","size":12000,"lifecycle_stage":"lapsed"}'

# 4. build the 15-day calendar
curl -XPOST "$BASE/api/calendar?action=brain-generate" -d '{"days":15,"market":"UK"}'

# 5. approve slots (UI or feedback), then generate
curl -XPOST "$BASE/api/calendar?action=feedback" -d '{"slot_id":1,"verdict":"approve","user_email":"a@knickgasm.com"}'
curl -XPOST "$BASE/api/calendar?action=gen-approved?limit=5"

# 6. competitor collectors POST captures (idempotent)
curl -XPOST "$BASE/api/competitor?action=ci-collect-ad" -d '{"source":"meta","ad_id":"123","brand_name":"Bird & Colorway","headline":"20% off","primary_copy":"...","landing_url":"https://..."}'

# 7. the marketing-team query
curl "$BASE/api/competitor?action=ci-offers&offer_type=free_gift&category=coffee&region=US&days=30"
```

---

## 9. UI

`/intel` (also `/competitive-intelligence`) — Brand View with clickable source
tiles per category (Ads: Meta/Google/TikTok/All · Emails:
Inbox/MailCharts/Milled/All · Landing: Direct/Wayback/PageTest/All), an Offers
board, and a Funnel timeline, plus global filters (brand, category, region, date
range, search). Clicking a source tile filters to that source.
