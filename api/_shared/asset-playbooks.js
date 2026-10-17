'use strict';
/**
 * asset-playbooks.js — competitive benchmarking, structure rules, and
 * ideation logic for marketing assets (mailers, ads, landing pages, social)
 * across ALL business models — especially information brands (news, market
 * data, financial intelligence) as well as commerce, events, subscriptions,
 * and services.
 *
 * ── The business problem this module solves ─────────────────────────────────
 * Marketing assets fail to generate revenue when they are built with the wrong
 * commercial mental model. A news publisher or stock market intelligence brand
 * does not sell "SKUs in a cart". Its revenue levers are:
 *   1. Attention & Habit Formation (daily/weekly read frequency, CTOR)
 *   2. Free-to-Paid Subscription Conversion (paywall, premium tier, pro tools)
 *   3. Retention & Churn Reduction (daily utility, actionable insight)
 *   4. Direct Monetization (sponsored native sections, premium reports, memberships)
 *
 * Forcing an information brand into a product-grid template ("Shop the drop",
 * price compare-at, unboxing steps) ruins credibility and tanks conversion.
 * Similarly, using AI-generated fake charts, fictional ticker prices, or
 * invented statistics creates massive legal liability (SEBI / SEC / FINRA / FCA).
 *
 * This module establishes:
 *   - Automatic business model detection (`businessModel(brand)`)
 *   - Benchmark-grounded asset structures derived from world-class exemplars
 *     (Morning Brew, Axios Smart Brevity, Finshots, Bloomberg, Seeking Alpha,
 *      Glossier, Gymshark, Ridge, Substack Pro)
 *   - Explicit revenue mechanics (revenueJob, revenueLevers, KPIs)
 *   - Strict visual and image policies for information & financial assets
 *   - Concrete ideation angles and hook formulas
 *   - Regulatory disclaimers by jurisdiction (IN, US, UK, Global)
 *
 * Pure data + deterministic logic. No provider calls, no external network I/O.
 */

const offeringKinds = require('./offering-kinds.js');

const BUSINESS_MODELS = [
  'commerce',       // Physical/digital products with price/SKU/cart
  'news_media',     // Editorial news, daily briefings, journalism, media digests
  'market_data',    // Stock market intelligence, equities, trading, crypto, research
  'subscription',   // Recurring software, membership clubs, subscription boxes
  'events',         // Conferences, webinars, marathons, retreats, summits
  'services',       // Agencies, consultations, custom bespoke commissions
];

/**
 * Keywords indicating financial intelligence / stock market information.
 */
const MARKET_DATA_REGEX = /\b(?:stock|stocks|market|markets|finance|financial|trading|trader|equities|equity|crypto|cryptocurrency|investing|investor|portfolio|ticker|nifty|sensex|nasdaq|sp500|dow|forex|wealth|commodities|etfs?|mutual\s*funds?|securities|research\s*analyst|earnings|fintech|bonds|macro)\b/i;

/**
 * Keywords indicating news journalism / media / editorial publications.
 */
const NEWS_MEDIA_REGEX = /\b(?:news|newsletter|journalism|journalist|media|editorial|briefing|digest|city\s*desk|reporting|press|gazette|chronicle|times|post|dispatch|bulletin|morning\s*brew|axios|magazine|bulletin)\b/i;

/**
 * Determine the primary business model for a brand.
 * @param {object} brand - The brand record from brand-runtime / workspace
 * @returns {'commerce'|'news_media'|'market_data'|'subscription'|'events'|'services'}
 */
function businessModel(brand) {
  if (!brand) return 'commerce';

  // Check explicit declaration if present (top-level or inside voice)
  const explicit = brand.business_model || brand.businessModel || (brand.voice && (brand.voice.business_model || brand.voice.businessModel));
  if (explicit && BUSINESS_MODELS.includes(explicit)) {
    return explicit;
  }

  const industry = String(brand.industry || '').toLowerCase();
  const desc = String(brand.description || brand.tagline || '').toLowerCase();
  const claims = Array.isArray(brand.claims) ? brand.claims.join(' ').toLowerCase() : '';
  const offerings = Array.isArray(brand.offerings) ? brand.offerings : [];
  const textCorpus = `${industry} ${desc} ${claims} ${brand.name || ''}`;

  // Prioritize financial & market data intelligence
  if (MARKET_DATA_REGEX.test(textCorpus)) {
    return 'market_data';
  }

  // Next check offerings for finance
  for (const o of offerings) {
    const oText = `${o.name || ''} ${o.topics || ''} ${o.cadence || ''} ${o.handle || ''}`;
    if (MARKET_DATA_REGEX.test(oText)) return 'market_data';
  }

  // Check news & media publications
  if (NEWS_MEDIA_REGEX.test(textCorpus)) {
    return 'news_media';
  }

  for (const o of offerings) {
    const oText = `${o.name || ''} ${o.topics || ''} ${o.cadence || ''}`;
    if (NEWS_MEDIA_REGEX.test(oText)) return 'news_media';
  }

  // Offering kinds check
  const kinds = new Set(offerings.map((o) => o && o.kind).filter(Boolean));
  if (kinds.has('event')) return 'events';
  if (kinds.has('service')) return 'services';
  if (kinds.has('plan') && !kinds.has('product')) return 'subscription';
  if (kinds.has('section') || kinds.has('programme')) {
    return MARKET_DATA_REGEX.test(textCorpus) ? 'market_data' : 'news_media';
  }

  return 'commerce';
}

/**
 * Regulatory financial disclaimer generator.
 * Enforces compliance for market data, trading, and investment content.
 * @param {string} market - Region code (IN, US, UK, Global)
 * @param {object} [brand] - Brand metadata
 * @returns {string} Plain-text disclaimer
 */
function financialDisclaimer(market, brand) {
  const mk = String(market || 'US').toUpperCase();
  const bName = (brand && brand.name) || 'This publication';

  if (mk === 'IN') {
    return `${bName} is an educational and information service only. Content, analysis, and data points provided herein are for informational purposes and do not constitute investment advice, financial research, or recommendations to buy or sell securities under SEBI (Research Analysts) Regulations, 2014. Securities markets are subject to market risks; read all related documents carefully before investing.`;
  }
  if (mk === 'UK' || mk === 'EU') {
    return `${bName} is published for general information and educational purposes only and does not constitute personal investment or financial advice under Financial Conduct Authority (FCA) rules. Capital at risk. The value of investments and income from them may go down as well as up. Past performance is no guarantee of future results.`;
  }
  // US & Global default
  return `${bName} provides market analysis, data, and commentary for informational and educational purposes only. Nothing herein constitutes investment advice, a solicitation, or an offer to buy or sell securities. Past performance is not indicative of future results. Always consult a registered financial advisor or broker-dealer before making investment decisions.`;
}

