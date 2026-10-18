'use strict';
/**
 * Images for a brand that has no product photo (2026-10-17).
 *
 * The operator: "for brands with no catalog either a suitable image must be
 * created or a brand image must be used which is appropriate and relevant".
 * Before this, a brand with no catalogue shipped every mail, landing page and
 * static ad image-free, even when "Read my site" had recorded the brand's own
 * photographs on brand_data.imagery.
 *
 * Order, each step only when the one before it has nothing:
 *   1. the product's own catalogue photos (the callers' existing pool);
 *   2. the brand's OWN imagery, read from its OWN site: every row carries the
 *      page it was found on, the coherence rule withholds anything read from
 *      another site, and logos/icons are never used as a picture;
 *   3. one GENERATED brand scene: the brand's world in its own palette, with no
 *      product, no packaging, no text and no logo in frame (the standing rule
 *      that diffusion never draws a product holds: an image model invents
 *      labels and boxes). Hosted only; an image that cannot be hosted is not
 *      used, because the mail contract refuses embedded base64. Labelled
 *      `generated` wherever it is used.
 */

const NOT_A_PICTURE = /\b(logo|icon|favicon|wordmark|sprite|badge|avatar)\b/i;
const PREFERRED_ROLE = /\b(hero|lifestyle|banner|campaign|editorial|product)\b/i;

function brandRecord(brand) {
  try { return require('./brand-runtime.js').coherentForGeneration(brand) || brand || {}; } catch (_) { return brand || {}; }
}

/**
 * The brand's own usable photographs, best first: [{ url, page, role, source }].
 * Only https URLs, only rows that say which page of the brand's site they came
 * from (a bare off-origin URL may be a hotlinked stock photo), no logos/icons.
 */
function ownImages(brand) {
  const b = brandRecord(brand);
  const bd = (b && b.brand_data) || {};
  const rows = [].concat(Array.isArray(b.imagery) ? b.imagery : [], Array.isArray(bd.imagery) ? bd.imagery : []);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const it = typeof r === 'string' ? { url: r } : (r || {});
    const url = String(it.url || '').trim();
    if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
    if (it.off_origin) continue;
    if (!it.page && !it.found_on && !it.source_url && it.source !== 'upload') continue;
    if (NOT_A_PICTURE.test(`${it.role || ''} ${it.alt || ''} ${url.split('?')[0].split('/').pop()}`)) continue;
    seen.add(url);
    out.push({ url, page: it.page || it.found_on || it.source_url || '', role: it.role || '', source: 'brand-site' });
  }
  out.sort((a, c) => (PREFERRED_ROLE.test(c.role) ? 1 : 0) - (PREFERRED_ROLE.test(a.role) ? 1 : 0));
  return out;
}

function ownImageUrls(brand) { return ownImages(brand).map((x) => x.url); }

/** The prompt for a generated brand scene: the brand's world, never a product. */
function scenePrompt(brand) {
  const b = brandRecord(brand);
  const pal = b.palette || {};
  const colours = [pal.primary, pal.accent, pal.surface].filter(Boolean).join(', ');
  const about = [b.industry, b.tagline].filter(Boolean).join('. ');
  return [
    `Editorial photograph that sets the mood for ${b.name || 'a brand'}${about ? ` (${about})` : ''}.`,
    'A real-world scene of the setting and people this brand serves, natural light, generous negative space for type.',
    colours ? `Colour grade drawn from the brand palette: ${colours}.` : '',
    'No product, no packaging, no screen showing an interface, no text, no letters, no numbers, no logos, no watermark.',
  ].filter(Boolean).join(' ');
}

/**
 * One generated, HOSTED brand scene, or null. Never a placeholder SVG, never a
 * data URL in an asset. With no provider key or no storage, the free keyless
 * scene below. `deps` lets a test supply the generator, uploader and probe.
 */
