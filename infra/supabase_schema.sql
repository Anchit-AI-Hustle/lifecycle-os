-- KNICKGASM DTC — Supabase Postgres schema for the realtime dashboard.
-- Mirror of the local DuckDB analytics, normalized into 5 fact tables + 4 views.
-- Run once: `psql $DATABASE_URL -f infra/supabase_schema.sql`

create schema if not exists dtc;

-- ─────────────────────────────────────────────────────────────────────────
-- Fact tables — populated by ingest/sync_to_supabase.py from DuckDB
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists dtc.fact_daily_orders (
    market         text        not null,         -- US / UK / IN / EU / AU / Global
    order_date     date        not null,
    orders         integer     not null default 0,
    new_customers  integer     not null default 0,
    returning      integer     not null default 0,
    gross_revenue  numeric(18,2) not null default 0,
    net_revenue    numeric(18,2) not null default 0,
    aov            numeric(18,2) not null default 0,
    discount_pct   numeric(6,3)  not null default 0,
    updated_at     timestamptz   not null default now(),
    primary key (market, order_date)
);

create table if not exists dtc.fact_channel_perf (
    channel        text        not null,         -- google_ads / meta / klaviyo / organic / direct / etc
    market         text        not null,
    period_start   date        not null,         -- weekly bucket
    spend          numeric(18,2) not null default 0,
    orders         integer     not null default 0,
    new_customers  integer     not null default 0,
    revenue        numeric(18,2) not null default 0,
    cac            numeric(18,2),                -- spend / new_customers
    ltv            numeric(18,2),                -- rolling 90d LTV by acquired channel
    roas           numeric(8,2),                 -- revenue / spend
    updated_at     timestamptz not null default now(),
    primary key (channel, market, period_start)
);

create table if not exists dtc.fact_cohort_retention (
    cohort_month   date        not null,         -- first-purchase month
    market         text        not null,
    cohort_size    integer     not null,
    retained_30d   integer     not null default 0,
    retained_60d   integer     not null default 0,
    retained_90d   integer     not null default 0,
    repeat_rate_90d numeric(6,3) not null default 0,
    median_days_to_2nd numeric(8,2),
    updated_at     timestamptz not null default now(),
    primary key (cohort_month, market)
);

create table if not exists dtc.fact_klaviyo_perf (
    flow_id        text        not null,
    flow_name      text        not null,
    period_start   date        not null,         -- weekly bucket
    sends          integer     not null default 0,
    opens          integer     not null default 0,
    clicks         integer     not null default 0,
    revenue        numeric(18,2) not null default 0,
    open_rate      numeric(6,4) not null default 0,
    click_rate     numeric(6,4) not null default 0,
    rev_per_send   numeric(10,4) not null default 0,
    updated_at     timestamptz not null default now(),
    primary key (flow_id, period_start)
);

create table if not exists dtc.fact_top_products (
    period_start   date        not null,
    market         text        not null,
    sku            text        not null,
    title          text        not null,
    units          integer     not null default 0,
    revenue        numeric(18,2) not null default 0,
    rank           integer     not null,
    updated_at     timestamptz not null default now(),
    primary key (period_start, market, sku)
);

