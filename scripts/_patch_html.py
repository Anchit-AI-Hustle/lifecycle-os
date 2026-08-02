"""
Patch strategy.html:
  1. Remove the warning banner
  2. Inject .ph placeholder CSS
  3. Replace every mock/benchmark number with a <mark class="ph"> element
"""
import re

PATH = r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\reports\strategy.html"

with open(PATH, encoding="utf-8") as f:
    html = f.read()

# ── 1. INJECT PLACEHOLDER CSS ──────────────────────────────────────────────
PH_CSS = """
/* ── PLACEHOLDERS ── */
mark.ph {
  background: #fef9c3; color: #854d0e;
  border: 1.5px dashed #ca8a04;
  border-radius: 4px;
  padding: 1px 7px;
  font-style: normal;
  font-weight: 700;
  font-size: .88em;
  cursor: help;
  text-decoration: none;
}
@media (prefers-color-scheme: dark) {
  mark.ph { background: #2d1f00; color: #fbbf24; border-color: #d97706; }
}
"""
html = html.replace("/* ── RESPONSIVE ── */", PH_CSS + "\n/* ── RESPONSIVE ── */", 1)

# ── 2. REMOVE WARNING BANNER ───────────────────────────────────────────────
# Remove the entire ⚠️ warning div block at the bottom of the questions section
html = re.sub(
    r'\s*<div style="background:var\(--bg3\);border:1px solid var\(--border\);border-radius:10px;padding:18px 22px;display:flex;gap:14px;align-items:flex-start">.*?</div>\s*',
    "\n\n",
    html,
    flags=re.DOTALL,
)

def ph(label, tip=""):
    tip_attr = f' title="{tip}"' if tip else ""
    return f'<mark class="ph"{tip_attr}>[ {label} ]</mark>'

# ── 3. STRATEGY 1 — RETENTION ENGINE ──────────────────────────────────────

# Decision tree: CLV thresholds
html = html.replace(
    "High churn risk + predicted CLV &gt; $200",
    f"High churn risk + predicted CLV &gt; {ph('YOUR HIGH-VALUE CLV CUTOFF', 'Run: SELECT PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY predicted_clv_1y) FROM klaviyo.profiles')}",
)
html = html.replace(
    "High churn risk + predicted CLV &lt; $200",
    f"High churn risk + predicted CLV &lt; {ph('YOUR HIGH-VALUE CLV CUTOFF', 'Same threshold as above — your P75 predicted_clv_1y from Klaviyo')}",
)
html = html.replace(
    "Personal win-back: 20% off + free shipping. Assign to VIP rep flow. High-touch, high-value worth the margin cost.",
    f"Personal win-back: {ph('YOUR WIN-BACK OFFER', 'e.g. 15–25% off + free shipping — depends on your margin structure on high-CLV SKUs')}. Assign to VIP rep flow. High-touch, high-value worth the margin cost.",
)
html = html.replace(
    "Time to 2nd purchase &gt; 45 days average",
    f"Time to 2nd purchase &gt; {ph('YOUR MEDIAN T2P', 'Run Metric 12 in queries/metrics.sql → use the median_days value')} average",
)
html = html.replace(
    "Trigger a day-14 post-purchase educational flow.",
    f"Trigger a day-{ph('MEDIAN T2P − 7', 'Run Metric 12 → subtract 7 days from your actual median_days')} post-purchase educational flow.",
)
# SQL snippet threshold comments
html = html.replace(
    "    <span class=\"kw\">AND</span> p.predicted_clv_1y <span class=\"op\">&gt;</span> <span class=\"num\">200</span>",
    "    <span class=\"kw\">AND</span> p.predicted_clv_1y <span class=\"op\">&gt;</span> <span class=\"num\">200</span> <span class=\"cm\">-- replace: SELECT PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY predicted_clv_1y) FROM klaviyo.profiles</span>",
)
html = html.replace(
    "<span class=\"kw\">HAVING</span> <span class=\"fn\">DATEDIFF</span>(<span class=\"str\">'day'</span>, <span class=\"fn\">MAX</span>(o.processed_at), <span class=\"fn\">CURRENT_DATE</span>) <span class=\"op\">&gt;</span> <span class=\"num\">60</span>",
    "<span class=\"kw\">HAVING</span> <span class=\"fn\">DATEDIFF</span>(<span class=\"str\">'day'</span>, <span class=\"fn\">MAX</span>(o.processed_at), <span class=\"fn\">CURRENT_DATE</span>) <span class=\"op\">&gt;</span> <span class=\"num\">60</span> <span class=\"cm\">-- replace: your lapse window in days (e.g. avg days between orders × 1.5)</span>",
)

