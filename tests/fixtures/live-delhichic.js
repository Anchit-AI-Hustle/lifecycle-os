'use strict';
/**
 * The live workspace "DelhiChic" (2026-10-10), read with a read-only SELECT
 * of brand_workspaces and trimmed to what the coherence rule and the catalogue
 * importer read. No secret, no owner id, no token. Every value is the record's
 * own; the mamaearth.in page's ad-click query string is shortened to its path,
 * the cursor's 2,430 pending URLs to its first four, and its stats to zeros.
 *
 * What it shows:
 *   - website https://delichic.co.in (typed), but the ONE region (IN, home:false)
 *     names its store as https://www.nike.in, and asset_hosts are Nike's;
 *   - the catalogue import read https://www.nike.in ("the IN store URL on the
 *     brand's own record") and stored 734 of Nike's products, while recording
 *     catalog_source.url = https://delichic.co.in - the brand's own site;
 *   - catalog_import holds a PARTIAL run whose cursor resumes nike.in.
 *
 * PRODUCT_ROWS are the shape brand_catalog_products holds for that import: the
 * product pages are the cursor's own nike.in URLs (the rows' titles and prices
 * are not in the workspace record, so the titles here are placeholders and no
 * price is given).
 */
const ME = 'https://mamaearth.in/collections/b1g1-offer';
const NIKE = [
  'https://www.nike.in/nike-structure-26-men-s-road-running-shoes/p/24789619',
  'https://www.nike.in/nike-court-dri-fit-men-s-tennis-polo/p/26005627',
  'https://www.nike.in/nike-24-7-impossiblysoft-women-s-dri-fit-mid-rise-joggers/p/26041284',
  'https://www.nike.in/nike-w-marina/p/26042287',
];
const record = {
  id: 'f2711b60-9e06-403c-84aa-66db0cf82b78',
  name: 'DelhiChic',
  slug: 'mamaearth',
  website: 'https://delichic.co.in',
  status: 'active',
  palette: { ok: '#1a7f37', err: '#c0392b', ink: '#1d1b1b', warn: '#c9a227', muted: '#ffa517', accent: '#0e0101', primary: '#ffa517', surface: '#ffffff', surface_alt: '#ffffff' },
  typography: { heading: { family: 'Poppins', google: true }, body: { family: 'Poppins', google: true } },
  voice: { tone: 'Bold, provocative, and intellectually sharp', banned: [], preferred: [], no_em_dashes: true, notes: '' },
  regions: [{ code: 'IN', home: false, symbol: '', currency: 'INR', store_url: 'https://www.nike.in', pdp_pattern: '{base}/products/{handle}', collection_pattern: '{base}/collections/{slug}' }],
  asset_hosts: ['nike.com', 'about.nike.com', 'nmp.about.nike.com', 'www.nike.in'],
  catalog_source: {
    url: 'https://delichic.co.in', kind: 'shopify_public', region: 'in', row_count: 612, found: 612, declared: 2430, complete: false, platform: null,
    batch: 'fbc6eac0-a7c9-4a57-b4d2-1c2a5d613f54', imported_at: '2026-10-10T21:49:01.312Z',
    coverage: { base: 'https://www.nike.in', base_from: 'the IN store URL on the brand\'s own record', region: 'IN', route: 'sitemap', found: 612, complete: false },
    coverage_note: 'Found 612 of the 2,430 products the site declares in the site\'s product sitemaps. Source: 612 from product pages listed in its sitemap (their JSON-LD). Market IN: read from https://www.nike.in (the IN store URL on the brand\'s own record). PARTIAL: this run\'s time ran out at URL 613 of 2430. Continue import resumes exactly there; the daily refresh also continues it.',
  },
  catalog_import: {
    run: 'fbc6eac0-a7c9-4a57-b4d2-1c2a5d613f54', url: 'https://delichic.co.in', kind: 'storefront', region: 'in', updated_at: '2026-10-10T21:49:01.312Z',
    cursor: {
      v: 1, run: 'fbc6eac0-a7c9-4a57-b4d2-1c2a5d613f54', region: 'in', start: 'https://delichic.co.in', base: 'https://www.nike.in',
      base_from: 'the IN store URL on the brand\'s own record', route: 'sitemap', page: 1, pos: 2, pending: NIKE.slice(),
      declared: { by: 'the site\'s product sitemaps', urls: 2430, count: 2430 },
      stats: null,
    },
    coverage: { base: 'https://www.nike.in', base_from: 'the IN store URL on the brand\'s own record', region: 'IN', found: 612, complete: false, sentences: [] },
  },
  brand_data: {
    field_origin: { name: 'user', website: 'user', 'voice.tone': 'site-parse', 'palette.surface_alt': 'site-render' },
    field_origins: {
      name: { origin: 'user' }, website: { origin: 'user' },
      'voice.tone': { origin: 'site-parse', url: ME, signal: 'observed from public copy' },
      'palette.surface_alt': { origin: 'site-render' },
    },
    brand_extraction: {
      source: 'https://delichic.co.in/',
      applied: { 'palette.surface_alt': { value: '#ffffff', origin: 'site-render', source_url: ME } },
    },
  },
};
const PRODUCT_ROWS = NIKE.map((u, i) => ({
  region: 'in', handle: u.split('/p/')[1], sku: null, title: `Nike product ${i + 1}`, price: null, currency: null,
  image_url: null, product_url: u, source_url: u, source: 'sitemap_jsonld',
}));
module.exports = { record, PRODUCT_ROWS, NIKE_URLS: NIKE };
