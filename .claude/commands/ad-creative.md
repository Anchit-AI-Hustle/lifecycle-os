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

Craft rules — structure, motion law, output contract: `docs/creative-craft-contract.md` (§3 Static ads, §4 Video ads, §5 Imagery).


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
1. **Stills built to animate**: generate hero frames via Higgsfield product-photoshoot or `/api/ai/image` with `mode:'reels'` (9:16 shot like a phone in a real room, depth-separated layers for parallax, negative space for type, NO baked text).
2. **Real motion**: animate each frame with `higgsfield-generate` image-to-video (subtle push/pan/drift + organic motion only — steam, light; never added objects). Hook must move within 0.8s.
3. **Kinetic type**: headlines animate in word-staggered, not all at once; hard cut only into the CTA card.
4. **Instant preview / no-API fallback**: `scripts/lib/motion-ad.js` — `renderMotionAd(spec)` outputs a self-contained animated 9:16 HTML creative (layered Ken Burns, parallax veils, crossfades, kinetic type, CTA card), and `motionBrief(spec)` emits the same design as a shot-by-shot brief for Higgsfield/CapCut so the shipped MP4 matches the preview.
5. **Non-negotiables**: real SKU packaging only (never AI-invented boxes), one phone-camera look (never a cinema grade), licensed audio only, total under 15s, safe-areas (7% sides, bottom 18% clear).

## Kill the AI Tell: the render rules (set once, every variant ships clean)
`api/_shared/render-rules.js` is the source; `/api/ai/image.js` (every mode but `design`) and every video provider in
`api/_shared/video-core.js` already append it, and `motionBrief()` / the story brief carry it as `render_rules`.
Paste the compact block once into any prompt you write by hand for Higgsfield, Seedance, Veo or Kling:
```
<render_rules>
light: phone-camera, -1/3 stop, mixed temp, window spill
ban: unbroken gaze, perfect posture, plastic skin, phantom hands
cut: sighs, hair tucks, idle off-camera glances (keep the one phone-screen glance)
open: 1 micro-glitch, 1 object out of place
no: cinema grade, empty set, magazine framing
</render_rules>
```
- **The tells** (what gives it away before second 3): studio-flat light on frame 1, unbroken eye contact, plastic skin,
  phantom hands and perfect posture.
- **Lighting**: frame 1 a third of a stop under (shadows allowed); a warm lamp one side, cool daylight the other;
  visible window spill (a hot edge, a blown highlight on the wall).
- **Opening 3 seconds**: ONE micro-glitch of body language, ONE ambient object out of place (a mug, a cable; never a
  product, packaging, logo or text), phone-camera light on frame 1. Over a real product photo, add nothing: move only
  the camera and the light.
- **Quick-fix re-prompts**: too clean: "Underexpose a third of a stop, add window spill on the left wall." · stares:
  "Break eye contact at 0:02. Glance at the phone screen, then back." · plastic: "Add skin texture and warm room bounce.
  No beauty smoothing." · too still: "One hand adjusts the phone in the first 3 seconds." · too staged: "Leave the mug
  and the cable in frame. Do not tidy the set."
- **Common drift**: still reads AI: check frame 1 first, lighting is the loudest tell · too glitchy: cut to one
  micro-glitch · set got clean again: the block fell out of the prompt, re-paste it once · blinks on beat: ask for one
  blink that lands off-rhythm before 0:03.
- **What it does not do**: it does not pick the hook; the character, the brand and the message stay the brand's.

Offer to mirror the assets into `ads_generated` and wire them to a campaign via `/campaign-plan`.
