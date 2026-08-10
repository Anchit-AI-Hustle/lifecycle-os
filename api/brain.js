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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = String((req.query || {}).action || '').toLowerCase();
  const b = body(req);

  // ── Workspace scoping (same contract as api/calendar.js) ──────────────────
  // Resolve ONCE per request: explicit param, else the caller's JWT -> their
  // active workspace, else the default only for userless (cron) calls. An
  // unattributed BROWSER request is refused rather than served the default
  // workspace's data.
  let __wsId = null;
  try {
    const wsScope = require('./_shared/workspace-scope.js');
    const scopeEnv = {
      url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
    };
    __wsId = await wsScope.resolve(scopeEnv, req);
    const q0 = (req && req.query) || {};
    const b0 = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const hadExplicit = !!(q0.workspace_id || b0.workspace_id);
    const hadAuth = !!(req.headers && (req.headers.authorization || req.headers.Authorization));
    const fromBrowser = !!(req.headers && (req.headers.origin || req.headers.referer));
    if (!hadExplicit && !hadAuth && fromBrowser) {
      return res.status(200).json({
        ok: true, error: 'workspace_unresolved', items: [], entries: [], brands: [], posts: [],
        note: 'This request arrived without an active workspace, so no data is returned. Another brand\'s workspace is never substituted. Hard-refresh the page and try again.',
      });
    }
    req.__workspaceId = __wsId;
    if (req.query) req.query.workspace_id = req.query.workspace_id || __wsId || undefined;
  } catch (_) { /* scoping must never hard-fail the router */ }

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
        return res.json({ ok: true, agents: await agents.listAgents() });
      }
      case 'agent-upsert': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const a = await agents.upsertAgent(b);
        return res.json({ ok: true, agent: a });
      }
      case 'agent-sync': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await agents.syncKnowledge(b.agent_id || 'agent_knickgasm');
        return res.json({ ok: true, ...out });
      }
      case 'agent-chat': {
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        if (!b.message) return res.status(400).json({ ok: false, error: 'message required' });
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
        const actions = jarvis.detectNavActions(
          b.userText || b.user_text || b.message || '',
          b.assistantText || b.assistant_text || b.reply || '',
          { market: b.market || 'US' }
        );
        return res.json({ ok: true, actions });
      }

      case 'agentic-run': {
        // Dual-mode AGENTIC flow: 8 traced stages (data→analysis→planning→
        // calendar→content→asset→review→ideation). tier 'budget'|'maxpower'.
        if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
        const out = await agentic.runAgentic({
          market: b.market || 'US',
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
        const market = b.market || req.query.market || 'US';
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
        const out = await brandLlm.chat({ message: b.message, history: b.history || [], market: b.market || (b.context && b.context.market) || 'US', workspaceId: req.__workspaceId || null });
        return res.json(out);
      }
      case 'brand-tools': {
        return res.json({ ok: true, brand: { name: brandLlm.BRAND_LLM_NAME, tagline: brandLlm.BRAND_LLM_TAGLINE }, tools: brandLlm.toolManifest(), klaviyo_connected: klaviyo.isConnected() });
      }

      // ── KLAVIYO (lifecycle email/SMS — scaffolded until KLAVIYO_API_KEY set) ──
      case 'klaviyo': {
        const op = b.op || req.query.op || 'status';
        const params = req.method === 'POST' ? b : Object.assign({}, req.query);
        const out = await klaviyo.dispatch(op, params);
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

      // ── ADS FROM SNOWFLAKE (live warehouse tables; cohort/segmentation) ──
      case 'ads-snowflake': {
        const p = req.method === 'POST' ? b : Object.assign({}, req.query);
        const op = p.op || 'status';
        if (op === 'status') return res.json(adsSnowflake.status());
        if (op === 'ping') return res.json(await adsSnowflake.ping());
        if (op === 'budgets') return res.json(adsSnowflake.budgets());
        if (op === 'describe') return res.json(await adsSnowflake.describe({ platform: p.platform, level: p.level }));
        // The ad-account studio: every account, what it is used for, and the KPI
        // it can honestly be judged on (see adAccounts() in the core).
        if (op === 'accounts') return res.json(await adsSnowflake.accounts({ since: p.since, until: p.until, accounts: p.accounts }));
        if (op === 'multi-daily') return res.json(await adsSnowflake.multiDaily({ since: p.since, until: p.until, accounts: p.accounts, by: p.by }));
        if (op === 'campaigns') return res.json(await adsSnowflake.campaigns({ since: p.since, until: p.until, account: p.account, level: p.level }));
        // Retail funnel: spend in MAPLEMONK joined to outcomes in MAPLEMONK1 (Target
        // Roundel attributed sales + real Target store sell-through). The only way
        // to answer "is the Target programme working" — the Meta retail account has
        // no pixel, so on its own it can only ever look like cost.
        if (op === 'retail-funnel') return res.json(await adsSnowflake.retailFunnel({ since: p.since, until: p.until, by: p.by }));
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
        const out = await social.runDaily({
          workspaceId: req.__workspaceId || null,
          date: b.date || req.query.date,
          platforms: b.platforms,
          dry_run: b.dry_run === true || req.query.dry_run === '1',
        });
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
        if (!out.ok || !out.connected) return res.status(501).json(Object.assign({ ok: false }, out));
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
        // Snowflake → Supabase daily mirror (historical/deep metrics for the
        // Knickgasm3DConnectorEngine). No-op stub when SNOWFLAKE_* env is unset.
        try { steps.snowflake_sync = snowflake ? await snowflake.runSync({ source: 'cron' }) : { skipped: true }; }
        catch (e) { steps.snowflake_sync = { error: e.message }; }
        const summary = { steps, ms: Date.now() - started };
        await core.logRun('cron', summary, true);
        return res.json({ ok: true, ...summary });
      }

      // ── LIFECYCLE OS BACKBONE (connectors / jobs / activity / dashboard) ──
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
    return res.status(500).json({ ok: false, action, error: err.message });
  }
};
