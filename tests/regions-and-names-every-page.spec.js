/**
 * Only the active brand's REAL markets, and only its NAME, on every app page.
 * ---------------------------------------------------------------------------
 * The operator, production, active brand Deli Chic (India only, regions=[IN]):
 * "ONLY VALID AND REAL CORRECT REGIONS MUST SHOW". /ad-campaigns#calendar
 * offered region tabs "US UK ALL" (typed into the page) and said "Loading the
 * Knickgasm Brain plan..." (tenant zero's name, for every brand).
 *
 * MEASURED, in Chromium, over every app page that loads auth.js (the
 * mobile-space enumeration: root *.html + every vercel.json destination, kept
 * when it loads the shell), under two device brands that are not tenant zero:
 *   in-only   "Saffron Lane Deli", regions [IN] (home)
 *   uk-only   "Harrow Finch Pantry", regions [UK] (home)
 *
 * A MARKET CONTROL is a button / tab / chip / link / option / radio / label
 * whose whole text is a market name or code (US, UK, GB, IN, India, Global,
 * EU, AU, United States, "India (IN)", ...), or whose data-mkt / data-market /
 * data-region / value is a market code. Every one in the DOM is read, shown or
 * not: a tab panel that is hidden on load is one click away. An "All"
 * aggregate is a market control when it sits in a row with market controls (or
 * says "All markets/regions"); with ONE market there is no All.
 *   DEFECT: a market control offering a market the brand does not have, or an
 *           All row for a one-market brand.
 * A TENANT-ZERO TOKEN is KNICKGASM / Knickgasm / KicksGPT / sneaker /
 * hand-painted / its two named wearers / its legal address, in any text node
 * that is connected once the brand has loaded (recorded as the page draws, so
 * a loading line that is replaced later is still caught), in a placeholder, or
 * in the document title.
 *   DEFECT: any, while another brand is active.
 *
 * Each page asserts it read a real number of elements and text runs; the
 * sweep as a whole asserts it found a real number of market controls (the
 * brand's own market chips/selects count): a check that inspects nothing
 * passes everything.
 *
 * Mutations verified (each restores one defect and fails this file):
 *   - ad-campaigns.html: the typed "US UK ALL" calendar region tabs restored
 *       -> ad-campaigns.html [in-only] + [uk-only]: market-foreign US/UK, market-all ALL
 *   - ad-campaigns.html: "Loading the Knickgasm Brain plan..." restored
 *       -> ad-campaigns.html [in-only] (the held-request state): tenant-token p.note
 *   - ad-campaigns.html: the heading "Ad calendar, the Knickgasm Brain plan" restored
 *       -> both brands: tenant-token h3
 *   - region-context.js options(): All offered for ONE market again
 *       -> dashboard.html both brands: market-all #regionChips "All"
 *   - agent.html: the typed US/UK/IN Market select restored
 *       -> agent.html both brands: market-foreign select#afMarket
 *   - brand-context.js: the [data-brand-name] slot left unfilled
 *       -> team.html: name-slot reads "Brand", not the brand's name
 *   - brand-demo.js: the owner-only artefact no longer held invisible
 *       -> uk-non-engagers.html: tenant-token (KNICKGASM UK ..., hand-painted ...)
 *
 * Inventory (write every page's findings, no assertion):
 *   REGIONS_NAMES_INVENTORY=/tmp/rn npx playwright test tests/regions-and-names-every-page.spec.js --project=desktop-1280
 *
 * Run: npx playwright test tests/regions-and-names-every-page.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const H = require('./lib/brand-theme-harness');
const M = require('./lib/mobile-space-harness');

test.describe.configure({ mode: 'parallel' });

const INVENTORY = process.env.REGIONS_NAMES_INVENTORY || '';
const ONLY = process.env.REGIONS_NAMES_PAGES ? new Set(process.env.REGIONS_NAMES_PAGES.split(',')) : null;

const PAL = { primary: '#1f6f50', accent: '#e0a526', ink: '#1d1d1b', surface: '#ffffff' };
const TYPE = {
  heading: { family: 'Fraunces', stack: "'Fraunces',Georgia,serif" },
  body: { family: 'Work Sans', stack: "'Work Sans',Helvetica,Arial,sans-serif" },
};
const BRANDS = {
  'in-only': H.define('regions-in-only', {
    name: 'Saffron Lane Deli', slug: 'saffron-lane-deli', palette: PAL, typography: TYPE,
    regions: [{ code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://saffronlane.example.test', home: true }],
  }),
  'uk-only': H.define('regions-uk-only', {
    name: 'Harrow Finch Pantry', slug: 'harrow-finch-pantry', palette: Object.assign({}, PAL, { primary: '#7a2e8c' }), typography: TYPE,
    regions: [{ code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://harrowfinch.example.test', home: true }],
  }),
};
const OWN = { 'in-only': ['IN'], 'uk-only': ['UK'] };

/* Exceptions, BY NAME, each with its reason. A page here is still loaded and
   measured (its counts must be real); only the named finding is excused. */
