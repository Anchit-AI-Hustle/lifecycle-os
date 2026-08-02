'use strict';

/**
 * api/_shared/mailer-format.js — the ONE source of truth for the KNICKGASM
 * "lava standard" mailer format, reverse-engineered from the hand-authored
 * reference at
 *   lifecycle-campaigns/2026-07-03_week1/emails/2026-07-09_cohortB_supplements-launch.html
 *
 * Every mailer generator (lifecycle-mailer-build, smart-brain, the AI pipeline,
 * generate.js) routes its final HTML through here so the output is uniform:
 *
 *   1. A top-of-file subject-metadata comment block:
 *        <!--
 *        SUBJECT_PRIMARY: ...
 *        SUBJECT_ALT1: ...
 *        SUBJECT_ALT2: ...
 *        PREHEADER: ...
 *        -->
 *   2. Inline asset-generation prompt comments paired with a paste-placeholder,
 *      one per fillable slot, e.g.
 *        <!-- IMAGE GENERATION PROMPT (hero, displayed 600x400 - generate at 1200x800 for retina):
 *             ...prompt... -->
 *        <img src="PASTE_IMAGE_URL_HERE" ...>
 *      (kind ∈ IMAGE | VIDEO | GIF — placeholders below).
 *
 * These two markers are what the asset agent (asset-agent.js) parses to fill
 * real generated assets, and what makes a mailer "lava standard".
 */

const PLACEHOLDER = {
  image: 'PASTE_IMAGE_URL_HERE',
  video: 'PASTE_VIDEO_URL_HERE',
  gif: 'PASTE_GIF_URL_HERE',
};

// Single canonical parser regex, shared with asset-agent.js.
// Groups: 1=kind 2=slot 3=dispW 4=dispH 5=genW 6=genH 7=prompt
const ASSET_PROMPT_RE =
  /<!--\s*(IMAGE|VIDEO|GIF)\s+GENERATION\s+PROMPT\s*\(\s*([^,]+?)\s*,\s*displayed\s+(\d+)x(\d+)\s*-\s*generate at\s+(\d+)x(\d+)[^:]*:\s*([\s\S]*?)\s*--!?>/gi;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// The subject-metadata comment block. `alts` is an array (0-2 used).
function subjectMetaBlock({ subject, alts = [], preheader = '' } = {}) {
  // Neutralize BOTH HTML comment terminators (`-->` and `--!>`) so injected
  // content cannot break out of the comment.
  const clean = (s) => String(s ?? '').replace(/--!?>/g, '- ->').replace(/[\r\n]+/g, ' ').trim();
  const lines = ['<!--', `SUBJECT_PRIMARY: ${clean(subject)}`];
  if (alts[0]) lines.push(`SUBJECT_ALT1: ${clean(alts[0])}`);
  if (alts[1]) lines.push(`SUBJECT_ALT2: ${clean(alts[1])}`);
  lines.push(`PREHEADER: ${clean(preheader)}`, '-->');
  return lines.join('\n');
}

// Prepend the subject-metadata block to a mailer's HTML, idempotently.
function withSubjectMeta(html, meta) {
  const h = String(html || '');
  if (/<!--\s*\n?\s*SUBJECT_PRIMARY:/i.test(h)) return h; // already present
  return subjectMetaBlock(meta) + '\n' + h;
}

// The inline generation-prompt comment for one slot.
function assetPromptComment({ kind = 'image', slot = 'hero', displayW, displayH, prompt, negative_prompt } = {}) {
  const k = String(kind).toLowerCase();
  const genW = displayW * 2;
  const genH = displayH * 2;
  const label = k === 'video' ? 'VIDEO' : k === 'gif' ? 'GIF' : 'IMAGE';
  const body = String(prompt || '').replace(/--!?>/g, '- ->').trim() +
    (negative_prompt ? ` Avoid: ${String(negative_prompt).replace(/--!?>/g, '- ->').trim()}.` : '');
  return `<!-- ${label} GENERATION PROMPT (${slot}, displayed ${displayW}x${displayH} - generate at ${genW}x${genH} for retina):\n     ${body} -->`;
}

// A full fillable asset slot: prompt comment + <img> carrying the paste
// placeholder (or a real URL when one is already known). Works for image,
// video (poster frame) and gif — all render as <img> in email clients.
function assetSlot({ kind = 'image', slot = 'hero', displayW, displayH, prompt, negative_prompt, alt = '', existingUrl = '' } = {}) {
  const k = String(kind).toLowerCase();
  const src = existingUrl || PLACEHOLDER[k] || PLACEHOLDER.image;
  const comment = assetPromptComment({ kind: k, slot, displayW, displayH, prompt, negative_prompt });
  const img = `<img src="${esc(src)}" width="${displayW}" height="${displayH}" alt="${esc(alt || slot)}" ` +
    `style="display:block;width:100%;max-width:${displayW}px;height:auto;border:0;background:#6A33D8;" />`;
  return `${comment}\n${img}`;
}

// Which asset kinds a mailer HTML still needs filled (unresolved placeholders).
function pendingPlaceholders(html) {
  const h = String(html || '');
  return {
    image: (h.match(new RegExp(PLACEHOLDER.image, 'g')) || []).length,
    video: (h.match(new RegExp(PLACEHOLDER.video, 'g')) || []).length,
    gif: (h.match(new RegExp(PLACEHOLDER.gif, 'g')) || []).length,
  };
}

// Lava-standard conformance check (used by tests / QA).
function assertGoldStandard(html) {
  const h = String(html || '');
  const missing = [];
  if (!/SUBJECT_PRIMARY:/i.test(h)) missing.push('subject_metadata_header');
  if (!/PREHEADER:/i.test(h)) missing.push('preheader');
  return { ok: missing.length === 0, missing };
}

module.exports = {
  PLACEHOLDER,
  ASSET_PROMPT_RE,
  subjectMetaBlock,
  withSubjectMeta,
  assetPromptComment,
  assetSlot,
  pendingPlaceholders,
  assertGoldStandard,
};
