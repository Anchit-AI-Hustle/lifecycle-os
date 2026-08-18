'use strict';
/**
 * require-caller.js — who is allowed to spend this deployment's provider budget.
 * ---------------------------------------------------------------------------
 * `api/ai/generate.js` and `api/ai/image.js` shipped with
 * `Access-Control-Allow-Origin: *` and NO inbound authentication at all. The
 * only `Authorization` strings in image.js were OUTBOUND headers to the
 * providers, which is what made the gap easy to miss on a grep.
 *
 * The repository is public, so the routes are discoverable from source, and a
 * plain unauthenticated POST reaches the full six-provider cascade in llm.js -
 * OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, XAI_API_KEY,
 * GROQ_API_KEY, CEREBRAS_API_KEY. Anyone who found the URL could spend the
 * budget until a card declined.
 *
 * A caller must now be one of:
 *   - a signed-in user (Supabase JWT, verified against /auth/v1/user), or
 *   - the deployment's own scheduler (CRON_SECRET bearer).
 *
 * ── What this does NOT do ──────────────────────────────────────────────────
 * The in-memory limiter below is per warm instance, not global. Vercel runs
 * many instances, so it is a brake on one abusive caller, NOT a quota. Real
 * per-account quota belongs with the credits ledger (credits.meter()), which
 * already has the atomic Postgres path for it. Stated plainly here rather than
 * left to be assumed, because "we have rate limiting" is exactly the kind of
 * belief that stops someone adding the real thing.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const core = require('./brand-workspace-core.js');

/* Per-instance sliding window. Bounded map: an unbounded one is its own denial
   of service, since the key is attacker-controlled. */
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;
const MAX_KEYS = 5000;
const hits = new Map();

function tooMany(key) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  if (hits.size > MAX_KEYS) hits.clear();      // cheap reset beats unbounded growth
  hits.set(key, arr);
  return arr.length > MAX_PER_WINDOW;
}

function bearer(req) {
  const h = (req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

/** The deployment's own scheduler, not a person. */
function isCron(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const t = bearer(req) || String((req.query && req.query.cron_secret) || '');
  // Length check first so a comparison never leaks length via timing.
  return t.length === secret.length && t === secret;
}

/**
 * Gate an AI route. Returns true when the request may proceed; otherwise it has
 * already written the response.
 *
 *   if (!(await requireCaller(req, res))) return;
 */
async function requireCaller(req, res, opts) {
  const o = opts || {};

  // CORS: the browser callers are this app's own pages. A wildcard was what
  // made the unauthenticated route usable from anywhere, so it goes with the
  // auth fix rather than being left behind as "harmless".
  const origin = String((req.headers && (req.headers.origin || req.headers.Origin)) || '');
  const allowed = allowedOrigin(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }

  if (isCron(req)) return true;

  const auth = await core.requireUser(req);
  if (!auth || !auth.ok) {
    res.status(auth && auth.status === 503 ? 503 : 401).json({
      ok: false,
      error: (auth && auth.error) || 'sign_in_required',
      hint: 'These endpoints spend this deployment\'s AI provider budget, so they require a signed-in session (Authorization: Bearer <Supabase access token>) or the scheduler secret.',
    });
    return false;
  }

  if (tooMany(auth.user_id || 'anon')) {
    res.status(429).json({
      ok: false,
      error: 'rate_limited',
      hint: `More than ${MAX_PER_WINDOW} generation requests in a minute from this account. This is a per-instance brake, not a quota - per-account quota is metered in credits.`,
    });
    return false;
  }

  req.__caller = auth;
  if (o.attachWorkspace !== false) {
    try { req.__workspaceId = req.__workspaceId || String((req.query && req.query.workspace_id) || ''); } catch (_) { /* optional */ }
  }
  return true;
}

/* Same-origin plus the deployment's own hosts. An unknown origin gets no CORS
   header at all, which blocks the browser case without pretending to be a
   security boundary for non-browser callers - those are stopped by the JWT. */
function allowedOrigin(origin) {
  if (!origin) return '';
  let host;
  try { host = new URL(origin).host.toLowerCase(); } catch (_) { return ''; }
  const self = String(process.env.VERCEL_URL || '').toLowerCase();
  if (self && host === self) return origin;
  if (/(^|\.)anchit-tandon\.com$/.test(host)) return origin;
  if (/(^|\.)vercel\.app$/.test(host)) return origin;
  if (/^localhost(:\d+)?$/.test(host) || /^127\.0\.0\.1(:\d+)?$/.test(host)) return origin;
  return '';
}

module.exports = { requireCaller, isCron, allowedOrigin, MAX_PER_WINDOW, WINDOW_MS };
