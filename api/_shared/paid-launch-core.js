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

/** The platforms the hub lists, and why the ones not built are not. */
const PLATFORMS = [
  { id: 'meta', built: true, label: 'Meta (Facebook + Instagram ads)' },
  { id: 'google_ads', built: false, label: 'Google Ads', reason: 'Google Ads campaign, budget and ad group create calls were not confirmed against Google\'s documentation for this platform; the existing Google Ads adapter creates a responsive search ad in an ad group you already have.' },
  { id: 'tiktok_ads', built: false, label: 'TikTok Ads', reason: 'TikTok Ads endpoints are unverified in this platform (only the SDK was readable), so they refuse to send.' },
  { id: 'pinterest', built: false, label: 'Pinterest ads', reason: 'Pinterest\'s ad create call could not be confirmed to create a paused ad, so it refuses to send.' },
];

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

/** A market code as Meta's targeting takes it (ISO 3166-1 alpha-2), or ''. */
function countryOf(code) {
  const c = String(code || '').trim().toUpperCase();
  if (c === 'UK') return 'GB';
  return /^[A-Z]{2}$/.test(c) ? c : '';
}

const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

/* ── the platform behind one brand ────────────────────────────────────────── */

async function adapterFor(auth, workspaceId, provider) {
  if (provider !== 'meta') throw err(400, 'platform_not_built', (PLATFORMS.find((p) => p.id === provider) || { reason: `"${provider}" is not a platform the launch pipeline builds.` }).reason || `"${provider}" is not built.`);
  const c = await require('./social-gateway-core.js').credentialsFor(workspaceId, provider);
  if (!c.ok) return { ok: false, connected: !!c.connected, note: c.note, reconnect_required: !!c.reconnect_required };
  const A = registry.adapterFor(provider);
  const conn = c.conn || {};
  const publishEnabled = !!(conn.config && (conn.config.publishing_enabled === true || conn.config.publishing_enabled === 'true'));
  return { ok: true, adapter: new A({ workspaceId, credentials: c.credentials, connection: conn, publishEnabled }), conn };
}

/** Which switch stands between this brand and a live write, in words. */
function switchesFor(conn) {
  const publishing = !!(conn && conn.config && (conn.config.publishing_enabled === true || conn.config.publishing_enabled === 'true'));
  const out = {
    live_connectors: liveConnectorsEnabled(),
    workspace_publishing: publishing,
    platform_writes: process.env.META_ALLOW_WRITES === '1',
  };
  const off = [];
  if (!out.live_connectors) off.push('LIVE_CONNECTORS is off on this deployment (the default), so nothing is read from or written to Meta.');
  if (!out.workspace_publishing) off.push('Live publishing is off for Meta on this brand (a switch on the connection), so each step builds its request and stops.');
  if (!out.platform_writes) off.push('META_ALLOW_WRITES is not set to 1 on the deployment, so each step builds its request and stops.');
  return Object.assign(out, { all_on: off.length === 0, off });
}

/* ── status, accounts, sync ───────────────────────────────────────────────── */

async function status(auth, workspaceId) {
  let conn = null;
  let note = '';
  try {
    const c = await require('./social-gateway-core.js').credentialsFor(workspaceId, 'meta');
    conn = c.conn || null;
    if (!c.ok) note = c.note || '';
  } catch (e) { note = e.message; }
  return {
    ok: true,
    platforms: PLATFORMS.map((p) => Object.assign({}, p, p.id === 'meta' ? { connected: !!conn, note, switches: switchesFor(conn) } : {})),
    objectives: Object.keys(OBJECTIVES).map((k) => ({ id: k, label: OBJECTIVES[k].label })),
    rule: 'Every object is created PAUSED. Going live is a separate approval, recorded with who gave it.',
  };
}

async function accounts(auth, workspaceId, provider) {
  const ws = await brandCore.getWorkspace(auth, workspaceId);
  if (!ws) throw err(404, 'workspace_not_found', 'That brand is not one you can see.');
  const a = await adapterFor(auth, workspaceId, provider);
  if (!a.ok) return Object.assign({ ok: false, provider }, a);
  if (!liveConnectorsEnabled()) return { ok: false, provider, connected: true, live: false, note: 'LIVE_CONNECTORS is off on this deployment, which is the default, so the ad accounts were not read.' };
  const r = await a.adapter.listAdAccounts();
  const configured = String((a.conn.config && a.conn.config.ad_account_id) || '');
  return Object.assign({ provider, connected: true, configured_ad_account: configured || null }, r);
}

