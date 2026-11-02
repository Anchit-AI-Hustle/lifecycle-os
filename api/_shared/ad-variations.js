'use strict';
/**
 * ad-variations.js - a winning ad of the brand's OWN spawns variations
 * (2026-11-02, against usefastlane.ai: "winning ads spawn variations").
 * ---------------------------------------------------------------------------
 * The source is one of the brand's own imported ads that BEAT its own median
 * on its platform (ad-performance.winnersFor): by cost per result where 3 or
 * more of that platform's ads carry one, else by click-through rate. An ad
 * that did not is refused with where it stands; nothing is called a winner
 * without the figures.
 *
 * What a variation keeps, checked in code, not only asked for:
 *   - the source's HOOK PATTERN (ad-angle-lab.hookPattern, the one vocabulary
 *     Winning angles and ad-patterns read): a variant whose opening classifies
 *     as another pattern is dropped, with the reason;
 *   - the source's FORMAT (video or image, as the platform returned it);
 *   - the platform's own limits, READ from asset-contracts (Meta primary text
 *     125 / headline 40): a line over its limit is dropped, never cut;
 *   - the brand's own words: copy-grounding holds every line to the brand's
 *     record plus the source ad's own copy (the brand ran it in its own
 *     account); a claim word nothing backs drops the line.
 *
 * One model call through the shared llm.js waterfall, closed by an
 * output-contract block. No model answering = variations built from the
 * brand's own lines (the source's own opening with each of its claims, and
 * ad-angle-lab's template lines in the same pattern), labelled `by:
 * 'brand_lines'`; never padded to N.
 *
 * Each variation carries `variation_of` (the source ad id, platform, its
 * figures, the metric, its value and the median it beat) and a brief shape the
 * Paid launch planner already takes (paid-launch-core source.kind "briefs").
 * Pure apart from the model call; the caller hands in the ads.
 * ---------------------------------------------------------------------------
 */

const MAX_N = 8;
const DEFAULT_N = 4;

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 400);
const noEnd = (t) => String(t || '').replace(/[\s.!?]+$/, '');
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
function err(status, code, message, extra) { const e = new Error(message); e.status = status; e.code = code; if (extra) e.extra = extra; return e; }

/** The copy limits of the source ad's placement, read from asset-contracts. */
function limitsFor(provider, video) {
  const c = require('./asset-contracts.js');
  if (provider === 'google_ads') return { contract: 'ad.google.rsa', primary_text: c.slotLimit('ad.google.rsa', 'descriptions'), headline: c.slotLimit('ad.google.rsa', 'headlines') };
  if (provider === 'tiktok_ads') { const id = video ? 'ad.tiktok.video' : 'ad.tiktok.static'; return { contract: id, primary_text: c.slotLimit(id, 'caption'), headline: null }; }
  const id = video ? 'ad.meta.video' : 'ad.meta.static';
  return { contract: id, primary_text: c.slotLimit(id, 'primary_text'), headline: c.slotLimit(id, 'headline') };
}

/** The winning ad to vary: the one named, else the one furthest past its own median. */
function pickSource(ads, adId) {
  const perf = require('./ad-performance.js');
  const pats = require('./ad-patterns.js');
  const plats = perf.winnersFor(ads, { limit: 50 });
  const all = [];
  for (const pl of plats) for (const w of pl.winners) all.push({ pl, w, lead: perf.lead(w, pl) });
  if (adId) {
    const hit = all.find((x) => String(x.w.ad_id) === String(adId));
    if (!hit) {
      const ad = ads.find((a) => String(a.ad_id) === String(adId));
      if (!ad) throw err(404, 'ad_not_found', 'That ad is not in this brand\'s ad history.');
      const pl = plats.find((p) => p.provider === ad.provider) || {};
      throw err(409, 'not_a_winner', pl.basis
        ? `"${ad.name || ad.ad_id}" did not beat this brand's own median ${pl.basis === 'cost_per_result' ? 'cost per result' : 'click-through rate'} on ${pl.label}, so it is not varied as a winner.`
        : `${pl.reason || 'Too few of this platform\'s ads carry a figure to call any of them a winner.'}`);
    }
    if (!pats.opening(hit.w.ad)) throw err(409, 'no_copy', `${hit.pl.label} did not return the copy of "${hit.w.name}", so there is nothing to vary.`);
    return hit;
  }
  const withCopy = all.filter((x) => pats.opening(x.w.ad)).sort((a, b) => b.lead - a.lead);
  if (!withCopy.length) {
    const why = plats.map((p) => (p.basis ? `${p.label}: ${p.winners.length ? 'its winners came without their copy' : 'no ad beat the median'}` : p.reason)).filter(Boolean).join(' ');
    throw err(409, 'no_winner', why || 'No ad history is kept for this brand yet. Import it on Connections first.');
  }
  return withCopy[0];
}

