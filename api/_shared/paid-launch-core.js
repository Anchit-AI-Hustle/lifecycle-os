'use strict';
/**
 * paid-launch-core.js — the paid launch pipeline: account sync, plan, build
 * step by step, go live, move budget.
 * ---------------------------------------------------------------------------
 * The operator: "pipeline must be built for direct platform updation with
 * account sync and complete step by step asset updation like budget allotment
 * everything". The Meta adapter could already create a campaign, an ad set and
 * an ad, but nothing chained them: a meta_ad job made a creative with no ad set
 * ("creative_only") because an ad set is a budget and a targeting decision and
 * nobody had made one. This module makes those decisions explicit, in a plan the
 * operator reads before anything leaves:
 *
 *   SYNC     op=accounts / op=sync   the ad accounts the connection can see, and
 *            one account's campaigns and ad sets with status, budget and the
 *            last 7 days of spend per ad set (kept in paid_account_syncs).
 *   PLAN     op=plan   from the brand's OWN assets (a Smart Brain campaign, or
 *            the Winning angles briefs), a campaign -> ad sets -> creatives ->
 *            ads structure, with the operator's stated daily budget split across
 *            the ad sets (the test plan's rule: a control keeps 20%, the rest by
 *            its share with a 10% floor; else equal), in the account currency's
 *            smallest unit. Every ad is checked against its own contract and the
 *            compliance gate; a gap is a marker and BLOCKS the build, never a
 *            guess. No platform call.
 *   BUILD    op=run    the steps in order, one runner at a time (a lease on the
 *            row). Each step stores the id the platform gave it, so a re-run
 *            RESUMES and never creates an object twice. Every object is created
 *            PAUSED. Behind all three switches (LIVE_CONNECTORS, the brand's
 *            publishing toggle, META_ALLOW_WRITES): with one off, each step
 *            shows the exact request it would have made and nothing is sent.
 *   LIVE     op=go-live   a separate approval (owner or editor), stamped with
 *            the operator from the SESSION: ads, then ad sets, then the campaign
 *            are set ACTIVE, so nothing serves until the last one is on.
 *            op=pause turns the campaign off.
 *   BUDGET   op=budget   a new total daily budget, re-split across the launch's
 *            ad sets by the same shares and written one ad set at a time; a cut
 *            below Meta's floor (10% above what an ad set already spent) is
 *            refused before the call, when the sync read that spend.
 *
 * Platforms: Meta is built (every endpoint read in its documentation, see the
 * adapter's endpoint table). Google Ads, TikTok Ads and Pinterest are listed
 * with the reason they are not: their campaign, budget and ad-group create
 * calls were not confirmed against their documentation for this platform.
 *
 * Mounted on api/brain.js ?action=paid-launch&op=... (no new function).
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const brandCore = require('./brand-workspace-core.js');
const registry = require('./adapters/registry.js');
const { fillUrl, redact, redactUrl } = require('./adapters/base-adapter.js');
const { liveConnectorsEnabled } = require('./live-connectors.js');

const OPS = ['status', 'accounts', 'sync', 'syncs', 'plan', 'list', 'get', 'run', 'go-live', 'pause', 'budget'];
const LEASE_MS = 120000;
const RUN_BUDGET_MS = 50000;

/**
 * Meta's currency offset (developers.facebook.com/docs/marketing-api/currencies,
 * read 2026-10-20): budgets are "at ad account currencies minimum denomination
 * level, such as cents for USD" (bidding/overview/budgets). A currency in
 * neither list is refused with a marker rather than guessed.
 */
const OFFSET_1 = ['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND'];
const OFFSET_100 = ['DZD', 'ARS', 'AUD', 'BHD', 'BDT', 'BOB', 'BGN', 'BRL', 'GBP', 'CAD', 'CNY', 'HRK', 'CZK', 'DKK', 'EGP', 'EUR',
  'GTQ', 'HNL', 'HKD', 'INR', 'ILS', 'JOD', 'KES', 'LVL', 'LTL', 'MOP', 'MYR', 'MXN', 'NZD', 'NIO', 'NGN', 'NOK', 'PKR', 'PEN',
  'PHP', 'PLN', 'QAR', 'RON', 'RUB', 'SAR', 'RSD', 'SGD', 'SKK', 'ZAR', 'SEK', 'CHF', 'THB', 'TRY', 'AED', 'UAH', 'USD', 'UYU',
  'VEF', 'VES'];

/** Ad sets targeting these need dsa_payor and dsa_beneficiary (Meta's ad set reference). */
const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

/**
 * The objectives the pipeline builds, each with the ad set settings it uses.
 * Only traffic: it needs no pixel or app (promoted_object), which this platform
 * does not hold. Another objective is refused with the reason.
 */
const OBJECTIVES = {
  OUTCOME_TRAFFIC: { optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS', label: 'Traffic: clicks to the brand\'s page' },
};

/**
 * The platforms the launch pipeline offers. `built` = every call a launch on it
 * makes is confirmed in that platform's documentation (the adapter's endpoint
 * table); otherwise the launch PLANS (budget split, checks, the exact request
 * of every step) and the build withholds every step, sending nothing, with the
 * sentence naming what was not confirmed. The unconfirmed ops are read from the
 * adapter's own table, never typed here (unconfirmedOps()).
 */
const PLATFORMS = [
  { id: 'meta', label: 'Meta (Facebook + Instagram ads: image and video)', unit: 'minor', write_switch: 'META_ALLOW_WRITES', kinds: ['campaign', 'adset', 'video', 'creative', 'ad'] },
  { id: 'google_ads', label: 'Google Ads (Search: responsive search ads)', unit: 'micros', write_switch: 'GOOGLE_ADS_ALLOW_WRITES', kinds: ['budget', 'campaign', 'location', 'adgroup', 'ad'] },
  { id: 'tiktok_ads', label: 'TikTok Ads', unit: 'micros', write_switch: 'TIKTOK_ALLOW_WRITES', kinds: ['campaign', 'adgroup', 'media', 'ad'] },
  { id: 'pinterest', label: 'Pinterest ads', unit: 'micros', write_switch: 'PINTEREST_ALLOW_WRITES', kinds: ['campaign', 'adgroup', 'pin', 'ad'] },
];
const PLATFORM = Object.fromEntries(PLATFORMS.map((x) => [x.id, x]));
/** Smart Brain's ad.platform for each launch platform. */
const SOURCE_PLATFORM = { meta: 'meta', google_ads: 'google', tiktok_ads: 'tiktok', pinterest: 'pinterest' };
/** The object kind that holds a group's budget, and the go-live order (nothing serves until the last is on). */
const BUDGET_KIND = { meta: 'adset', google_ads: 'budget', tiktok_ads: 'adgroup', pinterest: 'adgroup' };
const GROUP_KIND = { meta: 'adset', google_ads: 'adgroup', tiktok_ads: 'adgroup', pinterest: 'adgroup' };

/** The endpoint-table ops a launch on `provider` needs that are not verified there. */
function unconfirmedOps(provider) {
  const P = PLATFORM[provider];
  const A = P && registry.adapterFor(provider);
  if (!A || typeof A.launchOps !== 'function') return [{ op: '*', note: `${provider} has no launch steps in its adapter.` }];
  return A.launchOps(P.kinds).filter((op) => !(A.endpointTable[op] && A.endpointTable[op].verified === true))
    .map((op) => { const ep = A.endpointTable[op] || {}; return { op, method: ep.method || null, url: ep.url || null, note: ep.note || 'Not in the adapter\'s endpoint table.' }; });
}

function platformRows() {
  return PLATFORMS.map((p) => {
    const un = unconfirmedOps(p.id);
    const out = { id: p.id, label: p.label, built: un.length === 0 };
    if (un.length) out.reason = `Planned, never sent: ${un.length} of the calls a ${p.label} launch makes ${un.length === 1 ? 'was' : 'were'} not confirmed against its documentation (${un.map((x) => x.op).join(', ')}). ${un[0].note}`;
    if (p.id === 'google_ads') out.scope = 'Search campaigns with responsive search ads. One campaign per ad group (a Google budget belongs to a campaign), every object paused. A budget change is not built: the update mask for a budget amount was not confirmed.';
    return out;
  });
}

