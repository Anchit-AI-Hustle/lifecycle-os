// The Mailer Studio, run as the ACTIVE brand: its colours, its words, and a
// prompt that asks for an EMAIL.
//
// Production, 2026-10-10, an account brand "Deli Chic" (an Indian chicken and
// cold-cuts food brand: orange primary #ffa517, a near-black accent, Poppins)
// active on /studio. The operator's screenshots showed four things, each a
// different layer of the same habit - the Studio reached for tenant zero, or
// for the tea brand this repo was forked from, wherever the brand record was
// one step away:
//
//   1. The mailer canvas wore tenant zero's palette: red #D0473E bands and
//      buttons, a purple #6A33D8 eyebrow, a serif display face. The canvas
//      (drawLayout) painted four literal hexes with Georgia; the archetype
//      renderer read only a typography STACK (a record with a family alone kept
//      tenant zero's Montserrat/Georgia), and every brand colour used AS TEXT
//      was the raw primary (an orange on white is under 2:1).
//   2. The copy and prompts carried another brand's world: "LIMITED TIME",
//      "Aesop / Kinfolk / Glossier aesthetic", "product placed on chalk linen
//      ... deep greens", "Colour world: #D0473E, #6A33D8, #FFFFFF, #111111", and
//      a client scrub that REPLACED banned phrases with "premium daily ritual".
//   3. The only prompt the Prompts tab offered (and the one every Open button
//      copied) said "this is a PHOTOGRAPH, not an email". Pasted into ChatGPT it
//      returned an image; asked for a mailer, a raster picture of an email.
//   4. A dark ground around the preview.
//
// Everything below is EXECUTED: the shipped page in Chromium, a device brand
// shaped like Deli Chic active (the state production is in), its own catalogue
// beside it, every archetype x variant rendered and measured with computed
// styles, the canvas's own draw calls recorded, and the clipboard stubbed so
// what each Open / Copy button actually puts there is read back.
//
// Run: npx playwright test tests/studio-brand-mail-prompt.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const BT = require('./lib/brand-theme-harness');

