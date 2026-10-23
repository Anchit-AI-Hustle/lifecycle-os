-- Gift credits to anyone by email (2026-10-23, the operator: "add option to gift
-- credits to any user via email id").
--
-- A gift is recorded against the recipient's email as a SHA-256 hash (never the
-- address itself) with a masked hint for the sender's list ("a***@example.com").
-- The recipient receives it the next time they open their balance signed in
-- with that verified email, whether or not they had an account when it was
-- sent. A person gifts from their OWN wallet (debited in the same statement);
-- the operator can grant without debiting anyone. Service role only: the
-- browser never reads or writes this table, every path goes through the API,
-- which verifies the session first.

create table if not exists public.credit_gifts (
  id              uuid primary key default gen_random_uuid(),
  from_user       uuid,
  from_workspace  uuid,
  from_kind       text not null check (from_kind in ('user', 'operator')),
  to_email_hash   text not null,
  to_email_hint   text not null,
  amount          bigint not null check (amount > 0),
  note            text,
  status          text not null default 'pending' check (status in ('pending', 'claimed')),
  created_at      timestamptz not null default now(),
  claimed_by      uuid,
  claimed_at      timestamptz,
  claimed_wallet  uuid
);
alter table public.credit_gifts enable row level security;
revoke all on public.credit_gifts from anon, authenticated;
create index if not exists credit_gifts_pending_idx on public.credit_gifts (to_email_hash) where status = 'pending';
create index if not exists credit_gifts_from_idx on public.credit_gifts (from_user, created_at desc);

-- Send: debit the sender (unless the operator) and record the gift, in one
-- statement under the sender's wallet lock.
create or replace function public.credit_gift_send(
  p_from uuid, p_from_workspace uuid, p_email_hash text, p_hint text,
  p_amount bigint, p_note text default null, p_operator boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_wallet uuid; v_balance bigint; v_gift uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be positive'; end if;
  if p_email_hash is null or length(p_email_hash) < 32 then raise exception 'recipient required'; end if;
  if not p_operator then
    if p_from is null then raise exception 'sender required'; end if;
    v_wallet := public.credit_wallet_id(p_from, p_from_workspace);
    select balance into v_balance from public.credit_wallets where id = v_wallet for update;
    if v_balance < p_amount then
      return jsonb_build_object('ok', false, 'error', 'insufficient_credits', 'balance', v_balance, 'required', p_amount);
    end if;
    update public.credit_wallets set balance = balance - p_amount, updated_at = now()
     where id = v_wallet returning balance into v_balance;
  end if;
  insert into public.credit_gifts (from_user, from_workspace, from_kind, to_email_hash, to_email_hint, amount, note)
  values (p_from, p_from_workspace, case when p_operator then 'operator' else 'user' end, p_email_hash, p_hint, p_amount, p_note)
  returning id into v_gift;
  if not p_operator then
    insert into public.credit_ledger (wallet_id, user_id, workspace_id, kind, delta, balance_after, ref, note, meta)
    values (v_wallet, p_from, p_from_workspace, 'gift_sent', -p_amount, v_balance, v_gift::text, p_note,
            jsonb_build_object('to', p_hint));
  end if;
  return jsonb_build_object('ok', true, 'gift_id', v_gift, 'balance', v_balance, 'amount', p_amount, 'to', p_hint);
end $$;

-- Claim: every pending gift for this verified email lands in the caller's
-- wallet, once (the row lock makes a second claim find nothing pending).
create or replace function public.credit_gift_claim(p_user uuid, p_workspace uuid, p_email_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare g record; v_total bigint := 0; v_count int := 0; v_res jsonb; v_wallet uuid;
begin
  if p_user is null or p_email_hash is null then return jsonb_build_object('ok', true, 'claimed', 0, 'credits', 0); end if;
  for g in select * from public.credit_gifts where to_email_hash = p_email_hash and status = 'pending' for update skip locked loop
    v_res := public.credit_grant(p_user, p_workspace, g.amount, 'gift', g.id::text,
      coalesce(g.note, 'A gift of credits'), jsonb_build_object('from_kind', g.from_kind));
    v_wallet := (v_res->>'wallet_id')::uuid;
    update public.credit_gifts set status = 'claimed', claimed_by = p_user, claimed_at = now(), claimed_wallet = v_wallet where id = g.id;
    v_total := v_total + g.amount; v_count := v_count + 1;
  end loop;
  return jsonb_build_object('ok', true, 'claimed', v_count, 'credits', v_total);
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'credit_gift_send(uuid,uuid,text,text,bigint,text,boolean)',
    'credit_gift_claim(uuid,uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
