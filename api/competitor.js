'use strict';

/**
 * /api/competitor — single catch-all endpoint for Competitor Benchmarking.
 *
 * One Serverless Function (Hobby plan caps at 12; the app sits at the limit),
 * dispatched by ?action=:
 *   ?action=list            → all captured mails (newest first)        [GET, public]
 *   ?action=html&id=<row>   → raw HTML for one mail                    [GET, public]
 *   ?action=poll            → throttled sync trigger for the dashboard [GET, public]
 *   ?action=sync            → force a full sync                        [GET/POST, CRON_SECRET]
 *   ?action=brands          → the ACTIVE brand's competitor universe   [GET]
 *   ?action=seed            → seed it from that brand's own record     [POST]
 *   ?action=discover        → seed + a discovery pass for that brand   [POST]
 *   ?action=universe-refresh→ the scheduled sweep across brands        [CRON_SECRET]
 *   ?action=universe-export → optional mirror into the Google Sheet    [POST]
 *
 * Ingestion lives in api/_shared/competitor-core.js (Gmail + Google Sheet, both
 * optional); the competitor universe lives in api/_shared/competitor-universe.js
 * (Supabase, per workspace, no Google credentials required).
 */

const core = require('./_shared/competitor-core');
// The per-brand competitor universe. Supabase-backed, so it works with no
// Google credentials at all; competitor-core's sheet path is now an optional
// export rather than the store.
const universe = require('./_shared/competitor-universe');
// Competitive-Intelligence collection layer (Supabase-backed; real-time stream).
const ciCollect = require('./_shared/ci-collect');
const ciOffers  = require('./_shared/ci-offers');
const ciFunnel  = require('./_shared/ci-funnel');
let ciEnrich; // lazy — pulls in llm.js only when an enrich action runs
function getEnrich() { return (ciEnrich = ciEnrich || require('./_shared/ci-enrich')); }
const supa = require('./_shared/supa');

async function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if (!body && req.method === 'POST') {
    body = await new Promise((resolve) => {
      let raw = ''; req.on('data', (c) => (raw += c));
      req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }
  return body || {};
}

// Warm-instance throttle so concurrent dashboards / hot-reloads don't hammer IMAP.
const POLL_THROTTLE_MS = 30000;
let lastPoll = 0;
let lastResult = null;

function bearerOf(req) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : '';
}

/**
 * The competitor-universe store for THIS request, and the one workspace it is
 * allowed to touch.
 *
 * A signed-in browser request reads and writes AS THE CALLER, so the RLS
 * policies decide what it may see. A cron or worker call carries CRON_SECRET
 * instead of a session and therefore has to NAME its workspace: on a
 * multi-tenant platform there is no "the" workspace, and quietly defaulting to
 * the oldest one is precisely how tenant zero's rows ended up on other brands'
 * screens.
 */
