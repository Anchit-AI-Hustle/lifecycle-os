'use strict';

/**
 * Lifecycle calendar planner — cohort-native, deterministic, UK-first.
 *
 * Parallel to (and deliberately NOT touching) calendar-generate.js, which
 * plans by RFM segment. This planner works on ENGAGEMENT cohorts (see
 * lifecycle-cohorts.js) and product-type purchase rules (data/product-types.json):
 *   - T&B is one-time only (never a subscription CTA)
 *   - Coffee + Supplements are subscription-priority
 *
 * Fully deterministic: same input → byte-identical plan. No Math.random —
 * rotation uses the same stableIndex() hash trick as calendar-generate.js,
 * keyed `${date}_${cohort_key}`.
 *
 * Input  { start_date?, days? (default 30, clamp 7-60), cohorts? (default both),
 *          cadence_per_week? (default 2, clamp 1-7), market? (default 'UK') }
 * Output { plan: [row...], meta, persisted, persistence }
 *
 * If Supabase is configured, rows are upserted into lifecycle_calendar_entries
 * — but ONLY where the existing row's status <> 'built' (a built mailer is
 * never clobbered by a re-plan). Without Supabase it degrades gracefully and
 * returns the plan with persisted:false.
 */

const fs = require('fs');
const path = require('path');
const { COHORTS, PLAYS, purchaseModeForProductType } = require('./lifecycle-cohorts.js');
const { buildEntryAnalysis, explainConfidence } = require('./output-reasoning.js');
const catalogImage = require('./catalog-image.js');

// ─── Date + festival helpers (duplicated from calendar-generate.js on purpose:
//     that module stays untouched; these are tiny and stable) ─────────────────

let FESTIVALS = null;
function loadFestivals() {
  if (FESTIVALS) return FESTIVALS;
  try {
    const p = path.join(process.cwd(), 'data', 'festivals.json');
    FESTIVALS = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.error('[lifecycle-calendar] could not load festivals.json:', e.message);
    FESTIVALS = { US: [], UK: [], Global: [] };
  }
  return FESTIVALS;
}

// Only date/name/weight/tags/archetype_hint are read here — the festival file's
// recommended_segments field is RFM-typed and does not apply to these cohorts.
function findFestivalForDate(market, dateStr) {
  const mmdd = dateStr.slice(5);
  const all = loadFestivals();
  const f = (all[market] || []).find((x) => x.date === mmdd) || null;
  if (!f) return null;
  return { date: f.date, name: f.name, weight: f.weight, tags: f.tags || [], archetype_hint: f.archetype_hint || null };
}

function dateAddDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function isoDate(d) {
  return new Date(d).toISOString().slice(0, 10);
}

// Stable string→index hash (same trick as calendar-generate.js) so every pick
// is reproducible between identical runs.
function stableIndex(str, n) {
  if (n <= 1) return 0;
  let h = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

// ─── Product-type facts ──────────────────────────────────────────────────────

let PRODUCT_TYPES = null;
function loadProductTypes() {
  if (PRODUCT_TYPES) return PRODUCT_TYPES;
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'product-types.json'),
    path.join(process.cwd(), 'data', 'product-types.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        PRODUCT_TYPES = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return PRODUCT_TYPES;
      }
    } catch (e) { console.error('[lifecycle-calendar] product-types.json parse failed at', p, e.message); }
  }
  throw new Error('data/product-types.json not found — the lifecycle program cannot plan without locked product facts');
}

// Weighted fair rotation over a cohort's product_mix: at each step pick the
// type with the lowest used/weight ratio (ties resolved by mix declaration
// order). Deterministic, and honours e.g. {tb:3, coffee:2, supplements:1}.
function productTypeSequence(mix, length) {
  const keys = Object.keys(mix);
  const used = {};
  keys.forEach((k) => { used[k] = 0; });
  const seq = [];
  for (let i = 0; i < length; i++) {
    let best = keys[0];
    for (const k of keys) {
      if (used[k] / mix[k] < used[best] / mix[best]) best = k;
    }
    used[best] += 1;
    seq.push(best);
  }
  return seq;
}

