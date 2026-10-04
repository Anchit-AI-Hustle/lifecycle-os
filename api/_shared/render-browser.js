'use strict';
/**
 * render-browser.js — one launcher for the headless browser "Read my site" uses.
 * ---------------------------------------------------------------------------
 * WHICH BINARY, and it says which:
 *   'env'          BRAND_RENDER_CHROMIUM names an executable (an operator's own).
 *   'sparticuz'    @sparticuz/chromium: a Chromium build for serverless Linux,
 *                  shipped brotli-packed in node_modules and unpacked to /tmp on
 *                  first use. Chosen on Vercel / AWS Lambda (Linux x64).
 *   'preinstalled' PW_CHROMIUM_PATH or /opt/pw-browsers/chromium - the sandbox
 *                  and CI images that ship a Chromium at a fixed path.
 *   'playwright'   playwright-core's own registry download (local development).
 * `launchInfo()` returns the choice, the executable, the Chromium version and
 * the launch time, so a report can say what rendered it.
 *
 * MEASURED, not assumed (2026-10-04, playwright-core 1.63 + @sparticuz/chromium
 * 153.0.0, Linux x64): the sparticuz binary launches under playwright-core and
 * renders, screenshots and evaluates. With `--single-process` (which the
 * package documents as required on Lambda) CLOSING A BROWSER CONTEXT KILLS THE
 * BROWSER - the next page call fails with "Target page, context or browser has
 * been closed". Pages open and close fine. So every read gets a FRESH BROWSER,
 * its contexts are never closed individually, and the browser is closed in
 * `finally`. That is also the strongest isolation available: nothing a page
 * did - cookies, storage, cache, a service worker - outlives one read.
 *
 * SECURITY FLAGS. The package's default argument list carries
 * `--disable-web-security` and `--allow-running-insecure-content`; neither is
 * passed. A dead proxy (`--proxy-server` at a closed loopback port, loopback
 * NOT bypassed) is passed on every binary, so a request that escapes route
 * interception fails instead of reaching anything - see render-net.js for the
 * measurement that made this necessary. WebRTC is confined to proxied UDP,
 * which with a dead proxy is none.
 *
 * CONCURRENCY. One browser per instance at a time. A second read on the same
 * instance waits briefly, then is refused with a sentence; the caller falls
 * back to the parser and says why.
 */

const fs = require('fs');
const path = require('path');

const DEAD_PROXY = 'http://127.0.0.1:9';

/** Chromium switches every binary gets. */
const BASE_ARGS = [
  `--proxy-server=${DEAD_PROXY}`,
  '--proxy-bypass-list=<-loopback>',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-dev-shm-usage',
  '--no-pings',
  '--disable-domain-reliability',
  '--disable-component-update',
  '--disable-background-networking',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-default-browser-check',
  '--font-render-hinting=none',
  '--hide-scrollbars',
];

/** The sparticuz switches minus the two that switch security off. */
const INSECURE = new Set(['--disable-web-security', '--allow-running-insecure-content']);

function isServerlessLinux() {
  return process.platform === 'linux' && process.arch === 'x64'
    && !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV);
}

async function sparticuz() {
  const mod = await import('@sparticuz/chromium');
  const C = mod.default || mod;
  const executablePath = await C.executablePath();
  const args = (C.args || []).filter((a) => !INSECURE.has(a));
  return { source: 'sparticuz', executablePath, args, single_process: args.includes('--single-process') };
}

/**
 * Pick the binary. `prefer` ('sparticuz' | 'local') is for the test that proves
 * the production binary launches in this container; production never passes it.
 */
async function pickBinary(prefer) {
  const envPath = process.env.BRAND_RENDER_CHROMIUM;
  if (!prefer && envPath && fs.existsSync(envPath)) return { source: 'env', executablePath: envPath, args: [] };
  if (prefer === 'sparticuz' || (!prefer && isServerlessLinux())) return sparticuz();
  const pre = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  if (fs.existsSync(pre)) return { source: 'preinstalled', executablePath: pre, args: [] };
  try {
    const { chromium } = require('playwright-core');
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return { source: 'playwright', executablePath: p, args: [] };
  } catch (_) { /* no registry browser */ }
  if (process.platform === 'linux' && process.arch === 'x64') return sparticuz();
  const e = new Error('No Chromium binary is available on this host.');
  e.code = 'no_browser';
  throw e;
}

let busy = null;          // the promise of the read in progress on this instance
let lastInfo = null;

/**
 * Run `fn(browser, info)` on a fresh browser, closed afterwards whatever
 * happens. Refuses (code 'busy') when another read holds this instance longer
 * than `waitMs`.
 */
async function withBrowser(fn, { waitMs = 1500, prefer, launchTimeoutMs = 30000 } = {}) {
  if (busy) {
    const freed = await Promise.race([busy.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), waitMs))]);
    if (!freed || busy) {
      const e = new Error('Another site is being rendered on this server instance right now.');
      e.code = 'busy';
      throw e;
    }
  }
  let release;
  busy = new Promise((r) => { release = r; });
  const t0 = Date.now();
  let browser = null;
  try {
    const bin = await pickBinary(prefer);
    const tUnpacked = Date.now();
    const { chromium } = require('playwright-core');
    browser = await chromium.launch({
      executablePath: bin.executablePath,
      args: BASE_ARGS.concat(bin.args || []),
      headless: true,
      timeout: launchTimeoutMs,
      chromiumSandbox: false,
    });
    const info = {
      source: bin.source,
      executable: bin.executablePath,
      version: browser.version(),
      single_process: !!bin.single_process,
      unpack_ms: tUnpacked - t0,
      launch_ms: Date.now() - t0,
    };
    lastInfo = info;
    return await fn(browser, info);
  } finally {
    if (browser) { try { await browser.close(); } catch (_) { /* already gone */ } }
    busy = null;
    release();
  }
}

function launchInfo() { return lastInfo; }

module.exports = { withBrowser, pickBinary, launchInfo, BASE_ARGS, DEAD_PROXY, INSECURE, isServerlessLinux };
