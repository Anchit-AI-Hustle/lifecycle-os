/**
 * Mobile space harness: the pages, the viewports, the two states and the
 * in-page measurement used by tests/mobile-space-every-page.spec.js.
 *
 * Everything here MEASURES layout as Chromium renders it (getBoundingClientRect,
 * getComputedStyle, the CSSOM the page actually loaded). Nothing reads a page's
 * source to decide whether it fits a phone.
 */
const fs = require('fs');
const path = require('path');
const H = require('./brand-theme-harness');

const ROOT = H.ROOT;
const HOST = H.HOST;

/* ── viewports ──────────────────────────────────────────────────────────── */
/* The phone and tablet sizes people actually hold, both orientations. `cls`
   decides the thresholds: a landscape phone has the least height of all. */
const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568, cls: 'phone' },
  { name: '360x740', width: 360, height: 740, cls: 'phone' },
  { name: '375x667', width: 375, height: 667, cls: 'phone' },
  { name: '390x844', width: 390, height: 844, cls: 'phone' },
  { name: '412x915', width: 412, height: 915, cls: 'phone' },
  { name: '430x932', width: 430, height: 932, cls: 'phone' },
  { name: '667x375', width: 667, height: 375, cls: 'landscape' },
  { name: '844x390', width: 844, height: 390, cls: 'landscape' },
  { name: '768x1024', width: 768, height: 1024, cls: 'tablet' },
  { name: '820x1180', width: 820, height: 1180, cls: 'tablet' },
  { name: '1024x768', width: 1024, height: 768, cls: 'tablet' },
];

/* ── the pages ──────────────────────────────────────────────────────────── */
/* Every app page that loads auth.js, from the same enumeration the brand-theme
   gate uses (root *.html + every vercel.json destination that is HTML). */
const EXCLUDED = {
  'campaign.html': 'campaign-variant renderer (/c/:theme/:variant) that document.write()s the rendered artefact over itself; the artefact is an email, laid out by its own contract',
};
function loadsAuth(file) {
  return /<script[^>]+src=["'][^"']*\bauth\.js/.test(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}
function coversSafeArea(file) {
  const m = /<meta[^>]+name=["']viewport["'][^>]*>/i.exec(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return !!(m && /viewport-fit\s*=\s*cover/i.test(m[0]));
}
function pages() {
  return H.appPages().kept.filter((f) => loadsAuth(f) && !EXCLUDED[f]);
}

/* ── the two states ─────────────────────────────────────────────────────── */
/* 'device-brand': a mobile+PIN device sign-in with The Times of India preset
   active, the way production serves a phone (brand-theme harness, unchanged).
   'signed-out': no session, the Supabase host configured but not answering. */
const TOI = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'times-of-india.json'), 'utf8'));
H.PALETTES['times-of-india'] = { name: TOI.name, slug: TOI.slug, palette: TOI.palette, typography: TOI.typography, regions: TOI.regions };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const VERCEL = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

