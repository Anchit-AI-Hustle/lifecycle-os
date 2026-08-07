"""
KNICKGASM Lifecycle OS — Data Analysis + Ads Analytics (Streamlit in Snowflake).

Runs NATIVELY inside Snowflake. Authentication and warehouse come from the
logged-in Snowflake session via get_active_session() — no external keys, no PAT,
no Supabase. Every figure is read directly (read-only) from the warehouse tables
the Daton / Maplemonk pipelines already load. Charts use Altair (not Plotly).

Two sections, matching the web app's two dashboards so the SAME analysis renders
on both surfaces (parity comes from ONE source of truth — these Snowflake tables +
the ONE metric catalog below, mirrored field-for-field from the web app's
api/_shared/ad-metrics-catalog.js so a metric is defined once and computed
identically everywhere):

  • Data Analysis  — source/connector status, portfolio KPIs, budget pacing vs
    the Target $1,000/day & Costco $300/day caps, the full metric catalog
    (definition + formula per metric) and a live accuracy calculator.
  • Ads Analytics  — Meta / Google / TikTok, per campaign and per ad, plus
    demographic / geo / device cohorts for the Costco + Target US accounts.

Deploy: snowflake/streamlit/deploy.sql (CREATE STREAMLIT ...). Snowflake mints
the app URL when the Streamlit object is created in the account.
"""

import altair as alt
import pandas as pd
import streamlit as st
from snowflake.snowpark.context import get_active_session

# ── Session (always) ─────────────────────────────────────────────────────────
session = get_active_session()

st.set_page_config(page_title="KNICKGASM Analytics", layout="wide")

# Brand palette (docs/CLAUDE.md — the only four colours)
GREEN, LAVA, INK, CHALK = "#D0473E", "#6A33D8", "#111111", "#FFFFFF"

# ── Source tables (verified live against the warehouse) ──────────────────────
META_ADS = "KNICKGASM_DB.MAPLEMONK.META_USA_ADS_INSIGHTS"
META_AGE_GENDER = "KNICKGASM_DB.MAPLEMONK1.META_USA_ADS_INSIGHTS_AGE_AND_GENDER"
META_DEVICE = "KNICKGASM_DB.MAPLEMONK1.META_USA_ADS_INSIGHTS_PLATFORM_AND_DEVICE"
TIKTOK = {
    "campaign": "DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY",
    "adgroup": "DATON.RAW.TIKTOK_ADS_USA_ADGROUP_REPORT_DAILY",
    "ad": "DATON.RAW.TIKTOK_ADS_USA_AD_REPORT_DAILY",
    "age_gender": "DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY_AGE_GENDER",
    "country": "DATON.RAW.TIKTOK_ADS_USA_CAMPAIGN_REPORT_DAILY_COUNTRY",
}
GOOGLE_ADS = "KNICKGASM_DB.MAPLEMONK.GOOGLE_ADS_USA"

# Daily budget caps (USD). Reference/alerting only — nothing is ever written back.
BUDGETS = {"target": 1000, "costco": 300}


# ── ONE metric catalog — mirrors api/_shared/ad-metrics-catalog.js ────────────
# Keep in lock-step with the JS catalog: same keys, categories, formulas. base =
# read directly from the platform; derived = computed by the formula shown. Ratios
# guard the denominator and return None (never a fabricated 0) when inputs are
# missing, so "no data" never masquerades as a real figure.
CATEGORIES = [
    ("delivery", "Delivery & Reach", "How widely and how often the ad was served."),
    ("cost", "Cost & Efficiency", "What each unit of delivery/result costs."),
    ("click", "Click Engagement", "Clicks and click-through behaviour."),
    ("video", "Video Engagement", "Hook, hold and completion of video creative."),
    ("conversion", "Conversion & Value", "Purchases, revenue and return."),
    ("landing", "Landing Page", "What happens after the click, on the page."),
    ("experiment", "Experiment (A/B)", "Variant lift, confidence and significance."),
]


def _n(x):
    try:
        if x is None or x == "" or pd.isna(x):
            return None
        return float(x)
    except (TypeError, ValueError):
        return None


def _div(a, b):
    a, b = _n(a), _n(b)
    return None if (a is None or not b) else a / b


