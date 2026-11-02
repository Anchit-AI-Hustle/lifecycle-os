'use strict';
/**
 * static-raster.js - the designed static ad as a PNG a platform can fetch
 * (2026-11-02, gap 1 against usefastlane.ai).
 * ---------------------------------------------------------------------------
 * A Smart Brain static ad is composed by scripts/lib/static-ad.js as a page
 * (`creative.static_html`): the brand's theme, template, headline, price and
 * button over the product's own photo. Paid launch sent the bare photo
 * (`creative.image`) to Meta, so what ran on the platform was not the ad the
 * reviewer approved. This draws that page in the headless Chromium this
 * function already ships (render-browser.js, the launcher code-video.js uses),
 * photographs the `.ad` element as a PNG, and hosts it in the `brand-assets`
 * Storage bucket at `<workspace_id>/<sha256>.png` (the path the bucket's
 * policies are keyed by; the same name for the same bytes, so a re-run is a
 * no-op). The campaign row then carries `creative.static_png_url`, which
 * paid-launch-core.imageOf() prefers.
 *
 * What the page may load: its own HTML, the photographs its <img> tags name
 * (fetched server-side by code-video.fetchImage: public hosts only, every
 * redirect hop checked, images only, size-capped) and Google Fonts (the only
 * stylesheet static-ad.js ever links). Anything else is aborted. A photograph
 * that could not be fetched means NO PNG for that ad: a picture with a broken
 * image would be worse than the photo the launch falls back to, and it says so.
 *
 * Mounted on POST /api/public-config?action=video-render&op=static-png (the
 * function that carries Chromium; still 12/12 functions). Signed in, owner or
 * editor of the workspace (assertCanWrite), the campaign read by the service
 * role with the workspace on the query, and the rendered-read rate limit.
 * NOT a function file (api/_shared/ is outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');

const ORIGIN = 'https://render.invalid';
const BUCKET = 'brand-assets';
const WIDTH = 1080;
const MAX_PNG_BYTES = 6 * 1024 * 1024;
const MAX_ADS = 12;
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const enc = encodeURIComponent;

function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: String(url).replace(/\/$/, ''), key } : null;
}

/** The pixel size of an ad page, from its own data-ratio (static-ad.js RATIOS). */
function sizeOf(html, width) {
  const RATIOS = require('../../scripts/lib/static-ad.js').RATIOS;
  const m = /data-ratio="([^"]+)"/.exec(String(html || ''));
  const ratio = m && RATIOS[m[1]] ? m[1] : '1:1';
  const [rw, rh] = RATIOS[ratio];
  const w = Number(width) > 0 ? Math.round(Number(width)) : WIDTH;
  return { ratio, width: w, height: Math.round((w * rh) / rw) };
}

/** The photographs an ad page names (its <img src>), unescaped. */
function imageUrls(html) {
  const out = new Set();
  const re = /<img\b[^>]*\bsrc="([^"]+)"/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const u = m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    if (/^https?:\/\//i.test(u)) out.add(u);
  }
  return out;
}

/** A Google Fonts stylesheet or font file, fetched server-side, every hop checked. */
async function fetchFontAsset(url, fetchImpl, assertUrl) {
  const assertPublicUrl = assertUrl || require('./brand-workspace-core.js').assertPublicUrl;
  let at = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//i.test(at)) throw new Error('not Google Fonts');
    await assertPublicUrl(at);
    const r = await fetchImpl(at, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { at = new URL(r.headers.get('location'), at).toString(); continue; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_FONT_BYTES) throw new Error('font over 2 MB');
    return { type: type || 'application/octet-stream', buf };
  }
  throw new Error('too many redirects');
}

/**
 * Draw several ad pages, one browser, one context, a page per ad (closing a
 * context ends a single-process browser, render-browser.js). Answers one
 * result per item: { ok, buffer, width, height, ratio, images } or
 * { ok:false, error, message }.
 */