// ─── Hero product resolution ─────────────────────────────────────────────────

function heroForSlot({ productType, playKey, seedKey, useCount }) {
  const PT = loadProductTypes();
  const sym = PT.store.currency_symbol;

  if (productType === 'tb') {
    const list = PT.types.tb.products;
    const idx = (stableIndex(seedKey, list.length) + useCount) % list.length;
    const p = list[idx];
    return {
      hero_handle: p.handle,
      hero_product: p.title,
      hero_price: `${sym}${p.price_gbp.toFixed(2)}${p.compare_at_gbp ? ` (was ${sym}${p.compare_at_gbp.toFixed(2)})` : ''}`,
      hero_image: p.image || null,
      handle_verified: true,
    };
  }

  if (productType === 'coffee') {
    const c = PT.types.coffee;
    const packKey = (playKey === 'b2g1_offer') ? 'pack_3' : 'pack_1';
    const pack = c.packs.find((x) => x.key === packKey) || c.packs[0];
    return {
      hero_handle: c.handle,
      hero_product: `${c.label} — ${pack.label}`,
      hero_price: `${sym}${pack.subscription_gbp.toFixed(2)} subscription · ${sym}${pack.one_time_gbp.toFixed(2)} one-time`,
      hero_image: null,
      handle_verified: c.handle_verified === true,
      pack: pack.key,
    };
  }

  // supplements — zero purchase history, NO pricing may ever be stated.
  const list = PT.types.supplements.products;
  const idx = (stableIndex(seedKey, list.length) + useCount) % list.length;
  const p = list[idx];
  return {
    hero_handle: p.handle,
    hero_product: p.title,
    hero_price: null,
    hero_image: null,
    handle_verified: p.handle_verified === true,
  };
}

// ─── Subject hints (deterministic, brand-safe) ───────────────────────────────

function buildSubjectHint({ playKey, hero, festival, cohortKey }) {
  const name = hero.hero_product || '';
  if (festival) return `${festival.name} · a quieter kind of ritual`;
  const map = {
    brand_story_intro: 'There is a moment the right pair makes — an introduction',
    winback_warm: `Your box is still here · ${name}`,
    gifts_unboxing_education: 'Seven gifts, one box — what actually arrives',
    subscription_value_math: 'The quiet arithmetic of a better morning',
    b2g1_offer: 'Two packs in, the third is on us',
    cross_grade_launch_news: 'From the sneaker people you know: something new',
    new_launch_announcement: `Just launched · ${name}`,
    occasion_bundle: 'A season worth setting the table for',
  };
  let hint = map[playKey] || `On the table today: ${name}`;
  if (cohortKey === 'non_buyers_non_engagers' && playKey === 'brand_story_intro') {
    hint = 'Meet the pair we have been crafting for you';
  }
  return hint;
}

function buildRationale({ cohort, play, productType, purchaseMode, festival, hero }) {
  const parts = [];
  parts.push(`${cohort.label}: ${cohort.objective.split('.')[0]}.`);
  parts.push(`Play "${play.name}" — ${play.when_to_use.split(' — ')[0].split('.')[0]}.`);
  parts.push(
    purchaseMode === 'one_time_only'
      ? `Product type ${productType} is strictly one-time purchase — no subscription language.`
      : `Product type ${productType} is subscription-priority — subscribe is the primary CTA.`
  );
  if (festival) parts.push(`Timed to ${festival.name} (weight ${festival.weight}/10).`);
  parts.push(`Hero: ${hero.hero_product}${hero.handle_verified ? '' : ' (handle unverified — check before send)'}.`);
  return parts.join(' ');
}

