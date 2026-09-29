/**
 * No page ships one tenant's facts as static content.
 * ---------------------------------------------------------------------------
 * WHY. With The Times of India (a news brand) ACTIVE, three live screenshots
 * showed another company's facts under its name:
 *
 *   /research   "Rivals import airbrush; The Times of India owns it and is
 *               already in ~1,000 Target stores." A build-time card written for
 *               tenant zero - and not even tenant zero's: "airbrush", "Target
 *               stores", "mushroom-led leaders" and "calm-energy lane" are a
 *               sibling wellness brand's market study with the name swapped at
 *               fork time. brand-context.js then renamed the text node, which
 *               turned one tenant's prose into a false claim about another.
 *   /studio     A rendered mailer whose footer read "KNICKGASM Pvt. Ltd. · New
 *               Delhi", CTA "BEGIN THE RITUAL", offer strip "Free shipping over
 *               $49 · 30-day satisfaction guarantee" - a sibling tea brand's
 *               copy, hardcoded in ~40 places including canvas fillText calls
 *               that no DOM text scan can see. Wrong for tenant zero too: its
 *               legal entity is a different company name in a different city.
 *   /brain      tenant-zero copy on the same brand.
 *
 * THE RULE. Text is derived from the ACTIVE brand record (name, legal entity,
 * store URL, tagline, claims, CTA vocabulary) or it renders the
 * [DATA REQUIRED BEFORE LAUNCH: ...] marker. Renaming text nodes is not a fix.
 *
 * HOW THIS GATE WORKS. It RENDERS every app page in Chromium with a NON-tenant-
 * zero brand active and reads what came out: every text node, the title, every
 * alt/title/placeholder/aria-label, every iframe and srcdoc document, and every
 * CanvasRenderingContext2D fillText/strokeText argument (monkey-patched before
 * any page script runs - that is what makes the canvas variants visible). The
 * Mailer Studio is DRIVEN: all 11 archetypes x both variants via the page's own
 * window._ARCH_FLOW (a brief-driven render has holes in the shape of the briefs
 * nobody typed - the 2026-08-21 finding), both canvas variants, the structured
 * preview and the review-step iframes. Signatures are DERIVED from tenant zero's
 * own record so they cannot drift from it, plus the sibling literals, which are
 * asserted absent for tenant zero as well. Every count is printed, and the test
 * fails if the sweep measured too little: a check that inspects nothing passes
 * everything.
 *
 * Run: npx playwright test tests/cross-brand-leak.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const ZERO = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', '_default.json'), 'utf8'));
const TOI = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'times-of-india.json'), 'utf8'));

/* ── the pages ─────────────────────────────────────────────────────────────── */

/** Every page a signed-in operator can reach through the shell. Same derivation
 *  as signed-out-usable.spec.js, tightened to a REAL script tag: carrying
 *  auth.js is what makes a file an APP page rather than a generated artefact,
 *  and a comment that merely mentions auth.js is not carrying it. */
