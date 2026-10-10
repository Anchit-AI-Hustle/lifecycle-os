'use strict';
/**
 * The ONE brand stored in the live project (dypkppctdbmsiqclnhzx) on
 * 2026-10-10, reconstructed from read-only SELECTs (brand_workspaces,
 * brand_field_provenance, brand_context_packs, brand_catalog_products).
 * Trimmed to the fields and provenance the coherence rule reads; every value
 * and every source URL is the record's own (the long ad-click query string on
 * the mamaearth.in page is shortened to its path). Nothing was written to the
 * live project.
 *
 * Four registrable domains in one record:
 *   nike.in         website (typed), logo (rendered read), region store, asset hosts
 *   mamaearth.in    name, tagline, favicon, 6 social profiles, imagery,
 *                   legal entity, surface colours, fonts, design system
 *   delichic.co.in  the catalogue (8 products) and the first read's home market
 *   vahdam.com      a read of the primary colour, since replaced by a typed one
 * and a slug, food-for-thought, made from the name the record had first.
 */
const ME = 'https://mamaearth.in/collections/b1g1-offer';
module.exports = {
  id: 'f2711b60-9e06-403c-84aa-66db0cf82b78',
  name: 'Mamaearth',
  slug: 'food-for-thought',
  website: 'https://www.nike.in',
  tagline: 'Buy 1 Get 1 free',
  logo_url: 'https://prod-assets.nike.in/NIKE/nes-nike-reloaded-svc/static/assets/images/nike-logo-192x192.svg',
  favicon_url: 'https://mamaearth.in/cdn/shop/files/cropped-Favicon-2-150x150.png?crop=center&height=48&v=1772930334&width=48',
  status: 'active',
  palette: { ok: '#1a7f37', err: '#c0392b', ink: '#1d1b1b', warn: '#c9a227', muted: '#ffffff', accent: '#0e0101', primary: '#080807', surface: '#ffffff', surface_alt: '#ffffff' },
  typography: {
    body: { stack: "'Open Sans',sans-serif", family: 'Open Sans', google: true, weights: '400;700' },
    heading: { stack: "'Open Sans',sans-serif", family: 'Open Sans', google: true, weights: '400;700' },
  },
  voice: { tone: 'Bold, provocative, and intellectually sharp', banned: ['Guaranteed to change your life', "Act now before it's too late"], preferred: ['Cognitive fuel', 'Nourish the mind'], no_em_dashes: true, notes: '' },
  regions: [{ code: 'IN', home: true, symbol: '', currency: 'INR', store_url: 'https://www.nike.in' }],
  asset_hosts: ['nike.com', 'about.nike.com', 'nmp.about.nike.com', 'www.nike.in'],
  catalog_source: { url: 'https://delichic.co.in', kind: 'shopify_public', region: 'in', row_count: 8, platform: { id: 'woocommerce', source_url: 'https://delichic.co.in/' } },
  brand_data: {
    social: [
      { url: 'https://www.facebook.com/Mamaearthindia/', signal: 'json-ld:sameAs', platform: 'facebook', source_url: 'https://mamaearth.in/' },
      { url: 'https://twitter.com/mamaearthindia?lang=en', signal: 'json-ld:sameAs', platform: 'x', source_url: 'https://mamaearth.in/' },
      { url: 'https://www.instagram.com/mamaearth.in/?hl=en', signal: 'json-ld:sameAs', platform: 'instagram', source_url: 'https://mamaearth.in/' },
      { url: 'https://www.youtube.com/channel/UC5qhqSIcahBKKMEdLPFqeVA', signal: 'json-ld:sameAs', platform: 'youtube', source_url: 'https://mamaearth.in/' },
      { url: 'https://in.pinterest.com/mamaearthindia/', signal: 'json-ld:sameAs', platform: 'pinterest', source_url: 'https://mamaearth.in/' },
      { url: 'https://www.linkedin.com/company/mama-earth-in/', signal: 'json-ld:sameAs', platform: 'linkedin', source_url: 'https://mamaearth.in/' },
    ],
    imagery: [
      { url: 'https://mamaearth.in/cdn/shop/files/Logo.png?v=1772919457&width=164', page: ME, role: 'header', signal: 'computed' },
      { url: 'https://mamaearth.in/cdn/shop/files/b1g1-genric-desktop.jpg?v=1791291952&width=1000', page: ME, role: 'hero', signal: 'computed' },
      { url: 'https://mamaearth.in/cdn/shop/files/1_192.jpg?v=1777975842&width=300', page: ME, role: 'product', signal: 'computed' },
    ],
    legal_entity: 'Capital Cyberscape 11th Floor, Golf Course Ext Rd,Sector-59, Gurgaon, Haryana, 122098, IN',
    field_origin: {
      name: 'site-parse', tagline: 'site-parse', website: 'user', logo_url: 'site-render', 'voice.tone': 'site-parse', favicon_url: 'site-render',
      'palette.ink': 'user', 'voice.notes': 'site-parse', 'regions.home': 'site-parse', 'voice.banned': 'site-parse', 'palette.muted': 'site-render',
      'palette.accent': 'user', 'palette.primary': 'user', 'palette.surface': 'site-render', 'typography.body': 'site-render', 'voice.preferred': 'site-parse',
      'brand_data.social': 'site-parse', 'brand_data.imagery': 'site-render', 'typography.heading': 'site-render', 'palette.surface_alt': 'site-render',
      'brand_data.legal_entity': 'site-parse', 'brand_data.design_system': 'site-render',
    },
    field_origins: {
      name: { at: '2026-10-09T19:04:27.046Z', url: ME, origin: 'site-parse', signal: 'opengraph:og:site_name' },
      tagline: { at: '2026-10-09T19:04:27.046Z', url: ME, origin: 'site-parse', signal: 'opengraph:og:description' },
      website: { at: '2026-10-06T13:07:13.067Z', origin: 'user' },
      logo_url: { at: '2026-10-06T12:27:05.578Z', url: 'https://www.nike.in/', origin: 'site-render', signal: 'computed: logo @ desktop' },
      favicon_url: { at: '2026-10-09T19:04:27.046Z', url: ME, origin: 'site-render', signal: 'computed: icon (link[rel=apple-touch-icon])' },
      'palette.ink': { at: '2026-10-06T13:08:07.570Z', origin: 'user' },
      'palette.muted': { at: '2026-10-09T19:04:27.046Z', url: ME, origin: 'site-render', signal: 'computed: secondary text @ desktop' },
      'palette.accent': { at: '2026-10-06T13:08:00.769Z', origin: 'user' },
      'palette.primary': { at: '2026-10-06T13:07:55.470Z', origin: 'user' },
      'palette.surface': { at: '2026-10-09T19:04:22.848Z', origin: 'site-render' },
      'typography.body': { at: '2026-10-09T19:04:27.046Z', url: ME, origin: 'site-render', signal: 'computed: body copy @ desktop' },
      'typography.heading': { at: '2026-10-09T19:04:27.046Z', url: ME, origin: 'site-render', signal: 'computed: h1 @ desktop' },
      'brand_data.legal_entity': { at: '2026-10-09T19:04:27.046Z', url: 'https://mamaearth.in/', origin: 'site-parse', signal: 'json-ld:Organization.address' },
      'brand_data.social': { at: '2026-10-05T10:21:07.965Z', origin: 'site-parse' },
      'brand_data.imagery': { at: '2026-10-05T10:21:07.965Z', origin: 'site-render' },
      'brand_data.design_system': { at: '2026-10-05T10:21:07.965Z', origin: 'site-render' },
    },
    brand_extraction: {
      source: 'https://delichic.co.in/',
      extracted_at: '2026-10-05T10:21:07.965Z',
      applied: {
        name: { value: 'Mamaearth', origin: 'site-parse', signal: 'opengraph:og:site_name', source_url: ME },
        tagline: { value: 'Buy 1 Get 1 free', origin: 'site-parse', signal: 'opengraph:og:description', source_url: ME },
        logo_url: { value: 'https://prod-assets.nike.in/NIKE/nes-nike-reloaded-svc/static/assets/images/nike-logo-192x192.svg', origin: 'site-render', source_url: 'https://www.nike.in/' },
        favicon_url: { value: 'https://mamaearth.in/cdn/shop/files/cropped-Favicon-2-150x150.png?crop=center&height=48&v=1772930334&width=48', origin: 'site-render', source_url: ME },
        'palette.ink': { value: '#ffffff', signal: 'computed: body copy', source_url: 'https://www.nike.in/' },
        'regions.home': { value: 'IN', signal: 'host:ccTLD .co.in', confidence: 'strong', source_url: 'https://delichic.co.in/' },
        'palette.muted': { value: '#ffffff', origin: 'site-render', source_url: ME },
        'palette.accent': { value: '#4d2121', origin: 'site-render', source_url: 'https://delichic.co.in/' },
        'palette.primary': { value: '#ab8743', origin: 'site-render', source_url: 'https://www.vahdam.com/' },
        'palette.surface': { value: '#ffffff', origin: 'site-render', source_url: ME },
        'palette.surface_alt': { value: '#ffffff', origin: 'site-render', source_url: ME },
        'typography.body': { value: '', origin: 'site-render', source_url: ME },
        'typography.heading': { value: '', origin: 'site-render', source_url: ME },
        'brand_data.imagery': { value: '', origin: 'site-render', source_url: ME },
        'brand_data.legal_entity': { value: 'Capital Cyberscape 11th Floor, Golf Course Ext Rd,Sector-59, Gurgaon, Haryana, 122098, IN', origin: 'site-parse', signal: 'json-ld:Organization.address', source_url: 'https://mamaearth.in/' },
        'brand_data.design_system': { value: '', origin: 'site-render', source_url: ME },
      },
    },
    design_system: { type: { desktop: { h1: { family: 'Open Sans' } } } },
  },
};
