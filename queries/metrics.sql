-- ============================================================
-- KNICKGASM DTC - Core Analytics Metrics
-- DuckDB SQL  |  knickgasm_dtc.duckdb
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- METRIC 1: NET REVENUE BY MARKET
-- ─────────────────────────────────────────────────────────────
-- Split by shipping_country_code: US, GB (UK), IN, RoW
SELECT
    CASE
        WHEN shipping_country_code = 'US' THEN 'US'
        WHEN shipping_country_code = 'GB' THEN 'UK'
        WHEN shipping_country_code = 'IN' THEN 'IN'
        ELSE 'RoW'
    END AS market,
    COUNT(*)                                               AS total_orders,
    ROUND(SUM(subtotal_price), 2)                         AS gross_sales,
    ROUND(SUM(COALESCE(total_discounts, 0)), 2)           AS discounts,
    ROUND(SUM(subtotal_price - COALESCE(total_discounts, 0)), 2) AS net_sales,
    ROUND(AVG(total_price), 2)                            AS aov
FROM matrixify.orders
WHERE financial_status NOT IN ('refunded', 'voided')
  AND cancelled_at IS NULL
GROUP BY 1
ORDER BY net_sales DESC;


-- ─────────────────────────────────────────────────────────────
-- METRIC 2: NEW VS RETURNING CUSTOMER REVENUE SPLIT (monthly)
-- ─────────────────────────────────────────────────────────────
WITH monthly AS (
    SELECT
        DATE_TRUNC('month', processed_at)               AS month,
        CASE WHEN customer_orders_count = 1 THEN 'new' ELSE 'returning' END AS segment,
        COUNT(*)                                         AS order_count,
        SUM(total_price)                                 AS revenue
    FROM matrixify.orders
    WHERE financial_status NOT IN ('refunded', 'voided')
      AND cancelled_at IS NULL
    GROUP BY 1, 2
),
totals AS (
    SELECT month, SUM(revenue) AS month_total FROM monthly GROUP BY month
)
SELECT
    m.month,
    m.segment,
    ROUND(m.revenue, 2)                                   AS revenue,
    m.order_count,
    ROUND(m.revenue / t.month_total * 100, 1)            AS pct_of_total
FROM monthly m
JOIN totals t USING (month)
ORDER BY m.month DESC, m.segment;


-- ─────────────────────────────────────────────────────────────
-- METRIC 3: LTV:CAC RATIO BY CHANNEL
-- ─────────────────────────────────────────────────────────────
-- LTV = avg total revenue per customer | CAC = spend / new customers
WITH customer_ltv AS (
    SELECT
        COALESCE(utm_source, 'organic') AS channel,
        customer_id,
        SUM(total_price)                AS lifetime_revenue
    FROM matrixify.orders
    WHERE financial_status NOT IN ('refunded','voided')
      AND cancelled_at IS NULL
    GROUP BY 1, 2
),
ltv_by_channel AS (
    SELECT channel, ROUND(AVG(lifetime_revenue), 2) AS avg_ltv
    FROM customer_ltv
    GROUP BY channel
),
cac_source AS (
    SELECT
        channel,
        SUM(spend)         AS total_spend,
        SUM(new_customers) AS total_new_customers
    FROM shopify_analytics.marketing_attribution
    GROUP BY channel
)
SELECT
    l.channel,
    l.avg_ltv                                             AS ltv,
    ROUND(c.total_spend / NULLIF(c.total_new_customers, 0), 2) AS cac,
    ROUND(l.avg_ltv / NULLIF(c.total_spend / NULLIF(c.total_new_customers, 0), 0), 2) AS ltv_cac_ratio,
    CASE WHEN l.avg_ltv / NULLIF(c.total_spend / NULLIF(c.total_new_customers, 0), 0) < 3
         THEN 'BELOW 3:1 - REVIEW' ELSE 'OK' END         AS flag
FROM ltv_by_channel l
LEFT JOIN cac_source c USING (channel)
ORDER BY ltv_cac_ratio DESC NULLS LAST;