const SHELL_TAG = /<script[^>]+src=["']\/?auth\.js/;
const ALL_PAGES = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
  .filter((f) => SHELL_TAG.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
  .sort();

/** Pages with NO shell that are nonetheless offered to every tenant from the
 *  rail, so they are app surfaces and belong in the sweep. */
const INCLUDED_WITHOUT_SHELL = {
  // Rail group "3D Storefront & Websites": /3d, /3d/us, /3d/uk, /3d/global, /3d/in.
  // A public, sign-in-free demo by design (its own header comment), but a
  // signed-in operator of any brand reaches it from the rail.
  'storefront-3d.html': 'offered to every tenant from the rail (/3d/*) although it carries no shell',
  // Rail rows "Landing Page Templates" (/templates). A registry of tenant
  // zero's own final landing pages; for any other brand it renders the
  // DATA REQUIRED marker through data-shipped-for, never that registry. It
  // carried no shell when this sweep first opened it; the rail mounts on it
  // now, and it stays listed so the reason it is an app surface is on record.
  'template-gallery.html': 'offered to every tenant from the rail (/templates); swept whether or not it carries the shell',
  // /premium (rewrite-only): renders products, claims, legal copy and the logo
  // for the ACTIVE workspace through brand-context, so it is a brand surface.
  'premium-experience.html': 'reachable at /premium and rendered for the active workspace; swept whether or not it carries the shell',
};

/** Files that are legitimately tenant-zero-only, each with the reason. Nothing
 *  else is excluded: a page that is an app surface is in the sweep. */
const EXCLUDED = {
  // Generated mailer artefacts of one tenant's own campaign. They carry no
  // shell and are not app pages; they are excluded by the shell filter above
  // and listed here so the reason is on record.
  'knickgasm-grail-drop-presell-v5-variantA.html': 'generated tenant-zero mailer artefact, not an app page',
  'knickgasm-grail-drop-presell-v5-variantB.html': 'generated tenant-zero mailer artefact, not an app page',
  'knickgasm-lifecycle-campaign-from-the-30-d-us-variantB.html': 'generated tenant-zero mailer artefact, not an app page',
  // A pinned before/after snapshot of one tenant's 3 Jul 2026 build. auth.js
  // says it "must never change" (IS_FROZEN_DIFF) and its rail row is commented
  // out, so it is not offered to any tenant; changing it to pass this sweep
  // would defeat the reason it exists.
  'diff-version.html': 'frozen reference snapshot, must never change (auth.js IS_FROZEN_DIFF), not offered in the rail',
  // Built by `npm run build:july` from tenant zero's own July calendar: 48
  // mailers, ads and landing pages of one tenant's campaign, embedded whole.
  // Rewrite-only (/july-studio, /usa-july), no shell, no rail row.
  'lifecycle-usa-july-calendar-mailer-studio.html': 'generated tenant-zero calendar artefact (build:july), rewrite-only, not offered in the rail',
};
// A page named in INCLUDED_WITHOUT_SHELL that later gains the shell (the rail
// now mounts on every app page) is swept once, not twice.
const PAGES = Array.from(new Set(ALL_PAGES.concat(Object.keys(INCLUDED_WITHOUT_SHELL)))).filter((f) => !EXCLUDED[f]).sort();
const STUDIO = 'lifecycle_mailer_architect_v34.html';

/* ── the signatures ────────────────────────────────────────────────────────── */

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ordinary English words tenant zero lists as PREFERRED vocabulary. A word a
 *  news brand's own app chrome may legitimately use ("custom brief", "drop a
 *  file", "original") cannot be a signature, or the gate cries wolf - the same
 *  discipline scripts/test-brand-isolation.js applies to its FOREIGN list. */
const COMMON_ENGLISH = new Set(['custom', 'canvas', 'drop', 'drops', 'rotation', 'crafted', 'original']);

/** Tenant zero's signature, DERIVED from its own record so it cannot drift. */
function tenantZeroSignatures(brand) {
  const sig = [];
  const add = (label, rx) => sig.push({ label, rx });
  add('name: ' + brand.name, new RegExp(esc(brand.name), 'i'));
  try {
    const host = new URL(brand.website).hostname.replace(/^www\./, '');
    add('store host: ' + host, new RegExp(esc(host), 'i'));
  } catch (_) { /* a record without a website has no host signature */ }
  // The legal entity and its address parts - minus a bare country, which every
  // Indian brand shares.
  String(brand.legal_entity || '').split(/,\s*/).map((s) => s.trim())
    .filter((s) => s && !/^(india|usa|uk)$/i.test(s))
    .forEach((part) => add('legal entity: ' + part, new RegExp(esc(part), 'i')));
  if (brand.tagline) add('tagline: ' + brand.tagline, new RegExp(esc(brand.tagline), 'i'));
  (brand.claims || []).forEach((c) => add('claim: ' + c, new RegExp(esc(c), 'i')));
  (((brand.voice || {}).preferred) || [])
    .filter((w) => !COMMON_ENGLISH.has(String(w).toLowerCase()))
    .forEach((w) => add('preferred vocabulary: ' + w, new RegExp('\\b' + esc(w) + 's?\\b', 'i')));
  // The industry noun (record: "Custom sneakers / D2C") and the product names
  // of the assistant and the proof figures tenant zero's own output names.
  add('industry noun: sneaker', /\bsneakers?\b/i);
  add('assistant: KicksGPT', /\bkicksgpt\b/i);
  ['Samay Raina', 'Rohit Sharma', 'Shraddha Kapoor'].forEach((n) => add('proof name: ' + n, new RegExp(esc(n), 'i')));
  return sig;
}

/** Copy that belongs to neither tenant zero nor any other brand on the
 *  platform: the sibling tea/wellness brand's literals that survived the fork.
 *  Asserted absent for EVERY brand, tenant zero included. */
const SIBLING = [
  { label: 'sibling: A SLOWER STORY', rx: /a slower story/i },
  { label: 'sibling: BEGIN THE RITUAL', rx: /begin the ritual/i },
  { label: 'sibling: GARDEN-FRESH', rx: /garden-fresh/i },
  { label: 'sibling: EST. 2015', rx: /\best\.?\s*2015\b/i },
  { label: 'sibling: New Delhi', rx: /\bnew delhi\b/i },
  // "$49" as the sibling's free-shipping THRESHOLD ("over $49", "orders $49+"),
  // not a price a brand's own data happens to render ("$49" AOV, "$49.14").
  { label: 'sibling: $49 shipping threshold', rx: /\$49\+|(?:over|above|orders?|of|on)\s+\$49(?![\d.])/i },
  { label: 'sibling: Target stores', rx: /\btarget stores\b/i },
  { label: 'sibling: airbrush', rx: /\bairbrush/i },
  { label: 'sibling: mushroom-led', rx: /mushroom-led/i },
  { label: 'sibling: calm-energy', rx: /calm-energy/i },
];

/* ── the brand payload, shaped as the server ships it ─────────────────────── */

function payloadFor(preset, id) {
  const ws = Object.assign({}, preset, { id, status: 'active' });
  let readiness = null;
  try { readiness = core.readiness(ws, { products: 0 }); } catch (_) { /* optional */ }
  // The shape of op=get / op=active: the record plus tokens, fonts, readiness.
  return Object.assign({}, ws, { tokens: core.tokens(ws), fonts_href: core.fontsHref(ws), readiness, products: 0 });
}

/* ── the harness ───────────────────────────────────────────────────────────── */

async function install(page, brand) {
  const shell = core.shellPayload(brand);
  const api = {
    ok: true,
    supabase: { url: 'https://live.supabase.co', anonKey: 'anon' },
    brand, workspaces: [shell], active_id: brand.id, needs_onboarding: false,
    user: { id: 'u-sweep', email: 'sweep@example.test' },
    // The preset gallery is API DATA, labelled as templates, and has its own
    // gate (preset-gallery-no-swap.spec.js); an empty list keeps this sweep
    // about STATIC content.
    presets: [],
    entries: [], items: [], rows: [], campaigns: [], connections: [], providers: [], runs: [],
  };

  await page.addInitScript((seed) => {
    // Every canvas string, from every frame, before any page script runs.
    window.__canvasText = [];
    try {
      const P = CanvasRenderingContext2D.prototype;
      ['fillText', 'strokeText'].forEach((m) => {
        const orig = P[m];
        P[m] = function (text) { try { window.__canvasText.push(String(text)); } catch (_) {} return orig.apply(this, arguments); };
      });
    } catch (_) {}
    // The anonymous stand-in for supabase-js; it never holds a session.
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
    // SIGNED IN, the way the app signs in since 2026-09-28: a mobile+PIN
    // session kept on this device (the Studio's own overlay login, which this
    // harness used to seed through vhd_users/vhd_session, is commented out).
    // The brand under sweep is ACTIVE in the device store - a phone account
    // keeps its workspaces there - so every page paints as that brand, which
    // is the state the sweep is about; before this, brand ops routed to an
    // empty device store and the pages were swept unpainted.
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
      localStorage.setItem('lifecycle.brand.device.workspaces', JSON.stringify({ version: 1, active_id: seed.id, workspaces: [seed] }));
    } catch (_) {}
  }, Object.assign({}, brand, { id: 'local-sweep0001', status: 'active', storage: 'device', owner_id: null }));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  await page.route(/^https?:\/\/(?!app\.example\.test)/, (route) => {
    if (/\/auth\/v1\/health/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (route.request().resourceType() !== 'script') return route.abort('failed');
    const esm = /\+esm|\.mjs(\?|$)|esm\.sh|\/es\//.test(route.request().url());
    return route.fulfill({
      status: 200, contentType: 'text/javascript',
      body: esm
        ? 'const noop=()=>{};export default new Proxy({},{get:()=>noop});export const animate=noop,scroll=noop,inView=noop,stagger=noop,spring=noop,motion=new Proxy({},{get:()=>noop});'
        : 'window.tailwind=window.tailwind||{};',
    });
  });
  await page.route('http://app.example.test/**', (route) => {
    const u = new URL(route.request().url());
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  // Last registered wins: every API answers with the active brand.
  await page.route(/\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(api) }));
}

/** Everything a person could read on the page, by kind. */
const COLLECT = () => {
  const out = [];
  const push = (kind, s, where) => { const t = String(s == null ? '' : s); if (t.trim()) out.push({ kind, text: t, where: where || '' }); };
  const SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1 };
  // Where a text node sits (three ancestors, tag#id.class), so a hit names the
  // element that rendered it and not only the page.
  const pathOf = (el) => {
    const parts = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) {
      parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList && e.classList.length ? '.' + Array.from(e.classList).slice(0, 2).join('.') : ''));
    }
    return parts.join(' > ');
  };
  const walk = (doc, kind) => {
    if (!doc || !doc.body) return;
    const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentNode && SKIP[n.parentNode.nodeName]) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n; while ((n = w.nextNode())) push(kind, n.nodeValue, pathOf(n.parentElement));
    doc.querySelectorAll('[alt],[title],[placeholder],[aria-label]').forEach((el) => {
      ['alt', 'title', 'placeholder', 'aria-label'].forEach((a) => { if (el.hasAttribute(a)) push(kind + ':' + a, el.getAttribute(a), pathOf(el)); });
    });
    doc.querySelectorAll('textarea,input').forEach((el) => push(kind + ':value', el.value, pathOf(el)));
  };
  push('title', document.title);
  walk(document, 'text');
  document.querySelectorAll('iframe').forEach((f) => {
    if (f.hasAttribute('srcdoc')) push('srcdoc', f.getAttribute('srcdoc'));
    try { const d = f.contentDocument; if (d) { push('iframe:title', d.title); walk(d, 'iframe'); } } catch (_) {}
  });
  (window.__canvasText || []).forEach((t) => push('canvas', t));
  return out;
};

