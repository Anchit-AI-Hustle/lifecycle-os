/**
 * Fixture DOCUMENTS for brand-guide-upload.spec.js, built here byte by byte so
 * the reader is driven by real files rather than by objects shaped like its
 * output: a PDF (text on three pages and an embedded logo image), a PNG, a
 * WOFF made from a real TrueType font, a DOCX (a zip), a DESIGN.md, a W3C
 * token file and a CSS file. Nothing here is read by the app at runtime.
 */
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ── PNG ──────────────────────────────────────────────────────────────────── */
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A w x h PNG: `fill(x, y)` -> [r, g, b]. */
function png(w, h, fill) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) { const [r, g, b] = fill(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** The logo: a green tile with a copper bar - distinct pixels, so the extracted image can be checked. */
const LOGO_RGB = (w, h) => (x, y) => (y > h * 0.6 && y < h * 0.75 ? [184, 83, 31] : [26, 107, 60]);

/* ── PDF ─────────────────────────────────────────────────────────────────── */
function pdfString(s) { return '(' + String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')'; }
/**
 * pages: [{ lines: [text, ...], image: true|false }]. Lines are set top-down
 * in Helvetica 12; an image page draws the 48x48 logo at the top right.
 */
function pdf(pages, opts) {
  const o = opts || {};
  const objs = [];            // [Buffer]
  const add = (body) => { objs.push(body); return objs.length; };
  const font = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  const W = 48, H = 48;
  const rgb = Buffer.alloc(W * H * 3);
  const f = LOGO_RGB(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = f(x, y); rgb[(y * W + x) * 3] = r; rgb[(y * W + x) * 3 + 1] = g; rgb[(y * W + x) * 3 + 2] = b; }
  const imgData = zlib.deflateSync(rgb);
  const image = add(Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${imgData.length} >>\nstream\n`),
    imgData, Buffer.from('\nendstream'),
  ]));
  const pagesId = objs.length + 1 + pages.length * 2;     // reserved below
  const kids = [];
  for (const p of pages) {
    let ops = '';
    let y = 740;
    for (const line of p.lines) {
      if (line) ops += `BT /F1 12 Tf 56 ${y} Td ${pdfString(line)} Tj ET\n`;
      y -= 22;
    }
    if (p.image) ops += `q ${W * 2} 0 0 ${H * 2} 440 650 cm /Im1 Do Q\n`;
    const content = Buffer.from(ops, 'latin1');
    const cId = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]));
    const pId = add(Buffer.from(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> /XObject << /Im1 ${image} 0 R >> >> /Contents ${cId} 0 R >>`));
    kids.push(pId);
  }
  const pagesObj = add(Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`));
  if (pagesObj !== pagesId) throw new Error('pdf fixture: object numbering drifted');
  const catalog = add(Buffer.from(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`));
  const info = o.title ? add(Buffer.from(`<< /Title ${pdfString(o.title)} >>`)) : 0;
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets = [];
  let pos = parts[0].length;
  objs.forEach((body, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(b); pos += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((off) => String(off).padStart(10, '0') + ' 00000 n \n').join('');
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''} >>\nstartxref\n${pos}\n%%EOF\n`;
  parts.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(parts);
}

/** The brand book: page 1 identity + logo, page 2 colour, page 3 type + voice + components. */
const BOOK_PAGES = [
  { image: true, lines: [
    'Harbourlight Brand Guidelines',
    'Brand name: Harbourlight Goods',
    'Tagline: Light, made by hand',
    'Website: harbourlight.example',
    'Our logo',
    'Logo clear space: keep 24px clear on every side of the logo.',
    'Minimum size: 32px wide',
  ] },
  { lines: [
    'Colour palette',
    'Primary - Harbour Green',
    'HEX #1A6B3C',
    'RGB 26 107 60',
    'Accent: Copper #B8531F',
    'Text colour #15201C',
    'Background #FBFAF6',
    'Sea Mist',
    'CMYK 20 0 5 0',
    'Secondary text should be a soft grey colour, never pure black.',
  ] },
  { lines: [
    'Typography',
    'Headings: Fraunces SemiBold 44/52px',
    'Body copy: Inter Regular 16/24',
    'Tone of voice: warm, plain-spoken, never hyped',
    'Words we use: hand-made, harbour, lantern',
    'Banned words: game-changer, hurry, last chance',
    'Never use em dashes.',
    'Buttons: background #1A6B3C, text #FFFFFF, corner radius 6px, padding 12px 24px, uppercase',
    'Spacing: 8px base unit',
    'Container max width 1200px',
    'Copyright 2026 Harbourlight Goods Ltd. All rights reserved.',
  ] },
];

/* ── WOFF 1.0 from a TrueType file ───────────────────────────────────────── */
function woffFromTtf(ttf) {
  const numTables = ttf.readUInt16BE(4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables.push({ tag: ttf.slice(o, o + 4), checksum: ttf.readUInt32BE(o + 4), offset: ttf.readUInt32BE(o + 8), length: ttf.readUInt32BE(o + 12) });
  }
  const pad4 = (n) => (n + 3) & ~3;
  let totalSfnt = 12 + 16 * numTables;
  const datas = tables.map((t) => {
    const orig = ttf.slice(t.offset, t.offset + t.length);
    totalSfnt += pad4(t.length);
    const z = zlib.deflateSync(orig);
    return z.length < orig.length ? z : orig;
  });
  let off = 44 + 20 * numTables;
  const dir = Buffer.alloc(20 * numTables);
  const body = [];
  tables.forEach((t, i) => {
    t.tag.copy(dir, i * 20);
    dir.writeUInt32BE(off, i * 20 + 4);
    dir.writeUInt32BE(datas[i].length, i * 20 + 8);
    dir.writeUInt32BE(t.length, i * 20 + 12);
    dir.writeUInt32BE(t.checksum, i * 20 + 16);
    const padded = Buffer.alloc(pad4(datas[i].length)); datas[i].copy(padded);
    body.push(padded); off += padded.length;
  });
  const head = Buffer.alloc(44);
  head.write('wOFF', 0, 'ascii');
  ttf.copy(head, 4, 0, 4);
  head.writeUInt32BE(off, 8);
  head.writeUInt16BE(numTables, 12);
  head.writeUInt32BE(totalSfnt, 16);
  head.writeUInt16BE(1, 20);
  return Buffer.concat([head, dir, ...body]);
}
function ttf() { return fs.readFileSync(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts', 'LiberationSans-Regular.ttf')); }

/* ── DOCX ────────────────────────────────────────────────────────────────── */
function docx() {
  const { zipSync, strToU8 } = require('fflate');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`;
  const logo = `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Picture 1" descr="Harbourlight logo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const cell = (t, fill) => `<w:tc><w:tcPr>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>${p(t)}</w:tc>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
${p('Harbourlight Style Guide')}${p('Brand name: Harbourlight Goods')}${logo}${p('Colours')}
<w:tbl><w:tr>${cell('Primary', '1A6B3C')}${cell('#1A6B3C')}</w:tr><w:tr>${cell('Accent', 'B8531F')}${cell('Copper')}</w:tr></w:tbl>
${p('Headings: Fraunces Bold')}${p('Body copy: Inter Regular')}${p('Tone of voice: warm and plain-spoken')}
</w:body></w:document>`;
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(doc),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/></Relationships>'),
    'word/media/logo.png': new Uint8Array(png(64, 64, LOGO_RGB(64, 64))),
  }));
}

/* ── text formats ────────────────────────────────────────────────────────── */
const DESIGN_MD = `---
version: alpha
name: Harbourlight Goods
colors:
  primary: "#1A6B3C"  # https://harbourlight.example/theme.css
  secondary: "#B8531F"
  on-primary: "#FFFFFF"  # DERIVED from primary
  surface: "#FBFAF6"
  on-surface: "#15201C"
typography:
  headline-lg:
    fontFamily: Fraunces
    fontSize: 44px
    fontWeight: 600
  body-md:
    fontFamily: Inter
    fontSize: 16px
rounded:
  md: 6px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.md}"
