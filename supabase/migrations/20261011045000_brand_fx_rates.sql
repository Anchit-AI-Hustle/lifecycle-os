-- 20261011045000_brand_fx_rates.sql
--
-- EXCHANGE RATES THE OPERATOR ENTERED, kept on the brand.
--
-- "Revenue by region" (brain.js ?action=region-revenue,
-- api/_shared/region-revenue-server.js) shows each market in its own
-- currency. A single combined total across markets in different currencies
-- exists only when it is converted at a rate somebody ENTERED for this brand:
-- this repo calls no rate source, and a rate nobody entered is a number
-- nobody approved. Each row is one dated rate (1 from_currency = rate
-- to_currency on as_of), with who entered it and when. A newer row for the
-- same pair supersedes an older one in the read; nothing is overwritten.
--
-- Members read (is_brand_member), editors and owners write (is_brand_editor),
-- the same split as the catalogue (20260809150000_brand_editor_roles.sql).

create table if not exists public.brand_fx_rates (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.brand_workspaces(id) on delete cascade,
  from_currency    text not null check (from_currency ~ '^[A-Z]{3}$'),
  to_currency      text not null check (to_currency ~ '^[A-Z]{3}$'),
  rate             numeric not null check (rate > 0),
  as_of            date not null,
  entered_by       uuid not null,
  entered_by_email text,
  entered_at       timestamptz not null default now(),
  constraint brand_fx_rates_pair_chk check (from_currency <> to_currency)
);

comment on table public.brand_fx_rates is
  'Exchange rates an operator entered for a brand (1 from_currency = rate to_currency on as_of), with who entered them. The only rates Revenue by region converts with; none are fetched or assumed.';

create index if not exists brand_fx_rates_ws_idx on public.brand_fx_rates (workspace_id, from_currency, to_currency, as_of desc);

alter table public.brand_fx_rates enable row level security;
revoke all on public.brand_fx_rates from anon;
grant select, insert, delete on public.brand_fx_rates to authenticated;

drop policy if exists brand_fx_rates_read on public.brand_fx_rates;
create policy brand_fx_rates_read on public.brand_fx_rates for select
  using (public.is_brand_member(workspace_id, auth.uid()));

drop policy if exists brand_fx_rates_write on public.brand_fx_rates;
create policy brand_fx_rates_write on public.brand_fx_rates for insert
  with check (public.is_brand_editor(workspace_id, auth.uid()) and entered_by = auth.uid());

drop policy if exists brand_fx_rates_delete on public.brand_fx_rates;
create policy brand_fx_rates_delete on public.brand_fx_rates for delete
  using (public.is_brand_editor(workspace_id, auth.uid()));
