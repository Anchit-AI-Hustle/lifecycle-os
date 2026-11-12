// @ts-check
/**
 * A Smart Brain day, in full (2026-11-12). The operator: "open detailed page
 * must open detail page with all assets for that day", "cant see scheduled
 * sending and publishing of assets on the respective platforms ... for each
 * day", "download all must download all assets for all days generated - not
 * just the first day and the last day", "too congested and ensure perfect
 * level alignment for all assets", "unable to select india alone".
 *
 * Executed: the shipped builder makes a send, brain-publish.plan() is run over
 * it, and the real page is driven in Chromium.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');
const ROOT = path.resolve(__dirname, '..');
const KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'FREE_GENERATION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'ANTHROPIC_BASE_URL'];
const BP = require(path.join(ROOT, 'api', '_shared', 'brain-publish.js'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const FOUNDATION = { sku: 'S1', title: 'Kay Beauty Hydrating Foundation 30ml', handle: 'p1', image: 'https://www.nykaa.com/img/1.jpg', price: 1399, compare_at: 1599, url: 'https://www.nykaa.com/products/p1', category: 'Foundation', description: '<p>A lightweight liquid foundation with medium buildable coverage.</p><p>Enriched with hyaluronic acid to keep skin hydrated for up to 12 hours.</p>' };

function brand() { const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'presets', 'nykaa.json'), 'utf8')); b.id = 'device:nykaa'; b.regions = [{ code: 'IN', currency: 'INR', home: true, store_url: b.website }]; return b; }
let built = null;
async function build() {
  if (built) return built;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.FREE_GENERATION = 'off';
  const realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error(`network blocked: ${u}`); };
  try {
    const { smartConfig } = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
    const entry = { id: 'day-1', date: '2026-11-14', market: 'IN', objective: 'reactivation', brand: brand(), cohort: { name: 'At Risk', size: 1500, rules: ['r'] }, channels: ['email', 'meta', 'google', 'tiktok', 'landing_page'], confidence: 0.6, heroProduct: FOUNDATION };
    const campaign = await require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js')).buildCampaign(entry, smartConfig({}), { noLLM: true, withCreatives: false });
    built = { campaign, entry };
    return built;
  } finally {
    global.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
function serve() {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, p === '/' ? 'index.html' : p.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

test('the day\'s schedule: every asset has a row saying where it goes, when in the brand\'s own zone, and its state', async () => {
  const { campaign, entry } = await build();
  const now = Date.parse('2026-11-12T06:00:00Z');
  const b = brand();
  // Not approved, nothing connected: nothing is "ready", and nothing claims to be scheduled.
  const draft = BP.plan(entry, campaign, b, { connections: {}, jobs: [], now, status: 'tentative' });
  const by = (p, id) => p.rows.find((r) => r.id === id);
  expect(draft.approved).toBe(false);
  expect(by(draft, 'email').state).toBe('not_connected');
  expect(by(draft, 'email').when).toBe('2026-11-14 09:30 Asia/Kolkata');
  expect(by(draft, 'email').scheduled_for).toBe('2026-11-14T04:00:00.000Z');
  expect(by(draft, 'social_x').state).toBe('no_channel');
  expect(by(draft, 'social_x').message).toMatch(/X has no publishing adapter/);
  expect(by(draft, 'social_linkedin')).toMatchObject({ state: 'not_connected', channel: 'linkedin_post' });
  expect(by(draft, 'ads_meta').state).toBe('manual');
  expect(by(draft, 'ads_meta').fix).toBe('/publishing?tab=launch');
  expect(by(draft, 'landing').state).toBe('awaiting_approval');
  expect(draft.rows.filter((r) => r.state === 'scheduled' || r.state === 'sent' || r.state === 'ready')).toEqual([]);
  // one row per social post, every paid platform once
  expect(draft.rows.filter((r) => r.kind === 'social').length).toBe(campaign.assets.social_posts.length);
  expect(new Set(draft.rows.map((r) => r.id)).size).toBe(draft.rows.length);

  // Approved, Meta connected, one job already queued: Facebook says scheduled, Instagram is ready.
  const meta = { status: 'active', external_account_label: 'Nykaa Page' };
  const jobs = [{ id: 'j1', status: 'queued', idempotency_key: BP.keyFor('day-1', 'social_facebook'), scheduled_for: '2026-11-14T07:30:00.000Z' }];
  const live = BP.plan(entry, campaign, b, { connections: { meta_ads: meta }, jobs, now, status: 'approved' });
  expect(by(live, 'social_facebook').state).toBe('scheduled');
  expect(by(live, 'social_facebook').message).toMatch(/Scheduled on Facebook \(Nykaa Page\)/);
  expect(by(live, 'social_instagram_feed').state).toBe('ready');
  // a Reel needs a hosted video file this send does not have: said, never queued
  expect(by(live, 'social_instagram_reels').state).toBe('needs_media');
  expect(by(live, 'landing').state).toBe('live');
  expect(by(live, 'landing').fix).toBe('/lp/' + encodeURIComponent(campaign.campaign_id));
  expect(live.summary.scheduled).toBe(1);
  // Klaviyo connected with a key only: no audience or sender, so the mail is not "ready"
  const key = BP.plan(entry, campaign, b, { connections: { klaviyo: { status: 'active' } }, jobs: [], now, status: 'approved' });
  expect(by(key, 'email').state).toBe('needs_setup');
  expect(by(key, 'email').fix).toBe('/publishing');
  const full = BP.plan(entry, campaign, b, { connections: { klaviyo: { status: 'active', config: { list_id: 'L1', from_email: 'hello@nykaa.example' } } }, jobs: [], now, status: 'approved' });
  expect(by(full, 'email').state).toBe('ready');
  // a job the gate held back is said as held back, with its reason
  const held = BP.plan(entry, campaign, b, { connections: { meta_ads: meta }, jobs: [{ id: 'j2', status: 'blocked', idempotency_key: BP.keyFor('day-1', 'social_facebook'), last_error: 'publishing is off for this brand' }], now, status: 'approved' });
  expect(by(held, 'social_facebook').state).toBe('withheld');
  expect(by(held, 'social_facebook').message).toMatch(/publishing is off for this brand/);
  // a connection that needs signing in again is not "ready"
  const stale = BP.plan(entry, campaign, b, { connections: { meta_ads: { status: 'needs_reauth' } }, jobs: [], now, status: 'approved' });
  expect(by(stale, 'social_facebook').state).toBe('needs_reauth');
});

test('the page: an aligned grid, the schedule table, the day\'s detail page with every asset, the ZIP of every built day, and markets that tick one by one', async ({ page }) => {
  const { campaign: c, entry } = await build();
  const server = await serve();
  const pub = Object.assign({ ok: true, stored: true, built: true, status: 'approved' }, BP.plan(entry, c, brand(), { connections: { meta_ads: { status: 'active', external_account_label: 'Nykaa Page' } }, jobs: [], status: 'approved' }));
  const previewAsked = [];
  const scheduled = [];
  try {
    await page.route(/\/api\//, (route) => {
      const req = route.request(); const url = req.url();
      if (/dispatch-slot/.test(url)) {
        if (req.method() === 'POST') { scheduled.push(url); const after = JSON.parse(JSON.stringify(pub)); after.rows.forEach((r) => { if (r.state === 'ready') { r.state = 'scheduled'; r.message = 'Scheduled.'; } }); after.summary.scheduled = after.summary.ready; after.summary.ready = 0; after.results = [{ ok: true }]; after.message = 'scheduled'; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(after) }); }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(pub) });
      }
      if (/smart-brain-preview/.test(url)) { previewAsked.push(JSON.parse(req.postData() || '{}').id); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, persisted: true, campaign: c }) }); }
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"offline"}' });
    });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/smart-brain.html`);
    await page.waitForFunction(() => typeof renderPreview === 'function');   // eslint-disable-line no-undef
    await page.waitForFunction(() => [...document.styleSheets].some((s) => /theme\.css/.test(s.href || '')));
    await page.evaluate((campaign) => {
      const host = document.createElement('div'); host.id = 'day-host'; document.body.appendChild(host);
      // eslint-disable-next-line no-undef
      renderPreview({ campaign }, { id: 'day-1', date: '2026-11-14', channels: ['email', 'meta', 'landing_page'], status: 'approved' }, 0, { target: host });
    }, JSON.parse(JSON.stringify(c)));

    // 1. LEVEL ALIGNMENT: in each kind, the cards of one row start on one line
    //    and their headings end on one line; cards never touch.
    for (const g of ['mail', 'ads', 'social', 'site']) {
      await page.locator(`#day-host .pvgroups .pvtab[data-group="${g}"]`).click();
      await page.waitForTimeout(400);
      const cards = await page.locator(`#day-host .pvgroup-${g} > .pvsec`).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); const h = el.querySelector('.pvsech').getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), headBottom: Math.round(h.bottom) }; }));
      expect(cards.length, g).toBeGreaterThan(1);
      const rows = {};
      for (const k of cards) (rows[k.top] = rows[k.top] || []).push(k);
      const multi = Object.values(rows).filter((r) => r.length > 1);
      expect(multi.length, `${g}: no two cards share a row`).toBeGreaterThan(0);
      for (const r of multi) {
        expect(new Set(r.map((k) => k.headBottom)).size, `${g}: headings of one row end on different lines`).toBe(1);
        r.sort((a, b) => a.left - b.left);
        for (let n = 1; n < r.length; n++) expect(r[n].left - r[n - 1].right, `${g}: cards touch`).toBeGreaterThanOrEqual(20);
      }
      // every card of the kind starts on a row line some other card may share: tops come from the grid, not from a column flow
      const tops = [...new Set(cards.map((k) => k.top))];
      expect(tops.length, `${g}: one card per line is a column flow`).toBeLessThan(cards.length);
    }

    // 2. THE SCHEDULE: a row per asset, and the press that queues what is ready.
    await page.locator('#day-host .pvgroups .pvtab[data-group="pub"]').click();
    await expect(page.locator('#day-host [data-pub-table] tr[data-pub-row]')).toHaveCount(pub.rows.length);
    await expect(page.locator('#day-host tr[data-pub-row="social_facebook"]')).toContainText('Ready to schedule');
    await expect(page.locator('#day-host tr[data-pub-row="email"]')).toContainText('Not connected');
    await expect(page.locator('#day-host tr[data-pub-row="social_facebook"]')).toContainText('Asia/Kolkata');
    await page.locator('#day-host [data-pub-schedule]').click();
    await expect(page.locator('#day-host tr[data-pub-row="social_facebook"]')).toContainText('Scheduled');
    expect(scheduled.length).toBe(1);
    await expect(page.locator('#day-host [data-pub-schedule]')).toHaveCount(0);

    // 3. THE DAY'S DETAIL PAGE: every asset of every send of that date. The
    //    second send of the day is built on the server and not opened here: it
    //    is read, not skipped.
    await page.evaluate((campaign) => {
      /* eslint-disable no-undef */
      PLAN.length = 0;
      PLAN.push({ id: 'day-1', date: '2026-11-14', market: 'IN', cohort: { name: 'At Risk' }, channels: ['email'], status: 'approved', generated_campaign_id: 'c1' });
      PLAN.push({ id: 'day-2', date: '2026-11-14', market: 'IN', cohort: { name: 'Champions' }, channels: ['email'], status: 'approved', generated_campaign_id: 'c2' });
      PLAN.push({ id: 'day-3', date: '2026-11-15', market: 'IN', cohort: { name: 'Loyal' }, channels: ['email'], status: 'approved', generated_campaign_id: 'c3' });
      PLAN.push({ id: 'day-4', date: '2026-11-16', market: 'IN', cohort: { name: 'New' }, channels: ['email'], status: 'tentative' });
      for (const k of Object.keys(PREVIEW_CACHE)) delete PREVIEW_CACHE[k];
      PREVIEW_CACHE['day-1'] = { ok: true, campaign };
      /* eslint-enable no-undef */
    }, JSON.parse(JSON.stringify(c)));
    await page.locator('#day-host [data-open-detail]').click();
    const A = c.assets;
    const perSend = A.email.variants.length + A.landing_pages.length + A.ads.length + A.social_posts.length + Object.keys(A.onsite).length + A.display_banners.length;
    await expect(page.locator('#sbdetail [data-detail-count]')).toHaveText(`${perSend * 2} assets · 2 sends`);
    expect(previewAsked).toEqual(['day-2']);
    const kinds = await page.locator('#sbdetail [data-detail-kind]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-detail-kind')))]);
    expect(kinds).toEqual(['mail', 'lp', 'ads', 'social', 'site', 'display']);
    await expect(page.locator('#sbdetail [data-detail-card="social"]')).toHaveCount(A.social_posts.length * 2);
    await expect(page.locator('#sbdetail [data-detail-card="display"]')).toHaveCount(A.display_banners.length * 2);
    // the documents are really there: the first mailer's frame holds the mail
    await expect.poll(async () => page.locator('#sbdetail [data-detail-card="mail"] iframe').first().evaluate((f) => (f.contentDocument && f.contentDocument.body ? f.contentDocument.body.innerText.length : 0))).toBeGreaterThan(100);
    // cards of the first row of mailers start on one line
    const tops = await page.locator('#sbdetail .dgrid').first().locator('.dcard').evaluateAll((els) => els.slice(0, 2).map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(tops[0]).toBe(tops[1]);
    const [day] = await Promise.all([page.waitForEvent('download'), page.locator('#sbdetail-dl').click()]);
    expect(day.suggestedFilename()).toMatch(/2026-11-14-all-assets\.html$/);
    // the day's file holds the text assets too, not only the framed documents
    expect((fs.readFileSync(await day.path(), 'utf8').match(/<iframe /g) || []).length).toBe(perSend * 2);
    await page.locator('#sbdetail-x').click();
    await expect(page.locator('#sbdetail')).toHaveCount(0);

    // 4. DOWNLOAD ALL: every built day, opened here or not; the unbuilt one is named.
    //    Two more sends share day-3's date AND cohort (another market, and a
    //    second send of that cohort): before the audit of 2026-11-12 all three
    //    wrote the same paths and the archive kept one of them.
    await page.evaluate(() => {
      /* eslint-disable no-undef */
      PLAN.push({ id: 'day-5', date: '2026-11-15', market: 'US', cohort: { name: 'Loyal' }, channels: ['email'], status: 'approved', generated_campaign_id: 'c5' });
      PLAN.push({ id: 'day-6', date: '2026-11-15', market: 'IN', cohort: { name: 'Loyal' }, channels: ['email'], status: 'approved', generated_campaign_id: 'c6' });
      setDur('all');
      /* eslint-enable no-undef */
    });
    previewAsked.length = 0;
    const [zip] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { window.sbZipAll(); })]);
    expect(previewAsked.slice().sort()).toEqual(['day-3', 'day-5', 'day-6']);   // day-2 was read by the detail page; day-4 has nothing built
    const names = fs.readFileSync(await zip.path()).toString('latin1');
    for (const d of ['2026-11-14_in_at-risk_day-1/', '2026-11-14_in_champions_day-2/', '2026-11-15_in_loyal_day-3/', '2026-11-15_us_loyal_day-5/', '2026-11-15_in_loyal_day-6/']) expect(names, d).toContain(d);
    // no path is used twice, and the manifest lists every file of every send with its digest
    const last = await page.evaluate(() => window.__SB_LAST_ZIP);
    expect(last.sends).toBe(5);
    expect(new Set(last.files.map((f) => f.toLowerCase())).size, 'a ZIP path is used twice').toBe(last.files.length);
    const buf = fs.readFileSync(await zip.path());
    const at = buf.indexOf(Buffer.from('{\n  "manifest": "smart-brain.zip.v1"'));
    expect(at, 'manifest.json is in the archive').toBeGreaterThan(0);
    const text = buf.slice(at).toString('utf8');
    const manifest = JSON.parse(text.slice(0, text.indexOf('\n}') + 2));
    expect(manifest.sends.map((x) => x.slot_id)).toEqual(['day-1', 'day-2', 'day-3', 'day-5', 'day-6']);
    const listed = manifest.sends.flatMap((x) => x.files).concat(manifest.top_level);
    expect(listed.length).toBe(manifest.files);
    expect(listed.map((f) => f.path).sort()).toEqual(last.files.filter((f) => f !== 'manifest.json').sort());
    for (const f of listed) { expect(f.sha256, f.path).toMatch(/^[0-9a-f]{64}$/); expect(f.bytes).toBeGreaterThan(0); }
    // the digest is the file's own: the first mailer of day-1, hashed again here
    const one = manifest.sends[0].files.find((f) => /mailer_/.test(f.path));
    const start = buf.indexOf(Buffer.from(one.path)) + Buffer.byteLength(one.path);
    expect(require('crypto').createHash('sha256').update(buf.slice(start, start + one.bytes)).digest('hex')).toBe(one.sha256);
    expect(manifest.sends[0].assets).toBe(perSend);
    expect(names).not.toContain('2026-11-16');
    expect(names).toContain('social_instagram-feed.txt');
    expect(names).toContain('banner_300x250.html');
    await expect(page.locator('#calstate')).toContainText('1 send has no assets yet');
  } finally { server.close(); }
});

