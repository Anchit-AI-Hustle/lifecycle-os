'use strict';
/**
 * owner-desk-server.js - the model-written parts of the Owner's Desk
 * (2026-10-23). The numbers are owner-desk.js's (code); this writes words:
 *
 *   launch-concepts  "pitch me 3 campaign concepts in one line each, with the
 *                    feeling each one should create"
 *   launch-visuals   "create 6 visuals in my brand style: a website hero, 3
 *                    square posts and 2 vertical stories. Same product, same
 *                    look, clean space for text" (prompts, no model: each is
 *                    built from the brand's own style lock and image rules)
 *   ad-fix           "write 3 replacement ads (headline + description), each
 *                    testing a different angle, with a matching image"
 *   reviews          "group praise and complaints by theme ... quote the 3
 *                    lines I should use in my ads ... a warm reply to every
 *                    negative review ... the 3 fixes"
 *
 * Every answer is held to the brand's own words (copy-grounding), Google's
 * own limits (asset-contracts: 30 / 90, never cut), and the counts code makes.
 * A quote is a review's own words by NUMBER (the model cannot write one), a
 * reply goes only to a review that is negative by its stated rating, and a fix
 * names a complaint theme that was counted. No model: the template path says
 * so and writes from the brand's own lines.
 */
const OD = require('./owner-desk.js');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 400);
const noDash = (s) => String(s || '').replace(/\s*[–—]\s*/g, ', ');

function lines(brand) {
  const b = brand || {};
  return {
    name: str(b.name, 80),
    tagline: str(b.tagline, 200),
    claims: (Array.isArray(b.claims) ? b.claims : []).map((c) => str(c, 200)).filter(Boolean),
    offerings: (Array.isArray(b.offerings) ? b.offerings : []).map((o) => str(o && (o.name || o), 80)).filter(Boolean),
    voice: str(b.voice && b.voice.tone, 200),
  };
}

function groundingFor(brand, product) {
  const g = require('./copy-grounding.js');
  const facts = g.factsFor(brand, product ? { title: product.title, description: product.description } : null);
  return { ok: (t) => !!t && !g.unbacked(t, facts).length, why: (t) => g.unbacked(t, facts) };
}

async function ask(deps, prompt, stage, maxTokens) {
  const callLLM = (deps && deps.callLLM) || require('./llm.js');
  const out = await callLLM({ systemPrompt: prompt.systemPrompt, userMessage: prompt.userMessage, responseFormat: { type: 'json_object' }, maxTokens: maxTokens || 1400, temperature: 0.6, stage });
  return require('./output-contract.js').parseJsonLoose(out && out.text);
}

function factsBlock(L, product) {
  return [
    `Brand: ${L.name}`, L.tagline && `Tagline: ${L.tagline}`,
    L.voice && `Voice: ${L.voice}`,
    L.claims.length ? `Its own claims (the ONLY facts you may state):\n- ${L.claims.join('\n- ')}` : 'It has stated no claims: state no fact about it beyond its name and product.',
    product && product.title && `Product: ${product.title}${product.price ? ` (${product.price})` : ''}${product.description ? `. ${str(product.description, 300)}` : ''}`,
  ].filter(Boolean).join('\n');
}

/* ── 1. Launch concepts ─────────────────────────────────────────────────── */

const FEELINGS = ['trust', 'desire', 'relief'];

