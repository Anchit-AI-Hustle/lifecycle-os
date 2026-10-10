/**
 * A starter brand is read from the site its CUSTOMERS see (2026-10-10).
 * ---------------------------------------------------------------------------
 * The operator's screenshots of /onboarding's starter gallery: nearly every
 * card on grey default swatches. The harvest had read, for many brands, the
 * wrong page: jobs.myntra.com, careers.loreal.com, newsroom.sephora.com,
 * hmgroup.com, report.adidas-group.com, about.nike.com, jobs.netflix.com. Those
 * hosts are the brand's own (ownership is right about that), but a careers
 * portal, a newsroom, an investor or annual-report site and a group holding
 * company's site are designed for recruits, journalists and shareholders - and
 * three presets (Nike, New Balance, Netflix) and BMW had shipped a palette
 * read off one.
 *
 * The guard lives in three places, each executed here:
 *   1. the harvester (scripts/harvest-presets.js) never READS such a page:
 *      the reader is a module that records every call, and it records none;
 *   2. the mapping (scripts/lib/preset-observation.js) turns a read that asked
 *      for, or LANDED on, such a page into `renderer:'blocked'` with the
 *      sentence "<host> is not the brand's consumer site ...", and no palette;
 *   3. the builder (scripts/build-brand-presets.js) refuses a palette, type or
 *      logo a STORED observation took from such a page - run over the very
 *      observation New Balance shipped with, read off jobs.newbalance.com.
 * And every shipped preset's harvest URLs (website + identity_sources) are on
 * the brand's consumer site.
 *
 * Run: npx playwright test tests/preset-consumer-sites.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const obsLib = require(path.join(ROOT, 'scripts', 'lib', 'preset-observation.js'));
const own = require(path.join(ROOT, 'scripts', 'lib', 'brand-ownership.js'));
const harvester = require(path.join(ROOT, 'scripts', 'harvest-presets.js'));

const DAY = '2026-10-10';
const NOT_CONSUMER = /is not the brand's consumer site/;

function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), `preset-consumer-${tag}-`)); }

/** A reader in readSite's shape that records every URL it is asked for. */
function recordingReader() {
  const dir = tmpDir('reader');
  const file = path.join(dir, 'reader.js');
  fs.writeFileSync(file, [
    "'use strict';",
    'const calls = [];',
    'module.exports = {',
    '  calls,',
    '  readSite: async (u) => { calls.push(u); return { ok: true, renderer: "rendered", manifest: { url: u, link_hosts: [] } }; },',
    '  readImage: async (u) => { calls.push(u); return { ok: true, renderer: "image", image: { url: u } }; },',
    '};',
  ].join('\n'));
  return { file, calls: require(file).calls };
}

/* A manifest in the reader's own shape, at a given page. */
function manifestAt(url, primary) {
  const src = (role, selector) => ({ page: url, role, selector, viewport: 'desktop', property: 'background-color', signal: 'computed' });
  return {
    version: 'design-manifest/1', url, start: url, read_at: `${DAY}T10:00:00.000Z`,
    pages: [{ url, role: 'home' }],
    colors: {
      primary: { value: primary, source: src('theme-color', 'meta[name=theme-color]'), signal: 'meta theme-color', from_role: 'identity' },
      surface: { value: '#ffffff', source: src('page ground', 'body') },
      ink: { value: '#1a1a1a', source: src('body copy', 'main > p') },
    },
    fonts: {
      heading: { family: 'Inter', kind: 'webfont', google: true, stack: "'Inter',sans-serif", weights: ['700'], source: src('h1', 'h1') },
      body: { family: 'Inter', kind: 'webfont', google: true, stack: "'Inter',sans-serif", weights: ['400'], source: src('body copy', 'main > p') },
    },
    assets: { logo: { url: `${new URL(url).origin}/logo.svg`, source: src('logo', 'header a img') }, images: [] },
    read: { desktop: { roles: {} } },
  };
}

