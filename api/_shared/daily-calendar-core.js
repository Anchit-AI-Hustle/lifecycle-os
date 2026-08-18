'use strict';

/**
 * daily-calendar-core — the day-level view of the whole operating loop.
 *
 * One row per DAY across past, today and future, each carrying what was planned,
 * which assets actually exist for it, and what was measured. It exists because
 * the loop it reports on had been dead for three weeks and every surface in the
 * app still looked healthy: the plan sync returned ok:true while the database
 * rejected every write, the daily job logged 'success' with seven skipped
 * connectors, and the rolling 90-day window quietly decayed to 58 days.
 *
 * Three rules hold this together.
 *
 * 1. FRESHNESS IS DERIVED, NEVER ASSERTED. Every "is this current?" answer is
 *    computed here from a timestamp compared against today, at read time. No
 *    stored `is_fresh` / `ran_today` flag is ever re-read as a live claim — that
 *    is exactly how ads-snowflake-core came to print "includes the current
 *    partial day" a week after the day in question.
 *
 * 2. AN ASSET COUNTS ONLY IF ITS ARTEFACT EXISTS. A slot is not "built" because
 *    it is approved, or because a marker says so; it is built when a campaign row
 *    is present and that row carries the channel's artefact. A green tick for a
 *    mailer nobody generated is worse than an empty cell.
 *
 * 3. MEASURED AND PLANNED NEVER MERGE. A future day has no measurements and says
 *    so with null, not 0. A past day with no reporting source says which source
 *    is dark. Only stored orders — real rows, already in the warehouse — produce
 *    a revenue figure.
 */

const { smartConfig, SmartBrainDbAdapter } = require('../../lib/smart-brain/services.js');
const sbplan = require('./smart-brain-plan.js');

const DAY_MS = 86400000;

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function isIsoDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/**
 * Age of a timestamp, in whole hours, or null when there is no timestamp.
 * `null` and `0` are different answers here: 0 hours means "it just ran", null
 * means "it has never run", and conflating them is the whole bug class this
 * module exists to prevent.
 */
function ageOf(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 3600000));
}

/**
 * The freshness verdict for one scheduled subsystem, derived every call.
 * `expected_every_hours` is what the schedule promises; anything materially past
 * it is stale, and a subsystem that has never run is `never_run` — not "stale by
 * an infinite amount", which reads as a lapsed healthy thing.
 */
function freshnessOf(lastRunIso, { expectedEveryHours = 24, today = todayIso(), nowMs = Date.now() } = {}) {
  const age = ageOf(lastRunIso, nowMs);
  if (age == null) {
    return { last_run_at: null, age_hours: null, ran_today: false, state: 'never_run', current: false,
      note: 'This has no recorded run at all. Nothing downstream of it can be treated as current.' };
  }
  const ranToday = String(lastRunIso).slice(0, 10) === today;
  // Half a period of slack: a daily job that runs at 18:30 is not stale at 09:00
  // the next morning, but is once it has missed its own slot.
  const stale = age > expectedEveryHours * 1.5;
  return {
    last_run_at: lastRunIso,
    age_hours: age,
    ran_today: ranToday,
    state: stale ? 'stale' : 'current',
    current: !stale,
    note: stale
      ? `Last ran ${age}h ago; this is scheduled roughly every ${expectedEveryHours}h, so it has missed at least one run.`
      : `Last ran ${age}h ago, within its ~${expectedEveryHours}h schedule.`,
  };
}

// ── Asset presence, read from the artefact ──────────────────────────────────

const CHANNELS = ['email', 'meta', 'google', 'tiktok', 'landing_page'];

/**
 * Which channels this campaign genuinely produced. Reads the artefact, not the
 * plan: a slot whose channel list names TikTok but whose campaign carries no
 * TikTok ad is reported as missing TikTok.
 */
