'use strict';
/**
 * tests/lib/catalog-fixture-stores.js — real stores on 127.0.0.1 for the
 * catalogue importer.
 * ---------------------------------------------------------------------------
 * One http.Server on 127.0.0.1 serves every fixture store, told apart by the
 * host the request was made for. The importer under test runs UNMODIFIED:
 * it calls `fetch('https://bigshop.example/products.json?...')`, and
 * `routeFetch()` (installed on global.fetch, or handed to fake-supabase's
 * `db.route`) carries that request over a real socket to the fixture server
 * and hands back a real `Response` whose `url` is the URL that was asked for.
 * Redirects are followed exactly as fetch would follow them (or returned as-is
 * for `redirect:'manual'`), an abort signal aborts the real socket, gzip bytes
 * are gzip bytes, and Retry-After is a real header. `dns.lookup` answers the
 * fixture hosts with a public documentation address so the SSRF guard
 * (assertPublicUrl) runs exactly as it runs in production.
 *
 * The stores (every number below is the TRUTH the importer is measured against):
 *
 *   bigshop.example     Shopify, 2,600 products on /products.json at limit=250
 *                       (11 pages; page 4 is SHORT by one product that is not
 *                       on the online-store channel, as Shopify does), 3
 *                       variants and 3 images each, compare-at prices, the
 *                       storefront currency declared as USD on its pages, a
 *                       sitemap index naming two product sitemaps. Its home
 *                       page links ONE product.
 *   oneshop.example     Shopify whose /products.json is switched off (404).
 *                       Home page links ONE product; 60 products are declared
 *                       only in its sitemap (index -> products sitemap), each
 *                       PDP carrying JSON-LD Product + Offer.
 *   wooshop.example     WooCommerce. No feed. robots.txt names a sitemap
 *                       index whose product children are GZIPPED
 *                       (product-sitemap1.xml.gz, product-sitemap2.xml.gz),
 *                       300 products, JSON-LD in three real shapes (a bare
 *                       Product with an Offer, an @graph with an
 *                       AggregateOffer, a ProductGroup with hasVariant).
 *                       12 products state no price at all.
 *   regional.example    Shopify with a UK store at /en-gb/: hreflang on the
 *                       home page, 40 products, USD at the root and GBP under
 *                       /en-gb/ (different numbers, as a market price list is).
 *   robots.example      40 products in the sitemap, robots.txt disallows
 *                       /products/private-* (5 of them, wildcard rule) and the
 *                       home page LINKS one of those.
 *   slowshop.example    150 products, each PDP answers after a delay.
 *   ratelimit.example   Shopify, 600 products; every page of /products.json
 *                       first answers 429 with Retry-After: 1.
 *
 * NOT a test. Required by tests/catalog-import-complete.spec.js.
 */
const http = require('http');
const zlib = require('zlib');
const dns = require('dns');

const NATIVE_FETCH = global.fetch;   // captured before anything patches it
const PUBLIC_ADDR = '93.184.216.34';   // documentation-range address, never contacted
const pad = (n, w) => String(n).padStart(w || 4, '0');

/* ── product truth ─────────────────────────────────────────────────────── */

function shopifyProduct(i, { currencyRate = 1, priceBase = 40 } = {}) {
  const handle = `kick-${pad(i)}`;
  const price = ((priceBase + (i % 37)) * currencyRate).toFixed(2);
  const was = ((priceBase + 20 + (i % 37)) * currencyRate).toFixed(2);
  return {
    id: 7000000 + i,
    title: `Kick ${pad(i)}`,
    handle,
    body_html: `<p>Hand-painted pair number ${i}.</p>`,
    product_type: i % 2 ? 'Sneakers' : 'Slides',
    tags: ['custom', `drop-${i % 5}`],
    variants: [0, 1, 2].map((v) => ({
      id: 9000000 + i * 10 + v,
      title: `UK ${7 + v}`,
      sku: `K${pad(i)}-${7 + v}`,
      available: v !== 2,
      price,
      compare_at_price: i % 3 === 0 ? was : null,
    })),
    images: [0, 1, 2].map((v) => ({ id: 5000000 + i * 10 + v, position: v + 1, src: `https://cdn.shopify.com/s/files/1/0001/${handle}-${v + 1}.jpg`, width: 1200, height: 1200 })),
    options: [{ name: 'Size', position: 1, values: ['UK 7', 'UK 8', 'UK 9'] }],
  };
}

