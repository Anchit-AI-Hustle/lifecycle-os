#!/usr/bin/env node
'use strict';
/**
 * scripts/harvest-presets.js — read every starter brand's own site in a real
 * browser and write what it RENDERS beside the presets.
 *
 *   node scripts/harvest-presets.js                         # every preset
 *   node scripts/harvest-presets.js --slugs nike,airtel     # some
 *   node scripts/harvest-presets.js --artifacts out/        # + screenshots and reports
 *   node scripts/harvest-presets.js --report-before old-index.json   # before/after table
 *
 * THE READER IS NOT HERE. Each site is read by `api/_shared/brand-render.js`
 * `readSite()` - the platform's one rendered reader (headless Chromium,
 * computed styles by element role, per-value provenance, its own SSRF and
 * robots.txt rules, its honest user agent, and the visual regression of our
 * own renderers against the site). This script only schedules reads, maps
 * each manifest through `scripts/lib/preset-observation.js`, and writes
 * `data/brands/observed/<slug>.observed.json`. A second reader here would
 * drift from the first.
 *
 * WHERE IT CAN RUN. It needs the public internet. The Claude Code container's
 * egress proxy refuses brand hosts; GitHub's runners do not, which is why
 * `.github/workflows/harvest-presets.yml` runs it.
 *
 * WHAT IT WRITES, PER BRAND, and the rule it keeps:
 *   rendered     palette + type + logo + images, each value with its page,
 *                role, selector and viewport, and the regression score.
 *   blocked      the site refused an automated reader (a 403/429/503, a
 *   timeout      challenge page, robots.txt) or did not finish in time:
 *   unavailable  `ok:false`, the reason, NO palette. The preset stays on the
 *                neutral default and the gallery says why. No stealth, no
 *                borrowed user agent, no colour from memory or from a third
 *                party's "brand colours" page.
 * A failure of THIS ENVIRONMENT (no browser, the reader module missing) is
 * not a fact about any brand, so nothing is written for it and the run fails.
 *
 * POLITE. One browser per read (the reader's own isolation), at most
 * `--concurrency` reads at once (default 3, each a different host), a
 * per-site deadline the reader enforces plus a hard stop here, and at most
 * `--max-pages` extra pages per site (default 2).
 *
 * NOT data/brands/presets: every reader of that directory treats each *.json
 * but index.json as a brand record (CLAUDE.md, 2026-10-03).
 */

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PRESETS_DIR = path.join(ROOT, 'data', 'brands', 'presets');
const OBS_DIR = path.join(ROOT, 'data', 'brands', 'observed');
const obsLib = require('./lib/preset-observation.js');
const ownershipLib = require('./lib/brand-ownership.js');

const READER = path.join(ROOT, 'api', '_shared', 'brand-render.js');
const ENV_FAILURE = /no chromium binary|executable doesn't exist|failed to launch|browsertype\.launch|cannot find module|readSite is not a function|the rendered reader is not installed/i;

function args(argv) {
  const out = { slugs: [], allowOrigins: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--slug' || a === '--slugs') out.slugs.push(...String(next() || '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--index') out.index = next();
    else if (a === '--out') out.out = next();
    else if (a === '--artifacts') out.artifacts = next();
    else if (a === '--concurrency') out.concurrency = Number(next());
    else if (a === '--deadline-ms') out.deadlineMs = Number(next());
    else if (a === '--max-pages') out.maxPages = Number(next());
    else if (a === '--first-document-ms') out.firstDocumentMs = Number(next());
    else if (a === '--per-request-ms') out.perRequestMs = Number(next());
    else if (a === '--source-deadline-ms') out.sourceDeadlineMs = Number(next());
    else if (a === '--retries') out.retries = Number(next());
    else if (a === '--no-sources') out.sources = false;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--no-regression') out.regression = false;
    else if (a === '--allow-origin') out.allowOrigins.push(next());
    else if (a === '--observed-at') out.observedAt = next();
    else if (a === '--report-before') out.reportBefore = next();
    else if (a === '--child') out.child = true;
  }
  return out;
}