def _pct(a, b):
    r = _div(a, b)
    return None if r is None else r * 100


# Each metric: key, label, category, unit, tier, inputs, formula, def, compute(r).
METRICS = [
    # Delivery & Reach
    ("impressions", "Impressions", "delivery", "int", "base", ["impressions"], "impressions (as served)", "Times the ad was shown.", lambda r: _n(r.get("impressions"))),
    ("reach", "Reach", "delivery", "int", "base", ["reach"], "reach (unique people)", "Unique people who saw the ad.", lambda r: _n(r.get("reach"))),
    ("frequency", "Frequency", "delivery", "ratio", "derived", ["impressions", "reach"], "impressions / reach", "Average times each person saw the ad. Watch for fatigue above ~2-3.", lambda r: _div(r.get("impressions"), r.get("reach"))),
    # Cost & Efficiency
    ("spend", "Amount spent", "cost", "usd", "base", ["spend"], "spend", "Total amount spent.", lambda r: _n(r.get("spend"))),
    ("cpm", "CPM (cost / 1,000 impressions)", "cost", "usd", "derived", ["spend", "impressions"], "spend / impressions x 1000", "Cost to reach a thousand impressions.", lambda r: (lambda d: None if d is None else d * 1000)(_div(r.get("spend"), r.get("impressions")))),
    ("cpc", "CPC (cost / link click)", "cost", "usd", "derived", ["spend", "inline_link_clicks"], "spend / link clicks", "Cost per link click.", lambda r: _div(r.get("spend"), r.get("inline_link_clicks"))),
    ("cpp", "Cost per 1,000 reached (CPP)", "cost", "usd", "derived", ["spend", "reach"], "spend / reach x 1000", "Cost to reach a thousand unique people.", lambda r: (lambda d: None if d is None else d * 1000)(_div(r.get("spend"), r.get("reach")))),
    ("cost_per_reach", "Cost per reach", "cost", "usd4", "derived", ["spend", "reach"], "spend / reach", "Cost per unique person reached.", lambda r: _div(r.get("spend"), r.get("reach"))),
    ("cost_per_3s", "Cost per 3-sec video play", "cost", "usd", "derived", ["spend", "video_3s"], "spend / 3-sec plays", "Cost per 3-second (hook) view.", lambda r: _div(r.get("spend"), r.get("video_3s"))),
    ("cost_per_thruplay", "Cost per ThruPlay", "cost", "usd", "derived", ["spend", "thruplays"], "spend / thruplays", "Cost per ThruPlay (15s or complete).", lambda r: _div(r.get("spend"), r.get("thruplays"))),
    ("cost_per_purchase", "Cost per purchase (CPA)", "cost", "usd", "derived", ["spend", "purchases"], "spend / purchases", "Acquisition cost per purchase.", lambda r: _div(r.get("spend"), r.get("purchases"))),
    ("cost_per_lpv", "Cost per landing-page view", "cost", "usd", "derived", ["spend", "landing_page_views"], "spend / landing-page views", "Cost per fully-loaded landing-page view.", lambda r: _div(r.get("spend"), r.get("landing_page_views"))),
    # Click Engagement
    ("clicks", "Clicks (all)", "click", "int", "base", ["clicks"], "clicks", "All clicks (incl. non-link).", lambda r: _n(r.get("clicks"))),
    ("link_clicks", "Link clicks", "click", "int", "base", ["inline_link_clicks"], "inline_link_clicks", "Clicks on the ad link.", lambda r: _n(r.get("inline_link_clicks"))),
    ("ctr", "CTR (all clicks)", "click", "pct", "derived", ["clicks", "impressions"], "clicks / impressions x 100", "Click-through rate on all clicks.", lambda r: _pct(r.get("clicks"), r.get("impressions"))),
    ("link_ctr", "Link CTR", "click", "pct", "derived", ["inline_link_clicks", "impressions"], "link clicks / impressions x 100", "Click-through rate on link clicks (the honest CTR).", lambda r: _pct(r.get("inline_link_clicks"), r.get("impressions"))),
    ("outbound_ctr", "Outbound CTR", "click", "pct", "derived", ["outbound_clicks", "impressions"], "outbound clicks / impressions x 100", "Clicks that left the platform, per impression.", lambda r: _pct(r.get("outbound_clicks"), r.get("impressions"))),
    ("unique_ctr", "Unique link CTR", "click", "pct", "derived", ["inline_link_clicks", "reach"], "link clicks / reach x 100", "Link clicks per unique person reached.", lambda r: _pct(r.get("inline_link_clicks"), r.get("reach"))),
    # Video Engagement (hook -> hold -> through funnel)
    ("video_3s", "3-second video plays", "video", "int", "base", ["video_3s"], "3-sec plays", "Plays of at least 3 seconds (the hook).", lambda r: _n(r.get("video_3s"))),
    ("thruplays", "ThruPlays", "video", "int", "base", ["thruplays"], "thruplays", "Plays to completion or 15s.", lambda r: _n(r.get("thruplays"))),
    ("video_p25", "Video plays 25%", "video", "int", "base", ["video_p25"], "p25 watched", "Reached 25% of the video.", lambda r: _n(r.get("video_p25"))),
    ("video_p50", "Video plays 50%", "video", "int", "base", ["video_p50"], "p50 watched", "Reached 50%.", lambda r: _n(r.get("video_p50"))),
    ("video_p75", "Video plays 75%", "video", "int", "base", ["video_p75"], "p75 watched", "Reached 75%.", lambda r: _n(r.get("video_p75"))),
    ("video_p100", "Video plays 100%", "video", "int", "base", ["video_p100"], "p100 watched", "Watched to the end.", lambda r: _n(r.get("video_p100"))),
    ("hook_rate", "Hook Rate", "video", "pct", "derived", ["video_3s", "impressions"], "3-sec plays / impressions x 100", "Share of impressions that stopped to watch 3s. Creative-hook strength.", lambda r: _pct(r.get("video_3s"), r.get("impressions"))),
    ("hold_rate", "Hold Rate", "video", "pct", "derived", ["thruplays", "impressions"], "thruplays / impressions x 100", "Share of impressions held to ThruPlay (15s/complete). Retention strength.", lambda r: _pct(r.get("thruplays"), r.get("impressions"))),
    ("through_rate", "Through Rate (completion)", "video", "pct", "derived", ["video_p100", "impressions"], "100% plays / impressions x 100", "Share of impressions that watched to the end.", lambda r: _pct(r.get("video_p100"), r.get("impressions"))),
    ("hook_to_hold", "Hook -> Hold retention", "video", "pct", "derived", ["thruplays", "video_3s"], "thruplays / 3-sec plays x 100", "Of those hooked, how many held. Isolates mid-video drop-off.", lambda r: _pct(r.get("thruplays"), r.get("video_3s"))),
    ("completion_of_starts", "Completion of starts", "video", "pct", "derived", ["video_p100", "video_3s"], "100% plays / 3-sec plays x 100", "Of viewers who started, how many finished.", lambda r: _pct(r.get("video_p100"), r.get("video_3s"))),
    # Conversion & Value
    ("purchases", "Purchases", "conversion", "int", "base", ["purchases"], "purchases", "Attributed purchases.", lambda r: _n(r.get("purchases"))),
    ("purchase_value", "Purchase value", "conversion", "usd", "base", ["purchase_value"], "conversion value", "Attributed revenue.", lambda r: _n(r.get("purchase_value"))),
    ("roas", "ROAS", "conversion", "ratio", "derived", ["purchase_value", "spend"], "purchase value / spend", "Return on ad spend.", lambda r: _div(r.get("purchase_value"), r.get("spend"))),
    ("cvr", "Conversion rate (CVR)", "conversion", "pct", "derived", ["purchases", "inline_link_clicks"], "purchases / link clicks x 100", "Purchases per link click.", lambda r: _pct(r.get("purchases"), r.get("inline_link_clicks"))),
    ("aov", "AOV (attributed)", "conversion", "usd", "derived", ["purchase_value", "purchases"], "purchase value / purchases", "Average order value of attributed purchases.", lambda r: _div(r.get("purchase_value"), r.get("purchases"))),
    # Landing Page
    ("landing_page_views", "Landing-page views", "landing", "int", "base", ["landing_page_views"], "landing_page_view actions", "Fully-loaded landing-page views after the click.", lambda r: _n(r.get("landing_page_views"))),
    ("lpv_rate", "LP-view rate (load quality)", "landing", "pct", "derived", ["landing_page_views", "inline_link_clicks"], "landing-page views / link clicks x 100", "Share of clicks that actually loaded the page. Low = slow page / drop-off.", lambda r: _pct(r.get("landing_page_views"), r.get("inline_link_clicks"))),
    ("click_to_lpv_dropoff", "Click->LPV drop-off", "landing", "pct", "derived", ["landing_page_views", "inline_link_clicks"], "100 - LP-view rate", "Clicks lost before the page loaded.", lambda r: (lambda p: None if p is None else 100 - p)(_pct(r.get("landing_page_views"), r.get("inline_link_clicks")))),
    ("lp_bounce_rate", "LP bounce rate", "landing", "pct", "derived", ["bounces", "sessions"], "bounces / sessions x 100  (PageDeck)", "Single-page sessions on the landing page.", lambda r: _pct(r.get("bounces"), r.get("sessions"))),
    ("lp_conversion_rate", "LP conversion rate", "landing", "pct", "derived", ["lp_conversions", "sessions"], "LP conversions / sessions x 100  (PageDeck)", "Conversions per landing-page session.", lambda r: _pct(r.get("lp_conversions"), r.get("sessions"))),
    ("avg_time_on_page", "Avg time on page", "landing", "sec", "base", ["time_on_page"], "avg session duration (PageDeck)", "Average time on the landing page.", lambda r: _n(r.get("time_on_page"))),
    # Experiment (A/B — PageDeck)
    ("variant_lift", "Variant lift", "experiment", "pct", "derived", ["variant_rate", "control_rate"], "(variant - control) / control x 100", "Relative lift of the variant over control.", lambda r: (lambda v, c: None if (v is None or not c) else (v - c) / c * 100)(_n(r.get("variant_rate")), _n(r.get("control_rate")))),
    ("confidence", "Confidence", "experiment", "pct", "base", ["confidence"], "statistical confidence (PageDeck)", "Probability the lift is real (>=95% to call).", lambda r: _n(r.get("confidence"))),
]
CAT_LABEL = {k: lbl for k, lbl, _ in CATEGORIES}
# derived key -> platform-reported field to cross-check for the accuracy drift test
SOURCED_EQUIVALENT = {"ctr": "ctr", "cpc": "cpc", "cpm": "cpm", "frequency": "frequency", "link_ctr": "inline_link_click_ctr"}