/**
 * Image policy specifications by business model.
 * Answers the user request: "there could be brands which focus on selling information
 * be it news or stock market information or anything - ensure their images etc are also used appropriately"
 */
const IMAGE_POLICIES = {
  market_data: {
    sourceOrder: [
      '1. Hosted verified charts or tables built from actual supplied historical data.',
      '2. Brand-owned visual assets (licensed logo mark, terminal screenshots, verified brand UI).',
      '3. High-resolution editorial still capturing authentic financial environment (trading desk, stock exchange floor, financial district skyline, mobile trader hands) with NO readable numerals or fake tickers.',
      '4. Abstract conceptual data art: mathematical geometry, terminal grids, gradient depth fields in the brand palette on a light ground.',
    ],
    never: [
      'NEVER generate AI-rendered charts with fake bars, fictional candlesticks, or synthetic trends.',
      'NEVER display hallucinated stock prices, tickers, percentage gains, or fake P&L green/red screenshots.',
      'NEVER generate fake customer portraits, fake hedge fund managers, or synthetic financial advisors.',
      'NEVER bake text or misleading numerical claims into the image file itself.',
      'NEVER use stock imagery depicting literal money stacks, golden coins falling, or cartoon bull/bear caricatures.',
    ],
    compositionRule: 'Generous negative space in upper third or horizontal band for real live data overlays. Dark/light theme calibrated to brand terminal palette.',
  },
  news_media: {
    sourceOrder: [
      '1. Official story lead image (brand article photography, verified event photograph, or editorial desk photo).',
      '2. Brand-owned publication masthead or section badge.',
      '3. Atmospheric editorial photograph reflecting the story domain (e.g. city hall, port container terminal, tech campus, press conference room) with all text/signage out of focus or unreadable.',
      '4. Minimalist typographic layout with zero photographs (Variant V1) — preferred for high deliverability news digests.',
    ],
    never: [
      'NEVER generate fake breaking-news photographs, synthetic politician portraits, or simulated news events.',
      'NEVER render readable newspaper headlines, simulated magazine covers, or fake article cards in the image.',
      'NEVER use cheesy stock photos of people pointing at laptops or reading fake newspapers.',
      'NEVER use images with burned-in ratings, badges, or unverified quotes.',
    ],
    compositionRule: 'Clean 16:9 or 3:2 editorial framing with journalistic documentary tone. Natural light, muted saturation, authentic grain.',
  },
  commerce: {
    sourceOrder: [
      '1. Verified hosted product catalogue photograph (primary CDN URL).',
      '2. PDP gallery alternate angles and unboxing stills.',
      '3. Photoreal lifestyle scene staging the genuine physical item on genuine surface.',
    ],
    never: [
      'NEVER generate synthetic product mockups when real catalogue photography exists.',
      'NEVER fabricate discount stickers, fake star rating badges, or fake award ribbons in the image.',
      'NEVER depict people with distorted anatomy or synthetic packaging.',
    ],
    compositionRule: 'Hero product centered or rule-of-thirds, clean crisp background, true-to-life studio or lifestyle lighting.',
  },
  subscription: {
    sourceOrder: [
      '1. Actual product interface screenshot or unboxing experience still.',
      '2. Lifestyle context showing subscriber workflow or moment of calm.',
      '3. Clean vector membership credential or tier crest.',
    ],
    never: ['NEVER generate fake software UI or fake feature dashboards.', 'NEVER invent fake customer reviews.'],
    compositionRule: 'Crisp, premium, focused on the moment of relief or capability unlocked.',
  },
  events: {
    sourceOrder: [
      '1. Actual venue photograph or previous edition crowd/stage photograph.',
      '2. Keynote speaker headshot (only if verified and provided).',
      '3. Atmospheric empty venue still prior to kickoff, lit in brand palette.',
    ],
    never: ['NEVER generate fake crowd scenes or fake celebrity speakers.'],
    compositionRule: 'Sense of scale, anticipation, and clear visual hierarchy.',
  },
  services: {
    sourceOrder: [
      '1. The craft in progress (hands, tools, blueprints, atelier).',
      '2. Case study outcome still of verified client deliverable.',
      '3. Premium workspace environment.',
    ],
    never: ['NEVER generate fake client logos or fake certification certificates.'],
    compositionRule: 'Intimate, warm, focus on mastery and human craftsmanship.',
  },
};

/**
 * Competitive benchmarking database for marketing assets.
 * Structures, section sequences, and business ideation logic
 * distilled from leading brands across verticals.
 */
