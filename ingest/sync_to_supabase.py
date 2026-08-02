"""
sync_to_supabase.py — push the DuckDB analytics tables to Supabase Postgres.

Reads the local `knickgasm_dtc.duckdb`, runs the aggregation SQL, and upserts
into the `dtc.*` fact tables on Supabase. Realtime subscribers on those
tables (the dashboard) get the changes instantly.

Run:
    python ingest/sync_to_supabase.py

Env:
    DUCKDB_PATH               path to knickgasm_dtc.duckdb (default: ./knickgasm_dtc.duckdb)
    SUPABASE_DATABASE_URL     postgres://...        ← Settings → Database → Connection string
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import duckdb
import psycopg2
import psycopg2.extras


# ─── Aggregation queries — DuckDB side ───────────────────────────────────────
# Each query yields the columns that match a `dtc.fact_*` table 1:1.

DAILY_ORDERS_SQL = """
select
    coalesce(o.shipping_address->>'country_code', o.email_country_hint, 'Unknown') as market,
    cast(o.created_at as date) as order_date,
    count(distinct o.id) as orders,
    count(distinct case when c.orders_count = 1 then o.id end) as new_customers,
    count(distinct case when c.orders_count > 1 then o.id end) as returning,
    sum(o.total_price)::decimal(18,2) as gross_revenue,
    sum(o.total_price - coalesce(o.total_discounts,0) - coalesce(o.total_refunded,0))::decimal(18,2) as net_revenue,
    avg(o.total_price)::decimal(18,2) as aov,
    case when sum(o.total_price) > 0
         then (sum(o.total_discounts) / sum(o.total_price))::decimal(6,3) else 0 end as discount_pct
from matrixify.orders o
left join matrixify.customers c on c.id = o.customer_id
where o.created_at >= current_date - interval '180 days'
  and o.cancelled_at is null
group by 1, 2
"""

CHANNEL_PERF_SQL = """
-- weekly bucket; uses Shopify Analytics acquisition rollup
select
    am.channel as channel,
    coalesce(am.market, 'Global') as market,
    date_trunc('week', am.period_start)::date as period_start,
    sum(am.spend)::decimal(18,2) as spend,
    sum(am.orders) as orders,
    sum(am.new_customers) as new_customers,
    sum(am.revenue)::decimal(18,2) as revenue,
    case when sum(am.new_customers) > 0
         then (sum(am.spend) / sum(am.new_customers))::decimal(18,2) end as cac,
    avg(am.ltv_90d)::decimal(18,2) as ltv,
    case when sum(am.spend) > 0
         then (sum(am.revenue) / sum(am.spend))::decimal(8,2) end as roas
from shopify_analytics.acquisition_metrics am
where am.period_start >= current_date - interval '180 days'
group by 1, 2, 3
"""

COHORT_RETENTION_SQL = """
select
    cohort_month::date,
    market,
    cohort_size,
    retained_30d,
    retained_60d,
    retained_90d,
    case when cohort_size > 0
         then (retained_90d::numeric / cohort_size)::decimal(6,3) else 0 end as repeat_rate_90d,
    median_days_to_2nd::decimal(8,2)
from shopify_analytics.customer_cohorts
where cohort_month >= current_date - interval '12 months'
"""

KLAVIYO_PERF_SQL = """
select
    flow_id,
    flow_name,
    date_trunc('week', period_start)::date as period_start,
    sum(sends)   as sends,
    sum(opens)   as opens,
    sum(clicks)  as clicks,
    sum(revenue)::decimal(18,2) as revenue,
    case when sum(sends) > 0
         then (sum(opens)::numeric / sum(sends))::decimal(6,4) else 0 end as open_rate,
    case when sum(opens) > 0
         then (sum(clicks)::numeric / sum(opens))::decimal(6,4) else 0 end as click_rate,
    case when sum(sends) > 0
         then (sum(revenue) / sum(sends))::decimal(10,4) else 0 end as rev_per_send
