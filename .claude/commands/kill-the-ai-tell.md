---
name: kill-the-ai-tell
description: Make Higgsfield and Seedance renders stop looking like AI. Use when the user says "kill the AI tell", "this video looks AI", "make it look real", "render rules", "prompt Higgsfield", "prompt Seedance", "it looks too clean / too staged / plastic", or before writing ANY image-to-video or text-to-video prompt for Higgsfield or Seedance. Holds the tells, the phone-camera lighting rules, the bans, the opening 3 seconds, the compact render_rules block to paste once, the quick-fix re-prompts and the common drift checks.
argument-hint: "[the shot or brief to render, or the problem with a render, e.g. 'too clean' / 'stares']"
---

# Kill the AI Tell: make Higgsfield and Seedance stop looking like AI

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). The
product, its photo, the brand and the message come from the ACTIVE brand's own
record. This skill changes how a render LOOKS. It does not pick the hook, and
the character, the brand and the message stay the brand's.

Task: `$ARGUMENTS`. If it is a shot or a brief, write the Higgsfield / Seedance
prompt for it with the rules below. If it names a problem with a render, give
the re-prompt from **Quick-fix re-prompts** and the check from **Common drift**.

## Why it reads as AI before second 3 (the tells)
1. **Studio-flat lighting on frame 1.** Even, shadowless, perfectly exposed. No real room looks like that.
2. **Unbroken eye contact.** Nine straight seconds into the lens. Not one blink lands off-rhythm.
3. **Plastic skin.** Catches zero room light. Reads rendered from the opening frame.
4. **Phantom hands, perfect posture.** Nothing fidgets. Nothing slouches. Nothing is held wrong.

## The lighting rules (phone camera, not studio)
- **Slightly underexposed**: frame 1 sits a third of a stop under. Shadows are allowed to exist.
- **Mixed colour temperature**: a warm lamp on one side, cool daylight on the other. Never one clean white.
- **Visible window spill**: a hot edge or a blown highlight on the wall. Phone-camera lighting on frame 1.

## The bans
- **The giveaway tells**: unbroken eye contact, perfect posture, plastic skin, phantom hands.
- **The production look**: cinema-grade colour grade, empty-set staging, magazine-styled framing.
- **The filler frames**: zero sighs, zero hair tucks, zero glances off-camera (the one glance at the phone screen
  that breaks eye contact is kept).

## The opening 3 seconds
- **Micro-glitch body language**: a half-step reframe, a hand that adjusts the phone, something slightly off.
  ONE only; more than one looks like a bug.
- **One ambient object out of place**: a mug on the wrong side, a charger cable in frame. Rooms are messy.
  The object is an ordinary thing of a lived-in room, never a product, packaging, a logo, a sign or readable text.
- **Phone-camera lighting on frame 1**: the first thing the eye reads is the light. Make it read like a phone.

Person rules apply only when a person is in the brief: never add a person to make the rules fit.

## Over the product's own photo (image-to-video)
When the first frame IS the product's real catalogue photo, it is a packshot: move only the camera and the light,
add nothing to it (no person, no prop, no object out of place). Use the packshot block below. Never let a model
invent packaging, a label or a second product into a real photo.

## Lock it in: paste this block once in the prompt
Every new variant ships clean when the block rides the prompt. Scene or person (text-to-video, or a still of a room):
```
<render_rules>
light: phone-camera, -1/3 stop, mixed temp, window spill
ban (if a person is in frame; never add one): unbroken gaze, perfect posture, plastic skin, phantom hands
cut: sighs, hair tucks, idle off-camera glances (keep the one phone-screen glance)
open: 1 micro-glitch, 1 object out of place
no: cinema grade, empty set, magazine framing
</render_rules>
```
Packshot (the product's own photo as the first frame):
```
<render_rules>
light: phone-camera, -1/3 stop, mixed temp, window spill
open: 1 handheld micro-shake; add nothing, the photo is the product
no: cinema grade, empty set, magazine framing
</render_rules>
```
The same two blocks live in `api/_shared/render-rules.js` (`COMPACT`, `COMPACT_PACKSHOT`). Change them there and
here together.

## Quick-fix re-prompts
| Problem | Re-prompt |
|---|---|
| Too clean | "Underexpose a third of a stop, add window spill on the left wall." |
| Stares | "Break eye contact at 0:02. Glance at the phone screen, then back." |
| Plastic | "Add skin texture and warm room bounce. No beauty smoothing." |
| Too still | "One hand adjusts the phone in the first 3 seconds." |
| Too staged | "Leave the mug and the cable in frame. Do not tidy the set." |

For a packshot: Too still → "One handheld micro-shake or a slow push-in on the photo. Add nothing to it." ·
Too glossy → "Keep the photo's own surface and light; no beauty smoothing, no added sheen." · Too staged →
"Leave the photo as it is: move only the camera and the light, add no object or person."

## Common drift
- **Still reads AI**: check frame 1 first. Lighting is the loudest tell.
- **Too glitchy**: cut to one micro-glitch. More than one looks like a bug.
- **Set got clean again**: the block fell out of the prompt. Re-paste it once.
- **Blinks on beat**: ask for one blink that lands off-rhythm before 0:03.

## Rendering it
- **By hand**: `higgsfield-generate` (Seedance image-to-video for a product photo, text-to-video for a scene) or
  `higgsfield-product-photoshoot` for stills, with the block pasted once.
- **In the app**: on `/brain`, a video ad's "Render with Seedance (Higgsfield)" sends its first shot to Seedance 2.0
  through the Higgsfield API (`POST https://api.higgsfield.ai/bytedance/seedance-2.0/image-to-video`, or
  `/text-to-video` with no photo; `Authorization: Key <key id>:<secret>`; polled at `/requests/{id}/status`) with the
  block already on the request (`api/_shared/video-core.js` `higgsfieldRequest`). It runs on the workspace's own
  Higgsfield key, saved on `/connections` (key id + secret), never on this app's credits. Higgsfield keeps the file
  7 days; download it.

## What it does not do
It does not pick your hook. The character, the brand and the message stay the brand's, and no copy changes. It only
stops the render from announcing that it came from a model.