async function launchConcepts({ brand, product, customer, deps }) {
  const L = lines(brand);
  const G = groundingFor(brand, product);
  const contract = require('./output-contract.js');
  const who = str(customer, 300);
  const body = `${factsBlock(L, product)}${who ? `\nIdeal customer: ${who}` : ''}\n\nPitch 3 campaign concepts for launching ${product && product.title ? product.title : `${L.name}'s offering`}${who ? ` to ${who}` : ''}. Each is ONE line (under 110 characters) a creative director would say in a pitch, built on a different angle, using only the brand's own claims and the product's own facts. For each, name the ONE feeling it should create in a few words. Never invent a number, an offer, a review, a deadline or a result. No em or en dashes.`;
  let concepts = []; let by = 'template'; const dropped = [];
  try {
    const parsed = await ask(deps, {
      systemPrompt: `You are the creative director for ${L.name}.`,
      userMessage: contract.append(body, {
        id: 'owner-desk.launch-concepts', kind: 'data', format: 'json', returns: 'ONE JSON object with exactly 3 concepts.',
        shape: '{"concepts":[{"line":"string: the concept in one line, under 110 characters","feeling":"string: the feeling it should create, a few words","angle":"string: the angle, two or three words"}]}',
        missing: 'When a concept would need a fact the brand does not state, write a different concept; never a placeholder.',
        brand: L.name,
      }),
    }, 'owner-desk-launch-concepts', 900);
    for (const c of (parsed && Array.isArray(parsed.concepts) ? parsed.concepts : [])) {
      const line = noDash(str(c && c.line, 110));
      if (!line) continue;
      if (!G.ok(line)) { dropped.push({ line, why: G.why(line) }); continue; }
      concepts.push({ line, feeling: noDash(str(c.feeling, 60)), angle: noDash(str(c.angle, 40)) });
    }
    if (concepts.length) by = 'model';
  } catch (_) { concepts = []; }
  if (concepts.length < 3) {
    const own = [L.tagline].concat(L.claims).filter(Boolean);
    for (let i = 0; concepts.length < 3 && i < own.length; i++) {
      const line = noDash(own[i]).replace(/\.$/, '');
      if (concepts.some((c) => c.line.toLowerCase() === line.toLowerCase())) continue;
      concepts.push({ line, feeling: FEELINGS[concepts.length % 3], angle: i === 0 ? 'the brand promise' : 'its own claim', from: 'brand record' });
    }
  }
  return {
    ok: concepts.length > 0, concepts: concepts.slice(0, 3), by, dropped,
    note: concepts.length ? null : `${L.name || 'This brand'} has no tagline or claims on its record and no model answered, so there is nothing true to pitch yet. Add its claims in Brand Setup.`,
  };
}

/* ── 2. Launch visuals (prompts, no model) ──────────────────────────────── */

const VISUALS = [
  { key: 'hero', label: 'Website hero', size: '1920x1080', ratio: '16:9', space: 'Keep the left third clear and calm for a headline and a button.' },
  { key: 'square-1', label: 'Square post 1', size: '1080x1080', ratio: '1:1', space: 'Keep the top quarter clear for one line of text.', shot: 'the product close up, the hero of the frame' },
  { key: 'square-2', label: 'Square post 2', size: '1080x1080', ratio: '1:1', space: 'Keep the bottom quarter clear for one line of text.', shot: 'the product in use, in a real moment' },
  { key: 'square-3', label: 'Square post 3', size: '1080x1080', ratio: '1:1', space: 'Keep a clear band down the right side for text.', shot: 'a detail of the product: texture, material, finish' },
  { key: 'story-1', label: 'Vertical story 1', size: '1080x1920', ratio: '9:16', space: 'Keep the top 250 and bottom 340 pixels clear (the app covers them) and the upper third calm for text.', shot: 'the product in its setting, wide' },
  { key: 'story-2', label: 'Vertical story 2', size: '1080x1920', ratio: '9:16', space: 'Keep the top 250 and bottom 340 pixels clear and the lower middle calm for a call to action.', shot: 'a hand reaching for or holding the product' },
];

function styleLockLines(brand) {
  const s = (brand && brand.brand_data && brand.brand_data.style_lock) || {};
  return [
    s.photo_style && `Photo style (the brand's own): ${str(s.photo_style, 400)}.`,
    s.personality && `Personality: ${str(s.personality, 80)}.`,
    Array.isArray(s.rules) && s.rules.length && `Never break: ${s.rules.map((r) => str(r, 160)).join(' ')}`,
  ].filter(Boolean).join(' ');
}

