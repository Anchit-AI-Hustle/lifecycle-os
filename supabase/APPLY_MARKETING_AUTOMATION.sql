-- ═══════════════════════════════════════════════════════════════════════════
-- KNICKGASM Marketing Automation — APPLY-ALL schema bundle
-- Smart Brain (own-data) + Competitive Intelligence (ci_*) + rolling calendar.
-- Idempotent (all CREATE TABLE IF NOT EXISTS) — safe to run on a DB that
-- already has the base Mailer-Studio schema. Paste into Supabase → SQL Editor.
-- Generated from supabase/migrations/{20260609_smart_brain.sql, 20260610_smart_calendar_plan.sql, 20260617_competitive_intel_and_brain.sql}.
-- ═══════════════════════════════════════════════════════════════════════════


-- ┌───────────────────────────────────────────────────────────────────────────
-- │ 20260609_smart_brain.sql
-- └───────────────────────────────────────────────────────────────────────────
-- KNICKGASM Smart Brain schema assumptions for the linked database.
-- These tables are intentionally namespaced with smart_* so the MVP can link
-- to a provided analytical database without touching production platform data.

create table if not exists public.smart_products (
  id text primary key,
  sku text,
  title text not null,
  handle text,
  category text,
  market text,
  price numeric,
  tags jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.smart_assets (
  id text primary key,
  asset_type text not null,
  format text,
  url text,
  title text,
  hook text,
  alt text,
  tags jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.smart_campaigns (
  id text primary key,
  name text not null,
  channel text not null,
  market text,
  campaign_type text,
  subject text,
  headline text,
  hook text,
  sent_at timestamptz,
  cohort_key text,
  hero_sku text,
  metadata jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.smart_campaign_assets (
  campaign_id text not null,
  asset_id text not null,
  role text,
  metadata jsonb default '{}'::jsonb,
  primary key (campaign_id, asset_id)
);

create table if not exists public.smart_campaign_metrics (
  id bigserial primary key,
  campaign_id text not null,
  creative_id text,
  channel text not null,
  market text,
  sends numeric default 0,
  impressions numeric default 0,
  opens numeric default 0,
  clicks numeric default 0,
  conversions numeric default 0,
  revenue numeric default 0,
  spend numeric default 0,
  observed_at timestamptz default now(),
  cohort_key text,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.smart_users (
  id text primary key,
  email text,
  market text,
  total_spend numeric default 0,
  orders_count integer default 0,
  last_order_at timestamptz,
  accepts_marketing boolean default true,
  tags jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.smart_orders (
  id text primary key,
  user_id text,
  market text,
  total numeric default 0,
  created_at timestamptz,
  product_sku text,
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.smart_events (
  id bigserial primary key,
  user_id text,
  event_type text not null,
  campaign_id text,
  creative_id text,
  occurred_at timestamptz default now(),
  properties jsonb default '{}'::jsonb
);

-- Competitive stream is explicitly separate from own-data campaign tables.
create table if not exists public.smart_competitor_campaigns (
  id text primary key,
  brand text not null,
  channel text not null,
  campaign_type text,
  asset_type text,
  format text,
  subject text,
  headline text,
  hook text,
  asset_url text,
  landing_url text,
  observed_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.smart_mvt_results (
  id bigserial primary key,
  campaign_id text,
  variable text,
  winner text,
  lift numeric,
  confidence numeric,
  observed_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.smart_feedback (
  id bigserial primary key,
  target_type text not null,
  target_id text,
  verdict text not null,
  notes text,
  reviewer text,
  created_at timestamptz default now(),
  metadata jsonb default '{}'::jsonb
);

create table if not exists public.smart_generated_campaigns (
  id text primary key,
  payload jsonb not null,
  status text not null default 'needs_human_verification',
  human_verified_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.smart_brain_runs (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now()
);

create index if not exists smart_campaign_metrics_campaign_idx on public.smart_campaign_metrics (campaign_id, observed_at desc);
create index if not exists smart_competitor_campaigns_channel_idx on public.smart_competitor_campaigns (channel, observed_at desc);
create index if not exists smart_feedback_target_idx on public.smart_feedback (target_type, target_id, created_at desc);

-- ┌───────────────────────────────────────────────────────────────────────────
-- │ 20260610_smart_calendar_plan.sql
-- └───────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Brain persistent rolling calendar.
--
-- The daily Smart Brain loop needs a durable tentative plan it can REVIEW and
-- UPDATE every day (instead of regenerating from scratch), while preserving
-- entries a human has already approved/finalised. One row per date+market.
--
-- status lifecycle:
--   tentative → (human) approved → final          (approved + assets generated)
--   tentative → (human) rejected → tentative      (regenerated on next sync)
--   any past date → archived                      (rolled out of the window)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.smart_calendar_entries (
  id            TEXT PRIMARY KEY,              -- cal_<date>_<market>, stable across syncs
  date          DATE NOT NULL,
  market        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'tentative',  -- tentative|approved|rejected|final|archived
  confidence    NUMERIC,
  payload       JSONB NOT NULL,                -- full calendar-entry object from CalendarIntelligenceService
  change_log    JSONB DEFAULT '[]'::jsonb,     -- [{at, kind, detail}] appended by each daily sync / review action
  generated_campaign_id TEXT,                  -- set when approval generates assets
  approved_by   TEXT,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS smart_cal_date_market_idx ON public.smart_calendar_entries (date, market);
CREATE INDEX IF NOT EXISTS smart_cal_status_idx ON public.smart_calendar_entries (status, date);

ALTER TABLE public.smart_calendar_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "smart_cal_read"  ON public.smart_calendar_entries;
DROP POLICY IF EXISTS "smart_cal_write" ON public.smart_calendar_entries;
DROP POLICY IF EXISTS "smart_cal_upd"   ON public.smart_calendar_entries;
CREATE POLICY "smart_cal_read"  ON public.smart_calendar_entries FOR SELECT USING (true);
CREATE POLICY "smart_cal_write" ON public.smart_calendar_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "smart_cal_upd"   ON public.smart_calendar_entries FOR UPDATE USING (true) WITH CHECK (true);

-- ┌───────────────────────────────────────────────────────────────────────────
-- │ 20260617_competitive_intel_and_brain.sql
-- └───────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════
-- COMPETITIVE INTELLIGENCE COLLECTION  +  SMART BRAIN
--
-- Two logically-separate layers in one schema, deliberately namespaced so the
-- competitor real-time stream NEVER mixes with own-data campaign-library logic
-- (see CLAUDE.md "Competitive data is fetched via direct real-time stream").
--
--   ci_*   → Competitive Intelligence (competitor capture; the real-time stream)
--   kb_*   → Knowledge Base of OWN catalog + historical campaign library
--   (brain) cohorts / performance_metrics / calendar_slots / campaign_specs /
--           calendar_feedback / mvt_experiments / recalibration_log
--
-- Posture: anon read + service-role/anon write (same as the rest of the suite —
-- the anon key is public and this is non-sensitive marketing intelligence). All
-- heavy uniqueness is enforced with content hashes so the collectors can be
-- re-run idempotently and dedup happens at the DB layer.
-- ═══════════════════════════════════════════════════════════════════════════

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 1 — COMPETITIVE INTELLIGENCE (the real-time competitor stream)        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ── brands ──────────────────────────────────────────────────────────────────
-- The list of competitor brands we monitor. The legacy store is a Google Sheet
-- tab ("Competitors"); this table is the Supabase home so the brain + UI can
-- join against it. Sync is one-way (Sheet → here) until the Sheet is retired.
CREATE TABLE IF NOT EXISTS public.brands (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  name          TEXT NOT NULL,
  slug          TEXT,                       -- normalized key (lowercased, hyphenated)
  domain        TEXT,                       -- primary domain, normalized (no www/scheme)
  category      TEXT,                       -- sneaker | coffee | supplements | streetwear | dtc
  region        TEXT,                       -- US | UK | IN | EU | AU | GLOBAL
  inbox_address TEXT,                       -- dedicated inbox subscribed for this brand
  meta_page_id  TEXT,                       -- Meta Ad Library advertiser/page id
  google_advertiser_id TEXT,               -- Google Ads Transparency advertiser id
  tiktok_handle TEXT,
  is_own        BOOLEAN DEFAULT false,      -- true = KNICKGASM itself (excluded from competitor views)
  active        BOOLEAN DEFAULT true,
  meta          JSONB DEFAULT '{}'::jsonb
);
-- Non-partial so it can serve as the ON CONFLICT (slug) arbiter for upserts
-- (resolveBrand). NULL slugs remain allowed/duplicable — Postgres treats NULLs
-- as distinct in a unique index.
DROP INDEX IF EXISTS public.brands_slug_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS brands_slug_uidx ON public.brands (slug);
CREATE INDEX IF NOT EXISTS brands_category_idx ON public.brands (category);
CREATE INDEX IF NOT EXISTS brands_region_idx   ON public.brands (region);

-- ── ci_ads ──────────────────────────────────────────────────────────────────
-- One row per distinct competitor ad CREATIVE VERSION. Dedup key = content_hash
-- (source + ad_id + a hash of the creative payload). When the creative changes
-- but the ad_id stays, a NEW row is written and the prior row is snapshotted
-- into ci_asset_versions, giving us creative-change tracking + version history.
CREATE TABLE IF NOT EXISTS public.ci_ads (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT now(),
  brand_id        BIGINT REFERENCES public.brands(id) ON DELETE CASCADE,
  brand_name      TEXT,                     -- denormalized for fast UI
  source          TEXT NOT NULL,            -- meta | google | tiktok
  ad_id           TEXT,                     -- platform ad / creative id
  content_hash    TEXT NOT NULL,            -- dedup key (see above)
  first_seen      TIMESTAMPTZ DEFAULT now(),
  last_seen       TIMESTAMPTZ DEFAULT now(),
  active          BOOLEAN DEFAULT true,     -- still live in the source library
  creative_type   TEXT,                     -- image | video | carousel | text
  image_urls      JSONB DEFAULT '[]'::jsonb,
  video_urls      JSONB DEFAULT '[]'::jsonb,
  primary_copy    TEXT,
  headline        TEXT,
  description     TEXT,
  cta             TEXT,
  landing_url     TEXT,
  landing_page_id BIGINT,                    -- FK→ci_landing_pages (set on funnel link)
  screenshot_id   BIGINT,                    -- FK→ci_screenshots
  source_link     TEXT,                      -- deep link back to the ad in its library
  raw_html        TEXT,
  raw_json        JSONB,
  enrichment      JSONB DEFAULT '{}'::jsonb, -- AI enrichment (see ci-enrich.js)
  enriched_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ci_ads_hash_uidx ON public.ci_ads (content_hash);
CREATE INDEX IF NOT EXISTS ci_ads_brand_idx  ON public.ci_ads (brand_id);
CREATE INDEX IF NOT EXISTS ci_ads_source_idx ON public.ci_ads (source);
CREATE INDEX IF NOT EXISTS ci_ads_seen_idx   ON public.ci_ads (last_seen DESC);
CREATE INDEX IF NOT EXISTS ci_ads_adid_idx   ON public.ci_ads (source, ad_id);

-- ── ci_emails ───────────────────────────────────────────────────────────────
-- Competitor emails captured from dedicated inboxes or aggregators (MailCharts/
-- Milled/Owletter). Supersedes the Google-Sheet store; old rows migrate here.
CREATE TABLE IF NOT EXISTS public.ci_emails (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT now(),
  brand_id      BIGINT REFERENCES public.brands(id) ON DELETE SET NULL,
  brand_name    TEXT,
  source        TEXT NOT NULL,              -- inbox | mailcharts | milled | owletter
  content_hash  TEXT NOT NULL,             -- sha1(sender+subject+send_date) dedup
  subject       TEXT,
  preheader     TEXT,
  sender        TEXT,
  send_date     TIMESTAMPTZ,
  html          TEXT,
  plain_text    TEXT,
  images        JSONB DEFAULT '[]'::jsonb,
  ctas          JSONB DEFAULT '[]'::jsonb,  -- captured but links are NEVER auto-clicked
  promotions    JSONB DEFAULT '[]'::jsonb,  -- promo codes / offer phrases extracted
  raw_mime      TEXT,                       -- full RFC822 message
  attachments   JSONB DEFAULT '[]'::jsonb,
  screenshot_id BIGINT,
  source_link   TEXT,
  enrichment    JSONB DEFAULT '{}'::jsonb,
  enriched_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ci_emails_hash_uidx ON public.ci_emails (content_hash);
CREATE INDEX IF NOT EXISTS ci_emails_brand_idx ON public.ci_emails (brand_id);
CREATE INDEX IF NOT EXISTS ci_emails_date_idx  ON public.ci_emails (send_date DESC);
CREATE INDEX IF NOT EXISTS ci_emails_source_idx ON public.ci_emails (source);

-- ── ci_landing_pages ────────────────────────────────────────────────────────
-- Landing pages discovered from ads/emails, plus Wayback / pagetest captures.
-- Dedup key = url_hash + content_hash; a content change writes a new version.
CREATE TABLE IF NOT EXISTS public.ci_landing_pages (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ DEFAULT now(),
  brand_id       BIGINT REFERENCES public.brands(id) ON DELETE SET NULL,
  brand_name     TEXT,
  source         TEXT NOT NULL,             -- direct | wayback | pagetest
  url            TEXT NOT NULL,
  url_hash       TEXT NOT NULL,             -- sha1(canonical url)
  content_hash   TEXT NOT NULL,             -- sha1(parsed core content)
  captured_at    TIMESTAMPTZ DEFAULT now(),
  raw_html       TEXT,
  dom_snapshot   TEXT,
  parsed         JSONB DEFAULT '{}'::jsonb, -- {pricing,bundles,subscription,reviews,faq,trust,checkout_links}
  desktop_shot_id BIGINT,
  mobile_shot_id  BIGINT,
  source_link    TEXT,
  enrichment     JSONB DEFAULT '{}'::jsonb, -- AI: primary_promise, core_offer, CRO analysis...
  enriched_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ci_lp_hash_uidx ON public.ci_landing_pages (url_hash, content_hash);
CREATE INDEX IF NOT EXISTS ci_lp_brand_idx ON public.ci_landing_pages (brand_id);
CREATE INDEX IF NOT EXISTS ci_lp_url_idx   ON public.ci_landing_pages (url_hash);
CREATE INDEX IF NOT EXISTS ci_lp_cap_idx   ON public.ci_landing_pages (captured_at DESC);

-- ── ci_offers ───────────────────────────────────────────────────────────────
-- First-class OFFER object — the highest-value layer. Every offer detected in
-- any asset (ad/email/landing) becomes a row so the team can run queries like
-- "every competitor running a free-gift offer on coffee in the US in last 30d".
CREATE TABLE IF NOT EXISTS public.ci_offers (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT now(),
  brand_id      BIGINT REFERENCES public.brands(id) ON DELETE CASCADE,
  brand_name    TEXT,
  offer_type    TEXT NOT NULL,             -- percent_off|amount_off|bundle|free_gift|subscription|bogo|free_shipping|other
  offer_value   NUMERIC,                   -- e.g. 10 for "10% off" / 25 for "$25 off"
  offer_unit    TEXT,                      -- percent | currency | qty
  product_category TEXT,                   -- sneaker | coffee | supplements | streetwear | dtc
  region        TEXT,
  promo_code    TEXT,
  raw_text      TEXT,                      -- the offer phrase as captured
  asset_type    TEXT NOT NULL,             -- ad | email | landing
  asset_id      BIGINT NOT NULL,           -- FK→ci_ads|ci_emails|ci_landing_pages (by asset_type)
  source        TEXT,                      -- meta|google|tiktok|inbox|milled|... (asset origin)
  first_seen    TIMESTAMPTZ DEFAULT now(),
  last_seen     TIMESTAMPTZ DEFAULT now(),
  content_hash  TEXT NOT NULL,             -- dedup: brand+offer_type+value+asset
  meta          JSONB DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS ci_offers_hash_uidx ON public.ci_offers (content_hash);
CREATE INDEX IF NOT EXISTS ci_offers_brand_idx ON public.ci_offers (brand_id);
CREATE INDEX IF NOT EXISTS ci_offers_type_idx  ON public.ci_offers (offer_type);
CREATE INDEX IF NOT EXISTS ci_offers_cat_idx   ON public.ci_offers (product_category);
CREATE INDEX IF NOT EXISTS ci_offers_region_idx ON public.ci_offers (region);
CREATE INDEX IF NOT EXISTS ci_offers_seen_idx  ON public.ci_offers (last_seen DESC);

-- ── ci_funnels ──────────────────────────────────────────────────────────────
-- Reconstructed funnels: ordered timeline of events connecting an ad → landing
-- page → email → offer/checkout for a brand. Events stored as a JSONB array so
-- the timeline UI can render directly. One funnel per (brand, funnel_key).
CREATE TABLE IF NOT EXISTS public.ci_funnels (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  brand_id     BIGINT REFERENCES public.brands(id) ON DELETE CASCADE,
  brand_name   TEXT,
  funnel_key   TEXT NOT NULL,             -- stable key (e.g. landing url_hash or campaign cluster)
  product_category TEXT,
  region       TEXT,
  started_at   TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  events       JSONB DEFAULT '[]'::jsonb, -- [{date,stage,asset_type,asset_id,label,offer_type}]
  summary      JSONB DEFAULT '{}'::jsonb  -- AI summary of the funnel strategy
);
CREATE UNIQUE INDEX IF NOT EXISTS ci_funnels_key_uidx ON public.ci_funnels (brand_id, funnel_key);
CREATE INDEX IF NOT EXISTS ci_funnels_brand_idx ON public.ci_funnels (brand_id);

-- ── ci_screenshots ──────────────────────────────────────────────────────────
-- Pointer rows for rendered screenshots / raw captures held in Supabase Storage
-- (bucket "ci-captures"). Keeps large binaries out of the row store; content
-- hash dedups identical renders.
CREATE TABLE IF NOT EXISTS public.ci_screenshots (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  asset_type   TEXT,                       -- ad | email | landing
  asset_id     BIGINT,
  variant      TEXT,                       -- desktop | mobile | full | thumb
  storage_path TEXT,                       -- path in the ci-captures bucket
  public_url   TEXT,
  content_hash TEXT,
  width        INT,
  height       INT
);
CREATE INDEX IF NOT EXISTS ci_shots_asset_idx ON public.ci_screenshots (asset_type, asset_id);
CREATE UNIQUE INDEX IF NOT EXISTS ci_shots_hash_uidx ON public.ci_screenshots (content_hash) WHERE content_hash IS NOT NULL;

-- ── ci_asset_versions ───────────────────────────────────────────────────────
-- Append-only version history. Whenever a tracked asset (ad/email/landing)
-- changes, the PRIOR snapshot is written here with a structured diff so the UI
-- can show "headline changed / price changed / offer changed / CTA changed".
CREATE TABLE IF NOT EXISTS public.ci_asset_versions (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  asset_type   TEXT NOT NULL,             -- ad | email | landing
  asset_id     BIGINT NOT NULL,           -- current row id the version belongs to
  version_no   INT NOT NULL,
  content_hash TEXT,
  snapshot     JSONB,                     -- the prior full record
  diff         JSONB,                     -- {headline:{from,to}, price:{from,to}, offer:{...}, cta:{...}}
  changed_fields TEXT[]
);
CREATE INDEX IF NOT EXISTS ci_ver_asset_idx ON public.ci_asset_versions (asset_type, asset_id, version_no DESC);

-- ── ci_creative_tags ────────────────────────────────────────────────────────
-- Normalized tag layer for fast faceting/filtering across all asset types
-- (funnel_stage, awareness_stage, offer_type, creative_type, hook, persona,
-- emotional_trigger, …). Filled from enrichment; one row per (asset, tag).
CREATE TABLE IF NOT EXISTS public.ci_creative_tags (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT now(),
  asset_type  TEXT NOT NULL,
  asset_id    BIGINT NOT NULL,
  brand_id    BIGINT,
  tag_type    TEXT NOT NULL,              -- funnel_stage|awareness|offer_type|creative_type|hook|persona|emotion|...
  tag_value   TEXT NOT NULL,
  confidence  NUMERIC
);
CREATE UNIQUE INDEX IF NOT EXISTS ci_tags_uidx ON public.ci_creative_tags (asset_type, asset_id, tag_type, tag_value);
CREATE INDEX IF NOT EXISTS ci_tags_facet_idx ON public.ci_creative_tags (tag_type, tag_value);
CREATE INDEX IF NOT EXISTS ci_tags_brand_idx ON public.ci_creative_tags (brand_id);

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 2 — SMART BRAIN (own data; DB-linked KB + analysis + calendar)        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ── kb_campaigns ────────────────────────────────────────────────────────────
-- The OWN historical campaign library, indexed from the linked backend DB.
-- Every past campaign with its linked assets + performance so the brain knows
-- which hooks/graphics/angles/formats worked. This is own-data ONLY — never
-- mixed with ci_* competitor rows.
CREATE TABLE IF NOT EXISTS public.kb_campaigns (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT now(),
  source_db_id  TEXT,                      -- id in the linked backend DB (idempotent upsert key)
  name          TEXT,
  channel       TEXT,                      -- email | google | meta | tiktok | landing
  campaign_type TEXT,                      -- acquisition | retention | winback | launch | festival ...
  market        TEXT,
  launched_at   TIMESTAMPTZ,
  product_focus TEXT[],
  cohort_key    TEXT,                      -- which cohort it targeted (→ cohorts.cohort_key)
  assets        JSONB DEFAULT '[]'::jsonb, -- [{type,url,creative_id,format,hook,angle}]
  metrics       JSONB DEFAULT '{}'::jsonb, -- channel/campaign/creative-level KPIs from the DB
  performance_score NUMERIC,              -- normalized 0-100 composite (set by analysis engine)
  cleared_threshold BOOLEAN DEFAULT false, -- passed performance filter → eligible to inspire new work
  tags          TEXT[],
  embedding_ref TEXT,                      -- pointer to vector store (future semantic search)
  indexed_at    TIMESTAMPTZ DEFAULT now()
);
-- Non-partial so it can serve as the ON CONFLICT (source_db_id) arbiter used by
-- /api/kb?action=index-campaigns. NULL source_db_id stays duplicable.
DROP INDEX IF EXISTS public.kb_campaigns_src_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS kb_campaigns_src_uidx ON public.kb_campaigns (source_db_id);
CREATE INDEX IF NOT EXISTS kb_campaigns_channel_idx ON public.kb_campaigns (channel);
CREATE INDEX IF NOT EXISTS kb_campaigns_score_idx   ON public.kb_campaigns (performance_score DESC);
CREATE INDEX IF NOT EXISTS kb_campaigns_cleared_idx ON public.kb_campaigns (cleared_threshold);

-- ── cohorts ─────────────────────────────────────────────────────────────────
-- Personalized cohorts built from user-level data in the linked DB.
CREATE TABLE IF NOT EXISTS public.cohorts (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  cohort_key   TEXT NOT NULL,             -- stable slug
  name         TEXT,
  market       TEXT,
  definition   JSONB DEFAULT '{}'::jsonb, -- rule set (RFM bucket, lifecycle stage, product affinity...)
  size         INT,                       -- last computed membership count
  rfm          JSONB,                     -- recency/frequency/monetary summary
  lifecycle_stage TEXT,                   -- new | active | at_risk | lapsed | vip
  computed_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS cohorts_key_uidx ON public.cohorts (cohort_key);

-- ── performance_metrics ─────────────────────────────────────────────────────
-- Daily-analysis snapshots kept in-sync with the linked DB. One row per
-- (entity, grain, date) so the engine can compute trends + thresholds.
CREATE TABLE IF NOT EXISTS public.performance_metrics (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  grain        TEXT NOT NULL,             -- channel | campaign | creative | cohort
  entity_id    TEXT NOT NULL,            -- id within the grain
  entity_label TEXT,
  metric_date  DATE NOT NULL,
  metrics      JSONB DEFAULT '{}'::jsonb, -- {impr, clicks, ctr, opens, orders, revenue, roas, cac, ...}
  source_synced_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS perf_uidx ON public.performance_metrics (grain, entity_id, metric_date);
CREATE INDEX IF NOT EXISTS perf_date_idx ON public.performance_metrics (metric_date DESC);

-- ── calendar_slots ──────────────────────────────────────────────────────────
-- The 15-day rolling calendar. One row per planned slot (a mailer / ad / LP for
-- a given day+channel+cohort). Re-generated/re-scored by the daily review loop.
CREATE TABLE IF NOT EXISTS public.calendar_slots (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  slot_date     DATE NOT NULL,
  channel       TEXT NOT NULL,            -- email | google | meta | tiktok | landing
  asset_kind    TEXT NOT NULL,           -- mailer | ad | landing_page
  cohort_key    TEXT,
  market        TEXT,
  theme         TEXT,                     -- festival / seasonal / evergreen hook
  rationale     JSONB DEFAULT '{}'::jsonb,-- why this slot (data + benchmark signals)
  priority      NUMERIC,                  -- ranking score from analysis
  status        TEXT DEFAULT 'tentative', -- tentative | reviewed | approved | generated | verified | final | rejected
  generation_ref BIGINT,                  -- → campaign_specs.id once generated
  revision      INT DEFAULT 1,
  last_reviewed_at TIMESTAMPTZ,
  source        TEXT DEFAULT 'auto'       -- auto | human
);
CREATE INDEX IF NOT EXISTS cal_date_idx   ON public.calendar_slots (slot_date);
CREATE INDEX IF NOT EXISTS cal_status_idx ON public.calendar_slots (status);
CREATE INDEX IF NOT EXISTS cal_channel_idx ON public.calendar_slots (channel);

-- ── campaign_specs ──────────────────────────────────────────────────────────
-- The Generation Engine output: a PLATFORM-READY campaign object per slot. The
-- schema is designed so the phase-2 live-push adapters (Google/Meta/TikTok/
-- Klaviyo/WebEngage) can consume `platform_payload` without a refactor.
CREATE TABLE IF NOT EXISTS public.campaign_specs (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  slot_id       BIGINT REFERENCES public.calendar_slots(id) ON DELETE SET NULL,
  cohort_key    TEXT,
  channel       TEXT,
  market        TEXT,
  funnel        JSONB DEFAULT '{}'::jsonb, -- {creative, landing_page, mailer_followup, retargeting, lookalike}
  assets        JSONB DEFAULT '{}'::jsonb, -- generated HTML mailer / ad copy+creative / LP html
  audience      JSONB DEFAULT '{}'::jsonb, -- audience definitions + retargeting/similar logic (no live push)
  platform_payload JSONB DEFAULT '{}'::jsonb, -- normalized per-platform object for phase-2 adapters
  verification  JSONB DEFAULT '{}'::jsonb, -- HITL state {required, verified_by, verified_at, confidence}
  status        TEXT DEFAULT 'draft',      -- draft | needs_review | verified | final
  confidence    NUMERIC DEFAULT 0          -- drives how much human verification is required
);
CREATE INDEX IF NOT EXISTS specs_slot_idx   ON public.campaign_specs (slot_id);
CREATE INDEX IF NOT EXISTS specs_status_idx ON public.campaign_specs (status);

-- ── calendar_feedback ───────────────────────────────────────────────────────
-- Human feedback on calendar entries, applied to FUTURE generation.
CREATE TABLE IF NOT EXISTS public.calendar_feedback (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ DEFAULT now(),
  slot_id     BIGINT REFERENCES public.calendar_slots(id) ON DELETE CASCADE,
  user_email  TEXT,
  verdict     TEXT,                       -- approve | reject | edit
  rating      INT,                        -- 1-5
  notes       TEXT,
  patch       JSONB DEFAULT '{}'::jsonb,  -- structured edits the human made
  applied     BOOLEAN DEFAULT false       -- folded into the next generation cycle yet?
);
CREATE INDEX IF NOT EXISTS fb_slot_idx ON public.calendar_feedback (slot_id);
CREATE INDEX IF NOT EXISTS fb_applied_idx ON public.calendar_feedback (applied);

-- ── mvt_experiments ─────────────────────────────────────────────────────────
-- Multivariate testing loop. Tracks variants + results that feed back into
-- calendar/creative decisions automatically.
CREATE TABLE IF NOT EXISTS public.mvt_experiments (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  name         TEXT,
  hypothesis   TEXT,
  channel      TEXT,
  cohort_key   TEXT,
  factors      JSONB DEFAULT '{}'::jsonb, -- {hook:[...], offer:[...], creative:[...]}
  variants     JSONB DEFAULT '[]'::jsonb, -- [{variant_id, factor_levels, spec_ref}]
  status       TEXT DEFAULT 'running',     -- running | concluded
  results      JSONB DEFAULT '{}'::jsonb,  -- per-variant metrics
  winner       JSONB,                      -- {variant_id, lift, significance}
  concluded_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mvt_status_idx ON public.mvt_experiments (status);

-- ── recalibration_log ───────────────────────────────────────────────────────
-- Audit of the daily automated reviews + the mandatory weekly HUMAN
-- recalibration of calendar / cohorts / filters.
CREATE TABLE IF NOT EXISTS public.recalibration_log (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT now(),
  kind         TEXT NOT NULL,             -- daily_review | weekly_recalibration
  actor        TEXT,                      -- 'system' | user email
  scope        TEXT[],                    -- {calendar, cohorts, filters, thresholds}
  summary      JSONB DEFAULT '{}'::jsonb, -- what changed
  slots_touched INT,
  next_due_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recal_kind_idx ON public.recalibration_log (kind, created_at DESC);

-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  RLS — anon read + write (suite-wide posture; non-sensitive marketing data) ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'brands','ci_ads','ci_emails','ci_landing_pages','ci_offers','ci_funnels',
    'ci_screenshots','ci_asset_versions','ci_creative_tags',
    'kb_campaigns','cohorts','performance_metrics','calendar_slots',
    'campaign_specs','calendar_feedback','mvt_experiments','recalibration_log'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_read"  ON public.%I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_write" ON public.%I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_upd"   ON public.%I;', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_del"   ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "%s_read"  ON public.%I FOR SELECT USING (true);', t, t);
    EXECUTE format('CREATE POLICY "%s_write" ON public.%I FOR INSERT WITH CHECK (true);', t, t);
    EXECUTE format('CREATE POLICY "%s_upd"   ON public.%I FOR UPDATE USING (true) WITH CHECK (true);', t, t);
    EXECUTE format('CREATE POLICY "%s_del"   ON public.%I FOR DELETE USING (true);', t, t);
  END LOOP;
END $$;

-- ── Convenience view: offers joined to brand for the marketing-team query ─────
-- "every competitor running a <offer_type> offer on <category> in <region> in last N days"
CREATE OR REPLACE VIEW public.v_ci_offers_enriched AS
SELECT o.*, b.domain AS brand_domain, b.category AS brand_category, b.region AS brand_region
FROM public.ci_offers o
LEFT JOIN public.brands b ON b.id = o.brand_id
WHERE COALESCE(b.is_own, false) = false;
