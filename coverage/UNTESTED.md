# Untested lines — the map

Generated 2026-09-15T04:57:11.244Z at commit `254e599` by `npm run coverage` (regenerate with `npm run coverage:report`; do not hand-edit). How it is measured, and what it cannot see: `docs/coverage.md`.
Suite: `playwright test --project=desktop-1280 --project=pixel-5 --reporter=line` — exit 0, 391s.

## Totals

| scope | files | lines | covered | uncovered | covered % |
|---|---:|---:|---:|---:|---:|
| Node-side modules (api/, lib/, scripts/lib/, root .js) — c8 | 169 | 69220 | 38136 | 31084 | 55.1% |
| Inline `<script>` in root .html pages — Playwright JS coverage | 66 | 27092 | 11838 | 15254 | 43.7% |
| **Combined** | 235 | 96312 | 49974 | 46338 | **51.9%** |

Browser attribution: 193 page flushes, 2377 script records → 1718 external-script hits on 16 files, 470 inline-block hits, 189 unattributed (27 distinct — listed at the end). External-script hits merged into the `node+browser` rows: analysis-registry.js, auth.js, brand-catalog.js, brand-context.js, brand-demo.js, chart-enhance.js, chat-history.js, credits.js, data-analysis-extensions.js, lifecycle-3d-connector-engine.js, motion.js, region-context.js, table-sort.js. Hits on files outside the c8 include scope (not rows here): assets/knickgasm3d-bridge.js, data/analytics/market-data.js, data/design-intelligence.js.

## Ranking

`score = uncovered lines × weight`. Weight is **2** for a file on the credits / auth / dispatch / preflight / SSRF path (the `LOAD_BEARING` list in `scripts/coverage/report.js`), **1** otherwise. A page row counts only the lines inside its inline `<script>` blocks; a Node row counts every line of the file (c8 counts blank and comment lines the way V8 reports them).

## All files, ranked by score

