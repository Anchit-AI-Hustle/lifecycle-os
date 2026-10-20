'use strict';
/**
 * agent-embed.js - a brand's agent on the brand's OWN website (2026-10-14).
 *
 * The operator: "brand will need to be able to export the agent and set it up
 * on their official website - only then will it be of any use". The widget
 * (/agent-widget.js) existed but could not answer anyone there: every reply
 * needs a signed-in caller, and a visitor to the brand's site is nobody's
 * session. This module is the one door a visitor's message comes through.
 *
 * The decisions (the operator chose "brand's credits, daily cap"):
 *   - WHO PAYS: the brand. Each reply is one `assistant.chat` (the catalog's
 *     price), held and settled on the workspace OWNER's wallet for that
 *     workspace - the wallet the brand's credit pill shows. A failed reply is
 *     released (refunded) like every other metered call.
 *   - HOW MUCH: at most `daily_cap` replies a day (UTC), default 300, set by an
 *     owner or editor (op=embed-settings). Counted from the ledger's holds, so
 *     a reply that failed still counts towards the day (conservative).
 *   - WHERE: only on the brand's own website - the request's Origin must be
 *     the same brand as the record's website by the coherence rule's
 *     sameBrand() (nike.in / nike.com), or this deployment's own pages (the
 *     preview on /agent). An Origin is a browser's claim, not a proof: a
 *     script can send any header, which is why the cap and the per-address
 *     limit exist, and why a visitor's reply never reads more than the agent's
 *     buyer-facing scope.
 *   - WHAT: the brand's agent (smart_agents row of THAT workspace, active),
 *     answering through the same buyer-facing chat the /agent page uses.
 * Not a function file (api/_shared/); mounted on brain.js ?action=agent-public
 * and ?action=agent-embed (still 12/12).
 */

const DEFAULT_DAILY_CAP = 300;
const MAX_DAILY_CAP = 20000;
const RATE = { windowMs: 60 * 1000, perAddress: 20 };
const FEATURE = 'assistant.chat';
const REF = 'website-agent';
const BUILTIN_AGENT_ID = 'agent_brand';

const hits = new Map();   // address -> [timestamps], per instance

function env() {
  return {
    url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
  };
}

async function service(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = env();
  if (!e.url || !e.key) { const err = new Error('The workspace database is not configured on this deployment.'); err.status = 503; err.code = 'store_unconfigured'; throw err; }
  const headers = { apikey: e.key, Authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) { const err = new Error(`supabase ${method.toLowerCase()} ${pathAndQuery.split('?')[0]} -> ${r.status} ${text.slice(0, 200)}`); err.status = r.status >= 500 ? 503 : 500; throw err; }
  return { data: text ? JSON.parse(text) : null, headers: r.headers };
}

function capOf(ws) {
  const d = (ws && ws.brand_data) || {};
  const n = Number(d.agent_embed && d.agent_embed.daily_cap);
  return Number.isFinite(n) && n >= 0 ? Math.min(MAX_DAILY_CAP, Math.floor(n)) : DEFAULT_DAILY_CAP;
}

function hostOfUrl(u) {
  try { return new URL(String(u)).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; }
}

/** The page the request came from: Origin, else Referer. */
function callerHost(req) {
  const h = (req && req.headers) || {};
  return hostOfUrl(h.origin || '') || hostOfUrl(h.referer || '');
}

function ownHost(req) {
  const h = (req && req.headers) || {};
  return String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
}

/** Is the calling page the brand's own website (or this deployment's own pages)? */
function originAllowed(req, ws) {
  const C = require('./brand-coherence.js');
  const caller = callerHost(req);
  if (!caller) return { ok: false, why: 'no_origin' };
  if (caller === ownHost(req)) return { ok: true, via: 'this deployment' };
  const site = hostOfUrl(ws && ws.website);
  if (!site) return { ok: false, why: 'no_website' };
  const a = C.registrableDomain(caller), b = C.registrableDomain(site);
  if (a && b && C.sameBrand(a, b)) return { ok: true, via: site };
  return { ok: false, why: 'other_site', caller, site };
}

