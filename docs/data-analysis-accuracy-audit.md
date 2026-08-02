# Data-analysis accuracy audit — rating + fixes to reach rigorous accuracy

Scope: the analysis that drives cohorts, calendar targeting, and revenue reasoning —
`api/_shared/brain-analysis.js`, `lib/smart-brain/services.js`, the ingest path
(`ingest/*.py` → `smart_users`), and the dashboard/data-analysis pages.

## Current rating: **4.2 / 10**

Honest breakdown (weighted):

| Dimension | Score | Why |
|---|---|---|
| Data pipeline exists | 7/10 | Real ingest (`ingest_matrixify/shopify/klaviyo/webengage` → DuckDB → `sync_to_supabase`) into `smart_users`. Path is real, but there's no freshness/completeness validation and analysis silently returns empty when `smart_users` is missing. |
| Segmentation method | 3/10 | Cohorts are **hardcoded absolute thresholds** (`orders_count >= 8 AND total_spent >= 300`), not statistical RFM. Thresholds don't adapt to the base; they misclassify as the distribution shifts. |
| RFM rigor | 2/10 | No true Recency/Frequency/Monetary quintile scoring per market. `value_score = total_spent/members/100` is an arbitrary scale, not LTV. |
| Cohort integrity | 3/10 | Cohorts **overlap** (a user can be VIP + kicks + discount-responsive) with no priority/dedup → double-counting for sizing and revenue. |
| Predictive models | 1/10 | No churn probability, no predicted CLV, no repeat-purchase curve, no inter-purchase interval, no next-order-date model. |
| Statistical validity | 2/10 | No confidence intervals, no sample-size guards, no significance on campaign scores; percentiles only on campaign score, not cohorts. |
| Market coverage | 4/10 | Only US/UK hardcoded in `defineCohorts`; Global/IN/EU/AU dropped. |
| Revenue math | 3/10 | No audience×conversion×AOV projection tied to list size; this is why "$1500/day from 90 people" can't be validated by the system. |
| Transparency/traceability | 6/10 | Cohort `definition.rule` strings are shown, which is good; but no data-vintage, coverage %, or per-metric source. |

Net: it **runs and degrades gracefully**, but the method is rules-of-thumb, not analytically accurate.

## The honest ceiling on "100% accuracy"
Accuracy is bounded by two things the code alone cannot guarantee:
1. **Source completeness/correctness** — orders, events, and email/ads engagement must be fully and freshly ingested. Garbage/stale in → wrong out, regardless of method.
2. **Method validity** — the segmentation and projections must be statistically sound and validated against held-out actuals.

So "100%" is achievable as *methodological correctness + validated-against-actuals*, not as a magic number. The fixes below take the method to best practice and make accuracy **measurable** (backtest error), which is the real bar.

## Fixes required (prioritized)

### P0 — correctness of the method
1. **Replace threshold cohorts with true RFM quintiles.** Per market: compute R/F/M, rank into 1–5 quintiles (`recency` reversed), form an RFM score; map the standard 11 segments (Champions, Loyal, Potential Loyalist, New, Promising, Need Attention, About to Sleep, At Risk, Can't Lose, Hibernating, Lost). Quintile cutoffs are **data-relative**, recomputed each run.
2. **Make cohorts mutually exclusive** (assign each user to exactly one primary RFM segment) and keep behavioural tags (kicks, gift, discount-responsive) as **overlay attributes**, not competing cohorts — so sizing/revenue never double-counts.
3. **Real monetary/LTV**: predicted CLV via a simple, validated model (historical AOV × predicted future orders from frequency + tenure), not `total_spent/100`.
4. **Data validation gate**: before analysis, assert row counts, null rates, date ranges, and freshness; emit a coverage report and refuse to publish cohorts below a completeness threshold instead of silently returning empty.

### P1 — predictive + statistical
5. **Churn/next-order model**: inter-purchase-interval distribution per cohort → churn probability + expected next-order date. Flag "about to lapse".
6. **Confidence + sample size**: attach n, and CIs on rates (email-engaged %, conversion); suppress metrics below a minimum n.
7. **All markets**: drive markets from the data, not a hardcoded `['US','UK']`.

### P2 — revenue realism (ties to the $1500/day ask)
8. **Audience→revenue projection**: `expected_orders = recipients × send_conversion_rate(cohort) × frequency`; `revenue = orders × AOV(cohort)`. Roll up per day; if a day's projection < target ($1500), the planner must add cohorts/recipients or flag the gap. This makes the calendar's revenue claims checkable and exposes that ~35 orders/day at ~$42.5 AOV needs thousands of recipients, not 90.
9. **Backtest harness**: hold out the last N weeks, predict, compare to actuals, report MAPE per metric. This is how "accuracy" becomes a number you can hold to a bar.

### P3 — transparency
10. Stamp every cohort/metric with data vintage, coverage %, and method version; surface on the dashboard so a number is never shown without its provenance.

## Suggested implementation shape (JS/serverless, matching this repo)
- `api/_shared/rfm-core.js` — quintile RFM + exclusive segment assignment + overlay tags (pure, testable).
- `api/_shared/clv-core.js` — predicted CLV + churn/next-order.
- `api/_shared/analytics-validate.js` — the completeness/freshness gate + coverage report.
- `api/_shared/revenue-model.js` — audience×conversion×AOV projection + daily target roll-up (reuses `scenario-model.js`).
- `scripts/backtest-analytics.js` — holdout MAPE harness.
- `brain-analysis.js` `defineCohorts()` → delegate to `rfm-core`.
- Tests: quintile cutoffs, exclusivity (no user in two segments), CI math, projection identity, backtest error bounds.

## What I need from you to actually hit the bar
- Confirmation the ingest has run and `smart_users` is populated for US (and which other markets), or a sample export so I can validate against real distributions.
- Your **list size per segment** and any known **send→order conversion** and **AOV by cohort** (you mentioned a full calculation) — these make the revenue projection real rather than assumed.
- Target accuracy metric + acceptable error (e.g. cohort-size MAPE ≤ 5%, next-order-date within ±X days) so "accurate enough" is defined and testable.
