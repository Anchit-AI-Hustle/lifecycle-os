"""
gemini_enhancer.py — Knickgasm Mailer Gemini Copy Quality Layer
Uses Google Gemini 2.5 Flash to validate, rank, and enhance Claude-generated mailer copy.
Ensures brand consistency, subject line strength, and CTA quality.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)

GEMINI_SYSTEM_INSTRUCTION = """You are a senior D2C email marketing director reviewing Knickgasm India mailer copy.
Your role is to:
1. Score subject lines (1-10) on: curiosity, brand fit, open-rate potential — pick the top 1
2. Score CTA options (1-10) on: clarity, brand voice, conversion potential — pick the top 1
3. Flag any banned language (urgent, spammy, off-brand) found in copy
4. Suggest one improved subject line if the best score is below 7
5. Suggest one improved hero headline if it sounds generic

Return ONLY valid JSON with these keys:
{
  "best_subject_line": "<string>",
  "best_subject_score": <int 1-10>,
  "best_cta": "<string>",
  "best_cta_score": <int 1-10>,
  "banned_language_found": [<string>, ...],
  "improved_subject_line": "<string or null>",
  "improved_headline": "<string or null>",
  "brand_alignment_score": <int 1-10>,
  "enhancement_notes": "<1-2 sentences>"
}

No markdown fences. No preamble. Raw JSON only."""


def _call_gemini(prompt: str, api_key: str) -> dict:
    """Call Gemini API and return parsed JSON response."""
    url = f"{GEMINI_API_URL}?key={api_key}"
    payload = json.dumps({
        "system_instruction": {
            "parts": [{"text": GEMINI_SYSTEM_INSTRUCTION}]
        },
        "contents": [
            {"role": "user", "parts": [{"text": prompt}]}
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 1024,
            "responseMimeType": "application/json"
        }
    }).encode("utf-8")

    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    # Extract text from Gemini response structure
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    text = text.strip().lstrip("```json").rstrip("```").strip()
    return json.loads(text)


def enhance_mailer_copy(api_response: dict, brief: dict) -> dict:
    """
    Run Gemini enhancement pass on Claude-generated mailer copy.
    Returns enhanced response dict with Gemini feedback merged in.
    """
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        print("[gemini] GEMINI_API_KEY not set — skipping enhancement pass")
        return api_response

    mailer = api_response.get("response", {})
    subject_lines = mailer.get("subject_lines", [])
    cta_options = mailer.get("cta_options", [])
    hero_copy = mailer.get("sections", {}).get("hero", {}).get("copy", {})
    preheader = mailer.get("preheader", "")

    review_prompt = f"""Review this Knickgasm India email mailer copy.

CAMPAIGN: {brief.get("campaign_type")} | PRODUCT: {brief.get("product")} | OFFER: {brief.get("offer")}
AUDIENCE: {brief.get("audience_description")}

SUBJECT LINE OPTIONS:
{json.dumps(subject_lines, indent=2)}

PREHEADER:
{preheader}

HERO HEADLINE:
{hero_copy.get("headline", "")}

HERO SUBHEADLINE:
{hero_copy.get("subheadline", "")}

CTA OPTIONS:
{json.dumps(cta_options, indent=2)}

Score and enhance as instructed."""

    print(f"[gemini] Enhancing copy via {GEMINI_MODEL}...")
    t0 = time.time()

    try:
        gemini_feedback = _call_gemini(review_prompt, api_key)
        elapsed = time.time() - t0
        print(f"[gemini] Done — brand alignment {gemini_feedback.get('brand_alignment_score', '?')}/10 in {elapsed:.1f}s")

        # Apply improvements to the response
        enhanced = dict(api_response)
        enhanced_response = dict(mailer)

        # Inject best-ranked subject line as first in list
        best_subj = gemini_feedback.get("best_subject_line")
        improved_subj = gemini_feedback.get("improved_subject_line")

        if improved_subj and gemini_feedback.get("best_subject_score", 10) < 7:
            # Prepend improved subject line
            new_subjects = [improved_subj] + [
                s for s in subject_lines if s != best_subj
            ]
        elif best_subj and best_subj in subject_lines:
            # Reorder so best is first
            new_subjects = [best_subj] + [s for s in subject_lines if s != best_subj]
        else:
            new_subjects = subject_lines

        enhanced_response["subject_lines"] = new_subjects[:3]

        # Apply improved headline if score is low
        improved_headline = gemini_feedback.get("improved_headline")
        if improved_headline:
            if "sections" in enhanced_response and "hero" in enhanced_response["sections"]:
                enhanced_response["sections"]["hero"]["copy"]["headline"] = improved_headline

        # Reorder CTAs — best first
        best_cta = gemini_feedback.get("best_cta")
        if best_cta and best_cta in cta_options:
            new_ctas = [best_cta] + [c for c in cta_options if c != best_cta]
            enhanced_response["cta_options"] = new_ctas[:3]

        # Attach Gemini audit to performance notes
        if "performance_notes" not in enhanced_response:
            enhanced_response["performance_notes"] = {}
        enhanced_response["performance_notes"]["gemini_audit"] = gemini_feedback

        enhanced["response"] = enhanced_response
        enhanced["gemini_enhanced"] = True
        enhanced["gemini_feedback"] = gemini_feedback

        # Flag banned language warnings
        banned = gemini_feedback.get("banned_language_found", [])
        if banned:
            print(f"[gemini] ⚠  Banned language detected: {banned}")

        return enhanced

    except urllib.error.HTTPError as e:
        print(f"[gemini] HTTP {e.code} — skipping enhancement")
        return api_response
    except Exception as e:
        print(f"[gemini] Enhancement failed: {e} — returning original copy")
        return api_response


if __name__ == "__main__":
    # Smoke test with dummy data
    # Smoke-test fixture only. It never leaves this __main__ block, but it is
    # still written as this brand: the previous fixture described a single-estate
    # tea harvest with the brand name swapped in, inherited from the sibling repo
    # this engine was copied from, and a fixture is where a wrong mental model of
    # the business quietly propagates into real copy.
    dummy_response = {
        "response": {
            "subject_lines": [
                "The bench is free. Want a pair?",
                "Your one-of-one, still unpainted",
                "A design slot, held for you"
            ],
            "preheader": "Hand-painted on a 100% original base, made for one person",
            "sections": {
                "hero": {
                    "copy": {
                        "headline": "Nobody else owns this pair",
                        "subheadline": "Pick a design or send a reference, and an artist paints it once, by hand.",
                        "cta": "Lace-up Again"
                    },
                    "design_guidance": {"image_suggestion": "Artist at the bench, brush on the panel"}
                }
            },
            "cta_options": ["Lace-up Again", "Start Your Pair", "See The Designs"],
            "performance_notes": {}
        }
    }
    dummy_brief = {
        "campaign_type": "win_back_vip",
        "product": "[DATA REQUIRED BEFORE LAUNCH: product, from the live catalog]",
        "offer": "[DATA REQUIRED BEFORE LAUNCH: approved offer]",
        "audience_description": "120 high-CLV customers"
    }
    result = enhance_mailer_copy(dummy_response, dummy_brief)
    print(json.dumps(result.get("gemini_feedback", {}), indent=2))
