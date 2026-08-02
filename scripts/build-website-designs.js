#!/usr/bin/env node
/** Build the public index of every finished, directly addressable website design. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const groups = [
  { dir: 'landing-pages/airbrush-matrix', family: 'Airbrush Matrix', include: /Variant[^/]*\.html$/i },
  { dir: 'landing-pages/final', family: 'Final Landing Pages', include: /\.html$/i },
  { dir: 'landing-pages/usa-july', family: 'USA July Campaigns', include: /\.html$/i },
];
const roots = [
  'coffee-collection-landing-no-agent.html', 'coffee-collection-landing-with-agent.html',
  'knickgasm-grail-drop-presell-v5-variantA.html', 'knickgasm-grail-drop-presell-v5-variantB.html',
  'knickgasm-lifecycle-campaign-from-the-30-d-us-variantB.html',
];
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
function sanitizeTitleText(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function title(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return sanitizeTitleText(match ? match[1] : path.basename(file, '.html'));
}
function entry(file, family) {
  const parts = file.split('/');
  const variant = (path.basename(file).match(/Variant([A-Z]\d?)/i) || [])[1] || '';
  const angle = family === 'Airbrush Matrix' ? parts[2].replace(/-/g, ' ') : '';
  return { id: file.replace(/\.html$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase(), title: title(file), family, angle, variant, url: '/' + file };
}
const designs = [];
for (const g of groups) {
  const dir = path.join(ROOT, g.dir);
  for (const abs of walk(dir).sort()) {
    const file = path.relative(ROOT, abs).split(path.sep).join('/');
    if (g.include.test(file)) designs.push(entry(file, g.family));
  }
}
for (const file of roots) if (fs.existsSync(path.join(ROOT, file))) designs.push(entry(file, 'Standalone Concepts'));
const out = { count: designs.length, designs };
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data/website-designs.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`Built data/website-designs.json with ${designs.length} direct templates.`);
