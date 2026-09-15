'use strict';
/**
 * soft-error-detect.js — is the page we were handed actually the brand's page?
 * ---------------------------------------------------------------------------
 * OBSERVED, on the live deployment. An operator ran setup-from-URL against a
 * large retailer. The site answered our crawler with a maintenance / bot-block
 * page — and answered it with **HTTP 200**, not a 4xx or a 5xx. The crawl
 * therefore succeeded, the extractor faithfully read what it was given, and the
 * report said:
 *
 *     Brand name: "Site Maintenance"           html:title            WEAK
 *     Tagline:    "Oops! Something went wrong" html:h1(home hero)    WEAK
 *     Logo:       [DATA REQUIRED BEFORE LAUNCH: logo URL, all, all]
 *     Store:      NOT DECLARED
 *
 * Nothing was invented. Every value carried a real source URL and an honest
 * confidence. And that is exactly what makes it the worst possible output of
 * this pipeline: a FABRICATED BRAND IDENTITY wearing real provenance. Under
 * this repo's rules a value with a source is a value an operator may act on, so
 * "Site Maintenance" would have become a brand name with a citation behind it.
 *
 * ── WHY A STATUS CODE CANNOT ANSWER THIS ───────────────────────────────────
 * Large sites routinely refuse datacenter IP addresses and non-browser user
 * agents, and the polite way to refuse is a SOFT ERROR: an error page delivered
 * as 200 OK. `diagnoseEmptyCrawl()` in brand-extract.js already handles every
 * HARD failure — 403, 404, 5xx, DNS, robots.txt — and it fires only when the
 * crawl read nothing at all. The dangerous case is the opposite one: **we read
 * something, and it is not the brand.** Nothing looked for that.
 *
 * ── THE RULE: CORROBORATE, NEVER TRIP ON ONE WEAK WORD ─────────────────────
 * A false positive here is expensive in a way the defect is not. Refusing a
 * legitimate brand blocks onboarding outright, and an operator who is wrongly
 * told "your site did not show us its real content" has no way to argue with
 * it. So:
 *
 *   * Wording is read from the TITLE and the H1 ONLY. Body prose never counts.
 *     The word "error" in a paragraph is a word in a paragraph.
 *   * Each distinct PHRASE scores once, at its best surface. A facilities
 *     company titled "Site Maintenance Services" and headed "Site Maintenance
 *     Services" has published ONE error-flavoured phrase, not two, and one
 *     ambiguous phrase is never enough.
 *   * Structural signals (a home page with almost no links, a `noindex` on the
 *     root, a meta refresh, a captcha widget on a bare page) CORROBORATE and can
 *     never convict: a verdict always requires a vendor fingerprint or a
 *     wording hit, so no amount of thinness alone refuses a brand.
 *   * A vendor challenge fingerprint — a string that exists only on that
 *     vendor's own block page — convicts on its own, because it is the site's
 *     infrastructure telling us in its own words that it did not serve the site.
 *
 * Scores: BLOCK wording 3 (error-page-only phrasing), STRONG 2, WEAK 1,
 * structural 1 each, vendor decisive. Threshold 3.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * It is not a judgement about the brand or the site. A page that trips this is
 * reported as "the site did not show us its real content", with the host named
 * and what was served quoted back, and the operator is told plainly what to do
 * next. And it never guesses a value in place of the one it refused: a refused
 * page contributes NOTHING, which is the only safe answer when the thing we
 * would otherwise report is another company's error template.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const THRESHOLD = 3;
const W = { block: 3, strong: 2, weak: 1, structural: 1 };

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 200);

/* ═══════════════════════════════════════════════════════════════════════════
   1. VENDOR CHALLENGE FINGERPRINTS

   Every entry is a string that a bot-protection vendor puts on its OWN
   interstitial and that appears nowhere else. That is what earns them the
   right to convict alone: `cf-browser-verification` is not a word a brand
   writes about itself, it is Cloudflare's markup.

   Deliberately NOT here: `g-recaptcha` and `h-captcha`. A captcha widget is
   perfectly normal on a real contact or sign-up page, so it is demoted to a
   corroborating signal that only counts on an otherwise bare page. Treating it
   as a fingerprint would refuse every brand that protects its contact form.
   ═══════════════════════════════════════════════════════════════════════════ */

