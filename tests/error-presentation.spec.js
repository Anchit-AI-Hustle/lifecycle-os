/**
 * A FAILURE MUST LOOK LIKE A FAILURE.
 * ---------------------------------------------------------------------------
 * Found on the live deployment, not in the source. The Supabase project is
 * paused, so every authenticated call answers 503 - and the onboarding wizard's
 * "Your brands" panel rendered
 *
 *     session_verification_unavailable
 *
 * in `<p class="muted">`, which is exactly how the brand rows it replaced are
 * styled. A machine identifier stood in a list of brands and read as the name
 * of one.
 *
 * PR #75 made brand-context.js prefer a human `message` over the machine
 * `error` code, and gave every auth refusal a real sentence. That was
 * necessary and it is NOT sufficient, which is the whole point of this file:
 * an error of ANY kind rendered into a slot labelled "Your brands" still reads
 * as a brand. The same shape was live in ~20 other places - `<div
 * class="empty">` (an EMPTY STATE, i.e. "you have no data", which is the
 * opposite of what happened), `<td class="muted">` inside a data table, a chat
 * agent's own reply bubble, a mailer's subject line, a raw stack trace in a
 * preview pane.
 *
 * ── WHY THESE TESTS LOAD PAGES ─────────────────────────────────────────────
 * A test that reads the source is not a test of the behaviour (the 2026-08-23
 * finding, ratcheted by scripts/check-executed-tests.js). Grepping for
 * `class="vh-failure"` in onboarding.html would pass even if the element never
 * rendered, if theme.css never reached it, if it were painted the same colour
 * as the rows around it, or if the identifier were still the first thing the
 * reader sees.
 *
 * So every test here opens the REAL page in Chromium, stubs the API route to
 * answer the way a paused backend actually answers, and asserts on what is
 * RENDERED - textContent of the slot, and getComputedStyle for the colour
 * rules. Each also asserts it measured something first: a check that inspects
 * nothing passes everything.
 *
 * Run: npx playwright test tests/error-presentation.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

/** A machine identifier: snake_case / dotted, no spaces. */
const IDENT = /^[a-z][a-z0-9]*(?:[_.-][a-z0-9]+)+$/;

/** What a paused Supabase project actually makes requireUser() answer. */
const PAUSED = {
  status: 503,
  body: {
    ok: false,
    error: 'session_verification_unavailable',
    message: 'Your sign-in could not be verified because the database did not answer.',
    backend_unreachable: true,
  },
};

/**
 * Serve the repo as a real host and answer /api/ however the case needs.
 *
 * The hostname is not localhost on purpose: auth.js treats localhost as a dev
 * preview and takes a different path, so a fixture served from 127.0.0.1 would
 * not be exercising what production runs.
 */