test('the rule: careers, jobs, newsroom, investor, press, corporate, report and group sites are not consumer sites', () => {
  const refused = [
    ['https://jobs.myntra.com/home', 'https://www.myntra.com'],
    ['https://careers.loreal.com/', 'https://www.loreal.com'],
    ['https://newsroom.sephora.com/', 'https://www.sephora.com'],
    ['https://news-room.example.com/', 'https://www.example.com'],
    ['https://investors.makemytrip.com/', 'https://www.makemytrip.com'],
    ['https://ir.example.com/', 'https://www.example.com'],
    ['https://press.example.co.uk/', 'https://www.example.co.uk'],
    ['https://corporate.mcdonalds.com/corpmcd/home.html', 'https://www.mcdonalds.com'],
    ['https://report.adidas-group.com/', 'https://www.adidas.com'],
    ['https://hmgroup.com/brands/', 'https://www2.hm.com'],
    ['https://www.bmwgroup.com/en.html', 'https://www.bmw.com'],
    ['https://about.nike.com/en', 'https://www.nike.com'],
    ['https://www.aboutamazon.com/', 'https://www.amazon.com'],
    ['https://www.loreal.com/en/mediaroom/', 'https://www.loreal.com'],
  ];
  for (const [url, website] of refused) {
    const c = own.consumerSite(url, website);
    expect(c.ok, `${url} was taken as a consumer site`).toBe(false);
    expect(c.code).toBe('not_consumer_site');
    expect(c.reason).toMatch(NOT_CONSUMER);
    expect(c.reason.startsWith(new URL(url).hostname)).toBe(true);
  }
  for (const [url, website] of [
    ['https://www.myntra.com/', 'https://www.myntra.com'],
    ['https://www2.hm.com/en_in/index.html', 'https://www2.hm.com'],
    ['https://www.adidas.co.in/', 'https://www.adidas.com'],
    ['https://in.puma.com/in/en', 'https://www.puma.com'],
    ['https://www.newbalance.com/about-us.html', 'https://www.newbalance.com'],
    ['https://brand.toyota.com/guidelines/visual/brand-colors', 'https://www.toyota.com'],
    ['http://127.0.0.1:4321/', 'http://127.0.0.1:4321/'],
  ]) expect(own.consumerSite(url, website).ok, `${url} was refused`).toBe(true);
});

test('the harvester never reads a careers, press, investor or group site, and says why', async () => {
  const reader = recordingReader();
  const preset = {
    slug: 'hm', name: 'H&M', website: 'https://www2.hm.com',
    identity_sources: [
      { url: 'https://hmgroup.com/brands/', kind: 'page', what: 'H&M Group brands page' },
      { url: 'https://careers.hm.com/', kind: 'page', what: 'careers' },
      { url: 'https://www2.hm.com/en_gb/index.html', kind: 'page', what: 'H&M UK store front' },
    ],
  };
  const home = { ok: true, manifest: { url: 'https://www2.hm.com/en_in/index.html', link_hosts: [] } };
  const out = await harvester.readSources(preset, home, { readerPath: reader.file });
  const byUrl = Object.fromEntries(out.map((s) => [s.url, s]));
  for (const url of ['https://hmgroup.com/brands/', 'https://careers.hm.com/']) {
    expect(byUrl[url].result).toEqual(expect.objectContaining({ ok: false, renderer: 'blocked', code: 'not_consumer_site' }));
    expect(byUrl[url].result.reason).toMatch(NOT_CONSUMER);
  }
  // The store front is read; nothing else was asked of the reader.
  expect(reader.calls).toEqual(['https://www2.hm.com/en_gb/index.html']);

  // A preset whose website is itself such a page is not read at all.
  const homeRead = await harvester.readOne({ slug: 'x', name: 'X', website: 'https://jobs.example.com/' }, { readerPath: reader.file });
  expect(homeRead).toEqual(expect.objectContaining({ ok: false, renderer: 'blocked', code: 'not_consumer_site' }));
  expect(reader.calls).toEqual(['https://www2.hm.com/en_gb/index.html']);
});

