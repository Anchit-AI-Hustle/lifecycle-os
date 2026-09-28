# Untested lines — the map

Generated 2026-09-28T19:04:25.557Z at commit `b8e14b4` by `npm run coverage` (regenerate with `npm run coverage:report`; do not hand-edit). How it is measured, and what it cannot see: `docs/coverage.md`.
Suite: `playwright test --project=desktop-1280 --project=pixel-5 --reporter=line` — exit 1, 1342s.

## Totals

| scope | files | lines | covered | uncovered | covered % |
|---|---:|---:|---:|---:|---:|
| Node-side modules (api/, lib/, scripts/lib/, root .js) — c8 | 173 | 73119 | 44937 | 28182 | 61.5% |
| Inline `<script>` in root .html pages — Playwright JS coverage | 67 | 29453 | 14564 | 14889 | 49.4% |
| **Combined** | 240 | 102572 | 59501 | 43071 | **58%** |

Browser attribution: 362 page flushes, 4780 script records → 3266 external-script hits on 17 files, 1214 inline-block hits, 300 unattributed (39 distinct — listed at the end). External-script hits merged into the `node+browser` rows: agent-widget.js, analysis-registry.js, auth.js, brand-catalog.js, brand-context.js, brand-demo.js, chart-enhance.js, chat-history.js, credits.js, data-analysis-extensions.js, lifecycle-3d-connector-engine.js, motion.js, region-context.js, table-sort.js. Hits on files outside the c8 include scope (not rows here): assets/knickgasm3d-bridge.js, data/analytics/market-data.js, data/design-intelligence.js.

## Ranking

`score = uncovered lines × weight`. Weight is **2** for a file on the credits / auth / dispatch / preflight / SSRF path (the `LOAD_BEARING` list in `scripts/coverage/report.js`), **1** otherwise. A page row counts only the lines inside its inline `<script>` blocks; a Node row counts every line of the file (c8 counts blank and comment lines the way V8 reports them).

## All files, ranked by score

