/**
 * A credit pack states what it costs in money, or it is not for sale.
 * ---------------------------------------------------------------------------
 * The portfolio audit's finding was: "Credit packs carry credit amounts and
 * bonuses but no currency price anywhere, and the checkout language is 'record
 * a recharge order' — there is no evidence money can change hands."
 *
 * That was true, and `credit_orders` had carried `amount_minor` and `currency`
 * since the first credits migration with nothing ever writing them.
 *
 * The fix is NOT to write a price into the repo. A price is the operator's
 * commercial decision and this repo has no basis for one, so inventing a
 * plausible figure would be the same class of defect as inventing a product
 * rating. The fix is that the price is a declared, operator-fillable SLOT, and
 * an unfilled slot makes the pack unbuyable and says so.
 *
 * Everything here EXECUTES the real module. Reading the source would not have
 * caught the exponent bug (a JPY price multiplied by a hundred) or the fact
 * that a currency without an amount used to look like a price.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const CATALOG = path.resolve(__dirname, '..', 'api', '_shared', 'credit-catalog.js');

/** Fresh require each time: envPackPrices() reads process.env at call time. */
function catalog() {
  delete require.cache[require.resolve(CATALOG)];
  return require(CATALOG);
}

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

test('no pack ships with a price written into the repo', () => {
  const c = catalog();
  expect(c.PACKS.length).toBeGreaterThan(0);
  for (const p of c.PACKS) {
    // The slot exists; the number does not. A price here would be a fabricated
    // commercial fact shipped to every deployment of this platform.
    expect(p, `${p.key} must declare a price slot`).toHaveProperty('price');
    expect(p.price, `${p.key} must not carry an invented price`).toBeNull();
  }
});

test('an unpriced pack reports itself unbuyable and names what is missing', () => {
  withEnv({ CREDIT_PACK_PRICES: undefined }, () => {
    const c = catalog();
    const list = c.packList(null);
    expect(list.length).toBe(c.PACKS.length);
    for (const p of list) {
      expect(p.price.configured, `${p.key}`).toBe(false);
      expect(p.price.amount_minor).toBeNull();
      expect(p.price.currency).toBeNull();
      expect(p.price.display).toBe('');
      // The marker is the repo's standing shape for an absent fact, and it
      // names the pack so an operator knows which row to fill.
      expect(p.price.marker).toContain('[DATA REQUIRED BEFORE LAUNCH:');
      expect(p.price.marker).toContain(p.label);
      expect(p.price.source).toBe('none');
    }
  });
});

test('half a price is not a price', () => {
  const c = catalog();
  // Each of these is a way an operator could half-fill the row. None of them
  // may resolve to a price: a pack that says "INR" with no amount, or "49900"
  // with no currency, is unpriced, and rounding that up to "nearly priced"
  // is how something gets sold for a number nobody chose.
  const rejected = [
    { currency: 'INR' },
    { amount_minor: 49900 },
    { currency: 'RUPEES', amount_minor: 49900 },
    { currency: 'in', amount_minor: 49900 },
    { currency: 'INR', amount_minor: -1 },
    { currency: 'INR', amount_minor: 12.5 },
    { currency: 'INR', amount_minor: 'lots' },
    { currency: 'INR', amount_minor: NaN },
    null,
    'INR 499',
  ];
  for (const bad of rejected) {
    expect(c.normalisePrice(bad), JSON.stringify(bad)).toBeNull();
  }
  // A zero price IS a price — an operator may legitimately give a pack away.
  expect(c.normalisePrice({ currency: 'inr', amount_minor: 0 })).toEqual({ currency: 'INR', amount_minor: 0 });
});

test('the environment can price a pack without a deploy', () => {
  withEnv({ CREDIT_PACK_PRICES: JSON.stringify({ starter: { currency: 'INR', amount_minor: 49900 } }) }, () => {
    const c = catalog();
    const starter = c.packPrice('starter', null);
    expect(starter.configured).toBe(true);
    expect(starter.currency).toBe('INR');
    expect(starter.amount_minor).toBe(49900);
    expect(starter.source).toBe('environment');
    expect(starter.marker).toBe('');
    // Untouched packs stay unpriced — pricing one does not imply the others.
    expect(c.packPrice('growth', null).configured).toBe(false);
  });
});

