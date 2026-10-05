/**
 * "Read my site" RENDERS the site - executed against fixture sites.
 * ---------------------------------------------------------------------------
 * The operator's words, with a screenshot of /onboarding: "read my site should
 * actually be fetching the exact styling and branding of the website entered
 * and apply that complete accurately". The stylesheet parser (brand-extract.js)
 * could not: a utility-first site has no `h1{}` rule to read, a theme whose
 * colours a script sets at runtime publishes only `var(--…)`, a family a page
 * LOADS is not one it USES, a CTA styled through `:not()` is invisible to
 * selector matching, an inline-SVG logo has no URL.
 *
 * Every test here starts a real HTTP server on 127.0.0.1 with a fixture site,
 * reads it through the SHIPPED reader (brand-render.readSite: a fresh Chromium,
 * route interception, the SSRF policy, the pinned transport), and asserts the
 * EXACT values the browser computes. The parser is run over the same bytes
 * beside it, so each test also states what the parser read ("before").
 *
 * The one test seam: `policy.allowOrigins`, a Set of EXACT origins (the
 * fixture server's) that the in-process caller may allow. No request field
 * reaches it, and every other address - including other ports on 127.0.0.1 -
 * is still refused (the SSRF test proves it with a canary).
 *
 * Run: npx playwright test tests/rendered-brand-read.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
delete process.env.BRAND_RENDER;

const sites = require('./lib/rendered-sites.js');
const RENDER = require.resolve('../api/_shared/brand-render.js');
const NET = require.resolve('../api/_shared/render-net.js');

test.describe.configure({ mode: 'serial' });
test.setTimeout(150000);
test.beforeAll(() => { delete process.env.BRAND_RENDER; });

async function read(name, opts) {
  const srv = await sites.serve(sites.siteRoutes(name));
  try {
    const br = require(RENDER);
    const out = await br.readSite(srv.origin + '/', Object.assign({ policy: { allowOrigins: new Set([srv.origin]) }, deadlineMs: 110000 }, opts || {}));
    return { out, srv };
  } finally { await srv.close(); }
}

/** The parser over the same bytes: what "Read my site" returned before. */
async function parse(name) {
  const routes = sites.siteRoutes(name);
  const origin = 'http://parser.example';
  const bx = require('../api/_shared/brand-extract.js');
  const fetchImpl = async (u) => {
    const p = new URL(u).pathname;
    const r = routes[p];
    if (!r) return { ok: false, status: 404, body: '', url: u };
    const body = Buffer.isBuffer(r.body) ? r.body.toString('latin1') : r.body;
    return { ok: (r.status || 200) < 300, status: r.status || 200, body, url: u, contentType: r.type };
  };
  return bx.extractBrand(origin + '/', { brand: { website: origin + '/' }, fetchImpl, voice: false, maxPages: 4 });
}

const role = (out, k) => out.manifest.read.desktop.roles[k];

test('(a) utility-first: the display heading, the CTA and the card are read as RENDERED, with no h1{} rule anywhere', async () => {
  const { out } = await read('a');
  expect(out.ok).toBe(true);
  expect(out.renderer).toBe('chromium');
  const d = role(out, 'display');
  // `text-4xl font-bold tracking-tight` on a <div>: 2.25rem / 2.5rem / 700 / -0.025em.
  expect(d.type).toMatchObject({ size: 36, weight: 700, line_height: 40, letter_spacing: -0.9, color: '#14281d' });
  const b = role(out, 'button_primary');
  expect(b.label).toBe('Shop the range');
  expect(b.style).toMatchObject({ background: '#0f5132', radius: 8, padding: [12, 24, 12, 24] });
  expect(b.type).toMatchObject({ size: 16, weight: 600, color: '#ffffff' });
  const c = role(out, 'card');
  expect(c.style).toMatchObject({ background: '#ffffff', radius: 12, padding: [16, 16, 16, 16] });
  expect(c.style.shadow).toContain('rgba(0, 0, 0, 0.1)');
  expect(c.image).toMatchObject({ aspect: 0.8, fit: 'cover', radius: 8 });
  expect(c.price.text).toBe('$48.00');
  expect(c.title.type).toMatchObject({ size: 18, weight: 600, color: '#14281d' });
  expect(out.manifest.read.mobile.roles.display.type.size).toBe(36);
  // Every value carries where it was read. The site's MARK paints its green
  // (the logo is the strongest identity signal, 2026-10-05), and its call to
  // action renders the same green.
  expect(out.manifest.colors.primary.source).toMatchObject({ role: 'logo', viewport: 'desktop', signal: 'computed', property: 'pixels' });
  expect(out.manifest.colors.primary.kind).toBe('logo-image');
  expect(out.manifest.colors.primary.value).toBe('#0f5132');
  expect(role(out, 'button_primary').selector).toContain('a.mt-8.inline-block');
  // BEFORE: the parser publishes no heading scale for this site at all.
  const p = await parse('a');
  const h1Row = (p.fields.typography.scale || []).find((r) => r.slot === 'h1');
  expect(h1Row && h1Row.px).not.toBe(36);
});