const PLAYBOOKS = {
  // ── MARKET DATA & FINANCIAL INTELLIGENCE ───────────────────────────────────
  market_data: {
    mailer_v2: {
      name: 'Financial Intelligence Executive Briefing (Visual & Data)',
      exemplars: ['Bloomberg Daily Quint', 'Finshots Daily', 'Seeking Alpha Wall Street Breakfast', 'Robinhood Snacks', 'Morningstar Alert'],
      revenueJob: 'Habitual daily engagement leading to Pro Subscription / Premium Terminal upgrade or direct sponsorship yield.',
      revenueLevers: ['Daily Active Readers (DAR)', 'Free-to-Paid Subscription Upgrades', 'High-CPM Institutional Sponsorships'],
      kpis: ['Open Rate (target ≥ 45%)', 'Click-to-Open Rate (target ≥ 18%)', 'Trial/Pro Conversion Rate', 'Unsubscribe Rate (< 0.15%)'],
      sections: [
        {
          id: 'masthead',
          name: 'Executive Terminal Masthead',
          purpose: 'Immediate authority, edition tag, timestamp, read-time estimate (e.g. "3 min read"), and sponsor bug if active.',
          required: true,
        },
        {
          id: 'market_pulse',
          name: 'Market Pulse & Benchmark Bar',
          purpose: 'High-level macro snapshot (Nifty, S&P 500, Yields, Crude) strictly using supplied numbers. Bulleted and scannable.',
          required: false,
        },
        {
          id: 'lead_story',
          name: 'Lead Catalyst / The Big Move',
          purpose: 'The single most critical macroeconomic or sector catalyst driving capital flows. Why it happened, who benefits, what breaks.',
          required: true,
        },
        {
          id: 'data_breakdown',
          name: 'By The Numbers / Visual Breakdown',
          purpose: 'Concrete data points from verified reports. Hosted chart or structured comparison table.',
          required: false,
        },
        {
          id: 'sector_watchlist',
          name: 'Sector Movers & Radar',
          purpose: '3 to 5 rapid-fire bulleted items with key drivers. No advice; pure causal observation.',
          required: true,
        },
        {
          id: 'pro_monetization_card',
          name: 'Premium Intelligence / Pro Tier Callout',
          purpose: 'The revenue engine: what the brand\'s own paid tier gives, in the brand\'s words. Clear single CTA. Leave out when the brand states no paid tier.',
          required: true,
        },
        {
          id: 'disclaimer_footer',
          name: 'Regulatory Compliance & Editorial Disclaimer',
          purpose: 'Mandatory legal protection (SEBI/SEC/FCA). Explicit non-advice statement.',
          required: true,
        },
      ],
      designRules: [
        'Max content width 600px, responsive table container.',
        'High-contrast data aesthetics on the brand surface (never a dark section background): crisp sans-serif with monospace accents for figures.',
        'No frivolous decorative imagery. Every visual must earn its pixels through data clarity.',
        'Single prominent primary CTA button for the premium tier; all other links are subdued text hyperlinks.',
      ],
      ideationAngles: [
        'The Asymmetric Opportunity: Where consensus is looking left while the data points right.',
        'The Ripple Effect: How a single central bank or policy shift travels through 3 unexpected sectors.',
        'The Smart Money Track: Where institutional volumes are accumulating quietly before earnings.',
        'The Reality Check: Busting a viral retail trading myth with verified balance-sheet fundamentals.',
        'The Weekend Macro Playbook: 3 catalysts every professional investor is watching for Monday open.',
      ],
    },
    mailer_v1: {
      name: 'Financial Intelligence Fast-Reading Memo (Typographic)',
      exemplars: ['Matt Levine Money Stuff (Bloomberg)', 'Stratechery by Ben Thompson', 'Axios Markets'],
      revenueJob: 'Maximized inbox deliverability (100% text/table, zero image stripping) and intellectual credibility.',
      revenueLevers: ['Inbox Deliverability Rate', 'Authority Building', 'Paid Newsletter Subscriptions'],
      kpis: ['Open Rate (target ≥ 52%)', 'Forward/Share Rate', 'Annual Subscription Renewals'],
      sections: [
        { id: 'header', name: 'Clean Date & Edition Line', purpose: 'Zero bloat, instant immersion.', required: true },
        { id: 'opening_thesis', name: 'The Thesis Statement', purpose: 'One punchy paragraph framing the day.', required: true },
        { id: 'key_takeaways', name: 'The 3 Takeaways (Bullets)', purpose: 'Scannable executive summary in 30 seconds.', required: true },
        { id: 'deep_dive', name: 'The Analytical Deep-Dive', purpose: 'Rigorous reasoning, historical precedent, and second-order impacts.', required: true },
        { id: 'the_paywall_bridge', name: 'Member-Exclusive Insight Hook', purpose: 'Preview of premium research report with subscribe link.', required: true },
        { id: 'disclaimer_footer', name: 'Compliance Disclaimer', purpose: 'Regulatory required disclaimer.', required: true },
      ],
      designRules: ['Zero external images.', 'Typographic hierarchy using clean font weights, border-left quotes, and bullet spacing.'],
      ideationAngles: [
        'The Unintended Consequence: Why the latest regulatory change does the exact opposite of what headlines claim.',
        'Valuation Disconnect: Comparing historical multiples to present euphoria.',
      ],
    },
    ad_meta: {
      name: 'High-Converting Financial Intelligence Paid Ad (Meta/Instagram)',
      exemplars: ['The Motley Fool', 'Seeking Alpha', 'Koyfin', 'TradingView', 'Morningstar'],
      revenueJob: 'Customer Acquisition: Drive free newsletter signups or trial subscriptions at lowest CAC.',
      revenueLevers: ['Click-Through Rate (CTR ≥ 2.2%)', 'Landing Page Opt-In Rate (≥ 35%)', 'Payback Period on Ad Spend'],
      kpis: ['Cost Per Lead (CPL)', 'Cost Per Trial (CPT)', 'ROAS on Paid Subscriptions'],
      sections: [
        { id: 'primary_text', name: 'Hook + Agitation + Curiosity Gap', purpose: 'Call out smart investors tired of generic noise. Present one non-consensus fact.', required: true },
        { id: 'creative_image', name: 'Clean Data Visualization Still', purpose: 'Visual proof: the brand\'s own product screen or a chart built from supplied data. No text painted into the image; the platform renders the copy.', required: true },
        { id: 'headline', name: 'Benefit-Led Punchy Hook (≤ 40 chars)', purpose: 'One concrete promise the brand itself makes. A reader count only when the brand states it.', required: true },
        { id: 'cta_button', name: 'Direct Frictionless Action', purpose: 'Subscribe / Sign Up / Learn More.', required: true },
      ],
      designRules: [
        'Creative ratio: 1:1 square for feed, 9:16 for Reels/Stories.',
        'No words painted into the image; keep the middle 60% clear of clutter for the platform\'s own text.',
        'No fake return promises ("Make 10x in 24 hours" violates platform policies and financial law).',
      ],
      ideationAngles: [
        'The Insider vs Retail Gap: what professionals check that most readers never see.',
        'The Morning Advantage: the day\'s noise cut to one short briefing before the open.',
        'The Cost of Ignorance: what happened the last time a supplied indicator moved this way.',
      ],
    },
    landing_page: {
      name: 'Financial Intelligence Direct-Response Subscription Page',
      exemplars: ['Seeking Alpha Premium', 'Substack Finance Top 10', 'The Browser', 'Refinitiv Workspace'],
      revenueJob: 'Conversion of visitors into annual/monthly paid subscribers or verified leads.',
      revenueLevers: ['Opt-in Conversion Rate', 'Annual Upfront Plan Upgrades', 'Customer Lifetime Value (LTV)'],
      kpis: ['Visitor-to-Lead %', 'Lead-to-Paid %', 'Average Revenue Per User (ARPU)'],
      sections: [
        { id: 'sticky_bar', name: 'Daily Issue Alert Bar', purpose: 'When the next edition arrives, only as the brand states its schedule. Leave out otherwise.', required: false },
        { id: 'hero', name: 'Clear Value Proposition & Email Capture Box', purpose: 'What you get, when it arrives, who reads it, zero-click email form.', required: true },
        { id: 'social_proof_bar', name: 'Subscriber Count & Industry Logos', purpose: 'A subscriber count or reader logos only when the brand states them. Leave out otherwise.', required: false },
        { id: 'sample_edition', name: 'Interactive / Visual Sample Issue Preview', purpose: 'Let the reader read 2 actual analysis snippets so they experience the quality.', required: true },
        { id: 'pro_features_grid', name: 'What Free Gets vs What Pro Gets', purpose: 'Feature comparison table: daily brief vs real-time alerts + valuation models.', required: true },
        { id: 'testimonials', name: 'Named Subscriber Testimonials', purpose: 'Quotes copied from the brand\'s approved review library. Leave out when it is empty.', required: false },
        { id: 'risk_reversal', name: 'Unconditional Guarantee / Cancel Anytime', purpose: 'The brand\'s own stated refund or cancellation terms. Leave out when it states none.', required: false },
        { id: 'faq', name: 'Frequently Asked Questions & Disclaimer', purpose: 'Addresses source credibility, frequency, and mandatory SEBI/SEC disclaimer.', required: true },
      ],
      designRules: ['Single scroll path.', 'Zero navigation leaks (no external social links leading off page).', 'Immediate frictionless form field.'],
      ideationAngles: ['Become the Most Informed Person in the Room.', 'Stop Reacting to News. Start Anticipating Catalysts.'],
    },
  },

  // ── NEWS & EDITORIAL MEDIA ─────────────────────────────────────────────────
  news_media: {
    mailer_v2: {
      name: 'Smart Brevity Editorial Daily Digest',
      exemplars: ['Axios AM', 'Morning Brew', 'The Hustle', 'The New York Times Morning', 'Puck News'],
      revenueJob: 'Habitual high-frequency readership, sponsorship revenue optimization, and membership upsell.',
      revenueLevers: ['Open Rate & Daily Retention', 'Ad Sponsorship Click Yield', 'Subscriber Membership Tiers'],
      kpis: ['Open Rate (target ≥ 42%)', 'CTOR (target ≥ 15%)', '7-Day & 30-Day Cohort Retention'],
      sections: [
        { id: 'masthead', name: 'Publication Header & Reading Time', purpose: 'Brand mark, edition date and estimated read time. No weather or city line unless supplied.', required: true },
        { id: 'lead_story', name: 'Top Story with "Why It Matters"', purpose: 'The primary headline, journalistic summary, bulleted facts, and bolded "Why it matters" paragraph.', required: true },
        { id: 'visual_editorial', name: 'Editorial Photo or Infographic', purpose: 'Single authoritative photograph or data visual directly linked to story.', required: false },
        { id: 'bulletin_bites', name: 'In Other News (The Quick Scans)', purpose: '4 to 6 punchy 2-sentence updates across politics, business, tech, culture.', required: true },
        { id: 'sponsor_slot', name: 'Native Sponsored Placement', purpose: 'Seamlessly styled ad slot matching editorial typeface, clearly labelled.', required: false },
        { id: 'curated_link', name: 'The Long Read / Watercooler Item', purpose: 'Delight piece: unexpected trivia, cultural essay, or thought-provoking interview.', required: true },
        { id: 'footer', name: 'Editorial Colophon & Feedback', purpose: 'Masthead byline, a reader feedback link, unsubscribe.', required: true },
      ],
      designRules: [
        'Axios "Smart Brevity" style: bold lead-in words on every paragraph.',
        'High white-space ratio, max 600px wide.',
        'Generous line-height (1.6) for mobile scanning.',
      ],
      ideationAngles: [
        'The Big Picture: Connecting three seemingly unrelated stories into one mega-trend.',
        'The Story Behind the Story: context the brand\'s own reporting adds to a headline.',
        'What We are Watching: Upcoming deadlines, trials, or releases that will reshape the quarter.',
      ],
    },
    mailer_v1: {
      name: 'Executive Text Memo / Clean Editorial',
      exemplars: ['Semafor Flagship', 'Letters from an American (Heather Cox Richardson)', 'Dan Primack Pro Rata'],
      revenueJob: 'Direct journalistic authority and ultra-high deliverability.',
      revenueLevers: ['Deliverability Score', 'Substack / Ghost Paid Subscription Tiers'],
      kpis: ['Inbox Primary Placement %', 'Open Rate', 'Subscriber Referrals'],
      sections: [
        { id: 'header', name: 'Date & Author Note', purpose: 'Personal voice from lead editor.', required: true },
        { id: 'main_brief', name: 'The Core Investigation / News Analysis', purpose: 'Objective reporting with analytical commentary.', required: true },
        { id: 'the_takeaway', name: 'The Bottom Line', purpose: 'Clear 1-sentence conclusion.', required: true },
        { id: 'footer', name: 'Author Byline & Share Link', purpose: 'Referral engine CTA.', required: true },
      ],
      designRules: ['Clean typography, web-safe fonts, brand ink on the brand surface.'],
      ideationAngles: ['The Context Behind the Headline.', 'The Untold Angle.'],
    },
    ad_meta: {
      name: 'Editorial Media Growth Ad (Meta/Instagram)',
      exemplars: ['The Economist', 'Morning Brew', 'The Atlantic', 'Foreign Affairs'],
      revenueJob: 'Low-cost subscriber acquisition for daily media email list.',
      revenueLevers: ['CPL (Cost per free subscriber)', 'Viral coefficient / referrals'],
      kpis: ['Cost Per Subscriber', 'Day-30 Open Rate of Acquired Cohort'],
      sections: [
        { id: 'primary_text', name: 'Intellectual Hook / Curated Curiosity', purpose: 'Highlight a fascinating insight from today’s edition.', required: true },
        { id: 'creative_image', name: 'Clean Editorial Visual / Quote Card', purpose: 'High-contrast typography quote card or newsroom still.', required: true },
        { id: 'headline', name: 'Clear Promise', purpose: 'e.g. "Get Smarter in 5 Minutes Every Morning".', required: true },
        { id: 'cta_button', name: 'Action', purpose: 'Subscribe.', required: true },
      ],
      designRules: ['Quote card or clean editorial photograph.', 'Minimalist, dignified aesthetic.'],
      ideationAngles: [
        'The 5-Minute Habit: the day\'s news in one short read, in the brand\'s own words.',
        'The Perspective Shift: "News that explains why things happened, not just that they happened."',
      ],
    },
    landing_page: {
      name: 'Editorial Media 1-Click Subscribe Presell',
      exemplars: ['Morning Brew Homepage', 'Axios Newsletters', 'The Free Press'],
      revenueJob: 'Instant conversion of reader traffic into newsletter subscribers.',
      revenueLevers: ['Landing page conversion rate (≥ 40%)'],
      kpis: ['Cost per acquisition', 'Opt-in %', 'Referral share %'],
      sections: [
        { id: 'hero', name: 'Headline + Sub + Instant Email Field', purpose: 'No scrolling needed to subscribe.', required: true },
        { id: 'edition_preview', name: 'Sample Snippet / Carousel', purpose: 'Shows exactly what lands in the inbox tomorrow.', required: true },
        { id: 'reader_proof', name: 'Social Proof / Reader Testimonials', purpose: 'Reader quotes copied from the brand\'s approved review library. Leave out when it is empty.', required: false },
        { id: 'footer', name: 'Privacy Guarantee', purpose: 'The brand\'s own privacy and unsubscribe terms, as it states them.', required: true },
      ],
      designRules: ['Mobile above-the-fold form.', 'Zero friction, instant confirmation.'],
      ideationAngles: ['The Morning Routine of the Ambitious.'],
    },
  },

  // ── COMMERCE & D2C LIFESTYLE ──────────────────────────────────────────────
  commerce: {
    mailer_v2: {
      name: 'D2C Retention & Merchandising Showcase (Visual + Copy)',
      exemplars: ['Glossier', 'Nike', 'Apple Store', 'Ridge Wallet', 'Gymshark'],
      revenueJob: 'Direct revenue generation, AOV lift with bundles, repeat purchase acceleration.',
      revenueLevers: ['First-to-Second Purchase Conversion', 'Average Order Value (AOV)', 'Replenishment Cycle'],
      kpis: ['Revenue Per Recipient (RPR)', 'Placed Order Rate', 'Average Order Value'],
      sections: [
        { id: 'hero', name: 'Hero Spotlight / Drop Announcement', purpose: 'Striking product visual, headline, and primary purchase CTA.', required: true },
        { id: 'story_craft', name: 'The Craft / Material Origin Story', purpose: 'Sensory copywriting explaining what makes this piece unique.', required: true },
        { id: 'product_grid', name: 'Curated 2-to-4 Product Grid', purpose: 'Complementary items, cross-sell accessories, or bestsellers.', required: true },
        { id: 'social_proof', name: 'Verified Customer Mini-Stories', purpose: 'Quotes, ratings and photos copied from the brand\'s approved review library. Leave out when it is empty.', required: false },
        { id: 'benefit_strip', name: 'Trust Bar (Shipping, Guarantee, Returns)', purpose: 'The shipping, returns and guarantee terms the brand states, verbatim. Leave out when it states none.', required: false },
        { id: 'footer_cta', name: 'Final Sticky CTA', purpose: 'Shop the collection button.', required: true },
      ],
      designRules: ['600px width table.', 'HD product photos on brand surface.', 'High-contrast primary CTA buttons.'],
      ideationAngles: ['Built for the Daily Routine.', 'The Uncompromised Standard.'],
    },
    mailer_v1: {
      name: 'D2C Typographic Letter / Studio Origin Note',
      exemplars: ['Everlane Letter', 'Patagonia Action Note'],
      revenueJob: 'Warm trust-building, lapsed-customer re-engagement, founder authenticity.',
      revenueLevers: ['Winback Rate', 'Brand Affinity & LTV'],
      kpis: ['Open Rate', 'Reactivation Orders'],
      sections: [
        { id: 'salutation', name: 'Personal Opening', purpose: 'Warm studio note from the makers.', required: true },
        { id: 'narrative', name: 'The Honest Story', purpose: 'Why we crafted this batch and what we refused to compromise.', required: true },
        { id: 'cta', name: 'One Understated Next Step', purpose: 'View the studio archive.', required: true },
      ],
      designRules: ['Zero images.', 'Letterhead typography with warm signature line.'],
      ideationAngles: ['Why We Made This.', 'A Behind-the-Scenes Note.'],
    },
    ad_meta: {
      name: 'High-ROAS Direct Response Product Ad (Meta)',
      exemplars: ['Ridge', 'True Classic', 'Lunya', 'Vuori'],
      revenueJob: 'Profitable customer acquisition at high AOV.',
      revenueLevers: ['Blended ROAS', 'AOV', 'Conversion Rate'],
      kpis: ['ROAS', 'Cost Per Acquisition (CPA)', 'Thumb-stop Rate (3-sec video/image view)'],
      sections: [
        { id: 'hook', name: 'Visual Scroll-Stopper + Problem Agitation', purpose: 'Call out the daily annoyance or upgrade desire in 1 second.', required: true },
        { id: 'product_reveal', name: 'Product Hero Showcase', purpose: 'The product\'s own catalogue photo; the offer goes in the copy, never painted on the image.', required: true },
        { id: 'proof_offer', name: 'Offer + Risk Reversal', purpose: 'The offer and terms on record for this slot, exactly. Leave out when there is none.', required: false },
      ],
      designRules: ['1:1 and 9:16 aspect ratios.', 'No words painted into the image; keep the bottom 20% clear.'],
      ideationAngles: ['The Upgrade You Feel Every Day.', 'Ditch the Bulky Relic.'],
    },
    landing_page: {
      name: 'Direct-Response Presell / Advertorial Landing Page',
      exemplars: ['HexClad Presell', 'Manscaped Landers', 'Beam TLC Landers'],
      revenueJob: 'Pre-framing cold paid traffic into eager high-intent buyers.',
      revenueLevers: ['Direct Checkout Conversion %', 'Bundle Take Rate'],
      kpis: ['Conversion Rate', 'AOV', 'Add-to-Cart %'],
      sections: [
        { id: 'announcement', name: 'Sticky Offer Bar', purpose: 'The offer on record, exactly; no countdown unless a real end date is on record.', required: false },
        { id: 'hero', name: 'Hero Headline + Buy Box', purpose: 'Fast order path. A proof badge only from the approved review library.', required: true },
        { id: 'comparison_table', name: 'Us vs Alternatives', purpose: 'Only differences the brand itself states. Leave out otherwise.', required: false },
        { id: 'bundle_selector', name: 'Tiered Pricing Ladder (Good / Better / Best)', purpose: 'Only bundles and prices in the catalogue. Leave out otherwise.', required: false },
        { id: 'guarantee', name: 'Guarantee', purpose: 'The brand\'s own stated guarantee, verbatim. Leave out when it states none.', required: false },
      ],
      designRules: ['Sticky bottom buy-button on mobile.', 'Approved proof, when there is any, visible without scroll.'],
      ideationAngles: ['Why People Make the Switch, in the brand\'s own words.'],
    },
  },

  // ── SUBSCRIPTION, EVENTS, SERVICES FALLBACKS ──────────────────────────────
  subscription: {
    mailer_v2: {
      name: 'Subscription Membership Value & Renewal Accelerator',
      exemplars: ['Whoop', 'Oura', 'Spotify Premium', 'Equinox+'],
      revenueJob: 'Churn reduction, routine usage habit, and annual plan renewal.',
      revenueLevers: ['Monthly-to-Annual Upgrades', 'Retention / Churn Rate'],
      kpis: ['Subscriber Retention %', 'Feature Adoption Depth'],
      sections: [
        { id: 'hero', name: 'Member Milestone / Weekly Summary', purpose: 'Celebrate their usage and progress.', required: true },
        { id: 'feature_unlock', name: 'New Feature / Perk Spotlight', purpose: 'Reinforce membership value.', required: true },
        { id: 'upgrade_cta', name: 'Annual Upgrade Incentive', purpose: 'The annual-plan saving the brand states, exactly. Leave out when it states none.', required: false },
      ],
      designRules: ['App-like cards on the brand surface, clean icons.'],
      ideationAngles: ['Your Weekly Recap: How You Compared.', 'Member Perk Unlocked.'],
    },
  },
  events: {
    mailer_v2: {
      name: 'Event Announcement & Registration Ramp',
      exemplars: ['TED Conference', 'TechCrunch Disrupt', 'New York Marathon'],
      revenueJob: 'Drive ticket registrations through honest date-bound urgency.',
      revenueLevers: ['Ticket Sales Velocity', 'VIP Pass Conversions'],
      kpis: ['Registration Count', 'Early-Bird Sellout Time'],
      sections: [
        { id: 'hero', name: 'Event Name, Date, City, Venue', purpose: 'Immediate logistical clarity.', required: true },
        { id: 'agenda_highlight', name: 'Keynote & Experience Highlights', purpose: 'Why attending in person changes things.', required: true },
        { id: 'ticket_ladder', name: 'Registration Tiers with Real Deadlines', purpose: 'Only tiers, prices and deadlines the brand states.', required: true },
      ],
      designRules: ['Prominent calendar save-the-date widget.', 'A countdown only to a deadline the brand states.'],
      ideationAngles: ['The Gathering of the Year.', 'Why Being in the Room Matters.'],
    },
  },
  services: {
    mailer_v2: {
      name: 'Service Commission & Atelier Briefing',
      exemplars: ['Savile Row Bespoke', 'Pentagram Inquiry Note'],
      revenueJob: 'Consultation booking, bespoke commission brief submission.',
      revenueLevers: ['Qualified Inquiries', 'Average Deal Size'],
      kpis: ['Brief Submission Rate', 'Consultation Bookings'],
      sections: [
        { id: 'hero', name: 'Case Study Outcome Showcase', purpose: 'A finished project the brand itself publishes. Leave out otherwise.', required: false },
        { id: 'process', name: 'The 3-Step Engagement Process', purpose: 'Demystify how working together begins.', required: true },
        { id: 'inquiry_cta', name: 'Book Discovery Call / Submit Brief', purpose: 'Low-friction private inquiry.', required: true },
      ],
      designRules: ['Editorial elegance, spacious margins, bespoke craftsmanship imagery.'],
      ideationAngles: ['Commissioning Your One-of-One.', 'The Anatomy of a Finished Project.'],
    },
  },
};

