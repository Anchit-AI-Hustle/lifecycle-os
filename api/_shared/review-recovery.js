'use strict';
/**
 * review-recovery.js — low-rated-product review recovery.
 * ---------------------------------------------------------------------------
 * Product-owner rule: when a product's rating is LOW (below 3.5), the calendar
 * should also schedule a review-invitation send aimed at the users most able to
 * give a fresh, honest rating — the people who have likely FINISHED their packet
 * of that product AND for whom it was their LAST order (so it is top of mind and
 * they are due a reorder decision).
 *
 * Zero-fabrication: a product is only treated as "low rated" when a REAL numeric
 * rating below the threshold is present. A product with no rating is never
 * assumed low. No incentive is offered (compliance: never buy a rating). The CTA
 * points at the product's own REAL PDP review section (never an invented URL).
 * Per-user eligibility (finished-packet + last-order) is expressed as a rule the
 * ESP applies at send time; when that data is not wired the slot still plans but
 * carries a [DATA REQUIRED] reach note instead of an invented audience size.
 * ---------------------------------------------------------------------------
 */

const THRESHOLD = 3.5;

let catalogImage = null;
try { catalogImage = require('./catalog-image.js'); } catch (_) { catalogImage = null; }

// Per-market official store host (verified in CLAUDE.md). Never cross-region.
function storeHost(market, brand) {
  // The store host is the ACTIVE brand's own, per region. Never a fixed
  // tenant's domain: a wrong host in a CTA sends readers to another company.
  if (!brand || !brand.id) { try { brand = require('./brand-runtime.js').defaultBrand(); } catch (_) { brand = {}; } }
  const m = String(market || 'US').toUpperCase();
  const list = Array.isArray(brand.regions) ? brand.regions : [];
  const hit = list.find((r) => String(r.code || '').toUpperCase() === m) || list[0];
  const url = (hit && hit.store_url) || brand.website || '';
  return String(url).replace(/^https?:\/\//, '').replace(/\/$/, '');
}


// Read a REAL numeric rating from common shapes; null when absent (never guessed).
function ratingOf(p) {
  if (!p) return null;
  const prod = p.product || {};
  // Rating may sit on the score-row OR on the product it wraps. Check both.
  const cands = [p.rating, p.avg_rating, p.stars, p.product_rating,
    prod.rating, prod.avg_rating, prod.stars, (prod.reviews && prod.reviews.rating), (p.reviews && p.reviews.rating)];
  for (const raw of cands) {
    const n = typeof raw === 'string' ? parseFloat(raw) : raw;
    if (typeof n === 'number' && isFinite(n) && n > 0) return n;
  }
  return null;
}

// Products whose REAL rating is below the threshold. Input: scoreProducts()-style
// rows ({product, ...}) or raw catalog rows. De-duplicated by sku/handle.
function lowRatedProducts(products, threshold = THRESHOLD) {
  const seen = new Set(), out = [];
  for (const row of (products || [])) {
    const r = ratingOf(row);
    if (r == null || r >= threshold) continue;
    const prod = row.product || row;
    const key = prod.sku || prod.id || prod.h || prod.handle || prod.title || prod.n;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ product: prod, rating: r });
  }
  return out;
}

function reviewCtaUrl(product, market, brand) {
  const store = 'https://' + storeHost(market, brand);
  let handle = null;
  try { handle = catalogImage && catalogImage.handleFor(product, market, { brand }); } catch (_) { handle = null; }
  handle = handle || product.handle || product.h || null;
  // Reviews live on the product's own PDP — a real, verifiable destination. No
  // third-party or invented review URL.
  return handle ? `${store}/products/${handle}#reviews` : `${store}/#reviews`;
}

const HEAD = "'Montserrat','Raleway',Georgia,serif";
const BODY = "'Instrument Sans','Helvetica Neue',Arial,sans-serif";
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

