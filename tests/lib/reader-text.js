// The words a campaign puts in front of a person, field by field (2026-11-03).
// Used by tests/non-commerce-asset-copy.spec.js to judge what a reader, a
// viewer or a feed sees, apart from the prompts, briefs and analysis a build
// also carries. Each row: { where, kind, text } where kind is
//   'copy'   reader-facing words (mail, page, ad text, on-screen line, message)
//   'script' a video's spoken / on-screen script
//   'board'  a storyboard direction (production, never shown, but never a marker)
'use strict';

function visible(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|td|tr|section|header|footer|a|button|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&rsquo;/g, "'")
    .split(/\n+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function readerText(c) {
  const rows = [];
  const add = (where, kind, t) => { if (t == null) return; const s = String(t).trim(); if (s) rows.push({ where, kind, text: s }); };
  const A = (c && c.assets) || {};
  const e = A.email || {};
  add('email.subject', 'copy', e.subject);
  add('email.preheader', 'copy', e.preheader);
  for (const l of visible(e.html)) add('email.html', 'copy', l);
  for (const [i, v] of (Array.isArray(e.variants) ? e.variants : []).entries()) {
    add(`email.variants[${i}].subject`, 'copy', v && v.subject);
    for (const l of visible(v && v.html)) add(`email.variants[${i}].html`, 'copy', l);
  }
  for (const [i, lp] of (A.landing_pages || []).entries()) for (const l of visible(lp && lp.html)) add(`landing_pages[${i}]`, 'copy', l);
  for (const a of (A.ads || [])) {
    const w = `ads.${a.platform}.${a.creative_type}`;
    for (const f of ['headline', 'primary_text', 'caption', 'cta', 'hook']) add(`${w}.${f}`, 'copy', a[f]);
    for (const [i, h] of (a.headlines || []).entries()) add(`${w}.headlines[${i}]`, 'copy', h);
    for (const [i, d] of (a.descriptions || []).entries()) add(`${w}.descriptions[${i}]`, 'copy', d);
    if (a.overlay) for (const k of Object.keys(a.overlay)) add(`${w}.overlay.${k}`, 'copy', a.overlay[k]);
    for (const p of (a.placements || [])) for (const k of ['primary_text', 'headline', 'description', 'on_screen', 'caption']) add(`${w}.placements.${p.key}.${k}`, 'copy', p[k]);
    add(`${w}.script`, 'script', a.script);
    for (const s of (a.storyboard || [])) add(`${w}.storyboard`, 'board', s && s.scene);
    const cr = a.creative || {};
    const sb = cr.story_brief || {};
    for (const s of (sb.scenes || [])) add(`${w}.story`, 'copy', s && s.text);
    for (const s of (((sb.cuts || {}).short || {}).scenes || [])) add(`${w}.story.short`, 'copy', s && s.text);
    const mb = cr.motion_brief || {};
    for (const s of (mb.shots || [])) add(`${w}.motion`, 'copy', s && s.kinetic_type && s.kinetic_type.text);
    if (mb.cta_card) add(`${w}.motion.cta_card`, 'copy', mb.cta_card.headline);
    for (const l of visible(cr.static_html)) add(`${w}.static_html`, 'copy', l);
  }
  for (const m of (A.messages || [])) { add(`messages.${m.channel}.line`, 'copy', m.line); add(`messages.${m.channel}.title`, 'copy', m.title); add(`messages.${m.channel}.body`, 'copy', m.body); }
  return rows;
}

module.exports = { readerText, visible };
