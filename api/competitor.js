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
 *
 * All data + ingestion live in this repo (api/_shared/competitor-core.js) — no
 * dependency on any other deployment.
 */

const core = require('./_shared/competitor-core');
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

  try {
    if (action === 'list') {
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

    // ── Phase 2: competitor brand database + discovery ──
    if (action === 'brands') {
      const brands = await core.getBrands();
      res.status(200).json({ ok: true, brands, total: brands.length });
      return;
    }

    if (action === 'seed') {
      const r = await core.seedBrands(new Date().toISOString());
      res.status(200).json({ ok: true, ...r });
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
      const result = await core.markBrandSubscribed(body || {});
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

    if (action === 'discover') {
      // Accept optional categories[]/geographies[]/limit via query (?categories=Sneaker,Coffee&limit=30).
      const csv = (k) => { const v = url.searchParams.get(k); return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []; };
      const found = await core.discoverBrands({
        categories: csv('categories'),
        geographies: csv('geographies'),
        limit: url.searchParams.get('limit'),
      });
      const stored = await core.appendBrands(found.brands, new Date().toISOString());
      res.status(200).json({ ok: true, proposed: found.brands.length, provider: found.provider, ...stored });
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
