'use strict';

/**
 * /api/brain — Smart Brain router (single Vercel function, ?action= dispatch).
 *
 * Modules (logic in api/_shared/brain-*.js — excluded from the function count):
 *   KB              ?action=kb | kb-patterns
 *   ANALYSIS        ?action=analyze (POST) | cohorts | library | scores
 *   COMPETITOR      ?action=benchmarks  (isolated stream)
 *   CALENDAR        ?action=calendar | calendar-generate (POST) |
 *                   calendar-review (POST) | festivals | festivals-extract (POST) |
 *                   feedback (POST) | mvt (GET/POST)
 *   GENERATION      ?action=generate (POST {slot_id}) | assets | asset (?id=) | campaigns
 *   REVIEW (HITL)   ?action=review | decide (POST) | recalibrate (POST) | confidence
 *   AGENTS          ?action=agents | agent-upsert (POST) | agent-sync (POST) |
 *                   agent-chat (POST) | agent-sessions
 *   CONSOLE         ?action=console-chat (POST) — chat-style brain console
 *   VIDEO           ?action=video-generate (POST) | video-status (GET) —
 *                   Veo 3.1 → Sora 2 → Higgsfield → Runway (_shared/video-core.js)
 *   SOCIAL          ?action=social-run-daily (POST, or cron GET via
 *                   /api/cron/social with CRON_SECRET) | social-list (GET) |
 *                   social-approve | social-skip (POST {id}) —
 *                   daily multi-agent post pipeline (_shared/social-core.js)
 *   OPS             ?action=status | config (GET/POST) | cron (daily loop)
 *
 * Daily cron: GET /api/brain?action=cron — guarded by CRON_SECRET when set
 * (Vercel sends Authorization: Bearer $CRON_SECRET) or vercel-cron UA.
 */

const core = require('./_shared/brain-core.js');
const kb = require('./_shared/brain-kb.js');
const analysis = require('./_shared/brain-analysis.js');
const competitor = require('./_shared/brain-competitor.js');
const calendar = require('./_shared/brain-calendar.js');
const generate = require('./_shared/brain-generate.js');
const review = require('./_shared/brain-review.js');
const agents = require('./_shared/brain-agent.js');
const jarvis = require('./_shared/jarvis.js');
const agentic = require('./_shared/agentic-orchestrator.js');
const calendarScenarios = require('./_shared/calendar-scenarios.js');
const smartbrain = require('../lib/smart-brain/services.js');
const brandLlm = require('./_shared/brand-llm.js');
const klaviyo = require('./_shared/klaviyo-core.js');
const adInsights = require('./_shared/ad-insights-core.js');
const adsSnowflake = require('./_shared/ads-snowflake-core.js');
const adsLive = require('./_shared/ads-live-core.js');
const adsSop = require('./_shared/ads-sop-core.js');
const adMetrics = require('./_shared/ad-metrics-catalog.js');
const webengage = require('./_shared/webengage-core.js');
const video = require('./_shared/video-core.js');
const social = require('./_shared/social-core.js');
const osb = require('./_shared/os-backbone.js');
const alerts = require('./_shared/alerts-core.js');
let snowflake = null;
try { snowflake = require('./_shared/snowflake-sync-core.js'); } catch (_) { snowflake = null; }

let callLLM = null;
try { callLLM = require('./_shared/llm.js'); } catch (_) { callLLM = null; }

function body(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) { return {}; } }
  return req.body;
}

/**
 * The conversational actions: each turn answers FOR a brand and may spend a
 * model call. See the browser-attribution rule in the handler.
 */
const CHATS = /^(agent-chat|agent-analyze|team-chat|brand-chat|console-chat|platform-agents)$/;

/**
 * Actions that need no workspace and no session to answer honestly, so the
 * browser-attribution rule (demo data or a refusal for an unattributed page)
 * must not apply to them (2026-09-29). The TeleSuite registry is the hub's
 * FIRST request - a page that loads it before anyone has signed in or set a
 * brand received the demo overview instead, found no `subfeatures` in it, and
 * reported "TeleSuite could not start" to every signed-out visitor. The tool
 * manifest, the Agent Builder OpenAPI document and the navigation detector
 * are the same shape: a description of the product, not anybody's data.
 */
function publicAction(action, req, b) {
  const op = () => String((req.query && req.query.op) || (b && b.op) || '').toLowerCase();
  if (action === 'brand-tools' || action === 'jarvis') return true;
  if (action === 'telesuite') return /^(registry|clone|n8n|)$/.test(op());
  if (action === 'agent-builder') return /^(spec|)$/.test(op());
  return false;
}

/**
 * The actions that reach an AI model or a paid provider, the method on which
 * they do, and the credit-catalog key each is metered at (2026-09-29, review).
 *
 * MEASURED, not read: every action this router dispatches was sent with a
 * scripted llm.js and a fetch that throws on any unclaimed host, as an
 * anonymous server-to-server caller, as an unattributed browser, with a
 * device-shaped token and with a caller-named workspace
 * (tests/agents-executed.spec.js, "no anonymous shape reaches a model"). These
 * are the ones that reached the model or a provider. `calendar-scenarios`
 * reached neither and is not here; `platform-agents` already required a
 * session.
 *
 * Before this, an anonymous POST with no Origin header - or with any token at
 * all, forged or a device one, since the attribution rule counted a header's
 * PRESENCE - ran KicksGPT, the console, the team copilot, the analyst, the
 * 8-stage agentic run (26 model calls and a crawl of tenant zero's site), the
 * social pipeline and a video provider on this deployment's keys: the
 * 2026-08-23 open-proxy finding, on the router that has the most of them. And
 * an UNLISTED phone account - free, unverified, unlimited - spent the same
 * keys with no wallet, which is the faucet CREDITS_COMP_PHONES exists to shut.
 *
 * The meter is the gate: `credits.metered` below refuses an anonymous caller
 * (401) and an unlisted number (403) BEFORE the handler, holds the price for
 * a listed number or an account, settles on success and refunds on failure.
 * On a deployment whose meter is not configured the handler's own gate still
 * requires a verified caller, the same rule require-caller.js applies to
 * api/ai/generate.js. The scheduler's bearer is free and unmetered.
 *
 * The keys are existing catalog entries; the mapping is the pricing decision,
 * and it is one line each. `assistant.chat` is the catalog's "Brand assistant
 * message", which every conversation here is.
 */
const MODEL_FEATURE = {
  'brand-chat': ['POST', 'assistant.chat'],
  'console-chat': ['POST', 'assistant.chat'],
  'agent-chat': ['POST', 'assistant.chat'],
  'team-chat': ['POST', 'assistant.chat'],
  'agent-analyze': ['POST', 'assistant.chat'],
  'access-narrative': ['POST', 'analytics.narrative'],
  'analysis-narrative': [null, 'analytics.narrative'],
  'agentic-run': ['POST', 'campaign.plan'],
  generate: ['POST', 'brain.slot_prebuild'],
  'video-generate': ['POST', 'video.generate'],
  'mailer-assets': ['POST', 'image.generate'],
  tts: ['POST', 'audio.tts'],
  'social-run-daily': ['POST', 'social.daily_run'],
  'platform-agents': [null, 'analytics.report'],
};

/** The catalog key this request would spend, or null (a read, a 405, or not a model action). */
function modelFeature(action, req) {
  const m = MODEL_FEATURE[action];
  if (!m) return null;
  if (m[0] && String((req && req.method) || 'GET').toUpperCase() !== m[0]) return null;
  return m[1];
}

/**
 * The scheduler's own bearer, compared exactly. Unlike cronAuthorized() this
 * never answers true for a deployment with no CRON_SECRET: "no secret" is not
 * "the scheduler", and a free, unmetered model call is what it would grant.
 */
function schedulerBearer(req) {
  try { return require('./_shared/require-caller.js').isCron(req); } catch (_) { return false; }
}

/** Does the request carry a caller token at all (a bearer or a mobile+PIN token)? */
function tokenOn(req) {
  const h = (req && req.headers) || {};
  return !!(h.authorization || h.Authorization || h['x-lifecycle-token'] || h['X-Lifecycle-Token']);
}

/** No token, no workspace named, and a page's Origin: the browser-attribution rule applies. */
function unattributedShape(req, b) {
  const q = (req && req.query) || {};
  const body = b || ((req && req.body && typeof req.body === 'object') ? req.body : {});
  const h = (req && req.headers) || {};
  return !(q.workspace_id || body.workspace_id) && !tokenOn(req) && !!(h.origin || h.referer);
}