function sourceView(src) {
  const ev = require('./creative-evidence.js');
  const a = src.w.ad;
  return {
    ad_id: a.ad_id, provider: a.provider, platform: src.pl.label, name: a.name || a.ad_id,
    basis: src.pl.basis, metric: src.pl.metric, value: src.w.value, median: src.pl.median, currency: src.pl.currency || a.currency || null,
    figures: ev.adFigures(a.metrics, a.currency),
    primary_text: a.primary_text || null, headline: a.headline || null,
  };
}

function prompt(brand, source, pattern, format, lim, n) {
  const oc = require('./output-contract.js');
  const b = brand || {};
  const claims = (Array.isArray(b.claims) ? b.claims : []).map((c) => str(c, 200)).filter(Boolean);
  const facts = [`Brand: ${str(b.name, 80)}`, b.tagline && `Tagline: ${str(b.tagline, 200)}`, claims.length && `Its own claims (the ONLY facts you may use, with the ad's own copy below):\n- ${claims.join('\n- ')}`].filter(Boolean).join('\n');
  const won = source.basis === 'cost_per_result'
    ? `It cost ${source.value.toFixed(2)}${source.currency ? ' ' + source.currency : ''} per result against this brand's own median of ${source.median.toFixed(2)} on ${source.platform}.`
    : `Its click-through rate was ${(source.value * 100).toFixed(2)}% against this brand's own median of ${(source.median * 100).toFixed(2)}% on ${source.platform}.`;
  const body = `${facts}\n\nTHE WINNING AD (this brand's own, ${format}):\n  Primary text: "${str(source.primary_text, 400)}"\n  Headline: "${str(source.headline, 120)}"\n  ${won}\n\nWrite ${n} variations of this ad for ${str(b.name, 80)}. Keep its hook pattern ("${pattern}": the way its first line opens) and its format (${format}); change the wording, the angle inside the pattern, or the claim it leads with. Primary text under ${lim.primary_text} characters${lim.headline ? `, headline under ${lim.headline} characters` : ''}. Say nothing the brand's claims or the ad's own copy do not state: never invent a number, a discount, a review, a deadline or a result. No em or en dashes. Do not repeat the winning ad's own lines.`;
  return {
    systemPrompt: `You are a direct-response copywriter writing new versions of ${str(b.name, 80)}'s best-performing paid social ad, in the brand's own words.`,
    userMessage: oc.append(body, {
      id: 'ad-history.variations', kind: 'data', format: 'json', returns: `ONE JSON object: up to ${n} variations of the winning ad.`,
      shape: `{"variants":[{"primary_text":"string: under ${lim.primary_text} characters, opening in the same hook pattern","headline":"string: ${lim.headline ? `under ${lim.headline} characters` : 'empty'}"}]}`,
      missing: 'When a variation would need a fact the brand does not state, leave it out; never write a placeholder.',
      brand: str(b.name, 80),
    }),
  };
}

/** Lines built from the brand's own words in the same pattern (no model). */
function fromBrandLines(brand, source, pattern) {
  const lab = require('./ad-angle-lab.js');
  const pats = require('./ad-patterns.js');
  const b = brand || {};
  const claims = (Array.isArray(b.claims) ? b.claims : []).map((c) => str(c, 200)).filter(Boolean);
  const lead = noEnd(pats.opening(source));
  const out = [];
  const heads = [b.tagline, ...claims, b.name].map((x) => str(x, 200)).filter(Boolean);
  let hi = 0;
  const add = (pt) => { if (pt) out.push({ primary_text: pt, headline: heads.length ? heads[(hi++) % heads.length] : '' }); };
  // The source's own opening (its pattern by construction), then each claim it does not already say.
  for (const c of claims) {
    if (lead && String(source.primary_text || '').toLowerCase().includes(noEnd(c).toLowerCase())) continue;
    add(lead ? `${cap(lead)}${/[?!]$/.test(lead) ? '' : '.'} ${cap(noEnd(c))}.` : '');
  }
  for (const c of claims.concat(b.tagline ? [b.tagline] : [])) {
    for (const h of lab.templateHooks({ patterns: [pattern], answer: c, pain: lead && pattern === 'question' ? lead.replace(/\?$/, '') : '', examples: [], basis: 'own' }, b)) add(h);
  }
  return out;
}

/**
 * Make up to `n` variations of a winning ad. `ads` are the brand's own
 * (ad-history rows with cleaned metrics); `deps.callLLM` for tests.
 */
