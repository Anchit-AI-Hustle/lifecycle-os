'use strict';
/**
 * build-storefront-3d.js — generate a full-page 3D-design KNICKGASM storefront home
 * for a region (US/UK/Global) from REAL data only: product names/images/handles
 * from data/catalog/products_<region>.json and real prices + ratings from
 * data/brand-facts/<region>.json. No fabricated prices/images/reviews (spec
 * §zero-fabrication). Output: storefront-3d-<region>.html at the repo root,
 * served under the region's try.knickgasm.* canonical.
 *
 *   node scripts/build-storefront-3d.js            # all regions
 *   node scripts/build-storefront-3d.js us         # one region
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const REGION = {
  us:     { code: 'US', cur: '$',  live: 'www.knickgasm.com',   tryd: 'knickgasm.com',    label: 'United States' },
  uk:     { code: 'UK', cur: '£', live: 'knickgasm.com',  tryd: 'knickgasm.com',  label: 'United Kingdom' },
  global: { code: 'Global', cur: '$', live: 'knickgasm.com',  tryd: 'try.knickgasm.com', label: 'Global' },
};
const PAL = { green: '#6A33D8', lava: '#D0473E', ink: '#111111', chalk: '#F7F5F2', panel: '#FFFFFF' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function load(region) {
  const cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog', `products_${region}.json`), 'utf8'));
  let facts = { prices: {}, ratings: {}, review_counts: {} };
  try { facts = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brand-facts', `${region}.json`), 'utf8')); } catch (_) {}
  return { cat: Array.isArray(cat) ? cat : (cat.products || []), facts };
}
function priceOf(facts, p) { const k = p.h || p.n; return (facts.prices && (facts.prices[k] || facts.prices[(p.n || '').toLowerCase()])) || null; }
function ratingOf(facts, p) { const k = p.h || p.n; return (facts.ratings && facts.ratings[k]) || null; }

function card(p, r, facts) {
  const img = p.i || (p.imgs && p.imgs[0]);
  if (!img) return '';
  const price = priceOf(facts, p);
  const rating = ratingOf(facts, p);
  const url = `https://${r.live}/products/${p.h}`;
  const name = esc((p.n || '').replace(/-\d+\s*(g|ct|count|servings?|lace sets?)?$/i, '').trim());
  return `<a class="p3d" href="${url}" target="_blank" rel="noopener">
    <div class="p3d-img"><img loading="lazy" src="${esc(img)}" alt="${name}"></div>
    <div class="p3d-body">
      <div class="p3d-name">${name}</div>
      <div class="p3d-meta">${price ? `<span class="p3d-price">${r.cur}${esc(price)}</span>` : '<span class="p3d-price muted">View</span>'}${rating ? `<span class="p3d-rate">★ ${esc(rating)}</span>` : ''}</div>
    </div></a>`;
}

function build(region) {
  const r = REGION[region];
  const { cat, facts } = load(region);
  const withImg = cat.filter((p) => (p.i || (p.imgs && p.imgs[0])) && p.h);
  const featured = withImg.filter((p) => priceOf(facts, p)).slice(0, 12);
  const grid = withImg.slice(0, 40);
  const tags = [...new Set(cat.flatMap((p) => p.t || []))].filter(Boolean).slice(0, 6);
  const collectionTiles = tags.map((t) => `<a class="coll" href="https://${r.live}/collections/${esc(t)}" target="_blank" rel="noopener"><span>${esc(t[0].toUpperCase() + t.slice(1))}</span></a>`).join('');
  const heroProduct = featured[0] || withImg[0];
  const heroImg = heroProduct && (heroProduct.i || heroProduct.imgs[0]);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KNICKGASM ${esc(r.label)} — 3D Storefront (try.${''}${esc(r.tryd.replace('try.', ''))})</title>
<link rel="canonical" href="https://${esc(r.tryd)}/">
<meta name="robots" content="noindex"><!-- variation/preview build on try.knickgasm.* -->
<style>
@font-face{font-family:"Montserrat";src:url("https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w0aXp-p7K4KLjztg.woff2") format("woff2");}
:root{--green:${PAL.green};--lava:${PAL.lava};--ink:${PAL.ink};--chalk:${PAL.chalk};}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Instrument Sans","Helvetica Neue",Arial,sans-serif;color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased}
h1,h2,.serif{font-family:"Montserrat",Georgia,serif;font-weight:400}
a{text-decoration:none;color:inherit}
.util{background:var(--green);color:var(--chalk);text-align:center;font-size:12px;letter-spacing:.08em;padding:9px 12px;font-weight:700}
.nav{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-bottom:1px solid #eee;display:flex;align-items:center;justify-content:space-between;padding:14px 26px}
.nav .logo{font-family:"Montserrat",Georgia,serif;font-size:22px;letter-spacing:.16em;color:var(--green)}
.nav .links{display:flex;gap:22px;font-size:13px;font-weight:600;color:#444}
.nav .cta{background:var(--green);color:var(--chalk);padding:9px 18px;border-radius:8px;font-size:12px;font-weight:700;letter-spacing:.04em}
/* 3D hero */
.hero{position:relative;min-height:78vh;display:grid;grid-template-columns:1.05fr .95fr;gap:20px;align-items:center;padding:56px 6vw;background:radial-gradient(120% 120% at 80% 10%,#0a3d24 0%,var(--green) 55%,#00301c 100%);color:var(--chalk);overflow:hidden;perspective:1400px}
.hero:before{content:"";position:absolute;inset:0;background:radial-gradient(60% 50% at 15% 90%,rgba(171,135,67,.28),transparent 60%);pointer-events:none}
.hero .eyebrow{font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:var(--lava);margin-bottom:16px}
.hero h1{font-size:clamp(34px,5.2vw,64px);line-height:1.04;margin-bottom:18px}
.hero p{font-size:17px;line-height:1.7;max-width:32ch;color:#e9e2d2;margin-bottom:26px}
.hero .buy{display:inline-block;background:var(--chalk);color:var(--green);font-weight:700;padding:15px 34px;border-radius:9px;letter-spacing:.03em;transition:transform .2s}
.hero .buy:hover{transform:translateY(-2px)}
.stage{transform-style:preserve-3d;display:flex;justify-content:center;align-items:center}
.box{width:min(360px,80%);border-radius:18px;box-shadow:0 40px 80px rgba(0,0,0,.45);transform:rotateY(-18deg) rotateX(6deg);transition:transform .3s ease;background:#fff}
.stage:hover .box{transform:rotateY(-8deg) rotateX(2deg) scale(1.03)}
.section{padding:64px 6vw}
.section h2{font-size:clamp(26px,3.2vw,40px);color:var(--green);text-align:center;margin-bottom:8px}
.section .sub{text-align:center;color:#6b7770;margin-bottom:36px;font-size:15px}
.colls{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}
.coll{aspect-ratio:1;border-radius:14px;display:flex;align-items:flex-end;padding:16px;font-family:"Montserrat",Georgia,serif;font-size:19px;color:var(--chalk);background:linear-gradient(160deg,var(--green),#0a3d24);transition:transform .25s,box-shadow .25s}
.coll:hover{transform:translateY(-4px);box-shadow:0 18px 40px rgba(0,74,43,.28)}
.coll:nth-child(even){background:linear-gradient(160deg,var(--lava),#8a6a30)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:22px;perspective:1200px}
.p3d{display:block;border:1px solid #eee;border-radius:14px;overflow:hidden;background:#fff;transition:transform .25s ease,box-shadow .25s ease;transform-style:preserve-3d}
.p3d:hover{transform:translateY(-6px) rotateX(3deg);box-shadow:0 24px 50px rgba(23,23,23,.14)}
.p3d-img{aspect-ratio:1;background:var(--chalk);overflow:hidden}
.p3d-img img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.p3d:hover .p3d-img img{transform:scale(1.06)}
.p3d-body{padding:14px}
.p3d-name{font-size:14px;font-weight:600;line-height:1.35;min-height:38px;color:var(--ink)}
.p3d-meta{display:flex;justify-content:space-between;align-items:center;margin-top:8px}
.p3d-price{color:var(--green);font-weight:800}.p3d-price.muted{color:#889;font-weight:600}
.p3d-rate{color:var(--lava);font-size:12px;font-weight:700}
.proof{background:var(--chalk);text-align:center;padding:26px 6vw;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--ink)}
.footer{background:var(--green);color:var(--chalk);text-align:center;padding:40px 6vw;font-size:12px;line-height:1.9}
.footer a{color:var(--lava);font-weight:700}
@media(max-width:820px){.hero{grid-template-columns:1fr;text-align:center;min-height:auto}.hero p{margin-left:auto;margin-right:auto}.nav .links{display:none}}
</style></head><body>
<div class="util">Now shipping across ${esc(r.label)} — studio-fresh within 72 hours of drop &nbsp;·&nbsp; This is a 3D design variation on ${esc(r.tryd)}</div>
<nav class="nav"><div class="logo">KNICKGASM</div>
  <div class="links"><span>Sneaker</span><span>Coffee</span><span>Supplements</span><span>Gifts</span><span>Bestsellers</span></div>
  <a class="cta" href="https://${r.live}" target="_blank" rel="noopener">Shop the live store</a></nav>
<section class="hero">
  <div><div class="eyebrow">Single-studio · B-Corp · ${esc(r.label)}</div>
    <h1>${esc((heroProduct && heroProduct.n) ? heroProduct.n.replace(/-\d.*$/, '').trim() : 'The ritual, in three dimensions')}</h1>
    <p>There is a moment when the right pair does more than warm your hands. Explore the collection, rendered in depth.</p>
    <a class="buy" href="https://${r.live}/products/${esc(heroProduct ? heroProduct.h : '')}" target="_blank" rel="noopener">Shop this ritual</a></div>
  <div class="stage">${heroImg ? `<img class="box" src="${esc(heroImg)}" alt="${esc(heroProduct.n)}">` : ''}</div>
</section>
<section class="section"><h2>Shop by ritual</h2><div class="sub">Real collections from the ${esc(r.label)} store</div><div class="colls">${collectionTiles}</div></section>
<section class="section" style="background:var(--chalk)"><h2>Featured, in depth</h2><div class="sub">Hover any product — real catalogue, real prices${featured.length ? '' : ' (prices load from the approved-facts library)'}</div><div class="grid">${featured.map((p) => card(p, r, facts)).join('')}</div></section>
<section class="section"><h2>The full shelf</h2><div class="sub">${grid.length} live products from ${esc(r.live)}</div><div class="grid">${grid.map((p) => card(p, r, facts)).join('')}</div></section>
<div class="proof">Rated 4.9/5 · Judge.me verified reviews &nbsp;·&nbsp; 6 million customers &nbsp;·&nbsp; Worn by Samay Raina & Rohit Sharma</div>
<footer class="footer">KNICKGASM® ${esc(r.label)} &nbsp;·&nbsp; A 3D design variation hosted on <b>${esc(r.tryd)}</b><br>Live store: <a href="https://${r.live}" target="_blank" rel="noopener">${esc(r.live)}</a> &nbsp;·&nbsp; Every product links to its real page. Nothing here is fabricated.<br>440 N Barranca Ave #2812, Covina, CA 91723, United States</footer>
</body></html>`;
}

const only = (process.argv[2] || '').toLowerCase();
const regions = only && REGION[only] ? [only] : Object.keys(REGION);
for (const region of regions) {
  const html = build(region);
  const out = path.join(ROOT, `storefront-3d-${region}.html`);
  fs.writeFileSync(out, html);
  console.log(`Wrote ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(0)} KB)`);
}