-- Heartbeat row so the dashboard can show last sync time.
create table if not exists dtc.sync_log (
    id          bigserial primary key,
    source      text not null,
    rows_synced integer not null,
    duration_ms integer not null,
    ran_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- Views — what the dashboard queries
-- ─────────────────────────────────────────────────────────────────────────

create or replace view dtc.v_revenue_30d as
select
    market,
    sum(case when order_date >= current_date - interval '7 days'  then net_revenue else 0 end) as rev_7d,
    sum(case when order_date >= current_date - interval '30 days' then net_revenue else 0 end) as rev_30d,
    sum(case when order_date >= current_date - interval '30 days' then orders      else 0 end) as orders_30d,
    avg(case when order_date >= current_date - interval '30 days' then aov         end)        as aov_30d
from dtc.fact_daily_orders
group by market;

create or replace view dtc.v_revenue_daily as
select
    order_date,
    market,
    net_revenue,
    orders,
    aov,
    new_customers,
    returning
from dtc.fact_daily_orders
where order_date >= current_date - interval '90 days'
order by order_date desc, market;

create or replace view dtc.v_channel_summary as
select
    channel,
    sum(spend)         as spend_90d,
    sum(revenue)       as revenue_90d,
    sum(new_customers) as new_customers_90d,
    case when sum(new_customers) > 0 then sum(spend) / sum(new_customers) end as cac_90d,
    case when sum(spend) > 0 then sum(revenue) / sum(spend) end as roas_90d,
    avg(ltv)           as ltv_avg
from dtc.fact_channel_perf
where period_start >= current_date - interval '90 days'
group by channel
order by spend_90d desc nulls last;

create or replace view dtc.v_retention_summary as
select
    cohort_month,
    sum(cohort_size)   as cohort_size,
    case when sum(cohort_size) > 0
         then round(sum(retained_30d)::numeric / sum(cohort_size) * 100, 1) end as ret_30d_pct,
    case when sum(cohort_size) > 0
         then round(sum(retained_60d)::numeric / sum(cohort_size) * 100, 1) end as ret_60d_pct,
    case when sum(cohort_size) > 0
         then round(sum(retained_90d)::numeric / sum(cohort_size) * 100, 1) end as ret_90d_pct,
    avg(repeat_rate_90d * 100) as repeat_rate_90d_pct,
    avg(median_days_to_2nd) as median_days_to_2nd
from dtc.fact_cohort_retention
where cohort_month >= current_date - interval '12 months'
group by cohort_month
order by cohort_month desc;

create or replace view dtc.v_email_top_flows as
select
    flow_name,
    sum(sends)   as sends,
    sum(opens)   as opens,
    sum(clicks)  as clicks,
    sum(revenue) as revenue,
    case when sum(sends) > 0 then round(sum(opens)::numeric  / sum(sends) * 100, 2) end as open_pct,
    case when sum(opens) > 0 then round(sum(clicks)::numeric / sum(opens) * 100, 2) end as click_pct,
    case when sum(sends) > 0 then round(sum(revenue)         / sum(sends), 4) end       as rev_per_send
from dtc.fact_klaviyo_perf
where period_start >= current_date - interval '90 days'
group by flow_name
order by revenue desc nulls last;

create or replace view dtc.v_top_products as
select * from dtc.fact_top_products
where period_start = (select max(period_start) from dtc.fact_top_products)
order by market, rank;

create or replace view dtc.v_last_sync as
select source, max(ran_at) as last_ran, max(rows_synced) as last_rows
from dtc.sync_log group by source;

-- ─────────────────────────────────────────────────────────────────────────
-- Realtime: enable change feeds on the fact tables so the dashboard updates
-- ─────────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table dtc.fact_daily_orders;
alter publication supabase_realtime add table dtc.fact_channel_perf;
alter publication supabase_realtime add table dtc.fact_cohort_retention;
alter publication supabase_realtime add table dtc.fact_klaviyo_perf;
alter publication supabase_realtime add table dtc.fact_top_products;
alter publication supabase_realtime add table dtc.sync_log;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS: read-only anonymous access (dashboard uses anon key)
-- ─────────────────────────────────────────────────────────────────────────
alter table dtc.fact_daily_orders     enable row level security;
alter table dtc.fact_channel_perf     enable row level security;
alter table dtc.fact_cohort_retention enable row level security;
alter table dtc.fact_klaviyo_perf     enable row level security;
alter table dtc.fact_top_products     enable row level security;
alter table dtc.sync_log              enable row level security;

create policy "read all"  on dtc.fact_daily_orders     for select using (true);
create policy "read all"  on dtc.fact_channel_perf     for select using (true);
create policy "read all"  on dtc.fact_cohort_retention for select using (true);
create policy "read all"  on dtc.fact_klaviyo_perf     for select using (true);
create policy "read all"  on dtc.fact_top_products     for select using (true);
create policy "read all"  on dtc.sync_log              for select using (true);

-- Writes only via service_role (sync script uses SERVICE_ROLE_KEY)
