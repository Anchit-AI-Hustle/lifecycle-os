-- ============================================================================
-- 20260813120000_workspace_connections.sql
-- Bring your own integrations and your own AI keys, per brand workspace.
--
-- Three tables, and the split between the first two is the whole security
-- design:
--
--   workspace_connections          WHICH platform a workspace has connected,
--                                  plus its NON-SECRET settings (store domain,
--                                  ad account id, API revision) and a four
--                                  character hint of the secret. Readable by
--                                  the workspace's members, writable by its
--                                  editors, exactly like every other brand
--                                  table in this schema.
--
--   workspace_connection_secrets   the secret material itself, encrypted with
--                                  AES-256-GCM before it ever leaves the
--                                  serverless runtime. RLS is enabled and there
--                                  is DELIBERATELY NO POLICY ON IT, so the anon
--                                  and authenticated roles can select nothing:
--                                  a stolen browser JWT reads the metadata and
--                                  gets an empty set here. Only the service
--                                  role reaches it, and only through
--                                  api/_shared/workspace-connections-core.js
--                                  after that module has verified the caller's
--                                  own JWT and their role on the workspace.
--                                  This mirrors credit_wallets in
--                                  20260809130000, where the balance is
--                                  likewise unreachable from the browser.
--
--   workspace_ai_routing           the model cascade this workspace wants, as
--                                  an ORDERED list of providers each carrying
--                                  its own ordered model list. Not a secret,
--                                  so it follows the normal member/editor
--                                  rules and the page can render it directly.
--
-- A workspace with no rows in any of these tables is not a special case: the
-- resolver returns no overrides and every generation runs on the platform's
-- default cascade exactly as it did before this migration.
--
-- Additive + idempotent, same conventions as the migrations before it.
-- ============================================================================

-- ── 1. Connections (metadata only, never a secret) ──────────────────────────
create table if not exists public.workspace_connections (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,

  -- Registry key from PROVIDERS in api/_shared/workspace-connections-core.js
  -- ('openai', 'klaviyo', 'meta_ads', ...). Text rather than an enum so adding
  -- a platform is a code change, not a migration.
  provider      text not null,
  category      text not null default 'other',    -- ai | commerce | ads | lifecycle | other
  auth_kind     text not null default 'api_key',  -- api_key | account_token | push | manual

  label         text,                             -- what the user calls this connection

  -- NON-SECRET settings only. The core refuses to write a field the registry
  -- marks secret into this column, so a key can never arrive here by accident.
  config        jsonb not null default '{}'::jsonb,

  -- Which secret fields are actually set, and the last four characters of the
  -- primary one. Enough to show "configured, ending 4f2a" and nothing more.
  secret_fields text[] not null default '{}',
  secret_hint   text,

  status        text not null default 'active',   -- active | disabled
  last_checked_at timestamptz,
  last_check_ok   boolean,
  last_check_note text,

  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (workspace_id, provider)
);

create index if not exists workspace_connections_ws_idx
  on public.workspace_connections (workspace_id, category);

alter table public.workspace_connections enable row level security;

do $$ begin
  create policy "connections readable by members" on public.workspace_connections
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "connections written by editors" on public.workspace_connections
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 2. Secrets (encrypted, service role only) ───────────────────────────────
create table if not exists public.workspace_connection_secrets (
  connection_id uuid primary key references public.workspace_connections(id) on delete cascade,
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,

  alg           text not null default 'aes-256-gcm',
  -- Base64. The plaintext is a JSON object of { field: value } so one row can
  -- carry a platform that needs several secrets (Google Ads needs four).
  iv            text not null,
  tag           text not null,
  ciphertext    text not null,
  -- Fingerprint of the CONNECTION_SECRET_KEY that encrypted this row. After a
  -- key rotation the fingerprint no longer matches and the core reports the
  -- secret as unreadable and asks for it again, rather than failing a
  -- generation with an opaque decrypt error.
  key_id        text not null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.workspace_connection_secrets enable row level security;

-- NO POLICY, ON PURPOSE. With RLS on and no policy, select/insert/update/delete
-- all return nothing for anon and authenticated. The grants below make the same
-- statement at the privilege level, so removing the RLS flag by accident does
-- not silently expose the table.
do $$ begin
  execute 'revoke all on table public.workspace_connection_secrets from anon, authenticated';
exception when others then null; end $$;

-- ── 3. AI routing (the workspace's own cascade) ─────────────────────────────
create table if not exists public.workspace_ai_routing (
  workspace_id uuid primary key references public.brand_workspaces(id) on delete cascade,

  -- Ordered, and the order IS the priority:
  --   [{ "provider":"anthropic", "models":["claude-opus-4-8"], "enabled":true },
  --    { "provider":"openai",    "models":["gpt-5-mini"],      "enabled":true }]
  -- Providers are tried top to bottom; within one provider its models are tried
  -- in the order listed. That is precisely how api/_shared/llm.js cascades, so
  -- what the page shows is what the engine does.
  entries      jsonb not null default '[]'::jsonb,

  -- After the chosen providers are exhausted, may the platform's own remaining
  -- providers finish the job? True keeps a workspace generating when its own
  -- provider is rate limited; false means the workspace has decided its data
  -- goes only to the providers it named.
  use_platform_fallback boolean not null default true,

  updated_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now()
);

alter table public.workspace_ai_routing enable row level security;

do $$ begin
  create policy "ai routing readable by members" on public.workspace_ai_routing
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "ai routing written by editors" on public.workspace_ai_routing
    for all
    using (public.is_brand_editor(workspace_id, auth.uid()))
    with check (public.is_brand_editor(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- ── 4. updated_at touch ─────────────────────────────────────────────────────
create or replace function public.touch_workspace_connection()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$ begin
  create trigger workspace_connections_touch
    before update on public.workspace_connections
    for each row execute function public.touch_workspace_connection();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger workspace_connection_secrets_touch
    before update on public.workspace_connection_secrets
    for each row execute function public.touch_workspace_connection();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger workspace_ai_routing_touch
    before update on public.workspace_ai_routing
    for each row execute function public.touch_workspace_connection();
exception when duplicate_object then null; end $$;

comment on table public.workspace_connections is
  'One row per (brand workspace, platform). Non-secret settings and a four character hint only. Members read, editors write.';
comment on table public.workspace_connection_secrets is
  'AES-256-GCM ciphertext of a connection''s secrets. RLS on with no policy and no grants to anon/authenticated: reachable only by the service role, through workspace-connections-core.js, after that module has verified the caller''s JWT and workspace role.';
comment on table public.workspace_ai_routing is
  'The workspace''s own provider and model priority. Order is priority. Empty or absent means the platform default cascade in api/_shared/llm.js.';