/** Only loopback origins may skip the public-URL guard, and only for fixtures. */
function loopbackOrigins(list) {
  return (list || []).filter((o) => /^http:\/\/(127\.0\.0\.\d{1,3}|localhost):\d{2,5}$/.test(String(o || '')));
}

function isEnvFailure(result) {
  if (!result) return true;
  if (result.code === 'no_browser' || result.code === 'reader_missing') return true;
  return ENV_FAILURE.test(String(result.reason || ''));
}

/* ── one read, in a child process ────────────────────────────────────────── */

/**
 * THE HARVEST'S OWN BUDGET. It runs on a CI runner, not inside a serverless
 * function's time limit, so a slow brand gets longer than "Read my site" can
 * give it - the Vercel path's budget (READ_HARD_MS in brand-render.js) is
 * untouched. Navigation waits for DOMContentLoaded plus a bounded settle,
 * never for network idle, and a read that TIMED OUT is tried once more.
 */
const HARVEST = {
  deadlineMs: 150000, manifestMs: 110000, firstDocumentMs: 30000, navMs: 45000,
  retries: 1, sourceDeadlineMs: 75000, maxSources: 4,
};

function isTimeout(r) {
  return !!r && !r.ok && (r.renderer === 'timeout' || /took longer than|timed? ?out/i.test(String(r.reason || '')));
}

function loadReader(opts) {
  try {
    const reader = require(opts.readerPath || READER);
    if (typeof reader.readSite !== 'function') return { error: { ok: false, renderer: 'unavailable', code: 'reader_missing', reason: 'The rendered reader is not installed in this checkout: readSite is not a function.' } };
    return { reader };
  } catch (e) {
    return { error: { ok: false, renderer: 'unavailable', code: 'reader_missing', reason: `The rendered reader is not installed in this checkout (${String(e.message).split('\n')[0]}).` } };
  }
}

/** readSite, tried again once when it timed out. Carries `attempts`. */
async function readPage(reader, url, o, opts) {
  const retries = Math.max(0, opts.retries == null ? HARVEST.retries : opts.retries);
  let r = null;
  let attempts = 0;
  const tried = [];
  while (attempts <= retries) {
    attempts += 1;
    r = await reader.readSite(url, o);
    if (!isTimeout(r)) break;
    tried.push(String(r.reason || 'timed out').slice(0, 200));
  }
  return Object.assign(r || { ok: false, renderer: 'unavailable', reason: 'not read' }, { attempts, timed_out_before: tried.length && r && r.ok ? tried : undefined });
}

async function readOne(preset, opts) {
  const { reader, error } = loadReader(opts);
  if (error) return error;
  const allow = loopbackOrigins(opts.allowOrigins);
  const deadlineMs = opts.deadlineMs || HARVEST.deadlineMs;
  return readPage(reader, preset.website, {
    deadlineMs,
    manifestMs: Math.max(20000, Math.min(HARVEST.manifestMs, deadlineMs - 30000)),
    maxPages: opts.maxPages,
    regression: opts.regression !== false,
    // A brand's home page is often the slowest document it serves; the
    // harvest gives it 30 s (the reader's per-request default is 9 s).
    firstDocumentMs: opts.firstDocumentMs || HARVEST.firstDocumentMs,
    perRequestMs: opts.perRequestMs || undefined,
    navMs: opts.navMs || HARVEST.navMs,
    policy: allow.length ? { allowOrigins: new Set(allow) } : undefined,
  }, opts);
}

/**
 * The brand's OTHER own material (`identity_sources`): its guidelines, press
 * or newsroom pages and its logo file. Each URL must be the brand's own
 * (scripts/lib/brand-ownership.js) before anything is fetched from it: same
 * registrable domain as the website, or linked from a page read on it. A
 * source on the brand's own domain is read first, so a page it links to can
 * be shown to be the brand's. Pages are read without the regression or the
 * phone width (only the identity they declare is wanted); a logo file is
 * drawn and its pixels read.
 */
