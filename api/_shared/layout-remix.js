'use strict';
/**
 * layout-remix.js - remix a competitor ad's LAYOUT into the brand's own static
 * (2026-11-02, a gap against usefastlane.ai).
 * ---------------------------------------------------------------------------
 * Fastlane lets a team take a competitor ad that keeps running and remake it
 * for their own brand. Here only the STRUCTURE is taken, and it is MEASURED,
 * never read off their words:
 *   where the product photograph sits, where the type sits and on what (a
 *   solid band, a side panel, the photo itself), whether a second solid panel
 *   sits under the first (an offer panel), and how much of the frame is type.
 * Their headline, copy, claims, offer, prices, photographs and colours are
 * never used: the remix is the brand's OWN static (scripts/lib/static-ad.js),
 * its own catalogue photo, its own words, its own theme (asset-themes.pick)
 * and palette, in the nearest template to the measured structure.
 *
 * HOW IT IS MEASURED. The competitor's image is fetched server-side by
 * code-video.fetchImage (public hosts only, every redirect hop checked, image
 * types only, capped) and decoded in the headless Chromium this function ships
 * (render-browser.js; the page loads nothing but that one image). The image is
 * drawn on a canvas and cut into a grid; each cell is a GROUND cell (one
 * colour covers >= 90% of it), a TEXT cell (two colours cover it: type on a
 * flat ground, with the antialiased steps between the two) or a PHOTO cell
 * (neither). `measureLayout()` reads the grid in
 * code: bands of ground across the frame, a half that is panel and a half that
 * is photo, a ring of ground around a photo, a small photo on a ground, or
 * type over the photograph. No model is asked; the same image is the same
 * answer. An image with no photo and no type found, or none at all, is said.
 *
 * Mounted on POST /api/public-config?action=video-render&op=remix-layout (the
 * function that carries Chromium; still 12/12). Signed in, a member of the
 * workspace (its brand record read through RLS as the caller), rate-limited
 * like the other Chromium reads. Nothing is written: the answer carries the
 * static's HTML and `remix_of`.
 * NOT a function file (api/_shared/ is outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const ORIGIN = 'https://render.invalid';
const COLS = 12;
const CELL = 24;

function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 200);

/** In the page: decode the image, cut it into cells, describe each cell. */
async function gridOf(page, cols, cell) {
  return page.evaluate(async ({ cols, cell }) => {
    const img = new Image();
    img.src = '/competitor-ad';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('the image could not be decoded')); });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('the image has no size');
    const rows = Math.max(4, Math.min(30, Math.round(cols * h / w)));
    const cw = cols * cell, ch = rows * cell;
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, cw, ch);
    const px = g.getImageData(0, 0, cw, ch).data;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const bins = new Map();
        for (let y = r * cell; y < (r + 1) * cell; y++) {
          for (let x = k * cell; x < (k + 1) * cell; x++) {
            const i = (y * cw + x) * 4;
            const key = (px[i] >> 5) * 64 + (px[i + 1] >> 5) * 8 + (px[i + 2] >> 5);
            const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
            b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2];
            bins.set(key, b);
          }
        }
        const top = [...bins.values()].sort((a, b) => b.n - a.n);
        const n = cell * cell;
        const hex = (b) => '#' + [b.r / b.n, b.g / b.n, b.b / b.n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
        // Type is two colours and the antialiased steps BETWEEN them: the share
        // of the cell's pixels lying on the line from its first colour to its
        // second. A photograph's pixels do not lie on one line.
        const c1 = [top[0].r / top[0].n, top[0].g / top[0].n, top[0].b / top[0].n];
        const t2 = top[1] || top[0];
        const c2 = [t2.r / t2.n, t2.g / t2.n, t2.b / t2.n];
        const dv = [c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]];
        const dd = dv[0] * dv[0] + dv[1] * dv[1] + dv[2] * dv[2] || 1;
        let onLine = 0;
        for (let y = r * cell; y < (r + 1) * cell; y++) {
          for (let x = k * cell; x < (k + 1) * cell; x++) {
            const i = (y * cw + x) * 4;
            const p = [px[i] - c1[0], px[i + 1] - c1[1], px[i + 2] - c1[2]];
            const t = Math.max(0, Math.min(1, (p[0] * dv[0] + p[1] * dv[1] + p[2] * dv[2]) / dd));
            const e = [p[0] - t * dv[0], p[1] - t * dv[1], p[2] - t * dv[2]];
            if (e[0] * e[0] + e[1] * e[1] + e[2] * e[2] <= 14 * 14) onLine++;
          }
        }
        cells.push({ d1: top[0].n / n, d2: (top[0].n + (top[1] ? top[1].n : 0)) / n, lin: onLine / n, mode: hex(top[0]) });
      }
    }
    return { width: w, height: h, cols, rows, cells };
  }, { cols, cell });
}