# ── 4. STRATEGY 2 — CHANNEL EFFICIENCY ────────────────────────────────────

# Benchmark table — "3:1 minimum"
html = html.replace(
    "<td><strong>3:1 minimum</strong></td>",
    f"<td><strong>{ph('3:1 — INDUSTRY BENCHMARK', 'Standard DTC floor; set your own based on payback period and growth targets')}</strong></td>",
)
# Benchmark table — "30–40% target"
html = html.replace(
    "<td><strong>30–40% target</strong></td>",
    f"<td><strong>{ph('30–40% — INDUSTRY BENCHMARK', 'Mature email programs drive 30-40% of DTC revenue; your baseline will vary by list size and flow coverage')}</strong></td>",
)
# Benchmark table — CTOR
html = html.replace(
    "<td><strong>&gt;15%</strong></td>",
    f"<td><strong>{ph('15%+ — INDUSTRY BENCHMARK', 'Industry average CTOR for DTC email; check your Klaviyo account → Analytics → Benchmarks for category comparison')}</strong></td>",
)
# Benchmark table — revenue per recipient
html = html.replace(
    "<td><strong>&gt;$0.10</strong></td>",
    f"<td><strong>{ph('$0.10+ — INDUSTRY BENCHMARK', 'Run: SELECT SUM(revenue_attributed)/SUM(recipients) FROM klaviyo.campaigns')}</strong></td>",
)
# Benchmark table — US CAC
html = html.replace(
    "<td><strong>&lt; $45</strong></td>",
    f"<td><strong>{ph('YOUR US CAC CEILING', 'Set as: median LTV (US) from Bonus LTV by Market query ÷ your target LTV:CAC ratio')}</strong></td>",
)
# Benchmark table — UK CAC
html = html.replace(
    "<td><strong>&lt; $55</strong></td>",
    f"<td><strong>{ph('YOUR UK CAC CEILING', 'Set as: median LTV (UK) from Bonus LTV by Market query ÷ your target LTV:CAC ratio')}</strong></td>",
)
# Workflow — ">3:1 increase budget / <2:1 pause"
html = html.replace(
    "<div class=\"wf-box accent-teal\">&gt;3:1 → increase<br>&lt;2:1 → pause</div>",
    f'<div class="wf-box accent-teal">&gt;{ph("YOUR SCALE THRESHOLD", "Typically 3:1 — set based on your reinvestment rate and payback window")} → increase<br>&lt;{ph("YOUR PAUSE THRESHOLD", "Typically 2:1 — at this level you are not covering cost")} → pause</div>',
)
# Workflow — email "If < 25%"
html = html.replace(
    "<div class=\"wf-box\">If &lt; 25%<br>→ gap identified</div>",
    f'<div class="wf-box">If &lt; {ph("YOUR EMAIL FLOOR %", "Set your own floor — typically 25-30% for a healthy Klaviyo setup")}<br>→ gap identified</div>',
)
# LTV:CAC SQL: < 3 threshold
html = html.replace(
    "         <span class=\"kw\">THEN</span> <span class=\"str\">'⚠ BELOW 3:1 — REVIEW'</span>",
    "         <span class=\"kw\">THEN</span> <span class=\"str\">'⚠ BELOW 3:1 — REVIEW'</span> <span class=\"cm\">-- replace 3 with your minimum acceptable LTV:CAC ratio</span>",
)

