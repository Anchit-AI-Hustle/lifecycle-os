# Knickgasm Mailer System

Automated D2C email campaign generator for Knickgasm India that queries `knickgasm_dtc.duckdb` across four schemas, evaluates six data-driven triggers in priority order, and uses the Claude API to produce production-ready branded HTML emails with matching metadata.

## Decision Trigger Table

| Priority | Name | Condition | Campaign Fired |
|----------|------|-----------|----------------|
| P1 | win_back_vip | at_risk_revenue > $50K AND avg_clv > $200 | High-CLV lapsed customer win-back |
| P2 | post_purchase_series | 90-day retention < 30% in 2+ of last 3 cohorts | New buyer nurture series |
| P3 | subscription_conversion | Subscription mix < 15% in 2+ of last 3 months | One-time → subscription push |
| P4 | cart_recovery | Cart abandonment > 80% in most recent week | Abandoned cart recovery |
| P5 | re_engagement | Email revenue % < 25% in 2+ of last 3 months | List re-engagement blast |
| P6 | geo_upsell | Always fires if no P1–P5 trigger activates | Monthly geo-targeted upsell |

## How to Run

```bash
# Full run — engine evaluates all triggers, generates mailers for each
python mailer_system/run_mailer_engine.py

# Dry run — build brief, skip API call, print brief JSON
python mailer_system/run_mailer_engine.py --campaign win_back_vip --override_product "Jordan First Flush" --dry_run

# List triggers — print all metric readings and which triggers fire
python mailer_system/run_mailer_engine.py --list_triggers

# Manual campaign override with product and offer overrides
python mailer_system/run_mailer_engine.py --campaign subscription_conversion --override_product "Hand-painted Kicks" --override_offer "20% off first subscription"
```

## Updating Targets

Edit `mailer_system/targets.json` to adjust thresholds:

| Field | Description |
|-------|-------------|
| `retention_90d_min` | Minimum 90-day retention rate (0.0–1.0) |
| `subscription_mix_min` | Minimum subscription revenue share (0.0–1.0) |
| `email_revenue_pct_min` | Minimum email-attributed revenue share (0.0–1.0) |
| `cart_abandonment_max` | Maximum tolerated cart abandonment rate (0.0–1.0) |
| `at_risk_revenue_trigger` | Dollar threshold to trigger win-back campaign |
| `churn_high_clv_threshold` | CLV floor to qualify a profile as high-value |
| `churn_days_since_order` | Days since last order to classify as lapsed |
| `email_list_health_min` | Minimum healthy list ratio |
| `ltv_us_target` | LTV target for US market ($) |
| `ltv_uk_target` | LTV target for UK market ($) |
| `aov_us_target` | Average order value target for US ($) |
| `gross_margin_min` | Minimum gross margin floor (0.0–1.0) |

## Output Files

Every successful run produces two files in `mailer_system/outputs/`:

- `{campaign_type}_{YYYYMMDD_HHMMSS}.html` — production-ready HTML email
- `{campaign_type}_{YYYYMMDD_HHMMSS}_meta.json` — metadata: brief, subject lines, preheader, CTA options, performance notes, token usage

Trigger decisions and metric readings are appended to `mailer_system/campaign_log.json` on every run.

## Environment Variable

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Required for API calls
```

The engine will exit with a clear error if `ANTHROPIC_API_KEY` is not set (except in `--dry_run` and `--list_triggers` modes).