| # | file | kind | lines | covered | uncovered | uncovered % | w | score |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `lifecycle_mailer_architect_v34.html` | page | 8551 | 3206 | 5345 | 62.5% | 1 | 5345 |
| 2 | `api/ai/pipeline/html.js` | node | 1066 | 0 | 1066 | 100% | 2 | 2132 |
| 3 | `api/brain.js` | node | 1226 | 310 | 916 | 74.7% | 2 | 1832 |
| 4 | `dashboard.html` | page | 2077 | 513 | 1564 | 75.3% | 1 | 1564 |
| 5 | `api/_shared/smart-brain-plan.js` | node | 2907 | 1601 | 1306 | 44.9% | 1 | 1306 |
| 6 | `api/ai/generate.js` | node | 1045 | 435 | 610 | 58.4% | 2 | 1220 |
| 7 | `api/competitor.js` | node | 560 | 0 | 560 | 100% | 2 | 1120 |
| 8 | `api/ai/pipeline/variant.js` | node | 485 | 0 | 485 | 100% | 2 | 970 |
| 9 | `api/calendar.js` | node | 458 | 0 | 458 | 100% | 2 | 916 |
| 10 | `api/_shared/brand-workspace-core.js` | node | 1940 | 1044 | 896 | 46.2% | 1 | 896 |
| 11 | `api/ai/pipeline/strategy.js` | node | 435 | 0 | 435 | 100% | 2 | 870 |
| 12 | `api/kb.js` | node | 862 | 431 | 431 | 50% | 2 | 862 |
| 13 | `api/_shared/telesuite-core.js` | node | 1132 | 335 | 797 | 70.4% | 1 | 797 |
| 14 | `lifecycle-usa-d2c-dashboard.html` | page | 937 | 153 | 784 | 83.7% | 1 | 784 |
| 15 | `api/_shared/brain-generate.js` | node | 830 | 98 | 732 | 88.2% | 1 | 732 |
| 16 | `api/_shared/social-core.js` | node | 881 | 168 | 713 | 80.9% | 1 | 713 |
| 17 | `telesuite.html` | page | 876 | 194 | 682 | 77.9% | 1 | 682 |
| 18 | `ad-campaigns.html` | page | 1024 | 347 | 677 | 66.1% | 1 | 677 |
| 19 | `api/_shared/competitor-core.js` | node | 967 | 299 | 668 | 69.1% | 1 | 668 |
| 20 | `api/_shared/lp-compiler.js` | node | 911 | 252 | 659 | 72.3% | 1 | 659 |
| 21 | `publishing.html` | page | 428 | 150 | 278 | 65% | 2 | 556 |
| 22 | `api/_shared/calendar-generate.js` | node | 538 | 0 | 538 | 100% | 1 | 538 |
| 23 | `lib/smart-brain/services.js` | node | 1456 | 937 | 519 | 35.6% | 1 | 519 |
| 24 | `api/ai/image.js` | node | 432 | 175 | 257 | 59.5% | 2 | 514 |
| 25 | `auth.js` | node+browser | 2948 | 2694 | 254 | 8.6% | 2 | 508 |
| 26 | `api/ai/pipeline/images.js` | node | 243 | 0 | 243 | 100% | 2 | 486 |
| 27 | `api/_shared/lifecycle-mailer-build.js` | node | 481 | 0 | 481 | 100% | 1 | 481 |
| 28 | `smart-brain.html` | page | 1425 | 949 | 476 | 33.4% | 1 | 476 |
| 29 | `api/ai/pipeline/score.js` | node | 236 | 0 | 236 | 100% | 2 | 472 |
| 30 | `api/_shared/payments-core.js` | node | 1593 | 1361 | 232 | 14.6% | 2 | 464 |
| 31 | `api/_shared/lifecycle-calendar-generate.js` | node | 463 | 0 | 463 | 100% | 1 | 463 |
| 32 | `api/_shared/brain-agent.js` | node | 493 | 83 | 410 | 83.2% | 1 | 410 |
| 33 | `api/_shared/calendar-trigger.js` | node | 781 | 374 | 407 | 52.1% | 1 | 407 |
| 34 | `access-issues.html` | page | 522 | 117 | 405 | 77.6% | 1 | 405 |
| 35 | `brand-connections.html` | page | 387 | 185 | 202 | 52.2% | 2 | 404 |
| 36 | `api/_shared/brand-llm.js` | node | 666 | 273 | 393 | 59% | 1 | 393 |
| 37 | `copilot.js` | node | 359 | 0 | 359 | 100% | 1 | 359 |
| 38 | `api/public-config.js` | node | 293 | 114 | 179 | 61.1% | 2 | 358 |
| 39 | `landing-pages.html` | page | 601 | 255 | 346 | 57.6% | 1 | 346 |
| 40 | `api/_shared/daily-calendar-core.js` | node | 413 | 73 | 340 | 82.3% | 1 | 340 |
| 41 | `api/_shared/adapters/meta-adapter.js` | node | 546 | 380 | 166 | 30.4% | 2 | 332 |
| 42 | `api/_shared/ads-snowflake-core.js` | node | 760 | 433 | 327 | 43% | 1 | 327 |
| 43 | `competitor-benchmarking.html` | page | 863 | 540 | 323 | 37.4% | 1 | 323 |
| 44 | `onboarding.html` | page | 1913 | 1595 | 318 | 16.6% | 1 | 318 |
| 45 | `api/_shared/workspace-connections-core.js` | node | 1152 | 994 | 158 | 13.7% | 2 | 316 |
| 46 | `api/_shared/brain-calendar.js` | node | 347 | 35 | 312 | 89.9% | 1 | 312 |
| 47 | `knowledge-base.html` | page | 593 | 290 | 303 | 51.1% | 1 | 303 |
| 48 | `api/_shared/os-backbone.js` | node | 375 | 86 | 289 | 77.1% | 1 | 289 |
| 49 | `api/_shared/kb-files.js` | node | 283 | 0 | 283 | 100% | 1 | 283 |
| 50 | `api/_shared/video-core.js` | node | 447 | 164 | 283 | 63.3% | 1 | 283 |
| 51 | `api/_shared/reference-intel.js` | node | 479 | 204 | 275 | 57.4% | 1 | 275 |
| 52 | `api/_shared/social-push-core.js` | node | 173 | 37 | 136 | 78.6% | 2 | 272 |
| 53 | `chart-enhance.js` | node+browser | 487 | 220 | 267 | 54.8% | 1 | 267 |
| 54 | `api/_shared/lifecycle-cohorts.js` | node | 265 | 0 | 265 | 100% | 1 | 265 |
| 55 | `api/_shared/adapters/google-ads-adapter.js` | node | 331 | 200 | 131 | 39.6% | 2 | 262 |
| 56 | `calendar.html` | page | 621 | 362 | 259 | 41.7% | 1 | 259 |
| 57 | `lifecycle-3d-connector-engine.js` | node+browser | 673 | 418 | 255 | 37.9% | 1 | 255 |
| 58 | `api/_shared/data-validation-core.js` | node | 251 | 0 | 251 | 100% | 1 | 251 |
| 59 | `api/_shared/ci-collect.js` | node | 249 | 0 | 249 | 100% | 1 | 249 |
| 60 | `api/_shared/revenue-analysis-core.js` | node | 352 | 106 | 246 | 69.9% | 1 | 246 |
| 61 | `api/_shared/shopify-core.js` | node | 540 | 296 | 244 | 45.2% | 1 | 244 |
| 62 | `_sbtest.html` | page | 234 | 0 | 234 | 100% | 1 | 234 |
| 63 | `ads-masterclass.html` | page | 223 | 0 | 223 | 100% | 1 | 223 |
| 64 | `api/_shared/journey-core.js` | node | 348 | 126 | 222 | 63.8% | 1 | 222 |
| 65 | `storefront-3d.html` | page | 507 | 301 | 206 | 40.6% | 1 | 206 |
| 66 | `payments.html` | page | 466 | 367 | 99 | 21.2% | 2 | 198 |
| 67 | `api/_shared/llm.js` | node | 776 | 583 | 193 | 24.9% | 1 | 193 |
| 68 | `api/_shared/adapters/webengage-adapter.js` | node | 210 | 114 | 96 | 45.7% | 2 | 192 |
| 69 | `api/_shared/asset-agent.js` | node | 190 | 0 | 190 | 100% | 1 | 190 |
| 70 | `assets.html` | page | 397 | 208 | 189 | 47.6% | 1 | 189 |
| 71 | `api/_shared/ads-live-core.js` | node | 308 | 125 | 183 | 59.4% | 1 | 183 |
| 72 | `api/_shared/brand-context-pack.js` | node | 2165 | 1988 | 177 | 8.2% | 1 | 177 |
| 73 | `credits.js` | node+browser | 540 | 453 | 87 | 16.1% | 2 | 174 |
| 74 | `social-media.html` | page | 297 | 124 | 173 | 58.2% | 1 | 173 |
| 75 | `api/_shared/ci-subscriptions-core.js` | node | 171 | 0 | 171 | 100% | 1 | 171 |
| 76 | `api/_shared/quality-loop.js` | node | 171 | 0 | 171 | 100% | 1 | 171 |
| 77 | `api/_shared/competitive-benchmark-core.js` | node | 370 | 205 | 165 | 44.6% | 1 | 165 |
| 78 | `lifecycle-calendar.html` | page | 394 | 230 | 164 | 41.6% | 1 | 164 |
| 79 | `data-analysis.html` | page | 816 | 654 | 162 | 19.9% | 1 | 162 |
| 80 | `credits.html` | page | 272 | 195 | 77 | 28.3% | 2 | 154 |
| 81 | `api/_shared/snowflake-sync-core.js` | node | 207 | 54 | 153 | 73.9% | 1 | 153 |
| 82 | `api/_shared/model-router.js` | node | 152 | 0 | 152 | 100% | 1 | 152 |
| 83 | `api/_shared/agentic-orchestrator.js` | node | 182 | 32 | 150 | 82.4% | 1 | 150 |
| 84 | `playbook.html` | page | 286 | 137 | 149 | 52.1% | 1 | 149 |
| 85 | `scripts/lib/selfhost-compose.js` | node | 497 | 349 | 148 | 29.8% | 1 | 148 |
| 86 | `agent-widget.js` | node+browser | 329 | 184 | 145 | 44.1% | 1 | 145 |
| 87 | `api/_shared/webengage-core.js` | node | 197 | 55 | 142 | 72.1% | 1 | 142 |
| 88 | `api/_shared/alert-channels.js` | node | 173 | 33 | 140 | 80.9% | 1 | 140 |
| 89 | `api/_shared/adapters/klaviyo-adapter.js` | node | 491 | 421 | 70 | 14.3% | 2 | 140 |
| 90 | `api/_shared/brand-assets-core.js` | node | 139 | 0 | 139 | 100% | 1 | 139 |
| 91 | `api/_shared/landing-page-core.js` | node | 272 | 134 | 138 | 50.7% | 1 | 138 |
| 92 | `api/_shared/sync-core.js` | node | 250 | 112 | 138 | 55.2% | 1 | 138 |
| 93 | `api/_shared/data-analysis-core.js` | node | 410 | 278 | 132 | 32.2% | 1 | 132 |
| 94 | `api/_shared/brain-analysis.js` | node | 256 | 126 | 130 | 50.8% | 1 | 130 |
| 95 | `analysis-registry.js` | node+browser | 476 | 348 | 128 | 26.9% | 1 | 128 |
| 96 | `api/_shared/lp-design-loop.js` | node | 181 | 53 | 128 | 70.7% | 1 | 128 |
| 97 | `api/_shared/pagedeck-core.js` | node | 252 | 127 | 125 | 49.6% | 1 | 125 |
| 98 | `ads-dashboard.html` | page | 407 | 284 | 123 | 30.2% | 1 | 123 |
| 99 | `api/_shared/ads-insight-engine.js` | node | 282 | 161 | 121 | 42.9% | 1 | 121 |
| 100 | `api/_shared/brain-core.js` | node | 263 | 144 | 119 | 45.2% | 1 | 119 |
| 101 | `api/_shared/feature-agent.js` | node | 196 | 77 | 119 | 60.7% | 1 | 119 |
| 102 | `api/_shared/competitor-universe.js` | node | 846 | 729 | 117 | 13.8% | 1 | 117 |
| 103 | `scripts/lib/ad-creative.js` | node | 117 | 0 | 117 | 100% | 1 | 117 |
| 104 | `api/_shared/review-recovery.js` | node | 188 | 74 | 114 | 60.6% | 1 | 114 |
| 105 | `brand-context.js` | node+browser | 1435 | 1321 | 114 | 7.9% | 1 | 114 |
| 106 | `api/_shared/platform-agents-core.js` | node | 350 | 242 | 108 | 30.9% | 1 | 108 |
| 107 | `api/_shared/brand-extract.js` | node | 2913 | 2807 | 106 | 3.6% | 1 | 106 |
| 108 | `api/_shared/brand-reviews.js` | node | 499 | 394 | 105 | 21% | 1 | 105 |
| 109 | `api/_shared/ci-enrich.js` | node | 98 | 0 | 98 | 100% | 1 | 98 |
| 110 | `api/_shared/adapters/extensible-crm.js` | node | 280 | 231 | 49 | 17.5% | 2 | 98 |
| 111 | `lifecycle-usa-july-calendar-mailer-studio.html` | page | 199 | 102 | 97 | 48.7% | 1 | 97 |
| 112 | `agent.html` | page | 298 | 203 | 95 | 31.9% | 1 | 95 |
| 113 | `data-analysis-extensions.js` | node+browser | 704 | 609 | 95 | 13.5% | 1 | 95 |
| 114 | `api/_shared/brain-review.js` | node | 118 | 24 | 94 | 79.7% | 1 | 94 |
| 115 | `api/_shared/ads-sop-core.js` | node | 302 | 211 | 91 | 30.1% | 1 | 91 |
| 116 | `sw.js` | node | 91 | 0 | 91 | 100% | 1 | 91 |
| 117 | `api/_shared/connectors-health.js` | node | 89 | 0 | 89 | 100% | 1 | 89 |
| 118 | `api/_shared/gif-core.js` | node | 89 | 0 | 89 | 100% | 1 | 89 |
| 119 | `api/_shared/alerts-core.js` | node | 136 | 49 | 87 | 64% | 1 | 87 |
| 120 | `api/_shared/ci-funnel.js` | node | 87 | 0 | 87 | 100% | 1 | 87 |
| 121 | `api/_shared/content-core.js` | node | 86 | 0 | 86 | 100% | 1 | 86 |
| 122 | `kicksgpt.html` | page | 183 | 97 | 86 | 47% | 1 | 86 |
| 123 | `api/_shared/agent-builder-core.js` | node | 302 | 219 | 83 | 27.5% | 1 | 83 |
| 124 | `api/_shared/connector-check.js` | node | 83 | 0 | 83 | 100% | 1 | 83 |
| 125 | `api/_shared/klaviyo-sync.js` | node | 83 | 0 | 83 | 100% | 1 | 83 |
| 126 | `brand-demo.js` | node+browser | 247 | 165 | 82 | 33.2% | 1 | 82 |
| 127 | `retention-playbook.html` | page | 211 | 131 | 80 | 37.9% | 1 | 80 |
| 128 | `scripts/lib/landing-page.js` | node | 80 | 0 | 80 | 100% | 1 | 80 |
| 129 | `api/_shared/ad-insights-core.js` | node | 252 | 173 | 79 | 31.3% | 1 | 79 |
| 130 | `api/_shared/motion-design.js` | node | 191 | 115 | 76 | 39.8% | 1 | 76 |
| 131 | `brand-catalog.js` | node+browser | 245 | 169 | 76 | 31% | 1 | 76 |
| 132 | `api/_shared/ci-email-bridge.js` | node | 75 | 0 | 75 | 100% | 1 | 75 |
| 133 | `table-sort.js` | node+browser | 216 | 142 | 74 | 34.3% | 1 | 74 |
| 134 | `api/_shared/require-caller.js` | node | 130 | 93 | 37 | 28.5% | 2 | 74 |
| 135 | `competitive-intelligence.html` | page | 176 | 103 | 73 | 41.5% | 1 | 73 |
| 136 | `all-in-one.html` | page | 206 | 134 | 72 | 35% | 1 | 72 |
| 137 | `api/_shared/ci-offers.js` | node | 196 | 125 | 71 | 36.2% | 1 | 71 |
| 138 | `brand.html` | page | 294 | 227 | 67 | 22.8% | 1 | 67 |
| 139 | `api/_shared/calendar-scenarios.js` | node | 95 | 30 | 65 | 68.4% | 1 | 65 |
| 140 | `api/_shared/klaviyo-core.js` | node | 185 | 120 | 65 | 35.1% | 1 | 65 |
| 141 | `api/_shared/scenario-model.js` | node | 538 | 475 | 63 | 11.7% | 1 | 63 |
| 142 | `connectors.html` | page | 139 | 76 | 63 | 45.3% | 1 | 63 |
| 143 | `daily-email-calendar.html` | page | 390 | 327 | 63 | 16.2% | 1 | 63 |
| 144 | `api/_shared/brain-kb.js` | node | 96 | 36 | 60 | 62.5% | 1 | 60 |
| 145 | `api/_shared/supa.js` | node | 155 | 125 | 30 | 19.4% | 2 | 60 |
| 146 | `api/_shared/ad-metrics-catalog.js` | node | 183 | 124 | 59 | 32.2% | 1 | 59 |
| 147 | `api/_shared/copy-frameworks.js` | node | 293 | 234 | 59 | 20.1% | 1 | 59 |
| 148 | `team.html` | page | 100 | 44 | 56 | 56% | 1 | 56 |
| 149 | `campaign.html` | page | 110 | 56 | 54 | 49.1% | 1 | 54 |
| 150 | `api/_shared/calendar-export.js` | node | 360 | 307 | 53 | 14.7% | 1 | 53 |
| 151 | `api/_shared/brain-competitor.js` | node | 111 | 67 | 44 | 39.6% | 1 | 44 |
| 152 | `api/_shared/offering-campaign.js` | node | 155 | 113 | 42 | 27.1% | 1 | 42 |
| 153 | `landing-page-agent.html` | page | 78 | 36 | 42 | 53.8% | 1 | 42 |
| 154 | `terms.html` | page | 42 | 0 | 42 | 100% | 1 | 42 |
| 155 | `api/_shared/adapters/registry.js` | node | 135 | 114 | 21 | 15.6% | 2 | 42 |
| 156 | `api/_shared/brand-suggest.js` | node | 245 | 205 | 40 | 16.3% | 1 | 40 |
| 157 | `api/_shared/ingest-guardrail.js` | node | 167 | 129 | 38 | 22.8% | 1 | 38 |
| 158 | `api/_shared/soft-error-detect.js` | node | 579 | 541 | 38 | 6.6% | 1 | 38 |
| 159 | `uk-non-engagers.html` | page | 154 | 117 | 37 | 24% | 1 | 37 |
| 160 | `api/_shared/brand-placeholder.js` | node | 51 | 15 | 36 | 70.6% | 1 | 36 |
| 161 | `api/_shared/mailer-format.js` | node | 115 | 80 | 35 | 30.4% | 1 | 35 |
| 162 | `api/_shared/growth-os-core.js` | node | 1008 | 974 | 34 | 3.4% | 1 | 34 |
| 163 | `api/_shared/output-reasoning.js` | node | 321 | 287 | 34 | 10.6% | 1 | 34 |
| 164 | `growth-os.html` | page | 460 | 427 | 33 | 7.2% | 1 | 33 |
| 165 | `api/_shared/adapters/base-adapter.js` | node | 430 | 414 | 16 | 3.7% | 2 | 32 |
| 166 | `api/_shared/mailer-design-strategy.js` | node | 117 | 86 | 31 | 26.5% | 1 | 31 |
| 167 | `premium-experience.html` | page | 251 | 221 | 30 | 12% | 1 | 30 |
| 168 | `api/_shared/creative-image.js` | node | 55 | 26 | 29 | 52.7% | 1 | 29 |
| 169 | `data-engine.html` | page | 128 | 99 | 29 | 22.7% | 1 | 29 |
| 170 | `api/_shared/agentic-ideation.js` | node | 41 | 13 | 28 | 68.3% | 1 | 28 |
| 171 | `api/_shared/data-classification.js` | node | 80 | 52 | 28 | 35% | 1 | 28 |
| 172 | `api/_shared/market-analytics.js` | node | 290 | 265 | 25 | 8.6% | 1 | 25 |
| 173 | `api/_shared/calendar-guardrails.js` | node | 200 | 176 | 24 | 12% | 1 | 24 |
| 174 | `music.html` | page | 63 | 39 | 24 | 38.1% | 1 | 24 |
| 175 | `api/_shared/brand-catalog-server.js` | node | 445 | 422 | 23 | 5.2% | 1 | 23 |
| 176 | `api/_shared/brand-runtime.js` | node | 418 | 395 | 23 | 5.5% | 1 | 23 |
| 177 | `connector-3d.html` | page | 114 | 91 | 23 | 20.2% | 1 | 23 |
| 178 | `research.html` | page | 235 | 212 | 23 | 9.8% | 1 | 23 |
| 179 | `api/_shared/asset-specs.js` | node | 197 | 179 | 18 | 9.1% | 1 | 18 |
| 180 | `motion.js` | node+browser | 121 | 103 | 18 | 14.9% | 1 | 18 |
| 181 | `privacy.html` | page | 37 | 20 | 17 | 45.9% | 1 | 17 |
| 182 | `chat-history.js` | node+browser | 73 | 58 | 15 | 20.5% | 1 | 15 |
| 183 | `api/_shared/site-crawl.js` | node | 634 | 627 | 7 | 1.1% | 2 | 14 |
| 184 | `api/_shared/brand-facts.js` | node | 77 | 65 | 12 | 15.6% | 1 | 12 |
| 185 | `api/_shared/preflight-core.js` | node | 262 | 256 | 6 | 2.3% | 2 | 12 |
| 186 | `api/_shared/domain-intel.js` | node | 305 | 294 | 11 | 3.6% | 1 | 11 |
| 187 | `api/_shared/credit-catalog.js` | node | 285 | 280 | 5 | 1.8% | 2 | 10 |
| 188 | `api/_shared/credits-core.js` | node | 766 | 761 | 5 | 0.7% | 2 | 10 |
| 189 | `api/_shared/cohort-engine.js` | node | 445 | 437 | 8 | 1.8% | 1 | 8 |
| 190 | `api/_shared/dispatch-core.js` | node | 543 | 539 | 4 | 0.7% | 2 | 8 |
| 191 | `api/_shared/read-only-egress.js` | node | 63 | 59 | 4 | 6.3% | 2 | 8 |
| 192 | `region-context.js` | node+browser | 538 | 531 | 7 | 1.3% | 1 | 7 |
| 193 | `api/_shared/image-prompt.js` | node | 159 | 153 | 6 | 3.8% | 1 | 6 |
| 194 | `api/_shared/master-prompt.js` | node | 415 | 409 | 6 | 1.4% | 1 | 6 |
| 195 | `official-designs.html` | page | 25 | 19 | 6 | 24% | 1 | 6 |
| 196 | `landing-pages/final/lp_all_in_one_agent_v2.html` | page | 19 | 14 | 5 | 26.3% | 1 | 5 |
| 197 | `api/_shared/brand-harvest.js` | node | 235 | 231 | 4 | 1.7% | 1 | 4 |
| 198 | `scripts/lib/flagship-mailer.js` | node | 138 | 134 | 4 | 2.9% | 1 | 4 |
| 199 | `api/_shared/deliverability-core.js` | node | 782 | 780 | 2 | 0.3% | 2 | 4 |
| 200 | `api/_shared/platform-webhooks.js` | node | 112 | 109 | 3 | 2.7% | 1 | 3 |
| 201 | `website-designs.html` | page | 17 | 14 | 3 | 17.6% | 1 | 3 |
| 202 | `api/_shared/asset-contracts.js` | node | 521 | 519 | 2 | 0.4% | 1 | 2 |
| 203 | `api/_shared/revenue-model.js` | node | 124 | 122 | 2 | 1.6% | 1 | 2 |
| 204 | `app-audit.html` | page | 91 | 89 | 2 | 2.2% | 1 | 2 |
| 205 | `api/_shared/ad-rows-core.js` | node | 205 | 204 | 1 | 0.5% | 1 | 1 |
| 206 | `api/_shared/catalog-image.js` | node | 177 | 176 | 1 | 0.6% | 1 | 1 |
| 207 | `avatars.html` | page | 94 | 93 | 1 | 1.1% | 1 | 1 |
| 208 | `cohort-definitions.html` | page | 168 | 167 | 1 | 0.6% | 1 | 1 |
| 209 | `data-analysis-contrast.html` | page | 1 | 0 | 1 | 100% | 1 | 1 |
| 210 | `design-intelligence.html` | page | 28 | 27 | 1 | 3.6% | 1 | 1 |
| 211 | `index.html` | page | 23 | 22 | 1 | 4.3% | 1 | 1 |
| 212 | `mailer-discovery.html` | page | 1 | 0 | 1 | 100% | 1 | 1 |
| 213 | `api/_shared/ads-qa.js` | node | 94 | 94 | 0 | 0% | 1 | 0 |
| 214 | `api/_shared/creative-evidence.js` | node | 274 | 274 | 0 | 0% | 1 | 0 |
| 215 | `api/_shared/demo-mode.js` | node | 256 | 256 | 0 | 0% | 1 | 0 |
| 216 | `api/_shared/evidence-policy.js` | node | 69 | 69 | 0 | 0% | 1 | 0 |
| 217 | `api/_shared/jarvis.js` | node | 138 | 138 | 0 | 0% | 1 | 0 |
| 218 | `api/_shared/kb-url.js` | node | 36 | 36 | 0 | 0% | 2 | 0 |
| 219 | `api/_shared/landing-fallback.js` | node | 102 | 102 | 0 | 0% | 1 | 0 |
| 220 | `api/_shared/live-connectors.js` | node | 33 | 33 | 0 | 0% | 2 | 0 |
| 221 | `api/_shared/logo-brief.js` | node | 141 | 141 | 0 | 0% | 1 | 0 |
| 222 | `api/_shared/oauth-core.js` | node | 557 | 557 | 0 | 0% | 2 | 0 |
| 223 | `api/_shared/offering-kinds.js` | node | 120 | 120 | 0 | 0% | 1 | 0 |
| 224 | `api/_shared/raw-body.js` | node | 108 | 108 | 0 | 0% | 1 | 0 |
| 225 | `api/_shared/request-scope.js` | node | 72 | 72 | 0 | 0% | 2 | 0 |
| 226 | `api/_shared/rfm-core.js` | node | 135 | 135 | 0 | 0% | 1 | 0 |
| 227 | `api/_shared/storefront-detect.js` | node | 458 | 458 | 0 | 0% | 2 | 0 |
| 228 | `api/_shared/workspace-scope.js` | node | 310 | 310 | 0 | 0% | 2 | 0 |
| 229 | `scripts/lib/motion-ad.js` | node | 379 | 379 | 0 | 0% | 1 | 0 |
| 230 | `template-gallery.html` | page | 1 | 1 | 0 | 0% | 1 | 0 |

