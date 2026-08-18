// Turning an operator's reference into a text brief the LLM cascade can read.
//
// This module fetches URLS THE OPERATOR SUPPLIES, from the SERVER. That is the
// whole feature ("here is a competitor's ad, describe it") and it is also a
// server-side request forgery primitive aimed at the deployment's own network
// unless the destination is checked. The sibling this was ported from validated
// the SCHEME only, which accepts http://169.254.169.254/ quite happily.
//
// Run: npx playwright test tests/reference-intel.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'api', '_shared', 'reference-intel.js');
const ref = require(MODULE);

/* ═══ SSRF ════════════════════════════════════════════════════════════════ */

const HOSTILE = [
  ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
  ['http://127.0.0.1/admin', 'loopback'],
  ['http://10.0.0.5/internal', 'private range'],
  ['http://192.168.1.1/', 'private range'],
  ['http://172.16.0.1/', 'private range'],
  ['http://localhost:5432/', 'localhost on a database port'],
  ['file:///etc/passwd', 'file scheme'],
  ['javascript:alert(1)', 'javascript scheme'],
];

test('a page reference cannot be pointed at the internal network', async () => {
  for (const [url, label] of HOSTILE) {
    const out = await ref.fetchPageBrief(url);
    expect(out.ok, `${label} (${url}) was fetched`).toBe(false);
    expect(out.reason, `${label} gave no reason`).toBeTruthy();
  }
});

test('a media reference cannot be pointed at the internal network either', async () => {
  // Two separate call sites take an operator URL; guarding only one is the
  // classic way this reappears.
  for (const [url, label] of HOSTILE.slice(0, 5)) {
    const out = await ref.describeMedia({ kind: 'image', url, label: 'ref' });
    expect(out.ok, `${label} was fetched through the media path`).toBe(false);
  }
});

test('a non-standard port is refused even on a public host', async () => {
  // Otherwise an internal service on a public-resolving name is still reachable.
  const out = await ref.fetchPageBrief('http://example.com:22/');
  expect(out.ok).toBe(false);
  expect(out.reason).toMatch(/port/i);
});

test('the guard is the shared one, not a second implementation', () => {
  const src = fs.readFileSync(MODULE, 'utf8');
  // A private copy of the rules drifts from the one the catalogue importer and
  // the Ollama base URL use, and it will not re-resolve the hostname.
  expect(src).toMatch(/assertPublicUrl/);
  expect(src).toMatch(/function assertFetchable/);
  // Neither entry point may still be gated on the scheme alone.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  expect(code).not.toMatch(/if \(!isHttpUrl\(url\)\) return \{ ok: false, kind: 'page'/);
  expect(code).not.toMatch(/if \(!isHttpUrl\(raw\.url\)\)/);
});

/* ═══ identity ════════════════════════════════════════════════════════════ */

test('the outbound User-Agent does not name another company', () => {
  const src = fs.readFileSync(MODULE, 'utf8');
  // Assembled rather than written out: tests/ ships inside the deployed output
  // root, so a literal would be the occurrence it is checking for.
  expect(src.toLowerCase()).not.toContain(['vah', 'dam'].join(''));
  // Every request this module makes announces THIS platform.
  const uas = [...src.matchAll(/'User-Agent':\s*'([^']+)'/g)].map((m) => m[1]);
  expect(uas.length).toBeGreaterThan(0);
  for (const ua of uas) expect(ua).toMatch(/LifecycleOS/);
});

/* ═══ it degrades rather than throwing ════════════════════════════════════ */

test('an unreadable reference is reported, not thrown', async () => {
  for (const bad of [null, undefined, '', 'not a url', {}]) {
    const out = await ref.describeMedia({ kind: 'image', url: bad, label: 'x' });
    expect(out.ok).toBe(false);
    expect(typeof out.reason).toBe('string');
  }
});

test('an oversized upload is refused with its actual size', async () => {
  // A data URI just over the image cap.
  const big = 'data:image/png;base64,' + 'A'.repeat(Math.ceil((ref.MAX_IMAGE_BYTES + 1024) * 4 / 3));
  const out = await ref.describeMedia({ kind: 'image', data_uri: big, label: 'big' });
  expect(out.ok).toBe(false);
  expect(out.reason).toMatch(/MB/);
});

test('the size caps are real numbers, not undefined', () => {
  expect(ref.MAX_IMAGE_BYTES).toBeGreaterThan(0);
  expect(ref.MAX_VIDEO_BYTES).toBeGreaterThan(ref.MAX_IMAGE_BYTES);
});