function universeContext(req, url) {
  const wsId = req.__workspaceId || url.searchParams.get('workspace_id') || '';
  if (!wsId) return { error: 'workspace_unresolved', note: 'No active brand on this request, so no competitor data is read or written. Another brand\'s universe is never substituted.' };
  const token = bearerOf(req);
  const secret = (process.env.CRON_SECRET || '').trim();
  // A CRON_SECRET arriving in the Authorization header is not a user session;
  // handing it to PostgREST as a JWT would just 401.
  if (token && token !== secret) return { store: universe.userStore(token), workspaceId: wsId };
  if (authorized(req)) {
    try { return { store: universe.serviceStore(), workspaceId: wsId }; }
    catch (err) { return { error: 'supabase_not_configured', note: err.message }; }
  }
  return { error: 'sign_in_required', note: 'Sign in, or call with CRON_SECRET and an explicit workspace_id.' };
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  // No secret: open in dev/preview, FAIL CLOSED in production (sync drives IMAP
  // + Google Sheet writes; never leave it open to anyone).
  if (!secret) return String(process.env.VERCEL_ENV) !== 'production';
  const auth = req.headers && req.headers.authorization;
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url, 'http://x');
  return url.searchParams.get('secret') === secret;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || 'list';

  // ── Workspace scoping ─────────────────────────────────────────────────────
  // The competitor set is the ACTIVE brand's own universe. This router reads a
  // shared Google Sheet and the workspace-scoped competitor_* tables, so an
  // unattributed browser request must not be answered with the default
  // workspace's competitors.
  try {
    const wsScope = require('./_shared/workspace-scope.js');
    const scopeEnv = {
      url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
    };
    const wsId = await wsScope.resolve(scopeEnv, req);
    const hadExplicit = !!url.searchParams.get('workspace_id');
    const hadAuth = !!(req.headers && (req.headers.authorization || req.headers.Authorization));
    const fromBrowser = !!(req.headers && (req.headers.origin || req.headers.referer));
    if (!hadExplicit && !hadAuth && fromBrowser) {
      return res.status(200).json({
        ok: true, error: 'workspace_unresolved', emails: [], brands: [], total: 0,
        note: 'No active workspace on this request, so no competitor data is returned. Another brand\'s competitor set is never substituted. Hard-refresh and try again.',
      });
    }
    req.__workspaceId = wsId;
  } catch (_) { /* never hard-fail the router on scoping */ }

  try {
    // The captured-mail archive still lives in the Google Sheet. Say so plainly
    // when Google is not configured, rather than throwing a credentials error
    // into a marketing dashboard.
    if (action === 'list') {
      if (!core.sheetsConfigured()) {
        res.status(200).json({ ok: true, emails: [], capture_configured: false,
          note: 'No mail-capture inbox is configured for this deployment, so no competitor mailers have been archived. The competitor universe itself does not depend on it.' });
        return;
      }
      const emails = await core.getAllEmails();
      res.status(200).json({ ok: true, emails });
      return;
    }

    if (action === 'html') {
      const id = Number(url.searchParams.get('id'));
      if (!Number.isInteger(id) || id < 2) { res.status(400).json({ ok: false, html: '' }); return; }
      const html = await core.getEmailHtml(id);
      res.status(200).json({ ok: true, html });
      return;
    }

    // Serve one mail as a standalone HTML page (for the free screenshot API to render).
    if (action === 'raw') {
      const page = await core.getRawHtml({ key: url.searchParams.get('key'), id: url.searchParams.get('id') });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(page ? 200 : 404).send(page || '<!doctype html><title>Not found</title><p>Email not found.</p>');
      return;
    }

    if (action === 'poll') {
      const now = Date.now();
      const since = now - lastPoll;
      if (since < POLL_THROTTLE_MS) {
        res.status(200).json({ ok: true, throttled: true, nextSyncInMs: POLL_THROTTLE_MS - since, last: lastResult });
        return;
      }
      lastPoll = now;
      lastResult = await core.runSync(25);
      res.status(200).json({ ok: true, throttled: false, ...lastResult });
      return;
    }

    if (action === 'sync') {
      if (!authorized(req)) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const result = await core.runSync(25);
      lastResult = result;
      res.status(200).json(result);
      return;
    }

    // One-shot: re-sort the entire Emails sheet by Received At (col C) DESC.
    // Sync already does this after each append; this is for backfilling the
    // existing rows that were appended before the sort step shipped.
    if (action === 'sort') {
      await core.sortEmailsByReceivedDesc();
      res.status(200).json({ ok: true, sorted: 'received_at desc' });
      return;
    }

    // ── The competitor universe (per brand, Supabase-backed) ────────────────
    // Reads and writes go to public.brand_competitors, which needs no Google
    // credentials and is scoped to the active workspace. ?action=brands keeps
    // the field names the dashboard already renders.
    if (action === 'brands') {
      const ctx = universeContext(req, url);
      if (ctx.error) { res.status(200).json({ ok: true, brands: [], total: 0, error: ctx.error, note: ctx.note }); return; }
      const out = await universe.listUniverse(ctx.store, ctx.workspaceId);
      res.status(200).json({ ok: true, ...out });
      return;
    }

    // Seed from the brand's OWN record. No LLM, no network: activation must not
    // hang on a provider, and a brand's own market study is the only source
    // that can be trusted to describe its market.
    if (action === 'seed') {
      const ctx = universeContext(req, url);
      if (ctx.error) { res.status(401).json({ ok: false, error: ctx.error, note: ctx.note }); return; }
      const out = await universe.seedForWorkspace(ctx.store, ctx.workspaceId);
      res.status(200).json(Object.assign({ ok: out.ok !== false }, out));
      return;
    }

    // ── FREE capture webhook — no Gmail botting ──
    // Cloudflare Email Routing forwards competitor newsletters to an n8n (or any)
    // workflow, which POSTs the parsed mail here. Body: {from, fromName, subject,
    // html, text, receivedAt}. Optional shared secret via INGEST_TOKEN.
    if (action === 'ingest') {
      if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST required' }); return; }
      const secret = (process.env.INGEST_TOKEN || '').trim();
      if (secret) {
        const got = (req.headers['x-ingest-token'] || url.searchParams.get('token') || '').trim();
        if (got !== secret) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
      const result = await core.ingestEmail(body || {});
      res.status(result.ok ? 200 : 400).json(result);
      return;
    }

    // ── Auto-subscribe write-back ──
    // The local Playwright worker (workers/auto-subscribe.js) subscribes the
    // capture inbox to a brand's newsletter, then POSTs the outcome here so the
    // Brands sheet reflects status without the worker holding any Google key.
    // Body: {domain|websiteUrl, status, dateSubscribed, confirmationRequired,
    // confirmationCompleted}. Optional shared secret via INGEST_TOKEN.
    if (action === 'mark-subscribed' || action === 'subscribe-status') {
      if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST required' }); return; }
      const secret = (process.env.INGEST_TOKEN || '').trim();
      if (secret) {
        const got = (req.headers['x-ingest-token'] || url.searchParams.get('token') || '').trim();
        if (got !== secret) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      }
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
      const ctx = universeContext(req, url);
      if (ctx.error) { res.status(400).json({ ok: false, error: ctx.error, note: ctx.note }); return; }
      const result = await universe.markSubscribed(ctx.store, ctx.workspaceId, body || {});
      // Keep the sheet in step when it exists; its absence is not a failure.
      if (result.ok && core.sheetsConfigured()) {
        try { await core.markBrandSubscribed(body || {}); } catch (_) { /* the universe is the record */ }
      }
      res.status(result.ok ? 200 : 400).json(result);
      return;
    }

    // ── Free public ad discovery (Meta Ad Library via Apify free / deep-link) ──
    if (action === 'adlibrary' || action === 'ads') {
      const result = await core.fetchMetaAds({
        brand: url.searchParams.get('brand') || '',
        country: url.searchParams.get('country') || 'ALL',
        limit: url.searchParams.get('limit'),
      });
      res.status(result.ok ? 200 : 400).json(result);
      return;
    }

    // Discovery for the ACTIVE brand: seeded from its own record first, then a
    // provider-agnostic LLM pass scoped to that brand's declared industry,
    // offerings and regions. Whatever cannot be verified as a real company is
    // dropped and reported as a gap rather than stored.
    if (action === 'discover') {
      const ctx = universeContext(req, url);
      if (ctx.error) { res.status(401).json({ ok: false, error: ctx.error, note: ctx.note }); return; }
      const out = await universe.refreshWorkspace(ctx.store, ctx.workspaceId, {
        limit: url.searchParams.get('limit'),
      });
      res.status(200).json(Object.assign({ ok: out.ok !== false }, out));
      return;
    }

    // The scheduled sweep, also runnable by hand. Guarded like every other
    // write path that can spend provider quota.
    if (action === 'universe-refresh') {
      if (!authorized(req)) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const out = await universe.refreshDueWorkspaces({
        maxWorkspaces: url.searchParams.get('max'),
        minIntervalHours: url.searchParams.get('min_interval_hours'),
      });
      res.status(200).json(out);
      return;
    }

    // Optional one-way mirror of this brand's universe into the legacy Google
    // Sheet, for operators who have credentials and want the spreadsheet view.
    if (action === 'universe-export') {
      const ctx = universeContext(req, url);
      if (ctx.error) { res.status(401).json({ ok: false, error: ctx.error, note: ctx.note }); return; }
      const rows = await ctx.store.list(ctx.workspaceId);
      res.status(200).json(await universe.exportToSheet(rows));
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // COMPETITIVE INTELLIGENCE (Supabase) — ads / emails / landing / offers /
    // funnels. Collectors POST already-fetched payloads; this layer owns dedup,
    // versioning and offer extraction. Optional shared secret via INGEST_TOKEN.
    // ═══════════════════════════════════════════════════════════════════════
    const ciWriteGuard = () => {
      const secret = (process.env.INGEST_TOKEN || '').trim();
      if (!secret) return true;
      const got = (req.headers['x-ingest-token'] || url.searchParams.get('token') || '').trim();
      return got === secret;
    };

    if (action === 'ci-collect-ad' || action === 'ci-collect-email' || action === 'ci-collect-landing') {
      if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST required' }); return; }
      if (!ciWriteGuard()) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const body = await readBody(req);
      const items = Array.isArray(body.items) ? body.items : [body];
      const fn = action === 'ci-collect-ad' ? ciCollect.collectAd
               : action === 'ci-collect-email' ? ciCollect.collectEmail : ciCollect.collectLanding;
      const results = [];
      for (const it of items) { try { results.push(await fn(it)); } catch (e) { results.push({ error: e.message }); } }
      res.status(200).json({ ok: true, count: results.length, results });
      return;
    }

    // Supabase brands (the CI system of record) — ids here match ci_*.brand_id.
    // Distinct from ?action=brands, which returns legacy Google-Sheet rows.
    if (action === 'ci-brands') {
      const filters = { is_own: 'eq.false' };
      if (url.searchParams.get('active') !== '0') filters.active = 'eq.true';
      const rows = await supa.select('brands', { filters, order: 'name.asc', limit: 1000 });
      res.status(200).json({ ok: true, count: rows.length, brands: rows });
      return;
    }

    if (action === 'ci-ads' || action === 'ci-emails' || action === 'ci-landing') {
      const table = { 'ci-ads': 'ci_ads', 'ci-emails': 'ci_emails', 'ci-landing': 'ci_landing_pages' }[action];
      const filters = {};
      const brandId = url.searchParams.get('brand_id'); if (brandId) filters.brand_id = `eq.${brandId}`;
      const src = url.searchParams.get('source'); if (src) filters.source = `eq.${src}`;
      const orderCol = action === 'ci-emails' ? 'send_date.desc' : action === 'ci-landing' ? 'captured_at.desc' : 'last_seen.desc';
      const rows = await supa.select(table, { filters, order: orderCol, limit: Number(url.searchParams.get('limit') || 200) });
      res.status(200).json({ ok: true, count: rows.length, rows });
      return;
    }

    if (action === 'ci-offers') {
      const rows = await ciOffers.query({
        offer_type: url.searchParams.get('offer_type') || undefined,
        product_category: url.searchParams.get('category') || undefined,
        region: url.searchParams.get('region') || undefined,
        brand_id: url.searchParams.get('brand_id') || undefined,
        days: url.searchParams.get('days') || 30,
        limit: Number(url.searchParams.get('limit') || 200)
      });
      res.status(200).json({ ok: true, count: rows.length, offers: rows });
      return;
    }

    if (action === 'ci-enrich') {
      if (!ciWriteGuard()) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const assetType = url.searchParams.get('type') || 'ad';
      const result = await getEnrich().enrichBatch(assetType, {
        limit: Number(url.searchParams.get('limit') || 10),
        force: url.searchParams.get('force') === '1'
      });
      res.status(200).json({ ok: true, ...result });
      return;
    }

    if (action === 'ci-funnel') {
      const brandId = url.searchParams.get('brand_id');
      if (!brandId) { res.status(400).json({ ok: false, error: 'brand_id required' }); return; }
      const funnels = await ciFunnel.getForBrand(brandId);
      res.status(200).json({ ok: true, count: funnels.length, funnels });
      return;
    }

    if (action === 'ci-funnel-rebuild') {
      if (!ciWriteGuard()) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const brandId = url.searchParams.get('brand_id');
      const result = brandId ? await ciFunnel.rebuildForBrand(brandId) : await ciFunnel.rebuildAll();
      res.status(200).json({ ok: true, result });
      return;
    }

    // Mirror the legacy Google-Sheet email capture into the unified ci_emails
    // table (idempotent). Runs server-side — the function holds the Sheet creds.
    if (action === 'ci-email-sync') {
      if (!authorized(req) && !ciWriteGuard()) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const bridge = require('./_shared/ci-email-bridge');
      const result = await bridge.sync({
        limit: Number(url.searchParams.get('limit') || 0),
        html: url.searchParams.get('html') !== '0'
      });
      res.status(200).json(result);
      return;
    }

    // Combined daily competitor pass (one cron slot on Hobby): mirror new emails
    // from the Sheet, then enrich the freshest un-enriched emails + ads.
    if (action === 'ci-daily') {
      if (!authorized(req) && !ciWriteGuard()) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
      const bridge = require('./_shared/ci-email-bridge');
      const emailSync = await bridge.sync({ limit: 0 });
      const enrichEmails = await getEnrich().enrichBatch('email', { limit: 15 });
      const enrichAds = await getEnrich().enrichBatch('ad', { limit: 15 });
      res.status(200).json({ ok: true, emailSync, enrichEmails: { processed: enrichEmails.processed }, enrichAds: { processed: enrichAds.processed } });
      return;
    }

    // ── USER subscriptions (real-time mailer/ad follow) ──────────────────────
    // sub-list?user=  → this user's followed brands
    // sub-set (POST {user, brand_name, domain?, brand_id?, mailers, ads, active})
    if (action === 'sub-list') {
      const subsCore = require('./_shared/ci-subscriptions-core');
      const user = url.searchParams.get('user') || '';
      const subs = await subsCore.listForUser(user);
      res.status(200).json({ ok: true, subscriptions: subs });
      return;
    }
    if (action === 'sub-set') {
      const subsCore = require('./_shared/ci-subscriptions-core');
      const b = await readBody(req);
      const out = await subsCore.setSub({
        userEmail: b.user || b.userEmail || '', brand_id: b.brand_id || null,
        brand_name: b.brand_name || b.brand || '', domain: b.domain || '',
        mailers: b.mailers !== false, ads: b.ads !== false, active: b.active !== false,
      });
      res.status(out.ok ? 200 : 400).json(out);
      return;
    }

    // ── item 1: REAL landing pages per platform (not homepages) ──────────────
    // Homepages are served separately as "Website". This returns the actual
    // landing pages captured behind ads/mailers, each WITH its driving asset,
    // grouped by platform. Honest empty groups when nothing is captured yet.
    if (action === 'landing-real') {
      const brandId = url.searchParams.get('brand_id');
      const limit = Number(url.searchParams.get('limit') || 200);
      const filt = brandId ? { brand_id: `eq.${brandId}` } : {};
      let ads = [], emails = [], landing = [];
      try { ads = await supa.select('ci_ads', { filters: { ...filt }, order: 'last_seen.desc', limit }); } catch (_) {}
      try { emails = await supa.select('ci_emails', { filters: { ...filt }, order: 'send_date.desc', limit }); } catch (_) {}
      try { landing = await supa.select('ci_landing_pages', { filters: { ...filt }, order: 'captured_at.desc', limit }); } catch (_) {}
      const lpByHash = {}; landing.forEach(l => { if (l.url) lpByHash[l.url] = l; });
      const platforms = { meta: [], google: [], tiktok: [], mailers: [] };
      ads.forEach(a => {
        if (!a.landing_url) return;
        const key = (a.source || '').toLowerCase();
        const bucket = platforms[key] ? key : (key.includes('tik') ? 'tiktok' : key.includes('goog') ? 'google' : key.includes('meta') || key.includes('face') ? 'meta' : null);
        if (!bucket) return;
        platforms[bucket].push({
          brand: a.brand_name, landing_url: a.landing_url, asset_type: a.creative_type || 'image',
          asset_url: (a.image_urls && a.image_urls[0]) || (a.video_urls && a.video_urls[0]) || '',
          headline: a.headline || null, source_link: a.source_link || null,
          captured_lp: !!lpByHash[a.landing_url], captured_at: a.last_seen,
        });
      });
      emails.forEach(e => {
        const dest = (e.ctas && e.ctas.find(c => c.href) || {}).href || '';
        if (!dest) return;
        platforms.mailers.push({
          brand: e.brand_name, landing_url: dest, asset_type: 'mailer',
          asset_url: (e.images && e.images[0]) || '', headline: e.subject || null,
          source_link: e.source_link || null, captured_lp: !!lpByHash[dest], captured_at: e.send_date,
        });
      });
      const groups = [
        { platform: 'Meta Ads', key: 'meta', items: platforms.meta },
        { platform: 'Google Ads', key: 'google', items: platforms.google },
        { platform: 'TikTok Ads', key: 'tiktok', items: platforms.tiktok },
        { platform: 'Mailers', key: 'mailers', items: platforms.mailers },
      ];
      res.status(200).json({ ok: true, groups, captured_landing_count: landing.length });
      return;
    }

    // ── item 3: brand detail — ALL assets of one brand ───────────────────────
    if (action === 'brand-detail') {
      const brandId = url.searchParams.get('brand_id');
      const name = url.searchParams.get('brand') || '';
      const filt = brandId ? { brand_id: `eq.${brandId}` } : (name ? { brand_name: `eq.${name}` } : {});
      let brand = null, emails = [], ads = [], landing = [];
      try { if (brandId) { const b = await supa.select('brands', { filters: { id: `eq.${brandId}` }, limit: 1 }); brand = b[0] || null; } } catch (_) {}
      try { emails = await supa.select('ci_emails', { filters: { ...filt }, order: 'send_date.desc', limit: 200 }); } catch (_) {}
      try { ads = await supa.select('ci_ads', { filters: { ...filt }, order: 'last_seen.desc', limit: 200 }); } catch (_) {}
      try { landing = await supa.select('ci_landing_pages', { filters: { ...filt }, order: 'captured_at.desc', limit: 200 }); } catch (_) {}
      const adsByPlatform = { meta: [], google: [], tiktok: [], other: [] };
      ads.forEach(a => { const k = (a.source || '').toLowerCase(); (adsByPlatform[k] || adsByPlatform.other).push(a); });
      res.status(200).json({ ok: true, brand, brand_name: brand?.name || name, website: brand?.domain ? 'https://' + brand.domain : null,
        counts: { mailers: emails.length, ads: ads.length, landing: landing.length },
        emails, ads: adsByPlatform, landing });
      return;
    }

    res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (err) {
    console.error(`[api/competitor] action=${action} failed:`, err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

// Wrapped so everything this router calls - including the generic Supabase
// helper in _shared/supa.js, which has no `req` of its own - can resolve THIS
// caller's workspace and scope its reads and writes to it. See
// api/_shared/request-scope.js for why an ambient variable would not do.
module.exports = require('./_shared/request-scope.js').wrap(module.exports);
