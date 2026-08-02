"""
Restructures reports/strategy.html for progressive disclosure:
1. Replaces the dense metric registry grid with a compact <details> accordion
2. Makes the question groups collapsible
3. Adds accordion + summary CSS
"""
import re, pathlib

HTML = pathlib.Path(r"c:\Users\Archit Tandon\Desktop\knickgasm-dtc-data-engine\reports\strategy.html")
html = HTML.read_text(encoding="utf-8")

# ── 1. ADD CSS for accordion rows ─────────────────────────────────────────────
ACCORDION_CSS = """
/* ── METRIC ACCORDION ── */
.m-accordion { display:flex; flex-direction:column; gap:4px; margin-top:32px; }
.m-tier-header {
  display:flex; align-items:center; gap:10px;
  padding:10px 0 10px; margin-top:24px; margin-bottom:4px;
  border-bottom:2px solid var(--border);
  font-size:.72rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
  color:var(--text3);
}
.m-tier-header .tier-dot {
  width:10px; height:10px; border-radius:50%; flex-shrink:0;
}
details.m-row {
  background:var(--bg2); border:1px solid var(--border); border-radius:8px;
  overflow:hidden;
}
details.m-row[open] { border-color:var(--accent,var(--border)); }
summary.m-row-summary {
  display:flex; align-items:center; gap:12px; padding:12px 16px;
  cursor:pointer; list-style:none; user-select:none;
}
summary.m-row-summary::-webkit-details-marker { display:none; }
summary.m-row-summary:hover { background:var(--bg3); }
.m-chevron {
  margin-left:auto; flex-shrink:0;
  width:16px; height:16px; color:var(--text3);
  transition:transform .18s;
}
details.m-row[open] .m-chevron { transform:rotate(180deg); }
.m-badge {
  font-size:.66rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase;
  padding:2px 8px; border-radius:4px; flex-shrink:0;
  color:#fff;
}
.m-name { font-size:.88rem; font-weight:700; color:var(--text); min-width:200px; }
.m-question { font-size:.82rem; color:var(--text2); line-height:1.4; flex:1; min-width:0; }
.m-row-body {
  display:grid; grid-template-columns:1fr 1fr 1fr;
  gap:1px; background:var(--border);
  border-top:1px solid var(--border);
}
@media(max-width:700px){ .m-row-body { grid-template-columns:1fr; } }
.m-cell { background:var(--bg); padding:14px 16px; }
.m-cell-label {
  font-size:.65rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase;
  margin-bottom:6px;
}
.m-cell p { font-size:.8rem; color:var(--text2); line-height:1.55; }
.m-sql-ref {
  grid-column:1/-1; background:var(--bg3);
  padding:8px 16px; font-size:.72rem; color:var(--text3);
  border-top:1px solid var(--border);
}

/* ── QUESTION GROUP COLLAPSIBLE ── */
details.q-group-wrap { background:transparent; }
details.q-group-wrap > summary {
  cursor:pointer; list-style:none;
}
details.q-group-wrap > summary::-webkit-details-marker { display:none; }
details.q-group-wrap > summary .q-group-header { pointer-events:none; }
details.q-group-wrap[open] > summary .q-chevron { transform:rotate(180deg); }
.q-chevron {
  margin-left:auto; flex-shrink:0;
  width:18px; height:18px; color:var(--text3);
  transition:transform .18s; display:inline-block;
}
"""

# inject after the last existing CSS rule block, before </style>
html = html.replace("</style>", ACCORDION_CSS + "\n</style>", 1)

