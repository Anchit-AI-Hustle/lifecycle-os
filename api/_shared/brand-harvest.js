'use strict';
/**
 * brand-harvest.js — read a brand's own site END TO END, in ONE crawl, and
 * return everything the generators need to build an asset for it.
 * ---------------------------------------------------------------------------
 * WHAT WAS ALREADY HERE, AND WHAT WAS NOT.
 *
 *   brand-extract.js   name, tagline, logo, palette, typography, observed
 *                      voice, verbatim claims, social, legal entity, regions.
 *   site-crawl.js      one scope-checked, robots-respecting, SSRF-guarded
 *                      crawler with `onPage` + `rank` hooks.
 *   importCatalog      products, where the site exposes a feed.
 *
 * What nothing captured was the IMAGE LIBRARY: the actual photographs a brand
 * publishes. Assets were therefore generated either from a workspace catalogue
 * row (which a preset does not have) or image-free. A preset brand could carry
 * a palette and a voice and still produce a mailer with an empty hero.
 *
 * This rides the SAME crawl as everything above rather than adding a second
 * one, so there is one set of scope, robots and SSRF rules, and a brand's site
 * is fetched once.
 *
 * ── IMAGES ARE URLs, ALWAYS ────────────────────────────────────────────────
 * Every image is kept as the absolute URL the site published, with the page it
 * was found on and what it appeared to be. Nothing is downloaded, re-encoded or
 * inlined:
 *
 *   - a base64 hero adds about a third to its own size, and Gmail clips a
 *     message past roughly 102KB, so the mailer is cut mid-layout;
 *   - most clients refuse to render base64 images at all;
 *   - a referenced URL can be re-cropped, CDN-resized and swapped; an embedded
 *     copy cannot, and it is invisible to asset provenance.
 *
 * `asset-contracts.js` enforces the same rule on the finished artefact.
 *
 * ── NOTHING HERE IS APPLIED ────────────────────────────────────────────────
 * Every value is a CANDIDATE carrying its source URL and the signal it came
 * from. Applying is a separate, deliberate step through
 * `brand_field_provenance`, which is the only door an automatic value may come
 * through and refuses any field whose origin is `user`. A harvest is evidence,
 * not a decision.
 *
 * ── IT CANNOT RUN EVERYWHERE ───────────────────────────────────────────────
 * This container's egress proxy refuses brand sites, so a harvest run here
 * returns `reachable:false` with the exact reason rather than an empty result
 * that reads like "the site had nothing". Run it from the deployment, which can
 * reach them.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const extract = require('./brand-extract.js');

const ABS = /^https?:\/\//i;

/** Absolute, de-fragmented, or nothing. A relative src is not an image URL. */
function absolutise(src, pageUrl) {
  const s = String(src || '').trim();
  if (!s || s.startsWith('data:')) return '';       // a payload, not a reference
  try { return new URL(s, pageUrl).toString().split('#')[0]; } catch (_) { return ''; }
}

/** The widest candidate a srcset offers, so a hero is not harvested at 200px. */
function widestFromSrcset(srcset, pageUrl) {
  const parts = String(srcset || '').split(',').map((p) => p.trim()).filter(Boolean);
  let best = '';
  let bestW = -1;
  for (const p of parts) {
    const [url, desc] = p.split(/\s+/);
    const w = /(\d+)w/.exec(desc || '');
    const width = w ? parseInt(w[1], 10) : 0;
    if (width >= bestW) { bestW = width; best = url; }
  }
  return absolutise(best, pageUrl);
}

/**
 * What an image on a page appears to BE. Role is a guess from context and is
 * labelled as one: a generator asking for a hero should not silently receive an
 * icon because both were "an image on the site".
 */
function roleOf(tag, url) {
  const s = `${tag} ${url}`.toLowerCase();
  if (/logo|brandmark|wordmark/.test(s)) return 'logo';
  if (/icon|favicon|sprite|badge/.test(s)) return 'icon';
  if (/hero|banner|masthead|cover/.test(s)) return 'hero';
  if (/product|\/products\/|shop|catalog/.test(s)) return 'product';
  if (/avatar|profile|team|author/.test(s)) return 'person';
  return 'unknown';
}

/** Images that are decoration or tracking rather than brand photography. */
function isIgnorable(url) {
  return /\.(svg)(\?|$)/i.test(url) === false && /1x1|pixel|spacer|blank|tracking|analytics|beacon/i.test(url);
}

