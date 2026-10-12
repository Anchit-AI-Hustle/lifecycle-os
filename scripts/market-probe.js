#!/usr/bin/env node
'use strict';
/**
 * scripts/market-probe.js — for each brand, which of its regional stores can be
 * read from WHERE THIS RUNS, and which send the request somewhere else.
 * ---------------------------------------------------------------------------
 * Why (2026-10-11): the live Lenskart import read IN/AE/SA/TH as 0, because
 * the store sent a US server to its US store. The operator: this is "not only
 * for lenskart, for each and every respective brand in the list shown", and
 * chose readers in each country. Before any server is created, this measures
 * which brands and which markets are affected, so the reader list and its cost
 * rest on what the stores actually do.
 *
 * What it runs: catalog-import.discoverMarkets() - the shipped market
 * discovery every import uses (hreflang, locale-shaped sitemaps, the record's
 * own stores) - then, per market, ONE GET of that market's store with
 * redirects followed by hand (assertPublicUrl on every hop, the importer's own
 * honest user agent, robots.txt honoured, at most 6 hops). Each landing is
 * classified:
 *   reachable      - answered 200 at this market's own store
 *   geo-redirect   - sent to ANOTHER market's store (a locale path or host of
 *                    another country), with where
 *   blocked        - 401/403/429/451/5xx or a challenge, with the status
 *   robots         - robots.txt disallows the store page; not fetched
 *   unreachable    - no answer
 * No cookie, Accept-Language, X-Forwarded-For, proxy or user agent pretends a
 * location. Nothing is written anywhere but the output directory.
 *
 *   node scripts/market-probe.js --presets [--only slug,slug] [--out dir]
 *   node scripts/market-probe.js --url https://www.example.com [--region IN] [--out dir]
 */
const fs = require('fs');
const path = require('path');

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; o[k] = v; }
  }
  return o;
}

const LOCALE = /^\/([a-z]{2})[-_]([a-z]{2})(?=\/|$)/i;
function countryOfPath(p) {
  const m = LOCALE.exec(p || '');
  if (!m) return '';
  const c = m[2].toUpperCase();
  return c === 'UK' ? 'GB' : c;
}

/** Where a GET of `url` lands from here, hop by hop. */
async function land(url, { fetchImpl, assertUrl, ua, deadline }) {
  const hops = [];
  let at = url;
  for (let i = 0; i < 7; i++) {
    try { await assertUrl(at); } catch (e) { return { status: 0, error: 'refused: ' + (e.message || e), hops, final: at }; }
    const left = deadline - Date.now();
    if (left < 1500) return { status: 0, error: 'deadline', hops, final: at };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(15000, left));
    let r;
    try {
      r = await fetchImpl(at, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml' } });
    } catch (e) { clearTimeout(t); return { status: 0, error: (e && e.name === 'AbortError') ? 'timeout' : String((e && e.message) || e), hops, final: at }; }
    clearTimeout(t);
    hops.push({ url: at, status: r.status });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      try { if (r.body && r.body.cancel) await r.body.cancel(); } catch (_) {}
      if (!loc) return { status: r.status, hops, final: at };
      at = new URL(loc, at).toString();
      continue;
    }
    let text = '';
    try { text = (await r.text()).slice(0, 200000); } catch (_) {}
    const challenge = /cf-chl|challenge-platform|captcha|access denied|attention required|request unsuccessful|kpsdk|px-captcha/i.test(text.slice(0, 20000));
    return { status: r.status, hops, final: at, challenge, title: ((/<title[^>]*>([^<]{0,140})/i.exec(text) || [])[1] || '').trim() };
  }
  return { status: 0, error: 'too many redirects', hops, final: at };
}

const READERS = require('../api/_shared/catalog-reader-client.js');
function where(opts) { return (opts && opts.where) || process.env.PROBE_WHERE || (process.env.GITHUB_ACTIONS ? 'a GitHub-hosted runner' : 'this machine'); }

