'use strict';
/**
 * Ad angle lab (2026-10-18): competitor ad patterns -> ranked angles + a hook
 * bank -> a brief stack and a test plan, for the ACTIVE brand.
 *
 * The operator, with a workflow seen elsewhere ("pull competitor patterns from
 * the Meta Ads Library ... map angles by audience psychology + build the hook
 * bank ... generate the brief stack + test plan"): "take your learnings from
 * this to see how our creations can be improved but keep it free to the max
 * extent possible in execution".
 *
 * What is the same as that workflow, and what is deliberately not:
 *   - Longevity is the signal. An ad a competitor keeps paying for 30+ days is
 *     the closest public evidence of what works for them; every pattern is
 *     weighted by the days its ads have run (start date, else first sighting).
 *   - Nothing here "predicts lift". A rank is the competitor signal behind an
 *     angle, stated as that, never as an expected uplift nobody measured.
 *   - Competitor ads come only from sources this repo already reads: the
 *     workspace's own collected competitor ads (`ci_ads`) and the Meta Ad
 *     Library through the existing fetch (`competitor-core.fetchMetaAds`). No
 *     other site is scraped. With none, the report says so and the angles are
 *     built from the brand's own record, labelled as such.
 *   - Every hook says only what the brand states: the brand's claims are the
 *     material, and `copy-grounding` drops a line using a claim word the brand
 *     does not back. A hook bank is never padded to reach 20.
 *   - Cheap by construction: the report, the angles, the briefs and the plan
 *     are code. ONE model call writes hooks (the shared waterfall, free
 *     providers first); with none answering, hooks are built from the brand's
 *     own lines.
 */

const DAY = 86400000;
const MIN_DAYS = 30;
const SIGNAL_CAP_DAYS = 180;

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 400);
const marker = (field, brand) => `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${(brand && brand.name) || 'this brand'}]`;

// ── 1. Competitor ads, one shape ─────────────────────────────────────────────

function toDate(v) {
  if (!v) return null;
  const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
}

/** A competitor ad from any source as {competitor, text, headline, format, start, end, active, link, source, enrichment}. */
function normalizeAd(raw, competitor, source) {
  const r = raw || {};
  const rj = (r.raw_json && typeof r.raw_json === 'object') ? r.raw_json : {};
  const start = toDate(r.startDate || r.start_date || r.ad_delivery_start_time || rj.ad_delivery_start_time || rj.startDate || r.first_seen);
  const stop = toDate(r.ad_delivery_stop_time || rj.ad_delivery_stop_time);
  const active = r.active !== false && !stop;
  const end = active ? null : (stop || toDate(r.last_seen));
  const imgs = Array.isArray(r.image_urls) ? r.image_urls.length : (r.image ? 1 : 0);
  const vids = Array.isArray(r.video_urls) ? r.video_urls.length : 0;
  const format = str(r.creative_type || (vids ? 'video' : imgs > 1 ? 'carousel' : imgs ? 'image' : 'text'), 20).toLowerCase();
  return {
    competitor: str(r.brand_name || r.page || competitor || 'competitor', 80),
    text: str(r.primary_copy || r.body || '', 600),
    headline: str(r.headline || '', 160),
    format: /video|reel/.test(format) ? 'video' : /carousel/.test(format) ? 'carousel' : /image|photo|static/.test(format) ? 'image' : format || 'text',
    start, end, active,
    dated: !!(r.startDate || r.start_date || r.ad_delivery_start_time || rj.ad_delivery_start_time || rj.startDate),
    link: str(r.link || r.source_link || '', 400),
    source: source || r.source || 'meta',
    enrichment: (r.enrichment && typeof r.enrichment === 'object') ? r.enrichment : {},
  };
}

function daysRunning(ad, now) {
  if (!ad.start) return null;
  const until = ad.end || now;
  return Math.max(0, Math.round((until - ad.start) / DAY));
}

// ── 2. Hook patterns, read from the ad's own first line ─────────────────────

