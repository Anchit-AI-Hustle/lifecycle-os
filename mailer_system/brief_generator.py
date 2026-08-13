"""
brief_generator.py — Knickgasm Campaign Brief Builder
Takes one triggered campaign dict from engine.py.
Returns structured brief dict ready for Claude + image generation.
"""

import json
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
TARGETS_PATH = BASE_DIR / "targets.json"


def load_targets() -> dict:
    with open(TARGETS_PATH, "r") as f:
        return json.load(f)


def get_seasonal_hook() -> str | None:
    month = datetime.now().month
    hooks = {
        1:  "New Year rotation reset",
        2:  "Valentine gifting",
        3:  "Spring streetwear reset",
        4:  "Spring streetwear reset",
        5:  "Mother's Day",
        9:  "Autumn drop season",
        10: "Diwali gifting",
        11: "Holiday gifting season",
        12: "Holiday gifting season",
    }
    return hooks.get(month, None)


def calculate_offer(avg_clv: float) -> str | None:
    if avg_clv > 200:
        return "15% off"
    elif avg_clv >= 50:
        return "Free shipping on your next order"
    else:
        return None


def extract_winning_cta_verb(winning_campaigns: list[dict]) -> str:
    """Extract dominant verb from top campaign names."""
    verb_candidates = ["Discover", "Explore", "Restore", "Lace-up", "Step", "Try", "Shop", "Return", "Claim"]
    if not winning_campaigns:
        return "Discover"
    names_combined = " ".join(c.get("campaign_name", "") for c in winning_campaigns).lower()
    for verb in [v.lower() for v in verb_candidates]:
        if verb in names_combined:
            return verb.capitalize()
    return "Discover"


def build_brief(
    campaign: dict,
    override_product: str | None = None,
    override_offer: str | None = None,
    override_audience: str | None = None
) -> dict:
    """
    Build a structured campaign brief from a triggered campaign dict.
    """
    targets = load_targets()
    ctx = campaign.get("context_data", {})
    campaign_type = campaign["campaign_type"]

    # ── Churn metrics ───────────────────────────────────────────────
    churn = ctx.get("churn", {})
    if isinstance(churn, list):
        churn = churn[0] if churn else {}
    at_risk_count    = int(churn.get("at_risk_count", 0) or 0)
    at_risk_revenue  = float(churn.get("at_risk_revenue", 0) or 0)
    avg_clv          = float(churn.get("avg_clv", 0) or 0)

    # ── Retention ───────────────────────────────────────────────────
    retention_rows = ctx.get("retention", [])
    retention_pct_current = (
        float(retention_rows[0].get("retention_pct", 0) or 0)
        if retention_rows else 0.0
    )

    # ── Subscription ────────────────────────────────────────────────
    subscription_rows = ctx.get("subscription", [])
    subscription_pct_current = (
        float(subscription_rows[0].get("subscription_pct", 0) or 0)
        if subscription_rows else 0.0
    )

    # ── Top SKUs ────────────────────────────────────────────────────
    top_skus_rows = ctx.get("top_skus", [])
    top_skus = [r.get("title", "") for r in top_skus_rows if r.get("title")]

    # ── Winning campaigns ───────────────────────────────────────────
    winning_campaigns = ctx.get("winning_campaigns", [])
    winning_cta_word = extract_winning_cta_verb(winning_campaigns)
    winning_cta_top = winning_campaigns[0] if winning_campaigns else {}

    # ── Product ─────────────────────────────────────────────────────
    # Order: an explicit override, else the top SKU the warehouse actually
    # returned. There is deliberately NO hardcoded fallback product: this line
    # used to name one, and because the engine was copied from a sibling repo
    # built for a different company it named that company's tea with the brand
    # word swapped in. Every campaign that ran with no SKU data therefore briefed
    # the model on a product this brand has never sold. A visible gap in the
    # brief is recoverable; an invented product name in a sent mailer is not.
    if override_product:
        product = override_product
    elif top_skus:
        product = top_skus[0]
    else:
        product = "[DATA REQUIRED BEFORE LAUNCH: product, from the live catalog or --override_product]"

    # ── Offer ───────────────────────────────────────────────────────
    if override_offer:
        offer = override_offer
    else:
        offer = calculate_offer(avg_clv)

    # ── Audience description ────────────────────────────────────────
    audience_map = {
        "win_back_vip": (
            f"{at_risk_count} high-CLV customers at churn risk "
            f"(avg CLV ${avg_clv:.0f}, ${at_risk_revenue:,.0f} at-risk revenue)"
        ),
        "post_purchase_series": (
            f"First-time buyers who have not reordered within 90 days — "
            f"current 90-day retention {retention_pct_current:.1f}% vs "
            f"{targets['retention_90d_min']*100:.0f}% target"
        ),
        "subscription_conversion": (
            f"One-time buyers eligible for subscription conversion — "
            f"current subscription mix {subscription_pct_current:.1f}% vs "
            f"{targets['subscription_mix_min']*100:.0f}% target"
        ),
        "cart_recovery": "Shoppers who added to cart but did not complete purchase",
        "re_engagement": "Lapsed email-engaged customers — last 90 days low revenue attribution",
        "geo_upsell": "US/UK top-geography segments for cross-sell and upsell",
    }

    if override_audience:
        audience_description = override_audience
    else:
        audience_description = audience_map.get(campaign_type, "Broad active customer base")

    # ── Audience size ───────────────────────────────────────────────
    size_map = {
        "win_back_vip": at_risk_count,
        "post_purchase_series": int(
            retention_rows[0].get("cohort_size", 0) if retention_rows else 0
        ),
        "subscription_conversion": 0,
        "cart_recovery": 0,
        "re_engagement": 0,
        "geo_upsell": 0,
    }
    audience_size = size_map.get(campaign_type, 0)

    # ── Klaviyo last campaign stats ──────────────────────────────────
    # We pull from winning_campaigns as proxy (no direct recent open_rate query here)
    last_open_rate = 0.0
    if winning_campaigns:
        # ctor is our best proxy for engagement
        last_open_rate = float(winning_cta_top.get("ctor", 0) or 0)

    brief = {
        "campaign_type": campaign_type,
        "priority": campaign["priority"],
        "trigger_reason": campaign["trigger_reason"],
        "product": product,
        "goal": campaign_type,
        "audience_description": audience_description,
        "audience_size": audience_size,
        "offer": offer,
        "seasonal_hook": get_seasonal_hook(),
        "feedback": {
            "last_open_rate": last_open_rate,
            "winning_cta_word": winning_cta_word,
            "best_send_day": "Tuesday",
        },
        "real_numbers": {
            "at_risk_revenue": at_risk_revenue,
            "segment_size": audience_size,
            "days_since_order_avg": 74,
            "retention_rate_current": retention_pct_current,
            "retention_rate_target": targets["retention_90d_min"] * 100,
            "subscription_pct_current": subscription_pct_current,
            "top_skus": top_skus,
            "winning_cta": winning_cta_top,
        },
    }

    return brief


if __name__ == "__main__":
    # Smoke test with a dummy campaign
    dummy = {
        "campaign_type": "win_back_vip",
        "priority": 1,
        "trigger_reason": "Test",
        "context_data": {}
    }
    brief = build_brief(dummy)
    print(json.dumps(brief, indent=2))