def compute_all(r):
    out = {}
    for key, _lbl, _cat, _u, _t, _inp, _f, _d, fn in METRICS:
        try:
            out[key] = fn(r or {})
        except Exception:  # noqa: BLE001
            out[key] = None
    return out


def catalog_df():
    rows = []
    for key, lbl, cat, unit, tier, inp, formula, dfn, _fn in METRICS:
        rows.append({
            "Category": CAT_LABEL[cat], "Metric": lbl, "Key": key, "Tier": tier,
            "Unit": unit, "Formula": formula, "Inputs": ", ".join(inp), "Definition": dfn,
        })
    return pd.DataFrame(rows)


def accuracy(records):
    """Mirror of ad-metrics-catalog.js accuracy(): per-metric coverage +
    agreement vs the platform-reported value, and an overall confidence label."""
    rows = list(records or [])
    per = []
    for key, lbl, cat, _u, _t, inp, _f, _d, fn in METRICS:
        covered, agree_sum, agree_n = 0, 0.0, 0
        for r in rows:
            if all(_n(r.get(f)) is not None for f in inp):
                covered += 1
            src = SOURCED_EQUIVALENT.get(key)
            if src and _n(r.get(src)) is not None:
                derived, sourced = fn(r), _n(r.get(src))
                if derived is not None and sourced:
                    agree_n += 1
                    agree_sum += max(0.0, 1 - abs(derived - sourced) / abs(sourced))
        coverage = covered / len(rows) if rows else 0
        agreement = (agree_sum / agree_n) if agree_n else None
        if coverage >= 0.9 and (agreement is None or agreement >= 0.98):
            conf = "high"
        elif coverage >= 0.6:
            conf = "medium"
        elif coverage > 0:
            conf = "low"
        else:
            conf = "unavailable"
        per.append({
            "Category": CAT_LABEL[cat], "Metric": lbl, "Coverage %": round(coverage * 1000) / 10,
            "Cross-checked": "yes" if agree_n else "no",
            "Agreement %": None if agreement is None else round(agreement * 1000) / 10,
            "Confidence": conf,
        })
    return pd.DataFrame(per)


