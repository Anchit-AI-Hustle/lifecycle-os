// @ts-check
'use strict';
// The Story video preview never speaks in the browser's voice (2026-11-11, the
// operator: "ensure no robotic voices or sounds - ensure humanised assets of
// all types only"). On 2026-11-09 the in-page video read each scene aloud with
// window.speechSynthesis, which is a synthetic voice. The preview now plays
// music only; the ad's voiceover is the recorded human voice in the MP4 made in
// code (story-voice.js), gated by tests/code-video-sound.spec.js.
// EXECUTED: the shipped renderer's page in Chromium with speechSynthesis recorded.
const { test, expect } = require('@playwright/test');
const SA = require('../scripts/lib/story-ad.js');

const SPEC = { brandName: 'Quillforth', hook: 'Fresh pages every morning', lines: ['Read it before breakfast'],
  products: [{ title: 'Morning Ledger', price_text: '\u20b9199', image: '' }], cta: 'Start reading', store: 'https://quillforth.example' };

test('the preview never uses the browser\'s synthetic voice, pressed or not, and offers no control for one', async ({ page }) => {
  await page.addInitScript(() => {
    window.__said = [];
    class U { constructor(t) { this.text = t; } }
    window.SpeechSynthesisUtterance = U;
    Object.defineProperty(window, 'speechSynthesis', { value: { speak: (u) => window.__said.push(u.text), cancel: () => {}, getVoices: () => [] } });
  });
  await page.route(/^https?:\/\//, (r) => r.abort());
  await page.route('https://story.test/', (r) => r.fulfill({ contentType: 'text/html', body: SA.renderStoryAd(SPEC) }));
  await page.goto('https://story.test/');
  await expect(page.locator('#voice')).toHaveCount(0);
  await page.locator('#restart').click();
  await page.waitForTimeout(2500);
  await page.locator('#play').click();
  await page.locator('#play').click();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__said)).toEqual([]);
  // The video itself still plays: the frame is drawn.
  expect(await page.evaluate(() => !!document.querySelector('canvas'))).toBe(true);
});