/** The same landing, asked of a reader in the market's country (it follows and re-checks the hops). */
async function viaReader(reader, url, opts = {}) {
  const r = await READERS.read(reader, url, { accept: 'text/html,application/xhtml+xml', fetchImpl: opts.readerFetch });
  if (r.failed) return { reader_failed: r.failed, hops: [] };
  if (r.refused) return { status: 0, error: 'refused by the reader: ' + (r.message || r.refused), hops: r.hops || [], final: url };
  if (r.ok !== true) return { status: r.status || 0, error: r.error, hops: r.hops || [], final: r.final_url || url, reader_country: r.reader && r.reader.country };
  const text = r.body.toString('utf8').slice(0, 200000);
  const challenge = /cf-chl|challenge-platform|captcha|access denied|attention required|request unsuccessful|kpsdk|px-captcha/i.test(text.slice(0, 20000));
  return { status: r.status, hops: r.hops || [], final: r.final_url || url, challenge, title: ((/<title[^>]*>([^<]{0,140})/i.exec(text) || [])[1] || '').trim(), reader_country: r.reader && r.reader.country };
}

function classify(m, l) {
  if (l.robots) return { verdict: 'robots', why: 'robots.txt disallows ' + m.store_url };
  if (!l.status) return { verdict: 'unreachable', why: l.error || 'no answer' };
  let fin; try { fin = new URL(l.final); } catch (_) { fin = null; }
  let want; try { want = new URL(m.store_url); } catch (_) { want = null; }
  if (fin && want) {
    const finC = countryOfPath(fin.pathname);
    const prefix = (m.prefix || '').toLowerCase();
    const onOwnPrefix = prefix ? (fin.pathname.toLowerCase() === prefix || fin.pathname.toLowerCase().startsWith(prefix + '/')) : !finC || finC === m.country;
    const qc = (fin.searchParams.get('country') || fin.searchParams.get('region') || '').toUpperCase();
    const elsewhere = (fin.host !== want.host && !fin.host.endsWith('.' + want.host.replace(/^www\./, '')) && fin.host.replace(/^www\./, '') !== want.host.replace(/^www\./, ''))
      || (finC && finC !== m.country) || (qc && qc !== m.country) || !onOwnPrefix;
    if (elsewhere && l.hops.length > 1) return { verdict: 'geo-redirect', why: 'sent to ' + l.final + (finC ? ' (' + finC + ' store)' : '') };
  }
  if (l.status === 200 && !l.challenge) return { verdict: 'reachable', why: 'answered 200' + (l.title ? ': "' + l.title + '"' : '') };
  if (l.challenge) return { verdict: 'blocked', why: 'answered ' + l.status + ' with a bot challenge' };
  return { verdict: 'blocked', why: 'answered ' + l.status };
}