| # | file | kind | lines | covered | uncovered | uncovered % | w | score |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `lifecycle_mailer_architect_v34.html` | page | 8415 | 3010 | 5405 | 64.2% | 1 | 5405 |
| 2 | `api/brain.js` | node | 1205 | 0 | 1205 | 100% | 2 | 2410 |
| 3 | `api/ai/pipeline/html.js` | node | 1066 | 0 | 1066 | 100% | 2 | 2132 |
| 4 | `dashboard.html` | page | 1989 | 402 | 1587 | 79.8% | 1 | 1587 |
| 5 | `api/_shared/smart-brain-plan.js` | node | 2904 | 1601 | 1303 | 44.9% | 1 | 1303 |
| 6 | `api/ai/generate.js` | node | 1045 | 435 | 610 | 58.4% | 2 | 1220 |
| 7 | `api/competitor.js` | node | 560 | 0 | 560 | 100% | 2 | 1120 |
| 8 | `api/_shared/brand-workspace-core.js` | node | 1910 | 892 | 1018 | 53.3% | 1 | 1018 |
| 9 | `api/ai/pipeline/variant.js` | node | 485 | 0 | 485 | 100% | 2 | 970 |
| 10 | `api/calendar.js` | node | 458 | 0 | 458 | 100% | 2 | 916 |
| 11 | `api/_shared/social-core.js` | node | 881 | 0 | 881 | 100% | 1 | 881 |
| 12 | `api/ai/pipeline/strategy.js` | node | 435 | 0 | 435 | 100% | 2 | 870 |
| 13 | `api/kb.js` | node | 862 | 431 | 431 | 50% | 2 | 862 |
| 14 | `api/_shared/telesuite-core.js` | node | 1132 | 335 | 797 | 70.4% | 1 | 797 |
| 15 | `lifecycle-usa-d2c-dashboard.html` | page | 937 | 153 | 784 | 83.7% | 1 | 784 |
| 16 | `api/_shared/dispatch-core.js` | node | 542 | 158 | 384 | 70.8% | 2 | 768 |
| 17 | `api/_shared/brain-generate.js` | node | 830 | 98 | 732 | 88.2% | 1 | 732 |
| 18 | `telesuite.html` | page | 818 | 95 | 723 | 88.4% | 1 | 723 |
| 19 | `auth.js` | node+browser | 2436 | 2077 | 359 | 14.7% | 2 | 718 |
| 20 | `api/_shared/oauth-core.js` | node | 515 | 174 | 341 | 66.2% | 2 | 682 |
| 21 | `api/_shared/competitor-core.js` | node | 967 | 299 | 668 | 69.1% | 1 | 668 |
| 22 | `api/_shared/lp-compiler.js` | node | 911 | 252 | 659 | 72.3% | 1 | 659 |
| 23 | `ad-campaigns.html` | page | 965 | 312 | 653 | 67.7% | 1 | 653 |
| 24 | `api/_shared/credits-core.js` | node | 736 | 420 | 316 | 42.9% | 2 | 632 |
| 25 | `api/_shared/deliverability-core.js` | node | 764 | 454 | 310 | 40.6% | 2 | 620 |
| 26 | `api/public-config.js` | node | 279 | 0 | 279 | 100% | 2 | 558 |
| 27 | `api/_shared/workspace-connections-core.js` | node | 1141 | 877 | 264 | 23.1% | 2 | 528 |
| 28 | `api/_shared/calendar-generate.js` | node | 523 | 0 | 523 | 100% | 1 | 523 |
| 29 | `lib/smart-brain/services.js` | node | 1451 | 937 | 514 | 35.4% | 1 | 514 |
| 30 | `api/ai/image.js` | node | 432 | 175 | 257 | 59.5% | 2 | 514 |
| 31 | `publishing.html` | page | 371 | 122 | 249 | 67.1% | 2 | 498 |
| 32 | `api/ai/pipeline/images.js` | node | 243 | 0 | 243 | 100% | 2 | 486 |
| 33 | `api/_shared/lifecycle-mailer-build.js` | node | 481 | 0 | 481 | 100% | 1 | 481 |
| 34 | `api/ai/pipeline/score.js` | node | 236 | 0 | 236 | 100% | 2 | 472 |
| 35 | `smart-brain.html` | page | 1342 | 874 | 468 | 34.9% | 1 | 468 |
| 36 | `api/_shared/lifecycle-calendar-generate.js` | node | 463 | 0 | 463 | 100% | 1 | 463 |
| 37 | `onboarding.html` | page | 1555 | 1099 | 456 | 29.3% | 1 | 456 |
| 38 | `api/_shared/adapters/klaviyo-adapter.js` | node | 490 | 262 | 228 | 46.5% | 2 | 456 |
| 39 | `api/_shared/payments-core.js` | node | 1346 | 1118 | 228 | 16.9% | 2 | 456 |
| 40 | `api/_shared/brain-agent.js` | node | 493 | 83 | 410 | 83.2% | 1 | 410 |
| 41 | `api/_shared/calendar-trigger.js` | node | 781 | 374 | 407 | 52.1% | 1 | 407 |
| 42 | `api/_shared/adapters/meta-adapter.js` | node | 505 | 302 | 203 | 40.2% | 2 | 406 |
| 43 | `storefront-3d.html` | page | 507 | 112 | 395 | 77.9% | 1 | 395 |
| 44 | `competitor-benchmarking.html` | page | 775 | 383 | 392 | 50.6% | 1 | 392 |
| 45 | `api/_shared/brand-llm.js` | node | 660 | 273 | 387 | 58.6% | 1 | 387 |
| 46 | `access-issues.html` | page | 468 | 89 | 379 | 81% | 1 | 379 |
| 47 | `api/_shared/os-backbone.js` | node | 372 | 0 | 372 | 100% | 1 | 372 |
| 48 | `copilot.js` | node | 359 | 0 | 359 | 100% | 1 | 359 |
| 49 | `brand-connections.html` | page | 335 | 157 | 178 | 53.1% | 2 | 356 |
| 50 | `api/_shared/social-push-core.js` | node | 173 | 0 | 173 | 100% | 2 | 346 |
| 51 | `api/_shared/daily-calendar-core.js` | node | 413 | 73 | 340 | 82.3% | 1 | 340 |
| 52 | `agent-widget.js` | node | 329 | 0 | 329 | 100% | 1 | 329 |
| 53 | `api/_shared/ads-snowflake-core.js` | node | 760 | 433 | 327 | 43% | 1 | 327 |
| 54 | `landing-pages.html` | page | 525 | 203 | 322 | 61.3% | 1 | 322 |
| 55 | `api/_shared/brain-calendar.js` | node | 347 | 35 | 312 | 89.9% | 1 | 312 |
| 56 | `api/_shared/kb-files.js` | node | 283 | 0 | 283 | 100% | 1 | 283 |
| 57 | `api/_shared/video-core.js` | node | 447 | 164 | 283 | 63.3% | 1 | 283 |
| 58 | `api/_shared/adapters/google-ads-adapter.js` | node | 331 | 191 | 140 | 42.3% | 2 | 280 |
| 59 | `knowledge-base.html` | page | 514 | 235 | 279 | 54.3% | 1 | 279 |
| 60 | `credits.js` | node+browser | 469 | 330 | 139 | 29.6% | 2 | 278 |
| 61 | `api/_shared/reference-intel.js` | node | 479 | 204 | 275 | 57.4% | 1 | 275 |
| 62 | `chart-enhance.js` | node+browser | 487 | 220 | 267 | 54.8% | 1 | 267 |
| 63 | `api/_shared/lifecycle-cohorts.js` | node | 265 | 0 | 265 | 100% | 1 | 265 |
| 64 | `lifecycle-3d-connector-engine.js` | node+browser | 673 | 418 | 255 | 37.9% | 1 | 255 |
| 65 | `api/_shared/data-validation-core.js` | node | 251 | 0 | 251 | 100% | 1 | 251 |
| 66 | `api/_shared/ci-collect.js` | node | 249 | 0 | 249 | 100% | 1 | 249 |
| 67 | `api/_shared/revenue-analysis-core.js` | node | 352 | 106 | 246 | 69.9% | 1 | 246 |
| 68 | `api/_shared/shopify-core.js` | node | 540 | 296 | 244 | 45.2% | 1 | 244 |
| 69 | `calendar.html` | page | 534 | 296 | 238 | 44.6% | 1 | 238 |
| 70 | `ads-dashboard.html` | page | 351 | 120 | 231 | 65.8% | 1 | 231 |
| 71 | `ads-masterclass.html` | page | 223 | 0 | 223 | 100% | 1 | 223 |
| 72 | `api/_shared/journey-core.js` | node | 348 | 126 | 222 | 63.8% | 1 | 222 |
| 73 | `_sbtest.html` | page | 215 | 0 | 215 | 100% | 1 | 215 |
| 74 | `api/_shared/snowflake-sync-core.js` | node | 207 | 0 | 207 | 100% | 1 | 207 |
| 75 | `data-analysis.html` | page | 816 | 616 | 200 | 24.5% | 1 | 200 |
| 76 | `lifecycle-usa-july-calendar-mailer-studio.html` | page | 199 | 0 | 199 | 100% | 1 | 199 |
| 77 | `api/_shared/llm.js` | node | 776 | 583 | 193 | 24.9% | 1 | 193 |
| 78 | `api/_shared/adapters/webengage-adapter.js` | node | 210 | 114 | 96 | 45.7% | 2 | 192 |
| 79 | `api/_shared/asset-agent.js` | node | 190 | 0 | 190 | 100% | 1 | 190 |
| 80 | `api/_shared/ad-metrics-catalog.js` | node | 183 | 0 | 183 | 100% | 1 | 183 |
| 81 | `api/_shared/ads-live-core.js` | node | 308 | 125 | 183 | 59.4% | 1 | 183 |
| 82 | `api/_shared/brand-context-pack.js` | node | 2163 | 1986 | 177 | 8.2% | 1 | 177 |
| 83 | `social-media.html` | page | 297 | 124 | 173 | 58.2% | 1 | 173 |
| 84 | `api/_shared/ci-subscriptions-core.js` | node | 171 | 0 | 171 | 100% | 1 | 171 |
| 85 | `api/_shared/quality-loop.js` | node | 171 | 0 | 171 | 100% | 1 | 171 |
| 86 | `api/_shared/competitive-benchmark-core.js` | node | 370 | 205 | 165 | 44.6% | 1 | 165 |
| 87 | `assets.html` | page | 345 | 180 | 165 | 47.8% | 1 | 165 |
| 88 | `api/_shared/preflight-core.js` | node | 250 | 168 | 82 | 32.8% | 2 | 164 |
| 89 | `api/_shared/model-router.js` | node | 152 | 0 | 152 | 100% | 1 | 152 |
| 90 | `api/_shared/agentic-orchestrator.js` | node | 182 | 32 | 150 | 82.4% | 1 | 150 |
| 91 | `payments.html` | page | 399 | 324 | 75 | 18.8% | 2 | 150 |
| 92 | `playbook.html` | page | 286 | 137 | 149 | 52.1% | 1 | 149 |
| 93 | `api/_shared/alert-channels.js` | node | 173 | 33 | 140 | 80.9% | 1 | 140 |
| 94 | `lifecycle-calendar.html` | page | 342 | 202 | 140 | 40.9% | 1 | 140 |
| 95 | `api/_shared/brand-assets-core.js` | node | 139 | 0 | 139 | 100% | 1 | 139 |
| 96 | `api/_shared/sync-core.js` | node | 250 | 112 | 138 | 55.2% | 1 | 138 |
| 97 | `api/_shared/alerts-core.js` | node | 136 | 0 | 136 | 100% | 1 | 136 |
| 98 | `api/_shared/landing-page-core.js` | node | 269 | 134 | 135 | 50.2% | 1 | 135 |
| 99 | `api/_shared/data-analysis-core.js` | node | 410 | 278 | 132 | 32.2% | 1 | 132 |
| 100 | `api/_shared/brain-analysis.js` | node | 256 | 126 | 130 | 50.8% | 1 | 130 |
| 101 | `analysis-registry.js` | node+browser | 476 | 348 | 128 | 26.9% | 1 | 128 |
| 102 | `api/_shared/lp-design-loop.js` | node | 181 | 53 | 128 | 70.7% | 1 | 128 |
| 103 | `api/_shared/pagedeck-core.js` | node | 252 | 125 | 127 | 50.4% | 1 | 127 |
| 104 | `api/_shared/webengage-core.js` | node | 197 | 75 | 122 | 61.9% | 1 | 122 |
| 105 | `api/_shared/ads-insight-engine.js` | node | 282 | 161 | 121 | 42.9% | 1 | 121 |
| 106 | `api/_shared/brain-core.js` | node | 263 | 143 | 120 | 45.6% | 1 | 120 |
| 107 | `api/_shared/feature-agent.js` | node | 196 | 77 | 119 | 60.7% | 1 | 119 |
| 108 | `api/_shared/brain-review.js` | node | 118 | 0 | 118 | 100% | 1 | 118 |
| 109 | `api/_shared/adapters/base-adapter.js` | node | 422 | 363 | 59 | 14% | 2 | 118 |
| 110 | `api/_shared/competitor-universe.js` | node | 846 | 729 | 117 | 13.8% | 1 | 117 |
| 111 | `scripts/lib/ad-creative.js` | node | 117 | 0 | 117 | 100% | 1 | 117 |
| 112 | `api/_shared/review-recovery.js` | node | 188 | 74 | 114 | 60.6% | 1 | 114 |
| 113 | `credits.html` | page | 214 | 160 | 54 | 25.2% | 2 | 108 |
| 114 | `api/_shared/brand-extract.js` | node | 2327 | 2220 | 107 | 4.6% | 1 | 107 |
| 115 | `api/_shared/brand-reviews.js` | node | 499 | 394 | 105 | 21% | 1 | 105 |
| 116 | `brand-context.js` | node+browser | 732 | 630 | 102 | 13.9% | 1 | 102 |
| 117 | `api/_shared/ci-enrich.js` | node | 98 | 0 | 98 | 100% | 1 | 98 |
| 118 | `api/_shared/adapters/extensible-crm.js` | node | 280 | 231 | 49 | 17.5% | 2 | 98 |
| 119 | `brand-catalog.js` | node+browser | 245 | 153 | 92 | 37.6% | 1 | 92 |
| 120 | `api/_shared/ads-sop-core.js` | node | 302 | 211 | 91 | 30.1% | 1 | 91 |
| 121 | `sw.js` | node | 91 | 0 | 91 | 100% | 1 | 91 |
| 122 | `api/_shared/connectors-health.js` | node | 89 | 0 | 89 | 100% | 1 | 89 |
| 123 | `api/_shared/gif-core.js` | node | 89 | 0 | 89 | 100% | 1 | 89 |
| 124 | `api/_shared/ci-funnel.js` | node | 87 | 0 | 87 | 100% | 1 | 87 |
| 125 | `brand-demo.js` | node+browser | 247 | 160 | 87 | 35.2% | 1 | 87 |
| 126 | `api/_shared/content-core.js` | node | 86 | 0 | 86 | 100% | 1 | 86 |
| 127 | `kicksgpt.html` | page | 183 | 97 | 86 | 47% | 1 | 86 |
| 128 | `api/_shared/agent-builder-core.js` | node | 302 | 219 | 83 | 27.5% | 1 | 83 |
| 129 | `api/_shared/connector-check.js` | node | 83 | 0 | 83 | 100% | 1 | 83 |
| 130 | `api/_shared/klaviyo-sync.js` | node | 83 | 0 | 83 | 100% | 1 | 83 |
| 131 | `retention-playbook.html` | page | 128 | 46 | 82 | 64.1% | 1 | 82 |
| 132 | `scripts/lib/landing-page.js` | node | 80 | 0 | 80 | 100% | 1 | 80 |
| 133 | `api/_shared/ad-insights-core.js` | node | 252 | 173 | 79 | 31.3% | 1 | 79 |
| 134 | `campaign.html` | page | 78 | 0 | 78 | 100% | 1 | 78 |
| 135 | `api/_shared/motion-design.js` | node | 191 | 115 | 76 | 39.8% | 1 | 76 |
| 136 | `table-sort.js` | node+browser | 216 | 140 | 76 | 35.2% | 1 | 76 |
| 137 | `api/_shared/ci-email-bridge.js` | node | 75 | 0 | 75 | 100% | 1 | 75 |
| 138 | `competitive-intelligence.html` | page | 119 | 44 | 75 | 63% | 1 | 75 |
| 139 | `api/_shared/require-caller.js` | node | 130 | 93 | 37 | 28.5% | 2 | 74 |
| 140 | `agent.html` | page | 246 | 175 | 71 | 28.9% | 1 | 71 |
| 141 | `api/_shared/ci-offers.js` | node | 196 | 125 | 71 | 36.2% | 1 | 71 |
| 142 | `api/_shared/scenario-model.js` | node | 538 | 468 | 70 | 13% | 1 | 70 |
| 143 | `api/_shared/calendar-scenarios.js` | node | 95 | 30 | 65 | 68.4% | 1 | 65 |
| 144 | `api/_shared/klaviyo-core.js` | node | 185 | 120 | 65 | 35.1% | 1 | 65 |
| 145 | `data-engine.html` | page | 128 | 64 | 64 | 50% | 1 | 64 |
| 146 | `api/_shared/platform-agents-core.js` | node | 350 | 289 | 61 | 17.4% | 1 | 61 |
| 147 | `api/_shared/brain-kb.js` | node | 96 | 36 | 60 | 62.5% | 1 | 60 |
| 148 | `premium-experience.html` | page | 251 | 191 | 60 | 23.9% | 1 | 60 |
| 149 | `api/_shared/supa.js` | node | 155 | 125 | 30 | 19.4% | 2 | 60 |
| 150 | `api/_shared/copy-frameworks.js` | node | 293 | 234 | 59 | 20.1% | 1 | 59 |
| 151 | `data-analysis-extensions.js` | node+browser | 643 | 585 | 58 | 9% | 1 | 58 |
| 152 | `api/_shared/creative-image.js` | node | 55 | 0 | 55 | 100% | 1 | 55 |
| 153 | `api/_shared/calendar-export.js` | node | 350 | 299 | 51 | 14.6% | 1 | 51 |
| 154 | `api/_shared/adapters/registry.js` | node | 135 | 112 | 23 | 17% | 2 | 46 |
| 155 | `all-in-one.html` | page | 151 | 106 | 45 | 29.8% | 1 | 45 |
| 156 | `api/_shared/brain-competitor.js` | node | 111 | 67 | 44 | 39.6% | 1 | 44 |
| 157 | `api/_shared/offering-campaign.js` | node | 155 | 113 | 42 | 27.1% | 1 | 42 |
| 158 | `terms.html` | page | 42 | 0 | 42 | 100% | 1 | 42 |
| 159 | `api/_shared/brand-suggest.js` | node | 245 | 205 | 40 | 16.3% | 1 | 40 |
| 160 | `daily-email-calendar.html` | page | 310 | 271 | 39 | 12.6% | 1 | 39 |
| 161 | `api/_shared/ingest-guardrail.js` | node | 167 | 129 | 38 | 22.8% | 1 | 38 |
| 162 | `brand.html` | page | 237 | 199 | 38 | 16% | 1 | 38 |
| 163 | `privacy.html` | page | 37 | 0 | 37 | 100% | 1 | 37 |
| 164 | `research.html` | page | 162 | 125 | 37 | 22.8% | 1 | 37 |
| 165 | `api/_shared/brand-placeholder.js` | node | 51 | 15 | 36 | 70.6% | 1 | 36 |
| 166 | `connectors.html` | page | 84 | 48 | 36 | 42.9% | 1 | 36 |
| 167 | `api/_shared/mailer-format.js` | node | 115 | 80 | 35 | 30.4% | 1 | 35 |
| 168 | `api/_shared/growth-os-core.js` | node | 1008 | 974 | 34 | 3.4% | 1 | 34 |
| 169 | `api/_shared/output-reasoning.js` | node | 321 | 287 | 34 | 10.6% | 1 | 34 |
| 170 | `api/_shared/mailer-design-strategy.js` | node | 117 | 86 | 31 | 26.5% | 1 | 31 |
| 171 | `team.html` | page | 46 | 16 | 30 | 65.2% | 1 | 30 |
| 172 | `api/_shared/agentic-ideation.js` | node | 41 | 13 | 28 | 68.3% | 1 | 28 |
| 173 | `api/_shared/data-classification.js` | node | 80 | 52 | 28 | 35% | 1 | 28 |
| 174 | `api/_shared/market-analytics.js` | node | 290 | 265 | 25 | 8.6% | 1 | 25 |
| 175 | `api/_shared/calendar-guardrails.js` | node | 200 | 176 | 24 | 12% | 1 | 24 |
| 176 | `music.html` | page | 63 | 39 | 24 | 38.1% | 1 | 24 |
| 177 | `api/_shared/brand-runtime.js` | node | 396 | 373 | 23 | 5.8% | 1 | 23 |
| 178 | `connector-3d.html` | page | 114 | 91 | 23 | 20.2% | 1 | 23 |
| 179 | `api/_shared/credit-catalog.js` | node | 285 | 274 | 11 | 3.9% | 2 | 22 |
| 180 | `api/_shared/brand-harvest.js` | node | 218 | 197 | 21 | 9.6% | 1 | 21 |
| 181 | `api/_shared/asset-specs.js` | node | 197 | 179 | 18 | 9.1% | 1 | 18 |
| 182 | `landing-page-agent.html` | page | 26 | 8 | 18 | 69.2% | 1 | 18 |
| 183 | `motion.js` | node+browser | 121 | 103 | 18 | 14.9% | 1 | 18 |
| 184 | `api/_shared/brand-catalog-server.js` | node | 445 | 430 | 15 | 3.4% | 1 | 15 |
| 185 | `chat-history.js` | node+browser | 73 | 58 | 15 | 20.5% | 1 | 15 |
| 186 | `api/_shared/cohort-engine.js` | node | 445 | 431 | 14 | 3.1% | 1 | 14 |
| 187 | `api/_shared/site-crawl.js` | node | 634 | 627 | 7 | 1.1% | 2 | 14 |
| 188 | `api/_shared/brand-facts.js` | node | 77 | 65 | 12 | 15.6% | 1 | 12 |
| 189 | `api/_shared/domain-intel.js` | node | 305 | 294 | 11 | 3.6% | 1 | 11 |
| 190 | `uk-non-engagers.html` | page | 99 | 89 | 10 | 10.1% | 1 | 10 |
| 191 | `growth-os.html` | page | 402 | 393 | 9 | 2.2% | 1 | 9 |
| 192 | `region-context.js` | node+browser | 465 | 456 | 9 | 1.9% | 1 | 9 |
| 193 | `api/_shared/read-only-egress.js` | node | 63 | 59 | 4 | 6.3% | 2 | 8 |
| 194 | `api/_shared/image-prompt.js` | node | 159 | 153 | 6 | 3.8% | 1 | 6 |
| 195 | `api/_shared/master-prompt.js` | node | 412 | 406 | 6 | 1.5% | 1 | 6 |
| 196 | `official-designs.html` | page | 25 | 19 | 6 | 24% | 1 | 6 |
| 197 | `scripts/lib/flagship-mailer.js` | node | 138 | 134 | 4 | 2.9% | 1 | 4 |
| 198 | `website-designs.html` | page | 17 | 14 | 3 | 17.6% | 1 | 3 |
| 199 | `api/_shared/asset-contracts.js` | node | 521 | 519 | 2 | 0.4% | 1 | 2 |
| 200 | `api/_shared/revenue-model.js` | node | 124 | 122 | 2 | 1.6% | 1 | 2 |
| 201 | `app-audit.html` | page | 91 | 89 | 2 | 2.2% | 1 | 2 |
| 202 | `api/_shared/ad-rows-core.js` | node | 205 | 204 | 1 | 0.5% | 1 | 1 |
| 203 | `api/_shared/catalog-image.js` | node | 177 | 176 | 1 | 0.6% | 1 | 1 |
| 204 | `avatars.html` | page | 94 | 93 | 1 | 1.1% | 1 | 1 |
| 205 | `cohort-definitions.html` | page | 168 | 167 | 1 | 0.6% | 1 | 1 |
| 206 | `data-analysis-contrast.html` | page | 1 | 0 | 1 | 100% | 1 | 1 |
| 207 | `design-intelligence.html` | page | 28 | 27 | 1 | 3.6% | 1 | 1 |
| 208 | `index.html` | page | 23 | 22 | 1 | 4.3% | 1 | 1 |
| 209 | `mailer-discovery.html` | page | 1 | 0 | 1 | 100% | 1 | 1 |
| 210 | `template-gallery.html` | page | 1 | 0 | 1 | 100% | 1 | 1 |
| 211 | `api/_shared/ads-qa.js` | node | 94 | 94 | 0 | 0% | 1 | 0 |
| 212 | `api/_shared/creative-evidence.js` | node | 274 | 274 | 0 | 0% | 1 | 0 |
| 213 | `api/_shared/demo-mode.js` | node | 256 | 256 | 0 | 0% | 1 | 0 |
| 214 | `api/_shared/evidence-policy.js` | node | 69 | 69 | 0 | 0% | 1 | 0 |
| 215 | `api/_shared/jarvis.js` | node | 138 | 138 | 0 | 0% | 1 | 0 |
| 216 | `api/_shared/kb-url.js` | node | 36 | 36 | 0 | 0% | 2 | 0 |
| 217 | `api/_shared/landing-fallback.js` | node | 102 | 102 | 0 | 0% | 1 | 0 |
| 218 | `api/_shared/live-connectors.js` | node | 33 | 33 | 0 | 0% | 2 | 0 |
| 219 | `api/_shared/logo-brief.js` | node | 141 | 141 | 0 | 0% | 1 | 0 |
| 220 | `api/_shared/offering-kinds.js` | node | 120 | 120 | 0 | 0% | 1 | 0 |
| 221 | `api/_shared/request-scope.js` | node | 72 | 72 | 0 | 0% | 2 | 0 |
| 222 | `api/_shared/rfm-core.js` | node | 135 | 135 | 0 | 0% | 1 | 0 |
| 223 | `api/_shared/storefront-detect.js` | node | 426 | 426 | 0 | 0% | 2 | 0 |
| 224 | `api/_shared/workspace-scope.js` | node | 310 | 310 | 0 | 0% | 2 | 0 |
| 225 | `scripts/lib/motion-ad.js` | node | 379 | 379 | 0 | 0% | 1 | 0 |