10 tracked root pages carry no inline `<script>` block and have nothing to measure here (their behaviour lives in the shared root scripts above): `about.html`, `ad-campaigns-master.html`, `coffee-collection-landing-no-agent.html`, `coffee-collection-landing-with-agent.html`, `diff-version.html`, `frameworks.html`, `knickgasm-grail-drop-presell-v5-variantA.html`, `knickgasm-grail-drop-presell-v5-variantB.html`, `knickgasm-lifecycle-campaign-from-the-30-d-us-variantB.html`, `styleguide.html`.

## The 25 worst — uncovered line ranges

One row per contiguous uncovered run of 3+ lines, in file order (capped at 45 per file; runs of 1–2 lines are summarised beneath). The note names the innermost enclosing function from V8's own function ranges; when the run is only part of that function, the first line of code in the run is quoted so the branch can be found without re-deriving it. Line numbers are 1-based and refer to the file at the commit above.

### 1. `lifecycle_mailer_architect_v34.html` — 5345 uncovered of 8551 (62.5%), weight 1, score 5345

Inline blocks: 5 of 5 executed by at least one test.

| lines | note |
|---|---|
| L20–22 | in `sentence()`: `var s = String((e && (e.message \|\| e.error)) \|\| e \|\| '').trim();` |
| L24–37 | in `html()`: `var d = document.createElement('div');` |
| L48–51 | in `show()`: `if (!el) return;` |
| L1467–1469 | in `getSupabase()`: `console.warn('[Supabase] SDK not loaded — check internet / CDN access');` |
| L1471–1478 | in `getSupabase()`: `console.warn('[Supabase] Config still has placeholders — fill in url + anonKey');` |
| L1628–1640 | `_resolveTables()` never called |
| L1646–1666 | `supabaseSaveCampaign()` never called |
| L1668–1676 | `supabaseFetchCampaigns()` never called |
| L1678–1686 | `supabaseUpsertUser()` never called |
| L1693–1710 | `runKnickgasmTests()` never called, also `_eq()`, `_truthy()` |
| L1717–1739 | `statusPill()` never called |
| L1747–1758 | in `loadKnowledgeBase()`: `try{` |
| L1764–1768 | `kbPalette()` never called, also `kbTypography()`, `kbMarket()`, `kbProductsForMarket()`, `kbCollections()` |
| L1771–1785 | `buildClaudeSystemPromptFromKB()` never called |
| L1790–1802 | `_dataUrlToBlob()` never called, also `_publicStorageUrl()` |
| L1804–1832 | `supabaseUploadImage()` never called |
| L1836–1849 | `supabaseHostImageMatrix()` never called |
| L1869–1877 | in `pdpUrl()`: `var found=CAT.find(function(c){return c.n===name;});` |
| L1907–1909 | in `collectionUrl()`: `var t=detectType(p);` |
| L1927–1930 | `goBack()` never called |
| L2072–2097 | `toggleProd()` never called |
| L2131–2148 | `activateAutoPick()` never called, also `clearSel()` |
| L2159–2195 | `selectType()` never called |
| L2232–2238 | in `_doAutoUpdateChips()`: `document.querySelectorAll('.mkt-chip').forEach(function(b){` |
| L2384–2388 | `_getApiHeaders()` never called |
| L2403–2406 | in `_updateSmartAIBtn()`: `btn.innerHTML='&#127775; Create Brief with AI';` |
| L2437–2442 | in `brandPaletteCheck()`: `if(!/<\/html>/i.test(html)){err(label+' HTML missing closing </html> tag.');}` |
| L2447–2453 | in `brandPaletteCheck()`: `var ALLOWED={'#fff':1,'#ffffff':1,'#000':1,'#000000':1};` |
| L2460–2462 | in `brandPaletteCheck()`: `var softBad=off.filter(function(h){return hardBad.indexOf(h)<0;});` |
| L2470–2472 | in `brandPaletteCheck()`: `if(!/(SHOP\|ADD TO CART\|CLAIM\|EXPLORE\|BEGIN\|READ\|MEET\|CURATE\|TRY\|BUILD)/i.test(html)){warn(label…` |
| L2482–2516 | `gateFinalOutput()` never called, also `_focusFeedbackForRegen()` |
| L2518–2544 | `clearAndCreate()` never called |
| L2549–2586 | `generateAudienceWithAI()` never called |
| L2603–2605 | `smartAIBrief()` never called |
| L2607–2775 | `createPromptWithAI()` never called |
| L2778–2808 | `enhancePrompt()` never called, also `updatePromptPlaceholder()` |
| L2810–2914 | `buildEnhancedPrompt()` never called |
| L2918–2930 | `toggleSuggestedPrompts()` never called |
| L2965–3011 | `renderSuggestedPrompts()` never called, also `useSuggestedPromptByIdx()` |
| L3014–3044 | `renderMarketTabs()` never called |
| L3046–3063 | `_resolveMailerHtml()` never called, also `downloadMarketMailer()` |
| L3066–3071 | in `window.previewMailerInModal()`: `_ensureMailerBuilt&&_ensureMailerBuilt(mkt,S.activeVariant\|\|'A');` |
| L3075–3099 | in `window.viewMarketHtml()`: `_ensureMailerBuilt&&_ensureMailerBuilt(mkt,S.activeVariant\|\|'A');` |
| L3101–3117 | `showMarketMailer()` never called |
| L3214–3229 | `go3()` never called |
| … | 115 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 31 runs of 1–2 lines: L39–40, L55, L746, L1375–1376, L1465, L1853, L2022–2023, L2032, L2061–2062, L2121–2122, L2371–2372, L3393, L3645–3646, L3648–3649, L3672, L3680–3681, L3716–3717, L3719–3720, L3722, L3985, L4014–4015, L4440, L5656–5657, L6357–6358, L6918, L7063–7064, L9499–9500, L9720–9721, L9795–9796, L9815, L9830 |