# ── 2. METRIC DATA ────────────────────────────────────────────────────────────
METRICS = [
    # tier, color-hex, id, src-cls, src-label, name, question, problem, why, sql
    (1,"#d97706","M1","src-matrixify","Matrixify","Net Revenue by Market",
     "Where is our revenue coming from — US, UK, India, or rest of world?",
     "Without market-level breakdown you can't tell if growth is concentrated in one market masking decline in another, or whether currency exposure is distorting the top line.",
     "Drives resource allocation, market-specific pricing, and determines where to direct the next acquisition dollar. Every market strategy is built on this number.",
     "queries/metrics.sql — Metric 1"),
    (1,"#d97706","M2","src-matrixify","Matrixify","New vs Returning Revenue",
     "Is growth coming from new customers or from existing customers buying again?",
     "Blended revenue hides whether you're on a treadmill — churn replacing acquisition at net-zero customer growth — or genuinely compounding. A business that looks like it's growing can be dying if returning revenue share is falling.",
     "If returning revenue share declines month over month, you have a retention problem even while total revenue grows. This ratio diagnoses acquisition dependency before it becomes a crisis.",
     "queries/metrics.sql — Metric 2"),
    (1,"#0d9488","M3","src-shopify","Shopify Analytics","LTV:CAC Ratio by Channel",
     "Is each acquisition channel generating more lifetime value than it costs to acquire customers from it?",
     "CAC alone is meaningless without LTV context. A $50 CAC is brilliant if LTV is $300 and destructive if LTV is $55. Channels below 3:1 destroy value with every customer acquired.",
     "The single most important channel health check. Determines which channels to scale, which to pause, and where reallocated budget will compound fastest.",
     "queries/metrics.sql — Metric 3"),
    (1,"#7c3aed","M4","src-matrixify","Matrixify","Repeat Purchase Rate 90d",
     "What percentage of new buyers come back within 90 days — tracked by cohort month?",
     "A blended repeat rate hides whether the rate is improving or deteriorating. Viewing by cohort reveals whether a product change, channel shift, or flow modification caused a structural change in behaviour.",
     "The 90-day repeat rate is the best single predictor of long-term LTV for a consumable DTC brand. A cohort with a higher 90d rate will be worth 2–4× more at 12 months.",
     "queries/metrics.sql — Metric 4"),
    (1,"#d97706","M5","src-matrixify","Matrixify","Gross Margin % by Product Type",
     "Which product categories make money after cost of goods — and which are eroding profitability?",
     "Revenue without margin context is vanity. A high-revenue SKU at 10% margin funds less future growth than a mid-revenue SKU at 65% margin. Promotion decisions made without this view optimise for the wrong outcome.",
     "Sets the floor for viable CAC per product type, determines which SKUs to prioritise in acquisition, and drives subscription pricing decisions. Required for any unit-economics model.",
     "queries/metrics.sql — Metric 5"),
    (2,"#0d9488","M6","src-shopify","Shopify Analytics","CAC by Channel",
     "How much does it cost to acquire one new customer from each marketing channel?",
     "Marketing spend without per-channel CAC creates allocation by gut feel. Channels that look productive by session volume often have the worst cost-per-new-customer once the denominator is right.",
     "The denominator in LTV:CAC. Without accurate CAC you can't know whether any channel is profitable. Also exposes which channels bring in high-intent vs low-intent traffic.",
     "queries/metrics.sql — Metric 6"),
    (2,"#7c3aed","M7","src-klaviyo","Klaviyo","Email Revenue % by Month",
     "What share of total net revenue can be directly attributed to Klaviyo campaigns and flows?",
     "If email isn't contributing at least 20% of revenue, critical flows are missing or the list is unhealthy. Over-reliance on paid acquisition makes growth fragile and expensive.",
     "Email/SMS are the highest-ROI owned channels. A growing email revenue % reduces overall CAC structurally — every percentage point is margin that doesn't have to be paid to an ad platform.",
     "queries/metrics.sql — Metric 7"),
    (2,"#d97706","M8","src-matrixify","Matrixify","AOV Trend MoM",
     "Is the average order value increasing, flat, or declining month over month — and what is driving it?",
     "Flat AOV with stable order count means revenue is stagnating. Without MoM tracking, bundle and upsell effectiveness is invisible — you can't tell if pricing changes or promotions moved the needle.",
     "AOV × purchase frequency = LTV. A 10% AOV improvement compounds across every customer. It also signals whether discounting is eroding basket value or whether upsell strategies are working.",
     "queries/metrics.sql — Metric 8"),
    (2,"#2563eb","M9","src-webengage","WebEngage","Checkout Conversion Funnel",
     "At which exact stage — product view, add-to-cart, checkout, or payment — are we losing the most customers?",
     "If 70% of people who add to cart never complete a purchase, every dollar spent on acquisition is partially wasted. Funnel leaks are invisible without stage-by-stage event data.",
     "Funnel improvements multiply all upstream marketing spend. A fix that recovers 5% of cart abandonment benefits every channel simultaneously — highest-leverage conversion investment available.",
     "queries/metrics.sql — Metric 9"),
    (2,"#e11d48","M10","src-matrixify","Matrixify","Subscription Mix %",
     "What percentage of monthly revenue comes from subscription orders vs one-time purchases?",
     "One-time orders create unpredictable, lumpy revenue — every month starts from zero. Subscription revenue compounds: once a customer subscribes, revenue is near-certain until they cancel.",
     "Subscription mix directly determines revenue predictability, LTV ceiling, and valuation multiple. Moving from 20% to 50% subscription can increase valuation 2–3× on the same revenue base.",
     "queries/metrics.sql — Metric 10"),
    (3,"#7c3aed","M11","src-matrixify","Matrixify","Cohort Retention 30/60/90d",
     "Are customers still buying at 30, 60, and 90 days after first purchase — and where does the cohort drop off?",
     "A single repeat rate doesn't show WHERE the drop-off happens. If 30d and 90d retention are identical, no one returns after the first window. The shape of the curve changes the entire flow strategy.",
     "Determines optimal trigger timing for every post-purchase flow. If median second purchase is day 45, a day-7 re-engagement email fires 38 days too early. Cohort shape is the structural input for automation.",
     "queries/metrics.sql — Metric 11"),
    (3,"#7c3aed","M12","src-matrixify","Matrixify","Time to 2nd Purchase",
     "How many days does it typically take for a customer to make a second purchase — segmented by market?",
     "Post-purchase flows fire at arbitrary intervals by default. If your email fires at day 60 but customers who return typically do so at day 21, you are missing the conversion window by 6 weeks.",
     "The single structural input that sets trigger timing for every Klaviyo post-purchase flow. Run once per market segment — US and UK median values should drive different flow timing.",
     "queries/metrics.sql — Metric 12"),
    (3,"#7c3aed","M13","src-klaviyo","Klaviyo","Churn Risk Distribution",
     "How many active customers are predicted to churn in the next 90 days — and how is risk distributed?",
     "Churn is invisible until it registers in revenue, typically 2–3 months after the behaviour change. Klaviyo's predictive score gives a 30–90 day early warning. Without it, you win-back customers who have already bought elsewhere.",
     "Win-back is 5–7× cheaper than new acquisition. Acting on predicted churn before it happens is the highest-ROI retention lever. Knowing the distribution tells you the scale of risk and whether it requires urgent budget reallocation.",
     "queries/metrics.sql — Metric 13"),
    (3,"#e11d48","M14","src-klaviyo","Klaviyo","At-Risk Revenue",
     "What is the total predicted 12-month CLV of customers currently flagged as high-risk or winback?",
     "Retention investment decisions require a dollar figure. '500 at-risk customers' doesn't move a budget conversation. '$180K in predicted CLV is at risk this quarter' does.",
     "Converts churn probability into a concrete revenue line. If 30% of at-risk CLV can be recovered, the expected recovery amount directly sets the maximum viable spend on win-back flows and incentives.",
     "queries/metrics.sql — Metric 14"),
    (3,"#e11d48","M15","src-matrixify","Matrixify","Product Repeat Rate (Top 10)",
     "Which specific SKUs are most effective at bringing customers back — regardless of what they buy next?",
     "Not all products are equal as relationship openers. A low-priced sampler might generate more lifetime value than a premium SKU by pulling customers into repeat purchase behaviour. Without this view, acquisition targets high-margin products that may not retain.",
     "Identifies gateway SKUs — the products that open long-term customer relationships. These are your highest-value acquisition targets and top subscription conversion candidates.",
     "queries/metrics.sql — Metric 15"),
    (3,"#0d9488","BONUS","src-matrixify","Matrixify","LTV by Market",
     "Are US, UK, and India customers worth the same over their lifetime — or should each market have a different CAC ceiling?",
     "Applying the same CAC ceiling to all markets is wrong if LTV differs significantly. If UK customers have 2× the LTV of US customers, you are systematically overspending in the US and underspending in the UK.",
     "The market-level LTV split determines the correct CAC ceiling per geography — the primary input for media budget allocation. A market with 50% higher LTV can justify 50% higher CAC before the same 3:1 ratio breaks.",
     "queries/metrics.sql — BONUS query"),
]

