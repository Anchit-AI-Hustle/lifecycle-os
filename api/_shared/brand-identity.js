'use strict';
/**
 * brand-identity.js — WHICH version of a brand a stored artefact was made for.
 * ---------------------------------------------------------------------------
 * The live project's only workspace was renamed Mamaearth -> DelhiChic -> Deli
 * Chic -> Lenskart, its website changed under it, and every stored artefact
 * (Smart Brain slots and campaigns, /lp pages, the asset mirrors, the device's
 * working state) kept the earlier brand's copy and images and was replayed as
 * the current brand's. The fingerprint below was written for Smart Brain
 * (2026-10-11) and is now the ONE rule every surface uses: a stored artefact
 * whose stamp is not the current record's fingerprint is hidden or refused,
 * with a sentence, and never shown as the current brand's.
 *
 * The fingerprint covers the record's identity (workspace, name, website,
 * legal sender, the catalogue's source and whether it is excluded, tenant
 * zero) and what its assets are written FROM (palette, type families, voice
 * tone and banned words, claims, markets with their currencies).
 *
 * PORTED IDENTICALLY to the browser: the block between the BRAND-IDENTITY
 * markers is byte for byte the block in brand-context.js, and
 * tests/brand-change-current-context.spec.js diffs the text and the output.
 * The hash is SHA-256 written out in the block (the browser has no synchronous
 * digest), checked against Node's crypto in the same spec.
 *
 * Pure: no I/O, no clock. Not a function file (api/_shared/), still 12/12.
 * ---------------------------------------------------------------------------
 */

/* BRAND-IDENTITY:BEGIN */
var BRAND_IDENTITY = (function () {
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70,
    0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } else c = 0xfffd;
      } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }
  /** SHA-256 of a string's UTF-8 bytes, as lowercase hex (Node's createHash('sha256').update(s)). */
  function sha256(s) {
    var b = utf8(String(s));
    var bitLen = b.length * 8;
    b.push(0x80);
    while (b.length % 64 !== 56) b.push(0);
    var hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    for (var off = 0; off < b.length; off += 64) {
      for (var t = 0; t < 16; t++) w[t] = ((b[off + 4 * t] << 24) | (b[off + 4 * t + 1] << 16) | (b[off + 4 * t + 2] << 8) | b[off + 4 * t + 3]) | 0;
      for (t = 16; t < 64; t++) {
        var x = w[t - 15], y = w[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var mj = (a & bb) ^ (a & c) ^ (bb & c);
        var t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var hex = '';
    for (var i = 0; i < 8; i++) hex += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return hex;
  }
  function fold(v) {
    var s = String(v == null ? '' : v);
    try { s = s.normalize('NFKC'); } catch (_) { /* old engine */ }
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function host(u) {
    try { return new URL(String(u)).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return fold(u); }
  }
  function list(v) {
    return (Array.isArray(v) ? v : []).map(function (x) { return fold(x && typeof x === 'object' ? (x.text || x.name || '') : x); })
      .filter(Boolean).sort().join('|');
  }
  /**
   * The fingerprint of `brand` ("bi2:" + 24 hex), or null for no record.
   * `verdict` is the catalogue verdict the caller judged the record by
   * (brand-coherence's catalogIdentity, or null for tenant zero).
   */
  function identityOf(brand, verdict) {
    if (!brand || typeof brand !== 'object') return null;
    var bd = obj(brand.brand_data);
    var legal = brand.legal_entity || bd.legal_entity || brand.legal_name || bd.legal_name || '';
    var cat = verdict ? (verdict.source_domain || '') + '|' + (verdict.excluded ? 'x' : '') + '|' + (verdict.kept || []).join(',') : '';
    var palette = obj(brand.palette);
    var pal = Object.keys(palette).sort().map(function (k) { return k + '=' + fold(palette[k]); }).join(',');
    var typo = obj(brand.typography);
    var fam = function (t) { return fold(t && typeof t === 'object' ? (t.family || t.stack || '') : t); };
    var type = Object.keys(typo).sort().map(function (k) { return k + '=' + fam(typo[k]); }).join(',');
    var voice = obj(brand.voice);
    var claims = list(brand.claims || bd.claims) + '#' + list(brand.approved_claims || bd.approved_claims);
    var regions = (Array.isArray(brand.regions) ? brand.regions : []).filter(function (r) { return r && r.code; })
      .map(function (r) { return fold(r.code) + ':' + fold(r.currency) + (r.home === true ? ':home' : ''); }).sort().join(',');
    var parts = [
      brand.id || '', fold(brand.name || bd.name), host(brand.website || bd.website || ''),
      fold(typeof legal === 'object' ? (legal.name || JSON.stringify(legal)) : legal),
      cat, brand.owns_shipped === true ? 'zero' : '',
      pal, type, fold(voice.tone), list(voice.banned), claims, regions
    ];
    return 'bi2:' + sha256(parts.join('\u0001')).slice(0, 24);
  }
  /** Does a stored stamp speak for the current record? A missing stamp never does. */
  function matches(stamp, current) { return !!current && !!stamp && stamp === current; }
  /** The sentence a hidden or refused artefact carries: what it was made for, and what the brand is now. */
  function staleSentence(what, madeFor, now) {
    var a = String(madeFor || '').trim(), b = String(now || '').trim() || 'this brand';
    return 'This ' + what + ' was made for ' + (a ? '"' + a + '"' : 'an earlier version of this brand\'s record') +
      (a && fold(a) === fold(b) ? ' as it was then (another website, sender, catalogue, palette, type, voice, claims or market)' : '') +
      ', and the brand is now "' + b + '", so it is not shown, reused or published as "' + b + '"\'s. It is kept, not deleted; make it again for the brand as it is now.';
  }
  return { identityOf: identityOf, matches: matches, staleSentence: staleSentence, sha256: sha256 };
})();
/* BRAND-IDENTITY:END */

/** The fingerprint of a brand record, judged by the server's catalogue verdict. */
function brandIdentity(brand) {
  if (!brand || typeof brand !== 'object') return null;
  let verdict = null;
  try { verdict = require('./brand-catalog-server.js').catalogVerdict(brand) || null; } catch (_) { verdict = null; }
  return BRAND_IDENTITY.identityOf(brand, verdict);
}

module.exports = {
  brandIdentity,
  identityMatches: BRAND_IDENTITY.matches,
  staleSentence: BRAND_IDENTITY.staleSentence,
  sha256: BRAND_IDENTITY.sha256,
  BLOCK: BRAND_IDENTITY,
};
