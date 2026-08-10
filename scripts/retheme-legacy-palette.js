#!/usr/bin/env node
'use strict';
/**
 * scripts/retheme-legacy-palette.js — retire the previous brand's palette.
 *
 *   node scripts/retheme-legacy-palette.js --dry    report only (default)
 *   node scripts/retheme-legacy-palette.js --apply  rewrite the pages
 *
 * 65 pages still hardcoded the PREVIOUS brand's design system: forest greens,
 * creams and golds, about 2,000 usages across 429 distinct hexes. Those pages
 * therefore did not re-skin with the active brand - a publisher workspace still
 * rendered in a tea brand's colours.
 *
 * Rather than swapping one brand's hexes for another's (which would repeat the
 * mistake for the next brand), each colour is mapped to the THEME TOKEN whose
 * role it was playing, so it now resolves per brand:
 *
 *   dark green / dark neutral   -> var(--vh-ink)        text and dark grounds
 *   mid green                   -> var(--vh-ink-dim)    secondary text
 *   light green / cream         -> var(--vh-panel-tan)  raised panels
 *   gold / tan                  -> var(--vh-lava)       accent
 *
 * SAFETY. Only CSS contexts are rewritten - declarations inside <style> blocks
 * and style="" attributes. Hexes inside scripts are left alone: they are often
 * data (chart series, canvas fills) where a var() would not resolve. Lightness
 * decides the role, so contrast relationships are preserved rather than
 * flattened.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const BRAND = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/brands/_default.json'), 'utf8')).palette || {};
const KEEP = new Set(Object.values(BRAND).filter((v) => /^#[0-9A-Fa-f]{6}$/.test(v)).map((v) => v.toUpperCase()));

// Neutrals and functional status/chart colours stay literal.
const NEUTRAL = /^#(?:([0-9A-F])\1{5}|FFFFFF|000000|F5F5F5|EBEBEB|F7F7F7|FAFAFA|EEEEEE|DDDDDD|CCCCCC|999999|666666|333333|111111|1A1A1A|F6F6F6|F4F4F4|E3E3E3|D2D2D7|6E6E73)$/i;
const FUNCTIONAL = /^#(?:1A7F37|147014|0A7D33|16A34A|18794E|2F8F57|1D6B45|3FA46A|5FB487|8FD3B0|C9A227|B45309|F59E0B|9A7420|C0392B|B91C1C|EF4444|E89A9A|9B3A2E|1D4ED8|305C89|4B8BF5|6A3D7A|7424B5)$/i;

function hsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

/** The token whose ROLE this colour was playing. null = leave it alone. */
function tokenFor(hex) {
  const u = hex.toUpperCase();
  if (KEEP.has(u) || NEUTRAL.test(u) || FUNCTIONAL.test(u)) return null;
  const [h, s, l] = hsl(u);
  if (s <= 6) return null;                       // effectively neutral
  const green = h >= 70 && h <= 190;
  const warm = h >= 15 && h < 70;
  if (green || warm) {
    if (l <= 40) return 'var(--vh-ink)';
    if (l <= 62) return green ? 'var(--vh-ink-dim)' : 'var(--vh-lava)';
    if (l <= 78) return warm ? 'var(--vh-lava)' : 'var(--vh-ink-dim)';
    return 'var(--vh-panel-tan)';                // light wash: a raised panel
  }
  return null;                                    // reds/blues/purples: leave
}

/** Rewrite hexes only inside CSS declarations, never inside scripts. */
function rewriteCss(html, counter) {
  const spans = [];
  const styleBlock = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleBlock.exec(html))) spans.push([m.index + m[0].indexOf(m[1]), m.index + m[0].indexOf(m[1]) + m[1].length]);
  const styleAttr = /style="([^"]*)"/gi;
  while ((m = styleAttr.exec(html))) spans.push([m.index + 7, m.index + 7 + m[1].length]);
  if (!spans.length) return html;
  spans.sort((a, b) => a[0] - b[0]);

  let out = '', cursor = 0;
  for (const [s, e] of spans) {
    if (s < cursor) continue;                    // overlapping (attr inside style block)
    out += html.slice(cursor, s);
    out += html.slice(s, e).replace(/#[0-9A-Fa-f]{6}\b/g, (hex) => {
      const tok = tokenFor(hex);
      if (!tok) return hex;
      counter.n++; counter.map[hex.toUpperCase()] = tok;
      return tok;
    });
    cursor = e;
  }
  out += html.slice(cursor);
  return out;
}

const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let totalChanged = 0, totalSwaps = 0;
const roleTally = {};

for (const f of files) {
  const abs = path.join(ROOT, f);
  const html = fs.readFileSync(abs, 'utf8');
  const counter = { n: 0, map: {} };
  const next = rewriteCss(html, counter);
  if (!counter.n) continue;
  totalChanged++; totalSwaps += counter.n;
  for (const t of Object.values(counter.map)) roleTally[t] = (roleTally[t] || 0) + 1;
  if (APPLY) fs.writeFileSync(abs, next, 'utf8');
  console.log(`${APPLY ? 'rethemed' : 'would retheme'}  ${f.padEnd(48)} ${String(counter.n).padStart(4)} declaration(s)`);
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`${APPLY ? 'Rethemed' : 'Would retheme'} ${totalSwaps} CSS colour declarations across ${totalChanged} page(s).`);
console.log('By role:', Object.entries(roleTally).map(([k, v]) => `${k}=${v}`).join('  ') || 'none');
if (!APPLY) console.log('\nDry run. Re-run with --apply to write.');