const enc = encodeURIComponent;
const marker = (field, brand, region) => `[DATA REQUIRED BEFORE LAUNCH: ${[field, brand, region].filter(Boolean).join(', ')}]`;
function err(status, code, message) { const e = new Error(message); e.status = status; e.code = code; return e; }

/* ── storage: service role, only after the caller's rights were checked ──── */

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: String(url).replace(/\/$/, ''), key } : null;
}

async function svc(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = serviceEnv();
  if (!e) throw err(503, 'launch_store_unavailable', 'This deployment has no store for launches (SUPABASE_SERVICE_ROLE_KEY is not set), so nothing can be planned or built here.');
  const headers = { apikey: e.key, authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) throw err(502, 'launch_store_failed', `The launch store answered ${res.status} to ${method}.`);
  return json;
}

/* ── pure: money and shares ───────────────────────────────────────────────── */

/** The currency's offset, or null when Meta's table does not name it. */
function offsetOf(currency) {
  const c = String(currency || '').toUpperCase();
  if (OFFSET_1.includes(c)) return 1;
  if (OFFSET_100.includes(c)) return 100;
  return null;
}

/** A stated amount in major units -> the smallest unit Meta takes, or null. */
function toMinor(amount, currency) {
  const off = offsetOf(currency);
  const n = Number(amount);
  if (!off || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * off);
}

function fromMinor(minor, currency) {
  const off = offsetOf(currency);
  return off && Number.isFinite(Number(minor)) ? Number(minor) / off : null;
}

/**
 * Shares in percent. Given shares (the Winning angles test plan) are used as
 * stated, normalised to 100. Otherwise the test plan's rule: a control keeps
 * 20%, the rest by weight with a 10% floor; no control and no weights = equal.
 */
function sharesFor(groups) {
  const g = Array.isArray(groups) ? groups : [];
  if (!g.length) return [];
  if (g.every((x) => Number(x.share) > 0)) {
    const sum = g.reduce((s, x) => s + Number(x.share), 0);
    return g.map((x) => (Number(x.share) / sum) * 100);
  }
  const ci = g.findIndex((x) => x.control);
  const tests = g.map((x, i) => i).filter((i) => i !== ci);
  const pool = ci >= 0 ? (tests.length ? 80 : 100) : 100;
  const out = new Array(g.length).fill(0);
  if (ci >= 0) out[ci] = tests.length ? 20 : 100;
  if (tests.length) {
    const w = tests.map((i) => (Number(g[i].weight) > 0 ? Number(g[i].weight) : 1));
    const ws = w.reduce((s, x) => s + x, 0);
    let raw = w.map((x) => (x / ws) * pool);
    if (tests.length * 10 <= pool) {
      // Floor at 10%, the rest re-spread over the ones above the floor.
      for (let round = 0; round < tests.length; round += 1) {
        const low = raw.map((v) => v < 10);
        if (!low.some(Boolean)) break;
        const fixed = low.filter(Boolean).length * 10;
        const free = raw.map((v, k) => (low[k] ? 0 : w[k]));
        const fs = free.reduce((s, x) => s + x, 0);
        raw = raw.map((v, k) => (low[k] ? 10 : (fs ? (w[k] / fs) * (pool - fixed) : 0)));
      }
    } else {
      raw = raw.map(() => pool / tests.length);
    }
    tests.forEach((i, k) => { out[i] = raw[k]; });
  }
  return out;
}

/**
 * Split a total in smallest units by shares, in whole units that add up to the
 * total exactly (largest remainder). Never a fraction of a cent.
 */
function allocate(totalMinor, shares) {
  const t = Math.floor(Number(totalMinor) || 0);
  const s = Array.isArray(shares) ? shares : [];
  if (!s.length || t <= 0) return s.map(() => 0);
  const sum = s.reduce((a, x) => a + x, 0) || 1;
  const exact = s.map((x) => (t * x) / sum);
  const out = exact.map(Math.floor);
  let left = t - out.reduce((a, x) => a + x, 0);
  const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) out[order[k][1]] += 1;
  return out;
}

/**
 * Google, Pinterest and TikTok take money in micros of the account currency
 * (Google: amountMicros; Pinterest: budget_in_micro_currency, "For $10 USD, set
 * the value as 10000000"). One unit is a millionth; splits are exact in it.
 */
function toMicros(amount) { const n = Number(amount); return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) : null; }
/** The platform's smallest money unit for a stated amount, or null. */
function toUnit(provider, amount, currency) { return (PLATFORM[provider] || {}).unit === 'micros' ? (/^[A-Z]{3}$/.test(String(currency || '')) ? toMicros(amount) : null) : toMinor(amount, currency); }
function fromUnit(provider, v, currency) { return (PLATFORM[provider] || {}).unit === 'micros' ? (Number.isFinite(Number(v)) ? Number(v) / 1e6 : null) : fromMinor(v, currency); }

/** A market code as Meta's targeting takes it (ISO 3166-1 alpha-2), or ''. */
function countryOf(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c === 'UK') return 'GB';
  return /^[A-Z]{2}$/.test(c) ? c : '';
}

const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

/* ── the platform behind one brand ────────────────────────────────────────── */

function platformOf(provider) {
  const P = PLATFORM[provider];
  if (!P) throw err(400, 'platform_unknown', `"${provider}" is not a platform the launch pipeline plans. It plans ${PLATFORMS.map((x) => x.id).join(', ')}.`);
  return P;
}

async function adapterFor(auth, workspaceId, provider) {
  platformOf(provider);
  const c = await require('./social-gateway-core.js').credentialsFor(workspaceId, provider);
  if (!c.ok) return { ok: false, connected: !!c.connected, note: c.note, reconnect_required: !!c.reconnect_required, conn: c.conn || null };
  const A = registry.adapterFor(provider);
  const conn = c.conn || {};
  const publishEnabled = !!(conn.config && (conn.config.publishing_enabled === true || conn.config.publishing_enabled === 'true'));
  return { ok: true, adapter: new A({ workspaceId, credentials: c.credentials, connection: conn, publishEnabled }), conn };
}

/** Which switch stands between this brand and a live write, in words. */
function switchesFor(conn, provider) {
  const P = PLATFORM[provider || 'meta'] || PLATFORM.meta;
  const label = P.label.split(' (')[0];
  const publishing = !!(conn && conn.config && (conn.config.publishing_enabled === true || conn.config.publishing_enabled === 'true'));
  const out = {
    live_connectors: liveConnectorsEnabled(),
    workspace_publishing: publishing,
    platform_writes: process.env[P.write_switch] === '1',
    write_switch: P.write_switch,
  };
  const off = [];
  if (!out.live_connectors) off.push(`LIVE_CONNECTORS is off on this deployment (the default), so nothing is read from or written to ${label}.`);
  if (!out.workspace_publishing) off.push(`Live publishing is off for ${label} on this brand (a switch on the connection), so each step builds its request and stops.`);
  if (!out.platform_writes) off.push(`${P.write_switch} is not set to 1 on the deployment, so each step builds its request and stops.`);
  return Object.assign(out, { all_on: off.length === 0, off });
}

/* ── status, accounts, account read ──────────────────────────────────────── */

async function status(auth, workspaceId) {
  const rows = platformRows();
  for (const r of rows) {
    let conn = null; let note = '';
    if (workspaceId) {
      try {
        const c = await require('./social-gateway-core.js').credentialsFor(workspaceId, r.id);
        conn = c.conn || null;
        if (!c.ok) note = c.note || '';
      } catch (e) { note = e.message; }
    }
    Object.assign(r, { connected: !!conn, note, switches: switchesFor(conn, r.id) });
  }
  return {
    ok: true,
    platforms: rows,
    objectives: Object.keys(OBJECTIVES).map((k) => ({ id: k, label: OBJECTIVES[k].label })),
    rule: 'Every object is created PAUSED. Going live is a separate approval, recorded with who gave it.',
  };
}

