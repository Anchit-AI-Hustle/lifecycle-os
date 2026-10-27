'use strict';
/**
 * lp-craft.js - the parts of Elaya's landing-page-design skill
 * (github.com/elayadesign/ai-design-skills, MIT, read 2026-10-27) that the
 * generated landing page (smart-brain-plan.lpHtml, served at /lp/:id) takes.
 *
 * Taken, because each one is a rule about craft and none decides a fact:
 *  - B1 type scale: every px font size lands on a Tailwind step (the closest
 *    step BELOW), headings balance, body copy is pretty (no orphan word).
 *  - B5 hero: heading and subheading are capped at 680px.
 *  - B7 motion: one curve, cubic-bezier(0.22,1,0.36,1), transform and opacity
 *    only, nothing under prefers-reduced-motion.
 *  - B9 states: hover, active (scale .98) and a visible focus ring on buttons.
 *  - B10 ship: a skip to content link and one <main>.
 *  - B11 the tagline reveal: the brand's OWN tagline in large type, its words
 *    going from a muted tone to full as they cross a line on scroll.
 *  - A7: a campaign page is time bound, so it is not indexed.
 *
 * Not taken, because this repo's own rules say otherwise:
 *  - B8 "invent names, testimonials, logos, numbers": zero fabrication. A page
 *    says only what the brand's record states.
 *  - B1 fonts (Geist / Manrope / Poppins only): a brand's page is set in the
 *    brand's own type.
 *  - B4 dark backgrounds (#000, #181818 ...): no section is ever a dark neutral.
 *  - B5 grey gradient on the hero heading: the heading is the brand's colours.
 *
 * Two progressive-enhancement choices keep every reader on the page: the
 * reveal starts muted only after its script runs (no script, the words are
 * full), and the muted tone is a colour still 3:1 off the ground (WCAG AA for
 * large text), never an opacity a reader cannot read.
 */

const EASE = 'cubic-bezier(0.22,1,0.36,1)';
const TYPE_STEPS = [12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96, 128];

/** The closest Tailwind type step at or below n (12 is the floor). */
function snapFont(n) {
  const v = Number(n);
  if (!isFinite(v)) return n;
  let out = TYPE_STEPS[0];
  for (const s of TYPE_STEPS) if (s <= v + 1e-6) out = s;
  return out;
}

function snapCss(css) {
  return String(css || '').replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi, (m, n) => `font-size:${snapFont(parseFloat(n))}px`);
}

/**
 * Snap every px font size in the page's own CSS and inline styles. The block a
 * measured design system wrote (<style id="ds">) and the brand's @font-face
 * block are left alone: those are the brand's site's own values.
 */
function snapTypeScale(html) {
  return String(html || '')
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, css) => (/\bid\s*=\s*["'](?:ds|brand-fonts)["']/i.test(attrs) ? m : `<style${attrs}>${snapCss(css)}</style>`))
    .replace(/\sstyle="([^"]*)"/gi, (m, css) => ` style="${snapCss(css)}"`);
}

