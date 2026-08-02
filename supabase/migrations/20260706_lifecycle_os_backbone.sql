-- ============================================================================
-- 20260706_lifecycle_os_backbone.sql
-- KNICKGASM Lifecycle OS — production backbone (Module 1 + connector fabric +
-- job-log infra + prompt/agent registries).
--
-- Additive and non-destructive: creates only tables that did NOT already exist
-- in the ~85-table schema (checked against all prior migrations). Existing
-- smart_*, ci_*, kb_*, lifecycle_* tables are left untouched and reused.
--
-- Conventions followed from prior migrations:
--   * public schema
--   * RLS enabled, `create policy "read all" ... for select using (true)`
--   * writes happen via the service-role key (bypasses RLS) from serverless
--   * created_at / updated_at, jsonb metadata, indexes on hot columns
--
-- Seeds ONLY system configuration (connectors, scheduled jobs, settings),
-- prompt templates, and agent definitions — never fake performance metrics.
-- All seeds are idempotent (on conflict).
-- ============================================================================

-- ── Core ────────────────────────────────────────────────────────────────────

create table if not exists public.workspaces (
  id          text primary key,
  name        text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null default 'knickgasm',
  user_email    text not null,
  role          text not null default 'member',
  created_at    timestamptz not null default now()
);
create unique index if not exists workspace_members_uq on public.workspace_members (workspace_id, user_email);

create table if not exists public.activity_logs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'knickgasm',
  actor        text,                       -- user email, 'system', or agent slug
  action       text not null,              -- e.g. 'connector.sync', 'asset.generate'
  entity_type  text,                       -- 'connector' | 'campaign' | 'asset' | ...
  entity_id    text,
  summary      text,
  status       text default 'ok',          -- ok | warn | error
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists activity_logs_ws_created on public.activity_logs (workspace_id, created_at desc);
create index if not exists activity_logs_entity on public.activity_logs (entity_type, entity_id);
create index if not exists activity_logs_action on public.activity_logs (action);

create table if not exists public.saved_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'knickgasm',
  user_email   text,
  item_type    text not null,              -- 'mailer' | 'ad' | 'landing_page' | 'report' | 'prompt' | ...
  item_id      text,
  title        text,
  ref_url      text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists saved_items_ws_type on public.saved_items (workspace_id, item_type, created_at desc);

