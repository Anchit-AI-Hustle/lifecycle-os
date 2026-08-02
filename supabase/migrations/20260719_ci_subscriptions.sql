-- Competitor-intel USER subscriptions + real-time notification log.
--
-- Lets a logged-in user "follow" a competitor brand and receive a REAL-TIME
-- email for every NEW mailer and/or NEW ad captured for that brand. Distinct
-- from the legacy capture-inbox "subscription" (whether our capture pipeline is
-- signed up to a brand's list) — this is the app user's own notification prefs.

CREATE TABLE IF NOT EXISTS public.ci_user_subscriptions (
  id          BIGSERIAL PRIMARY KEY,
  user_email  TEXT NOT NULL,
  brand_id    BIGINT REFERENCES public.brands(id) ON DELETE CASCADE,
  brand_key   TEXT NOT NULL,          -- normalized brand name/domain, stable match key
  brand_name  TEXT,
  mailers     BOOLEAN DEFAULT TRUE,   -- follow this brand's mailers
  ads         BOOLEAN DEFAULT TRUE,   -- follow this brand's ads
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ci_user_subs_uidx ON public.ci_user_subscriptions (user_email, brand_key);
CREATE INDEX IF NOT EXISTS ci_user_subs_brand_idx ON public.ci_user_subscriptions (brand_key);
CREATE INDEX IF NOT EXISTS ci_user_subs_user_idx  ON public.ci_user_subscriptions (user_email);

-- Dedup log so a re-run / re-sync never re-emails the same asset to a user.
CREATE TABLE IF NOT EXISTS public.ci_notification_log (
  id          BIGSERIAL PRIMARY KEY,
  user_email  TEXT NOT NULL,
  asset_type  TEXT NOT NULL,          -- mailer | ad
  asset_id    BIGINT NOT NULL,
  sent_at     TIMESTAMPTZ DEFAULT now(),
  ok          BOOLEAN DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS ci_notif_log_uidx ON public.ci_notification_log (user_email, asset_type, asset_id);