/**
 * Retrieve the playbook for a specific brand and asset type.
 * Gracefully falls back if a sub-asset type is not specified.
 * @param {object} brand
 * @param {string} assetType - e.g. 'mailer_v2', 'mailer_v1', 'ad_meta', 'landing_page'
 * @returns {object} Playbook specification
 */
function playbookFor(brand, assetType) {
  const model = businessModel(brand);
  const modelPlaybooks = PLAYBOOKS[model] || PLAYBOOKS.commerce;
  const normalizedType = String(assetType || 'mailer_v2').toLowerCase().replace('-', '_');

  if (modelPlaybooks[normalizedType]) {
    return { ...modelPlaybooks[normalizedType], businessModel: model };
  }

  // Fallbacks within the model or commerce
  if (normalizedType.includes('mailer')) {
    const key = normalizedType.includes('v1') ? 'mailer_v1' : 'mailer_v2';
    return { ...(modelPlaybooks[key] || PLAYBOOKS.commerce[key]), businessModel: model };
  }
  if (normalizedType.includes('ad')) {
    return { ...(modelPlaybooks.ad_meta || PLAYBOOKS.commerce.ad_meta), businessModel: model };
  }
  if (normalizedType.includes('landing') || normalizedType.includes('lp')) {
    return { ...(modelPlaybooks.landing_page || PLAYBOOKS.commerce.landing_page), businessModel: model };
  }

  return { ...(modelPlaybooks.mailer_v2 || PLAYBOOKS.commerce.mailer_v2), businessModel: model };
}