// ─── Play selection ──────────────────────────────────────────────────────────

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function pickPlay({ cohortKey, productType, dateStr, lastUsedByPlay, isFirstSend }) {
  const order = Object.keys(PLAYS);
  const festivalToday = findFestivalForDate('UK', dateStr);

  const eligible = (k) => {
    const p = PLAYS[k];
    if (!p.applicable_product_types.includes(productType)) return false;
    // relationship-history plays only make sense for people who already bought T&B:
    // a win-back or cross-grade narrative would ring false to a never-buyer.
    if ((k === 'cross_grade_launch_news' || k === 'winback_warm') && cohortKey !== 'tb_buyers_non_engagers') return false;
    // the occasion play needs an actual occasion on the calendar
    if (k === 'occasion_bundle' && !festivalToday) return false;
    const last = lastUsedByPlay[k];
    if (last && daysBetween(last, dateStr) < p.min_gap_days) return false;
    return true;
  };

  // 1. First touch = relationship before offer: story intro for cold Cohort A,
  //    warm win-back for lapsed T&B buyers.
  if (isFirstSend) {
    const intro = cohortKey === 'tb_buyers_non_engagers' && productType === 'tb'
      ? 'winback_warm'
      : 'brand_story_intro';
    if (eligible(intro)) return PLAYS[intro];
  }

  // 2. Festival on the exact date → occasion play when it fits the product type.
  if (festivalToday && eligible('occasion_bundle')) return PLAYS.occasion_bundle;

  // 3. Deterministic rotation: never-used plays first, then least-recently-used;
  //    ties broken with the stableIndex hash keyed `${date}_${cohort_key}`.
  const candidates = order.filter(eligible);
  if (!candidates.length) {
    // every eligible play is inside its min_gap — relax the gap rather than skip
    // the send (all other fit rules — cohort history, festival — still apply)
    const relaxed = order.filter((k) => PLAYS[k].applicable_product_types.includes(productType)
      && !((k === 'cross_grade_launch_news' || k === 'winback_warm') && cohortKey !== 'tb_buyers_non_engagers')
      && !(k === 'occasion_bundle' && !festivalToday));
    if (!relaxed.length) return null;
    return PLAYS[relaxed[stableIndex(`${dateStr}_${cohortKey}`, relaxed.length)]];
  }
  const neverUsed = candidates.filter((k) => !lastUsedByPlay[k]);
  if (neverUsed.length) return PLAYS[neverUsed[stableIndex(`${dateStr}_${cohortKey}`, neverUsed.length)]];
  const lru = candidates.slice().sort((a, b) => String(lastUsedByPlay[a]).localeCompare(String(lastUsedByPlay[b])));
  const oldest = lastUsedByPlay[lru[0]];
  const tied = lru.filter((k) => lastUsedByPlay[k] === oldest);
  return PLAYS[tied[stableIndex(`${dateStr}_${cohortKey}`, tied.length)]];
}

// ─── Main generator ──────────────────────────────────────────────────────────

