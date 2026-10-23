'use strict';
/* ============================================================================
 * asset-specs.js — SINGLE SOURCE OF TRUTH for device/platform size rules that
 * EVERY asset generator (mailers, ads, landing pages, social) must honor.
 *
 * Goal: no generator hardcodes sizes. Each pulls the canonical dimensions,
 * aspect ratios, safe zones and copy-length limits from here, and includes the
 * relevant spec in its output so the produced asset (and its LLM/image prompt)
 * is always device- and channel-correct. Sizes below are current industry
 * standards (2026) for each placement.
 *
 * Conventions: sizes are "WxH" in CSS px at 1x unless noted; images should be
 * generated at 2x for retina where a display size is given. Copy limits are the
 * platform's visible/allowed maximums.
 * ========================================================================== */

// ── Email / mailer (device rules) ────────────────────────────────────────────
const MAILER = {
  // The email content column. 600px is the universal safe width for Outlook +
  // Gmail + Apple Mail + Klaviyo templates; never exceed 640.
  desktop: {
    contentWidth: 600,           // px, fixed table width
    maxWidth: 640,
    body: { minFontPx: 15, lineHeight: 1.6 },
    heading: { fontPx: [24, 34] },
    gutter: 24,
    heroImage: '1200x600',       // displayed 600x300 @2x
    fullBleedImage: '1200x900',  // displayed 600x450 @2x
    inlineProductImage: '600x600',
  },
  mobile: {
    // Below this width the layout must collapse to a single fluid column.
    breakpoint: 600,             // @media (max-width:600px)
    contentWidth: '100%',
    body: { minFontPx: 16 },     // >=16px avoids iOS auto-zoom
    heading: { fontPx: [22, 28] },
    gutter: 16,
    tapTargetPx: 44,             // min button height
    heroImage: '1080x1080',      // 1:1 reads best on phones; displayed full-bleed
  },
  // Baked responsive rule string the mailer builders can inject verbatim.
  responsiveCss:
    '@media only screen and (max-width:600px){' +
    '.vh-m-container{width:100%!important;max-width:100%!important}' +
    '.vh-m-col{display:block!important;width:100%!important}' +
    '.vh-m-pad{padding-left:16px!important;padding-right:16px!important}' +
    '.vh-m-img{width:100%!important;height:auto!important}' +
    '.vh-m-btn{display:block!important;width:100%!important;min-height:44px!important}' +
    '.vh-m-h1{font-size:26px!important;line-height:1.25!important}' +
    'body,.vh-m-body{font-size:16px!important}}',
};

// ── Paid ads (per platform, per placement) ───────────────────────────────────
// Each placement: { size, ratio, note?, safe? }. `copy` holds text limits.
const ADS = {
  // `produced: true` marks the placements the studio compositor (api/ai/
  // generate.js) actually renders/returns today. The rest are canonical
  // reference sizes for manual/other production — prompts that describe the
  // compositor output must list PRODUCED ones only (see adSpecText onlyProduced)
  // so we never claim to deliver an asset the flow does not generate.
  meta: {
    label: 'Meta (Facebook / Instagram)',
    placements: [
      { key: 'feed_square',   size: '1080x1080', ratio: '1:1',  note: 'Feed', produced: true },
      { key: 'feed_portrait', size: '1080x1350', ratio: '4:5',  note: 'Feed (max real estate)' },
      { key: 'story_reel',    size: '1080x1920', ratio: '9:16', note: 'Stories / Reels', produced: true, safe: 'keep text out of top 250px and bottom 420px (UI chrome)' },
      { key: 'carousel',      size: '1080x1080', ratio: '1:1',  note: 'Carousel card' },
    ],
    copy: { primaryText: 125, headline: 40, description: 30, hashtags: 0 },
  },
  google: {
    label: 'Google (Responsive Display + Performance Max)',
    placements: [
      { key: 'landscape', size: '1200x628',  ratio: '1.91:1', note: 'Responsive landscape', produced: true },
      { key: 'square',    size: '1200x1200', ratio: '1:1',    note: 'Responsive square', produced: true },
      { key: 'portrait',  size: '960x1200',  ratio: '4:5',    note: 'Responsive portrait' },
      { key: 'logo_sq',   size: '1200x1200', ratio: '1:1',    note: 'Logo square' },
      { key: 'logo_wide', size: '1200x300',  ratio: '4:1',    note: 'Logo landscape' },
      // Fixed display banners still trafficked programmatically:
      { key: 'banner_mrec',    size: '300x250', ratio: '6:5',   note: 'Medium rectangle' },
      { key: 'banner_lead',    size: '728x90',  ratio: '8:1',   note: 'Leaderboard' },
      { key: 'banner_hpu',     size: '300x600', ratio: '1:2',   note: 'Half-page' },
      { key: 'banner_mobile',  size: '320x50',  ratio: '6.4:1', note: 'Mobile leaderboard' },
      { key: 'banner_lgmob',   size: '320x100', ratio: '3.2:1', note: 'Large mobile banner' },
      { key: 'banner_billbrd', size: '970x250', ratio: '3.88:1',note: 'Billboard' },
    ],
    copy: { headlines: { count: 15, max: 30 }, longHeadline: 90, descriptions: { count: 4, max: 90 }, businessName: 25 },
  },
  tiktok: {
    label: 'TikTok (In-Feed / Spark)',
    placements: [
      { key: 'in_feed', size: '1080x1920', ratio: '9:16', note: 'In-feed video / cover', produced: true, safe: 'avoid right 120px (icons) and bottom 480px (caption/CTA)' },
    ],
    copy: { caption: 100, hashtags: 5, scriptHookSec: 2 },
  },
};

