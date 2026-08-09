-- ============================================================================
-- 20260809130000_credits.sql
-- Platform credit system — every feature in the app costs credits.
--
-- Model:
--   * ONE wallet per (user, brand workspace). Credits are spent by the signed-in
--     user against the brand they are working on, so per-brand cost is visible.
--   * The wallet balance is DERIVED state; `credit_ledger` is the append-only
--     truth. Every movement (grant, top-up, hold, spend, refund, expiry) is a
--     row carrying the feature it belongs to and the balance after it.
--   * Spending is a two-phase hold -> settle so a feature that fails mid-run
--     never silently burns credits:
--        credit_hold(...)   reserves and debits available balance
--        credit_settle(...) charges the real amount, releasing any difference
--        credit_release(...) returns the whole hold on failure
--   * All three are SECURITY DEFINER plpgsql functions that take a row lock, so
--     two concurrent runs can never overdraw. The client can NEVER write to
--     credit_wallets or credit_ledger directly (no insert/update policy) —
--     balance only ever moves through these functions.
--
-- Real-time: credit_wallets is added to the `supabase_realtime` publication, so
-- the browser subscribes to its own wallet row and the balance in the header
-- updates the instant a run debits it.
-- ============================================================================

-- ── 1. Wallets ──────────────────────────────────────────────────────────────
create table if not exists public.credit_wallets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  workspace_id  uuid references public.brand_workspaces(id) on delete cascade,
  balance       bigint not null default 0 check (balance >= 0),
  held          bigint not null default 0 check (held >= 0),
  lifetime_granted bigint not null default 0,
  lifetime_spent   bigint not null default 0,
  low_balance_threshold bigint not null default 100,
  currency      text not null default 'CREDITS',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One wallet per user per workspace. `workspace_id IS NULL` = the user's
-- personal wallet (used before any brand is onboarded), so a partial unique
-- index is needed for each case.
create unique index if not exists credit_wallets_user_ws_idx
  on public.credit_wallets (user_id, workspace_id) where workspace_id is not null;
create unique index if not exists credit_wallets_user_personal_idx
  on public.credit_wallets (user_id) where workspace_id is null;

alter table public.credit_wallets enable row level security;

do $$ begin
  create policy "wallet readable by owner" on public.credit_wallets
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
-- Deliberately NO insert/update/delete policy: balance moves only via the
-- SECURITY DEFINER functions below.

