'use strict';
/**
 * render-rules.js — "Kill the AI Tell": the render rules every generated
 * picture and video of a person, a room or a scene carries, so it reads as a
 * phone in a real room rather than a model's studio (2026-10-25).
 * ---------------------------------------------------------------------------
 * The operator, with a "Kill the AI Tell" card (make Higgsfield & Seedance
 * stop looking like AI by default): "Integrate everything mentioned".
 * The card's diagnosis, restated as rules this module owns:
 *
 *   A  THE TELLS that give a render away before second 3: studio-flat lighting
 *      on frame 1, unbroken eye contact, plastic skin, phantom hands and
 *      perfect posture.
 *   B  THE LIGHTING RULES (phone camera, not studio): frame 1 a third of a stop
 *      under with shadows allowed, mixed colour temperature (warm lamp one
 *      side, cool daylight the other, never one clean white), visible window
 *      spill (a hot edge, a blown highlight on the wall).
 *   C  THE BANS: the giveaway tells; the production look (cinema-grade colour
 *      grade, empty-set staging, magazine-styled framing); the filler frames
 *      (zero sighs, zero hair tucks, zero glances off-camera).
 *   D  THE OPENING 3 SECONDS: one micro-glitch of body language, one ambient
 *      object out of place, phone-camera lighting on frame 1.
 *   E  LOCK IT IN: the compact block, set once in the skill file, so every
 *      new variant ships clean. Here it is set once in CODE: image-prompt.js,
 *      video-core.js, motion-ad.js and story-ad.js read it from this module.
 *   Quick-fix re-prompts and Common drift: QUICK_FIX and DRIFT below, carried
 *   on every video brief so the person reviewing a render has the re-prompt.
 *
 * WHAT IT DOES NOT DO, as the card says itself: it does not pick the hook (the
 * character, the brand and the message stay the brand's), and it changes no
 * copy. It stops a render from announcing that it came from a model.
 *
 * WHERE IT MEETS THE ANTI-FABRICATION RULES. "One ambient object out of
 * place" means a mug, a charger cable, a jacket on a chair: an ordinary thing
 * of a lived-in room. It is never a product, packaging, a logo, a sign or any
 * readable text (image-prompt.NEVER still holds), and over a REAL catalogue
 * photograph (a packshot animated by a video model) nothing is added at all -
 * the scene is the product's own photo, so only the camera and the light move
 * (`packshot` below).
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const TELLS = [
  { id: 'flat_light', tell: 'Studio-flat lighting on frame 1', why: 'Even, shadowless, perfectly exposed. No real room looks like that.' },
  { id: 'eye_contact', tell: 'Unbroken eye contact', why: 'Nine straight seconds into the lens. Not one blink lands off-rhythm.' },
  { id: 'plastic_skin', tell: 'Plastic skin', why: 'Catches zero room light. Reads rendered from the opening frame.' },
  { id: 'phantom_hands', tell: 'Phantom hands, perfect posture', why: 'Nothing fidgets. Nothing slouches. Nothing is held wrong.' },
];

const LIGHTING = [
  { id: 'underexposed', rule: 'Slightly underexposed', say: 'frame 1 sits a third of a stop under; shadows are allowed to exist' },
  { id: 'mixed_temp', rule: 'Mixed colour temperature', say: 'a warm lamp on one side and cool daylight on the other, never one clean white' },
  { id: 'window_spill', rule: 'Visible window spill', say: 'a hot edge or a blown highlight on the wall: phone-camera lighting on frame 1' },
];

const BANS = [
  { id: 'giveaway', ban: 'The giveaway tells', items: ['unbroken eye contact', 'perfect posture', 'plastic skin', 'phantom hands'] },
  { id: 'production', ban: 'The production look', items: ['cinema-grade colour grade', 'empty-set staging', 'magazine-styled framing'] },
  { id: 'filler', ban: 'The filler frames', items: ['zero sighs', 'zero hair tucks', 'zero off-camera glances'] },
];

const OPENING = [
  { id: 'micro_glitch', rule: 'Micro-glitch body language', say: 'a half-step reframe, a hand that adjusts the phone, something slightly off' },
  { id: 'object_out_of_place', rule: 'One ambient object out of place', say: 'a mug on the wrong side, a charger cable in frame: rooms are messy' },
  { id: 'phone_light', rule: 'Phone-camera lighting on frame 1', say: 'the first thing the eye reads is the light; make it read like a phone' },
];

/** Problem -> the one re-prompt that fixes it (the card's "Quick-fix re-prompts"). */
const QUICK_FIX = {
  too_clean: { problem: 'Too clean', reprompt: 'Underexpose a third of a stop, add window spill on the left wall.' },
  stares: { problem: 'Stares', reprompt: 'Break eye contact at 0:02. Glance at the phone screen, then back.' },
  plastic: { problem: 'Plastic', reprompt: 'Add skin texture and warm room bounce. No beauty smoothing.' },
  too_still: { problem: 'Too still', reprompt: 'One hand adjusts the phone in the first 3 seconds.' },
  too_staged: { problem: 'Too staged', reprompt: 'Leave the mug and the cable in frame. Do not tidy the set.' },
};

