"""Generate realistic sample CSV data for all 4 KNICKGASM DTC data sources."""

import os, random, json, hashlib
from datetime import datetime, timedelta
import pandas as pd

BASE = r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine"
random.seed(42)

# ── helpers ──────────────────────────────────────────────────────────────────
def fake_id(prefix="", n=10):
    return prefix + str(random.randint(10**(n-1), 10**n - 1))

def rand_date(start="2023-01-01", end="2025-03-31"):
    s = datetime.strptime(start, "%Y-%m-%d")
    e = datetime.strptime(end,   "%Y-%m-%d")
    return s + timedelta(seconds=random.randint(0, int((e-s).total_seconds())))

COUNTRIES = [("US","US",0.45),("GB","UK",0.30),("IN","IN",0.05),("AU","RoW",0.07),
             ("CA","RoW",0.08),("DE","RoW",0.05)]
UTM_SOURCES = ["google","meta","email","organic","direct","influencer","affiliate"]
PRODUCT_TYPES = ["Green Sneaker","Black Sneaker","Themed Sneaker","Streetwear Sneaker","Gift Sets"]
VENDORS = ["KNICKGASM","KNICKGASM Colorways"]

PRODUCTS = [
    ("p1001","original-hand-painted-kicks","Original Hand-painted Kicks",  "Green Sneaker",  12.99, 3.20),
    ("p1002","signature-green-sneaker",  "Signature Green Sneaker",   "Green Sneaker",  14.99, 3.80),
    ("p1003","embroidery-spice-themed","Embroidery Spice Themed", "Themed Sneaker", 16.99, 4.10),
    ("p1004","airforce-classic-black",  "Airforce Classic Black",   "Black Sneaker",  11.99, 2.90),
    ("p1005","immunity-boost-colorway", "Immunity Boost Colorway",  "Streetwear Sneaker",18.99,4.50),
    ("p1006","earl-grey-supreme",    "Earl Grey Supreme",     "Black Sneaker",  13.99, 3.30),
    ("p1007","rose-green-sneaker",       "Rose Green Sneaker",        "Green Sneaker",  15.99, 3.90),
    ("p1008","sleep-well-colorway",     "Sleep Well Colorway",      "Themed Sneaker", 17.99, 4.30),
    ("p1009","gift-set-premium",     "Premium Gift Set",      "Gift Sets",  39.99, 9.80),
    ("p1010","neon-lemon-themed",  "Neon Lemon Themed",   "Themed Sneaker", 14.99, 3.60),
]

# ── 1. MATRIXIFY ──────────────────────────────────────────────────────────────
print("Generating matrixify data...")

# customers
n_cust = 3000
customer_ids = [fake_id("cust") for _ in range(n_cust)]
cust_emails   = [f"user{i}@example.com" for i in range(n_cust)]
cust_countries = [random.choices([c[0] for c in COUNTRIES], weights=[c[2] for c in COUNTRIES])[0]
                  for _ in range(n_cust)]
cust_created  = [rand_date("2022-01-01","2025-01-01") for _ in range(n_cust)]

customers_df = pd.DataFrame({
    "id": customer_ids,
    "email": cust_emails,
    "first_name": [random.choice(["Alice","Bob","Carol","David","Eve","Frank","Grace","Hank","Iris","Jake"]) for _ in range(n_cust)],
    "last_name":  [random.choice(["Smith","Jones","Patel","Kim","Chen","Brown","Wilson","Taylor","Lee","White"]) for _ in range(n_cust)],
    "phone": [f"+1555{random.randint(1000000,9999999)}" for _ in range(n_cust)],
    "verified_email": True,
    "tax_exempt": False,
    "tags": "",
    "currency": "USD",
    "accepts_marketing": [random.random() > 0.3 for _ in range(n_cust)],
    "accepts_marketing_updated_at": cust_created,
    "marketing_opt_in_level": "single_opt_in",
    "state": "enabled",
    "note": "",
    "addresses": "[]",
    "default_address": "{}",
    "orders_count": 0,
    "total_spent": 0.0,
    "last_order_id": "",
    "last_order_name": "",
    "created_at": cust_created,
    "updated_at": cust_created,
})
customers_df.to_csv(os.path.join(BASE,"data","matrixify","customers.csv"), index=False)
print(f"  customers: {len(customers_df)} rows")