test('(b) a theme whose colours a script sets at runtime: the computed custom property is the identity, the CTA the action, and the two are a conflict', async () => {
  const { out } = await read('b');
  const m = out.manifest;
  expect(m.colors.primary.value).toBe('#1a4d8f');
  expect(m.colors.primary.from_role).toBe('identity');
  expect(m.colors.primary.signal).toContain('--color-brand as computed on :root (set at runtime by script)');
  expect(m.colors.accent.value).toBe('#b8531f');
  expect(m.conflicts[0]).toMatchObject({ kind: 'brand_colour_vs_action_colour', identity: { value: '#1a4d8f' }, action: { value: '#b8531f' } });
  expect(role(out, 'button_primary').style).toMatchObject({ background: '#b8531f', radius: 999, padding: [14, 28, 14, 28] });
  // BEFORE: the stylesheet only says var(--color-button); the parser cannot see #b8531f.
  const p = await parse('b');
  expect(JSON.stringify(p.fields.palette.proposed)).not.toContain('#b8531f');
  expect(p.fields.palette.proposed.primary || '').not.toBe('#1a4d8f');
});

test('(c) two families loaded, one used: the heading is the family that RENDERS, with its font file', async () => {
  const { out } = await read('c');
  const f = out.manifest.fonts.heading;
  expect(f.family).toBe('Fixture Display');
  expect(f.kind).toBe('webfont');
  expect(f.stack).toBe("'Fixture Display','Georgia',serif");
  expect(f.files.map((x) => new URL(x.url).pathname)).toEqual(['/fonts/display.ttf']);
  // The loaded-but-unused family is in the FontFaceSet and nowhere in the manifest's typography.
  const faces = out.manifest.read.desktop.fonts.faces;
  expect(faces.some((x) => x.family === 'Fixture Unused' && x.status === 'loaded')).toBe(true);
  expect(JSON.stringify(out.manifest.fonts)).not.toContain('Fixture Unused');
  expect(out.manifest.fonts.body.family).toBe('Georgia');
});

test('(d) a CTA styled only through `.actions > a:not(.ghost)`: fill, case, tracking, and its :hover', async () => {
  const { out } = await read('d');
  const b = role(out, 'button_primary');
  expect(b.style).toMatchObject({ background: '#6a1b9a', radius: 6, padding: [13, 30, 13, 30] });
  expect(b.type).toMatchObject({ transform: 'uppercase', letter_spacing: 1.5, size: 14, weight: 700, color: '#ffffff' });
  expect(out.manifest.states.button_primary.hover.background).toBe('#4a148c');
  const s = role(out, 'button_secondary');
  expect(s.outlined).toBe(true);
  expect(s.style).toMatchObject({ border_width: 1, border_color: '#6a1b9a' });
  // The landing page we generate consumes the hover state.
  const ds = out.apply['brand_data.design_system'].value;
  expect(ds.components.button.primary.hover.background).toBe('#4a148c');
});

test('(e) an inline-SVG logo is the logo, its markup kept, its fill the identity colour', async () => {
  const { out } = await read('e');
  const lg = out.manifest.assets.logo;
  expect(lg.kind).toBe('svg');
  expect(lg.inline_svg).toContain('<circle');
  expect(lg.rendered).toMatchObject({ w: 140, h: 36 });
  // The mark's paint by AREA (2026-10-05), not the first shape's fill.
  expect(out.manifest.colors.primary).toMatchObject({ value: '#c2185b', from_role: 'identity', kind: 'logo-svg', signal: expect.stringMatching(/^logo mark paint as rendered/) });
  // Our landing page draws it as an IMAGE (a data: URL), never as markup.
  expect(out.regression.ok).toBe(true);
  const lp = require('../api/_shared/render-regression.js');
  const brand = lp.brandFor(out.manifest, null);
  const rendered = lp.renderOurs(brand, lp.sampleFrom(out.manifest)).lp;
  expect(rendered).toContain('src="data:image/svg+xml;base64,');
  expect(rendered).not.toContain('<circle');
});

