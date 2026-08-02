-- app_users · profile_prompted flag
--
-- The Lifecycle OS profile popup must appear EXACTLY ONCE per user — the very
-- first time after sign-up. After that it never re-appears, even on a fresh
-- device, whether the user filled the profile or skipped it.
--
-- profile_completed already tells us if they filled it. profile_prompted tells
-- us whether the popup has ever been shown. Set true on first display (skip
-- or save) and the popup is suppressed forever after.

alter table public.app_users
  add column if not exists profile_prompted boolean not null default false;

comment on column public.app_users.profile_prompted is
  'Was the profile popup ever shown to this user? Used to make the prompt strictly once-ever, even across devices.';
