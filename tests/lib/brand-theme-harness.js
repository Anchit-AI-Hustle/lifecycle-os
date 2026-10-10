'use strict';
/**
 * The harness behind tests/brand-theme-every-page.spec.js: every app page,
 * rendered in Chromium under a device brand, measured for what a person sees.
 *
 *   PALETTES      five brands, chosen to break things: tenant zero, a red
 *                 primary on white (the operator's "Deli Chic" shape), a pale
 *                 primary, a near-black primary, and a bare record with no
 *                 palette at all.
 *   appPages()    every app page, ENUMERATED (never a hand-kept list): the root
 *                 *.html files plus every vercel.json rewrite/redirect target,
 *                 kept when the page loads the shell (auth.js or
 *                 brand-context.js) - a page that loads neither cannot wear a
 *                 brand at all, and is an artefact with its own gate.
 *   install()     serves the repo as a real host with production's state:
 *                 DEVICE mode (no DATABASE_URL), a mobile+PIN session kept on
 *                 this device, and the brand ACTIVE in that account's device
 *                 store - exactly how the operator's screenshot was taken.
 *   PROBE         the in-page measurement (see its header).
 *   attribute()   for the inventory only: the stylesheet / inline style and
 *                 the source LINE that set each failing colour, read through
 *                 the DevTools protocol (CSS.getMatchedStylesForNode).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HOST = 'http://app.example.test';
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.md': 'text/markdown', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
};

/* ── the brands ───────────────────────────────────────────────────────────── */
const TENANT_ZERO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', '_default.json'), 'utf8'));
const HOME_US = [{ code: 'US', currency: 'USD', symbol: '$', store_url: 'https://shop.example.test', home: true }];

/**
 * Each palette is a brand an operator could really set up. Typography differs
 * per brand on purpose: a page that hardcodes tenant zero's families shows up
 * as a foreign font under every other brand.
 */
const PALETTES = {
  'tenant-zero': {
    name: TENANT_ZERO.name, slug: TENANT_ZERO.slug, palette: TENANT_ZERO.palette,
    typography: TENANT_ZERO.typography, regions: TENANT_ZERO.regions, tenantZero: true,
  },
  // The operator's report: a red-primary brand on a white surface. Mustard as
  // the accent, which is a LIGHT accent - unreadable as text unless derived.
  'red-primary': {
    name: 'Crimson Deli Fixture', slug: 'crimson-deli-fixture',
    palette: { primary: '#c8102e', accent: '#e0a526', ink: '#1d1d1b', surface: '#ffffff', surface_alt: '#fbf7f2', muted: '#5f5a55' },
    typography: {
      heading: { family: 'Playfair Display', stack: "'Playfair Display',Georgia,serif" },
      body: { family: 'Work Sans', stack: "'Work Sans',Helvetica,Arial,sans-serif" },
    },
    regions: HOME_US,
  },
  // A primary that is invisible as text on white, and (no accent) an accent
  // that is the same pale colour.
  pale: {
    name: 'Pale Harbour Fixture', slug: 'pale-harbour-fixture',
    palette: { primary: '#ecf0f4', ink: '#1f2328', surface: '#ffffff' },
    typography: {
      heading: { family: 'Fraunces', stack: "'Fraunces',Georgia,serif" },
      body: { family: 'Inter', stack: "'Inter',system-ui,sans-serif" },
    },
    regions: HOME_US,
  },
  // A near-black primary: a CONTROL may be this dark, a SECTION may not.
  'near-black': {
    name: 'Onyx Supply Fixture', slug: 'onyx-supply-fixture',
    palette: { primary: '#141414', ink: '#141414', surface: '#ffffff' },
    typography: {
      heading: { family: 'Space Grotesk', stack: "'Space Grotesk',system-ui,sans-serif" },
      body: { family: 'IBM Plex Sans', stack: "'IBM Plex Sans',system-ui,sans-serif" },
    },
    regions: HOME_US,
  },
  // A record that carries no palette and no typography at all.
  bare: {
    name: 'Bare Record Fixture', slug: 'bare-record-fixture',
    palette: {}, typography: {}, regions: HOME_US,
  },
};

/** The tokens the server derives for a palette - the SAME function, not a copy. */
function tokensOf(name) {
  const b = paletteDef(name);
  return core.tokens({ palette: b.palette, typography: b.typography });
}

/* Colours that belong to another brand. Tenant zero's palette and the text
   form the token derivation gives its red; the sibling tea brand this repo was
   forked from (forest green, gold, its near-black band). None may be painted
   while ANOTHER brand is active. */
const TENANT_ZERO_HEX = ['#d0473e', '#6a33d8', '#c6433b'];
const SIBLING_HEX = ['#004a2b', '#ab8743', '#0a1f13'];

