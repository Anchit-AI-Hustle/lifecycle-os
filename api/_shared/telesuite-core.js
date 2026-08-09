'use strict';
/**
 * telesuite-core.js — TeleSuite, the AI tele-sales / tele-support suite.
 * ---------------------------------------------------------------------------
 * A port of github.com/Anchit-AI-Hustle/AI-TeleSuite into this platform. Every
 * feature from that app's sidebar is present here as a TeleSuite subfeature,
 * with three deliberate changes:
 *
 *   1. Brand-aware. The original was hardcoded to one deployment; here every
 *      run is scoped to the caller's ACTIVE brand workspace and grounded in
 *      that brand's products, knowledge base and voice guardrails.
 *   2. Provider-agnostic. The original called Genkit/Gemini directly; here all
 *      text generation goes through this repo's 6-provider waterfall
 *      (_shared/llm.js), so it works on whichever keys are configured.
 *   3. Credit-metered. Every subfeature declares its cost in credit-catalog.js
 *      and is charged through credits-core's hold -> settle flow, so a failed
 *      run is always refunded.
 *
 * Storage moved from browser localStorage to Supabase (telesuite_items /
 * telesuite_runs), so work survives a device change and the dashboards are
 * filtered VIEWS of one runs table rather than seven separate stores.
 *
 * NOT a function file. Routed from api/brain.js ?action=telesuite&op=...
 * ---------------------------------------------------------------------------
 */

const callLLM = require('./llm.js');
const { parseJSON } = require('./llm.js');
const credits = require('./credits-core.js');
const brandCore = require('./brand-workspace-core.js');

const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];

/* ════════════════════════════════════════════════════════════════════════════
   THE REGISTRY — every AI-TeleSuite feature, as a TeleSuite subfeature.
   The hub page renders itself entirely from this, so adding a subfeature is a
   one-object change and its credit cost is never out of sync with the UI.
   ═══════════════════════════════════════════════════════════════════════════ */

