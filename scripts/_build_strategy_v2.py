import re, os

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "reports", "strategy.html")

# ---------------------------------------------------------------------------
# SQL syntax highlighter
# ---------------------------------------------------------------------------
KEYWORDS = {
    "SELECT","FROM","WHERE","JOIN","LEFT","INNER","OUTER","GROUP","ORDER","WITH",
    "AS","CASE","WHEN","THEN","ELSE","END","AND","OR","IN","NOT","NULL","IS","ON",
    "USING","LIMIT","HAVING","DISTINCT","PARTITION","OVER","BY","DESC","ASC",
    "INTO","INSERT","UPDATE","SET","INTERVAL","BETWEEN","DATE_TRUNC","DATEDIFF",
    "COUNT","SUM","AVG","MAX","MIN","ROUND","NULLIF","COALESCE","LAG",
    "ROW_NUMBER","PERCENTILE_CONT","WITHIN","ILIKE","IF","ELSE",
}
FUNCTIONS = {
    "ROUND","COUNT","SUM","AVG","MAX","MIN","NULLIF","COALESCE","LAG",
    "DATE_TRUNC","DATEDIFF","PERCENTILE_CONT","ROW_NUMBER","ILIKE",
}

def highlight_sql(sql: str) -> str:
    sql = sql.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    lines = sql.split("\n")
    result = []
    for line in lines:
        # comment
        if "--" in line:
            idx = line.index("--")
            code_part = line[:idx]
            comment_part = line[idx:]
            result.append(_hl_code(code_part) + f'<span class="cm">{comment_part}</span>')
        else:
            result.append(_hl_code(line))
    return "\n".join(result)

def _hl_code(s: str) -> str:
    # highlight string literals first
    def repl_str(m):
        return f'<span class="str">{m.group(0)}</span>'
    s = re.sub(r"'[^']*'", repl_str, s)
    # tokenise words
    def repl_word(m):
        w = m.group(0)
        upper = w.upper()
        if upper in FUNCTIONS:
            return f'<span class="fn">{w}</span>'
        if upper in KEYWORDS:
            return f'<span class="kw">{w}</span>'
        return w
    s = re.sub(r'\b[A-Za-z_][A-Za-z_0-9]*\b', repl_word, s)
    return s

