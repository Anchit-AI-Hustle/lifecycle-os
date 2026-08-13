'use strict';

/**
 * brain-agent.js — Knickgasm conversational agents (voice + chat + narration).
 *
 * Brand / collection / product / persona-level agents. Each agent gets a
 * knowledge pack assembled from: its catalog scope (smart_products), the
 * brand kit, optionally scraped OFFICIAL knickgasm.com product pages
 * (syncKnowledge), and the marketing KB. Conversation runs through
 * _shared/llm.js with a careful sales-advisor system prompt (telecalling
 * substitute: educate → justify value → guide, never pressure).
 *
 * Voice I/O happens client-side (SpeechRecognition + speechSynthesis) in
 * agent.html / agent-widget.js. Server returns text + speakable text.
 */

const { db, getBrandKit, idFor, scrubBannedPhrases } = require('./brain-core.js');

let callLLM = null;
try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }

let smartBrain = null;
try { smartBrain = require('../../lib/smart-brain/services.js'); } catch (_) { smartBrain = null; }

// Real per-market Shopify totals (order/customer exports). Audience-size answers
// come from here, NOT the seeded RFM sample in ownData.users / smart_cohorts.
let marketAnalytics = null;
try { marketAnalytics = require('./market-analytics.js'); } catch (_) { marketAnalytics = null; }

const dataClass = require('./data-classification.js');
// Customer-facing evidence + brand/confidentiality guardrails (ported from Knickgasm-Super-App).
// Appended to the BUYER chat() persona only — never to teamChat() (internal analyst).
const { EVIDENCE_RULES, BRAND_GUARDRAILS } = require('./evidence-policy.js');

// Detect whether a message is asking for analytical/data figures rather than
// product advice. Routing is keyword-based and conservative: a hit sends the
// turn through the EXACT-numbers path (computed from real own-data), a miss
// stays on the conversational sales-advisor path.
const ANALYTIC_RE = /\b(revenue|sales|aov|average order|order(s)?|cohort|cohorts|ltv|lifetime value|customer(s)?|conversion|conversions?|cvr|ctr|roas|click[- ]?rate|open[- ]?rate|benchmark|how many|how much|top|best|worst|highest|lowest|rank(ed|ing)?|most[- ]?(sold|popular)|best[- ]?seller)/i;
function looksAnalytical(message) {
  return ANALYTIC_RE.test(String(message || ''));
}

function fmtMoney(n) { return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function pct(n) { return (Number(n || 0) * 100).toFixed(2) + '%'; }
function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }
// Which market a question is about (default US) — used to pull the right real
// Shopify totals for audience/customer-base answers.
function marketFromText(q) {
  return /\b(uk|u\.k\.|britain|british|england|united kingdom|gbp|£)\b/i.test(String(q)) ? 'UK' : 'US';
}

/**
 * agent-analyze — answer a natural-language analytical question with EXACT
 * figures computed from own-data via the Smart Brain AnalysisService.
 *
 * Numbers ALWAYS come from the deterministic analysis below. The LLM (if any)
 * is used ONLY to phrase those exact numbers in brand voice — never to invent
 * figures. Returns { ok, answer, data:{...} }.
 */