async function openPage(page, file, { api, query = '', block } = {}) {
  const thrown = [];
  page.on('pageerror', (e) => thrown.push(String(e.message || e)));

  // Stand-in for supabase-js so pages that construct a client do not die on a
  // CDN this harness blocks. No session: the visitor is signed out.
  await page.addInitScript(() => {
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async () => ({ error: null }),
          signOut: async () => ({}),
        },
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'session_verification_unavailable' } }) }) }),
        }),
      }),
    };
  });

  // Broadest first, most specific LAST - Playwright's last matching route wins.
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};window.Papa=window.Papa||{parse(){}};',
    });
  });
  await page.route('http://app.example.test/**', (route) => {
    const u = new URL(route.request().url());
    // `block` removes one shipped file, so a case can prove what the page does
    // when it is NOT there.
    if (block && block.test(u.pathname)) return route.fulfill({ status: 404, body: 'nf' });
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => {
    const answer = api ? api(new URL(route.request().url())) : null;
    // `raw` answers with something that is NOT JSON - a gateway error page,
    // which is what a caller's own .json() rejects on. That is the path a
    // `.catch()` handler takes, and it is a different branch from a refusal
    // the server managed to serialise.
    if (answer && answer.raw != null) return route.fulfill({ status: answer.status || 502, contentType: 'text/html', body: answer.raw });
    if (answer) return route.fulfill({ status: answer.status || 200, contentType: 'application/json', body: JSON.stringify(answer.body) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('http://app.example.test/' + file + query, { waitUntil: 'domcontentloaded' });
  return thrown;
}

/** Everything a reader actually sees in a slot, with the labelled code line removed. */
function readSlot(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('.vh-failure-code').forEach((n) => n.remove());
    const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
    return {
      all: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      // What the reader is shown as the EXPLANATION - the code line is
      // deliberately excluded, because keeping the identifier labelled and
      // secondary is correct and keeping it as the whole message is the bug.
      explanation: (clone.textContent || '').replace(/\s+/g, ' ').trim(),
      failures: el.querySelectorAll('[data-failure]').length,
      // Any bare identifier standing on its own as a word in the explanation.
      identTokens: words(clone.textContent).filter((w) => /^[a-z][a-z0-9]*(?:[_.][a-z0-9]+)+$/.test(w.replace(/[.,;:)]$/, ''))),
    };
  }, selector);
}

/** Luminance + contrast of a rendered element, resolved through the cascade. */
function measure(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rgb = (v) => (v.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const a = c.map((x) => { const y = x / 255; return y <= 0.03928 ? y / 12.92 : Math.pow((y + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
    // Walk up for the painted ground: a transparent element inherits it.
    let node = el, bg = null;
    while (node && node !== document.documentElement) {
      const c = getComputedStyle(node).backgroundColor;
      const parts = (c.match(/[\d.]+/g) || []).map(Number);
      if (parts.length >= 3 && (parts.length < 4 || parts[3] > 0.6)) { bg = parts.slice(0, 3); break; }
      node = node.parentElement;
    }
    if (!bg) bg = [255, 255, 255];
    const s = getComputedStyle(el);
    const fg = rgb(s.color);
    const L1 = lum(bg), L2 = lum(fg);
    return {
      bgLum: L1,
      ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05),
      borderLeft: parseFloat(s.borderLeftWidth) || 0,
      role: el.getAttribute('role') || '',
    };
  }, selector);
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE REPORTED DEFECT: "Your brands"
   ═══════════════════════════════════════════════════════════════════════════ */

const ONBOARDING_API = (u) => {
  const op = u.searchParams.get('op');
  if (op === 'list') return PAUSED;                       // the failure under test
  if (op === 'presets') return { body: { ok: true, presets: [] } };
  if (op === 'defaults') return { body: { ok: true, brand: {} } };
  if (op === 'active') return { body: { ok: true, brand: { id: 'ws-1', name: 'Northwind Tea' } } };
  if (op === 'get') return { body: { ok: true, brand: { id: 'ws-1', name: 'Northwind Tea', status: 'draft', onboarding_step: 6 } } };
  if (op === 'context-get') return { body: { ok: true, pack: null } };
  return { body: { ok: true } };
};

async function onboardingReview(page) {
  await openPage(page, 'onboarding.html', { api: ONBOARDING_API, query: '?id=ws-1&step=6' });
  await page.waitForSelector('#wsList', { timeout: 15000 });
  // loadWorkspaces() is fired from the step-6 render; wait for it to settle.
  await page.waitForFunction(() => {
    const el = document.getElementById('wsList');
    return el && !/Loading/i.test(el.textContent || '');
  }, null, { timeout: 15000 });
}

test('the brand list shows a FAILURE, never something shaped like a brand', async ({ page }) => {
  await onboardingReview(page);
  const seen = await readSlot(page, '#wsList');

  expect(seen, '#wsList never rendered, so nothing was measured').not.toBeNull();
  expect(seen.all.length, 'the slot is empty - a check that inspects nothing passes everything').toBeGreaterThan(20);

  // 1. A frame. This is what stops it reading as content.
  expect(seen.failures, 'no failure frame was rendered into the brand list').toBeGreaterThan(0);
  // 2. Nothing in there looks like a brand row.
  expect(await page.locator('#wsList .ws').count(), 'a brand row was rendered for a request that failed').toBe(0);
  // 3. The identifier is never the explanation.
  expect(seen.identTokens, `a bare machine identifier is being read as the explanation: ${seen.identTokens.join(', ')}`).toEqual([]);
  expect(seen.explanation).not.toContain('session_verification_unavailable');
});

test('the brand list says plainly that the database is unreachable and nothing is saved', async ({ page }) => {
  await onboardingReview(page);
  const seen = await readSlot(page, '#wsList');
  // `backend_unreachable` on the payload is the one case where the cause IS
  // knowable, and "nothing has been saved" is the half an operator otherwise
  // discovers by losing work.
  expect(seen.explanation.toLowerCase()).toContain('database is unreachable');
  expect(seen.explanation.toLowerCase()).toContain('nothing has been saved');
  // And it still names what could not be done, so the frame is not generic.
  expect(seen.explanation.toLowerCase()).toContain('brands');
});

test('the failure is painted unlike content: light ground, AA text, an error edge', async ({ page }) => {
  await onboardingReview(page);
  const box = await measure(page, '#wsList [data-failure]');
  const msg = await measure(page, '#wsList .vh-failure-msg');

  expect(box, 'no failure block to measure').not.toBeNull();
  // A dark-neutral section background is a HARD rule in this repo.
  expect(box.bgLum, 'the failure block sits on a dark ground').toBeGreaterThan(0.4);
  // Distinct from every content surface in the suite.
  expect(box.borderLeft, 'no error edge - it is styled like an ordinary panel').toBeGreaterThanOrEqual(3);
  expect(box.role, 'a failure must announce itself to assistive tech').toBe('alert');
  // The SENTENCE is the information, so it is the part that must never be the
  // low-contrast one.
  expect(msg.ratio, 'the failure sentence is under WCAG AA').toBeGreaterThanOrEqual(4.5);
  // The tag is the only run of text painted in the error colour, so it is
  // measured too - a red that reads well on white does not automatically read
  // well on the panel tint underneath it.
  const tag = await measure(page, '#wsList .vh-failure-tag');
  expect(tag.ratio, 'the failure tag is under WCAG AA').toBeGreaterThanOrEqual(4.5);
});

test('a code the server sent is kept, but labelled and secondary', async ({ page }) => {
  await onboardingReview(page);
  const parts = await page.evaluate(() => {
    const box = document.querySelector('#wsList [data-failure]');
    if (!box) return null;
    const kids = Array.from(box.children).map((n) => (n.className || '') + '::' + (n.textContent || '').trim());
    return { first: kids[0] || '', code: (box.querySelector('.vh-failure-code') || {}).textContent || '' };
  });
  expect(parts, 'no failure block').not.toBeNull();
  // The tag comes first - the operator reads the top line, not the bottom one.
  expect(parts.first).toMatch(/^vh-failure-tag::/);
  // The code is still recoverable for a bug report, and it says who said it.
  expect(parts.code).toContain('session_verification_unavailable');
  expect(parts.code.toLowerCase()).toContain('reported by the server as');
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. THE SAME SLOT WHEN THE SERVER SENDS ONLY A CODE
   The 503 above carries a sentence because PR #75 put one there. This case
   removes it, which is the state every OTHER refusal in the app can still be
   in, and the one a bare `e.message` render has no defence against.
   ═══════════════════════════════════════════════════════════════════════════ */

test('a refusal carrying ONLY a machine code still reads as a sentence', async ({ page }) => {
  await openPage(page, 'onboarding.html', {
    query: '?id=ws-1&step=6',
    api: (u) => (u.searchParams.get('op') === 'list'
      ? { status: 503, body: { ok: false, error: 'session_verification_unavailable' } }
      : ONBOARDING_API(u)),
  });
  await page.waitForSelector('#wsList');
  await page.waitForFunction(() => !/Loading/i.test(document.getElementById('wsList').textContent || ''));

  const seen = await readSlot(page, '#wsList');
  expect(seen.all.length).toBeGreaterThan(20);
  expect(seen.identTokens, 'the code is being shown as the explanation').toEqual([]);
  expect(seen.explanation.toLowerCase()).toContain('database is unreachable');
});

test('an unknown code is reported as a sentence, never as the code itself', async ({ page }) => {
  await openPage(page, 'onboarding.html', {
    query: '?id=ws-1&step=6',
    api: (u) => (u.searchParams.get('op') === 'list'
      ? { status: 500, body: { ok: false, error: 'widget_frobnicator_offline' } }
      : ONBOARDING_API(u)),
  });
  await page.waitForSelector('#wsList');
  await page.waitForFunction(() => !/Loading/i.test(document.getElementById('wsList').textContent || ''));

  const seen = await readSlot(page, '#wsList');
  expect(seen.identTokens, 'an unmapped code leaked into the explanation').toEqual([]);
  expect(seen.explanation.toLowerCase()).toMatch(/refused|could not/);
  // Not invented as an unreachable database either - we do not know that.
  expect(seen.explanation.toLowerCase()).not.toContain('database is unreachable');
  // It is still recoverable.
  expect(seen.all).toContain('widget_frobnicator_offline');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. READ MY BRAND FROM MY WEBSITE - the control in the live screenshot
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   3b. THE FLOOR: the page renders a failure even with NO shared helper
   The real treatment ships in auth.js, which every page loads DEFERRED and
   which a harness (or a blocked request) may not load at all. A catch block
   that throws because the helper is missing aborts the whole render - the
   operator presses the button, the request fails, and nothing on the page
   changes. That is strictly worse than the bare code this work replaced, so
   every page installs a minimal stub of its own before its script runs.
   ═══════════════════════════════════════════════════════════════════════════ */

test('with auth.js absent the failure still renders, and nothing throws', async ({ page }) => {
  // The wizard normally gets BrandContext from auth.js too, so it is stubbed
  // here the way the other wizard specs stub it - what is under test is the
  // absence of LifecycleFailure, not the absence of a backend client.
  await page.addInitScript(() => {
    window.BrandContext = {
      ready: async () => ({ id: 'ws-1' }),
      list: async () => { const e = new Error('Your sign-in could not be verified because the database did not answer.'); e.code = 'session_verification_unavailable'; e.payload = { backend_unreachable: true }; throw e; },
      setActive: async () => ({}),
      refresh: async () => ({}),
      clearCache: () => {},
      api: async (op) => (op === 'get'
        ? { brand: { id: 'ws-1', name: 'Northwind Tea', status: 'draft', onboarding_step: 6 } }
        : {}),
    };
  });
  const thrown = await openPage(page, 'onboarding.html', {
    api: ONBOARDING_API,
    query: '?id=ws-1&step=6',
    // The one thing this case removes.
    block: /\/auth\.js/,
  });
  await page.waitForSelector('#wsList');
  await page.waitForFunction(() => !/Loading/i.test(document.getElementById('wsList').textContent || ''), null, { timeout: 15000 });

  expect(await page.evaluate(() => typeof window.LifecycleAuth), 'auth.js loaded after all, so the floor was not exercised').toBe('undefined');
  const seen = await readSlot(page, '#wsList');
  expect(seen.failures, 'nothing was rendered at all - the catch block threw').toBeGreaterThan(0);
  expect(seen.explanation).toContain('Your brands could not be loaded');
  expect(seen.explanation).toContain('database did not answer');
  expect(seen.identTokens, 'the floor let a bare identifier through').toEqual([]);
  expect(thrown.filter((m) => /LifecycleFailure|undefined/.test(m)),
    `the page threw: ${thrown.join(' | ')}`).toEqual([]);
});

test('"Could not read that site" explains the cause instead of printing a code', async ({ page }) => {
  // No brand and no saved step, so the wizard stays on step 1 where the
  // "Read my site" control lives.
  await openPage(page, 'onboarding.html', {
    api: (u) => {
      const op = u.searchParams.get('op');
      if (op === 'extract') return PAUSED;
      if (op === 'active' || op === 'get') return { body: { ok: true, brand: null } };
      return ONBOARDING_API(u);
    },
  });
  await page.waitForSelector('#xUrl', { timeout: 15000 });
  // The wizard re-renders step 1 when BrandContext settles, which replaces the
  // input and the button. Retry until the click actually lands on the live
  // control - the flake is the harness racing the render, not the page.
  await expect(async () => {
    await page.fill('#xUrl', 'https://northwind.example');
    await page.click('#xRun');
    expect(await page.locator('.xtract [data-failure]').count()).toBeGreaterThan(0);
  }).toPass({ timeout: 20000 });

  const seen = await readSlot(page, '#stepCard');
  expect(seen.failures).toBeGreaterThan(0);
  expect(seen.explanation).toContain('Could not read that site');
  expect(seen.explanation.toLowerCase()).toContain('database is unreachable');
  expect(seen.explanation).not.toContain('session_verification_unavailable');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. AN ERROR IS NOT AN EMPTY STATE
   These slots have a dedicated no-data appearance, and a failure wearing it
   tells the operator the opposite of what happened.
   ═══════════════════════════════════════════════════════════════════════════ */

test('a credit ledger that could not be read shows a failure ROW, not a data row', async ({ page }) => {
  await openPage(page, 'credits.html', { api: () => PAUSED });
  await page.waitForFunction(() => {
    const t = document.getElementById('ledger');
    return t && !/Loading/i.test(t.textContent || '');
  }, null, { timeout: 15000 });

  const seen = await readSlot(page, '#ledger');
  expect(seen.all.length, 'the ledger is empty - nothing was measured').toBeGreaterThan(20);
  expect(seen.failures, 'no failure frame in the ledger').toBeGreaterThan(0);
  expect(seen.identTokens).toEqual([]);
  // A loose <div> inside a <table> is dropped by the parser and the slot ends
  // up blank, so the block has to arrive inside a real row.
  expect(await page.locator('#ledger > tbody > tr.vh-failure-tr [data-failure]').count(),
    'the failure is not inside a table row, so the markup is invalid').toBeGreaterThan(0);
  // And it must not be mistaken for a credit movement.
  expect(seen.all).not.toMatch(/^\s*(\+|-)?\d/);
});

test('an unreadable ads panel is not reported as "no data"', async ({ page }) => {
  // The real refusal shape from this router: HTTP 200, ok:false, a code.
  // `get()` does not throw on it, so the code went straight into the
  // empty-state div - which is how this test found a second instance.
  await openPage(page, 'ads-dashboard.html', { api: () => ({ status: 200, body: { ok: false, error: 'snowflake_unreachable' } }) });
  // The panel ships with "Pick a dimension and build." in it, so waiting on
  // "has some text" would pass before the request ever came back.
  await page.waitForFunction(() => {
    const el = document.querySelector('#cohort-body');
    return el && !/Pick a dimension/i.test(el.textContent || '');
  }, null, { timeout: 20000 });

  const seen = await readSlot(page, '#cohort-body');
  expect(seen.failures, 'no failure frame in the cohort panel').toBeGreaterThan(0);
  expect(seen.identTokens, 'a bare identifier is standing in for the explanation').toEqual([]);
  // `.empty` is this page's no-data class. A failure must never wear it.
  expect(await page.locator('#cohort-body .empty').count(),
    'the failure was rendered with the EMPTY-STATE class').toBe(0);
  const box = await measure(page, '#cohort-body [data-failure]');
  expect(box.bgLum, 'the failure sits on a dark ground').toBeGreaterThan(0.4);
});

test('an ads panel whose request never returns JSON also shows a failure', async ({ page }) => {
  // The OTHER branch: the server answered with a gateway page, so .json()
  // rejects and the .catch() handler runs. A refusal the server serialised and
  // a request that never parsed are different code paths in this page, and
  // both used to land in the empty-state div.
  await openPage(page, 'ads-dashboard.html', { api: () => ({ status: 502, raw: '<html><body>502 Bad Gateway</body></html>' }) });
  await page.waitForFunction(() => {
    const el = document.querySelector('#cohort-body');
    return el && !/Pick a dimension/i.test(el.textContent || '');
  }, null, { timeout: 20000 });

  const seen = await readSlot(page, '#cohort-body');
  expect(seen.failures, 'no failure frame after a non-JSON answer').toBeGreaterThan(0);
  expect(await page.locator('#cohort-body .empty').count(),
    'the failure was rendered with the EMPTY-STATE class').toBe(0);
});

test('the TeleSuite tool gallery does not fill with an error string', async ({ page }) => {
  await openPage(page, 'telesuite.html', {
    api: (u) => (u.searchParams.get('op') === 'registry'
      ? { body: { ok: true, subfeatures: [
          { key: 'home', kind: 'home', label: 'Overview (all tools)', blurb: '' },
          { key: 'voice', kind: 'voice', op: 'voice', label: 'Voice agents', blurb: 'Outbound calls.' },
        ] } }
      : PAUSED),
  });
  await page.waitForFunction(() => {
    const el = document.getElementById('homeGrid');
    return el && !/Loading/i.test(el.textContent || '');
  }, null, { timeout: 20000 });

  const seen = await readSlot(page, '#homeGrid');
  expect(seen.failures).toBeGreaterThan(0);
  expect(seen.identTokens).toEqual([]);
  expect(seen.explanation.toLowerCase()).toContain('database is unreachable');
  // No tile: a failure must not be offered as something to click into.
  expect(await page.locator('#homeGrid a.mod').count()).toBe(0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. THE NORMALISER ITSELF, EXECUTED IN THE BROWSER THAT SHIPS IT
   ═══════════════════════════════════════════════════════════════════════════ */

test('the shared normaliser is installed on a page and answers every shape', async ({ page }) => {
  await openPage(page, 'onboarding.html', { api: ONBOARDING_API });
  await page.waitForFunction(() => !!window.LifecycleFailure, null, { timeout: 15000 });

  const out = await page.evaluate(() => {
    const F = window.LifecycleFailure;
    const err = (msg, extra) => Object.assign(new Error(msg), extra || {});
    return {
      unreachablePayload: F.sentence(err('x', { code: 'session_verification_unavailable', payload: { backend_unreachable: true } })),
      bareCodeOnly: F.sentence(err('session_verification_unavailable')),
      unknownCode: F.sentence(err('widget_frobnicator_offline')),
      realSentence: F.sentence(err('Enter your store URL.')),
      network: F.sentence(err('Failed to fetch')),
      plainObject: F.sentence({ ok: false, error: 'That domain is not on your allowlist.' }),
      empty: F.sentence(null),
      code: F.code(err('x', { code: 'not_a_member' })),
    };
  });

  expect(out.unreachablePayload.toLowerCase()).toContain('database is unreachable');
  expect(out.unreachablePayload.toLowerCase()).toContain('nothing has been saved');
  // A code arriving as the message, with nothing else, still becomes words.
  expect(out.bareCodeOnly.toLowerCase()).toContain('database is unreachable');
  expect(IDENT.test(out.unknownCode)).toBe(false);
  expect(out.unknownCode).not.toContain('widget_frobnicator_offline');
  // A real sentence is never rewritten - the operator's own validation message
  // is the most useful thing there is.
  expect(out.realSentence).toBe('Enter your store URL.');
  // `{ ok:false, error:"<a real sentence>" }` is a shape several endpoints use;
  // only an IDENTIFIER-shaped error is withheld.
  expect(out.plainObject).toBe('That domain is not on your allowlist.');
  expect(out.network.toLowerCase()).toContain('could not be reached');
  expect(out.empty.length).toBeGreaterThan(10);
  expect(IDENT.test(out.empty)).toBe(false);
  expect(out.code).toBe('not_a_member');
});

test('the failure block never hardcodes a colour and never goes dark', async ({ page }) => {
  await openPage(page, 'onboarding.html', { api: ONBOARDING_API });
  await page.waitForFunction(() => !!window.LifecycleFailure, null, { timeout: 15000 });

  // Paint it for a brand whose own palette is nothing like tenant zero's, and
  // check the block followed the brand rather than a literal of its own. One
  // tenant's red on another tenant's page is the defect class this repo keeps
  // re-finding.
  const seen = await page.evaluate(() => {
    const r = document.documentElement;
    r.style.setProperty('--brand-err', 'rgb(0, 90, 40)');
    r.style.setProperty('--brand-surface-alt', 'rgb(250, 250, 244)');
    const host = document.createElement('div');
    host.id = 'fx-probe';
    document.body.appendChild(host);
    window.LifecycleFailure.show(host, new Error('Something went wrong.'), { title: 'Probe' });
    const box = host.querySelector('[data-failure]');
    const tag = host.querySelector('.vh-failure-tag');
    return {
      edge: getComputedStyle(box).borderLeftColor,
      tag: getComputedStyle(tag).color,
      bg: getComputedStyle(box).backgroundColor,
    };
  });
  // --vh-panel-2 is a fixed light panel; what must track the brand is the error
  // colour, and it does.
  expect(seen.edge, 'the error edge ignored the brand token').toBe('rgb(0, 90, 40)');
  expect(seen.tag, 'the tag ignored the brand token').toBe('rgb(0, 90, 40)');
  const bgParts = (seen.bg.match(/[\d.]+/g) || []).map(Number);
  expect(bgParts[0] + bgParts[1] + bgParts[2], 'the failure block is painted dark').toBeGreaterThan(450);
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. NOTHING ELSE BROKE
   ═══════════════════════════════════════════════════════════════════════════ */

test('a successful load still renders brands, not a failure frame', async ({ page }) => {
  // The other half of the gate. A fix that showed a failure on every load would
  // otherwise pass every test above.
  await openPage(page, 'onboarding.html', {
    query: '?id=ws-1&step=6',
    api: (u) => (u.searchParams.get('op') === 'list'
      ? { body: { ok: true, active_id: 'ws-1', workspaces: [{ id: 'ws-1', name: 'Northwind Tea', slug: 'northwind', tagline: 'Single-origin teas', status: 'active', palette: { primary: '#0a5a28' } }] } }
      : ONBOARDING_API(u)),
  });
  await page.waitForSelector('#wsList');
  await page.waitForFunction(() => !/Loading/i.test(document.getElementById('wsList').textContent || ''));

  expect(await page.locator('#wsList .ws').count(), 'the brand row did not render').toBe(1);
  expect(await page.locator('#wsList [data-failure]').count(), 'a failure frame was shown for a request that succeeded').toBe(0);
  await expect(page.locator('#wsList')).toContainText('Northwind Tea');
});
