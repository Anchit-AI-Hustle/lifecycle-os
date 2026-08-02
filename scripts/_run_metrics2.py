import duckdb, sys

con = duckdb.connect(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\knickgasm_dtc.duckdb")

QUERIES = {
    "M1 Net Revenue by Market": """
        SELECT CASE WHEN shipping_country_code='US' THEN 'US' WHEN shipping_country_code='GB' THEN 'UK'
                    WHEN shipping_country_code='IN' THEN 'IN' ELSE 'RoW' END AS market,
               COUNT(*) AS total_orders,
               ROUND(SUM(subtotal_price),2) AS gross_sales,
               ROUND(SUM(COALESCE(total_discounts,0)),2) AS discounts,
               ROUND(SUM(subtotal_price - COALESCE(total_discounts,0)),2) AS net_sales,
               ROUND(AVG(total_price),2) AS aov
        FROM matrixify.orders
        WHERE financial_status NOT IN ('refunded','voided') AND cancelled_at IS NULL
        GROUP BY 1 ORDER BY net_sales DESC
    """,
    "M2 New vs Returning Revenue (last 3 months)": """
        WITH monthly AS (
            SELECT DATE_TRUNC('month',processed_at) AS month,
                   CASE WHEN customer_orders_count=1 THEN 'new' ELSE 'returning' END AS segment,
                   COUNT(*) AS order_count, SUM(total_price) AS revenue
            FROM matrixify.orders
            WHERE financial_status NOT IN ('refunded','voided') AND cancelled_at IS NULL
            GROUP BY 1,2
        ), totals AS (SELECT month, SUM(revenue) AS mt FROM monthly GROUP BY month)
        SELECT m.month, m.segment, ROUND(m.revenue,2) AS revenue,
               m.order_count, ROUND(m.revenue/t.mt*100,1) AS pct_of_total
        FROM monthly m JOIN totals t USING(month)
        ORDER BY m.month DESC, m.segment LIMIT 10
    """,
    "M3 LTV:CAC Ratio by Channel": """
        WITH cltv AS (
            SELECT COALESCE(utm_source,'organic') AS channel, customer_id, SUM(total_price) AS ltv
            FROM matrixify.orders WHERE financial_status NOT IN ('refunded','voided') AND cancelled_at IS NULL
            GROUP BY 1,2
        ), ltv AS (SELECT channel, ROUND(AVG(ltv),2) AS avg_ltv FROM cltv GROUP BY channel),
        cac_s AS (SELECT channel, SUM(spend) AS spend, SUM(new_customers) AS nc
                  FROM shopify_analytics.marketing_attribution GROUP BY channel)
        SELECT l.channel, l.avg_ltv AS ltv,
               ROUND(c.spend/NULLIF(c.nc,0),2) AS cac,
               ROUND(l.avg_ltv/NULLIF(c.spend/NULLIF(c.nc,0),0),2) AS ltv_cac_ratio,
               CASE WHEN l.avg_ltv/NULLIF(c.spend/NULLIF(c.nc,0),0)<3 THEN 'REVIEW' ELSE 'OK' END AS flag
        FROM ltv l LEFT JOIN cac_s c USING(channel) ORDER BY ltv_cac_ratio DESC NULLS LAST
    """,
    "M4 Repeat Purchase Rate 90-day (top 6 cohorts)": """
        WITH fo AS (SELECT customer_id, MIN(processed_at) AS fd, DATE_TRUNC('month',MIN(processed_at)) AS cm
                    FROM matrixify.orders WHERE financial_status NOT IN ('refunded','voided') AND cancelled_at IS NULL
                    GROUP BY customer_id),
             so AS (SELECT DISTINCT o.customer_id FROM matrixify.orders o JOIN fo f ON o.customer_id=f.customer_id
                    WHERE o.processed_at>f.fd AND o.processed_at<=f.fd+INTERVAL '90 days'
                      AND o.financial_status NOT IN ('refunded','voided') AND o.cancelled_at IS NULL)
        SELECT f.cm AS cohort_month, COUNT(DISTINCT f.customer_id) AS first_time_buyers,
               COUNT(DISTINCT s.customer_id) AS repeat_within_90d,
               ROUND(COUNT(DISTINCT s.customer_id)*100.0/COUNT(DISTINCT f.customer_id),1) AS repeat_rate_pct
        FROM fo f LEFT JOIN so s USING(customer_id)
        GROUP BY f.cm ORDER BY f.cm DESC LIMIT 6
    """,
    "M5 Gross Margin % by Product Type": """
        SELECT li.product_type,
               ROUND(SUM(li.price*li.quantity),2) AS gross_revenue,
               ROUND(SUM(COALESCE(li.variant_cost,0)*li.quantity),2) AS cogs,
               ROUND((SUM(li.price*li.quantity)-SUM(COALESCE(li.variant_cost,0)*li.quantity))
                     /NULLIF(SUM(li.price*li.quantity),0)*100,1) AS gross_margin_pct
        FROM matrixify.order_line_items li
        JOIN matrixify.orders o ON li.order_id=o.id
        WHERE o.financial_status NOT IN ('refunded','voided') AND o.cancelled_at IS NULL
        GROUP BY li.product_type ORDER BY gross_margin_pct DESC
    """,
    "M6 CAC by Channel (top 5)": """
        SELECT channel, SUM(new_visitors) AS new_customers, SUM(sessions) AS sessions,
               ROUND(SUM(orders)*100.0/NULLIF(SUM(sessions),0),2) AS conversion_rate_pct,
               ROUND(SUM(revenue)/NULLIF(SUM(new_visitors),0),2) AS revenue_per_new_customer
        FROM shopify_analytics.acquisition_metrics
        GROUP BY channel ORDER BY revenue_per_new_customer DESC LIMIT 5
    """,
    "M7 Email Revenue % by Month (last 5)": """
        WITH km AS (SELECT DATE_TRUNC('month',sent_at) AS month, SUM(revenue_attributed) AS email_rev
                    FROM klaviyo.campaigns WHERE sent_at IS NOT NULL GROUP BY 1),
             sm AS (SELECT DATE_TRUNC('month',report_date::TIMESTAMP) AS month, SUM(net_sales) AS net
                    FROM shopify_analytics.revenue_metrics GROUP BY 1)
        SELECT k.month, ROUND(k.email_rev,2) AS email_revenue, ROUND(s.net,2) AS total_net_sales,
               ROUND(k.email_rev/NULLIF(s.net,0)*100,1) AS email_pct
        FROM km k LEFT JOIN sm s USING(month) ORDER BY k.month DESC LIMIT 5
    """,
    "M8 AOV Trend (last 6 months)": """
        WITH m AS (SELECT DATE_TRUNC('month',processed_at) AS month, COUNT(*) AS orders,
                          ROUND(SUM(total_price),2) AS revenue, ROUND(AVG(total_price),2) AS aov
                   FROM matrixify.orders
                   WHERE financial_status NOT IN ('refunded','voided') AND cancelled_at IS NULL
                   GROUP BY 1)
        SELECT month, orders, revenue, aov,
               ROUND((aov-LAG(aov) OVER (ORDER BY month))/NULLIF(LAG(aov) OVER (ORDER BY month),0)*100,1) AS mom_chg_pct
        FROM m ORDER BY month DESC LIMIT 6
    """,
    "M9 Checkout Conversion Funnel (last 4 weeks)": """
        WITH f AS (SELECT DATE_TRUNC('week',summary_date) AS week, event_name, SUM(event_count) AS cnt
                   FROM webengage.event_summary
                   WHERE event_name IN ('Product Viewed','Added To Cart','Checkout created','Order created')
                   GROUP BY 1,2),
             p AS (SELECT week,
                          MAX(CASE WHEN event_name='Product Viewed' THEN cnt END) AS pv,
                          MAX(CASE WHEN event_name='Added To Cart' THEN cnt END) AS atc,
                          MAX(CASE WHEN event_name='Checkout created' THEN cnt END) AS chk,
                          MAX(CASE WHEN event_name='Order created' THEN cnt END) AS ord
                   FROM f GROUP BY week)
        SELECT week, pv AS product_viewed, atc AS added_to_cart, chk AS checkout, ord AS ordered,
               ROUND(atc*100.0/NULLIF(pv,0),1) AS atc_pct,
               ROUND(chk*100.0/NULLIF(atc,0),1) AS chk_pct,
               ROUND(ord*100.0/NULLIF(pv,0),1) AS overall_cvr_pct
        FROM p ORDER BY week DESC LIMIT 4
    """,
    "M10 Subscription Mix % (last 6 months)": """
        WITH ot AS (
            SELECT o.id, DATE_TRUNC('month',o.processed_at) AS month, o.total_price,
                   MAX(CASE WHEN LOWER(CAST(li.properties AS VARCHAR)) LIKE '%subscription%'
                               OR LOWER(CAST(li.properties AS VARCHAR)) LIKE '%frequency%' THEN 1 ELSE 0 END) AS is_sub
            FROM matrixify.orders o JOIN matrixify.order_line_items li ON li.order_id=o.id
            WHERE o.financial_status NOT IN ('refunded','voided') AND o.cancelled_at IS NULL
            GROUP BY o.id, o.processed_at, o.total_price
        )
        SELECT month, ROUND(SUM(CASE WHEN is_sub=1 THEN total_price ELSE 0 END),2) AS sub_revenue,
               ROUND(SUM(CASE WHEN is_sub=0 THEN total_price ELSE 0 END),2) AS onetime_revenue,
               ROUND(SUM(CASE WHEN is_sub=1 THEN total_price ELSE 0 END)/NULLIF(SUM(total_price),0)*100,1) AS sub_pct
        FROM ot GROUP BY month ORDER BY month DESC LIMIT 6
    """,
    "M11 Cohort Retention 30/60/90d (last 5 cohorts)": """
        WITH fo AS (SELECT customer_id, MIN(processed_at) AS fd, DATE_TRUNC('month',MIN(processed_at)) AS cm
                    FROM matrixify.orders WHERE financial_status NOT IN ('refunded','voided') AND cancelled_at IS NULL
                    GROUP BY customer_id)
        SELECT f.cm AS cohort_month, COUNT(DISTINCT f.customer_id) AS cohort_size,
               COUNT(DISTINCT CASE WHEN o30.customer_id IS NOT NULL THEN f.customer_id END) AS ret_30d,
               COUNT(DISTINCT CASE WHEN o60.customer_id IS NOT NULL THEN f.customer_id END) AS ret_60d,
               COUNT(DISTINCT CASE WHEN o90.customer_id IS NOT NULL THEN f.customer_id END) AS ret_90d,
               ROUND(COUNT(DISTINCT CASE WHEN o30.customer_id IS NOT NULL THEN f.customer_id END)*100.0/NULLIF(COUNT(DISTINCT f.customer_id),0),1) AS r30_pct,
               ROUND(COUNT(DISTINCT CASE WHEN o60.customer_id IS NOT NULL THEN f.customer_id END)*100.0/NULLIF(COUNT(DISTINCT f.customer_id),0),1) AS r60_pct,
               ROUND(COUNT(DISTINCT CASE WHEN o90.customer_id IS NOT NULL THEN f.customer_id END)*100.0/NULLIF(COUNT(DISTINCT f.customer_id),0),1) AS r90_pct
        FROM fo f
        LEFT JOIN matrixify.orders o30 ON o30.customer_id=f.customer_id AND o30.processed_at>f.fd AND o30.processed_at<=f.fd+INTERVAL '30 days' AND o30.financial_status NOT IN ('refunded','voided') AND o30.cancelled_at IS NULL
        LEFT JOIN matrixify.orders o60 ON o60.customer_id=f.customer_id AND o60.processed_at>f.fd AND o60.processed_at<=f.fd+INTERVAL '60 days' AND o60.financial_status NOT IN ('refunded','voided') AND o60.cancelled_at IS NULL
        LEFT JOIN matrixify.orders o90 ON o90.customer_id=f.customer_id AND o90.processed_at>f.fd AND o90.processed_at<=f.fd+INTERVAL '90 days' AND o90.financial_status NOT IN ('refunded','voided') AND o90.cancelled_at IS NULL
        GROUP BY f.cm ORDER BY f.cm DESC LIMIT 5
    """,
    "M12 Time to 2nd Purchase by Market": """
        WITH rn AS (SELECT customer_id, processed_at, shipping_country_code,
                           ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY processed_at) AS rk
                    FROM matrixify.orders WHERE financial_status NOT IN ('refunded','voided') AND cancelled_at IS NULL),
             fs AS (SELECT r1.shipping_country_code,
                           DATEDIFF('day',r1.processed_at,r2.processed_at) AS d2nd
                    FROM rn r1 JOIN rn r2 ON r1.customer_id=r2.customer_id AND r1.rk=1 AND r2.rk=2)
        SELECT CASE WHEN shipping_country_code='US' THEN 'US' WHEN shipping_country_code='GB' THEN 'UK'
                    WHEN shipping_country_code='IN' THEN 'IN' ELSE 'RoW' END AS market,
               COUNT(*) AS customers, ROUND(AVG(d2nd),1) AS avg_days, ROUND(MEDIAN(d2nd),1) AS median_days
        FROM fs GROUP BY 1 ORDER BY avg_days
    """,
    "M13 Churn Risk Distribution": """
        SELECT COALESCE(churn_risk,'unknown') AS bucket, COUNT(*) AS profiles,
               ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(),1) AS pct,
               ROUND(AVG(COALESCE(predicted_clv_1y,0)),2) AS avg_clv_1y
        FROM klaviyo.profiles GROUP BY 1
        ORDER BY CASE bucket WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'winback' THEN 4 ELSE 5 END
    """,
    "M14 At-Risk Revenue": """
        SELECT COALESCE(country,'Unknown') AS market, COUNT(*) AS at_risk_profiles,
               ROUND(SUM(COALESCE(predicted_clv_1y,0)),2) AS at_risk_revenue
        FROM klaviyo.profiles WHERE churn_risk IN ('high','winback')
        GROUP BY 1 ORDER BY at_risk_revenue DESC LIMIT 8
    """,
    "M15 Product Repeat Rate (top 10)": """
        WITH fp AS (SELECT li.product_id, li.title AS product_title, o.customer_id, o.processed_at AS pd,
                           ROW_NUMBER() OVER (PARTITION BY o.customer_id,li.product_id ORDER BY o.processed_at) AS rk
                    FROM matrixify.order_line_items li JOIN matrixify.orders o ON li.order_id=o.id
                    WHERE o.financial_status NOT IN ('refunded','voided') AND o.cancelled_at IS NULL),
             fb AS (SELECT product_id, product_title, customer_id, pd FROM fp WHERE rk=1),
             rb AS (SELECT DISTINCT fb.product_id, fb.customer_id FROM fb
                    JOIN matrixify.orders o2 ON o2.customer_id=fb.customer_id
                      AND o2.processed_at>fb.pd AND o2.processed_at<=fb.pd+INTERVAL '90 days'
                      AND o2.financial_status NOT IN ('refunded','voided') AND o2.cancelled_at IS NULL)
        SELECT fb.product_title, COUNT(DISTINCT fb.customer_id) AS first_buyers,
               COUNT(DISTINCT rb.customer_id) AS repeat_buyers,
               ROUND(COUNT(DISTINCT rb.customer_id)*100.0/NULLIF(COUNT(DISTINCT fb.customer_id),0),1) AS repeat_rate_pct
        FROM fb LEFT JOIN rb USING(product_id, customer_id)
        GROUP BY fb.product_id, fb.product_title ORDER BY repeat_rate_pct DESC LIMIT 10
    """,
    "BONUS LTV by Market": """
        WITH cr AS (SELECT customer_id,
                           CASE WHEN shipping_country_code='US' THEN 'US' WHEN shipping_country_code='GB' THEN 'UK'
                                WHEN shipping_country_code='IN' THEN 'IN' ELSE 'RoW' END AS market,
                           SUM(total_price) AS ltv, COUNT(*) AS orders, AVG(total_price) AS aov
                    FROM matrixify.orders WHERE financial_status NOT IN ('refunded','voided') AND cancelled_at IS NULL
                    GROUP BY 1,2)
        SELECT market, COUNT(DISTINCT customer_id) AS customers,
               ROUND(AVG(ltv),2) AS avg_ltv, ROUND(MEDIAN(ltv),2) AS median_ltv,
               ROUND(AVG(orders),2) AS avg_orders, ROUND(AVG(aov),2) AS avg_aov
        FROM cr GROUP BY market ORDER BY avg_ltv DESC
    """,
}

SEP = "=" * 72
for name, sql in QUERIES.items():
    print(f"\n{SEP}\n  {name}\n{SEP}")
    try:
        df = con.execute(sql).df()
        if df.empty:
            print("  (no data)")
        else:
            print(df.head(8).to_string(index=False, max_colwidth=24))
            if len(df) > 8:
                print(f"  ... {len(df)} rows total")
    except Exception as e:
        print(f"  ERROR: {e}")

con.close()
