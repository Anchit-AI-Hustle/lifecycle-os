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
  return (list || []).filter((o) => /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(String(o || '')));
}

function isEnvFailure(result) {
  if (!result) return true;
  if (result.code === 'no_browser' || result.code === 'reader_missing') return true;
  return ENV_FAILURE.test(String(result.reason || ''));
}

/* ── one read, in a child process ────────────────────────────────────────── */

async function readOne(preset, opts) {
  let reader;
  try {
    reader = require(opts.readerPath || READER);
  } catch (e) {
    return { ok: false, renderer: 'unavailable', code: 'reader_missing', reason: `The rendered reader is not installed in this checkout (${String(e.message).split('\n')[0]}).` };
  }
  if (typeof reader.readSite !== 'function') return { ok: false, renderer: 'unavailable', code: 'reader_missing', reason: 'The rendered reader is not installed in this checkout: readSite is not a function.' };
  const allow = loopbackOrigins(opts.allowOrigins);
  return reader.readSite(preset.website, {
    deadlineMs: opts.deadlineMs,
    maxPages: opts.maxPages,
    regression: opts.regression !== false,
    policy: allow.length ? { allowOrigins: new Set(allow) } : undefined,
  });
}

function writeArtifacts(dir, slug, result, observation) {
  if (!dir) return;
  const d = path.join(dir, slug);
  fs.mkdirSync(d, { recursive: true });
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
    const observation = env ? null : obsLib.observationFromRead(preset, result, opts.observedAt);
    try { writeArtifacts(opts.artifacts, preset.slug, result, observation); } catch (_) { /* artifacts are a convenience */ }
    process.send({ slug: preset.slug, env, reason: result.reason || '', observation }, () => process.exit(0));
  });
}

/* ── the run ─────────────────────────────────────────────────────────────── */

function runChild(preset, opts) {
  return new Promise((resolve) => {
    const child = fork(__filename, ['--child'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let done = false;
    const hard = Math.max(30000, (opts.deadlineMs || 120000) + 60000);
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
  const o = Object.assign({ concurrency: 3, deadlineMs: 120000, maxPages: 2, regression: true }, options || {});
  const indexFile = o.index || path.join(PRESETS_DIR, 'index.json');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const all = index.presets || [];
  const wanted = (o.slugs || []).length ? all.filter((p) => o.slugs.includes(p.slug)) : all;
  const unknown = (o.slugs || []).filter((s) => !all.some((p) => p.slug === s));
  const out = o.out || OBS_DIR;
  const observedAt = o.observedAt || new Date().toISOString().slice(0, 10);
  const opts = {
    deadlineMs: o.deadlineMs, maxPages: o.maxPages, regression: o.regression,
    allowOrigins: o.allowOrigins || [], artifacts: o.artifacts || '', observedAt, readerPath: o.readerPath,
  };
  if (opts.artifacts) fs.mkdirSync(opts.artifacts, { recursive: true });
  fs.mkdirSync(out, { recursive: true });

  const results = [];
  const queue = wanted.map((p) => ({ slug: p.slug, name: p.name, website: p.website }));
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
      else if (obs.renderer === 'rendered' && obs.palette_ok) log(`  ${preset.slug.padEnd(20)} rendered  ${obs.palette.primary}  ${obs.typography ? obs.typography.heading.family + ' / ' + obs.typography.body.family : '(type not read)'}\n`);
      else log(`  ${preset.slug.padEnd(20)} ${obs.renderer.padEnd(9)} ${String(obs.palette_reason || obs.reason || '').slice(0, 140)}\n`);
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
    palette_applied: rendered.filter((r) => r.observation.palette_ok).length,
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
  rows.push('| brand | read | primary | accent | surface | ink | heading | body | regression |');
  rows.push('|---|---|---|---|---|---|---|---|---|');
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
    const kept = p.palette_source === 'default' ? ' (default kept)'
      : (obs && obs.renderer === 'rendered' && !p.renderer ? ' (hand-verified palette kept)' : '');
    rows.push(`| ${p.slug} | ${cell(read)}${kept} | ${arrow(sw(b, 'primary'), sw(p, 'primary'))} | ${arrow(sw(b, 'accent'), sw(p, 'accent'))} | ${arrow(sw(b, 'surface'), sw(p, 'surface'))} | ${arrow(sw(b, 'ink'), sw(p, 'ink'))} | ${arrow(b.heading_font, p.heading_font)} | ${arrow(b.body_font, p.body_font)} | ${cell(reg)} |`);
  }
  return rows.join('\n') + '\n';
}

module.exports = { harvest, report, readOne, isEnvFailure, loopbackOrigins };

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
    concurrency: a.concurrency || 3, deadlineMs: a.deadlineMs || 120000,
    maxPages: a.maxPages == null || Number.isNaN(a.maxPages) ? 2 : a.maxPages,
    regression: a.regression !== false, allowOrigins: a.allowOrigins, observedAt: a.observedAt,
  }).then(({ summary }) => {
    console.log(`\n  rendered: ${summary.rendered} (palette applied: ${summary.palette_applied})   blocked: ${summary.blocked.length}   timeout: ${summary.timeout.length}   unavailable: ${summary.unavailable.length}   not read here: ${summary.environment_failures.length}\n`);
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