function scan(runs, signatures) {
  const hits = [];
  for (const sig of signatures) {
    // One sample per signature per KIND of run (page text, a placeholder, a
    // canvas string, each rendered mailer), so a hit inside a mailer is not
    // hidden behind an earlier hit in the page chrome.
    const seen = new Set();
    for (const r of runs) {
      if (seen.has(r.kind)) continue;
      const m = r.text.match(sig.rx);
      if (!m) continue;
      seen.add(r.kind);
      const i = m.index;
      hits.push({ label: sig.label, kind: r.kind, where: r.where || '', sample: r.text.slice(Math.max(0, i - 70), i + 70).replace(/\s+/g, ' ').trim() });
    }
  }
  return hits;
}

async function openPage(page, file) {
  await page.goto('http://app.example.test/' + file, { waitUntil: 'domcontentloaded' });
  // brand-context.js waits up to ~1.5 s for a token before it asks for the
  // active brand; give it that, then time for paint + relabel.
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.brand, null, { timeout: 12_000 }).catch(() => {});
  await page.waitForTimeout(900);
}

/** Drive the Studio the way an operator does, then read every render. */
async function driveStudio(page, brand) {
  const market = (((brand.regions || [])[0] || {}).code || 'US').toUpperCase();
  await page.locator('#promptIn').waitFor({ timeout: 20_000 });
  await page.evaluate(() => (window.studioCatalogReady ? window.studioCatalogReady() : null));
  // Obviously synthetic, and no brand's catalogue: nothing in these names may
  // itself match a signature.
  await page.evaluate(() => window.setStudioCatalog([
    { n: 'Fixture Item One, Blue', i: '', t: ['bestseller'], h: 'fixture-item-one', price: '129.00', type: 'Fixture', subtitle: 'Fixture' },
    { n: 'Fixture Item Two, Green', i: '', t: ['bestseller'], h: 'fixture-item-two', price: '119.00', type: 'Fixture', subtitle: 'Fixture' },
    { n: 'Fixture Bundle', i: '', t: ['gift'], h: 'fixture-bundle', price: '199.00', type: 'Fixture', subtitle: 'Fixture' },
  ], 'brand', ''));
  await page.waitForFunction(() => (window.CAT || []).length > 0, null, { timeout: 10_000 });
  await page.fill('#promptIn', '20% off bestsellers with code SWEEP20, a time-limited launch for subscribers');
  await page.evaluate(() => window.go2 && window.go2());
  await page.waitForTimeout(600);

  const rendered = await page.evaluate(async (mkt) => {
    const out = { html: {}, errors: [] };
    try {
      if (window.refreshStrategy) window.refreshStrategy();
      const st = (window.S && window.S.strategy) || (window.buildCampaignStrategy && window.buildCampaignStrategy());
      for (const arch of Object.keys(window._ARCH_FLOW || {})) {
        for (const v of ['A', 'B']) {
          try { out.html[arch + ':' + v] = window._arch_renderEmail(st, arch, v, null, mkt) || ''; }
          catch (e) { out.errors.push(arch + ':' + v + ' ' + e.message); }
        }
      }
      // The two entry points the buttons call, which also fill the review iframes.
      try { out.html['buildEmail'] = window.buildEmail(null, mkt) || ''; } catch (e) { out.errors.push('buildEmail ' + e.message); }
      try { out.html['buildEmailVariantB'] = window.buildEmailVariantB(null, mkt) || ''; } catch (e) { out.errors.push('buildEmailVariantB ' + e.message); }
      try { if (window.renderContentPreview) window.renderContentPreview(); } catch (e) { out.errors.push('renderContentPreview ' + e.message); }
      // The canvas (image) variants: the only renderer a DOM text scan cannot see.
      const prods = (window.CAT || []).slice(0, 4);
      const prompt = (window.S && (window.S.activePrompt || window.S.prompt)) || '';
      for (const v of ['A', 'B']) {
        try { await window.drawLayout(document.createElement('canvas'), prompt, mkt, prods, v); }
        catch (e) { out.errors.push('drawLayout ' + v + ' ' + e.message); }
      }
    } catch (e) { out.errors.push('drive ' + e.message); }
    return out;
  }, market);

  // Text of each rendered mailer, read as a document rather than grepped as
  // source, so a literal inside an attribute or a comment counts only if a
  // reader could see it (alt text yes, HTML comment no).
  const mailerRuns = await page.evaluate((htmlMap) => {
    const runs = [];
    for (const [key, html] of Object.entries(htmlMap)) {
      const doc = new DOMParser().parseFromString(html || '', 'text/html');
      doc.querySelectorAll('script,style').forEach((el) => el.remove());
      runs.push({ kind: 'mailer:' + key, text: (doc.body && doc.body.textContent) || '' });
      runs.push({ kind: 'mailer-title:' + key, text: doc.title || '' });
      doc.querySelectorAll('[alt],[title]').forEach((el) => {
        ['alt', 'title'].forEach((a) => { if (el.hasAttribute(a)) runs.push({ kind: 'mailer-' + a + ':' + key, text: el.getAttribute(a) }); });
      });
    }
    return runs;
  }, rendered.html);
  return { rendered, mailerRuns, market };
}