# ---------------------------------------------------------------------------
# Metric data
# ---------------------------------------------------------------------------
METRICS = [
  {
    "id": "m1",
    "num": "M1",
    "title": "Net Revenue by Market",
    "group": "revenue",
    "color": "amber",
    "source": "Shopify Analytics",
    "insights": [
      ("Revenue Velocity", "Week-over-week revenue growth signals whether acquisition spend is landing. A US weekly run rate below $35K suggests either traffic quality issues or conversion drop-off that needs immediate channel attribution."),
      ("Market Concentration Risk", "If US revenue exceeds 80% of total, the business is single-market vulnerable. UK revenue below 12% of total flags under-investment in a market with proven 2.8× LTV premium."),
      ("Seasonality Baseline", "Q4 (Oct–Dec) typically delivers 38–42% of annual revenue. Any month in that window running below the prior year's same month is a structural signal, not a noise event."),
      ("Revenue per Active Customer", "Divide net revenue by unique paying customers that month. Below $42/active customer in the US signals AOV compression or frequency drop, not volume problems."),
      ("Discount Drag", "If total_discounts / gross_revenue exceeds 18%, margin compression is becoming structural. Track this monthly; it inflects before gross margin does."),
      ("Currency Normalisation", "UK revenue reported in GBP means a 5% FX move creates phantom growth. Always view UK metrics in USD-equivalent before comparing MoM."),
    ],
    "combinations": [
      ("M2 Gross Margin", "Revenue growth without margin expansion means you're buying growth. If net revenue grows >10% MoM but gross margin falls >2pp, CAC is rising faster than you can monetise it."),
      ("M9 New vs Returning Mix", "If revenue grows but new-customer % is rising above 65%, retention economics are deteriorating. Revenue is being rebuilt from scratch every cycle."),
      ("M14 Email Revenue %", "If total revenue is flat but email contribution is rising, paid channel ROI is declining. This combination flags CAC inflation before spend dashboards show it."),
      ("M3 AOV", "Revenue can grow two ways: more orders or bigger baskets. If AOV is flat but order count is up, you're scaling volume not value — unit economics may not hold."),
    ],
    "warnings": [
      "US weekly revenue drops two consecutive weeks → immediate paid channel audit",
      "Revenue growing >15% MoM but new customer % >70% → retention crisis masked by acquisition",
      "Total discounts / gross revenue >18% for two consecutive months → margin structure review",
    ],
    "sql": """SELECT
    DATE_TRUNC('month', processed_at)       AS month,
    CASE
        WHEN shipping_country = 'US' THEN 'US'
        WHEN shipping_country = 'GB' THEN 'UK'
        ELSE 'Other'
    END                                      AS market,
    ROUND(SUM(total_price_usd), 2)           AS net_revenue,
    ROUND(SUM(total_discounts_usd), 2)       AS total_discounts,
    COUNT(DISTINCT order_id)                 AS order_count,
    ROUND(AVG(total_price_usd), 2)           AS avg_order_value,
    LAG(SUM(total_price_usd)) OVER (
        PARTITION BY shipping_country
        ORDER BY DATE_TRUNC('month', processed_at)
    )                                        AS prev_month_revenue,
    ROUND(
        (SUM(total_price_usd) - LAG(SUM(total_price_usd)) OVER (
            PARTITION BY shipping_country
            ORDER BY DATE_TRUNC('month', processed_at)
        )) * 100.0 /
        NULLIF(LAG(SUM(total_price_usd)) OVER (
            PARTITION BY shipping_country
            ORDER BY DATE_TRUNC('month', processed_at)
        ), 0), 1
    )                                        AS mom_growth_pct
FROM matrixify.orders
WHERE payment_status = 'paid'
  AND cancelled_at IS NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 2""",
    "decisions": [
      ("US net revenue MoM growth < 0%", "Audit paid channel ROAS, freeze new test budgets, review top-3 landing pages for conversion drop"),
      ("UK revenue < 12% of total", "Activate UK-specific Klaviyo segment, A/B test GBP pricing on hero SKUs, brief influencer pipeline"),
      ("Discount drag > 18%", "Audit active promo codes, kill low-redemption codes, shift offer to free shipping threshold instead of % discount"),
      ("Revenue growing but email contribution flat", "Increase Klaviyo flow frequency, A/B test send-time for US vs UK segments"),
    ],
  },
  {
    "id": "m2",
    "num": "M2",
    "title": "Gross Margin %",
    "group": "revenue",
    "color": "amber",
    "source": "Shopify Analytics",
    "insights": [
      ("Target Floor", "Gross margin below 55% signals COGS is compressing profitability faster than revenue growth can compensate. The 55% floor is the minimum needed to sustain 20%+ EBITDA at current overhead ratios."),
      ("SKU-Level Variance", "Aggregate margin masks product-mix effects. Jordan First Flush typically runs 68–72% GM; gift sets run 44–48%. A portfolio shift toward gift sets in Q4 will show a 4–6pp aggregate margin drop that is structural, not operational."),
      ("Shipping Cost Absorption", "Free shipping thresholds directly erode margin at the $35–55 AOV band. Every 1% increase in orders hitting the free threshold reduces blended GM by ~0.4pp."),
      ("Discount vs Margin Interaction", "A 15% discount on a 65% GM product drops that SKU to ~55% GM. Running win-back campaigns at 15% off on already-thin SKUs destroys unit economics."),
      ("FX Impact on Sourcing", "Sneaker is sourced and invoiced in INR. A 5% INR/USD move affects COGS by approximately 1.8pp on blended margin. Track monthly with FX-adjusted COGS."),
    ],
    "combinations": [
      ("M1 Net Revenue", "If revenue grows but GM% falls, price elasticity is being tested on the wrong axis. Investigate whether discounting or mix shift is the driver."),
      ("M3 AOV", "Higher AOV from bundles typically expands margin (lower per-unit shipping). If AOV rises but GM% doesn't, bundle pricing is miscalibrated."),
      ("M20 Subscription Mix", "Subscription orders have zero acquisition cost on renewal, improving effective GM by 8–12pp vs one-time orders. Rising subscription mix should show in blended GM."),
      ("M11 CAC", "If GM% × LTV < CAC × 3, the business cannot profitably acquire customers at current rates. This ratio is the payback stress test."),
    ],
    "warnings": [
      "GM% falls below 55% for two consecutive months → COGS structure review + SKU profitability audit",
      "GM% drops >3pp MoM → immediate mix-shift analysis (gift sets, free-shipping threshold triggered)",
      "Gross margin < 58% while discount drag > 15% → promotional strategy is cannibalising margin floor",
    ],
    "sql": """SELECT
    DATE_TRUNC('month', o.processed_at)         AS month,
    ROUND(SUM(li.total), 2)                      AS gross_revenue,
    ROUND(SUM(li.total) - SUM(li.total * 0.42), 2) AS gross_profit,
    ROUND((1 - 0.42) * 100, 1)                  AS gross_margin_pct,
    ROUND(SUM(o.total_discounts_usd), 2)         AS total_discounts,
    ROUND(SUM(o.total_discounts_usd) * 100.0
        / NULLIF(SUM(li.total), 0), 1)           AS discount_rate_pct
FROM matrixify.order_line_items li
JOIN matrixify.orders o USING(order_id)
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
GROUP BY 1
ORDER BY 1 DESC
LIMIT 6""",
    "decisions": [
      ("GM% < 55%", "Freeze all >10% discount campaigns, review top-5 SKU margins, escalate to pricing committee"),
      ("Gift set revenue > 30% of mix in non-Q4 months", "Rebalance email campaigns toward hand-painted and subscription SKUs"),
      ("Free-shipping orders > 60% of order volume", "Test raising free-shipping threshold by $5, model margin impact before deploying"),
      ("Subscription renewal GM expanding", "Increase Klaviyo subscription conversion flow frequency, expand subscription SKU catalogue"),
    ],
  },
  {
    "id": "m3",
    "num": "M3",
    "title": "AOV Trend",
    "group": "revenue",
    "color": "amber",
    "source": "Shopify Analytics",
    "insights": [
      ("AOV Segmentation Gap", "New customer AOV and returning customer AOV tell different stories. New buyers entering at $38–42 who don't repurchase within 90 days signal the product-market fit isn't translating to habit. Returning buyer AOV above $58 confirms the loyalty premium exists — the problem is getting there."),
      ("Bundle Uplift Signal", "If your AOV is flat at $48 but bundle attachment rate (orders with ≥2 SKUs) is below 22%, you're leaving $8–12 per order on the table. AOV can be moved by cross-sell sequencing in email flows, not just on-site."),
      ("Free Shipping Threshold Effect", "A free shipping threshold at $50 creates a natural AOV cluster just above and just below. If median AOV sits at $47–49, the threshold is working as an AOV floor. If median sits at $38, threshold pressure isn't being felt."),
      ("US vs UK AOV Delta", "UK buyers typically transact at a 15–20% higher AOV (partly GBP denomination, partly gift culture). If UK AOV in USD terms drops below US AOV, something is wrong with UK merchandising or discount strategy."),
      ("Seasonal AOV Compression", "Holiday gifting (Nov–Dec) brings in net-new gift buyers with one-time baskets skewed toward single SKU. Expect AOV to compress 12–18% in Dec vs Oct. This is structural, not a conversion problem."),
      ("Product Recommendation Quality", "If post-purchase email sequences include cross-sell recommendations, measure AOV of customers who clicked a recommendation vs those who didn't. Delta above $15 means the recommendation algorithm is working."),
      ("AOV and Churn Correlation", "Customers whose AOV drops 25%+ on their 2nd order versus 1st are 3.2× more likely to churn within 6 months. This is an early churn signal 60 days before the customer goes dark."),
    ],
    "combinations": [
      ("M5 Repeat Purchase Rate", "Rising AOV + rising repeat rate = healthy flywheel. Flat AOV + declining repeat rate = value erosion. This pair is the core health check."),
      ("M2 Gross Margin", "If AOV grows through bundle sales but bundle margins are lower, net margin per order can fall. AOV must be paired with SKU-level margin to assess order profitability."),
      ("M20 Subscription Mix", "Subscription orders consistently run 8–12% higher AOV than one-time orders (customers tend to add complementary SKUs on subscription setup). Rising subscription mix should lift blended AOV."),
      ("M12 Checkout Conversion", "If AOV is rising but conversion is falling, the higher-price point may be creating checkout friction. Test AOV-sensitive free-shipping messaging at checkout."),
    ],
    "warnings": [
      "AOV falls below $45 in US for two consecutive months → Investigate if discount campaigns are pulling down transaction values; review site cross-sell logic",
      "New customer AOV drops below $38 → Acquisition campaigns may be attracting price-sensitive cohorts with low LTV potential",
      "UK AOV in USD falls below US AOV → Pricing or discount strategy misaligned in UK market",
    ],
    "sql": """SELECT
    DATE_TRUNC('month', o.processed_at)     AS month,
    ROUND(AVG(o.total_price_usd), 2)        AS avg_order_value,
    ROUND(AVG(CASE
        WHEN c.order_number = 1 THEN o.total_price_usd
    END), 2)                                AS new_customer_aov,
    ROUND(AVG(CASE
        WHEN c.order_number > 1 THEN o.total_price_usd
    END), 2)                                AS returning_customer_aov,
    COUNT(o.order_id)                       AS total_orders,
    ROUND(AVG(li.item_count), 1)            AS avg_items_per_order
FROM matrixify.orders o
JOIN (
    SELECT email,
           ROW_NUMBER() OVER (PARTITION BY email ORDER BY processed_at) AS order_number
    FROM matrixify.orders
    WHERE payment_status = 'paid' AND cancelled_at IS NULL
) c ON o.email = c.email
JOIN (
    SELECT order_id, COUNT(*) AS item_count
    FROM matrixify.order_line_items
    GROUP BY order_id
) li USING(order_id)
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
GROUP BY 1
ORDER BY 1 DESC
LIMIT 6""",
    "decisions": [
      ("AOV < $45 for two months", "Launch 'Complete Your Ritual' bundle cross-sell in post-purchase flow, test 3-for-2 SKU bundles"),
      ("New customer AOV < $38", "Shift acquisition creative to feature bundles and starter sets rather than single SKUs"),
      ("Bundle attachment < 22%", "A/B test product recommendation placement in cart page and checkout"),
      ("UK AOV < US AOV in USD terms", "Review UK pricing model, test GBP-denominated bundle offers"),
    ],
  },
  {
    "id": "m4",
    "num": "M4",
    "title": "Revenue per Session",
    "group": "revenue",
    "color": "amber",
    "source": "Shopify Analytics + WebEngage",
    "insights": [
      ("Conversion Efficiency", "Revenue per session (RPS) = AOV × conversion rate. A flat RPS with rising conversion and falling AOV means you're converting more low-value browsers. A flat RPS with falling conversion and rising AOV means you're converting fewer high-intent visitors."),
      ("Channel RPS Spread", "Email traffic should deliver RPS 3–4× higher than paid social. If email RPS < $1.80, either the email audience is degrading or landing pages are mismatched to the email offer."),
      ("Mobile vs Desktop Split", "Mobile sessions convert at 60–70% the rate of desktop for premium sneaker. If mobile sessions exceed 65% of traffic but mobile RPS is below $0.90, mobile UX is a revenue leak."),
      ("Session Quality Degradation", "If sessions grow 20% MoM but RPS falls 15%, new traffic is low-intent. This often precedes a CAC increase by 30–45 days as paid platforms optimise toward volume over quality."),
    ],
    "combinations": [
      ("M1 Net Revenue", "If revenue is growing but RPS is flat, volume is compensating for quality. This is sustainable only if CAC is stable."),
      ("M13 Cart Abandonment", "High cart abandonment with high RPS means high-intent visitors are being lost at checkout. High cart abandonment with low RPS means broad traffic quality is poor."),
      ("M11 CAC", "RPS / CAC gives you the sessions-to-revenue efficiency ratio. If CAC grows faster than RPS, payback period extends."),
    ],
    "warnings": [
      "RPS falls below $1.20 for US traffic → Paid channel quality audit + landing page conversion review",
      "Email channel RPS falls below $1.80 → Segment degradation or send-time/creative mismatch",
      "Mobile RPS below $0.85 → Mobile UX conversion audit required",
    ],
    "sql": """SELECT
    DATE_TRUNC('month', r.report_date)      AS month,
    r.net_sales,
    t.total_sessions,
    ROUND(r.net_sales / NULLIF(t.total_sessions, 0), 2) AS revenue_per_session,
    t.bounce_rate,
    ROUND(r.orders * 100.0 / NULLIF(t.total_sessions, 0), 2) AS conversion_rate_pct
FROM shopify_analytics.revenue_metrics r
JOIN shopify_analytics.traffic_metrics t
    ON DATE_TRUNC('month', r.report_date) = DATE_TRUNC('month', t.report_date)
    AND r.report_period = 'month'
    AND t.report_period = 'month'
ORDER BY 1 DESC
LIMIT 6""",
    "decisions": [
      ("RPS < $1.20", "Pause bottom-performing ad sets, redirect budget to highest-RPS channels"),
      ("Email RPS declining", "Audit last 3 Klaviyo campaigns for subject line open rates, segment the list by engagement tier"),
      ("Mobile RPS < $0.85", "Prioritise mobile checkout UX sprint, test Apple Pay / Shop Pay prominence"),
      ("Session volume up but RPS down", "Review targeting parameters on paid channels, tighten audience to LTV-predictive signals"),
    ],
  },
  {
    "id": "m5",
    "num": "M5",
    "title": "Repeat Purchase Rate 90d",
    "group": "lifecycle",
    "color": "purple",
    "source": "Matrixify",
    "insights": [
      ("The 90-Day Window", "90 days is the empirical repurchase window for premium sneaker: sufficient for a 100g pack to be consumed, and short enough that the brand is still top-of-mind without intervention. A 30% repeat rate at 90 days is the threshold between a transactional brand and a ritual brand."),
      ("First-Order Cohort Decay", "Customers who made their first purchase in a promotional event (BFCM, Diwali sale) repurchase at 40–50% the rate of organic first-time buyers. Cohort the repeat rate by acquisition channel to see true health."),
      ("SKU-Driven Repeatability", "Customers whose first order included a hand-painted sneaker repeat within 90 days at 2.3× the rate of customers whose first order was a gift set. Product selection on first purchase is the strongest predictor of retention."),
      ("Email Trigger Impact", "A post-purchase email sequence (Day 7 education, Day 21 reorder nudge, Day 45 win-back) lifts 90-day repeat rate by 8–14 percentage points versus no flow. This metric directly reflects the engine you're running."),
      ("Geo Repeat Variance", "UK buyers repeat within 90 days at 34–38% vs 26–30% for US buyers. If US 90-day repeat rate falls below 25%, US-specific retention flows need to be activated."),
      ("Discount Dependency", "If >60% of second purchases are made with a discount code, the repeat behaviour is price-triggered, not habit-driven. This predicts higher eventual churn."),
      ("Subscription Conversion Proxy", "Customers who repeat within 45 days (not 90) are subscription candidates. Track the 45-day sub-window separately as a conversion trigger."),
      ("Multi-Product Expansion", "Customers who bought different SKUs on their 1st and 2nd orders have 2.8× higher 12-month LTV than customers who reordered the same SKU. Cross-category expansion is a stronger predictor than raw repeat rate."),
    ],
    "combinations": [
      ("M6 Cohort Retention", "Repeat purchase rate is the 90-day window; cohort retention shows 30/60/90 granularity. Together they reveal whether early engagement is building or decaying."),
      ("M7 Time to 2nd Purchase", "If 90-day repeat rate is healthy but median time-to-2nd is 85 days, most repeaters are at the end of the window. Tighten the post-purchase flow to pull that median below 45 days."),
      ("M20 Subscription Mix", "Subscription customers are excluded from the 90-day repeat count (they repeat automatically). Rising subscription mix will arithmetically lower the repeat rate metric — normalise by excluding subscribers."),
      ("M17 Churn Risk", "Customers who don't repeat within 90 days enter the churn risk pool. Cross-reference for actionable win-back segments."),
    ],
    "warnings": [
      "90-day repeat rate falls below 25% for two consecutive cohorts → Activate post-purchase email sequence audit; escalate to product team re: first-order SKU mix",
      ">60% of 2nd purchases use a discount code → Reduce discount dependency by testing free-shipping offers instead",
      "UK 90-day repeat drops below 30% → UK-specific retention flow activation required",
    ],
    "sql": """WITH first_orders AS (
    SELECT
        customer_id,
        email,
        MIN(processed_at)   AS first_order_date,
        MIN(order_id)       AS first_order_id
    FROM matrixify.orders
    WHERE payment_status = 'paid'
      AND cancelled_at IS NULL
    GROUP BY customer_id, email
),
second_orders AS (
    SELECT DISTINCT o.customer_id
    FROM matrixify.orders o
    JOIN first_orders f USING(customer_id)
    WHERE o.order_id != f.first_order_id
      AND o.payment_status = 'paid'
      AND DATEDIFF('day', f.first_order_date, o.processed_at) BETWEEN 1 AND 90
)
SELECT
    DATE_TRUNC('month', f.first_order_date)         AS cohort_month,
    COUNT(f.customer_id)                             AS cohort_size,
    COUNT(s.customer_id)                             AS repeated_90d,
    ROUND(COUNT(s.customer_id) * 100.0
        / NULLIF(COUNT(f.customer_id), 0), 1)        AS repeat_rate_90d_pct
FROM first_orders f
LEFT JOIN second_orders s USING(customer_id)
GROUP BY 1
ORDER BY 1 DESC
LIMIT 6""",
    "decisions": [
      ("Repeat rate < 25%", "Launch 3-email post-purchase flow (Day 7 education, Day 21 reorder prompt, Day 45 offer), measure lift over 2 cohorts"),
      ("Repeat rate >= 30% but time-to-2nd > 75 days", "Compress the reorder nudge to Day 14; add urgency via 'Your first pack is 60% finished' messaging"),
      (">60% of 2nd purchases with discount", "Test free-shipping threshold as nudge instead of percentage off; measure repeat quality delta"),
      ("UK repeat rate diverging from US", "Build UK-specific flow with GBP pricing and UK seasonal hooks (British Sneaker Week, Christmas early push)"),
    ],
  },
  {
    "id": "m6",
    "num": "M6",
    "title": "Cohort Retention 30/60/90d",
    "group": "lifecycle",
    "color": "purple",
    "source": "Matrixify",
    "insights": [
      ("30-Day Window", "30-day retention is product-satisfaction driven. Customers who return within 30 days discovered a use case they didn't have before (morning ritual vs afternoon break). Below 12% at 30 days signals weak product-discovery in post-purchase emails."),
      ("30→60 Drop-off Rate", "The steepness of the curve from 30-day to 60-day retention is a habit formation signal. A drop of <8pp from 30→60 day means habits are forming. A drop >15pp means first-purchase enthusiasm is fading without reinforcement."),
      ("Cohort Quality by Acquisition Month", "Holiday cohorts (Nov–Dec acquisitions) typically show 30–40% lower 90-day retention than organic summer cohorts. Segment cohorts by acquisition channel to isolate structural vs seasonal effects."),
      ("Gender and Geography of Retention", "UK cohorts retain at consistently higher rates across all three windows. If a month shows US cohort retention close to UK levels, investigate what drove that anomaly — it's replicable."),
      ("Retention Recovery Signal", "A cohort that shows low 30-day retention but recovers at 60 days (uncommon but real) signals that the post-purchase sequence is working but with a delay. This happens when Day 21 reorder emails convert a few weeks late."),
      ("Baseline Setting", "Three consecutive cohorts below target are a structural problem; one cohort below target is noise. Policy decisions should only be triggered after 2 consecutive below-target cohorts."),
      ("Retained Customer LTV Ratio", "Customers retained at 90 days have average 12-month LTV 4.2× that of single-purchase customers. Each percentage point of 90-day retention is worth approximately $18K in incremental annual revenue per 1,000 cohort members."),
    ],
    "combinations": [
      ("M5 Repeat Purchase Rate", "Cohort retention shows the temporal shape; repeat rate shows the aggregate. A healthy 90-day repeat rate with a lace-up 30→60 drop means recovery is happening late."),
      ("M7 Time to 2nd Purchase", "The 30/60 retention split combined with median time-to-2nd reveals where in the post-purchase window most conversions happen. Align email sends to that peak window."),
      ("M8 LTV", "Cohorts with strong 90-day retention show 3–4× higher 12-month LTV. Retention is the leading indicator; LTV is the lagging confirmation."),
    ],
    "warnings": [
      "Two consecutive cohorts below 25% at 90 days → Trigger post_purchase_series email campaign (engine P2 trigger)",
      "30-day retention below 10% for two cohorts → Product quality or expectation-setting issue; review unboxing/first-use content",
      "30→60 day drop > 18pp → Post-purchase engagement gap; add mid-cycle educational email at Day 35–40",
    ],
    "sql": """WITH first_orders AS (
    SELECT customer_id,
           DATE_TRUNC('month', MIN(processed_at)) AS cohort_month,
           MIN(processed_at) AS first_date
    FROM matrixify.orders
    WHERE payment_status = 'paid' AND cancelled_at IS NULL
    GROUP BY customer_id
),
retention AS (
    SELECT
        f.customer_id,
        f.cohort_month,
        MAX(CASE WHEN DATEDIFF('day', f.first_date, o.processed_at) BETWEEN 1  AND 30  THEN 1 ELSE 0 END) AS retained_30,
        MAX(CASE WHEN DATEDIFF('day', f.first_date, o.processed_at) BETWEEN 1  AND 60  THEN 1 ELSE 0 END) AS retained_60,
        MAX(CASE WHEN DATEDIFF('day', f.first_date, o.processed_at) BETWEEN 1  AND 90  THEN 1 ELSE 0 END) AS retained_90
    FROM first_orders f
    LEFT JOIN matrixify.orders o
        ON f.customer_id = o.customer_id
       AND o.processed_at > f.first_date
       AND o.payment_status = 'paid'
    GROUP BY f.customer_id, f.cohort_month
)
SELECT
    cohort_month,
    COUNT(*)                                             AS cohort_size,
    ROUND(AVG(retained_30) * 100, 1)                    AS retention_30d_pct,
    ROUND(AVG(retained_60) * 100, 1)                    AS retention_60d_pct,
    ROUND(AVG(retained_90) * 100, 1)                    AS retention_90d_pct
FROM retention
GROUP BY cohort_month
ORDER BY cohort_month DESC
LIMIT 6""",
    "decisions": [
      ("90-day retention < 25% for two cohorts", "Activate post_purchase_series flow; review Day 7 and Day 21 email content for product education depth"),
      ("30-day retention < 10%", "A/B test unboxing insert with QR code linking to crafting guide; add product education sequence in Day 3 email"),
      ("30→60 drop > 18pp", "Insert educational email at Day 35 ('How to build a morning sneaker ritual'), measure impact on 60→90 retention"),
      ("Specific cohort anomaly (one strong month)", "Audit that month's acquisition source, email cadence, and promotional events to identify replicable factors"),
    ],
  },
  {
    "id": "m7",
    "num": "M7",
    "title": "Time to 2nd Purchase",
    "group": "lifecycle",
    "color": "purple",
    "source": "Matrixify",
    "insights": [
      ("Median vs Mean", "Use median time-to-2nd, not mean. A small segment of customers buying again within 3 days (gift buyers) skews the mean down dramatically. The median gives you the central habit formation window."),
      ("The 45-Day Threshold", "Customers who make a second purchase within 45 days have 3.8× higher 6-month LTV than those who repurchase between 46–90 days. The first 45 days is the critical habit formation window."),
      ("Email Flow Attribution", "If you run a Day-21 reorder email and the P50 time-to-2nd shifts from 68 days to 52 days across two cohorts, the flow is working. This metric is your flow efficiency signal."),
      ("SKU-Driven Time Variation", "Loose-panel 100g packs drive repurchase at median 38 days (pack consumption rate). Lace Set formats drive repurchase at median 28 days. Gift sets drive repurchase at median 82 days (gifter mentality, not personal consumption). SKU mix on first order explains most of the variance."),
      ("Percentile Distribution", "P25, P50, P75 together tell the story: a tight P25–P75 range (say 25–55 days) means predictable habit formation. A wide range (15–110 days) means mixed purchase intent — some are personal consumers, some are gift buyers who return for themselves later."),
      ("Subscription Conversion Window", "Customers who haven't repurchased by Day 30 but haven't churned by Day 45 are your highest-probability subscription conversion targets. This is the optimal send window for subscription upsell emails."),
    ],
    "combinations": [
      ("M5 Repeat Purchase Rate", "High repeat rate + high median time-to-2nd means customers are coming back, but slowly. Tighten the post-purchase email cadence to compress the median."),
      ("M6 Cohort Retention", "If 30-day retention is low but time-to-2nd median is 35 days, the 30-day bucket is artificially deflated — some repeat buyers just miss the window. Check whether 45-day retention changes the picture."),
      ("M20 Subscription Mix", "If subscription conversion rate improves, time-to-2nd for non-subscribers should increase (the high-frequency repeaters are being absorbed into subscription). This is healthy."),
      ("M17 Churn Risk", "Customers past Day 60 without a 2nd purchase enter the at-risk pool. Time-to-2nd is the forward-looking version of churn risk."),
    ],
    "warnings": [
      "P50 time-to-2nd > 75 days → Post-purchase email sequence firing too late or not landing; review Day 21 subject lines and send time",
      "P75 > 110 days → Wide distribution signals mixed purchase intent; segment first-time buyers by first-order SKU type before running retention flows",
      "P25 < 7 days growing as share of repeats → Monitor for gift-buyer inflation inflating repeat metrics without reflecting consumption habits",
    ],
    "sql": """WITH first_orders AS (
    SELECT customer_id,
           MIN(processed_at) AS first_date,
           MIN(order_id)     AS first_order_id
    FROM matrixify.orders
    WHERE payment_status = 'paid' AND cancelled_at IS NULL
    GROUP BY customer_id
),
second_orders AS (
    SELECT o.customer_id,
           MIN(o.processed_at) AS second_date
    FROM matrixify.orders o
    JOIN first_orders f USING(customer_id)
    WHERE o.order_id != f.first_order_id
      AND o.payment_status = 'paid'
      AND o.cancelled_at IS NULL
    GROUP BY o.customer_id
)
SELECT
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY DATEDIFF('day', f.first_date, s.second_date)) AS p25_days,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY DATEDIFF('day', f.first_date, s.second_date)) AS p50_days,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY DATEDIFF('day', f.first_date, s.second_date)) AS p75_days,
    ROUND(AVG(DATEDIFF('day', f.first_date, s.second_date)), 1)                                 AS mean_days,
    COUNT(*)                                                                                     AS sample_size
FROM first_orders f
JOIN second_orders s USING(customer_id)
WHERE DATEDIFF('day', f.first_date, s.second_date) BETWEEN 1 AND 180""",
    "decisions": [
      ("P50 > 75 days", "Move Day-21 reorder email to Day 17, A/B test 'Your first pack is almost gone' messaging"),
      ("P50 < 45 days consistently", "Test subscription upsell in Day-30 email for customers who haven't yet subscribed"),
      ("P25 < 7 days growing", "Segment out same-week repeaters from retention calculations; these are gift buyers, not habit formers"),
      ("Distribution tightening over 3 months", "Post-purchase flow is working; consider intensifying with a Day-35 'expand your ritual' cross-sell"),
    ],
  },
  {
    "id": "m8",
    "num": "M8",
    "title": "LTV by Market",
    "group": "lifecycle",
    "color": "purple",
    "source": "Matrixify + Klaviyo",
    "insights": [
      ("US LTV Target", "$180 is the 12-month LTV target for US customers. Below $140 signals acquisition cohort quality is declining or retention flows are underperforming. The gap between current LTV and target multiplied by the active customer base is your retention revenue opportunity."),
      ("UK LTV Premium", "UK customers historically carry a £130–£150 LTV (USD equivalent $155–$180), driven by higher AOV and stronger gifting culture. UK LTV below $140 USD is a structural alert, not seasonal noise."),
      ("LTV Quartile Distribution", "The top 20% of customers typically deliver 65–70% of total revenue. If the top-quartile LTV is falling, you're losing your highest-value customers to churn before they've been fully monetised."),
      ("Channel LTV Variance", "Customers acquired via email referral or organic search have 40–60% higher LTV than customers acquired via paid social. LTV by acquisition channel is the true paid channel ROI metric."),
      ("Subscription LTV Multiplier", "Subscription customers have approximately 3.2× the LTV of equivalent one-time customers over 12 months. Rising subscription mix should show directly in blended LTV."),
      ("LTV Trajectory", "A customer's 90-day spend is the best predictor of their 12-month LTV (R² ≈ 0.73). If average 90-day spend is falling, 12-month LTV will follow with a 3-month lag."),
      ("Predicted vs Actual", "Klaviyo's predicted_clv_1y field is your leading indicator. If predicted LTV across the active base is falling, intervene with retention campaigns before actual LTV reflects it."),
    ],
    "combinations": [
      ("M11 CAC", "LTV:CAC ratio is the unit economics foundation. LTV / CAC below 3× means the business is not recovering acquisition costs within the measurement window."),
      ("M5 Repeat Rate", "LTV growth requires both higher repeat rate and higher AOV per transaction. If LTV is growing only from AOV while repeat rate falls, LTV is fragile."),
      ("M17 Churn Risk", "At-risk customers' predicted LTV represents recoverable revenue. The win-back campaign ROI calculation starts with: (targeted LTV - intervention cost) × recovery probability."),
      ("M9 New vs Returning Mix", "If new customer share is rising and LTV is flat, new cohort quality is declining. The colorway of LTV across cohort vintages is the true signal."),
    ],
    "warnings": [
      "US blended LTV < $140 for two consecutive months → Activate retention flow review; audit cohort quality by acquisition month",
      "Top-20% customer LTV declining YoY → High-value segment is churning; prioritise VIP win-back campaign",
      "Klaviyo predicted_clv_1y aggregate falling → Leading indicator of LTV decline; act before it shows in actuals",
    ],
    "sql": """WITH customer_ltv AS (
    SELECT
        o.email,
        p.churn_risk,
        p.predicted_clv_1y,
        CASE
            WHEN o.shipping_country = 'US' THEN 'US'
            WHEN o.shipping_country = 'GB' THEN 'UK'
            ELSE 'Other'
        END                                          AS market,
        SUM(o.total_price_usd)                       AS actual_ltv,
        COUNT(o.order_id)                            AS total_orders,
        DATEDIFF('day', MIN(o.processed_at), MAX(o.processed_at)) AS customer_tenure_days
    FROM matrixify.orders o
    LEFT JOIN klaviyo.profiles p USING(email)
    WHERE o.payment_status = 'paid'
      AND o.cancelled_at IS NULL
    GROUP BY o.email, p.churn_risk, p.predicted_clv_1y, market
)
SELECT
    market,
    ROUND(AVG(actual_ltv), 2)                        AS avg_actual_ltv,
    ROUND(AVG(predicted_clv_1y), 2)                  AS avg_predicted_ltv,
    ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY actual_ltv), 2) AS p75_ltv,
    ROUND(AVG(total_orders), 1)                      AS avg_orders,
    COUNT(*)                                         AS customer_count
FROM customer_ltv
WHERE market IN ('US', 'UK')
GROUP BY market
ORDER BY market""",
    "decisions": [
      ("US LTV < $140", "Audit post-purchase email sequence for click-through and conversion rates; A/B test subject lines in Day-21 reorder flow"),
      ("UK LTV < $140 USD", "Activate UK-specific flow; increase UK email send frequency; test GBP pricing transparency in emails"),
      ("LTV:CAC < 3x", "Freeze CAC-heavy paid channels; shift budget to retention and email expansion"),
      ("Predicted LTV falling", "Run immediate win-back campaign for high-CLV customers at churn risk; brief Klaviyo segment on at-risk predicted LTV cohort"),
    ],
  },
  {
    "id": "m9",
    "num": "M9",
    "title": "New vs Returning Mix",
    "group": "acquisition",
    "color": "teal",
    "source": "Matrixify",
    "insights": [
      ("Health Ratio", "A healthy D2C brand at Knickgasm's stage should see 35–45% new customer revenue and 55–65% returning customer revenue. New > 60% of revenue means retention is weak; returning < 50% means growth has stalled."),
      ("Acquisition Dependency", "If new customer revenue is growing but total revenue is flat, returning customer revenue is declining in absolute terms — classic leaky bucket. The new customer % metric will look fine while the business degrades."),
      ("Seasonal Shifts", "Q4 holiday campaigns skew the mix toward new buyers (gift purchasers). New customer % of 55–60% in November is expected; maintaining that through February is an alarm signal."),
      ("New Cohort Quality Trending", "Track new customers' average predicted LTV (from Klaviyo) at acquisition. Falling predicted LTV at acquisition means the acquisition machine is drawing lower-quality traffic — usually a sign of audience saturation or creative fatigue."),
      ("Returning Revenue per Customer", "Divide returning customer revenue by returning customer count. If this ratio is falling, your retained base is spending less per visit — cross-sell is not working, or the product range is being perceived as complete."),
    ],
    "combinations": [
      ("M1 Net Revenue", "Revenue growing with stable 40/60 new/returning mix is healthy scaling. Revenue flat with new % rising means retention is deteriorating."),
      ("M11 CAC", "If new customer % is rising and CAC is rising simultaneously, you're paying more to acquire lower-quality customers who won't retain. This is the most dangerous combination."),
      ("M6 Cohort Retention", "New customer mix tells you input rate; cohort retention tells you output quality. Low retention despite normal new/returning mix means the funnel is leaking silently."),
    ],
    "warnings": [
      "New customer % > 65% of revenue for three consecutive months → Retention crisis; activate post_purchase_series immediately",
      "Returning customer revenue declining in absolute terms → Leaky bucket; total revenue can mask this if new customers compensate",
      "New cohort predicted LTV < $120 at acquisition → Acquisition audience quality declining; review targeting parameters",
    ],
    "sql": """WITH customer_orders AS (
    SELECT
        email,
        order_id,
        processed_at,
        total_price_usd,
        ROW_NUMBER() OVER (PARTITION BY email ORDER BY processed_at) AS order_seq
    FROM matrixify.orders
    WHERE payment_status = 'paid' AND cancelled_at IS NULL
)
SELECT
    DATE_TRUNC('month', processed_at)               AS month,
    ROUND(SUM(CASE WHEN order_seq = 1 THEN total_price_usd ELSE 0 END), 2) AS new_customer_revenue,
    ROUND(SUM(CASE WHEN order_seq > 1 THEN total_price_usd ELSE 0 END), 2) AS returning_customer_revenue,
    COUNT(CASE WHEN order_seq = 1 THEN 1 END)       AS new_customers,
    COUNT(CASE WHEN order_seq > 1 THEN 1 END)       AS returning_customers,
    ROUND(SUM(CASE WHEN order_seq = 1 THEN total_price_usd ELSE 0 END) * 100.0
        / NULLIF(SUM(total_price_usd), 0), 1)        AS new_revenue_pct
FROM customer_orders
GROUP BY 1
ORDER BY 1 DESC
LIMIT 6""",
    "decisions": [
      ("New customer % > 65%", "Activate retention campaign across all at-risk segments; increase post-purchase email cadence"),
      ("Returning revenue declining in absolute terms", "Audit win-back and loyalty flows; consider loyalty programme or repeat purchase discount ladder"),
      ("New cohort predicted LTV falling", "Review Facebook/Google audience targeting; test lookalike audiences based on top-LTV customer profiles"),
      ("Healthy 40/60 mix maintained", "Focus on expanding returning customer AOV via cross-category recommendations in email flows"),
    ],
  },
  {
    "id": "m10",
    "num": "M10",
    "title": "LTV:CAC by Channel",
    "group": "acquisition",
    "color": "teal",
    "source": "Matrixify + Shopify Analytics",
    "insights": [
      ("The 3x Rule", "LTV:CAC of 3× or above means each acquired customer will generate $3 in LTV for every $1 spent acquiring them. Below 3×, the channel is not profitable at current scale. Below 2×, the channel is actively destroying value."),
      ("Payback Period Companion", "LTV:CAC ratio alone doesn't tell you when you break even. A 4× ratio with a 14-month payback is worse than a 3× ratio with a 6-month payback. Always pair with payback period."),
      ("Channel-Level Variance", "Email acquisition typically delivers the highest LTV:CAC (8–15×) because cost is near-zero for organic list growth. Paid social may run 2.5–4×. Influencer varies widely. Knowing channel-level ratios tells you where to shift marginal budget."),
      ("Scale Sensitivity", "LTV:CAC ratios compress as channels scale. A Facebook campaign delivering 4× at $5K/month may deliver 2.8× at $25K/month as audience quality declines. Monitor ratio trend, not just current snapshot."),
      ("Blended vs Marginal", "Blended LTV:CAC is the historical average. Marginal LTV:CAC (on the last $1 spent) is the decision variable. If blended is 3.5× but last month dropped to 2.4×, you're at inflection — cut before it colorways further down."),
      ("Seasonal Adjustment", "Q4 acquisition has structurally lower LTV:CAC because holiday cohorts retain poorly. Don't apply the standard 3× threshold to November acquisitions — use a 2.2× floor adjusted for the holiday retention discount."),
    ],
    "combinations": [
      ("M8 LTV", "LTV is the numerator; improving LTV (through better retention) improves LTV:CAC without reducing acquisition spend."),
      ("M11 CAC", "LTV:CAC is derived from both. If the ratio deteriorates, determine whether LTV is falling or CAC is rising — different interventions."),
      ("M1 Net Revenue", "Revenue growth with falling LTV:CAC means you're buying growth unsustainably. Revenue growth with stable or improving LTV:CAC is defensible scaling."),
    ],
    "warnings": [
      "LTV:CAC < 3x for any channel → Review that channel's audience targeting and creative; consider pausing and reinvesting in higher-ratio channels",
      "Blended LTV:CAC falling below 2.5x → Business-level alarm; convene unit economics review",
      "Q4 LTV:CAC below 2.0x for new cohorts → Holiday acquisition is not recovering cost; reduce Q4 paid acquisition spend",
    ],
    "sql": """SELECT
    acquisition_channel,
    ROUND(AVG(predicted_clv_1y), 2)         AS avg_predicted_ltv,
    ROUND(AVG(acquisition_cost_usd), 2)     AS avg_cac,
    ROUND(AVG(predicted_clv_1y)
        / NULLIF(AVG(acquisition_cost_usd), 0), 2) AS ltv_cac_ratio,
    CASE
        WHEN AVG(predicted_clv_1y) / NULLIF(AVG(acquisition_cost_usd), 0) >= 4 THEN 'SCALE'
        WHEN AVG(predicted_clv_1y) / NULLIF(AVG(acquisition_cost_usd), 0) >= 3 THEN 'HOLD'
        WHEN AVG(predicted_clv_1y) / NULLIF(AVG(acquisition_cost_usd), 0) >= 2 THEN 'REVIEW'
        ELSE 'PAUSE'
    END                                      AS channel_action,
    COUNT(*)                                 AS customer_count
FROM klaviyo.profiles
WHERE acquisition_channel IS NOT NULL
  AND acquisition_cost_usd > 0
GROUP BY acquisition_channel
ORDER BY ltv_cac_ratio DESC""",
    "decisions": [
      ("Channel LTV:CAC < 2x", "Pause spend immediately; reallocate to channels at 3x+"),
      ("Channel LTV:CAC 2–3x", "Reduce spend by 30%, A/B test new creative and audience targeting, re-evaluate after 6 weeks"),
      ("Channel LTV:CAC > 4x", "Increase budget allocation by 20%; test lookalike audience expansion"),
      ("Blended LTV:CAC falling", "Prioritise subscription conversion flows to raise LTV numerator; defer new channel testing"),
    ],
  },
  {
    "id": "m11",
    "num": "M11",
    "title": "CAC by Channel",
    "group": "acquisition",
    "color": "teal",
    "source": "Shopify Analytics + Klaviyo",
    "insights": [
      ("Absolute CAC Benchmarks", "Acceptable CAC for Knickgasm's price point and LTV profile: Paid Search $18–28, Paid Social $22–38, Influencer $15–45 (wide range by creator tier), Email/Organic $2–8. Anything above these ranges needs creative or targeting justification."),
      ("CAC Trend Matters More Than Level", "A $32 CAC that has been stable for 6 months is better than a $28 CAC rising 8% month-over-month. CAC trajectory predicts payback period compression before it shows in profitability."),
      ("New Creative Cycle Impact", "CAC on paid social tends to rise 15–25% after 6–8 weeks of running the same creative (audience fatigue). Monitoring CAC by channel gives you the earliest signal to refresh creative before CPMs spike."),
      ("Geography CAC Delta", "UK customer acquisition costs are typically 20–35% higher than US due to smaller addressable audience and higher CPMs. UK CAC should be evaluated against UK LTV (£-denominated) rather than a blended USD benchmark."),
      ("First-Touch vs Multi-Touch", "Last-touch attribution inflates paid social CAC (it captures the final click before purchase). Multi-touch or data-driven attribution typically reduces apparent paid social CAC by 15–20%. Be consistent in attribution model when tracking trends."),
    ],
    "combinations": [
      ("M10 LTV:CAC", "CAC is the denominator. Rising CAC with flat LTV means the ratio deteriorates. Use this pair to determine which lever to pull."),
      ("M8 LTV", "If CAC is rising but LTV is rising faster, the channel is still profitable — don't over-respond to rising CAC in isolation."),
      ("M9 New vs Returning Mix", "If new customer % is rising and CAC is rising, you're paying more per acquired customer and they're now a bigger share of revenue — double risk."),
    ],
    "warnings": [
      "Paid social CAC > $42 for two consecutive months → Creative refresh required; A/B test new formats (UGC vs produced, static vs video)",
      "Any channel CAC rising >15% MoM → Early fatigue signal; increase creative refresh cadence",
      "UK CAC > $55 USD equivalent → UK channel may be structurally unprofitable; evaluate against UK LTV before cutting",
    ],
    "sql": """SELECT
    DATE_TRUNC('month', o.processed_at)         AS month,
    p.acquisition_channel,
    COUNT(DISTINCT o.email)                     AS new_customers,
    ROUND(SUM(p.acquisition_cost_usd)
        / NULLIF(COUNT(DISTINCT o.email), 0), 2) AS cac,
    ROUND(AVG(p.predicted_clv_1y), 2)           AS avg_predicted_ltv,
    ROUND(AVG(p.predicted_clv_1y)
        / NULLIF(AVG(p.acquisition_cost_usd), 0), 2) AS ltv_cac_ratio
FROM matrixify.orders o
JOIN klaviyo.profiles p USING(email)
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
  AND p.acquisition_channel IS NOT NULL
  AND o.email IN (
      SELECT email FROM (
          SELECT email, ROW_NUMBER() OVER (PARTITION BY email ORDER BY processed_at) AS rn
          FROM matrixify.orders WHERE payment_status = 'paid'
      ) WHERE rn = 1
  )
GROUP BY 1, 2
ORDER BY 1 DESC, cac DESC""",
    "decisions": [
      ("Paid social CAC rising >10% MoM", "Brief creative team for UGC batch; test 3 new ad formats in 2-week sprint"),
      ("Paid search CAC > $30", "Audit keyword bidding strategy; add negative keywords for low-intent terms; test PMAX vs Search campaigns"),
      ("Influencer CAC > $50", "Review influencer tier and engagement quality; shift to micro-influencers (50K–200K) for better CPM efficiency"),
      ("Email/organic CAC rising", "Investigate list growth channels; activate referral programme or quiz-to-subscribe landing page"),
    ],
  },
  {
    "id": "m12",
    "num": "M12",
    "title": "Checkout Conversion Rate",
    "group": "product",
    "color": "coral",
    "source": "WebEngage",
    "insights": [
      ("Funnel Benchmarks", "Premium sneaker D2C benchmarks: add-to-cart → checkout initiation: 45–55%, checkout initiation → purchase complete: 62–72%. Below these thresholds, either the cart experience or the payment step has friction."),
      ("Mobile Checkout Drop", "Mobile checkout completion typically runs 12–18pp below desktop for purchase amounts over $45. Adding Apple Pay / Shop Pay can recover 6–9pp of mobile checkout conversion."),
      ("Shipping Cost Shock", "The single largest cause of checkout abandonment for Knickgasm's price range is unexpected shipping costs. Test free shipping threshold messaging in the cart view ('$8 away from free shipping') to reduce shock-based abandonment."),
      ("Guest Checkout Impact", "Requiring account creation at checkout typically increases abandonment by 10–15%. Monitor what percentage of checkouts are initiated by logged-in vs guest users and whether account-gating correlates with abandonment."),
      ("Payment Method Distribution", "Track conversion rate by payment method availability. Markets with higher digital wallet adoption (UK) will show higher conversion when Apple Pay/Google Pay are prominently featured."),
      ("Cart Size and Conversion", "Carts with >3 items convert at a lower rate (customers second-guess large orders). Implement a 'Save for Later' feature or offer to split the order if cart value exceeds $80."),
      ("Return Visitor Conversion Premium", "Returning visitors who've browsed before convert at 2.4× the rate of first-time visitors. Segment checkout conversion by visitor type to avoid blending these very different populations."),
      ("Time-of-Day Conversion", "Checkout conversion peaks 7–9pm local time in both US and UK. Email sends that drive traffic at off-peak hours will show lower attached conversion rates."),
    ],
    "combinations": [
      ("M13 Cart Abandonment", "Checkout conversion and cart abandonment are inverse: high abandonment = low checkout conversion. Together they pinpoint where in the funnel the drop is occurring."),
      ("M3 AOV", "If AOV is rising but conversion is falling, higher price points are creating checkout hesitation. Test buy-now-pay-later (Klarna/Afterpay) integration."),
      ("M4 Revenue per Session", "Checkout conversion is the primary driver of revenue per session. A 2pp improvement in checkout conversion translates to proportional RPS improvement."),
    ],
    "warnings": [
      "Checkout-to-purchase conversion below 62% → Immediate UX audit of checkout flow; test one-page checkout vs multi-step",
      "Mobile checkout conversion below 50% → Mobile payment options audit; A/B test Shop Pay prominence",
      "Checkout conversion falling during email send windows → Landing page-email message mismatch; align offer in email with offer on landing page",
    ],
    "sql": """SELECT
    DATE_TRUNC('week', event_date)              AS week,
    SUM(CASE WHEN event_name = 'Checkout Initiated' THEN event_count ELSE 0 END) AS checkout_starts,
    SUM(CASE WHEN event_name = 'Order created'       THEN event_count ELSE 0 END) AS purchases,
    ROUND(
        SUM(CASE WHEN event_name = 'Order created' THEN event_count ELSE 0 END) * 100.0
        / NULLIF(SUM(CASE WHEN event_name = 'Checkout Initiated' THEN event_count ELSE 0 END), 0),
    1) AS checkout_conversion_pct
FROM webengage.event_summary
WHERE event_date >= CURRENT_DATE - INTERVAL '56 days'
GROUP BY 1
ORDER BY 1 DESC""",
    "decisions": [
      ("Checkout conversion < 62%", "Audit checkout UX: test removing non-essential form fields, adding trust badges, A/B test one-page checkout"),
      ("Mobile conversion lagging desktop by >15pp", "Prioritise Apple Pay / Shop Pay integration; test sticky 'Buy Now' mobile CTA"),
      ("Shipping cost abandonment signal", "Add free-shipping progress indicator in cart; test 'Add one more item for free shipping' prompt"),
      ("Conversion declining during campaign sends", "Review landing page alignment with email offer; ensure promotion is visible above fold on mobile"),
    ],
  },
  {
    "id": "m13",
    "num": "M13",
    "title": "Cart Abandonment Rate",
    "group": "product",
    "color": "coral",
    "source": "WebEngage",
    "insights": [
      ("Abandonment Benchmark", "Industry average cart abandonment for D2C FMCG is 68–72%. Knickgasm's target ceiling is 80%. Above 80%, the add-to-cart action is functioning as a wishlist, not purchase intent."),
      ("Recovery Flow Economics", "A 3-email cart abandonment flow (1hr, 24hr, 72hr) typically recovers 8–15% of abandoned carts. At Knickgasm's blended AOV of $48, each percentage point of recovery on 1,000 abandoned carts = $480 in incremental revenue."),
      ("Abandonment by Cart Value", "Carts valued over $65 abandon at higher rates (43% above benchmark) due to purchase hesitation. Consider adding a 'low-stock' or 'ships tomorrow' indicator for these high-value carts."),
      ("Abandonment vs Checkout Initiation", "Distinguish 'added to cart but never started checkout' (awareness abandonment) from 'started checkout but didn't complete' (friction abandonment). These require different interventions."),
      ("Repeat Abandoner Segment", "Customers who abandon 2+ times in 30 days are 3.8× more likely to purchase if offered a small incentive (free shipping or 10% off) than standard reminder messaging. Identify this segment in Klaviyo."),
      ("Time-to-Abandonment", "If median time between add-to-cart and session end is <90 seconds, the customer was price-checking, not abandoning due to friction. If median is >8 minutes, checkout friction is the issue."),
    ],
    "combinations": [
      ("M12 Checkout Conversion", "Abandonment rate and checkout conversion measure the same funnel from different angles. Map them together to identify whether the problem is early (add-to-cart intent) or late (checkout friction)."),
      ("M4 Revenue per Session", "High abandonment reduces revenue per session directly. A 5pp reduction in abandonment rate translates to approximately $0.08–0.12 improvement in RPS."),
      ("M14 Email Revenue %", "If cart abandonment flows are included in email revenue attribution, a rise in abandonment with a rise in email revenue % may mean recovery flows are compensating for UX gaps — treat the symptom and the cause."),
    ],
    "warnings": [
      "Cart abandonment > 80% for two consecutive weeks → Cart recovery flow audit + UX friction investigation",
      "Abandonment rising while sessions are stable → Pricing or checkout UX change causing new friction; run A/B test isolation",
      "Repeat abandoner segment > 15% of total abandoners → Activate targeted incentive for repeat abandoners; standard recovery flow insufficient",
    ],
    "sql": """SELECT
    DATE_TRUNC('week', event_date)          AS week,
    SUM(CASE WHEN event_name = 'Added To Cart'  THEN event_count ELSE 0 END) AS add_to_cart,
    SUM(CASE WHEN event_name = 'Order created'  THEN event_count ELSE 0 END) AS completed_orders,
    ROUND(
        (1.0 - SUM(CASE WHEN event_name = 'Order created' THEN event_count ELSE 0 END) * 1.0
             / NULLIF(SUM(CASE WHEN event_name = 'Added To Cart' THEN event_count ELSE 0 END), 0)
        ) * 100, 1
    )                                        AS abandonment_pct
FROM webengage.event_summary
WHERE event_date >= CURRENT_DATE - INTERVAL '56 days'
GROUP BY 1
ORDER BY 1 DESC""",
    "decisions": [
      ("Abandonment > 80%", "Activate 3-email cart recovery flow if not running; if running, A/B test subject lines and 1hr vs 30min send time for first email"),
      ("Checkout friction abandonment > awareness abandonment", "Focus on checkout page UX audit; test removing account creation requirement"),
      ("Repeat abandoner segment identified", "Activate targeted 10% off / free shipping offer for 2+ abandon customers in Klaviyo"),
      ("Abandonment stable", "Continue monitoring; test 'Save cart' email for awareness abandoners to reduce list pressure"),
    ],
  },
  {
    "id": "m14",
    "num": "M14",
    "title": "Email Revenue %",
    "group": "email",
    "color": "blue",
    "source": "Klaviyo",
    "insights": [
      ("The 25% Floor", "Email should contribute a minimum 25% of total D2C revenue for a brand at Knickgasm's email maturity. Below 25% means either the list is underleveraged, send frequency is too low, or the audience is disengaged."),
      ("Flow vs Campaign Split", "Of the email revenue total, flows (automated sequences) should contribute 55–65% and campaigns (manual sends) 35–45%. Heavy campaign dependence means revenue is manual and unpredictable; heavy flow dependence is scalable but needs regular content refresh."),
      ("Revenue per Recipient", "Track revenue per recipient (RPR) per campaign. Below $0.08 RPR signals list fatigue or poor segmentation. Above $0.25 RPR indicates a high-performing campaign worth repeating or A/B testing."),
      ("Klaviyo Attribution Window", "Klaviyo's default attribution window is 5-day click, 1-day open. This tends to over-attribute compared to a 1-day click model. Ensure you're using a consistent attribution window across reports."),
      ("List Size vs Revenue Efficiency", "Revenue per recipient is more useful than total email revenue for tracking performance. A growing list with flat RPR means added subscribers are less engaged — review acquisition source quality."),
      ("Email Contribution to Retention", "Post-purchase flows should generate 12–18% of total email revenue. If this percentage is low, post-purchase sequences are underperforming and retention is being missed."),
      ("Unsubscribe Rate Impact", "Each percentage point of list health decline reduces total email revenue by approximately 1.5× that rate, compounded over 12 months. Email list health (M16) is the leading indicator for this metric."),
    ],
    "combinations": [
      ("M1 Net Revenue", "Email revenue % is derived from total revenue. If total revenue grows but email % falls, paid channels are compensating for email underperformance."),
      ("M16 Email List Health", "Declining list health precedes declining email revenue % by 30–60 days. M16 is the leading indicator for this metric."),
      ("M15 Flow vs Campaign Split", "Healthy email revenue requires both active campaigns and strong automated flows. This pair reveals structural vs tactical causes of email revenue changes."),
    ],
    "warnings": [
      "Email revenue % < 25% for two consecutive months → Trigger re_engagement campaign (engine P5); increase send frequency, review segment hygiene",
      "RPR falling below $0.08 → Audience disengagement; sunset inactive subscribers, refresh creative strategy",
      "Post-purchase flow contribution < 10% of email revenue → Post-purchase sequence is not converting; audit flow triggers and content",
    ],
    "sql": """SELECT
    DATE_TRUNC('month', k.sent_at)             AS month,
    ROUND(SUM(k.revenue_attributed), 2)        AS email_revenue,
    ROUND(MAX(r.net_sales), 2)                 AS total_revenue,
    ROUND(SUM(k.revenue_attributed) * 100.0
        / NULLIF(MAX(r.net_sales), 0), 1)       AS email_revenue_pct,
    ROUND(SUM(k.revenue_attributed)
        / NULLIF(SUM(k.recipients), 0), 3)     AS revenue_per_recipient,
    SUM(k.recipients)                          AS total_recipients
FROM klaviyo.campaigns k
JOIN shopify_analytics.revenue_metrics r
    ON DATE_TRUNC('month', k.sent_at) = r.report_date
    AND r.report_period = 'month'
WHERE k.channel = 'email'
GROUP BY 1
ORDER BY 1 DESC
LIMIT 6""",
    "decisions": [
      ("Email revenue % < 25%", "Increase campaign send frequency from weekly to 2x/week for top segments; reactivate dormant flows"),
      ("RPR < $0.08", "Run list sunset campaign; remove subscribers with zero opens in 180 days; resegment active list by engagement tier"),
      ("Post-purchase flow < 10%", "Audit flow trigger conditions; test adding Day 7 and Day 35 emails to post-purchase sequence"),
      ("Email revenue % growing", "Test expanding to SMS in parallel; measure incremental revenue vs email cannibalization"),
    ],
  },
  {
    "id": "m15",
    "num": "M15",
    "title": "Flow vs Campaign Split",
    "group": "email",
    "color": "blue",
    "source": "Klaviyo",
    "insights": [
      ("Automation Health Ratio", "Flows should generate 55–65% of email revenue. Below 50% means too much manual effort is sustaining email revenue — fragile and not scalable. Above 70% means campaigns are underperforming their potential."),
      ("Flow Types Breakdown", "Of flow revenue, welcome series should contribute 8–12%, post-purchase 12–18%, win-back 10–15%, browse abandonment 6–10%, cart abandonment 15–20%. If any single flow is contributing >30%, other flows are likely misconfigured."),
      ("Campaign Frequency Baseline", "2–3 campaigns per week to the full list will cause list fatigue within 6 months. Segment campaigns by engagement tier (highly engaged, engaged, at-risk) and reduce frequency for lower tiers."),
      ("Flow Conversion Rates", "Track conversion rate per flow, not just revenue attribution. A high-revenue flow with low conversion may just have high send volume. A low-revenue flow with high conversion is an underutilised asset."),
      ("Seasonal Campaign Lift", "Campaign revenue spikes in Q4 (Oct–Dec) are expected and healthy; this is the nature of promotional campaigns. The ratio should naturally shift toward campaigns during this period and recover in Q1."),
    ],
    "combinations": [
      ("M14 Email Revenue %", "If overall email revenue is declining, this split reveals whether it's a flow problem (automation decay) or a campaign problem (creative fatigue or segment exhaustion)."),
      ("M16 Email List Health", "If list health is declining, high-volume campaigns will accelerate the decline. Shift revenue mix toward flows (lower send volume, higher relevance) to protect list health."),
      ("M17 Churn Risk", "Win-back flows are the primary tool for at-risk segments. If win-back flow revenue is low despite a large at-risk segment, the flow needs triggering or content refresh."),
    ],
    "warnings": [
      "Flows contributing < 45% of email revenue → Review all flow triggers; test whether flows are firing correctly for key segments",
      "Campaign frequency > 3/week to full list → Implement engagement-based frequency caps; separate highly engaged from at-risk segments",
      "Win-back flow revenue < 8% of email revenue when at-risk segment > 15% of list → Win-back flow trigger or content failure",
    ],
    "sql": """SELECT
    DATE_TRUNC('month', sent_at)                AS month,
    campaign_type,
    COUNT(campaign_id)                          AS send_count,
    SUM(recipients)                             AS total_recipients,
    ROUND(SUM(revenue_attributed), 2)           AS revenue,
    ROUND(AVG(open_rate) * 100, 1)              AS avg_open_rate_pct,
    ROUND(AVG(ctor) * 100, 1)                   AS avg_ctor_pct,
    ROUND(SUM(revenue_attributed)
        / NULLIF(SUM(recipients), 0), 3)        AS revenue_per_recipient
FROM klaviyo.campaigns
WHERE channel = 'email'
GROUP BY 1, 2
ORDER BY 1 DESC, revenue DESC""",
    "decisions": [
      ("Flows < 45% of email revenue", "Audit all active flow triggers; check for broken A/B tests or paused sequences; review welcome series performance"),
      ("Campaigns > 55% of email revenue", "Build or refresh 2 automated flows (browse abandonment, post-win-back subscription upsell)"),
      ("Win-back flow underperforming", "Rewrite win-back email sequence; test 'We miss you + origin story' vs 'Here's what's new' framing"),
      ("Cart abandonment flow < 15% of flow revenue", "Increase send cadence from 3 emails to 4; test 30-minute vs 1-hour first send"),
    ],
  },
  {
    "id": "m16",
    "num": "M16",
    "title": "Email List Health",
    "group": "email",
    "color": "blue",
    "source": "Klaviyo",
    "insights": [
      ("Health Definition", "Email list health is the proportion of subscribers who are deliverable (not bounced or spam-flagged) and have engaged (opened or clicked) within the last 90 days. Below 80% health triggers ISP reputation risk that can cascade into all sends, including flows."),
      ("Bounce Cascade Risk", "Hard bounce rates above 2% across a single send can trigger Gmail/Yahoo bulk sender penalties that affect all future sends. Hard bounces should be removed from the list immediately after the first occurrence."),
      ("Spam Complaint Threshold", "Google's bulk sender threshold is 0.10% spam complaint rate. Above this, deliverability is penalised across the domain. Above 0.30%, the domain may be temporarily blocked."),
      ("Re-engagement Window", "Subscribers with no open in 180 days should be entered into a re-engagement flow before being sunset. Sending marketing emails to unengaged subscribers is the primary driver of list health degradation."),
      ("List Growth Quality", "List health tells you about the existing subscriber base. If list health is falling while the list is growing, new subscriber quality is low — evaluate acquisition source and double opt-in status."),
      ("Segmentation Impact", "Sending only to engaged segments (opens in 90 days) will show higher open rates but is also protecting list health. Aggressive full-list sends will suppress apparent open rates and degrade health."),
    ],
    "combinations": [
      ("M14 Email Revenue %", "List health is the leading indicator for email revenue. Declining health precedes declining revenue by 30–60 days."),
      ("M17 Churn Risk", "Customers with high churn risk often also have low email engagement. The crossover of churn risk and email disengagement is the highest-priority win-back + re-engagement segment."),
      ("M15 Flow vs Campaign Split", "High campaign frequency with low list health will accelerate health degradation. If health is declining, immediately shift frequency toward flows."),
    ],
    "warnings": [
      "List health below 80% → Activate re-engagement campaign for unengaged subscribers; pause full-list sends until health recovers",
      "Hard bounce rate > 1.5% on any send → Remove bounced addresses immediately; investigate acquisition source for invalid emails",
      "Spam complaint rate > 0.08% → Investigate recent campaign content and subject lines; review unsubscribe prominence",
    ],
    "sql": """SELECT
    DATE_TRUNC('month', last_active_date)       AS month,
    COUNT(*)                                    AS total_profiles,
    COUNT(CASE WHEN email_status = 'subscribed' THEN 1 END) AS subscribed,
    COUNT(CASE WHEN email_status = 'unsubscribed' THEN 1 END) AS unsubscribed,
    COUNT(CASE WHEN email_status = 'bounced' THEN 1 END)     AS bounced,
    ROUND(COUNT(CASE WHEN email_status = 'subscribed'
                      AND last_active_date >= CURRENT_DATE - INTERVAL '90 days'
                     THEN 1 END) * 100.0
        / NULLIF(COUNT(CASE WHEN email_status = 'subscribed' THEN 1 END), 0), 1) AS engaged_pct
FROM klaviyo.profiles
GROUP BY 1
ORDER BY 1 DESC
LIMIT 6""",
    "decisions": [
      ("Engaged % < 80%", "Run sunset campaign for 180-day inactive subscribers; add re-engagement flow for 90-day inactives"),
      ("Bounce rate spiking", "Audit recent list acquisition sources; implement email validation on all list entry points"),
      ("List health recovering", "Gradually expand send frequency; monitor open and click rates as new segments receive emails"),
      ("List health stable at 85%+", "Test expanding to slightly less-engaged segments to grow reachable audience without compromising health"),
    ],
  },
  {
    "id": "m17",
    "num": "M17",
    "title": "Churn Risk Distribution",
    "group": "email",
    "color": "blue",
    "source": "Klaviyo",
    "insights": [
      ("Risk Tier Definitions", "Klaviyo's churn risk model typically outputs: active (purchased in 30 days), at-risk (31–60 days no purchase), high risk (61–90 days), winback (90+ days). These correspond to decreasing probability of repeat purchase."),
      ("Revenue Concentration in Risk Tiers", "If high-risk and winback segments collectively hold >35% of predicted CLV, the business has a structural retention problem, not a marketing problem. Customer success or product intervention is needed."),
      ("High-CLV Churn Signal", "Customers with predicted CLV > $200 moving into high-risk/winback tier represent recoverable revenue. This is the trigger for the P1 win_back_vip campaign in the mailer engine."),
      ("Churn Leading Indicators", "Email engagement drops 3–4 weeks before churn risk increases. Customers who stop opening emails but haven't yet churned are the ideal intervention target — still reachable, not yet lost."),
      ("Winback Recovery Rate Benchmark", "Industry winback recovery rate for premium D2C is 8–15%. At Knickgasm's CLV profile, even 10% recovery of a $200K at-risk cohort generates $20K incremental revenue — typically well above flow cost."),
      ("Seasonal Churn Pattern", "Post-holiday (Jan–Feb) typically shows a churn spike as gift buyers don't convert to personal buyers. Proactive January reactivation campaigns for December new cohorts can halve this spike."),
      ("Risk Distribution Stability", "Track the distribution monthly: % active, % at-risk, % high-risk, % winback. A stable distribution with active > 60% is healthy. Active declining month-over-month is the most important early warning."),
    ],
    "combinations": [
      ("M8 LTV", "Churn risk x predicted LTV = recoverable revenue at risk. The combination is the exact input to the win_back_vip campaign trigger in the mailer engine."),
      ("M18 At-Risk Revenue", "M17 shows the distribution; M18 shows the dollar value. Together they tell you severity and action priority."),
      ("M5 Repeat Purchase Rate", "If repeat rate is stable but churn risk distribution is worsening, the issue is recency (customers purchasing less frequently) not frequency (customers who never came back)."),
    ],
    "warnings": [
      "Winback + high-risk > 35% of predicted CLV → Structural retention issue; P1 win_back_vip trigger should be active",
      "Active segment declining 3+ consecutive months → Systematic churn; review product-market fit signals",
      "High-CLV customers (CLV > $200) entering high-risk tier → Immediate VIP win-back campaign activation",
    ],
    "sql": """SELECT
    churn_risk,
    COUNT(*)                                         AS profile_count,
    ROUND(AVG(predicted_clv_1y), 2)                  AS avg_predicted_clv,
    ROUND(SUM(predicted_clv_1y), 2)                  AS total_at_risk_clv,
    ROUND(COUNT(*) * 100.0
        / SUM(COUNT(*)) OVER (), 1)                  AS pct_of_list,
    COUNT(CASE WHEN predicted_clv_1y > 200 THEN 1 END) AS high_clv_count
FROM klaviyo.profiles
WHERE email_status = 'subscribed'
GROUP BY churn_risk
ORDER BY
    CASE churn_risk
        WHEN 'active'   THEN 1
        WHEN 'at_risk'  THEN 2
        WHEN 'high'     THEN 3
        WHEN 'winback'  THEN 4
        ELSE 5
    END""",
    "decisions": [
      ("High-risk + winback CLV > $50K", "Activate P1 win_back_vip campaign; personalise with last SKU purchased and CLV-appropriate offer"),
      ("Active segment declining", "Review post-purchase email engagement rates; audit Day 7 and Day 21 flow performance"),
      ("January churn spike anticipated", "Pre-build January reactivation campaign for December new cohort before month-end"),
      ("High-CLV customers entering at-risk", "Trigger proactive outreach within 7 days of entering at-risk tier; do not wait for high-risk tier"),
    ],
  },
  {
    "id": "m18",
    "num": "M18",
    "title": "At-Risk Revenue",
    "group": "email",
    "color": "blue",
    "source": "Klaviyo",
    "insights": [
      ("The $50K Trigger", "When predicted CLV of customers in high-risk + winback tiers exceeds $50K, the win_back_vip campaign trigger fires automatically. This threshold was calibrated against Knickgasm's average win-back campaign cost and recovery rate."),
      ("Recoverable vs Lost Revenue", "Not all at-risk CLV is recoverable. Empirical recovery rate for premium D2C win-back campaigns is 8–15%. Apply this range to at-risk CLV to estimate the campaign's revenue opportunity: $50K at-risk × 12% recovery = $6K incremental revenue."),
      ("Segmentation Depth", "At-risk revenue should be segmented by: last SKU purchased (product-specific re-engagement), days since last order (urgency calibration), and predicted CLV tier (offer calibration — high CLV gets 15% off, mid CLV gets free shipping)."),
      ("Campaign ROI Calculation", "Win-back campaign ROI = (at-risk CLV × recovery rate × gross margin) - campaign cost. At Knickgasm's 55%+ GM and a $2K email campaign cost, the ROI is positive at recovery rates above 4%."),
      ("At-Risk Revenue Trend", "If at-risk revenue grows month-over-month even after win-back campaigns, the acquisition machine is adding customers faster than retention is keeping them. Address the retention system, not just the win-back symptom."),
      ("Time-Decay Factor", "The probability of winback declines with time: 12% at 60 days, 8% at 90 days, 4% at 120 days. Send win-back campaigns at 60–75 days since last purchase — not earlier (intrusive) and not later (probability too low)."),
    ],
    "combinations": [
      ("M17 Churn Risk", "M17 shows count and distribution; M18 shows revenue concentration. The combination tells you whether you have a broad shallow problem (many low-CLV churners) or a narrow deep problem (few high-CLV churners)."),
      ("M8 LTV", "At-risk revenue is essentially 'LTV deferred.' Successfully winning back customers brings their predicted LTV back into the active column."),
      ("M6 Cohort Retention", "If at-risk revenue is growing, check whether specific cohorts (e.g., holiday acquisitions) are disproportionately represented. This pinpoints cohort-level retention failures."),
    ],
    "warnings": [
      "At-risk revenue > $50K → Win_back_vip trigger fires; do not delay campaign activation",
      "At-risk revenue growing 3+ consecutive months despite win-back campaigns → Systemic retention failure; escalate to product and customer experience teams",
      "High-CLV at-risk customers not opening win-back emails → Deliverability or subject line issue; A/B test subject lines with personalised last-SKU reference",
    ],
    "sql": """SELECT
    churn_risk,
    COUNT(*)                                     AS at_risk_count,
    ROUND(SUM(predicted_clv_1y), 2)              AS total_at_risk_revenue,
    ROUND(AVG(predicted_clv_1y), 2)              AS avg_clv,
    ROUND(AVG(total_orders), 1)                  AS avg_orders,
    ROUND(AVG(DATEDIFF('day',
        last_order_date::DATE, CURRENT_DATE)), 0) AS avg_days_since_order,
    COUNT(CASE WHEN predicted_clv_1y > 200 THEN 1 END) AS high_clv_at_risk
FROM klaviyo.profiles
WHERE churn_risk IN ('high', 'winback')
  AND email_status = 'subscribed'
GROUP BY churn_risk
ORDER BY total_at_risk_revenue DESC""",
    "decisions": [
      ("Total at-risk > $50K", "Launch win_back_vip campaign immediately; segment by CLV tier for personalised offers"),
      ("High-CLV at-risk count > 50", "Prioritise personal outreach (concierge-style email from founder or brand) for top 50 by predicted CLV"),
      ("At-risk revenue growing despite campaigns", "Increase post-purchase flow touchpoints; add Day 60 proactive reactivation before at-risk classification"),
      ("Recovery rate < 8%", "Test new win-back creative framing ('From the studios of...' origin story vs % off offer); A/B the control against value-led content"),
    ],
  },
  {
    "id": "m19",
    "num": "M19",
    "title": "Product Repeat Rate",
    "group": "product",
    "color": "coral",
    "source": "Matrixify",
    "insights": [
      ("SKU-Level Retention Signal", "Product repeat rate measures how frequently customers reorder the same SKU. A rate above 35% for a hand-painted product signals it has become a habit product. Below 20% means it's being experienced as a one-time purchase."),
      ("Portfolio Architecture", "High-repeat SKUs should anchor subscription offerings. Low-repeat SKUs should be positioned as discovery or gift items. Matching subscription promotion to repeat-rate data prevents over-subscribing products with natural variety-seeking behaviour."),
      ("First-Order SKU Impact", "The repeat rate of the first SKU purchased predicts overall customer retention. Jordan First Flush as a first-order SKU drives 2.3× repeat rate vs gift sets. This data should inform acquisition creative featuring product-led (not set-led) messaging."),
      ("Cross-SKU Progression", "Customers who repeat-purchase within category (e.g., Jordan → Airforce → Court Vision) have higher LTV than same-SKU repeaters. Track cross-category expansion as a retention quality metric."),
      ("Seasonal SKU Rotation", "Some SKUs have inherent seasonality (First Flush is spring/summer, autumnal colorways are Q3/Q4). Low repeat rate in off-season is expected; track trailing 12-month repeat rate for seasonal products."),
      ("Bundle Fragmentation", "Bundles rarely repeat as-is (customers want variety). Track bundle component SKU repeat separately from bundle-as-item repeat to avoid artificially deflating repeat rate for high-performing ingredients."),
      ("Subscription Conversion by Repeat Rate", "SKUs with >40% repeat rate AND >200 subscription subscribers should be reviewed for subscription pricing — they may be underpriced for auto-replenishment demand."),
    ],
    "combinations": [
      ("M20 Subscription Mix", "High-repeat-rate SKUs are the natural subscription candidates. This combination identifies which products should anchor subscription conversion campaigns."),
      ("M5 Repeat Purchase Rate", "Product repeat rate (same SKU) is more specific than repeat purchase rate (any SKU). High overall repeat rate with low product repeat rate means customers are exploring the catalogue — healthy for AOV, requires cross-sell flow."),
      ("M8 LTV", "Products with high repeat rates consistently produce higher LTV customers. Use repeat rate as a proxy for LTV-predicting SKU selection."),
    ],
    "warnings": [
      "Anchor SKU repeat rate falling below 30% → Review product quality consistency, customer reviews, and packaging for that SKU",
      "First-order gift set share growing above 35% of new customers → Long-term repeat rate will decline; adjust acquisition creative to feature personal-consumption SKUs",
      "No SKU above 40% repeat rate → Subscription product positioning is unclear; review catalogue and create dedicated subscription tier",
    ],
    "sql": """SELECT
    li.title                                     AS product_name,
    COUNT(DISTINCT o.email)                      AS unique_buyers,
    COUNT(*)                                     AS total_orders,
    ROUND(COUNT(*) * 1.0
        / NULLIF(COUNT(DISTINCT o.email), 0), 2) AS orders_per_buyer,
    COUNT(DISTINCT CASE
        WHEN o.email IN (
            SELECT email FROM matrixify.orders WHERE payment_status = 'paid'
            GROUP BY email HAVING COUNT(*) > 1
        ) THEN o.email
    END)                                         AS repeat_buyers,
    ROUND(COUNT(DISTINCT CASE
        WHEN o.email IN (
            SELECT email FROM matrixify.orders WHERE payment_status = 'paid'
            GROUP BY email HAVING COUNT(*) > 1
        ) THEN o.email
    END) * 100.0 / NULLIF(COUNT(DISTINCT o.email), 0), 1) AS repeat_buyer_pct
FROM matrixify.order_line_items li
JOIN matrixify.orders o USING(order_id)
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
GROUP BY li.title
HAVING COUNT(DISTINCT o.email) >= 50
ORDER BY repeat_buyer_pct DESC
LIMIT 10""",
    "decisions": [
      ("Anchor SKU repeat > 40%", "Prioritise that SKU in subscription conversion emails; create a dedicated subscription upsell flow triggered at Day 30 post-purchase"),
      ("Gift set first-order share rising", "Shift 20% of acquisition budget to campaigns featuring hand-painted products; A/B test gift-set vs hand-painted landing pages"),
      ("No SKU above 35% repeat", "Review product education in post-purchase emails; add craft guide, design profile, and ritual-building content"),
      ("Cross-category expansion low", "Add 'Complete Your Ritual' product recommendation block to Day 21 post-purchase email; personalise by first-order SKU category"),
    ],
  },
  {
    "id": "m20",
    "num": "M20",
    "title": "Subscription Mix %",
    "group": "product",
    "color": "coral",
    "source": "Matrixify",
    "insights": [
      ("The 15% Target", "Subscription orders should represent at least 15% of total monthly order volume. Below 15%, subscription infrastructure is underutilised. Above 30%, subscription has likely become a discount channel rather than a convenience-and-habit driver."),
      ("Subscription Revenue Stability", "Subscription revenue is predictable: it buffers total revenue against promotional cycles and campaign variability. A 15% subscription mix creates a predictable monthly revenue floor that improves forecasting and reduces paid campaign dependency."),
      ("Subscription AOV Premium", "Subscription orders consistently run 8–12% higher AOV than one-time orders because customers add complementary SKUs during subscription setup. This AOV premium is captured at setup, not at renewal."),
      ("Churn Rate Within Subscription", "Active subscriptions have a monthly churn rate of 3–6% for premium D2C. Below 3% is excellent. Above 8% means subscribers aren't experiencing the value proposition (product quality, convenience, or perceived savings)."),
      ("Subscription Conversion Window", "The highest-conversion window for subscription upsell is immediately post-purchase (checkout upsell) and Day 14–30 post-purchase (habit formation window). Outside these windows, conversion rates drop significantly."),
      ("Subscription SKU Concentration", "If >60% of subscription revenue comes from a single SKU, the subscription programme is fragile. Diversification across 3–5 SKUs is the healthier model."),
      ("Cancellation Reason Distribution", "Track subscription cancellation reasons: 'too much sneaker' (frequency issue), 'too expensive' (price issue), 'switching product' (assortment issue). Each has a different intervention: frequency change, discount, or cross-SKU recommendation."),
      ("Subscriber LTV Multiplier", "Subscription customers have 3.2× the 12-month LTV of comparable one-time customers. Each 1pp increase in subscription mix improves blended LTV by approximately $4–7 depending on cohort CLV distribution."),
    ],
    "combinations": [
      ("M19 Product Repeat Rate", "Products with high repeat rates but low subscription conversion are subscription candidates. Build targeted subscription upsell campaigns for these SKUs."),
      ("M2 Gross Margin", "Subscription orders have zero acquisition cost on renewal. Rising subscription mix should expand effective gross margin (same COGS, lower effective CAC). If GM% isn't improving with rising subscription mix, COGS or discount structure needs review."),
      ("M5 Repeat Purchase Rate", "As subscription mix rises, the 90-day repeat rate metric will be affected (subscribers automatically count as repeaters). Normalise M5 by excluding subscription renewals to track organic habit formation separately."),
      ("M17 Churn Risk", "Subscription customers rarely appear in high churn-risk buckets unless they're about to cancel. Monitor subscription churn separately from overall churn risk."),
    ],
    "warnings": [
      "Subscription mix < 15% for three consecutive months → Activate subscription_conversion campaign (engine P3); increase checkout upsell prominence",
      "Subscription monthly churn > 8% → Audit subscription experience: packaging, frequency options, and ease of skip/pause; send a satisfaction survey",
      "Single SKU > 60% of subscription revenue → Diversify subscription catalogue; add complementary SKUs to subscriber post-purchase cross-sell",
    ],
    "sql": """SELECT
    DATE_TRUNC('month', o.processed_at)         AS month,
    COUNT(o.order_id)                            AS total_orders,
    SUM(CASE
        WHEN li.properties::TEXT ILIKE '%subscription%'
          OR li.properties::TEXT ILIKE '%frequency%'
        THEN 1 ELSE 0
    END)                                         AS subscription_orders,
    ROUND(SUM(CASE
        WHEN li.properties::TEXT ILIKE '%subscription%'
          OR li.properties::TEXT ILIKE '%frequency%'
        THEN 1 ELSE 0
    END) * 100.0 / NULLIF(COUNT(o.order_id), 0), 1) AS subscription_mix_pct,
    ROUND(AVG(CASE
        WHEN li.properties::TEXT ILIKE '%subscription%'
        THEN o.total_price_usd
    END), 2)                                     AS subscription_aov,
    ROUND(AVG(CASE
        WHEN li.properties::TEXT NOT ILIKE '%subscription%'
        THEN o.total_price_usd
    END), 2)                                     AS onetime_aov
FROM matrixify.orders o
JOIN matrixify.order_line_items li USING(order_id)
WHERE o.payment_status = 'paid'
  AND o.cancelled_at IS NULL
GROUP BY 1
ORDER BY 1 DESC
LIMIT 6""",
    "decisions": [
      ("Subscription mix < 15%", "A/B test subscription upsell placement at checkout; test 'Subscribe and save 10%' vs 'Subscribe for free shipping' framing"),
      ("Subscription churn > 8%", "Send cancellation survey to last 60 churned subscribers; test 'Pause' option in cancellation flow to reduce hard cancels"),
      ("Single SKU > 60% of subscription", "Launch 'Expand Your Ritual' email campaign for existing subscribers; offer 3-SKU bundle subscription at a discount"),
      ("Subscription mix growing steadily", "Scale subscription conversion campaign; test converting one-time buyers at checkout with social proof ('4,200 Knickgasm subscribers love this colorway')"),
    ],
  },
]