from klaviyo.flow_performance
where period_start >= current_date - interval '180 days'
group by flow_id, flow_name, 3
"""

TOP_PRODUCTS_SQL = """
select
    date_trunc('month', current_date)::date as period_start,
    coalesce(market, 'Global') as market,
    sku,
    title,
    sum(units) as units,
    sum(revenue)::decimal(18,2) as revenue,
    row_number() over (partition by coalesce(market, 'Global') order by sum(revenue) desc) as rank
from shopify_analytics.product_performance
where period_start >= current_date - interval '30 days'
group by 1, 2, 3, 4
qualify rank <= 20
"""

JOBS = [
    ("fact_daily_orders",
     DAILY_ORDERS_SQL,
     ("market", "order_date"),
     ["market", "order_date", "orders", "new_customers", "returning",
      "gross_revenue", "net_revenue", "aov", "discount_pct"]),
    ("fact_channel_perf",
     CHANNEL_PERF_SQL,
     ("channel", "market", "period_start"),
     ["channel", "market", "period_start", "spend", "orders",
      "new_customers", "revenue", "cac", "ltv", "roas"]),
    ("fact_cohort_retention",
     COHORT_RETENTION_SQL,
     ("cohort_month", "market"),
     ["cohort_month", "market", "cohort_size", "retained_30d",
      "retained_60d", "retained_90d", "repeat_rate_90d", "median_days_to_2nd"]),
    ("fact_klaviyo_perf",
     KLAVIYO_PERF_SQL,
     ("flow_id", "period_start"),
     ["flow_id", "flow_name", "period_start", "sends", "opens",
      "clicks", "revenue", "open_rate", "click_rate", "rev_per_send"]),
    ("fact_top_products",
     TOP_PRODUCTS_SQL,
     ("period_start", "market", "sku"),
     ["period_start", "market", "sku", "title", "units", "revenue", "rank"]),
]


def upsert(pg, table: str, keys: tuple[str, ...], cols: list[str], rows: list[tuple]) -> int:
    if not rows:
        return 0
    placeholders = ", ".join(["%s"] * len(cols))
    cols_str = ", ".join(cols)
    updates = ", ".join(f"{c} = excluded.{c}" for c in cols if c not in keys)
    updates = (updates + ", " if updates else "") + "updated_at = now()"
    sql = (
        f"insert into dtc.{table} ({cols_str}) values ({placeholders}) "
        f"on conflict ({', '.join(keys)}) do update set {updates}"
    )
    with pg.cursor() as cur:
        psycopg2.extras.execute_batch(cur, sql, rows, page_size=500)
    return len(rows)


def main() -> int:
    duckdb_path = os.environ.get("DUCKDB_PATH", "knickgasm_dtc.duckdb")
    pg_url = os.environ.get("SUPABASE_DATABASE_URL")

    if not pg_url:
        print("error: SUPABASE_DATABASE_URL not set", file=sys.stderr)
        return 1
    if not Path(duckdb_path).exists():
        print(f"error: {duckdb_path} not found — run ingest first", file=sys.stderr)
        return 1

    duck = duckdb.connect(duckdb_path, read_only=True)
    pg = psycopg2.connect(pg_url)
    pg.autocommit = False
    total = 0

    try:
        for table, sql, keys, cols in JOBS:
            t0 = time.monotonic()
            try:
                rows = duck.execute(sql).fetchall()
            except Exception as e:
                print(f"  ! {table:24s} skipped — duck query failed: {e}", file=sys.stderr)
                continue
            count = upsert(pg, table, keys, cols, rows)
            duration_ms = int((time.monotonic() - t0) * 1000)
            with pg.cursor() as cur:
                cur.execute(
                    "insert into dtc.sync_log (source, rows_synced, duration_ms) values (%s, %s, %s)",
                    (table, count, duration_ms),
                )
            pg.commit()
            print(f"  ✓ {table:24s} {count:>6d} rows · {duration_ms} ms")
            total += count
    finally:
        duck.close()
        pg.close()

    print(f"\ndone · {total} rows synced")
    return 0


if __name__ == "__main__":
    sys.exit(main())
