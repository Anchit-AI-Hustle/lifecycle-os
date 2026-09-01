/*
 * design-intelligence.js — shared design-intelligence library (dual-mode).
 * ---------------------------------------------------------------------------
 * ONE source of truth for: (a) the benchmarking SOURCE platforms, and (b) the
 * research-grounded design DIRECTIVES — 3-4 conversion-oriented design
 * variations per asset type (mailer, landing page, Google / Meta / TikTok ad).
 *
 * Consumed BOTH:
 *   • in the browser  → window.__DESIGN_INTEL (the /design-intel page + studios)
 *   • in Node         → require('../data/design-intelligence.js') (generators)
 *
 * Directives are SYNTHESISED design patterns (layout / hook / proof / CTA), not
 * copies of any competitor's creative — we never reproduce their assets. Grounded
 * in July-2026 trend research; refresh `updated` when re-researched.
 */
(function () {
  'use strict';

  // ── Benchmarking source platforms, grouped by what they cover ──────────────
  var SOURCES = [
    { name: 'Milled',             url: 'https://milled.com',                                  covers: ['mailer'],        note: 'Searchable archive of real brand emails — subject lines + full renders.' },
    { name: 'Really Good Emails', url: 'https://reallygoodemails.com',                        covers: ['mailer'],        note: 'Curated best-in-class email designs by category and use-case.' },
    { name: 'MailCharts',         url: 'https://www.mailcharts.com',                          covers: ['mailer'],        note: 'Competitor email cadence, campaigns and journey benchmarking.' },
    { name: 'Land-Book',          url: 'https://land-book.com',                               covers: ['landing_page'],  note: 'Gallery of high-quality landing pages, filterable by style/industry.' },
    { name: 'Lapa Ninja',         url: 'https://www.lapa.ninja',                              covers: ['landing_page'],  note: 'Landing-page inspiration library with section-level breakdowns.' },
    { name: 'PageDeck',           url: '/competitor-benchmarking.html#landing',               covers: ['landing_page'],  note: 'Internal captured landing-page benchmark deck (competitor pages).' },
    { name: 'Google Ads Transparency Center', url: 'https://adstransparency.google.com',      covers: ['google_ad'],     note: 'Live library of running Google/Search/Shopping/PMax ads by advertiser.' },
    { name: 'Meta Ad Library',    url: 'https://www.facebook.com/ads/library/',               covers: ['meta_ad'],       note: 'All active Facebook/Instagram ads by Page — formats, copy, creative.' },
    { name: 'TikTok Creative Center / Ad Library', url: 'https://ads.tiktok.com/business/creativecenter', covers: ['tiktok_ad'], note: 'Top-performing TikTok ads, trending hooks, sounds and formats.' }
  ];

  // ── Asset types (order = how the /design-intel page lists them) ────────────
  var ASSETS = [
    { key: 'mailer',       label: 'Mailers (Email)' },
    { key: 'landing_page', label: 'Landing Pages' },
    { key: 'google_ad',    label: 'Google Ads' },
    { key: 'meta_ad',      label: 'Meta Ads (FB / IG)' },
    { key: 'tiktok_ad',    label: 'TikTok Ads' }
  ];

  // ── 3-4 design variations per asset type ───────────────────────────────────
  // Each variation: { id, name, bestFor, layout, hook, proof, cta }.
  var DIRECTIVES = {
    mailer: [
      { id: 'single-focus', name: 'Single-Focus Hero', bestFor: 'Product drops, hero launches, cold re-engagement',
        layout: 'One product, one value proposition, generous whitespace, a single hero image; nothing competes with the message.',
        hook: 'Sensory one-line promise tied to the product benefit (no banned phrases).',
        proof: 'One compact proof line under the hero (rating + review count).', cta: 'One high-contrast button, repeated once at the foot.' },
      { id: 'editorial-zigzag', name: 'Editorial Zig-Zag', bestFor: 'Storytelling, education, multi-benefit ranges',
        layout: 'Alternating image/text blocks (left-right-left) that guide the eye down; 2-3 benefit beats.',
        hook: 'Narrative opener ("There is a moment when the right pair...").',
        proof: 'A testimonial-as-story mid-scroll.', cta: 'Section-level buttons per beat, consistent label.' },
      { id: 'hybrid-plaintext', name: 'Hybrid Plain-Text Founder Note', bestFor: 'Trust building, VIP/loyalty, win-back',
        layout: 'Looks like a personal email — minimal styling, standard type, lots of whitespace — with ONE styled CTA.',
        hook: 'First-person founder voice, direct and warm.',
        proof: 'Named signature + subtle credibility line.', cta: 'A single high-contrast link/button; no image grid.' },
      { id: 'bold-typographic', name: 'Bold Typographic Grid', bestFor: 'Editorial roundups, sales moments, dark-mode audiences',
        layout: 'Large type as the hero, minimal imagery, thumb-first spacing, dark-mode-safe colors.',
        hook: 'Punchy typographic statement.',
        proof: 'Inline proof pill within the type block.', cta: 'Big tap-target button (44px+).' }
    ],
    landing_page: [
      { id: 'big-number-hero', name: 'Big-Number Hero', bestFor: 'Strong quantified claim, paid cold traffic',
        layout: 'One giant number as the H1 (the strongest defensible claim), tight sub-copy, sticky CTA.',
        hook: 'The number IS the headline (e.g. reviews count, % benefit).',
        proof: 'Named + quantified proof strip ABOVE the fold.', cta: 'Sticky CTA that follows scroll; above-fold CTA is secondary.' },
      { id: 'problem-solution-presell', name: 'Problem to Solution Presell', bestFor: 'Meta/TikTok cold traffic, presell angle',
        layout: 'Above the fold does four things: name the problem, show the solution, establish credibility, tell them what to do.',
        hook: 'Problem-aware headline matching the ad that sent them.',
        proof: 'Credibility marker in the hero; founder story below.', cta: 'One CTA, repeated where it counts, never a competing offer.' },
      { id: 'social-proof-led', name: 'Social-Proof-Led', bestFor: 'High-consideration, trust-sensitive buyers',
        layout: 'Proof strip above the fold, then benefits with visuals, then FAQ that answers objections.',
        hook: "Concrete named proof, quoted from the brand's OWN approved claims and review library - never an invented rating, review count, certification or endorsement.",
        proof: 'Reviews + press + guarantees clustered high.', cta: 'Sticky CTA; final CTA after FAQ.' },
      { id: 'long-form-story', name: 'Long-Form Story Scroll', bestFor: 'Full-depth storefront pages, high AOV',
        layout: 'Hero+CTA -> proof -> benefit sections with visuals -> founder story -> trust -> FAQ -> final CTA. Full depth, not one screen.',
        hook: 'Emotional hero promise, then earn the scroll.',
        proof: 'Layered proof throughout the scroll.', cta: 'Sticky CTA absorbs placement lift on every section.' }
    ],
    google_ad: [
      { id: 'shopping-merchandising', name: 'Shopping / Merchandising', bestFor: 'Product demand capture (Shopping/PMax feed)',
        layout: 'Creative = the feed: high-quality white-background product image, keyword-rich title (brand + type + attributes + size), accurate price/availability.',
        hook: 'Title front-loads brand + product type + the key attribute.',
        proof: 'Seller rating + promo annotation.', cta: 'Price/offer is the CTA; promotion extension when live.' },
      { id: 'rsa-benefit-stack', name: 'Search RSA Benefit-Stack', bestFor: 'Intent-matched search terms',
        layout: 'Responsive Search Ad: 8-12 headlines mixing benefit + brand + offer + proof; 3-4 descriptions.',
        hook: 'Headline mirrors the exact search intent.',
        proof: 'A headline dedicated to rating/reviews.', cta: 'Action + benefit ("Shop one-of-one kicks").' },
      { id: 'pmax-asset-group', name: 'PMax Asset Group', bestFor: 'Automated reach across Google surfaces',
        layout: 'Mixed assets: hero product + lifestyle + logo, short + long headlines, sitelinks; audience signal from best cohorts.',
        hook: 'Lead asset carries the strongest benefit.',
        proof: 'Lifestyle asset shows the ritual/outcome.', cta: 'Consistent action label across assets.' }
    ],
    meta_ad: [
      { id: 'ugc-problem-hook', name: 'UGC Problem-Hook Video (9-15s)', bestFor: 'Cold prospecting',
        layout: 'Real person, real product, NO brand chrome; problem-aware hook in the first 3s; vertical.',
        hook: 'Relatable problem statement or pattern-interrupt in second 1.',
        proof: 'Authentic demonstration/result.', cta: 'Spoken + on-screen CTA in the last 3s.' },
      { id: 'ugc-transformation', name: 'UGC Transformation Testimonial', bestFor: 'Mid-funnel trust',
        layout: 'Before -> after story arc from a real customer; caption overlay.',
        hook: '"I did not expect..." style curiosity opener.',
        proof: 'The transformation itself + star rating overlay.', cta: 'Soft CTA to learn more / shop.' },
      { id: 'static-benefit-stack', name: 'Single-Image Benefit-Stack Static', bestFor: 'Retargeting (lowest CPM)',
        layout: 'One product image + 3-4 stacked benefit bullets; brand-clean.',
        hook: 'Benefit headline, not brand name.',
        proof: 'Rating pill + review count.', cta: 'Direct "Shop now" with offer if any.' },
      { id: 'urgency-carousel', name: 'Urgency Carousel', bestFor: 'Cart abandonment / cross-sell',
        layout: 'Multi-card carousel: hero product, bestsellers, bundle, offer card.',
        hook: 'Card 1 = the item they viewed / a bundle value.',
        proof: 'Review counts per card.', cta: 'Per-card shop links to real PDPs.' }
    ],
    tiktok_ad: [
      { id: 'three-second-hook', name: '3-Second Hook Native (15-25s)', bestFor: 'Cold TikTok feed',
        layout: 'Visually arresting or bold-claim open in 0-3s; native, vertical, sound-on; 15-25s total.',
        hook: 'Bold claim / question / surprising fact by second 2 (aim 55%+ retention at s3).',
        proof: 'Show the product working, natively.', cta: 'Native on-screen + spoken CTA.' },
      { id: 'problem-desire-answer', name: 'Problem -> Desire -> Answer Arc', bestFor: 'Consideration',
        layout: '0-3s hook, 3-10s the relatable problem/desire, 10-18s the answer (product).',
        hook: 'Curiosity gap that the payoff resolves.',
        proof: 'Demonstrated result before the CTA.', cta: 'Clear next step at the payoff.' },
      { id: 'creator-authentic', name: 'Creator / Authentic UGC', bestFor: 'Trust + virality',
        layout: 'Creator-led, low-production, trend-aware audio; feels native not advertised.',
        hook: 'Creator speaks to camera with a personal angle.',
        proof: 'Genuine reaction / routine.', cta: 'Casual recommendation + link.' },
      { id: 'curiosity-fact', name: 'Surprising-Fact / Curiosity Open', bestFor: 'Education-led products',
        layout: 'Opens on a surprising fact or myth-bust, then teaches, then reveals product.',
        hook: 'Unexpected stat or "most people get this wrong" open.',
        proof: 'The explanation earns credibility.', cta: 'Soft CTA to try/learn.' }
    ]
  };

  // Build a compact directive prompt snippet the generators inject into their
  // system prompt so an asset is produced in the chosen design variation.
  function directivePrompt(assetKey, variationId) {
    var list = DIRECTIVES[assetKey] || [];
    var v = list.filter(function (x) { return x.id === variationId; })[0] || list[0];
    if (!v) return '';
    return [
      'DESIGN VARIATION: ' + v.name + ' (best for: ' + v.bestFor + ').',
      'Layout: ' + v.layout,
      'Hook: ' + v.hook,
      'Proof: ' + v.proof,
      'CTA: ' + v.cta,
      'Keep to the KNICKGASM brand system (palette, fonts, banned phrases, no fabricated facts/prices/reviews).'
    ].join(' ');
  }

  function variationsFor(assetKey) { return (DIRECTIVES[assetKey] || []).slice(); }

  var API = { SOURCES: SOURCES, ASSETS: ASSETS, DIRECTIVES: DIRECTIVES, directivePrompt: directivePrompt, variationsFor: variationsFor, updated: '2026-07-17' };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.__DESIGN_INTEL = API;
})();
