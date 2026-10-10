/**
 * Every ACTION works signed out, or says what needs sign-in - on every page.
 * ---------------------------------------------------------------------------
 * signed-out-usable.spec.js proved every page OPENS for a signed-out visitor.
 * onboarding-without-backend.spec.js proved the wizard's commands work on the
 * device. Nobody had pressed the rest of the product's buttons in the state the
 * ordinary visitor is in: a reachable backend and no session. That is the state
 * the deployment returns to the moment the paused project is restored, and it
 * is where a handler that asks the server first meets a 401 and renders it as
 * a failure - a red frame for the most ordinary state there is.
 *
 * THE CONTRACT, per activation. Exactly one of:
 *   1. it WORKED locally - a visible state change (a panel rendered, a tab
 *      switched, a preview drew, a brand saved on the device, a download or
 *      blob produced, a window opened, the clipboard written);
 *   2. it SAID WHAT NEEDS SIGN-IN - an inline .vh-status / accent-rule
 *      sentence beside the control that names signing in as what enables it.
 *      Never a .vh-failure, never a raw code, never a toast as the only
 *      trace, never a native dialog;
 *   3. it is a DISABLED control with its reason visible (the #97 pattern).
 * Anything else is a defect: a click with no visible outcome, a pageerror or
 * an unhandled rejection, a failure frame for the ordinary signed-out state, a
 * 401 rendered as an error, a native alert, a redirect to / or to a sign-in
 * URL, a page that reads as "no data" with no sentence.
 *
 * HOW IT MEASURES. Chromium, the real pages served as a real host (auth.js
 * treats localhost as a preview). page.on('dialog') and page.on('pageerror')
 * are registered BEFORE navigation. The active brand is the Times of India
 * preset saved on the DEVICE store (the state #97 allows), so nothing here is
 * tenant zero. The server is modelled by its own gates: the ops
 * brand-workspace-core / credits-core / connections / payments / data-analysis
 * / require-caller / credits.metered refuse for a caller with no bearer answer
 * 401 sign_in_required with the server's own sentence (503
 * session_verification_unavailable in the unreachable configuration);
 * everything ungated answers a generic ok. A MutationObserver installed before
 * load counts DOM changes outside the shared chrome; window.open,
 * URL.createObjectURL, the clipboard, Storage.setItem and print are hooked;
 * downloads and API responses are logged. A page's idle mutation targets (a
 * ticking clock) are sampled once and excluded, so a ticker never passes a
 * dead button.
 *
 * Controls are deduplicated by signature (tag, text, classes, handler): forty
 * identical "Copy" buttons are one press. Real links to other pages are
 * checked against vercel.json and the file list rather than followed.
 *
 * TWO CONFIGURATIONS, same contract: reachable-but-signed-out (the visitor)
 * and unreachable (the state production is in today), so the two cannot
 * diverge. Every list assertion counts what it measured first: a sweep over
 * nothing passes everything.
 *
 * Run: npx playwright test tests/signed-out-actions.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
// The device-session state's /api/ calls go to the SHIPPED routers
// (2026-10-03), not a model of them: a model answered every gated op "ok" for
// a phone sign-in, so it could not see the refusals the real server gave one
// (TeleSuite 403, the concierge 404, Smart Brain's 409 on approve, a usage
// panel whose op name was URL-encoded into nonsense). tests/agents-harness.js
// runs them in this process on production's configuration: no DATABASE_URL.
const A = require('./agents-harness');
let REAL = null, REAL_WORLD = null;
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOST = 'http://app.example.test';
const TELESUITE = require(path.join(ROOT, 'api', '_shared', 'telesuite-core.js'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

/** Every page that LOADS auth.js (a <script src>, not a mention), from the repo. */
const PAGES = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .filter((f) => /<script[^>]+src=["'][^"']*\bauth\.js/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .sort();

/* ── the destinations a link may land on ─────────────────────────────────── */
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const ROUTE_SOURCES = new Set([...(VERCEL.rewrites || []), ...(VERCEL.redirects || [])].map((r) => r.source));
function destinationExists(href) {
  const p = href.split('?')[0].split('#')[0];
  if (!p || p === '/') return true;
  if (ROUTE_SOURCES.has(p)) return true;
  for (const s of ROUTE_SOURCES) {
    if (s.includes(':')) {
      const rx = new RegExp('^' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+\\\*/g, '.*').replace(/:[A-Za-z_]+/g, '[^/]+') + '$');
      if (rx.test(p)) return true;
    }
  }
  const f = path.join(ROOT, p.replace(/^\//, ''));
  return f.startsWith(ROOT) && fs.existsSync(f);
}

/* ── the active brand: a preset, on the DEVICE, and not tenant zero ─────── */
const PRESET = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'times-of-india.json'), 'utf8'));
const DEVICE_ID = 'local-toi000000000001';
const DEVICE_SEED = {
  version: 1, active_id: DEVICE_ID,
  workspaces: [{
    id: DEVICE_ID, slug: PRESET.slug, name: PRESET.name, legal_name: null, tagline: PRESET.tagline, industry: PRESET.industry,
    website: PRESET.website, logo_url: null, favicon_url: null,
    palette: PRESET.palette, typography: PRESET.typography, voice: PRESET.voice, regions: PRESET.regions,
    asset_hosts: PRESET.asset_hosts, catalog_source: PRESET.catalog_source || {}, brand_data: PRESET.brand_data || {},
    status: 'active', onboarding_step: 6, owner_id: null,
    created_at: '2026-09-20T00:00:00.000Z', updated_at: '2026-09-20T00:00:00.000Z', storage: 'device',
  }],
};

