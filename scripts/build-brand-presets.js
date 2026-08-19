#!/usr/bin/env node
'use strict';
/**
 * scripts/build-brand-presets.js — write the starter brand library.
 *
 *   node scripts/build-brand-presets.js        (npm run brand:presets)
 *
 * The platform is brand-agnostic: any operator onboards their own brand at
 * /onboarding and the whole suite re-skins to it. These presets exist so that
 * first screen is never a blank form - pick a profile, see the entire OS run as
 * that brand, then edit or replace it.
 *
 * PROVENANCE RULE. Every palette/typography value below was read from the
 * brand's OWN live site or stylesheet on the date in `verified_at`, and the
 * exact source is recorded per preset. Voice descriptors are written as
 * OBSERVED from public output, never presented as a company's internal brand
 * guidelines. Nothing here is invented.
 *
 * THESE ARE TEMPLATES, NOT LICENCES. A preset is a starting point for building
 * and demoing; it grants no rights in a third party's marks. An operator
 * running a real programme must replace it with their own approved guidelines
 * (every preset carries `rights_note` saying so).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/brands/presets');
fs.mkdirSync(OUT, { recursive: true });

const RIGHTS = 'Template only. Public brand attributes observed from the brand\'s own site for building and demonstration; this is not a licence to use the brand\'s marks. Replace with your own approved guidelines before running a real programme.';

const region = (code, currency, symbol, url) => ({
  code, currency, symbol, store_url: url,
  pdp_pattern: '{base}/products/{handle}', collection_pattern: '{base}/collections/{slug}',
});

const PRESETS = [
  {
    slug: 'knickgasm', name: 'KNICKGASM', tagline: "India's Largest Sneaker Customisers",
    industry: 'Custom sneakers / D2C', website: 'https://knickgasm.com',
    logo_url: 'https://knickgasm.com/cdn/shop/files/knick_black.svg?v=1731481332',
    preset: { label: 'KNICKGASM', sector: 'D2C commerce', blurb: 'Hand-painted one-of-one custom sneakers. Ships with a real 436-product catalogue.', verified_at: '2026-08-09', source: 'knickgasm.com theme variables (--color-primary) + public site claims' },
    palette: { primary: '#D0473E', accent: '#6A33D8', ink: '#111111', surface: '#FFFFFF', surface_alt: '#FFFFFF', muted: '#666666', line: '#EBEBEB', ok: '#1a7f37', warn: '#c9a227', err: '#c0392b' },
    typography: {
      heading: { family: 'Montserrat', stack: "'Montserrat','Raleway',Arial,sans-serif", google: true, weights: '600;700;800' },
      body: { family: 'Instrument Sans', stack: "'Instrument Sans','Helvetica Neue',Arial,sans-serif", google: true, weights: '400;500;600' },
    },
    voice: {
      tone: 'bold, energetic, youth street-culture; confident and playful, never corporate',
      preferred: ['custom', 'hand-painted', 'one-of-one', 'grail', 'canvas', 'colorway', 'drop', 'rotation', 'crafted', 'original'],
      banned: ['wellness journey', 'transform', 'liquid gold', 'game-changer', 'LIMITED TIME', 'hurry', "don't miss out", 'last chance', 'while supplies last', 'replica', 'knock-off', 'first copy', 'fake pair'],
      no_em_dashes: true,
      notes: 'Testimonials read like a friend flexing a new pair. Never imply the pairs are replicas: they are hand-painted on 100% original brand sneakers.',
    },
    claims: ["India's largest sneaker customisers", 'Made on 100% original brand sneakers', "Hand-painted by India's best artists", 'Water and scratch resistant designs', 'Express shipping worldwide to 60+ countries'],
    regions: [region('IN', 'INR', '₹', 'https://knickgasm.com'), region('US', 'USD', '$', 'https://knickgasm.com'), region('UK', 'GBP', '£', 'https://knickgasm.com')],
    asset_hosts: ['knickgasm.com', 'cdn.shopify.com'],
    catalog_source: { kind: 'shopify_public', url: 'https://knickgasm.com/products.json', offering_kinds: ['product', 'service'] },
    offerings: [
      { kind: 'service', name: 'Create Your Own Design (custom commission)', lead_time: '10-15 days', enquiry_url: 'https://knickgasm.com', source: 'knickgasm.com - custom design request flow' },
    ],
  },
  {
    slug: 'economic-times', name: 'The Economic Times', tagline: 'Business News, Markets, Economy',
    industry: 'Business news / digital publishing', website: 'https://economictimes.indiatimes.com',
    preset: { label: 'The Economic Times', sector: 'News & publishing', blurb: 'Business and markets journalism. Subscription and newsletter lifecycle rather than a product catalogue.', verified_at: '2026-08-10', source: 'economictimes.indiatimes.com homepage CSS (dominant #d51131/#ed193b, Montserrat + Faustina)' },
    palette: { primary: '#D51131', accent: '#ED193B', ink: '#4D4D4D', surface: '#FFFFFF', surface_alt: '#F1F5F8', muted: '#4D4D4D', line: '#D8D8D8', ok: '#147014', warn: '#c9a227', err: '#B80E2B' },
    typography: {
      heading: { family: 'Montserrat', stack: "'Montserrat',Verdana,Arial,sans-serif", google: true, weights: '500;600;700' },
      body: { family: 'Faustina', stack: "'Faustina',Georgia,'Times New Roman',serif", google: true, weights: '400;500;600' },
    },
    voice: {
      tone: 'authoritative, precise, market-first; explains what a number means for the reader',
      preferred: ['markets', 'earnings', 'policy', 'analysis', 'outlook', 'briefing', 'explained'],
      banned: ['guaranteed returns', 'sure shot', 'multibagger tip', 'get rich', 'insider tip', 'risk-free'],
      no_em_dashes: true,
      notes: 'OBSERVED from public output, not official guidelines. Financial copy must never promise returns or read as investment advice; attribute every figure to its source and date.',
    },
    claims: ['Business, markets and economy journalism from The Economic Times'],
    regions: [region('IN', 'INR', '₹', 'https://economictimes.indiatimes.com')],
    asset_hosts: ['economictimes.indiatimes.com', 'img.etimg.com'],
    catalog_source: { kind: 'manual', offering_kinds: ['section', 'plan', 'programme'], note: 'A publisher sells sections, newsletters and subscriptions, not SKUs.' },
    offerings: [
      { kind: 'section', name: 'Markets', url: 'https://economictimes.indiatimes.com/markets', source: 'ET site navigation' },
      { kind: 'section', name: 'Industry', url: 'https://economictimes.indiatimes.com/industry', source: 'ET site navigation' },
      { kind: 'section', name: 'Tech', url: 'https://economictimes.indiatimes.com/tech', source: 'ET site navigation' },
      { kind: 'section', name: 'Wealth', url: 'https://economictimes.indiatimes.com/wealth', source: 'ET site navigation' },
      { kind: 'plan', name: 'ETPrime', period: 'subscription', signup_url: 'https://economictimes.indiatimes.com', source: 'ETPrime appears in ET site navigation' },
    ],
  },
  {
    slug: 'times-of-india', name: 'The Times of India', tagline: 'India News, Latest News, Breaking News',
    industry: 'General news / digital publishing', website: 'https://timesofindia.indiatimes.com',
    preset: { label: 'The Times of India', sector: 'News & publishing', blurb: 'Mass-reach general news. High-frequency editorial lifecycle across many verticals.', verified_at: '2026-08-10', source: 'timesofindia.indiatimes.com homepage (theme-color #af2c2c, masthead red #e21b22, Rethink Sans)' },
    palette: { primary: '#E21B22', accent: '#AF2C2C', ink: '#1A1A1A', surface: '#FFFFFF', surface_alt: '#F6F6F6', muted: '#595959', line: '#ECECEC', ok: '#147014', warn: '#c9a227', err: '#c0392b' },
    typography: {
      heading: { family: 'Rethink Sans', stack: "'Rethink Sans',-apple-system,BlinkMacSystemFont,Arial,sans-serif", google: true, weights: '600;700;800' },
      body: { family: 'Rethink Sans', stack: "'Rethink Sans',-apple-system,BlinkMacSystemFont,Arial,sans-serif", google: true, weights: '400;500;600' },
    },
    voice: {
      tone: 'clear, immediate, mass-reach; plain language that works for a first-time reader',
      preferred: ['latest', 'explained', 'live updates', 'what it means', 'key points'],
      banned: ['clickbait', 'you won\'t believe', 'shocking truth', 'doctors hate', 'this one trick'],
      no_em_dashes: true,
      notes: 'OBSERVED from public output, not official guidelines. News copy must attribute and date every claim, and never overstate a developing story.',
    },
    claims: ['General news coverage from The Times of India'],
    regions: [region('IN', 'INR', '₹', 'https://timesofindia.indiatimes.com')],
    asset_hosts: ['timesofindia.indiatimes.com', 'static.toiimg.com'],
    catalog_source: { kind: 'manual', offering_kinds: ['section', 'plan', 'programme'], note: 'A publisher sells sections, newsletters and subscriptions, not SKUs.' },
    offerings: [
      { kind: 'section', name: 'India', url: 'https://timesofindia.indiatimes.com/india', source: 'TOI site navigation' },
      { kind: 'section', name: 'City', url: 'https://timesofindia.indiatimes.com/city', source: 'TOI site navigation' },
      { kind: 'section', name: 'Videos', url: 'https://timesofindia.indiatimes.com/videos', source: 'TOI site navigation' },
      { kind: 'plan', name: 'TOI+', period: 'subscription', signup_url: 'https://timesofindia.indiatimes.com', source: 'TOI+ appears in TOI site navigation' },
    ],
  },
  {
    slug: 'toi-health-fitness', name: 'TOI Health & Fitness', tagline: 'Health, Fitness, Diet and Wellness',
    industry: 'Health & fitness content / events', website: 'https://timesofindia.indiatimes.com/life-style/health-fitness',
    preset: { label: 'TOI Health & Fitness', sector: 'Health & fitness media', blurb: 'The health vertical: fitness, diet and wellness content, plus seasonal event pushes such as marathon training and yoga-day campaigns.', verified_at: '2026-08-10', source: 'timesofindia.indiatimes.com/life-style/health-fitness (live page, TOI red #e21b22/#eb1b24)' },
    palette: { primary: '#EB1B24', accent: '#147014', ink: '#1A1A1A', surface: '#FFFFFF', surface_alt: '#F4F4F4', muted: '#595959', line: '#ECECEC', ok: '#147014', warn: '#c9a227', err: '#c0392b' },
    typography: {
      heading: { family: 'Rethink Sans', stack: "'Rethink Sans',-apple-system,BlinkMacSystemFont,Arial,sans-serif", google: true, weights: '600;700' },
      body: { family: 'Rethink Sans', stack: "'Rethink Sans',-apple-system,BlinkMacSystemFont,Arial,sans-serif", google: true, weights: '400;500' },
    },
    voice: {
      tone: 'encouraging, practical, evidence-led; coaches the reader without hype',
      preferred: ['routine', 'training plan', 'recovery', 'nutrition', 'mobility', 'beginner-friendly', 'evidence'],
      banned: ['miracle cure', 'detox tea', 'lose 10 kg in a week', 'doctors hate', 'burn fat fast', 'guaranteed results', 'cures'],
      no_em_dashes: true,
      notes: 'OBSERVED from public output, not official guidelines. HEALTH SAFETY: never make medical claims, never promise outcomes, never present content as diagnosis or treatment; attribute clinical statements to a named qualified source and add a consult-your-doctor line on training and diet content.',
    },
    claims: ['Health, fitness, diet and wellness coverage from The Times of India'],
    regions: [region('IN', 'INR', '₹', 'https://timesofindia.indiatimes.com/life-style/health-fitness')],
    asset_hosts: ['timesofindia.indiatimes.com', 'static.toiimg.com'],
    catalog_source: { kind: 'manual', offering_kinds: ['section', 'programme', 'event'], note: 'A health vertical promotes content sections, recurring programmes (training plans, daily routines) and date-bound events (yoga days, runs) - not SKUs.' },
    offerings: [
      { kind: 'section', name: 'Health & Fitness', url: 'https://timesofindia.indiatimes.com/life-style/health-fitness', source: 'Live TOI vertical' },
      { kind: 'section', name: 'Diet', url: 'https://timesofindia.indiatimes.com/life-style/health-fitness/diet', source: 'Live TOI vertical' },
      { kind: 'section', name: 'Weight Loss', url: 'https://timesofindia.indiatimes.com/life-style/health-fitness/weight-loss', source: 'Live TOI vertical' },
      { kind: 'programme', name: 'Daily morning routine series', cadence: 'daily', source: 'Recurring content format on the vertical' },
      { kind: 'programme', name: 'Marathon training plan (multi-week)', cadence: 'weekly', duration: '8-16 weeks', source: 'Recurring content format on the vertical' },
      { kind: 'event', name: 'International Day of Yoga', starts_at: '2027-06-21', recurrence: 'annual', source: 'UN-designated fixed date (21 June), covered by the vertical each year' },
    ],
  },
  {
    slug: 'apple', name: 'Apple', tagline: 'Think Different',
    industry: 'Consumer technology', website: 'https://www.apple.com',
    preset: { label: 'Apple', sector: 'Consumer technology', blurb: 'Minimal, product-led design system. Useful as a restraint benchmark: huge whitespace, one accent, no decoration.', verified_at: '2026-08-10', source: 'apple.com globalheader.css (#0071e3 accent, #1d1d1f ink, #f5f5f7 surface, SF Pro Text stack)' },
    palette: { primary: '#0071E3', accent: '#1D1D1F', ink: '#1D1D1F', surface: '#FFFFFF', surface_alt: '#F5F5F7', muted: '#6E6E73', line: '#D2D2D7', ok: '#1a7f37', warn: '#c9a227', err: '#c0392b' },
    typography: {
      heading: { family: 'SF Pro Display', stack: "'SF Pro Display','SF Pro Text',-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif", google: false, weights: '600;700' },
      body: { family: 'SF Pro Text', stack: "'SF Pro Text',-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif", google: false, weights: '400;500;600' },
    },
    voice: {
      tone: 'calm, confident, product-first; short sentences, concrete benefits, no superlative stacking',
      preferred: ['designed', 'built', 'so you can', 'simply', 'powerful', 'seamless'],
      banned: ['cheap', 'discount blowout', 'hurry', 'limited stock', 'act now', 'best ever in the world'],
      no_em_dashes: true,
      notes: 'OBSERVED from public output, not official guidelines. Let the product carry the claim; never stack superlatives or invent specifications.',
    },
    claims: ['Consumer technology products from Apple'],
    regions: [region('US', 'USD', '$', 'https://www.apple.com'), region('IN', 'INR', '₹', 'https://www.apple.com/in'), region('UK', 'GBP', '£', 'https://www.apple.com/uk')],
    asset_hosts: ['apple.com', 'www.apple.com', 'store.storeimages.cdn-apple.com'],
    catalog_source: { kind: 'none', offering_kinds: ['product', 'service', 'plan'], note: 'No public product feed; connect a real catalogue before generating product-level assets.' },
    // Product lines as read from apple.com global navigation on verified_at -
    // line level only, no invented models or prices.
    offerings: [
      { kind: 'product', name: 'iPhone', url: 'https://www.apple.com/iphone/', source: 'apple.com navigation' },
      { kind: 'product', name: 'Mac', url: 'https://www.apple.com/mac/', source: 'apple.com navigation' },
      { kind: 'product', name: 'iPad', url: 'https://www.apple.com/ipad/', source: 'apple.com navigation' },
      { kind: 'product', name: 'Apple Watch', url: 'https://www.apple.com/watch/', source: 'apple.com navigation' },
      { kind: 'plan', name: 'Apple One (services bundle)', url: 'https://www.apple.com/apple-one/', source: 'apple.com navigation' },
    ],
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   TEMPLATE PRESETS - the gallery's default entries.

   The five presets above were each read from that brand's own live site on
   their verified_at date. That is the only way this repo is allowed to state a
   brand's colours, and it does not scale: it needs a machine that can reach the
   site, one brand at a time.

   These entries widen the gallery without weakening that rule. A template
   preset ships a DECLARED DEFAULT design - a neutral greyscale palette and a
   system font stack that belong to nobody - plus the brand's own homepage. It
   asserts a name, a URL and a sector label, and nothing else.

   WHY GREYSCALE AND NOT "PROBABLY ABOUT RIGHT". A palette typed from memory is
   a brand fact nobody verified, and it is the single most visible field in the
   product: an operator who picks a preset and sees a plausible-looking colour
   has no reason to check it. Wrong-but-confident is worse here than obviously
   absent, so the default is a neutral that cannot be mistaken for a brand
   colour - the same reasoning logo-brief.js uses when it refuses to invent one.

   HOW THE REAL VALUES ARRIVE. Every template carries `needs_extraction` and the
   site to read. Picking one and pressing Read this site runs the extractor that
   already exists (brand-extract.js on ?op=extract), from the deployment, which
   can reach these hosts. Each field then arrives as a CANDIDATE with its source
   URL for the operator to accept - the same door every other automatic value
   comes through, and the same one `brand_field_provenance` guards.

   Voice, claims and offerings stay EMPTY with a marker. voice.banned in
   particular is never machine-filled, by rule.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Belongs to nobody, and passes validatePalette (light surface, AA on ink). */
