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
const { readSentence, sourcesSentence } = require('./lib/preset-observation.js');
/* `--out` and `--observed` exist for the harvest tests, which build a preset
   library from fixture observations into a temporary directory. The shipped
   build passes neither. */
function cliDir(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : fallback;
}
const OUT = cliDir('--out', path.join(ROOT, 'data/brands/presets'));
const OBSERVED = cliDir('--observed', path.join(ROOT, 'data', 'brands', 'observed'));
fs.mkdirSync(OUT, { recursive: true });

const RIGHTS = 'Template only. Public brand attributes observed from the brand\'s own site for building and demonstration; this is not a licence to use the brand\'s marks. Replace with your own approved guidelines before running a real programme.';

/* `home` marks the brand's HOME market, the one every "no market named"
   default resolves to. It is declared per preset from where the brand is
   registered and prices first, never inferred from list order: the order a
   record lists its markets in is presentation, not a decision. */
/* URL patterns are a fact about the STORE, and only a Shopify store has
   /products/{handle} and /collections/{slug}. Every preset used to carry
   tenant zero's Shopify patterns, so Apple, The Economic Times and The Times
   of India were recorded with product URLs their sites do not have (brand
   record audit, 2026-10-10). A preset states them only with `shopify: true`. */
const region = (code, currency, symbol, url, opts) => Object.assign({
  code, currency, symbol, store_url: url,
}, opts && opts.shopify ? { pdp_pattern: '{base}/products/{handle}', collection_pattern: '{base}/collections/{slug}' } : {},
opts && opts.home ? { home: true } : {});

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
    regions: [region('IN', 'INR', '₹', 'https://knickgasm.com', { home: true, shopify: true }), region('US', 'USD', '$', 'https://knickgasm.com', { shopify: true }), region('UK', 'GBP', '£', 'https://knickgasm.com', { shopify: true })],
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
    regions: [region('IN', 'INR', '₹', 'https://economictimes.indiatimes.com', { home: true })],
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
    regions: [region('IN', 'INR', '₹', 'https://timesofindia.indiatimes.com', { home: true })],
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
    regions: [region('IN', 'INR', '₹', 'https://timesofindia.indiatimes.com/life-style/health-fitness', { home: true })],
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
    regions: [region('US', 'USD', '$', 'https://www.apple.com', { home: true }), region('IN', 'INR', '₹', 'https://www.apple.com/in'), region('UK', 'GBP', '£', 'https://www.apple.com/uk')],
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

   HOW THE REAL VALUES ARRIVE. `scripts/harvest-presets.js` (run on GitHub
   Actions by .github/workflows/harvest-presets.yml) reads the brand's own
   site through the platform's rendered reader, and the brand's OTHER own
   material listed in `identity_sources` below, and writes
   `data/brands/observed/<slug>.observed.json`: every colour and family with
   the page, signal and date it was read from. This file copies those across
   when the palette passes validatePalette. Nothing read: the neutral default
   stays, with the reason. Voice, claims and prices are never filled from
   that file: a colour and a photograph a page published are not a tone of
   voice or a price.

   IDENTITY SOURCES. A home page that refuses an automated reader (a 403, a
   bot challenge) is not forced. The brand publishes its identity elsewhere
   too: a brand-guidelines or press page, a newsroom, a developer design page,
   its logo file. Each entry here is a URL on the brand's OWN registrable
   domain (or one its own site links to, which the harvest checks when it
   reads that page) - never a third party's "brand colours" page, an
   encyclopaedia or a logo site. The URL was DISCOVERED by searching; no value
   was taken from the search. The harvest reads it with the same reader, and
   every value it yields records that page. `what` says what the page is.

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
    identity_sources: (t.identity_sources || []).map((x) => ({ url: x.url, kind: x.kind || 'page', what: x.what || '' })),
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
  { slug: 'nike', name: 'Nike', industry: 'Sportswear and footwear', website: 'https://www.nike.com', host: 'nike.com', sector: 'Sportswear', blurb: 'Global sportswear. Template for a drop-led lifecycle: launch, restock and franchise anniversaries.', identity_sources: [{ url: 'https://about.nike.com/en', kind: 'page', what: 'Nike, Inc. corporate site' }, { url: 'https://about.nike.com/en/newsroom', kind: 'page', what: 'Nike newsroom' }] },
  { slug: 'adidas', name: 'Adidas', industry: 'Sportswear and footwear', website: 'https://www.adidas.com', host: 'adidas.com', sector: 'Sportswear', blurb: 'Sportswear and performance. Template for a franchise plus collaboration calendar.', identity_sources: [{ url: 'https://www.adidas-group.com/en/', kind: 'page', what: 'adidas Group corporate site' }, { url: 'https://report.adidas-group.com/', kind: 'page', what: 'adidas Group annual report' }] },
  { slug: 'puma', name: 'Puma', industry: 'Sportswear and footwear', website: 'https://www.puma.com', host: 'puma.com', sector: 'Sportswear', blurb: 'Sportswear. Template for sponsorship-led and event-led pushes.', identity_sources: [{ url: 'https://about.puma.com/en', kind: 'page', what: 'PUMA corporate site' }] },
  { slug: 'new-balance', name: 'New Balance', industry: 'Sportswear and footwear', website: 'https://www.newbalance.com', host: 'newbalance.com', sector: 'Sportswear', blurb: 'Footwear. Template for a width and fit driven catalogue with long-running silhouettes.', identity_sources: [{ url: 'https://jobs.newbalance.com/global/en', kind: 'page', what: 'New Balance careers site' }, { url: 'https://www.newbalance.com/about-us.html', kind: 'page', what: 'New Balance about page' }] },
  { slug: 'zara', name: 'Zara', industry: 'Fashion retail', website: 'https://www.zara.com', host: 'zara.com', sector: 'Fashion retail', blurb: 'Fast fashion. Template for a high-turnover seasonal drop cadence.', identity_sources: [{ url: 'https://www.zara.com/us/', kind: 'page', what: 'Zara US store front' }, { url: 'https://www.zara.com/es/en/', kind: 'page', what: 'Zara Spain store front (English)' }] },
  { slug: 'hm', name: 'H&M', industry: 'Fashion retail', website: 'https://www2.hm.com', host: 'hm.com', sector: 'Fashion retail', blurb: 'Fashion retail. Template for seasonal collections plus a membership programme.', identity_sources: [{ url: 'https://hmgroup.com/brands/', kind: 'page', what: 'H&M Group brands page' }, { url: 'https://hmgroup.com/about-us/', kind: 'page', what: 'H&M Group about page' }] },
  { slug: 'uniqlo', name: 'Uniqlo', industry: 'Fashion retail', website: 'https://www.uniqlo.com', host: 'uniqlo.com', sector: 'Fashion retail', blurb: 'Apparel. Template for a core-basics catalogue with recurring seasonal ranges.', identity_sources: [{ url: 'https://www.uniqlo.com/jp/cs/img/UNIQLOIQlogo2.png', kind: 'image', what: 'UNIQLO logo file' }, { url: 'https://faq-uk.uniqlo.com/', kind: 'page', what: 'UNIQLO UK help site' }] },
  { slug: 'levis', name: "Levi's", industry: 'Fashion retail', website: 'https://www.levi.com', host: 'levi.com', sector: 'Fashion retail', blurb: 'Denim. Template for a fit-and-size led catalogue with a strong core range.', identity_sources: [{ url: 'https://www.levi.com/US/en_US/', kind: 'page', what: 'Levi\'s US store front' }, { url: 'https://www.levistrauss.com/', kind: 'page', what: 'Levi Strauss & Co. corporate site (linked from levi.com)' }] },
  { slug: 'myntra', name: 'Myntra', industry: 'Fashion marketplace', website: 'https://www.myntra.com', host: 'myntra.com', sector: 'Marketplace', blurb: 'Fashion marketplace. Template for a multi-brand catalogue and event-led sale calendar.', offering_kinds: ['product', 'plan'], identity_sources: [{ url: 'https://jobs.myntra.com/favicon.png', kind: 'image', what: 'Myntra careers icon' }, { url: 'https://jobs.myntra.com/home', kind: 'page', what: 'Myntra careers site' }] },
  { slug: 'flipkart', name: 'Flipkart', industry: 'E-commerce marketplace', website: 'https://www.flipkart.com', host: 'flipkart.com', sector: 'Marketplace', blurb: 'General marketplace. Template for category-wide sale events and a membership tier.', offering_kinds: ['product', 'plan'], identity_sources: [{ url: 'https://stories.flipkart.com/', kind: 'page', what: 'Flipkart Stories, the company\'s own news site' }] },
  { slug: 'amazon', name: 'Amazon', industry: 'E-commerce marketplace', website: 'https://www.amazon.com', host: 'amazon.com', sector: 'Marketplace', blurb: 'General marketplace. Template for a subscription plus replenishment lifecycle.', offering_kinds: ['product', 'plan'], identity_sources: [{ url: 'https://www.aboutamazon.com/', kind: 'page', what: 'About Amazon, the company\'s own news site (linked from amazon.com)' }] },
  { slug: 'nykaa', name: 'Nykaa', industry: 'Beauty retail', website: 'https://www.nykaa.com', host: 'nykaa.com', sector: 'Beauty', blurb: 'Beauty retail. Template for a replenishment and shade-led catalogue.' },
  { slug: 'sephora', name: 'Sephora', industry: 'Beauty retail', website: 'https://www.sephora.com', host: 'sephora.com', sector: 'Beauty', blurb: 'Beauty retail. Template for a loyalty-tier and sampling led programme.', offering_kinds: ['product', 'plan'], identity_sources: [{ url: 'https://newsroom.sephora.com/wp-content/uploads/2022/05/cropped-favicon-192x192.png', kind: 'image', what: 'Sephora newsroom icon' }, { url: 'https://newsroom.sephora.com/', kind: 'page', what: 'Sephora newsroom' }] },
  { slug: 'loreal', name: "L'Oreal", industry: 'Beauty and personal care', website: 'https://www.loreal.com', host: 'loreal.com', sector: 'Beauty', blurb: 'Beauty group. Template for a house of brands with separate audiences per label.', identity_sources: [{ url: 'https://www.loreal.com/en/mediaroom/', kind: 'page', what: 'L\'Oreal Groupe mediaroom' }, { url: 'https://careers.loreal.com/', kind: 'page', what: 'L\'Oreal Groupe careers site' }] },
  { slug: 'mamaearth', name: 'Mamaearth', industry: 'Beauty and personal care', website: 'https://mamaearth.in', host: 'mamaearth.in', sector: 'Beauty', blurb: 'D2C personal care. Template for a replenishment cycle with strong claim governance.' },
  { slug: 'boat', name: 'boAt', industry: 'Consumer electronics', website: 'https://www.boat-lifestyle.com', host: 'boat-lifestyle.com', sector: 'Consumer electronics', blurb: 'D2C audio and wearables. Template for a launch and accessory attach lifecycle.', identity_sources: [{ url: 'https://www.boat-lifestyle.com/pages/contact-us', kind: 'page', what: 'boAt contact page' }] },
  { slug: 'lenskart', name: 'Lenskart', industry: 'Eyewear retail', website: 'https://www.lenskart.com', host: 'lenskart.com', sector: 'Eyewear', blurb: 'Eyewear. Template for a prescription-led purchase with a long repeat cycle.', offering_kinds: ['product', 'service'], identity_sources: [{ url: 'https://www.lenskart.com/about-us', kind: 'page', what: 'Lenskart about page' }] },
  { slug: 'samsung', name: 'Samsung', industry: 'Consumer technology', website: 'https://www.samsung.com/us/', host: 'samsung.com', sector: 'Consumer technology', blurb: 'Consumer electronics. Template for a flagship launch plus trade-in programme.', identity_sources: [{ url: 'https://resources.samsung.com/etc.clientlibs/samsung/clientlibs/consumer/global/clientlib-common/resources/images/Favicon.png', kind: 'image', what: 'Samsung site icon' }, { url: 'https://www.samsung.com/us/about-us/brand-identity/', kind: 'page', what: 'Samsung brand identity' }] },
  { slug: 'microsoft', name: 'Microsoft', industry: 'Software and devices', website: 'https://www.microsoft.com', host: 'microsoft.com', sector: 'Software', blurb: 'Software and devices. Template for a seat-based subscription lifecycle.', offering_kinds: ['plan', 'product'] },
  { slug: 'sony', name: 'Sony', industry: 'Consumer technology', website: 'https://www.sony.com', host: 'sony.com', sector: 'Consumer technology', blurb: 'Consumer electronics and entertainment. Template for hardware plus content attach.', identity_sources: [{ url: 'https://www.sony.co.jp/en/favicon.ico', kind: 'image', what: 'Sony Group icon' }, { url: 'https://www.sony.co.jp/en/', kind: 'page', what: 'Sony Group global site' }] },
  { slug: 'tesla', name: 'Tesla', industry: 'Automotive', website: 'https://www.tesla.com', host: 'tesla.com', sector: 'Automotive', blurb: 'Automotive. Template for a considered high-value purchase with a long consideration window.', offering_kinds: ['product', 'service'], identity_sources: [{ url: 'https://www.tesla.cn/themes/custom/tesla_frontend/assets/favicons/favicon-196x196.png', kind: 'image', what: 'Tesla icon' }, { url: 'https://www.tesla.cn/', kind: 'page', what: 'Tesla China site' }] },
  { slug: 'bmw', name: 'BMW', industry: 'Automotive', website: 'https://www.bmw.com', host: 'bmw.com', sector: 'Automotive', blurb: 'Automotive. Template for a dealer-assisted funnel and a servicing lifecycle.', offering_kinds: ['product', 'service'], identity_sources: [{ url: 'https://www.bmwgroup.com/etc.clientlibs/grpw-web/clientlibs/grpw-base/resources/images/logo/BMW_dark.svg', kind: 'image', what: 'BMW roundel' }, { url: 'https://www.bmwgroup.com/en.html', kind: 'page', what: 'BMW Group corporate site' }] },
  { slug: 'toyota', name: 'Toyota', industry: 'Automotive', website: 'https://www.toyota.com', host: 'toyota.com', sector: 'Automotive', blurb: 'Automotive. Template for a model-year calendar plus after-sales servicing.', offering_kinds: ['product', 'service'], identity_sources: [{ url: 'https://brand.toyota.com/guidelines/visual/brand-colors', kind: 'page', what: 'Toyota brand guidelines: brand colours' }, { url: 'https://pressroom.toyota.com/', kind: 'page', what: 'Toyota newsroom' }] },
  { slug: 'starbucks', name: 'Starbucks', industry: 'Food and beverage', website: 'https://www.starbucks.com', host: 'starbucks.com', sector: 'Food and beverage', blurb: 'Coffee retail. Template for a rewards programme and a seasonal menu calendar.', offering_kinds: ['product', 'plan'] },
  { slug: 'mcdonalds', name: "McDonald's", industry: 'Food and beverage', website: 'https://www.mcdonalds.com', host: 'mcdonalds.com', sector: 'Food and beverage', blurb: 'Quick service restaurants. Template for an app-led offer and visit-frequency programme.', offering_kinds: ['product', 'plan'], identity_sources: [{ url: 'https://corporate.mcdonalds.com/corpmcd/our-stories/media-assets-library/logos.html', kind: 'page', what: 'McDonald\'s media assets: logos' }, { url: 'https://corporate.mcdonalds.com/corpmcd/home.html', kind: 'page', what: 'McDonald\'s corporate site' }, { url: 'https://careers.mcdonalds.com/', kind: 'page', what: 'McDonald\'s careers site' }] },
  { slug: 'coca-cola', name: 'Coca-Cola', industry: 'Food and beverage', website: 'https://www.coca-cola.com', host: 'coca-cola.com', sector: 'Food and beverage', blurb: 'Beverages. Template for a brand-led calendar with no direct catalogue.' },
  { slug: 'nestle', name: 'Nestle', industry: 'Food and beverage', website: 'https://www.nestle.com', host: 'nestle.com', sector: 'Food and beverage', blurb: 'FMCG group. Template for a house of brands sold through retail rather than direct.', identity_sources: [{ url: 'https://www.nestle.com/media', kind: 'page', what: 'Nestle media page' }, { url: 'https://www.nestle.com/about', kind: 'page', what: 'Nestle about page' }] },
  { slug: 'netflix', name: 'Netflix', industry: 'Streaming media', website: 'https://www.netflix.com', host: 'netflix.com', sector: 'Streaming', blurb: 'Streaming. Template for a renewal, win-back and churn-risk lifecycle.', offering_kinds: ['plan', 'programme'], identity_sources: [{ url: 'https://www.netflix.com/login', kind: 'page', what: 'Netflix sign-in page' }, { url: 'https://jobs.netflix.com/', kind: 'page', what: 'Netflix jobs site' }, { url: 'https://brand.netflix.com/en/', kind: 'page', what: 'Netflix brand site' }] },
  { slug: 'spotify', name: 'Spotify', industry: 'Streaming media', website: 'https://www.spotify.com', host: 'spotify.com', sector: 'Streaming', blurb: 'Audio streaming. Template for a free-to-paid upgrade and retention programme.', offering_kinds: ['plan', 'programme'], identity_sources: [{ url: 'https://developer.spotify.com/images/favicon.png', kind: 'image', what: 'Spotify developer-site icon' }, { url: 'https://developer.spotify.com/documentation/design', kind: 'page', what: 'Spotify design and branding guidelines' }, { url: 'https://newsroom.spotify.com/', kind: 'page', what: 'Spotify newsroom' }] },
  { slug: 'airbnb', name: 'Airbnb', industry: 'Travel marketplace', website: 'https://www.airbnb.com', host: 'airbnb.com', sector: 'Travel', blurb: 'Travel marketplace. Template for a two-sided lifecycle with a seasonal booking window.', offering_kinds: ['service'] },
  { slug: 'makemytrip', name: 'MakeMyTrip', industry: 'Travel marketplace', website: 'https://www.makemytrip.com', host: 'makemytrip.com', sector: 'Travel', blurb: 'Travel booking. Template for a trip-cycle lifecycle with strong seasonality.', offering_kinds: ['service', 'plan'], identity_sources: [{ url: 'https://www.makemytrip.com/flights/', kind: 'page', what: 'MakeMyTrip flights page' }, { url: 'https://careers.makemytrip.com/', kind: 'page', what: 'MakeMyTrip careers site' }, { url: 'https://investors.makemytrip.com/', kind: 'page', what: 'MakeMyTrip investor relations' }] },
  { slug: 'stripe', name: 'Stripe', industry: 'Financial technology', website: 'https://stripe.com', host: 'stripe.com', sector: 'Fintech', blurb: 'Payments infrastructure. Template for a developer-led B2B activation lifecycle.', offering_kinds: ['plan', 'service'] },
  { slug: 'razorpay', name: 'Razorpay', industry: 'Financial technology', website: 'https://razorpay.com', host: 'razorpay.com', sector: 'Fintech', blurb: 'Payments. Template for a B2B onboarding and activation programme.', offering_kinds: ['plan', 'service'] },
  { slug: 'paytm', name: 'Paytm', industry: 'Financial technology', website: 'https://paytm.com', host: 'paytm.com', sector: 'Fintech', blurb: 'Consumer payments. Template for a transaction-frequency and reactivation programme.', offering_kinds: ['service', 'plan'], identity_sources: [{ url: 'https://pwebassets.paytm.com/commonwebassets/paytmweb/footer/images/paytmLogo.svg', kind: 'image', what: 'Paytm logo file' }, { url: 'https://paytm.com/about-us', kind: 'page', what: 'Paytm about page' }] },
  { slug: 'airtel', name: 'Airtel', industry: 'Telecommunications', website: 'https://www.airtel.in', host: 'airtel.in', sector: 'Telecom', blurb: 'Telecom. Template for a recharge and plan-renewal lifecycle.', offering_kinds: ['plan', 'service'] },
].map(template);