/* ── the three configurations ────────────────────────────────────────────── */
const LIVE = { supabase: { url: 'https://live.supabase.co', anonKey: 'anon' } };
const STATES = {
  // (a) the ordinary visitor: a reachable backend, no session at all.
  'signed-out': { config: LIVE, reachable: true, session: false, kind: 'signed-out' },
  // (b) the state production is in today: the env var still set, the host not
  // answering. Paused, renamed and deleted are identical from here.
  unreachable: { config: { supabase: { url: 'https://deleted-project.supabase.co', anonKey: 'anon' } }, reachable: false, session: false, kind: 'unreachable' },
  // (c) signed in the way the app signs in since 2026-09-28: a mobile+PIN
  // session kept on THIS DEVICE (no DATABASE_URL on the deployment). Its
  // workspaces live in the device store. Features run: the token is sent and
  // the server admits it as a device principal (2026-09-30).
  'device-session': { config: LIVE, reachable: true, session: true, kind: 'signed-in' },
};
const DEVICE_USER = { id: 'dev-sweep0001', phone: '+919876543210', cc: '+91', local: '9876543210', name: 'Sweep' };
const AUTH_STATUS = { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' };

/* ── the server, modelled by its own gates ───────────────────────────────── */
// Ops each router answers WITHOUT a session (read from the routers themselves).
const PUBLIC_OPS = {
  brand: ['presets', 'defaults', 'validate-palette'],
  credits: ['catalog', 'prices'],
  connections: ['registry', 'publish-registry', 'oauth-callback'],
  payments: ['catalog', 'webhooks'],
};
// brain.js actions that call requireUser (or a core that does).
const BRAIN_GATED = new Set(['dispatch-enqueue', 'dispatch-drain', 'dispatch-list', 'dispatch-detail', 'dispatch-cancel',
  'deliverability-domain', 'deliverability-preflight', 'deliverability-warmup', 'cohort-optimize', 'domain', 'logo',
  'daily-calendar', 'revenue-analysis', 'platform-agents', 'revenue-os', 'journey', 'shopify', 'telesuite', 'social-gateway']);
// calendar.js features on the credit meter (credits.metered → enforce → 401).
const CALENDAR_GATED = new Set(['generate', 'lifecycle-generate', 'lifecycle-build-mailer', 'trigger-mailer', 'triggermailer']);
// The brain's MODEL actions (api/brain.js MODEL_FEATURE): on the credit meter,
// so a device principal reaches them and is answered unmetered (2026-09-30).
// Read from the router's own table rather than copied, so a new model action
// is covered the day it is added; a parse that finds nothing throws, because
// a harness that models no action passes every page. (2026-10-03: before this
// the device-session state answered brand-chat with GENERIC_OK - no `reply` -
// and KicksGPT correctly reported "answered without a reply" on all six
// suggestion chips. The page was right; the harness was not the server.)
const BRAIN_MODEL = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'api', 'brain.js'), 'utf8');
  const m = src.match(/const MODEL_FEATURE = \{([\s\S]*?)\n\};/);
  const keys = m ? [...m[1].matchAll(/^\s*'?([a-z][a-z-]*)'?\s*:/gm)].map((x) => x[1]) : [];
  if (keys.length < 10 || !keys.includes('brand-chat')) throw new Error('could not read MODEL_FEATURE from api/brain.js: ' + JSON.stringify(keys));
  return new Set(keys);
})();
const REWRITES = { '/api/brand': 'brand', '/api/credits': 'credits', '/api/connections': 'connections', '/api/payments': 'payments', '/api/telesuite': 'telesuite', '/api/klaviyo': 'klaviyo' };

