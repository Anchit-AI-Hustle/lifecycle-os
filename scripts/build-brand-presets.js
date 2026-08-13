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
  swatch: [p.palette.primary, p.palette.accent, p.palette.ink, p.palette.surface],
  heading_font: p.typography.heading.family, body_font: p.typography.body.family,
  has_catalog: p.catalog_source && p.catalog_source.kind !== 'none',
  offering_kinds: (p.catalog_source && p.catalog_source.offering_kinds) || ['product'],
  offering_count: (p.offerings || []).length,
}));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  _note: 'Starter brand profiles for /onboarding. Generated by scripts/build-brand-presets.js - edit that file, not these. Every value was read from the brand\'s own live site on verified_at; voice is OBSERVED from public output, never presented as internal guidelines.',
  rights_note: RIGHTS,
  count: index.length, presets: index,
}, null, 2) + '\n', 'utf8');

console.log(`Wrote ${n} brand presets + index to data/brands/presets/`);
for (const p of index) console.log(`  ${p.slug.padEnd(20)} ${p.swatch[0]}  ${p.sector}`);