test('(f) a dark-neutral hero band: reported with its exact value, never painted as a section by our landing page', async () => {
  const { out } = await read('f');
  const hr = out.manifest.hard_rules.find((h) => h.kind === 'dark-section');
  expect(hr).toMatchObject({ value: '#121212', component: 'hero' });
  expect(out.regression.hard_rules.swapped[0]).toMatchObject({ component: 'hero', site: '#121212' });
  const ours = out.regression.hard_rules.swapped[0].ours;
  const core = require('../api/_shared/brand-workspace-core.js');
  expect(core.isDarkNeutral(ours)).toBe(false);
  // The site's light heading cannot sit on the ground we must use: DERIVED, exempt, both ratios shown.
  const derived = out.regression.hard_rules.derived.find((d) => d.token === 'hero.heading.color');
  expect(derived.site).toBe('#f5f5f5');
  expect(derived.ratio_ours).toBeGreaterThanOrEqual(3);
  const row = out.regression.tokens.find((t) => t.surface === 'landing page' && t.viewport === 'desktop' && t.token === 'colour' && t.component === 'hero heading');
  expect(row.status).toBe('exempt');
  expect(row.reason).toContain('WCAG AA');
});

test('(g) a bot wall and a soft challenge page are labelled `blocked`, and the extract falls back to the parser SAYING so', async () => {
  const hard = await read('g403');
  expect(hard.out).toMatchObject({ ok: false, renderer: 'blocked' });
  expect(hard.out.reason).toContain('HTTP 403');
  const soft = await read('gsoft');
  expect(soft.out).toMatchObject({ ok: false, renderer: 'blocked' });
  // The router's merge: the rendered read failed, so the report is the
  // parser's, labelled. The parser cannot reach a host here, so it answers
  // from a stand-in; the LABEL is what is under test.
  const br = require(RENDER);
  const bx = require('../api/_shared/brand-extract.js');
  const real = bx.runExtract;
  const dns = require('dns').promises;
  const realLookup = dns.lookup;
  dns.lookup = async (h, o) => (String(h).endsWith('.example') ? [{ address: '93.184.216.34', family: 4 }] : realLookup(h, o));
  bx.runExtract = async () => ({ ok: true, start: 'https://walled.example/', pages: [], pages_visited: 1, stylesheets: [], limits: [], notes: [], markers: [], fields: { palette: { proposed: {} } } });
  try {
    const out = await br.extractWithRender({ ok: false }, { url: 'https://walled.example/', voice: false }, { readSite: async () => hard.out });
    expect(out.read).toMatchObject({ method: 'parsed', renderer: 'blocked' });
    expect(out.read.reason).toContain('HTTP 403');
    expect(out.read.note).toContain('NOT rendered');
    expect(out.rendered).toBeUndefined();
  } finally { bx.runExtract = real; dns.lookup = realLookup; }
});

test('the regression loop catches a WRONG token, repairs it by re-measuring the site, and converges', async () => {
  // The seed is the parser's answer for this site's CTA: the parser cannot see
  // a utility class's colour on the button, and ranks the commonest colour.
  const seedColour = '#e9f1ec';
  const { out } = await read('a', { seed: { 'desktop.button_primary.style.background': seedColour } });
  const g = out.regression;
  expect(g.seeded).toEqual([{ path: 'desktop.button_primary.style.background', value: seedColour }]);
  expect(g.iterations[0].tokens_off).toBeGreaterThan(0);
  expect(g.iterations[0].mismatch).toBeGreaterThan(require('../api/_shared/render-regression.js').MISMATCH_LIMIT);
  const fix = g.repairs.find((r) => r.component === 'primary button' && r.token === 'background' && r.viewport === 'desktop');
  expect(fix).toMatchObject({ from: seedColour, to: '#0f5132', strategy: 'computed' });
  expect(g.done).toBe(true);
  expect(g.iterations[g.iterations.length - 1].mismatch).toBeLessThanOrEqual(require('../api/_shared/render-regression.js').MISMATCH_LIMIT);
  // The repaired value is what the operator is offered.
  expect(out.apply['brand_data.design_system'].value.components.button.primary.desktop.background).toBe('#0f5132');
});

