'use strict';
// Fixtures for tests/layout-remix.spec.js: a photograph-like PNG (noise over a
// gradient: no two neighbouring pixels share a colour, as in a real photo) and
// "competitor ads" drawn by the shipped static-ad.js in a palette that is NOT
// the remixing brand's, photographed in Chromium as PNGs.
const { PNG } = require('pngjs');

function photoPng(w, h, seed) {
  const png = new PNG({ width: w, height: h });
  let s = seed || 7;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      png.data[i] = Math.max(0, Math.min(255, 60 + (x / w) * 120 + rnd() * 90));
      png.data[i + 1] = Math.max(0, Math.min(255, 90 + (y / h) * 100 + rnd() * 90));
      png.data[i + 2] = Math.max(0, Math.min(255, 140 - (x / w) * 60 + rnd() * 90));
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function flatPng(w, h, rgb) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) { png.data[i * 4] = rgb[0]; png.data[i * 4 + 1] = rgb[1]; png.data[i * 4 + 2] = rgb[2]; png.data[i * 4 + 3] = 255; }
  return PNG.sync.write(png);
}

/** Draw a static-ad.js page to a PNG of its .ad element, its photo served from memory. */
async function drawAd(page, html, photoUrl, photo, width) {
  const RATIOS = require('../../scripts/lib/static-ad.js').RATIOS;
  const m = /data-ratio="([^"]+)"/.exec(html);
  const [rw, rh] = RATIOS[(m && m[1]) || '1:1'];
  await page.setViewportSize({ width, height: Math.round(width * rh / rw) });
  await page.unroute('**/*').catch(() => {});
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u === 'https://draw.invalid/') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (u === photoUrl) return route.fulfill({ status: 200, contentType: 'image/png', body: photo });
    return route.abort();
  });
  await page.goto('https://draw.invalid/');
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = r; i.onerror = r; })))));
  return (await page.$('.ad')).screenshot({ type: 'png' });
}

module.exports = { photoPng, flatPng, drawAd };
