-- ─────────────────────────────────────────────────────────────────────────────
-- Phone accounts live in Supabase Auth (2026-09-29).
--
-- A mobile number + 4-digit PIN account is a real auth.users row. It is created
-- by api/_shared/mobile-auth-supabase.js through GoTrue's admin endpoint
-- (POST /auth/v1/admin/users, service role) and signed in through GoTrue's
-- password grant (POST /auth/v1/token?grant_type=password). GoTrue holds the
-- identity, the session and the password hash. The password is NOT the PIN:
-- GoTrue's minimum password length is 6, and a 4-digit PIN would be ten
-- thousand guesses from anyone holding the public anon key. The server derives
-- it as HMAC-SHA256(MOBILE_PIN_PEPPER, phone | PIN), so it can only be produced
-- by the server, and only after the checks below.
--
-- This migration holds what GoTrue does not:
--
--   mobile_pin_accounts    one row per E.164 number: the auth user it belongs
--                          to, the name typed at sign-up, and the LOCKOUT
--                          (pin_tries, locked_until). No PIN, no hash of one.
--   mobile_pin_rate_limits the per-address budget on sign-in attempts, keyed
--                          by a SHA-256 of the address, never the address.
--
-- and the functions the server calls over PostgREST RPC. The lockout is decided
-- IN ONE STATEMENT, before the server makes any call to GoTrue:
-- mobile_pin_attempt() RESERVES a try (pin_tries + 1, and the lock itself when
-- that reaches the maximum) and answers whether the attempt may go ahead. Five
-- wrong PINs sent at once therefore reserve five tries and the sixth is refused
-- before it is checked at all: the count is the number of guesses EVALUATED,
-- not the number that happened to finish first. A right PIN clears the count
-- (mobile_pin_settle 'ok'); a try that never reached a verdict because the
-- auth service did not answer is handed back (mobile_pin_settle 'void'), so an
-- outage cannot lock a person out.
--
-- SECURITY: RLS on and NO policy, and every privilege revoked from anon and
-- authenticated, on both tables and every function. The functions are
-- SECURITY DEFINER (owner bypasses RLS, so they also work where service_role
-- lacks BYPASSRLS, as on a managed Postgres in self-host external mode) with an
-- empty search_path, and only service_role may execute them - the same
-- posture as the credit ledger in 20260809130000_credits.sql. A browser cannot
-- read who has an account, reset its own tries or unlock a number.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.mobile_pin_accounts (
  phone         text primary key,
  user_id       uuid unique references auth.users (id) on delete cascade,
  name          text not null,
  pin_tries     integer not null default 0,
  locked_until  timestamptz,
  -- null = an operator cleared it (the reset path): the next sign-in on this
  -- number chooses a new PIN. There is no SMS to fall back on.
  pin_set_at    timestamptz,
  -- when this number was claimed for a sign-up in progress (user_id still null)
  claimed_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint mobile_pin_accounts_phone_e164 check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint mobile_pin_accounts_name_len check (char_length(name) between 1 and 60),
  constraint mobile_pin_accounts_tries_nonneg check (pin_tries >= 0)
);

comment on table public.mobile_pin_accounts is
  'One row per mobile-number account: the auth.users row it belongs to, the name typed at sign-up, and the PIN lockout. Holds no PIN and no hash of one (GoTrue holds the password hash). RLS on, no policy, no grants to anon/authenticated: reachable only through the mobile_pin_* functions, as service_role.';

create table if not exists public.mobile_pin_rate_limits (
  bucket        text not null,
  k             text not null,            -- SHA-256 of the caller's address, never the address
  window_start  timestamptz not null default now(),
  n             integer not null default 0,
  primary key (bucket, k)
);

comment on table public.mobile_pin_rate_limits is
  'Fixed-window budget on sign-in attempts per caller address (hashed). Counted in the database so it holds across every serverless instance. RLS on, no policy, service_role only.';

alter table public.mobile_pin_accounts enable row level security;
alter table public.mobile_pin_rate_limits enable row level security;

-- NO POLICY, ON PURPOSE (see the header). The revokes make the same statement
-- at the privilege level, so a dropped RLS flag does not expose either table.
revoke all on table public.mobile_pin_accounts from anon, authenticated;
revoke all on table public.mobile_pin_rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.mobile_pin_accounts to service_role;
grant select, insert, update, delete on table public.mobile_pin_rate_limits to service_role;

-- ── the per-address budget ──────────────────────────────────────────────────
-- One statement: counts this call and answers whether it is within the budget.
create or replace function public.mobile_pin_rate_hit(
  p_bucket text, p_key text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  -- Old windows are pruned as a side effect, so the table stays one day deep
  -- on a deployment nobody runs a cron against.
  delete from public.mobile_pin_rate_limits where window_start < now() - interval '1 day';
  insert into public.mobile_pin_rate_limits as r (bucket, k, window_start, n)
  values (p_bucket, p_key, now(), 1)
  on conflict (bucket, k) do update set
    n = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.n + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning r.n into v_n;
  return v_n <= p_limit;
end $$;

-- ── is this number known, and in what state ─────────────────────────────────
create or replace function public.mobile_pin_account(p_phone text, p_stale_seconds integer default 120)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
        'exists', true,
        'pending', a.user_id is null,
        'stale', a.user_id is null and a.claimed_at < now() - make_interval(secs => p_stale_seconds),
        'user_id', a.user_id,
        'name', a.name,
        'pin_tries', a.pin_tries,
        'locked_until', a.locked_until,
        'locked', a.locked_until is not null and a.locked_until > now(),
        'pin_set', a.pin_set_at is not null)
       from public.mobile_pin_accounts a
      where a.phone = p_phone),
    jsonb_build_object('exists', false));