const SUBFEATURES = [
  /* ── Core ─────────────────────────────────────────────────────────────── */
  { key: 'home', label: 'TeleSuite Home', group: 'Core', kind: 'home', icon: 'home',
    blurb: 'At-a-glance view of every TeleSuite module, its recent runs and its credit spend.' },

  { key: 'products', label: 'Products', group: 'Core', kind: 'library', item_kind: 'product', icon: 'box',
    blurb: 'The product catalog every TeleSuite generator is grounded in. Seeded from your brand catalog, editable here.',
    credit_key: 'telesuite.product_description',
    generate: { op: 'product_description', label: 'Generate description with AI' } },

  { key: 'knowledge-base', label: 'Knowledge Base', group: 'Core', kind: 'library', item_kind: 'knowledge', icon: 'book',
    blurb: 'Central repository of contextual documents and snippets used as grounding for pitches, rebuttals and scoring.',
    credit_key: 'telesuite.kb_ingest',
    generate: { op: 'kb_ingest', label: 'Summarise and categorise' } },

  /* ── Sales & Support Tools ────────────────────────────────────────────── */
  { key: 'pitch-generator', label: 'AI Pitch Generator', group: 'Sales & Support Tools', kind: 'tool', icon: 'bulb',
    blurb: 'Builds a structured, KB-grounded sales pitch: opening, discovery, value, proof, objection pre-empt and close.',
    op: 'pitch', credit_key: 'telesuite.pitch', output: 'sections',
    inputs: [
      { name: 'product', label: 'Product', type: 'product', required: true },
      { name: 'audience', label: 'Who are you pitching to?', type: 'text', placeholder: 'e.g. returning customer, 35-45, price aware' },
      { name: 'channel', label: 'Channel', type: 'select', options: ['Phone call', 'Video call', 'WhatsApp', 'Email'], default: 'Phone call' },
      { name: 'goal', label: 'Call goal', type: 'text', placeholder: 'e.g. book a demo, close the renewal' },
      { name: 'kb', label: 'Knowledge base context', type: 'kb' },
    ] },

  { key: 'rebuttal-generator', label: 'AI Rebuttal Assistant', group: 'Sales & Support Tools', kind: 'tool', icon: 'reply',
    blurb: 'Answers a live objection with the Acknowledge / Bridge / Benefit / Clarify model, plus a non-AI fallback if every provider is down.',
    op: 'rebuttal', credit_key: 'telesuite.rebuttal', output: 'sections',
    inputs: [
      { name: 'objection', label: 'What did the customer say?', type: 'textarea', required: true, placeholder: 'It is too expensive for what it is.' },
      { name: 'product', label: 'Product', type: 'product' },
      { name: 'tone', label: 'Tone', type: 'select', options: ['Warm', 'Direct', 'Consultative', 'Apologetic'], default: 'Consultative' },
      { name: 'kb', label: 'Knowledge base context', type: 'kb' },
    ] },

  /* ── Analysis & Reporting ─────────────────────────────────────────────── */
  { key: 'transcription', label: 'Audio Transcription', group: 'Analysis & Reporting', kind: 'tool', icon: 'mic',
    blurb: 'Transcribes a call recording with speaker turns and timestamps. Charged per minute of audio actually processed.',
    op: 'transcription', credit_key: 'telesuite.transcription', output: 'transcript',
    inputs: [
      { name: 'audio', label: 'Call recording', type: 'audio', accept: 'audio/*',
        help: 'Needs GEMINI_API_KEY for audio. No key, or no file? Paste the transcript below instead and the run is free.' },
      { name: 'transcript', label: 'Or paste a transcript', type: 'textarea', placeholder: 'Agent: ...\nCustomer: ...' },
      { name: 'language', label: 'Language', type: 'text', default: 'English', placeholder: 'English' },
    ] },

  { key: 'transcription-dashboard', label: 'Transcription DB', group: 'Analysis & Reporting', kind: 'dashboard',
    icon: 'list', of: 'transcription', blurb: 'Every transcription run, searchable, with the full text and export.' },

  { key: 'call-scoring', label: 'AI Call Scoring', group: 'Analysis & Reporting', kind: 'tool', icon: 'checks',
    blurb: 'Scores a call against a full rubric: opening, discovery, product knowledge, objection handling, compliance, close and soft skills.',
    op: 'call_scoring', credit_key: 'telesuite.call_scoring', output: 'score',
    inputs: [
      { name: 'transcript', label: 'Call transcript', type: 'textarea', required: true, placeholder: 'Agent: ...\nCustomer: ...' },
      { name: 'product', label: 'Product', type: 'product' },
      { name: 'agent_name', label: 'Agent name', type: 'text' },
      { name: 'rubric_focus', label: 'Extra focus areas', type: 'text', placeholder: 'e.g. compliance disclosure, discount discipline' },
      { name: 'kb', label: 'Knowledge base context', type: 'kb' },
    ] },

  { key: 'call-scoring-dashboard', label: 'Call Scoring DB', group: 'Analysis & Reporting', kind: 'dashboard',
    icon: 'chart', of: ['call_scoring', 'voice_sales_score', 'voice_support_score'],
    blurb: 'Every scored call — manual uploads and voice-agent calls together — with score trends by agent and product.' },

  { key: 'combined-call-analysis', label: 'Combined Call Analysis', group: 'Analysis & Reporting', kind: 'tool', icon: 'pie',
    blurb: 'Synthesises a batch of already-scored calls into trends: what consistently wins, what consistently loses, and what to change.',
    op: 'combined_analysis', credit_key: 'telesuite.combined_analysis', output: 'sections',
    inputs: [
      { name: 'run_ids', label: 'Scored calls to include', type: 'runpicker', of: 'call_scoring', required: true },
      { name: 'product', label: 'Product', type: 'product' },
      { name: 'question', label: 'What do you want to learn?', type: 'text', placeholder: 'Why do we lose after the price reveal?' },
    ],
    followups: [{ op: 'optimized_pitches', label: 'Generate optimised pitches from this analysis', credit_key: 'telesuite.optimized_pitches' }] },

  { key: 'combined-call-analysis-dashboard', label: 'Combined Analysis DB', group: 'Analysis & Reporting', kind: 'dashboard',
    icon: 'chart', of: ['combined_analysis', 'optimized_pitches'], blurb: 'Every batch analysis and the pitches generated from it.' },

  /* ── Voice Agents ─────────────────────────────────────────────────────── */
  { key: 'voice-sales-agent', label: 'AI Voice Sales Agent', group: 'Voice Agents', kind: 'voice', icon: 'phone',
    blurb: 'A live voice-to-voice sales conversation. Speech recognition and speech synthesis run in your browser; the agent turn is generated here. Supports barge-in and silence-based turn taking, and scores itself when the call ends.',
    op: 'voice_turn', mode: 'sales', credit_key: 'telesuite.voice_sales',
    inputs: [
      { name: 'product', label: 'Product', type: 'product', required: true },
      { name: 'persona', label: 'Customer persona', type: 'text', placeholder: 'Busy parent, price sensitive, has used a rival' },
      { name: 'goal', label: 'Call goal', type: 'text', default: 'Book the next step' },
      { name: 'kb', label: 'Knowledge base context', type: 'kb' },
    ] },

  { key: 'voice-sales-dashboard', label: 'Voice Sales DB', group: 'Voice Agents', kind: 'dashboard',
    icon: 'grid', of: ['voice_sales', 'voice_sales_score'], blurb: 'Every voice sales call: transcript, duration, credits and final score.' },

  { key: 'voice-support-agent', label: 'AI Voice Support Agent', group: 'Voice Agents', kind: 'voice', icon: 'ear',
    blurb: 'The same live voice loop tuned for support: resolve the issue, confirm understanding, and escalate honestly when it cannot.',
    op: 'voice_turn', mode: 'support', credit_key: 'telesuite.voice_support',
    inputs: [
      { name: 'product', label: 'Product', type: 'product', required: true },
      { name: 'issue', label: 'Issue context', type: 'text', placeholder: 'Order delayed, customer already chased twice' },
      { name: 'kb', label: 'Knowledge base context', type: 'kb' },
    ] },

  { key: 'voice-support-dashboard', label: 'Voice Support DB', group: 'Voice Agents', kind: 'dashboard',
    icon: 'grid', of: ['voice_support', 'voice_support_score'], blurb: 'Every voice support call with its transcript and resolution outcome.' },

  /* ── Content & Data Tools ─────────────────────────────────────────────── */
  { key: 'create-training-deck', label: 'Training Material Creator', group: 'Content & Data Tools', kind: 'tool', icon: 'deck',
    blurb: 'Generates a structured training document — modules, learning objectives, talk tracks, drills and a knowledge check.',
    op: 'training_deck', credit_key: 'telesuite.training_deck', output: 'sections',
    inputs: [
      { name: 'topic', label: 'Topic', type: 'text', required: true, placeholder: 'Handling price objections on renewal calls' },
      { name: 'audience', label: 'Who is being trained?', type: 'text', placeholder: 'New telesales hires, week 2' },
      { name: 'framework', label: 'Framework', type: 'select', options: ['Auto (synthesise from context)', 'Sales deck', 'Telesales data analysis framework', 'Onboarding curriculum'], default: 'Auto (synthesise from context)' },
      { name: 'duration', label: 'Session length', type: 'text', placeholder: '90 minutes' },
      { name: 'kb', label: 'Knowledge base context', type: 'kb' },
    ] },

  { key: 'training-material-dashboard', label: 'Material DB', group: 'Content & Data Tools', kind: 'dashboard',
    icon: 'deck', of: 'training_deck', blurb: 'Every training document generated, with export.' },

  { key: 'data-analysis', label: 'AI Data Analyst', group: 'Content & Data Tools', kind: 'tool', icon: 'search',
    blurb: 'Analyses tabular data you paste or describe and returns findings, segment cuts and recommended actions. States plainly which parts are computed from the rows you supplied and which are inference from your description.',
    op: 'data_analysis', credit_key: 'telesuite.data_analysis', output: 'sections',
    inputs: [
      { name: 'data', label: 'Paste your data (CSV or TSV)', type: 'textarea', placeholder: 'date,agent,calls,connects,sales\n2026-08-01,Asha,120,54,7' },
      { name: 'description', label: 'Describe the data and your goal', type: 'textarea', required: true, placeholder: 'Daily telesales performance by agent. I want to know who is improving and where connects are being wasted.' },
      { name: 'questions', label: 'Specific questions', type: 'textarea', placeholder: 'One per line' },
    ] },

  { key: 'data-analysis-dashboard', label: 'Data Analysis DB', group: 'Content & Data Tools', kind: 'dashboard',
    icon: 'chart', of: 'data_analysis', blurb: 'Every analysis run with its findings.' },

  { key: 'batch-audio-downloader', label: 'Batch Audio Downloader', group: 'Content & Data Tools', kind: 'client', icon: 'download',
    credit_key: 'telesuite.batch_audio',
    blurb: 'Fetches many recordings from a list of URLs and bundles them into a ZIP. Runs entirely in your browser, so it costs no credits — and it can only reach servers that allow cross-origin downloads.' },

  /* ── System ───────────────────────────────────────────────────────────── */
  { key: 'activity-dashboard', label: 'Global Activity Log', group: 'System', kind: 'dashboard',
    icon: 'activity', of: '*', credit_key: 'telesuite.activity_log',
    blurb: 'Master log of every TeleSuite run across every module, with the credits each one cost.' },

  { key: 'clone-app', label: 'Clone Full App', group: 'System', kind: 'clone', icon: 'server',
    credit_key: 'telesuite.clone_app',
    blurb: 'The replication brief for this TeleSuite build: what each module does, which endpoint runs it and what it costs.' },

  { key: 'n8n-workflow', label: 'n8n Workflow', group: 'System', kind: 'n8n', icon: 'workflow',
    credit_key: 'telesuite.n8n_workflow',
    blurb: 'Downloads an n8n workflow wired to the TeleSuite endpoints, so runs can be automated outside the app.' },
];

function subfeature(key) { return SUBFEATURES.find((s) => s.key === key) || null; }

/* ── shared helpers ───────────────────────────────────────────────────────── */

function str(v, max) { const s = String(v == null ? '' : v).trim(); return max ? s.slice(0, max) : s; }

async function serviceRest(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) { const e = new Error('Supabase is not configured on this deployment.'); e.status = 503; throw e; }
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) { const e = new Error(`telesuite ${method} ${pathAndQuery} -> ${res.status}: ${text}`); e.status = 502; throw e; }
  return json;
}

