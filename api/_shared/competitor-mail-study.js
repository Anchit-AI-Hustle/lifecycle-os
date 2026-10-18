'use strict';
/**
 * competitor-mail-study.js - what the brand's competitors' emails are MADE OF,
 * measured, and what that means for the mail this platform writes.
 *
 * The operator (2026-10-18): "atrocious mailer quality - do competitive research
 * properly using the competitive benchmarking feature that I have created and
 * then create the best quality assets for the selected brand", then: "this is a
 * general and important update required for any and every brand".
 *
 * The competitive benchmarking feature already COLLECTS competitor emails
 * (`ci_emails`, filled by ci-collect from the inbox bridge, and the captured
 * mail archive). Nothing read them when a mail was made: the copywriter got a
 * list of trending hooks and the renderer drew the same thin layout for every
 * brand. This module reads those emails and measures each one the same way:
 *
 *   - the subject (characters, words), the headline (words), the copy (words);
 *   - pictures: how many, whether the first one runs the full width;
 *   - buttons: how many, solid or outline, the verbs on them;
 *   - a product grid (pictures beside prices), a strip of service promises,
 *     a row of shop-by links, a split feature block, an offer, the footer.
 *
 * Measured from the HTML as sent, never guessed. Then `patterns()` turns a set
 * of measurements into shares and medians, and `layoutFor()` / `briefLines()`
 * turn the patterns into decisions for the renderer and words for the brief.
 *
 * WHERE THE EMAILS COME FROM, in order (`studyFor`):
 *   1. the brand's OWN competitor set (`brand_competitors`) matched to the
 *      emails the feature captured (`ci_emails`), by name or sending domain;
 *   2. when that set has fewer than MIN_OWN emails, the shipped REFERENCE study
 *      (`data/benchmarks/mail-reference.json`): emails from category leaders,
 *      measured by this same function, each with the URL it was read from. It is
 *      labelled `basis: 'reference'`, never presented as this brand's rivals.
 *
 * What it never does: copy a competitor's words, offer, claim or picture. The
 * study shapes STRUCTURE (sections, lengths, button count) and tells the writer
 * how long the lines run; every fact in the mail is still the brand's own.
 *
 * NOT a function file (api/_shared/ -> outside the Hobby 12-function cap).
 */

const fs = require('fs');
const path = require('path');

const MIN_OWN = 3;
const REFERENCE = path.join(__dirname, '..', '..', 'data', 'benchmarks', 'mail-reference.json');

// ── reading one email ────────────────────────────────────────────────────────
const decode = (s) => String(s || '')
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&zwnj;|&#8204;|&#847;|&shy;/gi, '')
  .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
  .replace(/&#39;|&rsquo;|&#8217;/gi, '\'').replace(/&[a-z]+;/gi, ' ').replace(/&#\d+;/g, ' ');
const textOf = (html) => decode(String(html || '').replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/[​-‏͏﻿]/g, '').replace(/\s+/g, ' ').trim();
const words = (t) => String(t || '').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
const attr = (tag, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[2] ?? m[3] ?? m[4] ?? '') : ''; };
const styleOf = (tag) => attr(tag, 'style').toLowerCase();
const pxOf = (v) => { const m = /(\d+(?:\.\d+)?)/.exec(String(v || '')); return m ? Number(m[1]) : null; };

// The hidden preheader block is not part of what the reader sees.
function visibleHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(div|span|td|p)[^>]*style\s*=\s*"[^"]*(display\s*:\s*none|max-height\s*:\s*0|mso-hide\s*:\s*all|font-size\s*:\s*0|opacity\s*:\s*0)[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}

function imagesIn(html) {
  const out = [];
  const re = /<img\b[^>]*>/gi; let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const st = styleOf(tag);
    const w = pxOf(attr(tag, 'width')) || pxOf((/(?:^|;)\s*(?:max-)?width\s*:\s*([^;]+)/.exec(st) || [])[1]);
    const h = pxOf(attr(tag, 'height')) || pxOf((/(?:^|;)\s*height\s*:\s*([^;]+)/.exec(st) || [])[1]);
    const src = attr(tag, 'src');
    // Tracking pixels, spacers and social icons are not pictures a reader looks at.
    if ((w && w <= 48) || (h && h <= 48)) continue;
    if (/spacer|pixel|track|open\.|\/o\.gif|blank\.gif|transparent/i.test(src)) continue;
    if (/facebook|instagram|twitter|tiktok|youtube|pinterest|linkedin|social/i.test(src + ' ' + attr(tag, 'alt')) && (!w || w <= 64)) continue;
    out.push({ at: m.index, w, h, alt: attr(tag, 'alt'), full: !!(w && w >= 560) || /width\s*:\s*100%/.test(st) });
  }
  return out;
}

