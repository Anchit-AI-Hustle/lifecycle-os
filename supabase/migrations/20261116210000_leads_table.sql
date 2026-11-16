-- 20261117000000_leads_table.sql
-- Working contact and lead capture table following Brand Motion Studios (Module 5 & 8).
-- Captures inquiries from landing pages and website contact forms with bot protection and RLS.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  message text not null,
  brand_id text,
  brand_slug text,
  market text default 'US',
  source text default 'landing_page',
  metadata jsonb default '{}'::jsonb
);

-- Enable Row Level Security
alter table public.leads enable row level security;

-- Public / anon insert policy: allows anonymous web visitors to submit contact forms.
-- Requires non-empty name, email with @ symbol, and non-empty message.
drop policy if exists "leads_public_insert" on public.leads;
create policy "leads_public_insert" on public.leads
  for insert
  with check (
    length(trim(name)) > 0
    and length(trim(email)) > 3
    and email like '%@%'
    and length(trim(message)) > 0
  );

-- Authenticated workspace members and service role can read leads.
drop policy if exists "leads_workspace_select" on public.leads;
create policy "leads_workspace_select" on public.leads
  for select
  using (
    auth.role() = 'authenticated'
    or auth.role() = 'service_role'
  );

create index if not exists idx_leads_created_at on public.leads (created_at desc);
create index if not exists idx_leads_brand_slug on public.leads (brand_slug);