async function analyze({ message = '' }) {
  if (!smartBrain) return { ok: false, error: 'analysis engine unavailable' };
  const { smartConfig, SmartBrainDbAdapter, KnowledgeBaseService, AnalysisService } = smartBrain;
  const config = smartConfig();
  const adapter = new SmartBrainDbAdapter(config);
  const ownData = await adapter.ownData();
  const kb = new KnowledgeBaseService(config).build(ownData);
  const analysis = new AnalysisService(config).analyze(kb, ownData);

  const q = String(message).toLowerCase();
  const cohorts = (analysis.cohorts || []);
  const productScores = (analysis.productScores || []);
  const channels = analysis.channelBenchmarks || {};

  // ── (a) Deterministic exact answers for common asks ──────────────────────
  let answer = '';
  const data = {};

  // Audience SIZE / customer-base questions must be answered from the REAL
  // Shopify export totals, never the seeded ~600-row RFM sample. Detect these
  // first so "how many customers / our audience base" never reports the sample.
  const wantsAudience = /(audience|customer base|subscriber|list size|how (many|big).*(customer|user|subscriber|buyer|people|profile|audience)|(total|number of).*(customer|buyer|audience|subscriber)|reachable|contactable|how many (people|profiles))/.test(q);
  const wantsProducts = /(product|sku|best[- ]?sell|top|most[- ]?(sold|popular)|hero)/.test(q) && !/cohort|channel|customer|audience/.test(q);
  const wantsCohorts = /(cohort|segment|ltv|lifetime|champion|loyal|winback|at[- ]?risk)/.test(q) || (/customer/.test(q) && !wantsAudience);
  const wantsChannels = /(channel|email|meta|google|tiktok|roas|ctr|conversion|open[- ]?rate|click[- ]?rate|benchmark|aov|average order)/.test(q);

  if (wantsAudience && marketAnalytics) {
    const mk = marketFromText(q);
    // Gated: the bundled Shopify export belongs to tenant zero. Another
    // workspace gets ok:false and the connect instruction, not these totals.
    const aud = await marketAnalytics.audience(mk);
    if (aud && aud.ok) {
      data.audience = aud;
      // Cohort SHAPE (share of the analyzed RFM records) — reported as shares,
      // NOT scaled to fabricated per-segment counts. Headline size stays the
      // real Shopify total; the split is explicitly "of N analyzed records".
      const nSample = cohorts.reduce((s, c) => s + (Number(c.count) || 0), 0);
      const dist = (nSample > 0) ? cohorts.map((c) => ({
        name: c.name, share_pct: Math.round((c.count / nSample) * 1000) / 10,
        avgLtv: Number(c.avgLtv || 0),
      })) : [];
      data.cohort_shares = dist;
      data.cohort_sample_size = nSample;
      answer = `${mk} purchasing customer base: ${fmtNum(aud.purchasing_customers)} unique buyers on Shopify over ${aud.window} `
        + `(${fmtNum(aud.new_customers)} new, ${fmtNum(aud.returning_customers)} returning; ${aud.returning_rate_pct}% returning rate). Source: ${aud.source}. `
        + (dist.length ? `RFM value split (share of ${fmtNum(nSample)} analyzed records): ${dist.slice(0, 5).map((d) => `${d.name} ${d.share_pct}%`).join(', ')}. ` : '')
        + `Total email/SMS list size (all subscribers, including non-buyers) needs Klaviyo, which is not connected.`;
    } else if (aud) {
      answer = aud.error || '';
    }
  } else if (wantsProducts) {
    const byRevenue = /revenue|sales|\$|money|earn/.test(q);
    const sorted = productScores.slice().sort((a, b) =>
      byRevenue ? (b.revenue - a.revenue) : (b.orderCount - a.orderCount) || (b.score - a.score));
    const top = sorted.slice(0, 5).map((s) => ({
      title: s.product?.title || s.product?.sku || 'Unknown',
      sku: s.product?.sku || s.product?.id || null,
      orders: s.orderCount, revenue: Number(s.revenue || 0), score: s.score,
    }));
    data.topProducts = top; data.metric = byRevenue ? 'revenue' : 'orders';
    if (top.length) {
      const lead = top[0];
      answer = `Top product by ${byRevenue ? 'revenue' : 'orders'}: ${lead.title} — ${fmtMoney(lead.revenue)} across ${lead.orders} orders. `
        + top.slice(1, 3).map((t) => `${t.title} (${fmtMoney(t.revenue)}, ${t.orders} orders)`).join('; ') + '.';
    } else {
      answer = ''; // no exact figure → fall through to the LLM, don't dead-end
    }
  } else if (wantsCohorts) {
    data.cohorts = cohorts.map((c) => ({ name: c.name, count: c.count, revenue: Number(c.revenue || 0), avgLtv: Number(c.avgLtv || 0) }));
    if (cohorts.length) {
      const top = cohorts[0];
      answer = `Largest cohort by revenue: ${top.name} — ${top.count} profiles, ${fmtMoney(top.revenue)} total, ${fmtMoney(top.avgLtv)} average LTV. `
        + `Other cohorts: ${cohorts.slice(1, 4).map((c) => `${c.name} (${c.count} profiles, ${fmtMoney(c.avgLtv)} LTV)`).join('; ')}.`;
    } else {
      answer = ''; // no exact figure → fall through to the LLM, don't dead-end
    }
  } else if (wantsChannels) {
    data.channelBenchmarks = Object.fromEntries(Object.entries(channels).map(([ch, m]) => [ch, {
      campaigns: m.count, avgClickRate: m.avgClickRate, avgConversionRate: m.avgConversionRate, avgRoas: m.avgRoas,
    }]));
    const entries = Object.entries(channels);
    if (entries.length) {
      answer = 'Channel benchmarks (own data): ' + entries.map(([ch, m]) =>
        `${ch} — ${m.count} campaigns, ${pct(m.avgClickRate)} click rate, ${pct(m.avgConversionRate)} conversion, ${Number(m.avgRoas || 0).toFixed(2)}x ROAS`).join('; ') + '.';
    } else {
      answer = ''; // no exact figure → fall through to the LLM, don't dead-end
    }
  }

  // ── (b) LLM-first: ANY question without a deterministic exact answer above
  // is answered by the LLM, grounded on whatever data exists. It must not
  // fabricate figures, but it must NEVER dead-end with "no data" — it reasons
  // from the catalog, brand knowledge and D2C lifecycle judgment instead.
  if (!answer && callLLM) {
    data.cohorts = data.cohorts || cohorts.slice(0, 6).map((c) => ({ name: c.name, count: c.count, revenue: Number(c.revenue || 0), avgLtv: Number(c.avgLtv || 0) }));
    data.topProducts = data.topProducts || productScores.slice(0, 8).map((s) => ({ title: s.product?.title, orders: s.orderCount, revenue: Number(s.revenue || 0) }));
    data.channelBenchmarks = data.channelBenchmarks || Object.fromEntries(Object.entries(channels).map(([ch, m]) => [ch, { campaigns: m.count, avgClickRate: m.avgClickRate, avgConversionRate: m.avgConversionRate, avgRoas: m.avgRoas }]));
    const hasData = (data.cohorts && data.cohorts.length) || (data.topProducts && data.topProducts.length) || (data.channelBenchmarks && Object.keys(data.channelBenchmarks).length);
    const sys = `You are KNICKGASM's growth-analyst agent. Use the JSON numbers below when they answer the question — state those exact figures and NEVER invent or estimate numbers that aren't present. If the specific metric isn't in the data, say plainly it isn't wired into the dataset yet, then STILL give a genuinely useful, reasoned answer from the product catalog, brand knowledge and sound D2C lifecycle judgment. Never reply with just "I don't know" or "no data". Be concise (2-5 sentences), spoken-friendly.${hasData ? '' : '\n(Note: the analytics dataset is currently empty — reason from catalog + lifecycle best practice and say so.)'}\n\nDATA:\n${JSON.stringify(data)}`;
    try {
      const out = await callLLM({ systemPrompt: sys, userMessage: message, maxTokens: 700, temperature: 0.4, timeoutMs: 30000, stage: 'agent-analyze', tier: 'premium' });
      answer = (typeof out === 'string' ? out : out.text || '').trim();
    } catch (_) { answer = ''; }
  }
  if (!answer) {
    // True last resort: LLM unreachable (e.g. no API key). Stay helpful, not dead.
    answer = cohorts.length
      ? `Top cohort: ${cohorts[0].name} (${cohorts[0].count} profiles, ${fmtMoney(cohorts[0].avgLtv)} LTV). Top product: ${productScores[0]?.product?.title || 'N/A'}.`
      : "I don't have live numbers wired in yet — tell me the goal and I'll reason it out from the catalog and lifecycle best practice.";
  }

  const brand = await getBrandKit().catch(() => ({}));
  answer = scrubBannedPhrases(answer, brand);
  return { ok: true, answer, data, source: ownData.source };
}