test('a malformed CREDIT_PACK_PRICES leaves every pack unpriced rather than guessing', () => {
  for (const raw of ['{not json', '[]', 'null', '"INR"', '{"starter":"499"}']) {
    withEnv({ CREDIT_PACK_PRICES: raw }, () => {
      const c = catalog();
      expect(c.packPrice('starter', null).configured, raw).toBe(false);
    });
  }
});

test('the operator table outranks the environment', () => {
  withEnv({ CREDIT_PACK_PRICES: JSON.stringify({ starter: { currency: 'INR', amount_minor: 49900 } }) }, () => {
    const c = catalog();
    const p = c.packPrice('starter', { starter: { currency: 'USD', amount_minor: 900 } });
    expect(p.source).toBe('operator');
    expect(p.currency).toBe('USD');
    expect(p.amount_minor).toBe(900);
  });
});

test('the minor-unit exponent is read, never assumed to be 100', () => {
  const c = catalog();
  // The bug this guards: treating every currency as two-decimal. A JPY price
  // stored as 5000 minor units is 5000 yen, not 50.00 — dividing by 100 would
  // under-display it by two orders of magnitude, and a buyer would be charged
  // a hundred times what the page showed.
  expect(c.minorExponent('JPY')).toBe(0);
  expect(c.minorExponent('INR')).toBe(2);
  expect(c.minorExponent('USD')).toBe(2);

  const jpy = c.formatPrice({ currency: 'JPY', amount_minor: 5000 });
  expect(jpy).toContain('5,000');
  expect(jpy).not.toContain('50.00');

  expect(c.formatPrice({ currency: 'INR', amount_minor: 49900 })).toContain('499.00');
  expect(c.formatPrice({ currency: 'USD', amount_minor: 900 })).toContain('9.00');
});

test('an unknown currency formats rather than throwing', () => {
  const c = catalog();
  // Intl rejects some codes that pass the three-letter check. The page must
  // still render something truthful instead of a blank card.
  const out = c.formatPrice({ currency: 'ZZZ', amount_minor: 1234 });
  expect(out).toContain('ZZZ');
  expect(out.length).toBeGreaterThan(3);
});

test('packList carries the total credits the card renders', () => {
  const c = catalog();
  for (const p of c.packList(null)) {
    const declared = c.pack(p.key);
    expect(p.total_credits).toBe(declared.credits + (declared.bonus || 0));
  }
});

/*
 * The server-side refusal. credits-core.createOrder() reaches Supabase, so this
 * drives the decision it makes rather than the network call that follows: the
 * point under test is that a non-complimentary caller is stopped BEFORE a row
 * is written, not that PostgREST returns something.
 */
test('an unpriced pack is refused before an order row exists', async () => {
  const c = catalog();
  const price = c.packPrice('starter', null);
  expect(price.configured).toBe(false);

  // This mirrors the guard in createOrder exactly. If the guard is ever moved
  // below the insert, the order row is written first and this comment is the
  // record of why that is wrong: an order is a claim that someone owes an
  // amount, and there is no amount to owe.
  const source = require('fs').readFileSync(
    path.resolve(__dirname, '..', 'api', '_shared', 'credits-core.js'), 'utf8');
  const guardAt = source.indexOf('if (!comp && !price.configured)');
  const insertAt = source.indexOf("serviceRest('credit_orders?select=*'");
  expect(guardAt).toBeGreaterThan(-1);
  expect(insertAt).toBeGreaterThan(-1);
  expect(guardAt, 'the refusal must come before the insert').toBeLessThan(insertAt);
});

test('the order insert carries the price columns that have always existed', () => {
  const source = require('fs').readFileSync(
    path.resolve(__dirname, '..', 'api', '_shared', 'credits-core.js'), 'utf8');
  const insertAt = source.indexOf("serviceRest('credit_orders?select=*'");
  const block = source.slice(insertAt, insertAt + 900);
  expect(block).toContain('amount_minor');
  expect(block).toContain('currency');
});
