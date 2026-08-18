// Live Shopify Admin reads, ported from the single-tenant sibling.
//
// The port's whole risk is in one line: the original resolved the store from
// deployment env vars, because there was only ever one store. On a platform any
// brand onboards, that same code would serve whichever store the DEPLOYMENT
// happens to name — to every brand. These tests pin the scoping.
//
// Run: npx playwright test tests/shopify-scope.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const shopify = require(path.join(ROOT, 'api', '_shared', 'shopify-core.js'));

/* ═══ whose store ═════════════════════════════════════════════════════════ */

test('a workspace credential outranks the deployment env', () => {
  const before = process.env.SHOPIFY_STORE_DOMAIN;
  process.env.SHOPIFY_STORE_DOMAIN = 'platform-store.myshopify.com';
  process.env.SHOPIFY_ADMIN_TOKEN = 'platform-token';

  const mine = shopify.cfg('US', { shop_domain: 'my-brand.myshopify.com', admin_access_token: 'my-token' });
  expect(mine.domain).toBe('my-brand.myshopify.com');
  expect(mine.source).toBe('workspace');

  // ...and with none of its own, the deployment store is used and SAID to be.
  const fallback = shopify.cfg('US', {});
  expect(fallback.domain).toBe('platform-store.myshopify.com');
  expect(fallback.source).toBe('deployment');

  if (before === undefined) delete process.env.SHOPIFY_STORE_DOMAIN; else process.env.SHOPIFY_STORE_DOMAIN = before;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
});

test('the pinned store does not leak between concurrent brands', async () => {
  // A module-level "current store" would pass this test sequentially and fail
  // it here, which is exactly how a warm serverless runtime breaks tenancy.
  const seen = [];
  await Promise.all([
    shopify.withStore({ shop_domain: 'brand-a.myshopify.com', admin_access_token: 'a' }, async () => {
      await new Promise((r) => setTimeout(r, 15));
      seen.push(['a', shopify.cfg('US').domain]);
    }),
    shopify.withStore({ shop_domain: 'brand-b.myshopify.com', admin_access_token: 'b' }, async () => {
      seen.push(['b', shopify.cfg('US').domain]);
    }),
  ]);
  expect(seen.find((s) => s[0] === 'a')[1]).toBe('brand-a.myshopify.com');
  expect(seen.find((s) => s[0] === 'b')[1]).toBe('brand-b.myshopify.com');
});

test('outside any pinned scope there is no store at all', () => {
  const before = { d: process.env.SHOPIFY_STORE_DOMAIN, t: process.env.SHOPIFY_ADMIN_TOKEN };
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;
  expect(shopify.cfg('US').source).toBe('none');
  if (before.d) process.env.SHOPIFY_STORE_DOMAIN = before.d;
  if (before.t) process.env.SHOPIFY_ADMIN_TOKEN = before.t;
});

/* ═══ regions are the brand's, not a fixed list ═══════════════════════════ */

test('a market this platform has never heard of still works', () => {
  // The sibling hardcoded US/UK/IN because that was one company's footprint.
  expect(shopify.normMarket('usa')).toBe('US');
  expect(shopify.normMarket('India')).toBe('IN');
  expect(shopify.normMarket('GB')).toBe('UK');
  for (const m of ['AE', 'SG', 'BR', 'ZA']) expect(shopify.normMarket(m)).toBe(m);
  // ...and nothing injectable survives into an env var name.
  expect(shopify.normMarket('US; rm -rf /')).toMatch(/^[A-Z0-9_]*$/);
});

/* ═══ it cannot write, and it cannot invent ═══════════════════════════════ */

test('no mutating verb is implemented anywhere in the module', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'shopify-core.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  expect(src).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
  // And every call goes through the guard that throws on a write verb.
  expect(src).toMatch(/guardedFetch/);
  expect(src).not.toMatch(/\bfetch\(/);       // the raw fetch would bypass the guard
});

test('with no credential it returns the request it would have made, not a number', async () => {
  const before = { d: process.env.SHOPIFY_STORE_DOMAIN, t: process.env.SHOPIFY_ADMIN_TOKEN };
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;

  const out = await shopify.dispatch('summary', { market: 'US' });
  expect(out.connected).not.toBe(true);
  expect(out.would_request.method).toBe('GET');
  expect(out.would_request.url).toContain('/admin/api/');
  // A store figure invented to fill an empty dashboard is the exact fabrication
  // the campaign spec bans.
  expect(out.revenue).toBeUndefined();
  expect(out.orders_count).toBeUndefined();

  if (before.d) process.env.SHOPIFY_STORE_DOMAIN = before.d;
  if (before.t) process.env.SHOPIFY_ADMIN_TOKEN = before.t;
});

test('the token is never returned in the would_request envelope', async () => {
  const out = await shopify.dispatch('shop', { market: 'US', credentials: { shop_domain: 's.myshopify.com', admin_access_token: 'SECRET-token' } });
  expect(JSON.stringify(out)).not.toContain('SECRET-token');
});

/* ═══ the operator is told something they can act on ══════════════════════ */

test('the blocker points a brand operator at their own Connections page', () => {
  const before = { live: process.env.LIVE_CONNECTORS, d: process.env.SHOPIFY_STORE_DOMAIN };
  process.env.LIVE_CONNECTORS = 'on';
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_ADMIN_TOKEN;

  const out = shopify.status('US');
  // The sibling said "set it in Vercel env", which a brand operator using this
  // platform cannot do — they do not have the deployment.
  expect(out.blocker).toMatch(/Connections page/i);
  expect(out.blocker).toMatch(/read-scoped|read_orders/i);

  if (before.live === undefined) delete process.env.LIVE_CONNECTORS; else process.env.LIVE_CONNECTORS = before.live;
  if (before.d) process.env.SHOPIFY_STORE_DOMAIN = before.d;
});

test('the kill switch and the missing credential are distinguishable', () => {
  const before = process.env.LIVE_CONNECTORS;
  delete process.env.LIVE_CONNECTORS;
  // They need different fixes, so they must not share one message.
  expect(shopify.status('US').blocker).toMatch(/LIVE_CONNECTORS/);
  if (before !== undefined) process.env.LIVE_CONNECTORS = before;
});

/* ═══ the registry now tells the truth about it ═══════════════════════════ */

test('the connections registry no longer calls Shopify unwired', () => {
  const conn = require(path.join(ROOT, 'api', '_shared', 'workspace-connections-core.js'));
  const shop = conn.PROVIDERS.find((p) => p.id === 'shopify');
  expect(shop.wired).toBe(true);
  expect(shop.wired_note).toMatch(/Admin reads/i);
});