10 tracked root pages carry no inline `<script>` block and have nothing to measure here (their behaviour lives in the shared root scripts above): `about.html`, `ad-campaigns-master.html`, `coffee-collection-landing-no-agent.html`, `coffee-collection-landing-with-agent.html`, `diff-version.html`, `frameworks.html`, `knickgasm-grail-drop-presell-v5-variantA.html`, `knickgasm-grail-drop-presell-v5-variantB.html`, `knickgasm-lifecycle-campaign-from-the-30-d-us-variantB.html`, `styleguide.html`.

## The 25 worst — uncovered line ranges

One row per contiguous uncovered run of 3+ lines, in file order (capped at 45 per file; runs of 1–2 lines are summarised beneath). The note names the innermost enclosing function from V8's own function ranges; when the run is only part of that function, the first line of code in the run is quoted so the branch can be found without re-deriving it. Line numbers are 1-based and refer to the file at the commit above.

### 1. `lifecycle_mailer_architect_v34.html` — 5405 uncovered of 8415 (64.2%), weight 1, score 5405

Inline blocks: 4 of 4 executed by at least one test.

| lines | note |
|---|---|
| L1410–1412 | in `getSupabase()`: `console.warn('[Supabase] SDK not loaded — check internet / CDN access');` |
| L1414–1421 | in `getSupabase()`: `console.warn('[Supabase] Config still has placeholders — fill in url + anonKey');` |
| L1571–1583 | `_resolveTables()` never called |
| L1589–1609 | `supabaseSaveCampaign()` never called |
| L1611–1619 | `supabaseFetchCampaigns()` never called |
| L1621–1629 | `supabaseUpsertUser()` never called |
| L1636–1653 | `runKnickgasmTests()` never called, also `_eq()`, `_truthy()` |
| L1660–1682 | `statusPill()` never called |
| L1690–1701 | in `loadKnowledgeBase()`: `try{` |
| L1707–1711 | `kbPalette()` never called, also `kbTypography()`, `kbMarket()`, `kbProductsForMarket()`, `kbCollections()` |
| L1714–1728 | `buildClaudeSystemPromptFromKB()` never called |
| L1733–1745 | `_dataUrlToBlob()` never called, also `_publicStorageUrl()` |
| L1747–1775 | `supabaseUploadImage()` never called |
| L1779–1792 | `supabaseHostImageMatrix()` never called |
| L1812–1820 | in `pdpUrl()`: `var found=CAT.find(function(c){return c.n===name;});` |
| L1850–1852 | in `collectionUrl()`: `var t=detectType(p);` |
| L1870–1873 | `goBack()` never called |
| L2015–2040 | `toggleProd()` never called |
| L2074–2091 | `activateAutoPick()` never called, also `clearSel()` |
| L2102–2138 | `selectType()` never called |
| L2173–2179 | in `_doAutoUpdateChips()`: `document.querySelectorAll('.mkt-chip').forEach(function(b){` |
| L2254–2266 | `toggleMarket()` never called |
| L2270–2274 | `_getApiHeaders()` never called |
| L2289–2292 | in `_updateSmartAIBtn()`: `btn.innerHTML='&#127775; Create Brief with AI';` |
| L2323–2328 | in `brandPaletteCheck()`: `if(!/<\/html>/i.test(html)){err(label+' HTML missing closing </html> tag.');}` |
| L2333–2339 | in `brandPaletteCheck()`: `var ALLOWED={'#fff':1,'#ffffff':1,'#000':1,'#000000':1};` |
| L2346–2348 | in `brandPaletteCheck()`: `var softBad=off.filter(function(h){return hardBad.indexOf(h)<0;});` |
| L2356–2358 | in `brandPaletteCheck()`: `if(!/(SHOP\|ADD TO CART\|CLAIM\|EXPLORE\|BEGIN\|READ\|MEET\|CURATE\|TRY\|BUILD)/i.test(html)){warn(label…` |
| L2368–2402 | `gateFinalOutput()` never called, also `_focusFeedbackForRegen()` |
| L2404–2430 | `clearAndCreate()` never called |
| L2435–2472 | `generateAudienceWithAI()` never called |
| L2489–2491 | `smartAIBrief()` never called |
| L2493–2661 | `createPromptWithAI()` never called |
| L2664–2694 | `enhancePrompt()` never called, also `updatePromptPlaceholder()` |
| L2696–2800 | `buildEnhancedPrompt()` never called |
| L2804–2816 | `toggleSuggestedPrompts()` never called |
| L2851–2896 | `renderSuggestedPrompts()` never called, also `useSuggestedPromptByIdx()` |
| L2899–2927 | `renderMarketTabs()` never called |
| L2929–2946 | `_resolveMailerHtml()` never called, also `downloadMarketMailer()` |
| L2949–2954 | in `window.previewMailerInModal()`: `_ensureMailerBuilt&&_ensureMailerBuilt(mkt,S.activeVariant\|\|'A');` |
| L2958–2982 | in `window.viewMarketHtml()`: `_ensureMailerBuilt&&_ensureMailerBuilt(mkt,S.activeVariant\|\|'A');` |
| L2984–3000 | `showMarketMailer()` never called |
| L3030–3042 | `showValidErr()` never called |
| L3097–3112 | `go3()` never called |
| L3160–3166 | `_getReviewList()` never called |
| … | 107 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 32 runs of 1–2 lines: L694, L1319–1320, L1408, L1796, L1894–1895, L1903, L1934, L1965–1966, L1975, L2004–2005, L2064–2065, L3054–3055, L3276, L3528–3529, L3531–3532, L3555, L3563–3564, L3599–3600, L3602–3603, L3605, L3853, L3897–3898, L4323, L6223–6224, L6784, L6929–6930, L9365–9366, L9542, L9584–9585, L9659–9660, L9679, L9694 |