/** A cell's kind: ground (one colour), text (two colours), photo (neither). */
function kindOf(c) {
  if (c.d1 >= 0.9) return 'ground';
  if (c.d2 >= 0.72 || c.lin >= 0.9) return 'text';
  return 'photo';
}

function nearestRatio(w, h) {
  const RATIOS = require('../../scripts/lib/static-ad.js').RATIOS;
  const want = w / h;
  return ['1:1', '4:5', '9:16', '1.91:1'].reduce((best, r) => {
    const v = RATIOS[r][0] / RATIOS[r][1]; const b = RATIOS[best][0] / RATIOS[best][1];
    return Math.abs(Math.log(v / want)) < Math.abs(Math.log(b / want)) ? r : best;
  }, '1:1');
}

const third = (f) => (f < 0.34 ? 'start' : f > 0.66 ? 'end' : 'middle');
const vWord = (f) => ({ start: 'top', middle: 'middle', end: 'bottom' })[third(f)];
const hWord = (f) => ({ start: 'left', middle: 'centre', end: 'right' })[third(f)];
const near = (a, b) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 48;
};

/**
 * The structure of an ad from its grid. Pure: same grid, same answer.
 * Returns { measurable, template, seed, ratio, product_at, type_at, type_on,
 *   text_density, photo_share, offer_panel, why } or { measurable:false, why }.
 */
