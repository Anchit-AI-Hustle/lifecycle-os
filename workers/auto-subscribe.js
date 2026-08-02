#!/usr/bin/env node
'use strict';

/**
 * Auto-subscribe worker — subscribes the capture inbox to competitor newsletters
 * so their lifecycle mail (welcome, promo, abandoned-cart, win-back) flows into
 * the Competitor Benchmarking capture pipeline (IMAP → Google Sheet).
 *
 * WHY a LOCAL worker, not a Vercel function:
 *   Playwright drives a real (headless) browser, which can't run inside the
 *   12-function Hobby serverless budget. This script runs on your machine / CI.
 *
 * DATA PATH — talks to the Google Sheet DIRECTLY:
 *   The deployed API sits behind Vercel SSO (Deployment Protection), so a
 *   headless worker can't reach it. Instead this worker reuses the SAME tested
 *   sheet logic the server uses (api/_shared/competitor-core.js) — getBrands()
 *   to read the brand universe and markBrandSubscribed() to write status back —
 *   authenticating with a Google service-account key from .env.local. Locally,
 *   WIF can't engage (no Vercel OIDC token) so it correctly uses legacy JWT.
 *
 * IDENTITY SAFETY:
 *   The only identity used to SUBSCRIBE is SUBSCRIBE_EMAIL (the capture inbox).
 *   It never logs into Gmail or touches the signed-in app user — it just types
 *   that address into third-party newsletter forms, like a human would. The SA
 *   key is used ONLY to read/write the Brands sheet, nothing else.
 *
 * SETUP:
 *   1) npm i && npx playwright install chromium
 *   2) Put these in .env.local (gitignored) at the repo root:
 *        GOOGLE_SHEET_ID=<the competitor sheet id>
 *        GOOGLE_SERVICE_ACCOUNT_EMAIL=<…@….iam.gserviceaccount.com>
 *        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
 *        GOOGLE_BRANDS_TAB=Competitors        # optional (defaults to Competitors)
 *      (\n-escaped or real newlines both work. Use the SAME SA already shared on the sheet.)
 *
 * USAGE:
 *   npm run subscribe                          # subscribe every brand not yet "Subscribed"
 *   MAX=10 npm run subscribe                   # cap to 10
 *   HEADFUL=1 npm run subscribe                # watch it run
 *   DRY_RUN=1 npm run subscribe                # find+fill forms, DON'T submit / DON'T write back
 *   JOURNEY=1 npm run subscribe                # also add a bestseller to cart → bait abandoned-cart emails
 *   ONLY=sneakboo.com,theshoesurgeon.com npm run subscribe
 *   FORCE=1 npm run subscribe                  # re-run brands already Subscribed
 *
 * Each attempt writes a screenshot to workers/.artifacts/<domain>.png for audit.
 */

const fs = require('fs');
const path = require('path');

