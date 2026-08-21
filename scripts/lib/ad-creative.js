'use strict';

/**
 * ad-creative.js — KNICKGASM paid-social ad creatives (composed units, not
 * image+text side by side). Each platform renders as a real ad: the hero fills
 * the frame at the platform aspect ratio, a brand scrim keeps copy legible, and
 * the wordmark + headline + price + CTA are composed ON the creative.
 * Flagship palette, hosted image URLs only, no invented codes. Callers pre-scrub
 * copy (sanitizeBrand).
 */
const { PAL, shippingLine } = require('./flagship-mailer.js');
// Plain-text (no-entity) shipping line for ad copy fields, region-correct.
function shipText(market) { return String(shippingLine(market)).replace(/&pound;/g, '£'); }
const HF = "'Montserrat','Raleway',Georgia,serif";
const BF = "'Instrument Sans','Helvetica Neue',Arial,sans-serif";
const FONT =
  '@font-face{font-family:"Montserrat";src:url("https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w0aXp-p7K4KLjztg.woff2") format("woff2");}' +
  '@font-face{font-family:"Instrument Sans";src:url("https://fonts.gstatic.com/s/instrumentsans/v4/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH9npSTF-Tf8kywN2u7ZWwUbNA.woff2") format("woff2");}';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function clamp(s, n) { s = String(s || ''); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; }

/* Limits come from asset-specs.js, which is the single source for them. They
   used to be re-typed here as 125/40/30 and 30/90, so the spec and the thing
   that actually shipped could drift apart with nothing to notice.

   The empty-field fallbacks used to be tenant zero's own copy ("Single-studio,
   hand-painted at origin", "One-of-One, Hand-Painted"). Those rendered into ANY
   brand's ad whenever a field came through empty, which is another company's
   product claim under this operator's name. A missing line is now MISSING, and
   says so, because an ad that quietly asserts something nobody approved is
   worse than one with a visible gap. */
const SPECS = require('../../api/_shared/asset-specs.js');
const META_COPY = SPECS.ADS.meta.copy;
const GOOGLE_HEADLINE = 30;    // enforced in google-ads-adapter.js
const GOOGLE_DESC = 90;        // enforced in google-ads-adapter.js

function adCopy(o) {
  const p = o.productName, price = o.price ? ` (${o.price})` : '';
  const gap = (field) => `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${o.brandName || 'this brand'}, ${o.market || 'all'}]`;
  const support = o.tastingLine || o.supportLine || '';
  return {
    meta: {
      platform: 'Meta (Instagram/Facebook) · 1:1',
      primary_text: clamp(`${o.headline}. ${o.subline}`, META_COPY.primaryText),
      headline: clamp(p, META_COPY.headline),
      description: support ? clamp(support, META_COPY.description) : gap('ad description'),
      cta: 'Shop Now',
    },
    tiktok: {
      platform: 'TikTok / Reels · 9:16',
      primary_text: clamp(`${o.headline}${price}`, 100),
      hook: clamp(o.subline, 60),
      cta: 'Shop Now',
    },
    google: {
      platform: 'Google · Responsive Search',
      headlines: [clamp(p, GOOGLE_HEADLINE), clamp(o.headline, GOOGLE_HEADLINE)].filter(Boolean),
      descriptions: [
        clamp(o.subline, GOOGLE_DESC),
        support ? clamp(`${support}. ${shipText(o.market)}.`, GOOGLE_DESC) : clamp(shipText(o.market), GOOGLE_DESC),
      ].filter(Boolean),
      cta: 'Shop',
    },
  };
}

