'use strict';

/**
 * /api/kb — single-function router for the Knowledge Base.
 *
 * Hobby plan caps Serverless Functions at 12. The five KB capabilities
 * (ingest, list, top-emails, brands, classify-emails) used to live as
 * separate files; this router consolidates them so we stay under the limit
 * without losing any functionality.
 *
 * Dispatch table — selected via ?action=<name>:
 *   action=ingest             POST   { url, tags?, added_by? }
 *                             → fetches page, LLM-summarizes, upserts into kb_knowledge
 *   action=list               GET    ?limit=200&status=summarized
 *                             → returns kb_knowledge rows
 *   action=top-emails         GET    ?limit=200&market=US&order=open|rev
 *                             POST   { ...row }              (single insert)
 *                             POST   { items: [...] }        (bulk, max 200)
 *   action=brands             GET    ?category=sneaker&region=US&active=true
 *                             POST   { name, category, region, ... }   (upsert)
 *                             PATCH  ?id=<id>   { ...patch }
 *                             DELETE ?id=<id>   (soft) | &hard=1 (truly drop)
 *   action=classify-emails    GET    ?summary=1 | ?limit=200
 *                             POST   { reclassify?: true }
 *                             → heuristic format classifier over captured competitor emails
 *
 * Each action's logic is inline below — no shared LLM helper imports past
 * the actual ingest path. This keeps the bundle small.
 */

const wsScope = require('./_shared/workspace-scope.js');

/**
 * The workspace filter for a scoped table, or a sentinel that means "return
 * nothing". Every read in this file goes through it.
 *
 * kb_knowledge, kb_top_emails, kb_daily_digest, competitor_brands and
 * competitor_emails_classified all carry workspace_id and all were read
 * unfiltered here, with the SERVICE-ROLE key, which bypasses the RLS policies
 * that would otherwise have caught it. So the Knowledge Base listed every
 * brand's ingested documents, Competitive Benchmarking listed every brand's
 * competitor set, and the top-emails library mixed them together.
 */
async function wsFilter(table, env, req) {
  try { return await wsScope.filterFor(table, env, req); }
  catch (_) { return null; }
}
const NOTHING = (extra) => Object.assign({
  ok: true, items: [], count: 0, workspace_id: null,
  note: 'No active brand workspace on this request, so nothing is returned. Another brand\'s knowledge is never substituted. Hard-refresh the page so the brand context loads, then try again.',
}, extra || {});

