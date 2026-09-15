/**
 * A PAGE THAT IS NOT THE BRAND'S PAGE, SERVED AS HTTP 200.
 * ---------------------------------------------------------------------------
 * OBSERVED on the live deployment. An operator ran setup-from-URL against a
 * large retailer. The site handed our crawler a maintenance / bot-block page,
 * and handed it over with HTTP 200 - not a 4xx, not a 5xx. The crawl therefore
 * SUCCEEDED, and the extractor faithfully reported what it had been given:
 *
 *     Brand name: "Site Maintenance"            html:title           WEAK
 *     Tagline:    "Oops! Something went wrong"  html:h1(home hero)   WEAK
 *     Logo:       [DATA REQUIRED BEFORE LAUNCH: logo URL, all, all]
 *     Store:      NOT DECLARED
 *
 * Nothing was invented. Both values carried a real source URL and an honest
 * confidence, and that is precisely what makes this the worst output this
 * pipeline can produce: a FABRICATED BRAND IDENTITY wearing real provenance.
 * `diagnoseEmptyCrawl()` already classified every HARD failure - 403, 404, 5xx,
 * DNS, robots - and fires only when the crawl read NOTHING. The dangerous case
 * is the opposite one: we read something, and it is not the brand.
 *
 * ── WHAT THIS GATE ASSERTS ─────────────────────────────────────────────────
 * Both directions, because only one of them is cheap to get wrong in review:
 *
 *   REFUSE   the live shape above, plus one fixture per vendor challenge
 *            fingerprint, must yield NO name, NO tagline, NO palette and NO
 *            voice, and must yield a diagnosis naming the host and quoting what
 *            was served.
 *   EXTRACT  a real brand page that happens to contain the word "error" in its
 *            prose, and a real facilities company whose title AND heading both
 *            read "Site Maintenance Services", must extract normally under
 *            their real names. A wrongly-refused extraction blocks a legitimate
 *            brand from onboarding at all, and the operator cannot argue with
 *            it - false positives here are the expensive direction.
 *
 * Every test EXECUTES the extractor over fixtures through an injected
 * `fetchImpl`, and one drives the shipped `?op=extract` router end to end.
 * Nothing asserts on the source of any module.
 *
 * Run: npx playwright test tests/soft-error-pages.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const bx = require('../api/_shared/brand-extract.js');
const se = require('../api/_shared/soft-error-detect.js');

const HOST = 'https://www.retailer.example';

const htmlPage = (b) => ({ body: b, contentType: 'text/html; charset=utf-8' });
const txt = (b) => ({ body: b, contentType: 'text/plain' });
const sheet = (b) => ({ body: b, contentType: 'text/css' });

const fetchOf = (site, log) => async (u) => {
  const k = String(u).split('#')[0];
  if (log) log.push(k);
  const row = site[k] || site[k.replace(/\/$/, '')];
  return row
    ? { ok: true, status: 200, body: row.body, url: k, contentType: row.contentType }
    : { ok: false, status: 404, body: '', url: k, contentType: 'text/plain' };
};

const ROBOTS = txt('User-agent: *\nAllow: /\n');

/** Extract a whole brand from a fixture site, with no model call. */
const run = (site, log) => bx.extractBrand(`${HOST}/`, { fetchImpl: fetchOf(site, log), voice: false });

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE EXACT LIVE SHAPE
   ═══════════════════════════════════════════════════════════════════════════ */

// Reproduced from the report the operator was shown: 200 OK, a title that is
// the words "Site Maintenance", an h1 that apologises, and almost nothing else.
const MAINTENANCE_200 = `<!doctype html><html><head>
<meta charset="utf-8"><title>Site Maintenance</title>
<style>body{font-family:Arial;background:#0A0A0A;color:#FFFFFF;text-align:center}</style>
</head><body><div class="wrap"><h1>Oops! Something went wrong</h1>
<p>We are working on it. Please try again in a few minutes.</p></div></body></html>`;

