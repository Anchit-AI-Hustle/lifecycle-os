-- The assistant's built-in kit (2026-11-27, api/_shared/assistant-kit.js and
-- ai-eval.js): what the assistant remembers per person and workspace, and the
-- evaluation runs kept so a later run can be compared with an earlier one.
--
-- Both are written by the service role only, after the router verified the
-- caller and resolved the workspace. A member reads their own memories and the
-- ones marked shared; members read their workspace's evaluation runs. anon
-- reads nothing.

create table if not exists public.assistant_memory (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  user_id       uuid not null,
  text          text not null check (char_length(text) between 6 and 280),
  kind          text not null default 'context' check (kind in ('preference', 'decision', 'fact', 'context')),
  shared        boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists assistant_memory_ws_user_idx on public.assistant_memory (workspace_id, user_id, created_at desc);

alter table public.assistant_memory enable row level security;
revoke all on public.assistant_memory from anon;
revoke insert, update, delete on public.assistant_memory from authenticated;
grant select on public.assistant_memory to authenticated;
drop policy if exists assistant_memory_read on public.assistant_memory;
create policy assistant_memory_read on public.assistant_memory for select to authenticated
  using (public.is_brand_member(workspace_id) and (user_id = auth.uid() or shared));

create table if not exists public.ai_eval_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.brand_workspaces(id) on delete cascade,
  run_by        uuid,
  scores        jsonb not null default '{}'::jsonb,
  cases         jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists ai_eval_runs_ws_idx on public.ai_eval_runs (workspace_id, created_at desc);

alter table public.ai_eval_runs enable row level security;
revoke all on public.ai_eval_runs from anon;
revoke insert, update, delete on public.ai_eval_runs from authenticated;
grant select on public.ai_eval_runs to authenticated;
drop policy if exists ai_eval_runs_read on public.ai_eval_runs;
create policy ai_eval_runs_read on public.ai_eval_runs for select to authenticated
  using (public.is_brand_member(workspace_id));
