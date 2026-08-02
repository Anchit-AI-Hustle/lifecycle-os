import argparse
import json
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine import get_triggered_campaigns, load_targets, run_queries, evaluate_triggers, print_metric_report
from brief_generator import build_brief
from mailer_api import generate_mailer
from html_renderer import render

BANNER = "=" * 60
SEP = "-" * 60


def check_api_key():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("[error] Set ANTHROPIC_API_KEY environment variable")
        sys.exit(1)


def make_override_campaign(campaign_type):
    return {
        'campaign_type': campaign_type,
        'priority': 0,
        'trigger_reason': f'Manual override: --campaign {campaign_type}',
        'context_data': {
            'churn_signal': {'at_risk_count': 0, 'at_risk_revenue': 0.0, 'avg_clv': 0.0, 'avg_orders': 0.0},
            'retention': [],
            'subscription_mix': [],
            'cart_abandonment': [],
            'email_revenue': [],
            'top_skus': [],
            'winning_cta': [],
        },
    }


def apply_overrides(brief, args):
    if args.override_product:
        brief['product'] = args.override_product
        brief['real_numbers']['top_skus'] = [args.override_product]
    if args.override_offer:
        brief['offer'] = args.override_offer
    if args.audience:
        brief['audience_description'] = args.audience
    return brief


def run_list_triggers():
    targets = load_targets()
    print(f"\n{BANNER}")
    print(f"  KNICKGASM Trigger Report -- {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(BANNER)

    try:
        import duckdb
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'knickgasm_dtc.duckdb')
        conn = duckdb.connect(db_path, read_only=True)
        results = run_queries(conn, targets)
        conn.close()
    except Exception as e:
        print(f"[warn] Could not connect to database: {e}")
        results = {
            'churn_signal': {'at_risk_count': 0, 'at_risk_revenue': 0.0, 'avg_clv': 0.0, 'avg_orders': 0.0},
            'retention': [],
            'subscription_mix': [],
            'cart_abandonment': [],
            'email_revenue': [],
            'top_skus': [],
            'winning_cta': [],
        }

    print_metric_report(results, targets)

    triggered = evaluate_triggers(results, targets)
    print("-- Trigger Evaluation ----------------------------------------")
    for t in triggered:
        print(f"  [FIRE] P{t['priority']} {t['campaign_type']:<30} {t['trigger_reason']}")
    print(SEP + "\n")


def print_summary_table(summary_rows):
    w = 70
    print(f"\n{'-' * w}")
    print(f"  {'Campaign':<28} {'Segment':>10} {'At-Risk Rev':>14}  Output File")
    print(f"{'-' * w}")
    for row in summary_rows:
        print(f"  {row['campaign']:<28} {row['segment_size']:>10,} {row['at_risk_revenue']:>14}  {row['output_file']}")
    print(f"{'-' * w}\n")


def main():
    parser = argparse.ArgumentParser(
        description='KNICKGASM Mailer Engine -- AI-driven email campaign generator'
    )
    parser.add_argument('--campaign', type=str, metavar='TYPE',
                        help='Skip engine, run specific campaign type directly')
    parser.add_argument('--override_product', type=str, metavar='NAME',
                        help='Override product in brief')
    parser.add_argument('--override_offer', type=str, metavar='TEXT',
                        help='Override offer text in brief')
    parser.add_argument('--audience', type=str, metavar='TEXT',
                        help='Override audience description')
    parser.add_argument('--dry_run', action='store_true',
                        help='Build brief, skip API call, print brief as JSON')
    parser.add_argument('--list_triggers', action='store_true',
                        help='Print metric readings and trigger evaluation, do not generate')
    args = parser.parse_args()

    if args.list_triggers:
        run_list_triggers()
        return

    if not args.dry_run:
        check_api_key()

    t_start = time.time()

    print(f"\n{BANNER}")
    print(f"  KNICKGASM Mailer Engine -- {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(BANNER)

    if args.campaign:
        campaigns = [make_override_campaign(args.campaign)]
        print(f"[engine] Manual campaign override: {args.campaign}")
    else:
        print("[engine] Connecting to knickgasm_dtc.duckdb...")
        campaigns = get_triggered_campaigns()
        print(f"[engine] Metrics scanned. {len(campaigns)} trigger(s) fired.")

    if not campaigns:
        print("[engine] No triggers fired. All metrics within targets. No mailers generated.")
        return

    summary_rows = []

    for campaign in campaigns:
        ct = campaign['campaign_type']
        priority = campaign.get('priority', 0)
        reason = campaign.get('trigger_reason', '')

        print(f"\n[trigger] P{priority}: {ct} -- {reason}")
        print("[brief]  Generating campaign brief...")

        brief = build_brief(campaign)
        brief = apply_overrides(brief, args)

        if args.dry_run:
            print(f"\n-- Brief (dry run) {'-'*42}")
            print(json.dumps(brief, indent=2))
            print(SEP)
            print("[dry_run] Skipping API call.")
            continue

        print("[api]    Calling Claude API...")
        api_result = generate_mailer(brief)

        print("[render] Building production HTML...")
        html_path, meta_path = render(api_result, brief, ct)

        output_filename = os.path.basename(html_path)
        cs = campaign.get('context_data', {}).get('churn_signal', {})
        at_risk_rev = cs.get('at_risk_revenue', 0)

        summary_rows.append({
            'campaign': ct,
            'segment_size': brief.get('audience_size', 0),
            'at_risk_revenue': f"${at_risk_rev:,.0f}" if at_risk_rev else "--",
            'output_file': output_filename,
        })

    if summary_rows:
        print_summary_table(summary_rows)

    elapsed = time.time() - t_start
    print(f"[done] Total time: {elapsed:.1f}s\n")


if __name__ == '__main__':
    main()