function measureLayout(grid) {
  const g = grid || {};
  const R = g.rows, C = g.cols;
  if (!R || !C || !Array.isArray(g.cells) || g.cells.length !== R * C) return { measurable: false, why: 'The image could not be read as a grid.' };
  const k = g.cells.map(kindOf);
  const at = (r, c) => k[r * C + c];
  const cellsOf = (pred) => { const o = []; for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (pred(at(r, c))) o.push([r, c]); return o; };
  const photo = cellsOf((x) => x === 'photo');
  const text = cellsOf((x) => x === 'text');
  const P = photo.length / (R * C);
  const T = text.length / (R * C);
  const ratio = nearestRatio(g.width, g.height);
  if (!photo.length && !text.length) return { measurable: false, ratio, why: 'The image is one flat colour: no photograph and no type were found to take a structure from.' };
  const centroid = (list) => list.reduce((a, [r, c]) => [a[0] + (r + 0.5) / R / list.length, a[1] + (c + 0.5) / C / list.length], [0, 0]);
  const pc = photo.length ? centroid(photo) : null;
  const tc = text.length ? centroid(text) : null;
  const rowPhoto = (r) => { let n = 0; for (let c = 0; c < C; c++) if (at(r, c) === 'photo') n++; return n / C; };
  const colPhoto = (c, r0, r1) => { let n = 0; for (let r = r0; r < r1; r++) if (at(r, c) === 'photo') n++; return n / Math.max(1, r1 - r0); };
  const hexDist = (a, b) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const x = p(a), y = p(b);
    return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
  };
  // A panel's ground is the colour at BOTH edges of a row: a button or a chip
  // inside the panel never reads as a second panel.
  const rowMode = (r) => {
    const a = g.cells[r * C], b = g.cells[r * C + C - 1];
    return at(r, 0) !== 'photo' && at(r, C - 1) !== 'photo' && near(a.mode, b.mode) ? a.mode : '';
  };
  const bbox = (list) => {
    if (!list.length) return null;
    const rs = list.map((x) => x[0]), cs = list.map((x) => x[1]);
    return { w: (Math.max(...cs) - Math.min(...cs) + 1) / C, h: (Math.max(...rs) - Math.min(...rs) + 1) / R };
  };
  const FLAT = 0.34;
  let top = 0; while (top < R && rowPhoto(top) <= FLAT) top++;
  let bot = 0; while (bot < R && rowPhoto(R - 1 - bot) <= FLAT) bot++;
  const base = { measurable: true, ratio, photo_share: +P.toFixed(2), text_density: +T.toFixed(2),
    product_at: pc ? `${vWord(pc[0])} ${hWord(pc[1])}` : 'none', type_at: tc ? `${vWord(tc[0])} ${hWord(tc[1])}` : 'none' };
  const out = (o) => Object.assign({}, base, { offer_panel: false }, o);

  if (P < 0.08) return out({ template: 'type', seed: 0, type_on: 'the ground', why: `A typographic ad: ${Math.round(P * 100)}% of the frame is photograph and the type stands on a solid ground.` });

  // A ring of ground around a photograph: framed. An edge cell counts when its
  // own colour is the frame's (a cell the photo's edge cuts through still is).
  const edge = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (r === 0 || c === 0 || r === R - 1 || c === C - 1) edge.push(g.cells[r * C + c].mode);
  const ringGround = edge.map((m) => [m, edge.filter((x) => near(x, m)).length]).sort((a, b) => b[1] - a[1])[0][0];
  const ring = edge.filter((m) => near(m, ringGround)).length / edge.length;
  const pb = bbox(photo);
  // One half panel, the other photograph: split.
  const half = Math.floor(C / 2);
  let leftP = 0, rightP = 0;
  for (let c = 0; c < half; c++) leftP += colPhoto(c, 0, R) / half;
  for (let c = C - half; c < C; c++) rightP += colPhoto(c, 0, R) / half;
  if ((leftP >= 0.55 && rightP <= 0.15) || (rightP >= 0.55 && leftP <= 0.15)) {
    const photoFirst = leftP > rightP;
    return out({ template: 'split', seed: photoFirst ? 0 : 1, type_on: 'a side panel', why: `A side-by-side ad: the ${photoFirst ? 'left' : 'right'} half is the photograph (${Math.round(Math.max(leftP, rightP) * 100)}% photo) and the ${photoFirst ? 'right' : 'left'} half is a solid panel carrying the type.` });
  }
  // A small photograph standing on a ground that carries the type.
  if (pb && pb.w <= 0.6 && pb.h <= 0.6 && P < 0.35) {
    return out({ template: 'type', seed: 0, type_on: 'the ground', why: `A typographic ad with a small photograph (${Math.round(P * 100)}% of the frame) at the ${base.product_at}.` });
  }
  if (ring >= 0.85 && top >= 1 && bot >= 1 && top + bot < R * 0.6 && P >= 0.2) {
    return out({ template: 'framed', seed: 0, type_on: 'the frame', why: `A framed ad: ${Math.round(ring * 100)}% of the edge is a solid ground around the photograph, with type above and below it.` });
  }
  const bandRows = Math.max(top, bot);
  if (bandRows >= Math.max(1, Math.round(R * 0.12))) {
    const atTop = top > bot;
    const bandIdx = atTop ? [...Array(top).keys()] : [...Array(bot).keys()].map((i) => R - 1 - i);
    // A solid band is ONE colour across the frame; a scrim over the photograph
    // shows the photograph's own shading through it, so its ground drifts.
    const grounds = []; for (const r of bandIdx) for (let c = 0; c < C; c++) if (at(r, c) === 'ground') grounds.push(g.cells[r * C + c].mode);
    const baseG = grounds.length ? grounds.map((m) => [m, grounds.filter((x) => near(x, m)).length]).sort((a, b) => b[1] - a[1])[0][0] : '';
    const drift = baseG ? Math.max(0, ...grounds.filter((m) => hexDist(m, baseG) < 80).map((m) => hexDist(m, baseG))) : 0;
    if (drift > 24 && !atTop) {
      return out({ template: 'overlay', seed: 0, type_on: 'a scrim over the photograph', why: `The photograph fills the frame and the type sits on a tinted scrim over it at the ${atTop ? 'top' : 'bottom'} (the photograph's shading shows through: the ground drifts by ${drift}).` });
    }
    // Two solid panels of different grounds stacked: a headline band, then an offer panel.
    const rows = atTop ? [...Array(top).keys()] : [...Array(bot).keys()].map((i) => R - 1 - i).reverse();
    const modes = rows.map(rowMode).filter(Boolean);
    const runs = [];
    for (const m of modes) { if (runs.length && near(runs[runs.length - 1].m, m)) runs[runs.length - 1].n++; else runs.push({ m, n: 1 }); }
    const solid = runs.filter((x) => x.n >= 2);
    if (!atTop && solid.length >= 2) {
      return out({ template: 'offer', seed: 0, type_on: 'stacked panels', offer_panel: true, why: `A photograph over two stacked panels of different grounds (${solid.length} panels, ${bot} of ${R} rows): a headline band, then a second panel under it.` });
    }
    // A tall frame cut in two (the photograph one half, the panel the other)
    // is the stacked side-by-side layout.
    if (R / C >= 1.5 && bandRows / R >= 0.42) {
      return out({ template: 'split', seed: atTop ? 1 : 0, type_on: 'a panel', why: `A tall ad cut in two: the photograph takes the ${atTop ? 'bottom' : 'top'} and a solid panel (${bandRows} of ${R} rows) the ${atTop ? 'top' : 'bottom'}, carrying the type.` });
    }
    // A flat round shape on the photograph's upper right, a strip under it: a sticker.
    if (!atTop) {
      const lim = R - bot;
      let tr = 0, tl = 0;
      for (let r = 0; r < Math.ceil(lim * 0.5); r++) {
        for (let c = Math.ceil(C * 0.55); c < C; c++) if (at(r, c) !== 'photo') tr++;
        for (let c = 0; c < Math.floor(C * 0.45); c++) if (at(r, c) !== 'photo') tl++;
      }
      if (tr >= 3 && tr > tl) {
        return out({ template: 'sticker', seed: 0, type_on: 'a strip under the photograph', why: `A photograph with a flat shape on its upper right (${tr} cells: a sticker) and a strip of type under it (${bot} of ${R} rows).` });
      }
    }
    return out({ template: 'band', seed: atTop ? 1 : 0, type_on: `a band at the ${atTop ? 'top' : 'bottom'}`, why: `A photograph with a solid band across the ${atTop ? 'top' : 'bottom'} (${bandRows} of ${R} rows) carrying the type.` });
  }
  // Type standing on the photograph itself.
  return out({ template: 'overlay', seed: 0, type_on: 'the photograph', why: text.length
    ? `The photograph fills the frame (${Math.round(P * 100)}%) and the type sits on it at the ${base.type_at}.`
    : `The photograph fills the frame (${Math.round(P * 100)}%); no type area was measured on it.` });
}

