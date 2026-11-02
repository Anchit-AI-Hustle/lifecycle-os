// The /brain review strip (2026-11-02, Fastlane's bulk review): every built
// asset of the sends in view as thumbnails, Approve / Reject per send and
// "Approve all shown", through the EXISTING actions (smart-brain-approve and
// smart-brain-reject on /api/calendar). One request per send, one after
// another; a refusal (brand_changed here) is shown on that send in the
// server's own words and the rest go on.
//
// Executed: the shipped smart-brain.html in Chromium over a local server that
// answers the calendar actions in their documented shapes, at 1280 and 390.
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const STATIC = '<!doctype html><html><body><div class="ad" data-template="band" data-ratio="1:1">STATIC-AD</div></body></html>';
const PLAN = [0, 1, 2, 3].map((i) => ({
  id: `slot-${i}`, date: iso(i + 1), market: 'IN', status: 'tentative',
  cohort: { name: 'Engaged', size: 0 }, objective: 'Bring the reader back', heroProduct: { title: 'Calm Blend' },
  channels: ['email', 'landing_page', 'meta'], confidence: 0.5,
  // slot-3 has nothing built: it is not in the strip.
  ...(i < 3 ? { __prebuilt: { campaign_id: `camp-${i}` } } : {}),
}));
const campaignFor = (id) => ({ ok: true, campaign: { campaign_id: 'camp-' + id, assets: {
  email: { html: `<html><body>MAILER ${id}</body></html>`, variants: [{ label: 'Text', html: `<html><body>TEXT ${id}</body></html>` }] },
  ads: [{ platform: 'meta', variant: 'A', creative_type: 'static', creative: { static_html: STATIC } },
    { platform: 'tiktok', variant: 'A', creative_type: 'video', headline: 'A short video', creative: { image: 'https://cdn.calm.example.test/p.png' } }],
  landing_pages: [{ html: `<html><body>LANDING ${id}</body></html>` }] } } });

let server; let base; let log; let inflight; let maxInflight;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const [url, q] = (req.url || '/').split('?');
    if (url.startsWith('/api/')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const action = new URLSearchParams(q || '').get('action') || '';
        const b = body ? JSON.parse(body) : {};
        const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
        if (/^smart-brain-(preview|approve|reject)$/.test(action)) {
          log.push({ action, id: b.id }); inflight++; maxInflight = Math.max(maxInflight, inflight);
          return setTimeout(() => {
            inflight--;
            if (action === 'smart-brain-reject') return send(200, { ok: true });
            if (action === 'smart-brain-approve' && b.id === 'slot-1') return send(409, { ok: false, error: 'brand_changed', message: 'This send was planned for an earlier version of the brand record. Run Daily Sync to plan it again.' });
            return send(200, campaignFor(String(b.id).slice(5)));
          }, 60);
        }
        if (/smart-brain-plan/.test(action)) return send(200, { ok: true, plan: PLAN });
        return send(200, { ok: true, brand: null, needs_onboarding: false, workspaces: [] });
      });
      return;
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`the review strip shows each built send's assets and approves them one at a time (${vp.width})`, async ({ browser }) => {
    log = []; inflight = 0; maxInflight = 0;
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await page.goto(base + '/smart-brain.html');
    await page.waitForFunction(() => typeof PLAN !== 'undefined' && PLAN.length === 4, null, { timeout: 15000 });
    await page.locator('#rsLoad').click();
    await expect(page.locator('#rsItems [data-rs-slot]')).toHaveCount(3);
    await expect(page.locator('#rsProgress')).toContainText('3 sends shown');
    // Every kind, per send: mailer + its variant, a static, a video, a landing page.
    for (const id of ['slot-0', 'slot-1', 'slot-2']) {
      const s = page.locator(`[data-rs-slot="${id}"]`);
      await expect(s.locator('[data-rs-thumb="mailer"]')).toHaveCount(2);
      await expect(s.locator('[data-rs-thumb="static"]')).toHaveCount(1);
      await expect(s.locator('[data-rs-thumb="video"]')).toHaveCount(1);
      await expect(s.locator('[data-rs-thumb="landing"]')).toHaveCount(1);
    }
    expect(await page.locator('[data-rs-slot="slot-0"] [data-rs-thumb="static"] iframe').getAttribute('srcdoc')).toContain('STATIC-AD');
    expect(log.filter((x) => x.action === 'smart-brain-preview').map((x) => x.id)).toEqual(['slot-0', 'slot-1', 'slot-2']);
    // Reject one send: the existing reject action, with the in-page prompt.
    await page.locator('[data-rs-reject]').nth(2).click();
    await page.locator('[data-lc-dialog-ok]').click();
    await expect(page.locator('[data-rs-slot="slot-2"] .st.rejected')).toBeVisible();
    // Approve all shown: one request per send, in order, never two at once;
    // the refused one says why, the other is approved.
    log.length = 0;
    await page.locator('#rsApproveAll').click();
    await page.locator('#sbcy').click();
    await expect(page.locator('#rsProgress')).toContainText('Approve all shown: 1 approved, 1 refused');
    expect(log.map((x) => x.action + ':' + x.id)).toEqual(['smart-brain-approve:slot-0', 'smart-brain-approve:slot-1']);
    expect(maxInflight, 'two requests at once').toBe(1);
    await expect(page.locator('[data-rs-slot="slot-1"] [data-rs-say]')).toContainText('planned for an earlier version of the brand record');
    await expect(page.locator('[data-rs-slot="slot-1"] [data-rs-say]')).toHaveAttribute('data-kind', 'err');
    await expect(page.locator('[data-rs-slot="slot-0"] .st.approved')).toBeVisible();
    await expect(page.locator('[data-rs-slot="slot-0"] [data-rs-approve]')).toHaveCount(0);
    // The refused send keeps its own Approve.
    await expect(page.locator('[data-rs-slot="slot-1"] [data-rs-approve]')).toHaveCount(1);
    // The strip itself never runs off the side of a phone (its thumbnails
    // scroll inside their own row).
    const wide = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      return [...document.querySelectorAll('#calcard, #reviewstrip, #reviewstrip .rs-slot, #reviewstrip .rs-thumbs, #reviewstrip .rs-slot-head, #reviewstrip button')]
        .filter((e) => e.getBoundingClientRect().right > vw + 1 || e.getBoundingClientRect().left < -1).map((e) => e.className || e.id || e.tagName);
    });
    expect(wide, 'past the edge of the screen').toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(1);
    // A colour literal in the strip's own rules would ignore the brand.
    const stripRules = await page.evaluate(() => [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch (_) { return []; } }).map((r) => r.cssText).filter((t) => t.includes('#reviewstrip')).join('\n'));
    expect(stripRules.length).toBeGreaterThan(100);
    expect(stripRules).not.toMatch(/#[0-9a-f]{3,8}\b(?![\w-])|rgba?\(/i);
    await ctx.close();
  });
}
