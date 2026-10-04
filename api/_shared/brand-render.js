'use strict';
/**
 * brand-render.js — read a brand's design off its RENDERED site.
 * ---------------------------------------------------------------------------
 * The operator's words, with a screenshot of /onboarding: "read my site should
 * actually be fetching the exact styling and branding of the website entered
 * and apply that complete accurately", and the pipeline they drew:
 *
 *   URL -> Chromium renderer -> { DOM, assets, screenshots }
 *       -> computed CSS / asset map / visual reference -> DESIGN MANIFEST
 *       -> site generator -> rendered clone -> visual regression
 *       -> mismatch > limit ? repair (loop) : DONE
 *
 * This module is the first half: URL -> manifest. render-regression.js is the
 * second half, and its "site generator" is OUR OWN renderers (the /lp/:id
 * landing page, the mailer, the ad creative) fed by the manifest - so the score
 * is how close what this platform ships is to the brand's site.
 *
 * TWO ENTRY POINTS, both stable:
 *   readRendered(url, { browser, viewports, maxPages, deadlineMs, policy })
 *       -> manifest. Takes an ALREADY-LAUNCHED browser (CI passes Playwright's
 *       own Chromium) and does not touch the HTTP router. The network layer is
 *       render-net.js's either way, so the SSRF rules hold for every caller.
 *   readSite(url, opts)
 *       -> { ok, renderer, manifest, apply, regression } or the labelled
 *       fallback reason ('unavailable' | 'blocked' | 'timeout'). Launches its
 *       own fresh browser through render-browser.js and runs the regression.
 *
 * WHAT COMES BACK, and the rule every value obeys: it carries its SOURCE - the
 * page URL, the element ROLE, the selector path it was read from, the viewport,
 * and `signal: 'computed'`. A role the site does not render is a
 * `[DATA REQUIRED BEFORE LAUNCH: ...]` marker, never a plausible default.
 *
 * Colour roles keep the parser's model (brand-extract.js): `primary` comes ONLY
 * from an IDENTITY signal - theme-color, manifest theme_color, a --brand* token
 * as COMPUTED on :root, a chromatic header/brand surface or logo fill as
 * rendered - and the rendered primary CTA is the ACTION signal. When the two
 * disagree that is reported as a conflict, never resolved here. When the CTA is
 * the only brand colour the site renders, it is the primary and says so
 * (`from_role: 'action'`).
 *
 * NOT a function file. Mounted on /api/brand?op=extract (brand-workspace-core).
 */

const net = require('./render-net.js');
const capture = require('./render-capture.js');

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const DEFAULTS = {
  deadlineMs: 70000,       // the manifest; the regression loop has its own share
  keyPages: 2,             // beyond the home page: a collection/product page and an about page
  navMs: 20000,
  settleMs: 2500,
  fontsMs: 3000,
};

function MARKER(field, host) { return `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${host || 'this brand'}]`; }

function siteCrawl() { return require('./site-crawl.js'); }
function stab() { return require('./render-stabilise.js'); }
function extract() { return require('./brand-extract.js'); }
function core() { return require('./brand-workspace-core.js'); }

/** The parser's own page ranking, so both readers prefer the same pages. */
function pageRank(u) { return extract().pageRank(u); }

/** `@font-face` blocks out of the stylesheets the network layer captured. */
function fontFacesFrom(cssMap) {
  const faces = [];
  for (const [sheetUrl, css] of cssMap || []) {
    for (const m of String(css).matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
      const body = m[1];
      const fam = /font-family\s*:\s*([^;]+)/i.exec(body);
      if (!fam) continue;
      const family = fam[1].trim().replace(/^["']|["']$/g, '');
      const weight = (/font-weight\s*:\s*([^;]+)/i.exec(body) || [])[1] || '400';
      const style = (/font-style\s*:\s*([^;]+)/i.exec(body) || [])[1] || 'normal';
      const src = (/src\s*:\s*([^;]+)/i.exec(body) || [])[1] || '';
      for (const u of src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*['"]?([^'")]+)['"]?\s*\))?/gi)) {
        let abs = '';
        try { abs = new URL(u[2], sheetUrl).toString(); } catch (_) { abs = ''; }
        if (!/^https?:\/\//.test(abs)) continue;
        faces.push({ family, weight: weight.trim(), style: style.trim(), url: abs, format: (u[3] || '').trim(), sheet: sheetUrl });
      }
    }
  }
  return faces;
}

/** Custom-property NAMES seen in any captured stylesheet (cross-origin included). */
function cssNamesFrom(cssMap) {
  const names = new Set();
  for (const [, css] of cssMap || []) {
    for (const m of String(css).matchAll(/(--[a-zA-Z0-9_-]{1,60})\s*:/g)) { names.add(m[1]); if (names.size > 600) break; }
  }
  return [...names];
}

const withTimeout = (p, ms, what) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => { const e = new Error(`${what} took longer than ${ms}ms`); e.code = 'timeout'; rej(e); }, Math.max(1, ms))),
]);

/** Open, settle and capture one page at one viewport. */
async function capturePageAt(context, url, ctx, { viewport, label, states }) {
  const page = await context.newPage();
  const left = () => ctx.deadline - Date.now();
  try {
    page.setDefaultTimeout(Math.max(2000, Math.min(DEFAULTS.navMs, left())));
    const resp = await withTimeout(page.goto(url, { waitUntil: 'domcontentloaded' }), Math.min(DEFAULTS.navMs, left()), `opening ${url}`);
    await page.waitForLoadState('load', { timeout: Math.max(500, Math.min(8000, left() - 2000)) }).catch(() => {});
    // The ONE frozen state (render-stabilise.js), the same one our clone is
    // measured in: network idle and fonts (bounded), motion zeroed, consent
    // overlays hidden - never accepted.
    const firstFreeze = await stab().stabilise(page, { deadline: ctx.deadline, idleMs: DEFAULTS.settleMs, fontsMs: DEFAULTS.fontsMs });
    // Lazy images and below-the-fold components only exist once scrolled to.
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 8; y += step, i++) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 120));
    }).catch(() => {});
    // Lazy content the scroll brought in may have started its own motion.
    const again = await stab().stabilise(page, { deadline: ctx.deadline, idleMs: 800, fontsMs: 800 });
    const stabilised = Object.assign({}, again, {
      consent_hidden: [].concat(firstFreeze.consent_hidden || [], again.consent_hidden || []),
      animations_finished: (firstFreeze.animations_finished || 0) + (again.animations_finished || 0),
      animations_cancelled: (firstFreeze.animations_cancelled || 0) + (again.animations_cancelled || 0),
    });
    const html = await page.content().catch(() => '');
    const shot = {};
    const data = await withTimeout(page.evaluate(capture.capturePage, { cssNames: cssNamesFrom(ctx.ledger.css), maxImages: 40 }), Math.max(1000, Math.min(15000, left())), 'measuring the page');
    data.__viewport = label;
    data.stabilised = stabilised;
    // The face the engine actually drew each role in (not the declared stack).
    data.drawn = await drawnFaces(page, {
      display: '[data-lcos-role="display"]', h1: '[data-lcos-role="h1"]', body: '[data-lcos-role="body"]',
      'button-primary': '[data-lcos-role="button-primary"]', 'card-title': '[data-lcos-role="card-title"]',
      logo: '[data-lcos-role="logo"]', 'nav-link': '[data-lcos-role="nav-link"]',
    }).catch(() => ({}));
    data.status = resp ? resp.status() : 0;
    // Interaction states, read AFTER the state is applied, with transitions
    // switched off so the final state is what is read.
    const st = {};
    if (states) {
      await page.evaluate(() => {
        try { const s = document.createElement('style'); s.setAttribute('data-lcos', 'notransition'); s.textContent = '*,*::before,*::after{transition:none!important}'; document.head.appendChild(s); } catch (_) { /* CSP */ }
      }).catch(() => {});
      for (const role of ['button-primary', 'button-secondary']) {
        const loc = page.locator(`[data-lcos-role="${role}"]`).first();
        if (!(await loc.count().catch(() => 0))) continue;
        const key = role.replace('-', '_');
        st[key] = {};
        try {
          await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
          await loc.hover({ timeout: 2000, force: true });
          await page.waitForTimeout(220);
          st[key].hover = await page.evaluate(capture.stateStyle, role);
          await page.mouse.move(0, 0);
          await page.evaluate((r) => { const el = document.querySelector('[data-lcos-role="' + r + '"]'); if (el) { try { el.focus({ focusVisible: true }); } catch (_) { el.focus(); } } }, role);
          await page.waitForTimeout(120);
          st[key].focus = await page.evaluate(capture.stateStyle, role);
          await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
        } catch (_) { /* a state that cannot be produced is simply not recorded */ }
      }
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    }
    // Screenshots: the visual reference, and each component on its own.
    if (ctx.screenshots !== false) {
      shot.fold = await page.screenshot({ type: 'jpeg', quality: 62, animations: 'disabled' }).catch(() => null);
      shot.full = await page.screenshot({ type: 'jpeg', quality: 45, fullPage: true, animations: 'disabled', clip: { x: 0, y: 0, width: viewport.width, height: Math.min(data.page_height || viewport.height, 5200) } }).catch(() => null);
      shot.parts = {};
      for (const role of ['button-primary', 'button-secondary', 'display', 'h1', 'body', 'card', 'card-title', 'header', 'footer', 'logo']) {
        const loc = page.locator(`[data-lcos-role="${role}"]`).first();
        if (!(await loc.count().catch(() => 0))) continue;
        const b = await loc.boundingBox().catch(() => null);
        if (!b || b.width < 2 || b.height < 2 || b.height > 1600) continue;
        shot.parts[role] = await loc.screenshot({ animations: 'disabled', timeout: 3000 }).catch(() => null);
      }
      // The same parts again ~500 ms later: whatever differs between the two
      // is LIVE content (a carousel, a ticker, a countdown) and is masked out
      // of the perceptual comparison. The text boxes are masked too.
      shot.text = {};
      for (const role of Object.keys(shot.parts)) shot.text[role] = await page.evaluate(capture.textRects, `[data-lcos-role="${role}"]`).catch(() => []);
      await page.waitForTimeout(500);
      shot.parts2 = {};
      for (const role of Object.keys(shot.parts)) {
        if (!shot.parts[role]) continue;
        shot.parts2[role] = await page.locator(`[data-lcos-role="${role}"]`).first().screenshot({ animations: 'disabled', timeout: 3000 }).catch(() => null);
      }
    }
    return { data, html, shots: shot, states: st, page };
  } catch (e) {
    await page.close().catch(() => {});
    throw e;
  }
}