/** Fetch and grid a competitor's image in the shipped Chromium. */
async function measureImage(url, opts) {
  const o = opts || {};
  const cv = require('./code-video.js');
  const rb = o.browser || require('./render-browser.js');
  let img;
  try { img = await cv.fetchImage(url, o.fetchImpl || fetch, o.assertUrl, { left: cv.MAX_IMAGES_TOTAL }); }
  catch (e) { throw err(422, 'image_unreadable', `The competitor ad's image could not be read (${str(e && e.message, 160)}), so its layout was not measured.`); }
  try {
    return await rb.withBrowser(async (browser) => {
      const ctx = await browser.newContext({ viewport: { width: 400, height: 400 }, serviceWorkers: 'block', acceptDownloads: false });
      const pg = await ctx.newPage();
      try {
        await pg.route('**/*', (route) => {
          const u = route.request().url();
          if (u === ORIGIN + '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>measure</title>' });
          if (u === ORIGIN + '/competitor-ad') return route.fulfill({ status: 200, contentType: img.type, body: img.buf });
          return route.abort();
        });
        await pg.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 15000 });
        return await gridOf(pg, COLS, CELL);
      } finally { try { await pg.close(); } catch (_) { /* gone */ } }
    }, { waitMs: 4000, prefer: o.prefer });
  } catch (e) {
    if (e && e.status) throw e;
    if (e && e.code === 'busy') throw err(503, 'busy', 'Another image is being read on this server right now. Try again in a minute.');
    if (e && e.code === 'no_browser') throw err(503, 'no_browser', 'This server has no browser to read the image with.');
    throw err(422, 'image_unreadable', `The competitor ad's image could not be decoded (${str(e && e.message, 160)}), so its layout was not measured.`);
  }
}

