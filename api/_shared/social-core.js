'use strict';

/**
 * api/_shared/social-core.js — Social Media OS: autonomous daily post generation.
 *
 * Multi-agent daily pipeline (each step = ONE bounded LLM call via _shared/llm.js
 * on the right tier; every step degrades to a deterministic fallback so the run
 * NEVER fails outright):
 *   1. Ideology agent      (premium)  — the day's creative theme (festivals +
 *                                       product-focus rotation from data/*.json)
 *   2. Data & hypothesis   (standard) — signals + performance hypothesis,
 *                                       avoids repeating recent posts (DB)
 *   3. Business & strategy (premium)  — objective / CTA / link per platform
 *                                       (real knickgasm.com handles ONLY)
 *   4. Content agent       (premium)  — per-platform copy incl. long-form blog
 *   5. Design agent                   — hero image via creative-image.js
 *                                       (in-process api/ai/image.js cascade);
 *                                       on failure emits the image PROMPT
 *   6. Audio/Video agent              — storyboard + video-core.generateVideo
 *                                       (stubs gracefully without keys)
 *   7. Compilation agent   (fast)     — assembles the final day-package JSON
 *   8. Sanitize                       — every string through the brand scrub
 *                                       (scenario-model sanitizeBrand)
 *
 * The whole pipeline is time-boxed to ~75s (PIPELINE_BUDGET_MS); the Vercel
 * function running it has maxDuration 90/120. Persistence to Supabase table
 * social_posts_generated is best-effort — without Supabase the day-package is
 * still returned in full ({ persistence: { persisted:false } }).
 *
 * Platform push stays Phase 2: every post carries
 * push_status:'not_integrated_phase_2'; _shared/social-push-core.js exposes the
 * { connected:false, would_request } stubs per platform.
 *
 * Underscore-prefixed (_shared) → NOT counted against the Hobby 12-function cap.
 */

const fs = require('fs');
const path = require('path');

let callLLM = null;
try { callLLM = require('./llm.js'); } catch (_) { callLLM = null; }
const scenario = require('./scenario-model.js');
const creative = require('./creative-image.js'); // eslint-disable-line no-unused-vars
let catalogImage = null;
try { catalogImage = require('./catalog-image.js'); } catch (_) { catalogImage = null; }
const video = require('./video-core.js');
const push = require('./social-push-core.js');
let brandPlaceholder = null;
try { brandPlaceholder = require('./brand-placeholder.js'); } catch (_) { brandPlaceholder = null; }
let supa = null;
try { supa = require('./supa.js'); } catch (_) { supa = null; }

const TABLE = 'social_posts_generated';
const PIPELINE_BUDGET_MS = 75000; // whole-run time box (function maxDuration is 120s)
const MARKET = 'UK';

// ── Platform specs — every per-platform constraint lives in DATA, not prose ──
const PLATFORM_SPECS = {
  instagram_feed:    { platform: 'instagram', format: 'feed',    media: 'image', aspect: '4:5',    dims: '1080x1350', char_limit: 2200, hashtags: [8, 12], tone: 'warm, sensory, story-led caption; first line earns the pause', best_time_utc: '17:30' },
  instagram_reels:   { platform: 'instagram', format: 'reels',   media: 'video', aspect: '9:16',   dims: '1080x1920', char_limit: 2200, hashtags: [4, 8],  tone: 'hooky first line, sensory, native to Reels', best_time_utc: '16:00' },
  instagram_stories: { platform: 'instagram', format: 'stories', media: 'video', aspect: '9:16',   dims: '1080x1920', char_limit: 250,  hashtags: [0, 2],  tone: 'casual, tappable, one idea per frame', best_time_utc: '12:00' },
  facebook:          { platform: 'facebook',  format: 'feed',    media: 'image', aspect: '4:5',    dims: '1080x1350', char_limit: 600,  hashtags: [1, 3],  tone: 'warm, community, slightly longer-form', best_time_utc: '13:00' },
  tiktok:            { platform: 'tiktok',    format: 'video',   media: 'video', aspect: '9:16',   dims: '1080x1920', char_limit: 2200, hashtags: [3, 5],  tone: 'hooky, fast, native — never ad-like', best_time_utc: '18:00' },
  linkedin:          { platform: 'linkedin',  format: 'post',    media: 'image', aspect: '1.91:1', dims: '1200x627',  char_limit: 3000, hashtags: [2, 3],  tone: 'professional, founder-free, the brand speaks as we', best_time_utc: '08:30' },
  x:                 { platform: 'x',         format: 'post',    media: 'image', aspect: '16:9',   dims: '1200x675',  char_limit: 280,  hashtags: [1, 2],  tone: 'crisp, observational, one thought', best_time_utc: '12:30' },
  pinterest:         { platform: 'pinterest', format: 'pin',     media: 'image', aspect: '2:3',    dims: '1000x1500', char_limit: 500,  title_limit: 100, hashtags: [3, 6], tone: 'evergreen, search-friendly, useful', best_time_utc: '20:00' },
  youtube_shorts:    { platform: 'youtube',   format: 'shorts',  media: 'video', aspect: '9:16',   dims: '1080x1920', char_limit: 5000, title_limit: 100, hashtags: [2, 3], tone: 'clear, curiosity-led title; description supports search', best_time_utc: '15:00' },
  threads:           { platform: 'threads',   format: 'post',    media: 'image', aspect: '4:5',    dims: '1080x1350', char_limit: 500,  hashtags: [1, 3],  tone: 'conversational, lightly witty', best_time_utc: '14:00' },
  blog:              { platform: 'blog',      format: 'article', media: 'image', aspect: '16:9',   dims: '1200x675',  word_range: [800, 1200], hashtags: [0, 0], tone: 'editorial, SEO-aware, 800-1200 words', best_time_utc: '09:00' },
};
const ALL_KEYS = Object.keys(PLATFORM_SPECS);

// ── Data loaders (repo-root data/*.json; graceful when absent) ───────────────
function loadJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')); } catch (_) { return null; }
}
function productTypes() { return loadJson('data/product-types.json') || { store: { base_url: '', product_url_pattern: '{base}/products/{handle}' }, types: {} }; }
function festivalsUK() { const f = loadJson('data/festivals.json'); return (f && f.UK) || []; }