/**
 * The site's own icons at their WELL-KNOWN paths, read when its home page did
 * not render (a 403, a bot challenge, a timeout). A browser asks every site
 * for these; they are the brand's own mark on its own origin, and the image
 * read honours robots.txt like any document read.
 */
const WELL_KNOWN_ICONS = ['/apple-touch-icon.png', '/favicon.svg', '/favicon.ico'];
function wellKnownIcons(preset) {
  let origin = '';
  try { origin = new URL(preset.website).origin; } catch (_) { return []; }
  return WELL_KNOWN_ICONS.map((p) => ({ url: origin + p, kind: 'image', what: `the site's own icon at its well-known path (${p})` }));
}

async function readSources(preset, home, opts) {
  const homeRendered = !!(home && home.ok && home.manifest);
  const list = (preset.identity_sources || []).filter((s) => s && s.url).slice(0, HARVEST.maxSources)
    .concat(homeRendered ? [] : wellKnownIcons(preset));
  if (!list.length || opts.sources === false) return [];
  const { reader, error } = loadReader(opts);
  if (error) return list.map((s) => ({ url: s.url, kind: s.kind || 'page', what: s.what || '', result: error }));
  const allow = loopbackOrigins(opts.allowOrigins);
  const policy = allow.length ? { allowOrigins: new Set(allow) } : undefined;
  const evidence = home && home.ok && home.manifest ? [{ page: home.manifest.url, link_hosts: home.manifest.link_hosts || [] }] : [];
  const homeReg = ownershipLib.registrableDomain(ownershipLib.hostOf(preset.website));
  const ordered = list.slice().sort((a, b) => (ownershipLib.registrableDomain(ownershipLib.hostOf(a.url)) === homeReg ? 0 : 1) - (ownershipLib.registrableDomain(ownershipLib.hostOf(b.url)) === homeReg ? 0 : 1));
  const out = [];
  const silent = new Set();
  const dl = opts.sourceDeadlineMs || HARVEST.sourceDeadlineMs;
  for (const s of ordered) {
    const kind = s.kind === 'image' ? 'image' : 'page';
    const owned = ownershipLib.ownership(s.url, preset.website, evidence);
    if (!owned.ok) { out.push({ url: s.url, kind, what: s.what || '', refused: owned.reason }); continue; }
    const origin = (() => { try { return new URL(s.url).origin; } catch (_) { return ''; } })();
    if (kind === 'image' && silent.has(origin)) {
      out.push({ url: s.url, kind, what: s.what || '', owned, result: { ok: false, renderer: 'timeout', reason: `not tried: ${new URL(s.url).hostname} did not answer the previous image read in time` }, attempts: 0 });
      continue;
    }
    let result;
    if (kind === 'image') {
      result = typeof reader.readImage === 'function'
        ? await reader.readImage(s.url, { deadlineMs: Math.min(dl, 40000), policy, perRequestMs: 15000 })
        : { ok: false, renderer: 'unavailable', code: 'reader_missing', reason: 'The rendered reader has no readImage.' };
      result.attempts = 1;
      if (result.renderer === 'timeout') silent.add(origin);
    } else {
      result = await readPage(reader, s.url, {
        deadlineMs: dl, manifestMs: Math.max(20000, dl - 15000), maxPages: 0, regression: false, mobile: false,
        // A guidelines or press page shows the brand's logo in its content:
        // read it when the image names the brand.
        contentLogoName: preset.name || '',
        firstDocumentMs: opts.firstDocumentMs || HARVEST.firstDocumentMs, perRequestMs: opts.perRequestMs || undefined,
        navMs: opts.navMs || HARVEST.navMs, policy,
      }, opts);
    }
    out.push({ url: s.url, kind, what: s.what || '', owned, result, attempts: result.attempts || 1 });
    if (result.ok && result.manifest && owned.how === 'same-registrable-domain') evidence.push({ page: result.manifest.url, link_hosts: result.manifest.link_hosts || [] });
  }
  return out;
}

