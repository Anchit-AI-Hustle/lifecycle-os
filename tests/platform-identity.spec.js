/**
 * The app chrome carries the PLATFORM's mark, never a tenant's - even in the tab.
 * ---------------------------------------------------------------------------
 * WHY. A screenshot of the browser tab showed tenant zero's logo. This is a
 * universal brand platform: any brand onboards and the whole app runs as that
 * brand. Its palette, fonts, name and copy are the brand's, and the standing
 * gates (cross-brand-leak, the page audit) hold that. The tab icon, the touch
 * icon, the PWA manifest, the share card and the rail mark are something else:
 * they identify the TOOL a person is in, and they were tenant zero's file
 * (favicon.png) on every page, with brand-context.js then swapping the tab
 * icon to whatever brand was active and replacing the rail mark with its logo.
 * The product had no mark of its own anywhere a person looks first.
 *
 * THE RULE. App chrome = the Lifecycle OS mark (assets/lifecycle-os-mark.svg
 * and the rasters scripts/build-platform-mark.js renders from it). The ACTIVE
 * brand's logo appears only where the product shows the brand as a brand (the
 * slot beneath the wordmark, a gated tenant artefact), from ITS record - never
 * as the tab icon, and never falling back to another tenant's file. Tenant
 * zero's own frozen artefact pages may keep its logo; nothing else may.
 *
 * HOW THIS GATE WORKS. It RENDERS every app page in Chromium - the page list
 * is derived from the repo with the audit's own BRAND_ASSET classification,
 * imported, not copied - first with The Times of India active (signed in the
 * way the app signs in, a mobile+PIN device session, the cross-brand-leak
 * harness), then with tenant zero active, and reads the RESOLVED hrefs of the
 * icon, touch-icon, manifest and share-card links, the rail's rendered mark
 * and wordmark, the brand slot, and every <img> on the page. Tenant zero's
 * signature (its logo URL, its store host, its palette) is DERIVED from its
 * record. The manifest is fetched and parsed; sw.js is EXECUTED in a vm and
 * the list its install handler hands to caches.addAll() is what is asserted,
 * not a regex over the file; every raster is opened and its pixels read. Each
 * sweep asserts it inspected a non-trivial number of pages first: a check that
 * inspects nothing passes everything.
 *
 * Run: npx playwright test tests/platform-identity.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const { BRAND_ASSET, lowSat } = require(path.join(ROOT, 'scripts', 'audit-pages.js'));
const mark = require(path.join(ROOT, 'scripts', 'build-platform-mark.js'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const ZERO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', '_default.json'), 'utf8'));
const TOI = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'times-of-india.json'), 'utf8'));

const ORIGIN = 'http://app.example.test';
const rel = (abs) => '/' + path.relative(ROOT, abs).replace(/\\/g, '/');

/* ── the platform's files, from the script that renders them ─────────────── */

const SVG_URL = rel(mark.SVG_PATH);
const WEB_TARGETS = mark.TARGETS.filter((t) => t.file.startsWith('assets/'));
const PLATFORM_FILES = new Set([SVG_URL].concat(WEB_TARGETS.map((t) => '/' + t.file)));
const OG_PATH = '/' + mark.TARGETS.find((t) => t.kind === 'card').file;
const TOUCH_PATH = '/' + mark.TARGETS.find((t) => /apple-touch-icon/.test(t.use)).file;
// Tenant zero's mark. Kept in the repo ONLY because the frozen diff-version
// snapshot (auth.js IS_FROZEN_DIFF, "must never change") links it; no app page may.
const RETIRED = '/favicon.png';

// The one indexable page names the canonical origin; a share card on that host
// is served from this origin too.
const CANONICAL_HOST = (() => {
  const m = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/<link rel="canonical" href="https?:\/\/([^/"]+)/);
  return m ? m[1] : '';
})();

/* ── the pages: the audit's classification, imported ───────────────────────── */