create table if not exists public.uploaded_files (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   text not null default 'knickgasm',
  user_email     text,
  filename       text not null,
  mime_type      text,
  size_bytes     bigint,
  storage_bucket text,
  storage_path   text,
  purpose        text,                     -- 'lp_clone_source' | 'kb_source' | 'brand_guideline' | ...
  sha1           text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists uploaded_files_ws_purpose on public.uploaded_files (workspace_id, purpose, created_at desc);

create table if not exists public.exports (
  id           uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'knickgasm',
  export_type  text not null,              -- 'assistant_package' | 'report' | 'landing_page' | ...
  format       text,                       -- 'json' | 'zip' | 'html' | 'csv' | 'pdf'
  status       text not null default 'ready',
  title        text,
  storage_bucket text,
  storage_path text,
  download_url text,
  size_bytes   bigint,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists exports_ws_created on public.exports (workspace_id, export_type, created_at desc);

create table if not exists public.system_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  description text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- ── Connectors ────────────────────────────────────────────────────────────────

create table if not exists public.connectors (
  id                   text primary key,   -- slug: 'shopify', 'klaviyo', ...
  name                 text not null,
  category             text,               -- 'competitive' | 'ads' | 'commerce' | 'email' | 'analytics' | 'generation' | 'utility'
  provider             text,
  status               text not null default 'not_connected', -- computed at runtime; stored for last-known
  supported_data_types text[] not null default '{}',
  required_env_vars    text[] not null default '{}',
  optional_env_vars    text[] not null default '{}',
  auth_kind            text default 'api_key', -- 'api_key' | 'oauth' | 'wif' | 'none' | 'manual'
  docs_url             text,
  setup_instructions   text,
  include_in_daily_job boolean not null default true,
  last_sync_at         timestamptz,
  last_status          text,
  last_error           text,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.connector_required_env_vars (
  id           uuid primary key default gen_random_uuid(),
  connector_id text not null references public.connectors(id) on delete cascade,
  env_var      text not null,
  description  text,
  required     boolean not null default true
);
create unique index if not exists connector_env_uq on public.connector_required_env_vars (connector_id, env_var);

create table if not exists public.connector_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  connector_id   text not null,
  trigger        text not null default 'manual', -- manual | cron
  status         text not null default 'running', -- running | success | error | skipped
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  records_synced integer not null default 0,
  message        text,
  metadata       jsonb not null default '{}'::jsonb
);
create index if not exists connector_sync_runs_conn on public.connector_sync_runs (connector_id, started_at desc);
create index if not exists connector_sync_runs_status on public.connector_sync_runs (status);

create table if not exists public.connector_errors (
  id            uuid primary key default gen_random_uuid(),
  connector_id  text not null,
  sync_run_id   uuid,
  error_code    text,
  error_message text,
  created_at    timestamptz not null default now()
);
create index if not exists connector_errors_conn on public.connector_errors (connector_id, created_at desc);

-- ── Scheduled jobs / cron / logs ────────────────────────────────────────────

create table if not exists public.scheduled_jobs (
  id           text primary key,           -- slug: 'daily-intelligence-refresh'
  name         text not null,
  schedule_cron text,
  timezone     text default 'Asia/Kolkata',
  enabled      boolean not null default true,
  endpoint     text,
  description  text,
  last_run_at  timestamptz,
  last_status  text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.cron_runs (
  id           uuid primary key default gen_random_uuid(),
  job_id       text not null,
  trigger      text not null default 'manual', -- manual | cron
  status       text not null default 'running',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  steps_total  integer not null default 0,
  steps_ok     integer not null default 0,
  steps_failed integer not null default 0,
  summary      text,
  metadata     jsonb not null default '{}'::jsonb
);
create index if not exists cron_runs_job on public.cron_runs (job_id, started_at desc);

create table if not exists public.job_run_logs (
  id           uuid primary key default gen_random_uuid(),
  cron_run_id  uuid,
  job_id       text,
  step         text not null,
  status       text not null default 'ok',  -- ok | warn | error | skipped
  message      text,
  duration_ms  integer,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists job_run_logs_run on public.job_run_logs (cron_run_id);
create index if not exists job_run_logs_job on public.job_run_logs (job_id, created_at desc);

-- ── Prompt template registry (versioned) ────────────────────────────────────

create table if not exists public.prompt_templates (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null,
  name            text not null,
  category        text,                    -- 'ad' | 'mailer' | 'landing_page' | 'image' | 'video' | 'analysis' | 'assistant' | ...
  channel         text,
  version         integer not null default 1,
  is_active       boolean not null default true,
  system_prompt   text,
  user_template   text,
  output_contract text,
  negative_prompt text,
  notes           text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists prompt_templates_slug_ver on public.prompt_templates (slug, version);
create index if not exists prompt_templates_active on public.prompt_templates (is_active, category);

-- ── Agent registry + runs ───────────────────────────────────────────────────

create table if not exists public.agent_definitions (
  id            text primary key,          -- slug
  name          text not null,
  purpose       text,
  category      text,
  input_schema  jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  default_model text,
  enabled       boolean not null default true,
  writes        boolean not null default false, -- true => generates/mutates, run only on explicit ask
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.agent_runs (
  id                  uuid primary key default gen_random_uuid(),
  agent_id            text not null,
  workspace_id        text not null default 'knickgasm',
  trigger             text default 'manual',
  status              text not null default 'running', -- running | success | error | cancelled
  input               jsonb not null default '{}'::jsonb,
  output              jsonb,
  quality_score       numeric,
  error               text,
  related_campaign_id text,
  related_asset_id    text,
  started_at          timestamptz not null default now(),
  finished_at         timestamptz,
  metadata            jsonb not null default '{}'::jsonb
);
create index if not exists agent_runs_agent on public.agent_runs (agent_id, started_at desc);
create index if not exists agent_runs_status on public.agent_runs (status);

create table if not exists public.agent_run_steps (
  id           uuid primary key default gen_random_uuid(),
  agent_run_id uuid not null,
  step_no      integer not null default 0,
  name         text,
  status       text default 'ok',
  input        jsonb,
  output       jsonb,
  message      text,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);
create index if not exists agent_run_steps_run on public.agent_run_steps (agent_run_id, step_no);

-- ── updated_at trigger ──────────────────────────────────────────────────────
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','connectors','scheduled_jobs','prompt_templates','agent_definitions','system_settings'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on public.%1$I; create trigger set_updated_at before update on public.%1$I for each row execute function public.tg_set_updated_at();', t);
  end loop;
end $$;

-- ── RLS: read-all (writes via service-role key which bypasses RLS) ───────────
do $$
declare t text;
begin
  foreach t in array array[
    'workspaces','workspace_members','activity_logs','saved_items','uploaded_files','exports',
    'system_settings','connectors','connector_required_env_vars','connector_sync_runs',
    'connector_errors','scheduled_jobs','cron_runs','job_run_logs','prompt_templates',
    'agent_definitions','agent_runs','agent_run_steps'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "read all" on public.%I;', t);
    execute format('create policy "read all" on public.%I for select using (true);', t);
  end loop;
end $$;

-- ============================================================================
-- SEEDS (idempotent) — system configuration only
-- ============================================================================

insert into public.workspaces (id, name) values ('knickgasm', 'KNICKGASM Lifecycle OS')
on conflict (id) do nothing;

-- Standard duration options + core settings ----------------------------------
insert into public.system_settings (key, value, description) values
  ('durations.options',
   '["today","next_3_days","this_week","this_month","next_45_days","this_and_next_month"]'::jsonb,
   'Canonical duration options used app-wide'),
  ('durations.week_days', '7'::jsonb, 'This Week = today + N calendar days'),
  ('jobs.daily_refresh_time_ist', '"00:00"'::jsonb, 'Daily Intelligence Refresh local (IST) time'),
  ('brand.guideline_coverage', '{"parsed":false,"source":null,"note":"Brand Settings editable; PDF not yet parsed into KB"}'::jsonb,
   'Whether KNICKGASM brand guidelines are parsed into the KB'),
  ('assistant.child_gpt_prompt',
   '"You are the KNICKGASM Lifecycle OS Strategy Co-Pilot. Your intelligence is fed by KNICKGASM approved brand guidelines, product knowledge, competitive benchmarking, lifecycle marketing logic, asset prompt templates, quality scoring rules, and available performance analytics. When assisting the user, avoid abstract advice. Provide concrete recommendations, asset layouts, campaign ideas, cohort strategies, landing-page structures, and optimization steps. Where performance data exists, cite the metric and source. Where data is unavailable, clearly say what is missing and recommend what to connect or import. Never copy competitor creative assets. Use competitor data only for benchmarking and strategic inspiration."'::jsonb,
   'Versioned Child GPT / external assistant system prompt (v1)')
on conflict (key) do nothing;

-- Scheduled job: Daily Intelligence Refresh ----------------------------------
-- 00:00 IST == 18:30 UTC (prior day). Cron here is documentary; the live Vercel
-- cron entries live in vercel.json.
insert into public.scheduled_jobs (id, name, schedule_cron, timezone, endpoint, description) values
  ('daily-intelligence-refresh', 'Daily Intelligence Refresh', '30 18 * * *', 'Asia/Kolkata',
   '/api/brain?action=os-run-daily-job',
   'Connector health check + competitive/KB/benchmark refresh + metrics + dashboard insights. Manually triggerable from Settings.')
on conflict (id) do update set name = excluded.name, endpoint = excluded.endpoint, description = excluded.description;

-- Connectors registry ---------------------------------------------------------
insert into public.connectors (id, name, category, provider, supported_data_types, required_env_vars, optional_env_vars, auth_kind, docs_url, setup_instructions, include_in_daily_job) values
  ('semrush','Semrush','competitive','Semrush', '{competitor_traffic,keywords,backlinks,paid_visibility}', '{SEMRUSH_API_KEY}', '{}', 'api_key', 'https://developer.semrush.com/api/', 'Add SEMRUSH_API_KEY in Vercel env. Analytics API subscription required.', true),
  ('similarweb','Similarweb','competitive','Similarweb', '{traffic,engagement,traffic_sources,audience}', '{SIMILARWEB_API_KEY}', '{}', 'api_key', 'https://developers.similarweb.com/', 'Add SIMILARWEB_API_KEY in Vercel env.', true),
  ('meta_ads','Meta Ads / Ad Library','ads','Meta', '{ads,ad_library,campaign_metrics,creatives}', '{META_ACCESS_TOKEN,META_AD_ACCOUNT_ID}', '{META_APP_ID,META_APP_SECRET}', 'oauth', 'https://developers.facebook.com/docs/marketing-apis/', 'Create a Meta app, generate a long-lived access token with ads_read, set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID. Ad Library search is public but rate-limited.', true),
  ('google_ads','Google Ads','ads','Google', '{campaign_metrics,keywords,search_terms}', '{GOOGLE_ADS_DEVELOPER_TOKEN,GOOGLE_ADS_CLIENT_ID,GOOGLE_ADS_CLIENT_SECRET,GOOGLE_ADS_REFRESH_TOKEN,GOOGLE_ADS_CUSTOMER_ID}', '{}', 'oauth', 'https://developers.google.com/google-ads/api/docs/start', 'Google Ads API requires a developer token + OAuth client + refresh token. Transparency Center has no official API — use manual import for competitor ads.', true),
  ('google_analytics','Google Analytics 4','analytics','Google', '{sessions,conversions,funnels,revenue}', '{GA4_PROPERTY_ID}', '{GOOGLE_APPLICATION_CREDENTIALS,GCP_WORKLOAD_IDENTITY_PROVIDER,GCP_SERVICE_ACCOUNT_EMAIL}', 'wif', 'https://developers.google.com/analytics/devguides/reporting/data/v1', 'Set GA4_PROPERTY_ID and reuse the existing GCP Workload Identity Federation service account (see docs/workload-identity-federation.md).', true),
  ('shopify','Shopify','commerce','Shopify', '{orders,products,customers,collections}', '{SHOPIFY_STORE_DOMAIN,SHOPIFY_ADMIN_TOKEN}', '{}', 'api_key', 'https://shopify.dev/docs/api/admin', 'Admin connector is NOT authorized for this workspace (per project memory). Public storefront scraping (/products.json) is used as fallback until an Admin token is provided.', true),
  ('klaviyo','Klaviyo','email','Klaviyo', '{profiles,lists,segments,campaigns,flows,metrics,events}', '{KLAVIYO_API_KEY}', '{KLAVIYO_PUBLIC_KEY,KLAVIYO_REVISION}', 'api_key', 'https://developers.klaviyo.com/en/reference/api_overview', 'Add KLAVIYO_API_KEY. Integration is scaffolded (api/_shared/klaviyo-core.js) and returns request stubs until the key is set.', true),
  ('tiktok_ads','TikTok Ads','ads','TikTok', '{ads,campaign_metrics,creatives}', '{TIKTOK_ACCESS_TOKEN,TIKTOK_ADVERTISER_ID}', '{}', 'oauth', 'https://business-api.tiktok.com/portal/docs', 'TikTok Marketing API requires an approved app + access token. TikTok Creative Center / Ad Library has no official API — use manual import.', true),
  ('pagedeck','PageDeck','competitive','PageDeck', '{landing_page_captures}', '{PAGEDECK_API_KEY}', '{}', 'api_key', 'https://pagedeck.io/', 'No public API confirmed. Use manual import of captured landing pages until an API/key is available.', false),
  ('framer','Framer','utility','Framer', '{page_exports}', '{FRAMER_API_TOKEN}', '{}', 'api_key', 'https://www.framer.com/developers/', 'Framer has no general content API. Use manual HTML/export upload via the Landing Page Cloner.', false),
  ('motion','Motion (creative analytics)','ads','Motion', '{creative_analytics}', '{MOTION_API_KEY}', '{}', 'api_key', 'https://motionapp.com/', 'No confirmed public API. Manual import of creative performance exports until a key is available.', false),
  ('pinterest_ads','Pinterest Ads','ads','Pinterest', '{ads,metrics}', '{PINTEREST_ACCESS_TOKEN,PINTEREST_AD_ACCOUNT_ID}', '{}', 'oauth', 'https://developers.pinterest.com/docs/api/v5/', 'Pinterest API v5 requires an approved app + access token.', false),
  ('linkedin_ads','LinkedIn Ads','ads','LinkedIn', '{ads,metrics}', '{LINKEDIN_ACCESS_TOKEN,LINKEDIN_AD_ACCOUNT_ID}', '{}', 'oauth', 'https://learn.microsoft.com/en-us/linkedin/marketing/', 'LinkedIn Marketing API requires partner access approval.', false),
  ('huggingface','Hugging Face','generation','Hugging Face', '{image_generation,inference}', '{HUGGINGFACE_API_KEY}', '{}', 'api_key', 'https://huggingface.co/docs/api-inference/index', 'Add HUGGINGFACE_API_KEY for inference-hosted image/text models.', false),
  ('replicate','Replicate','generation','Replicate', '{image_generation,video_generation}', '{REPLICATE_API_TOKEN}', '{}', 'api_key', 'https://replicate.com/docs', 'Add REPLICATE_API_TOKEN as an image/video generation fallback.', false),
  ('file_storage','File Storage (Supabase)','utility','Supabase', '{file_upload,object_storage}', '{SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY}', '{}', 'api_key', 'https://supabase.com/docs/guides/storage', 'Uses the existing Supabase Storage buckets. Connected when Supabase env vars are present.', false),
  ('web_fetcher','Web / Page Fetcher','utility','built-in', '{url_fetch,page_snapshot}', '{}', '{}', 'none', null, 'Built-in server-side fetch. Always available; respects robots and site terms.', false),
  ('manual_import','Manual Import / Upload','utility','built-in', '{csv,html,zip,screenshots,urls}', '{}', '{}', 'manual', null, 'Always available. Upload files or paste source URLs where a live connector is missing.', false)
on conflict (id) do update set
  name = excluded.name, category = excluded.category, provider = excluded.provider,
  supported_data_types = excluded.supported_data_types, required_env_vars = excluded.required_env_vars,
  optional_env_vars = excluded.optional_env_vars, auth_kind = excluded.auth_kind,
  docs_url = excluded.docs_url, setup_instructions = excluded.setup_instructions;

-- Mirror required env vars into the detail table -------------------------------
insert into public.connector_required_env_vars (connector_id, env_var, required)
select c.id, e, true
from public.connectors c, unnest(c.required_env_vars) as e
on conflict (connector_id, env_var) do nothing;
insert into public.connector_required_env_vars (connector_id, env_var, required)
select c.id, e, false
from public.connectors c, unnest(c.optional_env_vars) as e
on conflict (connector_id, env_var) do nothing;

-- Agent definitions (22) ------------------------------------------------------
insert into public.agent_definitions (id, name, purpose, category, writes) values
  ('competitive_research','Competitive Research Agent','Discover + rank competitor brands and pull their ads/LP/email/offer signals','competitive', false),
  ('kb_update','Knowledge Base Update Agent','Summarize sources into KB entries with insights + confidence','knowledge', true),
  ('meta_ads','Meta Ads Agent','Produce Meta ad copy + creative briefs per objective/cohort','ads', true),
  ('google_ads','Google Ads Agent','Produce RSA/PMax copy + creative briefs','ads', true),
  ('tiktok_reels','TikTok / Reels Agent','Produce short-form video scripts + key-frame briefs','ads', true),
  ('email_mailer','Email / Mailer Agent','Write lifecycle mailers by cohort/stage with KPI hypotheses','mailer', true),
  ('landing_page','Landing Page Agent','Plan high-converting mobile-first landing page structures','landing_page', true),
  ('landing_page_clone','Landing Page Clone Agent','Structurally clone a source page into a KNICKGASM-branded equivalent','landing_page', true),
  ('image_prompt','Image Prompt Agent','Generate on-brand image prompts + negative prompts','asset', true),
  ('video_prompt','Video Prompt Agent','Generate short-form video shot sequences + motion briefs','asset', true),
  ('gif_animation','GIF / Animation Agent','Generate GIF/animation frame plans','asset', true),
  ('offer_gift_strategy','Offer / Gift Strategy Agent','Design offer/gift/bundle strategy by cohort/margin','strategy', false),
  ('cohort_strategy','Cohort Strategy Agent','Select + justify cohorts and suppression logic','strategy', false),
  ('marketing_calendar','Marketing Calendar Agent','Generate a reuse-aware campaign calendar for a duration','planning', true),
  ('data_analysis','Data Analysis Agent','Turn metrics into concrete, evidence-backed insights','analytics', false),
  ('dashboard_insight','Dashboard Insight Agent','Summarize dashboards into ranked insight cards','analytics', false),
  ('quality_scoring','Quality Scoring Agent','Score outputs across 10 axes with explanations','quality', false),
  ('compliance_claims','Compliance / Claims Agent','Flag banned phrases, medical claims, fake scarcity','quality', false),
  ('brand_consistency','Brand Consistency Agent','Check palette/typography/voice adherence','quality', false),
  ('retention_strategy','Retention Strategy Agent','Recommend retention plays grounded in expert logic','strategy', false),
  ('growth_strategy','Growth Strategy Agent','Recommend growth plays grounded in expert logic','strategy', false),
  ('assistant_export','External Assistant Export Agent','Assemble the exportable Child-GPT knowledge package','assistant', true)
on conflict (id) do update set name = excluded.name, purpose = excluded.purpose, category = excluded.category, writes = excluded.writes;

-- Prompt templates (v1) — detailed seeds for the core agents, real stubs for the rest
insert into public.prompt_templates (slug, name, category, channel, version, system_prompt, notes) values
  ('meta_static_image','Meta / Google Static Image','ad','meta',1,
   'You are a senior brand designer for KNICKGASM. Generate ultra-premium, high-converting performance marketing imagery. Use KNICKGASM approved brand guidelines, product imagery rules, and compliance-safe claim language. Composition should feel premium, modern, streetwear-led, and conversion-focused. Use benchmark patterns only as strategic inspiration, not as copied creative. Include clear safe zones for text overlays, product-first hierarchy, and channel-specific dimensions. Output must include concept, layout, visual direction, text overlay, negative prompt, compliance notes, and quality criteria.',
   'Exact seed from spec Module 9'),
  ('video_gif','Video / GIF Animation','video','tiktok',1,
   'You are an elite motion designer for ecommerce video hooks. Generate premium short-form video or GIF concepts for KNICKGASM. Focus on product ritual, ingredient texture, pouring, unboxing, transformation, or sensory streetwear moments. Match the requested channel dimensions and duration. Use smooth motion, premium pacing, and KNICKGASM brand styling. Output must include shot sequence, frame-by-frame direction, motion style, text overlays, audio/music direction if applicable, negative prompt, compliance notes, and quality criteria.',
   'Exact seed from spec Module 9'),
  ('mailer_retention','Mailer & Retention Copywriter','mailer','email',1,
   'You are an expert lifecycle marketer and retention copywriter for KNICKGASM. Write personalized lifecycle campaigns designed to improve open rate, click-through rate, conversion, repeat purchase, and retention. Use warm, premium, streetwear-forward language. Structure output by cohort, lifecycle stage, subject line, preview text, body sections, CTA, offer, personalization logic, suppression rules, creative direction, and expected KPI impact. Use competitive benchmarking and expert logic base patterns without copying competitor content.',
   'Exact seed from spec Module 9'),
  ('landing_page','Landing Page','landing_page','web',1,
   'You are a senior ecommerce CRO strategist and frontend landing-page planner for KNICKGASM. Create high-converting, mobile-first landing page structures using KNICKGASM brand guidelines, campaign objectives, product knowledge, competitive benchmarking, and compliance-safe copy. Output must include section order, layout notes, copy blocks, CTA hierarchy, visual asset prompts, video/GIF prompts where useful, FAQ, proof points, SEO metadata, tracking notes, and quality criteria.',
   'Exact seed from spec Module 9'),
  ('landing_page_clone','Landing Page Clone','landing_page','web',1,
   'You are a structural landing-page cloning specialist for KNICKGASM. Analyze the source page layout skeleton, DOM order, spacing, responsive behavior, media containers, sticky states, interaction patterns, and conversion flow. Recreate a KNICKGASM-branded structural equivalent without copying competitor creative assets. Preserve structure, hierarchy, spacing, component behavior, and media frame dimensions as closely as possible. Output must include clone plan, section map, asset replacement plan, responsive notes, accuracy checklist, difference report, and quality criteria.',
   'Exact seed from spec Module 9'),
  ('data_analysis','Data Analysis','analytics','all',1,
   'You are a growth, retention, and ecommerce analytics lead for KNICKGASM. Analyze available metrics and produce clear, data-backed insights. Do not give abstract advice. For every insight, show what changed, why it likely changed, supporting numbers, related campaigns/assets, recommendation, expected impact, confidence level, and missing data if any.',
   'Exact seed from spec Module 9'),
  ('google_search','Google Search Ad (RSA)','ad','google',1,'You are a KNICKGASM senior SEM copywriter. Produce 15 headlines (<=30 chars), 4 descriptions (<=90 chars), a long headline, and a business name for a Responsive Search Ad. On-brand, compliance-safe, benefit-led. Include destination URL and quality criteria.',null),
  ('google_pmax','Google Performance Max Asset Group','ad','google',1,'You are a KNICKGASM performance marketer. Produce a full PMax asset group: headlines, long headlines, descriptions, and briefs for image/video assets at required sizes. On-brand, compliance-safe. Include quality criteria.',null),
  ('tiktok_script','TikTok / Reel Script','video','tiktok',1,'You are a KNICKGASM short-form creative. Write a native-feeling 15-30s script with a 0-2s hook, on-screen text beats, audio direction, caption and 3 hashtag options, plus a 9:16 key-frame brief. Compliance-safe.',null),
  ('ugc_script','UGC Script','video','tiktok',1,'You are a KNICKGASM UGC director. Write a believable creator-voice script (hook, story, proof, CTA) with shot list and on-screen text. No medical claims, no banned phrases.',null),
  ('hero_image','Hero Image','image','web',1,'You are a KNICKGASM brand photographer. Describe a photoreal, on-palette hero image (product-first, text-free) with composition, lighting, props and negative prompt.',null),
  ('product_image','Product Image','image','web',1,'You are a KNICKGASM packshot specialist. Describe a clean, premium product packshot on-palette with negative prompt.',null),
  ('lifestyle_image','Lifestyle Image','image','web',1,'You are a KNICKGASM lifestyle photographer. Describe a sensory, ritual-led lifestyle scene on-palette with negative prompt.',null),
  ('infographic','Infographic','image','web',1,'You are a KNICKGASM information designer. Plan an on-brand infographic: hierarchy, data points, iconography, palette usage, and copy blocks.',null),
  ('gif','GIF','video','all',1,'You are a KNICKGASM motion designer. Plan a 2-4 frame GIF (gentle Ken-Burns/cross-fade) from product photography with timing and text overlay.',null),
  ('short_video','Short Video','video','all',1,'You are a KNICKGASM video editor. Plan a short product video: shot sequence, pacing, motion style, text overlays, audio direction.',null),
  ('blog','Blog / Article','content','web',1,'You are a KNICKGASM content lead. Outline and draft an SEO-aware, on-voice article with headings, key points, internal links and metadata.',null),
  ('seo_metadata','SEO Metadata','content','web',1,'You are a KNICKGASM SEO specialist. Produce title tag, meta description, slug, H1, and schema suggestions for the given page.',null),
  ('offer_gift','Offer / Gift Strategy','strategy','all',1,'You are a KNICKGASM offer strategist. Recommend offer/gift/bundle structures by cohort and margin, with rationale and expected impact.',null),
  ('campaign_calendar','Campaign Calendar','planning','all',1,'You are the KNICKGASM Marketing Calendar Agent. Produce a reuse-aware calendar for the chosen duration: date, channel, cohort, objective, angle, offer, required asset, rationale.',null),
  ('cohort_plan','Cohort Plan','strategy','all',1,'You are the KNICKGASM Cohort Strategy Agent. Select cohorts with rules, why-this-cohort, objective, timing, and suppression logic.',null),
  ('child_gpt_export','Child GPT Export Summary','assistant','all',1,'You are the KNICKGASM Assistant Export Agent. Summarize exportable KB + logic + benchmarks into a compact, vector-ready knowledge package. Exclude private/internal content.',null)
on conflict (slug, version) do update set system_prompt = excluded.system_prompt, name = excluded.name, category = excluded.category;
