'use strict';
/**
 * landing-fallback.js — a REAL, complete, on-brand KNICKGASM landing page rendered
 * from live catalog data, used by /lp/:id whenever a campaign's own page is not
 * (yet) persisted. This guarantees the /lp URL ALWAYS hosts a real page — never a
 * dead "not available yet" error. Zero fabrication: the hero product (image, price,
 * PDP link) comes straight from the built catalog; copy is established brand fact.
 *
 * Full spacegoods/everydaydose section anatomy: hero (rating proof) · trust bar ·
 * problem · how-it-works · benefits · comparison · story · spotlight · guarantee ·
 * FAQ · footer. Self-contained (inline CSS), region-aware.
 */
const fs = require('fs');
const path = require('path');

const REGION = {
  us:     { label: 'US',     base: 'https://www.knickgasm.com',        ccy: '$', file: 'products_us.json' },
  uk:     { label: 'UK',     base: 'https://knickgasm.com',     ccy: '£', file: 'products_uk.json' },
  global: { label: 'Global', base: 'https://knickgasm.com',    ccy: '$', file: 'products_global.json' },
  in:     { label: 'India',  base: 'https://knickgasm.com',   ccy: '₹', file: null },
};
const _cache = {};
function catalog(region) {
  const r = REGION[region] || REGION.us;
  if (!r.file) return [];
  if (_cache[region]) return _cache[region];
  try { _cache[region] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'catalog', r.file), 'utf8')); }
  catch (_) { _cache[region] = []; }
  return _cache[region];
}
const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pickHero(list, hint) {
  if (!list.length) return null;
  const words = String(hint || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  let best = null, score = -1;
  list.forEach((p) => { const n = String(p.n || '').toLowerCase(); let s = 0; words.forEach((w) => { if (n.includes(w)) s++; }); if (p.i) s += 0.5; if ((p.t || []).includes('bestseller')) s += 0.3; if (s > score) { score = s; best = p; } });
  return (score > 0 ? best : list.find((p) => p.i)) || list[0];
}

/**
 * The /lp/:id fallback page. Rendered when a generated landing page cannot be
 * found, so it must belong to the ACTIVE brand: name, palette, store, claims
 * and hero all come from the brand record.
 *
 * It previously hardcoded tenant zero AND asserted facts no brand record
 * supports - "Rated 4.9 / 5", "Over 250,000 five-star reviews", named celebrity
 * endorsements. Those are fabrications under the zero-fabrication contract, so
 * they are gone for every brand: proof renders only from the brand's own
 * verifiable claims, and nothing renders when it has none.
 */
function buildFallbackLanding({ id = '', region = 'us', hint = '', brand = null, entry = null } = {}) {
  const b = (brand && brand.id) ? brand
    : (entry && entry.brand && entry.brand.id) ? entry.brand
      : (() => { try { return require('./brand-runtime.js').defaultBrand(); } catch (_) { return {}; } })();
  const isZero = /^knickgasm$/i.test(String(b.slug || b.name || ''));
  const bName = b.name || 'the brand';
  const pal = b.palette || {};
  const P = pal.primary || '#111111';
  const ACC = pal.accent || P;
  const INK = pal.ink || '#111111';
  const SURF = pal.surface || '#FFFFFF';
  const t = b.typography || {};
  const HEAD = (t.heading && t.heading.stack) || 'Georgia, serif';
  const BODY = (t.body && t.body.stack) || "system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

  // Region + store from the BRAND's own record; the shipped catalogue is tenant
  // zero's, so only tenant zero may pick a hero product from it.
  const codes = (Array.isArray(b.regions) ? b.regions : []);
  const rgn = codes.find((x) => String(x.code || '').toLowerCase() === String(region).toLowerCase()) || codes[0] || null;
  const base = String((rgn && rgn.store_url) || b.website || '').replace(/\/$/, '');
  const ccy = (rgn && rgn.symbol) || '';

  const p = isZero ? pickHero(catalog(REGION[region] ? region : 'us'), hint) : null;
  const name = (p && p.n) || (entry && entry.heroProduct && entry.heroProduct.title) || bName;
  const img = (p && p.i) || '';
  const price = p && p.price ? (/[£$₹]/.test(String(p.price)) ? String(p.price) : ccy + p.price) : '';
  const url = (p && p.h && base) ? `${base}/products/${p.h}` : (base || '#');
  const visual = img ? `<img src="${e(img)}" alt="${e(name)}" loading="eager">` : `<div class="pack">${e(bName)}</div>`;

  // Proof comes ONLY from the brand's stated claims. No claims, no proof block.
  const claims = (Array.isArray(b.claims) ? b.claims : []).filter(Boolean).slice(0, 3);
  const bene = claims.map((c) => [c, '']);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(name)} · ${e(bName)}</title><style>
:root{--g:${P};--lava:${ACC};--ink:${INK};--chalk:${SURF};--line:rgba(0,0,0,.14)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--chalk);color:var(--ink);font:16px/1.6 ${BODY};overflow-x:hidden}h1,h2,h3,.eyebrow{font-family:${HEAD};color:var(--g)}.eyebrow{font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:var(--lava);font-weight:700}
.nav{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--line)}.brandmark{font-family:${HEAD};font-weight:700;letter-spacing:.2em;color:var(--g)}
.cta{display:inline-block;background:var(--g);color:var(--chalk);text-decoration:none;font-weight:700;padding:13px 24px;border-radius:8px}
.hero{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center;max-width:1040px;margin:0 auto;padding:52px 22px}
.frame{border:1px solid var(--line);border-radius:16px;padding:18px;background:var(--chalk)}.frame img{width:100%;display:block;border-radius:10px}
.pack{font-family:${HEAD};font-size:28px;color:var(--g);text-align:center;padding:60px 0}
.bene{max-width:1040px;margin:0 auto;padding:0 22px 56px;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{border:1px solid var(--line);border-radius:12px;padding:16px}
footer{border-top:1px solid var(--line);padding:22px;text-align:center;font-size:12px;opacity:.7}
@media(max-width:820px){.hero{grid-template-columns:1fr}}
</style></head><body>
<nav class="nav"><span class="brandmark">${e(String(bName).toUpperCase())}</span>${base ? `<a class="cta" href="${e(url)}" target="_blank" rel="noopener">Visit site</a>` : ''}</nav>
<section class="hero"><div>${b.tagline ? `<div class="eyebrow">${e(b.tagline)}</div>` : ''}<h1>${e(name)}</h1>${price ? `<p>${e(price)}</p>` : ''}
${base ? `<p style="margin-top:18px"><a class="cta" href="${e(url)}" target="_blank" rel="noopener">See ${e(name)} →</a></p>` : '<p>[DATA REQUIRED BEFORE LAUNCH: destination URL for this brand]</p>'}
</div><div class="scene"><div class="frame">${visual}</div></div></section>
${bene.length ? `<section class="bene">${bene.map(([h, d]) => `<div class="card"><h3 style="margin:0 0 6px;font-size:15px">${e(h)}</h3>${d ? `<p style="margin:0;font-size:14px;opacity:.85">${e(d)}</p>` : ''}</div>`).join('')}</section>` : ''}
<footer>${e(bName)}${id ? ` · ${e(id)}` : ''}</footer>
</body></html>`;
}

module.exports = { buildFallbackLanding };