# ── Query helpers ─────────────────────────────────────────────────────────────
@st.cache_data(ttl=600, show_spinner=False)
def q(sql: str) -> pd.DataFrame:
    """Run a read-only query and return a DataFrame (lower-cased columns)."""
    df = session.sql(sql).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    return df


def acct_clause(col: str, account: str) -> str:
    if not account:
        return ""
    a = account.lower().replace("'", "")
    return f" and lower({col}) like '%{a}%'"


def date_clause(col: str, since, until) -> str:
    if not since or not until:
        return ""
    return f" and {col} between '{since}' and '{until}'"


def money(v):
    return "—" if v is None or (isinstance(v, float) and pd.isna(v)) else f"${v:,.0f}"


def pctf(v):
    return "—" if v is None or (isinstance(v, float) and pd.isna(v)) else f"{v:.2f}%"


# Meta base-table columns verified: spend, impressions, reach, frequency, clicks,
# inline_link_clicks, inline_link_click_ctr, cpc, cpm, ctr, account_name,
# campaign_name, ad_name, adset_name, date_start. Video quartiles live in separate
# child tables (not flattened yet) so hook/hold/through show 'unavailable' until wired.
def meta_rows(account, level, since, until):
    name_col = "ad_name" if level == "ad" else "campaign_name"
    where = "where 1=1" + acct_clause("account_name", account) + date_clause("date_start", since, until)
    sql = f"""
        select {name_col} as name,
               sum(spend) as spend, sum(impressions) as impressions, sum(reach) as reach,
               sum(clicks) as clicks, sum(inline_link_clicks) as inline_link_clicks,
               avg(frequency) as frequency, avg(ctr) as ctr, avg(cpc) as cpc, avg(cpm) as cpm,
               avg(inline_link_click_ctr) as inline_link_click_ctr
        from {META_ADS} {where}
        group by {name_col} order by spend desc nulls last limit 500
    """
    df = q(sql)
    if df.empty:
        return df
    # Derived metrics from the ONE catalog, so numbers match the web exactly.
    for key in ("cpm", "cpc", "cost_per_reach", "link_ctr"):
        fn = next(m[8] for m in METRICS if m[0] == key)
        df[key] = df.apply(lambda row, f=fn: f(row.to_dict()), axis=1)
    return df


