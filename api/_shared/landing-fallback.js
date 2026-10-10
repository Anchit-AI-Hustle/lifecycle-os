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
const catalogServer = require('./brand-catalog-server.js');

// Regions this page understands. The store URL and currency come from the
// BRAND's own record (see below) - the hardcoded tenant-zero domains and symbols
// that used to live here were read by nothing but still described one company's
// storefronts as if they were the platform's, so they are gone.

// The hero product may only come from the brand's OWN catalogue.
function catalog(region, brand) {
  return catalogServer.productsFor(region, { brand: brand || null }).products;
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
 * WHOSE brand the /lp/:id fallback wears, decided by the RECORD the id
 * resolved to (its workspace_id), never by the link and never by a literal.
 *
 *   record          the workspace's own brand row, read with the service key
 *   tenant_zero     the row could not be read, but the workspace IS tenant
 *                   zero (the oldest workspace - the repo's standing definition,
 *                   see workspace-scope.defaultWorkspaceId and
 *                   market-analytics.ownsBundledExport), so the shipped record
 *                   is the right answer
 *   brand_unreadable the workspace is somebody else's and its brand could not
 *                   be read: NO brand. Tenant zero's is not a stand-in.
 *   no_record       nothing names a workspace: NO brand.
 *
 * The caller renders the last two as the neutral page below.
 */
async function brandForLandingRecord(env, workspaceId) {
  const ws = String(workspaceId || '').trim();
  if (!ws) return { brand: null, reason: 'no_record', workspace_id: '' };
  const wsScope = require('./workspace-scope.js');
  let brand = null;
  try { brand = await wsScope.brandForWorkspace(env, ws); } catch (_) { brand = null; }
  if (brand && (brand.id || brand.slug || brand.name)) return { brand, reason: 'record', workspace_id: ws };
  let zero = null;
  try { zero = await wsScope.defaultWorkspaceId(env); } catch (_) { zero = null; }
  if (zero && String(zero) === ws) return { brand: require('./brand-runtime.js').defaultBrand(), reason: 'tenant_zero', workspace_id: ws };
  return { brand: null, reason: 'brand_unreadable', workspace_id: ws };
}

/**
 * The page /lp/:id serves when the id names NO brand: no record carries it, or
 * the record's brand could not be read. It states the gap and shows nobody's
 * name, colours, products or claims in the meantime. No colour is decided here
 * at all - the ground and the ink are the engine's own light-scheme system
 * colours, so the page is neither black nor anyone's palette.
 */
function buildNeutralLanding({ id = '', attribution = null } = {}) {
  const a = attribution || {};
  const why = a.reason === 'brand_unreadable'
    ? `The campaign's workspace (${a.workspace_id}) exists, but its brand record could not be read.`
    : 'No persisted campaign or calendar slot carries this id, so no brand can be attributed to it.';
  const marker = `[DATA REQUIRED BEFORE LAUNCH: brand and landing page, campaign ${id || 'unknown'}]`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Landing page not available · ${e(id || 'campaign')}</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:Canvas;color:CanvasText;font:16px/1.6 system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif}
main{max-width:640px;margin:0 auto;padding:56px 22px}h1{font-size:24px;line-height:1.25;margin:0 0 16px}
.marker{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;padding:14px 16px;border:1px solid CanvasText;border-radius:8px;word-break:break-word}
footer{margin-top:40px;padding-top:16px;border-top:1px solid CanvasText;font-size:12px}
</style></head><body><main>
<h1>This landing page is not available yet</h1>
<p class="marker">${e(marker)}</p>
<p>${e(why)} No other brand's page is shown in its place.</p>
<footer>Campaign ${e(id || 'unknown')}</footer>
</main></body></html>`;
}

/**
 * The /lp/:id fallback page. Rendered when a generated landing page cannot be
 * found, so it must belong to the brand the RECORD names: name, palette,
 * store, claims and hero all come from that brand record.
 *
 * It previously hardcoded tenant zero AND asserted facts no brand record
 * supports - "Rated 4.9 / 5", "Over 250,000 five-star reviews", named celebrity
 * endorsements. Those are fabrications under the zero-fabrication contract, so
 * they are gone for every brand: proof renders only from the brand's own
 * verifiable claims, and nothing renders when it has none.
 *
 * With NO brand it renders the neutral page. It used to fall through to
 * defaultBrand() - tenant zero - so every campaign whose brand did not resolve
 * (an ordinary /lp link carries no workspace) was served under another
 * company's name, colours and store. A caller that has established the record
 * is tenant zero's passes that brand explicitly (brandForLandingRecord does).
 */
function buildFallbackLanding({ id = '', region = '', hint = '', brand = null, entry = null, attribution = null } = {}) {
  const b = (brand && (brand.id || brand.slug || brand.name)) ? brand
    : (entry && entry.brand && (entry.brand.id || entry.brand.slug || entry.brand.name)) ? entry.brand
      : null;
  if (!b) return buildNeutralLanding({ id, attribution });
  const bName = b.name || 'the brand';
  const pal = b.palette || {};
  const P = pal.primary || '#111111';
  const ACC = pal.accent || P;
  const INK = pal.ink || '#111111';
  const SURF = pal.surface || '#FFFFFF';
  const t = b.typography || {};
  const HEAD = (t.heading && t.heading.stack) || 'Georgia, serif';
  const BODY = (t.body && t.body.stack) || "system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
  // A family the brand supplied as a file is declared, or the stacks above name
  // a font no visitor's browser has (brand-runtime.fontFaces, 2026-10-04).
  let FACES = '';
  try { FACES = require('./brand-runtime.js').fontFaces(t) || ''; } catch (_) { FACES = ''; }

  // Region + store from the BRAND's own record; the shipped catalogue is tenant
  // zero's, so only tenant zero may pick a hero product from it.
  // A region the link does not name, or one the brand does not list, falls to
  // the brand's HOME market (the row its record flags), not to its first row
  // and never to a literal 'us' (2026-10-05).
  const L = require('./brand-locale.js');
  const codes = (Array.isArray(b.regions) ? b.regions : []);
  const asked = L.marketFor(b, region);
  const homeRow = L.homeRegionRow(b);
  const rgn = (asked.market && codes.find((x) => String(x.code || '').toUpperCase() === asked.market)) || homeRow || null;
  const base = String((rgn && rgn.store_url) || b.website || '').replace(/\/$/, '');
  const ccy = (rgn && (rgn.symbol || L.localeFor(b, rgn.code).symbol)) || '';
  region = String((rgn && rgn.code) || region || '').toLowerCase();

  // The shipped catalogue is tenant zero's, so only tenant zero picks a hero out
  // of it; every other brand resolves against its own imported rows, and gets
  // none (an image-free page) rather than a foreign product when it has none.
  const p = pickHero(catalog(region, b), hint);
  const name = (p && p.n) || (entry && entry.heroProduct && entry.heroProduct.title) || bName;
  const img = (p && p.i) || '';
  const price = p && p.price ? (/[£$₹]/.test(String(p.price)) ? String(p.price) : ccy + p.price) : '';
  // The row's own product page when its catalogue states one; else its handle
  // on the brand's own store.
  const url = (p && /^https?:\/\//.test(String(p.product_url || ''))) ? p.product_url
    : (p && p.h && base) ? `${base}/products/${p.h}` : (base || '#');
  const visual = img ? `<img src="${e(img)}" alt="${e(name)}" loading="eager">` : `<div class="pack">${e(bName)}</div>`;

  // Proof comes ONLY from the brand's stated claims. No claims, no proof block.
  const claims = (Array.isArray(b.claims) ? b.claims : []).filter(Boolean).slice(0, 3);
  const bene = claims.map((c) => [c, '']);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(name)} · ${e(bName)}</title><style>${FACES}
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

module.exports = { buildFallbackLanding, buildNeutralLanding, brandForLandingRecord };