const READ_IS_META_ONLY = 'The account read is built for Meta only; for this platform the plan takes the currency you state, labelled as stated.';

async function accounts(auth, workspaceId, provider) {
  const ws = await brandCore.getWorkspace(auth, workspaceId);
  if (!ws) throw err(404, 'workspace_not_found', 'That brand is not one you can see.');
  platformOf(provider);
  if (provider !== 'meta') return { ok: false, provider, note: READ_IS_META_ONLY };
  const a = await adapterFor(auth, workspaceId, provider);
  if (!a.ok) return Object.assign({ ok: false, provider }, a, { conn: undefined });
  if (!liveConnectorsEnabled()) return { ok: false, provider, connected: true, live: false, note: 'LIVE_CONNECTORS is off on this deployment, which is the default, so the ad accounts were not read.' };
  const r = await a.adapter.listAdAccounts();
  const configured = String((a.conn.config && a.conn.config.ad_account_id) || '');
  return Object.assign({ provider, connected: true, configured_ad_account: configured || null }, r);
}

async function sync(auth, workspaceId, body) {
  const provider = String(body.provider || 'meta');
  const ws = await brandCore.getWorkspace(auth, workspaceId);
  if (!ws) throw err(404, 'workspace_not_found', 'That brand is not one you can see.');
  platformOf(provider);
  if (provider !== 'meta') return { ok: false, provider, note: READ_IS_META_ONLY };
  const a = await adapterFor(auth, workspaceId, provider);
  if (!a.ok) return Object.assign({ ok: false, provider }, a, { conn: undefined });
  const act = String(body.ad_account_id || (a.conn.config && a.conn.config.ad_account_id) || '');
  if (!act) return { ok: false, provider, note: marker('ad account id', ws.name) };
  const read = await a.adapter.readPaidStructure(act);
  if (!read.ok) return Object.assign({ ok: false, provider, ad_account_id: act }, read);
  const acc = await a.adapter.listAdAccounts().catch(() => null);
  const row = acc && acc.ok ? (acc.accounts || []).find((x) => a.adapter.actPath(x.id) === a.adapter.actPath(act)) : null;
  const currency = (row && row.currency) || null;
  const stored = await svc('paid_account_syncs', {
    method: 'POST', prefer: 'return=representation',
    body: [{
      workspace_id: workspaceId, provider, ad_account_id: a.adapter.actPath(act), currency, complete: read.complete !== false,
      campaigns: read.campaigns, ad_sets: read.ad_sets, synced_by: auth.user_id, synced_at: new Date().toISOString(),
      note: read.spend_read === true ? '' : `Spend was not read: ${read.spend_read}`,
    }],
  });
  const major = (rows) => rows.map((x) => Object.assign({}, x, { daily_budget: currency && x.daily_budget_minor != null ? fromMinor(x.daily_budget_minor, currency) : null }));
  return {
    ok: true, provider, ad_account_id: a.adapter.actPath(act), currency,
    complete: read.complete !== false,
    campaigns: major(read.campaigns), ad_sets: major(read.ad_sets),
    spend_read: read.spend_read,
    sync_id: Array.isArray(stored) && stored[0] ? stored[0].id : null,
    note: read.complete === false ? 'The account has more objects than one sync reads (1,000 of each); the newest are shown.' : '',
  };
}

async function latestSync(workspaceId, provider, act) {
  const rows = await svc(`paid_account_syncs?select=*&workspace_id=eq.${enc(workspaceId)}&provider=eq.${enc(provider)}&ad_account_id=eq.${enc(act)}&order=synced_at.desc&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/* ── plan ─────────────────────────────────────────────────────────────────── */

/** The ad's own rendered MP4, when the campaign has one (https only). */
function videoUrlOf(a) {
  const c = (a && a.creative) || {};
  const v = c.video && typeof c.video === 'object' ? c.video : {};
  const u = String(v.url || v.mp4_url || c.video_url || c.mp4_url || a.video_url || '');
  return /^https:\/\//i.test(u) ? u : '';
}
function imageOf(a) {
  const c = (a && a.creative) || {};
  return String(c.image || a.image_url || (Array.isArray(c.images_used) && c.images_used[0]) || '');
}
const lines = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])).map((x) => String(x || '').trim()).filter(Boolean);

/** One source ad as the launch carries it, for one platform. */
function launchAd(provider, a, i, brandName, link) {
  const base = {
    name: clip(a.headline || a.angle_name || `${brandName} ad ${i + 1}`, 80),
    primary_text: a.primary_text || a.caption || a.hook || '', headline: a.headline || '', description: a.description || '',
    image_url: imageOf(a), link: String(a.link || link || ''), script: a.script || '',
  };
  if (provider === 'google_ads') {
    Object.assign(base, {
      headlines: lines(a.headlines).length ? lines(a.headlines) : lines(a.headline),
      descriptions: lines(a.descriptions).length ? lines(a.descriptions) : lines([a.description, a.primary_text]),
      link: String(a.final_url || a.link || link || ''),
    });
  }
  const v = videoUrlOf(a);
  if (v && provider !== 'google_ads') base.video_url = v;
  return base;
}

/** The ads a launch is built from, read from the brand's OWN records. */
async function sourceAds(workspaceId, body, brandName, provider) {
  const s = body.source || {};
  const want = SOURCE_PLATFORM[provider];
  if (s.kind === 'campaign') {
    const id = String(s.campaign_id || '');
    if (!id) throw err(400, 'campaign_required', 'Name the Smart Brain campaign the launch is built from (source.campaign_id).');
    const rows = await svc(`smart_generated_campaigns?select=id,payload&id=eq.${enc(id)}&workspace_id=eq.${enc(workspaceId)}&limit=1`);
    const p = Array.isArray(rows) && rows[0] ? rows[0].payload : null;
    if (!p) throw err(404, 'campaign_not_found', 'That campaign is not one of this brand\'s.');
    const ads = ((p.assets && p.assets.ads) || []).filter((a) => a && a.platform === want);
    const lp = (p.assets && p.assets.landing_pages && p.assets.landing_pages[0]) || null;
    const link = String(body.link || p.landing_url || (lp && (lp.url || lp.public_url)) || '');
    const notes = [];
    const kept = [];
    ads.forEach((a, i) => {
      const ad = launchAd(provider, a, i, brandName, link);
      if (a.creative_type === 'video' && provider !== 'google_ads' && !ad.video_url) {
        notes.push(`The video ad "${clip(a.headline || `ad ${i + 1}`, 60)}" was left out: the campaign has no rendered MP4 for it (an https file the platform can fetch), only its animated preview.`);
        return;
      }
      if (a.creative_type !== 'video') delete ad.video_url;
      kept.push(ad);
    });
    return {
      label: `Smart Brain campaign ${id}`,
      groups: [{ key: 'all', name: p.campaign_name || (p.campaign && p.campaign.name) || `${brandName} campaign`, control: false, ads: kept }],
      per_market: true, notes,
    };
  }
  if (s.kind === 'briefs') {
    const briefs = Array.isArray(s.briefs) ? s.briefs.slice(0, 12) : [];
    if (!briefs.length) throw err(400, 'briefs_required', 'No briefs were given. Build them on Winning angles first.');
    return {
      label: 'Winning angles briefs',
      groups: briefs.map((b, i) => ({
        key: String(b.id || `brief-${i + 1}`), name: clip(b.angle_name || b.name || `Brief ${i + 1}`, 80),
        control: b.basis === 'control' || !!b.control, share: Number(b.share) > 0 ? Number(b.share) : null,
        weight: Number(b.signal_share) > 0 ? Number(b.signal_share) : null,
        ads: [launchAd(provider, Object.assign({}, b, { image_url: b.image_url || body.image_url || '', link: b.link || body.link || '', video_url: b.video_url || '' }), i, brandName, body.link)],
      })),
      per_market: false, notes: [],
    };
  }
  throw err(400, 'source_required', 'Say what the launch is built from: source.kind "campaign" (a Smart Brain campaign) or "briefs" (Winning angles).');
}

/** Each of Google's RSA lines within its limit; a longer one is DROPPED, never cut (asset-contracts' own numbers). */
function rsaLines(ad, warnings, where) {
  const ac = require('./asset-contracts.js');
  const fit = (list, slot, max) => {
    const lim = Number(ac.slotLimit('ad.google.rsa', slot)) || 0;
    const out = [];
    for (const t of list) {
      if (lim && t.length > lim) { warnings.push(`${where}: the ${slot.slice(0, -1)} "${clip(t, 40)}" is ${t.length} characters, over Google's ${lim}; it was left out, not shortened.`); continue; }
      if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    }
    return out.slice(0, max);
  };
  ad.headlines = fit(ad.headlines || [], 'headlines', 15);
  ad.descriptions = fit(ad.descriptions || [], 'descriptions', 4);
}