# orders + order_line_items
orders_rows = []
oli_rows    = []
order_id_counter = 5000000

for i, cid in enumerate(customer_ids):
    n_orders = random.choices([1,2,3,4,5,6],[0.35,0.25,0.18,0.10,0.07,0.05])[0]
    order_dates = sorted([rand_date("2023-01-01","2025-03-31") for _ in range(n_orders)])

    for order_num, odate in enumerate(order_dates):
        oid = str(order_id_counter); order_id_counter += 1
        country_code = cust_countries[i]
        utm_src = random.choice(UTM_SOURCES)
        n_items = random.randint(1, 3)
        chosen_products = random.sample(PRODUCTS, min(n_items, len(PRODUCTS)))

        line_total = 0.0
        for prod in chosen_products:
            pid, handle, title, ptype, price, cost = prod
            qty = random.randint(1, 2)
            is_sub = random.random() < 0.20
            props = json.dumps([{"name":"frequency","value":"monthly"}]) if is_sub else "[]"
            li_id = fake_id("li")
            oli_rows.append({
                "id": li_id, "order_id": oid,
                "product_id": pid, "variant_id": fake_id("var"),
                "sku": f"VHD-{pid[1:]}", "title": title,
                "variant_title": "100g",
                "product_type": ptype, "vendor": "KNICKGASM",
                "quantity": qty, "price": price,
                "total_discount": round(price * qty * (0.1 if random.random() < 0.2 else 0), 2),
                "tax_lines": "[]", "properties": props,
                "requires_shipping": True, "taxable": True,
                "gift_card": False, "variant_cost": cost,
                "fulfillment_status": "fulfilled", "fulfillment_service": "manual",
                "grams": 200,
            })
            line_total += price * qty

        discount_amt = round(line_total * 0.1, 2) if random.random() < 0.25 else 0.0
        shipping = round(random.uniform(4.99, 12.99), 2) if random.random() > 0.3 else 0.0
        tax = round((line_total - discount_amt) * 0.08, 2)
        total = round(line_total - discount_amt + shipping + tax, 2)

        orders_rows.append({
            "id": oid, "name": f"#ORD{oid}",
            "email": cust_emails[i],
            "phone": "",
            "customer_id": cid,
            "financial_status": random.choices(["paid","refunded","pending"],[0.92,0.05,0.03])[0],
            "fulfillment_status": "fulfilled",
            "currency": "USD",
            "total_price": total,
            "subtotal_price": round(line_total, 2),
            "total_discounts": discount_amt,
            "total_tax": tax,
            "total_shipping": shipping,
            "total_refunds": 0.0,
            "net_payment": total,
            "billing_address": "{}",
            "shipping_address": "{}",
            "shipping_country": country_code,
            "shipping_country_code": country_code,
            "line_items": "[]",
            "discount_codes": "[]",
            "refunds": "[]",
            "fulfillments": "[]",
            "transactions": "[]",
            "tags": "",
            "note": "",
            "source_name": "web",
            "landing_site": "/collections/all",
            "referring_site": f"https://{utm_src}.com",
            "utm_source": utm_src,
            "utm_medium": random.choice(["cpc","email","social","organic",""]),
            "utm_campaign": f"camp_{random.randint(1,20)}",
            "utm_content": "",
            "utm_term": "",
            "cancelled_at": None,
            "cancel_reason": None,
            "closed_at": odate,
            "processed_at": odate,
            "created_at": odate,
            "updated_at": odate,
            "customer_orders_count": order_num + 1,
            "customer_total_spent": round(total * (order_num + 1) * 0.8, 2),
        })

orders_df = pd.DataFrame(orders_rows)
orders_df.to_csv(os.path.join(BASE,"data","matrixify","orders.csv"), index=False)
print(f"  orders: {len(orders_df)} rows")

oli_df = pd.DataFrame(oli_rows)
oli_df.to_csv(os.path.join(BASE,"data","matrixify","order_line_items.csv"), index=False)
print(f"  order_line_items: {len(oli_df)} rows")

