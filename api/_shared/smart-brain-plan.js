'use strict';

/**
 * Smart Brain persistent rolling plan.
 *
 * runDailySmartBrain() in lib/smart-brain/services.js is a pure function — it
 * regenerates a plan from scratch on every call. This module adds the missing
 * lifecycle around it:
 *
 *   syncDaily()    — the DAILY REVIEW loop. Re-runs analysis on the latest
 *                    data, then diff-updates the stored tentative plan in
 *                    smart_calendar_entries (kept rolling N days ahead) while
 *                    never touching human-approved/final entries.
 *   getPlan()      — current stored plan (or a stateless preview when no DB).
 *   approveEntry() — human sign-off: locks the entry, generates the full
 *                    campaign (mailer + Meta/Google/TikTok ads + landing page)
 *                    with LLM-written copy, persists to smart_generated_campaigns
 *                    and mirrors into ads_generated / landing_pages_generated so
 *                    the Ads + Landing Pages dashboards pick them up.
 *   rejectEntry()  — records feedback; the next daily sync regenerates the slot.
 *   landingPageHtml() — resolves stored LP HTML so /lp/:id can serve it.
 */

const {
  smartConfig, SmartBrainDbAdapter, KnowledgeBaseService, AnalysisService,
  CompetitorBenchmarkingService, CalendarIntelligenceService, GenerationService,
} = require('../../lib/smart-brain/services.js');
const crypto = require('crypto');
const callLLM = require('./llm.js');
const { parseJSON } = require('./llm.js');
// Shared-source-of-truth engine (spec §24b). Optional — never let a sync
// hiccup break generation/approval; every call is best-effort.
let sync = null; try { sync = require('./sync-core.js'); } catch (_) { sync = null; }
let facts = null; try { facts = require('./brand-facts.js'); } catch (_) { facts = null; }
// The brand's OWN testimonials, read verbatim off its OWN site (never written by
// a model) with their images re-hosted in Supabase Storage. This is what fills
// the proof slot the fabricated rating / review-count / reviewer-name seed
// used to fill. Optional require: with the module absent, proof is simply empty
// and every renderer prints the [DATA REQUIRED BEFORE LAUNCH] marker instead.
let brandReviews = null; try { brandReviews = require('./brand-reviews.js'); } catch (_) { brandReviews = null; }

// The canonical source-version map a generated campaign was built from. Facts
// (rating/review/claim) come from the approved-facts library (brand-facts) for
// the campaign's SKU+region — the genuinely canonical, drift-prone B1 data;
// price/offer/image are versioned from the campaign's own snapshot so a later
// canonical change is detectable. Missing facts module → those keys are absent
// (preLaunchGate reports UNAVAILABLE, never a fabricated "fresh").
function syncSourcesFor(campaign) {
  if (!sync) return {};
  const c = campaign || {};
  const email = (c.assets && c.assets.email) || {};
  const sku = (c.heroProduct && (c.heroProduct.sku || c.heroProduct.handle)) || c.hero_sku || null;
  const region = c.market || 'US';
  const out = {
    product: { version: sku || c.name || null },
    region: { version: region },
    price: { version: (c.offer && c.offer.price) || email.price || null },
    offer: { version: c.offer ? `${c.offer.code || ''}:${c.offer.pct || 0}` : null },
    image: { version: (email.creative && email.creative.image) || null },
    url: { version: (c.assets && c.assets.landing_pages && c.assets.landing_pages[0] && c.assets.landing_pages[0].path) || null },
  };
  if (facts && sku) {
    out.rating = { version: String(facts.approvedRating(sku, region)) };
    out.review = { version: sync.stableHash(facts.approvedReviews(sku, region)) };
    out.claim = { version: sync.stableHash(facts.approvedClaims(sku, region)) };
  }
  return out;
}

// Stamp the campaign with freshness metadata + persist a sync_state row and an
// audit entry. Runs on every prebuild/approve persist. Never throws.
async function stampAndRecordSync(db, config, campaign, { actor = 'system', reason = '' } = {}) {
  if (!sync || !campaign) return;
  try {
    const sources = syncSourcesFor(campaign);
    sync.stamp(campaign, { sources, campaignVersion: campaign.campaign_id, status: sync.STATUS.CURRENT });
    await sync.writeState({
      record_type: 'campaign', record_id: campaign.campaign_id,
      version: campaign.campaign_id, source_version: (campaign._sync && campaign._sync.source_version) || {},
      status: sync.STATUS.CURRENT,
    }, { db, config });
    await sync.audit({
      record_type: 'campaign', record_id: campaign.campaign_id, new_value: campaign.campaign_id,
      source: 'smart-brain', initiated_by: 'campaign.updated', actor, reason: reason || 'campaign persisted',
      regeneration_result: 'built', validation_result: 'stamped',
    }, { db, config });
  } catch (_) { /* sync is additive; never block persistence */ }
}

// Pre-launch synchronization gate: is this (already-built) campaign still fresh
// vs the CURRENT canonical facts? Compares the stamped source versions to a
// freshly-computed set. Returns the gate result; never throws.
function preLaunchSyncCheck(campaign) {
  if (!sync || !campaign || !campaign._sync) return { ok: true, status: 'UNSTAMPED', blockers: [], stale: [] };
  try { return sync.preLaunchGateSync(campaign, syncSourcesFor(campaign)); } catch (_) { return { ok: true, status: 'ERROR', blockers: [], stale: [] }; }
}

// Freshness snapshot for the sync-status endpoint: recent generated campaigns
// with their stored sync status + a re-check against current facts.
async function syncStatus({ config: cfg = {}, limit = 60 } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return { ok: true, connected: false, note: 'Supabase not configured; freshness runs in-memory only.', rows: [] };
  const camps = (await db.select(config.tableNames.generatedCampaigns, { order: 'updated_at.desc', limit }).catch(() => [])) || [];
  const rows = camps.map((r) => {
    const c = r.payload || {};
    const chk = preLaunchSyncCheck(c);
    return { campaign_id: r.id, status: r.status, market: c.market || null, synced_at: (c._sync && c._sync.synced_at) || null, freshness: (c._sync && c._sync.status) || 'UNSTAMPED', stale_deps: chk.stale || [], launch_ok: chk.ok };
  });
  return { ok: true, connected: true, count: rows.length, stale: rows.filter((r) => !r.launch_ok).length, rows };
}

// Premium-first with automatic downgrade. The premium cascade only tries the
// paid providers' forward model IDs (gpt-5.5, gemini-3.1-pro, grok-4.3, ...); if
// none is entitled/resolvable on the configured keys, callLLM throws and copy
// falls back to the generic template ("Copy by template-fallback"). Retrying at
// standard then fast tiers reaches smaller real models (incl. the free tiers),
// so generation succeeds whenever ANY provider/model works. Honours "premium
// first" while never dropping the whole mailer to template on a premium miss.
/**
 * Tiered LLM call. The STARTING tier is chosen by model-router from two
 * signals - how apt the job is for a bigger model, and how much credit the
 * workspace has left - instead of every caller hardcoding 'premium'. The
 * existing quality->cheaper demotion still runs underneath, so a provider
 * failure degrades exactly as before.
 *
 * opts.stage names the job (used for aptness); opts.workspaceId + opts.feature
 * enable the budget cap. With neither supplied the behaviour is unchanged.
 */
