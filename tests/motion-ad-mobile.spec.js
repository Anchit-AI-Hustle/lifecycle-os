// The video creative, opened on a phone.
//
// Reported as "effects missing when opened on mobile", and there were two
// separate causes — each of which removes the effects on its own.
//
//  1. REDUCED MOTION SHOWED THE END CARD AND NOTHING ELSE. iOS turns
//     prefers-reduced-motion on in Low Power Mode as well as from the
//     accessibility setting, so a large share of phones land in that branch.
//     `.cta` is `inset:0`, and the branch pinned it to opacity 1 — so it covered
//     the whole 9:16 frame and hid the shot and the type underneath. The viewer
//     got a static end card: no effects, and none of the creative either.
//
//  2. EVERY SCRIM AND SHADOW WAS `color-mix()`. An engine that does not
//     implement color-mix drops the declaration as invalid at parse time — it
//     does not fall back — and iOS Safari only shipped it in 16.2. On an older
//     phone the veil, both text shadows and the CTA's ground all vanished,
//     which is the reported symptom exactly, and left white type on a bright
//     photograph with nothing behind it.
//
// A third, same family: the frame was sized from 100vh, which on mobile Safari
// counts the space the URL bar occupies, so the bottom of the creative — the
// CTA and the progress bar — sat off screen.
//
// WebKit is not installed in this container, so these run in Chromium with the
// phone viewport and the media feature emulated. That covers 1 and 3 honestly;
// for 2 the assertion is that no color-mix reaches the output at all, which is
// engine-independent and is the actual fix.
//
// Run: npx playwright test tests/motion-ad-mobile.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const motion = require(path.join(ROOT, 'scripts', 'lib', 'motion-ad.js'));

const SPEC = {
  loop: false,
  headline: 'Back in your rotation', cta: 'Shop the edit',
  offer: '20% off this week', footnote: 'Terms apply.',
  scenes: [
    { seconds: 2, headline: 'Hand painted', sub: 'On original pairs.' },
    { seconds: 2, headline: 'One of one', sub: 'Never the same twice.' },
  ],
};

const PHONE = { width: 390, height: 844 };

/** What is actually on screen: cumulative opacity, and the box. */
const MEASURE = () => {
  const read = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    let fade = 1;
    for (let n = el; n; n = n.parentElement) fade *= Number(getComputedStyle(n).opacity || 1);
    const b = el.getBoundingClientRect();
    return {
      fade: +fade.toFixed(3),
      w: Math.round(b.width), h: Math.round(b.height),
      top: Math.round(b.top), bottom: Math.round(b.bottom),
      anim: getComputedStyle(el).animationName,
    };
  };
  const stage = document.querySelector('.stage').getBoundingClientRect();
  return {
    stage: { w: Math.round(stage.width), h: Math.round(stage.height) },
    scene0: read('.scene'),
    headline: read('.scene .kin'),
    cta: read('.cta'),
    ctaText: (document.querySelector('.cta h3') || {}).textContent || '',
    sceneText: (document.querySelector('.scene .kin') || {}).textContent || '',
  };
};

async function open(page, reducedMotion) {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ reducedMotion });
  await page.setContent(motion.renderMotionAd(SPEC), { waitUntil: 'domcontentloaded' });
  return page.evaluate(MEASURE);
}

test('with reduced motion the phone still gets the creative, not just the end card', async ({ page }) => {
  const m = await open(page, 'reduce');

  // The opening shot and its type are visible...
  expect(m.scene0.fade, 'the opening scene is not visible').toBe(1);
  expect(m.headline.fade, 'the headline is not visible').toBe(1);
  expect(m.sceneText.trim().length, 'the scene carries no type').toBeGreaterThan(0);

  // ...and the CTA does not cover them. This is the defect: inset:0 plus
  // opacity:1 made the card the full 9:16 frame.
  expect(m.cta.fade, 'the CTA card is not visible').toBe(1);
  expect(m.cta.h, `the CTA card is ${m.cta.h}px tall against a ${m.stage.h}px stage — it is covering the creative`)
    .toBeLessThan(m.stage.h * 0.55);
  expect(m.ctaText.trim().length, 'the CTA card carries no copy').toBeGreaterThan(0);

  // The headline sits above the card rather than behind it.
  expect(m.headline.bottom, 'the headline overlaps the CTA card').toBeLessThanOrEqual(m.cta.top + 1);

  // And nothing is animating, which is what the viewer asked for.
  expect(m.scene0.anim, 'the scene still animates under reduced motion').toBe('none');
  expect(m.cta.anim, 'the CTA still animates under reduced motion').toBe('none');
});

test('without reduced motion the creative still animates', async ({ page }) => {
  // The fix above must not turn the ad into a poster for everyone else.
  const m = await open(page, 'no-preference');
  expect(m.scene0.anim, 'the scene no longer animates').not.toBe('none');
  expect(m.cta.anim, 'the CTA no longer animates').not.toBe('none');
  // The card is still the full-bleed end card when it plays.
  expect(m.cta.h).toBeGreaterThan(m.stage.h * 0.9);
});

test('no scrim or shadow depends on color-mix support', () => {
  // color-mix is dropped whole by engines that lack it, so a declaration using
  // it is the effect going missing. Every input here is a known colour and a
  // fixed percentage, so it is resolved at render time instead.
  const html = motion.renderMotionAd(SPEC);
  const css = html.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const uses = css.match(/color-mix\s*\(/g) || [];
  expect(uses, `${uses.length} color-mix() declarations reach the output`).toEqual([]);

  // And the values it replaced are actually there — a fix that deleted the
  // scrim instead of resolving it would also pass the assertion above.
  expect(css, 'the veil scrim is gone').toMatch(/\.veil[\s\S]{0,200}rgba\(/);
  expect(css, 'the type has no text-shadow').toMatch(/text-shadow:[^;]*rgba\(/);
  expect(css, 'the CTA card has no ground').toMatch(/\.cta\s*\{[\s\S]{0,300}radial-gradient\(/);
});

test('the blur behind the sound pill is declared in the form Safari reads', () => {
  // Same class of defect, smaller stake: Safari has only shipped
  // backdrop-filter unprefixed very recently, so on most iPhones this effect
  // was absent.
  const html = motion.renderMotionAd(SPEC);
  expect(html, 'no -webkit- form, so the blur is missing on Safari').toMatch(/-webkit-backdrop-filter:\s*blur/);
  expect(html, 'the standard form was dropped').toMatch(/[^-]backdrop-filter:\s*blur/);
});

test('the frame is sized from the visible viewport, not the one behind the URL bar', () => {
  const html = motion.renderMotionAd(SPEC);
  // 100vh on mobile Safari counts the space the URL bar occupies, so a 9:16
  // frame sized from it runs off the bottom and takes the CTA with it.
  expect(html, 'no small-viewport sizing').toMatch(/100svh/);
  // Declared inside @supports so an engine without svh keeps the vh rule.
  expect(html, 'svh is not guarded for engines that lack it').toMatch(/@supports\s*\(height:\s*100svh\)/);
  expect(html, 'the vh fallback was removed').toMatch(/calc\(100vh \* 9 \/ 16\)/);
});