const ALLOWED = {
  // (page) -> [{ kind, match (RegExp on the finding's text/detail), why }]
  // None today: every finding of the first sweep was fixed at its source.
};
/* Tenant zero's own campaign artefacts (brand-demo.js guardOwnerArtifact):
   for any other brand the body is REPLACED by a note, so the page has almost
   nothing to read - asserted to be that note, not an empty measurement. */
const OWNER_ONLY = {
  'daily-email-calendar.html': "tenant zero's daily email calendar report",
  'lifecycle-usa-july-calendar-mailer-studio.html': "tenant zero's USA July calendar & mailer studio",
  'premium-experience.html': "tenant zero's premium experience walkthrough",
  'uk-non-engagers.html': "tenant zero's UK non-engagers campaign hub",
};

/* ── the probe ─────────────────────────────────────────────────────────── */
// Installed before any page script. Two records of tenant-zero tokens:
//  WRITTEN - every text node carrying a token that the PAGE put in the DOM
//    (its static HTML, or a later write), with the text as written. At the
//    snapshot it is a defect when that node is still connected and RENDERED,
//    whatever it says now: brand-context.js renames "KNICKGASM" in text for
//    20 s after load, which hid the literal in a test and not in production
//    (the operator's "Loading the Knickgasm Brain plan..."). A page writes the
//    active brand's name or neutral words; the rename is a net, not the fix.
//    Text inside a block the shell replaces or holds invisible for another
//    brand (data-shipped-for, an owner-only artefact) is not rendered, so it
//    is not counted.
//  SHOWN - a token still on screen 300 ms after it appeared, once the brand
//    has loaded (a flash of another company's material while a guard decides).
function recorder() {
  const RX = /\bKNICKGASM\b|\bKnickgasm\b|\bKicksGPT\b|\bsneakers?\b|\bhand-?painted\b|\bSamay Raina\b|\bRohit Sharma\b|\bGhatkopar\b/i;
  const seen = new Set();
  window.__rnFindings = [];
  window.__rnWritten = [];
  const skip = (el) => !el || !el.closest || el.closest('script,style,noscript,template,textarea,pre,code,kbd,samp,[data-rn-ignore]');
  const brandIn = () => { const b = window.BrandContext; return !!(b && b.loaded && b.brand); };
  const where = (p) => { let s = p.tagName ? p.tagName.toLowerCase() : '?'; if (p.id) s += '#' + p.id; else if (typeof p.className === 'string' && p.className.trim()) s += '.' + p.className.trim().split(/\s+/)[0]; return s; };
  const candidates = new Set();
  const written = new Set();
  function note(n) {
    if (skip(n.parentNode) || written.has(n)) return;
    written.add(n);
    window.__rnWritten.push({ node: n, text: (n.nodeValue || '').trim().slice(0, 160), el: where(n.parentNode) });
  }
  function scan(node, write) {
    if (!node) return;
    if (node.nodeType === 3) { if (RX.test(node.nodeValue || '')) { candidates.add(node); if (write) note(node); } return; }
    if (node.nodeType !== 1 || skip(node)) return;
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (RX.test(n.nodeValue || '')) { candidates.add(n); if (write) note(n); }
  }
  function check() {
    if (!brandIn()) return;
    candidates.forEach((n) => {
      candidates.delete(n);
      if (!n.isConnected || skip(n.parentNode)) return;
      const v = (n.nodeValue || '').trim();
      const m = RX.exec(v); if (!m) return;
      const r = n.parentNode.getClientRects();
      if (!r.length || getComputedStyle(n.parentNode).visibility === 'hidden') return;
      const key = v.slice(0, 160);
      if (seen.has(key)) return; seen.add(key);
      window.__rnFindings.push({ kind: 'tenant-token', token: m[0], text: key, el: where(n.parentNode) });
    });
  }
  const start = () => {
    scan(document.body, true);
    new MutationObserver((ms) => {
      ms.forEach((m) => {
        if (m.type === 'characterData') scan(m.target, true);
        if (m.addedNodes) m.addedNodes.forEach((x) => scan(x, true));
      });
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    setInterval(() => setTimeout(check, 300), 300);
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
}

// The final snapshot: every market control in the DOM, placeholders, title.
const SNAPSHOT = `(() => {
  const FAM = {
    US: 'US', USA: 'US', 'UNITED STATES': 'US', AMERICA: 'US', 'U S': 'US',
    UK: 'UK', GB: 'UK', 'UNITED KINGDOM': 'UK', BRITAIN: 'UK', 'GREAT BRITAIN': 'UK',
    IN: 'IN', INDIA: 'IN',
    GLOBAL: 'GLOBAL', WORLDWIDE: 'GLOBAL', INTERNATIONAL: 'GLOBAL', 'REST OF WORLD': 'GLOBAL', ROW: 'GLOBAL',
    EU: 'EU', EUROPE: 'EU', AU: 'AU', AUSTRALIA: 'AU', CA: 'CA', CANADA: 'CA',
    'MIDDLE EAST': 'ME', ME: 'ME', UAE: 'AE', AE: 'AE', SG: 'SG', SINGAPORE: 'SG',
  };
  const ALIASES = Object.keys(FAM).sort((a, b) => b.length - a.length);
  const ALL_RX = /^(all|all markets|all regions|all countries)$/i;
  // The set of markets a control's text names, or null when it is not wholly a market label.
  function marketsOf(text) {
    let t = String(text || '').toUpperCase().replace(/[^A-Z ]+/g, ' ').replace(/\\s+/g, ' ').trim();
    if (!t || t.length > 32) return null;
    const out = new Set();
    for (const a of ALIASES) {
      const rx = new RegExp('(^| )' + a.replace(/ /g, ' ') + '(?= |$)', 'g');
      if (rx.test(t)) { out.add(FAM[a]); t = t.replace(rx, ' ').replace(/\\s+/g, ' ').trim(); }
    }
    t = t.replace(/\\b(MARKET|REGION|STORE)\\b/g, '').trim();
    return out.size && !t ? [...out] : null;
  }
  const codeOfAttr = (v) => { const k = String(v || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\\s+/g, ' ').trim(); return FAM[k] || (/^ALL$/.test(k) ? 'ALL' : ''); };
  const sel = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id; else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    const p = el.parentElement;
    if (p) s = (p.id ? p.tagName.toLowerCase() + '#' + p.id : p.tagName.toLowerCase() + (typeof p.className === 'string' && p.className.trim() ? '.' + p.className.trim().split(/\\s+/)[0] : '')) + ' > ' + s;
    return s;
  };
  const skip = (el) => el.closest('script,style,noscript,template,[data-rn-ignore]');
  const CTRL = 'button,[role=tab],[role=button],[role=option],option,a,label,input[type=radio],input[type=button],.chip,.tab,.pill,.seg,[data-mkt],[data-market],[data-region],[data-region-code],[data-m]';
  const controls = [];
  let elements = 0;
  document.querySelectorAll(CTRL).forEach((el) => {
    if (skip(el)) return;
    elements++;
    const text = (el.tagName === 'INPUT' ? (el.value || '') : (el.innerText || el.textContent || '')).trim();
    let ms = marketsOf(text);
    const attrs = ['data-mkt', 'data-market', 'data-region', 'data-region-code', 'data-m'];
    for (const a of attrs) { const v = el.getAttribute(a); if (v != null && v !== '') { const c = codeOfAttr(v); if (c) ms = (ms || []).concat([c]); } }
    if ((el.tagName === 'OPTION' || (el.tagName === 'INPUT' && el.type === 'radio')) && !ms) { const c = codeOfAttr(el.value); if (c && c !== 'ALL') ms = [c]; }
    const isAll = ALL_RX.test(text) || (ms && ms.includes('ALL'));
    if (ms && ms.filter((c) => c !== 'ALL').length) controls.push({ el, markets: [...new Set(ms.filter((c) => c !== 'ALL'))], text: text.slice(0, 40), sel: sel(el) });
    else if (isAll) controls.push({ el, markets: ['ALL'], text: text.slice(0, 40), sel: sel(el), all: true });
  });
  // An All is a market control only beside market controls (same row/select), or when it says so.
  const real = controls.filter((c) => !c.all);
  const near = (a, b) => { const pa = a.el.closest('select') || a.el.parentElement; return !!pa && pa.contains(b.el); };
  const kept = controls.filter((c) => !c.all || /markets|regions|countries/i.test(c.text) || real.some((r) => r !== c && near(c, r)));
  const placeholders = [];
  document.querySelectorAll('[placeholder]').forEach((el) => { if (!skip(el)) placeholders.push(el.getAttribute('placeholder')); });
  let textRuns = 0;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) if ((n.nodeValue || '').trim()) textRuns++;
  return {
    elements, textRuns,
    controls: kept.map((c) => ({ markets: c.markets, text: c.text, sel: c.sel, all: !!c.all, shown: !!(c.el.getClientRects().length || (c.el.tagName === 'OPTION' && c.el.parentElement && c.el.parentElement.getClientRects().length)) })),
    placeholders, title: document.title,
    // Every slot a page reserves for the brand's name holds the ACTIVE brand's name.
    nameSlots: [...document.querySelectorAll('[data-brand-name]')].map((el) => el.textContent.trim()),
    brandName: (window.BrandContext && window.BrandContext.brand && window.BrandContext.brand.name) || '',
    guarded: /This report belongs to another workspace/.test(document.body.innerText || ''),
    tokens: window.__rnFindings || [],
    written: (window.__rnWritten || []).filter((w) => {
      const n = w.node, p = n.parentNode;
      if (!n.isConnected || !p || !p.getClientRects().length) return false;
      if (getComputedStyle(p).visibility === 'hidden') return false;
      // Held invisible by an ancestor's opacity (a block kept back until the brand decides).
      for (let e = p; e && e.nodeType === 1; e = e.parentElement) if (getComputedStyle(e).opacity === '0') return false;
      return true;
    }).map((w) => ({ text: w.text, el: w.el })),
  };
})()`;

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => {
    const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
    const r = window.RegionContext;
    return within(r && typeof r.ready === 'function' ? r.ready() : null, 8000);
  }).catch(() => {});
  await page.evaluate(() => new Promise((resolve) => {
    let t = null;
    const done = () => { mo.disconnect(); clearTimeout(cap); resolve(); };
    const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, 700); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    t = setTimeout(done, 700);
    const cap = setTimeout(done, 8000);
  }));
  await page.waitForTimeout(900);
}

