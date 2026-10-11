// The generated-asset preview on /brain fits the screen it is opened on.
//
// THE REPORTED DEFECT (production /brain, ~1600px wide, after View on a slot):
// a blank white frame on the left with the mailer's copy on the right, a tall
// empty band between assets, the prompt-chip row and its caption cut off at
// the left edge, a hero image small inside a much larger empty box, an
// "Explore the collection" button cut off by its frame, and Chrome reporting
// that the View click blocked the page for 360ms.
//
// ONE CAUSE UNDER MOST OF IT. The preview opens inside a <td colspan> of the
// plan table, and `#plantable td{white-space:nowrap}` was inherited by every
// paragraph in it: each became one unbreakable line, the auto-layout table
// grew to the longest (1912px inside a 1242px scroller at 1600 wide), and the
// reviewer saw a slice of a preview wider than the screen. Under it, a 560px
// fixed frame cut long mailers (the button) and left empty ground under short
// ones, a mailer was stretched across 1,800px (its hero a small picture in a
// wide box), and six documents were parsed as escaped srcdoc attributes inside
// the click itself.
//
// Everything here is MEASURED in Chromium on the shipped page, with a campaign
// built by the real builders (email variants, both landing pages, static and
// video ads with their motion artefacts, the prompt index), at 1600, 1280 and
// 390 wide. Each check first asserts it measured something.
//
// Run: npx playwright test tests/brain-preview-layout.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sbp = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const core = require(path.join(ROOT, 'api', '_shared', 'brand-workspace-core.js'));
const svc = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const mp = require(path.join(ROOT, 'api', '_shared', 'master-prompt.js'));

// A synthetic brand (no real company): a food brand with its own palette.
const BRAND = {
  id: 'ws_bpl', slug: 'bpl-larder', name: 'Brambleweld Test Larder',
  industry: 'packaged food', website: 'https://larder.example',
  palette: { primary: '#8A2B0B', accent: '#E8A33D', ink: '#141414', surface: '#FFFFFF', surface_alt: '#F4F6F8', line: '#DDE3E8' },
  typography: { heading: "'Spectral',Georgia,serif", body: "'Public Sans',Arial,sans-serif" },
  regions: [{ code: 'IN', home: true, currency: 'INR', symbol: '₹', store_url: 'https://larder.example' }],
};
BRAND.tokens = core.tokens({ palette: BRAND.palette, typography: BRAND.typography });
const PHOTO_URL = 'https://img.example/photo.svg';

