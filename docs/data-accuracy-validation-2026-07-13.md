# Data Accuracy Validation — Repo vs KNICKGASM USA D2C Report

**Date:** 2026-07-13
**Reference (treated as ground truth):** `KNICKGASM_USA_D2C_Report.pdf` — source Shopify (`knickgasmusa.myshopify.com`), full history 2015-2026.
**Canonical transcription of the report:** `data/analytics/usa-d2c-report-2026-07-13.json` (verbatim, no derived values).

## Verdict

**Our stored data does NOT fully match the report.** One dataset is broadly consistent (in a different, correctly-labeled scope); one is materially wrong and appears synthetic; and the report's all-time/lifetime figures have no representation in the repo at all.

| Repo dataset | Consumed by | Verdict |
|---|---|---|
| `data/market/us/*` → `data/analytics/market-data.js` (`window.LIFECYCLE_ANALYTICS`) | `/analytics` (`data-analysis.html`), `data-engine.html`, `research.html`, `alerts-core.js` | ✅ **Consistent in scope.** Trailing-12-month window (Jul 2025-Jul 2026), total sales $1.12M — matches the report's "~$1.1M/year run-rate". Labeled "trailing 12-month" on the page, so not misrepresented. Not directly comparable line-for-line to the report's calendar-year table. |
| `data/shopify_analytics/*.csv` (monthly 2023-01 → 2025-03) | offline Python ingest → DuckDB → Supabase (`ingest_shopify_analytics.py`, `run_all.py`, `sync_to_supabase.py`, `mailer_system/engine.py`) | ❌ **Materially inaccurate / synthetic.** See §1. |
| `data/cohort-sizes.json` (`base_total_est: 430000`) | cohort sizing / calendar | ⚠️ **Misleading.** Uses inflated profile count as the customer base. See §2. |
| Report's all-time figures ($14.76M lifetime, 268,500 orders, 154,822 customers) | — | ❌ **Not represented anywhere** in repo analytics until now (added as `usa-d2c-report-2026-07-13.json`). |

---

## §1. `data/shopify_analytics/*.csv` is inaccurate and internally inconsistent

Yearly tallies of the repo CSVs vs the report:

| Year | Metric | Repo (`shopify_analytics`) | Report | Delta |
|---|---|---|---|---|
| 2023 | Orders | 15,757 | 28,058 | **-44%** |
| 2023 | Gross sales | $1.62M | $1.72M | -6% |
| 2023 | Discounts | $188.6K | $298.6K | **-37%** |
| 2023 | Total sales | $1.58M | $1.60M | ~ok |
| 2023 | Buyers | 11,995* | 19,441 | **-38%** |
| 2024 | Orders | 16,564 | 17,511 | -5% |
| 2024 | Gross sales | $1.55M | $1.03M | **+50%** |
| 2024 | Total sales | $1.53M | $0.98M | **+56%** |
| 2024 | Discounts | $167.8K | $126.8K | +32% |
| 2024 | Buyers | 12,440* | 12,639 | ~ok |
| 2025 | Orders | 5,055 (Jan-Mar only) | 16,538 (full yr) | partial |

\* `customer_metrics.csv` sums monthly `total_customers`, which double-counts buyers across months, so it is not a valid annual unique-buyer figure regardless.

**Additional problems:**
- **The `aov` column yields implausible values.** Correction (2026-07-18 re-validation): the column is *not* internally broken. It is arithmetically `net_sales / orders_count` (e.g. 2023-01: 98,092.38 / 2,104 = 46.62), i.e. net-based rather than gross/orders. The problem is that because `orders_count` is understated, the resulting AOVs are unreal: 2023-04 shows $167.56, 2024-08 $175.74, 2024-12 $36.79, versus the report's ~$44-56. So the column is inconsistent with reality, not with itself.
- **Coverage gap.** The dataset covers only 2023-01 → 2025-03. It has no 2015-2022 (the entire hypergrowth + $3.30M peak era), no full-year 2025, and no 2026. It therefore cannot reflect the report's $14.76M lifetime, 268,500 all-time orders, or 154,822 lifetime customers.

**Conclusion:** this dataset is placeholder/synthetic, not a real Shopify export. It should not be trusted for any historical analysis, forecasting, or Supabase sync.

## §2. `cohort-sizes.json` treats the inflated profile count as the customer base

- `base_total_est: 430000` and its note ("Total customer base is approx 430,000") equate the base to Shopify **profile** count.
- The report is explicit: 430,743 profiles are **inflated by a 192,684-profile bulk list import in 2023**; the **true all-time purchaser count is 154,822**, and only **8,028 (5.2%)** are active in 2026 YTD.
- Cohort percentages computed against 430,000 therefore understate real penetration of the *buyer* base. If "reactivation of proven purchasers" is the strategy (as the report's Rs 100 Cr bridge argues), 154,822 is the correct denominator.

---

## What was changed in this branch

1. **Added `data/analytics/usa-d2c-report-2026-07-13.json`** — the report's figures transcribed verbatim (all-time, yearly 2015-2026, 2025-vs-2026 YTD, top products, Rs 100 Cr bridge, caveats). Zero fabrication: only values printed in the report. This is the canonical USA D2C source of truth per the Master Operating Contract "one authoritative record" rule.
2. **Added this validation report.**

## What was NOT changed, and why (zero-fabrication)

- **The `shopify_analytics` monthly CSVs were not rewritten.** The report gives annual totals only; rebuilding correct **monthly** rows from annual figures would require inventing the monthly split, which the Master Operating Contract forbids. The honest fix is a fresh pull from Shopify (see below), not fabrication.
- **`cohort-sizes.json` was not silently repointed** to 154,822, because that changes live audience math the calendar/exports depend on — a product decision, not a transcription.

## Recommended remediation (needs your go-ahead)

1. **Re-pull real historical data from Shopify** (the report's own source) to replace `data/shopify_analytics/*.csv` — either via the Shopify Admin connector now available in this session, or a fresh ShopifyQL/Analytics export, covering 2015→present at monthly grain.
2. **Decide the canonical "customer base" denominator** for cohort sizing: 154,822 proven purchasers (report) vs 430,000 profiles. Recommend switching to 154,822 for buyer-penetration math and labeling the 430k as "profiles (import-inflated)".
3. **Wire `usa-d2c-report-2026-07-13.json` into the analytics UI** as the "all-time / by-year" view, distinct from the existing "trailing 12-month" view, so the app can show the real long-run history the report describes.