const NEUTRAL_PALETTE = {
  primary: '#2B2B2B', accent: '#5A5A5A', ink: '#111111', surface: '#FFFFFF',
  surface_alt: '#F5F5F5', muted: '#6A6A6A', line: '#E4E4E4',
  ok: '#1a7f37', warn: '#c9a227', err: '#c0392b',
};
const NEUTRAL_TYPOGRAPHY = {
  heading: { family: 'system-ui', stack: "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif", google: false, weights: '600;700' },
  body: { family: 'system-ui', stack: "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif", google: false, weights: '400;500;600' },
};

const marker = (field, name) => `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${name}]`;

/* ── placeholder catalogue ────────────────────────────────────────────────
   A template preset has no catalogue until its site is harvested, and an empty
   catalogue makes the preset impossible to DEMO: every generated asset comes
   out image-free with a marker where the product should be.

   So each one carries a placeholder catalogue shaped by its sector: how many
   lines that kind of business runs, and what the line names look like. It
   exists to exercise the layouts.

   THREE THINGS IT DELIBERATELY IS NOT:

   1. NOT the brand's real products. The names are generic by construction
      ("Running Shoe 01"), never a real model name. A plausible-looking real
      product name is the failure here: an operator would believe it.
   2. NOT priced. A price is a fact about a brand, and inventing one is exactly
      what this repo refuses everywhere else. `price` is null and the renderers
      already handle a price-free product.
   3. NOT illustrated. There are no image URLs because we have none until the
      harvest runs, so assets render image-free with a marker rather than
      borrowing a photograph from anywhere.

   Every row carries `placeholder: true`, and `catalog_source.kind` is
   `placeholder`, so no caller can mistake this for a real catalogue without
   ignoring a field present on every single row. */
