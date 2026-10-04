'use strict';
/**
 * scripts/lib/brand-ownership.js — is this URL the brand's own material?
 * ---------------------------------------------------------------------------
 * A starter brand's colours may be read from a page OTHER than its home page
 * (its guidelines, press or newsroom page, its own logo file) when the home
 * page refuses an automated read. That page must be the BRAND'S, never a
 * third party's - a "brand colours" site, an encyclopaedia, a logo
 * aggregator states a brand fact nobody at the brand published.
 *
 * Two ways a URL is the brand's, and nothing else:
 *   same-registrable-domain  its host is under the same registrable domain as
 *                            the preset's `website` (brand.netflix.com for
 *                            netflix.com; press.example.co.uk for
 *                            example.co.uk).
 *   linked-from              a page this harvest READ on the brand's own
 *                            domain links to its host. Checked at read time
 *                            from what that page rendered, never asserted.
 *
 * The registrable domain uses the last two labels, or three under the
 * multi-label public suffixes listed below (the ones this library's brands
 * and their markets use). A host this rule cannot place is not owned.
 */

const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in',
  'co.jp', 'ne.jp', 'or.jp', 'com.br', 'co.nz', 'com.mx', 'com.sg', 'com.hk', 'co.kr', 'com.cn', 'com.tw', 'co.za',
  'com.tr', 'com.ar', 'co.id', 'com.my', 'com.ph', 'com.vn', 'co.th', 'com.sa', 'com.eg',
]);

function hostOf(url) {
  try { return new URL(String(url || '')).hostname.toLowerCase().replace(/\.$/, ''); } catch (_) { return ''; }
}

/** The registrable domain of a host (an IP or a one-label host is itself). */
function registrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || !h.includes('.')) return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  return MULTI_LABEL_SUFFIXES.has(last2) ? parts.slice(-3).join('.') : last2;
}

/**
 * Is `url` the brand's own? `website` is the preset's home URL. `evidence`:
 * [{ page, link_hosts }] - pages already read on the brand's own domain and
 * the hosts each links to. Returns { ok, how, host, registrable, ... } or
 * { ok:false, reason }.
 */
function ownership(url, website, evidence) {
  const host = hostOf(url);
  const home = hostOf(website);
  if (!host || !home) return { ok: false, host, reason: 'not a URL this rule can place' };
  if (!/^https?:\/\//i.test(String(url))) return { ok: false, host, reason: 'only http(s) material is read' };
  const reg = registrableDomain(host);
  const homeReg = registrableDomain(home);
  if (reg && reg === homeReg) return { ok: true, how: 'same-registrable-domain', host, registrable: reg, website_host: home };
  for (const e of evidence || []) {
    const from = hostOf(e && e.page);
    if (!from || registrableDomain(from) !== homeReg) continue;
    if ((e.link_hosts || []).map((h) => String(h).toLowerCase()).includes(host)) {
      return { ok: true, how: 'linked-from', host, registrable: reg, website_host: home, linked_from: e.page };
    }
  }
  return {
    ok: false, host, registrable: reg, website_host: home,
    reason: `${host} is not under ${homeReg}, and no page read on ${homeReg} links to it, so it is not shown to be the brand's own`,
  };
}

module.exports = { ownership, registrableDomain, hostOf, MULTI_LABEL_SUFFIXES };
