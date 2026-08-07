"""
image_generator.py — Knickgasm Mailer Image Generator
Uses OpenAI gpt-image-1 (ChatGPT Image 2) to generate premium brand-aligned visuals.
Builds perfect structured prompts per section type and campaign.
Saves images to mailer_system/outputs/images/ and returns file paths + base64.
"""

import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).parent
IMAGES_DIR = BASE_DIR / "outputs" / "images"
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations"

# ── Model preference: gpt-image-1 → dall-e-3 fallback ──────────────────────
PRIMARY_MODEL   = "gpt-image-1"
FALLBACK_MODEL  = "dall-e-3"

# ── Per-section image specs ─────────────────────────────────────────────────
SECTION_SPECS = {
    "hero": {
        "size": "1792x1024",
        "quality": "high",
        "description": (
            "Wide cinematic hero crop. Dark deep deep-purple background (#D0473E). "
            "Centrally composed. Dramatic atmospheric depth. "
            "Luxury sneaker lifestyle or origin studio scene."
        ),
    },
    "product": {
        "size": "1024x1024",
        "quality": "high",
        "description": (
            "Clean premium product shot. Warm chalk or pure white background. "
            "Professional side-lighting. Wide negative space on right third for copy overlay. "
            "Tight crop, no clutter."
        ),
    },
}

# ── Base brand photography prompt ───────────────────────────────────────────
BASE_STYLE = (
    "Ultra-premium Indian heritage sneaker brand editorial photography. "
    "Luxury lifestyle aesthetic for discerning Western consumers. "
    "Cinematic studio lighting — warm amber key, cool deep-purple fill. "
    "Shot on Phase One medium format. "
    "Visual language of Condé Nast Traveler, Monocle, and Kinfolk magazine. "
    "Color palette: deep deep purple #D0473E, warm amber #6A33D8, chalk #FFFFFF. "
    "Photorealistic. 8K resolution. Studio grade. "
    "No text overlays. No logos. No watermarks. No people unless specified. "
    "Rule of thirds composition. Shallow depth of field. "
)

CAMPAIGN_MODIFIERS = {
    "win_back_vip": (
        "Evoke nostalgia and returning warmth. "
        "A beloved ritual rediscovered. "
        "Intimate, personal, handcrafted feeling."
    ),
    "post_purchase_series": (
        "Morning ritual aesthetic. "
        "Calm, mindful, the first quiet moment of the day. "
        "Soft morning light, steam rising from a pair."
    ),
    "subscription_conversion": (
        "Sense of daily belonging and routine. "
        "A curated collection, always ready. "
        "Abundance without excess."
    ),
    "cart_recovery": (
        "The product waiting to be claimed. "
        "Close-up of the sealed, beautifully packaged sneaker. "
        "Anticipatory tension, premium unboxing energy."
    ),
    "re_engagement": (
        "A gentle invitation back. "
        "Warm familiar kitchen table, a single perfect pair. "
        "Welcoming, not urgent."
    ),
    "geo_upsell": (
        "Heritage and origin story. "
        "Rolling Jordan or Airforce sneaker studios at golden hour. "
        "Hand-picking, terroir, authentic sourcing."
    ),
}


def build_image_prompt(
    image_suggestion: str,
    campaign_type: str,
    section: str,
    product: str,
) -> str:
    """
    Build a perfect, structured OpenAI image generation prompt for Knickgasm.
    Layers: BASE_STYLE + section spec + campaign modifier + image_suggestion + product.
    """
    spec = SECTION_SPECS.get(section, SECTION_SPECS["product"])
    campaign_mod = CAMPAIGN_MODIFIERS.get(campaign_type, "")

    prompt_parts = [
        BASE_STYLE,
        spec["description"],
        campaign_mod,
        f"Subject: {product} — premium one-of-one Indian sneaker.",
        f"Scene guidance from art director: {image_suggestion}" if image_suggestion else "",
        "Ensure the composition feels editorial, not commercial.",
        "Color grading: warm shadows, rich midtones, subtle vignette.",
    ]

    prompt = " ".join(p.strip() for p in prompt_parts if p.strip())
    # Trim to ~900 chars (safe limit for gpt-image-1)
    if len(prompt) > 900:
        prompt = prompt[:897] + "..."
    return prompt