async function rasteriseMany(items, opts) {
  const o = opts || {};
  const cv = require('./code-video.js');
  const rb = o.browser || require('./render-browser.js');
  const fetchImpl = o.fetchImpl || fetch;
  const deadline = Date.now() + (Number(o.budgetMs) > 0 ? Number(o.budgetMs) : 80000);
  const list = (items || []).slice(0, MAX_ADS);
  try {
    return await rb.withBrowser(async (browser) => {
      const out = [];
      const sz0 = sizeOf(list[0] && list[0].html, o.width);
      const ctx = await browser.newContext({ viewport: { width: sz0.width, height: sz0.height }, deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: false });
      for (const it of list) {
        if (Date.now() > deadline - 5000) { out.push({ ok: false, error: 'no_time', message: 'There was no time left in this request to draw this ad; press again for the rest.' }); continue; }
        const html = String((it && it.html) || '');
        const sz = sizeOf(html, o.width);
        const wanted = imageUrls(html);
        const images = { used: 0, refused: [] };
        const budget = { left: cv.MAX_IMAGES_TOTAL };
        const pg = await ctx.newPage();
        try {
          await pg.setViewportSize({ width: sz.width, height: sz.height });
          await pg.route('**/*', async (route) => {
            const req = route.request();
            const url = req.url();
            if (req.method() !== 'GET') return route.abort();
            if (url === ORIGIN + '/') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
            if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//i.test(url)) {
              try { const f = await fetchFontAsset(url, fetchImpl, o.assertUrl); return route.fulfill({ status: 200, contentType: f.type, body: f.buf, headers: { 'Access-Control-Allow-Origin': '*' } }); }
              catch (_) { return route.abort(); }
            }
            if (!wanted.has(url)) return route.abort();
            try {
              const img = await cv.fetchImage(url, fetchImpl, o.assertUrl, budget);
              images.used += 1;
              return route.fulfill({ status: 200, contentType: img.type, body: img.buf, headers: { 'Access-Control-Allow-Origin': '*' } });
            } catch (e) {
              images.refused.push({ url, why: String((e && e.message) || e).slice(0, 160) });
              return route.abort();
            }
          });
          await pg.goto(ORIGIN + '/', { waitUntil: 'load', timeout: 25000 });
          // Fonts loaded and every photograph decoded, bounded.
          const loaded = await pg.evaluate(async () => {
            const wait = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
            try { await wait(document.fonts.ready, 5000); } catch (_) { /* fallback faces */ }
            const imgs = [...document.querySelectorAll('img')];
            await wait(Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })))), 8000);
            return { total: imgs.length, broken: imgs.filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute('src')) };
          });
          if (loaded.broken.length || images.refused.length) {
            const why = images.refused.length ? images.refused.map((r) => `${r.url} (${r.why})`).join('; ') : loaded.broken.join(', ');
            out.push({ ok: false, error: 'image_refused', images, message: `The ad's photograph could not be loaded to draw it (${why.slice(0, 240)}), so no PNG was made; the launch sends the photo instead.` });
            continue;
          }
          const el = await pg.$('.ad');
          if (!el) { out.push({ ok: false, error: 'not_an_ad', message: 'That is not a static ad this app made (no .ad frame), so there is nothing to draw.' }); continue; }
          const buffer = await el.screenshot({ type: 'png', animations: 'disabled', timeout: 15000 });
          if (buffer.length > MAX_PNG_BYTES) { out.push({ ok: false, error: 'too_large', message: `The PNG came out at ${(buffer.length / 1048576).toFixed(1)} MB, over the 6 MB this keeps.` }); continue; }
          out.push({ ok: true, buffer, width: sz.width, height: sz.height, ratio: sz.ratio, images });
        } catch (e) {
          out.push({ ok: false, error: 'draw_failed', message: 'The ad could not be drawn: ' + String((e && e.message) || e).split('\n')[0].slice(0, 200) });
        } finally {
          try { await pg.close(); } catch (_) { /* gone */ }
        }
      }
      return out;
    }, { waitMs: 4000, prefer: o.prefer });
  } catch (e) {
    const why = e && e.code === 'busy' ? 'Another video or site is being rendered on this server right now. Try again in a minute.'
      : (e && e.code === 'no_browser' ? 'This server has no browser to draw the ad with.' : 'The ads could not be drawn: ' + String((e && e.message) || e).slice(0, 200));
    return list.map(() => ({ ok: false, error: (e && e.code) || 'render_failed', message: why }));
  }
}