const SHELL_TAG = /<script[^>]+src=["']\/?auth\.js/;
const APP_PAGES = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_') && !BRAND_ASSET.test(f))
  .sort();
const hasShell = (f) => SHELL_TAG.test(fs.readFileSync(path.join(ROOT, f), 'utf8'));
// The deployment's exact (parameterless) rewrites, so a friendly URL a redirect
// stub sends the reader to resolves to the page it serves.
const REWRITES = (() => {
  const out = {};
  try {
    for (const r of JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).rewrites || []) {
      if (r.source && r.destination && !r.source.includes(':') && !r.destination.startsWith('/api/')) out[r.source] = r.destination.split('?')[0];
    }
  } catch (_) { /* no rewrites: bare file paths only */ }
  return out;
})();

/* ── tenant zero's signature, DERIVED from its record ──────────────────────── */

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (_) { return ''; } }
const ZERO_HOSTS = [...new Set([hostOf(ZERO.website), hostOf(ZERO.logo_url)].filter(Boolean))];
const onTenantHost = (u) => { const h = hostOf(u); return !!h && ZERO_HOSTS.some((z) => h === z || h.endsWith('.' + z)); };
// host + path, so a CDN cache-buster (?v=...) on the record does not hide a match.
const sameFile = (a, b) => { try { const A = new URL(a), B = new URL(b); return A.host.replace(/^www\./, '') + A.pathname === B.host.replace(/^www\./, '') + B.pathname; } catch (_) { return false; } };
const ZERO_HEXES = Object.values(ZERO.palette || {}).filter((v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)).map((v) => v.toUpperCase());
const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

/* ── the brand payload, shaped as the server ships it ─────────────────────── */

function payloadFor(preset, id) {
  const ws = Object.assign({}, preset, { id, status: 'active' });
  let readiness = null;
  try { readiness = core.readiness(ws, { products: 0 }); } catch (_) { /* optional */ }
  return Object.assign({}, ws, { tokens: core.tokens(ws), fonts_href: core.fontsHref(ws), readiness, products: 0 });
}

/* ── the harness (the cross-brand-leak pattern: signed in, that brand active) ─ */

async function install(page, brand) {
  const shell = brand ? core.shellPayload(brand) : null;
  const api = {
    ok: true,
    supabase: { url: 'https://live.supabase.co', anonKey: 'anon' },
    brand, workspaces: shell ? [shell] : [], active_id: brand ? brand.id : null, needs_onboarding: false,
    user: { id: 'u-sweep', email: 'sweep@example.test' },
    presets: [], entries: [], items: [], rows: [], campaigns: [], connections: [], providers: [], runs: [],
  };
  await page.addInitScript((seed) => {
    window.supabase = {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signInWithOAuth: async () => ({ error: null }),
          signOut: async () => ({}),
        },
      }),
    };
    if (!seed) return;
    // SIGNED IN the way the app signs in since 2026-09-28: a mobile+PIN session
    // kept on this device, with the brand under sweep ACTIVE in the device store.
    try {
      const expires = new Date(Date.now() + 80 * 86400000).toISOString();
      localStorage.setItem('lifecycle.auth.device.users', JSON.stringify({ '+919876543210': {
        id: 'dev-sweep0001', phone: '+919876543210', cc: '+91', local: '9876543210', name: 'Sweep',
        salt: '00'.repeat(16), hash: 'ab'.repeat(32), iterations: 120000, tries: 0, lockedUntil: null, createdAt: expires, pinSetAt: expires,
      } }));
      localStorage.setItem('lifecycle.auth.session', JSON.stringify({
        token: 'DEVICEtokenFIXTURE0123456789abcdefghijklmnopq', mode: 'device', provider: 'mobile-pin',
        user: { id: 'dev-sweep0001', name: 'Sweep', phone: '+919876543210' }, expires,
        storage: { mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' },
      }));
      localStorage.setItem('lifecycle.brand.device.workspaces.dev-sweep0001', JSON.stringify({ version: 1, active_id: seed.id, workspaces: [seed] }));
    } catch (_) {}
  }, brand ? Object.assign({}, brand, { id: 'local-sweep0001', status: 'active', storage: 'device', owner_id: null }) : null);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  // A 1x1 transparent PNG for any cross-origin IMAGE: this gate is about which
  // URL an element resolved to, not about the bytes behind it, and an aborted
  // load would trip the slot's own broken-logo fallback (fillBrandSlot swaps a
  // logo whose host does not answer for the monogram) and hide the URL under test.
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    if (/\/auth\/v1\/health/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(route.request().url());
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
    });
  });
  await page.route(ORIGIN + '/**', (route) => {
    const u = new URL(route.request().url());
    // Friendly URLs resolve the way the deployment resolves them: two app pages
    // are redirect stubs (meta refresh onto /data-analysis...), and the tab
    // lands where they send the reader.
    const p = REWRITES[u.pathname] || u.pathname;
    const f = path.join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.route(/\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(api) }));
}

