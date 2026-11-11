// EVERY ASSET TYPE, REVIEWED BY BUILDING IT (2026-11-11). The operator: "ensure
// all assets generations are reviewed and rated and improvements required
// analysed and implemented ... emailers, landing pages, ads, music like jingles,
// brand theme songs etc everything - ensure for all brands", then "check and
// fix any issues in brand setups ... for brands where it could be just media
// brands etc with no catalog as such but data inventories of articles", then
// "ensure no robotic voices or sounds".
//
// One send per brand kind was built through the shipped buildCampaign, rendered
// and read. What that found, each asserted here on the OUTPUT:
//   - a size in a subject and an ad headline ("... Foundation 30 millilitres");
//     a coded name kept every Lenskart ad headed "Lenskart"
//   - two discounts on one page (the planner's 15% beside the store's 13%)
//   - a store sentence with the name's words taken out ("dark sponge filled
//     with ganache"); a storage line as a reason to buy and as "How do I use it?"
//   - the mail showed the price without the struck price; a publisher's one
//     claim was the sub line AND the only bullet
//   - jingle and anthem lyrics sang the size, a site's SEO title and the same
//     line twice
//   - a publisher's articles were never its inventory: news sitemaps were
//     skipped as "not products"
// The browser-voice case is tests/story-voice-preview.spec.js.
// Run: npx playwright test tests/asset-review-all-types.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'ANTHROPIC_BASE_URL'];
const MF = require(path.join(ROOT, 'api', '_shared', 'mailer-format.js'));
const PS = require(path.join(ROOT, 'api', '_shared', 'product-story.js'));
const BM = require(path.join(ROOT, 'api', '_shared', 'brand-music.js'));

const preset = (slug) => { const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', slug + '.json'), 'utf8')); b.id = 'device:' + slug; if (!b.regions || !b.regions.length) b.regions = [{ code: 'IN', currency: 'INR', home: true }]; return b; };
const P = (host, t, n, price, x) => Object.assign({ sku: 'S' + n, title: t, handle: 'p' + n, image: `https://${host}/img/${n}.jpg`, price, url: `https://${host}/products/p${n}`, category: 'Product' }, x || {});
const BAKERY = { id: 'device:nik', slug: 'nik-bakers', name: 'Nik Bakers', website: 'https://nikbakers.example', industry: 'bakery and cafe', tagline: 'Baked fresh every morning since 1979', claims: ['Baked fresh every morning', 'No preservatives in our breads'], palette: { primary: '#8C3B1F', accent: '#F2C14E', ink: '#2B1A12', surface: '#FFFBF5' }, regions: [{ code: 'IN', currency: 'INR', home: true }], legal_entity: 'Nik Bakers Pvt Ltd, Chandigarh, India' };
const CAKE = P('nikbakers.example', 'Belgian Chocolate Truffle Cake 500g', 7, 950, { category: 'Cakes', description: '<p>Three layers of dark chocolate sponge filled with Belgian chocolate ganache.</p><p>Made without eggs, so the whole family can share it.</p><p>Keep refrigerated and serve within 2 days.</p>' });
const FOUNDATION = P('www.nykaa.com', 'Kay Beauty Hydrating Foundation 30ml', 1, 1399, { compare_at: 1599, category: 'Foundation', description: '<p>A lightweight liquid foundation with medium buildable coverage.</p><p>Enriched with hyaluronic acid to keep skin hydrated for up to 12 hours.</p><p>Blends easily and gives a natural satin finish.</p><p>Apply 2 pumps with a damp sponge and blend outwards.</p>' });
const STORY = { title: 'Rupee slips past 84 as oil climbs: what it means for your EMIs', handle: 'rupee-84', image: 'https://timesofindia.indiatimes.com/img/21.jpg', price: null, url: 'https://timesofindia.indiatimes.com/business/rupee-84', category: 'Business', offering_kind: 'story', description: 'The rupee closed at a record low on Thursday. Here is how that feeds into fuel prices and home loan rates.' };
const STAND = 'The rupee closed at a record low on Thursday. Here is how that feeds into fuel prices and home loan rates.';

async function build(brand, o) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error(`network blocked: ${u}`); };
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const entry = Object.assign({ id: 'rev-' + brand.slug, date: '2026-11-14', market: 'IN', objective: 'reactivation', brand: JSON.parse(JSON.stringify(brand)), cohort: { name: 'At Risk', size: 1500, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], confidence: 0.6, offer: { depth: 'none', pct: 0 } }, o || {});
    return await require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js')).buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const textOf = (h) => String(h || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const count = (hay, needle) => hay.split(needle).length - 1;