async function sweep(page, brand, signatures) {
  await install(page, brand);
  const report = { pages: 0, runs: 0, chars: 0, canvas: 0, archetypes: 0, hits: [], errors: [] };
  for (const f of PAGES) {
    await openPage(page, f);
    let runs = await page.evaluate(COLLECT);
    if (f === STUDIO) {
      const { rendered, mailerRuns, market } = await driveStudio(page, brand);
      report.archetypes = Object.keys(rendered.html).filter((k) => k.includes(':')).length;
      report.errors.push(...rendered.errors.map((e) => `${f}: ${e}`));
      report.canvas = await page.evaluate(() => (window.__canvasText || []).length);
      report.studioMarket = market;
      runs = runs.concat(await page.evaluate(COLLECT), mailerRuns);
    }
    report.pages++;
    report.runs += runs.length;
    report.chars += runs.reduce((a, r) => a + r.text.length, 0);
    for (const h of scan(runs, signatures)) report.hits.push(Object.assign({ page: f }, h));
  }
  return report;
}

function print(name, r) {
  console.log(`[cross-brand-leak] ${name}: ${r.pages} pages, ${r.runs} text runs, ${r.chars} chars, ${r.canvas} canvas strings, ${r.archetypes} Studio archetype renders (market ${r.studioMarket}), ${r.hits.length} hits`);
  for (const h of r.hits) console.log(`  ${h.page} [${h.kind}${h.where ? ' @ ' + h.where : ''}] ${h.label}: …${h.sample}…`);
  if (r.errors.length) console.log('  drive errors: ' + r.errors.join(' | '));
  try {
    const dir = process.env.LEAK_REPORT_DIR || os.tmpdir();
    fs.writeFileSync(path.join(dir, `cross-brand-leak-${name.replace(/\W+/g, '-')}.json`), JSON.stringify(r, null, 2));
  } catch (_) {}
}

