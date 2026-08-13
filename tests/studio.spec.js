// KNICKGASM Mailer Studio — visual + invariant tests across six viewports.
// Generates a screenshot of every step at every viewport and asserts the
// critical layout invariants that previously regressed.
const { test, expect } = require('@playwright/test');
const path = require('path');

// All tests share this URL — it's set in playwright.config.js
const URL = process.env.TARGET_URL || 'file://' + path.resolve(__dirname, '..', 'lifecycle_mailer_architect_v34.html');

// Skip auth modal: many SPAs gate behind sign-in. Studio uses an authOverlay.
// We bypass it by setting localStorage before the first navigation.
async function bypassAuth(page) {
  // Two strategies:
  // 1) Set localStorage before first load (works in Chromium under file://).
  // 2) Override the auth-show function as soon as it exists. WebKit + file://
  //    sometimes blocks localStorage, so we also patch the runtime.
  await page.addInitScript(() => {
    try {
      const u = { name: 'Test', email: 'test@knickgasm.com', signedInAt: Date.now() };
      localStorage.setItem('vhd_users', JSON.stringify([u]));
      localStorage.setItem('vhd_session', JSON.stringify(u));
    } catch (_) {}
    // Force the auth overlay closed on every paint until DOM is ready.
    Object.defineProperty(window, '_currentUser', {
      value: { name: 'Test', email: 'test@knickgasm.com' }, writable: true, configurable: true
    });
    const hideAuth = () => {
      const ov = document.getElementById('authOverlay');
      if (ov) { ov.style.display = 'none'; ov.style.visibility = 'hidden'; }
    };
    document.addEventListener('readystatechange', hideAuth);
    document.addEventListener('DOMContentLoaded', hideAuth);
    setInterval(hideAuth, 200);  // belt-and-suspenders
  });
}

// The Studio no longer compiles a product catalogue into the page: it resolves
// the ACTIVE workspace's own catalogue through BrandCatalog at runtime, because
// the array that used to sit in the file was another company's. Under file://
// there is no workspace to resolve, so these tests seed a fixture and assert
// the RENDERER, which is what they were always about. The fixture is obviously
// synthetic and is never a real brand's catalogue.
const CATALOG_FIXTURE = [
  { n: 'Test Hero Pair, Black', i: '', t: ['bestseller'], h: 'test-hero-pair-black', price: '129.00', type: 'Sneakers', subtitle: 'Fixture product' },
  { n: 'Test Second Pair, White', i: '', t: ['bestseller'], h: 'test-second-pair-white', price: '119.00', type: 'Sneakers', subtitle: 'Fixture product' },
  { n: 'Test Gift Set', i: '', t: ['gift'], h: 'test-gift-set', price: '199.00', type: 'Gift Sets', subtitle: 'Fixture product' },
  { n: 'Test Sampler, Five', i: '', t: ['sampler'], h: 'test-sampler-five', price: '89.00', type: 'Samplers', subtitle: 'Fixture product' },
  { n: 'Test Premium Pair', i: '', t: ['premium'], h: 'test-premium-pair', price: '249.00', type: 'Sneakers', subtitle: 'Fixture product' },
];

async function seedCatalog(page) {
  // Wait for the real lookup to settle first. Seeding before it resolves would
  // be overwritten by its (empty, offline) answer, and the test would then be
  // asserting against a page with no products without saying so.
  await page.evaluate(() => (window.studioCatalogReady ? window.studioCatalogReady() : null));
  await page.evaluate((rows) => window.setStudioCatalog(rows, 'brand', ''), CATALOG_FIXTURE);
  await page.waitForFunction(() => (window.CAT || []).length > 0, null, { timeout: 5000 });
}

