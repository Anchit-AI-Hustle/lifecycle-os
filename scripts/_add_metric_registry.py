"""
Inserts the full Metric Registry (Question / Problem / Why) into the #overview section
of reports/strategy.html, just before the closing </section> of that block.
"""
import re, pathlib

HTML = pathlib.Path(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\reports\strategy.html")
html = HTML.read_text(encoding="utf-8")

# ── Metric data ──────────────────────────────────────────────────────────────
METRICS = [
    # Tier 1
    {
        "id": "M1", "tier": 1, "color": "amber", "src": "matrixify",
        "name": "Net Revenue by Market",
        "q": "Where is our revenue actually coming from — US, UK, India, or rest of world?",
        "problem": "Without market-level revenue breakdown you can't tell if growth is concentrated in one market masking decline in another, or whether currency exposure is distorting the top line.",
        "why": "Drives resource allocation, market-specific pricing decisions, and determines where to direct the next acquisition dollar. The foundation every other market strategy is built on.",
        "sql": "Metric 1 in queries/metrics.sql",
    },
    {
        "id": "M2", "tier": 1, "color": "amber", "src": "matrixify",
        "name": "New vs Returning Revenue",
        "q": "Is growth coming from new customer acquisition or from existing customers buying again?",
        "problem": "Blended revenue hides whether you're on a treadmill — churn replacing acquisition at net zero customer growth — or genuinely compounding. A business that looks like it's growing can be dying if returning revenue % is falling.",
        "why": "If returning revenue share declines month over month, you have a retention problem even while total revenue grows. This single ratio diagnoses acquisition dependency before it becomes a crisis.",
        "sql": "Metric 2 in queries/metrics.sql",
    },
    {
        "id": "M3", "tier": 1, "color": "teal", "src": "shopify",
        "name": "LTV:CAC Ratio by Channel",
        "q": "Is each acquisition channel generating more lifetime value than it costs to acquire customers from it?",
        "problem": "CAC alone is meaningless without LTV context. A $50 CAC is brilliant if LTV is $300 and destructive if LTV is $55. Channels below 3:1 destroy value with every customer acquired.",
        "why": "The single most important channel health check. Determines which channels to scale, which to pause, and where reallocated budget will compound fastest. Below 2:1 for two consecutive months is a stop signal.",
        "sql": "Metric 3 in queries/metrics.sql",
    },
    {
        "id": "M4", "tier": 1, "color": "purple", "src": "matrixify",
        "name": "Repeat Purchase Rate 90d",
        "q": "What percentage of new buyers come back within 90 days — by monthly cohort?",
        "problem": "A blended repeat rate hides whether the rate is improving or deteriorating. Viewing it by cohort reveals whether a product change, channel shift, or flow modification caused a structural change in customer behaviour.",
        "why": "The 90-day repeat rate is the best single predictor of long-term LTV for a consumable DTC brand. A cohort with a higher 90d rate will be worth 2–4× more at 12 months. Every strategy decision should move this number.",
        "sql": "Metric 4 in queries/metrics.sql",
    },
    {
        "id": "M5", "tier": 1, "color": "amber", "src": "matrixify",
        "name": "Gross Margin % by Product Type",
        "q": "Which product categories actually make money after cost of goods — and which are eroding profitability?",
        "problem": "Revenue without margin context is vanity. A high-revenue SKU at 10% margin funds less future growth than a mid-revenue SKU at 65% margin. Promotion and acquisition decisions made without this view optimise for the wrong outcome.",
        "why": "Sets the floor for viable CAC per product type, determines which SKUs to prioritise in paid acquisition, and drives subscription pricing decisions. Required input for any unit-economics model.",
        "sql": "Metric 5 in queries/metrics.sql",
    },
    # Tier 2
    {
        "id": "M6", "tier": 2, "color": "teal", "src": "shopify",
        "name": "CAC by Channel",
        "q": "How much does it actually cost to acquire one new customer from each marketing channel?",
        "problem": "Marketing spend without per-channel CAC creates budget allocation by gut feel. Channels that look productive by session volume often have the worst cost-per-new-customer once the denominator is right.",
        "why": "The denominator in LTV:CAC. Without accurate CAC you can't know whether any channel is profitable. Also exposes which channels bring in high-intent vs low-intent traffic, which informs creative strategy.",
        "sql": "Metric 6 in queries/metrics.sql",
    },
    {
        "id": "M7", "tier": 2, "color": "purple", "src": "klaviyo",
        "name": "Email Revenue % by Month",
        "q": "What share of total net revenue can be directly attributed to Klaviyo campaigns and flows?",
        "problem": "If email isn't contributing at least 20% of revenue, critical flows are missing or the list is unhealthy. Over-reliance on paid acquisition — where 100% of marginal revenue costs money — makes growth fragile and expensive.",
        "why": "Email and SMS are the highest-ROI owned channels. Knowing their revenue share tells you how much defensible, low-cost revenue you have vs paid-dependent revenue. A growing email % reduces overall CAC structurally.",
        "sql": "Metric 7 in queries/metrics.sql",
    },
    {
        "id": "M8", "tier": 2, "color": "amber", "src": "matrixify",
        "name": "AOV Trend MoM",
        "q": "Is the average order value increasing, flat, or declining month over month — and what is causing it?",
        "problem": "Flat AOV with stable order count means revenue is stagnating. Without MoM tracking, bundle and upsell effectiveness is invisible — you can't tell if pricing changes, promotions, or product launches moved the needle.",
        "why": "AOV × purchase frequency = LTV. A 10% AOV improvement compounds across every customer. It also signals whether discounting is eroding basket value or whether upsell strategies are working.",
        "sql": "Metric 8 in queries/metrics.sql",
    },
    {
        "id": "M9", "tier": 2, "color": "blue", "src": "webengage",
        "name": "Checkout Conversion Funnel",
        "q": "At which exact stage — product view, add-to-cart, checkout, or payment — are we losing the most customers?",
        "problem": "If 70% of people who add to cart never complete a purchase, every dollar spent on acquisition is partially wasted. Funnel leaks are invisible without stage-by-stage event data — Shopify's native analytics only show the final conversion rate.",
        "why": "Funnel improvements multiply all upstream marketing spend. A fix that recovers 5% of cart abandonment benefits every channel simultaneously. This is the highest-leverage conversion investment available.",
        "sql": "Metric 9 in queries/metrics.sql",
    },
    {
        "id": "M10", "tier": 2, "color": "coral", "src": "matrixify",
        "name": "Subscription Mix %",
        "q": "What percentage of monthly revenue comes from subscription orders vs one-time purchases?",
        "problem": "One-time orders create unpredictable, lumpy revenue. Every month starts from zero. Subscription revenue compounds: once a customer subscribes, revenue from that customer is near-certain until they cancel.",
        "why": "Subscription mix directly determines revenue predictability, LTV ceiling, and business valuation multiple. Moving from 20% to 50% subscription mix can increase valuation 2–3× on the same revenue base.",
        "sql": "Metric 10 in queries/metrics.sql",
    },
    # Tier 3
    {
        "id": "M11", "tier": 3, "color": "purple", "src": "matrixify",
        "name": "Cohort Retention 30/60/90d",
        "q": "Are customers still buying at 30, 60, and 90 days after their first purchase — and where does the cohort drop off?",
        "problem": "A single repeat rate doesn't show WHERE the drop-off happens. If 30-day retention is 15% but 60-day is also 15%, no one returns after the first window. If 30d is 5% and 90d is 25%, customers are slow starters — not churning.",
        "why": "Determines optimal flow trigger timing. If median second purchase is at day 45, a day-7 re-engagement email is firing 38 days too early. Cohort shape is the structural input for every post-purchase automation.",
        "sql": "Metric 11 in queries/metrics.sql",
    },
    {
        "id": "M12", "tier": 3, "color": "purple", "src": "matrixify",
        "name": "Time to 2nd Purchase",
        "q": "How many days does it typically take for a customer to make their second purchase — by market?",
        "problem": "Post-purchase flows fire at arbitrary intervals by default. If your re-engagement email fires at day 60 but customers who return typically do so at day 21, you're missing the conversion window by 6 weeks — and attributing the miss to the product rather than the timing.",
        "why": "The single structural input that sets trigger timing for every Klaviyo post-purchase flow. Run once per market segment. If US median is 21 days and UK is 45 days, flows need different timing by market to be effective.",
        "sql": "Metric 12 in queries/metrics.sql",
    },
    {
        "id": "M13", "tier": 3, "color": "purple", "src": "klaviyo",
        "name": "Churn Risk Distribution",
        "q": "How many of our active customers are predicted by Klaviyo's model to churn in the next 90 days?",
        "problem": "Churn is invisible until it registers in revenue — typically 2–3 months after the behaviour change. Klaviyo's predictive score gives a 30–90 day early warning window. Without it, you win-back customers who have already bought elsewhere.",
        "why": "Win-back is 5–7× cheaper than new acquisition. Acting on predicted churn before it happens is the highest-ROI retention lever. Knowing the distribution tells you the scale of the risk — and whether it requires urgent reallocation of budget.",
        "sql": "Metric 13 in queries/metrics.sql",
    },
    {
        "id": "M14", "tier": 3, "color": "coral", "src": "klaviyo",
        "name": "At-Risk Revenue",
        "q": "What is the total predicted 12-month CLV of customers currently flagged as high-risk or winback — by market?",
        "problem": "Retention investment decisions require a dollar figure. '500 at-risk customers' doesn't move a budget conversation. '$180K in predicted CLV is at risk this quarter' does. This metric converts churn probability into a concrete revenue line.",
        "why": "Makes the business case for win-back campaign spend quantifiable. If 30% of at-risk CLV can be recovered, the expected recovery amount directly sets the maximum viable spend on win-back flows and incentives.",
        "sql": "Metric 14 in queries/metrics.sql",
    },
    {
        "id": "M15", "tier": 3, "color": "coral", "src": "matrixify",
        "name": "Product Repeat Rate (Top 10)",
        "q": "Which specific SKUs are most effective at bringing customers back — regardless of what they buy on their next order?",
        "problem": "Not all products are equal as customer relationship openers. A low-priced sampler might generate more lifetime value than a premium SKU by pulling customers into repeat purchase behaviour. Without this view, acquisition targets high-margin products that may not retain.",
        "why": "Identifies 'gateway SKUs' — the products that open long-term customer relationships. These are your highest-value acquisition targets and your top subscription conversion candidates. Combined with Metric 10, reveals SKUs that retain well but are under-subscribed.",
        "sql": "Metric 15 in queries/metrics.sql",
    },
    {
        "id": "BONUS", "tier": 3, "color": "teal", "src": "matrixify",
        "name": "LTV by Market",
        "q": "Are US, UK, and India customers worth the same over their lifetime — and should we have a different CAC ceiling per market?",
        "problem": "Applying the same CAC ceiling to all markets is wrong if LTV differs significantly. If UK customers have 2× the LTV of US customers, you're systematically overspending in the US and underspending in the UK.",
        "why": "The market-level LTV split determines the correct CAC ceiling per geography — which is the primary input for media budget allocation. A market with 50% higher LTV can justify 50% higher CAC before the same 3:1 ratio breaks.",
        "sql": "BONUS query in queries/metrics.sql",
    },
]

TIER_LABELS = {1: "Tier 1 — Business Health", 2: "Tier 2 — Growth Levers", 3: "Tier 3 — Retention Intelligence"}
TIER_COLORS = {1: "amber", 2: "teal", 3: "purple"}
SRC_CLASS   = {"matrixify": "src-matrixify", "shopify": "src-shopify", "klaviyo": "src-klaviyo", "webengage": "src-webengage"}
SRC_LABEL   = {"matrixify": "Matrixify", "shopify": "Shopify Analytics", "klaviyo": "Klaviyo", "webengage": "WebEngage"}

def color_var(c):
    return f"var(--{c})"

def build_registry():
    rows = []
    rows.append("""
<div style="margin-top:56px">
  <div class="section-label" style="color:var(--purple);margin-bottom:8px">Metric Registry</div>
  <h3 style="font-size:1.35rem;font-weight:800;margin-bottom:8px">Every Metric: Question · Problem · Why It Matters</h3>
  <p style="font-size:.92rem;color:var(--text2);max-width:680px;margin-bottom:36px">Each of the 15 metrics (plus the LTV by Market bonus) is defined here by the specific business question it answers, the problem it makes visible, and why tracking it changes decisions. Use these definitions to explain any metric to a stakeholder in 30 seconds.</p>
""")

    for tier_num in [1, 2, 3]:
        tier_metrics = [m for m in METRICS if m["tier"] == tier_num]
        tc = TIER_COLORS[tier_num]
        rows.append(f"""
  <div style="margin-bottom:40px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid var(--{tc})">
      <span style="background:var(--{tc});color:#fff;font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:4px 12px;border-radius:999px">{TIER_LABELS[tier_num]}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">
""")
        for m in tier_metrics:
            mc = m["color"]
            src_cls = SRC_CLASS[m["src"]]
            src_lbl = SRC_LABEL[m["src"]]
            rows.append(f"""
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:20px;border-top:3px solid {color_var(mc)};display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
          <div>
            <span style="font-size:.68rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:{color_var(mc)}">{m["id"]}</span>
            <div style="font-size:.95rem;font-weight:800;color:var(--text);margin-top:2px">{m["name"]}</div>
          </div>
          <span class="src-badge {src_cls}" style="white-space:nowrap;flex-shrink:0">{src_lbl}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="background:var(--bg3);border-radius:8px;padding:12px">
            <div style="font-size:.68rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:{color_var(mc)};margin-bottom:4px">Question it answers</div>
            <div style="font-size:.85rem;color:var(--text);font-weight:500;line-height:1.5">{m["q"]}</div>
          </div>
          <div style="background:var(--bg3);border-radius:8px;padding:12px">
            <div style="font-size:.68rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--coral);margin-bottom:4px">Problem it solves</div>
            <div style="font-size:.82rem;color:var(--text2);line-height:1.55">{m["problem"]}</div>
          </div>
          <div style="background:var(--bg3);border-radius:8px;padding:12px">
            <div style="font-size:.68rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--green);margin-bottom:4px">Why it is important</div>
            <div style="font-size:.82rem;color:var(--text2);line-height:1.55">{m["why"]}</div>
          </div>
        </div>
        <div style="font-size:.72rem;color:var(--text3);padding-top:4px;border-top:1px solid var(--border)">→ {m["sql"]}</div>
      </div>
""")
        rows.append("    </div>\n  </div>")

    rows.append("\n</div>")
    return "".join(rows)


# ── Inject into #overview section, just before </section> ────────────────────
MARKER = "</div>\n</section>\n\n<div class=\"section-divider\"></div>\n\n<!-- SECTION 2: RETENTION ENGINE -->"

registry_html = build_registry()
replacement = registry_html + "\n</div>\n</section>\n\n<div class=\"section-divider\"></div>\n\n<!-- SECTION 2: RETENTION ENGINE -->"

if MARKER not in html:
    print("ERROR: marker not found — check the HTML structure")
else:
    html = html.replace(MARKER, replacement, 1)
    HTML.write_text(html, encoding="utf-8")
    import re as _re
    cards = len(_re.findall(r'Question it answers', html))
    print(f"Done. {cards} metric registry cards injected.")