function measured(r) {
  // A sweep over nothing passes everything. These floors are far below what the
  // real page set produces and far above what an empty or broken run produces.
  expect(r.pages, 'too few pages swept').toBeGreaterThanOrEqual(40);
  expect(r.runs, 'too few text runs collected').toBeGreaterThan(5000);
  expect(r.archetypes, 'the Studio did not render every archetype x variant').toBeGreaterThanOrEqual(22);
  expect(r.canvas, 'no canvas text captured: the fillText capture is broken').toBeGreaterThan(20);
  expect(r.errors, 'the Studio could not be driven').toEqual([]);
}

/* ═══ the page list is real ═══════════════════════════════════════════════ */

test('the sweep covers the real page set and names its exclusions', () => {
  expect(PAGES.length, 'no app pages found').toBeGreaterThan(40);
  expect(PAGES).toContain('research.html');
  expect(PAGES).toContain('smart-brain.html');
  expect(PAGES).toContain(STUDIO);
  for (const f of Object.keys(EXCLUDED)) {
    expect(fs.existsSync(path.join(ROOT, f)), `${f} is excluded but does not exist`).toBe(true);
    expect(PAGES).not.toContain(f);
  }
  // The signatures derived from tenant zero are the ones the finding named.
  const labels = tenantZeroSignatures(ZERO).map((s) => s.label);
  expect(labels).toContain('name: KNICKGASM');
  expect(labels.some((l) => /^legal entity: /.test(l)), 'no legal-entity signature derived').toBe(true);
  expect(labels.some((l) => /^claim: /.test(l)), 'no claim signature derived').toBe(true);
  expect(labels.some((l) => /^preferred vocabulary: /.test(l)), 'no vocabulary signature derived').toBe(true);
});