### 2. `api/brain.js` — 1205 uncovered of 1205 (100%), weight 2, score 2410

| lines | note |
|---|---|
| L1–1205 | never loaded by any test — top-level: core, kb, analysis, competitor, calendar, generate, review, agents, jarvis, agentic, calendarScenarios, smartbrain, brandLlm, klaviyo … (+14 more) |

### 3. `api/ai/pipeline/html.js` — 1066 uncovered of 1066 (100%), weight 2, score 2132

| lines | note |
|---|---|
| L1–1066 | never loaded by any test — top-level: callLLM, MF, SYSTEM |

### 4. `dashboard.html` — 1587 uncovered of 1989 (79.8%), weight 1, score 1587

Inline blocks: 4 of 4 executed by at least one test.

| lines | note |
|---|---|
| L792–796 | `fmtCur()` never called |
| L798–815 | `fmtCurShort()` never called |
| L819–841 | `bucketKeyLabel()` never called |
| L855–859 | `rngFromSeed()` never called |
| L927–1062 | `genSeed()` never called |
| L1096–1112 | `inWindow()` never called, also `matchRegion()`, `filteredCampaigns()`, `filteredOrders()`, `filteredCustomers()` |
| L1117–1144 | `calcExecKpis()` never called |
| L1146–1162 | `calcCampaignKpis()` never called |
| L1164–1188 | `calcProductKpis()` never called |
| L1196–1202 | `quintileScorer()` never called |
| L1204–1229 | `computeSegments()` never called |
| L1231–1250 | `segmentSummary()` never called |
| L1261–1302 | `computeCohorts()` never called |
| L1307–1343 | `buildAffinityMatrix()` never called |
| L1348–1516 | `computeInsights()` never called |
| L1526–1529 | `destroyCharts()` never called |
| L1548–1641 | `renderExec()` never called |
| L1644–1750 | `renderCampaigns()` never called |
| L1753–1822 | `renderSegments()` never called |
| L1825–1909 | `renderProducts()` never called |
| L1912–1994 | `renderTime()` never called |
| L1997–2068 | `renderCohorts()` never called |
| L2071–2097 | `renderInsights()` never called |
| L2102–2109 | `kpi()` never called, also `escapeHtml()` |
| L2111–2115 | `campNameCell()` never called |
| L2120–2126 | `switchView()` never called |
| L2133–2140 | in `rerender()`: `if (STATE.view === 'exec') renderExec();` |
| L2168–2172 | `if (isMobileNav()) { closeMobileDrawer(); return; }` |
| L2184–2187 | `if (!e.target.dataset.region) return;` |
| L2190–2195 | `const g = e.target.dataset.gran;` |
| L2204–2209 | `const cur = e.target.dataset.cur;` |
| L2226–2248 | `const file = e.target.files[0];` |
| L2253–2270 | `const append = $('uploadAppend').checked;` |
| L2273–2327 | `normalizeRow()` never called |
| L2330–2336 | `if (!confirm('Clear all data? This removes any uploaded or linked data and returns to the empty…` |
| L2354–2357 | `DB_TYPE = chip.dataset.dbtype;` |
| L2361–2363 | in `dbStatus()`: `const el = $('linkDbStatus');` |
| L2366–2374 | `fetchSupabaseTable()` never called |
| L2377–2414 | `dbStatus('Connecting…');` |
| L2432–2439 | `goldFillHex()` never called |
| L2444–2454 | `regionSummaryRows()` never called |
| L2456–2476 | `sendTimeSummaryRows()` never called |
| L2479–2568 | `tablesForView()` never called |
| L2570–2572 | `allTables()` never called |
| L2575–2580 | `fmtExportVal()` never called |
| … | 8 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 9 runs of 1–2 lines: L53, L789, L846–847, L2145–2146, L2149–2150, L2212, L2711–2712, L2726, L2741 |

### 5. `api/_shared/smart-brain-plan.js` — 1303 uncovered of 2904 (44.9%), weight 1, score 1303