async function generateLifecycleCalendar(input = {}) {
  const startDate = input.start_date ? new Date(input.start_date) : new Date();
  if (isNaN(startDate.getTime())) throw new Error(`invalid start_date: ${input.start_date}`);
  const days = Math.min(60, Math.max(7, +input.days || 30));
  const cadence = Math.min(7, Math.max(1, +input.cadence_per_week || 2));
  const market = String(input.market || 'UK').toUpperCase();
  const requested = Array.isArray(input.cohorts) && input.cohorts.length ? input.cohorts : Object.keys(COHORTS);
  const cohortKeys = requested.filter((k) => COHORTS[k]);
  if (!cohortKeys.length) throw new Error(`no valid cohorts — use ${Object.keys(COHORTS).join(', ')}`);

  const startStr = isoDate(startDate);
  const plan = [];

  for (const cohortKey of cohortKeys) {
    const cohort = COHORTS[cohortKey];

    // Evenly-spaced send offsets: cadence sends per 7 days, deterministic.
    const interval = 7 / cadence;
    const offsets = [];
    for (let k = 0; ; k++) {
      const off = Math.round(k * interval);
      if (off >= days) break;
      if (!offsets.includes(off)) offsets.push(off);
    }

    const typeSeq = productTypeSequence(cohort.product_mix, offsets.length);
    const lastUsedByPlay = {};
    const heroUseCount = { tb: 0, coffee: 0, supplements: 0 };

    for (let i = 0; i < offsets.length; i++) {
      const dateStr = isoDate(dateAddDays(startStr, offsets[i]));
      const seedKey = `${dateStr}_${cohortKey}`;

      let productType = typeSeq[i];
      const festival = findFestivalForDate(market, dateStr);
      // A festival slot reads better on sneaker/coffee than on a supplement launch.
      if (festival && productType === 'supplements' && festival.weight >= 5) productType = 'tb';

      const play = pickPlay({ cohortKey, productType, dateStr, lastUsedByPlay, isFirstSend: i === 0 });
      if (!play) continue;
      lastUsedByPlay[play.key] = dateStr;

      const purchaseMode = purchaseModeForProductType(productType);
      const hero = heroForSlot({ productType, playKey: play.key, seedKey, useCount: heroUseCount[productType] });
      heroUseCount[productType] += 1;

      // Explainable confidence + complete analysis for this cohort-native slot.
      const conf = explainConfidence([
        { when: (i === 0), label: 'Cohort entry / first send', delta: 0.10, detail: 'Opening send of the cohort sequence, highest attention.' },
        { when: (festival && festival.weight >= 5), label: 'Festival window', delta: 0.08, detail: festival ? `Timed to ${festival.name} (weight ${festival.weight}/10).` : '' },
        { when: (hero.handle_verified === true), label: 'Verified hero product handle', delta: 0.08, detail: 'Product link is verified against the live catalog.' },
        { when: (purchaseMode !== 'one_time_only'), label: 'Subscription-priority product', delta: 0.06, detail: 'Subscribe CTA raises repeat-revenue potential.' },
      ]);
      const analysisObj = buildEntryAnalysis({
        cohort: { name: cohort.label },
        product: { title: hero.hero_product, category: productType },
        festival: festival ? { name: festival.name, weight: festival.weight, tags: festival.tags || [] } : null,
        channels: ['email'],
        objective: play.name,
        market,
        confidence: conf,
        dataSource: 'lifecycle-cohorts',
      });
      // Layer in the play mechanic + purchase-mode rule as explicit drivers.
      analysisObj.drivers.push({ signal: 'Lifecycle play', value: play.name, implication: String(play.when_to_use || '').split(' — ')[0].split('.')[0] + '.' });
      analysisObj.drivers.push({ signal: 'Purchase mode', value: purchaseMode, implication: purchaseMode === 'one_time_only' ? `${productType} is strictly one-time — no subscription language.` : `${productType} is subscription-priority — subscribe is the primary CTA.` });
      if (hero.handle_verified !== true) analysisObj.drivers.push({ signal: 'Data caveat', value: 'Hero handle unverified', implication: 'Verify the product link against the live catalog before send.' });

      plan.push({
        id: `lc_${dateStr}_${cohortKey}_${market}`,
        date: dateStr,
        send_hour_utc: 9,
        market,
        cohort_key: cohortKey,
        cohort_label: cohort.label,
        play_key: play.key,
        play_name: play.name,
        template_style: play.template_style,
        product_type: productType,
        purchase_mode: purchaseMode,
        hero_handle: hero.hero_handle,
        hero_product: hero.hero_product,
        hero_price: hero.hero_price,
        hero_image: hero.hero_image || catalogImage.imageFor(hero.hero_handle, market) || null,
        handle_verified: hero.handle_verified === true,
        subject_hint: buildSubjectHint({ playKey: play.key, hero, festival, cohortKey }),
        festival: festival ? festival.name : null,
        festival_weight: festival ? festival.weight : null,
        festival_tags: festival ? festival.tags : [],
        rationale: buildRationale({ cohort, play, productType, purchaseMode, festival, hero }),
        confidence: conf.score,
        analysis: analysisObj,
        status: 'planned',
      });
    }
  }

  plan.sort((a, b) => (a.date + a.cohort_key).localeCompare(b.date + b.cohort_key));

  const dist = (field) => plan.reduce((m, r) => { m[r[field]] = (m[r[field]] || 0) + 1; return m; }, {});
  const meta = {
    by_cohort: dist('cohort_key'),
    play_distribution: dist('play_key'),
    product_type_distribution: dist('product_type'),
    purchase_mode_distribution: dist('purchase_mode'),
  };

  const persistence = await persistPlan(plan);

  return {
    generated_at: new Date().toISOString(),
    start_date: startStr,
    days,
    market,
    cohorts: cohortKeys,
    cadence_per_week: cadence,
    total_sends_planned: plan.length,
    plan,
    meta,
    persisted: persistence.persisted,
    persistence,
  };
}