const VENDORS = [
  {
    id: 'cloudflare', name: 'Cloudflare',
    rx: /cf-browser-verification|__cf_chl_|cf_chl_opt|\/cdn-cgi\/challenge-platform\/|Checking your browser before accessing|Enable JavaScript and cookies to continue/i,
    what: 'a Cloudflare bot challenge',
  },
  {
    // Same vendor, different page: the managed challenge above is an
    // interstitial, this is the outright refusal. They are separate entries
    // because the markup differs, and they carry the SAME id because an
    // operator asking "who blocked me" has one answer either way.
    id: 'cloudflare', name: 'Cloudflare',
    rx: /Attention Required!\s*\|\s*Cloudflare|id=["']cf-error-details["']|Sorry, you have been blocked/i,
    what: 'a Cloudflare block page',
  },
  {
    id: 'incapsula', name: 'Imperva / Incapsula',
    rx: /Incapsula incident ID|_Incapsula_Resource|incident_id["']?\s*[:=]/i,
    what: 'an Imperva (Incapsula) block page',
  },
  {
    id: 'datadome', name: 'DataDome',
    rx: /captcha-delivery\.com|\bdatadome[-.\w]*\.(?:js|co\b)|window\._?[Dd]ata[Dd]ome|dd_cookie_test/i,
    what: 'a DataDome challenge',
  },
  {
    id: 'perimeterx', name: 'PerimeterX / HUMAN',
    rx: /px-captcha|_px(?:AppId|Captcha|hd|Action)\b|perimeterx\.net/i,
    what: 'a PerimeterX (HUMAN) challenge',
  },
  {
    id: 'akamai', name: 'Akamai',
    // Akamai's block page is "Access Denied … Reference #18.abcd1234…". Neither
    // half convicts alone — plenty of pages print a reference number — so this
    // fingerprint is the PAIR, in the order Akamai emits it.
    rx: /access denied[\s\S]{0,600}reference\s*#\s*[0-9a-f]{1,3}\.[0-9a-f]{4,}/i,
    what: 'an Akamai access-denied page',
  },
  {
    id: 'sucuri', name: 'Sucuri',
    rx: /Sucuri WebSite Firewall|sucuri_cloudproxy/i,
    what: 'a Sucuri firewall block page',
  },
  {
    id: 'awswaf', name: 'AWS WAF',
    rx: /awswaf\.com|aws-waf-token/i,
    what: 'an AWS WAF challenge',
  },
  {
    id: 'cloudfront', name: 'CloudFront',
    rx: /ERROR: The request could not be satisfied[\s\S]{0,600}cloudfront/i,
    what: 'a CloudFront error page',
  },
  {
    id: 'kasada', name: 'Kasada',
    rx: /kpsdk-(?:cd|ct|scr)|\/149e9513-01fa-4fb0-aad4-566afd725d1b\//i,
    what: 'a Kasada challenge',
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   2. WORDING

   `block` — phrasing that only an error, refusal or challenge page carries. A
   brand does not title its home page "Access Denied". These convict alone.

   `strong` — error-flavoured phrasing that a real page can plausibly carry
   ("Site Maintenance Services" is a landscaping company's service; "Oops" is a
   playful heading). One is never enough; two, or one plus a structural signal,
   is.

   `weak` — single words that are error-flavoured and nothing more. They exist
   so that a page saying "Error" AND "Oops" is caught, and so that "error" on
   its own is not.
   ═══════════════════════════════════════════════════════════════════════════ */

const PHRASES = [
  // ── block: only ever an error/refusal/challenge page.
  { id: 'access denied', rx: /\baccess (?:is )?denied\b/i, tier: 'block', kind: 'bot_wall' },
  { id: 'access to this page has been denied', rx: /access to this (?:page|site|resource) (?:has been|is) denied/i, tier: 'block', kind: 'bot_wall' },
  { id: 'no permission to access', rx: /(?:don'?t|do not) have permission to access/i, tier: 'block', kind: 'bot_wall' },
  { id: '403 forbidden', rx: /\b403\b[\s|:-]*forbidden|forbidden[\s|:-]*\b403\b/i, tier: 'block', kind: 'bot_wall' },
  { id: 'forbidden', rx: /^\s*forbidden\s*$/i, tier: 'block', kind: 'bot_wall' },
  { id: 'you have been blocked', rx: /(?:you|your ip(?: address)?) (?:have|has) been blocked|blocked your (?:ip|request)/i, tier: 'block', kind: 'bot_wall' },
  { id: 'are you a robot', rx: /are you a (?:robot|human)\b|robot or human/i, tier: 'block', kind: 'bot_wall' },
  { id: 'verify you are human', rx: /verify (?:that )?you(?:'| a)?re (?:a )?human|human verification|verify you are not a robot/i, tier: 'block', kind: 'bot_wall' },
  { id: 'checking your browser', rx: /checking your browser|verifying you are human|please wait while we verify/i, tier: 'block', kind: 'bot_wall' },
  { id: 'just a moment', rx: /^\s*just a moment/i, tier: 'block', kind: 'bot_wall' },
  { id: 'attention required', rx: /attention required/i, tier: 'block', kind: 'bot_wall' },
  { id: 'unusual traffic', rx: /unusual traffic|suspicious activity from your/i, tier: 'block', kind: 'bot_wall' },
  { id: 'bot detected', rx: /\bbot (?:detected|detection)\b|automated (?:traffic|requests?) (?:detected|blocked)/i, tier: 'block', kind: 'bot_wall' },
  { id: 'robot check', rx: /\brobot check\b/i, tier: 'block', kind: 'bot_wall' },
  { id: 'request unsuccessful', rx: /request unsuccessful/i, tier: 'block', kind: 'bot_wall' },
  // The bare numbers are deliberately NOT matched on their own. "429" and "503"
  // are also a street number and a model number, and an API-documentation brand
  // titled "Rate limiting" is a real brand, not a refusal - so each number has
  // to sit next to the wording that makes it a status code.
  { id: 'too many requests', rx: /too many requests|\b429\b[\s|:-]*(?:too many|error)/i, tier: 'block', kind: 'bot_wall' },
  { id: 'service unavailable', rx: /service (?:temporarily )?unavailable|\b503\b[\s|:-]*(?:service|error)/i, tier: 'block', kind: 'error_page' },
  { id: 'temporarily unavailable', rx: /temporarily unavailable|this site is unavailable/i, tier: 'block', kind: 'error_page' },
  { id: 'page not found', rx: /page (?:cannot be found|not found)|\b404\b[\s|:-]*(?:not found|error)|error[\s|:-]*\b404\b/i, tier: 'block', kind: 'not_found_page' },
  { id: 'not found', rx: /^\s*not found\s*$/i, tier: 'block', kind: 'not_found_page' },

  // ── strong: real pages can carry these, so one alone is never a verdict.
  { id: 'site maintenance', rx: /site maintenance|under maintenance|scheduled maintenance|down for maintenance|maintenance mode|maintenance in progress/i, tier: 'strong', kind: 'maintenance_page' },
  { id: 'we will be back', rx: /we(?:'| wi)?ll be (?:back|right back)|be right back|back (?:online )?soon|we are (?:currently )?(?:down|offline)/i, tier: 'strong', kind: 'maintenance_page' },
  { id: 'something went wrong', rx: /something went wrong|an error (?:has )?occurred|we (?:hit|ran into) (?:a|an) (?:snag|problem|error)/i, tier: 'strong', kind: 'error_page' },
  { id: 'oops', rx: /\boops\b|\bwhoops\b|\buh[- ]oh\b/i, tier: 'strong', kind: 'error_page' },
  { id: 'sorry for the inconvenience', rx: /(?:sorry|apologi[sz]e) for (?:any |the )?inconvenience/i, tier: 'strong', kind: 'maintenance_page' },
  { id: 'security check', rx: /security check|security verification|please verify/i, tier: 'strong', kind: 'bot_wall' },
  { id: 'captcha', rx: /\bcaptcha\b/i, tier: 'strong', kind: 'bot_wall' },

  // ── weak: one error-flavoured word, nothing more.
  { id: 'error', rx: /\berrors?\b/i, tier: 'weak', kind: 'error_page' },
  { id: 'unavailable', rx: /\bunavailable\b/i, tier: 'weak', kind: 'error_page' },
  { id: 'blocked', rx: /\bblocked\b/i, tier: 'weak', kind: 'bot_wall' },
  { id: 'try again', rx: /(?:please )?try again (?:later|in a)/i, tier: 'weak', kind: 'error_page' },
];

/* ═══════════════════════════════════════════════════════════════════════════
   3. READING THE PAGE
   Local helpers, so this module stands on its own the way storefront-detect
   does and can be pointed at any HTML by any caller.
   ═══════════════════════════════════════════════════════════════════════════ */

function titleOf(html) {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  return m ? clip(stripTags(m[1]), 300) : '';
}

function headingsOf(html, tag) {
  const out = [];
  const rx = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  for (const m of String(html || '').matchAll(rx)) {
    const t = clip(stripTags(m[1]), 300);
    if (t) out.push(t);
    if (out.length >= 4) break;
  }
  return out;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Robots directives the page declares about ITSELF. */
function metaRobots(html) {
  for (const m of String(html || '').matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/name\s*=\s*["']?robots["']?/i.test(tag)) continue;
    const c = /content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    const v = c && (c[1] != null ? c[1] : (c[2] != null ? c[2] : c[3]));
    if (v) return String(v).toLowerCase();
  }
  return '';
}

/**
 * How much page is actually here. A brand's home page links to its own
 * navigation, its collections and its policies; a block page links to nothing.
 * This is corroboration only and never a verdict on its own — a deliberately
 * minimal one-page site is a real thing and must still onboard.
 */
function shapeOf(html) {
  const body = String(html || '');
  let links = 0;
  for (const m of body.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const href = (m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3])) || '';
    if (/^(?:#|mailto:|tel:|javascript:)/i.test(href.trim())) continue;
    links += 1;
  }
  const stylesheets = (body.match(/<link\b[^>]*rel\s*=\s*["']?[^"'>]*stylesheet/gi) || []).length;
  const text = stripTags(body);
  return {
    links,
    stylesheets,
    inline_style_blocks: (body.match(/<style\b/gi) || []).length,
    text_chars: text.length,
    images: (body.match(/<img\b/gi) || []).length,
    // A real home page has a navigation. Three links and under 1500 characters
    // of copy is not a storefront, whatever it says it is.
    thin: links <= 3 && text.length < 1500,
  };
}

const CAPTCHA_WIDGET = /\bg-recaptcha\b|\bh-captcha\b|hcaptcha\.com|recaptcha\/api\.js|turnstile/i;
const META_REFRESH = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/i;

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE VERDICT ON ONE PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Assess ONE page.
 *
 * `{ html, url, isHome }` — the same shape every collector in brand-extract
 * takes, so this rides the pages the crawl already read and opens no
 * connection of its own.
 *
 * Returns a verdict whether or not the page is blocked, because "we looked and
 * this page is fine" is a reportable state: a check that inspects nothing
 * passes everything, and the caller asserts on how many pages were examined.
 */
function assessPage(ctx) {
  const { html, url, isHome } = ctx || {};
  const body = String(html || '');
  const title = titleOf(body);
  const h1s = headingsOf(body, 'h1');
  const h2s = headingsOf(body, 'h2');
  const shape = shapeOf(body);
  const signals = [];

  // ── vendor fingerprints. Decisive: this is the site's own infrastructure
  //    saying, in its own markup, that it did not serve the site.
  for (const v of VENDORS) {
    const m = v.rx.exec(body);
    if (!m) continue;
    signals.push({
      kind: 'vendor', vendor: v.id, vendor_name: v.name, weight: THRESHOLD,
      where: 'html', evidence: clip(m[0], 120),
      why: `the page carries ${v.what}'s own markup`,
      what: v.what,
    });
  }

  // ── wording, from the TITLE and the HEADINGS only.
  //
  // Body prose is deliberately not read. "Error" in a paragraph is a word in a
  // paragraph, and a reader that counted it would refuse a legitimate brand for
  // writing about error-free service, which is the expensive direction.
  //
  // Each distinct phrase scores ONCE, at its best surface. A page titled and
  // headed the same thing has published one phrase, not two — without that
  // rule, "Site Maintenance Services | GreenAcre" (a real facilities company)
  // scores twice for one phrase and is refused.
  const surfaces = [
    { where: 'html:title', text: title },
    ...h1s.map((t, i) => ({ where: `html:h1${i ? `[${i}]` : ''}`, text: t })),
    // h2 is read only when the page has no h1 at all: a challenge page often
    // has one heading and it is not always an h1. It is never read on a page
    // that has an h1, because a brand's h2s are section headings.
    ...(h1s.length ? [] : h2s.slice(0, 2).map((t, i) => ({ where: `html:h2${i ? `[${i}]` : ''}`, text: t }))),
  ].filter((s) => s.text);

  const byPhrase = new Map();
  for (const p of PHRASES) {
    for (const s of surfaces) {
      const m = p.rx.exec(s.text);
      if (!m) continue;
      const prev = byPhrase.get(p.id);
      if (prev) continue;    // one score per phrase, first (best) surface wins
      byPhrase.set(p.id, {
        kind: 'wording', phrase: p.id, tier: p.tier, page_kind: p.kind,
        weight: W[p.tier], where: s.where, evidence: clip(s.text, 160),
        why: `the page's ${s.where.replace('html:', '')} reads "${clip(s.text, 80)}"`,
      });
    }
  }
  signals.push(...byPhrase.values());

  // ── structural corroboration. Never convicts: the guard below requires a
  //    vendor or wording hit before any of this is allowed to matter.
  const wordingScore = [...byPhrase.values()].reduce((n, s) => n + s.weight, 0);
  const vendorHit = signals.find((s) => s.kind === 'vendor') || null;

  if (shape.thin) {
    signals.push({
      kind: 'structure', weight: W.structural, where: 'page shape',
      evidence: `${shape.links} link(s), ${shape.text_chars} characters of text`,
      why: 'the page carries almost no links and almost no copy, which no storefront home page does',
    });
  }
  if (isHome && /\bnoindex\b/.test(metaRobots(body))) {
    signals.push({
      kind: 'structure', weight: W.structural, where: 'meta:robots',
      evidence: metaRobots(body), why: 'the root page tells search engines not to index it, which a brand does not do to its own front door',
    });
  }
  if (shape.thin && META_REFRESH.test(body)) {
    signals.push({
      kind: 'structure', weight: W.structural, where: 'meta:refresh',
      evidence: clip((META_REFRESH.exec(body) || [''])[0], 120),
      why: 'a bare page that immediately redirects itself',
    });
  }
  if (shape.thin && CAPTCHA_WIDGET.test(body)) {
    // A captcha on a real contact page is normal and is ignored. A captcha on a
    // page with no links and no copy is the page.
    signals.push({
      kind: 'structure', weight: W.structural, where: 'captcha widget',
      evidence: clip((CAPTCHA_WIDGET.exec(body) || [''])[0], 120),
      why: 'a captcha widget on a page that has nothing else on it',
    });
  }

  const structuralScore = signals.filter((s) => s.kind === 'structure').reduce((n, s) => n + s.weight, 0);
  const score = (vendorHit ? THRESHOLD : 0) + wordingScore + structuralScore;

  // THE GUARD. Structure alone never refuses a brand: a minimal one-page site,
  // a JS-rendered shell and a bare landing page are all real, and all thin.
  const convicted = !!vendorHit || (wordingScore > 0 && score >= THRESHOLD);

  const worstWording = [...byPhrase.values()].sort((a, b) => b.weight - a.weight)[0] || null;
  const reason = vendorHit ? 'bot_wall' : (worstWording ? worstWording.page_kind : '');

  return {
    url: url || '',
    blocked: convicted,
    reason: convicted ? reason : '',
    confidence: !convicted ? '' : (vendorHit || (worstWording && worstWording.tier === 'block') ? 'declared' : 'strong'),
    score,
    threshold: THRESHOLD,
    title,
    h1: h1s[0] || '',
    shape,
    signals,
    vendor: vendorHit ? { id: vendorHit.vendor, name: vendorHit.vendor_name, what: vendorHit.what } : null,
    served: describe({ title, h1: h1s[0] || '', shape, vendor: vendorHit }),
  };
}

/** What the site actually handed us, in a sentence an operator can recognise. */
function describe({ title, h1, shape, vendor }) {
  const bits = [];
  if (vendor) bits.push(`${vendor.what} (${vendor.vendor_name})`);
  if (title) bits.push(`a page titled "${clip(title, 120)}"`);
  if (h1 && h1.toLowerCase() !== String(title || '').toLowerCase()) bits.push(`whose first heading reads "${clip(h1, 120)}"`);
  if (!bits.length) bits.push('a page that declares no title and no heading');
  if (shape && shape.thin) bits.push(`carrying ${shape.links} link(s) and ${shape.text_chars} characters of text`);
  return bits.join(', ');
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. THE WHOLE-CRAWL ANSWER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Split the pages a crawl read into the ones that are the brand's and the ones
 * that are somebody's error template.
 *
 * `pages` is `[[url, html], …]` — the shape brand-extract already holds — or an
 * array of `{url, html}`. The first entry is treated as the home page, which is
 * how brand-extract itself defines home (the first page actually READ, not the
 * URL that was asked for).
 *
 * The blocked pages are REMOVED rather than flagged. Flagging them would leave
 * every collector free to read them, and one `if` forgotten downstream puts the
 * defect straight back; removing them means a refused page cannot contribute a
 * brand field because it is not in the list the collectors walk.
 *
 * This is for a caller that already HOLDS a list. `brand-extract` does not use
 * it: its crawl hands pages over one at a time and chains other riders inside
 * that hook, so it calls `assessPage()` per page as the page arrives. Judging
 * afterwards would still have let a refused page reach those riders - the image
 * harvest would have filed a Cloudflare interstitial's graphics as the brand's.
 */
function assessPages(pages, opts) {
  const rows = [];
  for (const entry of (pages || [])) {
    const url = Array.isArray(entry) ? entry[0] : (entry && entry.url);
    const html = Array.isArray(entry) ? entry[1] : (entry && entry.html);
    if (html == null) continue;
    rows.push({ url, html, entry });
  }
  const blocked = [];
  const usable = [];
  const verdicts = [];
  rows.forEach((r, i) => {
    const v = assessPage({ html: r.html, url: r.url, isHome: i === 0 });
    verdicts.push(v);
    if (v.blocked) blocked.push(v);
    else usable.push(Array.isArray(r.entry) ? r.entry : [r.url, r.html]);
  });
  return {
    checked: rows.length,
    verdicts,
    blocked,
    usable,
    // Kept apart on purpose. "Every page we read was a block page" is a refusal;
    // "one of nine was" is a note, and turning the second into the first would
    // refuse a brand because one broken link led to its 404 template.
    all_blocked: rows.length > 0 && usable.length === 0,
    any_blocked: blocked.length > 0,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. THE DIAGNOSIS

   Same shape as brand-extract's diagnoseEmptyCrawl(): { reason, message,
   next_steps }. It names the HOST and quotes what was SERVED, because those are
   the two facts that let an operator tell "I typed the wrong address" apart
   from "my site refuses readers like this one" — and each of those has a
   different next action, which is the whole point of separating the reasons.
   ═══════════════════════════════════════════════════════════════════════════ */

const HAND_ENTRY = 'Fill the brand in by hand below, or start from a template profile. Nothing here is guessed for you, so a few minutes of typing is worth more than a report read off somebody\'s error page.';

function diagnoseSoftError(startUrl, assessment, opts) {
  const o = opts || {};
  const host = (() => { try { return new URL(startUrl).hostname; } catch (_) { return String(startUrl || ''); } })();
  const blocked = (assessment && assessment.blocked) || [];
  const worst = blocked[0] || null;
  const served = worst ? worst.served : 'a page that is not the site';
  const reason = worst ? (worst.reason || 'error_page') : 'error_page';
  const ua = o.userAgent ? ` (it identifies itself as ${String(o.userAgent).split(' ')[0]})` : '';

  const shared = [
    'Nothing from that page was read into your brand. A name or a tagline taken off a block page would be this platform inventing your brand with a real-looking source attached, which is worse than returning nothing.',
    HAND_ENTRY,
  ];

  const canonical = 'Try the exact canonical address your site serves on, including www or its absence and any locale prefix (for example https://www.example.com/en-gb/). A redirect or a regional gate often lands an automated reader somewhere different from a browser.';

  if (reason === 'bot_wall') {
    return {
      reason: 'bot_wall',
      message: `${host} did not show us your site. It answered this reader with ${served}. `
        + 'The request itself succeeded - the site returned HTTP 200 - so nothing failed and nothing timed out: the page we were handed simply is not yours. '
        + 'Large sites routinely refuse datacenter addresses and non-browser readers, and a browser opening the same URL will usually load the real page fine.',
      next_steps: [
        shared[0],
        `If you own this domain, allow this reader through your bot filter${ua} and re-run.`,
        canonical,
        shared[1],
      ],
      host,
      served,
      blocked_pages: blocked.map((v) => v.url).filter(Boolean),
    };
  }
  if (reason === 'maintenance_page') {
    return {
      reason: 'maintenance_page',
      message: `${host} answered with ${served}, delivered as a success (HTTP 200). `
        + 'That is a maintenance or holding page, not your site, and everything this reader could have taken from it - name, tagline, colours, typography, voice - would have been read off it.',
      next_steps: [
        shared[0],
        'Re-run this once the site is serving its real pages again. Nothing is stored from this attempt, so there is nothing to undo.',
        // Said out loud because it is the commonest version of this: a holding
        // page is also what a lot of bot filters serve, and an operator whose
        // browser shows the real site will otherwise assume this report is wrong
        // rather than that their site answered a robot differently.
        `If the site looks fine in your own browser, it is serving this page to automated readers specifically${ua}. If you own the domain, allow this reader through your bot filter and re-run.`,
        canonical,
        shared[1],
      ],
      host,
      served,
      blocked_pages: blocked.map((v) => v.url).filter(Boolean),
    };
  }
  if (reason === 'not_found_page') {
    return {
      reason: 'soft_not_found',
      message: `${host} answered with ${served} - a "not found" page delivered as a success (HTTP 200), which is why this did not simply fail. `
        + 'The address resolved to the site\'s error template rather than to a real page.',
      next_steps: [
        shared[0],
        canonical,
        shared[1],
      ],
      host,
      served,
      blocked_pages: blocked.map((v) => v.url).filter(Boolean),
    };
  }
  return {
    reason: 'soft_error_page',
    message: `${host} answered with ${served}, delivered as a success (HTTP 200) rather than as an error. `
      + 'This reader could not tell that from a real page by its status code, so it read the page, recognised it as an error page and refused to take anything from it.',
    next_steps: [
      shared[0],
      canonical,
      'If the site is temporarily broken, re-run in a few minutes.',
      shared[1],
    ],
    host,
    served,
    blocked_pages: blocked.map((v) => v.url).filter(Boolean),
  };
}

module.exports = {
  assessPage, assessPages, diagnoseSoftError,
  titleOf, headingsOf, stripTags, metaRobots, shapeOf, describe,
  VENDORS, PHRASES, THRESHOLD, WEIGHTS: W,
};