# ---------------------------------------------------------------------------
# Nav group definitions
# ---------------------------------------------------------------------------
NAV_GROUPS = [
  {
    "label": "Revenue &amp; Financial",
    "color": "amber",
    "metrics": ["m1","m2","m3","m4"],
  },
  {
    "label": "Customer Lifecycle",
    "color": "purple",
    "metrics": ["m5","m6","m7","m8"],
  },
  {
    "label": "Acquisition &amp; Mix",
    "color": "teal",
    "metrics": ["m9","m10","m11"],
  },
  {
    "label": "Email &amp; CRM",
    "color": "blue",
    "metrics": ["m14","m15","m16","m17","m18"],
  },
  {
    "label": "Product &amp; Subscription",
    "color": "coral",
    "metrics": ["m12","m13","m19","m20"],
  },
]

METRIC_BY_ID = {m["id"]: m for m in METRICS}

# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------

def e(s):
    """HTML-escape a plain string."""
    return str(s).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"','&quot;')

def render_sidebar():
    parts = []
    parts.append('<aside class="sidebar" id="sidebar">')
    parts.append('<div class="brand"><div class="brand-name">KNICKGASM DTC</div><div class="brand-sub">Metric Intelligence Guide</div></div>')
    parts.append('<nav class="sidebar-nav">')
    for g in NAV_GROUPS:
        color = g["color"]
        parts.append(f'<div class="nav-group" data-color="{color}">')
        parts.append(f'<div class="nav-group-label" onclick="toggleGroup(this)">{g["label"]}<span class="nav-chevron">&#9660;</span></div>')
        parts.append('<div class="nav-group-items">')
        for mid in g["metrics"]:
            m = METRIC_BY_ID[mid]
            parts.append(f'<a href="#{mid}" class="nav-item" data-id="{mid}">{m["num"]} {e(m["title"])}</a>')
        parts.append('</div></div>')
    parts.append('</nav></aside>')
    return "\n".join(parts)