/** 'config' | 'open' | 'gated' | 'lp' | 'auth' for a request URL. */
function gateOf(u) {
  const p = u.pathname;
  let action = u.searchParams.get('action') || '';
  const op = (u.searchParams.get('op') || '').toLowerCase();
  if (REWRITES[p]) action = REWRITES[p];
  if (/\/api\/public-config$/.test(p) || REWRITES[p] === 'brand' || REWRITES[p] === 'credits' || REWRITES[p] === 'connections' || REWRITES[p] === 'payments') {
    if (!action) return 'config';
    if (action === 'auth') return 'auth';
    if (PUBLIC_OPS[action]) return PUBLIC_OPS[action].includes(op || (action === 'credits' ? 'balance' : action === 'brand' ? 'active' : action === 'payments' ? 'catalog' : '')) ? 'open' : 'gated';
    if (action === 'data-analysis') return 'gated';
    return 'open';
  }
  if (/\/api\/ai\//.test(p)) return 'gated';
  if (/\/api\/calendar$/.test(p)) { if (action === 'lp') return 'lp'; return CALENDAR_GATED.has(action) ? 'gated' : 'open'; }
  if (/\/lp\//.test(p)) return 'lp';
  if (/\/api\/brain$/.test(p) || p === '/api/telesuite' || p === '/api/klaviyo') {
    // telesuite-core answers registry/clone/n8n before its context() gate.
    if (action === 'telesuite' && ['registry', 'clone', 'n8n', ''].includes(op)) return 'open';
    return BRAIN_GATED.has(action) ? 'gated' : 'open';
  }
  return 'open';   // competitor.js and kb.js carry no session gate
}

const GENERIC_OK = { ok: true, brand: null, workspaces: [], emails: [], brands: [], items: [], rows: [], runs: [], jobs: [],
  entries: [], campaigns: [], library: [], plan: [], data: [], results: [], list: [], presets: [], features: [], packs: [], providers: [] };
const REFUSALS = {
  'signed-out': { status: 401, body: { ok: false, error: 'sign_in_required', message: 'You are not signed in, so this could not be saved to your account.', hint: 'Send Authorization: Bearer <Supabase access token>.' } },
  unreachable: { status: 503, body: { ok: false, error: 'session_verification_unavailable', backend_unreachable: true, message: 'The database this deployment points at (deleted-project.supabase.co) is not answering, so sign-in cannot be checked.' } },
};

/* ── in-page instrumentation, installed before any page script runs ─────── */
function instrument(args) {
  var SW = window.__SW = {
    opens: 0, blobs: 0, clipboard: 0, storage: 0, prints: 0, records: [], added: [], idle: null,
    token: Math.random().toString(36).slice(2), preFail: null, preStatus: null, base: null,
  };
  // [data-ds-specimen]: a component SPECIMEN on /design-system (the failure
  // frame drawn so it can be seen) documents the frame; it is not the page failing.
  var IGN = '#lifecycle-nav, #lc-authnotice, .lc-credit-pill, .lc-credit-chip, .lc-credit-sheet, #vah-agent-fab, #vah-agent-panel, .vhd-agent-fab, .vhd-agent-overlay, #lnav-signin-note, #lc-popup-blocked, [data-ds-specimen]';
  var STATUS = '.vh-status, [data-needs-account], .ws-note, [role="status"], [role="alert"]';
  var TOAST = '#toast, .toast, [class*="toast"], .snack, .snackbar';
  function elOf(n) { return n && (n.nodeType === 1 ? n : n.parentElement); }
  function ignored(n) { var el = elOf(n); if (!el) return false; try { return !!el.closest(IGN); } catch (_) { return false; } }
  function vis(el) {
    if (!el || !el.isConnected) return false;
    try { if (el.closest('[hidden]')) return false; } catch (_) { return false; }
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false;
    var d = el.closest('details');
    if (d && !d.open && !(el.matches('summary') && el.parentElement === d)) return false;
    return true;
  }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function textOf(el) { return norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.title || '').slice(0, 60); }

  var obs = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'attributes' && (m.attributeName === 'data-credit-stamp' || m.attributeName === 'data-sw')) continue;
      if (ignored(m.target)) continue;
      SW.records.push({ t: m.target, type: m.type, attr: m.attributeName });
      if (m.type === 'childList') {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var a = m.addedNodes[j];
          if (a.nodeType === 1 && !ignored(a)) {
            var tx = norm(a.textContent);
            if (tx) SW.added.push({ text: tx.slice(0, 300), toast: !!(a.closest && a.closest(TOAST)) });
          } else if (a.nodeType === 3 && !ignored(a)) {
            var t3 = norm(a.textContent);
            if (t3) SW.added.push({ text: t3.slice(0, 300), toast: !!(a.parentElement && a.parentElement.closest(TOAST)) });
          }
        }
      } else if (m.type === 'characterData') {
        var el = m.target.parentElement;
        if (el && el.closest(TOAST)) SW.added.push({ text: norm(m.target.textContent).slice(0, 300), toast: true });
      }
    }
  });
  obs.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });

  function stubWin() { return { focus: function () {}, close: function () {}, closed: false, document: { open: function () {}, write: function () {}, close: function () {}, body: { innerHTML: '' }, head: {} }, location: { href: '' }, postMessage: function () {}, print: function () {} }; }
  window.open = function () { SW.opens++; return stubWin(); };
  var origCreate = URL.createObjectURL;
  URL.createObjectURL = function () { SW.blobs++; try { return origCreate.apply(URL, arguments); } catch (_) { return 'blob:stub'; } };
  window.print = function () { SW.prints++; };
  try { var origSet = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { SW.storage++; return origSet.call(this, k, v); }; } catch (_) {}
  try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: function () { SW.clipboard++; return Promise.resolve(); }, write: function () { SW.clipboard++; return Promise.resolve(); }, readText: function () { return Promise.resolve(''); } }, configurable: true }); } catch (_) {}
  var origExec = document.execCommand;
  document.execCommand = function (cmd) { if (/copy/i.test(cmd)) { SW.clipboard++; return true; } return origExec ? origExec.apply(document, arguments) : false; };

  try {
    localStorage.setItem(args.deviceKey, JSON.stringify(args.seed));
    // (c) a device-mode mobile+PIN session, seeded the way auth.js stores one
    // (tests/cross-brand-leak.spec.js does the same). A device session is valid
    // by construction: auth.js applies it without asking the server.
    if (args.session) {
      var expires = new Date(Date.now() + 80 * 86400000).toISOString();
      var users = {}; users[args.user.phone] = Object.assign({}, args.user, { salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: expires, pinSetAt: expires });
      localStorage.setItem('lifecycle.auth.device.users', JSON.stringify(users));
      localStorage.setItem('lifecycle.auth.session', JSON.stringify({
        token: 'DEVICEtokenFIXTURE0123456789abcdefghijklmnopq', mode: 'device', provider: 'mobile-pin',
        user: { id: args.user.id, name: args.user.name, phone: args.user.phone }, expires,
        storage: { mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' },
      }));
    } else {
      localStorage.removeItem('lifecycle.auth.session');
      localStorage.removeItem('lifecycle.auth.device.users');
    }
  } catch (_) {}

  // CDN libraries the harness blocks. Each is a no-op stand-in so a page that
  // draws a chart or parses a CSV is measured on ITS code, not on a missing
  // third-party global ("Chart is not defined" is the harness, not the page).
  function Noop() {}
  Noop.prototype.update = Noop.prototype.destroy = Noop.prototype.resize = function () {};
  Noop.register = function () {};
  // Chart.defaults is written at any depth (font.family, plugins.legend.labels.color):
  // an object that grows a branch for whatever is read.
  function auto() { return new Proxy({}, { get: function (t, k) { if (typeof k === 'symbol') return undefined; if (!(k in t)) t[k] = auto(); return t[k]; } }); }
  Noop.defaults = auto();
  window.Chart = window.Chart || Noop;
  window.ChartDataLabels = window.ChartDataLabels || {};
  window.Papa = window.Papa || { parse: function (_, o) { if (o && o.complete) o.complete({ data: [], errors: [] }); return { data: [], errors: [] }; }, unparse: function () { return ''; } };
  window.JSZip = window.JSZip || function () { var z = { file: function () { return z; }, folder: function () { return z; }, generateAsync: function () { return Promise.resolve(new Blob([''])); } }; return z; };
  window.marked = window.marked || { parse: function (s) { return String(s || ''); }, setOptions: function () {} };
  window.html2canvas = window.html2canvas || function () { return Promise.resolve(document.createElement('canvas')); };
  window.saveAs = window.saveAs || function () { SW.blobs++; };
  window.lucide = window.lucide || { createIcons: function () {} };

  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: async function () { return { data: { session: null } }; },
          getUser: async function () { return { data: { user: null } }; },
          onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          signInWithOAuth: async function () { return { error: null }; },
          signOut: async function () { return {}; },
        },
        from: function () {
          var q = { data: [], error: null };
          var b = {};
          ['select', 'eq', 'order', 'limit', 'insert', 'update', 'upsert', 'delete', 'in', 'neq', 'gte', 'lte', 'range'].forEach(function (k) { b[k] = function () { return b; }; });
          b.maybeSingle = async function () { return { data: null, error: null }; };
          b.single = async function () { return { data: null, error: { message: 'no session' } }; };
          b.then = function (res) { return Promise.resolve(q).then(res); };
          return b;
        },
        channel: function () { var c = { on: function () { return c; }, subscribe: function () { return c; }, unsubscribe: function () {} }; return c; },
        removeChannel: function () {},
      };
    },
  };

  // Real controls only: a .chip or .tab that is a <span> with no handler, no
  // role and no tabindex is a badge ("V2", "read-only", "3 Jul"), not a button.
  var SEL = 'button, [role="button"], [role="tab"], input[type="button"], input[type="submit"], input[type="reset"], select, summary, a, [onclick], [data-tab], [data-region-set], [data-market], [data-mkt], .step-pip, .tab[tabindex], .chip[tabindex]';
  function reasonFor(el) {
    var bits = [];
    if (el.title) bits.push(el.title);
    var d = el.getAttribute('aria-describedby');
    if (d) d.split(/\s+/).forEach(function (id) { var n = document.getElementById(id); if (n) bits.push(n.textContent); });
    var p = el.parentElement, hops = 0;
    while (p && hops < 3 && !bits.length) {
      var notes = p.querySelectorAll('.vh-status, [data-needs-account], .ws-note, .note, .hint, .muted, .marker, small, p');
      for (var i = 0; i < notes.length; i++) { if (notes[i] !== el && !notes[i].contains(el) && vis(notes[i]) && norm(notes[i].textContent).length > 12) { bits.push(notes[i].textContent); break; } }
      p = p.parentElement; hops++;
    }
    return norm(bits.join(' ')).slice(0, 220);
  }
  SW.enumerate = function () {
    var out = [], seen = {}, n = 0;
    var all = document.querySelectorAll(SEL);
    for (var k = 0; k < all.length; k++) {
      var el = all[k];
      if (el.closest(IGN)) continue;
      if (el.matches('#lnav-signin, [data-sw-skip], input[type="file"]')) continue;
      var t = textOf(el);
      if (/^(sign out|log out|logout|dismiss)$/i.test(t)) continue;
      var oc = el.getAttribute('onclick') || '';
      if (/signOut|location\.reload/.test(oc)) continue;
      if (!vis(el)) continue;
      if (!el.matches('button, select, a, input, summary') && el.querySelector(SEL)) continue;
      var tag = el.tagName.toLowerCase();
      var kind = 'click';
      var href = tag === 'a' ? (el.getAttribute('href') || '') : '';
      if (tag === 'a') {
        if (/^(https?:)?\/\//i.test(href) || /^mailto:|^tel:/i.test(href)) kind = 'external';
        else if (href && !/^#|^javascript:/i.test(href) && !oc && el.getAttribute('role') !== 'button') kind = 'link';
        else if (!href && !oc && !el.getAttribute('role') && !el.hasAttribute('data-tab')) continue;
      }
      if (tag === 'select') kind = el.options.length > 1 ? 'select' : 'inert-select';
      if (tag === 'input' && el.type === 'submit') kind = 'submit';
      if (tag === 'button' && el.type === 'submit' && el.form) kind = 'submit';
      var disabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');
      if (disabled) kind = 'disabled';
      var cls = typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).sort().join('.') : '';
      var sig = [tag, t.toLowerCase(), cls, oc.slice(0, 80), href.slice(0, 60), el.getAttribute('data-tab') || '', el.getAttribute('data-region-set') || '', el.getAttribute('data-market') || '', el.id ? '#' : '', kind].join('|');
      if (seen[sig]) { seen[sig].count++; continue; }
      var i = n++;
      el.setAttribute('data-sw', String(i));
      var row = { i: i, sig: sig, tag: tag, text: t, id: el.id || '', kind: kind, href: href, count: 1, reason: '',
        credit: el.getAttribute('data-credit-feature') || '',
        active: el.matches('.active, .is-active, .on, .selected, .current, [aria-selected="true"], [aria-pressed="true"], [aria-current]') };
      if (disabled) row.reason = reasonFor(el);
      seen[sig] = row; out.push(row);
    }
    return out;
  };
  SW.pageState = function () {
    var fails = [], raw = [];
    var f = document.querySelectorAll('.vh-failure');
    for (var i = 0; i < f.length; i++) if (vis(f[i]) && !f[i].closest(IGN)) fails.push(norm(f[i].textContent).slice(0, 240));
    var body = norm(document.body ? document.body.innerText : '');
    var m = body.match(/\b(sign_in_required|not_authenticated|session_verification_unavailable|operator_session_required|invalid_session|credits_require_account|unauthori[sz]ed|http 401)\b/i);
    if (m) raw.push(m[0]);
    var sess = (window.LifecycleAuth || {}).session || null;
    return {
      failures: fails, raw: raw,
      rail: norm((document.querySelector('.lnav-brandname') || {}).textContent),
      primary: document.documentElement.style.getPropertyValue('--brand-primary').trim(),
      kind: (window.LifecycleAuth && window.LifecycleAuth.backend || {}).kind || '',
      mode: window.BrandContext && window.BrandContext.mode || '',
      brandLayer: !!window.BrandContext,
      session: sess ? { provider: sess.provider, mode: sess.mode } : null,
      internal: !!(window.LifecycleAuth || {}).internal,
    };
  };
  // A TICKER mutates the same target in two consecutive windows; a load-time
  // settle (a fetch answering, the region bridge syncing chips) mutates in one.
  // Only what appears in BOTH windows is excluded from later verdicts - the
  // first cut kept everything seen in one window, and the calendar's day chips
  // (re-synced once by region-context.js on load) were then invisible to it.
  SW.sampleIdle = function () {
    var now = new Set(SW.records.map(function (r) { return r.t; }));
    if (!SW.idleA) { SW.idleA = now; SW.idle = new Set(); }
    else { SW.idle = new Set(Array.from(now).filter(function (t) { return SW.idleA.has(t); })); SW.idleA = null; }
    SW.idleInfo = Array.from(SW.idle).slice(0, 20).map(function (t) { var el = elOf(t); return el ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') : '?'; });
    SW.records = []; SW.added = [];
  };
  SW.snap = function () {
    SW.preFail = new Set(Array.prototype.filter.call(document.querySelectorAll('.vh-failure'), vis));
    SW.preStatus = new Set(Array.prototype.filter.call(document.querySelectorAll(STATUS), vis));
    SW.records = []; SW.added = [];
    SW.base = { opens: SW.opens, blobs: SW.blobs, clipboard: SW.clipboard, storage: SW.storage, prints: SW.prints, hash: location.hash, y: window.scrollY, href: location.href };
  };
  SW.read = function () {
    var novel = 0;
    for (var i = 0; i < SW.records.length; i++) if (!SW.idle || !SW.idle.has(SW.records[i].t)) novel++;
    var newFail = [], newStatus = [], statusHasAction = false;
    var f = document.querySelectorAll('.vh-failure');
    for (var a = 0; a < f.length; a++) if (vis(f[a]) && !f[a].closest(IGN) && !SW.preFail.has(f[a])) newFail.push(norm(f[a].textContent).slice(0, 240));
    var touched = new Set();
    var s = document.querySelectorAll(STATUS);
    for (var b = 0; b < s.length; b++) if (vis(s[b]) && !s[b].closest(IGN) && !SW.preStatus.has(s[b]) && !s[b].closest('.vh-failure')) touched.add(s[b]);
    for (var c = 0; c < SW.records.length; c++) {
      var el = elOf(SW.records[c].t);
      var st = el && el.closest && el.closest(STATUS);
      if (st && vis(st) && !st.closest(IGN) && !st.closest('.vh-failure') && !st.closest(TOAST)) touched.add(st);
    }
    touched.forEach(function (el) { var tx = norm(el.textContent).slice(0, 240); if (tx) { newStatus.push(tx); if (el.querySelector('a, button')) statusHasAction = true; } });
    var toast = SW.added.filter(function (x) { return x.toast; }).map(function (x) { return x.text; });
    var plain = SW.added.filter(function (x) { return !x.toast; }).map(function (x) { return x.text; });
    return {
      novel: novel, toast: toast.slice(0, 8), plain: plain.slice(0, 12), newFail: newFail, newStatus: newStatus, statusHasAction: statusHasAction,
      opens: SW.opens - SW.base.opens, blobs: SW.blobs - SW.base.blobs, clipboard: SW.clipboard - SW.base.clipboard,
      storage: SW.storage - SW.base.storage, prints: SW.prints - SW.base.prints,
      hash: location.hash !== SW.base.hash, scrolled: Math.abs(window.scrollY - SW.base.y) > 4, href: location.href, token: SW.token,
    };
  };
}

/* ── harness ─────────────────────────────────────────────────────────────── */
function setup(page, stateName, log) {
  const state = STATES[stateName];
  page.on('dialog', async (d) => { log.dialogs.push({ type: d.type(), message: d.message() }); await d.dismiss().catch(() => {}); });
  page.on('pageerror', (e) => log.errors.push(String(e.message || e) + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' ').replace(HOST, '').trim()));
  page.on('request', (r) => { if (r.url().includes('/api/')) log.inflight++; });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/')) { log.inflight = Math.max(0, log.inflight - 1); log.responses.push({ url: u.replace(HOST, ''), status: r.status() }); } });
  page.on('requestfailed', (r) => { if (r.url().includes('/api/')) log.inflight = Math.max(0, log.inflight - 1); });
  page.on('download', () => { log.downloads++; });

  return (async () => {
    await page.addInitScript(instrument, { seed: DEVICE_SEED, deviceKey: state.session ? 'lifecycle.brand.device.workspaces.' + DEVICE_USER.id : 'lifecycle.brand.device.workspaces', session: !!state.session, user: DEVICE_USER });
    await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
      const u = route.request().url();
      if (/\/auth\/v1\/health/.test(u)) {
        return state.reachable
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
          : route.abort('addressunreachable');
      }
      if (route.request().resourceType() !== 'script') return route.abort('failed');
      const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
      return route.fulfill({
        status: 200, contentType: 'text/javascript',
        body: esm
          ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
          : 'window.tailwind=window.tailwind||{};',
      });
    });
    await page.route(HOST + '/**', (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/lp/')) {
        const g = gateOf(u);
        const json = (body, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(body) });
        if (g === 'config') return json(state.config);
        if (g === 'auth') {
          // The mobile+PIN mount on a deployment with no DATABASE_URL: status
          // says "device", and every other op cannot run on the server.
          const op = u.searchParams.get('op') || '';
          if (op === 'status') return json(AUTH_STATUS);
          return json({ ok: false, error: 'no_database', mode: 'device', message: 'No database is configured on this deployment, so "' + op + '" cannot run on the server.' }, 503);
        }
        if (stateName === 'device-session' && REAL && Object.prototype.hasOwnProperty.call(A.ROUTERS, u.pathname)) return REAL(route);
        if (g === 'lp') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>lp</title><p>landing page</p>' });
        // Device-session (2026-09-30): the server admits the token as a device
        // principal and features run unmetered. Routers the harness does not
        // run in-process (kb, competitor, ai/image, the pipeline) are answered
        // in the shape those pages read (ok + reply), not a 401.
        const modelAction = /\/api\/brain$/.test(u.pathname) && BRAIN_MODEL.has(u.searchParams.get('action') || '');
        if (g === 'gated' || (modelAction && stateName === 'device-session')) {
          if (stateName === 'device-session') {
            return json(Object.assign({}, GENERIC_OK, {
              ok: true, reply: 'Local demo reply.', answer: 'Local demo reply.',
              unmetered: true, mode: 'device',
              message: 'Local / Demo Mode: features run without a database.',
              credits: { charged: 0 },
            }));
          }
          return json(REFUSALS[state.reachable ? 'signed-out' : 'unreachable'].body, REFUSALS[state.reachable ? 'signed-out' : 'unreachable'].status);
        }
        if (u.searchParams.get('action') === 'brand' && u.searchParams.get('op') === 'presets') {
          return json(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'index.json'), 'utf8')));
        }
        // The public registries answer their real shape: a page that renders
        // nothing from a generic {ok:true} is the harness's doing, not the page's.
        if (u.searchParams.get('action') === 'telesuite') {
          return json({ ok: true, subfeatures: TELESUITE.SUBFEATURES, groups: [...new Set(TELESUITE.SUBFEATURES.map((s) => s.group))], prices: [] });
        }
        return json(GENERIC_OK);
      }
      const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    });
  })();
}