TIER_META = {
    1: ("Tier 1 — Business Health", "Weekly Review", "#d97706"),
    2: ("Tier 2 — Growth Levers", "Weekly Review", "#0d9488"),
    3: ("Tier 3 — Retention Intelligence", "Monthly Review", "#7c3aed"),
}

def chevron_svg():
    return '<svg class="m-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4,6 8,10 12,6"/></svg>'

def build_accordion():
    lines = ['<div class="m-accordion">']
    cur_tier = None
    for (tier, color, mid, src_cls, src_lbl, name, q, prob, why, sql) in METRICS:
        if tier != cur_tier:
            cur_tier = tier
            label, freq, tc = TIER_META[tier]
            lines.append(f'''
  <div class="m-tier-header">
    <span class="tier-dot" style="background:{tc}"></span>
    {label}
    <span style="margin-left:auto;font-size:.68rem;font-weight:600;color:var(--text3)">{freq}</span>
  </div>''')
        lines.append(f'''
  <details class="m-row" style="--accent:{color}">
    <summary class="m-row-summary">
      <span class="m-badge" style="background:{color}">{mid}</span>
      <span class="m-name">{name}</span>
      <span class="m-question">{q}</span>
      <span class="src-badge {src_cls}" style="flex-shrink:0">{src_lbl}</span>
      {chevron_svg()}
    </summary>
    <div class="m-row-body">
      <div class="m-cell">
        <div class="m-cell-label" style="color:{color}">Problem it solves</div>
        <p>{prob}</p>
      </div>
      <div class="m-cell">
        <div class="m-cell-label" style="color:#16a34a">Why it is important</div>
        <p>{why}</p>
      </div>
      <div class="m-cell">
        <div class="m-cell-label" style="color:var(--text3)">SQL Reference</div>
        <p style="font-family:monospace;font-size:.78rem">{sql}</p>
      </div>
    </div>
  </details>''')
    lines.append('</div>')
    return "\n".join(lines)


