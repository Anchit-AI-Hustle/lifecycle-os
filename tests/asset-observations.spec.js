/**
 * One observation record over the brand's own and its competitors' assets.
 * ---------------------------------------------------------------------------
 * EXECUTED: api/_shared/asset-observations.js over an injected reader that
 * answers the queries the module sends (no network, no database).
 *   - owned and competitor rows come back in ONE shape, each with a stable id,
 *     its ownership, source, dates and a status that says only what is known;
 *   - a row of another workspace handed back by the store is dropped;
 *   - a store that does not answer marks THAT source unavailable and takes
 *     nothing from the others; an empty source is no_results; a source this
 *     repository does not read is not_read and never has an observation;
 *   - the same ad seen on the brand's account and in a library is linked by
 *     alias; two captures of one page are versions, not duplicates;
 *   - a read older than a week is stale; a full page of rows is partial;
 *   - only https media is passed on, and captured text stays text;
 *   - the route answers a device brand in words and a non-member with 404.
 *
 * Run: npx playwright test tests/asset-observations.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OBS = require(path.join(ROOT, 'api', '_shared', 'asset-observations.js'));
const WS = '11111111-2222-4333-8444-555555555555';
const NOW = Date.UTC(2026, 10, 12, 8);
const day = (n) => new Date(NOW - n * 86400000).toISOString();

const OWN = [
  { id: 'a1', workspace_id: WS, provider: 'meta', account_id: 'act_9', ad_id: '9001', name: 'Monsoon', status: 'ACTIVE', headline: 'Frames that sit light', primary_text: 'Titanium frames, in store now.', image_url: 'https://cdn.example/a.jpg', video_url: 'http://insecure.example/v.mp4', landing_url: 'https://fernline.example/frames?utm_source=meta', currency: 'INR', first_seen: day(40), last_seen: day(1), imported_at: day(1), started_at: day(41), window_start: '2026-05-16', window_end: '2026-11-11' },
  { id: 'a2', workspace_id: WS, provider: 'google_ads', account_id: '123', ad_id: 'g-7', name: 'Search ad', status: null, landing_url: null, first_seen: day(20), last_seen: day(12), imported_at: day(12) },
  { id: 'zz', workspace_id: 'ffffffff-0000-4000-8000-000000000000', provider: 'meta', account_id: 'act_1', ad_id: 'other', headline: 'Another brand', last_seen: day(0) },
];
const CI_ADS = [
  { id: 5, workspace_id: WS, brand_name: 'Rival Optics', source: 'meta', ad_id: 'lib-1', content_hash: 'h1', active: true, primary_copy: '<script>alert(1)</script> Half price frames', headline: 'Rival sale', landing_url: 'https://rival.example/sale', source_link: 'https://www.facebook.com/ads/library/?id=1', image_urls: ['https://x.example/1.jpg', 'javascript:alert(1)'], first_seen: day(30), last_seen: day(2) },
  // the brand's own ad as the library shows it: same destination, same words
  { id: 6, workspace_id: WS, brand_name: 'Fernline Optics', source: 'meta', ad_id: 'lib-2', content_hash: 'h2', active: false, primary_copy: 'Titanium frames, in store now.', landing_url: 'https://fernline.example/frames', first_seen: day(30), last_seen: day(3) },
];
const CI_LP = [
  { id: 1, workspace_id: WS, brand_name: 'Rival Optics', source: 'direct', url: 'https://rival.example/sale', url_hash: 'u1', content_hash: 'c1', captured_at: day(9) },
  { id: 2, workspace_id: WS, brand_name: 'Rival Optics', source: 'wayback', url: 'https://rival.example/sale', url_hash: 'u1', content_hash: 'c0', captured_at: day(200), source_link: 'https://web.archive.org/web/2026/https://rival.example/sale' },
];
const reader = (over) => async (q, key) => {
  const t = { own_ads: OWN, ci_ads: CI_ADS, ci_emails: [], ci_landing: CI_LP };
  if (over && key in over) { if (over[key] instanceof Error) throw over[key]; return over[key]; }
  expect(q, 'every read names the workspace').toContain('workspace_id=eq.' + WS);
  return t[key];
};

test('owned and competitor rows come back in one shape; another workspace\'s row is dropped; the same ad seen twice is linked; two captures of a page are versions', async () => {
  const out = await OBS.listFor(WS, { now: NOW, read: reader() });
  expect(out.count).toBe(6);
  const ids = out.observations.map((o) => o.observation_id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every((i) => i.startsWith(WS + ':'))).toBe(true);
  expect(out.observations.some((o) => /Another brand/.test(JSON.stringify(o)))).toBe(false);
  for (const o of out.observations) {
    expect(['owned', 'competitor']).toContain(o.ownership);
    expect(['active_as_reported', 'inactive_as_reported', 'not_confirmed', 'archive']).toContain(o.status);
    expect(o.provenance.table).toBeTruthy();
    expect(o.market).toBeNull();   // not recorded by any source: said, never guessed
    expect(o.market_note).toBeTruthy();
  }
  const own = out.observations.find((o) => o.observation_id.endsWith(':9001'));
  expect(own).toMatchObject({ ownership: 'owned', source: 'meta_account', status: 'active_as_reported', status_reported: 'ACTIVE', destination_url: 'https://fernline.example/frames?utm_source=meta' });
  expect(own.media).toEqual(['https://cdn.example/a.jpg']);          // the http video is not passed on
  expect(own.freshness).toEqual({ stale: false, days: 1 });
  // the platform returned no status for the Google ad: not confirmed, and it is stale
  const g = out.observations.find((o) => o.observation_id.endsWith(':g-7'));
  expect(g.status).toBe('not_confirmed');
  expect(g.freshness.stale).toBe(true);
  // the brand's own ad and its library listing are one asset, linked both ways
  const lib = out.observations.find((o) => /:lib-2:/.test(o.observation_id));
  expect(own.aliases).toEqual([lib.observation_id]);
  expect(lib.aliases).toEqual([own.observation_id]);
  expect(lib.status).toBe('not_confirmed');
  // captured text is text: nothing is stripped or run, and unsafe media is not passed on
  const rival = out.observations.find((o) => /:lib-1:/.test(o.observation_id));
  expect(rival.text).toContain('<script>');
  expect(rival.media).toEqual(['https://x.example/1.jpg']);
  expect(rival.aliases).toBeUndefined();
  // two captures of one page: versions, and the Wayback one is an archive
  const pages = out.observations.filter((o) => o.type === 'landing');
  expect(pages.map((p) => p.versions)).toEqual([2, 2]);
  expect(pages.find((p) => p.capture === 'wayback').status).toBe('archive');
  expect(pages.find((p) => p.capture === 'direct').status).toBe('not_confirmed');
});

test('review of #451: a paused or archived ad is not active; a changed creative keeps its own id under the same ad', async () => {
  for (const [word, state] of [['ACTIVE', 'active_as_reported'], ['enabled', 'active_as_reported'], ['PAUSED', 'inactive_as_reported'], ['ARCHIVED', 'inactive_as_reported'], ['DELETED', 'inactive_as_reported'], ['CAMPAIGN_PAUSED', 'inactive_as_reported'], ['', 'not_confirmed'], ['SOMETHING_NEW', 'not_confirmed']]) expect(OBS.reportedState(word), word).toBe(state);
  const paused = OBS.fromOwnAd(WS, Object.assign({}, OWN[0], { status: 'PAUSED' }), NOW);
  expect(paused).toMatchObject({ status: 'inactive_as_reported', status_reported: 'PAUSED' });
  const v1 = OBS.fromCiAd(WS, { ad_id: 'lib-9', content_hash: 'old', active: false, primary_copy: 'Old line' }, NOW);
  const v2 = OBS.fromCiAd(WS, { ad_id: 'lib-9', content_hash: 'new', active: true, primary_copy: 'New line' }, NOW);
  expect(v1.observation_id).not.toBe(v2.observation_id);
  expect([v1.version_of, v2.version_of]).toEqual(['lib-9', 'lib-9']);
});

test('each source says its own state: ok, no results, unavailable, partial, not read; an outage takes nothing from the others', async () => {
  const out = await OBS.listFor(WS, { now: NOW, read: reader({ ci_ads: new Error('store down') }) });
  const st = Object.fromEntries(out.sources.map((s) => [s.id, s]));
  expect(st.meta_account).toMatchObject({ state: 'ok', count: 1, stale: false });
  expect(st.google_ads_account).toMatchObject({ state: 'ok', count: 1, stale: true, days_since: 12 });
  expect(st.meta_ad_library.state).toBe('unavailable');
  expect(st.meta_ad_library.note).toMatch(/nothing already known was removed/);
  expect(st.capture_inbox.state).toBe('no_results');
  expect(st.landing_capture).toMatchObject({ state: 'ok', count: 2 });
  // what this repository does not read is said, with the route that is supported
  for (const id of ['tiktok_ads_account', 'google_ads_transparency', 'tiktok_library', 'milled']) {
    expect(st[id].state, id).toBe('not_read');
    expect(st[id].count, id).toBe(0);
    expect(st[id].coverage, id).toMatch(/Not read/);
  }
  expect(st.milled.coverage).toMatch(/robots\.txt/);
  expect(out.observations.filter((o) => o.source === 'meta_ad_library')).toEqual([]);
  expect(out.observations.length).toBe(4);
  // a page of rows as long as the limit is partial, and says so
  const part = await OBS.listFor(WS, { now: NOW, limit: 2, ownership: 'competitor', type: 'landing', read: reader() });
  expect(part.sources.map((s) => s.id)).toEqual(['landing_capture', 'manual_import'].filter((id) => part.sources.some((s) => s.id === id)));
  expect(part.sources.find((s) => s.id === 'landing_capture')).toMatchObject({ state: 'partial', note: 'Only the newest 2 are listed.' });
  expect(part.observations.every((o) => o.ownership === 'competitor' && o.type === 'landing')).toBe(true);
});

test('the route: sources need no workspace, a device brand is answered in words, a write is refused', async () => {
  const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
  const a = res(); await OBS.handle({ method: 'GET', query: { op: 'sources' } }, a, {});
  expect(a.code).toBe(200); expect(a.body.sources.length).toBe(OBS.SOURCES.length);
  const b = res(); await OBS.handle({ method: 'GET', query: { op: 'list' } }, b, { auth: { ok: true }, workspaceId: null });
  expect(b.body).toMatchObject({ ok: true, storage: 'device', count: 0 });
  const c = res(); await OBS.handle({ method: 'POST', query: { op: 'list' } }, c, { auth: { ok: true }, workspaceId: WS });
  expect(c.code).toBe(405);
  const d = res(); await OBS.handle({ method: 'GET', query: { op: 'delete' } }, d, {});
  expect(d.code).toBe(400);
});