// A button is a link drawn as a control: a filled or bordered box with padding,
// or a link inside a cell that is.
function buttonsIn(html) {
  const out = [];
  const re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    const label = textOf(m[1]);
    if (!label || label.length > 40 || /<img/i.test(m[1])) continue;
    const st = styleOf(tag);
    const before = html.slice(Math.max(0, m.index - 400), m.index);
    const cell = (/<td\b[^>]*>(?![\s\S]*<td\b)[\s\S]*$/i.exec(before) || [''])[0].slice(0, 400);
    const cst = styleOf(cell);
    const filled = /background(-color)?\s*:\s*(?!transparent|none|#fff\b|#ffffff\b|white\b)[#a-z(]/.test(st) || (/background(-color)?\s*:\s*(?!transparent|none|#fff\b|#ffffff\b|white\b)[#a-z(]/.test(cst) && /padding/.test(cst)) || /\bbgcolor\s*=\s*"(?!#fff|#ffffff|white)/i.test(cell);
    const outlined = /border\s*:\s*[^;]*\d+(\.\d+)?px\s+solid/.test(st) || (/border\s*:\s*[^;]*\d+px\s+solid/.test(cst) && /padding/.test(cst));
    const padded = /padding/.test(st) || /padding/.test(cst);
    if ((filled || outlined) && padded) out.push({ at: m.index, label, kind: filled ? 'solid' : 'outline' });
  }
  return out;
}

const PRICE = /(?:[$£€₹]|\b(?:usd|inr|gbp|eur|rs\.?)\s?)\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:usd|inr|gbp|eur)\b/gi;
const SERVICE = /\b(free|shipping|delivery|returns?|exchange|warranty|guarantee|store|stores|support|customer service|try[- ]?on|exam|eye test|points|rewards?|member|pick ?up|financ|klarna|afterpay|insurance|cleaning|fitting|24\/7|same[- ]day|express)\b/i;
const OFFER = /\b\d{1,2}\s?%\s?off\b|\bcode\b|\bpromo\b|\bsale\b|\bbogo\b|\bbuy (one|1) get\b|\bfree gift\b|\bon us\b|\bdiscount\b/i;
const SOCIAL = /instagram|tiktok|facebook|youtube|twitter|x\.com|pinterest|linkedin/i;

// Short sibling cells in one row: a strip of promises (with service words) or
// a row of shop-by links (2+ short link labels side by side, no pictures).
function rowsIn(html) {
  const rows = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi; let m;
  while ((m = re.exec(html))) {
    const inner = m[1];
    if (/<tr\b/i.test(inner)) continue; // innermost rows only
    const cells = inner.split(/<td\b/i).slice(1).map((c) => '<td' + c);
    if (cells.length < 2) continue;
    const texts = cells.map((c) => textOf(c)).filter(Boolean);
    const imgs = (inner.match(/<img\b/gi) || []).length;
    const links = (inner.match(/<a\b/gi) || []).length;
    rows.push({ at: m.index, cells: cells.length, texts, imgs, links, prices: (textOf(inner).match(PRICE) || []).length });
  }
  return rows;
}