test('the mapping records a read of such a page as blocked with the reason, and no palette, type or logo', () => {
  const preset = { slug: 'myntra', name: 'Myntra', website: 'https://www.myntra.com' };
  // The home page REDIRECTED to the careers site: what landed is what counts.
  const landed = obsLib.observationFromRead(preset, { ok: true, renderer: 'rendered', manifest: manifestAt('https://jobs.myntra.com/home', '#e91e63') }, DAY);
  expect(landed.ok).toBe(false);
  expect(landed.renderer).toBe('blocked');
  expect(landed.palette).toBeFalsy();
  expect(landed.typography).toBeFalsy();
  expect(landed.logo_url).toBeFalsy();
  expect(landed.reason).toMatch(/^jobs\.myntra\.com is not the brand's consumer site/);
  expect(landed.read_attempt).toEqual(expect.objectContaining({ renderer: 'blocked', code: 'not_consumer_site' }));
  expect(obsLib.readSentence(landed.read_attempt)).toMatch(/^jobs\.myntra\.com is not the brand's consumer site .*\(checked 2026-10-10\)\.$/);

  // The home page refused; the only source that rendered is a careers page.
  const home = { ok: false, renderer: 'blocked', reason: 'www.myntra.com answered HTTP 403 to the browser\'s request.' };
  const sources = [{
    url: 'https://jobs.myntra.com/home', kind: 'page', what: 'careers',
    owned: { ok: true, how: 'same-registrable-domain', host: 'jobs.myntra.com' },
    result: { ok: true, renderer: 'rendered', manifest: manifestAt('https://jobs.myntra.com/home', '#e91e63') },
  }];
  const obs = obsLib.observationFromReads(preset, home, sources, DAY);
  expect(obs.ok).toBe(false);
  expect(obs.palette_ok).toBe(false);
  expect(obs.palette).toBeFalsy();
  const row = obs.reads.find((r) => r.url === 'https://jobs.myntra.com/home');
  expect(row).toEqual(expect.objectContaining({ ok: false, renderer: 'blocked', code: 'not_consumer_site' }));
  expect(row.reason).toMatch(NOT_CONSUMER);
  expect(obsLib.sourcesSentence(obs.reads)).toContain('jobs.myntra.com (not the brand\'s consumer site)');
});

test('the builder refuses the palette New Balance shipped with, read off its careers site', () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands', 'observed', 'new-balance.observed.json'), 'utf8'));
  // The stored record this guard exists for: a palette whose primary names a
  // read of jobs.newbalance.com. If a re-harvest replaced it, build one.
  const careers = shipped.palette_ok && /jobs\.newbalance\.com/.test(String(shipped.palette_evidence && shipped.palette_evidence.primary && shipped.palette_evidence.primary.read_url))
    ? shipped
    : null;
  test.skip(!careers, 'the shipped observation no longer carries the careers-site palette');
  const dir = tmpDir('observed');
  fs.writeFileSync(path.join(dir, 'new-balance.observed.json'), JSON.stringify(careers));
  const out = tmpDir('out');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-brand-presets.js'), '--observed', dir, '--out', out], { stdio: 'pipe' });
  const rec = JSON.parse(fs.readFileSync(path.join(out, 'new-balance.json'), 'utf8'));
  expect(rec.preset.palette_source).toBe('default');
  expect(rec.palette.primary).not.toBe(careers.palette.primary);
  expect(rec.preset.typography_source).toBe('default');
  expect(String(rec.logo_url || '')).not.toMatch(/jobs\.newbalance\.com/);
  const row = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')).presets.find((p) => p.slug === 'new-balance');
  expect(row.read_note).toContain('jobs.newbalance.com (not the brand\'s consumer site)');
});

test('no shipped preset is harvested from a careers, press, investor, report or corporate-group site', () => {
  const dir = path.join(ROOT, 'data', 'brands', 'presets');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
  expect(files.length).toBeGreaterThanOrEqual(40);
  let urls = 0;
  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const u of [rec.website].concat((rec.identity_sources || []).map((s) => s.url))) {
      if (!u) continue;
      urls += 1;
      const c = own.consumerSite(u, rec.website);
      expect(c.ok, `${rec.slug}: ${u} - ${c.reason || ''}`).toBe(true);
    }
    // And no palette it ships was read off one.
    for (const u of rec.preset.read_from || []) expect(own.consumerSite(/^https?:/.test(u) ? u : `https://${u}/`, rec.website).ok, `${rec.slug} read from ${u}`).toBe(true);
  }
  expect(urls).toBeGreaterThan(files.length);
});