# ── 5. STRATEGY 3 — GEO ───────────────────────────────────────────────────

# US revenue share in geo card description
html = html.replace(
    "Largest revenue share (~45%), highest AOV.",
    f"Largest revenue share ({ph('YOUR US REV %', 'Run Metric 1 → US net_sales / total net_sales × 100')}), highest AOV.",
)
# UK revenue share
html = html.replace(
    "~30% revenue share. Strong sneaker culture = high repeat propensity.",
    f"{ph('YOUR UK REV %', 'Run Metric 1 → GB net_sales / total net_sales × 100')} revenue share. Strong sneaker culture = high repeat propensity.",
)
# IN revenue share
html = html.replace(
    "~5% revenue share, lowest AOV in absolute $.",
    f"{ph('YOUR IN REV %', 'Run Metric 1 → IN net_sales / total net_sales × 100')} revenue share, lowest AOV in absolute $.",
)
# US CAC ceiling in card
html = html.replace(
    "<span style=\"color:var(--amber)\">→</span>CAC ceiling: $45",
    f'<span style="color:var(--amber)">→</span>CAC ceiling: {ph("YOUR US CAC CEILING", "= median LTV (US) ÷ 3 — run: SELECT MEDIAN(lifetime_revenue) FROM ... WHERE market=\'US\'")}',
)
# UK CAC ceiling in card
html = html.replace(
    "<span style=\"color:var(--teal)\">→</span>CAC ceiling: £42",
    f'<span style="color:var(--teal)">→</span>CAC ceiling: {ph("YOUR UK CAC CEILING", "= median LTV (UK) ÷ 3 — run Bonus LTV by Market query, UK row")}',
)

# ── 6. STRATEGY 4 — SUBSCRIPTION ─────────────────────────────────────────

# "at 35–40% subscription mix, KNICKGASM is already well-positioned"
html = html.replace(
    "At 35–40% subscription mix, KNICKGASM is already well-positioned — the opportunity is to push this to 55–60%",
    f"At {ph('YOUR CURRENT SUB MIX %', 'Run Metric 10 in queries/metrics.sql — most recent month sub_pct')} subscription mix, KNICKGASM is already well-positioned — the opportunity is to push this to {ph('YOUR TARGET SUB MIX %', 'Set your own growth target — e.g. current mix + 15–20pp over 12 months')}",
)
# LTV bar chart — one-time
html = html.replace(
    "<div class=\"ltv-val\">Avg LTV: ~$65</div>",
    f'<div class="ltv-val">Avg LTV: {ph("YOUR ONE-TIME LTV", "Run: SELECT AVG(ltv) FROM (...) WHERE order_count = 1")}</div>',
)
# LTV bar chart — repeat
html = html.replace(
    "<div class=\"ltv-val\">Avg LTV: ~$160</div>",
    f'<div class="ltv-val">Avg LTV: {ph("YOUR REPEAT LTV", "Run: SELECT AVG(ltv) FROM (...) WHERE order_count BETWEEN 2 AND 5 AND is_subscription = 0")}</div>',
)
# LTV bar chart — subscriber
html = html.replace(
    "<div class=\"ltv-val\">Avg LTV: ~$260+</div>",
    f'<div class="ltv-val">Avg LTV: {ph("YOUR SUBSCRIBER LTV", "Run: SELECT AVG(ltv) FROM (...) WHERE is_subscription = 1 — needs real sub flag in order_line_items.properties")}</div>',
)
# LTV bar chart multiplier labels
html = html.replace(
    '<span style="color:var(--text2);font-size:.8rem">1×</span>',
    '<span style="color:var(--text2);font-size:.8rem">baseline</span>',
)
html = html.replace(
    "<span>~2.5×</span>",
    f'<span>{ph("REPEAT / OTB", "= YOUR_REPEAT_LTV ÷ YOUR_ONE-TIME_LTV")}</span>',
)
html = html.replace(
    "<span>~4×</span>",
    f'<span>{ph("SUB / OTB", "= YOUR_SUBSCRIBER_LTV ÷ YOUR_ONE-TIME_LTV")}</span>',
)
# Subscription SQL: BETWEEN 5 AND 21
html = html.replace(
    "  <span class=\"kw\">AND</span> <span class=\"fn\">DATEDIFF</span>(<span class=\"str\">'day'</span>, last_purchase, <span class=\"fn\">CURRENT_DATE</span>) <span class=\"kw\">BETWEEN</span> <span class=\"num\">5</span> <span class=\"kw\">AND</span> <span class=\"num\">21</span>",
    "  <span class=\"kw\">AND</span> <span class=\"fn\">DATEDIFF</span>(<span class=\"str\">'day'</span>, last_purchase, <span class=\"fn\">CURRENT_DATE</span>) <span class=\"kw\">BETWEEN</span> <span class=\"num\">5</span> <span class=\"kw\">AND</span> <span class=\"num\">21</span> <span class=\"cm\">-- replace upper bound: use Metric 12 median_days for your data</span>",
)

