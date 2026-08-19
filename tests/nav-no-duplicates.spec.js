// The left rail must not offer the same thing twice.
//
// Four duplicates were live, and each one was a different KIND of duplicate,
// which is why this file checks four different things rather than one:
//
//   1. The 3D storefront group and every landing-page feature shared one group
//      called "3D Storefront & Websites". So the landing-page builder's own
//      sub-pages sat under a heading that does not mention landing pages, while
//      "Landing Pages" appeared as a row under Competitor Benchmarking and
//      again under Knowledge Base — three places using the term, none of them
//      the builder.
//   2. That group carried gid 'landing', so its ? chip opened the LANDING PAGES
//      description. The 3D storefront had no description of its own anywhere.
//   3. The Market Study group (gid 'research') and its first row (id 'research')
//      both resolved to the same INFO entry, so the identical panel was offered
//      twice, one directly beneath the other.
//   4. TeleSuite's first row was labelled "Home", the same word as the
//      always-visible top-level Home row, pointing somewhere else.
//
// Two things this deliberately does NOT call duplicates:
//
//   - The wordmark and the Home row both link to '/'. That is a logo and a menu
//     item, the standard pattern, and the reference repo does the same.
//   - "Meta Ads" under Competitor Benchmarking, Knowledge Base and Ad Campaigns
//     are three different things (their ads, saved references, ours) and are
//     unambiguous under their own headings. The reference repo keeps them bare
//     too. They are asserted as EXPECTED here so that a NEW cross-group repeat
//     still fails.
//
// Everything is measured on the rendered rail, with the groups expanded. A
// check against the NAV literal alone would miss a group that renders twice.
//
// Run: npx playwright test tests/nav-no-duplicates.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let server; let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, brand: null, needs_onboarding: false, workspaces: [] }));
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

/** Open a page and expand every group, so collapsed rows are still measured. */
async function openRail(page, file = 'index.html') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({
    status: 200, contentType: 'text/javascript',
    body: 'window.tailwind = window.tailwind || {}; window.Papa = window.Papa || { unparse: () => "" };',
  }));
  await page.goto(base + '/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('.lnav-side a').length > 0, null, { timeout: 20_000 });
  for (const h of await page.$$('.lnav-side .lnav-ghead')) { try { await h.click(); } catch (_) { /* already open */ } }
  // Wait for the expansion rather than sleeping on it: a fixed pause is a guess
  // about how fast this machine is.
  await page.waitForFunction(() => document.querySelectorAll('.lnav-side a').length > 50, null, { timeout: 10_000 });
  return { errors };
}

/** Every visible link in the rail, as {href, text}. */
const links = (page) => page.evaluate(() => {
  const vis = (el) => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  return [...document.querySelectorAll('.lnav-side a')].filter(vis)
    .map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim().replace(/\s+/g, ' ') }));
});

/* ═══ one destination, one row ════════════════════════════════════════════ */

test('no two rows in the rail go to the same place', async ({ page }) => {
  await openRail(page);
  const rows = await links(page);
  expect(rows.length, 'the rail did not expand').toBeGreaterThan(50);

  // Compare rows by where they LAND, not by what they say. A top-level row
  // pointed at /ads-master, which redirects onto /data-analysis?tab=live-ads —
  // already in the rail as "Paid Media". Two rows, one page, and comparing raw
  // hrefs saw two different strings and called it clean.
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const redirect = {};
  for (const r of (vercel.redirects || [])) redirect[r.source] = r.destination;
  const lands = (href) => {
    let h = String(href || '');
    for (let i = 0; i < 5 && redirect[h.split('#')[0]]; i++) h = redirect[h.split('#')[0]];
    return h;
  };

  const byHref = {};
  for (const r of rows) { const k = lands(r.href); (byHref[k] = byHref[k] || []).push(r.text); }
  const dup = Object.entries(byHref).filter(([, v]) => v.length > 1);

  // The home page is the one allowed pair: the wordmark and the Home row. A
  // logo linking home is chrome, not a second menu item. Exempt it by where it
  // LANDS — vercel redirects '/' to the apex domain, so exempting the literal
  // '/' stopped matching the moment this test started resolving redirects.
  const HOME = lands('/');
  const unexpected = dup.filter(([href]) => href !== HOME);
  expect(unexpected.map(([h, v]) => `${h} <- ${v.join(' / ')}`), 'two menu rows share a destination').toEqual([]);

  const root = byHref[HOME] || [];
  expect(root.length, 'more than the wordmark and Home now point at the home page').toBeLessThanOrEqual(2);
});

