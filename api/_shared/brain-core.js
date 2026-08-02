'use strict';

/**
 * brain-core.js — shared foundation for the Smart Brain.
 *
 * Provides:
 *   db()        — REST adapter to the PROVIDED LINKED DB (data/linked-db.json,
 *                 overridable via SMART_BRAIN_SUPABASE_URL / _KEY env). The
 *                 brain NEVER touches any production store directly.
 *   getConfig() — merged config: smart_brain_config table > defaults.
 *   helpers     — ids, dates, math, brand kit access.
 *
 * Module isolation contract:
 *   Own-data logic (KB / analysis / calendar / generation) and competitor
 *   logic (brain-competitor.js) both use this adapter but MUST NOT mix
 *   tables: competitor reads ONLY smart_competitor_*; own-library scoring
 *   reads ONLY smart_campaigns / smart_campaign_* / smart_users / smart_orders.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Linked-DB connection ─────────────────────────────────────────────────────
let _conn = null;
function connection() {
  if (_conn) return _conn;
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'linked-db.json'), 'utf8'));
  } catch (_) { file = {}; }
  const clean = (s) => (s || '').replace(/[﻿​]/g, '').trim();
  // Use a MATCHED (url, key) pair from ONE Supabase project. The previous code
  // took the URL from SMART_BRAIN_SUPABASE_URL but could fall back to the linked
  // project's anon key — a Smart-Brain URL + main-project key yields a 401
  // "Invalid API key". Pick a pair that belongs together.
  const smartUrl = clean(process.env.SMART_BRAIN_SUPABASE_URL);
  const smartKey = clean(process.env.SMART_BRAIN_SUPABASE_KEY)
    || clean(process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY)
    || clean(process.env.SUPABASE_SERVICE_ROLE_KEY)
    || clean(process.env.SUPABASE_SERVICE_KEY);
  let url, key;
  if (smartUrl && smartKey) { url = smartUrl; key = smartKey; }            // Smart Brain project w/ a real key
  else if (file.url && file.anonKey) { url = file.url; key = file.anonKey; } // linked project (analytics tables)
  else {
    url = clean(process.env.SUPABASE_URL) || clean(process.env.NEXT_PUBLIC_SUPABASE_URL) || smartUrl || file.url || '';
    key = clean(process.env.SUPABASE_ANON_KEY) || clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || file.anonKey || '';
  }
  _conn = { url: url.replace(/\/$/, ''), key };
  return _conn;
}

class LinkedDb {
  constructor() {
    const c = connection();
    this.url = c.url;
    this.key = c.key;
  }
  get connected() { return Boolean(this.url && this.key); }
  headers(extra = {}) {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }
  async select(table, { select = '*', filters = {}, order, limit, offset } = {}) {
    const qs = new URLSearchParams({ select });
    if (order) qs.set('order', order);
    if (limit) qs.set('limit', String(limit));
    if (offset) qs.set('offset', String(offset));
    for (const [k, v] of Object.entries(filters)) qs.append(k, v);
    const r = await fetch(`${this.url}/rest/v1/${table}?${qs}`, { headers: this.headers() });
    if (!r.ok) throw new Error(`linked-db select ${table}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  async upsert(table, rows, onConflict) {
    if (!Array.isArray(rows)) rows = [rows];
    if (!rows.length) return [];
    const qs = onConflict ? `?on_conflict=${onConflict}` : '';
    const r = await fetch(`${this.url}/rest/v1/${table}${qs}`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'return=representation,resolution=merge-duplicates' }),
      body: JSON.stringify(rows),
    });
    if (!r.ok) throw new Error(`linked-db upsert ${table}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  async insert(table, rows) {
    if (!Array.isArray(rows)) rows = [rows];
    if (!rows.length) return [];
    const r = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(rows),
    });
    if (!r.ok) throw new Error(`linked-db insert ${table}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  async update(table, filters, patch) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) qs.append(k, v);
    const r = await fetch(`${this.url}/rest/v1/${table}?${qs}`, {
      method: 'PATCH',
      headers: this.headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error(`linked-db update ${table}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
  async remove(table, filters) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) qs.append(k, v);
    const r = await fetch(`${this.url}/rest/v1/${table}?${qs}`, { method: 'DELETE', headers: this.headers() });
    if (!r.ok) throw new Error(`linked-db delete ${table}: ${r.status}`);
    return true;
  }
}

let _db = null;
function db() { if (!_db) _db = new LinkedDb(); return _db; }

// ── Config (DB-driven; smart_brain_config overrides defaults) ───────────────
const DEFAULT_CONFIG = {
  thresholds: {
    email: { open_rate: 0.22, click_rate: 0.018, cvr: 0.006, rpr: 0.08 },
    meta: { ctr: 0.009, cvr: 0.012, roas: 1.6 },
    google: { ctr: 0.025, cvr: 0.018, roas: 1.8 },
    tiktok: { ctr: 0.007, cvr: 0.008, roas: 1.3 },
    landing_page: { cvr: 0.018 },
  },
  capacity: { email_per_market_per_week: 4, paid_campaigns_per_market_per_week: 5, landing_pages_per_week: 4 },
  calendar: { days: 90, markets: ['US', 'UK'], channels: ['email', 'google', 'meta', 'tiktok'], min_gap_days_same_cohort: 2 },
  review_policy: {
    launch_mode: true,
    auto_approve_min_confidence: 0.85,
    auto_approve_min_samples: 20,
    weekly_recalibration_max_age_days: 7,
    hard_block_when_overdue: true,
  },
  learned_weights: { angle_boost: {}, hook_boost: {}, festival_boost: {}, mvt_learnings: [] },
  peak_detection: { baseline_window_days: 28, spike_ratio: 1.45, min_occurrences: 1 },
};

async function getConfig() {
  const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    const rows = await db().select('smart_brain_config', { limit: 100 });
    for (const r of rows) out[r.key] = mergeDeep(out[r.key] || {}, r.value);
  } catch (_) { /* defaults */ }
  return out;
}