async function listAgents() {
  return db().select('smart_agents', { limit: 100, order: 'created_at.asc', filters: { active: 'eq.true' } });
}

async function getAgent(agentId) {
  const rows = await db().select('smart_agents', { filters: { id: `eq.${agentId}` }, limit: 1 });
  if (!rows[0]) throw new Error(`agent ${agentId} not found`);
  return rows[0];
}

async function upsertAgent(spec) {
  const id = spec.id || idFor('agent', { name: spec.name, level: spec.level });
  const row = {
    id, level: spec.level || 'collection', name: spec.name, market: spec.market || 'US',
    persona: spec.persona || {}, catalog_scope: spec.catalog_scope || {},
    greeting: spec.greeting || `Hi, I'm ${spec.name}. How can I help?`,
    voice: spec.voice || { rate: 1.0, pitch: 1.0, style: 'warm' },
    active: spec.active !== false, updated_at: new Date().toISOString(),
  };
  await db().upsert('smart_agents', [row], 'id');
  return row;
}

function scopedProducts(agent, products) {
  const scope = agent.catalog_scope || {};
  let out = products;
  if (Array.isArray(scope.categories) && scope.categories.length) {
    out = out.filter((p) => scope.categories.includes(p.category));
  }
  if (Array.isArray(scope.skus) && scope.skus.length) {
    out = out.filter((p) => scope.skus.includes(p.sku));
  }
  return out.length ? out : products;
}