// ── Organic social (per platform) ────────────────────────────────────────────
const SOCIAL = {
  instagram: { placements: [
    { key: 'feed_portrait', size: '1080x1350', ratio: '4:5' },
    { key: 'feed_square',   size: '1080x1080', ratio: '1:1' },
    { key: 'story_reel',    size: '1080x1920', ratio: '9:16' },
  ], copy: { caption: 2200, hashtags: 30 } },
  facebook: { placements: [
    { key: 'feed', size: '1200x630', ratio: '1.91:1' },
    { key: 'portrait', size: '1080x1350', ratio: '4:5' },
    { key: 'story', size: '1080x1920', ratio: '9:16' },
  ], copy: { caption: 2200 } },
  linkedin: { placements: [
    { key: 'landscape', size: '1200x627', ratio: '1.91:1' },
    { key: 'square', size: '1200x1200', ratio: '1:1' },
  ], copy: { caption: 3000, hashtags: 5 } },
  x: { placements: [
    { key: 'landscape', size: '1600x900', ratio: '16:9' },
    { key: 'single', size: '1200x675', ratio: '16:9' },
  ], copy: { post: 280 } },
  youtube: { placements: [
    { key: 'thumbnail', size: '1280x720', ratio: '16:9' },
    { key: 'shorts', size: '1080x1920', ratio: '9:16' },
  ], copy: { title: 100, description: 5000 } },
  pinterest: { placements: [
    { key: 'standard', size: '1000x1500', ratio: '2:3' },
  ], copy: { title: 100, description: 500 } },
  blog: { placements: [
    { key: 'featured', size: '1200x630', ratio: '1.91:1' },
  ], copy: { title: 60, metaDescription: 160 } },
};

// ── Owned messaging: SMS, WhatsApp, push (2026-10-23) ────────────────────────
// Each number carries where it comes from. `verified: false` means this repo
// cannot reach the owner's documentation to confirm it today and nothing here
// enforces it against a live platform, so a contract may WARN on it, never
// block (asset-contracts.js rule 2).
const MESSAGING = {
  sms: {
    // 3GPP TS 23.038 (GSM 7-bit default alphabet and its extension table) and
    // TS 23.040 (a single short message carries 140 octets: 160 septets, or 70
    // UCS-2 characters; a concatenated part gives 6 or 7 octets to its User
    // Data Header, leaving 153 septets / 67 UCS-2 characters per part).
    gsm7: { single: 160, part: 153 },
    ucs2: { single: 70, part: 67 },
    source: '3GPP TS 23.038 / TS 23.040',
    // A property of the encoding, not a platform's refusal: a longer message
    // is sent as several parts (each billed), never refused, so it warns.
    standard: true,
    // An opt-out instruction on every marketing SMS (CTIA Messaging Principles
    // and Best Practices; US TCPA practice; UK PECR reg. 22 "a simple means of
    // refusing"). The wording below is the convention carriers recognise.
    opt_out: 'Reply STOP to opt out.',
  },
  whatsapp: {
    // WhatsApp Business Platform message templates (Meta developer docs,
    // "Message templates" / "Template components"). A marketing message
    // outside the 24-hour customer service window must be an APPROVED template.
    // These numbers were not read on the live documentation from this
    // deployment, so they are recorded unverified: warn, never block.
    body: 1024, header_text: 60, footer: 60, button_text: 25,
    quick_reply_buttons: 3, cta_buttons: 2,
    category: 'MARKETING',
    source: 'Meta WhatsApp Business Platform, message templates (not re-read from this deployment)',
    verified: false,
    opt_out: 'Reply STOP to opt out',
  },
  push: {
    // Truncation of a notification's title and body depends on the operating
    // system, the device, the notification style and the user's settings, so
    // no single limit exists to record. Nothing here blocks on length.
    title: null, body: null,
    source: 'no single limit: truncation varies by OS, device and notification style',
    verified: false,
  },
};