/** The brand's own static in the measured structure. Pure. */
function remixStatic({ brand, measured, hero, headline, cta, market, competitorAd }) {
  const SA = require('../../scripts/lib/static-ad.js');
  const AT = require('./asset-themes.js');
  const rt = require('./brand-runtime.js');
  const core = require('./brand-workspace-core.js');
  const b = brand || {};
  const pal = rt.paletteOf(b);
  const fs = rt.fontStacks(b);
  let fontsHref = ''; try { fontsHref = core.fontsHref(b) || ''; } catch (_) { fontsHref = ''; }
  const money = (n) => { try { const v = Number(n); return Number.isFinite(v) && v > 0 ? require('./brand-locale.js').money(v, b, market) || '' : ''; } catch (_) { return ''; } };
  const price = hero ? money(hero.price) : '';
  const compare = price && hero && Number(hero.compare_at) > Number(hero.price) ? money(hero.compare_at) : '';
  const claims = (Array.isArray(b.claims) ? b.claims : []).map((c) => str(typeof c === 'string' ? c : (c && c.text), 200)).filter((c) => c && c.length <= 40).slice(0, 3);
  const H = str(headline, 160) || str(b.tagline, 160) || str(b.name, 80);
  const p = AT.pick({ brand: b, market: market || '', id: 'remix' }, 'ad', `remix:${competitorAd.competitor}:${competitorAd.ad_id || competitorAd.image}`);
  const r = SA.renderStaticAd({
    id: p.id, seed: measured.seed, theme: p.theme, template: measured.template,
    brandName: b.name || '', logo: b.logo_url || '', market,
    ratio: measured.ratio, headline: H, line: '', price, compare, benefits: claims.filter((c) => c.toLowerCase() !== H.toLowerCase()),
    cta: str(cta, 40), image: hero && hero.image, palette: pal, fonts: { head: fs.head, body: fs.body }, fontsHref,
  });
  return { static_html: r.html, design: { theme: r.theme, template: r.template, id: p.id, why: p.why }, data_gaps: r.data_gaps,
    template_note: r.template !== measured.template ? `The nearest template, ${measured.template}, needs what this ad does not have (${measured.template === 'offer' ? 'a price the store states or the brand\'s own claims' : 'a product photograph'}), so it is laid out as ${r.template}.` : '' };
}

/**
 * Remix one competitor ad for this brand. `ad` = { competitor, ad_id, image }.
 * deps: { measureImage, hero } for tests.
 */
