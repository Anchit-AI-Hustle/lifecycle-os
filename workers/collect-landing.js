#!/usr/bin/env node
'use strict';

/**
 * Landing-page collector — renders competitor landing pages with a real browser,
 * captures full HTML + DOM snapshot + desktop & mobile screenshots, parses the
 * conversion-relevant content (pricing, bundles, subscription, reviews, FAQ,
 * trust elements, checkout links), and persists via ci-collect.collectLanding
 * (dedup + version history + change-diffs handled DB-side).
 *
 * Screenshots are uploaded to the Supabase Storage bucket "ci-captures" (create
 * it once, public). Like the other workers it writes straight to Supabase with
 * a service-role key from .env.local.
 *
 * URL SOURCES (in order):
 *   1. URLS="https://a,https://b"     explicit list
 *   2. otherwise: landing_url values already discovered on ci_ads that don't yet
 *      have a ci_landing_pages capture.
 *
 * SAFETY: only navigates to the landing URL itself; never clicks through to
 * checkout or follows email links (the brief's "never click links" rule). It
 * reads checkout-link hrefs from the DOM without visiting them.
 *
 * USAGE:
 *   npm run collect:landing
 *   URLS="https://brand.com/pages/sale" npm run collect:landing
 *   MAX=20 HEADFUL=1 npm run collect:landing
 */

require('./_env')();
const { chromium, devices } = require('@playwright/test');
const ciCollect = require('../api/_shared/ci-collect');
const supa = require('../api/_shared/supa');

const MAX = Number(process.env.MAX || 25);
const BUCKET = process.env.CI_BUCKET || 'ci-captures';

// In-page parser: extract conversion-relevant content with resilient heuristics.
function parsePage() {
  const txt = (el) => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const priceRe = /(?:[$£€₹])\s?\d[\d,]*(?:\.\d{2})?/g;
  const bodyText = document.body ? document.body.innerText : '';

  const prices = Array.from(new Set((bodyText.match(priceRe) || []).slice(0, 30)));
  const headline = txt(document.querySelector('h1')) || document.title;
  const subhead = txt(document.querySelector('h2'));
  const cta = (all('a,button')
    .map(txt)
    .find(t => /shop|buy|add to (cart|bag)|get|order|subscribe|start/i.test(t)) || '').slice(0, 60);

  const bundles = all('*').map(txt).filter(t => /\b(bundle|kit|set|trio|duo|sampler|collection|combo)\b/i.test(t) && t.length < 80).slice(0, 10);
  const subscription = /\b(subscribe\s*&?\s*save|subscription|auto[-\s]?ship|recurring)\b/i.test(bodyText);
  const reviewCount = (bodyText.match(/\b(\d[\d,]*)\s+reviews?\b/i) || [])[1] || null;
  const rating = (bodyText.match(/\b([0-5](?:\.\d)?)\s*(?:out of 5|stars?|★)/i) || [])[1] || null;

  const faqEls = all('[class*="faq" i],[id*="faq" i],details summary').map(txt).filter(Boolean).slice(0, 15);
  const trust = all('*').map(txt).filter(t => /\b(money[-\s]?back|guarantee|free returns|secure checkout|as seen in|certified|organic|cruelty[-\s]?free|carbon neutral)\b/i.test(t) && t.length < 80);
  const trustSignals = Array.from(new Set(trust)).slice(0, 12);
  const checkoutLinks = Array.from(new Set(all('a[href]')
    .map(a => a.getAttribute('href'))
    .filter(h => h && /(cart|checkout|\/products\/|add)/i.test(h)))).slice(0, 20);

  const offerText = (bodyText.match(/(\d{1,2}\s*%\s*off|free\s+(gift|shipping)|save\s+(?:[$£€₹])?\d+|buy\s+one\s+get\s+one|bogo|subscribe\s*&?\s*save)/i) || [])[0] || null;

  return {
    headline, subhead, cta,
    pricing: prices, bundles: Array.from(new Set(bundles)),
    subscription, reviews: { count: reviewCount, rating },
    faq: Array.from(new Set(faqEls)), trust: trustSignals,
    checkout_links: checkoutLinks, offer: offerText
  };
}

