/**
 * robots.txt and the app must agree on what is public.
 * ---------------------------------------------------------------------------
 * The portfolio audit: "the homepage sells a universal brand OS ... and
 * robots.txt calls it 'a private, sign-in-gated internal tool, not a public
 * website'."
 *
 * That was not a positioning disagreement to be settled by taste. auth.js
 * `isOpenPage()` returns true for the homepage with a comment saying it MUST be
 * publicly viewable for Google's OAuth review, and robots.txt disallowed it —
 * so the one page written to be found could not be, while the privacy and terms
 * pages beside it were already excepted for that same review.
 *
 * Two directions of drift are possible and both are bad, so both are tested:
 *   - allowed here but gated in auth.js  -> an indexed login wall
 *   - open in auth.js and needed for the OAuth review but disallowed here
 *     -> the original defect
 *
 * The rules are PARSED and EVALUATED against paths, not grepped for. A
 * substring check would pass on a commented-out line, and it cannot tell
 * `Allow: /$` from `Allow: /`.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const robotsText = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');

/** Directives for `User-agent: *`, comments and blank lines discarded. */
function parseRobots(text) {
  const rules = [];
  let inStar = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === 'user-agent') { inStar = value === '*'; continue; }
    if (!inStar) continue;
    if (field === 'allow' || field === 'disallow') rules.push({ type: field, value });
  }
  return rules;
}

/**
 * Longest-match-wins, Allow beats Disallow on a tie — the rule Google and Bing
 * both document. `$` anchors the end of the path; `*` is a wildcard.
 */
function matchLength(pattern, url) {
  if (pattern === '') return -1;
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const rx = new RegExp('^' + body.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return rx.test(url) ? body.length : -1;
}

function isAllowed(url, rules) {
  let best = null;
  for (const r of rules) {
    const len = matchLength(r.value, url);
    if (len < 0) continue;
    if (!best || len > best.len || (len === best.len && r.type === 'allow')) best = { len, type: r.type };
  }
  return !best || best.type === 'allow';
}

const RULES = parseRobots(robotsText);

test('the parser actually found rules — a check that reads nothing passes everything', () => {
  expect(RULES.length).toBeGreaterThanOrEqual(5);
  expect(RULES.some((r) => r.type === 'allow')).toBe(true);
  expect(RULES.some((r) => r.type === 'disallow')).toBe(true);
});

test('the pages the app serves signed-out for the OAuth review are crawlable', () => {
  // auth.js isOpenPage() hard-codes these three, each with a comment saying
  // why. If that list changes, this test should change with it deliberately.
  for (const url of ['/', '/index.html', '/about', '/about.html', '/privacy.html', '/terms.html']) {
    expect(isAllowed(url, RULES), `${url} must be crawlable`).toBe(true);
  }
});

test('every gated page stays out of the index', () => {
  const gated = ['/dashboard.html', '/calendar.html', '/credits', '/credits.html',
    '/onboarding', '/brain', '/publishing', '/connections', '/telesuite',
    '/api/public-config', '/lp/abc123', '/kicksgpt'];
  for (const url of gated) {
    expect(isAllowed(url, RULES), `${url} must not be crawlable`).toBe(false);
  }
});

test('robots.txt no longer claims the product has no public page', () => {
  // The exact sentence the audit quoted. It cannot be true of a product whose
  // homepage is deliberately anonymous-viewable and sells the thing.
  expect(robotsText).not.toMatch(/not a public website/i);
  expect(robotsText).not.toMatch(/internal (growth|tool)/i);
});

test('robots.txt names no single tenant', () => {
  // It used to call one tenant's shop "the live customer store". This platform
  // runs as whichever brand a user onboards; that is not a fact about it.
  const body = robotsText.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  expect(body).not.toMatch(/knickgasm/i);
  // Even the explanatory comments must not reassert it as current fact.
  expect(robotsText).not.toMatch(/the live customer store is/i);
});

test('auth.js and robots.txt have not drifted apart on the homepage', () => {
  const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  // The rule robots.txt is written against. If this disappears from auth.js,
  // the homepage is no longer public and robots.txt is wrong again — in the
  // other direction.
  expect(auth).toMatch(/isOpenPage/);
  expect(auth).toMatch(/HOMEPAGE must be publicly viewable/i);
  expect(auth).toContain("(privacy|terms|sitemap|about)");
});

test('the sitemap lists only URLs robots.txt allows', () => {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
  expect(locs.length).toBeGreaterThan(0);
  for (const loc of locs) {
    const u = new URL(loc);
    // One canonical origin. A sitemap on a second host is a second front door.
    expect(u.host, `${loc}`).toBe('lifecycle-os.anchit-tandon.com');
    expect(isAllowed(u.pathname, RULES), `${loc} is in the sitemap but disallowed`).toBe(true);
  }
});

test('the sitemap robots.txt advertises is the one that exists', () => {
  const declared = (robotsText.match(/^\s*Sitemap:\s*(\S+)\s*$/im) || [])[1];
  expect(declared, 'robots.txt must advertise a sitemap').toBeTruthy();
  expect(new URL(declared).pathname).toBe('/sitemap.xml');
  expect(fs.existsSync(path.join(ROOT, 'sitemap.xml'))).toBe(true);
});

test('the indexable homepage names one canonical origin', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
  expect(m, 'the one indexable page must declare a canonical URL').toBeTruthy();
  const href = (m[0].match(/href=["']([^"']+)["']/) || [])[1];
  expect(new URL(href).host).toBe('lifecycle-os.anchit-tandon.com');
  // Public OAuth homepage must visibly explain the Google profile data it uses
  // and link to the same privacy policy declared for OAuth review.
  expect(html).toContain('id="google-signin-heading"');
  expect(html).toContain('Google sign-in does not give Lifecycle OS access');
  expect(html).toContain('href="/privacy"');
});