const SECTOR_LINES = {
  Sportswear: { lines: ['Running Shoe', 'Training Shoe', 'Lifestyle Sneaker', 'Track Jacket', 'Performance Tee'], per: 3 },
  'Fashion retail': { lines: ['Denim Jacket', 'Knit Sweater', 'Oxford Shirt', 'Chino Trouser', 'Wool Coat'], per: 4 },
  Marketplace: { lines: ['Category Bundle', 'Seasonal Edit', 'Everyday Essential', 'Member Offer'], per: 5 },
  Beauty: { lines: ['Cleanser', 'Serum', 'Moisturiser', 'Lip Colour', 'Sunscreen'], per: 4 },
  'Consumer electronics': { lines: ['Wireless Earbud', 'Smart Watch', 'Portable Speaker', 'Charging Dock'], per: 2 },
  'Consumer technology': { lines: ['Handset', 'Tablet', 'Laptop', 'Wearable'], per: 2 },
  Software: { lines: ['Starter Plan', 'Team Plan', 'Business Plan', 'Enterprise Plan'], per: 1 },
  Automotive: { lines: ['Compact Model', 'Saloon Model', 'SUV Model', 'Electric Model'], per: 1 },
  'Food and beverage': { lines: ['Signature Blend', 'Seasonal Drink', 'Bakery Item', 'Bundle Pack'], per: 3 },
  Streaming: { lines: ['Monthly Plan', 'Annual Plan', 'Family Plan'], per: 1 },
  Travel: { lines: ['City Break', 'Long Haul Fare', 'Stay Package', 'Loyalty Tier'], per: 2 },
  Fintech: { lines: ['Payments Plan', 'Payouts Plan', 'Checkout Product', 'Reporting Add-on'], per: 1 },
  Telecom: { lines: ['Prepaid Plan', 'Postpaid Plan', 'Data Add-on', 'Broadband Plan'], per: 2 },
  Eyewear: { lines: ['Optical Frame', 'Sunglass Frame', 'Reading Glass', 'Contact Lens'], per: 4 },
};

