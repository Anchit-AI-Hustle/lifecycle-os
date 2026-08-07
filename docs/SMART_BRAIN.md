# KNICKGASM Smart Brain — architecture, schema assumptions & operating loop

The Smart Brain turns Lifecycle OS into a closed-loop marketing system: a DB-linked knowledge base, an always-in-sync analysis engine, an isolated competitor stream, a self-reviewing 15-day calendar, a full-funnel generation engine, a human-in-the-loop review gate, and conversational voice agents. Live platform push (Google/Meta/TikTok/Klaviyo/WebEngage) is deliberately excluded — every generated campaign is stored as a platform-ready object so phase 2 plugs in without refactor.

## Persistent rolling plan (the daily loop)

The brain keeps a durable tentative **15-day calendar** in `smart_calendar_entries`
(one row per date+market, stable id `cal_<date>_<market>`), implemented in
`api/_shared/smart-brain-plan.js` and reviewed daily:

1. **Vercel Cron** (03:30 UTC, `vercel.json` → `/api/cron/smart-brain` →
   `/api/calendar?action=smart-brain-cron`, protected by `CRON_SECRET`) calls
   `syncDaily()`.
2. `syncDaily()` re-runs KB → Analysis → Competitor Benchmarking on the latest
   data, regenerates the window, then **diff-updates** the stored plan:
   - `approved`/`final` entries are never touched (human decisions are locked),
   - `tentative` entries are updated only on material change (cohort, hero
     product, objective, channels, confidence ±5pts) with a `change_log` entry,
   - `rejected` entries are re-planned,
   - new days are appended so the window stays 15 days ahead; past tentative
     days are `archived`.
3. The **Smart Brain console** (`/brain` → `smart-brain.html`) shows the plan,
   the change feed, and per-entry **Approve / Reject** buttons.
4. **Approve** generates the full funnel for that slot — LLM-written copy via
   the 6-provider waterfall (template fallback) for the mailer, Meta/Google/
   TikTok ads, and a landing page — persisted to `smart_generated_campaigns`,
   mirrored into `ads_generated` + `landing_pages_generated` (so the Ads and
   Landing Pages dashboards list them), and the landing page is served at
   **`/lp/<campaign_id>`**.
5. **Reject** stores feedback in `smart_feedback`; the slot regenerates on the
   next daily sync with feedback applied.

### Plan API

```http
GET  /api/calendar?action=smart-brain-plan          # current rolling plan
POST /api/calendar?action=smart-brain-sync-daily    # manual daily review  { "days": 15 }
GET  /api/calendar?action=smart-brain-cron          # cron entrypoint (Bearer CRON_SECRET)
POST /api/calendar?action=smart-brain-approve       # { "id": "cal_2026-06-12_us", "reviewer": "..." }
POST /api/calendar?action=smart-brain-reject        # { "id": "...", "notes": "...", "reviewer": "..." }
GET  /lp/:campaignId                                # hosted generated landing page
```

Without Supabase env vars everything still runs statelessly against local CSV
samples (plan preview + inline-entry approval), so the MVP stays demonstrable.

## Service boundaries

UI: `/brain` (Smart Brain console), `/agent` (voice/chat agents), `agent-widget.js` (Shopify embed). API: `/api/brain?action=…` (single Vercel function; all logic in `api/_shared/brain-*.js`). DB: the provided linked DB pinned in `data/linked-db.json` (Supabase project `fswdwmkgggzyxrdzabnh`, all tables prefixed `smart_`). Override with `SMART_BRAIN_SUPABASE_URL` / `SMART_BRAIN_SUPABASE_KEY` env vars when relinking to the real production-fed DB.

## Module map (clean contracts)

`brain-core.js` — linked-DB adapter, config (DB-driven via `smart_brain_config`), brand kit, banned-phrase scrubber. `brain-kb.js` — Module 1: catalog + assets + campaign library joined to creative-level metrics; `patterns()` aggregates what worked by angle/hook/archetype/format/channel. `brain-analysis.js` — Module 2: daily scoring of every campaign against per-channel thresholds, percentiles, pass/fail with reasons (`smart_library_scores`); personalized cohorts from user-level data (`smart_cohorts`); `filteredLibrary()` exposes ONLY threshold-passing campaigns. `brain-competitor.js` — Module 3: reads ONLY `smart_competitor_*`; outputs advisory signals (angle frequency, promo share, cadence); never enters own-data scoring. `brain-calendar.js` — Module 4: festival auto-extraction from `smart_sales_history` (trailing-baseline spike detection, evidence stored), 15-day rolling multi-channel calendar (mailers + Google/Meta/TikTok + landing pages for both + retargeting follow-ups), daily automated review (applies human feedback, swaps weak angles, extends horizon, folds MVT learnings into `learned_weights`). `brain-generate.js` — Module 5: per approved slot → brand-compliant HTML mailer, RSA/Meta/TikTok copy + creative briefs, conversion-optimized landing pages, audience + retargeting + lookalike specs, full funnel (creative → landing → mailer follow-up), platform-ready campaign objects (`smart_generated_campaigns`). LLM copy via the 6-provider cascade with a deterministic brand-safe fallback. `brain-review.js` — Module 6: review queue, per-channel confidence (Beta-mean), auto-approve sweep gated by confidence AND a hard weekly-recalibration freshness check. `brain-agent.js` — voice/chat agents at brand/collection/product/persona level with catalog-scoped knowledge, official-site scraping, honest objection handling (price → per-pair math; efficacy → 2–4 week expectations), transcripts persisted.

