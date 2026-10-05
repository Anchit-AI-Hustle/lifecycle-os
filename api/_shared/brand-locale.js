'use strict';
/**
 * brand-locale.js - every brand-specific DEFAULT, read from the brand.
 * ---------------------------------------------------------------------------
 * The operator's report (2026-10-05): an Indian momos brand pressed "Run
 * Agentic Flow" and the page printed "Running agentic flow - Premium, US".
 * The page had no plan rows, so it fell to a literal 'US'. The same habit
 * lived in ~40 places: a market that defaulted to 'US' or 'UK', a price
 * printed with '$', a send hour typed for US Eastern, a festival list read
 * for whichever market the slot happened to fall to.
 *
 * One rule, one module: a market, currency, number format, time zone, dialling
 * code, store URL, legal line or social handle comes from the ACTIVE brand's
 * own record - its regions (the one flagged `home: true` first), its website,
 * its brand_data - or it is an UNPADDED marker naming the field and the brand:
 *
 *     [DATA REQUIRED BEFORE LAUNCH: home market, Deli Chic]
 *
 * never a literal from tenant zero's palette of defaults.
 *
 * WHAT THE TABLE BELOW IS. Facts about COUNTRIES (ISO 4217 currency, the
 * ITU dialling code, the IANA zone), never about a brand. A record's own
 * value always wins over the table. A time zone is filled from the table ONLY
 * for a country that keeps one zone: the US, Canada, Australia, Brazil,
 * Mexico, Russia, Indonesia, Spain, Portugal and Chile have several, and
 * picking one of them (US Eastern, the old default) is a decision about the
 * brand's audience nobody made - those come back as a marker unless the
 * record says which. Number grouping and symbol placement come from Intl in
 * the market's own locale (en-IN groups 1,00,000); the symbol itself is a
 * small typed table because Node's and Chromium's ICU builds disagree on
 * several. The same tables live in region-context.js for the browser, and
 * tests/brand-locale-defaults.spec.js drives both over every code and diffs
 * them.
 *
 * Not a function file (api/_shared/ sits outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

/* ISO 3166-1 alpha-2 -> [ISO 4217 currency, IANA zone ('' = several), ITU dial code]. */
const COUNTRY = {
  IN: ['INR', 'Asia/Kolkata', '+91'],
  GB: ['GBP', 'Europe/London', '+44'],
  US: ['USD', '', '+1'],
  CA: ['CAD', '', '+1'],
  AU: ['AUD', '', '+61'],
  NZ: ['NZD', 'Pacific/Auckland', '+64'],
  IE: ['EUR', 'Europe/Dublin', '+353'],
  DE: ['EUR', 'Europe/Berlin', '+49'],
  FR: ['EUR', 'Europe/Paris', '+33'],
  ES: ['EUR', '', '+34'],
  IT: ['EUR', 'Europe/Rome', '+39'],
  NL: ['EUR', 'Europe/Amsterdam', '+31'],
  BE: ['EUR', 'Europe/Brussels', '+32'],
  AT: ['EUR', 'Europe/Vienna', '+43'],
  CH: ['CHF', 'Europe/Zurich', '+41'],
  PT: ['EUR', '', '+351'],
  SE: ['SEK', 'Europe/Stockholm', '+46'],
  DK: ['DKK', 'Europe/Copenhagen', '+45'],
  NO: ['NOK', 'Europe/Oslo', '+47'],
  FI: ['EUR', 'Europe/Helsinki', '+358'],
  PL: ['PLN', 'Europe/Warsaw', '+48'],
  JP: ['JPY', 'Asia/Tokyo', '+81'],
  KR: ['KRW', 'Asia/Seoul', '+82'],
  CN: ['CNY', 'Asia/Shanghai', '+86'],
  HK: ['HKD', 'Asia/Hong_Kong', '+852'],
  SG: ['SGD', 'Asia/Singapore', '+65'],
  MY: ['MYR', 'Asia/Kuala_Lumpur', '+60'],
  ID: ['IDR', '', '+62'],
  PH: ['PHP', 'Asia/Manila', '+63'],
  TH: ['THB', 'Asia/Bangkok', '+66'],
  VN: ['VND', 'Asia/Ho_Chi_Minh', '+84'],
  PK: ['PKR', 'Asia/Karachi', '+92'],
  BD: ['BDT', 'Asia/Dhaka', '+880'],
  LK: ['LKR', 'Asia/Colombo', '+94'],
  NP: ['NPR', 'Asia/Kathmandu', '+977'],
  AE: ['AED', 'Asia/Dubai', '+971'],
  SA: ['SAR', 'Asia/Riyadh', '+966'],
  QA: ['QAR', 'Asia/Qatar', '+974'],
  IL: ['ILS', 'Asia/Jerusalem', '+972'],
  TR: ['TRY', 'Europe/Istanbul', '+90'],
  EG: ['EGP', 'Africa/Cairo', '+20'],
  ZA: ['ZAR', 'Africa/Johannesburg', '+27'],
  NG: ['NGN', 'Africa/Lagos', '+234'],
  KE: ['KES', 'Africa/Nairobi', '+254'],
  BR: ['BRL', '', '+55'],
  MX: ['MXN', '', '+52'],
};