// ── Brand scrub — every emitted string passes through here ───────────────────
// scenario-model sanitizeBrand collapses whitespace, which would flatten blog
// markdown — so we only rewrite strings that actually contain a violation.
const SCRUB_RX = /wellness journey|liquid gold|game[\s-]?changer|hurry|don'?t miss out|last chance|while supplies last/i;
const SCRUB_TRANSFORM_RX = /\btransform(ing|ed|s|ation)?\b/i;
const SCRUB_CAPS_RX = /LIMITED TIME/; // caps form specifically
function scrubString(s) {
  if (typeof s !== 'string') return s;
  // Always run sanitizeBrand so em/en dashes + banned phrases are scrubbed on
  // EVERY string. BUT sanitizeBrand ends with a collapse of whitespace runs
  // (\s{2,}->' '), and \n matches \s — running it on a whole multi-paragraph
  // string flattens blog markdown + multi-line captions into one run-on line and
  // turns "##" headings into inline literals. So for multiline strings, scrub
  // each line independently and rejoin: dashes/banned phrases are still rewritten
  // on every line, but paragraph breaks and headings survive intact.
  const clean = s.includes('\n')
    ? s.split('\n').map((line) => scenario.sanitizeBrand(line)).join('\n')
    : scenario.sanitizeBrand(s);
  try { scenario.assertNoBanned(clean, 'social-core'); } catch (_) { /* tripwire only */ }
  return clean;
}
function deepScrub(v) {
  if (typeof v === 'string') return scrubString(v);
  if (Array.isArray(v)) return v.map(deepScrub);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepScrub(v[k]);
    return out;
  }
  return v;
}

// ── Date / rotation helpers ───────────────────────────────────────────────────
function normDate(d) {
  const s = String(d || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date().toISOString().slice(0, 10);
}
function dayOfYear(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return Math.floor((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 0))) / 86400000);
}

// Product-focus rotation over the legacy product-type keys in product-types.json:
//   'tb' = the core custom-sneaker range · 'coffee' = the coffee-ART collection
//   (a paint theme, not a drink) · 'supplements' = the accessories lane.
// Every lane is one-time purchase. 7-day cycle: coffee x3, tb x3, accessories x1.
const FOCUS_CYCLE = ['coffee', 'tb', 'coffee', 'supplements', 'tb', 'coffee', 'tb'];
function focusFor(dateIso, facts) {
  const doy = dayOfYear(dateIso);
  const type = FOCUS_CYCLE[doy % FOCUS_CYCLE.length];
  const t = (facts.types || {})[type] || {};
  const base = (facts.store && facts.store.base_url) || '';
  let product;
  if (type === 'coffee') {
    product = { title: t.label || 'coffee-ART Collection', handle: t.handle || 'nike-air-force-1-coffee-dip-rope-laces' };
  } else {
    const list = t.products || [];
    product = list.length ? list[doy % list.length] : { title: '[DATA REQUIRED BEFORE LAUNCH: catalogue item]', handle: '' };
  }
  return {
    type,
    label: t.label || type,
    purchase_mode: t.purchase_mode || 'one_time_only', // default unless the brand declares a subscription
    product: {
      title: product.title,
      handle: product.handle,
      url: base + '/products/' + product.handle,
      price_gbp: product.price_gbp || null,
      compare_at_gbp: product.compare_at_gbp || null,
      image: product.image || null,
    },
    coffee_facts: type === 'coffee' ? { packs: t.packs || [], gifts: t.gifts || [], sub_gift_hook: t.sub_gift_hook || '' } : null,
  };
}

function festivalFor(dateIso) {
  const list = festivalsUK();
  const mmdd = dateIso.slice(5);
  const exact = list.find((f) => f.date === mmdd);
  if (exact) return { ...exact, upcoming: false };
  // Look ahead 3 days for an upcoming moment worth building toward.
  const d0 = new Date(dateIso + 'T00:00:00Z');
  let best = null;
  for (let i = 1; i <= 3; i++) {
    const d = new Date(d0.getTime() + i * 86400000);
    const key = String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    for (const f of list) {
      if (f.date === key && (!best || (f.weight || 0) > (best.weight || 0))) best = { ...f, upcoming: true, days_away: i };
    }
  }
  return best;
}