/** Scrape official KNICKGASM product pages (catalog URLs only — official site). */
async function syncKnowledge(agentId) {
  const agent = await getAgent(agentId);
  const products = scopedProducts(agent, await db().select('smart_products', { limit: 500, filters: { active: 'eq.true' } }));
  const targets = products.filter((p) => p.url && /knickgasm\.com|knickgasmindia\.com/.test(p.url)).slice(0, 12);
  const rows = [];
  for (const p of targets) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(p.url, { headers: { 'User-Agent': 'Mozilla/5.0 KnickgasmAgentKB/1.0' }, signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const html = await r.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
      rows.push({
        id: idFor('ak', { agent: agentId, url: p.url }),
        agent_id: agentId, source_url: p.url, title: p.title,
        content: text, facts: { sku: p.sku, price: p.price, category: p.category, tags: p.tags },
        fetched_at: new Date().toISOString(),
      });
    } catch (_) { /* skip unreachable */ }
  }
  // even if scraping fails (network rules), seed knowledge from catalog facts
  if (!rows.length) {
    for (const p of products.slice(0, 20)) {
      rows.push({
        id: idFor('ak', { agent: agentId, sku: p.sku }),
        agent_id: agentId, source_url: p.url || null, title: p.title,
        content: `${p.title}: ${p.category} from KNICKGASM. Price ${p.price}. Tags: ${(p.tags || []).join(', ')}.`,
        facts: { sku: p.sku, price: p.price, category: p.category, tags: p.tags },
        fetched_at: new Date().toISOString(),
      });
    }
  }
  if (rows.length) await db().upsert('smart_agent_knowledge', rows, 'id');
  return { agent: agentId, knowledge_items: rows.length, scraped: targets.length };
}

// Craft/product-education facts used in the agent system prompt.
const CRAFT_FACTS = `
Grounded product-education facts (use honestly, never overclaim):
- Every pair starts as a 100% original sneaker (Nike Air Force 1, Jordan, Dunk, Court Vision, Converse, Adidas Samba) — we customise, we never replicate.
- Hand-painted one-of-one: made to order by India's best sneaker artists, typically 10–15 days from order to dispatch. That wait is the product, not a delay.
- Paint system: layered, sealed and cured so the artwork is water & scratch resistant and flexes with the leather instead of cracking at the toe box.
- Airbrush work is best for gradients and skies; brush detail for character linework; embroidery and crystal (bling) work are add-ons on top of the painted base.
- Care: wipe with a damp microfibre, no machine wash, no direct heat. Restoration and touch-ups are possible because the artwork is hand-applied.
- Value framing: a one-of-one pair nobody else on earth owns, built on an original silhouette — compare it to the sneaker plus a commissioned artwork, not to a stock retail pair.
- KNICKGASM ships express from Mumbai to 60+ countries; worn organically by Samay Raina, Rohit Sharma and Shraddha Kapoor.`;