const TOKEN_RX = /\bKNICKGASM\b|\bKnickgasm\b|\bKicksGPT\b|\bsneakers?\b|\bhand-?painted\b|\bSamay Raina\b|\bRohit Sharma\b|\bGhatkopar\b/i;

function judge(file, brandKey, snap) {
  const own = new Set(OWN[brandKey]);
  const defects = [];
  for (const c of snap.controls) {
    if (c.all) { if (own.size < 2) defects.push({ kind: 'market-all', detail: c.sel + ' "' + c.text + '" (one market: no All)' }); continue; }
    const foreign = c.markets.filter((m) => !own.has(m));
    if (foreign.length) defects.push({ kind: 'market-foreign', detail: c.sel + ' "' + c.text + '" offers ' + foreign.join(',') + (c.shown ? '' : ' (hidden until shown)') });
  }
  const told = new Set();
  for (const t of (snap.written || []).concat(snap.tokens || [])) {
    if (told.has(t.text)) continue; told.add(t.text);
    defects.push({ kind: 'tenant-token', detail: t.el + ': "' + t.text + '"' });
  }
  for (const p of snap.placeholders) if (TOKEN_RX.test(p || '')) defects.push({ kind: 'tenant-token', detail: 'placeholder: "' + p + '"' });
  if (TOKEN_RX.test(snap.title || '')) defects.push({ kind: 'tenant-token', detail: 'title: "' + snap.title + '"' });
  for (const v of (snap.nameSlots || [])) if (v !== snap.brandName) defects.push({ kind: 'name-slot', detail: '[data-brand-name] reads "' + v + '", not "' + snap.brandName + '"' });
  const allowed = ALLOWED[file] || [];
  return defects.filter((d) => !allowed.some((a) => a.kind === d.kind && a.match.test(d.detail)));
}