function builtChannels(campaign) {
  const out = {};
  for (const c of CHANNELS) out[c] = false;
  const a = (campaign && campaign.assets) || {};
  if (a.email && (a.email.html || a.email.subject)) out.email = true;
  if (Array.isArray(a.landing_pages) && a.landing_pages.some((lp) => lp && (lp.html || lp.url))) out.landing_page = true;
  for (const ad of a.ads || []) {
    const p = String((ad && ad.platform) || '').replace(/_ads?$/, '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(out, p) && (ad.headline || ad.primary_text || ad.creative || ad.body)) out[p] = true;
  }
  return out;
}

function imageCount(campaign) {
  let n = 0;
  const a = (campaign && campaign.assets) || {};
  if (a.email && a.email.creative && a.email.creative.image) n += 1;
  for (const lp of a.landing_pages || []) if (lp && (lp.creative?.image || lp.hero_image)) n += 1;
  for (const ad of a.ads || []) if (ad && (ad.creative?.image || ad.image)) n += 1;
  return n;
}

function videoState(campaign) {
  const ads = ((campaign && campaign.assets) || {}).ads || [];
  const vids = ads.map((ad) => ad && ad.video).filter(Boolean);
  if (!vids.length) return { requested: false, done: 0, processing: 0, failed: 0 };
  return {
    requested: true,
    done: vids.filter((v) => v.status === 'done').length,
    processing: vids.filter((v) => v.status === 'processing').length,
    failed: vids.filter((v) => v.status === 'failed' || v.status === 'not_connected').length,
  };
}

// ── The day-level calendar ──────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} [opts.from]   ISO date, inclusive. Defaults to 30 days back.
 * @param {string} [opts.to]     ISO date, inclusive. Defaults to today + 90.
 * @param {string} [opts.market] 'US' | 'UK' | … — filter, not a fabrication.
 */
async function dayCalendar({ from, to, market = '', config: cfg = {} } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const today = todayIso();
  const horizon = config.calendarDays || 90;

  const start = isIsoDate(from) ? from : addDaysIso(today, -30);
  const end = isIsoDate(to) ? to : addDaysIso(today, horizon - 1);
  if (daysBetween(start, end) < 0) {
    return { ok: false, error: 'from is after to' };
  }
  // Bounded so one request cannot ask for a decade of days.
  const span = Math.min(daysBetween(start, end) + 1, 400);

  if (!db.connected) {
    return {
      ok: true, connected: false, today, window: { from: start, to: end, days: span }, days: [],
      blocker: 'Supabase is not configured for the Smart Brain adapter, so there is no stored plan, no asset history and no measured orders to show. Set SMART_BRAIN_SUPABASE_URL + SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).',
    };
  }

  const t = config.tableNames;
  const [slotRows, campaignRows, orderRows, orderProbe, cronRows, runRows] = await Promise.all([
    // Archived rows are the PAST. syncDaily flips every elapsed slot to
    // 'archived' and getPlan filters those out, which is why no surface in the
    // app could show history even though the rows were sitting in the table.
    // One filter per column: the adapter maps filters onto query params by key,
    // so a second bound on `date` cannot be expressed here. The upper bound is
    // applied below in JS rather than smuggled into a key PostgREST ignores.
    db.select(t.calendarEntries, { filters: { date: `gte.${start}` }, order: 'date.asc', limit: 3000 }).catch(() => []),
    db.select(t.generatedCampaigns, { order: 'updated_at.desc', limit: 1000 }).catch(() => []),
    db.select(t.orders, { filters: { created_at: `gte.${start}T00:00:00Z` }, limit: 20000 }).catch(() => []),
    // Whether the order table REPORTS AT ALL, asked separately from whether it
    // has rows in this window. Without this an empty table and a genuinely
    // quiet fortnight both come back as an empty array, and reporting the
    // second as "0 orders" when it is really the first is the same defect that
    // printed a 0.00% open rate for mail nobody had measured.
    //
    // A whole row, not just an id, because the adapter degrades a FAILED read to
    // [] as well. If the date column the filter above uses does not exist, that
    // query 400s, comes back empty, and every day would report a measured zero
    // sourced from a query that never ran. Seeing a real row lets us check the
    // column is there before believing anything derived from it.
    db.select(t.orders, { limit: 1 }).catch(() => []),
    db.select('cron_runs', { order: 'started_at.desc', limit: 5 }).catch(() => []),
    db.select(t.runs, { order: 'created_at.desc', limit: 25 }).catch(() => []),
  ]);

  // PostgREST cannot take two filters on the same column through the object form
  // used above, so the upper bound is applied here rather than trusted to the query.
  const slots = (slotRows || []).filter((r) => r && r.date >= start && r.date <= end)
    .filter((r) => !market || String(r.market || '').toUpperCase() === String(market).toUpperCase());

  const campaignById = new Map();
  const campaignBySlot = new Map();
  for (const row of campaignRows || []) {
    const c = row && row.payload;
    if (!c) continue;
    campaignById.set(row.id, { row, campaign: c });
    const slotId = c.calendar_entry_id || null;
    if (slotId && !campaignBySlot.has(slotId)) campaignBySlot.set(slotId, { row, campaign: c });
  }

  // The SOURCE reported (it has rows) AND it carries a date we can bucket by.
  // Only then is an empty day a measured zero rather than an unknown.
  const probeRow = (orderProbe || [])[0] || null;
  const orderDateField = probeRow
    ? ['created_at', 'processed_at'].find((k) => probeRow[k] != null) || null
    : null;
  const ordersRead = !!probeRow && !!orderDateField;
  const ordersBlocker = probeRow && !orderDateField
    ? `The order table has rows but none of the date columns this view can bucket by (created_at, processed_at). Orders and revenue are reported as unknown rather than attributed to a day that cannot be read. Columns seen: ${Object.keys(probeRow).slice(0, 12).join(', ')}.`
    : 'No order rows are stored for this window, so orders and revenue are unknown rather than zero. Run the Shopify/warehouse sync.';

  // Measured orders per day. Real stored rows — the one commercial figure this
  // view can state today without any live connector.
  const ordersByDay = new Map();
  for (const o of (ordersRead ? (orderRows || []) : [])) {
    const day = String(o[orderDateField] || '').slice(0, 10);
    if (!isIsoDate(day) || day < start || day > end) continue;
    if (market && String(o.market || '').toUpperCase() !== String(market).toUpperCase()) continue;
    const agg = ordersByDay.get(day) || { orders: 0, revenue: 0 };
    agg.orders += 1;
    agg.revenue += num(o.total ?? o.total_price);
    ordersByDay.set(day, agg);
  }
  // Group slots by day.
  const byDay = new Map();
  for (const r of slots) {
    const list = byDay.get(r.date) || [];
    list.push(r);
    byDay.set(r.date, list);
  }

  const days = [];
  for (let i = 0; i < span; i++) {
    const date = addDaysIso(start, i);
    const bucket = date < today ? 'past' : (date === today ? 'today' : 'future');
    const raw = byDay.get(date) || [];
    const slotOut = raw.map((r) => {
      const payload = r.payload || {};
      const linked = campaignBySlot.get(r.id)
        || (r.generated_campaign_id ? campaignById.get(r.generated_campaign_id) : null)
        || (payload.__prebuilt && payload.__prebuilt.campaign_id ? campaignById.get(payload.__prebuilt.campaign_id) : null)
        || null;
      const campaign = linked ? linked.campaign : null;
      const channels = Array.isArray(payload.channels) ? payload.channels : [];
      const built = campaign ? builtChannels(campaign) : null;
      // "Planned but not built" is the number that matters for readiness, and it
      // is only meaningful against the channels this slot actually planned.
      const missing = built ? channels.filter((c) => built[c] === false) : channels.slice();
      return {
        id: r.id,
        market: r.market,
        cohort: (payload.cohort && payload.cohort.name) || null,
        status: r.status,
        objective: payload.objective || null,
        festival: (payload.festival && payload.festival.name) || null,
        hero: (payload.heroProduct && payload.heroProduct.title) || null,
        confidence: r.confidence ?? null,
        channels,
        campaign_id: linked ? linked.row.id : null,
        campaign_status: linked ? linked.row.status : null,
        assets: built,
        assets_missing: missing,
        assets_ready: !!built && missing.length === 0,
        images: campaign ? imageCount(campaign) : null,
        video: campaign ? videoState(campaign) : null,
        prebuilt_at: (payload.__prebuilt && payload.__prebuilt.at) || null,
        approved_at: r.approved_at || null,
        updated_at: r.updated_at || null,
        landing_url: linked ? `/lp/${linked.row.id}` : null,
      };
    });

    const measuredAgg = ordersByDay.get(date) || null;
    const day = {
      date,
      bucket,
      weekday: new Date(`${date}T00:00:00Z`).toUTCString().slice(0, 3),
      slots: slotOut,
      counts: {
        planned: slotOut.length,
        approved: slotOut.filter((s) => s.status === 'approved' || s.status === 'final').length,
        tentative: slotOut.filter((s) => s.status === 'tentative').length,
        rejected: slotOut.filter((s) => s.status === 'rejected').length,
        archived: slotOut.filter((s) => s.status === 'archived').length,
        assets_ready: slotOut.filter((s) => s.assets_ready).length,
        assets_missing: slotOut.filter((s) => !s.assets_ready).length,
      },
      // Measured, never projected. A future day cannot have orders; a past day
      // with no order feed reports null, not a zero that reads as "we sold
      // nothing that day".
      measured: bucket === 'future' ? null : (ordersRead
        ? { basis: 'stored orders (smart_orders)', orders: measuredAgg ? measuredAgg.orders : 0, revenue: measuredAgg ? Math.round(measuredAgg.revenue * 100) / 100 : 0 }
        : { basis: null, orders: null, revenue: null }),
      blockers: [],
    };
    if (bucket !== 'future' && !ordersRead) day.blockers.push(ordersBlocker);
    if (!slotOut.length && bucket !== 'past') {
      day.blockers.push('No send is planned for this day. Inside the rolling window that means the daily sync did not persist it.');
    }
    days.push(day);
  }

  // ── Derived freshness across the whole loop ───────────────────────────────
  const futureEntries = days.filter((d) => d.bucket !== 'past').flatMap((d) => d.slots.map((s) => ({ date: d.date })));
  const coverage = sbplan.horizonCoverage(futureEntries, today, horizon);

  const runList = runRows || [];
  const kindOf = (r) => ((r && r.payload && r.payload.kind) || '');
  const lastCron = (cronRows || [])[0] || null;
  const lastPlanRun = runList.find((r) => kindOf(r) === 'daily-sync') || null;
  const lastPrebuild = runList.find((r) => kindOf(r) === 'prebuild') || null;
  // The most recent write to any calendar row is the only honest evidence that
  // the plan sync is landing. A run row proves it EXECUTED; a row timestamp
  // proves it PERSISTED, and those came apart for three weeks.
  const lastSlotWrite = slots.map((r) => r.updated_at).filter(Boolean).sort().pop() || null;

  const inWindow = days.filter((d) => d.bucket !== 'past').flatMap((d) => d.slots);
  const prebuildPayload = (lastPrebuild && lastPrebuild.payload) || null;
  const assets = {
    slots_ahead: inWindow.length,
    ready: inWindow.filter((s) => s.assets_ready).length,
    partial: inWindow.filter((s) => s.assets && !s.assets_ready).length,
    none: inWindow.filter((s) => !s.assets).length,
    last_prebuild: prebuildPayload ? {
      at: lastPrebuild.created_at || null,
      built: prebuildPayload.built,
      failed: prebuildPayload.failed,
      remaining: prebuildPayload.remaining,
      errors: prebuildPayload.errors || [],
    } : null,
  };

  const freshness = {
    today,
    timezone: 'UTC',
    // Each block is computed above from a timestamp; none is a stored flag.
    plan_persistence: freshnessOf(lastSlotWrite, { expectedEveryHours: 24, today }),
    plan_run: freshnessOf(lastPlanRun && lastPlanRun.created_at, { expectedEveryHours: 24, today }),
    daily_job: {
      ...freshnessOf(lastCron && (lastCron.finished_at || lastCron.started_at), { expectedEveryHours: 24, today }),
      status: lastCron ? lastCron.status : null,
      steps_ok: lastCron ? lastCron.steps_ok : null,
      steps_failed: lastCron ? lastCron.steps_failed : null,
      summary: lastCron ? lastCron.summary : null,
    },
    coverage,
    assets,
  };

  const blockers = [];
  if (!coverage.complete) {
    blockers.push({
      subsystem: 'plan_sync',
      detail: coverage.note,
      fix: 'POST /api/calendar?action=smart-brain-sync-daily and read its persistence.blockers. If it reports smart_cal_date_market_idx, apply supabase/migrations/20260712090000_multi_cohort_per_day.sql.',
    });
  }
  if (!freshness.plan_persistence.current) {
    blockers.push({
      subsystem: 'plan_sync',
      detail: freshness.plan_persistence.state === 'never_run'
        ? 'No calendar row in this window has ever been written.'
        : `No calendar row has been written for ${freshness.plan_persistence.age_hours}h. The sync may be running and failing to persist — those are different failures and only the row timestamps tell them apart.`,
      fix: 'Check the sync response persistence block, not just its ok flag.',
    });
  }
  if (assets.slots_ahead && assets.ready === 0) {
    // Say WHY from the queue's own last run when there is one, and say that
    // there isn't one when there isn't. Naming a cause we have not observed —
    // "CRON_SECRET is missing" — would send an operator to change a setting
    // that may be correct, which is the failure mode this whole change is about.
    const lp = assets.last_prebuild;
    let detail = `None of the ${assets.slots_ahead} planned sends ahead has a complete asset bundle.`;
    let fix = 'Kick the queue by hand: POST /api/calendar?action=smart-brain-prebuild with Authorization: Bearer $CRON_SECRET, and read its `failed` array.';
    if (!lp) {
      detail += ' The prebuild queue has no recorded run at all, so it is not reaching the build stage — it is either never invoked or rejected before it starts.';
      fix = 'The queue is fire-and-forget and CRON_SECRET-protected, so a rejection at the door is silent. POST /api/calendar?action=smart-brain-prebuild with Authorization: Bearer $CRON_SECRET and read the status code: 401 means the secret the cron self-fires with does not match.';
    } else if (lp.failed && !lp.built) {
      const first = (lp.errors || [])[0];
      detail += ` Its last run built 0 and failed ${lp.failed}${first ? `: ${first.error}` : ''}. A batch where nothing builds stops the chain by design, so the queue then idles.`;
      fix = 'Fix the error above, then re-kick the queue; it resumes from where it stopped (it is idempotent and skips already-built slots).';
    } else if (lp.remaining) {
      detail += ` Its last run built ${lp.built} with ${lp.remaining} still pending, so it is progressing but has not caught up.`;
      fix = 'Let the chain run, or re-kick it to build the next batch immediately.';
    }
    blockers.push({ subsystem: 'asset_prebuild', detail, fix });
  }

  return {
    ok: true,
    connected: true,
    generated_at: new Date().toISOString(),
    today,
    market: market || 'all',
    window: { from: start, to: end, days: span },
    horizon_days: horizon,
    freshness,
    blockers,
    totals: {
      planned: days.reduce((n, d) => n + d.counts.planned, 0),
      approved: days.reduce((n, d) => n + d.counts.approved, 0),
      assets_ready: days.reduce((n, d) => n + d.counts.assets_ready, 0),
      past_days: days.filter((d) => d.bucket === 'past').length,
      future_days: days.filter((d) => d.bucket === 'future').length,
    },
    days,
  };
}

module.exports = { dayCalendar, freshnessOf, ageOf, builtChannels, horizonCoverage: sbplan.horizonCoverage, addDaysIso, todayIso };