test('a headline says the name: no size, no model code; the body keeps the store\'s own name', async () => {
  expect(MF.shortName('Kay Beauty Hydrating Foundation 30ml')).toBe('Kay Beauty Hydrating Foundation');
  expect(MF.shortName('Vincent Chase VC 5158/P Black Wayfarer Sunglasses')).toBe('Vincent Chase Black Wayfarer Sunglasses');
  expect(MF.shortName('Coffee 250 g (Pack of 2)')).toBe('Coffee');
  expect(MF.shortName('Oil 30ml')).toBe('Oil 30ml');            // a name that is only a size keeps it
  const c = await build(preset('nykaa'), { heroProduct: FOUNDATION, offer: { depth: 'medium', pct: 15 } });
  expect(c.assets.email.subject).toBe('Back for you: Kay Beauty Hydrating Foundation');
  // the preheader is the store's own first reason, not "A note from <brand>"
  expect(c.assets.email.preheader).toBe('Enriched with hyaluronic acid to keep skin hydrated for up to 12 hours.');
  for (const a of c.assets.ads) {
    expect(a.headline, a.platform + ' ' + a.creative_type).toBe('Kay Beauty Hydrating Foundation');
    expect(a.headline.length).toBeLessThanOrEqual(40);
  }
  const l = await build(preset('lenskart'), { objective: 'second-order activation', heroProduct: P('www.lenskart.com', 'Vincent Chase VC 5158/P Black Wayfarer Sunglasses', 5, 1999, { category: 'Sunglasses', description: 'Black Full Rim Wayfarer Polarized Sunglasses Medium' }) });
  for (const a of l.assets.ads) {
    expect(a.headline).toBe('Vincent Chase Black Wayfarer Sunglasses');
    expect([a.primary_text, a.caption, a.script].join(' ')).not.toMatch(/5158/);
  }
});

test('one discount on a page: the store\'s own compare-at; the mail shows the struck price too', async () => {
  const c = await build(preset('nykaa'), { heroProduct: FOUNDATION, offer: { depth: 'medium', pct: 15 } });
  for (const lp of c.assets.landing_pages) {
    const t = textOf(lp.html);
    expect(t, lp.variant).not.toMatch(/15%/);
    expect(t, lp.variant).toMatch(/13%/);
  }
  const va = c.assets.email.variants.find((v) => v.key === 'visual_a');
  expect(textOf(va.html)).toMatch(/₹1,399, was ₹1,599/);
  // with no compare-at the planner's offer is still what the page says
  const noCmp = await build(preset('nykaa'), { heroProduct: Object.assign({}, FOUNDATION, { compare_at: undefined }), offer: { depth: 'medium', pct: 15 } });
  expect(textOf(noCmp.assets.landing_pages[0].html)).toMatch(/15% off/);
});