# products
prod_df = pd.DataFrame([{
    "id": p[0], "handle": p[1], "title": p[2],
    "body_html": f"<p>{p[2]} — premium quality from India</p>",
    "vendor": "KNICKGASM", "product_type": p[3],
    "tags": "sneaker,premium", "status": "active",
    "images": "[]", "options": "[]", "metafields": "[]",
    "published_at": "2022-01-15 00:00:00",
    "created_at": "2022-01-15 00:00:00",
    "updated_at": "2024-01-01 00:00:00",
} for p in PRODUCTS])
prod_df.to_csv(os.path.join(BASE,"data","matrixify","products.csv"), index=False)
print(f"  products: {len(prod_df)} rows")

# product_variants
variants = []
for p in PRODUCTS:
    for size, mult in [("50g",0.6),("100g",1.0),("200g",1.8)]:
        variants.append({
            "id": fake_id("v"), "product_id": p[0],
            "sku": f"VHD-{p[0][1:]}-{size}",
            "title": size, "option1": size,
            "option2": None, "option3": None,
            "price": round(p[4]*mult, 2),
            "compare_at_price": round(p[4]*mult*1.15, 2),
            "cost": round(p[5]*mult, 2),
            "inventory_quantity": random.randint(50, 500),
            "inventory_management": "shopify",
            "inventory_policy": "deny",
            "fulfillment_service": "manual",
            "requires_shipping": True, "taxable": True,
            "barcode": f"890{random.randint(100000000,999999999)}",
            "weight": float(size.replace("g","")),
            "weight_unit": "g", "image_id": None,
            "created_at": "2022-01-15 00:00:00",
            "updated_at": "2024-01-01 00:00:00",
        })
pd.DataFrame(variants).to_csv(os.path.join(BASE,"data","matrixify","product_variants.csv"), index=False)
print(f"  product_variants: {len(variants)} rows")

# discounts
disc_df = pd.DataFrame([{
    "id": fake_id("disc"), "title": f"SAVE{pct}", "code": f"KNICKGASM{pct}",
    "discount_type": "percentage", "value": pct, "value_type": "percentage",
    "target_type": "line_item", "target_selection": "all",
    "allocation_method": "across", "once_per_customer": False,
    "usage_limit": None, "times_used": random.randint(50, 500),
    "starts_at": "2023-01-01 00:00:00", "ends_at": "2025-12-31 00:00:00",
    "status": "active", "created_at": "2023-01-01 00:00:00",
    "updated_at": "2024-01-01 00:00:00",
} for pct in [10,15,20,25]])
disc_df.to_csv(os.path.join(BASE,"data","matrixify","discounts.csv"), index=False)
print(f"  discounts: {len(disc_df)} rows")

# ── 2. SHOPIFY ANALYTICS ──────────────────────────────────────────────────────
print("Generating shopify_analytics data...")

months = pd.date_range("2023-01-01","2025-03-01", freq="MS")

# revenue_metrics
rev_rows = []
for m in months:
    gross = round(random.uniform(80000,180000), 2)
    disc  = round(gross * random.uniform(0.08,0.15), 2)
    ret   = round(gross * random.uniform(0.01,0.04), 2)
    net   = round(gross - disc - ret, 2)
    ship  = round(gross * 0.05, 2)
    tax   = round(net * 0.08, 2)
    orders = random.randint(800,2200)
    rev_rows.append({
        "id": hashlib.md5(f"rev_{m}".encode()).hexdigest(),
        "report_date": m.date(),
        "report_period": "monthly",
        "gross_sales": gross,
        "discounts": disc,
        "returns": ret,
        "net_sales": net,
        "shipping": ship,
        "taxes": tax,
        "total_sales": round(net + ship + tax, 2),
        "orders_count": orders,
        "aov": round(net / orders, 2),
    })
pd.DataFrame(rev_rows).to_csv(os.path.join(BASE,"data","shopify_analytics","revenue_metrics.csv"), index=False)

# acquisition_metrics
acq_rows = []
for m in months:
    for src in UTM_SOURCES:
        sessions = random.randint(1000, 15000)
        visitors = int(sessions * random.uniform(0.4, 0.7))
        orders   = int(sessions * random.uniform(0.01, 0.05))
        revenue  = round(orders * random.uniform(40, 90), 2)
        acq_rows.append({
            "id": hashlib.md5(f"acq_{m}_{src}".encode()).hexdigest(),
            "report_date": m.date(), "report_period": "monthly",
            "channel": src, "source": src, "medium": "cpc",
            "sessions": sessions, "new_visitors": visitors,
            "orders": orders, "revenue": revenue,
            "conversion_rate": round(orders/sessions, 4),
        })