def render_metric(m):
    color = m["color"]
    mid = m["id"]
    parts = []
    parts.append(f'<section id="{mid}" class="metric-section color-{color}">')

    # Header
    parts.append('<div class="metric-header">')
    parts.append(f'<div class="metric-number color-{color}-text">{e(m["num"])}</div>')
    parts.append('<div class="metric-info">')
    parts.append(f'<h2>{e(m["title"])}</h2>')
    parts.append(f'<span class="source-badge badge-{color}">{e(m["source"])}</span>')
    parts.append('</div></div>')

    # Insights
    parts.append('<div class="section-block">')
    parts.append('<h4 class="section-label">Key Insights</h4>')
    parts.append('<div class="insights-grid">')
    for title, body in m["insights"]:
        parts.append('<div class="insight-card">')
        parts.append(f'<h3>{e(title)}</h3>')
        parts.append(f'<p>{e(body)}</p>')
        parts.append('</div>')
    parts.append('</div></div>')

    # Combinations
    parts.append('<div class="section-block">')
    parts.append('<h4 class="section-label">Combination Insights</h4>')
    parts.append('<div class="combo-list">')
    for pair, text in m["combinations"]:
        parts.append('<div class="combo-item">')
        parts.append(f'<span class="combo-pair color-{color}-text">+ {e(pair)}</span>')
        parts.append(f'<span class="combo-text">{e(text)}</span>')
        parts.append('</div>')
    parts.append('</div></div>')

    # Warnings
    parts.append('<div class="section-block">')
    parts.append('<h4 class="section-label">Warning Signals</h4>')
    parts.append('<div class="warnings-list">')
    for w in m["warnings"]:
        parts.append(f'<div class="warning-card">{e(w)}</div>')
    parts.append('</div></div>')

    # SQL
    parts.append('<div class="section-block">')
    parts.append('<h4 class="section-label">DuckDB Query</h4>')
    parts.append('<div class="sql-block">')
    parts.append(f'<pre class="sql-code">{highlight_sql(m["sql"])}</pre>')
    parts.append('</div></div>')

    # Decisions
    parts.append('<div class="section-block">')
    parts.append('<h4 class="section-label">Decision Cards</h4>')
    parts.append('<div class="decision-grid">')
    for i, (condition, action) in enumerate(m["decisions"], 1):
        parts.append('<div class="decision-card">')
        parts.append(f'<div class="decision-number">{i}</div>')
        parts.append(f'<div class="decision-condition">{e(condition)}</div>')
        parts.append('<div class="decision-arrow">&#8594;</div>')
        parts.append(f'<div class="decision-action">{e(action)}</div>')
        parts.append('</div>')
    parts.append('</div></div>')

    parts.append('</section>')
    return "\n".join(parts)

