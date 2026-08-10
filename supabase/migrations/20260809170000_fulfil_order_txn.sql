-- ============================================================================
-- 20260809170000_fulfil_order_txn.sql
-- Make recharge fulfilment atomic in BOTH directions.
--
-- The application-level compare-and-set stopped the double grant, but it opened
-- the opposite hole: the order was flipped to `paid` first, and if the
-- subsequent credit_grant call failed (a transient network or database error)
-- the order stayed `paid` forever while no credits were ever added. Every retry
-- then short-circuited on "already fulfilled". A customer could pay and never
-- receive the pack.
--
-- Both movements have to happen together, so they live in one function: the
-- pending -> paid transition and the ledger grant are a single transaction.
-- Either both land or neither does, and a retry after a failure still works
-- because the order is still `pending`.
-- ============================================================================

create or replace function public.credit_fulfil_order(
  p_order    uuid,
  p_provider text default null,
  p_ref      text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_claimed int;
  v_grant jsonb;
begin
  select * into o from public.credit_orders where id = p_order;
  if o is null then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  -- Claim the order. The WHERE on status = 'pending' is the compare-and-set:
  -- exactly one concurrent caller can win it.
  update public.credit_orders
     set status = 'paid',
         provider = coalesce(p_provider, provider),
         provider_ref = coalesce(p_ref, provider_ref),
         updated_at = now()
   where id = p_order and status = 'pending';
  get diagnostics v_claimed = row_count;

  if v_claimed = 0 then
    -- Someone else already fulfilled it, or it is not payable. Report whether
    -- the credits actually landed so a caller can tell the difference.
    return jsonb_build_object(
      'ok', true, 'credited', false, 'status', o.status,
      'already_fulfilled', exists (
        select 1 from public.credit_ledger where ref = p_order::text and kind = 'topup'
      ));
  end if;

  -- Same transaction: if this raises, the UPDATE above rolls back with it and
  -- the order returns to `pending`, so a retry can fulfil it properly.
  v_grant := public.credit_grant(
    o.user_id, o.workspace_id, o.credits,
    'topup', o.id::text, 'Recharge: ' || o.pack_key,
    jsonb_build_object('pack', o.pack_key, 'provider', p_provider)
  );

  return jsonb_build_object(
    'ok', true, 'credited', true, 'credits', o.credits,
    'balance', v_grant->'balance', 'order_id', o.id, 'pack_key', o.pack_key);
end $$;

comment on function public.credit_fulfil_order is
  'Atomically mark a recharge order paid AND grant its credits. Both happen in one transaction, so a failed grant rolls the status back to pending and the retry works — the previous split version could leave an order paid with no credits ever added.';

-- A pack must never be credited twice for the same order, whatever the caller
-- does. This is the backstop behind the compare-and-set above.
create unique index if not exists credit_ledger_topup_once_idx
  on public.credit_ledger (ref) where kind = 'topup' and ref is not null;

do $$ begin
  revoke all on function public.credit_fulfil_order(uuid, text, text) from public, anon, authenticated;
  grant execute on function public.credit_fulfil_order(uuid, text, text) to service_role;
end $$;