for (const t of TEMPLATE_BRANDS) PRESETS.push(t);

const HAND_VERIFIED = new Set(['knickgasm', 'economic-times', 'times-of-india', 'toi-health-fitness', 'apple']);

/**
 * A v3 palette is applied only when every value that is NOT derived names a
 * read that actually produced material (rendered a page, or drew a logo file)
 * and was the brand's own. A file that claims a palette from a read that was
 * blocked, refused or never made gets nothing - whatever it carries.
 */
function v3PaletteTrusted(obs) {
  const good = new Set((obs.reads || []).filter((r) => r && r.ok && (r.renderer === 'rendered' || r.renderer === 'image') && r.owned).map((r) => r.url));
  if (!good.size) return false;
  const ev = obs.palette_evidence || {};
  for (const role of ['primary', 'accent', 'ink', 'surface', 'surface_alt', 'muted']) {
    const e = ev[role];
    if (!e || e.derived || e.absent || !e.value) continue;
    if (!good.has(e.read_url)) return false;
  }
  return !!(ev.primary && ev.primary.value && ev.primary.value === String(obs.palette.primary).toLowerCase());
}

/**
 * Copy an observation onto a preset. Hand-verified profiles keep the palette
 * and type that were read when they were written; an observation may only add
 * the logo and the image URLs. A template takes the observed palette and type
 * only when the observation passed the palette gate (`palette_ok`).
 *
 * Three formats arrive here. `preset-observation/3` (2026-10-05) carries every
 * read - the home page and the brand's other own material (identity_sources) -
 * and per value the read, page, signal and date it came from. `/2` is the
 * home page alone. The unversioned format is the 2026-09-30 observer's, still
 * read so a partial re-harvest does not wipe the brands it did not touch.
 */