async function remix({ brand, workspaceId, market, ad, headline, cta, deps }) {
  const d = deps || {};
  const a = ad || {};
  const competitorAd = { competitor: str(a.competitor, 80) || 'a competitor', ad_id: str(a.ad_id, 120), image: str(a.image, 1000) };
  if (!/^https:\/\//i.test(competitorAd.image)) return { ok: false, error: 'no_image', message: `This ad from ${competitorAd.competitor} has no image to measure a layout from (a text or video ad), so nothing was remixed.` };
  const grid = await (d.measureImage || measureImage)(competitorAd.image, d);
  const measured = measureLayout(grid);
  if (!measured.measurable) return { ok: false, error: 'no_structure', message: `${measured.why} Nothing was remixed.`, measured };
  let hero = null;
  if (Object.prototype.hasOwnProperty.call(d, 'hero')) hero = d.hero;
  else { try { hero = await require('./ad-angle-lab.js').heroWithPhoto(brand, workspaceId || null, market); } catch (_) { hero = null; } }
  if (!hero || !/^https:\/\//i.test(String(hero.image || ''))) {
    return { ok: false, error: 'no_product_photo', measured, message: `The layout was measured (${measured.why}) but ${brand.name || 'this brand'}'s catalogue has no product with its own photo${market ? ` for ${market}` : ''} to put in it. [DATA REQUIRED BEFORE LAUNCH: product image, ${brand.name || 'this brand'}${market ? ', ' + market : ''}]` };
  }
  const st = remixStatic({ brand, measured, hero, headline, cta, market, competitorAd });
  return {
    ok: true, static_html: st.static_html, design: st.design, product: hero.title, image: hero.image, data_gaps: st.data_gaps,
    remix_of: {
      competitor: competitorAd.competitor, ad_id: competitorAd.ad_id || null, image: competitorAd.image,
      structure_taken: { template: measured.template, ratio: measured.ratio, product_at: measured.product_at, type_at: measured.type_at,
        type_on: measured.type_on, offer_panel: measured.offer_panel, text_density: measured.text_density, photo_share: measured.photo_share },
      measured: measured.why,
      not_taken: 'their words, claims, offer, prices, photographs and colours',
      ...(st.template_note ? { note: st.template_note } : {}),
    },
  };
}

/** POST /api/public-config?action=video-render&op=remix-layout { workspace_id, market, ad:{competitor, ad_id, image}, headline, cta }. */
async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (res.removeHeader) res.removeHeader('Access-Control-Allow-Origin');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only', message: 'Ask for a remix with a POST.' });
  const core = require('./brand-workspace-core.js');
  let auth = null;
  try { auth = await core.requireUser(req); } catch (_) { auth = null; }
  if (!auth || !auth.ok) return res.status(401).json({ ok: false, error: 'sign_in_required', message: 'Sign in to remix a layout for your brand.' });
  const limited = require('./brand-render.js').rateCheck(req, Date.now(), 'video');
  if (limited) return res.status(429).json({ ok: false, error: 'rate_limited', message: limited });
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const ws = String(b.workspace_id || (req.query && req.query.workspace_id) || '');
  if (!ws) return res.status(409).json({ ok: false, error: 'no_active_brand', message: 'Choose a brand first: the remix is built from its own record.' });
  let brand = null;
  try { brand = await core.getWorkspace(auth, ws); } catch (_) { brand = null; }
  if (!brand || !brand.name) return res.status(403).json({ ok: false, error: 'not_a_member', message: 'That brand is not one you are a member of.' });
  try {
    const out = await remix({ brand, workspaceId: ws, market: str(b.market, 8).toUpperCase(), ad: b.ad, headline: b.headline, cta: b.cta });
    return res.status(out.ok ? 200 : 422).json(out);
  } catch (e) {
    return res.status(e && e.status ? e.status : 500).json({ ok: false, error: (e && e.code) || 'remix_failed', message: (e && e.message) || 'The layout could not be remixed.' });
  }
}

module.exports = { handle, remix, remixStatic, measureLayout, measureImage, gridOf, kindOf, nearestRatio, COLS, CELL };