/* ═══ a non-tenant-zero brand sees nothing of tenant zero, or of the sibling ═ */

test('with The Times of India active, no page renders tenant zero or sibling copy', async ({ page }) => {
  test.setTimeout(900_000);
  const brand = payloadFor(TOI, 'ws-sweep-toi');
  const r = await sweep(page, brand, tenantZeroSignatures(ZERO).concat(SIBLING));
  print('times-of-india', r);
  measured(r);
  expect(r.hits.map((h) => `${h.page} [${h.kind}${h.where ? ' @ ' + h.where : ''}] ${h.label}: ${h.sample}`), 'another brand\'s facts rendered under The Times of India').toEqual([]);
});

/* ═══ tenant zero sees its own facts, and never the sibling's ═════════════ */

test('with tenant zero active, the sibling literals are absent too', async ({ page }) => {
  test.setTimeout(900_000);
  const brand = payloadFor(ZERO, 'ws-sweep-zero');
  const r = await sweep(page, brand, SIBLING);
  print('tenant-zero', r);
  measured(r);
  expect(r.hits.map((h) => `${h.page} [${h.kind}${h.where ? ' @ ' + h.where : ''}] ${h.label}: ${h.sample}`), 'the sibling brand\'s copy rendered for tenant zero').toEqual([]);
});