/**
 * The face that ACTUALLY DREW each element's text, from the engine itself
 * (CDP CSS.getPlatformFontsForNode on the element's text-carrying node).
 *
 * Review finding (2026-10-04): comparing the DECLARED stack lets a family that
 * is declared and never loaded pass - the ad named a Google family and never
 * linked it, and the score was 100%. A declared family the engine fell back
 * from now shows up as a different drawn face, on the site's side and ours.
 * `selectors`: { key: cssSelector }. Returns { key: { family, custom } }.
 */
async function drawnFaces(page, selectors) {
  const out = {};
  const keys = Object.keys(selectors || {});
  if (!keys.length) return out;
  // Mark each element's text carrier: the platform-font query reports the
  // fonts of a node's OWN text, so it is asked of the node that carries it.
  await page.evaluate((sel) => {
    const own = (n) => { let t = ''; for (const c of n.childNodes) if (c.nodeType === 3) t += c.nodeValue; return t.trim(); };
    for (const [k, s] of Object.entries(sel)) {
      const el = document.querySelector(s);
      if (!el) continue;
      let best = el, bl = own(el).length;
      for (const d of el.querySelectorAll('*')) { const l = own(d).length; if (l > bl) { best = d; bl = l; } }
      if (bl) best.setAttribute('data-lcos-carrier', k);
    }
  }, selectors).catch(() => {});
  let cdp = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    for (const k of keys) {
      try {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-lcos-carrier="${k}"]` });
        if (!nodeId) continue;
        const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        const top = (fonts || []).slice().sort((a, b) => (b.glyphCount || 0) - (a.glyphCount || 0))[0];
        if (top) out[k] = { family: top.familyName || '', custom: !!top.isCustomFont };
      } catch (_) { /* that node is not measurable */ }
    }
  } catch (_) { /* no CDP on this browser: the drawn face is simply not compared */ }
  finally { if (cdp) await cdp.detach().catch(() => {}); }
  return out;
}

function src(capt, role, viewport, property, selector) {
  return { page: capt && capt.url, role, selector: selector || '', viewport, property, signal: 'computed' };
}

/** Identity candidates, in the order the rule ranks them. */
function identityCandidates(desk, manifestThemeColor) {
  const bx = extract();
  const out = [];
  const chroma = (h) => h && !bx.isNeutral(h);
  if (desk.meta && desk.meta.theme_color) out.push({ value: desk.meta.theme_color, signal: 'meta theme-color', role: 'identity', neutral: !chroma(desk.meta.theme_color), source: src(desk, 'theme-color', 'desktop', 'content', 'meta[name=theme-color]') });
  if (manifestThemeColor && manifestThemeColor.value) out.push({ value: manifestThemeColor.value, signal: 'web app manifest theme_color', role: 'identity', neutral: !chroma(manifestThemeColor.value), source: { page: manifestThemeColor.url, role: 'manifest', selector: 'theme_color', viewport: '', property: 'theme_color', signal: 'declared' } });
  for (const [name, v] of Object.entries(desk.custom_properties || {})) {
    if (!v.hex) continue;
    if (bx.tokenNameRole(name) === 'identity') out.push({ value: v.hex, signal: `${name} as computed on :root${v.inline ? ' (set at runtime by script)' : ''}`, role: 'identity', neutral: !chroma(v.hex), source: src(desk, 'custom property', 'desktop', name, ':root') });
  }
  const hdr = desk.roles && desk.roles.header;
  const hbg = hdr && ((hdr.style && hdr.style.background) || '');
  if (hbg && chroma(hbg)) out.push({ value: hbg, signal: 'header background as rendered', role: 'identity', neutral: false, source: src(desk, 'header', 'desktop', 'background-color', hdr.selector) });
  const logo = desk.roles && desk.roles.logo;
  if (logo && logo.svg_fill && chroma(logo.svg_fill)) out.push({ value: logo.svg_fill, signal: 'logo mark fill as rendered', role: 'identity', neutral: false, source: src(desk, 'logo', 'desktop', 'fill', logo.selector) });
  return out;
}

function deltaE(a, b) { return require('./render-regression.js').deltaE2000(a, b); }

/**
 * Build the manifest from the measurements. Pure: no browser, no network.
 */
function buildManifest({ start, desk, mob, extra, states, ledger, renderer, manifestJson, timings, partial, notes }) {
  const k = core();
  const bx = extract();
  const host = (() => { try { return new URL(start).hostname; } catch (_) { return start; } })();
  const markers = [];
  const hardRules = [];
  const provenance = {};
  const rd = desk.roles || {};
  const colors = {};
  const set = (role, value, source, extraInfo) => { if (value) { colors[role] = Object.assign({ value, source }, extraInfo || {}); provenance[`palette.${role}`] = source; } };

  // surface, ink, muted, card, link
  if (rd.surface) set('surface', rd.surface.color, src(desk, 'page ground', 'desktop', 'background-color', rd.surface.from));
  if (rd.body) set('ink', rd.body.type.color, src(desk, 'body copy', 'desktop', 'color', rd.body.selector));
  else markers.push(MARKER('body copy colour', host));
  if (rd.muted) set('muted', rd.muted.type.color, src(desk, 'secondary text', 'desktop', 'color', rd.muted.selector));
  const cardRole = rd.card || (extra || []).map((e) => e.data.roles && e.data.roles.card).find(Boolean) || null;
  if (cardRole) set('surface_alt', (cardRole.style && cardRole.style.background) || (cardRole.style && cardRole.style.ground) || '', src(desk, 'product card', 'desktop', 'background-color', cardRole.selector));

  // identity vs action
  const action = rd.button_primary && rd.button_primary.style ? rd.button_primary.style.background : '';
  const idc = identityCandidates(desk, manifestJson && manifestJson.theme_color ? { value: manifestJson.theme_color, url: manifestJson.url } : null);
  const identity = idc.find((c) => !c.neutral) || null;
  const conflicts = [];
  if (identity) {
    set('primary', identity.value, identity.source, { signal: identity.signal, from_role: 'identity' });
    if (action && !bx.isNeutral(action) && deltaE(identity.value, action) > 10) {
      conflicts.push({
        kind: 'brand_colour_vs_action_colour',
        message: `The site declares ${identity.value} as its own colour (${identity.signal}) but renders its primary call to action in ${action}. These are different facts and only you know which one is the brand primary. The primary below is the declared one; the action colour is the accent.`,
        identity: { value: identity.value, signal: identity.signal, source_url: identity.source.page },
        action: { value: action, signal: 'primary call to action, as rendered', source_url: desk.url },
      });
    }
    if (action && deltaE(identity.value, action) > 2.3) set('accent', action, src(desk, 'primary call to action', 'desktop', 'background-color', rd.button_primary.selector), { from_role: 'action' });
  } else if (action && !bx.isNeutral(action)) {
    set('primary', action, src(desk, 'primary call to action', 'desktop', 'background-color', rd.button_primary.selector), { signal: 'the primary call to action, as rendered: the only brand colour this site renders', from_role: 'action' });
  } else {
    markers.push(MARKER('brand primary colour (the site renders no identity colour and no coloured call to action)', host));
  }
  if (!colors.accent) {
    const sec = rd.button_secondary && rd.button_secondary.style ? (rd.button_secondary.style.background || rd.button_secondary.style.border_color) : '';
    const linkC = rd.link && rd.link.type ? rd.link.type.color : '';
    const alt = [sec, linkC].find((c) => c && !bx.isNeutral(c) && (!colors.primary || deltaE(c, colors.primary.value) > 2.3));
    if (alt) set('accent', alt, src(desk, alt === sec ? 'secondary call to action' : 'body link', 'desktop', alt === sec ? 'background-color' : 'color', alt === sec ? rd.button_secondary.selector : rd.link.selector), { from_role: alt === sec ? 'action' : 'link' });
  }

  // Typography: the family each role RENDERS in.
  const faces = fontFacesFrom(ledger && ledger.css);
  const fetchedFonts = new Set(((ledger && ledger.fonts) || []).flatMap((f) => [f.url, f.final]));
  const fonts = {};
  const fontFor = (slot, role, roleName) => {
    if (!role || !role.type) { markers.push(MARKER(`typography.${slot}`, host)); return; }
    const t = role.type;
    const stackFams = String(t.stack || '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    const fam = t.family_kind === 'webfont' ? t.family : (stackFams[0] || t.family);
    const idx = stackFams.findIndex((f) => f.toLowerCase() === String(fam).toLowerCase());
    const rest = idx >= 0 ? stackFams.slice(idx) : [fam].concat(stackFams);
    const stack = rest.map((f) => (/^(serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-[a-z-]+|-apple-system|blinkmacsystemfont)$/i.test(f) ? f : `'${f.replace(/'/g, '')}'`)).join(',');
    const files = faces.filter((f) => f.family.toLowerCase() === String(fam).toLowerCase());
    const used = files.filter((f) => fetchedFonts.has(f.url));
    const keep = (used.length ? used : files).slice(0, 6).map((f) => ({ url: f.url, weight: f.weight, style: f.style, format: f.format }));
    const google = keep.some((f) => /fonts\.gstatic\.com/.test(f.url)) || files.some((f) => /fonts\.googleapis\.com/.test(f.sheet));
    const weights = [...new Set(((desk.fonts && desk.fonts.faces) || []).filter((f) => f.family.toLowerCase() === String(fam).toLowerCase() && f.status === 'loaded').map((f) => String(f.weight)))].slice(0, 6);
    // THE FONT LEGAL GATE (2026-10-04): a family and the URLs its files are
    // served from are RECORDED; the files are loaded BY REFERENCE to measure
    // the site and preview our clone, and are never copied or re-hosted into
    // our storage or into a generated email. A family that is not openly
    // licensed (not served by Google Fonts) is the brand's own font: shown as
    // "<family> (brand font)" with the stack the site itself falls back to.
    const brandFont = t.family_kind === 'webfont' && !google;
    fonts[slot] = {
      family: fam, kind: t.family_kind, stack, google, files: keep, weights,
      licence: google ? 'open (Google Fonts)' : (brandFont ? 'brand font' : 'system'),
      display_name: brandFont ? `${fam} (brand font)` : fam,
      fallback_stack: rest.slice(1).map((f) => (/^(serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-[a-z-]+|-apple-system|blinkmacsystemfont)$/i.test(f) ? f : `'${f.replace(/'/g, '')}'`)).join(',') || 'sans-serif',
      files_by_reference: true,
      declared_stack: t.stack,
      source: src(desk, roleName, 'desktop', 'font-family', role.selector),
      note: t.family_kind === 'webfont' ? 'Loaded web font, rendering this role.'
        : (t.family_kind === 'local' || t.family_kind === 'generic' ? 'A system font stack: each visitor\'s device picks the face. The stack is kept exactly as the site declares it.' : 'No face in the declared stack could be confirmed as rendering.'),
    };
    provenance[`typography.${slot}`] = fonts[slot].source;
  };
  const headRole = (rd.headings && rd.headings.h1) || rd.display || null;
  fontFor('heading', headRole, headRole === rd.display ? 'display heading (largest text near the top)' : 'h1');
  fontFor('body', rd.body, 'body copy');

  // Assets: logo, favicon, imagery.
  const assets = { images: [], icons: (desk.assets && desk.assets.icons) || [] };
  if (rd.logo) {
    assets.logo = {
      kind: rd.logo.kind, url: rd.logo.src || '', natural: rd.logo.natural, rendered: rd.logo.rendered,
      inline_svg: rd.logo.inline_svg || '', placement: rd.logo.placement,
      source: src(desk, 'logo', 'desktop', rd.logo.kind === 'svg' ? 'outerHTML' : 'currentSrc', rd.logo.selector),
    };
    provenance.logo_url = assets.logo.source;
  } else markers.push(MARKER('logo', host));
  const iconRank = (i) => (/apple-touch-icon/.test(i.rel) ? 3 : (/svg/.test(i.type) || /\.svg/.test(i.url) ? 2 : 1)) * 1000 + (parseInt(String(i.sizes).split('x')[0], 10) || 0);
  const icon = assets.icons.filter((i) => i.url && !/mask-icon/.test(i.rel)).sort((a, b) => iconRank(b) - iconRank(a))[0];
  if (icon) assets.favicon = { url: icon.url, rel: icon.rel, sizes: icon.sizes, source: { page: desk.url, role: 'icon', selector: `link[rel=${icon.rel}]`, viewport: '', property: 'href', signal: 'declared' } };
  else markers.push(MARKER('favicon', host));
  if (manifestJson && Array.isArray(manifestJson.icons)) assets.manifest_icons = manifestJson.icons.slice(0, 12);
  assets.images = ((desk.assets && desk.assets.images) || []).map((i) => Object.assign({ page: desk.url }, i));
  for (const e of extra || []) for (const i of ((e.data.assets && e.data.assets.images) || []).slice(0, 12)) assets.images.push(Object.assign({ page: e.data.url }, i));
  assets.images = assets.images.filter((i, n, a) => i.url && a.findIndex((x) => x.url === i.url) === n).slice(0, 60);
  assets.fonts = faces.filter((f) => fetchedFonts.has(f.url)).slice(0, 24);

  // Hard rules, visible.
  const dn = (h) => h && k.isDarkNeutral(h);
  if (rd.surface && dn(rd.surface.color)) hardRules.push({ kind: 'dark-surface', component: 'page', value: rd.surface.color, rule: 'Activation is refused for a dark-neutral page surface; the brand can be saved as a draft with this exact value, and a light surface is yours to choose.' });
  const sectionChecks = [
    ['header', rd.header && ((rd.header.style && rd.header.style.background) || rd.header.ground)],
    ['footer', rd.footer && ((rd.footer.style && rd.footer.style.background) || rd.footer.ground)],
    ['hero', (rd.display && !rd.display.over_media) ? rd.display.ground : ''],
  ];
  for (const s of (desk.layout && desk.layout.sections) || []) if (!s.image) sectionChecks.push([`section ${s.selector}`, s.ground]);
  // One entry per dark value, naming every component that paints it.
  const darkBy = new Map();
  for (const [comp, val] of sectionChecks) {
    if (!dn(val)) continue;
    const key = String(val).toLowerCase();
    if (!darkBy.has(key)) darkBy.set(key, { value: val, components: [] });
    if (!darkBy.get(key).components.includes(comp)) darkBy.get(key).components.push(comp);
  }
  for (const d of darkBy.values()) {
    hardRules.push({ kind: 'dark-section', component: d.components[0], components: d.components, value: d.value, rule: `Your site paints the ${d.components.join(' and ')} ${d.value}, a dark neutral. Generated assets never paint a dark-neutral section, so this value is recorded exactly and our renderers use your brand primary or surface there instead (sectionGround).` });
  }
  const aa = (token, fg, bg, size, weight) => {
    if (!fg || !bg) return;
    const large = (size || 0) >= 24 || ((size || 0) >= 18.66 && Number(weight) >= 700);
    const need = large ? 3 : 4.5;
    const r = k.contrast(fg, bg);
    if (r >= need) return;
    const derived = k.readableAsText(fg, bg, need);
    hardRules.push({ kind: 'aa', token, exact: fg, against: bg, ratio_exact: r, derived, ratio_derived: k.contrast(derived, bg), target: need, label: `DERIVED from ${fg}` });
  };
  if (rd.body) aa('body copy', rd.body.type.color, rd.body.ground || (rd.surface && rd.surface.color), rd.body.type.size, rd.body.type.weight);
  if (rd.button_primary) aa('primary button label', rd.button_primary.type.color, rd.button_primary.style.background || rd.button_primary.style.ground, rd.button_primary.type.size, rd.button_primary.type.weight);
  if (rd.nav_link && rd.header) aa('header link', rd.nav_link.type.color, (rd.header.style && rd.header.style.background) || rd.header.ground, rd.nav_link.type.size, rd.nav_link.type.weight);
  if (rd.footer && rd.footer.text) aa('footer text', rd.footer.text.color, (rd.footer.style && rd.footer.style.background) || rd.footer.ground, rd.footer.text.size, rd.footer.text.weight);

  for (const [role, field] of [['button_primary', 'primary call to action'], ['header', 'header bar'], ['footer', 'footer'], ['body', 'body copy']]) {
    if (!rd[role]) markers.push(MARKER(field, host));
  }
  if (!cardRole) markers.push(MARKER('product card (no repeated unit with an image, a title and a price was rendered on the pages read)', host));

  if (mob && !(mob.meta && mob.meta.viewport)) {
    (notes || []).push('This site declares no viewport meta, so a phone lays out the desktop page at 980px and scales it. The phone values below are what such a phone shows, not a phone design.');
  }
  const pages = [{ url: desk.url, role: 'home' }].concat((extra || []).map((e) => ({ url: e.data.url, role: e.role })));
  const trimCap = (c) => (c ? Object.assign({}, c, { links: undefined, custom_properties: c.custom_properties }) : c);
  return {
    version: 'design-manifest/1',
    url: desk.url,
    start,
    read_at: new Date().toISOString(),
    renderer,
    viewports: { desktop: desk.viewport, mobile: mob ? mob.viewport : null },
    pages,
    colors, conflicts, identity: { candidates: idc.map((c) => ({ value: c.value, signal: c.signal, neutral: c.neutral, source: c.source })), primary_from: colors.primary ? colors.primary.from_role : '' },
    fonts,
    read: { desktop: trimCap(desk), mobile: trimCap(mob) },
    card_source: rd.card ? null : ((extra || []).find((e) => e.data.roles && e.data.roles.card) ? { desktop: Object.assign({}, (extra || []).find((e) => e.data.roles && e.data.roles.card).data.roles, { __page: ((extra || []).find((e) => e.data.roles && e.data.roles.card) || {}).data.url }) } : null),
    states: states || {},
    assets,
    custom_properties: desk.custom_properties || {},
    hard_rules: hardRules,
    markers: [...new Set(markers)],
    provenance,
    network: ledger ? {
      requests: ledger.requests, bytes: ledger.bytes, blocked_count: ledger.blocked_count,
      blocked: ledger.blocked.slice(0, 40), budget_hit: ledger.budget_hit || '',
      stylesheets: [...ledger.css.keys()].slice(0, 30), fonts_fetched: ledger.fonts.length,
    } : null,
    timings: timings || {},
    partial: !!partial,
    notes: notes || [],
  };
}