async function callLLMTiered(opts) {
  let wanted = (opts && opts.tier) || 'premium';
  let routeNote = '';
  try {
    const mr = require('./model-router.js');
    const env = {
      url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
    };
    const decision = await mr.route({
      stage: (opts && (opts.stage || opts.feature)) || '',
      featureKey: opts && opts.feature,
      workspaceId: opts && opts.workspaceId,
      env,
      requested: opts && opts.tier,
    });
    if (decision && decision.allowed && decision.tier) { wanted = decision.tier; routeNote = decision.reason; }
    else if (decision && !decision.allowed) {
      const err = new Error(decision.reason);
      err.code = 'insufficient_credits';
      throw err;
    }
  } catch (e) {
    if (e && e.code === 'insufficient_credits') throw e;   // a real decision, not a routing failure
    /* any other routing problem: fall back to the caller's tier */
  }
  if (routeNote) { try { console.log(`[model-router] ${(opts && (opts.stage || opts.feature)) || 'llm'} -> ${wanted} (${routeNote})`); } catch (_) {} }
  const tiers = [...new Set([wanted, 'standard', 'fast'])];
  let lastErr;
  for (const tier of tiers) {
    try { return await callLLM({ ...opts, tier }); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}
const { buildMasterPrompt, promptsFor, regionFacts } = require('./master-prompt.js');
// What this brand's own audience already responded to. It was computed by the
// planner and stamped on the slot, and never reached the writer.
const creativeEvidence = require('./creative-evidence.js');
const SM = require('./scenario-model.js');
const OfferingCampaign = require('./offering-campaign.js');
const { buildEntryAnalysis } = require('./output-reasoning.js');
// Guaranteed-online fallback: a real catalog product photo (Shopify CDN) so a
// creative never ships an unrenderable data: URI when generation/upload fails.
// Scoped to the slot's OWN workspace by brand-catalog-server: the shipped
// catalogue belongs to tenant zero, so no other brand's mailer may resolve a
// hero image out of it.
const catalogImage = require('./catalog-image.js');
const catalogServer = require('./brand-catalog-server.js');
let reviewRecovery = null;
try { reviewRecovery = require('./review-recovery.js'); } catch (_) { reviewRecovery = null; }
// Shared mailer renderer, the SAME one the Mailer Studio / Mailer Calendar use,
// so Smart Brain mailers come out as the same two named types (2 Text + 2 Text
// + Visual) at the same quality. Guarded: falls back to the local single mailer.
let renderTextVariant = null;
try { renderTextVariant = require('./calendar-trigger.js').helpers.renderTextVariant; } catch (_) { renderTextVariant = null; }
// Copywriting framework library — the SAME one the Mailer Calendar uses. Two
// diverging frameworks (A + B) drive two genuinely DIFFERENT copy directions per
// slot, so the four mailer variants, the A/B ads and the A/B landing pages read
// distinctly instead of being one copy in two skins. Unifies the variant styles
// across Smart Brain, Mailer Calendar and Plan Calendar.
const CF = require('./copy-frameworks.js');

function todayIso() { return new Date().toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }
function addDaysIso(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysAgoIso(n) { return new Date(Date.now() - n * 86400000).toISOString(); }
// Stable per (date, market, cohort) so multiple cohort sends can share a day
// without colliding, and a given date always resolves to the same ids across
// syncs. cohortSlug keeps the id filesystem/URL-safe.
function cohortSlug(name) { return String(name || 'core').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 32) || 'core'; }
/**
 * `smart_calendar_entries.id` is the PRIMARY KEY, and this id is derived purely
 * from date + market + cohort - which every brand on the platform shares. Two
 * workspaces planning 2026-09-01 / US / Nurture therefore produced the SAME
 * primary key, so whichever synced second lost its slot to an
 * ignore-duplicates upsert and its calendar came back empty, while its
 * conditional UPDATEs landed on the other brand's row.
 *
 * `ns` is a per-workspace namespace appended to the id. It is EMPTY for tenant
 * zero, deliberately: every historical row was backfilled to the oldest
 * workspace, and generated landing pages are served at /lp/<campaign_id>, which
 * is this id. Renaming those would break live URLs to fix a collision they
 * cannot have. Every other workspace gets its own id space from its first sync.
 */
function stableId(date, market, cohort, ns) { return `cal_${date}_${String(market).toLowerCase()}_${cohortSlug(cohort)}${ns || ''}`; }
/** The id namespace for a workspace: empty for tenant zero, stable elsewhere. */
function workspaceNs(workspaceId, isZero) {
  if (isZero || !workspaceId) return '';
  return `_w${crypto.createHash('sha1').update(String(workspaceId)).digest('hex').slice(0, 8)}`;
}

// How long telemetry/log rows are kept before the daily sync evicts them.
const RETENTION_DAYS = 30;
// Calendar statuses that a daily sync is allowed to overwrite. An entry that a
// human flipped to approved/final between our read and our write is NOT in this
// set, so the conditional UPDATE matches zero rows and the human decision wins.
const SYNC_WRITABLE_STATUSES = 'in.(tentative,rejected)';

// ── Analysis context (shared by sync + preview) ─────────────────────────────

// ── Tenant-zero guard for on-the-fly planning ───────────────────────────────
// buildContext/freshEntries read the SHIPPED catalogue, analytics and moments,
// which describe tenant zero only. A plan generated from them must therefore
// never be produced for any other workspace - with a brand name relabelled on
// top it reads as that brand's own plan ("The Economic Times Sneaker
// Assortment"). Fail CLOSED: if the workspace cannot be confirmed as tenant
// zero, no fallback plan is generated.
async function planningBrand(config, db) {
  const wsId = (config && config.workspace_id) || (db && db.workspaceId) || null;
  if (!wsId) return { isZero: true, brand: null }; // userless (cron) default = tenant zero
  try {
    const wsScope = require('./workspace-scope.js');
    const env = {
      url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
    };
    if (!env.url || !env.key) return { isZero: false, brand: null };
    const brand = await wsScope.brandForWorkspace(env, wsId);
    const isZero = !!brand && /^knickgasm$/i.test(String(brand.slug || brand.name || ''));
    return { isZero, brand };
  } catch (_) { return { isZero: false, brand: null }; }
}

const EMPTY_PLAN_NOTE = '[DATA REQUIRED BEFORE LAUNCH: catalogue and analytics, this workspace, all] '
  + 'The plan generates only from this brand\'s own offerings and data; nothing is borrowed from another brand. '
  + 'Connect the brand\'s catalogue in brand setup, then run Daily Sync.';

// ── Brand-true planning for non-tenant-zero workspaces ─────────────────────
// The plan for any other workspace is built from THAT brand's OWN offerings
// (its record, else its matching preset on disk), its OWN regions as the
// market list (a brand sold only in India plans only IN slots), and the
// offering-campaign machinery for kind-correct mechanics (event ramps,
// Register/Subscribe/Start-reading CTAs, never promoting a past event).
// Only the NUMBERS are demo: deterministic per brand+slot, and every reach or
// feasibility figure that would need real analytics stays DATA REQUIRED.
function _resolveBrandOfferings(brand) {
  const fs = require('fs');
  const path = require('path');
  const KINDS = require('./offering-kinds.js');
  const own = (brand && brand.brand_data && Array.isArray(brand.brand_data.offerings) && brand.brand_data.offerings.length)
    ? brand.brand_data.offerings
    : (brand && Array.isArray(brand.offerings) && brand.offerings.length) ? brand.offerings : null;
  let raw = own;
  if (!raw) {
    try {
      const dir = path.join(process.cwd(), 'data', 'brands', 'presets');
      const host = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
      // Stopwords excluded: "The Times of India" and "The Economic Times"
      // share {the, times}, which is NOT a match. Exact identity (host, slug,
      // full name) is checked across ALL presets before any fuzzy pass.
      const STOP = { the: 1, and: 1, for: 1, india: 0 };
      const toks = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP[t]);
      const presets = [];
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json') || f === 'index.json') continue;
        try { presets.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (_) {}
      }
      const bs = String(brand.slug || '').toLowerCase();
      const bn = String(brand.name || '').trim().toLowerCase();
      const exact = presets.find((p) =>
        (host(brand.website) && host(brand.website) === host(p.website)) ||
        (bs && String(p.slug || '').toLowerCase() === bs) ||
        (bn && String(p.name || '').trim().toLowerCase() === bn));
      const prefix = exact || presets.find((p) => {
        const ps = String(p.slug || '').toLowerCase();
        return bs && ps && (bs.indexOf(ps) === 0 || ps.indexOf(bs) === 0);
      });
      const fuzzy = prefix || presets.find((p) => {
        const bt = toks(brand.name), pt = toks(p.name);
        return bt.filter((t) => pt.indexOf(t) >= 0).length >= 2;
      });
      if (fuzzy && Array.isArray(fuzzy.offerings) && fuzzy.offerings.length) raw = fuzzy.offerings;
    } catch (_) { /* no preset dir - fall through */ }
  }
  if (!raw) return [];
  return raw.map((o) => KINDS.normalizeOffering(o)).filter(Boolean);
}

function _mulberry32(seedStr) {
  let h = 1779033703 ^ String(seedStr).length;
  for (let i = 0; i < String(seedStr).length; i++) { h = Math.imul(h ^ String(seedStr).charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function offeringPlanEntries(brand, offerings, startDate, days, ns) {
  const oc = require('./offering-campaign.js');
  const regions = (Array.isArray(brand.regions) && brand.regions.length) ? brand.regions : [];
  const markets = regions.map((r) => String(r.code || '').toUpperCase()).filter(Boolean);
  if (!markets.length || !offerings.length) return [];
  const rnd = _mulberry32(String(brand.slug || brand.name || 'brand'));
  const cohorts = ['Nurture', 'Engaged', 'At Risk', 'Winback'];
  const entries = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(startDate, i);
    for (const market of markets) {
      // Pick the offering for this slot.
      //  - A date-bound offering takes the slot only while its window is
      //    genuinely CLOSING (inside RAMP_DAYS). A save-the-date repeated for
      //    ten months is not a campaign, it is spam.
      //  - Otherwise rotate across every offering so a brand's whole catalogue
      //    gets covered instead of one item every day.
      const RAMP_DAYS = 45;
      const KINDS = require('./offering-kinds.js');
      const urgent = oc.pickForDate(offerings, date);
      let rotated = null;
      if (urgent && urgent.viable && KINDS.isDateBound(urgent.kind)
          && urgent.days_until !== null && urgent.days_until <= RAMP_DAYS) {
        rotated = urgent;                                   // the window is closing: it wins
      } else {
        const pool = offerings.filter((o) => {
          if (!KINDS.isDateBound(o.kind)) return true;      // evergreen always eligible
          const p = oc.planSend(o, date);
          if (!p.viable) return false;                      // a past event is never eligible
          // A RECURRING offering (a daily series, a rolling training plan) is
          // date-bound by kind but carries no single date - it runs any time.
          if (p.days_until === null) return true;
          return p.days_until <= RAMP_DAYS;                 // a dated event: only in its ramp
        });
        const list = pool.length ? pool : offerings;
        const pick = list[(i + markets.indexOf(market)) % list.length];
        const p = oc.planSend(pick, date);
        rotated = (p && p.viable) ? p : (urgent && urgent.viable ? urgent : null);
      }
      if (!rotated || !rotated.viable) continue;
      const useOff = rotated.offering;
      const cohort = cohorts[(i + markets.indexOf(market)) % cohorts.length];
      const confidence = Math.round((0.45 + rnd() * 0.3) * 100) / 100;   // demo, deterministic
      entries.push({
        id: stableId(date, market, cohort, ns),
        date, market,
        status: 'needs_human_verification',
        confidence,
        cohort: { name: cohort, size: 0, estimated: true },
        objective: rotated.job,
        theme: `${useOff.name} (${useOff.kind})`,
        heroOffering: useOff,
        offering: useOff,
        heroProduct: { title: useOff.name, category: useOff.kind },
        channels: ['email', 'meta', 'google', 'landing_page'],
        cta: rotated.cta,
        cta_url: rotated.cta_url || null,
        phase: rotated.phase,
        why: `Planned from ${brand.name}'s own catalogue: ${useOff.kind} "${useOff.name}"${rotated.phase && rotated.phase !== 'evergreen' ? `, ${rotated.phase} phase` : ''}. Confidence is a DEMO figure; connect real analytics to replace it.`,
        analysis: buildEntryAnalysis({
          cohort: { name: cohort, size: 0 },
          product: { title: useOff.name, category: useOff.kind },
          channels: ['email', 'meta', 'google', 'landing_page'],
          objective: rotated.job,
          market,
          confidence: { score: confidence, reasons: [{ label: 'Derived from the brand\'s own catalogue', delta: 0, detail: `${useOff.kind} "${useOff.name}"` }] },
          dataSource: 'brand-offerings',
        }),
        reach: {
          cohort_size: null, cohort_size_estimated: true,
          widen_note: `[DATA REQUIRED BEFORE LAUNCH: real eligible-segment size for "${cohort}" in ${market}. Reach is never estimated.]`,
        },
        feasibility: { status: 'DATA REQUIRED', note: `Plan built from ${brand.name}'s own catalogue; connect its analytics for real feasibility.` },
        demo_numbers: true,
      });
    }
  }
  return entries;
}

async function buildContext(config, db) {
  const ownData = await db.ownData();
  const competitorData = await db.competitorData();
  const kb = new KnowledgeBaseService(config).build(ownData);
  const analysis = new AnalysisService(config).analyze(kb, ownData);
  const competitorBenchmarks = new CompetitorBenchmarkingService(config).benchmark(competitorData);
  return { ownData, kb, analysis, competitorBenchmarks };
}

// `brand` is threaded through because the calendar's offer decision selects a
// discount code from the BRAND'S OWN registry. Without it the planner has no
// code to offer and says so, which is correct - it must never fall back to a
// literal, because a code the brand never created fails at the customer's
// checkout.
function freshEntries(config, ctx, startDate, days, brand) {
  const calendar = new CalendarIntelligenceService(config).generate({
    analysis: ctx.analysis,
    competitorBenchmarks: ctx.competitorBenchmarks,
    startDate,
    days,
    feedback: ctx.ownData.feedback,
    brand: brand || null,
  });
  // Re-key on date+market so the same slot keeps the same id across daily syncs.
  const cohortLtv = cohortLtvMap(ctx);
  for (const e of calendar.entries) {
    e.id = stableId(e.date, e.market, e.cohort && e.cohort.name);
    attachScenarioLayer(e, ctx, cohortLtv);
  }
  return calendar.entries;
}

// ── Scenario layer (medium active + best/conservative/emergency/instant pre-staged) ─
// The active rolling plan IS the medium scenario. The other four are pre-staged
// DORMANT inside the same row's payload — nested (not separate rows) because
// smart_calendar_entries has a UNIQUE (date,market) index. A human can promote a
// standby into the active fields via activateScenario() (the "break" switch).

function cohortLtvMap(ctx) {
  const m = {};
  for (const c of (ctx.analysis?.cohorts || [])) m[c.name] = c.avgLtv || 0;
  return m;
}
function toHero(product) {
  if (!product) return null;
  return { sku: product.sku || product.id, title: product.title, handle: product.handle, category: product.category };
}

// Build one dormant standby variant for a slot: re-derive ONLY the lever-varied
// operational fields (channels intersected with the scenario's channel mix, hero
// per its product strategy) + grounded projected metrics. NOT a second full plan.
function buildStandbyVariant(e, label, ctx, cohortLtv) {
  const L = SM.SCENARIO_LEVERS[label];
  const baseChannels = Array.isArray(e.channels) ? e.channels : [];
  let channels = baseChannels.filter((c) => L.channelMix.includes(c));
  if (!channels.length) channels = L.channelMix.filter((c) => c === 'email' || c === 'landing_page');

  let heroProduct = e.heroProduct;
  const scores = (ctx.analysis && ctx.analysis.productScores) || [];
  if (L.productStrategy === 'bestseller-only' && scores[0]) heroProduct = toHero(scores[0].product);
  else if (L.productStrategy === 'launch-push' && scores.length) heroProduct = toHero((scores.find((s) => !s.winningMentions) || scores[0]).product);

  const benchmark = SM.buildEngine2Benchmark(ctx.analysis, e.market, cohortLtv[e.cohort?.name] || 0);
  const projected_metrics = SM.projectMetrics([{ cohort: e.cohort, channels, date: e.date }], L, benchmark);
  return { active_scenario: label, status: 'dormant', channels, heroProduct, objective: e.objective, levers: L, projected_metrics };
}

function attachScenarioLayer(e, ctx, cohortLtv) {
  const benchmark = SM.buildEngine2Benchmark(ctx.analysis, e.market, cohortLtv[e.cohort?.name] || 0);
  e.active_scenario = e.active_scenario || 'medium';
  e.scenario_projections = {
    medium: SM.projectMetrics([{ cohort: e.cohort, channels: e.channels, date: e.date }], SM.SCENARIO_LEVERS.medium, benchmark),
  };
  e.standby = {};
  for (const label of ['best', 'conservative', 'emergency', 'instant']) {
    const variant = buildStandbyVariant(e, label, ctx, cohortLtv);
    e.standby[label] = variant;
    e.scenario_projections[label] = variant.projected_metrics;
  }
}

// Promote a scenario's operational fields onto the payload top level (mutates).
// Leaving medium snapshots the current medium fields so a switch-back is lossless;
// returning to medium restores from that snapshot.
function promoteScenario(payload, label) {
  if (label === 'medium') {
    const snap = payload.__medium_snapshot;
    if (snap) Object.assign(payload, { channels: snap.channels, heroProduct: snap.heroProduct, objective: snap.objective });
    payload.active_scenario = 'medium';
    delete payload.__medium_snapshot;
    return payload;
  }
  const v = payload.standby && payload.standby[label];
  if (!v) return payload;
  if (!payload.__medium_snapshot && (payload.active_scenario || 'medium') === 'medium') {
    payload.__medium_snapshot = { channels: payload.channels, heroProduct: payload.heroProduct, objective: payload.objective };
  }
  Object.assign(payload, { channels: v.channels, heroProduct: v.heroProduct, objective: v.objective });
  payload.active_scenario = label;
  return payload;
}

// Build the effective entry an approval/preview should generate — the active
// scenario's operational fields merged in, with all internal/projection keys
// stripped so revenue numbers can NEVER reach the asset builders.
function effectiveEntry(entry) {
  const label = entry.active_scenario;
  let merged = entry;
  if (label && label !== 'medium' && entry.standby && entry.standby[label]) {
    const v = entry.standby[label];
    merged = { ...entry, channels: v.channels, heroProduct: v.heroProduct, objective: v.objective };
  }
  return SM.stripInternal(merged);
}

// Fields whose change means the slot was materially re-planned (vs. cosmetic).
function materialDiff(oldPayload, fresh) {
  const diffs = [];
  if ((oldPayload.cohort?.name) !== (fresh.cohort?.name)) diffs.push(`cohort ${oldPayload.cohort?.name} → ${fresh.cohort?.name}`);
  if ((oldPayload.heroProduct?.sku) !== (fresh.heroProduct?.sku)) diffs.push(`hero product ${oldPayload.heroProduct?.title || oldPayload.heroProduct?.sku} → ${fresh.heroProduct?.title || fresh.heroProduct?.sku}`);
  if (oldPayload.objective !== fresh.objective) diffs.push(`objective ${oldPayload.objective} → ${fresh.objective}`);
  if (JSON.stringify(oldPayload.channels) !== JSON.stringify(fresh.channels)) diffs.push(`channels ${JSON.stringify(oldPayload.channels)} → ${JSON.stringify(fresh.channels)}`);
  if (Math.abs((oldPayload.confidence || 0) - (fresh.confidence || 0)) >= 0.05) diffs.push(`confidence ${oldPayload.confidence} → ${fresh.confidence}`);
  return diffs;
}

// ── Retention / eviction (runs once per daily sync) ─────────────────────────
// Without this, smart_brain_runs (one row per sync), smart_feedback, and
// archived calendar rows grow unbounded over long enterprise cycles.
async function pruneOldRecords(config, db) {
  const cutoff = daysAgoIso(RETENTION_DAYS);
  const out = {};
  const runs = await db.delete(config.tableNames.runs, { created_at: `lt.${cutoff}` }).catch(() => null);
  out.runs = runs?.ok ? (runs.rows || []).length : 0;
  const fb = await db.delete(config.tableNames.feedback, { created_at: `lt.${cutoff}` }).catch(() => null);
  out.feedback = fb?.ok ? (fb.rows || []).length : 0;
  const cal = await db.delete(config.tableNames.calendarEntries, { status: 'eq.archived', updated_at: `lt.${cutoff}` }).catch(() => null);
  out.archived_calendar = cal?.ok ? (cal.rows || []).length : 0;
  return out;
}

// ── Daily sync (the smart-brain daily review loop) ──────────────────────────

async function syncDaily({ config: cfg = {}, days, persist = true } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const horizon = days || config.calendarDays;
  const start = todayIso();
  // Near-term slots inside this window get their prebuilt assets regenerated on
  // EVERY sync (fresh creatives vs. the latest competitor + campaign data), even
  // without a material plan change.
  const refreshDays = Number.isFinite(+config.prebuildRefreshDays) ? +config.prebuildRefreshDays : 7;
  const refreshUntil = addDaysIso(start, refreshDays);
  // A non-tenant-zero workspace plans from ITS OWN offerings and regions; the
  // shipped context (catalogue, analytics, moments) describes tenant zero only
  // and is never synthesized into another brand's workspace.
  const pb = await planningBrand(config, db);
  let ctx, fresh;
  if (!pb.isZero) {
    const offs = pb.brand ? _resolveBrandOfferings(pb.brand) : [];
    const ns = workspaceNs(config.workspace_id || (pb.brand && pb.brand.id), pb.isZero);
    fresh = pb.brand ? offeringPlanEntries(pb.brand, offs, start, horizon, ns) : [];
    if (!fresh.length) {
      // Carry the SAME keys as the success return below. A caller that reads
      // `plan` got undefined here and rendered its untouched previous screen,
      // so a brand with nothing to plan looked identical to a sync that had
      // never been clicked. `insights` is present for the same reason.
      return {
        ok: true, mode: db.connected ? 'db-linked' : 'local-fallback',
        synced_at: new Date().toISOString(), horizon_days: horizon,
        changes: [], insights: [], entries: [], plan: [], note: EMPTY_PLAN_NOTE,
      };
    }
    const markets = Array.from(new Set(fresh.map((e) => e.market)));
    ctx = {
      analysis: {
        dailyInsights: [
          `Plan generated from ${pb.brand.name}'s own catalogue (${offs.length} offerings) for its real region(s): ${markets.join(', ')}.`,
          'Confidence figures are DEMO values; reach and feasibility stay DATA REQUIRED until this brand\'s own analytics connect.',
        ],
        cohorts: [],
      },
      competitorBenchmarks: { byChannel: {}, trendingHooks: [] },
      ownData: { feedback: [] },
    };
  } else {
    // Markets are BRAND-TRUE for tenant zero too: derive them from its own
    // regions rather than the shipped ['US','UK'] default, so a brand selling
    // in India plans India slots.
    // NOTE: `config` is a const here, so build a NEW object rather than
    // reassigning it (a const reassignment would throw and be swallowed,
    // silently keeping the shipped ['US','UK'] default).
    let zeroCfg = config;
    try {
      const zero = require('./brand-runtime.js').defaultBrand();
      const codes = (zero.regions || []).map((r) => String(r.code || '').toUpperCase()).filter(Boolean);
      if (codes.length) zeroCfg = Object.assign({}, config, { markets: codes });
    } catch (_) { /* keep the shipped default if the record is unreadable */ }
    ctx = await buildContext(zeroCfg, db);
    fresh = freshEntries(zeroCfg, ctx, start, horizon, pb.brand || require('./brand-runtime.js').defaultBrand());
  }

  const changes = [];
  let stored = [];
  if (db.connected && persist) {
    stored = (await db.select(config.tableNames.calendarEntries, {
      filters: { date: `gte.${start}` }, order: 'date.asc', limit: 1000,
    }).catch(() => [])) || [];
  }
  const storedById = new Map(stored.map((r) => [r.id, r]));

  // New slots are inserted (never overwriting an existing row); refreshes to
  // tentative/rejected slots are applied as CONDITIONAL updates so a human
  // approval landing mid-sync is never clobbered (see optimistic-lock note below).
  const inserts = [];
  const updates = [];
  for (const entry of fresh) {
    const existing = storedById.get(entry.id);
    if (!existing) {
      inserts.push({
        id: entry.id, date: entry.date, market: entry.market, status: 'tentative',
        confidence: entry.confidence, payload: entry,
        change_log: [{ at: nowIso(), kind: 'created', detail: 'New slot added to rolling window.' }],
        updated_at: nowIso(),
      });
      changes.push({ id: entry.id, kind: 'created', detail: `${entry.date} ${entry.market}: new tentative slot (${entry.objective}).` });
      continue;
    }
    if (existing.status === 'approved' || existing.status === 'final') {
      changes.push({ id: entry.id, kind: 'kept_locked', detail: `${entry.date} ${entry.market}: human-approved, left untouched.` });
      continue;
    }
    // tentative or rejected → refresh from latest data.
    // Preserve a human's scenario SELECTION across syncs: if the stored row was
    // switched off medium (e.g. emergency), re-promote the freshly recomputed
    // variant so the daily refresh updates the variant CONTENTS but keeps the
    // chosen scenario active (and so materialDiff compares like-for-like).
    const carried = (existing.payload && existing.payload.active_scenario) || 'medium';
    if (carried !== 'medium' && entry.standby && entry.standby[carried]) promoteScenario(entry, carried);
    const diffs = materialDiff(existing.payload || {}, entry);
    const wasRejected = existing.status === 'rejected';
    if (diffs.length || wasRejected) {
      const log = Array.isArray(existing.change_log) ? existing.change_log.slice(-30) : [];
      log.push({ at: nowIso(), kind: wasRejected ? 'regenerated_after_rejection' : 'updated', detail: diffs.join('; ') || 'Regenerated after human rejection.' });
      updates.push({
        id: entry.id,
        patch: {
          date: entry.date, market: entry.market, status: 'tentative',
          confidence: entry.confidence, payload: entry, change_log: log, updated_at: nowIso(),
        },
      });
      changes.push({ id: entry.id, kind: wasRejected ? 'regenerated' : 'updated', detail: `${entry.date} ${entry.market}: ${diffs.join('; ') || 'regenerated after rejection'}.` });
    } else if (entry.date <= refreshUntil && isPrebuilt(existing)) {
      // No material re-plan, but this near-term slot is inside the daily
      // freshness window: drop the prebuilt marker so the queue regenerates its
      // mailer/ads/landing against the latest competitor + campaign data. Keep
      // the (unchanged) plan payload; only the marker is stripped.
      const payload = { ...(existing.payload || {}) };
      delete payload[PREBUILD_MARKER];
      const log = Array.isArray(existing.change_log) ? existing.change_log.slice(-30) : [];
      log.push({ at: nowIso(), kind: 'refresh_queued', detail: 'Daily freshness refresh: assets queued to rebuild against latest data.' });
      updates.push({
        id: entry.id,
        patch: { status: 'tentative', payload, change_log: log, updated_at: nowIso() },
      });
      changes.push({ id: entry.id, kind: 'refresh_queued', detail: `${entry.date} ${entry.market}: queued daily asset refresh.` });
    }
  }

  let persistence = { skipped: true, reason: db.connected ? 'persist=false' : 'Supabase env not configured' };
  if (db.connected && persist) {
    const results = { inserted: 0, updated: 0, skipped_locked: 0, warnings: [] };
    if (inserts.length) {
      // ignore-duplicates: if a concurrent sync already created the row, leave it untouched.
      const ins = await db.upsert(config.tableNames.calendarEntries, inserts, 'id', { resolution: 'ignore-duplicates' });
      if (ins.ok) results.inserted = (ins.rows || []).length; else results.warnings.push(ins.warning);
    }
    for (const u of updates) {
      // OPTIMISTIC LOCK: the status filter means a row a human approved between our
      // read and this write no longer matches → update affects 0 rows, decision preserved.
      const upd = await db.update(
        config.tableNames.calendarEntries,
        { id: `eq.${u.id}`, status: SYNC_WRITABLE_STATUSES },
        u.patch,
      );
      if (upd.ok) {
        if ((upd.rows || []).length) results.updated += 1;
        else results.skipped_locked += 1; // human approved/finalized mid-sync
      } else { results.warnings.push(upd.warning); }
    }
    persistence = { ok: true, ...results };
    // Roll past slots out of the active window.
    await db.update(config.tableNames.calendarEntries, { date: `lt.${start}`, status: SYNC_WRITABLE_STATUSES }, { status: 'archived', updated_at: nowIso() }).catch(() => {});
    await db.insert(config.tableNames.runs, [{
      id: `run_${Date.now().toString(36)}`,
      payload: { kind: 'daily-sync', start, horizon, changes, insights: ctx.analysis.dailyInsights },
      created_at: nowIso(),
    }]).catch(() => {});
    persistence.pruned = await pruneOldRecords(config, db);
  }

  const plan = await getPlan({ config: cfg, _ctxFallback: { config, db, ctx, fresh } });
  return {
    ok: true,
    mode: db.connected ? 'db-linked' : 'local-fallback',
    synced_at: nowIso(),
    horizon_days: horizon,
    changes,
    insights: ctx.analysis.dailyInsights,
    cohorts: ctx.analysis.cohorts,
    competitorBenchmarks: { byChannel: ctx.competitorBenchmarks.byChannel, trendingHooks: ctx.competitorBenchmarks.trendingHooks.slice(0, 8) },
    plan: plan.entries,
    persistence,
  };
}

// ── Read current plan ───────────────────────────────────────────────────────

async function getPlan({ config: cfg = {}, _ctxFallback = null } = {}) {
  const config = _ctxFallback?.config || smartConfig(cfg);
  const db = _ctxFallback?.db || new SmartBrainDbAdapter(config);
  if (db.connected) {
    let rows = (await db.select(config.tableNames.calendarEntries, {
      filters: { date: `gte.${todayIso()}`, status: 'neq.archived' }, order: 'date.asc,market.asc', limit: 1000,
    }).catch(() => [])) || [];
    if (rows.length) {
      // STALENESS GUARD. A workspace can be renamed or re-pointed at a
      // different brand (it happened: an Economic Times workspace became TOI
      // Health & Fitness). Its stored rows then describe the OLD identity's
      // offerings, and nothing else would ever notice. If none of the stored
      // heroes exist in the brand's CURRENT offerings, the plan is stale:
      // fall through and re-plan from what the brand is NOW.
      try {
        const pbNow = await planningBrand(config, db);
        if (!pbNow.isZero && pbNow.brand) {
          const own = _resolveBrandOfferings(pbNow.brand).map((o) => String(o.name || '').toLowerCase());
          if (own.length) {
            const heroes = rows.map((r) => String(((r.payload || {}).heroProduct || {}).title || '').toLowerCase()).filter(Boolean);
            const overlap = heroes.filter((h) => own.includes(h)).length;
            if (heroes.length && overlap === 0) {
              try { console.warn('[smart-brain] stored plan does not match this brand\'s current offerings - re-planning'); } catch (_) {}
              rows = [];
            }
          }
        }
      } catch (_) { /* a guard failure must never block the stored plan */ }
    }
    if (rows.length) {
      return {
        ok: true, mode: 'db-linked', stored: true,
        entries: rows.map((r) => ({ ...(r.payload || {}), id: r.id, status: r.status, confidence: r.confidence, change_log: r.change_log, generated_campaign_id: r.generated_campaign_id, approved_by: r.approved_by, approved_at: r.approved_at, updated_at: r.updated_at })),
      };
    }
  }
  // Stateless preview: no DB (or empty table) — generate on the fly. The
  // shipped catalogue describes tenant zero only, so any other workspace plans
  // from ITS OWN offerings and regions (demo numbers, real catalogue), or gets
  // an honest empty state when it has none.
  const pb = await planningBrand(config, db);
  if (!pb.isZero) {
    const offs = pb.brand ? _resolveBrandOfferings(pb.brand) : [];
    const ns = workspaceNs(config.workspace_id || (pb.brand && pb.brand.id), pb.isZero);
    const entries = pb.brand ? offeringPlanEntries(pb.brand, offs, todayIso(), config.calendarDays, ns) : [];
    if (!entries.length) {
      return { ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', stored: false, entries: [], note: EMPTY_PLAN_NOTE };
    }
    return {
      ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', stored: false,
      entries: entries.map((e) => ({ ...e, status: 'tentative' })),
      note: `Plan generated from ${pb.brand.name}'s own catalogue and regions. Confidence figures are DEMO until real analytics connect.`,
    };
  }
  let cfg2 = config;
  try {
    const zero = require('./brand-runtime.js').defaultBrand();
    const codes = (zero.regions || []).map((r) => String(r.code || '').toUpperCase()).filter(Boolean);
    if (codes.length) cfg2 = Object.assign({}, config, { markets: codes });
  } catch (_) {}
  const ctx = _ctxFallback?.ctx || await buildContext(cfg2, db);
  const entries = _ctxFallback?.fresh || freshEntries(cfg2, ctx, todayIso(), cfg2.calendarDays, pb.brand || require('./brand-runtime.js').defaultBrand());
  return { ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', stored: false, entries: entries.map((e) => ({ ...e, status: 'tentative' })) };
}

// ── LLM copywriting on approval ─────────────────────────────────────────────

// ── D2C growth knowledge base (baked into every strategy + copy prompt) ───────
// Distilled, practitioner-sourced playbook so generation reasons like a senior
// D2C growth lead, not a generic copywriter. Referenced leaders: Nik Sharma
// (owned-channel + hook economics), Chase Dimond (lifecycle email structure),
// Ari Murray (creative-led offers), Russell Brunson (Hook-Story-Offer), plus
// Ridge Wallet-style objection-led conversion.
const D2C_KNOWLEDGE = `D2C GROWTH KNOWLEDGE BASE (apply, do not cite):
- Value frameworks: Hook-Story-Offer (Brunson), Problem-Agitate-Solve (PAS), Identity-Driven (align the product with who the reader wants to become), Feature-Advantage-Benefit.
- Email structure (Dimond/Sharma): a pattern-interrupt HOOK in the first scroll, one clear idea, visceral sensory benefits, objection-killing social proof, one low-friction CTA. No wall of text.
- Creative (Murray): the offer and the transformation lead; the product is the proof, not the headline.
- Competitor benchmarking aesthetics: study the ACTIVE brand's own competitive set (see its competitor universe) rather than a fixed list; common winning registers are high-contrast minimalism, rich origin-story education, problem-centric bold layouts, and calm clinical clean design.`;

// Regional nuance matrix — what a given market responds to.
function regionalNuance(market) {
  const m = String(market || '').toUpperCase();
  if (m === 'US') return 'US market: lead with performance, convenience, and an instant upgrade to the routine.';
  if (m === 'UK' || m === 'EU') return 'UK/EU market: lead with transparency, provenance, and understated quality.';
  if (m === 'IN') return 'India market: lead with authenticity, value clarity, and cultural moment relevance.';
  return 'Global/emerging market: lead with premium status, authenticity, and gifting value.';
}

// The four selling components every mailer must carry, for ANY brand.
const MAILER_COMPONENTS = `Every mailer must contain, in order: (1) an immediate HOOK to sell in the first scroll (pattern-interrupt or a high-intent reason to act now); (2) core BENEFITS of the offering, sensory and specific to THIS brand; (3) SOCIAL PROOF and trust drawn ONLY from supplied data (never invent ratings, review counts or reviewers - omit the block if none supplied); (4) VALUE ADD-ONS: 2-3 badges drawn ONLY from the brand's verifiable claims, a risk-reversal line only if the brand states one, and a short FAQ.`;

// Brand-derived system prompt: the copywriter persona, voice, preferred and
// banned vocabulary all come from the ACTIVE brand's record - never a fixed
// tenant's. With no brand on the entry (tenant-zero cron paths) it derives
// from tenant zero's record via brand-runtime, so it still cannot drift.
function brandSystem(brand) {
  let b = brand && brand.id ? brand : null;
  if (!b) { try { b = require('./brand-runtime.js').scopedBrand(null); } catch (_) { b = {}; } }
  const v = b.voice || {};
  const site = String(b.website || '').replace(/^https?:\/\//, '');
  const lines = [
    `You are the senior lifecycle copywriter for ${b.name || 'the brand'}${site ? ` (${site})` : ''}${b.industry ? ` - ${b.industry}` : ''}.`,
    `Voice: ${v.tone || 'clear, specific, on-brand'}.${Array.isArray(v.preferred) && v.preferred.length ? ` Prefer: ${v.preferred.join(', ')}.` : ''}`,
  ];
  if (Array.isArray(v.banned) && v.banned.length) lines.push(`NEVER use: ${v.banned.map((x) => `"${x}"`).join(', ')}.`);
  lines.push('Never invent product facts, prices, URLs, ratings, reviews or statistics; a missing fact is written as [DATA REQUIRED BEFORE LAUNCH: field].');
  lines.push(D2C_KNOWLEDGE);

  // Brief the writer with the SAME rules the validator will apply afterwards.
  // These used to be two different things: asset-specs.js went into a prompt as
  // prose, and nothing checked the result, so an over-long Google headline was
  // found by Google. One source, stated to the writer and enforced on the
  // artefact - and each asset type is briefed on its own medium rather than all
  // of them sharing one set of instructions.
  try {
    const contracts = require('./asset-contracts.js');
    lines.push(
      'EACH ASSET IS BUILT TO ITS OWN CONTRACT. These are not style preferences: they are what the',
      'medium does to copy that ignores them, and the finished asset is checked against them.',
      ...['email.mailer', 'ad.meta.static', 'ad.google.rsa', 'ad.tiktok.video', 'landing.page']
        .map((id) => contracts.brief(id)),
    );
  } catch (_) { /* the copywriter still works without the briefs */ }

  lines.push('Return STRICT JSON only, no markdown fences.');
  return lines.join('\n');
}

// ── Agent 1: Strategy Analyst ───────────────────────────────────────────────
// A top growth-strategy leader reads the slot's data (cohort, reach, competitor
// hooks, product, offer, festival) and returns a tight strategy brief that the
// content + asset agents build on. Failure-tolerant: returns null so the copy
// stage can still run standalone. Pinned provider is returned for speed.
function strategySystem(brand) {
  let b = brand && brand.id ? brand : null;
  if (!b) { try { b = require('./brand-runtime.js').scopedBrand(null); } catch (_) { b = {}; } }
  return `You are ${b.name || 'the brand'}'s Head of Growth Strategy - a top lifecycle-marketing analyst${b.industry ? ` for ${b.industry}` : ''}.
You turn cohort + offering + competitor data into a sharp, differentiated campaign strategy for THIS brand only.
Be specific and quantitative where the data allows; never borrow another brand's facts.
${D2C_KNOWLEDGE}
Return STRICT JSON only, no markdown fences.`;
}


/**
 * Describe what this send is actually promoting.
 *
 * A send is not always about a product. When the slot carries an OFFERING
 * (event, programme, section, plan, service) this returns the campaign
 * mechanics for it - phase in the ramp, the real job of this send, and the
 * exact call to action - so the model writes "register before it closes" for a
 * marathon rather than "shop the edit". Falls back to the legacy product line
 * so existing product slots are unchanged.
 */
function offeringBrief(entry) {
  const off = entry.heroOffering || entry.offering || null;
  if (off) {
    const plan = OfferingCampaign.planSend(off, entry.date);
    if (plan.viable) return plan.promptLines.join('\n');
    return `- [SLOT NOT VIABLE: ${plan.reason}]`;
  }
  const p = entry.heroProduct;
  if (!p) return '- [DATA REQUIRED BEFORE LAUNCH: no offering or product assigned to this slot]';
  return `- Hero product: ${p.title} (${p.category || 'product'})\n- This is a PRODUCT. Standard merchandising applies.`;
}

function strategyPrompt(entry) {
  const d = entry.decision || {};
  return `Devise the strategy for ONE lifecycle send. Data:
- Market: ${entry.market} | Cohort: ${entry.cohort?.name} (${entry.cohort?.size ?? 'size via ESP'} profiles) | Objective: ${entry.objective}
${offeringBrief(entry)}${(entry.supportingProducts || []).length ? `\n- Bundle: ${(entry.supportingProducts).map((p) => p.title).join(', ')}` : ''}
- Offer: ${d.offer ? (d.offer.code ? `${d.offer.code} (${Math.round((d.offer.pct || 0) * 100)}%)` : 'no discount') : 'n/a'}
- ${entry.festival ? `Seasonal moment: ${entry.festival.name}` : 'No festival; evergreen angle.'}
- Reach target: ${entry.reach?.planned_recipients?.toLocaleString?.() || 'n/a'} recipients, ${entry.reach?.per_user_per_week?.min || 2}-${entry.reach?.per_user_per_week?.max || 3} mailers/user/week.
- ${regionalNuance(entry.market)}

${creativeEvidence.briefFor(entry)}

Choose the value framework (Hook-Story-Offer, PAS, or Identity-Driven) that best fits this cohort and say which in "framework". Make this send DIFFERENT from a generic promo and true to its cohort + theme.
Return JSON exactly:
{ "angle": "the single sharp campaign angle", "framework": "Hook-Story-Offer | PAS | Identity-Driven", "hook_thesis": "why this lands for THIS cohort now", "target_emotion": "the one feeling to evoke", "proof_points": ["","",""], "differentiator": "what makes this send distinct from the others this week", "dos": ["",""], "donts": ["",""] }`;
}

async function strategyBrief(entry) {
  try {
    const res = await callLLMTiered({
      systemPrompt: strategySystem(entry.brand),
      stage: 'strategy', feature: 'brain.strategy', workspaceId: (entry && entry.workspace_id) || null,
      userMessage: strategyPrompt(entry),
      responseFormat: { type: 'json_object' },
      maxTokens: 900,
      temperature: 0.7,
      // Optional enrichment on the on-demand path — keep it tightly bounded so it
      // can never dominate the function budget (copy runs fine without it).
      timeoutMs: 12000,
      stage: 'smart-brain-strategy',
      tier: 'premium',
    });
    const json = parseJSON(res.text);
    if (!json || !json.angle) return null;
    return { brief: json, provider: res.provider, model: res.model };
  } catch (_) { return null; }
}

/**
 * WHO this send is for, in the ACTIVE brand's own terms.
 *
 * This block used to be a hardcoded persona inherited from the sibling project
 * this repo was forked from: a named play id, a demographic, a life stage and
 * three feelings, all describing THAT company's customer. It art-directed the ad
 * imagery for EVERY tenant, so a news publisher, a fashion label and a consumer
 * tech brand all had their creatives composed for a stranger's buyer. (The
 * literal string is not repeated here - tests/smart-brain-assets.spec.js holds
 * it in fragments, so this file cannot become the place it survives.)
 *
 * The audience now comes from the two places that actually know it:
 *   1. the SLOT'S COHORT, which is a behavioural segment computed from THIS
 *      brand's own order/engagement data (name + the rules that define it), and
 *   2. an audience the operator stated on the BRAND RECORD, if there is one.
 * When neither states a persona the brief SAYS SO with the spec's marker and
 * forbids inventing one, rather than substituting a demographic. A guessed
 * persona is a fabricated fact about the brand's customers.
 */
function audienceBrief(entry) {
  const b = (entry && entry.brand) || null;
  const bName = (b && b.name) || 'this brand';
  const c = (entry && entry.cohort) || {};
  const lines = [];
  if (c.name) {
    const rules = Array.isArray(c.rules) ? c.rules.filter(Boolean) : [];
    lines.push(`- Audience, as a COHORT from ${bName}'s own data: ${c.name}${rules.length ? ` (defined as: ${rules.join('; ')})` : ''}. This is a behavioural definition, not a demographic one.`);
  }
  const stated = (b && (b.audience || (b.voice && b.voice.audience))) || null;
  const statedText = Array.isArray(stated) ? stated.filter(Boolean).join('; ') : (stated ? String(stated).trim() : '');
  if (statedText) lines.push(`- Audience stated on ${bName}'s own brand record: ${statedText}.`);
  else lines.push(`- ${bName}'s brand record states no persona. [DATA REQUIRED BEFORE LAUNCH: audience / persona definition, ${bName}]`);
  lines.push(`- Do NOT assume an age, gender, life stage, occupation, family role or daily routine for this audience, and do not write one into the copy or the image_brief. Work from ${bName}'s own offering, its category (${(b && b.industry) || 'category not stated on the brand record'}) and the cohort behaviour above, and nothing else.`);
  return lines.join('\n');
}

/**
 * The proof this send is ALLOWED to make.
 *
 * The JSON shape below used to arrive pre-filled: a specific star rating, a
 * specific review count, a review object templated down to the FORM of a
 * reviewer's name, and two example certification badges. Seeding a shape with
 * values IS an instruction to produce values:
 * the model has no approved library to draw from, so it invents a rating, a
 * reviewer and a certification the brand does not hold. `mailer_system/
 * brand_prompt.py` had the identical defect and was fixed the same way.
 *
 * Proof now travels INTO the prompt from the approved library only, and when
 * the library is empty for this product/region the prompt says so and requires
 * the fields to come back empty. `brand-facts.js` is the library; the brand
 * record's own verifiable `claims` are the only badge source.
 */
function approvedProof(entry) {
  const b = (entry && entry.brand) || null;
  const key = (entry && entry.heroProduct && (entry.heroProduct.sku || entry.heroProduct.handle || entry.heroProduct.title)) || '';
  const region = (entry && entry.market) || '';
  let rating = null, reviews = [], skuClaims = [];
  if (facts) {
    try { rating = facts.approvedRating(key, region); } catch (_) { rating = null; }
    try { reviews = facts.approvedReviews(key, region) || []; } catch (_) { reviews = []; }
    try { skuClaims = facts.approvedClaims(key, region) || []; } catch (_) { skuClaims = []; }
  }
  const brandClaims = (b && Array.isArray(b.claims)) ? b.claims.filter(Boolean) : [];
  // Testimonials read off the brand's OWN site, stamped onto the entry by
  // loadBrandReviews() before any copy is written. They are approved by the same
  // standard as the curated library: the brand published them itself, verbatim,
  // with the page they came from recorded on each.
  const site = Array.isArray(entry && entry.__reviews) ? entry.__reviews : [];
  const merged = [...reviews, ...site.map((r) => ({
    quote: r.quote,
    author: r.author || '',
    rating: r.rating || null,
    media: Array.isArray(r.media) ? r.media : [],
    source_url: r.source_url || '',
  }))];
  // The rating the brand's own page stated, taken EXACTLY as stated (and only
  // when it is on the usual 5-point scale, so a 4.9/10 is never shown as 4.9/5).
  const sited = site.find((r) => r.rating && r.rating.value && String(r.rating.scale || '5') === '5');
  const effRating = rating != null ? rating : (sited ? sited.rating.value : null);
  return { rating: effRating, reviews: merged, claims: [...new Set([...skuClaims, ...brandClaims])], region: region || 'all', brandName: (b && b.name) || 'this brand' };
}

/**
 * Load this brand's own testimonials and stamp them on the entry.
 *
 * Runs ONCE per campaign build, before any copy is written, so the sync render
 * path (renderVariant / lpHtml / emailHtml) and the sync prompt builders can all
 * read them off `entry.__reviews` without becoming async.
 *
 * Every failure is honest and non-fatal: no site on the record, no egress from
 * this deployment, no Supabase to persist into, or a site that simply publishes
 * no testimonials all end the same way — an empty list and the spec's marker.
 * A campaign never blocks on this, and never invents a review to fill the gap.
 */
async function loadBrandReviews(entry, config) {
  if (!entry || Array.isArray(entry.__reviews)) return entry;
  entry.__reviews = [];
  entry.__review_marker = '';
  if (!brandReviews) return entry;
  const brand = entry.brand || null;
  if (!brand || !brand.website) {
    entry.__review_marker = brandReviews.MARKER(brand, entry.market);
    return entry;
  }
  try {
    const workspaceId = entry.workspace_id || (config && config.workspace_id) || (brand && brand.workspace_id) || null;
    const productKey = String((entry.heroProduct && entry.heroProduct.title) || '').toLowerCase() || null;
    const got = await brandReviews.reviewsForBrand({
      brand, workspaceId, market: entry.market, limit: 2, productKey,
    });
    entry.__reviews = Array.isArray(got.reviews) ? got.reviews : [];
    entry.__review_marker = got.marker || '';
    entry.__review_limits = got.limits || [];
    entry.__review_source = got.source || '';
  } catch (e) {
    entry.__reviews = [];
    entry.__review_marker = brandReviews.MARKER(brand, entry.market);
    entry.__review_limits = [`Review extraction failed: ${String((e && e.message) || e).slice(0, 160)}`];
  }
  return entry;
}

/** The marker the spec requires wherever approved proof is missing. */
function proofMarker(entry) {
  const p = approvedProof(entry);
  return `[DATA REQUIRED BEFORE LAUNCH: approved review library, ${p.brandName}, ${p.region}]`;
}

function approvedProofBrief(entry) {
  const p = approvedProof(entry);
  const have = [];
  if (p.rating != null) have.push(`- Approved rating: ${p.rating}. Print it EXACTLY as written, never rounded and never with an invented review count.`);
  if (p.reviews.length) have.push(`- Approved reviews (verbatim, with the author exactly as given, or omit entirely): ${p.reviews.map((r) => `"${String(r.quote || '').trim()}" - ${String(r.author || '').trim()}`).join(' | ')}`);
  if (p.claims.length) have.push(`- Approved claims, the ONLY permitted badge text: ${p.claims.join('; ')}`);
  // The REVIEW library is declared empty on its own terms. Folding it in with
  // claims hid it: a brand with one verifiable claim and zero approved reviews
  // produced a brief that listed the claim and never mentioned that there was no
  // testimonial to quote, which is precisely the gap the model then filled.
  if (!p.reviews.length) have.push(`- There are NO approved reviews or testimonials for this product in ${p.region}. ${proofMarker(entry)}`);
  if (p.rating == null) have.push('- There is NO approved rating. Do not state one, in any form, including "highly rated" or a review count.');
  const head = 'APPROVED PROOF LIBRARY — the only social proof you may use. Anything not listed here does not exist.';
  const rule = [
    'NEVER invent or infer a star rating, a review count, a reviewer name, a testimonial, a certification, an award or a guarantee.',
    'A proof field with nothing approved behind it comes back EMPTY ("rating": null, "reviews": [], "badges": [], "guarantee": "", "proof_quote": "", "proof_author": ""). Empty is the CORRECT answer, and the renderer prints a [DATA REQUIRED BEFORE LAUNCH] marker in its place so the gap is visible to the reviewer.',
  ].join(' ');
  return `${head}\n${have.join('\n')}\n${rule}`;
}

function copyPrompt(entry, fw = null, brief = null) {
  const fwLine = fw
    ? `\nCOPY FRAMEWORK: structure the copy with the ${fw.name} framework (${fw.full || fw.name}); the opening beat lands in the subject + hero_headline, the middle beats across intro_paragraph and body_paragraph in order, and the final beat on the cta. Do NOT name the framework in the copy, let the structure do the work.`
    : '';
  const briefLine = brief
    ? `\nSTRATEGY BRIEF from the growth lead (follow it): angle = ${brief.angle}; hook = ${brief.hook_thesis}; emotion = ${brief.target_emotion}; differentiator = ${brief.differentiator}; proof = ${(brief.proof_points || []).filter(Boolean).join('; ')}. Do: ${(brief.dos || []).join('; ')}. Avoid: ${(brief.donts || []).join('; ')}.`
    : '';
  return `Write campaign copy for this planned slot. Context:
- Market: ${entry.market} | Cohort: ${entry.cohort?.name} | Objective: ${entry.objective}
- Hero product: ${entry.heroProduct?.title} (${entry.heroProduct?.category || (entry.offering && entry.offering.kind) || 'catalogue item'})
- ${entry.festival ? `Seasonal moment: ${entry.festival.name}` : 'No festival; evergreen angle.'}
- Rationale: ${entry.rationale || ''}
${creativeEvidence.briefFor(entry)}
- ${regionalNuance(entry.market)}${fwLine}${briefLine}

WHO THIS IS FOR:
${audienceBrief(entry)}

${approvedProofBrief(entry)}

${MAILER_COMPONENTS}

Every asset must ship with a CREATIVE as well as copy. For each asset write an "image_brief": a vivid 1-2 sentence art-direction prompt for a photoreal product/lifestyle scene of the hero product. Channel rules (ALL creatives are TEXT-FREE photographs — never describe overlaid words, headlines, prices, logos or UI in the image_brief; diffusion models cannot spell and render garbled fake letterforms, and the real ad copy is rendered natively by the platform, not painted into the pixels):
- email / LP heroes: just scene, props, light, mood; aspirational hero.
- AD creatives (meta / google / tiktok): a scroll-stopping TEXT-FREE photograph that sells the END STATE this cohort is buying - what is different for them once they have it - rather than a component, ingredient or spec shot; open on a 1-second scroll-stop. Art-direct it from the audience block above; if that block carries a [DATA REQUIRED BEFORE LAUNCH] marker, direct the frame at the OFFERING and the brand's own world and put no person of an assumed age, gender or life stage in it. Compose for the placement: meta = square, google = clean landscape, tiktok = vertical native hand-held. State only the scene, subject, light and mood - no words in the frame.

Return JSON with exactly this shape:
{
 "email": { "subject": "", "subject_alt1": "", "subject_alt2": "", "preheader": "", "hook": "the first-scroll pattern-interrupt line", "hero_headline": "", "intro_paragraph": "", "body_paragraph": "", "benefits": ["sensory benefit 1","benefit 2","benefit 3"], "rating": null, "reviews": [], "badges": [], "guarantee": "", "faq": [{"q":"","a":""},{"q":"","a":""}], "cta": "", "image_brief": "" },
 "landing": { "hero_headline": "", "hero_sub": "", "why_title": "", "why_bullets": ["","",""], "proof_quote": "", "proof_author": "", "faq": [{"q":"","a":""},{"q":"","a":""}], "cta": "", "image_brief": "" },
 "ads": {
   "meta": { "primary_text": "", "headline": "", "description": "", "image_brief": "" },
   "google": { "headlines": ["","",""], "descriptions": ["",""], "image_brief": "" },
   "tiktok": { "script": "", "caption": "", "image_brief": "" }
 }
}

"rating", "reviews", "badges", "guarantee", "proof_quote" and "proof_author" are shown above at their EMPTY values on purpose. Fill them ONLY by copying an entry out of the APPROVED PROOF LIBRARY block above, verbatim. If that block says the library is empty, leave them exactly as shown. Do not treat the empty values as placeholders to be filled in.`;
}

const FONT_HEAD = "'Montserrat','Raleway',Georgia,serif";
const FONT_BODY = "'Instrument Sans','Helvetica Neue',Arial,sans-serif";

// HTML-escape so LLM copy can't break the markup / inject tags.
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** The ACTIVE brand's palette, with tenant-zero's record only when it IS tenant zero. */
function brandPal(entry) {
  let b = (entry && entry.brand && entry.brand.id) ? entry.brand : null;
  if (!b) { try { b = require('./brand-runtime.js').scopedBrand(null); } catch (_) { b = {}; } }
  const p = (b && b.palette) || {};
  return {
    name: (b && b.name) || '',
    P: p.primary || '#D0473E', ACC: p.accent || '#6A33D8',
    INK: p.ink || '#111111', SURF: p.surface || '#FFFFFF',
    SURF2: p.surface_alt || '#F6F6F6', LINE: p.line || '#E5E5E5',
  };
}

/**
 * The REAL proof block: a couple of the brand's own published testimonials, with
 * their images served from our Supabase Storage copy rather than hotlinked off
 * the brand's CDN (an email is opened days later, from a client that is not a
 * browser, against a host that may block hotlinks or have rotated the URL).
 *
 * Table-based and fully inline-styled because this renders inside an EMAIL, and
 * on a LIGHT surface because the spec forbids dark-neutral section backgrounds.
 *
 * With nothing approved to show, this is the marker - not an empty string.
 * Silence reads as a design choice; the marker reads as the gap it is, and
 * travels into the review console and the launch gate.
 */
function proofBlockHtml(entry, style = 'visual') {
  const pal = brandPal(entry);
  const reviews = Array.isArray(entry && entry.__reviews) ? entry.__reviews : [];
  const marker = (entry && entry.__review_marker)
    || (brandReviews ? brandReviews.MARKER(entry && entry.brand, entry && entry.market) : `[DATA REQUIRED BEFORE LAUNCH: approved review library, ${(entry && entry.brand && entry.brand.name) || 'this brand'}, ${(entry && entry.market) || 'all'}]`);
  // The mailer taxonomy has exactly two types, and "Text" means PURE
  // typographic. So the pure/editorial variants get the same real testimonials
  // set in type alone - no fill, no badge, no photograph - rather than being
  // quietly promoted into Text + Graphics by their proof block.
  const textOnly = style === 'pure' || style === 'editorial';
  const band = (inner) => (textOnly
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:22px 24px;font-family:${FONT_BODY};color:${pal.INK};border-top:1px solid ${pal.LINE}">${inner}</td></tr></table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${pal.SURF2};border-top:1px solid ${pal.LINE}"><tr><td style="padding:26px 24px;font-family:${FONT_BODY};color:${pal.INK}">${inner}</td></tr></table>`);
  if (!reviews.length) {
    return band(`<p style="margin:0;text-align:center;font-size:12.5px;line-height:1.5;color:${pal.INK}${textOnly ? '' : `;border:1px dashed ${pal.INK};border-radius:8px;padding:12px 14px`}">${esc(marker)}</p>`);
  }
  if (textOnly) {
    const lines = reviews.slice(0, 2).map((r) => {
      const rating = (r.rating && r.rating.value && String(r.rating.scale || '5') === '5') ? ` (${esc(String(r.rating.value))}/5)` : '';
      const who = r.author ? `<span style="font-weight:700;color:${pal.P}"> - ${esc(r.author)}${rating}</span>` : (rating ? `<span style="font-weight:700;color:${pal.P}">${rating}</span>` : '');
      return `<p style="margin:0 0 14px;font-size:14.5px;line-height:1.65;color:${pal.INK}">&ldquo;${esc(r.quote)}&rdquo;${who}</p>`;
    }).join('');
    return band(`<p style="margin:0 0 12px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${pal.P};font-weight:700">In their words</p>${lines}`);
  }
  const cards = reviews.slice(0, 2).map((r) => {
    // A star line renders only from a rating the page actually stated, on the
    // usual 5-point scale, printed at the value it stated (never rounded).
    const rating = (r.rating && r.rating.value && String(r.rating.scale || '5') === '5') ? String(r.rating.value) : '';
    const stars = rating ? `<div style="font-size:13px;color:${pal.ACC};margin:0 0 8px">★★★★★ <span style="color:${pal.INK}">${esc(rating)}/5</span></div>` : '';
    // Only a storage-hosted image is emitted. A source URL we failed to re-host
    // is NOT hotlinked as a fallback, and no other image is substituted.
    const shot = (Array.isArray(r.media) ? r.media : []).find((m) => m && m.hosted_url);
    const img = shot
      ? `<img src="${esc(shot.hosted_url)}" alt="${esc(`Customer photo published by ${pal.name || 'the brand'}`)}" width="120" style="display:block;width:120px;max-width:120px;border-radius:8px;border:1px solid ${pal.LINE}">`
      : '';
    // The reviewer exactly as the site named them, or no attribution at all.
    const who = r.author ? `<div style="margin:10px 0 0;font-size:12.5px;font-weight:700;color:${pal.P}">${esc(r.author)}</div>` : '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px"><tr>
${img ? `<td valign="top" width="132" style="padding-right:12px">${img}</td>` : ''}
<td valign="top">${stars}<div style="font-size:14.5px;line-height:1.6;color:${pal.INK}">&ldquo;${esc(r.quote)}&rdquo;</div>${who}</td>
</tr></table>`;
  }).join('');
  return band(`<div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${pal.P};font-weight:700;margin:0 0 14px">In their words</div>${cards}`);
}

/**
 * Add the proof block to a rendered mailer.
 *
 * The shared variant renderer lives in calendar-trigger.js and has no proof
 * slot, so this composes onto its output rather than reaching into it.
 */
function injectProofBlock(html, entry, style = 'visual') {
  const s = String(html || '');
  if (!s) return s;
  const block = proofBlockHtml(entry, style);
  if (!block) return s;
  // Above the legal footer, not below it. The renderer emits the CAN-SPAM
  // sender block as an ordinary paragraph inside the body table rather than a
  // <footer>, so anchor on the paragraph that carries it; appending at </body>
  // would put a customer testimonial underneath the unsubscribe line.
  const legal = /<p[^>]*>(?=(?:(?!<\/p>)[\s\S])*?(?:receiving this as|unsubscribe|DATA REQUIRED BEFORE LAUNCH: legal|DATA REQUIRED BEFORE LAUNCH: sender))/i.exec(s);
  if (legal && legal.index > 0) return s.slice(0, legal.index) + block + s.slice(legal.index);
  const i = s.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? s + block : s.slice(0, i) + block + s.slice(i);
}

/* ── section grounds and the text that sits on them ───────────────────────── */
// "Never black / #111111 / dark-neutral section backgrounds" is a HARD design
// rule, and until now it reached these renderers only as prose inside a prompt.
// Prose is not a gate, and the renderers broke it: this file's landing footer
// was `background:var(--ink)`, and emailHtml's palette fallback was
// `pal.primary || '#111111'` - so a brand record with no palette rendered its
// hero band, its button and its footer black. The fallback was the defect, not
// the data.
//
// The classifier and the text derivation live in brand-workspace-core, which is
// where the same rule is enforced on the page surface at activation. A second
// copy here would be a second definition of "black".
const _wsCore = () => { try { return require('./brand-workspace-core.js'); } catch (_) { return null; } };
const sectionGround = (...c) => { const k = _wsCore(); return k ? k.sectionGround(...c) : (c.find(Boolean) || '#FFFFFF'); };
const textOn = (ground, surface, ink) => { const k = _wsCore(); try { return k ? k.textOn(ground, surface, ink) : (surface || '#FFFFFF'); } catch (_) { return surface || '#FFFFFF'; } };

// try.knickgasm.*-style presell landing page. Self-contained (inline CSS, no external
// fonts/scripts) so it serves at /lp/:id AND exports as a deploy-ready file.
// creativeUrl (optional) is a generated hero image from the creative pipeline.
function lpHtml(entry, copy, campaignId, creativeUrl) {
  const L = copy.landing || {};
  // Everything brand-visible derives from the ACTIVE brand on the entry:
  // name, palette, claims, store. Tenant zero's record is the source only
  // when the entry genuinely belongs to tenant zero.
  let _b = entry.brand && entry.brand.id ? entry.brand : null;
  if (!_b) { try { _b = require('./brand-runtime.js').scopedBrand(null); } catch (_) { _b = {}; } }
  const bName = _b.name || 'the brand';
  const _pal = _b.palette || {};
  const INKC = _pal.ink || '#111111', SURF = _pal.surface || '#FFFFFF', SURF2 = _pal.surface_alt || '#f6f6f6';
  // Three pairings on this page were picked by eye against tenant zero and
  // measured, for that brand, at 2.77:1 (ink on the accent button), 1.51:1 (the
  // accent eyebrow on the primary band) and 3.29:1 (a hardcoded cream at 82% on
  // the primary) - all under the 4.5 body floor, on a page served to real
  // traffic at /lp/:id. The text is derived now, and the grounds are guarded.
  const P = sectionGround(_pal.primary, _pal.accent, SURF);
  const ACC = _pal.accent || _pal.primary || '#6A33D8';
  const ON_P = textOn(P, SURF, INKC), ON_ACC = textOn(ACC, SURF, INKC);
  const bClaims = Array.isArray(_b.claims) ? _b.claims.filter(Boolean) : [];
  let facts = regionFacts(entry.market);
  try { const bf = require('./brand-runtime.js').regionFacts(_b, entry.market); if (entry.brand && entry.brand.id && bf) facts = bf; } catch (_) {}
  const handle = entry.heroProduct?.handle || '';
  const shopUrl = `https://${facts.store}${handle ? `/products/${handle}` : ''}`;
  const cta = esc(L.cta || entry.cta || 'See more');
  const cur = facts.currency;
  const price = entry.heroProduct?.price;
  const priceLabel = price != null ? `${cur}${price}` : '';
  const faq = (L.faq || []).map((f) => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('');
  const bullets = (L.why_bullets || []).map((b) => `<li><span class="tick">✓</span>${esc(b)}</li>`).join('');
  // ── Proof is APPROVED-ONLY, unconditionally ───────────────────────────────
  // This used to be gated on env REAL_FACTS_ONLY, which ships OFF, so the
  // DEFAULT path rendered `L.proof_quote` / `L.proof_author` - a testimonial and
  // a customer name the LLM had just written - onto a page served to real
  // traffic at /lp/:id. An invented reviewer does not become acceptable because
  // a feature flag is unset, so the flag no longer decides this: the approved
  // library is the only source, for every deployment.
  //
  // And an absent review does not render as NOTHING. Silence is indistinguishable
  // from a design choice, so the reviewer cannot tell the page is missing its
  // proof. The spec's marker is printed in the proof slot instead, in a plainly
  // non-content band, so the gap travels with the page into the review console
  // and the launch gate.
  const _fk = entry.heroProduct?.sku || entry.heroProduct?.handle || entry.heroProduct?.title;
  const _appRating = (facts && (() => { try { return facts.approvedRating(_fk, entry.market); } catch (_) { return null; } })()) || null;
  const _appReviews = (facts && (() => { try { return facts.approvedReviews(_fk, entry.market) || []; } catch (_) { return []; } })()) || [];
  const _appClaims = (facts && (() => { try { return facts.approvedClaims(_fk, entry.market) || []; } catch (_) { return []; } })()) || [];
  // A star rating renders only from the approved library. The brand's own
  // verifiable claim is not a rating, so it stays in the trust strip as text.
  const trustStars = _appRating
    ? `<span>★★★★★ Rated ${esc(String(_appRating))}/5</span>`
    : (bClaims[0] ? `<span>${esc(bClaims[0])}</span>` : '');
  // The curated approved library first, then the brand's OWN published
  // testimonials read off its site (verbatim, with the source page recorded).
  const _siteReviews = Array.isArray(entry.__reviews) ? entry.__reviews : [];
  const _proofPool = [..._appReviews, ..._siteReviews];
  const _pr = _proofPool[0] || null;
  // Only a storage-hosted copy of the image is used; a source URL we could not
  // re-host is never hotlinked, and no other brand's picture is substituted.
  const _prShot = _pr && (Array.isArray(_pr.media) ? _pr.media : []).find((m) => m && m.hosted_url);
  const proofSection = _pr
    ? `<section class="sec proof"><div class="wrap">${_prShot ? `<img class="proofshot" src="${esc(_prShot.hosted_url)}" alt="${esc(`Customer photo published by ${bName}`)}">` : ''}<blockquote>“${esc(_pr.quote || '')}”</blockquote>${_pr.author ? `<p class="who">- ${esc(_pr.author)}</p>` : ''}</div></section>`
    : `<section class="sec datareq-band"><div class="wrap"><p class="datareq">${esc(proofMarker(entry))}</p></div></section>`;
  // A promise is rendered only where the brand actually states one - approved
  // per-SKU claims first, then the brand record's own verifiable claims.
  const _guaranteeRe = /guarantee|make it right|refund|return|free shipping/i;
  const _guaranteeText = _appClaims.find((c) => _guaranteeRe.test(String(c))) || bClaims.find((c) => _guaranteeRe.test(String(c))) || '';
  const guaranteeBlock = _guaranteeText
    ? `<div class="guarantee"><h3>Buy with confidence</h3><p style="margin:0;color:var(--ink-dim)">${esc(_guaranteeText)}</p></div>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(L.hero_headline || entry.heroProduct?.title || bName)}</title>
<style>
:root{--moss:${P};--moss-deep:${P};--moss-near:${P};--chalk:${SURF};--chalk-warm:${SURF2};--lava:${ACC};--ink:${INKC};--ink-dim:#4a4a4a;--on-moss:${ON_P};--on-lava:${ON_ACC};--head:${FONT_HEAD};--body:${FONT_BODY}}
*{box-sizing:border-box}
body{margin:0;background:var(--chalk);color:var(--ink);font-family:var(--body);line-height:1.6;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}
.bar{background:var(--moss-deep);color:var(--on-moss);text-align:center;font-size:13px;letter-spacing:.04em;padding:10px 16px}
.wrap{max-width:920px;margin:0 auto;padding:0 22px}
h1,h2,h3{font-family:var(--head);line-height:1.12;margin:0 0 14px}
.hero{background:var(--moss);color:var(--on-moss);text-align:center;padding:64px 22px 72px}
.hero .eyebrow{color:var(--on-moss);letter-spacing:.2em;text-transform:uppercase;font-size:12px;margin:0 0 18px}
.hero h1{font-size:40px;max-width:720px;margin:0 auto 16px}
.hero p{max-width:560px;margin:0 auto 28px;color:var(--on-moss)}
.btn{display:inline-block;background:var(--lava);color:var(--on-lava);font-weight:700;text-decoration:none;padding:16px 34px;border-radius:6px;border:0;cursor:pointer;font-size:16px}
.btn-dark{background:var(--moss);color:var(--on-moss)}
.trust{display:flex;flex-wrap:wrap;justify-content:center;gap:18px 30px;background:var(--chalk-warm);padding:18px 22px;font-size:13px;color:var(--ink-dim);text-align:center}
.sec{padding:54px 0}
.sec h2{font-size:30px}
.why li{list-style:none;margin:12px 0;padding-left:6px}
.tick{color:var(--moss);font-weight:800;margin-right:10px}
.why ul{padding:0;margin:0}
.reveal{background:#fff;border:1px solid #e7ddc6;border-radius:14px;padding:30px;display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between}
.reveal .price{font-family:var(--head);font-size:30px;color:var(--moss)}
.proof{background:var(--moss-near);color:var(--on-moss);text-align:center}
.proof blockquote{font-family:var(--head);font-size:26px;max-width:680px;margin:0 auto;line-height:1.35}
.proof .who{color:var(--lava);font-weight:700;margin-top:16px}
.proof .proofshot{width:140px;border-radius:12px;margin:0 auto 18px}
/* Missing approved proof is PRINTED, not silently dropped. Deliberately styled
   as a build note on a light surface (dark ink on chalk-warm, AA) so nobody can
   mistake it for customer-facing content, and so the reviewer sees the gap. */
.datareq-band{padding:26px 0}
.datareq{margin:0;text-align:center;font-family:var(--body);font-size:13px;line-height:1.5;color:var(--ink);background:var(--chalk-warm);border:1px dashed var(--ink-dim);border-radius:10px;padding:14px 18px}
.faq{border-top:1px solid rgba(171,135,67,.3);padding:14px 0}
.faq summary{font-weight:700;cursor:pointer;font-size:17px}
.faq p{color:var(--ink-dim);margin:10px 0 0}
.guarantee{background:var(--chalk-warm);text-align:center;border-radius:14px;padding:34px;margin:30px 0}
.sticky{position:sticky;bottom:0;background:#fff;border-top:1px solid #e7ddc6;display:flex;gap:14px;align-items:center;justify-content:space-between;padding:12px 22px;box-shadow:0 -6px 24px rgba(0,0,0,.08)}
.sticky .info{font-size:14px}.sticky .info b{display:block;font-family:var(--head);font-size:16px}
/* The footer was a near-black band (var(--ink) is #111111 for tenant zero),
   which the design rules forbid for any section. It is the brand primary now,
   with the contrast-adjusted on-primary text rather than a 60%-opacity cream
   that was only legible because the ground behind it was black. */
footer{background:var(--moss);color:var(--on-moss);text-align:center;padding:26px;font-size:12px}
@media(max-width:640px){.hero h1{font-size:30px}.sec h2{font-size:24px}.sticky .info .sub{display:none}}
</style></head>
<body>
<div class="bar">${esc(bName)} · ${esc(entry.market)}${bClaims[0] ? ` · ${esc(bClaims[0])}` : ''}</div>
<section class="hero">
  <!-- The eyebrow read "<cohort> edit" — so a landing page served to a real
       visitor announced the RFM bucket the business had put them in:
       "Hibernating edit", "At Risk edit", "Lost edit". The market is a place and
       is fine to say; the segment is an internal classification and is not. -->
  <p class="eyebrow">${esc(entry.market ? entry.market + ' edit' : 'Featured')}</p>
  <h1>${esc(L.hero_headline || entry.heroProduct?.title || bName)}</h1>
  <p>${esc(L.hero_sub || entry.rationale || '')}</p>
  <a class="btn" href="${esc(shopUrl)}">${cta}</a>
</section>
${creativeUrl ? `<img src="${esc(creativeUrl)}" alt="${esc(L.hero_headline || entry.heroProduct?.title || bName)}" style="width:100%;display:block;max-height:520px;object-fit:cover"/>` : ''}
<div class="trust">${trustStars}${bClaims.slice(1, 4).map((c) => `<span>${esc(c)}</span>`).join('')}</div>
<div class="wrap">
  <section class="sec why">
    <h2>${esc(L.why_title || 'Why this edit')}</h2>
    <ul>${bullets || `<li><span class="tick">✓</span>Selected from ${esc(bName)}'s own catalogue.</li>`}</ul>
  </section>
  <section class="sec">
    <div class="reveal">
      <div>
        <h3 style="margin:0 0 6px">${esc(entry.heroProduct?.title || 'The edit')}</h3>
        <p style="margin:0;color:var(--ink-dim)">${esc(entry.heroProduct?.category || (entry.offering && entry.offering.kind) || '')}</p>
      </div>
      <div style="text-align:right">
        ${priceLabel ? `<div class="price">${esc(priceLabel)}</div>` : ''}
        <a class="btn btn-dark" href="${esc(shopUrl)}">${cta}</a>
      </div>
    </div>
  </section>
</div>
${proofSection}
<div class="wrap">
  ${faq ? `<section class="sec"><h2>Questions, answered</h2>${faq}</section>` : ''}
  ${guaranteeBlock}
</div>
<div class="sticky">
  <div class="info"><b>${esc(entry.heroProduct?.title || bName)}</b><span class="sub">${esc(priceLabel)}</span></div>
  <a class="btn" href="${esc(shopUrl)}">${cta}</a>
</div>
<footer>© ${esc(bName)} · ${esc(entry.market)} · ${esc(campaignId)}</footer>
</body></html>`;
}

// Build the same mailer taxonomy as the Mailer Studio / Mailer Calendar: two
// named types, two variants each: 2 Text (colour + type + structural elements,
// no media) and 2 Text + Visual (with a hero image). Uses the shared
// renderTextVariant so look + quality match across features. Returns null if the
// shared renderer is unavailable (caller keeps the single local mailer).
// (An `emailPlaceholder()` used to sit here: an inline SVG stand-in drawn when
// no catalogue photo resolved. It was painted in tenant zero's palette -
// #6A33D8 border, #D0473E type - and it fired for exactly the brands that are
// NOT tenant zero, since they are the ones with no matching catalogue row. So
// the fallback for "we could not find this brand's photo" was another brand's
// colours, baked into a data: URI that email clients strip anyway. A slot with
// no approved image now renders image-free and reports the gap through
// campaign.data_gaps, which is the July mailer builder's rule.)
function variantMeta(copy) {
  const E = copy.email || {};
  return {
    subject_line: E.subject || '',
    subject_alts: [E.subject_alt1, E.subject_alt2].filter(Boolean),
    preview_text: E.preheader || '',
    hero_headline: E.hero_headline || E.subject || '',
    hero_subline: E.subheadline || E.preheader || '',
    cta_text: E.cta || 'Shop the edit',
  };
}
// Resolve real, always-clickable destinations for a slot (matches the flagship
// mailer's link logic): a per-market store, the hero product's PDP, and a
// category collection. Never emits a merge-tag literal, so every CTA in a
// preview/download redirects to a real page.
function slotLinks(entry) {
  // A non-tenant-zero brand's links come from ITS OWN record: its regional
  // store and the offering's own URL. Tenant zero keeps the catalogue-mapped
  // collection logic below.
  if (entry.brand && entry.brand.id && !/^knickgasm$/i.test(String(entry.brand.slug || ''))) {
    let f = null;
    try { f = require('./brand-runtime.js').regionFacts(entry.brand, entry.market); } catch (_) {}
    const bStore = f && f.store ? `https://${f.store}` : (entry.brand.website || '');
    const off = entry.heroOffering || entry.offering || {};
    const target = off.url || bStore;
    return { store: bStore || target, collectionUrl: target, pdpUrl: target };
  }
  const facts = regionFacts(entry.market);
  const store = `https://${facts.store || 'knickgasm.com'}`;
  const hp = entry.heroProduct || {};
  const cat = String(hp.category || hp.type || '').toLowerCase();
  const collectionSlug = /kicks/.test(cat) ? 'kicks-sneaker'
    : /green/.test(cat) ? 'green-sneaker'
    : /black/.test(cat) ? 'black-sneaker'
    : /themed|embroidery|streetwear|jacket|accessor/.test(cat) ? 'streetwear-sneaker'
    : 'all';
  const collectionUrl = `${store}/collections/${collectionSlug}`;
  // Every product CTA must land on a REAL product page. Prefer the
  // catalog-VALIDATED handle (handleFor checks the entry handle against the
  // built catalog, then title/keyword) so a stale/wrong handle can never produce
  // a dead PDP; only fall back to the raw entry handle if the catalog is absent.
  let handle = null;
  try { handle = catalogImage.handleFor(hp, entry.market, { brand: entry.brand }); } catch (_) { handle = null; }
  handle = handle || hp.handle || null;
  const pdp = handle ? `${store}/products/${handle}` : collectionUrl;
  return { store, collectionUrl, pdp, handle };
}
// Resolve a real PDP URL for ANY product (hero or supporting), always on the
// official per-market store, never fabricating a handle.
function productUrl(product, market, brand) {
  const facts = regionFacts(market);
  const store = `https://${facts.store || 'knickgasm.com'}`;
  let handle = null;
  try { handle = catalogImage.handleFor(product, market, { brand }); } catch (_) { handle = null; }
  handle = handle || (product && (product.handle || product.h)) || null;
  return handle ? `${store}/products/${handle}` : store;
}
function renderVariant(entry, copy, style, img) {
  const E = copy.email || {};
  const heroProduct = (entry.heroProduct && entry.heroProduct.title) || entry.theme || '';
  const links = slotLinks(entry);
  // Product grid is a Text + Visual element — only the visual variants carry it
  // (pure/editorial "Text" variants stay graphics-free per the taxonomy).
  const withGrid = style === 'visual';
  // Real HD gallery for the hero product (multiple genuine PDP shots).
  const heroGallery = (() => { try { return catalogImage.imagesFor(entry.heroProduct || entry, entry.market, { width: 900, brand: entry.brand }); } catch (_) { return []; } })();
  const heroImgUrl = img || heroGallery[0] || catalogImage.imageFor(entry, entry.market, { width: 900, brand: entry.brand }) || undefined;
  // The hero BAND already shows heroImgUrl; the hero product's GRID card must show
  // a DIFFERENT real photo of the same product so the same shot never appears twice
  // in one mailer. NOTE: heroImgUrl is resolved at width 1600 while heroGallery is
  // at 900 and hd() bakes ?width= into the URL, so a raw string compare never
  // matches (it would always return gallery[0] = the same photo). Compare on the
  // width/version-stripped BASE url instead. Only a single-photo product shares.
  const baseKey = (u) => String(u || '').replace(/[?&](width|v)=[^&]*/g, '');
  const heroCardImg = heroGallery.find((u) => baseKey(u) !== baseKey(heroImgUrl)) || heroGallery[1] || heroGallery[0] || heroImgUrl;
  // Grid = hero + any bundled supporting products, each with its OWN real HD photo
  // and real catalog content (subtitle / design notes), linking to its own real
  // product page (never a fabricated handle).
  const supporting = Array.isArray(entry.supportingProducts) ? entry.supportingProducts : [];
  const catRow = (p) => { try { return catalogImage.match({ handle: p.handle || p.h, title: p.title || p.n }, entry.market, { brand: entry.brand }); } catch (_) { return null; } };
  const products = withGrid && entry.heroProduct
    ? [
        { title: entry.heroProduct.title, handle: entry.heroProduct.handle, image: heroCardImg, price: entry.heroProduct.price, url: links.pdp, note: (catRow(entry.heroProduct) || {}).subtitle || (catRow(entry.heroProduct) || {}).tasting_notes || '' },
        ...supporting.map((p) => { const row = catRow(p) || {}; return { title: p.title, handle: p.handle, price: p.price, url: productUrl(p, entry.market, entry.brand), image: catalogImage.imagesFor(p, entry.market, { width: 900, brand: entry.brand })[0] || undefined, note: row.subtitle || row.tasting_notes || '' }; }),
      ]
    : undefined;
  // The shared renderer carries no proof slot, so the brand's REAL testimonials
  // (and, when there are none, the marker) are composed onto its output.
  return injectProofBlock(renderTextVariant({
    // The ACTIVE brand travels with the render options: the shared renderer
    // derives wordmark, store URL, claims and the legal sender block from it.
    brand: entry.brand || null,
    style, subject: E.subject, preheader: E.preheader,
    hero_headline: E.hero_headline || E.subject || heroProduct,
    hero_subline: E.subheadline || E.preheader || '',
    body_blocks: [
      E.intro_paragraph ? { heading: '', body: E.intro_paragraph } : null,
      E.body_paragraph ? { heading: '', body: E.body_paragraph } : null,
    ].filter(Boolean),
    // Real PDP/collection destinations (no merge-tag literal) so every CTA
    // redirects; matches the flagship mailer's link + grid logic.
    cta_text: E.cta || 'Shop the edit', cta_url: links.pdp,
    market: entry.market, hero_product: heroProduct, hero_image_url: img || undefined,
    products, collection_url: links.collectionUrl,
    offer_bar: (withGrid && (E.offer || (copy.landing && copy.landing.offer_bar))) || undefined,
  }), entry, style);
}
// Four variants in the SAME taxonomy as the Mailer Calendar: 2 Text + 2 Text +
// Visual, each labelled by its copy framework, with copyA driving the A-slots and
// copyB the B-slots so the two directions read genuinely differently.
function emailVariants(entry, copyA, copyB, fwA, fwB, creativeUrl) {
  if (!renderTextVariant) return null;
  const heroProduct = (entry.heroProduct && entry.heroProduct.title) || entry.theme || '';
  const heroImg = creativeUrl || catalogImage.imageFor(entry, entry.market, { brand: entry.brand }) || null;
  const nA = (fwA && fwA.name) || 'Concise';
  const nB = (fwB && fwB.name) || 'Editorial';
  return [
    { key: 'text_a',   type: 'Text',          label: `Text · ${nA}`,          framework: fwA && fwA.key, ...variantMeta(copyA), html: renderVariant(entry, copyA, 'pure') },
    { key: 'text_b',   type: 'Text',          label: `Text · ${nB}`,          framework: fwB && fwB.key, ...variantMeta(copyB), html: renderVariant(entry, copyB, 'editorial') },
    { key: 'visual_a', type: 'Text + Visual', label: `Text + Visual · ${nA}`, framework: fwA && fwA.key, ...variantMeta(copyA), html: renderVariant(entry, copyA, 'visual', heroImg) },
    { key: 'visual_b', type: 'Text + Visual', label: `Text + Visual · ${nB}`, framework: fwB && fwB.key, ...variantMeta(copyB), html: renderVariant(entry, copyB, 'visual', heroImg) },
  ];
}

function emailHtml(entry, copy, creativeUrl) {
  const E = copy.email;
  // Brand-derived: this renders for whichever brand owns the slot, so the
  // wordmark, palette, CTA and footer must come from its record, not a fixed
  // tenant's. (This path only runs when an LLM produced the copy, which is why
  // it survived the first sweep.)
  const b = (entry.brand && entry.brand.id) ? entry.brand
    : (() => { try { return require('./brand-runtime.js').scopedBrand(null); } catch (_) { return {}; } })();
  const bName = b.name || '';
  const pal = b.palette || {};
  const INK = pal.ink || '#111111';
  const SURF = pal.surface || '#FFFFFF';
  // Every band, the button and the footer on this mailer are painted ${P}, and
  // the last-resort literal here was #111111 - so a brand record with no
  // palette shipped a black email. The ground is guarded and the text on it is
  // derived rather than assumed to be the surface.
  const P = sectionGround(pal.primary, pal.accent, SURF);
  const ACC = pal.accent || pal.primary || P;
  const onP = textOn(P, SURF, INK);
  const onACC = textOn(ACC, SURF, INK);
  const img = creativeUrl || catalogImage.imageFor(entry, entry.market, { brand: entry.brand });
  const heroImg = img
    ? `<img src="${img}" alt="${String(E.hero_headline || entry.heroProduct?.title || bName).replace(/"/g, '')}" style="width:100%;display:block;max-height:440px;object-fit:cover"/>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${E.subject}</title></head>
<body style="margin:0;background:${SURF};color:${INK};font-family:${FONT_BODY}">
<main style="max-width:680px;margin:auto;background:${SURF}">
  <section style="background:${P};color:${onP};padding:44px 36px;text-align:center">
    <p style="letter-spacing:.18em;text-transform:uppercase;font-size:11px;margin:0 0 14px">${bName}</p>
    <h1 style="font-family:${FONT_HEAD};font-size:32px;line-height:1.15;margin:0">${E.hero_headline}</h1>
  </section>
  ${heroImg}
  <section style="padding:36px">
    <p style="line-height:1.7">${E.intro_paragraph}</p>
    <p style="line-height:1.7">${E.body_paragraph}</p>
    <p style="text-align:center;margin:32px 0 8px"><a href="${slotLinks(entry).pdp}" style="background:${ACC};color:${onACC};padding:15px 28px;text-decoration:none;border-radius:4px;font-weight:700;display:inline-block">${E.cta || entry.cta || 'See more'}</a></p>
  </section>
  ${proofBlockHtml(entry)}
  <footer style="background:${P};color:${onP};text-align:center;padding:22px;font-size:11px">You're receiving this as a ${bName} ${entry.cohort?.name || 'customer'} in ${entry.market}.</footer>
</main>
</body></html>`;
}

async function writeCopyWithLLM(entry, fw = null, brief = null) {
  const sysLine = fw ? (() => { try { return '\n' + CF.copyFrameworkSystemLine(fw); } catch (_) { return ''; } })() : '';
  // NOTE: do NOT pin preferProvider here. In llm.js a preferProvider SKIPS every
  // other provider, so pinning the strategy analyst's provider left copy
  // generation with no fallback — one hiccup on that provider failed the whole
  // mailer. Copy is critical, so it must run the FULL cascaded waterfall every
  // time (OpenAI -> Anthropic -> Gemini -> Grok -> Groq -> Cerebras).
  // Copy is critical, so make it resilient to a transient rate-limit STORM (the
  // free Gemini/Groq tiers can all 429 at once when Smart Brain fires many slots)
  // AND to a reasoning-model TRUNCATION of the big email+landing+ads JSON. Each
  // round re-runs the FULL premium->standard->fast waterfall; between rounds we
  // back off (so per-minute limits reset) and widen maxTokens (so the object has
  // more room to close). Only after every round fails do we surface the error that
  // drops the slot to template copy.
  // Bounded so the whole copy pipeline (this ×2 directions + optional brief) stays
  // well under the serverless function budget. 2 rounds with a short backoff; the
  // wider token budget on the retry lets a reasoning model close the JSON.
  const ROUNDS = [
    { maxTokens: 3600, waitBefore: 0 },
    { maxTokens: 4096, waitBefore: 1500 },
  ];
  let lastErr;
  for (let i = 0; i < ROUNDS.length; i++) {
    const r = ROUNDS[i];
    if (r.waitBefore) await new Promise((res) => setTimeout(res, r.waitBefore));
    let res;
    try {
      res = await callLLMTiered({
        systemPrompt: brandSystem(entry.brand) + sysLine,
        stage: 'mailer_full campaign content', feature: 'brain.campaign', workspaceId: (entry && entry.workspace_id) || null,
        userMessage: copyPrompt(entry, fw, brief),
        responseFormat: { type: 'json_object' },
        maxTokens: r.maxTokens,
        temperature: 0.75,
        timeoutMs: 20000,
        stage: 'smart-brain-copy',
        tier: 'premium',
      });
    } catch (e) {
      // Whole waterfall threw (every provider rate-limited/failed this round).
      lastErr = new Error('no LLM provider returned copy (all text keys missing or quota-exhausted for this deployment)');
      continue; // back off + retry the waterfall
    }
    let json = null;
    try { json = parseJSON(res.text); } catch (_) { json = null; }
    if (json && json.email && json.landing && json.ads) {
      return { copy: json, provider: res.provider, model: res.model };
    }
    // Non-empty but incomplete/unparseable (usually a reasoning model truncating
    // the big JSON). Retry with more room / a fresh roll of the waterfall.
    const empty = !res.text || !String(res.text).trim();
    lastErr = new Error(empty
      ? 'no LLM provider returned copy (all text keys missing or quota-exhausted for this deployment)'
      : `LLM copy JSON incomplete from ${res.provider || 'provider'} (reply was ${String(res.text).length} chars)`);
  }
  throw lastErr || new Error('copy generation failed');
}

// Deep brand scrub of an LLM copy object: every string through sanitizeBrand
// (banned phrases → preferred lexicon, em/en dashes → hyphens). Safe no-op if
// sanitizeBrand is unavailable.
function scrubCopyDeep(o) {
  const clean = (s) => { try { return SM.sanitizeBrand(String(s)); } catch (_) { return s; } };
  const walk = (v) => {
    if (typeof v === 'string') return clean(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(o || {});
}

/**
 * Drop every proof value the model produced that no approved source stands
 * behind, and record the gap.
 *
 * The prompt now asks for empty proof fields, but a prompt is a request, not a
 * guarantee: models fill shapes. This is the structural half - whatever comes
 * back, only a value that MATCHES the approved library survives into the copy
 * object that gets rendered, persisted, previewed and downloaded. A rating is
 * kept only if it equals the approved rating; a review only if its quote is in
 * the approved list; a badge only if it is one of the brand's own verifiable
 * claims. Everything else is replaced by the spec's marker on `__proof_gap`,
 * which the renderers print.
 */
function gateProof(copy, entry) {
  const c = copy && typeof copy === 'object' ? copy : {};
  const p = approvedProof(entry);
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const approvedQuotes = new Set(p.reviews.map((r) => norm(r && r.quote)));
  const approvedClaims = new Set(p.claims.map(norm));
  const E = c.email && typeof c.email === 'object' ? c.email : null;
  const L = c.landing && typeof c.landing === 'object' ? c.landing : null;
  const dropped = [];
  if (E) {
    const ratingVal = E.rating && typeof E.rating === 'object' ? E.rating.value : E.rating;
    if (ratingVal != null && String(ratingVal) !== '' && !(p.rating != null && Number(ratingVal) === Number(p.rating))) { E.rating = null; dropped.push('rating'); }
    if (Array.isArray(E.reviews)) {
      const kept = E.reviews.filter((r) => r && approvedQuotes.has(norm(r.quote)));
      if (kept.length !== E.reviews.length) dropped.push('reviews');
      E.reviews = kept;
    } else if (E.reviews) { E.reviews = []; dropped.push('reviews'); }
    if (Array.isArray(E.badges)) {
      const kept = E.badges.filter((b) => approvedClaims.has(norm(b)));
      if (kept.length !== E.badges.filter(Boolean).length) dropped.push('badges');
      E.badges = kept;
    }
    if (E.guarantee && !approvedClaims.has(norm(E.guarantee))) { E.guarantee = ''; dropped.push('guarantee'); }
  }
  if (L) {
    if (L.proof_quote && !approvedQuotes.has(norm(L.proof_quote))) { L.proof_quote = ''; L.proof_author = ''; dropped.push('proof_quote'); }
    if (L.proof_author && !L.proof_quote) { L.proof_author = ''; }
  }
  if (dropped.length) c.__proof_gap = { marker: proofMarker(entry), dropped: [...new Set(dropped)] };
  return c;
}

/**
 * Give a VIDEO ad an artefact that actually exists.
 *
 * Before this, a video ad was a storyboard and a script and nothing else, and
 * the console drew a play triangle on a gradient over it. That triangle is a
 * picture of a video, not a video: the reviewer approves something they have
 * never seen, and nothing they saw is what ships.
 *
 * What this deployment can genuinely produce is built here:
 *   creative.motion_html   a SELF-CONTAINED animated 9:16 creative built from
 *                          the storyboard beats over this brand's own REAL
 *                          catalogue photographs, in this brand's palette and
 *                          type. This is a real artefact - it renders, it is
 *                          downloadable, and it is the exact bytes the console
 *                          previews.
 *   creative.motion_brief  the same motion design as a shot-by-shot brief, so
 *                          the MP4 an editor or generator produces matches the
 *                          thing that was approved.
 *   creative.video         the state of the actual MP4. `video-core` cascades
 *                          Veo/Sora/Higgsfield/Runway; with no key set it
 *                          reports not-connected, and we record THAT rather
 *                          than implying a file exists.
 *
 * Nothing here fabricates: with no real photo for this brand the scenes carry
 * headline-only cards, and the audio bed comes from video-core's licensing rule
 * (another tenant's bed is never lent out).
 */
function attachMotionCreative(ad, entry, pool) {
  try {
    const motion = require('../../scripts/lib/motion-ad.js');
    const brand = (entry && entry.brand && entry.brand.id) ? entry.brand : null;
    const images = (Array.isArray(pool) ? pool : []).filter(Boolean);
    const beats = (Array.isArray(ad.storyboard) && ad.storyboard.length ? ad.storyboard : [])
      .slice(0, 4)
      .map((s, i) => ({
        image: images.length ? images[i % images.length] : '',
        headline: String((s && (s.scene || s.shot)) || '').slice(0, 90),
        sub: String(s && s.t ? s.t : ''),
        seconds: 2.6,
      }));
    const scenes = beats.length ? beats : [{
      image: images[0] || '',
      headline: String(ad.hook || ad.headline || (entry.heroProduct && entry.heroProduct.title) || '').slice(0, 90),
      seconds: 2.6,
    }];
    // Audio follows the licensing rule in video-core: a brand with no bed of its
    // own gets silence and a marker, never another tenant's recording.
    let audio = null;
    try {
      const vc = require('./video-core.js');
      audio = vc.audioBedFor(Number(ad.duration_s) || 15, { brand });
    } catch (_) { audio = null; }
    const spec = {
      brand,
      product: (entry.heroProduct && entry.heroProduct.title) || '',
      scenes,
      cta: ad.cta || entry.cta || 'Shop now',
      ctaHeadline: ad.headline || ad.hook || '',
      audio: (audio && audio.bed) ? audio.bed : false,
      loop: true,
    };
    ad.creative = Object.assign({}, ad.creative, {
      motion_html: motion.renderMotionAd(spec),
      motion_brief: motion.motionBrief(spec),
      // The real MP4 is a separate, and currently absent, thing. Say so.
      video: videoStatus(),
      audio: audio || null,
      images_used: scenes.map((s) => s.image).filter(Boolean),
      provider: ad.creative && ad.creative.provider ? ad.creative.provider : (images.length ? 'catalog' : null),
    });
    if (!images.length) {
      ad.creative.data_gap = (() => { try { return catalogImage.marker(entry.heroProduct || {}, entry.market); } catch (_) { return '[DATA REQUIRED BEFORE LAUNCH: product image, hero product, ' + (entry.market || 'all') + ']'; } })();
    }
  } catch (e) {
    // A motion build must never take a campaign down; the console then shows the
    // storyboard with an explicit "no artefact" note rather than a fake player.
    ad.creative = Object.assign({}, ad.creative, { motion_error: String((e && e.message) || e).slice(0, 160), video: videoStatus() });
  }
}

/** Whether a real MP4 can be produced by THIS deployment, without pretending. */
function videoStatus() {
  try {
    const vc = require('./video-core.js');
    if (vc.isConnected()) return { rendered: false, provider_connected: true, note: 'A video provider is configured. The MP4 is generated on demand, not during the campaign build; the animated creative below is the approved motion design.' };
    return { rendered: false, provider_connected: false, note: 'No video provider is configured for this deployment (GEMINI/OPENAI/HIGGSFIELD/OPENMONTAGE/RUNWAY key), so no MP4 exists. The animated creative below is the real, shippable artefact and the brief reproduces it as video.' };
  } catch (_) {
    return { rendered: false, provider_connected: false, note: 'No video provider is reachable, so no MP4 exists.' };
  }
}

function applyCopy(campaign, entry, copyA, copyB, fwA, fwB, creatives = {}, runId = null) {
  const briefFor = (copy, k) => ({ brief: (k && copy.ads?.[k]?.image_brief) || '', image: null, provider: null });
  // Distinct real gallery pool for this slot (hero product + supporting), HD.
  // B-variants draw an ALTERNATE real photo (not the email hero) so the A/B
  // pair is visually distinct while every image stays a real catalog shot.
  const pool = realImagePool(entry, 1400);
  const heroReal = pool[0] || catalogImage.imageFor(entry, entry.market, { width: 1400, brand: entry.brand }) || null;
  const altReal = pool.find((u) => u !== heroReal) || heroReal;
  if (campaign.assets.email) {
    campaign.assets.email.subject = copyA.email.subject || campaign.assets.email.subject;
    campaign.assets.email.preheader = copyA.email.preheader || campaign.assets.email.preheader;
    campaign.assets.email.creative = creatives.email || { brief: copyA.email.image_brief || '', image: null, provider: null };
    const heroImg = campaign.assets.email.creative.image;
    // Four framework variants: copyA drives the A-slots, copyB the B-slots.
    const emailVars = emailVariants(entry, copyA, copyB, fwA, fwB, heroImg);
    campaign.assets.email.variants = emailVars || null;
    // Primary html = the Hero Text + Visual (A) variant (shared renderer) so the
    // preview matches the Studio; falls back to the local mailer if variants off.
    campaign.assets.email.html = (emailVars && emailVars.find((v) => v.key === 'visual_a').html)
      || emailHtml(entry, copyA, heroImg);
    campaign.assets.email.text = `${copyA.email.subject}\n${copyA.email.preheader}\n\n${copyA.email.intro_paragraph}\n\n${copyA.email.body_paragraph}\n\n${copyA.email.cta}: {{landing_page_url}}`;
  }
  (campaign.assets.landing_pages || []).forEach((lp) => {
    const isB = lp.variant === 'B';
    // A and B are BOTH real LLM copy, written under different frameworks, so the
    // pair genuinely differs (no more mechanical "The ritual behind …"). A leads
    // with the generated hero image, B with the real catalog product photo.
    const copy = isB ? copyB : copyA;
    const img = isB
      ? (altReal || (creatives.landing && creatives.landing.image) || null)
      : ((creatives.landing && creatives.landing.image) || heroReal || null);
    lp.title = (copy.landing && copy.landing.hero_headline) || lp.title;
    lp.creative = { brief: (copy.landing && copy.landing.image_brief) || '', image: img, provider: isB ? 'catalog' : ((creatives.landing && creatives.landing.provider) || 'catalog') };
    lp.html = lpHtml(entry, copy, campaign.campaign_id, img);
    lp.path = isB ? `/lp/${campaign.campaign_id}?v=b` : `/lp/${campaign.campaign_id}`;
  });
  for (const ad of campaign.assets.ads || []) {
    const isB = ad.variant === 'B';
    // BOTH variants take real LLM copy now: A from copyA, B from copyB (the two
    // framework directions). No static template strings repeated across slots.
    const copy = isB ? copyB : copyA;
    if (ad.platform === 'meta' && copy.ads.meta) Object.assign(ad, { primary_text: copy.ads.meta.primary_text || ad.primary_text, headline: copy.ads.meta.headline || ad.headline, description: copy.ads.meta.description || ad.description });
    if (ad.platform === 'google' && copy.ads.google) Object.assign(ad, { headlines: copy.ads.google.headlines?.filter(Boolean) || ad.headlines, descriptions: copy.ads.google.descriptions?.filter(Boolean) || ad.descriptions });
    if (ad.platform === 'tiktok' && copy.ads.tiktok) Object.assign(ad, { script: copy.ads.tiktok.script || ad.script, caption: copy.ads.tiktok.caption || ad.caption });
    // Per-AD creative (see generateCreatives): the static and the video of one
    // platform are two different ads and no longer share one photo, and youtube
    // and pinterest are no longer unkeyed and imageless. `<platform>` is still
    // accepted as a fallback so a persisted bundle built before this change
    // still resolves.
    const adKey = `${ad.platform}:${ad.creative_type}`;
    if (isB) {
      const catImg = altReal;
      ad.creative = catImg ? { brief: ad.creative_brief || '', image: catImg, provider: 'catalog' } : (creatives[adKey] || creatives[ad.platform] || briefFor(copy, ad.platform));
    } else {
      ad.creative = creatives[adKey] || creatives[ad.platform] || briefFor(copy, ad.platform);
    }
    ad.creative_brief = ad.creative.brief || ad.creative_brief || '';
    // A VIDEO ad now carries a real, renderable artefact.
    if (ad.creative_type === 'video') attachMotionCreative(ad, entry, pool);
  }
  // NOTE: this used to read `__run`, which is declared inside _buildCampaign(),
  // not here. Referencing it threw a ReferenceError on the LAST line of every
  // successful copy application - after the mutations had landed, so the assets
  // were fine, but the throw was swallowed by _buildCampaign's catch. Every run
  // therefore reported `copywriter.provider: 'template-fallback'`, creatives
  // 'none', a red "fallback" pill instead of the Design Integrator step, and the
  // console's "no LLM provider answered" banner - on campaigns whose copy an LLM
  // had in fact just written. The run id is passed in now.
  traceRun(runId || _runId(entry), 'build:done', { slot: entry && entry.id, assets: (function(){ try { return Object.keys(campaign && campaign.assets || {}).join(','); } catch(_) { return ''; } })() });

  return campaign;
}

/**
 * Judge every finished asset against the contract for ITS OWN type.
 *
 * asset-specs.js has always held the real limits, and exactly one file read it:
 * master-prompt.js, which pastes it into a prompt. So the rules reached the
 * model as a suggestion and nothing ever checked the artefact that came back. A
 * Google headline three characters over the limit was discovered by Google.
 *
 * This runs AFTER the assets are built, attaches the verdict to each one, and
 * summarises on the campaign. It does not mutate copy: silently truncating to
 * fit is how a sentence becomes a fragment nobody wrote. The operator sees what
 * is wrong and with which rule.
 */
function checkAssetContracts(campaign) {
  const contracts = require('./asset-contracts.js');
  const summary = { checked: 0, blocking: 0, warnings: 0, by_contract: {}, violations: [] };

  const judge = (asset, label) => {
    if (!asset) return;
    const verdict = contracts.check(asset);
    asset.contract_check = verdict;
    if (!verdict.contract) return;             // nothing governs this type yet
    summary.checked += 1;
    summary.by_contract[verdict.contract] = (summary.by_contract[verdict.contract] || 0) + 1;
    for (const v of verdict.violations) {
      if (v.level === 'block') summary.blocking += 1; else summary.warnings += 1;
      summary.violations.push({ asset: label, contract: verdict.contract, ...v });
    }
  };

  judge(campaign.assets && campaign.assets.email, 'email');
  ((campaign.assets && campaign.assets.ads) || []).forEach((ad, i) =>
    judge(ad, `ad:${ad.platform}:${ad.creative_type || 'static'}:${ad.variant || 'A'}#${i}`));
  ((campaign.assets && campaign.assets.landing_pages) || []).forEach((lp, i) =>
    judge(lp, `landing:${lp.variant || 'A'}#${i}`));

  campaign.contract_check = summary;
  return summary;
}

// ── Master prompts (portable, copy-anywhere) ────────────────────────────────
// Attach a self-contained master_prompt to every generated asset so a human can
// reproduce/upgrade it in a blank ChatGPT/Claude/Gemini session.
function attachMasterPrompts(campaign, entry) {
  const market = entry.market;
  const cohort = entry.cohort?.name || '';
  const brief = entry.rationale || entry.objective || '';
  const products = entry.heroProduct ? [entry.heroProduct] : [];
  // The brand this campaign is FOR. Without it every prompt was built from
  // tenant zero, so a mailer generated inside another workspace carried that
  // brand's palette, voice, claims and logo - the asset looked like the wrong
  // company. entry.brand is stamped when the slot is planned; fall back to the
  // campaign's own brand before ever falling back to the default.
  const brand = entry.brand || campaign.brand || null;
  const base = { brand, market, cohort, brief, products };
  if (campaign.assets.email) {
    // Both mailer variants the operator requires, per region.
    campaign.assets.email.master_prompt_v1 = buildMasterPrompt({ ...base, assetType: 'mailer', variant: 'V1' });
    campaign.assets.email.master_prompt_v2 = buildMasterPrompt({ ...base, assetType: 'mailer', variant: 'V2' });
    campaign.assets.email.master_prompt = campaign.assets.email.master_prompt_v2;
    campaign.assets.email.prompts = promptsFor(campaign.assets.email, 'mailer');
  }
  for (const lp of campaign.assets.landing_pages || []) {
    lp.master_prompt = buildMasterPrompt({ ...base, assetType: 'landing_page' });
    lp.prompts = promptsFor(lp, 'landing_page');
  }
  for (const ad of campaign.assets.ads || []) {
    ad.master_prompt = buildMasterPrompt({ ...base, assetType: 'ad', platform: ad.platform });
    // The index that stops an image brief being copied as if it were the ad.
    // Built AFTER master_prompt exists, or the asset row has nothing to point at.
    ad.prompts = promptsFor(ad, 'ad');
  }
  return campaign;
}

// ── Creative image generation (reuses the /api/ai/image.js provider cascade) ─

// Invoke the existing image handler in-process via a mock res object, so we get
// the full Gemini → OpenAI → free-Pollinations cascade without an HTTP hop.
async function generateCreativeImage(prompt, { size = '1024x1024', mode = '' } = {}) {
  if (!prompt || !String(prompt).trim()) return null;
  let handler;
  try { handler = require('../ai/image.js'); } catch (_) { return null; }
  return await new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const res = {
      setHeader() {}, status() { return res; }, end() { done(null); return res; },
      json(obj) { done(obj && obj.image_data_url ? { image: obj.image_data_url, provider: obj.provider, model: obj.model } : null); return res; },
    };
    const req = { method: 'POST', body: { prompt: String(prompt).slice(0, 1800), size, quality: 'high', mode } };
    Promise.resolve().then(() => handler(req, res)).catch(() => done(null));
    setTimeout(() => done(null), 60000);
  });
}

// Upload a base64 data-URL creative to the public Supabase Storage bucket and
// return its hosted URL (so we persist a small URL, not a multi-MB data-URL).
// Returns null if it's not a data-URL or storage isn't configured — callers then
// keep the inline data-URL, so creatives still work with no storage set up.
async function uploadCreative(dataUrl, name) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  let supa;
  try { supa = require('./supa.js'); } catch (_) { return null; }
  try {
    const ext = m[1].includes('png') ? 'png' : m[1].includes('webp') ? 'webp' : 'jpg';
    const safe = String(name || 'creative').replace(/[^a-z0-9-]/gi, '_').slice(0, 60);
    const path = `${safe}-${Date.now().toString(36)}.${ext}`;
    const { public_url } = await supa.uploadObject('smart-brain-creatives', path, Buffer.from(m[2], 'base64'), m[1]);
    return public_url || null;
  } catch (_) { return null; }
}

// One creative per asset, generated in parallel. Each → {brief, image, provider};
// the image is a hosted Supabase URL when storage is configured, else an inline
// data-URL; falls back to brief-only (image:null) if generation fails.
// Build the DISTINCT real-image pool for a slot: the hero product's own PDP
// gallery (multiple real shots of the SAME product), then each supporting
// product's real photos — all hosted Shopify CDN, HD-boosted, de-duplicated,
// in catalog order. This is the single source every channel draws from so no
// two sections ever repeat one photo. Never fabricates a URL.
function realImagePool(entry, width = 1600) {
  const market = entry.market;
  const urls = [];
  const push = (arr) => { for (const u of arr || []) if (u && !urls.includes(u)) urls.push(u); };
  try { push(catalogImage.imagesFor(entry.heroProduct || entry, market, { width, brand: entry.brand })); } catch (_) {}
  const supporting = Array.isArray(entry.supportingProducts) ? entry.supportingProducts : [];
  for (const p of supporting) { try { push(catalogImage.imagesFor(p, market, { width, brand: entry.brand })); } catch (_) {} }
  return urls;
}

async function generateCreatives(copy, entry, { only = null, lean = false, adPlatforms = null } = {}) { // eslint-disable-line no-unused-vars
  // HARD RULE (product owner): every product / brand image MUST be REAL — the
  // actual packet, box or pack shot from the Shopify catalog (the PDP gallery),
  // in HD. Diffusion is NEVER used for product creatives: image models cannot
  // spell, so they fabricate garbled fake labels and invented boxes (the bug the
  // owner flagged). Real ad/email/LP copy lives as native text in the platform
  // fields and HTML layout, not baked into pixels. Each channel is assigned a
  // DISTINCT real photo (rotated across the hero product's gallery + supporting
  // products) so the same shot never repeats across the funnel. A channel with
  // no real photo left ships image-free (image:null) — we never invent one.
  // Keyed per AD, not per platform. buildAdAssets() ships a Static AND a Video
  // for meta, google, youtube and tiktok (eight ads), but this map only ever had
  // five keys: three platforms plus email and landing. So `creatives[ad.platform]`
  // handed the static and the video of one platform the SAME photo, and the
  // youtube and pinterest ads matched no key at all and shipped with no image.
  // The key is now `<platform>:<creative_type>`, and every ad the campaign
  // actually contains gets its own entry and therefore its own distinct photo.
  const adKeys = (adPlatforms || []).map((a) => [`${a.platform}:${a.creative_type}`, copy.ads?.[a.platform]?.image_brief]);
  const specs = [
    ['email',   copy.email?.image_brief],
    ['landing', copy.landing?.image_brief],
    ...adKeys,
  ];
  // `only` limits which creatives are built (preview passes ['email']).
  const activeSpecs = Array.isArray(only) ? specs.filter(([key]) => only.includes(key)) : specs;
  const pool = realImagePool(entry, 1600);
  const out = {};
  activeSpecs.forEach(([key, rawBrief], i) => {
    const b = (rawBrief && String(rawBrief).trim()) || `${(entry.brand && entry.brand.name) || 'Brand'} ${entry.heroProduct?.title || 'catalogue item'} — real product photograph, on this brand's own palette.`;
    const image = pool.length ? pool[i % pool.length] : null;
    out[key] = { brief: b, image, provider: image ? 'catalog' : null };
  });
  return out;
}

// ── Funnel build (shared by preview + approve) ──────────────────────────────

// Build the full funnel for a slot — template skeleton (GenerationService) plus
// LLM-written copy applied to the email + landing page + ads. Pure: it does NOT
// touch the DB or change any slot's status. Both previewEntry() and approveEntry()
// call this so a reviewer sees EXACTLY what approving will produce.
/**
 * Resolve the brand this entry belongs to and stamp it onto the entry, so every
 * downstream prompt and renderer builds from the RIGHT brand.
 *
 * Server-side generation runs without a user token, so it cannot use the
 * RLS-protected brand router. It resolves through the entry's workspace with
 * the service-role key instead. If no brand can be resolved the entry is left
 * unstamped and the prompt builder falls back to tenant zero - which is only
 * correct when tenant zero IS the workspace, so the caller logs it.
 */
async function stampBrand(entry, config) {
  if (!entry || entry.brand) return entry;
  try {
    const wsScope = require('./workspace-scope.js');
    const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    if (!url || !key) return entry;
    const env = { url, key };
    const wsId = entry.workspace_id || (config && config.workspace_id) || await wsScope.defaultWorkspaceId(env);
    const brand = await wsScope.brandForWorkspace(env, wsId);
    if (brand) entry.brand = brand;
    else try { console.warn(`[smart-brain] no brand resolved for workspace ${wsId}; prompts will use the default brand`); } catch (_) {}
  } catch (_) { /* never fail a generation on brand lookup */ }
  return entry;
}

// ── Run tracing ──────────────────────────────────────────────────────────────
// One id threaded through a whole generation so strategy, content and assets
// can be correlated in the logs. Today's stale-prebuilt puzzle took far longer
// than it should have because nothing tied those stages together per brand.
function _runId(entry) {
  const base = `${(entry && entry.id) || 'slot'}_${Date.now().toString(36)}`;
  return base.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 48);
}
function traceRun(run, stage, fields) {
  try {
    console.log(JSON.stringify(Object.assign({
      at: new Date().toISOString(), run, stage, mod: 'smart-brain',
    }, fields || {})));
  } catch (_) { /* logging must never break a generation */ }
}

/**
 * The catalogue this slot may draw imagery and product facts from, pinned to
 * the whole build.
 *
 * `stampBrand` puts the resolved brand on the entry, but the renderers below are
 * synchronous and a workspace's own catalogue lives in Postgres, so the read
 * happens ONCE here and travels with the build via AsyncLocalStorage. Every
 * catalogImage lookup inside then answers from this brand's rows - or from
 * nothing, which is the correct answer for a brand that has not imported a
 * catalogue. Nothing falls back to the shipped tenant-zero files.
 */
async function buildCampaign(entry, config, opts = {}) {
  await stampBrand(entry, config);
  // Proof BEFORE copy: the copywriter is handed the brand's real testimonials to
  // quote verbatim, instead of being handed an example rating to complete.
  await loadBrandReviews(entry, config);
  const catalogCtx = {
    brand: (entry && entry.brand) || null,
    workspaceId: (entry && entry.workspace_id) || (config && config.workspace_id) || null,
  };
  return catalogServer.withCatalog(catalogCtx, () => _buildCampaign(entry, config, opts));
}

async function _buildCampaign(entry, config, { id = null, withCreatives = true, noLLM = false } = {}) {
  const __run = _runId(entry);
  traceRun(__run, 'build:start', {
    slot: entry && entry.id, date: entry && entry.date, market: entry && entry.market,
    brand: (entry && entry.brand && entry.brand.name) || null,
    workspace: (config && config.workspace_id) || null,
    offering: (entry && entry.offering && entry.offering.kind) || null,
    catalog: catalogServer.currentScope() ? catalogServer.currentScope().source : 'unscoped',
    withCreatives, noLLM,
  });

  // Review-recovery slots are a review INVITATION, not a promo: email-only, no
  // offer, no ads/landing page, CTA to the product's own review section. Render
  // the dedicated brand-compliant template directly (no LLM promo pipeline).
  if (reviewRecovery && (entry.objective === 'review_recovery' || entry.review_recovery)) {
    const product = entry.heroProduct || {};
    const html = reviewRecovery.reviewMailerHtml(product, entry.market, entry.brand || null);
    const subject = `A quick word on your ${product.title || 'recent order'}?`;
    return {
      campaign_id: id || `review_${entry.id || entry.date}`,
      calendar_entry_id: entry.id || id || null,
      objective: 'review_recovery',
      copywriter: { provider: 'review-recovery-template', model: null, creatives: 'catalog', frameworks: ['review-invitation'] },
      agent_trace: [{ agent: 'Review Recovery', role: 'Lifecycle / Reputation', ok: true, output: { product: product.title, rating: entry.product_rating, threshold: reviewRecovery.THRESHOLD } }],
      assets: {
        email: { subject, preheader: 'Rating plus a line, before the next pair.', html, variants: null, creative: { brief: '', image: null, provider: 'catalog' } },
        ads: [],
        landing_pages: [],
      },
    };
  }
  const campaign = new GenerationService(config).generate(entry);
  let copyMeta = { provider: 'template-fallback', model: null, creatives: 'none' };
  // Agent pipeline trace, surfaced in the console so the reviewer sees which
  // specialist agent produced each part of the mailer.
  const trace = [];
  // noLLM: skip the whole LLM copy/creative pipeline and ship the deterministic
  // template campaign GenerationService already built (real catalog data, brand
  // palette, servable LP html). Used by the orphan-heal path so pages can be
  // republished fast + offline when providers are rate-limited / keys are unset.
  if (!noLLM) try {
    // ── Agent 1 · Strategy Analyst — a growth-strategy brief for THIS send.
    // OPTIONAL enrichment: it seeds the copy with an angle/differentiator, but the
    // copy writer runs fine without it. So it is NON-BLOCKING and only appears in
    // the pipeline trace when it SUCCEEDS — a failed optional brief no longer
    // shows an alarming ⚠ pill (the copy step is what actually matters).
    const sb = await strategyBrief(entry);
    const brief = sb ? { ...sb.brief, __provider: sb.provider } : null;
    if (sb) trace.push({ agent: 'Strategy Analyst', role: 'Head of Growth Strategy', ok: true, provider: sb.provider, output: { angle: sb.brief.angle, differentiator: sb.brief.differentiator, emotion: sb.brief.target_emotion } });

    // ── Agent 2 · Content Writer — two diverging copy frameworks (A/B), written
    // in parallel (same wall-clock as one call), each following the brief.
    const fwA = CF.pickCopyFramework({ play_key: entry.objective || '', cohort_key: (entry.cohort && (entry.cohort.key || entry.cohort.name)) || '', seed: entry.id || entry.date || '' });
    const otherKeys = Object.keys(CF.COPY_FRAMEWORKS).filter((k) => k !== fwA.key);
    const fwB = CF.frameworkByKey(otherKeys[CF.stableIndex(`${entry.id || entry.date || ''}|b`, otherKeys.length)]) || fwA;
    // Stagger the two copy directions by ~600ms so they don't hit the same
    // provider's per-minute limit in the exact same instant (reduces burst-429s).
    const [pA, pB] = await Promise.allSettled([
      writeCopyWithLLM(entry, fwA, brief),
      (async () => { await new Promise((r) => setTimeout(r, 600)); return writeCopyWithLLM(entry, fwB, brief); })(),
    ]);
    if (pA.status !== 'fulfilled' && pB.status !== 'fulfilled') {
      throw new Error('copy generation failed for both directions: ' + String((pA.reason && pA.reason.message) || pA.reason));
    }
    const rawA = pA.status === 'fulfilled' ? pA.value : pB.value;
    const rawB = pB.status === 'fulfilled' ? pB.value : pA.value;
    const provider = rawA.provider || rawB.provider;
    const model = rawA.model || rawB.model;
    trace.push({ agent: 'Content Writer', role: 'Lifecycle Copywriter', ok: true, provider, output: { frameworks: [fwA.key, fwB.key] } });
    // Brand scrub EVERY generated string (no banned phrases, no em/en dashes)
    // before it is baked into the mailer, landing page and ad rows. Persisted +
    // customer-served output must not rely on the prompt alone.
    // …then the PROOF gate: any rating, review, reviewer, badge or guarantee the
    // model produced without an approved source behind it is removed here, not
    // merely discouraged in the prompt.
    const copyA = gateProof(scrubCopyDeep(rawA.copy), entry);
    const copyB = gateProof(scrubCopyDeep(rawB.copy), entry);
    const proofGap = copyA.__proof_gap || copyB.__proof_gap || null;
    if (proofGap) {
      campaign.data_gaps = [...new Set([...(Array.isArray(campaign.data_gaps) ? campaign.data_gaps : []), proofGap.marker])];
      trace.push({ agent: 'Proof Gate', role: 'Approved Facts', ok: false, provider: 'approved-library', output: { dropped: proofGap.dropped, marker: proofGap.marker } });
    }
    // ── Agent 3 · Asset Director — one text-free creative per asset, turn by turn.
    // withCreatives: true = full 5-asset build; 'lean' = every channel but only
    // the email hero is diffused (others take the catalog photo — fast + reliable
    // for on-demand approve); 'hero' = email hero only (fast, for on-demand
    // preview); false = none (copy + layout only).
    const creativeOpts = withCreatives === 'hero' ? { only: ['email'] }
      : withCreatives === 'lean' ? { lean: true }
      : {};
    // Name every ad the campaign actually contains, so each gets its own photo
    // (see generateCreatives — youtube and pinterest used to get none at all).
    creativeOpts.adPlatforms = (campaign.assets.ads || []).map((a) => ({ platform: a.platform, creative_type: a.creative_type }));
    const creatives = withCreatives ? await generateCreatives(copyA, entry, creativeOpts) : {};
    const imgProviders = [...new Set(Object.values(creatives).map((c) => c && c.provider).filter(Boolean))];
    if (withCreatives) trace.push({ agent: 'Asset Director', role: 'Creative / Art Direction', ok: imgProviders.length > 0, provider: imgProviders.join(',') || null, output: { assets: Object.keys(creatives).length } });
    // ── Agent 4 · Design Integrator — assembles each variant in the layout the
    // decision engine chose for this send's intent/theme (so every mailer differs).
    applyCopy(campaign, entry, copyA, copyB, fwA, fwB, creatives, __run);
    trace.push({ agent: 'Design Integrator', role: 'Mailer Designer', ok: true, output: { archetype: (entry.decision && entry.decision.design && entry.decision.design.archetype) || 'hero-spotlight', variants: '2 Text + 2 Text + Visual' } });
    copyMeta = { provider, model, frameworks: [fwA.key, fwB.key], creatives: imgProviders.length ? imgProviders.join(',') : 'briefs-only' };
  } catch (e) {
    console.warn('[smart-brain] LLM copy failed, using template assets:', e.message);
    trace.push({ agent: 'fallback', role: 'template assets', ok: false, output: { reason: String(e && e.message || e).slice(0, 160) } });
  }
  // A VIDEO AD CARRIES ITS ARTEFACT ON EVERY PATH.
  //
  // attachMotionCreative only ran inside applyCopy, which is the LLM branch —
  // so every campaign built with noLLM (the orphan-heal republish, and any run
  // where the provider cascade is rate-limited or unkeyed) shipped its video ads
  // with nothing to play. That is the exact failure this repo already fixed once
  // at the console: a reviewer approving a play triangle drawn over a gradient
  // has approved nothing.
  //
  // Nothing about building it needs a model. renderMotionAd composes the
  // storyboard, the brand's palette and its own catalogue photographs — all of
  // which exist before any provider is called. So it runs here, for both paths,
  // and skips any ad the LLM path has already given an artefact.
  try {
    const needsMotion = (campaign.assets && campaign.assets.ads || [])
      .filter((ad) => ad.creative_type === 'video' && !(ad.creative && ad.creative.motion_html));
    if (needsMotion.length) {
      const pool = realImagePool(entry, 1400);
      for (const ad of needsMotion) attachMotionCreative(ad, entry, pool);
    }
  } catch (_) { /* a motion build must never take a campaign down */ }
  // Ads QA Critic — deterministic review of the paid-social creatives; runs in BOTH
  // the LLM and noLLM paths. Attaches a verdict + stamps each ad for the studio badge.
  // Advisory (never blocks generation); surfaces type/brand/offer/limit violations.
  try {
    const adsQa = require('./ads-qa.js').qaAds(campaign.assets && campaign.assets.ads);
    campaign.ads_qa = adsQa;
    trace.push({ agent: 'Ads QA Critic', role: 'Paid Social QA', ok: adsQa.passed, provider: 'rule-based', output: { avg_score: adsQa.avg_score, critical: adsQa.critical, ads: adsQa.count, missing: adsQa.missing } });
  } catch (_) { /* QA is advisory; never block generation */ }
  campaign.copywriter = copyMeta;
  campaign.agent_trace = trace;
  campaign.calendar_entry_id = entry.id || id || null;
  attachMasterPrompts(campaign, entry);
  reportCatalogGaps(campaign, entry, trace);
  reportProofGap(campaign, entry, trace);
  // Last, because it judges the FINISHED artefacts rather than the plan.
  checkAssetContracts(campaign);
  return campaign;
}

/**
 * Record, on the campaign itself, that a hero image slot went unfilled because
 * this brand has no approved catalogue photo for it.
 *
 * An image-free mailer is a correct outcome; a SILENTLY image-free one is not,
 * because the reviewer cannot tell it apart from a design choice. The spec's
 * marker form is written into `campaign.data_gaps` and the agent trace so the
 * gap travels with the asset into the review console, exactly as the July
 * builder surfaces an unverifiable slot instead of inventing a URL.
 */
/**
 * Record on the campaign that this send ships with NO approved testimonial, and
 * where the brand's own site was read.
 *
 * The proof gate only fires when the model produced something to strip. A model
 * that obeys the prompt leaves the fields empty, and the campaign would then
 * carry no signal at all that its proof block is a marker - which is the same
 * invisible-gap problem the marker exists to solve, one level up. So the gap is
 * reported whenever the library came back empty, obedient model or not.
 */
function reportProofGap(campaign, entry, trace) {
  try {
    const has = Array.isArray(entry && entry.__reviews) && entry.__reviews.length;
    if (has) {
      if (Array.isArray(trace)) {
        trace.push({
          agent: 'Proof Librarian', role: 'Approved Facts', ok: true, provider: entry.__review_source || 'library',
          output: { reviews: entry.__reviews.length, hosted_images: entry.__reviews.reduce((n, r) => n + ((r.media || []).filter((m) => m && m.hosted_url).length), 0), sources: [...new Set(entry.__reviews.map((r) => r.source_url).filter(Boolean))] },
        });
      }
      return;
    }
    const marker = (entry && entry.__review_marker)
      || (brandReviews ? brandReviews.MARKER(entry && entry.brand, entry && entry.market) : '');
    if (!marker) return;
    campaign.data_gaps = [...new Set([...(Array.isArray(campaign.data_gaps) ? campaign.data_gaps : []), marker])];
    if (Array.isArray(trace)) {
      trace.push({
        agent: 'Proof Librarian', role: 'Approved Facts', ok: false, provider: 'brand-site',
        output: { marker, limits: (entry && entry.__review_limits) || [] },
      });
    }
  } catch (_) { /* provenance reporting must never break a generation */ }
}

function reportCatalogGaps(campaign, entry, trace) {
  try {
    const scope = catalogServer.currentScope();
    const email = campaign.assets && campaign.assets.email;
    const hasImage = !!(email && ((email.creative && email.creative.image) || /<img\s/i.test(String(email.html || ''))));
    if (hasImage) return;
    const probe = catalogImage.resolveImage(entry, entry.market, { brand: entry.brand });
    if (!probe.marker) return;
    const gaps = Array.isArray(campaign.data_gaps) ? campaign.data_gaps : [];
    gaps.push(probe.marker);
    campaign.data_gaps = [...new Set(gaps)];
    campaign.catalog_source = (scope && scope.source) || probe.source || 'none';
    if (Array.isArray(trace)) {
      trace.push({
        agent: 'Asset Provenance', role: 'Approved Assets', ok: false, provider: 'catalog-scope',
        output: { catalog_source: campaign.catalog_source, reason: probe.reason, marker: probe.marker },
      });
    }
  } catch (_) { /* provenance reporting must never break a generation */ }
}

// Resolve a slot's entry payload — from the inline entry the UI already holds,
// or by id from the stored calendar. Used by preview + approve.
async function resolveEntry({ id, inlineEntry, config, db }) {
  // Always load the DB row when we can (id + connected), EVEN when the client
  // passed an inline entry. The row carries persisted markers (__prebuilt /
  // __preview) and the real status, which preview/approve need to REUSE a saved
  // campaign and to stamp the slot — so a slot is generated once and every later
  // view/download is an instant DB read, never a rebuild. The inline entry (the
  // client's current view, e.g. a scenario switch) still wins as the build input.
  let row = null;
  if (db.connected && id) {
    const rows = await db.select(config.tableNames.calendarEntries, { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
    row = (rows && rows[0]) || null;
  }
  if (inlineEntry) return { entry: inlineEntry, row };
  if (row) return { entry: row.payload, row };
  return { entry: null, row: null };
}

// ── Preview (generate-on-demand, NO persistence, NO status change) ───────────

async function previewEntry({ id, reviewer = null, config: cfg = {}, entry: inlineEntry = null } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const { entry, row } = await resolveEntry({ id, inlineEntry, config, db });
  if (!entry) throw new Error(`Calendar entry ${id || ''} not found — run a daily sync first or pass the entry inline.`);

  // Approved/final slots return the FINAL saved campaign — the reviewer sees
  // exactly what ships, never a fresh regeneration — EXCEPT when that saved
  // campaign is a stale template fallback (copywriter.provider ===
  // 'template-fallback'), i.e. it was built during an LLM outage. Returning it
  // would replay the "template fallback" warning forever, so we skip it and fall
  // through to republishOrphan below, which rebuilds real copy now that providers
  // are healthy and re-persists under the same id (so /lp links still resolve).
  if (db.connected && row && (row.status === 'approved' || row.status === 'final') && row.generated_campaign_id) {
    const fin = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${row.generated_campaign_id}` }, limit: 1 }).catch(() => []);
    const c = fin && fin[0] && fin[0].payload;
    const cIsFallback = !!(c && c.copywriter && c.copywriter.provider === 'template-fallback');
    if (c && !cIsFallback) {
      return {
        ok: true, preview: false, persisted: true, campaign: c,
        copywriter: c.copywriter,
        email_html: c.assets?.email?.html || null,
        email_variants: c.assets?.email?.variants || null,
        landing_html: c.assets?.landing_pages?.[0]?.html || null,
        ads: c.assets?.ads || [],
      };
    }
    // Orphaned approved slot (its campaign row was wiped): republish under the
    // stamped id so this View — and any external /lp link — resolves again. Best
    // effort with creatives; buildCampaign falls back to template assets if the
    // LLM/image providers are unavailable, so it never blocks the reviewer.
    try {
      const healedC = await republishOrphan(db, config, entry, row, { reviewer, withCreatives: false, noLLM: false });
      return {
        ok: true, preview: false, persisted: true, healed: true, campaign: healedC,
        copywriter: healedC.copywriter,
        email_html: healedC.assets?.email?.html || null,
        email_variants: healedC.assets?.email?.variants || null,
        landing_html: healedC.assets?.landing_pages?.[0]?.html || null,
        ads: healedC.assets?.ads || [],
      };
    } catch (_) { /* fall through to a fresh on-demand preview build below */ }
  }

  // Preview EXACTLY what approving produces. REUSE the saved bundle when this slot
  // has already been built — by the prebuild queue (__prebuilt, full creatives) OR
  // by a prior on-demand preview (__preview). That makes every view after the first
  // an instant DB read, not a rebuild. Only build on demand when nothing is saved.
  let campaign = null;
  const reuseId = reuseCampaignId(entry, row);
  if (db.connected && reuseId) {
    const pc = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${reuseId}` }, limit: 1 }).catch(() => []);
    if (pc && pc[0] && pc[0].payload) campaign = pc[0].payload;
  }
  // AUTO-HEAL stale template fallbacks. A slot built during an earlier LLM outage
  // persisted template-fallback copy (copywriter.provider === 'template-fallback')
  // and would otherwise be REPLAYED forever — showing the "template fallback"
  // warning even though providers now work. Treat such a bundle as not-built so the
  // block below regenerates it through the (now healthy) cascade and re-persists a
  // real campaign. Self-limiting: only fires for fallback bundles, once each.
  if (campaign && campaign.copywriter && campaign.copywriter.provider === 'template-fallback') {
    campaign = null;
  }
  // Fallback (slot never built yet): build copy + layout with REAL CATALOG PHOTOS
  // as the hero/product imagery — NO inline image GENERATION. Generating even one
  // hero image invokes the image cascade (up to a 60s per-image budget); combined
  // with the multi-call LLM copy that overran api/calendar's function limit and
  // returned a 504 (so nothing built/persisted). Catalog photos are a fast URL
  // lookup, so View returns a complete, real-photo mailer well within budget. The
  // GENERATED lifestyle/ad image set still comes from the background prebuild queue
  // (its own per-batch budget) or Download.
  let builtFresh = false;
  if (!campaign) {
    campaign = await buildCampaign(effectiveEntry(entry), config, { id, withCreatives: false });
    campaign.status = 'preview';
    campaign.calendar_entry_id = entry.id || id || null;
    builtFresh = true;
  }
  // PERSIST the fresh on-demand build + stamp the slot, so the NEXT view/download
  // reuses it instantly instead of rebuilding. Best-effort: a persistence hiccup
  // must never break the preview the reviewer is waiting on. mirror:false keeps
  // unapproved drafts out of the Ads/Landing dashboards. Stamp __preview (not
  // __prebuilt) so the prebuild queue still upgrades this slot to full creatives.
  if (builtFresh && db.connected && row) {
    try {
      await persistCampaignAssets(db, config, campaign, { status: 'preview', origin: 'smart-brain-preview', reviewer, mirror: false });
      const fresh = (await db.select(config.tableNames.calendarEntries, { filters: { id: `eq.${row.id}` }, limit: 1 }).catch(() => []))?.[0];
      if (fresh && (fresh.status === 'tentative' || fresh.status === 'rejected') && !isPrebuilt(fresh)) {
        const payload = { ...(fresh.payload || {}) };
        payload[PREVIEW_MARKER] = { campaign_id: campaign.campaign_id, at: nowIso() };
        await db.update(config.tableNames.calendarEntries, { id: `eq.${row.id}`, status: SYNC_WRITABLE_STATUSES }, { payload, updated_at: nowIso() });
      }
    } catch (_) { /* best-effort persistent cache; preview still returns below */ }
  }
  return {
    ok: true,
    preview: builtFresh,
    persisted: !builtFresh,
    campaign,
    copywriter: campaign.copywriter,
    email_html: campaign.assets.email?.html || null,
    email_variants: campaign.assets.email?.variants || null,
    landing_html: campaign.assets.landing_pages?.[0]?.html || null,
    ads: campaign.assets.ads || [],
  };
}

// ── Approve / reject ────────────────────────────────────────────────────────

async function approveEntry({ id, reviewer = null, config: cfg = {}, entry: inlineEntry = null } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const { entry, row } = await resolveEntry({ id, inlineEntry, config, db });
  if (!entry) throw new Error(`Calendar entry ${id || ''} not found — run a daily sync first or pass the entry inline.`);

  // IDEMPOTENCY: a slot already approved with a generated campaign must NOT be
  // regenerated — that would orphan the prior campaign + its ads/LP rows. Return
  // the existing campaign instead.
  if (db.connected && row && (row.status === 'approved' || row.status === 'final') && row.generated_campaign_id) {
    const prior = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${row.generated_campaign_id}` }, limit: 1 }).catch(() => []);
    const existing = prior && prior[0] && prior[0].payload;
    if (existing) {
      return {
        ok: true, idempotent: true,
        campaign: existing,
        landing_page_url: existing.assets?.landing_pages?.[0] ? `/lp/${existing.campaign_id}` : null,
        persisted: { note: 'already approved — returned existing campaign (no regeneration)' },
      };
    }
  }

  // Reuse the FULL prebuilt campaign (LLM copy + images) when the prebuild queue
  // already built this slot — approval then just locks + publishes, no wait, no
  // regeneration (so what the reviewer saw in preview is exactly what ships).
  let campaign = null;
  // Approval publishes ship-ready assets, so REUSE only a FULL prebuilt bundle
  // (__prebuilt) — never the hero-only __preview draft. If a slot has only a
  // __preview cache, rebuild below so the shipped campaign has the full creative
  // set, not the preview-level one.
  const prebuiltId = (entry && entry[PREBUILD_MARKER] && entry[PREBUILD_MARKER].campaign_id)
    || (row && row.payload && row.payload[PREBUILD_MARKER] && row.payload[PREBUILD_MARKER].campaign_id)
    || null;
  if (db.connected && prebuiltId) {
    const pc = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${prebuiltId}` }, limit: 1 }).catch(() => []);
    if (pc && pc[0] && pc[0].payload) campaign = pc[0].payload;
  }
  // buildCampaign generates copy + creatives and attaches master prompts. Use
  // the ACTIVE scenario (medium unless a human switched the slot), internal keys
  // stripped so projected revenue/spend can never reach the asset builders.
  // When there is NO prebuilt campaign to reuse, build LEAN: diffuse only the
  // email hero and take catalog photos for the other channels, so this on-demand
  // approve completes inside the serverless limit instead of overrunning on five
  // parallel image generations (the timeout that made "Generate" fail every time).
  if (!campaign) campaign = await buildCampaign(effectiveEntry(entry), config, { id, withCreatives: 'lean' });
  const copyMeta = campaign.copywriter || { provider: 'prebuilt', model: null };
  campaign.status = 'ready_for_human_final_check';
  campaign.calendar_entry_id = entry.id || id;

  // Pre-launch synchronization gate (spec §24b): a REUSED prebuilt campaign may
  // have been built days ago; verify its facts snapshot is still current before
  // publishing. Advisory — surfaced on the response + audited, and the slot is
  // flagged, but we do not hard-block (the reviewer owns the final call).
  let syncGate = null;
  if (campaign._sync || (sync && prebuiltId)) {
    syncGate = preLaunchSyncCheck(campaign);
    if (sync && !syncGate.ok) {
      try {
        await sync.audit({ record_type: 'campaign', record_id: campaign.campaign_id, source: 'smart-brain', initiated_by: 'approval.updated', actor: reviewer || 'system', reason: `pre-launch gate: ${syncGate.status} (${(syncGate.stale || []).join(', ') || 'n/a'})`, validation_result: syncGate.status }, { db, config });
      } catch (_) { /* best-effort */ }
    }
  }

  const persisted = { campaign: null, mailer: null, ads: null, landing: null, calendar: null };
  if (db.connected) {
    // Publish: store the campaign at review status + mirror mailer/ads/LP into the dashboards.
    const p = await persistCampaignAssets(db, config, campaign, { status: campaign.status, origin: 'smart-brain', reviewer, mirror: true });
    persisted.campaign = p.campaign; persisted.mailer = p.mailer; persisted.ads = p.ads; persisted.landing = p.landing;
    if (row) {
      const log = Array.isArray(row.change_log) ? row.change_log.slice(-30) : [];
      log.push({ at: nowIso(), kind: 'approved', detail: `Approved by ${reviewer || 'unknown'}; campaign ${campaign.campaign_id} generated (copy: ${copyMeta.provider}).` });
      persisted.calendar = await db.update(config.tableNames.calendarEntries, { id: `eq.${row.id}` }, {
        status: 'approved', generated_campaign_id: campaign.campaign_id, approved_by: reviewer, approved_at: nowIso(), change_log: log, updated_at: nowIso(),
      });
    }
  }
  return { ok: true, campaign, landing_page_url: campaign.assets.landing_pages?.[0] ? `/lp/${campaign.campaign_id}` : null, persisted, sync: syncGate };
}

