#!/usr/bin/env node
/**
 * WCAG contrast auditor for the Lifecycle OS static pages.
 *
 * Heuristic, not a full CSS engine: for each HTML file it resolves the page's
 * palette custom properties, collects every `color:` value used for text
 * (in <style> rules and inline style="" attributes), and computes the WCAG
 * contrast ratio of each distinct text color against the page's plausible
 * background layers (body background + white/chalk card layers on light pages,
 * or the dark canvas on dark pages). Anything below the AA threshold for
 * normal text (4.5:1) is reported.
 *
 * Run: node scripts/audit-contrast.js [glob-root]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

function srgbToLin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(r, g, b) { return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b); }
function ratio(a, b) { const L1 = lum(...a), L2 = lum(...b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return (hi + 0.05) / (lo + 0.05); }

function hexToRgb(h) {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// flatten an rgba over a base background to an opaque rgb
function overlay(fg, alpha, bg) { return fg.map(function (c, i) { return Math.round(c * alpha + bg[i] * (1 - alpha)); }); }

function parseColor(val, vars, bg) {
  val = val.trim().toLowerCase();
  while (val.indexOf("var(") === 0) {
    const m = val.match(/^var\(\s*(--[a-z0-9-]+)\s*\)$/);
    if (!m || !vars[m[1]]) return null;
    val = vars[m[1]].trim().toLowerCase();
  }
  if (val[0] === "#") return hexToRgb(val);
  let m = val.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?\s*\)$/);
  if (m) {
    const rgb = [+m[1], +m[2], +m[3]];
    const a = m[4] === undefined ? 1 : +m[4];
    return a >= 1 ? rgb : (bg ? overlay(rgb, a, bg) : null);
  }
  const NAMED = { white: [255, 255, 255], black: [0, 0, 0], "#fff": [255, 255, 255] };
  return NAMED[val] || null;
}

function getVars(src) {
  const vars = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gi;
  let m;
  while ((m = re.exec(src))) vars[m[1]] = m[2].trim();
  return vars;
}

const root = process.argv[2] || ".";
const files = cp.execSync('git ls-files "*.html"', { cwd: root }).toString().trim().split("\n")
  .filter(function (f) { return f && !f.startsWith("node_modules") && !f.includes("diff-version"); });

let totalFails = 0;
const summary = [];
files.forEach(function (rel) {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const vars = getVars(src);
  // page background family
  const bodyBg = (src.match(/body\s*\{[^}]*background:\s*([^;]+);/i) || [])[1] || "";
  const bgVal = parseColor((bodyBg.match(/var\(--[a-z0-9-]+\)|#[0-9a-f]{3,6}/i) || [])[0] || "#ffffff", vars, [255, 255, 255]) || [255, 255, 255];
  const isDark = lum(...bgVal) < 0.4;
  // candidate backgrounds text may sit on
  const bgs = isDark
    ? [bgVal, parseColor("#0f1d18", vars) || bgVal]
    : [bgVal, [255, 255, 255], hexToRgb("#FFFFFF")];

  // collect text colors from color: declarations (skip background-color)
  const colorRe = /(?<!background-)(?<!border-)color\s*:\s*([^;"}]+)/gi;
  const seen = {};
  let m;
  while ((m = colorRe.exec(src))) {
    const raw = m[1].trim();
    if (/inherit|transparent|currentcolor|unset|initial/i.test(raw)) continue;
    const rgb = parseColor(raw, vars, bgs[0]);
    if (!rgb) continue;
    const best = Math.max.apply(null, bgs.map(function (b) { return ratio(rgb, b); }));
    const tl = lum(rgb[0], rgb[1], rgb[2]);
    const key = raw.toLowerCase();
    if (seen[key] === undefined || best < seen[key].best) seen[key] = { best: best, tl: tl };
  }
  // Only flag dark-ish text colors: a light color (luminance high) that "fails"
  // against the page background is almost always text placed on a dark element
  // (a green/near-black button or bubble), not a real body-text failure.
  const fails = Object.keys(seen).filter(function (k) {
    if (seen[k].best >= 4.5) return false;
    return seen[k].tl < 0.45;
  }).map(function (k) { return { color: k, ratio: seen[k].best.toFixed(2) }; })
    .sort(function (a, b) { return a.ratio - b.ratio; });
  // placeholders without explicit color
  const hasPlaceholderColor = /::(?:-webkit-input-)?placeholder\s*\{[^}]*color/i.test(src);
  const usesInputs = /<(input|textarea)/i.test(src);
  if (fails.length || (usesInputs && !hasPlaceholderColor)) {
    summary.push({ rel: rel, dark: isDark, fails: fails, placeholder: usesInputs && !hasPlaceholderColor });
    totalFails += fails.length;
  }
});

summary.forEach(function (s) {
  console.log("\n" + s.rel + (s.dark ? "  [dark page]" : "  [light page]"));
  s.fails.forEach(function (f) { console.log("   FAIL " + f.ratio + ":1  color:" + f.color); });
  if (s.placeholder) console.log("   WARN inputs present with no explicit ::placeholder color (browser default may be low-contrast)");
});
console.log("\n" + summary.length + " files with issues, " + totalFails + " failing text colors total.");
