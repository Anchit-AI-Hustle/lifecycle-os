#!/usr/bin/env node
/**
 * Capture real screenshots of competitor storefronts for the benchmarking
 * dossiers. Uses the pre-installed system Chromium via puppeteer-core.
 *
 * Only successful captures are kept; sites that block automated access
 * (Cloudflare / bot challenge / timeout) are recorded as "blocked" so the
 * dossier can link out instead of showing an image.
 *
 * Output: playbook/dossiers/shots/<slug>-home.png (+ -product.png when set),
 *         playbook/dossiers/shots/manifest.json
 *
 * Run: node scripts/capture-competitor-shots.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = path.join(__dirname, "..", "playbook", "dossiers", "shots");
fs.mkdirSync(OUT, { recursive: true });

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// homepage + an optional product/collection page per brand
const TARGETS = [
  { slug: "cheeky-sneeky", home: "https://cheekysneeky.com/", product: "https://cheekysneeky.com/" },
  { slug: "courtside", home: "https://www.courtside.store/", product: "https://www.courtside.store/" },
  { slug: "kickstradomis", home: "https://kickstradomis.com/", product: "https://kickstradomis.com/" },
  { slug: "md-customs", home: "https://www.mdcustoms.in/en-us/", product: "https://www.mdcustoms.in/en-us/" },
  { slug: "moreiarty", home: "https://www.moreiarty.in/", product: "https://www.moreiarty.in/" },
  { slug: "shoes-your-daddy", home: "https://www.shoesyourdaddy.in/", product: "https://www.shoesyourdaddy.in/" },
  { slug: "sneak-peek-shoes", home: "https://www.handpaintedsneaker.com/", product: "https://www.handpaintedsneaker.com/" },
  { slug: "sneakaboo", home: "https://www.instagram.com/sneakaboo.in/", product: "https://www.instagram.com/sneakaboo.in/" },
  { slug: "the-leather-works-tlw-ar", home: "https://theleatherworks.in/", product: "https://theleatherworks.in/" },
  { slug: "the-shoe-surgeon-srgn", home: "https://www.thesurgeon.com/", product: "https://www.thesurgeon.com/" },
  { slug: "crepdog-crew", home: "https://crepdogcrew.com/", product: "https://crepdogcrew.com/" },
];

async function shoot(page, url, file) {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  // let hero imagery/lazy content settle a moment (no Date.now/random needed)
  await new Promise(function (r) { setTimeout(r, 2500); });
  await page.screenshot({ path: file, type: "png", fullPage: false });
  const kb = Math.round(fs.statSync(file).size / 1024);
  if (kb < 6) { fs.unlinkSync(file); throw new Error("suspiciously small (" + kb + "kb), likely a block/blank"); }
  return kb;
}

(async function () {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--hide-scrollbars", "--disable-dev-shm-usage"]
  });
  const manifest = {};
  for (const t of TARGETS) {
    manifest[t.slug] = { home: null, product: null, homeUrl: t.home, productUrl: t.product };
    for (const kind of ["home", "product"]) {
      const url = t[kind];
      if (!url) continue;
      const rel = t.slug + "-" + kind + ".png";
      const file = path.join(OUT, rel);
      const page = await browser.newPage();
      try {
        await page.setUserAgent(UA);
        await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
        const kb = await shoot(page, url, file);
        manifest[t.slug][kind] = rel;
        console.log("OK   " + t.slug + " " + kind + "  (" + kb + "kb)");
      } catch (e) {
        console.log("MISS " + t.slug + " " + kind + "  " + String(e.message).split("\n")[0]);
      } finally {
        await page.close();
      }
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  const okHome = Object.values(manifest).filter(function (m) { return m.home; }).length;
  const okProd = Object.values(manifest).filter(function (m) { return m.product; }).length;
  console.log("\nCaptured home:" + okHome + "/" + TARGETS.length + "  product:" + okProd + "/" + TARGETS.length);
})();
