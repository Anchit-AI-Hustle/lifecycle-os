"""
mailer_api.py — Knickgasm Mailer Claude API Caller
Uses Anthropic Claude claude-sonnet-4-20250514 to generate structured mailer JSON from a brief.
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import urllib.request
import urllib.error

BASE_DIR = Path(__file__).parent
sys.path.insert(0, str(BASE_DIR))
from brand_prompt import KNICKGASM_BRAND_SYSTEM_PROMPT

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 4000
REQUIRED_KEYS = {"subject_lines", "preheader", "sections", "cta_options", "performance_notes"}


def _strip_fences(text: str) -> str:
    """Strip ```json ... ``` markdown fences if present."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()
    return text


def _call_api(brief: dict, api_key: str, extra_instruction: str = "") -> tuple[dict, dict, float]:
    """
    Call Claude API. Returns (raw_response_dict, usage_dict, elapsed_seconds).
    """
    user_message = (
        "Generate a complete Knickgasm mailer for this brief. "
        "Use real numbers from the brief naturally in the copy. "
        "Return only valid JSON — no markdown fences no preamble."
        + (f"\n\n{extra_instruction}" if extra_instruction else "")
        + f"\n\nBRIEF:\n{json.dumps(brief, indent=2)}"
    )

    payload = json.dumps({
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": KNICKGASM_BRAND_SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_message}]
    }).encode("utf-8")

    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01"
    }

    req = urllib.request.Request(ANTHROPIC_API_URL, data=payload, headers=headers, method="POST")
    t0 = time.time()
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    elapsed = time.time() - t0

    return data, data.get("usage", {}), elapsed


def generate_mailer(brief: dict) -> dict:
    """
    Generate mailer JSON from brief using Claude API.
    Returns parsed dict plus metadata.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise EnvironmentError("[error] Set ANTHROPIC_API_KEY environment variable")

    print(f"[api] Calling Claude API ({MODEL})...")
    t_start = time.time()

    try:
        data, usage, elapsed = _call_api(brief, api_key)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if hasattr(e, "read") else ""
        raise RuntimeError(f"[api] HTTP {e.code}: {body}")

    raw_text = data["content"][0]["text"]
    clean_text = _strip_fences(raw_text)

    try:
        parsed = json.loads(clean_text)
    except json.JSONDecodeError:
        # Retry once with explicit instruction
        print("[api] JSON parse failed — retrying with strict instruction...")
        data, usage, elapsed2 = _call_api(
            brief, api_key,
            extra_instruction="IMPORTANT: Return ONLY a raw JSON object. No markdown. No explanation."
        )
        raw_text = data["content"][0]["text"]
        clean_text = _strip_fences(raw_text)
        parsed = json.loads(clean_text)
        elapsed = (time.time() - t_start)

    # Validate required keys
    missing = REQUIRED_KEYS - set(parsed.keys())
    if missing:
        raise ValueError(f"[api] Response missing keys: {missing}")

    in_tok  = usage.get("input_tokens", 0)
    out_tok = usage.get("output_tokens", 0)
    print(f"[api] Done — {in_tok} in / {out_tok} out / {elapsed:.1f}s")

    return {
        "response": parsed,
        "tokens_used": usage,
        "model": MODEL,
        "generated_at": datetime.now().isoformat(),
    }


if __name__ == "__main__":
    # Smoke-test fixture. The product names are real titles from the live US
    # catalog (data/shopify/products_export_usa.csv). The previous fixture listed
    # three teas with the brand word swapped in, carried over from the sibling
    # repo this engine was copied from - and a fixture is what an engineer reads
    # to learn what this business sells.
    dummy_brief = {
        "campaign_type": "win_back_vip",
        "product": "Spiderman x Nike Air Force 1",
        "goal": "win_back_vip",
        "audience_description": "120 high-CLV customers at churn risk (avg CLV $240)",
        "audience_size": 120,
        "offer": "15% off",
        "seasonal_hook": None,
        "feedback": {"last_open_rate": 0.21, "winning_cta_word": "Discover", "best_send_day": "Tuesday"},
        "real_numbers": {
            "at_risk_revenue": 28800,
            "segment_size": 120,
            "days_since_order_avg": 74,
            "retention_rate_current": 22.4,
            "retention_rate_target": 30.0,
            "subscription_pct_current": 11.2,
            "top_skus": [
                "Spiderman x Nike Air Force 1",
                "Manchester United F.C. x Nike Air Force 1",
                "Coffee Dip x Nike Air Force 1",
            ],
            "winning_cta": {}
        }
    }
    result = generate_mailer(dummy_brief)
    print(json.dumps(result["response"], indent=2))