pd.DataFrame(acq_rows).to_csv(os.path.join(BASE,"data","shopify_analytics","acquisition_metrics.csv"), index=False)

# marketing_attribution
ma_rows = []
for m in months:
    for ch in ["google","meta","email","influencer"]:
        spend = round(random.uniform(2000,15000), 2)
        impr  = random.randint(50000,500000)
        clicks= random.randint(1000,20000)
        orders= random.randint(50,400)
        sales = round(orders * random.uniform(45,95), 2)
        new_c = int(orders * random.uniform(0.4,0.7))
        ma_rows.append({
            "id": hashlib.md5(f"ma_{m}_{ch}".encode()).hexdigest(),
            "report_date": m.date(), "report_period": "monthly",
            "channel": ch, "campaign_name": f"{ch}_brand_{m.strftime('%Y%m')}",
            "spend": spend, "impressions": impr, "clicks": clicks,
            "sessions": clicks, "orders": orders,
            "attributed_sales": sales, "new_customers": new_c,
            "roas": round(sales/spend, 2),
        })
pd.DataFrame(ma_rows).to_csv(os.path.join(BASE,"data","shopify_analytics","marketing_attribution.csv"), index=False)

# conversion_funnel
cf_rows = []
for m in months:
    sess = random.randint(30000,80000)
    atc  = int(sess * random.uniform(0.10,0.20))
    chk  = int(atc  * random.uniform(0.50,0.75))
    conv = int(chk  * random.uniform(0.55,0.80))
    cf_rows.append({
        "id": hashlib.md5(f"cf_{m}".encode()).hexdigest(),
        "report_date": m.date(), "report_period": "monthly",
        "sessions": sess, "added_to_cart": atc,
        "reached_checkout": chk, "sessions_converted": conv,
        "add_to_cart_rate": round(atc/sess, 4),
        "checkout_rate": round(chk/atc, 4),
        "conversion_rate": round(conv/sess, 4),
    })
pd.DataFrame(cf_rows).to_csv(os.path.join(BASE,"data","shopify_analytics","conversion_funnel.csv"), index=False)

# customer_metrics
cm_rows = []
for m in months:
    new_c = random.randint(300,900)
    ret_c = random.randint(200,600)
    cm_rows.append({
        "id": hashlib.md5(f"cm_{m}".encode()).hexdigest(),
        "report_date": m.date(), "report_period": "monthly",
        "new_customers": new_c, "returning_customers": ret_c,
        "total_customers": new_c + ret_c,
        "new_customer_revenue": round(new_c * random.uniform(50,90), 2),
        "returning_customer_revenue": round(ret_c * random.uniform(60,120), 2),
    })
pd.DataFrame(cm_rows).to_csv(os.path.join(BASE,"data","shopify_analytics","customer_metrics.csv"), index=False)

# traffic_metrics
tr_rows = []
for m in months:
    sess = random.randint(30000,80000)
    tr_rows.append({
        "id": hashlib.md5(f"tr_{m}".encode()).hexdigest(),
        "report_date": m.date(), "report_period": "monthly",
        "sessions": sess,
        "unique_visitors": int(sess*0.8),
        "page_views": int(sess*2.5),
        "bounce_rate": round(random.uniform(0.30,0.55),3),
        "avg_session_duration": round(random.uniform(90,240),1),
        "pages_per_session": round(random.uniform(2.0,4.5),2),
    })
pd.DataFrame(tr_rows).to_csv(os.path.join(BASE,"data","shopify_analytics","traffic_metrics.csv"), index=False)

print(f"  shopify_analytics: revenue_metrics, acquisition_metrics, marketing_attribution, conversion_funnel, customer_metrics, traffic_metrics")

# ── 3. KLAVIYO ────────────────────────────────────────────────────────────────
print("Generating klaviyo data...")