/** The same re-prompts for a frame that IS the product's own photo: no person,
 *  no prop, nothing added; only the camera and the light move. */
const QUICK_FIX_PACKSHOT = {
  too_clean: QUICK_FIX.too_clean,
  too_still: { problem: 'Too still', reprompt: 'One handheld micro-shake or a slow push-in on the photo. Add nothing to it.' },
  too_glossy: { problem: 'Too glossy', reprompt: 'Keep the photo\'s own surface and light; no beauty smoothing, no added sheen.' },
  too_staged: { problem: 'Too staged', reprompt: 'Leave the photo as it is: move only the camera and the light, add no object or person.' },
};

/** Symptom -> what to do (the card's "Common drift"). */
const DRIFT = [
  { symptom: 'Still reads AI', fix: 'Check frame 1 first. Lighting is the loudest tell.' },
  { symptom: 'Too glitchy', fix: 'Cut to one micro-glitch. More than one looks like a bug.' },
  { symptom: 'Set got clean again', fix: 'The rules fell out of the prompt. Re-paste the compact block once.' },
  { symptom: 'Blinks on beat', fix: 'Ask for one blink that lands off-rhythm before 0:03.' },
];

/** The compact block, as the card writes it, set once here. */
const COMPACT = [
  '<render_rules>',
  'light: phone-camera, -1/3 stop, mixed temp, window spill',
  'ban (if a person is in frame; never add one): unbroken gaze, perfect posture, plastic skin, phantom hands',
  'cut: sighs, hair tucks, idle off-camera glances (keep the one phone-screen glance)',
  'open: 1 micro-glitch, 1 object out of place',
  'no: cinema grade, empty set, magazine framing',
  '</render_rules>',
].join('\n');

// Over a real product photo (or a photo of one named product) nothing is
// added, so the block's `open` line asks for one camera micro-shake and no
// object: the two blocks never tell a model opposite things.
const COMPACT_PACKSHOT = [
  '<render_rules>',
  'light: phone-camera, -1/3 stop, mixed temp, window spill',
  'open: 1 handheld micro-shake; add nothing, the photo is the product',
  'no: cinema grade, empty set, magazine framing',
  '</render_rules>',
].join('\n');

const MARK = '<render_rules>';

/**
 * The rules in words a still or video model follows.
 *   medium:  'image' | 'video'
 *   people:  true when a person may be in frame (eye, skin, hand rules apply)
 *   packshot: true when the frame IS a real product photograph: only the
 *             camera and light move, nothing is added (anti-fabrication).
 */
