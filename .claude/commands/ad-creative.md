---
name: ad-creative
description: Generate paid-social ad creatives for the active brand — static image, video, and GIF — with copy grounded in that brand's own positioning.
argument-hint: "[product + format, e.g. '<product or section>, Meta static + Reels']"
---

# Ad creative generation

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Create paid-social creatives for: `$ARGUMENTS`.

## Engine
Use the Higgsfield skills via the `higgsfield-*` toolchain:
- **Product/lifestyle stills, ad packs** → `higgsfield-product-photoshoot` (modes: `ad_creative_pack`, `lifestyle_scene`, `closeup_product_with_person`, `hero_banner`, `social_carousel`).
- **Video / Reels / UGC / animated** → `higgsfield-generate` (Seedance video, Marketing Studio for ads, image-to-video for animating a still).
- **GIF preview** → derive from the video.
- **Face/identity consistency** across a campaign → chain `higgsfield-soul-id`.
- When unsure which model, call `models_explore(action:'recommend')` first.

## Formats to deliver (match what was just shipped)
- Meta static `1080x1080` PNG
- Reels/Stories `1080x1920` MP4
- Reels preview `540x960` GIF

## Hard constraints
- **Bake the approved happiness-first copy directly into the creative** (P01 mandate; enforced in `api/_shared/master-prompt.js` + `api/ai/image.js`). Do not rely on platform text overlays.
- Only the 4 brand colors; Montserrat / Instrument Sans type feel.
- **No banned phrases.** Lead with the feeling (calm, warmth, ritual), not the ingredient spec.
- Save outputs to the repo root with descriptive names: `{brand}_{product}_{platform}_{format}_{WxH}.{ext}`.

## Reels-grade quality bar (the "as good as real Reels" standard)
The bar is what top reels actually do — not a slideshow of stills:
1. **Stills built to animate**: generate hero frames via Higgsfield product-photoshoot or `/api/ai/image` with `mode:'reels'` (cinematic 9:16, depth-separated layers for parallax, negative space for type, NO baked text).
2. **Real motion**: animate each frame with `higgsfield-generate` image-to-video (subtle push/pan/drift + organic motion only — steam, light; never added objects). Hook must move within 0.8s.
3. **Kinetic type**: headlines animate in word-staggered, not all at once; hard cut only into the CTA card.
4. **Instant preview / no-API fallback**: `scripts/lib/motion-ad.js` — `renderMotionAd(spec)` outputs a self-contained animated 9:16 HTML creative (layered Ken Burns, parallax veils, crossfades, kinetic type, CTA card), and `motionBrief(spec)` emits the same design as a shot-by-shot brief for Higgsfield/CapCut so the shipped MP4 matches the preview.
5. **Non-negotiables**: real SKU packaging only (never AI-invented boxes), one filmic grade, licensed audio only, total under 15s, safe-areas (7% sides, bottom 18% clear).

Offer to mirror the assets into `ads_generated` and wire them to a campaign via `/campaign-plan`.