/* ═══ one label, one meaning ══════════════════════════════════════════════ */

test('a repeated label is only ever a channel row inside its own section', async ({ page }) => {
  await openRail(page);
  const rows = await links(page);
  const byText = {};
  for (const r of rows) (byText[r.text] = byText[r.text] || []).push(r.href);

  // The channel rows repeat by design: the same four channels are viewed
  // through three lenses (competitors', saved references, ours), and each is
  // unambiguous under its own heading. Anything ELSE that repeats is a defect.
  const ALLOWED = new Set(['Mailers', 'Meta Ads', 'Google Ads', 'TikTok Ads', 'Landing Pages']);
  const dup = Object.entries(byText).filter(([, v]) => v.length > 1).map(([k]) => k);
  const unexpected = dup.filter((label) => !ALLOWED.has(label));
  expect(unexpected, 'a new repeated label appeared in the rail').toEqual([]);
});

test('no group heading repeats a row label', async ({ page }) => {
  // A heading is a <button> and a row is an <a>, so a check that only reads
  // links never compares them. That is how "Cohorts" ended up as both a group
  // heading (cohort DEFINITIONS at /cohorts) and a row inside Data Analysis
  // (retention curves at ?tab=cohort) — two different features, one word, and
  // the rail read as if it listed the same thing twice.
  await openRail(page);
  const out = await page.evaluate(() => {
    const txt = (el) => {
      const t = el.querySelector('.lnav-txt');
      return ((t || el).textContent || '').trim();
    };
    return {
      headings: [...document.querySelectorAll('.lnav-side .lnav-ghead')].map(txt),
      rows: [...document.querySelectorAll('.lnav-side a.lnav-link')].map(txt),
    };
  });
  expect(out.headings.length, 'no group headings found, so this proves nothing').toBeGreaterThan(5);
  const rows = new Set(out.rows.filter(Boolean));
  const clash = out.headings.filter((h) => h && rows.has(h));
  expect(clash, 'a group heading uses the same words as a row').toEqual([]);
});

test('no group row repeats an always-visible top-level row', async ({ page }) => {
  // The worst kind of repeat: a nested row using the same word as a row that is
  // on screen at all times. "Home" inside TeleSuite did exactly this.
  await openRail(page);
  const out = await page.evaluate(() => {
    // A nested row lives inside .lnav-gbody; a top-level row is any rail link
    // that does not. Written against the classes auth.js actually emits — an
    // earlier version guessed .lnav-children/.lnav-sub, matched nothing, and so
    // could never fail.
    const all = [...document.querySelectorAll('.lnav-scroll a.lnav-link')];
    const label = (a) => {
      const t = a.querySelector('.lnav-txt');
      return ((t || a).textContent || '').trim();
    };
    return {
      top: all.filter((a) => !a.closest('.lnav-gbody')).map(label),
      nested: all.filter((a) => a.closest('.lnav-gbody')).map(label),
    };
  });
  expect(out.top.length, 'found no top-level rows, so this test proves nothing').toBeGreaterThan(3);
  expect(out.nested.length, 'found no nested rows, so this test proves nothing').toBeGreaterThan(20);
  const topSet = new Set(out.top.filter(Boolean));
  const clash = [...new Set(out.nested)].filter((t) => t && topSet.has(t));
  expect(clash, 'a nested row uses the same label as a top-level row').toEqual([]);
});

/* ═══ one feature, one description ════════════════════════════════════════ */