/**
 * Image policy retriever for a brand.
 * @param {object} brand
 * @returns {object} { sourceOrder: string[], never: string[], compositionRule: string }
 */
function imagePolicyFor(brand) {
  const model = businessModel(brand);
  return IMAGE_POLICIES[model] || IMAGE_POLICIES.commerce;
}

// What a benchmark may lend and what it may not (2026-10-17). These playbooks
// describe how OTHER publications and stores build assets; the structure is
// borrowed, never their facts. Said in every block so a section that needs a
// fact this brand has not given is left out instead of filled.
const BORROW_RULE = 'HOW TO USE THIS BENCHMARK: borrow the STRUCTURE and the order of sections only. Every fact, number, price, review, rating, subscriber count, guarantee, shipping or returns term, deadline and market figure comes from this brand\'s own record and the data supplied above, or the section is left out. Never write a figure from the benchmark or its exemplars. Section backgrounds are the brand colour or its surface, never black or dark grey.';

/**
 * The benchmark for every asset ONE copy request writes (Smart Brain writes
 * the email, the landing page and the ads in one answer), compact: the
 * revenue job once, then each asset's section order, then the rule above.
 */
function playbookBrief(brand, assetTypes, opts = {}) {
  const types = (Array.isArray(assetTypes) && assetTypes.length) ? assetTypes : ['mailer_v2'];
  const first = playbookFor(brand, types[0]);
  const model = first.businessModel;
  const lines = [
    `COMPETITIVE BENCHMARK (${model.replace('_', ' ')}; patterns from ${(first.exemplars || []).slice(0, 4).join(', ')}):`,
    `- Revenue job: ${first.revenueJob}`,
  ];
  const label = { mailer_v2: 'Email', mailer_v1: 'Text email', landing_page: 'Landing page', ad_meta: 'Ads' };
  for (const t of types) {
    const pb = playbookFor(brand, t);
    const secs = (pb.sections || []).map((x) => `${x.name}${x.required ? '' : ' (only if the brand states it)'}`).join(' > ');
    if (secs) lines.push(`- ${label[t] || t} sections, in order: ${secs}`);
  }
  const angles = (first.ideationAngles || []).slice(0, 3);
  if (angles.length) lines.push(`- Angles that work in this business: ${angles.join(' | ')}`);
  lines.push(`- ${BORROW_RULE}`);
  if (model === 'market_data') lines.push(`- Every email and page closes with this disclaimer, which the layout adds; write nothing that contradicts it (no advice, no promised return): "${financialDisclaimer(opts.market || (brand && brand.region) || 'US', brand)}"`);
  return lines.join('\n');
}