// Brand-compliant review-invitation mailer for one low-rated product. Palette +
// fonts locked; no banned phrases, no em/en dashes, NO incentive; real product
// photo (catalog) when available, image-free otherwise (never a fake URL).
function reviewMailerHtml(product, market, brand) {
  // Brand identity is derived, never hardcoded: a review-recovery mailer is a
  // shared renderer and must carry the ACTIVE brand's wordmark and wording.
  if (!brand || !brand.id) { try { brand = require('./brand-runtime.js').defaultBrand(); } catch (_) { brand = {}; } }
  const title = product.title || product.n || ('your last ' + ((brand && brand.name) || 'order'));
  const cta = reviewCtaUrl(product, market, brand);
  let img = null;
  // This brand's own approved photo, or none. The shipped catalogue belongs to
  // tenant zero, so another brand renders image-free rather than borrowing one.
  try { img = catalogImage && (catalogImage.imageFor(product, market, { width: 1200, brand }) || catalogImage.imagesFor(product, market, { width: 1200, brand })[0]); } catch (_) { img = null; }
  const heroImg = img ? `<tr><td style="padding:0 24px"><img src="${esc(img)}" alt="${esc(title)}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:8px"/></td></tr><tr><td style="height:20px"></td></tr>` : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5"><tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff">
  <tr><td style="height:32px"></td></tr>
  <tr><td align="center" style="padding:18px 0 4px"><div style="font-family:${BODY};font-size:22px;letter-spacing:.28em;color:var(--brand-primary,#D0473E);font-weight:700">${esc(String((brand && brand.name) || '').toUpperCase())}</div><div style="font-family:${BODY};font-size:10px;letter-spacing:.22em;color:var(--brand-accent,#6A33D8);text-transform:uppercase;margin-top:4px">${esc(String(market).toUpperCase())}</div></td></tr>
  <tr><td style="height:18px"></td></tr>
  <tr><td style="padding:0 24px"><h1 style="margin:0;font-family:${HEAD};font-size:26px;line-height:1.3;color:#1b1612;text-align:center">How did the ${esc(title)} land for you?</h1></td></tr>
  <tr><td style="height:16px"></td></tr>
  ${heroImg}
  <tr><td style="padding:0 24px"><p style="margin:0 0 16px;font-family:${BODY};font-size:16px;color:#4a4a4a;line-height:1.6;text-align:center">Hi {{ first_name|default:'there' }}, you finished your ${esc(title)} a little while ago, so it is fresh in the pair memory. Before the reorder, we would value your honest read.</p>
  <p style="margin:0;font-family:${BODY};font-size:16px;color:#4a4a4a;line-height:1.6;text-align:center">A rating and a line or two, exactly as you would tell a friend. The rough notes help us as much as the kind ones.</p></td></tr>
  <tr><td style="height:26px"></td></tr>
  <tr><td style="padding:0 24px" align="center"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#FFFFFF;border:2px solid #D0473E;border-radius:14px;padding:16px 22px;text-align:center"><p style="margin:0 0 6px;font-family:${BODY};font-size:11px;color:#D0473E;font-weight:700;text-transform:uppercase;letter-spacing:2px">Three small prompts</p><p style="margin:0;font-family:${BODY};font-size:15px;color:#1b1612;line-height:1.6">The headline first · the detail that stuck · whether you would craft it again.</p></td></tr></table></td></tr>
  <tr><td style="height:26px"></td></tr>
  <tr><td style="padding:0 24px" align="center"><a href="${esc(cta)}" style="display:inline-block;background:#D0473E;color:#ffffff;text-decoration:none;padding:15px 38px;border-radius:8px;font-family:${BODY};font-size:16px;font-weight:600">Leave a rating</a></td></tr>
  <tr><td style="height:12px"></td></tr>
  <tr><td style="padding:0 24px" align="center"><p style="margin:0;font-family:${BODY};font-size:13px;color:#9ca3af">Rating plus a line · done before the next pair</p></td></tr>
  <tr><td style="height:28px"></td></tr>
  <tr><td style="padding:0 24px" align="center"><p style="margin:0;font-family:${BODY};font-size:14px;color:#1b1612;font-weight:600">Warmly,</p><p style="margin:4px 0 0;font-family:${BODY};font-size:14px;color:#1b1612">The ${esc((brand && brand.name) || '')} Team</p></td></tr>
  <tr><td style="height:30px"></td></tr>
  <tr><td style="padding:20px 24px;border-top:1px solid #e5e7eb;text-align:center"><p style="margin:0;font-family:${BODY};font-size:11px;color:#9ca3af;line-height:1.6">You are receiving this as a ${esc((brand && brand.name) || '')} ${esc(String(market).toUpperCase())} customer. Manage preferences or unsubscribe from your account settings.</p></td></tr>
</table></td></tr></table></body></html>`;
}

// Eligibility rule (applied by the ESP at send time; expressed here so the plan
// and the audience filter stay in one place).
function eligibilityRule(product) {
  const title = product.title || product.n || 'this product';
  return {
    cohort_name: `Review recovery · finished-packet, last order ${title}`,
    definition: `Users whose LAST order was ${title} AND enough time has passed to have finished the packet (est. from pack size / pairs vs typical use). One-time send; no incentive; excludes anyone who already reviewed ${title}.`,
    esp_filter: {
      last_ordered_product_title: title,
      last_ordered_product_sku: product.sku || product.id || product.h || null,
      finished_packet: true,               // ESP computes from order date + pack pairs
      already_reviewed_product: false,
      suppress_if_reviewed_within_days: 365,
    },
  };
}

// Build calendar slots for every low-rated product, one review-recovery send per
// product per market, spaced across the first few days of the window. Returns []
// when there are no low-rated products (honest no-op — never invents a send).
function reviewRecoverySlots({ productScores = [], markets = ['US'], startDate = null, idFor = null } = {}) {
  const low = lowRatedProducts(productScores);
  if (!low.length) return [];
  const addDays = (iso, n) => { const d = new Date((iso || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const slots = [];
  low.forEach((lr, idx) => {
    const product = lr.product;
    const rule = eligibilityRule(product);
    for (const market of markets) {
      const date = addDays(startDate, 1 + (idx % 5)); // stagger, start tomorrow
      const id = idFor ? idFor('cal', { date, market, cohort: rule.cohort_name }) : `review_${market}_${(product.sku || product.title || idx)}_${date}`.replace(/[^a-z0-9_]/gi, '_');
      slots.push({
        id,
        date,
        market,
        status: 'needs_human_verification',
        objective: 'review_recovery',
        review_recovery: true,
        rating: null,           // slot-level confidence, not a product rating
        product_rating: lr.rating,
        cohort: { name: rule.cohort_name, size: null, definition: rule.definition },
        heroProduct: { title: product.title || product.n, handle: product.handle || product.h || null, sku: product.sku || product.id || null, category: product.category || product.type || null },
        supportingProducts: [],
        channels: ['email'],    // a review invite is an email-only, no-offer send
        confidence: 0.6,
        esp_filter: rule.esp_filter,
        rationale: `${product.title || product.n} is rated ${lr.rating} (below ${THRESHOLD}). Invite the finished-packet, last-order cohort to leave an honest rating so the product's score reflects real, recent experience. No incentive; CTA to the product's own review section.`,
        reach: {
          cohort_size: null,
          planned_recipients: null,
          per_user_per_week: { min: 1, max: 1 },
          widen_note: '[DATA REQUIRED BEFORE LAUNCH: eligible finished-packet last-order audience size, ' + (product.title || product.n) + ', ' + market + ']',
          why: 'Recipients resolved by the ESP from real last-order + finished-packet data; not estimated here.',
        },
        decision: {
          theme: { choice: 'Honest review invitation', why: `Low rating (${lr.rating}) needs fresh, real ratings, not more promotion.` },
          topic: { choice: `Rate the ${product.title || product.n}`, why: rule.definition },
          product: { hero: product.title || product.n, supporting: [], why: 'Single product; the review is about this exact SKU.' },
          offer: { code: null, pct: 0, why: 'No incentive — a bought rating is not an honest rating (compliance).' },
          design: { archetype: 'review-invitation', variants: '1 email', why: 'Prompt-led, low-friction; rating plus a line.' },
        },
      });
    }
  });
  return slots;
}

module.exports = { THRESHOLD, ratingOf, lowRatedProducts, reviewCtaUrl, reviewMailerHtml, eligibilityRule, reviewRecoverySlots, storeHost };
