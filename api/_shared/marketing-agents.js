'use strict';
/**
 * marketing-agents.js - the marketing team that builds a send (2026-10-26).
 *
 * The operator, with "The Claude B2B Marketing Department" (a shared marketing
 * context - company, customers, offer, brand, goals - and ten departments of
 * five maker/reviewer pairs): "the best and most accurate output can only be
 * achieved when a team of such agents works together - check if the
 * implementation is like that". It was not: a send was ONE strategy call and
 * ONE copy call writing every asset at once, then code checks; nothing a
 * reviewer found went back to be rewritten.
 *
 * Now every send that has a model key is made by a team:
 *   0. SHARED CONTEXT, assembled once from the brand's own record, catalogue,
 *      cohort, offer, goal and evidence; every agent reads the same text.
 *   1. Strategy & Planning      Marketing Strategist      -> Marketing Priorities Reviewer
 *   2. Positioning & Messaging  Messaging Architect        -> Objection & Message Consistency Reviewer
 *   3. Content & Creative       Creative Brief Writer      -> Brief Reviewer
 *   4. Content & Creative       Campaign Copywriters (A/B) -> Content Quality Reviewer
 * A reviewer answers pass or revise with the field, the problem and the fix;
 * revise sends the work back ONCE with those reasons (never a loop). Pairs 1
 * and 2 run side by side (both read only the shared context); 3 reads both;
 * 4 reads all three. The code gates that follow (grounding, proof, brand
 * guard, compliance, contracts, contrast) stay the last word: an agent can
 * improve the work, never let an unbacked claim through.
 *
 * ROSTER is every role on the operator's picture with what does it here: an
 * agent in the team above, a code check, a feature page, or nothing, with the
 * reason. Nothing is marked covered that the code does not do.
 *
 * Model calls go through the caller's own `call` (smart-brain-plan's
 * callLLMTiered: model routing, credits, the workspace's own keys) and every
 * prompt ends with its OUTPUT REQUIREMENT (output-contract.js).
 */
const OC = require('./output-contract.js');
// The team works inside one Smart Brain build, so the model router prices its calls as that build
// (credit-catalog 'brain.slot_prebuild'): a low balance downgrades a maker's tier as it would the build's.
const TEAM_FEATURE = 'brain.slot_prebuild';

// The picture's fifty roles and what does each here: marketing-team.js ROSTER
// (one list, shared with the /marketing-team page).
const { ROSTER } = require('./marketing-team.js');

/* ── Output specs (one per role; the same spec parses the answer) ───────── */
const VERDICT = {
  verdict: { type: 'string', enum: ['pass', 'revise'] },
  score: { type: 'number', note: '1-10: how ready this is to hand on' },
  issues: { type: 'array', count: [0, 5], items: { type: 'object', of: { field: 'string', problem: 'string', fix: 'string' } } },
};
function spec(id, brand, market, returns, schema, lines) {
  return { id, kind: 'data', format: 'json', brand: brand || 'this brand', region: market, returns, schema, lines };
}
const SPECS = {
  strategy: (b, m) => spec('team.strategist', b, m, 'ONE JSON object: the strategy for this ONE send.', {
    angle: { type: 'string', note: 'the single sharp campaign angle' },
    framework: { type: 'string', enum: ['Hook-Story-Offer', 'PAS', 'Identity-Driven'] },
    hook_thesis: { type: 'string', note: 'why this lands for THIS cohort now' },
    target_emotion: 'string',
    why_now: { type: 'string', note: 'the buying situation of this cohort at this date' },
    primary_kpi: { type: 'string', note: 'the one result this send should move' },
    proof_points: { type: 'array', count: [0, 3], items: { type: 'string', note: 'from the shared context only' } },
    differentiator: 'string', dos: { type: 'array', count: [1, 3], items: 'string' }, donts: { type: 'array', count: [1, 3], items: 'string' },
  }),
  messaging: (b, m) => spec('team.messaging', b, m, 'ONE JSON object: the positioning and messaging for this send.', {
    value_proposition: { type: 'string', note: 'one sentence, in the brand\'s own facts' },
    key_message: { type: 'string', note: 'the one thing every asset says' },
    supporting_messages: { type: 'array', count: [0, 3], items: 'string' },
    claim_refs: { type: 'array', count: [0, 3], items: { type: 'number', note: 'numbers of the CLAIMS in the shared context this send leans on' } },
    objections: { type: 'array', count: [0, 3], items: { type: 'object', of: { objection: 'string', answer: { type: 'string', note: 'answered only with a stated fact, else leave the objection out' } } } },
  }),
  brief: (b, m) => spec('team.brief', b, m, 'ONE JSON object: one creative brief per channel of this send.', {
    channel_roles: { type: 'string', note: 'the job each channel does in this send' },
    email: { type: 'object', of: { hook: 'string', must_say: 'string', structure: 'string', visual: 'string' } },
    landing: { type: 'object', of: { hook: 'string', must_say: 'string', structure: 'string', visual: 'string' } },
    ads: { type: 'object', of: { hook: 'string', must_say: 'string', visual: 'string', placements: 'string' } },
  }),
};
const REVIEW_SPEC = (id, b, m, what) => spec(id, b, m, `ONE JSON object: your verdict on the ${what}.`, VERDICT,
  ['"revise" only for a real defect the maker can fix from the shared context; "pass" otherwise. Never ask for a fact the context does not state.']);

