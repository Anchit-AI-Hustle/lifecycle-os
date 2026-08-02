const { test, expect } = require('@playwright/test');
const path = require('path');

// Enforces the standing rule: nothing in the project may WRITE to the three
// source platforms (Shopify / Klaviyo / WebEngage) — read/pull/fetch only.
// If anyone ever removes the guard or wires a write, these assertions fail CI.
const guard = require(path.join(__dirname, '..', 'api', '_shared', 'read-only-egress.js'));

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const GUARDED = [
  ['klaviyo',   'https://a.klaviyo.com/api/profiles/'],
  ['shopify',   'https://knickgasm.myshopify.com/admin/api/2024-10/products.json'],
  ['webengage', 'https://api.webengage.com/v1/accounts/x/users'],
];

test('every write verb to a guarded platform throws', () => {
  for (const [id, url] of GUARDED) {
    for (const m of WRITE_METHODS) {
      expect(() => guard.assertReadOnly(url, m), `${m} ${id} must be blocked`).toThrow(/READ-ONLY VIOLATION/);
    }
  }
});

test('read verbs (GET/HEAD) to guarded platforms are allowed; nothing else', () => {
  for (const [, url] of GUARDED) {
    for (const m of ['GET', 'HEAD']) {
      expect(() => guard.assertReadOnly(url, m)).not.toThrow();
    }
    // OPTIONS is not a read here — read is GET, always.
    expect(() => guard.assertReadOnly(url, 'OPTIONS')).toThrow(/READ-ONLY VIOLATION/);
  }
});

test('POST is always blocked — there is no read-only POST exception', () => {
  // Even Klaviyo reporting endpoints (POST-only in their API) are denied here:
  // read is GET, always.
  expect(() => guard.assertReadOnly('https://a.klaviyo.com/api/campaign-values-reports/', 'POST')).toThrow(/READ-ONLY VIOLATION/);
  expect(() => guard.assertReadOnly('https://a.klaviyo.com/api/profiles/', 'POST')).toThrow(/READ-ONLY VIOLATION/);
});

test('non-guarded hosts are unaffected (e.g. our own Supabase sink)', () => {
  expect(() => guard.assertReadOnly('https://xyz.supabase.co/rest/v1/klaviyo_segments', 'POST')).not.toThrow();
  expect(() => guard.assertReadOnly('https://api.openai.com/v1/chat/completions', 'POST')).not.toThrow();
});

test('per-platform override env re-enables writes only for that platform', () => {
  process.env.KLAVIYO_ALLOW_WRITES = '1';
  try {
    expect(() => guard.assertReadOnly('https://a.klaviyo.com/api/events/', 'POST')).not.toThrow();
    // Shopify + WebEngage stay blocked — the override is per-platform.
    expect(() => guard.assertReadOnly('https://knickgasm.myshopify.com/admin/api/x', 'POST')).toThrow(/READ-ONLY VIOLATION/);
  } finally {
    delete process.env.KLAVIYO_ALLOW_WRITES;
  }
});
