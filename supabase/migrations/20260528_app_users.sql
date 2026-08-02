-- KNICKGASM Lifecycle OS — app_users table
-- Holds the optional profile info collected after Google sign-in.
-- Row created automatically on first sign-in via trigger.
-- Profile filling is NOT compulsory — name/mobile/region are nullable.

create table if not exists public.app_users (
  id          uuid        primary key references auth.users (id) on delete cascade,
  email       text        not null,
  display_name text,                                   -- from Google or user-edited
  name        text,                                    -- user-entered preferred name
  mobile      text,                                    -- E.164 ideally; user-entered
  region      text        check (region is null or region in (
                            'US','UK','IN','Global','ME','AU','EU','CA','JP','SG','Other'
                          )),
  avatar_url  text,                                    -- from Google profile
  profile_completed boolean not null default false,    -- true after user saves OR skips with "remind later" off
  metadata    jsonb       not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_app_users_email on public.app_users (email);

-- ─── RLS: a user can only read/write their own row ─────────────────────
alter table public.app_users enable row level security;

drop policy if exists "self read"  on public.app_users;
drop policy if exists "self upsert" on public.app_users;
drop policy if exists "self update" on public.app_users;

create policy "self read"   on public.app_users for select using (auth.uid() = id);
create policy "self upsert" on public.app_users for insert with check (auth.uid() = id);
create policy "self update" on public.app_users for update using (auth.uid() = id) with check (auth.uid() = id);

-- ─── Auto-create app_users row on first sign-in ────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (id, email, display_name, avatar_url, metadata)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── updated_at maintenance ────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists app_users_touch on public.app_users;
create trigger app_users_touch before update on public.app_users
  for each row execute function public.touch_updated_at();

-- ─── Realtime for app_users so any other browser tab gets fresh data ──
alter publication supabase_realtime add table public.app_users;
