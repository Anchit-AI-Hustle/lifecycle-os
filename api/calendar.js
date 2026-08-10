'use strict';

/**
 * /api/calendar — single-function router for calendar generation,
 * mailer triggering, and Smart Brain actions.
 *
 * Consolidated to keep us under Vercel Hobby's 12-function limit. The
 * actual handlers still live in api/_shared/ (underscore prefix excludes
 * them from Vercel's function scan), so all the existing logic is intact
 * — this file only dispatches.
 *
 * Routes:
 *   ?action=generate         → POST: build a 30-day calendar
 *   ?action=trigger-mailer   → POST: feed one calendar row into the
 *                              /api/ai/pipeline stages to produce HTML
 *   ?action=smart-brain-*   → GET/POST: Smart Brain health/schema/daily run/
 *                              generation/feedback/recalibration, multiplexed
 *                              here to avoid adding a 13th Vercel function
 *   ?action=smart-brain-plan        → GET: current persisted rolling plan
 *   ?action=smart-brain-sync-daily  → POST: daily review — refresh tentative
 *                              entries from latest data, keep approved locked
 *   ?action=smart-brain-cron        → GET: Vercel Cron entrypoint for the same
 *                              (CRON_SECRET-protected); also kicks the prebuild chain
 *   ?action=smart-brain-prebuild    → POST: convergent background worker that
 *                              builds the FULL asset bundle (LLM copy + images:
 *                              mailer + ads + landing page) for every unbuilt slot
 *                              in the 90-day window, one batch per call, re-firing
 *                              itself until the whole window is prebuilt then idling
 *                              (CRON_SECRET-protected)
 *   ?action=smart-brain-preview     → POST: generate-on-demand funnel preview
 *                              (mailer + ads + LP) for any slot — NOT persisted,
 *                              status unchanged. Powers "View" before approval.
 *   ?action=smart-brain-approve     → POST: human sign-off → LLM-written
 *                              mailer + ads + landing page, persisted
 *   ?action=smart-brain-reject      → POST: reject slot, re-planned next sync
 *   ?action=lp&id=...               → GET: serve a generated landing page
 *   ?action=lifecycle-generate      → POST: deterministic cohort-native UK
 *                              lifecycle calendar (lifecycle-calendar-generate.js)
 *   ?action=lifecycle-list          → GET: read persisted lifecycle_calendar_entries
 *                              (graceful when Supabase is not configured)
 *   ?action=lifecycle-build-mailer  → POST { id | entry }: one LLM call →
 *                              brand-gated mailer HTML (lifecycle-mailer-build.js)
 */

const generate = require('./_shared/calendar-generate.js');
const lifecycleGen = require('./_shared/lifecycle-calendar-generate.js');
const lifecycleBuild = require('./_shared/lifecycle-mailer-build.js');
const triggerMailer = require('./_shared/calendar-trigger.js');
const plan = require('./_shared/smart-brain-plan.js');
const calExport = require('./_shared/calendar-export.js');
const { runDailySmartBrain, smartConfig, schemaAssumptions, GenerationService, SmartBrainDbAdapter } = require('../lib/smart-brain/services.js');

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return req.body;
}

// Base URL for self-triggering the background prebuild chain. On Vercel this is
// VERCEL_URL (the current deployment); SELF_BASE_URL is an optional override.
function selfBaseUrl() {
  if (process.env.SELF_BASE_URL) return String(process.env.SELF_BASE_URL).replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return '';
}

// Fire the NEXT prebuild batch as an independent invocation and return once it
// has started (or after a short cutoff). We do NOT await the whole batch — the
// child invocation keeps running on Vercel after our client connection drops, so
// this hands off without blocking the current response for 30-60s. Guarded by
// CRON_SECRET; a no-op when we cannot resolve a base URL (e.g. local dev).
async function firePrebuild(depth = 0) {
  const base = selfBaseUrl();
  if (!base || typeof fetch !== 'function') return { fired: false, reason: 'no self base url / no fetch' };
  const secret = process.env.CRON_SECRET || '';
  const url = `${base}/api/calendar?action=smart-brain-prebuild`;
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    await fetch(url, { method: 'POST', headers, body: JSON.stringify({ _depth: (depth || 0) + 1 }), signal: ctrl.signal });
  } catch (_) { /* expected: the child runs longer than our 3s handoff window */ }
  finally { clearTimeout(timer); }
  return { fired: true };
}

