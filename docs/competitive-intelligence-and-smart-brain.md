# Competitive Intelligence & Smart Brain — Architecture

> **Status note (post-merge with `main`):** The **Smart Brain** is implemented on
> `main` — `api/brain.js` + `api/_shared/brain-*.js` + the `/brain` console and
> `/agent` page (see `docs/SMART_BRAIN.md`). The Smart-Brain sections below describe
> an earlier PR design and are **superseded** by main's; treat them as background.
> The **Competitive-Intelligence Collection** sections (ads / emails / landing
> pages / offers / funnels, the `ci_*` schema, collectors and dashboard) are what
> this PR actually ships and remain accurate.

> Status: design spec. This document is the single source of truth for two
> overlapping systems built into KNICKGASM Lifecycle OS:
>
> - **(A) Competitive Intelligence (CI) Collection System** — continuously
>   discover, collect, normalize, dedupe, store and enrich competitor **ads**,
>   **emails**, **landing pages**, plus first-class **offers** and reconstructed
>   **funnels**, scaling to 500+ DTC brands across custom sneakers / sneaker
>   resale / streetwear / sneaker care and accessories.
> - **(B) KNICKGASM Smart Brain** — Knowledge Base (own catalog/assets/historical
>   campaigns) + Data Analysis Engine + Competitor Benchmarking (a separate
>   real-time stream, logically isolated from own-data) + Calendar Intelligence
>   (15-day rolling, MVT loop, human feedback) + Generation Engine (platform-ready
>   campaign spec objects) + Human-in-the-loop verification.
>
> **Hard platform constraint:** this app deploys as a *single Vercel project*
> (`framework: null`, `outputDirectory: "."`). The Hobby plan caps Serverless
> Functions at **12 and the app is at the limit** (see `vercel.json`). Every new
> capability MUST be added as a `?action=` route on an existing router or as a
> `require()`d module under `api/_shared/` (underscore paths are NOT counted as
> functions). Heavy/long-running scraping runs on an **external Playwright
> worker**, not on Vercel.
>
> **Live platform push is explicitly out of scope (Phase 2).** Generation output
> is emitted in a platform-ready schema (`campaign_specs`) so that pushing to
> Google / Meta / TikTok / Klaviyo / WebEngage plugs in later with no refactor.

---

## 1. Complete System Architecture

The defining principle: the **competitor real-time stream is logically isolated
from own-data logic.** They never share a write path, never share a table
namespace (`ci_*` vs everything else), and the Brain only ever reads competitor
data through the read-only Benchmarking surface — competitor rows can never
contaminate KNICKGASM's own performance metrics, cohorts, or catalog.

```
                        ┌──────────────────────── EXTERNAL (local / VM) ────────────────────────┐
                        │  Playwright Worker (workers/*.js) — long-running, NOT on Vercel        │
                        │   auto-subscribe.js · scrape-ads.js · capture-landing.js · screenshot  │
                        └───────────────┬───────────────────────────────────────────────────────┘
                                        │ POSTs results back (CRON_SECRET / INGEST_TOKEN)
                                        ▼
   ╔════════════════════════════════════════════════╗      ╔══════════════════════════════════════════╗
   ║   (A) COMPETITOR REAL-TIME STREAM  [ci_*]      ║      ║   (B) OWN-DATA / SMART BRAIN              ║
   ║   logically + namespace isolated               ║      ║                                          ║
   ║                                                ║      ║   KB (own catalog/assets/campaigns)      ║
   ║   discover → fetch → normalize → dedup → store ║      ║   kb_campaigns · cohorts ·               ║
   ║          → screenshot → enrich                 ║      ║   performance_metrics                    ║
   ║                                                ║      ║                                          ║
   ║   Sources:                                     ║      ║   Data Analysis Engine                   ║
   ║    Ads  : Meta Ad Library / Google ATC / TikTok║      ║    cohorts · perf thresholds · daily     ║
   ║    Email: inboxes · MailCharts · Milled · Owl. ║      ║    analysis                              ║
   ║    LP   : from ads/emails · Wayback · pagetest ║      ║                                          ║
   ║                                                ║      ║   Calendar Intelligence (15-day roll)    ║
   ║   Tables: brands, ci_ads, ci_emails,           ║      ║    calendar_slots · mvt_experiments ·    ║
   ║    ci_landing_pages, ci_offers, ci_funnels,    ║      ║    calendar_feedback · recalibration_log ║
   ║    ci_screenshots, ci_asset_versions,          ║      ║                                          ║
   ║    ci_creative_tags                            ║      ║   Generation Engine                      ║
   ╚═══════════════════════╦════════════════════════╝      ║    campaign_specs (platform-ready)       ║
                           │                               ╚════════════════╦═════════════════════════╝
                           │  READ-ONLY benchmarking feed                    │
                           └───────────────►  ◄────────── inspiration only ──┘
                                        (Brain reads ci_* for benchmarking; never writes,
                                         never joins ci_* metrics into own performance_metrics)

   ┌──────────────────────────── VERCEL SINGLE PROJECT (≤12 functions) ───────────────────────────┐
   │  api/competitor.js  ?action=…   (CI router; logic in _shared/competitor-core.js)              │
   │  api/kb.js          ?action=…   (KB + own-data router; Supabase-backed)                       │
   │  api/calendar.js    ?action=…   (Calendar Intelligence; _shared/calendar-*.js)               │
   │  api/ai/generate.js ?type=…     (Generation Engine; uses _shared/llm.js)                      │
   │  api/ai/image.js · api/ai/pipeline/* · api/public-config.js                                   │
   │  _shared/llm.js  — 6-provider text waterfall used by ALL enrichment + generation             │
   └───────────────────────────────────────────────────────────────────────────────────────────-─┘
                                        │
                                        ▼
   ┌──────────────────────────── STORAGE ───────────────────────────────────────────────────────┐
   │  Supabase Postgres (structured)  +  Supabase Storage buckets (screenshots/raw HTML/MIME)     │
   │  Legacy: Google Sheet ("Emails"/"Competitors" tabs) — migration path → Supabase ci_*         │
   │  Linked backend DB (read-only): catalog · assets · brand kit · historical campaigns          │
   └──────────────────────────────────────────────────────────────────────────────────────────-──┘
```