async function builtCampaign() {
  const e = {
    id: 'cal_bpl_in', date: '2026-10-20', market: 'IN',
    cohort: { name: 'Lapsed buyers', size: 900, rules: ['last_order_at > 120 days'] },
    objective: 'winback', rationale: 'test slot', confidence: 0.7,
    heroProduct: { title: 'Pepper Salami', handle: 'pepper-salami', price: 9, sku: 'PS-1', image: PHOTO_URL },
    supportingProducts: [], channels: ['email', 'landing_page', 'meta', 'google', 'tiktok', 'youtube'],
    cta: 'Explore the collection', brand: BRAND,
  };
  const campaign = new svc.GenerationService(svc.smartConfig({})).generate(e);
  const copy = {
    email: { subject: 'Back in the larder', preheader: 'Slow cured, sliced to order', hero_headline: 'Back in the larder', intro_paragraph: 'It has been a while. Here is what came back.', body_paragraph: 'Small-batch, slow cured, sliced to order.', cta: 'Explore the collection', image_brief: 'A board of sliced salami' },
    landing: { hero_headline: 'Back in the larder', why_bullets: ['Slow cured', 'Sliced to order'], cta: 'Explore the collection', image_brief: 'A board' },
    ads: {
      meta: { primary_text: 'Slow cured, sliced to order.', headline: 'Back in the larder', image_brief: 'A board of salami' },
      google: { headlines: ['Back in the larder'], descriptions: ['Slow cured, sliced to order.'], image_brief: 'A board' },
      tiktok: { script: 'Open on the board.', caption: 'Back in the larder', image_brief: 'A board' },
    },
  };
  const adPlatforms = campaign.assets.ads.map((a) => ({ platform: a.platform, creative_type: a.creative_type }));
  const creatives = await sbp.__test_generateCreatives(copy, e, { adPlatforms });
  sbp.__test_applyCopy(campaign, e, copy, copy, { key: 'a', name: 'A' }, { key: 'b', name: 'B' }, creatives, 'run');
  // The prompt index the console renders as chips, built the way the
  // generator attaches it (attachMasterPrompts): whole asset first, then parts.
  const pbase = { brand: BRAND, market: 'IN', cohort: e.cohort.name, brief: e.rationale, products: [e.heroProduct] };
  const em = campaign.assets.email;
  em.master_prompt_v1 = mp.buildMasterPrompt({ ...pbase, assetType: 'mailer', variant: 'V1' });
  em.master_prompt_v2 = em.master_prompt = mp.buildMasterPrompt({ ...pbase, assetType: 'mailer', variant: 'V2' });
  em.prompts = mp.promptsFor(em, 'mailer');
  for (const lp of campaign.assets.landing_pages || []) { lp.master_prompt = mp.buildMasterPrompt({ ...pbase, assetType: 'landing_page' }); lp.prompts = mp.promptsFor(lp, 'landing_page'); }
  for (const ad of campaign.assets.ads) { ad.master_prompt = mp.buildMasterPrompt({ ...pbase, assetType: 'ad', platform: ad.platform }); ad.prompts = mp.promptsFor(ad, 'ad'); }
  // Every static ad carries a photograph, as a brand with a catalogue does.
  for (const ad of campaign.assets.ads) if (ad.creative_type !== 'video') ad.creative = Object.assign({}, ad.creative, { image: PHOTO_URL });
  return { campaign, entry: e };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
let server; let base; let built;
test.beforeAll(async () => {
  built = await builtCampaign();
  server = http.createServer((req, res) => {
    const [url] = (req.url || '/').split('?');
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, brand: null, needs_onboarding: false, workspaces: [] }));
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

// A square photograph with an intrinsic size, as a catalogue photo has.
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#c8a27a"/><circle cx="600" cy="600" r="400" fill="#8a2b0b"/></svg>';

async function openPreview(page, width) {
  const { campaign, entry } = built;
  await page.setViewportSize({ width, height: 900 });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    const r = route.request();
    if (r.resourceType() === 'image' || /\.(svg|png|jpe?g|webp)(\?|$)/i.test(r.url())) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PHOTO });
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'window.Papa = window.Papa || { unparse: () => "" };' });
  });
  await page.addInitScript(() => { try { sessionStorage.setItem('sb.autogen', '1'); } catch (_) {} });
  const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const planEntry = Object.assign({}, entry, { brand: undefined, id: 'slot-bpl-1', date: iso(1), status: 'tentative' });
  await page.route('**/api/calendar**', async (route) => {
    const url = route.request().url();
    let body = { ok: true };
    if (url.includes('smart-brain-plan')) body = { ok: true, plan: [planEntry] };
    else if (url.includes('smart-brain-preview')) body = { ok: true, campaign, email_variants: campaign.assets.email.variants, ads: campaign.assets.ads, copywriter: campaign.copywriter };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(base + '/smart-brain.html', { waitUntil: 'domcontentloaded' });
  const view = page.locator('#viewbtn-0');
  await view.waitFor({ timeout: 20_000 });
  await view.click();
  await page.locator('#expbody-0 .pvroot').waitFor({ timeout: 30_000 });
  await waitFitted(page);
}

/** Every document frame has loaded and been fitted; every image has decoded. */
async function waitFitted(page) {
  await page.waitForFunction(() => {
    const fs = [...document.querySelectorAll('#expbody-0 iframe.pvframe')];
    const imgs = [...document.querySelectorAll('#expbody-0 img')];
    return fs.length > 0 && fs.every((f) => f.dataset.fitted === '1') && imgs.every((i) => i.complete);
  }, null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/** Every measurement, taken in the page. */
function measure() {
  const root = document.querySelector('#expbody-0 .pvroot');
  const scr = root.closest('.tblscroll');
  const sr = scr.getBoundingClientRect();
  // The visible part of the scroller: what the reviewer can actually see.
  const view = { left: Math.max(0, sr.left), right: Math.min(innerWidth, sr.left + scr.clientWidth) };
  const rr = root.getBoundingClientRect();
  const visible = (el) => { const st = getComputedStyle(el); const r = el.getBoundingClientRect(); return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  // An element inside a container that scrolls sideways on purpose (the shot
  // board, a pre) is judged by that container, not by the root.
  const scrollsX = (el) => { for (let p = el.parentElement; p && p !== root; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  const out = {
    vw: innerWidth, docW: document.documentElement.scrollWidth,
    view, root: { left: rr.left, right: rr.right, width: rr.width },
    promptChips: root.querySelectorAll('.pkbar button').length, promptNotes: root.querySelectorAll('.pknote').length,
    outside: [], clipped: [], buttons: 0, buttonsCut: [], frames: [], images: [], bands: [], elements: 0,
  };
  const all = [...root.querySelectorAll('*')].filter(visible);
  out.elements = all.length;
  for (const el of all) {
    const r = el.getBoundingClientRect();
    const name = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).join('.') : '') + ' "' + (el.textContent || '').trim().slice(0, 40) + '"';
    if (!scrollsX(el) && (r.left < view.left - 1 || r.right > view.right + 1 || r.left < rr.left - 1 || r.right > rr.right + 1)) out.outside.push(name + ` [${Math.round(r.left)},${Math.round(r.right)}] view [${Math.round(view.left)},${Math.round(view.right)}]`);
    const st = getComputedStyle(el);
    if ((st.overflowX === 'hidden' || st.overflowX === 'clip') && st.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.clipped.push(name + ` sw=${el.scrollWidth} cw=${el.clientWidth}`);
    if (el.tagName === 'BUTTON' || el.classList.contains('btn')) {
      out.buttons += 1;
      // The nearest ancestor that clips must hold the whole button.
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflowX !== 'visible' || ps.overflowY !== 'visible') {
          const pr = p.getBoundingClientRect();
          if (ps.overflowX !== 'auto' && ps.overflowX !== 'scroll' && (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1)) out.buttonsCut.push(name);
          break;
        }
      }
    }
  }
  for (const f of root.querySelectorAll('iframe')) {
    const r = f.getBoundingClientRect();
    let doc = null;
    try {
      const d = f.contentDocument;
      const bodyText = (d && d.body && d.body.innerText || '').trim();
      // Calls to action in the document, judged against the frame's viewport.
      const ctas = [...(d ? d.querySelectorAll('a,button') : [])].filter((a) => /explore|shop|collection/i.test(a.textContent || ''))
        .map((a) => { const ar = a.getBoundingClientRect(); return { text: (a.textContent || '').trim().slice(0, 30), bottom: ar.bottom, right: ar.right }; })
        .filter((c) => c.bottom > 0);
      // In the frame's own pixels. A mailer wider than a phone's frame is
      // shrunk to fit (CSS zoom on the preview document), and then its
      // rendered box, which carries the zoom, is what has to fit.
      const de = d.documentElement;
      const zoomed = !!de.style.zoom;
      const box = de.getBoundingClientRect();
      doc = {
        zoomed,
        scrollH: zoomed ? box.height : Math.max(de.scrollHeight, d.body ? d.body.scrollHeight : 0),
        scrollW: zoomed ? box.width : de.scrollWidth,
        clientW: f.clientWidth, clientH: f.clientHeight, text: bodyText.length, ctas,
      };
    } catch (e) { doc = { error: String(e) }; }
    out.frames.push({ cls: f.className, left: r.left, right: r.right, width: r.width, height: r.height, doc });
  }
  for (const img of root.querySelectorAll('img')) {
    if (!visible(img)) continue;
    const r = img.getBoundingClientRect();
    const box = img.parentElement.getBoundingClientRect();
    out.images.push({ src: img.currentSrc.slice(0, 40), complete: img.complete, nat: img.naturalWidth, area: r.width * r.height, boxArea: box.width * box.height, height: r.height });
  }
  // Empty vertical space between the last visible content of one section and
  // the heading of the next (and, for the last, the section's own bottom).
  const secs = [...root.querySelectorAll('.pvsec')].filter(visible);
  const contentBottom = (sec) => Math.max(...[...sec.querySelectorAll('*')].filter(visible).map((el) => el.getBoundingClientRect().bottom));
  secs.forEach((sec, i) => {
    const bottom = contentBottom(sec);
    const next = secs[i + 1];
    const nextTop = next ? next.querySelector('.pvsech').getBoundingClientRect().top : sec.getBoundingClientRect().bottom;
    out.bands.push({ section: (sec.querySelector('.pvsech') || {}).textContent, gap: nextTop - bottom });
  });
  return out;
}

for (const width of [1600, 1280, 390]) {
  test.describe(`at ${width}px wide`, () => {
    test.describe.configure({ timeout: 120_000 });
    let m;
    test.beforeEach(async ({ page }) => {
      await openPreview(page, width);
      m = await page.evaluate(measure);
    });

    test('the preview is no wider than the area it is shown in, and nothing in it is cut off', () => {
      expect(m.elements, 'measured too few elements to mean anything').toBeGreaterThan(200);
      expect(m.docW, 'the page scrolls sideways').toBeLessThanOrEqual(m.vw + 1);
      expect(m.root.left, 'the preview starts left of the visible area').toBeGreaterThanOrEqual(m.view.left - 1);
      expect(m.root.right, 'the preview runs past the visible area').toBeLessThanOrEqual(m.view.right + 1);
      expect(m.outside, 'elements outside the visible preview').toEqual([]);
      expect(m.clipped, 'content cut by an overflow:hidden box').toEqual([]);
      expect(m.buttons, 'measured no buttons').toBeGreaterThan(10);
      expect(m.promptChips, 'no prompt chips were rendered to measure').toBeGreaterThan(10);
      expect(m.promptNotes, 'no prompt captions were rendered to measure').toBeGreaterThan(5);
      expect(m.buttonsCut, 'buttons cut off by their container').toEqual([]);
    });

    test('every asset frame shows its document, at its height, with nothing hidden inside it', () => {
      const docs = m.frames.filter((f) => /pvframe/.test(f.cls));
      expect(docs.length, 'mailer variants + both landing pages').toBeGreaterThanOrEqual(5);
      expect(m.frames.length, 'the video creatives too').toBeGreaterThan(docs.length);
      for (const f of m.frames) {
        expect(f.doc && !f.doc.error, `${f.cls}: document unreadable ${f.doc && f.doc.error}`).toBeTruthy();
        expect(f.doc.text, `${f.cls}: the frame is blank`).toBeGreaterThan(40);
        expect(f.left).toBeGreaterThanOrEqual(m.view.left - 1);
        expect(f.right).toBeLessThanOrEqual(m.view.right + 1);
        expect(f.doc.scrollW, `${f.cls}: its document is wider than the frame`).toBeLessThanOrEqual(f.doc.clientW + 1);
      }
      let ctas = 0;
      for (const f of docs) {
        // Fitted: the frame is as tall as its document (2400px caps a very
        // long page, which then scrolls inside its frame).
        const want = Math.min(2400, f.doc.scrollH);
        expect(Math.abs(f.doc.clientH - want), `${f.cls}: frame ${Math.round(f.height)}px for a ${f.doc.scrollH}px document`).toBeLessThanOrEqual(6);
        for (const c of f.doc.ctas) {
          ctas += 1;
          expect(c.bottom, `${f.cls}: "${c.text}" is cut off by the frame`).toBeLessThanOrEqual(f.doc.clientH + 1);
          expect(c.right, `${f.cls}: "${c.text}" is cut off on the right`).toBeLessThanOrEqual(f.doc.clientW + 1);
        }
        // An email is shown at its own design width, not stretched.
        if (/is-mail/.test(f.cls)) expect(f.width, 'a mailer stretched across the row').toBeLessThanOrEqual(722);
      }
      expect(ctas, 'no frame had a call to action to check').toBeGreaterThan(0);
    });

    test('no tall empty band between assets, and every image fills its box', () => {
      expect(m.bands.length, 'sections measured').toBeGreaterThanOrEqual(10);
      for (const b of m.bands) expect(b.gap, `empty band after "${b.section}"`).toBeLessThanOrEqual(40);
      expect(m.images.length, 'static ad photographs measured').toBeGreaterThan(0);
      for (const i of m.images) {
        expect(i.complete && i.nat > 0, `${i.src} did not load`).toBe(true);
        expect(i.boxArea, `${i.src} sits in a box more than twice its size`).toBeLessThanOrEqual(i.area * 2);
        expect(i.height, `${i.src} is taller than a feed shows it`).toBeLessThanOrEqual(900);
      }
    });
  });
}

test('View answers the click before it builds the documents', async ({ page }) => {
  test.setTimeout(120_000);
  await openPreview(page, 1280);
  // Collapse, then reopen from the cache: the path that rendered everything
  // inside the click. The click's own task must be short, and no document may
  // be handed to a frame before the row has painted.
  await page.locator('#viewbtn-0').click();
  await expect(page.locator('#exprow-0')).toBeHidden();
  const r = await page.evaluate(() => {
    const t0 = performance.now();
    document.getElementById('viewbtn-0').click();
    const sync = performance.now() - t0;
    return { sync, framesInClick: document.querySelectorAll('#expbody-0 iframe[srcdoc]').length, open: document.getElementById('exprow-0').style.display !== 'none' };
  });
  expect(r.open, 'the row did not open').toBe(true);
  expect(r.sync, 'the click handler blocked the page').toBeLessThan(50);
  expect(r.framesInClick, 'documents were parsed inside the click').toBe(0);
  await waitFitted(page);
  const fitted = await page.evaluate(() => [...document.querySelectorAll('#expbody-0 iframe.pvframe')].filter((f) => f.dataset.fitted === '1' && f.srcdoc.length > 200).length);
  expect(fitted, 'the documents never arrived after the click').toBeGreaterThanOrEqual(5);
});