/**
 * Harvest one page's images. Kept deliberately dumb about layout: it records
 * what the page published and where, and lets the caller rank.
 */
function imagesOnPage(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const push = (raw, tag, extra) => {
    const url = absolutise(raw, pageUrl);
    if (!url || !ABS.test(url) || seen.has(url) || isIgnorable(url)) return;
    seen.add(url);
    out.push({
      url,
      role: roleOf(tag, url),
      alt: (/alt=["']([^"']{0,160})["']/i.exec(tag) || [])[1] || '',
      width: Number((/width=["']?(\d{2,5})/i.exec(tag) || [])[1]) || null,
      found_on: pageUrl,
      ...extra,
    });
  };

  // <img>, preferring the widest srcset entry over a thumbnail src.
  const imgTags = String(html || '').match(/<img\b[^>]*>/gi) || [];
  for (const tag of imgTags) {
    const srcset = (/srcset=["']([^"']+)["']/i.exec(tag) || [])[1];
    const wide = srcset ? widestFromSrcset(srcset, pageUrl) : '';
    const src = (/(?:\bsrc|data-src)=["']([^"']+)["']/i.exec(tag) || [])[1];
    push(wide || src, tag, { from: wide ? 'srcset' : 'src' });
  }

  // og:image is a share card: real, useful, and frequently NOT the hero.
  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html || '');
  if (og) push(og[1], 'og:image', { from: 'opengraph', note: 'share card, often not the on-page hero' });

  return out;
}

/**
 * Run the harvest.
 *
 * @param {string} startUrl the brand's own site
 * @param {object} opts     { maxPages, timeoutMs }
 * @returns {Promise<object>} candidates + an image library, all with provenance
 */
async function harvest(startUrl, opts = {}) {
  const images = [];
  const pages = [];

  let brand = null;
  let failure = null;
  try {
    // One crawl. brand-extract already owns scope, robots and SSRF, and its
    // onPage hook is how the catalogue importer and the review reader ride the
    // same fetch. This is the third rider, not a second crawler.
    brand = await extract.extractBrand(startUrl, {
      maxPages: opts.maxPages || 12,
      onPage: (html, url) => {
        pages.push(url);
        for (const img of imagesOnPage(html, url)) images.push(img);
      },
    });
  } catch (e) {
    failure = e && e.message ? e.message : String(e);
  }

  const reachable = !!(brand && (brand.pages_visited || 0) > 0);

  // A blocked network is NOT an empty site. Saying so is the whole difference
  // between "this brand publishes nothing" and "we could not look".
  if (!reachable) {
    return {
      ok: false,
      reachable: false,
      start: startUrl,
      pages_visited: (brand && brand.pages_visited) || 0,
      images: [],
      diagnosis: (brand && brand.diagnosis) || null,
      error: failure,
      note: failure
        ? `Nothing was read from ${startUrl}: ${failure}. This says nothing about the site.`
        : `Nothing was read from ${startUrl}. This says nothing about the site - it says the crawl did not complete. Run this from an environment that can reach the public internet.`,
    };
  }

  // De-duplicate on URL, keep the widest sighting of each.
  const byUrl = new Map();
  for (const img of images) {
    const prev = byUrl.get(img.url);
    if (!prev || (img.width || 0) > (prev.width || 0)) byUrl.set(img.url, img);
  }
  const library = [...byUrl.values()];
  const byRole = library.reduce((acc, i) => { (acc[i.role] = acc[i.role] || []).push(i); return acc; }, {});

  return {
    ok: true,
    reachable: true,
    start: startUrl,
    harvested_at: new Date().toISOString(),
    pages_visited: brand.pages_visited || pages.length,

    // Everything brand-extract already resolves, unchanged and still as
    // candidates with their own provenance.
    brand,

    images: {
      total: library.length,
      by_role: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, v.length])),
      // URLs. Never payloads. See the module note.
      library,
      note: 'Every entry is the absolute URL the site published, with the page it was found on. Nothing was downloaded or re-encoded, and `role` is a guess from context, not a statement about what the image is.',
    },

    limits: [
      'No browser runs here, so anything a page paints with JavaScript after load is invisible to this.',
      'A role is inferred from the tag and the URL. A product photo on a page that does not say "product" reads as unknown.',
      'An image being published is not permission to use it in an advertisement. Rights are the operator\'s to confirm.',
    ],
  };
}

module.exports = { harvest, imagesOnPage, absolutise, widestFromSrcset, roleOf };