// ── Shared: supabase config ────────────────────────────────────────────────
function supaEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
           || process.env.SUPABASE_SERVICE_KEY
           || process.env.SUPABASE_ANON_KEY
           || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_*_KEY missing');
  return { url: url.replace(/\/$/, ''), key };
}
function sbHeaders(env) {
  return { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' };
}
function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// ── Shared: URL helpers (used by ingest + classify) ────────────────────────
// Defined ONCE in _shared/kb-url.js, because the brand context pack writes into
// this same table from its own-site crawl. Two copies of the canonicaliser mean
// the operator pasting a URL and the crawler reading it produce two different
// url_hashes for one page, and the row is silently duplicated.
const { canonicalUrl, urlHash } = require('./_shared/kb-url.js');

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════
/**
 * INGEST-FILES — accept uploaded files of any extension, extract what can
 * honestly be read, analyse it for the ACTIVE brand, and store it as knowledge.
 *
 * The client posts one small batch at a time as base64 (Vercel caps a request
 * body at ~4.5MB), so a 500-file folder streams through as many small calls.
 * A file we cannot read is still recorded, with an explicit note saying what is
 * missing - never a fabricated summary.
 */
async function ingestFiles(req, res, env) {
  const kbFiles = require('./_shared/kb-files.js');
  const wsScope = require('./_shared/workspace-scope.js');
  const body = (req.body && typeof req.body === 'object') ? req.body
    : (() => { try { return JSON.parse(req.body || '{}'); } catch (_) { return {}; } })();
  const files = Array.isArray(body.files) ? body.files.slice(0, 12) : [];
  if (!files.length) return res.status(400).json({ ok: false, error: 'files[] required' });

  // The knowledge belongs to the ACTIVE workspace, and the analysis is written
  // for THAT brand. Without a workspace we refuse rather than filing it blind.
  const wsId = await wsScope.resolve(env, req);
  if (!wsId) return res.status(200).json({ ok: false, error: 'workspace_unresolved', note: 'No active brand workspace on this request, so nothing was filed.' });
  let brand = null;
  try { brand = await wsScope.brandForWorkspace(env, wsId); } catch (_) { brand = null; }

  const results = [];
  for (const f of files) {
    const name = String(f.name || 'file');
    try {
      const buf = Buffer.from(String(f.data_base64 || ''), 'base64');
      if (!buf.length) { results.push({ name, ok: false, error: 'empty file' }); continue; }
      const built = await kbFiles.buildRecord({ name, path: f.path || name, size: buf.length, buf, brand });
      const row = Object.assign({}, built.row, { workspace_id: wsId, market: String(f.market || '') || null });
      const r = await fetch(`${env.url}/rest/v1/kb_knowledge?on_conflict=workspace_id,url_hash`, {
        method: 'POST',
        headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify([row]),
      });
      if (!r.ok) { results.push({ name, ok: false, error: `store failed: ${r.status} ${(await r.text()).slice(0, 140)}` }); continue; }
      results.push({ name, ok: true, title: row.title, ...built.extracted });
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
    }
  }
  const stored = results.filter((x) => x.ok).length;
  return res.status(200).json({
    ok: true, stored, total: results.length, workspace_id: wsId,
    brand: brand ? brand.name : null,
    needs_attention: results.filter((x) => x.ok && x.extracted === false).length,
    results,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  // The browser sends its Supabase session so the workspace can be resolved;
  // without this header on the preflight the token never arrives and every
  // request looks anonymous.
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = (req.query?.action || '').toLowerCase();
  let env;
  try { env = supaEnv(); }
  catch (e) { return res.status(500).json({ ok: false, error: e.message }); }

  // ── Workspace scoping (same contract as api/brain.js and api/calendar.js) ─
  // Resolve ONCE per request: explicit param, else the caller's JWT -> their
  // active workspace, else the default only for a userless (cron) call. A
  // BROWSER request that carries neither is refused rather than served the
  // default workspace's knowledge base.
  try {
    req.__workspaceId = await wsScope.resolve(env, req);
    const q0 = (req && req.query) || {};
    const b0 = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const hadExplicit = !!(q0.workspace_id || b0.workspace_id);
    const hadAuth = !!(req.headers && (req.headers.authorization || req.headers.Authorization));
    const fromBrowser = !!(req.headers && (req.headers.origin || req.headers.referer));
    if (!hadExplicit && !hadAuth && fromBrowser) {
      return res.status(200).json(NOTHING({ error: 'workspace_unresolved', brands: [], brand_kit: null }));
    }
    if (req.query) req.query.workspace_id = req.query.workspace_id || req.__workspaceId || undefined;
  } catch (_) { /* scoping must never hard-fail the router */ }

  // ── 1. INGEST — fetch a URL, LLM-summarize, store ───────────────────────
  if (action === 'ingest') {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
    return ingest(req, res, env);
  }
  // ── 1b. INGEST-FILES — a folder or file set of ANY type ─────────────────
  if (action === 'ingest-files') {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
    return ingestFiles(req, res, env);
  }
  // ── 2. LIST — read kb_knowledge ─────────────────────────────────────────
  if (action === 'list') {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });
    return listKnowledge(req, res, env);
  }
  // ── 3. TOP-EMAILS ───────────────────────────────────────────────────────
  if (action === 'top-emails' || action === 'topemails') {
    return topEmails(req, res, env);
  }
  // ── 4. BRANDS ───────────────────────────────────────────────────────────
  if (action === 'brands') {
    return brands(req, res, env);
  }
  // ── 5. CLASSIFY-EMAILS ──────────────────────────────────────────────────
  if (action === 'classify-emails' || action === 'classify') {
    return classifyEmails(req, res, env);
  }
  // ── 6. DAILY D2C DIGEST (Phase 3 synthesis) ─────────────────────────────
  //   GET  → latest stored digest.   POST → synthesise the last 24h + store.
  if (action === 'digest' || action === 'daily-digest') {
    return dailyDigest(req, res, env);
  }
  // ── 7. BRAND-KIT — the single brand-truth record the whole OS reads ──────
  //   GET  → the singleton brand kit + market config.
  //   POST → upsert it (palette / typography / voice / footer blocks).
  if (action === 'brand-kit' || action === 'brandkit') {
    return brandKit(req, res, env);
  }

  return res.status(400).json({ ok: false, error: 'Unknown action. Use ?action=ingest|list|top-emails|brands|classify-emails|digest|brand-kit' });
};

// ═══════════════════════════════════════════════════════════════════════════
// BRAND KIT — read/write the ACTIVE brand's kit row (lifecycle_brand_kit)
// ═══════════════════════════════════════════════════════════════════════════
// This is what /brand (brand.html) edits.
//
// It used to be a literal singleton: `id INT PRIMARY KEY CHECK (id = 1)`, read
// with `?id=eq.1` and written with `{ id: 1 }`. So every brand on the platform
// opened the Brand Kit page and saw tenant zero's palette, typography and
// voice, and every SAVE overwrote that one row for everybody else. The read
// policy was `USING (true)`, so it was world-readable on top of that.
//
// One row per workspace now (20260814090000), keyed by the workspace id.
async function brandKit(req, res, env) {
  const base = `${env.url}/rest/v1`;
  const H = sbHeaders(env);
  const ws = req.__workspaceId ? String(req.__workspaceId) : null;
  if (!ws) return res.status(200).json(NOTHING({ brand_kit: null, markets: [] }));

  if (req.method === 'GET') {
    const [kitRes, mktRes] = await Promise.all([
      fetch(`${base}/lifecycle_brand_kit?workspace_id=eq.${encodeURIComponent(ws)}&select=*&limit=1`, { headers: H }),
      fetch(`${base}/lifecycle_market_config?select=*&order=market.asc`, { headers: H }).catch(() => null),
    ]);
    if (!kitRes.ok) return res.status(502).json({ ok: false, error: `brand_kit read failed: ${await kitRes.text()}` });
    const rows = await kitRes.json();
    let markets = [];
    if (mktRes && mktRes.ok) markets = await mktRes.json().catch(() => []);
    // A brand that has never saved a kit gets NOTHING, not tenant zero's kit.
    // The onboarding record (brand_workspaces) is that brand's palette and
    // typography until it saves one here.
    return res.status(200).json({
      ok: true, workspace_id: ws, brand_kit: rows[0] || null, markets,
      note: rows[0] ? null : 'This brand has not saved a brand kit yet. Its palette, typography and voice come from its onboarding record until it does; no other brand\'s kit is shown in the meantime.',
    });
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { palette, typography, voice, footer_blocks, guide_pdf_url } = body;
    if (!palette || !typography || !voice) {
      return res.status(400).json({ ok: false, error: 'palette, typography and voice are required' });
    }
    // Guard the load-bearing invariant: exactly four hex colours, all valid.
    const hexes = ['primary', 'accent', 'bg', 'text'].map((k) => palette[k]);
    if (hexes.some((h) => !/^#[0-9A-Fa-f]{6}$/.test(String(h || '')))) {
      return res.status(400).json({ ok: false, error: 'palette needs primary, accent, bg and text as #RRGGBB' });
    }
    const row = {
      id: ws, workspace_id: ws, palette, typography, voice,
      footer_blocks: footer_blocks || {},
      guide_pdf_url: guide_pdf_url || null,
      updated_at: new Date().toISOString(),
    };
    const r = await fetch(`${base}/lifecycle_brand_kit?on_conflict=workspace_id`, {
      method: 'POST',
      headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([row]),
    });
    if (!r.ok) return res.status(502).json({ ok: false, error: `brand_kit write failed: ${await r.text()}` });
    const saved = await r.json();
    return res.status(200).json({ ok: true, brand_kit: saved[0] || row });
  }

  return res.status(405).json({ ok: false, error: 'GET or POST only' });
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. DAILY D2C DIGEST — synthesise the clean 24h learning log into one lesson
// ═══════════════════════════════════════════════════════════════════════════
async function dailyDigest(req, res, env) {
  const headers = sbHeaders(env);
  const wsDigest = await wsFilter('kb_daily_digest', env, req);
  if (wsDigest === null) return res.status(200).json(NOTHING({ latest: null }));
  // GET: return the most recent stored digest (fast, for the UI).
  if (req.method === 'GET') {
    try {
      const r = await fetch(`${env.url}/rest/v1/kb_daily_digest?select=*&order=digest_date.desc&limit=${Math.min(parseInt(req.query?.limit || '1', 10) || 1, 30)}${wsDigest}`, { headers });
      if (!r.ok) return res.status(r.status).json({ ok: false, items: [], error: (await r.text()).slice(0, 300) });
      const items = await r.json();
      return res.status(200).json({ ok: true, items, latest: items[0] || null });
    } catch (err) { return res.status(500).json({ ok: false, items: [], error: err.message }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'GET (read) or POST (synthesise) only' });

  // POST: pull the last 24h of CLEAN (guardrail-passed, summarised) rows only —
  // status='summarized' is exactly the set that cleared Phase 1 + Phase 2, so
  // the digest physically cannot see filtered junk (RAG sandbox on the way in).
  const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let rows = [];
  const wsKnowledge = await wsFilter('kb_knowledge', env, req);
  // `return []` used to sit here, inside an HTTP handler: nothing was ever
  // written to the response, so the request hung until the platform timed it
  // out. Answer honestly instead.
  if (wsKnowledge === null) return res.status(200).json(NOTHING({ latest: null }));
  try {
    const q = `${env.url}/rest/v1/kb_knowledge?select=title,summary,key_points,market,vertical,url,added_at&status=eq.summarized&added_at=gte.${encodeURIComponent(sinceIso)}&order=added_at.desc&limit=80${wsKnowledge}`;
    const r = await fetch(q, { headers });
    if (r.ok) rows = await r.json();
  } catch (_) { rows = []; }

  if (!rows.length) return res.status(200).json({ ok: true, empty: true, note: 'No clean learning-log entries in the last 24h — nothing to synthesise.' });

  const markets = [...new Set(rows.map((x) => x.market).filter(Boolean))];
  const verticals = [...new Set(rows.map((x) => x.vertical).filter(Boolean))];
  const digestDate = new Date().toISOString().slice(0, 10);

  let digest_md = '';
  let signals = [];
  const callLLM = require('./_shared/llm.js');
  // The analyst persona used to be hardcoded to "a US/UK custom sneaker,
  // streetwear and sneaker-care brand", so a menswear or publishing workspace
  // had its own captured signals read back to it through another industry's
  // lens, with that industry's verticals in the output schema. It comes from
  // the ACTIVE brand's own record now, and from the markets and verticals the
  // rows themselves carry - never a shipped default.
  const digestBrand = req.__workspaceId
    ? await wsScope.brandForWorkspace(env, req.__workspaceId).catch(() => null)
    : null;
  const who = digestBrand
    ? `${digestBrand.name}${digestBrand.industry ? ` (${digestBrand.industry})` : ''}`
    : 'this brand';
  const scopeLine = [
    markets.length ? `markets ${markets.join('/')}` : '',
    verticals.length ? `verticals ${verticals.join(', ')}` : '',
  ].filter(Boolean).join(' · ') || 'the markets and verticals present in the log';
  const SYS = `You are a market-intelligence analyst for ${who}. Synthesise the last 24 hours of clean competitor/market signals into ONE concise operational daily lesson (2-4 short paragraphs). Group by PATTERN not by source: name the brands, quote hard numbers/changes where present, and call out coordinated shifts (e.g. several brands moving to the same hook, a shared offer-architecture change). Cover Offer Architecture, Acquisition Hooks, Retention Flows and channel/retail expansion, restricted to ${scopeLine}. Use ONLY the markets and verticals that appear in the log; never introduce an industry, market or vertical that is not there. No fluff, no thought-leadership. Return STRICT JSON: {"digest_md":"<markdown lesson>","signals":[{"pattern":"<short>","brands":["..."],"vertical":"<one that appears in the log>","market":"<one that appears in the log>","evidence":"<one line>"}]}.`;
  const logLines = rows.map((x, i) => `[${i + 1}] (${x.market || '?'}/${x.vertical || '?'}) ${x.title || ''} — ${String(x.summary || '').slice(0, 300)}`).join('\n');
  try {
    const out = await callLLM({ systemPrompt: SYS, userMessage: `CLEAN LEARNING LOG (last 24h, ${rows.length} entries):\n${logLines}\n\nReturn the JSON digest.`, responseFormat: { type: 'json_object' }, maxTokens: 900, temperature: 0.4, timeoutMs: 40000, stage: 'kb-daily-digest', tier: 'fast' });
    if (out && out.ok && out.text) {
      const j = JSON.parse(out.text.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, '$1'));
      digest_md = String(j.digest_md || '').slice(0, 6000);
      signals = Array.isArray(j.signals) ? j.signals.slice(0, 12) : [];
    }
  } catch (_) { /* fall through to deterministic fallback */ }
  if (!digest_md) {
    // No LLM — a deterministic roll-up so the digest still ships (never fabricate).
    // The markets line reports what the rows actually carry; it used to fall
    // back to the literal "US/UK", which is a claim about coverage the log may
    // not support.
    digest_md = `Daily digest ${digestDate}: ${rows.length} clean signals across ${verticals.join(', ') || 'no recorded vertical'} (${markets.join('/') || 'no recorded market'}). Top items:\n` + rows.slice(0, 8).map((x) => `- ${x.title || x.url}`).join('\n') + `\n\n(LLM synthesis unavailable — set a text API key for the narrative lesson.)`;
  }

  try {
    // Upsert on (workspace_id, digest_date). The old conflict target was
    // digest_date alone, so the second brand to synthesise on a given day
    // overwrote the first brand's digest instead of storing its own.
    const digestRow = await wsScope.stamp('kb_daily_digest',
      { digest_date: digestDate, markets, verticals, sources_n: rows.length, digest_md, signals }, env, req);
    if (digestRow && digestRow.workspace_id) {
      await fetch(`${env.url}/rest/v1/kb_daily_digest?on_conflict=workspace_id,digest_date`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify(digestRow),
      });
    }
  } catch (_) { /* best-effort persist */ }
  return res.status(200).json({ ok: true, digest_date: digestDate, sources_n: rows.length, markets, verticals, digest_md, signals });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. INGEST
// ═══════════════════════════════════════════════════════════════════════════
async function ingest(req, res, env) {
  // Lazy-require the LLM helper — only needed in this path.
  const callLLM = require('./_shared/llm.js');

  function stripHtml(html) {
    if (!html) return '';
    let s = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ');
    s = s.replace(/<\/?[a-z][^>]*>/gi, ' ');
    s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    return s.replace(/\s+/g, ' ').trim().slice(0, 50000);
  }
  function extractTitle(html) {
    const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html || '');
    if (m) return m[1].trim().slice(0, 240);
    const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html || '');
    return og ? og[1].trim().slice(0, 240) : null;
  }
  function extractAuthor(html) {
    const m = /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i.exec(html || '');
    if (m) return m[1].trim().slice(0, 120);
    const og = /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i.exec(html || '');
    return og ? og[1].trim().slice(0, 120) : null;
  }
  function guessSourceType(url) {
    const u = url.toLowerCase();
    if (/twitter\.com|x\.com/.test(u)) return 'tweet';
    if (/youtube\.com|vimeo\.com/.test(u)) return 'video';
    if (/medium\.com|substack\.com|\.blog|wordpress|ghost\.io/.test(u)) return 'blog';
    return 'web';
  }
  async function fetchPage(url, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 KnickgasmKBBot/1.0 (+contact: knowledge@knickgasm.com)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      return { status: r.status, html: await r.text(), finalUrl: r.url || url };
    } finally { clearTimeout(t); }
  }

  // The curator persona is built from the ACTIVE brand. It used to name
  // KNICKGASM and "a premium D2C sneaker brand" outright, so every workspace's
  // ingested documents were summarised for somebody else's marketing team and
  // came back with somebody else's framing.
  const ingestBrand = req.__workspaceId
    ? await wsScope.brandForWorkspace(env, req.__workspaceId).catch(() => null)
    : null;
  const curatorFor = ingestBrand
    ? `${ingestBrand.name}${ingestBrand.industry ? `, ${ingestBrand.industry}` : ''}`
    : 'this brand';
  const SYSTEM_PROMPT = `You are the knowledge curator for ${curatorFor}. You receive raw extracted text from a web page and distill it into a useful reference for the marketing team.

Return STRICT JSON ONLY:
{"summary":"<60-120 words>","key_points":["<5 takeaways>"],"tags":["<2-5 short tags>"]}

Rules:
- Be specific. Reference numbers, brand names, frameworks if mentioned.
- Skip headers, ads, navigation.
- Summarise only what the page says. Never add a fact about ${curatorFor} that the page does not contain.
- If the text is empty/garbage, return {"summary":"<could not extract content>","key_points":[],"tags":["error"]}.
- Output the JSON object only, starting with { and ending with }.`;

  async function summarize(textBody, urlForContext) {
    if (!textBody || textBody.length < 60) {
      return { summary: 'Could not extract meaningful content from this URL.', key_points: [], tags: ['error'] };
    }
    const userMsg = `URL: ${urlForContext}\n\nExtracted text:\n"""\n${textBody.slice(0, 30000)}\n"""`;
    try {
      const out = await callLLM({ systemPrompt: SYSTEM_PROMPT, userMessage: userMsg, responseFormat: { type: 'json_object' }, maxTokens: 700, temperature: 0.3, timeoutMs: 35000, stage: 'kb-ingest', tier: 'fast' });
      if (!out || !out.ok || !out.text) throw new Error(out && out.err ? String(out.err) : 'no LLM response');
      const json = JSON.parse(out.text.replace(/^[\s\S]*?({[\s\S]*})[\s\S]*$/, '$1'));
      return {
        summary: String(json.summary || '').slice(0, 2000),
        key_points: Array.isArray(json.key_points) ? json.key_points.slice(0, 8).map(String) : [],
        tags: Array.isArray(json.tags) ? json.tags.slice(0, 6).map((t) => String(t).toLowerCase()) : [],
      };
    } catch (err) { return { summary: `Summary failed: ${err.message}`, key_points: [], tags: ['error'] }; }
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const url = String(body.url || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Provide a valid http(s) url' });
  const added_by = String(body.added_by || 'anonymous').slice(0, 120);
  const source_type = (body.source_type && String(body.source_type)) || guessSourceType(url);
  const userTags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).toLowerCase()) : null;
  const canonical = canonicalUrl(url);
  const hash = urlHash(canonical);
  const headers = sbHeaders(env);

  // Upsert initial 'queued' row.
  //
  // This used to read `row = await wsScope.stamp('kb_knowledge', row, …)` with
  // `row` still undefined on the line after its own declaration, and then throw
  // the result away: the body posted below was a separate object literal with
  // no workspace_id on it. So every ingested document landed with workspace_id
  // NULL - accepted by the database, invisible to every brand including the one
  // that ingested it. Stamp the object that is actually written.
  let row;
  // Carried into every follow-up PATCH below: the row id came from our own
  // upsert, but a write that names only an id is one refactor away from landing
  // on another brand's row, and the filter costs nothing.
  const queuedWs = req.__workspaceId ? `&workspace_id=eq.${encodeURIComponent(req.__workspaceId)}` : '';
  try {
    const queued = await wsScope.stamp('kb_knowledge',
      { url: canonical, url_hash: hash, source_type, tags: userTags, status: 'queued', added_by }, env, req);
    if (!queued || !queued.workspace_id) {
      return res.status(200).json(NOTHING({ stage: 'workspace', error: 'workspace_unresolved' }));
    }
    const r = await fetch(`${env.url}/rest/v1/kb_knowledge?on_conflict=workspace_id,url_hash`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(queued),
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0,300)}`);
    const data = await r.json(); row = Array.isArray(data) ? data[0] : data;
  } catch (err) { return res.status(500).json({ ok: false, stage: 'db', error: err.message }); }
  const rowId = row && row.id;
  if (!rowId) return res.status(500).json({ ok: false, error: 'failed to create kb_knowledge row' });

  // Fetch page
  let pageHtml = '';
  try {
    const fetched = await fetchPage(canonical);
    pageHtml = fetched.html;
    if (fetched.status < 200 || fetched.status >= 400) throw new Error(`HTTP ${fetched.status}`);
  } catch (err) {
    await fetch(`${env.url}/rest/v1/kb_knowledge?id=eq.${rowId}${queuedWs}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'failed', processed_at: new Date().toISOString(), summary: `Fetch failed: ${err.message}` }),
    });
    return res.status(502).json({ ok: false, stage: 'fetch', error: err.message, id: rowId });
  }

  const title = extractTitle(pageHtml);
  const author = extractAuthor(pageHtml);
  const rawText = stripHtml(pageHtml);

  // ── Ingest guardrail ──────────────────────────────────────────────────────
  // Keep the knowledge base ON-CONTEXT: US/UK D2C custom sneakers / sneaker retail /
  // streetwear / sneaker care
  // only. Phase 1 (deterministic: brand whitelist, US/UK geo + $/£ currency,
  // relevance lexicon, junk blocklist) then Phase 2 (LLM relevance gate, fails
  // open if no LLM). Junk is dropped BEFORE we spend tokens summarising it or let
  // it pollute the KB. Errors fail open so a guardrail bug never blocks real data.
  const guard = require('./_shared/ingest-guardrail.js');
  const verdict = await guard.gatekeep({ title, text: rawText, url: canonical }, { llm: true }).catch(() => ({ keep: true, phase: 0, reason: 'guardrail error — kept' }));
  if (!verdict.keep) {
    await fetch(`${env.url}/rest/v1/kb_knowledge?id=eq.${rowId}${queuedWs}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ title, author, status: 'filtered', summary: `Off-context, not ingested (guardrail phase ${verdict.phase}): ${verdict.reason}`, processed_at: new Date().toISOString() }),
    }).catch(() => {});
    return res.status(200).json({ ok: true, filtered: true, phase: verdict.phase, reason: verdict.reason, id: rowId, url: canonical });
  }

  await fetch(`${env.url}/rest/v1/kb_knowledge?id=eq.${rowId}${queuedWs}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ title, author, raw_text: rawText, status: 'fetched' }),
  }).catch(() => {});

  const out = await summarize(rawText, canonical);
  const mergedTags = [...new Set([...(userTags || []), ...(out.tags || [])])].slice(0, 8);
  const meta = (verdict && verdict.meta) || {};   // zero-drift {market, vertical}
  try {
    await fetch(`${env.url}/rest/v1/kb_knowledge?id=eq.${rowId}${queuedWs}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ summary: out.summary, key_points: out.key_points, tags: mergedTags, market: meta.market || null, vertical: meta.vertical || null, status: 'summarized', processed_at: new Date().toISOString() }),
    });
    return res.status(200).json({ ok: true, id: rowId, title, author, summary: out.summary, key_points: out.key_points, tags: mergedTags, market: meta.market || null, vertical: meta.vertical || null, status: 'summarized', url: canonical });
  } catch (err) { return res.status(500).json({ ok: false, stage: 'final-save', error: err.message, id: rowId }); }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. LIST KB_KNOWLEDGE
// ═══════════════════════════════════════════════════════════════════════════
async function listKnowledge(req, res, env) {
  const limit = Math.min(parseInt(req.query?.limit || '200', 10) || 200, 500);
  const status = req.query?.status ? `&status=eq.${encodeURIComponent(req.query.status)}` : '';
  const ws = await wsFilter('kb_knowledge', env, req);
  if (ws === null) return res.status(200).json(NOTHING());
  const url = `${env.url}/rest/v1/kb_knowledge?select=id,url,source_type,title,author,summary,key_points,tags,status,added_by,added_at,processed_at&order=added_at.desc&limit=${limit}${status}${ws}`;
  try {
    const r = await fetch(url, { headers: sbHeaders(env) });
    if (!r.ok) return res.status(r.status).json({ ok: false, items: [], error: (await r.text()).slice(0, 300) });
    const items = await r.json();
    return res.status(200).json({ ok: true, items, count: items.length });
  } catch (err) { return res.status(500).json({ ok: false, items: [], error: err.message }); }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. TOP EMAILS
// ═══════════════════════════════════════════════════════════════════════════
async function topEmails(req, res, env) {
  const ALLOWED = ['sent_at','subject','preheader','body_text','body_html','market','segment','campaign_type','open_rate','click_rate','conversion_rate','revenue','send_count','notes','tags','added_by'];
  const pick = (o, ks) => ks.reduce((r, k) => (o[k] !== undefined && o[k] !== null && o[k] !== '' ? (r[k] = o[k], r) : r), {});
  const clampRate = (v) => { if (v == null) return undefined; const n = Number(v); if (!isFinite(n)) return undefined; return n > 1.0001 ? Math.min(n/100, 1) : Math.max(0, Math.min(n, 1)); };
  const normalize = (row) => {
    const r = pick(row, ALLOWED);
    if (!r.subject || !r.body_text) return null;
    if (r.open_rate !== undefined) r.open_rate = clampRate(r.open_rate);
    if (r.click_rate !== undefined) r.click_rate = clampRate(r.click_rate);
    if (r.conversion_rate !== undefined) r.conversion_rate = clampRate(r.conversion_rate);
    if (r.revenue !== undefined) r.revenue = Number(r.revenue) || null;
    if (r.send_count !== undefined) r.send_count = parseInt(r.send_count, 10) || null;
    if (r.tags && !Array.isArray(r.tags)) r.tags = String(r.tags).split(',').map((t)=>t.trim().toLowerCase()).filter(Boolean);
    return r;
  };

  if (req.method === 'GET') {
    const limit = Math.min(parseInt(req.query?.limit || '200', 10) || 200, 500);
    const market = req.query?.market;
    const orderBy = req.query?.order === 'open' ? 'open_rate.desc' : (req.query?.order === 'rev' ? 'revenue.desc' : 'added_at.desc');
    const filter = market ? `&market=eq.${encodeURIComponent(market)}` : '';
    const ws = await wsFilter('kb_top_emails', env, req);
    if (ws === null) return res.status(200).json(NOTHING());
    const url = `${env.url}/rest/v1/kb_top_emails?select=*&order=${orderBy}&limit=${limit}${filter}${ws}`;
    const r = await fetch(url, { headers: sbHeaders(env) });
    if (!r.ok) return res.status(r.status).json({ ok: false, items: [], error: (await r.text()).slice(0, 300) });
    const items = await r.json();
    return res.status(200).json({ ok: true, items, count: items.length });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'GET/POST only' });
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const rawRows = (req.query?.bulk === '1' || Array.isArray(body.items)) ? (body.items || []) : [body];
  if (!rawRows.length) return res.status(400).json({ ok: false, error: 'Provide one row or { items: [...] }' });
  if (rawRows.length > 200) return res.status(400).json({ ok: false, error: 'Bulk limit is 200 rows per request' });
  const rows = rawRows.map(normalize).filter(Boolean);
  if (!rows.length) return res.status(400).json({ ok: false, error: 'No valid rows — each needs subject + body_text' });
  // A row written without a workspace lands with workspace_id NULL, which no
  // brand can ever read back. Refuse instead of filing it into the void.
  if (!req.__workspaceId) return res.status(200).json(NOTHING({ inserted: 0, error: 'workspace_unresolved' }));
  const stamped = await wsScope.stamp('kb_top_emails', rows, env, req);
  const r = await fetch(`${env.url}/rest/v1/kb_top_emails`, {
    method: 'POST',
    headers: { ...sbHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify(stamped),
  });
  if (!r.ok) return res.status(r.status).json({ ok: false, inserted: 0, error: (await r.text()).slice(0, 300) });
  const inserted = await r.json();
  return res.status(200).json({ ok: true, inserted: inserted.length, rejected: rawRows.length - rows.length });
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. BRANDS
// ═══════════════════════════════════════════════════════════════════════════
async function brands(req, res, env) {
  const ALLOWED = ['name','website','category','region','priority','subscribe_url','email_alias','is_active','notes','added_by'];
  const pick = (o, ks) => ks.reduce((r, k) => (o[k] !== undefined ? (r[k] = o[k], r) : r), {});
  const headers = sbHeaders(env);

  // Every branch below is scoped. A competitor set is one of the most
  // brand-specific things in the product - a menswear brand's rivals are not a
  // sneaker brand's - and this router read, wrote, patched and DELETED
  // competitor_brands rows by bare id with the service-role key. The id of
  // another brand's row was all it took to edit or remove it.
  const ws = await wsFilter('competitor_brands', env, req);
  if (ws === null) return res.status(200).json(NOTHING({ brands: [] }));

  if (req.method === 'GET') {
    const q = req.query || {};
    const f = [];
    if (q.category) f.push(`category=eq.${encodeURIComponent(q.category)}`);
    if (q.region) f.push(`region=eq.${encodeURIComponent(q.region)}`);
    if (q.active !== undefined && q.active !== 'all') f.push(`is_active=eq.${q.active === 'false' ? 'false' : 'true'}`);
    const filterStr = f.length ? `&${f.join('&')}` : '';
    const url = `${env.url}/rest/v1/competitor_brands?select=*&order=category.asc,region.asc,priority.asc,name.asc&limit=500${filterStr}${ws}`;
    const r = await fetch(url, { headers });
    if (!r.ok) return res.status(r.status).json({ ok: false, items: [], error: (await r.text()).slice(0, 300) });
    const items = await r.json();
    return res.status(200).json({ ok: true, items, count: items.length });
  }
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    const row = pick(body, ALLOWED);
    if (!row.name || !row.category || !row.region) return res.status(400).json({ ok: false, error: 'name, category, region required' });
    const stamped = await wsScope.stamp('competitor_brands', row, env, req);
    if (!stamped || !stamped.workspace_id) return res.status(200).json(NOTHING({ brands: [] }));
    const r = await fetch(`${env.url}/rest/v1/competitor_brands?on_conflict=workspace_id,name,region`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(stamped),
    });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: (await r.text()).slice(0, 300) });
    const data = await r.json();
    return res.status(200).json({ ok: true, brand: Array.isArray(data) ? data[0] : data });
  }
  if (req.method === 'PATCH') {
    const id = req.query?.id; if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    const patch = pick(body, ALLOWED);
    if (!Object.keys(patch).length) return res.status(400).json({ ok: false, error: 'no fields to update' });
    const r = await fetch(`${env.url}/rest/v1/competitor_brands?id=eq.${encodeURIComponent(id)}${ws}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: (await r.text()).slice(0, 300) });
    const data = await r.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return res.status(404).json({ ok: false, error: 'not_found_in_this_workspace' });
    return res.status(200).json({ ok: true, brand: row });
  }
  if (req.method === 'DELETE') {
    const id = req.query?.id; if (!id) return res.status(400).json({ ok: false, error: 'id required' });
    const hard = req.query?.hard === '1';
    const target = `${env.url}/rest/v1/competitor_brands?id=eq.${encodeURIComponent(id)}${ws}`;
    const r = hard
      ? await fetch(target, { method: 'DELETE', headers })
      : await fetch(target, { method: 'PATCH', headers, body: JSON.stringify({ is_active: false }) });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: (await r.text()).slice(0, 300) });
    return res.status(200).json({ ok: true, deleted: hard ? 'hard' : 'soft' });
  }
  return res.status(405).json({ ok: false, error: 'GET/POST/PATCH/DELETE only' });
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. CLASSIFY-EMAILS — heuristic format bifurcation
// ═══════════════════════════════════════════════════════════════════════════
async function classifyEmails(req, res, env) {
  const headers = sbHeaders(env);
  function classify({ html, bodyText }) {
    const text = (bodyText || '').trim();
    const wordCount = text ? text.split(/\s+/).length : 0;
    const imageCount = ((html || '').match(/<img\b[^>]*>/gi) || []).length;
    let format;
    if (wordCount >= 120 && imageCount <= 2) format = 'text';
    else if (imageCount >= 6 || (imageCount >= 3 && wordCount < 80)) format = 'image_heavy';
    else if (wordCount >= 40 && imageCount >= 1 && imageCount <= 5) format = 'html';
    else format = 'mixed';
    return { format, word_count: wordCount, image_count: imageCount };
  }
  const dedupeKey = (e) => `${(e.senderEmail || '').toLowerCase()}|${(e.subject || '').trim()}|${e.receivedAt || ''}`;

  // The captured competitor mail archive is per brand, and the rollup below is
  // a count of THIS brand's captures. Unfiltered it counted everyone's.
  const ws = await wsFilter('competitor_emails_classified', env, req);
  if (ws === null) return res.status(200).json(NOTHING({ counts: {}, byBrand: {}, total: 0 }));

  if (req.method === 'GET') {
    if (req.query?.summary === '1') {
      const r = await fetch(`${env.url}/rest/v1/competitor_emails_classified?select=format,brand&limit=2000${ws}`, { headers });
      const items = r.ok ? await r.json() : [];
      const counts = items.reduce((a, it) => (a[it.format] = (a[it.format] || 0) + 1, a), {});
      const byBrand = items.reduce((a, it) => {
        if (!it.brand) return a;
        a[it.brand] = a[it.brand] || { text:0, html:0, image_heavy:0, mixed:0 };
        a[it.brand][it.format] = (a[it.brand][it.format] || 0) + 1;
        return a;
      }, {});
      return res.status(200).json({ ok: true, total: items.length, counts, byBrand });
    }
    const limit = Math.min(parseInt(req.query?.limit || '200', 10) || 200, 500);
    const fmt = req.query?.format ? `&format=eq.${encodeURIComponent(req.query.format)}` : '';
    const r = await fetch(`${env.url}/rest/v1/competitor_emails_classified?select=*&order=classified_at.desc&limit=${limit}${fmt}${ws}`, { headers });
    const items = r.ok ? await r.json() : [];
    return res.status(200).json({ ok: true, items });
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'GET/POST only' });

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const reclassify = !!body.reclassify;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;

  let emails;
  try {
    const r = await fetch(`${origin}/api/competitor?action=list`);
    if (!r.ok) throw new Error(`/api/competitor?action=list returned ${r.status}`);
    emails = (await r.json()).emails || [];
  } catch (err) { return res.status(502).json({ ok: false, error: 'fetch emails failed: ' + err.message }); }

  let existing = new Set();
  if (!reclassify) {
    const r = await fetch(`${env.url}/rest/v1/competitor_emails_classified?select=email_key&limit=2000${ws}`, { headers });
    if (r.ok) existing = new Set((await r.json()).map((x) => x.email_key));
  }

  const toUpsert = [];
  const counts = { text:0, html:0, image_heavy:0, mixed:0 };
  let scanned = 0, skipped = 0;
  for (const e of emails) {
    scanned++;
    const key = dedupeKey(e);
    if (!reclassify && existing.has(key)) { skipped++; continue; }
    let html = '';
    try {
      const r = await fetch(`${origin}/api/competitor?action=html&id=${encodeURIComponent(e.id)}`);
      if (r.ok) html = ((await r.json().catch(() => ({}))).html) || '';
    } catch {}
    const c = classify({ html, bodyText: e.bodyText });
    counts[c.format] = (counts[c.format] || 0) + 1;
    toUpsert.push({
      email_key: key, brand: e.brand || null, format: c.format,
      word_count: c.word_count, image_count: c.image_count,
      has_promo: !!(e.promoCodes && e.promoCodes !== 'None'),
      promo_codes: e.promoCodes && e.promoCodes !== 'None' ? e.promoCodes : null,
      classifier: 'heuristic',
    });
  }
  if (!toUpsert.length) return res.status(200).json({ ok: true, scanned, skipped, inserted: 0, counts });
  const stamped = await wsScope.stamp('competitor_emails_classified', toUpsert, env, req);
  const r = await fetch(`${env.url}/rest/v1/competitor_emails_classified?on_conflict=workspace_id,email_key`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify(stamped),
  });
  if (!r.ok) return res.status(r.status).json({ ok: false, error: (await r.text()).slice(0, 300), scanned, inserted: 0 });
  return res.status(200).json({ ok: true, scanned, skipped, inserted: toUpsert.length, counts });
}

// Wrapped so everything this router calls - including the generic Supabase
// helper in _shared/supa.js, which has no `req` of its own - can resolve THIS
// caller's workspace and scope its reads and writes to it. See
// api/_shared/request-scope.js for why an ambient variable would not do.
module.exports = require('./_shared/request-scope.js').wrap(module.exports);