async function installSignedOut(page, log) {
  page.on('pageerror', (e) => log && log.errors.push(String(e.message || e)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.addInitScript(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch (_) {}
    function Noop() {}
    Noop.prototype.update = Noop.prototype.destroy = Noop.prototype.resize = function () {};
    Noop.register = function () {};
    function auto() { return new Proxy({}, { get(t, k) { if (typeof k === 'symbol') return undefined; if (!(k in t)) t[k] = auto(); return t[k]; } }); }
    Noop.defaults = auto();
    window.Chart = window.Chart || Noop;
    window.Papa = window.Papa || { parse(_, o) { if (o && o.complete) o.complete({ data: [], errors: [] }); return { data: [], errors: [] }; }, unparse() { return ''; } };
    window.lucide = window.lucide || { createIcons() {} };
    window.marked = window.marked || { parse(s) { return String(s || ''); }, setOptions() {} };
    window.supabase = { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOAuth: async () => ({ error: null }), signOut: async () => ({}),
    } }) };
  });
  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    const u = route.request().url();
    if (/\/auth\/v1\/health/.test(u)) return route.abort('addressunreachable');
    const type = route.request().resourceType();
    if (type === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') });
    if (type !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(u);
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: esm
      ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
      : 'window.tailwind=window.tailwind||{};' });
  });
  await page.route(HOST + '/**', (route) => {
    const u = new URL(route.request().url());
    const json = (b, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/_vercel/')) {
      const action = u.searchParams.get('action') || '';
      const op = u.searchParams.get('op') || '';
      if (/\/api\/public-config$/.test(u.pathname) && !action) return json({ supabase: { url: 'https://paused-project.supabase.co', anonKey: 'anon' } });
      if (action === 'auth') return op === 'status'
        ? json({ ok: true, mode: 'device', reason: 'no_database_url', host: '', message: 'Saved on this device only: no database is configured.' })
        : json({ ok: false, error: 'no_database', mode: 'device', message: 'No database is configured on this deployment.' }, 503);
      if (action === 'brand' && op === 'presets') return json(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'index.json'), 'utf8')));
      if (u.pathname.startsWith('/_vercel/')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      return json({ ok: false, error: 'sign_in_required', message: 'Sign in to use this.' }, 401);
    }
    let p = decodeURIComponent(u.pathname);
    const rw = (VERCEL.rewrites || []).find((r) => r.source === p);
    if (rw) p = rw.destination.split('?')[0];
    const f = path.join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
}

/* Measure a page once it has stopped loading: the network idle (bounded - a
   page that polls never idles) and two frames, so content that arrives a
   moment after load is in every measurement or in none. */
async function quiet(page) {
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(400);
}

const STATES = {
  'signed-out': {
    install: installSignedOut,
    open: async (page, file) => {
      await page.goto(HOST + '/' + file, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 30000 }).catch(() => {});
      // The reachability probe fails, then the notice bar is drawn.
      await page.waitForFunction(() => document.getElementById('lc-authnotice'), null, { timeout: 9000 }).catch(() => {});
      await quiet(page);
    },
  },
  'device-brand': {
    install: (page, log) => H.install(page, 'times-of-india', log),
    open: async (page, file) => { await H.open(page, file, 'times-of-india'); await quiet(page); },
  },
};

/* ── thresholds, stated ─────────────────────────────────────────────────── */
/* Chrome that stays on screen (fixed bars, stuck sticky headers, toasts), as a
   share of the viewport HEIGHT. A phone held upright keeps at least 70% for
   content; a landscape phone 60% (the operator's floor); a tablet 80%. */
const CHROME_MAX = { phone: 0.30, landscape: 0.40, tablet: 0.20 };
const TAP_MIN = 44;        // CSS px, both sides (WCAG 2.5.5 / Apple HIG)
const TEXT_MIN = 12;       // CSS px
const INPUT_MIN = 16;      // CSS px: below it iOS Safari zooms the page on focus
const GUTTER_MAX = { phone: 24, landscape: 40, tablet: 48 }; // px from the viewport edge to the first text

/* ── the measurement, run in the page ───────────────────────────────────── */
/* cfg = { cls, tapMin, textMin, inputMin, gutterMax }. Returns
   { counts: {kind: n}, findings: [{kind, el, detail}], measured: {...} }. */