/** A careers widget's colour, or one logo nothing else agrees with, is not an accent. */
const VENDOR_MARK = /glassdoor|onetrust|trustarc|cookiebot|truste|quantcast|didomi|osano|usercentrics/i;
function dropForeignAccent(rec) {
  const ev = rec.preset.palette_evidence || {};
  const accent = ev.accent;
  if (!rec.palette.accent || !accent || accent.absent) return;
  const blob = `${accent.signal || ''} ${(accent.source && accent.source.selector) || ''} ${(accent.source && accent.source.property) || ''}`;
  const vendor = VENDOR_MARK.test(blob);
  const loneLogo = accent.kind === 'logo-image' && !(accent.corroborated_by || []).length && ((ev.primary && ev.primary.corroborated_by) || []).length;
  if (!vendor && !loneLogo) return;
  const was = rec.palette.accent;
  delete rec.palette.accent;
  ev.accent = Object.assign({}, accent, {
    value: '', absent: true,
    note: vendor
      ? `The second colour the reader found (${was}) was measured on a third-party widget, so this preset has no accent.`
      : `The second colour the reader found (${was}) is one logo nothing else on the brand's material agrees with, so this preset has no accent.`,
  });
}

function absorbObservation(rec) {
  // Kept OUT of the presets directory: every reader of it treats each
  // *.json there as a brand record (CLAUDE.md, 2026-10-03).
  const file = path.join(OBSERVED, `${rec.slug}.observed.json`);
  if (!fs.existsSync(file)) return;
  let obs;
  try { obs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return; }
  if (!obs) return;
  const v2 = obs.format === 'preset-observation/2';
  const v3 = obs.format === 'preset-observation/3';
  const versioned = v2 || v3;

  // A read that did not produce a palette is still a fact about the read:
  // which state, when, and why. It carries no colour, so nothing below runs.
  if (versioned && obs.read_attempt && !HAND_VERIFIED.has(rec.slug)) {
    rec.preset.read_attempt = {
      renderer: obs.read_attempt.renderer, at: obs.read_attempt.at || obs.observed_at || null,
      host: obs.read_attempt.host || '', reason: String(obs.read_attempt.reason || '').slice(0, 400),
    };
    if (v3 && (obs.reads || []).some((r) => r.role === 'identity source')) rec.preset.read_sources_note = sourcesSentence(obs.reads);
  }
  if (!obs.ok) return;

  const assets = (obs.assets || []).filter((a) => a && /^https:\/\//i.test(a.url)).slice(0, 8);
  if (assets.length) rec.brand_assets = assets.map((a) => ({
    url: a.url, role: a.role || 'photograph', alt: a.alt || '', found_on: a.found_on || obs.landed || '', signal: a.signal || '',
  }));
  if (obs.logo_url && /^https:\/\//i.test(obs.logo_url) && !rec.logo_url) {
    rec.logo_url = obs.logo_url;
    rec.preset.logo_signal = obs.logo_signal || '';
  }
  const hosts = new Set(rec.asset_hosts || []);
  for (const a of rec.brand_assets || []) {
    try { hosts.add(new URL(a.url).host); } catch (_) { /* a URL that does not parse is not a host */ }
  }
  if (rec.logo_url) {
    try { hosts.add(new URL(rec.logo_url).host); } catch (_) { /* same */ }
  }
  rec.asset_hosts = [...hosts].filter((h) => h && !/doubleclick|google-analytics|facebook\.com|gstatic/i.test(h)).slice(0, 8);

  if (HAND_VERIFIED.has(rec.slug)) return;
  if (!obs.palette_ok || !obs.palette || !obs.palette.primary) return;
  // A v2 palette needs a rendered home page; a v3 palette needs every value to
  // name a read of the brand's own material that produced something.
  if (v2 && obs.renderer !== 'rendered') return;
  if (v3 && !v3PaletteTrusted(obs)) return;

  rec.palette = Object.assign({}, obs.palette);
  rec.preset.palette_source = 'verified';
  rec.preset.palette_evidence = (versioned ? obs.palette_evidence : obs.evidence) || {};
  // No second colour, and never the primary painted twice and called an accent.
  // A stored read can also carry a vendor widget colour or one logo nothing
  // else agrees with; those are not the brand's second colour either.
  dropForeignAccent(rec);
  if (!rec.palette.accent || String(rec.palette.accent).toLowerCase() === String(rec.palette.primary).toLowerCase()) delete rec.palette.accent;
  rec.preset.verified_at = obs.observed_at || null;
  rec.preset.needs_extraction = false;
  rec.preset.source = obs.source || rec.preset.source;
  delete rec.preset.read_attempt;
  delete rec.preset.read_sources_note;
  if (versioned) {
    rec.preset.renderer = obs.renderer || 'rendered';
    rec.preset.reader = obs.reader || null;
    rec.preset.read_pages = (obs.pages || []).slice(0, 4);
    rec.preset.regression = obs.regression || null;
    if ((obs.conflicts || []).length) rec.preset.conflicts = obs.conflicts.slice(0, 4);
  }
  if (v3) {
    // Which pages the values came from (the home page, or the brand's other
    // own material when the home page refused the reader).
    const ev = obs.palette_evidence || {};
    rec.preset.read_from = [...new Set(['primary', 'accent', 'surface', 'ink'].map((r) => ev[r] && !ev[r].absent && ev[r].read_url).filter(Boolean))];
    rec.preset.reads = (obs.reads || []).map((r) => ({ url: r.url, role: r.role, what: r.what || '', renderer: r.renderer, owned: r.owned ? r.owned.how : '', reason: r.reason ? String(r.reason).slice(0, 200) : '' }));
    if (obs.home_attempt) rec.preset.home_attempt = obs.home_attempt;
  }

  const type = obs.typography || {};
  if (type.heading && type.heading.family && type.body && type.body.family) {
    const slot = (t, w) => {
      const out = { family: t.family, stack: t.stack, google: !!t.google, weights: t.weights || w };
      // The family the role renders in, and whether this app can load it. A
      // brand's own web font is named and shown in the site's fallback stack;
      // it is never swapped for a lookalike.
      if (versioned) Object.assign(out, { kind: t.kind || '', loadable: !!t.loadable, note: t.note || '' });
      return out;
    };
    rec.typography = { heading: slot(type.heading, '600;700'), body: slot(type.body, '400;500;600') };
    rec.preset.typography_source = 'verified';
    rec.preset.typography_evidence = versioned
      ? { heading: Object.assign({}, type.heading.source || {}, { observed_at: obs.observed_at || '' }), body: Object.assign({}, type.body.source || {}, { observed_at: obs.observed_at || '' }) }
      : { heading: type.heading.signal || '', body: type.body.signal || '' };
  }

  // A photograph the site published is NOT the photograph of a placeholder
  // line (2026-10-03). This block used to hand the page's images out to the
  // placeholder rows in order, so "Signature Blend 01" carried whatever the
  // home page showed first - a touch icon, a gift card - and a mailer would
  // render it as that product's picture. The image was real; the pairing was
  // invented, which is the zero-fabrication rule broken one field over. The
  // photographs stay in `brand_assets`, each with the page it was found on,
  // and a placeholder row stays image-free until a real catalogue arrives.
  rec.data_gaps = (rec.data_gaps || []).filter((g) => !/brand palette|typography/.test(g));
}

/** One or two sentences for a read card (see `palette_note`). */
function paletteNote(p) {
  const out = [];
  const ev = (p.preset.palette_evidence || {}).primary || {};
  let host = '';
  try { host = new URL(p.website).hostname; } catch (_) { host = p.website; }
  if (/monochrome/.test(String(ev.signal || ''))) {
    out.push(`Monochrome: ${host} renders no brand colour beyond black and white, so the primary is the ${p.palette.primary} of its call to action.`);
  }
  const home = p.preset.home_attempt;
  const from = (p.preset.read_from || []).map((u) => { try { return new URL(u).hostname; } catch (_) { return ''; } }).filter((h, i, a) => h && a.indexOf(h) === i);
  if (home && from.length) {
    out.push(`${home.host || host} refused an automated read (${home.renderer}); these values come from the brand's own ${from.join(', ')}.`);
  }
  return out.join(' ');
}

/** How a family renders in this app: by name, or named and shown in fallback. */
function fontLine(t) {
  if (!t || !t.family) return '';
  if (t.google) return t.family;
  const system = t.kind === 'local' || t.kind === 'generic'
    || /^(system-ui|-apple-system|blinkmacsystemfont|segoe ui|helvetica|helvetica neue|arial|georgia|times new roman|verdana|tahoma)$/i.test(t.family);
  if (system) return `${t.family} (system font)`;
  // Served from the brand's own host, which this app does not load.
  return `${t.family} (brand font, shown in fallback)`;
}

let n = 0;
for (const p of PRESETS) {
  absorbObservation(p);
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
  swatch: [p.palette.primary, p.palette.accent || p.palette.primary, p.palette.ink, p.palette.surface],
  // The four roles the card paints, each named, and whether the value is the
  // one the site renders or DERIVED from it (kept exact in palette_evidence).
  // A role the brand does not render (no second colour: no accent) is not
  // painted at all rather than painted with another role's colour.
  swatches: ['primary', 'accent', 'surface', 'ink'].filter((role) => p.palette[role]).map((role) => {
    const ev = (p.preset.palette_evidence || {})[role] || {};
    return { role, value: p.palette[role], derived: !!ev.derived, exact: ev.derived ? (ev.exact || '') : undefined };
  }),
  // Where the values were read: the home page's host, or the brand's other
  // own pages when the home page refused an automated reader.
  read_from: (p.preset.read_from || []).map((u) => { try { return new URL(u).hostname; } catch (_) { return ''; } }).filter((h, i, a) => h && a.indexOf(h) === i),
  hand_verified: HAND_VERIFIED.has(p.slug),
  identity_sources: p.identity_sources || [],
  heading_font: p.typography.heading.family, body_font: p.typography.body.family,
  heading_stack: p.typography.heading.stack, body_stack: p.typography.body.stack,
  heading_google: p.typography.heading.google !== false, body_google: p.typography.body.google !== false,
  heading_line: fontLine(p.typography.heading), body_line: fontLine(p.typography.body),
  // The mark the read actually found (the logo element, else the site's own
  // icon). The gallery paints it; a card with no read has none.
  logo_url: /^https:\/\//i.test(p.logo_url || '') ? p.logo_url : '',
  read_attempt: p.preset.read_attempt || null,
  // One sentence the gallery prints as it is: why this card is still on the
  // default ("<host> blocked an automated read on <date>.").
  read_note: p.preset.palette_source === 'default' ? [readSentence(p.preset.read_attempt), p.preset.read_sources_note || ''].filter(Boolean).join(' ') : '',
  // On a card that WAS read: what a reader would otherwise mistake for an
  // error - a black primary, or values read off pages other than the home.
  palette_note: p.preset.palette_source === 'default' ? '' : paletteNote(p),
  renderer: p.preset.renderer || null,
  regression: p.preset.regression || null,
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
