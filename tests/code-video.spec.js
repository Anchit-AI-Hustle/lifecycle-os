// A real video FILE made in code, with no key, no model and no ffmpeg (2026-10-26).
// The operator: "Ensure videos are also created if no hugging face key is also
// provided. Figure out how to generate the videos using code, do proper
// competitive benchmarking and research on it, and then implement."
// (benchmark: docs/code-video-benchmark.md)
//
// Executed: the shipped renderer (api/_shared/code-video.js) draws the Story
// video frame by frame in Chromium and encodes it with WebCodecs + Mediabunny;
// the file it returns is then DECODED again in Chromium and its frames read
// back (duration, size, and the pixels of a product scene: the photo the
// server fetched, not the brand colour). Plus the route's doors, the story
// data validation and the /brain button.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CV = require(path.join(ROOT, 'api', '_shared', 'code-video.js'));
const SA = require(path.join(ROOT, 'scripts', 'lib', 'story-ad.js'));

// A photo that is unmistakably not the brand's colour: solid green.
const GREEN_PNG = (() => {
  const zlib = require('zlib');
  const w = 64, h = 64, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 0; raw[o + 1] = 200; raw[o + 2] = 0; } }
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();
const PRIMARY = '#7a3b1f';
const story = (images) => SA.renderStoryAd({
  brand: { name: 'Fernwick Roasters' }, brandName: 'Fernwick Roasters', hook: 'Fresh this week',
  palette: { primary: PRIMARY, on_primary: '#ffffff', accent: '#fffaf2', on_accent: '#2b1a10', surface: '#fffaf2', ink: '#2b1a10' },
  products: [{ title: 'House blend', price_text: '£9', image: images[0] }, { title: 'Dark roast', price_text: '£10', image: images[1] }],
  lines: ['Roasted on Tuesdays'], cta: 'Shop now',
});
const OK_URL = 'https://img.example/green.png';
const BAD_URL = 'https://img.example/missing.png';
const allow = async () => true;
const fakeFetch = (calls) => async (url) => {
  calls.push(url);
  if (url === OK_URL) return new Response(GREEN_PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  if (url === 'https://img.example/page.html') return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response('nope', { status: 404 });
};

// Decode a file in Chromium and read back what a player sees: the frame AT a
// time, decoded by Mediabunny's own reader (WebCodecs VideoDecoder) rather
// than a <video> seek, whose landing frame varies with the browser.
const MB_SRC = fs.readFileSync(path.join(ROOT, 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.min.cjs'), 'utf8');
async function inspect(page, buf, mime, at) {
  // A secure context (WebCodecs needs one) on a host that is never fetched.
  await page.route('https://inspect.invalid/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/v') return route.fulfill({ status: 200, contentType: mime, body: buf });
    if (u.pathname === '/mb.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: MB_SRC });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>i</title>' });
  });
  await page.goto('https://inspect.invalid/');
  await page.addScriptTag({ url: 'https://inspect.invalid/mb.js' });
  return page.evaluate(async (at) => {
    const M = window.Mediabunny;
    const data = await (await fetch('/v')).arrayBuffer();
    const input = new M.Input({ source: new M.BufferSource(data), formats: M.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    const duration = await input.computeDuration();
    const sink = new M.CanvasSink(track);
    const px = [];
    for (const t of at) {
      const w = await sink.getCanvas(t);
      const c = w.canvas, x = c.getContext('2d');
      // A point in the photo area, clear of the text and the progress bar.
      px.push(Array.from(x.getImageData(Math.round(c.width * 0.85), Math.round(c.height * 0.35), 1, 1).data.slice(0, 3)));
    }
    return { duration, width: track.displayWidth, height: track.displayHeight, px };
  }, at);
}
const near = (a, b, d) => a.every((v, i) => Math.abs(v - b[i]) <= d);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test('the story is rendered to a real video file in code: the photo the server fetched is in the product scene, the brand colour where no photo came', async ({ page }) => {
  test.setTimeout(240000);
  const calls = [];
  const html = story([OK_URL, BAD_URL]);
  const r = await CV.renderStoryVideo({ html, size: '540p', fetchImpl: fakeFetch(calls), assertUrl: allow });
  expect(r.ok, r.message).toBe(true);
  expect(['video/mp4', 'video/webm']).toContain(r.mime);
  expect(r.codec).toBe(r.container === 'mp4' ? 'H.264' : 'VP9');
  expect(r.fps).toBe(24);
  expect(r.frames).toBe(Math.round(r.seconds * 24));
  expect(r.bytes).toBeLessThan(CV.MAX_BYTES_OUT);
  expect(r.images.used).toBe(1);
  expect(r.images.refused).toEqual([{ url: BAD_URL, why: 'HTTP 404' }]);
  // The container is what it says it is.
  const head = r.buffer.subarray(0, 12).toString('latin1');
  if (r.container === 'mp4') expect(head.slice(4, 8)).toBe('ftyp'); else expect(r.buffer.readUInt32BE(0)).toBe(0x1a45dfa3);
  test.skip(r.container === 'mp4' && !/sparticuz/.test(r.browser.source), 'an H.264 file needs a Chromium that decodes it');
  // Scene times: the first product (the green photo) and the second (no photo: brand colour).
  const scenes = SA.storyDataFrom(html).cuts.full.scenes;
  const p1 = scenes.find((x) => x.image === OK_URL), p2 = scenes.find((x) => x.image === BAD_URL);
  const seen = await inspect(page, r.buffer, r.mime, [p1.start + p1.seconds / 2, p2.start + p2.seconds / 2]);
  expect(seen.width).toBe(540);
  expect(seen.height).toBe(960);
  expect(Math.abs(seen.duration - r.seconds)).toBeLessThan(0.25);
  expect(near(seen.px[0], [0, 200, 0], 60), 'product scene shows the fetched photo: ' + seen.px[0]).toBe(true);
  expect(near(seen.px[1], rgb(PRIMARY), 40), 'a scene whose photo was refused shows the brand colour: ' + seen.px[1]).toBe(true);
});

test('only the story\'s own photos are fetched, behind the URL guard, and only images', async () => {
  test.setTimeout(180000);
  const calls = [];
  // A page, a private host and a 404: none becomes a picture.
  const html = story(['https://img.example/page.html', 'http://127.0.0.1/secret.png']);
  const r = await CV.renderStoryVideo({ html, size: '540p', cut: 'short', fetchImpl: fakeFetch(calls) });
  expect(r.ok, r.message).toBe(true);
  expect(r.images.used).toBe(0);
  const why = Object.fromEntries(r.images.refused.map((x) => [x.url, x.why]));
  expect(why['https://img.example/page.html']).toMatch(/not an image \(text\/html\)|could not|resolve|ENOTFOUND|public/i);
  expect(why['http://127.0.0.1/secret.png']).toBeTruthy();
  // The private address never reached the network.
  expect(calls).not.toContain('http://127.0.0.1/secret.png');
  // The fetcher the page's other requests would need is never asked for anything else.
  expect(calls.every((u) => u === 'https://img.example/page.html')).toBe(true);
});

test('the page rendered is rebuilt from validated story data, never markup a request supplied', () => {
  const html = story([OK_URL, BAD_URL]);
  const d = SA.storyDataFrom(html);
  expect(d.cuts.full.scenes.map((x) => x.kind)).toEqual(['hook', 'product', 'product', 'line', 'end']);
  expect(SA.storyPage(SA.storyDataFrom(SA.storyPage(d)))).toBe(SA.storyPage(d));
  // Something that is not a story is refused.
  expect(SA.storyDataFrom('<html><script>alert(1)</script></html>')).toBeNull();
  // A tampered story: a script in a headline stays text, a javascript: image is dropped, a font cannot close the style.
  const evil = html.replace('"headline":"Fresh this week"', '"headline":"</script><script>alert(1)</script>"')
    .replace('"image":"' + OK_URL + '"', '"image":"javascript:alert(1)"')
    .replace(/"head":"[^"]*"/, '"head":"x;}</style><script>alert(2)</script>"');
  const e = SA.storyDataFrom(evil);
  expect(e).not.toBeNull();
  expect(e.cuts.full.scenes[0].image).toBeUndefined();
  const page = SA.storyPage(e);
  expect(page).not.toMatch(/<script>alert/);
  expect(e.fonts.head).not.toMatch(/[<>;{}]/);
  // A story longer than 30 seconds is not a story this app makes.
  const long = html.replace(/"seconds":[\d.]+/g, '"seconds":9');
  expect(SA.storyDataFrom(long)).toBeNull();
});

test('a render that cannot finish inside its time is stopped and said, never cut off by the platform', async () => {
  test.setTimeout(120000);
  const r = await CV.renderStoryVideo({ html: story([OK_URL, OK_URL]), size: '1080p', budgetMs: 9000, fetchImpl: fakeFetch([]), assertUrl: allow });
  expect(r.ok).toBe(false);
  expect(r.error).toBe('too_slow');
  expect(r.tried[0]).toMatch(/^1080p \(projected \d+ s at 1080x1920\)$/);
  expect(r.message).toMatch(/could not render the video in time/);
});

function call(handle, { method = 'POST', headers = {}, body = {} } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, removeHeader(k) { delete this.headers[k.toLowerCase()]; },
      status(c) { this.statusCode = c; return this; }, json(o) { resolve({ status: this.statusCode, headers: this.headers, json: o }); return this; },
      end(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); return this; },
    };
    handle({ method, headers: Object.assign({ host: 'app.example.test' }, headers), query: { action: 'video-render' }, body, socket: { remoteAddress: '10.0.0.' + Math.floor(Math.random() * 250) } }, res);
  });
}

