# Session Handoff — Knickgasm-LifeCycle-OS

> Drop-in context for resuming work in **any** Claude surface (Cowork app, Claude Code CLI,
> or a fresh session). Open this repo as a project and read this file + `CLAUDE.md` + `docs/`.
> Last updated: 2026-06-09.

## Where things stand
- **Repo:** `Anchit-AI-Hustle/lifecycle-os` · branch `main` · HEAD `2c53c90`
- **Live:** https://lifecycle-os-anchittandon-3589s-projects.vercel.app
- **State:** local = origin = production, all deploys READY, working tree clean.
- **CLI session id (terminal resume only):** `c560fe34-d21e-4192-b5a4-e479ca4b63d7`
  - Resume in a fresh terminal: `claude --resume c560fe34-d21e-4192-b5a4-e479ca4b63d7`
  - Note: a CLI session does **not** appear in the Cowork app's session list — they are
    separate surfaces. To continue in Cowork, open this repo as a project; this file is the bridge.

## What the product is
Marketing-automation OS for KNICKGASM (premium sneaker). Static HTML pages + Vercel
serverless functions (`api/*.js`, CommonJS). Deployed on Vercel Hobby.

## LHS information architecture (final, in `auth.js` `NAV`)
- **Home**
- **Data Analysis** (`/dashboard.html`)
- **KNICKGASM** ▸ Mailers · Meta Ads · Google Ads · TikTok Ads · Landing Pages
- **Competitor Benchmarking** ▸ Discover Brands · Mailers · Meta Ads · Google Ads · TikTok Ads · Landing Pages · Insights
- **Marketing Mailers** ▸ Calendar · Cohort Definitions · Mailer Studio
- **Ad Campaigns** ▸ Calendar · Meta Ads · Google Ads · TikTok Ads
- **Landing Pages** ▸ For Mailers · For Meta Ads · For Google Ads · For TikTok Ads

## Key pages
| File | Purpose |
|---|---|
| `lifecycle_mailer_architect_v34.html` (748 KB) | Mailer Studio (`/studio`). Was truncated to 0 bytes in `53d16bc`, restored in `ce2242b` — that was the "blank page on create" bug. Now the SINGLE studio file: built-in light/dark toggle in the header (☾/☀), `data-theme="dark"` on `<html>`, persisted in `localStorage['knickgasm-theme']`, first visit follows OS `prefers-color-scheme`. Dark themes UI chrome only — the email preview (`.preview-wrap`/iframe) and generated mailer HTML stay on-brand white/chalk. |
| `knickgasm_mailer_studio_v2_dark.html` | RETIRED. The dark rebuild was merged into the single studio above; this is now a redirect stub → `/studio` (presets dark theme). `/studio-v2` rewrite also points at the main file. Kept only so old bookmarks resolve. |
| `cohort-definitions.html` | Cohort names + definitions + target audience (`/cohorts`) |
| `competitor-benchmarking.html` | Discover/Mailers/Ads/Landing/Insights (`/competitor`, `#discover`) |
| `knowledge-base.html` | KNICKGASM + Competitor, all channels; source set by LHS hash |
| `landing-pages.html` | Per-channel landing-page briefs |
| `mailer-discovery.html` | Redirect stub → `/competitor-benchmarking.html#discover` (merged) |

## Infra constraints (read before adding anything)
- **12 Vercel functions = Hobby hard cap.** Routers consolidate: `api/kb.js`, `api/calendar.js`,
  `api/competitor.js` dispatch via `?action=`. A 13th function breaks the build — extend a router.
- `api/_shared/competitor-core.js` — IMAP (imapflow + mailparser) → Google Sheets capture engine;
  underscore prefix excludes it from the function count. Noise filter applied at capture + read.
- Google Sheets auth: JWT (service-account key) with WIF (Workload Identity Federation) fallback.
- Supabase via REST (anon key in browser, service role on server); psql through pooler
  `aws-1-ap-south-1` (not `aws-0`; direct is IPv6-only).
- Service worker `sw.js` = `lifecycle-os-v15`; `auth.js` cache-busted via `?v=YYYYMMDD`.
- **Standing rule:** auto-commit + push after every change. The signed-in app user must never
  affect `ojhapraneet@gmail.com` usage for competitor-mail fetching.

## Open / possible next items (none in progress)
- Unified cross-feature dashboard with filters (per-feature dashboards already exist).
- Playwright subscribe-simulation / journey worker + auto-subscribe job.
- Per-brand subscribe-links list (anchored at signup, no 60-cap) for `ojhapraneet@gmail.com`.