# ── 7. STRATEGY 5 — FUNNEL ───────────────────────────────────────────────

# Funnel visualisation bars
html = html.replace(
    '<span style="color:#fff;font-weight:800;font-size:1rem">~14%</span>',
    f'<span style="color:#fff;font-weight:800;font-size:1rem">{ph("YOUR ATC RATE", "Run Metric 9 — added_to_cart / product_viewed × 100")}</span>',
)
html = html.replace(
    '<div style="text-align:center;font-size:.72rem;color:var(--coral)">↓ 86% drop</div>',
    f'<div style="text-align:center;font-size:.72rem;color:var(--coral)">↓ {ph("YOUR PV→ATC DROP", "= 100% − YOUR ATC RATE")} drop</div>',
)
html = html.replace(
    '<span style="color:#1e40af;font-weight:800;font-size:1rem">~9%</span>',
    f'<span style="color:#1e40af;font-weight:800;font-size:1rem">{ph("YOUR CHK RATE", "Run Metric 9 — checkout_created / product_viewed × 100")}</span>',
)
html = html.replace(
    '<div style="text-align:center;font-size:.72rem;color:var(--coral)">↓ 36% drop</div>',
    f'<div style="text-align:center;font-size:.72rem;color:var(--coral)">↓ {ph("YOUR ATC→CHK DROP", "= YOUR ATC RATE − YOUR CHK RATE")} drop</div>',
)
html = html.replace(
    '<span style="color:#fff;font-weight:800;font-size:1rem">~6%</span>',
    f'<span style="color:#fff;font-weight:800;font-size:1rem">{ph("YOUR CVR", "Run Metric 9 — order_created / product_viewed × 100")}</span>',
)

# Decision tree: Mobile CVR gap > 15%
html = html.replace(
    "Mobile CVR &lt; Desktop CVR by &gt; 15%",
    f"Mobile CVR &lt; Desktop CVR by &gt; {ph('YOUR MOBILE GAP THRESHOLD', 'A 10-15% gap is common; set your own alert level based on your mobile traffic share')}",
)
# Decision tree: US/UK gap > 10%
html = html.replace(
    "US / UK conversion gap &gt; 10%",
    f"US / UK conversion gap &gt; {ph('YOUR GEO CVR THRESHOLD', 'Run Metric 9 filtered by country_code and compare — your actual gap may differ')}",
)
# Funnel SQL: CVR drop < -5
html = html.replace(
    "    <span class=\"kw\">THEN</span> <span class=\"str\">'⚠ ALERT: CVR dropped &gt;5%'</span>",
    "    <span class=\"kw\">THEN</span> <span class=\"str\">'⚠ ALERT: CVR dropped &gt;5%'</span> <span class=\"cm\">-- replace -5 with your own alert sensitivity</span>",
)