test('a token our renderer does not reproduce is reported UNMATCHED with its measured value - never invented', async () => {
  // Fixture h: the CTA turns teal at phone width. Our landing page carries the
  // button's SHAPE at phone width and its desktop fill - a real gap, said.
  const routes = sites.siteRoutes('d');
  routes['/d.css'] = Object.assign({}, routes['/d.css'], { body: routes['/d.css'].body + '@media (max-width:640px){.hero .actions > a:not(.ghost){background:#00796b}}' });
  const srv = await sites.serve(routes);
  let out;
  try {
    out = await require(RENDER).readSite(srv.origin + '/', { policy: { allowOrigins: new Set([srv.origin]) }, deadlineMs: 110000 });
  } finally { await srv.close(); }
  expect(out.manifest.read.mobile.roles.button_primary.style.background).toBe('#00796b');
  const u = out.regression.unmatched.find((x) => x.surface === 'landing page' && x.viewport === 'mobile' && x.component === 'primary button' && x.token === 'background');
  expect(u).toBeTruthy();
  expect(u.best_site_value).toBe('#00796b');
  expect(u.ours).toBe('#6a1b9a');
  expect(u.reason).toContain('confirms #00796b');
  expect(out.regression.done).toBe(false);
  // Nothing was nudged: the manifest still says what the site renders.
  expect(out.manifest.read.mobile.roles.button_primary.style.background).toBe('#00796b');
});

test('every surface is scored per component with the limits stated, and the pixel regions are real', async () => {
  const { out } = await read('b');
  const g = out.regression;
  expect(g.limits).toMatchObject({ pixel_limit: 0.03, mismatch_limit: 0.05 });
  expect(Object.keys(g.surfaces)).toEqual(['landing page', 'mailer', 'ad creative']);
  expect(g.surfaces['landing page'].tokens_compared).toBeGreaterThan(40);
  expect(g.surfaces.mailer.tokens_compared).toBeGreaterThan(10);
  expect(g.surfaces['ad creative'].tokens_compared).toBeGreaterThan(4);
  const btn = g.regions.find((r) => r.component === 'primary button (desktop)');
  expect(btn.comparable).toBe(true);
  expect(btn.site_size).toEqual(btn.ours_size);
  expect(btn.ratio).toBeLessThanOrEqual(0.03);
  expect(g.screenshots.landing_desktop.length).toBeGreaterThan(1000);
  expect(g.done).toBe(true);
  // The mailer is compared at the site's PHONE values, never by pixels.
  expect(g.tokens.filter((t) => t.surface === 'mailer').every((t) => t.viewport === 'email (phone values)')).toBe(true);
  expect(g.regions.every((r) => !/mailer/.test(r.component))).toBe(true);
});