function jsonLdPdp(host, p, shape) {
  const url = `https://${host}${p.path}`;
  let node;
  if (shape === 'graph') {
    node = { '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebPage', name: p.title },
      { '@type': 'Product', name: p.title, sku: p.sku, url, image: p.images, description: p.description,
        offers: p.price == null ? undefined : { '@type': 'AggregateOffer', lowPrice: p.price, highPrice: p.high || p.price, priceCurrency: p.currency, offerCount: 2 } },
    ] };
  } else if (shape === 'group') {
    node = { '@context': 'https://schema.org', '@type': 'ProductGroup', name: p.title, productGroupID: p.sku, url, image: p.images, description: p.description,
      hasVariant: [0, 1].map((v) => ({ '@type': 'Product', name: `${p.title} - ${v ? 'Large' : 'Small'}`, sku: `${p.sku}-${v ? 'L' : 'S'}`,
        offers: p.price == null ? undefined : { '@type': 'Offer', price: (Number(p.price) + v * 5).toFixed(2), priceCurrency: p.currency, availability: 'https://schema.org/InStock' } })) };
  } else {
    node = { '@context': 'https://schema.org', '@type': 'Product', name: p.title, sku: p.sku, url, image: p.images, description: p.description,
      offers: p.price == null ? undefined : { '@type': 'Offer', price: p.price, priceCurrency: p.currency, availability: 'https://schema.org/InStock' } };
  }
  return `<!doctype html><html><head><title>${p.title}</title>
<script type="application/ld+json">${JSON.stringify(node)}</script></head>
<body><main><h1>${p.title}</h1><a href="/">Home</a></main></body></html>`;
}