async function probeBrand({ name, url, region }, opts = {}) {
  const CI = require('../api/_shared/catalog-import.js');
  const core = require('../api/_shared/brand-workspace-core.js');
  const fetchImpl = opts.fetchImpl || fetch;
  const assertUrl = opts.assertUrl || core.assertPublicUrl;
  const deadline = Date.now() + (opts.budgetMs || 90000);
  const brand = { name, website: url, regions: region ? [{ code: region, home: true }] : [] };
  const out = { name, url, region: region || '', markets: [], notes: [], error: '' };
  let found;
  try {
    found = await CI.discoverMarkets({ url, region: region || '', brand, guard: async (u) => { await assertUrl(u); }, deadline: Date.now() + 30000 });
  } catch (e) { out.error = 'market discovery failed: ' + (e.message || e); return out; }
  out.notes = found.notes || [];
  const robotsCache = {};
  const robotsOk = async (u) => {
    const o = new URL(u).origin;
    if (!(o in robotsCache)) {
      try {
        const r = await fetchImpl(o + '/robots.txt', { headers: { 'User-Agent': CI.USER_AGENT } });
        robotsCache[o] = r.ok ? CI.parseRobots(await r.text()) : null;
      } catch (_) { robotsCache[o] = null; }
    }
    const rules = robotsCache[o];
    return !rules || CI.robotsAllows(rules, u);   // the full URL: robotsAllows reads its path itself
  };
  // A site whose own pages name no regional store is ONE store: probe its
  // home page too, so "blocked here" is never reported as "no regional stores".
  if (!found.markets.length) {
    const l = (await robotsOk(url)) ? await land(url, { fetchImpl, assertUrl, ua: CI.USER_AGENT, deadline }) : { robots: true, hops: [] };
    const c = classify({ code: region || '', country: region || '', store_url: url, prefix: '' }, l);
    out.home = { verdict: c.verdict, why: c.why };
  }
  for (const m of found.markets) {
    let l;
    let via = 'this machine';
    if (!(await robotsOk(m.store_url))) l = { robots: true, hops: [] };
    else {
      // A reader in the market's country (CATALOG_READERS + CATALOG_READER_SECRET),
      // when one is configured: the probe asks it, so a run confirms that the
      // market is reachable THROUGH its reader. A reader that cannot be used
      // is said and the market is probed directly.
      const reader = READERS.readerFor(m.code);
      if (reader && reader.usable) {
        l = await viaReader(reader, m.store_url, opts);
        if (l.reader_failed) { out.notes.push(`${String(m.code).toUpperCase()}: the reader ${reader.host} could not be used (${l.reader_failed}); probed directly from ${where(opts)} instead.`); l = null; }
        else via = `the reader ${reader.host} (a server in ${l.reader_country || 'an unstated country'})`;
      } else if (reader) out.notes.push(`${String(m.code).toUpperCase()}: a reader is configured (${reader.host}) but ${reader.problem}; probed directly.`);
      if (!l) l = await land(m.store_url, { fetchImpl, assertUrl, ua: CI.USER_AGENT, deadline });
    }
    const c = classify(m, l);
    out.markets.push({ code: m.code, country: m.country, store_url: m.store_url, source: m.source, verdict: c.verdict, why: c.why, landing: c.verdict, read_from: via, hops: (l.hops || []).map((h) => h.status + ' ' + h.url) });
  }
  // Then the shipped importer itself, a few steps: a store can answer its home
  // page and still send every PRODUCT page to another market's store (the
  // live Lenskart shape), which only reading products shows.
  const steps = opts.steps == null ? 3 : +opts.steps;
  if (steps > 0 && found.markets.length) {
    let cursor = null, last = null;
    for (let i = 0; i < steps; i++) {
      try { last = await core.rowsFromStore(url, region || found.markets[0].code, brand, { cursor, budgetMs: opts.stepMs || 45000 }); }
      catch (e) { out.notes.push('importer step ' + (i + 1) + ' failed: ' + (e.message || e)); break; }
      if (last.complete || last.progressed === false || !last.cursor) break;
      cursor = last.cursor;
    }
    const sum = (last && last.markets) || [];
    for (const m of out.markets) {
      const s = sum.find((x) => String(x.code).toLowerCase() === String(m.code).toLowerCase());
      if (!s) continue;
      m.products_read = s.found || 0;
      m.products_declared = s.declared || null;
      if (s.sent_to) { m.verdict = 'geo-redirect'; m.why = 'product pages sent to the ' + s.sent_to + ' store' + (m.landing === 'geo-redirect' ? '; ' + m.why : ''); }
      else if (s.found > 0) { m.verdict = 'reachable'; m.why = s.found + ' products read' + (s.declared ? ' of ' + s.declared : '') + ' in ' + steps + ' step(s)'; }
      else if (s.blocked) { m.verdict = m.landing === 'reachable' ? 'blocked' : m.verdict; m.why = (s.stopped && (s.stopped.reason || s.stopped)) ? 'importer stopped: ' + (s.stopped.reason || s.stopped) + '; ' + m.why : m.why; }
    }
  }
  return out;
}