test('a maintenance page served as 200 does not become a brand name and a tagline', async () => {
  const report = await run({ [`${HOST}/`]: htmlPage(MAINTENANCE_200), [`${HOST}/robots.txt`]: ROBOTS });

  // The two values the live run produced, asserted absent.
  expect(report.fields.name.value, 'a block page supplied the brand name').toBeNull();
  expect(report.fields.tagline.value, 'a block page supplied the tagline').toBeNull();
  expect(report.fields.name.candidates).toHaveLength(0);
  expect(report.fields.tagline.candidates).toHaveLength(0);

  // And the strongest form of the same claim: neither string survives anywhere
  // in the fields at all, under any signal, at any confidence.
  const fields = JSON.stringify(report.fields);
  expect(fields).not.toContain('Site Maintenance');
  expect(fields).not.toContain('Something went wrong');

  // The gap is REPORTED as the spec's marker, not left as an empty string that
  // reads like a brand with no name.
  expect(report.fields.name.marker).toMatch(/DATA REQUIRED BEFORE LAUNCH: brand name/);
});

test('the refusal comes with a diagnosis naming the host and what was served', async () => {
  const report = await run({ [`${HOST}/`]: htmlPage(MAINTENANCE_200), [`${HOST}/robots.txt`]: ROBOTS });

  expect(report.diagnosis, 'an empty report with no explanation reads as "this brand publishes nothing"').toBeTruthy();
  // Same shape as diagnoseEmptyCrawl, so the wizard renders one thing.
  expect(report.diagnosis.reason).toBe('maintenance_page');
  expect(typeof report.diagnosis.message).toBe('string');
  expect(Array.isArray(report.diagnosis.next_steps)).toBe(true);
  expect(report.diagnosis.next_steps.length).toBeGreaterThan(1);

  // The host, because that is the value an operator checks first.
  expect(report.diagnosis.message).toContain('www.retailer.example');
  // What was served, quoted back, so they can recognise it.
  expect(report.diagnosis.message).toContain('Site Maintenance');
  expect(report.diagnosis.message).toContain('Oops! Something went wrong');
  // And that it was a SUCCESS, which is the whole reason this was invisible.
  expect(report.diagnosis.message).toMatch(/HTTP 200|as a success/i);

  // The two actions that actually resolve it.
  const steps = report.diagnosis.next_steps.join(' ');
  expect(steps, 'the operator is not told they can enter the brand by hand').toMatch(/by hand|template profile/i);
  expect(steps, 'the canonical-URL retry is not offered').toMatch(/canonical address|exact/i);
  expect(steps, 'an operator whose browser shows the real site is not told why').toMatch(/automated readers|bot filter/i);
});

test('the report says how many pages it examined, and which one it refused', async () => {
  // A check that inspects nothing passes everything, so the count is part of
  // the answer, not decoration.
  const report = await run({ [`${HOST}/`]: htmlPage(MAINTENANCE_200), [`${HOST}/robots.txt`]: ROBOTS });

  expect(report.integrity.checked).toBe(1);
  expect(report.integrity.usable).toBe(0);
  expect(report.integrity.blocked).toHaveLength(1);
  expect(report.integrity.blocked[0].url).toBe(`${HOST}/`);
  expect(report.integrity.blocked[0].title).toBe('Site Maintenance');
  expect(report.integrity.blocked[0].h1).toBe('Oops! Something went wrong');

  // The page WAS fetched; it simply contributed nothing. Collapsing those two
  // numbers would hide the difference between a site that refused us and a site
  // that was never reached.
  expect(report.pages_fetched).toBe(1);
  expect(report.pages_visited).toBe(0);
  expect(report.pages).toHaveLength(0);
});