// A composed creative: hero fills the frame; a bottom scrim carries the copy.
// `ar` is the CSS aspect-ratio; `w` the render width.
function composed(o, { w, ar, wordmarkTop, headline, sub, showPrice, ctaLabel, handle }) {
  const bg = o.heroImageUrl
    ? `background-image:linear-gradient(to bottom,rgba(0,74,43,0) 38%,rgba(0,74,43,.55) 66%,rgba(23,23,23,.86) 100%),url('${esc(o.heroImageUrl)}');background-size:cover;background-position:center;`
    : `background:${PAL.green};`;
  const price = (showPrice && o.price) ? `<span style="display:inline-block;background:${PAL.lava};color:${PAL.chalk};font-family:${BF};font-weight:700;font-size:13px;padding:5px 12px;border-radius:999px;margin-right:8px;">${esc(o.price)}</span>` : '';
  return `<div style="width:${w}px;max-width:100%;aspect-ratio:${ar};${bg}border-radius:14px;overflow:hidden;position:relative;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 6px 20px rgba(23,23,23,.14);">
    <div style="padding:16px 18px;display:flex;align-items:center;gap:8px;">
      <span style="font-family:${HF};letter-spacing:.28em;font-weight:700;color:${PAL.chalk};font-size:15px;text-shadow:0 1px 6px rgba(0,0,0,.4);">KNICKGASM</span>
      ${wordmarkTop ? `<span style="font-family:${BF};font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:${PAL.lava};text-shadow:0 1px 4px rgba(0,0,0,.5);">${esc(wordmarkTop)}</span>` : ''}
    </div>
    <div style="padding:0 18px 18px;">
      <div style="font-family:${HF};color:${PAL.chalk};font-size:24px;line-height:1.12;margin-bottom:8px;text-shadow:0 1px 8px rgba(0,0,0,.5);">${esc(headline)}</div>
      ${sub ? `<div style="font-family:${BF};color:${PAL.chalk};font-size:13px;line-height:1.45;opacity:.94;margin-bottom:12px;text-shadow:0 1px 6px rgba(0,0,0,.5);">${esc(sub)}</div>` : ''}
      <div style="display:flex;align-items:center;">${price}<span style="display:inline-block;background:${PAL.chalk};color:${PAL.green};font-family:${BF};font-weight:700;font-size:13px;letter-spacing:.03em;padding:10px 20px;border-radius:8px;">${esc(ctaLabel)}</span></div>
      ${handle ? `<div style="font-family:${BF};font-size:11px;color:${PAL.chalk};opacity:.8;margin-top:10px;">${esc(handle)}</div>` : ''}
    </div>
  </div>`;
}

function renderAds(o = {}) {
  const c = adCopy(o);
  const meta = composed(o, { w: 340, ar: '1 / 1', wordmarkTop: 'Sponsored', headline: o.headline, sub: o.tastingLine, showPrice: true, ctaLabel: c.meta.cta });
  const tiktok = composed(o, { w: 250, ar: '9 / 16', wordmarkTop: null, headline: o.subline, sub: null, showPrice: true, ctaLabel: c.tiktok.cta, handle: '@knickgasm' });
  const google = `<div style="width:340px;max-width:100%;background:#fff;border:1px solid ${PAL.lava}33;border-radius:12px;padding:16px;">
    <div style="font-size:11px;color:#0a7d33;font-weight:700;">Ad · knickgasm.com</div>
    <div style="color:#1a0dab;font-size:18px;line-height:1.3;margin:6px 0;font-family:${BF};">${esc(c.google.headlines.join(' | '))}</div>
    <div style="color:#4d5156;font-size:13px;line-height:1.5;">${esc(c.google.descriptions.join(' '))}</div></div>`;

  const copyBlock = `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:#fff;border:1px solid ${PAL.lava}33;border-radius:10px;padding:16px;color:${PAL.ink};overflow:auto;">${esc(JSON.stringify(c, null, 2))}</pre>`;

  return {
    copy: c,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ads · ${esc(o.productName)}</title>
<style>${FONT} body{margin:0;background:${PAL.chalk};color:${PAL.ink};font-family:${BF};padding:22px;} h1,h2{font-family:${HF};color:${PAL.green};}</style></head><body>
  <h1 style="font-size:24px;margin:0 0 4px;">Paid-social ads · ${esc(o.productName)}</h1>
  <div style="color:#7a6e5a;font-size:13px;margin-bottom:20px;">Composed creatives (copy on the image). CTA to ${esc(o.ctaUrl)}. Preview only; no platform push. No discount codes fabricated.</div>
  <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start;">
    <div><h2 style="font-size:15px;">Meta · 1:1</h2>${meta}</div>
    <div><h2 style="font-size:15px;">TikTok / Reels · 9:16</h2>${tiktok}</div>
    <div><h2 style="font-size:15px;">Google · RSA</h2>${google}</div>
  </div>
  <h2 style="font-size:15px;margin:26px 0 8px;">Copy (structured)</h2>
  ${copyBlock}
</body></html>`,
  };
}

module.exports = { renderAds };
