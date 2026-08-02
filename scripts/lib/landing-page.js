'use strict';

/**
 * landing-page.js — brand-compliant KNICKGASM landing page (flagship design system).
 * Longer than a mailer: utility bar, hero, benefit grid, product card, trust
 * badges, brand-proof stats, testimonial, FAQ, closing CTA, footer.
 * Hosted image URLs only. Callers must pre-scrub copy (sanitizeBrand).
 */
const { PAL, shippingLine } = require('./flagship-mailer.js');
const HF = "'Montserrat','Raleway',Georgia,serif";
const BF = "'Instrument Sans','Helvetica Neue',Arial,sans-serif";
const FONT =
  '@font-face{font-family:"Montserrat";src:url("https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w0aXp-p7K4KLjztg.woff2") format("woff2");}' +
  '@font-face{font-family:"Instrument Sans";src:url("https://fonts.gstatic.com/s/instrumentsans/v4/pximypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr-yp2JGEJOH9npSTF-Tf8kywN2u7ZWwUbNA.woff2") format("woff2");}';

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/**
 * opts: { title, subject, productName, tastingLine, price, ctaText, ctaUrl,
 *   heroImageUrl, logoUrl, headline, subline, bodyBlocks:[{heading,body}],
 *   faq:[{q,a}], testimonial:{quote,who} }
 */
function renderLandingPage(o = {}) {
  const logo = o.logoUrl || 'https://www.knickgasm.com/cdn/shop/files/logo-website_3.png?v=1754032931&width=310';
  const benefits = (o.bodyBlocks || []).map((b) => `
      <div style="flex:1 1 240px;background:#fff;border:1px solid ${PAL.lava}33;border-radius:12px;padding:22px 20px;">
        <div style="font-family:${HF};font-size:19px;color:${PAL.green};margin:0 0 8px;">${esc(b.heading)}</div>
        <div style="font-family:${BF};font-size:15px;line-height:1.65;color:${PAL.ink};">${esc(b.body)}</div>
      </div>`).join('');
  const faq = (o.faq && o.faq.length) ? `
    <section style="max-width:760px;margin:0 auto;padding:10px 22px 40px;">
      <h2 style="font-family:${HF};color:${PAL.green};font-size:26px;text-align:center;margin:0 0 18px;">Questions, answered</h2>
      ${o.faq.map((f) => `<div style="border-bottom:1px solid ${PAL.lava}33;padding:14px 0;">
        <div style="font-family:${BF};font-weight:700;color:${PAL.ink};font-size:15px;margin-bottom:5px;">${esc(f.q)}</div>
        <div style="font-family:${BF};color:#4a4235;font-size:14.5px;line-height:1.6;">${esc(f.a)}</div></div>`).join('')}
    </section>` : '';
  const testimonial = o.testimonial ? `
    <section style="background:${PAL.green};padding:40px 22px;text-align:center;">
      <div style="max-width:720px;margin:0 auto;font-family:${HF};font-size:24px;line-height:1.4;color:${PAL.chalk};font-style:italic;">&ldquo;${esc(o.testimonial.quote)}&rdquo;</div>
      <div style="font-family:${BF};font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${PAL.lava};margin-top:14px;font-weight:700;">${esc(o.testimonial.who)}</div>
    </section>` : '';
  const heroImg = o.heroImageUrl ? `<img src="${esc(o.heroImageUrl)}" alt="${esc(o.productName)}" style="display:block;width:100%;max-width:420px;height:auto;margin:22px auto 0;border-radius:14px;">` : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title || o.productName)}</title>
<style>${FONT}
  *{box-sizing:border-box;} body{margin:0;background:${PAL.chalk};color:${PAL.ink};font-family:${BF};-webkit-font-smoothing:antialiased;}
  a{color:inherit;} img{max-width:100%;}
  .cta{display:inline-block;background:${PAL.green};color:${PAL.chalk};font-family:${BF};font-weight:700;letter-spacing:.03em;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:16px;}
  .cta.lava{background:${PAL.lava};color:${PAL.ink};}
  .util{background:${PAL.green};color:${PAL.chalk};text-align:center;font-size:12px;font-weight:700;letter-spacing:.08em;padding:11px 16px;}
  .badges{text-align:center;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${PAL.lava};padding:16px;}
  .stats{text-align:center;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${PAL.ink};padding:0 16px 22px;}
</style></head><body>
  <div class="util">From the hands that picked it to the pair you hold &nbsp;·&nbsp; ${o.shippingNote || shippingLine(o.market)}</div>
  <div style="text-align:center;padding:22px 0 4px;"><img src="${esc(logo)}" alt="KNICKGASM" width="150" style="width:150px;height:auto;"></div>
  <section style="background:${PAL.green};color:${PAL.chalk};padding:44px 22px;text-align:center;">
    <div style="font-family:${BF};font-size:11px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:${PAL.lava};">${esc(o.headline || 'Single-studio, hand-painted')}</div>
    <h1 style="font-family:${HF};font-size:44px;line-height:1.08;margin:14px 0 12px;color:${PAL.chalk};">${esc(o.productName)}</h1>
    ${o.tastingLine ? `<div style="font-family:${BF};font-style:italic;font-size:18px;color:${PAL.chalk};opacity:.92;margin:0 0 8px;">${esc(o.tastingLine)}</div>` : ''}
    ${o.subline ? `<div style="font-family:${BF};font-size:16px;line-height:1.6;max-width:620px;margin:0 auto 18px;color:${PAL.chalk};">${esc(o.subline)}</div>` : ''}
    ${o.price ? `<div style="margin:0 0 18px;"><span style="display:inline-block;border:1px solid ${PAL.lava};color:${PAL.lava};border-radius:999px;padding:8px 18px;font-weight:700;">${esc(o.price)}</span></div>` : ''}
    <a class="cta lava" href="${esc(o.ctaUrl)}">${esc(o.ctaText || 'Shop now')}</a>
    ${heroImg}
  </section>
  <section style="max-width:920px;margin:0 auto;padding:36px 22px 10px;">
    <div style="display:flex;gap:16px;flex-wrap:wrap;">${benefits}</div>
  </section>
  <div class="badges">Climate Neutral &nbsp;·&nbsp; Non-GMO Verified &nbsp;·&nbsp; Plastic Neutral</div>
  <div class="stats">Rated 4.9/5 · Judge.me verified reviews &nbsp;·&nbsp; 6 million customers &nbsp;·&nbsp; Worn by Samay Raina & Rohit Sharma</div>
  ${testimonial}
  ${faq}
  <section style="text-align:center;padding:40px 22px;background:${PAL.chalk};">
    <a class="cta" href="${esc(o.ctaUrl)}">${esc(o.ctaText || 'Shop now')}</a>
    ${o.collectionCta ? `<div style="margin-top:16px;"><a href="${esc(o.collectionCta.url)}" style="font-family:${BF};font-size:14px;font-weight:700;color:${PAL.green};text-decoration:underline;">Explore all ${esc(o.collectionCta.title)} →</a></div>` : ''}
  </section>
  <footer style="background:${PAL.green};color:${PAL.chalk};text-align:center;font-size:12px;line-height:1.8;padding:26px 20px;">KNICKGASM&reg; USA · Knickgasm Global Inc.<br>Registered mailing address here<br><span style="color:${PAL.lava};font-weight:700;">Privacy Policy &nbsp;·&nbsp; Terms of Service &nbsp;·&nbsp; Shipping &amp; Returns</span></footer>
</body></html>`;
}

module.exports = { renderLandingPage };