function writeArtifacts(dir, slug, result, observation, sources) {
  if (!dir) return;
  const d = path.join(dir, slug);
  fs.mkdirSync(d, { recursive: true });
  // Each identity source's own screenshot, beside the home page's.
  (sources || []).forEach((src, n) => {
    const sh = src && src.result && src.result.screenshots && src.result.screenshots.desktop;
    if (sh && sh.fold && sh.fold.data) fs.writeFileSync(path.join(d, `source-${n + 1}-desktop-fold.jpg`), Buffer.from(sh.fold.data, 'base64'));
  });
  const shots = (result && result.screenshots) || {};
  for (const vp of ['desktop', 'mobile']) {
    for (const kind of ['fold', 'full']) {
      const s = shots[vp] && shots[vp][kind];
      if (s && s.data) fs.writeFileSync(path.join(d, `${vp}-${kind}.${/png/.test(s.mime || '') ? 'png' : 'jpg'}`), Buffer.from(s.data, 'base64'));
    }
  }
  // OUR renderers as the regression drew them, beside the site's own shots.
  const reg = result && result.regression ? Object.assign({}, result.regression) : null;
  if (reg && reg.screenshots) {
    for (const [name, b64] of Object.entries(reg.screenshots)) {
      if (b64) fs.writeFileSync(path.join(d, `ours-${name.replace(/[^a-z0-9_-]/gi, '_')}.jpg`), Buffer.from(b64, 'base64'));
    }
  }
  if (reg) { delete reg.screenshots; delete reg.manifest; }
  const report = {
    observation,
    reader_result: result ? {
      ok: result.ok, renderer: result.renderer, reason: result.reason || '', code: result.code || '',
      renderer_info: result.renderer_info || null, wall_ms: result.wall_ms || null,
      regression: reg,
    } : null,
  };
  fs.writeFileSync(path.join(d, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (result && result.manifest) fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n');
}

if (require.main === module && process.argv.includes('--child')) {
  process.on('message', async (msg) => {
    const { preset, opts } = msg || {};
    let result;
    try {
      result = await readOne(preset, opts);
    } catch (e) {
      result = { ok: false, renderer: 'unavailable', reason: String((e && e.message) || e).split('\n')[0] };
    }
    const env = !result.ok && isEnvFailure(result);
    let sources = [];
    if (!env) {
      try { sources = await readSources(preset, result, opts); } catch (e) { sources = [{ url: '', refused: `the identity sources could not be read: ${String((e && e.message) || e).split('\n')[0]}` }]; }
    }
    const observation = env ? null : obsLib.observationFromReads(preset, result, sources.filter((x) => x.url), opts.observedAt);
    try { writeArtifacts(opts.artifacts, preset.slug, result, observation, sources); } catch (_) { /* artifacts are a convenience */ }
    process.send({ slug: preset.slug, env, reason: result.reason || '', observation }, () => process.exit(0));
  });
}

/* ── the run ─────────────────────────────────────────────────────────────── */

function runChild(preset, opts) {
  return new Promise((resolve) => {
    const child = fork(__filename, ['--child'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let done = false;
    // The hard stop covers every read the child makes: the home page and its
    // retry, then each identity source and its retry.
    const tries = 1 + Math.max(0, opts.retries == null ? HARVEST.retries : opts.retries);
    const nSources = opts.sources === false ? 0 : Math.min(HARVEST.maxSources, (preset.identity_sources || []).length) + WELL_KNOWN_ICONS.length;
    const hard = Math.max(30000, (opts.deadlineMs || HARVEST.deadlineMs) * tries + nSources * (opts.sourceDeadlineMs || HARVEST.sourceDeadlineMs) * tries + 60000);
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch (_) { /* gone */ }
      const result = { ok: false, renderer: 'timeout', reason: `The read did not finish within ${Math.round(hard / 1000)}s and was stopped.` };
      resolve({ slug: preset.slug, env: false, observation: obsLib.observationFromRead(preset, result, opts.observedAt) });
    }, hard);
    child.on('message', (m) => { if (done) return; done = true; clearTimeout(timer); resolve(m); });
    child.on('exit', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ slug: preset.slug, env: true, reason: `The reader process exited (${code}) without an answer.`, observation: null });
    });
    child.send({ preset, opts });
  });
}

