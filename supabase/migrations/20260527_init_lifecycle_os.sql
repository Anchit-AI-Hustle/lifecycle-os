-- KNICKGASM Lifecycle OS — initial schema
-- Run via: supabase db push  (or psql $SUPABASE_DATABASE_URL -f this file)
--
-- 4 schemas mirror the operational tools:
--   raw_*     ingested data the dashboard reads
--   plan_*    calendar + send queue
--   ai_*      strategy / variant / send-log artefacts produced per calendar row
--   analytics_*  precomputed views the dashboard polls

create schema if not exists lifecycle;

-- ─────────────────────────────────────────────────────────────────────────
-- RAW · uploaded by the dashboard or synced from Shopify / Klaviyo / WE
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists lifecycle.raw_campaigns (
    id              text primary key,
    name            text not null,
    channel         text not null check (channel in ('email','sms','push','whatsapp')),
    market          text not null check (market in ('US','UK','Global','IN')),
    sent_at         timestamptz not null,
    sends           integer  not null default 0,
    opens           integer  not null default 0,
    clicks          integer  not null default 0,
    conversions     integer  not null default 0,
    revenue         numeric(18,2) not null default 0,
    unsubs          integer  not null default 0,
    content_type    text     not null default 'promo',
    primary_sku     text,
    subject         text,
    updated_at      timestamptz not null default now()
);
create index if not exists idx_raw_campaigns_market_date on lifecycle.raw_campaigns (market, sent_at desc);

create table if not exists lifecycle.raw_customers (
    id                  text primary key,
    market              text not null check (market in ('US','UK','Global','IN')),
    first_order_at      timestamptz,
    last_order_at       timestamptz,
    orders_count        integer not null default 0,
    total_spent         numeric(18,2) not null default 0,
    discount_rate       numeric(6,4) not null default 0,
    email_engaged       boolean not null default false,
    sms_engaged         boolean not null default false,
    primary_category    text,
    rfm_segment         text,
    updated_at          timestamptz not null default now()
);
create index if not exists idx_raw_customers_market_segment on lifecycle.raw_customers (market, rfm_segment);

create table if not exists lifecycle.raw_orders (
    id              text primary key,
    customer_id     text references lifecycle.raw_customers (id) on delete set null,
    market          text not null check (market in ('US','UK','Global','IN')),
    ordered_at      timestamptz not null,
    total           numeric(18,2) not null default 0,
    discount        numeric(18,2) not null default 0,
    lines           jsonb,
    updated_at      timestamptz not null default now()
);
create index if not exists idx_raw_orders_market_date on lifecycle.raw_orders (market, ordered_at desc);

