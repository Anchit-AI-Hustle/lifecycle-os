# Unified Data Analysis control plane

This change makes **Data Analysis** the single business-review workspace. The former D2C Business Review is embedded as ten Data Analysis tabs, while the original market-aware Control Room, Acquisition, Retention, and Cohort tabs remain intact.

## What is included

### Live intelligence tabs

- **Live Ads** — Meta, Google Ads, and TikTok at account, campaign, ad-group/ad-set, and ad level. Reads are made on demand with browser caching disabled. The UI refreshes every 60 seconds; platform processing and attribution latency still apply.
- **Mailer Intelligence** — Klaviyo plus WebEngage event, campaign, audience, conversion, negative-signal, and attributed-revenue views.
- **Landing Pages & Experiments** — own PageDeck page metrics, A/B-test variants/results, lift/confidence, sample-ratio mismatch, revenue impact, and competitor landing-page benchmarks.
- **Actions & Outcomes** — recommendation-to-launch speed, completion/error rates, measured lift, incremental revenue, ROI, experiment win rate, guardrail breaches, rollback rate, review backlog, connector runs, and system activity.
- **Alert Settings** — hourly analysis cadence, thresholds, quiet hours, cooldown, Gmail, Google Chat, and SMS delivery.

### Business Review tabs

The full source review remains available, but is no longer a separate analytical surface:

1. Review Insights
2. Executive Overview
3. Website Performance
4. Customers & Reactivation
5. Catalog & Pricing
6. Fulfilment & Delivery
7. Support & CX
8. Category Performance
9. Coffee & Subscriptions
10. Access Audit

The retained deep-dive is the verified US D2C review. The native and connector-backed Data Analysis tabs remain market-aware.

## Hourly execution

`.github/workflows/alerts.yml` invokes the existing `api/public-config.js` function at minute 7 of every hour. The saved setting `cadence_hours` determines whether the run executes or cleanly skips; supported values are 1–24 hours.

Each executed run:

1. syncs the read-only Klaviyo mirror and drains available WebEngage exports;
2. fetches account-level ad data for configured markets;
3. reads mailer, landing-page, experiment, competitor, action, and connector data;
4. applies anomaly thresholds;
5. deduplicates alerts using a cooldown window;
6. respects Asia/Kolkata quiet hours unless a critical alert is configured to bypass them;
7. dispatches Gmail, Google Chat, and/or SMS;
8. persists the complete run payload and delivery result.

## Required deployment configuration

Apply `supabase/migrations/20260722000000_data_analysis_control_plane.sql`, then configure the relevant environment variables. Missing credentials never produce substitute numbers; the UI reports the source as unavailable.

### Scheduler and access

- `CRON_SECRET`
- `ANALYTICS_ADMIN_DOMAINS` — defaults to `knickgasm.com`
- `ANALYTICS_MARKETS` — defaults to `US,UK`
- Supabase URL, anon key, and service-role key already used by Lifecycle OS

### Alert delivery

Gmail is the primary email transport. The `From` identity is env-driven via `ALERT_EMAIL` (no mailbox is hardcoded) and the OAuth grant must belong to that mailbox or an authorised send-as alias. Live sending is additionally gated by the global `LIVE_CONNECTORS` kill-switch (default **off**): while off, every send returns a `would_send` stub and nothing is delivered. Set `LIVE_CONNECTORS=on` plus `ALERT_EMAIL` and the Gmail/Resend credentials to send for real.

- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GOOGLE_CHAT_WEBHOOK_URL`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- optional `RESEND_API_KEY` fallback when Gmail is not configured

### Paid media

Use generic variables or append `_US`, `_UK`, `_IN`, and so on for market-specific accounts.

- Meta: `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`
- Google Ads: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- TikTok: `TIKTOK_ACCESS_TOKEN`, `TIKTOK_ADVERTISER_ID`
- optional API-version overrides: `META_GRAPH_VERSION`, `GOOGLE_ADS_API_VERSION`

### Mailers

- `KLAVIYO_API_KEY`
- WebEngage bulk export configured to the private Supabase Storage bucket, default `webengage-dumps`
- optional `WEBENGAGE_BUCKET`

### PageDeck

PageDeck's published product documentation describes analytics, A/B testing, and competitor/lander intelligence, but does not publish a stable general REST contract. The adapter therefore uses only an authorised JSON export/webhook URL or the supplied Supabase mirror tables:

- `PAGEDECK_ANALYTICS_EXPORT_URL`
- `PAGEDECK_EXPERIMENTS_EXPORT_URL`
- `PAGEDECK_COMPETITOR_EXPORT_URL`
- optional `PAGEDECK_API_KEY`

Mirror tables are `pagedeck_pages`, `pagedeck_experiments`, and `pagedeck_competitor_pages`.

## Action measurement contract

Write one row to `analytics_action_outcomes` per material action. At minimum use `action_type`, `action_id`, `status`, `recommended_at`, and `launched_at`. Add baseline/observed values, incremental revenue, cost, experiment ID, guardrail state, and rollback state as measurement becomes available.

No outcome is inferred from activity alone. When the outcome table is empty, the UI shows system activity but labels impact metrics as unmeasured.