# ── 3. REPLACE the dense registry block ──────────────────────────────────────
# The registry block starts with the injected <div style="margin-top:56px"> and
# ends with </div> just before </div></section> of the overview section.

START_MARKER = '\n<div style="margin-top:56px">\n  <div class="section-label" style="color:var(--purple);margin-bottom:8px">Metric Registry</div>'

# Find it and replace everything up to the closing </div> of that block
if START_MARKER not in html:
    print("ERROR: registry start marker not found")
    exit(1)

start_idx = html.index(START_MARKER)

# The registry block ends at the </div> that closes <div style="margin-top:56px">
# We need to find the matching closing </div>
search_from = start_idx + len(START_MARKER)
depth = 1
i = search_from
while i < len(html) and depth > 0:
    open_tag = html.find('<div', i)
    close_tag = html.find('</div>', i)
    if open_tag == -1: open_tag = len(html)
    if close_tag == -1: close_tag = len(html)
    if open_tag < close_tag:
        depth += 1
        i = open_tag + 4
    else:
        depth -= 1
        i = close_tag + 6

end_idx = i  # character just after the final </div>

old_block = html[start_idx:end_idx]
new_block = "\n" + build_accordion()
html = html[:start_idx] + new_block + html[end_idx:]

# ── 4. WRAP question groups in <details> for collapsibility ───────────────────
# Each group starts with <div class="q-group"> and ends with </div>
# Wrap in <details class="q-group-wrap"><summary>..header..</summary>..grid..</details>

def wrap_q_groups(html_text):
    result = []
    pos = 0
    pattern = '<div class="q-group">'
    while True:
        idx = html_text.find(pattern, pos)
        if idx == -1:
            result.append(html_text[pos:])
            break
        result.append(html_text[pos:idx])

        # Find where this q-group ends (matching </div>)
        depth = 1
        i = idx + len(pattern)
        while i < len(html_text) and depth > 0:
            o = html_text.find('<div', i)
            c = html_text.find('</div>', i)
            if o == -1: o = len(html_text)
            if c == -1: c = len(html_text)
            if o < c:
                depth += 1; i = o + 4
            else:
                depth -= 1; i = c + 6
        group_end = i

        group_html = html_text[idx:group_end]

        # Extract the header block text (for the summary label)
        hdr = re.search(r'<span class="q-group-title">([^<]+)</span>', group_html)
        sub = re.search(r'<span class="q-group-sub">([^<]+)</span>', group_html)
        icon = re.search(r'<span class="q-group-icon">([^<]+)</span>', group_html)
        title_text = hdr.group(1) if hdr else "Group"
        sub_text = sub.group(1) if sub else ""
        icon_text = icon.group(1) if icon else ""

        # Split group into header + grid
        grid_start = group_html.find('<div class="q-grid">')
        header_part = group_html[:grid_start]
        grid_part = group_html[grid_start:-6]  # trim outer </div>

        chevron = '<svg class="q-chevron" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5,7 9,11 13,7"/></svg>'

        wrapped = f'''<details class="q-group-wrap" open>
<summary>
<div class="q-group-header" style="display:flex;align-items:center">
  <span class="q-group-icon">{icon_text}</span>
  <span class="q-group-title">{title_text}</span>
  <span class="q-group-sub" style="margin-left:12px">{sub_text}</span>
  {chevron}
</div>
</summary>
{grid_part}
</details>
'''
        result.append(wrapped)
        pos = group_end

    return "".join(result)

html = wrap_q_groups(html)

# ── 5. WRITE ─────────────────────────────────────────────────────────────────
HTML.write_text(html, encoding="utf-8")
import re as _re
acc = len(_re.findall(r'class="m-row"', html))
grp = len(_re.findall(r'class="q-group-wrap"', html))
kb  = round(len(html)/1024, 1)
print(f"Done. {acc} accordion rows, {grp} collapsible groups. Final size: {kb} KB")