def generic_rows(table):
    """Google / TikTok: recent rows with whatever columns exist. Daton/Maplemonk
    schemas vary, so pull recent rows rather than assume a date/account column."""
    try:
        return q(f"select * from {table} limit 500")
    except Exception as e:  # noqa: BLE001
        st.info(f"Could not read {table}: {e}")
        return pd.DataFrame()


# ── Sidebar: section + shared filters ────────────────────────────────────────
st.sidebar.title("KNICKGASM · Analytics")
section = st.sidebar.radio("Section", ["Data Analysis", "Ads Analytics"])
st.sidebar.markdown("---")
platform = st.sidebar.selectbox("Platform", ["Meta", "Google", "TikTok"])
account = st.sidebar.selectbox("Account", ["All", "target", "costco"])
account = "" if account == "All" else account
level = st.sidebar.selectbox("Level", ["campaign", "ad"])
today = pd.Timestamp.utcnow().normalize()
since = st.sidebar.date_input("Since", (today - pd.Timedelta(days=30)).date())
until = st.sidebar.date_input("Until", today.date())
window_days = max(1, (pd.Timestamp(until) - pd.Timestamp(since)).days + 1)
st.sidebar.markdown("---")
st.sidebar.caption(
    f"Daily budget caps (reference): Target ${BUDGETS['target']:,} · "
    f"Costco ${BUDGETS['costco']:,}. Read-only — never written back to any platform."
)