const MAKER = {
  strategy: { department: 'Strategy & Planning', role: 'Marketing Strategist',
    task: 'Set the strategy for this ONE send: the angle, the framework, why it lands for this cohort now (their buying situation), the one result it should move, and what to do and avoid.' },
  messaging: { department: 'Positioning & Messaging', role: 'Messaging Architect',
    task: 'Write the positioning for this send: the value proposition, the one key message every asset says, up to three supporting messages, the numbered CLAIMS it leans on, and the objections this cohort has with the answer to each in a stated fact.' },
  brief: { department: 'Content & Creative', role: 'Creative Brief Writer',
    task: 'Write one creative brief per channel (email, landing page, ads) that carries the strategy and the messaging: the job of the channel, its hook, what it must say, its structure and a TEXT-FREE visual.' },
};
const REVIEWER = {
  strategy: { department: 'Strategy & Planning', role: 'Marketing Priorities Reviewer',
    check: 'Does the strategy serve the stated objective and this cohort? Is the KPI measurable? Is every proof point in the shared context? Is the angle specific to this send, not generic?' },
  messaging: { department: 'Positioning & Messaging', role: 'Objection & Message Consistency Reviewer',
    check: 'Is the value proposition in the brand\'s own facts? Does every claim number exist in the CLAIMS list? Is each objection answered with a stated fact (an unanswerable one must be left out)?' },
  brief: { department: 'Content & Creative', role: 'Brief Reviewer',
    check: 'Does every channel brief carry the strategy\'s angle and the key message? Is each channel given a distinct job? Is every visual text-free and about the brand\'s own offering?' },
  copy: { department: 'Content & Creative', role: 'Content Quality Reviewer',
    check: 'Does the copy follow the briefs and say the key message? Do the email, landing page and ads say the same thing (message consistency)? Is every claim, price and offer in the shared context? Is each call to action clear? Are lengths sane for the medium?' },
};

function systemFor(role, brandName) {
  return `You are the ${role.role} in ${brandName || 'the brand'}'s marketing team (${role.department}). You work from the SHARED MARKETING CONTEXT only: never invent a fact, price, offer, claim, review or figure; a missing fact stays missing.`;
}
const ms = () => Date.now();

/**
 * One maker/reviewer pair: make, review, and (on revise) make once more with
 * the reviewer's reasons. Never throws; a member that fails is recorded.
 */
