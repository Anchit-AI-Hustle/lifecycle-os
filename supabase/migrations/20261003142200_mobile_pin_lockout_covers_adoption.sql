-- ─────────────────────────────────────────────────────────────────────────────
-- The PIN lockout covers the ADOPTION path too (review finding, 2026-10-03).
--
-- When a sign-up's admin create answers `phone_exists`, an auth user with that
-- number already exists that this table never bound: a sign-up whose function
-- died after the auth service answered, or a phone user made some other way.
-- The server then checks the PIN against it with a password grant. That check
-- used to run WITHOUT mobile_pin_attempt(), and a wrong PIN un-claimed the
-- row - deleting it, and with it the count - so the next try was a fresh
-- sign-up at zero. The only limit left was the per-address budget.
--
-- Now, keyed by the PHONE, on a row a failure does not delete:
--   mobile_pin_attempt(..., p_pending => true)  reserves a try on a row that is
--       still pending (user_id null), exactly as for a bound account: one
--       statement under the row lock, the lock set at the maximum.
--   mobile_pin_unclaim()  deletes a pending row ONLY while it carries no tries
--       and no lock; otherwise it keeps the row and marks the claim stale, so
--       the next sign-up can take it over WITH the count.
--   mobile_pin_claim()  takes over a stale claim keeping pin_tries and
--       locked_until (it used to zero both), and refuses while the row is
--       locked, answering the lock.
-- Same posture as 20260929173555: SECURITY DEFINER, empty search_path,
-- service_role only.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.mobile_pin_claim(p_phone text, p_name text, p_stale_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_claimed boolean; v_row public.mobile_pin_accounts%rowtype;
begin
  insert into public.mobile_pin_accounts as a (phone, name)
  values (p_phone, p_name)
  on conflict (phone) do update
     set name = excluded.name, claimed_at = now(), updated_at = now()
   where a.user_id is null
     and a.claimed_at < now() - make_interval(secs => p_stale_seconds)
     and (a.locked_until is null or a.locked_until <= now())
  returning true into v_claimed;
  if coalesce(v_claimed, false) then
    return jsonb_build_object('claimed', true);
  end if;
  select * into v_row from public.mobile_pin_accounts where phone = p_phone;
  return jsonb_build_object('claimed', false,
    'locked', v_row.locked_until is not null and v_row.locked_until > now(),
    'locked_until', v_row.locked_until);
end $$;

create or replace function public.mobile_pin_unclaim(p_phone text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.mobile_pin_accounts
   where phone = p_phone and user_id is null and pin_tries = 0
     and (locked_until is null or locked_until <= now());
  if found then return true; end if;
  -- Tries or a lock on it: KEEP the row (the count is the point) and make the
  -- claim stale, so the next sign-up can take it over with the count intact.
  update public.mobile_pin_accounts
     set claimed_at = now() - interval '1 day', updated_at = now()
   where phone = p_phone and user_id is null;
  return false;
end $$;

drop function if exists public.mobile_pin_attempt(text, integer, integer);
create or replace function public.mobile_pin_attempt(p_phone text, p_max integer, p_lock_seconds integer, p_pending boolean default false)
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
     and (a.user_id is not null or p_pending)
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
                            'error', case when v_row.locked_until is not null and v_row.locked_until > now() then 'locked'
                                          when v_row.user_id is null then 'pending' else 'locked' end);
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'mobile_pin_claim(text,text,integer)',
    'mobile_pin_unclaim(text)',
    'mobile_pin_attempt(text,integer,integer,boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
