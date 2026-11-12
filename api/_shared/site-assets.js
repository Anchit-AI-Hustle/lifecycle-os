'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ON-SITE AND DISPLAY ASSETS OF A SEND (2026-11-12)
//
// The operator: "add any more assets if required as per industry standards".
// A send already carried a mail, landing pages, paid ads, social posts, music
// and (where the brand states the channels) SMS / WhatsApp / push. Two kinds a
// campaign normally ships with were missing:
//
//   ON-SITE  what the brand's own website shows while the send is live: an
//            announcement bar, a home-page banner and a pop-up. Without them a
//            visitor arriving from the mail meets a site that does not mention
//            the send.
//   DISPLAY  banner ads in the sizes the Google Display Network accepts, and
//            the text of a Google responsive display ad.
//
// Like social posts they are written for EVERYONE (a website and a banner are
// public), so they say only what is true for everyone: the store's own
// sentences about the product, its name and price, the brand's tagline, claims
// and offering names. The ads' cohort-addressed text is never used. No model is
// called. A line that does not fit is not used; nothing is cut.
//
// SIZES AND LIMITS, read 2026-11-12:
//   support.google.com/google-ads/answer/1722096 (uploaded display ads): the
//     sizes below are on its list; image ads are GIF, JPG or PNG, 150 KB at
//     most; HTML5 ads 600 KB.
//   support.google.com/google-ads/answer/7005917 (responsive display ads):
//     1 to 5 short headlines of 30 characters or fewer; one long headline of 90
//     or fewer; 1 to 5 descriptions; landscape image 1200x628 (1.91:1, at least
//     600x314); square image 1200x1200 (at least 300x300). The page states no
//     character limit for a description or the business name: 90 and 25 are
//     recorded here as UNVERIFIED and only warn.
// ─────────────────────────────────────────────────────────────────────────────