# ---------------------------------------------------------------------------
# Full HTML
# ---------------------------------------------------------------------------

def build_html():
    sidebar_html = render_sidebar()
    metrics_html = "\n".join(render_metric(m) for m in METRICS)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>KNICKGASM DTC — Metric Intelligence Guide</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
/* ===== CSS VARIABLES ===== */
:root {{
  --sidebar-width: 260px;
  --bg: #0f1117;
  --bg-card: #1a1f2e;
  --bg-sidebar: #0d1018;
  --text: #e8eaf0;
  --text-muted: #8892a4;
  --text-dim: #5a6478;
  --border: #2a3045;
  --amber: #f59e0b;
  --amber-dim: rgba(245,158,11,0.12);
  --purple: #8b5cf6;
  --purple-dim: rgba(139,92,246,0.12);
  --teal: #14b8a6;
  --teal-dim: rgba(20,184,166,0.12);
  --blue: #3b82f6;
  --blue-dim: rgba(59,130,246,0.12);
  --coral: #f97316;
  --coral-dim: rgba(249,115,22,0.12);
  --warning-red: #ef4444;
  --sql-bg: #0a0d14;
  --sql-text: #c9d1e3;
  --radius: 10px;
  --radius-sm: 6px;
}}

@media (prefers-color-scheme: light) {{
  :root {{
    --bg: #f8f9fb;
    --bg-card: #ffffff;
    --bg-sidebar: #1a1f2e;
    --text: #1a1f2e;
    --text-muted: #5a6478;
    --text-dim: #8892a4;
    --border: #e2e8f0;
    --sql-bg: #0f1117;
    --sql-text: #c9d1e3;
  }}
}}