**Stream isolation rules (enforced, not aspirational):**

1. **Namespace:** all competitor tables are prefixed `ci_` (plus `brands`).
   Own-data tables are unprefixed (`kb_campaigns`, `cohorts`, `performance_metrics`, …).
2. **Write path:** only the external worker + `api/competitor.js` write `ci_*`.
   Only the Brain routers (`api/kb.js`, `api/calendar.js`) write own-data tables.
3. **Read path:** the Brain may `SELECT` from `ci_*` for benchmarking and
   inspiration, but **never `INSERT`/`UPDATE`** and **never `JOIN` competitor
   metrics into `performance_metrics`**. CI rows are evidence, not ground truth.
4. **Trust boundary:** `OWN_DOMAINS` (`knickgasm.com`, `knickgasm.com`,
   `knickgasm.com`) are filtered out of all CI discovery/capture (see
   `isOwnBrand()` in `competitor-core.js`), so KNICKGASM never appears as its own
   competitor.

---

## 2. Database Schema

All tables below live in Supabase Postgres, added via a new timestamped
migration under `supabase/migrations/` (follow the existing
`YYYYMMDD_description.sql` convention; bundle into `supabase/COMBINED_RUN_THIS.sql`).
RLS follows existing patterns: `ci_*` tables are service-role-write, authenticated-read.

### 2.1 Competitive Intelligence tables (`ci_*`)

#### `brands` — the competitor registry (500+ rows target)
Migration target for the legacy Google Sheet "Competitors" tab (columns A–R in
`competitor-core.js`).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `brand_name` | text | display name |
| `website_url` | text | real homepage |
| `domain` | text | **dedup key**, `normalizeDomain()` (lowercased, no scheme/www) |
| `category` | text | custom-sneakers / sneaker-resale / streetwear / sneaker-care / accessories … |
| `country` | text | |
| `positioning` | text | Premium / Mass / Luxury |
| `newsletter_signup_url`, `popup_signup`, `sms_signup` | text/bool | for the auto-subscribe worker |
| `blog_url`, `bestseller_url`, `new_arrivals_url` | text | |
| `subscription_status`, `date_subscribed`, `confirmation_required`, `confirmation_completed` | text | inbox-subscription lifecycle |
| `source` | text | `seed` / `discovery` / `manual` |
| `priority` | int | crawl-frequency tier (1 = daily, 2 = 3-day, 3 = weekly) |
| `is_active` | bool | soft-disable a brand without losing history |
| `created_at`, `updated_at` | timestamptz | |

**Dedup key:** `unique(domain)`.

#### `ci_ads` — collected competitor ad creatives
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `brand_id` | uuid fk → brands | |
| `source` | text | `meta_ad_library` / `google_ats` / `tiktok_creative_center` |
| `source_ad_id` | text | platform's archive/ad id (e.g. Meta `adArchiveID`) |
| `creative_type` | text | image / video / carousel / text |
| `headline`, `primary_text`, `cta_text`, `cta_url` | text | normalized copy fields |
| `landing_url` | text | destination → links to `ci_landing_pages` |
| `media_urls` | jsonb | original image/video URLs (re-hosted into Storage) |
| `first_seen`, `last_seen` | timestamptz | active-window reconstruction |
| `is_active` | bool | still serving at `last_seen` |
| `raw` | jsonb | untouched source payload (audit/reprocess) |
| `content_hash` | text | **dedup key** = sha256(source + source_ad_id + normalized_copy) |
| `enriched_at` | timestamptz | null until AI enrichment runs |
| `created_at` | timestamptz | |

**Dedup key:** `unique(source, source_ad_id)` + secondary `content_hash` for
sources without a stable id. **Version history:** copy/media changes append a new
`ci_asset_versions` row (see below) rather than overwriting; `last_seen` bumps in place.

#### `ci_emails` — captured competitor newsletters
Migration target for the legacy "Emails" tab (columns A–K).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `brand_id` | uuid fk → brands | |
| `source` | text | `inbox` / `mailcharts` / `milled` / `owletter` |
| `sender_email`, `subject`, `preview` | text | |
| `received_at` | timestamptz | |
| `body_text` | text | `htmlToText()` output |
| `raw_html_path` | text | Storage object key (full MIME/HTML), not inline |
| `screenshot_id` | uuid fk → ci_screenshots | |
| `promo_codes` | text[] | `extractPromoCodes()` |
| `inline_image_count`, `attachment_count` | int | |
| `content_hash` | text | **dedup key** = sha256(sender + subject + received_at) |
| `enriched_at` | timestamptz | |
| `created_at` | timestamptz | |

**Dedup key:** `unique(sender_email, subject, received_at)` — identical to the
existing Sheet key `${address}|${subject}|${receivedAt}`.
**⚠ Ethics:** email link URLs are extracted for landing-page discovery but links
are **never auto-clicked from the live inbox** (avoids registering opens/clicks);
the Playwright worker visits them out-of-band.

#### `ci_landing_pages` — pages behind ads/emails
Supersedes `public.competitor_landing_pages` from `20260606_kb_storage_and_landing.sql`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `brand_id` | uuid fk → brands | |
| `url` | text | original |
| `url_hash` | text | **dedup key** = sha1(canonicalize(url)) — strip `utm_*`/`fbclid`/`gclid`, drop fragment, trim trailing slash |
| `final_url` | text | after redirects |
| `source_kind` | text | `ad` / `mailer` / `direct` / `wayback` / `pagetest` |
| `source_ad_id`, `source_email_id` | uuid | provenance back-link |
| `title`, `html_snippet` | text | first ~10 KB; full HTML → Storage |
| `raw_html_path`, `screenshot_id` | text/uuid | |
| `captured_at`, `status` | timestamptz/text | `queued` / `captured` / `failed` |
| `content_hash` | text | sha256 of normalized DOM text → drives `ci_asset_versions` diffing |
| `enriched_at` | timestamptz | |

