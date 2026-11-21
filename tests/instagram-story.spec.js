// @ts-check
/**
 * An Instagram Story is a publishing channel (2026-11-21).
 * Meta's content publishing page (developers.facebook.com/docs/instagram-platform/
 * content-publishing, read that day): a container with media_type STORIES, then
 * media_publish. Executed: the shipped Meta adapter over a fake Graph API that
 * answers only those two calls and throws on anything else.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const Meta = require(path.join(ROOT, 'api', '_shared', 'adapters', 'meta-adapter.js'));
const registry = require(path.join(ROOT, 'api', '_shared', 'adapters', 'registry.js'));
const AP = require(path.join(ROOT, 'api', '_shared', 'calendar-autopost.js'));

const SWITCHES = ['LIVE_CONNECTORS', 'META_ALLOW_WRITES'];
let saved; let realFetch; let calls;
test.beforeEach(() => {
  saved = Object.fromEntries(SWITCHES.map((k) => [k, process.env[k]]));
  realFetch = global.fetch; calls = [];
  global.fetch = async (url, init) => {
    const u = new URL(String(url)); const o = init || {};
    const body = o.body ? JSON.parse(o.body) : null;
    calls.push({ method: o.method || 'GET', path: u.pathname, body });
    const json = (status, b) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.host !== 'graph.facebook.com') throw new Error('undocumented host: ' + url);
    if (o.method === 'POST' && /\/1789\/media$/.test(u.pathname)) {
      if (body.media_type !== 'STORIES' || (!body.image_url && !body.video_url) || 'caption' in body) return json(400, { error: { message: 'bad story container' } });
      return json(200, { id: 'container_1' });
    }
    if (o.method === 'POST' && /\/1789\/media_publish$/.test(u.pathname) && body.creation_id === 'container_1') return json(200, { id: 'story_9' });
    throw new Error('undocumented Graph call: ' + (o.method || 'GET') + ' ' + url);
  };
});
test.afterEach(() => { global.fetch = realFetch; for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const adapter = () => new Meta({ workspaceId: 'ws-a', publishEnabled: true, credentials: { access_token: 'tok' }, connection: { config: { ig_user_id: '1789' } } });

test('a calendar Story post has a route, needs a picture or a video and no caption', () => {
  expect(AP.ROUTES.instagram_stories).toEqual({ adapter: 'meta', channel: 'instagram_story', label: 'Instagram' });
  expect(AP.NO_ROUTE.instagram_stories).toBeUndefined();
  expect(registry.adapterForChannel('instagram_story')).toBe(Meta);
  expect(Meta.requiredScopes('instagram_story')).toContain('instagram_content_publish');
  const a = adapter();
  const asset = AP.assetFor('instagram_stories', { payload: { key: 'instagram_stories', copy: { caption: '' }, media: { image_url: 'https://cdn.example/s.jpg' } } }, null);
  const m = a.map(asset, { channel: 'instagram_story' });
  expect(m.ok).toBe(true);
  expect(m.payload.image_url).toBe('https://cdn.example/s.jpg');
  expect(a.validatePayload('instagram_story', m.payload).ok).toBe(true);
  // nothing to show: said, not sent
  const none = a.map(AP.assetFor('instagram_stories', { payload: { key: 'instagram_stories', copy: { caption: 'x' }, media: {} } }, null), { channel: 'instagram_story' });
  expect(none.ok).toBe(false);
  expect(a.validatePayload('instagram_story', { ig_user_id: '1789' }).errors.join(' ')).toMatch(/image or a video/);
  // a feed post still needs its caption
  expect(a.validatePayload('instagram_feed', { ig_user_id: '1789', image_url: 'https://cdn.example/s.jpg' }).ok).toBe(false);
});

test('a Story goes out only with every switch on, as a STORIES container then a publish', async () => {
  const payload = { ig_user_id: '1789', image_url: 'https://cdn.example/s.jpg', caption: '' };
  delete process.env.LIVE_CONNECTORS; delete process.env.META_ALLOW_WRITES;
  const off = await adapter().dispatch('instagram_story', payload);
  expect(off.sent).toBe(false);
  expect(calls).toEqual([]);
  process.env.LIVE_CONNECTORS = 'on'; process.env.META_ALLOW_WRITES = '1';
  const out = await adapter().dispatch('instagram_story', payload);
  expect(out).toMatchObject({ ok: true, sent: true, external_id: 'story_9' });
  expect(calls.map((c) => c.path.replace(/^\/v[\d.]+/, ''))).toEqual(['/1789/media', '/1789/media_publish']);
  expect(calls[0].body).toEqual({ media_type: 'STORIES', image_url: 'https://cdn.example/s.jpg' });
  // a video Story carries its video
  calls.length = 0;
  await adapter().dispatch('instagram_story', { ig_user_id: '1789', video_url: 'https://cdn.example/s.mp4' });
  expect(calls[0].body).toEqual({ media_type: 'STORIES', video_url: 'https://cdn.example/s.mp4' });
});

test('a standalone generation says what it rests on: provisional, with no evidence claimed', () => {
  const F = require(path.join(ROOT, 'api', '_shared', 'generate-finish.js'));
  const d = F.decisionOf({ report: { data_gaps: [] } });
  expect(d.state).toBe('provisional');
  expect(d.evidence).toEqual([]);
  expect(d.note).toMatch(/hypothesis/);
});
