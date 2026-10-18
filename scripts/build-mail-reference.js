#!/usr/bin/env node
'use strict';
/**
 * build-mail-reference.js - the REFERENCE set of competitor emails that the
 * mail study falls back to when a brand's own competitors have not been
 * captured yet (competitor-mail-study.js, `basis: 'reference'`).
 *
 * Reads each email from Really Good Emails (a public archive of real sent
 * emails, robots.txt allows /emails/), renders it in Chromium at 640px with its
 * pictures, and measures it with the SAME function the study uses on captured
 * mail (`measureInPage`). Only the measurements, the subject, the sender and the
 * URL it was read from are written: never a competitor's HTML, copy or picture.
 *
 * Run (needs network + Chromium):
 *   node scripts/build-mail-reference.js            # writes data/benchmarks/mail-reference.json
 *   node scripts/build-mail-reference.js --dry      # prints, writes nothing
 */
const fs = require('fs');
const path = require('path');
const study = require('../api/_shared/competitor-mail-study.js');

// [slug, category]. Chosen per category from the archive's own sitemap
// (sitemap-emails-*.xml) by the words of the slug; transactional mail (confirm
// your address, password resets), pharmacy and media-streaming mail left out.
const SET = [
  ['our-most-technical-apparel-for-all-terrains', 'apparel'], ['the-corkshell-summit-jacket', 'apparel'],
  ['trending-winter-dresses-up-to-90-off-est-retail', 'apparel'], ['stylist-picks-mood-boosting-sweaters', 'apparel'],
  ['culture-back-favorites-winback', 'apparel'],
  ['closing-today-atoms-mkbhd-sneaker', 'footwear'], ['veja-sustainable-running-shoes', 'footwear'],
  ['running-low-on-nuggs', 'footwear'], ['running-low-on-light-beams-heres-your-chance-to-snag-one-for-free', 'footwear'],
  ['looking-for-great-running-shoes', 'footwear'], ['we-build-shoes-for-the-way-you-run', 'footwear'],
  ['how-to-find-the-perfect-pair-of-boots', 'footwear'],
  ['the-1-skincare-product-for-your-30s', 'beauty'], ['back-to-school-25-off-skincare', 'beauty'],
  ['skincare-that-is-personal', 'beauty'], ['makeup-artist-approved', 'beauty'],
  ['embrace-the-wave-of-beauty-mendocino-bladderwrack-seaweeds-skin-benefits', 'beauty'], ['skincare-descontos', 'beauty'],
  ['calling-all-skin-health-experts-we-need-you', 'beauty'], ['pre-post-workout-skincare', 'beauty'],
  ['not-like-other-chocolates', 'food'], ['tea-seed-oil-is-asias-best-kept-secret', 'food'],
  ['kickstart-your-blendtec-journey-with-3-recipes', 'food'], ['6-free-gifts-you-have-got-to-try-these-chocolate-almond-bars', 'food'],
  ['welcome-to-trade-coffee', 'food'], ['if-coffee-is-their-love-language', 'food'], ['stumptown-coffee-roasters-sunrider', 'food'],
  ['welcome-the-cq-weekly-digest', 'news'], ['your-july-tonal-newsletter-is-here', 'news'],
  ['neighborhood-newsletter-october-updates', 'news'], ['welcome-to-our-newsletter-heres-some-goodies-to-start', 'news'],
  ['welcome-back-to-alala', 'winback'], ['dont-miss-your-chance-to-save-big-during-our-black-friday-in-july-sale', 'winback'],
  ['come-back-and-take-another-look', 'winback'], ['dont-miss-your-free-trial', 'winback'], ['dont-miss-your-birthday-gift', 'winback'],
  ['etsy-missing-winback', 'winback'], ['welcome-back-heres-a-treat-just-for-you', 'winback'],
  ['introducing-meta-glasses-by-lisa', 'eyewear'], ['even-realities-smart-glasses-technology', 'eyewear'],
  ['bloobloom-handcrafted-eyewear', 'eyewear'], ['even-realities-smart-glasses-daily-wear', 'eyewear'],
  ['sunglass-hut-sunglasshut-discount-sale', 'eyewear'], ['oakley-metai-glasses-turn-1', 'eyewear'],
  ['introducing-the-new-meta-glasses', 'eyewear'], ['ray-ban-gen-2-meta-glasses-preorder-limited-time', 'eyewear'],
  ['20-off-your-next-sunglasses-ends-today', 'eyewear'], ['bestselling-sunglasses-on-sale-now-for-black-friday', 'eyewear'],
  ['need-new-glasses-weve-got-you', 'eyewear'], ['frames-that-transcend-time', 'eyewear'], ['new-frames-just-dropped', 'eyewear'],
  ['glasses-are-a-canvas', 'eyewear'], ['final-weekend-to-get-20-off-all-sunglasses', 'eyewear'],
  ['sunglasses-to-your-specifications', 'eyewear'], ['a-deeper-look-at-our-latest-eyewear', 'eyewear'], ['ray-ban-birthday-reward', 'eyewear'],
];
// The words a brand's own record must carry to be matched to a category.
const CATEGORY_WORDS = {
  eyewear: ['eyewear', 'eyeglasses', 'glasses', 'sunglasses', 'spectacles', 'optical', 'lenses', 'frames', 'optician'],
  apparel: ['apparel', 'clothing', 'fashion', 'garments', 'dresses', 'modest wear', 'activewear'],
  footwear: ['footwear', 'shoes', 'sneakers', 'trainers', 'boots', 'running'],
  beauty: ['beauty', 'skincare', 'skin', 'cosmetics', 'makeup', 'personal care', 'haircare'],
  food: ['food', 'coffee', 'tea', 'snacks', 'chocolate', 'grocery', 'beverage', 'drinks', 'kitchen', 'meat', 'bakery'],
  news: ['news', 'publishing', 'publisher', 'newsletter', 'media', 'magazine', 'journalism'],
  winback: [],
};
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36';