const PAGES = M.pages().filter((f) => !ONLY || ONLY.has(f));

/* The two brands see the two states a page is in. 'uk-only': every feature
   request answers at once (the page's loaded state). 'in-only': feature
   requests are HELD - never answered while the page is measured - so each
   page is read in its LOADING state, the one the operator photographed
   ("Loading the Knickgasm Brain plan..." while the plan request was out).
   The shell's own requests (config, sign-in status, presets) still answer. */
const SLOW = { 'in-only': true };
async function holdFeatureRequests(page) {
  await page.route(H.HOST + '/api/**', (route) => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action') || '';
    if (/\/api\/public-config$/.test(u.pathname) && (!action || action === 'auth' || action === 'brand')) return route.fallback();
    // Held: the page keeps its loading state for the whole measurement.
    return undefined;
  });
}

for (const brandKey of Object.keys(BRANDS)) {
  for (const file of PAGES) {
    test(file + ' [' + brandKey + ']: only the brand\'s own markets and name', async ({ page }) => {
      test.setTimeout(90000);
      const log = { errors: [], dialogs: [] };
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.addInitScript(recorder);
      await H.install(page, BRANDS[brandKey], log);
      if (SLOW[brandKey]) await holdFeatureRequests(page);
      await H.open(page, file, BRANDS[brandKey]);
      await settle(page);
      const snap = await page.evaluate(SNAPSHOT);
      const defects = judge(file, brandKey, snap);
      if (INVENTORY) {
        fs.mkdirSync(INVENTORY, { recursive: true });
        fs.writeFileSync(path.join(INVENTORY, file.replace(/\W/g, '_') + '.' + brandKey + '.json'), JSON.stringify({ file, brandKey, defects, controls: snap.controls, elements: snap.elements, textRuns: snap.textRuns }, null, 1));
        return;
      }
      // It read the page: a check that inspects nothing passes everything.
      if (OWNER_ONLY[file]) {
        expect(snap.guarded, file + ': the owner-only note replaced ' + OWNER_ONLY[file]).toBe(true);
      } else {
        expect(snap.elements, file + ': controls read').toBeGreaterThan(3);
        expect(snap.textRuns, file + ': text runs read').toBeGreaterThan(10);
      }
      expect(defects.map((d) => d.kind + ': ' + d.detail), file + ' [' + brandKey + ']').toEqual([]);
      // A page that threw while building its controls measured half a page.
      expect(log.errors, file + ' [' + brandKey + ']: page errors').toEqual([]);
    });
  }
}