function launchVisuals({ brand, concept, product }) {
  const { buildPreamble } = require('./image-prompt.js');
  const named = product && product.title ? { product: { title: product.title, category: product.category } } : null;
  const lock = styleLockLines(brand);
  const c = str(concept && concept.line, 200);
  const feeling = str(concept && concept.feeling, 80);
  const same = `One campaign: the same product, the same light, the same palette and the same grade in all six frames.`;
  const visuals = VISUALS.map((v) => {
    const pre = buildPreamble(brand, 'photo', named).trim();
    const prompt = [
      `${v.label} for the campaign "${c}"${feeling ? `, which should make people feel ${feeling}` : ''}.`,
      v.shot ? `Shot: ${v.shot}.` : `Shot: the product as the clear subject, room to breathe around it.`,
      `Frame: ${v.ratio} (${v.size}). ${v.space}`,
      same, lock, pre,
    ].filter(Boolean).join(' ');
    const real = product && /^https:\/\//.test(String(product.image_url || '')) && v.key === 'square-1' ? product.image_url : null;
    return { key: v.key, label: v.label, size: v.size, ratio: v.ratio, prompt, real_photo: real, real_note: real ? 'Uses the product\'s own catalogue photo; generate only if you want a new shot.' : null };
  });
  return { ok: !!c, visuals, style_locked: !!lock, note: c ? null : 'Pick a concept first.' };
}

/* ── 3. Fix the worst ad ────────────────────────────────────────────────── */

function limitOf(slot, fallback) {
  try { const n = require('./asset-contracts.js').slotLimit('ad.google.rsa', slot); return n || fallback; } catch (_) { return fallback; }
}

async function adFix({ brand, worst, why, product, deps }) {
  const L = lines(brand);
  const G = groundingFor(brand, product);
  const H = limitOf('headlines', 30); const D = limitOf('descriptions', 90);
  const contract = require('./output-contract.js');
  const body = `${factsBlock(L, product)}\n\nThe ad burning the most money: "${str(worst && worst.ad, 200)}". What the numbers say:\n- ${(why || []).map((w) => str(w, 300)).join('\n- ')}\n\nWrite 3 replacement ads, each testing a DIFFERENT angle (for example the product's own benefit, who it is for, a reason to choose this brand). Each has a headline of at most ${H} characters and a description of at most ${D} characters (Google's own limits; count every character), and a one-sentence image brief for a matching photo in the brand's style (no text in the photo). Say nothing the brand's claims and product facts do not state: no number, discount, review, deadline or result of your own. No em or en dashes.`;
  const ads = []; const dropped = []; let by = 'template';
  try {
    const parsed = await ask(deps, {
      systemPrompt: `You are a performance marketer rewriting ${L.name}'s weakest search ad.`,
      userMessage: contract.append(body, {
        id: 'owner-desk.ad-fix', kind: 'data', format: 'json', returns: 'ONE JSON object with exactly 3 ads.',
        shape: `{"ads":[{"angle":"string: the angle this ad tests","headline":"string: at most ${H} characters","description":"string: at most ${D} characters","image_brief":"string: one sentence, the photo that goes with it"}]}`,
        missing: 'When an ad would need a fact the brand does not state, test another angle; never a placeholder.',
        brand: L.name,
      }),
    }, 'owner-desk-ad-fix', 1000);
    for (const a of (parsed && Array.isArray(parsed.ads) ? parsed.ads : [])) {
      const headline = noDash(str(a && a.headline, 200)); const description = noDash(str(a && a.description, 400));
      if (!headline || !description) continue;
      if (headline.length > H || description.length > D) { dropped.push({ headline, why: `over Google's limit (${headline.length}/${H}, ${description.length}/${D}); left out, never cut` }); continue; }
      const bad = G.why(`${headline} ${description}`);
      if (bad.length) { dropped.push({ headline, why: `claims the brand does not state: ${bad.join(', ')}` }); continue; }
      ads.push({ angle: noDash(str(a.angle, 60)), headline, description, image_brief: noDash(str(a.image_brief, 300)) });
    }
    if (ads.length) by = 'model';
  } catch (_) { /* template below */ }
  if (ads.length < 3) {
    // The brand's own lines, chosen to fit, never cut.
    const heads = [L.name, product && product.title, L.tagline].concat(L.claims).map((t) => noDash(str(t, 200)).replace(/\.$/, '')).filter((t) => t && t.length <= H);
    const descs = [L.tagline].concat(L.claims).map((t) => noDash(str(t, 400))).filter((t) => t && t.length <= D);
    for (let i = 0; ads.length < 3 && i < Math.max(heads.length, descs.length); i++) {
      const h = heads[i % (heads.length || 1)]; const d = descs[(i + ads.length) % (descs.length || 1)];
      if (!h || !d || ads.some((a) => a.headline === h && a.description === d)) continue;
      ads.push({ angle: i === 0 ? 'the brand promise' : 'its own claim', headline: h, description: d, image_brief: product && product.title ? `${product.title} as the clear subject, in natural light.` : '', from: 'brand record' });
    }
  }
  const { buildPreamble } = require('./image-prompt.js');
  const named = product && product.title ? { product: { title: product.title, category: product.category } } : null;
  const lock = styleLockLines(brand);
  ads.forEach((a) => { a.image_prompt = [a.image_brief, 'Frame: 1200x628 and 1:1 (Google responsive display).', lock, buildPreamble(brand, 'photo', named).trim()].filter(Boolean).join(' '); });
  return { ok: ads.length > 0, ads: ads.slice(0, 3), by, dropped, limits: { headline: H, description: D } };
}