function placeholderCatalogue(t) {
  const spec = SECTOR_LINES[t.sector] || { lines: ['Product Line'], per: 3 };
  const rows = [];
  for (const line of spec.lines) {
    for (let i = 1; i <= spec.per; i++) {
      rows.push({
        title: `${line} ${String(i).padStart(2, '0')}`,
        handle: `${line.toLowerCase().replace(/\s+/g, '-')}-${String(i).padStart(2, '0')}`,
        product_type: line,
        // Null on purpose. See rule 2 above.
        price: null, compare_at: null, currency: '',
        // Empty on purpose. See rule 3 above.
        image_url: '', product_url: '',
        placeholder: true,
      });
    }
  }
  return rows;
}

function template(t) {
  return {
    slug: t.slug, name: t.name, tagline: '', industry: t.industry, website: t.website,
    preset: {
      label: t.name, sector: t.sector, blurb: t.blurb,
      // Not a date, because nothing was read. Anything else here would be a
      // verification claim, and this file's whole contract is that verified_at
      // means somebody looked.
      verified_at: null,
      // "Read my site" is the exact label on the button in extractBlock(). An
      // instruction that names a control by a slightly different name sends the
      // reader looking for something that is not on the page.
      source: "Not read from the brand's own site. Palette and typography below are this repo's neutral default, not this brand's design. Press Read my site on step 1 to extract the real values from " + t.website + ".",
      needs_extraction: true,
      palette_source: 'default',
      typography_source: 'default',
    },
    palette: { ...NEUTRAL_PALETTE },
    typography: JSON.parse(JSON.stringify(NEUTRAL_TYPOGRAPHY)),
    voice: {
      tone: '', preferred: [], banned: [], no_em_dashes: true,
      notes: marker('voice, tone and banned phrases', t.name) + " Nothing is inferred: a voice written from memory reads as approved guidance and is not.",
    },
    claims: [marker('verifiable claims', t.name)],
    regions: [],
    asset_hosts: [t.host],
    catalog_source: {
      kind: 'placeholder',
      offering_kinds: t.offering_kinds || ['product'],
      note: 'This catalogue is PLACEHOLDER: generic line names with no prices, no URLs and no images, present so the layouts can be exercised before the brand\'s own site is harvested. Run `npm run harvest:presets` from an environment with internet access to replace it, or connect a store.',
    },
    catalog_placeholder: placeholderCatalogue(t),
    offerings: [],
    data_gaps: [
      marker('brand palette', t.name), marker('typography', t.name),
      marker('voice', t.name), marker('offerings and catalogue', t.name),
      marker('regions and store URLs', t.name),
    ],
  };
}

