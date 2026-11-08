-- The platform's own model spend (2026-11-09, platform-model-policy.js).
-- One row per day x user x model: answers made on the PLATFORM's Bedrock key,
-- the tokens Bedrock reported, and the cost priced from them. The operator's
-- budget is compared with the total; each person's own total drives how
-- strongly they are asked to connect a model of their own.
-- Service role only: no policy for anyone, revoked from anon/authenticated.

create table if not exists public.platform_model_usage (
  day           date        not null default (now() at time zone 'utc')::date,
  user_key      text        not null default '',
  user_id       uuid,
  workspace_id  uuid,
  model         text        not null default '',
  answers       integer     not null default 0,
  input_tokens  bigint      not null default 0,
  output_tokens bigint      not null default 0,
  tokens_missing integer    not null default 0,
  usd           numeric(14,6) not null default 0,
  unpriced      integer     not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (day, user_key, model)
);

alter table public.platform_model_usage enable row level security;
revoke all on public.platform_model_usage from anon, authenticated;

create index if not exists platform_model_usage_user on public.platform_model_usage (user_id);

create or replace function public.platform_usage_add(
  p_user uuid, p_workspace uuid, p_model text, p_in bigint, p_out bigint, p_usd numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.platform_model_usage as u
    (day, user_key, user_id, workspace_id, model, answers, input_tokens, output_tokens, tokens_missing, usd, unpriced)
  values (
    (now() at time zone 'utc')::date, coalesce(p_user::text, ''), p_user, p_workspace, coalesce(p_model, ''), 1,
    coalesce(p_in, 0), coalesce(p_out, 0), case when p_in is null or p_out is null then 1 else 0 end,
    coalesce(p_usd, 0), case when p_usd is null then 1 else 0 end)
  on conflict (day, user_key, model) do update set
    answers = u.answers + 1,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    tokens_missing = u.tokens_missing + excluded.tokens_missing,
    usd = u.usd + excluded.usd,
    unpriced = u.unpriced + excluded.unpriced,
    workspace_id = coalesce(excluded.workspace_id, u.workspace_id),
    updated_at = now();
end $$;

create or replace function public.platform_usage_total()
returns table (usd numeric, answers bigint, unpriced bigint)
language sql security definer set search_path = public stable as $$
  select coalesce(sum(usd), 0), coalesce(sum(answers), 0), coalesce(sum(unpriced), 0) from public.platform_model_usage;
$$;

create or replace function public.platform_usage_for_user(p_user uuid)
returns table (usd numeric, answers bigint)
language sql security definer set search_path = public stable as $$
  select coalesce(sum(usd), 0), coalesce(sum(answers), 0) from public.platform_model_usage where user_id = p_user;
$$;

revoke all on function public.platform_usage_add(uuid, uuid, text, bigint, bigint, numeric) from public, anon, authenticated;
revoke all on function public.platform_usage_total() from public, anon, authenticated;
revoke all on function public.platform_usage_for_user(uuid) from public, anon, authenticated;
grant execute on function public.platform_usage_add(uuid, uuid, text, bigint, bigint, numeric) to service_role;
grant execute on function public.platform_usage_total() to service_role;
grant execute on function public.platform_usage_for_user(uuid) to service_role;