async function load(page, file) {
  await page.goto(HOST + '/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.LifecycleAuth && window.LifecycleAuth.backend && window.LifecycleAuth.backend.kind !== 'pending'
    && (!window.BrandContext || window.BrandContext.loaded), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);
}

/** Two windows; only a target mutated in both is a ticker (see instrument()). */
async function sampleIdle(page) {
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__SW.sampleIdle());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__SW.sampleIdle());
}

const RAW = /\b(sign_in_required|not_authenticated|session_verification_unavailable|operator_session_required|invalid_session|credits_require_account|unauthori[sz]ed|http 401|status 401)\b/i;
const SIGN = /\bsign(?:ed)?[ -]?(?:in|out)\b|\byour account\b|\ban account\b|\bneeds your account\b|\bdatabase\b|\bthis device\b|\bwallet\b|\bmobile-number\b/i;
// Chrome the page runs in the background, not a consequence of the press: the
// credit pill's balance poll and the sign-in panel's status ask. A 401 from one
// of these landing during a click window is not that control's outcome.
const BACKGROUND = /action=credits&op=balance|action=auth&op=status|\/auth\/v1\/health/;

function classify(ctl, r, d) {
  if (d.dialogs.some((x) => x.type === 'alert')) return { cls: 'dialog', defect: true, text: d.dialogs.map((x) => x.message).join(' | ') };
  if (d.errors.length) return { cls: 'pageerror', defect: true, text: d.errors[0] };
  if (d.navigated) {
    const u = new URL(d.navigated);
    if (u.pathname === '/' || /\/index\.html$/.test(u.pathname) || /\/auth\/|sign-?in|login/i.test(d.navigated)) return { cls: 'redirected', defect: true, text: d.navigated };
    return { cls: 'navigated', defect: false, text: u.pathname + u.search };
  }
  if (d.reloaded) return ctl.kind === 'submit' ? { cls: 'form-reload', defect: true, text: 'the form submitted and reloaded the page' } : { cls: 'reloaded', defect: false, text: '' };
  if (r.newFail.length) return { cls: 'failure', defect: true, text: r.newFail[0] };
  const st = r.newStatus.join(' | ');
  if (r.newStatus.length) {
    if (RAW.test(st)) return { cls: 'raw-code', defect: true, text: st };
    if (SIGN.test(st)) return { cls: 'needs-signin', defect: false, text: st, action: r.statusHasAction };
    return { cls: 'status', defect: false, text: st };
  }
  const toast = r.toast.join(' | ');
  const plain = r.plain.join(' | ');
  if (RAW.test(toast) || RAW.test(plain)) return { cls: 'raw-code', defect: true, text: toast || plain };
  if (SIGN.test(toast) && !/\bsaved\b|\bon this device\b/i.test(toast)) return { cls: 'toast-only', defect: true, text: toast };
  const own = d.responses.filter((q) => !BACKGROUND.test(q.url));
  const refused = own.filter((q) => q.status === 401 || q.status === 403 || q.status === 503);
  const confirmed = d.dialogs.some((x) => x.type === 'confirm' || x.type === 'prompt' || x.type === 'beforeunload');
  if (confirmed) return { cls: 'confirm-guard', defect: false, text: d.dialogs[0].message.slice(0, 80) };
  const moved = r.novel > 0 || r.opens || r.blobs || r.clipboard || r.storage || r.prints || r.hash || r.scrolled || d.downloads;
  if (moved) return { cls: 'changed', defect: false, text: refused.length ? 'after a ' + refused[0].status : (r.plain[0] || '').slice(0, 80), got401: refused.length > 0 };
  if (refused.length) return { cls: 'silent-401', defect: true, text: refused.map((q) => q.status + ' ' + q.url).join(' | ') };
  // A <select> is an input: its value changing IS the visible outcome, and
  // what it feeds (the next generation, the next filter) may have nothing to
  // redraw yet.
  if (ctl.kind === 'select') return { cls: 'input', defect: false, text: '' };
  if (ctl.active) return { cls: 'already-active', defect: false, text: '' };
  return { cls: 'no-op', defect: true, text: '' };
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const rowLine = (r) => `  ${r.defect ? '✗' : ' '} ${pad(r.cls, 20)} ${pad(r.control, 52)} ${r.text ? '· ' + r.text.slice(0, r.defect ? 180 : 90) : ''}`;

/** Sweep one page in one state. Appends one row per activation to `rows`. */
async function sweepPage(page, file, stateName, log, rows) {
  const mine = [];
  const push = (control, cls, defect, text, extra) => {
    const row = Object.assign({ page: file, state: stateName, control, cls, defect: !!defect, text: (text || '').slice(0, 200) }, extra || {});
    rows.push(row); mine.push(row);
  };
  // Printed per page as it finishes, so a run cut short still leaves its table.
  const done = () => { console.log(`\n▸ ${file} [${stateName}]`); for (const r of mine) console.log(rowLine(r)); };
  try { await sweepPageInner(page, file, stateName, log, push); } finally { done(); }
}

async function sweepPageInner(page, file, stateName, log, push) {
  log.dialogs.length = 0; log.errors.length = 0; log.responses.length = 0; log.downloads = 0; log.inflight = 0;
  await load(page, file);

  // ── the page itself ──
  const url = new URL(page.url());
  if (url.pathname !== '/' + file) { push('(load)', 'redirected', true, page.url()); return; }
  const ps = await page.evaluate(() => window.__SW.pageState());
  const want = STATES[stateName];
  if (ps.kind !== want.kind) push('(load)', 'fixture', true, `backend kind is "${ps.kind}", expected "${want.kind}"`);
  if (want.session && !(ps.session && ps.session.provider === 'mobile-pin' && ps.session.mode === 'device')) push('(load)', 'fixture', true, `no device-mode mobile+PIN session: ${JSON.stringify(ps.session)}`);
  if (!want.session && ps.session) push('(load)', 'fixture', true, `a session appeared without signing in: ${JSON.stringify(ps.session)}`);
  if (ps.internal) push('(load)', 'fixture', true, 'a visitor was granted internal access');
  // The device brand paints wherever the brand layer runs (the --brand-primary
  // token is the proof: the rail's name span is absent on a few pages that
  // draw their own header); a page without brand-context.js has nothing to
  // paint and is recorded, not failed.
  if (ps.brandLayer && ps.primary.toLowerCase() !== PRESET.palette.primary.toLowerCase()) push('(load)', 'fixture', true, `--brand-primary is "${ps.primary}", not the device brand's ${PRESET.palette.primary}`);
  if (!ps.brandLayer) push('(load)', 'no-brand-layer', false, 'page does not load brand-context.js');
  if (log.dialogs.some((d) => d.type === 'alert')) push('(load)', 'dialog', true, log.dialogs.map((d) => d.message).join(' | '));
  const loadErrors = log.errors.filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e));
  if (loadErrors.length) push('(load)', 'pageerror', true, loadErrors[0]);
  for (const f of ps.failures) push('(load)', 'load-failure', true, f);
  if (ps.raw.length) push('(load)', 'load-raw-code', true, ps.raw.join(', '));
  log.dialogs.length = 0; log.errors.length = 0; log.responses.length = 0;

  // ── the controls ──
  let controls = await page.evaluate(() => window.__SW.enumerate());
  await sampleIdle(page);
  if (process.env.SWEEP_DEBUG) console.log('   · idle:', JSON.stringify(await page.evaluate(() => window.__SW.idleInfo)));
  if (!controls.length) { push('(controls)', 'none', false, 'no visible control on this page'); return; }

  for (let idx = 0; idx < controls.length; idx++) {
    const ctl = controls[idx];
    const label = `${ctl.tag}${ctl.id ? '#' + ctl.id : ''} "${ctl.text || ctl.href || ctl.sig.split('|')[3] || ''}"` + (ctl.count > 1 ? ` ×${ctl.count}` : '');
    if (ctl.kind === 'external') { push(label, 'link-external', false, ctl.href); continue; }
    if (ctl.kind === 'link') { const ok = destinationExists(ctl.href); push(label, ok ? 'link' : 'link-dead', !ok, ctl.href); continue; }
    if (ctl.kind === 'inert-select') { push(label, 'inert-select', false, 'one option'); continue; }
    if (ctl.kind === 'disabled') {
      const reason = ctl.reason;
      push(label, reason ? 'disabled-with-reason' : 'disabled-no-reason', false, reason, { credit: ctl.credit });
      continue;
    }

    const loc = page.locator(`[data-sw="${ctl.i}"]`).first();
    if (!(await loc.count())) { push(label, 'gone', false, 're-rendered away before it was pressed'); continue; }
    await page.evaluate(() => window.__SW.snap());
    const before = { dialogs: log.dialogs.length, errors: log.errors.length, responses: log.responses.length, downloads: log.downloads };
    const hrefBefore = page.url();
    let how = 'pointer';
    try {
      if (ctl.kind === 'select') {
        await loc.evaluate((el) => { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
        how = 'select';
      } else {
        await loc.scrollIntoViewIfNeeded({ timeout: 800 }).catch(() => {});
        try { await loc.click({ timeout: 900, noWaitAfter: true }); }
        catch (e) {
          if (!/intercepts pointer events|Timeout|not visible|outside of the viewport|detached|not attached|hidden/i.test(String(e.message))) throw e;
          how = 'dispatched';
          await loc.evaluate((el) => el.click());
        }
      }
    } catch (e) {
      push(label, 'unpressable', true, String(e.message).split('\n')[0]);
      continue;
    }
    // Let the handler run. A synchronous one shows within a frame; one that
    // asked the server shows only after the answer, so the read waits for
    // every API request the press started to settle (plus a beat to render),
    // capped - the first cut read "Generate plan" 150 ms in, saw the button
    // say "Generating…", and missed the failure frame the 401 then drew.
    let r = null;
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(i === 0 ? 150 : 200);
      r = await page.evaluate(() => window.__SW.read()).catch(() => null);
      if (!r) break;
      const elapsed = Date.now() - t0;
      if (log.inflight > 0 && elapsed < 3000) continue;
      if (log.responses.length > before.responses && elapsed < 450) continue;   // answered: let it paint
      if (r.novel || r.newFail.length || r.newStatus.length || r.opens || r.blobs || r.clipboard || r.storage || r.prints || r.hash || log.dialogs.length > before.dialogs || log.errors.length > before.errors) break;
      if (elapsed >= 1200) break;
    }
    const nowUrl = page.url();
    const pathChanged = (() => { try { return new URL(nowUrl).pathname !== new URL(hrefBefore).pathname; } catch (_) { return nowUrl !== hrefBefore; } })();
    const reloaded = !r || (r.token !== (await page.evaluate(() => window.__SW && window.__SW.token).catch(() => null)));
    const delta = {
      dialogs: log.dialogs.slice(before.dialogs), errors: log.errors.slice(before.errors).filter((e) => !/ResizeObserver|Failed to fetch|NetworkError|net::ERR/i.test(e)),
      responses: log.responses.slice(before.responses), downloads: log.downloads - before.downloads,
      navigated: pathChanged ? nowUrl : null, reloaded: !pathChanged && reloaded,
    };
    const out = classify(ctl, r || { novel: 0, newFail: [], newStatus: [], toast: [], plain: [] }, delta);
    push(label, out.cls, out.defect, out.text, { how, credit: ctl.credit, got401: !!out.got401, action: out.action });
    if (process.env.SWEEP_DEBUG) console.log('   ·', label, how, JSON.stringify({ r, delta }).slice(0, 600));
    if (process.env.SWEEP_PROBE) console.log('   · probe:', await page.evaluate((expr) => { try { return String(eval(expr)); } catch (e) { return 'probe threw: ' + e.message; } }, process.env.SWEEP_PROBE));

    // A navigation or a reload throws the markers away: reopen and re-mark.
    if (pathChanged || reloaded) {
      await load(page, file);
      const again = await page.evaluate(() => window.__SW.enumerate());
      const byIndex = again[idx + 1] && again[idx + 1].sig === (controls[idx + 1] || {}).sig;
      if (!byIndex) {
        const bySig = new Map(again.map((c) => [c.sig, c]));
        for (let k = idx + 1; k < controls.length; k++) { const m = bySig.get(controls[k].sig); if (m) controls[k].i = m.i; else controls[k].kind = 'gone'; }
      }
      await sampleIdle(page);
      log.dialogs.length = 0; log.errors.length = 0; log.responses.length = 0;
    }
  }
}

