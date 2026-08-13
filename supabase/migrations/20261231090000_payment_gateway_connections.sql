-- ============================================================================
-- 20261231090000_payment_gateway_connections.sql
-- Payment gateway connections, one per brand workspace.
--
-- TIMESTAMP NOTE: this file is deliberately stamped far ahead of the current
-- migration head (the newest sibling is 20260810160000) because it was authored
-- in parallel with other work that is also adding migrations. A far-future
-- stamp cannot collide with a filename another branch picks today, and Supabase
-- applies migrations in lexical order, so it simply runs last.
--
-- WHY A DEDICATED TABLE RATHER THAN brand_workspaces.brand_data. A gateway
-- connection holds live credentials for moving real money. It needs a different
-- privilege model from ordinary brand fields: members may see THAT a gateway is
-- connected and which account it points at, and no browser session may ever
-- read the credential itself. Postgres can express that only at the column
-- level, which means its own table.
--
-- THE SECURITY MODEL, in three layers:
--   1. RLS scopes every row to the workspace's members (public.is_brand_member,
--      defined in 20260809120000_brand_workspaces.sql). One brand can never see
--      another brand's connection.
--   2. Column-level grants keep the *_enc credential columns out of reach of
--      the anon and authenticated roles entirely, so a hand-written PostgREST
--      call from a browser cannot select them even as a workspace member.
--      Only service_role, which lives on the server, can read them.
--   3. The values in those columns are AES-256-GCM ciphertext keyed by
--      PAYMENTS_ENCRYPTION_KEY, which is held in the serverless environment and
--      never in the database. A database dump alone therefore yields nothing
--      usable.
-- ============================================================================

-- ── 1. payment_gateway_connections ──────────────────────────────────────────
create table if not exists public.payment_gateway_connections (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.brand_workspaces(id) on delete cascade,

  -- Registry key from api/_shared/payments-core.js GATEWAYS.
  gateway        text not null,                      -- stripe | razorpay | paypal | shopify_payments
  -- How this particular connection was established. The same gateway can be
  -- reachable two ways (Razorpay is OAuth for approved partners and API key for
  -- everyone else), and the disconnect path differs, so it is recorded per row.
  connect_kind   text not null default 'oauth',      -- oauth | api_key | partner_referral
  status         text not null default 'pending',    -- pending | connected | revoked | error

  -- Merchant-side identity. Safe to show: it is the account the operator just
  -- signed into, and they need to see it to confirm they picked the right one.
  account_id     text,                               -- acct_… / merchant id / shop domain
  account_label  text,
  livemode       boolean,
  scope          text,

  -- ── Credentials. Ciphertext only. See the column grants at the bottom. ──
  access_token_enc   text,
  refresh_token_enc  text,
  secret_enc         text,                           -- api-key gateways: the key secret
  webhook_secret_enc text,

  -- Safe metadata about the credential, so the UI can be specific without
  -- holding anything usable. masked_hint is a last-four fragment, never a
  -- prefix: a prefix of a Stripe key identifies the key type and environment,
  -- and there is no reason to publish that.
  token_expires_at timestamptz,
  masked_hint      text,

  connected_by   uuid,
  connected_at   timestamptz,
  last_checked_at timestamptz,
  last_error     text,

  -- Non-secret provider detail: publishable key, webhook registration ids,
  -- partner referral id, the products the merchant granted.
  meta           jsonb not null default '{}'::jsonb,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One live connection per gateway per brand. Reconnecting updates in place so
  -- the history of which account was linked does not fragment across rows.
  unique (workspace_id, gateway)
);

alter table public.payment_gateway_connections enable row level security;

create index if not exists pay_conn_ws_idx     on public.payment_gateway_connections (workspace_id);
create index if not exists pay_conn_status_idx on public.payment_gateway_connections (workspace_id, status);