**Dedup key:** `unique(url_hash)`. **Version history:** re-capturing a page whose
`content_hash` changed writes a new `ci_asset_versions` row (kind=`landing_page`)
so the timeline of pricing/hero/offer changes is preserved (the "landing diff").

#### `ci_offers` — first-class offer object (the analytic core)
Every ad/email/landing page can yield 0..n structured offers.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `brand_id` | uuid fk → brands | |
| `offer_type` | text | `percent_off` / `amount_off` / `bundle` / `free_gift` / `subscription` / `bogo` / `shipping_incentive` |
| `value` | numeric | 10 (for 10% off), 25 (for $25 off) |
| `value_unit` | text | `percent` / `currency` |
| `currency` | text | USD / GBP / EUR / INR |
| `code` | text | promo code if any |
| `product_category` | text | sneakers / denim / laces / care-kits … (for "free-gift offers on sneakers" queries) |
| `min_spend`, `gift_description`, `subscription_discount` | numeric/text/numeric | |
| `source_kind`, `source_id` | text/uuid | which ad/email/landing produced it |
| `first_seen`, `last_seen` | timestamptz | offer duration window |
| `raw_excerpt` | text | the literal text it was parsed from |
| `content_hash` | text | **dedup key** = sha256(brand + offer_type + value + code + category) |

**Dedup key:** `unique(content_hash)` (re-seen offers bump `last_seen`).

#### `ci_funnels` — reconstructed Ad→Landing→Email→Checkout timelines
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `brand_id` | uuid fk → brands | |
| `entry_point` | text | `ad` / `email` |
| `cohort_hint` | text | inferred segment (welcome / winback / VIP …) |
| `steps` | jsonb | ordered `[{stage, ref_table, ref_id, observed_at, offer_id?}]` |
| `stages_present` | text[] | e.g. `{ad,landing,email}` (checkout rarely observable) |
| `duration_hours` | numeric | first → last observed step |
| `offer_progression` | jsonb | how the offer escalates across steps |
| `reconstructed_at` | timestamptz | |
| `content_hash` | text | **dedup key** = sha256(brand + entry_point + sorted step refs) |

**Version history:** funnels are recomputed on a schedule; a new reconstruction
with a changed `content_hash` is inserted (immutable snapshots), never overwritten.

#### `ci_screenshots` — image references (binary in Storage)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `owner_kind` | text | `ad` / `email` / `landing_page` |
| `owner_id` | uuid | polymorphic ref |
| `storage_path` | text | Supabase Storage object key |
| `width`, `height`, `bytes` | int | |
| `content_hash` | text | **dedup key** = sha256(image bytes) — identical screenshots stored once |
| `captured_at` | timestamptz | |

**Dedup key:** `unique(content_hash)` (content-addressed; rows reference the same blob).

#### `ci_asset_versions` — universal version history
The single change-history table for ads, landing pages and offers.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `asset_kind` | text | `ad` / `landing_page` / `offer` |
| `asset_id` | uuid | ref to the live row |
| `version_no` | int | monotonic per `(asset_kind, asset_id)` |
| `snapshot` | jsonb | full normalized state at capture time |
| `content_hash` | text | the hash that triggered this version |
| `diff` | jsonb | computed delta vs previous version (changed fields only) |
| `captured_at` | timestamptz | |

**Dedup key:** `unique(asset_kind, asset_id, content_hash)` — a re-capture with an
unchanged hash does NOT create a version.

#### `ci_creative_tags` — AI enrichment labels (many-to-many)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `asset_kind`, `asset_id` | text/uuid | polymorphic |
| `tag_type` | text | `theme` / `emotion` / `format` / `audience` / `season` / `objection` |
| `tag_value` | text | e.g. theme=`ritual`, emotion=`calm`, format=`founder-note` |
| `confidence` | numeric | 0–1 from the enrichment model |
| `model`, `created_at` | text/timestamptz | provenance (which `llm.js` provider/model) |

**Dedup key:** `unique(asset_kind, asset_id, tag_type, tag_value)`.

### 2.2 Smart Brain (own-data) tables

#### `kb_campaigns` — historical campaign library
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `name`, `channel`, `cohort` | text | channel = email / google / meta / tiktok |
| `sent_at` | timestamptz | |
| `assets` | jsonb | linked asset refs (HTML, images) from backend DB / Storage |
| `spec_ref` | uuid fk → campaign_specs | the generated spec that produced it |
| `performance_ref` | uuid fk → performance_metrics | |
| `embedding` | vector | (pgvector) semantic retrieval for "what worked before" |
| `created_at` | timestamptz | |

#### `cohorts` — own-audience segment definitions
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `key` | text unique | e.g. `welcome`, `winback_90d`, `vip_rfm_555` |
| `definition` | jsonb | RFM / recency / category rules |
| `size`, `last_computed_at` | int/timestamptz | from the Data Analysis Engine |

#### `performance_metrics` — own channel/campaign/creative metrics
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `level` | text | `channel` / `campaign` / `creative` |
| `ref_id` | uuid | campaign or creative ref |
| `metric_date` | date | |
| `opens`, `clicks`, `ctr`, `conv`, `revenue`, `roas`, `unsubs` | numeric | |
| `threshold_status` | text | computed vs `targets.json`-style thresholds: `above` / `at` / `below` |

> **Hard rule:** `performance_metrics` contains KNICKGASM-owned data only. No `ci_*`
> row is ever written here — competitor "performance" is inferred (longevity of
> ads, offer cadence), not measured, and lives in `ci_*`.