const urlset = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${u}</loc></url>`).join('\n')}\n</urlset>`;
const sitemapIndex = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join('\n')}\n</sitemapindex>`;

const SHOPIFY_HEAD = (currency) => `<meta name="generator" content="Shopify"><script>var Shopify = Shopify || {};
Shopify.shop = "fixture.myshopify.com";
Shopify.currency = {"active":"${currency}","rate":"1.0"};</script>
<script src="https://cdn.shopify.com/s/files/1/theme.js"></script>`;

/* ── the stores ─────────────────────────────────────────────────────────── */

function buildStores() {
  const S = {};

  // bigshop: 2,600 products; the product at index 760 is off the online-store
  // channel, so page 4 (products 751..1000) is one short.
  {
    const host = 'bigshop.example';
    const all = [];
    for (let i = 1; i <= 2601; i++) all.push(shopifyProduct(i));
    const hidden = new Set([760]);
    let listed = all.filter((p) => !hidden.has(p.id - 7000000));
    // Paged as Shopify pages: by position in the FULL list, then filtered.
    const pageOf = (page) => all.slice((page - 1) * 250, page * 250).filter((p) => !hidden.has(p.id - 7000000));
    S[host] = {
      truth: { products: listed.length, variants: listed.length * 3, images: listed.length * 3, currency: 'USD' },
      /** The store stops listing these products (they leave the feed and the sitemap). */
      drop(indexes) { for (const i of indexes) hidden.add(i); listed = all.filter((p) => !hidden.has(p.id - 7000000)); },
      undrop() { hidden.clear(); hidden.add(760); listed = all.filter((p) => !hidden.has(p.id - 7000000)); },
      handler(req, url) {
        if (url.pathname === '/products.json') {
          const page = Math.max(1, Number(url.searchParams.get('page') || 1));
          const limit = Math.min(250, Number(url.searchParams.get('limit') || 30));
          if (limit !== 250) return { status: 200, type: 'application/json', body: JSON.stringify({ products: all.slice(0, limit) }) };
          return { status: 200, type: 'application/json', body: JSON.stringify({ products: pageOf(page) }) };
        }
        if (url.pathname === '/robots.txt') return { status: 200, type: 'text/plain', body: `Sitemap: https://${host}/sitemap.xml\n\nUser-agent: *\nDisallow: /cart\nDisallow: /checkout\n` };
        if (url.pathname === '/sitemap.xml') return { status: 200, type: 'application/xml', body: sitemapIndex([`https://${host}/sitemap_products_1.xml?from=1&to=2000`, `https://${host}/sitemap_products_2.xml?from=2001&to=2601`, `https://${host}/sitemap_pages_1.xml`]) };
        if (url.pathname === '/sitemap_products_1.xml') return { status: 200, type: 'application/xml', body: urlset(listed.slice(0, 1999).map((p) => `https://${host}/products/${p.handle}`)) };
        if (url.pathname === '/sitemap_products_2.xml') return { status: 200, type: 'application/xml', body: urlset(listed.slice(1999).map((p) => `https://${host}/products/${p.handle}`)) };
        if (url.pathname === '/sitemap_pages_1.xml') return { status: 200, type: 'application/xml', body: urlset([`https://${host}/pages/about`]) };
        if (url.pathname === '/') return { status: 200, type: 'text/html; charset=utf-8', body: `<!doctype html><html><head><title>Big Shop</title>${SHOPIFY_HEAD('USD')}</head><body class="shopify-section"><a href="/products/kick-0001">Kick 0001</a></body></html>` };
        const m = /^\/products\/(kick-\d+)$/.exec(url.pathname);
        if (m) { const p = listed.find((x) => x.handle === m[1]); if (p) return { status: 200, type: 'text/html', body: `<!doctype html><html><head><title>${p.title}</title>${SHOPIFY_HEAD('USD')}</head><body></body></html>` }; }
        return null;
      },
    };
  }

  // oneshop: Shopify with the feed switched off.
  {
    const host = 'oneshop.example';
    const prods = [];
    for (let i = 1; i <= 60; i++) prods.push({ path: `/products/tee-${pad(i, 3)}`, title: `Tee ${pad(i, 3)}`, sku: `T${pad(i, 3)}`, price: (20 + i).toFixed(2), currency: 'USD', images: [`https://${host}/cdn/shop/files/tee-${i}-a.jpg`, `https://${host}/cdn/shop/files/tee-${i}-b.jpg`], description: `Tee ${i}.` });
    S[host] = {
      truth: { products: 60, images: 120, currency: 'USD' },
      handler(req, url) {
        if (url.pathname === '/products.json') return { status: 404, type: 'text/html', body: '<!doctype html><title>Not found</title>' };
        if (url.pathname === '/robots.txt') return { status: 200, type: 'text/plain', body: `User-agent: *\nDisallow: /cart\nSitemap: https://${host}/sitemap.xml\n` };
        if (url.pathname === '/sitemap.xml') return { status: 200, type: 'application/xml', body: sitemapIndex([`https://${host}/sitemap_products_1.xml`, `https://${host}/sitemap_pages_1.xml`]) };
        if (url.pathname === '/sitemap_products_1.xml') return { status: 200, type: 'application/xml; charset=utf-8', body: urlset(prods.map((p) => `https://${host}${p.path}`)) };
        if (url.pathname === '/sitemap_pages_1.xml') return { status: 200, type: 'application/xml', body: urlset([`https://${host}/pages/about`]) };
        if (url.pathname === '/') return { status: 200, type: 'text/html', body: `<!doctype html><html><head><title>One Shop</title>${SHOPIFY_HEAD('USD')}</head><body><a href="${prods[0].path}">${prods[0].title}</a></body></html>` };
        if (url.pathname === '/pages/about') return { status: 200, type: 'text/html', body: '<!doctype html><title>About</title><p>About us</p>' };
        const p = prods.find((x) => x.path === url.pathname);
        if (p) return { status: 200, type: 'text/html', body: jsonLdPdp(host, p, 'plain') };
        return null;
      },
    };
  }

  // wooshop: gzipped child sitemaps, three JSON-LD shapes, 12 unpriced.
  {
    const host = 'wooshop.example';
    const prods = [];
    for (let i = 1; i <= 300; i++) {
      const unpriced = i % 25 === 0;           // 12 of 300
      prods.push({ path: `/product/mug-${pad(i, 3)}/`, title: `Mug ${pad(i, 3)}`, sku: `M${pad(i, 3)}`, price: unpriced ? null : (10 + (i % 9)).toFixed(2), high: unpriced ? null : (14 + (i % 9)).toFixed(2), currency: 'EUR',
        images: [`https://${host}/wp-content/uploads/mug-${i}.jpg`, `https://${host}/wp-content/uploads/mug-${i}-side.jpg`], description: `Mug ${i}.`, shape: ['plain', 'graph', 'group'][i % 3] });
    }
    const gz = (s) => zlib.gzipSync(Buffer.from(s));
    S[host] = {
      truth: { products: 300, unpriced: 12, currency: 'EUR' },
      handler(req, url) {
        if (url.pathname === '/products.json') return { status: 404, type: 'text/html', body: '<!doctype html><title>Page not found</title>' };
        if (url.pathname === '/robots.txt') return { status: 200, type: 'text/plain', body: `User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: https://${host}/sitemap_index.xml\n` };
        if (url.pathname === '/sitemap_index.xml') return { status: 200, type: 'text/xml', body: sitemapIndex([`https://${host}/page-sitemap.xml`, `https://${host}/product-sitemap1.xml.gz`, `https://${host}/product-sitemap2.xml.gz`]) };
        if (url.pathname === '/page-sitemap.xml') return { status: 200, type: 'text/xml', body: urlset([`https://${host}/`, `https://${host}/about/`]) };
        if (url.pathname === '/product-sitemap1.xml.gz') return { status: 200, type: 'application/x-gzip', raw: gz(urlset(prods.slice(0, 150).map((p) => `https://${host}${p.path}`))) };
        if (url.pathname === '/product-sitemap2.xml.gz') return { status: 200, type: 'application/x-gzip', raw: gz(urlset(prods.slice(150).map((p) => `https://${host}${p.path}`))) };
        if (url.pathname === '/') return { status: 200, type: 'text/html', body: `<!doctype html><html><head><title>Woo Shop</title><meta name="generator" content="WooCommerce 8.2.1"></head><body class="woocommerce"><a href="${prods[0].path}">a</a><a href="${prods[1].path}">b</a><a href="${prods[2].path}">c</a><a href="/about/">About</a></body></html>` };
        if (url.pathname === '/about/') return { status: 200, type: 'text/html', body: '<!doctype html><title>About</title>' };
        const p = prods.find((x) => x.path === url.pathname);
        if (p) return { status: 200, type: 'text/html', body: jsonLdPdp(host, p, p.shape) };
        return null;
      },
    };
  }

  // regional: USD at the root, GBP under /en-gb/.
  {
    const host = 'regional.example';
    const us = []; const gb = [];
    for (let i = 1; i <= 40; i++) { us.push(shopifyProduct(i, { priceBase: 50 })); gb.push(shopifyProduct(i, { priceBase: 40 })); }
    const home = (cur, prefix) => `<!doctype html><html lang="${prefix ? 'en-GB' : 'en-US'}"><head><title>Regional</title>${SHOPIFY_HEAD(cur)}
<link rel="alternate" hreflang="en-us" href="https://${host}/">
<link rel="alternate" hreflang="en-gb" href="https://${host}/en-gb">
<link rel="alternate" hreflang="x-default" href="https://${host}/"></head><body></body></html>`;
    S[host] = {
      truth: { products: 40, us_currency: 'USD', uk_currency: 'GBP', uk_first_price: gb[0].variants[0].price, us_first_price: us[0].variants[0].price },
      handler(req, url) {
        const page = Math.max(1, Number(url.searchParams.get('page') || 1));
        if (url.pathname === '/products.json') return { status: 200, type: 'application/json', body: JSON.stringify({ products: page === 1 ? us : [] }) };
        if (url.pathname === '/en-gb/products.json') return { status: 200, type: 'application/json', body: JSON.stringify({ products: page === 1 ? gb : [] }) };
        if (url.pathname === '/robots.txt') return { status: 200, type: 'text/plain', body: 'User-agent: *\nDisallow: /cart\n' };
        if (url.pathname === '/') return { status: 200, type: 'text/html', body: home('USD', '') };
        if (url.pathname === '/en-gb' || url.pathname === '/en-gb/') return { status: 200, type: 'text/html', body: home('GBP', '/en-gb') };
        return null;
      },
    };
  }

  // robots: 5 of 40 disallowed by a wildcard rule; the home page links one.
  {
    const host = 'robots.example';
    const prods = [];
    for (let i = 1; i <= 40; i++) {
      const priv = i <= 5;
      prods.push({ path: priv ? `/products/private-${i}` : `/products/open-${i}`, title: priv ? `Private ${i}` : `Open ${i}`, sku: `R${i}`, price: '30.00', currency: 'GBP', images: [`https://${host}/img/${i}.jpg`], description: `${i}` });
    }
    S[host] = {
      truth: { products: 35, disallowed: 5 },
      robotsStatus: 200,
      handler(req, url) {
        if (url.pathname === '/products.json') return { status: 404, type: 'text/html', body: 'nope' };
        if (url.pathname === '/robots.txt' && this.robotsStatus !== 200) return { status: this.robotsStatus, type: 'text/plain', body: 'unavailable' };
        if (url.pathname === '/robots.txt') return { status: 200, type: 'text/plain', body: `Sitemap: https://${host}/sitemap.xml\nUser-agent: *\nDisallow: /products/private-*\nDisallow: /search\n` };
        if (url.pathname === '/sitemap.xml') return { status: 200, type: 'application/xml', body: urlset(prods.map((p) => `https://${host}${p.path}`)) };
        if (url.pathname === '/') return { status: 200, type: 'text/html', body: `<!doctype html><html><head><title>Robots</title></head><body><a href="/products/private-1">p</a><a href="/products/open-6">o</a></body></html>` };
        const p = prods.find((x) => x.path === url.pathname);
        if (p) return { status: 200, type: 'text/html', body: jsonLdPdp(host, p, 'plain') };
        return null;
      },
    };
  }

  // slowshop: every PDP takes `delayMs`.
  {
    const host = 'slowshop.example';
    const prods = [];
    for (let i = 1; i <= 150; i++) prods.push({ path: `/item/${i}`, title: `Slow ${i}`, sku: `S${i}`, price: '12.00', currency: 'USD', images: [`https://${host}/img/${i}.jpg`], description: `${i}` });
    S[host] = {
      truth: { products: 150 },
      delayMs: 300,
      handler(req, url) {
        if (url.pathname === '/products.json') return { status: 404, type: 'text/html', body: 'no' };
        if (url.pathname === '/robots.txt') return { status: 200, type: 'text/plain', body: 'User-agent: *\nDisallow:\n' };
        if (url.pathname === '/sitemap.xml') return { status: 200, type: 'application/xml', body: urlset(prods.map((p) => `https://${host}${p.path}`)) };
        if (url.pathname === '/') return { status: 200, type: 'text/html', body: '<!doctype html><title>Slow</title><a href="/item/1">1</a>' };
        const p = prods.find((x) => x.path === url.pathname);
        if (p) return { status: 200, type: 'text/html', body: jsonLdPdp(host, p, 'plain'), delay: this.delayMs };
        return null;
      },
    };
  }

  // ratelimit: each feed page answers 429 Retry-After: 1 the first time.
  {
    const host = 'ratelimit.example';
    const all = [];
    for (let i = 1; i <= 600; i++) all.push(shopifyProduct(i));
    const tried = new Set();
    S[host] = {
      truth: { products: 600 },
      tried,
      retryAfter: '1',
      handler(req, url) {
        if (url.pathname === '/products.json') {
          const page = Math.max(1, Number(url.searchParams.get('page') || 1));
          if (!tried.has(page)) { tried.add(page); return { status: 429, type: 'text/plain', body: 'Too Many Requests', headers: { 'retry-after': this.retryAfter } }; }
          return { status: 200, type: 'application/json', body: JSON.stringify({ products: all.slice((page - 1) * 250, page * 250) }) };
        }
        if (url.pathname === '/robots.txt') return { status: 200, type: 'text/plain', body: 'User-agent: *\nDisallow: /cart\n' };
        if (url.pathname === '/') return { status: 200, type: 'text/html', body: `<!doctype html><html><head>${SHOPIFY_HEAD('USD')}</head><body></body></html>` };
        return null;
      },
    };
  }
  return S;
}