# profiles (sample from customers)
kl_profiles = []
for i in range(min(2500, n_cust)):
    cid = customer_ids[i]
    churn = random.choices(["low","medium","high","winback"],[0.45,0.30,0.15,0.10])[0]
    clv1y = round(random.uniform(20,350), 2)
    kl_profiles.append({
        "profile_id": f"klv_{cid}",
        "email": cust_emails[i],
        "phone_number": f"+1555{random.randint(1000000,9999999)}",
        "first_name": random.choice(["Alice","Bob","Carol","David","Eve"]),
        "last_name": random.choice(["Smith","Jones","Patel","Kim","Chen"]),
        "city": random.choice(["New York","Los Angeles","London","Toronto","Sydney"]),
        "region": random.choice(["NY","CA","Greater London","ON","NSW"]),
        "country": random.choices(["United States","United Kingdom","India","Australia","Canada"],
                                   weights=[0.45,0.30,0.05,0.10,0.10])[0],
        "timezone": "America/New_York",
        "source": random.choice(["shopify","landing_page","social"]),
        "subscriptions": "{}",
        "consent_status": "subscribed",
        "email_subscribed": random.random() > 0.1,
        "sms_subscribed": random.random() > 0.5,
        "created": rand_date("2022-01-01","2024-01-01"),
        "updated": rand_date("2024-01-01","2025-03-01"),
        "predicted_clv_1y": clv1y,
        "predicted_clv_lifetime": round(clv1y * random.uniform(2.5, 5.0), 2),
        "churn_risk": churn,
        "predicted_gender": random.choice(["male","female","unknown"]),
        "average_days_between_orders": round(random.uniform(30,120), 1),
        "average_order_value": round(random.uniform(35,120), 2),
        "total_revenue": round(random.uniform(50,800), 2),
        "expected_date_of_next_order": rand_date("2025-04-01","2025-12-31"),
        "historic_clv": round(random.uniform(50,600), 2),
        "historic_number_of_orders": random.randint(1,12),
        "custom_properties": "{}",
    })
pd.DataFrame(kl_profiles).to_csv(os.path.join(BASE,"data","klaviyo","profiles.csv"), index=False)
print(f"  profiles: {len(kl_profiles)} rows")

# campaigns
campaigns = []
for i in range(60):
    sent = rand_date("2023-01-01","2025-03-01")
    recip = random.randint(5000,40000)
    opens = int(recip * random.uniform(0.15,0.35))
    clicks = int(opens * random.uniform(0.10,0.25))
    revenue = round(random.uniform(500,15000), 2)
    campaigns.append({
        "campaign_id": f"camp_{fake_id('',8)}",
        "name": f"Campaign {i+1} - {random.choice(['New Arrivals','Flash Sale','Welcome','Win-back','Seasonal'])}",
        "channel": random.choice(["email","sms"]),
        "status": "sent",
        "subject": f"Subject line {i+1}",
        "preview_text": "Preview text here",
        "from_email": "hello@knickgasm.com",
        "from_name": "KNICKGASM",
        "send_time": sent,
        "sent_at": sent,
        "created": sent - timedelta(days=3),
        "updated": sent,
        "recipients": recip,
        "delivered": int(recip * 0.97),
        "opens": opens,
        "unique_opens": int(opens * 0.85),
        "clicks": clicks,
        "unique_clicks": int(clicks * 0.80),
        "unsubscribes": random.randint(5,50),
        "bounces": random.randint(10,200),
        "spam_complaints": random.randint(0,5),
        "revenue_attributed": revenue,
        "conversion_rate": round(random.uniform(0.01,0.06), 4),
        "open_rate": round(opens/recip, 4),
        "click_rate": round(clicks/recip, 4),
        "unsubscribe_rate": round(random.uniform(0.001,0.005), 4),
        "bounce_rate": round(random.uniform(0.005,0.02), 4),
    })
pd.DataFrame(campaigns).to_csv(os.path.join(BASE,"data","klaviyo","campaigns.csv"), index=False)
print(f"  campaigns: {len(campaigns)} rows")

# flows
flows = []
for fname in ["Welcome Series","Abandoned Cart","Post-Purchase","Win-Back","Browse Abandon"]:
    flows.append({
        "flow_id": f"flow_{fake_id('',6)}",
        "name": fname,
        "status": "live",
        "trigger_type": "metric",
        "created": "2022-06-01 00:00:00",
        "updated": "2024-01-01 00:00:00",
        "recipients": random.randint(10000,80000),
        "delivered": random.randint(9000,75000),
        "opens": random.randint(3000,25000),
        "clicks": random.randint(500,5000),
        "unsubscribes": random.randint(20,200),
        "revenue_attributed": round(random.uniform(5000,80000), 2),
    })
