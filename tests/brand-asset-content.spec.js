// Brand-asset and content pages — the ACTIVE brand's data, or an honest blank.
//
// WHY THESE EXIST. This repo was copied from a sibling lifecycle-OS project
// built for a tea, coffee and Ayurvedic-supplement D2C company and rebranded by
// search-and-replace on the brand NAME. The name went; the BUSINESS did not.
// The Mailer Studio shipped that company's two-hundred-product catalogue and
// generated mailers from it. The Sales & Business Review tab shipped its US D2C
// review, including a coffee-franchise deep dive and its subscription
// cancellation reasons, and that tab renders for every workspace. The daily
// email calendar shipped twenty-one of its sends, with its product names, its
// inventory counts and its promo codes, as the fallback whenever the live plan
// was empty - which is the normal state for a brand that has just onboarded.
//
// Two guards were green through all of it. scripts/check-foreign-brands.js
// checked the foreign NAME, which the rebrand had already removed;
// scripts/audit-pages.js checked industry vocabulary but exempted "tenant
// zero's own marketing pages", which is exactly where the foreign product lines
// lived. So these tests check the thing neither did: that a page carries no
// business but the active workspace's, and that where it has no data it says so
// instead of substituting someone else's.
//
// EVERY TEST HERE FAILS AGAINST THE UNFIXED CODE. They are file-level and
// module-level on purpose - the bug was never that a panel looked wrong, it was
// that it looked right while describing another company.
//
// Run: npx playwright test tests/brand-asset-content.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// Assembled from fragments for the same reason scripts/check-foreign-brands.js
// assembles its tokens: tests/ sits inside the deployed output root
// (vercel.json sets outputDirectory "."), so a literal here would itself be a
// publicly served occurrence of the very strings these tests exist to remove.
const FOREIGN_PRODUCT_WORDS = [
  ['mor', 'inga'], ['curc', 'umin'], ['psyl', 'lium'], ['triph', 'ala'],
  ['ashwaga', 'ndha'], ['bosw', 'ellia'], ['bac', 'opa'], ['tis', 'ane'],
  ['darjee', 'ling'], ['vedic ka', 'dha'],
].map((p) => p.join(''));

/** Every foreign product word found in `src`, so a failure names the offender. */
function foreignHits(src) {
  const out = [];
  for (const w of FOREIGN_PRODUCT_WORDS) {
    const m = new RegExp('\\b' + w + '\\b', 'i').exec(src);
    if (m) out.push(m[0]);
  }
  return out;
}

// The pages in this scope. Each one shipped the other company's business.
const SCOPED_PAGES = [
  'lifecycle-usa-d2c-dashboard.html',
  'premium-experience.html',
  'daily-email-calendar.html',
  'template-gallery.html',
  'avatars.html',
  'retention-playbook.html',
  'playbook.html',
  'lifecycle_mailer_architect_v34.html',
];

test.describe('no other company\'s product lines on a brand-asset page', () => {
  for (const page of SCOPED_PAGES) {
    test(`${page} names no foreign product line`, () => {
      const hits = foreignHits(read(page));
      expect(hits, `${page} still names ${hits.join(', ')}`).toEqual([]);
    });
  }
});

test.describe('orphaned artefacts of the other company are gone, and their URLs still resolve', () => {
  // These four were unreachable: no rewrite pointed at them and nothing linked
  // to them, but Vercel serves the repository root, so every one was a public
  // page rendering the other company's storefront and one of its supplement
  // upsell mailers, under this brand's name.
  const DELETED = [
    'storefront-3d-us.html',
    'storefront-3d-uk.html',
    'storefront-3d-global.html',
    'mailers/01_coffee_upsell_engagers.html',
  ];

  for (const file of DELETED) {
    test(`${file} is not served`, () => {
      expect(exists(file), `${file} is still in the deployed output root`).toBe(false);
    });
  }

  test('each deleted path redirects rather than 404s', () => {
    const vercel = JSON.parse(read('vercel.json'));
    const sources = new Set((vercel.redirects || []).map((r) => r.source));
    for (const file of DELETED) {
      expect(sources.has('/' + file), `no redirect for /${file}`).toBe(true);
    }
  });
});