-- ── 2. Append-only ledger ───────────────────────────────────────────────────
create table if not exists public.credit_ledger (
  id            bigserial primary key,
  wallet_id     uuid not null references public.credit_wallets(id) on delete cascade,
  user_id       uuid not null,
  workspace_id  uuid,
  kind          text not null,         -- grant | topup | hold | spend | refund | release | adjust | expiry
  feature_key   text,                  -- e.g. 'mailer.generate', 'telesuite.call_scoring'
  feature_label text,
  units         numeric,               -- how many billable units this covered
  unit_label    text,                  -- 'per mailer', 'per minute of audio', ...
  delta         bigint not null,       -- signed change to available balance
  balance_after bigint not null,
  hold_id       uuid,                  -- links hold -> settle/release
  ref           text,                  -- run id / order id / campaign id
  note          text,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

alter table public.credit_ledger enable row level security;

do $$ begin
  create policy "ledger readable by owner" on public.credit_ledger
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- The welcome grant must land exactly once per wallet even if two tabs (or two
-- API calls) touch a brand-new wallet at the same instant. The application
-- pre-check is racy by nature, so THIS index is the real guard: the loser of
-- the race gets a unique violation, which credits-core treats as "already
-- granted" rather than granting a second time.
create unique index if not exists credit_ledger_welcome_once_idx
  on public.credit_ledger (wallet_id) where ref = 'welcome' and kind = 'grant';

create index if not exists credit_ledger_wallet_idx  on public.credit_ledger (wallet_id, created_at desc);
create index if not exists credit_ledger_feature_idx on public.credit_ledger (user_id, feature_key);
create index if not exists credit_ledger_hold_idx    on public.credit_ledger (hold_id) where hold_id is not null;

-- ── 3. Price overrides (the code catalog is the default) ────────────────────
-- api/_shared/credit-catalog.js is the versioned source of truth for what each
-- feature costs. This table only exists so an operator can override a price
-- without a deploy. A missing row simply means "use the catalog price".
create table if not exists public.credit_prices (
  feature_key text primary key,
  cost        bigint not null check (cost >= 0),
  unit_label  text,
  note        text,
  updated_at  timestamptz not null default now()
);

alter table public.credit_prices enable row level security;

do $$ begin
  create policy "prices readable by all signed-in" on public.credit_prices
    for select using (auth.uid() is not null);
exception when duplicate_object then null; end $$;

-- ── 4. Recharge orders ──────────────────────────────────────────────────────
-- A top-up is only credited when an order reaches status='paid'. Nothing here
-- takes a payment: `provider` + `provider_ref` record whichever processor the
-- operator wires up, and `credit_grant()` is what actually moves the balance.
create table if not exists public.credit_orders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid(),
  workspace_id uuid references public.brand_workspaces(id) on delete set null,
  pack_key     text not null,
  credits      bigint not null check (credits > 0),
  amount_minor bigint,                 -- price in the smallest currency unit
  currency     text,
  status       text not null default 'pending',  -- pending | paid | failed | cancelled
  provider     text,
  provider_ref text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.credit_orders enable row level security;

do $$ begin
  create policy "orders readable by owner" on public.credit_orders
    for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "orders created by owner" on public.credit_orders
    for insert with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
-- Status transitions are made server-side with the service role, never by the
-- browser: a client cannot mark its own order paid.

create index if not exists credit_orders_user_idx on public.credit_orders (user_id, created_at desc);

-- ── 5. Wallet resolution ────────────────────────────────────────────────────
create or replace function public.credit_wallet_id(p_user uuid, p_workspace uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_user is null then raise exception 'user required'; end if;

  if p_workspace is null then
    select id into v_id from public.credit_wallets where user_id = p_user and workspace_id is null;
  else
    select id into v_id from public.credit_wallets where user_id = p_user and workspace_id = p_workspace;
  end if;

  if v_id is not null then return v_id; end if;

  insert into public.credit_wallets (user_id, workspace_id)
  values (p_user, p_workspace)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    if p_workspace is null then
      select id into v_id from public.credit_wallets where user_id = p_user and workspace_id is null;
    else
      select id into v_id from public.credit_wallets where user_id = p_user and workspace_id = p_workspace;
    end if;
  end if;
  return v_id;
end $$;

-- ── 6. Grant / top-up ───────────────────────────────────────────────────────
create or replace function public.credit_grant(
  p_user uuid, p_workspace uuid, p_amount bigint,
  p_kind text default 'grant', p_ref text default null,
  p_note text default null, p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_wallet uuid; v_balance bigint;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  v_wallet := public.credit_wallet_id(p_user, p_workspace);

  update public.credit_wallets
     set balance = balance + p_amount,
         lifetime_granted = lifetime_granted + p_amount,
         updated_at = now()
   where id = v_wallet
  returning balance into v_balance;

  insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, delta, balance_after, ref, note, meta)
  values (v_wallet, p_user, p_workspace, coalesce(p_kind, 'grant'), p_amount, v_balance, p_ref, p_note, coalesce(p_meta, '{}'::jsonb));

  return jsonb_build_object('ok', true, 'wallet_id', v_wallet, 'balance', v_balance, 'granted', p_amount);
end $$;

-- ── 7. Hold (reserve before running a feature) ──────────────────────────────
create or replace function public.credit_hold(
  p_user uuid, p_workspace uuid, p_amount bigint,
  p_feature text, p_label text default null, p_unit_label text default null,
  p_units numeric default 1, p_ref text default null, p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_wallet uuid; v_balance bigint; v_hold uuid := gen_random_uuid();
begin
  if p_amount is null or p_amount < 0 then raise exception 'amount must be >= 0'; end if;
  v_wallet := public.credit_wallet_id(p_user, p_workspace);

  -- Lock the wallet row so two concurrent runs cannot both pass the check.
  select balance into v_balance from public.credit_wallets where id = v_wallet for update;

  if v_balance < p_amount then
    return jsonb_build_object(
      'ok', false, 'error', 'insufficient_credits',
      'balance', v_balance, 'required', p_amount, 'short_by', p_amount - v_balance,
      'feature_key', p_feature, 'wallet_id', v_wallet);
  end if;

  update public.credit_wallets
     set balance = balance - p_amount, held = held + p_amount, updated_at = now()
   where id = v_wallet
  returning balance into v_balance;

  insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, feature_key, feature_label, units, unit_label, delta, balance_after, hold_id, ref, meta)
  values (v_wallet, p_user, p_workspace, 'hold', p_feature, p_label, p_units, p_unit_label, -p_amount, v_balance, v_hold, p_ref, coalesce(p_meta, '{}'::jsonb));

  return jsonb_build_object('ok', true, 'hold_id', v_hold, 'wallet_id', v_wallet, 'balance', v_balance, 'held', p_amount);
end $$;

-- ── 8. Settle (charge the real amount, return the rest) ─────────────────────
create or replace function public.credit_settle(
  p_hold uuid, p_actual bigint default null,
  p_units numeric default null, p_ref text default null, p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h record; v_wallet uuid; v_balance bigint; v_held bigint; v_actual bigint; v_refund bigint;
begin
  select * into h from public.credit_ledger where hold_id = p_hold and kind = 'hold' limit 1;
  if h is null then raise exception 'unknown hold %', p_hold; end if;
  if exists (select 1 from public.credit_ledger where hold_id = p_hold and kind in ('spend','release')) then
    raise exception 'hold % already settled', p_hold;
  end if;

  v_wallet := h.wallet_id;
  v_held := -h.delta;
  v_actual := greatest(0, least(coalesce(p_actual, v_held), v_held));  -- never charge more than reserved
  v_refund := v_held - v_actual;

  update public.credit_wallets
     set held = held - v_held,
         balance = balance + v_refund,
         lifetime_spent = lifetime_spent + v_actual,
         updated_at = now()
   where id = v_wallet
  returning balance into v_balance;

  insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, feature_key, feature_label, units, unit_label, delta, balance_after, hold_id, ref, meta)
  values (v_wallet, h.user_id, h.workspace_id, 'spend', h.feature_key, h.feature_label,
          coalesce(p_units, h.units), h.unit_label, 0, v_balance, p_hold, coalesce(p_ref, h.ref), coalesce(p_meta, '{}'::jsonb));

  if v_refund > 0 then
    insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, feature_key, feature_label, delta, balance_after, hold_id, ref, note)
    values (v_wallet, h.user_id, h.workspace_id, 'refund', h.feature_key, h.feature_label, v_refund, v_balance, p_hold, coalesce(p_ref, h.ref), 'unused portion of the reservation');
  end if;

  return jsonb_build_object('ok', true, 'charged', v_actual, 'refunded', v_refund, 'balance', v_balance, 'wallet_id', v_wallet);
end $$;

-- ── 9. Release (feature failed — give it all back) ──────────────────────────
create or replace function public.credit_release(p_hold uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare h record; v_balance bigint; v_held bigint;
begin
  select * into h from public.credit_ledger where hold_id = p_hold and kind = 'hold' limit 1;
  if h is null then raise exception 'unknown hold %', p_hold; end if;
  if exists (select 1 from public.credit_ledger where hold_id = p_hold and kind in ('spend','release')) then
    return jsonb_build_object('ok', true, 'already_settled', true);
  end if;

  v_held := -h.delta;
  update public.credit_wallets
     set held = held - v_held, balance = balance + v_held, updated_at = now()
   where id = h.wallet_id
  returning balance into v_balance;

  insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, feature_key, feature_label, delta, balance_after, hold_id, ref, note)
  values (h.wallet_id, h.user_id, h.workspace_id, 'release', h.feature_key, h.feature_label, v_held, v_balance, p_hold, h.ref, coalesce(p_note, 'run failed — reservation returned'));

  return jsonb_build_object('ok', true, 'released', v_held, 'balance', v_balance);
end $$;

-- ── 10. Usage rollup (what the wallet page charts) ──────────────────────────
create or replace function public.credit_usage(p_user uuid, p_workspace uuid default null, p_days int default 30)
returns table (feature_key text, feature_label text, runs bigint, credits bigint, last_used timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select l.feature_key,
         max(l.feature_label) as feature_label,
         count(*) filter (where l.kind = 'spend') as runs,
         coalesce(-sum(l.delta) filter (where l.kind = 'hold'), 0)
           - coalesce(sum(l.delta) filter (where l.kind in ('refund','release')), 0) as credits,
         max(l.created_at) as last_used
    from public.credit_ledger l
   where l.user_id = p_user
     and (p_workspace is null or l.workspace_id = p_workspace)
     and l.feature_key is not null
     and l.created_at >= now() - make_interval(days => greatest(1, p_days))
   group by l.feature_key
   order by credits desc;
$$;

-- ── 11. Lock the money functions to the server ──────────────────────────────
-- These are SECURITY DEFINER, so anyone allowed to EXECUTE them bypasses RLS.
-- A signed-in browser must never be able to call credit_grant() and top itself
-- up, or call credit_settle() to zero out a charge. Only the service role (used
-- by api/_shared/credits-core.js, after it has verified the caller's JWT) may
-- execute them. credit_usage() is locked down too: it is SECURITY DEFINER and
-- takes p_user as an argument, so leaving it open would let any signed-in user
-- read another user's spending by passing their id. The server calls it with
-- the service role after verifying whose wallet is being asked about.
do $$
declare fn text;
begin
  foreach fn in array array[
    'credit_wallet_id(uuid,uuid)',
    'credit_grant(uuid,uuid,bigint,text,text,text,jsonb)',
    'credit_hold(uuid,uuid,bigint,text,text,text,numeric,text,jsonb)',
    'credit_settle(uuid,bigint,numeric,text,jsonb)',
    'credit_release(uuid,text)',
    'credit_usage(uuid,uuid,int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

-- ── 12. Real-time: let the browser watch its own wallet row ─────────────────
do $$ begin
  alter publication supabase_realtime add table public.credit_wallets;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.credit_ledger;
exception when duplicate_object then null; when undefined_object then null; end $$;

comment on table public.credit_wallets is
  'Derived balance per (user, brand workspace). Only the credit_* SECURITY DEFINER functions may move it; there is no client insert/update policy. Published to supabase_realtime so the app header updates the instant a feature debits.';
comment on table public.credit_ledger is
  'Append-only truth for every credit movement, tagged with the feature that caused it. hold -> spend/release pairs are linked by hold_id so a failed run is always refunded.';