$$;

-- ── claim a number for a sign-up ────────────────────────────────────────────
-- The FIRST caller for a new number gets claimed:true and goes on to create the
-- auth user; any other caller gets claimed:false and is a SIGN-IN, held to the
-- PIN check. A claim whose sign-up never finished (user_id still null after
-- p_stale_seconds - the function that held it died) can be taken over.
create or replace function public.mobile_pin_claim(p_phone text, p_name text, p_stale_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_claimed boolean;
begin
  insert into public.mobile_pin_accounts as a (phone, name)
  values (p_phone, p_name)
  on conflict (phone) do update
     set name = excluded.name, claimed_at = now(), updated_at = now(), pin_tries = 0, locked_until = null
   where a.user_id is null
     and a.claimed_at < now() - make_interval(secs => p_stale_seconds)
  returning true into v_claimed;
  return jsonb_build_object('claimed', coalesce(v_claimed, false));
end $$;

-- ── bind the claimed number to its auth user (sign-up done, or a PIN reset) ─
create or replace function public.mobile_pin_bind(p_phone text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.mobile_pin_accounts%rowtype;
begin
  update public.mobile_pin_accounts
     set user_id = p_user_id, pin_set_at = now(), pin_tries = 0, locked_until = null, updated_at = now()
   where phone = p_phone
     and (user_id is null or user_id = p_user_id)
  returning * into v_row;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_claimed');
  end if;
  return jsonb_build_object('ok', true, 'user_id', v_row.user_id, 'name', v_row.name);
end $$;

-- ── give a claim back (the auth user could not be created) ──────────────────
create or replace function public.mobile_pin_unclaim(p_phone text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.mobile_pin_accounts where phone = p_phone and user_id is null;
  return found;
end $$;

-- ── reserve one PIN attempt, atomically, BEFORE the PIN is checked ──────────
-- One UPDATE under the row lock: it counts the try and, when the count reaches
-- p_max, sets the lock in the same statement. A concurrent caller waits on the
-- row lock, re-reads the row the first one wrote, and is refused if that locked
-- it. An expired lock starts a fresh count. A number still being set up
-- (user_id null) is never attempted.
create or replace function public.mobile_pin_attempt(p_phone text, p_max integer, p_lock_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.mobile_pin_accounts%rowtype;
begin
  update public.mobile_pin_accounts a
     set pin_tries = case when a.locked_until is not null and a.locked_until <= now() then 1 else a.pin_tries + 1 end,
         locked_until = case
           when (case when a.locked_until is not null and a.locked_until <= now() then 1 else a.pin_tries + 1 end) >= p_max
             then now() + make_interval(secs => p_lock_seconds)
           when a.locked_until is not null and a.locked_until <= now() then null
           else a.locked_until
         end,
         updated_at = now()
   where a.phone = p_phone
     and a.user_id is not null
     and (a.locked_until is null or a.locked_until <= now())
  returning a.* into v_row;
  if found then
    return jsonb_build_object('allowed', true, 'tries', v_row.pin_tries, 'locked_until', v_row.locked_until,
                              'user_id', v_row.user_id, 'last', v_row.pin_tries >= p_max);
  end if;
  select * into v_row from public.mobile_pin_accounts where phone = p_phone;
  if not found then
    return jsonb_build_object('allowed', false, 'error', 'no_account');
  end if;
  return jsonb_build_object('allowed', false, 'tries', v_row.pin_tries, 'locked_until', v_row.locked_until,
                            'user_id', v_row.user_id,
                            'error', case when v_row.user_id is null then 'pending' else 'locked' end);
end $$;

-- ── the verdict on a reserved attempt ───────────────────────────────────────
--   'ok'   the PIN was right: the count and any lock are cleared.
--   'void' no verdict (the auth service did not answer): the reservation is
--          handed back, and a lock it set is lifted with it.
-- A WRONG PIN needs no call: its reservation already counted it.
create or replace function public.mobile_pin_settle(p_phone text, p_outcome text, p_max integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.mobile_pin_accounts%rowtype;
begin
  if p_outcome = 'ok' then
    update public.mobile_pin_accounts
       set pin_tries = 0, locked_until = null, updated_at = now()
     where phone = p_phone
    returning * into v_row;
  elsif p_outcome = 'void' then
    update public.mobile_pin_accounts
       set pin_tries = greatest(pin_tries - 1, 0),
           locked_until = case when pin_tries - 1 < p_max then null else locked_until end,
           updated_at = now()
     where phone = p_phone and pin_tries > 0
    returning * into v_row;
  else
    raise exception 'mobile_pin_settle: outcome must be ok or void, got %', p_outcome using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'tries', coalesce(v_row.pin_tries, 0), 'locked_until', v_row.locked_until);
end $$;

-- ── lock every function to the server ───────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC by default and Supabase's default
-- privileges add anon and authenticated, so each is revoked by name.
do $$
declare fn text;
begin
  foreach fn in array array[
    'mobile_pin_rate_hit(text,text,integer,integer)',
    'mobile_pin_account(text,integer)',
    'mobile_pin_claim(text,text,integer)',
    'mobile_pin_bind(text,uuid)',
    'mobile_pin_unclaim(text)',
    'mobile_pin_attempt(text,integer,integer)',
    'mobile_pin_settle(text,text,integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