create table if not exists lifecycle.raw_products (
    sku             text primary key,
    title           text not null,
    category        text,
    price           numeric(18,2) not null default 0,
    market          text,
    updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- PLAN · 30-day marketing calendar + send queue
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists lifecycle.plan_calendar (
    id              text primary key,                         -- yyyy-mm-dd_market_segment_idx
    date            date not null,
    send_hour_utc   integer not null check (send_hour_utc between 0 and 23),
    market          text not null check (market in ('US','UK','Global','IN')),
    segment         text not null,
    segment_size    integer,
    archetype       text not null,
    content_type    text not null,
    hero_sku        text,
    hero_product    text,
    subject_hint    text,
    festival        text,
    festival_weight integer,
    rationale       text,
    status          text not null default 'planned'           -- planned | building | built | scheduled | sent | skipped
                       check (status in ('planned','building','built','scheduled','sent','skipped')),
    generated_at    timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists idx_plan_calendar_date on lifecycle.plan_calendar (date, send_hour_utc);
create index if not exists idx_plan_calendar_market_status on lifecycle.plan_calendar (market, status);

create table if not exists lifecycle.plan_festivals (
    market          text not null check (market in ('US','UK','Global','IN')),
    mmdd            text not null,                           -- '01-26'
    name            text not null,
    weight          integer not null check (weight between 1 and 10),
    tags            text[] not null default '{}',
    archetype_hint  text,
    recommended_segments text[] not null default '{}',
    primary key (market, mmdd, name)
);

-- ─────────────────────────────────────────────────────────────────────────
-- AI · strategy + variant outputs per calendar row
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists lifecycle.ai_runs (
    id              bigserial primary key,
    calendar_id     text references lifecycle.plan_calendar (id) on delete cascade,
    stage           text not null,                            -- strategy | variant-A | variant-B | variant-T1 | variant-T2 | image | score
    provider        text not null,                            -- openai | anthropic | gemini | xai | groq | cerebras | pollinations
    model           text not null,
    ok              boolean not null,
    latency_ms      integer,
    cost_usd        numeric(10,5),
    error           text,
    payload         jsonb,                                    -- full request/response for debug
    created_at      timestamptz not null default now()
);
create index if not exists idx_ai_runs_calendar on lifecycle.ai_runs (calendar_id, stage);

create table if not exists lifecycle.ai_variants (
    id              bigserial primary key,
    calendar_id     text references lifecycle.plan_calendar (id) on delete cascade,
    variant_key     text not null check (variant_key in ('A','B','T1','T2')),
    kind            text not null check (kind in ('image','text')),
    label           text,
    subject_line    text,
    preview_text    text,
    hero_image_url  text,
    html            text,
    score           numeric(6,2),
    score_breakdown jsonb,
    created_at      timestamptz not null default now(),
    unique (calendar_id, variant_key)
);

-- ─────────────────────────────────────────────────────────────────────────
-- ANALYTICS · materialised views the dashboard polls
-- ─────────────────────────────────────────────────────────────────────────

create or replace view lifecycle.v_revenue_30d as
select
    market,
    sum(case when ordered_at >= current_date - interval '7 days'  then total else 0 end) as rev_7d,
    sum(case when ordered_at >= current_date - interval '30 days' then total else 0 end) as rev_30d,
    sum(case when ordered_at >= current_date - interval '30 days' then 1     else 0 end) as orders_30d,
    avg(case when ordered_at >= current_date - interval '30 days' then total end)        as aov_30d
from lifecycle.raw_orders
group by market;

create or replace view lifecycle.v_campaign_summary as
select
    market,
    channel,
    content_type,
    count(*)                              as campaigns,
    sum(sends)                            as sends,
    sum(opens)                            as opens,
    sum(clicks)                           as clicks,
    sum(conversions)                      as conversions,
    sum(revenue)                          as revenue,
    sum(unsubs)                           as unsubs,
    case when sum(sends) > 0  then sum(opens)::numeric / sum(sends)  end as open_rate,
    case when sum(opens) > 0  then sum(clicks)::numeric / sum(opens) end as ctr,
    case when sum(clicks) > 0 then sum(conversions)::numeric / sum(clicks) end as cvr,
    case when sum(sends) > 0  then sum(revenue) / sum(sends)         end as rev_per_send
from lifecycle.raw_campaigns
where sent_at >= current_date - interval '90 days'
group by market, channel, content_type
order by market, sum(revenue) desc;

create or replace view lifecycle.v_segment_value as
select
    market,
    rfm_segment as segment,
    count(*)                  as customers,
    sum(total_spent)          as revenue,
    avg(total_spent)          as avg_ltv,
    avg(discount_rate)        as avg_discount,
    sum(case when email_engaged then 1 else 0 end)::numeric / nullif(count(*),0) as engaged_pct
from lifecycle.raw_customers
where rfm_segment is not null
group by market, rfm_segment
order by market, sum(total_spent) desc;

create or replace view lifecycle.v_calendar_30d as
select
    date, send_hour_utc, market, segment, segment_size, archetype, content_type,
    hero_sku, hero_product, subject_hint, festival, festival_weight, rationale, status
from lifecycle.plan_calendar
where date >= current_date and date < current_date + interval '30 days'
order by date, send_hour_utc, market;

-- ─────────────────────────────────────────────────────────────────────────
-- REALTIME publication (so the dashboard updates live)
-- ─────────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table lifecycle.raw_campaigns;
alter publication supabase_realtime add table lifecycle.raw_customers;
alter publication supabase_realtime add table lifecycle.raw_orders;
alter publication supabase_realtime add table lifecycle.plan_calendar;
alter publication supabase_realtime add table lifecycle.ai_runs;
alter publication supabase_realtime add table lifecycle.ai_variants;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS · anon = read-only; writes only via service-role (the API endpoints)
-- ─────────────────────────────────────────────────────────────────────────
alter table lifecycle.raw_campaigns  enable row level security;
alter table lifecycle.raw_customers  enable row level security;
alter table lifecycle.raw_orders     enable row level security;
alter table lifecycle.raw_products   enable row level security;
alter table lifecycle.plan_calendar  enable row level security;
alter table lifecycle.plan_festivals enable row level security;
alter table lifecycle.ai_runs        enable row level security;
alter table lifecycle.ai_variants    enable row level security;

create policy "read all" on lifecycle.raw_campaigns  for select using (true);
create policy "read all" on lifecycle.raw_customers  for select using (true);
create policy "read all" on lifecycle.raw_orders     for select using (true);
create policy "read all" on lifecycle.raw_products   for select using (true);
create policy "read all" on lifecycle.plan_calendar  for select using (true);
create policy "read all" on lifecycle.plan_festivals for select using (true);
create policy "read all" on lifecycle.ai_runs        for select using (true);
create policy "read all" on lifecycle.ai_variants    for select using (true);

-- Seed the festivals table from data/festivals.json after this migration runs
-- (or use scripts/seed-festivals.js).