---

## Overview

Tone of voice: warm and plain-spoken
`;

const TOKENS_JSON = JSON.stringify({
  color: {
    $type: 'color',
    brand: { primary: { $value: '#1A6B3C' }, accent: { $value: '#B8531F' } },
    text: { default: { $value: '#15201C' } },
    background: { default: { $value: { colorSpace: 'srgb', components: [0.984, 0.98, 0.965], hex: '#FBFAF6' } } },
  },
  font: { family: { heading: { $type: 'fontFamily', $value: ['Fraunces', 'Georgia', 'serif'] }, body: { $type: 'fontFamily', $value: 'Inter' } } },
  radius: { md: { $type: 'dimension', $value: '6px' } },
}, null, 2);

const CSS = `/* Harbourlight tokens */
:root {
  --brand-primary: #1a6b3c;
  --brand-accent: #b8531f;
  --color-text: #15201c;
  --color-background: #fbfaf6;
  --font-heading: "Fraunces", Georgia, serif;
  --radius-md: 6px;
}
@font-face { font-family: "Harbour Sans"; src: url("https://cdn.harbourlight.example/fonts/harbour-sans.woff2") format("woff2"); }
body { font-family: "Inter", system-ui, sans-serif; }
`;

/** An SVG "logo" carrying a script and an onload handler. */
const EVIL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" onload="window.__svgOnload=1">
<script>window.__svgScript=1</script>
<rect x="0" y="0" width="96" height="96" fill="#1a6b3c"/><a href="javascript:window.__svgHref=1"><circle cx="48" cy="48" r="20" fill="#b8531f"/></a>
</svg>`;

module.exports = { png, pdf, BOOK_PAGES, woffFromTtf, ttf, docx, DESIGN_MD, TOKENS_JSON, CSS, EVIL_SVG, LOGO_RGB };
