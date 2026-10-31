'use strict';
/**
 * asset-themes.js - complete themes and templates, chosen per brand and per
 * generation (2026-10-26).
 *
 * The operator: "why does every brand mailer, video and ad have only one
 * common structure and layout - ensure complete unique personalisation in
 * each and every generation for each brand", then "no complete different
 * templates, themes everything". asset-style.js only flipped a few switches
 * (hero width, grid columns) inside ONE template, so every brand's mail, ad
 * and video read as the same document in different colours.
 *
 * Two things are chosen now, separately:
 *   THEME    - the whole look: type case, weight and tracking, corners, the
 *              button's shape, how cards and images are framed, dividers, the
 *              header and footer, how sections sit on the page, spacing. A
 *              theme NEVER brings a colour of its own: every ground and text
 *              colour is still the brand's palette through the AA helpers, and
 *              no section is ever dark-neutral.
 *   TEMPLATE - the structure: which blocks, in what order, how products are
 *              laid out. Each asset kind has its own list.
 *
 * Per brand: affinity() ranks the themes from what the brand's own record
 * says about it - business model, industry words, the tone of its voice, its
 * type (a serif, a heavy display face, upper-case buttons), how saturated its
 * colours are, the corners its own site draws - and a stable hash of the
 * brand breaks ties, so two brands of the same kind still get different
 * families. Every reason is recorded.
 * Per generation: pick() walks a weighted schedule over the brand's top
 * themes and over the templates by the slot's day, market, cohort and asset,
 * so neighbouring sends differ, two variants of one send differ, and the same
 * slot rebuilt is the same design (what a reviewer approved is what ships).
 * A press of "regenerate" passes a take, which moves the whole schedule.
 */
const crypto = require('crypto');

function seedOf(...parts) {
  const h = crypto.createHash('sha256').update(parts.map((p) => String(p == null ? '' : p)).join('|')).digest();
  return h.readUInt32BE(0);
}

/* The themes. Keys every renderer reads; values are shapes, never colours. */
const THEMES = {
  editorial: {
    id: 'editorial', label: 'Editorial',
    align: 'left', density: 'airy',
    radius: { card: 2, button: 0, image: 0 },
    heading: { case: 'none', tracking: '-0.02em', weight: 500, scale: 1.25, italic: false },
    eyebrow: 'rule', button: 'outline', card: 'hairline', divider: 'hairline',
    image: 'inset', ground: 'open', header: 'left', footer: 'rule', price: 'text', numbering: true,
  },
  bold: {
    id: 'bold', label: 'Bold block',
    align: 'left', density: 'compact',
    radius: { card: 0, button: 0, image: 0 },
    heading: { case: 'upper', tracking: '-0.01em', weight: 900, scale: 1.35, italic: false },
    eyebrow: 'chip', button: 'block', card: 'band', divider: 'thick',
    image: 'bleed', ground: 'bands', header: 'band', footer: 'band', price: 'block', numbering: false,
  },
  soft: {
    id: 'soft', label: 'Soft rounded',
    align: 'center', density: 'regular',
    radius: { card: 22, button: 999, image: 18 },
    heading: { case: 'none', tracking: '0', weight: 700, scale: 1.1, italic: false },
    eyebrow: 'chip', button: 'pill', card: 'tint', divider: 'none',
    image: 'rounded', ground: 'cards', header: 'center', footer: 'tint', price: 'pill', numbering: false,
  },
  minimal: {
    id: 'minimal', label: 'Minimal',
    align: 'left', density: 'airy',
    radius: { card: 4, button: 4, image: 4 },
    heading: { case: 'none', tracking: '-0.01em', weight: 600, scale: 0.9, italic: false },
    eyebrow: 'none', button: 'link', card: 'hairline', divider: 'hairline',
    image: 'square', ground: 'open', header: 'left', footer: 'plain', price: 'text', numbering: false,
  },
  luxe: {
    id: 'luxe', label: 'Luxe',
    align: 'center', density: 'airy',
    radius: { card: 0, button: 0, image: 0 },
    heading: { case: 'upper', tracking: '0.16em', weight: 400, scale: 0.95, italic: false },
    eyebrow: 'spaced', button: 'outline', card: 'frame', divider: 'double',
    image: 'framed', ground: 'framed', header: 'center', footer: 'rule', price: 'text', numbering: false,
  },
  poster: {
    id: 'poster', label: 'Poster',
    align: 'center', density: 'regular',
    radius: { card: 14, button: 999, image: 14 },
    heading: { case: 'none', tracking: '-0.03em', weight: 800, scale: 1.55, italic: false },
    eyebrow: 'chip', button: 'pill', card: 'band', divider: 'none',
    image: 'rounded', ground: 'brand', header: 'band', footer: 'band', price: 'sticker', numbering: false,
  },
  playful: {
    id: 'playful', label: 'Playful',
    align: 'center', density: 'regular',
    radius: { card: 16, button: 12, image: 16 },
    heading: { case: 'none', tracking: '0', weight: 800, scale: 1.2, italic: false },
    eyebrow: 'chip', button: 'solid', card: 'tint', divider: 'dots',
    image: 'rounded', ground: 'cards', header: 'center', footer: 'tint', price: 'pill', numbering: true,
  },
  magazine: {
    id: 'magazine', label: 'Magazine',
    align: 'left', density: 'regular',
    radius: { card: 6, button: 6, image: 6 },
    heading: { case: 'none', tracking: '-0.02em', weight: 700, scale: 1.15, italic: true },
    eyebrow: 'caps', button: 'solid', card: 'hairline', divider: 'thick',
    image: 'inset', ground: 'open', header: 'left', footer: 'band', price: 'text', numbering: true,
  },
};
const THEME_IDS = Object.keys(THEMES);

