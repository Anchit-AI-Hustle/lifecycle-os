// The words a page uses for what a brand sells, and for the people who take it.
//
// The /agent page shipped telling EVERY tenant's customers to ask about
// "crafting", "whether a colorway is worth it" and "does airbrush actually
// work?" - so The Times of India was offering its readers a colorway. Three
// separate things had to be wrong at once for that to reach production, and
// each is covered here:
//
//   1. The copy hardcoded tenant zero's product nouns. The brand-name swap in
//      brand-context.js cannot fix that: a product noun is not the brand name.
//   2. `placeholder` is an ATTRIBUTE, and that swap only walks text nodes, so
//      even the brand name would not have been replaced there.
//   3. agent.html sat in audit-pages.js's BRAND_ASSET exclusion list, so no
//      brand rule ran against it at all and the audit reported zero blockers.
//
// Run: npx playwright test tests/brand-nouns.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const growth = require(path.join(ROOT, 'api', '_shared', 'growth-os-core.js'));

/* Tenant zero's vocabulary. Any of these on an app surface is one tenant's
   language shown to another. "Namaste" is here for the same reason: it was
   wrong for a US brand long before it was wrong for a newspaper. */
const TENANT_ZERO_VOCAB = /\b(sneakers?|colorways?|airbrush(?:ed|ing)?|streetwear|hand-painted|grail|Namaste)\b/i;

/* A newspaper: sells sections and a subscription plan, not products. If the
   page derives its nouns correctly this brand should read naturally. */
const NEWS_BRAND = {
  id: 'ws_news', slug: 'daily-record', name: 'The Daily Record',
  offerings: [{ kind: 'section', name: 'City desk' }, { kind: 'plan', name: 'Digital' }],
  palette: { primary: '#8B1A1A', accent: '#1F4E79', ink: '#161616', surface: '#FFFFFF', surface_alt: '#F7F7F7', muted: '#6B6B6B' },
  typography: { heading: { family: 'Inter', stack: "'Inter',sans-serif" }, body: { family: 'Inter', stack: "'Inter',sans-serif" } },
  voice: {}, regions: [{ code: 'IN', currency: 'INR', symbol: '₹', store_url: 'https://news.example' }],
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, brand: NEWS_BRAND, workspaces: [], agents: [] }));
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

/* ═══ 1. The static copy carries nobody's product vocabulary ═══════════════ */

for (const page of ['agent.html', 'kicksgpt.html']) {
  test(`${page} ships no tenant-zero product vocabulary`, () => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    const hit = html.match(TENANT_ZERO_VOCAB);
    expect(hit && hit[0], `${page} still says "${hit && hit[0]}" - an app surface must be neutral or derive the noun from the active brand`).toBeFalsy();
  });
}

/* The greeting shown when the agent list fails to load is real shipped copy:
   it is what a brand sees on a bad network, which is exactly when nobody is
   watching. It used to be tenant zero's. */
test('the fallback agent greets without borrowing tenant zero language', () => {
  const html = fs.readFileSync(path.join(ROOT, 'agent.html'), 'utf8');
  const m = html.match(/var FALLBACK\s*=\s*\[([^\]]*)\]/);
  expect(m, 'agent.html should still define a FALLBACK agent').toBeTruthy();
  expect(m[1]).not.toMatch(TENANT_ZERO_VOCAB);
  expect(m[1]).not.toMatch(/knickgasm/i);
});

/* ═══ 2. The browser's noun table agrees with the server's ═════════════════ */

test('BrandContext.nouns() matches the server, so the two tables cannot drift', async ({ page }) => {
  await page.goto(base + '/agent.html');
  await page.waitForFunction(() => window.BrandContext && typeof window.BrandContext.nouns === 'function');

  for (const kind of ['product', 'section', 'programme', 'plan', 'event', 'service']) {
    // Drive the REAL function with a brand carrying exactly this kind.
    const got = await page.evaluate((k) => window.BrandContext.nouns({ offerings: [{ kind: k }] }), kind);
    expect(got.offering, `offering noun for "${kind}"`).toBe(growth.offeringNoun(kind));
    expect(got.audience, `audience noun for "${kind}"`).toBe(growth.audienceNoun(kind));
  }
});

test('a brand that declares no offering kind gets the generic word, never tenant zero\'s', async ({ page }) => {
  await page.goto(base + '/agent.html');
  await page.waitForFunction(() => window.BrandContext && typeof window.BrandContext.nouns === 'function');
  const got = await page.evaluate(() => window.BrandContext.nouns({ offerings: [] }));
  expect(got.offering).toBe('offer');
  expect(got.audience).toBe('customer');
  expect(got.offering).not.toMatch(TENANT_ZERO_VOCAB);
});

/* ═══ 3. The rendered page, which is what the customer actually reads ══════ */

test('/agent rendered for a newspaper never shows a product word it does not sell', async ({ page }) => {
  await page.goto(base + '/agent.html');
  await page.waitForFunction(() => window.BrandContext && window.BrandContext.loaded, null, { timeout: 10000 }).catch(() => {});
  const text = await page.evaluate(() => document.body.innerText);
  const hit = text.match(TENANT_ZERO_VOCAB.source ? new RegExp(TENANT_ZERO_VOCAB.source, 'i') : TENANT_ZERO_VOCAB);
  expect(hit && hit[0], `rendered /agent still shows "${hit && hit[0]}"`).toBeFalsy();

  // The placeholder is an attribute - the brand-name walker never reaches it,
  // which is why it kept asking about airbrush long after the copy was fixed.
  const ph = await page.getAttribute('#q', 'placeholder');
  expect(ph || '').not.toMatch(TENANT_ZERO_VOCAB);
});

/* ═══ 4. The exclusion list that hid all of this ═══════════════════════════ */

test('agent.html is audited as an app surface, not excluded as a generated artefact', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-pages.js'), 'utf8');
  const m = src.match(/const BRAND_ASSET = \/\(([^)]*)\)\/i;/);
  expect(m, 'audit-pages.js should still define BRAND_ASSET').toBeTruthy();
  expect(m[1], 'agent.html is a live app page; excluding it meant no brand rule ever ran against it').not.toMatch(/agent/);
});
