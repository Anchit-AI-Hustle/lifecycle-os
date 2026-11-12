// @ts-check
/**
 * LinkedIn: a post on the brand's company page (2026-11-12). The operator:
 * "ensure all platforms like milled, klaviyo, webengage, meta, google,
 * linkedin, tiktok, etc for brands posting are integrated and syncable".
 *
 * Executed: the shipped adapter over a fake LinkedIn API that answers only the
 * documented calls (learn.microsoft.com/en-us/linkedin, read 2026-11-12) and
 * throws on anything else.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const LinkedIn = require(path.join(ROOT, 'api', '_shared', 'adapters', 'linkedin-adapter.js'));
const registry = require(path.join(ROOT, 'api', '_shared', 'adapters', 'registry.js'));
const AP = require(path.join(ROOT, 'api', '_shared', 'calendar-autopost.js'));

const SWITCHES = ['LIVE_CONNECTORS', 'LINKEDIN_ALLOW_WRITES', 'LINKEDIN_API_VERSION'];
let saved; let realFetch; let calls;
test.beforeEach(() => {
  saved = Object.fromEntries(SWITCHES.map((k) => [k, process.env[k]]));
  realFetch = global.fetch; calls = [];
  global.fetch = async (url, init) => {
    const u = new URL(String(url)); const o = init || {};
    const h = Object.fromEntries(Object.entries(o.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method: o.method || 'GET', url: String(url), headers: h, body: o.body ? JSON.parse(o.body) : null });
    const json = (status, body, headers) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) });
    if (u.host !== 'api.linkedin.com') throw new Error('undocumented host: ' + url);
    if (h.authorization !== 'Bearer li_tok') return json(401, { message: 'Invalid access token' });
    if (h['x-restli-protocol-version'] !== '2.0.0' || !/^\d{6}$/.test(h['linkedin-version'] || '')) return json(400, { message: 'A version must be present' });
    if ((o.method || 'GET') === 'GET' && u.pathname === '/rest/organizationAcls' && u.searchParams.get('q') === 'roleAssignee') return json(200, { elements: [{ role: 'ADMINISTRATOR', state: 'APPROVED', organization: 'urn:li:organization:5515715' }] });
    if ((o.method || 'GET') === 'GET' && u.pathname === '/rest/posts' && u.searchParams.get('q') === 'author' && h['x-restli-method'] === 'FINDER') return json(200, { elements: [{ id: 'urn:li:share:1', commentary: 'An earlier post', lifecycleState: 'PUBLISHED', createdAt: 1794000000000 }] });
    if (o.method === 'POST' && u.pathname === '/rest/posts') {
      const b = JSON.parse(o.body);
      if (!/^urn:li:organization:\d+$/.test(b.author) || !b.commentary || b.visibility !== 'PUBLIC' || b.lifecycleState !== 'PUBLISHED' || !b.distribution || b.distribution.feedDistribution !== 'MAIN_FEED') return json(422, { message: 'invalid post' });
      return json(201, null, { 'x-restli-id': 'urn:li:share:6844785523593134080' });
    }
    throw new Error('undocumented LinkedIn call: ' + (o.method || 'GET') + ' ' + url);
  };
});
test.afterEach(() => { global.fetch = realFetch; for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const adapter = (config, extra) => new LinkedIn(Object.assign({ workspaceId: 'ws-a', publishEnabled: true, credentials: { access_token: 'li_tok' }, connection: { config: config || { organization_id: '5515715' } } }, extra || {}));

test('LinkedIn is a registered platform: its sign-in, its scopes, its connection and its route from a social post', () => {
  expect(registry.adapterFor('linkedin')).toBe(LinkedIn);
  expect(registry.connectionProviderFor('linkedin')).toBe('linkedin');
  expect(AP.ROUTES.linkedin).toEqual({ adapter: 'linkedin', channel: 'linkedin_post', label: 'LinkedIn' });
  expect(AP.NO_ROUTE.linkedin).toBeUndefined();
  const auth = LinkedIn.auth;
  expect(auth.endpoints.authorize).toBe('https://www.linkedin.com/oauth/v2/authorization');
  expect(auth.endpoints.token).toBe('https://www.linkedin.com/oauth/v2/accessToken');
  expect(auth.scope_separator).toBe(' ');
  expect(LinkedIn.requiredScopes('linkedin_post')).toEqual(['w_organization_social']);
  // every endpoint names the page it was read on; the image upload is not verified and so cannot be sent
  for (const [op, ep] of Object.entries(LinkedIn.endpointTable)) expect(ep.doc, op).toMatch(/learn\.microsoft\.com\/en-us\/linkedin/);
  expect(LinkedIn.endpointTable.image_init.verified).toBe(false);
  // the post's words, link and hashtags become one text; a page id is required
  const a = adapter();
  const m = a.map(AP.assetFor('linkedin', { payload: { key: 'linkedin', copy: { caption: 'A lightweight foundation.' }, hashtags: ['#Nykaa'], link: 'https://www.nykaa.com/p1?utm_medium=social' } }, null), { channel: 'linkedin_post' });
  expect(m.ok).toBe(true);
  expect(m.payload).toEqual({ organization_id: '5515715', text: 'A lightweight foundation.\n\nhttps://www.nykaa.com/p1?utm_medium=social\n\n#Nykaa' });
  const none = adapter({}).map({ text: 'Hello' }, { channel: 'linkedin_post' });
  expect(none.ok).toBe(false);
  expect(none.missing.join(' ')).toMatch(/company page id/);
});

test('a post goes out only with every switch on, in LinkedIn\'s documented shape, and comes back with its URN', async () => {
  const payload = { organization_id: '5515715', text: 'A lightweight foundation.\n\nhttps://www.nykaa.com/p1' };
  // LIVE_CONNECTORS off (the default): the request is built and shown, nothing is sent.
  delete process.env.LIVE_CONNECTORS; delete process.env.LINKEDIN_ALLOW_WRITES;
  const off = await adapter().dispatch('linkedin_post', payload);
  expect(off.ok).toBe(false);
  expect(off.sent).toBe(false);
  expect(calls).toEqual([]);
  expect(JSON.stringify(off.would_request || {})).toContain('urn:li:organization:5515715');
  // LIVE on, the platform's own switch off: still nothing.
  process.env.LIVE_CONNECTORS = 'on';
  const half = await adapter().dispatch('linkedin_post', payload);
  expect(half.sent).toBe(false);
  expect(String(half.error || half.blocker || '')).toMatch(/LINKEDIN_ALLOW_WRITES/);
  expect(calls).toEqual([]);
  // Every switch on.
  process.env.LINKEDIN_ALLOW_WRITES = '1';
  const out = await adapter().dispatch('linkedin_post', payload);
  expect(out, JSON.stringify(out)).toMatchObject({ ok: true, sent: true, external_id: 'urn:li:share:6844785523593134080', status: 'published' });
  expect(calls.length).toBe(1);
  expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://api.linkedin.com/rest/posts' });
  expect(calls[0].headers['linkedin-version']).toBe('202610');
  expect(calls[0].body).toEqual({ author: 'urn:li:organization:5515715', commentary: payload.text, visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false });
  // a marker never goes out, and nothing is sent for it
  const marker = await adapter().dispatch('linkedin_post', { organization_id: '5515715', text: '[DATA REQUIRED BEFORE LAUNCH: product, Nykaa]' });
  expect(marker).toMatchObject({ ok: false, sent: false, error_class: 'validation' });
  expect(calls.length).toBe(1);
});

test('sync: the token is checked against the pages it administers, and the page\'s own posts are read', async () => {
  process.env.LIVE_CONNECTORS = 'on';
  const ok = await adapter({}).validateCredentials();
  expect(ok).toMatchObject({ ok: true, account: { id: '5515715' } });
  const posts = await adapter().listPosts({ count: 5 });
  expect(posts).toMatchObject({ ok: true, posts: [{ id: 'urn:li:share:1', text: 'An earlier post', state: 'PUBLISHED' }] });
  const read = calls.find((c) => /\/rest\/posts\?/.test(c.url));
  expect(read.headers['x-restli-method']).toBe('FINDER');
  expect(new URL(read.url).searchParams.get('author')).toBe('urn:li:organization:5515715');
  // a refused token is said, not read as "no pages"
  const bad = await new LinkedIn({ workspaceId: 'ws-a', credentials: { access_token: 'nope' }, connection: { config: {} } }).validateCredentials();
  expect(bad.ok).toBe(false);
  // no refresh call is made: LinkedIn gives refresh tokens to partners only
  const before = calls.length;
  const r = await adapter().refreshCredentials();
  expect(r).toMatchObject({ ok: false, supported: false });
  expect(calls.length).toBe(before);
});