#### `calendar_slots` — 15-day rolling plan
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `slot_date` | date | |
| `cohort_id` | uuid fk → cohorts | |
| `channel` | text | |
| `theme`, `rationale` | text | why this slot exists (festival, restock, winback…) |
| `status` | text | `proposed` / `verified` / `live` / `archived` |
| `spec_ref` | uuid fk → campaign_specs | |
| `confidence` | numeric | drives verification load (see §6/§8) |
| `auto_reviewed_at`, `human_reviewed_at` | timestamptz | |

#### `campaign_specs` — platform-ready generation output
The Phase-2 plug-in contract. One row = one fully specified, channel-agnostic
campaign that a future pusher can translate to a platform payload with no schema change.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `slot_id` | uuid fk → calendar_slots | |
| `channel` | text | email / google / meta / tiktok / landing |
| `cohort_id` | uuid fk → cohorts | |
| `spec` | jsonb | the platform-ready object (see §7 schema) |
| `assets` | jsonb | image/HTML refs (Storage) |
| `verification_status` | text | `pending` / `approved` / `changes_requested` |
| `confidence` | numeric | |
| `version_no` | int | MVT/iteration history |
| `created_at` | timestamptz | |

#### `calendar_feedback` — human-in-the-loop signal
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `slot_id` / `spec_id` | uuid | what was reviewed |
| `reviewer` | text | user email |
| `decision` | text | `approve` / `edit` / `reject` |
| `edits` | jsonb | structured corrections (feed back into prompts) |
| `notes` | text | |
| `created_at` | timestamptz | |

#### `mvt_experiments` — multivariate test loop
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `slot_id` | uuid fk → calendar_slots | |
| `hypothesis` | text | |
| `variants` | jsonb | spec refs + the single variable changed |
| `metric` | text | primary KPI |
| `status` | text | `running` / `won` / `inconclusive` |
| `winner_spec_id` | uuid | promoted variant |
| `learning` | text | written back into KB / prompt context |

#### `recalibration_log` — hard weekly human recalibration
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `week_of` | date | |
| `reviewer` | text | |
| `confidence_adjustments` | jsonb | per-cohort/channel confidence deltas |
| `prompt_directives` | jsonb | voice/offer guardrail changes applied to generation |
| `summary` | text | |
| `created_at` | timestamptz | |

### Schema assumptions for the linked backend DB

The Smart Brain reads from a pre-existing **backend data warehouse / production
DB** (the `ingest/` DuckDB → `sync_to_supabase.py` pipeline already populates
much of this). The Brain assumes that DB contains, and treats it as a **read-only
contract**:

- **Catalog** — products with handle (`h`), region, price, collection mapping
  (already built to `data/catalog/products_{us,uk,global}.json`).
- **Assets** — product imagery, hero shots, lifestyle photography (object refs).
- **Brand kit** — palette, typography, banned/preferred phrases (codified in
  `CLAUDE.md` Brand Constants; treated as immutable generation guardrails).
- **Historical campaigns** — with **linked assets** and **performance metrics at
  channel / campaign / creative level** (mirrored into `kb_campaigns` +
  `performance_metrics`).
- **User-level data** — customer records, RFM inputs, subscription state
  (consumed only in aggregate to compute `cohorts`).
- **Past sales & festival/calendar history** — seasonality signal for Calendar
  Intelligence (festivals already seeded via `scripts/seed-festivals*.js` →
  `data/festivals.json`).

**Read-only contract (non-negotiable):**

1. The Brain **never connects to the production DB directly** at request time.
   It reads only the **synced Supabase mirror** populated by the offline
   `ingest/sync_to_supabase.py` job.
2. No serverless function holds production DB credentials.
3. Writes flow one way: production → ingest → Supabase. The Brain never writes
   back upstream.
4. PII stays in the warehouse; only aggregated cohort definitions/sizes reach
   `cohorts`.

---

## 3. Scraping Architecture

Each source has its own collector. **No headless browser is bundled into Vercel
functions** (the existing email path proves this — `competitor-core.js` renders
screenshots via the free Microlink API rather than bundling Chromium, because a
browser blows the 250 MB / cold-start budget). Browser work runs on the
**external Playwright worker** (§5), using `playwright-core` + `@sparticuz/chromium`
(the proven combo from `docs/landing-page-capture.md`).

| Source | Collector | Transport | Notes |
|---|---|---|---|
| **Meta Ad Library** | `fetchMetaAds()` (already in `competitor-core.js`) | Apify free actor (`curious_coder~facebook-ads-library-scraper`) OR deep-link fallback | Returns structured creatives when `APIFY_TOKEN` set; otherwise a browsable deep-link. No login. |
| **Google Ads Transparency Center** | worker `scrape-ads.js` (`source=google_ats`) | Playwright on the public ATC UI | Per-advertiser pages; respect rate limits, identifiable UA. |
| **TikTok Creative Center** | worker `scrape-ads.js` (`source=tiktok_creative_center`) | Playwright on public Top-Ads pages | Category/region filters; capture video poster + copy. |
| **Email — dedicated inboxes** | `fetchUnreadEmails()` + `runSync()` (already live) | Gmail IMAP (`imapflow` + `mailparser`), scans INBOX + Spam | The auto-subscribe worker subscribes the capture inbox to each brand. |
| **Email — MailCharts / Milled / Owletter** | worker `scrape-emails.js` (per-source adapters) | Playwright/HTTP against each aggregator's public brand pages | Used to backfill brands we can't subscribe to; normalized into the same `ci_emails` shape. |
| **Email — webhook ingest** | `ingestEmail()` (already live) | `POST /api/competitor?action=ingest` (Cloudflare Email Routing → n8n) | Keyless capture path; same noise filter + dedupe. |
| **Landing pages — from ads/emails** | worker `capture-landing.js` | Playwright `goto(networkidle)` → screenshot + first 10 KB HTML | URLs extracted from ad `cta_url` / email `<a href>`, canonicalized + hashed. |
| **Landing pages — Wayback** | worker (`source=wayback`) | `web.archive.org` CDX + snapshot fetch | Historical landing diffs without re-crawling the live site. |
| **Landing pages — PageTest** | worker (`source=pagetest`) | pagetest.ai / performance probe | Optional perf/UX signal attached to `ci_landing_pages`. |

