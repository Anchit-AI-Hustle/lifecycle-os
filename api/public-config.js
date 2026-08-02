'use strict';

/**
 * /api/public-config
 *
 * Public bootstrap config plus cap-free read-only/operational routers that live
 * in api/_shared. Keeping Data Analysis here avoids adding a thirteenth Vercel
 * serverless function on the Hobby plan.
 */

const fs = require('fs');
const path = require('path');

function linkedDb() {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'linked-db.json'), 'utf8')); }
  catch (_) { return {}; }
}

// Privileged modes (pipeline / probe, and the detailed health payload) must not
// be world-readable: they disclose which providers/keys/models are configured,
// and `probe` additionally SPENDS quota by calling every provider — unauthed
// that is a free quota-drain vector. Gate them behind the same operator check
// the data-analysis routes use (CRON_SECRET, or a Supabase user on an allowed
// email domain), and never answer them with wildcard CORS.
async function requireOperator(req, res) {
  const { authorize } = require('./_shared/data-analysis-core.js');
  const auth = await authorize(req);
  if (!auth.ok) {
    res.status(auth.status || 401).json({
      ok: false,
      error: auth.error || 'operator_session_required',
      hint: 'Operator-only endpoint. Send Authorization: Bearer <Supabase access token of an allowed operator> or the CRON_SECRET.',
    });
    return null;
  }
  return auth;
}