async function emailOf(slug) {
  const url = `https://reallygoodemails.com/emails/${slug}`;
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`${r.status}`);
  const s = await r.text();
  // The page carries the email's HTML as a JSON string inside its own data.
  let best = '';
  const re = /\\u003c(?:!DOCTYPE|html)/gi; let m;
  while ((m = re.exec(s))) {
    const end = s.indexOf('\\u003c/html\\u003e', m.index);
    if (end < 0) continue;
    try { const h = JSON.parse('"' + s.slice(m.index, end + '\\u003c/html\\u003e'.length) + '"'); if (h.length > best.length) best = h; } catch (_) { /* next */ }
  }
  const t = (/<title>([^<]*)/.exec(s) || [])[1] || '';
  const mm = /^(.*) from (.*?) - (?:Desktop|Mobile) Email View/.exec(t.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, '\''));
  return { url, html: best, subject: mm ? mm[1].trim() : '', brand: mm ? mm[2].trim() : '' };
}

(async () => {
  const dry = process.argv.includes('--dry');
  const { chromium } = require('playwright');
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const out = [];
  const queue = SET.slice();
  await Promise.all([0, 1, 2, 3].map(async () => {
    const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [slug, category] = job;
      try {
        const e = await emailOf(slug);
        if (!e.html) { console.log('no html', slug); continue; }
        await page.setContent(e.html, { waitUntil: 'load', timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const measured = await page.evaluate(study.measureInPage, { subject: e.subject });
        out.push({ slug, brand: e.brand, category, categories: CATEGORY_WORDS[category] || [], url: e.url, subject: e.subject, measured });
        console.log(category.padEnd(8), e.brand);
      } catch (err) { console.log('skip', slug, err.message); }
    }
    await page.close();
  }));
  await browser.close();
  out.sort((a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug));
  const doc = {
    source: 'Really Good Emails (reallygoodemails.com), a public archive of real sent marketing emails',
    method: 'Each email rendered in Chromium at 640px with its pictures and measured by competitor-mail-study.measureInPage.',
    read_at: new Date().toISOString().slice(0, 10),
    patterns: study.patterns(out.map((e) => e.measured)),
    emails: out,
  };
  if (dry) { console.log(JSON.stringify(doc.patterns, null, 1)); return; }
  const file = path.join(__dirname, '..', 'data', 'benchmarks', 'mail-reference.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 1) + '\n');
  console.log(`wrote ${out.length} emails to ${path.relative(process.cwd(), file)}`);
})().catch((e) => { console.error(e); process.exit(1); });