/**
 * Resolve the caller's active brand workspace — TeleSuite is always per-brand.
 *
 * Also resolves the caller's ROLE. This matters because every TeleSuite write
 * below goes through the service role (to keep the queries simple), which
 * bypasses RLS — so membership alone is not authorization. A workspace member
 * with role `viewer` must not be able to write, and `canWrite` is what enforces
 * that. The owner always has full rights.
 */
async function context(req) {
  const auth = await brandCore.requireUser(req);
  if (!auth.ok) return { ok: false, auth };
  const body = (req && req.body) || {};
  const q = (req && req.query) || {};
  let wsId = str(body.workspace_id || q.workspace_id);
  if (!wsId) wsId = await brandCore.activeWorkspaceId(auth);
  if (!wsId) {
    return { ok: false, status: 409, error: 'no_active_brand', message: 'Onboard a brand first — TeleSuite runs against your active brand workspace.' };
  }
  // Read through the CALLER'S token, so RLS is what decides they may see it.
  const brand = await brandCore.getWorkspace(auth, wsId);
  if (!brand) return { ok: false, status: 404, error: 'workspace_not_found' };

  let role = 'viewer';
  if (brand.owner_id && brand.owner_id === auth.user_id) role = 'owner';
  else {
    try {
      const rows = await brandCore.restAs(auth.token, `brand_workspace_members?select=role&workspace_id=eq.${encodeURIComponent(wsId)}&user_id=eq.${encodeURIComponent(auth.user_id)}&limit=1`);
      if (Array.isArray(rows) && rows[0] && rows[0].role) role = String(rows[0].role);
    } catch (_) { /* fall through as viewer — least privilege on an unknown role */ }
  }
  return { ok: true, auth, workspace_id: wsId, brand, role, canWrite: role === 'owner' || role === 'editor' };
}

/** Ops that change state or spend credits. Viewers may do none of them. */
const WRITE_OPS = new Set([
  'item-save', 'item-delete', 'items-seed', 'run-delete',
  'product_description', 'kb_ingest', 'pitch', 'rebuttal', 'transcription',
  'call_scoring', 'combined_analysis', 'optimized_pitches', 'training_deck',
  'data_analysis', 'voice_turn', 'voice_finish',
]);

/** The brand guardrails every TeleSuite prompt inherits. */
function brandRules(brand) {
  const v = (brand && brand.voice) || {};
  const lines = [`You are working for the brand "${(brand && brand.name) || 'this brand'}".`];
  if (brand && brand.tagline) lines.push(`Positioning: ${brand.tagline}.`);
  if (v.tone) lines.push(`Voice: ${v.tone}.`);
  if (Array.isArray(v.preferred) && v.preferred.length) lines.push(`Prefer this vocabulary where it fits naturally: ${v.preferred.join(', ')}.`);
  if (Array.isArray(v.banned) && v.banned.length) lines.push(`NEVER use these phrases: ${v.banned.join('; ')}.`);
  if (v.no_em_dashes !== false) lines.push('Never use em dashes or en dashes. Use commas, colons or plain hyphens.');
  lines.push(
    'ZERO FABRICATION: never invent a product fact, price, statistic, review, customer name, guarantee or policy.',
    'Use only the product and knowledge base context supplied. If a needed fact is missing, write exactly',
    '[DATA REQUIRED BEFORE LAUNCH: <field>, <product>, <region>] in its place and carry on.'
  );
  return lines.join('\n');
}

/** Products + KB rows the caller selected, rendered as prompt context. */
async function groundingFor(ctx, { product, kbIds }) {
  const parts = [];
  const wid = encodeURIComponent(ctx.workspace_id);

  if (product) {
    const rows = await serviceRest(`telesuite_items?select=name,category,content,attributes&workspace_id=eq.${wid}&kind=eq.product&name=eq.${encodeURIComponent(product)}&limit=1`);
    if (Array.isArray(rows) && rows[0]) {
      const p = rows[0];
      parts.push(`PRODUCT: ${p.name}\n${p.category ? `Category: ${p.category}\n` : ''}${p.content || ''}\n${Object.keys(p.attributes || {}).length ? `Attributes: ${JSON.stringify(p.attributes)}` : ''}`);
    } else {
      // Fall back to the brand's imported catalog rather than inventing one.
      const cat = await serviceRest(`brand_catalog_products?select=title,description,product_type,price,currency,product_url&workspace_id=eq.${wid}&title=eq.${encodeURIComponent(product)}&limit=1`);
      if (Array.isArray(cat) && cat[0]) parts.push(`PRODUCT (from brand catalog): ${JSON.stringify(cat[0])}`);
      else parts.push(`PRODUCT: ${product}\n[DATA REQUIRED BEFORE LAUNCH: product details, ${product}, all] — no catalog or TeleSuite entry exists for this product.`);
    }
  }

  const ids = Array.isArray(kbIds) ? kbIds.filter(Boolean).slice(0, 20) : [];
  if (ids.length) {
    const list = ids.map((i) => `"${i}"`).join(',');
    const rows = await serviceRest(`telesuite_items?select=name,category,content&workspace_id=eq.${wid}&kind=eq.knowledge&id=in.(${encodeURIComponent(list)})&limit=20`);
    for (const k of Array.isArray(rows) ? rows : []) {
      parts.push(`KNOWLEDGE [${k.category || 'general'}] ${k.name}:\n${str(k.content, 4000)}`);
    }
  }
  return parts.length ? parts.join('\n\n---\n\n') : '(no product or knowledge base context was selected)';
}

/** One JSON-returning model call through the 6-provider waterfall. */
async function ask(ctx, { system, user, maxTokens = 2600, temperature = 0.6, stage, json = true }) {
  const r = await callLLM({
    systemPrompt: `${brandRules(ctx.brand)}\n\n${system}`,
    userMessage: user,
    responseFormat: json ? { type: 'json_object' } : null,
    maxTokens, temperature, timeoutMs: 60000, stage: stage || 'telesuite',
  });
  if (!json) return { data: r.text, provider: r.provider, model: r.model };
  let data;
  try { data = parseJSON(r.text); }
  catch (_) { data = { summary: r.text }; }   // never lose the model's work on a parse slip
  return { data, provider: r.provider, model: r.model };
}

async function logRun(ctx, row) {
  try {
    const saved = await serviceRest('telesuite_runs?select=id,created_at', {
      method: 'POST',
      body: [Object.assign({ workspace_id: ctx.workspace_id, user_id: ctx.auth.user_id }, row)],
      prefer: 'return=representation',
    });
    return Array.isArray(saved) ? saved[0] : saved;
  } catch (_) { return null; }   // logging must never fail a successful run
}

/* ════════════════════════════════════════════════════════════════════════════
   OPERATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

const OPS = {};

/* ── Products / Knowledge Base ────────────────────────────────────────────── */

OPS.product_description = async (ctx, input) => {
  const name = str(input.name || input.product, 200);
  if (!name) { const e = new Error('Product name is required.'); e.status = 400; throw e; }
  const out = await ask(ctx, {
    stage: 'telesuite-product',
    system: [
      'You write product descriptions for a telesales team to use as grounding context.',
      'Return JSON: {"description":"2-4 sentences","key_points":["..."],"ideal_for":"who it suits","talk_track":"one line an agent can say","missing":["facts you needed but were not given"]}',
      'Do not invent specifications, prices, materials or claims. Anything you were not told goes in "missing".',
    ].join('\n'),
    user: `Product name: ${name}\nCategory: ${str(input.category) || '(not given)'}\nWhat the operator told us:\n${str(input.content, 4000) || '(nothing beyond the name)'}\nKnown attributes: ${JSON.stringify(input.attributes || {})}`,
  });
  return { result: out.data, provider: out.provider };
};