async function chat({ agentId, sessionId, message, context = {}, history = [], scope = 'buyer' }) {
  const agent = await getAgent(agentId);
  const brand = await getBrandKit();

  // ── Analytical routing: EXACT computed numbers (revenue/cohorts/orders/etc.).
  //    GATED to internal scope only — these are internal-only figures and must
  //    NEVER reach a buyer-facing persona agent (see data-classification.js).
  if (dataClass.resolveScope(scope) === dataClass.SCOPE.INTERNAL && smartBrain && looksAnalytical(message)) {
    try {
      const a = await analyze({ message });
      if (a.ok && a.answer) {
        let reply = scrubBannedPhrases(a.answer, brand);
        const sid = sessionId || idFor('sess', { agent: agentId, t: Date.now() });
        try {
          if (!sessionId) await db().upsert('smart_agent_sessions', [{ id: sid, agent_id: agentId, visitor_id: context.visitor || null, context }], 'id');
          await db().insert('smart_agent_messages', [
            { session_id: sid, role: 'user', content: message, meta: context },
            { session_id: sid, role: 'agent', content: reply, meta: { provider: 'analysis', mode: 'exact-numbers' } },
          ]);
        } catch (_) { /* transcripts are best-effort */ }
        return {
          ok: true, session_id: sid, agent: { id: agent.id, name: agent.name, voice: agent.voice },
          reply, speak: reply.replace(/https?:\/\/\S+/g, 'the product page').replace(/[*_#`]/g, ''),
          provider: 'analysis', data: a.data,
        };
      }
    } catch (_) { /* fall through to conversational path */ }
  }

  const [products, knowledge] = await Promise.all([
    db().select('smart_products', { limit: 500, filters: { active: 'eq.true' } }),
    db().select('smart_agent_knowledge', { limit: 30, filters: { agent_id: `eq.${agentId}` } }),
  ]);
  const scoped = scopedProducts(agent, products).slice(0, 24);
  const catalogLines = scoped.map((p) => `- ${p.title} | ${p.category} | $${p.price} | ${(p.tags || []).join(',')} | ${p.url || ''}`).join('\n');
  const kbLines = knowledge.slice(0, 10).map((k) => `• ${k.title}: ${String(k.content || '').slice(0, 400)}`).join('\n');
  const persona = agent.persona || {};

  const system = `You are "${agent.name}", KNICKGASM's ${persona.role || 'sneaker & streetwear expert'} — a voice-first conversational advisor embedded on the store. You are the brand's telecalling substitute: customers talk to you the way they would to a knowledgeable human caller.

TONE: ${persona.tone || 'warm, knowledgeable, never pushy'}. Brand voice: ${brand.voice}. Prefer words like ${(brand.preferred_lexicon || []).join(', ')}. NEVER use: ${(brand.banned_phrases || []).join(', ')}.

GOALS: ${(persona.goals || ['educate', 'guide', 'justify value honestly']).join('; ')}.

OBJECTION HANDLING: ${JSON.stringify(persona.objection_handling || {})}.
${CRAFT_FACTS}

CATALOG YOU CAN RECOMMEND (only these; include the link when recommending):
${catalogLines}

KNOWLEDGE (official KNICKGASM sources):
${kbLines || '(catalog facts only)'}

RULES — CLEAR AND TO-THE-POINT:
- LEAD with the direct answer in your FIRST sentence. Answer the exact question asked before anything else.
- Then at most 2–4 short supporting sentences (the why / the relevant product / the honest caveat). Then OPTIONALLY one short follow-up question — only if it genuinely helps.
- No rambling, no filler, no preamble ("great question", "happy to help"), and do NOT repeat brand/value boilerplate (per-pair math, origin-freshness, certifications) in every reply — bring those up ONLY when the question is about price or worth.
- Be honest about lead times and finish; set expectations (10–15 days made-to-order, hand-painted so tiny variations are the signature, not a flaw). Never overpromise on delivery dates or durability.
- If asked something outside KNICKGASM products/sneaker/streetwear, say so briefly and steer back in one sentence.
- COMPETITOR & PRICING POLICY: you only ever recommend KNICKGASM products (the catalog above), never a competitor. Do NOT quote, confirm, estimate, or look up another brand's prices, and never suggest or point the customer to a cheaper brand as the better deal. If a customer asks you to compare prices or name a cheaper option, do not give competitor figures; instead reframe the conversation onto VALUE and make KNICKGASM the most reasonable choice on what actually makes a pair worth it: what a hand-painted one-of-one actually costs, an original Nike/Jordan/Adidas base rather than a copy, a water & scratch resistant paint system, express worldwide shipping and the free gifts. Stay honest and on-brand: champion KNICKGASM's value in your own words, but never invent a competitor's number and never claim KNICKGASM is literally the cheapest if that is not something you can stand behind, sell the worth, not a false price.
- Reply in the user's language if they switch (incl. Hindi/Hinglish). Stay spoken-friendly (this may be read aloud).
- Write the way you speak: complete, flowing sentences only. NO markdown, headings, bullet or numbered lists, tables, asterisks, or emoji — if you name a few products, say them inside a sentence, never as a list.` + EVIDENCE_RULES + BRAND_GUARDRAILS;

  const convo = history.slice(-10).map((m) => `${m.role === 'user' ? 'Customer' : agent.name}: ${m.content}`).join('\n');
  const userMessage = `${convo ? convo + '\n' : ''}Customer: ${message}\n${agent.name}:`;

  let reply = '';
  let provider = 'fallback';
  if (callLLM) {
    try {
      // Headroom so replies never clip mid-sentence (was 420, which cut answers
      // after a line or two). Premium tier for accurate, on-catalog answers.
      const out = await callLLM({ systemPrompt: system, userMessage, maxTokens: 900, temperature: 0.7, timeoutMs: 30000, stage: 'agent-chat', tier: 'premium' });
      reply = (typeof out === 'string' ? out : out.text || '').trim();
      provider = typeof out === 'object' ? out.provider : 'llm';
    } catch (_) { reply = ''; }
  }
  if (!reply) {
    const p = scoped[0];
    reply = `Happy to help! ${p ? `A good place to start is ${p.title} (${'$' + p.price}) — ${p.category.toLowerCase()} our customers lace-up daily.` : ''} With our streetwear colorways, the honest answer on results is 2–4 weeks of a daily pair. Per pair it works out to roughly forty cents — origin-fresh, packed in India within days of drop. What does your daily routine look like, so I can point you to the right colorway?`;
  }
  reply = scrubBannedPhrases(reply, brand);

  // persist transcript
  const sid = sessionId || idFor('sess', { agent: agentId, t: Date.now() });
  try {
    if (!sessionId) await db().upsert('smart_agent_sessions', [{ id: sid, agent_id: agentId, visitor_id: context.visitor || null, context }], 'id');
    await db().insert('smart_agent_messages', [
      { session_id: sid, role: 'user', content: message, meta: context },
      { session_id: sid, role: 'agent', content: reply, meta: { provider } },
    ]);
  } catch (_) { /* transcripts are best-effort */ }

  return { ok: true, session_id: sid, agent: { id: agent.id, name: agent.name, voice: agent.voice }, reply, speak: reply.replace(/https?:\/\/\S+/g, 'the product page').replace(/[*_#`]/g, ''), provider };
}

/**
 * analyticsSnapshot — compact own-data figures for grounding the internal
 * copilot's strategy/flow answers. Same deterministic source as analyze():
 * numbers are REAL (never invented). Returns null if the engine is offline so
 * the prompt can degrade gracefully. Best-effort; never throws.
 */
async function analyticsSnapshot() {
  if (!smartBrain) return null;
  try {
    const { smartConfig, SmartBrainDbAdapter, KnowledgeBaseService, AnalysisService } = smartBrain;
    const config = smartConfig();
    const adapter = new SmartBrainDbAdapter(config);
    const ownData = await adapter.ownData();
    const kb = new KnowledgeBaseService(config).build(ownData);
    const analysis = new AnalysisService(config).analyze(kb, ownData);
    return {
      source: ownData.source || 'linked dataset',
      cohorts: (analysis.cohorts || []).slice(0, 6).map((c) => ({
        name: c.name, profiles: c.count, revenue: Number(c.revenue || 0), avgLtv: Number(c.avgLtv || 0),
      })),
      topProducts: (analysis.productScores || []).slice(0, 8).map((s) => ({
        title: s.product?.title || s.product?.sku || 'Unknown', orders: s.orderCount, revenue: Number(s.revenue || 0),
      })),
      channelBenchmarks: Object.fromEntries(Object.entries(analysis.channelBenchmarks || {}).map(([ch, m]) => [ch, {
        campaigns: m.count, clickRate: m.avgClickRate, conversionRate: m.avgConversionRate, roas: m.avgRoas,
      }])),
    };
  } catch (_) { return null; }
}

// ── Internal Employee Agent (the /team copilot) ─────────────────────────────
// A ChatGPT/Claude-style assistant for KNICKGASM STAFF. Full internal scope: may
// discuss revenue, cohorts, performance, strategy, and use exact-number answers.
// NEVER exposed on a buyer surface. See docs/UNIFIED-ARCHITECTURE.md §5.
async function teamChat({ sessionId, message, context = {}, history = [] }) {
  const brand = await getBrandKit();

  // Analytical questions → exact computed numbers (internal scope is allowed).
  if (smartBrain && looksAnalytical(message)) {
    try {
      const a = await analyze({ message });
      if (a.ok && a.answer) {
        const sid = sessionId || idFor('sess', { agent: 'team', t: Date.now() });
        try {
          if (!sessionId) await db().upsert('smart_agent_sessions', [{ id: sid, agent_id: 'team', context }], 'id');
          await db().insert('smart_agent_messages', [
            { session_id: sid, role: 'user', content: message, meta: context },
            { session_id: sid, role: 'agent', content: a.answer, meta: { provider: 'analysis', scope: 'internal' } },
          ]);
        } catch (_) { /* best-effort */ }
        return { ok: true, session_id: sid, scope: 'internal', reply: a.answer, provider: 'analysis', data: a.data };
      }
    } catch (_) { /* fall through */ }
  }

  let catalog = [];
  try { catalog = await db().select('smart_products', { limit: 500 }); } catch (_) { catalog = []; }
  const catalogLines = (catalog || []).slice(0, 40).map((p) => `- ${p.title} | ${p.category} | $${p.price}`).join('\n');

  // Ground every strategy/flow answer in REAL own-data. Best-effort: the
  // deterministic analytical path (analyze) handles pure number lookups; this
  // snapshot primes the persona path so recommendations are never generic.
  const snapshot = await analyticsSnapshot();
  const dataBlock = snapshot
    ? `LIVE OWN-DATA SNAPSHOT (source: ${snapshot.source}) — these are MEASURED Knickgasm figures. Treat as ground truth. Do NOT invent numbers beyond these; if a needed figure is absent, say so and name the data you'd pull.\n${JSON.stringify(snapshot)}`
    : 'LIVE OWN-DATA SNAPSHOT: unavailable this turn. Do NOT fabricate Knickgasm figures — if a recommendation needs data you do not have, state the exact metric/report the employee should pull, and clearly label any number you cite as an external industry benchmark or an explicit estimate.';

  // The client may attach backend data inputs (on-screen metrics, a pasted
  // report, a funnel export) on context — feed it in so the analyst can use it.
  const ctxKeys = context && typeof context === 'object' ? Object.keys(context) : [];
  const contextBlock = ctxKeys.length
    ? `\n\nATTACHED DATA INPUTS (provided by the employee for this turn — analyse these as first-class evidence):\n${JSON.stringify(context).slice(0, 4000)}`
    : '';

  const system = `You are the KNICKGASM Growth Copilot — an elite, data-driven Senior Growth & Product Management Analyst embedded INTERNALLY in KNICKGASM's Lifecycle OS. Your users are Knickgasm EMPLOYEES (growth, product, lifecycle, and marketing teams) — never customers. KNICKGASM is a premium D2C Indian heritage sneaker & streetwear brand.

MISSION: turn data into decisions. Help staff diagnose performance, prioritise growth/product bets, draft assets, and pressure-test user flows. You MAY freely discuss internal revenue, cohorts, LTV, spend, CAC, ROAS, funnel and retention figures — this is an internal tool.

═══ NON-NEGOTIABLE OPERATING RULES ═══

1) DATA-BACKED RIGOR — NEVER give a generic answer.
   Every product recommendation, flow change, or strategy suggestion must be anchored to a number: from the LIVE OWN-DATA SNAPSHOT below, from data the employee pastes into the chat, or from a clearly-labelled external benchmark. If you do not have the data to back a claim, say exactly that and name the specific metric/report to pull — do NOT hand-wave or fabricate Knickgasm figures. Lead with the number, then the interpretation.

2) STRUCTURED IMPACT & HYPOTHESIS — for EVERY recommendation, output this exact block:
   • **Recommendation** — one sharp sentence.
   • **Metric Impact** — name the precise metric that moves (Conversion Rate / AOV / LTV / Retention / Repeat-Purchase Rate / Funnel Drop-off / CAC / ROAS / Open or Click Rate), the direction, and a sized estimate with the reasoning behind the magnitude (e.g. "checkout CVR +0.8–1.5pp, ~₹X incremental/month at current traffic").
   • **Core Hypothesis** — written verbatim in this form: "If we [specific action], then [measurable outcome], because [evidence-based rationale]."
   • **Benchmark** — see rule 3.
   • **Validation Plan** — how to prove it: the test (A/B / holdout / cohort read), the primary success metric, minimum detectable effect, and roughly how long / how much traffic to reach significance.
   • **Confidence & gaps** — High/Med/Low + the data you'd want to de-risk it.
   For quick factual lookups, lead with the exact figure; the full block is required whenever you RECOMMEND or PROPOSE a change.

3) COMPETITIVE BENCHMARKING — validate every recommendation against the outside world.
   Cite recognised global D2C sneaker/streetwear and broader e-commerce baselines (e.g. D2C email open ~30–45% / CTR ~2–5%; e-com site CVR ~2–3.5%, premium F&B/streetwear ~1.5–4%; cart-abandonment ~65–75%; D2C repeat-purchase ~25–35%; subscription churn, AOV and CAC:LTV ≥1:3 norms). Always (a) label the source class — MEASURED-OWN-DATA vs INDUSTRY-BENCHMARK vs ESTIMATE — and (b) state where Knickgasm sits relative to the benchmark and what that gap implies. Give ranges, not false precision, and never present an external benchmark as Knickgasm's own number.

4) INTERNAL FLOW TESTING & SIMULATION.
   When asked to evaluate, diagnose, or simulate a user flow (onboarding, PDP→cart→checkout, lifecycle/email journeys, subscription, winback), map the flow step by step, attach the conversion/drop-off rate to each step (from snapshot/pasted data or a labelled estimate), pinpoint the highest-leverage leak, and propose instrumented experiments to fix it. When simulating, state your input assumptions explicitly and show the funnel math.

TONE: direct, senior, concise. Lead with the answer and the number; no filler, no hedging, no motivational fluff.

BRAND VOICE (only when drafting CUSTOMER-FACING copy): prefer ${(brand.preferred_lexicon || []).join(', ')}; never use ${(brand.banned_phrases || []).join(', ')}; palette #D0473E/#6A33D8/#111111/#FFFFFF; headings Montserrat, body Instrument Sans.

${dataBlock}${contextBlock}

CATALOG (sample):
${catalogLines}`;

  const convo = history.slice(-10).map((m) => `${m.role === 'user' ? 'Employee' : 'Copilot'}: ${m.content}`).join('\n');
  const userMessage = `${convo ? convo + '\n' : ''}Employee: ${message}\nCopilot:`;

  let reply = '';
  let provider = 'fallback';
  if (callLLM) {
    try {
      const out = await callLLM({ systemPrompt: system, userMessage, maxTokens: 1500, temperature: 0.4, timeoutMs: 40000, stage: 'team-chat' });
      reply = (typeof out === 'string' ? out : out.text || '').trim();
      provider = typeof out === 'object' ? out.provider : 'llm';
    } catch (_) { reply = ''; }
  }
  if (!reply) reply = 'I can help with Knickgasm growth work — analytics with exact numbers, campaign/mailer/ad/landing drafts, calendar planning and review. What do you need?';

  const sid = sessionId || idFor('sess', { agent: 'team', t: Date.now() });
  try {
    if (!sessionId) await db().upsert('smart_agent_sessions', [{ id: sid, agent_id: 'team', context }], 'id');
    await db().insert('smart_agent_messages', [
      { session_id: sid, role: 'user', content: message, meta: context },
      { session_id: sid, role: 'agent', content: reply, meta: { provider, scope: 'internal' } },
    ]);
  } catch (_) { /* best-effort */ }

  return { ok: true, session_id: sid, scope: 'internal', reply, provider };
}

module.exports = { listAgents, getAgent, upsertAgent, syncKnowledge, chat, teamChat, scopedProducts, analyze, looksAnalytical };