async function pendingUrls() {
  if (process.env.URLS) return process.env.URLS.split(',').map(s => s.trim()).filter(Boolean).slice(0, MAX);
  const ads = await supa.select('ci_ads', { filters: { landing_url: 'not.is.null' }, order: 'last_seen.desc', limit: 300 });
  const seen = new Set();
  const urls = [];
  for (const a of ads) {
    const u = ciCollect.canonicalUrl(a.landing_url);
    if (seen.has(u)) continue; seen.add(u);
    const existing = await supa.select('ci_landing_pages', { filters: { url_hash: `eq.${supa.sha1(u)}` }, limit: 1 });
    if (!existing.length) urls.push(u);
    if (urls.length >= MAX) break;
  }
  return urls;
}

async function uploadShot(buf, urlHash, variant) {
  const hash = supa.sha1(buf.toString('base64').slice(0, 256) + variant);
  const { path, public_url } = await supa.uploadObject(BUCKET, `landing/${urlHash}/${variant}.png`, buf, 'image/png');
  return { hash, path, public_url };
}

(async () => {
  const urls = await pendingUrls();
  if (!urls.length) { console.log('[landing] nothing to capture.'); return; }
  console.log(`[landing] capturing ${urls.length} page(s)`);

  const browser = await chromium.launch({ headless: !process.env.HEADFUL });
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const mobile = await browser.newContext({ ...devices['iPhone 13'] });

  for (const url of urls) {
    const urlHash = supa.sha1(url);
    try {
      const dPage = await desktop.newPage();
      await dPage.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => dPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }));
      await dPage.waitForTimeout(1500);
      const parsed = await dPage.evaluate(parsePage);
      const raw_html = await dPage.content();
      const dom_snapshot = await dPage.evaluate(() => document.documentElement.outerHTML).catch(() => raw_html);
      const dShot = await dPage.screenshot({ fullPage: true });
      await dPage.close();

      const mPage = await mobile.newPage();
      await mPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await mPage.waitForTimeout(1000);
      const mShot = await mPage.screenshot({ fullPage: true });
      await mPage.close();

      // Persist the landing page first (dedup decides if it's new/changed).
      const res = await ciCollect.collectLanding({ source: 'direct', url, raw_html, dom_snapshot, parsed });

      // Upload + link screenshots only when we actually stored/changed a row.
      if (res.status !== 'seen') {
        try {
          const dUp = await uploadShot(dShot, urlHash, 'desktop');
          const mUp = await uploadShot(mShot, urlHash, 'mobile');
          const [dRow] = await supa.insert('ci_screenshots', [{ asset_type: 'landing', asset_id: res.id, variant: 'desktop', storage_path: dUp.path, public_url: dUp.public_url, content_hash: dUp.hash }]);
          const [mRow] = await supa.insert('ci_screenshots', [{ asset_type: 'landing', asset_id: res.id, variant: 'mobile', storage_path: mUp.path, public_url: mUp.public_url, content_hash: mUp.hash }]);
          await supa.update('ci_landing_pages', { desktop_shot_id: dRow?.id || null, mobile_shot_id: mRow?.id || null }, { id: `eq.${res.id}` });
        } catch (e) { console.warn(`    (screenshot upload skipped: ${e.message})`); }
      }
      console.log(`  ✓ ${url} → ${res.status}${res.changed?.length ? ' [' + res.changed.join(',') + ']' : ''}`);
    } catch (e) {
      console.warn(`  ✗ ${url}: ${e.message}`);
    }
  }
  await browser.close();
  console.log('[landing] done.');
})().catch(e => { console.error('[landing] fatal:', e); process.exit(1); });