OPS.kb_ingest = async (ctx, input) => {
  const content = str(input.content, 20000);
  if (!content) { const e = new Error('Paste or upload the document text first.'); e.status = 400; throw e; }
  const out = await ask(ctx, {
    stage: 'telesuite-kb',
    system: [
      'You are indexing a document into a telesales knowledge base.',
      'Return JSON: {"title":"","category":"one of: product, pricing, objection handling, compliance, process, competitor, customer proof, other","summary":"3-5 sentences","key_facts":["verbatim facts an agent can quote"],"usable_for":["pitch","rebuttal","scoring"],"cautions":["anything an agent must NOT claim from this"]}',
      'key_facts must be quoted or closely paraphrased from the document. Never add a fact the document does not contain.',
    ].join('\n'),
    user: `Suggested title: ${str(input.name) || '(none)'}\n\nDOCUMENT:\n${content}`,
  });
  return { result: out.data, provider: out.provider };
};

/* ── Pitch / Rebuttal ─────────────────────────────────────────────────────── */

OPS.pitch = async (ctx, input) => {
  const grounding = await groundingFor(ctx, { product: str(input.product), kbIds: input.kb });
  const out = await ask(ctx, {
    stage: 'telesuite-pitch',
    maxTokens: 3200,
    system: [
      'You are a world-class sales agent writing a pitch another agent will deliver live.',
      'Return JSON with exactly these keys:',
      '{"opening":"","permission_question":"","discovery_questions":["3-5"],"value_proposition":"",',
      ' "proof":["only proof present in the context"],"objection_preempt":[{"objection":"","response":""}],',
      ' "close":"","fallback_close":"","do_not_say":["phrases that would breach the brand rules or overclaim"],',
      ' "missing_context":["facts you needed and did not have"]}',
      'Every claim must trace to the supplied context. Write for the ear, not the page: short sentences an agent can say out loud.',
    ].join('\n'),
    user: `CONTEXT\n${grounding}\n\nAUDIENCE: ${str(input.audience) || '(not specified)'}\nCHANNEL: ${str(input.channel) || 'Phone call'}\nCALL GOAL: ${str(input.goal) || '(not specified)'}`,
  });
  return { result: out.data, provider: out.provider, title: `Pitch: ${str(input.product) || 'general'}` };
};

/** Deterministic rebuttal used when every provider is down (ported behaviour). */
function fallbackRebuttal(objection, tone) {
  const o = str(objection, 300);
  return {
    acknowledge: `I hear you, and that is a fair thing to raise.`,
    bridge: `A lot of people say the same thing before they see how this actually works for them.`,
    benefit: `[DATA REQUIRED BEFORE LAUNCH: product benefit relevant to this objection, all, all]`,
    clarify: `Can I ask what would need to be true for this to be worth it for you?`,
    full_response: `I hear you, and that is a fair thing to raise. A lot of people say the same before they see how it works for them. Can I ask what would need to be true for this to be worth it for you?`,
    tone: tone || 'Consultative',
    generated_by: 'fallback',
    note: `Every AI provider was unavailable, so this is the built-in structural fallback for: "${o}". It contains no product claims — fill the benefit line from your knowledge base before using it.`,
  };
}

OPS.rebuttal = async (ctx, input) => {
  const objection = str(input.objection, 2000);
  if (!objection) { const e = new Error('Enter the objection first.'); e.status = 400; throw e; }
  const grounding = await groundingFor(ctx, { product: str(input.product), kbIds: input.kb });
  try {
    const out = await ask(ctx, {
      stage: 'telesuite-rebuttal',
      temperature: 0.5,
      system: [
        'You handle live sales objections using the Acknowledge, Bridge, Benefit, Clarify model.',
        'Return JSON: {"acknowledge":"","bridge":"","benefit":"","clarify":"","full_response":"the four joined into something natural to say",',
        ' "if_they_push_back":"","escalate_if":"when the agent should stop selling","evidence_used":["which context lines you relied on"],"missing_context":[]}',
        'The benefit must come from the supplied context. If the context does not support one, put the DATA REQUIRED marker there.',
      ].join('\n'),
      user: `CONTEXT\n${grounding}\n\nOBJECTION: "${objection}"\nTONE: ${str(input.tone) || 'Consultative'}`,
    });
    return { result: Object.assign({ generated_by: out.provider }, out.data), provider: out.provider, title: objection.slice(0, 80) };
  } catch (err) {
    return { result: fallbackRebuttal(objection, str(input.tone)), provider: 'fallback', title: objection.slice(0, 80), degraded: String(err.message || err).slice(0, 200) };
  }
};

/* ── Transcription ────────────────────────────────────────────────────────── */

/** Gemini multimodal transcription. Returns null when no key is configured. */
async function geminiTranscribe(base64, mime, language) {
  const key = String(process.env.GEMINI_API_KEY || '').replace(/[﻿​]/g, '').trim();
  if (!key) return null;
  const prompt = `Transcribe this call recording verbatim in ${language || 'English'}. Label each turn as "Agent:" or "Customer:" based on who is speaking. Include a [mm:ss] timestamp at the start of each turn. Do not summarise, correct grammar, or add anything that was not said. If a passage is inaudible write [inaudible].`;
  let lastErr = '';
  for (const model of GEMINI_MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime || 'audio/mpeg', data: base64 } }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        }),
      });
      if (!r.ok) { lastErr = `${model}: ${r.status} ${(await r.text()).slice(0, 200)}`; continue; }
      const j = await r.json();
      const text = (((j.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('') || '';
      if (text.trim()) return { text: text.trim(), model };
      lastErr = `${model}: empty response`;
    } catch (e) { lastErr = `${model}: ${e.message}`; }
  }
  const e = new Error(`Transcription failed. ${lastErr}`);
  e.status = 502;
  throw e;
}

OPS.transcription = async (ctx, input) => {
  const pasted = str(input.transcript, 200000);
  if (pasted) {
    // Nothing was generated, so this path bills zero units (see units below).
    return { result: { transcript: pasted, source: 'pasted', turns: pasted.split(/\n+/).filter(Boolean).length }, units: 0, provider: 'none' };
  }
  const audio = input.audio;
  if (!audio || !audio.data) {
    const e = new Error('Attach an audio file, or paste a transcript.');
    e.status = 400; throw e;
  }
  const minutes = Number(input.duration_minutes) > 0 ? Number(input.duration_minutes) : null;
  const out = await geminiTranscribe(String(audio.data), str(audio.mime) || 'audio/mpeg', str(input.language));
  if (!out) {
    const e = new Error('Audio transcription needs GEMINI_API_KEY on this deployment. Paste the transcript instead and the run is free.');
    e.status = 503; throw e;
  }
  return {
    result: { transcript: out.text, source: 'audio', model: out.model, filename: str(audio.name), minutes },
    units: minutes || 1,
    provider: 'gemini',
    title: str(audio.name) || 'Recording',
  };
};

/* ── Call scoring ─────────────────────────────────────────────────────────── */