test('the HTML sitemap uses the exact public route and is available through the Vercel rewrite', () => {
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  expect(routes.rewrites).toContainEqual({ source: '/sitemap', destination: '/sitemap.html' });
  expect(routes.redirects.some((r) => r.source === '/sitemap')).toBe(false);
  const html = fs.readFileSync(path.join(ROOT, 'sitemap.html'), 'utf8');
  expect(html).toContain('<link rel="canonical" href="https://lifecycle-os.anchit-tandon.com/sitemap">');
  expect(html).toContain('href="https://lifecycle-os.anchit-tandon.com/sitemap.xml"');
  expect(html).toContain('--sm-primary:var(--vh-primary-text');
  expect(html.match(/class="sm-link"/g)?.length).toBeGreaterThan(80);
  expect(isAllowed('/sitemap', RULES)).toBe(true);
});

test('XML sitemap is static XML containing only canonical, indexable pages', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  expect(config.rewrites.some((r) => r.source === '/sitemap.xml')).toBe(false);
  expect(config.headers).toEqual(expect.arrayContaining([
    expect.objectContaining({
      source: '/sitemap.xml',
      headers: expect.arrayContaining([expect.objectContaining({ key: 'Content-Type', value: 'application/xml; charset=utf-8' })]),
    }),
  ]));
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(locs).toEqual([
    'https://lifecycle-os.anchit-tandon.com/',
    'https://lifecycle-os.anchit-tandon.com/about',
    'https://lifecycle-os.anchit-tandon.com/sitemap',
    'https://lifecycle-os.anchit-tandon.com/privacy',
    'https://lifecycle-os.anchit-tandon.com/terms',
  ]);
  for (const loc of locs) expect(isAllowed(new URL(loc).pathname, RULES)).toBe(true);
  for (const page of ['about.html', 'privacy.html', 'terms.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const canonical = 'https://lifecycle-os.anchit-tandon.com/' + page.slice(0, -5);
    expect(html).toContain('<link rel="canonical" href="' + canonical + '">');
  }
});


test('Googlebot can fetch rendering dependencies of every indexable page', () => {
  const publicPages = ['index.html', 'sitemap.html', 'privacy.html', 'terms.html'];
  const resources = new Set();
  for (const page of publicPages) {
    const markup = fs.readFileSync(path.join(ROOT, page), 'utf8');
    // Parse actual first-party script, link and image URLs used by public pages.
    // Query strings are retained: Googlebot sees /auth.js?v=... rather than
    // the bare file path. Avoid maintaining a test-only allowlist.
    for (const match of markup.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["'](\/[^"']+)["'][^>]*>/gi)) {
      const ref = new URL(match[1], 'https://lifecycle-os.anchit-tandon.com');
      if (/\.(?:js|css|png|svg|webmanifest)$/.test(ref.pathname)) {
        resources.add(ref.pathname + ref.search);
      }
    }
  }
  // The shared stylesheet references a public logo SVG in addition to the
  // resources declared directly in HTML.
  const stylesheet = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8');
  for (const match of stylesheet.matchAll(/url\(\s*['"]?(\/assets\/[^)'"]+)['"]?\s*\)/g)) {
    resources.add(match[1]);
  }
  for (const needed of ['/theme.css', '/auth.js?v=20260810lifecycle',
    '/brand-catalog.js', '/brand-context.js?early=1',
    '/assets/lifecycle-os-mark.svg', '/assets/lifecycle-os/logos/mark-glyph.svg']) {
    expect(resources.has(needed), 'public HTML/CSS must actually use ' + needed).toBe(true);
  }
  expect(resources.size, 'the public pages must declare multiple real assets').toBeGreaterThanOrEqual(8);
  for (const resource of resources) {
    const ref = new URL(resource, 'https://lifecycle-os.anchit-tandon.com');
    expect(fs.existsSync(path.join(ROOT, ref.pathname)), 'resource missing: ' + resource).toBe(true);
    expect(isAllowed(ref.pathname + ref.search, RULES), 'Googlebot blocked: ' + resource).toBe(true);
  }
  // Explicitly guard against a fix that would allow all pages, including
  // customer data, dashboards, landing pages and APIs.
  for (const privatePath of ['/dashboard.html', '/calendar', '/api/public-config',
    '/lp/private-campaign', '/data/catalog/products_US.json']) {
    expect(isAllowed(privatePath, RULES), privatePath + ' must remain disallowed').toBe(false);
  }
});