const PROBE = `(async (cfg) => {
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const findings = [];
  const measured = { elements: 0, text: 0, targets: 0, inputs: 0, rules: 0 };
  const sel = (el) => {
    if (!el || !el.tagName) return '?';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    const p = el.parentElement;
    if (p && !el.id) s = (p.id ? p.tagName.toLowerCase() + '#' + p.id : p.tagName.toLowerCase() + (typeof p.className === 'string' && p.className.trim() ? '.' + p.className.trim().split(/\\s+/)[0] : '')) + ' > ' + s;
    return s;
  };
  const add = (kind, el, detail) => findings.push({ kind, el: sel(el), detail });
  const nav = document.getElementById('lifecycle-nav');
  const drawer = nav && nav.querySelector('.lnav-side');
  const navOpen = nav && nav.classList.contains('open');
  const inClosedChrome = (el) => {
    if (drawer && drawer.contains(el) && !navOpen && vw <= 960) return true;
    const ip = document.getElementById('lnav-ipanel');
    if (ip && ip.contains(el) && !(nav && nav.classList.contains('ipanel-open'))) return true;
    return false;
  };
  // Whether an element's ancestors let it be seen, memoised per element so a
  // deep page costs one style read per node, not one per node per depth.
  const shown = new Map();
  const ancestorsShow = (el) => {
    const a = el.parentElement;
    if (!a || a === document.body || a === document.documentElement) return true;
    if (shown.has(a)) return shown.get(a);
    const as = getComputedStyle(a);
    const ok = !(Number(as.opacity) === 0 || as.display === 'none' || a.hasAttribute('hidden') || a.getAttribute('aria-hidden') === 'true') && ancestorsShow(a);
    shown.set(a, ok);
    return ok;
  };
  const visible = (el, cs) => {
    cs = cs || getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (Number(cs.opacity) === 0) return false;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (inClosedChrome(el)) return false;
    return ancestorsShow(el);
  };
  const scroller = (cs) => /auto|scroll|hidden|clip/.test(cs.overflowX);
  const clippedByAncestor = (el) => {
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const as = getComputedStyle(a);
      if (a === document.body) { if (/hidden|clip/.test(as.overflowX)) return 'body'; continue; }
      if (scroller(as)) return a;
      if (as.position === 'fixed') return null;
    }
    return null;
  };
  const ownText = (el) => {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\\s+/g, ' ').trim();
  };

  /* 1. horizontal page overflow */
  window.scrollTo(0, 0);
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (sw > vw + 1) add('page-overflow', document.documentElement, 'scrollWidth ' + sw + ' > ' + vw);
  // A body/html overflow-x:hidden HIDES an overflow instead of fixing it: the
  // content past the edge is unreachable. Measured by the element rects below.

  const all = [...document.body.querySelectorAll('*')].filter((el) => !/^(script|style|link|meta|noscript|template|br|wbr|option|optgroup|source|track|param|defs|clippath|lineargradient|radialgradient|stop|mask|symbol|path|g|circle|rect|line|polyline|polygon|ellipse|use|tspan|text)$/i.test(el.tagName));
  const vis = new Map();
  for (const el of all) { const cs = getComputedStyle(el); if (visible(el, cs)) vis.set(el, cs); }
  measured.elements = vis.size;

  /* 2. elements wider than the viewport, or poking past its edge, that no
        ancestor scrolls or clips (the OUTERMOST offender only) */
  const wide = new Set();
  for (const [el, cs] of vis) {
    if (cs.position === 'fixed' && el.closest('#lifecycle-nav')) continue;
    const r = el.getBoundingClientRect();
    const over = r.right > vw + 1 || r.left < -1;
    if (!over) continue;
    // Entirely off the LEFT edge and taken out of flow: the visually-hidden
    // pattern (a skip link until it is focused). It cannot widen the page.
    // An off-canvas panel parked wholly past the left edge (a closed drawer)
    // likewise: nothing left of 0 can be scrolled to, so it cannot widen it.
    if (r.right <= 0) continue;
    // A carousel track / marquee inside a clipping box is the design.
    if (clippedByAncestor(el)) continue;
    let p = el.parentElement, parentWide = false;
    while (p && p !== document.body) { if (wide.has(p)) { parentWide = true; break; } p = p.parentElement; }
    wide.add(el);
    if (parentWide) continue;
    add('too-wide', el, 'x ' + Math.round(r.left) + '..' + Math.round(r.right) + ' of ' + vw);
  }

  /* 2b. content that SPILLS out of a box that fits: an unbreakable word or URL
         whose box is inside the viewport but whose text runs past its edge.
         The box's rect looks fine; only its scrollWidth shows the spill, and
         on a phone it widens the page all the same (a long host name in a
         failure line made /all-in-one 381px wide at 320). */
  for (const [el, cs] of vis) {
    if (cs.overflowX !== 'visible' || !ownText(el)) continue;
    if (cs.position === 'fixed' && el.closest('#lifecycle-nav')) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1) continue; // already a too-wide box
    if (el.scrollWidth <= el.clientWidth + 1 || r.left + el.scrollWidth <= vw + 1) continue;
    if (clippedByAncestor(el)) continue;
    add('text-spill', el, 'text runs to ' + Math.round(r.left + el.scrollWidth) + ' of ' + vw + ': ' + ownText(el).slice(0, 40));
  }

  /* 3. text clipped by its own box (nowrap + overflow hidden, no ellipsis) */
  for (const [el, cs] of vis) {
    const t = ownText(el);
    if (!t) continue;
    measured.text++;
    if (/hidden|clip/.test(cs.overflowX) && cs.textOverflow !== 'ellipsis' && !(cs.webkitLineClamp && cs.webkitLineClamp !== 'none') && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      add('text-clipped', el, 'scrollWidth ' + el.scrollWidth + ' > ' + el.clientWidth + ': ' + t.slice(0, 40));
    }
  }

  /* 4. text under the minimum size (only text a person is meant to read:
        visible, with own characters, not an icon glyph) */
  for (const [el, cs] of vis) {
    const t = ownText(el);
    if (!t || t.length < 2 || !/[A-Za-z0-9]/.test(t)) continue;
    const fs = parseFloat(cs.fontSize);
    if (fs < cfg.textMin - 0.01) add('tiny-text', el, fs + 'px: ' + t.slice(0, 30));
  }

  /* 5. tap targets */
  const TARGET = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=link],[role=checkbox],[role=switch],[tabindex]:not([tabindex="-1"])';
  for (const [el, cs] of vis) {
    if (!el.matches(TARGET)) continue;
    if (el.disabled) continue;
    // An inline link inside a sentence is exempt (WCAG 2.5.8 inline exception).
    if (el.tagName === 'A' && cs.display === 'inline') {
      const p = el.parentElement;
      if (p && ownText(p).length > 0) continue;
    }
    // A target nested inside another target is one control.
    if (el.parentElement && el.parentElement.closest(TARGET)) continue;
    // The skip link is off-screen until focused.
    if (el.classList.contains('lnav-skip')) continue;
    // A checkbox / radio wrapped in (or labelled by) a label: the label is the target.
    if (el.tagName === 'INPUT' && /checkbox|radio/.test(el.type)) {
      const lab = el.closest('label') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'));
      if (lab) {
        const lr = lab.getBoundingClientRect();
        measured.targets++;
        if (lr.height < cfg.tapMin - 0.5 || lr.width < cfg.tapMin - 0.5) add('small-target', lab, Math.round(lr.width) + 'x' + Math.round(lr.height));
        continue;
      }
    }
    const r = el.getBoundingClientRect();
    if (r.right < 0 || r.left > vw) continue;
    measured.targets++;
    if (r.height < cfg.tapMin - 0.5 || r.width < cfg.tapMin - 0.5) add('small-target', el, Math.round(r.width) + 'x' + Math.round(r.height));
  }

  /* 6. inputs under 16px: iOS zooms the page in when one is focused */
  for (const [el, cs] of vis) {
    if (!el.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=image]),select,textarea,[contenteditable=""],[contenteditable=true]')) continue;
    measured.inputs++;
    const fs = parseFloat(cs.fontSize);
    if (fs < cfg.inputMin - 0.01) add('input-zoom', el, fs + 'px');
  }

  /* 7. gutters: the first text from the left edge of the CONTENT area (on a
        tablet in landscape the desktop rail sits to the left of the body, and
        its width is not a gutter) */
  {
    const bodyLeft = Math.max(0, document.body.getBoundingClientRect().left);
    const lefts = [];
    for (const [el, cs] of vis) {
      if (!ownText(el)) continue;
      if (el.closest('#lifecycle-nav,#lc-authnotice')) continue;
      if (cs.position === 'fixed' || cs.position === 'absolute') continue;
      const r = el.getBoundingClientRect();
      if (r.top > document.documentElement.scrollHeight) continue;
      lefts.push(r.left - bodyLeft);
    }
    lefts.sort((a, b) => a - b);
    if (lefts.length >= 5) {
      const g = Math.round(lefts[Math.floor(lefts.length * 0.05)]);
      measured.gutter = g;
      if (g > cfg.gutterMax) add('wide-gutter', document.body, g + 'px from the left edge to the first text (max ' + cfg.gutterMax + ')');
    }
  }

  /* 8. tall viewport-unit heights on phones: 100vh is the LARGE viewport on
        mobile Safari and Chrome (it counts the URL bar), so a box that height
        runs off the bottom. Every rule that applies here and sets a height of
        60vh or more must have an svh/dvh partner for the same selector. */
  {
    const rules = [];
    const walk = (list, media) => {
      for (const r of list) {
        if (r.type === 1) rules.push({ r, media });
        else if (r.cssRules && r.media) { if (matchMedia(r.media.mediaText).matches) walk(r.cssRules, r.media.mediaText); }
        else if (r.cssRules && r.conditionText !== undefined) { try { if (CSS.supports(r.conditionText)) walk(r.cssRules, media); } catch (_) {} }
        else if (r.cssRules) walk(r.cssRules, media);
      }
    };
    for (const s of document.styleSheets) { try { walk(s.cssRules, ''); } catch (_) {} }
    measured.rules = rules.length;
    const PROPS = ['height', 'min-height', 'max-height'];
    const small = new Map();
    for (const { r } of rules) for (const p of PROPS) {
      const v = r.style.getPropertyValue(p);
      if (/\\d(svh|dvh)\\b|%/.test(v) || v === 'auto' || v === 'none') small.set(r.selectorText + '|' + p, true);
    }
    const seen = new Set();
    for (const { r } of rules) for (const p of PROPS) {
      const v = r.style.getPropertyValue(p);
      const m = /(\\d+(?:\\.\\d+)?)vh\\b/.exec(v);
      if (!m) continue;
      if (p !== 'max-height' && Number(m[1]) < 60) continue;
      if (p === 'max-height') continue; // a max-height in vh only shrinks a box
      if (small.has(r.selectorText + '|' + p)) continue;
      let els = [];
      try { els = [...document.querySelectorAll(r.selectorText)].filter((e) => vis.has(e) || e === document.body || e === document.documentElement); } catch (_) { continue; }
      if (!els.length) continue;
      const key = r.selectorText + '|' + p;
      if (seen.has(key)) continue; seen.add(key);
      add('vh-height', els[0], r.selectorText + ' { ' + p + ': ' + v + ' } has no svh/dvh partner');
    }
    for (const [el] of vis) {
      for (const p of PROPS) {
        const v = el.style.getPropertyValue(p);
        const m = /(\\d+(?:\\.\\d+)?)vh\\b/.exec(v);
        if (m && p !== 'max-height' && Number(m[1]) >= 60) add('vh-height', el, 'inline ' + p + ': ' + v);
      }
    }
  }

  /* 9. chrome: what stays on screen while reading. Scroll into the page and
        take every fixed element and every STUCK sticky one that is visible,
        spans at least half the width and is not the open drawer. The share of
        the viewport height their union covers is chrome. Measured at rest
        (scrollY 0) and scrolled, the larger kept. */
  const chromeAt = () => {
    const iv = [];
    const items = [];
    for (const el of document.body.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (!visible(el, cs)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh) continue;
      if (r.width < vw * 0.5) continue;
      if (cs.position === 'fixed' && r.height >= vh * 0.9) continue; // a full-screen layer (backdrop, open modal) is not chrome
      if (cs.pointerEvents === 'none' && Number(cs.opacity) < 0.6) continue;
      if (cs.position === 'sticky') {
        const top = parseFloat(cs.top), bottom = parseFloat(cs.bottom);
        const stuck = (!isNaN(top) && Math.abs(r.top - top) < 2) || (!isNaN(bottom) && Math.abs(vh - r.bottom - bottom) < 2);
        if (!stuck) continue;
      }
      // nested chrome inside chrome counts once
      if (el.parentElement && el.parentElement.closest && [...items].some((o) => o.contains(el))) continue;
      items.push(el);
      iv.push([Math.max(0, r.top), Math.min(vh, r.bottom), el]);
    }
    iv.sort((a, b) => a[0] - b[0]);
    let total = 0, cur = null;
    for (const [a, b] of iv) {
      if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
    }
    if (cur) total += cur[1] - cur[0];
    return { share: total / vh, parts: iv.map(([a, b, el]) => sel(el) + ' ' + Math.round(b - a) + 'px') };
  };
  const c0 = chromeAt();
  const maxScroll = document.documentElement.scrollHeight - vh;
  let c1 = { share: 0, parts: [] };
  if (maxScroll > 40) {
    window.scrollTo(0, Math.min(maxScroll, Math.round(vh * 1.5)));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    c1 = chromeAt();
    // 10. content hidden behind the fixed phone bar: a sticky header stuck
    //     at a top the bar covers.
    const bar = nav && nav.querySelector('.lnav-mbar');
    if (bar && getComputedStyle(bar).display !== 'none') {
      const bh = bar.getBoundingClientRect().bottom;
      for (const el of document.body.querySelectorAll('*')) {
        if (el.closest('#lifecycle-nav')) continue;
        const cs = getComputedStyle(el);
        if (cs.position !== 'sticky' && cs.position !== 'fixed') continue;
        if (!visible(el, cs)) continue;
        const r = el.getBoundingClientRect();
        if (r.top >= bh - 1 || r.bottom <= 0 || r.top >= vh) continue;
        if (cs.position === 'fixed' && r.height >= vh * 0.9) continue;
        const x = Math.min(vw - 2, Math.max(2, r.left + r.width / 2)), y = Math.max(1, r.top + 2);
        const at = document.elementFromPoint(x, y);
        if (at && bar.contains(at) && !el.contains(at)) add('under-bar', el, 'top ' + Math.round(r.top) + ' is under the ' + Math.round(bh) + 'px phone bar');
      }
    }
    window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  const chrome = c1.share > c0.share ? c1 : c0;
  measured.chrome = Math.round(chrome.share * 1000) / 1000;
  if (chrome.share > cfg.chromeMax) add('chrome', document.body, Math.round(chrome.share * 100) + '% of the height is chrome (max ' + Math.round(cfg.chromeMax * 100) + '%): ' + chrome.parts.join(', '));

  /* 11. safe areas: on a page that asks for viewport-fit=cover, a fixed bar
        touching an edge must pad by env(safe-area-inset-*). Measured with the
        insets the harness emulates (cfg.insets): content of the bar may not
        sit inside the inset band. */
  if (cfg.insets) {
    const meta = document.querySelector('meta[name=viewport]');
    if (meta && /viewport-fit\\s*=\\s*cover/.test(meta.content)) {
      for (const el of document.body.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' || !visible(el, cs)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.5 || r.height >= vh * 0.9) continue;
        const kids = [...el.querySelectorAll('a,button,input,span,p,h1,h2,h3,div')].filter((k) => ownText(k) || k.matches('a,button,input'));
        for (const k of kids) {
          if (!visible(k)) continue;
          const kr = k.getBoundingClientRect();
          if (r.top <= 1 && kr.top < cfg.insets.top - 0.5) { add('safe-area', k, 'top ' + Math.round(kr.top) + ' inside the ' + cfg.insets.top + 'px inset'); break; }
          if (r.bottom >= vh - 1 && kr.bottom > vh - cfg.insets.bottom + 0.5) { add('safe-area', k, 'bottom ' + Math.round(kr.bottom) + ' inside the ' + cfg.insets.bottom + 'px inset'); break; }
        }
      }
    }
  }

  const counts = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] || 0) + 1;
  return { counts, findings, measured };
})`;

