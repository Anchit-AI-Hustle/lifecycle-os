// Brand fixtures spanning every parameter a brand record can carry (and lack):
// a store with a catalogue row and three markets, an app, a news publisher, a
// bare name, a record with no market, a regulated US/UK supplement, a near-black
// palette, a pale palette, unit-heavy claims (100W, 20000mAh), a vowel-led
// name with no tagline, a 65-character name, and a name with a dash and accents.
const BRANDS = [
  { id: 'device:store', slug: 'brewfold', name: 'Brewfold Coffee', website: 'https://brewfold.example', industry: 'coffee', tagline: 'Small-lot coffee roasted on Tuesdays',
    palette: { primary: '#7A3E1D', accent: '#E0A458', ink: '#2B1B12', surface: '#FFF8F0' }, typography: { heading: { family: 'Fraunces' }, body: { family: 'Inter' } },
    regions: [{ code: 'IN', currency: 'INR', home: true, store_url: 'https://brewfold.example' }, { code: 'US', currency: 'USD', store_url: 'https://brewfold.example/en-us' }, { code: 'UK', currency: 'GBP' }],
    claims: ['Roasted every Tuesday', 'Shipped within 48 hours of roasting'], legal_entity: 'Brewfold Coffee LLP, Pune, India', channels: ['sms', 'whatsapp', 'push'],
    voice: { tone: 'warm, plain', banned: ['artisanal', 'world-class'] },
    __hero: { title: 'Kalledevarapura Estate 250g', price: 640, handle: 'kalledevarapura-250g', category: 'Coffee beans', image: 'https://brewfold.example/img/k250.jpg' } },
  { id: 'device:app', slug: 'famapp', name: 'Famapp', website: 'https://famapp.example', industry: 'family app', tagline: 'The family superapp for papers, health details and an emergency card that works offline',
    palette: { primary: '#3A1450', accent: '#F5A623', ink: '#1D1320', surface: '#FFFAF0' }, regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Works offline', 'Consent at the core'], legal_entity: 'Famapp Technologies Pvt Ltd, Bengaluru, India' },
  { id: 'device:news', slug: 'gazette', name: 'Ledgerline Gazette', website: 'https://ledgerline.example', industry: 'news publishing', tagline: 'Pune news, checked twice by the desk',
    palette: { primary: '#7B2D5E', accent: '#C8A13B', ink: '#2A1F33', surface: '#FBF7EF' }, regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Reporters in all 14 Pune wards'],
    offerings: [{ kind: 'subscription', name: 'Morning Ledger', url: 'https://ledgerline.example/ledger' }], legal_entity: 'Ledgerline Media LLP, Pune, India', channels: ['push'] },
  { id: 'device:bare', slug: 'bareco', name: 'Bareco', regions: [{ code: 'IN', home: true }] },
  { id: 'device:none', slug: 'nomarket', name: 'Nomarket Labs' },
  { id: 'device:supp', slug: 'vitalwick', name: 'Vitalwick', website: 'https://vitalwick.example', industry: 'dietary supplements', tagline: 'Magnesium for evenings',
    palette: { primary: '#2F6B4F', accent: '#F2C14E', ink: '#17251E', surface: '#F7FBF8' }, regions: [{ code: 'US', currency: 'USD', home: true }, { code: 'UK', currency: 'GBP' }],
    claims: ['Third-party tested for heavy metals', '200mg magnesium glycinate per serving'], legal_entity: 'Vitalwick Inc., Austin, TX, USA', channels: ['sms'] },
  { id: 'device:dark', slug: 'onyxline', name: 'Onyxline', website: 'https://onyxline.example', industry: 'apparel', tagline: 'Black basics, cut in Tiruppur',
    palette: { primary: '#0D0D0D', accent: '#111111', ink: '#0A0A0A', surface: '#FFFFFF' }, regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ['Cut and sewn in Tiruppur'], legal_entity: 'Onyxline Apparel Pvt Ltd, Tiruppur' },
  { id: 'device:pale', slug: 'paleoak', name: 'Pale Oak Home', website: 'https://paleoak.example', industry: 'home decor', tagline: 'Linen for slow mornings',
    palette: { primary: '#F4EFE6', accent: '#EDE6DA', ink: '#3B3530', surface: '#FFFDF9' }, regions: [{ code: 'UK', currency: 'GBP', home: true }, { code: 'GLOBAL' }], claims: ['Stonewashed European linen'], legal_entity: 'Pale Oak Home Ltd, Bristol, UK' },
  { id: 'device:units', slug: 'voltnest', name: 'Voltnest', website: 'https://voltnest.example', industry: 'electronics', tagline: 'The 100W charger that fits a pocket',
    palette: { primary: '#1F4FD8', accent: '#22C3A6', ink: '#0E1A33', surface: '#F5F8FF' }, regions: [{ code: 'IN', currency: 'INR', home: true }, { code: 'AE', currency: 'AED' }],
    claims: ['100W GaN charging', '20000mAh in 300g'], legal_entity: 'Voltnest Devices Pvt Ltd, Noida', channels: ['sms', 'whatsapp', 'push'],
    __hero: { title: 'Voltnest Pro 100W GaN', price: 3499, handle: 'pro-100w', category: 'Chargers' } },
  { id: 'device:vowel', slug: 'arya', name: 'Arya Organics', website: 'https://aryaorganics.example', industry: 'skincare', tagline: '', palette: { primary: '#B4547A', accent: '#F0C987', ink: '#2E1A24', surface: '#FFF9FB' },
    regions: [{ code: 'IN', currency: 'INR', home: true }], claims: [], legal_entity: '' },
  { id: 'device:long', slug: 'longname', name: 'The Extraordinarily Long Named Heritage Tea Company of Darjeeling', website: 'https://longtea.example', industry: 'tea',
    tagline: 'First flush Darjeeling, picked by hand on estates above two thousand metres and packed within the week', palette: { primary: '#5B7F3A', accent: '#D9A441', ink: '#1F2A16', surface: '#FBFAF2' },
    regions: [{ code: 'IN', currency: 'INR', home: true }, { code: 'US', currency: 'USD' }], claims: ['Packed within 7 days of picking'], legal_entity: 'Heritage Tea Co., Darjeeling' },
  { id: 'device:unicode', slug: 'chai', name: 'Chāy & Co. — Café', website: 'https://chay.example', industry: 'café', tagline: 'Masala chai, brewed "slow" & strong',
    palette: { primary: '#C2410C', accent: '#FCD34D', ink: '#1C1917', surface: '#FFFBEB' }, regions: [{ code: 'IN', currency: 'INR', home: true }], claims: ["Brewed for 12 minutes, not 2"], legal_entity: 'Chay & Co, Mumbai', voice: { banned: ['authentic'] } },
];
module.exports = { BRANDS };