/**
 * THE STABLE ENTRY POINT. `browser` is an already-launched Playwright browser
 * (playwright-core or @playwright/test, any Chromium). Opens its own contexts
 * and never closes the browser - the caller owns it. Contexts are not closed
 * either: closing a context crashes a single-process Chromium (see
 * render-browser.js), so pages are closed and the caller closes the browser.
 *
 * opts: { viewports: {desktop, mobile}, maxPages (extra pages, default 2),
 *         deadlineMs, policy: { allowOrigins:Set } (in-process test seam),
 *         screenshots (default true), keepPages (return the open pages for the
 *         regression loop), renderer (info to record) }
 * Returns the manifest, or throws an Error with `.code` in
 * 'blocked' | 'timeout' | 'unavailable' and a sentence.
 */
async function readRendered(url, opts) {
  const o = Object.assign({}, opts || {});
  const browser = o.browser;
  if (!browser) { const e = new Error('readRendered needs an already-launched browser.'); e.code = 'unavailable'; throw e; }
  const vps = Object.assign({}, VIEWPORTS, o.viewports || {});
  const t0 = Date.now();
  const deadline = t0 + (o.deadlineMs || DEFAULTS.deadlineMs);
  const timings = {};
  const notes = [];
  const policy = Object.assign({ dnsCache: new Map() }, o.policy || {});
  // The start URL: the same guard as every import, unless a test origin was
  // allowed in-process.
  let start = String(url || '').trim();
  if (!/^https?:\/\//i.test(start)) start = `https://${start}`;
  let startOrigin = '';
  try { startOrigin = new URL(start).origin; } catch (_) { const e = new Error('That is not a valid URL.'); e.code = 'unavailable'; throw e; }
  if (!(policy.allowOrigins && policy.allowOrigins.has(startOrigin))) start = await core().assertPublicUrl(start);
  const sc = siteCrawl();
  const hosts = sc.allowedHosts({ website: start });
  if (!hosts.size) hosts.add(new URL(start).hostname);
  // robots.txt, PER ORIGIN, fetched before the first document from that
  // origin and cached. Found in review (2026-10-04): an in-scope origin with no
  // cached entry (the start URL redirecting to another of the brand's hosts, a
  // link to another allowed subdomain) answered "no rules" - allow-all. An
  // origin's rules are now always READ before one of its documents is, and the
  // promise is cached so concurrent documents from one origin share one fetch.
  const disallowByOrigin = new Map();
  const limits = o.limits || null;
  const ctx = {
    policy, deadline, transport: o.transport, perRequestMs: o.perRequestMs, limits,
    budget: net.makeBudget((limits && limits.maxBytesTotal) || net.LIMITS.maxBytesTotal, limits && limits.maxRequests),
    inScope: (u) => sc.inScope(u, hosts) || (policy.allowOrigins && (() => { try { return policy.allowOrigins.has(new URL(u).origin); } catch (_) { return false; } })()),
    robotsFor: (u) => {
      let origin;
      try { origin = new URL(u).origin; } catch (_) { return Promise.resolve(['/']); }
      if (!disallowByOrigin.has(origin)) disallowByOrigin.set(origin, sc.robotsInfo(origin, robotsFetch, 6000).then((r) => r.disallow, () => []));
      return disallowByOrigin.get(origin);
    },
    ledger: null,
    screenshots: o.screenshots,
  };
  // robots.txt, through the same door.
  const robotsFetch = async (u) => {
    const r = await net.fetchFollow(u, ctx, { kind: 'resource' });
    return r.ok && r.status >= 200 && r.status < 300 ? { ok: true, status: r.status, body: r.body.toString('utf8') } : { ok: false, status: r.status || 0, body: '' };
  };
  await ctx.robotsFor(start);
  timings.robots_ms = Date.now() - t0;
  // Resolve the start document (redirects followed here, every hop checked).
  const first = await net.fetchFollow(start, ctx, { kind: 'document' });
  if (!first.ok) {
    const at = (() => { try { return new URL(first.url || start).host; } catch (_) { return start; } })();
    const e = new Error(/robots/.test(first.reason) ? `${at} disallows this page in its robots.txt, and this platform honours it.` : `The site could not be opened: ${first.reason}.`);
    e.code = /robots/.test(first.reason) ? 'blocked' : 'unavailable';
    throw e;
  }
  if (first.status === 401 || first.status === 403 || first.status === 429 || first.status === 503) {
    const e = new Error(`${new URL(first.finalUrl).hostname} answered HTTP ${first.status} to the browser's request. That is the site refusing an automated reader, not a problem with the address.`);
    e.code = 'blocked'; e.status = first.status; throw e;
  }
  if (first.status >= 400) { const e = new Error(`${new URL(first.finalUrl).hostname} answered HTTP ${first.status} for that address.`); e.code = 'unavailable'; throw e; }
  const home = first.finalUrl;

  const ctxOpts = (vp, mobile) => ({
    viewport: vp, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile,
    userAgent: net.USER_AGENT, serviceWorkers: 'block', acceptDownloads: false,
    javaScriptEnabled: true, bypassCSP: false, permissions: [], locale: 'en-US', colorScheme: 'light',
  });
  const desktopCtx = await browser.newContext(ctxOpts(vps.desktop, false));
  await stab().install(desktopCtx);
  ctx.ledger = await net.attach(desktopCtx, ctx);
  ctx.ledger.prefetched.set(home, first);
  const mobileCtx = await browser.newContext(ctxOpts(vps.mobile, true));
  await stab().install(mobileCtx);
  await net.attach(mobileCtx, ctx);

  let partial = false;
  const t1 = Date.now();
  const deskCap = await capturePageAt(desktopCtx, home, ctx, { viewport: vps.desktop, label: 'desktop', states: true });
  timings.desktop_ms = Date.now() - t1;
  // Is this the brand's page at all? The same judge the parser uses.
  const verdict = require('./soft-error-detect.js').assessPage({ html: deskCap.html, url: home, isHome: true });
  if (verdict.blocked) {
    await deskCap.page.close().catch(() => {});
    const e = new Error(`${new URL(home).hostname} served a ${verdict.reason.replace(/_/g, ' ')} page instead of the site (${verdict.served}). Nothing was read from it.`);
    e.code = 'blocked'; e.verdict = verdict; throw e;
  }

  let mobCap = null;
  if (Date.now() < deadline - 8000) {
    const t2 = Date.now();
    try {
      ctx.ledger.prefetched.set(home, await net.fetchFollow(home, ctx, { kind: 'document' }));
      mobCap = await capturePageAt(mobileCtx, home, ctx, { viewport: vps.mobile, label: 'mobile', states: false });
    } catch (e) { notes.push(`The phone-width read did not finish: ${e.message}`); partial = true; }
    timings.mobile_ms = Date.now() - t2;
  } else { partial = true; notes.push('The deadline was reached before the phone-width read; phone values are absent.'); }

  // A small number of key pages, ranked as the parser ranks them.
  const extra = [];
  const maxPages = o.maxPages == null ? DEFAULTS.keyPages : Math.max(0, Math.min(4, +o.maxPages || 0));
  if (maxPages) {
    const inScopeLinks = (deskCap.data.links || []).filter((u) => ctx.inScope(u) && u.split('#')[0] !== home);
    const links = [];
    for (const u of inScopeLinks.slice(0, 200)) if (net.robotsAllows(await ctx.robotsFor(u), u)) links.push(u);
    const wanted = [
      ['collection', (u) => /\/collections?\//i.test(new URL(u).pathname)],
      ['product', (u) => /\/products?\//i.test(new URL(u).pathname)],
      ['about', (u) => pageRank(u) === 90],
    ];
    const chosen = [];
    for (const [role, test] of wanted) {
      const hit = links.filter((u) => { try { return test(u); } catch (_) { return false; } }).sort((a, b) => pageRank(b) - pageRank(a))[0];
      if (hit && !chosen.some((c) => c.url === hit)) chosen.push({ role, url: hit });
      if (chosen.length >= maxPages) break;
    }
    for (const c of chosen) {
      if (Date.now() > deadline - 6000) { partial = true; notes.push(`The deadline was reached before ${c.url} was read.`); break; }
      const t3 = Date.now();
      try {
        const cap = await capturePageAt(desktopCtx, c.url, Object.assign({}, ctx, { screenshots: false }), { viewport: vps.desktop, label: 'desktop', states: false });
        extra.push({ role: c.role, data: cap.data });
        await cap.page.close().catch(() => {});
      } catch (e) { notes.push(`${c.url} could not be read: ${e.message}`); }
      timings[`page_${c.role}_ms`] = Date.now() - t3;
    }
  }

  // The web app manifest, through the same door.
  let manifestJson = null;
  if (deskCap.data.meta && deskCap.data.meta.manifest_url) {
    const r = await net.fetchFollow(deskCap.data.meta.manifest_url, ctx, { kind: 'resource' }).catch(() => null);
    if (r && r.ok && r.status < 300) {
      try {
        const j = JSON.parse(r.body.toString('utf8'));
        const tc = core().normHex(j.theme_color || '');
        manifestJson = { url: r.finalUrl, theme_color: tc, icons: Array.isArray(j.icons) ? j.icons.map((i) => ({ src: (() => { try { return new URL(i.src, r.finalUrl).toString(); } catch (_) { return ''; } })(), sizes: i.sizes || '', type: i.type || '' })).filter((i) => i.src) : [] };
      } catch (_) { notes.push('The web app manifest is not valid JSON.'); }
    }
  }

  timings.total_ms = Date.now() - t0;
  if (ctx.budget.exhausted) {
    partial = true;
    notes.push(`The byte budget for one read (${Math.round(ctx.budget.max / 1048576)} MB) was spent; ${ctx.budget.aborted} download(s) in flight were stopped. What was measured before that is below.`);
  }
  // A consent overlay is HIDDEN in this throwaway browser, never accepted.
  const hidden = [].concat((deskCap.data.stabilised && deskCap.data.stabilised.consent_hidden) || [], (mobCap && mobCap.data.stabilised && mobCap.data.stabilised.consent_hidden) || []);
  if (hidden.length) notes.push(`${hidden.length} consent overlay(s) were HIDDEN in the reader's throwaway browser, not accepted: nothing was consented to on anyone's behalf, and an overlay's colours are not read as the brand's.`);
  // Every hop counted, including the ones made outside a browser request.
  ctx.ledger.requests = ctx.budget.requests;
  ctx.ledger.bytes = ctx.budget.used;
  if (ctx.budget.requestsSpent) {
    partial = true;
    ctx.ledger.budget_hit = ctx.ledger.budget_hit || 'request count';
    notes.push(`The request budget for one read (${ctx.budget.maxRequests} connections, every redirect hop counted) was spent; later requests were refused. What was measured before that is below.`);
  }
  const manifest = buildManifest({
    start, desk: deskCap.data, mob: mobCap && mobCap.data, extra,
    states: deskCap.states, ledger: ctx.ledger,
    renderer: o.renderer || { source: 'caller', version: (() => { try { return browser.version(); } catch (_) { return ''; } })() },
    manifestJson, timings, partial, notes,
  });
  const shots = {
    desktop: deskCap.shots, mobile: mobCap ? mobCap.shots : null,
  };
  if (o.keepPages) {
    Object.defineProperty(manifest, '__live', {
      value: { desktopPage: deskCap.page, mobilePage: mobCap && mobCap.page, desktopCtx, mobileCtx, ctx, shots },
      enumerable: false,
    });
  } else {
    await deskCap.page.close().catch(() => {});
    if (mobCap) await mobCap.page.close().catch(() => {});
    Object.defineProperty(manifest, '__shots', { value: shots, enumerable: false });
  }
  ctx.closed = !o.keepPages;
  return manifest;
}

/* ── screenshots for a JSON response ─────────────────────────────────────── */
function b64(buf, mime) { return buf ? { mime, data: buf.toString('base64'), bytes: buf.length, sha256: require('crypto').createHash('sha256').update(buf).digest('hex') } : null; }

/**
 * The whole read, for the router: a fresh browser, the manifest, the
 * regression against OUR renderers, the field patch. Never throws; a failure
 * is labelled `renderer: 'unavailable' | 'blocked' | 'timeout'` with a reason.
 */
async function readSite(url, opts) {
  const o = Object.assign({}, opts || {});
  const t0 = Date.now();
  const deadlineMs = o.deadlineMs || 100000;
  const launcher = require('./render-browser.js');
  try {
    return await launcher.withBrowser(async (browser, info) => {
      const left = () => deadlineMs - (Date.now() - t0);
      const manifest = await withTimeout(readRendered(url, {
        browser, policy: o.policy, transport: o.transport, keepPages: true, limits: o.limits,
        deadlineMs: Math.max(15000, Math.min(o.manifestMs || 62000, left() - 25000)),
        maxPages: o.maxPages, renderer: info,
      }), Math.max(10000, left() - 5000), 'reading the site');
      const live = manifest.__live;
      let regression = null;
      if (o.regression !== false) {
        try {
          regression = await withTimeout(require('./render-regression.js').run({
            browser, manifest, live, brand: o.brand || null, seed: o.seed || null,
            deadline: t0 + deadlineMs - 4000,
          }), Math.max(5000, left() - 4000), 'the visual regression');
        } catch (e) {
          regression = { ok: false, partial: true, reason: e.message };
        }
      }
      const shots = live && live.shots ? live.shots : {};
      // The repaired manifest is the manifest (the loop corrects it in place);
      // the copy on the regression report is dropped so it is sent once.
      const finalManifest = regression && regression.manifest ? regression.manifest : manifest;
      if (regression) delete regression.manifest;
      const out = {
        ok: true,
        renderer: 'chromium',
        renderer_info: info,
        manifest: finalManifest,
        apply: require('./design-system.js').applyFields(finalManifest),
        regression,
        screenshots: {
          desktop: shots.desktop ? { fold: b64(shots.desktop.fold, 'image/jpeg'), full: b64(shots.desktop.full, 'image/jpeg') } : null,
          mobile: shots.mobile ? { fold: b64(shots.mobile.fold, 'image/jpeg'), full: b64(shots.mobile.full, 'image/jpeg') } : null,
        },
        wall_ms: Date.now() - t0,
      };
      if (live && live.ctx) live.ctx.closed = true;
      return out;
    }, { prefer: o.prefer });
  } catch (e) {
    const code = e && e.code;
    const renderer = code === 'blocked' ? 'blocked' : (code === 'timeout' || /took longer than/.test(String(e && e.message)) ? 'timeout' : 'unavailable');
    return { ok: false, renderer, reason: (e && e.message) || 'The browser could not read the site.', code: code || '', wall_ms: Date.now() - t0 };
  }
}

/* ═══ the router's side: rate limits, the probe, merging with the parser ═══ */

/**
 * In-memory limits for the OPEN path (no account the server can check). A
 * browser read is the most expensive thing this endpoint does, and on that
 * path anyone can ask for one. Per instance: a serverless instance is the unit
 * that pays for the CPU, and a limit that needs a database would be a limit
 * that does not exist while the database is paused - which is exactly when
 * this path is open.
 */
const RATE = { perIp: 4, global: 24, windowMs: 10 * 60 * 1000 };
const rateLog = { ip: new Map(), all: [] };
function clientIp(req) {
  const h = (req && req.headers) || {};
  const fwd = String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim();
  return fwd || (req && req.socket && req.socket.remoteAddress) || 'unknown';
}
/** null when allowed (and counted); a sentence when refused. */
function rateCheck(req, now) {
  const t = now || Date.now();
  const cut = t - RATE.windowMs;
  rateLog.all = rateLog.all.filter((x) => x > cut);
  const ip = clientIp(req);
  const mine = (rateLog.ip.get(ip) || []).filter((x) => x > cut);
  if (mine.length >= RATE.perIp) {
    return `This address has asked for ${mine.length} rendered reads in the last ${RATE.windowMs / 60000} minutes, the most this server renders for one visitor without an account it can check. The site was read from its published HTML and CSS instead; try the rendered read again in a few minutes.`;
  }
  if (rateLog.all.length >= RATE.global) {
    return `This server has rendered ${rateLog.all.length} sites for visitors without a checkable account in the last ${RATE.windowMs / 60000} minutes, its limit. The site was read from its published HTML and CSS instead; try the rendered read again in a few minutes.`;
  }
  mine.push(t); rateLog.ip.set(ip, mine); rateLog.all.push(t);
  return null;
}
function resetRateLimits() { rateLog.ip.clear(); rateLog.all = []; }

/**
 * The render probe: proves the browser launches HERE, on a FIXED page shipped
 * with the deployment (served from memory - no external fetch, so it is neither
 * an SSRF vector nor a free crawler), and is cached per instance so it cannot
 * be used to burn CPU.
 */
const PROBE_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>render probe</title>'
  + '<style>body{margin:0;background:#f4f1ea;font:16px/1.5 sans-serif;color:#1d2a24}'
  + '.c{margin:40px;padding:24px 28px;border-radius:12px;background:#1f5f4a;color:#fff;display:inline-block}'
  + 'h1{margin:0 0 6px;font-size:28px}</style></head><body><div class="c"><h1>Lifecycle OS render probe</h1>'
  + '<p>A fixed page, rendered by the deployment\'s own browser.</p></div></body></html>';
const PROBE_TTL_MS = 5 * 60 * 1000;
let probeCache = null;
async function renderProbe(opts) {
  const o = opts || {};
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS && !o.fresh) {
    return Object.assign({}, probeCache.out, { cached: true, cached_for_ms: PROBE_TTL_MS - (Date.now() - probeCache.at) });
  }
  const launcher = require('./render-browser.js');
  const t0 = Date.now();
  try {
    const out = await launcher.withBrowser(async (browser, info) => {
      const ctx = { policy: {}, deadline: Date.now() + 20000, inScope: () => false, robots: () => [], local: new Map(), closed: false };
      const url = 'https://render-probe.invalid/';
      ctx.local.set(url, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(PROBE_HTML, 'utf8') });
      const c = await browser.newContext({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
      await net.attach(c, ctx);
      const p = await c.newPage();
      const t1 = Date.now();
      await p.goto(url, { waitUntil: 'load', timeout: 15000 });
      const shot = await p.screenshot({ type: 'png' });
      const bg = await p.evaluate(() => getComputedStyle(document.querySelector('.c')).backgroundColor);
      await p.close().catch(() => {});
      return {
        ok: true, renderer: 'chromium', binary: info.source, chromium: info.version,
        single_process: info.single_process, unpack_ms: info.unpack_ms, launch_ms: info.launch_ms,
        render_ms: Date.now() - t1, total_ms: Date.now() - t0,
        screenshot_sha256: require('crypto').createHash('sha256').update(shot).digest('hex'), screenshot_bytes: shot.length,
        computed_probe: bg, network_requests: ctx.ledger ? ctx.ledger.requests : 0,
        page: 'a fixed page shipped with this deployment; nothing was fetched from the network',
      };
    }, { prefer: o.prefer });
    probeCache = { at: Date.now(), out };
    return Object.assign({}, out, { cached: false });
  } catch (e) {
    const out = { ok: false, renderer: 'unavailable', reason: (e && e.message) || 'The browser could not start.', code: (e && e.code) || '', total_ms: Date.now() - t0 };
    probeCache = { at: Date.now(), out };
    return Object.assign({}, out, { cached: false });
  }
}

/**
 * The parser's `fields` shape, built from a manifest - for a report whose
 * parser read failed, and for the DESIGN.md renderer, which reads that shape.
 * Every candidate carries confidence 'computed' and its source.
 */
function fieldsFromManifest(m, parsed) {
  const pf = (parsed && parsed.fields) || {};
  const cand = (value, source, extra) => Object.assign({ value, signal: `computed: ${(source && source.role) || ''}${source && source.selector ? ` (${source.selector})` : ''}${source && source.viewport ? ` @ ${source.viewport}` : ''}`, source_url: (source && source.page) || m.url, confidence: 'computed', source }, extra || {});
  const proposed = {}, sources = {};
  for (const [k, v] of Object.entries(m.colors || {})) {
    if (!v || !v.value) continue;
    proposed[k] = v.value;
    sources[k] = { signal: (v.signal || `computed: ${(v.source && v.source.role) || k}`), source_url: (v.source && v.source.page) || m.url, confidence: 'computed', from_role: v.from_role || (k === 'primary' ? 'identity' : k), ranked_not_declared: false };
  }
  const font = (slot) => {
    const f = (m.fonts || {})[slot];
    return f && f.family ? [cand(f.family, f.source, { stack: f.stack, google: !!f.google, weights: (f.weights || []).join(';') })] : [];
  };
  const typeRow = (slot, t, vp, role) => (t ? { slot, size: t.size != null ? `${t.size}px` : '', px: t.size, weight: String(t.weight || ''), line_height: t.line_height === 'normal' ? 'normal' : (t.line_height != null ? `${t.line_height}px` : ''), letter_spacing: t.letter_spacing != null ? `${t.letter_spacing}px` : '', color: t.color || '', confidence: 'computed', source_url: m.url, viewport: vp, role } : null);
  const rd = (m.read && m.read.desktop && m.read.desktop.roles) || {};
  const h = rd.headings || {};
  const scale = [
    typeRow('h1', (h.h1 || rd.display || {}).type, 'desktop', 'h1'), typeRow('h2', (h.h2 || {}).type, 'desktop', 'h2'), typeRow('h3', (h.h3 || {}).type, 'desktop', 'h3'),
    typeRow('body', (rd.body || {}).type, 'desktop', 'body copy'), typeRow('link', (rd.link || {}).type, 'desktop', 'link'),
    typeRow('button', (rd.button_primary || {}).type, 'desktop', 'primary button'),
  ].filter(Boolean);
  const vtok = (row, key) => (row && row[key] ? { value: row[key], confidence: 'computed', signal: `computed: ${row.role} @ ${row.viewport}`, source_url: m.url } : null);
  const slots = {};
  for (const row of scale) slots[row.slot] = { size: vtok(row, 'size'), weight: vtok(row, 'weight'), line_height: vtok(row, 'line_height'), letter_spacing: vtok(row, 'letter_spacing'), color: row.color ? { value: row.color, hex: row.color, confidence: 'computed', signal: `computed: ${row.role} colour`, source_url: m.url } : null };
  const logo = m.assets && m.assets.logo;
  const radii = [];
  const bp = rd.button_primary && rd.button_primary.style;
  if (bp && bp.radius != null) radii.push({ token: '--button-radius', value: `${bp.radius}px`, signal: 'computed: primary button corner radius', source_url: m.url });
  const card = rd.card && rd.card.style;
  if (card && card.radius != null) radii.push({ token: '--card-radius', value: `${card.radius}px`, signal: 'computed: product card corner radius', source_url: m.url });
  return Object.assign({}, pf, {
    name: pf.name || { value: (m.read && m.read.desktop && m.read.desktop.title) || null, candidates: [], marker: MARKER('brand name') },
    palette: {
      proposed, sources, conflicts: m.conflicts || [], notes: [], roles: pf.palette ? pf.palette.roles : {},
      markers: ['primary', 'ink', 'surface'].filter((k) => !proposed[k]).map((k) => MARKER(`palette.${k}`)),
      validation: (() => { try { return core().validatePalette(proposed); } catch (_) { return null; } })(),
    },
    typography: {
      heading: font('heading'), body: font('body'), mono: [], font_faces: (m.assets && m.assets.fonts) || [], google_font_links: [],
      scale, slots, tokens: { size: [], weight: [], leading: [], tracking: [] }, root_font_size: null,
      markers: [].concat(font('heading').length ? [] : [MARKER('typography.heading')], font('body').length ? [] : [MARKER('typography.body')]),
    },
    logo: logo && (logo.url || logo.inline_svg)
      ? Object.assign(cand(logo.url || '(inline SVG in the header)', logo.source), { candidates: [cand(logo.url || '(inline SVG in the header)', logo.source)], inline_svg: logo.inline_svg ? { markup: logo.inline_svg, note: 'Your logo is an inline SVG in the header. It is kept in the design system and our renderers draw it as an image.' } : null })
      : (pf.logo || { value: null, candidates: [], marker: MARKER('logo') }),
    design_tokens: { groups: { radius: radii, spacing: [], shadow: [], motion: [] }, note: 'Measured from the rendered components.', markers: [] },
  });
}

/**
 * Keep a JSON response under the platform's body limit: screenshots go first,
 * largest first, each removal said.
 */
function fitResponse(out, maxBytes) {
  const limit = maxBytes || 3800000;
  const dropped = [];
  const size = () => Buffer.byteLength(JSON.stringify(out));
  const drops = [
    ['rendered.screenshots.desktop.full', (o) => { if (o.rendered && o.rendered.screenshots && o.rendered.screenshots.desktop) o.rendered.screenshots.desktop.full = null; }],
    ['rendered.screenshots.mobile.full', (o) => { if (o.rendered && o.rendered.screenshots && o.rendered.screenshots.mobile) o.rendered.screenshots.mobile.full = null; }],
    ['rendered.regression.screenshots.mailer', (o) => { if (o.rendered && o.rendered.regression && o.rendered.regression.screenshots) o.rendered.regression.screenshots.mailer = null; }],
    ['rendered.regression.screenshots.ad', (o) => { if (o.rendered && o.rendered.regression && o.rendered.regression.screenshots) o.rendered.regression.screenshots.ad = null; }],
    ['rendered.manifest.read (raw captures)', (o) => { if (o.rendered && o.rendered.manifest) o.rendered.manifest.read = { trimmed: true }; }],
  ];
  for (const [name, fn] of drops) {
    if (size() <= limit) break;
    fn(out); dropped.push(name);
  }
  if (dropped.length && out.rendered) out.rendered.trimmed = { dropped, note: 'Removed to keep the response under the platform\'s size limit; the values above are complete.' };
  return out;
}

/**
 * `op=extract`, rendered first. The parser (brand-extract.js) still runs, in
 * parallel: it reads what the browser does not (name, tagline, claims, legal
 * entity, regions, storefront, sitemap, voice), and it is the labelled
 * FALLBACK when the browser cannot read the site. A parser read is never
 * presented as a rendered one: `read.method` says which, and
 * `read.renderer` is 'chromium' or why not ('unavailable' | 'blocked' |
 * 'timeout').
 */
/**
 * The brand a read is SCORED as: the record as it stands (the workspace on
 * the server path, the wizard's draft on the device/open path) with WHO set
 * each field, so the regression renders the brand exactly as the read will be
 * applied to it - a person's own logo, colour or type kept (review,
 * 2026-10-04). Bounded like brand-runtime.carriedBrand: short strings, hex
 * colours, two font records, an origin map over known fields; nothing nested
 * passes through.
 */
const SCORING_FIELDS = new Set(['name', 'tagline', 'website', 'logo_url', 'favicon_url',
  'palette.primary', 'palette.accent', 'palette.ink', 'palette.surface', 'palette.surface_alt', 'palette.muted',
  'typography.heading', 'typography.body', 'brand_data.design_system', 'brand_data.imagery', 'brand_data.social',
  'brand_data.legal_entity', 'regions', 'voice.tone']);
const SCORING_ORIGINS = new Set(['user', 'document', 'site-render', 'site-parse', 'preset', 'default']);
function scoringBrand(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const url = (v) => (/^https?:\/\//i.test(s(v, 600)) ? s(v, 600) : '');
  const hex = (v) => (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s(v, 9)) ? s(v, 9) : '');
  const palette = {};
  for (const k of ['primary', 'accent', 'ink', 'surface', 'surface_alt', 'muted']) { const h = hex(src.palette && src.palette[k]); if (h) palette[k] = h; }
  const typography = {};
  for (const k of ['heading', 'body']) {
    const f = src.typography && src.typography[k];
    if (f && typeof f === 'object' && s(f.family, 80)) {
      typography[k] = { family: s(f.family, 80), stack: s(f.stack, 240), google: f.google === true };
      // A font FILE the operator supplied (https only), so the score sees it.
      if (/^https:\/\/[^\s"'()<>\\]+$/i.test(s(f.src, 600))) Object.assign(typography[k], { src: s(f.src, 600), format: s(f.format, 12) });
    }
  }
  const raw = (src.field_origin && typeof src.field_origin === 'object' && src.field_origin)
    || (src.brand_data && typeof src.brand_data === 'object' && src.brand_data.field_origin && typeof src.brand_data.field_origin === 'object' && src.brand_data.field_origin) || {};
  const fieldOrigin = {};
  for (const k of Object.keys(raw).slice(0, 80)) if (SCORING_FIELDS.has(k) && SCORING_ORIGINS.has(raw[k])) fieldOrigin[k] = raw[k];
  return {
    name: s(src.name, 120), tagline: s(src.tagline, 300), website: url(src.website),
    logo_url: url(src.logo_url), favicon_url: url(src.favicon_url), palette, typography,
    brand_data: { field_origin: fieldOrigin },
  };
}

async function extractWithRender(auth, args, opts) {
  const o = opts || {};
  const bx = require('./brand-extract.js');
  const t0 = Date.now();
  let refusal = null;
  if (o.open && o.req) refusal = rateCheck(o.req);
  const parserP = bx.runExtract(auth, args).then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
  const renderP = refusal || o.render === false
    ? Promise.resolve({ ok: false, renderer: 'unavailable', reason: refusal || 'The rendered read was not requested.' })
    : (async () => {
      // The URL goes through the SAME guard first, so an internal address
      // never reaches the browser launcher.
      let url;
      try { url = await core().assertPublicUrl(/^https?:\/\//i.test(String(args.url || '')) ? args.url : `https://${args.url}`); }
      catch (e) { return { ok: false, renderer: 'unavailable', reason: e.message }; }
      return (o.readSite || readSite)(url, { deadlineMs: o.deadlineMs || 100000, brand: o.brand || null });
    })();
  const [p, r] = await Promise.all([parserP, renderP]);
  if (!p.ok && !(r && r.ok)) throw p.e;
  const parsed = p.ok ? p.r : null;
  const rendered = r && r.ok ? r : null;
  const base = parsed && parsed.ok !== false ? parsed : { ok: true, start: rendered ? rendered.manifest.url : args.url, pages: [], pages_visited: 0, stylesheets: [], limits: [], notes: [], markers: [], fields: {}, coverage_note: '' };
  const out = Object.assign({}, base);
  out.read = rendered
    ? { method: 'rendered', renderer: 'chromium', chromium: rendered.renderer_info && rendered.renderer_info.version, binary: rendered.renderer_info && rendered.renderer_info.source, wall_ms: rendered.wall_ms, parser: parsed ? 'ran alongside, for the fields a browser does not read' : 'failed; every visual field below is the browser\'s' }
    : { method: 'parsed', renderer: (r && r.renderer) || 'unavailable', reason: (r && r.reason) || 'The browser could not read the site.', note: 'Everything below was read from the site\'s published HTML and CSS, NOT rendered. Colours a script applies, a utility-first type scale and fonts a page loads but does not use are not visible to this method.' };
  if (rendered) {
    out.fields = fieldsFromManifest(rendered.manifest, parsed);
    out.limits = (out.limits || []).filter((l) => !/^No browser:/.test(l)).concat([
      'Rendered in a headless Chromium at 1440px and 390px. A page behind a login, a region gate or a consent wall is read as it renders for a first-time visitor in the browser\'s region.',
    ]);
    out.rendered = {
      manifest: rendered.manifest, apply: rendered.apply, regression: rendered.regression,
      screenshots: rendered.screenshots, renderer_info: rendered.renderer_info,
    };
    // The same read as a DESIGN.md, through the context pack's own renderer
    // (google-labs-code/design.md): tokens from the computed values, the
    // measured components documented with their provenance.
    try {
      const nm = (out.fields.name && out.fields.name.value) || '';
      const doc = require('./brand-context-pack.js').renderDesignMd(out, { name: nm || undefined, website: out.start }, { observed_at: rendered.manifest.read_at });
      out.design_md = doc.markdown;
    } catch (e) { out.design_md_error = (e && e.message) || 'DESIGN.md could not be rendered'; }
    out.parsed_fields = parsed && parsed.fields ? { palette: parsed.fields.palette && parsed.fields.palette.proposed, heading: (parsed.fields.typography && parsed.fields.typography.heading || []).slice(0, 1), body: (parsed.fields.typography && parsed.fields.typography.body || []).slice(0, 1), scale_rows: (parsed.fields.typography && parsed.fields.typography.scale || []).length } : null;
  }
  out.wall_ms = Date.now() - t0;
  return fitResponse(out);
}

module.exports = {
  readRendered, readSite, buildManifest, identityCandidates, fontFacesFrom, cssNamesFrom, drawnFaces, scoringBrand,
  extractWithRender, renderProbe, fieldsFromManifest, fitResponse, rateCheck, resetRateLimits, clientIp, RATE, PROBE_HTML,
  VIEWPORTS, DEFAULTS, MARKER,
};