| lines | note |
|---|---|
| L48–68 | `syncSourcesFor()` never called |
| L72–88 | `stampAndRecordSync()` never called |
| L93–96 | `preLaunchSyncCheck()` never called |
| L100–111 | `syncStatus()` never called |
| L130–164 | `callLLMTiered()` never called |
| L242–256 | `planningBrand()` never called |
| L270–311 | `_resolveBrandOfferings()` never called |
| L352–357 | in `offeringPlanEntries()`: `const p = oc.planSend(o, date);` |
| L405–412 | `buildContext()` never called |
| L419–435 | `freshEntries()` never called |
| L443–451 | `cohortLtvMap()` never called, also `toHero()` |
| L456–470 | `buildStandbyVariant()` never called |
| L472–484 | `attachScenarioLayer()` never called |
| L489–505 | `promoteScenario()` never called |
| L510–518 | `effectiveEntry()` never called |
| L521–529 | `materialDiff()` never called |
| L534–544 | `pruneOldRecords()` never called |
| L548–719 | `syncDaily()` never called |
| L723–786 | `getPlan()` never called |
| L807–809 | in `regionalNuance()`: `if (m === 'IN') return 'India market: lead with authenticity, value clarity, and cultural momen…` |
| L818–849 | `brandSystem()` never called |
| L856–864 | `strategySystem()` never called |
| L877–887 | `offeringBrief()` never called |
| L889–904 | `strategyPrompt()` never called |
| L906–925 | `strategyBrief()` never called |
| L996–1000 | in `approvedProof()`: `quote: r.quote,` |
| L1042–1045 | in `loadBrandReviews()`: `entry.__reviews = [];` |
| L1454–1461 | `productUrl()` never called |
| L1572–1628 | `writeCopyWithLLM()` never called |
| L1633–1642 | `scrubCopyDeep()` never called |
| L1730–1732 | in `attachMotionCreative()`: `image: images[0] \|\| '',` |
| L1763–1766 | in `attachMotionCreative()`: `ad.creative = Object.assign({}, ad.creative, { motion_error: String((e && e.message) \|\| e).slic…` |
| L1932–1947 | `generateCreativeImage()` never called |
| L1953–1965 | `uploadCreative()` never called |
| L2106–2121 | in `_buildCampaign()`: `const product = entry.heroProduct \|\| {};` |
| L2132–2195 | in `_buildCampaign()`: `const sb = await strategyBrief(entry);` |
| L2260–2267 | in `reportProofGap()`: `if (Array.isArray(trace)) {` |
| L2304–2319 | `resolveEntry()` never called |
| L2323–2428 | `previewEntry()` never called |
| L2432–2509 | `approveEntry()` never called |
| L2511–2528 | `rejectEntry()` never called |
| L2534–2556 | `unrejectEntry()` never called |
| L2565–2607 | `activateScenario()` never called |
| L2616–2644 | `landingPageResolve()` never called, also `landingPageHtml()` |
| L2653–2676 | `republishOrphan()` never called |
| … | 6 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 11 runs of 1–2 lines: L193–194, L200, L348, L1077, L1080, L1281, L1292, L1299, L1551, L1776–1777, L1831–1832 |

### 6. `api/ai/generate.js` — 610 uncovered of 1045 (58.4%), weight 2, score 1220

| lines | note |
|---|---|
| L37–53 | `deepScrubDashes()` never called |
| L341–351 | in `handler()`: `res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, x-user-gemini-key');` |
| L354–360 | in `handler()`: `return res.status(500).json({ error: 'server_misconfigured', detail: 'No AI provider configured…` |
| L385–794 | in `handler()`: `systemPrompt = SYSTEM_PROMPT_SUGGESTED_PROMPTS;` |
| L818–831 | in `handler()`: `const _rt = require('../_shared/brand-runtime.js');` |
| L833–846 | in `handler()`: `let result = null;` |
| L855–871 | in `handler()`: `result = { ok: true, text: out.text, provider: out.provider, model: out.model };` |
| L873–916 | in `handler()`: `if (mode === 'create_brief') {` |
| L919–992 | in `handler()`: `let parsed;` |
| short runs | 1 runs of 1–2 lines: L332–333 |

### 7. `api/competitor.js` — 560 uncovered of 560 (100%), weight 2, score 1120

| lines | note |
|---|---|
| L1–560 | never loaded by any test — top-level: core, universe, ciCollect, ciOffers, ciFunnel, getEnrich(), supa, readBody(), POLL_THROTTLE_MS, lastPoll, lastResult, bearerOf(), universeContext(), authorized() |

### 8. `api/_shared/brand-workspace-core.js` — 1018 uncovered of 1910 (53.3%), weight 1, score 1018