async function sync(auth, workspaceId, body) {
  const provider = String(body.provider || 'meta');
  const ws = await brandCore.getWorkspace(auth, workspaceId);
  if (!ws) throw err(404, 'workspace_not_found', 'That brand is not one you can see.');
  const a = await adapterFor(auth, workspaceId, provider);
  if (!a.ok) return Object.assign({ ok: false, provider }, a);
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

/** The ads a launch is built from, read from the brand's OWN records. */
async function sourceAds(workspaceId, body, brandName) {
  const s = body.source || {};
  if (s.kind === 'campaign') {
    const id = String(s.campaign_id || '');
    if (!id) throw err(400, 'campaign_required', 'Name the Smart Brain campaign the launch is built from (source.campaign_id).');
    const rows = await svc(`smart_generated_campaigns?select=id,payload&id=eq.${enc(id)}&workspace_id=eq.${enc(workspaceId)}&limit=1`);
    const p = Array.isArray(rows) && rows[0] ? rows[0].payload : null;
    if (!p) throw err(404, 'campaign_not_found', 'That campaign is not one of this brand\'s.');
    const ads = ((p.assets && p.assets.ads) || []).filter((a) => a && a.platform === 'meta');
    const lp = (p.assets && p.assets.landing_pages && p.assets.landing_pages[0]) || null;
    const link = String(body.link || p.landing_url || (lp && (lp.url || lp.public_url)) || '');
    const statics = ads.filter((a) => a.creative_type !== 'video');
    const skipped = ads.length - statics.length;
    return {
      label: `Smart Brain campaign ${id}`,
      groups: [{
        key: 'all', name: p.campaign_name || (p.campaign && p.campaign.name) || `${brandName} campaign`, control: false,
        ads: statics.map((a, i) => ({
          name: clip(a.headline || `${brandName} ad ${i + 1}`, 80), primary_text: a.primary_text || '', headline: a.headline || '',
          description: a.description || '', image_url: String((a.creative && a.creative.image) || a.image_url || ''), link,
        })),
      }],
      per_market: true,
      notes: skipped ? [`${skipped} Meta video ad(s) were left out: uploading a video to Meta is not built here, so only image ads are launched.`] : [],
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
        ads: [{
          name: clip(b.headline || b.angle_name || `Brief ${i + 1}`, 80), primary_text: b.primary_text || b.hook || '', headline: b.headline || '',
          description: b.description || '', image_url: String(b.image_url || body.image_url || ''), link: String(b.link || body.link || ''),
        }],
      })),
      per_market: false,
      notes: [],
    };
  }
  throw err(400, 'source_required', 'Say what the launch is built from: source.kind "campaign" (a Smart Brain campaign) or "briefs" (Winning angles).');
}