async function generatedScene(brand, deps) {
  const d = deps || {};
  let gen = d.generate; let up = d.upload;
  if (!gen || !up) {
    try { const ci = require('./creative-image.js'); gen = gen || ci.generateCreativeImage; up = up || ci.uploadCreative; } catch (_) { return freeScene(brand, d); }
  }
  const prompt = scenePrompt(brand);
  let out = null;
  try { out = await gen(prompt, { size: '1536x1024' }); } catch (_) { out = null; }
  if (!out || !out.image || out.provider === 'placeholder' || /^data:image\/svg/i.test(out.image)) return freeScene(brand, d);
  let url = /^https:\/\//i.test(out.image) ? out.image : null;
  if (!url) { try { url = await up(out.image, `brand-scene-${String((brandRecord(brand).slug || 'brand')).slice(0, 30)}`); } catch (_) { url = null; } }
  // Generated but nowhere to keep it (no storage): the keyless address instead.
  if (!url || !/^https:\/\//i.test(url)) return freeScene(brand, d);
  return { url, provider: out.provider || 'generated', generated: true, prompt };
}

// The free, keyless scene (2026-10-17). The operator: "use free code based
// generation and rendering if that can replace the requirement of api keys".
// Pollinations needs no key and serves the picture at its own https address,
// one image per (prompt, seed): with the seed taken from the brand, the same
// address always answers the same scene, so nothing has to be stored and the
// mail carries a URL, never base64. Probed once before it is used; a host that
// does not answer with a real image gives no scene at all.
const FREE_SCENE_HOST = 'https://image.pollinations.ai/prompt/';
function seedOf(brand) {
  const b = brandRecord(brand);
  const key = String(b.slug || b.id || b.name || 'brand');
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000000;
}
function freeSceneUrl(brand, size) {
  const [w, h] = String(size || '1536x1024').split('x').map((n) => Number(n) || 1024);
  return `${FREE_SCENE_HOST}${encodeURIComponent(scenePrompt(brand).slice(0, 900))}?width=${w}&height=${h}&seed=${seedOf(brand)}&nologo=true&model=flux`;
}
async function probeImage(url, timeoutMs) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), Math.max(1000, Number(timeoutMs) || 60000)) : null;
  try {
    const r = await fetch(url, { method: 'GET', signal: ctl ? ctl.signal : undefined });
    const ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '').toLowerCase();
    if (!r.ok || !ct.startsWith('image/')) return false;
    const buf = await r.arrayBuffer();
    return buf.byteLength >= 5000;
  } catch (_) { return false; } finally { if (t) clearTimeout(t); }
}
async function freeScene(brand, deps, timeoutMs) {
  if (String(process.env.FREE_GENERATION || '').toLowerCase() === 'off') return null;
  const url = freeSceneUrl(brand);
  const ok = await ((deps && deps.probe) || probeImage)(url, timeoutMs).catch(() => false);
  return ok ? { url, provider: 'pollinations', generated: true, keyless: true, prompt: scenePrompt(brand) } : null;
}

// ONE SCENE PER BRAND, ON EVERY BUILD (2026-10-18). The operator: "brands
// without catalog are not being able to generate appropriate visuals in the
// marketing assets". The scene was made only when a build asked for creatives,
// and the /brain View build does not, so a brand with no catalogue and no
// imagery of its own saw no picture in any mail, page or ad. A brand's scene is
// the same picture for every send (its prompt and seed come from the brand), so
// it is made once and kept for this instance: `quick` (the View build) waits at
// most `budgetMs` for the free keyless scene; a full build may also ask a keyed
// provider. `peekScene` is the cached answer only, for a build that must not wait.
const _sceneCache = new Map();
function sceneKey(brand) { return freeSceneUrl(brand); }
function peekScene(brand) { return _sceneCache.get(sceneKey(brand)) || null; }
async function sceneFor(brand, opts) {
  const o = opts || {};
  const key = sceneKey(brand);
  if (_sceneCache.has(key)) return _sceneCache.get(key);
  const scene = o.quick ? await freeScene(brand, o.deps, o.budgetMs || 25000) : await generatedScene(brand, o.deps);
  if (scene) _sceneCache.set(key, scene);
  return scene;
}
function _resetScenes() { _sceneCache.clear(); }

module.exports = { ownImages, ownImageUrls, scenePrompt, generatedScene, freeSceneUrl, sceneFor, peekScene, _resetScenes };