async function harvest(options) {
  const o = Object.assign({ concurrency: 3, deadlineMs: HARVEST.deadlineMs, maxPages: 2, regression: true }, options || {});
  const indexFile = o.index || path.join(PRESETS_DIR, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const all = index.presets || [];
  const wanted = (o.slugs || []).length ? all.filter((p) => o.slugs.includes(p.slug)) : all;
  const unknown = (o.slugs || []).filter((s) => !all.some((p) => p.slug === s));
  const out = o.out || OBS_DIR;
  const observedAt = o.observedAt || new Date().toISOString().slice(0, 10);
  const opts = {
    deadlineMs: o.deadlineMs, maxPages: o.maxPages, regression: o.regression,
    firstDocumentMs: o.firstDocumentMs, perRequestMs: o.perRequestMs, navMs: o.navMs,
    retries: o.retries, sources: o.sources, sourceDeadlineMs: o.sourceDeadlineMs,
    allowOrigins: o.allowOrigins || [], artifacts: o.artifacts || '', observedAt, readerPath: o.readerPath,
  };
  if (opts.artifacts) fs.mkdirSync(opts.artifacts, { recursive: true });
  fs.mkdirSync(out, { recursive: true });

  const results = [];
  const queue = wanted.map((p) => ({ slug: p.slug, name: p.name, website: p.website, identity_sources: p.identity_sources || [] }));
  const log = o.quiet ? () => {} : (s) => process.stdout.write(s);
  log(`\nReading ${queue.length} starter brand site(s) with the rendered reader, ${Math.max(1, o.concurrency)} at a time.\n\n`);
  async function worker() {
    while (queue.length) {
      const preset = queue.shift();
      const m = await runChild(preset, opts);
      const row = { slug: preset.slug, website: preset.website, env: !!m.env, reason: m.reason || '', observation: m.observation };
      if (!m.env && m.observation) {
        fs.writeFileSync(path.join(out, `${preset.slug}.observed.json`), JSON.stringify(m.observation, null, 2) + '\n');
      }
      results.push(row);
      const obs = m.observation;
      if (m.env) log(`  ${preset.slug.padEnd(20)} NOT READ (this environment): ${String(m.reason).slice(0, 140)}\n`);
      else if (obs.palette_ok) {
        const ev = (obs.palette_evidence && obs.palette_evidence.primary) || {};
        log(`  ${preset.slug.padEnd(20)} ${obs.renderer.padEnd(9)} ${obs.palette.primary}  ${ev.kind || ''} on ${ev.read_url || obs.landed}  ${obs.typography ? obs.typography.heading.family + ' / ' + obs.typography.body.family : '(type not read)'}\n`);
      }
      else log(`  ${preset.slug.padEnd(20)} ${obs.renderer.padEnd(9)} ${String(obs.palette_reason || obs.reason || '').slice(0, 140)}\n`);
      // The log is the one record a reader without the artifact can see:
      // every read, every candidate, each page's logo and fonts.
      if (o.verbose && obs) {
        for (const r of obs.reads || []) log(`      read ${String(r.role).padEnd(15)} ${String(r.renderer).padEnd(9)} ${r.url}${r.attempts > 1 ? ` (${r.attempts} attempts)` : ''}${r.ok ? '' : ` - ${String(r.reason || '').slice(0, 110)}`}\n`);
        for (const d of obs.read_details || []) log(`      page ${d.url}  logo ${d.logo ? `${d.logo.kind}:${d.logo.verdict}:${d.logo.hex}` : '-'}  fonts ${d.fonts ? `${d.fonts.heading || '-'} / ${d.fonts.body || '-'}` : '-'}${d.content_logos ? `  content logos ${d.content_logos}` : ''}\n`);
        const cs = (obs.palette_candidates || []).filter((c) => c.state !== 'neutral').slice(0, 10);
        if (cs.length) log(`      candidates ${cs.map((c) => `${c.kind}:${c.value}:${c.score}${c.state === 'chosen' ? '*' : (c.state === 'passed over' ? '(x)' : '')}`).join(' ')}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency || 1, wanted.length || 1)) }, () => worker()));
  results.sort((a, b) => a.slug.localeCompare(b.slug));
  const env = results.filter((r) => r.env);
  const rendered = results.filter((r) => r.observation && r.observation.renderer === 'rendered');
  const summary = {
    observed_at: observedAt,
    requested: wanted.length,
    unknown_slugs: unknown,
    rendered: rendered.length,
    palette_applied: results.filter((r) => r.observation && r.observation.palette_ok).length,
    // Home page refused or empty, palette read from the brand's other own material.
    from_identity_sources: results.filter((r) => r.observation && r.observation.palette_ok && r.observation.palette_evidence && r.observation.palette_evidence.primary && r.observation.palette_evidence.primary.read_role === 'identity source').map((r) => r.slug),
    still_default: results.filter((r) => r.observation && !r.observation.palette_ok).map((r) => r.slug),
    blocked: results.filter((r) => r.observation && r.observation.renderer === 'blocked').map((r) => r.slug),
    timeout: results.filter((r) => r.observation && r.observation.renderer === 'timeout').map((r) => r.slug),
    unavailable: results.filter((r) => r.observation && r.observation.renderer === 'unavailable').map((r) => r.slug),
    environment_failures: env.map((r) => ({ slug: r.slug, reason: r.reason })),
  };
  if (opts.artifacts) fs.writeFileSync(path.join(opts.artifacts, 'summary.json'), JSON.stringify({ summary, results: results.map((r) => ({ slug: r.slug, env: r.env, reason: r.reason, observation: r.observation })) }, null, 2) + '\n');
  return { summary, results };
}

/* ── the before/after table ──────────────────────────────────────────────── */

function cell(v) { return String(v == null || v === '' ? '-' : v).replace(/\|/g, '/'); }

/** Markdown: per brand, read state and the four roles + two families, before -> after. */
function report(beforeIndex, afterIndex, observedDir) {
  const before = new Map((beforeIndex.presets || []).map((p) => [p.slug, p]));
  const rows = [];
  rows.push('| brand | home read | primary | accent | surface | ink | heading | body | primary signal | read from | regression |');
  rows.push('|---|---|---|---|---|---|---|---|---|---|---|');
  const sw = (p, role) => {
    if (!p) return '';
    if (Array.isArray(p.swatches)) { const s = p.swatches.find((x) => x.role === role); return s ? s.value : ''; }
    const order = { primary: 0, accent: 1, ink: 2, surface: 3 };
    return (p.swatch || [])[order[role]] || '';
  };
  const arrow = (a, b) => (String(a).toLowerCase() === String(b).toLowerCase() ? cell(b) : `${cell(a)} → ${cell(b)}`);
  for (const p of afterIndex.presets || []) {
    const b = before.get(p.slug) || {};
    let obs = null;
    try { obs = JSON.parse(fs.readFileSync(path.join(observedDir, `${p.slug}.observed.json`), 'utf8')); } catch (_) { obs = null; }
    const read = obs ? (obs.renderer || (obs.ok ? 'rendered (old format)' : 'not read (old format)')) : 'not attempted';
    const reg = obs && obs.regression ? (obs.regression.score != null ? obs.regression.score : (obs.regression.similarity != null ? obs.regression.similarity : JSON.stringify(obs.regression).slice(0, 60))) : '-';
    // Only a preset the builder marks hand-verified kept its palette by that
    // rule; a read with no recorded renderer is not one (review, 2026-10-05).
    const kept = p.palette_source === 'default' ? ' (default kept)'
      : (p.hand_verified ? ' (hand-verified palette kept)' : '');
    const ev = obs && obs.palette_ok && obs.palette_evidence && obs.palette_evidence.primary ? obs.palette_evidence.primary : null;
    const signal = ev ? `${ev.kind || ''}${ev.corroborated_by && ev.corroborated_by.length ? ` + ${ev.corroborated_by.map((c) => c.kind).join(', ')}` : ''}` : '';
    const from = ev ? (ev.read_url || ev.source && ev.source.page || '') : '';
    rows.push(`| ${p.slug} | ${cell(read)}${kept} | ${arrow(sw(b, 'primary'), sw(p, 'primary'))} | ${arrow(sw(b, 'accent'), sw(p, 'accent'))} | ${arrow(sw(b, 'surface'), sw(p, 'surface'))} | ${arrow(sw(b, 'ink'), sw(p, 'ink'))} | ${arrow(b.heading_font, p.heading_font)} | ${arrow(b.body_font, p.body_font)} | ${cell(signal)} | ${cell(from)} | ${cell(reg)} |`);
  }
  return rows.join('\n') + '\n';
}

module.exports = { harvest, report, readOne, readSources, wellKnownIcons, isEnvFailure, isTimeout, loopbackOrigins, HARVEST, WELL_KNOWN_ICONS };

if (require.main === module && !process.argv.includes('--child')) {
  const a = args(process.argv.slice(2));
  if (a.reportBefore) {
    const before = JSON.parse(fs.readFileSync(a.reportBefore, 'utf8'));
    const after = JSON.parse(fs.readFileSync(a.index || path.join(PRESETS_DIR, 'index.json'), 'utf8'));
    process.stdout.write(report(before, after, a.out || OBS_DIR));
    process.exit(0);
  }
  harvest({
    slugs: a.slugs, index: a.index, out: a.out, artifacts: a.artifacts,
    concurrency: a.concurrency || 3, deadlineMs: a.deadlineMs || HARVEST.deadlineMs,
    maxPages: a.maxPages == null || Number.isNaN(a.maxPages) ? 2 : a.maxPages,
    regression: a.regression !== false, allowOrigins: a.allowOrigins, observedAt: a.observedAt,
    firstDocumentMs: a.firstDocumentMs, perRequestMs: a.perRequestMs,
    retries: a.retries, sources: a.sources, sourceDeadlineMs: a.sourceDeadlineMs, verbose: a.verbose,
  }).then(({ summary }) => {
    console.log(`\n  palette applied: ${summary.palette_applied} of ${summary.requested} (from identity sources: ${summary.from_identity_sources.length})   still default: ${summary.still_default.join(', ') || 'none'}`);
    console.log(`  home pages rendered: ${summary.rendered}   blocked: ${summary.blocked.length}   timeout: ${summary.timeout.length}   unavailable: ${summary.unavailable.length}   not read here: ${summary.environment_failures.length}\n`);
    if (summary.unknown_slugs.length) { console.error(`  Unknown slug(s): ${summary.unknown_slugs.join(', ')}`); process.exitCode = 1; }
    // A failure of THIS environment is not a fact about a brand: nothing was
    // written for it, and the run says so by failing.
    if (summary.environment_failures.length) {
      console.error('  These were not read because this environment could not run the reader; nothing was written for them:');
      for (const f of summary.environment_failures) console.error(`    ${f.slug.padEnd(20)} ${String(f.reason).slice(0, 160)}`);
      process.exitCode = 1;
    }
    // Every site refusing at once says more about the runner than the sites.
    if (summary.requested > 2 && !summary.rendered) { console.error('  No site rendered at all.'); process.exitCode = 1; }
  }).catch((e) => { console.error(e); process.exit(1); });
}