const PATTERNS = [
  ['offer', /\b(\d{1,2}\s?%\s?off|off\b.*\b(today|now)|sale|deal|discount|save \d|free (shipping|delivery|trial|gift)|bogo|buy one)\b/i],
  ['question', /\?\s*$|^\s*(what|why|how|do|does|did|are|is|can|ever|still|tired)\b[^.!]*\?/i],
  ['pain call-out', /\b(tired of|sick of|struggl\w*|stop (wasting|paying|scrolling)|no more|fed up|hate|frustrat\w*|worried|problem with)\b/i],
  ['social proof', /\b(\d[\d,.]*\+?\s*(customers|people|readers|members|reviews|families|users)|rated|reviews?|loved by|trusted by|join(ed)?|bestsell\w*|best-?selling|award)\b/i],
  ['how-to', /^\s*how (to|we|i)\b|\b(step[- ]by[- ]step|\d+\s+(ways|steps|tips|reasons))\b/i],
  ['before / after', /\b(before\b.*\bafter|from .+ to .+|transform\w*|results? in \d+)\b/i],
  ['new / launch', /\b(new|introducing|just (dropped|launched|landed)|now available|meet the)\b/i],
  ['urgency', /\b(today only|ends (tonight|today|soon|sunday)|last (day|chance)|only \d+ left|while (stocks|supplies) last|hurry|limited)\b/i],
  ['curiosity', /\b(secret|nobody (tells|talks)|the truth|here'?s (why|what|how)|you won'?t believe|the one thing|what happens when)\b/i],
  ['identity call-out', /^\s*(if you('| a)re|for (people|those|anyone) who|attention|calling all|pov\b|you, )/i],
  ['number / stat', /^\s*\d|\b\d+(\.\d+)?\s?(%|x|k\b|lakh|crore|million)/i],
];

function firstLine(ad) {
  const t = str(ad.headline || ad.text || '', 600);
  const m = t.match(/^[^.!?\n]*[.!?]?/);
  return str(m ? m[0] : t, 160);
}

function hookPattern(text) {
  const t = String(text || '');
  for (const [name, re] of PATTERNS) if (re.test(t)) return name;
  return 'statement';
}

// ── 3. The pattern report ────────────────────────────────────────────────────

function tally(items, keyOf, weightOf) {
  const m = new Map();
  for (const it of items) {
    const k = keyOf(it); if (!k) continue;
    const row = m.get(k) || { key: k, ads: 0, signal: 0, competitors: new Set(), examples: [] };
    row.ads += 1; row.signal += weightOf(it); row.competitors.add(it.competitor);
    if (row.examples.length < 3) row.examples.push({ competitor: it.competitor, line: firstLine(it), days: it.days, link: it.link || '' });
    m.set(k, row);
  }
  const total = [...m.values()].reduce((s, r) => s + r.signal, 0) || 1;
  return [...m.values()].map((r) => ({ key: r.key, ads: r.ads, competitors: [...r.competitors], signal: Math.round(r.signal), share: Math.round((r.signal / total) * 100), examples: r.examples }))
    .sort((a, b) => b.signal - a.signal || b.ads - a.ads);
}

function plainValue(v) {
  const s = Array.isArray(v) ? v[0] : v;
  const t = str(s, 120);
  return !t || /^not stated$/i.test(t) ? '' : t;
}

/**
 * Patterns across competitor ads, each weighted by days running. Ads of 30+
 * days are the signal; when none is that old (or none states a start date),
 * every ad read counts once and the report says so.
 */
function patternReport(ads, opts) {
  const now = (opts && opts.now) || Date.now();
  const minDays = (opts && opts.minDays) || MIN_DAYS;
  const all = (ads || []).map((a) => Object.assign({}, a, { days: daysRunning(a, now) }));
  const dated = all.filter((a) => a.days != null);
  const long = dated.filter((a) => a.days >= minDays);
  const basis = long.length ? 'long-running' : dated.length ? 'dated' : 'undated';
  const pool = long.length ? long : all;
  const weight = (a) => basis === 'undated' ? 1 : Math.min(SIGNAL_CAP_DAYS, Math.max(1, a.days || 1));
  for (const a of pool) a.pattern = hookPattern(firstLine(a));
  const note = !all.length ? 'No competitor ads were read for this brand.'
    : basis === 'long-running' ? `${long.length} of ${all.length} competitor ads have run ${minDays}+ days; patterns are weighted by how long each has run.`
      : basis === 'dated' ? `None of the ${all.length} competitor ads read has run ${minDays} days yet; patterns are weighted by how long each has run so far.`
        : `The ${all.length} competitor ads read state no start date, so each counts once; how long they have run is not known.`;
  return {
    read: all.length, dated: dated.length, long_running: long.length, min_days: minDays, basis, note,
    competitors: [...new Set(all.map((a) => a.competitor))],
    hooks: tally(pool, (a) => a.pattern, weight),
    formats: tally(pool, (a) => a.format, weight),
    awareness: tally(pool, (a) => plainValue(a.enrichment.awareness_stage).toLowerCase(), weight),
    personas: tally(pool, (a) => plainValue(a.enrichment.target_persona), weight),
    pains: tally(pool, (a) => plainValue(a.enrichment.pain_point), weight),
    _pool: pool,
  };
}

// ── 4. Angles, ranked by the signal behind them ──────────────────────────────

const STOP = new Set('the a an and or of to for in on with your you our we is are be it this that at by from as their they them not no more most best get'.split(' '));
const tokens = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
function overlap(a, b) {
  const A = new Set(tokens(a)); const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n += 1;
  return n / Math.min(A.size, B.size);
}

const PATTERN_ANGLE = {
  offer: 'Value on the table', question: 'Answer the question they are asking', 'pain call-out': 'Name the problem', 'social proof': 'Others already chose it',
  'how-to': 'Show how it works', 'before / after': 'The change it makes', 'new / launch': 'Something new', urgency: 'A reason to act now',
  curiosity: 'Open a loop', 'identity call-out': 'Speak to who they are', 'number / stat': 'A number that proves it', statement: 'Say what it is, plainly',
};

function brandLines(brand) {
  const b = brand || {};
  const claims = (Array.isArray(b.claims) ? b.claims : []).map((c) => str(c, 200)).filter(Boolean);
  const offerings = (Array.isArray(b.offerings) ? b.offerings : []).map((o) => str(o && o.name, 80)).filter(Boolean);
  return { name: str(b.name, 80), tagline: str(b.tagline, 200), claims, offerings, audience: str(b.audience || (b.brand_data && b.brand_data.audience) || '', 200) };
}

/** The brand claim that answers a competitor pain best, or ''. */
function answerFor(text, claims) {
  let best = ''; let score = 0;
  for (const c of claims) { const s = overlap(text, c); if (s > score) { score = s; best = c; } }
  return score >= 0.2 ? best : '';
}

/**
 * Up to 5 ranked angles. From competitor PAIN POINTS when the ads were
 * enriched, else from their HOOK PATTERNS; each angle is answered by one of the
 * brand's own claims, or carries the marker for the claim it needs. With no
 * competitor ads at all, the brand's own claims are the angles (`basis: own`).
 */
function rankAngles(report, brand) {
  const L = brandLines(brand);
  const pool = report._pool || [];
  const out = [];
  if (report.pains.length) {
    const clusters = [];
    for (const p of report.pains) {
      const c = clusters.find((x) => overlap(x.label, p.key) >= 0.5);
      if (c) { c.signal += p.signal; c.ads += p.ads; c.competitors = [...new Set(c.competitors.concat(p.competitors))]; c.examples = c.examples.concat(p.examples).slice(0, 3); c.members.push(p.key); } else clusters.push({ label: p.key, signal: p.signal, ads: p.ads, competitors: p.competitors.slice(), examples: p.examples.slice(), members: [p.key] });
    }
    for (const c of clusters) {
      const ads = pool.filter((a) => c.members.includes(plainValue(a.enrichment.pain_point)));
      const pats = tally(ads, (a) => a.pattern, () => 1).map((x) => x.key);
      const fmts = tally(ads, (a) => a.format, () => 1).map((x) => x.key);
      const personas = tally(ads, (a) => plainValue(a.enrichment.target_persona), () => 1).map((x) => x.key);
      out.push({ name: `Answer: ${c.label}`, pain: c.label, audience: personas[0] || L.audience || '', patterns: pats.length ? pats : ['statement'], format: fmts[0] || 'image', signal: c.signal, ads: c.ads, competitors: c.competitors, examples: c.examples, answer: answerFor(c.label, L.claims), basis: 'competitor-pain' });
    }
  } else if (report.hooks.length) {
    for (const h of report.hooks) {
      const ads = pool.filter((a) => a.pattern === h.key);
      const fmts = tally(ads, (a) => a.format, () => 1).map((x) => x.key);
      const lineText = ads.map(firstLine).join(' ');
      out.push({ name: PATTERN_ANGLE[h.key] || h.key, pain: '', audience: L.audience || '', patterns: [h.key], format: fmts[0] || 'image', signal: h.signal, ads: h.ads, competitors: h.competitors, examples: h.examples, answer: answerFor(lineText, L.claims) || L.claims[0] || '', basis: 'competitor-hook' });
    }
  } else {
    L.claims.slice(0, 5).forEach((c, i) => out.push({ name: `Lead with: ${c}`, pain: '', audience: L.audience || '', patterns: i % 2 ? ['statement'] : ['identity call-out'], format: 'image', signal: 0, ads: 0, competitors: [], examples: [], answer: c, basis: 'own' }));
  }
  out.sort((a, b) => b.signal - a.signal || b.ads - a.ads);
  const top = out.slice(0, 5);
  const total = top.reduce((s, a) => s + a.signal, 0) || 1;
  return top.map((a, i) => Object.assign(a, {
    id: `angle-${i + 1}`, rank: i + 1, signal_share: a.basis === 'own' ? null : Math.round((a.signal / total) * 100),
    answer: a.answer || marker(`a claim that answers "${a.pain || a.name}"`, brand),
    audience: a.audience || marker('audience / persona definition', brand),
  }));
}

// ── 5. The hook bank ─────────────────────────────────────────────────────────

const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const noEnd = (s) => String(s || '').replace(/[.!?\s]+$/, '');

/** Hooks built from the brand's own lines in an angle's pattern; nothing the brand does not state. */
function templateHooks(angle, brand) {
  const L = brandLines(brand);
  const claim = noEnd(/^\[DATA REQUIRED/.test(angle.answer) ? (L.claims[0] || '') : angle.answer);
  const out = [];
  const add = (s) => { const t = str(s, 125); if (t && !out.includes(t)) out.push(t); };
  if (!claim && !L.tagline) return out;
  for (const p of angle.patterns.concat(['statement'])) {
    if ((p === 'question' || p === 'pain call-out') && angle.pain && claim) add(`${cap(noEnd(angle.pain))}? ${cap(claim)}.`);
    if (p === 'identity call-out' && claim) add(`For anyone who wants this: ${claim.charAt(0).toLowerCase() + claim.slice(1)}.`);
    if (p === 'number / stat' && /\d/.test(claim)) add(`${cap(claim)}.`);
    if (p === 'new / launch' && L.offerings[0]) add(`Meet ${L.offerings[0]} from ${L.name}.`);
    if (claim) add(`${cap(claim)}.`);
    if (L.tagline) add(`${cap(noEnd(L.tagline))}.`);
    if (claim && L.name) add(`${L.name}: ${claim.charAt(0).toLowerCase() + claim.slice(1)}.`);
  }
  return out;
}

function hookPrompt(angles, brand, report) {
  const L = brandLines(brand);
  const contract = require('./output-contract.js');
  const facts = [`Brand: ${L.name}`, L.tagline && `Tagline: ${L.tagline}`, L.claims.length && `Its own claims (the ONLY facts you may use):\n- ${L.claims.join('\n- ')}`, L.offerings.length && `Offerings: ${L.offerings.join(', ')}`].filter(Boolean).join('\n');
  const list = angles.map((a) => `${a.id}: ${a.name}. Hook pattern that keeps competitor ads running: ${a.patterns.slice(0, 2).join(', ')}.${a.pain ? ` Pain it answers: ${a.pain}.` : ''} Answer from the brand: ${a.answer}.${a.examples[0] ? ` A competitor line in this pattern (do NOT copy it): "${a.examples[0].line}"` : ''}`).join('\n');
  const numbered = L.claims.map((c, i) => `${i}: ${c}`).join('\n');
  const body = `${facts}\n\nCLAIMS BY NUMBER:\n${numbered || '(none)'}\n\nANGLES:\n${list}\n\nFor each angle, "answer" is the number of the ONE claim above that best answers it (-1 when none does). Then write 4 ad hooks per angle for ${L.name}, each in that angle's pattern, each under 125 characters, in the brand's own words. A hook states nothing the brand's claims do not; never invent a number, a discount, a review, a deadline or a result. No em or en dashes.`;
  return {
    systemPrompt: `You are a direct-response copywriter writing scroll-stopping first lines for ${L.name}'s paid social ads. ${report.read ? 'Competitor patterns are evidence of what holds attention, not lines to copy.' : ''}`,
    userMessage: contract.append(body, {
      id: 'ad-angle-lab.hooks', kind: 'data', format: 'json', returns: 'ONE JSON object: the hooks for each angle id.',
      shape: '{"angles":[{"id":"string: the angle id as given, e.g. angle-1","answer":"number: the claim that answers it, or -1","hooks":["string: one hook, under 125 characters"]}]}',
      missing: `When a hook would need a fact the brand does not state, leave it out; never write a placeholder.`,
      brand: L.name,
    }),
  };
}

/** Up to 20 hooks, 4 per angle, grounded in the brand's own words. Never padded. */
async function hookBank(angles, brand, report, deps) {
  const d = deps || {};
  const grounding = require('./copy-grounding.js');
  const facts = grounding.factsFor(brand);
  const keep = (h) => { const t = str(h, 125).replace(/[–—]/g, ',' ); return t && !grounding.unbacked(t, facts).length ? t : ''; };
  let fromModel = {};
  const answers = {};
  let by = 'template';
  if (angles.some((a) => a.basis !== 'own' || a.answer)) {
    try {
      const callLLM = d.callLLM || require('./llm.js');
      const p = hookPrompt(angles, brand, report);
      const outp = await callLLM({ systemPrompt: p.systemPrompt, userMessage: p.userMessage, responseFormat: { type: 'json_object' }, maxTokens: 1400, temperature: 0.7, stage: 'ad-angle-lab-hooks' });
      const parsed = require('./output-contract.js').parseJsonLoose(outp && outp.text);
      for (const row of (parsed && Array.isArray(parsed.angles) ? parsed.angles : [])) {
        if (!row || !row.id) continue;
        if (Array.isArray(row.hooks)) fromModel[String(row.id)] = row.hooks;
        if (Number.isInteger(Number(row.answer)) && Number(row.answer) >= 0) answers[String(row.id)] = Number(row.answer);
      }
      if (Object.keys(fromModel).length) by = 'model';
    } catch (_) { fromModel = {}; }
  }
  assignAnswers(angles, brand, answers);
  const dropped = [];
  const seen = new Set();
  const bank = angles.map((a) => {
    const hooks = [];
    for (const h of (fromModel[a.id] || []).concat(templateHooks(a, brand))) {
      const k = keep(h);
      if (!k) { if (h) dropped.push(str(h, 125)); continue; }
      const key = k.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key); hooks.push(k);
      if (hooks.length >= 4) break;
    }
    return { angle: a.id, name: a.name, hooks };
  });
  return { bank, count: bank.reduce((s, r) => s + r.hooks.length, 0), by, dropped };
}

/**
 * Which of the brand's own claims answers each angle. The model's pick when it
 * named one (a claim by number, so it cannot invent one); else the claim the
 * words match; else a DIFFERENT claim not yet used by a higher angle, flagged
 * `answer_basis: 'unmatched'` so a person checks it. None left: the marker.
 */
function assignAnswers(angles, brand, picks) {
  const L = brandLines(brand);
  const used = new Set();
  for (const a of angles) {
    const pick = picks && picks[a.id];
    if (Number.isInteger(pick) && L.claims[pick]) { a.answer = L.claims[pick]; a.answer_basis = 'model'; }
    else if (a.answer && !/^\[DATA REQUIRED/.test(a.answer)) a.answer_basis = a.answer_basis || 'words';
    else {
      const free = L.claims.find((c) => !used.has(c));
      if (free) { a.answer = free; a.answer_basis = 'unmatched'; }
      else a.answer_basis = 'none';
    }
    if (a.answer && !/^\[DATA REQUIRED/.test(a.answer)) used.add(a.answer);
  }
  return angles;
}

// ── 6. Briefs + test plan ───────────────────────────────────────────────────

const VISUAL = {
  video: 'Vertical 9:16 video: the hook on screen and in motion within the first second, the answer by second three, the button on the last frame. Captions on; it must read with the sound off.',
  carousel: 'Carousel: card one is the hook, each next card one reason from the brand\'s own claims, the last card the button.',
  image: 'Single image, 1:1 feed and 4:5: the hook as the on-image line in the top third, the brand\'s own picture behind it (a catalogue photo, else its own imagery, else its brand scene), the button below.',
  text: 'Text-led card on the brand\'s own ground: the hook large, the answer under it, the button below.',
};

/** The hook, then each brand line it does not already say, while it fits 125 characters. */
function primaryText(hook, lines) {
  let out = hook ? `${cap(noEnd(hook))}.` : '';
  for (const l of lines) {
    if (!l || /^\[DATA REQUIRED/.test(l)) continue;
    const add = `${cap(noEnd(l))}.`;
    if (out.toLowerCase().includes(noEnd(l).toLowerCase())) continue;
    const next = out ? `${out} ${add}` : add;
    if (next.length <= 125) out = next;
  }
  return out;
}

function shorter(lines, max) { return lines.map((l) => str(l, 400)).filter((l) => l && l.length <= max)[0] || ''; }

/** One brief per angle, plus a control from the brand's own strongest line. */
function briefStack(angles, bank, brand) {
  const L = brandLines(brand);
  let cta = 'Learn more';
  try { cta = require('./asset-playbooks.js').defaultCta(brand, { hasProduct: false }); } catch (_) { /* keep */ }
  const hooksFor = (id) => ((bank.find((r) => r.angle === id) || {}).hooks) || [];
  const briefs = angles.map((a) => {
    const hooks = hooksFor(a.id);
    const answer = /^\[DATA REQUIRED/.test(a.answer) ? '' : a.answer;
    return {
      id: `brief-${a.rank}`, angle: a.id, angle_name: a.name, rank: a.rank, basis: a.basis,
      hook: hooks[0] || marker(`a hook for "${a.name}"`, brand),
      primary_text: primaryText(hooks[0], [answer, L.tagline]) || marker('primary text', brand),
      headline: shorter([answer, ...L.claims, L.tagline, L.name], 40) || marker('headline', brand),
      visual_direction: VISUAL[a.format] || VISUAL.image, format: a.format,
      cta, audience: a.audience, evidence: a.basis === 'own' ? 'From the brand\'s own claims; no competitor ads were read.' : `${a.ads} competitor ad${a.ads === 1 ? '' : 's'} from ${a.competitors.slice(0, 3).join(', ')}${a.competitors.length > 3 ? ' and others' : ''}`,
      signal_share: a.signal_share,
    };
  });
  const control = L.claims[0] || L.tagline;
  const lead = L.tagline || control;
  if (control) briefs.push({ id: 'brief-control', angle: null, angle_name: 'Control: the brand as it speaks today', rank: briefs.length + 1, basis: 'control', hook: str(`${cap(noEnd(lead))}.`, 125), primary_text: primaryText(lead, [L.claims[0]]), headline: shorter([L.tagline, control, L.name], 40), visual_direction: VISUAL.image, format: 'image', cta, audience: L.audience || marker('audience / persona definition', brand), evidence: 'The brand\'s own lead line: the baseline every angle is judged against.', signal_share: null });
  return briefs;
}

/**
 * The test plan. Ranked by the competitor signal behind each angle (the control
 * last); the split is stated as a rule, not a prediction: the control keeps
 * 20%, the rest follows each angle's share of the signal with a 10% floor.
 * Amounts only when a daily budget is given; otherwise percentages and the gap.
 */
function testPlan(briefs, opts) {
  const o = opts || {};
  const budget = Number(o.budget) > 0 ? Number(o.budget) : null;
  const tests = briefs.filter((b) => b.basis !== 'control');
  const control = briefs.find((b) => b.basis === 'control');
  const pool = control ? 80 : 100;
  const weights = tests.map((b) => (b.signal_share == null ? 1 : Math.max(1, b.signal_share)));
  const wsum = weights.reduce((s, w) => s + w, 0) || 1;
  let shares = weights.map((w) => Math.max(10, Math.round((w / wsum) * pool)));
  const over = shares.reduce((s, x) => s + x, 0) - pool;
  if (over && shares.length) { const i = shares.indexOf(Math.max(...shares)); shares[i] -= over; }
  const rows = tests.map((b, i) => ({ brief: b.id, angle: b.angle_name, share: shares[i] }));
  if (control) rows.push({ brief: control.id, angle: control.angle_name, share: 20 });
  for (const r of rows) r.daily = budget ? Math.round((budget * r.share) / 100 * 100) / 100 : null;
  return {
    rows, budget, currency: o.currency || '',
    budget_note: budget ? `Daily budget ${budget}${o.currency ? ' ' + o.currency : ''}, split as below.` : marker('daily ad budget', o.brand),
    method: 'Ranked by the competitor signal behind each angle (days their ads have run), not by a predicted lift. The control keeps 20%; the rest follows each angle\'s share of that signal, at least 10% each.',
    rules: [
      'Run every brief at once in one ad set per market, same audience, same placements, so the only difference is the creative.',
      'Judge on the platform\'s own result per spend (purchases, sign-ups or the objective set), not on clicks alone.',
      'Give each brief the same minimum spend before judging; the platform\'s own reading of significance decides, never a hunch on day one.',
      'Pause a brief that is clearly behind the control at that point; move its share to the leader, and write the next hooks in the leader\'s pattern.',
    ],
  };
}

// ── 7. Sources and the whole run ─────────────────────────────────────────────

/** Competitor names for the brand: the ones named on the call, else its own record. */
function competitorNames(brand, given) {
  const named = (Array.isArray(given) ? given : []).map((n) => str(n && (n.name || n), 80)).filter(Boolean);
  if (named.length) return [...new Set(named)].slice(0, 8);
  try {
    const rows = require('./competitor-universe.js').deriveFromBrandRecord(brand) || [];
    return [...new Set(rows.map((r) => str(r && (r.name || r.brand_name), 80)).filter((n) => n && !/^\[DATA REQUIRED/.test(n)))].slice(0, 8);
  } catch (_) { return []; }
}

/**
 * Read competitor ads: the workspace's collected ones, then the Meta Ad
 * Library fetch per competitor (it returns a library link when it cannot read
 * creatives). `deps.ciAds(workspaceId)` and `deps.fetchMetaAds(opts)` let a
 * test supply both.
 */
async function gatherAds({ brand, workspaceId, market, competitors, deps }) {
  const d = deps || {};
  const ads = []; const sources = []; const links = [];
  if (workspaceId && d.ciAds !== null) {
    try {
      const read = d.ciAds || (async (ws) => require('./supa.js').select('ci_ads', { filters: { workspace_id: `eq.${ws}` }, order: 'last_seen.desc', limit: 300 }));
      const rows = await read(workspaceId);
      for (const r of (Array.isArray(rows) ? rows : [])) ads.push(normalizeAd(r, r.brand_name, r.source || 'collected'));
      if (rows && rows.length) sources.push({ source: 'collected', ads: rows.length });
    } catch (_) { /* not configured: the library fetch below still runs */ }
  }
  const fetchAds = d.fetchMetaAds || require('./competitor-core.js').fetchMetaAds;
  const names = competitors.slice(0, 5);
  const results = await Promise.all(names.map((n) => fetchAds({ brand: n, country: market || 'ALL', limit: 20 }).catch(() => null)));
  results.forEach((r, i) => {
    if (!r) return;
    if (r.deepLink) links.push({ competitor: names[i], url: r.deepLink });
    const got = Array.isArray(r.ads) ? r.ads : [];
    for (const a of got) ads.push(normalizeAd(a, names[i], 'meta-library'));
    if (got.length) sources.push({ source: 'meta-library', competitor: names[i], ads: got.length });
  });
  return { ads, sources, links };
}

async function run(opts) {
  const o = opts || {};
  const brand = o.brand || {};
  if (!brand.name) return { ok: false, error: 'brand_required', message: 'Set up or choose a brand first: angles are built from its own record.' };
  const market = String(o.market || '').toUpperCase();
  const competitors = competitorNames(brand, o.competitors);
  const got = await gatherAds({ brand, workspaceId: o.workspaceId, market, competitors, deps: o.deps });
  const report = patternReport(got.ads, { now: o.now, minDays: o.minDays });
  const angles = rankAngles(report, brand);
  const hooks = await hookBank(angles, brand, report, o.deps);
  const briefs = briefStack(angles, hooks.bank, brand);
  // The brand's OWN paid ads (2026-11-01, ad-history.js): the control is the
  // brand as it speaks today, and its own ad that ran above its own median
  // click-through rate is the evidence beside it, with the platform's figures.
  // The control's copy is not changed: only the evidence line.
  let ownAds = null;
  if (o.deps && Object.prototype.hasOwnProperty.call(o.deps, 'ownAds')) ownAds = o.deps.ownAds;
  else if (o.workspaceId) { try { ownAds = await require('./ad-history.js').evidenceAds(o.workspaceId); } catch (_) { ownAds = null; } }
  const own = ownAds ? require('./creative-evidence.js').ownAdsFrom({ ownAds }) : null;
  const control = briefs.find((x) => x.basis === 'control');
  if (control && own) {
    const best = own.platforms.map((pl) => pl.worked[0] && Object.assign({ platform: pl.label, median: pl.median }, pl.worked[0])).filter(Boolean).sort((x, y) => (y.ctr - y.median) - (x.ctr - x.median))[0];
    control.own_ad_evidence = best
      ? { platform: best.platform, ad: best.name, figures: best.figures, copy: best.pattern, median_ctr: best.median, metric: own.metric }
      : { note: own.total ? own.platforms.map((pl) => pl.reason || `${pl.label}: no ad above the median`).join(' ') : 'The ad accounts were read and no ad ran in the window.' };
    if (best) control.evidence = `${control.evidence} Your own ${best.platform} ad "${best.name}" ran above your own median click-through rate: ${best.figures}.`;
  }
  const plan = testPlan(briefs, { budget: o.budget, currency: o.currency, brand });
  const gaps = [];
  if (!competitors.length) gaps.push(marker('competitor set', brand));
  if (!report.read) gaps.push(`No competitor ads were read${competitors.length ? ` for ${competitors.slice(0, 5).join(', ')}` : ''}; the angles come from ${brand.name}'s own claims.`);
  if (hooks.count < 20) gaps.push(`${hooks.count} hooks, not 20: ${brand.name}'s record states too few lines to write more without inventing.`);
  delete report._pool;
  return { ok: true, brand: brand.name, market: market || null, competitors, sources: got.sources, library_links: got.links, report, angles, hooks: { bank: hooks.bank, count: hooks.count, dropped: hooks.dropped.length }, briefs, test_plan: plan, gaps, _by: hooks.by };
}

module.exports = { run, assignAnswers, normalizeAd, daysRunning, hookPattern, patternReport, rankAngles, hookBank, templateHooks, briefStack, testPlan, competitorNames, gatherAds, MIN_DAYS };
