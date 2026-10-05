// The Lifecycle OS design system holds for ANY brand, measured on the pixels.
//
// The operator's words (2026-10-05), on a screenshot of /studio with a
// red-primary brand active - red side bands, dark brown and black panels,
// near-black prompt cards with dark grey text: "unreadable & keep theme of each
// page also when brand setup done as the brand theme ... before that create a
// design schema for lifecycle os". design/lifecycle-os/CONTRACT.md is that
// schema; this file is what keeps it true.
//
// WHAT IS EXECUTED. /design-system (every kit component, the live rail, the
// logo set, the icon and illustration sprites) is rendered in Chromium under
// every palette in design/lifecycle-os/palettes.json - the platform neutral,
// tenant zero (read from its record), a red primary with a deep brown accent,
// a pale primary with pale state colours, a near-black primary, and a bare
// record with no palette at all. The brand arrives the way it does in
// production: a shell payload whose tokens are computed by the SHIPPED
// tokens(), painted by the SHIPPED brand-context.js.
//
// HOW TEXT IS MEASURED, and why not like contrast-rendered.spec.js. That probe
// walks ancestors for a background-COLOR and skips any element with a
// background-IMAGE - and the futuristic layer gives every card a background
// image (the energy line), so text on a card was never measured at all. Here
// the page is screenshotted a second time with every glyph made transparent,
// and each text run is measured against the PIXELS painted behind its own
// line boxes: the frosted glass, the ambient field, the band, the scrim,
// whatever is actually there. The text colour is composited with its own alpha
// and every inherited opacity. AA is 4.5:1, 3:1 for large text.
//
// WHAT ELSE. No section ground is a dark neutral (a control may be dark: a
// near-black brand gets a near-black button, never a black band). The mark
// and every logo file keep the audit's neutral colours, also as rendered. No
// colour literal in the contract block, the vh- kit, the rail's own style
// block or the sheet. The generated files (tokens.json, CONTRACT.md tables,
// sprites, the page's grids) match their sources, and the rail's icons in
// icons.json are byte-equal to auth.js's.
//
// Floors first, every time: a check that inspects nothing passes everything.
//
// Run: npx playwright test tests/design-system.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const ds = require(path.join(ROOT, 'scripts', 'build-design-system.js'));
const assets = require(path.join(ROOT, 'scripts', 'build-design-assets.js'));
const mark = require(path.join(ROOT, 'scripts', 'build-platform-mark.js'));
const { lowSat } = require(path.join(ROOT, 'scripts', 'audit-pages.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, workspaces: [] })); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

/* ── colour helpers (the same maths as brand-workspace-core) ──────────────── */

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const darkNeutral = (c) => core.isDarkNeutral(hex(c));

/* ── the palettes, from the same function the artifact is built from ──────── */

const PALETTES = ds.palettes();

function brandFor(p) {
  return {
    id: 'ws_ds_' + p.id, slug: 'ds-' + p.id, name: p.id === 'tenant-zero' ? 'Example brand' : p.name,
    status: 'active', palette: p.palette, typography: {}, voice: {},
    regions: [{ code: 'US', currency: 'USD', symbol: '$', store_url: 'https://us.example', home: true }],
    tokens: core.tokens({ palette: p.palette, typography: {} }),
  };
}

/** Open /design-system with this brand painted, at a viewport tall enough to need no scrolling. */
async function open(page, p) {
  const brand = brandFor(p);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.route('**/api/public-config**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, brand, workspaces: [] }) }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(base + '/design-system.html', { waitUntil: 'load' });
  const want = brand.tokens['--brand-band'];
  await page.waitForFunction((w) => document.documentElement.style.getPropertyValue('--brand-band').trim().toLowerCase() === w,
    want.toLowerCase(), { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.lnav-side a').length > 10, null, { timeout: 20000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  const h = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  await page.setViewportSize({ width: 1280, height: Math.min(h + 20, 14000) });
  await page.waitForTimeout(250);
  return { brand, errors };
}

/** Every visible run of text: its line boxes, its colour, its opacity, its size. */
const COLLECT = `(() => {
  const parse = (c) => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const opacityOf = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || '1'); return o; };
  const runs = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const text = t.textContent.replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    const el = t.parentElement;
    if (!el || el.closest('script,style,noscript,option,template')) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    if (el.closest('[disabled],[aria-disabled="true"]')) continue;
    const op = opacityOf(el);
    if (op < 0.06) continue;
    const fg = parse(s.color); if (!fg) continue;
    const range = document.createRange(); range.selectNodeContents(t);
    const rects = [...range.getClientRects()].filter((r) => r.width >= 2 && r.height >= 4)
      .map((r) => ({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }));
    if (!rects.length) continue;
    const size = parseFloat(s.fontSize) || 16, weight = parseInt(s.fontWeight, 10) || 400;
    const where = el.closest('[data-ds-component]') ? el.closest('[data-ds-component]').getAttribute('data-ds-component')
      : el.closest('#lifecycle-nav') ? 'rail' : (el.closest('[data-ds-section]') ? el.closest('[data-ds-section]').getAttribute('data-ds-section') : 'page');
    runs.push({ text: text.slice(0, 50), fg, op, size, weight, rects, where, cls: String(el.className || '').slice(0, 40), tag: el.tagName.toLowerCase() });
  }
  return runs;
})()`;

/** Section candidates: big painted boxes that are not controls. */
const SECTIONS = `(() => {
  const parse = (c) => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const CONTROL = 'button,a,input,select,textarea,[role="button"],.vh-chip,.vh-btn,.vh-step,.vh-credit-add,.lnav-link,.lnav-ghead,.lnav-i';
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest(CONTROL)) continue;
    // A swatch chip IS the colour it names: a specimen, not a section.
    if (el.classList.contains('vh-swatch-chip')) continue;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 64 || r.height < 40) continue;
    const bg = parse(s.backgroundColor);
    if (!bg || bg[3] < 0.5) continue;
    let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || '1');
    out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 50), id: el.id || '', bg, opacity: o,
      band: el.getAttribute('data-ds-band') || '', box: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } });
  }
  return out;
})()`;

/**
 * Screenshot the page with every glyph transparent, and read pixels from THAT
 * image inside the page (a canvas), so no PNG decoder is needed in Node.
 * Returns a sampler: given points, the RGB painted there.
 */
async function grounds(page) {
  await page.addStyleTag({ content: '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } ::placeholder { color: transparent !important; }' });
  await page.waitForTimeout(80);
  const b64 = (await page.screenshot({ type: 'png' })).toString('base64');
  await page.evaluate(async (data) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    window.__dsGround = { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
  }, b64);
  return async (points) => page.evaluate((pts) => {
    const G = window.__dsGround;
    return pts.map(([x, y]) => {
      const xi = Math.max(0, Math.min(G.w - 1, Math.round(x))), yi = Math.max(0, Math.min(G.h - 1, Math.round(y)));
      const i = (yi * G.w + xi) * 4;
      return [G.d[i], G.d[i + 1], G.d[i + 2]];
    });
  }, points);
}

/** The sample points inside a run's own line boxes. */
function runPoints(run) {
  const pts = [];
  for (const r of run.rects) {
    const xs = [0.15, 0.35, 0.5, 0.65, 0.85].map((f) => r.x + Math.max(2, Math.min(r.w - 2, r.w * f)));
    const ys = [0.3, 0.5, 0.7].map((f) => r.y + r.h * f);
    for (const x of xs) for (const y of ys) pts.push([x, y]);
  }
  return pts;
}

/** The worst ratio of this run's colour over the ground actually painted behind it. */
function worstRatio(run, ground) {
  let worst = Infinity, at = null;
  const a = run.fg[3] * run.op;
  for (const g of ground) {
    const painted = [0, 1, 2].map((k) => run.fg[k] * a + g[k] * (1 - a));
    const q = ratio(painted, g);
    if (q < worst) { worst = q; at = g; }
  }
  return { worst, ground: at };
}

for (const p of PALETTES) {
  test(`every text run on /design-system is AA against the pixels behind it: ${p.name}`, async ({ page }) => {
    const { errors } = await open(page, p);
    const runs = await page.evaluate(COLLECT);
    const sample = await grounds(page);
    const all = await sample(runs.flatMap(runPoints));
    let cursor = 0;
    for (const r of runs) { const n = runPoints(r).length; r.ground = all.slice(cursor, cursor + n); cursor += n; }
    expect(runs.length, 'found almost no text, so this proves nothing').toBeGreaterThan(300);
    expect(runs.filter((r) => r.where === 'rail').length, 'the rail was not measured').toBeGreaterThan(20);
    const comps = new Set(runs.map((r) => r.where));
    for (const c of ['Button', 'Card', 'Band', 'Failure', 'StatusLine', 'Marker', 'Table', 'Notice', 'Modal', 'EmptyState', 'Steps', 'CreditPill']) {
      expect(comps.has(c), `${c} was not measured`).toBe(true);
    }
    const bad = [];
    for (const r of runs) {
      const large = r.size >= 24 || (r.size >= 18.66 && r.weight >= 700);
      const need = large ? 3 : 4.5;
      const { worst, ground } = worstRatio(r, r.ground);
      if (worst + 0.01 < need) bad.push(`${r.where} ${r.tag}.${r.cls} "${r.text}" ${worst.toFixed(2)}:1 (needs ${need}) text ${hex(r.fg)} x${(r.fg[3] * r.op).toFixed(2)} on ${hex(ground)}`);
    }
    expect(bad, `${bad.length} unreadable runs under ${p.name}:\n  ${bad.slice(0, 15).join('\n  ')}`).toEqual([]);
    expect(errors, 'the page threw').toEqual([]);
  });

  test(`no section ground is a dark neutral, and a band is what sectionGround() chose: ${p.name}`, async ({ page }) => {
    const { brand } = await open(page, p);
    const secs = await page.evaluate(SECTIONS);
    const sample = await grounds(page);
    const outside = await sample(secs.map((s) => [s.box.x - 2, s.box.y + s.box.h / 2]));
    const top = await sample(secs.map((s) => [s.box.x + s.box.w / 2, s.box.y + 5]));
    expect(secs.length, 'found no painted sections, so this proves nothing').toBeGreaterThan(40);
    const dark = [];
    for (const [i, s] of secs.entries()) {
      // What the eye receives: the box's own colour at its own opacity, over the
      // pixel just outside it (the ground it sits on).
      const out = outside[i];
      const a = s.bg[3] * s.opacity;
      const eff = [0, 1, 2].map((k) => s.bg[k] * a + out[k] * (1 - a));
      if (darkNeutral(eff)) dark.push(`${s.tag}.${s.cls}#${s.id} ${hex(eff)}`);
    }
    expect(dark, `dark-neutral sections under ${p.name}:\n  ${dark.join('\n  ')}`).toEqual([]);
    // The bands, read off the PIXELS: inset corners, clear of the content.
    const bands = secs.filter((s) => s.band);
    expect(bands.length).toBeGreaterThanOrEqual(3);
    const want = { primary: brand.tokens['--brand-band'], accent: brand.tokens['--brand-band-accent'] };
    const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const b of bands) {
      const px = top[secs.indexOf(b)];
      expect(darkNeutral(px), `band ${b.band} painted ${hex(px)}`).toBe(false);
      const w = rgbOf(want[b.band]);
      expect(Math.max(...[0, 1, 2].map((k) => Math.abs(px[k] - w[k]))), `band ${b.band} painted ${hex(px)}, sectionGround chose ${want[b.band]}`).toBeLessThanOrEqual(3);
    }
  });
}

test('the mark and every logo file keep the neutral colours, as files and as rendered', async ({ page }) => {
  const files = [mark.SVG_PATH].concat(mark.LOGO_SET.map((l) => path.join(ROOT, l.file)));
  let seen = 0;
  for (const f of files) {
    const committed = fs.readFileSync(f, 'utf8');
    // The generator, RUN: what it writes for this kind is what is committed.
    const entry = mark.LOGO_SET.find((l) => path.join(ROOT, l.file) === f);
    if (entry) expect(mark.logoSvg(entry.kind), `${entry.file} drifted: run node scripts/build-platform-mark.js --logos`).toBe(committed);
    for (const h of committed.match(/#[0-9A-Fa-f]{6}\b/g) || []) { expect(lowSat(h), `${h} in ${path.basename(f)} is a colour, not a neutral`).toBe(true); seen++; }
  }
  expect(seen, 'no colours read from the logo files').toBeGreaterThan(8);
  // Rendered, under the brand that most wants to bleed in.
  const red = PALETTES.find((x) => x.id === 'red');
  await open(page, red);
  const px = await page.evaluate(async () => {
    const out = [];
    for (const img of document.querySelectorAll('[data-ds-logo] img')) {
      if (/og\.png$/.test(img.src)) continue;
      await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth || 256; c.height = img.naturalHeight || 64;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let opaque = 0; const coloured = [];
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 250) continue;
        opaque++;
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (mx - mn > 24) coloured.push([d[i], d[i + 1], d[i + 2]]);
      }
      out.push({ src: img.src.split('/').pop(), opaque, coloured: coloured.length, sample: coloured.slice(0, 2) });
    }
    return out;
  });
  expect(px.length).toBeGreaterThanOrEqual(5);
  for (const r of px) {
    expect(r.opaque, `${r.src} rendered nothing`).toBeGreaterThan(100);
    expect(r.coloured, `${r.src} rendered hued pixels ${JSON.stringify(r.sample)}`).toBe(0);
  }
});

test('no colour literal in the contract block, the vh- kit, the rail styles or the sheet', () => {
  const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*[\d.]|\bhsla?\(\s*[\d.]|:\s*(?:white|black|red|blue|green|gray|grey)\s*[;}]/g;
  const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const theme = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8');
  const bi = theme.indexOf('/* >>> DESIGN-SYSTEM:contract'), ei = theme.indexOf('/* <<< DESIGN-SYSTEM:contract */');
  expect(bi > 0 && ei > bi, 'theme.css lost its DESIGN-SYSTEM:contract markers').toBe(true);
  const block = strip(theme.slice(bi, ei));
  expect(block.length, 'the contract block is empty').toBeGreaterThan(4000);
  expect(block.match(LITERAL) || [], 'colour literal in the contract block').toEqual([]);

  // The opt-in kit: every rule whose selectors are .vh- classes, outside the
  // legacy 3D style-guide demo (its literals are that page's illustration). A
  // mask is excluded on purpose: a mask uses only alpha, so #000 there is a shape.
  const LEGACY = /\.vh-(3d|layered|raised|dimensional|depth)/;
  const kit = [];
  for (const m of strip(theme).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!/^\.vh-/.test(sel) || LEGACY.test(sel)) continue;
    const decls = m[2].split(';').filter((d) => !/^\s*(-webkit-)?mask/.test(d)).join(';');
    for (const hit of decls.match(LITERAL) || []) kit.push(`${sel.slice(0, 50)} :: ${hit}`);
  }
  expect(kit, 'colour literal in a vh- kit rule').toEqual([]);

  const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  const rs = auth.indexOf("wrap.id = 'lifecycle-nav';"), re = auth.indexOf('</style>', rs);
  const rail = strip(auth.slice(rs, re));
  expect(rail.length, 'the rail style block was not found').toBeGreaterThan(8000);
  expect(rail.match(LITERAL) || [], 'colour literal in the rail\'s own styles').toEqual([]);

  const sheet = fs.readFileSync(path.join(ROOT, 'design-system.html'), 'utf8');
  const style = strip((sheet.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '');
  const inline = (sheet.match(/style="[^"]*"/g) || []).join(' ');
  expect(style.length).toBeGreaterThan(2000);
  expect((style + inline).match(LITERAL) || [], 'colour literal on /design-system').toEqual([]);
});

test('icons and illustrations: currentColor or tokens, no hue of their own, the rail glyphs unchanged', () => {
  const sprite = fs.readFileSync(path.join(ROOT, 'assets', 'lifecycle-os', 'icons.svg'), 'utf8');
  expect((sprite.match(/<symbol /g) || []).length).toBe(assets.ICONS.icons.length);
  expect(assets.ICONS.icons.length).toBeGreaterThanOrEqual(50);
  expect(sprite.match(/#[0-9A-Fa-f]{3,8}\b/g) || [], 'an icon carries a colour').toEqual([]);
  expect(sprite, 'a symbol fixes its own stroke, so .vh-icon cannot reach it').not.toMatch(/<symbol[^>]*(stroke|fill)=/);
  for (const i of assets.ILLS.illustrations) {
    for (const v of i.body.match(/(fill|stroke):[^;"]+/g) || []) {
      expect(v, `${i.name}: ${v} is not a token`).toMatch(/var\(--vh-[a-z-]+,\s*#[0-9A-Fa-f]{6}\)|:none/);
      for (const h of v.match(/#[0-9A-Fa-f]{6}/g) || []) expect(lowSat(h), `${i.name} fallback ${h} is a hue`).toBe(true);
    }
  }
  // The rail's ICONS in auth.js, byte-equal to the set's copies.
  const auth = fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8');
  const block = auth.slice(auth.indexOf('const ICONS = {'), auth.indexOf('};', auth.indexOf('const ICONS = {')));
  const fromAuth = assets.ICONS.icons.filter((i) => i.from === 'auth.js');
  expect(fromAuth.length).toBeGreaterThanOrEqual(12);
  for (const i of fromAuth) {
    const m = block.match(new RegExp(`\\b${i.name}:\\s*'([^']*)'`));
    expect(m && m[1], `auth.js ICONS has no ${i.name}`).toBe(i.body);
  }
});

test('the generated files match their sources: tokens.json, CONTRACT.md, sprites, the sheet grids', () => {
  for (const [rel, body] of Object.entries(ds.outputs())) {
    expect(fs.readFileSync(path.join(ROOT, rel), 'utf8'), `${rel} drifted: run node scripts/build-design-system.js`).toBe(body);
  }
  for (const [rel, body] of Object.entries(assets.outputs())) {
    expect(fs.readFileSync(path.join(ROOT, rel), 'utf8'), `${rel} drifted: run node scripts/build-design-assets.js`).toBe(body);
  }
  // And what the contract promises is what tokens() delivers, for every palette.
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'lifecycle-os', 'tokens.json'), 'utf8'));
  expect(c.examples.length).toBe(PALETTES.length);
  for (const e of c.examples) {
    const t = e.tokens;
    expect(core.isDarkNeutral(t['--brand-band']), `${e.id} band`).toBe(false);
    expect(core.isDarkNeutral(t['--brand-band-accent']), `${e.id} accent band`).toBe(false);
    expect(core.contrast(t['--brand-on-band'], t['--brand-band']), `${e.id} on-band`).toBeGreaterThanOrEqual(4.5);
    for (const k of ['--brand-ink', '--brand-ink-muted', '--brand-primary-text', '--brand-accent-text', '--brand-ok-text', '--brand-warn-text', '--brand-err-text']) {
      expect(core.contrast(t[k], t['--brand-surface-sunken']), `${e.id} ${k} on the sunken panel`).toBeGreaterThanOrEqual(4.5);
    }
    expect(core.contrast(t['--brand-focus'], t['--brand-surface']), `${e.id} focus ring`).toBeGreaterThanOrEqual(3);
  }
});