async function pair(key, ctx, upstream, o) {
  const { call, parseJSON, brandName, market, left } = o;
  const out = { key, members: [], result: null };
  const maker = MAKER[key]; const reviewer = REVIEWER[key];
  const make = async (critique) => {
    const t0 = ms();
    const user = OC.append([
      'SHARED MARKETING CONTEXT', ctx, upstream ? `\nWORK OF THE TEAM SO FAR\n${upstream}` : '',
      `\nYOUR JOB: ${maker.task}`,
      critique ? `\nTHE REVIEWER SENT THIS BACK. Fix exactly these and keep the rest:\n${critique}` : '',
    ].join('\n'), SPECS[key](brandName, market));
    try {
      const res = await call({ systemPrompt: systemFor(maker, brandName), userMessage: user, responseFormat: { type: 'json_object' }, maxTokens: 900, temperature: 0.6, timeoutMs: Math.min(15000, Math.max(3000, left())), budgetMs: Math.max(1000, left()), tier: 'premium', stage: `team-${key}`, feature: TEAM_FEATURE });
      const json = parseJSON(res.text);
      // Accepted only when every field the spec names has the type it was asked for (a string
      // where a list belongs would break the copy briefing downstream), and the core is there.
      const ok = json && typeof json === 'object' && !Array.isArray(json) && hasCore(key, json) && !wrongTypes(json, SPECS[key](brandName, market)).length;
      out.members.push({ department: maker.department, role: maker.role, kind: 'maker', revision: !!critique, ok: !!ok, provider: res.provider || null, model: res.model || null, ms: ms() - t0, output: ok ? json : null, error: ok ? null : 'its answer was not the shape it was asked for' });
      return ok ? json : null;
    } catch (e) {
      out.members.push({ department: maker.department, role: maker.role, kind: 'maker', revision: !!critique, ok: false, ms: ms() - t0, error: String((e && e.message) || e).slice(0, 160) });
      return null;
    }
  };
  let work = await make(null);
  if (!work) return out;
  out.result = work;
  if (left() < 6000) { out.members.push({ department: reviewer.department, role: reviewer.role, kind: 'reviewer', ok: false, skipped: true, error: 'no time left in this build for the review' }); return out; }
  // The reviewer reads what the maker read: a brief is checked against the strategy and message it was given.
  const v = await review(key, ctx, JSON.stringify(work), o, upstream);
  out.members.push(v.member);
  if (v.verdict === 'revise' && left() > 9000) {
    const again = await make(v.critique);
    if (again) out.result = again;
  }
  out.verdict = v.verdict;
  return out;
}

function wrongTypes(json, sp) {
  return (OC.validate(json, sp) || []).filter((x) => /is not an? /.test(x));
}

function hasCore(key, j) {
  if (key === 'strategy') return !!(j.angle && String(j.angle).trim());
  if (key === 'messaging') return !!(j.key_message && String(j.key_message).trim());
  // Every channel's copywriter reads its own brief: all three, each an object, or the brief is not accepted.
  // Each channel brief carries every direction its copywriter is given, each said in words.
  const said = (x) => typeof x === 'string' && x.trim().length > 0;
  const full = (x, keys) => !!x && typeof x === 'object' && !Array.isArray(x) && keys.every((k) => said(x[k]));
  if (key === 'brief') return full(j.email, ['hook', 'must_say', 'structure', 'visual']) && full(j.landing, ['hook', 'must_say', 'structure', 'visual']) && full(j.ads, ['hook', 'must_say', 'visual', 'placements']);
  return true;
}

/** A reviewer's verdict on a piece of work. Never throws. */
async function review(key, ctx, work, o, upstream) {
  const { call, parseJSON, brandName, market, left } = o;
  const r = REVIEWER[key];
  const t0 = ms();
  const sp = REVIEW_SPEC(`team.review.${key}`, brandName, market, key === 'copy' ? 'copy of every asset' : key);
  const user = OC.append(['SHARED MARKETING CONTEXT', ctx, upstream ? `\nWORK OF THE TEAM SO FAR (what the maker was given)\n${upstream}` : '', `\nTHE WORK TO REVIEW\n${work}`, `\nCHECK: ${r.check}`].join('\n'), sp);
  try {
    const res = await call({ systemPrompt: systemFor(r, brandName), userMessage: user, responseFormat: { type: 'json_object' }, maxTokens: 700, temperature: 0.2, timeoutMs: Math.min(12000, Math.max(3000, left())), budgetMs: Math.max(1000, left()), tier: 'fast', stage: `team-review-${key}`, feature: TEAM_FEATURE });
    const j = parseJSON(res.text);
    const verdict = j && (j.verdict === 'pass' || j.verdict === 'revise') ? j.verdict : null;
    if (!verdict) return { verdict: null, member: { department: r.department, role: r.role, kind: 'reviewer', ok: false, provider: res.provider || null, ms: ms() - t0, error: 'its answer carried no verdict' } };
    const issues = Array.isArray(j.issues) ? j.issues.filter((x) => x && (x.problem || x.fix)).slice(0, 5) : [];
    // A "revise" with no usable reasons is a malformed review, not a pass: recorded failed, nothing rewritten.
    if (verdict === 'revise' && !issues.length) return { verdict: null, member: { department: r.department, role: r.role, kind: 'reviewer', ok: false, provider: res.provider || null, ms: ms() - t0, error: 'it asked for a revision but gave no reasons' } };
    const critique = issues.map((x, i) => `${i + 1}. ${x.field ? x.field + ': ' : ''}${x.problem || ''}${x.fix ? ' -> ' + x.fix : ''}`).join('\n');
    return { verdict, critique, member: { department: r.department, role: r.role, kind: 'reviewer', ok: true, provider: res.provider || null, model: res.model || null, ms: ms() - t0, verdict, score: Number.isFinite(+j.score) ? +j.score : null, issues } };
  } catch (e) {
    return { verdict: null, member: { department: r.department, role: r.role, kind: 'reviewer', ok: false, ms: ms() - t0, error: String((e && e.message) || e).slice(0, 160) } };
  }
}

