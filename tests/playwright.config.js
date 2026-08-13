// Playwright config — visual + functional regression for the Mailer Studio SPA.
// Run from project root:
//   npx playwright install   (one-time)
//   npx playwright test --reporter=list
// Or with UI to step through visually:
//   npx playwright test --ui
const { defineConfig, devices } = require('@playwright/test');
const fs = require('fs');

// Some sandboxes ship a Chromium at a fixed path whose build number does not
// match the one this @playwright/test pins, and cannot download the pinned one.
// Point at the preinstalled binary when it is there and the pinned download is
// not. On CI, `npx playwright install` provides the right build and this path
// does not exist, so the guard is inert and the pinned browser still wins.
const PREINSTALLED = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOptions = fs.existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {};

/*
 * CHROMIUM ONLY. This override used to sit in the top-level `use`, where it
 * applied to every project - including the iPhone and iPad ones, which default
 * to WEBKIT. Pointing a WebKit launch at a Chromium binary does not fall back,
 * it fails: "Target page, context or browser has been closed", reported against
 * whichever assertion happened to be first. So the responsive spec looked like
 * eight broken layout tests on tablet when the browser had never started.
 *
 * Spread into the chromium-based projects only. On CI the preinstalled path
 * does not exist, this is `{}`, and every project uses its own pinned browser
 * exactly as before.
 */
const chromiumUse = { launchOptions };

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js$/,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/report' }]],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    // The SPA is a single static HTML file — open it via file:// URL.
    // Override with TARGET_URL env var to test the deployed Vercel URL instead.
    baseURL: process.env.TARGET_URL || 'file://' + require('path').resolve(__dirname, '..', 'lifecycle_mailer_architect_v34.html'),
  },
  /*
   * TWO KINDS OF TEST, and only one of them cares about a viewport.
   *
   * studio.spec.js is the responsive regression: it reads project.name and
   * asserts layout at each width, so it genuinely needs the device matrix.
   * The other 27 specs assert LOGIC - brand-token maths, workspace scoping,
   * data provenance, contrast of a computed colour. Re-running those at six
   * widths adds no signal, and it costs more than time:
   *
   *   - CI ran the whole suite six times on a 2-core runner and was still
   *     going at 46 minutes, which is what turned main red.
   *   - It also produced FALSE failures. On a phone the shared rail is a
   *     drawer behind a burger, so "the market picker is in the rail" cannot
   *     hold at 320px - region-context alone reported 17 failures there,
   *     none of them a real defect.
   *
   * So the device projects run the responsive spec, and one project runs the
   * invariants once. Stated plainly: this means the invariant specs are NOT
   * exercised at phone widths. That is a real coverage gap, not a claim that
   * they pass there - a mobile contrast or scoping check would need tests
   * written for the drawer layout, which these were not.
   */
  projects: [
    { name: 'iphone-se',    testMatch: /studio\.spec\.js$/, use: { ...devices['iPhone SE'] } },     // 320x568
    { name: 'iphone-12',    testMatch: /studio\.spec\.js$/, use: { ...devices['iPhone 12'] } },     // 390x844
    { name: 'pixel-5',      testMatch: /studio\.spec\.js$/, use: { ...devices['Pixel 5'], ...chromiumUse } },       // 393x851
    { name: 'ipad',         testMatch: /studio\.spec\.js$/, use: { ...devices['iPad (gen 7)'] } },  // 810x1080
    { name: 'desktop-1920', testMatch: /studio\.spec\.js$/, use: { viewport: { width: 1920, height: 1080 }, ...chromiumUse } },
    // Everything, at the width the app is designed around. Named desktop-1280
    // because every `--project=desktop-1280` invocation in the docs, the CI
    // notes and this session's history expects that name to run the full set.
    { name: 'desktop-1280', use: { viewport: { width: 1280, height: 800 }, ...chromiumUse } },
  ],
});