/**
 * Build a structured, actionable prompt block for the LLM based on
 * the benchmarked playbook for this business model and asset type.
 * @param {object} brand
 * @param {string} assetType
 * @param {object} [opts]
 * @returns {string} Text block to embed into master-prompt or generation prompt
 */
function playbookBlock(brand, assetType, opts = {}) {
  const pb = playbookFor(brand, assetType);
  const model = pb.businessModel;
  const imgPolicy = imagePolicyFor(brand);
  const market = opts.market || (brand && brand.region) || 'US';

  const sectionLines = pb.sections
    ? pb.sections.map((s, i) => `  ${i + 1}. [${s.name.toUpperCase()}] ${s.purpose}${s.required ? ' (REQUIRED)' : ' (OPTIONAL)'}`).join('\n')
    : '';

  const ideationLines = pb.ideationAngles
    ? pb.ideationAngles.map((a) => `  - "${a}"`).join('\n')
    : '';

  const designLines = pb.designRules
    ? pb.designRules.map((r) => `  - ${r}`).join('\n')
    : '';

  const imgSourceLines = imgPolicy.sourceOrder.map((s) => `  ${s}`).join('\n');
  const imgNeverLines = imgPolicy.never.map((n) => `  ${n}`).join('\n');

  const parts = [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `COMPETITIVE BENCHMARK PLAYBOOK: ${pb.name.toUpperCase()}`,
    `Vertical / Business Model: ${model.toUpperCase()} (Benchmarked against: ${(pb.exemplars || []).join(', ')})`,
    `Revenue Objective: ${pb.revenueJob}`,
    `Revenue Levers: ${(pb.revenueLevers || []).join(' · ')}`,
    `Core KPIs: ${(pb.kpis || []).join(' · ')}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `SECTION ARCHITECTURE & STRUCTURE (Follow this exact sequence):`,
    sectionLines,
    ``,
    `DESIGN & LAYOUT STANDARDS:`,
    designLines,
    ``,
    `PROVEN COMMERCIAL IDEATION HOOKS:`,
    ideationLines,
    ``,
    `IMAGE POLICY & ASSET COMPLIANCE:`,
    `Source Priority Order:`,
    imgSourceLines,
    `Absolute Prohibitions:`,
    imgNeverLines,
    `Composition Rule: ${imgPolicy.compositionRule}`,
  ];

  parts.push(``, BORROW_RULE);

  if (model === 'market_data') {
    parts.push(
      ``,
      `REGULATORY DISCLAIMER REQUIREMENT (Mandatory for ${market} Market):`,
      `"${financialDisclaimer(market, brand)}"`,
      `This disclaimer must appear in full at the bottom of the asset.`,
    );
  }

  return parts.filter(Boolean).join('\n');
}

/**
 * Returns a structural checklist to verify that a generated asset complies
 * with the benchmarked requirements of its business model.
 * @param {object} brand
 * @param {string} assetType
 * @returns {Array<{ id: string, name: string, test: string, required: boolean }>}
 */
function structureChecklist(brand, assetType) {
  const pb = playbookFor(brand, assetType);
  const list = (pb.sections || []).map((s) => ({
    id: s.id,
    name: s.name,
    test: `Asset contains section '${s.name}' serving purpose: ${s.purpose}`,
    required: s.required,
  }));

  if (pb.businessModel === 'market_data') {
    list.push({
      id: 'compliance_disclaimer',
      name: 'Regulatory Financial Disclaimer',
      test: 'Asset contains standard non-advice educational disclaimer without fabricated returns.',
      required: true,
    });
    list.push({
      id: 'no_synthetic_charts',
      name: 'No Hallucinated Visual Data',
      test: 'Image brief or layout does not ask for fake candlestick charts or synthetic tickers.',
      required: true,
    });
  }

  return list;
}

/**
 * Returns curated high-converting competitor hook formulas and angles
 * tailored to a brand's commercial model.
 * @param {object} brand
 * @param {string} [assetType]
 * @returns {Array<{ id: string, name: string, category: string, formula: string, example: string, whyItConverts: string }>}
 */
function competitorHooksFor(brand, assetType = 'mailer') {
  const model = businessModel(brand);
  const brandName = (brand && brand.name) || 'the brand';

  const HOOK_CATALOG = {
    market_data: [
      {
        id: 'contrarian_shift',
        name: 'The Contrarian Shift',
        category: 'Market Catalyst',
        formula: 'While retail was watching {event_A}, institutional capital quietly rotated into {sector_B}.',
        example: `While retail was fixated on headline rate cuts, institutional desks quietly added to defensive domestic industrials.`,
        whyItConverts: 'Subverts consensus expectations; triggers fear of missing the institutional move.',
      },
      {
        id: 'blindspot_reveal',
        name: 'The Blindspot Reveal',
        category: 'Data Asymmetry',
        formula: 'The 1 metric most {market} investors miss before {key_event}.',
        example: `The 1 liquidity metric most equity investors miss before quarterly earnings.`,
        whyItConverts: 'Promises proprietary edge and information asymmetry without making illegal return promises.',
      },
      {
        id: 'macro_domino',
        name: 'The Macro Domino',
        category: 'Causal Thesis',
        formula: 'How the latest move in {macro_metric} triggers a second-order shock in {sector}.',
        example: `How the 10-year yield curve steepening directly impacts private credit valuations this quarter.`,
        whyItConverts: 'Establishes intellectual rigor and analytical authority for executive decision-makers.',
      },
      {
        id: 'institutional_divergence',
        name: 'The Institutional Divergence',
        category: 'Proprietary Signal',
        formula: 'Smart money vs retail sentiment: what {brandName} order-flow indicators show right now.',
        example: `Smart money vs retail positioning: what ${brandName}'s proprietary radar reveals about the banking sector.`,
        whyItConverts: 'Positions the brand as the essential terminal/data tool for serious traders.',
      },
    ],
    news_media: [
      {
        id: 'smart_brevity_lead',
        name: 'The Smart Brevity Lead',
        category: 'Executive Briefing',
        formula: 'Why it matters: {Core development in 1 crisp sentence}. Here is what happens next.',
        example: `Why it matters: The merger fundamentally alters European cloud sovereignty. Here is what happens next.`,
        whyItConverts: 'Respects executive time; guarantees instant scannability and maximum signal-to-noise ratio.',
      },
      {
        id: 'inside_room',
        name: 'The Inside Room',
        category: 'Investigative Context',
        formula: 'Behind closed doors: what {leaders} actually agreed on during {event}.',
        example: `Behind closed doors: what trade ministers agreed on during yesterday's emergency session.`,
        whyItConverts: 'Exclusive insider perspective drives high newsletter click-to-open rates (CTOR).',
      },
      {
        id: 'counter_narrative',
        name: 'The Counter-Narrative',
        category: 'Intellectual Depth',
        formula: 'The headline says {popular_claim}. The real data tells an entirely different story.',
        example: `The headline claims EV demand collapsed. The supply-chain import data tells an entirely different story.`,
        whyItConverts: 'Challenges superficial media coverage with verifiable data and rigorous reporting.',
      },
      {
        id: 'three_minute_digest',
        name: 'The 3-Minute Digest',
        category: 'Utility & Habit',
        formula: 'Everything you need to know about {trend} before your 9 AM meeting.',
        example: `Everything you need to know about the AI semiconductor antitrust inquiry before your morning standup.`,
        whyItConverts: 'Delivers daily utility and prepares the reader to sound smarter in their workplace.',
      },
    ],
    commerce: [
      {
        id: 'emotional_end_state',
        name: 'The Emotional End-State',
        category: 'Aspirational Outcome',
        formula: 'What everyday life feels like once you upgrade to {product_or_collection}.',
        example: `What a {use_moment} feels like once {product} is part of it.`,
        whyItConverts: 'Sells the payoff and transformation rather than technical specifications.',
      },
      {
        id: 'us_vs_them',
        name: 'The Us vs Them Contrast',
        category: 'Craftsmanship & Integrity',
        formula: 'Most {category} cut corners with {cheap_practice}. Why {brandName} obsesses over {premium_craft}.',
        example: `Most {category} cut corners on {practice}. Why ${brandName} does {what the brand itself states it does}.`,
        whyItConverts: 'Differentiates the brand sharply against commoditized mass-market competitors.',
      },
      {
        id: 'unboxing_sensory',
        name: 'The Sensory Unboxing',
        category: 'Tactile Proof',
        formula: 'From the first unboxing: {sensory_details} that prove this isn\'t ordinary {category}.',
        example: `From the first touch to the finish: the details of {product} that its own page describes.`,
        whyItConverts: 'Triggers anticipatory desire and builds tangible value before purchase.',
      },
      {
        id: 'vault_drop',
        name: 'The Vault Drop / Scarcity',
        category: 'Exclusivity & Urgency',
        formula: 'Limited run: only {quantity the brand states} made. When they are gone, this release closes.',
        example: `Limited run: only {stated quantity} made for this release. Use this only when the brand states the quantity.`,
        whyItConverts: 'Genuine scarcity drives immediate purchase action without resorting to cheap countdown timers.',
      },
    ],
    subscription: [
      {
        id: 'compounding_advantage',
        name: 'The Compounding Advantage',
        category: 'Productivity & ROI',
        formula: 'How {professionals} save time every week using {feature}.',
        example: `How {the brand's readers} get back time every week with {a feature the brand names}.`,
        whyItConverts: 'Translates recurring cost into massive ROI and career leverage.',
      },
      {
        id: 'cost_of_inaction',
        name: 'The Cost of Inaction',
        category: 'Loss Aversion',
        formula: 'The silent revenue leakage happening in your {system} every month you delay.',
        example: `The quiet cost of {problem the brand solves} every month it waits.`,
        whyItConverts: 'Loss aversion is psychologically 2x more potent than prospective gain.',
      },
    ],
    events: [
      {
        id: 'closed_door_room',
        name: 'The Closed-Door Room',
        category: 'Access & Status',
        formula: 'The room where the future of {industry} gets decided. Meet the {speakers/delegates}.',
        example: `The room where the next chapter of {industry} gets decided. Meet {the speakers the brand names}.`,
        whyItConverts: 'Leverages FOMO and professional status recognition.',
      },
    ],
    services: [
      {
        id: 'strategic_teardown',
        name: 'The Strategic Teardown',
        category: 'Proven Track Record',
        formula: 'How we diagnosed {client_challenge} and engineered a {measurable_payoff} in {timeframe}.',
        example: `How we diagnosed {a client's challenge} and delivered {a result the brand publishes}. Use only a case the brand itself publishes.`,
        whyItConverts: 'Tangible case study proof eliminates buyer skepticism before the discovery call.',
      },
    ],
  };

  return HOOK_CATALOG[model] || HOOK_CATALOG.commerce;
}