-- ─────────────────────────────────────────────────────────────
-- METRIC 4: REPEAT PURCHASE RATE (90-day cohort)
-- ─────────────────────────────────────────────────────────────
WITH first_orders AS (
    SELECT
        customer_id,
        MIN(processed_at)                                 AS first_order_date,
        DATE_TRUNC('month', MIN(processed_at))            AS cohort_month
    FROM matrixify.orders
    WHERE financial_status NOT IN ('refunded','voided')
      AND cancelled_at IS NULL
    GROUP BY customer_id
),
second_orders AS (
    SELECT DISTINCT o.customer_id
    FROM matrixify.orders o
    JOIN first_orders f ON o.customer_id = f.customer_id
    WHERE o.processed_at > f.first_order_date
      AND o.processed_at <= f.first_order_date + INTERVAL '90 days'
      AND o.financial_status NOT IN ('refunded','voided')
      AND o.cancelled_at IS NULL
)
SELECT
    f.cohort_month,
    COUNT(DISTINCT f.customer_id)                        AS first_time_buyers,
    COUNT(DISTINCT s.customer_id)                        AS repeat_within_90d,
    ROUND(COUNT(DISTINCT s.customer_id) * 100.0 / COUNT(DISTINCT f.customer_id), 1) AS repeat_rate_pct
FROM first_orders f
LEFT JOIN second_orders s USING (customer_id)
GROUP BY f.cohort_month
ORDER BY f.cohort_month DESC;


-- ─────────────────────────────────────────────────────────────
-- METRIC 5: GROSS MARGIN %
-- ─────────────────────────────────────────────────────────────
-- By month, by product_type, overall
SELECT
    DATE_TRUNC('month', o.processed_at)                  AS month,
    li.product_type,
    ROUND(SUM(li.price * li.quantity), 2)                AS gross_revenue,
    ROUND(SUM(COALESCE(li.variant_cost, 0) * li.quantity), 2) AS cogs,
    ROUND(
        (SUM(li.price * li.quantity) - SUM(COALESCE(li.variant_cost, 0) * li.quantity))
        / NULLIF(SUM(li.price * li.quantity), 0) * 100, 1
    )                                                     AS gross_margin_pct
FROM matrixify.order_line_items li
JOIN matrixify.orders o ON li.order_id = o.id
WHERE o.financial_status NOT IN ('refunded','voided')
  AND o.cancelled_at IS NULL
GROUP BY GROUPING SETS (
    (DATE_TRUNC('month', o.processed_at), li.product_type),
    (DATE_TRUNC('month', o.processed_at)),
    ()
)
ORDER BY month DESC NULLS LAST, product_type NULLS LAST;


-- ─────────────────────────────────────────────────────────────
-- METRIC 6: CAC BY CHANNEL (monthly)
-- ─────────────────────────────────────────────────────────────
SELECT
    a.report_date,
    a.channel,
    a.new_visitors                                        AS new_customers,
    a.sessions,
    ROUND(a.conversion_rate * 100, 2)                    AS conversion_rate_pct,
    ROUND(a.revenue / NULLIF(a.new_visitors, 0), 2)     AS revenue_per_new_customer
FROM shopify_analytics.acquisition_metrics a
ORDER BY a.report_date DESC, a.channel;


-- ─────────────────────────────────────────────────────────────
-- METRIC 7: EMAIL REVENUE % (Klaviyo attribution)
-- ─────────────────────────────────────────────────────────────
WITH klaviyo_monthly AS (
    SELECT
        DATE_TRUNC('month', sent_at)                     AS month,
        SUM(revenue_attributed)                          AS email_revenue,
        'campaign'                                       AS send_type
    FROM klaviyo.campaigns
    WHERE sent_at IS NOT NULL
    GROUP BY 1
),
shopify_monthly AS (
    SELECT
        DATE_TRUNC('month', report_date::TIMESTAMP)      AS month,
        SUM(net_sales)                                   AS total_net_sales
    FROM shopify_analytics.revenue_metrics
    GROUP BY 1
)
SELECT
    k.month,
    k.send_type,
    ROUND(k.email_revenue, 2)                            AS email_revenue,
    ROUND(s.total_net_sales, 2)                         AS total_net_sales,
    ROUND(k.email_revenue / NULLIF(s.total_net_sales, 0) * 100, 1) AS email_revenue_pct
FROM klaviyo_monthly k
LEFT JOIN shopify_monthly s USING (month)
ORDER BY k.month DESC;