-- ── 2. payment_oauth_states ─────────────────────────────────────────────────
-- The OAuth `state` parameter, held server-side between the redirect out and
-- the redirect back.
--
-- This is not only CSRF protection. It is the binding that decides WHICH
-- workspace a returning authorization code is allowed to land in. Without it,
-- anyone who obtained a code could post it back and have another brand's
-- merchant account attached to their own workspace. The row records both the
-- workspace and the user who started the flow, and the callback refuses unless
-- the returning caller matches both.
create table if not exists public.payment_oauth_states (
  state        text primary key,
  workspace_id uuid not null references public.brand_workspaces(id) on delete cascade,
  gateway      text not null,
  user_id      uuid not null,
  redirect_uri text,
  -- Provider-specific context the callback needs and must not take from the
  -- query string, where the caller controls it (the Shopify shop domain).
  context      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '15 minutes'),
  consumed_at  timestamptz
);

alter table public.payment_oauth_states enable row level security;

create index if not exists pay_state_ws_idx  on public.payment_oauth_states (workspace_id);
create index if not exists pay_state_exp_idx on public.payment_oauth_states (expires_at);

-- ── 3. Policies ─────────────────────────────────────────────────────────────
-- Reads are open to workspace members; the column grants below are what keep
-- the credential columns out of a member's reach.
do $$ begin
  create policy "payment connection readable by members" on public.payment_gateway_connections
    for select using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "payment connection written by members" on public.payment_gateway_connections
    for insert with check (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "payment connection updated by members" on public.payment_gateway_connections
    for update using (public.is_brand_member(workspace_id, auth.uid()))
    with check (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "payment connection deleted by members" on public.payment_gateway_connections
    for delete using (public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

-- A pending OAuth state belongs to the person who started the flow. Even a
-- fellow workspace member has no reason to read or complete someone else's
-- in-flight authorization, so this one is scoped to the user, not the brand.
do $$ begin
  create policy "oauth state readable by owner" on public.payment_oauth_states
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "oauth state written by member" on public.payment_oauth_states
    for insert with check (user_id = auth.uid() and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "oauth state consumed by owner" on public.payment_oauth_states
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "oauth state deleted by owner" on public.payment_oauth_states
    for delete using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- ── 4. Column-level grants: credentials are server-only ─────────────────────
-- Supabase grants new tables to anon and authenticated by default, so the
-- revoke has to come first. Everything re-granted below is deliberately
-- non-secret; the four *_enc columns are absent from every grant, which means
-- PostgREST rejects any select that names them for those roles. service_role
-- bypasses this and is only ever used from the serverless functions.
revoke all on public.payment_gateway_connections from anon, authenticated;
revoke all on public.payment_oauth_states from anon, authenticated;

grant select (
  id, workspace_id, gateway, connect_kind, status, account_id, account_label,
  livemode, scope, token_expires_at, masked_hint, connected_by, connected_at,
  last_checked_at, last_error, meta, created_at, updated_at
) on public.payment_gateway_connections to authenticated;

grant insert (
  workspace_id, gateway, connect_kind, status, account_id, account_label,
  livemode, scope, masked_hint, connected_by, connected_at, meta
) on public.payment_gateway_connections to authenticated;

grant update (
  status, account_label, last_checked_at, last_error, meta, updated_at
) on public.payment_gateway_connections to authenticated;

grant delete on public.payment_gateway_connections to authenticated;

-- States carry no credential, so the whole row is grantable. They are still
-- RLS-scoped to the user who created them.
grant select, insert, update, delete on public.payment_oauth_states to authenticated;

-- ── 5. Housekeeping ─────────────────────────────────────────────────────────
-- Expired states are dead weight and a small liability: each one names a
-- workspace and a user. Callers sweep opportunistically; this function is here
-- so a scheduled job can do it properly once one exists.
create or replace function public.purge_expired_payment_oauth_states()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare removed integer;
begin
  delete from public.payment_oauth_states
   where expires_at < now() - interval '1 hour';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_payment_oauth_states() from anon, authenticated;