// ── Landing pages (responsive breakpoints) ───────────────────────────────────
const LANDING = {
  breakpoints: { mobile: 640, tablet: 1024, desktop: 1200 },
  container: { maxWidth: 1200 },
  hero: { desktop: '1600x900', mobile: '1080x1350' },
  section: { desktop: '1200x800', mobile: '1080x1080' },
  rule: 'Mobile-first: single column <=640px, 2-up 641-1024px, full grid >=1024px. All media max-width:100%; height:auto.',
};

// ── SEO / channel-uploadable metadata fields expected on assets ──────────────
// The complete set of fields a generator should populate so an asset is ready
// to upload/send on its channel without manual filling.
const META_FIELDS = {
  email:   ['subject_line', 'preheader', 'from_name', 'headings', 'body_html', 'cta_text', 'cta_url', 'alt_text', 'utm'],
  landing: ['seo_title', 'meta_description', 'og_title', 'og_description', 'og_image', 'canonical', 'schema_jsonld', 'h1', 'alt_text'],
  ad:      ['headline', 'primary_text', 'description', 'cta_label', 'display_url', 'final_url', 'utm', 'alt_text', 'overlay_text'],
  social:  ['hook', 'caption', 'hashtags', 'alt_text', 'first_comment', 'cover_text', 'utm'],
};

// ── Mailer variant contract (2 Text + 2 Text+Visual) ─────────────────────────
const MAILER_VARIANTS = [
  { id: 'T1', type: 'Text',          media: 'none',            note: 'Pure typographic, editorial voice.' },
  { id: 'T2', type: 'Text',          media: 'none',            note: 'Pure typographic, alternate angle/structure.' },
  { id: 'V1', type: 'Text + Visual', media: 'image|chart',     note: 'Text plus a hero image or brand graphic/infographic.' },
  { id: 'V2', type: 'Text + Visual', media: 'image|gif|video', note: 'Text plus a distinct visual treatment (lifestyle image / gif / video keyframe / chart).' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function sizesLine(placements) {
  return placements.map((p) => `${p.ratio} (${p.size}${p.note ? ', ' + p.note : ''})`).join('; ');
}
// Human-readable spec string for an LLM/image prompt, e.g. for an ad platform.
// opts.onlyProduced restricts the list to placements the compositor actually
// renders (use this for any text that claims to describe produced output, so we
// never over-claim deliverables). Default lists the full canonical set.
function adSpecText(platform, opts) {
  const a = ADS[platform] || ADS.meta;
  const onlyProduced = !!(opts && opts.onlyProduced);
  let list = onlyProduced ? a.placements.filter((p) => p.produced) : a.placements;
  if (!list.length) list = a.placements; // never emit an empty list
  const sizes = sizesLine(list);
  const safe = list.filter((p) => p.safe).map((p) => `${p.key}: ${p.safe}`).join(' | ');
  return `${a.label} — produce the creative at each placement size: ${sizes}.` + (safe ? ` Safe zones — ${safe}.` : '');
}
function mailerSpecText() {
  return `Mailer sizing — desktop content column ${MAILER.desktop.contentWidth}px (never exceed ${MAILER.desktop.maxWidth}px), hero image ${MAILER.desktop.heroImage}. Mobile: collapse to one fluid 100%-width column below ${MAILER.mobile.breakpoint}px, body >=${MAILER.mobile.body.minFontPx}px, buttons full-width >=${MAILER.mobile.tapTargetPx}px tall.`;
}
function socialSpecText(platform) {
  const s = SOCIAL[platform]; if (!s) return '';
  return `${platform} — sizes: ${sizesLine(s.placements)}.`;
}
// "WxH" for a given asset/channel/placement (falls back to first placement).
function imageSize(kind, channel, placementKey) {
  const map = { ad: ADS, social: SOCIAL };
  const group = (map[kind] || {})[channel];
  if (!group || !group.placements) {
    if (kind === 'mailer') return MAILER.desktop.heroImage;
    if (kind === 'landing') return LANDING.hero.desktop;
    return '1080x1080';
  }
  const p = placementKey ? group.placements.find((x) => x.key === placementKey) : group.placements[0];
  return (p || group.placements[0]).size;
}

module.exports = {
  MAILER, ADS, SOCIAL, LANDING, MESSAGING, META_FIELDS, MAILER_VARIANTS,
  adSpecText, mailerSpecText, socialSpecText, imageSize, sizesLine,
};