-- Campaign-level breakdown
SELECT
    campaign_id,
    name,
    channel,
    sent_at,
    ROUND(revenue_attributed, 2)                         AS revenue_attributed,
    ROUND(conversion_rate * 100, 2)                     AS conversion_rate_pct,
    recipients,
    opens,
    clicks
FROM klaviyo.campaigns
WHERE sent_at IS NOT NULL
ORDER BY revenue_attributed DESC NULLS LAST;


-- ─────────────────────────────────────────────────────────────
-- METRIC 8: AOV TREND (monthly)
-- ─────────────────────────────────────────────────────────────
WITH monthly_aov AS (
    SELECT
        DATE_TRUNC('month', processed_at)               AS month,
        COUNT(*)                                         AS total_orders,
        ROUND(SUM(total_price), 2)                       AS total_revenue,
        ROUND(AVG(total_price), 2)                       AS aov
    FROM matrixify.orders
    WHERE financial_status NOT IN ('refunded','voided')
      AND cancelled_at IS NULL
    GROUP BY 1
)
SELECT
    month,
    total_orders,
    total_revenue,
    aov,
    ROUND(
        (aov - LAG(aov) OVER (ORDER BY month)) / NULLIF(LAG(aov) OVER (ORDER BY month), 0) * 100,
        1
    )                                                    AS mom_change_pct,
    CASE WHEN
        (aov - LAG(aov) OVER (ORDER BY month)) / NULLIF(LAG(aov) OVER (ORDER BY month), 0) * 100 < -5
        THEN 'FLAG: >5% AOV DROP' ELSE '' END            AS alert
FROM monthly_aov
ORDER BY month DESC;


-- ─────────────────────────────────────────────────────────────
-- METRIC 9: CHECKOUT CONVERSION RATE (weekly funnel)
-- ─────────────────────────────────────────────────────────────
WITH funnel AS (
    SELECT
        DATE_TRUNC('week', summary_date)                 AS week,
        event_name,
        SUM(event_count)                                 AS event_count
    FROM webengage.event_summary
    WHERE event_name IN ('Product Viewed','Added To Cart','Checkout created','Order created')
    GROUP BY 1, 2
),
pivoted AS (
    SELECT
        week,
        MAX(CASE WHEN event_name = 'Product Viewed'    THEN event_count END) AS product_viewed,
        MAX(CASE WHEN event_name = 'Added To Cart'     THEN event_count END) AS added_to_cart,
        MAX(CASE WHEN event_name = 'Checkout created'  THEN event_count END) AS checkout_created,
        MAX(CASE WHEN event_name = 'Order created'     THEN event_count END) AS order_created
    FROM funnel
    GROUP BY week
)
SELECT
    week,
    product_viewed,
    added_to_cart,
    checkout_created,
    order_created,
    ROUND(added_to_cart    * 100.0 / NULLIF(product_viewed, 0), 1)   AS atc_rate_pct,
    ROUND(checkout_created * 100.0 / NULLIF(added_to_cart, 0), 1)    AS checkout_rate_pct,
    ROUND(order_created    * 100.0 / NULLIF(checkout_created, 0), 1) AS checkout_to_order_pct,
    ROUND(order_created    * 100.0 / NULLIF(product_viewed, 0), 1)   AS overall_conversion_pct
FROM pivoted
ORDER BY week DESC;


-- ─────────────────────────────────────────────────────────────
-- METRIC 10: SUBSCRIPTION MIX % (monthly)
-- ─────────────────────────────────────────────────────────────
-- Subscription orders identified via line_item properties containing 'subscription' or 'frequency'
WITH order_type AS (
    SELECT
        o.id AS order_id,
        DATE_TRUNC('month', o.processed_at)              AS month,
        o.total_price,
        MAX(CASE
            WHEN LOWER(CAST(li.properties AS VARCHAR)) LIKE '%subscription%'
              OR LOWER(CAST(li.properties AS VARCHAR)) LIKE '%frequency%'
            THEN 1 ELSE 0
        END)                                             AS is_subscription
    FROM matrixify.orders o
    JOIN matrixify.order_line_items li ON li.order_id = o.id
    WHERE o.financial_status NOT IN ('refunded','voided')
      AND o.cancelled_at IS NULL
    GROUP BY o.id, o.processed_at, o.total_price
)
SELECT
    month,
    ROUND(SUM(CASE WHEN is_subscription = 1 THEN total_price ELSE 0 END), 2) AS subscription_revenue,
    ROUND(SUM(CASE WHEN is_subscription = 0 THEN total_price ELSE 0 END), 2) AS onetime_revenue,
    ROUND(SUM(total_price), 2)                                                AS total_revenue,
    ROUND(
        SUM(CASE WHEN is_subscription = 1 THEN total_price ELSE 0 END)
        / NULLIF(SUM(total_price), 0) * 100, 1
    )                                                    AS subscription_pct