/* The templates (structures) per asset kind. A renderer that cannot fill one
   (no picture, too few products) falls back along its own list. */
const TEMPLATES = {
  mail: ['stack', 'poster', 'split', 'magazine', 'catalogue', 'spotlight'],
  text: ['letter', 'memo', 'numbered'],
  ad: ['overlay', 'split', 'framed', 'type', 'sticker', 'band', 'offer'],
  video: ['lower', 'title', 'split', 'editorial', 'frame'],
  landing: ['classic', 'immersive', 'split', 'editorial'],
};

/* Words in the record that pull toward a theme. Whole words only. */
const PULL = [
  { re: /\b(luxury|luxe|premium|jewell?e?ry|couture|haute|fine|bespoke|atelier|heritage|watch(es)?|fragrance|perfume|spirits|wine)\b/i, themes: { luxe: 3, editorial: 2, minimal: 1 }, why: 'luxury / premium words' },
  { re: /\b(news|media|journal(ism)?|magazine|editorial|publisher|gazette|times|daily|weekly|report(ing)?|research|insight|analysis)\b/i, themes: { editorial: 3, magazine: 3, minimal: 1 }, why: 'publishing words' },
  { re: /\b(software|saas|app|platform|tech(nology)?|cloud|ai|developer|api|data|fintech|bank(ing)?|finance|invest(ing|ment)?)\b/i, themes: { minimal: 3, bold: 1, magazine: 1 }, why: 'technology / finance words' },
  { re: /\b(kids?|baby|toys?|candy|sweets?|snacks?|bakery|bakers?|cakes?|cookies?|ice ?cream|pets?|party|gifts?)\b/i, themes: { playful: 3, soft: 2, poster: 1 }, why: 'playful category words' },
  { re: /\b(sneakers?|streetwear|sport(s|swear)?|fitness|gym|athletic|running|outdoor|gear|gaming|esports|energy)\b/i, themes: { bold: 3, poster: 2 }, why: 'sport / street words' },
  { re: /\b(beauty|skin ?care|cosmetics?|wellness|spa|self-?care|ayurved(a|ic)|organic|natural|tea|coffee|candles?|home|decor)\b/i, themes: { soft: 3, luxe: 1, editorial: 1 }, why: 'care / home words' },
  { re: /\b(fashion|apparel|clothing|eyewear|glasses|shoes|bags?|accessor(y|ies)|boutique|lifestyle)\b/i, themes: { magazine: 2, editorial: 2, minimal: 1, bold: 1 }, why: 'fashion words' },
  { re: /\b(food|restaurant|kitchen|meat|deli|grocery|farm|fresh|spices?|recipes?)\b/i, themes: { poster: 2, playful: 2, soft: 1 }, why: 'food words' },
];
const TONE = [
  { re: /\b(bold|loud|energetic|confident|punchy|edgy|fearless|rebellious|street)\b/i, themes: { bold: 3, poster: 2 }, why: 'a bold voice' },
  { re: /\b(playful|fun|cheeky|quirky|witty|joyful|cheerful)\b/i, themes: { playful: 3, poster: 1, soft: 1 }, why: 'a playful voice' },
  { re: /\b(calm|serene|gentle|warm|caring|kind|friendly|soothing)\b/i, themes: { soft: 3, minimal: 1 }, why: 'a warm, calm voice' },
  { re: /\b(elegant|refined|sophisticated|timeless|understated|graceful|luxurious)\b/i, themes: { luxe: 3, editorial: 2 }, why: 'a refined voice' },
  { re: /\b(clear|precise|expert|authoritative|trusted|factual|rigorous|smart|informed)\b/i, themes: { minimal: 2, magazine: 2, editorial: 1 }, why: 'an expert voice' },
];
const BY_MODEL = {
  news_media: { magazine: 3, editorial: 3 },
  market_data: { minimal: 3, magazine: 2 },
  subscription: { minimal: 2, soft: 1 },
  events: { poster: 3, bold: 1 },
  services: { minimal: 2, editorial: 1 },
  commerce: {},
};

function hexRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const f = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(f)) return null;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function saturation(hex) {
  const c = hexRgb(hex);
  if (!c) return null;
  const [r, g, b] = c.map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const l = (mx + mn) / 2;
  return (mx - mn) / (1 - Math.abs(2 * l - 1));
}

function brandKey(brand) {
  const b = brand || {};
  return String(b.id || b.slug || b.website || b.name || '');
}

/** The brand's themes, ranked, each with the reasons that put it there. */
function affinity(brand) {
  const b = brand || {};
  const score = Object.fromEntries(THEME_IDS.map((t) => [t, 1]));
  const reasons = Object.fromEntries(THEME_IDS.map((t) => [t, []]));
  const add = (map, why) => { for (const [t, w] of Object.entries(map || {})) { score[t] += w; reasons[t].push(why); } };
  let model = 'commerce';
  try { model = require('./asset-playbooks.js').businessModel(b); } catch (_) { /* commerce */ }
  add(BY_MODEL[model], `business model: ${model.replace('_', ' ')}`);
  const offerings = Array.isArray(b.offerings) ? b.offerings.map((o) => (o && (o.name || o.kind)) || '').join(' ') : '';
  const corpus = [b.industry, b.tagline, b.description, offerings, Array.isArray(b.claims) ? b.claims.join(' ') : ''].join(' ');
  for (const p of PULL) if (p.re.test(corpus)) add(p.themes, p.why);
  const voice = b.voice || {};
  const tone = [voice.tone, Array.isArray(voice.preferred) ? voice.preferred.join(' ') : '', voice.personality].join(' ');
  for (const t of TONE) if (t.re.test(tone)) add(t.themes, t.why);
  const typo = b.typography || {};
  const fam = (s) => String((s && (s.family || s.stack)) || s || '');
  const head = fam(typo.heading);
  if (/serif/i.test(head) && !/sans/i.test(head) || /\b(playfair|garamond|bodoni|didot|caslon|baskerville|merriweather|lora|cormorant|libre caslon|dm serif|fraunces|georgia|times)\b/i.test(head)) add({ editorial: 2, luxe: 2, magazine: 1 }, `a serif heading face (${head.split(',')[0].replace(/['"]/g, '')})`);
  if (/\b(black|heavy|extra ?bold|anton|bebas|oswald|archivo black|montserrat|druk|impact|league gothic)\b/i.test(head) || /[89]00/.test(String(typo.heading && typo.heading.weights || ''))) add({ bold: 2, poster: 1 }, 'a heavy display face');
  if (/\b(rounded|nunito|quicksand|varela|comfortaa|fredoka|baloo|poppins)\b/i.test(head)) add({ soft: 2, playful: 1 }, 'a rounded face');
  const sat = saturation(b.palette && b.palette.primary);
  if (sat != null && sat >= 0.6) add({ poster: 2, bold: 1, playful: 1 }, 'a saturated primary colour');
  else if (sat != null && sat <= 0.22) add({ minimal: 2, luxe: 1, editorial: 1 }, 'a muted primary colour');
  // The corners and buttons the brand's own site draws, when it was read.
  const ds = (b.brand_data && b.brand_data.design_system) || b.design_system || {};
  const btn = (ds.components && (ds.components['button-primary'] || ds.components.button)) || ds.button || {};
  const rad = Number(String(btn.radius != null ? btn.radius : (btn.borderRadius != null ? btn.borderRadius : '')).replace(/px$/, ''));
  if (Number.isFinite(rad) && String(btn.radius != null ? btn.radius : btn.borderRadius) !== '') {
    if (rad >= 20) add({ soft: 2, poster: 1, playful: 1 }, `its site's round buttons (${rad}px)`);
    else if (rad <= 2) add({ bold: 1, editorial: 1, luxe: 1, minimal: 1 }, "its site's square buttons");
  }
  if (/upper/i.test(String(btn.textTransform || btn.transform || ''))) add({ bold: 1, luxe: 1 }, "its site's upper-case buttons");
  // The brand's own signature breaks every tie, differently for every brand.
  const k = brandKey(b);
  const ranked = THEME_IDS.map((t) => ({ id: t, score: score[t] + (seedOf(k, 'theme', t) % 1000) / 1000, reasons: reasons[t] }))
    .sort((x, y) => y.score - x.score);
  return { model, ranked, family: ranked.slice(0, 4).map((r) => r.id) };
}