test('the store\'s sentences are kept whole; a storage line is not a reason, and is answered as storage', async () => {
  expect(MF.productLine(CAKE.description, CAKE.title, 'Nik Bakers')).toBe('Three layers of dark chocolate sponge filled with Belgian chocolate ganache');
  // an attribute list still loses the words the name says
  expect(MF.productLine('Vincent Chase VC 5158/P Black Wayfarer sunglasses at Lenskart.', 'Vincent Chase VC 5158/P', 'Lenskart')).toBe('Black Wayfarer sunglasses');
  const st = PS.story(CAKE);
  expect(st.benefits).toEqual(['Made without eggs, so the whole family can share it.']);
  expect(st.how).toEqual(['Keep refrigerated and serve within 2 days.']);
  expect(PS.faq(st, 'Belgian Chocolate Truffle Cake').map((q) => q.q)).toEqual(['How do I store it?']);
  // "Keeps skin hydrated" is still a reason
  expect(PS.story({ title: 'X', description: 'A light cream. Keeps skin hydrated all day.' }).benefits).toEqual(['Keeps skin hydrated all day.']);
  const c = await build(BAKERY, { objective: 'premium bundle expansion', cohort: { name: 'Champions', size: 800, rules: ['r'] }, heroProduct: CAKE, supportingProducts: [P('nikbakers.example', 'Sourdough Loaf 400g', 8, 220)] });
  for (const a of c.assets.ads) expect(String(a.primary_text || ''), a.platform + ' ' + a.creative_type).not.toMatch(/^Keep refrigerated/);
  const lpA = textOf(c.assets.landing_pages.find((l) => l.variant === 'A').html);
  expect(lpA).toMatch(/Why Belgian Chocolate Truffle Cake(?! 500)/);
  expect(lpA).not.toMatch(/dark sponge filled with ganache/);
  expect(c.assets.email.subject).toBe('Picked for you: Belgian Chocolate Truffle Cake');
  expect(c.contract_check.blocking).toBe(0);
});

test('a publisher\'s one claim is not the sub line and the only bullet under it', async () => {
  const c = await build(preset('times-of-india'), { cohort: { name: 'Hibernating', size: 900, rules: ['r'] } });
  for (const v of c.assets.email.variants) expect(count(textOf(v.html), 'General news coverage from The Times of India'), v.key).toBeLessThanOrEqual(1);
});