/* ── the pages ────────────────────────────────────────────────────────────── */
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
function loadsShell(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return {
    auth: /<script[^>]+src=["'][^"']*\bauth\.js/.test(src),
    brand: /<script[^>]+src=["'][^"']*\bbrand-context\.js/.test(src),
    refresh: /<meta[^>]+http-equiv=["']refresh/i.test(src),
  };
}
/**
 * Every app page: root *.html + every rewrite/redirect destination that is an
 * HTML file, kept when it loads the shell. Returns [{ file, why }] for the kept
 * ones and the excluded ones separately, so the spec can assert the exclusion
 * reasons rather than trusting them.
 */
/* Pages that are deliberately NOT themed, each with the reason. Decided by the
   operator's coordinator on 2026-10-05; the spec re-checks the reason against
   the code that implements it. */
const FROZEN = {
  'diff-version.html': "tenant zero's own frozen before/after snapshot (CLAUDE.md: Tenant zero's OWN artefacts = the frozen diff-version snapshot); auth.js exempts it from theme.css by design, and the content audit keeps other brands from seeing it",
};
function appPages() {
  const candidates = new Set(fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')));
  for (const r of [...(VERCEL.rewrites || []), ...(VERCEL.redirects || [])]) {
    const d = String(r.destination || '').split('?')[0].split('#')[0].replace(/^\//, '');
    if (d.endsWith('.html') && fs.existsSync(path.join(ROOT, d))) candidates.add(d);
  }
  const kept = [], excluded = [];
  for (const file of [...candidates].sort()) {
    const s = loadsShell(file);
    if (file.startsWith('_')) { excluded.push({ file, why: 'underscore fixture, not served as a page' }); continue; }
    if (s.refresh && !s.auth) { excluded.push({ file, why: 'meta-refresh stub onto another page' }); continue; }
    if (FROZEN[file]) { excluded.push({ file, why: FROZEN[file] }); continue; }
    if (!s.auth && !s.brand) { excluded.push({ file, why: 'loads neither auth.js nor brand-context.js: a generated artefact, not the app' }); continue; }
    kept.push(file);
  }
  return { kept, excluded };
}

/*
 * Brands a spec defines for itself (define()), kept OUT of PALETTES: every
 * spec in a worker shares this module, and brand-theme-every-page sweeps
 * Object.keys(PALETTES) - a brand added there by another spec would join its
 * sweep and move its baseline.
 */
const EXTRA = {};
function define(name, def) { EXTRA[name] = def; return name; }
function paletteDef(name) { return PALETTES[name] || EXTRA[name]; }

/* ── the host ─────────────────────────────────────────────────────────────── */
const DEVICE_USER = { id: 'dev-theme0001', phone: '+919876543210', name: 'Theme Sweep' };
const AUTH_STATUS = { ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' };
const GENERIC_OK = {
  ok: true, brand: null, workspaces: [], emails: [], brands: [], items: [], rows: [], runs: [], jobs: [], entries: [],
  campaigns: [], library: [], plan: [], data: [], results: [], list: [], presets: [], features: [], packs: [], providers: [],
};

function deviceRow(name) {
  const b = paletteDef(name);
  const id = 'local-theme' + name.replace(/[^a-z0-9]/g, '').slice(0, 12).padEnd(12, '0');
  // `record` (optional): the rest of a full brand record - tagline, website,
  // voice, claims, legal entity - for a spec that measures CONTENT as well as
  // colour (tests/brand-content-invariant.spec.js). The row's own identity
  // fields below always win.
  const extra = Object.assign({}, b.record || {});
  for (const k of ['id', 'slug', 'storage', 'status', 'onboarding_step', 'owner_id', 'created_at', 'updated_at', 'catalogue']) delete extra[k];
  return Object.assign({
    id, slug: b.slug, name: b.name, legal_name: null, tagline: '', industry: '', website: '',
    logo_url: null, favicon_url: null, palette: b.palette, typography: b.typography, voice: {},
    regions: b.regions, asset_hosts: [], catalog_source: {}, brand_data: {},
  }, extra, {
    id, slug: b.slug, status: 'active', onboarding_step: 6, owner_id: null,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', storage: 'device',
  });
}

function seed(args) {
  try {
    localStorage.clear();
    // The active brand is kept on THIS DEVICE for a signed-out visitor - the
    // state production is in, and the only device state since 2026-10-10,
    // when the mobile-number sign-in that used to seed a per-account
    // namespace here was switched off (Google is the only sign-in).
    localStorage.setItem('lifecycle.brand.device.workspaces', JSON.stringify({ version: 1, active_id: args.row.id, workspaces: [args.row] }));
  } catch (_) { /* a page with no storage is measured as it is */ }
  // CDN globals the host refuses, as no-ops, so a page is measured on its own
  // code ("Chart is not defined" is the harness, not the page).
  function Noop() {}
  Noop.prototype.update = Noop.prototype.destroy = Noop.prototype.resize = function () {};
  Noop.register = function () {};
  function auto() { return new Proxy({}, { get: function (t, k) { if (typeof k === 'symbol') return undefined; if (!(k in t)) t[k] = auto(); return t[k]; } }); }
  Noop.defaults = auto();
  window.Chart = window.Chart || Noop;
  window.ChartDataLabels = window.ChartDataLabels || {};
  window.Papa = window.Papa || { parse: function (_, o) { if (o && o.complete) o.complete({ data: [], errors: [] }); return { data: [], errors: [] }; }, unparse: function () { return ''; } };
  window.JSZip = window.JSZip || function () { var z = { file: function () { return z; }, folder: function () { return z; }, generateAsync: function () { return Promise.resolve(new Blob([''])); } }; return z; };
  window.marked = window.marked || { parse: function (s) { return String(s || ''); }, setOptions: function () {} };
  window.html2canvas = window.html2canvas || function () { return Promise.resolve(document.createElement('canvas')); };
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
}

/** Serve the repo as production serves it to a phone sign-in, with `name` active. */
async function install(page, name, log) {
  const row = deviceRow(name);
  if (log) {
    page.on('pageerror', (e) => log.errors.push(String(e.message || e)));
    page.on('dialog', (d) => { log.dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  } else {
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
  }
  await page.addInitScript(seed, { user: DEVICE_USER, row });
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const type = route.request().resourceType();
    if (type === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    if (type !== 'script') return route.abort('failed');
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
    const json = (b, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/lp/') || u.pathname.startsWith('/_vercel/')) {
      const action = u.searchParams.get('action') || '';
      const op = u.searchParams.get('op') || '';
      if (/\/api\/public-config$/.test(u.pathname) && !action) return json({ supabase: { url: 'https://live.supabase.co', anonKey: 'anon' } });
      if (action === 'auth') return op === 'status' ? json(AUTH_STATUS) : json({ ok: false, error: 'no_database', mode: 'device', message: 'No database is configured on this deployment.' }, 503);
      if (action === 'brand' && op === 'presets') return json(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'index.json'), 'utf8')));
      if (u.pathname.startsWith('/_vercel/')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      return json(Object.assign({}, GENERIC_OK, { reply: 'Local demo reply.', answer: 'Local demo reply.', unmetered: true, mode: 'device' }));
    }
    let p = decodeURIComponent(u.pathname);
    const rw = (VERCEL.rewrites || []).find((r) => r.source === p);
    if (rw) p = rw.destination.split('?')[0];
    const f = path.join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  return row;
}

/**
 * Open a page and wait until the ACTIVE brand is painted - the exact primary
 * the server derives for it, not merely "some" primary, so a page measured on
 * theme.css's built-in defaults (tenant zero) cannot pass as the brand.
 * Returns whether the brand painted; a page where it never does is itself a
 * finding (the page does not wear the brand at all).
 */
async function open(page, file, name) {
  const want = tokensOf(name)['--brand-primary'].toLowerCase();
  await page.goto(HOST + '/' + file, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 30000 }).catch(() => {});
  const painted = await page.waitForFunction((w) => {
    const v = document.documentElement.style.getPropertyValue('--brand-primary').trim().toLowerCase();
    const bc = window.BrandContext;
    return v === w && (!bc || bc.loaded);
  }, want, { timeout: 20000 }).then(() => true, () => false);
  // Let first-render work finish (a page draws its panels after the brand
  // arrives), then let any reveal animation run out.
  await page.waitForTimeout(900);
  return painted;
}

/* ── the measurement ──────────────────────────────────────────────────────── */
/**
 * Runs in the page with cfg = { tokens, forbidden: [{hex,label}], hues: [deg],
 * fonts: [family], tag }. Measures, over the WHOLE document (not just the
 * viewport), resolving inheritance, every inherited opacity and every
 * translucent or gradient ground on the way down to an opaque one:
 *
 *   text      every element with its own visible text: WCAG contrast against
 *             its effective ground, 4.5:1, 3:1 at 24px+ or 18.66px bold. A
 *             gradient ground is judged at its WORST stop; a ground that is a
 *             photograph cannot be measured and is counted, not passed.
 *   grounds   every painted panel (not a control) of at least 120x40: it may
 *             not be a dark neutral (the validatePalette rule) - composited, so
 *             a translucent black band over white counts as the grey it is.
 *   foreign   every chromatic colour painted as text, ground, border or icon
 *             must carry the hue of a brand token (primary, accent, ok, warn,
 *             err - mixing a colour with white, black or grey keeps its hue,
 *             so every tint and shade of a token passes). Anything else is a
 *             page-local literal or another brand's colour.
 *   forbidden tenant zero's and the sibling's exact hexes, anywhere they are
 *             painted (incl. shadows), when another brand is active.
 *   fonts     every text run's first family must be the brand's heading,
 *             body or mono family, or a generic/system one.
 *   chrome    the tokens the shell resolves (--brand-primary on <html>,
 *             theme.css's --vh-green) and every primary button's ground.
 *
 * Every failing element is tagged data-bt="<n>" so attribute() can find the
 * rule that coloured it.
 */
const PROBE = `(async (cfg) => {
  const AA = 4.5, AA_LARGE = 3.0;
  const cache = new Map();
  const cs = (el) => { let s = cache.get(el); if (!s) { s = getComputedStyle(el); cache.set(el, s); } return s; };
  const COLOR_RX = /rgba?\\([^)]*\\)/g;
  function parse(c) {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].replace(/\\//g, ',').split(/[ ,]+/).filter(Boolean).map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => ('0' + Math.round(v).toString(16)).slice(-2)).join('');
  const rgbOfHex = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1 });
  function hsl(c) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    if (!d) return { h: 0, s: 0, l, chroma: 0 };
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return { h, s, l, chroma: d * 255 };
  }
  const chromatic = (c) => { const x = hsl(c); return x.chroma >= 30 && x.s >= 0.2; };
  const isDarkNeutral = (c) => lum(c) < 0.12 && hsl(c).s < 0.25;
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const HUES = cfg.hues;
  const brandHue = (c) => { const h = hsl(c).h; return HUES.some((t) => hueDist(h, t) <= 14); };
  const FORBID = cfg.forbidden.map((f) => Object.assign({ c: rgbOfHex(f.hex) }, f));
  const forbiddenOf = (c) => FORBID.find((f) => Math.abs(f.c.r - c.r) <= 1 && Math.abs(f.c.g - c.g) <= 1 && Math.abs(f.c.b - c.b) <= 1);

  let tagN = 0;
  const tag = (el) => { let t = el.getAttribute('data-bt'); if (!t) { t = cfg.tag + (tagN++); el.setAttribute('data-bt', t); } return t; };
  function path(el) {
    const bits = [];
    let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 4; i++) {
      let s = n.tagName.toLowerCase();
      if (n.id) { bits.unshift(s + '#' + n.id); break; }
      const cls = typeof n.className === 'string' ? n.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2) : [];
      if (cls.length) s += '.' + cls.join('.');
      bits.unshift(s);
      n = n.parentElement;
    }
    return bits.join(' > ');
  }
  const CHROME = '#lifecycle-nav, #lc-authnotice, .lc-credit-pill, .lc-credit-sheet, #lnav-ipanel';
  const inChrome = (el) => { try { return !!el.closest(CHROME); } catch (_) { return false; } };
  /* The worst contrast of a text colour, at its inherited opacity, over every
     ground it may sit on. */
  function contrastOf(fg, op, g) {
    let worst = null, worstBg = null;
    for (const bg of g) {
      const painted = over({ r: fg.r, g: fg.g, b: fg.b, a: fg.a * op }, bg);
      const got = ratio(painted, bg);
      if (worst === null || got < worst) { worst = got; worstBg = bg; }
    }
    return { worst, worstBg };
  }
  function effectiveOpacity(el) { let o = 1, n = el; while (n && n.nodeType === 1) { o *= parseFloat(cs(n).opacity || '1'); n = n.parentElement; } return o; }
  function shown(el) {
    const s = cs(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    // clipped away entirely by an overflow:hidden ancestor (a collapsed panel)
    let n = el.parentElement;
    while (n && n !== document.body) {
      const ns = cs(n);
      if (ns.overflow !== 'visible' && ns.overflowX !== 'visible' && ns.overflowY !== 'visible') {
        const pr = n.getBoundingClientRect();
        if (pr.width < 2 || pr.height < 2) return false;
        if (r.right <= pr.left || r.left >= pr.right || r.bottom <= pr.top || r.top >= pr.bottom) return false;
      }
      n = n.parentElement;
    }
    return true;
  }
  /* A computed background-image, split into its layers (a gradient carries
     commas, so split only outside parentheses). */
  function splitLayers(v) {
    const out = []; let depth = 0, cur = '';
    for (const ch of String(v || '')) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  /* A layer sized to a STRIP - the futuristic layer's 2px energy line along a
     card's top edge, an underline, an icon - paints a sliver, not the ground
     the card's text sits on. Judging text against it reported every card's
     body copy as "brand primary on brand primary". */
  function covers(size, rect) {
    const parts = String(size || 'auto').trim().split(/\\s+/);
    if (parts[0] === 'cover' || parts[0] === 'contain' || (parts[0] === 'auto' && parts.length === 1)) return true;
    const dim = (v, total) => (/px$/.test(v) ? parseFloat(v) : /%$/.test(v) ? (parseFloat(v) / 100) * total : total);
    const w = dim(parts[0], rect.width), h = dim(parts[1] || 'auto', rect.height);
    return w >= Math.min(rect.width * 0.5, 40) && h >= Math.min(rect.height * 0.5, 24);
  }
  /* The layers an element paints, top first: its background-image gradients
     (each stop a candidate, a transparent stop included because the ground
     shows through it) then its background-color. A url() image covering the
     element is a photograph: not measurable. Strips are returned apart, for the
     colour checks only. */
  function ownLayers(el) {
    const s = cs(el);
    const out = [], strips = [];
    const bi = s.backgroundImage;
    if (bi && bi !== 'none') {
      const layers = splitLayers(bi);
      const sizes = splitLayers(s.backgroundSize);
      const rect = el.getBoundingClientRect();
      for (let i = 0; i < layers.length; i++) {
        const stops = (layers[i].match(COLOR_RX) || []).map(parse).filter(Boolean);
        if (!covers(sizes[i % (sizes.length || 1)], rect)) { if (stops.length) strips.push({ stops }); continue; }
        if (/^url\\(/.test(layers[i])) return { image: true, layers: [], strips };
        if (stops.length) out.push({ stops });
      }
    }
    const bc = parse(s.backgroundColor);
    if (bc && bc.a > 0) out.push({ stops: [bc] });
    return { image: false, layers: out, strips };
  }
  /* Every ground colour the element may sit on: walk up, collecting layers,
     until an opaque one; then composite bottom-up. Gradients multiply the
     candidates (bounded). null = a photograph underneath. */
  function grounds(el) {
    const stack = [];
    let n = el, base = null;
    // An ancestor paints the ground only where it lies BEHIND the text: a 1px
    // rule whose label is positioned over it (a fieldset-style divider) is
    // not the label's ground, the panel around both is.
    const er = el.getBoundingClientRect();
    const cx = er.left + er.width / 2, cy = er.top + er.height / 2;
    while (n && n.nodeType === 1) {
      if (n !== el && n !== document.documentElement && n !== document.body) {
        const nr = n.getBoundingClientRect();
        if (cx < nr.left || cx > nr.right || cy < nr.top || cy > nr.bottom) { n = n.parentElement; continue; }
      }
      const own = ownLayers(n);
      if (own.image) return null;
      for (const layer of own.layers) {
        stack.push(Object.assign({ el: n }, layer));
        if (layer.stops.every((c) => c.a >= 1)) { base = true; break; }
      }
      if (base) break;
      n = n.parentElement;
    }
    let cands = [{ r: 255, g: 255, b: 255, a: 1 }];
    for (let i = stack.length - 1; i >= 0; i--) {
      const next = [];
      for (const under of cands) for (const c of stack[i].stops) next.push(over(c, under));
      cands = next.slice(0, 24);
    }
    // The element that painted the nearest layer: the one a fix starts from.
    cands.groundEl = stack.length ? stack[0].el : document.documentElement;
    return cands;
  }
  const result = { tag: cfg.tag, text: 0, textChrome: 0, ground: 0, groundChrome: 0, unmeasured: 0,
    textFails: [], groundFails: [], foreign: [], forbidden: [], fonts: [], buttons: [], chrome: {} };
  const seenForeign = new Set(), seenForbid = new Set(), seenFont = new Set();
  function noteForeign(el, prop, c) {
    /* The rail is PLATFORM chrome (docs/platform-identity.md): the third-party
       logos it shows (Meta, Google...) carry their owners' colours on purpose
       and are never recoloured to a tenant's hue. Forbidden literals, text and
       grounds in the rail are still judged; only "foreign hue" is exempt. */
    try { if (el.closest('#lifecycle-nav')) return; } catch (_) {}
    const h = hex(c);
    const k = prop + '|' + h + '|' + path(el);
    if (seenForeign.has(k)) return; seenForeign.add(k);
    if (result.foreign.length < 400) result.foreign.push({ bt: tag(el), sel: path(el), prop, color: h, chrome: inChrome(el) });
  }
  function noteForbidden(el, prop, c, f) {
    const k = prop + '|' + f.hex + '|' + path(el);
    if (seenForbid.has(k)) return; seenForbid.add(k);
    if (result.forbidden.length < 400) result.forbidden.push({ bt: tag(el), sel: path(el), prop, color: hex(c), label: f.label, chrome: inChrome(el) });
  }
  function checkColour(el, prop, c, area) {
    if (!c || c.a < 0.3) return;
    const f = forbiddenOf(c);
    if (f) noteForbidden(el, prop, c, f);
    if (chromatic(c) && !brandHue(c)) noteForeign(el, prop, c);
  }
  const GENERIC_FONT = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|-apple-system|blinkmacsystemfont|segoe ui|segoe ui emoji|segoe ui symbol|apple color emoji|noto color emoji|emoji|math|inherit|initial)$/i;
  const FONTS = cfg.fonts.map((f) => f.toLowerCase());
  const firstFamily = (ff) => String(ff || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const CONTROL = 'button, a, input, select, textarea, summary, label, [role="button"], [role="tab"], [role="option"], [role="switch"], [role="menuitem"]';

  const ALL = [document.documentElement, document.body].concat([...document.querySelectorAll('body *')]);
  for (const el of ALL) {
    if (el.closest('svg, canvas, video, iframe, object, noscript, template, script, style')) {
      if (el.tagName.toLowerCase() === 'svg' || !(el instanceof SVGElement)) continue;
    }
    const s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const isSvg = el instanceof SVGElement;
    if (isSvg) {
      if (!shown(el)) continue;
      if (effectiveOpacity(el) < 0.06) continue;
      for (const prop of ['fill', 'stroke']) {
        const c = parse(s[prop]);
        if (c) checkColour(el, prop, c, 0);
      }
      continue;
    }
    if (!shown(el)) continue;
    const op = effectiveOpacity(el);
    if (op < 0.06) continue;
    const rect = el.getBoundingClientRect();
    const chrome = inChrome(el);
    const control = el.matches(CONTROL);

    // ── colours this element paints itself ──
    const own = ownLayers(el);
    for (const layer of own.layers.concat(own.strips || [])) for (const c of layer.stops) checkColour(el, layer.stops.length > 1 ? 'background-image' : 'background-color', c, rect.width * rect.height);
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(s['border' + side + 'Width']) >= 1 && s['border' + side + 'Style'] !== 'none') checkColour(el, 'border-color', parse(s['border' + side + 'Color']), 0);
    }
    for (const prop of ['boxShadow', 'textShadow']) {
      const v = s[prop];
      if (v && v !== 'none') for (const m of v.match(COLOR_RX) || []) { const c = parse(m); if (c && c.a > 0) { const f = forbiddenOf(c); if (f) noteForbidden(el, prop === 'boxShadow' ? 'box-shadow' : 'text-shadow', c, f); } }
    }

    // ── a section / panel ground ──
    // A SCRIM is not a section (design/lifecycle-os/CONTRACT.md): a fixed,
    // viewport-covering, translucent layer that dims the page behind a dialog.
    const scrim = s.position === 'fixed' && rect.width >= innerWidth * 0.9 && rect.height >= innerHeight * 0.9
      && own.layers.length && own.layers.every((l) => l.stops.every((c) => c.a < 0.9));
    // A SPECIMEN is not a section either: a swatch chip exists to SHOW a token
    // (the ink swatch is the ink), and the kit's modal demo draws its scrim in
    // a stage on the page. Both are the design-system page's subject matter.
    // Text on them is still judged; only their fill is not a "dark section".
    let specimen = false;
    try { specimen = el.matches('.vh-swatch-chip, [data-specimen], .vh-modal-stage > .vh-modal-backdrop'); } catch (_) {}
    if (!control && !scrim && !specimen && rect.width >= 120 && rect.height >= 40 && own.layers.length && !own.image) {
      if (chrome) result.groundChrome++; else result.ground++;
      const g = grounds(el);
      if (g) {
        // A dark NEUTRAL ground is the validatePalette rule. A dark ground of
        // no brand hue (a translucent forest-green panel over a red page reads
        // as dark brown) is the same defect wearing a different colour.
        const dark = g.find((c) => isDarkNeutral(c) || (lum(c) < 0.12 && !(chromatic(c) && brandHue(c))));
        if (dark && result.groundFails.length < 200) result.groundFails.push({ bt: tag(el), sel: path(el), bg: hex(dark), w: Math.round(rect.width), h: Math.round(rect.height), chrome });
      }
    }

    // ── its own text ──
    const ownText = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\\s+/g, ' ').trim();
    if (!ownText) continue;
    const fg = parse(s.color);
    if (!fg) continue;
    checkColour(el, 'color', fg, 0);
    const fam = firstFamily(s.fontFamily);
    if (fam && !GENERIC_FONT.test(fam) && FONTS.indexOf(fam.toLowerCase()) < 0 && !chrome) {
      const k = fam + '|' + path(el);
      if (!seenFont.has(k)) { seenFont.add(k); if (result.fonts.length < 200) result.fonts.push({ bt: tag(el), sel: path(el), family: fam }); }
    }
    if (el.closest('[disabled],[aria-disabled="true"],fieldset:disabled')) continue;
    if (op < 1 && ((/opacity|all/.test(s.transitionProperty || '') && parseFloat(s.transitionDuration) > 0) || (s.animationName && s.animationName !== 'none'))) continue;
    if (op < 1 && typeof el.getAnimations === 'function') { try { if (el.getAnimations().some((a) => a.playState === 'running')) continue; } catch (_) {} }
    const g = grounds(el);
    if (!g) { result.unmeasured++; continue; }
    if (chrome) result.textChrome++; else result.text++;
    const size = parseFloat(s.fontSize) || 16;
    const weight = parseInt(s.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? AA_LARGE : AA;
    const { worst, worstBg } = contrastOf(fg, op, g);
    if (worst + 0.005 < need) {
      result.textFails.push({ bt: tag(el), gbt: tag(g.groundEl), gsel: path(g.groundEl), el, sel: path(el), text: ownText.slice(0, 60), ratio: Math.round(worst * 100) / 100, need,
        size, weight, opacity: Math.round(op * 100) / 100, fg: hex(fg) + (fg.a < 1 ? '@' + fg.a : ''), bg: hex(worstBg), chrome });
    }
  }
  // A failure must be STABLE: measure it again after a beat. An element
  // mid-reveal (Motion One's rAF springs set no transition and no animation)
  // changes opacity; a control mid colour-transition (transition:all .3s as a
  // step pip turns active) changes its colours. Only a pair that still fails,
  // with its opacity unmoved, is reported.
  if (result.textFails.length) {
    const before = result.textFails.map((f) => effectiveOpacity(f.el));
    await new Promise((r) => setTimeout(r, 400));
    cache.clear();
    result.textFails = result.textFails.filter((f, i) => {
      if (!f.el.isConnected) return false;
      const op2 = effectiveOpacity(f.el);
      if (Math.abs(op2 - before[i]) >= 0.005) return false;
      const fg2 = parse(cs(f.el).color);
      const g2 = grounds(f.el);
      if (!fg2 || !g2) return false;
      const again = contrastOf(fg2, op2, g2);
      if (again.worst + 0.005 >= f.need) return false;
      f.ratio = Math.round(again.worst * 100) / 100;
      f.bg = hex(again.worstBg);
      return true;
    });
  }
  result.textFails = result.textFails.map((f) => { const o = Object.assign({}, f); delete o.el; return o; });

  // ── the chrome: are the brand's tokens what the shell resolves? ──
  const rootS = getComputedStyle(document.documentElement);
  result.chrome = {
    brandPrimary: document.documentElement.style.getPropertyValue('--brand-primary').trim().toLowerCase(),
    vhGreen: rootS.getPropertyValue('--vh-green').trim().toLowerCase(),
    vhLava: rootS.getPropertyValue('--vh-lava').trim().toLowerCase(),
  };
  const PRIMARY_BTN = '.btn-primary, .vh-btn-primary, .vh-btn.primary, .btn.primary, button.primary, .primary-btn, .btn--primary';
  // A brand's primary action may be its primary, its accent or its ink (tenant
  // zero's own style guide: ink is "text + primary buttons") - any DERIVED
  // token, never a literal from a page or another brand.
  const allowedBtn = ['--brand-primary', '--brand-primary-dark', '--brand-accent', '--brand-ink', '--brand-primary-text', '--brand-accent-text']
    .map((k) => String(cfg.tokens[k] || '').toLowerCase());
  for (const el of document.querySelectorAll(PRIMARY_BTN)) {
    if (!shown(el) || el.closest('[disabled]') || el.disabled) continue;
    const own = ownLayers(el);
    if (own.image || !own.layers.length) continue;
    const top = own.layers[0].stops.filter((c) => c.a > 0);
    const ok = top.every((c) => allowedBtn.indexOf(hex(c)) >= 0);
    if (result.buttons.length < 60) result.buttons.push({ bt: tag(el), sel: path(el), grounds: top.map(hex), ok });
  }
  return result;
})`;

/* ── for the inventory: which rule, in which file, on which line ─────────── */
const PROP_FOR = { color: ['color'], 'background-color': ['background-color', 'background'], 'background-image': ['background-image', 'background'], 'border-color': ['border-color', 'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color'], fill: ['fill'], stroke: ['stroke'], 'box-shadow': ['box-shadow'], 'text-shadow': ['text-shadow'], 'font-family': ['font-family', 'font'] };

const fileCache = new Map();
function fileLines(file) {
  if (!fileCache.has(file)) {
    const f = path.join(ROOT, file);
    fileCache.set(file, fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8').split('\n') : []);
  }
  return fileCache.get(file);
}
const squash = (t) => String(t || '').replace(/\s+/g, '').toLowerCase();
function lineOf(file, needle, from) {
  if (!needle) return 0;
  const lines = fileLines(file);
  const n = squash(needle);
  if (!n) return 0;
  for (let i = from || 0; i < lines.length; i++) if (squash(lines[i]).includes(n)) return i + 1;
  return 0;
}
/* Scripts that inject CSS into every page (a <style> element they create has
   the PAGE's URL as its source, so its line numbers are not the page's). */
const SHARED = ['auth.js', 'theme.css', 'brand-context.js', 'credits.js', 'region-context.js', 'brand-catalog.js', 'chart-enhance.js', 'table-sort.js', 'data-analysis-extensions.js'];
/** The line of `decl` inside the rule whose selector is `selector`, in `file`. */
function ruleLine(file, selector, decl) {
  const first = String(selector || '').split(',')[0].trim();
  if (!first) return 0;
  const lines = fileLines(file);
  let from = 0;
  for (let guard = 0; guard < 50; guard++) {
    const at = lineOf(file, first, from);
    if (!at) break;
    for (let k = at - 1; k < Math.min(at + 40, lines.length); k++) {
      if (squash(lines[k]).includes(squash(decl))) return k + 1;
      if (k > at - 1 && lines[k].indexOf('}') >= 0) break;
    }
    from = at;
  }
  return 0;
}
function findSource(pageFile, selector, decl, hinted) {
  const prop = String(decl).split(':')[0];
  // The line CDP reported, believed only if that line carries the property.
  if (hinted && hinted.file && hinted.line && squash(fileLines(hinted.file)[hinted.line - 1]).includes(squash(prop))) {
    return { file: hinted.file, line: ruleLine(hinted.file, selector, decl) || hinted.line };
  }
  for (const f of [pageFile].concat(SHARED)) {
    const l = ruleLine(f, selector, decl);
    if (l) return { file: f, line: l };
  }
  for (const f of [pageFile].concat(SHARED)) {
    const l = lineOf(f, decl) || lineOf(f, String(decl).split(':').slice(1).join(':'));
    if (l) return { file: f, line: l };
  }
  // A style a script set through the CSSOM reads back as rgb(); the source
  // wrote a hex. Search for the hex, first beside its property, then alone.
  const m = String(decl).match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
  if (m) {
    const hx = '#' + [m[1], m[2], m[3]].map((v) => ('0' + (+v).toString(16)).slice(-2)).join('');
    for (const f of [pageFile].concat(SHARED)) {
      const l = lineOf(f, prop + ':' + hx) || lineOf(f, prop + ': ' + hx);
      if (l) return { file: f, line: l, approx: true };
    }
    for (const f of [pageFile].concat(SHARED)) {
      const l = lineOf(f, hx);
      if (l) return { file: f, line: l, approx: true };
    }
  }
  return { file: (hinted && hinted.file) || pageFile, line: 0, unverified: true };
}

/**
 * For each data-bt tag, the declaration that set `prop` and where it lives:
 * { file, line, decl, where }. An inherited colour reports the ancestor's
 * rule; an SVG fill/stroke of currentColor reports the colour it inherited. A
 * line is reported only once the file's text at that line carries the
 * property, so a <style> a script injected (whose lines are not the page's) is
 * traced to the script that wrote it.
 */
async function attribute(page, file, items) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  const sheets = new Map();
  cdp.on('CSS.styleSheetAdded', (e) => sheets.set(e.header.styleSheetId, e.header));
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const sheetFile = (h) => {
    if (!h) return '';
    try {
      const u = new URL(h.sourceURL);
      let f = decodeURIComponent(u.pathname).replace(/^\//, '') || 'index.html';
      if (!fs.existsSync(path.join(ROOT, f))) {
        const rw = (VERCEL.rewrites || []).find((r) => r.source === '/' + f);
        if (rw) f = rw.destination.split('?')[0].replace(/^\//, '');
      }
      return f;
    } catch (_) { return h.sourceURL || ''; }
  };
  const fromRule = (r, p, where) => {
    const h = sheets.get(r.styleSheetId);
    const hinted = { file: sheetFile(h) || file, line: (r.style && r.style.range && h) ? (h.startLine || 0) + r.style.range.startLine + 1 : 0 };
    const sel = r.selectorList && r.selectorList.text;
    const decl = p.name + ':' + p.value;
    return Object.assign({ where: (where || '') + (sel || ''), decl }, findSource(file, sel, decl, hinted));
  };
  const fromAttr = (p, where) => {
    const decl = p.name + ':' + p.value;
    return Object.assign({ where, decl }, findSource(file, '', decl, null));
  };
  const memo = new Map();
  for (const it of items) {
    // Elements that look the same (forty rows of one table) share a rule.
    const key = it.key ? it.prop + '|' + it.key : '';
    if (key && memo.has(key)) { if (memo.get(key)) it.source = memo.get(key); continue; }
    try {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-bt="' + it.bt + '"]' });
      if (!nodeId) continue;
      const m = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
      const search = (prop, inherit) => {
        const props = PROP_FOR[prop] || [prop];
        const find = (style) => ((style && style.cssProperties) || []).filter((p) => props.indexOf(p.name) >= 0 && !p.disabled && p.value && p.parsedOk !== false && !/^(inherit|initial|unset|currentcolor)$/i.test(p.value)).pop();
        if (m.inlineStyle) { const p = find(m.inlineStyle); if (p) return fromAttr(p, 'style attribute'); }
        for (let i = (m.matchedCSSRules || []).length - 1; i >= 0; i--) { const p = find(m.matchedCSSRules[i].rule.style); if (p) return fromRule(m.matchedCSSRules[i].rule, p); }
        if (!inherit) return null;
        for (const inh of m.inherited || []) {
          if (inh.inlineStyle) { const p = find(inh.inlineStyle); if (p) return fromAttr(p, 'inherited style attribute'); }
          for (let i = (inh.matchedCSSRules || []).length - 1; i >= 0; i--) { const p = find(inh.matchedCSSRules[i].rule.style); if (p) return fromRule(inh.matchedCSSRules[i].rule, p, 'inherited from '); }
        }
        return null;
      };
      let hit = search(it.prop, ['color', 'fill', 'stroke', 'font-family'].indexOf(it.prop) >= 0);
      if (!hit && (it.prop === 'fill' || it.prop === 'stroke')) hit = search('color', true);
      if (hit) it.source = hit;
      if (key) memo.set(key, hit || null);
    } catch (_) { /* a node removed between the probe and here */ }
  }
  await cdp.detach().catch(() => {});
  return items;
}

/** The probe's cfg for a palette. */
function probeConfig(name, tagPrefix) {
  const t = tokensOf(name);
  const b = paletteDef(name);
  const hueOf = (h) => {
    const c = core.normHex ? core.normHex(h) : h;
    const [r, g, bb] = [1, 3, 5].map((i) => parseInt(String(c).slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, bb), mn = Math.min(r, g, bb), d = mx - mn;
    if (!d || (d * 255) < 30) return null;
    let hh = mx === r ? ((g - bb) / d) % 6 : mx === g ? (bb - r) / d + 2 : (r - g) / d + 4;
    return (hh * 60 + 360) % 360;
  };
  const hues = ['--brand-primary', '--brand-accent', '--brand-primary-text', '--brand-accent-text', '--brand-ok', '--brand-warn', '--brand-err']
    .map((k) => hueOf(t[k])).filter((h) => h !== null);
  // A hex is ANOTHER brand's only when the active brand does not derive it
  // itself. The bare record is painted with tokens()'s own fallback primary,
  // #6A33D8, which is also tenant zero's accent: design/lifecycle-os/
  // CONTRACT.md records that fallback as the brand layer's decision. A page
  // painting the bare brand's own token is following the brand; a page
  // painting tenant zero's RED for it is not.
  const own = new Set(Object.values(t).filter((v) => /^#[0-9a-f]{6}$/i.test(String(v))).map((v) => String(v).toLowerCase()));
  const forbidden = (b.tenantZero ? [] : TENANT_ZERO_HEX.map((hex) => ({ hex, label: 'tenant zero ' + hex })))
    .concat(SIBLING_HEX.map((hex) => ({ hex, label: 'sibling ' + hex })))
    .filter((f) => !own.has(f.hex));
  const fam = (stack) => String(stack || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const fonts = [fam(t['--brand-font-head']), fam(t['--brand-font-body']), fam(t['--brand-font-mono'])].filter(Boolean);
  return { tokens: t, hues, forbidden, fonts, tag: tagPrefix || 'b' };
}

/* ── the baseline: one file per page, so parallel fixes never collide ────── */
const BASELINE_DIR = path.join(ROOT, 'tests', 'brand-theme-baseline');
/** The file a page's (or Studio sequence's) baseline lives in. */
function baselineFile(key) {
  return path.join(BASELINE_DIR, String(key).replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') + '.json');
}
/** { key: counts } for every file in the directory; each file names its own key. */
function readBaseline() {
  const out = {};
  if (!fs.existsSync(BASELINE_DIR)) return out;
  for (const f of fs.readdirSync(BASELINE_DIR).filter((x) => x.endsWith('.json'))) {
    const rec = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, f), 'utf8'));
    out[rec.key] = Object.assign({ __file: f }, rec.counts);
  }
  return out;
}

module.exports = {
  BASELINE_DIR, baselineFile, readBaseline, FROZEN,
  ROOT, HOST, PALETTES, TENANT_ZERO_HEX, SIBLING_HEX, tokensOf, appPages, install, open, PROBE, probeConfig, attribute, deviceRow, define,
};
