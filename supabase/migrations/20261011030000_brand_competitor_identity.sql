-- 20261011030000_brand_competitor_identity.sql
--
-- WHICH BRAND A STORED COMPETITOR WAS FOUND FOR.
--
-- brand_competitors rows belong to a workspace, and a workspace can be renamed
-- into a different brand: in the live project the workspace that was
-- "Deli Chic" is "Lenskart" now, and its competitor list was still a deli's.
-- Each row now records the identity it was found for
-- (api/_shared/competitor-universe.js competitorIdentity(): 'ci1:' + a hash of
-- the website's registrable domain and the folded brand name). A row whose
-- identity is not the workspace's current one - or that has none, because it
-- was saved before this column existed - is hidden from the list and the
-- benchmark by the application, never deleted. Seeding or discovery for the
-- current brand re-stamps a row it finds again.
--
-- Nullable, no default and no backfill on purpose: nobody recorded which brand
-- the existing rows were found for, and guessing would be inventing it.
-- Row-level security is unchanged (the table's is_brand_member policies cover
-- the new column like every other).

alter table if exists public.brand_competitors
  add column if not exists brand_identity text;

comment on column public.brand_competitors.brand_identity is
  'The brand identity (ci1:<hash of website registrable domain + folded name>) this competitor was found for. NULL = recorded before identities were; such rows are hidden for the current brand, never deleted.';

create index if not exists brand_competitors_identity_idx
  on public.brand_competitors (workspace_id, brand_identity);
