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
 * Added 2026-10-11, modelled on the two live records (this container cannot
 * reach either site, so these are the DOCUMENTED shapes - sitemaps.org index
 * -> per-section product sitemaps, gzipped children, nested indexes - and the
 * shapes the live coverage implies):
 *
 *   bigmarket.example   Nykaa-like. No platform declared anywhere; its
 *                       /products.json ALWAYS answers 429 with no Retry-After
 *                       (the live "feed page 1, 4 waits, 7 s"). robots.txt
 *                       names a sitemap index on the site, one on its own sibling
 *                       domain bigmarket.in, and one on ANOTHER site. Index -> a
 *                       category sitemap, a product_cat-sitemap.xml (category
 *                       pages, not products), and a PRODUCT index -> two
 *                       further indexes (a/, b/) -> 70 urlsets whose own names
 *                       ("p/a/7.xml.gz", "p/b/3.xml") do not say "product": 1,050
 *                       products, 15 each. b/3.xml answers 429 Retry-After: 1
 *                       the first time. bigmarket.in's products-featured.xml
 *                       lists 21 products that are listed elsewhere too. 10
 *                       product pages are application shells (no JSON-LD until
 *                       JavaScript runs) and 5 are Next.js pages whose
 *                       __NEXT_DATA__ states title, price, currency and image.
 *                       Prices in INR. `smDelayMs` slows every sitemap.
 *   lensshop.example    Lenskart-like. robots.txt names /sitemap.xml, a
 *                       <urlset> (NOT a <sitemapindex>) whose 21 <loc>s are
 *                       CHILD SITEMAPS (sitemap-NN.xml, every third gzipped):
 *                       the live "21 URLs, 21 pages that declare no product".
 *                       2,430 products behind them, JSON-LD on every page,
 *                       each answering after `delayMs`.
 *   emptyshop.example   No robots Sitemap line; /sitemap.xml answers 200 with
 *                       an HTML bot-challenge page; the home page links five
 *                       pages that declare no product.
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
  // bigmarket: Nykaa-like (see the header).
  {
    const host = 'bigmarket.example';
    const sub = 'bigmarket.in';   // the same brand under another suffix (brand-coherence sameBrand)
    const prods = [];
    for (let i = 1; i <= 1050; i++) prods.push({ path: `/p/item-${pad(i)}`, title: `Lipstick ${pad(i)}`, sku: `NY${pad(i)}`, price: (299 + (i % 50)).toFixed(2), currency: 'INR', images: [`https://${host}/media/item-${i}.jpg`], description: `Item ${i}.`, shell: i % 105 === 1, next: i % 210 === 50 });
    const gz = (x) => zlib.gzipSync(Buffer.from(x));
    const child = (side, n) => { const base = (side === 'a' ? 0 : 35) + (n - 1); return prods.slice(base * 15, base * 15 + 15); };
    const tried = new Set();
    S[host] = {
      truth: { products: 1050, shells: prods.filter((p) => p.shell).length, next: prods.filter((p) => p.next).length, currency: 'INR' },
      smDelayMs: 0,
      longRetry: 0,
      tried,
      handler(req, url) {
        const sm = (o) => Object.assign(o, this.smDelayMs ? { delay: this.smDelayMs } : {});
        if (url.pathname === '/products.json') return { status: 429, type: 'text/plain', body: 'Too Many Requests' };
        if (url.pathname === '/robots.txt') return { status: 200, type: 'text/plain', body: `User-agent: *
Disallow: /cart
Sitemap: https://${host}/sitemap-index.xml
Sitemap: https://${sub}/extra/products-featured.xml
Sitemap: https://othermarket.example/sitemap-products.xml
` };
        if (url.pathname === '/sitemap-index.xml') return sm({ status: 200, type: 'application/xml', body: sitemapIndex([`https://${host}/sitemaps/categories.xml`, `https://${host}/sitemaps/product_cat-sitemap.xml`, `https://${host}/sitemaps/products/index.xml`]) });
        if (url.pathname === '/sitemaps/categories.xml') return sm({ status: 200, type: 'application/xml', body: urlset(Array.from({ length: 30 }, (_, k) => `https://${host}/c/cat-${k}`)) });
        if (url.pathname === '/sitemaps/product_cat-sitemap.xml') return sm({ status: 200, type: 'application/xml', body: urlset(Array.from({ length: 20 }, (_, k) => `https://${host}/c/lips-${k}`)) });
        if (url.pathname === '/sitemaps/products/index.xml') return sm({ status: 200, type: 'application/xml', body: sitemapIndex([`https://${host}/sitemaps/p/a/index.xml`, `https://${host}/sitemaps/p/b/index.xml`]) });
        if (url.pathname === '/sitemaps/p/a/index.xml') return sm({ status: 200, type: 'application/xml', body: sitemapIndex(Array.from({ length: 35 }, (_, k) => `https://${host}/sitemaps/p/a/${k + 1}.xml.gz`)) });
        if (url.pathname === '/sitemaps/p/b/index.xml') return sm({ status: 200, type: 'application/xml', body: sitemapIndex(Array.from({ length: 35 }, (_, k) => `https://${host}/sitemaps/p/b/${k + 1}.xml`)) });
        let m = /^\/sitemaps\/p\/a\/(\d+)\.xml\.gz$/.exec(url.pathname);
        if (m) return sm({ status: 200, type: 'application/x-gzip', raw: gz(urlset(child('a', Number(m[1])).map((p) => `https://${host}${p.path}`))) });
        m = /^\/sitemaps\/p\/b\/(\d+)\.xml$/.exec(url.pathname);
        if (m) {
          if (m[1] === '3' && !tried.has('b3')) { tried.add('b3'); return { status: 429, type: 'text/plain', body: 'slow down', headers: { 'retry-after': '1' } }; }
          if (m[1] === '7' && this.longRetry && !tried.has('b7')) { tried.add('b7'); return { status: 429, type: 'text/plain', body: 'slow down', headers: { 'retry-after': String(this.longRetry) } }; }
          return sm({ status: 200, type: 'application/xml', body: urlset(child('b', Number(m[1])).map((p) => `https://${host}${p.path}`)) });
        }
        if (url.pathname === '/') return { status: 200, type: 'text/html', body: '<!doctype html><html><head><title>Big Market</title></head><body><a href="/p/item-0002">x</a></body></html>' };
        const p = prods.find((x) => x.path === url.pathname);
        if (p && p.shell) return { status: 200, type: 'text/html', body: `<!doctype html><html><head><title>Big Market</title><script src="/static/app.js" defer></script></head><body><div id="root"></div></body></html>` };
        if (p && p.next) {
          const data = { props: { pageProps: { recs: [{ name: 'Other Product', price: 1, currency: 'INR', imageUrl: `https://${host}/media/other.jpg` }], product: { productName: p.title, sellingPrice: Number(p.price), currencyCode: 'INR', imageUrl: p.images[0], sku: p.sku } } } };
          return { status: 200, type: 'text/html', body: `<!doctype html><html><head><title>${p.title} | Big Market</title></head><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>` };
        }
        if (p) return { status: 200, type: 'text/html', body: jsonLdPdp(host, p, 'plain') };
        return null;
      },
    };
    S['othermarket.example'] = { handler() { return { status: 200, type: 'application/xml', body: urlset([`https://othermarket.example/p/x`]) }; } };
    S[sub] = {
      handler(req, url) {
        if (url.pathname === '/extra/products-featured.xml') return { status: 200, type: 'application/xml', body: urlset(prods.slice(100, 121).map((p) => `https://${host}${p.path}`)) };
        return null;
      },
    };
  }

  // lensshop: Lenskart-like - a <urlset> whose 21 entries are child sitemaps.
  {
    const host = 'lensshop.example';
    const prods = [];
    for (let i = 1; i <= 2430; i++) prods.push({ path: `/frames/frame-${pad(i)}.html`, title: `Frame ${pad(i)}`, sku: `LK${pad(i)}`, price: (999 + (i % 30) * 100).toFixed(2), currency: 'INR', images: [`https://${host}/img/frame-${i}.jpg`], description: `Frame ${i}.` });
    const kids = Array.from({ length: 21 }, (_, k) => `https://${host}/sitemap/sitemap-${pad(k + 1, 2)}.xml${k % 3 === 2 ? '.gz' : ''}`);
    const gz = (x) => zlib.gzipSync(Buffer.from(x));
    S[host] = {
      truth: { products: 2430, children: 21 },
      delayMs: 0,
      handler(req, url) {
        if (url.pathname === '/products.json') return { status: 404, type: 'text/html', body: '<!doctype html><title>Not found</title><p>Page not found</p>' };
        if (url.pathname === '/robots.txt') return { status: 200, type: 'text/plain', body: `User-agent: *
Disallow: /checkout
Sitemap: https://${host}/sitemap.xml
` };
        if (url.pathname === '/sitemap.xml') return { status: 200, type: 'application/xml', body: urlset(kids) };
        const m = /^\/sitemap\/sitemap-(\d+)\.xml(\.gz)?$/.exec(url.pathname);
        if (m) {
          const k = Number(m[1]) - 1;
          const body = urlset(prods.slice(k * 116, k === 20 ? 2430 : k * 116 + 116).map((p) => `https://${host}${p.path}`));
          return m[2] ? { status: 200, type: 'application/octet-stream', raw: gz(body) } : { status: 200, type: 'text/xml', body };
        }
        if (url.pathname === '/') return { status: 200, type: 'text/html', body: '<!doctype html><html><head><title>Lens Shop</title></head><body><a href="/frames/frame-0001.html">Frame</a></body></html>' };
        const p = prods.find((x) => x.path === url.pathname);
        if (p) return { status: 200, type: 'text/html', body: jsonLdPdp(host, p, 'plain'), delay: this.delayMs };
        return null;
      },
    };
  }

  // emptyshop: a 200 HTML challenge at /sitemap.xml and pages with no product.
  {
    const host = 'emptyshop.example';
    S[host] = {
      handler(req, url) {
        if (url.pathname === '/robots.txt') return { status: 200, type: 'text/plain', body: 'User-agent: *\nDisallow: /admin\n' };
        if (url.pathname === '/sitemap.xml') return { status: 200, type: 'text/html', body: '<!doctype html><html><head><title>Just a moment...</title></head><body><p>Checking your browser before accessing the site.</p></body></html>' };
        if (url.pathname === '/products.json') return { status: 404, type: 'text/html', body: '<!doctype html><title>Not found</title><p>nope</p>' };
        if (url.pathname === '/') return { status: 200, type: 'text/html', body: `<!doctype html><html><head><title>Empty</title></head><body>${[1, 2, 3, 4, 5].map((i) => `<a href="/info/${i}">Info ${i}</a>`).join('')}</body></html>` };
        if (/^\/info\/\d$/.test(url.pathname)) return { status: 200, type: 'text/html', body: '<!doctype html><html><head><title>Info</title></head><body><main><h1>About our frames</h1><p>We make frames in a workshop and ship them to you, carefully packed, from our own warehouse.</p></main></body></html>' };
        return null;
      },
    };
  }
  // lensworld: Lenskart as the live probe saw it (run 38111611525) - one
  // store per market under locale paths, every locale's sitemaps on robots.txt.
  {
    const host = 'lensworld.example';
    const pdp = (p) => jsonLdPdp(host, p, 'plain');
    const mk = (prefix, n, currency, base) => Array.from({ length: n }, (_, k) => ({ path: `${prefix}/frame-${pad(base + k)}.html`, title: `Frame ${prefix || 'in'} ${pad(base + k)}`, sku: `LW${prefix.replace(/\W/g, '')}${base + k}`, price: (999 + k).toFixed(2), currency, images: [`https://${host}/img${prefix}/f-${base + k}.jpg`], description: 'Frame.' }));
    const IN = mk('', 600, 'INR', 1);
    for (const k of [10, 20, 30]) IN[k].currency = 'USD';              // priced in another market's currency
    const stale = new Set(IN.slice(100, 130).map((p) => p.path));    // the sitemap lists them, the store no longer has them
    const inUsInRoot = mk('/en-us', 10, 'USD', 9001);                 // another market's pages listed in the root sitemap
    const US = mk('/en-us', 120, 'USD', 1);
    const AE = mk('/en-ae', 80, 'AED', 1);
    const SA = mk('/ar-sa', 50, 'SAR', 1);
    const all = new Map([...IN, ...inUsInRoot, ...US, ...AE, ...SA].map((p) => [p.path, p]));
    const longHeader = `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<!-- ${'generated by the store platform; '.repeat(200)} -->\n`;
    S[host] = {
      truth: { inProducts: 600, inDeclared: 600, inWrongCurrency: 3, inStale: 30, us: 130, ae: 80, sa: 50 },
      handler(req, url) {
        const P = url.pathname;
        if (P === '/products.json') return { status: 404, type: 'text/html', body: '<!doctype html><title>Not found</title><p>no</p>' };
        if (P === '/robots.txt') return { status: 200, type: 'text/plain', body: `User-agent: *\nDisallow: /checkout\nSitemap: https://${host}/sitemap.xml\nSitemap: https://${host}/en-us/sitemap.xml\nSitemap: https://${host}/en-ae/sitemap.xml\nSitemap: https://${host}/ar-sa/sitemap.xml\nSitemap: https://${host}/feeds/catalogue.xml\n` };
        if (P === '/sitemap.xml') return { status: 200, type: 'text/xml', body: urlset([`https://${host}/products.xml`, `https://${host}/categories.xml`, `https://${host}/pages.xml`, `https://${host}/extra-sitemap.xml`]) };
        if (P === '/products.xml') return { status: 200, type: 'text/xml', body: urlset([...IN, ...inUsInRoot].map((p) => `https://${host}${p.path}`)) };
        if (P === '/categories.xml' || P === '/pages.xml') return { status: 200, type: 'text/xml', body: urlset([`https://${host}/eyeglasses`]) };
        // A urlset whose root element sits past a long stylesheet header and comment.
        if (P === '/extra-sitemap.xml') return { status: 200, type: 'text/xml', body: longHeader + urlset([`https://${host}/stores`]).replace(/^<\?xml[^>]*>\n/, '') };
        // An RSS feed declared as a sitemap: XML, and not a sitemap.
        if (P === '/feeds/catalogue.xml') return { status: 200, type: 'text/xml', body: '<?xml version="1.0"?><rss version="2.0"><channel><title>New in</title></channel></rss>' };
        for (const [pre, list] of [['/en-us', US], ['/en-ae', AE], ['/ar-sa', SA]]) {
          if (P === `${pre}/sitemap.xml`) return { status: 200, type: 'text/xml', body: sitemapIndex([`https://${host}${pre}/products.xml`, `https://${host}${pre}/categories.xml`]) };
          if (P === `${pre}/products.xml`) return { status: 200, type: 'text/xml', body: urlset(list.map((p) => `https://${host}${p.path}`)) };
          if (P === `${pre}/categories.xml`) return { status: 200, type: 'text/xml', body: urlset([`https://${host}${pre}/eyeglasses`]) };
          if (P === pre || P === pre + '/') return { status: 200, type: 'text/html', body: `<!doctype html><html><head><title>Lens World ${pre}</title></head><body></body></html>` };
        }
        if (P === '/') return { status: 200, type: 'text/html', body: `<!doctype html><html lang="en-IN"><head><title>Lens World</title>
<link rel="alternate" hreflang="en-in" href="https://${host}/">
<link rel="alternate" hreflang="en-us" href="https://${host}/en-us">
<link rel="alternate" hreflang="en-ae" href="https://${host}/en-ae/"></head><body><a href="${IN[0].path}">x</a></body></html>` };
        if (stale.has(P)) return { status: 404, type: 'text/html', body: '<!doctype html><title>Not found</title><p>gone</p>' };
        const p = all.get(P);
        if (p) return { status: 200, type: 'text/html', body: pdp(p) };
        return null;
      },
    };
  }

  // beautymart: Nykaa as the live probe saw it (run 38111613094) - a product
  // index among category / dp / reviews indexes, 85 blog sitemaps named
  // "product-reviews" and "product-launches-reviews", and a store that drops
  // connections when read more than two at a time.
  {
    const host = 'beautymart.example';
    const prods = Array.from({ length: 700 }, (_, k) => ({ path: `/item-${pad(k + 1)}/p/${100000 + k}`, title: `Serum ${pad(k + 1)}`, sku: `BM${k + 1}`, price: (199 + (k % 40)).toFixed(2), currency: 'INR', images: [`https://${host}/media/s-${k + 1}.jpg`], description: 'Serum.' }));
    const byPath = new Map(prods.map((p) => [p.path, p]));
    const blogKids = Array.from({ length: 85 }, (_, k) => `https://${host}/beauty-blog/sitemaps/${k % 2 ? 'product-reviews' : 'product-launches-reviews'}/top-brands-${k + 1}.xml`);
    S[host] = {
      truth: { products: 700, blogSitemaps: 85 },
      maxInflight: 0,
      pdpDelayMs: 0,
      throttles: (p) => /\/p\/\d+$/.test(p),
      handler(req, url) {
        const P = url.pathname;
        if (P === '/products.json') return { status: 429, type: 'text/plain', body: 'Too Many Requests' };
        if (P === '/robots.txt') return { status: 200, type: 'text/plain', body: `User-agent: *\nDisallow: /cart\nSitemap: https://${host}/sitemap-v2/sitemap-index.xml\nSitemap: https://${host}/beauty-blog/sitemap.xml\n` };
        if (P === '/sitemap-v2/sitemap-index.xml') return { status: 200, type: 'application/xml', body: sitemapIndex(['sitemap-reviews-index.xml', 'sitemap-categories-index.xml', 'sitemap-dp-index.xml', 'sitemap-products-index.xml'].map((n) => `https://${host}/sitemap-v2/${n}`)) };
        if (P === '/sitemap-v2/sitemap-products-index.xml') return { status: 200, type: 'application/xml', body: sitemapIndex(Array.from({ length: 7 }, (_, k) => `https://${host}/sitemap-v2/sitemap-products-${k + 1}.xml`)) };
        let m = /^\/sitemap-v2\/sitemap-products-(\d)\.xml$/.exec(P);
        if (m) { const k = Number(m[1]) - 1; return { status: 200, type: 'application/xml', body: urlset(prods.slice(k * 100, k * 100 + 100).map((p) => `https://${host}${p.path}`)) }; }
        if (P === '/sitemap-v2/sitemap-dp-index.xml') return { status: 200, type: 'application/xml', body: sitemapIndex([`https://${host}/sitemap-v2/sitemap-dp-1.xml`]) };
        if (P === '/sitemap-v2/sitemap-dp-1.xml') return { status: 200, type: 'application/xml', body: urlset([`https://${host}/dp/offers`]) };
        if (/^\/sitemap-v2\/sitemap-(reviews|categories)-index\.xml$/.test(P)) return { status: 200, type: 'application/xml', body: sitemapIndex([`https://${host}/sitemap-v2/x-1.xml`]) };
        if (P === '/beauty-blog/sitemap.xml') return { status: 200, type: 'application/xml', body: sitemapIndex(blogKids) };
        if (/^\/beauty-blog\/sitemaps\//.test(P)) return { status: 200, type: 'application/xml', body: urlset([`https://${host}/beauty-blog/post-${P.length}`]) };
        if (P === '/') return { status: 200, type: 'text/html', body: '<!doctype html><html><head><title>Beauty Mart</title></head><body></body></html>' };
        const p = byPath.get(P);
        if (p) return { status: 200, type: 'text/html', body: jsonLdPdp(host, p, 'plain'), delay: this.pdpDelayMs };
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
    // A store that sheds parallel connections: past `maxInflight` requests in
    // flight on a path it throttles, the connection is dropped unanswered,
    // which is what a fetch sees as "did not answer".
    if (store && store.maxInflight && store.throttles && store.throttles(url.pathname)) {
      store.inflight = (store.inflight || 0) + 1;
      let done = false;
      const release = () => { if (!done) { done = true; store.inflight -= 1; } };
      res.on('finish', release); res.on('close', release);
      if (store.inflight > store.maxInflight) { store.dropped = (store.dropped || 0) + 1; release(); req.socket.destroy(); return; }
    }
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
  const FIXTURE_HOST = /\.example$|^bigmarket\.in$/i;
  const isFixture = (url) => { try { return FIXTURE_HOST.test(new URL(String(url && url.url ? url.url : url)).hostname); } catch (_) { return false; } };

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
      dns.promises.lookup = async (host, opts) => (/\.example$|^bigmarket\.in$/i.test(String(host)) ? ((opts && opts.all) ? [{ address: PUBLIC_ADDR, family: 4 }] : { address: PUBLIC_ADDR, family: 4 }) : realLookup(host, opts));
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
      stores['bigmarket.example'].tried.clear();
      stores['bigmarket.example'].smDelayMs = 0;
      stores['bigmarket.example'].longRetry = 0;
      stores['lensshop.example'].delayMs = 0;
      stores['beautymart.example'].maxInflight = 0;
      stores['beautymart.example'].pdpDelayMs = 0;
      stores['beautymart.example'].dropped = 0;
      stores['beautymart.example'].inflight = 0;
    },
    close() { return new Promise((r) => server.close(() => r())); },
  };
}

module.exports = { startStores, PUBLIC_ADDR };