/* An open drawer or dialog fits the viewport and scrolls inside itself.
   cfg = { selector, label }. Returns findings. */
const OVERLAY_PROBE = `((cfg) => {
  const out = [];
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const el = document.querySelector(cfg.selector);
  if (!el) return [{ kind: 'overlay-missing', el: cfg.label, detail: cfg.selector + ' is not in the page' }];
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  if (cs.display === 'none' || cs.visibility === 'hidden' || r.width < 1 || r.height < 1) return [{ kind: 'overlay-missing', el: cfg.label, detail: 'not shown' }];
  if (r.left < -1 || r.right > vw + 1) out.push({ kind: 'overlay-size', el: cfg.label, detail: 'x ' + Math.round(r.left) + '..' + Math.round(r.right) + ' of ' + vw });
  if (r.top < -1 || r.bottom > vh + 1) out.push({ kind: 'overlay-size', el: cfg.label, detail: 'y ' + Math.round(r.top) + '..' + Math.round(r.bottom) + ' of ' + vh });
  // Everything inside must be reachable: content below the box's visible
  // bottom needs a scroller (the box or a descendant) that can move it.
  const nodes = [el, ...el.querySelectorAll('*')];
  let lowest = 0;
  for (const d of nodes) { const dr = d.getBoundingClientRect(); if (dr.width && dr.height) lowest = Math.max(lowest, dr.bottom); }
  const scrolls = nodes.some((d) => { const ds = getComputedStyle(d); return /auto|scroll/.test(ds.overflowY) && d.scrollHeight > d.clientHeight + 1; });
  const bottom = Math.min(vh, r.bottom);
  if (lowest > bottom + 2 && !scrolls) out.push({ kind: 'overlay-scroll', el: cfg.label, detail: 'content reaches ' + Math.round(lowest) + ', the box ends at ' + Math.round(bottom) + ' and nothing scrolls' });
  return out;
})`;

