// The credential vault and the adapter contract.
//
// The OAuth callback is the one authenticated-feeling path in this platform
// that carries NO Supabase JWT: it is a top-level browser redirect from Meta or
// Google, and a redirect has no Authorization header. The `state` parameter is
// therefore the entire authentication, and most of this file is about that.
//
// Run: npx playwright test tests/oauth-adapters.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const oauth = require(path.join(ROOT, 'api', '_shared', 'oauth-core.js'));
const registry = require(path.join(ROOT, 'api', '_shared', 'adapters', 'registry.js'));
const { BasePlatformAdapter, AdPlatformAdapter, CrmPlatformAdapter } = require(path.join(ROOT, 'api', '_shared', 'adapters', 'base-adapter.js'));

/* ═══ PKCE ════════════════════════════════════════════════════════════════ */

test('the PKCE verifier is the length RFC 7636 requires, and is random', () => {
  const a = oauth.makeVerifier();
  const b = oauth.makeVerifier();
  expect(a.length).toBeGreaterThanOrEqual(43);
  expect(a.length).toBeLessThanOrEqual(128);
  expect(a).not.toBe(b);
  expect(a, 'must be url-safe base64 with no padding').toMatch(/^[A-Za-z0-9_-]+$/);
});

test('the challenge is the S256 hash, not the verifier itself', () => {
  const v = oauth.makeVerifier();
  const c = oauth.challengeFor(v);
  expect(c).not.toBe(v);
  expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(oauth.challengeFor(v), 'must be deterministic').toBe(c);
});

/* ═══ open redirect ═══════════════════════════════════════════════════════ */

test('return_to cannot leave this origin', () => {
  // A "sanitising" filter is where open-redirect bugs live, so anything that is
  // not a plain same-origin path is replaced outright rather than cleaned.
  for (const evil of [
    'https://evil.example/steal',
    '//evil.example/steal',
    'http://evil.example',
    'javascript:alert(1)',
    '\\\\evil.example',
    'https:/\\evil.example',
  ]) {
    expect(oauth.safeReturnTo(evil), `${evil} must not survive`).toBe('/connections');
  }
  // Legitimate same-origin paths do survive, query string included.
  expect(oauth.safeReturnTo('/publishing')).toBe('/publishing');
  expect(oauth.safeReturnTo('/publishing?tab=hub')).toBe('/publishing?tab=hub');
  expect(oauth.safeReturnTo('')).toBe('/connections');
});

/* ═══ state ═══════════════════════════════════════════════════════════════ */

test('the state row is consumed by a conditional update, not a read then write', () => {
  // Two callbacks racing on one state must produce exactly one winner. A
  // SELECT followed by an UPDATE lets both through; the filter has to be in
  // the PATCH itself.
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'oauth-core.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function consumeState'), src.indexOf('async function handleCallback'));
  expect(fn).toMatch(/consumed_at=is\.null/);
  expect(fn).toMatch(/expires_at=gt\./);
  expect(fn).toMatch(/method:\s*'PATCH'/);
});

test('the PKCE verifier is unreachable from any browser role', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260818140000_dispatch_and_deliverability.sql'), 'utf8');
  // RLS on, no policy, revoked from both browser roles - the same treatment
  // workspace_connection_secrets gets, because it holds the same class of thing.
  expect(sql).toMatch(/alter table public\.oauth_authorization_states enable row level security/i);
  expect(sql).toMatch(/revoke all on public\.oauth_authorization_states from anon, authenticated/i);
  expect(sql, 'no policy may be created on the state table')
    .not.toMatch(/create policy[^;]*on public\.oauth_authorization_states/i);
});

test('no table in the new migration is left open to anon', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260818140000_dispatch_and_deliverability.sql'), 'utf8');
  expect(sql).toMatch(/revoke all on public\.%I from anon/);
  // The lesson from the 17 Aug audit, applied from the start rather than
  // retrofitted: nothing grants anon anything here.
  expect(sql).not.toMatch(/grant[^;]*\bto\b[^;]*\banon\b/i);
});

/* ═══ scope validation ════════════════════════════════════════════════════ */

test('a missing scope is caught before the send, not after a 403', () => {
  const out = oauth.validateScopes('meta', 'meta_ad', ['ads_read'], 'write');
  expect(out.ok).toBe(false);
  expect(out.missing).toContain('ads_management');
  expect(out.note).toMatch(/cannot be added to an existing token/);
});

test('a connection with no recorded scopes is unknown, not unauthorised', () => {
  // Refusing here would break every connection made before scopes were stored.
  const out = oauth.validateScopes('meta', 'meta_ad', [], 'write');
  expect(out.ok).toBe(true);
  expect(out.unknown).toBe(true);
});

test('a granted scope set passes', () => {
  expect(oauth.validateScopes('klaviyo', 'klaviyo_email', ['templates:write', 'campaigns:write'], 'write').ok).toBe(true);
});

/* ═══ the adapter contract ════════════════════════════════════════════════ */

const CONTRACT = ['validateCredentials', 'refreshCredentials', 'map', 'validatePayload', 'dispatch', 'fetchStatus', 'verifyWebhook', 'gap'];

test('every adapter implements the whole contract', () => {
  for (const id of Object.keys(registry.ADAPTERS)) {
    const A = registry.ADAPTERS[id];
    for (const m of CONTRACT) {
      expect(typeof A.prototype[m] === 'function' || typeof BasePlatformAdapter.prototype[m] === 'function',
        `${id} is missing ${m}()`).toBe(true);
    }
    expect(typeof A.id, `${id} must declare an id`).toBe('string');
    expect(Array.isArray(A.channels), `${id} must declare channels`).toBe(true);
    expect(A.auth && typeof A.auth === 'object', `${id} must declare auth`).toBe(true);
  }
});

