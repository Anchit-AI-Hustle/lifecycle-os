"""
engine.py — Knickgasm D2C Mailer Decision Engine
Connects to knickgasm_dtc.duckdb, runs 7 metric queries, evaluates 6 priority triggers.
Logs all decisions to campaign_log.json (append-only).
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    import duckdb
except ImportError:
    print("[error] duckdb not installed. Run: pip install duckdb")
    sys.exit(1)

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR.parent / "knickgasm_dtc.duckdb"
TARGETS_PATH = BASE_DIR / "targets.json"
LOG_PATH = BASE_DIR / "campaign_log.json"


def load_targets() -> dict:
    with open(TARGETS_PATH, "r") as f:
        return json.load(f)


def safe_query(con, sql: str, label: str) -> list[dict]:
    """Execute SQL safely; return empty list on any error."""
    try:
        result = con.execute(sql).fetchdf()
        return result.to_dict(orient="records")
    except Exception as e:
        print(f"[warn] Query '{label}' skipped — {e}")
        return []


def run_queries(con, targets: dict) -> dict:
    """Run all 7 metric queries and return structured results."""
    results = {}

    # Q1 — Churn signal
    q1 = f"""
        SELECT
            COUNT(*) AS at_risk_count,
            ROUND(SUM(predicted_clv_1y), 2) AS at_risk_revenue,
            ROUND(AVG(predicted_clv_1y), 2) AS avg_clv,
            ROUND(AVG(total_orders), 1) AS avg_orders
        FROM klaviyo.profiles
        WHERE churn_risk IN ('high','winback')
          AND predicted_clv_1y > {targets['churn_high_clv_threshold']}
    """
    rows = safe_query(con, q1, "churn_signal")
    results["churn"] = rows[0] if rows else {
        "at_risk_count": 0, "at_risk_revenue": 0.0, "avg_clv": 0.0, "avg_orders": 0.0
    }

    # Q2 — 90-day retention cohorts
    q2 = """
        WITH first_orders AS (
            SELECT customer_id,
                   DATE_TRUNC('month', MIN(processed_at)) AS cohort_month,
                   MIN(processed_at) AS first_date
            FROM matrixify.orders
            WHERE payment_status='paid' AND cancelled_at IS NULL
            GROUP BY customer_id
        ),
        second_orders AS (
            SELECT o.customer_id
            FROM matrixify.orders o
            JOIN first_orders f USING(customer_id)
            WHERE o.processed_at > f.first_date
              AND DATEDIFF('day', f.first_date, o.processed_at) <= 90
              AND o.payment_status='paid'
        )
        SELECT
            cohort_month,
            COUNT(f.customer_id) AS cohort_size,
            COUNT(s.customer_id) AS retained,
            ROUND(COUNT(s.customer_id)*100.0 / NULLIF(COUNT(f.customer_id),0), 1) AS retention_pct
        FROM first_orders f
        LEFT JOIN second_orders s USING(customer_id)
        GROUP BY cohort_month
        ORDER BY cohort_month DESC
        LIMIT 3
    """
    results["retention"] = safe_query(con, q2, "retention")

    # Q3 — Subscription mix
    q3 = """
        SELECT
            DATE_TRUNC('month', o.processed_at) AS month,
            ROUND(
                SUM(CASE WHEN li.properties::TEXT ILIKE '%subscription%'
                          OR li.properties::TEXT ILIKE '%frequency%'
                         THEN li.total ELSE 0 END)*100.0
                / NULLIF(SUM(li.total), 0), 1
            ) AS subscription_pct
        FROM matrixify.order_line_items li
        JOIN matrixify.orders o USING(order_id)
        WHERE o.payment_status='paid'
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT 3
    """
    results["subscription"] = safe_query(con, q3, "subscription_mix")

    # Q4 — Cart abandonment (8-week window)
    q4 = """
        SELECT
            DATE_TRUNC('week', event_date) AS week,
            SUM(CASE WHEN event_name='Added To Cart'   THEN event_count ELSE 0 END) AS atc,
            SUM(CASE WHEN event_name='Order created'   THEN event_count ELSE 0 END) AS orders,
            ROUND(
                (1.0 - SUM(CASE WHEN event_name='Order created' THEN event_count ELSE 0 END)*1.0
                     / NULLIF(SUM(CASE WHEN event_name='Added To Cart' THEN event_count ELSE 0 END),0)
                )*100, 1
            ) AS abandonment_pct
        FROM webengage.event_summary
        WHERE event_date >= CURRENT_DATE - INTERVAL '56 days'
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT 8
    """
    results["cart"] = safe_query(con, q4, "cart_abandonment")

    # Q5 — Email revenue share
    q5 = """
        SELECT
            DATE_TRUNC('month', k.sent_at) AS month,
            ROUND(SUM(k.revenue_attributed)*100.0 / NULLIF(MAX(r.net_sales), 0), 1) AS email_pct
        FROM klaviyo.campaigns k
        JOIN shopify_analytics.revenue_metrics r
            ON DATE_TRUNC('month', k.sent_at) = r.report_date
           AND r.report_period = 'month'
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT 3
    """
    results["email_revenue"] = safe_query(con, q5, "email_revenue_pct")

    # Q6 — Top SKUs among at-risk customers
    q6 = """
        SELECT li.title, COUNT(*) AS purchase_count
        FROM matrixify.order_line_items li
        JOIN matrixify.orders o USING(order_id)
        JOIN klaviyo.profiles p ON o.email = p.email
        WHERE p.churn_risk IN ('high','winback')
          AND o.payment_status='paid'
        GROUP BY li.title
        ORDER BY purchase_count DESC
        LIMIT 3
    """
    results["top_skus"] = safe_query(con, q6, "top_last_skus")

    # Q7 — Winning campaigns
    q7 = """
        SELECT campaign_name, revenue_per_recipient, ctor, click_rate
        FROM klaviyo.campaigns
        WHERE channel='email'
        ORDER BY revenue_per_recipient DESC NULLS LAST
        LIMIT 5
    """
    results["winning_campaigns"] = safe_query(con, q7, "winning_cta")

    return results


def evaluate_triggers(metrics: dict, targets: dict) -> list[dict]:
    """
    Evaluate all 6 triggers in priority order.
    Returns list of fired trigger dicts.
    """
    triggered = []
    churn = metrics["churn"]
    retention = metrics["retention"]
    subscription = metrics["subscription"]
    cart = metrics["cart"]
    email_rev = metrics["email_revenue"]

    # P1 — win_back_vip
    if (churn.get("at_risk_revenue", 0) or 0) > targets["at_risk_revenue_trigger"] and \
       (churn.get("avg_clv", 0) or 0) > targets["churn_high_clv_threshold"]:
        triggered.append({
            "campaign_type": "win_back_vip",
            "priority": 1,
            "trigger_reason": (
                f"${churn['at_risk_revenue']:,.0f} at-risk revenue across "
                f"{churn['at_risk_count']} high-CLV customers "
                f"(avg CLV ${churn['avg_clv']:.0f})"
            ),
            "context_data": metrics
        })

    # P2 — post_purchase_series
    if retention:
        below_target = sum(
            1 for r in retention
            if (r.get("retention_pct") or 0) < targets["retention_90d_min"] * 100
        )
        if below_target >= 2:
            latest = retention[0].get("retention_pct", 0) or 0
            triggered.append({
                "campaign_type": "post_purchase_series",
                "priority": 2,
                "trigger_reason": (
                    f"90-day retention at {latest:.1f}% vs "
                    f"{targets['retention_90d_min']*100:.0f}% target — "
                    f"{below_target}/3 cohorts below threshold"
                ),
                "context_data": metrics
            })

    # P3 — subscription_conversion
    #
    # Only meaningful for a store that actually sells a subscription. This
    # trigger fires when the subscription mix is BELOW target, so on a store with
    # no subscription product every month reads 0% and the trigger fires forever,
    # briefing the model to push customers onto a product line that does not
    # exist. The engine was copied from a sibling repo built for a consumable
    # brand where replenishment was the core motion; here, pairs are hand-painted
    # to order and never repeated.
    #
    # A flat 0% across the window therefore means "this brand does not sell
    # subscriptions", not "conversion opportunity". Require at least one month of
    # real subscription revenue before treating the gap as actionable.
    has_subscription_revenue = any((s.get("subscription_pct") or 0) > 0 for s in subscription)
    if subscription and has_subscription_revenue:
        below_sub = sum(
            1 for s in subscription
            if (s.get("subscription_pct") or 0) < targets["subscription_mix_min"] * 100
        )
        if below_sub >= 2:
            latest_sub = subscription[0].get("subscription_pct", 0) or 0
            triggered.append({
                "campaign_type": "subscription_conversion",
                "priority": 3,
                "trigger_reason": (
                    f"Subscription mix at {latest_sub:.1f}% vs "
                    f"{targets['subscription_mix_min']*100:.0f}% target"
                ),
                "context_data": metrics
            })

    # P4 — cart_recovery
    if cart:
        latest_cart = cart[0].get("abandonment_pct") or 0
        if latest_cart > targets["cart_abandonment_max"] * 100:
            triggered.append({
                "campaign_type": "cart_recovery",
                "priority": 4,
                "trigger_reason": (
                    f"Cart abandonment at {latest_cart:.1f}% this week — "
                    f"above {targets['cart_abandonment_max']*100:.0f}% threshold"
                ),
                "context_data": metrics
            })

    # P5 — re_engagement
    if email_rev:
        below_email = sum(
            1 for e in email_rev
            if (e.get("email_pct") or 0) < targets["email_revenue_pct_min"] * 100
        )
        if below_email >= 2:
            latest_email = email_rev[0].get("email_pct", 0) or 0
            triggered.append({
                "campaign_type": "re_engagement",
                "priority": 5,
                "trigger_reason": (
                    f"Email revenue contribution {latest_email:.1f}% vs "
                    f"{targets['email_revenue_pct_min']*100:.0f}% target"
                ),
                "context_data": metrics
            })

    # P6 — geo_upsell (always fires as fallback)
    if not triggered:
        triggered.append({
            "campaign_type": "geo_upsell",
            "priority": 6,
            "trigger_reason": "All metrics within targets — running monthly geo upsell",
            "context_data": metrics
        })

    return triggered


def print_metric_report(metrics: dict, targets: dict) -> None:
    """Pretty-print the metric readings for --list_triggers output."""
    SEP = "-" * 60
    churn = metrics.get("churn", {}) if isinstance(metrics.get("churn"), dict) else {}
    retention = metrics.get("retention", [])
    subscription = metrics.get("subscription", [])
    cart = metrics.get("cart", [])
    email_rev = metrics.get("email_revenue", [])
    top_skus = metrics.get("top_skus", [])
    winning = metrics.get("winning_campaigns", [])

    print(SEP)
    print("-- Metric Readings -------------------------------------------")
    print(f"  Churn Signal   : at_risk_count={churn.get('at_risk_count',0)}, "
          f"at_risk_rev=${churn.get('at_risk_revenue',0):,.0f}, "
          f"avg_clv=${churn.get('avg_clv',0):.0f}")

    if retention:
        r = retention[0]
        print(f"  Retention 90d  : {r.get('retention_pct',0):.1f}% (target: "
              f"{targets.get('retention_90d_min',0)*100:.0f}%)")
    else:
        print(f"  Retention 90d  : no data")

    if subscription and any((s.get('subscription_pct') or 0) > 0 for s in subscription):
        s = subscription[0]
        total = (s.get('sub_count', 0) or 0) + (s.get('one_time_count', 0) or 0)
        pct = (s.get('sub_count', 0) or 0) / max(total, 1) * 100
        print(f"  Subscription   : {pct:.1f}% subs (target: "
              f"{targets.get('subscription_mix_min',0)*100:.0f}%)")
    elif subscription:
        print(f"  Subscription   : none sold (P3 not applicable)")
    else:
        print(f"  Subscription   : no data")

    if cart:
        c = cart[0]
        rate = (c.get('abandonment_rate', 0) or 0) * 100
        print(f"  Cart Abandon   : {rate:.1f}% (max: "
              f"{targets.get('cart_abandonment_max',0)*100:.0f}%)")
    else:
        print(f"  Cart Abandon   : no data")

    if email_rev:
        e = email_rev[0]
        pct = (e.get('email_revenue_pct', 0) or 0) * 100
        print(f"  Email Rev %    : {pct:.1f}% (min: "
              f"{targets.get('email_revenue_pct_min',0)*100:.0f}%)")
    else:
        print(f"  Email Rev %    : no data")

    if top_skus:
        names = [row.get('product_title', row.get('sku', '?')) for row in top_skus[:3]]
        print(f"  Top SKUs       : {', '.join(names)}")

    if winning:
        w = winning[0]
        print(f"  Winning CTA    : {w.get('campaign_name','?')} "
              f"(RPR ${w.get('revenue_per_recipient',0):.2f})")
    print(SEP)


def log_campaign(entry: dict) -> None:
    """Append a JSON line to campaign_log.json."""
    entry["logged_at"] = datetime.now().isoformat()
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def get_triggered_campaigns(verbose: bool = False) -> list[dict]:
    """
    Main entry point. Returns list of triggered campaign dicts.
    Handles empty DB and missing tables gracefully.
    """
    targets = load_targets()

    if not DB_PATH.exists():
        print(f"[warn] Database not found at {DB_PATH} — using zero metrics")
        metrics = {k: [] for k in ["churn", "retention", "subscription", "cart", "email_revenue", "top_skus", "winning_campaigns"]}
        metrics["churn"] = {"at_risk_count": 0, "at_risk_revenue": 0.0, "avg_clv": 0.0, "avg_orders": 0.0}
        triggered = evaluate_triggers(metrics, targets)
        return triggered

    try:
        con = duckdb.connect(str(DB_PATH), read_only=True)
    except Exception as e:
        print(f"[warn] Could not connect to database: {e} — using zero metrics")
        metrics = {k: [] for k in ["churn", "retention", "subscription", "cart", "email_revenue", "top_skus", "winning_campaigns"]}
        metrics["churn"] = {"at_risk_count": 0, "at_risk_revenue": 0.0, "avg_clv": 0.0, "avg_orders": 0.0}
        triggered = evaluate_triggers(metrics, targets)
        return triggered

    metrics = run_queries(con, targets)
    con.close()

    if verbose:
        print("\n[metrics] Query results:")
        for key, val in metrics.items():
            print(f"  {key}: {val}")
        print()

    triggered = evaluate_triggers(metrics, targets)

    # Log each trigger decision
    for t in triggered:
        log_campaign({
            "event": "trigger_fired",
            "campaign_type": t["campaign_type"],
            "priority": t["priority"],
            "trigger_reason": t["trigger_reason"],
            "churn_count": metrics["churn"].get("at_risk_count", 0),
            "at_risk_revenue": metrics["churn"].get("at_risk_revenue", 0),
        })

    return triggered


if __name__ == "__main__":
    campaigns = get_triggered_campaigns(verbose=True)
    print(f"\nTriggered {len(campaigns)} campaign(s):")
    for c in campaigns:
        print(f"  P{c['priority']} {c['campaign_type']}: {c['trigger_reason']}")