const DELI = BT.define('studio-deli-shaped', {
  name: 'Deli Chic Fixture', slug: 'deli-chic-fixture',
  palette: { primary: '#ffa517', accent: '#0e0101', ink: '#1d1b1b', surface: '#ffffff' },
  // The heading carries a FAMILY with no stack on purpose: that shape kept
  // tenant zero's Montserrat/Georgia in every mailer.
  typography: {
    heading: { family: 'Poppins' },
    body: { family: 'Poppins', stack: "'Poppins',Helvetica,Arial,sans-serif" },
  },
  regions: [{ code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://delichic.example.test', home: true }],
  record: {
    tagline: 'Honest chicken, cut fresh', industry: 'Food: chicken and cold cuts', website: 'https://delichic.example.test',
    voice: { tone: 'Warm, direct and appetising', preferred: ['fresh', 'juicy'], banned: ['guilt-free'] },
    claims: ['Antibiotic residue free chicken', 'Delivered chilled across Mumbai'],
    legal_entity: 'Deli Chic Foods Private Limited, Mumbai 400001, India',
  },
});
const ROWS = [
  { region: 'in', handle: 'chicken-drumsticks', title: 'Chicken Drumsticks Antibiotic Residue Free', product_type: 'Chicken', price: '349', currency: 'INR', image_url: 'https://cdn.delichic.example.test/drumsticks.jpg', product_url: 'https://delichic.example.test/products/chicken-drumsticks', source: 'csv' },
  { region: 'in', handle: 'chicken-salami', title: 'Smoked Chicken Salami', product_type: 'Cold cuts', price: '299', currency: 'INR', image_url: 'https://cdn.delichic.example.test/salami.jpg', product_url: 'https://delichic.example.test/products/chicken-salami', source: 'csv' },
  { region: 'in', handle: 'chicken-breast', title: 'Chicken Breast Boneless', product_type: 'Chicken', price: '399', currency: 'INR', image_url: 'https://cdn.delichic.example.test/breast.jpg', product_url: 'https://delichic.example.test/products/chicken-breast', source: 'csv' },
];
const HERO = ROWS[0];

// Another brand's world, in any rendered mailer or any prompt.
const FOREIGN = [
  /cognitive/i, /ritual/i, /chalk/i, /aesop/i, /kinfolk/i, /glossier/i, /deep greens?/i, /\btea\b/i,
  /sneaker/i, /\bkicks?\b/i, /knickgasm/i, /#d0473e/i, /#6a33d8/i, /steaming/i, /limited time/i,
  /montserrat/i, /instrument sans/i, /\bgeorgia\b/i,
];
const foreignIn = (text) => FOREIGN.filter((rx) => rx.test(text)).map((rx) => {
  const m = rx.exec(text); const i = m.index;
  return `${rx} … ${text.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ')}`;
});

const TZ_RGB = ['rgb(208, 71, 62)', 'rgb(106, 51, 216)'];

/** Serve the Studio under the Deli-shaped device brand, its catalogue beside it,
 *  with the clipboard, window.open and the canvas's draw calls recorded. */
async function openStudio(page) {
  const row = await BT.install(page, DELI);
  await page.addInitScript(({ id, rows }) => {
    try {
      localStorage.setItem('lifecycle.brand.device.workspaces.catalog.' + id, JSON.stringify({
        products: rows, source: { kind: 'csv', imported_at: '2026-10-09T10:00:00.000Z', row_count: rows.length, region: 'in' }, owned: true, region: 'in',
      }));
    } catch (_) {}
    window.__clips = [];
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__clips.push(String(t)); return Promise.resolve(); }, readText: () => Promise.resolve('') } });
    } catch (_) {}
    window.open = () => null;
    // Every colour and font the canvas is asked to paint.
    window.__canvas = { fill: [], font: [] };
    const P = CanvasRenderingContext2D.prototype;
    for (const [k, bucket] of [['fillStyle', 'fill'], ['strokeStyle', 'fill'], ['font', 'font']]) {
      const d = Object.getOwnPropertyDescriptor(P, k);
      Object.defineProperty(P, k, { configurable: true, get() { return d.get.call(this); }, set(v) { if (typeof v === 'string') window.__canvas[bucket].push(v); d.set.call(this, v); } });
    }
  }, { id: row.id, rows: ROWS });
  const painted = await BT.open(page, 'studio', DELI);
  expect(painted, 'the Studio never painted the active brand').toBe(true);
  await page.waitForFunction(() => window.__studioBrandFullReady, null, { timeout: 15_000 });
  await page.evaluate(() => window.__studioBrandFullReady);
  await page.evaluate(() => window.studioCatalogReady && window.studioCatalogReady());
  await page.waitForFunction(() => (window.CAT || []).length >= 3, null, { timeout: 15_000 });
  return row;
}