test('the TypeScript declarations name only methods that exist', () => {
  // types.d.ts is a declaration over the JavaScript rather than the source of
  // it, so it can drift into being a lie. This is what stops that.
  const dts = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'adapters', 'types.d.ts'), 'utf8');
  const declared = (section, proto) => {
    const start = dts.indexOf(`export interface ${section}`);
    expect(start, `${section} should be declared`).toBeGreaterThan(-1);
    const body = dts.slice(start, dts.indexOf('}', start));
    for (const m of [...body.matchAll(/^\s{2}(\w+)\s*\(/gm)].map((x) => x[1])) {
      expect(typeof proto[m], `types.d.ts declares ${section}.${m}() which does not exist`).toBe('function');
    }
  };
  declared('BasePlatformAdapter', BasePlatformAdapter.prototype);
  declared('AdPlatformAdapter', AdPlatformAdapter.prototype);
  declared('CrmPlatformAdapter', CrmPlatformAdapter.prototype);
});

test('every adapter declares where its endpoints came from', () => {
  for (const id of Object.keys(registry.ADAPTERS)) {
    const sources = registry.ADAPTERS[id].auth.sources || [];
    expect(sources.length, `${id} must record the provenance of its endpoints`).toBeGreaterThan(0);
  }
});

test('an unverified endpoint is admitted in the registry rather than hidden', () => {
  const view = registry.registryView();
  const klaviyo = view.find((v) => v.id === 'klaviyo');
  // Klaviyo's write paths were implemented from its JSON:API conventions and
  // could not be re-read from documentation (the docs host is unreachable from
  // the build environment). The hub has to say so.
  expect(klaviyo.endpoints_verified).toBe(false);
  expect(klaviyo.unverified_operations).toContain('create_campaign');

  for (const v of view) {
    if (v.endpoints_verified) continue;
    expect(v.unverified_operations.length, `${v.id} claims unverified with an empty list`).toBeGreaterThan(0);
  }
});

/* ═══ mapping is pure ═════════════════════════════════════════════════════ */

test('mapping the same asset twice gives the same payload', () => {
  // If mapping were not pure, the idempotency key derived from its output would
  // change between a send and its retry, and the retry would double-post.
  const Meta = registry.adapterFor('meta');
  const a = new Meta({ workspaceId: 'w', credentials: {} });
  const asset = { caption: 'Hello', image_url: 'https://x.example/a.jpg', hashtags: ['#a', '#b'] };
  expect(JSON.stringify(a.map(asset, {}).payload)).toBe(JSON.stringify(a.map(asset, {}).payload));
});

test('a missing required field becomes a marker, never a placeholder value', () => {
  const Klaviyo = registry.adapterFor('klaviyo');
  const out = new Klaviyo({ workspaceId: 'w', credentials: {} }).map({}, {});
  expect(out.ok).toBe(false);
  expect(out.missing.join(' ')).toMatch(/DATA REQUIRED BEFORE LAUNCH/);
  // The payload must not have been filled with something plausible instead.
  expect(out.payload.subject).toBe('');
});

test('Google ad copy that breaks a hard limit is dropped and reported, not truncated', () => {
  const G = registry.adapterFor('google_ads');
  const out = new G({ workspaceId: 'w', credentials: { customer_id: '123' } }).map({
    headlines: ['ok one', 'ok two', 'ok three', 'x'.repeat(45)],
    descriptions: ['fine one', 'fine two'],
    final_url: 'https://brand.example/p',
  }, {});
  // Truncating a headline changes the claim it makes.
  expect(out.payload.headlines).toHaveLength(3);
  expect(out.warnings.join(' ')).toMatch(/dropped rather than truncated/);
});

/* ═══ ad library honesty ══════════════════════════════════════════════════ */

test('Google ad transparency refuses rather than returning an empty result', async () => {
  const G = registry.adapterFor('google_ads');
  const out = await new G({ workspaceId: 'w', credentials: {} }).searchAdLibrary({ terms: 'anything' });
  expect(out.ok).toBe(false);
  // `searched:false` is the whole point: an empty array here would be read as
  // "this advertiser runs no ads", which is a conclusion nobody may draw.
  expect(out.searched).toBe(false);
  expect(out.note).toMatch(/no documented public API/i);
});

test('Meta ad library states its coverage limits', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_shared', 'adapters', 'meta-adapter.js'), 'utf8');
  expect(src).toMatch(/social issue|political/i);
  expect(src).toMatch(/not evidence that the advertiser runs no ads/i);
});

/* ═══ extensibility hooks ═════════════════════════════════════════════════ */

test('an unconfirmed CRM hook builds the request and refuses to send it', async () => {
  const Braze = registry.adapterFor('braze');
  const a = new Braze({
    workspaceId: 'w',
    credentials: { api_key: 'k', region: 'us-01' },
    connection: { config: {} },              // endpoints_confirmed not set
    publishEnabled: true,
  });
  const out = await a.dispatch('braze_user', { id: 'user-1', attributes: { x: 1 } });
  expect(out.ok).toBe(false);
  expect(out.sent).toBe(false);
  expect(out.error_class).toBe('blocked');
  expect(out.would_request.url).toContain('rest.iad-01.braze.com');
  expect(out.error).toMatch(/unconfirmed/i);
});

test('the three hooks are registered and each declares its own regions or host shape', () => {
  for (const id of ['braze', 'activecampaign', 'customerio']) {
    const A = registry.adapterFor(id);
    expect(A, `${id} should be registered`).toBeTruthy();
    expect(A.channels.length).toBeGreaterThan(0);
    expect(A.auth.endpoints_verified).toBe(false);
  }
});