// ── Load .env.local (no dotenv dep) — KEY=VALUE lines, # comments, optional quotes ──
(function loadEnvLocal() {
  const p = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

// @playwright/test re-exports the browser launchers; no separate `playwright` dep needed.
const { chromium, devices } = require('@playwright/test');
// Reuse the server's battle-tested sheet logic (JWT auth, brand schema, write-back).
const core = require('../api/_shared/competitor-core');

// ── Config (all via env, with safe defaults) ──────────────────────────────────
const SUBSCRIBE_EMAIL = process.env.SUBSCRIBE_EMAIL || 'ojhapraneet@gmail.com';
const MAX = Number(process.env.MAX) || 0;                 // 0 = no cap
const HEADFUL = !!process.env.HEADFUL;
const DRY_RUN = !!process.env.DRY_RUN;
const JOURNEY = !!process.env.JOURNEY;
const FORCE = !!process.env.FORCE;
const ONLY = new Set((process.env.ONLY || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT) || 30000;
const DELAY_MS = Number(process.env.DELAY_MS) || 4000;    // politeness gap between brands
const ARTIFACT_DIR = path.join(__dirname, '.artifacts');

const norm = (u) => String(u || '').toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Preflight: credentials present? ───────────────────────────────────────────
function preflight() {
  const missing = ['GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('✗ Missing Google credentials: ' + missing.join(', '));
    console.error('  Add them to .env.local at the repo root (see this file\'s header). The SA must be');
    console.error('  shared on the competitor sheet with edit access (the same one the server uses).');
    process.exit(1);
  }
}

// ── Cookie / consent banners block interaction — clear them first ─────────────
async function dismissConsent(page) {
  const labels = [/accept all/i, /accept/i, /agree/i, /got it/i, /allow all/i, /i agree/i, /continue/i, /ok/i];
  for (const re of labels) {
    try {
      const btn = page.getByRole('button', { name: re }).first();
      if (await btn.isVisible({ timeout: 800 }).catch(() => false)) { await btn.click({ timeout: 1500 }).catch(() => {}); return; }
    } catch (_) { /* keep trying */ }
  }
}

/**
 * Find the most plausible newsletter EMAIL input on the page and return it.
 * Prefers inputs inside a form/section mentioning subscribe/newsletter/sign up,
 * and de-prioritises search/login fields, so the footer signup wins.
 */
async function findEmailInput(page) {
  const candidates = page.locator(
    'input[type="email"], input[name*="email" i], input[id*="email" i], ' +
    'input[placeholder*="email" i], input[aria-label*="email" i]'
  );
  const n = await candidates.count();
  let best = null;
  for (let i = 0; i < n; i++) {
    const el = candidates.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    if (!(await el.isEditable().catch(() => false))) continue;
    const ctx = await el.evaluate((node) => {
      const form = node.closest('form, section, footer, div[class*="newsletter" i], div[class*="subscribe" i]');
      return (form ? form.innerText : (node.placeholder || '')).slice(0, 400).toLowerCase();
    }).catch(() => '');
    const score = (/news ?letter|subscribe|sign ?up|join|email list|stay in|get .*off|first to know|updates/.test(ctx) ? 2 : 0)
      + (/search|login|log in|sign in|password/.test(ctx) ? -3 : 0);
    if (!best || score >= best.score) best = { el, score };
  }
  return best ? best.el : null;
}

async function submitForm(page, input) {
  const btn = await input.evaluateHandle((node) => {
    const form = node.closest('form');
    const scope = form || node.parentElement || document;
    const buttons = Array.from(scope.querySelectorAll('button, input[type="submit"], [role="button"]'));
    const re = /subscribe|sign ?up|join|notify|submit|continue|→|›|get/i;
    return buttons.find((b) => re.test((b.innerText || b.value || b.getAttribute('aria-label') || ''))) || buttons[0] || null;
  }).catch(() => null);
  const elt = btn && btn.asElement && btn.asElement();
  if (elt) {
    await elt.click({ timeout: 3000 }).catch(async () => { await input.press('Enter').catch(() => {}); });
  } else {
    await input.press('Enter').catch(() => {});
  }
}

async function looksSubscribed(page) {
  return page.locator('text=/thank you|thanks for|you.?re (now )?subscribed|check your (inbox|email)|almost there|confirm your|welcome|you.?re in|successfully/i')
    .first().isVisible({ timeout: 4000 }).catch(() => false);
}

// Optional: bait an abandoned-cart flow by adding a bestseller to the cart.
async function seedCartJourney(page, brand) {
  try {
    const dest = brand.bestsellerUrl || brand.newArrivalsUrl ||
      (brand.websiteUrl ? brand.websiteUrl.replace(/\/$/, '') + '/collections/all' : null);
    if (!dest) return false;
    await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => {});
    await dismissConsent(page);
    const card = page.locator('a[href*="/products/"]').first();
    if (await card.isVisible({ timeout: 3000 }).catch(() => false)) {
      await card.click({ timeout: 4000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    const addBtn = page.getByRole('button', { name: /add to (cart|bag)|add to basket/i }).first();
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click({ timeout: 4000 }).catch(() => {});
      await sleep(1500);
      return true;
    }
  } catch (_) { /* best-effort */ }
  return false;
}

async function processBrand(context, brand) {
  const domain = brand.domain || norm(brand.websiteUrl);
  const target = brand.newsletterSignupUrl || brand.websiteUrl;
  if (!target) return { domain, result: 'no-url' };

  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  let result = 'form-not-found';
  try {
    await page.goto(/^https?:\/\//.test(target) ? target : `https://${target}`,
      { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await dismissConsent(page);
    await sleep(2500);                 // let delayed signup pop-ups render
    await dismissConsent(page);        // a popup may have introduced its own consent

    let input = await findEmailInput(page);
    if (!input) {                      // many sites only show the form in the footer
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await sleep(1200);
      input = await findEmailInput(page);
    }

    if (input) {
      await input.scrollIntoViewIfNeeded().catch(() => {});
      await input.fill(SUBSCRIBE_EMAIL, { timeout: 4000 });
      if (DRY_RUN) {
        result = 'dry-run-filled';
      } else {
        await submitForm(page, input);
        await sleep(2500);
        result = (await looksSubscribed(page)) ? 'subscribed' : 'submitted';
      }
    }

    if (JOURNEY && !DRY_RUN) {
      const baited = await seedCartJourney(page, brand);
      if (baited) result += '+cart';
    }
  } catch (e) {
    result = `error:${(e.message || '').slice(0, 60)}`;
  } finally {
    try {
      fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(ARTIFACT_DIR, `${domain || 'unknown'}.png`), fullPage: false }).catch(() => {});
    } catch (_) {}
    await page.close().catch(() => {});
  }
  return { domain, result };
}

// ── Write the outcome back to the Brands sheet (direct, via core) ─────────────
async function writeBack(brand, result) {
  const status = result.startsWith('subscribed') ? 'Subscribed' : 'Submitted (unconfirmed)';
  try {
    const r = await core.markBrandSubscribed({
      domain: brand.domain || brand.websiteUrl,
      websiteUrl: brand.websiteUrl,
      status,
      dateSubscribed: new Date().toISOString(),
      confirmationRequired: 'Yes',     // most DTC lists are double opt-in
      confirmationCompleted: '',
    });
    if (!r.ok) console.warn(`   ↳ write-back failed: ${r.error}`);
    return r.ok;
  } catch (e) {
    console.warn(`   ↳ write-back error: ${e.message}`);
    return false;
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
(async function main() {
  preflight();
  console.log('▶ auto-subscribe worker (direct-to-sheet)');
  console.log(`   sheet:  ${process.env.GOOGLE_SHEET_ID}  ·  tab: ${process.env.GOOGLE_BRANDS_TAB || 'Competitors'}`);
  console.log(`   email:  ${SUBSCRIBE_EMAIL}`);
  console.log(`   mode:   ${DRY_RUN ? 'DRY-RUN ' : ''}${JOURNEY ? 'JOURNEY ' : ''}${HEADFUL ? 'HEADFUL' : 'headless'}\n`);

  let brands;
  try { brands = await core.getBrands(); }
  catch (e) { console.error(`✗ could not load brands from the sheet: ${e.message}`); process.exit(1); }

  let queue = brands.filter((b) => b.websiteUrl || b.newsletterSignupUrl);
  if (ONLY.size) queue = queue.filter((b) => ONLY.has((b.domain || norm(b.websiteUrl))));
  if (!FORCE) queue = queue.filter((b) => !/^subscribed/i.test(String(b.subscriptionStatus || '')));
  if (MAX > 0) queue = queue.slice(0, MAX);

  console.log(`   queue:  ${queue.length} brand(s)${MAX ? ` (capped at ${MAX})` : ''} of ${brands.length} total\n`);
  if (!queue.length) { console.log('Nothing to do.'); return; }

  const browser = await chromium.launch({ headless: !HEADFUL });
  const summary = [];
  try {
    for (let i = 0; i < queue.length; i++) {
      const brand = queue[i];
      const label = brand.brandName || brand.domain || brand.websiteUrl;
      process.stdout.write(`[${i + 1}/${queue.length}] ${label} … `);

      const context = await browser.newContext({
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        viewport: { width: 1280, height: 900 },
      });
      const { domain, result } = await processBrand(context, brand);
      await context.close().catch(() => {});

      console.log(result);
      summary.push({ brand: label, domain, result });

      if (!DRY_RUN && /^(subscribed|submitted)/.test(result)) await writeBack(brand, result);
      if (i < queue.length - 1) await sleep(DELAY_MS);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // ── Report ──
  const tally = summary.reduce((m, s) => { const k = s.result.split(':')[0].split('+')[0]; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log('\n── summary ──');
  for (const s of summary) console.log(`  ${s.result.padEnd(22)} ${s.brand}`);
  console.log('\n', tally);
  console.log(`\nScreenshots: ${ARTIFACT_DIR}`);
  console.log('Captured mail arrives over minutes–hours; the IMAP sync (?action=sync / cron) will pull it into the sheet.');
})();
