-- ============================================================================
-- 20261101120000_brand_ad_history.sql
--
-- The brand's OWN paid-ad history (api/_shared/ad-history.js): the ads in its
-- connected ad accounts, with the creative copy and the per-ad metrics the
-- platform returned over the import window. It becomes evidence for the
-- writer (creative-evidence.js: the brand's own ads above / below its own
-- median click-through rate).
--
--   brand_ad_history        one row per ad per platform per brand. A re-import
--                           UPSERTS on (workspace_id, provider, ad_id): first_seen
--                           stays, last_seen and the metrics move. A metric the
--                           platform did not return is null inside `metrics`,
--                           never zero.
--   brand_ad_history_runs   one row per import: which account, the window, how
--                           many ads, whether the read was complete, and why not.
--
-- No credential is stored here; tokens stay in workspace_connection_secrets.
-- Members read through RLS (is_brand_member); only the service role writes,
-- after the module has checked that the caller is the owner or an editor.
-- anon gets nothing.
--
-- Additive + idempotent, same conventions as the migrations before it.
-- ============================================================================

create table if not exists public.brand_ad_history (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.brand_workspaces(id) on delete cascade,
  provider          text not null,                         -- meta | google_ads
  account_id        text not null,
  ad_id             text not null,
  name              text,
  status            text,
  started_at        timestamptz,                           -- the platform's created / start time, as returned
  primary_text      text,
  headline          text,
  description       text,
  image_url         text,
  video_url         text,
  video_id          text,
  landing_url       text,
  cta               text,
  currency          text,
  metrics           jsonb not null default '{}'::jsonb,    -- spend, impressions, clicks, ctr (ratio), conversions, cost_per_result, roas
  window_start      date,
  window_end        date,
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),
  imported_at       timestamptz not null default now(),
  imported_by       uuid
);

create unique index if not exists brand_ad_history_ad_key
  on public.brand_ad_history (workspace_id, provider, ad_id);
create index if not exists brand_ad_history_ws_idx
  on public.brand_ad_history (workspace_id, provider, last_seen desc);

create table if not exists public.brand_ad_history_runs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.brand_workspaces(id) on delete cascade,
  provider          text not null,
  account_id        text,
  window_start      date,
  window_end        date,
  ads               integer not null default 0,
  with_metrics      integer not null default 0,
  complete          boolean not null default true,
  ok                boolean not null default true,
  note              text,
  source            text not null default 'manual',        -- manual | cron
  ran_by            uuid,
  ran_at            timestamptz not null default now()
);

create index if not exists brand_ad_history_runs_ws_idx
  on public.brand_ad_history_runs (workspace_id, provider, ran_at desc);

alter table public.brand_ad_history enable row level security;
alter table public.brand_ad_history_runs enable row level security;

do $$ begin
  create policy "brand ad history readable by members" on public.brand_ad_history
    for select to authenticated using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "brand ad history runs readable by members" on public.brand_ad_history_runs
    for select to authenticated using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$
declare t text;
begin
  foreach t in array array['brand_ad_history', 'brand_ad_history_runs'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