test('a refused page contributes no colours and no typography either', async () => {
  // The identity fields are the visible half. A palette read off a block page's
  // own stylesheet is the same fabrication wearing a hex code - and this one
  // would have proposed a near-black ground, which validatePalette blocks
  // activation on, so the operator would have been told THEIR brand was invalid.
  const site = {
    [`${HOST}/`]: htmlPage(MAINTENANCE_200.replace('</head>', '<link rel="stylesheet" href="/err.css"></head>')),
    [`${HOST}/err.css`]: sheet(':root{--brand-primary:#B00020;--brand-surface:#0A0A0A}h1{font-family:"ErrorFont",Arial;font-size:40px}'),
    [`${HOST}/robots.txt`]: ROBOTS,
  };
  const log = [];
  const report = await run(site, log);

  expect(report.fields.palette.proposed.primary || '').toBe('');
  expect(report.fields.typography.heading).toHaveLength(0);
  expect(JSON.stringify(report.fields)).not.toContain('ErrorFont');
  expect(JSON.stringify(report.fields).toLowerCase()).not.toContain('b00020');
  // The stylesheet is not even fetched: the page it was declared on is not in
  // the list the collectors walk, so there is nothing to fetch it from.
  expect(log).not.toContain(`${HOST}/err.css`);
});