### 2. `api/ai/pipeline/html.js` — 1066 uncovered of 1066 (100%), weight 2, score 2132

| lines | note |
|---|---|
| L1–1066 | never loaded by any test — top-level: callLLM, MF, SYSTEM |

### 3. `api/brain.js` — 916 uncovered of 1226 (74.7%), weight 2, score 1832

| lines | note |
|---|---|
| L60–64 | `body()` never called |
| L66–76 | `cronAuthorized()` never called |
| L103–114 | in `handler()`: `const b = body(req);` |
| L125–161 | in `handler()`: `const demo = require('./_shared/demo-mode.js');` |
| L163–186 | in `handler()`: `market, from its own record. Every handler below used to fall to the` |
| L200–224 | in `handler()`: `const d = core.db();` |
| L226–231 | in `handler()`: `if (req.method === 'POST') {` |
| L235–237 | in `handler()`: `const lib = await kb.libraryIndex();` |
| L239–241 | in `handler()`: `const lib = await kb.libraryIndex();` |
| L245–248 | in `handler()`: `const out = await analysis.runDaily({ persist: req.method === 'POST' });` |
| L250–252 | in `handler()`: `const rows = await core.db().select('smart_cohorts', { limit: 200, order: 'value_score.desc', f…` |
| L254–256 | in `handler()`: `const out = await analysis.filteredLibrary({ channel: req.query.channel, market: req.query.mark…` |
| L258–260 | in `handler()`: `const rows = await core.db().select('smart_library_scores', { limit: 1000, order: 'score.desc' …` |
| L265–291 | in `handler()`: `const { runAnalyst } = require('./_shared/feature-agent.js');` |
| L295–297 | in `handler()`: `const out = await competitor.benchmarks({ persist: req.method === 'POST' });` |
| L301–305 | in `handler()`: `const filters = { slot_date: `gte.${req.query.from \|\| core.todayIso()}` };` |
| L307–311 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L313–316 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L318–320 | in `handler()`: `const rows = await core.db().select('smart_festivals', { limit: 500, order: 'mmdd.asc' });` |
| L322–325 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L327–334 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L336–347 | in `handler()`: `if (req.method === 'POST') {` |
| L351–355 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L357–361 | in `handler()`: `const filters = {};` |
| L363–370 | in `handler()`: `const rows = await core.db().select('smart_generated_assets', { filters: { id: `eq.${req.query.…` |
| L372–376 | in `handler()`: `const filters = {};` |
| L380–382 | in `handler()`: `const out = await review.queue({ state: req.query.state \|\| 'pending' });` |
| L384–387 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L389–393 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L395–397 | in `handler()`: `const rows = await core.db().select('smart_confidence', { limit: 20 });` |
| L404–407 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L409–412 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L414–418 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L420–425 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L427–433 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L435–439 | in `handler()`: `const filters = {};` |
| L442–460 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L463–475 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L478–491 | in `handler()`: `const market = b.market \|\| req.query.market \|\| __homeMarket();` |
| L495–499 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });` |
| L506–515 | in `handler()`: `const op = b.op \|\| req.query.op \|\| 'status';` |
| L519–527 | in `handler()`: `const p = req.method === 'POST' ? b : Object.assign({}, req.query);` |
| L536–577 | in `handler()`: `const p = req.method === 'POST' ? b : Object.assign({}, req.query);` |
| L581–595 | in `handler()`: `const p = req.method === 'POST' ? b : Object.assign({}, req.query);` |
| L602–608 | in `handler()`: `const p = req.method === 'POST' ? b : Object.assign({}, req.query);` |
| … | 39 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 6 runs of 1–2 lines: L195–196, L401–402, L501–502, L1198, L1211, L1214 |

### 4. `dashboard.html` — 1564 uncovered of 2077 (75.3%), weight 1, score 1564

Inline blocks: 5 of 5 executed by at least one test.

| lines | note |
|---|---|
| L20–22 | in `sentence()`: `var s = String((e && (e.message \|\| e.error)) \|\| e \|\| '').trim();` |
| L24–37 | in `html()`: `var d = document.createElement('div');` |
| L48–51 | in `show()`: `if (!el) return;` |
| L846–850 | `fmtCur()` never called |
| L852–869 | `fmtCurShort()` never called |
| L873–895 | `bucketKeyLabel()` never called |
| L909–913 | `rngFromSeed()` never called |
| L981–1116 | `genSeed()` never called |
| L1150–1168 | `inWindow()` never called, also `matchRegion()`, `filteredCampaigns()`, `filteredOrders()`, `filteredCustomers()` |
| L1173–1200 | `calcExecKpis()` never called |
| L1202–1218 | `calcCampaignKpis()` never called |
| L1220–1244 | `calcProductKpis()` never called |
| L1252–1258 | `quintileScorer()` never called |
| L1260–1285 | `computeSegments()` never called |
| L1287–1306 | `segmentSummary()` never called |
| L1317–1358 | `computeCohorts()` never called |
| L1363–1399 | `buildAffinityMatrix()` never called |
| L1404–1572 | `computeInsights()` never called |
| L1604–1697 | `renderExec()` never called |
| L1700–1806 | `renderCampaigns()` never called |
| L1809–1878 | `renderSegments()` never called |
| L1881–1965 | `renderProducts()` never called |
| L1968–2050 | `renderTime()` never called |
| L2053–2124 | `renderCohorts()` never called |
| L2127–2153 | `renderInsights()` never called |
| L2158–2165 | `kpi()` never called, also `escapeHtml()` |
| L2167–2171 | `campNameCell()` never called |
| L2176–2182 | `switchView()` never called |
| L2189–2196 | in `rerender()`: `if (STATE.view === 'exec') renderExec();` |
| L2224–2228 | `if (isMobileNav()) { closeMobileDrawer(); return; }` |
| L2265–2270 | `const g = e.target.dataset.gran;` |
| L2279–2284 | `const cur = e.target.dataset.cur;` |
| L2301–2325 | `const file = e.target.files[0];` |
| L2334–2336 | `const rows = STAGE[slot].map((r) => normalizeRow(slot, r));` |
| L2342–2346 | `note.hidden = true;` |
| L2353–2407 | `normalizeRow()` never called |
| L2410–2416 | `if (!confirm('Clear all data? This removes any uploaded or linked data and returns to the empty…` |
| L2434–2437 | `DB_TYPE = chip.dataset.dbtype;` |
| L2441–2443 | in `dbStatus()`: `const el = $('linkDbStatus');` |
| L2446–2454 | `fetchSupabaseTable()` never called |
| L2457–2495 | `dbStatus('Connecting…');` |
| L2513–2520 | `goldFillHex()` never called |
| L2525–2535 | `regionSummaryRows()` never called |
| L2537–2557 | `sendTimeSummaryRows()` never called |
| L2562–2586 | in `tablesForView()`: `const k = calcExecKpis();` |
| … | 15 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 12 runs of 1–2 lines: L39–40, L55, L105, L843, L900–901, L2201–2202, L2205–2206, L2287, L2774, L2784, L2816, L2831 |

### 5. `api/_shared/smart-brain-plan.js` — 1306 uncovered of 2907 (44.9%), weight 1, score 1306

| lines | note |
|---|---|
| L48–71 | `syncSourcesFor()` never called |
| L75–91 | `stampAndRecordSync()` never called |
| L96–99 | `preLaunchSyncCheck()` never called |
| L103–114 | `syncStatus()` never called |
| L133–167 | `callLLMTiered()` never called |
| L245–259 | `planningBrand()` never called |
| L273–314 | `_resolveBrandOfferings()` never called |
| L355–360 | in `offeringPlanEntries()`: `const p = oc.planSend(o, date);` |
| L408–415 | `buildContext()` never called |
| L422–438 | `freshEntries()` never called |
| L446–454 | `cohortLtvMap()` never called, also `toHero()` |
| L459–473 | `buildStandbyVariant()` never called |
| L475–487 | `attachScenarioLayer()` never called |
| L492–508 | `promoteScenario()` never called |
| L513–521 | `effectiveEntry()` never called |
| L524–532 | `materialDiff()` never called |
| L537–547 | `pruneOldRecords()` never called |
| L551–722 | `syncDaily()` never called |
| L726–789 | `getPlan()` never called |
| L810–812 | in `regionalNuance()`: `if (m === 'IN') return 'India market: lead with authenticity, value clarity, and cultural momen…` |
| L821–852 | `brandSystem()` never called |
| L859–867 | `strategySystem()` never called |
| L880–890 | `offeringBrief()` never called |
| L892–907 | `strategyPrompt()` never called |
| L909–928 | `strategyBrief()` never called |
| L999–1003 | in `approvedProof()`: `quote: r.quote,` |
| L1045–1048 | in `loadBrandReviews()`: `entry.__reviews = [];` |
| L1457–1464 | `productUrl()` never called |
| L1575–1631 | `writeCopyWithLLM()` never called |
| L1636–1645 | `scrubCopyDeep()` never called |
| L1733–1735 | in `attachMotionCreative()`: `image: images[0] \|\| '',` |
| L1766–1769 | in `attachMotionCreative()`: `ad.creative = Object.assign({}, ad.creative, { motion_error: String((e && e.message) \|\| e).slic…` |
| L1935–1950 | `generateCreativeImage()` never called |
| L1956–1968 | `uploadCreative()` never called |
| L2109–2124 | in `_buildCampaign()`: `const product = entry.heroProduct \|\| {};` |
| L2135–2198 | in `_buildCampaign()`: `const sb = await strategyBrief(entry);` |
| L2263–2270 | in `reportProofGap()`: `if (Array.isArray(trace)) {` |
| L2307–2322 | `resolveEntry()` never called |
| L2326–2431 | `previewEntry()` never called |
| L2435–2512 | `approveEntry()` never called |
| L2514–2531 | `rejectEntry()` never called |
| L2537–2559 | `unrejectEntry()` never called |
| L2568–2610 | `activateScenario()` never called |
| L2619–2647 | `landingPageResolve()` never called, also `landingPageHtml()` |
| L2656–2679 | `republishOrphan()` never called |
| … | 6 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 11 runs of 1–2 lines: L196–197, L203, L351, L1080, L1083, L1284, L1295, L1302, L1554, L1779–1780, L1834–1835 |

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

### 8. `api/ai/pipeline/variant.js` — 485 uncovered of 485 (100%), weight 2, score 970

| lines | note |
|---|---|
| L1–485 | never loaded by any test — top-level: callLLM, SYSTEM_A, SYSTEM_B |

### 9. `api/calendar.js` — 458 uncovered of 458 (100%), weight 2, score 916

| lines | note |
|---|---|
| L1–458 | never loaded by any test — top-level: generate, lifecycleGen, lifecycleBuild, triggerMailer, plan, calExport, readBody(), selfBaseUrl(), firePrebuild(), smartBrain(), lifecycle(), _credits, _CAL_FEATURE |

### 10. `api/_shared/brand-workspace-core.js` — 896 uncovered of 1940 (46.2%), weight 1, score 896

| lines | note |
|---|---|
| L141–145 | in `restAs()`: `const msg = (json && (json.message \|\| json.hint)) \|\| text \|\| res.statusText;` |
| L313–315 | in `readableAsText()`: (blank/comment lines) |
| L326–329 | `slugify()` never called |
| L362–365 | in `normalizePalette()`: `const hex = normHex(e && e.hex);` |
| L370–383 | `normalizeFont()` never called |
| L385–395 | `normalizeTypography()` never called |
| L397–406 | `normalizeVoice()` never called |
| L435–447 | `normalizeHosts()` never called |
| L677–698 | `parseCsv()` never called |
| L716–725 | `mapHeaders()` never called |
| L727–730 | `num()` never called |
| L732–738 | `boolish()` never called |
| L740–742 | `splitList()` never called |
| L744–782 | `rowsFromCsv()` never called |
| L784–818 | `rowsFromJson()` never called |
| L863–875 | in `v6Groups()`: `const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);` |
| L879–881 | in `v6Groups()`: `const fill = 8 - head.length - tail.length;` |
| L884–892 | in `v6Groups()`: `const out = [];` |
| L902–904 | in `isPrivateIp()`: `if (g.every((x) => x === 0)) return true;` |
| L906–909 | in `isPrivateIp()`: `const firstSixZero = g.slice(0, 5).every((x) => x === 0);` |
| L911–914 | in `isPrivateIp()`: `const o = [(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff];` |
| L916–923 | in `isPrivateIp()`: `return isPrivateV4([(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff]);` |
| L943–945 | in `assertPublicUrl()`: `const e = new Error('That hostname resolves to a private or internal address, so it cannot be i…` |
| L948–952 | in `assertPublicUrl()`: `if (err && err.status === 400) throw err;` |
| L973–1035 | `rowsFromSite()` never called |
| L1037–1073 | `rowsFromStorefront()` never called |
| L1090–1093 | `invalidateBrandCaches()` never called |
| L1097–1100 | `listWorkspaces()` never called |
| L1107–1112 | `productCount()` never called |
| L1134–1148 | `seedCompetitorsOnActivation()` never called |
| L1150–1163 | `setActive()` never called |
| L1166–1206 | `buildRow()` never called |
| L1239–1243 | in `claimedFields()`: `for (const k of ['claims', 'social', 'legal_entity']) {` |
| L1256–1268 | `claimUserOwnedFields()` never called |
| L1270–1296 | `saveWorkspace()` never called |
| L1312–1352 | `deleteWorkspace()` never called |
| L1371–1504 | `importCatalog()` never called |
| L1506–1512 | `listCatalog()` never called |
| L1543–1547 | `selfBaseUrl()` never called |
| L1549–1571 | `fireContextChain()` never called |
| L1574–1590 | `packSummary()` never called |
| L1602–1604 | in `handle()`: `const b = DEFAULT_BRAND;` |
| L1610–1623 | in `handle()`: `try {` |
| L1699–1706 | in `handle()`: `try {` |
| L1708–1724 | in `handle()`: `const id = await activeWorkspaceId(auth);` |
| … | 16 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 8 runs of 1–2 lines: L256–257, L344, L462–463, L481–482, L669, L1368–1369, L1626–1627, L1742–1743 |

### 11. `api/ai/pipeline/strategy.js` — 435 uncovered of 435 (100%), weight 2, score 870

| lines | note |
|---|---|
| L1–435 | never loaded by any test — top-level: callLLM, SYSTEM |

### 12. `api/kb.js` — 431 uncovered of 862 (50%), weight 2, score 862

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

### 13. `api/_shared/telesuite-core.js` — 797 uncovered of 1132 (70.4%), weight 1, score 797

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

### 14. `lifecycle-usa-d2c-dashboard.html` — 784 uncovered of 937 (83.7%), weight 1, score 784

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

### 15. `api/_shared/brain-generate.js` — 732 uncovered of 830 (88.2%), weight 1, score 732

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

### 16. `api/_shared/social-core.js` — 713 uncovered of 881 (80.9%), weight 1, score 713

| lines | note |
|---|---|
| L74–78 | `loadJson()` never called, also `productTypes()`, `festivalsUK()` |
| L86–110 | `scrubString()` never called, also `deepScrub()` |
| L113–121 | `normDate()` never called, also `dayOfYear()` |
| L128–167 | `focusFor()` never called |
| L169–185 | `festivalFor()` never called |
| L193–210 | `llmJson()` never called |
| L212–227 | `brandName()` never called, also `brandRecord()`, `brandPersona()` |
| L230–243 | `brandGates()` never called |
| L246–272 | `fallbackIdeology()` never called, also `ideologyAgent()` |
| L275–299 | `fallbackHypothesis()` never called, also `hypothesisAgent()` |
| L320–333 | `allowedLink()` never called |
| L335–369 | `defaultCta()` never called, also `fallbackStrategy()`, `strategyAgent()` |
| L378–494 | `tagsFor()` never called, also `focusLine()`, `fallbackContent()`, `fallbackBlog()`, `contentAgent()` |
| L497–538 | `heroPrompt()` never called, also `designAgent()`, `placeholderImage()` |
| L541–589 | `fallbackStoryboard()` never called, also `videoAgent()` |
| L600–675 | `sanitizeContent()` never called, also `enforceLimits()`, `buildPosts()`, `compileAgent()` |
| L678–706 | `recentThemes()` never called, also `persistPosts()` |
| L710–715 | `resolveKeys()` never called |
| L722–838 | `runDaily()` never called |
| L841–859 | `listPosts()` never called |
| L862–874 | `setStatus()` never called |

### 17. `telesuite.html` — 682 uncovered of 876 (77.9%), weight 1, score 682

Inline blocks: 2 of 2 executed by at least one test.

| lines | note |
|---|---|
| L20–22 | in `sentence()`: `var s = String((e && (e.message \|\| e.error)) \|\| e \|\| '').trim();` |
| L24–37 | in `html()`: `var d = document.createElement('div');` |
| L48–51 | in `show()`: `if (!el) return;` |
| L246–274 | in `renderValue()`: `depth = depth \|\| 0;` |
| L277–293 | in `renderResult()`: `if (!result) return '<p class="muted">No result.</p>';` |
| L296–321 | in `renderScore()`: `var dims = r.dimensions \|\| [];` |
| L334–341 | in `renderRail()`: `if (g) html += '<div class="rgrp">' + esc(g) + '</div>';` |
| L365–370 | in `viewHome()`: `var st = summary[x.op] \|\| summary[x.key] \|\| null;` |
| L383–387 | in `loadItems()`: `if (cache[kind === 'product' ? 'products' : 'knowledge']) return cache[kind === 'product' ? 'pr…` |
| L390–475 | in `viewLibrary()`: `var kind = s.item_kind;` |
| L480–525 | in `fieldHtml()`: `if (f.type === 'product' \|\| f.type === 'kb') {` |
| L528–540 | in `collectInputs()`: `var out = {};` |
| L543–549 | in `fileToBase64()`: `return new Promise(function (resolve, reject) {` |
| L552–561 | in `audioDuration()`: `return new Promise(function (resolve) {` |
| L564–579 | in `handleRunError()`: `if (e.status === 402 && e.payload) {` |
| L582–630 | in `viewTool()`: `$('main').innerHTML = head(s) + '<div class="card"><div id="form"><p class="muted">Loading…</p>…` |
| L633–660 | in `renderRun()`: `var receipt = r.credits` |
| L664–702 | in `viewDashboard()`: `var feat = Array.isArray(s.of) ? s.of.join(',') : s.of;` |
| L706–728 | in `viewVoice()`: `var SR = window.SpeechRecognition \|\| window.webkitSpeechRecognition;` |
| L731–865 | in `runCall()`: `var history = [], startedAt = Date.now(), listening = false, ended = false, recog = null, speak…` |
| L869–928 | in `viewBatch()`: `$('main').innerHTML = head(s) +` |
| L932–955 | in `viewClone()`: `$('main').innerHTML = head(s) + '<div id="clone"><p class="muted">Loading…</p></div>';` |
| L958–972 | in `viewN8n()`: `$('main').innerHTML = head(s) + '<div id="n8n"><p class="muted">Building the workflow…</p></div…` |
| L983–990 | in `route()`: `if (s.kind === 'library') return viewLibrary(s);` |
| L1005–1010 | in `boot()`: `var b = ev.target.closest && ev.target.closest('[data-copy-transcript]');` |
| short runs | 4 runs of 1–2 lines: L39–40, L55, L240, L1025 |

### 18. `ad-campaigns.html` — 677 uncovered of 1024 (66.1%), weight 1, score 677

Inline blocks: 2 of 2 executed by at least one test.

| lines | note |
|---|---|
| L20–22 | in `sentence()`: `var s = String((e && (e.message \|\| e.error)) \|\| e \|\| '').trim();` |
| L24–37 | in `html()`: `var d = document.createElement('div');` |
| L48–51 | in `show()`: `if (!el) return;` |
| L448–450 | in `brandName()`: `var b = activeBrand();` |
| L453–457 | in `brandStrapline()`: `var b = activeBrand();` |
| L479–482 | in `copyText()`: `const done = (ok) => toast(ok ? (okMsg \|\| 'Copied') : 'Could not copy — see console');` |
| L493–511 | in `buildAdPrompt()`: `const platform = ch === 'google' ? 'Google Ads' : ch === 'meta' ? 'Meta (Facebook/Instagram)' :…` |
| L513–517 | in `cloneAd()`: `store[ch] = store[ch] \|\| [];` |
| L519–523 | in `adActionsHtml()`: `const enc = encodeURIComponent(JSON.stringify(c));` |
| L528–533 | `const cb = e.target.closest('[data-clone]'), pb = e.target.closest('[data-prompt]');` |
| L542–548 | in `dataUrlToBlob()`: `try {` |
| L550–559 | in `uploadCreative()`: `const sb = sbClient(); if (!sb \|\| !dataUrl \|\| dataUrl.indexOf('data:') !== 0) return '';` |
| L564–597 | in `persistAd()`: `const sb = sbClient(); if (!sb) return;` |
| L632–646 | in `getCopy()`: `const market = v(CRE_CFG[ch].market) \|\| 'US';` |
| L653–663 | in `buildCreativePrompt()`: `const cfg = CRE_CFG[ch];` |
| L666–675 | in `wrapText()`: `const words = String(text \|\| '').split(/\s+/).filter(Boolean);` |
| L678–697 | in `loadImage()`: `return new Promise((resolve) => {` |
| L701–713 | in `drawBase()`: `x.fillStyle = '#D0473E'; x.fillRect(0, 0, W, H);` |
| L718–772 | in `composeCreative()`: `const dims = fmt.size.split('x').map(Number); const W = dims[0], H = dims[1];` |
| L781–795 | in `catalogProducts()`: `const region = /uk/i.test(market) ? 'uk' : /us/i.test(market) ? 'us' : 'global';` |
| L800–825 | in `realCatalogImage()`: `const cfg = CRE_CFG[ch];` |
| L828–841 | in `fetchAiVisual()`: `try {` |
| L844–865 | in `showCreatives()`: `const prev = document.getElementById(ch + '-cre-prev');` |
| L867–927 | in `genCreative()`: `const note = document.getElementById(ch + '-cre-note');` |
| L940–949 | in `attachCreative()`: `if (creative[ch]) {` |
| L972–997 | in `clientMasterPrompt()`: `const platform = CH_PLATFORM[ch];` |
| L999–1015 | in `copyMasterPrompt()`: `const text = lastMasterPrompt[ch] \|\| clientMasterPrompt(ch);` |
| L1064–1067 | in `adStatus()`: `if (e.generated_campaign_id \|\| e.status === 'approved' \|\| e.status === 'final') return '<span c…` |
| L1091–1107 | in `renderAdPlan()`: `if (empty) empty.style.display = 'none';` |
| L1110–1114 | in `adSlotToggle()`: `const row = $('#adexp-' + i); if (!row) return null;` |
| L1116–1125 | in `adCard()`: `const img = ad.creative && ad.creative.image;` |
| L1127–1137 | in `window.viewAdSlot()`: `const e = AD_PLAN[i]; if (!e) return;` |
| L1140–1143 | in `renderAdSet()`: `const ads = (d && (d.ads \|\| (d.campaign && d.campaign.assets && d.campaign.assets.ads))) \|\| [];` |
| L1145–1157 | in `window.whyAdSlot()`: `const e = AD_PLAN[i]; if (!e) return;` |
| L1162–1173 | in `openDay()`: `activeDay = k;` |
| L1175–1180 | in `$.onclick()`: `if (!activeDay) return;` |
| L1189–1201 | in `aiBrief()`: `noteEl.textContent = 'Generating…';` |
| L1204–1206 | in `extractLines()`: `const re = new RegExp(label + '[^\\n:]*:?\\s*(.+)', 'i');` |
| L1209–1216 | in `$.onclick()`: `const name = $('#g-name').value.trim() \|\| 'Google Search campaign';` |
| L1219–1224 | in `$.onclick()`: `const name = $('#m-name').value.trim() \|\| 'Meta campaign';` |
| L1230–1237 | in `creativeThumbs()`: `const assets = Array.isArray(c.creative_assets) ? c.creative_assets : [];` |
| L1243–1249 | in `renderGoogle()`: `<div class="item">` |
| L1254–1259 | in `$.onclick()`: `const name = $('#g-name').value.trim(); if (!name) { toast('Enter a campaign name'); return; }` |
| L1266–1273 | in `renderMeta()`: `<div class="item">` |
| L1278–1282 | in `$.onclick()`: `const name = $('#m-name').value.trim(); if (!name) { toast('Enter a campaign name'); return; }` |
| … | 5 more runs of 3+ lines not listed — see `coverage/lcov.info` |
| short runs | 5 runs of 1–2 lines: L39–40, L55, L445–446, L935–936, L1408 |

### 19. `api/_shared/competitor-core.js` — 668 uncovered of 967 (69.1%), weight 1, score 668

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

### 20. `api/_shared/lp-compiler.js` — 659 uncovered of 911 (72.3%), weight 1, score 659

| lines | note |
|---|---|
| L251–909 | `compileHTML()` never called |

### 21. `publishing.html` — 278 uncovered of 428 (65%), weight 2, score 556

Inline blocks: 2 of 2 executed by at least one test.

| lines | note |
|---|---|
| L20–22 | in `sentence()`: `var s = String((e && (e.message \|\| e.error)) \|\| e \|\| '').trim();` |
| L24–37 | in `html()`: `var d = document.createElement('div');` |
| L48–51 | in `show()`: `if (!el) return;` |
| L328–330 | in `note()`: `document.getElementById('msg').innerHTML = '<div class="banner ' + kind + '">' + esc(text) + '<…` |
| L336–340 | `tabs.forEach(function (x) { x.setAttribute('aria-selected', String(x === t)); });` |
| L361–364 | in `loadHub()`: `note('info', 'Showing what can be connected. ' + e.message);` |
| L372–400 | in `renderHub()`: `var c = CONNECTED[p.connection_provider];` |
| L405–431 | `var b = ev.target.closest('button[data-act]'); if (!b) return;` |
| L439–449 | in `renderChannels()`: `var c = CONNECTED[ch.provider];` |
| L463–466 | in `readJson()`: `var raw = document.getElementById(id).value.trim();` |
| L469–481 | in `dispatchSpec()`: `var mode = document.getElementById('sendmode').value;` |
| L486–501 | `if (!selected.length) { note('warn', 'Select at least one channel.'); return; }` |
| L505–535 | in `showPreflight()`: `var chip = document.getElementById('pf-chip');` |
| L542–564 | `var override = lastPreflight && lastPreflight.verdict === 'block';` |
| L569–577 | `var d = document.getElementById('domain-in').value.trim();` |
| L581–613 | in `renderDomain()`: `if (!r.ok) { window.LifecycleFailure.show(document.getElementById('domain-out'), r, { title: 'D…` |
| L616–631 | `this.disabled = true;` |
| L636–656 | in `loadJobs()`: `var el = document.getElementById('jobs-out');` |
| L660–663 | `this.disabled = true;` |
| short runs | 6 runs of 1–2 lines: L39–40, L55, L454–455, L459, L538, L675 |

### 22. `api/_shared/calendar-generate.js` — 538 uncovered of 538 (100%), weight 1, score 538

| lines | note |
|---|---|
| L1–538 | never loaded by any test — top-level: fs, path, SM, FESTIVALS, loadFestivals(), ARCHETYPES, CONTENT_TYPES, ASSET_TYPES, SEGMENT_CADENCE_PER_WEEK, WEEK_FOCUS, dateAddDays(), isoDate(), findFestivalForDate(), pickBestSendHourUTC() … (+12 more) |

### 23. `lib/smart-brain/services.js` — 519 uncovered of 1456 (35.6%), weight 1, score 519

| lines | note |
|---|---|
| L132–154 | `parseCsv()` never called |
| L156–160 | `readCsvIfExists()` never called |
| L184–212 | in `SmartBrainDbAdapter()`: `this.config = config;` |
| L215–229 | in `workspace()`: `if (this.workspaceId) return this.workspaceId;` |
| L235–257 | in `select()`: `if (!this.connected) return null;` |
| L260–266 | in `stamp()`: `if (!SmartBrainDbAdapter.scoped(table)) return rows;` |
| L268–273 | in `insert()`: `if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };` |
| L275–283 | in `upsert()`: `if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };` |
| L294–298 | in `_writeScope()`: `if (!SmartBrainDbAdapter.scoped(table)) return { ok: true };` |
| L300–309 | in `update()`: `if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };` |
| L311–322 | in `delete()`: `if (!this.connected) return { skipped: true, reason: 'Supabase env not configured' };` |
| L324–343 | in `ownData()`: `if (this.connected) {` |
| L347–367 | in `builtCatalogProducts()`: `if (this._builtCatalog) return this._builtCatalog;` |
| L369–374 | in `competitorData()`: `if (this.connected) {` |
| L376–429 | in `localFallbackData()`: `const productsRaw = readCsvIfExists('input/uploaded_by_anchit/shopify_products.csv')` |
| L435–470 | in `build()`: `const assetByCampaign = new Map();` |
| L473–496 | `normalizeMetric()` never called |
| L498–510 | `rollupMetrics()` never called, also `extractHooks()`, `extractAngles()` |
| L515–530 | in `analyze()`: `const cohorts = buildCohorts(data.users, data.orders);` |
| L533–631 | `campaignClearsThreshold()` never called, also `daysSince()`, `cohortName()`, `buildCohorts()`, `cohortRules()` (+4) |
| L636–655 | in `benchmark()`: `const competitors = asArray(data.competitors).map((c) => ({ ...c, channel: String(c.channel \|\| …` |
| L1003–1010 | `confidenceFor()` never called |
| L1407–1416 | in `review()`: `const needsHuman = campaigns.filter((c) => c.approval.required \|\| c.status !== 'final');` |
| L1419–1436 | `runDailySmartBrain()` never called |
| L1438–1454 | `schemaAssumptions()` never called |
| short runs | 10 runs of 1–2 lines: L111–112, L120, L127, L762, L764, L780, L782, L788, L932–933, L1181–1182 |

### 24. `api/ai/image.js` — 257 uncovered of 432 (59.5%), weight 2, score 514

| lines | note |
|---|---|
| L92–97 | in `handler()`: `if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });` |
| L132–171 | in `tryGeminiNative()`: `if (!geminiKey) return null;` |
| L175–212 | in `tryImagen()`: `if (!geminiKey) return null;` |
| L218–287 | in `tryOpenai()`: `if (!openaiKeys.length) return null;` |
| L291–328 | in `tryPollinations()`: `const dim = POLLINATIONS_SIZE_MAP[size] \|\| POLLINATIONS_SIZE_MAP['1024x1536'];` |
| L336–361 | in `tryCloudflare()`: `if (!CF_ACCOUNT \|\| !CF_TOKEN) return null;` |
| L365–370 | in `handler()`: `? [` |
| L372–376 | in `handler()`: `: [` |
| L381–404 | in `handler()`: `const hit = await rung();` |
| short runs | 2 runs of 1–2 lines: L106–107, L407–408 |

### 25. `auth.js` — 254 uncovered of 2948 (8.6%), weight 2, score 508

Also loaded in the browser by page tests; counts are the union of both runtimes.

| lines | note |
|---|---|
| L51–55 | in `ensureTheme()`: `vp = d.createElement('meta');` |
| L319–323 | in `window.fetch()`: `if (input.headers && input.headers.get && input.headers.get('Authorization')) return nativeFetc…` |
| L378–404 | `window.addEventListener('load', async () => {` |
| L1835–1837 | in `injectTopbar()`: `if (e.key !== 'Escape') return;` |
| L1858–1862 | in `document.addEventListener.passive()`: `const n = navEl();` |
| L1865–1874 | in `document.addEventListener.passive()`: `if (!swiping) return;` |
| L1899–1901 | in `injectTopbar()`: `collapsed = !collapsed;` |
| L2034–2056 | in `injectSigningInOverlay()`: `if (document.getElementById('lifecycle-signingin')) return;` |
| L2252–2254 | in `getConfig()`: `window.__SUPABASE__ = PUBLIC_SUPABASE_FALLBACK;` |
| L2513–2522 | in `signOut()`: `if (window.LifecycleAuth.client) await window.LifecycleAuth.client.auth.signOut();` |
| L2597–2610 | in `init()`: `injectSigningInOverlay();` |
| L2630–2633 | in `init()`: `const tb = document.getElementById('lifecycle-nav');` |
| L2676–2682 | in `maybeShowProfileModal()`: `try { localStorage.setItem(shownKey(user), '1'); } catch {}` |
| L2686–2800 | in `showProfileModal()`: `if (document.getElementById('lifecycle-profile-modal')) return;` |
| L2869–2875 | `cells()` never called |
| L2930–2936 | in `openPrintable()`: `w.document.open();` |
| short runs | 3 runs of 1–2 lines: L331–332, L2490–2491, L2493–2494 |

## Browser records that could not be attributed to a repo file

Scripts a page executed whose source matches no tracked `.js` file and no inline block of a tracked `.html` page — third-party bundles, test-served fixtures, generated pages. Listed so the gap is visible, never guessed at.

| url | chars | flushes | why |
|---|---:|---:|---|
| `http://127.0.0.1:37369/legacy.html` | 455 | 1 | no tracked file with this content (`legacy.html` is not a tracked page — a fixture a spec serves itself) |
| `http://127.0.0.1:43375/brand-catalog.js` | 401 | 1 | tracked `brand-catalog.js` served with different content (401 vs 11685 chars) — stubbed or rewritten by a test route |
| `http://127.0.0.1:37369/legacy.html` | 341 | 1 | no tracked file with this content (`legacy.html` is not a tracked page — a fixture a spec serves itself) |
| `http://127.0.0.1:43375/brand-catalog.js` | 259 | 1 | tracked `brand-catalog.js` served with different content (259 vs 11685 chars) — stubbed or rewritten by a test route |
| `http://127.0.0.1:43375/brand-catalog.js` | 258 | 1 | tracked `brand-catalog.js` served with different content (258 vs 11685 chars) — stubbed or rewritten by a test route |
| `file://…/lifecycle_mailer_architect_v34.html` | 196 | 11 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://app.example.test/competitor-benchmarking.html` | 174 | 1 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/motion@11.11.13/+esm` | 173 | 11 | third-party bundle, or a stub a test routed onto that origin |
| `https://esm.sh/three@0.169.0` | 173 | 1 | third-party bundle, or a stub a test routed onto that origin |
| `http://app.example.test/competitor-benchmarking.html` | 128 | 1 | third-party bundle, or a stub a test routed onto that origin |
| `http://127.0.0.1:37369/legacy.html` | 123 | 1 | no tracked file with this content (`legacy.html` is not a tracked page — a fixture a spec serves itself) |
| `http://app.example.test/competitor-benchmarking.html` | 116 | 1 | third-party bundle, or a stub a test routed onto that origin |
| `file://…/lifecycle_mailer_architect_v34.html` | 92 | 9 | inline handler attribute (on*="…") on the page — not a <script> block |
| `https://cdn.tailwindcss.com/` | 92 | 4 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js` | 92 | 3 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` | 92 | 3 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.tailwindcss.com/` | 36 | 42 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js` | 36 | 13 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js` | 36 | 6 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/apexcharts@3.49.1/dist/apexcharts.min.js` | 36 | 7 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js` | 36 | 7 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` | 36 | 7 | third-party bundle, or a stub a test routed onto that origin |
| `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js` | 36 | 9 | third-party bundle, or a stub a test routed onto that origin |
| `file://…/lifecycle_mailer_architect_v34.html` | 28 | 4 | inline handler attribute (on*="…") on the page — not a <script> block |
| `file://…/lifecycle_mailer_architect_v34.html` | 25 | 105 | inline handler attribute (on*="…") on the page — not a <script> block |
| `file://…/lifecycle_mailer_architect_v34.html` | 25 | 4 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://127.0.0.1:36319/lifecycle_mailer_architect_v34.html` | 25 | 8 | inline handler attribute (on*="…") on the page — not a <script> block |
| `file://…/lifecycle_mailer_architect_v34.html` | 23 | 16 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://app.example.test/smart-brain.html` | 23 | 1 | third-party bundle, or a stub a test routed onto that origin |
| `file://…/lifecycle_mailer_architect_v34.html` | 21 | 2 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://127.0.0.1:42957/smart-brain.html` | 21 | 1 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://127.0.0.1:42957/smart-brain.html` | 21 | 1 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://app.example.test/smart-brain.html` | 19 | 1 | third-party bundle, or a stub a test routed onto that origin |
| `http://app.example.test/lifecycle_mailer_architect_v34.html` | 19 | 1 | third-party bundle, or a stub a test routed onto that origin |
| `http://127.0.0.1:37369/legacy.html` | 18 | 7 | no tracked file with this content (`legacy.html` is not a tracked page — a fixture a spec serves itself) |
| `http://app.example.test/lifecycle_mailer_architect_v34.html` | 15 | 1 | third-party bundle, or a stub a test routed onto that origin |
| `http://127.0.0.1:45453/smart-brain.html` | 13 | 2 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://127.0.0.1:42957/smart-brain.html` | 12 | 3 | inline handler attribute (on*="…") on the page — not a <script> block |
| `http://app.example.test/smart-brain.html` | 10 | 1 | third-party bundle, or a stub a test routed onto that origin |