/* Majors across deliberately different lifecycle shapes: a footwear drop, a
   grocery basket, a subscription renewal and a fintech activation are not the
   same programme, and the gallery is where an operator learns that. */
const TEMPLATE_BRANDS = [
  { slug: 'nike', name: 'Nike', industry: 'Sportswear and footwear', website: 'https://www.nike.com', host: 'nike.com', sector: 'Sportswear', blurb: 'Global sportswear. Template for a drop-led lifecycle: launch, restock and franchise anniversaries.' },
  { slug: 'adidas', name: 'Adidas', industry: 'Sportswear and footwear', website: 'https://www.adidas.com', host: 'adidas.com', sector: 'Sportswear', blurb: 'Sportswear and performance. Template for a franchise plus collaboration calendar.' },
  { slug: 'puma', name: 'Puma', industry: 'Sportswear and footwear', website: 'https://www.puma.com', host: 'puma.com', sector: 'Sportswear', blurb: 'Sportswear. Template for sponsorship-led and event-led pushes.' },
  { slug: 'new-balance', name: 'New Balance', industry: 'Sportswear and footwear', website: 'https://www.newbalance.com', host: 'newbalance.com', sector: 'Sportswear', blurb: 'Footwear. Template for a width and fit driven catalogue with long-running silhouettes.' },
  { slug: 'zara', name: 'Zara', industry: 'Fashion retail', website: 'https://www.zara.com', host: 'zara.com', sector: 'Fashion retail', blurb: 'Fast fashion. Template for a high-turnover seasonal drop cadence.' },
  { slug: 'hm', name: 'H&M', industry: 'Fashion retail', website: 'https://www2.hm.com', host: 'hm.com', sector: 'Fashion retail', blurb: 'Fashion retail. Template for seasonal collections plus a membership programme.' },
  { slug: 'uniqlo', name: 'Uniqlo', industry: 'Fashion retail', website: 'https://www.uniqlo.com', host: 'uniqlo.com', sector: 'Fashion retail', blurb: 'Apparel. Template for a core-basics catalogue with recurring seasonal ranges.' },
  { slug: 'levis', name: "Levi's", industry: 'Fashion retail', website: 'https://www.levi.com', host: 'levi.com', sector: 'Fashion retail', blurb: 'Denim. Template for a fit-and-size led catalogue with a strong core range.' },
  { slug: 'myntra', name: 'Myntra', industry: 'Fashion marketplace', website: 'https://www.myntra.com', host: 'myntra.com', sector: 'Marketplace', blurb: 'Fashion marketplace. Template for a multi-brand catalogue and event-led sale calendar.', offering_kinds: ['product', 'plan'] },
  { slug: 'flipkart', name: 'Flipkart', industry: 'E-commerce marketplace', website: 'https://www.flipkart.com', host: 'flipkart.com', sector: 'Marketplace', blurb: 'General marketplace. Template for category-wide sale events and a membership tier.', offering_kinds: ['product', 'plan'] },
  { slug: 'amazon', name: 'Amazon', industry: 'E-commerce marketplace', website: 'https://www.amazon.com', host: 'amazon.com', sector: 'Marketplace', blurb: 'General marketplace. Template for a subscription plus replenishment lifecycle.', offering_kinds: ['product', 'plan'] },
  { slug: 'nykaa', name: 'Nykaa', industry: 'Beauty retail', website: 'https://www.nykaa.com', host: 'nykaa.com', sector: 'Beauty', blurb: 'Beauty retail. Template for a replenishment and shade-led catalogue.' },
  { slug: 'sephora', name: 'Sephora', industry: 'Beauty retail', website: 'https://www.sephora.com', host: 'sephora.com', sector: 'Beauty', blurb: 'Beauty retail. Template for a loyalty-tier and sampling led programme.', offering_kinds: ['product', 'plan'] },
  { slug: 'loreal', name: "L'Oreal", industry: 'Beauty and personal care', website: 'https://www.loreal.com', host: 'loreal.com', sector: 'Beauty', blurb: 'Beauty group. Template for a house of brands with separate audiences per label.' },
  { slug: 'mamaearth', name: 'Mamaearth', industry: 'Beauty and personal care', website: 'https://mamaearth.in', host: 'mamaearth.in', sector: 'Beauty', blurb: 'D2C personal care. Template for a replenishment cycle with strong claim governance.' },
  { slug: 'boat', name: 'boAt', industry: 'Consumer electronics', website: 'https://www.boat-lifestyle.com', host: 'boat-lifestyle.com', sector: 'Consumer electronics', blurb: 'D2C audio and wearables. Template for a launch and accessory attach lifecycle.' },
  { slug: 'lenskart', name: 'Lenskart', industry: 'Eyewear retail', website: 'https://www.lenskart.com', host: 'lenskart.com', sector: 'Eyewear', blurb: 'Eyewear. Template for a prescription-led purchase with a long repeat cycle.', offering_kinds: ['product', 'service'] },
  { slug: 'samsung', name: 'Samsung', industry: 'Consumer technology', website: 'https://www.samsung.com', host: 'samsung.com', sector: 'Consumer technology', blurb: 'Consumer electronics. Template for a flagship launch plus trade-in programme.' },
  { slug: 'microsoft', name: 'Microsoft', industry: 'Software and devices', website: 'https://www.microsoft.com', host: 'microsoft.com', sector: 'Software', blurb: 'Software and devices. Template for a seat-based subscription lifecycle.', offering_kinds: ['plan', 'product'] },
  { slug: 'sony', name: 'Sony', industry: 'Consumer technology', website: 'https://www.sony.com', host: 'sony.com', sector: 'Consumer technology', blurb: 'Consumer electronics and entertainment. Template for hardware plus content attach.' },
  { slug: 'tesla', name: 'Tesla', industry: 'Automotive', website: 'https://www.tesla.com', host: 'tesla.com', sector: 'Automotive', blurb: 'Automotive. Template for a considered high-value purchase with a long consideration window.', offering_kinds: ['product', 'service'] },
  { slug: 'bmw', name: 'BMW', industry: 'Automotive', website: 'https://www.bmw.com', host: 'bmw.com', sector: 'Automotive', blurb: 'Automotive. Template for a dealer-assisted funnel and a servicing lifecycle.', offering_kinds: ['product', 'service'] },
  { slug: 'toyota', name: 'Toyota', industry: 'Automotive', website: 'https://www.toyota.com', host: 'toyota.com', sector: 'Automotive', blurb: 'Automotive. Template for a model-year calendar plus after-sales servicing.', offering_kinds: ['product', 'service'] },
  { slug: 'starbucks', name: 'Starbucks', industry: 'Food and beverage', website: 'https://www.starbucks.com', host: 'starbucks.com', sector: 'Food and beverage', blurb: 'Coffee retail. Template for a rewards programme and a seasonal menu calendar.', offering_kinds: ['product', 'plan'] },
  { slug: 'mcdonalds', name: "McDonald's", industry: 'Food and beverage', website: 'https://www.mcdonalds.com', host: 'mcdonalds.com', sector: 'Food and beverage', blurb: 'Quick service restaurants. Template for an app-led offer and visit-frequency programme.', offering_kinds: ['product', 'plan'] },
  { slug: 'coca-cola', name: 'Coca-Cola', industry: 'Food and beverage', website: 'https://www.coca-cola.com', host: 'coca-cola.com', sector: 'Food and beverage', blurb: 'Beverages. Template for a brand-led calendar with no direct catalogue.' },
  { slug: 'nestle', name: 'Nestle', industry: 'Food and beverage', website: 'https://www.nestle.com', host: 'nestle.com', sector: 'Food and beverage', blurb: 'FMCG group. Template for a house of brands sold through retail rather than direct.' },
  { slug: 'netflix', name: 'Netflix', industry: 'Streaming media', website: 'https://www.netflix.com', host: 'netflix.com', sector: 'Streaming', blurb: 'Streaming. Template for a renewal, win-back and churn-risk lifecycle.', offering_kinds: ['plan', 'programme'] },
  { slug: 'spotify', name: 'Spotify', industry: 'Streaming media', website: 'https://www.spotify.com', host: 'spotify.com', sector: 'Streaming', blurb: 'Audio streaming. Template for a free-to-paid upgrade and retention programme.', offering_kinds: ['plan', 'programme'] },
  { slug: 'airbnb', name: 'Airbnb', industry: 'Travel marketplace', website: 'https://www.airbnb.com', host: 'airbnb.com', sector: 'Travel', blurb: 'Travel marketplace. Template for a two-sided lifecycle with a seasonal booking window.', offering_kinds: ['service'] },
  { slug: 'makemytrip', name: 'MakeMyTrip', industry: 'Travel marketplace', website: 'https://www.makemytrip.com', host: 'makemytrip.com', sector: 'Travel', blurb: 'Travel booking. Template for a trip-cycle lifecycle with strong seasonality.', offering_kinds: ['service', 'plan'] },
  { slug: 'stripe', name: 'Stripe', industry: 'Financial technology', website: 'https://stripe.com', host: 'stripe.com', sector: 'Fintech', blurb: 'Payments infrastructure. Template for a developer-led B2B activation lifecycle.', offering_kinds: ['plan', 'service'] },
  { slug: 'razorpay', name: 'Razorpay', industry: 'Financial technology', website: 'https://razorpay.com', host: 'razorpay.com', sector: 'Fintech', blurb: 'Payments. Template for a B2B onboarding and activation programme.', offering_kinds: ['plan', 'service'] },
  { slug: 'paytm', name: 'Paytm', industry: 'Financial technology', website: 'https://paytm.com', host: 'paytm.com', sector: 'Fintech', blurb: 'Consumer payments. Template for a transaction-frequency and reactivation programme.', offering_kinds: ['service', 'plan'] },
  { slug: 'airtel', name: 'Airtel', industry: 'Telecommunications', website: 'https://www.airtel.in', host: 'airtel.in', sector: 'Telecom', blurb: 'Telecom. Template for a recharge and plan-renewal lifecycle.', offering_kinds: ['plan', 'service'] },
].map(template);