/* ===== RESET & BASE ===== */
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
html {{ scroll-behavior: smooth; }}
body {{
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}}

/* ===== SIDEBAR ===== */
.sidebar {{
  position: fixed;
  left: 0; top: 0;
  width: var(--sidebar-width);
  height: 100vh;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  z-index: 100;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}}
.sidebar::-webkit-scrollbar {{ width: 4px; }}
.sidebar::-webkit-scrollbar-track {{ background: transparent; }}
.sidebar::-webkit-scrollbar-thumb {{ background: var(--border); border-radius: 2px; }}

.brand {{
  padding: 24px 20px 18px;
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0;
  background: var(--bg-sidebar);
  z-index: 1;
}}
.brand-name {{
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--amber);
}}
.brand-sub {{
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 3px;
  font-weight: 400;
}}

.sidebar-nav {{ padding: 8px 0 24px; }}

.nav-group {{ border-bottom: 1px solid var(--border); }}
.nav-group-label {{
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px 10px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
  transition: color 0.15s;
}}
.nav-group-label:hover {{ color: var(--text-muted); }}
.nav-group[data-color="amber"] .nav-group-label {{ color: var(--amber); opacity: 0.85; }}
.nav-group[data-color="purple"] .nav-group-label {{ color: var(--purple); opacity: 0.85; }}
.nav-group[data-color="teal"] .nav-group-label {{ color: var(--teal); opacity: 0.85; }}
.nav-group[data-color="blue"] .nav-group-label {{ color: var(--blue); opacity: 0.85; }}
.nav-group[data-color="coral"] .nav-group-label {{ color: var(--coral); opacity: 0.85; }}