/* Emulated notch / home-indicator insets for the safe-area check (an iPhone
   15 in portrait). Chromium reports env(safe-area-inset-*) as 0 unless a test
   overrides it, so the check runs only where the override is applied. */
const INSETS = { top: 47, bottom: 34 };

/* Let a resize land: media queries, the rail's --ltb-h publish (resize
   listener, then rAF) and any layout a page does on resize. */
async function settle(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(250);
}

/* ── the ratchet ─────────────────────────────────────────────────────────── */
/* Kinds a page may carry up to its recorded count while it is being fixed.
   Every other kind must be zero on every page. */
const RATCHETED = ['tiny-text', 'small-target', 'wide-gutter'];
const BASELINE_DIR = path.join(ROOT, 'tests', 'mobile-space-baseline');
const baselineName = (key) => key.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() + '.json';
function readBaseline() {
  const out = {};
  if (!fs.existsSync(BASELINE_DIR)) return out;
  for (const f of fs.readdirSync(BASELINE_DIR)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, f), 'utf8'));
    out[j.key] = j.counts;
  }
  return out;
}

/* `node tests/lib/mobile-space-harness.js <inventory dir> [--write]` prints
   (or writes) the baseline an inventory run measured: ratcheted kinds only. */
if (require.main === module) {
  const dir = process.argv[2];
  const write = process.argv.includes('--write');
  for (const f of fs.readdirSync(dir)) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const counts = {};
    for (const k of RATCHETED) if (j.counts[k]) counts[k] = j.counts[k];
    const hard = Object.keys(j.counts).filter((k) => !RATCHETED.includes(k));
    if (hard.length) console.log('NOT RATCHETABLE', j.key, hard.map((k) => k + ':' + j.counts[k]).join(' '));
    if (!Object.keys(counts).length) { if (write) { try { fs.unlinkSync(path.join(BASELINE_DIR, baselineName(j.key))); } catch (_) {} } continue; }
    console.log(j.key, JSON.stringify(counts));
    if (write) { fs.mkdirSync(BASELINE_DIR, { recursive: true }); fs.writeFileSync(path.join(BASELINE_DIR, baselineName(j.key)), JSON.stringify({ key: j.key, counts }, null, 2) + '\n'); }
  }
}

module.exports = {
  INSETS, settle, coversSafeArea, RATCHETED, readBaseline, baselineName, ROOT, HOST, VIEWPORTS, EXCLUDED, pages, STATES, PROBE, OVERLAY_PROBE, CHROME_MAX, TAP_MIN, TEXT_MIN, INPUT_MIN, GUTTER_MAX };