**Rate limiting / rotation / ToS:**

- **Per-brand crawl budget:** cap unique pages/ads per brand per day by `brands.priority`
  (e.g. 5 LPs/day) to avoid scraper-shaped traffic (carried over from
  `landing-page-capture.md`).
- **Identifiable UA:** `Mozilla/5.0 (compatible; KnickgasmCompBot/1.0)`.
- **robots.txt:** check before visiting any landing page; honor `Disallow`.
- **Proxy/rotation:** worker supports an optional rotating residential proxy pool
  (`WORKER_PROXY_URL` list) for ad-library pages that geo/rate-gate; randomized
  inter-request jitter (2–8 s).
- **Never auto-click email links from the live inbox** — extract URLs, visit
  out-of-band from the worker so the inbox doesn't register opens/clicks.
- **Never** submit forms, trigger checkout, or store payment-page HTML (strip by
  URL pattern). Maintain a `disallow_brands` opt-out list.
- Prefer official/free APIs (Apify free actor, Wayback CDX) over raw scraping
  wherever a source offers one.

---

## 4. Queue Architecture

A single logical pipeline, with the **same stages for every source**:

```
discovery → fetch → normalize → dedup → store → screenshot → enrich
```

Because Vercel Hobby has no durable queue and caps function count, the queue is a
**Postgres-backed work table driven by cron + the external worker** — not a
managed broker.

- **Work table:** `ci_jobs(id, stage, source, payload jsonb, status, attempts,
  run_after, locked_by, locked_at, created_at)` (add in the same migration).
  Stages map 1:1 to the pipeline. `status ∈ {queued, running, done, failed}`.
- **Enqueue:** `discovery` enqueues brands; each completed stage enqueues the next
  (`fetch` → `normalize` → …). Enqueue is an idempotent upsert keyed by the stage
  + content identity so re-runs don't duplicate work.
- **Drain on Vercel (light stages):** `discover`, `normalize`, `dedup`, `store`,
  `enrich` are pure compute/HTTP and run inside the `?action=` routers, invoked by
  **cron** (`vercel.json` `crons`). Each cron call leases a small batch
  (`SELECT … FOR UPDATE SKIP LOCKED LIMIT n`), processes within `maxDuration`, and
  returns. No long-held connections.
- **Drain on the worker (heavy stages):** `fetch` (ad-library/aggregator scraping)
  and `screenshot` (Playwright render) are leased and executed by the external
  worker, which POSTs results back to `api/competitor.js` (`action=ingest` /
  `mark-subscribed` / new `action=store-ad` / `action=store-landing`), guarded by
  `CRON_SECRET` / `INGEST_TOKEN` — exactly the pattern the existing
  `workers/auto-subscribe.js` uses.
- **Backpressure & retries:** `attempts` increments on failure; exponential
  `run_after` backoff; a job dead-letters at `attempts > 5` (`status=failed`,
  surfaced in the dashboard).
- **Throttle:** the existing warm-instance poll throttle in `api/competitor.js`
  (`POLL_THROTTLE_MS = 30000`) is the model for not hammering external sources.

---

## 5. Worker Architecture

The external worker is the **only** component that runs a real browser or
long jobs. It lives in `workers/` (the repo already references
`workers/auto-subscribe.js`) and runs on a local machine or a small always-on VM
— **never on Vercel**.

```
workers/
  index.js            # poll loop: lease ci_jobs (fetch/screenshot), dispatch
  auto-subscribe.js   # (exists) subscribe capture inbox to brand newsletters
  scrape-ads.js       # Meta(Apify) / Google ATC / TikTok Creative Center
  scrape-emails.js    # MailCharts / Milled / Owletter adapters
  capture-landing.js  # Playwright visit → screenshot + HTML (renderLandingPage)
  lib/playwright.js   # playwright-core + @sparticuz/chromium launcher
  lib/post-back.js    # authenticated POST to api/competitor (?action=…)
```

- **Stateless & keyless to Google:** the worker holds NO Google/Supabase
  service keys. It scrapes, then POSTs normalized results back through
  `api/competitor.js`, which owns all privileged writes (this is exactly why
  `mark-subscribed` exists). Screenshots/HTML are uploaded to Supabase Storage
  via a short-lived signed upload URL minted by the router, or POSTed inline for
  the router to store.
- **Lease protocol:** `POST /api/competitor?action=lease&stage=fetch&n=5` returns
  a batch and marks them `running` with `locked_by`/`locked_at`. The worker
  completes each and POSTs results; a janitor cron reclaims stale leases
  (`locked_at` older than the stage timeout).
- **Concurrency:** bounded worker pool (e.g. 3 browser contexts) with per-brand
  rate caps from §3.