function analyse(html, meta) {
  const raw = String(html || '');
  const vis = visibleHtml(raw);
  const body = (/<body\b[^>]*>([\s\S]*)<\/body>/i.exec(vis) || [null, vis])[1];
  const text = textOf(body);
  const imgs = imagesIn(body);
  const btns = buttonsIn(body);
  const rows = rowsIn(body);
  const subject = String((meta && meta.subject) || '').trim();
  // The headline: the first heading tag, else the first line set at 22px or more.
  let headline = '';
  const h = /<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/i.exec(body);
  if (h) headline = textOf(h[1]);
  if (!headline) {
    const re = /<(td|div|p|span|a)\b([^>]*font-size\s*:\s*(\d+(?:\.\d+)?)px[^>]*)>([\s\S]*?)<\/\1>/gi; let m;
    while ((m = re.exec(body))) { if (Number(m[3]) >= 22) { const t = textOf(m[4]); if (t && t.length <= 120) { headline = t; break; } } }
  }
  const priceCount = (text.match(PRICE) || []).length;
  const gridRows = rows.filter((r) => r.imgs >= 2 && r.cells >= 2);
  const productTiles = gridRows.reduce((n, r) => n + r.imgs, 0);
  const serviceRows = rows.filter((r) => r.cells >= 2 && r.cells <= 5 && r.imgs <= r.cells && r.texts.length >= 2
    && r.texts.every((t) => words(t).length <= 9) && r.texts.filter((t) => SERVICE.test(t)).length >= 2);
  const navRows = rows.filter((r) => r.imgs === 0 && r.links >= 2 && r.texts.length >= 2 && r.texts.every((t) => words(t).length <= 4 && !PRICE.test(t)) && !r.texts.some((t) => SOCIAL.test(t) || /unsubscribe|privacy|terms|view in browser|preferences/i.test(t)));
  PRICE.lastIndex = 0;
  const splitRows = rows.filter((r) => r.imgs === 1 && r.cells === 2 && r.texts.join(' ').split(/\s+/).length >= 8);
  const firstImg = imgs[0];
  const firstBtn = btns[0];
  return {
    subject, subject_chars: subject.length, subject_words: words(subject).length,
    headline, headline_words: words(headline).length,
    copy_words: words(text).length,
    images: imgs.length,
    hero_full_width: !!(firstImg && firstImg.full && (!firstBtn || firstImg.at < firstBtn.at)),
    image_before_first_button: !!(firstImg && firstBtn && firstImg.at < firstBtn.at),
    buttons: btns.length,
    button_kinds: { solid: btns.filter((b) => b.kind === 'solid').length, outline: btns.filter((b) => b.kind === 'outline').length },
    button_labels: [...new Set(btns.map((b) => b.label))].slice(0, 8),
    product_grid: productTiles >= 2 && priceCount >= 2,
    product_tiles: productTiles,
    grid_columns: gridRows.length ? Math.max(...gridRows.map((r) => r.imgs)) : 0,
    prices: priceCount,
    service_strip: serviceRows.length > 0,
    service_items: serviceRows.length ? serviceRows[0].texts.slice(0, 5) : [],
    shop_by_links: navRows.length > 0,
    split_feature: splitRows.length > 0,
    offer: OFFER.test(subject + ' ' + text),
    footer_social: SOCIAL.test(body.slice(-Math.min(body.length, 12000))),
    footer_unsubscribe: /unsubscribe/i.test(text),
  };
}

// ── many emails -> patterns ──────────────────────────────────────────────────
const median = (xs) => { const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null; const i = Math.floor(v.length / 2); return v.length % 2 ? v[i] : Math.round((v[i - 1] + v[i]) / 2); };
const share = (rows, f) => (rows.length ? Math.round((rows.filter(f).length / rows.length) * 100) / 100 : 0);

function patterns(measured) {
  const rows = (measured || []).filter(Boolean);
  const verbs = {};
  for (const r of rows) for (const l of r.button_labels || []) {
    const v = String(l).trim().split(/\s+/)[0];
    if (v && /^[A-Za-z]/.test(v)) { const k = v[0].toUpperCase() + v.slice(1).toLowerCase(); verbs[k] = (verbs[k] || 0) + 1; }
  }
  return {
    emails: rows.length,
    subject_chars: median(rows.map((r) => r.subject_chars).filter((n) => n > 0)),
    headline_words: median(rows.map((r) => r.headline_words).filter((n) => n > 0)),
    copy_words: median(rows.map((r) => r.copy_words)),
    images: median(rows.map((r) => r.images)),
    buttons: median(rows.map((r) => r.buttons)),
    share: {
      hero_full_width: share(rows, (r) => r.hero_full_width),
      image_before_first_button: share(rows, (r) => r.image_before_first_button),
      product_grid: share(rows, (r) => r.product_grid),
      picture_rows: share(rows, (r) => (r.picture_rows || 0) > 0 || r.product_grid),
      headline_in_image: share(rows, (r) => r.headline_in_image),
      service_strip: share(rows, (r) => r.service_strip),
      shop_by_links: share(rows, (r) => r.shop_by_links),
      split_feature: share(rows, (r) => r.split_feature),
      offer: share(rows, (r) => r.offer),
      outline_buttons: share(rows, (r) => (r.button_kinds || {}).outline > 0),
    },
    grid_columns: median(rows.filter((r) => r.grid_columns).map((r) => r.grid_columns)),
    button_verbs: Object.entries(verbs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, n]) => ({ verb: v, n })),
  };
}

