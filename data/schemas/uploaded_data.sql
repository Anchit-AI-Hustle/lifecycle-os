-- KNICKGASM Lifecycle OS — schema for raw uploaded data.
-- The "Link Database" UI accepts a schema name (default: uploaded_by_anchit)
-- and runs this DDL against the chosen Supabase project before COPY-ing
-- the CSVs from input/uploaded_by_anchit/ in.
--
-- Replace {{schema}} with the user-chosen schema name before running.
-- See scripts/ingest-uploads.js — it substitutes and executes via the
-- Supabase Mgmt API /database/query endpoint.

create schema if not exists {{schema}};

-- ─────────────────────────────────────────────────────────────────────────
-- shopify_customers  (from customers_export.csv — 26.7K rows)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists {{schema}}.shopify_customers (
  customer_id              text primary key,
  first_name               text,
  last_name                text,
  email                    text,
  accepts_email_marketing  text,
  default_address_company  text,
  default_address_address1 text,
  default_address_address2 text,
  default_address_city     text,
  default_address_province_code text,
  default_address_country_code  text,
  default_address_zip      text,
  default_address_phone    text,
  phone                    text,
  accepts_sms_marketing    text,
  total_spent              numeric(18,2),
  total_orders             integer,
  note                     text,
  tax_exempt               text,
  tags                     text,
  loaded_at                timestamptz default now()
);
create index if not exists ix_customers_email   on {{schema}}.shopify_customers (lower(email));
create index if not exists ix_customers_country on {{schema}}.shopify_customers (default_address_country_code);

-- ─────────────────────────────────────────────────────────────────────────
-- shopify_orders_lines  (orders_export.csv — one line per item per order)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists {{schema}}.shopify_orders_lines (
  id                          bigserial primary key,
  order_name                  text,                 -- "Name" column = order number
  order_id                    text,                 -- Shopify Id
  email                       text,
  financial_status            text,
  paid_at                     timestamptz,
  fulfillment_status          text,
  fulfilled_at                timestamptz,
  accepts_marketing           text,
  currency                    text,
  subtotal                    numeric(18,2),
  shipping                    numeric(18,2),
  taxes                       numeric(18,2),
  total                       numeric(18,2),
  discount_code               text,
  discount_amount             numeric(18,2),
  shipping_method             text,
  created_at                  timestamptz,
  lineitem_quantity           integer,
  lineitem_name               text,
  lineitem_price              numeric(18,2),
  lineitem_compare_at_price   numeric(18,2),
  lineitem_sku                text,
  lineitem_requires_shipping  text,
  lineitem_taxable            text,
  lineitem_fulfillment_status text,
  billing_country             text,
  shipping_country            text,
  source                      text,
  tags                         text,
  loaded_at                   timestamptz default now()
);
create index if not exists ix_orders_lines_order   on {{schema}}.shopify_orders_lines (order_name);
create index if not exists ix_orders_lines_email   on {{schema}}.shopify_orders_lines (lower(email));
create index if not exists ix_orders_lines_created on {{schema}}.shopify_orders_lines (created_at);
create index if not exists ix_orders_lines_country on {{schema}}.shopify_orders_lines (shipping_country);

-- ─────────────────────────────────────────────────────────────────────────
-- shopify_products  (products_export_1.csv — one row per variant)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists {{schema}}.shopify_products (
  id              bigserial primary key,
  handle          text,
  title           text,
  body_html       text,
  vendor          text,
  product_category text,
  type            text,
  tags            text,
  published       text,
  variant_sku     text,
  variant_grams   numeric,
  variant_inventory_policy text,
  variant_fulfillment_service text,
  variant_price   numeric(18,2),
  variant_compare_at_price numeric(18,2),
  variant_requires_shipping text,
  variant_taxable text,
  variant_barcode text,
  image_src       text,
  image_position  integer,
  image_alt_text  text,
  seo_title       text,
  seo_description text,
  status          text,
  uk_included     text,
  uk_price        numeric(18,2),
  uk_compare_at_price numeric(18,2),
  loaded_at       timestamptz default now()
);
create index if not exists ix_products_handle on {{schema}}.shopify_products (handle);
create index if not exists ix_products_sku    on {{schema}}.shopify_products (variant_sku);

-- ─────────────────────────────────────────────────────────────────────────
-- klaviyo_campaigns  (Klaviyo Campaigns export — 321 rows)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists {{schema}}.klaviyo_campaigns (
  campaign_id            text primary key,
  campaign_name          text not null,
  variant_name           text,
  tags                   text,
  subject                text,
  list                   text,
  send_time              timestamptz,
  send_weekday           text,
  total_recipients       integer,
  unique_placed_order    integer,
  placed_order_rate      numeric(8,4),
  revenue                numeric(18,2),
  unique_opens           integer,
  open_rate              numeric(8,4),
  total_opens            integer,
  unique_clicks          integer,
  click_rate             numeric(8,4),
  total_clicks           integer,
  unsubscribes           integer,
  spam_complaints        integer,
  spam_complaints_rate   numeric(8,4),
  successful_deliveries  integer,
  bounces                integer,
  bounce_rate            numeric(8,4),
  campaign_channel       text,
  winning_variant        text,
  loaded_at              timestamptz default now()
);
create index if not exists ix_kc_send_time on {{schema}}.klaviyo_campaigns (send_time);
create index if not exists ix_kc_channel   on {{schema}}.klaviyo_campaigns (campaign_channel);