/** The checks a launch must pass before a step may be built. */
function checkAd(ad, ws, market) {
  const blocking = [];
  const warnings = [];
  const name = ws.name;
  if (!ad.primary_text) blocking.push(marker('primary text', name, market));
  for (const [k, v] of [['primary text', ad.primary_text], ['headline', ad.headline], ['description', ad.description]]) {
    if (/\[DATA REQUIRED/i.test(String(v || ''))) blocking.push(`The ${k} still carries a gap: ${clip(v, 160)}`);
  }
  if (!/^https:\/\//i.test(ad.image_url)) blocking.push(marker('product image (a public https URL Meta can fetch)', name, market));
  if (!/^https:\/\//i.test(ad.link)) blocking.push(marker('landing page URL (https)', name, market));
  try {
    const contract = require('./asset-contracts.js').check({ platform: 'meta', creative_type: 'static', primary_text: ad.primary_text, headline: ad.headline, description: ad.description, creative: { image: ad.image_url } });
    for (const v of contract.violations || []) (v.level === 'block' ? blocking : warnings).push(`${v.slot ? v.slot + ': ' : ''}${v.message}`);
  } catch (_) { warnings.push('The ad contract could not be read, so the copy limits were not checked.'); }
  try {
    const lint = require('./compliance-lint.js').lint({ primary_text: ad.primary_text, headline: ad.headline, description: ad.description }, { brand: ws, market });
    for (const f of lint.findings || []) (f.severity === 'BLOCK' ? blocking : warnings).push(`Compliance: ${f.title}${f.fix ? ' - ' + f.fix : ''}`);
  } catch (_) { warnings.push('The compliance gate could not run on this ad, so it was not checked.'); }
  return { blocking, warnings };
}

async function plan(auth, workspaceId, body) {
  const ws = await brandCore.assertCanWrite(auth, workspaceId, 'plan a paid launch');
  const provider = String(body.provider || 'meta');
  const a = await adapterFor(auth, workspaceId, provider);
  const conn = a.conn || {};
  const cfg = conn.config || {};
  const blocking = [];
  const warnings = [];
  const notes = [];
  if (!a.ok) blocking.push(a.note || 'Meta is not connected on this brand.');

  const act = String(body.ad_account_id || cfg.ad_account_id || '');
  if (!act) blocking.push(marker('ad account id', ws.name));
  const actId = act ? (String(act).startsWith('act_') ? act : `act_${act}`) : '';
  const pageId = String(body.page_id || cfg.page_id || '');
  if (!pageId) blocking.push(`${marker('Facebook Page id', ws.name)} Meta creates each ad's post on the brand's Page.`);

  // Currency: what the platform said in the last sync, else what the operator
  // stated (and labelled so).
  let currency = '';
  let currencyBasis = '';
  if (actId) {
    const last = await latestSync(workspaceId, provider, actId).catch(() => null);
    if (last && last.currency) { currency = String(last.currency).toUpperCase(); currencyBasis = `read from Meta in the account sync of ${last.synced_at}`; }
  }
  if (!currency && body.currency) { currency = String(body.currency).toUpperCase(); currencyBasis = 'as stated by the operator; not yet read from Meta (run the account sync)'; }
  if (!currency) blocking.push(marker('ad account currency (run the account sync)', ws.name));
  else if (!offsetOf(currency)) blocking.push(`${currency} is not in Meta's currency table, so its smallest unit is not known here. ${marker('ad account currency offset', ws.name)}`);

  const objective = String(body.objective || 'OUTCOME_TRAFFIC').toUpperCase();
  const obj = OBJECTIVES[objective];
  if (!obj) blocking.push(`${objective} needs a pixel or app (promoted object) that this platform does not hold; the pipeline builds ${Object.keys(OBJECTIVES).join(', ')}.`);

  const total = Number(body.total_daily_budget);
  const totalMinor = currency ? toMinor(total, currency) : null;
  if (!(total > 0)) blocking.push(marker('total daily budget', ws.name));

  const markets = (Array.isArray(body.markets) ? body.markets : String(body.markets || '').split(',')).map((m) => String(m).trim()).filter(Boolean);
  const countries = markets.map(countryOf).filter(Boolean);
  if (!countries.length) blocking.push(marker('target country (a market the brand serves)', ws.name));
  const eu = countries.filter((c) => EU.includes(c));
  const dsaPayor = clip(body.dsa_payor, 200);
  const dsaBeneficiary = clip(body.dsa_beneficiary, 200);
  if (eu.length && (!dsaPayor || !dsaBeneficiary)) blocking.push(`Ad sets reaching ${eu.join(', ')} need who pays for and who benefits from the ads (Meta's DSA fields). ${marker('DSA payor and beneficiary', ws.name, eu.join('/'))}`);

  const src = await sourceAds(workspaceId, body, ws.name);
  notes.push(...src.notes);

  // Ad sets: per market for a single campaign's ads (each market its own budget
  // line), per brief for Winning angles (each angle its own test cell).
  const groups = src.per_market && countries.length > 1
    ? countries.map((c) => Object.assign({}, src.groups[0], { key: c.toLowerCase(), name: `${src.groups[0].name} - ${c}`, countries: [c] }))
    : src.groups.map((g) => Object.assign({}, g, { countries }));
  if (!groups.length || groups.every((g) => !g.ads.length)) blocking.push(`${src.label} has no Meta image ad to launch.`);

  const shares = sharesFor(groups);
  const split = totalMinor ? allocate(totalMinor, shares) : groups.map(() => null);
  const baseName = clip(body.name || `${ws.name} - ${src.label}`, 120);

  const adSets = groups.map((g, i) => {
    const market = g.countries.join('/');
    const ads = g.ads.map((ad, j) => {
      const c = checkAd(ad, ws, market);
      blocking.push(...c.blocking.map((x) => `${g.name}, ad ${j + 1}: ${x}`));
      warnings.push(...c.warnings.map((x) => `${g.name}, ad ${j + 1}: ${x}`));
      return Object.assign({ key: `${g.key}-ad-${j + 1}` }, ad, { primary_text: ad.primary_text, cta_type: 'LEARN_MORE' });
    });
    return {
      key: `adset-${g.key}`, name: clip(`${baseName} - ${g.name}`, 200), share_pct: Math.round(shares[i] * 100) / 100,
      control: !!g.control, countries: g.countries,
      daily_budget_minor: split[i], daily_budget: split[i] != null ? fromMinor(split[i], currency) : null,
      targeting: { geo_locations: { countries: g.countries } },
      optimization_goal: obj ? obj.optimization_goal : null, billing_event: obj ? obj.billing_event : null,
      dsa_payor: g.countries.some((c) => EU.includes(c)) ? dsaPayor : '', dsa_beneficiary: g.countries.some((c) => EU.includes(c)) ? dsaBeneficiary : '',
      ads,
    };
  });
  for (const s of adSets) if (s.daily_budget_minor === 0) blocking.push(`${s.name} would get no budget: the total is too small to split across ${adSets.length} ad sets.`);
  if ((body.special_ad_categories || []).length === 0) notes.push('No special ad category was declared. If these ads are about credit, employment, housing, or social issues, elections or politics, Meta requires it to be declared before they run.');

  const thePlan = {
    provider, ad_account_id: actId, page_id: pageId, currency: currency || null, currency_basis: currencyBasis,
    objective, total_daily_budget: total > 0 ? total : null, total_daily_budget_minor: totalMinor,
    split_rule: groups.some((g) => g.control) || groups.some((g) => Number(g.share) > 0)
      ? 'The test plan\'s rule: a control keeps 20%, every other ad set its share of the competitor signal with a 10% floor.'
      : 'Equal across the ad sets: no ad set was given a share or a signal.',
    source: { kind: (body.source || {}).kind, label: src.label, campaign_id: (body.source || {}).campaign_id || null },
    campaign: { key: 'campaign', name: baseName, objective, special_ad_categories: Array.isArray(body.special_ad_categories) ? body.special_ad_categories.map((x) => String(x).toUpperCase()).slice(0, 6) : [] },
    ad_sets: adSets,
    checks: { blocking: [...new Set(blocking)], warnings: [...new Set(warnings)], notes },
  };
  const steps = stepsFor(thePlan);
  const row = await svc('paid_launches', {
    method: 'POST', prefer: 'return=representation',
    body: [{ workspace_id: workspaceId, provider, ad_account_id: actId || '-', name: baseName, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), status: thePlan.checks.blocking.length ? 'blocked' : 'planned', plan: thePlan, steps, created_by: auth.user_id, last_note: thePlan.checks.blocking[0] || '' }],
  });
  const launch = Array.isArray(row) ? row[0] : row;
  return { ok: true, launch: present(launch), switches: switchesFor(conn) };
}

/** The ordered steps: campaign, then per ad set the ad set, its creatives and ads. */
function stepsFor(p) {
  const out = [{ key: 'campaign', kind: 'campaign', status: 'pending', label: `Campaign "${p.campaign.name}" (paused)` }];
  for (const s of p.ad_sets) {
    out.push({ key: s.key, kind: 'adset', parent: 'campaign', status: 'pending', label: `Ad set "${s.name}": ${s.daily_budget != null ? `${s.daily_budget} ${p.currency}` : 'budget not set'} a day (${s.share_pct}%) in ${s.countries.join(', ')}` });
    for (const ad of s.ads) {
      out.push({ key: `${ad.key}-creative`, kind: 'creative', parent: s.key, ad: ad.key, status: 'pending', label: `Creative "${ad.name}"` });
      out.push({ key: ad.key, kind: 'ad', parent: s.key, creative: `${ad.key}-creative`, status: 'pending', label: `Ad "${ad.name}" (paused)` });
    }
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

/**
 * Run the pending steps in order. One runner per launch: the lease is CLAIMED
 * by a conditional PATCH, so a second press (or a second tab) runs nothing.
 * A step that the platform refused stops the run there; a step a switch
 * withheld is marked `withheld` with the exact request, and the run stops.
 * A re-run starts at the first step that is not done.
 */
async function run(auth, workspaceId, body) {
  await brandCore.assertCanWrite(auth, workspaceId, 'build a paid launch on the platform');
  let row = await loadLaunch(workspaceId, String(body.launch_id || ''));
  const p = row.plan || {};
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

  const a = await adapterFor(auth, workspaceId, row.provider);
  if (!a.ok) {
    row = await save(row, { run_token: null, status: 'blocked', last_note: a.note || 'Meta is not connected.' });
    return { ok: false, error: 'not_connected', message: a.note || 'Meta is not connected on this brand.', launch: present(row) };
  }
  const steps = (row.steps || []).map((s) => Object.assign({}, s));
  const byKey = {};
  for (const s of steps) byKey[s.key] = s;
  const adSetOf = {};
  for (const s of p.ad_sets || []) adSetOf[s.key] = s;
  const adOf = {};
  for (const s of p.ad_sets || []) for (const ad of s.ads || []) adOf[ad.key] = Object.assign({ adset: s.key }, ad);

  const started = Date.now();
  let outcome = 'built';
  let note = '';
  for (const step of steps) {
    if (step.status === 'done') continue;
    if (Date.now() - started > RUN_BUDGET_MS) { outcome = 'building'; note = 'Paused between steps to stay inside one request; press Build again to continue from here.'; break; }
    let spec;
    if (step.kind === 'campaign') spec = Object.assign({ ad_account_id: p.ad_account_id }, p.campaign);
    else if (step.kind === 'adset') {
      const s = adSetOf[step.key];
      spec = { ad_account_id: p.ad_account_id, name: s.name, campaign_id: byKey.campaign.external_id, daily_budget_minor: s.daily_budget_minor,
        billing_event: s.billing_event, optimization_goal: s.optimization_goal, targeting: s.targeting,
        dsa_payor: s.dsa_payor || '', dsa_beneficiary: s.dsa_beneficiary || '' };
    } else if (step.kind === 'creative') {
      const ad = adOf[step.ad];
      spec = { ad_account_id: p.ad_account_id, page_id: p.page_id, name: ad.name, primary_text: ad.primary_text, headline: ad.headline, description: ad.description, image_url: ad.image_url, link: ad.link, cta_type: ad.cta_type };
    } else {
      const ad = adOf[step.key];
      spec = { ad_account_id: p.ad_account_id, name: ad.name, adset_id: byKey[step.parent].external_id, creative_id: byKey[step.creative].external_id };
    }
    const r = await a.adapter.createPaidObject(step.kind, spec);
    step.at = new Date().toISOString();
    if (r.ok) {
      Object.assign(step, { status: 'done', external_id: r.external_id, error: null, would_request: null });
    } else if (r.sent === false) {
      Object.assign(step, { status: 'withheld', error: r.error, would_request: r.would_request || null, blocked_by: r.blocked_by || (r.endpoint_unverified ? 'endpoint_unverified' : null) });
      outcome = 'blocked'; note = r.error; break;
    } else {
      Object.assign(step, { status: 'failed', error: r.error, error_class: r.error_class || null });
      outcome = 'failed'; note = `Meta refused "${step.label}": ${r.error}`; break;
    }
    // Saved after every step: the id the platform gave is what stops a re-run
    // from creating the same object twice.
    row = await save(row, { steps });
  }
  row = await save(row, { steps, run_token: null, status: outcome, last_note: note });
  return { ok: outcome === 'built' || outcome === 'building', launch: present(row), switches: switchesFor(a.conn) };
}

/* ── live, pause, budget ──────────────────────────────────────────────────── */

async function goLive(auth, workspaceId, body) {
  await brandCore.assertCanWrite(auth, workspaceId, 'turn a paid launch on');
  let row = await loadLaunch(workspaceId, String(body.launch_id || ''));
  if (row.status !== 'built' && row.status !== 'paused') return { ok: false, error: 'not_built', message: 'Every step must be built (and paused) before the launch can go live.', launch: present(row) };
  const a = await adapterFor(auth, workspaceId, row.provider);
  if (!a.ok) return { ok: false, error: 'not_connected', message: a.note, launch: present(row) };
  const steps = row.steps || [];
  // Ads first, then ad sets, the campaign last: nothing serves until the last is on.
  const order = [...steps.filter((s) => s.kind === 'ad'), ...steps.filter((s) => s.kind === 'adset'), ...steps.filter((s) => s.kind === 'campaign')];
  const done = [];
  for (const s of order) {
    const r = await a.adapter.updatePaidObject(s.kind, s.external_id, { status: 'ACTIVE' });
    if (!r.ok) {
      row = await save(row, { last_note: r.error || 'Meta refused.' });
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
  const camp = (row.steps || []).find((s) => s.kind === 'campaign' && s.status === 'done');
  if (!camp) return { ok: false, error: 'not_built', message: 'The campaign was never created, so there is nothing to pause.', launch: present(row) };
  const a = await adapterFor(auth, workspaceId, row.provider);
  if (!a.ok) return { ok: false, error: 'not_connected', message: a.note, launch: present(row) };
  const r = await a.adapter.updatePaidObject('campaign', camp.external_id, { status: 'PAUSED' });
  if (!r.ok) return { ok: false, error: r.sent === false ? 'withheld' : 'platform_refused', message: r.error, would_request: r.would_request || null, launch: present(row) };
  row = await save(row, { status: 'paused' });
  return { ok: true, launch: present(row) };
}

/**
 * A new total daily budget, re-split by the launch's own shares and written one
 * ad set at a time. Before any call: a cut below Meta's floor (a lower budget
 * "must be at least 10% greater than the amount already spent") is refused for
 * the ad set whose spend the last sync read; one with no spend read is warned.
 */
async function budget(auth, workspaceId, body) {
  await brandCore.assertCanWrite(auth, workspaceId, 'change a paid launch\'s budget');
  let row = await loadLaunch(workspaceId, String(body.launch_id || ''));
  const p = row.plan || {};
  const total = Number(body.total_daily_budget);
  const totalMinor = toMinor(total, p.currency);
  if (!totalMinor) return { ok: false, error: 'budget_required', message: `State the new total daily budget in ${p.currency || 'the account currency'}.` };
  const sets = (p.ad_sets || []).map((s) => Object.assign({}, s, { step: (row.steps || []).find((x) => x.key === s.key) }));
  if (sets.some((s) => !s.step || s.step.status !== 'done')) return { ok: false, error: 'not_built', message: 'Every ad set must be built before its budget can be changed.', launch: present(row) };
  const split = allocate(totalMinor, sets.map((s) => s.share_pct));
  const last = await latestSync(workspaceId, row.provider, p.ad_account_id).catch(() => null);
  const spentOf = (id) => {
    const s = last && (last.ad_sets || []).find((x) => String(x.id) === String(id));
    return s && s.last_7d && Number.isFinite(Number(s.last_7d.spend)) ? Number(s.last_7d.spend) : null;
  };
  const plan2 = sets.map((s, i) => ({ key: s.key, name: s.name, id: s.step.external_id, from_minor: s.daily_budget_minor, to_minor: split[i], spent_7d: spentOf(s.step.external_id) }));
  const warnings = [];
  for (const x of plan2) {
    if (x.to_minor < x.from_minor) {
      if (x.spent_7d == null) warnings.push(`${x.name}: no spend was read for it in the last account sync, so Meta's floor (10% above what it already spent) could not be checked here.`);
      else if (fromMinor(x.to_minor, p.currency) < x.spent_7d * 1.1) {
        return { ok: false, error: 'below_meta_floor', message: `${x.name} would drop to ${fromMinor(x.to_minor, p.currency)} ${p.currency}, but it has spent ${x.spent_7d} ${p.currency} (last 7 days as read in the sync) and Meta refuses a lower budget under 10% above what was spent.`, launch: present(row) };
      }
    }
  }
  const a = await adapterFor(auth, workspaceId, row.provider);
  if (!a.ok) return { ok: false, error: 'not_connected', message: a.note, launch: present(row) };
  const updated = [];
  for (const x of plan2) {
    if (x.to_minor === x.from_minor) continue;
    const r = await a.adapter.updatePaidObject('adset', x.id, { daily_budget_minor: x.to_minor });
    if (!r.ok) {
      row = await save(row, { plan: applyBudget(p, updated, total, totalMinor, false), last_note: r.error });
      return { ok: false, error: r.sent === false ? 'withheld' : 'platform_refused', message: r.error, would_request: r.would_request || null, updated, launch: present(row) };
    }
    updated.push(x);
  }
  row = await save(row, { plan: applyBudget(p, updated, total, totalMinor, true), last_note: '' });
  return { ok: true, updated, warnings, launch: present(row) };
}

/** The plan as it now stands on the platform: only ad sets Meta accepted change. */
function applyBudget(p, updated, total, totalMinor, all) {
  const q = JSON.parse(JSON.stringify(p));
  for (const u of updated) {
    const s = q.ad_sets.find((x) => x.key === u.key);
    if (s) { s.daily_budget_minor = u.to_minor; s.daily_budget = fromMinor(u.to_minor, q.currency); }
  }
  if (all) { q.total_daily_budget = total; q.total_daily_budget_minor = totalMinor; }
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
  sharesFor, allocate, toMinor, fromMinor, offsetOf, countryOf, stepsFor,
  OPS, OBJECTIVES, PLATFORMS, EU, OFFSET_1, OFFSET_100,
};