test.describe('Mailer Studio — responsive smoke', () => {
  test.beforeEach(async ({ page }) => {
    await bypassAuth(page);
    await page.goto(URL);
    // Force-dismiss auth in case the overlay is still showing (defense in depth)
    await page.evaluate(() => {
      const ov = document.getElementById('authOverlay');
      if (ov) ov.style.display = 'none';
      // Make sure window._currentUser is set so any auth-gated UI proceeds
      window._currentUser = { name: 'Test', email: 'test@knickgasm.com' };
      // Show Step 1 explicitly in case showOnly hasn't run yet
      const p1 = document.getElementById('p1');
      if (p1) p1.style.display = '';
    });
    await expect(page.locator('#promptIn')).toBeVisible({ timeout: 10_000 });
    await seedCatalog(page);
  });

  test('Step 1 — fields present and visible', async ({ page }, testInfo) => {
    await expect(page.locator('#promptIn')).toBeVisible();
    await expect(page.locator('#audienceIn')).toBeVisible();
    await expect(page.locator('#mktChips')).toBeVisible();
    await expect(page.locator('#typeChips')).toBeVisible();
    try { await page.screenshot({ path: `tests/screenshots/${testInfo.project.name}-step1.png`, fullPage: false, timeout: 5000 }); } catch (_) { /* screenshot is debug-only */ }
  });

  test('Sticky step nav sits below the global header (z-index)', async ({ page }, testInfo) => {
    // Functional check that doesn't depend on full Step 4 flow:
    // verify the sticky CSS positioning is correct.
    const result = await page.evaluate(() => {
      const stickyDivs = Array.from(document.querySelectorAll('div[style*="position:sticky"]'));
      const stepNavs = stickyDivs.filter(d =>
        d.textContent && d.textContent.includes('Back') && d.closest('#p4, #p5')
      );
      return stepNavs.map(d => ({
        top: d.style.top,
        zIndex: d.style.zIndex,
        parentId: d.closest('#p4, #p5')?.id || ''
      }));
    });
    // Both Step 4 and Step 5 nav bars must be defined
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const nav of result) {
      // Must NOT pin to top:0 — that collides with the global app-hdr
      expect(nav.top).not.toBe('0px');
      expect(nav.top).not.toBe('0');
      // z-index lower than app-hdr's 300 is fine, but must be set
      expect(parseInt(nav.zIndex, 10)).toBeGreaterThan(0);
    }
    try { await page.screenshot({ path: `tests/screenshots/${testInfo.project.name}-step1-overview.png`, fullPage: false, timeout: 5000 }); } catch (_) { /* screenshot is debug-only */ }
  });

  test('Selected Products strip stays horizontal — no vertical wrap', async ({ page }, testInfo) => {
    await page.fill('#promptIn', 'Premium gift sets for the holiday season with bundle savings');
    await page.evaluate(() => window.go2 && window.go2());
    await page.waitForTimeout(800);
    const strip = page.locator('#selectedProdsStrip');
    if (await strip.isVisible().catch(() => false)) {
      // The grid container must use flex/horizontal scroll
      const display = await page.locator('#selProdsGrid').evaluate(e => getComputedStyle(e).display);
      expect(display).toBe('flex');
      const overflow = await page.locator('#selProdsGrid').evaluate(e => getComputedStyle(e).overflowX);
      expect(['auto', 'scroll']).toContain(overflow);
    }
    try { await page.screenshot({ path: `tests/screenshots/${testInfo.project.name}-step2-strip.png`, fullPage: false, timeout: 5000 }); } catch (_) { /* screenshot is debug-only */ }
  });

  test('Mailer creative renders without off-brand hex', async ({ page }, testInfo) => {
    await page.fill('#promptIn', '20% off bestsellers — bold, conversion-focused');
    await page.evaluate(() => window.go2 && window.go2());
    await page.waitForTimeout(400);
    const html = await page.evaluate(() => {
      // Build both variants and concatenate
      try {
        const a = window.buildEmail ? window.buildEmail(null, 'US') : '';
        const b = window.buildEmailVariantB ? window.buildEmailVariantB(null, 'US') : '';
        return (a || '') + (b || '');
      } catch (e) { return ''; }
    });
    // No off-palette hex codes
    const offPalette = ['#0f2a1c', '#d4873a', '#fdf6e8', '#1a3a28', '#1a1a1a', '#faf8f4'];
    for (const hex of offPalette) {
      expect(html.toLowerCase().includes(hex)).toBeFalsy();
    }
    // Brand fonts declared
    expect(html).toContain('Montserrat');
    expect(html).toContain('Instrument Sans');
    // Both variants returned actual HTML
    expect(html.length).toBeGreaterThan(4000);
  });

  test('Sanity gate blocks Final Output when validation fails', async ({ page }) => {
    await page.fill('#promptIn', 'Test brief for sanity gate');
    await page.evaluate(() => window.go2 && window.go2());
    await page.waitForTimeout(300);
    // Force a validation failure by clearing products
    await page.evaluate(() => { window.S.finalProds = []; window.S.manualProds = []; window.S._strategyCacheKey = null; });
    const result = await page.evaluate(() => window.validateMailerCreative && window.validateMailerCreative());
    expect(result).toBeTruthy();
    expect(result.ok).toBeFalsy();
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('Market currency and store domain propagate; no reviewer is invented', async ({ page }) => {
    // This test used to assert the OPPOSITE of its second half: that a US mailer
    // contained a US reviewer city, a UK mailer a UK one, and so on. That was
    // testing a fabrication. The Studio generated reviewer names and hometowns
    // from a per-market table and printed them as verified buyers, which the
    // operating contract forbids outright ("never invent reviewers"). The flag
    // that suppressed them defaulted to OFF, so it happened on every build.
    //
    // What is still worth protecting is the real bug this test was written for
    // (₹ prices in a US mailer) plus the new invariant: no reviewer identity at
    // all, in any market.
    const REVIEWER_SURNAMES = /\b(?:Sarah M|Charlotte W|Priya S|Emma L|Marie L|Thomas B|Anna S|Julian P)\b/;
    const REVIEWER_CITIES = /\b(?:Mumbai|Bangalore|Kolkata|Edinburgh|Amsterdam|Stockholm)\b/;
    const cases = [
      { mkt: 'US', currency: '$', badCurrency: '₹', goodHost: 'knickgasm.com', badHost: /knickgasmindia\.com/ },
      { mkt: 'UK', currency: '£', badCurrency: '₹', goodHost: 'knickgasm.com', badHost: /knickgasmindia\.com/ },
      { mkt: 'IN', currency: '₹', badCurrency: '$', goodHost: 'knickgasm.com', badHost: /uk\.knickgasm\.com/ },
    ];
    await page.fill('#promptIn', '15% off bestsellers — code SAVE15 — free shipping');
    await page.evaluate(() => window.go2 && window.go2());
    await page.waitForTimeout(400);
    for (const c of cases) {
      const html = await page.evaluate((mkt) => {
        try {
          const a = window.buildEmail(null, mkt) || '';
          const b = window.buildEmailVariantB(null, mkt) || '';
          return a + '\n---SPLIT---\n' + b;
        } catch (e) { return ''; }
      }, c.mkt);
      // Currency present, off-currency absent.
      expect(html, `${c.mkt}: missing ${c.currency}`).toContain(c.currency);
      // Store domain matches market.
      expect(html, `${c.mkt}: missing ${c.goodHost}`).toContain(c.goodHost);
      expect(html.match(c.badHost), `${c.mkt}: leaked ${c.badHost}`).toBeFalsy();
      // No invented reviewer identity, in any market.
      expect(html.match(REVIEWER_SURNAMES), `${c.mkt}: an invented reviewer name is in the mailer`).toBeFalsy();
      expect(html.match(REVIEWER_CITIES), `${c.mkt}: an invented reviewer hometown is in the mailer`).toBeFalsy();
      // No invented star rating, in any market.
      expect(html.match(/\b4\.8\b/), `${c.mkt}: an invented rating is in the mailer`).toBeFalsy();
      // KNICKGASM wordmark must appear as text (footer + header) so it's never invisible
      expect((html.match(/KNICKGASM/g) || []).length, `${c.mkt}: KNICKGASM wordmark not visible`).toBeGreaterThanOrEqual(2);
    }
  });

  test('Market detector ignores "Indian" (brand-of-origin) and respects $ prices', async ({ page }) => {
    // Real bug from a real brief: "KNICKGASM sneaker customers... one-of-one sneakers...
    // $29.99... $34.99... 14% off... REVIVE15... $49... Indian spices... Turbulence Sneaker"
    // → must select US, NEVER IN. "Indian" describes the PRODUCT, not the market.
    const cases = [
      {
        label: 'US-priced brief mentioning Indian-origin products',
        brief: 'KNICKGASM sneaker customers at AOV of $55+. 15% discount on best-selling sneakers. Hero: $29.99 Turbulence Sneaker (compare_at $34.99). Promo code REVIVE15. Free shipping on orders over $49. Showcase Indian spices, one-of-one Indian sneakers, Indian heritage of every colorway.',
        expectIncludes: ['US'],
        expectExcludes: ['IN', 'UK', 'EU'],
      },
      {
        label: 'UK brief in £',
        brief: 'Sale for UK customers. £24.99 kicks. Free shipping over £35. London-based audience.',
        expectIncludes: ['UK'],
        expectExcludes: ['IN', 'US'],
      },
      {
        label: 'India brief explicitly targeting India market',
        brief: 'In the Indian market, ₹699 kicks. Free shipping over ₹999 in Mumbai and Delhi.',
        expectIncludes: ['IN'],
        expectExcludes: ['US', 'UK'],
      },
      {
        label: 'A passing mention of London does NOT add UK to a US brief',
        brief: '20% off bestsellers for the US market. $29.99 kicks. (One reviewer is from London.)',
        expectIncludes: ['US'],
        expectExcludes: ['UK', 'IN'],
      },
    ];
    for (const c of cases) {
      const result = await page.evaluate((brief) => {
        return window._detectMarketsFromPrompt && window._detectMarketsFromPrompt(brief);
      }, c.brief);
      expect(result, `${c.label}: detector returned nothing`).toBeTruthy();
      for (const m of c.expectIncludes) {
        expect(result, `${c.label}: missing ${m}`).toContain(m);
      }
      for (const m of c.expectExcludes) {
        expect(result, `${c.label}: should NOT include ${m}`).not.toContain(m);
      }
    }
  });

  test('Variant A and Variant B differ structurally', async ({ page }) => {
    await page.fill('#promptIn', 'Bestselling premium kicks for daily ritual lovers');
    await page.evaluate(() => window.go2 && window.go2());
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      try {
        const a = window.buildEmail(null, 'US');
        const b = window.buildEmailVariantB(null, 'US');
        const archA = (a.match(/archetype:([\w-]+)/) || [])[1];
        const archB = (b.match(/archetype:([\w-]+)/) || [])[1];
        return { archA, archB, lenA: a.length, lenB: b.length };
      } catch (e) { return { error: e.message }; }
    });
    expect(result.archA).toBeTruthy();
    expect(result.archB).toBeTruthy();
    expect(result.archA).not.toEqual(result.archB);  // structural divergence
  });
});