const SCORING_DIMENSIONS = [
  'Opening and rapport', 'Permission and agenda setting', 'Discovery quality',
  'Listening and not interrupting', 'Product knowledge accuracy', 'Value articulation',
  'Objection handling', 'Compliance and honesty', 'Next-step clarity', 'Close attempt',
  'Tone and energy', 'Call control and pacing',
];

OPS.call_scoring = async (ctx, input) => {
  const transcript = str(input.transcript, 120000);
  if (!transcript) { const e = new Error('Paste the call transcript first.'); e.status = 400; throw e; }
  const grounding = await groundingFor(ctx, { product: str(input.product), kbIds: input.kb });
  const out = await ask(ctx, {
    stage: 'telesuite-scoring',
    maxTokens: 4000,
    temperature: 0.25,
    system: [
      'You are a quality analyst scoring one sales or support call. Be exacting and evidence-bound.',
      `Score every one of these dimensions from 0 to 10: ${SCORING_DIMENSIONS.join('; ')}.`,
      'Return JSON: {"overall_score":0-100,"outcome":"won|lost|follow_up|unresolved|unclear",',
      ' "dimensions":[{"name":"","score":0,"weight":1,"evidence":"a VERBATIM quote from the transcript","comment":""}],',
      ' "strengths":["with quotes"],"improvements":[{"issue":"","quote":"","instead_say":""}],',
      ' "compliance_flags":["anything said that was inaccurate, overclaimed or non-compliant, with the quote"],',
      ' "factual_errors":["claims the agent made that contradict the product context, with quotes"],',
      ' "coaching_summary":"3-4 sentences to the agent","missing_context":[]}',
      'Every score MUST carry a verbatim quote as evidence. If the transcript does not evidence a dimension, score it and say "not observed" in the evidence.',
      'Never invent transcript content. Never soften a compliance issue.',
    ].join('\n'),
    user: `PRODUCT CONTEXT\n${grounding}\n\nAGENT: ${str(input.agent_name) || '(not given)'}\nEXTRA FOCUS: ${str(input.rubric_focus) || '(none)'}\n\nTRANSCRIPT\n${transcript}`,
  });
  const score = Number(out.data && out.data.overall_score);
  return {
    result: out.data,
    score: Number.isFinite(score) ? score : null,
    provider: out.provider,
    title: `${str(input.agent_name) || 'Call'} — ${Number.isFinite(score) ? score : 'unscored'}`,
  };
};

/* ── Combined analysis ────────────────────────────────────────────────────── */

OPS.combined_analysis = async (ctx, input) => {
  const ids = (Array.isArray(input.run_ids) ? input.run_ids : []).filter(Boolean).slice(0, 40);
  if (!ids.length) { const e = new Error('Select at least one scored call.'); e.status = 400; throw e; }
  const list = ids.map((i) => `"${i}"`).join(',');
  const rows = await serviceRest(`telesuite_runs?select=id,title,score,product,output,created_at&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}&id=in.(${encodeURIComponent(list)})&limit=40`);
  const reports = Array.isArray(rows) ? rows : [];
  if (!reports.length) { const e = new Error('None of those runs were found in this workspace.'); e.status = 404; throw e; }

  const digest = reports.map((r, i) => {
    const o = r.output || {};
    return `CALL ${i + 1} (${r.title || r.id}) score=${r.score == null ? 'n/a' : r.score}\n` +
      `outcome: ${o.outcome || 'unknown'}\n` +
      `dimensions: ${(o.dimensions || []).map((d) => `${d.name}=${d.score}`).join(', ')}\n` +
      `improvements: ${(o.improvements || []).map((x) => x.issue).join(' | ')}\n` +
      `compliance: ${(o.compliance_flags || []).join(' | ') || 'none'}`;
  }).join('\n\n');

  const out = await ask(ctx, {
    stage: 'telesuite-combined',
    maxTokens: 3600,
    temperature: 0.3,
    system: [
      'You synthesise a batch of already-scored calls into what the team should change.',
      'Return JSON: {"calls_analysed":0,"average_score":0,"score_range":{"min":0,"max":0},',
      ' "what_consistently_works":[{"pattern":"","seen_in":0,"evidence":""}],',
      ' "what_consistently_fails":[{"pattern":"","seen_in":0,"cost":"what it costs the team","evidence":""}],',
      ' "weakest_dimensions":[{"name":"","average":0}],"outcome_split":{},',
      ' "coaching_priorities":[{"priority":1,"focus":"","drill":"a concrete exercise"}],',
      ' "script_changes":[{"where":"","from":"","to":"","why":""}],',
      ' "caveats":["what this batch cannot tell you, including sample size limits"]}',
      'Counts must be actual counts across the supplied reports. Never generalise beyond this batch, and always state the sample size in caveats.',
    ].join('\n'),
    user: `QUESTION: ${str(input.question) || 'What should we change to win more of these calls?'}\nPRODUCT: ${str(input.product) || '(mixed)'}\nBATCH SIZE: ${reports.length}\n\n${digest}`,
  });
  return { result: Object.assign({ source_run_ids: ids }, out.data), provider: out.provider, title: `Batch of ${reports.length} calls` };
};

OPS.optimized_pitches = async (ctx, input) => {
  const analysisId = str(input.analysis_id);
  let analysis = input.analysis;
  if (!analysis && analysisId) {
    const rows = await serviceRest(`telesuite_runs?select=output,title&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}&id=eq.${encodeURIComponent(analysisId)}&limit=1`);
    analysis = Array.isArray(rows) && rows[0] ? rows[0].output : null;
  }
  if (!analysis) { const e = new Error('Run a combined analysis first, then generate pitches from it.'); e.status = 400; throw e; }
  const grounding = await groundingFor(ctx, { product: str(input.product), kbIds: input.kb });
  const out = await ask(ctx, {
    stage: 'telesuite-optpitch',
    maxTokens: 3200,
    system: [
      'You rewrite the sales script using ONLY what a batch analysis proved.',
      'Return JSON: {"pitches":[{"name":"","when_to_use":"","opening":"","value":"","proof":[],"objection_preempt":[{"objection":"","response":""}],"close":"","grounded_in":"which analysis finding this comes from"}],',
      ' "removed":[{"line":"","why_removed":"which finding says it fails"}],"test_plan":"how to A/B these against the current script"}',
      'Every pitch element must cite the finding it came from in "grounded_in". Do not add product claims that are not in the product context.',
    ].join('\n'),
    user: `PRODUCT CONTEXT\n${grounding}\n\nBATCH ANALYSIS\n${JSON.stringify(analysis).slice(0, 12000)}`,
  });
  return { result: out.data, provider: out.provider, title: 'Optimised pitches' };
};

/* ── Training deck / Data analyst ─────────────────────────────────────────── */