test('an approved send says which assets were added after its approval and holds them until they are approved; a rebuilt draft says it is not approved', async ({ page }) => {
  const { campaign: c } = await build();
  const server = await serve();
  const asked = [];
  try {
    await page.route(/\/api\//, (route) => {
      const req = route.request(); const url = req.url();
      if (/smart-brain-approve-additions/.test(url)) { asked.push(JSON.parse(req.postData() || '{}')); return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'day-1', added: ['social_posts', 'onsite'], approved_at: '2026-11-12T07:00:00Z', approved_by: null }) }); }
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"offline"}' });
    });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/smart-brain.html`);
    await page.waitForFunction(() => typeof renderPreview === 'function');   // eslint-disable-line no-undef
    const show = (campaign, extra, status) => page.evaluate(({ campaign: cc, extra: x, status: st }) => {
      /* eslint-disable no-undef */
      let host = document.getElementById('rev-host'); if (host) host.remove();
      host = document.createElement('div'); host.id = 'rev-host'; document.body.appendChild(host);
      PLAN.length = 0; PLAN.push({ id: 'day-1', date: '2026-11-14', market: 'IN', cohort: { name: 'At Risk' }, channels: ['email'], status: st });
      renderPreview(Object.assign({ campaign: cc }, x || {}), PLAN[0], 0, { target: host });
      /* eslint-enable no-undef */
    }, { campaign, extra, status });

    // as approved: no note at all
    await show(JSON.parse(JSON.stringify(c)), null, 'approved');
    await expect(page.locator('#rev-host [data-revision]')).toHaveCount(0);
    // the decision behind each asset is on the page: one row per asset, the
    // state said in words, and what was observed never labelled measured
    const dec = page.locator('#rev-host details.pvdecision');
    await expect(dec).toHaveAttribute('data-decision-state', 'provisional');
    await dec.locator('summary').click();
    await expect(dec.locator('[data-decision-asset]')).toHaveCount(c.decisions.count);
    await expect(dec.locator('[data-decision-note]')).toContainText('No measured result of this brand');
    await expect(dec.locator('[data-evidence-basis="measured"]')).toHaveCount(0);
    await expect(dec.locator('[data-decision-digest]')).toHaveText(c.decisions.manifest_digest);
    if (process.env.AUDIT_SHOTS) await dec.screenshot({ path: require('path').join(process.env.AUDIT_SHOTS, 'brain-decision-record.png') });
    expect(await dec.locator('[data-decision-table]').evaluate((t) => t.scrollWidth <= t.parentElement.clientWidth + 1 || getComputedStyle(t.parentElement).overflowX === 'auto')).toBe(true);

    // kinds added after approval: said, with the press that approves them
    const added = Object.assign(JSON.parse(JSON.stringify(c)), { assets_added_on_view: ['social_posts', 'onsite'] });
    await show(added, null, 'approved');
    const note = page.locator('#rev-host [data-revision]');
    await expect(note).toHaveAttribute('data-revision', 'additions-pending');
    await expect(note).toContainText('Added after approval: social posts, on-site assets');
    await expect(note).toContainText('exactly as approved');
    if (process.env.AUDIT_SHOTS) await note.screenshot({ path: require('path').join(process.env.AUDIT_SHOTS, 'brain-added-after-approval.png') });
    await note.locator('[data-approve-additions]').click();
    await expect(note).toHaveAttribute('data-revision', 'additions-approved');
    expect(asked).toEqual([{ id: 'day-1', reviewer: null }]);

    // a draft is never told it has "additions": the whole send still awaits approval
    await show(added, null, 'tentative');
    await expect(page.locator('#rev-host [data-revision]')).toHaveCount(0);

    // approved assets no longer stored: a new draft, and it says so
    await show(JSON.parse(JSON.stringify(c)), { approved_assets_missing: true }, 'approved');
    await expect(page.locator('#rev-host [data-revision]')).toHaveAttribute('data-revision', 'recovered-draft');
    await expect(page.locator('#rev-host [data-revision]')).toContainText('New draft, not approved');
  } finally { server.close(); }
});

test('the plan\'s own market filter is marked as bound to the shared selection, so the rail never clicks it back on', async ({ page }) => {
  const server = await serve();
  try {
    await page.route(/\/api\//, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/smart-brain.html`);
    await page.waitForFunction(() => window.RegionContext && typeof renderPreview === 'function');   // eslint-disable-line no-undef
    await expect(page.locator('#mktfilter')).toHaveAttribute('data-region-own', '');
    // the run's period is offered in the Agentic card too, and opens on the next 7 days
    await expect(page.locator('#agenticDur .mkchip.on')).toHaveText('Next 7 days');
    await page.locator('#agenticDur .mkchip[data-dur="30"]').click();
    await expect(page.locator('#durfilter .mkchip.on')).toHaveText('30 days');
  } finally { server.close(); }
});