/* ── 4. Mine the reviews ────────────────────────────────────────────────── */

const MAX_REVIEWS = 150;

async function reviews({ brand, list, deps }) {
  const L = lines(brand);
  const G = groundingFor(brand);
  const rs = (Array.isArray(list) ? list : []).slice(0, MAX_REVIEWS).map((r, i) => ({ i, text: str(r && r.text, 400), rating: r && r.rating != null && isFinite(Number(r.rating)) ? Number(r.rating) : null, author: str(r && r.author, 60), date: str(r && r.date, 10) }))
    .filter((r) => r.text);
  if (!rs.length) return { ok: false, error: 'reviews_required', message: 'Add reviews first: a CSV export from your Google Business Profile, or paste them one per line.' };
  const contract = require('./output-contract.js');
  const numbered = rs.map((r) => `${r.i}${r.rating != null ? ` [${r.rating}/5]` : ''}: ${r.text}`).join('\n');
  const body = `Brand: ${L.name}\n\nREVIEWS BY NUMBER:\n${numbered}\n\n1. For EVERY review, list its themes: a short theme name (two to four words, the same name for the same thing across reviews) and whether it is praise or a complaint.\n2. Give the numbers of the 3 reviews whose own words would work best in an ad (praise, specific, believable). Do not rewrite them.\n3. For every NEGATIVE review (rated 3 or lower, or only complaints), write a warm, specific reply from ${L.name}: thank them by what they said, own the problem, say what happens next. Promise no refund, discount, gift or compensation, and state no fact about the brand it has not stated.\n4. Give the 3 fixes that would resolve the most complaints, each naming the complaint theme it fixes exactly as you named it.\nNo em or en dashes.`;
  let parsed = null; let by = 'model';
  try {
    parsed = await ask(deps, {
      systemPrompt: `You read ${L.name}'s customer reviews and turn them into themes, ad lines and replies.`,
      userMessage: contract.append(body, {
        id: 'owner-desk.reviews', kind: 'data', format: 'json', returns: 'ONE JSON object.',
        shape: '{"labels":[{"i":"number: the review number","themes":[{"theme":"string","kind":"praise or complaint"}]}],"quotes":["number: a review number"],"replies":[{"i":"number: a negative review number","reply":"string"}],"fixes":[{"theme":"string: a complaint theme as named in labels","fix":"string: what to change"}]}',
        missing: 'When a review says nothing clear, give it no themes; never invent one.',
        brand: L.name,
      }),
    }, 'owner-desk-reviews', 3000);
  } catch (_) { parsed = null; }
  if (!parsed || !Array.isArray(parsed.labels)) {
    by = 'none';
    return { ok: false, error: 'no_model', message: 'Grouping reviews by theme needs a model, and none answered. Nothing was counted, so no theme is shown rather than one guessed.', total: rs.length };
  }
  const labels = parsed.labels.map((l) => ({ i: Number(l && l.i), themes: Array.isArray(l && l.themes) ? l.themes : [] })).filter((l) => Number.isInteger(l.i));
  const counted = OD.reviewThemes(rs, labels);
  const labelOf = {}; labels.forEach((l) => { labelOf[l.i] = l; });
  const byI = {}; rs.forEach((r) => { byI[r.i] = r; });
  const quotes = (Array.isArray(parsed.quotes) ? parsed.quotes : []).map(Number)
    .filter((i, k, a) => byI[i] && a.indexOf(i) === k && !OD.isNegative(byI[i], labelOf[i]))
    .slice(0, 3).map((i) => ({ i, text: byI[i].text, author: byI[i].author || null, rating: byI[i].rating }));
  const replies = []; const droppedReplies = [];
  (Array.isArray(parsed.replies) ? parsed.replies : []).forEach((r) => {
    const i = Number(r && r.i); const text = noDash(str(r && r.reply, 900));
    if (!byI[i] || !text || !OD.isNegative(byI[i], labelOf[i]) || replies.some((x) => x.i === i)) return;
    if (/\b(refund|discount|voucher|coupon|free|gift|compensat)/i.test(text)) { droppedReplies.push({ i, why: 'it promised something the brand did not offer' }); return; }
    if (!G.ok(text)) { droppedReplies.push({ i, why: `claims the brand does not state: ${G.why(text).join(', ')}` }); return; }
    replies.push({ i, review: byI[i].text, rating: byI[i].rating, reply: text });
  });
  const negatives = rs.filter((r) => OD.isNegative(r, labelOf[r.i]));
  const complaintNames = new Set(counted.complaints.map((c) => c.theme));
  const fixes = (Array.isArray(parsed.fixes) ? parsed.fixes : []).map((f) => ({ theme: str(f && f.theme, 60).toLowerCase(), fix: noDash(str(f && f.fix, 300)) }))
    .filter((f) => f.fix && complaintNames.has(f.theme))
    .map((f) => { const c = counted.complaints.find((x) => x.theme === f.theme); return Object.assign(f, { count: c.count, of: counted.total }); })
    .sort((a, b) => b.count - a.count).slice(0, 3);
  return {
    ok: true, by, themes: counted, quotes, replies, fixes,
    negatives: negatives.length, unreplied: negatives.filter((r) => !replies.some((x) => x.i === r.i)).map((r) => r.i),
    dropped: droppedReplies, read: rs.length, cap: list.length > MAX_REVIEWS ? `The first ${MAX_REVIEWS} of ${list.length} reviews were read.` : null,
  };
}

/* ── Router ──────────────────────────────────────────────────────────────── */

async function handle(action, { brand, body, deps }) {
  const b = body || {};
  const product = b.product && typeof b.product === 'object' ? { title: str(b.product.title, 160), price: str(b.product.price, 40), description: str(b.product.description, 600), category: str(b.product.category, 80), image_url: str(b.product.image_url, 600) } : null;
  if (action === 'launch-concepts') return launchConcepts({ brand, product, customer: b.customer, deps });
  if (action === 'launch-visuals') return launchVisuals({ brand, concept: b.concept, product });
  if (action === 'ad-fix') return adFix({ brand, worst: b.worst, why: Array.isArray(b.why) ? b.why.slice(0, 6) : [], product, deps });
  if (action === 'reviews') return reviews({ brand, list: b.reviews, deps });
  return { ok: false, error: 'unknown_op' };
}

module.exports = { handle, launchConcepts, launchVisuals, adFix, reviews, styleLockLines, VISUALS };
