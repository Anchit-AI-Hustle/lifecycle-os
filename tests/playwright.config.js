// Playwright config — visual + functional regression for the Mailer Studio SPA.
// Run from project root:
//   npx playwright install   (one-time)
//   npx playwright test --reporter=list
// Or with UI to step through visually:
//   npx playwright test --ui
const { defineConfig, devices } = require('@playwright/test');

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
  // Six viewports cover the realistic device matrix.
  projects: [
    { name: 'iphone-se',     use: { ...devices['iPhone SE'] } },          // 320x568
    { name: 'iphone-12',     use: { ...devices['iPhone 12'] } },          // 390x844
    { name: 'pixel-5',       use: { ...devices['Pixel 5'] } },            // 393x851
    { name: 'ipad',          use: { ...devices['iPad (gen 7)'] } },       // 810x1080
    { name: 'desktop-1280',  use: { viewport: { width: 1280, height: 800 } } },
    { name: 'desktop-1920',  use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