/** Host a PNG at brand-assets/<workspace_id>/<sha256>.png (service role); answers its public URL. */
async function hostPng(buffer, workspaceId, opts) {
  const o = opts || {};
  const e = serviceEnv();
  if (!e) throw err(503, 'asset_store_unavailable', 'This deployment has no file store (SUPABASE_SERVICE_ROLE_KEY is not set), so the drawn ad cannot be hosted; the launch sends the photo instead.');
  if (!workspaceId) throw err(400, 'workspace_required', 'A drawn ad is kept under its brand workspace.');
  const sha = sha256(buffer);
  const objectPath = `${workspaceId}/${sha}.png`;
  const fetchImpl = o.fetchImpl || fetch;
  const res = await fetchImpl(`${e.url}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, 'Content-Type': 'image/png', 'x-upsert': 'true', 'cache-control': '31536000' },
    body: buffer,
  });
  if (!res.ok && res.status !== 409) {
    const t = await res.text().catch(() => '');
    throw err(502, 'asset_store_refused', `The file store refused the drawn ad (${res.status}${t ? ': ' + String(t).slice(0, 120) : ''}); the launch sends the photo instead.`);
  }
  return { path: objectPath, sha256: sha, url: `${e.url}/storage/v1/object/public/${BUCKET}/${objectPath}` };
}

async function svc(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = serviceEnv();
  if (!e) throw err(503, 'campaign_store_unavailable', 'This deployment has no campaign store (SUPABASE_SERVICE_ROLE_KEY is not set).');
  const headers = { apikey: e.key, authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) throw err(502, 'campaign_store_failed', `The campaign store answered ${res.status} to ${method}.`);
  return json;
}

/**
 * Draw and host every static ad of one of this brand's Smart Brain campaigns,
 * and record each as `creative.static_png_url` (+ `creative.static_png`). An
 * ad whose page has not changed since it was drawn keeps its PNG.
 */
async function rasteriseCampaign(auth, workspaceId, campaignId, opts) {
  const o = opts || {};
  await require('./brand-workspace-core.js').assertCanWrite(auth, workspaceId, 'draw its ads');
  const id = String(campaignId || '');
  if (!id) throw err(400, 'campaign_required', 'Name the Smart Brain campaign whose static ads to draw (campaign_id).');
  const rows = await svc(`smart_generated_campaigns?select=id,payload&id=eq.${enc(id)}&workspace_id=eq.${enc(workspaceId)}&limit=1`);
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row || !row.payload) throw err(404, 'campaign_not_found', 'That campaign is not one of this brand\'s.');
  const payload = row.payload;
  const ads = ((payload.assets && payload.assets.ads) || []);
  const todo = [];
  const kept = [];
  ads.forEach((ad, i) => {
    if (!ad || ad.creative_type === 'video') return;
    const c = ad.creative || {};
    if (typeof c.static_html !== 'string' || !/class="ad"/.test(c.static_html)) return;
    const hs = sha256(c.static_html);
    if (c.static_png && c.static_png.html_sha256 === hs && /^https:\/\//i.test(String(c.static_png_url || ''))) { kept.push({ index: i, platform: ad.platform, url: c.static_png_url }); return; }
    todo.push({ index: i, platform: ad.platform, html: c.static_html, html_sha256: hs });
  });
  const drawn = todo.length ? await rasteriseMany(todo.slice(0, MAX_ADS), { fetchImpl: o.fetchImpl, assertUrl: o.assertUrl, browser: o.browser, budgetMs: o.budgetMs }) : [];
  const made = []; const failed = [];
  for (let k = 0; k < drawn.length; k++) {
    const it = todo[k]; const r = drawn[k];
    if (!r.ok) { failed.push({ index: it.index, platform: it.platform, error: r.error, message: r.message }); continue; }
    try {
      const h = await hostPng(r.buffer, workspaceId, { fetchImpl: o.storeFetch });
      const ad = ads[it.index];
      ad.creative = Object.assign({}, ad.creative || {}, {
        static_png_url: h.url,
        static_png: { url: h.url, sha256: h.sha256, width: r.width, height: r.height, ratio: r.ratio, html_sha256: it.html_sha256, made_at: new Date().toISOString(), from: 'static_html' },
      });
      made.push({ index: it.index, platform: it.platform, url: h.url, width: r.width, height: r.height, ratio: r.ratio });
    } catch (e) {
      failed.push({ index: it.index, platform: it.platform, error: (e && e.code) || 'host_failed', message: (e && e.message) || 'The drawn ad could not be hosted.' });
    }
  }
  if (todo.length > MAX_ADS) failed.push({ error: 'too_many', message: `${todo.length - MAX_ADS} more static ads were not drawn in this request (at most ${MAX_ADS}); press again for the rest.` });
  if (made.length) await svc(`smart_generated_campaigns?id=eq.${enc(id)}&workspace_id=eq.${enc(workspaceId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { payload } });
  return { ok: true, campaign_id: id, made, kept, failed, note: failed.length ? `${failed.length} static ad${failed.length === 1 ? '' : 's'} were not drawn; their launch sends the photo instead.` : '' };
}

/** POST /api/public-config?action=video-render&op=static-png { workspace_id, campaign_id }. */
async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (res.removeHeader) res.removeHeader('Access-Control-Allow-Origin');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only', message: 'Ask for the drawn ads with a POST.' });
  const core = require('./brand-workspace-core.js');
  let auth = null;
  try { auth = await core.requireUser(req); } catch (_) { auth = null; }
  if (!auth || !auth.ok) return res.status(401).json({ ok: false, error: 'sign_in_required', message: 'Sign in to draw this brand\'s ads: they are kept under its workspace.' });
  const limited = require('./brand-render.js').rateCheck(req, Date.now(), 'video');
  if (limited) return res.status(429).json({ ok: false, error: 'rate_limited', message: limited });
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const ws = String(b.workspace_id || (req.query && req.query.workspace_id) || '');
  if (!ws) return res.status(409).json({ ok: false, error: 'no_active_brand', message: 'Choose a brand workspace first: a drawn ad is kept under it.' });
  try {
    return res.status(200).json(await rasteriseCampaign(auth, ws, b.campaign_id));
  } catch (e) {
    return res.status(e && e.status ? e.status : 500).json({ ok: false, error: (e && e.code) || 'static_png_failed', message: (e && e.message) || 'The ads could not be drawn.' });
  }
}

module.exports = { handle, rasteriseMany, rasteriseCampaign, hostPng, sizeOf, imageUrls, BUCKET, MAX_ADS, ORIGIN };