def _call_openai_image(
    prompt: str,
    model: str,
    size: str,
    quality: str,
    api_key: str,
) -> str:
    """
    Call OpenAI image generation API.
    Returns base64-encoded image string.
    """
    payload = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": size,
        "response_format": "b64_json",
    }
    # gpt-image-1 uses "quality" with values "low"/"medium"/"high"
    # dall-e-3 uses "quality" with values "standard"/"hd"
    if model == FALLBACK_MODEL:
        payload["quality"] = "hd"
        payload["style"] = "natural"
    else:
        payload["quality"] = quality

    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    req = urllib.request.Request(OPENAI_IMAGE_URL, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    return result["data"][0]["b64_json"]


def generate_section_image(
    image_suggestion: str,
    campaign_type: str,
    section: str,
    product: str,
    campaign_timestamp: str,
) -> dict:
    """
    Generate one section image. Returns dict with file_path, base64, prompt used.
    Falls back from gpt-image-1 → dall-e-3 on error.
    """
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print(f"[image] OPENAI_API_KEY not set — skipping {section} image generation")
        return {"file_path": None, "base64": None, "prompt": None, "model": None}

    spec = SECTION_SPECS.get(section, SECTION_SPECS["product"])
    prompt = build_image_prompt(image_suggestion, campaign_type, section, product)

    print(f"[image] Generating {section} image ({spec['size']}) via {PRIMARY_MODEL}...")
    t0 = time.time()

    b64_data = None
    model_used = PRIMARY_MODEL

    try:
        b64_data = _call_openai_image(prompt, PRIMARY_MODEL, spec["size"], spec["quality"], api_key)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if hasattr(e, "read") else ""
        print(f"[image] {PRIMARY_MODEL} failed (HTTP {e.code}) — falling back to {FALLBACK_MODEL}")
        # dall-e-3 only supports 1024x1024, 1792x1024, 1024x1792
        fb_size = spec["size"] if spec["size"] in ("1792x1024", "1024x1024") else "1024x1024"
        try:
            b64_data = _call_openai_image(prompt, FALLBACK_MODEL, fb_size, spec["quality"], api_key)
            model_used = FALLBACK_MODEL
        except Exception as e2:
            print(f"[image] Fallback also failed: {e2} — continuing without image")
            return {"file_path": None, "base64": None, "prompt": prompt, "model": None}
    except Exception as e:
        print(f"[image] Image generation failed: {e} — continuing without image")
        return {"file_path": None, "base64": None, "prompt": prompt, "model": None}

    elapsed = time.time() - t0

    # Save to disk
    filename = f"{campaign_type}_{section}_{campaign_timestamp}.png"
    file_path = IMAGES_DIR / filename
    img_bytes = base64.b64decode(b64_data)
    with open(file_path, "wb") as f:
        f.write(img_bytes)

    file_kb = len(img_bytes) / 1024
    print(f"[image] {section} done — {file_kb:.0f}KB in {elapsed:.1f}s via {model_used}")

    return {
        "file_path": str(file_path),
        "base64": b64_data,
        "prompt": prompt,
        "model": model_used,
        "size_kb": round(file_kb, 1),
        "elapsed": round(elapsed, 1),
    }


def generate_campaign_images(
    api_response: dict,
    brief: dict,
    campaign_type: str,
    campaign_timestamp: str,
) -> dict:
    """
    Generate all required images for a campaign (hero + product).
    Returns dict keyed by section name.
    """
    sections = api_response.get("response", {}).get("sections", {})
    product = brief.get("product", "Jordan First Flush")
    images = {}

    for section in ["hero", "product"]:
        sec_data = sections.get(section, {})
        design = sec_data.get("design_guidance", {})
        image_suggestion = design.get("image_suggestion", f"Premium {product} lifestyle shot")

        images[section] = generate_section_image(
            image_suggestion=image_suggestion,
            campaign_type=campaign_type,
            section=section,
            product=product,
            campaign_timestamp=campaign_timestamp,
        )

    return images


if __name__ == "__main__":
    # Smoke test
    test_result = generate_section_image(
        image_suggestion="Mist-covered Jordan hills at dawn, hand-picking first flush leaves",
        campaign_type="win_back_vip",
        section="hero",
        product="Jordan First Flush",
        campaign_timestamp=datetime.now().strftime("%Y%m%d_%H%M%S"),
    )
    print(json.dumps({k: v for k, v in test_result.items() if k != "base64"}, indent=2))