FROM order_type
GROUP BY month
ORDER BY month DESC;


-- ─────────────────────────────────────────────────────────────
-- METRIC 11: COHORT RETENTION (30/60/90-day)
-- ─────────────────────────────────────────────────────────────
WITH first_orders AS (
    SELECT
        customer_id,
        MIN(processed_at)                                AS first_order_date,
        DATE_TRUNC('month', MIN(processed_at))           AS cohort_month
    FROM matrixify.orders
    WHERE financial_status NOT IN ('refunded','voided')
      AND cancelled_at IS NULL
    GROUP BY customer_id
)
SELECT
    f.cohort_month,
    COUNT(DISTINCT f.customer_id)                        AS cohort_size,
    COUNT(DISTINCT CASE
        WHEN o30.customer_id IS NOT NULL THEN f.customer_id END) AS retained_30d,
    COUNT(DISTINCT CASE
        WHEN o60.customer_id IS NOT NULL THEN f.customer_id END) AS retained_60d,
    COUNT(DISTINCT CASE
        WHEN o90.customer_id IS NOT NULL THEN f.customer_id END) AS retained_90d,
    ROUND(COUNT(DISTINCT CASE WHEN o30.customer_id IS NOT NULL THEN f.customer_id END)
          * 100.0 / NULLIF(COUNT(DISTINCT f.customer_id), 0), 1) AS retention_30d_pct,
    ROUND(COUNT(DISTINCT CASE WHEN o60.customer_id IS NOT NULL THEN f.customer_id END)
          * 100.0 / NULLIF(COUNT(DISTINCT f.customer_id), 0), 1) AS retention_60d_pct,
    ROUND(COUNT(DISTINCT CASE WHEN o90.customer_id IS NOT NULL THEN f.customer_id END)
          * 100.0 / NULLIF(COUNT(DISTINCT f.customer_id), 0), 1) AS retention_90d_pct
FROM first_orders f
LEFT JOIN matrixify.orders o30
    ON o30.customer_id = f.customer_id
   AND o30.processed_at > f.first_order_date
   AND o30.processed_at <= f.first_order_date + INTERVAL '30 days'
   AND o30.financial_status NOT IN ('refunded','voided')
   AND o30.cancelled_at IS NULL
LEFT JOIN matrixify.orders o60
    ON o60.customer_id = f.customer_id
   AND o60.processed_at > f.first_order_date
   AND o60.processed_at <= f.first_order_date + INTERVAL '60 days'
   AND o60.financial_status NOT IN ('refunded','voided')
   AND o60.cancelled_at IS NULL
LEFT JOIN matrixify.orders o90
    ON o90.customer_id = f.customer_id
   AND o90.processed_at > f.first_order_date
   AND o90.processed_at <= f.first_order_date + INTERVAL '90 days'
   AND o90.financial_status NOT IN ('refunded','voided')
   AND o90.cancelled_at IS NULL
GROUP BY f.cohort_month
ORDER BY f.cohort_month DESC;


