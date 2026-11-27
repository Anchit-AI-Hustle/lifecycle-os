'use strict';
// THE ASSISTANT'S BUILT-IN KIT (2026-11-27).
//
// The operator, with five slides (tool-calling agents over MCP, RAG, a team of
// agents, an assistant with memory, an evaluation pipeline): "All this must be
// there by default, built in."
//
// What was already here: the tool-calling loop (brand-llm.js) and the team of
// maker / reviewer agents (marketing-agents.js). What was not: the assistant
// "searched" the knowledge base by testing whether any word of the question
// appeared anywhere in a row, remembered nothing between sessions, could not
// be reached by an MCP client, and nothing scored its answers.
//
// This module holds the three pieces every brand's assistant now has without
// setup:
//   RETRIEVAL  the brand's own record, catalogue, site pages (kb_knowledge) and
//              campaign library, cut into passages and RANKED. With the
//              workspace's own OpenAI key the passages are ranked by meaning
//              (embeddings); without one, by BM25 over words, and the answer
//              says which. Nothing is paraphrased: a passage is the source's
//              own text with where it came from.
//   MEMORY     what a person told the assistant to keep (a preference, a
//              decision, a fact about the brand), stored per workspace and
//              person, recalled into later turns. A memory marked shared is
//              read by every member's assistant and by the other agents.
//              With no table (or a device brand) the memory travels with the
//              request and the page keeps it; the answer says where it lives.
//   EVALUATION ai-eval.js reads `retrieve` and the stores from here.
//
// No model is called in this file except the optional embeddings request.

const MARKER = /\[\s*DATA REQUIRED/i;
const str = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const clip = (t, n) => { const s = str(t); return s.length > n ? s.slice(0, n) : s; };

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: String(url).replace(/\/$/, ''), key } : null;
}
// Every query names the workspace; the caller verified membership first.
async function svc(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const e = serviceEnv();
  if (!e) { const er = new Error('no_store'); er.code = 'no_store'; throw er; }
  const headers = { apikey: e.key, authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) { const er = new Error(`store answered ${res.status}`); er.code = res.status === 404 || /42P01|PGRST205/.test(text) ? 'no_table' : 'store_failed'; er.status = res.status; throw er; }
  return json;
}
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));

/* ── RETRIEVAL ────────────────────────────────────────────────────────────── */

const STOP = new Set('a an and are as at be by for from has have how i in is it its me my of on or our that the their this to us was we what when where which who why will with you your do does can about tell'.split(' '));
function tokens(t) {
  return str(t).toLowerCase().replace(/[^a-z0-9À-￿]+/g, ' ').split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w));
}

