'use strict';
/**
 * scripts/coverage/preload.js — browser-side JS coverage for every Playwright page.
 * ---------------------------------------------------------------------------
 * Loaded through `NODE_OPTIONS=--require` by scripts/coverage/run.js, so it runs
 * in every Node process the coverage run spawns: the Playwright runner, each of
 * its worker processes, and any `node scripts/...` child a test starts. It is
 * INERT unless LIFECYCLE_COVERAGE_BROWSER_DIR is set, and even then it does
 * nothing until `playwright-core` is required in the process — so a plain
 * `node scripts/brand-sync.js` child pays one cheap Module._load hook and no more.
 *
 * WHY A PRELOAD AND NOT A FIXTURE. Every spec in tests/ imports `test` straight
 * from @playwright/test. A `test.extend` fixture would need every spec to import
 * it instead — 75 edits to files the coverage task must not touch — and a spec
 * that forgot would be silently uninstrumented. Playwright has no config-level
 * fixture hook, so the next-best seam is the client library itself: this file
 * patches the BrowserType → Browser → BrowserContext → Page prototypes once,
 * lazily, when `playwright-core` is first loaded, and the fixtures that create
 * pages (`context.newPage()`) run through the patched methods unchanged.
 *
 * WHAT IT RECORDS. `page.coverage.startJSCoverage({ resetOnNavigation: false })`
 * on every page as it is created (newPage, popup, persistent-context page), and
 * `stopJSCoverage()` before that page, its context or its browser closes. Each
 * flush is written as one JSON file of `{ url, sha1, length, functions }` rows,
 * with the script SOURCE stored once per hash under sources/ — the Studio page
 * alone is ~700KB and is opened by dozens of tests, so the source is
 * content-addressed rather than repeated per flush. Attribution back to repo
 * files happens in scripts/coverage/browser.js at report time, by hash, because
 * the specs serve pages from http://127.0.0.1:<port>/ and fake origins, not
 * from file:// URLs.
 *
 * WHAT IT CANNOT RECORD. `page.coverage` is Chromium-only (null on WebKit and
 * Firefox — the guard below just skips). Service workers (sw.js) run in their
 * own context outside the page's profiler. Scripts injected by tests
 * (addInitScript / evaluate / addScriptTag without a URL) are anonymous and
 * skipped on purpose — they are test code, not page code. A worker killed with
 * SIGKILL (a hard timeout) loses the flushes it had not yet written, exactly as
 * Node's own NODE_V8_COVERAGE does.
 *
 * Every hook is wrapped in try/catch: instrumentation must never turn a passing
 * test into a failing one.
 */
const OUT = process.env.LIFECYCLE_COVERAGE_BROWSER_DIR;

