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
 * A URL is the brand's in one of these ways, and nothing else:
 *   same-registrable-domain  its host is under the same registrable domain as
 *                            the preset's `website` (brand.netflix.com for
 *                            netflix.com; press.example.co.uk for
 *                            example.co.uk).
 *   same-brand-label         the registrable label is the brand's own
 *                            (sony.co.jp for sony.com, tesla.cn for tesla.com).
 *                            A longer label is not it (notnetflix.com).
 *   corporate-sibling        the label is the brand's plus a corporate tail
 *                            (hmgroup.com, adidas-group.com, bmwgroup.com).
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

/** The first label of a registrable domain: sony.co.jp and sony.com are both sony.
 *  An IP address has no name. Splitting 127.0.0.1 would make every loopback
 *  host the brand "127", so a logo on 127.0.0.2 would be owned without a link. */
function brandLabel(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return '';
  const reg = registrableDomain(h);
  const label = reg ? reg.split('.')[0] : '';
  if (!label || /^\d+$/.test(label)) return '';
  return label;
}

/** hmgroup / adidas-group / bmwgroup: the brand's label plus one corporate tail. */
const CORPORATE_TAIL = /^(?:group|groups|inc|corp|corporate|global|holding|holdings)$/;
function corporateSibling(brandLab, hostLab) {
  if (!brandLab || !hostLab || hostLab === brandLab || !hostLab.startsWith(brandLab)) return false;
  let rest = hostLab.slice(brandLab.length);
  if (rest.startsWith('-')) rest = rest.slice(1);
  return CORPORATE_TAIL.test(rest);
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
  const lab = brandLabel(host);
  const homeLab = brandLabel(home);
  if (lab && lab === homeLab) return { ok: true, how: 'same-brand-label', host, registrable: reg, website_host: home, label: lab };
  if (corporateSibling(homeLab, lab)) return { ok: true, how: 'corporate-sibling', host, registrable: reg, website_host: home, label: lab };
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

module.exports = { ownership, registrableDomain, brandLabel, corporateSibling, hostOf, MULTI_LABEL_SUFFIXES };