test('no language model is called when every page read was a block page', async () => {
  // Voice is the one LLM call in the extractor. Calling it on a corpus of block
  // page copy would spend a real key to describe the tone of voice of a
  // Cloudflare interstitial - and could return a "tone" attributed to the brand.
  const LLM = require.resolve('../api/_shared/llm.js');
  const real = require.cache[LLM];
  let calls = 0;
  const stub = async function callLLM() { calls += 1; throw new Error('a provider must not be called here'); };
  stub.parseJSON = (t) => JSON.parse(t);
  require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: stub };
  try {
    const report = await bx.extractBrand(`${HOST}/`, {
      fetchImpl: fetchOf({ [`${HOST}/`]: htmlPage(MAINTENANCE_200), [`${HOST}/robots.txt`]: ROBOTS }),
      voice: true,          // explicitly ASKED for, and still must not happen
    });
    expect(calls, 'a model was briefed with the copy of a block page').toBe(0);
    expect(report.fields.voice.value).toBeNull();
    expect(report.fields.voice.marker).toMatch(/DATA REQUIRED BEFORE LAUNCH: voice\.tone/);
  } finally {
    if (real) require.cache[LLM] = real; else delete require.cache[LLM];
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. ONE FIXTURE PER VENDOR CHALLENGE FINGERPRINT

   Each of these is a string the vendor puts on its OWN interstitial and that
   appears nowhere else, which is what earns it the right to convict on its own.
   The pages are deliberately as thin and as wordless as the real ones: several
   carry no error phrasing at all in their title or heading, so the fingerprint
   is the ONLY thing standing between the operator and a brand read off it.
   ═══════════════════════════════════════════════════════════════════════════ */

const VENDOR_PAGES = [
  ['Cloudflare managed challenge', 'cloudflare', `<!doctype html><html><head><title>Just a moment...</title></head>
    <body><div id="cf-wrapper"><noscript>Enable JavaScript and cookies to continue</noscript>
    <script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></div></body></html>`],

  ['Cloudflare block page', 'cloudflare', `<!doctype html><html><head><title>Attention Required! | Cloudflare</title></head>
    <body><h1>Sorry, you have been blocked</h1><div id="cf-error-details">Ray ID: 8f0a</div></body></html>`],

  ['Imperva / Incapsula', 'incapsula', `<!doctype html><html><head>
    <title>Request unsuccessful. Incapsula incident ID: 618000-123456789</title></head>
    <body><iframe src="/_Incapsula_Resource?SWCGHOEL=v2"></iframe></body></html>`],

  ['DataDome', 'datadome', `<!doctype html><html><head><title>www.retailer.example</title></head>
    <body><script src="https://geo.captcha-delivery.com/captcha/?initialCid=AHrl"></script></body></html>`],

  ['PerimeterX / HUMAN', 'perimeterx', `<!doctype html><html><head><title>Access to this page has been denied</title></head>
    <body><div id="px-captcha"></div><script>window._pxAppId = "PXabc123";</script></body></html>`],

  ['Akamai', 'akamai', `<!doctype html><html><head><title>Access Denied</title></head><body><h1>Access Denied</h1>
    <p>You don't have permission to access "http://www.retailer.example/" on this server.</p>
    <p>Reference #18.abcd1234.1700000000.deadbeef</p></body></html>`],

  ['Sucuri', 'sucuri', `<!doctype html><html><head><title>Sucuri WebSite Firewall - Access Denied</title></head>
    <body><h1>Access Denied - Sucuri Website Firewall</h1></body></html>`],

  ['AWS WAF', 'awswaf', `<!doctype html><html><head><title>www.retailer.example</title></head>
    <body><script src="https://abc123.awswaf.com/abc123/challenge.js"></script></body></html>`],

  ['CloudFront', 'cloudfront', `<!doctype html><html><head><title>ERROR: The request could not be satisfied</title></head>
    <body><h1>403 ERROR</h1><p>The request could not be satisfied. Request blocked.</p>
    <p>Generated by cloudfront (CloudFront) Request ID: abc</p></body></html>`],

  ['Kasada', 'kasada', `<!doctype html><html><head><title>www.retailer.example</title></head>
    <body><script src="/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39/p.js"></script></body></html>`],
];

for (const [label, vendorId, markup] of VENDOR_PAGES) {
  test(`${label}: the challenge page is refused, not read as the brand`, async () => {
    const report = await run({ [`${HOST}/`]: htmlPage(markup), [`${HOST}/robots.txt`]: ROBOTS });

    expect(report.fields.name.value, `${label} supplied a brand name`).toBeNull();
    expect(report.fields.tagline.value, `${label} supplied a tagline`).toBeNull();
    expect(report.integrity.blocked, `${label} was read as the brand's own page`).toHaveLength(1);

    const verdict = report.integrity.blocked[0];
    expect(verdict.vendor, `${label} was caught by wording alone, not by its fingerprint`).toBeTruthy();
    expect(verdict.vendor.id).toBe(vendorId);
    // A fingerprint is the vendor's own markup, so the verdict is `declared`,
    // the same confidence band a site declaring its own platform earns.
    expect(verdict.confidence).toBe('declared');

    expect(report.diagnosis).toBeTruthy();
    expect(report.diagnosis.reason).toBe('bot_wall');
    expect(report.diagnosis.message).toContain('www.retailer.example');
    // The sentence that stops an operator concluding their site is broken.
    expect(report.diagnosis.message).toMatch(/a browser opening the same URL will usually load the real page/i);
    expect(report.diagnosis.next_steps.join(' ')).toMatch(/bot filter/i);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. THE EXPENSIVE DIRECTION: A REAL BRAND MUST STILL EXTRACT

   A wrongly-refused extraction blocks a legitimate brand from onboarding, and
   the operator has no way to argue with it. Every fixture below is a real page
   that a naive detector would refuse.
   ═══════════════════════════════════════════════════════════════════════════ */

const REAL_COPY = `<nav><a href="/shop">Shop</a><a href="/about">About</a><a href="/journal">Journal</a>
<a href="/contact">Contact</a><a href="/policies/terms">Terms</a><a href="/collections/new">New in</a></nav>
<p>We have blended single-origin tea in Bristol since 2011, and every order is packed by hand on the
day it leaves us. We ship worldwide, and delivery is free over thirty pounds. Our blenders have
worked with the same three estates for a decade and visit each of them twice a year.</p>`;

const REAL_HEAD = `<meta property="og:site_name" content="Northwind Tea">
<meta name="description" content="Single-origin tea, blended in Bristol since 2011.">
<link rel="stylesheet" href="/theme.css">`;

const THEME = sheet(
  ':root{--brand-primary:#2E6F5E;--brand-accent:#D98A3A;--brand-ink:#15201C;--brand-surface:#FBFAF6}'
  + 'h1{font-family:"Canela",Georgia,serif;font-size:44px;font-weight:600;color:#15201C}'
  + 'body{font-family:"Inter",system-ui;font-size:16px;color:#15201C;background:#FBFAF6}',
);

test('a real brand page that contains the word "error" in its prose extracts normally', async () => {
  // The exact false positive this design exists to avoid, and the fixture is
  // deliberately the WORST legitimate case rather than a mild one: a brand with
  // its own help copy on the home page carries "something went wrong", "oops"
  // and "error" in ordinary prose, and TWO FAQ sub-headings that ask the
  // question in those words. Read as wording, that is a refusal three times
  // over. Read as what it is - a paragraph and two h2s on a page whose title
  // and h1 are the brand's own name - it is a tea company. (h2 is read only on
  // a page that has no h1 at all: a challenge page often has one heading and it
  // is not always an h1, but a brand's h2s are its section headings.)
  //
  // A milder fixture would pass even with body prose counted, which is exactly
  // what the first version of this test did: the mutation that reads the body
  // did not fail it, so it was not testing the rule at all.
  const markup = `<!doctype html><html><head><title>Northwind Tea</title>${REAL_HEAD}</head>
    <body><h1>Northwind Tea</h1>${REAL_COPY}
    <h2>Something went wrong with my order</h2>
    <h2>Oops, wrong size?</h2>
    <p>Tell us within thirty days and we will put it right. If you saw an error at
    checkout, your card was not charged: try again, or email us and we will take the order by hand.
    We keep an error log for every roast, so a batch that misses our standard never reaches a
    customer, and nothing is unavailable for long because we re-blend within the week.</p></body></html>`;

  const report = await run({
    [`${HOST}/`]: htmlPage(markup), [`${HOST}/theme.css`]: THEME, [`${HOST}/robots.txt`]: ROBOTS,
  });

  expect(report.integrity.blocked, 'a real brand page was refused for the word "error"').toHaveLength(0);
  expect(report.diagnosis).toBeNull();
  expect(report.fields.name.value).toBe('Northwind Tea');
  expect(report.fields.tagline.value).toBe('Single-origin tea, blended in Bristol since 2011.');
  // And the rest of the extraction is untouched, not merely un-refused.
  expect(report.fields.palette.proposed.primary.toLowerCase()).toBe('#2e6f5e');
  expect(report.fields.typography.heading[0].value).toBe('Canela');
  expect(report.integrity.checked).toBe(1);
  expect(report.integrity.note).toMatch(/None of them was an error, maintenance or bot-challenge page/i);
});

test('a brand whose title AND heading both read "Site Maintenance Services" extracts normally', async () => {
  // A facilities company. Both surfaces carry the same error-flavoured phrase,
  // which is exactly what the live block page did - so the rule cannot be "two
  // surfaces agree". Each distinct PHRASE scores once, at its best surface, and
  // one ambiguous phrase is never a verdict.
  const markup = `<!doctype html><html><head><title>Site Maintenance Services | GreenAcre</title>
    <meta property="og:site_name" content="GreenAcre">
    <meta name="description" content="Grounds and site maintenance for commercial estates.">
    <link rel="stylesheet" href="/theme.css"></head>
    <body><h1>Site Maintenance Services</h1>${REAL_COPY}</body></html>`;

  const report = await run({
    [`${HOST}/`]: htmlPage(markup), [`${HOST}/theme.css`]: THEME, [`${HOST}/robots.txt`]: ROBOTS,
  });

  expect(report.integrity.blocked, 'a real facilities company was refused for its own service name').toHaveLength(0);
  expect(report.diagnosis).toBeNull();
  expect(report.fields.name.value).toBe('GreenAcre');
  expect(report.fields.palette.proposed.primary.toLowerCase()).toBe('#2e6f5e');
});

test('an ordinary brand page with an ordinary heading extracts normally', async () => {
  const markup = `<!doctype html><html><head><title>Northwind Tea | Single-origin blends</title>${REAL_HEAD}</head>
    <body><h1>Blended in Bristol since 2011</h1>${REAL_COPY}</body></html>`;

  const report = await run({
    [`${HOST}/`]: htmlPage(markup), [`${HOST}/theme.css`]: THEME, [`${HOST}/robots.txt`]: ROBOTS,
  });

  expect(report.integrity.blocked).toHaveLength(0);
  expect(report.diagnosis).toBeNull();
  expect(report.fields.name.value).toBe('Northwind Tea');
  expect(report.fields.tagline.value).toBe('Single-origin tea, blended in Bristol since 2011.');
});

test('a captcha widget on a real contact page is not a challenge page', async () => {
  // reCAPTCHA on a contact form is normal. Treating a captcha widget as a
  // fingerprint would refuse every brand that protects its own forms, so it
  // only counts on a page that has nothing else on it.
  const markup = `<!doctype html><html><head><title>Northwind Tea</title>${REAL_HEAD}</head>
    <body><h1>Northwind Tea</h1>${REAL_COPY}
    <form><div class="g-recaptcha" data-sitekey="abc"></div><button>Send</button></form></body></html>`;

  const report = await run({
    [`${HOST}/`]: htmlPage(markup), [`${HOST}/theme.css`]: THEME, [`${HOST}/robots.txt`]: ROBOTS,
  });
  expect(report.integrity.blocked).toHaveLength(0);
  expect(report.fields.name.value).toBe('Northwind Tea');
});

test('a deliberately minimal one-page site is thin, and thin is not a verdict', async () => {
  // Structural signals corroborate and can never convict. A one-page studio
  // site has no navigation and almost no copy, and it is still a real brand.
  const markup = `<!doctype html><html><head><title>Ora Studio</title>
    <meta property="og:site_name" content="Ora Studio">
    <meta name="description" content="Hand-thrown ceramics, Lisbon."></head>
    <body><h1>Ora Studio</h1><p>Ceramics, Lisbon.</p></body></html>`;

  const report = await run({ [`${HOST}/`]: htmlPage(markup), [`${HOST}/robots.txt`]: ROBOTS });
  expect(report.integrity.blocked).toHaveLength(0);
  expect(report.fields.name.value).toBe('Ora Studio');
});

test('one broken link to a 404 template does not refuse the whole brand', async () => {
  // "Every page we read was a block page" is a refusal. "One of three was" is a
  // note - and turning the second into the first would refuse a brand because a
  // stale link led to its own soft-404 page.
  const site = {
    [`${HOST}/`]: htmlPage(`<!doctype html><html><head><title>Northwind Tea</title>${REAL_HEAD}</head>
      <body><h1>Northwind Tea</h1>${REAL_COPY}<a href="/stale">Old page</a></body></html>`),
    [`${HOST}/stale`]: htmlPage('<!doctype html><html><head><title>404 Not Found</title></head>'
      + '<body><h1>Page not found</h1><p>Sorry, we could not find that.</p></body></html>'),
    [`${HOST}/about`]: htmlPage('<!doctype html><html><head><title>About | Northwind Tea</title></head>'
      + '<body><h1>About</h1><p>Northwind Tea Ltd, 4 Harbour Road, Bristol.</p></body></html>'),
    [`${HOST}/theme.css`]: THEME,
    [`${HOST}/robots.txt`]: ROBOTS,
  };
  const report = await run(site);

  expect(report.fields.name.value).toBe('Northwind Tea');
  expect(report.diagnosis, 'one soft 404 refused an otherwise readable brand').toBeNull();
  expect(report.integrity.blocked).toHaveLength(1);
  expect(report.integrity.blocked[0].url).toBe(`${HOST}/stale`);
  expect(report.integrity.blocked[0].reason).toBe('not_found_page');
  // The soft-404 page is out of the set the collectors walked.
  expect(report.pages).not.toContain(`${HOST}/stale`);
  expect(report.pages).toContain(`${HOST}/about`);
  expect(report.integrity.usable).toBe(report.pages.length);
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE SHIPPED ENTRY POINT

   The operator does not call extractBrand(); they POST to the brand router.
   This drives `?op=extract` with a real req/res pair, through runExtract and
   its SSRF guard, which is what an operator actually reaches.
   ═══════════════════════════════════════════════════════════════════════════ */

function mockRes() {
  const out = { code: 0, body: null, headers: {} };
  const res = {
    status(c) { out.code = c; return res; },
    json(b) { out.body = b; return res; },
    setHeader(k, v) { out.headers[k] = v; },
    end() { return res; },
  };
  return { res, out };
}

test('the shipped ?op=extract route refuses a soft-error page too', async () => {
  const CORE = require.resolve('../api/_shared/brand-workspace-core.js');
  const EXTRACT = require.resolve('../api/_shared/brand-extract.js');
  const SOFT = require.resolve('../api/_shared/soft-error-detect.js');
  for (const m of [CORE, EXTRACT, SOFT]) delete require.cache[m];

  // assertPublicUrl() resolves the hostname for real, and a fixture host has no
  // DNS record. Everything else about the SSRF guard runs untouched.
  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  dns.lookup = async (host, opts) => (String(host).endsWith('.example')
    ? [{ address: '93.184.216.34', family: 4 }]
    : realLookup(host, opts));

  const site = {
    [`${HOST}/`]: { ct: 'text/html', payload: MAINTENANCE_200 },
    [`${HOST}/robots.txt`]: { ct: 'text/plain', payload: 'User-agent: *\nAllow: /\n' },
  };
  const realFetch = global.fetch;
  global.fetch = async (u) => {
    const s = String(u);
    // A paused project: the auth host does not resolve, so the call throws.
    // That is the branch on which `?op=extract` is reachable without a session.
    if (/\/auth\/v1\//.test(s)) throw new Error('getaddrinfo ENOTFOUND paused.supabase.co');
    const k = s.split('#')[0];
    const row = site[k] || site[k.replace(/\/$/, '')];
    return row
      ? { ok: true, status: 200, url: k, headers: { get: () => row.ct }, text: async () => row.payload, json: async () => ({}) }
      : { ok: false, status: 404, url: k, headers: { get: () => 'text/plain' }, text: async () => '', json: async () => ({}) };
  };

  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://paused.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key-for-test';

  try {
    const core = require(CORE);
    const { res, out } = mockRes();
    await core.handle({
      method: 'POST',
      url: '/api/public-config?action=brand&op=extract',
      headers: { 'content-type': 'application/json', authorization: 'Bearer a-stale-token' },
      query: { action: 'brand', op: 'extract' },
      body: { url: HOST },
    }, res);

    expect(out.code).toBe(200);
    expect(out.body.ok).toBe(true);
    // The two values the live run put in front of the operator.
    expect(out.body.fields.name.value).toBeNull();
    expect(out.body.fields.tagline.value).toBeNull();
    expect(JSON.stringify(out.body.fields)).not.toContain('Site Maintenance');
    // And an explanation reaches the browser, not an empty form.
    expect(out.body.diagnosis).toBeTruthy();
    expect(out.body.diagnosis.message).toContain('www.retailer.example');
    expect(out.body.integrity.blocked).toHaveLength(1);
  } finally {
    global.fetch = realFetch;
    dns.lookup = realLookup;
    if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = savedKey;
    for (const m of [CORE, EXTRACT, SOFT]) delete require.cache[m];
  }
});

test('the image harvest reports a blocked site as unreadable, in the right words', async () => {
  // brand-harvest rides extractBrand, so a fully-blocked site reaches its
  // `reachable:false` branch for the first time. Its standing sentence there -
  // "the crawl did not complete. Run this from an environment that can reach
  // the public internet" - is right for a dead network and wrong here: this
  // crawl completed perfectly, and it would send the operator to fix the one
  // thing that is working.
  const harvest = require('../api/_shared/brand-harvest.js');
  const site = { [`${HOST}/`]: htmlPage(MAINTENANCE_200), [`${HOST}/robots.txt`]: ROBOTS };
  const out = await harvest.harvest(`${HOST}/`, { fetchImpl: fetchOf(site), voice: false });

  expect(out.reachable).toBe(false);
  expect(out.images).toHaveLength(0);
  expect(out.diagnosis).toBeTruthy();
  expect(out.diagnosis.reason).toBe('maintenance_page');
  expect(out.note).toContain('Site Maintenance');
  expect(out.note).not.toMatch(/the crawl did not complete/i);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. THE CORROBORATION RULE, DRIVEN DIRECTLY

   The scoring is the whole design, so it is exercised rather than described.
   ═══════════════════════════════════════════════════════════════════════════ */

test('one ambiguous phrase is not a verdict; two are', async () => {
  const one = se.assessPage({
    isHome: true, url: `${HOST}/`,
    html: '<html><head><title>Site Maintenance Services | GreenAcre</title></head>'
      + '<body><h1>Site Maintenance Services</h1><p>Grounds care for commercial estates across the '
      + 'south west, with a named supervisor on every contract and a published response time.</p>'
      + '<a href="/contact">Contact</a><a href="/services">Services</a><a href="/about">About</a>'
      + '<a href="/cases">Case studies</a></body></html>',
  });
  expect(one.blocked).toBe(false);

  const two = se.assessPage({
    isHome: true, url: `${HOST}/`,
    html: '<html><head><title>Site Maintenance</title></head><body><h1>Oops! Something went wrong</h1></body></html>',
  });
  expect(two.blocked).toBe(true);
});

test('structure alone never refuses a brand, however thin the page', async () => {
  // Weightless on its own by construction: a verdict requires a vendor
  // fingerprint or a wording hit before any structural signal is allowed to
  // count. A JS-rendered shell, a splash page and a one-page site are all thin.
  const v = se.assessPage({
    isHome: true, url: `${HOST}/`,
    html: '<html><head><title>Ora</title><meta name="robots" content="noindex">'
      + '<meta http-equiv="refresh" content="0;url=/en"></head><body><div id="root"></div></body></html>',
  });
  expect(v.shape.thin).toBe(true);
  expect(v.signals.filter((s) => s.kind === 'structure').length).toBeGreaterThan(1);
  expect(v.blocked, 'a thin page with no error wording was refused').toBe(false);
});

test('the list API splits a set of pages into the brand\'s and somebody\'s error template', async () => {
  // assessPages() is for a caller that already holds a page list. brand-extract
  // does not use it - its crawl hands pages over one at a time and chains other
  // riders inside that hook, so it judges each page as it arrives - but the
  // whole-list rule (all blocked is a refusal, some blocked is a note) is the
  // same one and is asserted here directly.
  const out = se.assessPages([
    [`${HOST}/`, `<html><head><title>Northwind Tea</title></head><body><h1>Northwind Tea</h1>${REAL_COPY}</body></html>`],
    [`${HOST}/stale`, '<html><head><title>404 Not Found</title></head><body><h1>Page not found</h1></body></html>'],
  ]);
  expect(out.checked).toBe(2);
  expect(out.usable).toHaveLength(1);
  expect(out.usable[0][0]).toBe(`${HOST}/`);
  expect(out.blocked).toHaveLength(1);
  expect(out.any_blocked).toBe(true);
  expect(out.all_blocked).toBe(false);

  const none = se.assessPages([[`${HOST}/`, '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/x"></script></body></html>']]);
  expect(none.all_blocked).toBe(true);
  expect(none.usable).toHaveLength(0);
});

test('a status code cannot tell these apart, which is why the body is read', async () => {
  // Both fixtures answer 200. The only difference is what is ON them.
  const ok = se.assessPage({ isHome: true, url: `${HOST}/`, html: `<html><head><title>Northwind Tea</title></head><body><h1>Northwind Tea</h1>${REAL_COPY}</body></html>` });
  const wall = se.assessPage({ isHome: true, url: `${HOST}/`, html: '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/x"></script></body></html>' });
  expect(ok.blocked).toBe(false);
  expect(wall.blocked).toBe(true);
  expect(wall.vendor.id).toBe('cloudflare');
});