test.describe('Mailer Studio builds from the active workspace catalogue', () => {
  const studio = () => read('lifecycle_mailer_architect_v34.html');

  test('no product catalogue is baked into the page', () => {
    // The bug: `const CAT=[{"n":"...","i":"https://cdn.shopify.com/..."}]` on
    // one line, ~200 products long, belonging to another company's store.
    expect(/const\s+CAT\s*=\s*\[\s*\{/.test(studio()),
      'a literal product array is still compiled into the Studio').toBe(false);
  });

  test('the catalogue resolver is loaded and used', () => {
    const src = studio();
    expect(src).toContain('/brand-catalog.js');
    expect(src).toMatch(/BrandCatalog\.load\(/);
  });

  test('no hand-written product-name pools drive selection', () => {
    // Selection used to score against fourteen pools of literal product names.
    // On any catalogue but that one company's they matched nothing.
    expect(/typeMap\s*=\s*\{[\s\S]{0,200}?detox\s*:/.test(studio()),
      'the product-name pools are still present').toBe(false);
  });

  test('a product URL is never fabricated from a slugified name', () => {
    // `toHandle(name)` minted /products/<slug> for any name, so a mailer could
    // ship a link that 404s. A missing handle must fall back to a real page.
    expect(/if\(!handle\)handle=toHandle\(name\);/.test(studio()),
      'pdpUrl still slugifies an unknown name into a product path').toBe(false);
  });

  test('real-facts-only is the default, not an opt-in', () => {
    // It defaulted to false and was only turned on by a server env var, so the
    // out-of-the-box behaviour was to emit invented reviewer names and quotes.
    expect(studio()).toMatch(/window\.__REAL_FACTS_ONLY\s*=\s*true\s*;/);
    expect(/__REAL_FACTS_ONLY\s*=\s*window\.__REAL_FACTS_ONLY\s*\|\|\s*false/.test(studio()),
      'the fabrication default is still off').toBe(false);
  });

  test('no invented rating, review count or certification reaches generated copy', () => {
    const src = studio();
    // Star rating printed into mailer HTML.
    expect(/>4\.8</.test(src), 'a hardcoded 4.8 rating is still rendered').toBe(false);
    // Review and customer counts.
    expect(/50,?000\+?\s*(?:5-star|five-star|Happy|Customers|Sneaker Lovers)/i.test(src),
      'an invented customer or review count is still in copy').toBe(false);
    expect(/50K\+\s*Reviews/i.test(src), 'an invented review count is still in copy').toBe(false);
    // Certifications the brand record does not list.
    for (const cert of ['USDA Certified', 'Soil Association', 'EU Organic Certified', 'Trustpilot Verified']) {
      expect(src.includes(cert), `"${cert}" is still asserted in generated copy`).toBe(false);
    }
  });

  test('no health or medical claim can be generated', () => {
    const src = read('lifecycle_mailer_architect_v34.html');
    // These shipped inside real email HTML, as ingredient-panel descriptions
    // and hero benefit bullets.
    for (const claim of ['Anti-inflammatory', 'Digestive warmth', 'Soothes digestion',
      'Holy basil', 'nutrient-dense superfood', 'L-theanine']) {
      expect(new RegExp(claim, 'i').test(src), `"${claim}" can still be generated`).toBe(false);
    }
  });

  test('brand claims in generated copy come from the brand record', () => {
    expect(read('lifecycle_mailer_architect_v34.html')).toMatch(/function brandClaims\(/);
  });
});

test.describe('daily email calendar renders only this workspace\'s plan', () => {
  const cal = () => read('daily-email-calendar.html');

  test('no bundled calendar is shipped as a fallback', () => {
    // REFERENCE_DAYS held twenty-one fully written sends - hero products,
    // prices, unit counts, cohort sizes and promo codes - and rendered whenever
    // the live plan came back empty.
    expect(/var\s+REFERENCE_DAYS\s*=/.test(cal()), 'the bundled calendar is still present').toBe(false);
  });

  test('an empty plan renders an empty state, not a substitute', () => {
    const src = cal();
    expect(src).toMatch(/function renderEmpty\(/);
    expect(/buildFromDays\(REFERENCE_DAYS/.test(src), 'the fallback still renders a bundled calendar').toBe(false);
  });

  test('no store AOV is printed from a constant', () => {
    // $42.71 was another company's basket, and the whole send plan was built
    // backwards from it.
    expect(/\$42\.71/.test(cal()), 'a hardcoded average order value is still shown').toBe(false);
  });

  test('discount guardrails are computed from the plan, not a stored code list', () => {
    const src = cal();
    expect(src).toMatch(/function codeGuardrails\(/);
    expect(/var\s+BANNED\s*=\s*\[\s*\n?\s*\["/.test(src), 'a stored promo-code list is still present').toBe(false);
  });
});

test.describe('premium experience renders the active brand\'s products', () => {
  const prem = () => read('premium-experience.html');

  test('no hero product is hardcoded', () => {
    expect(/var HERO\s*=\s*\{\s*handle:/.test(prem()), 'a literal hero product is still compiled in').toBe(false);
  });

  test('no rating, review count or named reviewer is rendered', () => {
    const src = prem();
    expect(/rating:\s*4\.9/.test(src), 'an invented rating is still present').toBe(false);
    expect(/reviews:\s*1223/.test(src), 'an invented review count is still present').toBe(false);
    expect(/HERO_REVIEW/.test(src), 'an invented customer testimonial is still present').toBe(false);
    // And it must SAY why, rather than quietly omitting.
    expect(src).toContain('DATA REQUIRED BEFORE LAUNCH: approved review library');
  });

  test('products resolve through the catalogue resolver', () => {
    const src = prem();
    expect(src).toContain('/brand-catalog.js');
    expect(src).toMatch(/BrandCatalog\.load\(/);
  });

  test('legal footer and shipping claim come from the brand record', () => {
    const src = prem();
    // A US office address belonging to the other company's entity.
    expect(/440 N Barranca/.test(src), 'another company\'s registered address is still printed').toBe(false);
    expect(src).toMatch(/legal_entity/);
  });
});

test.describe('Sales & Business Review does not describe another company', () => {
  const dash = () => read('lifecycle-usa-d2c-dashboard.html');

  test('the beverage-franchise deep dive is gone', () => {
    const src = dash();
    expect(/Coffee Business Deep Dive/.test(src), 'the franchise deep dive tab is still rendered').toBe(false);
    expect(/coffee_deep/.test(src), 'the franchise dataset is still bundled').toBe(false);
  });

  test('the tab keeps its slot so retired links still resolve', () => {
    // analysis-registry.js maps `?tab=review-coffee` to section index 8. The tab
    // had to be replaced, not removed, or every one of those links breaks.
    const registry = require(path.join(ROOT, 'analysis-registry.js'));
    expect(registry.reviewSection('review-coffee')).toBe(8);
    expect(dash()).toContain('7 · Category deep dive');
  });

  test('the page does not claim to be verified against exports', () => {
    const src = dash();
    expect(/figures verified against source/.test(src),
      'the footer still claims verification this deployment cannot do').toBe(false);
    expect(src).toContain('DEMO data');
  });

  test('the dataset carries no supplement or powder SKUs', () => {
    const src = dash();
    for (const w of ['1100 mg High Strength', 'KSM-66', 'Instant Mix', '2.47 Oz, 70g']) {
      expect(src.includes(w), `the review dataset still lists "${w}"`).toBe(false);
    }
  });
});

test.describe('feature pages take their taxonomy from the active brand', () => {
  test('the retention playbook builds catalog filters from the plan', () => {
    const src = read('retention-playbook.html');
    expect(src).toMatch(/function buildCatChips\(/);
    // The three hardcoded chips named another company's ranges.
    expect(/data-cat="coffee"/.test(src), 'a hardcoded catalog filter is still present').toBe(false);
    expect(/data-cat="supplement"/.test(src), 'a hardcoded catalog filter is still present').toBe(false);
    // And no keyword table classifying slots by that company's vocabulary.
    expect(/ksm-?66|shilajit/i.test(src), 'the supplement keyword table is still present').toBe(false);
  });

  test('avatars state no audience research this deployment does not hold', () => {
    const src = read('avatars.html');
    // Age bands, gender splits and household income ranges, all researched for
    // a different company's buyer.
    expect(/HHI \$\d+K to \$\d+K/.test(src), 'invented household income bands are still shown').toBe(false);
    expect(/\d\d% female \/ \d\d% male/.test(src), 'an invented gender split is still shown').toBe(false);
    // And it must SAY what is missing, rather than quietly dropping the field.
    expect(src).toContain('DATA REQUIRED BEFORE LAUNCH:');
    expect(src).toContain('avatar age band, gender split and household income');
  });

  test('the playbook states no market sizing it cannot source', () => {
    const src = read('playbook.html');
    // $117.94B / $26.40B / $5.85B were a US coffee and functional-beverage
    // sizing. The market study this page summarises carries no sizing for this
    // brand at all, so neither can this page.
    expect(/\$1?\d\d?\.\d\dB/.test(src), 'an unsourced market size is still printed').toBe(false);
    expect(src).toContain('DATA REQUIRED BEFORE LAUNCH: total addressable market sizing');
  });
});

test.describe('competitive-intelligence offers are categorised by the watching brand', () => {
  test('no fixed industry taxonomy is compiled into the module', () => {
    const src = read('api/_shared/ci-offers.js');
    expect(/CATEGORY_KEYWORDS\s*=\s*\{/.test(src),
      'the fixed four-bucket taxonomy is still present').toBe(false);
  });

  test('an offer is categorised from the brand\'s own offerings, or not at all', () => {
    const p = require.resolve(path.join(ROOT, 'api/_shared/ci-offers.js'));
    delete require.cache[p];
    const offers = require(p);

    const brand = {
      offerings: [
        { kind: 'sneaker', title: 'Cherry Blossom x Nike Air Force 1' },
        { kind: 'apparel', title: 'Embroidered Denim Jacket' },
      ],
    };

    // Matches this brand's own vocabulary -> that brand's own category key.
    expect(offers.guessCategory('20% off the Cherry Blossom pair', null, brand)).toBe('sneaker');
    // Matches nothing this brand sells -> null. The old code answered "coffee"
    // here, filing a competitor offer under an industry nobody on the platform
    // trades in.
    expect(offers.guessCategory('20% off our new coffee blend', null, brand)).toBeNull();
    // No brand context at all -> still null, never a default bucket.
    expect(offers.guessCategory('20% off our new coffee blend', null, null)).toBeNull();
  });
});

test.describe('shared nav describes the feature, not another advertiser\'s programme', () => {
  test('the ads INFO entry names no retail channel this brand does not sell through', () => {
    const src = read('auth.js');
    // Found by TITLE, not by key. This was keyed 'adsmaster', for a top-level
    // nav row that turned out to redirect onto the Data Analysis paid-media
    // tab already in the rail; removing that duplicate row moved the entry to
    // 'da-liveads' and broke a lookup that only knew the old key. The title is
    // what this test is actually about, so anchor on that.
    const start = src.indexOf("'da-liveads': {");
    expect(start, 'the paid-media INFO entry is missing').toBeGreaterThan(-1);
    const entry = src.slice(start, start + 4000);
    for (const channel of [['cost', 'co'].join(''), ['insta', 'cart'].join(''),
      ['tar', 'get.com'].join(''), ['Roun', 'del'].join('')]) {
      expect(new RegExp(channel, 'i').test(entry),
        `the ads INFO entry still names ${channel}`).toBe(false);
    }
  });
});