test('no two ? chips open the same panel', async ({ page }) => {
  await openRail(page);
  const dup = await page.evaluate(() => {
    const keys = [...document.querySelectorAll('.lnav-side .lnav-i')].map((b) => b.getAttribute('data-itoggle'));
    const m = {}; keys.forEach((k) => { m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).filter(([, c]) => c > 1);
  });
  expect(dup, 'the same feature description is offered from two chips').toEqual([]);
});

test('the 3D storefront and the landing pages describe themselves, not each other', async ({ page }) => {
  // The group used to carry gid 'landing', so its chip opened the landing-page
  // description and the storefront had none of its own.
  await openRail(page);
  const read = async (key) => {
    await page.evaluate((k) => document.querySelector(`.lnav-side .lnav-i[data-itoggle="${k}"]`).click(), key);
    await page.waitForFunction(() => {
      const t = document.querySelector('#lnav-ipanel-eyebrow');
      return t && t.textContent.trim().length > 0;
    }, null, { timeout: 10_000 });
    const eyebrow = (await page.textContent('#lnav-ipanel-eyebrow')).trim();
    const body = (await page.textContent('#lnav-ipanel-body')).replace(/\s+/g, ' ').trim();
    await page.evaluate(() => document.querySelector('#lnav-ipanel-close').click());
    return { eyebrow, body };
  };

  const store = await read('storefront3d');
  expect(store.eyebrow).toMatch(/3D Storefront/i);
  expect(store.body.length, 'the storefront panel is empty').toBeGreaterThan(200);
  // It must say which of the two it is, because that was the confusion.
  expect(store.body).toMatch(/It is the STORE/);

  const lp = await read('landing');
  expect(lp.eyebrow).toMatch(/Landing Pages/i);
  expect(lp.body).toMatch(/landing pages/i);
  expect(lp.body, 'both chips open the same text').not.toBe(store.body);
});

/* ═══ nothing shipped unreachable ═════════════════════════════════════════ */

test('the landing-page builder and the RFM dashboard are reachable', async ({ page }) => {
  // Both are real routes in vercel.json that nothing in the rail pointed at.
  // /landing-pages had only its four #anchor rows, so no row opened it from the
  // top; /rfm serves dashboard.html and had no row at all.
  await openRail(page);
  const rows = await links(page);
  const hrefs = new Set(rows.map((r) => r.href));
  expect([...hrefs], 'the landing-page builder root is not in the rail').toContain('/landing-pages');
  expect([...hrefs], 'the RFM dashboard is not in the rail').toContain('/rfm');
});

test('every rail destination resolves to a route or a file', async ({ page }) => {
  // A duplicate is not the only way a menu misleads: a row that 404s is worse.
  await openRail(page);
  const rows = await links(page);
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  // BOTH lists. Reading only `rewrites` reported /ads-master as a dead link
  // when it is a redirect — a false failure that would have had someone delete
  // a working row.
  const routes = new Set([
    ...(vercel.rewrites || []).map((r) => r.source),
    ...(vercel.redirects || []).map((r) => r.source),
  ]);
  const missing = [];
  for (const r of rows) {
    const p = String(r.href || '').split('#')[0].split('?')[0];
    if (!p || p === '/' || p.startsWith('http')) continue;
    if (routes.has(p)) continue;
    if (fs.existsSync(path.join(ROOT, p.replace(/^\//, '')))) continue;
    // /lp/:id is served dynamically by the calendar router.
    if (/^\/lp\//.test(p)) continue;
    // A parameterised route may be declared with a pattern rather than literally.
    if ([...routes].some((s) => s.includes(':') && new RegExp('^' + s.replace(/:[^/]+/g, '[^/]+') + '$').test(p))) continue;
    missing.push(`${r.text} -> ${r.href}`);
  }
  expect(missing, 'rail rows point at destinations with no route and no file').toEqual([]);
});

/* ═══ and the rail still works ════════════════════════════════════════════ */

test('the rail renders once, on every page, without throwing', async ({ page }) => {
  for (const file of ['index.html', 'smart-brain.html', 'credits.html']) {
    const { errors } = await openRail(page, file);
    const rails = await page.evaluate(() => document.querySelectorAll('#lifecycle-nav').length);
    expect(rails, `${file} rendered ${rails} rails`).toBe(1);
    expect(errors, `${file} threw while building the rail`).toEqual([]);
  }
});
