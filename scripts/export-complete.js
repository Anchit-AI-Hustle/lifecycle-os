#!/usr/bin/env node
/**
 * Complete-analysis export → output/knickgasm-complete-analysis.xlsx
 * ─────────────────────────────────────────────────────────────────────────
 * Pulls LIVE data from the linked Supabase database (the analytical views in
 * data/schemas/uploaded_data.sql) and compiles every table of every page into
 * a single colour-coded Excel workbook in the output/ folder.
 *
 * This is the "live integration" companion to the in-browser Export → Complete
 * analysis button: the browser version reflects whatever is loaded in the tab,
 * this one always reflects the current state of the real database, so it can be
 * scheduled (cron / GitHub Action / `watch`) to keep output/ continuously fresh
 * as new orders & campaigns land — that's the "live linking & triggering".
 *
 * Config (env or .env): set the linked project's REST endpoint + a key + schema.
 *   SUPABASE_URL                 e.g. https://abcd.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    (preferred) or SUPABASE_ANON_KEY
 *   UPLOAD_SCHEMA                schema the tables live in (default uploaded_by_anchit)
 *
 * The dashboard's "Link database" flow writes data/linked-db.public.json with
 * { url, anonKey, schema } — this script falls back to that file if env is unset.
 *
 * Usage:  npm run export:complete         (one-shot)
 *         npm run export:complete -- --watch=300   (refresh every 300s)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx-js-style');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'output');
const LINK_FILE = path.join(ROOT, 'data', 'linked-db.public.json');

// ── tiny .env loader (no dep) ─────────────────────────────────────────────
(function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
})();

function readLink() {
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  let schema = process.env.UPLOAD_SCHEMA;
  if ((!url || !key) && fs.existsSync(LINK_FILE)) {
    try {
      const j = JSON.parse(fs.readFileSync(LINK_FILE, 'utf8'));
      url = url || j.url; key = key || j.serviceKey || j.anonKey; schema = schema || j.schema;
    } catch { /* ignore */ }
  }
  return { url, key, schema: schema || 'uploaded_by_anchit' };
}