// Passages of at most ~90 words, cut on sentence ends, never mid-sentence.
function passages(text, max) {
  const sents = str(text).split(/(?<=[.!?])\s+/).filter(Boolean);
  const out = []; let cur = [];
  const words = (a) => a.join(' ').split(' ').length;
  for (const s of sents) {
    if (cur.length && words(cur.concat(s)) > (max || 90)) { out.push(cur.join(' ')); cur = []; }
    cur.push(s);
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

/**
 * The brand's own documents as passages: [{ id, source, title, url, text }].
 * `source` is one of record | catalogue | site | library | memory.
 */
async function corpus({ brand, workspaceId, market, extra } = {}) {
  const b = brand || {};
  const out = [];
  const add = (source, title, url, text) => {
    for (const p of passages(text)) {
      if (!p || MARKER.test(p) || p.length < 12) continue;
      out.push({ id: `${source}:${out.length}`, source, title: clip(title, 120), url: /^https?:\/\//i.test(String(url || '')) ? String(url) : '', text: clip(p, 900) });
    }
  };
  // 1. The record itself: what the brand says about itself, as stored.
  const site = /^https?:\/\//i.test(String(b.website || '')) ? String(b.website) : '';
  if (str(b.tagline)) add('record', `${b.name || 'Brand'}: tagline`, site, b.tagline);
  for (const c of Array.isArray(b.claims) ? b.claims : []) add('record', `${b.name || 'Brand'}: claim`, site, c);
  const bd = (b.brand_data && typeof b.brand_data === 'object') ? b.brand_data : {};
  if (str(b.description || bd.description)) add('record', `${b.name || 'Brand'}: description`, site, b.description || bd.description);
  for (const o of Array.isArray(b.offerings) ? b.offerings : []) { const n = str(o && o.name); if (n) add('record', `${b.name || 'Brand'}: offering`, o && o.url, `${n}${o && o.kind ? ` (${o.kind})` : ''}${o && o.description ? `. ${o.description}` : ''}`); }
  const v = b.voice || {};
  if (str(v.tone)) add('record', `${b.name || 'Brand'}: voice`, '', `Voice: ${v.tone}.${Array.isArray(v.banned) && v.banned.length ? ` Never says: ${v.banned.join(', ')}.` : ''}`);
  if (str(b.legal_entity)) add('record', `${b.name || 'Brand'}: legal entity`, '', `Legal entity: ${b.legal_entity}.`);
  // 2. Its catalogue (the provenance rule decides whose rows these are).
  try {
    const cat = require('./brand-catalog-server.js').productsFor(market || '', { brand: b }) || {};
    const rows = Array.isArray(cat) ? cat : (Array.isArray(cat.products) ? cat.products : []);
    for (const r of rows.slice(0, 300)) {
      const title = str(r.n || r.name || r.title);
      if (!title) continue;
      let desc = '';
      try { desc = str(require('./product-story.js').story({ description: r.desc || r.description || r.d || '' }).what); } catch (_) { desc = ''; }
      const pr = r.price != null && r.price !== '' ? r.price : (r.p != null ? r.p : '');
      const price = pr !== '' ? `Price ${pr}${r.currency ? ' ' + r.currency : ''}.` : '';
      add('catalogue', title, r.product_url || r.u || r.url, `${title}. ${desc ? desc + ' ' : ''}${price}`);
    }
  } catch (_) { /* no catalogue: the record and site still answer */ }
  // 3. Its own site's pages (verbatim descriptions and headings) and library.
  if (workspaceId && isUuid(workspaceId)) {
    try {
      const rows = await svc(`kb_knowledge?workspace_id=eq.${workspaceId}&select=title,url,summary,key_points&order=processed_at.desc&limit=200`);
      for (const r of Array.isArray(rows) ? rows : []) {
        const kp = Array.isArray(r.key_points) ? r.key_points.map(str).filter(Boolean).join('. ') : '';
        add('site', r.title || r.url, r.url, `${str(r.summary)}${kp ? ' ' + kp + '.' : ''}`);
      }
    } catch (_) { /* a store that does not answer leaves the other sources */ }
  }
  for (const x of Array.isArray(extra) ? extra : []) if (x && str(x.text)) add(x.source || 'library', x.title || '', x.url || '', x.text);
  return out;
}

// BM25 (k1 1.4, b 0.75) over the passages' title and text.
function bm25(query, docs) {
  const q = [...new Set(tokens(query))];
  if (!q.length || !docs.length) return [];
  const toks = docs.map((d) => tokens(`${d.title} ${d.title} ${d.text}`));
  const avg = toks.reduce((s, t) => s + t.length, 0) / docs.length || 1;
  const df = {};
  for (const t of toks) for (const w of new Set(t)) df[w] = (df[w] || 0) + 1;
  const scored = docs.map((d, i) => {
    const t = toks[i]; const tf = {};
    for (const w of t) tf[w] = (tf[w] || 0) + 1;
    let s = 0; const hit = [];
    for (const w of q) {
      const f = tf[w] || 0; if (!f) continue;
      hit.push(w);
      const idf = Math.log(1 + (docs.length - (df[w] || 0) + 0.5) / ((df[w] || 0) + 0.5));
      s += idf * (f * 2.4) / (f + 1.4 * (1 - 0.75 + 0.75 * t.length / avg));
    }
    return { doc: d, score: s, matched: hit };
  }).filter((x) => x.score > 0);
  scored.sort((a, c) => c.score - a.score);
  return scored;
}

// Ranking by meaning: OpenAI's embeddings endpoint (POST /v1/embeddings
// {model, input: [text]} -> data[i].embedding), only with a key the WORKSPACE
// connected, so the platform's money policy is untouched. Kept per instance by
// passage text; any refusal falls back to words.
const _vec = new Map();
const EMB_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
async function ownOpenAiKey() {
  try {
    const ov = await require('./workspace-connections-core.js').llmOverridesForCurrentRequest();
    const k = ov && ov.keys && ov.keys.openai;
    return k ? String(k).trim() : '';
  } catch (_) { return ''; }
}
async function embed(texts, key, fetchImpl) {
  const need = texts.filter((t) => !_vec.has(t));
  for (let i = 0; i < need.length; i += 96) {
    const batch = need.slice(i, i + 96);
    const res = await (fetchImpl || fetch)('https://api.openai.com/v1/embeddings', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: EMB_MODEL, input: batch }), signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`embeddings answered ${res.status}`);
    const j = await res.json();
    (j.data || []).forEach((d, k) => { if (Array.isArray(d.embedding)) _vec.set(batch[k], d.embedding); });
    if (_vec.size > 4000) for (const k of [..._vec.keys()].slice(0, 1000)) _vec.delete(k);
  }
  return texts.map((t) => _vec.get(t) || null);
}
function cosine(a, b) { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? d / Math.sqrt(x * y) : 0; }

/**
 * retrieve(query, { brand, workspaceId, market, limit, extra, key, fetchImpl })
 *  -> { items: [{ source, title, url, text, score, matched }], ranked_by, of, note }
 */
async function retrieve(query, opts = {}) {
  const docs = opts.docs || await corpus(opts);
  const limit = Math.max(1, Math.min(12, Number(opts.limit) || 6));
  if (!str(query)) return { items: [], ranked_by: 'none', of: docs.length, note: 'No question to search with.' };
  if (!docs.length) return { items: [], ranked_by: 'none', of: 0, note: 'This brand has no documents on record to search: no record lines, catalogue, site pages or library.' };
  const words = bm25(query, docs);
  let ranked_by = 'words'; let items = words.slice(0, limit).map((x) => Object.assign({}, x.doc, { score: +x.score.toFixed(3), matched: x.matched }));
  let note = 'Ranked by the words the question and the passage share (BM25). Connect your own OpenAI key on AI Models to rank by meaning.';
  const key = opts.key != null ? opts.key : await ownOpenAiKey();
  if (key) {
    try {
      // Meaning is judged over the passages words found first plus a slice of
      // the rest, so one request stays small.
      const pool = [...new Set(words.slice(0, 40).map((x) => x.doc).concat(docs.slice(0, 160)))].slice(0, 180);
      const vecs = await embed([str(query)].concat(pool.map((d) => `${d.title}. ${d.text}`)), key, opts.fetchImpl);
      const qv = vecs[0];
      if (qv) {
        const scored = pool.map((d, i) => ({ d, s: vecs[i + 1] ? cosine(qv, vecs[i + 1]) : 0 })).sort((a, c) => c.s - a.s).slice(0, limit);
        items = scored.filter((x) => x.s > 0.2).map((x) => Object.assign({}, x.d, { score: +x.s.toFixed(3), matched: [] }));
        ranked_by = 'meaning'; note = `Ranked by meaning (embeddings, ${EMB_MODEL}, your own OpenAI key).`;
      }
    } catch (e) { note = `Ranked by words (BM25): the embeddings request did not answer (${clip(e && e.message, 80)}).`; }
  }
  return { items, ranked_by, of: docs.length, note };
}

// The passages as a block for a prompt: numbered, each with where it is from.
function contextBlock(found) {
  const items = (found && found.items) || [];
  if (!items.length) return '';
  return ['PASSAGES FROM THIS BRAND\'S OWN RECORD, CATALOGUE AND SITE (use them before your own knowledge; cite the number, e.g. [2]; if they do not answer the question, say so):']
    .concat(items.map((x, i) => `[${i + 1}] (${x.source}${x.title ? ': ' + x.title : ''}${x.url ? ', ' + x.url : ''}) ${x.text}`)).join('\n');
}

/* ── MEMORY ───────────────────────────────────────────────────────────────── */

const KINDS = ['preference', 'decision', 'fact', 'context'];
const SECRET = /\b(sk-[A-Za-z0-9_-]{12,}|ABSK[A-Za-z0-9+/=_-]{12,}|hf_[A-Za-z0-9]{12,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{20,}\.|password\s*[:=]|\b\d{13,19}\b)/i;

// One memory as stored: a short sentence, never a secret, never a marker.
function cleanMemory(m) {
  const it = typeof m === 'string' ? { text: m } : (m || {});
  const text = clip(it.text, 280);
  if (!text || text.length < 6 || MARKER.test(text) || SECRET.test(text)) return null;
  return { text, kind: KINDS.includes(it.kind) ? it.kind : 'context', shared: it.shared === true };
}
const foldKey = (t) => str(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * What the assistant remembers for this person in this workspace, plus what
 * the workspace shares. `carried` is the device's own list (a brand kept on a
 * device, or a deployment with no memory table).
 */
async function memories({ workspaceId, userId, carried } = {}) {
  const own = (Array.isArray(carried) ? carried : []).map(cleanMemory).filter(Boolean).slice(0, 60).map((m, i) => Object.assign({ id: `device:${i}` }, m));
  if (!workspaceId || !isUuid(workspaceId) || !isUuid(userId)) return { items: own, storage: 'device', note: 'Kept on this device: this brand has no workspace on the server.' };
  try {
    const rows = await svc(`assistant_memory?workspace_id=eq.${workspaceId}&or=(user_id.eq.${userId},shared.is.true)&select=id,text,kind,shared,user_id,created_at&order=created_at.desc&limit=120`);
    const items = (Array.isArray(rows) ? rows : []).map((r) => ({ id: r.id, text: str(r.text), kind: r.kind, shared: !!r.shared, mine: r.user_id === userId, created_at: r.created_at }));
    return { items, storage: 'account' };
  } catch (e) {
    return { items: own, storage: 'device', note: e && e.code === 'no_table' ? 'Kept on this device: the memory table is not in this database yet.' : 'Kept on this device: the memory store did not answer.' };
  }
}

async function remember({ workspaceId, userId, items, existing } = {}) {
  const have = new Set((Array.isArray(existing) ? existing : []).map((m) => foldKey(m.text)));
  const fresh = [];
  for (const m of (Array.isArray(items) ? items : []).map(cleanMemory).filter(Boolean)) {
    const k = foldKey(m.text);
    if (!k || have.has(k)) continue;
    have.add(k); fresh.push(m);
    if (fresh.length >= 5) break;
  }
  if (!fresh.length) return { saved: [], storage: 'none' };
  if (workspaceId && isUuid(workspaceId) && isUuid(userId)) {
    try {
      const rows = await svc('assistant_memory', { method: 'POST', prefer: 'return=representation', body: fresh.map((m) => ({ workspace_id: workspaceId, user_id: userId, text: m.text, kind: m.kind, shared: m.shared })) });
      return { saved: (Array.isArray(rows) ? rows : []).map((r) => ({ id: r.id, text: r.text, kind: r.kind, shared: !!r.shared })), storage: 'account' };
    } catch (_) { /* falls to the device below */ }
  }
  return { saved: fresh, storage: 'device' };
}

async function forget({ workspaceId, userId, id } = {}) {
  if (!isUuid(workspaceId) || !isUuid(userId) || !isUuid(id)) return { ok: false, storage: 'device' };
  // Only the person's own memory: the user is on the filter.
  await svc(`assistant_memory?id=eq.${id}&workspace_id=eq.${workspaceId}&user_id=eq.${userId}`, { method: 'DELETE' });
  return { ok: true, storage: 'account' };
}

// The memories worth this turn: every preference, then the ones the message's
// words reach, at most `n`.
function relevant(items, message, n) {
  const list = Array.isArray(items) ? items : [];
  if (list.length <= (n || 8)) return list;
  const ranked = bm25(message, list.map((m, i) => ({ id: String(i), title: '', text: m.text }))).map((x) => list[Number(x.doc.id)]);
  const prefs = list.filter((m) => m.kind === 'preference' || m.kind === 'decision');
  return [...new Set(ranked.concat(prefs))].slice(0, n || 8);
}
function memoryBlock(items) {
  const list = (Array.isArray(items) ? items : []).filter((m) => m && m.text);
  if (!list.length) return '';
  return ['WHAT YOU REMEMBER FROM EARLIER SESSIONS (the person told you these; follow a preference or decision, and treat them as their words, not as verified data):']
    .concat(list.map((m) => `- (${m.kind}${m.shared ? ', shared with the team' : ''}) ${m.text}`)).join('\n');
}

module.exports = { retrieve, corpus, bm25, tokens, passages, contextBlock, memories, remember, forget, relevant, memoryBlock, cleanMemory, svc, serviceEnv, isUuid, KINDS };