// The sweep found the brand's own market controls somewhere: a probe that
// never recognises a market control cannot see a foreign one either.
test('the probe recognises market controls (the brand\'s own, on the pages that offer one)', async ({ page }) => {
  test.setTimeout(90000);
  const file = 'ad-campaigns.html';
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(recorder);
  await H.install(page, BRANDS['in-only']);
  await H.open(page, file, BRANDS['in-only']);
  await settle(page);
  const snap = await page.evaluate(SNAPSHOT);
  // The probe on a synthetic row: one own, one foreign, one All.
  const synthetic = await page.evaluate((SN) => {
    const d = document.createElement('div');
    d.innerHTML = '<button data-mkt="IN">India</button><button data-mkt="US">US</button><button data-mkt="ALL">All</button><select><option value="UK">United Kingdom (UK)</option></select>';
    document.body.appendChild(d);
    const out = eval(SN);
    d.remove();
    return out.controls.filter((c) => /div > button|select > option/.test(c.sel));
  }, SNAPSHOT);
  const kinds = judge(file, 'in-only', { controls: synthetic, tokens: [], placeholders: [], title: '' }).map((d) => d.kind);
  expect(kinds.sort()).toEqual(['market-all', 'market-foreign', 'market-foreign']);
  expect(snap.controls.filter((c) => c.markets.includes('IN')).length, 'the brand\'s own IN control is offered').toBeGreaterThan(0);
});