.nav-chevron {{ font-size: 9px; transition: transform 0.2s; }}
.nav-group.collapsed .nav-chevron {{ transform: rotate(-90deg); }}
.nav-group.collapsed .nav-group-items {{ display: none; }}

.nav-group-items {{ padding-bottom: 4px; }}
.nav-item {{
  display: block;
  padding: 7px 20px 7px 24px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-muted);
  text-decoration: none;
  border-left: 3px solid transparent;
  transition: all 0.15s;
  line-height: 1.3;
}}
.nav-item:hover {{
  color: var(--text);
  background: rgba(255,255,255,0.04);
}}
.nav-item.active {{
  color: var(--text);
  font-weight: 500;
}}
.nav-group[data-color="amber"] .nav-item.active {{ border-left-color: var(--amber); background: var(--amber-dim); }}
.nav-group[data-color="purple"] .nav-item.active {{ border-left-color: var(--purple); background: var(--purple-dim); }}
.nav-group[data-color="teal"] .nav-item.active {{ border-left-color: var(--teal); background: var(--teal-dim); }}
.nav-group[data-color="blue"] .nav-item.active {{ border-left-color: var(--blue); background: var(--blue-dim); }}
.nav-group[data-color="coral"] .nav-item.active {{ border-left-color: var(--coral); background: var(--coral-dim); }}

