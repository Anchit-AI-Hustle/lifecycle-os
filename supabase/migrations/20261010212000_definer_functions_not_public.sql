-- SECURITY DEFINER functions callable by anyone with the public key
-- (Supabase Security Advisor, 2026-10-10: "Public Can Execute SECURITY
-- DEFINER Function" / "Signed-In Users Can Execute ...").
--
-- Postgres grants EXECUTE to PUBLIC on every new function, so a revoke from
-- anon alone changes nothing: each function below is revoked from PUBLIC and
-- granted back only to the roles that call it.
--
-- * brand_context_apply / brand_fields_claim_user / brand_fields_record_origin
--   are called by the server as the signed-in CALLER (restAs, the context
--   pack's store) or with the service role. Nothing calls them signed out.
-- * handle_new_user (a trigger) and rls_auto_enable (an event trigger) fire
--   from their triggers, which never check the caller's EXECUTE; nobody calls
--   them over /rest/v1/rpc.
-- * purge_expired_payment_oauth_states is the scheduler's (service role).
--   20260823180000 revoked anon and authenticated but left PUBLIC, so both
--   could still run it.
--
-- Left as they are, on purpose: is_brand_member / is_brand_editor. Row-level
-- security policies call them while evaluating a query, so the querying role
-- needs EXECUTE; revoking it from anon would turn a signed-out read that
-- returns nothing into an error. They answer only a yes/no about membership.

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.brand_context_apply(uuid, jsonb, jsonb)',
    'public.brand_fields_claim_user(uuid, text[])',
    'public.brand_fields_record_origin(uuid, jsonb)'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;

  foreach f in array array[
    'public.handle_new_user()',
    'public.rls_auto_enable()',
    'public.purge_expired_payment_oauth_states()'
  ] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
