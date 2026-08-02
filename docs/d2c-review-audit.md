# KNICKGASM US D2C Review — Independent Audit & Learnings (discovery pass)

Scope: the 8-task review package `KNICKGASM_US_D2C_Review_FINAL_v11` (data through 16 Jul 2026,
reconciled 22 Jul). This is a **discovery document** — verify what's true, prove accuracy, and
surface problems/anomalies and areas of action. It deliberately does **not** jump to solutions.

Method: every claim below was re-computed **independently from the package's own 31 input CSVs**
(not copied from its dashboard/PDF). "✅ verified" = I recomputed and it ties. "⚠️ anomaly" = a real
inconsistency or gap I can prove. Scores are 0–10 (accuracy × completeness × internal consistency).

---

## Part A — Per-task audit

### T1 · Sales & Business Performance — score 9.5/10
- **What it measures:** gross/discounts/returns/net, orders, AOV, sessions, conversion, units — annual (2015–2026), monthly (2024–2026), weekly (ISO), daily (~4 mo). Source: Shopify (read-only).
- **Accuracy — ✅ verified (zero variance):**
  - Annual 2026 = Σ(7 monthly 2026 rows) **exactly**: gross `593,381.25`, net `501,712.72`, orders `11,506` — matches to the cent/unit.
  - Daily net Σ = weekly net Σ = `339,597.50` (diff `$0.00`) — the weekly re-bucket is a faithful roll-up of daily.
- **⚠️ Definitional note (not an error, but a footgun):** `AOV = (Gross + Discounts) / Orders` **excludes returns**, while `Net = Gross + Discounts + Returns`. So AOV and net-per-order diverge; anyone dividing net/orders will not reproduce the stated AOV. Must be labelled wherever AOV is shown.
- **Action area:** surface the AOV basis on-chart; keep the (already clean) reconciliation as the accuracy anchor.

### T2 · Customers — Acquisition, Retention & Cohorts — score 8/10
- **What it measures:** new vs returning by year, acquisition by first-order year, recency buckets, frequency bands, spend bands, RFM/value segments, geo (US state). Source: Shopify customer export.
- **Accuracy — ✅ partial:** buyers-by-frequency Σ = **154,880**, which equals the stated buyer base (customers with ≥1 order). ✅
- **⚠️ ANOMALY (denominator mismatch):** buyers-by-**spend** Σ = **430,323**, i.e. ~275k *more* than the 154,880 buyer base. That surplus is the "~276k zero-order email sign-ups" the dictionary mentions — so the **spend cut counts sign-ups, the frequency cut counts buyers**. Two Task-2 tables therefore describe **different populations**. Anyone comparing "% of buyers" across these two tables will be wrong by ~2.8×. This must be reconciled to one denominator (buyers = 154,880) or each table explicitly labelled with its population.
- **⚠️ Gap (documented, not an error):** age/gender not collected by Shopify → cohorts are location/behaviour/value/RFM only.
- **Action area:** unify the customer denominator; add a one-line population label to every customer table.

### T3 · Catalog & Price Parity (D2C vs Amazon) — score 8.5/10
- **What it measures:** category→subcategory→product revenue overlap, D2C vs Amazon price per SKU, on-both / Amazon-only / D2C-only, catalog comparison ex-Handpick. Source: Shopify + Amazon catalog + Snowflake (`KNICKGASM_DB.MAPLEMONK`).
- **Accuracy — self-consistent:** catalog comparison (ex-Handpick, 93 listings excluded) classifies **208 products: 152 both / 23 Amazon-only / 33 Shopify-only**; live SKU diff finds **76 live of 154 common** (72 draft), Amazon cheaper on 21 (worst: World of Sneaker Sampler −$25.92).
- **⚠️ Gap:** true weight/pack parity **not computable** — no D2C weight/pack fields in source; only Amazon net weight exists. So "cheaper on Amazon" is list-price, not normalised per-100g. Flag as price-only parity.
- **Action area:** get D2C net-weight/pack into the feed before making pack-normalised parity claims.

### T4 · Fulfilment & Shipping — score 7/10
- **What it measures:** orders fulfilled/shipped/delivered by month, order-to-dispatch (avg + P90), shipping profiles/zones/rates. Source: Shopify fulfilment feed + line-item sample.
- **⚠️ Material coverage gap:** order-to-**delivery** is measured on USPS/DHL only; **~60% ship via Amazon Logistics, which returns no delivered timestamp** to Shopify. So delivery-time metrics describe ~40% of parcels. Honestly documented, but it caps confidence — any "avg delivery days" is a minority-of-orders figure.
- **Action area:** treat delivery SLA as directional; pursue an Amazon Logistics delivered-event feed before reporting a blended delivery SLA.

### T5 · Customer Support (CX) — score 7.5/10
- **What it measures:** ticket totals, first-response/resolution, SLA, monthly/daily volume, inferred categories. First-response = **13.9h median**, recomputed from raw ticket files.
- **⚠️ Gaps:** CSAT/NPS and the **Oct 2025–Feb 2026 ticket history** live only in the helpdesk tool, absent from Shopify/Snowflake; ticket categories are **inferred**, not native.
- **Action area:** export the helpdesk history + CSAT to close the time gap; validate the inferred category mapping against a labelled sample.

