/**
 * Video works with NO API key: the code-rendered motion creative is the rung
 * every video producer falls to (2026-10-17).
 * ---------------------------------------------------------------------------
 * The operator wants every feature to work with no provider key. video-core
 * answered `not_connected` with a request stub, so the mailer asset agent left
 * its video and GIF slots as placeholders, the Social Media OS printed
 * "Render: stubbed - no video key set", and ?action=video-generate returned a
 * stub. scripts/lib/motion-ad.js already renders an animated 9:16 HTML
 * creative in code from the brand's own palette and real photos (Smart Brain
 * uses it); it is now the keyless rung everywhere. What this file EXECUTES:
 *
 *   1. video-core.generateVideo with no key and a fetch that throws: a
 *      code-motion answer carrying motion_html in THIS brand's name and
 *      palette, only the https photos and lines the caller passed, nothing of
 *      tenant zero's, mp4 null, and no network call;
 *   2. with a provider key, the provider path is taken (fetch stubbed to the
 *      provider host); with every configured provider failing, the creative
 *      still ships and the failure is said beside it;
 *   3. asset-agent.fillMailerAssets with no key: the video slot is DONE as the
 *      motion creative with the mailer's own photo as the email poster, the
 *      GIF slot is a still of that photo, and nothing is base64;
 *   4. (the shipped brain.js router, ?action=video-generate with no key, is a
 *      case in tests/router-brain.spec.js, where the meter and scoping run);
 *   5. social-core.runDaily with every model down: video posts carry the
 *      motion creative, its CSS intact (the brand scrub rewrites "transform");
 *   6. social-media.html in Chromium at 390 and 1280 px: the creative previews
 *      in a sandboxed frame from those bytes, no horizontal overflow.
 *
 * Run: npx playwright test tests/keyless-motion-video.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VC = require.resolve(path.join(ROOT, 'api', '_shared', 'video-core.js'));
const AA = require.resolve(path.join(ROOT, 'api', '_shared', 'asset-agent.js'));
const GC = require.resolve(path.join(ROOT, 'api', '_shared', 'gif-core.js'));
const SC = require.resolve(path.join(ROOT, 'api', '_shared', 'social-core.js'));
const LLM = require.resolve(path.join(ROOT, 'api', '_shared', 'llm.js'));
const MF = require(path.join(ROOT, 'api', '_shared', 'mailer-format.js'));

const VIDEO_KEYS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3', 'HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET', 'OPENMONTAGE_API_KEY', 'RUNWAY_API_KEY',
  'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY', 'GIF_CONVERT_URL'];

const BRAND = {
  id: 'ws-ozzlewick', slug: 'ozzlewick-kilns', name: 'Ozzlewick Kilns', tagline: 'Stoneware fired in the Ozzlewick yard',
  industry: 'ceramics', website: 'https://ozzlewick.example',
  palette: { primary: '#2A7F62', accent: '#C2410C', ink: '#1C1917', surface: '#FFFBF5' },
  typography: { heading: { family: 'Fraunces', stack: "'Fraunces',Georgia,serif" }, body: { family: 'Inter', stack: "'Inter',Arial,sans-serif" } },
  regions: [{ code: 'UK', currency: 'GBP', home: true }],
};
const PHOTO = 'https://cdn.ozzlewick.example/products/moss-jug.jpg';
// Tenant zero's own tokens: none may reach another brand's creative.
const FOREIGN = [/KNICKGASM/i, /#D0473E/i, /#6A33D8/i, /Montserrat/, /Instrument Sans/, /knickgasm-.*\.wav/, /Lace-up something better/];

/** Run fn with no provider key, no database and a fetch that records + refuses. */
async function keyless(fn, fetchImpl) {
  const saved = Object.fromEntries(VIDEO_KEYS.map((k) => [k, process.env[k]]));
  for (const k of VIDEO_KEYS) delete process.env[k];
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push(String(url));
    if (fetchImpl) return fetchImpl(String(url), init);
    throw new Error('network refused in this test: ' + url);
  };
  try { return await fn(calls); } finally {
    global.fetch = realFetch;
    for (const k of VIDEO_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
function fresh(file) { delete require.cache[file]; return require(file); }
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}

test('video-core with no key renders the code-motion creative in THIS brand, from only what the caller passed', async () => {
  await keyless(async (calls) => {
    const vc = fresh(VC);
    const prompt = 'HOOK: extreme close-up of the jug, dolly in, 0-2s';
    const out = await vc.generateVideo({ prompt, aspect: '9:16', brand: BRAND,
      motion: { images: [PHOTO, 'data:image/png;base64,AAAA', 'http://insecure.example/x.jpg'], lines: ['Glazed by hand in the yard.'], product: 'Moss Jug' } });
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('code-motion');
    expect(out.status).toBe('rendered');
    // No provider made an MP4; the story it carries is rendered to one in code on
    // request (code-video.js, 2026-10-26), so the hint is that route.
    expect(out.mp4).toMatchObject({ method: 'POST', url: '/api/public-config?action=video-render' });
    expect(out.story_html).toMatch(/var ALL = /);
    expect(out.video_url).toBeNull();
    expect(out.note).toMatch(/not an MP4/);
    expect(out.note).not.toMatch(/[–—]/);
    const h = out.motion_html;
    expect(typeof h).toBe('string');
    expect(h).toContain('Ozzlewick Kilns');
    expect(h).toContain(BRAND.palette.primary);
    expect(h).toContain("'Fraunces'");
    expect(h).toContain(PHOTO);
    expect(h).toContain('Glazed by hand in the yard.');
    expect(h).toContain('Moss Jug');
    expect(h, 'the provider prompt is a shot list, never on-screen copy').not.toContain('extreme close-up');
    expect(h, 'a data: image reached the creative').not.toMatch(/data:image/);
    expect(h, 'a non-https image reached the creative').not.toContain('insecure.example');
    for (const rx of FOREIGN) expect(h, 'tenant zero token ' + rx).not.toMatch(rx);
    expect(out.images_used).toEqual([PHOTO]);
    expect(out.motion_brief && out.motion_brief.shots.length).toBeGreaterThan(0);
    expect(out.would_request && out.would_request.provider, 'the request a key would send is still shown').toBeTruthy();
    expect(calls, 'the keyless rung made a network call').toEqual([]);

    // No photo and no line: the brand's own name on its own card, no image.
    const bare = await vc.generateVideo({ prompt, brand: BRAND });
    expect(bare.provider).toBe('code-motion');
    expect(bare.motion_html).not.toMatch(/<img\b/);
    expect(bare.motion_html).toMatch(/<h2[^>]*>Ozzlewick Kilns<\/h2>/);
    expect(bare.note).toMatch(/no photo was supplied/);

    // A status poll for the code rung has nothing to poll and says so.
    const st = await vc.getVideoStatus({ provider: 'code-motion', job_id: 'x' });
    expect(st.ok).toBe(true);
    expect(st.status).toBe('rendered');
  });
});

test('with a provider key the provider path is used; when every provider fails the creative ships and says so', async () => {
  await keyless(async (calls) => {
    process.env.RUNWAY_API_KEY = 'rk_test';
    const vc = fresh(VC);
    const out = await vc.generateVideo({ prompt: 'jug on a bench', aspect: '9:16', brand: BRAND, motion: { images: [PHOTO] } });
    expect(out.provider).toBe('runway');
    expect(out.job_id).toBe('task-123');
    expect(out.status).toBe('processing');
    expect(out.motion_html, 'a keyed provider answered, yet the code rung ran').toBeUndefined();
    expect(calls.some((u) => /api\.dev\.runwayml\.com\/v1\/image_to_video/.test(u))).toBe(true);
  }, async (url) => /runwayml\.com/.test(url) ? jsonResponse({ id: 'task-123' }) : jsonResponse({}, 404));

  await keyless(async () => {
    process.env.RUNWAY_API_KEY = 'rk_test';
    const vc = fresh(VC);
    const out = await vc.generateVideo({ prompt: 'jug on a bench', aspect: '9:16', brand: BRAND });
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('code-motion');
    expect(out.provider_error).toMatch(/runway: HTTP 500/);
    expect(out.note).toMatch(/every configured video provider failed/);
    expect(out.motion_html).toContain('Ozzlewick Kilns');
  }, async () => jsonResponse({ error: 'boom' }, 500));
});

test('asset-agent with no key: the video slot is the motion creative, the GIF slot a still of the mailer\'s own photo', async () => {
  const html = '<table><tr><td><img src="' + PHOTO + '" width="600" alt="Moss Jug"></td></tr><tr><td>' +
    MF.assetSlot({ kind: 'video', slot: 'hero-video', displayW: 300, displayH: 534, prompt: 'Slow push-in over the jug, steam rising' }) +
    '</td></tr><tr><td>' +
    MF.assetSlot({ kind: 'gif', slot: 'loop', displayW: 300, displayH: 300, prompt: 'The jug turning on a wheel' }) +
    '</td></tr></table>';
  await keyless(async (calls) => {
    fresh(VC); fresh(GC);
    const aa = fresh(AA);
    const out = await aa.fillMailerAssets(html, { brand: BRAND, persist: false });
    const vid = out.assets.find((a) => a.kind === 'video');
    expect(vid.status).toBe('done');
    expect(vid.format).toBe('motion_html');
    expect(vid.provider).toBe('code-motion');
    expect(vid.motion_html).toContain('Ozzlewick Kilns');
    expect(vid.motion_html).toContain(PHOTO);
    expect(vid.poster_url).toBe(PHOTO);
    const g = out.assets.find((a) => a.kind === 'gif');
    expect(g.status).toBe('done');
    expect(g.format).toBe('static_image');
    expect(g.url).toBe(PHOTO);
    expect(out.html).not.toContain(MF.PLACEHOLDER.video);
    expect(out.html).not.toContain(MF.PLACEHOLDER.gif);
    expect(out.html, 'an image was base64-embedded in the mailer').not.toMatch(/base64|data:image/);
    expect(out.html, 'the HTML creative was pasted into the email').not.toContain('@keyframes');
    expect(calls).toEqual([]);

    // A mailer with no photo: the creative is still made, the slots say so.
    const bare = await aa.fillMailerAssets(html.replace(/<img src="https[^>]*>/, ''), { brand: BRAND, persist: false });
    const v2 = bare.assets.find((a) => a.kind === 'video');
    expect(v2.status).toBe('done');
    expect(v2.poster_url).toBeNull();
    expect(v2.note).toMatch(/keeps its placeholder/);
    expect(bare.assets.find((a) => a.kind === 'gif').status).toBe('not_connected');
  });
});

/** social-core.runDaily for BRAND with every model down and no key. */
async function socialRun() {
  return keyless(async () => {
    const realLlm = require.cache[LLM];
    const real = require(LLM);
    const down = async () => { throw new Error('ALL PROVIDERS FAILED'); };
    Object.assign(down, real);
    require.cache[LLM] = { id: LLM, filename: LLM, loaded: true, exports: down };
    fresh(VC);
    delete require.cache[SC];
    try {
      return await require(SC).runDaily({ brand: BRAND, dry_run: true, date: '2026-10-20' });
    } finally {
      require.cache[LLM] = realLlm; delete require.cache[SC];
    }
  });
}

test('Social Media OS with no key and every model down: video posts carry the motion creative, CSS intact', async () => {
  const out = await socialRun();
  const vids = out.posts.filter((p) => p.media && p.media.type === 'video');
  expect(vids.length, 'no video post was built').toBeGreaterThan(1);
  for (const p of vids) {
    const v = p.media.video;
    expect(v.motion_html, p.key + ' carries no creative').toBeTruthy();
    expect(v.motion_html).toContain('Ozzlewick Kilns');
    expect(v.motion_html).toContain(BRAND.palette.primary);
    expect(v.motion_html, 'the brand scrub rewrote the creative\'s CSS').toMatch(/transform:/);
    for (const rx of FOREIGN) expect(v.motion_html, p.key + ' ' + rx).not.toMatch(rx);
    expect(v.job.provider).toBe('code-motion');
    expect(v.job.motion_html, 'the creative is carried twice').toBeUndefined();
  }
  for (const p of out.posts.filter((x) => !x.media || x.media.type !== 'video')) {
    expect(p.media && p.media.video && p.media.video.motion_html).toBeFalsy();
  }
  const step = out.trace.find((t) => t.step === '6-video');
  expect(step.source).toBe('code-motion:html');
});

test('social-media.html previews the creative in a sandboxed frame at 390 and 1280 px, with no horizontal overflow', async ({ page }) => {
  test.setTimeout(90_000);
  const out = await socialRun();
  const rows = out.posts.map((p, i) => ({ id: i + 1, date: p.date, platform: p.platform, format: p.format, payload: p, media: p.media, status: 'draft', push_status: p.push_status }));
  const nVideo = rows.filter((r) => r.media && r.media.type === 'video').length;

  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (/action=social-list/.test(req.url)) return res.end(JSON.stringify({ ok: true, persistence: true, posts: rows }));
      return res.end('{"ok":false,"error":"not in this test"}');
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort('failed'));
  try {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto(base + '/social-media.html', { waitUntil: 'load' });
      await page.locator('#loadBtn').click();
      await expect(page.locator('.mframe')).toHaveCount(nVideo, { timeout: 20_000 });
      const frameEl = page.locator('.mframe').first();
      await frameEl.scrollIntoViewIfNeeded();
      await expect(frameEl).toBeVisible();
      expect(await frameEl.getAttribute('sandbox'), 'the creative runs scripts in the page').toBe('');
      const handle = await frameEl.elementHandle();
      const frame = await handle.contentFrame();
      await expect(frame.locator('.stage')).toContainText('Ozzlewick Kilns');
      const box = await frameEl.boundingBox();
      expect(box.width).toBeGreaterThan(150);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      expect(box.height / box.width).toBeGreaterThan(1.6);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, 'horizontal overflow at ' + width + 'px').toBeLessThanOrEqual(0);
      await expect(page.locator('#cards')).not.toContainText('stubbed');
      await expect(page.locator('#cards')).toContainText('not an MP4');
      // Download hands over the same bytes the frame shows.
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button[data-dl-motion]').first().click()]);
      const file = await dl.path();
      expect(fs.readFileSync(file, 'utf8')).toBe(rows.find((r) => r.media && r.media.type === 'video').media.video.motion_html);
    }
    expect(errors).toEqual([]);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
