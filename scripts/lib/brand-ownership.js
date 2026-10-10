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

/* ── the brand's CONSUMER site, and the brand's other sites (2026-10-10) ──────
   The operator's screenshot of the starter gallery: nearly every card on the
   grey default, and several that were read had been read off jobs.myntra.com,
   careers.loreal.com, newsroom.sephora.com, hmgroup.com, report.adidas-group.com.
   Those hosts ARE the brand's own (ownership() above says so, correctly), but
   a careers portal, a newsroom, an investor or annual-report site and a group
   holding company's site are designed for recruits, journalists and
   shareholders, often by another agency on another design system. Their
   colours are not the colours a customer sees, so a starter brand's palette is
   never taken from one. The rule is about WHAT a page is for, not whose it is:
     - the host's first label names the audience (jobs., careers., newsroom.,
       investors., ir., press., corporate., report. ...);
     - the host is the group's corporate sibling (hmgroup.com, adidas-group.com,
       bmwgroup.com) or "about<brand>" (aboutamazon.com);
     - a path segment names the audience (/careers, /newsroom, /mediaroom,
       /investors ...), e.g. www.loreal.com/en/mediaroom/.
   Anything else on the brand's own domains is its consumer material. */
const NON_CONSUMER_LABELS = new Set([
  'careers', 'career', 'jobs', 'job', 'newsroom', 'news-room', 'investors', 'investor', 'ir',
  'press', 'pressroom', 'press-room', 'corporate', 'corp', 'report', 'reports', 'annualreport',
  'mediaroom', 'media-room', 'about', 'stories',
]);
const NON_CONSUMER_PATH = new Set([
  'careers', 'career', 'jobs', 'newsroom', 'news-room', 'investors', 'investor-relations',
  'mediaroom', 'media-room', 'pressroom', 'press-room', 'press-releases', 'annual-report', 'corpmcd',
]);
const AUDIENCE = {
  careers: 'a careers site', career: 'a careers site', jobs: 'a careers site', job: 'a careers site',
  newsroom: 'a newsroom', 'news-room': 'a newsroom', press: 'a press site', pressroom: 'a press site',
  'press-room': 'a press site', 'press-releases': 'a press site', mediaroom: 'a press site', 'media-room': 'a press site',
  investors: 'an investor-relations site', investor: 'an investor-relations site', ir: 'an investor-relations site',
  'investor-relations': 'an investor-relations site', report: 'an annual-report site', reports: 'an annual-report site',
  annualreport: 'an annual-report site', 'annual-report': 'an annual-report site',
  corporate: 'a corporate site', corp: 'a corporate site', corpmcd: 'a corporate site', about: 'a corporate site', stories: 'a corporate news site',
};

/**
 * Is `url` the brand's CONSUMER material (what a customer sees), rather than
 * its careers, press, investor or group-corporate site? `website` is the
 * preset's home URL (optional; it names the brand for the sibling rules).
 * Returns { ok:true } or { ok:false, host, code:'not_consumer_site', reason }.
 */
function consumerSite(url, website) {
  const host = hostOf(url);
  if (!host) return { ok: true };
  const refuse = (what) => ({
    ok: false, host, code: 'not_consumer_site', what,
    reason: `${host} is not the brand's consumer site (it is ${what}), so no colour, type or logo is taken from it`,
  });
  const first = host.split('.')[0];
  if (/^\d+$/.test(first)) return { ok: true };
  if (NON_CONSUMER_LABELS.has(first) && host.split('.').length > 2) return refuse(AUDIENCE[first] || 'not a consumer site');
  const lab = brandLabel(host);
  const homeLab = brandLabel(hostOf(website));
  if (homeLab && lab && lab !== homeLab) {
    if (corporateSibling(homeLab, lab)) return refuse('the group\'s corporate site');
    if (lab === `about${homeLab}`) return refuse('a corporate site');
  }
  if (lab && /^.+-?group$/.test(lab) && lab !== homeLab) return refuse('the group\'s corporate site');
  let segs = [];
  try { segs = new URL(String(url)).pathname.toLowerCase().split('/').filter(Boolean); } catch (_) { segs = []; }
  for (const s of segs) if (NON_CONSUMER_PATH.has(s)) return refuse(AUDIENCE[s] || 'not a consumer page');
  return { ok: true };
}

module.exports = { ownership, consumerSite, registrableDomain, brandLabel, corporateSibling, hostOf, MULTI_LABEL_SUFFIXES, NON_CONSUMER_LABELS };