async function rejectEntry({ id, reviewer = null, notes = '', config: cfg = {} } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return { ok: true, skipped: true, reason: 'Supabase env not configured — nothing stored to reject.' };
  const rows = await db.select(config.tableNames.calendarEntries, { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
  const row = rows && rows[0];
  if (!row) throw new Error(`Calendar entry ${id} not found.`);
  const log = Array.isArray(row.change_log) ? row.change_log.slice(-30) : [];
  log.push({ at: nowIso(), kind: 'rejected', detail: `${reviewer || 'Reviewer'}: ${notes || 'rejected — will be re-planned on next daily sync.'}` });
  // Clear any prior approval state so the regenerated slot does not point at a
  // now-orphaned campaign (init-mismatch fix).
  await db.update(config.tableNames.calendarEntries, { id: `eq.${id}` }, {
    status: 'rejected', change_log: log, updated_at: nowIso(),
    generated_campaign_id: null, approved_by: null, approved_at: null,
  });
  await db.insert(config.tableNames.feedback, [{ target_type: 'calendar_entry', target_id: id, verdict: 'rejected', notes, reviewer, created_at: nowIso() }]).catch(() => {});
  return { ok: true, id, status: 'rejected', will_regenerate_on_next_sync: true };
}

// Clear a rejection so the slot returns to the neutral 'tentative' (draft) state.
// Used by the console "Reset" control when a reviewer wants a rejected send to no
// longer show as rejected without approving it. The slot stays reviewable and is
// still refreshed on the next daily sync.
async function unrejectEntry({ id, reviewer = null, config: cfg = {} } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return { ok: true, skipped: true, reason: 'Supabase env not configured — nothing stored to reset.' };
  const rows = await db.select(config.tableNames.calendarEntries, { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
  const row = rows && rows[0];
  if (!row) throw new Error(`Calendar entry ${id} not found.`);
  // ONLY a rejected slot may be reset. A stale tab / concurrent reviewer must not
  // be able to clear the approval state of an already approved/finalised campaign.
  // Guard both in code (fast path) AND with a status=eq.rejected condition on the
  // UPDATE (so a race between this read and write updates zero rows, not an
  // approved one).
  if (row.status !== 'rejected') {
    return { ok: true, id, status: row.status, skipped: true, reason: `not rejected (status: ${row.status}) — nothing to reset` };
  }
  const log = Array.isArray(row.change_log) ? row.change_log.slice(-30) : [];
  log.push({ at: nowIso(), kind: 'reset', detail: `${reviewer || 'Reviewer'}: rejection cleared, back to draft.` });
  await db.update(config.tableNames.calendarEntries, { id: `eq.${id}`, status: 'eq.rejected' }, {
    status: 'tentative', change_log: log, updated_at: nowIso(),
    generated_campaign_id: null, approved_by: null, approved_at: null,
  });
  return { ok: true, id, status: 'tentative' };
}

// ── Scenario switch ("break" button + revert) ───────────────────────────────
// Promotes a pre-staged standby scenario (emergency / instant / best /
// conservative) into the active fields of affected slots — or reverts to medium.
// scope: 'all' (every active future slot — the big red button), {date,market}, or
// {ids:[...]}. Switching a slot that already generated assets resets it to
// tentative + clears the prior campaign so the new scenario re-earns human
// sign-off and fresh assets. activateScenario({scenario:'medium'}) reverts.
async function activateScenario({ scenario, reviewer = null, scope = 'all', config: cfg = {} } = {}) {
  if (!SM.SCENARIO_LABELS.includes(scenario)) throw new Error(`Unknown scenario "${scenario}". Use one of ${SM.SCENARIO_LABELS.join(', ')}.`);
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return { ok: true, skipped: true, reason: 'Supabase env not configured — nothing persisted to switch.', scenario };

  let rows;
  if (scope && Array.isArray(scope.ids) && scope.ids.length) {
    rows = await db.select(config.tableNames.calendarEntries, { filters: { id: `in.(${scope.ids.join(',')})` }, limit: 1000 }).catch(() => []);
  } else if (scope && scope.date && scope.market) {
    rows = await db.select(config.tableNames.calendarEntries, { filters: { date: `eq.${scope.date}`, market: `eq.${scope.market}` }, limit: 100 }).catch(() => []);
  } else {
    rows = await db.select(config.tableNames.calendarEntries, { filters: { date: `gte.${todayIso()}`, status: 'neq.archived' }, order: 'date.asc', limit: 1000 }).catch(() => []);
  }

  const switched = [];
  const skipped = [];
  for (const row of rows || []) {
    const payload = row.payload || {};
    const prev = payload.active_scenario || 'medium';
    if (prev === scenario) { skipped.push({ id: row.id, reason: 'already-active' }); continue; }
    if (scenario !== 'medium' && !(payload.standby && payload.standby[scenario])) { skipped.push({ id: row.id, reason: 'no-standby-variant (older row — run a daily sync first)' }); continue; }

    promoteScenario(payload, scenario);
    const log = Array.isArray(row.change_log) ? row.change_log.slice(-30) : [];
    log.push({ at: nowIso(), kind: 'scenario_switched', detail: `${prev} → ${scenario} by ${reviewer || 'operator'} (scope ${scope && scope !== 'all' ? JSON.stringify(scope) : 'all'})` });
    const patch = { payload, change_log: log, updated_at: nowIso() };

    // Switching invalidates any already-generated assets — require fresh sign-off.
    const hadAssets = row.generated_campaign_id || row.status === 'approved' || row.status === 'final';
    if (hadAssets) Object.assign(patch, { status: 'tentative', generated_campaign_id: null, approved_by: null, approved_at: null });
    // The switch is itself a deliberate human action, so it may flip approved rows;
    // restrict only to non-archived to avoid resurrecting past slots.
    const upd = await db.update(config.tableNames.calendarEntries, { id: `eq.${row.id}`, status: 'neq.archived' }, patch);
    if (upd.ok && (upd.rows || []).length) switched.push(row.id);
    else skipped.push({ id: row.id, reason: upd.ok ? 'conditional-update-missed' : upd.warning });
  }
  return {
    ok: true, scenario, scope: scope || 'all',
    switched_count: switched.length, switched, skipped,
    note: 'Slots with generated assets were reset to tentative — re-approve to regenerate under the new scenario. Revert with scenario="medium".',
  };
}

// ── Landing-page resolver for /lp/:id ───────────────────────────────────────

// Resolve stored LP HTML for /lp/:id. Returns { html, diag } — diag says exactly
// WHY a page could not be served (storage disconnected / campaign not persisted /
// campaign has no LP asset), so a 404 is actionable instead of a mystery. Looks
// the campaign up by BOTH the row id AND payload.campaign_id (id-scheme drift
// safety net), then falls back to the landing_pages_generated mirror.
async function landingPageResolve(id, cfg = {}, variant = null) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const diag = { id, dbConnected: !!db.connected, campaignFound: false, hasLpHtml: false, fallbackFound: false, source: null };
  if (!db.connected) return { html: null, diag };
  // 1) generated campaign by row id, then 2) by payload.campaign_id.
  let camp = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${id}` }, limit: 1 }).catch(() => []);
  if (camp && camp[0]) diag.source = 'generated_campaigns.id';
  else {
    camp = await db.select(config.tableNames.generatedCampaigns, { filters: { 'payload->>campaign_id': `eq.${id}` }, limit: 1 }).catch(() => []);
    if (camp && camp[0]) diag.source = 'generated_campaigns.campaign_id';
  }
  if (camp && camp[0]) {
    diag.campaignFound = true;
    const lps = camp[0]?.payload?.assets?.landing_pages || [];
    // ?v=b serves the story-led B variant; default serves A (first LP). If B is
    // requested but only one LP was built, fall back rather than 404 a valid page.
    const want = /^b$/i.test(String(variant || '')) ? (lps.find((l) => l.variant === 'B') || lps[1] || lps[0]) : (lps.find((l) => l.variant === 'A') || lps[0]);
    if (want?.html) { diag.hasLpHtml = true; return { html: want.html, diag }; }
  }
  // 3) landing_pages_generated mirror (numeric id or campaign_id in payload).
  const filters = /^\d+$/.test(String(id)) ? { id: `eq.${id}` } : { 'payload->>campaign_id': `eq.${id}` };
  const lp = await db.select(config.tableNames.landingPagesGenerated, { filters, limit: 1 }).catch(() => []);
  if (lp?.[0]?.payload?.html) { diag.fallbackFound = true; diag.source = 'landing_pages_generated'; return { html: lp[0].payload.html, diag }; }
  return { html: null, diag };
}
async function landingPageHtml(id, cfg = {}, variant = null) {
  return (await landingPageResolve(id, cfg, variant)).html;
}

// ── Orphan heal: republish approved slots whose campaign row is missing ──────
// A wipe/reset of smart_generated_campaigns leaves approved calendar slots
// pointing at campaign ids that no longer exist, so /lp/:id 404s. buildCampaign
// mints a DETERMINISTIC id from the entry (idFor = sha1(entry)), so rebuilding a
// slot reproduces the SAME id it already advertises — republishing under it makes
// the existing /lp link resolve again. Runs offline by default (noLLM) so it works
// even when providers are rate-limited: the template LP html is real catalog data.
async function republishOrphan(db, config, entry, row, { reviewer = null, withCreatives = false, noLLM = true } = {}) {
  const rebuilt = await buildCampaign(effectiveEntry(entry), config, { id: row.generated_campaign_id, withCreatives, noLLM });
  // FORCE the campaign id to the id the slot already advertises. buildCampaign mints
  // its OWN deterministic id (idFor over the current entry), which no longer matches
  // the stamped generated_campaign_id once the entry has drifted since approval — so
  // without this the row lands under a new id and the existing /lp/<stamped> link
  // stays a 404. Persisting under the stamped id makes that exact link resolve and
  // leaves the slot pointer already consistent (no reconcile needed). The template LP
  // html carries no self-referential /lp links, so only the path metadata needs sync.
  const targetId = row.generated_campaign_id;
  rebuilt.campaign_id = targetId;
  (rebuilt.assets && rebuilt.assets.landing_pages ? rebuilt.assets.landing_pages : []).forEach((lp) => {
    const isB = /^b$/i.test(String(lp.variant || ''));
    lp.id = `${targetId}_landing_${isB ? 'b' : 'a'}`;
    lp.path = isB ? `/lp/${targetId}?v=b` : `/lp/${targetId}`;
  });
  rebuilt.status = 'approved';
  rebuilt.calendar_entry_id = row.id;
  // mirror:false — /lp only needs the smart_generated_campaigns row (payload carries
  // the LP html). Skipping the ads/mailer/landing dashboard mirrors keeps heal from
  // depending on tables that may not exist in this project, so it never throws.
  await persistCampaignAssets(db, config, rebuilt, { status: 'approved', origin: 'smart-brain-heal', reviewer, mirror: false });
  return rebuilt;
}

// Find approved/final slots whose campaign row is missing and republish a batch.
// Idempotent + resumable: returns `remaining` so the caller re-invokes until 0.
async function healOrphans({ config: cfg = {}, batchSize = 12, reviewer = 'system-heal' } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return { ok: true, skipped: true, reason: 'Supabase not configured', healed: [], failed: [], remaining: 0 };
  const rows = (await db.select(config.tableNames.calendarEntries, { filters: { status: 'in.(approved,final)' }, order: 'date.asc', limit: 2000 }).catch(() => [])) || [];
  const withId = rows.filter((r) => r.generated_campaign_id);
  // One query for all existing campaign ids, then diff (no N per-slot selects).
  const existingRows = (await db.select(config.tableNames.generatedCampaigns, { limit: 5000 }).catch(() => [])) || [];
  const existing = new Set(existingRows.map((c) => c.id));
  const orphans = withId.filter((r) => !existing.has(r.generated_campaign_id));
  const batch = orphans.slice(0, Math.max(1, batchSize));
  const healed = [], failed = [];
  for (const r of batch) {
    try { const c = await republishOrphan(db, config, r.payload, r, { reviewer }); healed.push({ slot: r.id, campaign_id: c.campaign_id }); }
    catch (e) { failed.push({ slot: r.id, error: String((e && e.message) || e).slice(0, 160) }); }
  }
  return { ok: true, orphans_total: orphans.length, healed, failed, remaining: Math.max(0, orphans.length - batch.length) };
}

// ── Convergent asset prebuild queue ─────────────────────────────────────────
// Contract (product owner, 2026-07-09): every slot in the 90-day rolling window
// must not merely EXIST but arrive with its FULL asset bundle already built —
// LLM-written copy AND generated images for the mailer + Meta/Google/TikTok ads
// + landing page — so a reviewer only ever approves, never waits on generation.
//
// A single serverless invocation cannot build ~180 slots (each is ~30-60s of LLM
// copy + 5 parallel image generations), so prebuildAssets() processes a small
// batch per call and the caller (the smart-brain cron / prebuild route) re-fires
// it until `remaining` hits 0, then it idles. Fully idempotent + resumable: a
// slot counts as built once its payload carries a __prebuilt marker pointing at
// a persisted campaign. Daily sync only rewrites a slot's payload (dropping the
// marker) when it MATERIALLY re-plans that slot, which correctly forces a rebuild
// of the now-stale assets. Human-approved/final slots are skipped (they own a
// real campaign already).
const PREBUILD_MARKER = '__prebuilt';
// Marker for an ON-DEMAND preview build that has been persisted so it is reused
// (instant) on every later view/download instead of rebuilt. Distinct from
// __prebuilt so the background prebuild queue STILL upgrades the slot to the full
// creative bundle later (isPrebuilt only checks __prebuilt). __prebuilt is always
// preferred over __preview when both exist.
const PREVIEW_MARKER = '__preview';
function reuseCampaignId(entry, row) {
  const p = (row && row.payload) || {};
  return (entry && entry[PREBUILD_MARKER] && entry[PREBUILD_MARKER].campaign_id)
    || (p[PREBUILD_MARKER] && p[PREBUILD_MARKER].campaign_id)
    || (entry && entry[PREVIEW_MARKER] && entry[PREVIEW_MARKER].campaign_id)
    || (p[PREVIEW_MARKER] && p[PREVIEW_MARKER].campaign_id)
    || null;
}

function isPrebuilt(row) {
  const p = row && row.payload && row.payload[PREBUILD_MARKER];
  return !!(p && p.campaign_id);
}
function creativeCount(campaign) {
  let n = 0;
  const a = campaign && campaign.assets;
  if (!a) return 0;
  if (a.email && a.email.creative && a.email.creative.image) n += 1;
  for (const lp of a.landing_pages || []) if (lp && (lp.creative?.image || lp.hero_image)) n += 1;
  for (const ad of a.ads || []) if (ad && (ad.creative?.image || ad.image)) n += 1;
  return n;
}

// Persist a generated campaign + (optionally) mirror its ads/LP into the Ads and
// Landing Pages dashboards. Shared by approveEntry (mirror=true — publish) and
// prebuildAssets (mirror=false — a draft that only lands in smart_generated_campaigns,
// so unapproved drafts never flood the dashboards; /lp/:id still resolves it via
// landingPageHtml, which reads smart_generated_campaigns first).
async function persistCampaignAssets(db, config, campaign, { status, origin, reviewer = null, mirror = true } = {}) {
  const out = { campaign: null, mailer: null, ads: null, landing: null };
  // Stamp freshness (spec §24b) BEFORE persisting so the stored payload carries
  // its source-version snapshot; also writes sync_state + an audit entry.
  await stampAndRecordSync(db, config, campaign, { actor: reviewer || origin || 'system', reason: `persist (${status})` });
  out.campaign = await db.upsert(config.tableNames.generatedCampaigns, [{ id: campaign.campaign_id, payload: campaign, status, updated_at: nowIso() }], 'id');
  if (!mirror) return out;
  // Mirror the MAILER into mailers_generated so the generated email lands in the
  // Created Assets dashboard alongside its ads + landing page (previously only
  // ads + landing pages were mirrored, so generated mailers never showed there).
  const email = campaign.assets.email;
  if (email) {
    const variants = Array.isArray(email.variants) ? email.variants : [];
    out.mailer = await db.insert(config.tableNames.mailersGenerated, [{
      user_email: reviewer || null,
      prompt_short: String(campaign.name || campaign.objective || '').slice(0, 200),
      campaign_type: campaign.objective || null,
      primary_market: campaign.market || null,
      markets: campaign.market ? [campaign.market] : null,
      hero_product_name: email.hero_headline || campaign.name || null,
      hero_product_image: (email.creative && email.creative.image) || null,
      headline: email.hero_headline ? [email.hero_headline] : null,
      sub_copy: email.preheader || null,
      variant_a_html: email.html || (variants[0] && variants[0].html) || null,
      variant_b_html: (variants[1] && variants[1].html) || null,
    }]).catch(() => null);   // never let a mailer-mirror failure block ads/LP/approval
  }
  const adRows = (campaign.assets.ads || []).map((ad) => ({
    channel: ad.platform, name: campaign.name, market: campaign.market, objective: campaign.objective,
    audience: campaign.audience?.name, copy: ad, creative_prompt: ad.creative_brief || ad.script || '', origin,
    user_email: reviewer || null,
  }));
  if (adRows.length) out.ads = await db.insert(config.tableNames.adsGenerated, adRows);
  const lp = campaign.assets.landing_pages?.[0];
  if (lp) out.landing = await db.insert(config.tableNames.landingPagesGenerated, [{
    paired_with: campaign.assets.email ? 'mailer' : (campaign.assets.ads?.[0]?.platform || 'meta'),
    name: lp.title || campaign.name, market: campaign.market,
    hero: lp.title || '', payload: { campaign_id: campaign.campaign_id, path: lp.path, html: lp.html, sections: lp.sections, master_prompt: lp.master_prompt },
    origin, user_email: reviewer || null,
  }]);
  return out;
}

async function prebuildAssets({ config: cfg = {}, batchSize = 1, sinceDate = null } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  if (!db.connected) return { ok: true, skipped: true, reason: 'Supabase env not configured — nothing to prebuild.', built: [], failed: [], batch: 0, remaining: 0 };
  const start = sinceDate || todayIso();
  // Candidates: future, still writable (tentative/rejected — approved/final own a
  // real campaign), nearest-date first so imminent slots build first.
  const rows = (await db.select(config.tableNames.calendarEntries, {
    filters: { date: `gte.${start}`, status: SYNC_WRITABLE_STATUSES },
    order: 'date.asc', limit: 1000,
  }).catch(() => [])) || [];
  const pending = rows.filter((r) => !isPrebuilt(r));
  const batch = pending.slice(0, Math.max(1, batchSize));
  const built = [];
  const failed = [];
  for (const row of batch) {
    try {
      const entry = { ...(row.payload || {}), id: row.id };
      // FULL build: LLM copy + generated images (withCreatives:true) for the
      // mailer + ads + landing page — the same output an approval produces.
      const campaign = await buildCampaign(effectiveEntry(entry), config, { id: row.id, withCreatives: true });
      campaign.status = 'prebuilt';
      campaign.calendar_entry_id = row.id;
      await persistCampaignAssets(db, config, campaign, { status: 'prebuilt', origin: 'smart-brain-prebuild', mirror: false });
      // Mark the slot built — merge the marker into the LATEST payload and guard
      // on writable status so a human approval landing mid-build is never clobbered.
      const fresh = (await db.select(config.tableNames.calendarEntries, { filters: { id: `eq.${row.id}` }, limit: 1 }).catch(() => []))?.[0];
      if (fresh && (fresh.status === 'tentative' || fresh.status === 'rejected')) {
        const payload = { ...(fresh.payload || {}) };
        payload[PREBUILD_MARKER] = { campaign_id: campaign.campaign_id, at: nowIso(), images: creativeCount(campaign), copy: campaign.copywriter?.provider || null };
        const log = Array.isArray(fresh.change_log) ? fresh.change_log.slice(-30) : [];
        log.push({ at: nowIso(), kind: 'prebuilt', detail: `Assets prebuilt (mailer + ads + landing page; copy ${campaign.copywriter?.provider || 'template'}, ${creativeCount(campaign)} images); campaign ${campaign.campaign_id}.` });
        await db.update(config.tableNames.calendarEntries, { id: `eq.${row.id}`, status: SYNC_WRITABLE_STATUSES }, { payload, change_log: log, updated_at: nowIso() });
      }
      built.push({ id: row.id, date: row.date, market: row.market, campaign_id: campaign.campaign_id, images: creativeCount(campaign) });
    } catch (e) {
      failed.push({ id: row.id, error: e.message });
    }
  }
  return { ok: true, mode: 'db-linked', built, failed, batch: batch.length, remaining: Math.max(0, pending.length - built.length) };
}

// ── Safe DB diagnostic ──────────────────────────────────────────────────────
// Reports which Supabase PROJECT + key role the calendar adapter resolves and
// the HTTP status when reading key tables. No secret values are returned — only
// booleans, the project ref (already public via /api/public-config), the key's
// role claim (anon/service_role), and HTTP status codes. Pinpoints whether the
// 401s are a URL/key project mismatch vs. a missing table.
async function dbCheck({ config: cfg = {} } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  let urlHost = '';
  try { urlHost = new URL(db.url).host; } catch (_) { urlHost = db.url ? 'set' : ''; }
  const urlRef = urlHost.split('.')[0] || '';
  let keyRole = db.key ? 'opaque' : 'none', keyRef = '';
  try { const p = JSON.parse(Buffer.from(String(db.key).split('.')[1] || '', 'base64').toString('utf8')); keyRole = p.role || keyRole; keyRef = p.ref || ''; } catch (_) {}
  const tables = ['smart_calendar_entries', 'smart_generated_campaigns', 'smart_users', 'smart_orders'];
  const probes = {};
  await Promise.all(tables.map(async (t) => {
    try {
      const r = await fetch(`${db.url}/rest/v1/${t}?select=id&limit=1`, { headers: db.headers() });
      probes[t] = { status: r.status, ok: r.ok };
    } catch (e) { probes[t] = { status: 0, error: String((e && e.message) || e).slice(0, 80) }; }
  }));
  return {
    ok: true,
    calendar_adapter: {
      url_project_ref: urlRef,
      key_role: keyRole,
      key_project_ref: keyRef,
      url_key_same_project: keyRef ? (urlRef === keyRef) : null,
      probes,
    },
    env_present: {
      SMART_BRAIN_SUPABASE_URL: !!process.env.SMART_BRAIN_SUPABASE_URL,
      SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY: !!process.env.SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY,
      SMART_BRAIN_SUPABASE_KEY: !!process.env.SMART_BRAIN_SUPABASE_KEY,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    },
  };
}

module.exports = {
  // exported for scripts/test-brand-isolation.js only
  __test_emailHtml: emailHtml,
  // exported for tests/brand-data-scope.spec.js: the slot-id namespace is the
  // thing that stops two brands sharing a primary key, so it is asserted on
  // directly rather than inferred from a full sync.
  __test_offeringPlanEntries: offeringPlanEntries,
  __test_workspaceNs: workspaceNs,
  // exported for tests/smart-brain-assets.spec.js. The prompt, the proof gate,
  // the proof block and the ad artefacts are the four things this module can get
  // wrong in a way that ships to a customer, so each is assertable directly
  // rather than inferred from a whole generation (which needs an LLM, a network
  // and a database none of which exist in the test environment).
  __test_copyPrompt: copyPrompt,
  __test_audienceBrief: audienceBrief,
  __test_approvedProofBrief: approvedProofBrief,
  __test_approvedProof: approvedProof,
  __test_gateProof: gateProof,
  __test_proofBlockHtml: proofBlockHtml,
  __test_injectProofBlock: injectProofBlock,
  __test_lpHtml: lpHtml,
  __test_generateCreatives: generateCreatives,
  __test_applyCopy: applyCopy,
  __test_attachMotionCreative: attachMotionCreative,
  syncDaily, getPlan, previewEntry, approveEntry, rejectEntry, unrejectEntry, activateScenario, landingPageHtml, landingPageResolve, buildCampaign,
  prebuildAssets, healOrphans, dbCheck, syncStatus,
  // exported for unit testing (pure scenario helpers)
  attachScenarioLayer, promoteScenario, effectiveEntry, buildStandbyVariant,
};
