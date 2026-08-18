// A card that describes ANOTHER brand must not be renamed to the active one.
//
// brand-context.js re-skins every page to the active brand, and part of that is
// a text swap: the shipped brand name becomes the active brand's name in every
// text node not inside [data-no-brand-swap]. Right for the shell. Catastrophic
// in the preset gallery, where every card is a DIFFERENT brand.
//
// Reported from production, with the operator's own brand active:
//
//     Snitch
//     D2C COMMERCE
//     Hand-painted one-of-one custom sneakers. Ships with a real
//     436-product catalogue.
//     Montserrat / Instrument Sans
//
// That is tenant zero's card. Only the NAME was swapped, so another company's
// product claim, palette, fonts and catalogue count were presented as this
// operator's own - the exact cross-brand leak this codebase has closed
// repeatedly one table at a time.
//
// The same applies to the workspace list (the operator's OTHER brands) and to
// the extraction panel (values a site published, quoted verbatim as evidence
// the operator is being asked to approve).
//
// Run: npx playwright test tests/preset-gallery-no-swap.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'onboarding.html'), 'utf8');
const ctx = fs.readFileSync(path.join(ROOT, 'brand-context.js'), 'utf8');

/* ═══ the mechanism still exists and still means what we think ════════════ */

test('the swap is opt-out via data-no-brand-swap, and honours ancestors', () => {
  // If this attribute is ever renamed, the markers below become decoration and
  // the leak returns silently. Assert the contract at its source.
  expect(ctx).toMatch(/closest\('\[data-no-brand-swap\]'\)/);
  expect(ctx).toMatch(/FILTER_REJECT/);
  // Marking a container has to protect its descendants, which is what closest()
  // on the text node's PARENT buys. Anything narrower would need a marker on
  // every generated card.
  expect(ctx).toMatch(/var p = node\.parentNode;[\s\S]{0,240}closest\('\[data-no-brand-swap\]'\)/);
});

/* ═══ every region that renders someone else's brand is marked ════════════ */

const REGIONS = [
  ['presetGallery', /id="presetGallery"[^>]*data-no-brand-swap/],
  ['workspace list', /id="wsList"[^>]*data-no-brand-swap/],
  ['extraction panel', /class="xtract" data-no-brand-swap/],
];

for (const [what, rx] of REGIONS) {
  test(`the ${what} is exempt from the brand-name swap`, () => {
    expect(html, `${what} would be rewritten to the active brand's name`).toMatch(rx);
  });
}

/* ═══ the specific leak, reconstructed ════════════════════════════════════ */

test('the swap would rewrite a preset card that was not exempt', () => {
  // Proves the marker is load-bearing rather than defensive decoration: the
  // gallery genuinely renders text the swap regex matches.
  const SHIPPED = /\bKNICKGASM\b|\bKnickgasm\b/;
  const preset = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'knickgasm.json'), 'utf8'));
  expect(SHIPPED.test(preset.name), 'tenant zero card no longer carries a swappable name').toBe(true);

  // And the payload that rode along with the renamed card is real card content,
  // not something only this test imagines.
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'index.json'), 'utf8'));
  const card = idx.presets.find((p) => p.slug === 'knickgasm');
  expect(card.blurb).toMatch(/catalogue/i);
  expect(card.swatch[0]).toBe('#D0473E');
});

/* ═══ and the same thing, proved in a browser ═════════════════════════════ */

const http = require('http');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const ACTIVE = {
  id: 'ws_live', slug: 'northwind-test', name: 'Northwind Test', tagline: 'A brand that is not tenant zero',
  palette: { primary: '#1F5FD0', accent: '#8A4B12', ink: '#111111', surface: '#FFFFFF', surface_alt: '#F4F6FA', muted: '#5C6470', line: '#E2E6EC' },
  typography: { heading: { family: 'system-ui', stack: 'system-ui,sans-serif' }, body: { family: 'system-ui', stack: 'system-ui,sans-serif' } },
  voice: {}, regions: [], status: 'active',
};

let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) {
      const q = req.url || '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // The gallery reads the REAL index, so the card under test is the real one.
      if (q.includes('op=presets')) {
        const slug = (q.match(/[&?]slug=([a-z0-9-]+)/) || [])[1];
        const file = slug ? `${slug}.json` : 'index.json';
        return res.end(slug
          ? JSON.stringify({ ok: true, preset: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/presets', file), 'utf8')) })
          : JSON.stringify(Object.assign({ ok: true }, JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/presets/index.json'), 'utf8')))));
      }
      return res.end(JSON.stringify({ ok: true, brand: ACTIVE, workspaces: [ACTIVE], active_id: ACTIVE.id, pack: null }));
    }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

test('with another brand active, the tenant zero card keeps its own name', async ({ page }) => {
  await page.goto(base + '/onboarding.html');
  await page.waitForSelector('#presetGallery .preset', { timeout: 20000 });

  // FIRST prove the swap machinery actually ran on this page. Without this the
  // assertion below would pass just as happily if brand-context had never
  // loaded, which is the most likely way this test rots into a no-op.
  await page.waitForFunction(
    () => document.querySelector('.lnav-brandname')
      && document.querySelector('.lnav-brandname').textContent.includes('Northwind Test'),
    null, { timeout: 20000 },
  );

  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#presetGallery .pname')).map((n) => n.textContent.trim()));
  expect(names, 'the gallery did not paint').not.toHaveLength(0);
  expect(names, "tenant zero's card lost its own name").toContain('KNICKGASM');
  expect(names.filter((n) => n === 'Northwind Test'),
    'the active brand was written over another brand\'s card').toEqual([]);

  // And the blurb that rode along with the renamed card is still attached to
  // the brand it describes.
  const zero = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('#presetGallery .preset'))
      .find((c) => c.querySelector('.pname').textContent.trim() === 'KNICKGASM');
    return card ? card.textContent : '';
  });
  expect(zero).toMatch(/catalogue/i);
  expect(zero).not.toMatch(/Northwind Test/);
});

/* ═══ the preview panel does not present invented figures as data ═════════ */

test('the sample figures in the preview say they are samples', () => {
  // The panel hardcodes 12 cohorts and 500 credits. They render under the
  // operator's brand name, and a live screenshot showed "500 Credits left"
  // beside a header badge reading 0 credits.
  expect(html).toMatch(/Active cohorts,12/);
  expect(html, 'the invented figures are unlabelled').toMatch(/sample values shown to size the layout, not your data/);
});