// ── patterns -> decisions ────────────────────────────────────────────────────
// What the renderer should draw. A section is drawn when at least 40% of the
// studied emails carry it AND the brand has the facts to fill it (the renderer
// checks the second half: no claims, no service strip; no URLs, no shop-by row).
// A section a fifth or more of the studied emails carry is drawn (when the
// brand can fill it); one fewer use is left out. With no study, every section
// the brand can fill is drawn.
function layoutFor(p) {
  const s = (p && p.share) || {};
  const none = !p || !p.emails;
  const on = (k, at = 0.2) => none || (s[k] || 0) >= at;
  const cols = p && p.grid_columns >= 3 ? 3 : 2;
  return {
    hero_full_width: none || on('hero_full_width', 0.35) || on('image_before_first_button', 0.5),
    product_grid: on('picture_rows') || on('product_grid'),
    grid_columns: cols,
    grid_max: cols === 3 ? 3 : 4,
    service_strip: on('service_strip'),
    shop_by_links: on('shop_by_links'),
    split_feature: on('split_feature'),
    secondary_outline: (s.outline_buttons || 0) >= 0.3,
    headline_words_max: Math.max(4, Math.min(9, (p && p.headline_words) || 7)),
    subject_chars_max: Math.max(28, Math.min(60, ((p && p.subject_chars) || 42) + 8)),
  };
}

function briefLines(study) {
  if (!study || !study.patterns || !study.patterns.emails) return [];
  const p = study.patterns;
  const who = study.basis === 'own'
    ? `${p.emails} emails from this brand's own competitors (${(study.sources || []).slice(0, 6).join(', ')})`
    : `${p.emails} emails from category leaders (${(study.sources || []).slice(0, 6).join(', ')}) - a reference set, not this brand's own competitor list`;
  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  const L = [`COMPETITOR EMAILS STUDIED: ${who}. Measured from the HTML as sent.`];
  if (p.subject_chars) L.push(`- Subject lines run about ${p.subject_chars} characters. Keep yours within ${layoutFor(p).subject_chars_max}, and never put a product's model or SKU code in it (say what the product is instead).`);
  if (p.headline_words) L.push(`- Headlines run about ${p.headline_words} words. Keep the hero headline to ${layoutFor(p).headline_words_max} words or fewer, a promise or a reason, never a product code.`);
  if (p.copy_words) L.push(`- The whole mail carries about ${p.copy_words} words: the picture and the products do the rest.`);
  L.push(`- ${pct(p.share.image_before_first_button)} put a picture before the first button; ${pct(p.share.product_grid)} show a grid of products with prices; ${pct(p.share.service_strip)} carry a strip of service promises.`);
  if (p.button_verbs && p.button_verbs.length) L.push(`- Their buttons start with: ${p.button_verbs.slice(0, 6).map((v) => v.verb).join(', ')}. Use one specific verb, not "Learn more".`);
  L.push('- Use these as SHAPE only. Never copy a competitor\'s words, offer, claim or picture; every fact stays this brand\'s own.');
  return L;
}

// ── where the emails come from ───────────────────────────────────────────────
let _ref = null;
function reference() {
  if (_ref) return _ref;
  try { _ref = JSON.parse(fs.readFileSync(REFERENCE, 'utf8')); } catch (_) { _ref = { emails: [] }; }
  return _ref;
}