function cronAuthorized(req) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret) {
    const auth = req.headers.authorization || '';
    return auth === `Bearer ${secret}` || (req.query && req.query.secret === secret);
  }
  // No secret configured: open in dev/preview, but FAIL CLOSED in production so
  // the LLM/image-spending daily loop can never be triggered by anyone.
  if (String(process.env.VERCEL_ENV) === 'production') return false;
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Lifecycle-Token');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = String((req.query || {}).action || '').toLowerCase();

  // ── Platform webhooks: routed BEFORE the body is read as data ────────────
  // A callback is authenticated by a signature over the BYTES that arrived,
  // and req.body is not those bytes: it is a parse of them, and re-serialising
  // it changes whitespace, key order and unicode escapes, none of which
  // survive an HMAC. Until 2026-09-15 this action sat in the switch below and
  // handed the verifier JSON.stringify(req.body): on a bare stream that was
  // "{}", behind the Vercel helper it was a re-serialisation, so a genuine
  // delivery failed and only a canonical one passed. body(req) and the
  // workspace scoping below both read req.body, and behind the helper that
  // getter throws a 400 on a non-JSON body, so this has to run before either.
  // _shared/platform-webhooks.js reads the raw bytes, verifies, and only then
  // parses. Unauthenticated ON PURPOSE: a platform callback carries a
  // signature, not a session.
  if (action === 'dispatch-webhook') {
    return await require('./_shared/platform-webhooks.js').receive(req, res);
  }

  const b = body(req);

  // ── Workspace scoping (same contract as api/calendar.js) ──────────────────
  // Resolve ONCE per request: explicit param, else the caller's JWT -> their
  // active workspace, else the default only for userless (cron) calls. An
  // unattributed BROWSER request is refused rather than served the default
  // workspace's data.
  let __wsId = null;
  let __auth = null;
  try {
    const wsScope = require('./_shared/workspace-scope.js');
    const scopeEnv = {
      url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
    };
    __wsId = await wsScope.resolve(scopeEnv, req);
    const q0 = (req && req.query) || {};
    const b0 = (req && req.body && typeof req.body === 'object') ? req.body : {};
    // A PHONE ACCOUNT NAMES NO WORKSPACE (2026-09-29, review):
    // workspace-scope.resolve() already ignores the id; it is also removed
    // from the request, so no handler that reads req.query/req.body directly
    // (klaviyo's params, a core that re-resolves) can pick it back up.
    if (wsScope.carriesMobileToken(req)) {
      delete q0.workspace_id; delete b0.workspace_id; if (b && typeof b === 'object') delete b.workspace_id;
    }
    const hadExplicit = !!(q0.workspace_id || b0.workspace_id);
    // A token ATTRIBUTES a request only if the auth backend did not refuse it
    // (2026-09-29, review). This read a header's PRESENCE, so a forged bearer,
    // an expired session or a device-mode token (the one the browser never
    // sends, and the server cannot verify) stepped past the rule below - the
    // anonymous browser's 409 became a model call. Verified once, memoised on
    // the request, and reused by the meter, the brand resolve and the handler
    // gates. A backend that could not be REACHED (503) is not a refusal: the
    // request keeps its attribution and every gate that needs a session still
    // answers 503 with the host to fix.
    if (tokenOn(req) && !schedulerBearer(req)) {
      __auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
    }
    const tokenRefused = !!(__auth && !__auth.ok && Number(__auth.status) === 401);
    // A refused token proves no identity, so the workspace an unverified JWT
    // `sub` resolved to is not the caller's either.
    if (tokenRefused && !hadExplicit) __wsId = null;
    // A credential the backend REJECTED is answered with that rejection - an
    // expired session is told it expired, a device-mode token is told the
    // server cannot check it - rather than being served demo data or, off a
    // browser, admitted as if nobody had presented anything. Only the public
    // descriptions of the product still answer (for nobody, below).
    if (tokenRefused && !publicAction(action, req, b)) {
      return res.status(401).json({
        ok: false, action, error: __auth.error || 'sign_in_required',
        message: __auth.message || 'You are not signed in, so this could not run.',
      });
    }
    const hadAuth = tokenOn(req) && !tokenRefused;
    const fromBrowser = !!(req.headers && (req.headers.origin || req.headers.referer));
    if (!hadExplicit && !hadAuth && fromBrowser && publicAction(action, req, b)) {
      // A PUBLIC action for an unattributed page runs for NOBODY (2026-09-29,
      // review): a description of the product, answered with no workspace
      // and the unresolved brand. Scoping had already resolved the default
      // workspace (userless), so jarvis offered tenant zero's product pages
      // and storefront, and the Agent Builder spec carried tenant zero's
      // name, to every signed-out visitor of every other brand.
      __wsId = null;
      req.__workspaceId = null;
      req.__public_unattributed = true;
    } else if (!hadExplicit && !hadAuth && fromBrowser) {
      // No workspace. Another brand's data is NEVER substituted - that was the
      // original bug and it stays fixed. But returning empty arrays made the
      // app impossible to evaluate before signing up, so a READ gets synthetic
      // example data from an invented brand, flagged `demo` on every row.
      //
      // A WRITE does not: generating, sending or spending against a brand that
      // does not exist is not something to simulate, so those still refuse and
      // say what to do instead.
      const demo = require('./_shared/demo-mode.js');
      const WRITES = /^(generate|dispatch-|deliverability-|cohort-optimize|agentic-run|social-run|social-approve|social-skip|social-gateway|calendar-generate|decide|feedback|recalibrate|approve|reject|asset|video-|tts|snowflake-sync|os-run|agent-upsert|agent-sync)/;
      if (WRITES.test(action)) {
        return res.status(409).json({
          ok: false, error: 'no_active_brand', mode: 'demo',
          message: 'Set up a brand first. This action generates or sends for a specific brand, and there is no honest way to preview that without one.',
          setup_url: '/onboarding',
        });
      }
      // A CONVERSATION is not a read either (2026-09-29). The demo envelope
      // carries calendar rows and cohorts and no `reply`, so every chat
      // surface that received it for an unattributed visitor rendered nothing
      // - or the word "undefined" - where the answer should be. An assistant
      // answers FOR a brand over that brand's data; there is no honest demo
      // turn for a brand that does not exist, and a model call for one would
      // be spend with nobody to attribute it to. Refused like a write, with
      // the sentence the page can show.
      if (CHATS.test(action)) {
        return res.status(409).json({
          ok: false, error: 'no_active_brand', mode: 'demo',
          message: 'Set up a brand first, then sign in: the assistant answers for a specific brand over that brand\'s own data, and there is no honest way to answer for a brand that does not exist.',
          setup_url: '/onboarding',
        });
      }
      const b = demo.demoBrand(q0.demo_brand || '');
      const days = Number(q0.days || b0.days) || 7;
      return res.status(200).json(Object.assign(
        demo.overview(b, { days }),
        { error: 'workspace_unresolved', setup_url: '/onboarding', demo_brands: demo.DEMO_BRANDS.map((x) => ({ id: x.id, name: x.name, sector: x.sector })) },
      ));
    }
    req.__workspaceId = __wsId;
    if (req.query) req.query.workspace_id = req.query.workspace_id || __wsId || undefined;

    /* Resolve the brand RECORD here too, not just its id.
       Handlers used to each resolve their own, and the ones that forgot fell
       through to `defaultBrand()` inside the generator - which is tenant zero.
       ?action=social-run-daily was passing `workspaceId` and no brand at all,
       so every post it wrote came out as tenant zero's products, with tenant
       zero's real product URLs, inside whatever workspace asked for them.
       Resolved once, on the request, so no handler has to remember. */
    try {
      const rt = require('./_shared/brand-runtime.js');
      req.__brand = req.__public_unattributed
        ? rt.unresolvedBrand('no brand on this request: a signed-out page with no active brand')
        : await rt.resolve(req, Object.assign({ workspace_id: __wsId }, __auth ? { auth: __auth } : {}));
    } catch (_) { req.__brand = null; }
  } catch (_) { /* scoping must never hard-fail the router */ }

  // ── The model gate (2026-09-29, review) ──────────────────────────────────
  // An action that reaches a model or a paid provider needs a VERIFIED caller
  // or the scheduler's secret. With the meter configured, credits.metered
  // below has already refused anyone else before this handler ran; this is
  // the same rule for a deployment whose meter is not configured, where the
  // wrapper lets every request through unmetered. The unattributed browser
  // never gets here: the attribution rule above answered it.
  const __modelKey = modelFeature(action, req);
  if (__modelKey && !schedulerBearer(req)) {
    const a = __auth || await require('./_shared/brand-workspace-core.js').requireUser(req);
    if (!a || !a.ok) {
      const down = !!(a && Number(a.status) === 503);
      return res.status(down ? 503 : 401).json({
        ok: false, action, error: (a && a.error) || 'sign_in_required',
        message: (a && a.message) || 'You are not signed in, so this could not run.',
        why: `"${action}" reaches an AI model or a paid provider on this deployment's keys, so it needs a signed-in account (a mobile number and PIN saved in the database) or the scheduler's secret. Nothing was run and nothing was charged.`,
      });
    }
    const spend = require('./_shared/credits-core.js').spenderRefusal(a);
    if (spend) return res.status(spend.status || 403).json(Object.assign({ action }, spend));
  }

  /* The market a request gets when it names none: the ACTIVE brand's HOME
     market, from its own record. Every handler below used to fall to the
     literal 'US', so a brand whose record said IN (and only IN) had its
     default agentic run, scenario set, assistant turn and every analytics
     read built for a market it does not serve. */
  const __homeMarket = () => {
    try {
      const rt = require('./_shared/brand-runtime.js');
      return rt.homeRegion(req.__brand || rt.defaultBrand());
    } catch (_) { return ''; }
  };

  try {
    switch (action) {
      // ── TELESUITE ────────────────────────────────────────────────────────
      // The AI tele-sales / tele-support suite (ported from AI-TeleSuite).
      // Mounted here rather than as its own api/*.js file because the Hobby
      // plan caps serverless functions at 12 and we are at the cap.
      // Sub-dispatch is ?op= — see _shared/telesuite-core.js.
      case 'telesuite': {
        if (req.body && typeof req.body === 'string') req.body = b;
        return await require('./_shared/telesuite-core.js').handle(req, res);
      }

      // ── GROWTH OS ────────────────────────────────────────────────────────
      // The growth operating picture for the ACTIVE brand: experiment roadmap,
      // funnel audit, KPI tree, cohort framework, 30-60-90 and week-one plans,
      // and the competitive read. Deterministic and offline - it is the first
      // page a new operator opens, so it must render fully with no key, no
      // quota and no latency. See _shared/growth-os-core.js.
      case 'growth-os': {
        return await require('./_shared/growth-os-core.js').handle(req, res);
      }

      // ── OPS ──────────────────────────────────────────────────────────────
      case 'status': {
        const d = core.db();
        let dbOk = false, counts = {};
        try {
          const [c, s, g, q] = await Promise.all([
            d.select('smart_campaigns', { select: 'id', limit: 1 }),
            d.select('smart_calendar', { select: 'id,status', limit: 1000 }),
            d.select('smart_generated_campaigns', { select: 'id,status', limit: 1000 }),
            d.select('smart_review_queue', { select: 'id,state', limit: 500, filters: { state: 'eq.pending' } }),
          ]);
          dbOk = true;
          counts = {
            calendar_slots: s.length,
            slots_final: s.filter((x) => x.status === 'final').length,
            generated_campaigns: g.length,
            pending_review: q.length,
          };
        } catch (e) { counts = { error: e.message }; }
        const recal = await review.recalibrationStatus().catch(() => null);
        return res.json({
          ok: true, service: 'knickgasm-smart-brain', db_linked: dbOk,
          llm_available: !!callLLM, live_platform_push: false,
          modules: ['knowledge_base', 'analysis', 'competitor_benchmarking', 'calendar_intelligence', 'generation', 'human_review', 'agents'],
          counts, weekly_recalibration: recal,
        });
      }
      case 'config': {
        if (req.method === 'POST') {
          for (const [k, v] of Object.entries(b.config || {})) await core.setConfig(k, v);
          return res.json({ ok: true, updated: Object.keys(b.config || {}) });
        }
        return res.json({ ok: true, config: await core.getConfig() });
      }

      // ── KB ───────────────────────────────────────────────────────────────
      case 'kb': {
        const lib = await kb.libraryIndex();
        return res.json({ ok: true, campaigns: lib.length, library: lib.slice(0, parseInt(req.query.limit || '100', 10)) });
      }
      case 'kb-patterns': {
        const lib = await kb.libraryIndex();
        return res.json({ ok: true, patterns: kb.patterns(lib) });
      }

      // ── ANALYSIS ─────────────────────────────────────────────────────────
      case 'analyze': {
        const out = await analysis.runDaily({ persist: req.method === 'POST' });
        await core.logRun('manual', out.summary, true);
        return res.json({ ok: true, ...out });
      }
      case 'cohorts': {
        const rows = await core.db().select('smart_cohorts', { limit: 200, order: 'value_score.desc', filters: { active: 'eq.true' } });
        return res.json({ ok: true, cohorts: rows });
      }
      case 'library': {
        const out = await analysis.filteredLibrary({ channel: req.query.channel, market: req.query.market, cohortId: req.query.cohort });
        return res.json({ ok: true, ...out });
      }
      case 'scores': {
        const rows = await core.db().select('smart_library_scores', { limit: 1000, order: 'score.desc' });
        return res.json({ ok: true, scores: rows });
      }
      // Analyst agent — grounded interpretation of the live analytics, made
      // caveat-aware by the data-accuracy validator so it never builds a
      // recommendation on a flagged figure. (_shared/feature-agent.js analyst role.)
      case 'analysis-narrative': {
        const { runAnalyst } = require('./_shared/feature-agent.js');
        // Same gate as ?action=validate-data: the inputs below are the bundled
        // export, which belongs to tenant zero.
        const _mktA = require('./_shared/market-analytics.js');
        if (!(await _mktA.ownsBundledExport())) {
          return res.json({ ok: true, insights: [], data_scope: { level: 'other_workspace', basis: 'unset' }, note: _mktA.BUNDLED_OWNER_NOTE });
        }
        const { runValidation, loadMarketData } = require('./_shared/data-validation-core.js');
        let md = null; try { md = loadMarketData(); } catch (_) { md = null; }
        const us = md && md.markets && md.markets.US ? md.markets.US : {};
        const val = (() => { try { return runValidation(); } catch (_) { return { checks: [] }; } })();
        const caveats = val.checks
          .filter(c => ['MISMATCH', 'MISSING', 'MISLEADING'].includes(c.verdict))
          .map(c => ({ metric: c.metric, verdict: c.verdict, note: c.note }));
        const inputs = {
          window: 'trailing 12 months (US)',
          summary: us.summary || null,
          monthly: (us.monthly || []).slice(-13),
          data_accuracy: val.summary || null,
        };
        const out = await runAnalyst({
          feature: 'analytics',
          question: (b.question || req.query.q || 'What are the highest-leverage growth moves right now, and what data should I not trust?'),
          inputs, caveats,
        });
        return res.json({ ok: true, ...out, caveats_considered: caveats.length });
      }

      // ── COMPETITOR (isolated) ────────────────────────────────────────────
      case 'benchmarks': {
        const out = await competitor.benchmarks({ persist: req.method === 'POST' });
        return res.json({ ok: true, benchmarks: out });
      }

      // ── CALENDAR ─────────────────────────────────────────────────────────
      case 'calendar': {
        const filters = { slot_date: `gte.${req.query.from || core.todayIso()}` };
        if (req.query.market) filters.market = `eq.${req.query.market}`;
        const rows = await core.db().select('smart_calendar', { limit: 1500, order: 'slot_date.asc', filters });
        return res.json({ ok: true, slots: rows });
      }
      case 'calendar-generate': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await calendar.generate({ startDate: b.start_date, days: b.days, persist: true, regenerate: b.regenerate === true });
        await core.logRun('manual', { calendar_generate: { created: out.created } }, true);
        return res.json(out);
      }
      case 'calendar-review': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await calendar.dailyReview({ persist: true });
        return res.json(out);
      }
      case 'festivals': {
        const rows = await core.db().select('smart_festivals', { limit: 500, order: 'mmdd.asc' });
        return res.json({ ok: true, festivals: rows });
      }
      case 'festivals-extract': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await calendar.extractFestivals({ persist: true });
        return res.json({ ok: true, detected: out.length, festivals: out });
      }
      case 'feedback': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const row = {
          target_type: b.target_type || 'calendar_slot', target_id: b.target_id,
          verdict: b.verdict || 'comment', notes: b.notes || '', reviewer: b.reviewer || null,
        };
        await core.db().insert('smart_feedback', [row]);
        return res.json({ ok: true, feedback: row, applied_at: 'next daily review' });
      }
      case 'mvt': {
        if (req.method === 'POST') {
          await core.db().insert('smart_mvt_results', [{
            slot_id: b.slot_id || null, campaign_id: b.campaign_id || null,
            variant: b.variant || 'A', dimension: b.dimension || 'hook',
            metrics: b.metrics || {}, winner: b.winner === true, learned: b.learned || {},
          }]);
          const applied = await calendar.applyMvt({ persist: true });
          return res.json({ ok: true, recorded: true, weights: applied });
        }
        const rows = await core.db().select('smart_mvt_results', { limit: 200, order: 'created_at.desc' });
        return res.json({ ok: true, results: rows });
      }

      // ── GENERATION ───────────────────────────────────────────────────────
      case 'generate': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!b.slot_id) return res.status(400).json({ ok: false, error: 'slot_id required' });
        const out = await generate.generateForSlot(b.slot_id, { persist: true });
        return res.json(out);
      }
      case 'assets': {
        const filters = {};
        if (req.query.slot) filters.slot_id = `eq.${req.query.slot}`;
        const rows = await core.db().select('smart_generated_assets', { select: 'id,slot_id,type,name,meta,created_at,generated_campaign_id', limit: 500, order: 'created_at.desc', filters });
        return res.json({ ok: true, assets: rows });
      }
      case 'asset': {
        const rows = await core.db().select('smart_generated_assets', { filters: { id: `eq.${req.query.id}` }, limit: 1 });
        if (!rows[0]) return res.status(404).json({ ok: false, error: 'asset not found' });
        if (req.query.raw === '1' && /html/.test(rows[0].type)) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.status(200).send(rows[0].content || '');
        }
        return res.json({ ok: true, asset: rows[0] });
      }
      case 'campaigns': {
        const filters = {};
        if (req.query.status) filters.status = `eq.${req.query.status}`;
        const rows = await core.db().select('smart_generated_campaigns', { limit: 500, order: 'created_at.desc', filters });
        return res.json({ ok: true, campaigns: rows });
      }

      // ── REVIEW (HITL) ────────────────────────────────────────────────────
      case 'review': {
        const out = await review.queue({ state: req.query.state || 'pending' });
        return res.json({ ok: true, ...out });
      }
      case 'decide': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await review.decide({ queueId: b.queue_id, itemId: b.item_id, decision: b.decision, reviewer: b.reviewer, notes: b.notes });
        return res.json(out);
      }
      case 'recalibrate': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await review.recalibrate({ reviewer: b.reviewer, decisions: b.decisions || [], configPatches: b.config || {} });
        await core.logRun('weekly', { recalibration: out }, true);
        return res.json(out);
      }
      case 'confidence': {
        const rows = await core.db().select('smart_confidence', { limit: 20 });
        return res.json({ ok: true, confidence: rows, recalibration: await review.recalibrationStatus() });
      }

      // ── AGENTS ───────────────────────────────────────────────────────────
      case 'agents': {
        // A phone sign-in's agents live on its device (agent.html); the agent
        // table belongs to workspaces, so it lists none of them - structurally,
        // not by relying on the table's workspace scope (Bugbot, 2026-10-03).
        if (__auth && __auth.ok && __auth.provider === 'mobile-pin' && __auth.mode !== 'supabase') return res.json({ ok: true, agents: [], storage: 'device' });
        return res.json({ ok: true, agents: await agents.listAgents() });
      }
      // A PHONE SIGN-IN'S AGENTS ARE KEPT ON ITS DEVICE (2026-10-03): it has
      // no workspace for smart_agents rows, so the definition is built and
      // handed back (agent.html keeps it), and a turn carries the agent, the
      // brand and the catalogue it may recommend (brain-agent deviceChat).
      case 'agent-upsert': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (__auth && __auth.ok && __auth.provider === 'mobile-pin' && __auth.mode !== 'supabase') {
          if (!String(b.name || '').trim()) return res.status(400).json({ ok: false, error: 'name_required', message: 'Give the agent a name, then save it.' });
          return res.json({ ok: true, storage: 'device', agent: agents.agentRow(Object.assign({}, b, { name: String(b.name).trim().slice(0, 80) })), note: 'Kept on this device: this sign-in has no workspace in a database to file the agent in.' });
        }
        const a = await agents.upsertAgent(b);
        return res.json({ ok: true, agent: a });
      }
      case 'agent-sync': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (__auth && __auth.ok && __auth.provider === 'mobile-pin' && __auth.mode !== 'supabase') {
          return res.json({ ok: true, storage: 'device', agent: String(b.agent_id || ''), knowledge_items: 0,
            note: 'An agent kept on this device answers from the brand record and the catalogue carried with each turn, so there is no knowledge table to fill for it.' });
        }
        const out = await agents.syncKnowledge(b.agent_id || 'agent_knickgasm');
        return res.json({ ok: true, ...out });
      }
      case 'agent-chat': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!b.message) return res.status(400).json({ ok: false, error: 'message required' });
        if (__auth && __auth.ok && __auth.provider === 'mobile-pin' && __auth.mode !== 'supabase') {
          return res.json(await agents.deviceChat({ agent: b.agent, agentId: b.agent_id, brand: req.__brand, catalog: b.catalog, message: b.message, history: b.history || [], sessionId: b.session_id }));
        }
        const out = await agents.chat({ agentId: b.agent_id || 'agent_knickgasm', sessionId: b.session_id, message: b.message, context: b.context || {}, history: b.history || [] });
        return res.json(out);
      }
      case 'agent-analyze': {
        // Natural-language analytical question → EXACT figures from own-data.
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!b.message) return res.status(400).json({ ok: false, error: 'message required' });
        const out = await agents.analyze({ message: b.message });
        return res.json(out);
      }
      case 'team-chat': {
        // INTERNAL employee copilot — full data scope (revenue/cohorts/strategy).
        // Distinct from buyer-facing agent-chat; never used on a buyer surface.
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!b.message) return res.status(400).json({ ok: false, error: 'message required' });
        const out = await agents.teamChat({ sessionId: b.session_id, message: b.message, context: b.context || {}, history: b.history || [] });
        return res.json(out);
      }
      case 'agent-sessions': {
        const filters = {};
        if (req.query.agent) filters.agent_id = `eq.${req.query.agent}`;
        const rows = await core.db().select('smart_agent_sessions', { limit: 200, order: 'started_at.desc', filters });
        return res.json({ ok: true, sessions: rows });
      }

      case 'jarvis': {
        // "Knickgasm Jarvis" — turn an assistant reply + user text into in-app /
        // storefront navigation actions (product PDPs + tool routes). _shared/jarvis.js.
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        // The ACTIVE brand decides which catalogue may be searched for product
        // links and which storefront may be linked. Without it every workspace's
        // assistant offered to open tenant zero's PDPs on tenant zero's domain.
        // With no workspace, the brand the request RESOLVED decides: the record
        // a phone account carried, or the unresolved placeholder for a page
        // nobody is signed in to - never "no brand", which jarvis reads as
        // tenant zero's storefront map (2026-09-29, review).
        const noWsBrand = req.__brand && (req.__brand.carried === true || req.__brand.unresolved === true) ? req.__brand : null;
        const navBrand = req.__workspaceId
          ? await require('./_shared/workspace-scope.js').brandForWorkspace({
            url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
            key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
          }, req.__workspaceId).catch(() => null)
          : noWsBrand;
        const actions = jarvis.detectNavActions(
          b.userText || b.user_text || b.message || '',
          b.assistantText || b.assistant_text || b.reply || '',
          { market: b.market || __homeMarket(), brand: navBrand }
        );
        return res.json({ ok: true, actions });
      }

      case 'agentic-run': {
        // Dual-mode AGENTIC flow: 8 traced stages (data→analysis→planning→
        // calendar→content→asset→review→ideation). tier 'budget'|'maxpower'.
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await agentic.runAgentic({
          market: b.market || __homeMarket(),
          brief: b.brief || b.theme || '',
          tier: b.tier || 'maxpower',
          days: b.days ? parseInt(b.days, 10) : undefined,
          withCreatives: b.withCreatives != null ? b.withCreatives : true,
          maxRetries: b.maxRetries != null ? b.maxRetries : 1,
        });
        return res.json(out);
      }

      case 'calendar-scenarios': {
        // 5-scenario calendar: best / medium(default) / conservative / emergency / instant.
        const market = b.market || req.query.market || __homeMarket();
        const tier = b.tier || req.query.tier || 'maxpower';
        const cfg = smartbrain.smartConfig();
        const sdb = new smartbrain.SmartBrainDbAdapter(cfg);
        const ownData = await sdb.ownData();
        const competitor = new smartbrain.CompetitorBenchmarkingService(cfg).benchmark(await sdb.competitorData());
        const kb = new smartbrain.KnowledgeBaseService(cfg).build(ownData);
        const analysis = new smartbrain.AnalysisService(cfg).analyze(kb, ownData);
        const days = parseInt(req.query.days || b.days || '0', 10) || undefined;
        const cal = new smartbrain.CalendarIntelligenceService(cfg).generate({ analysis, competitorBenchmarks: competitor, days, feedback: ownData.feedback });
        const sc = await calendarScenarios.buildScenarios({ analysis, baseCalendar: cal, market, tier });
        return res.json({ ok: true, calendar: { days: cal.days, entries: (cal.entries || []).length }, default: sc.default, scenarios: sc.scenarios });
      }

      // ── KicksGPT — the brand LLM (tool-calling chat over the whole stack) ──
      case 'brand-chat': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!b.message) return res.status(400).json({ ok: false, error: 'message required' });
        // The brand this request resolved to rides along, so a caller with no
        // workspace row (a mobile+PIN account, whose record travels with the
        // request) is answered as ITS brand rather than as tenant zero's.
        const out = await brandLlm.chat({ message: b.message, history: b.history || [], market: b.market || (b.context && b.context.market) || __homeMarket(), workspaceId: req.__workspaceId || null, brand: req.__brand || null });
        return res.json(out);
      }
      case 'brand-tools': {
        return res.json({ ok: true, brand: { name: brandLlm.BRAND_LLM_NAME, tagline: brandLlm.BRAND_LLM_TAGLINE }, tools: brandLlm.toolManifest(), klaviyo_connected: klaviyo.isConnected() });
      }

      // ── KLAVIYO (lifecycle email/SMS — scaffolded until KLAVIYO_API_KEY set) ──
      case 'klaviyo': {
        const op = b.op || req.query.op || 'status';
        const params = req.method === 'POST' ? b : Object.assign({}, req.query);
        // A brand that connected its own Klaviyo account reads THAT account.
        // Resolved from the caller's session, so two brands on one deployment
        // never see each other's audiences. Null falls back to the deployment
        // key exactly as before.
        const creds = await require('./_shared/workspace-connections-core.js').credentialsFor(req, 'klaviyo');
        const out = await klaviyo.dispatch(op, params, creds);
        return res.json(out);
      }

      // ── AD INSIGHTS (real Meta/Google/TikTok reporting; priority metrics first) ──
      case 'ad-insights': {
        const p = req.method === 'POST' ? b : Object.assign({}, req.query);
        const op = p.op || 'summary';
        if (op === 'status') return res.json(adInsights.status(p.market));
        const args = { market: p.market, level: p.level, since: p.since, until: p.until };
        const out = (op === 'platform' && p.platform)
          ? await adInsights.insights({ platform: p.platform, ...args })
          : await adInsights.summary(args);
        return res.json(out);
      }

      // ── ADS ANALYSIS (findings, not figures) ─────────────────────────────
      // ad-insights FETCHES rows. This turns them into observations, actions
      // and a per-creative read. Every finding quotes the figures that produced
      // it and names the entity they came from; a rule that cannot cite a
      // number emits nothing. Outliers are judged against THIS account's own
      // median, never an industry benchmark we have not verified.
      case 'ads-analysis': {
        const p = req.method === 'POST' ? b : Object.assign({}, req.query);
        const view = String(p.view || 'all');
        const args = { market: p.market, level: p.level || 'ad', since: p.since, until: p.until };
        const src = p.platform
          ? await adInsights.insights({ platform: p.platform, ...args })
          : await adInsights.summary(args);

        // Keep every platform's blocker verbatim. A disconnected platform has
        // to reach the UI as its own reason: an empty table reads as "no
        // activity", which is a different and much more expensive claim.
        const rows = [];
        const blockers = [];
        const pushFrom = (o) => {
          if (!o) return;
          if (Array.isArray(o.rows)) rows.push(...o.rows);
          if (o.connected === false || o.not_connected) {
            blockers.push({
              platform: o.platform || 'unknown',
              blocker: o.hint || o.blocker || 'not connected',
              need_env: o.need_env || [],
              would_request: o.would_request || o.would_query || null,
            });
          }
        };
        if (Array.isArray(src.platforms)) src.platforms.forEach(pushFrom); else pushFrom(src);

        const engine = require('./_shared/ads-insight-engine.js');
        const payload = {
          ok: true,
          market: args.market || __homeMarket(),
          level: args.level,
          window: src.window || null,
          fetched_at: new Date().toISOString(),
          rows_analysed: rows.length,
          blockers,
          connected: rows.length > 0,
        };
        if (view === 'insights' || view === 'all') Object.assign(payload, engine.deriveInsights(rows));
        if (view === 'actionables' || view === 'all') Object.assign(payload, engine.deriveActionables(rows));
        if (view === 'creative' || view === 'all') Object.assign(payload, engine.deriveCreativeAnalysis(rows));
        return res.json(payload);
      }

      // ── ADS FROM SNOWFLAKE (live warehouse tables; cohort/segmentation) ──
      case 'ads-snowflake': {
        const p = req.method === 'POST' ? b : Object.assign({}, req.query);
        const op = p.op || 'status';
        if (op === 'status') return res.json(adsSnowflake.status());
        if (op === 'ping') return res.json(await adsSnowflake.ping());
        if (op === 'budgets') return res.json(adsSnowflake.budgets());
        if (op === 'describe') return res.json(await adsSnowflake.describe({ platform: p.platform, level: p.level }));
        // The configured ad feeds and the KPI each can honestly be judged on
        // (see adSources() in the core). There is no bundled account registry:
        // a feed exists only when the deployment names its warehouse table.
        if (op === 'accounts') return res.json(await adsSnowflake.accounts({ since: p.since, until: p.until, accounts: p.accounts }));
        if (op === 'multi-daily') return res.json(await adsSnowflake.multiDaily({ since: p.since, until: p.until, accounts: p.accounts, by: p.by }));
        if (op === 'campaigns') return res.json(await adsSnowflake.campaigns({ since: p.since, until: p.until, account: p.account, level: p.level }));
        if (op === 'cohort') return res.json(await adsSnowflake.cohort({ platform: p.platform, dimension: p.dimension, measure: p.measure, account: p.account, since: p.since, until: p.until, level: p.level }));
        return res.json(await adsSnowflake.metrics({ platform: p.platform, account: p.account, since: p.since, until: p.until, level: p.level, limit: p.limit }));
      }

      // ── LIVE ADS (real-time link to the Meta ad account) ──────────────────
      // Powers the Master Dashboard's Live Now / Calendar / Tracker views.
      // Meta Marketing API first (minute-fresh), else the Snowflake per-day
      // mirror, else a not_connected envelope carrying the exact query.
      case 'ads-live': {
        const p = req.method === 'POST' ? b : Object.assign({}, req.query);
        const op = p.op || 'today';
        if (op === 'status') return res.json(adsLive.status());
        if (op === 'daily') return res.json(await adsLive.daily({ since: p.since, until: p.until, account: p.account }));
        if (op === 'calendar') return res.json(await adsLive.calendar({ month: p.month, account: p.account }));
        return res.json(await adsLive.today({ account: p.account }));
      }

      // ── SOP ENFORCEMENT (nomenclature compliance + spend pacing) ──────────
      // Scores the LIVE warehouse names against the final Ad Campaign SOP and
      // paces real daily spend against its caps. Read-only.
      case 'ads-sop': {
        const p = req.method === 'POST' ? b : Object.assign({}, req.query);
        const op = p.op || 'reference';
        if (op === 'reference') return res.json({ ok: true, sop: adsSop.reference() });
        if (op === 'pacing') return res.json(await adsSop.pacing({ since: p.since, until: p.until, account: p.account }));
        if (op === 'parse') return res.json({ ok: true, campaign: adsSop.parseCampaignName(p.campaign || ''), adset: adsSop.parseAdSetName(p.adset || ''), ad: adsSop.parseAdName(p.ad || '') });
        return res.json(await adsSop.compliance({ since: p.since, until: p.until, platform: p.platform, account: p.account, limit: p.limit }));
      }

      // ── AD METRICS CATALOG + ACCURACY (single source of truth for formulas) ──
      case 'ad-metrics': {
        const p = req.method === 'POST' ? b : Object.assign({}, req.query);
        const op = p.op || 'catalog';
        if (op === 'catalog') return res.json(adMetrics.catalog());
        if (op === 'accuracy') return res.json(adMetrics.accuracy(p.rows || []));
        if (op === 'compute') {
          const rows = (p.rows || []).map((r) => ({ row: r, metrics: adMetrics.computeAll(r) }));
          return res.json({ ok: true, count: rows.length, computed: rows, accuracy: adMetrics.accuracy(p.rows || []) });
        }
        return res.json({ ok: false, error: 'Unknown op. Use catalog|compute|accuracy.' });
      }

      // ── WEBENGAGE ──────────────────────────────────────────────────────────
      // Drain the WebEngage → Supabase Storage dumps into webengage_events. The
      // scheduled path is CRON_SECRET-guarded (call twice daily off the same
      // 12h cron); reads (campaign/cohort/event performance) are open.
      case 'webengage-sync': {
        if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized (run via cron with CRON_SECRET, or pass ?secret=)' });
        const out = await webengage.syncFromStorage({ bucket: req.query.bucket });
        return res.json(out);
      }
      /* ═══ Omnichannel dispatch + deliverability ═══════════════════════════
         Mounted here rather than as new function files: the Hobby plan caps
         serverless functions at 12 and this deployment is at 12. All the logic
         lives in api/_shared/, which is excluded from that count. */

      case 'dispatch-enqueue': {
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        if (!__wsId) return res.status(409).json({ ok: false, error: 'no_active_brand', message: 'Activate a brand before publishing.' });
        // The brand the copy is linted as is the one resolved for this
        // workspace here, never one the body names (compliance-lint.js).
        const out = await require('./_shared/dispatch-core.js').enqueue(auth, __wsId, b, { brand: req.__brand || null });
        return res.status(out.ok ? 200 : 409).json(out);
      }

      case 'dispatch-drain': {
        // The queue drains under the scheduler OR on demand from the console.
        // A signed-in editor may drain their OWN workspace; only the scheduler
        // may drain every workspace at once.
        const dispatch = require('./_shared/dispatch-core.js');
        if (cronAuthorized(req)) {
          return res.json(await dispatch.drain({ workspaceId: req.query.workspace_id || null }));
        }
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        if (!__wsId) return res.status(409).json({ ok: false, error: 'no_active_brand' });
        await require('./_shared/brand-workspace-core.js').assertCanWrite(auth, __wsId, 'run the dispatch queue');
        return res.json(await dispatch.drain({ workspaceId: __wsId }));
      }

      case 'dispatch-list':
      case 'dispatch-detail':
      case 'dispatch-cancel': {
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        // A phone sign-in's brand is on its device and has no dispatch queue on
        // the server: its log is EMPTY, which is the true answer, not a refusal
        // painted as "Dispatch jobs could not be loaded" (2026-10-03).
        if (!__wsId && auth.provider === 'mobile-pin' && auth.mode !== 'supabase' && action === 'dispatch-list') {
          return res.json({ ok: true, jobs: [], storage: 'device', note: 'Nothing has been queued for this brand: it is kept on this device, and sending goes through platform accounts connected to a brand workspace on the server.' });
        }
        if (!__wsId) return res.status(409).json({ ok: false, error: 'no_active_brand', message: 'There is no dispatch queue for this brand on the server, so there was nothing to read or cancel.' });
        const dispatch = require('./_shared/dispatch-core.js');
        if (action === 'dispatch-list') return res.json({ ok: true, jobs: await dispatch.listJobs(auth, __wsId, { status: req.query.status, limit: req.query.limit }) });
        if (action === 'dispatch-detail') return res.json({ ok: true, detail: await dispatch.jobDetail(auth, __wsId, String(req.query.id || b.id || '')) });
        return res.json(await dispatch.cancel(auth, __wsId, String(b.id || req.query.id || '')));
      }

      // dispatch-webhook is routed ABOVE the switch, before body(req) runs.
      // See the comment there and _shared/platform-webhooks.js.

      // ── Social Integration Gateway (2026-10-04) ─────────────────────────
      // Read + update for Meta, TikTok, Pinterest, YouTube (and the existing
      // Google Ads adapter): status, reads, the inbox of verified webhook
      // events, underperformance flags, thresholds and LIVE APPROVAL. Every
      // write it starts is a dispatch job behind the three switches. A signed
      // in caller only; the workspace is the one scoping resolved for them.
      case 'social-gateway': {
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        return await require('./_shared/social-gateway-core.js').handle(req, res, { auth, workspaceId: __wsId, body: b });
      }

      case 'deliverability-domain': {
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        const deliver = require('./_shared/deliverability-core.js');
        const domain = String(b.domain || req.query.domain || '');
        const out = await deliver.auditDomain(domain, { selectors: b.selectors || [] });
        if (out.ok && __wsId) {
          // Persist so the dashboard and the preflight gate read the same audit
          // rather than each running their own and disagreeing.
          await require('./_shared/brand-workspace-core.js').restAs(auth.token, 'domain_health_profiles?on_conflict=workspace_id,domain,role', {
            method: 'POST',
            body: [{
              workspace_id: __wsId, domain: out.domain, role: 'sending',
              spf: out.records[0], dkim: out.records[1], dmarc: out.records[2], mx: out.records[3], bimi: out.records[4],
              blacklists: out.blacklists, reputation: out.reputation,
              score: out.score, score_breakdown: out.score_breakdown, grade: out.grade,
              last_checked_at: out.checked_at, updated_at: out.checked_at,
            }],
            prefer: 'resolution=merge-duplicates,return=minimal',
          }).catch(() => { /* the audit is still returned */ });
        }
        return res.json(out);
      }

      case 'deliverability-preflight': {
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        // Brand, approved claims and offer are the SERVER's: a body that named
        // its own brand or approved its own claims would pick its own rule pack.
        // And the brand must be THIS workspace's: resolve() answers tenant
        // zero when it cannot read one, which would lint a supplement's copy
        // as a sneaker brand's. With no workspace, only a brand the request
        // carried as its own (a device brand) is used.
        const dispatchCore = require('./_shared/dispatch-core.js');
        const pfBrand = __wsId
          ? await dispatchCore.trustedBrand(__wsId, req.__brand)
          : (req.__brand && req.__brand.carried === true ? req.__brand : null);
        // The offer is the one the queue will read: the named campaign's
        // record in THIS workspace (the page sends the asset as `payload`),
        // so preflight and enqueue measure a deadline line against the same
        // value, and it is never the body's own.
        const pfOffer = __wsId
          ? await dispatchCore.campaignOffer(__wsId, { campaign_id: b.campaign_id, asset_ref: b.asset_ref, asset: b.payload })
          : null;
        return res.json(await require('./_shared/preflight-core.js').run(Object.assign({ workspaceId: __wsId }, b, {
          brand: pfBrand, approved_claims: undefined, offer: pfOffer || undefined,
          // Deadline lines are read when the mail goes out, as at the queue.
          now: dispatchCore.readAt(b.mode, b.scheduled_for) || undefined,
          require_brand: undefined,
        })));
      }

      case 'deliverability-warmup': {
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        const deliver = require('./_shared/deliverability-core.js');
        if ((b.op || req.query.op) === 'safety') {
          return res.json(deliver.evaluateWarmupSafety(b.stats || {}, b.limits || {}));
        }
        const plan = deliver.buildWarmupPlan({ startOn: b.start_on, targetDaily: b.target_daily, days: b.days });
        return res.json({ ok: true, plan, target_daily: b.target_daily, days: plan.length });
      }

      case 'cohort-optimize': {
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        const engine = require('./_shared/cohort-engine.js');
        const out = engine.analyseAudience(b.contacts || [], {
          messagePriority: b.message_priority || 'promotional',
          inactiveDays: Number(b.inactive_days) || 180,
        });
        // The per-contact rows can be large and carry pseudonymous ids; the
        // caller asks for them explicitly rather than getting them by default.
        if (!b.include_contacts) delete out.scored;
        return res.json(Object.assign({ ok: true }, out));
      }

      case 'connectors-health': {
        // REAL live probe of every data platform (Shopify/Klaviyo/WebEngage/
        // Supabase) — actual round-trips, honest live/blocked + the exact blocker.
        const health = require('./_shared/connectors-health.js');
        return res.json(await health.health());
      }
      case 'webengage-report': {
        const op = (req.query.op || 'campaigns').toLowerCase();
        const hours = parseInt(req.query.hours || '24', 10) || 24;
        const market = req.query.market || null;
        const out = op === 'summary'
          ? await webengage.eventSummary({ hours, market })
          : await webengage.campaignPerformance({ event: req.query.event || 'Notification Clicked', hours, market });
        return res.json(out);
      }

      // ── VIDEO (Veo 3.1 → Sora 2 → Higgsfield → Runway cascade — stubs until keys set) ──
      case 'video-generate': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!b.prompt) return res.status(400).json({ ok: false, error: 'prompt required' });
        const out = await video.generateVideo({
          prompt: b.prompt,
          duration_s: b.duration_s || b.duration || 8,
          aspect: b.aspect || '16:9',
          tier: b.tier || 'premium',
        });
        return res.json(out);
      }
      case 'video-status': {
        const provider = req.query.provider || b.provider;
        const jobId = req.query.job_id || b.job_id;
        if (!provider || !jobId) return res.status(400).json({ ok: false, error: 'provider and job_id required' });
        const out = await video.getVideoStatus({ provider, job_id: jobId });
        return res.json(out);
      }

      // ── MAILER ASSET AGENT (fill embedded IMAGE/VIDEO/GIF prompts — asset-agent.js) ──
      case 'mailer-assets': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const assetAgent = require('./_shared/asset-agent.js');
        let html = b.html;
        let entryId = b.entry_id || null;
        if (!html && entryId) {
          const build = require('./_shared/lifecycle-mailer-build.js');
          const built = await build.buildLifecycleMailer({ id: entryId });
          const v = built && built.mailer && (built.mailer.variants.find((x) => x.key === 'visual_a') || built.mailer);
          html = v && v.html;
        }
        if (!html) return res.status(400).json({ ok: false, error: 'pass html or an entry_id that builds a mailer' });
        const out = await assetAgent.fillMailerAssets(html, {
          tier: b.tier || 'premium', market: b.market || 'UK', persist: b.persist !== false,
          video: b.video !== false, gif: b.gif !== false,
        });
        return res.json({ ...out, entry_id: entryId });
      }
      case 'mailer-assets-status': {
        // Poll a pending video/gif job started during mailer-assets.
        const provider = req.query.provider || b.provider;
        const jobId = req.query.job_id || b.job_id;
        if (!provider || !jobId) return res.status(400).json({ ok: false, error: 'provider and job_id required' });
        const out = await video.getVideoStatus({ provider, job_id: jobId });
        if (out && out.status === 'completed' && out.video_url && (req.query.as === 'gif' || b.as === 'gif')) {
          const gifCore = require('./_shared/gif-core.js');
          const g = await gifCore.convertFromVideo({ video_url: out.video_url });
          return res.json({ ...out, gif: g });
        }
        return res.json(out);
      }

      // ── SOCIAL MEDIA OS (daily multi-agent post pipeline — _shared/social-core.js) ──
      case 'social-run-daily': {
        // POST from the console; GET only for the daily cron (/api/cron/social
        // rewrite) — guarded exactly like ?action=cron.
        if (req.method !== 'POST' && !cronAuthorized(req)) {
          return res.status(401).json({ ok: false, error: 'unauthorized (POST from the console, or cron with CRON_SECRET)' });
        }
        // Pin the catalogue for the whole pipeline, the same way buildCampaign
        // does. Without it social-core's image lookups run with no scope and
        // resolve against whatever the sync fallback allows.
        const bcs = require('./_shared/brand-catalog-server.js');
        const out = await bcs.withCatalog(
          { brand: req.__brand || null, workspaceId: req.__workspaceId || null },
          () => social.runDaily({
            brand: req.__brand || null,
            workspaceId: req.__workspaceId || null,
            date: b.date || req.query.date,
            platforms: b.platforms,
            dry_run: b.dry_run === true || req.query.dry_run === '1',
          }),
        );
        return res.json(out);
      }
      case 'social-list': {
        const out = await social.listPosts({ date: req.query.date, from: req.query.from, to: req.query.to });
        return res.json(out);
      }
      case 'social-approve': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await social.setStatus(b.id, 'approved');
        return res.status(out.ok ? 200 : 400).json(out);
      }
      case 'social-skip': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await social.setStatus(b.id, 'skipped');
        return res.status(out.ok ? 200 : 400).json(out);
      }

      // ── TTS (ElevenLabs proxy — premium voice for the agents; clients fall
      //    back to browser speechSynthesis when not configured) ─────────────
      case 'tts': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) return res.status(501).json({ ok: false, error: 'ELEVENLABS_API_KEY not configured — client should use browser speechSynthesis fallback' });
        const voiceId = b.voice_id || process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', 'xi-api-key': apiKey },
          body: JSON.stringify({ text: String(b.text || '').slice(0, 2400), model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
        });
        if (!r.ok) return res.status(502).json({ ok: false, error: `ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}` });
        const buf = Buffer.from(await r.arrayBuffer());
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.status(200).send(buf);
      }

      // ── CONSOLE (chat-style brain interface) ─────────────────────────────
      case 'console-chat': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!callLLM) return res.json({ ok: true, reply: 'LLM provider not configured — set GEMINI_API_KEY (free) or another provider in Vercel env. All brain data endpoints still work.' });
        // Assemble live brain context
        const [status, daily, recal] = await Promise.all([
          core.db().select('smart_calendar', { select: 'slot_date,market,channel,theme,angle,status', limit: 60, order: 'slot_date.asc', filters: { slot_date: `gte.${core.todayIso()}` } }).catch(() => []),
          analysis.runDaily({ persist: false }).catch(() => null),
          review.recalibrationStatus().catch(() => null),
        ]);
        const sys = `You are the KNICKGASM Smart Brain console — the conversational interface to a lifecycle-marketing automation system (like ChatGPT, but grounded in THIS system's live data). Answer the operator's question using the context below. Be specific with numbers. If asked to act, tell them exactly which button/endpoint does it (e.g. "Generate assets" on a slot → POST /api/brain?action=generate). Keep replies tight.

LIVE CONTEXT
Daily analysis: ${daily ? JSON.stringify(daily.summary) : 'unavailable'}
Top angle patterns: ${daily ? JSON.stringify((daily.patterns.angle || []).slice(0, 4)) : '[]'}
Next 60 calendar slots: ${JSON.stringify(status)}
Weekly recalibration: ${JSON.stringify(recal)}`;
        let reply = '';
        try {
          const out = await callLLM({ systemPrompt: sys, userMessage: String(b.message || ''), maxTokens: 700, temperature: 0.4, timeoutMs: 35000, stage: 'console' });
          reply = (typeof out === 'string' ? out : out.text || '').trim();
        } catch (e) { reply = `Provider error: ${e.message}. Data endpoints remain available.`; }
        return res.json({ ok: true, reply });
      }

      // ── ALERTS (revenue/number monitoring by email — _shared/alerts-core.js) ──
      // Anomaly runs NOW on real monthly market data. Pulse/EOD degrade cleanly
      // until INTRADAY_FEED_READY=1 (needs the live Shopify/Klaviyo feed, B3).
      // All three are CRON_SECRET-guarded (they can send email + are scheduled
      // by GitHub Actions), same gate as the daily loop.
      case 'alerts-anomaly':
      case 'alerts-pulse':
      case 'alerts-eod': {
        if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
        const kind = action === 'alerts-anomaly' ? 'anomaly' : (action === 'alerts-pulse' ? 'pulse' : 'eod');
        const out = await alerts.run(kind);
        return res.json(out);
      }
      case 'alerts-preview': {
        // Read-only: what anomalies WOULD fire right now (no email). Open — no
        // secret needed, sends nothing, useful from the dashboard/console.
        //
        // The anomalies are computed from data/analytics/market-data.js, the
        // export compiled into this build. That export is TENANT ZERO'S store,
        // so this endpoint was quietly reporting one company's revenue swings,
        // by market and by month, to every signed-in brand.
        const _mkt = require('./_shared/market-analytics.js');
        if (!(await _mkt.ownsBundledExport())) {
          return res.json({
            ok: true, kind: 'anomaly-preview', anomalies: [], thresholds: alerts.TH,
            data_scope: { level: 'other_workspace', basis: 'unset' },
            note: _mkt.BUNDLED_OWNER_NOTE,
          });
        }
        return res.json({ ok: true, kind: 'anomaly-preview', anomalies: alerts.detectAnomalies(), thresholds: alerts.TH, recipient: alerts.ALERT_EMAIL() });
      }

      // ── ACCESS AUDIT NARRATIVE (strictly read-only) ─────────────────────
      // Turns the CLIENT-derived audit findings into an executive summary.
      // Reads only the posted report; issues no Shopify call, no mutation.
      case 'access-narrative': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const report = b.report || {};
        if (!callLLM) return res.json({ ok: true, narrative: '' });
        const policy = [
          'You are writing an executive summary for a STRICTLY READ-ONLY Shopify access and application audit.',
          'Rules: never suggest mutations, --allow-mutations, or write_* scopes; never tell anyone to invite/suspend/remove users or install/uninstall apps as if you are doing it.',
          'Produce findings and recommendations ONLY, for a human to approve and implement separately.',
          'Clearly separate observed fact, inferred finding, missing evidence, and recommended action.',
          'Do not invent team, agency, purpose, cost, or justification data that is not in the report.',
        ].join(' ');
        const sys = policy + '\n\nWrite a concise executive summary (200-350 words): headline risk posture, the most material access findings, the most material app/cost findings, the estimated avoidable annual run-rate, and the top 5 prioritised recommendations. Use plain hyphens, no em dashes.';
        let narrative = '';
        try {
          const out = await callLLM({ systemPrompt: sys, userMessage: 'AUDIT REPORT JSON:\n' + JSON.stringify(report).slice(0, 12000), maxTokens: 800, temperature: 0.3, timeoutMs: 35000, stage: 'access-audit' });
          narrative = (typeof out === 'string' ? out : out.text || '').trim();
        } catch (e) { return res.json({ ok: false, error: 'Provider error: ' + e.message }); }
        return res.json({ ok: true, narrative });
      }

      // ── SNOWFLAKE → SUPABASE MIRROR ──────────────────────────────────────
      // Webhook / pub-sub trigger for the daily Snowflake pull. Also runs off
      // the daily ?action=cron (below) so no 3rd Hobby-limited cron is added.
      // Guarded exactly like ?action=cron. Returns a typed stub until
      // SNOWFLAKE_* env is set (klaviyo-style { connected:false }).
      case 'snowflake-sync': {
        if (!snowflake) return res.status(501).json({ ok: false, error: 'snowflake core unavailable' });
        if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
        return res.json(await snowflake.runSync({ region: (req.query || {}).region, source: b.source || 'manual' }));
      }
      // What the Knickgasm3DConnectorEngine reads for its historical/metric tier.
      case 'snowflake-metrics': {
        if (!snowflake) return res.status(501).json({ ok: false, error: 'snowflake core unavailable' });
        const out = await snowflake.readMirror({
          region: String((req.query || {}).region || 'global').toLowerCase(),
          metric: String((req.query || {}).metric || ''),
          window: String((req.query || {}).window || ''),
        });
        // ok:false has to WIN the merge: the core reports ok:true (it ran) with
        // connected:false, and merging it last put ok:true in a 501 body.
        if (!out.ok || !out.connected) return res.status(501).json(Object.assign({}, out, { ok: false }));
        return res.json({ ok: true, rows: out.rows });
      }

      // ── CRON: the daily automated loop ───────────────────────────────────
      case 'cron': {
        if (!cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
        const started = Date.now();
        const steps = {};
        // STEP 0 — pull fresh READ-ONLY data from the source platforms into
        // Supabase FIRST, so every downstream step (analysis, planning, asset
        // regeneration) uses the data for the day. runDailyJob runs the Klaviyo
        // read-only sync adapter (and future Shopify/WebEngage adapters).
        try { steps.os_daily = await osb.runDailyJob('cron'); } catch (e) { steps.os_daily = { error: e.message }; }
        try { steps.festivals = { detected: (await calendar.extractFestivals({ persist: true })).length }; } catch (e) { steps.festivals = { error: e.message }; }
        try { const r = await calendar.dailyReview({ persist: true }); steps.daily_review = { changes: r.review.changes.length, pass_rate: r.daily_summary.pass_rate }; } catch (e) { steps.daily_review = { error: e.message }; }
        try { steps.benchmarks = { ok: true, markets: Object.keys(await competitor.benchmarks({ persist: true })).filter((k) => k !== '_advisory') }; } catch (e) { steps.benchmarks = { error: e.message }; }
        try { steps.auto_approve = await review.autoApproveSweep(); } catch (e) { steps.auto_approve = { error: e.message }; }
        // auto-generate assets for approved slots within 3 days
        try {
          const soon = core.addDays(core.todayIso(), 3);
          const slots = await core.db().select('smart_calendar', { limit: 20, filters: { status: 'eq.approved', slot_date: `lte.${soon}` } });
          let generated = 0;
          for (const s of slots.slice(0, 5)) { // cap per run for serverless time budget
            try { await generate.generateForSlot(s.id, { persist: true }); generated++; } catch (_) {}
          }
          steps.generation = { approved_due: slots.length, generated };
        } catch (e) { steps.generation = { error: e.message }; }
        const recal = await review.recalibrationStatus().catch(() => null);
        steps.weekly_recalibration_gate = recal;
        // (os_daily read-only data pull now runs FIRST — see STEP 0 above.)
        // Smart Brain rolling plan (smart_calendar_entries): refresh the 90-day
        // window, then kick the convergent background prebuild chain so every slot
        // keeps its FULL asset bundle (LLM copy + images) prebuilt ahead of need.
        // Runs off this existing daily cron to avoid adding a Hobby-limited 3rd cron.
        try {
          const sbplan = require('./_shared/smart-brain-plan.js');
          const sync = await sbplan.syncDaily({ persist: true });
          let prebuildKicked = false;
          const base = process.env.SELF_BASE_URL ? String(process.env.SELF_BASE_URL).replace(/\/$/, '')
            : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
          if (base && typeof fetch === 'function') {
            const secret = process.env.CRON_SECRET || '';
            const headers = { 'Content-Type': 'application/json' };
            if (secret) headers.Authorization = `Bearer ${secret}`;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 3000);
            try { await fetch(`${base}/api/calendar?action=smart-brain-prebuild`, { method: 'POST', headers, body: JSON.stringify({ _depth: 1 }), signal: ctrl.signal }); }
            catch (_) { /* child runs longer than our handoff window — expected */ }
            finally { clearTimeout(timer); }
            prebuildKicked = true;
          }
          steps.smart_brain_plan = { synced: true, mode: sync.mode, changes: (sync.changes || []).length, prebuild_kicked: prebuildKicked };
        } catch (e) { steps.smart_brain_plan = { error: e.message }; }
        // Competitor universe: keep every active brand's competitor set current.
        // Seeds a brand that has none from its OWN record, then runs a discovery
        // pass and adds whatever is genuinely new, de-duplicated by domain.
        // Rides this existing daily cron because the Hobby plan allows two and
        // both are taken. The budget is small per run and workspaces are taken
        // least-recently-refreshed first, so brands are covered in rotation
        // rather than one brand consuming the whole slot.
        try {
          const universe = require('./_shared/competitor-universe.js');
          const sweep = await universe.refreshDueWorkspaces({ maxWorkspaces: 3 });
          steps.competitor_universe = { due: sweep.due, refreshed: sweep.refreshed, added: sweep.added, note: sweep.note };
        } catch (e) { steps.competitor_universe = { error: e.message }; }
        // Social gateway tokens (2026-10-04): every OAuth connection whose
        // token expires within 7 days is refreshed through its platform's own
        // documented flow; a refusal marks it needs_reauth for the hub. Rides
        // this cron because both Hobby crons are taken.
        try { steps.social_tokens = await require('./_shared/social-gateway-core.js').refreshDueTokens({ withinDays: 7 }); }
        catch (e) { steps.social_tokens = { error: e.message }; }
        // Snowflake → Supabase daily mirror (historical/deep metrics for the
        // Knickgasm3DConnectorEngine). No-op stub when SNOWFLAKE_* env is unset.
        try { steps.snowflake_sync = snowflake ? await snowflake.runSync({ source: 'cron' }) : { skipped: true }; }
        catch (e) { steps.snowflake_sync = { error: e.message }; }
        const summary = { steps, ms: Date.now() - started };
        await core.logRun('cron', summary, true);
        return res.json({ ok: true, ...summary });
      }

      // ── LIFECYCLE OS BACKBONE (connectors / jobs / activity / dashboard) ──
      case 'domain': {
        // Suggest, verify and assess a sending domain. ?op=suggest|check|readiness
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        const di = require('./_shared/domain-intel.js');
        const op = String(req.query.op || b.op || 'suggest').toLowerCase();

        if (op === 'check') {
          const list = Array.isArray(b.domains) ? b.domains : String(req.query.domains || b.domain || '').split(',').map((x) => x.trim()).filter(Boolean);
          return res.json(await di.checkMany(list, { limit: 12 }));
        }
        if (op === 'readiness') {
          return res.json(await di.sendingReadiness(String(req.query.domain || b.domain || '')));
        }

        let brand = null;
        if (__wsId) {
          const wsScope = require('./_shared/workspace-scope.js');
          brand = await wsScope.brandForWorkspace({
            url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
            key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
          }, __wsId).catch(() => null);
        }
        const tlds = String(req.query.tlds || b.tlds || 'com').split(',').map((x) => x.trim()).filter(Boolean);
        return res.json(di.suggest(brand, { tlds, count: Number(req.query.count || b.count) || 12 }));
      }

      case 'logo': {
        // Build the brief from the brand record. Generation itself goes through
        // the existing image cascade on /api/ai/image, which is where the
        // credit metering and the provider waterfall already live.
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        let brand = null;
        if (__wsId) {
          const wsScope = require('./_shared/workspace-scope.js');
          brand = await wsScope.brandForWorkspace({
            url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
            key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
          }, __wsId).catch(() => null);
        }
        const brief = require('./_shared/logo-brief.js').logoBrief(brand, {
          style: req.query.style || b.style || 'mark',
          notes: req.query.notes || b.notes || '',
        });
        return res.status(brief.ok ? 200 : 409).json(brief);
      }

      case 'daily-calendar': {
        // One row per DAY across past, today and future: what was planned,
        // which assets exist for it, and what was measured.
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        return res.json(await require('./_shared/daily-calendar-core.js').dayCalendar({
          market: req.query.market || b.market || __homeMarket(),
          back: Number(req.query.back || b.back) || 14,
          forward: Number(req.query.forward || b.forward) || 30,
          workspaceId: __wsId || null,
        }));
      }

      case 'revenue-analysis': {
        // One combined revenue read across region, channel, platform, campaign,
        // mailer, landing page, product, cohort and time. Every cut declares its
        // own provenance.
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        return res.json(await require('./_shared/revenue-analysis-core.js').revenue({
          market: req.query.market || b.market || __homeMarket(),
          days: Number(req.query.days || b.days) || 30,
          since: req.query.since || b.since,
          until: req.query.until || b.until,
        }));
      }

      case 'agent-builder': {
        // OpenAPI 3.0 spec + execution bridge for Google Vertex AI Agent Builder.
        // Auth is its OWN key (x-agent-key), not a Supabase session: the caller
        // is Google's agent runtime, not a browser.
        const ab = require('./_shared/agent-builder-core.js');
        const op = String(req.query.op || b.op || 'spec').toLowerCase();
        if (op === 'spec') {
          // No workspace: the resolved record if it names a brand the caller
          // carried, else the unresolved placeholder (no brand name in the spec).
          let brand = req.__brand && (req.__brand.carried === true || req.__brand.unresolved === true) ? req.__brand : null;
          if (__wsId) {
            const wsScope = require('./_shared/workspace-scope.js');
            brand = await wsScope.brandForWorkspace({
              url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
              key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
            }, __wsId).catch(() => null);
          }
          const origin = req.headers && (req.headers['x-forwarded-host'] || req.headers.host)
            ? `https://${req.headers['x-forwarded-host'] || req.headers.host}` : '';
          const spec = ab.openApiSpec({ origin, brand });
          return res.status(spec && spec.ok === false ? 503 : 200).json(spec);
        }
        // Every other op executes a registry tool, and it authorises on the
        // agent key rather than a browser session.
        const gate = ab.authorize(req);
        if (!gate.ok) return res.status(gate.status || 401).json(gate);
        if (op === 'status') return res.json(ab.status());
        return res.json(await ab.runTool(String(req.query.tool || b.tool || ''), b || {}));
      }

      case 'platform-agents': {
        // One analyst agent per platform. ?op=all (default) or ?platform=<id>.
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        const pa = require('./_shared/platform-agents-core.js');
        // The analyst is told WHOSE numbers these are. Resolved from the active
        // workspace; never defaulted to a brand.
        let brand = null;
        if (__wsId) {
          const wsScope = require('./_shared/workspace-scope.js');
          brand = await wsScope.brandForWorkspace({
            url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
            key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
          }, __wsId).catch(() => null);
        }
        const shared = {
          market: req.query.market || b.market || __homeMarket(),
          days: Number(req.query.days || b.days) || 30,
          question: req.query.question || b.question || '',
          tier: req.query.tier || b.tier || 'standard',
          brand,
        };
        const one = req.query.platform || b.platform;
        return res.json(one ? await pa.runAgent(one, shared) : await pa.runAll(Object.assign({ platforms: req.query.platforms || b.platforms }, shared)));
      }

      case 'journey': {
        // Link-by-link attribution across platforms. The join key is the link,
        // because it is the only identifier every platform actually writes.
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        return res.json(await require('./_shared/journey-core.js').linkLedger({
          market: req.query.market || b.market || __homeMarket(),
          days: Number(req.query.days || b.days) || 90,
          since: req.query.since || b.since,
          until: req.query.until || b.until,
        }));
      }

      case 'shopify': {
        // LIVE read-only Admin reads for the ACTIVE workspace's own store.
        // ?op=shop|orders|products|customers|inventory|summary|attribution|status
        const auth = await require('./_shared/brand-workspace-core.js').requireUser(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        const sc = require('./_shared/shopify-core.js');
        const op = String(req.query.op || b.op || 'summary').toLowerCase();
        return res.json(await sc.dispatch(op, {
          market: req.query.market || b.market || __homeMarket(),
          days: Number(req.query.days || b.days) || undefined,
          limit: Number(req.query.limit || b.limit) || undefined,
        }));
      }

      case 'os-connectors':
        return res.json({ ok: true, ...(await osb.listConnectors()) });
      case 'os-connector-sync': {
        const id = String((req.query || {}).id || b.id || '').trim();
        if (!id) return res.status(400).json({ ok: false, error: 'connector id required (?id=)' });
        return res.json({ ok: true, ...(await osb.syncConnector(id, 'manual')) });
      }
      case 'os-run-daily-job': {
        // Manual trigger is open; the scheduled path is CRON_SECRET-guarded.
        const viaCron = (req.query || {}).cron === '1' || String(req.headers['user-agent'] || '').includes('vercel-cron');
        if (viaCron && !cronAuthorized(req)) return res.status(401).json({ ok: false, error: 'unauthorized' });
        return res.json({ ok: true, ...(await osb.runDailyJob(viaCron ? 'cron' : 'manual')) });
      }
      case 'os-dashboard':
        return res.json({ ok: true, ...(await osb.dashboard()) });

      default:
        return res.status(400).json({ ok: false, error: 'Unknown action', actions: ['status', 'config', 'kb', 'kb-patterns', 'analyze', 'cohorts', 'library', 'scores', 'benchmarks', 'calendar', 'calendar-generate', 'calendar-review', 'festivals', 'festivals-extract', 'feedback', 'mvt', 'generate', 'assets', 'asset', 'campaigns', 'review', 'decide', 'recalibrate', 'confidence', 'agents', 'agent-upsert', 'agent-sync', 'agent-chat', 'agent-analyze', 'team-chat', 'agent-sessions', 'brand-chat', 'brand-tools', 'klaviyo', 'webengage-sync', 'webengage-report', 'video-generate', 'video-status', 'mailer-assets', 'mailer-assets-status', 'social-run-daily', 'social-list', 'social-approve', 'social-skip', 'console-chat', 'alerts-anomaly', 'alerts-pulse', 'alerts-eod', 'alerts-preview', 'access-narrative', 'snowflake-sync', 'snowflake-metrics', 'cron', 'os-connectors', 'os-connector-sync', 'os-run-daily-job', 'os-dashboard'] });
    }
  } catch (err) {
    console.error('[api/brain]', action, err);
    return res.status(failureStatus(err)).json(failurePayload(action, err));
  }
};