test('the route: POST only, this site\'s own pages (or an account), a story only, and the file with what it is', async () => {
  test.setTimeout(180000);
  require(path.join(ROOT, 'api', '_shared', 'brand-render.js')).resetRateLimits && require(path.join(ROOT, 'api', '_shared', 'brand-render.js')).resetRateLimits();
  const env = { SUPABASE_URL: process.env.SUPABASE_URL };
  delete process.env.SUPABASE_URL;
  try {
    expect((await call(CV.handle, { method: 'GET' })).status).toBe(405);
    const cross = await call(CV.handle, { headers: { origin: 'https://other.example' }, body: { html: story([]) } });
    expect(cross.status).toBe(403);
    expect(cross.json.message).toMatch(/this app's own pages/);
    const notStory = await call(CV.handle, { headers: { origin: 'https://app.example.test' }, body: { html: '<p>hi</p>' } });
    expect(notStory.status).toBe(400);
    expect(notStory.json.error).toBe('not_a_story');
    const ok = await call(CV.handle, { headers: { origin: 'https://app.example.test' }, body: { html: story([]), cut: 'short', size: '540p' } });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toMatch(/^video\/(mp4|webm)$/);
    expect(ok.headers['content-disposition']).toMatch(/^attachment; filename="fernwick-roasters-story-\d+s\.(mp4|webm)"$/);
    expect(ok.headers['x-video-size']).toBe('540x960');
    expect(Buffer.isBuffer(ok.body) && ok.body.length > 1000).toBe(true);
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
  } finally { if (env.SUPABASE_URL !== undefined) process.env.SUPABASE_URL = env.SUPABASE_URL; }
});

test('a keyless video answer carries the story to render, as the same photos and lines', () => {
  const vc = require(path.join(ROOT, 'api', '_shared', 'video-core.js'));
  const o = vc.codeMotion({ brand: { name: 'Fernwick Roasters', palette: { primary: PRIMARY, accent: '#e8b04a', surface: '#fffaf2', ink: '#2b1a10' } },
    motion: { images: [OK_URL], lines: ['Fresh this week', 'Roasted on Tuesdays'], product: 'House blend', cta: 'Shop now' } });
  const d = SA.storyDataFrom(o.story_html);
  expect(d.cuts.full.scenes.map((x) => x.kind + ':' + x.headline)).toEqual(['hook:Fresh this week', 'product:House blend', 'line:Roasted on Tuesdays', 'end:Fresh this week']);
  expect(d.cuts.full.scenes[1].image).toBe(OK_URL);
  expect(o.mp4).toMatchObject({ method: 'POST', url: '/api/public-config?action=video-render' });
});

test('the H.264 MP4 from the production browser (@sparticuz/chromium) decodes, at its size and length', async ({ page }) => {
  test.skip(process.platform !== 'linux' || process.arch !== 'x64', 'the serverless binary is built for Linux x64');
  test.setTimeout(300000);
  const r = await CV.renderStoryVideo({ html: story([OK_URL, OK_URL]), cut: 'short', size: '540p', prefer: 'sparticuz', fetchImpl: fakeFetch([]), assertUrl: allow });
  expect(r.ok, r.message).toBe(true);
  expect(r.browser.source).toBe('sparticuz');
  expect(r.container).toBe('mp4');
  expect(r.codec).toBe('H.264');
  expect(r.buffer.subarray(4, 8).toString('latin1')).toBe('ftyp');
  // The 'avc1' sample entry is in the file: H.264, as ad platforms take it.
  expect(r.buffer.includes(Buffer.from('avc1'))).toBe(true);
  expect(r.buffer.includes(Buffer.from('avcC'))).toBe(true);
});

/* ── The /brain button, in Chromium ────────────────────────────────────── */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
test('/brain: "MP4 video (made in code, no key)" sends the story and plays the file the server made', async ({ page }) => {
  test.setTimeout(120000);
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, workspaces: [] })); }
    const f = path.join(ROOT, url.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const sent = [];
    const fake = Buffer.from('1a45dfa3', 'hex');
    await page.route('**/api/public-config?action=video-render', async (r) => {
      sent.push(JSON.parse(r.request().postData() || '{}'));
      await r.fulfill({ status: 200, contentType: 'video/webm', body: fake, headers: { 'X-Video-Codec': 'VP9', 'X-Video-Size': '720x1280', 'X-Video-Seconds': '19', 'X-Video-Images-Refused': '1' } });
    });
    await page.goto(base + '/smart-brain.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof renderAd === 'function' && typeof window.sbRenderMp4 === 'function', null, { timeout: 20000 });
    const html = story([OK_URL, BAD_URL]);
    await page.evaluate((html) => {
      const host = document.createElement('div'); host.id = 'cv-host'; document.body.appendChild(host);
      host.innerHTML = renderAd({ platform: 'meta', creative_type: 'video', creative: { motion_html: '<p>x</p>', story_html: html, story_brief: { duration_s: 19 } } });
    }, html);
    const btn = page.locator('#cv-host [data-code-mp4]');
    await expect(btn).toHaveText(/MP4 video \(made in code, no key\)/);
    await btn.click();
    await expect(page.locator('#cv-host [data-code-mp4-out] video')).toHaveCount(1, { timeout: 20000 });
    await expect(page.locator('#cv-host [data-code-mp4-out] a')).toContainText('Download the WEBM (VP9, 720x1280, 19 s');
    await expect(page.locator('#cv-host [data-code-mp4-out]')).toContainText('1 photo(s) could not be fetched');
    expect(sent.length).toBe(1);
    expect(sent[0].html).toBe(html);
    expect(sent[0].cut).toBe('full');
  } finally { await new Promise((r) => server.close(r)); }
});