async function smartBrain(req, res, smartAction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = readBody(req);
  try {
    if (smartAction === 'health') {
      const config = smartConfig(body.config || {});
      const db = new SmartBrainDbAdapter(config);
      return res.status(200).json({ ok: true, service: 'knickgasm-smart-brain', db_linked: db.connected, modules: ['knowledge_base', 'analysis', 'competitor_benchmarking', 'calendar_intelligence', 'generation', 'human_review'], live_platform_push: false });
    }

    if (smartAction === 'schema') return res.status(200).json({ ok: true, ...schemaAssumptions(smartConfig(body.config || {})) });

    if (smartAction === 'plan') {
      const result = await plan.getPlan({ config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'dbcheck') {
      // Safe diagnostic — no secret values, only project refs + HTTP statuses.
      return res.status(200).json(await plan.dbCheck({ config: body.config || {} }));
    }

    if (smartAction === 'sync-status') {
      // Shared-source-of-truth freshness (spec §24b): generated campaigns with
      // their stored freshness + a re-check of facts against the current library.
      return res.status(200).json(await plan.syncStatus({ config: body.config || {}, limit: body.limit || 60 }));
    }

    if (smartAction === 'export') {
      // Calendar → Google-Sheets-importable CSV. Uses the entries the client
      // already holds (what the reviewer sees) when POSTed; else pulls the plan.
      let entries = Array.isArray(body.entries) ? body.entries : null;
      if (!entries) { const p = await plan.getPlan({ config: body.config || {} }); entries = p.entries || []; }
      const csv = calExport.buildExportCsv(entries);
      const stamp = (entries[0] && entries[0].date) || 'plan';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="knickgasm-automated-calendar-${stamp}.csv"`);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).send(csv);
    }

    if (smartAction === 'sync-daily') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await plan.syncDaily({ config: body.config || {}, days: body.days, persist: body.persist !== false });
      // Kick the background prebuild so newly added/refreshed slots get their full
      // asset bundle (copy + images) built ahead of need. Opt out with prebuild:false.
      if (body.prebuild !== false) { const f = await firePrebuild(0); result.prebuild_kicked = f.fired; }
      return res.status(200).json(result);
    }

    if (smartAction === 'prebuild') {
      // Convergent background worker: build a batch of unbuilt slots (full LLM
      // copy + images) then re-fire itself until the whole 90-day window is built.
      // CRON_SECRET-protected like cron; fails closed in production without one.
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const secret = process.env.CRON_SECRET || '';
      const auth = req.headers.authorization || '';
      const authorized = secret
        ? (auth === `Bearer ${secret}` || req.query?.secret === secret)
        : (String(process.env.VERCEL_ENV) !== 'production');
      if (!authorized) return res.status(401).json({ ok: false, error: 'Unauthorized prebuild call' });
      const depth = Math.max(0, +((body && body._depth) || req.query?.depth || 0));
      const MAX_DEPTH = 400; // backstop against runaway self-chaining (> 90d × markets slots)
      const batchSize = Math.max(1, Math.min(3, +((body && body.batchSize) || 1)));
      const result = await plan.prebuildAssets({ config: body.config || {}, batchSize });
      // Chain to the next batch only while making progress and within the backstop,
      // so a total-failure batch (e.g. LLM down) stops instead of hot-looping.
      let chained = false;
      if (result.remaining > 0 && result.built.length > 0 && depth < MAX_DEPTH) {
        const f = await firePrebuild(depth);
        chained = f.fired;
      }
      return res.status(200).json({ ok: true, prebuild: true, depth, chained, ...result });
    }

    if (smartAction === 'heal') {
      // Republish approved/final slots whose smart_generated_campaigns row is
      // missing (e.g. after a table wipe/reset) so /lp/:id resolves again. The
      // rebuild is DETERMINISTIC (idFor = sha1(entry)) so it lands under the id the
      // slot already advertises, and runs offline (noLLM template) so it works even
      // when LLM/image providers are down. Idempotent + orphan-only + cheap, so it
      // carries the same OPEN posture as preview/sync-daily (no CRON_SECRET); it is
      // a no-op when there are no orphans. Batched + resumable via `remaining`.
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const batchSize = Math.max(1, Math.min(40, +((body && body.batchSize) || req.query?.batchSize || 20)));
      const result = await plan.healOrphans({ config: (body && body.config) || {}, batchSize });
      return res.status(200).json({ ok: true, heal: true, ...result });
    }

    if (smartAction === 'cron') {
      // Vercel Cron sends GET with Authorization: Bearer <CRON_SECRET> when the env var is set.
      const secret = process.env.CRON_SECRET || '';
      const auth = req.headers.authorization || '';
      // With a secret: require Bearer/secret (no spoofable x-vercel-cron trust).
      // Without a secret: open in dev/preview, FAIL CLOSED in production.
      const authorized = secret
        ? (auth === `Bearer ${secret}` || req.query?.secret === secret)
        : (String(process.env.VERCEL_ENV) !== 'production');
      if (!authorized) return res.status(401).json({ ok: false, error: 'Unauthorized cron call' });
      const result = await plan.syncDaily({ persist: true });
      // Kick the background prebuild chain so the full 90-day window keeps its
      // assets (copy + images) prebuilt automatically every day.
      const f = await firePrebuild(0);
      return res.status(200).json({ ok: true, cron: true, synced_at: result.synced_at, mode: result.mode, changes: result.changes.length, persistence: result.persistence, prebuild_kicked: f.fired });
    }

    if (smartAction === 'preview') {
      // Generate-on-demand funnel preview for ANY slot (incl. tentative) without
      // persisting or approving — reviewers see the mailer/ads/LP before sign-off.
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.id && !body.entry) return res.status(400).json({ ok: false, error: 'id (calendar entry) or entry is required' });
      const result = await plan.previewEntry({ id: body.id, entry: body.entry || null, reviewer: body.reviewer || null, config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'approve') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.id && !body.entry) return res.status(400).json({ ok: false, error: 'id (calendar entry) or entry is required' });
      const result = await plan.approveEntry({ id: body.id, entry: body.entry || null, reviewer: body.reviewer || null, config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'reject') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.id) return res.status(400).json({ ok: false, error: 'id is required' });
      const result = await plan.rejectEntry({ id: body.id, reviewer: body.reviewer || null, notes: body.notes || '', config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'unreject') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.id) return res.status(400).json({ ok: false, error: 'id is required' });
      const result = await plan.unrejectEntry({ id: body.id, reviewer: body.reviewer || null, config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'activate-scenario') {
      // Promote a pre-staged standby scenario (best|conservative|emergency|instant)
      // into the active rolling plan, or revert with scenario='medium'.
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.scenario) return res.status(400).json({ ok: false, error: 'scenario is required (best|medium|conservative|emergency|instant)' });
      const result = await plan.activateScenario({ scenario: body.scenario, reviewer: body.reviewer || null, scope: body.scope || 'all', config: body.config || {} });
      return res.status(200).json(result);
    }

    if (smartAction === 'run-daily' || smartAction === 'daily') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await runDailySmartBrain({ config: body.config || {}, startDate: body.start_date, days: body.days, persist: body.persist === true });
      return res.status(200).json(result);
    }

    if (smartAction === 'generate-slot') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.entry) return res.status(400).json({ ok: false, error: 'entry is required' });
      const campaign = new GenerationService(smartConfig(body.config || {})).generate(body.entry);
      return res.status(200).json({ ok: true, campaign });
    }

    if (smartAction === 'feedback') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const config = smartConfig(body.config || {});
      const db = new SmartBrainDbAdapter(config);
      const feedback = { target_type: body.target_type || 'calendar_entry', target_id: body.target_id, verdict: body.verdict || 'comment', notes: body.notes || '', reviewer: body.reviewer || null, created_at: new Date().toISOString() };
      const persistence = await db.insert(config.tableNames.feedback, [feedback]);
      return res.status(200).json({ ok: true, feedback, persistence, applied_to_future_generation: true });
    }

    if (smartAction === 'weekly-recalibration' || smartAction === 'recalibrate') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await runDailySmartBrain({ config: body.config || {}, startDate: body.start_date, days: body.days || 15, persist: body.persist === true });
      result.weekly_recalibration = { completed_at: new Date().toISOString(), human_reviewer: body.reviewer || 'unassigned', decisions: body.decisions || [], next_required_by_days: 7 };
      return res.status(200).json(result);
    }

    return res.status(400).json({ ok: false, error: 'Unknown Smart Brain action. Use smart-brain-health|smart-brain-schema|smart-brain-plan|smart-brain-sync-daily|smart-brain-cron|smart-brain-prebuild|smart-brain-heal|smart-brain-preview|smart-brain-approve|smart-brain-reject|smart-brain-run-daily|smart-brain-generate-slot|smart-brain-feedback|smart-brain-weekly-recalibration' });
  } catch (err) {
    console.error('[api/calendar smart-brain]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function lifecycle(req, res, action) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = readBody(req);
  try {
    if (action === 'lifecycle-generate') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      const result = await lifecycleGen.generateLifecycleCalendar({
        start_date: body.start_date,
        days: body.days,
        cohorts: body.cohorts,
        cadence_per_week: body.cadence_per_week,
        market: body.market || 'UK',
      });
      return res.status(200).json({ ok: true, ...result });
    }

    if (action === 'lifecycle-list') {
      const q = req.query || {};
      const result = await lifecycleGen.listEntries({
        market: q.market || body.market || 'UK',
        from: q.from || body.from || null,
        to: q.to || body.to || null,
      });
      return res.status(200).json(result);
    }

    if (action === 'lifecycle-build-mailer') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
      if (!body.id && !body.entry) return res.status(400).json({ ok: false, error: 'id (lifecycle entry) or entry is required' });
      const result = await lifecycleBuild.buildLifecycleMailer({ id: body.id || null, entry: body.entry || null, force: !!(body.force || (q && q.force)) });
      return res.status(200).json(result);
    }

    return res.status(400).json({ ok: false, error: 'Unknown lifecycle action. Use lifecycle-generate|lifecycle-list|lifecycle-build-mailer' });
  } catch (err) {
    console.error('[api/calendar lifecycle]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = async function handler(req, res) {
  const action = (req.query?.action || '').toLowerCase();
  if (action === 'generate') return generate(req, res);
  if (action === 'trigger-mailer' || action === 'triggermailer') return triggerMailer(req, res);
  // Connector pre-flight for the smart-brain generateAll pipeline. Multiplexed
  // here (not a new function file) to stay under Vercel Hobby's 12-function cap.
  if (action === 'connectors-check') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    try {
      const { checkTextProviders } = require('./_shared/connector-check.js');
      const userGeminiKey =
        (req.headers && (req.headers['x-gemini-key'] || req.headers['x-user-gemini-key'])) ||
        (req.query && req.query.geminiKey) || '';
      return res.status(200).json({ ok: true, ...checkTextProviders({ userGeminiKey }) });
    } catch (_) {
      return res.status(200).json({ ok: false, anyConfigured: false, anyUsable: false, providers: [], summary: 'Could not run connector diagnostics.' });
    }
  }
  if (action.startsWith('lifecycle-')) return lifecycle(req, res, action);
  if (action.startsWith('smart-brain-')) return smartBrain(req, res, action.replace('smart-brain-', ''));
  if (action === 'lp') {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      const id = String(req.query?.id || '');
      const { html, diag } = await plan.landingPageResolve(id, {}, req.query?.v || null);
      // ?debug=1 → JSON diagnostics (no secrets) so a 404 is diagnosable live.
      if (req.query?.debug) { res.setHeader('Content-Type', 'application/json'); return res.status(200).json({ ok: true, diag }); }
      if (!html) {
        // NEVER serve a dead page. The /lp URL always hosts a REAL, on-brand KNICKGASM
        // landing page: the campaign's own if persisted (any generated campaign,
        // not just approved ones — landingPageResolve is not approval-gated), else a
        // complete catalog-driven fallback so a link minted before persistence still
        // resolves to a real page. ?debug=1 above still exposes the diag.
        const region = String(req.query?.region || req.query?.r || 'us').toLowerCase();
        const { buildFallbackLanding } = require('./_shared/landing-fallback.js');
        const fb = buildFallbackLanding({ id, region, hint: String(req.query?.hint || '') });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-KNICKGASM-LP', diag.campaignFound ? 'campaign-no-lp-fallback' : 'campaign-not-persisted-fallback');
        if (req.query?.download) {
          res.setHeader('Content-Disposition', `attachment; filename="knickgasm-lp-${(id || 'page').replace(/[^a-z0-9_-]/gi, '')}.html"`);
          res.setHeader('Cache-Control', 'no-store');
          return res.status(200).send(fb);
        }
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
        return res.status(200).send(fb);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // ?download=1 → export the self-contained, deploy-ready HTML file (drop onto try.knickgasm.*).
      if (req.query?.download) {
        res.setHeader('Content-Disposition', `attachment; filename="knickgasm-lp-${(id || 'page').replace(/[^a-z0-9_-]/gi, '')}.html"`);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(html);
      }
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
      return res.status(200).send(html);
    } catch (err) {
      console.error('[api/calendar lp]', err);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(400).json({ ok: false, error: 'Use ?action=generate, ?action=trigger-mailer, ?action=lp&id=…, ?action=smart-brain-run-daily, or ?action=lifecycle-generate|lifecycle-list|lifecycle-build-mailer' });
};

// ── Metering (Universal Brand Platform) ────────────────────────────────────
// Only the generating actions cost credits; reads, the /lp/:id page server and
// the cron-driven paths stay free. A cron call carries CRON_SECRET rather than
// a user session, and has no wallet to charge, so it is never metered.
const _credits = require('./_shared/credits-core.js');
const _CAL_FEATURE = {
  generate: 'calendar.generate',
  'lifecycle-generate': 'calendar.generate',
  'lifecycle-build-mailer': 'mailer.generate',
  'trigger-mailer': 'mailer.generate',
  triggermailer: 'mailer.generate',
};
module.exports = _credits.metered(module.exports, (req) => {
  const auth = String((req.headers && req.headers.authorization) || '');
  const secret = String(process.env.CRON_SECRET || '');
  if (secret && auth === `Bearer ${secret}`) return null;      // scheduled run
  const action = String((req.query || {}).action || '').toLowerCase();
  return _CAL_FEATURE[action] || null;
});