# ═════════════════════════════════════════════════════════════════════════════
# DATA ANALYSIS
# ═════════════════════════════════════════════════════════════════════════════
def render_data_analysis():
    st.title("Data Analysis")
    st.caption(
        "Portfolio view across the Costco + Target US ad accounts, sourced live "
        "from Snowflake via the active session. The metric catalog and accuracy "
        "calculator are the SAME definitions the web app uses. Read-only; nothing "
        "is fabricated — a metric with no inputs reads 'unavailable', not zero."
    )

    tab_status, tab_kpis, tab_catalog, tab_accuracy = st.tabs(
        ["Sources & budget", "Portfolio KPIs", "Metric catalog", "Accuracy calculator"]
    )

    # Sources / connector status + budget pacing
    with tab_status:
        st.subheader("Sources (read-only)")
        src = pd.DataFrame([
            {"Platform": "Meta", "Table": META_ADS, "Cohorts": "age/gender, platform/device"},
            {"Platform": "Meta (age x gender)", "Table": META_AGE_GENDER, "Cohorts": "age, gender"},
            {"Platform": "Meta (device)", "Table": META_DEVICE, "Cohorts": "device, placement"},
            {"Platform": "TikTok (campaign)", "Table": TIKTOK["campaign"], "Cohorts": "age/gender, country"},
            {"Platform": "TikTok (ad)", "Table": TIKTOK["ad"], "Cohorts": "—"},
            {"Platform": "Google", "Table": GOOGLE_ADS, "Cohorts": "segment tables"},
        ])
        st.dataframe(src, use_container_width=True, hide_index=True)
        st.caption("Authentication via get_active_session() — no PAT, no keys stored. The session role governs table access.")

        st.subheader("Budget pacing vs daily caps")
        try:
            pace = q(f"""
                select lower(account_name) as account, sum(spend) as spend, count(distinct date_start) as days
                from {META_ADS}
                where 1=1{date_clause('date_start', since, until)}
                group by lower(account_name) order by spend desc nulls last
            """)
        except Exception as e:  # noqa: BLE001
            pace = pd.DataFrame()
            st.info(f"Budget pacing unavailable: {e}")
        if not pace.empty:
            rows = []
            for _, r in pace.iterrows():
                acct = str(r["account"] or "")
                cap = next((v for k, v in BUDGETS.items() if k in acct), None)
                days = r["days"] or window_days
                avg_daily = (r["spend"] / days) if days else None
                rows.append({
                    "Account": acct or "(unnamed)",
                    "Spend (window)": money(r["spend"]),
                    "Avg daily spend": money(avg_daily),
                    "Daily cap": money(cap) if cap else "— (no mapped cap)",
                    "Pacing": (pctf(avg_daily / cap * 100) if (cap and avg_daily is not None) else "—"),
                })
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
            st.caption("Pacing = avg daily spend as a % of the daily cap. Caps are for reference/alerting only.")
        else:
            st.warning("No Meta spend rows in this window to pace against.")

    # Portfolio KPIs (Meta, whole window)
    with tab_kpis:
        df = meta_rows(account, level, since, until)
        if df.empty:
            st.warning("No Meta rows for this account / window.")
        else:
            spend, impr, reach = df["spend"].sum(), df["impressions"].sum(), df["reach"].sum()
            link_clicks = df["inline_link_clicks"].sum()
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Amount spent", money(spend))
            c2.metric("Impressions", f"{impr:,.0f}")
            c3.metric("Reach", f"{reach:,.0f}")
            c4.metric("Frequency", f"{(impr/reach):.2f}" if reach else "—")
            c5, c6, c7, c8 = st.columns(4)
            c5.metric("Link clicks", f"{link_clicks:,.0f}")
            c6.metric("Link CTR", pctf(link_clicks / impr * 100 if impr else None))
            c7.metric("CPC", money(spend / link_clicks if link_clicks else None))
            c8.metric("CPM", money(spend / impr * 1000 if impr else None))
            st.subheader("Spend share by " + ("ad" if level == "ad" else "campaign"))
            top = df.head(15)
            chart = (
                alt.Chart(top).mark_bar(color=GREEN).encode(
                    x=alt.X("spend:Q", title="Spend (USD)"),
                    y=alt.Y("name:N", sort="-x", title=None),
                    tooltip=["name", alt.Tooltip("spend:Q", format="$,.0f"),
                             alt.Tooltip("link_ctr:Q", format=".2f", title="Link CTR %")],
                ).properties(height=28 * len(top))
            )
            st.altair_chart(chart, use_container_width=True)

    # Metric catalog (definitions + formulas) — the single source of truth
    with tab_catalog:
        st.subheader(f"Metric catalog — {len(METRICS)} metrics across {len(CATEGORIES)} categories")
        st.caption(
            "Defined once, computed identically on this app and the web app "
            "(mirror of api/_shared/ad-metrics-catalog.js). base = read straight "
            "from the platform; derived = computed by the formula shown."
        )
        cat = catalog_df()
        pick = st.multiselect("Filter by category", [c[1] for c in CATEGORIES], default=[c[1] for c in CATEGORIES])
        st.dataframe(cat[cat["Category"].isin(pick)], use_container_width=True, hide_index=True, height=560)

    # Accuracy calculator — coverage + agreement over the live Meta rows
    with tab_accuracy:
        st.subheader("Accuracy calculator")
        st.caption(
            "Coverage = share of rows where every input for a metric is present. "
            "Agreement = how closely our derived value matches the platform's own "
            "reported value where one exists (drift check). Computed live over the "
            "Meta rows in the current filter."
        )
        df = meta_rows(account, level, since, until)
        if df.empty:
            st.warning("No rows to score. Widen the date range or clear the account filter.")
        else:
            acc = accuracy(df.to_dict("records"))
            counts = acc["Confidence"].value_counts()
            c1, c2, c3, c4, c5 = st.columns(5)
            c1.metric("Rows scored", f"{len(df):,}")
            c2.metric("High", int(counts.get("high", 0)))
            c3.metric("Medium", int(counts.get("medium", 0)))
            c4.metric("Low", int(counts.get("low", 0)))
            c5.metric("Unavailable", int(counts.get("unavailable", 0)))
            st.dataframe(acc, use_container_width=True, hide_index=True, height=520)
            st.caption(
                "Video metrics (hook/hold/through) read 'unavailable' until the Meta "
                "video-quartile child tables are flattened into the row — honest by design."
            )