/* ── colour, for the muted tone ─────────────────────────────────────────── */
function rgb(hex) {
  const h = String(hex || '').trim().replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(f)) return null;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
}
function hex(c) { return '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
function lum(c) {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return 1;
  const l1 = lum(x), l2 = lum(y);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * The muted tone: the ink moved toward the ground as far as it can go while it
 * still stands 3:1 off it (the large-text AA floor). The skill asks for 25-35%
 * opacity; a colour reads the same and stays readable.
 */
function mutedTone(ink, ground, floor = 3.1) {
  const a = rgb(ink), b = rgb(ground);
  if (!a || !b || contrast(ink, ground) < floor) return ink;
  let best = ink;
  for (let t = 0.02; t <= 0.9; t += 0.02) {
    const c = hex(a.map((v, i) => v + (b[i] - v) * t));
    if (contrast(c, ground) >= floor) best = c; else break;
  }
  return best;
}

/* ── B11 tagline reveal ─────────────────────────────────────────────────── */
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

/**
 * The statement the reveal says: the brand's own tagline, when it is a
 * sentence long enough to fill two lines of large type. Nothing else is used:
 * a claim has one home on the page, and a line the brand never wrote is not
 * the brand's tagline.
 */
function taglineStatement(brand) {
  const t = String((brand && brand.tagline) || '').replace(/\s+/g, ' ').trim();
  if (!t || /DATA REQUIRED|\{\{|\[/.test(t)) return '';
  return words(t).length >= 4 && t.length >= 24 && t.length <= 160 ? t : '';
}

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function taglineSection(statement) {
  if (!statement) return '';
  const spans = words(statement).map((w) => `<span class="tw">${escHtml(w)}</span>`).join(' ');
  return `<section class="sec tagline-reveal" data-tagline-reveal aria-label="${escHtml(statement)}"><p class="tr-text">${spans}</p></section>`;
}

/* The words light in reading order as each crosses a line 40% up from the
   bottom of the screen, once. One IntersectionObserver, no scroll listener.
   The margin is in px from the screen's height: a percentage in rootMargin is
   resolved against the root's WIDTH by the spec, which would move the line.
   A page too short to carry the last words up to the line lights them when
   its end is on screen ([data-tw-end]), so no word stays muted for good. */
const TAGLINE_SCRIPT = '<script data-tagline-reveal-js>(function(){try{var d=document,s=d.querySelector("[data-tagline-reveal]");if(!s)return;var w=s.querySelectorAll(".tw");if(!("IntersectionObserver" in window)||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;d.documentElement.classList.add("tw-on");var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("lit");io.unobserve(e.target);}});},{rootMargin:"0px 0px -"+Math.round(window.innerHeight*0.4)+"px 0px",threshold:0});for(var i=0;i<w.length;i++)io.observe(w[i]);var end=d.querySelector("[data-tw-end]");if(end){var eo=new IntersectionObserver(function(es){if(es[0].isIntersecting){for(var j=0;j<w.length;j++)w[j].classList.add("lit");io.disconnect();eo.disconnect();}});eo.observe(end);}}catch(e){}})();</script>';

/**
 * The CSS the skill's rules add. `c` = { ink, ground } for the muted tone.
 */
function css(c) {
  const muted = mutedTone((c && c.ink) || '#111111', (c && c.ground) || '#ffffff');
  return [
    `h1,h2,h3{text-wrap:balance}p,li,dd,blockquote{text-wrap:pretty}`,
    // The whole hero text column is capped, so the eyebrow, heading, sub line
    // and button keep one edge whichever way the template aligns them.
    `.hero-grid:not(.has-media) .hero-copy{max-width:680px;margin-left:auto;margin-right:auto}.hero-grid.has-media .hero-copy{max-width:680px}`,
    `.btn{transition:transform 500ms ${EASE},opacity 300ms ${EASE},background-color 300ms ${EASE},color 300ms ${EASE}}.btn:hover{transform:translateY(-1px)}.btn:active{transform:scale(.98)}.btn:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--ink);outline-offset:3px}`,
    `.skip{position:absolute;left:12px;top:-60px;z-index:200;background:var(--chalk);color:var(--ink);padding:8px 12px;border-radius:8px;font-weight:700;text-decoration:none;transition:transform 300ms ${EASE}}.skip:focus{top:12px}`,
    `.tagline-reveal{padding:64px 0;text-align:center}.tagline-reveal .tr-text{font-family:var(--head);font-size:48px;line-height:1.1;max-width:680px;margin:0 auto;color:var(--ink);text-wrap:balance}`,
    `.tw-on .tagline-reveal .tw{color:${muted};transition:color 500ms ${EASE}}.tw-on .tagline-reveal .tw.lit{color:var(--ink)}`,
    `@media(max-width:640px){.tagline-reveal{padding:48px 0}.tagline-reveal .tr-text{font-size:36px}}`,
    // Selectors as specific as the muted ones: a reader who turns reduced motion on
    // with the page open gets every word at full colour at once.
    `@media(prefers-reduced-motion:reduce){.btn,.skip,.tagline-reveal .tw{transition:none}.btn:hover,.btn:active{transform:none}.tagline-reveal .tw,.tw-on .tagline-reveal .tw,.tw-on .tagline-reveal .tw.lit{color:var(--ink);transition:none}}`,
  ].join('\n');
}

/** The skill's head and body additions, applied to a finished page. */
function finish(html, o) {
  let h = String(html || '');
  if (!/<html/i.test(h)) return h;
  // A7: a campaign page is time bound and lives behind its own link.
  if (!/name\s*=\s*["']robots["']/i.test(h)) h = h.replace(/<head[^>]*>/i, (m) => m + '<meta name="robots" content="noindex">');
  h = h.replace(/<\/head>/i, `<style id="lp-craft">${css(o)}</style></head>`);
  // B10: the keyboard's way past the header.
  if (!/class="skip"/.test(h)) h = h.replace(/<body([^>]*)>/i, (m) => `${m}<a class="skip" href="#main">Skip to content</a>`);
  if (/data-tagline-reveal/.test(h) && !/data-tagline-reveal-js/.test(h)) h = h.replace(/<\/body>/i, '<i data-tw-end aria-hidden="true" style="display:block;height:1px"></i>' + TAGLINE_SCRIPT + '</body>');
  return snapTypeScale(h);
}

module.exports = { EASE, TYPE_STEPS, snapFont, snapTypeScale, mutedTone, contrast, taglineStatement, taglineSection, css, finish, TAGLINE_SCRIPT };