test('jingles and anthems sing the brand\'s own lines, each once: no size, no SEO title, no line twice', () => {
  const lines = (p) => p.lyrics.split('\n').filter((l) => l && !/^\[/.test(l));
  // a size is not sung, and the product is named once
  const nk = BM.plan({ brand: preset('nykaa'), purpose: 'jingle', product: { title: 'Kay Beauty Hydrating Foundation 30ml' } });
  expect(nk.lyrics).not.toMatch(/30\s*ml/i);
  expect(count(nk.lyrics, 'Kay Beauty Hydrating Foundation')).toBe(1);
  // a site's SEO title is not a hook; the publisher's own sections are a verse
  const toi = BM.plan({ brand: preset('times-of-india'), purpose: 'anthem', vocals: true });
  expect(toi.lyrics).not.toMatch(/Latest News|Breaking News/);
  expect(toi.prompt).not.toMatch(/describes itself as: India News/);
  expect(toi.lyrics).toMatch(/India, City, Videos/);
  expect(BM.plan({ brand: preset('economic-times'), purpose: 'jingle' }).lyrics).not.toMatch(/Business News, Markets/);
  // a claim the tagline already says is not sung under it
  const bk = BM.plan({ brand: BAKERY, purpose: 'jingle' });
  expect(lines(bk)).toEqual(['No preservatives in our breads', 'Nik Bakers, Baked fresh every morning since 1979', 'Nik Bakers']);
  // a real tagline is still sung
  expect(BM.plan({ brand: preset('apple'), purpose: 'jingle' }).lyrics).toMatch(/Apple, Think Different/);
  // with only a name on record: the name over a wordless phrase, and the
  // structure names no verse the lyrics do not have
  const bare = BM.plan({ brand: { name: 'Orrin' }, purpose: 'anthem', vocals: true });
  expect(lines(bare)).toEqual(['Orrin', 'Oh oh oh, Orrin', 'Orrin']);
  expect(bare.structure).not.toMatch(/Verse/);
  // every starter brand: no marker, no separator of a page title, no line said twice in a row
  for (const f of fs.readdirSync(path.join(ROOT, 'data', 'brands', 'presets')).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
    for (const purpose of ['jingle', 'anthem']) {
      const p = BM.plan({ brand: preset(f.replace('.json', '')), purpose, vocals: true });
      expect(p.prompt, f).not.toMatch(/DATA REQUIRED|undefined/);
      expect(p.lyrics, f).not.toMatch(/[|•]/);
      const ls = lines(p);
      for (let i = 1; i < ls.length; i++) expect(ls[i] === ls[i - 1], `${f} ${purpose}: "${ls[i]}" twice in a row`).toBe(false);
    }
  }
  // the browser copy is the same file
  expect(fs.readFileSync(path.join(ROOT, 'brand-music.js'), 'utf8')).toBe(fs.readFileSync(path.join(ROOT, 'api', '_shared', 'brand-music.js'), 'utf8'));
});

test('a publisher\'s inventory is its articles: news sitemap rows with no page request, article pages read, topics left out; a store is unchanged', async () => {
  test.setTimeout(120_000);
  const imp = require(path.join(ROOT, 'api', '_shared', 'catalog-import.js'));
  const hits = [];
  const art = (i) => `<url><loc>http://127.0.0.1:PORT/india/story-${i}</loc><news:news><news:publication><news:name>Gazette</news:name><news:language>en</news:language></news:publication><news:publication_date>2026-11-${String(10 - (i % 9)).padStart(2, '0')}T08:00:00+05:30</news:publication_date><news:title>Headline number ${i} &amp; more</news:title><news:keywords>india, politics</news:keywords></news:news><image:image><image:loc>http://127.0.0.1:PORT/img/${i}.jpg</image:loc></image:image></url>`;
  const srv = http.createServer((q, r) => {
    hits.push(q.url);
    const port = srv.address().port;
    const send = (t, b) => { r.writeHead(200, { 'content-type': t }); r.end(b.replace(/PORT/g, port)); };
    if (q.url === '/robots.txt') return send('text/plain', 'User-agent: *\nAllow: /\nSitemap: http://127.0.0.1:PORT/sitemap-index.xml\n');
    if (q.url === '/sitemap-index.xml') return send('application/xml', '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>http://127.0.0.1:PORT/sitemaps/news.xml</loc></sitemap><sitemap><loc>http://127.0.0.1:PORT/sitemaps/articles-2026.xml</loc></sitemap><sitemap><loc>http://127.0.0.1:PORT/sitemaps/topics.xml</loc></sitemap></sitemapindex>');
    if (q.url === '/sitemaps/news.xml') return send('application/xml', '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">' + Array.from({ length: 30 }, (_, i) => art(i + 1)).join('') + '</urlset>');
    if (q.url === '/sitemaps/articles-2026.xml') return send('application/xml', '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + [1, 2, 3].map((i) => `<url><loc>http://127.0.0.1:PORT/business/long-read-${i}</loc></url>`).join('') + '<url><loc>http://127.0.0.1:PORT/india/story-1</loc></url></urlset>');
    if (q.url === '/sitemaps/topics.xml') return send('application/xml', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://127.0.0.1:PORT/topic/x</loc></url></urlset>');
    const m = /long-read-(\d)/.exec(q.url);
    if (m) return send('text/html', `<html><head><title>Long read ${m[1]}</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"Long read ${m[1]}: the rupee","description":"What moved the rupee this week.","articleSection":"Business","datePublished":"2026-11-0${m[1]}","image":"http://127.0.0.1:PORT/img/l${m[1]}.jpg"}</script></head><body><h1>x</h1></body></html>`);
    if (q.url === '/') return send('text/html', '<html><head><title>Gazette</title></head><body>news</body></html>');
    r.writeHead(404); r.end('no');
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const run = async (brand) => {
    hits.length = 0;
    let cursor = null; let rows = []; let out;
    for (let i = 0; i < 6; i++) { out = await imp.step({ url, region: 'IN', brand, cursor, guard: async () => {}, budgetMs: 20000 }); rows = rows.concat(out.rows); cursor = out.cursor; if (out.complete) break; }
    return { rows, out, pages: hits.filter((h) => /story-|long-read|topic\//.test(h)) };
  };
  try {
    const pub = await run({ name: 'Ledger Gazette', industry: 'General news / digital publishing', website: url });
    expect(pub.out.complete).toBe(true);
    expect(pub.out.coverage.inventory).toBe('articles');
    expect(pub.rows).toHaveLength(33);
    const news = pub.rows.filter((r) => r.raw && r.raw.declared === 'sitemap:news');
    expect(news).toHaveLength(30);
    // newest first, with what the sitemap states and nothing else
    expect(news[0].published_at.slice(0, 10)).toBe('2026-11-10');
    expect(news[0]).toMatchObject({ offering_kind: 'story', product_type: 'India', price: null, source: 'sitemap_jsonld', description: null });
    expect(news[0].title).toMatch(/^Headline number \d+ & more$/);
    expect(news[0].image_url).toMatch(/\/img\/\d+\.jpg$/);
    // no article page of the news sitemap was requested; the plain sitemap's three were read
    expect(pub.pages.sort()).toEqual(['/business/long-read-1', '/business/long-read-2', '/business/long-read-3']);
    expect(pub.rows.filter((r) => /^Long read/.test(r.title)).map((r) => r.product_type)).toEqual(['Business', 'Business', 'Business']);
    const said = pub.out.coverage.sentences.join('\n');
    expect(said).toMatch(/is a publisher, by the brand's own record, so its inventory is its articles/);
    expect(said).toMatch(/Found 33 of the 33 articles/);
    expect(said).not.toMatch(/products\.json|state no price|Most popular/);
    // A store on the same site: the news sitemaps are not its catalogue. Its NAME
    // never makes it a publisher ("Big Market", "The Daily Post Cafe").
    const shop = await run({ name: 'The Daily Post Market', industry: 'bakery', website: url });
    expect(shop.out.coverage.inventory).toBe('products');
    expect(shop.rows).toHaveLength(0);
    expect(shop.pages.filter((h) => /story-|long-read/.test(h))).toEqual([]);
  } finally { await new Promise((ok) => srv.close(ok)); }
});

test('an article as the hero: its headline is the subject and the headline, its standfirst is said once per mail, the track is the brand\'s theme', async () => {
  const c = await build(preset('times-of-india'), { cohort: { name: 'Hibernating', size: 900, rules: ['r'] }, heroProduct: STORY, supportingProducts: [{ title: 'Delhi air quality turns severe, schools move online', handle: 's2', image: 'https://timesofindia.indiatimes.com/img/22.jpg', url: 'https://timesofindia.indiatimes.com/city/delhi-air', category: 'City', offering_kind: 'story' }] });
  expect(c.assets.email.subject).toBe(STORY.title);
  expect(c.assets.email.preheader).toBe(STAND);
  for (const v of c.assets.email.variants) {
    const t = textOf(v.html);
    expect(count(t, 'The rupee closed at a record low on Thursday.'), v.key).toBe(1);
    expect(t, v.key).not.toMatch(/Take another look at business/i);
  }
  const lpA = textOf(c.assets.landing_pages.find((l) => l.variant === 'A').html);
  expect(lpA).not.toMatch(/Why Rupee slips/);
  expect(lpA).toMatch(/More from The Times of India/);
  const meta = c.assets.ads.find((a) => a.platform === 'meta' && a.creative_type === 'static');
  expect(meta.primary_text).toBe(STAND);
  expect(c.assets.music.purpose).toBe('anthem');
  expect(c.contract_check.blocking).toBe(0);
  // the standfirst is never sorted into "reasons to buy"
  expect(PS.story(STORY)).toMatchObject({ what: STAND, benefits: [], how: [], article: true });
});