test('a rendered extract carries its DESIGN.md, through the context pack\'s own renderer, with the measured components', async () => {
  const srv = await sites.serve(sites.siteRoutes('b'));
  const br = require(RENDER);
  const bx = require('../api/_shared/brand-extract.js');
  const core = require('../api/_shared/brand-workspace-core.js');
  const realRun = bx.runExtract, realGuard = core.assertPublicUrl;
  bx.runExtract = async () => ({ ok: true, start: srv.origin + '/', pages: [srv.origin + '/'], pages_visited: 1, stylesheets: [], limits: [], notes: [], markers: [], fields: { name: { value: 'Harbourlight', candidates: [] } } });
  // The fixture lives on 127.0.0.1: the router's URL guard is answered for THIS origin only.
  core.assertPublicUrl = async (u) => { if (!String(u).startsWith(srv.origin)) throw new Error('outside the fixture'); return String(u).replace(/\/$/, ''); };
  let out;
  try {
    out = await br.extractWithRender({ ok: true }, { url: srv.origin + '/' }, {
      readSite: (u, o) => br.readSite(u + '/', Object.assign({}, o, { policy: { allowOrigins: new Set([srv.origin]) } })),
    });
  } finally { bx.runExtract = realRun; core.assertPublicUrl = realGuard; await srv.close(); }
  expect(out.read).toMatchObject({ method: 'rendered', renderer: 'chromium' });
  expect(out.fields.palette.proposed).toMatchObject({ primary: '#1a4d8f', accent: '#b8531f', surface: '#ffffff', ink: '#1d1d1f' });
  const doc = out.design_md;
  expect(doc).toContain('This was RENDERED');
  expect(doc).toMatch(/primary: "#1a4d8f"\s+# identity signal — --color-brand as computed on :root/);
  expect(doc).toContain('| primary button | desktop | background | #b8531f |');
  expect(doc).toContain('| primary button | desktop | radius | 999px |');
  expect(doc).not.toContain('It is **not** a browser');
  expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(3800000);
});

/* ── REVIEW FINDINGS ON #128 (2026-10-04), each executed ─────────────────── */

/** Width and height from a JPEG's SOF marker. */
function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

test('a successful read keeps BOTH full-page screenshots, each the height of the page (to the cap), not the fold', async () => {
  // Review: `fullPage:true` together with `clip` was said to be refused and
  // the full shot silently null. Measured: Playwright 1.63 trims the clip to
  // the full-page rect, so the pair is valid - and this pins it, because the
  // shot is the visual reference the wizard and the harvest both show.
  const { out } = await read('a');
  for (const [vp, w, h] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const full = out.screenshots[vp] && out.screenshots[vp].full;
    expect(full, `${vp}: no full-page screenshot`).toBeTruthy();
    const size = jpegSize(Buffer.from(full.data, 'base64'));
    const pageH = Math.round(out.manifest.read[vp].page_height);
    expect(pageH, `${vp}: the fixture must be taller than the viewport for this to mean anything`).toBeGreaterThan(h);
    expect(size.w).toBe(w);
    expect(Math.abs(size.h - Math.min(pageH, 5200))).toBeLessThanOrEqual(1);
    const fold = jpegSize(Buffer.from(out.screenshots[vp].fold.data, 'base64'));
    expect(fold.h).toBe(h);
  }
});

test('a Google family is LOADED by every surface we generate, and the regression compares the face each one DREW', async () => {
  // Review: the motion ad named the brand's Google family and never loaded it,
  // and the regression compared the DECLARED stack, so the ad drew its
  // fallback and scored as a match. Now the face the engine drew is read off
  // each surface (CDP platform fonts) and compared to the face the site drew.
  const srv = await sites.serve(sites.siteRoutes('h'));
  let out;
  try {
    const net = require(NET);
    out = await require(RENDER).readSite(srv.origin + '/', {
      policy: { allowOrigins: new Set([srv.origin].concat(sites.GOOGLE_ORIGINS)) }, deadlineMs: 110000,
      transport: sites.googleFontsTransport(net.transport),
    });
  } finally { await srv.close(); }
  expect(out.ok).toBe(true);
  expect(out.manifest.fonts.heading).toMatchObject({ family: 'Erica One', google: true });
  const drawn = out.manifest.read.desktop.drawn;
  expect((drawn.display || drawn.h1).family).toBe('Erica One');
  expect(drawn['button-primary'].family).toBe('Erica One');
  const g = out.regression;
  const faces = g.tokens.filter((t) => t.token === 'drawn face');
  const on = (surface, comp) => faces.find((t) => t.surface === surface && comp.test(t.component));
  const lp = on('landing page', /hero heading/);
  const ad = on('ad creative', /headline/);
  const mails = ['editorial', 'visual', 'pure', 'founder'].map((st) => on('mailer', new RegExp(`^${st}: heading`)));
  // The call to action draws the button's own face on every surface that has one.
  const ctas = [['landing page button', on('landing page', /primary button/)], ['ad call to action', on('ad creative', /call to action/)]]
    .concat(['editorial', 'visual', 'founder'].map((st) => [`mailer ${st} button`, on('mailer', new RegExp(`^${st}: button`))]));
  for (const [what, row] of [['landing page', lp], ['ad', ad]].concat(mails.map((r, i) => [`mailer ${['editorial', 'visual', 'pure', 'founder'][i]}`, r]), ctas)) {
    expect(row, `${what}: no drawn-face comparison`).toBeTruthy();
    expect(row.site).toBe('Erica One');
    expect(row.ours, `${what} drew ${row.ours}, not the family it names`).toBe('Erica One');
    expect(row.status).toBe('match');
  }
});

test('the comparison FAILS a surface that names the family but draws a fallback', async () => {
  const rr = require('../api/_shared/render-regression.js');
  const site = { roles: { headings: { h1: { type: { size: 56 } } } }, drawn: { h1: { family: 'Erica One', custom: true } } };
  const ours = { __drawn: { headline: { family: 'DejaVu Sans', custom: false }, h1: { family: 'DejaVu Sans', custom: false } } };
  const rows = rr.judge(rr.adPairs(site, ours));
  const row = rows.find((r) => r.token === 'drawn face');
  expect(row).toBeTruthy();
  expect(row).toMatchObject({ site: 'Erica One', ours: 'DejaVu Sans', status: 'mismatch' });
});

test('all FOUR mailer styles read the design system, and the regression scores each one', async () => {
  // Review: only the default (editorial) style read the measured tokens; the
  // visual, pure and founder styles kept a hard-coded type, and the regression
  // rendered one style, so three of four mailers were never measured.
  const { out } = await read('c');
  const g = out.regression;
  const mail = g.tokens.filter((t) => t.surface === 'mailer');
  for (const style of ['editorial', 'visual', 'pure', 'founder']) {
    const rows = mail.filter((t) => t.component.startsWith(`${style}: `));
    expect(rows.length, `${style}: not scored`).toBeGreaterThan(4);
    const size = rows.find((t) => t.component === `${style}: heading` && t.token === 'font size');
    expect(size, `${style}: no heading size compared`).toBeTruthy();
    expect(size.status).toBe('match');
    expect(rows.filter((t) => t.status === 'mismatch'), `${style}: ${JSON.stringify(rows.filter((t) => t.status === 'mismatch'))}`).toEqual([]);
  }
});

test('the read is SCORED as it will be APPLIED: the brand as it stands, with a person\'s own values kept', async () => {
  // Review: the extract never passed the brand into the regression, so it
  // scored a fresh preview brand - a person's own logo or colour, which the
  // wizard keeps, was scored as replaced. The draft the request carries (and
  // on the server path the workspace) is applied under the same rule now.
  const srv = await sites.serve(sites.siteRoutes('a'));
  const br = require(RENDER);
  const bx = require('../api/_shared/brand-extract.js');
  const core = require('../api/_shared/brand-workspace-core.js');
  const realRun = bx.runExtract, realGuard = core.assertPublicUrl;
  bx.runExtract = async () => ({ ok: true, start: srv.origin + '/', pages: [srv.origin + '/'], pages_visited: 1, stylesheets: [], limits: [], notes: [], markers: [], fields: { name: { value: 'Verdant Supply', candidates: [] } } });
  core.assertPublicUrl = async (u) => { if (!String(u).startsWith(srv.origin)) throw new Error('outside the fixture'); return String(u).replace(/\/$/, ''); };
  const draft = br.scoringBrand({
    name: 'My Plant Shop', logo_url: srv.origin + '/icon.svg',
    palette: { primary: '#AA3300', surface: '#FFFFFF' },
    // logo typed by the person; the palette was saved before origins existed.
    field_origin: { logo_url: 'user', 'palette.surface': 'default', 'not.a.field': 'user', name: 'nonsense-origin' },
    brand_data: { design_system: { huge: 'x'.repeat(5000) } },
  });
  let out;
  try {
    out = await br.extractWithRender({ ok: true }, { url: srv.origin + '/' }, {
      brand: draft,
      readSite: (u, o) => br.readSite(u + '/', Object.assign({}, o, { policy: { allowOrigins: new Set([srv.origin]) } })),
    });
  } finally { bx.runExtract = realRun; core.assertPublicUrl = realGuard; await srv.close(); }
  // The carried record is bounded: unknown fields and origins never pass.
  expect(draft.brand_data).toEqual({ field_origin: { logo_url: 'user', 'palette.surface': 'default' } });
  const g = out.rendered.regression;
  expect(g.applied_as.scored_with_caller_brand).toBe(true);
  const kept = Object.fromEntries(g.applied_as.kept.map((k) => [k.field, k.origin]));
  expect(kept).toMatchObject({ logo_url: 'user', 'palette.primary': 'unrecorded' });
  // A placeholder ('default') is replaced; what the brand lacked is filled.
  expect(kept['palette.surface']).toBeUndefined();
  expect(g.applied_as.applied).toEqual(expect.arrayContaining(['palette.surface', 'brand_data.design_system']));
  // A row the kept value explains is said to be, and is not "repaired".
  for (const t of g.tokens.filter((x) => x.kept_field)) expect(t.reason).toMatch(/^you kept /);
  expect(g.repairs.filter((r) => /logo|wordmark/.test(r.token))).toEqual([]);
});

test('the server path scores the WORKSPACE as it stands; a device or anonymous caller scores the draft it carries', async () => {
  const core = require('../api/_shared/brand-workspace-core.js');
  const real = core.getWorkspace;
  const asked = [];
  core.getWorkspace = async (auth, id) => { asked.push(id); return { id, name: 'On The Server', logo_url: 'https://cdn.example/server-logo.png', palette: { primary: '#123456' }, brand_data: { field_origin: { logo_url: 'user' } } }; };
  try {
    const body = { workspace_id: 'ws-1', brand: { name: 'Carried Draft', palette: { primary: '#654321' }, field_origin: { 'palette.primary': 'user' } } };
    const server = await core.scoringBrandFor({ ok: true, token: 'jwt', mode: 'supabase' }, body, {});
    expect(server).toMatchObject({ name: 'On The Server', logo_url: 'https://cdn.example/server-logo.png', palette: { primary: '#123456' }, brand_data: { field_origin: { logo_url: 'user' } } });
    expect(asked).toEqual(['ws-1']);
    // A device principal has no server workspace; a device id is never looked up.
    const device = await core.scoringBrandFor({ ok: true, token: 'dev', mode: 'device' }, body, {});
    expect(device).toMatchObject({ name: 'Carried Draft', palette: { primary: '#654321' }, brand_data: { field_origin: { 'palette.primary': 'user' } } });
    const local = await core.scoringBrandFor({ ok: true, token: 'jwt', mode: 'supabase' }, Object.assign({}, body, { workspace_id: 'local-abc' }), {});
    expect(local.name).toBe('Carried Draft');
    expect(asked).toEqual(['ws-1']);
    // Nothing carried, nothing scored as a brand: the preview brand stands in.
    expect(await core.scoringBrandFor({ ok: false }, {}, {})).toBeNull();
    // A logo that is not http(s) is not a logo.
    expect((await core.scoringBrandFor({ ok: false }, { brand: { name: 'x', logo_url: 'javascript:alert(1)' } }, {})).logo_url).toBe('');
  } finally { core.getWorkspace = real; }
});

/* ── THE ADOPTED REFERENCE ITEMS (2026-10-04), each executed ─────────────── */

test('A + B: a page IN MOTION is measured frozen - the declared colour, the pinned clock on BOTH sides - and its live pixels are masked out', async () => {
  const { out } = await read('i');
  expect(out.ok).toBe(true);
  // A: the CTA runs an infinite colour animation; frozen, it reads as declared.
  expect(role(out, 'button_primary').style.background).toBe('#245c3a');
  // The SAME frozen clock on the site and on our clone.
  const g = out.regression;
  expect(out.manifest.read.desktop.stabilised.clock).toMatch(/^2026-01-01T00:00:00/);
  expect(g.stabilised.source.clock).toMatch(/^2026-01-01T00:00:00/);
  expect(g.stabilised.ours.clock).toMatch(/^2026-01-01T00:00:00/);
  // B: the badge inside the CTA changes colour every 50 ms (live content).
  // It is masked out of the perceptual comparison, on the site's side.
  const btn = g.regions.find((r) => r.component === 'primary button (desktop)');
  expect(btn.comparable).toBe(true);
  expect(btn.masked.volatile, 'no live pixels were found').toBeGreaterThan(200);
  expect(btn.ratio, `perceptual ${btn.ratio} (raw ${btn.raw_ratio})`).toBeLessThanOrEqual(0.03);
});

test('C: STRUCTURAL and PERCEPTUAL are separate scores with stated limits, and approval needs BOTH', async () => {
  const rr = require('../api/_shared/render-regression.js');
  expect(rr.STRUCTURAL_LIMIT).toBe(0.95);
  expect(rr.PERCEPTUAL_LIMIT).toBe(0.97);
  const rows = Array.from({ length: 40 }, (_, i) => ({ status: i < 1 ? 'mismatch' : 'match' }));
  const clean = [{ comparable: true, ratio: 0.004, component: 'primary button (desktop)' }];
  const shapeOff = [{ comparable: true, ratio: 0.08, component: 'primary button (desktop)' }];
  const a = rr.scoreOf(rows, clean);
  expect(a.structural).toMatchObject({ score: 97.5, limit: 95, pass: true });
  expect(a.perceptual).toMatchObject({ score: 99.6, limit: 97, pass: true });
  expect(a.approved).toBe(true);
  // Every token in tolerance, a shape our button does not have: NOT approved.
  const b = rr.scoreOf(rows.map(() => ({ status: 'match' })), shapeOff);
  expect(b.structural.pass).toBe(true);
  expect(b.perceptual).toMatchObject({ pass: false, worst_region: 'primary button (desktop)' });
  expect(b.approved).toBe(false);
  // Pixels clean, three tokens in forty off: NOT approved either.
  const c = rr.scoreOf(rows.map((r, i) => ({ status: i < 3 ? 'mismatch' : 'match' })), clean);
  expect(c.structural.pass).toBe(false);
  expect(c.approved).toBe(false);
});

test('D: a repair is KEPT only if the composite strictly improves; one that does not is put back and logged', async () => {
  // The site changes AFTER it was measured (its CTA turns #d4e157). A wrong
  // manifest value sends the button to be re-measured; the re-measured value
  // is the changed page's, it does not bring our output closer to the site as
  // measured, so it is reverted - never kept to chase a number.
  const srv = await sites.serve(sites.siteRoutes('a'));
  const br = require(RENDER);
  const rr = require('../api/_shared/render-regression.js');
  let g, final;
  try {
    await require('../api/_shared/render-browser.js').withBrowser(async (browser) => {
      const m = await br.readRendered(srv.origin + '/', { browser, policy: { allowOrigins: new Set([srv.origin]) }, keepPages: true, deadlineMs: 60000, maxPages: 0 });
      const live = m.__live;
      await live.desktopPage.evaluate(() => { document.querySelector('[data-lcos-role="button-primary"]').style.setProperty('background-color', '#d4e157', 'important'); });
      g = await rr.run({ browser, manifest: m, live, seed: { 'desktop.button_primary.style.background': '#00ff00' }, deadline: Date.now() + 100000 });
      final = m.read.desktop.roles.button_primary.style.background;
    });
  } finally { await srv.close(); }
  const tried = g.reverted.find((x) => x.token === 'background' && x.to === '#d4e157');
  expect(tried, JSON.stringify(g.reverted)).toBeTruthy();
  expect(tried.reason).toMatch(/did not strictly improve|could be scored/);
  expect(g.repairs.some((x) => x.to === '#d4e157')).toBe(false);
  expect(final).toBe('#00ff00');
  // Each scored iteration's composite is recorded, and none is worse than the first.
  expect(g.iterations.length).toBeGreaterThan(1);
});

test('E: the font legal gate - a brand font is recorded with its source URLs and loaded by REFERENCE to measure, never copied into a generated email', async () => {
  const { out } = await read('c');
  const f = out.manifest.fonts.heading;
  expect(f).toMatchObject({ family: 'Fixture Display', licence: 'brand font', display_name: 'Fixture Display (brand font)', fallback_stack: "'Georgia',serif", files_by_reference: true });
  expect(new URL(f.files[0].url).pathname).toBe('/fonts/display.ttf');
  // What the wizard applies names it as a brand font, with its fallback, and carries URLs only.
  expect(out.apply['typography.heading'].value).toMatchObject({ licence: 'brand font', display_name: 'Fixture Display (brand font)' });
  expect(JSON.stringify(out.apply)).not.toMatch(/data:font|base64,AAEAAA/);
  // Our renderers: the landing-page preview loads the file BY REFERENCE (to
  // measure it); no mailer style carries an @font-face or the file's URL.
  const rr = require('../api/_shared/render-regression.js');
  const ours = rr.renderOurs(rr.brandFor(out.manifest), rr.sampleFrom(out.manifest));
  expect(ours.lp).toContain('/fonts/display.ttf');
  for (const [style, rendered] of Object.entries(ours.mailers)) {
    expect(rendered, `${style} mailer embeds a font face`).not.toContain('@font-face');
    expect(rendered, `${style} mailer references the brand's font file`).not.toContain('display.ttf');
    expect(rendered, `${style} mailer does not name the family first`).toContain("'Fixture Display'");
  }
  // A file the OPERATOR supplied (uploaded, or a URL they gave) is theirs to
  // license, and does reach the email - while the site's file still does not.
  const own = rr.renderOurs(rr.brandFor(out.manifest, {
    typography: { heading: { family: 'Fixture Display', stack: "'Fixture Display',Georgia,serif", google: false, src: 'https://cdn.mybrand.example/licensed/display.woff2', format: 'woff2' } },
    brand_data: { field_origin: { 'typography.heading': 'user' } },
  }), rr.sampleFrom(out.manifest));
  for (const [style, rendered] of Object.entries(own.mailers)) {
    expect(rendered, `${style} mailer lost the operator's licensed file`).toContain('https://cdn.mybrand.example/licensed/display.woff2');
    expect(rendered, `${style} mailer references the site's font file`).not.toContain('/fonts/display.ttf');
  }
  // The email's drawn fallback is the gate working, said as such - not a miss.
  // (The engine names a drawn face by its FILE: this fixture's "Fixture Display" is the OFL file "Erica One".)
  const rows = out.regression.tokens.filter((t) => t.surface === 'mailer' && t.token === 'drawn face' && /: heading$/.test(t.component));
  expect(rows.length).toBe(4);
  for (const t of rows) {
    expect(t.status).toBe('exempt');
    expect(t.reason).toMatch(/^font licence: Fixture Display is the brand's own font/);
  }
});

test('a consent overlay is HIDDEN, never accepted, and its colours are never read as the brand\'s', async () => {
  const srv = await sites.serve(sites.siteRoutes('j'));
  let out;
  try {
    out = await require(RENDER).readSite(srv.origin + '/', { policy: { allowOrigins: new Set([srv.origin]) }, deadlineMs: 110000, regression: false });
  } finally { await srv.close(); }
  expect(out.ok).toBe(true);
  expect(srv.hits.some((h) => /consent\/accept/.test(h)), 'the reader followed "Accept"').toBe(false);
  const hidden = out.manifest.read.desktop.stabilised.consent_hidden;
  expect(hidden.map((x) => x.id)).toContain('cookie-banner');
  expect(out.manifest.notes.join(' ')).toMatch(/consent overlay\(s\) were HIDDEN in the reader's throwaway browser, not accepted/);
  expect(role(out, 'button_primary').style.background).toBe('#2f4f8f');
  const m = JSON.stringify({ colors: out.manifest.colors, roles: out.manifest.read.desktop.roles, apply: out.apply });
  expect(m).not.toContain('#ff6a00');
});
