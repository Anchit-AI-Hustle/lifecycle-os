-- A customer's star rating and feedback from a review mail (2026-10-24).
-- Written ONLY by the service role (api/_shared/review-feedback.js, after the
-- brand is resolved from its workspace id). Members of the brand read their
-- own rows. No email address or phone number is stored: a follow-up is matched
-- by the order reference the mail carried. Every rater is offered the brand's
-- public review link on the page, whatever they rate (no review gating).
create table if not exists public.brand_review_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.brand_workspaces(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 2000),
  issue text,
  order_again text check (order_again is null or order_again in ('Yes','Maybe','No')),
  followup text not null default 'none' check (followup in ('email','phone','none')),
  order_ref text check (order_ref is null or char_length(order_ref) <= 60),
  product_ref text check (product_ref is null or char_length(product_ref) <= 160),
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists brand_review_feedback_ws_idx on public.brand_review_feedback (workspace_id, created_at desc);
alter table public.brand_review_feedback enable row level security;
revoke all on public.brand_review_feedback from anon, authenticated;
grant select on public.brand_review_feedback to authenticated;
drop policy if exists brand_review_feedback_member_read on public.brand_review_feedback;
create policy brand_review_feedback_member_read on public.brand_review_feedback
  for select to authenticated using (public.is_brand_member(workspace_id, auth.uid()));