/** Walk the Studio flow to Step 4 with the hero product selected. */
async function buildCampaign(page) {
  await page.evaluate((title) => {
    const hero = window.CAT.find((p) => p.n === title) || window.CAT[0];
    window.S.manualProds = [hero].concat(window.CAT.filter((p) => p !== hero).slice(0, 2));
  }, HERO.title);
  await page.fill('#promptIn', 'Weekend barbecue: our chicken drumsticks for the family grill, 20% off');
  await page.evaluate(() => window.go2 && window.go2());
  await page.waitForTimeout(400);
  await page.evaluate(() => { if (typeof window.go3 === 'function') return window.go3(); return null; }).catch(() => null);
  await page.waitForFunction(() => window.S && window.S.emailPrompts && Object.keys(window.S.emailPrompts).length > 0, null, { timeout: 30_000 });
  // Step 4 shown: the generation chain has run to the end.
  await page.waitForFunction(() => { const p = document.getElementById('p4'); return p && getComputedStyle(p).display !== 'none'; }, null, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

/** Measured in a page of its own: computed colours, grounds, families, AA. */
const AUDIT = (cfg) => {
  const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
  const darkNeutral = (c) => { const s = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); return lum(c) < 0.06 && s < 40; };
  const out = { colours: new Set(), families: new Set(), grounds: [], dark: [], unreadable: [], text: 0, primaryGrounds: 0 };
  const groundOf = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  for (const el of document.body.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    for (const k of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor']) {
      if (k.startsWith('border') && parseFloat(s[k.replace('Color', 'Width')]) === 0) continue;
      const c = parse(s[k]); if (c && c.a > 0) out.colours.add(hex(c));
    }
    const bg = parse(s.backgroundColor);
    if (bg && bg.a > 0.5 && r.width >= 120 && r.height >= 20) {
      // A CONTROL may wear a near-black accent, as on the brand's own site; a
      // SECTION may not (validatePalette's rule, and the design HARD rule).
      if (darkNeutral(bg) && !/^(A|BUTTON)$/.test(el.tagName) && !el.closest('a,button')) out.dark.push(el.tagName + ' ' + hex(bg) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      if (hex(bg) === cfg.primary) out.primaryGrounds++;
    }
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
    if (!own) continue;
    out.families.add(String(s.fontFamily).split(',')[0].trim().replace(/^['"]|['"]$/g, ''));
    let op = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity || '1');
    const g = groundOf(el); if (!g) continue;
    const fg0 = parse(s.color); const a = fg0.a * op;
    const fg = { r: fg0.r * a + g.r * (1 - a), g: fg0.g * a + g.g * (1 - a), b: fg0.b * a + g.b * (1 - a) };
    const size = parseFloat(s.fontSize), w = parseInt(s.fontWeight, 10) || 400;
    const floor = (size >= 24 || (size >= 18.66 && w >= 700)) ? 3 : 4.5;
    out.text++;
    const cr = ratio(fg, g);
    if (cr < floor - 0.01) out.unreadable.push(`${cr.toFixed(2)}:1 "${own.slice(0, 40)}" ${hex(fg)} on ${hex(g)}`);
  }
  return { colours: [...out.colours], families: [...out.families], dark: out.dark, unreadable: out.unreadable, text: out.text, primaryGrounds: out.primaryGrounds };
};

test.describe.configure({ mode: 'serial' });

test('every archetype x variant the Studio renders wears the active brand: its palette and family, AA, no black section, nothing of tenant zero', async ({ page, context }) => {
  test.setTimeout(240_000);
  await openStudio(page);
  await buildCampaign(page);
  const renders = await page.evaluate(() => {
    const out = {};
    window.refreshStrategy && window.refreshStrategy();
    const st = window.S.strategy;
    for (const arch of Object.keys(window._ARCH_FLOW || {})) {
      for (const v of ['A', 'B']) {
        try { out[arch + ':' + v] = window._arch_renderEmail(st, arch, v, null, 'IN') || ''; } catch (e) { out[arch + ':' + v] = 'ERROR ' + e.message; }
      }
    }
    return out;
  });
  const names = Object.keys(renders);
  expect(names.length, 'every archetype, both variants').toBeGreaterThanOrEqual(20);

  const viewer = await context.newPage();
  await viewer.route('**/*', (route) => (route.request().resourceType() === 'image'
    ? route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') })
    : route.abort()));
  const bad = { tz: [], fam: [], dark: [], unreadable: [], words: [], phone: [] };
  let textRuns = 0, primaryUsed = 0;
  for (const [k, mailer] of Object.entries(renders)) {
    expect(mailer.startsWith('ERROR'), `${k} threw: ${mailer.slice(0, 160)}`).toBe(false);
    expect(mailer.length, `${k} rendered nothing`).toBeGreaterThan(3000);
    // The archetype's own layout key ("ritual-journey") is a structural label
    // in an HTML comment, not copy; everything else in the document is judged.
    for (const f of foreignIn(mailer.replace(/<!-- archetype:[^>]*-->/g, ''))) bad.words.push(`${k}: ${f}`);
    expect(mailer, `${k} does not carry the brand's own name`).toContain('Deli Chic Fixture');
    // Tenant zero's collection slugs on another brand's store are a 404.
    if (/\/collections\//.test(mailer)) bad.words.push(`${k}: links a guessed /collections/ slug`);
    await viewer.setContent(mailer, { waitUntil: 'domcontentloaded' });
    const r = await viewer.evaluate(AUDIT, { primary: '#ffa517' });
    textRuns += r.text; primaryUsed += r.primaryGrounds;
    for (const c of r.colours) if (['#d0473e', '#6a33d8'].includes(c)) bad.tz.push(`${k}: ${c}`);
    for (const f of r.families) if (!/^(Poppins|Helvetica|Arial|sans-serif)$/i.test(f)) bad.fam.push(`${k}: ${f}`);
    bad.dark.push(...r.dark.map((d) => `${k}: ${d}`));
    bad.unreadable.push(...r.unreadable.map((d) => `${k}: ${d}`));
    // A phone (2026-10-17): no mail may scroll sideways at 375px.
    await viewer.setViewportSize({ width: 375, height: 800 });
    await viewer.setContent(mailer, { waitUntil: 'domcontentloaded' });
    const sw = await viewer.evaluate(() => document.documentElement.scrollWidth);
    if (sw > 375) bad.phone.push(`${k}: ${sw}px wide at 375 ` + await viewer.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > 376 && e.parentElement && e.parentElement.getBoundingClientRect().right <= 376).slice(0, 4).map((e) => e.tagName + ' w=' + Math.round(e.getBoundingClientRect().width) + ' attrW=' + e.getAttribute('width') + ' ' + (e.getAttribute('style') || '').slice(0, 160) + ' txt=' + (e.textContent || '').trim().slice(0, 40)).join(' | ')));
    await viewer.setViewportSize({ width: 1280, height: 720 });
  }
  await viewer.close();
  expect([...new Set(bad.phone)], 'a mail that scrolls sideways on a phone').toEqual([]);
  // A check that inspects nothing passes everything.
  expect(textRuns, 'too few text runs measured to mean anything').toBeGreaterThan(400);
  expect(primaryUsed, 'the brand primary #ffa517 is never a ground in any mailer').toBeGreaterThan(10);
  expect([...new Set(bad.words)], 'another brand\'s words, hexes or families in the rendered mailer').toEqual([]);
  expect([...new Set(bad.tz)], 'tenant zero\'s colours painted in the mailer').toEqual([]);
  expect([...new Set(bad.fam)], 'a family that is not the brand\'s own').toEqual([]);
  expect([...new Set(bad.dark)], 'a section painted a dark neutral').toEqual([]);
  expect([...new Set(bad.unreadable)], 'text under the AA floor').toEqual([]);
});

test('the Step 4 canvas paints only the active brand: no tenant-zero hex, no Georgia, no black band', async ({ page }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  await buildCampaign(page);
  const seen = await page.evaluate(async () => {
    const c = document.getElementById('layoutCanvas');
    const out = {};
    for (const v of ['A', 'B']) {
      window.__canvas = { fill: [], font: [] };
      await window.drawLayout(c, window.S.activePrompt || window.S.prompt, 'IN', window.S.finalProds, v);
      const ctx = c.getContext('2d');
      const { width, height } = c;
      const data = ctx.getImageData(0, 0, width, height).data;
      // A band = a row more than 60% dark-neutral pixels.
      let darkRows = 0;
      for (let y = 0; y < height; y += 2) {
        let d = 0;
        for (let x = 0; x < width; x += 2) {
          const i = (y * width + x) * 4; const r = data[i], g = data[i + 1], b = data[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx < 60 && mx - mn < 40) d++;
        }
        if (d > (width / 2) * 0.6) darkRows++;
      }
      out[v] = { fill: [...new Set(window.__canvas.fill.map((s) => String(s).toLowerCase()))], font: [...new Set(window.__canvas.font)], darkRows, rows: height / 2 };
    }
    return out;
  });
  for (const v of ['A', 'B']) {
    const s = seen[v];
    expect(s.fill.length, `variant ${v}: the canvas painted nothing`).toBeGreaterThan(4);
    expect(s.fill.filter((f) => /#d0473e|#6a33d8|#111111|rgba\(0,\s*74,\s*43/.test(f)), `variant ${v}: tenant zero's colours on the canvas`).toEqual([]);
    expect(s.fill, `variant ${v}: the brand primary is never painted`).toContain('#ffa517');
    expect(s.font.filter((f) => /georgia|montserrat|instrument sans/i.test(f)), `variant ${v}: another brand's face on the canvas`).toEqual([]);
    expect(s.font.some((f) => /Poppins/.test(f)), `variant ${v}: the brand's own face is never set`).toBe(true);
    expect(s.darkRows, `variant ${v}: ${s.darkRows} of ${s.rows} canvas rows are a dark band`).toBeLessThan(4);
  }
});

test('every prompt the Studio builds is the active brand\'s: its name, palette and product, nobody else\'s world', async ({ page }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  await buildCampaign(page);
  const prompts = await page.evaluate(() => {
    const p = {};
    for (const v of ['A', 'B']) {
      p['email ' + v] = window.buildEmailAssetPrompt('IN', v);
      p['hero ' + v] = window.buildHeroPhotoPrompt('IN', v);
      p['flux ' + v] = window.buildPollinationsPrompt('IN', v);
      p['image matrix ' + v] = (window.S.imagePrompts.IN || {})[v];
    }
    p.master = window.getMasterSystemPrompt();
    p.design = window.buildDesignPromptFromCatalog('IN', 'A');
    return p;
  });
  for (const [k, t] of Object.entries(prompts)) {
    expect(t, `${k}: empty`).toBeTruthy();
    expect(foreignIn(t), `${k}: another brand's world in the prompt`).toEqual([]);
    expect(t, `${k}: the brand's own name`).toContain('Deli Chic Fixture');
    expect(t, `${k}: the selected product`).toContain(HERO.title);
    expect(t, `${k}: never base64`).not.toMatch(/;base64,|data:image/);
  }
  // The "Enhance" brief becomes the prompt itself: it carried a tea brand's
  // personas, a "farm-to-pair" voice and an instruction to invent a deadline.
  const enhanced = await page.evaluate(() => window.buildEnhancedPrompt('Weekend barbecue: our chicken drumsticks for the family grill'));
  expect(foreignIn(enhanced), 'the enhanced brief carries another brand\'s world').toEqual([]);
  expect(enhanced, 'the enhanced brief tells the writer to invent urgency').not.toMatch(/ends Sunday|Only \d+ units|sells out|while the season lasts/i);
  expect(enhanced).toContain('Warm, direct and appetising');
  for (const v of ['A', 'B']) {
    const e = prompts['email ' + v];
    expect(e).toContain('#ffa517');
    expect(e).toContain('Poppins');
    expect(e).toContain(HERO.image_url);
    expect(e).toContain('₹349');
    expect(e).toContain('Antibiotic residue free chicken');
    expect(e).toContain('Deli Chic Foods Private Limited');
  }
});

test('the Prompts tab leads with the EMAIL (HTML) prompt, and every Open / Copy button puts the right kind on the clipboard', async ({ page }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  await buildCampaign(page);
  await page.evaluate(() => window.switchP4Tab('chatgpt', document.getElementById('tab-chatgpt')));
  await expect(page.locator('#p4-chatgpt')).toBeVisible();

  // The email panel comes FIRST, and its chip says what it returns.
  const order = await page.evaluate(() => {
    const e = document.getElementById('emailPromptPanel'), h = document.getElementById('heroPromptPanel');
    return { emailFirst: !!(e && h && (e.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)), emailText: e && e.innerText, heroText: h && h.innerText, mono: (document.getElementById('emailPromptMono') || {}).textContent || '' };
  });
  expect(order.emailFirst, 'the email prompt must come before the hero photo prompt').toBe(true);
  expect(order.emailText).toContain('Email (HTML)');
  expect(order.heroText).toContain('Hero photo (image)');
  expect(order.heroText).toMatch(/INSIDE the email/);
  expect(order.mono.split('\n')[0]).toMatch(/^DELIVERABLE: Return ONE complete, self-contained HTML email/);

  const head = (t) => t.split('\n')[0];
  // Since 2026-10-11 the prompt ends with the shared OUTPUT REQUIREMENT
  // block (output-contract.js); the container pin is its last line.
  const tail = (t) => t.trim().split('\n').slice(-2)[0];
  const isEmail = (t, what) => {
    expect(head(t), `${what}: opens by naming the deliverable`).toMatch(/^DELIVERABLE: Return ONE complete, self-contained HTML email \(table layout, inline CSS, 600px, images-off safe\)/);
    expect(t.trim().split('\n').slice(-1)[0], `${what}: ends with the OUTPUT REQUIREMENT`).toBe('=== END OUTPUT REQUIREMENT ===');
    expect(tail(t), `${what}: closes by pinning the container`).toBe('Return only the HTML document. Not an image, not a screenshot, not a mockup, not a plan.');
    expect(t, what).toContain('Do NOT render the email as a picture');
    expect(t, what).not.toMatch(/PHOTOGRAPH, not an email/i);
    expect(t, what).toContain(HERO.title);
    expect(t, what).toContain('Deli Chic Fixture');
    expect(foreignIn(t), what).toEqual([]);
  };
  const isHero = (t, what) => {
    expect(head(t), `${what}: says it is one element`).toMatch(/^DELIVERABLE: HERO PHOTOGRAPH \(image\) - ONE ELEMENT of the Deli Chic Fixture email/);
    expect(t, what).toContain(HERO.title);
    expect(t, what).toContain(HERO.image_url);
    expect(foreignIn(t), what).toEqual([]);
  };

  const press = async (locator, what) => {
    await page.evaluate(() => { window.__clips = []; });
    await locator.click();
    await page.waitForFunction(() => window.__clips.length > 0, null, { timeout: 5000 }).catch(() => {});
    const clips = await page.evaluate(() => window.__clips.slice());
    expect(clips.length, `${what}: put nothing on the clipboard`).toBeGreaterThan(0);
    return clips[clips.length - 1];
  };
  const tab = page.locator('#p4-chatgpt');
  for (const name of ['Open ChatGPT', 'Open Claude', 'Open Gemini']) {
    const t = await press(tab.getByRole('button', { name: new RegExp(name) }), name);
    isEmail(t, name);
    await page.evaluate(() => { const o = document.getElementById('linkLoadingOverlay'); if (o) o.style.display = 'none'; });
  }
  const emailButtons = tab.locator('button[data-prompt-kind="email"]');
  const nEmail = await emailButtons.count();
  expect(nEmail, 'every email button is counted').toBeGreaterThanOrEqual(9);
  for (let i = 0; i < nEmail; i++) {
    const b = emailButtons.nth(i);
    const label = (await b.innerText()).trim();
    const t = await press(b, label);
    isEmail(t, label);
    await page.evaluate(() => { const o = document.getElementById('linkLoadingOverlay'); if (o) o.style.display = 'none'; });
  }
  const heroButtons = tab.locator('button[data-prompt-kind="image"]');
  const nHero = await heroButtons.count();
  expect(nHero).toBe(3);
  for (let i = 0; i < nHero; i++) {
    const b = heroButtons.nth(i);
    const label = (await b.innerText()).trim();
    expect(label, 'an image button says it copies the hero photo').toMatch(/hero photo/i);
    isHero(await press(b, label), label);
  }
  // Variant B's email asks for the visual variant, A's for text only.
  const a = await page.evaluate(() => window.S.emailPrompts.IN.A);
  const b = await page.evaluate(() => window.S.emailPrompts.IN.B);
  expect(head(a)).toMatch(/Variant A: text only/);
  expect(head(b)).toMatch(/Variant B: text and visual/);
});

test('the hero is the brand\'s own catalogue photo, and no photograph is generated without a product', async ({ page }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  await buildCampaign(page);
  const hero = await page.evaluate(() => { window.renderGeneratedImagesMatrix(); return { url: window.S.generatedImages.IN.A, kind: window.S.generatedImageSource.IN.A }; });
  expect(hero.kind).toBe('catalogue');
  expect(hero.url).toBe(HERO.image_url);
  // With no product selected there is nothing to photograph: the element
  // prompt is empty, the server is never asked, and the panel says why.
  const none = await page.evaluate(async () => {
    const sent = [];
    const realFetch = window.fetch;
    window.fetch = (u, o) => { sent.push(String(u)); return realFetch(u, o); };
    window.S.strategy.products = []; window.S.finalProds = [];
    const out = { hero: window.buildHeroPhotoPrompt('IN', 'A'), flux: window.buildPollinationsPrompt('IN', 'A') };
    await window.generateServerImage('A');
    window.buildImageMatrix(true); window.renderGeneratedImagesMatrix();
    out.sent = sent.filter((u) => /\/api\/ai\/image/.test(u));
    out.cell = window.S.generatedImages.IN.A;
    out.panel = (document.getElementById('generatedImagesMatrixTop') || document.getElementById('generatedImagesMatrix') || {}).innerText || '';
    window.fetch = realFetch;
    return out;
  });
  expect(none.hero).toBe('');
  expect(none.flux).toBe('');
  expect(none.sent, 'an image was requested with no product').toEqual([]);
  expect(none.cell).toBe('');
  expect(none.panel).toMatch(/DATA REQUIRED BEFORE LAUNCH: hero product, Deli Chic Fixture/);
});

test('the Studio frames around the canvas and the prompts are never a dark ground', async ({ page }) => {
  test.setTimeout(120_000);
  await openStudio(page);
  await buildCampaign(page);
  const dark = await page.evaluate(() => {
    const out = [];
    const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    for (const id of ['p4-claude', 'p4-chatgpt', 'p4-content', 'p4-upload']) {
      window.switchP4Tab(id.replace('p4-', ''), document.getElementById('tab-' + id.replace('p4-', '')));
      const root = document.getElementById(id);
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const r = el.getBoundingClientRect(); if (r.width < 120 || r.height < 30) continue;
        const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue;
        // A control (a button, or the button drawn inline in the content
        // preview) may wear a near-black accent; a SECTION may not.
        if (/^(BUTTON|A)$/.test(el.tagName) || (/inline/.test(s.display) && r.height < 64)) continue;
        const c = parse(s.backgroundColor); if (!c || c.a < 0.5) continue;
        const L = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
        if (L < 0.06 && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 40) out.push(id + ' ' + el.tagName + '#' + el.id + '.' + el.className + ' ' + s.backgroundColor);
      }
    }
    // The HTML source viewer (its code panel was #0d1117).
    window.S.marketMailers = { IN: { A: window.buildEmail(null, 'IN'), B: window.buildEmailVariantB(null, 'IN') } };
    window.S.activeMarket = 'IN';
    if (typeof window.viewMarketHtml === 'function') window.viewMarketHtml('IN');
    const modal = document.getElementById('vhdHtmlViewerModal');
    if (modal) for (const el of modal.querySelectorAll('*')) {
      const r = el.getBoundingClientRect(); if (r.width < 120 || r.height < 30) continue;
      const c = parse(getComputedStyle(el).backgroundColor); if (!c || c.a < 0.5) continue;
      const L = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      if (L < 0.06 && Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 40) out.push('html viewer ' + el.tagName + ' ' + getComputedStyle(el).backgroundColor);
    }
    return { out, modal: !!modal };
  });
  expect(dark.modal, 'the HTML source viewer did not open, so it was not measured').toBe(true);
  expect(dark.out, 'a dark ground in the Studio around the mailer').toEqual([]);
});
