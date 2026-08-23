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
  for (const url of ['/', '/index.html', '/privacy.html', '/terms.html']) {
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
});