## Schema assumptions (the "provided linked DB" contract)

Own data: `smart_products` (sku, market, title, category, price, url, tags), `smart_assets` (brand kit incl. palette/typography/banned phrases), `smart_campaigns` (channel email|google|meta|tiktok|landing_page; theme/hook/angle/format/archetype/festival/audience), `smart_campaign_assets` (creative-level: subject/headline/body/html per creative_id), `smart_campaign_metrics` (per campaign AND per creative: sends, impressions, opens, clicks, conversions, revenue, spend), `smart_users` (RFM segment, orders, spend, categories, engagement flags), `smart_orders`, `smart_events`, `smart_sales_history` (daily revenue/orders per market — festival extraction source). Competitor (isolated): `smart_competitor_campaigns`, `smart_competitor_signals`. Brain state: `smart_brain_config`, `smart_brain_runs`, `smart_cohorts`, `smart_library_scores`, `smart_festivals`, `smart_calendar`, `smart_calendar_reviews`, `smart_feedback`, `smart_mvt_results`, `smart_funnels`, `smart_generated_campaigns`, `smart_generated_assets`, `smart_review_queue`, `smart_confidence`, `smart_recalibrations`, `smart_agents` + knowledge/sessions/messages. Migrations live in `supabase/migrations/` and were applied to the linked project; synthetic 24-month seed data (600 users, ~4.5k orders, 96 campaigns, 192 creatives, competitor stream) makes every module runnable today and is replaced by real data without code changes.

When the real DB arrives: keep the table names (or map them in one place — `brain-core.js`), load real rows, delete seeds. Nothing else changes.

## Security posture (current, deliberate)

The linked DB uses the public anon key committed in `data/linked-db.json` with permissive RLS — acceptable for an internal tool on synthetic data, NOT for production data. Hardening (15 minutes): set `SUPABASE_SERVICE_ROLE_KEY` (or `SMART_BRAIN_SUPABASE_KEY`) in Vercel env, then replace the `allow_all` policies with authenticated-only ones.

## The operating loop

**Daily (automated, no humans — Vercel cron 03:30 UTC → `/api/brain?action=cron`):** 1) re-extract festivals/peaks from latest sales history; 2) daily calendar review — full re-analysis of the linked DB, apply pending human feedback, swap angles that fell out of the top set, extend the 15-day horizon, fold MVT results into learned weights (the calendar is never followed blindly); 3) refresh competitor benchmark signals (isolated); 4) auto-approve sweep (only if launch_mode=false, confidence ≥0.85 with ≥20 samples, AND weekly recalibration is fresh); 5) auto-generate complete asset sets for approved slots due within 3 days — every one lands in the review queue. Each run is logged in `smart_brain_runs` and `smart_calendar_reviews`.

**Weekly (human, hard-gated):** open `/brain` → Review Queue → "Record weekly recalibration" with your name and decisions (threshold changes, cohort edits, calendar direction). If skipped past 7 days, the UI banners OVERDUE and ALL auto-approval is hard-blocked until a human recalibrates. Launch state: `review_policy.launch_mode=true` means every campaign requires human verification regardless of confidence; flip it via Config (POST `/api/brain?action=config`) once trust is earned. Confidence grows with approvals per channel, so verification load decreases gradually — the weekly human gate never goes away.

**Operator day-to-day:** `/brain` → Console to interrogate the system in plain language; Calendar tab to approve/reject/✎-feedback slots (feedback is applied at the next daily review and shapes future generation); Assets tab to preview mailers/landing pages and inspect platform-ready objects; Agents tab to manage voice agents and grab the Shopify embed snippet.

## Voice agents (the telecalling substitute)

Telecalling held ROAS 3.5–4 because explaining value conversationally beats text. The agents reproduce that mode at zero marginal cost: brand-level "Knickgasm", collection-level experts (coffee-ART, anime, football, wedding), base-model guides (Air Force 1, Jordan Lows, Court Vision) — each scoped to its slice of the catalog, each honest about price (what a hand-painted one-of-one on an original base actually costs) and about the 10 to 15 day made-to-order build. Voice in/out runs in-browser (Web Speech API) with optional ElevenLabs premium voice via `ELEVENLABS_API_KEY`. Generated mailers and landing pages carry a "Talk to the Knickgasm expert" CTA that deep-links to `/agent`. Shopify embed: one script tag per theme/collection/product template (`agent-widget.js`, `data-agent=`).

## Phase 2 (excluded by design)

Adapters consume `smart_generated_campaigns.campaign_object` (already shaped for Klaviyo / Google Ads / Meta / TikTok) and push via each platform's API; status moves final → pushed → live, and `smart_campaign_metrics` starts receiving real performance — closing the loop the MVT system already expects.