const MARKER = /\[DATA REQUIRED/i;

const BANNER_SIZES = [
  { key: '300x250', w: 300, h: 250, name: 'Inline rectangle', shape: 'box' },
  { key: '336x280', w: 336, h: 280, name: 'Large rectangle', shape: 'box' },
  { key: '728x90', w: 728, h: 90, name: 'Leaderboard', shape: 'strip' },
  { key: '970x250', w: 970, h: 250, name: 'Billboard', shape: 'wide' },
  { key: '300x600', w: 300, h: 600, name: 'Half-page ad', shape: 'tower' },
  { key: '160x600', w: 160, h: 600, name: 'Wide skyscraper', shape: 'tower' },
  { key: '320x50', w: 320, h: 50, name: 'Mobile banner', shape: 'strip' },
  { key: '320x100', w: 320, h: 100, name: 'Large mobile banner', shape: 'strip' },
];
const UPLOAD = { formats: ['GIF', 'JPG', 'PNG'], max_kb: 150, html5_max_kb: 600, source: 'https://support.google.com/google-ads/answer/1722096' };
const RESPONSIVE = {
  short_headline: { max: 30, count: [1, 5], verified: true },
  long_headline: { max: 90, count: [1, 1], verified: true },
  description: { max: 90, count: [1, 5], verified: false },
  business_name: { max: 25, count: [1, 1], verified: false },
  images: { landscape: '1200x628 (1.91:1, at least 600x314)', square: '1200x1200 (at least 300x300)' },
  source: 'https://support.google.com/google-ads/answer/7005917',
};
const BAR_MAX = 90;      // one line on a phone; our own layout rule, not a platform's

const str = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const fold = (t) => str(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ok = (t) => { const s = str(t); return s && !MARKER.test(s) && !/\{\{/.test(s) ? s : ''; };
const noStop = (t) => str(t).replace(/[.!]+$/, '');
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uniq = (list) => { const seen = []; return list.filter((x) => { const f = fold(x); if (!f || seen.includes(f)) return false; seen.push(f); return true; }); };

/** What the send can say to everyone, each line the record's own. */
function facts(entry, campaign, opts = {}) {
  const b = (entry && entry.brand) || {};
  const svc = require('../../lib/smart-brain/services.js');
  const MF = require('./mailer-format.js');
  const fin = (t) => { let s = str(t); try { if (opts.spell) s = opts.spell(s); if (opts.finish) s = opts.finish(s); } catch (_) { /* as written */ } return str(s); };
  const hp = entry && entry.heroProduct && !entry.heroProduct.placeholder && !MARKER.test(String(entry.heroProduct.title || '')) ? entry.heroProduct : null;
  let pf = {};
  try { pf = (hp && svc.productFacts(entry)) || {}; } catch (_) { pf = {}; }
  const st = pf.story || { what: '', benefits: [], inside: [], how: [] };
  const story = !!st.article;
  const bName = str(b.name);
  const name = fin(hp ? (story ? str(hp.title) : (MF.shortName(hp.title) || str(hp.title))) : bName);
  const price = ok(pf.price);
  const compare = ok(pf.compare);
  const reasons = (story ? [st.what] : [].concat(st.benefits || [], st.inside || [], [st.what])).map(ok).filter(Boolean).map(fin);
  const tagline = fin(ok(b.tagline));
  const claims = (Array.isArray(b.claims) ? b.claims : []).map(ok).filter(Boolean).map(fin);
  const offered = (Array.isArray(b.offerings) ? b.offerings : []).map((o) => ok(o && o.name)).filter((n) => n && n.length <= 30).map(fin);
  let cta = '';
  try { cta = fin(str((entry && entry.cta) || svc.defaultCta(entry))); } catch (_) { cta = ''; }
  if (!cta) cta = 'Learn more';
  const page = /^https:\/\//i.test(String(opts.link || '')) ? String(opts.link) : '';
  let photo = '';
  try { photo = hp ? (require('./catalog-image.js').url(hp, entry.market, { width: 1200, brand: entry.brand }) || '') : ''; } catch (_) { photo = ''; }
  if (!photo && hp && /^https:\/\//i.test(String(hp.image || ''))) photo = String(hp.image);
  if (!/^https:\/\//i.test(photo)) photo = '';
  return { b, bName: fin(bName), hp, story, name, price, compare, reasons, tagline, claims, offered, cta, page, photo, fin };
}

function colours(brand) {
  const rt = require('./brand-runtime.js');
  const core = require('./brand-workspace-core.js');
  const p = rt.paletteOf(brand);
  const band = core.sectionGround(p.primary, p.accent, p.surface) || p.surface;
  const onBand = core.textOn(band, p.surface, p.ink);
  // A control may be the brand's own colour even when a section may not be.
  // It must stand off the band it sits on (1.5:1, the floor the rendered read
  // uses for a call to action); else the surface, else the ink.
  const btnFor = (ground) => {
    const off = (x) => { try { return core.contrast(x, ground) >= 1.5; } catch (_) { return fold(x) !== fold(ground); } };
    const fill = [p.accent, p.primary, p.surface, p.ink].find((x) => x && off(x)) || p.ink;
    return { fill, on: core.textOn(fill, p.surface, p.ink, 4.7) };   // a little over AA: a hex rounds
  };
  const { fill: btn, on: onBtn } = btnFor(band);
  const card = btnFor(p.surface);
  const onSurface = core.textOn(p.surface, p.surface, p.ink);
  const fonts = rt.fontStacks(brand);
  let href = '';
  try { href = core.fontsHref(brand) || ''; } catch (_) { href = ''; }
  return { surface: p.surface, band, onBand, btn, onBtn, cardBtn: card.fill, onCardBtn: card.on, onSurface, line: p.line, head: fonts.head, body: fonts.body, href };
}

function tracked(page, campaign, entry, medium, source, content) {
  if (!page) return '';
  try {
    const MT = require('./marketing-team.js');
    const tag = require('./marketing-team-server.js').campaignTag(campaign, entry);
    return MT.taggable(page) ? MT.utmUrl(page, { utm_source: source, utm_medium: medium, utm_campaign: tag, utm_content: content }) : page;
  } catch (_) { return page; }
}

function doc(c, w, h, inner, css) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${c.href ? `<link rel="stylesheet" href="${esc(c.href)}">` : ''}<style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:${c.surface}}body{font-family:${c.body};color:${c.onSurface}}a{color:inherit;text-decoration:none}${css}</style></head><body>${inner}</body></html>`;
}

// ── On-site ──────────────────────────────────────────────────────────────────
function buildOnsite(f, c, campaign, entry) {
  const link = (what) => tracked(f.page, campaign, entry, 'onsite', 'website', 'onsite-' + what);
  const priceSaid = f.price ? `${f.price}${f.compare ? `, was ${f.compare}` : ''}` : '';
  const lead = f.reasons[0] || f.claims[0] || f.tagline || '';
  const out = {};

  // Announcement bar: one line. The first that fits is used whole.
  const barLine = uniq([
    f.hp && !f.story && priceSaid ? `${f.name}: ${priceSaid}` : '',
    f.hp ? f.name : '',
    noStop(f.tagline), noStop(f.claims[0]), f.bName,
  ].map(ok)).find((x) => x.length <= BAR_MAX) || '';
  if (barLine) {
    const u = link('bar');
    out.announcement_bar = {
      type: 'onsite', key: 'announcement_bar', label: 'Announcement bar', text: barLine, cta: f.cta, ...(u ? { link: u } : {}),
      placement: 'Across the top of every page while the send is live',
      html: doc(c, 0, 0, `<div class="bar" data-onsite="announcement_bar"><span>${esc(barLine)}</span>${u ? `<a class="go" href="${esc(u)}">${esc(f.cta)}</a>` : ''}</div>`,
        `.bar{background:${c.band};color:${c.onBand};display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;justify-content:center;padding:10px 16px;font-size:14px;line-height:1.4;text-align:center}.go{font-weight:700;text-decoration:underline}`),
    };
  }

  // Home-page banner: the product (or the brand), its first reason, one button.
  const heroHead = f.hp ? f.name : (noStop(f.tagline) || f.bName);
  const heroSub = uniq([lead, f.hp && !f.story ? priceSaid : '', f.offered.length >= 2 && !f.hp ? f.offered.slice(0, 4).join(' · ') : ''].map(ok)).filter((x) => fold(x) !== fold(heroHead)).slice(0, 2);
  if (heroHead) {
    const u = link('hero');
    out.hero_banner = {
      type: 'onsite', key: 'hero_banner', label: 'Home-page banner', headline: heroHead, sub: heroSub, cta: f.cta, ...(u ? { link: u } : {}), ...(f.photo ? { image_url: f.photo } : {}),
      placement: 'The first screen of the home page',
      alt_text: f.hp ? `${f.name} from ${f.bName}` : f.bName,
      html: doc(c, 0, 0, `<section class="hero" data-onsite="hero_banner"><div class="txt"><p class="eyebrow">${esc(f.bName)}</p><h1>${esc(heroHead)}</h1>${heroSub.map((s) => `<p class="sub">${esc(s)}</p>`).join('')}${u ? `<a class="btn" href="${esc(u)}">${esc(f.cta)}</a>` : ''}</div>${f.photo ? `<div class="pic"><img src="${esc(f.photo)}" alt="${esc(f.hp ? `${f.name} from ${f.bName}` : f.bName)}"></div>` : ''}</section>`,
        `.hero{background:${c.band};color:${c.onBand};display:flex;flex-wrap:wrap;align-items:center;gap:24px;padding:40px 32px}.txt{flex:1 1 280px;min-width:0}.eyebrow{margin:0 0 8px;font-size:14px;letter-spacing:.06em;text-transform:uppercase}h1{margin:0 0 12px;font-family:${c.head};font-size:40px;line-height:1.1;overflow-wrap:anywhere}.sub{margin:0 0 8px;font-size:16px;line-height:1.5}.btn{display:inline-block;margin-top:12px;background:${c.btn};color:${c.onBtn};padding:14px 24px;border-radius:8px;font-weight:700;font-size:16px;min-height:44px}.pic{flex:1 1 260px;min-width:0}.pic img{display:block;width:100%;max-height:360px;object-fit:cover;border-radius:12px}@media(max-width:520px){.hero{padding:28px 16px}h1{font-size:28px}}`),
    };
  }

  // Pop-up: one message, one button, and a way to close it.
  const popHead = f.hp ? f.name : f.bName;
  const popBody = uniq([lead, f.hp && !f.story ? priceSaid : '', !f.hp ? noStop(f.tagline) : ''].map(ok)).filter((x) => fold(x) !== fold(popHead)).slice(0, 2);
  if (popHead && (popBody.length || f.page)) {
    const u = link('popup');
    out.popup = {
      type: 'onsite', key: 'popup', label: 'Pop-up', headline: popHead, body: popBody, cta: f.cta, dismiss: 'Not now', ...(u ? { link: u } : {}),
      placement: 'Once per visitor, after they have scrolled or as they leave; never on arrival',
      html: doc(c, 0, 0, `<div class="veil" data-onsite="popup"><div class="card" role="dialog" aria-modal="true" aria-label="${esc(popHead)}"><h2>${esc(popHead)}</h2>${popBody.map((s) => `<p>${esc(s)}</p>`).join('')}${u ? `<a class="btn" href="${esc(u)}">${esc(f.cta)}</a>` : ''}<button type="button" class="no">Not now</button></div></div>`,
        `.veil{background:${c.band};padding:32px 16px;display:flex;justify-content:center}.card{background:${c.surface};color:${c.onSurface};border:1px solid ${c.line};border-radius:14px;padding:28px 24px;max-width:420px;width:100%;text-align:center}h2{margin:0 0 10px;font-family:${c.head};font-size:24px;line-height:1.2;overflow-wrap:anywhere}p{margin:0 0 8px;font-size:16px;line-height:1.5}.btn{display:block;margin-top:14px;background:${c.cardBtn};color:${c.onCardBtn};padding:14px 20px;border-radius:8px;font-weight:700;font-size:16px}.no{display:block;margin:10px auto 0;background:none;border:0;color:inherit;font:inherit;font-size:14px;text-decoration:underline;min-height:44px;cursor:pointer}`),
    };
  }
  return out;
}

// ── Display banners ──────────────────────────────────────────────────────────
function bannerHtml(c, S, f, headline, sub, u) {
  const strip = S.shape === 'strip';
  const tower = S.shape === 'tower';
  const small = Math.min(S.w, S.h);
  const hSize = strip ? (S.h <= 50 ? 14 : 16) : (S.w <= 160 ? 18 : small >= 250 ? 22 : 20);
  const pad = strip ? 8 : 14;
  const picCss = strip ? `.pic{flex:0 0 ${S.h}px;height:${S.h}px}` : tower ? `.pic{flex:0 0 ${Math.round(S.h * 0.42)}px;width:100%}` : S.shape === 'wide' ? `.pic{flex:0 0 ${S.h}px;height:${S.h}px}` : `.pic{flex:0 0 ${Math.round(S.h * 0.36)}px;width:100%}`;
  const dir = strip || S.shape === 'wide' ? 'row' : 'column';
  const inner = `<a class="ad" data-banner="${S.key}" ${u ? `href="${esc(u)}"` : ''} style="width:${S.w}px;height:${S.h}px">${f.photo ? `<span class="pic"><img src="${esc(f.photo)}" alt=""></span>` : ''}<span class="txt"><span class="brand">${esc(f.bName)}</span><span class="h">${esc(headline)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span><span class="btn">${esc(f.cta)}</span></a>`;
  const css = `.ad{display:flex;flex-direction:${dir};align-items:${dir === 'row' ? 'center' : 'stretch'};gap:${strip ? 8 : 10}px;overflow:hidden;background:${c.band};color:${c.onBand};border:1px solid ${c.line};padding:${f.photo && dir === 'row' ? `0 ${pad}px 0 0` : f.photo ? `0 0 ${pad}px` : `${pad}px`}}${picCss}.pic{display:block;overflow:hidden}.pic img{display:block;width:100%;height:100%;object-fit:cover}.txt{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:${strip ? 1 : 4}px;${dir === 'column' ? `padding:0 ${pad}px` : ''}}.brand{font-size:${strip ? 10 : 11}px;letter-spacing:.05em;text-transform:uppercase}.h{font-family:${c.head};font-weight:700;font-size:${hSize}px;line-height:1.15;overflow-wrap:anywhere}.sub{font-size:${strip ? 11 : 13}px;line-height:1.3}.btn{flex:0 0 auto;align-self:${dir === 'row' ? 'center' : 'flex-start'};${dir === 'column' ? `margin:0 ${pad}px` : ''};background:${c.btn};color:${c.onBtn};font-weight:700;font-size:${strip ? 12 : 14}px;padding:${strip ? '6px 10px' : '9px 14px'};border-radius:6px;white-space:nowrap}`;
  return doc(c, S.w, S.h, inner, css + `body{width:${S.w}px;height:${S.h}px;overflow:hidden}`);
}

// How many characters of headline a size holds without cutting, at its type size.
function headRoom(S) {
  if (S.key === '320x50') return 22;
  if (S.key === '320x100') return 34;
  if (S.key === '728x90') return 48;
  if (S.key === '160x600') return 44;
  return 60;
}

function buildBanners(f, c, campaign, entry) {
  const u = tracked(f.page, campaign, entry, 'display', 'google', 'display');
  const priceSaid = f.price ? `${f.price}${f.compare ? `, was ${f.compare}` : ''}` : '';
  const heads = uniq([f.hp ? f.name : '', noStop(f.tagline), noStop(f.claims[0]), f.bName].map(ok));
  const subs = uniq([f.hp && !f.story ? priceSaid : '', noStop(f.reasons[0]), noStop(f.claims[0]), noStop(f.tagline)].map(ok));
  const out = [];
  for (const S of BANNER_SIZES) {
    const room = headRoom(S);
    const headline = heads.find((x) => x.length <= room) || '';
    if (!headline) continue;   // nothing the record states fits this size: no banner, never a cut line
    const tight = S.h <= 50 || (S.shape === 'strip' && headline.length > 26);
    const sub = tight ? '' : (subs.find((x) => fold(x) !== fold(headline) && x.length <= (S.shape === 'strip' ? 40 : S.w <= 160 ? 60 : 90)) || '');
    out.push({
      id: `${(campaign && campaign.campaign_id) || (entry && entry.id) || 'send'}_banner_${S.key}`,
      type: 'display_banner', key: S.key, size: S.key, width: S.w, height: S.h, label: `${S.name} ${S.key}`,
      headline, ...(sub ? { sub } : {}), cta: f.cta, business_name: f.bName, ...(u ? { destination_url: u } : {}), ...(f.photo ? { image_url: f.photo } : {}),
      upload: UPLOAD,
      html: bannerHtml(c, S, f, headline, sub, u),
    });
  }
  return out;
}

// The text of a Google responsive display ad, each line inside its limit.
function buildResponsive(f, campaign, entry) {
  const u = tracked(f.page, campaign, entry, 'display', 'google', 'responsive-display');
  const priceSaid = f.price ? `${f.price}${f.compare ? `, was ${f.compare}` : ''}` : '';
  const R = RESPONSIVE;
  const shorts = uniq([f.hp ? f.name : '', f.bName, noStop(f.tagline), ...f.claims.map(noStop), ...(!f.hp ? f.offered : []), f.cta].map(ok)).filter((x) => x.length <= R.short_headline.max).slice(0, R.short_headline.count[1]);
  const long = uniq([
    f.hp && f.reasons[0] ? `${f.name}: ${noStop(f.reasons[0])}` : '',
    f.hp && priceSaid && !f.story ? `${f.name}, ${priceSaid}` : '',
    noStop(f.reasons[0]), noStop(f.tagline), noStop(f.claims[0]), f.hp ? `${f.name} from ${f.bName}` : '', f.bName,
  ].map(ok)).find((x) => x.length <= R.long_headline.max) || '';
  const descs = uniq([...f.reasons, f.hp && priceSaid && !f.story ? `${f.name}, ${priceSaid}.` : '', f.tagline, ...f.claims].map(ok)).filter((x) => x.length <= R.description.max).slice(0, R.description.count[1]);
  if (!shorts.length || !long) return null;
  return {
    id: `${(campaign && campaign.campaign_id) || (entry && entry.id) || 'send'}_google_responsive_display`,
    type: 'google_responsive_display', label: 'Google responsive display ad',
    short_headlines: shorts, long_headline: long, descriptions: descs, business_name: f.bName,
    ...(u ? { final_url: u } : {}),
    images: { ...(f.photo ? { source: f.photo } : {}), landscape: R.images.landscape, square: R.images.square },
    limits: { short_headline: R.short_headline.max, long_headline: R.long_headline.max, description: R.description.max, business_name: R.business_name.max, unverified: ['description', 'business_name'], source: R.source },
  };
}

/**
 * build(entry, campaign, { link, finish, spell }) -> { onsite, display_banners, google_display, data_gaps }
 */
function build(entry, campaign, opts = {}) {
  const f = facts(entry, campaign, opts);
  const gaps = [];
  if (!f.bName) return { onsite: null, display_banners: [], google_display: null, data_gaps: gaps };
  const L = require('./brand-locale.js');
  if (!f.page) gaps.push(L.marker('page to link from on-site and display assets', f.b, entry && entry.market));
  if (!f.photo) gaps.push(L.marker('image for on-site and display assets', f.b, entry && entry.market));
  const c = colours(f.b);
  const onsite = buildOnsite(f, c, campaign, entry);
  const display_banners = buildBanners(f, c, campaign, entry);
  const google_display = buildResponsive(f, campaign, entry);
  return { onsite: Object.keys(onsite).length ? onsite : null, display_banners, google_display, data_gaps: gaps };
}

// Judged on the finished asset, never rewritten.
function check(asset) {
  const out = [];
  const add = (level, slot, message) => out.push({ level, slot, message });
  const bad = (t) => MARKER.test(String(t || '')) || /\{\{|\}\}/.test(String(t || ''));
  if (!asset) return out;
  if (asset.type === 'onsite') {
    const text = [asset.text, asset.headline].concat(asset.sub || [], asset.body || []).filter(Boolean);
    if (!text.length) add('block', 'text', 'The on-site asset says nothing.');
    if (text.some(bad)) add('block', 'text', 'The on-site asset carries a marker or an unfilled tag.');
    if (asset.key === 'announcement_bar' && String(asset.text || '').length > BAR_MAX) add('warn', 'text', `The bar is over ${BAR_MAX} characters and will wrap on a phone.`);
    if (asset.link && !/^https:\/\//i.test(asset.link)) add('block', 'link', 'The link is not https.');
    if (!asset.link) add('warn', 'link', 'No page is on record, so this asset has no button.');
  } else if (asset.type === 'display_banner') {
    if (!String(asset.headline || '').trim()) add('block', 'headline', 'The banner has no headline.');
    if (bad(asset.headline) || bad(asset.sub)) add('block', 'headline', 'The banner carries a marker or an unfilled tag.');
    if (!BANNER_SIZES.some((s) => s.key === asset.size)) add('block', 'size', 'The size is not one Google lists for uploaded display ads.');
    if (!asset.destination_url) add('block', 'destination_url', 'A display ad needs a page to open.');
    else if (!/^https:\/\//i.test(asset.destination_url)) add('block', 'destination_url', 'The destination is not https.');
    if (!asset.image_url) add('warn', 'image', 'No product photo is on record: the banner is type on the brand colour.');
  } else if (asset.type === 'google_responsive_display') {
    const R = RESPONSIVE;
    for (const h of asset.short_headlines || []) if (String(h).length > R.short_headline.max) add('block', 'short_headlines', `A short headline is over ${R.short_headline.max} characters.`);
    if (!(asset.short_headlines || []).length) add('block', 'short_headlines', 'At least one short headline is required.');
    if (!asset.long_headline) add('block', 'long_headline', 'A long headline is required.');
    else if (String(asset.long_headline).length > R.long_headline.max) add('block', 'long_headline', `The long headline is over ${R.long_headline.max} characters.`);
    if (!(asset.descriptions || []).length) add('block', 'descriptions', 'At least one description is required.');
    for (const d of asset.descriptions || []) if (String(d).length > R.description.max) add('warn', 'descriptions', `A description is over ${R.description.max} characters (limit not confirmed on Google's page).`);
    if (String(asset.business_name || '').length > R.business_name.max) add('warn', 'business_name', `The business name is over ${R.business_name.max} characters (limit not confirmed on Google's page).`);
    if ([asset.long_headline].concat(asset.short_headlines || [], asset.descriptions || []).some(bad)) add('block', 'text', 'The ad carries a marker or an unfilled tag.');
    if (!asset.final_url) add('block', 'final_url', 'A display ad needs a page to open.');
    if (!(asset.images && asset.images.source)) add('warn', 'images', 'No product photo is on record for the landscape and square images.');
  }
  return out;
}

module.exports = { build, check, BANNER_SIZES, UPLOAD, RESPONSIVE, BAR_MAX };