for (const t of TEMPLATE_BRANDS) PRESETS.push(t);

let n = 0;
for (const p of PRESETS) {
  const rec = { ...p, rights_note: RIGHTS, status: 'preset' };
  fs.writeFileSync(path.join(OUT, `${p.slug}.json`), JSON.stringify(rec, null, 2) + '\n', 'utf8');
  n++;
}

// Index the gallery reads (one small fetch instead of N).
const index = PRESETS.map((p) => ({
  slug: p.slug, name: p.name, tagline: p.tagline, industry: p.industry, website: p.website,
  label: p.preset.label, sector: p.preset.sector, blurb: p.preset.blurb,
  verified_at: p.preset.verified_at, source: p.preset.source,
  // The gallery must be able to say which of these two a card is, because the
  // swatch renders identically either way and a neutral default that looks
  // verified is the failure this whole split exists to prevent.
  palette_source: p.preset.palette_source || 'verified',
  typography_source: p.preset.typography_source || 'verified',
  needs_extraction: !!p.preset.needs_extraction,
  swatch: [p.palette.primary, p.palette.accent, p.palette.ink, p.palette.surface],
  heading_font: p.typography.heading.family, body_font: p.typography.body.family,
  has_catalog: !!(p.catalog_source && p.catalog_source.kind !== 'none' && p.catalog_source.kind !== 'placeholder'),
  catalog_kind: (p.catalog_source && p.catalog_source.kind) || 'none',
  placeholder_products: (p.catalog_placeholder || []).length,
  offering_kinds: (p.catalog_source && p.catalog_source.offering_kinds) || ['product'],
  offering_count: (p.offerings || []).length,
}));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  _note: 'Starter brand profiles for /onboarding. Generated by scripts/build-brand-presets.js - edit that file, not these. A preset with palette_source "verified" had every value read from the brand\'s own live site on verified_at, and its voice is OBSERVED from public output, never presented as internal guidelines. A preset with palette_source "default" carries this repo\'s neutral placeholder design and NOT the brand\'s: it asserts only a name, a homepage and a sector, and needs_extraction marks it for reading from that site.',
  rights_note: RIGHTS,
  count: index.length, presets: index,
}, null, 2) + '\n', 'utf8');

console.log(`Wrote ${n} brand presets + index to data/brands/presets/`);
for (const p of index) console.log(`  ${p.slug.padEnd(20)} ${p.swatch[0]}  ${p.sector}`);
