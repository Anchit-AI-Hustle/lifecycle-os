# Lifecycle OS feature audit, 2026-11-12

Baseline: `origin/main` at `18891ed067d9681ea2d4c342317ead0a8fe8466e` (merge of #450). Work is on the local branch
`claude/practical-lamport-4lthp7`. Nothing in this audit was pushed, deployed, sent, posted or applied to a live database,
and no paid provider was called: every model, platform and store in the tests is a local fake, and the network is blocked.

This report says what was checked, what was found, what was changed and what was not done. A row marked "not exercised"
was not driven in this audit; it is not a claim that the feature works or fails.

## 1. What the repository holds

74 pages at the root, 159 rewrites, 29 redirects, 109 rail entries, 12 serverless functions (the cap), 85 migrations before this audit, 279 spec files before this audit, 15 workflows, 2 Vercel crons. Actions dispatched by the shared routers (case labels and `action ===` tests, counted from the files):
`api/brain.js` 129, `api/calendar.js` 32, `api/competitor.js` 35, `api/kb.js` 17, `api/public-config.js` 15, `api/ai/generate.js` 7, `api/ai/image.js` 0.

Workers (run by hand or by a workflow, not on Vercel): `collect-ads.js`, `collect-landing.js`, `collect-wayback.js`,
`auto-subscribe.js`. Asset contracts registered in `asset-contracts.list()`: `email.mailer`, `ad.meta.static`,
`ad.meta.video`, `ad.google.rsa`, `ad.tiktok.video`, `ad.tiktok.static`, `landing.page`, `sms.message`,
`whatsapp.message`, `push.notification`. Checked in `checkAssetContracts` without a registered contract: `social.<key>`
(nine platforms), `onsite.*`, `display.banner`, `display.google.responsive`.

## 2. Checks run

| Check | Command | Result |
|---|---|---|
| Build | `npm run build` | passed |
| Verify (brand, foreign names, skills, DESIGN.md, KB, pages, interactions) | `npm run verify` | passed: 74 pages, 0 blockers, 5 warnings; 0 dead controls, 6 unproven (section 6, F-19) |
| Executed-tests ratchet | `npm run check:executed:ci` | passed: 180 source-text assertions, baseline 180 |
| Baseline suite | CI run 43164458860 on `072e0a1` (the commit before #450) | passed, all six shards |
| Branch suite | `npx playwright test --project=desktop-1280` | 3,994 passed, 3 failed, 4 skipped (1.2 h, run started before the later edits). `brain-downloads` failed because of this branch (the ZIP is now built after its digests, and the test did not await it): the test was fixed and its spec passes (3). `brand-theme-every-page` (playbook/index.html) and `code-video` (the short cut) fail the same way on a clean checkout of `origin/main` in this container and pass in CI on main, so they are this environment's, not this branch's; they were not fixed |
| New and changed specs | `approved-send-integrity` (4), `asset-decisions` (4), `live-brand-assets` (3), `brain-day-publish` (4), `router-calendar` (136), `kb-benchmark-docs` (7), `nav-no-duplicates` + `nav-rail-everywhere` (18), `migration-versions` (4) | all passed |

Limits of this environment, which bound every "verified" below: Node 22.23 here (CI uses 24); WebKit cannot be installed,
so the phone and tablet projects run only in CI; there is no workspace database, so every store is a fake; no platform
account is connected, so connector health is verified only against fakes that answer the documented endpoints.

## 3. Sidebar

The shared rail (`auth.js`) now reads, in order: **Brand Details**, **Competitive Benchmarking**, **Live Brand Assets**,
**Plan & Compile**, **Create Each Asset**, **Data Analysis**, then Assistants and Settings. Changes: the section "Brand"
is "Brand Details" and its group holds setup, catalogue, context, switch and the Brand Kit; AI Models, Platform
Connections, Credits, Payments, About and Design System moved to Settings; Publishing & Deliverability moved to the end
of Create Each Asset; "Publish & Analyse" is "Data Analysis". One entry per effective destination holds (the derived
inventory finds no two entries with one destination, and `nav-no-duplicates` passes).

## 4. Feature coverage

One row per rail entry, derived from `auth.js` and `vercel.json`. "Specs naming the page" counts spec files that
load that page; it measures attention, not correctness.

| Section | Group | Rail entry | Address | Resolves to | Specs naming the page | Status in this audit |
| --- | --- | --- | --- | --- | --- | --- |
| Brand Details | Brand Setup & Identity | Brand Setup | `/onboarding` | rewrite `/onboarding.html` | 45 | verified by its existing specs; /brand still opens it |
| Brand Details | Brand Setup & Identity | Brand Catalogue | `/catalog` | rewrite `/brand-catalogue.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Brand Details | Brand Setup & Identity | Brand Context | `/brand-context` | rewrite `/brand-context-view.html` | 2 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Brand Details | Brand Setup & Identity | Switch Brand | `/onboarding?new=1` | rewrite `/onboarding.html` | 45 | verified by its existing specs; /brand still opens it |
| Brand Details | Brand Setup & Identity | Brand Kit | `/brand-kit` | rewrite `/brand.html` | 2 | verified: reachable again at /brand-kit (was unreachable from the rail, F-05) |
| Competitive Benchmarking | Market Study | Overview (all regions) | `/research` | rewrite `/research.html` | 8 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Market Study | US Study | `/research?region=us` | rewrite `/research.html` | 8 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Market Study | UK Study | `/research?region=uk` | rewrite `/research.html` | 8 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Market Study | Global Study | `/research?region=global` | rewrite `/research.html` | 8 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Market Study | India Study | `/research?region=india` | rewrite `/research.html` | 8 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Competitor Benchmarking | Discover Brands | `/competitor-benchmarking.html#discover` | file `/competitor-benchmarking.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Competitor Benchmarking | Mailers | `/competitor-benchmarking.html#mailers` | file `/competitor-benchmarking.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Competitor Benchmarking | Meta Ads | `/competitor-benchmarking.html#meta` | file `/competitor-benchmarking.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Competitor Benchmarking | Google Ads | `/competitor-benchmarking.html#google` | file `/competitor-benchmarking.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Competitor Benchmarking | TikTok Ads | `/competitor-benchmarking.html#tiktok` | file `/competitor-benchmarking.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Competitor Benchmarking | Landing Pages | `/competitor-benchmarking.html#landing` | file `/competitor-benchmarking.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking | Competitor Benchmarking | Insights | `/competitor-benchmarking.html#insights` | file `/competitor-benchmarking.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Competitive Benchmarking |  | Design Intelligence | `/design-intel` | rewrite `/design-intelligence.html` | 0 | route and rail verified (nav gates); no spec names this page: flow NOT exercised |
| Live Brand Assets | Knowledge Base | Brand Documents | `/kb/brand` | rewrite `/brand-doc.html` | 4 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Live Brand Assets | Knowledge Base | Mailers | `/knowledge-base.html#mailers` | file `/knowledge-base.html` | 7 | verified: channel links, own ads, selected row (tests/live-brand-assets.spec.js) |
| Live Brand Assets | Knowledge Base | Meta Ads | `/knowledge-base.html#meta` | file `/knowledge-base.html` | 7 | verified: channel links, own ads, selected row (tests/live-brand-assets.spec.js) |
| Live Brand Assets | Knowledge Base | Google Ads | `/knowledge-base.html#google` | file `/knowledge-base.html` | 7 | verified: channel links, own ads, selected row (tests/live-brand-assets.spec.js) |
| Live Brand Assets | Knowledge Base | TikTok Ads | `/knowledge-base.html#tiktok` | file `/knowledge-base.html` | 7 | verified: channel links, own ads, selected row (tests/live-brand-assets.spec.js) |
| Live Brand Assets | Knowledge Base | Landing Pages | `/knowledge-base.html#landing` | file `/knowledge-base.html` | 7 | verified: channel links, own ads, selected row (tests/live-brand-assets.spec.js) |
| Plan & Compile |  | Smart Brain | `/brain` | rewrite `/smart-brain.html` | 48 | verified: preview, schedule, detail, ZIP, revision notes, decision record (tests/brain-day-publish.spec.js) |
| Plan & Compile |  | Growth OS | `/growth-os` | rewrite `/growth-os.html` | 2 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Plan & Compile |  | Retention Playbook | `/retention-playbook` | rewrite `/retention-playbook.html` | 4 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Plan & Compile |  | Frameworks | `/frameworks` | rewrite `/frameworks.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset |  | Mailer Studio | `/studio` | rewrite `/lifecycle_mailer_architect_v34.html` | 17 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Ad Campaigns | Ad Performance | `/ads-dashboard` | rewrite `/ads-dashboard.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Ad Campaigns | Calendar | `/ad-campaigns.html#calendar` | file `/ad-campaigns.html` | 11 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Ad Campaigns | Meta Ads | `/ad-campaigns.html#meta` | file `/ad-campaigns.html` | 11 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Ad Campaigns | Google Ads | `/ad-campaigns.html#google` | file `/ad-campaigns.html` | 11 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Ad Campaigns | TikTok Ads | `/ad-campaigns.html#tiktok` | file `/ad-campaigns.html` | 11 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Landing Page Builder | Overview (all channels) | `/landing-pages` | rewrite `/landing-pages.html` | 8 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Landing Page Builder | For Mailers | `/landing-pages#mailers` | rewrite `/landing-pages.html` | 8 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Landing Page Builder | For Meta Ads | `/landing-pages#meta` | rewrite `/landing-pages.html` | 8 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Landing Page Builder | For Google Ads | `/landing-pages#google` | rewrite `/landing-pages.html` | 8 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Landing Page Builder | For TikTok Ads | `/landing-pages#tiktok` | rewrite `/landing-pages.html` | 8 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Landing Page Builder | Landing Page Templates | `/landing-page-templates` | rewrite `/template-gallery.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Landing Page Builder | ★ Live: Agent Page | `/lp/best` | rewrite `/landing-pages/final/knickgasm-uk-grail-drop-agent-best.html` | 2 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Landing Page Builder | ★ 3D Agent Page (motion) | `/lp/best-3d` | rewrite `/landing-pages/final/knickgasm-grail-drop-3d.html` | 2 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | Landing Page Builder | Landing Page with All-In-One Voice+Chat+Talk Agent | `/lp/agent` | rewrite `/landing-page-agent.html` | 5 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | 3D Storefront & Websites | 3D Storefront (overview) | `/3d` | rewrite `/storefront-3d.html?variant=signature` | 7 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | 3D Storefront & Websites | 🇺🇸 US Website | `/3d/us` | rewrite `/storefront-3d.html?variant=us` | 7 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | 3D Storefront & Websites | 🇬🇧 UK Website | `/3d/uk` | rewrite `/storefront-3d.html?variant=uk` | 7 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | 3D Storefront & Websites | 🌍 Global Website | `/3d/global` | rewrite `/storefront-3d.html?variant=global` | 7 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | 3D Storefront & Websites | 🇮🇳 India Website | `/3d/in` | rewrite `/storefront-3d.html?variant=in` | 7 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset | 3D Storefront & Websites | Design References | `/website-designs` | rewrite `/website-designs.html` | 2 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset |  | Social Media OS | `/social` | rewrite `/social-media.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset |  | Music (Official Songs) | `/music` | rewrite `/music.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset |  | Created Assets | `/assets` | rewrite `/assets.html` | 5 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Create Each Asset |  | Publishing & Deliverability | `/publishing` | rewrite `/publishing.html` | 10 | verified by its existing specs; LinkedIn posts read added in #450 |
| Data Analysis |  | Master Dashboard | `/master-dashboard` | rewrite `/all-in-one.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Control Room | `/data-analysis?tab=control` | rewrite `/data-analysis.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Revenue by Region | `/revenue-by-region` | rewrite `/revenue-by-region.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Acquisition | `/data-analysis?tab=acq` | rewrite `/data-analysis.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Retention | `/data-analysis?tab=ret` | rewrite `/data-analysis.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Cohort Retention | `/data-analysis?tab=cohort` | rewrite `/data-analysis.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Paid Media | `/data-analysis?tab=live-ads` | rewrite `/data-analysis.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Owned Channels | `/data-analysis?tab=mailer-intelligence` | rewrite `/data-analysis.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Landing & Experiments | `/data-analysis?tab=landing-intelligence` | rewrite `/data-analysis.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Actions & Outcomes | `/data-analysis?tab=action-outcomes` | rewrite `/data-analysis.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Alert Settings | `/data-analysis?tab=alert-settings` | rewrite `/data-analysis.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | Sales & Business Review | `/data-analysis?tab=review` | rewrite `/data-analysis.html` | 3 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Data Analysis | RFM Dashboard (Draft 1) | `/rfm` | rewrite `/dashboard.html` | 16 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Cohorts | Overview | `/cohorts?tab=overview` | rewrite `/cohort-definitions.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Cohorts | Engagement Cohorts | `/cohorts?tab=engagement` | rewrite `/cohort-definitions.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Cohorts | Engagement Levels | `/cohorts?tab=englevel` | rewrite `/cohort-definitions.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Cohorts | Product Cohorts | `/cohorts?tab=product` | rewrite `/cohort-definitions.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Cohorts | Lifecycle Stages | `/cohorts?tab=lifecycle` | rewrite `/cohort-definitions.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Cohorts | RFM Segments | `/cohorts?tab=rfm` | rewrite `/cohort-definitions.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis | Cohorts | Behavioral | `/cohorts?tab=behavioral` | rewrite `/cohort-definitions.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis |  | Avatars (Personas) | `/avatars` | rewrite `/avatars.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis |  | Marketing Team | `/marketing-team` | rewrite `/marketing-team.html` | 2 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Data Analysis |  | Owner's Desk | `/owner-desk` | rewrite `/owner-desk.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants |  | Brand Assistant | `/ask` | rewrite `/kicksgpt.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants |  | Brand Agent | `/agent` | rewrite `/agent.html` | 13 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Overview (all tools) | `/telesuite#home` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Products | `/telesuite#products` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Call Knowledge Base | `/telesuite#knowledge-base` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | AI Pitch Generator | `/telesuite#pitch-generator` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | AI Rebuttal Assistant | `/telesuite#rebuttal-generator` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Audio Transcription | `/telesuite#transcription` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Transcription DB | `/telesuite#transcription-dashboard` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | AI Call Scoring | `/telesuite#call-scoring` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Call Scoring DB | `/telesuite#call-scoring-dashboard` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Combined Call Analysis | `/telesuite#combined-call-analysis` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Combined Analysis DB | `/telesuite#combined-call-analysis-dashboard` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | AI Voice Sales Agent | `/telesuite#voice-sales-agent` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Voice Sales DB | `/telesuite#voice-sales-dashboard` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | AI Voice Support Agent | `/telesuite#voice-support-agent` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Voice Support DB | `/telesuite#voice-support-dashboard` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Training Material Creator | `/telesuite#create-training-deck` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Material DB | `/telesuite#training-material-dashboard` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | AI Data Analyst | `/telesuite#data-analysis` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Data Analysis DB | `/telesuite#data-analysis-dashboard` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Batch Audio Downloader | `/telesuite#batch-audio-downloader` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Global Activity Log | `/telesuite#activity-dashboard` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | Clone Full App | `/telesuite#clone-app` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Assistants | TeleSuite | n8n Workflow | `/telesuite#n8n-workflow` | rewrite `/telesuite.html` | 6 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Settings |  | AI Models & Routing | `/ai-models` | rewrite `/brand-connections.html?tab=models` | 9 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Settings |  | Platform Connections | `/connections` | rewrite `/brand-connections.html` | 11 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Settings |  | About this platform | `/about` | rewrite `/about.html` | 9 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Settings |  | Design System | `/design-system` | rewrite `/design-system.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Settings |  | Credits & Usage | `/credits` | rewrite `/credits.html` | 9 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Settings |  | Payment Gateways | `/payments` | rewrite `/payments.html` | 2 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Settings |  | Access Issues | `/access-issues` | rewrite `/access-issues.html` | 1 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |
| Settings |  | Overall App Audit | `/audit` | rewrite `/app-audit.html` | 4 | route and rail verified (nav gates); flow covered by existing specs, not re-driven by hand |


Not in the rail, reachable by address: `/lp/:id` (served landing pages; `router-calendar` covers it), `/review`
(review page; `review-feedback`), `/doc` and `/kb/brand/*` (document viewer; `brand-docs-per-brand`), `/july-studio`,
`/diff-version` (frozen snapshot), `/privacy`, `/terms`, `404`. Mobile: the Android and iOS apps are shells over the
live site (`platform-identity`); they were not built or run here.

## 5. Asset type coverage

Cells: V = verified by an executed test in this audit or in the passing suite; P = present and not re-verified here;
B = blocked, with the reason; n/a = does not apply.

| Asset | Research and decision record | Generated | Contract check | Preview | Saved | Export (single, day, ZIP) | Publish eligibility | Measurement |
|---|---|---|---|---|---|---|---|---|
| Mailer (4 variants) | V (decision record, mail study) | V | V `email.mailer` | V | V | V | Klaviyo: needs list and sender on the connection, else "send from Publishing" (V) | KPI named; baseline is a gap until the brand has history (V) |
| Landing page (A, B) | V | V | V `landing.page` | V | V | V | live at `/lp/:id` on approval (V) | KPI named; not linked to a revision (open, F-18) |
| Meta ad, static and video | V | V | V | V | V | V | Paid launch only, built paused (P) | own ad history read for Meta (P) |
| Google ad | V | V | routed to `ad.google.rsa` for static and video creative types (F-15) | V | V | V | Paid launch, Search only (P) | own ad history, last 30 days (P) |
| YouTube ad | V | V | no contract (F-15) | V | V | V | manual | none |
| TikTok ad, static and video | V | V | V | V | V | V | planned, every step withheld: endpoints unconfirmed (P) | B: report endpoint unconfirmed |
| Social posts (9 platforms) | V | V | V `social.<key>` | V | V after approval of additions on older sends | V | 6 routed channels; X, Threads, Stories have none (V) | B: no organic metrics linked to a post revision |
| SMS, WhatsApp, push | V when the brand states the channel | P | V | P | P | V in ZIP | SMS via Klaviyo when set up; WhatsApp and push have no provider (V) | none |
| On-site bar, banner, pop-up | V | V | V `onsite.*` | V | V | V | manual: no store connection writes a theme (V) | none |
| Display banners, responsive display | V | V | V | V | V | V | manual upload (V) | none |
| Music | brief recorded as a brief (V) | brief V; track composed on request (P) | none | P | track is not stored | brief only | n/a | n/a |
| Story video | P | P (code video) | P | P | P | P | needs a hosted MP4 for a video post (V) | none |

## 6. Issue ledger

Severity: High = a customer, a send or an approval can be wrong; Medium = the operator is misled or a feature is
unreachable; Low = cosmetic or robustness.

### Fixed in this audit

**F-01, High. A review nobody made was reported as a pass.** `api/_shared/agentic-orchestrator.js` `reviewStage`.
Reproduce: run the agentic flow with no model reachable. Evidence: the function returned `{ score: 7, pass: true }`
when no model was loaded and again when the call threw; the run printed "N of N passed the score gate" and the page
printed "7". Impact followed: the verdict reaches the Smart Brain agentic report only; no publishing path reads it.
Cause: a fallback written as a value. Fix: the verdict is `state: 'review_unavailable'`, `score: null`, `pass: null`
with the reason; the gate is the score itself; an unreviewed campaign is not retried; the stage reports reviewed and
unreviewed counts apart; the page says "not reviewed". Verified: `approved-send-integrity` test 1.

**F-02, High. Opening an approved send rewrote it.** `smart-brain-plan.js` `_previewEntry`. An approved send whose
saved campaign carried template copy was rebuilt with a model and saved again under the same id as approved, on View.
Fix: an approved send is returned as saved, whatever it is, with `template_fallback: true`; nothing is written.
Verified: `approved-send-integrity` test 2 (no write to the campaign table, approved bytes identical).

**F-03, High. Missing approved assets were rebuilt and filed as approved.** Same function, the orphan branch. Fix: a
read that failed is `503 approved_assets_unreadable` and rebuilds nothing; a campaign that is really missing becomes a
new draft, saved as a preview, flagged `recovered_draft`, and the page says "New draft, not approved"; approving it is
an ordinary approval (`approveEntry` no longer treats a draft as already approved). Verified: test 3. Still open: F-20.

**F-04, High. Assets added after approval were offered to the schedule as ready.** `brain-publish.js` `plan` and
`topUpSavedCampaign`. Social posts, on-site and display assets made on view for an older approved send were queued by
Schedule though nobody approved them. Fix: such rows are `awaiting_approval` and say why; the preview says which kinds
were added and that the mail, pages and ads are exactly as approved; `?action=smart-brain-approve-additions` (POST,
existing calendar router, still 12 functions) saves them with who approved them and when, and refuses if the approved
mail, pages or ads would change. Verified: test 4, `router-calendar`, `brain-day-publish` (browser).

**F-05, Medium. `/brand` had two rewrites; the Brand Kit was unreachable.** `vercel.json`. The first (`/onboarding.html`)
always won, so the rail's "Brand Kit" row and the About page's link opened brand setup. Fix: `/brand` keeps opening
setup (what production has always served); the Brand Kit is `/brand-kit`; the dead second rewrite is gone. Verified:
derived inventory (no duplicate source, every rail entry resolves), nav gates.

**F-06, High. The bulk ZIP overwrote sends.** `smart-brain.html` `sbZipAll`. Folders were `<date>_<cohort>`, so two
markets' sends for one cohort on one day, or two sends of one cohort, wrote the same paths and one replaced the other
inside the archive. Fix: a folder per send (`<date>_<market>_<cohort>_<slot id>`), no path used twice (also within a
send), and `manifest.json` listing every file with its send, kind, size and SHA-256, each send's revision state and
digest. Verified: `brain-day-publish` (three same-date same-cohort sends, unique paths, digest of a file recomputed
from the archive bytes).

**F-07, Medium. "Live Brand Assets" ad channels showed only search links.** `knowledge-base.html`. The Meta, Google
and TikTok tabs showed public-library search links under the word "Live". Fix: the brand's own ads, as imported from
its linked account (`brand_ad_history`), are listed first with status, last seen and destination, counted as "not a
full inventory", labelled out of date after 7 days; every other state is a sentence (device brand, nothing linked,
never imported, unreadable, TikTok not read); the tiles are labelled search links. Verified: `live-brand-assets`.

**F-08, Medium. The Knowledge Base did not follow its address.** A rail entry pressed while the page was open, and
back / forward, changed the hash and not the channel. Fix: a `hashchange` listener. **F-09, Low.** A slow channel
answer could draw over a newer one; guarded. **F-10, Low.** The rail lit "Mailers" while another channel was on screen
when the hash carried the market (`#meta/IN`) or the page was reached at `/kb`; fixed in `auth.js`. Verified:
`live-brand-assets`.

### Written, not applied

**F-11, Medium (security). Knowledge Base bucket accepts writes from any role.** `20260606_kb_storage_and_landing.sql`
creates the insert policy with no role, though its comment says authenticated only. Migration
`20261112063000_kb_bucket_member_writes.sql` restricts writes to an editor of the workspace whose folder the object
goes into. It was not applied (a live migration needs separate authorization) and was not executed against a database
here. Rollback is stated in the file. Not changed: the bucket stays public for reads, because stored public URLs
would break; that is a decision for the owner.

### Verified, no change needed

**F-12.** `workers/collect-ads.js` stores Meta ads of COMPETITORS only (`is_own: false`). Its Google and TikTok links
are printed in the run summary and never stored as creatives, which is correct. The brand's own ads reach the product
only through `ad-history` (Meta and Google Ads; TikTok and Pinterest are listed as not read, with the reason).
The Knowledge Base router scopes every read to the caller's workspace and returns nothing without one.

### Open

**F-13, High, fixed.** `generateSingleAsset` (regenerate one asset) rebuilt the asset and saved the campaign again
under the same id as a preview, so an approved send lost its approved bytes and status to a press of Regenerate. It is
refused for an approved send (`409 approved_send_locked`) before anything is built or written. Verified:
`approved-send-integrity` test 5.
**F-14, Medium, fixed for scheduling.** Approval (and approval of additions) stores `approved_digest` (the SHA-256
over every asset's id and revision). `dispatch-slot` compares the saved assets with it before queueing and refuses
with `approved_revision_changed` when they differ; the status answer carries both digests. Sends approved before this
have no digest and are scheduled as before. Not bound: Paid launch and sends made from Publishing.
**F-15, Low, reclassified.** Google ads carry responsive-search fields whatever picture or video is paired with them,
so judging them as `ad.google.rsa` is intended. YouTube ads have no contract because `asset-specs.js` holds no sourced
limit for them; none was invented.
**F-22, Low, fixed.** The "Approve the added assets" button named its send by its index in the plan list, which the
page re-reads at its own pace; a press could find nothing and do nothing. The button names the slot itself.
**F-16, High, not built.** One observation pipeline for owned and competitor assets (section 3 of the brief): there
is no canonical observation table, no source registry, no version history of observations and no cross-source
linking. Milled disallows automated reading in robots.txt; Google Ads Transparency and TikTok offer no feed this
repository may call. Manual import exists only as Knowledge Base file and URL ingestion.
**F-17, High, partly built.** The decision record is written by Smart Brain builds only. The standalone generators
(`api/ai/generate.js`, Mailer Studio, Ad Campaigns, Landing Pages), regeneration and the agentic run do not write
one, and no gate blocks generation on missing research. The record is compiled at the end of a build from what the
build used; it is not a separate decision step before it.
**F-18, High, not built.** Measurement linked to an asset revision, spend and revenue reconciliation, and feeding
results back into decisions.
**F-19, Low.** `audit:interactions` reports 6 unproven items: one on Publishing is a false positive (the text
`<button>` inside a CSS comment); two buttons and two guarded lookups in Mailer Studio and one lookup in TeleSuite were
not traced. `audit:pages` warns of the tenant-zero brand name in visible copy on `campaign.html`, `connector-3d.html`
and Mailer Studio, and off-palette colours on two pages; not changed.
**F-20, Medium.** The scheduled `smart-brain-heal` action still republishes a missing approved campaign as approved
(needed so `/lp/:id` links keep resolving). Left as is; it is an operator-run action, not a view.
**F-21.** Not done from the brief: deduplication of observations and near-duplicate review; a single manifest driving
the visible counts on the page (the ZIP has one); migration dry-run tooling; tests for retail / service / publisher
brands across two workspaces end to end; playback inspection of audio and video; mobile runs.

## 7. Artifacts

Screenshots taken in Chromium from the tests (scratch, not in the repository):
`/tmp/claude-0/-home-user-lifecycle-os/cbba6364-15fa-59fd-a680-2dba7a486e3c/scratchpad/audit-shots/` holds
`brain-decision-record.png`, `brain-added-after-approval.png`, `live-brand-assets-meta.png`.