function rateHit(addr, now) {
  const t = now || Date.now();
  const list = (hits.get(addr) || []).filter((x) => t - x < RATE.windowMs);
  if (list.length >= RATE.perAddress) { hits.set(addr, list); return false; }
  list.push(t); hits.set(addr, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

// Spam protection for the one form a stranger can send (2026-10-17): a
// honeypot field a person never sees (a bot that fills every input fills it),
// at most MAX_LINKS links in a question (link spam is the commonest abuse of
// a site chat). Each is refused before the database or a model is touched;
// floods are held by the per-address rate limit and the brand's daily cap.
const MAX_LINKS = 2;
function spamReason(b) {
  if (String((b && (b.hp || b.website_hp)) || '').trim()) return 'honeypot';
  const message = String((b && b.message) || '');
  if ((message.match(/https?:\/\/|www\./gi) || []).length > MAX_LINKS) return 'links';
  return '';
}
function addressOf(req) {
  const h = (req && req.headers) || {};
  return String(h['x-forwarded-for'] || h['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
}

async function repliesToday(wsId) {
  const day = new Date().toISOString().slice(0, 10) + 'T00:00:00Z';
  const { data, headers } = await service(
    `credit_ledger?select=id&workspace_id=eq.${encodeURIComponent(wsId)}&kind=eq.hold&ref=eq.${REF}&created_at=gte.${encodeURIComponent(day)}&limit=1`,
    { prefer: 'count=exact' });
  const range = headers && headers.get && headers.get('content-range');
  const n = range ? Number(String(range).split('/')[1]) : NaN;
  return Number.isFinite(n) ? n : (Array.isArray(data) ? data.length : 0);
}

const say = (res, status, error, message, extra) => res.status(status).json(Object.assign({ ok: false, error, message }, extra || {}));

/**
 * POST ?action=agent-public  { workspace_id, agent_id, message, history?, session_id?, page_url? }
 * A visitor on the brand's website talking to the brand's agent.
 */
async function publicChat(req, res, b, deps) {
  if (req.method !== 'POST') return say(res, 405, 'post_only', 'Send the message with POST.');
  // The router dropped the body's workspace_id into the query; either names it.
  const wsId = String((b && b.workspace_id) || (req.query && req.query.workspace_id) || '').trim();
  const agentId = String((b && b.agent_id) || '').trim();
  const message = String((b && b.message) || '').trim().slice(0, 1500);
  if (!wsId || !agentId) return say(res, 400, 'embed_incomplete', 'This website assistant is missing its brand or agent id. Copy the embed code again from the Agent page.');
  if (!message) return say(res, 400, 'message_required', 'Type a question first.');
  const spam = spamReason(b, addressOf(req));
  if (spam === 'honeypot') return res.status(200).json({ ok: true, reply: 'Thanks, your message was received.', spam: true });
  if (spam === 'links') return say(res, 400, 'too_many_links', `Please ask without more than ${MAX_LINKS} links in one question.`);

  const wsRows = (await service(`brand_workspaces?select=id,name,website,owner_id,brand_data&id=eq.${encodeURIComponent(wsId)}&limit=1`)).data;
  const ws = Array.isArray(wsRows) && wsRows[0];
  if (!ws) return say(res, 404, 'brand_not_found', 'This website assistant points at a brand that does not exist any more. Copy the embed code again from the Agent page.');
  // `agent_brand` is the built-in brand agent brain-agent.js composes from the
  // brand's own record (no row exists for it); any other id is a row of THIS
  // workspace.
  let agent = null;
  if (agentId === BUILTIN_AGENT_ID) agent = { id: agentId, active: true };
  else {
    const agentRows = (await service(`smart_agents?select=id,name,active,workspace_id&id=eq.${encodeURIComponent(agentId)}&workspace_id=eq.${encodeURIComponent(wsId)}&limit=1`)).data;
    agent = Array.isArray(agentRows) && agentRows[0];
  }
  if (!agent || agent.active === false) return say(res, 404, 'agent_not_found', `This assistant is not switched on for ${ws.name || 'this brand'} any more.`);

  const where = originAllowed(req, ws);
  if (!where.ok) {
    const msg = where.why === 'no_website'
      ? `${ws.name || 'This brand'} has no website on its record, so its assistant cannot be placed on one yet. Add the website in Brand setup.`
      : where.why === 'no_origin'
        ? 'This assistant answers only on a web page of the brand\'s own website.'
        : `This assistant answers only on ${where.site}, the website on ${ws.name || 'the brand'}'s record, not on ${where.caller}.`;
    return say(res, 403, 'origin_not_allowed', msg);
  }
  if (!rateHit(addressOf(req))) return say(res, 429, 'slow_down', 'Too many questions in a minute. Please wait a moment and ask again.');
  // The visitor is admitted to THIS brand only, by the checks above (the page
  // is on the brand's own website, the agent is this workspace's). The router
  // scopes an anonymous request to nothing (2026-10-20), so the scope the
  // agent reads under is granted here, after those checks, and nowhere else.
  req.__workspaceId = ws.id;
  req.__scopeGranted = true;

  const cap = capOf(ws);
  const used = await repliesToday(wsId);
  if (used >= cap) return say(res, 429, 'daily_cap_reached', `The assistant has answered its ${cap} questions for today. It will answer again tomorrow.`, { cap, used });

  const credits = deps.credits;
  const m = await credits.meter(req, FEATURE, {
    auth: { ok: true, user_id: ws.owner_id, provider: 'website-agent', email: '' },
    workspace_id: wsId, ref: REF,
    meta: { channel: 'website', agent_id: agentId, page: String((b && b.page_url) || '').slice(0, 300) },
  });
  if (!m.ok) {
    if (m.error === 'insufficient_credits' || m.status === 402) return say(res, 402, 'brand_out_of_credits', `The assistant is resting right now. Please contact ${ws.name || 'the brand'} directly.`);
    return say(res, m.status || 503, m.error || 'credits_unavailable', m.message || 'The assistant cannot answer right now.');
  }
  try {
    const out = await deps.agents.chat({
      agentId, sessionId: b.session_id, message,
      context: { channel: 'website', page_url: String((b && b.page_url) || '').slice(0, 300) },
      history: Array.isArray(b.history) ? b.history.slice(-12) : [],
    });
    if (!out || out.ok === false || !out.reply) { await m.release('no reply'); return res.status(502).json(Object.assign({ ok: false, error: 'no_reply', message: 'The assistant could not answer that just now. Please try again.' }, out && out.session_id ? { session_id: out.session_id } : {})); }
    await m.settle();
    return res.status(200).json({ ok: true, reply: out.reply, speak: out.speak, session_id: out.session_id, agent: out.agent && { id: out.agent.id, name: out.agent.name } });
  } catch (e) {
    await m.release('error');
    throw e;
  }
}

/**
 * GET  ?action=agent-embed&op=settings&workspace_id=   -> { daily_cap, used_today, website }
 * POST ?action=agent-embed&op=settings { workspace_id, daily_cap } (owner or editor)
 */
async function settings(req, res, b) {
  const core = require('./brand-workspace-core.js');
  const auth = await core.requireUser(req);
  if (!auth.ok) return say(res, auth.status || 401, auth.error || 'sign_in_required', auth.message || 'Sign in to change the website assistant.');
  const wsId = String((b && b.workspace_id) || (req.query && req.query.workspace_id) || '').trim();
  if (!wsId) return say(res, 400, 'workspace_required', 'Choose a brand first.');
  const ws = await core.getWorkspace(auth, wsId);
  if (!ws) return say(res, 404, 'brand_not_found', 'That brand is not one of yours.');
  if (req.method === 'POST') {
    await core.assertCanWrite(auth, wsId, 'change its website assistant');
    const n = Math.floor(Number(b && b.daily_cap));
    if (!Number.isFinite(n) || n < 0 || n > MAX_DAILY_CAP) return say(res, 400, 'cap_invalid', `Set a daily limit between 0 and ${MAX_DAILY_CAP} answers.`);
    const cur = (await service(`brand_workspaces?select=brand_data&id=eq.${encodeURIComponent(wsId)}&limit=1`)).data;
    const data = Object.assign({}, (cur && cur[0] && cur[0].brand_data) || {});
    data.agent_embed = Object.assign({}, data.agent_embed || {}, { daily_cap: n, set_by: auth.user_id, set_at: new Date().toISOString() });
    await service(`brand_workspaces?id=eq.${encodeURIComponent(wsId)}`, { method: 'PATCH', body: { brand_data: data }, prefer: 'return=minimal' });
    ws.brand_data = data;
  }
  let used = null;
  try { used = await repliesToday(wsId); } catch (_) { used = null; }
  return res.status(200).json({ ok: true, workspace_id: wsId, website: ws.website || '', daily_cap: capOf(ws), used_today: used, price: FEATURE });
}

module.exports = { publicChat, settings, originAllowed, capOf, DEFAULT_DAILY_CAP, REF, FEATURE, _resetRate: () => hits.clear(), spamReason, MAX_LINKS };