// ── PostgREST query against a specific schema ─────────────────────────────
async function pg(link, rel, query = '') {
  const r = await fetch(`${link.url}/rest/v1/${rel}${query}`, {
    headers: {
      apikey: link.key,
      Authorization: 'Bearer ' + link.key,
      'Accept-Profile': link.schema,      // read from the chosen schema
      Accept: 'application/json',
    },
  });
  if (!r.ok) throw new Error(`${rel} → HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

// ── styled-sheet builder (mirrors dashboard.html colours) ─────────────────
const HEADER_FILL = 'FF004A2B', HEADER_FONT = 'FFFBF5EA', TITLE_FONT = 'FF004A2B';
function goldFillHex(pct) {
  const a = Math.min((pct || 0) / 60, 1);
  if (a <= 0) return null;
  const mix = (b, g) => Math.round(b * (1 - a) + g * a);
  const h = (x) => x.toString(16).padStart(2, '0').toUpperCase();
  return 'FF' + h(mix(255, 171)) + h(mix(255, 135)) + h(mix(255, 67));
}

function tablesToSheet(tables) {
  const aoa = []; const styles = {};
  const setStyle = (r, c, s) => { styles[XLSX.utils.encode_cell({ r, c })] = s; };
  tables.forEach((t, ti) => {
    if (ti > 0) aoa.push([]);
    const titleRow = aoa.length; aoa.push([t.title]);
    setStyle(titleRow, 0, { font: { bold: true, sz: 13, color: { rgb: TITLE_FONT } } });
    const headRow = aoa.length; aoa.push(t.columns.map((c) => c.label));
    t.columns.forEach((_, ci) => setStyle(headRow, ci, {
      fill: { patternType: 'solid', fgColor: { rgb: HEADER_FILL } },
      font: { bold: true, color: { rgb: HEADER_FONT } },
    }));
    t.rows.forEach((row) => {
      const r = aoa.length;
      aoa.push(t.columns.map((c) => row[c.key] == null ? '' : row[c.key]));
      t.columns.forEach((c, ci) => {
        if (!c.heat) return;
        const pct = Number(row[c.key]) || 0;
        const fill = goldFillHex(pct);
        if (fill) setStyle(r, ci, { fill: { patternType: 'solid', fgColor: { rgb: fill } }, font: { bold: true, color: { rgb: pct > 30 ? 'FF0A1410' : 'FF5D6E64' } } });
      });
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  Object.keys(styles).forEach((ref) => { if (ws[ref]) ws[ref].s = styles[ref]; });
  const maxCols = Math.max(1, ...tables.map((t) => t.columns.length));
  ws['!cols'] = Array(maxCols).fill(0).map((_, i) => ({ wch: i === 0 ? 26 : 16 }));
  return ws;
}

async function build(link) {
  const num = (v) => (v == null ? 0 : Number(v));
  const money = (v) => '$' + Math.round(num(v)).toLocaleString('en-US');

  // Pull the views defined in data/schemas/uploaded_data.sql
  const [daily, byRegion, campWeeks] = await Promise.all([
    pg(link, 'v_orders_daily', '?order=order_date.desc&limit=400').catch(() => []),
    pg(link, 'v_customers_by_region', '?limit=100').catch(() => []),
    pg(link, 'v_campaign_performance', '?order=week.desc&limit=400').catch(() => []),
  ]);

  const sheets = {};
  sheets['Orders (daily)'] = tablesToSheet([{
    title: 'Daily orders & revenue by region (live)',
    columns: [
      { key: 'order_date', label: 'Date' }, { key: 'region', label: 'Region' },
      { key: 'orders', label: 'Orders' }, { key: 'units', label: 'Units' },
      { key: 'revenue', label: 'Revenue' }, { key: 'aov', label: 'AOV' },
    ],
    rows: daily.map((d) => ({ ...d, revenue: money(d.revenue), aov: money(d.aov) })),
  }]);

  sheets['Customers by region'] = tablesToSheet([{
    title: 'Customers, revenue & orders by region (live)',
    columns: [
      { key: 'region', label: 'Region' }, { key: 'customers', label: 'Customers' },
      { key: 'orders', label: 'Orders' }, { key: 'revenue', label: 'Revenue' },
    ],
    rows: byRegion.map((r) => ({ ...r, revenue: money(r.revenue) })),
  }]);

  sheets['Campaign performance'] = tablesToSheet([{
    title: 'Weekly campaign performance by channel (live)',
    columns: [
      { key: 'campaign_channel', label: 'Channel' }, { key: 'week', label: 'Week' },
      { key: 'campaigns', label: 'Campaigns' }, { key: 'sends', label: 'Sends' },
      { key: 'opens', label: 'Opens' }, { key: 'open_rate', label: 'Open rate', heat: true },
      { key: 'clicks', label: 'Clicks' }, { key: 'orders', label: 'Orders' },
      { key: 'revenue', label: 'Revenue' },
    ],
    rows: campWeeks.map((c) => ({
      ...c,
      open_rate: c.open_rate != null ? +(c.open_rate * 100).toFixed(1) : 0,
      revenue: money(c.revenue),
    })),
  }]);

  // Combined "All Tables" sheet
  const allTables = [
    { title: 'Daily orders & revenue', columns: [
      { key: 'order_date', label: 'Date' }, { key: 'region', label: 'Region' }, { key: 'orders', label: 'Orders' }, { key: 'revenue', label: 'Revenue' },
    ], rows: daily.map((d) => ({ ...d, revenue: money(d.revenue) })) },
    { title: 'Customers by region', columns: [
      { key: 'region', label: 'Region' }, { key: 'customers', label: 'Customers' }, { key: 'revenue', label: 'Revenue' },
    ], rows: byRegion.map((r) => ({ ...r, revenue: money(r.revenue) })) },
    { title: 'Campaign performance (weekly)', columns: [
      { key: 'campaign_channel', label: 'Channel' }, { key: 'week', label: 'Week' }, { key: 'sends', label: 'Sends' },
      { key: 'open_rate', label: 'Open rate', heat: true }, { key: 'revenue', label: 'Revenue' },
    ], rows: campWeeks.map((c) => ({ ...c, open_rate: c.open_rate != null ? +(c.open_rate * 100).toFixed(1) : 0, revenue: money(c.revenue) })) },
  ];

  const wb = XLSX.utils.book_new();
  // Meta sheet
  const meta = tablesToSheet([{
    title: 'Lifecycle OS — Complete analysis',
    columns: [{ key: 'k', label: 'Field' }, { key: 'v', label: 'Value' }],
    rows: [
      { k: 'Generated', v: new Date().toISOString() },
      { k: 'Source', v: link.url + ' · schema ' + link.schema },
      { k: 'Daily rows', v: daily.length },
      { k: 'Regions', v: byRegion.length },
      { k: 'Campaign-weeks', v: campWeeks.length },
    ],
  }]);
  XLSX.utils.book_append_sheet(wb, meta, 'About');
  Object.entries(sheets).forEach(([name, ws]) => XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 28)));
  XLSX.utils.book_append_sheet(wb, tablesToSheet(allTables), 'All Tables');
  return wb;
}

async function runOnce() {
  const link = readLink();
  if (!link.url || !link.key) {
    console.error('✗ No linked database. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY),');
    console.error('  or link a DB in the dashboard (writes data/linked-db.public.json).');
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const wb = await build(link);
  const stamped = path.join(OUT_DIR, `knickgasm-complete-analysis-${new Date().toISOString().slice(0, 10)}.xlsx`);
  const stable = path.join(OUT_DIR, 'knickgasm-complete-analysis.xlsx');
  XLSX.writeFile(wb, stamped, { cellStyles: true });
  XLSX.writeFile(wb, stable, { cellStyles: true });
  console.log(`✓ ${new Date().toLocaleTimeString()}  wrote ${path.relative(ROOT, stable)} (+ dated copy)`);
}

(async () => {
  const watchArg = (process.argv.find((a) => a.startsWith('--watch')) || '').split('=')[1];
  const interval = watchArg ? Math.max(30, +watchArg) : 0;
  await runOnce();
  if (interval) {
    console.log(`↻ watching — re-export every ${interval}s (Ctrl-C to stop)`);
    setInterval(() => runOnce().catch((e) => console.error('✗', e.message)), interval * 1000);
  }
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