function rules({ medium = 'image', people = true, packshot = false, productOnly = false } = {}) {
  const video = medium === 'video';
  const out = [];
  out.push('REALISM (phone camera, not studio): frame 1 a third of a stop under with shadows allowed; mixed colour temperature, a warm lamp on one side and cool daylight on the other, never one clean white; visible window spill, a hot edge or a blown highlight on the wall.');
  out.push('NO production look: no cinema-grade colour grade, no empty-set staging, no magazine-styled framing.');
  if (packshot) {
    out.push('This frame is the real product photograph: move only the camera and the light, add nothing to it.');
  } else if (productOnly) {
    // A photograph of one named product shows that product and nothing else:
    // the lived-in object is left out, so the two rules never disagree.
    out.push('Show only the product: no other object is added to the frame.');
  } else {
    out.push('The room is lived in: one ordinary object out of place (a mug, a charger cable), never a product, packaging, logo, sign or readable text.');
  }
  if (people && !packshot && !productOnly) {
    out.push('If a person is in frame: no unbroken gaze into the lens, no perfect posture, real skin texture with warm room bounce and no beauty smoothing, hands that hold things a little wrong.');
    if (video) {
      // Conditional on a person being in the brief: an object-only scene is
      // never told to break eye contact (that invites a model to add a person).
      out.push('If a person is in frame (never add one), opening 3 seconds: one micro-glitch of body language (a hand adjusting the phone); eye contact breaks by 0:02 with a glance at the phone screen; one blink off-rhythm before 0:03; no sighs, hair tucks or idle off-camera glances. With no person: one handheld micro-shake. One micro-glitch only.');
    }
  } else if (video) {
    out.push('Opening 3 seconds: one small handheld micro-shake or half-step reframe, never more than one.');
  }
  return out.join(' ');
}

/** Append the rules (and the compact block) to a prompt, once. */
function withRules(prompt, opt) {
  // A prompt that already carries a block (one pasted by hand, as the skill
  // invites) is normalised: any earlier rules and block are taken out and the
  // ones that fit THIS provider and frame are appended, so a packshot never
  // keeps the block that adds an object, and fit() always has its anchor.
  const p = String(prompt || '')
    .replace(/<render_rules>[\s\S]*?<\/render_rules>/g, '')
    .replace(/REALISM \(phone camera, not studio\):[^\n]*/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
  const shot = !!(opt && (opt.packshot || opt.productOnly));
  return p + (p ? '\n\n' : '') + rules(opt) + '\n' + (shot ? COMPACT_PACKSHOT : COMPACT);
}

/** What a reviewer reads beside a render: the re-prompts and the drift checks. */
function reviewKit(opt) {
  // A brief whose shots are the product's own photos re-prompts with the
  // packshot block: it never asks a model to add an object to a packshot.
  const shot = !!(opt && opt.packshot);
  return {
    compact_block: shot ? COMPACT_PACKSHOT : COMPACT,
    // A packshot gets re-prompts that add no person or prop to the photo.
    quick_fixes: Object.values(shot ? QUICK_FIX_PACKSHOT : QUICK_FIX),
    common_drift: shot ? DRIFT.filter((d) => !/blink/i.test(d.symptom)) : DRIFT.slice(),
    check_first: 'Frame 1: lighting is the loudest tell.',
  };
}

/**
 * A prompt carrying the rules, fitted to a provider's character limit (Pollo
 * keeps 1,500). The brief and the compact block always survive: the long-form
 * sentences go first, then the brief is cut, never the block (the card: "the
 * block fell out of SKILL.md" is how the set got clean again).
 */
function fit(prompt, max) {
  const p = String(prompt || '');
  if (!max || p.length <= max) return p;
  const at = p.indexOf('REALISM (phone camera');
  const mk = p.lastIndexOf(MARK);
  if (at < 0 || mk < 0) return p.slice(0, max);
  const head = p.slice(0, at).trim();
  const block = p.slice(mk);           // whichever block this prompt carries
  const room = max - block.length - 2;
  return (room > 0 ? head.slice(0, room) + '\n\n' : '') + block;
}

function quickFix(id) { return QUICK_FIX[id] ? QUICK_FIX[id].reprompt : ''; }

module.exports = { TELLS, LIGHTING, BANS, OPENING, QUICK_FIX, QUICK_FIX_PACKSHOT, DRIFT, COMPACT, COMPACT_PACKSHOT, MARK, rules, withRules, fit, reviewKit, quickFix };
