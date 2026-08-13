// The shared market picker, against the REAL pages rather than a stand-in.
//
// The unit tests in region-context.spec.js prove the layer behaves; this
// proves the pages actually get it. Both matter: the slot is rendered by
// auth.js, so a page that loads auth.js differently, paints late, or throws
// early would quietly end up without a picker, which is the exact
// inconsistency this work exists to remove.
//
// Run: npx playwright test tests/region-pages.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

let server; let base;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

const BRAND = {
  ok: true,
  brand: {
    id: 'ws_a', slug: 'acme', name: 'Acme',
    palette: { primary: '#1F4E79', accent: '#C8102E', ink: '#1A1A1A', surface: '#FFFFFF' },
    typography: { heading: { family: 'Inter' }, body: { family: 'Inter' } }, voice: {},
    regions: [
      { code: 'US', currency: 'USD', symbol: '$', store_url: 'https://us.example' },
      { code: 'UK', currency: 'GBP', symbol: '£', store_url: 'https://uk.example' },
    ],
  },
  workspaces: [],
};

/* The pages that consume a market. Between them they cover every shape the
   picker has to survive: chips built in markup (calendar), chips built from
   data after a fetch (smart brain), a <select> (research), pages that
   consumed a market and never offered a control at all (ad-campaigns,
   assets, playbook, competitor-benchmarking), and a page that throws early
   because a CDN is unreachable (dashboard). */
const PAGES = [
  'calendar.html', 'dashboard.html', 'research.html', 'smart-brain.html',
  'ad-campaigns.html', 'assets.html', 'competitor-benchmarking.html',
  'knowledge-base.html', 'landing-pages.html',
  // Feature pages that were shipped without the shared shell at all, so they
  // had no nav, no brand tokens and no market control - only whatever their
  // own markup hardcoded.
  'playbook.html', 'connector-3d.html', 'landing-page-agent.html',
];

/* storefront-3d.html is deliberately excluded: it carries an explicit comment
   saying it is a public, sign-in-free demo and loads no auth.js by design.
   It is not part of the signed-in app, so it has no shell to put a picker in. */

for (const p of PAGES) {
  test(`${p} carries the shared market picker and follows it`, async ({ page }) => {
    await page.route('**/api/public-config**', (r) => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(BRAND),
    }));
    await page.goto(base + '/' + p, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RegionContext && window.RegionContext.loaded === true, null, { timeout: 20000 });

    // Present: the control is a property of the shell, not of whether this
    // page's author remembered one.
    await expect(page.locator('#lifecycle-nav .lnav-region .rgn-chip')).toHaveCount(2, { timeout: 10000 });

    // And live: the choice is recorded even when the brand landed late, which
    // it does on the pages that throw before their own scripts finish.
    await page.locator('#lifecycle-nav .lnav-region [data-region-set="UK"]').click();
    await expect.poll(() => page.evaluate(() => window.RegionContext.region), { timeout: 10000 }).toBe('UK');
  });
}