async function variationsFor({ ads, brand, adId, n, deps } = {}) {
  const b = brand || {};
  if (!b.name) throw err(409, 'brand_required', 'Set up or choose a brand first: variations are written from its own record.');
  const list = (Array.isArray(ads) ? ads : []).filter(Boolean);
  if (!list.length) throw err(409, 'no_ad_history', 'No ad history is kept for this brand yet. Import it on Connections first.');
  const want = Math.max(1, Math.min(MAX_N, Math.round(Number(n) || DEFAULT_N)));
  const pats = require('./ad-patterns.js');
  const lab = require('./ad-angle-lab.js');
  const grounding = require('./copy-grounding.js');
  const src = pickSource(list, adId);
  const source = sourceView(src);
  const pattern = lab.hookPattern(pats.opening(src.w.ad));
  const video = pats.hasVideo(src.w.ad);
  const format = video === true ? 'video' : (video === false ? 'image' : 'as the source');
  const lim = limitsFor(src.w.ad.provider, video === true);
  // The brand's own words AND the source ad's own copy (the brand ran it).
  const facts = grounding.factsFor(b, { description: [src.w.ad.primary_text, src.w.ad.headline, src.w.ad.description].filter(Boolean).join(' ') });

  let by = 'brand_lines';
  let drafted = [];
  try {
    const callLLM = (deps && deps.callLLM) || require('./llm.js');
    const p = prompt(b, source, pattern, format, lim, want);
    const outp = await callLLM({ systemPrompt: p.systemPrompt, userMessage: p.userMessage, responseFormat: { type: 'json_object' }, maxTokens: 1200, temperature: 0.8, stage: 'ad-history-variations' });
    const parsed = require('./output-contract.js').parseJsonLoose(outp && outp.text);
    const rows = parsed && Array.isArray(parsed.variants) ? parsed.variants : [];
    drafted = rows.filter((r) => r && typeof r === 'object').map((r) => ({ primary_text: str(r.primary_text, 600), headline: str(r.headline, 200) }));
    if (drafted.length) by = 'model';
  } catch (_) { drafted = []; }
  if (!drafted.length) drafted = fromBrandLines(b, src.w.ad, pattern);

  const dropped = [];
  const seen = new Set([String(src.w.ad.primary_text || '').toLowerCase().trim()]);
  const variants = [];
  for (const d of drafted) {
    if (variants.length >= want) break;
    const pt = String(d.primary_text || '').replace(/[–—]/g, ',').trim();
    let hl = String(d.headline || '').replace(/[–—]/g, ',').trim();
    if (!pt) continue;
    if (lim.primary_text && pt.length > lim.primary_text) { dropped.push({ text: pt, why: `over ${lim.primary_text} characters` }); continue; }
    const pp = lab.hookPattern(pats.opening({ primary_text: pt }));
    if (pp !== pattern) { dropped.push({ text: pt, why: `opens as "${pp}", not the winning ad's "${pattern}"` }); continue; }
    const bad = grounding.unbacked(pt, facts);
    if (bad.length) { dropped.push({ text: pt, why: `states ${bad.join(', ')}, which the brand does not` }); continue; }
    if (hl && ((lim.headline && hl.length > lim.headline) || grounding.unbacked(hl, facts).length)) { dropped.push({ text: hl, why: 'headline over its limit or not the brand\'s words; left blank' }); hl = ''; }
    if (!lim.headline) hl = '';
    const key = pt.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push({ primary_text: pt, headline: hl || null, pattern, format });
  }
  const id = String(source.ad_id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const out = variants.map((v, i) => Object.assign(v, {
    id: `var-${id}-${i + 1}`, by,
    variation_of: { ad_id: source.ad_id, provider: source.provider, platform: source.platform, name: source.name, basis: source.basis, metric: source.metric, value: source.value, median: source.median, currency: source.currency, figures: source.figures },
    // The shape Paid launch's "briefs" source takes.
    brief: { id: `var-${id}-${i + 1}`, angle_name: `Variation ${i + 1} of "${str(source.name, 50)}"`, basis: 'variation', primary_text: v.primary_text, headline: v.headline || '', signal_share: null },
  }));
  const gaps = [];
  if (out.length < want) gaps.push(`${out.length} of ${want} variations: ${b.name}'s record and the winning ad state too few lines to write more in the "${pattern}" pattern without inventing.`);
  return { ok: true, source, pattern, format, limits: lim, by, variations: out, dropped, gaps,
    note: by === 'brand_lines' ? 'No model answered, so these are built from the brand\'s own lines in the winning ad\'s pattern.' : '' };
}

module.exports = { variationsFor, pickSource, limitsFor, fromBrandLines, prompt, MAX_N, DEFAULT_N };
