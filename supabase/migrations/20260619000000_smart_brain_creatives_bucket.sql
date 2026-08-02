-- Public Storage bucket for Smart Brain generated creatives (mailer / landing
-- page / ad hero images). The server uploads with the service-role key (bypasses
-- RLS); browsers load the public URL. If this bucket is absent, image generation
-- still works — uploadCreative() falls back to inline data-URLs.

insert into storage.buckets (id, name, public)
values ('smart-brain-creatives', 'smart-brain-creatives', true)
on conflict (id) do update set public = true;

-- Public read for objects in this bucket.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'smart_brain_creatives_public_read'
  ) then
    create policy "smart_brain_creatives_public_read"
      on storage.objects for select
      using (bucket_id = 'smart-brain-creatives');
  end if;
end $$;