/* A weighted schedule with no two neighbours equal (wrap included). */
function schedule(items, weights, seed) {
  const bag = [];
  items.forEach((it, i) => { for (let n = 0; n < (weights[i] || 1); n++) bag.push(it); });
  // Deterministic shuffle, then spread so no two neighbours repeat.
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return s / 4294967296; };
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < bag.length; i++) {
      const nx = (i + 1) % bag.length;
      if (bag[i] === bag[nx] && bag.length > 1) {
        const j = bag.findIndex((x, q) => x !== bag[i] && q !== i && bag[(q + 1) % bag.length] !== bag[i] && bag[(q - 1 + bag.length) % bag.length] !== bag[i]);
        if (j >= 0) [bag[nx], bag[j]] = [bag[j], bag[nx]];
      }
    }
  }
  return bag;
}

function dayIndex(entry) {
  const d = Date.parse(String((entry && entry.date) || '').slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(d) ? Math.floor(d / 86400000) : (seedOf(entry && entry.id) % 3650);
}

/**
 * The theme and template for one asset of one generation.
 * kind: 'mail' | 'text' | 'ad' | 'video' | 'landing'; name: the asset's own
 * name ('mail:visual', 'ad:meta:static', ...). opts.take moves the schedule.
 */
function pick(entry, kind, name, opts) {
  const e = entry || {};
  const o = opts || {};
  const brand = e.brand || o.brand || {};
  const aff = affinity(brand);
  const k = brandKey(brand);
  const take = o.take != null ? o.take : (e.__take != null ? e.__take : '');
  const lane = `${e.market || ''}|${(e.cohort && (e.cohort.key || e.cohort.name)) || ''}`;
  const day = dayIndex(e) + (seedOf(k, lane, name, take) % 997);
  // Themes: the brand's top four, weighted 4/3/2/1.
  const tSched = schedule(aff.family, [4, 3, 2, 1], seedOf(k, 'themes', kind, take));
  const theme = THEMES[tSched[day % tSched.length]];
  // Templates: every template of the kind, the order the brand's own.
  const list = TEMPLATES[kind] || ['default'];
  const mSched = schedule(list, list.map(() => 1), seedOf(k, 'templates', kind, take));
  const template = mSched[(day + Math.floor(day / mSched.length)) % mSched.length];
  const id = `${theme.id}.${template}.${seedOf(k, e.id || e.date || '', name, take).toString(36)}`;
  return {
    id, theme: Object.assign({}, theme), template, kind,
    family: aff.family,
    why: `${theme.label} is one of ${brand.name || 'this brand'}'s themes (${(aff.ranked.find((r) => r.id === theme.id) || { reasons: [] }).reasons.slice(0, 3).join('; ') || 'its own signature'}); the ${template} template rotates by send.`,
  };
}

/** The template a renderer can actually fill: the chosen one, else the next in the kind's list that `can` accepts. */
function fallback(kind, chosen, can) {
  const list = TEMPLATES[kind] || [];
  const start = Math.max(0, list.indexOf(chosen));
  for (let i = 0; i < list.length; i++) { const t = list[(start + i) % list.length]; if (!can || can(t)) return t; }
  return chosen;
}

/* Small shared helpers renderers use to turn a theme into CSS values. */
function headingCss(theme, basePx, family, color) {
  const h = theme.heading;
  const size = Math.round(basePx * h.scale);
  return `font-family:${family};font-size:${size}px;line-height:${h.case === 'upper' ? 1.12 : 1.18};font-weight:${h.weight};letter-spacing:${h.tracking};text-transform:${h.case === 'upper' ? 'uppercase' : 'none'};${h.italic ? 'font-style:italic;' : ''}color:${color};`;
}
function pad(theme) {
  return theme.density === 'airy' ? 40 : (theme.density === 'compact' ? 22 : 32);
}

module.exports = { THEMES, THEME_IDS, TEMPLATES, affinity, pick, fallback, schedule, seedOf, headingCss, pad, saturation };