async function setConfig(key, value) {
  return db().upsert('smart_brain_config', [{ key, value, updated_at: new Date().toISOString() }], 'key');
}

function mergeDeep(base, over) {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return over;
  const out = { ...(typeof base === 'object' && base ? base : {}) };
  for (const [k, v] of Object.entries(over)) out[k] = mergeDeep(out[k], v);
  return out;
}

// ── Brand kit ────────────────────────────────────────────────────────────────
const FALLBACK_BRAND = {
  palette: { forest_green: '#6A33D8', lava: '#D0473E', near_black: '#111111', chalk: '#F7F5F2' },
  typography: {
    headings: { fallback: "'Montserrat','Raleway',Georgia,serif" },
    body: { fallback: "'Instrument Sans','Helvetica Neue',Arial,sans-serif" },
  },
  banned_phrases: ['streetwear journey', 'transform', 'liquid lava', 'game-changer', 'LIMITED TIME', 'hurry', "don't miss out", 'last chance', 'while supplies last'],
  preferred_lexicon: ['ritual', 'restore', 'balance', 'origin', 'one-of-one', 'hand-painted', 'lace-up', 'heritage', 'crafted'],
  voice: 'warm, sensory, emotionally resonant, story-driven',
  store_urls: { US: 'https://knickgasm.com', UK: 'https://knickgasm.com', IN: 'https://knickgasm.com', Global: 'https://knickgasm.com' },
};

async function getBrandKit() {
  try {
    const rows = await db().select('smart_assets', { filters: { id: 'eq.asset_brand_kit' }, limit: 1 });
    if (rows[0] && rows[0].content) return { ...FALLBACK_BRAND, ...rows[0].content };
  } catch (_) { /* fallback */ }
  return FALLBACK_BRAND;
}

function scrubBannedPhrases(text, brand) {
  let out = String(text || '');
  const swaps = {
    'streetwear journey': 'daily ritual', transform: 'restore', 'liquid lava': 'golden lace-up',
    'game-changer': 'quiet upgrade', 'LIMITED TIME': 'For a short season', hurry: 'when you are ready',
    "don't miss out": 'worth a look', 'last chance': 'a final pour', 'while supplies last': 'in small batches',
  };
  for (const [bad, good] of Object.entries(swaps)) {
    out = out.replace(new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), good);
  }
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────────
const todayIso = () => new Date().toISOString().slice(0, 10);
function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function idFor(prefix, input) { return `${prefix}_${crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 12)}`; }
function round(n, d = 4) { return Number.isFinite(+n) ? Number((+n).toFixed(d)) : 0; }
function pct(a, b) { return b > 0 ? a / b : 0; }
function sum(arr, f) { return arr.reduce((s, x) => s + (Number(f ? f(x) : x) || 0), 0); }
function groupBy(arr, f) { const m = {}; for (const x of arr) { const k = f(x); (m[k] = m[k] || []).push(x); } return m; }

async function logRun(runType, summary, ok = true) {
  try {
    const rows = await db().insert('smart_brain_runs', [{ run_type: runType, finished_at: new Date().toISOString(), ok, summary }]);
    return rows[0] ? rows[0].id : null;
  } catch (_) { return null; }
}

module.exports = {
  db, getConfig, setConfig, getBrandKit, scrubBannedPhrases, mergeDeep,
  todayIso, addDays, idFor, round, pct, sum, groupBy, logRun, DEFAULT_CONFIG,
};