OPS.training_deck = async (ctx, input) => {
  const topic = str(input.topic, 400);
  if (!topic) { const e = new Error('Enter a topic.'); e.status = 400; throw e; }
  const grounding = await groundingFor(ctx, { product: str(input.product), kbIds: input.kb });
  const out = await ask(ctx, {
    stage: 'telesuite-deck',
    maxTokens: 4000,
    system: [
      'You build training material for a telesales or support team.',
      'Return JSON: {"title":"","audience":"","duration":"","learning_objectives":["3-6, each measurable"],',
      ' "modules":[{"number":1,"title":"","minutes":0,"teaching_points":[""],"talk_track":"what the trainer says","exercise":{"name":"","instructions":"","success_looks_like":""}}],',
      ' "role_play":{"scenario":"","customer_brief":"","agent_brief":"","observer_checklist":[""]},',
      ' "knowledge_check":[{"question":"","answer":"","why_it_matters":""}],',
      ' "handout_summary":"","missing_context":[]}',
      'Ground every product claim in the supplied context. Use the requested framework if one is named; otherwise synthesise from the context.',
    ].join('\n'),
    user: `TOPIC: ${topic}\nAUDIENCE: ${str(input.audience) || '(not specified)'}\nFRAMEWORK: ${str(input.framework) || 'Auto'}\nSESSION LENGTH: ${str(input.duration) || '(not specified)'}\n\nCONTEXT\n${grounding}`,
  });
  return { result: out.data, provider: out.provider, title: (out.data && out.data.title) || topic };
};

OPS.data_analysis = async (ctx, input) => {
  const description = str(input.description, 8000);
  if (!description) { const e = new Error('Describe the data and what you want to learn.'); e.status = 400; throw e; }
  const data = str(input.data, 120000);
  const out = await ask(ctx, {
    stage: 'telesuite-data',
    maxTokens: 3600,
    temperature: 0.3,
    system: [
      'You are a data analyst. You have two possible inputs: actual rows, and the user\'s description of their data.',
      'Return JSON: {"basis":"rows|description|both","row_count":0,"columns":[""],',
      ' "findings":[{"finding":"","computed_from":"rows|description","numbers":"the actual figures, or null if not computable","confidence":"high|medium|low"}],',
      ' "segments":[{"cut":"","observation":""}],"anomalies":[""],',
      ' "recommended_actions":[{"action":"","expected_effect":"","how_to_measure":""}],',
      ' "cannot_answer":["questions the supplied data cannot answer, and what data would be needed"],',
      ' "disclaimer":""}',
      'CRITICAL: if rows were supplied, compute from them and mark those findings computed_from="rows". If only a description was supplied, every finding is inference and must be marked computed_from="description" with confidence set honestly, and the disclaimer must say plainly that no data was actually processed. Never present an inferred number as a measured one.',
    ].join('\n'),
    user: `WHAT THE USER SAYS ABOUT THE DATA\n${description}\n\nSPECIFIC QUESTIONS\n${str(input.questions) || '(none)'}\n\nDATA ROWS\n${data || '(none supplied — analyse from the description only, and say so)'}`,
  });
  return { result: out.data, provider: out.provider, title: description.slice(0, 80) };
};

/* ── Voice agents ─────────────────────────────────────────────────────────── */

OPS.voice_turn = async (ctx, input) => {
  const mode = str(input.mode) === 'support' ? 'support' : 'sales';
  const history = Array.isArray(input.history) ? input.history.slice(-16) : [];
  const heard = str(input.utterance, 4000);
  const grounding = await groundingFor(ctx, { product: str(input.product), kbIds: input.kb });

  const persona = mode === 'sales'
    ? `You are a telesales agent on a live phone call. Goal: ${str(input.goal) || 'move the customer to the next step'}. The customer persona is: ${str(input.persona) || 'unknown, adapt as you learn'}.`
    : `You are a customer support agent on a live phone call. Resolve the issue, confirm understanding, and escalate honestly if you cannot. Issue context: ${str(input.issue) || 'not yet known'}.`;

  const out = await ask(ctx, {
    stage: 'telesuite-voice',
    maxTokens: 700,
    temperature: 0.6,
    system: [
      persona,
      'This is SPOKEN. Reply in at most 45 words, in plain conversational language, with no lists, no markdown and no stage directions.',
      'Return JSON: {"say":"what you say out loud","intent":"greeting|discovery|answer|objection|value|close|resolve|escalate|closing",',
      ' "asked_question":true|false,"should_end":false,"end_reason":"","internal_note":"one line for the QA log","needs_fact":""}',
      'If you need a fact you were not given, do not invent it: set needs_fact and say something honest such as that you will confirm it and come back.',
      'Always end your turn with either a question or a clear next step, so the customer knows it is their turn.',
    ].join('\n'),
    user: `CONTEXT\n${grounding}\n\nCONVERSATION SO FAR\n${history.map((h) => `${h.role === 'agent' ? 'You' : 'Customer'}: ${str(h.text, 800)}`).join('\n') || '(the call just connected)'}\n\nCUSTOMER JUST SAID: ${heard || '(nothing yet — open the call)'}`,
  });
  return { result: out.data, provider: out.provider, skip_log: true };  // turns are logged once, at call end
};

/**
 * Called ONCE when a voice call ends: stores the call, then scores it.
 * This is the billing boundary for the whole call (see OP_TO_SUBFEATURE), so it
 * is also where double-submission has to be stopped — a retry or a double click
 * must not charge the call twice. The client sends a `call_id` it generated at
 * the start of the call, and an existing run with that id short-circuits.
 */
OPS.voice_finish = async (ctx, input) => {
  const mode = str(input.mode) === 'support' ? 'support' : 'sales';
  const turns = Array.isArray(input.history) ? input.history : [];
  if (!turns.length) { const e = new Error('No conversation to save.'); e.status = 400; throw e; }
  const transcript = turns.map((t) => `${t.role === 'agent' ? 'Agent' : 'Customer'}: ${str(t.text, 2000)}`).join('\n');
  const minutes = Number(input.minutes) > 0 ? Number(input.minutes) : null;
  const callId = str(input.call_id, 64);

  if (callId) {
    const dupe = await serviceRest(`telesuite_runs?select=id,output&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}&input->>call_id=eq.${encodeURIComponent(callId)}&limit=1`);
    if (Array.isArray(dupe) && dupe[0]) {
      // Already saved and already paid for. Return it, bill nothing.
      return { result: { call_id: dupe[0].id, transcript, turns: turns.length, minutes, already_saved: true, score: null }, units: 0, skip_log: true };
    }
  }

  const call = await logRun(ctx, {
    feature: mode === 'sales' ? 'voice_sales' : 'voice_support',
    title: `${mode === 'sales' ? 'Sales' : 'Support'} call — ${str(input.product) || 'general'}`,
    product: str(input.product) || null,
    input: { call_id: callId || null, persona: str(input.persona), issue: str(input.issue), goal: str(input.goal), minutes },
    output: { transcript, turns: turns.length },
    units: minutes, duration_ms: Number(input.duration_ms) || null,
    credits: 0, credit_ref: null,   // patched with the real charge after settle
  });

  // Post-call scoring, exactly as the original app did automatically.
  let scored = null;
  if (input.score !== false) {
    try {
      const s = await OPS.call_scoring(ctx, { transcript, product: input.product, agent_name: `AI ${mode} agent`, kb: input.kb });
      scored = await logRun(ctx, {
        feature: mode === 'sales' ? 'voice_sales_score' : 'voice_support_score',
        title: s.title, product: str(input.product) || null,
        input: { call_run_id: call && call.id },
        output: s.result, score: s.score, provider: s.provider,
      });
      scored = scored ? Object.assign({}, scored, { output: s.result, score: s.score }) : null;
    } catch (err) {
      scored = { error: String(err.message || err).slice(0, 300) };
    }
  }
  return {
    result: { call_id: call && call.id, transcript, turns: turns.length, minutes, score: scored },
    units: minutes || 1,          // the call is billed on its real length, once
    run_row_id: call && call.id,  // so the handler can stamp the real charge on it
    skip_log: true,
  };
};