# ═════════════════════════════════════════════════════════════════════════════
# ADS ANALYTICS
# ═════════════════════════════════════════════════════════════════════════════
def render_ads_analytics():
    st.title("Ads Analytics")
    st.caption(
        "Live from Snowflake via the active session — Meta / Google / TikTok, per "
        "campaign and per ad, for the Costco + Target US accounts. Priority metrics "
        "lead. Read-only; nothing is fabricated."
    )
    tab_overview, tab_rows, tab_cohorts = st.tabs(
        ["Overview & priority metrics", "Campaign / ad rows", "Cohorts & segmentation"]
    )

    with tab_overview:
        if platform == "Meta":
            df = meta_rows(account, level, since, until)
            if df.empty:
                st.warning("No Meta rows for this account / window.")
            else:
                spend, impr, reach = df["spend"].sum(), df["impressions"].sum(), df["reach"].sum()
                link_clicks = df["inline_link_clicks"].sum()
                c1, c2, c3, c4 = st.columns(4)
                c1.metric("Amount spent", money(spend))
                c2.metric("Impressions", f"{impr:,.0f}")
                c3.metric("Reach", f"{reach:,.0f}")
                c4.metric("Frequency", f"{(impr/reach):.2f}" if reach else "—")
                c5, c6, c7, c8 = st.columns(4)
                c5.metric("Link clicks", f"{link_clicks:,.0f}")
                c6.metric("Link CTR", pctf(link_clicks / impr * 100 if impr else None))
                c7.metric("CPC", money(spend / link_clicks if link_clicks else None))
                c8.metric("CPM", money(spend / impr * 1000 if impr else None))
                st.subheader("Spend by " + ("ad" if level == "ad" else "campaign"))
                top = df.head(15)
                chart = (
                    alt.Chart(top).mark_bar(color=GREEN).encode(
                        x=alt.X("spend:Q", title="Spend (USD)"),
                        y=alt.Y("name:N", sort="-x", title=None),
                        tooltip=["name", alt.Tooltip("spend:Q", format="$,.0f"),
                                 alt.Tooltip("link_ctr:Q", format=".2f", title="Link CTR %")],
                    ).properties(height=28 * len(top))
                )
                st.altair_chart(chart, use_container_width=True)
        else:
            table = GOOGLE_ADS if platform == "Google" else TIKTOK[level if level in TIKTOK else "campaign"]
            st.info(
                f"{platform}: showing recent rows from `{table}`. Column-level metric "
                "mapping for this source is being finalised; Meta has the full computed "
                "priority set."
            )
            st.dataframe(generic_rows(table), use_container_width=True, height=460)

    with tab_rows:
        st.subheader(f"{platform} — per {level}")
        if platform == "Meta":
            df = meta_rows(account, level, since, until)
            if df.empty:
                st.warning("No rows for this selection.")
            else:
                cols = ["name", "spend", "impressions", "reach", "frequency",
                        "inline_link_clicks", "link_ctr", "ctr", "cpc", "cpm", "cost_per_reach"]
                st.dataframe(df[cols], use_container_width=True, height=520)
        else:
            table = GOOGLE_ADS if platform == "Google" else TIKTOK[level if level in TIKTOK else "campaign"]
            st.dataframe(generic_rows(table), use_container_width=True, height=520)

    with tab_cohorts:
        st.subheader("Demographic, geo & device cohorts")
        st.caption(
            "Built from the platform's own delivery-breakdown tables (Meta age/gender "
            "& platform/device; TikTok age/gender & country). Use these as experiment "
            "audiences across Meta / Google / TikTok."
        )

        def cohort_chart(df, dim_col, title):
            if df.empty or dim_col not in df.columns:
                st.info(f"No data for {title}.")
                return
            g = df.groupby(dim_col, as_index=False)["spend"].sum().sort_values("spend", ascending=False).head(25)
            ch = (
                alt.Chart(g).mark_bar(color=LAVA).encode(
                    x=alt.X("spend:Q", title="Spend (USD)"),
                    y=alt.Y(f"{dim_col}:N", sort="-x", title=title),
                    tooltip=[dim_col, alt.Tooltip("spend:Q", format="$,.0f")],
                ).properties(height=max(140, 26 * len(g)))
            )
            st.altair_chart(ch, use_container_width=True)

        if platform == "Meta":
            where = "where 1=1" + acct_clause("account_name", account) + date_clause("date_start", since, until)
            col1, col2 = st.columns(2)
            with col1:
                st.markdown("**Age x gender**")
                ag = q(f"select age, gender, sum(spend) as spend from {META_AGE_GENDER} {where} group by age, gender")
                if not ag.empty:
                    ag["cohort"] = ag["age"].astype(str) + " · " + ag["gender"].astype(str)
                    cohort_chart(ag, "cohort", "Age x gender")
            with col2:
                st.markdown("**Platform / device**")
                dv = q(f"select * from {META_DEVICE} {where} limit 5000")
                dim = next((c for c in ["impression_device", "device_platform", "platform_position", "publisher_platform"] if c in dv.columns), None)
                if dim:
                    cohort_chart(dv, dim, "Device / placement")
                else:
                    st.info("Device/placement dimension column not detected.")
        elif platform == "TikTok":
            col1, col2 = st.columns(2)
            with col1:
                st.markdown("**Age / gender**")
                ag = generic_rows(TIKTOK["age_gender"])
                dim = next((c for c in ["age", "gender", "age_gender"] if c in ag.columns), None)
                if dim and "spend" in ag.columns:
                    cohort_chart(ag, dim, "Age / gender")
                else:
                    st.dataframe(ag, use_container_width=True, height=360)
            with col2:
                st.markdown("**Country**")
                ct = generic_rows(TIKTOK["country"])
                dim = next((c for c in ["country", "country_code", "country_id"] if c in ct.columns), None)
                if dim and "spend" in ct.columns:
                    cohort_chart(ct, dim, "Country")
                else:
                    st.dataframe(ct, use_container_width=True, height=360)
        else:
            st.info("Google cohort breakdowns depend on the segment tables available; Meta/TikTok carry the richest demographic/geo splits.")


# ── Route ────────────────────────────────────────────────────────────────────
if section == "Data Analysis":
    render_data_analysis()
else:
    render_ads_analytics()

st.markdown("---")
st.caption("Source: Snowflake (Daton / Maplemonk) via get_active_session · read-only · Altair charts · one metric catalog shared with the web app.")