- **Resilience:** one brand failing never blocks the batch (per-item try/catch,
  identical to `runSync()`'s per-mail handling). Crash-safe: leases expire and
  the job re-queues.

---

## 6. AI Enrichment Pipeline

All enrichment goes through the shared 6-provider waterfall
`api/_shared/llm.js` (`callLLM` + `parseJSON`) — **never call a provider
directly.** Enrichment runs as the `enrich` queue stage (cron-driven, batched),
writing structured fields back to `ci_*` and labels to `ci_creative_tags`.

**Per-source enrichment fields (JSON-schema'd outputs):**

```jsonc
// ADS  → updates ci_ads + ci_creative_tags + may emit ci_offers
{
  "theme": "ritual|origin|health|gifting|seasonal|...",
  "emotion": "calm|energy|trust|FOMO|aspiration|...",
  "format": "hero|carousel|UGC|founder-note|comparison|...",
  "value_proposition": "string",
  "target_audience": "string",
  "hook_type": "question|stat|story|offer|...",
  "offers": [{ "offer_type": "...", "value": 0, "currency": "...", "code": "...", "product_category": "..." }],
  "creative_tags": [{ "tag_type": "theme", "tag_value": "ritual", "confidence": 0.0 }]
}
// EMAILS → updates ci_emails + ci_creative_tags + ci_offers
{
  "campaign_type": "welcome|promo|winback|newsletter|product-launch|...",
  "subject_strategy": "string",
  "offer_summary": "string",
  "offers": [ /* same offer shape */ ],
  "products_featured": ["string"],
  "cta_strategy": "string",
  "send_timing_signal": "string"
}
// LANDING PAGES → updates ci_landing_pages + ci_creative_tags + ci_offers
{
  "page_type": "PDP|collection|quiz|advertorial|bundle|...",
  "hero_message": "string",
  "social_proof": ["review-count","ratings","press","UGC"],
  "trust_signals": ["guarantee","free-returns","subscription-skip","..."],
  "pricing_strategy": "string",
  "offers": [ /* same offer shape */ ],
  "conversion_elements": ["sticky-cta","urgency-timer","bundle-builder","..."]
}
```

**How `llm.js` is used:**

- Every enrichment call passes `responseFormat: { type: 'json_object' }`, a tight
  `systemPrompt` ("output strict JSON of this exact shape"), and `stage` (e.g.
  `ci_enrich_ad`) for log tracing — mirroring `discoverBrands()`.
- Outputs are parsed with the resilient `parseJSON()` (handles fences/prose).
- Provider waterfall (OpenAI → Anthropic → Gemini → Grok → Groq → Cerebras) gives
  free fallbacks; for high-volume enrichment, set `APP_AI_PROVIDER='gemini+'` to
  prefer the free tiers (Gemini + Groq + Cerebras) and skip paid credits.

**Cost control / batching:**

- **Batch** multiple assets per LLM call where the schema allows (e.g. 5 ad copies
  → one call returning an array) to amortize tokens.
- **Enrich-once:** skip rows where `enriched_at` is set and `content_hash`
  unchanged (a re-seen-but-identical asset is never re-enriched).
- **Truncate** inputs (email body to preview + first N chars, LP to text-only DOM)
  before sending.
- **Quota-aware:** `llm.js` already treats HTTP 400 + billing keywords as quota
  exhaustion (Common Bug #6) and rotates keys/providers, so enrichment degrades to
  free tiers rather than failing.

---

## 7. API Specification

All endpoints are `?action=` routes on **existing** functions (no new function
files — preserves the 12-function ceiling). CORS + `Cache-Control: no-store`
already applied per router. Mutating actions require `CRON_SECRET` (cron) or
`INGEST_TOKEN` (worker).

### `api/competitor.js` — Competitive Intelligence

| Method | Action | Params / Body | Response |
|---|---|---|---|
| GET | `ads` *(exists)* | `brand`, `country`, `limit` | Meta Ad Library creatives or deep-link |
| GET | `ads-list` | `brand_id?`, `source?`, `from?`, `to?`, `offer_type?`, `creative_type?`, `limit`, `offset` | `{ ok, ads:[ci_ads], total }` |
| POST | `ads-collect` | `{ brand_id, source }` (worker) | enqueues `fetch` jobs → `{ ok, queued }` |
| POST | `ads-enrich` | `{ ids:[] }` or `{ since }` | runs §6 ad enrichment → `{ ok, enriched }` |
| GET | `emails-list` *(extends `list`)* | `brand_id?`, `from?`, `to?`, `campaign_type?`, `search?` | `{ ok, emails:[ci_emails] }` |
| GET | `email-html` *(exists: `html`)* | `id` | `{ ok, html }` |
| POST | `ingest` *(exists)* | `{ from, fromName, subject, html, text, receivedAt }` | `{ ok, stored, brand, key }` |
| POST | `emails-enrich` | `{ ids:[] }` | `{ ok, enriched }` |
| POST | `landing-collect` | `{ url, brand_id, source_kind, source_id }` | upsert by `url_hash` → `{ ok, status }` |
| GET | `landing-list` | `brand_id?`, `source_kind?`, `search?` | `{ ok, pages:[ci_landing_pages] }` |
| GET | `landing-diff` | `id` or `url_hash` | `{ ok, versions:[ci_asset_versions] }` (pricing/hero/offer changes over time) |
| GET | `offers-query` | `offer_type?`, `product_category?`, `country?`, `brand_id?`, `from?`, `to?` | `{ ok, offers:[ci_offers] }` — e.g. `?action=offers-query&offer_type=free_gift&product_category=sneakers&country=US&from=2026-05-18` answers *"free-gift offers on sneakers in US in last 30 days"* |
| POST | `funnel-reconstruct` | `{ brand_id }` | builds `ci_funnels` from ads+emails+landing by time/offer correlation → `{ ok, funnels:[…] }` |
| GET | `funnel-list` | `brand_id`, `entry_point?` | `{ ok, funnels:[ci_funnels] }` |
| GET/POST | `brands` / `discover` / `seed` / `mark-subscribed` *(exist)* | — | brand registry + discovery (unchanged) |
| POST | `lease` | `stage`, `n` (worker) | `{ ok, jobs:[…] }` (leases queue work) |

### `api/kb.js` — Knowledge Base + Data Analysis (Smart Brain own-data)

| Method | Action | Params / Body | Response |
|---|---|---|---|
| GET | `list` *(exists)* | KB assets/campaigns | `{ ok, items }` |
| POST | `ingest` *(exists)* | KB doc/campaign | `{ ok }` |
| GET | `brain-analyze` | `from?`, `to?`, `level?` | `{ ok, summary, threshold_breaches:[performance_metrics] }` (daily analysis) |
| GET | `cohorts` | — | `{ ok, cohorts:[cohorts] }` |
| POST | `cohorts-recompute` | `{ key? }` | recompute sizes from synced warehouse → `{ ok, cohorts }` |
| GET | `campaigns-search` | `query`, `channel?`, `cohort?` | `{ ok, kb_campaigns }` (pgvector "what worked before") |

### `api/calendar.js` — Calendar Intelligence

| Method | Action | Params / Body | Response |
|---|---|---|---|
| POST | `generate` *(exists)* | `{ horizon_days=15 }` | builds rolling `calendar_slots` → `{ ok, slots }` |
| POST | `review` | `{ date? }` (cron daily) | auto-review slots, adjust `confidence`, set `auto_reviewed_at` → `{ ok, reviewed }` |
| POST | `mvt` | `{ slot_id, hypothesis, variants }` | create/advance `mvt_experiments` → `{ ok, experiment }` |
| POST | `feedback` | `{ slot_id|spec_id, decision, edits, notes }` | write `calendar_feedback` → `{ ok }` |
| POST | `recalibrate` | `{ week_of, confidence_adjustments, prompt_directives, summary }` | weekly human recalibration → `recalibration_log` → `{ ok }` |
| POST | `trigger-mailer` *(exists)* | calendar row | feeds `/api/ai/pipeline/*` to produce HTML |

### `api/ai/generate.js` — Generation Engine

| Method | Type | Body | Response |
|---|---|---|---|
| POST | `campaign-spec` | `{ slot_id, channel, cohort_id }` | emits a **platform-ready** `campaign_specs.spec` (below) |
| POST | `funnel-spec` | `{ cohort_id }` | full per-cohort funnel: ad + landing + email sequence specs |

**Platform-ready `campaign_specs.spec` schema (Phase-2 plug-in contract):**

```jsonc
{
  "channel": "email|google|meta|tiktok|landing",
  "cohort": "winback_90d",
  "objective": "reactivation",
  "creative": {
    "headline": "string",
    "primary_text": "string",
    "cta": { "label": "string", "url": "string" },
    "variants": [{ "id": "A", "delta": "single changed variable for MVT" }]
  },
  "assets": [{ "kind": "image|html", "ref": "storage://...", "spec": "1080x1080" }],
  "channel_payload": {
    // channel-specific but schema-stable so a Phase-2 pusher maps 1:1:
    "email":  { "subject": "", "preview": "", "html_ref": "storage://..." },
    "google": { "headlines": [], "descriptions": [], "final_url": "" },
    "meta":   { "primary_texts": [], "headlines": [], "media_ref": "" },
    "tiktok": { "video_brief": "", "captions": [], "music_hint": "" }
  },
  "guardrails": { "palette": ["#D0473E","#6A33D8","#111111","#FFFFFF"],
                  "banned_phrases_checked": true },
  "verification_status": "pending"
}
```

> **No live push.** `api/ai/generate.js` only *produces* this object and persists
> it to `campaign_specs`. Pushing to Google/Meta/TikTok/Klaviyo/WebEngage is
> Phase 2; because the payload is already channel-shaped, the pusher is a thin
> adapter with no schema migration.

---

## 8. UI Component Hierarchy

Built into the existing standalone pages (`competitor-benchmarking.html` for CI,
`dashboard.html` / `calendar.html` for the Brain) — same `auth.js` shell,
localStorage state, Supabase REST reads. No component framework; vanilla
self-contained pages, consistent with the rest of the suite.

```
Competitive Intelligence  (competitor-benchmarking.html)
├── Global Filter Bar  (sticky, applies to every view)
│     search · date range · product category · funnel stage · offer type · creative type
├── Brand List / Registry  (500+ brands, priority + category + subscription status)
└── Brand View  (one competitor)
      ├── Source Tiles — clickable, per category
      │     Ads     : [ Meta ] [ Google ] [ TikTok ] [ All ]
      │     Emails  : [ Inbox ] [ MailCharts ] [ Milled ] [ All ]
      │     Landing : [ Direct ] [ Wayback ] [ PageTest ] [ All ]
      ├── Asset Grid   (cards: screenshot, copy, first_seen/last_seen, enrichment tags)
      │     └── Asset Detail Drawer (raw HTML render, version history / diff, linked offers)
      ├── Offers Board (grouped by offer_type; chips: value, code, category, active window)
      └── Funnel Timeline (Ad → Landing → Email → Checkout, with offer progression)

Smart Brain
├── dashboard.html  — Data Analysis (cohorts, threshold breaches, daily analysis)
├── calendar.html   — 15-day rolling plan
│     ├── Slot cards (confidence badge → drives verification prominence)
│     ├── Review queue (human-in-the-loop: approve / edit / reject)
│     ├── MVT panel (running experiments + learnings)
│     └── Weekly Recalibration modal (hard checkpoint)
└── Generation review — campaign_specs preview + verify-before-final gate
```

**Source tiles** read from the namespaced endpoints: each Ads tile hits
`competitor?action=ads-list&source=<meta|google_ats|tiktok>`, "All" drops the
`source` filter; Emails tiles map to `source=<inbox|mailcharts|milled>`; Landing
tiles to `source_kind=<direct|wayback|pagetest>`. The Offers Board hits
`offers-query`; the Funnel Timeline hits `funnel-list`.

**Human-in-the-loop UI:** every `campaign_spec` shows `verification_status` and
must be **approved before final**. Slots/specs with high `confidence` collapse to
a one-click approve; low-confidence ones expand the full edit form — so
**verification load decreases as confidence rises.** The weekly recalibration
modal is a **hard gate** that cannot be skipped past its due date.

---

## 9. Storage Strategy

| Data | Where | Why |
|---|---|---|
| Structured CI + Brain rows | **Supabase Postgres** (`ci_*` + own-data tables) | queryable, RLS, joins, pgvector |
| Screenshots (ads/emails/landing) | **Supabase Storage** bucket `ci-screenshots` | binary, content-addressed |
| Raw email MIME / HTML | **Supabase Storage** bucket `ci-raw-html` | full archive (replaces Sheet col K's 49 KB cap) |
| Landing-page full HTML | **Supabase Storage** bucket `ci-raw-html` | re-renderable source of truth |
| Email attachments | **Supabase Storage** bucket `ci-attachments` | |
| Own catalog/assets | Supabase mirror of backend DB (read-only) | per the §2 read-only contract |

**Content-hash dedup (everywhere):** each blob is keyed by `sha256(bytes)` →
`ci_screenshots.content_hash` is unique, so identical creatives across emails/ads
store the blob once and reference it N times. Text assets dedupe on their
domain-specific `content_hash` (§2). This is what makes 500-brand scale affordable.

**Retention:**
- Live rows: indefinite (the historical record IS the product).
- `ci_asset_versions`: keep all (the diff timeline is the value).
- Raw HTML/MIME blobs: keep 18 months hot, then move cold (Storage lifecycle) —
  the normalized DB row + screenshot remain.
- `ci_jobs`: prune `done` rows after 30 days.

**Legacy Google Sheet → Supabase migration path:**

The current competitor email store is a Google Sheet ("Emails" tab, columns A–K)
plus a "Competitors" tab (A–R), accessed via WIF/JWT in `competitor-core.js`.
Migration is **additive and reversible**:

1. **Backfill:** a one-shot `?action=migrate-sheet` reads `getAllEmails()` /
   `getBrands()` and upserts into `ci_emails` / `brands` (dedupe by the same keys —
   `sender|subject|received` and `domain`), uploading each row's col-K HTML to the
   `ci-raw-html` bucket.
2. **Dual-write window:** `runSync()` / `ingestEmail()` write to **both** Sheet and
   Supabase until parity is verified.
3. **Cutover:** flip reads to Supabase; the Sheet becomes a passive backup.
4. **Retire:** stop Sheet writes; WIF/Google-Sheets auth can be removed once
   confidence is high (keeps the code path until then).

---

## 10. Deployment Plan

**Single Vercel project, function-count discipline.** The app is at 12/12
functions. Everything in this design is delivered WITHOUT adding a function:

- CI capabilities → `?action=` routes on `api/competitor.js` (logic in
  `_shared/competitor-core.js`, which is NOT counted).
- Brain analysis/cohorts → `?action=` routes on `api/kb.js`.
- Calendar review/MVT/feedback/recalibrate → `?action=` routes on `api/calendar.js`
  (logic in `_shared/calendar-*.js`).
- Generation → `type=` on `api/ai/generate.js`.
- Heavy scraping/screenshots → the **external Playwright worker** (`workers/`),
  off-Vercel entirely.

**Cron schedules (add to `vercel.json` `crons`):**

```jsonc
"crons": [
  { "path": "/api/competitor?action=sync",              "schedule": "0 */4 * * *" }, // inbox capture
  { "path": "/api/competitor?action=ads-collect",       "schedule": "0 6 * * *"  }, // enqueue ad fetch
  { "path": "/api/competitor?action=ads-enrich",        "schedule": "30 6 * * *" }, // enrich (free tier)
  { "path": "/api/competitor?action=emails-enrich",     "schedule": "45 6 * * *" },
  { "path": "/api/competitor?action=funnel-reconstruct","schedule": "0 7 * * *"  },
  { "path": "/api/competitor?action=discover",          "schedule": "0 3 * * 1"  }, // weekly brand discovery
  { "path": "/api/kb?action=brain-analyze",             "schedule": "0 8 * * *"  }, // daily analysis
  { "path": "/api/kb?action=cohorts-recompute",         "schedule": "0 2 * * *"  },
  { "path": "/api/calendar?action=review",              "schedule": "0 9 * * *"  }  // daily auto-review
]
```

> Hobby caps cron *invocations/day* — keep schedules coarse (the worker, not cron,
> does the heavy lifting; cron only enqueues/drains light batches).

**Environment variables (Vercel only — never hardcode):** existing —
`OPENAI_API_KEY`(+`_2`/`_3`), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`,
`GROQ_API_KEY`, `CEREBRAS_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`CRON_SECRET`, `INGEST_TOKEN`, `GMAIL_IMAP_USER/PASSWORD`, Google-Sheets WIF
(`GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEET_ID`).
New — `SUPABASE_SERVICE_ROLE_KEY` (router-side privileged writes only, never in
`public-config`), `APIFY_TOKEN` (free Meta ad scraping), `WORKER_PROXY_URL`
(optional proxy pool). Worker-side — only `INGEST_TOKEN`/`CRON_SECRET` + the
app base URL (the worker holds NO Google/Supabase keys).

**Supabase migrations:** one timestamped migration
(`supabase/migrations/2026MMDD_ci_and_brain.sql`) creating all `ci_*` + Brain
tables, `ci_jobs`, the three Storage buckets + RLS; folded into
`supabase/COMBINED_RUN_THIS.sql`.

**Phased rollout:**

1. **Phase 0 (schema):** ship the migration + buckets. No behavior change.
2. **Phase 1 (CI capture):** dual-write emails to Supabase; stand up the worker
   for ads + landing capture; backfill the Sheet. Brand View + source tiles go live.
3. **Phase 2 (enrichment + offers/funnels):** turn on `*-enrich` and
   `funnel-reconstruct` crons; Offers Board + Funnel Timeline go live.
4. **Phase 3 (Brain):** cohorts, daily analysis, 15-day calendar, MVT, weekly
   recalibration. Generation emits `campaign_specs` (verify-before-final).
5. **Phase 4 (out of scope here):** live platform push — a thin adapter over the
   already-platform-ready `campaign_specs`, no schema change.

**Daily / weekly operating loop:**

- **Hourly-ish:** inbox sync captures competitor emails (existing path).
- **Daily:** worker scrapes ads/landing within per-brand budgets → enqueue;
  cron drains normalize/dedup/store/enrich; `funnel-reconstruct` updates timelines;
  `brain-analyze` flags own-data threshold breaches; `calendar?action=review`
  auto-reviews slots and adjusts confidence; generated specs await human approve.
- **Weekly:** brand `discover` expands the registry toward 500+; **hard human
  recalibration** (`recalibration_log`) resets per-cohort confidence and refreshes
  generation guardrails — the non-skippable checkpoint that keeps the autonomous
  loop honest.
```