/**
 * What a thrown error becomes (2026-09-29). Every failure used to be a 500
 * carrying `error: err.message` and nothing else - a PostgREST 401 from a
 * paused project, a core's own 403 refusal and a genuine crash all arrived
 * the same way, and the pages printed whichever raw string came back. Three
 * kinds now, each with a `message` the page can show as a sentence:
 *   a refusal a core raised with its own status (err.status 4xx) keeps that
 *   status and its code; a store that did not answer (a linked-db / supabase
 *   failure, a DNS or connection error) is 503 backend_unreachable, naming
 *   the host that has to change; everything else is the 500 it always was,
 *   with `error` still the raw message so an existing reader loses nothing.
 */
function failureStatus(err) {
  const s = Number(err && err.status) || 0;
  if (s >= 400 && s < 500) return s;
  return storeDown(err) ? 503 : 500;
}
function storeDown(err) {
  const msg = String((err && err.message) || err || '');
  return /linked-db (select|insert|upsert|update|delete)|supabase (get|post|patch|delete) .* -> \d{3}|fetch failed|econnrefused|enotfound|getaddrinfo|network call escaped/i.test(msg);
}
function failurePayload(action, err) {
  const msg = String((err && err.message) || err || 'unknown error');
  const s = Number(err && err.status) || 0;
  if (s >= 400 && s < 500) {
    return { ok: false, action, error: (err && err.code) || 'request_refused', message: msg };
  }
  if (storeDown(err)) {
    let host = '';
    try { host = new URL(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname; } catch (_) { host = ''; }
    return {
      ok: false, action, error: 'backend_unreachable', backend_unreachable: true,
      message: `The workspace database this deployment points at${host ? ` (${host})` : ''} did not answer, so "${action}" could not run and nothing was saved. `
        + 'Its Supabase project has most likely been paused, renamed or deleted.',
      detail: msg.slice(0, 300),
    };
  }
  return { ok: false, action, error: msg, message: `"${action}" failed on the server before it could answer, and nothing was saved. Reported as: ${msg.slice(0, 200)}` };
}

// ── Metering (2026-09-29, review) ────────────────────────────────────────
// The model actions (MODEL_FEATURE above) are metered like calendar.js,
// generate.js and image.js always were: a hold before the handler runs, a
// settle on a 2xx that carried a real result, a full refund otherwise. The
// meter's own session check is what refuses an anonymous caller (401) and an
// unlisted phone number (403, before any wallet exists). Two requests are
// never metered: the scheduler's (it has no wallet) and an unattributed page's
// - the attribution rule answers that one with a refusal or demo data before
// any core runs, so there is nothing to charge for and a 401 from the meter
// would replace the sentence that says what to do.
const _credits = require('./_shared/credits-core.js');
const _brainHandler = module.exports;
const _meteredBrain = _credits.metered(_brainHandler, (req, b) => {
  const action = String((req.query || {}).action || '').toLowerCase();
  const key = modelFeature(action, req);
  if (!key) return null;
  if (schedulerBearer(req)) return null;
  if (unattributedShape(req, b)) return null;
  return key;
}, (req, b) => {
  // audio.tts is priced per 1,000 characters actually synthesised (the
  // handler sends at most 2,400); everything else is one unit.
  const action = String((req.query || {}).action || '').toLowerCase();
  if (action === 'tts') return Math.max(1, Math.ceil(Math.min(2400, String((b && b.text) || '').length) / 1000));
  return undefined;
}, {
  // A 200 that carries no result is not a result: a refusal in the payload,
  // the bundled export's "not yours" note, or the demo envelope refunds.
  successIf: (p) => !(p && typeof p === 'object' && (p.ok === false
    || (p.data_scope && p.data_scope.level === 'other_workspace')
    || p.mode === 'demo')),
});
// The wrapper reads req.body to price a request, and a platform webhook must
// reach its verifier with the body UNREAD (see dispatch-webhook above). Only
// a model action - decided from the query and the method alone - goes
// through the meter; every other request reaches the router untouched.
module.exports = function brainRouter(req, res) {
  const action = String(((req && req.query) || {}).action || '').toLowerCase();
  if (req && req.method !== 'OPTIONS' && modelFeature(action, req)) {
    // The meter may answer before the router's own header block runs; its
    // refusal carries the sentence a page shows, so it carries CORS too.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Lifecycle-Token');
    res.setHeader('Cache-Control', 'no-store');
    return _meteredBrain(req, res);
  }
  return _brainHandler(req, res);
};

// Everything this handler calls runs inside the request scope, so llm.js can
// resolve THIS caller's workspace model routing and keys without every one of
// the hundred-odd call sites having to pass `req` down to it. See
// api/_shared/request-scope.js for why an ambient variable would not do.
module.exports = require('./_shared/request-scope.js').wrap(module.exports);