async function openPage(page, file, brand) {
  await page.goto(ORIGIN + '/' + file, { waitUntil: 'domcontentloaded' });
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (/http-equiv=["']refresh["']/i.test(src)) {
    // A redirect stub: what the tab shows is the page it lands on.
    await page.waitForURL((u) => !u.pathname.endsWith('/' + file), { timeout: 10_000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
  const shell = await page.evaluate(() => !!document.querySelector('script[src$="auth.js"]')).catch(() => false);
  if (!shell) { await page.waitForTimeout(150); return { hasLayer: false, slug: '', landed: page.url() }; }
  const want = String((brand && brand.slug) || '').toLowerCase();
  await page.waitForFunction(() => !!window.BrandContext, null, { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => Promise.race([
    (window.BrandContext && window.BrandContext.ready) ? window.BrandContext.ready() : null,
    new Promise((r) => setTimeout(r, 15_000)),
  ])).catch(() => {});
  await page.waitForFunction((slug) => {
    const B = window.BrandContext;
    return !!(B && B.brand && String(B.brand.slug || '').toLowerCase() === slug);
  }, want, { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const B = window.BrandContext;
    return B ? { hasLayer: true, slug: String((B.brand && B.brand.slug) || '').toLowerCase(), landed: location.href } : { hasLayer: false, slug: '', landed: location.href };
  });
}

/** What the browser RESOLVED: hrefs, the rail as rendered, every image. */
const READ = () => {
  const abs = (h) => { try { return new URL(h, location.href).href; } catch (_) { return String(h); } };
  const links = (sel) => Array.from(document.querySelectorAll(sel)).map((l) => l.href);
  const rail = document.querySelector('#lifecycle-nav .lnav-brand');
  const svg = rail && rail.querySelector('svg.lnav-mark');
  const slotEl = rail && rail.querySelector('.lnav-brandlogo');
  const slotImg = slotEl && slotEl.querySelector('img');
  const firstPath = svg && svg.querySelector('path');
  const word = rail && rail.querySelector('.lnav-bt b');
  return {
    icons: links('link[rel~="icon"]'),
    touch: links('link[rel="apple-touch-icon"]'),
    manifest: links('link[rel="manifest"]'),
    og: Array.from(document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]')).map((m) => abs(m.getAttribute('content'))),
    rail: rail ? {
      svgMark: !!svg,
      markLabel: svg ? (svg.getAttribute('aria-label') || '') : '',
      markBox: svg ? svg.getBoundingClientRect().width : 0,
      markStroke: firstPath ? getComputedStyle(firstPath).stroke : '',
      wordmark: word ? word.textContent.trim() : '',
      wordColor: word ? getComputedStyle(word).color : '',
      imgMarks: Array.from(rail.querySelectorAll('img.lnav-mark')).map((i) => i.src),
      brandName: ((rail.querySelector('.lnav-brandname') || {}).textContent || '').trim(),
      slot: (slotEl && !slotEl.hidden) ? { kind: slotEl.getAttribute('data-brand-slot'), src: slotImg ? slotImg.src : '', text: slotEl.textContent.trim() } : null,
    } : null,
    images: Array.from(document.images).map((i) => ({ src: i.currentSrc || i.src, slot: !!i.closest('.lnav-brandlogo,[data-brand-slot],[data-shipped-for]') })),
  };
};

async function sweep(page, brand) {
  await install(page, brand);
  const r = { pages: 0, rails: 0, icons: 0, images: 0, byPage: {}, errors: [] };
  const want = String(brand.slug || '').toLowerCase();
  for (const f of APP_PAGES) {
    const settled = await openPage(page, f, brand);
    if (settled.hasLayer && settled.slug !== want) r.errors.push(`${f}: settled on brand "${settled.slug || '(none)'}", not "${want}"`);
    const read = await page.evaluate(READ);
    r.byPage[f] = read;
    r.pages++;
    if (read.rail) r.rails++;
    r.icons += read.icons.length;
    r.images += read.images.length;
  }
  return r;
}

function measured(r) {
  expect(r.pages, 'too few app pages swept').toBeGreaterThanOrEqual(40);
  expect(r.rails, 'too few rails rendered').toBeGreaterThanOrEqual(30);
  expect(r.icons, 'too few icon links resolved').toBeGreaterThan(r.pages);
  expect(r.errors, 'a page settled on the wrong brand').toEqual([]);
}

/** The findings every brand must satisfy: the chrome is the platform's. */
function chromeFindings(r, brand) {
  const out = [];
  const tokens = core.tokens(brand);
  const brandPrimary = rgb(tokens['--brand-primary']), brandAccent = rgb(tokens['--brand-accent']);
  for (const [f, p] of Object.entries(r.byPage)) {
    const note = (s) => out.push(`${f}: ${s}`);
    if (!p.icons.length) note('no <link rel="icon"> at all (the browser default)');
    for (const h of p.icons) {
      const u = new URL(h);
      if (u.origin !== ORIGIN || !PLATFORM_FILES.has(u.pathname)) note(`icon resolves to ${h}`);
      if (u.pathname === RETIRED) note(`icon is the retired tenant file ${h}`);
      if (onTenantHost(h)) note(`icon on a tenant host ${h}`);
    }
    if (!p.icons.some((h) => new URL(h).pathname === SVG_URL)) note('no SVG icon link');
    if (!p.touch.length) note('no apple-touch-icon');
    for (const h of p.touch) if (new URL(h).origin !== ORIGIN || new URL(h).pathname !== TOUCH_PATH) note(`apple-touch-icon resolves to ${h}`);
    if (!p.manifest.length) note('no manifest link');
    for (const h of p.manifest) if (new URL(h).origin !== ORIGIN || new URL(h).pathname !== '/manifest.webmanifest') note(`manifest resolves to ${h}`);
    if (!p.og.length) note('no og:image / twitter:image');
    for (const h of p.og) {
      const u = new URL(h);
      if (u.pathname !== OG_PATH) note(`share image resolves to ${h}`);
      if (u.host !== new URL(ORIGIN).host && u.host !== CANONICAL_HOST) note(`share image on a foreign host ${h}`);
      if (onTenantHost(h)) note(`share image on a tenant host ${h}`);
    }
    if (p.rail) {
      if (!p.rail.svgMark) note('rail has no inline platform mark');
      if (p.rail.markLabel !== 'Lifecycle OS') note(`rail mark is labelled "${p.rail.markLabel}"`);
      if (!(p.rail.markBox > 10)) note(`rail mark does not paint (${p.rail.markBox}px)`);
      if (p.rail.imgMarks.length) note(`rail mark replaced by an image ${p.rail.imgMarks.join(' ')}`);
      if (p.rail.wordmark !== 'Lifecycle OS') note(`rail wordmark reads "${p.rail.wordmark}"`);
      // The mark is drawn in the rail's ink, the same colour as the wordmark:
      // a mark that took the brand's primary or accent would be one tenant's
      // colour on the platform's identity.
      if (p.rail.markStroke !== p.rail.wordColor) note(`rail mark stroke ${p.rail.markStroke} is not the wordmark ink ${p.rail.wordColor}`);
      if (p.rail.markStroke === brandPrimary || p.rail.markStroke === brandAccent) note(`rail mark painted with the brand colour ${p.rail.markStroke}`);
      if (p.rail.brandName !== brand.name) note(`brand slot names "${p.rail.brandName}", expected "${brand.name}"`);
    }
  }
  return out;
}

/* ═══ the page list and the signatures are real ═══════════════════════════ */

test('the sweep covers the real app page set, classified by the audit itself', () => {
  expect(APP_PAGES.length, 'no app pages found').toBeGreaterThanOrEqual(40);
  for (const f of ['index.html', 'dashboard.html', 'smart-brain.html', 'agent.html', 'kicksgpt.html', 'lifecycle_mailer_architect_v34.html']) expect(APP_PAGES).toContain(f);
  // Tenant zero's own artefacts are OUT by the audit's regex, not by a list here.
  for (const f of ['diff-version.html', 'knickgasm-grail-drop-presell-v5-variantA.html', 'lifecycle-usa-july-calendar-mailer-studio.html']) expect(APP_PAGES).not.toContain(f);
  expect(APP_PAGES.filter(hasShell).length, 'too few shell pages').toBeGreaterThanOrEqual(30);
  expect(ZERO_HOSTS.length, 'no tenant-zero host derived from the record').toBeGreaterThan(0);
  expect(ZERO.logo_url, 'tenant zero has no logo_url to assert against').toMatch(/^https?:\/\//);
  expect(ZERO_HEXES.length).toBeGreaterThanOrEqual(2);
  expect(CANONICAL_HOST, 'index.html names no canonical origin').not.toBe('');
  expect(WEB_TARGETS.length).toBeGreaterThanOrEqual(5);
});

/* ═══ with another brand active, every page's chrome is the platform's ════ */

test('with The Times of India active, tab icon, touch icon, manifest, share card and rail mark are Lifecycle OS on every app page', async ({ page }) => {
  test.setTimeout(900_000);
  const brand = payloadFor(TOI, 'ws-identity-toi');
  const r = await sweep(page, brand);
  console.log(`[platform-identity] times-of-india: ${r.pages} pages, ${r.rails} rails, ${r.icons} icon links, ${r.images} images`);
  measured(r);
  const findings = chromeFindings(r, brand);
  // Nothing of tenant zero anywhere: not its logo, not its host, not in a slot.
  for (const [f, p] of Object.entries(r.byPage)) {
    for (const i of p.images) if (onTenantHost(i.src) || sameFile(i.src, ZERO.logo_url)) findings.push(`${f}: image from tenant zero ${i.src}${i.slot ? ' (in a brand slot)' : ''}`);
    if (p.rail && p.rail.slot) {
      // The Times of India's record carries no logo, so the slot is the
      // monogram of ITS name - a neutral placeholder, never another tenant's file.
      if (p.rail.slot.src && !sameFile(p.rail.slot.src, TOI.logo_url || '')) findings.push(`${f}: brand slot shows ${p.rail.slot.src}`);
      if (!TOI.logo_url && (p.rail.slot.kind !== 'monogram' || p.rail.slot.text !== TOI.name.charAt(0).toUpperCase())) findings.push(`${f}: brand slot is ${JSON.stringify(p.rail.slot)}`);
    }
  }
  expect(findings, 'app chrome carried a tenant mark under another brand').toEqual([]);
});

/* ═══ with tenant zero active, its logo is in the brand slot and nowhere else ═ */

test('with tenant zero active, its logo appears only in brand slots and never as the tab icon', async ({ page }) => {
  test.setTimeout(900_000);
  const brand = payloadFor(ZERO, 'ws-identity-zero');
  const r = await sweep(page, brand);
  console.log(`[platform-identity] tenant-zero: ${r.pages} pages, ${r.rails} rails, ${r.icons} icon links, ${r.images} images`);
  measured(r);
  const findings = chromeFindings(r, brand);
  let slots = 0;
  for (const [f, p] of Object.entries(r.byPage)) {
    for (const h of p.icons.concat(p.touch, p.og)) if (sameFile(h, ZERO.logo_url) || onTenantHost(h)) findings.push(`${f}: the brand's logo is the tab/touch/share icon ${h}`);
    for (const i of p.images) if (sameFile(i.src, ZERO.logo_url) && !i.slot) findings.push(`${f}: the brand's logo rendered outside a brand slot ${i.src}`);
    if (p.rail) {
      if (!p.rail.slot || p.rail.slot.kind !== 'logo' || !sameFile(p.rail.slot.src, ZERO.logo_url)) findings.push(`${f}: brand slot should carry the record's logo, got ${JSON.stringify(p.rail.slot)}`);
      else slots++;
    }
  }
  expect(slots, 'the brand slot never rendered the record logo').toBeGreaterThanOrEqual(30);
  expect(findings, 'tenant zero\'s logo leaked out of its slots').toEqual([]);
});

/* ═══ the manifest, fetched and parsed ════════════════════════════════════ */

function pngSize(file) {
  const b = fs.readFileSync(file);
  expect(b.slice(1, 4).toString('ascii'), `${file} is not a PNG`).toBe('PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test('the served manifest names Lifecycle OS and every icon is a platform raster of the declared size', async ({ page }) => {
  await install(page, null);
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'domcontentloaded' });
  const manifest = await page.evaluate(() => fetch('/manifest.webmanifest').then((r) => r.json()));
  expect(manifest.name).toBe('Lifecycle OS');
  expect(manifest.short_name).toBe('Lifecycle OS');
  expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  expect(manifest.icons.some((i) => /maskable/.test(i.purpose)), 'no maskable icon').toBe(true);
  for (const icon of manifest.icons) {
    expect(PLATFORM_FILES.has(icon.src), `manifest icon ${icon.src} is not a platform file`).toBe(true);
    expect(fs.existsSync(path.join(ROOT, icon.src)), `${icon.src} missing on disk`).toBe(true);
    if (icon.type === 'image/png') {
      const { w, h } = pngSize(path.join(ROOT, icon.src));
      expect(`${w}x${h}`, `${icon.src} declared ${icon.sizes}`).toBe(icon.sizes);
    }
  }
  const flat = JSON.stringify(manifest);
  expect(flat).not.toMatch(new RegExp(ZERO.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  expect(flat).not.toContain(RETIRED);
  for (const key of ['theme_color', 'background_color']) {
    expect(manifest[key], `${key} missing`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(lowSat(manifest[key]), `${key} ${manifest[key]} is not a neutral`).toBe(true);
    expect(ZERO_HEXES).not.toContain(manifest[key].toUpperCase());
  }
});

/* ═══ sw.js, EXECUTED: the list its install handler precaches ═════════════ */

async function precacheList() {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const listeners = {};
  let added = null;
  const sandbox = {
    caches: {
      open: async () => ({ addAll: async (list) => { added = list.slice(); }, put: async () => {}, match: async () => undefined }),
      keys: async () => [], delete: async () => true, match: async () => undefined,
    },
    location: { origin: ORIGIN },
    fetch: async () => { throw new Error('no network in the sandbox'); },
    URL, console, setTimeout, Promise,
  };
  sandbox.self = { addEventListener: (name, fn) => { listeners[name] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} }, location: sandbox.location };
  vm.runInNewContext(src, sandbox, { filename: 'sw.js' });
  expect(typeof listeners.install, 'sw.js registered no install handler').toBe('function');
  let waited = null;
  listeners.install({ waitUntil: (p) => { waited = p; } });
  await waited;
  return added;
}

test('sw.js precaches the platform icons and not the retired tenant file', async () => {
  const list = await precacheList();
  expect(Array.isArray(list), 'install handler never called caches.addAll').toBe(true);
  expect(list.length).toBeGreaterThan(8);
  expect(list).not.toContain(RETIRED);
  expect(list).toContain('/manifest.webmanifest');
  expect(list).toContain(SVG_URL);
  expect(list).toContain(TOUCH_PATH);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) expect(list, `manifest icon ${icon.src} is not precached`).toContain(icon.src);
  for (const entry of list) {
    const f = path.join(ROOT, entry === '/' ? 'index.html' : entry.replace(/^\//, ''));
    expect(fs.existsSync(f), `precache entry ${entry} does not exist`).toBe(true);
  }
});

/* ═══ the mark itself: neutral, and every raster renders ═════════════════ */

test('the mark carries no tenant colour: every hex is a neutral by the audit\'s own rule', () => {
  const svg = fs.readFileSync(mark.SVG_PATH, 'utf8');
  const t = mark.tokens(svg);
  expect(Object.keys(t).sort()).toEqual(['ink', 'line', 'tile']);
  const hexes = [...new Set((svg.match(/#[0-9A-Fa-f]{6}\b/g) || []).map((h) => h.toUpperCase()))];
  expect(hexes.length).toBeGreaterThanOrEqual(3);
  for (const h of hexes) {
    expect(lowSat(h), `${h} in the mark is a colour, not a neutral`).toBe(true);
    expect(ZERO_HEXES, `${h} is tenant zero's palette`).not.toContain(h);
  }
  // The rail's inline copy of the mark decides no colour of its own.
  const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  const inline = (auth.match(/const LOGO_SVG = `([\s\S]*?)`;/) || [])[1] || '';
  expect(inline, 'auth.js has no LOGO_SVG').not.toBe('');
  expect(inline.match(/#[0-9A-Fa-f]{3,8}\b/g) || []).toEqual([]);
  expect(inline).toMatch(/aria-label="Lifecycle OS"/);
});

test('every raster exists at its declared size, is not blank, and keeps the corner rule of its kind', async ({ page }) => {
  await install(page, null);
  await page.goto(ORIGIN + '/index.html', { waitUntil: 'domcontentloaded' });
  const t = mark.tokens();
  const tile = [parseInt(t.tile.slice(1, 3), 16), parseInt(t.tile.slice(3, 5), 16), parseInt(t.tile.slice(5, 7), 16)];
  let checked = 0;
  for (const target of mark.TARGETS) {
    const abs = path.join(ROOT, target.file);
    expect(fs.existsSync(abs), `${target.file} missing: run node scripts/build-platform-mark.js`).toBe(true);
    const { w, h } = pngSize(abs);
    expect(`${w}x${h}`, target.file).toBe(`${target.w}x${target.h}`);
    // Rasters under android/ are not served by the harness; read them as data URLs.
    const src = target.file.startsWith('assets/') ? '/' + target.file : 'data:image/png;base64,' + fs.readFileSync(abs).toString('base64');
    const px = await page.evaluate(async ([url, W, H]) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, W, H).data;
      const at = (x, y) => Array.from(d.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
      let opaque = 0, dark = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 200) opaque++; if (d[i + 3] > 200 && d[i] + d[i + 1] + d[i + 2] < 300) dark++; }
      return { natural: [img.naturalWidth, img.naturalHeight], corner: at(0, 0), centre: at(Math.floor(W / 2), Math.floor(H / 2)), opaque, dark, total: W * H };
    }, [src, w, h]);
    expect(px.natural, target.file).toEqual([w, h]);
    expect(px.dark, `${target.file} has no ink pixels: blank`).toBeGreaterThan(px.total * 0.01);
    if (target.kind === 'any' || target.kind === 'round' || target.kind === 'glyph') expect(px.corner[3], `${target.file} (${target.kind}) corner should be transparent`).toBe(0);
    if (target.kind === 'fullbleed') {
      expect(px.corner[3], `${target.file} corner should be opaque`).toBe(255);
      expect(px.corner.slice(0, 3), `${target.file} corner should be the tile colour`).toEqual(tile);
    }
    if (target.kind === 'card') expect(px.corner[3]).toBe(255);
    // The core dot sits at the centre of every icon shape.
    if (target.kind !== 'card') expect(px.centre[0] + px.centre[1] + px.centre[2], `${target.file} centre is not the ink`).toBeLessThan(300);
    checked++;
  }
  expect(checked).toBe(mark.TARGETS.length);
  // And the SVG itself: opened by the browser, it has size and paints.
  const svgPx = await page.evaluate(async (url) => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    return { natural: [img.naturalWidth, img.naturalHeight], corner: d[3], centre: d[(32 * 64 + 32) * 4] + d[(32 * 64 + 32) * 4 + 1] + d[(32 * 64 + 32) * 4 + 2] };
  }, SVG_URL);
  expect(svgPx.natural).toEqual([64, 64]);
  expect(svgPx.corner).toBe(0);
  expect(svgPx.centre).toBeLessThan(300);
});

/* ═══ the retired tenant file is linked only from tenant zero's frozen artefacts ═ */

test('favicon.png is referenced by no app page, only by tenant zero\'s own frozen artefact pages', () => {
  let files;
  try { files = cp.execSync('git ls-files -- "*.html"', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean); }
  catch (_) { files = []; }
  expect(files.length, 'git ls-files returned nothing').toBeGreaterThan(50);
  const referrers = files.filter((f) => /favicon\.png/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  const offenders = referrers.filter((f) => !BRAND_ASSET.test(f));
  expect(offenders, 'app pages still link the retired tenant file').toEqual([]);
  // Every remaining referrer is the frozen snapshot, which must never change.
  expect(referrers.every((f) => /diff-version/.test(f)), `unexpected referrers: ${referrers.join(', ')}`).toBe(true);
  if (!referrers.length) expect(fs.existsSync(path.join(ROOT, 'favicon.png')), 'favicon.png is unreferenced and should be deleted').toBe(false);
});