function summary(results, where) {
  const lines = [`# Regional stores, read from ${where}`, ''];
  const tally = {};
  const byCountry = {};
  for (const b of results) {
    for (const m of b.markets) {
      tally[m.verdict] = (tally[m.verdict] || 0) + 1;
      if (m.verdict === 'geo-redirect' || m.verdict === 'blocked') (byCountry[m.code] = byCountry[m.code] || []).push(b.name + ' (' + m.verdict + ')');
    }
  }
  lines.push(`${results.length} brands, ${results.reduce((n, b) => n + b.markets.length, 0)} regional stores: ` + Object.keys(tally).sort().map((k) => `${tally[k]} ${k}`).join(', ') + '.', '');
  lines.push('## Markets that could not be read from here', '', '| Market | Brands |', '|---|---|');
  Object.keys(byCountry).sort((a, b) => byCountry[b].length - byCountry[a].length).forEach((c) => lines.push(`| ${c.toUpperCase()} | ${byCountry[c].join(', ')} |`));
  lines.push('', '## Per brand', '');
  for (const b of results) {
    lines.push(`### ${b.name} (${b.url})`);
    if (b.error) lines.push('', b.error);
    if (!b.markets.length && !b.error) lines.push('', 'The site publishes no regional store this importer can find.' + (b.home ? ` Its home page from here: ${b.home.verdict} (${b.home.why}).` : ''));
    lines.push('', '| Market | Store | Verdict | Detail |', '|---|---|---|---|');
    b.markets.forEach((m) => lines.push(`| ${m.code.toUpperCase()} | ${m.store_url} | ${m.verdict} | ${String(m.why).replace(/\|/g, '/')}${m.read_from && m.read_from !== 'this machine' ? ` (read through ${m.read_from})` : ''} |`));
    if (b.notes.length) lines.push('', ...b.notes.map((n) => '- ' + n));
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const a = args(process.argv.slice(2));
  const outDir = a.out || 'market-probe-out';
  fs.mkdirSync(outDir, { recursive: true });
  let targets = [];
  if (a.presets) {
    const idx = require('../data/brands/presets/index.json');
    const list = Array.isArray(idx) ? idx : (idx.presets || idx.brands || []);
    const only = a.only ? new Set(String(a.only).split(',').map((s) => s.trim())) : null;
    const LOC = require('../api/_shared/brand-locale.js');
    for (const p of list) {
      const slug = p.slug || p.id;
      if (only && !only.has(slug)) continue;
      let full = p;
      try { full = require(`../data/brands/presets/${slug}.json`); } catch (_) {}
      if (!full.website && !p.website) continue;
      targets.push({ name: full.name || p.name || slug, url: full.website || p.website, region: (LOC.homeMarket && LOC.homeMarket(full)) || '' });
    }
  } else if (a.url) targets.push({ name: a.name || a.url, url: a.url, region: a.region || '' });
  else throw new Error('Pass --presets or --url.');
  const where = process.env.PROBE_WHERE || (process.env.GITHUB_ACTIONS ? 'a GitHub-hosted runner' : 'this machine');
  const results = [];
  const conc = Math.max(1, Math.min(6, +(a.concurrency || 4)));
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < targets.length) {
      const t = targets[i++];
      const r = await probeBrand(t, { steps: a.steps == null ? 3 : +a.steps }).catch((e) => ({ name: t.name, url: t.url, markets: [], notes: [], error: String(e.message || e) }));
      results.push(r);
      process.stdout.write(`${t.name}: ${r.markets.map((m) => m.code + '=' + m.verdict).join(' ') || r.error || ('no regional stores' + (r.home ? '; home=' + r.home.verdict + ' (' + r.home.why + ')' : ''))}\n`);
    }
  }));
  results.sort((x, y) => targets.findIndex((t) => t.name === x.name) - targets.findIndex((t) => t.name === y.name));
  fs.writeFileSync(path.join(outDir, 'markets.json'), JSON.stringify({ where, at: new Date().toISOString(), results }, null, 2));
  const md = summary(results, where);
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

if (require.main === module) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
module.exports = { probeBrand, classify, land, viaReader, summary, countryOfPath };