/* ── the table ───────────────────────────────────────────────────────────── */
function printTable(title, rows) {
  console.log(`\n${'═'.repeat(110)}\n${title}\n${'═'.repeat(110)}`);
  const counts = {};
  for (const r of rows) counts[r.cls] = (counts[r.cls] || 0) + 1;
  console.log(`\n${title}: ${rows.length} activations across ${new Set(rows.map((r) => r.page)).size} pages`);
  Object.keys(counts).sort().forEach((k) => console.log(`  ${pad(k, 22)} ${counts[k]}`));
  console.log(`  defects: ${rows.filter((r) => r.defect).length}`);
}

/* ═══ the sweep is real ══════════════════════════════════════════════════════ */

test('the page list is real', () => {
  expect(PAGES.length, 'no pages carrying auth.js were found').toBeGreaterThan(40);
  expect(PAGES).toContain('smart-brain.html');
  expect(PAGES).toContain('lifecycle_mailer_architect_v34.html');
  expect(PAGES).toContain('onboarding.html');
  expect(PRESET.name).toBe('The Times of India');
  expect(PRESET.palette.primary.toLowerCase()).not.toBe('#d0473e');   // not tenant zero
});

/* ═══ every page, every control, two configurations ═════════════════════════ */

// SWEEP_PAGES=a.html,b.html narrows a local run while iterating on one page;
// CI never sets it, so the gate always drives the whole list.
const ONLY = (process.env.SWEEP_PAGES || '').split(',').map((s) => s.trim()).filter(Boolean);
const SWEEP = ONLY.length ? PAGES.filter((f) => ONLY.includes(f)) : PAGES;
const HALVES = [
  ['a-l', SWEEP.filter((f) => /^[a-l]/i.test(f))],
  ['m-z', SWEEP.filter((f) => !/^[a-l]/i.test(f))],
].filter(([, files]) => files.length);

