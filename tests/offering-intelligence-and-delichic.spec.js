'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const imp = require('../api/_shared/catalog-import.js');
const intel = require('../api/_shared/offering-intelligence.js');
const plan = require('../api/_shared/smart-brain-plan.js');
const prompt = require('../api/_shared/master-prompt.js');

test.describe('Offering Intelligence & DeliChic Catalog Import', () => {

  test('WordPress / WooCommerce sitemaps for DeliChic are classified as product sitemaps', () => {
    expect(imp.sitemapClass('https://delichic.co.in/wp-sitemap-posts-product-1.xml', false)).toBe('product');
    expect(imp.sitemapClass('https://delichic.co.in/wp-sitemap-posts-product-2.xml', false)).toBe('product');
    expect(imp.sitemapClass('https://delichic.co.in/wp-sitemap-posts-product.xml', false)).toBe('product');
    // Non-product WordPress sitemaps remain non-product
    expect(imp.sitemapClass('https://delichic.co.in/wp-sitemap-posts-page-1.xml', false)).toBe('non-product');
    expect(imp.sitemapClass('https://delichic.co.in/wp-sitemap-taxonomies-product_cat-1.xml', false)).toBe('non-product');
    expect(imp.sitemapClass('https://delichic.co.in/wp-sitemap-taxonomies-product_tag-1.xml', false)).toBe('non-product');
  });

  test('rowFromPage extracts complete unit specifications and claims for DeliChic products', () => {
    const html = `
      <!doctype html>
      <html>
      <head>
        <title>Chicken Curry Cut Antibiotic Residue Free (500gm) - DeliChic</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org/",
          "@type": "Product",
          "name": "Chicken Curry Cut Antibiotic Residue Free (500gm)",
          "sku": "311",
          "description": "Fresh tender chicken curry cut 7-8 pieces. Net weight 500gm. Serves 2-3. Antibiotic residue free and cut fresh daily.",
          "category": "Fresh Poultry",
          "image": ["https://delichic.co.in/wp-content/uploads/2020/10/curry-cut.jpg"],
          "offers": {
            "@type": "Offer",
            "price": "160",
            "priceCurrency": "INR",
            "availability": "https://schema.org/InStock"
          },
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": "4.9",
            "reviewCount": "1240"
          }
        }
        </script>
      </head>
      <body></body>
      </html>
    `;

    const parsed = imp.rowFromPage(html, 'https://delichic.co.in/product/chicken-curry-cut-500gm/', {
      region: 'in',
      source: 'live-test',
    });

    expect(parsed.row).toBeDefined();
    expect(parsed.row.title).toBe('Chicken Curry Cut Antibiotic Residue Free (500gm)');
    expect(parsed.row.price).toBe(160);
    expect(parsed.row.currency).toBe('INR');
    expect(parsed.row.unit_spec).toBe('500g');
    expect(parsed.row.piece_count).toBe('7-8 pieces');
    expect(parsed.row.servings).toBe('Serves 2-3');
    expect(parsed.row.claims).toContain('Antibiotic Residue Free');
    expect(parsed.row.claims).toContain('Cut Fresh Daily');
    expect(parsed.row.metrics.rating).toBe(4.9);
    expect(parsed.row.metrics.reviews_count).toBe(1240);
  });

  test('rowFromPage parses editorial news articles with reading time and reader metrics', () => {
    const html = `
      <!doctype html>
      <html>
      <head>
        <title>Global Semiconductor Landscape: Executive Briefing</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org/",
          "@type": "NewsArticle",
          "headline": "Global Semiconductor Landscape: Executive Briefing",
          "description": "Why chip sovereignty matters for corporate technology strategy.",
          "articleSection": "Technology & Policy",
          "author": { "@type": "Person", "name": "Sarah Connor" },
          "datePublished": "2026-10-20T08:00:00Z",
          "wordCount": 1400,
          "image": ["https://techbrief.example/images/chips.jpg"],
          "interactionStatistic": {
            "@type": "InteractionCounter",
            "interactionType": "https://schema.org/ReadAction",
            "userInteractionCount": 42000
          }
        }
        </script>
      </head>
      <body></body>
      </html>
    `;

    const parsed = imp.rowFromPage(html, 'https://techbrief.example/semiconductor-landscape', {
      region: 'us',
      source: 'live-test',
    });

    expect(parsed.row).toBeDefined();
    expect(parsed.row.offering_kind).toBe('story');
    expect(parsed.row.title).toBe('Global Semiconductor Landscape: Executive Briefing');
    expect(parsed.row.author).toBe('Sarah Connor');
    expect(parsed.row.read_time).toBe('7 min read');
    expect(parsed.row.metrics.views).toBe(42000);
    expect(parsed.row.metrics.read_time).toBe('7 min read');
  });

  test('detectIndustryArchetype identifies brand industry and what they sell', () => {
    const delichicBrand = {
      name: 'Deli Chic',
      website: 'https://delichic.co.in',
      industry: 'Food: chicken and cold cuts',
      claims: ['Antibiotic residue free chicken', 'Cut fresh daily'],
    };
    const meatArchetype = intel.detectIndustryArchetype(delichicBrand, []);
    expect(meatArchetype.id).toBe('d2c_fresh_meat');
    expect(meatArchetype.label).toContain('Fresh Poultry');
    expect(meatArchetype.unitType).toBe('portion_weight');
    expect(meatArchetype.defaultCta).toBe('Order Fresh Cut');

    const newsBrand = {
      name: 'Axios Morning News',
      website: 'https://axios.com',
      industry: 'News, media & editorial journalism',
      tagline: 'Smart brevity daily news briefing',
    };
    const newsArchetype = intel.detectIndustryArchetype(newsBrand, []);
    expect(newsArchetype.id).toBe('news_editorial');
    expect(newsArchetype.unitType).toBe('read_time');
    expect(newsArchetype.defaultCta).toBe('Start Reading');
  });

  test('analyzeCatalogOfferings computes most engaged, bestsellers, and complete specs for DeliChic', () => {
    const catalogFile = path.join(__dirname, '..', 'data', 'catalog', 'products_in.json');
    const allProds = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    const delichicProds = allProds.filter((p) => p.id && p.id.startsWith('delichic-'));

    expect(delichicProds.length).toBeGreaterThanOrEqual(15);

    const delichicBrand = {
      name: 'Deli Chic',
      website: 'https://delichic.co.in',
      industry: 'Food: chicken and cold cuts',
      claims: ['Antibiotic residue free chicken', 'Cut fresh daily'],
      regions: [{ code: 'IN', currency: 'INR', symbol: '₹' }],
    };

    const analysis = intel.analyzeCatalogOfferings(delichicProds, delichicBrand);

    expect(analysis.archetype.id).toBe('d2c_fresh_meat');
    expect(analysis.total_offerings).toBe(delichicProds.length);
    expect(analysis.bestsellers.length).toBeGreaterThan(0);
    expect(analysis.most_engaged).toBeDefined();

    // The #1 product is Chicken Curry Cut (500gm)
    const curryCut = analysis.offerings.find((o) => o.handle === 'chicken-curry-cut-500gm');
    expect(curryCut).toBeDefined();
    expect(curryCut.unit_spec).toBe('500g');
    expect(curryCut.price).toBe(160);
    expect(curryCut.compare_at).toBe(180);
    expect(curryCut.price_display).toContain('₹160 / 500g');
    expect(curryCut.price_display).toContain('Save ₹20');
    expect(curryCut.badge).toContain('Bestseller');
  });

  test('lpHtml showcases price with unit, savings, and badge for DeliChic', () => {
    const entry = {
      market: 'IN',
      brand: {
        name: 'Deli Chic',
        website: 'https://delichic.co.in',
        regions: [{ code: 'IN', currency: 'INR', symbol: '₹', store_url: 'delichic.co.in' }],
      },
      heroProduct: {
        title: 'Chicken Curry Cut Antibiotic Residue Free (500gm)',
        handle: 'chicken-curry-cut-500gm',
        category: 'Fresh Poultry',
        price: 160,
        compare_at: 180,
        unit_spec: '500g',
        piece_count: '7-8 pieces',
        claims: ['Antibiotic Residue Free', 'Cut Fresh Daily'],
        badge: '🔥 #1 Bestseller • Most Ordered Cut',
        metrics: { bestseller: true },
      },
      cta: 'Order Fresh Cut',
    };

    const copy = {
      landing: {
        hero_headline: 'Honest Chicken, Cut Fresh Daily',
        hero_sub: 'Antibiotic residue free tender curry cut delivered to your door.',
        cta: 'Order Fresh Cut',
        why_bullets: [
          '100% Antibiotic residue free certified',
          'Cut fresh to order, never frozen',
          'Delivered in vacuum-sealed hygienic packs',
        ],
      },
    };

    const html = plan.lpHtml(entry, copy, 'test-camp-delichic', 'https://delichic.co.in/wp-content/uploads/2020/10/jdcj.jpg');

    expect(html).toContain('Deli Chic');
    expect(html).toContain('Honest Chicken, Cut Fresh Daily');
    expect(html).toContain('₹160 / 500g');
    expect(html).toContain('11% OFF');
    expect(html).toContain('🔥 #1 Bestseller • Most Ordered Cut');
    expect(html).toContain('Order Fresh Cut');
    expect(html).toContain('delichic.co.in');
  });

});