/* ===== MOBILE NAV ===== */
.mobile-nav {{
  display: none;
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 52px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  z-index: 200;
}}
.mobile-nav-brand {{
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--amber);
}}
.mobile-nav-toggle {{
  background: none;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
}}

/* ===== MAIN CONTENT ===== */
main {{
  margin-left: var(--sidebar-width);
  min-height: 100vh;
}}

/* ===== HERO ===== */
.hero {{
  background: #0f2a1c;
  border-bottom: 1px solid rgba(245,158,11,0.2);
  padding: 72px 64px 60px;
  position: relative;
  overflow: hidden;
}}
.hero::before {{
  content: '';
  position: absolute;
  top: -40%;
  right: -10%;
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%);
  pointer-events: none;
}}
.hero-eyebrow {{
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--amber);
  margin-bottom: 14px;
}}
.hero h1 {{
  font-size: 42px;
  font-weight: 700;
  line-height: 1.15;
  color: #f0faf4;
  margin-bottom: 16px;
  letter-spacing: -0.02em;
}}
.hero p {{
  font-size: 16px;
  color: rgba(240,250,244,0.65);
  max-width: 500px;
  margin-bottom: 28px;
  font-weight: 300;
}}
.hero-link {{
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: var(--amber);
  color: #0f1117;
  font-weight: 600;
  font-size: 13px;
  border-radius: var(--radius-sm);
  text-decoration: none;
  transition: opacity 0.15s;
}}
.hero-link:hover {{ opacity: 0.88; }}

/* ===== METRIC SECTIONS ===== */
.metric-section {{
  padding: 52px 64px 56px;
  border-bottom: 1px solid var(--border);
  border-left: 4px solid transparent;
}}
.color-amber {{ border-left-color: var(--amber); }}
.color-purple {{ border-left-color: var(--purple); }}
.color-teal {{ border-left-color: var(--teal); }}
.color-blue {{ border-left-color: var(--blue); }}
.color-coral {{ border-left-color: var(--coral); }}

.metric-header {{
  display: flex;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 36px;
}}
.metric-number {{
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  min-width: 48px;
}}
.color-amber-text {{ color: var(--amber); }}
.color-purple-text {{ color: var(--purple); }}
.color-teal-text {{ color: var(--teal); }}
.color-blue-text {{ color: var(--blue); }}
.color-coral-text {{ color: var(--coral); }}

.metric-info h2 {{
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: 8px;
  line-height: 1.2;
}}
.source-badge {{
  display: inline-block;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
}}
.badge-amber {{ background: var(--amber-dim); color: var(--amber); }}
.badge-purple {{ background: var(--purple-dim); color: var(--purple); }}
.badge-teal {{ background: var(--teal-dim); color: var(--teal); }}
.badge-blue {{ background: var(--blue-dim); color: var(--blue); }}
.badge-coral {{ background: var(--coral-dim); color: var(--coral); }}

/* ===== SECTION BLOCKS ===== */
.section-block {{ margin-bottom: 36px; }}
.section-label {{
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-bottom: 14px;
}}

/* ===== INSIGHTS GRID ===== */
.insights-grid {{
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}}
.insight-card {{
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
}}
.insight-card h3 {{
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text);
}}
.insight-card p {{
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.65;
}}

/* ===== COMBINATIONS ===== */
.combo-list {{
  display: flex;
  flex-direction: column;
  gap: 10px;
}}
.combo-item {{
  display: flex;
  align-items: baseline;
  gap: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  flex-wrap: wrap;
}}
.combo-pair {{
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  min-width: 160px;
}}
.combo-text {{
  font-size: 13px;
  color: var(--text-muted);
  flex: 1;
  line-height: 1.55;
}}

/* ===== WARNINGS ===== */
.warnings-list {{
  display: flex;
  flex-direction: column;
  gap: 10px;
}}
.warning-card {{
  background: rgba(239,68,68,0.06);
  border: 1px solid rgba(239,68,68,0.25);
  border-left: 3px solid var(--warning-red);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.55;
}}

/* ===== SQL BLOCK ===== */
.sql-block {{
  background: var(--sql-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: auto;
}}
.sql-code {{
  font-family: 'Courier New', 'Courier', ui-monospace, monospace;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--sql-text);
  padding: 20px 24px;
  white-space: pre;
  tab-size: 4;
}}
.sql-code .kw {{ color: #7dd3fc; font-weight: 600; }}
.sql-code .fn {{ color: #a78bfa; }}
.sql-code .str {{ color: #86efac; }}
.sql-code .cm {{ color: #4a5568; font-style: italic; }}

/* ===== DECISION CARDS ===== */
.decision-grid {{
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}}
.decision-card {{
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
  display: grid;
  grid-template-columns: 28px 1fr 20px 1fr;
  gap: 10px;
  align-items: start;
}}
.decision-number {{
  font-size: 11px;
  font-weight: 700;
  color: var(--text-dim);
  background: var(--bg);
  width: 24px; height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  flex-shrink: 0;
}}
.decision-condition {{
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.45;
}}
.decision-arrow {{
  color: var(--text-dim);
  font-size: 16px;
  text-align: center;
  padding-top: 1px;
}}
.decision-action {{
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.55;
}}

/* ===== RESPONSIVE ===== */
@media (max-width: 768px) {{
  .sidebar {{
    transform: translateX(-100%);
    transition: transform 0.25s ease;
  }}
  .sidebar.open {{
    transform: translateX(0);
  }}
  .mobile-nav {{ display: flex; }}
  main {{
    margin-left: 0;
    padding-top: 52px;
  }}
  .hero {{
    padding: 40px 24px 36px;
  }}
  .hero h1 {{ font-size: 28px; }}
  .metric-section {{ padding: 36px 24px 40px; }}
  .insights-grid {{ grid-template-columns: 1fr; }}
  .decision-grid {{ grid-template-columns: 1fr; }}
  .decision-card {{
    grid-template-columns: 28px 1fr;
    grid-template-rows: auto auto;
  }}
  .decision-arrow {{ display: none; }}
  .decision-action {{
    grid-column: 2;
  }}
}}
@media (max-width: 1200px) {{
  .metric-section {{ padding: 48px 40px 52px; }}
}}
</style>
</head>
<body>

<!-- Mobile nav -->
<nav class="mobile-nav">
  <span class="mobile-nav-brand">KNICKGASM DTC</span>
  <button class="mobile-nav-toggle" onclick="toggleSidebar()">&#9776; Menu</button>
</nav>

{sidebar_html}

<main>
  <section class="hero">
    <div class="hero-content">
      <p class="hero-eyebrow">Metric Intelligence Guide</p>
      <h1>Every number tells a story.</h1>
      <p>Start with what the data says. Then decide what to do about it.</p>
      <a href="strategy_first_draft.html" class="hero-link">View Strategy Dashboard &#8594;</a>
    </div>
  </section>

{metrics_html}
</main>

<script>
// ===== Sidebar group toggle =====
function toggleGroup(el) {{
  el.closest('.nav-group').classList.toggle('collapsed');
}}

// ===== Mobile sidebar toggle =====
function toggleSidebar() {{
  document.getElementById('sidebar').classList.toggle('open');
}}

// ===== Active nav on scroll =====
(function() {{
  var items = document.querySelectorAll('.nav-item[data-id]');
  var sections = [];
  items.forEach(function(item) {{
    var sec = document.getElementById(item.dataset.id);
    if (sec) sections.push({{ el: sec, nav: item }});
  }});

  var current = null;
  function onScroll() {{
    var scrollY = window.scrollY + 120;
    var active = null;
    for (var i = sections.length - 1; i >= 0; i--) {{
      if (sections[i].el.offsetTop <= scrollY) {{
        active = sections[i];
        break;
      }}
    }}
    if (active !== current) {{
      if (current) current.nav.classList.remove('active');
      if (active) {{
        active.nav.classList.add('active');
        // auto-scroll nav item into view
        active.nav.scrollIntoView({{ block: 'nearest', behavior: 'smooth' }});
      }}
      current = active;
    }}
  }}

  window.addEventListener('scroll', onScroll, {{ passive: true }});
  onScroll();
}})();
</script>
</body>
</html>"""

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    html = build_html()
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Written: {OUTPUT_PATH}")
    print(f"Size: {len(html):,} bytes")
