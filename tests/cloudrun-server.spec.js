/**
 * The Cloud Run container serves the app as Vercel does (2026-10-24).
 * ---------------------------------------------------------------------------
 * The Cloud Build trigger on main ("cloudrun-lifecycle-os-git-asia-south2-...")
 * failed every push in its Build step (under a second): the repo had no
 * Dockerfile. The Dockerfile now runs scripts/cloudrun-server.js, which reads
 * vercel.json. Executed: the server on a real port, requested like a browser.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { createServer, sourceRegex } = require('../scripts/cloudrun-server.js');

let srv, base;
test.beforeAll(async () => {
  srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.afterAll(async () => { if (srv) { srv.closeAllConnections(); await new Promise((r) => srv.close(r)); } });

const get = (p, init) => fetch(base + p, Object.assign({ redirect: 'manual' }, init));

test('pages, friendly URLs, redirects and vercel.json headers are served as Vercel serves them', async () => {
  const home = await get('/');
  expect(home.status).toBe(200);
  expect(home.headers.get('content-type')).toMatch(/text\/html/);
  expect(await home.text()).toBe(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  // A rewrite: /onboarding is onboarding.html.
  const ob = await get('/onboarding');
  expect(ob.status).toBe(200);
  expect(await ob.text()).toBe(fs.readFileSync(path.join(ROOT, 'onboarding.html'), 'utf8'));
  // A parameter rewrite to a page.
  const doc = await get('/kb/brand/foundation');
  expect(doc.status).toBe(200);
  expect(await doc.text()).toBe(fs.readFileSync(path.join(ROOT, 'brand-doc.html'), 'utf8'));
  // A redirect.
  const r = await get('/ads-master');
  expect(r.status).toBe(307);
  expect(r.headers.get('location')).toBe('/data-analysis?tab=live-ads');
  // Headers from vercel.json.
  expect(home.headers.get('x-content-type-options')).toBe('nosniff');
  // An unknown page is the site's own 404.
  const nf = await get('/no-such-page-here');
  expect(nf.status).toBe(404);
  expect(await nf.text()).toBe(fs.readFileSync(path.join(ROOT, '404.html'), 'utf8'));
});

test('an /api route runs its handler with the Vercel request helpers (a rewrite carries its query)', async () => {
  const h = await get('/api/health');
  expect(h.status).toBe(200);
  const j = await h.json();
  expect(j).toMatchObject({ ok: true, build: 'lifecycle-os' });
  const posted = await get('/api/public-config?action=brand&op=defaults', { method: 'GET' });
  expect(posted.status).toBe(200);
  expect((await posted.json()).ok).not.toBe(false);
});

test('source, secrets and what .vercelignore keeps out are never served', async () => {
  for (const p of ['/api/_shared/llm.js', '/api/brain.js', '/.git/config', '/.env', '/tests/router-harness.js', '/node_modules/playwright-core/package.json', '/%2e%2e/etc/passwd', '/api/..%2f.git/config']) {
    const r = await get(p);
    expect([403, 404], p).toContain(r.status);
    const t = await r.text();
    expect(t, p).not.toMatch(/require\(|root:x:|\[core\]/);
  }
});

test('vercel.json sources compile like path-to-regexp', () => {
  expect(sourceRegex('/lp/:id').exec('/lp/abc').groups.id).toBe('abc');
  expect(sourceRegex('/:path*').exec('/a/b/c').groups.path).toBe('a/b/c');
  expect(sourceRegex('/(.*)\\.html').test('/x.html')).toBe(true);
  expect(sourceRegex('/(.*)\\.html').test('/xhtml')).toBe(false);
});

test('a scheduler on the project\'s vercel.app address reaches /api; its pages still go to the custom domain', async () => {
  // The custom domain sits behind a Cloudflare bot challenge that answers
  // GitHub's runners 403 "Just a moment...", so the scheduled workflows call
  // the project's own vercel.app address. Its pages still redirect to the
  // canonical domain; /api/ is answered where it was asked.
  const http = require('http');
  const port = srv.address().port;
  const ask = (p, host) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { host } }, (res) => { res.resume(); resolve({ status: res.statusCode, location: res.headers.location }); }).on('error', reject);
  });
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const hosts = cfg.redirects.filter((r) => r.has && /\.vercel\.app$/.test(r.has[0].value)).map((r) => r.has[0].value);
  expect(new Set(hosts).size).toBeGreaterThanOrEqual(4);
  for (const host of new Set(hosts)) {
    const page = await ask('/onboarding', host);
    expect(page.status, host).toBe(308);
    expect(page.location, host).toBe('https://lifecycle-os.anchit-tandon.com/onboarding');
    const root = await ask('/', host);
    expect(root.location, host).toBe('https://lifecycle-os.anchit-tandon.com/');
    const api = await ask('/api/health', host);
    expect(api.status, host).toBe(200);
  }
  // The workflows that call /api on a schedule use that address.
  for (const f of ['alerts.yml', 'daily-sync.yml', 'data-analysis-hourly.yml']) {
    const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8');
    expect(y, f).toContain('https://lifecycle-os-anchit-ai-hustle.vercel.app');
    expect(y, f).not.toMatch(/BASE="\$\{APP_BASE_URL/);
  }
  expect(sourceRegex('/:path((?!api/).*)').exec('/a/b').groups.path).toBe('a/b');
  expect(sourceRegex('/:path((?!api/).*)').test('/api/brain')).toBe(false);
});

test('the Dockerfile runs this server on $PORT', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  expect(df).toMatch(/^FROM node:24/m);
  expect(df).toMatch(/CMD \["node", "scripts\/cloudrun-server\.js"\]/);
});