/* The symbol a currency is written with in its own country. TYPED, not read
   from Intl: Node's ICU and Chromium's disagree on several (en-NO prints "kr"
   in one and "NOK" in the other), and a mailer built on the server must
   print the symbol the browser preview printed. */
const SYMBOL = { INR: '₹', GBP: '£', USD: '$', CAD: '$', AUD: '$', NZD: '$', EUR: '€', CHF: 'CHF', SEK: 'kr', DKK: 'kr', NOK: 'kr', PLN: 'zł', JPY: '¥', KRW: '₩', CNY: '¥', HKD: 'HK$', SGD: '$', MYR: 'RM', IDR: 'Rp', PHP: '₱', THB: '฿', VND: '₫', PKR: 'Rs', BDT: '৳', LKR: 'Rs', NPR: 'Rs', AED: 'AED', SAR: 'SAR', QAR: 'QAR', ILS: '₪', TRY: '₺', EGP: 'E£', ZAR: 'R', NGN: '₦', KES: 'Ksh', BRL: 'R$', MXN: '$' };

/* The spellings records and pages use for one market (same table as
   region-context.js FAMILY). UK is how this app has always written Britain;
   GB is how ISO writes it. */
const FAMILY = {
  US: 'US', USA: 'US', UNITEDSTATES: 'US', AMERICA: 'US',
  UK: 'UK', GB: 'UK', GBR: 'UK', UNITEDKINGDOM: 'UK', BRITAIN: 'UK',
  IN: 'IN', IND: 'IN', INDIA: 'IN',
  GLOBAL: 'GLOBAL', WORLDWIDE: 'GLOBAL', ROW: 'GLOBAL', INTL: 'GLOBAL', INTERNATIONAL: 'GLOBAL', WW: 'GLOBAL',
  EU: 'EU', EUROPE: 'EU', AU: 'AU', AUS: 'AU', AUSTRALIA: 'AU', ME: 'ME', MIDDLEEAST: 'ME', AE: 'AE', UAE: 'AE',
};
function family(v) {
  const k = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z]/g, '');
  return FAMILY[k] || k;
}
/** The ISO country a market code names, or '' for a zone (EU, ME, GLOBAL). */
function countryOf(market) {
  const f = family(market);
  if (f === 'UK') return 'GB';
  return COUNTRY[f] ? f : '';
}

function brandName(brand) { return (brand && typeof brand.name === 'string' && brand.name.trim()) || 'this brand'; }

/**
 * The spec's marker, UNPADDED: `field, brand` and a region only when one
 * applies. "[...: logo URL, all, all]" is the padded form the 2026-09-15 rule
 * forbids - "all" is not a fact.
 */
function marker(field, brand, region) {
  const parts = [field, typeof brand === 'string' ? brand : brandName(brand)];
  if (region) parts.push(String(region));
  return `[DATA REQUIRED BEFORE LAUNCH: ${parts.join(', ')}]`;
}

function regionsOf(brand) {
  const list = brand && Array.isArray(brand.regions) ? brand.regions : [];
  return list.filter((r) => r && r.code);
}

/** The region the record flags home, else the one it leads with, else null. */
function homeRegionRow(brand) {
  const list = regionsOf(brand);
  return list.find((r) => r.home === true) || list[0] || null;
}
function homeMarket(brand) {
  const r = homeRegionRow(brand);
  return r ? String(r.code).toUpperCase() : '';
}

/**
 * Which market a request means. `asked` wins when the brand serves it (any
 * spelling: "India" finds IN, GB finds UK); with nothing asked, the brand's
 * HOME market. A brand with no regions has no market to give, and a market it
 * does not serve is never substituted with one it does:
 *
 *   { market, served: true }                  - use this
 *   { market: '', served: false, marker }     - nothing to use; say so
 *
 * A record with NO regions and an explicit ask (a scheduler, a tenant-zero
 * job, an older caller) keeps the ask: there is no list to hold it against.
 */
function marketFor(brand, asked) {
  const list = regionsOf(brand);
  const want = String(asked == null ? '' : asked).trim();
  if (want) {
    if (!list.length) return { market: want.toUpperCase(), served: true, home: '', marker: '' };
    const f = family(want);
    const hit = list.find((r) => String(r.code).toUpperCase() === want.toUpperCase()) || list.find((r) => family(r.code) === f);
    if (hit) return { market: String(hit.code).toUpperCase(), served: true, home: homeMarket(brand), marker: '' };
    return {
      market: '', served: false, home: homeMarket(brand),
      marker: marker('market ' + want.toUpperCase(), brand),
      reason: `${brandName(brand)} does not list ${want.toUpperCase()} among its markets (${list.map((r) => String(r.code).toUpperCase()).join(', ')}), so nothing was planned for it.`,
    };
  }
  const home = homeMarket(brand);
  if (home) return { market: home, served: true, home, marker: '' };
  return {
    market: '', served: false, home: '',
    marker: marker('home market', brand),
    reason: `${brandName(brand)} has no market on its record yet, so there is no home market to plan for. Add its regions in Brand setup.`,
  };
}