// ─── Persistence (guarded upsert — never clobbers built mailers) ─────────────

function supaIfConfigured() {
  try {
    const supa = require('./supa.js');
    supa.env(); // throws when SUPABASE_URL / key are missing
    return supa;
  } catch (_) { return null; }
}

async function persistPlan(plan) {
  const supa = supaIfConfigured();
  if (!supa) return { persisted: false, reason: 'supabase_not_configured' };
  if (!plan.length) return { persisted: false, reason: 'empty_plan' };
  try {
    const ids = plan.map((r) => r.id);
    const inList = `in.(${ids.map((i) => `"${i}"`).join(',')})`;
    const existing = await supa.select('lifecycle_calendar_entries', {
      select: 'id,status',
      filters: { id: inList, status: 'eq.built' },
    });
    const builtIds = new Set((existing || []).map((r) => r.id));
    const now = new Date().toISOString();
    const rows = plan
      .filter((r) => !builtIds.has(r.id))
      .map((r) => ({
        id: r.id,
        date: r.date,
        market: r.market,
        cohort_key: r.cohort_key,
        status: 'planned',
        payload: r,
        updated_at: now,
      }));
    if (rows.length) await supa.insert('lifecycle_calendar_entries', rows, { upsertOn: 'id' });
    return { persisted: true, upserted: rows.length, skipped_built: builtIds.size };
  } catch (e) {
    console.warn('[lifecycle-calendar] persistence failed (plan still returned):', e.message);
    return { persisted: false, reason: e.message };
  }
}

// ─── List (for the UI) ───────────────────────────────────────────────────────

async function listEntries({ market = 'UK', from = null, to = null } = {}) {
  const supa = supaIfConfigured();
  if (!supa) return { ok: true, connected: false, entries: [], note: 'Supabase not configured — plans are ephemeral until env vars are set.' };
  try {
    const filters = { market: `eq.${String(market).toUpperCase()}` };
    if (from && to) filters.and = `(date.gte.${from},date.lte.${to})`;
    else if (from) filters.date = `gte.${from}`;
    else if (to) filters.date = `lte.${to}`;
    const entries = await supa.select('lifecycle_calendar_entries', {
      select: 'id,date,market,cohort_key,status,payload,generated_by,updated_at',
      order: 'date.asc',
      filters,
      limit: 500,
    });
    return { ok: true, connected: true, entries: entries || [] };
  } catch (e) {
    return { ok: false, connected: true, entries: [], error: e.message };
  }
}

module.exports = {
  generateLifecycleCalendar,
  listEntries,
  // exposed for smoke tests
  stableIndex,
  loadProductTypes,
  productTypeSequence,
  findFestivalForDate,
};
