-- Knowledge Base uploads are written only by an editor of the workspace whose
-- folder they go into (audit 2026-11-12).
--
-- 20260606 created the public bucket "knowledge-base" with an INSERT policy of
-- WITH CHECK (bucket_id = 'knowledge-base') and no role: its own comment says
-- "only authenticated users to upload", but the policy admitted every role, so
-- anyone holding the public anon key could write any object into the bucket,
-- including into another workspace's folder. The page files an upload under
-- <workspace_id>/<category>/<name> (knowledge-base.html), the same first path
-- segment brand-assets and brand-review-media check.
--
-- NOT changed here, said so nobody takes it as done: the bucket stays PUBLIC
-- for reads, because kb_files.public_url rows already point at public object
-- URLs and a private bucket would break every one of them. Objects written
-- before this migration under a path with no workspace folder stay readable
-- and can no longer be added to.
--
-- Rollback: drop policy "kb_write_editor" and recreate "kb_write_public" as in
-- 20260606_kb_storage_and_landing.sql.

do $$
begin
  drop policy if exists "kb_write_public" on storage.objects;
  drop policy if exists "kb_write_editor" on storage.objects;
  create policy "kb_write_editor"
    on storage.objects for insert
    to authenticated
    with check (
      bucket_id = 'knowledge-base'
      and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.is_brand_editor((storage.foldername(name))[1]::uuid, auth.uid())
    );
exception when insufficient_privilege then
  raise notice 'storage.objects policies need the storage admin role: apply this block from the dashboard SQL editor';
end $$;