-- ─────────────────────────────────────────────────────────────
-- METRIC 12: TIME TO 2ND PURCHASE
-- ─────────────────────────────────────────────────────────────
WITH ranked_orders AS (
    SELECT
        customer_id,
        processed_at,
        COALESCE(utm_source, 'organic')                  AS acq_channel,
        shipping_country_code,
        DATE_TRUNC('month', MIN(processed_at) OVER (PARTITION BY customer_id)) AS cohort_month,
        ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY processed_at)     AS order_rank
    FROM matrixify.orders
    WHERE financial_status NOT IN ('refunded','voided')
      AND cancelled_at IS NULL
),
first_second AS (
    SELECT
        r1.customer_id,
        r1.acq_channel,
        r1.shipping_country_code,
        r1.cohort_month,
        DATEDIFF('day', r1.processed_at, r2.processed_at) AS days_to_2nd
    FROM ranked_orders r1
    JOIN ranked_orders r2 ON r1.customer_id = r2.customer_id
    WHERE r1.order_rank = 1 AND r2.order_rank = 2
)
SELECT
    'Overall'                                            AS dimension,
    'all'                                                AS value,
    COUNT(*)                                             AS customers_with_2nd,
    ROUND(AVG(days_to_2nd), 1)                          AS avg_days,
    ROUND(MEDIAN(days_to_2nd), 1)                       AS median_days
FROM first_second
UNION ALL
SELECT 'Market', shipping_country_code, COUNT(*), ROUND(AVG(days_to_2nd),1), ROUND(MEDIAN(days_to_2nd),1)
FROM first_second GROUP BY shipping_country_code
UNION ALL
SELECT 'Channel', acq_channel, COUNT(*), ROUND(AVG(days_to_2nd),1), ROUND(MEDIAN(days_to_2nd),1)
FROM first_second GROUP BY acq_channel
ORDER BY dimension, value;

-- Trend by cohort month
SELECT
    cohort_month,
    COUNT(*)                                             AS customers_with_2nd,
    ROUND(AVG(days_to_2nd), 1)                          AS avg_days_to_2nd,
    ROUND(MEDIAN(days_to_2nd), 1)                       AS median_days_to_2nd
FROM (
    SELECT
        DATE_TRUNC('month', r1.processed_at)             AS cohort_month,
        DATEDIFF('day', r1.processed_at, r2.processed_at) AS days_to_2nd
    FROM (SELECT customer_id, processed_at, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY processed_at) AS rn FROM matrixify.orders WHERE financial_status NOT IN ('refunded','voided') AND cancelled_at IS NULL) r1
    JOIN (SELECT customer_id, processed_at, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY processed_at) AS rn FROM matrixify.orders WHERE financial_status NOT IN ('refunded','voided') AND cancelled_at IS NULL) r2
      ON r1.customer_id = r2.customer_id AND r1.rn = 1 AND r2.rn = 2
) t
GROUP BY cohort_month
ORDER BY cohort_month DESC;


-- ─────────────────────────────────────────────────────────────
-- METRIC 13: CHURN RISK DISTRIBUTION
-- ─────────────────────────────────────────────────────────────
SELECT
    COALESCE(churn_risk, 'unknown')                      AS churn_risk_bucket,
    COUNT(*)                                             AS profile_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct_of_total,
    ROUND(AVG(COALESCE(predicted_clv_1y, 0)), 2)       AS avg_predicted_clv_1y,
    ROUND(SUM(COALESCE(predicted_clv_1y, 0)), 2)       AS total_predicted_clv_1y
FROM klaviyo.profiles
GROUP BY 1
ORDER BY
    CASE churn_risk_bucket
        WHEN 'low'     THEN 1
        WHEN 'medium'  THEN 2
        WHEN 'high'    THEN 3
        WHEN 'winback' THEN 4
        ELSE 5
    END;

-- At-risk summary
SELECT
    COUNT(*) FILTER (WHERE churn_risk IN ('high','winback'))        AS at_risk_count,
    ROUND(COUNT(*) FILTER (WHERE churn_risk IN ('high','winback'))
          * 100.0 / COUNT(*), 1)                                    AS at_risk_pct,
    ROUND(SUM(predicted_clv_1y) FILTER (WHERE churn_risk IN ('high','winback')), 2) AS at_risk_revenue
FROM klaviyo.profiles;


-- ─────────────────────────────────────────────────────────────
-- METRIC 14: AT-RISK REVENUE
-- ─────────────────────────────────────────────────────────────
-- Total at-risk revenue
SELECT
    ROUND(SUM(predicted_clv_1y), 2)                     AS total_at_risk_revenue,
    COUNT(*)                                             AS at_risk_profiles
FROM klaviyo.profiles
WHERE churn_risk IN ('high','winback');