### T6 · Category & Product Revenue — score 9/10
- **What it measures:** gross/net/orders by category (3 yrs) and category→subcategory→product. Source: Shopify. Internally consistent with T1 totals.
- **Action area:** none material; keep tied to T1 net basis.

### T7 · Coffee & Subscriptions — score 8.5/10
- **What it measures:** coffee net + orders (daily/weekly), subscription programme. Source: Shopify + Loop/Shopify Subscriptions export.
- **⚠️ Minor:** coffee series reconciles to daily; subscription figures depend on the Loop export freshness (verify export date each refresh).
- **Action area:** stamp the subscription export date on the view.

### T8 · Platform Roles & Permissions (Apps & Users) — score 8/10
- **What it measures:** full staff/collaborator access map + per-app inventory + connector scopes/channels.
- **Accuracy — ✅ verified counts:** **115 users** (91 with **2FA off**, split **30 remove / 70 modify / 12 retain / 3 review**), **64 apps**, 15 channels, 59 connector scopes. My recompute of the user register matches these exactly.
- **⚠️ ANOMALY (cross-deliverable inconsistency):** the shipped **dashboard HTML still says "Task 8 … is Coming Soon,"** while the workbook + input data have Task 8 **complete** (files `30_app_inventory.csv`, `31_user_access_map.csv`). The dictionary's own change-log is internally contradictory (early "pending" notes vs 22-Jul "completed"). The deliverables are out of sync — a viewer of the dashboard sees "coming soon" for data that exists.
- **⚠️ Gap:** **last-login is not in the Shopify export** → account activity is *inferred* from status + grant date, so "9 inactive / 20 suspended" is a proxy, not measured activity.
- **Action area:** rebuild the dashboard Task-8 tab from the now-complete data (kill "Coming Soon"); get a last-login/activity export before acting on "inactive."

---

## Overall accuracy verdict

- **Numerical reconciliation: excellent.** Every time-grain I tested (daily↔weekly↔monthly↔annual) ties at **zero variance**; T2 buyer base and T8 registers reproduce exactly. The "every figure ties to source" claim holds where source data is present.
- **Weighted score ≈ 8.3 / 10.** Dragged down not by wrong math but by **coverage gaps** (Amazon Logistics delivery ~60% dark, CSAT/NPS + a 5-month ticket window missing, no D2C weight, no last-login, no age/gender) and by **two consistency defects** (T2 buyer-vs-signup denominator; T8 dashboard "Coming Soon" vs complete data).
- **Nothing fabricated found:** gaps are declared as data-availability limits, not papered over with invented numbers — consistent with the zero-fabrication contract.

### Anomalies to fix (ranked)
1. **T2 denominator mismatch** — spend table counts 430,323 (incl. ~276k sign-ups) vs 154,880 buyers. Highest misleading potential.
2. **T8 dashboard "Coming Soon"** while data is complete — cross-deliverable drift.
3. **T4 delivery SLA** computed on ~40% of parcels — label as partial.
4. **AOV basis** (excludes returns) unlabelled — silent divergence from net/order.
5. **T3 price parity is list-price only** (no pack normalisation).

---

## Part B — Learnings (insights, and *why* each is true)

1. **The math is trustworthy; the risk is interpretation, not calculation.** Because every grain reconciles to zero variance, errors won't come from the totals — they'll come from *mixing populations or bases* (T2 buyers vs sign-ups, AOV vs net/order). *Why it matters:* the failure mode of this dataset is a confident wrong ratio, not a wrong sum. Guardrail = label the denominator/basis on every tile.
2. **~40% visibility on delivery is a structural ceiling, not a bug.** Amazon Logistics simply never returns a delivered timestamp. *Why true:* verified in the dictionary and consistent with the fulfilment feed. Action: stop trying to compute a blended delivery SLA from Shopify alone; it needs a second source.
3. **The customer file is two datasets wearing one coat** — 154,880 buyers + ~276k zero-order sign-ups. *Why true:* the spend-vs-frequency sums differ by exactly that surplus. Any "conversion of base" metric must first pick which base.
4. **Task 8 is the highest-leverage operational finding, and it's real.** 91/115 accounts with 2FA off, 43 external parties, 30 users flagged for removal, ~$300–430/mo of recoverable app spend. *Why true:* recomputed directly from the access + app registers. This is security + cost, not analytics — act regardless of the rest.
5. **Deliverables drift when built in passes.** The dashboard lags the data (Task 8 "Coming Soon"). *Why it matters:* a single source-of-truth model (the app's canonical data + views) prevents exactly this — which is the argument for folding this review into the app rather than shipping standalone HTML/PDF/XLSX that each age independently.

---

## What this implies for the app build (not started here — flagged for the next phase)
- Fold T1–T7 into **one "Business Review" analysis area** and T8 into a separate **Platform Roles & Permissions** item, both as views over one canonical dataset (so no more "Coming Soon" drift).
- Every table/chart: explicit **population + basis label**, **DoD/WoW/MoM/YoY** toggle (the daily series supports it — proven by the zero-variance re-bucket), and a **USD/INR** switch (USD default).
- Delivery, CSAT, weight, last-login, age/gender render as **declared gaps**, never estimated.