/**
 * Pairs 1-3 (strategy and messaging side by side, then the briefs). Returns
 * { strategy, messaging, brief, members[], ms }; any part may be null.
 */
async function plan(ctx, o) {
  const t0 = ms();
  const [s, m] = await Promise.all([pair('strategy', ctx, '', o), pair('messaging', ctx, '', o)]);
  const up = [s.result ? `STRATEGY ${JSON.stringify(s.result)}` : '', m.result ? `MESSAGING ${JSON.stringify(m.result)}` : ''].filter(Boolean).join('\n');
  const b = o.left() > 12000 && up ? await pair('brief', ctx, up, o) : { members: [], result: null, skipped: true };
  return { strategy: s.result, messaging: m.result, brief: b.result, members: [...s.members, ...m.members, ...b.members], verdicts: { strategy: s.verdict || null, messaging: m.verdict || null, brief: b.verdict || null }, ms: ms() - t0 };
}

/** What the copywriters are briefed with from the team's work. */
function copyBriefing(team) {
  if (!team) return '';
  const lines = ['THE TEAM\'S WORK FOR THIS SEND (follow it; it was reviewed):'];
  const m = team.messaging;
  if (m) {
    lines.push(`- Key message (every asset says it): ${m.key_message}`);
    if (m.value_proposition) lines.push(`- Value proposition: ${m.value_proposition}`);
    (m.supporting_messages || []).forEach((x) => lines.push(`- Supporting: ${x}`));
    (m.objections || []).forEach((x) => x && x.objection && x.answer && lines.push(`- Objection "${x.objection}" -> answer: ${x.answer}`));
  }
  const b = team.brief;
  if (b) {
    if (b.channel_roles) lines.push(`- Channel roles: ${b.channel_roles}`);
    for (const k of ['email', 'landing', 'ads']) {
      const x = b[k];
      if (x && typeof x === 'object') lines.push(`- ${k} brief: hook "${x.hook || ''}"; must say "${x.must_say || ''}"${x.structure ? `; structure: ${x.structure}` : ''}${x.visual ? `; visual: ${x.visual}` : ''}${x.placements ? `; placements: ${x.placements}` : ''}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

/** The strategist's work in the shape the copy prompt already takes. */
function strategyAsBrief(s) {
  if (!s || !s.angle) return null;
  return { angle: s.angle, hook_thesis: s.hook_thesis || s.why_now || '', target_emotion: s.target_emotion || '', differentiator: s.differentiator || '', proof_points: s.proof_points || [], dos: s.dos || [], donts: s.donts || [], framework: s.framework, primary_kpi: s.primary_kpi || '' };
}

/** Pair 4's reviewer: the copy of every asset, against the context and the briefs. */
async function reviewCopy(ctx, team, copy, o) {
  const slim = JSON.stringify({ team: { key_message: team && team.messaging && team.messaging.key_message, briefs: team && team.brief }, copy: { email: copy.email, landing: copy.landing, ads: copy.ads } });
  // The whole draft: a cut would drop the ads, and the reviewer checks every asset against the others.
  return review('copy', ctx, slim, o);
}

module.exports = { ROSTER, MAKER, REVIEWER, SPECS, plan, pair, review, reviewCopy, copyBriefing, strategyAsBrief };
