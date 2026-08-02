-- ═══════════════════════════════════════════════════════════════════════════
-- Smart Brain — full linked-DB schema capture (17 tables).
--
-- These 17 smart_* tables are written/read by the Smart Brain daily loop but
-- had NO migration file: they were created ad-hoc directly in the linked
-- Supabase project. This migration reverse-engineers them from the code that
-- uses them (api/_shared/brain-*.js, api/brain.js, api/_shared/brain-core.js,
-- lib/smart-brain/services.js) so the schema is captured in version control
-- and reproducible on a fresh project.
--
-- Conventions match the repo's existing smart_* migrations
-- (20260609_smart_brain.sql, 20260610_smart_calendar_plan.sql,
-- 20260617_competitive_intel_and_brain.sql):
--   • id: TEXT PRIMARY KEY for code-supplied stable ids (idFor()/upsert on id),
--     BIGSERIAL for append-only log rows the code inserts without an id.
--   • created_at / updated_at: TIMESTAMPTZ DEFAULT now().
--   • payload/blob columns: JSONB with '{}'::jsonb / '[]'::jsonb defaults.
--   • RLS: ENABLE + permissive allow-all read/write/upd/del policies per table.
-- Idempotent: create table if not exists + drop policy if exists then create.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. smart_calendar ────────────────────────────────────────────────────────
-- Rolling tentative→approved→generated→final slot plan. One row per
-- date+market+channel+slot_type. Written by brain-calendar.slotRow()/generate(),
-- read/filtered on slot_date (gte), market, status, id.
create table if not exists public.smart_calendar (
  id            text primary key,             -- idFor('slot', …), stable across syncs
  slot_date     date not null,
  market        text not null,
  channel       text not null,                -- email|landing_email|google|meta|tiktok|landing_ads
  slot_type     text default 'campaign',      -- campaign|retargeting
  cohort_id     text,
  theme         text,
  angle         text,
  hook          text,
  products      jsonb default '[]'::jsonb,
  festival      text,
  rationale     text,
  mvt           jsonb default '{}'::jsonb,
  status        text not null default 'tentative', -- tentative|approved|generated|in_review|final|skipped|rejected
  confidence    numeric default 0,
  source        jsonb default '{}'::jsonb,     -- audit trail (own_library / festival / competitor_advisory / …)
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists smart_calendar_date_idx      on public.smart_calendar (slot_date);
create index if not exists smart_calendar_market_idx    on public.smart_calendar (market, slot_date);
create index if not exists smart_calendar_status_idx    on public.smart_calendar (status, slot_date);
create unique index if not exists smart_calendar_slot_uidx
  on public.smart_calendar (slot_date, market, channel, slot_type);

-- ── 2. smart_calendar_reviews ─────────────────────────────────────────────────
-- Audit log of each automated dailyReview() run. Append-only (insert, no id).
create table if not exists public.smart_calendar_reviews (
  id            bigserial primary key,
  review_date   date not null,
  automated     boolean default true,
  changes       jsonb default '[]'::jsonb,     -- [{slot, action, reason, …}]
  reasons       jsonb default '{}'::jsonb,      -- {pass_rate, top_angles}
  created_at    timestamptz default now()
);
create index if not exists smart_calendar_reviews_date_idx
  on public.smart_calendar_reviews (review_date, created_at desc);

-- ── 3. smart_cohorts ──────────────────────────────────────────────────────────
-- Auto-rebuilt cohorts (brain-analysis.defineCohorts()). Upsert on id.
-- Read/filtered on active=true, ordered by value_score desc.
create table if not exists public.smart_cohorts (
  id            text primary key,             -- coh_<market>_<key>
  name          text not null,
  market        text,
  definition    jsonb default '{}'::jsonb,     -- {rule, intent}
  size          integer default 0,
  value_score   numeric default 0,
  metrics       jsonb default '{}'::jsonb,     -- {avg_orders, avg_spent, email_engaged_pct, ads_engaged_pct}
  source        text default 'auto',
  active        boolean default true,
  updated_at    timestamptz default now(),
  created_at    timestamptz default now()
);
create index if not exists smart_cohorts_active_idx on public.smart_cohorts (active, value_score desc);
create index if not exists smart_cohorts_market_idx on public.smart_cohorts (market);

-- ── 4. smart_festivals ────────────────────────────────────────────────────────
-- Seasonal peaks: manually-seeded + auto-detected (source='auto') from
-- smart_sales_history. Upsert on id, ordered by mmdd asc.
create table if not exists public.smart_festivals (
  id            text primary key,             -- fest_auto_<market>_<mmdd> or seeded id
  market        text not null,
  mmdd          text not null,                -- 'MM-DD'
  name          text,
  weight        integer default 5,
  source        text default 'manual',        -- manual|auto
  evidence      jsonb default '{}'::jsonb,     -- {spike_ratio, observed_dates, baseline_window_days}
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists smart_festivals_mmdd_idx   on public.smart_festivals (mmdd);
create index if not exists smart_festivals_market_idx on public.smart_festivals (market, mmdd);

-- ── 5. smart_sales_history ────────────────────────────────────────────────────
-- Daily per-market revenue, externally ingested. Read (order sale_date asc) for
-- peak/festival auto-detection. NOTE: shape is GUESSED — only sale_date, market,
-- revenue are referenced in code; verify against the actual ingested columns.
create table if not exists public.smart_sales_history (
  id            bigserial primary key,
  sale_date     date not null,
  market        text,
  revenue       numeric default 0,
  orders        integer,
  metadata      jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);
create index if not exists smart_sales_history_date_idx on public.smart_sales_history (sale_date);
create index if not exists smart_sales_history_market_idx on public.smart_sales_history (market, sale_date);

-- ── 6. smart_funnels ──────────────────────────────────────────────────────────
-- Full-funnel spec generated per slot (brain-generate.funnelSpec()). Upsert on id.
create table if not exists public.smart_funnels (
  id            text primary key,             -- idFor('fun', {slot})
  cohort_id     text,
  slot_id       text,
  name          text,
  stages        jsonb default '[]'::jsonb,
  retargeting   jsonb default '{}'::jsonb,
  audiences     jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);
create index if not exists smart_funnels_slot_idx on public.smart_funnels (slot_id);

-- ── 7. smart_generated_assets ────────────────────────────────────────────────
-- Individual generated artifacts (mailer_html, landing_html, ad_copy, funnel_spec…).
-- Upsert on id; read/filtered on slot_id, id; ordered by created_at desc.
create table if not exists public.smart_generated_assets (
  id                     text primary key,    -- idFor('ast', {slot,type,name})
  slot_id                text,
  type                   text not null,        -- mailer_html|landing_html|ad_copy|ad_creative_brief|audience_spec|funnel_spec
  name                   text,
  content                text,                 -- the rendered HTML/JSON/copy blob
  meta                   jsonb default '{}'::jsonb,
  generated_campaign_id  text,
  created_at             timestamptz default now()
);
create index if not exists smart_generated_assets_slot_idx    on public.smart_generated_assets (slot_id, created_at desc);
create index if not exists smart_generated_assets_created_idx on public.smart_generated_assets (created_at desc);

-- ── 8. smart_review_queue ────────────────────────────────────────────────────
-- Human-in-the-loop queue. Insert without id (append), update by id.
-- Filtered on state, item_type; ordered by created_at desc.
create table if not exists public.smart_review_queue (
  id            bigserial primary key,
  item_type     text not null default 'generated_campaign',
  item_id       text,
  state         text not null default 'pending',  -- pending|approved|rejected
  auto_approved boolean default false,
  reviewer      text,
  notes         text,
  decided_at    timestamptz,
  created_at    timestamptz default now()
);
create index if not exists smart_review_queue_state_idx on public.smart_review_queue (state, item_type, created_at desc);
create index if not exists smart_review_queue_item_idx  on public.smart_review_queue (item_id);

-- ── 9. smart_competitor_signals ──────────────────────────────────────────────
-- Advisory benchmark signals derived from smart_competitor_campaigns.
-- Insert without id (append). Isolated advisory stream.
create table if not exists public.smart_competitor_signals (
  id            bigserial primary key,
  signal_date   date not null,
  market        text,
  channel       text,
  signal        jsonb default '{}'::jsonb,     -- {captured, active_brands, promo_share, top_angles, cadence…}
  created_at    timestamptz default now()
);
create index if not exists smart_competitor_signals_date_idx    on public.smart_competitor_signals (signal_date desc);
create index if not exists smart_competitor_signals_market_idx  on public.smart_competitor_signals (market, channel, signal_date desc);

-- ── 10. smart_brain_config ───────────────────────────────────────────────────
-- Key/value config overrides merged over DEFAULT_CONFIG. Upsert on key.
create table if not exists public.smart_brain_config (
  key           text primary key,
  value         jsonb not null default '{}'::jsonb,
  updated_at    timestamptz default now(),
  created_at    timestamptz default now()
);

-- ── 11. smart_recalibrations ─────────────────────────────────────────────────
-- Weekly human recalibration records. Insert without id; read latest by created_at.
create table if not exists public.smart_recalibrations (
  id            bigserial primary key,
  week_start    text,                         -- todayIso() at recalibration
  reviewer      text not null,
  decisions     jsonb default '[]'::jsonb,
  created_at    timestamptz default now()
);
create index if not exists smart_recalibrations_created_idx on public.smart_recalibrations (created_at desc);

-- ── 12. smart_confidence ─────────────────────────────────────────────────────
-- Per-scope (channel/platform) auto-approval confidence. Upsert on scope.
create table if not exists public.smart_confidence (
  scope         text primary key,             -- google|meta|tiktok|landing|email
  score         numeric default 0.5,
  samples       integer default 0,
  approvals     integer default 0,
  rejections    integer default 0,
  updated_at    timestamptz default now(),
  created_at    timestamptz default now()
);

-- ── 13. smart_library_scores ─────────────────────────────────────────────────
-- Threshold scoring of the own-campaign library. Upsert on campaign_id;
-- ordered by score desc.
create table if not exists public.smart_library_scores (
  campaign_id   text primary key,
  channel       text,
  market        text,
  score         numeric default 0,
  percentile    numeric,
  passed        boolean default false,
  reasons       jsonb default '{}'::jsonb,     -- {checks: [{name, actual, min, pass}]}
  scored_at     timestamptz default now(),
  created_at    timestamptz default now()
);
create index if not exists smart_library_scores_score_idx  on public.smart_library_scores (score desc);
create index if not exists smart_library_scores_passed_idx on public.smart_library_scores (passed);

-- ── 14. smart_agents ─────────────────────────────────────────────────────────
-- Voice/chat advisor agent definitions. Upsert on id; filtered active=true,
-- ordered by created_at asc.
create table if not exists public.smart_agents (
  id            text primary key,             -- agent_… / idFor('agent', …)
  level         text default 'collection',
  name          text not null,
  market        text default 'US',
  persona       jsonb default '{}'::jsonb,
  catalog_scope jsonb default '{}'::jsonb,
  greeting      text,
  voice         jsonb default '{}'::jsonb,
  active        boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists smart_agents_active_idx on public.smart_agents (active, created_at asc);

-- ── 15. smart_agent_knowledge ────────────────────────────────────────────────
-- Scraped/seeded product knowledge per agent. Upsert on id; filtered agent_id.
create table if not exists public.smart_agent_knowledge (
  id            text primary key,             -- idFor('ak', …)
  agent_id      text not null,
  source_url    text,
  title         text,
  content       text,
  facts         jsonb default '{}'::jsonb,     -- {sku, price, category, tags}
  fetched_at    timestamptz default now(),
  created_at    timestamptz default now()
);
create index if not exists smart_agent_knowledge_agent_idx on public.smart_agent_knowledge (agent_id);

-- ── 16. smart_agent_sessions ─────────────────────────────────────────────────
-- Conversation sessions. Upsert on id; filtered agent_id, ordered started_at desc.
create table if not exists public.smart_agent_sessions (
  id            text primary key,             -- idFor('sess', …)
  agent_id      text,                         -- may be 'team' for the internal copilot
  visitor_id    text,
  context       jsonb default '{}'::jsonb,
  started_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists smart_agent_sessions_agent_idx on public.smart_agent_sessions (agent_id, started_at desc);

-- ── 17. smart_agent_messages ─────────────────────────────────────────────────
-- Per-session chat transcript. Insert without id (append), best-effort.
create table if not exists public.smart_agent_messages (
  id            bigserial primary key,
  session_id    text not null,
  role          text not null,                -- user|agent
  content       text,
  meta          jsonb default '{}'::jsonb,     -- {provider, mode, …} / context
  created_at    timestamptz default now()
);
create index if not exists smart_agent_messages_session_idx on public.smart_agent_messages (session_id, created_at asc);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security — permissive allow-all per table (repo convention:
-- see 20260617_competitive_intel_and_brain.sql / 20260703_social_posts.sql).
-- The Smart Brain writes via the service role; policies stay open so the
-- linked-DB REST client (anon/service) can read+write like the other smart_*
-- tables. Applied idempotently to all 17 tables.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  tbls text[] := array[
    'smart_calendar', 'smart_calendar_reviews', 'smart_cohorts', 'smart_festivals',
    'smart_sales_history', 'smart_funnels', 'smart_generated_assets', 'smart_review_queue',
    'smart_competitor_signals', 'smart_brain_config', 'smart_recalibrations', 'smart_confidence',
    'smart_library_scores', 'smart_agents', 'smart_agent_knowledge', 'smart_agent_sessions',
    'smart_agent_messages'
  ];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "%s_read"  on public.%I;', t, t);
    execute format('drop policy if exists "%s_write" on public.%I;', t, t);
    execute format('drop policy if exists "%s_upd"   on public.%I;', t, t);
    execute format('drop policy if exists "%s_del"   on public.%I;', t, t);
    execute format('create policy "%s_read"  on public.%I for select using (true);', t, t);
    execute format('create policy "%s_write" on public.%I for insert with check (true);', t, t);
    execute format('create policy "%s_upd"   on public.%I for update using (true) with check (true);', t, t);
    execute format('create policy "%s_del"   on public.%I for delete using (true);', t, t);
  end loop;
end $$;