/* ── System subfeatures ───────────────────────────────────────────────────── */

function n8nWorkflow(baseUrl) {
  const base = baseUrl || 'https://your-deployment.vercel.app';
  const tools = SUBFEATURES.filter((s) => s.kind === 'tool');
  const nodes = [{
    parameters: {}, id: 'start', name: 'Start', type: 'n8n-nodes-base.start', typeVersion: 1, position: [200, 300],
  }];
  tools.forEach((t, i) => {
    nodes.push({
      parameters: {
        method: 'POST',
        url: `${base}/api/brain?action=telesuite&op=${t.op}`,
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ workspace_id: $json.workspace_id, input: $json.input }) }}`,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{$credentials.supabaseAccessToken}}' }] },
      },
      id: `telesuite_${t.op}`,
      name: t.label,
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [520, 120 + i * 130],
      notes: `${t.blurb} Costs ${t.credit_key} credits per run.`,
    });
  });
  return {
    name: 'TeleSuite_Workflow',
    nodes,
    connections: { Start: { main: [tools.map((t) => ({ node: t.label, type: 'main', index: 0 }))] } },
    active: false,
    settings: { executionOrder: 'v1' },
    id: 'telesuite-workflow',
  };
}

/** The replication brief — what the original app's /clone-app page served. */
function cloneManifest() {
  return {
    name: 'TeleSuite',
    origin: 'https://github.com/Anchit-AI-Hustle/AI-TeleSuite',
    ported_into: 'Universal Brand Marketing Lifecycle Platform',
    architecture: {
      ui: 'telesuite.html — one hub page, rendered from the SUBFEATURES registry',
      server: 'api/_shared/telesuite-core.js, routed via /api/brain?action=telesuite&op=<op>',
      models: 'api/_shared/llm.js — 6-provider text waterfall (OpenAI, Anthropic, Gemini, Grok, Groq, Cerebras); Gemini multimodal for audio transcription',
      storage: 'Supabase: telesuite_items (products + knowledge base), telesuite_runs (every run, and the source of all dashboards)',
      billing: 'api/_shared/credits-core.js — hold/settle per run, priced in credit-catalog.js',
      brand: 'Every run is scoped to the caller\'s active brand workspace and inherits its voice guardrails',
    },
    changes_from_original: [
      'localStorage replaced with per-workspace Supabase tables, so work is shared and survives a device change',
      'Genkit/Gemini-only replaced with the 6-provider waterfall',
      'Seven separate dashboard stores collapsed into filtered views of one telesuite_runs table',
      'Every feature is credit-metered, with the price shown before the run',
      'Browser SpeechRecognition and SpeechSynthesis still run client-side; only the agent turn is generated server-side',
    ],
    subfeatures: SUBFEATURES.map((s) => ({
      key: s.key, label: s.label, group: s.group, kind: s.kind,
      runs_via: s.op ? `/api/brain?action=telesuite&op=${s.op}` : (s.kind === 'dashboard' ? '/api/brain?action=telesuite&op=runs' : 'client-side'),
      credit_key: s.credit_key || null,
      blurb: s.blurb,
    })),
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════════════════════════════════════ */

const OP_TO_SUBFEATURE = {};
for (const s of SUBFEATURES) if (s.op) OP_TO_SUBFEATURE[s.op] = s;
OP_TO_SUBFEATURE.optimized_pitches = { credit_key: 'telesuite.optimized_pitches', label: 'Optimised pitches', key: 'combined-call-analysis' };

// A voice call is priced PER MINUTE OF CALL, so it is charged ONCE, at the end,
// for the call's real duration. `voice_turn` must therefore be free: it fires
// several times per call and each turn carries the cumulative elapsed time, so
// metering it would charge a three-turn call three times over — and would
// re-charge every earlier minute on each later turn. `voice_finish` is the
// billing boundary; it also refuses to run twice for the same call.
OP_TO_SUBFEATURE.voice_turn = { credit_key: null, label: 'Voice agent turn', key: 'voice-sales-agent' };
OP_TO_SUBFEATURE.voice_finish = { credit_key: 'telesuite.voice_sales', label: 'Voice call', key: 'voice-sales-agent' };

/** The price key for a run, which for a voice call depends on sales vs support. */
function creditKeyFor(op, input) {
  if (op === 'voice_finish') {
    return str(input && input.mode) === 'support' ? 'telesuite.voice_support' : 'telesuite.voice_sales';
  }
  const sf = OP_TO_SUBFEATURE[op];
  return (sf && sf.credit_key) || null;
}

/** Billable units for a run. Only metered features use this. */
function unitsFor(op, input) {
  if (!input) return undefined;
  if (op === 'voice_finish') return Number(input.minutes) > 0 ? Number(input.minutes) : 1;
  if (op === 'transcription') {
    // A pasted transcript generates nothing, so it bills zero — an explicit 0
    // quotes as free rather than falling back to the reservation estimate.
    if (str(input.transcript)) return 0;
    return Number(input.duration_minutes) > 0 ? Number(input.duration_minutes) : undefined;
  }
  const n = Number(input.duration_minutes != null ? input.duration_minutes : (input.minutes != null ? input.minutes : input.units));
  return Number.isFinite(n) ? n : undefined;
}

async function handle(req, res) {
  const q = (req && req.query) || {};
  const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
  const op = str(q.op || body.op) || 'registry';

  // The registry is public so the hub can render (and show prices) instantly.
  if (op === 'registry') {
    return res.status(200).json({
      ok: true,
      subfeatures: SUBFEATURES,
      groups: [...new Set(SUBFEATURES.map((s) => s.group))],
      prices: await credits.priceList().catch(() => credits.catalog.list()),
    });
  }
  if (op === 'clone') return res.status(200).json({ ok: true, manifest: cloneManifest() });
  if (op === 'n8n') {
    const base = str(q.base || body.base) || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
    return res.status(200).json({ ok: true, workflow: n8nWorkflow(base) });
  }

  const ctx = await context(req);
  if (!ctx.ok) return res.status(ctx.status || (ctx.auth && ctx.auth.status) || 401).json(ctx.auth && !ctx.auth.ok ? ctx.auth : ctx);

  // Membership is not authorization: the writes below run with the service
  // role and bypass RLS, so the role check has to happen here.
  if (WRITE_OPS.has(op) && !ctx.canWrite) {
    return res.status(403).json({
      ok: false, error: 'read_only_role',
      message: `Your role on this brand is "${ctx.role}", which can view TeleSuite but not run or change anything. Ask the workspace owner for editor access.`,
    });
  }

  try {
    /* ── library CRUD (Products / Knowledge Base) ────────────────────────── */
    if (op === 'items') {
      const kind = str(q.kind || body.kind) || 'product';
      const rows = await serviceRest(`telesuite_items?select=*&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}&kind=eq.${encodeURIComponent(kind)}&order=updated_at.desc&limit=300`);
      return res.status(200).json({ ok: true, items: Array.isArray(rows) ? rows : [] });
    }
    if (op === 'item-save') {
      const it = body.item || {};
      const row = {
        workspace_id: ctx.workspace_id, user_id: ctx.auth.user_id,
        kind: str(it.kind) === 'knowledge' ? 'knowledge' : 'product',
        name: str(it.name, 300), category: str(it.category, 120) || null,
        content: str(it.content, 60000) || null,
        attributes: it.attributes && typeof it.attributes === 'object' ? it.attributes : {},
        source: str(it.source, 40) || 'typed', updated_at: new Date().toISOString(),
      };
      if (!row.name) { const e = new Error('Name is required.'); e.status = 400; throw e; }
      const id = str(it.id);
      const saved = id
        ? await serviceRest(`telesuite_items?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}&select=*`, { method: 'PATCH', body: row, prefer: 'return=representation' })
        : await serviceRest('telesuite_items?select=*', { method: 'POST', body: [row], prefer: 'return=representation' });
      return res.status(200).json({ ok: true, item: Array.isArray(saved) ? saved[0] : saved });
    }
    if (op === 'item-delete') {
      await serviceRest(`telesuite_items?id=eq.${encodeURIComponent(str(body.id || q.id))}&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}`, { method: 'DELETE', prefer: 'return=minimal' });
      return res.status(200).json({ ok: true });
    }
    /** Seed Products from the brand catalog rather than making products up. */
    if (op === 'items-seed') {
      const cat = await serviceRest(`brand_catalog_products?select=title,description,product_type,price,currency,product_url,image_url,sku&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}&limit=100`);
      const rows = (Array.isArray(cat) ? cat : []).map((p) => ({
        workspace_id: ctx.workspace_id, user_id: ctx.auth.user_id, kind: 'product',
        name: p.title, category: p.product_type || null, content: p.description || null,
        attributes: { sku: p.sku, price: p.price, currency: p.currency, url: p.product_url, image: p.image_url },
        source: 'catalog',
      }));
      if (!rows.length) return res.status(200).json({ ok: true, seeded: 0, message: 'Your brand catalog is empty — import it in brand settings first.' });
      await serviceRest('telesuite_items?select=id', { method: 'POST', body: rows, prefer: 'return=minimal' });
      return res.status(200).json({ ok: true, seeded: rows.length });
    }

    /* ── dashboards: every one is a filtered view of telesuite_runs ──────── */
    if (op === 'runs') {
      const feature = q.feature || body.feature;
      const limit = Math.max(1, Math.min(300, +(q.limit || body.limit) || 100));
      let path = `telesuite_runs?select=id,feature,title,status,product,score,units,credits,provider,duration_ms,created_at,input,output,error&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}&order=created_at.desc&limit=${limit}`;
      if (feature && feature !== '*') {
        const list = (Array.isArray(feature) ? feature : String(feature).split(',')).map((f) => `"${str(f)}"`).join(',');
        path += `&feature=in.(${encodeURIComponent(list)})`;
      }
      const rows = await serviceRest(path);
      return res.status(200).json({ ok: true, runs: Array.isArray(rows) ? rows : [] });
    }
    if (op === 'run-delete') {
      await serviceRest(`telesuite_runs?id=eq.${encodeURIComponent(str(body.id || q.id))}&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}`, { method: 'DELETE', prefer: 'return=minimal' });
      return res.status(200).json({ ok: true });
    }
    if (op === 'summary') {
      const rows = await serviceRest(`telesuite_runs?select=feature,credits,score,created_at&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}&order=created_at.desc&limit=1000`);
      const by = {};
      for (const r of Array.isArray(rows) ? rows : []) {
        const b = by[r.feature] = by[r.feature] || { feature: r.feature, runs: 0, credits: 0, last: null, scores: [] };
        b.runs++; b.credits += Number(r.credits) || 0;
        if (!b.last) b.last = r.created_at;
        if (r.score != null) b.scores.push(Number(r.score));
      }
      const summary = Object.values(by).map((b) => ({
        feature: b.feature, runs: b.runs, credits: b.credits, last: b.last,
        avg_score: b.scores.length ? Math.round((b.scores.reduce((a, c) => a + c, 0) / b.scores.length) * 10) / 10 : null,
      }));
      return res.status(200).json({ ok: true, summary, total_runs: summary.reduce((a, c) => a + c.runs, 0), total_credits: summary.reduce((a, c) => a + c.credits, 0) });
    }

    /* ── a metered generation op ─────────────────────────────────────────── */
    const fn = OPS[op];
    if (!fn) {
      return res.status(400).json({ ok: false, error: 'unknown_telesuite_operation', available: Object.keys(OPS).concat(['registry', 'items', 'item-save', 'item-delete', 'items-seed', 'runs', 'run-delete', 'summary', 'clone', 'n8n']) });
    }

    const sf = OP_TO_SUBFEATURE[op] || {};
    const input = (body.input && typeof body.input === 'object') ? body.input : body;
    const creditKey = creditKeyFor(op, input);
    const started = Date.now();

    // Free op (no credit key) — run it straight.
    if (!creditKey) {
      const out = await fn(ctx, input);
      return res.status(200).json({ ok: true, ...out });
    }

    const m = await credits.meter(req, creditKey, {
      auth: ctx.auth, workspace_id: ctx.workspace_id,
      units: unitsFor(op, input),
      meta: { op, subfeature: sf.key },
    });
    if (!m.ok) return res.status(m.status || 402).json(m);

    let out;
    try {
      out = await fn(ctx, input);
    } catch (err) {
      await m.release(String(err.message || err).slice(0, 200));
      await logRun(ctx, { feature: op, title: str(input.title) || null, status: 'failed', input, error: String(err.message || err).slice(0, 600), credits: 0 });
      throw err;
    }

    // A pasted-transcript run does no model work, so it settles at zero units.
    await m.settle(out.units != null ? out.units : undefined, { meta: { op } });
    const charged = (m.receipt && m.receipt.charged) || 0;

    // An op that logged its own row (a voice call) gets the real charge stamped
    // on it now that settle knows what it actually cost.
    if (out.run_row_id) {
      try {
        await serviceRest(`telesuite_runs?id=eq.${encodeURIComponent(out.run_row_id)}&workspace_id=eq.${encodeURIComponent(ctx.workspace_id)}`, {
          method: 'PATCH', body: { credits: charged, credit_ref: m.hold_id || null }, prefer: 'return=minimal',
        });
      } catch (_) { /* the ledger is the billing truth; this row is a convenience */ }
    }

    let run = null;
    if (!out.skip_log) {
      run = await logRun(ctx, {
        feature: op, title: str(out.title || input.title, 300) || null,
        product: str(input.product) || null,
        input: Object.assign({}, input, { audio: input.audio ? { name: input.audio.name, mime: input.audio.mime } : undefined, kb: input.kb }),
        output: out.result || {}, score: out.score == null ? null : out.score,
        units: out.units == null ? null : out.units, credits: charged,
        credit_ref: m.hold_id || null, provider: out.provider || null,
        duration_ms: Date.now() - started,
      });
    }

    return res.status(200).json({
      ok: true,
      run_id: run && run.id,
      result: out.result,
      score: out.score,
      provider: out.provider,
      degraded: out.degraded,
      credits: m.receipt,
      balance: m.balance,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message || 'telesuite_failed' });
  }
}

module.exports = { handle, SUBFEATURES, subfeature, OPS, cloneManifest, n8nWorkflow };