-- By market (country)
SELECT
    COALESCE(country, 'Unknown')                        AS market,
    COUNT(*)                                             AS at_risk_profiles,
    ROUND(SUM(COALESCE(predicted_clv_1y, 0)), 2)       AS at_risk_revenue
FROM klaviyo.profiles
WHERE churn_risk IN ('high','winback')
GROUP BY 1
ORDER BY at_risk_revenue DESC;

-- Top 100 at-risk customers by predicted CLV
SELECT
    profile_id,
    email,
    first_name,
    last_name,
    country,
    churn_risk,
    ROUND(predicted_clv_1y, 2)                          AS predicted_clv_1y,
    ROUND(historic_clv, 2)                              AS historic_clv,
    historic_number_of_orders,
    expected_date_of_next_order
FROM klaviyo.profiles
WHERE churn_risk IN ('high','winback')
ORDER BY predicted_clv_1y DESC NULLS LAST
LIMIT 100;


-- ─────────────────────────────────────────────────────────────
-- METRIC 15: PRODUCT REPEAT RATE
-- ─────────────────────────────────────────────────────────────
-- For each product, % of first-time buyers who repurchased ANY product within 90 days
WITH product_first_purchase AS (
    SELECT
        li.product_id,
        li.title                                         AS product_title,
        li.sku                                           AS variant_sku,
        o.customer_id,
        o.processed_at                                   AS purchase_date,
        ROW_NUMBER() OVER (PARTITION BY o.customer_id, li.product_id ORDER BY o.processed_at) AS purchase_rank
    FROM matrixify.order_line_items li
    JOIN matrixify.orders o ON li.order_id = o.id
    WHERE o.financial_status NOT IN ('refunded','voided')
      AND o.cancelled_at IS NULL
),
first_buyers AS (
    SELECT product_id, product_title, variant_sku, customer_id, purchase_date
    FROM product_first_purchase
    WHERE purchase_rank = 1
),
repeat_buyers AS (
    SELECT DISTINCT fb.product_id, fb.customer_id
    FROM first_buyers fb
    JOIN matrixify.orders o2
      ON o2.customer_id = fb.customer_id
     AND o2.processed_at > fb.purchase_date
     AND o2.processed_at <= fb.purchase_date + INTERVAL '90 days'
     AND o2.financial_status NOT IN ('refunded','voided')
     AND o2.cancelled_at IS NULL
)
SELECT
    fb.product_id,
    fb.product_title,
    fb.variant_sku,
    COUNT(DISTINCT fb.customer_id)                       AS first_time_buyers,
    COUNT(DISTINCT rb.customer_id)                       AS repeat_buyers,
    ROUND(COUNT(DISTINCT rb.customer_id) * 100.0
          / NULLIF(COUNT(DISTINCT fb.customer_id), 0), 1) AS repeat_rate_pct
FROM first_buyers fb
LEFT JOIN repeat_buyers rb USING (product_id, customer_id)
GROUP BY fb.product_id, fb.product_title, fb.variant_sku
ORDER BY repeat_rate_pct DESC NULLS LAST;


-- ─────────────────────────────────────────────────────────────
-- BONUS: LTV BY MARKET
-- ─────────────────────────────────────────────────────────────
WITH customer_revenue AS (
    SELECT
        customer_id,
        CASE
            WHEN shipping_country_code = 'US' THEN 'US'
            WHEN shipping_country_code = 'GB' THEN 'UK'
            WHEN shipping_country_code = 'IN' THEN 'IN'
            ELSE 'RoW'
        END                                              AS market,
        SUM(total_price)                                 AS lifetime_revenue,
        COUNT(*)                                         AS order_count,
        AVG(total_price)                                 AS avg_order_value
    FROM matrixify.orders
    WHERE financial_status NOT IN ('refunded','voided')
      AND cancelled_at IS NULL
    GROUP BY 1, 2
)
SELECT
    market,
    COUNT(DISTINCT customer_id)                         AS customer_count,
    ROUND(AVG(lifetime_revenue), 2)                    AS avg_ltv,
    ROUND(MEDIAN(lifetime_revenue), 2)                 AS median_ltv,
    ROUND(AVG(order_count), 2)                         AS avg_orders,
    ROUND(AVG(avg_order_value), 2)                     AS avg_aov
FROM customer_revenue
GROUP BY market
ORDER BY avg_ltv DESC;