/** The symbol for a currency (the table above), else the ISO code itself, or ''. */
function symbolOf(currency) {
  const c = String(currency || '').toUpperCase();
  return c ? (SYMBOL[c] || c) : '';
}

/**
 * Everything locale-shaped about one market of one brand. Record values win;
 * the country table fills only what a country decides on its own; a gap is a
 * marker in `gaps`, never a borrowed value.
 */
function localeFor(brand, asked) {
  const m = marketFor(brand, asked);
  const code = m.market;
  const list = regionsOf(brand);
  const row = code ? (list.find((r) => String(r.code).toUpperCase() === code) || null) : null;
  const cc = countryOf(code);
  const t = cc ? COUNTRY[cc] : null;
  const isHome = !!code && code === homeMarket(brand);
  const currency = String((row && row.currency) || (t && t[0]) || '').toUpperCase();
  const locale = String((row && row.locale) || (cc ? `en-${cc}` : '') || '');
  const timeZone = String((row && (row.timezone || row.time_zone)) || (isHome && brand && (brand.timezone || brand.time_zone)) || (t && t[1]) || '');
  const dial = String((row && (row.dial_code || row.phone_cc)) || (t && t[2]) || '');
  const symbol = String((row && row.symbol) || symbolOf(currency) || '');
  const store = String((row && row.store_url) || '').replace(/\/$/, '');
  const gaps = [];
  if (!code) gaps.push(m.marker);
  else {
    if (!currency) gaps.push(marker('currency', brand, code));
    if (!timeZone) gaps.push(marker('time zone', brand, code));
    if (!store) gaps.push(marker('region store URL', brand, code));
  }
  return { market: code, served: m.served, home: m.home || homeMarket(brand), country: cc, currency, symbol, locale, timeZone, dial, store_url: store, gaps, marker: m.marker || '', reason: m.reason || '' };
}

/** A price in the brand's own currency and number format (en-IN groups 1,00,000). */
function money(amount, brand, market, opts) {
  const n = Number(amount);
  const l = localeFor(brand, market);
  if (!Number.isFinite(n)) return '';
  if (!l.currency) return `${n.toLocaleString(l.locale || 'en')} ${marker('currency', brand, l.market || undefined)}`;
  // Intl places the symbol and groups the digits the market's way (en-IN:
  // ₹1,00,000); the symbol itself is the record's or the table's, so the
  // server and the browser print the same one.
  try {
    return new Intl.NumberFormat(l.locale || 'en', Object.assign({ style: 'currency', currency: l.currency, maximumFractionDigits: 0 }, opts || {}))
      .formatToParts(n).map((p) => (p.type === 'currency' ? (l.symbol || p.value) : p.value)).join('');
  } catch (_) { return `${l.symbol || l.currency + ' '}${Math.round(n)}`; }
}

/**
 * The UTC hour (decimal) of a LOCAL hour in a zone on a date, from Intl's own
 * offset - so IST 09:30 is 4 (04:00 UTC), British summer time moves with the
 * clocks, and no offset is typed. '' zone -> null: there is no single local
 * time to convert.
 */
function utcHourOf(localHour, timeZone, dateIso) {
  if (!timeZone) return null;
  const d = dateIso ? new Date(`${String(dateIso).slice(0, 10)}T12:00:00Z`) : new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
    const get = (k) => Number((parts.find((p) => p.type === k) || {}).value);
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    const offsetH = (local - d.getTime()) / 3600000;
    let h = Number(localHour) - offsetH;
    h = ((h % 24) + 24) % 24;
    return Math.round(h * 2) / 2;
  } catch (_) { return null; }
}

/** The brand's legal sender line, from its own record (top level or brand_data), or ''. */
function legalEntityOf(brand) {
  const b = brand || {};
  const v = b.legal_entity || b.legal_name || (b.brand_data && (b.brand_data.legal_entity || b.brand_data.legal_name)) || '';
  return typeof v === 'string' ? v.trim() : '';
}

/** The brand's own social profiles: [{platform, url}], from the record only. */
function socialOf(brand) {
  const b = brand || {};
  const raw = Array.isArray(b.social) ? b.social : (b.brand_data && Array.isArray(b.brand_data.social) ? b.brand_data.social : []);
  return raw.filter((s) => s && typeof s === 'object' && /^https:\/\//i.test(String(s.url || '')))
    .map((s) => ({ platform: String(s.platform || '').toLowerCase().slice(0, 40), url: String(s.url).slice(0, 300) }));
}

module.exports = {
  COUNTRY, SYMBOL, FAMILY, family, countryOf, marker, homeMarket, homeRegionRow, marketFor, localeFor, money, symbolOf,
  utcHourOf, legalEntityOf, socialOf,
};
