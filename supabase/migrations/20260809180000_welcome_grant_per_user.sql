-- ============================================================================
-- 20260809180000_welcome_grant_per_user.sql
-- The trial grant is per ACCOUNT, not per wallet.
--
-- Wallets are per (user, brand workspace), and the welcome grant was landing on
-- the first touch of EACH wallet. Any signed-in user can create and activate an
-- unlimited number of brand workspaces, so that was an unlimited credit faucet:
-- create a workspace, take another 500 credits, spend them, repeat.
--
-- The entitlement belongs to the user, so the uniqueness does too. The old
-- per-wallet index is replaced with a per-user one; a second workspace's wallet
-- now starts empty, which is the correct behaviour for an account-level trial.
--
-- Existing deployments: any duplicate welcome grants already issued are left
-- alone (the ledger is append-only truth and must not be rewritten); the index
-- is created only if that is possible, and the application check below it still
-- prevents new ones either way.
-- ============================================================================

drop index if exists public.credit_ledger_welcome_once_idx;

do $$
begin
  create unique index credit_ledger_welcome_once_user_idx
    on public.credit_ledger (user_id) where ref = 'welcome' and kind = 'grant';
exception
  when unique_violation then
    -- A deployment that already issued more than one welcome grant to a user
    -- cannot take the unique index. Say so loudly rather than failing the
    -- migration: credits-core still checks per user before granting, so no NEW
    -- duplicate can be created.
    raise warning 'credit_ledger already contains multiple welcome grants for at least one user; the per-user unique index was not created. New duplicates are still prevented in credits-core.wallet(). Reconcile the existing rows if the balances matter.';
  when duplicate_table then null;
end $$;

comment on table public.credit_ledger is
  'Append-only truth for every credit movement, tagged with the feature that caused it. hold -> spend/release pairs are linked by hold_id so a failed run is always refunded. The welcome grant is unique per USER (not per wallet), because a user can create unlimited workspaces.';