-- ─────────────────────────────────────────────────────────────────────────
-- klaviyo_flow_events  (Klaviyo Flows export — 720K rows, per-event)
--
-- The original file has a header line "Flow Analytics for KNICKGASM® India"
-- on row 1 and the real header on row 2 — ingest-uploads.js strips the
-- preamble before COPY.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists {{schema}}.klaviyo_flow_events (
  id              bigserial primary key,
  flow_id         text,
  flow_name       text,
  message_id      text,
  message_name    text,
  send_time       timestamptz,
  channel         text,                  -- email | sms
  recipients      integer,
  opens           integer,
  clicks          integer,
  unsubscribes    integer,
  spam_complaints integer,
  bounces         integer,
  conversions     integer,
  revenue         numeric(18,2),
  metric          text,                  -- if file is metric-per-row format
  metric_value    numeric(18,4),
  raw             jsonb,                 -- fallback bucket for any extra columns
  loaded_at       timestamptz default now()
);
create index if not exists ix_kf_flow on {{schema}}.klaviyo_flow_events (flow_id);
create index if not exists ix_kf_time on {{schema}}.klaviyo_flow_events (send_time);

-- ─────────────────────────────────────────────────────────────────────────
-- webengage_users  (WebEngage user export — 129K rows)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists {{schema}}.webengage_users (
  user_id               text primary key,
  user_type             text,
  name                  text,
  email                 text,
  phone                 text,
  hashed_email          text,
  hashed_phone          text,
  gender                text,
  company               text,
  date_of_birth         date,
  country               text,
  region                text,
  city                  text,
  locality              text,
  postal_code           text,
  latitude              numeric,
  longitude             numeric,
  time_zone_offset      text,
  time_zone_name        text,
  unsubscribed_email    boolean,
  email_valid           boolean,
  unsubscribed_sms      boolean,
  phone_valid           boolean,
  created_on            timestamptz,
  last_seen             timestamptz,
  first_logged_in       timestamptz,
  last_logged_in        timestamptz,
  total_sessions        integer,
  total_time_seconds    integer,
  acq_channel           text,
  acq_campaign_source   text,
  acq_campaign_medium   text,
  acq_campaign_name     text,
  acq_referrer_host     text,
  acq_referrer_url      text,
  acq_landing_page      text,
  loaded_at             timestamptz default now()
);
create index if not exists ix_we_email   on {{schema}}.webengage_users (lower(email));
create index if not exists ix_we_country on {{schema}}.webengage_users (country);

-- ─────────────────────────────────────────────────────────────────────────
-- Convenience analytical views the dashboard reads
-- ─────────────────────────────────────────────────────────────────────────
create or replace view {{schema}}.v_customers_by_region as
select
  coalesce(default_address_country_code, 'Unknown') as region,
  count(*)                                          as customers,
  sum(total_spent)                                  as revenue,
  sum(total_orders)                                 as orders
from {{schema}}.shopify_customers
group by 1
order by revenue desc nulls last;

create or replace view {{schema}}.v_orders_daily as
select
  date_trunc('day', created_at)::date as order_date,
  coalesce(shipping_country, 'Unknown') as region,
  count(distinct order_name)            as orders,
  sum(total)                            as revenue,
  avg(total)                            as aov,
  sum(lineitem_quantity)                as units
from {{schema}}.shopify_orders_lines
where created_at is not null
group by 1, 2
order by order_date desc;

create or replace view {{schema}}.v_campaign_performance as
select
  campaign_channel,
  date_trunc('week', send_time)::date as week,
  count(*)                            as campaigns,
  sum(total_recipients)               as sends,
  sum(unique_opens)                   as opens,
  sum(unique_clicks)                  as clicks,
  sum(unique_placed_order)            as orders,
  sum(revenue)                        as revenue,
  case when sum(total_recipients) > 0 then sum(unique_opens)::numeric  / sum(total_recipients) end as open_rate,
  case when sum(unique_opens) > 0    then sum(unique_clicks)::numeric / sum(unique_opens)     end as ctr,
  case when sum(unique_clicks) > 0   then sum(unique_placed_order)::numeric / sum(unique_clicks) end as cvr
from {{schema}}.klaviyo_campaigns
where send_time is not null
group by 1, 2
order by week desc, revenue desc;
