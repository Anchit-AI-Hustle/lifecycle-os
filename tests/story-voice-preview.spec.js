// @ts-check
'use strict';
// The Story video speaks (2026-11-09, the operator: "ensure video ads have
// voice too"). The in-page video in /brain spoke nothing: only the MP4 made in
// code carried a voiceover. While it plays, each scene's own words are spoken
// as the scene starts (hook, product with its price, line, closing button), in
// the browser's voice, after the first press in the frame; Voice off silences
// it; Pause stops it. EXECUTED: the shipped renderer's page in Chromium with
// speechSynthesis recorded.
const { test, expect } = require('@playwright/test');
const SA = require('../scripts/lib/story-ad.js');

const SPEC = { brandName: 'Quillforth', hook: 'Fresh pages every morning', lines: ['Read it before breakfast'],
  products: [{ title: 'Morning Ledger', price_text: '₹199', image: '' }], cta: 'Start reading', store: 'https://quillforth.example' };

async function open(page) {
  await page.addInitScript(() => {
    window.__said = [];
    class U { constructor(t) { this.text = t; } }
    window.SpeechSynthesisUtterance = U;
    Object.defineProperty(window, 'speechSynthesis', { value: { speak: (u) => window.__said.push(u.text), cancel: () => {}, getVoices: () => [] } });
  });
  await page.route(/^https?:\/\//, (r) => r.abort());
  await page.route('https://story.test/', (r) => r.fulfill({ contentType: 'text/html', body: SA.renderStoryAd(SPEC) }));
  await page.goto('https://story.test/');
}

test('after a press, the video speaks each scene\'s own words in order, and nothing it does not show', async ({ page }) => {
  await open(page);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__said.length), 'no voice before the person presses anything').toBe(0);
  await page.click('#restart');
  await expect.poll(() => page.evaluate(() => window.__said.length), { timeout: 20000 }).toBeGreaterThanOrEqual(3);
  const said = await page.evaluate(() => window.__said);
  expect(said[0]).toContain('Fresh pages every morning');
  expect(said.some((t) => /Morning Ledger\. ₹199/.test(t))).toBe(true);
  expect(said.some((t) => /Read it before breakfast/.test(t))).toBe(true);
  for (const t of said) expect(t).not.toMatch(/https?:/);
});

test('Voice off silences it', async ({ page }) => {
  await open(page);
  await page.click('#restart');
  await page.click('#voice');
  await expect(page.locator('#voice')).toHaveText('Voice off');
  const before = await page.evaluate(() => window.__said.length);
  await page.waitForTimeout(5000);
  expect(await page.evaluate(() => window.__said.length)).toBe(before);
});
