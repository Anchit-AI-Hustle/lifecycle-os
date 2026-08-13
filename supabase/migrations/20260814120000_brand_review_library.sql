-- ============================================================================
-- 20260814120000_brand_review_library.sql
-- The brand's OWN testimonials, read off its OWN site, plus the storage bucket
-- their images are re-hosted into.
--
-- WHY. The Smart Brain copy prompt used to hand the model a proof shape already
-- filled in ("rating": {"value": 4.9, "count": "250,000+"}, "author": "first
-- name, initial"). A model given a filled shape completes it, so campaigns
-- shipped a rating, a review count and a reviewer nobody had approved, onto a
-- page served to real traffic at /lp/:id. Removing those fields alone leaves the
-- mailer with no proof at all; this table is the honest replacement. Reviews are
-- EXTRACTED verbatim by api/_shared/brand-reviews.js from the brand's own
-- domain, never written by a model.
--
-- Two rules are enforced HERE rather than by convention in the caller:
--
--   NO TRANSFER   Every row carries workspace_id AND region, and the read path
--                 filters on both, so a review can never appear against another
--                 brand, another region, or (via product_key) another product.
--                 The spec forbids all three and this is where it is structural.
--
--   IDEMPOTENCE   quote_key = sha256(workspace | region | folded quote) is
--                 unique, so re-running the extraction updates the row it
--                 already wrote instead of accumulating duplicates of the same
--                 testimonial every time a campaign regenerates.
--
-- What is deliberately NOT here: any column for a rating the site did not state,
-- and any default for `author`. A review whose page named no reviewer stores
-- NULL and renders with no attribution. There is nothing to synthesise a name
-- from, which is the point.
--
-- Additive + idempotent, same conventions as the migrations before it.
-- ============================================================================

create table if not exists public.brand_review_library (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,

  -- Region the review was collected FOR. 'ALL' when the brand runs one site for
  -- every market. Part of the read filter, so a UK testimonial never renders in
  -- a US send.
  region        text not null default 'ALL',

  -- Folded product name the review was published against, when the page said so
  -- (schema.org itemReviewed / the enclosing Product node). NULL means the site
  -- published it as a general testimonial, not against one product. Never
  -- guessed from surrounding copy.
  product_key   text,

  -- The exact published text. Clipped, never reworded: there is no LLM in the
  -- extraction path, because a paraphrase of a customer's words is a new
  -- testimonial nobody wrote.
  quote         text not null,

  -- The reviewer EXACTLY as the page stated them. NULL when the page named
  -- nobody. No default, no placeholder, no "Verified reviewer".
  author        text,

  -- The rating as the page stated it, with its scale, both as text so 4.9 can
  -- never be rounded to 5 by a numeric cast and a 4.9/10 can never be read as
  -- 4.9/5. NULL when the page stated no rating.
  rating_value  text,
  rating_scale  text,

  -- Provenance. source_url is the page the quote was read from; signal names the
  -- markup it was declared in ('json-ld:Review' | 'microdata:Review').
  source_url    text not null,
  signal        text,
  brand_name    text,

  -- Re-hosted media: [{hosted_url, source_url, sha256}] for images successfully
  -- copied into storage, or [{hosted_url:'', source_url, marker}] for one that
  -- could not be fetched. The ORIGINAL url is kept next to the hosted one so
  -- provenance survives the re-host, and a failure is recorded as a marker
  -- rather than dropped (a silent gap is indistinguishable from a design
  -- choice).
  media         jsonb not null default '[]'::jsonb,

  quote_key     text not null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists brand_review_library_quote_key_uidx
  on public.brand_review_library (quote_key);
create index if not exists brand_review_library_scope_idx
  on public.brand_review_library (workspace_id, region, product_key);

alter table public.brand_review_library enable row level security;

-- Same membership gate as every other brand-content table.
do $$ begin
  create policy "reviews readable by members" on public.brand_review_library
    for select using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "reviews written by members" on public.brand_review_library
    for all
    using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()))
    with check (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

comment on table public.brand_review_library is
  'Verbatim testimonials extracted from a brand''s OWN site by api/_shared/brand-reviews.js. Replaces the fabricated rating/reviewer the Smart Brain copy prompt used to seed. Never written by an LLM. Filtered on workspace_id AND region on every read so a review cannot transfer between brands, regions or products.';
comment on column public.brand_review_library.author is
  'The reviewer exactly as the source page stated them. NULL when the page named nobody — the renderer then shows the quote with no attribution rather than synthesising a name.';
comment on column public.brand_review_library.rating_value is
  'Text, not numeric, so the stated value is preserved byte for byte. 4.9 is never rounded to 5 and is never re-scaled.';

-- ── Scan bookkeeping ────────────────────────────────────────────────────────
-- A brand whose site publishes NO testimonials leaves the library empty forever.
-- Without a record of the ATTEMPT, every campaign build would re-crawl that site
-- from scratch — roughly 180 slots in the prebuild queue, each spending its
-- serverless budget re-asking a question it already knows the answer to, and
-- hammering the brand's own origin for nothing. Recording the attempt is what
-- makes a negative answer as durable as a positive one. Same shape and the same
-- reasoning as public.brand_competitor_refresh.
create table if not exists public.brand_review_scan (
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  region        text not null default 'ALL',
  last_run_at   timestamptz not null default now(),
  found         int not null default 0,
  last_note     text,
  primary key (workspace_id, region)
);

alter table public.brand_review_scan enable row level security;

do $$ begin
  create policy "review scan readable by members" on public.brand_review_scan
    for select using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "review scan written by members" on public.brand_review_scan
    for all
    using (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()))
    with check (workspace_id is not null and public.is_brand_member(workspace_id, auth.uid()));
exception when duplicate_object then null; end $$;

comment on table public.brand_review_scan is
  'When a brand site was last read for testimonials, per region, and how many were found. A zero-result scan is a durable answer: without it the prebuild queue would re-crawl the brand origin once per slot.';

-- ── Storage: re-hosted review images ────────────────────────────────────────
-- An email is opened days after it is sent, from a client that is not a browser,
-- against a CDN that may block hotlinks or have rotated the URL. So a review
-- image is fetched once and served from here instead of hotlinked.
--
-- The object key is `<workspace_id>/<sha256 of the source url>.<ext>`:
--   * the workspace prefix is what makes the bucket workspace-scoped, and the
--     write policies below are written against that same first path segment, so
--     one brand's uploads can never be written or replaced under another's;
--   * the content hash makes the upload idempotent, so regenerating a campaign
--     re-uses the object instead of littering the bucket with copies.
--
-- Reads are public because the URL is embedded in mailers that render outside
-- any session. Only image bytes the brand already publishes on its own site are
-- ever placed here, so public read adds no exposure.
insert into storage.buckets (id, name, public)
values ('brand-review-media', 'brand-review-media', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'brand_review_media_public_read'
  ) then
    create policy "brand_review_media_public_read"
      on storage.objects for select
      using (bucket_id = 'brand-review-media');
  end if;
end $$;

-- Writes are scoped to the workspace named by the FIRST path segment. The server
-- uploads with the service-role key and bypasses this, but a leaked browser JWT
-- cannot write into another brand's prefix, which is the case this guards.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'brand_review_media_member_write'
  ) then
    create policy "brand_review_media_member_write"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'brand-review-media'
        and public.is_brand_member((storage.foldername(name))[1]::uuid, auth.uid())
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'brand_review_media_member_update'
  ) then
    create policy "brand_review_media_member_update"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'brand-review-media'
        and public.is_brand_member((storage.foldername(name))[1]::uuid, auth.uid())
      );
  end if;
end $$;