if (OUT) {
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const Module = require('module');

  const DEBUG = !!process.env.LIFECYCLE_COVERAGE_DEBUG;
  const log = (...a) => { if (DEBUG) console.error('[coverage:preload]', ...a); };
  const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

  /** page → Promise that resolves once startJSCoverage has settled. */
  const starting = new WeakMap();
  const flushed = new WeakSet();
  let seq = 0;

  function write(entries) {
    const rows = [];
    fs.mkdirSync(path.join(OUT, 'sources'), { recursive: true });
    fs.mkdirSync(path.join(OUT, 'entries'), { recursive: true });
    for (const e of entries || []) {
      if (!e || !e.url || typeof e.source !== 'string' || !Array.isArray(e.functions) || !e.functions.length) continue;
      const h = sha1(e.source);
      const sp = path.join(OUT, 'sources', h + '.txt');
      if (!fs.existsSync(sp)) fs.writeFileSync(sp, e.source);
      rows.push({ url: e.url, sha1: h, length: e.source.length, functions: e.functions });
    }
    if (!rows.length) return;
    const f = path.join(OUT, 'entries', `${process.pid}-${Date.now()}-${seq++}.json`);
    fs.writeFileSync(f, JSON.stringify(rows));
    log('wrote', rows.length, 'scripts →', path.basename(f));
  }

  function start(page) {
    if (!page) return Promise.resolve();
    if (starting.has(page)) return starting.get(page);
    const p = (async () => {
      try {
        // Chromium only: page.coverage is null on the WebKit/Firefox projects.
        if (page.coverage && typeof page.coverage.startJSCoverage === 'function') {
          await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false });
        }
      } catch (err) { log('start failed:', err && err.message); }
    })();
    starting.set(page, p);
    return p;
  }

  async function flush(page) {
    if (!page || !starting.has(page) || flushed.has(page)) return;
    flushed.add(page);
    try {
      await starting.get(page);
      if (page.coverage && typeof page.coverage.stopJSCoverage === 'function') {
        write(await page.coverage.stopJSCoverage());
      }
    } catch (err) { log('flush failed:', err && err.message); }
  }

  async function flushAll(pages) {
    for (const p of pages || []) await flush(p);
  }

  const PATCHED = Symbol('lifecycle-coverage-patched');
  function wrap(proto, name, make) {
    if (!proto || typeof proto[name] !== 'function' || proto[name][PATCHED]) return;
    const orig = proto[name];
    const fn = make(orig);
    fn[PATCHED] = true;
    proto[name] = fn;
  }

  function hookPage(page) {
    try {
      wrap(Object.getPrototypeOf(page), 'close', (orig) => async function (...a) {
        await flush(this);
        return orig.apply(this, a);
      });
    } catch (err) { log('hookPage failed:', err && err.message); }
    return start(page);
  }

  function hookContext(ctx) {
    try {
      const proto = Object.getPrototypeOf(ctx);
      wrap(proto, 'newPage', (orig) => async function (...a) {
        const page = await orig.apply(this, a);
        await hookPage(page);
        return page;
      });
      wrap(proto, 'close', (orig) => async function (...a) {
        try { await flushAll(this.pages()); } catch (err) { log(err && err.message); }
        return orig.apply(this, a);
      });
      // Popups and pages that already exist (a persistent context ships with one).
      ctx.on('page', (p) => { hookPage(p).catch(() => {}); });
      for (const p of ctx.pages()) hookPage(p).catch(() => {});
    } catch (err) { log('hookContext failed:', err && err.message); }
  }

  function hookBrowser(browser) {
    try {
      const proto = Object.getPrototypeOf(browser);
      wrap(proto, 'newContext', (orig) => async function (...a) {
        const ctx = await orig.apply(this, a);
        hookContext(ctx);
        return ctx;
      });
      wrap(proto, 'close', (orig) => async function (...a) {
        try { for (const c of this.contexts()) await flushAll(c.pages()); } catch (err) { log(err && err.message); }
        return orig.apply(this, a);
      });
      for (const c of browser.contexts()) hookContext(c);
    } catch (err) { log('hookBrowser failed:', err && err.message); }
  }

  function hookBrowserType(bt) {
    const proto = Object.getPrototypeOf(bt);
    for (const name of ['launch', 'connect', 'connectOverCDP']) {
      wrap(proto, name, (orig) => async function (...a) {
        const browser = await orig.apply(this, a);
        hookBrowser(browser);
        return browser;
      });
    }
    wrap(proto, 'launchPersistentContext', (orig) => async function (...a) {
      const ctx = await orig.apply(this, a);
      hookContext(ctx);
      return ctx;
    });
    log('playwright-core patched in pid', process.pid);
  }

  let patched = false;
  const origLoad = Module._load;
  Module._load = function (request) {
    const exp = origLoad.apply(this, arguments);
    if (!patched && request === 'playwright-core' && exp && exp.chromium) {
      patched = true;
      try { hookBrowserType(exp.chromium); } catch (err) { log('patch failed:', err && err.message); }
    }
    return exp;
  };
}
