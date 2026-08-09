-- KNICKGASM DTC DuckDB DDL
-- 4 schemas, 46 tables

-- ─────────────────────────────────────────────
-- SCHEMA 1: matrixify (Shopify raw via Matrixify)
-- ─────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS matrixify;

CREATE TABLE IF NOT EXISTS matrixify.smart_collections (
    id VARCHAR PRIMARY KEY,
    handle VARCHAR,
    title VARCHAR,
    body_html TEXT,
    published_at TIMESTAMP,
    updated_at TIMESTAMP,
    rules JSON,
    disjunctive BOOLEAN,
    sort_order VARCHAR,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.custom_collections (
    id VARCHAR PRIMARY KEY,
    handle VARCHAR,
    title VARCHAR,
    body_html TEXT,
    published_at TIMESTAMP,
    updated_at TIMESTAMP,
    sort_order VARCHAR,
    image JSON,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.customers (
    id VARCHAR PRIMARY KEY,
    email VARCHAR,
    first_name VARCHAR,
    last_name VARCHAR,
    phone VARCHAR,
    verified_email BOOLEAN,
    tax_exempt BOOLEAN,
    tags VARCHAR,
    currency VARCHAR,
    accepts_marketing BOOLEAN,
    accepts_marketing_updated_at TIMESTAMP,
    marketing_opt_in_level VARCHAR,
    state VARCHAR,
    note TEXT,
    addresses JSON,
    default_address JSON,
    orders_count INTEGER,
    total_spent DECIMAL(18,2),
    last_order_id VARCHAR,
    last_order_name VARCHAR,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.companies (
    id VARCHAR PRIMARY KEY,
    name VARCHAR,
    external_id VARCHAR,
    note TEXT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    locations JSON,
    contacts JSON,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.discounts (
    id VARCHAR PRIMARY KEY,
    title VARCHAR,
    code VARCHAR,
    discount_type VARCHAR,
    value DECIMAL(18,2),
    value_type VARCHAR,
    target_type VARCHAR,
    target_selection VARCHAR,
    allocation_method VARCHAR,
    once_per_customer BOOLEAN,
    usage_limit INTEGER,
    times_used INTEGER,
    starts_at TIMESTAMP,
    ends_at TIMESTAMP,
    status VARCHAR,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.draft_orders (
    id VARCHAR PRIMARY KEY,
    name VARCHAR,
    status VARCHAR,
    customer_id VARCHAR,
    email VARCHAR,
    total_price DECIMAL(18,2),
    subtotal_price DECIMAL(18,2),
    total_tax DECIMAL(18,2),
    total_discounts DECIMAL(18,2),
    currency VARCHAR,
    line_items JSON,
    shipping_address JSON,
    billing_address JSON,
    applied_discount JSON,
    note TEXT,
    tags VARCHAR,
    invoice_url VARCHAR,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    completed_at TIMESTAMP,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.orders (
    id VARCHAR PRIMARY KEY,
    name VARCHAR,
    email VARCHAR,
    phone VARCHAR,
    customer_id VARCHAR,
    financial_status VARCHAR,
    fulfillment_status VARCHAR,
    currency VARCHAR,
    total_price DECIMAL(18,2),
    subtotal_price DECIMAL(18,2),
    total_discounts DECIMAL(18,2),
    total_tax DECIMAL(18,2),
    total_shipping DECIMAL(18,2),
    total_refunds DECIMAL(18,2),
    net_payment DECIMAL(18,2),
    billing_address JSON,
    shipping_address JSON,
    shipping_country VARCHAR,
    shipping_country_code VARCHAR,
    line_items JSON,
    discount_codes JSON,
    refunds JSON,
    fulfillments JSON,
    transactions JSON,
    tags VARCHAR,
    note TEXT,
    source_name VARCHAR,
    landing_site VARCHAR,
    referring_site VARCHAR,
    utm_source VARCHAR,
    utm_medium VARCHAR,
    utm_campaign VARCHAR,
    utm_content VARCHAR,
    utm_term VARCHAR,
    cancelled_at TIMESTAMP,
    cancel_reason VARCHAR,
    closed_at TIMESTAMP,
    processed_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    customer_orders_count INTEGER,
    customer_total_spent DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.order_line_items (
    id VARCHAR PRIMARY KEY,
    order_id VARCHAR,
    product_id VARCHAR,
    variant_id VARCHAR,
    sku VARCHAR,
    title VARCHAR,
    variant_title VARCHAR,
    product_type VARCHAR,
    vendor VARCHAR,
    quantity INTEGER,
    price DECIMAL(18,2),
    total_discount DECIMAL(18,2),
    tax_lines JSON,
    properties JSON,
    requires_shipping BOOLEAN,
    taxable BOOLEAN,
    gift_card BOOLEAN,
    variant_cost DECIMAL(18,2),
    fulfillment_status VARCHAR,
    fulfillment_service VARCHAR,
    grams INTEGER,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.payouts (
    id VARCHAR PRIMARY KEY,
    date DATE,
    currency VARCHAR,
    amount DECIMAL(18,2),
    status VARCHAR,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.payout_transactions (
    id VARCHAR PRIMARY KEY,
    payout_id VARCHAR,
    type VARCHAR,
    amount DECIMAL(18,2),
    fee DECIMAL(18,2),
    net DECIMAL(18,2),
    currency VARCHAR,
    processed_at TIMESTAMP,
    source_id VARCHAR,
    source_type VARCHAR,
    source_order_id VARCHAR,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.pages (
    id VARCHAR PRIMARY KEY,
    handle VARCHAR,
    title VARCHAR,
    body_html TEXT,
    author VARCHAR,
    shop_id VARCHAR,
    published_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    template_suffix VARCHAR,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.blog_posts (
    id VARCHAR PRIMARY KEY,
    handle VARCHAR,
    title VARCHAR,
    body_html TEXT,
    summary_html TEXT,
    author VARCHAR,
    blog_id VARCHAR,
    blog_title VARCHAR,
    tags VARCHAR,
    image JSON,
    metafields JSON,
    published_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.products (
    id VARCHAR PRIMARY KEY,
    handle VARCHAR,
    title VARCHAR,
    body_html TEXT,
    vendor VARCHAR,
    product_type VARCHAR,
    tags VARCHAR,
    status VARCHAR,
    images JSON,
    options JSON,
    metafields JSON,
    published_at TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.product_variants (
    id VARCHAR PRIMARY KEY,
    product_id VARCHAR,
    sku VARCHAR,
    title VARCHAR,
    option1 VARCHAR,
    option2 VARCHAR,
    option3 VARCHAR,
    price DECIMAL(18,2),
    compare_at_price DECIMAL(18,2),
    cost DECIMAL(18,2),
    inventory_quantity INTEGER,
    inventory_management VARCHAR,
    inventory_policy VARCHAR,
    fulfillment_service VARCHAR,
    requires_shipping BOOLEAN,
    taxable BOOLEAN,
    barcode VARCHAR,
    weight DOUBLE,
    weight_unit VARCHAR,
    image_id VARCHAR,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.redirects (
    id VARCHAR PRIMARY KEY,
    path VARCHAR,
    target VARCHAR,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.activity (
    id VARCHAR PRIMARY KEY,
    subject_type VARCHAR,
    subject_id VARCHAR,
    verb VARCHAR,
    body TEXT,
    created_at TIMESTAMP,
    author VARCHAR,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.files (
    id VARCHAR PRIMARY KEY,
    filename VARCHAR,
    url VARCHAR,
    content_type VARCHAR,
    size INTEGER,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.metaobjects (
    id VARCHAR PRIMARY KEY,
    handle VARCHAR,
    type VARCHAR,
    display_name VARCHAR,
    fields JSON,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.menus (
    id VARCHAR PRIMARY KEY,
    handle VARCHAR,
    title VARCHAR,
    items JSON,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS matrixify.shop (
    id VARCHAR PRIMARY KEY,
    name VARCHAR,
    email VARCHAR,
    domain VARCHAR,
    myshopify_domain VARCHAR,
    currency VARCHAR,
    timezone VARCHAR,
    country_code VARCHAR,
    plan_name VARCHAR,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

-- ─────────────────────────────────────────────
-- SCHEMA 2: shopify_analytics (Aggregated reports)
-- ─────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS shopify_analytics;

CREATE TABLE IF NOT EXISTS shopify_analytics.revenue_metrics (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    gross_sales DECIMAL(18,2),
    discounts DECIMAL(18,2),
    returns DECIMAL(18,2),
    net_sales DECIMAL(18,2),
    shipping DECIMAL(18,2),
    taxes DECIMAL(18,2),
    total_sales DECIMAL(18,2),
    orders_count INTEGER,
    aov DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.orders_by_status (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    financial_status VARCHAR,
    fulfillment_status VARCHAR,
    order_count INTEGER,
    total_value DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.traffic_metrics (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    sessions INTEGER,
    unique_visitors INTEGER,
    page_views INTEGER,
    bounce_rate DOUBLE,
    avg_session_duration DOUBLE,
    pages_per_session DOUBLE,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.conversion_funnel (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    sessions INTEGER,
    added_to_cart INTEGER,
    reached_checkout INTEGER,
    sessions_converted INTEGER,
    add_to_cart_rate DOUBLE,
    checkout_rate DOUBLE,
    conversion_rate DOUBLE,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.acquisition_metrics (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    channel VARCHAR,
    source VARCHAR,
    medium VARCHAR,
    sessions INTEGER,
    new_visitors INTEGER,
    orders INTEGER,
    revenue DECIMAL(18,2),
    conversion_rate DOUBLE,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.device_metrics (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    device_type VARCHAR,
    sessions INTEGER,
    orders INTEGER,
    revenue DECIMAL(18,2),
    conversion_rate DOUBLE,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.geography_metrics (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    country_code VARCHAR,
    country_name VARCHAR,
    sessions INTEGER,
    orders INTEGER,
    revenue DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.customer_metrics (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    new_customers INTEGER,
    returning_customers INTEGER,
    total_customers INTEGER,
    new_customer_revenue DECIMAL(18,2),
    returning_customer_revenue DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.customer_cohorts (
    id VARCHAR PRIMARY KEY,
    cohort_month DATE,
    months_since_first_order INTEGER,
    customers_retained INTEGER,
    retention_rate DOUBLE,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.product_performance (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    product_id VARCHAR,
    product_title VARCHAR,
    variant_sku VARCHAR,
    units_sold INTEGER,
    gross_sales DECIMAL(18,2),
    discounts DECIMAL(18,2),
    net_sales DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.collection_performance (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    collection_id VARCHAR,
    collection_title VARCHAR,
    sessions INTEGER,
    orders INTEGER,
    revenue DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.marketing_attribution (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    channel VARCHAR,
    campaign_name VARCHAR,
    spend DECIMAL(18,2),
    impressions INTEGER,
    clicks INTEGER,
    sessions INTEGER,
    orders INTEGER,
    attributed_sales DECIMAL(18,2),
    new_customers INTEGER,
    roas DOUBLE,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS shopify_analytics.discount_usage (
    id VARCHAR PRIMARY KEY,
    report_date DATE,
    report_period VARCHAR,
    discount_code VARCHAR,
    discount_type VARCHAR,
    times_used INTEGER,
    total_discount_amount DECIMAL(18,2),
    orders_count INTEGER,
    total_order_value DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

-- ─────────────────────────────────────────────
-- SCHEMA 3: klaviyo (Email/SMS platform)
-- ─────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS klaviyo;

CREATE TABLE IF NOT EXISTS klaviyo.profiles (
    profile_id VARCHAR PRIMARY KEY,
    email VARCHAR,
    phone_number VARCHAR,
    first_name VARCHAR,
    last_name VARCHAR,
    city VARCHAR,
    region VARCHAR,
    country VARCHAR,
    timezone VARCHAR,
    source VARCHAR,
    subscriptions JSON,
    consent_status VARCHAR,
    email_subscribed BOOLEAN,
    sms_subscribed BOOLEAN,
    created TIMESTAMP,
    updated TIMESTAMP,
    -- Predictive analytics fields
    predicted_clv_1y DECIMAL(18,2),
    predicted_clv_lifetime DECIMAL(18,2),
    churn_risk VARCHAR,
    predicted_gender VARCHAR,
    average_days_between_orders DOUBLE,
    average_order_value DECIMAL(18,2),
    total_revenue DECIMAL(18,2),
    expected_date_of_next_order TIMESTAMP,
    historic_clv DECIMAL(18,2),
    historic_number_of_orders INTEGER,
    -- Custom properties
    custom_properties JSON,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS klaviyo.profile_growth (
    id VARCHAR PRIMARY KEY,
    date DATE,
    list_id VARCHAR,
    subscribed INTEGER,
    unsubscribed INTEGER,
    net_growth INTEGER,
    total_active INTEGER,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS klaviyo.campaigns (
    campaign_id VARCHAR PRIMARY KEY,
    name VARCHAR,
    channel VARCHAR,
    status VARCHAR,
    subject VARCHAR,
    preview_text VARCHAR,
    from_email VARCHAR,
    from_name VARCHAR,
    send_time TIMESTAMP,
    sent_at TIMESTAMP,
    created TIMESTAMP,
    updated TIMESTAMP,
    -- Metrics
    recipients INTEGER,
    delivered INTEGER,
    opens INTEGER,
    unique_opens INTEGER,
    clicks INTEGER,
    unique_clicks INTEGER,
    unsubscribes INTEGER,
    bounces INTEGER,
    spam_complaints INTEGER,
    -- Revenue
    revenue_attributed DECIMAL(18,2),
    conversion_rate DOUBLE,
    -- Rates
    open_rate DOUBLE,
    click_rate DOUBLE,
    unsubscribe_rate DOUBLE,
    bounce_rate DOUBLE,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS klaviyo.flows (
    flow_id VARCHAR PRIMARY KEY,
    name VARCHAR,
    status VARCHAR,
    trigger_type VARCHAR,
    created TIMESTAMP,
    updated TIMESTAMP,
    -- Aggregate metrics (all time)
    recipients INTEGER,
    delivered INTEGER,
    opens INTEGER,
    clicks INTEGER,
    unsubscribes INTEGER,
    revenue_attributed DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS klaviyo.sms_metrics (
    id VARCHAR PRIMARY KEY,
    date DATE,
    campaign_id VARCHAR,
    flow_id VARCHAR,
    sent INTEGER,
    delivered INTEGER,
    opens INTEGER,
    clicks INTEGER,
    unsubscribes INTEGER,
    revenue_attributed DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS klaviyo.lists (
    list_id VARCHAR PRIMARY KEY,
    name VARCHAR,
    created TIMESTAMP,
    updated TIMESTAMP,
    profile_count INTEGER,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS klaviyo.segments (
    segment_id VARCHAR PRIMARY KEY,
    name VARCHAR,
    definition JSON,
    is_dynamic BOOLEAN,
    created TIMESTAMP,
    updated TIMESTAMP,
    profile_count INTEGER,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS klaviyo.events (
    event_id VARCHAR PRIMARY KEY,
    profile_id VARCHAR,
    metric_id VARCHAR,
    metric_name VARCHAR,
    timestamp TIMESTAMP,
    value DECIMAL(18,2),
    event_properties JSON,
    uuid VARCHAR,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS klaviyo.deliverability (
    id VARCHAR PRIMARY KEY,
    date DATE,
    channel VARCHAR,
    sent INTEGER,
    delivered INTEGER,
    bounced_hard INTEGER,
    bounced_soft INTEGER,
    spam_rate DOUBLE,
    delivery_rate DOUBLE,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

-- ─────────────────────────────────────────────
-- SCHEMA 4: webengage (CDP events)
-- ─────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS webengage;

CREATE TABLE IF NOT EXISTS webengage.user_profiles (
    user_id VARCHAR PRIMARY KEY,
    we_id VARCHAR,
    first_name VARCHAR,
    last_name VARCHAR,
    email VARCHAR,
    phone VARCHAR,
    gender VARCHAR,
    birth_date DATE,
    city VARCHAR,
    region VARCHAR,
    country VARCHAR,
    country_code VARCHAR,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    first_seen TIMESTAMP,
    last_seen TIMESTAMP,
    opt_in_email BOOLEAN,
    opt_in_sms BOOLEAN,
    opt_in_push BOOLEAN,
    opt_in_whatsapp BOOLEAN,
    total_revenue DECIMAL(18,2),
    total_orders INTEGER,
    avg_order_value DECIMAL(18,2),
    last_order_date TIMESTAMP,
    custom_attributes JSON,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS webengage.events (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR,
    we_id VARCHAR,
    event_name VARCHAR,
    event_time TIMESTAMP,
    channel VARCHAR,
    platform VARCHAR,
    device_type VARCHAR,
    city VARCHAR,
    country VARCHAR,
    country_code VARCHAR,
    session_id VARCHAR,
    experiment_id VARCHAR,
    campaign_id VARCHAR,
    event_properties JSON,
    line_items JSON,
    revenue DECIMAL(18,2),
    currency VARCHAR,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS webengage.event_summary (
    id VARCHAR PRIMARY KEY,
    summary_date DATE,
    event_name VARCHAR,
    channel VARCHAR,
    event_count INTEGER,
    unique_users INTEGER,
    total_revenue DECIMAL(18,2),
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);

CREATE TABLE IF NOT EXISTS webengage.revenue_mapping (
    id VARCHAR PRIMARY KEY,
    we_event_id VARCHAR,
    shopify_order_id VARCHAR,
    user_id VARCHAR,
    event_time TIMESTAMP,
    revenue DECIMAL(18,2),
    currency VARCHAR,
    match_type VARCHAR,
    matched_at TIMESTAMP,
    _loaded_at TIMESTAMP DEFAULT current_timestamp
);