// ── LLM helper (one bounded call; caller catches → deterministic fallback) ───
// Premium-first with automatic downgrade: the premium cascade only tries the paid
// providers' forward model IDs (gpt-5.5, gemini-3.1-pro, ...); if none is entitled
// on the configured keys, callLLM throws and the agent drops to its deterministic
// template. Retrying standard then fast reaches smaller real models (incl. free
// tiers) so social copy is LLM-written whenever any provider/model works.
async function llmJson({ tier, stage, system, user, maxTokens = 1200, timeoutMs = 15000, temperature = 0.7 }) {
  if (!callLLM) throw new Error('llm unavailable');
  const tiers = [...new Set([tier || 'premium', 'standard', 'fast'])];
  let lastErr;
  for (const t of tiers) {
    try {
      const out = await callLLM({
        systemPrompt: system,
        userMessage: user,
        responseFormat: { type: 'json_object' },
        maxTokens, temperature, timeoutMs, stage, tier: t,
      });
      const text = typeof out === 'string' ? out : (out && out.text) || '';
      return callLLM.parseJSON(text);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function brandName(ctx) {
  let b = (ctx && ctx.brand && ctx.brand.id) ? ctx.brand : null;
  if (!b) { try { b = require('./brand-runtime.js').scopedBrand(null); } catch (_) { b = {}; } }
  return b.name || 'this brand';
}
function brandRecord(ctx) {
  let b = (ctx && ctx.brand && ctx.brand.id) ? ctx.brand : null;
  if (!b) { try { b = require('./brand-runtime.js').scopedBrand(null); } catch (_) { b = {}; } }
  return b || {};
}
function brandPersona(ctx, role) {
  const b = brandRecord(ctx);
  const bits = [b.name || 'this brand'];
  if (b.industry) bits.push(b.industry);
  return 'You are the ' + role + ' for ' + bits.join(' - ') + '.';
}
// Brand gates DERIVED from the active brand: its own banned phrases, its own
// verifiable claims, its own voice and store. Never a fixed tenant's.
function brandGates(ctx) {
  const b = brandRecord(ctx);
  const v = b.voice || {};
  const claims = (Array.isArray(b.claims) && b.claims.length) ? b.claims.join('; ') : '[DATA REQUIRED BEFORE LAUNCH: verifiable claims]';
  const host = String(b.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const out = ['HARD BRAND GATES (a violation rejects the whole output):'];
  if (Array.isArray(v.banned) && v.banned.length) out.push('- BANNED phrases, never use in any casing: ' + v.banned.map(function (x) { return '"' + x + '"'; }).join(', ') + '.');
  out.push('- NO founder voice: the brand speaks as "we".');
  out.push('- NO health, medical or performance claims of any kind. The ONLY claims allowed are this brand\'s own: ' + claims + '.');
  out.push('- Never state a price, discount code or URL that was not supplied in the brief.');
  out.push(host ? '- Links: ONLY pages on ' + host + ' using the handles provided.' : '- Links: ONLY URLs supplied in the brief.');
  if (v.tone) out.push('- Voice: ' + v.tone + '.' + (Array.isArray(v.preferred) && v.preferred.length ? ' Preferred words: ' + v.preferred.join(', ') + '.' : ''));
  return out.join('\n');
}

// ── Agent 1: Ideology (premium) ───────────────────────────────────────────────
function fallbackIdeology(ctx) {
  const f = ctx.festival;
  const p = ctx.focus.product;
  return {
    theme: f ? (f.name + ' — a pair that exists once') : ('One of one, and only one: ' + p.title),
    narrative: 'Today we sit with ' + p.title + ', from ' + brandName(ctx) + '.',
    mood: 'calm, warm, sensory',
    visual_direction: 'Golden-hour still life on chalk linen: ' + p.title + ' as hero, deep deep-purple ceramics, steam catching the light, small lava accents; generous negative space.',
    calendar_moment: f ? f.name : null,
  };
}
async function ideologyAgent(ctx, timeoutMs) {
  const f = ctx.festival;
  const out = await llmJson({
    tier: 'premium', stage: 'social-ideology', timeoutMs, maxTokens: 700,
    system: brandPersona(ctx, 'creative director') + ' Set today\'s single creative theme for all social channels. Reply as strict JSON: {"theme":"","narrative":"","mood":"","visual_direction":"","calendar_moment":null}.\n' + brandGates(ctx),
    user: 'Date: ' + ctx.date + ' (UK).\nCalendar moment: ' + (f ? (f.name + (f.upcoming ? ' in ' + f.days_away + ' day(s)' : ' today') + ', tags: ' + (f.tags || []).join(', ')) : 'none — lean on the everyday ritual') + '.\nProduct focus today (rotation): ' + ctx.focus.label + ' — hero product: ' + ctx.focus.product.title + '.\nRecent themes to NOT repeat: ' + JSON.stringify(ctx.recentThemes.slice(0, 8)) + '.\nGive one theme that works across Instagram, TikTok, LinkedIn, X, Pinterest, YouTube Shorts, Threads and a blog post.',
  });
  const fb = fallbackIdeology(ctx);
  return {
    theme: String(out.theme || fb.theme),
    narrative: String(out.narrative || fb.narrative),
    mood: String(out.mood || fb.mood),
    visual_direction: String(out.visual_direction || fb.visual_direction),
    calendar_moment: out.calendar_moment != null ? out.calendar_moment : fb.calendar_moment,
  };
}

// ── Agent 2: Data & hypothesis (standard) ────────────────────────────────────
function fallbackHypothesis(ctx) {
  const signals = [
    'product focus rotation → ' + ctx.focus.label + ' (' + ctx.focus.purchase_mode + ')',
    ctx.festival ? ('calendar: ' + ctx.festival.name + (ctx.festival.upcoming ? ' in ' + ctx.festival.days_away + ' day(s)' : ' today')) : 'no festival — evergreen ritual angle',
    ctx.recentThemes.length ? (ctx.recentThemes.length + ' recent posts on file — repetition avoided') : 'no recent posts on file — first run',
  ];
  return {
    hypothesis: 'Single-product sensory storytelling around ' + ctx.focus.product.title + ' will outperform broad brand posts today: it is fresh against recent output, pairs a concrete product with a felt moment, and gives every platform one clear click target.',
    signals,
    avoid: ctx.recentThemes.slice(0, 8),
  };
}
async function hypothesisAgent(ctx, ideology, timeoutMs) {
  const out = await llmJson({
    tier: 'standard', stage: 'social-hypothesis', timeoutMs, maxTokens: 600,
    system: brandPersona(ctx, 'growth analyst') + ' Given today\'s signals, state a falsifiable hypothesis on what will perform. Reply as strict JSON: {"hypothesis":"","signals":[""],"avoid":[""]}.',
    user: 'Theme: ' + ideology.theme + '\nFocus: ' + ctx.focus.label + ' / ' + ctx.focus.product.title + ' (' + ctx.focus.purchase_mode + ')\nCalendar: ' + (ctx.festival ? ctx.festival.name : 'none') + '\nRecent post themes (avoid repeating): ' + JSON.stringify(ctx.recentThemes.slice(0, 10)),
  });
  const fb = fallbackHypothesis(ctx);
  return {
    hypothesis: String(out.hypothesis || fb.hypothesis),
    signals: Array.isArray(out.signals) && out.signals.length ? out.signals.map(String) : fb.signals,
    avoid: Array.isArray(out.avoid) ? out.avoid.map(String) : fb.avoid,
  };
}

// ── Agent 3: Business & strategy (premium) ───────────────────────────────────
const DEFAULT_OBJECTIVE = {
  instagram_feed: 'awareness', instagram_reels: 'awareness', instagram_stories: 'traffic',
  facebook: 'traffic', tiktok: 'awareness', linkedin: 'awareness', x: 'traffic',
  pinterest: 'traffic', youtube_shorts: 'awareness', threads: 'awareness', blog: 'conversion',
};
function defaultCta(focus) {
  if (focus.type === 'tb') return 'Shop ' + focus.product.title.split(',')[0];
  return 'Shop ' + focus.product.title.split(',')[0]; // every lane is one-time purchase
}
function fallbackStrategy(ctx, keys) {
  const per = {};
  for (const key of keys) {
    per[key] = {
      objective: DEFAULT_OBJECTIVE[key] || 'awareness',
      cta: defaultCta(ctx.focus),
      link: ctx.focus.product.url,
      note: 'deterministic default (objective map + focus product page)',
    };
  }
  return { per_platform: per };
}
async function strategyAgent(ctx, ideology, hypothesis, keys, timeoutMs) {
  const out = await llmJson({
    tier: 'premium', stage: 'social-strategy', timeoutMs, maxTokens: 1400, temperature: 0.4,
    system: brandPersona(ctx, 'business strategist') + ' Decide the objective (awareness | traffic | conversion), CTA and link target per platform. The ONLY allowed link is the provided product URL (real handle). Reply as strict JSON: {"per_platform":{"<key>":{"objective":"","cta":"","link":""}}} with exactly these keys: ' + keys.join(', ') + '.\n' + brandGates(ctx),
    user: 'Theme: ' + ideology.theme + '\nHypothesis: ' + hypothesis.hypothesis + '\nFocus product: ' + ctx.focus.product.title + ' → ' + ctx.focus.product.url + '\nPurchase mode: ' + ctx.focus.purchase_mode + ' (use only this purchase mode; never introduce subscription language the brand does not offer)',
  });
  const fb = fallbackStrategy(ctx, keys);
  const per = {};
  for (const key of keys) {
    const got = (out.per_platform || {})[key] || {};
    const link = typeof got.link === 'string' && got.link.indexOf('https://knickgasm.com/products/') === 0 ? got.link : fb.per_platform[key].link;
    per[key] = {
      objective: ['awareness', 'traffic', 'conversion'].indexOf(String(got.objective || '').toLowerCase()) >= 0 ? String(got.objective).toLowerCase() : fb.per_platform[key].objective,
      cta: String(got.cta || fb.per_platform[key].cta),
      link,
    };
  }
  return { per_platform: per };
}

// ── Agent 4: Content (premium) — per-platform copy incl. blog ────────────────
const TAG_POOLS = {
  brand: [],
  tb: [],
  coffee: [],
  supplements: [],
};
function tagsFor(key, focus) {
  const spec = PLATFORM_SPECS[key];
  const max = spec.hashtags[1];
  if (!max) return [];
  const pool = TAG_POOLS.brand.concat(TAG_POOLS[focus.type] || TAG_POOLS.tb);
  const extra = key === 'youtube_shorts' ? ['#Shorts'] : [];
  return extra.concat(pool).slice(0, Math.max(spec.hashtags[0], Math.min(max, 8)));
}
function focusLine(focus) {
  if (focus.type === 'coffee') {
    return '[DATA REQUIRED BEFORE LAUNCH: collection description and pricing]';
  }
  if (focus.type === 'supplements') {
    return focus.product.title + ' — the small detail that finishes a pair. See it on the product page.';
  }
  const p = focus.product;
  const price = p.price_gbp ? ('£' + p.price_gbp + (p.compare_at_gbp ? ' (was £' + p.compare_at_gbp + ')' : '')) : '';
  return p.title + (price ? ' - ' + price : '');
}
function fallbackContent(ctx, ideology, strategy, keys) {
  const p = ctx.focus.product;
  const line = focusLine(ctx.focus);
  const opener = 'There is a moment when the right pair stops being footwear and starts being a signature.';
  const hook = ctx.focus.type === 'coffee' ? 'Your 3pm deserved better. So we rebuilt the pair.' : 'The slowest two minutes of your day, done properly.';
  const alt = 'Editorial still life of ' + p.title + " in " + brandName(ctx) + "'s own palette.";
  const posts = {};
  for (const key of keys) {
    const st = strategy.per_platform[key];
    switch (key) {
      case 'instagram_feed':
        posts[key] = { caption: opener + '\n\n' + line + '\n\n' + ideology.narrative + '\n\n' + st.cta + ' — link in bio.', hook: opener, alt_text: alt }; break;
      case 'instagram_reels':
        posts[key] = { caption: hook + ' ' + line + ' ' + st.cta + ' — link in bio.', hook, alt_text: alt }; break;
      case 'instagram_stories':
        posts[key] = { caption: hook + ' Tap through for the ritual → ' + st.cta + '.', hook, alt_text: alt }; break;
      case 'facebook':
        posts[key] = { caption: opener + ' ' + line + ' ' + st.cta + ': ' + st.link, hook: opener, alt_text: alt }; break;
      case 'tiktok':
        posts[key] = { caption: hook + ' ' + (ctx.focus.type === 'tb' ? 'Lacing ' + p.title.split(',')[0] + ' the way the studio taught us.' : line), hook, alt_text: alt }; break;
      case 'linkedin':
        posts[key] = { caption: 'Today from ' + brandName(ctx) + ': ' + p.title + '. ' + line + '\n\n' + st.cta + ': ' + st.link, hook: '', alt_text: alt }; break;
      case 'x':
        posts[key] = { caption: hook + ' ' + p.title.split(',')[0] + ' → ' + st.link, hook, alt_text: alt }; break;
      case 'pinterest':
        posts[key] = { title: (p.title + ' | ' + brandName(ctx)).slice(0, 100), caption: line + ' ' + st.cta + '.', hook: '', alt_text: alt }; break;
      case 'youtube_shorts':
        posts[key] = { title: (hook + ' | ' + brandName(ctx)).slice(0, 100), caption: line + ' ' + st.cta + ': ' + st.link, hook, alt_text: alt }; break;
      case 'threads':
        posts[key] = { caption: hook + ' ' + line, hook, alt_text: alt }; break;
      case 'blog':
        posts[key] = fallbackBlog(ctx, ideology, st); break;
      default:
        posts[key] = { caption: opener + ' ' + line, hook: opener, alt_text: alt };
    }
    if (!posts[key].hashtags) posts[key].hashtags = tagsFor(key, ctx.focus);
  }
  return { posts };
}
function fallbackBlog(ctx, ideology, st) {
  const p = ctx.focus.product;
  const name = p.title.split(',')[0];
  const paras = [
    'Today we want to spend a moment with ' + p.title + ', from ' + brandName(ctx) + '.',
    ideology.narrative,
    '[DATA REQUIRED BEFORE LAUNCH: origin story for ' + brandName(ctx) + ']',
    ctx.focus.type === 'coffee'
      ? '[DATA REQUIRED BEFORE LAUNCH: collection narrative for ' + brandName(ctx) + ']'
      : '[DATA REQUIRED BEFORE LAUNCH: product narrative for ' + brandName(ctx) + ']',
    '## Getting the most from it\n\n[DATA REQUIRED BEFORE LAUNCH: care and usage notes for ' + brandName(ctx) + ']',
    '## Worth keeping\n\n[DATA REQUIRED BEFORE LAUNCH: closing narrative for ' + brandName(ctx) + ']'
  ];
  return {
    title: (ideology.theme + ' — with ' + name).slice(0, 90),
    slug: (name + '-' + ctx.date).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    meta_description: ('The story behind ' + p.title + ' — origin-fresh, one-of-one, and how to build a daily ritual around it.').slice(0, 158),
    body_markdown: '# ' + ideology.theme + '\n\n' + paras.join('\n\n'),
    hashtags: [],
    alt_text: 'Editorial hero image of ' + p.title + " in " + brandName(ctx) + "'s own palette.",
  };
}
async function contentAgent(ctx, ideology, strategy, keys, timeoutMs) {
  const specLines = keys.map((k) => {
    const s = PLATFORM_SPECS[k];
    return k + ': ' + s.platform + '/' + s.format + ', ' + (s.word_range ? (s.word_range[0] + '-' + s.word_range[1] + ' words') : ('max ' + s.char_limit + ' chars')) + ', ' + s.hashtags[0] + '-' + s.hashtags[1] + ' hashtags, tone: ' + s.tone + ', objective: ' + strategy.per_platform[k].objective + ', CTA: ' + strategy.per_platform[k].cta + ', link: ' + strategy.per_platform[k].link;
  }).join('\n');
  const out = await llmJson({
    tier: 'premium', stage: 'social-content', timeoutMs, maxTokens: 6500,
    system: brandPersona(ctx, 'senior content writer') + ' Write today\'s copy for EVERY platform key listed, obeying each platform\'s limits and tone. Reply as strict JSON: {"posts":{"<key>":{"caption":"","hook":"","hashtags":[""],"alt_text":"","title":""}}}. The "blog" key instead needs {"title","slug","meta_description","body_markdown"} where body_markdown is a full 800-1200 word editorial SEO post. Hashtags without the pound sign are invalid.\n' + brandGates(ctx),
    user: 'Date: ' + ctx.date + ' (UK)\nTheme: ' + ideology.theme + '\nNarrative: ' + ideology.narrative + '\nFocus product: ' + ctx.focus.product.title + ' → ' + ctx.focus.product.url + '\nProduct facts you may state: ' + focusLine(ctx.focus) + '\nPlatform specs:\n' + specLines,
  });
  const fb = fallbackContent(ctx, ideology, strategy, keys);
  const posts = {};
  for (const key of keys) {
    const got = (out.posts || {})[key];
    const fbp = fb.posts[key];
    if (!got || typeof got !== 'object') { posts[key] = fbp; continue; }
    if (key === 'blog') {
      posts[key] = {
        title: String(got.title || fbp.title),
        slug: String(got.slug || fbp.slug),
        meta_description: String(got.meta_description || fbp.meta_description),
        body_markdown: String(got.body_markdown || fbp.body_markdown),
        hashtags: [], alt_text: String(got.alt_text || fbp.alt_text),
      };
    } else {
      posts[key] = {
        caption: String(got.caption || fbp.caption),
        hook: String(got.hook || fbp.hook || ''),
        title: got.title ? String(got.title) : (fbp.title || undefined),
        hashtags: Array.isArray(got.hashtags) && got.hashtags.length ? got.hashtags.map(String).filter((h) => /^#/.test(h)).slice(0, PLATFORM_SPECS[key].hashtags[1] || 0) : fbp.hashtags,
        alt_text: String(got.alt_text || fbp.alt_text),
      };
      if (!posts[key].hashtags.length && PLATFORM_SPECS[key].hashtags[0] > 0) posts[key].hashtags = fbp.hashtags;
    }
  }
  return { posts };
}

// ── Agent 5: Design — one hero image reused with per-platform crops ──────────
function heroPrompt(ctx, ideology, focus) {
  // The palette was hardcoded to tenant zero's violet/lava/near-black/chalk, so
  // every brand's generated hero was DIRECTED to be painted in one company's
  // colours. It comes from the active brand's record now, and when a brand has
  // no palette on file the prompt says so rather than borrowing one.
  //
  // (`brandName(ctx)` was also called here with no `ctx` in scope, which threw a
  // ReferenceError that `step()`'s catch-all swallowed into the deterministic
  // fallback - so this prompt never actually reached a model. Hence the param.)
  const pal = (ctx && ctx.brand && ctx.brand.palette) || {};
  const hexes = [pal.primary, pal.accent, pal.ink, pal.surface].filter(Boolean);
  const paletteLine = hexes.length
    ? ' Color palette strictly limited to ' + hexes.join(', ') + '.'
    : ' [DATA REQUIRED BEFORE LAUNCH: brand palette, all, all] - do not choose colours until it is supplied.';
  return 'Premium editorial product photography for ' + brandName(ctx) + '. ' + ideology.visual_direction +
    ' Hero product: ' + focus.product.title + '.' +
    ' Composition with generous negative space so the frame crops cleanly to 4:5 portrait, 9:16 vertical and 2:3 pin.' +
    paletteLine +
    ' NO text, NO logos, NO watermarks, NO faces.';
}
async function designAgent(ctx, ideology, remainingMs) { // eslint-disable-line no-unused-vars
  const prompt = heroPrompt(ctx, ctx.ideologyRef || ideology, ctx.focus);
  const base = { image_prompt: prompt, crops: { '4:5': 'center crop to 1080x1350', '9:16': 'vertical center crop to 1080x1920', '16:9': 'horizontal crop to 1200x675', '1.91:1': 'horizontal crop to 1200x627', '2:3': 'tall crop to 1000x1500' } };
  // HARD RULE (system-wide): product/brand imagery MUST be a REAL Shopify catalog
  // pack-shot, never a diffusion-invented box — image models fabricate garbled
  // fake labels. The real, hosted product photo is already available on the focus
  // product; use it (HD), preferring the catalog gallery, and fall back ONLY to
  // the on-brand SVG placeholder. Diffusion is never used for a product shot.
  let real = null;
  try { real = (catalogImage && catalogImage.imagesFor(ctx.focus.product, ctx.market || 'UK', { width: 1200, brand: ctx.brand })[0]) || null; } catch (_) { real = null; }
  if (!real && ctx.focus.product && ctx.focus.product.image) {
    try { real = (catalogImage && catalogImage.hd(ctx.focus.product.image, 1200)) || ctx.focus.product.image; } catch (_) { real = ctx.focus.product.image; }
  }
  if (real) return { ...base, image_url: real, provider: 'catalog', note: 'real Shopify catalog product photo (no diffusion)' };
  // The image_prompt is retained only as documentation for a human art director;
  // it is NOT sent to any diffusion model for the shippable product hero.
  return { ...base, image_url: placeholderImage(ctx), note: 'no verified catalog image — on-brand placeholder emitted' };
}
function placeholderImage(ctx) {
  if (!brandPlaceholder) return null;
  try { return brandPlaceholder.brandPlaceholderDataUri('1080x1350', ctx.focus.product.title.split(',')[0].toUpperCase()); } catch (_) { return null; }
}

// ── Agent 6: Audio/Video — storyboard + graceful video job ───────────────────
function fallbackStoryboard(ctx, ideology) {
  const name = ctx.focus.product.title.split(',')[0];
  return {
    script: 'Hook (spoken, 1 line): "' + (ctx.focus.type === 'coffee' ? 'Your afternoon pair, rebuilt.' : 'Two minutes. One studio. ' + name + '.') + '" Then ambient sound only — kit, pour, steam — closing on the product and the CTA.',
    storyboard: [
      '0-2s — HOOK: extreme close-up, steam curling off the pair in golden-hour light (9:16, product barely out of focus behind).',
      '2-5s — RITUAL: hands warming the pair / pouring; ' + name + ' pack visible on chalk linen with deep-purple ceramics.',
      '5-8s - REVEAL: product front and centre, brand accent light; end card text: "' + name + ' | ' + brandName(ctx) + '".',
    ],
    audio: 'No voiceover after the hook; natural kit/pour foley, soft room tone. Music: sparse, warm, no percussion.',
    on_screen_text: [ideology.theme, ctx.focus.type === 'tb' ? 'One-time pack. No strings.' : 'Subscribe & save.'],
  };
}
async function videoAgent(ctx, ideology, content, remainingMs) {
  let board = null;
  const budget = Math.min(12000, Math.max(0, remainingMs - 4000));
  if (callLLM && budget >= 5000) {
    try {
      const out = await llmJson({
        tier: 'standard', stage: 'social-video', timeoutMs: budget, maxTokens: 700,
        system: brandPersona(ctx, 'short-form video director') + ' Write an 8-second 9:16 storyboard for TikTok / Reels / Shorts. Reply as strict JSON: {"script":"","storyboard":["shot 1","shot 2","shot 3"],"audio":"","on_screen_text":[""]}.\n' + brandGates(ctx),
        user: 'Theme: ' + ideology.theme + '\nProduct: ' + ctx.focus.product.title + '\nHook to open on: ' + ((content.posts.tiktok && content.posts.tiktok.hook) || ideology.theme),
      });
      if (out && (out.storyboard || out.script)) {
        const fb = fallbackStoryboard(ctx, ideology);
        board = {
          script: String(out.script || fb.script),
          storyboard: Array.isArray(out.storyboard) && out.storyboard.length ? out.storyboard.map(String) : fb.storyboard,
          audio: String(out.audio || fb.audio),
          on_screen_text: Array.isArray(out.on_screen_text) ? out.on_screen_text.map(String) : fb.on_screen_text,
        };
      }
    } catch (_) { board = null; }
  }
  if (!board) board = fallbackStoryboard(ctx, ideology);

  const videoPrompt = 'Cinematic 8s vertical (9:16) product film for ' + brandName(ctx) + '. ' + board.storyboard.join(' ') + ' Palette locked to this brand\'s own tokens. No on-screen text (added in edit), no faces, no logos.';
  let job = null;
  if (ctx.dry_run && video.isConnected()) {
    job = { status: 'skipped_dry_run', note: 'video keys present but dry_run — no render submitted' };
  } else {
    try {
      job = await video.generateVideo({ prompt: videoPrompt, duration_s: 8, aspect: '9:16', tier: 'standard' });
    } catch (e) {
      job = { ok: false, error: String(e.message || e).slice(0, 200) };
    }
  }
  return { storyboard: board, prompt: videoPrompt, job };
}

// ── Agent 7: Compilation (fast) + limits + content validation ────────────────
// Code-level content gate (the brandGates(ctx) rules were prompt-only; the LLM could
// still slip a fabricated price, a raw non-PDP URL, or a medical claim through).
// SAFE auto-fixes: strip any URL in the copy that is not a verified PDP link (the
// CTA link is a separate, guarded field), and strip price tokens from accessory
// copy (the accessories lane is deliberately routed price-free). JUDGMENT calls are FLAGGED,
// not rewritten (auto-rewriting brand copy mangles it): medical / drug-like
// claims are surfaced in _compliance for human review.
const MEDICAL_RX = /\b(clinically proven|cures?|treats? (?:anxiety|insomnia|depression|disease|illness|stress)|reduces? (?:grail-drop|blood pressure|inflammation)|prevents? (?:disease|illness|cancer)|fda[- ]approved|big pharma|guaranteed results)\b/gi;
function sanitizeContent(text, ctx, flags) {
  if (typeof text !== 'string' || !text) return text;
  let t = text.replace(/https?:\/\/\S+/gi, (u) => { if (/\/products\//.test(u)) return u; flags.push('removed non-PDP URL'); return ''; });
  if (ctx && ctx.focus && ctx.focus.type === 'supplements') {
    t = t.replace(/[£$€]\s?\d[\d.,]*/g, () => { flags.push('removed price from accessories copy'); return ''; });
  }
  const med = t.match(MEDICAL_RX);
  if (med) flags.push('medical-claim review: ' + [...new Set(med.map((x) => x.toLowerCase()))].join(', '));
  // Tidy spacing left by removals, per line (preserve blog newlines).
  return t.split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim()).join('\n');
}
function enforceLimits(key, copy, ctx) {
  const spec = PLATFORM_SPECS[key];
  const out = { ...copy };
  const flags = [];
  ['caption', 'hook', 'headline', 'primary_text', 'body_markdown', 'title', 'alt_text'].forEach((f) => {
    if (typeof out[f] === 'string') out[f] = sanitizeContent(out[f], ctx, flags);
  });
  // Budget hashtags INTO the caption char limit (they are appended at post time,
  // so they must not push the published text over the platform cap).
  const tagLen = Array.isArray(out.hashtags) && out.hashtags.length ? (out.hashtags.join(' ').length + 1) : 0;
  if (spec.char_limit && typeof out.caption === 'string' && (out.caption.length + tagLen) > spec.char_limit) {
    out.caption = out.caption.slice(0, Math.max(0, spec.char_limit - tagLen - 1)).replace(/\s+\S*$/, '') + '…';
  }
  if (spec.title_limit && typeof out.title === 'string' && out.title.length > spec.title_limit) {
    out.title = out.title.slice(0, spec.title_limit);
  }
  if (flags.length) out._compliance = [...new Set(flags)];
  return out;
}
function buildPosts(ctx, ideology, strategy, content, hero, av, keys) {
  return keys.map((key) => {
    const spec = PLATFORM_SPECS[key];
    const st = strategy.per_platform[key];
    const copy = enforceLimits(key, content.posts[key] || {}, ctx);
    const media = spec.media === 'video'
      ? {
          type: 'video', aspect: spec.aspect, dims: spec.dims,
          video: { storyboard: av.storyboard, prompt: av.prompt, job: av.job },
          cover: { image_url: hero.image_url || null, image_prompt: hero.image_prompt, crop: hero.crops[spec.aspect] || null },
        }
      : {
          type: 'image', aspect: spec.aspect, dims: spec.dims,
          image_url: hero.image_url || null, image_prompt: hero.image_prompt,
          crop: hero.crops[spec.aspect] || null, provider: hero.provider || null,
        };
    return {
      date: ctx.date, market: MARKET, key,
      platform: spec.platform, format: spec.format,
      theme: ideology.theme,
      objective: st.objective, cta: st.cta, link: st.link,
      copy,
      hashtags: copy.hashtags || [],
      alt_text: copy.alt_text || '',
      media,
      best_time_utc: spec.best_time_utc,
      status: 'draft',
      push_status: 'not_integrated_phase_2',
    };
  });
}
async function compileAgent(ctx, posts, timeoutMs) {
  const fb = {
    day_summary: posts.length + ' draft posts for ' + ctx.date + ' around "' + (posts[0] ? posts[0].theme : '') + '" — hero: ' + ctx.focus.product.title + '.',
    qa_note: 'Deterministic assembly: platform limits enforced, links restricted to the verified product handle, brand scrub applied to every string.',
  };
  if (!callLLM || timeoutMs < 5000) return fb;
  try {
    const out = await llmJson({
      tier: 'fast', stage: 'social-compile', timeoutMs, maxTokens: 300, temperature: 0.3,
      system: 'You are the QA editor closing out a day-package of social posts. Reply as strict JSON: {"day_summary":"","qa_note":""} — one sentence each.',
      user: 'Posts: ' + posts.map((p) => p.key + ' (' + p.objective + ')').join(', ') + '. Theme: ' + (posts[0] ? posts[0].theme : '') + '. Product: ' + ctx.focus.product.title + '.',
    });
    return { day_summary: String(out.day_summary || fb.day_summary), qa_note: String(out.qa_note || fb.qa_note) };
  } catch (_) { return fb; }
}

// ── Persistence (best-effort; graceful without Supabase) ─────────────────────
async function recentThemes(days) {
  if (!supa) return [];
  try {
    const since = new Date(Date.now() - (days || 14) * 86400000).toISOString().slice(0, 10);
    const rows = await supa.select(TABLE, { select: 'date,platform,payload', limit: 150, order: 'date.desc', filters: { date: 'gte.' + since } });
    const seen = new Set();
    for (const r of rows || []) {
      const t = r && r.payload && r.payload.theme;
      if (t) seen.add(String(t));
    }
    return Array.from(seen);
  } catch (_) { return []; }
}
async function persistPosts(posts) {
  if (!supa) return { persisted: false, reason: 'supabase module unavailable' };
  try {
    const rows = posts.map((p) => ({
      date: p.date, platform: p.platform, format: p.format,
      payload: p, media: p.media,
      status: p.status, push_status: p.push_status,
    }));
    const inserted = await supa.insert(TABLE, rows);
    const ids = (Array.isArray(inserted) ? inserted : []).map((r) => r.id);
    posts.forEach((p, i) => { if (ids[i] != null) p.id = ids[i]; });
    return { persisted: true, inserted: ids.length, ids };
  } catch (e) {
    return { persisted: false, reason: String(e.message || e).slice(0, 200) };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function resolveKeys(platforms) {
  if (!Array.isArray(platforms) || !platforms.length) return ALL_KEYS.slice();
  const want = platforms.map((p) => String(p).toLowerCase().trim());
  const keys = ALL_KEYS.filter((k) => want.indexOf(k) >= 0 || want.indexOf(PLATFORM_SPECS[k].platform) >= 0);
  return keys.length ? keys : ALL_KEYS.slice();
}

/**
 * runDaily({ date?, platforms?, dry_run? }) → the day-package.
 * dry_run: no persistence, no image render (prompt placeholder), no video
 * submission when real video keys exist (keyless stubs still returned).
 */
async function runDaily({ date, platforms, dry_run = false, workspaceId = null } = {}) {
  const t0 = Date.now();
  const deadline = t0 + PIPELINE_BUDGET_MS;
  const remaining = () => deadline - Date.now();
  const trace = [];

  const iso = normDate(date);
  const facts = productTypes();
  // The ACTIVE brand travels with the context, so every agent persona, gate
  // and fallback line speaks as that brand rather than tenant zero.
  let __brand = null;
  if (workspaceId) {
    try {
      const wsScope = require('./workspace-scope.js');
      __brand = await wsScope.brandForWorkspace({
        url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
        key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
      }, workspaceId);
    } catch (_) { __brand = null; }
  }
  const ctx = {
    date: iso, dry_run: dry_run === true,
    brand: __brand,
    focus: focusFor(iso, facts),
    festival: festivalFor(iso),
    recentThemes: await recentThemes(14),
  };
  const keys = resolveKeys(platforms);

  // Bounded step runner: one LLM call per agent, deterministic fallback on ANY failure.
  async function step(name, agent, tier, budgetMs, run, fallback) {
    const started = Date.now();
    if (!callLLM || remaining() < 6000) {
      const out = fallback();
      trace.push({ step: name, agent, tier, ok: true, source: callLLM ? 'fallback:time-budget' : 'fallback:no-llm', ms: Date.now() - started });
      return out;
    }
    try {
      const out = await run(Math.min(budgetMs, remaining() - 3000));
      trace.push({ step: name, agent, tier, ok: true, source: 'llm', ms: Date.now() - started });
      return out;
    } catch (e) {
      const out = fallback();
      trace.push({ step: name, agent, tier, ok: true, source: 'fallback:error', error: String(e.message || e).slice(0, 160), ms: Date.now() - started });
      return out;
    }
  }

  // 1. Ideology
  const ideology = await step('1-ideology', 'Ideology agent', 'premium', 16000,
    (ms) => ideologyAgent(ctx, ms), () => fallbackIdeology(ctx));
  trace[trace.length - 1].note = 'theme: ' + ideology.theme;

  // 2. Data & hypothesis
  const hypothesis = await step('2-hypothesis', 'Data & hypothesis agent', 'standard', 12000,
    (ms) => hypothesisAgent(ctx, ideology, ms), () => fallbackHypothesis(ctx));
  trace[trace.length - 1].note = hypothesis.hypothesis.slice(0, 140);

  // 3. Business & strategy
  const strategy = await step('3-strategy', 'Business & strategy agent', 'premium', 16000,
    (ms) => strategyAgent(ctx, ideology, hypothesis, keys, ms), () => fallbackStrategy(ctx, keys));
  trace[trace.length - 1].note = keys.map((k) => k + '→' + strategy.per_platform[k].objective).join(', ').slice(0, 180);

  // 4. Content
  const content = await step('4-content', 'Content agent', 'premium', 35000,
    (ms) => contentAgent(ctx, ideology, strategy, keys, ms), () => fallbackContent(ctx, ideology, strategy, keys));
  trace[trace.length - 1].note = Object.keys(content.posts).length + ' platform copies written (incl. blog)';

  // 5. Design (hero image — NOT an LLM step; time-boxed media call)
  const dStart = Date.now();
  const hero = await designAgent(ctx, ideology, remaining());
  trace.push({ step: '5-design', agent: 'Design agent', tier: 'image-cascade', ok: true, source: hero.image_url && String(hero.image_url).indexOf('data:image/svg') !== 0 ? 'generated' : 'placeholder-prompt', ms: Date.now() - dStart, note: hero.note });

  // 6. Audio/Video (storyboard LLM + graceful video job)
  const vStart = Date.now();
  const av = await videoAgent(ctx, ideology, content, remaining());
  trace.push({ step: '6-video', agent: 'Audio/Video agent', tier: 'standard', ok: true, source: av.job && av.job.not_connected ? 'stub:would_request' : (av.job && av.job.status === 'skipped_dry_run' ? 'skipped:dry_run' : 'submitted-or-error'), ms: Date.now() - vStart, note: 'storyboard ' + av.storyboard.storyboard.length + ' shots; job: ' + ((av.job && (av.job.status || (av.job.not_connected ? 'not_connected' : av.job.error))) || 'n/a') });

  // 7. Compile
  let posts = buildPosts(ctx, ideology, strategy, content, hero, av, keys);
  const summary = await compileAgent(ctx, posts, Math.min(9000, Math.max(0, remaining() - 2000)));
  trace.push({ step: '7-compile', agent: 'Compilation agent', tier: 'fast', ok: true, source: 'assembled', ms: 0, note: summary.day_summary.slice(0, 160) });

  // 8. Sanitize — EVERY string through the brand scrub.
  posts = deepScrub(posts);
  const pkg = deepScrub({
    ok: true, date: iso, market: MARKET, dry_run: ctx.dry_run,
    focus: { type: ctx.focus.type, label: ctx.focus.label, purchase_mode: ctx.focus.purchase_mode, product: ctx.focus.product },
    calendar_moment: ctx.festival ? { name: ctx.festival.name, date: ctx.festival.date, upcoming: !!ctx.festival.upcoming } : null,
    ideology, hypothesis,
    strategy: strategy.per_platform,
    hero: { image_url: hero.image_url || null, image_prompt: hero.image_prompt, provider: hero.provider || null, crops: hero.crops },
    summary,
  });
  pkg.posts = posts;
  trace.push({ step: '8-sanitize', agent: 'Brand scrub', tier: 'deterministic', ok: true, source: 'sanitizeBrand', ms: 0, note: 'all strings scrubbed against the banned-phrase list' });

  // Persist (skipped on dry_run)
  pkg.persistence = ctx.dry_run ? { persisted: false, reason: 'dry_run' } : await persistPosts(posts);
  pkg.push_connections = push.connections();
  pkg.trace = trace;
  pkg.ms = Date.now() - t0;
  return pkg;
}

/** listPosts({ date?, from?, to? }) — graceful without Supabase. */
async function listPosts({ date, from, to } = {}) {
  const connections = push.connections();
  if (!supa) return { ok: true, posts: [], persistence: false, note: 'Supabase not configured — run results are returned inline by social-run-daily only', connections };
  try {
    const filters = {};
    if (date) {
      filters.date = 'eq.' + normDate(date);
    } else if (to) {
      // Range via PostgREST and=() — our tiny client allows one operator per key.
      filters.and = '(date.gte.' + normDate(from || '1970-01-01') + ',date.lte.' + normDate(to) + ')';
    } else {
      filters.date = 'gte.' + normDate(from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
    }
    const rows = await supa.select(TABLE, { select: 'id,date,platform,format,payload,media,status,push_status,created_at', limit: 400, order: 'date.desc,id.asc', filters });
    return { ok: true, posts: rows || [], persistence: true, connections };
  } catch (e) {
    return { ok: true, posts: [], persistence: false, error: String(e.message || e).slice(0, 200), connections };
  }
}

/** setStatus(id, 'approved'|'skipped'|'draft'|'posted') */
async function setStatus(id, status) {
  const allowed = ['draft', 'approved', 'posted', 'skipped'];
  if (allowed.indexOf(status) < 0) return { ok: false, error: 'status must be one of ' + allowed.join('|') };
  if (!id) return { ok: false, error: 'id required' };
  if (!supa) return { ok: false, error: 'Supabase not configured — cannot update post status' };
  try {
    const rows = await supa.update(TABLE, { status }, { id: 'eq.' + id });
    if (!rows || !rows.length) return { ok: false, error: 'post not found' };
    return { ok: true, post: rows[0] };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
}

module.exports = {
  runDaily, listPosts, setStatus,
  PLATFORM_SPECS, ALL_KEYS,
  // exposed for tests
  deepScrub, focusFor, festivalFor, resolveKeys,
};