| lines | note |
|---|---|
| L141–145 | in `restAs()`: `const msg = (json && (json.message \|\| json.hint)) \|\| text \|\| res.statusText;` |
| L313–315 | in `readableAsText()`: (blank/comment lines) |
| L326–329 | `slugify()` never called |
| L336–339 | `arr()` never called |
| L341–348 | `httpUrl()` never called |
| L362–365 | in `normalizePalette()`: `const hex = normHex(e && e.hex);` |
| L370–383 | `normalizeFont()` never called |
| L385–395 | `normalizeTypography()` never called |
| L397–406 | `normalizeVoice()` never called |
| L408–424 | `normalizeRegions()` never called |
| L426–438 | `normalizeHosts()` never called |
| L576–590 | `fontsHref()` never called |
| L599–642 | `readiness()` never called |
| L647–668 | `parseCsv()` never called |
| L686–695 | `mapHeaders()` never called |
| L697–700 | `num()` never called |
| L702–708 | `boolish()` never called |
| L710–712 | `splitList()` never called |
| L714–752 | `rowsFromCsv()` never called |
| L754–788 | `rowsFromJson()` never called |
| L833–845 | in `v6Groups()`: `const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);` |
| L849–851 | in `v6Groups()`: `const fill = 8 - head.length - tail.length;` |
| L854–862 | in `v6Groups()`: `const out = [];` |
| L872–874 | in `isPrivateIp()`: `if (g.every((x) => x === 0)) return true;` |
| L876–879 | in `isPrivateIp()`: `const firstSixZero = g.slice(0, 5).every((x) => x === 0);` |
| L881–884 | in `isPrivateIp()`: `const o = [(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff];` |
| L886–893 | in `isPrivateIp()`: `return isPrivateV4([(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff]);` |
| L913–915 | in `assertPublicUrl()`: `const e = new Error('That hostname resolves to a private or internal address, so it cannot be i…` |
| L918–922 | in `assertPublicUrl()`: `if (err && err.status === 400) throw err;` |
| L943–1005 | `rowsFromSite()` never called |
| L1007–1043 | `rowsFromStorefront()` never called |
| L1060–1063 | `invalidateBrandCaches()` never called |
| L1067–1070 | `listWorkspaces()` never called |
| L1077–1082 | `productCount()` never called |
| L1104–1118 | `seedCompetitorsOnActivation()` never called |
| L1120–1133 | `setActive()` never called |
| L1136–1176 | `buildRow()` never called |
| L1209–1213 | in `claimedFields()`: `for (const k of ['claims', 'social', 'legal_entity']) {` |
| L1226–1238 | `claimUserOwnedFields()` never called |
| L1240–1266 | `saveWorkspace()` never called |
| L1282–1322 | `deleteWorkspace()` never called |
| L1329–1331 | in `assertCanWrite()`: `let role = 'viewer';` |
| L1335–1339 | in `assertCanWrite()`: `const e = new Error(`Your role on this brand is "${role}", which can view it but not ${what \|\| …` |
| L1341–1474 | `importCatalog()` never called |
| L1476–1482 | `listCatalog()` never called |
| … | 24 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 10 runs of 1–2 lines: L256–257, L453–454, L469–470, L472–473, L476–477, L479–480, L485–486, L491–492, L1596–1597, L1712–1713 |

### 9. `api/ai/pipeline/variant.js` — 485 uncovered of 485 (100%), weight 2, score 970

| lines | note |
|---|---|
| L1–485 | never loaded by any test — top-level: callLLM, SYSTEM_A, SYSTEM_B |

### 10. `api/calendar.js` — 458 uncovered of 458 (100%), weight 2, score 916

| lines | note |
|---|---|
| L1–458 | never loaded by any test — top-level: generate, lifecycleGen, lifecycleBuild, triggerMailer, plan, calExport, readBody(), selfBaseUrl(), firePrebuild(), smartBrain(), lifecycle(), _credits, _CAL_FEATURE |

### 11. `api/_shared/social-core.js` — 881 uncovered of 881 (100%), weight 1, score 881

| lines | note |
|---|---|
| L1–881 | never loaded by any test — top-level: fs, path, callLLM, scenario, creative, catalogImage, video, push, brandPlaceholder, supa, TABLE, PIPELINE_BUDGET_MS, MARKET, PLATFORM_SPECS … (+56 more) |

### 12. `api/ai/pipeline/strategy.js` — 435 uncovered of 435 (100%), weight 2, score 870

| lines | note |
|---|---|
| L1–435 | never loaded by any test — top-level: callLLM, SYSTEM |

### 13. `api/kb.js` — 431 uncovered of 862 (50%), weight 2, score 862

| lines | note |
|---|---|
| L87–128 | `ingestFiles()` never called |
| L152–190 | `ingestSite()` never called |
| L232–234 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L237–239 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L268–270 | in `handler()`: `return res.status(400).json({ ok: false, error: 'Unknown action. Use ?action=ingest\|ingest-file…` |
| L309–336 | in `brandKit()`: `const body = typeof req.body === 'string' ? JSON.parse(req.body \|\| '{}') : (req.body \|\| {});` |
| L341–430 | `dailyDigest()` never called |
| L511–525 | in `summarize()`: `if (!textBody \|\| textBody.length < 60) {` |
| L574–579 | in `ingest()`: `await fetch(`${env.url}/rest/v1/kb_knowledge?id=eq.${rowId}${queuedWs}`, {` |
| L601–607 | in `ingest()`: `await fetch(`${env.url}/rest/v1/kb_knowledge?id=eq.${rowId}${queuedWs}`, {` |
| L639–687 | `topEmails()` never called |
| L706–717 | in `brands()`: `const q = req.query \|\| {};` |
| L719–732 | in `brands()`: `const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body \|\| {});` |
| L749–760 | in `brands()`: `if (req.method === 'DELETE') {` |
| L765–856 | `classifyEmails()` never called |
| short runs | 9 runs of 1–2 lines: L49–50, L57–58, L66, L220–221, L247–248, L255–256, L260–261, L307, L554–555 |

### 14. `api/_shared/telesuite-core.js` — 797 uncovered of 1132 (70.4%), weight 1, score 797

| lines | note |
|---|---|
| L196–209 | `serviceRest()` never called |
| L220–243 | `context()` never called |
| L254–268 | `brandRules()` never called |
| L271–297 | `groundingFor()` never called |
| L300–312 | `ask()` never called |
| L314–323 | `logRun()` never called |
| L334–346 | in `OPS.product_description()`: `const name = str(input.name \|\| input.product, 200);` |
| L349–361 | in `OPS.kb_ingest()`: `const content = str(input.content, 20000);` |
| L366–382 | in `OPS.pitch()`: `const grounding = await groundingFor(ctx, { product: str(input.product), kbIds: input.kb });` |
| L385–397 | `fallbackRebuttal()` never called |
| L400–419 | in `OPS.rebuttal()`: `const objection = str(input.objection, 2000);` |
| L424–449 | `geminiTranscribe()` never called |
| L452–474 | in `OPS.transcription()`: `const pasted = str(input.transcript, 200000);` |
| L486–514 | in `OPS.call_scoring()`: `const transcript = str(input.transcript, 120000);` |
| L519–553 | in `OPS.combined_analysis()`: `const ids = (Array.isArray(input.run_ids) ? input.run_ids : []).filter(Boolean).slice(0, 40);` |
| L556–576 | in `OPS.optimized_pitches()`: `const analysisId = str(input.analysis_id);` |
| L581–599 | in `OPS.training_deck()`: `const topic = str(input.topic, 400);` |
| L602–622 | in `OPS.data_analysis()`: `const description = str(input.description, 8000);` |
| L641–653 | `voiceSession()` never called |
| L664–712 | `billElapsed()` never called |
| L715–750 | in `OPS.voice_turn()`: `const mode = str(input.mode) === 'support' ? 'support' : 'sales';` |
| L760–846 | in `OPS.voice_finish()`: `const mode = str(input.mode) === 'support' ? 'support' : 'sales';` |
| L850–883 | `n8nWorkflow()` never called |
| L886–913 | `cloneManifest()` never called |
| L933–936 | `creditKeyFor()` never called |
| L939–949 | `unitsFor()` never called |
| L951–1130 | `handle()` never called |
| short runs | 2 runs of 1–2 lines: L190, L194 |

### 15. `lifecycle-usa-d2c-dashboard.html` — 784 uncovered of 937 (83.7%), weight 1, score 784

Inline blocks: 3 of 3 executed by at least one test.

| lines | note |
|---|---|
| L16–26 | `set()` never called |
| L191–193 | `dlXlsx()` never called |
| L195–197 | `dlPdf()` never called |
| L224–255 | `t8Extra()` never called, also `t3Sku()`, `mkChart()` |
| L258–290 | `ptbl()` never called, also `drawPg()`, `pgGo()`, `pgMove()`, `renderPGs()` (+2) |
| L292–296 | `tbl()` never called, also `nm()` |
| L300–305 | `ml()` never called, also `mld()`, `byYear()`, `dl()`, `info()` |
| L308–329 | `tvData()` never called, also `tvRender()`, `tvGo()`, `tvApply()`, `carScroll()` |
| L332–340 | `granUI()` never called, also `granReg()`, `granGo()` |
| L342–345 | `yearFromMonthly()` never called, also `yearFromPairs()` |
| L347–366 | `yearCarousel()` never called, also `kpi()` |
| L373–377 | `lineLabels()` never called, also `barLabels()` |
| L384–387 | `inRng()` never called, also `weekStart()`, `wkLbl()`, `wkAgg()` |
| L391–394 | in `net()`: `if(g==='day')return {L:D.daily.map(function(x){return mld(x.d);}),V:D.daily.map(function(x){ret…` |
| L397–400 | in `orders()`: `if(g==='day')return {L:D.daily.map(function(x){return mld(x.d);}),V:D.daily.map(function(x){ret…` |
| L403–406 | in `sess()`: `if(g==='day'){var dd=D.daily.filter(function(x){return x.sessions!=null;});return {L:dd.map(fun…` |
| L409–412 | in `aov()`: `if(g==='day')return {L:D.daily.map(function(x){return mld(x.d);}),AV:D.daily.map(function(x){re…` |
| L415–419 | in `tickets()`: `if(g==='day'){var dt=D.daily_tickets\|\|[];return {L:dt.map(function(x){return mld(x.d);}),V:dt.m…` |
| L422–432 | `granUI()` never called, also `granReg()`, `granSync()`, `granGo()`, `granApply()` |
| L434–443 | `globalGran()` never called, also `globalApply()`, `globalReset()` |
| L453–491 | `histUI()` never called, also `openHist()`, `closeHist()`, `histGo()`, `histApply()` (+1) |
| L498–528 | in `render()`: `render(id){const A={};D.annual.forEach(a=>A[a.year]=a);const SB=D.subs_full;const X=D.cx;` |
| L532–584 | in `render()`: `render(id){const A={};D.annual.forEach(a=>A[a.year]=a);const SB=D.subs_full,X=D.cx;` |
| L589–636 | in `render()`: `render(id){const A={};D.annual.forEach(a=>A[a.year]=a);` |
| L641–707 | in `render()`: `render(id){const tot=D.cohort.reduce((s,c)=>s+c.newcust,0);` |
| L712–820 | in `render()`: `render(id){const s=D.cat_stats;const P=D.parity;` |
| L825–889 | in `render()`: `render(id){const F=D.fulfillment;const avg=F.reduce((s,f)=>s+f.avg_days,0)/F.length;const DV=D.…` |
| L894–945 | in `render()`: `render(id){const X=D.cx;` |
| L950–968 | in `render()`: `render(id){const C=D.category.slice(0,15);const total=D.category.reduce((s,c)=>s+c.gross,0);` |
| L984–1017 | in `render()`: `render(id){` |
| L1023–1054 | in `render()`: `render(id){var AA=D.access_audit\|\|{},GP=D.gaps\|\|[];` |
| L1063–1093 | `const DEMO_SRC = 'DEMO data, generated from the shipped catalogue. Not a measurement of the act…` |
| L1097–1100 | `renderAllForPrint()` never called |
| short runs | 1 runs of 1–2 lines: L28 |

### 16. `api/_shared/dispatch-core.js` — 384 uncovered of 542 (70.8%), weight 2, score 768

| lines | note |
|---|---|
| L54–63 | `serviceEnv()` never called |
| L65–76 | `rest()` never called |
| L131–215 | `enqueue()` never called |
| L224–238 | `claim()` never called |
| L240–247 | `runnableJobs()` never called |
| L251–362 | `runJob()` never called |
| L365–377 | `sanitizeResult()` never called |
| L381–393 | `logSync()` never called |
| L404–422 | `drain()` never called |
| L424–436 | `countRunnable()` never called |
| L439–447 | `fireNext()` never called |
| L451–463 | `cancel()` never called |
| L472–513 | `ingestWebhook()` never called |
| L517–525 | `listJobs()` never called |
| L527–536 | `jobDetail()` never called |
| short runs | 1 runs of 1–2 lines: L379 |

### 17. `api/_shared/brain-generate.js` — 732 uncovered of 830 (88.2%), weight 1, score 732

| lines | note |
|---|---|
| L51–55 | `gateTestis()` never called |
| L73–77 | `slotBrand()` never called |
| L79–86 | `productImage()` never called |
| L91–117 | `pickCampaignHubLP()` never called |
| L119–126 | `llmJson()` never called |
| L129–165 | `generateCopy()` never called |
| L170–190 | `clampStr()` never called, also `clampAds()` |
| L192–290 | `fallbackCopy()` never called |
| L293–435 | `mailerHtml()` never called |
| L443–476 | `mailerVariants()` never called |
| L478–644 | `landingHtml()` never called |
| L647–662 | `audienceSpec()` never called |
| L664–722 | `campaignObjects()` never called |
| L724–739 | `funnelSpec()` never called |
| L742–828 | `generateForSlot()` never called |

### 18. `telesuite.html` — 723 uncovered of 818 (88.4%), weight 1, score 723

Inline blocks: 1 of 1 executed by at least one test.

| lines | note |
|---|---|
| L168–170 | in `token()`: `try { if (window.BrandContext) return window.BrandContext.token(); } catch (_) {}` |
| L174–189 | in `ts()`: `var headers = { 'Content-Type': 'application/json' };` |
| L194–222 | in `renderValue()`: `depth = depth \|\| 0;` |
| L225–241 | in `renderResult()`: `if (!result) return '<p class="muted">No result.</p>';` |
| L244–269 | in `renderScore()`: `var dims = r.dimensions \|\| [];` |
| L273–292 | in `renderRail()`: `if (!document.getElementById('rail')) return; // single-layer nav: the app rail owns navigation` |
| L297–300 | in `head()`: `return '<div class="eyebrow">TeleSuite' + (s.group ? ' · ' + esc(s.group) : '') + '</div>' +` |
| L303–323 | in `viewHome()`: `$('main').innerHTML = head(s) + '<div id="homeGrid"><p class="muted">Loading your run history…<…` |
| L326–330 | in `loadItems()`: `if (cache[kind === 'product' ? 'products' : 'knowledge']) return cache[kind === 'product' ? 'pr…` |
| L333–418 | in `viewLibrary()`: `var kind = s.item_kind;` |
| L423–468 | in `fieldHtml()`: `if (f.type === 'product' \|\| f.type === 'kb') {` |
| L471–483 | in `collectInputs()`: `var out = {};` |
| L486–492 | in `fileToBase64()`: `return new Promise(function (resolve, reject) {` |
| L495–504 | in `audioDuration()`: `return new Promise(function (resolve) {` |
| L507–521 | in `handleRunError()`: `if (e.status === 402 && e.payload) {` |
| L524–572 | in `viewTool()`: `$('main').innerHTML = head(s) + '<div class="card"><div id="form"><p class="muted">Loading…</p>…` |
| L575–602 | in `renderRun()`: `var receipt = r.credits` |
| L606–644 | in `viewDashboard()`: `var feat = Array.isArray(s.of) ? s.of.join(',') : s.of;` |
| L648–670 | in `viewVoice()`: `var SR = window.SpeechRecognition \|\| window.webkitSpeechRecognition;` |
| L673–807 | in `runCall()`: `var history = [], startedAt = Date.now(), listening = false, ended = false, recog = null, speak…` |
| L811–870 | in `viewBatch()`: `$('main').innerHTML = head(s) +` |
| L874–897 | in `viewClone()`: `$('main').innerHTML = head(s) + '<div id="clone"><p class="muted">Loading…</p></div>';` |
| L900–914 | in `viewN8n()`: `$('main').innerHTML = head(s) + '<div id="n8n"><p class="muted">Building the workflow…</p></div…` |
| L918–933 | in `route()`: `var key = (location.hash \|\| '#home').slice(1) \|\| 'home';` |
| L944–958 | in `boot()`: `document.addEventListener('click', function (ev) {` |
| short runs | 1 runs of 1–2 lines: L967 |

### 19. `auth.js` — 359 uncovered of 2436 (14.7%), weight 2, score 718

Also loaded in the browser by page tests; counts are the union of both runtimes.

| lines | note |
|---|---|
| L51–55 | in `ensureTheme()`: `vp = d.createElement('meta');` |
| L142–147 | in `window.fetch()`: `if (input.headers && input.headers.get && input.headers.get('Authorization')) return nativeFetc…` |
| L151–155 | in `window.fetch()`: `opts.headers = headers;` |
| L201–227 | `window.addEventListener('load', async () => {` |
| L1648–1650 | in `injectTopbar()`: `if (e.key !== 'Escape') return;` |
| L1671–1675 | in `document.addEventListener.passive()`: `const n = navEl();` |
| L1678–1687 | in `document.addEventListener.passive()`: `if (!swiping) return;` |
| L1696–1706 | in `signinBtn.onclick()`: `if (window.LifecycleAuth?.client) {` |
| L1727–1729 | in `injectTopbar()`: `collapsed = !collapsed;` |
| L1753–1775 | in `injectSigningInOverlay()`: `if (document.getElementById('lifecycle-signingin')) return;` |
| L1777–1779 | in `removeSigningInOverlay()`: `const el = document.getElementById('lifecycle-signingin');` |
| L1896–1898 | in `getConfig()`: `window.__SUPABASE__ = PUBLIC_SUPABASE_FALLBACK;` |
| L2013–2016 | in `applyAccessMode()`: `window.LifecycleAuth.internal = !!user;` |
| L2039–2047 | in `restoreReturnTo()`: `let target = null;` |
| L2061–2070 | in `signOut()`: `if (window.LifecycleAuth.client) await window.LifecycleAuth.client.auth.signOut();` |
| L2114–2120 | in `init()`: `window.LifecycleAuth.session = session;` |
| L2122–2135 | in `init()`: `injectSigningInOverlay();` |
| L2144–2159 | in `init()`: `window.LifecycleAuth.session = sess;` |
| L2175–2209 | in `maybeShowProfileModal()`: `let alreadyLocal = false;` |
| L2212–2326 | in `showProfileModal()`: `if (document.getElementById('lifecycle-profile-modal')) return;` |
| L2373–2379 | in `inline()`: `return s` |
| L2381–2405 | in `mdToHtml()`: `var lines = String(md \|\| '').replace(/\r\n?/g, '\n').split('\n');` |
| L2416–2425 | in `openPrintable()`: `var w = window.open('', '_blank');` |
| short runs | 2 runs of 1–2 lines: L139–140, L2432 |

### 20. `api/_shared/oauth-core.js` — 341 uncovered of 515 (66.2%), weight 2, score 682

| lines | note |
|---|---|
| L53–62 | `serviceEnv()` never called |
| L64–80 | `serviceRest()` never called |
| L85–92 | `selfOrigin()` never called |
| L94–96 | `callbackUrl()` never called |
| L125–193 | `beginAuthorization()` never called |
| L195–202 | `clientIdFor()` never called |
| L204–211 | `clientSecretFor()` never called |
| L220–226 | `consumeState()` never called |
| L231–274 | `handleCallback()` never called |
| L277–320 | `exchangeCode()` never called |
| L322–327 | `failNote()` never called |
| L334–378 | `persistGrant()` never called |
| L393–436 | `ensureFreshToken()` never called |
| L472–499 | `revoke()` never called |

### 21. `api/_shared/competitor-core.js` — 668 uncovered of 967 (69.1%), weight 1, score 668

| lines | note |
|---|---|
| L79–92 | `sheetsClient()` never called |
| L94–108 | `buildJwtAuth()` never called |
| L110–140 | `buildWifAuth()` never called |
| L147–203 | `fetchWifAccessToken()` never called, also `sheetId()`, `sheetTab()` |
| L206–221 | `rowToRecord()` never called |
| L224–235 | `ensureSheetTab()` never called |
| L237–248 | `ensureHeaderRow()` never called |
| L250–263 | `appendEmailRow()` never called |
| L274–312 | `sortEmailsByReceivedDesc()` never called |
| L314–331 | `getAllEmails()` never called |
| L333–341 | `getEmailHtml()` never called |
| L343–346 | `getExistingKeys()` never called |
| L369–377 | `isNoiseSender()` never called |
| L380–392 | `cleanBrandName()` never called |
| L394–406 | `htmlToText()` never called |
| L408–412 | `buildPreview()` never called |
| L418–431 | `extractPromoCodes()` never called |
| L445–448 | `wrapHtml()` never called |
| L451–453 | `appBaseUrl()` never called |
| L455–457 | `emailKey()` never called |
| L459–462 | `screenshotUrlForKey()` never called |
| L465–480 | `getRawHtml()` never called |
| L483–492 | `imapConfig()` never called |
| L494–533 | `fetchUnreadEmails()` never called |
| L536–586 | `runSync()` never called |
| L606–638 | `ingestEmail()` never called |
| L652–699 | `fetchMetaAds()` never called |
| L721–724 | `isOwnBrand()` never called |
| L773–778 | `normalizeDomain()` never called |
| L780–798 | `ensureBrandsTab()` never called |
| L800–822 | `brandRowToRecord()` never called, also `brandToRow()` |
| L824–832 | `getBrands()` never called |
| L835–854 | `appendBrands()` never called |
| L863–874 | `seedBrands()` never called |
| L884–909 | `markBrandSubscribed()` never called |
| L920–959 | `discoverBrands()` never called |
| short runs | 2 runs of 1–2 lines: L72, L708 |

### 22. `api/_shared/lp-compiler.js` — 659 uncovered of 911 (72.3%), weight 1, score 659

| lines | note |
|---|---|
| L251–909 | `compileHTML()` never called |

### 23. `ad-campaigns.html` — 653 uncovered of 965 (67.7%), weight 1, score 653

Inline blocks: 1 of 1 executed by at least one test.

| lines | note |
|---|---|
| L396–398 | in `brandName()`: `var b = activeBrand();` |
| L401–405 | in `brandStrapline()`: `var b = activeBrand();` |
| L427–430 | in `copyText()`: `const done = (ok) => toast(ok ? (okMsg \|\| 'Copied') : 'Could not copy — see console');` |
| L441–459 | in `buildAdPrompt()`: `const platform = ch === 'google' ? 'Google Ads' : ch === 'meta' ? 'Meta (Facebook/Instagram)' :…` |
| L461–465 | in `cloneAd()`: `store[ch] = store[ch] \|\| [];` |
| L467–471 | in `adActionsHtml()`: `const enc = encodeURIComponent(JSON.stringify(c));` |
| L476–481 | `const cb = e.target.closest('[data-clone]'), pb = e.target.closest('[data-prompt]');` |
| L490–496 | in `dataUrlToBlob()`: `try {` |
| L498–507 | in `uploadCreative()`: `const sb = sbClient(); if (!sb \|\| !dataUrl \|\| dataUrl.indexOf('data:') !== 0) return '';` |
| L512–545 | in `persistAd()`: `const sb = sbClient(); if (!sb) return;` |
| L580–594 | in `getCopy()`: `const market = v(CRE_CFG[ch].market) \|\| 'US';` |
| L601–611 | in `buildCreativePrompt()`: `const cfg = CRE_CFG[ch];` |
| L614–623 | in `wrapText()`: `const words = String(text \|\| '').split(/\s+/).filter(Boolean);` |
| L626–645 | in `loadImage()`: `return new Promise((resolve) => {` |
| L649–661 | in `drawBase()`: `x.fillStyle = '#D0473E'; x.fillRect(0, 0, W, H);` |
| L666–720 | in `composeCreative()`: `const dims = fmt.size.split('x').map(Number); const W = dims[0], H = dims[1];` |
| L729–743 | in `catalogProducts()`: `const region = /uk/i.test(market) ? 'uk' : /us/i.test(market) ? 'us' : 'global';` |
| L748–773 | in `realCatalogImage()`: `const cfg = CRE_CFG[ch];` |
| L776–789 | in `fetchAiVisual()`: `try {` |
| L792–813 | in `showCreatives()`: `const prev = document.getElementById(ch + '-cre-prev');` |
| L815–875 | in `genCreative()`: `const note = document.getElementById(ch + '-cre-note');` |
| L888–897 | in `attachCreative()`: `if (creative[ch]) {` |
| L920–945 | in `clientMasterPrompt()`: `const platform = CH_PLATFORM[ch];` |
| L947–963 | in `copyMasterPrompt()`: `const text = lastMasterPrompt[ch] \|\| clientMasterPrompt(ch);` |
| L1012–1015 | in `adStatus()`: `if (e.generated_campaign_id \|\| e.status === 'approved' \|\| e.status === 'final') return '<span c…` |
| L1032–1048 | in `renderAdPlan()`: `if (empty) empty.style.display = 'none';` |
| L1051–1055 | in `adSlotToggle()`: `const row = $('#adexp-' + i); if (!row) return null;` |
| L1057–1066 | in `adCard()`: `const img = ad.creative && ad.creative.image;` |
| L1068–1078 | in `window.viewAdSlot()`: `const e = AD_PLAN[i]; if (!e) return;` |
| L1081–1084 | in `renderAdSet()`: `const ads = (d && (d.ads \|\| (d.campaign && d.campaign.assets && d.campaign.assets.ads))) \|\| [];` |
| L1086–1098 | in `window.whyAdSlot()`: `const e = AD_PLAN[i]; if (!e) return;` |
| L1103–1114 | in `openDay()`: `activeDay = k;` |
| L1116–1121 | in `$.onclick()`: `if (!activeDay) return;` |
| L1130–1142 | in `aiBrief()`: `noteEl.textContent = 'Generating…';` |
| L1145–1147 | in `extractLines()`: `const re = new RegExp(label + '[^\\n:]*:?\\s*(.+)', 'i');` |
| L1150–1157 | in `$.onclick()`: `const name = $('#g-name').value.trim() \|\| 'Google Search campaign';` |
| L1160–1165 | in `$.onclick()`: `const name = $('#m-name').value.trim() \|\| 'Meta campaign';` |
| L1171–1178 | in `creativeThumbs()`: `const assets = Array.isArray(c.creative_assets) ? c.creative_assets : [];` |
| L1184–1190 | in `renderGoogle()`: `<div class="item">` |
| L1195–1200 | in `$.onclick()`: `const name = $('#g-name').value.trim(); if (!name) { toast('Enter a campaign name'); return; }` |
| L1207–1214 | in `renderMeta()`: `<div class="item">` |
| L1219–1223 | in `$.onclick()`: `const name = $('#m-name').value.trim(); if (!name) { toast('Enter a campaign name'); return; }` |
| L1230–1236 | in `renderTikTok()`: `<div class="item">` |
| L1241–1246 | in `$.onclick()`: `const name = $('#t-name').value.trim(); if (!name) { toast('Enter a campaign name'); return; }` |
| L1249–1255 | in `$.onclick()`: `const name = $('#t-name').value.trim() \|\| 'TikTok campaign';` |
| … | 2 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 3 runs of 1–2 lines: L393–394, L883–884, L1349 |

### 24. `api/_shared/credits-core.js` — 316 uncovered of 736 (42.9%), weight 2, score 632

| lines | note |
|---|---|
| L36–39 | in `env()`: `const e = new Error('SUPABASE_SERVICE_ROLE_KEY missing — the credit meter cannot move a balance…` |
| L59–62 | in `rpc()`: `const err = new Error(`credits rpc ${fn} -> ${res.status}: ${(json && (json.message \|\| json.hin…` |
| L119–121 | `packList()` never called |
| L124–130 | `priceList()` never called |
| L134–171 | `wallet()` never called |
| L173–179 | `ledger()` never called |
| L181–184 | `usage()` never called |
| L203–206 | in `meter()`: `const e = new Error(`Unknown feature key "${featureKey}" — it must be declared in credit-catalo…` |
| L220–227 | in `meter()`: `return {` |
| L231–246 | in `meter()`: `if (!workspaceId) {` |
| L251–301 | in `meter()`: `return Object.assign({ ok: false, status: 402, error: 'insufficient_credits', quote: q, feature…` |
| L307–319 | `withCredits()` never called |
| L347–351 | in `enforce()`: `res.status(err.status \|\| 500).json({ ok: false, error: err.code \|\| 'credit_check_failed', messa…` |
| L397–461 | in `meteredHandler()`: `const origStatus = res.status.bind(res);` |
| L642–648 | in `fulfilOrder()`: `return {` |
| L657–730 | `handle()` never called |
| short runs | 4 runs of 1–2 lines: L249, L356–357, L463, L610–611 |

### 25. `api/_shared/deliverability-core.js` — 310 uncovered of 764 (40.6%), weight 2, score 620

| lines | note |
|---|---|
| L71–77 | in `systemQuery()`: `return { ok: true, records: rows.map((r) => (Array.isArray(r) ? r.join('') : String(r))), resol…` |
| L82–84 | in `systemQuery()`: `await new Promise((r) => setTimeout(r, 250));` |
| L92–94 | in `resolveRecord()`: `const doh = await dohQuery(name, kind);` |
| L102–121 | `dohQuery()` never called |
| L132–147 | `unavailable()` never called |
| L154–198 | `auditSpf()` never called |
| L254–310 | `auditDkim()` never called |
| L314–369 | `auditDmarc()` never called |
| L373–383 | `auditMx()` never called |
| L385–401 | `auditBimi()` never called |
| L419–453 | `checkBlocklists()` never called |
| L462–472 | `reputationStatus()` never called |
| L560–579 | in `auditDomain()`: `const [spf, dkim, dmarc, mx, bimi] = await Promise.all([` |
| L727–732 | in `analyzeContent()`: `const root = String(fromDomain).split('.').slice(-2).join('.');` |
| short runs | 2 runs of 1–2 lines: L226–227, L513 |

## Browser records that could not be attributed to a repo file

Scripts a page executed whose source matches no tracked `.js` file and no inline block of a tracked `.html` page — third-party bundles, test-served fixtures, generated pages. Listed so the gap is visible, never guessed at.

| url | chars | flushes | why |
|---|---:|---:|---|
| `http://127.0.0.1:35583/legacy.html` | 455 | 1 | no tracked file with this content (`legacy.html` is not a tracked page — a fixture a spec serves itself) |
| `http://127.0.0.1:44023/brand-catalog.js` | 401 | 1 | tracked `brand-catalog.js` served with different content (401 vs 11685 chars) — stubbed or rewritten by a test route |
| `http://127.0.0.1:35583/legacy.html` | 341 | 1 | no tracked file with this content (`legacy.html` is not a tracked page — a fixture a spec serves itself) |
| `http://127.0.0.1:44023/brand-catalog.js` | 259 | 1 | tracked `brand-catalog.js` served with different content (259 vs 11685 chars) — stubbed or rewritten by a test route |
| `http://127.0.0.1:44023/brand-catalog.js` | 258 | 1 | tracked `brand-catalog.js` served with different content (258 vs 11685 chars) — stubbed or rewritten by a test route |
| `file://…/lifecycle_mailer_architect_v34.html` | 196 | 11 | inline handler attribute (on*="…") on the page — not a <script> block |
| `https://cdn.jsdelivr.net/npm/motion@11.11.13/+esm` | 173 | 2 | third-party bundle, or a stub a test routed onto that origin |
| `http://127.0.0.1:35583/legacy.html` | 123 | 1 | no tracked file with this content (`legacy.html` is not a tracked page — a fixture a spec serves itself) |
| `https://cdn.tailwindcss.com/` | 92 | 4 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js` | 92 | 3 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` | 92 | 3 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.tailwindcss.com/` | 36 | 14 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js` | 36 | 4 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` | 36 | 2 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/apexcharts@3.49.1/dist/apexcharts.min.js` | 36 | 2 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js` | 36 | 2 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` | 36 | 2 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js` | 36 | 2 | third-party bundle, or a stub a test routed onto that origin |
| `file://…/lifecycle_mailer_architect_v34.html` | 28 | 5 | inline handler attribute (on*="…") on the page — not a <script> block |
| `file://…/lifecycle_mailer_architect_v34.html` | 25 | 107 | inline handler attribute (on*="…") on the page — not a <script> block |
| `file://…/lifecycle_mailer_architect_v34.html` | 25 | 4 | inline handler attribute (on*="…") on the page — not a <script> block |
| `file://…/lifecycle_mailer_architect_v34.html` | 21 | 2 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://127.0.0.1:39025/smart-brain.html` | 21 | 1 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://127.0.0.1:39025/smart-brain.html` | 21 | 1 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://127.0.0.1:35583/legacy.html` | 18 | 7 | no tracked file with this content (`legacy.html` is not a tracked page — a fixture a spec serves itself) |
| `http://127.0.0.1:33389/smart-brain.html` | 13 | 2 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://127.0.0.1:39025/smart-brain.html` | 12 | 3 | inline handler attribute (on*="…") on the page — not a <script> block |