// Same-origin/allowlisted origins only for privileged modes (no wildcard).
const ORIGIN_ALLOW = /^https?:\/\/(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|[a-z0-9-]+\.vercel\.app|([a-z0-9-]+\.)?anchit-tandon\.com)$/i;
function lockCors(req, res) {
  const origin = String((req.headers && req.headers.origin) || '');
  if (origin && ORIGIN_ALLOW.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  else res.removeHeader('Access-Control-Allow-Origin');
  res.setHeader('Vary', 'Origin');
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Unified Data Analysis API. Reads are available to the authenticated app;
  // writes/runs verify either a KNICKGASM Supabase user or CRON_SECRET.
  const wantsDataAnalysis = req.query && req.query.action === 'data-analysis';
  if (wantsDataAnalysis) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const core = require('./_shared/data-analysis-core.js');
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (req.method === 'POST') {
        const op = String(body.op || req.query.op || '').toLowerCase();
        if (op === 'run-hourly') {
          const auth = await core.authorize(req, { cron: true });
          if (!auth.ok) return res.status(auth.status || 401).json(auth);
          return res.status(200).json(await core.runHourly({ force: Boolean(body.force), trigger: auth.kind || 'cron' }));
        }
        const auth = await core.authorize(req);
        if (!auth.ok) return res.status(auth.status || 401).json(auth);
        if (op === 'save-alert-settings') return res.status(200).json(await core.saveSettings(body.settings || {}, auth.email));
        if (op === 'test-alert') return res.status(200).json({ ok: true, result: await core.testAlert(body.settings || {}) });
        return res.status(400).json({ ok: false, error: 'unknown_data_analysis_operation', available: ['run-hourly', 'save-alert-settings', 'test-alert'] });
      }
      const auth = await core.authorize(req);
      if (!auth.ok) return res.status(auth.status || 401).json(auth);
      const params = {
        market: req.query.market || 'US', level: req.query.level || 'ad',
        since: req.query.since, until: req.query.until,
        hours: req.query.hours ? Number(req.query.hours) : undefined,
      };
      return res.status(200).json(await core.view(req.query.view || 'status', params));
    } catch (e) {
      return res.status(200).json({ ok: false, error: 'data_analysis_failed', message: String(e && e.message || e) });
    }
  }

  // Real-time data-accuracy validator.
  const wantsValidate = req.query && (req.query.action === 'validate-data' || req.query.validate !== undefined);
  if (wantsValidate) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { validate } = require('./_shared/data-validation-core.js');
      const narrative = !(req.query.narrative === '0' || req.query.narrative === 'false');
      return res.status(200).json(await validate({ narrative }));
    } catch (e) {
      return res.status(200).json({ ok: false, error: 'validation_failed', message: String(e && e.message || e), checks: [] });
    }
  }

  // Pipeline health mode — OPERATOR ONLY (discloses which provider keys and
  // models are configured).
  if (req.query && req.query.pipeline !== undefined) {
    res.setHeader('Cache-Control', 'no-store');
    lockCors(req, res);
    if (!(await requireOperator(req, res))) return;
    const keys = {
      openai: !!process.env.OPENAI_API_KEY, openai2: !!process.env.OPENAI_API_KEY_2, openai3: !!process.env.OPENAI_API_KEY_3,
      anthropic: !!process.env.ANTHROPIC_API_KEY, gemini: !!process.env.GEMINI_API_KEY, grok: !!process.env.XAI_API_KEY,
      groq: !!process.env.GROQ_API_KEY, cerebras: !!process.env.CEREBRAS_API_KEY,
    };
    const tiers = [keys.openai && 'OpenAI', keys.anthropic && 'Anthropic/Claude', keys.gemini && 'Gemini', keys.grok && 'Grok/xAI', keys.groq && 'Groq', keys.cerebras && 'Cerebras'].filter(Boolean);
    const hasProvider = tiers.length > 0;
    return res.status(200).json({
      ok: hasProvider, stage: 'health',
      checks: {
        endpoint_reachable: true, openai_key_set: keys.openai, openai_key_2_set: keys.openai2, openai_key_3_set: keys.openai3,
        openai_keys_total: [keys.openai, keys.openai2, keys.openai3].filter(Boolean).length,
        anthropic_key_set: keys.anthropic, gemini_key_set: keys.gemini, grok_key_set: keys.grok,
        provider_tiers_active: tiers.length, at_least_one_provider: hasProvider,
        image_model: keys.openai ? (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2 (default)') : 'Pollinations FLUX (free — no OpenAI key)',
        text_model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini (default)', node_version: process.version, timestamp: new Date().toISOString(),
      },
      warnings: hasProvider ? [] : ['CRITICAL: No AI provider keys configured. Set at least GEMINI_API_KEY (free) or OPENAI_API_KEY in Vercel env.'],
      verdict: hasProvider ? 'Pipeline ready · ' + tiers.join(' → ') : 'BLOCKED: No LLM provider configured.',
    });
  }

  // Live provider probe — OPERATOR ONLY. This one both discloses provider
  // state AND spends real quota (one live call per provider), so it must never
  // be reachable anonymously.
  if (req.query && req.query.probe !== undefined) {
    res.setHeader('Cache-Control', 'no-store');
    lockCors(req, res);
    if (!(await requireOperator(req, res))) return;
    const callLLM = require('./_shared/llm.js');
    const PROVIDERS = [
      { id: 'anthropic', label: 'Anthropic / Claude', env: 'ANTHROPIC_API_KEY', gen: 'https://console.anthropic.com/settings/keys' },
      { id: 'openai', label: 'OpenAI', env: 'OPENAI_API_KEY', gen: 'https://platform.openai.com/api-keys' },
      { id: 'gemini', label: 'Google Gemini', env: 'GEMINI_API_KEY', gen: 'https://aistudio.google.com/apikey' },
      { id: 'grok', label: 'xAI / Grok', env: 'XAI_API_KEY', gen: 'https://console.x.ai' },
      { id: 'groq', label: 'Groq (free)', env: 'GROQ_API_KEY', gen: 'https://console.groq.com/keys' },
      { id: 'cerebras', label: 'Cerebras (free)', env: 'CEREBRAS_API_KEY', gen: 'https://cloud.cerebras.ai' },
      { id: 'openrouter', label: 'OpenRouter (gateway → Claude/GPT/…)', env: 'OPENROUTER_API_KEY', gen: 'https://openrouter.ai/credits' },
      { id: 'github', label: 'GitHub Models (free GPT-4o/Llama)', env: 'GITHUB_MODELS_TOKEN', gen: 'https://github.com/settings/tokens' },
      { id: 'cloudflare', label: 'Cloudflare Workers AI (free daily)', env: 'CLOUDFLARE_API_TOKEN', gen: 'https://dash.cloudflare.com/profile/api-tokens' },
    ];
    const keyPresent = (id) => id === 'openai'
      ? !!(process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_2 || process.env.OPENAI_API_KEY_3)
      : id === 'openrouter' ? !!(process.env.OPENROUTER_API_KEY || process.env.OpenRouter_API_KEY)
        : id === 'github' ? !!(process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN)
          : id === 'cloudflare' ? !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
            : !!process.env[PROVIDERS.find((p) => p.id === id).env];
    const withCap = (promise, ms) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('probe_cap'), { _providerErrors: [{ status: 0, err: 'probe time cap' }] })), ms))]);
    const results = await Promise.all(PROVIDERS.map(async (p) => {
      if (!keyPresent(p.id)) return { provider: p.id, label: p.label, configured: false, ok: false, verdict: 'not configured', generate_key_at: p.gen };
      try {
        const r = await withCap(callLLM({ systemPrompt: 'Reply with the single word: ok', userMessage: 'ping', maxTokens: 64, temperature: 0, timeoutMs: 4500, stage: 'probe', preferProvider: p.id }), 6500);
        return { provider: p.id, label: p.label, configured: true, ok: true, model: r.model, verdict: 'ok — answered' };
      } catch (e) {
        const det = (e && e._providerErrors && e._providerErrors[0]) || {};
        const status = det.status;
        const verdict = status === 429 || status === 402 ? 'rate-limited / quota exhausted (429)'
          : status === 401 || status === 403 ? 'bad or unauthorized key (401/403)'
            : status === 404 ? 'model not found for this account (404)'
              : status === 0 ? 'timeout / network' : 'failed (' + (status || '?') + ')';
        return { provider: p.id, label: p.label, configured: true, ok: false, status, verdict, detail: String(det.err || (e && e.message) || '').substring(0, 160) };
      }
    }));
    const working = results.filter((r) => r.ok);
    return res.status(200).json({
      ok: working.length > 0, probe: 'live', ts: new Date().toISOString(), env: process.env.VERCEL_ENV || 'unknown',
      working_providers: working.map((r) => r.provider),
      summary: working.length ? working.length + ' provider(s) answering: ' + working.map((r) => r.provider).join(', ') : 'NO provider answered — this is why copy fell back to the template. Fix the providers below (add a key or clear quota).',
      providers: results,
    });
  }

  // Health mode. PUBLIC surface is liveness ONLY (ok/build/ts) — enough for the
  // footer status dot and uptime monitors, and it discloses nothing about which
  // providers, keys, models, region or environment are configured. The detailed
  // payload is returned only to an authenticated operator.
  if (req.query && req.query.health !== undefined) {
    res.setHeader('Cache-Control', 'no-store');
    const bearerPresent = !!(req.headers && req.headers.authorization);
    if (!bearerPresent) {
      return res.status(200).json({ ok: true, build: 'lifecycle-os', ts: new Date().toISOString() });
    }
    lockCors(req, res);
    if (!(await requireOperator(req, res))) return;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const hasSupabase = !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    return res.status(200).json({
      ok: true, build: 'lifecycle-os', ts: new Date().toISOString(), region: process.env.VERCEL_REGION || 'unknown', env: process.env.VERCEL_ENV || 'unknown',
      providers: {
        text: { active: hasOpenAI ? 'openai' : (hasGemini ? 'gemini' : 'none'), openai_configured: hasOpenAI, gemini_configured: hasGemini },
        image: { active: hasOpenAI ? 'openai' : 'pollinations', pollinations_available: true },
        storage: { supabase_configured: hasSupabase },
      },
    });
  }

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  const ldb = linkedDb();
  return res.status(200).json({
    supabase: {
      url: ldb.url || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      anonKey: ldb.anonKey || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    },
    app: { name: 'KNICKGASM Lifecycle OS', version: '1.0.0', regions: ['US', 'UK', 'Global', 'IN'] },
    flags: { real_facts_only: String(process.env.REAL_FACTS_ONLY || '') === '1' },
  });
};