/* ── the server + the fetch that reaches it ─────────────────────────────── */

async function startStores() {
  const stores = buildStores();
  const hits = {};   // host -> [path+search]
  const server = http.createServer((req, res) => {
    const host = String(req.headers['x-fixture-host'] || '').toLowerCase();
    const url = new URL(req.url, `https://${host}`);
    (hits[host] = hits[host] || []).push({ path: url.pathname + url.search, ua: String(req.headers['user-agent'] || ''), at: Date.now() });
    const store = stores[host];
    const out = store && store.handler.call(store, req, url);
    const send = () => {
      if (!out) { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Not found</title>'); return; }
      res.writeHead(out.status, Object.assign({ 'content-type': out.type }, out.headers || {}));
      res.end(out.raw || out.body || '');
    };
    if (out && out.delay) setTimeout(send, out.delay); else send();
  });
  server.keepAliveTimeout = 1;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  /** A fetch for the fixture hosts, over the real socket. */
  async function routeFetch(input, init) {
    const asked = String(input && input.url ? input.url : input);
    const u = new URL(asked);
    const o = init || {};
    const headers = {};
    const h = o.headers || {};
    if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { headers[k] = v; });
    else Object.assign(headers, h);
    headers['x-fixture-host'] = u.hostname;
    const r = await NATIVE_FETCH(`http://127.0.0.1:${port}${u.pathname}${u.search}`, { method: o.method || 'GET', headers, signal: o.signal, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location') && (o.redirect || 'follow') === 'follow') {
      return routeFetch(new URL(r.headers.get('location'), asked).toString(), o);
    }
    const body = Buffer.from(await r.arrayBuffer());
    const out = new Response(r.status === 204 ? null : body, { status: r.status, headers: r.headers });
    Object.defineProperty(out, 'url', { value: asked });
    return out;
  }
  const isFixture = (url) => { try { return /\.example$/i.test(new URL(String(url && url.url ? url.url : url)).hostname); } catch (_) { return false; } };

  let realFetch = null, realLookup = null;
  return {
    port, stores, hits, routeFetch, isFixture,
    /** Patch global.fetch (fixture hosts only; anything else throws) and dns. */
    install({ passthrough } = {}) {
      realFetch = global.fetch;
      global.fetch = async (input, init) => {
        if (isFixture(input)) return routeFetch(input, init);
        if (passthrough) return passthrough(input, init);
        throw new Error('a request left the fixture world: ' + String(input && input.url ? input.url : input));
      };
      this.installDns();
      return this;
    },
    installDns() {
      if (realLookup) return;
      realLookup = dns.promises.lookup;
      dns.promises.lookup = async (host, opts) => (/\.example$/i.test(String(host)) ? ((opts && opts.all) ? [{ address: PUBLIC_ADDR, family: 4 }] : { address: PUBLIC_ADDR, family: 4 }) : realLookup(host, opts));
    },
    restore() {
      if (realFetch) global.fetch = realFetch;
      if (realLookup) dns.promises.lookup = realLookup;
      realFetch = null; realLookup = null;
    },
    reset() {
      for (const k of Object.keys(hits)) delete hits[k];
      stores['ratelimit.example'].tried.clear();
      stores['ratelimit.example'].retryAfter = '1';
      stores['robots.example'].robotsStatus = 200;
      stores['bigshop.example'].undrop();
    },
    close() { return new Promise((r) => server.close(() => r())); },
  };
}

module.exports = { startStores, PUBLIC_ADDR };