test.beforeAll(async () => { REAL_WORLD = await A.world({ serverMode: false }); REAL = A.forward(REAL_WORLD.port); });
test.afterAll(async () => { if (REAL_WORLD) await REAL_WORLD.close(); REAL = null; REAL_WORLD = null; });

for (const stateName of Object.keys(STATES)) {
  for (const [half, files] of HALVES) {
    test(`${stateName}: every control on pages ${half} works, says what needs sign-in, or is disabled with its reason`, async ({ page }) => {
      test.setTimeout(2_400_000);
      const log = { dialogs: [], errors: [], responses: [], downloads: 0, inflight: 0 };
      await setup(page, stateName, log);
      const rows = [];
      for (const f of files) {
        try { await sweepPage(page, f, stateName, log, rows); }
        catch (e) { rows.push({ page: f, state: stateName, control: '(sweep)', cls: 'harness', defect: true, text: String(e.message).split('\n')[0].slice(0, 200) }); }
      }
      printTable(`${stateName} · pages ${half}`, rows);

      // Measured something, on every page, before any verdict.
      expect(new Set(rows.map((r) => r.page)).size, 'the sweep did not reach every page').toBe(files.length);
      const driven = rows.filter((r) => !['link', 'link-external', 'inert-select', 'none', 'no-brand-layer'].includes(r.cls) && !/^\(/.test(r.control));
      expect(driven.length, 'too few controls were driven to mean anything').toBeGreaterThan(files.length * 2);
      expect(rows.some((r) => r.control === '(load)' && r.cls === 'fixture'), 'the fixture never reached the page').toBe(false);
      // Each outcome class the contract allows was seen at least once.
      expect(rows.filter((r) => r.cls === 'changed').length, 'no control worked locally').toBeGreaterThan(30);
      if (stateName !== 'device-session') {
        expect(rows.filter((r) => r.cls === 'needs-signin').length, 'no control said what needs sign-in').toBeGreaterThan(0);
      }
      expect(rows.filter((r) => r.cls === 'disabled-with-reason').length, 'no disabled control carried its reason').toBeGreaterThan(0);

      // SIGNING IN WITH A PHONE NEVER TURNS A FEATURE OFF (2026-10-03). For a
      // visitor, "says what needs sign-in" and "disabled with its reason" are
      // the contract. For a person who IS signed in they are the defect the
      // operator reported: a control that is off, or a sentence refusing it,
      // because of the account they signed in with. An informational line
      // ("Signed in as ... saved on this device") is not a refusal.
      if (stateName === 'device-session') {
        const PHONE_REFUSAL = /not available|needs your (account|sign-?in)|sign in with|you are signed out|cannot (be )?(check|verif)|has no (wallet|record|workspace)|not offered/i;
        for (const r of rows) {
          if ((r.cls === 'needs-signin' || /^disabled/.test(r.cls)) && PHONE_REFUSAL.test(r.text)) { r.defect = true; r.cls = 'off-for-phone'; }
        }
      }
      const defects = rows.filter((r) => r.defect).map((r) => `${r.page} · ${r.control} · ${r.cls}${r.text ? ' · ' + r.text.slice(0, 120) : ''}`);
      expect(defects, `\n  ${defects.join('\n  ')}\n`).toEqual([]);
    });
  }
}