pd.DataFrame(flows).to_csv(os.path.join(BASE,"data","klaviyo","flows.csv"), index=False)
print(f"  flows: {len(flows)} rows")

# events (recent 500)
kl_events = []
for i in range(500):
    kl_events.append({
        "event_id": fake_id("evt",12),
        "profile_id": random.choice(kl_profiles)["profile_id"],
        "metric_id": fake_id("met",8),
        "metric_name": random.choice(["Placed Order","Opened Email","Clicked Email","Viewed Product"]),
        "timestamp": rand_date("2024-01-01","2025-03-31"),
        "value": round(random.uniform(0,120), 2),
        "event_properties": "{}",
        "uuid": fake_id("uuid",16),
    })
pd.DataFrame(kl_events).to_csv(os.path.join(BASE,"data","klaviyo","events.csv"), index=False)
print(f"  events: {len(kl_events)} rows")

# ── 4. WEBENGAGE ─────────────────────────────────────────────────────────────
print("Generating webengage data...")

we_users = []
for i in range(min(2000, n_cust)):
    we_users.append({
        "user_id": f"we_{customer_ids[i]}",
        "we_id": fake_id("WE",10),
        "first_name": random.choice(["Alice","Bob","Carol","David","Eve"]),
        "last_name": random.choice(["Smith","Jones","Patel","Kim","Chen"]),
        "email": cust_emails[i],
        "phone": f"+1555{random.randint(1000000,9999999)}",
        "gender": random.choice(["male","female","unknown"]),
        "birth_date": None,
        "city": random.choice(["New York","Los Angeles","London","Toronto","Sydney"]),
        "region": random.choice(["NY","CA","Greater London","ON","NSW"]),
        "country": random.choices(["United States","United Kingdom","India","Australia","Canada"],
                                   weights=[0.45,0.30,0.05,0.10,0.10])[0],
        "country_code": random.choices(["US","GB","IN","AU","CA"],
                                        weights=[0.45,0.30,0.05,0.10,0.10])[0],
        "created_at": rand_date("2022-01-01","2024-01-01"),
        "updated_at": rand_date("2024-01-01","2025-03-01"),
        "first_seen": rand_date("2022-01-01","2023-01-01"),
        "last_seen": rand_date("2024-06-01","2025-03-01"),
        "opt_in_email": random.random() > 0.1,
        "opt_in_sms": random.random() > 0.5,
        "opt_in_push": random.random() > 0.4,
        "opt_in_whatsapp": random.random() > 0.7,
        "total_revenue": round(random.uniform(30,700), 2),
        "total_orders": random.randint(1,10),
        "avg_order_value": round(random.uniform(40,120), 2),
        "last_order_date": rand_date("2024-01-01","2025-03-01"),
        "custom_attributes": "{}",
    })
pd.DataFrame(we_users).to_csv(os.path.join(BASE,"data","webengage","user_profiles.csv"), index=False)
print(f"  user_profiles: {len(we_users)} rows")

WE_EVENTS = ["Product Viewed","Added To Cart","Checkout created","Order created",
             "Product Searched","Homepage Viewed","Category Viewed"]
we_events = []
for i in range(8000):
    uid = random.choice(we_users)["user_id"]
    ename = random.choices(WE_EVENTS, weights=[0.30,0.15,0.12,0.10,0.12,0.11,0.10])[0]
    rev = round(random.uniform(30,150),2) if ename == "Order created" else 0.0
    we_events.append({
        "id": fake_id("wev",12),
        "user_id": uid,
        "we_id": fake_id("WE",10),
        "event_name": ename,
        "event_time": rand_date("2024-01-01","2025-03-31"),
        "channel": random.choice(["web","android","ios","email"]),
        "platform": random.choice(["web","mobile"]),
        "device_type": random.choice(["desktop","mobile","tablet"]),
        "city": random.choice(["New York","London","Los Angeles"]),
        "country": "US",
        "country_code": "US",
        "session_id": fake_id("sess",8),
        "experiment_id": None,
        "campaign_id": None,
        "event_properties": "{}",
        "line_items": "[]",
        "revenue": rev,
        "currency": "USD",
    })
pd.DataFrame(we_events).to_csv(os.path.join(BASE,"data","webengage","events.csv"), index=False)
print(f"  events: {len(we_events)} rows")

print("\nAll sample data generated successfully.")
