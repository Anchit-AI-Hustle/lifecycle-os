-- Each person's share of the platform model per UTC day (2026-11-09,
-- platform-model-policy.js callerGate): the per-person read also returns
-- today's spend. Service role only, as before.
drop function if exists public.platform_usage_for_user(uuid);
create function public.platform_usage_for_user(p_user uuid)
returns table (usd numeric, answers bigint, today_usd numeric)
language sql security definer set search_path = public stable as $$
  select coalesce(sum(usd), 0), coalesce(sum(answers), 0),
         coalesce(sum(usd) filter (where day = (now() at time zone 'utc')::date), 0)
  from public.platform_model_usage where user_id = p_user;
$$;
revoke all on function public.platform_usage_for_user(uuid) from public, anon, authenticated;
grant execute on function public.platform_usage_for_user(uuid) to service_role;