// The regulatory disclaimer, printed (2026-10-17). The playbooks always said a
// market-data asset must close with it, but only the Studio's prompt carried it
// and no renderer printed it, so a research brand's mail and landing page went
// out with none. Inserted above the sender line, in that line's own style (its
// colour is already AA on its ground), else at the top of the <footer>, else
// before </body>. Any other business: the html unchanged.
function disclaimerFor(brand, market) {
  return businessModel(brand) === 'market_data' ? financialDisclaimer(market, brand) : '';
}
function withDisclaimer(html, brand, market) {
  const s = String(html || '');
  const text = disclaimerFor(brand, market);
  if (!s || !text || /data-disclaimer/.test(s)) return s;
  const t = text.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  // The sender line is a <p> in some renderers and a <div> in others; the
  // block takes the same tag and style, so it sits on the same ground.
  const legal = /<(p|div)(\s[^>]*)?>(?=(?:(?!<\/?(?:p|div)[\s>])[\s\S])*?(?:receiving this as|DATA REQUIRED BEFORE LAUNCH: legal|DATA REQUIRED BEFORE LAUNCH: sender))/i.exec(s)
    || /<(p|div)(\s[^>]*)?>(?=(?:(?!<\/?(?:p|div)[\s>])[\s\S])*?unsubscribe)/i.exec(s);
  if (legal) return s.slice(0, legal.index) + `<${legal[1]} data-disclaimer${legal[2] || ''}>${t}</${legal[1]}>` + s.slice(legal.index);
  const foot = /<footer[^>]*>/i.exec(s);
  if (foot) { const at = foot.index + foot[0].length; return s.slice(0, at) + `<p data-disclaimer style="margin:0 0 10px;font-size:11px;line-height:1.6">${t}</p>` + s.slice(at); }
  const i = s.toLowerCase().lastIndexOf('</body>');
  const block = `<p data-disclaimer style="margin:16px;font-size:11px;line-height:1.6">${t}</p>`;
  return i === -1 ? s + block : s.slice(0, i) + block + s.slice(i);
}

// The button a reader of THIS business presses when no copy named one: a news
// reader starts reading, nobody "shops" a newsletter (2026-10-17 audit).
function defaultCta(brand, opts) {
  const hasProduct = !!(opts && opts.hasProduct);
  const map = { commerce: hasProduct ? 'Shop now' : 'Learn more', news_media: 'Start reading', market_data: 'See the research', subscription: 'Start now', events: 'Book your place', services: 'Get in touch' };
  return map[businessModel(brand)] || 'Learn more';
}

module.exports = {
  BUSINESS_MODELS,
  businessModel,
  defaultCta,
  playbookBrief,
  disclaimerFor,
  withDisclaimer,
  BORROW_RULE,
  financialDisclaimer,
  imagePolicyFor,
  playbookFor,
  playbookBlock,
  structureChecklist,
  competitorHooksFor,
  PLAYBOOKS,
  IMAGE_POLICIES,
};