// The reference emails closest to this brand's category, by the words of its
// own industry / offerings / product types. With no match, every reference email.
function referenceFor(brand) {
  const ref = reference();
  const all = Array.isArray(ref.emails) ? ref.emails : [];
  const hay = [brand && brand.industry, ...((brand && brand.offerings) || []).map((o) => (o && (o.name || o.kind)) || '')].join(' ').toLowerCase();
  // Whole words only: "wear" must not match inside "eyewear".
  const has = (w) => new RegExp(`(^|[^a-z])${String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(hay);
  const near = all.filter((e) => (e.categories || []).some(has));
  const rows = near.length >= MIN_OWN ? near : all;
  return { rows, matched: near.length >= MIN_OWN };
}

const fold = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const hostOf = (u) => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } };

// Read the emails the competitive benchmarking feature captured for this
// brand's competitor set. Service role, the workspace named on the competitor
// read; ci_emails is the feature's own store. Any failure is said, not hidden.
async function ownEmails(workspaceId, { limit = 40 } = {}) {
  if (!workspaceId) return { rows: [], names: [], reason: 'no workspace' };
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!base || !key) return { rows: [], names: [], reason: 'no workspace database configured' };
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (q) => { const r = await fetch(`${base}/rest/v1/${q}`, { headers: h }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };
  let comps = [];
  try { comps = await get(`brand_competitors?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=name,domain&limit=60`); } catch (e) { return { rows: [], names: [], reason: `competitor set unreadable (${e.message})` }; }
  if (!comps.length) return { rows: [], names: [], reason: 'this brand has no competitor set yet' };
  let mails = [];
  try { mails = await get(`ci_emails?select=brand_name,sender,subject,html,send_date&html=not.is.null&order=send_date.desc.nullslast&limit=400`); } catch (e) { return { rows: [], names: comps.map((c) => c.name), reason: `captured competitor emails unreadable (${e.message})` }; }
  const keys = comps.map((c) => ({ name: c.name, n: fold(c.name), d: hostOf(c.domain || '').split('.').slice(-2).join('.') }));
  const rows = [];
  for (const m of mails) {
    const who = fold(m.brand_name); const dom = hostOf(String(m.sender || '').split('@')[1] || '').split('.').slice(-2).join('.');
    const k = keys.find((x) => (x.n && who && (who === x.n || who.includes(x.n) || x.n.includes(who))) || (x.d && dom && dom === x.d));
    if (k) rows.push({ brand: k.name, subject: m.subject || '', html: m.html });
    if (rows.length >= limit) break;
  }
  return { rows, names: comps.map((c) => c.name), reason: rows.length ? '' : 'no captured emails from this brand\'s competitors yet' };
}

const _cache = new Map();
async function studyFor(brand, { workspaceId = null, own = null } = {}) {
  const key = `${workspaceId || (brand && (brand.id || brand.name)) || ''}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.v;
  let o = own;
  if (!o) { try { o = await ownEmails(workspaceId); } catch (e) { o = { rows: [], reason: e.message }; } }
  let v;
  if (o && o.rows && o.rows.length >= MIN_OWN) {
    const measured = o.rows.map((r) => analyse(r.html, { subject: r.subject }));
    v = { basis: 'own', sources: [...new Set(o.rows.map((r) => r.brand))], patterns: patterns(measured) };
  } else {
    const ref = referenceFor(brand);
    v = {
      basis: 'reference', matched_category: ref.matched,
      sources: [...new Set(ref.rows.map((e) => e.brand))],
      patterns: patterns(ref.rows.map((e) => e.measured)),
      why: (o && o.reason) || 'fewer than three captured emails from this brand\'s competitors',
    };
  }
  v.layout = layoutFor(v.patterns);
  _cache.set(key, { at: Date.now(), v });
  return v;
}

// Synchronous: the reference study only, for renderers that cannot await.
function referenceStudy(brand) {
  const ref = referenceFor(brand);
  const v = { basis: 'reference', matched_category: ref.matched, sources: [...new Set(ref.rows.map((e) => e.brand))], patterns: patterns(ref.rows.map((e) => e.measured)) };
  v.layout = layoutFor(v.patterns);
  return v;
}

module.exports = { analyse, patterns, layoutFor, briefLines, studyFor, referenceStudy, referenceFor, ownEmails, MIN_OWN, _cache };

// ── measuring an email AS RENDERED (Chromium) ────────────────────────────────
// Most competitor mail sets its headline in an image or a class with no inline
// width, so a static read under-counts. This runs inside the page (a 640px
// window, the email loaded with its pictures) and measures boxes and computed
// styles. Same output shape as analyse().
function measureInPage(meta) {
  /* eslint-disable no-undef */
  const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const all = [...document.querySelectorAll('body *')].filter(vis);
  const imgs0 = [...document.images].filter(vis).map((i) => ({ el: i, r: i.getBoundingClientRect() })).filter((x) => x.r.width >= 60 && x.r.height >= 40);
  const W = Math.max(320, ...imgs0.map((x) => x.r.width), ...[...document.querySelectorAll('table')].filter(vis).map((t) => Math.min(700, t.getBoundingClientRect().width)));
  const docH = document.documentElement.scrollHeight || 1;
  const bg = (el) => { let e = el; while (e && e !== document.body) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; e = e.parentElement; } return 'rgb(255, 255, 255)'; };
  const lum = (c) => { const m = /(\d+), (\d+), (\d+)/.exec(c || ''); return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : 1; };
  const words = (t) => String(t || '').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
  // pictures (not icons: an icon is under 60px)
  const imgs = imgs0.filter((x) => !(x.r.width <= 64 && x.r.height <= 64));
  // buttons: a link whose own box, or the cell around it, is filled or bordered
  const btns = [];
  for (const a of [...document.querySelectorAll('a')].filter(vis)) {
    const t = (a.innerText || '').trim().replace(/\s+/g, ' ');
    if (!t || t.length > 40 || a.querySelector('img')) continue;
    const r = a.getBoundingClientRect();
    if (r.width > W * 0.9) continue;
    // The box that draws the button: the link itself or a cell around it,
    // filled (not the ground around it) or bordered, the size of a control.
    let el = a; let kind = '';
    for (let i = 0; i < 3 && el; i++, el = el.parentElement) {
      const s = getComputedStyle(el); const er = el.getBoundingClientRect();
      if (er.height > 100 || er.width > W * 0.95) break;
      if (er.height < 24) continue;
      const own = s.backgroundColor; const outer = bg(el.parentElement || el);
      if (own && !/rgba\(0, 0, 0, 0\)|transparent/.test(own) && own !== outer) { kind = 'solid'; break; }
      if (parseFloat(s.borderTopWidth) >= 1 && s.borderTopStyle !== 'none' && parseFloat(s.borderBottomWidth) >= 1) { kind = 'outline'; break; }
    }
    if (kind) btns.push({ top: r.top + scrollY, label: t, kind });
  }
  // headline: the largest text set in the top 45% of the mail
  let head = null;
  for (const el of all) {
    if (el.children.length && [...el.children].some((c) => (c.innerText || '').trim())) continue;
    const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
    if (!t || t.length > 140) continue;
    const r = el.getBoundingClientRect(); const top = r.top + scrollY;
    if (top > Math.max(docH * 0.45, 760)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs >= 20 && (!head || fs > head.fs)) head = { fs, t, top };
  }
  // rows: elements of similar size side by side
  const groupBy = (xs, key) => { const g = []; for (const x of xs) { const k = g.find((y) => Math.abs(key(y[0]) - key(x)) < 12); if (k) k.push(x); else g.push([x]); } return g; };
  const PRICE = /(?:[$£€₹]|\b(?:usd|inr|gbp|eur|rs\.?)\s?)\s?\d|\bfrom\s+[$£€₹]/i;
  const tiles = imgs.filter((x) => x.r.width < W * 0.6 && x.r.width >= 80);
  const tileRows = groupBy(tiles, (x) => x.r.top + scrollY).filter((g) => g.length >= 2);
  const priceNear = (g) => g.some((x) => { let e = x.el; for (let i = 0; i < 6 && e; i++, e = e.parentElement) { if (PRICE.test(e.innerText || '')) return true; } return false; });
  const gridRows = tileRows.filter(priceNear);
  // a shop-by row: 3+ short links sharing a line, above the footer
  const links = [...document.querySelectorAll('a')].filter(vis).map((a) => ({ a, t: (a.innerText || '').trim(), r: a.getBoundingClientRect() }))
    .filter((x) => x.t && words(x.t).length <= 4 && !/unsubscribe|privacy|terms|preferences|view in browser|view online/i.test(x.t) && x.r.top + scrollY < docH - 60);
  const navRows = groupBy(links, (x) => x.r.top + scrollY).filter((g) => g.length >= 3);
  // a service strip: 3-5 short blocks on one line, with service words
  const SERVICE = /\b(free|shipping|delivery|returns?|exchange|warranty|guarantee|store|support|try|exam|points|rewards?|member|pick ?up|insurance|cleaning|fitting|24\/7|same[- ]day|express|ships|fast|gift|secure)\b/i;
  const leaves = all.filter((el) => !el.children.length || [...el.children].every((c) => c.tagName === 'BR' || c.tagName === 'STRONG' || c.tagName === 'B' || c.tagName === 'SPAN'))
    .map((el) => ({ el, t: (el.innerText || '').trim().replace(/\s+/g, ' '), r: el.getBoundingClientRect() })).filter((x) => x.t && words(x.t).length <= 9 && x.r.width < W * 0.4);
  const svcRows = groupBy(leaves, (x) => x.r.top + scrollY).filter((g) => g.length >= 3 && g.length <= 6 && g.filter((x) => SERVICE.test(x.t)).length >= 2);
  // a split feature: a picture 30-60% wide with 8+ words beside it
  const split = imgs.some((x) => x.r.width >= W * 0.3 && x.r.width <= W * 0.62 && leaves.concat(all.filter((e) => words(e.innerText).length >= 8 && e.getBoundingClientRect().width < W * 0.7)).some((y) => { const r = y.r || y.getBoundingClientRect(); return Math.abs((r.top + r.height / 2) - (x.r.top + x.r.height / 2)) < x.r.height / 2 && (r.left > x.r.right - 4 || r.right < x.r.left + 4) && words(y.t || y.innerText).length >= 3; }));
  // bands: distinct section grounds wider than 80% of the column
  const bands = new Set(all.filter((e) => { const r = e.getBoundingClientRect(); return r.width >= W * 0.8 && r.height >= 60; }).map((e) => getComputedStyle(e).backgroundColor).filter((c) => !/rgba\(0, 0, 0, 0\)|transparent/.test(c)));
  const firstImg = imgs.sort((a, b) => a.r.top - b.r.top)[0];
  const firstBtn = btns.sort((a, b) => a.top - b.top)[0];
  const subject = String((meta && meta.subject) || '').trim();
  const OFFER = /\b\d{1,2}\s?%\s?off\b|\bcode\b|\bpromo\b|\bsale\b|\bbogo\b|\bbuy (one|1) get\b|\bfree gift\b|\bon us\b|\bdiscount\b/i;
  return {
    subject, subject_chars: subject.length, subject_words: words(subject).length,
    headline: head ? head.t : '', headline_words: head ? words(head.t).length : 0,
    headline_in_image: !head,
    copy_words: words(text).length,
    images: imgs.length,
    hero_full_width: !!(firstImg && firstImg.r.width >= W * 0.9 && firstImg.r.top + scrollY < docH * 0.4),
    image_before_first_button: !!(firstImg && (!firstBtn || firstImg.r.top + scrollY < firstBtn.top)),
    buttons: btns.length,
    button_kinds: { solid: btns.filter((b) => b.kind === 'solid').length, outline: btns.filter((b) => b.kind === 'outline').length },
    button_labels: [...new Set(btns.map((b) => b.label))].slice(0, 8),
    product_grid: gridRows.length > 0,
    product_tiles: gridRows.reduce((n, g) => n + g.length, 0),
    grid_columns: gridRows.length ? Math.max(...gridRows.map((g) => g.length)) : (tileRows.length ? Math.max(...tileRows.map((g) => g.length)) : 0),
    picture_rows: tileRows.length,
    prices: (text.match(/[$£€₹]\s?\d/g) || []).length,
    service_strip: svcRows.length > 0,
    service_items: svcRows.length ? svcRows[0].map((x) => x.t).slice(0, 5) : [],
    shop_by_links: navRows.length > 0,
    split_feature: split,
    section_grounds: bands.size,
    dark_band: [...bands].some((c) => lum(c) < 0.25),
    offer: OFFER.test(subject + ' ' + text),
    footer_social: /instagram|tiktok|facebook|youtube|twitter|x\.com|pinterest/i.test([...document.querySelectorAll('a')].map((a) => a.href).join(' ')),
    footer_unsubscribe: /unsubscribe/i.test(text),
    height_px: docH,
    method: 'rendered',
  };
  /* eslint-enable no-undef */
}
module.exports.measureInPage = measureInPage;