# ── 8. KEY QUESTIONS SECTION — SIGNAL BOXES ──────────────────────────────

# Repeat rate > 25% benchmark in signal box
html = html.replace(
    "<strong>Strong:</strong> 90d repeat rate &gt;25% = healthy DTC retention (KNICKGASM's sneaker category supports this).",
    f"<strong>Strong:</strong> 90d repeat rate &gt;{ph('25% — INDUSTRY BENCHMARK', 'Consumable DTC benchmark; your actual target should be set from your own cohort data once loaded')} = healthy DTC retention.",
)
# Time-to-2nd < 45 days benchmark
html = html.replace(
    "<strong>Benchmark:</strong> Median under 45 days = strong re-engagement; over 90 days = post-purchase flow is too late or missing.",
    f"<strong>From your data:</strong> Once you run Metric 12, your median days-to-2nd defines the benchmark. Below {ph('YOUR MEDIAN T2P', 'Run Metric 12 against real orders export')} = strong; above 90 = flow is firing too late.",
)
# Email 30–40% in key questions signal
html = html.replace(
    "<strong>Target:</strong> 30–40% of net sales attributed to Klaviyo (DTC benchmark for mature email programs).",
    f"<strong>Target:</strong> {ph('30–40% — INDUSTRY BENCHMARK', 'Mature DTC email programs; your starting point will be lower — treat this as a 12-month goal, not an immediate expectation')} of net sales attributed to Klaviyo.",
)
# Sub mix target signal
html = html.replace(
    "<strong>Target:</strong> Push toward 55–60% subscription mix for revenue predictability.",
    f"<strong>Target:</strong> Push toward {ph('YOUR TARGET SUB MIX %', 'Set based on current mix from Metric 10 + a realistic 12-month growth goal')} subscription mix for revenue predictability.",
)
html = html.replace(
    "<strong>Current signal:</strong> ~35–40% (based on seed data — replace with your real export).",
    f"<strong>Current:</strong> {ph('RUN METRIC 10', 'python run_all.py → duckdb knickgasm_dtc.duckdb → .read queries/metrics.sql — M10 section')} (from your real Matrixify export).",
)
# 8-15% sub conversion benchmark
html = html.replace(
    "<strong>Expected outcome:</strong> 8–15% subscription conversion rate on this warm audience.",
    f"<strong>Expected outcome:</strong> {ph('8–15% — INDUSTRY BENCHMARK', 'Post-purchase subscription offer conversion rate benchmark for DTC consumables')} subscription conversion rate on this warm audience.",
)
# >25% at-risk churn
html = html.replace(
    "<strong>Act when:</strong> High + winback &gt;25% of active list — a quarter of your customers are at risk.",
    f"<strong>Act when:</strong> High + winback &gt;{ph('25% — ROUGH BENCHMARK', 'Run Metric 13 against your real Klaviyo profiles export — your actual distribution will set the right threshold')} of active list.",
)
# Cart-to-checkout > 50% benchmark
html = html.replace(
    "<strong>Baseline:</strong> Cart-to-checkout rate &gt;50%, checkout-to-order &gt;60% = healthy.",
    f"<strong>Your baseline:</strong> Run Metric 9 against your real WebEngage export — {ph('YOUR ATC→CHK RATE', 'Run Metric 9, most recent 4 weeks average')} cart-to-checkout, {ph('YOUR CHK→ORDER RATE', 'Run Metric 9, most recent 4 weeks average')} checkout-to-order.",
)

# ── 9. WRITE OUTPUT ───────────────────────────────────────────────────────
with open(PATH, "w", encoding="utf-8") as f:
    f.write(html)

print("Patched successfully.")

# Count placeholders
ph_count = html.count('class="ph"')
print(f"Total <mark class='ph'> elements: {ph_count}")