/** The checks a launch must pass before a step may be built. */
async function checkAd(provider, ad, ws, market) {
  const blocking = [];
  const warnings = [];
  const name = ws.name;
  const texts = provider === 'google_ads'
    ? [...(ad.headlines || []).map((t) => ['headline', t]), ...(ad.descriptions || []).map((t) => ['description', t])]
    : [['primary text', ad.primary_text], ['headline', ad.headline], ['description', ad.description]];
  if (provider !== 'google_ads' && !ad.primary_text) blocking.push(marker('primary text', name, market));
  for (const [k, v] of texts) if (/\[DATA REQUIRED/i.test(String(v || ''))) blocking.push(`The ${k} still carries a gap: ${clip(v, 160)}`);
  if (!/^https:\/\//i.test(ad.link)) blocking.push(marker('landing page URL (https)', name, market));
  const label = ((PLATFORM[provider] || {}).label || provider).split(' (')[0];
  if (provider === 'meta' || provider === 'pinterest') {
    if (!/^https:\/\//i.test(ad.image_url)) blocking.push(marker(ad.video_url ? 'video thumbnail image (a public https URL Meta can fetch)' : `product image (a public https URL ${label} can fetch)`, name, market));
  }
  if (provider === 'tiktok_ads' && !ad.video_url && !/^https:\/\//i.test(ad.image_url)) blocking.push(marker('the ad\'s own video or image (a public https URL)', name, market));
  if (ad.video_url) {
    // The platform fetches the file itself, so it must be a public address.
    try { await require('./brand-workspace-core.js').assertPublicUrl(ad.video_url); }
    catch (e) { blocking.push(`The ad's video ${clip(ad.video_url, 120)} cannot be sent: ${e.message}`); }
  }
  let asset = null;
  if (provider === 'google_ads') asset = { platform: 'google', headlines: ad.headlines, descriptions: ad.descriptions, final_url: ad.link };
  else if (provider !== 'pinterest') {
    const plat = provider === 'meta' ? 'meta' : 'tiktok';
    asset = { platform: plat, creative_type: ad.video_url ? 'video' : 'static', primary_text: ad.primary_text, headline: ad.headline, description: ad.description, caption: ad.primary_text, script: ad.script, creative: ad.video_url ? { image: ad.image_url, video: { url: ad.video_url } } : { image: ad.image_url } };
  }
  if (asset) {
    try {
      const contract = require('./asset-contracts.js').check(asset);
      for (const v of contract.violations || []) {
        // A creative brief is how a picture would be MADE; an ad launched with
        // its own photo or video already has the picture.
        if (v.slot === 'creative_brief' && (ad.video_url || /^https:\/\//i.test(ad.image_url))) continue;
        (v.level === 'block' ? blocking : warnings).push(`${v.slot ? v.slot + ': ' : ''}${v.message}`);
      }
    } catch (_) { warnings.push('The ad contract could not be read, so the copy limits were not checked.'); }
  } else warnings.push(`No copy contract governs ${label} ads here, so their copy limits were not checked.`);
  try {
    const copy = provider === 'google_ads' ? { headline: (ad.headlines || []).join(' | '), description: (ad.descriptions || []).join(' | ') } : { primary_text: ad.primary_text, headline: ad.headline, description: ad.description };
    const lint = require('./compliance-lint.js').lint(copy, { brand: ws, market });
    for (const f of lint.findings || []) (f.severity === 'BLOCK' ? blocking : warnings).push(`Compliance: ${f.title}${f.fix ? ' - ' + f.fix : ''}`);
  } catch (_) { warnings.push('The compliance gate could not run on this ad, so it was not checked.'); }
  return { blocking, warnings };
}

/** The account a launch is built on, per platform, from the connection or the body. */
function accountOf(provider, body, cfg) {
  if (provider === 'meta') { const a = String(body.ad_account_id || cfg.ad_account_id || ''); return a ? (a.startsWith('act_') ? a : `act_${a}`) : ''; }
  if (provider === 'google_ads') return String(body.customer_id || cfg.customer_id || '').replace(/[^0-9]/g, '');
  if (provider === 'tiktok_ads') return String(body.advertiser_id || cfg.advertiser_id || '');
  return String(body.ad_account_id || cfg.ad_account_id || '');
}
const ACCOUNT_FIELD = { meta: 'ad account id', google_ads: 'Google Ads customer id (ten digits)', tiktok_ads: 'TikTok advertiser id', pinterest: 'Pinterest ad account id' };

async function plan(auth, workspaceId, body) {
  const ws = await brandCore.assertCanWrite(auth, workspaceId, 'plan a paid launch');
  const provider = String(body.provider || 'meta');
  const P = platformOf(provider);
  const label = P.label.split(' (')[0];
  const a = await adapterFor(auth, workspaceId, provider);
  const conn = a.conn || {};
  const cfg = conn.config || {};
  const blocking = [];
  const warnings = [];
  const notes = [];
  if (!a.ok) blocking.push(a.note || `${label} is not connected on this brand.`);

  const actId = accountOf(provider, body, cfg);
  if (!actId) blocking.push(marker(ACCOUNT_FIELD[provider], ws.name));
  const pageId = provider === 'meta' ? String(body.page_id || cfg.page_id || '') : '';
  if (provider === 'meta' && !pageId) blocking.push(`${marker('Facebook Page id', ws.name)} Meta creates each ad's post on the brand's Page.`);
  const boardId = provider === 'pinterest' ? String(body.board_id || cfg.board_id || '') : '';
  if (provider === 'pinterest' && !boardId) blocking.push(`${marker('Pinterest board id', ws.name)} Each ad runs on a Pin, and a Pin is created on a board.`);

  // Currency: what Meta said in the last account read, else what the operator
  // stated (and labelled so). Only Meta's account read is built.
  let currency = '';
  let currencyBasis = '';
  if (provider === 'meta' && actId) {
    const last = await latestSync(workspaceId, provider, actId).catch(() => null);
    if (last && last.currency) { currency = String(last.currency).toUpperCase(); currencyBasis = `read from Meta in the account sync of ${last.synced_at}`; }
  }
  if (!currency && body.currency) { currency = String(body.currency).toUpperCase(); currencyBasis = provider === 'meta' ? 'as stated by the operator; not yet read from Meta (run the account sync)' : `as stated by the operator; ${label}'s account currency is not read here`; }
  if (!currency) blocking.push(marker(provider === 'meta' ? 'ad account currency (run the account sync)' : `${label} account currency (as the account states it)`, ws.name));
  else if (P.unit === 'minor' && !offsetOf(currency)) blocking.push(`${currency} is not in Meta's currency table, so its smallest unit is not known here. ${marker('ad account currency offset', ws.name)}`);
  else if (P.unit === 'micros' && !/^[A-Z]{3}$/.test(currency)) blocking.push(`${currency} is not a three-letter currency code. ${marker('account currency', ws.name)}`);

  const objective = String(body.objective || 'OUTCOME_TRAFFIC').toUpperCase();
  const obj = OBJECTIVES[objective];
  if (!obj) blocking.push(`${objective} needs a pixel or app (promoted object) that this platform does not hold; the pipeline builds ${Object.keys(OBJECTIVES).join(', ')}.`);

  const total = Number(body.total_daily_budget);
  const totalUnit = currency ? toUnit(provider, total, currency) : null;
  if (!(total > 0)) blocking.push(marker('total daily budget', ws.name));

  const markets = (Array.isArray(body.markets) ? body.markets : String(body.markets || '').split(',')).map((m) => String(m).trim()).filter(Boolean);
  const countries = markets.map(countryOf).filter(Boolean);
  if (!countries.length) blocking.push(marker('target country (a market the brand serves)', ws.name));
  const eu = countries.filter((c) => EU.includes(c));
  const dsaPayor = clip(body.dsa_payor, 200);
  const dsaBeneficiary = clip(body.dsa_beneficiary, 200);
  if (provider === 'meta' && eu.length && (!dsaPayor || !dsaBeneficiary)) blocking.push(`Ad sets reaching ${eu.join(', ')} need who pays for and who benefits from the ads (Meta's DSA fields). ${marker('DSA payor and beneficiary', ws.name, eu.join('/'))}`);

  // Google: a country is a geo target constant id (Google's geotargets table),
  // stated by the operator per market, never guessed; and every campaign
  // declares whether it contains EU political advertising.
  const geo = {};
  let euPolitical = '';
  if (provider === 'google_ads') {
    const stated = body.geo_target_constants && typeof body.geo_target_constants === 'object' ? body.geo_target_constants : {};
    for (const c of countries) {
      const id = String(stated[c] || stated[c.toLowerCase()] || '').replace(/^geoTargetConstants\//, '').replace(/[^0-9]/g, '');
      if (id) geo[c] = id;
      else blocking.push(`${marker('Google geo target constant id', ws.name, c)} Google targets a country by its id in developers.google.com/google-ads/api/reference/data/geotargets; a campaign with no location targets every country.`);
    }
    const d = body.eu_political_advertising;
    if (d === false || d === 'none' || d === 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING') euPolitical = 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING';
    else if (d === true || d === 'contains' || d === 'CONTAINS_EU_POLITICAL_ADVERTISING') euPolitical = 'CONTAINS_EU_POLITICAL_ADVERTISING';
    else blocking.push(`${marker('EU political advertising declaration', ws.name)} Every Google campaign states whether it contains EU political advertising.`);
  }
  if (provider === 'tiktok_ads') notes.push('TikTok targets by its own location ids, which are not mapped here from country codes; the withheld ad group request carries none.');
  if (provider === 'pinterest') notes.push('Pinterest has no objective named traffic; the campaign is planned as CONSIDERATION (clicks).');

  const src = await sourceAds(workspaceId, body, ws.name, provider);
  notes.push(...src.notes);

  // Groups: per market for a single campaign's ads (each market its own budget
  // line), per brief for Winning angles (each angle its own test cell).
  const groups = src.per_market && countries.length > 1
    ? countries.map((c) => Object.assign({}, src.groups[0], { key: c.toLowerCase(), name: `${src.groups[0].name} - ${c}`, countries: [c] }))
    : src.groups.map((g) => Object.assign({}, g, { countries }));
  if (!groups.length || groups.every((g) => !g.ads.length)) blocking.push(`${src.label} has no ${label} ad to launch.`);

  const shares = sharesFor(groups);
  const split = totalUnit ? allocate(totalUnit, shares) : groups.map(() => null);
  const baseName = clip(body.name || `${ws.name} - ${src.label}`, 120);

  const adSets = [];
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    const market = g.countries.join('/');
    const ads = [];
    for (let j = 0; j < g.ads.length; j += 1) {
      const ad = Object.assign({ key: `${g.key}-ad-${j + 1}` }, g.ads[j], { cta_type: 'LEARN_MORE' });
      if (provider === 'google_ads') rsaLines(ad, warnings, `${g.name}, ad ${j + 1}`);
      const c = await checkAd(provider, ad, ws, market);
      blocking.push(...c.blocking.map((x) => `${g.name}, ad ${j + 1}: ${x}`));
      warnings.push(...c.warnings.map((x) => `${g.name}, ad ${j + 1}: ${x}`));
      ads.push(ad);
    }
    const isEu = g.countries.some((c) => EU.includes(c));
    adSets.push({
      key: `adset-${g.key}`, name: clip(`${baseName} - ${g.name}`, 200), share_pct: Math.round(shares[i] * 100) / 100,
      control: !!g.control, countries: g.countries,
      daily_budget_minor: split[i], daily_budget: split[i] != null ? fromUnit(provider, split[i], currency) : null,
      targeting: { geo_locations: { countries: g.countries } },
      geo_target_constants: provider === 'google_ads' ? g.countries.map((c) => geo[c]).filter(Boolean) : undefined,
      optimization_goal: obj ? obj.optimization_goal : null, billing_event: obj ? obj.billing_event : null,
      dsa_payor: provider === 'meta' && isEu ? dsaPayor : '', dsa_beneficiary: provider === 'meta' && isEu ? dsaBeneficiary : '',
      ads,
    });
  }
  for (const s of adSets) if (s.daily_budget_minor === 0) blocking.push(`${s.name} would get no budget: the total is too small to split across ${adSets.length} ad sets.`);
  if (provider === 'meta' && (body.special_ad_categories || []).length === 0) notes.push('No special ad category was declared. If these ads are about credit, employment, housing, or social issues, elections or politics, Meta requires it to be declared before they run.');

  const unconfirmed = unconfirmedOps(provider);
  if (unconfirmed.length) notes.push(`${label}: planned, and every step will be withheld with its exact request. Not confirmed in ${label}'s documentation: ${unconfirmed.map((x) => x.op).join(', ')}. ${unconfirmed[0].note}`);

  const thePlan = {
    provider, ad_account_id: actId, page_id: pageId, board_id: boardId || undefined, currency: currency || null, currency_basis: currencyBasis,
    budget_unit: P.unit === 'micros' ? 'micros (a millionth of the account currency)' : 'the currency\'s smallest unit by Meta\'s offset table',
    objective, total_daily_budget: total > 0 ? total : null, total_daily_budget_minor: totalUnit,
    contains_eu_political_advertising: euPolitical || undefined,
    split_rule: groups.some((g) => g.control) || groups.some((g) => Number(g.share) > 0)
      ? 'The test plan\'s rule: a control keeps 20%, every other ad set its share of the competitor signal with a 10% floor.'
      : 'Equal across the ad sets: no ad set was given a share or a signal.',
    source: { kind: (body.source || {}).kind, label: src.label, campaign_id: (body.source || {}).campaign_id || null },
    campaign: { key: 'campaign', name: baseName, objective, special_ad_categories: Array.isArray(body.special_ad_categories) ? body.special_ad_categories.map((x) => String(x).toUpperCase()).slice(0, 6) : [] },
    ad_sets: adSets,
    unconfirmed,
    checks: { blocking: [...new Set(blocking)], warnings: [...new Set(warnings)], notes },
  };
  const steps = stepsFor(thePlan);
  const row = await svc('paid_launches', {
    method: 'POST', prefer: 'return=representation',
    body: [{ workspace_id: workspaceId, provider, ad_account_id: actId || '-', name: baseName, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), status: thePlan.checks.blocking.length ? 'blocked' : 'planned', plan: thePlan, steps, created_by: auth.user_id, last_note: thePlan.checks.blocking[0] || '' }],
  });
  const launch = Array.isArray(row) ? row[0] : row;
  return { ok: true, launch: present(launch), switches: switchesFor(conn, provider) };
}

/** The ordered steps, per platform. */
function stepsFor(p) {
  const provider = p.provider || 'meta';
  const money = (s) => (s.daily_budget != null ? `${s.daily_budget} ${p.currency}` : 'budget not set');
  const out = [];
  const adSteps = (s, ad, mediaKind) => {
    if (mediaKind && (mediaKind !== 'video' || ad.video_url)) out.push({ key: `${ad.key}-${mediaKind}`, kind: mediaKind, parent: s.key, ad: ad.key, status: 'pending', label: `${mediaKind === 'video' ? 'Video' : mediaKind === 'pin' ? 'Ad-only Pin' : 'Media'} for "${ad.name}"` });
    if (provider === 'meta') out.push({ key: `${ad.key}-creative`, kind: 'creative', parent: s.key, ad: ad.key, status: 'pending', label: `Creative "${ad.name}"${ad.video_url ? ' (video)' : ''}` });
    out.push({ key: ad.key, kind: 'ad', parent: s.key, creative: provider === 'meta' ? `${ad.key}-creative` : undefined, status: 'pending', label: `Ad "${ad.name}" (paused)` });
  };
  if (provider === 'google_ads') {
    for (const s of p.ad_sets) {
      out.push({ key: `${s.key}-budget`, kind: 'budget', group: s.key, status: 'pending', label: `Campaign budget for "${s.name}": ${money(s)} a day (${s.share_pct}%)` });
      out.push({ key: `${s.key}-campaign`, kind: 'campaign', group: s.key, status: 'pending', label: `Search campaign "${s.name}" (paused)` });
      out.push({ key: `${s.key}-location`, kind: 'location', group: s.key, status: 'pending', label: `Locations: ${s.countries.join(', ')}` });
      out.push({ key: s.key, kind: 'adgroup', group: s.key, status: 'pending', label: `Ad group "${s.name}" (paused)` });
      for (const ad of s.ads) adSteps(s, ad, null);
    }
    return out;
  }
  out.push({ key: 'campaign', kind: 'campaign', status: 'pending', label: `Campaign "${p.campaign.name}" (paused)` });
  for (const s of p.ad_sets) {
    out.push({ key: s.key, kind: GROUP_KIND[provider], parent: 'campaign', status: 'pending', label: `${provider === 'meta' ? 'Ad set' : 'Ad group'} "${s.name}": ${money(s)} a day (${s.share_pct}%) in ${s.countries.join(', ')}` });
    for (const ad of s.ads) adSteps(s, ad, provider === 'meta' ? 'video' : provider === 'pinterest' ? 'pin' : 'media');
  }
  return out;
}

function present(row) {
  if (!row) return null;
  const steps = Array.isArray(row.steps) ? row.steps : [];
  return {
    id: row.id, name: row.name, status: row.status, provider: row.provider, ad_account_id: row.ad_account_id,
    plan: row.plan, steps,
    progress: { done: steps.filter((s) => s.status === 'done').length, total: steps.length },
    approved_by: row.approved_by || null, approved_at: row.approved_at || null,
    last_note: row.last_note || '', created_at: row.created_at, updated_at: row.updated_at,
  };
}

async function loadLaunch(workspaceId, id) {
  if (!id) throw err(400, 'launch_required', 'Name the launch (launch_id).');
  const rows = await svc(`paid_launches?select=*&id=eq.${enc(id)}&workspace_id=eq.${enc(workspaceId)}&limit=1`);
  const row = Array.isArray(rows) && rows[0];
  if (!row) throw err(404, 'launch_not_found', 'That launch is not one of this brand\'s.');
  return row;
}

async function save(row, patch, extraFilter) {
  const out = await svc(`paid_launches?id=eq.${enc(row.id)}&workspace_id=eq.${enc(row.workspace_id)}${extraFilter || ''}`, {
    method: 'PATCH', prefer: 'return=representation', body: Object.assign({ updated_at: new Date().toISOString() }, patch),
  });
  return Array.isArray(out) ? out[0] : out;
}

/* ── build, step by step ──────────────────────────────────────────────────── */

/** How long to wait between reads of an uploading video, and how many reads one run makes. */
function videoPollMs() {
  const v = process.env.PAID_LAUNCH_VIDEO_POLL_MS;
  return v !== undefined && Number(v) >= 0 ? Number(v) : 4000;
}
const VIDEO_POLLS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The plan's own row for one step, in the shape the adapter's paidRequest takes. */
function specFor(p, step, byKey, adSetOf, adOf) {
  const provider = p.provider || 'meta';
  const idOf = (key) => (byKey[key] && byKey[key].external_id) || '';
  const ad = step.ad ? adOf[step.ad] : step.kind === 'ad' ? adOf[step.key] : null;
  if (provider === 'google_ads') {
    const s = adSetOf[step.group || (ad && ad.adset)];
    const g = s ? s.key : '';
    if (step.kind === 'budget') return { customer_id: p.ad_account_id, name: `${s.name} - budget`, daily_budget_micros: s.daily_budget_minor };
    if (step.kind === 'campaign') return { customer_id: p.ad_account_id, name: s.name, budget_resource: idOf(`${g}-budget`), contains_eu_political_advertising: p.contains_eu_political_advertising };
    if (step.kind === 'location') return { customer_id: p.ad_account_id, campaign_resource: idOf(`${g}-campaign`), geo_target_constants: s.geo_target_constants };
    if (step.kind === 'adgroup') return { customer_id: p.ad_account_id, name: s.name, campaign_resource: idOf(`${g}-campaign`) };
    return { customer_id: p.ad_account_id, adgroup_resource: idOf(ad.adset), final_url: ad.link, headlines: ad.headlines, descriptions: ad.descriptions };
  }
  if (step.kind === 'campaign') return Object.assign({ ad_account_id: p.ad_account_id, advertiser_id: p.ad_account_id }, p.campaign);
  if (step.kind === 'adset' || step.kind === 'adgroup') {
    const s = adSetOf[step.key];
    return { ad_account_id: p.ad_account_id, advertiser_id: p.ad_account_id, name: s.name, campaign_id: idOf('campaign'), daily_budget_minor: s.daily_budget_minor,
      daily_budget_micros: s.daily_budget_minor, daily_budget: s.daily_budget, countries: s.countries,
      billing_event: s.billing_event, optimization_goal: s.optimization_goal, targeting: s.targeting,
      dsa_payor: s.dsa_payor || '', dsa_beneficiary: s.dsa_beneficiary || '' };
  }
  if (step.kind === 'video') return { ad_account_id: p.ad_account_id, name: ad.name, file_url: ad.video_url };
  if (step.kind === 'media') return { advertiser_id: p.ad_account_id, video_url: ad.video_url || '', image_url: ad.image_url };
  if (step.kind === 'pin') return { board_id: p.board_id, image_url: ad.image_url, headline: ad.headline, primary_text: ad.primary_text, link: ad.link };
  if (step.kind === 'creative') {
    return { ad_account_id: p.ad_account_id, page_id: p.page_id, name: ad.name, primary_text: ad.primary_text, headline: ad.headline, description: ad.description,
      image_url: ad.image_url, link: ad.link, cta_type: ad.cta_type, video_id: ad.video_url ? idOf(`${ad.key}-video`) : undefined };
  }
  // the ad
  return { ad_account_id: p.ad_account_id, advertiser_id: p.ad_account_id, name: ad.name, adset_id: idOf(ad.adset), adgroup_id: idOf(ad.adset),
    creative_id: idOf(`${ad.key}-creative`), pin_id: idOf(`${ad.key}-pin`), media_id: idOf(`${ad.key}-media`),
    primary_text: ad.primary_text, link: ad.link, video_url: ad.video_url || '' };
}

/** The exact request a step would make, as it may be shown: no token, no proof. */
function shownRequest(adapter, kind, spec) {
  const rq = typeof adapter.paidRequest === 'function' ? adapter.paidRequest(kind, spec) : null;
  if (!rq) return null;
  const ep = adapter.constructor.endpointFor(rq.op) || {};
  const built = fillUrl(ep.url || '', rq.params, rq.query);
  return { method: ep.method || null, url: built.ok ? redactUrl(built.url) : ep.url || null, body: redact(rq.body) };
}

/**
 * Run the pending steps in order. One runner per launch: the lease is CLAIMED
 * by a conditional PATCH, so a second press (or a second tab) runs nothing.
 * A step that the platform refused stops the run there; a step a switch
 * withheld is marked `withheld` with the exact request, and the run stops.
 * A re-run starts at the first step that is not done. A platform whose launch
 * calls are not all confirmed is withheld at its first step, every time, and
 * nothing at all is sent (half a structure on someone's account is worse than
 * none).
 */
async function run(auth, workspaceId, body) {
  await brandCore.assertCanWrite(auth, workspaceId, 'build a paid launch on the platform');
  let row = await loadLaunch(workspaceId, String(body.launch_id || ''));
  const p = row.plan || {};
  const provider = row.provider || p.provider || 'meta';
  const label = (PLATFORM[provider] || { label: provider }).label.split(' (')[0];
  if (p.checks && p.checks.blocking && p.checks.blocking.length) {
    return { ok: false, error: 'launch_blocked', message: `This launch cannot be built until ${p.checks.blocking.length} gap(s) are fixed. First: ${p.checks.blocking[0]}`, launch: present(row) };
  }
  if (row.status === 'live') return { ok: false, error: 'already_live', message: 'This launch is already live.', launch: present(row) };

  const token = crypto.randomBytes(12).toString('hex');
  const stale = new Date(Date.now() - LEASE_MS).toISOString();
  const claimed = await save(row, { run_token: token, run_started_at: new Date().toISOString(), status: 'building' },
    `&or=(run_token.is.null,run_started_at.lt.${enc(stale)})`);
  if (!claimed) return { ok: false, error: 'run_in_progress', message: 'This launch is already being built (another press or tab); it will carry on by itself.', launch: present(row) };
  row = claimed;

  const a = await adapterFor(auth, workspaceId, provider);
  if (!a.ok) {
    row = await save(row, { run_token: null, status: 'blocked', last_note: a.note || `${label} is not connected.` });
    return { ok: false, error: 'not_connected', message: a.note || `${label} is not connected on this brand.`, launch: present(row) };
  }
  const steps = (row.steps || []).map((s) => Object.assign({}, s));
  const byKey = {};
  for (const s of steps) byKey[s.key] = s;
  const adSetOf = {};
  for (const s of p.ad_sets || []) adSetOf[s.key] = s;
  const adOf = {};
  for (const s of p.ad_sets || []) for (const ad of s.ads || []) adOf[ad.key] = Object.assign({ adset: s.key }, ad);

  // Unconfirmed calls are read from the adapter's table NOW, not from the
  // stored plan: a launch planned before an endpoint was marked unverified
  // must not send it.
  const unconfirmed = unconfirmedOps(provider);
  const started = Date.now();
  let outcome = 'built';
  let note = '';
  for (const step of steps) {
    if (step.status === 'done') continue;
    if (Date.now() - started > RUN_BUDGET_MS) { outcome = 'building'; note = 'Paused between steps to stay inside one request; press Build again to continue from here.'; break; }
    const spec = specFor(p, step, byKey, adSetOf, adOf);
    step.at = new Date().toISOString();
    if (unconfirmed.length) {
      const why = `Withheld: ${label}'s ${unconfirmed.map((x) => x.op).join(', ')} ${unconfirmed.length === 1 ? 'was' : 'were'} not confirmed against ${label}'s documentation, so no step of this launch is sent. ${unconfirmed[0].note}`;
      Object.assign(step, { status: 'withheld', error: why, would_request: shownRequest(a.adapter, step.kind, spec), blocked_by: 'endpoint_unverified' });
      outcome = 'blocked'; note = why; break;
    }
    if (!(step.kind === 'video' && step.external_id && step.status === 'processing')) {
      const r = await a.adapter.createPaidObject(step.kind, spec);
      if (r.ok) {
        Object.assign(step, { status: step.kind === 'video' ? 'processing' : 'done', external_id: r.external_id, error: null, would_request: null });
      } else if (r.sent === false) {
        Object.assign(step, { status: 'withheld', error: r.error, would_request: r.would_request || null, blocked_by: r.blocked_by || (r.endpoint_unverified ? 'endpoint_unverified' : null) });
        outcome = 'blocked'; note = r.error; break;
      } else {
        Object.assign(step, { status: 'failed', error: r.error, error_class: r.error_class || null });
        outcome = 'failed'; note = `${label} refused "${step.label}": ${r.error}`; break;
      }
      // Saved after every step: the id the platform gave is what stops a re-run
      // from creating the same object twice.
      row = await save(row, { steps });
    }
    if (step.kind === 'video') {
      // Meta processes an uploaded video before a creative may use it. Read a
      // few times here; if it is still processing, the run stops and the next
      // one reads again (it never uploads twice).
      let vs = null;
      for (let i = 0; i < VIDEO_POLLS; i += 1) {
        const r = await a.adapter.readVideoStatus(step.external_id);
        if (!r.ok) { step.error = `The video status was not read: ${r.error || r.note || 'no answer'}`; vs = null; break; }
        vs = r.video_status;
        if (vs !== 'processing') break;
        if (i < VIDEO_POLLS - 1) await sleep(videoPollMs());
      }
      if (vs === 'ready') Object.assign(step, { status: 'done', error: null });
      else if (vs === 'error' || vs === 'expired') {
        Object.assign(step, { status: 'failed', failed_video_id: step.external_id, external_id: null, error: `Meta reports the uploaded video as ${vs}; the next build uploads it again.` });
        outcome = 'failed'; note = step.error; row = await save(row, { steps }); break;
      } else {
        step.status = 'processing';
        outcome = 'building'; note = `Meta is still processing the video for "${step.label}". Press Build again in a minute: it reads the same upload, it does not upload it twice.`;
        row = await save(row, { steps }); break;
      }
      row = await save(row, { steps });
    }
  }
  row = await save(row, { steps, run_token: null, status: outcome, last_note: note });
  return { ok: outcome === 'built' || outcome === 'building', launch: present(row), switches: switchesFor(a.conn, provider) };
}

/* ── live, pause, budget ──────────────────────────────────────────────────── */

async function goLive(auth, workspaceId, body) {
  await brandCore.assertCanWrite(auth, workspaceId, 'turn a paid launch on');
  let row = await loadLaunch(workspaceId, String(body.launch_id || ''));
  if (row.status !== 'built' && row.status !== 'paused') return { ok: false, error: 'not_built', message: 'Every step must be built (and paused) before the launch can go live.', launch: present(row) };
  const provider = row.provider || 'meta';
  const a = await adapterFor(auth, workspaceId, provider);
  if (!a.ok) return { ok: false, error: 'not_connected', message: a.note, launch: present(row) };
  const steps = row.steps || [];
  const group = GROUP_KIND[provider];
  // Ads first, then ad sets / ad groups, the campaigns last: nothing serves until the last is on.
  const order = [...steps.filter((s) => s.kind === 'ad'), ...steps.filter((s) => s.kind === group), ...steps.filter((s) => s.kind === 'campaign')];
  const done = [];
  for (const s of order) {
    const r = await a.adapter.updatePaidObject(s.kind, s.external_id, { status: 'ACTIVE' });
    if (!r.ok) {
      row = await save(row, { last_note: r.error || 'The platform refused.' });
      return { ok: false, error: r.sent === false ? 'withheld' : 'platform_refused', message: r.error, would_request: r.would_request || null, activated: done, launch: present(row) };
    }
    done.push(s.key);
  }
  row = await save(row, { status: 'live', approved_by: auth.user_id, approved_at: new Date().toISOString(), last_note: '' });
  return { ok: true, activated: done, launch: present(row) };
}

async function pause(auth, workspaceId, body) {
  await brandCore.assertCanWrite(auth, workspaceId, 'pause a paid launch');
  let row = await loadLaunch(workspaceId, String(body.launch_id || ''));
  const camps = (row.steps || []).filter((s) => s.kind === 'campaign' && s.status === 'done');
  if (!camps.length) return { ok: false, error: 'not_built', message: 'The campaign was never created, so there is nothing to pause.', launch: present(row) };
  const a = await adapterFor(auth, workspaceId, row.provider || 'meta');
  if (!a.ok) return { ok: false, error: 'not_connected', message: a.note, launch: present(row) };
  for (const camp of camps) {
    const r = await a.adapter.updatePaidObject('campaign', camp.external_id, { status: 'PAUSED' });
    if (!r.ok) return { ok: false, error: r.sent === false ? 'withheld' : 'platform_refused', message: r.error, would_request: r.would_request || null, launch: present(row) };
  }
  row = await save(row, { status: 'paused' });
  return { ok: true, launch: present(row) };
}

/**
 * A new total daily budget, re-split by the launch's own shares and written one
 * budget-holding object at a time. Before any call: on Meta, a cut below its
 * floor (a lower budget "must be at least 10% greater than the amount already
 * spent") is refused for the ad set whose spend the last account read saw; one
 * with no spend read is warned. No other platform's floor is documented here,
 * so none is checked.
 */
async function budget(auth, workspaceId, body) {
  await brandCore.assertCanWrite(auth, workspaceId, 'change a paid launch\'s budget');
  let row = await loadLaunch(workspaceId, String(body.launch_id || ''));
  const p = row.plan || {};
  const provider = row.provider || 'meta';
  const total = Number(body.total_daily_budget);
  const totalUnit = toUnit(provider, total, p.currency);
  if (!totalUnit) return { ok: false, error: 'budget_required', message: `State the new total daily budget in ${p.currency || 'the account currency'}.` };
  const holder = BUDGET_KIND[provider];
  const keyOf = (s) => (provider === 'google_ads' ? `${s.key}-budget` : s.key);
  const sets = (p.ad_sets || []).map((s) => Object.assign({}, s, { step: (row.steps || []).find((x) => x.key === keyOf(s) && x.kind === holder) }));
  if (sets.some((s) => !s.step || s.step.status !== 'done')) return { ok: false, error: 'not_built', message: 'Every ad set must be built before its budget can be changed.', launch: present(row) };
  const split = allocate(totalUnit, sets.map((s) => s.share_pct));
  const last = provider === 'meta' ? await latestSync(workspaceId, provider, p.ad_account_id).catch(() => null) : null;
  const spentOf = (id) => {
    const s = last && (last.ad_sets || []).find((x) => String(x.id) === String(id));
    return s && s.last_7d && Number.isFinite(Number(s.last_7d.spend)) ? Number(s.last_7d.spend) : null;
  };
  const plan2 = sets.map((s, i) => ({ key: s.key, name: s.name, id: s.step.external_id, from_minor: s.daily_budget_minor, to_minor: split[i], spent_7d: provider === 'meta' ? spentOf(s.step.external_id) : null }));
  const warnings = [];
  if (provider === 'meta') {
    for (const x of plan2) {
      if (x.to_minor < x.from_minor) {
        if (x.spent_7d == null) warnings.push(`${x.name}: no spend was read for it in the last account sync, so Meta's floor (10% above what it already spent) could not be checked here.`);
        else if (fromMinor(x.to_minor, p.currency) < x.spent_7d * 1.1) {
          return { ok: false, error: 'below_meta_floor', message: `${x.name} would drop to ${fromMinor(x.to_minor, p.currency)} ${p.currency}, but it has spent ${x.spent_7d} ${p.currency} (last 7 days as read in the sync) and Meta refuses a lower budget under 10% above what was spent.`, launch: present(row) };
        }
      }
    }
  }
  const a = await adapterFor(auth, workspaceId, provider);
  if (!a.ok) return { ok: false, error: 'not_connected', message: a.note, launch: present(row) };
  const updated = [];
  for (const x of plan2) {
    if (x.to_minor === x.from_minor) continue;
    const fields = provider === 'meta' ? { daily_budget_minor: x.to_minor } : provider === 'tiktok_ads' ? { daily_budget: x.to_minor / 1e6 } : { daily_budget_micros: x.to_minor };
    const r = await a.adapter.updatePaidObject(holder, x.id, fields);
    if (!r.ok) {
      row = await save(row, { plan: applyBudget(p, updated, total, totalUnit, false), last_note: r.error });
      return { ok: false, error: r.sent === false ? 'withheld' : 'platform_refused', message: r.error, would_request: r.would_request || null, updated, launch: present(row) };
    }
    updated.push(x);
  }
  row = await save(row, { plan: applyBudget(p, updated, total, totalUnit, true), last_note: '' });
  return { ok: true, updated, warnings, launch: present(row) };
}

/** The plan as it now stands on the platform: only budgets the platform accepted change. */
function applyBudget(p, updated, total, totalUnit, all) {
  const q = JSON.parse(JSON.stringify(p));
  for (const u of updated) {
    const s = q.ad_sets.find((x) => x.key === u.key);
    if (s) { s.daily_budget_minor = u.to_minor; s.daily_budget = fromUnit(q.provider || 'meta', u.to_minor, q.currency); }
  }
  if (all) { q.total_daily_budget = total; q.total_daily_budget_minor = totalUnit; }
  q.budget_history = (q.budget_history || []).concat([{ at: new Date().toISOString(), total, applied: updated.map((u) => ({ key: u.key, to_minor: u.to_minor })) }]);
  return q;
}

/* ── router ───────────────────────────────────────────────────────────────── */

async function handle(req, res, { auth, workspaceId, body } = {}) {
  const q = (req && req.query) || {};
  const b = body && typeof body === 'object' ? body : {};
  const op = String(q.op || b.op || 'status').toLowerCase();
  if (OPS.indexOf(op) < 0) return res.status(400).json({ ok: false, error: 'unknown_launch_operation', available: OPS });
  if (!workspaceId) {
    if (op === 'status') return res.status(200).json(Object.assign(await status(auth, null), { storage: 'device', note: 'This brand is kept on this device, and ad accounts are connected to a brand workspace on the server, so nothing can be launched from here.' }));
    return res.status(409).json({ ok: false, error: 'no_active_brand', message: 'Ad accounts belong to a brand workspace on the server; this brand is kept on this device, so there is no account to launch on.' });
  }
  try {
    switch (op) {
      case 'status': return res.status(200).json(await status(auth, workspaceId));
      case 'accounts': return res.status(200).json(await accounts(auth, workspaceId, String(q.provider || b.provider || 'meta')));
      case 'sync': return res.status(200).json(await sync(auth, workspaceId, b));
      case 'syncs': {
        const ws = await brandCore.getWorkspace(auth, workspaceId);
        if (!ws) throw err(404, 'workspace_not_found', 'That brand is not one you can see.');
        const rows = await svc(`paid_account_syncs?select=*&workspace_id=eq.${enc(workspaceId)}&order=synced_at.desc&limit=10`);
        return res.status(200).json({ ok: true, syncs: Array.isArray(rows) ? rows : [] });
      }
      case 'plan': return res.status(200).json(await plan(auth, workspaceId, b));
      case 'list': {
        const ws = await brandCore.getWorkspace(auth, workspaceId);
        if (!ws) throw err(404, 'workspace_not_found', 'That brand is not one you can see.');
        const rows = await svc(`paid_launches?select=*&workspace_id=eq.${enc(workspaceId)}&order=created_at.desc&limit=25`);
        return res.status(200).json({ ok: true, launches: (Array.isArray(rows) ? rows : []).map(present) });
      }
      case 'get': {
        const ws = await brandCore.getWorkspace(auth, workspaceId);
        if (!ws) throw err(404, 'workspace_not_found', 'That brand is not one you can see.');
        return res.status(200).json({ ok: true, launch: present(await loadLaunch(workspaceId, String(q.launch_id || b.launch_id || ''))) });
      }
      case 'run': { const out = await run(auth, workspaceId, b); return res.status(out.ok ? 200 : 409).json(out); }
      case 'go-live': { const out = await goLive(auth, workspaceId, b); return res.status(out.ok ? 200 : 409).json(out); }
      case 'pause': { const out = await pause(auth, workspaceId, b); return res.status(out.ok ? 200 : 409).json(out); }
      case 'budget': { const out = await budget(auth, workspaceId, b); return res.status(out.ok ? 200 : 409).json(out); }
      default: return res.status(400).json({ ok: false, error: 'unknown_launch_operation', available: OPS });
    }
  } catch (e) {
    return res.status(e && e.status ? e.status : 500).json({ ok: false, error: (e && e.code) || 'launch_operation_failed', message: (e && e.message) || 'The launch operation failed.' });
  }
}

module.exports = {
  handle, status, accounts, sync, plan, run, goLive, pause, budget,
  sharesFor, allocate, toMinor, fromMinor, toMicros, offsetOf, countryOf, stepsFor, unconfirmedOps, platformRows,
  OPS, OBJECTIVES, PLATFORMS, EU, OFFSET_1, OFFSET_100,
};
