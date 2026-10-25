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
  applyContactPolicy,
  replenishmentEntries, enforceFrequencyCap,
  objectiveFor, offerDecision, plannedChannels,
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
  // A campaign with no market is versioned against the brand's HOME market,
  // not a literal: the approved-facts lookup below is per region, and 'US'
  // for an India-only brand answered with facts approved for nowhere.
  const region = c.market || require('./brand-runtime.js').homeRegion(c.brand || require('./brand-runtime.js').defaultBrand());
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
  let tiers = [...new Set([wanted, 'standard', 'fast'])];
  // The keyless provider has one model and one answer per 30 s: a tier ladder
  // would only queue the same request three times.
  try { if (await require('./llm.js').keylessOnly()) tiers = [wanted]; } catch (_) { /* keep the ladder */ }
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
// `needs_human_verification` is included because older planners and the
// CalendarIntelligenceService stamp that on slots; excluding it left rebrand
// re-plans reporting "updated" in Changes while the row stayed on another
// brand's payload — getPlan then hid those near-term slots (2026-10-14).
const SYNC_WRITABLE_STATUSES = 'in.(tentative,rejected,needs_human_verification)';

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
  if (!wsId) {
    // A REQUEST with no workspace is not the cron (2026-09-29). A mobile+PIN
    // account has no workspace row - its brand is the record the request
    // carried, or the unresolved placeholder - and the router already put
    // that on the request. "No workspace" used to mean "userless, so tenant
    // zero", and a phone account's plan was built from tenant zero's
    // offerings and stamped with the OLDEST workspace's name. Only a call
    // with no request in scope at all (the scheduler, a script) keeps the
    // documented default.
    const carried = requestBrand();
    if (carried) {
      if (carried.unresolved) return { isZero: false, brand: null };
      // A CARRIED record is a device brand, and a device brand is never
      // tenant zero, whatever name or slug it arrived with (2026-09-29,
      // review): testing its slug against tenant zero's let any phone
      // account that sent that slug plan over tenant zero's assortment.
      if (carried.carried === true || carried.storage === 'device') return { isZero: false, brand: carried };
      // A workspace record: tenant zero only when the server stamped it so
      // (owns_shipped, the oldest workspace), never by its slug (2026-10-05).
      return { isZero: catalogServer.isTenantZeroBrand(carried) === true, brand: carried };
    }
    // A person with no workspace and no brand on the request is not the cron.
    if (requestIsPerson()) return { isZero: false, brand: null };
    return { isZero: true, brand: null }; // userless (cron) default = tenant zero
  }
  try {
    const wsScope = require('./workspace-scope.js');
    const env = {
      url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''),
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
    };
    if (!env.url || !env.key) return { isZero: false, brand: null };
    let brand = await wsScope.brandForWorkspace(env, wsId);
    // brandForWorkspace stamps owns_shipped from the oldest workspace; a
    // workspace that only carries tenant zero's slug plans from its own data.
    const isZero = !!brand && catalogServer.isTenantZeroBrand(brand) === true;
    if (brand && !isZero) {
      const catalog = await require('./brand-catalog-server.js').resolve({ brand: { ...brand, owns_shipped: false }, workspaceId: wsId });
      if (catalog.source === 'brand' && catalog.products.length) {
        // Every fact the store stated rides along (2026-10-23), and the
        // store's OWN popularity order leads: the rotation starts with what
        // the store says sells most; unranked rows keep their order after.
        const rankOf = (p) => (p.metrics && Number.isFinite(Number(p.metrics.popularity_rank)) ? Number(p.metrics.popularity_rank) : Infinity);
        const ordered = catalog.products.map((p, i) => [p, i]).sort((a, b) => (rankOf(a[0]) - rankOf(b[0])) || (a[1] - b[1])).map((x) => x[0]);
        const products = ordered.map(p => ({ kind: p.offering_kind === 'story' ? 'story' : 'product', name: p.n, handle: p.h,
          price: p.price, compare_at: p.compare_at, currency: p.currency || null, region: p.region || null, image: p.i, type: p.type, tags: p.t, url: p.product_url || '',
          unit_spec: p.unit_spec || null, piece_count: p.piece_count || null, servings: p.servings || null,
          claims: Array.isArray(p.claims) && p.claims.length ? p.claims : null, metrics: p.metrics || null,
          author: p.author || null, read_time: p.read_time || null, published_at: p.published_at || null,
          source: { type: 'workspace_catalog', workspace_id: wsId } }));
        const other = _resolveBrandOfferings(brand).filter(o => o.kind !== 'product');
        brand = { ...brand, offerings: products.concat(other), brand_data: { ...brand.brand_data, offerings: products.concat(other) } };
      }
    }
    return { isZero, brand };
  } catch (_) { return { isZero: false, brand: null }; }
}

// The marker is UNPADDED (the 2026-09-15 rule): `field, brand` - it read
// "[...: catalogue and analytics, this workspace, all]", and "all" is not a
// fact. It names the brand the plan was asked for.
function emptyPlanNote(brand) {
  const L = require('./brand-locale.js');
  const name = (brand && brand.name) || 'this brand';
  return `${L.marker('catalogue and analytics', brand)} `
    + `The plan generates only from ${name}'s own offerings and data; nothing is borrowed from another brand. `
    + 'Connect the brand\'s catalogue in brand setup, then run Daily Sync.';
}

// A brand with no catalogue and no orders still gets a calendar. The jobs are
// the lifecycle sequence (education, second order, retention, expansion,
// reactivation), one a day, so each audience is touched about once a week.
// Product, price, audience size and revenue stay unmarked.
const LIFECYCLE_STRATEGY = [
  { name: 'Never Purchased', rules: ['No order on record.', 'Teach the brand. Do not name a product, a price or an offer code the record does not hold.'] },
  { name: 'New Customers', rules: ['One order on record.', 'The job is the second order, before the habit lapses.'] },
  { name: 'Need Attention', rules: ['Still buying, with the gap between orders stretching.', 'Hold them. A win-back is the more expensive send.'] },
  { name: 'Champions', rules: ['Best customers by recency, frequency and value.', 'Expansion. A discount is not the job.'] },
  { name: 'At Risk', rules: ['Bought before, and has now gone quiet.', 'Bring them back. Replenish only where their own history says they are due.'] },
  { name: 'Hibernating', rules: ['Quiet for longer than At Risk.', 'They already know the brand, so this is a return, not an introduction.'] },
  { name: 'Lost', rules: ['Quiet long enough that an earlier reactivation has had its turn.', 'One send, then leave them alone.'] },
];

// The job of one send to this audience, for an evergreen offering. The
// offering's own job ("Drive the reader to buy this product.") is the last line.
function cohortJob(cohort, name, fallback) {
  const n = String(name || 'it');
  const jobs = {
    Nurture: `Show what ${n} is and who it is for, before asking for anything.`,
    Engaged: `Turn interest into a first step with ${n}.`,
    'At Risk': `Bring back customers who have gone quiet, with ${n}.`,
    Winback: `Win back customers who have lapsed, with ${n}.`,
  };
  return jobs[cohort] || fallback;
}

function strategyPlay(name) {
  return {
    'Never Purchased': 'Education for people who have not bought: one idea, and no offer code this brand has not published.',
    'New Customers': 'Second-order activation for people who bought once. The next purchase is the whole job.',
    'Need Attention': 'Pre-lapse retention: a reason to buy again while the customer is still active.',
    Champions: 'Premium expansion for the best customers. A bundle only when the catalogue names one.',
    'At Risk': 'Reactivation for lapsing buyers.',
    Hibernating: 'Reactivation for buyers who have been quiet longer. Same job as At Risk, a later stage.',
    Lost: 'A final reactivation for the buyers who have been gone the longest. After this send they are left alone.',
  }[name] || 'Lifecycle send for this audience.';
}

function strategyCta(objective) {
  const o = String(objective || '').toLowerCase();
  if (/education/.test(o)) return 'Learn more';
  if (/second-order|activation/.test(o)) return 'Order again';
  if (/pre-lapse|retention/.test(o)) return 'Stay with us';
  if (/premium|bundle|expansion/.test(o)) return 'See more';
  if (/reactivat/.test(o)) return 'Come back';
  return 'Open';
}

function declaredMarkets(brand) {
  const codes = ((brand && Array.isArray(brand.regions)) ? brand.regions : [])
    .map((r) => String((r && r.code) || '').toUpperCase()).filter(Boolean);
  return codes.length ? { markets: codes, declared: true } : { markets: ['UNDECLARED'], declared: false };
}

function strategyNote(brand, marketInfo) {
  const where = marketInfo.declared ? marketInfo.markets.join(', ') : 'home market undeclared';
  const name = (brand && brand.name) || 'this brand';
  return '[DATA REQUIRED BEFORE LAUNCH: catalogue and analytics, ' + name + ', ' + where + '] '
    + 'The rolling calendar is still built, from lifecycle strategy: education, second order, pre-lapse retention, expansion and reactivation, one job a day. '
    + 'Product, price, audience size and revenue stay unmarked until this brand\'s own catalogue and analytics are connected.'
    + excludedCatalogLine(brand);
}
/** The sentence a plan carries when the record's catalogue is another brand's. */
function excludedCatalogLine(brand) {
  const v = brand ? catalogServer.catalogVerdict(brand) : null;
  return v && v.excluded ? ' ' + v.marker + ' ' + v.sentence : '';
}

/**
 * Lifecycle calendar for a brand whose catalogue and orders produced nothing.
 * One job per day per market, rotated on the absolute date so a sync does not
 * churn ids. No product, no price, no audience count, no revenue.
 */
function strategyPlanEntries(brand, startDate, days, ns) {
  const marketInfo = declaredMarkets(brand);
  const note = strategyNote(brand, marketInfo);
  const name = (brand && brand.name) || 'this brand';
  const entries = [];
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(startDate, i);
    const epoch = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) || i;
    const job = LIFECYCLE_STRATEGY[epoch % LIFECYCLE_STRATEGY.length];
    const objective = objectiveFor(job.name, null);
    const offer = offerDecision(job.name, objective, brand);
    for (const market of marketInfo.markets) {
      const where = marketInfo.declared ? market : 'home market undeclared';
      const hero = {
        title: `[DATA REQUIRED BEFORE LAUNCH: product catalogue, ${name}, ${where}]`,
        sku: null, handle: null, category: null, placeholder: true,
      };
      const play = strategyPlay(job.name);
      const why = `${play} Planned for ${name} (${where}) from the lifecycle strategy, because this brand has no catalogue and no order history to plan from.`;
      const confidence = {
        score: 0.35,
        label: 'exploratory',
        factors: [{ label: 'Lifecycle strategy, no measured performance', delta: 0, detail: 'No catalogue or analytics are connected, so this score is a planning prior, not a result.' }],
      };
      entries.push({
        id: stableId(date, market, job.name, ns),
        date, market,
        status: 'needs_human_verification',
        confidence: confidence.score,
        strategy_only: true,
        strategy_note: note,
        cohort: { name: job.name, size: null, estimated: true, rules: job.rules },
        objective,
        theme: objective,
        heroProduct: hero,
        heroOffering: null,
        channels: plannedChannels(require('../../lib/smart-brain/services.js').BASE_CHANNELS, brand),
        cta: strategyCta(objective),
        cta_url: null,
        offer,
        why,
        analysis: buildEntryAnalysis({
          cohort: { name: job.name, size: null, estimated: true },
          product: hero,
          channels: plannedChannels(require('../../lib/smart-brain/services.js').BASE_CHANNELS, brand),
          objective,
          market: where,
          confidence,
          dataSource: 'lifecycle-strategy',
        }),
        reach: {
          cohort_size: null,
          cohort_size_estimated: true,
          planned_recipients: null,
          widen_note: `[DATA REQUIRED BEFORE LAUNCH: real eligible-segment size for "${job.name}" in ${where}. Reach is never estimated.]`,
        },
        feasibility: {
          status: 'DATA REQUIRED',
          projected_revenue: null,
          daily_target: null,
          per_send_target: null,
          currency: null,
          note: `No analytics are connected for ${name}. Revenue is not estimated.`,
        },
        data_gaps: [
          `[DATA REQUIRED BEFORE LAUNCH: product catalogue, ${name}, ${where}]`,
          `[DATA REQUIRED BEFORE LAUNCH: destination URL, ${name}, ${where}]`,
          `[DATA REQUIRED BEFORE LAUNCH: real eligible-segment size, ${job.name}, ${where}]`,
        ].concat(offer.data_gaps || []),
        demo_numbers: false,
      });
    }
  }
  return entries;
}

/** Catalogue and order slots win. Strategy fills a plan that would otherwise be empty. */
function withStrategyFallback(brand, entries, start, days, ns) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length || !brand) return { source: list.length ? 'data' : 'empty', entries: list };
  return { source: 'lifecycle-strategy', entries: strategyPlanEntries(brand, start, days, ns) };
}

// ── Brand-true planning for non-tenant-zero workspaces ─────────────────────
// The plan for any other workspace is built from THAT brand's OWN offerings
// (its record, else its matching preset on disk), its OWN regions as the
// market list (a brand sold only in India plans only IN slots), and the
// offering-campaign machinery for kind-correct mechanics (event ramps,
// Register/Subscribe/Start-reading CTAs, never promoting a past event).
// Only the NUMBERS are demo: deterministic per brand+slot, and every reach or
// feasibility figure that would need real analytics stays DATA REQUIRED.
/** The preset a record says it was created from (brand_data.template), slug only. */
function templateSlugOf(brand) {
  const t = brand && (brand.template || (brand.brand_data && brand.brand_data.template));
  if (!t) return '';
  return String(typeof t === 'object' ? (t.slug || '') : t).trim().toLowerCase();
}
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
      // A renamed preset retains its old slug, and a name can be anybody's.
      // A preset's offerings are this brand's only when the record SAYS it
      // was made from that template (brand_data.template) AND its website is
      // the preset's host (2026-10-11) - the same rule as the browser's
      // brand-catalog.js / brand-demo.js presetMatches().
      const tpl = templateSlugOf(brand);
      const website = host(brand.website);
      if (tpl && website && /^[a-z0-9-]{1,60}$/.test(tpl)) {
        const f = path.join(dir, tpl + '.json');
        if (fs.existsSync(f)) {
          const preset = JSON.parse(fs.readFileSync(f, 'utf8'));
          if (String(preset.slug || tpl).trim().toLowerCase() === tpl && host(preset.website) === website && Array.isArray(preset.offerings)) raw = preset.offerings;
        }
      }
    } catch (_) { /* no preset dir - fall through */ }
  }
  if (!raw) return [];
  // Another brand's products never become this brand's offerings (2026-10-10):
  // a product offering read off a catalogue the coherence rule calls another
  // brand's, or whose page is on another brand's site, is dropped here, once,
  // for every planner that reads offerings.
  const verdict = catalogServer.catalogVerdict(brand);
  return raw.map((o) => KINDS.normalizeOffering(o)).filter(Boolean).filter((o) => !offeringForeign(o, verdict));
}

/**
 * Is this offering (or a slot's hero) another brand's product, under the
 * catalogue verdict? Judged by the SAME rule as a catalogue row
 * (brand-coherence catalogRowForeign): its page when it names one, else the
 * catalogue it was read from. An offering the person typed (no page, not read
 * from a catalogue) is theirs.
 */
function offeringForeign(o, verdict) {
  if (!o || typeof o !== 'object' || !verdict) return false;
  const url = String(o.source_url || o.url || o.product_url || '').trim();
  const fromCatalog = !!(o.source && typeof o.source === 'object' && o.source.type === 'workspace_catalog');
  if (url) return require('./brand-coherence.js').catalogRowForeign({ product_url: url }, verdict);
  return fromCatalog && verdict.excluded === true;
}

/** The products a slot names: its hero offering, hero product and supports. */
function slotForeignProducts(entry, verdict) {
  if (!entry || !verdict) return false;
  if (entry.strategy_only === true || (entry.heroProduct && entry.heroProduct.placeholder === true && !entry.heroOffering)) return false;
  const items = [entry.heroOffering, entry.offering].concat(Array.isArray(entry.supportingProducts) ? entry.supportingProducts : []).filter(Boolean);
  return items.some((o) => offeringForeign(o, verdict));
}

/** The verdict when a stored or inline slot names another brand's product. */
async function staleForeignSlot(entry, config) {
  if (!entry || typeof entry !== 'object') return null;
  const probe = { workspace_id: entry.workspace_id || null };
  try { await stampBrand(probe, config); } catch (_) { /* fall back to the slot's own */ }
  const brand = probe.brand || entry.brand || null;
  const verdict = brand ? catalogServer.catalogVerdict(brand) : null;
  return verdict && slotForeignProducts(entry, verdict) ? verdict : null;
}

/**
 * Strip another brand's products from a slot before anything is written from
 * it: the hero becomes the catalogue marker, supporting products and the
 * product offering go, and the slot says why. Returns the verdict when it
 * scrubbed, else null. The slot keeps its date, market, cohort and objective.
 */
function scrubForeignProducts(entry) {
  const verdict = entry && entry.brand ? catalogServer.catalogVerdict(entry.brand) : null;
  if (!verdict || !slotForeignProducts(entry, verdict)) return null;
  const where = entry.market ? String(entry.market).toUpperCase() : '';
  const name = (entry.brand && entry.brand.name) || 'this brand';
  entry.heroProduct = {
    title: `[DATA REQUIRED BEFORE LAUNCH: product catalogue, ${name}${where ? ', ' + where : ''}]`,
    sku: null, handle: null, category: null, placeholder: true,
  };
  entry.heroOffering = null;
  entry.offering = null;
  entry.supportingProducts = [];
  entry.theme = entry.objective || entry.theme || '';
  // Everything the slot said ABOUT that product goes too: the CTA named its
  // product type, the rationale and the analysis named the product.
  entry.cta = strategyCta(entry.objective);
  entry.why = `${verdict.sentence || 'This slot named another brand\'s product.'} Planned for ${name}${where ? ' (' + where + ')' : ''} without a product until its own catalogue is connected.`;
  try {
    entry.analysis = buildEntryAnalysis({
      cohort: { name: (entry.cohort && entry.cohort.name) || '', size: null }, product: entry.heroProduct,
      channels: Array.isArray(entry.channels) ? entry.channels : [], objective: entry.objective, market: where || '',
      confidence: { score: typeof entry.confidence === 'number' ? entry.confidence : 0.35, factors: [] }, dataSource: 'lifecycle-strategy',
    });
  } catch (_) { delete entry.analysis; }
  entry.catalog_excluded = { domain: verdict.domain, marker: verdict.marker, sentence: verdict.sentence || 'This slot named products read from another brand\'s site; they are not used.' };
  const gaps = Array.isArray(entry.data_gaps) ? entry.data_gaps : [];
  entry.data_gaps = [...new Set(gaps.concat([verdict.marker]))];
  return verdict;
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
  let markets = regions.map((r) => String(r.code || '').toUpperCase()).filter(Boolean);
  if (!offerings.length) return [];
  // A brand with offerings and no declared market still plans its OWN
  // offerings (2026-10-23): it used to fall to the no-catalogue strategy plan,
  // whose marker named the wrong gap. The gap is the home market, said once
  // per slot.
  const noMarket = !markets.length;
  if (noMarket) markets = ['UNDECLARED'];
  const homeGap = noMarket ? require('./brand-locale.js').marker('home market', brand) : null;
  const rnd = _mulberry32(String(brand.slug || brand.name || 'brand'));
  const cohorts = ['Nurture', 'Engaged', 'At Risk', 'Winback'];
  const entries = [];
  // A catalogue row filed under a market is that market's (its price is in
  // that market's currency); a row with no market serves every market.
  const canon = (c) => { try { return require('./catalog-import.js').canonRegion(c) || String(c || '').toLowerCase(); } catch (_) { return String(c || '').toLowerCase(); } };
  const forMarket = {};
  for (const m of markets) {
    // ...and an offering priced in a currency belongs to markets in that
    // currency (an INR price is never shown to the US).
    let cur = '';
    try { cur = require('./catalog-import.js').marketCurrency(canon(m)) || ''; } catch (_) { cur = ''; }
    const mine = offerings.filter((o) => (!o.region || canon(o.region) === canon(m))
      && (!o.currency || !cur || String(o.currency).toUpperCase() === cur));
    forMarket[m] = mine.length ? mine : [];
  }
  // An event inside its ramp takes only its milestone days, so the rest of
  // the catalogue still rotates (a save-the-date every day for six weeks is
  // spam): announce, early, a week out, the day before, the day, and two
  // follow-ups.
  const MILESTONES = new Set([45, 30, 21, 14, 7, 3, 1, 0, -1, -3]);
  for (let i = 0; i < days; i++) {
    const date = addDaysIso(startDate, i);
    // Rotation on the ABSOLUTE day number, never the offset from today: the
    // same calendar date resolves to the same cohort and offering on every
    // daily sync, so its id is stable and a re-sync never adds a second slot
    // beside the first (2026-10-23, the calendar audit).
    const epoch = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) || i;
    for (const market of markets) {
      const offerings = forMarket[market];
      if (!offerings.length) continue;
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
          && urgent.days_until !== null && urgent.days_until <= RAMP_DAYS && MILESTONES.has(urgent.days_until)) {
        rotated = urgent;                                   // the window is closing: it wins
      } else {
        const pool = offerings.filter((o) => {
          if (!KINDS.isDateBound(o.kind)) return true;      // evergreen always eligible
          const p = oc.planSend(o, date);
          if (!p.viable) return false;                      // a past event is never eligible
          // A RECURRING offering (a daily series, a rolling training plan) is
          // date-bound by kind but carries no single date - it runs any time.
          if (p.days_until === null) return true;
          return false;                                     // a dated event: only on its milestone days (above)
        });
        const list = pool.length ? pool : offerings;
        const pick = list[(epoch + markets.indexOf(market)) % list.length];
        const p = oc.planSend(pick, date);
        rotated = (p && p.viable) ? p : (urgent && urgent.viable ? urgent : null);
      }
      if (!rotated || !rotated.viable) continue;
      const useOff = rotated.offering;
      const cohort = cohorts[(epoch + markets.indexOf(market)) % cohorts.length];
      const confidence = Math.round((0.45 + rnd() * 0.3) * 100) / 100;   // demo, deterministic
      // The public moment of THIS market on this date (Diwali for IN,
      // Thanksgiving for US), from market-moments.js - never another market's
      // holidays and never tenant zero's audience days (2026-10-05).
      const moment = require('./market-moments.js').momentOn(market, date, brand);
      // The AUDIENCE decides the job of an evergreen send (2026-10-17). Every
      // row read "Drive the reader to buy this product." whatever the cohort,
      // so a lapsed customer and a first-time reader got the same brief. A
      // dated offering keeps its phase's job (the date is the reason to send).
      // The job names the product as a person says it: the range, never the
      // store's model code ("Vincent Chase Online VC E13033" -> "Vincent Chase Online").
      const objective = (rotated.phase && rotated.phase !== 'evergreen') ? rotated.job : cohortJob(cohort, require('./mailer-format.js').displayName(useOff.name) || useOff.name, rotated.job);
      entries.push({
        id: stableId(date, market, cohort, ns),
        date, market,
        ...(homeGap ? { data_gaps: [homeGap] } : {}),
        festival: moment ? { name: moment.name, weight: moment.weight, tags: moment.tags } : null,
        status: 'needs_human_verification',
        confidence,
        cohort: { name: cohort, size: null, estimated: true },
        objective,
        theme: `${useOff.name} (${useOff.kind})`,
        heroOffering: useOff,
        offering: useOff,
        heroProduct: {
          title: useOff.name,
          handle: useOff.handle || null,
          category: useOff.type || useOff.kind,
          price: useOff.price != null ? useOff.price : null,
          compare_at: useOff.compare_at != null ? useOff.compare_at : null,
          currency: useOff.currency || null,
          image: useOff.image || null,
          product_url: useOff.url || useOff.product_url || null,
          tags: useOff.tags || [],
          unit_spec: useOff.unit_spec || null,
          piece_count: useOff.piece_count || null,
          servings: useOff.servings || null,
          claims: useOff.claims || [],
          metrics: useOff.metrics || null,
          kind: useOff.kind,
          author: useOff.author || null,
          read_time: useOff.read_time || null,
          // Proof the store states (its own popularity rank, a stated rating,
          // stated reads), never a default (offering-intelligence.enrich).
          proof: (() => { try { return require('./offering-intelligence.js').enrich(Object.assign({ title: useOff.name, product_url: useOff.url }, useOff)).proof; } catch (_) { return []; } })(),
        },
        channels: plannedChannels(require('../../lib/smart-brain/services.js').BASE_CHANNELS, brand),
        cta: useOff.kind === 'product' && /food|poultry|deli|restaurant/i.test(brand.industry || '')
          ? (useOff.type ? 'Order ' + useOff.type : 'Explore the menu') : rotated.cta,
        cta_url: rotated.cta_url || null,
        phase: rotated.phase,
        why: `Planned from ${brand.name}'s own catalogue: ${useOff.kind} "${useOff.name}"${rotated.phase && rotated.phase !== 'evergreen' ? `, ${rotated.phase} phase` : ''}${moment ? `, on ${moment.name} in ${market}` : ''}. Confidence is a DEMO figure; connect real analytics to replace it.`,
        analysis: buildEntryAnalysis({
          cohort: { name: cohort, size: null, estimated: true },
          product: { title: useOff.name, category: useOff.kind },
          channels: plannedChannels(require('../../lib/smart-brain/services.js').BASE_CHANNELS, brand),
          objective,
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
function freshEntries(config, ctx, startDate, days, brand, contactLedger) {
  const calendar = new CalendarIntelligenceService(config).generate({
    analysis: ctx.analysis,
    competitorBenchmarks: ctx.competitorBenchmarks,
    startDate,
    days,
    feedback: ctx.ownData.feedback,
    brand: brand || null,
    contactLedger: contactLedger || null,
  });
  // The replenishment line in the insights says what the PLAN found (who is
  // due, who has lapsed, how old the history is), not only what the model
  // measured - a stale export with nobody due must say so on the console.
  noteReplenishment(ctx, calendar.replenishment);
  // Re-key on date+market so the same slot keeps the same id across daily syncs.
  const cohortLtv = cohortLtvMap(ctx);
  for (const e of calendar.entries) {
    // A replenishment slot carries `slot_key` (its trigger kind + a hash of its
    // product group): two product groups due the same day would otherwise share
    // an id once the cohort name is cut to the id's 32-character slug.
    e.id = stableId(e.date, e.market, e.cohort && (e.cohort.slot_key || e.cohort.name));
    attachScenarioLayer(e, ctx, cohortLtv);
  }
  return calendar.entries;
}

/** Replace the model-only replenishment insight with the plan's own line. */
function noteReplenishment(ctx, due) {
  if (!ctx || !ctx.analysis || !due || !due.insight) return;
  const list = Array.isArray(ctx.analysis.dailyInsights) ? ctx.analysis.dailyInsights : (ctx.analysis.dailyInsights = []);
  const i = list.findIndex((l) => /^Replenishment/.test(String(l)));
  if (i >= 0) list[i] = due.insight; else list.push(due.insight);
  ctx.analysis.replenishment_due = due;
}

/**
 * Replenishment slots for a workspace that is NOT tenant zero, from ITS OWN
 * synced orders. `allowBundled: false` is passed whatever the adapter would
 * answer: this branch already knows the brand is not tenant zero, so the order
 * export compiled into this build is never even asked about. A workspace with
 * no orders gets the explicit no-history state in its insights and no slot.
 * The same frequency-cap pass the tenant-zero calendar runs is applied here.
 */
async function ownReplenishment(config, db, brand, start, days, ns) {
  const RM = require('./replenishment-model.js');
  let hist;
  try { hist = await db.orderHistory({ allowBundled: false }); } catch (_) { hist = RM.noHistory(); }
  // This workspace's own engagement scores (review finding on #135): without
  // them every due buyer was "unchecked" and kept - bounces, complaints,
  // suppressed and capped contacts included.
  let engagement = null;
  try { engagement = await db.engagementContacts(); } catch (_) { engagement = null; }
  const analysis = RM.analyse(hist, { contacts: engagement ? engagement.map : [] });
  const markets = ((brand && Array.isArray(brand.regions)) ? brand.regions : []).map((r) => String(r.code || '').toUpperCase()).filter(Boolean);
  let entries = [];
  let due = null;
  if (analysis.state === 'ok' && markets.length) {
    const rep = replenishmentEntries({ replenishment: analysis, startDate: start, days, markets, brand, config });
    entries = enforceFrequencyCap(rep.entries, start);
    for (const e of entries) e.id = stableId(e.date, e.market, e.cohort && (e.cohort.slot_key || e.cohort.name), ns);
    due = rep.due;
  }
  return { analysis, entries, insight: (due && due.insight) || RM.insight(analysis, due) };
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
  // Owned messaging (SMS / WhatsApp / push) is owned like email: every
  // scenario keeps it where the brand sends on it (2026-10-23).
  let channels = baseChannels.filter((c) => L.channelMix.includes(c) || c === 'sms' || c === 'whatsapp' || c === 'push');
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
// WHOSE brand a stored slot or campaign was made for (2026-10-11). The live
// project's only workspace was renamed Mamaearth -> DelhiChic and its website
// and catalogue changed under it; 360 of its 656 stored slots still carried
// tenant zero's sneakers and 70 said Mamaearth, and the console replayed them
// because nothing recorded which brand they were built FOR. A fingerprint of
// the record's identity - workspace, name, website, legal sender, the
// catalogue's source and whether it is excluded - is stamped on every slot
// the planner writes and every campaign the builder makes; a stored slot or
// campaign whose fingerprint is not the current record's is never shown,
// reused or approved, and Daily Sync re-plans it. A row with no fingerprint
// predates this and is treated the same way.
// The fingerprint itself lives in brand-identity.js now (2026-10-11), the ONE
// rule every surface that stores brand-derived artefacts uses.
const brandIdentity = require('./brand-identity.js').brandIdentity;
const IDENTITY_KEY = '__brand_identity';
function identityMatches(stamp, current) { return !!current && stamp === current; }
// A stored row speaks for its slot; an inline entry with no row is judged only
// when it carries a stamp (a device plan built in this request carries none).
function slotForOtherRecord(entry, row, ident) {
  // No identity for the brand this request plans for: a stored row or a
  // stamped slot cannot be checked against it, so it is not replayed
  // (2026-10-11). An unstamped inline slot built in this request has nothing
  // stored to replay.
  if (!ident) return !!row || !!(entry && entry[IDENTITY_KEY]);
  if (row) return !identityMatches((row.payload || {})[IDENTITY_KEY], ident);
  return !!(entry && entry[IDENTITY_KEY]) && entry[IDENTITY_KEY] !== ident;
}

// A stored row stamped for an earlier version of the record, when the request
// carries the SAME slot as the server planned it for the record as it is now
// (2026-10-24, production /brain, Lenskart): Daily Sync's in-place refresh of
// such rows did not land, getPlan then served the freshly planned slots under
// the same ids, and every View and Generate all was refused "brand_changed".
// The current plan wins: the row is re-planned in place with the slot the
// page holds, its old campaign link dropped, and the build goes on. An
// approved/final row is its reviewer's and is never replaced this way.
async function adoptCurrentSlot(entry, row, ident, db, config) {
  if (!row || !ident || !entry || entry[IDENTITY_KEY] !== ident) return false;
  if (identityMatches((row.payload || {})[IDENTITY_KEY], ident)) return false;
  if (!['tentative', 'rejected', 'needs_human_verification'].includes(row.status)) return false;
  const payload = { ...entry };
  delete payload[PREBUILD_MARKER];
  delete payload[PREVIEW_MARKER];
  delete payload.brand;
  delete payload.workspace_id;
  const log = Array.isArray(row.change_log) ? row.change_log.slice(-30) : [];
  log.push({ at: nowIso(), kind: 'updated', detail: 'built for another brand record: re-planned for this one' });
  try {
    await db.update(config.tableNames.calendarEntries, { id: `eq.${row.id}`, status: SYNC_WRITABLE_STATUSES },
      { status: 'tentative', payload, change_log: log, updated_at: nowIso() });
  } catch (_) { /* the build below does not depend on the write */ }
  row.payload = payload; row.status = 'tentative'; row.generated_campaign_id = null;
  return true;
}

function materialDiff(oldPayload, fresh) {
  const diffs = [];
  if (fresh && fresh[IDENTITY_KEY] && oldPayload[IDENTITY_KEY] !== fresh[IDENTITY_KEY]) diffs.push('built for another brand record: re-planned for this one');
  if ((oldPayload.cohort?.name) !== (fresh.cohort?.name)) diffs.push(`cohort ${oldPayload.cohort?.name} → ${fresh.cohort?.name}`);
  if ((oldPayload.heroProduct?.sku) !== (fresh.heroProduct?.sku)) diffs.push(`hero product ${oldPayload.heroProduct?.title || oldPayload.heroProduct?.sku} → ${fresh.heroProduct?.title || fresh.heroProduct?.sku}`);
  if (oldPayload.objective !== fresh.objective) diffs.push(`objective ${oldPayload.objective} → ${fresh.objective}`);
  if (JSON.stringify(oldPayload.channels) !== JSON.stringify(fresh.channels)) diffs.push(`channels ${JSON.stringify(oldPayload.channels)} → ${JSON.stringify(fresh.channels)}`);
  if (Math.abs((oldPayload.confidence || 0) - (fresh.confidence || 0)) >= 0.05) diffs.push(`confidence ${oldPayload.confidence} → ${fresh.confidence}`);
  return diffs;
}

// The contact-policy state of a slot (2026-10-04): the plan-time cap, the
// per-slot eligibility and the planned recipients that follow from it.
function contactStateOf(p) {
  const r = (p && p.reach) || {};
  const e = r.eligibility || {};
  const c = r.frequency_cap || {};
  return JSON.stringify([e.status || null, e.eligible == null ? null : e.eligible, e.suppressed == null ? null : e.suppressed,
    e.deferred == null ? null : e.deferred, e.reason || null, e.by_reason || null, c.status || null, c.sends_in_rolling_7d == null ? null : c.sends_in_rolling_7d]);
}
function contactStateChanged(oldPayload, fresh) {
  return !!(fresh && fresh.reach && fresh.reach.eligibility) && contactStateOf(oldPayload) !== contactStateOf(fresh);
}
function withContactState(payload, fresh) {
  if (!fresh || !fresh.reach) return payload;
  payload.reach = Object.assign({}, payload.reach || {}, {
    eligibility: fresh.reach.eligibility,
    frequency_cap: fresh.reach.frequency_cap,
    planned_recipients: fresh.reach.planned_recipients == null ? null : fresh.reach.planned_recipients,
  });
  if (fresh.message_class) payload.message_class = fresh.message_class;
  if (fresh.feasibility) payload.feasibility = fresh.feasibility;
  return payload;
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

/**
 * The brand's contact rules and ledger for a plan starting `start` (2026-10-04):
 * its workspace's own ledger, or the history and rules a device brand's
 * request carried. Never throws: an unreadable ledger is a STATE every slot
 * then states ("eligibility unknown"), not a failed plan.
 */
async function planContactLedger(config, contact, start) {
  try {
    return await require('./contact-ledger.js').contextFor({
      workspaceId: (config && config.workspace_id) || null,
      carried: (contact && contact.ledger) || null,
      policy: (contact && contact.policy) || null,
      since: Date.parse(`${start}T00:00:00Z`) - 9 * 86400000,
    });
  } catch (e) {
    return { available: false, reason: 'store_unreachable', note: String((e && e.message) || e).slice(0, 160) };
  }
}

async function syncDaily({ config: cfg = {}, days, persist = true, contact = null } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const horizon = days || config.calendarDays;
  const start = todayIso();
  const contactLedger = await planContactLedger(config, contact, start);
  // Near-term slots inside this window get their prebuilt assets regenerated on
  // EVERY sync (fresh creatives vs. the latest competitor + campaign data), even
  // without a material plan change.
  const refreshDays = Number.isFinite(+config.prebuildRefreshDays) ? +config.prebuildRefreshDays : 7;
  const refreshUntil = addDaysIso(start, refreshDays);
  // A non-tenant-zero workspace plans from ITS OWN offerings and regions; the
  // shipped context (catalogue, analytics, moments) describes tenant zero only
  // and is never synthesized into another brand's workspace.
  const pb = await planningBrand(config, db);
  let ctx, fresh, planned = { source: 'data' };
  if (!pb.isZero) {
    const offs = pb.brand ? _resolveBrandOfferings(pb.brand) : [];
    const ns = workspaceNs(config.workspace_id || (pb.brand && pb.brand.id), pb.isZero);
    fresh = pb.brand ? offeringPlanEntries(pb.brand, offs, start, horizon, ns) : [];
    const own = pb.brand ? await ownReplenishment(config, db, pb.brand, start, horizon, ns) : null;
    if (own) fresh = fresh.concat(own.entries);
    // No catalogue and no orders: still build the rolling window from the
    // lifecycle sequence. A missing brand record stays empty (nothing to
    // name the plan after).
    planned = withStrategyFallback(pb.brand, fresh, start, horizon, ns);
    fresh = planned.entries;
    // The same plan-time cap and per-slot eligibility the shipped planner
    // applies: a brand planned from its own offerings is held to the same
    // contact rules as tenant zero.
    applyContactPolicy(fresh, contactLedger, null, start, config);
    if (!fresh.length) {
      // Carry the SAME keys as the success return below. A caller that reads
      // `plan` got undefined here and rendered its untouched previous screen,
      // so a brand with nothing to plan looked identical to a sync that had
      // never been clicked. `insights` is present for the same reason.
      return {
        ok: true, mode: db.connected ? 'db-linked' : 'local-fallback',
        synced_at: new Date().toISOString(), horizon_days: horizon,
        changes: [], insights: [], entries: [], plan: [], note: emptyPlanNote(pb.brand),
      };
    }
    const markets = Array.from(new Set(fresh.map((e) => e.market)));
    const strategyInsight = planned.source === 'lifecycle-strategy';
    ctx = {
      analysis: {
        dailyInsights: (strategyInsight
          ? [
            `Rolling calendar built from lifecycle strategy for ${pb.brand.name}: education, second order, pre-lapse retention, expansion, reactivation. One job a day, each audience about once a week.`,
            strategyNote(pb.brand, declaredMarkets(pb.brand)),
          ]
          : [
            `Plan generated from ${pb.brand.name}'s own catalogue (${offs.length} offerings) for its real region(s): ${markets.join(', ')}.`,
            'Confidence figures are DEMO values; reach and feasibility stay DATA REQUIRED until this brand\'s own analytics connect.',
          ]).concat(own && own.insight ? [own.insight] : []),
        cohorts: [],
        replenishment: own ? own.analysis : null,
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
    fresh = freshEntries(zeroCfg, ctx, start, horizon, pb.brand || require('./brand-runtime.js').defaultBrand(), contactLedger);
  }

  const ident = await currentIdentity(config, db);
  if (ident) for (const e of fresh) e[IDENTITY_KEY] = ident;

  const changes = [];
  let stored = [];
  if (db.connected && persist) {
    stored = await selectAllRows(db, config.tableNames.calendarEntries, {
      filters: { date: `gte.${start}` }, order: 'date.asc,id.asc',
    });
  }
  const storedById = new Map(stored.map((r) => [r.id, r]));
  // Slots already stored from a catalogue the coherence rule now calls another
  // brand's (2026-10-10): a writable one is archived with the reason, so the
  // prebuild queue never builds it and the plan never shows it; an approved
  // one is left to its reviewer (getPlan hides it, preview shows the marker).
  const staleForeign = [];
  if (!pb.isZero && pb.brand) {
    const verdict = catalogServer.catalogVerdict(pb.brand);
    for (const r of stored) {
      if ((r.status === 'tentative' || r.status === 'rejected' || r.status === 'needs_human_verification') && slotForeignProducts(r.payload || {}, verdict)) staleForeign.push({ row: r, verdict });
    }
  }

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
        // Reported only after the conditional UPDATE lands (below). A skipped
        // lock used to still print "updated" / "built for another brand record"
        // while getPlan kept hiding the old payload (2026-10-14).
        change: { id: entry.id, kind: wasRejected ? 'regenerated' : 'updated', detail: `${entry.date} ${entry.market}: ${diffs.join('; ') || 'regenerated after rejection'}.` },
      });
    } else if (entry.date <= refreshUntil && isPrebuilt(existing)) {
      // No material re-plan, but this near-term slot is inside the daily
      // freshness window: drop the prebuilt marker so the queue regenerates its
      // mailer/ads/landing against the latest competitor + campaign data. Keep
      // the (unchanged) plan payload; only the marker is stripped.
      const payload = withContactState({ ...(existing.payload || {}) }, entry);
      delete payload[PREBUILD_MARKER];
      const log = Array.isArray(existing.change_log) ? existing.change_log.slice(-30) : [];
      log.push({ at: nowIso(), kind: 'refresh_queued', detail: 'Daily freshness refresh: assets queued to rebuild against latest data.' });
      updates.push({
        id: entry.id,
        patch: { status: 'tentative', payload, change_log: log, updated_at: nowIso() },
        change: { id: entry.id, kind: 'refresh_queued', detail: `${entry.date} ${entry.market}: queued daily asset refresh.` },
      });
    } else if (contactStateChanged(existing.payload || {}, entry)) {
      // Nothing to re-plan or rebuild, but who may be contacted on this slot
      // moved (a send went out yesterday; a brand tightened its rules). The
      // slot SAYS so the same day: only the contact fields are patched, so the
      // prebuilt assets are kept rather than rebuilt for a count.
      const before = ((existing.payload || {}).reach || {}).eligibility || {};
      const log = Array.isArray(existing.change_log) ? existing.change_log.slice(-30) : [];
      const detail = `Contact rules: ${before.label || 'eligibility not evaluated'} → ${entry.reach.eligibility.label}; cap ${entry.reach.frequency_cap.status}.`;
      log.push({ at: nowIso(), kind: 'contact_rules', detail });
      updates.push({
        id: entry.id,
        patch: { payload: withContactState({ ...(existing.payload || {}) }, entry), change_log: log, updated_at: nowIso() },
        change: { id: entry.id, kind: 'contact_rules', detail: `${entry.date} ${entry.market}: ${detail}` },
      });
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
    // Slots made for another version of the brand record that this plan does
    // not re-plan in place (2026-10-11): archived with the reason, so neither
    // the console nor the prebuild queue ever touches them again.
    if (ident) {
      const freshIds = new Set(fresh.map((e) => e.id));
      for (const r of stored) {
        if (freshIds.has(r.id) || !(r.status === 'tentative' || r.status === 'rejected' || r.status === 'needs_human_verification')) continue;
        if (identityMatches((r.payload || {})[IDENTITY_KEY], ident)) continue;
        if (staleForeign.some((sf) => sf.row.id === r.id)) continue;
        const log = Array.isArray(r.change_log) ? r.change_log.slice(-30) : [];
        const detail = 'Archived: planned for an earlier version of this brand record (another name, website, legal sender or catalogue).';
        log.push({ at: nowIso(), kind: 'brand_changed', detail });
        const upd = await db.update(config.tableNames.calendarEntries, { id: `eq.${r.id}`, status: SYNC_WRITABLE_STATUSES }, { status: 'archived', change_log: log, updated_at: nowIso() }).catch(() => null);
        if (upd && upd.ok) changes.push({ id: r.id, kind: 'brand_changed', detail: `${r.date} ${r.market}: ${detail}` });
      }
      // A still-editable slot of THIS record version that today's plan no
      // longer contains (2026-10-23, the calendar audit): the planner changed
      // its rotation, or a cap now holds the slot. Left in place it sat beside
      // the new slot on the same day, so a person got two sends. Archived with
      // the reason; an approved slot is its reviewer's and is never touched.
      const lastFresh = fresh.reduce((m, e) => (e.date > m ? e.date : m), '');
      for (const r of stored) {
        if (freshIds.has(r.id) || !(r.status === 'tentative' || r.status === 'needs_human_verification')) continue;
        if (!identityMatches((r.payload || {})[IDENTITY_KEY], ident)) continue;
        if (!lastFresh || String(r.date) > lastFresh || String(r.date) < start) continue;
        if (staleForeign.some((sf) => sf.row.id === r.id)) continue;
        const log = Array.isArray(r.change_log) ? r.change_log.slice(-30) : [];
        const detail = 'Archived: today\'s plan no longer has this slot (the rotation or the contact cap changed it).';
        log.push({ at: nowIso(), kind: 'superseded', detail });
        const upd = await db.update(config.tableNames.calendarEntries, { id: `eq.${r.id}`, status: 'in.(tentative,needs_human_verification)' }, { status: 'archived', change_log: log, updated_at: nowIso() }).catch(() => null);
        if (upd && upd.ok) changes.push({ id: r.id, kind: 'superseded', detail: `${r.date} ${r.market}: ${detail}` });
      }
    }
    for (const sf of staleForeign) {
      if (fresh.some((e) => e.id === sf.row.id)) continue;   // re-planned in place above
      const log = Array.isArray(sf.row.change_log) ? sf.row.change_log.slice(-30) : [];
      const detail = `Archived: planned from another brand's catalogue (${sf.verdict.domain || 'another site'}). ${sf.verdict.sentence || ''}`.trim();
      log.push({ at: nowIso(), kind: 'catalogue_excluded', detail });
      const upd = await db.update(config.tableNames.calendarEntries, { id: `eq.${sf.row.id}`, status: SYNC_WRITABLE_STATUSES }, { status: 'archived', change_log: log, updated_at: nowIso() }).catch(() => null);
      if (upd && upd.ok) changes.push({ id: sf.row.id, kind: 'catalogue_excluded', detail: `${sf.row.date} ${sf.row.market}: ${detail}` });
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
        if ((upd.rows || []).length) {
          results.updated += 1;
          if (u.change) changes.push(u.change);
        } else results.skipped_locked += 1; // human approved/finalized mid-sync
      } else { results.warnings.push(upd.warning); }
    }
    // A write that did not land is said, never folded into "no material
    // changes" (2026-10-24): the stored row keeps its old plan until it lands.
    const lost = results.warnings.filter(Boolean);
    if (lost.length) changes.push({ id: null, kind: 'not_saved', detail: `${lost.length} planned change(s) could not be saved to the calendar store; the plan shown is today's, and View or Generate re-plans each slot as it opens. First reason: ${String(lost[0]).slice(0, 240)}` });
    persistence = { ok: true, ...results };
    // Roll past slots out of the active window.
    await db.update(config.tableNames.calendarEntries, { date: `lt.${start}`, status: SYNC_WRITABLE_STATUSES }, { status: 'archived', updated_at: nowIso() }).catch(() => {});
    await db.insert(config.tableNames.runs, [{
      id: `run_${Date.now().toString(36)}`,
      payload: { kind: 'daily-sync', start, horizon, changes, insights: ctx.analysis.dailyInsights },
      created_at: nowIso(),
    }]).catch(() => {});
    persistence.pruned = await pruneOldRecords(config, db);
  } else {
    // No write this run: still list intended updates so a dry-run / device
    // preview is not an empty Changes panel.
    for (const u of updates) if (u.change) changes.push(u.change);
  }

  const plan = await getPlan({ config: cfg, _ctxFallback: { config, db, ctx, fresh }, contact });
  const out = {
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
  if (planned.source === 'lifecycle-strategy') {
    out.plan_source = 'lifecycle-strategy';
    out.note = strategyNote(pb.brand, declaredMarkets(pb.brand));
  }
  return out;
}

// ── Read current plan ───────────────────────────────────────────────────────

/**
 * Every row of a calendar read, paged to an EMPTY page (2026-10-23, the
 * calendar audit): a 90-day plan over four markets is ~1,440 slots, and one
 * read of `limit 1000` (PostgREST's max_rows is 1,000 too) dropped its last
 * weeks - the console never showed them and daily sync re-created them as
 * "new" every run. Bounded at 20,000 rows.
 */
async function selectAllRows(db, table, { filters = {}, order, pageSize = 1000, maxRows = 20000 } = {}) {
  const out = [];
  let prevFirst = null;
  while (out.length < maxRows) {
    const f = Object.assign({}, filters);
    if (out.length) f.offset = String(out.length);
    let page;
    try { page = await db.select(table, { filters: f, order, limit: pageSize }); } catch (_) { page = []; }
    if (!Array.isArray(page) || !page.length) break;
    // A server that ignores `offset` hands the same page back for ever: the
    // same first row twice is the end, not more rows.
    const first = page[0] && page[0].id != null ? page[0].id : JSON.stringify(page[0]);
    if (prevFirst !== null && first === prevFirst) break;
    prevFirst = first;
    out.push(...page);
  }
  return out.slice(0, maxRows);
}

async function getPlan({ config: cfg = {}, _ctxFallback = null, contact = null } = {}) {
  const config = _ctxFallback?.config || smartConfig(cfg);
  const db = _ctxFallback?.db || new SmartBrainDbAdapter(config);
  if (db.connected) {
    let rows = await selectAllRows(db, config.tableNames.calendarEntries, {
      filters: { date: `gte.${todayIso()}`, status: 'neq.archived' }, order: 'date.asc,market.asc,id.asc',
    });
    // Only slots made for the brand record as it is NOW (2026-10-11).
    if (rows.length) {
      const ident = await currentIdentity(config, db);
      rows = ident ? rows.filter((r) => identityMatches((r.payload || {})[IDENTITY_KEY], ident)) : [];
    }
    if (rows.length) {
      // Stored campaigns can outlive a rebrand or a catalog removal. Check
      // every row: one matching hero must not keep foreign products alongside it.
      try {
        const current = await planningBrand(config, db);
        if (!current.isZero) {
          const offerings = current.brand ? _resolveBrandOfferings(current.brand) : [];
          const own = new Set(offerings.map(o => String(o.name || '').trim().toLowerCase()));
          rows = rows.filter(row => {
            const payload = row.payload || {};
            const products = [payload.heroProduct, ...(payload.supportingProducts || [])].filter(Boolean);
            if (payload.strategy_only === true && products.length === 1 && payload.heroProduct.placeholder === true
                && String(payload.heroProduct.title || '').startsWith('[DATA REQUIRED BEFORE LAUNCH: product catalogue, ' + (current.brand && current.brand.name) + ',')) return true;
            return products.length && products.every(product => own.has(String(product.title || product.name || '').trim().toLowerCase()));
          });
        }
      } catch (_) {
        // An unverified old campaign must never become another brand's data.
        rows = [];
      }
    }

    if (rows.length) {
      return {
        ok: true, mode: 'db-linked', stored: true,
        // Row date/market win over payload copies (2026-10-14): the region and
        // duration filters in smart-brain.html read entry.market / entry.date.
        // A payload that lost them (or kept another brand's spelling) made
        // India + Next 7 days show 0 while Changes still named IN slots.
        entries: rows.map((r) => ({
          ...(r.payload || {}),
          id: r.id,
          date: r.date || (r.payload && r.payload.date),
          market: r.market || (r.payload && r.payload.market),
          status: r.status,
          confidence: r.confidence,
          change_log: r.change_log,
          generated_campaign_id: r.generated_campaign_id,
          approved_by: r.approved_by,
          approved_at: r.approved_at,
          updated_at: r.updated_at,
        })),
      };
    }
  }
  // Stateless preview: no DB (or empty table) — generate on the fly. The
  // shipped catalogue describes tenant zero only, so any other workspace plans
  // from ITS OWN offerings and regions (demo numbers, real catalogue). A brand
  // with neither offerings nor orders still gets the lifecycle-strategy
  // calendar. Only a missing brand record is an empty plan.
  const pb = await planningBrand(config, db);
  if (!pb.isZero) {
    const offs = pb.brand ? _resolveBrandOfferings(pb.brand) : [];
    const ns = workspaceNs(config.workspace_id || (pb.brand && pb.brand.id), pb.isZero);
    const start = todayIso();
    let entries = pb.brand ? offeringPlanEntries(pb.brand, offs, start, config.calendarDays, ns) : [];
    if (pb.brand) entries = entries.concat((await ownReplenishment(config, db, pb.brand, start, config.calendarDays, ns)).entries);
    const planned = withStrategyFallback(pb.brand, entries, start, config.calendarDays, ns);
    entries = planned.entries;
    if (!entries.length) {
      return { ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', stored: false, entries: [], note: emptyPlanNote(pb.brand) };
    }
    applyContactPolicy(entries, await planContactLedger(config, contact, start), null, start, config);
    return {
      ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', stored: false,
      plan_source: planned.source,
      entries: entries.map((e) => ({ ...e, [IDENTITY_KEY]: brandIdentity(pb.brand), status: 'tentative' })),
      note: planned.source === 'lifecycle-strategy'
        ? strategyNote(pb.brand, declaredMarkets(pb.brand))
        : `Plan generated from ${pb.brand.name}'s own catalogue and regions. Confidence figures are DEMO until real analytics connect.`,
    };
  }
  let cfg2 = config;
  try {
    const zero = require('./brand-runtime.js').defaultBrand();
    const codes = (zero.regions || []).map((r) => String(r.code || '').toUpperCase()).filter(Boolean);
    if (codes.length) cfg2 = Object.assign({}, config, { markets: codes });
  } catch (_) {}
  const ctx = _ctxFallback?.ctx || await buildContext(cfg2, db);
  const entries = _ctxFallback?.fresh || freshEntries(cfg2, ctx, todayIso(), cfg2.calendarDays, pb.brand || require('./brand-runtime.js').defaultBrand(), await planContactLedger(config, contact, todayIso()));
  const zeroIdent = await currentIdentity(config, db);
  return { ok: true, mode: db.connected ? 'db-linked' : 'local-fallback', stored: false, entries: entries.map((e) => ({ ...e, ...(zeroIdent ? { [IDENTITY_KEY]: zeroIdent } : {}), status: 'tentative' })) };
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
- Email structure (Dimond/Sharma): a pattern-interrupt HOOK in the first scroll, one clear idea, benefits taken from the brand's own facts, objection-killing social proof, one low-friction CTA. No wall of text.
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

// The 7-step high-conversion selling architecture every marketing asset must carry.
const MAILER_COMPONENTS = `Every marketing asset must follow the 7-Step High-Conversion Direct-Response Persuasion Architecture:
(1) THE PATTERN-INTERRUPT HOOK: First-scroll stop (curiosity loop, bold contrast, or friction callout). The subject line + preheader work together: preheader extends curiosity, never repeats subject.
(2) PROBLEM AGITATION & FRICTION: Agitate the real dilemma or hidden cost of inaction—why conventional alternatives fail or disappoint.
(3) WHAT IT IS: Introduce the offering through what the brand's own facts say it is and does, and nothing more.
(4) WHAT THE READER GETS: up to 3 benefits, each one a fact the brand or its catalogue states, said as what it means for the reader. Fewer than 3 when fewer are stated; never a quality, ingredient, standard or result the facts do not name.
(5) TRANSPARENT OFFER & PRICING ANCHOR: State the exact catalog price, what is included, and any shipping/bundle terms clearly without ambiguity.
(6) VERIFIED PROOF & RISK REVERSAL: Authentic social proof (drawn STRICTLY from approved proof library) and explicit risk reversal (satisfaction guarantee, trial, or hassle-free returns if stated).
(7) SINGLE HIGH-CONTRAST CALL TO ACTION & SKIMMER P.S.: Clear action-oriented CTA button driving to the PDP/destination, followed by a punchy P.S. that restates the core hook, deadline, or risk-reversal for bottom-scrollers.`;

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
  if (/food|poultry|deli|restaurant/i.test(b.industry || '')) lines.push('Use the food catalogue and food-appropriate calls to action. Pasture-raised sourcing, delivery times, freshness, ingredients and preparation claims require explicit evidence in this brand record; never substitute another brand\'s product copy or invent food claims.');
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

  lines.push('Return exactly what the OUTPUT REQUIREMENT at the end of the request states.');
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
  return `Adopt the role of an expert marketing strategist tasked with developing a comprehensive marketing strategy. Your primary objective is to increase brand awareness and drive sales for ${b.name || 'this brand'}${b.industry ? ` (${b.industry})` : ''} in a detailed, actionable plan format.
Take a deep breath and work on this problem step-by-step.
Force real tactics instead of generic advice:
- Analyze current market position and target audience truth.
- Develop a content marketing strategy with concrete creation guidelines.
- Create a social media marketing plan with realistic posting schedules.
- Design an email marketing campaign with high-converting direct-response hooks.
- Plan paid advertising initiatives with crisp budget allocation recommendations.
- Integrate all tactics into a cohesive strategy where each element builds on the one before it.
- Establish key performance indicators (KPIs) to measure success.
- Present your comprehensive marketing strategy in a bullet point list format, with clear headings for each major section and sub-bullets for specific tactics and recommendations, keeping the output easy to scan and easy to hand to a team.
${D2C_KNOWLEDGE}
Return exactly what the OUTPUT REQUIREMENT at the end of the request states.`;
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

function strategyPrompt(entry) { return OC.append(strategyTask(entry), strategyOutputSpec(entry)); }
function strategyTask(entry) {
  const d = entry.decision || {};
  return `Devise the comprehensive marketing strategy for ONE lifecycle send.
Context (#INFORMATION ABOUT ME):
- Business type: ${(entry.brand && (entry.brand.industry || entry.brand.category || entry.brand.name)) || 'D2C Brand'}
- Target audience: ${entry.market} | Cohort: ${entry.cohort?.name} (${entry.cohort?.size ?? 'size via ESP'} profiles) | Objective: ${entry.objective}
- Offering / Hero product: ${offeringBrief(entry)}${(entry.supportingProducts || []).length ? `\n- Bundle: ${(entry.supportingProducts).map((p) => p.title).join(', ')}` : ''}
- Current marketing efforts / Offer: ${d.offer ? (d.offer.code ? `${d.offer.code} (${Math.round((d.offer.pct || 0) * 100)}%)` : 'no discount') : 'n/a'}
- Marketing budget / Reach target: ${entry.reach?.planned_recipients?.toLocaleString?.() || 'n/a'} recipients, ${entry.reach?.per_user_per_week?.min || 2}-${entry.reach?.per_user_per_week?.max || 3} mailers/user/week.
- ${entry.festival ? `Seasonal moment: ${entry.festival.name}` : 'No festival; evergreen angle.'}
- ${regionalNuance(entry.market)}

${creativeEvidence.briefFor(entry)}

STRATEGY REQUIREMENTS (Cover all 7 strategic dimensions):
1. Analyze market positioning and audience truth: identify the precise behavioural trigger for this cohort now.
2. Develop a content marketing strategy and creation guidelines for this campaign angle.
3. Structure the strategy so each element builds on the one before it: hook -> insight -> mechanism -> proof -> call to action.
4. Provide actionable tactics for each marketing channel: content creation guidelines, posting schedules, and budget allocation recommendations.
5. Plan paid advertising initiatives with crisp visual briefs and scroll-stopping hooks.
6. Integrate all tactics into a cohesive multichannel strategy.
7. Establish key performance indicators (KPIs) to measure conversion, engagement, and retention success.
Choose the value framework (Hook-Story-Offer, PAS, or Identity-Driven) that best fits this cohort and say which in "framework".`;
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

/**
 * The compliance rules this slot's copy is linted against, briefed to the
 * writer from the SAME context checkAssetContracts() builds (brand, market,
 * approved claims, offer), so the writer and the gate cannot disagree about
 * which rules apply or what the mandated disclaimer says.
 */
function complianceBrief(entry) {
  try { return require('./compliance-lint.js').brief(complianceContext(null, entry)); } catch (_) { return ''; }
}

/*
 * WHAT THE STRATEGIST AND THE COPYWRITER RETURN (2026-10-11).
 * The prompts end with the OUTPUT REQUIREMENT rendered from these specs
 * (output-contract.js), and the answers are checked against the same specs.
 * The copy shape used to be a JSON skeleton of empty strings with no limit on
 * any field, while the asset contracts it is validated against afterwards hold
 * Google headlines to 30 characters and Meta primary text to 125: the writer
 * learnt the limits from the brand-system prose, if at all. The limits below
 * are READ from asset-contracts.js.
 */
const OC = require('./output-contract.js');
function strategyOutputSpec(entry) {
  const b = (entry && entry.brand) || {};
  return {
    id: 'smart-brain.strategy', kind: 'data', format: 'json', brand: b.name || 'this brand', region: entry && entry.market,
    returns: 'ONE JSON object: the strategy brief for this ONE send (angle, framework, hook, emotion, proof, differentiator, dos and donts).',
    schema: {
      angle: { type: 'string', note: 'the single sharp campaign angle' },
      framework: { type: 'string', enum: ['Hook-Story-Offer', 'PAS', 'Identity-Driven'] },
      hook_thesis: { type: 'string', note: 'why this lands for THIS cohort now' },
      target_emotion: { type: 'string', note: 'the one feeling to evoke' },
      proof_points: { type: 'array', count: [1, 3], items: { type: 'string', note: 'from the data above or the evidence block only' } },
      differentiator: { type: 'string', note: 'what makes this send distinct from the others this week' },
      dos: { type: 'array', count: [1, 3], items: 'string' },
      donts: { type: 'array', count: [1, 3], items: 'string' },
    },
  };
}
function copyOutputSpec(entry) {
  const ac = require('./asset-contracts.js');
  const messaging = require('./messaging-assets.js');
  const L = (id, slot) => ac.slotLimit(id, slot);
  const b = (entry && entry.brand) || {};
  const faq = { type: 'array', count: 2, items: { type: 'object', of: { q: 'string', a: 'string' } } };
  const img = { type: 'string', note: 'a TEXT-FREE photograph brief: scene, subject, light, mood; no words in the frame' };
  const proof = (what) => ({ required: false, note: `copied verbatim from the APPROVED PROOF LIBRARY, else ${what}` });
  return {
    id: 'smart-brain.copy', kind: 'data', format: 'json', brand: b.name || 'this brand', region: entry && entry.market,
    returns: `ONE JSON object holding the copy for every asset of this slot: the email, the landing page and the Meta, Google and TikTok ads, each with its image brief${messaging.plannedOn(entry).length ? `, and the ${messaging.plannedOn(entry).map((c) => (c === 'sms' ? 'SMS' : c === 'whatsapp' ? 'WhatsApp' : 'push')).join(', ')} message line${messaging.plannedOn(entry).length > 1 ? 's' : ''} (the sender, the link and the opt-out are added for you)` : ''}.`,
    lines: ['"rating": null, "reviews": [] and "badges": [] are the answer whenever the APPROVED PROOF LIBRARY is empty; "guarantee", "proof_quote" and "proof_author" are then empty strings.'],
    schema: {
      email: { type: 'object', of: {
        subject: { type: 'string', max: L('email.mailer', 'subject') }, subject_alt1: { type: 'string', max: L('email.mailer', 'subject') }, subject_alt2: { type: 'string', max: L('email.mailer', 'subject') },
        preheader: { type: 'string', max: L('email.mailer', 'preheader'), note: 'extends the subject, never repeats it' },
        hook: { type: 'string', note: 'the first-scroll pattern-interrupt line' }, hero_headline: { type: 'string', note: `at most ${ac.MAIL_WORDS.headline} words` },
        intro_paragraph: { type: 'string', note: `at most ${ac.MAIL_WORDS.paragraph} words` }, body_paragraph: { type: 'string', note: `at most ${ac.MAIL_WORDS.paragraph} words` },
        benefits: { type: 'array', count: [0, 3], items: { type: 'string', note: `at most ${ac.MAIL_WORDS.benefit} words` } },
        rating: Object.assign({ type: 'any' }, proof('null')), reviews: Object.assign({ type: 'array', items: 'any' }, proof('[]')),
        badges: Object.assign({ type: 'array', items: 'any' }, proof('[]')), guarantee: Object.assign({ type: 'string' }, proof('an empty string')),
        ps: { type: 'string', note: `the skimmer P.S. restating the core hook, deadline, or risk reversal; at most ${ac.MAIL_WORDS.ps} words` },
        faq, cta: 'string', image_brief: img } },
      landing: { type: 'object', of: {
        hero_headline: 'string', hero_sub: 'string', why_title: 'string', why_bullets: { type: 'array', count: [0, 3], items: 'string' },
        proof_quote: Object.assign({ type: 'string' }, proof('an empty string')), proof_author: Object.assign({ type: 'string' }, proof('an empty string')),
        faq, cta: 'string', image_brief: img } },
      ads: { type: 'object', of: {
        meta: { type: 'object', of: { primary_text: { type: 'string', max: L('ad.meta.static', 'primary_text') }, headline: { type: 'string', max: L('ad.meta.static', 'headline') }, description: { type: 'string', max: L('ad.meta.static', 'description') }, image_brief: img } },
        google: { type: 'object', of: { headlines: { type: 'array', count: [3, 15], items: { type: 'string', max: L('ad.google.rsa', 'headlines') } }, descriptions: { type: 'array', count: [2, 4], items: { type: 'string', max: L('ad.google.rsa', 'descriptions') } }, image_brief: img } },
        tiktok: { type: 'object', of: { script: { type: 'string', note: 'the spoken and shown beats, hook in the first second' }, caption: { type: 'string', max: L('ad.tiktok.video', 'caption') }, image_brief: img } } } },
      // SMS / WhatsApp / push, in the SAME call, only for a slot that plans
      // them (2026-10-23): a brand that states no such channel is briefed
      // exactly as before.
      ...(messaging.copySchema(entry) ? { messaging: messaging.copySchema(entry) } : {}),
    },
  };
}

/**
 * PRODUCT FACTS for the copywriter (2026-10-14). The writer used to get the
 * hero's title and nothing else, so "sensory, specific benefits" became filler
 * or invention. These are the facts THIS brand's own catalogue states for the
 * product (the row generation already matches), and the writer is told to use
 * only them; anything the row does not state is said to be absent, never
 * filled. The offer line says plainly when there is no offer on record.
 */
function productFactsBrief(entry) {
  const lines = [];
  let row = null;
  try { row = catalogImage.match(entry, entry.market, { brand: entry.brand }); } catch (_) { row = null; }
  const hp = entry.heroProduct || {};
  // The slot's own hero carries the planner's catalogue facts (title, price,
  // type) even when the image matcher finds no row for it (a device brand's
  // catalogue, a row matched by title only): the brief said "none on record"
  // and the live copy never named the product or its price (2026-10-17).
  if (!row && !hp.placeholder && hp.title && (Number(hp.price) > 0 || hp.category || hp.description)) {
    row = { n: hp.title, price: hp.price, compare_at: hp.compare_at, currency: hp.currency, type: hp.category, description: hp.description };
  }
  if (row && !hp.placeholder) {
    const name = String(row.n || hp.title || '').trim();
    const cur = String(row.currency || '').trim();
    const fmt = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return '';
      try { return require('./brand-locale.js').money(n, entry.brand, entry.market); } catch (_) { return cur ? `${n} ${cur}` : String(n); }
    };
    const price = fmt(row.price);
    const compare = Number(row.compare_at) > Number(row.price) ? fmt(row.compare_at) : '';
    lines.push(`PRODUCT FACTS (from the brand's own catalogue; use ONLY these, never add a fact they do not state):`);
    if (name) lines.push(`- Name: ${name}`);
    lines.push(price ? `- Price: ${price}${compare ? ` (was ${compare}, as the store states)` : ''}` : '- Price: not stated in the catalogue, so do not state a price.');
    if (row.type) lines.push(`- Product type: ${row.type}`);
    const desc = String(row.subtitle || row.description || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (desc) lines.push(`- How the store describes it: "${desc}"`);
    lines.push(`- Name the product in the subject line, the hero headline and every ad headline.`);
  } else {
    lines.push('PRODUCT FACTS: none on record for this slot beyond its name; state no price, size, material or feature.');
  }
  const o = entry.offer || {};
  const hasOffer = !!(o.code || (o.pct && Number(o.pct) > 0) || (o.depth && o.depth !== 'none'));
  lines.push(hasOffer
    ? `- OFFER on record: ${[o.depth, o.pct ? `${o.pct}%` : '', o.code ? `code ${o.code}` : ''].filter(Boolean).join(', ')}. Use exactly this; add no deadline or stock line it does not state.`
    : '- OFFER: none on record. The reason to buy is the product itself; invent no discount, code, deadline or stock line.');
  // The Parwah mailer (2026-10-17): "pure, locally-sourced nutrition" and "the
  // best care" under a brand whose record says neither. An attribute is a
  // product fact: it comes from the brand's own words or it is not written.
  lines.push('- DESCRIBE the product only with words the brand itself uses above or in its claims. Do not add an attribute it does not state (pure, natural, organic, locally sourced, premium, clinically proven, certified, award-winning, best, #1 or any like them).');
  return lines.join('\n');
}

// The benchmark for THIS brand's business (asset-playbooks.js): how a news
// digest, a market brief or a store's mail is built, as structure only. Read
// for the slot's own brand, never tenant zero's (2026-10-17).
function benchmarkBrief(entry) {
  try {
    const brand = require('./brand-runtime.js').scopedBrand(entry && entry.brand) || (entry && entry.brand) || {};
    return require('./asset-playbooks.js').playbookBrief(brand, ['mailer_v2', 'landing_page', 'ad_meta'], { market: entry && entry.market });
  } catch (_) { return ''; }
}

// The competitor email study, as lines for the writer (competitor-mail-study).
function mailStudyBrief(entry) {
  try { return require('./competitor-mail-study.js').briefLines(entry && entry.__mailStudy).join('\n'); } catch (_) { return ''; }
}
function copyPrompt(entry, fw = null, brief = null) { return OC.append(copyTask(entry, fw, brief), copyOutputSpec(entry)); }
// The messaging lines the writer is briefed with, only for a slot that plans
// SMS / WhatsApp / push (2026-10-23). Empty for every other slot, so the
// prompt of a brand that states no such channel is unchanged.
function messagingRule(entry) {
  const want = require('./messaging-assets.js').plannedOn(entry);
  if (!want.length) return '';
  return `- Messaging (${want.join(', ')}): each is ONE short line to the reader in the brand's own facts, no offer, price or code the facts above do not state. Write no brand-name prefix, no link and no opt-out: the builder adds the sender, the slot's own page and "Reply STOP" itself. SMS in plain GSM characters (no emoji, no curly quotes).\n`;
}
function copyTask(entry, fw = null, brief = null) {
  const fwLine = fw
    ? `\nCOPY FRAMEWORK: structure the copy with the ${fw.name} framework (${fw.full || fw.name}); the opening beat lands in the subject + hero_headline, the middle beats across intro_paragraph and body_paragraph in order, and the final beat on the cta. Do NOT name the framework in the copy, let the structure do the work.`
    : '';
  const briefLine = brief
    ? `\nSTRATEGY BRIEF from the growth lead (follow it): angle = ${brief.angle}; hook = ${brief.hook_thesis}; emotion = ${brief.target_emotion}; differentiator = ${brief.differentiator}; proof = ${(brief.proof_points || []).filter(Boolean).join('; ')}. Do: ${(brief.dos || []).join('; ')}. Avoid: ${(brief.donts || []).join('; ')}.`
    : '';
  return `Write campaign copy for this planned slot. Context:
- Market: ${entry.market} | Cohort: ${entry.cohort?.name} | Objective: ${entry.objective}
- Hero product: ${entry.heroProduct?.title} (${entry.heroProduct?.category || (entry.offering && entry.offering.kind) || 'catalogue item'})
${productFactsBrief(entry)}
- ${entry.festival ? `Seasonal moment: ${entry.festival.name}` : 'No festival; evergreen angle.'}
- Rationale: ${entry.rationale || ''}
${creativeEvidence.briefFor(entry)}
${benchmarkBrief(entry)}
${mailStudyBrief(entry)}
- ${regionalNuance(entry.market)}${fwLine}${briefLine}

WHO THIS IS FOR:
${audienceBrief(entry)}

${approvedProofBrief(entry)}

${complianceBrief(entry)}

${MAILER_COMPONENTS}

CONVERSION-DRIVEN DIRECT RESPONSE RULES:
- Subject & Preheader: Subject line must feature a curiosity gap, pattern-interrupt, or specific outcome. Preheader must extend the curiosity loop, never repeating the subject line.
- Opening Hook (intro_paragraph): Stop apathy immediately. Agitate the problem, hidden cost of inaction, or why ordinary category alternatives fail.
- What it is (body_paragraph): what the offering is and does, in the brand's own facts only.
- Benefits (benefits): up to 3 bullets, each a fact the brand or its catalogue states (its claims, the product description), said as what it means for the reader. Return fewer, even none, rather than add a quality, ingredient, standard or result the facts do not name.
- Action CTA (cta): Clear, high-contrast action verb driving to the destination PDP.
- Skimmer P.S. (ps): A punchy 1-2 sentence post-script restating the core hook or risk reversal for readers who scroll to the bottom.
- LENGTH (hard editorial limit, the mail is read on a phone in seconds): hero_headline at most ${require('./asset-contracts.js').MAIL_WORDS.headline} words; each paragraph at most ${require('./asset-contracts.js').MAIL_WORDS.paragraph} words; each benefit at most ${require('./asset-contracts.js').MAIL_WORDS.benefit} words; the P.S. at most ${require('./asset-contracts.js').MAIL_WORDS.ps} words. The whole mail body, headline to button, stays under ${require('./asset-contracts.js').MAIL_WORDS.visual} words for the picture-led mailer and ${require('./asset-contracts.js').MAIL_WORDS.text} for the text mailer. Say one idea, then the button.
${messagingRule(entry)}- Channel Architecture: Ensure elements across email, landing page, and ads build on each other cohesively, delivering specific, actionable, bulleted tactics rather than generic advice or empty boilerplate.

Every asset must ship with a CREATIVE as well as copy. For each asset write an "image_brief": a vivid 1-2 sentence art-direction prompt for a photoreal product/lifestyle scene of the hero product. Channel rules (ALL creatives are TEXT-FREE photographs — never describe overlaid words, headlines, prices, logos or UI in the image_brief; diffusion models cannot spell and render garbled fake letterforms, and the real ad copy is rendered natively by the platform, not painted into the pixels):
- email / LP heroes: just scene, props, light, mood; aspirational hero.
- AD creatives (meta / google / tiktok): a scroll-stopping TEXT-FREE photograph that shows the HERO PRODUCT itself, clearly, from the first second, in the moment or use it is bought for (the END STATE this cohort is buying); open on a 1-second scroll-stop. Art-direct it from the audience block above; if that block carries a [DATA REQUIRED BEFORE LAUNCH] marker, direct the frame at the OFFERING and the brand's own world and put no person of an assumed age, gender or life stage in it. Compose for the placement: meta = square, google = clean landscape, tiktok = vertical native hand-held. State only the scene, subject, light and mood - no words in the frame.

"rating", "reviews", "badges", "guarantee", "proof_quote" and "proof_author" are filled ONLY by copying an entry out of the APPROVED PROOF LIBRARY block above, verbatim. If that block says the library is empty, the answer is "rating": null, "reviews": [], "badges": [] and empty strings for the other three. Do not treat the empty values as placeholders to be filled in.`;
}

// A generic system stack, never a brand's: these were tenant zero's two
// families and every renderer below that fell back to them painted another
// company's typefaces on a brand that had not supplied its own (2026-10-10).
// A brand's own stacks come from brandRuntime.fontStacks(brand).
// The same values as brandRuntime.NEUTRAL_FONTS, written out rather than
// required here: requiring brand-runtime while this module loads changed the
// order every module behind it loads in (workspace-scope among them), and
// the daily sync then read a different workspace as tenant zero.
const FONT_HEAD = "Georgia,'Times New Roman',serif";
const FONT_BODY = "system-ui,-apple-system,'Segoe UI',Arial,sans-serif";

// HTML-escape so LLM copy can't break the markup / inject tags.
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** The ACTIVE brand's palette, with tenant-zero's record only when it IS tenant zero. */
function brandPal(entry) {
  const rt = require('./brand-runtime.js');
  let b = null;
  try { b = rt.scopedBrand(entry && entry.brand); } catch (_) { b = {}; }
  // A key the record does not carry is NEUTRAL, never tenant zero's hex: the
  // fallbacks here were its red and purple (2026-10-10).
  const p = rt.paletteOf(b);
  const f = rt.fontStacks(b);
  return {
    name: (b && b.name) || '',
    P: p.primary, ACC: p.accent, INK: p.ink, SURF: p.surface, SURF2: p.surface_alt, LINE: p.line,
    HEAD: f.head, BODY: f.body,
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
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px"><tr><td style="padding:22px 24px;font-family:${pal.BODY};color:${pal.INK};border-top:1px solid ${pal.LINE}">${inner}</td></tr></table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${pal.SURF2};border-top:1px solid ${pal.LINE}"><tr><td style="padding:26px 24px;font-family:${pal.BODY};color:${pal.INK}">${inner}</td></tr></table>`);
  // No approved reviews: no proof section at all (2026-10-23, the operator:
  // "no matter what, no placeholders will be used"). The gap is not hidden:
  // it stays in the campaign's data_gaps and the copy's __proof_gap marker.
  if (!reviews.length) { void marker; return ''; }
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
  const legal = /<p[^>]*>(?=(?:(?!<\/p>)[\s\S])*?(?:receiving this (?:as|because)|unsubscribe|DATA REQUIRED BEFORE LAUNCH: legal|DATA REQUIRED BEFORE LAUNCH: sender))/i.exec(s);
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
// Landing page FORMAT by the audience's temperature (2026-10-25, from the
// landing-page benchmark, data/benchmarks/landing-reference.json): a warm
// customer gets the direct offer (variant A) and, with two or more pictured
// products, the collection; a cold or lapsed one gets the listicle, when the
// brand states at least three reasons. Nothing is invented to reach three.
const COOL_COHORT = /at risk|hibernat|\blost\b|sleep|can.?t lose|lapsed|win.?back|reactivat|prospect|\bcold\b|non.?engag|new visitor|first.?time/i;
function listicleReasons(entry, copy) {
  let b = null;
  try { b = require('./brand-runtime.js').scopedBrand(entry && entry.brand); } catch (_) { b = (entry && entry.brand) || {}; }
  const svc = /ship|deliver|dispatch|return|refund|guarantee|warrant|exchange|cancel|trial|cash on delivery|\bcod\b/i;
  const L = (copy && copy.landing) || {};
  const seen = new Set();
  return [].concat(Array.isArray(L.why_bullets) ? L.why_bullets : [], Array.isArray(b && b.claims) ? b.claims : [])
    .map((x) => String(x || '').trim()).filter((x) => x && x.length <= 120 && !svc.test(x) && !/^\[DATA REQUIRED/.test(x))
    .filter((x) => { const k = x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 5);
}
function listicleHeadline(entry, n, name) {
  const back = COOL_COHORT.test(String((entry && entry.cohort && entry.cohort.name) || '')) && !/prospect|cold|new visitor|first.?time/i.test(String((entry && entry.cohort && entry.cohort.name) || ''));
  return `${n} reasons to ${back ? 'come back to' : 'choose'} ${name}`;
}
function landingFormat(entry, copy, variant) {
  if (variant !== 'B') return 'direct-offer';
  const cohort = String((entry && entry.cohort && (entry.cohort.name || entry.cohort.key)) || '') + ' ' + String((entry && entry.objective) || '');
  if (COOL_COHORT.test(cohort) && listicleReasons(entry, copy).length >= 3) return 'listicle';
  return ownPhotoCount(entry) >= 2 ? 'collection' : 'direct-offer';
}

function lpHtml(entry, copy, campaignId, creativeUrl, opts) {
  // This page's own composition (asset-style.js): hero arrangement varies by
  // brand and slot; the brand's palette, type and radii do not.
  const _lpRecipe = require('./asset-style.js').recipe(entry, `landing:${campaignId || ''}`);
  const L = copy.landing || {};
  const _o = opts || {};
  // Everything brand-visible derives from the ACTIVE brand on the entry:
  // name, palette, claims, store. Tenant zero's record is the source only
  // when the entry genuinely belongs to tenant zero.
  let _b = null;
  try { _b = require('./brand-runtime.js').scopedBrand(entry.brand); } catch (_) { _b = {}; }
  const bName = _b.name || 'the brand';
  // Every key the record lacks is neutral (brand-runtime.paletteOf), never the
  // tenant-zero hex this page used to fall back to (2026-10-10).
  const _pal = require('./brand-runtime.js').paletteOf(_b);
  const INKC = _pal.ink, SURF = _pal.surface, SURF2 = _pal.surface_alt;
  // Three pairings on this page were picked by eye against tenant zero and
  // measured, for that brand, at 2.77:1 (ink on the accent button), 1.51:1 (the
  // accent eyebrow on the primary band) and 3.29:1 (a hardcoded cream at 82% on
  // the primary) - all under the 4.5 body floor, on a page served to real
  // traffic at /lp/:id. The text is derived now, and the grounds are guarded.
  const P = sectionGround(_pal.primary, _pal.accent, SURF);
  const ACC = _pal.accent;
  const ON_P = textOn(P, SURF, INKC), ON_ACC = textOn(ACC, SURF, INKC);
  // The hero button sits ON the primary band: an accent that does not stand
  // off that band (under 1.5:1, the reader's own CTA floor) left the page's
  // main action as bare text (2026-10-17 audit). Then it takes the surface.
  const _k = _wsCore();
  // (3:1, WCAG 1.4.11's floor for a component, since 2026-10-24: a grey
  // accent on a navy band passed 1.5 at 2.3:1 and the page's main button
  // read as a dim block.)
  const HERO_BTN = (_k && _k.contrast && _k.contrast(ACC, P) < 3) ? SURF : ACC;
  const ON_HERO_BTN = textOn(HERO_BTN, SURF, INKC);
  // A category is shown only when it reads as words: a store's raw tag list
  // ("af1,gaming,aesthetic") is not one.
  const _cat = (() => { const c = entry.heroProduct && !entry.heroProduct.placeholder ? String(entry.heroProduct.category || '') : ''; return /[,;|]/.test(c) ? '' : c; })();
  // THE BRAND'S DESIGN SYSTEM, as read off its own rendered site (2026-10-04).
  // Until now this page painted tenant zero's two font families for EVERY
  // brand (FONT_HEAD / FONT_BODY are its literals) and consumed nothing but a
  // palette. resolve() gives the brand's own families wherever its record has
  // them, and - when "Read my site" measured a design system - the component
  // CSS (buttons with hover/focus, hero heading scale, body copy, card, header,
  // footer, section rhythm) at desktop and phone width, with the hard rules
  // applied inside lpCss(). No design system: the page is unchanged.
  const _dsx = (() => { try { return require('./design-system.js'); } catch (_) { return null; } })();
  const _ds = _dsx ? _dsx.resolve(_b) : { present: false, head: FONT_HEAD, body: FONT_BODY, fonts: { faces: '', googleHref: '' } };
  const _dsCss = _dsx && _ds.present ? _dsx.lpCss(_ds, { surface: SURF, ink: INKC, primary: P, heroGround: P }) : { css: '', header: null };
  const HEADF = _ds.head || FONT_HEAD, BODYF = _ds.body || FONT_BODY;
  const bClaimsAll = Array.isArray(_b.claims) ? _b.claims.filter(Boolean) : [];
  // Each claim has ONE home on the page (2026-10-24): a service promise
  // (shipping, returns, a guarantee) sits in the offer bar and the buy box's
  // checklist; every other claim in the reasons and the hero's pills.
  const _svcRe0 = /ship|deliver|dispatch|return|refund|guarantee|warrant|exchange|cancel|trial|cash on delivery|\bcod\b/i;
  const _hasBuy0 = !!(entry.heroProduct && !entry.heroProduct.placeholder && Number(entry.heroProduct.price) > 0);
  const bClaims = bClaimsAll.filter((c) => !(_hasBuy0 && _svcRe0.test(String(c))));
  // The store and currency are THIS brand's region record. Tenant zero's map
  // (master-prompt's REGION) answers only for tenant zero; any other brand
  // with no store for the market gets an honest dead link, not another
  // brand's storefront (2026-10-10).
  let facts = null;
  try { facts = require('./brand-runtime.js').regionFacts(_b, entry.market); } catch (_) { facts = null; }
  let _zeroLp = false;
  try { _zeroLp = require('./brand-catalog-server.js').isTenantZeroBrand(_b) === true; } catch (_) { _zeroLp = false; }
  if (!facts) facts = _zeroLp ? regionFacts(entry.market) : { store: '', currency: '', code: entry.market || '' };
  const handle = entry.heroProduct?.handle || '';
  // Any brand but tenant zero links where its mailer links (slotLinks: the
  // offering's own page, the product's own page, else its store or website),
  // never a guessed `/products/<handle>` path or a dead '#' (2026-10-17: a news
  // brand's page buttons went nowhere while its mail went to its subscription).
  let shopUrl = facts.store ? `https://${facts.store}${handle ? `/products/${handle}` : ''}` : '#';
  if (!_zeroLp) {
    let sl = null;
    try { sl = slotLinks(entry); } catch (_) { sl = null; }
    if (sl && /^https?:\/\//i.test(String(sl.pdp || ''))) shopUrl = sl.pdp;
  }
  // The page's button says what the mail's button says when the page has no
  // line of its own ("See more" sat under a product with a price, 2026-10-24).
  const cta = esc(L.cta || (copy.email && copy.email.cta) || entry.cta || 'See more');
  const cur = facts.currency;
  const price = entry.heroProduct?.price;
  // The market's own format ("₹1,450", not "₹1450"), through the one money
  // formatter; a value that is not a number is not printed.
  const priceLabel = _o.priceText ? String(_o.priceText) : (() => {
    const hp = entry.heroProduct || {};
    const n = Number(hp.price != null ? hp.price : price);
    if (n == null || !Number.isFinite(n) || n <= 0) return '';
    let formatted = '';
    try { formatted = require('./brand-locale.js').money(n, _b, entry.market) || `${cur}${n}`; } catch (_) { formatted = `${cur}${n}`; }
    const unit = hp.unit_spec || (hp.specs && hp.specs.weight) || null;
    const base = unit ? `${formatted} / ${unit}` : formatted;
    const cp = Number(hp.compare_at);
    if (Number.isFinite(cp) && cp > n) {
      let orig = '';
      try { orig = require('./brand-locale.js').money(cp, _b, entry.market) || `${cur}${cp}`; } catch (_) { orig = `${cur}${cp}`; }
      const pct = Math.round(((cp - n) / cp) * 100);
      return `${base} (was ${orig} • ${pct}% OFF)`;
    }
    return base;
  })();
  const _cardImg = _ds.present ? (_o.productImage || entry.heroProduct?.image || '') : '';
  // The header bar exists only when the brand's own site has one measured: its
  // logo (a hosted URL, or the inline SVG as an IMAGE - never as markup, so a
  // script inside a site's SVG cannot run on a page served from this domain).
  const _dsLogo = (() => {
    if (!_ds.present || !_dsCss.header) return '';
    const lg = (_ds.ds && _ds.ds.logo) || {};
    const src = _b.logo_url || lg.url || (lg.svg ? 'data:image/svg+xml;base64,' + Buffer.from(lg.svg, 'utf8').toString('base64') : '');
    return src ? `<img class="ds-logo" data-ds="logo" src="${esc(src)}" alt="${esc(bName)}">` : `<span class="ds-logo-text ds-head" data-ds="logo">${esc(lg.text || bName)}</span>`;
  })();
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
    : '';   // no approved review: no section (the gap is in data_gaps), never a marker on the page
  // A promise is rendered only where the brand actually states one - approved
  // per-SKU claims first, then the brand record's own verifiable claims.
  const _guaranteeRe = /guarantee|make it right|refund|return|free shipping/i;
  const _guaranteeText = _appClaims.find((c) => _guaranteeRe.test(String(c))) || bClaims.find((c) => _guaranteeRe.test(String(c))) || '';
  const guaranteeBlock = _guaranteeText
    ? `<div class="guarantee"><h3>Buy with confidence</h3><p style="margin:0;color:var(--ink-dim)">${esc(_guaranteeText)}</p></div>`
    : '';
  const cleanWhyTitle = (() => {
    let t = L.why_title || ('Why ' + ((entry.heroProduct && !entry.heroProduct.placeholder && entry.heroProduct.title) || bName));
    t = String(t).replace(/^Why\s+(The story behind|Why)\s+/i, 'Why ');
    return t;
  })();
  // The brand's own claims, or nothing: the fallback here was three claims no
  // brand made ("100% authentic from <brand>'s verified collection" ...).
  const fallbackBullets = bClaims.slice(0, 3).map((b) => `<li><span class="tick">✓</span>${esc(b)}</li>`).join('');
  // Each claim ONCE (2026-10-17 visual audit): the top bar, the trust strip and
  // the "Why" list printed the same two claims three times. The why list keeps
  // them; the strip carries only a rating and claims the list does not.
  const _whyItems = ((L.why_bullets && L.why_bullets.length) ? L.why_bullets : bClaims.slice(0, 3)).concat([L.hero_headline || '']).map((x) => String(x).trim().toLowerCase());
  const _stripItems = [
    ...(_appRating ? [`★★★★★ Rated ${String(_appRating)}/5`] : []),
    ...bClaims.filter((c) => _whyItems.indexOf(String(c).trim().toLowerCase()) < 0).slice(0, 3),
  ];
  // The send's other products, by name, each to its own page (or the store).
  // Variant B is a COLLECTION page (2026-10-24: it was A with "Why" in front
  // of the headline): no hero photo, every product of the slot as a card, the
  // hero's first.
  const _collection = _o.layout === 'collection';
  const _listicle = _o.layout === 'listicle';
  const _others = (_collection && entry.heroProduct && !entry.heroProduct.placeholder ? [Object.assign({}, entry.heroProduct, { url: shopUrl })] : [])
    .concat(Array.isArray(entry.supportingProducts) ? entry.supportingProducts : [])
    .filter((x) => x && x.title && !/^\[DATA REQUIRED/.test(String(x.title))).slice(0, _collection ? 4 : 3);
  // The product's OWN page (2026-10-24: a guessed `/products/<handle>` on the
  // store host is not a page Lenskart has), else the store.
  const _otherHref = (x) => (/^https?:\/\//i.test(String(x.url || x.product_url || '')) ? String(x.url || x.product_url)
    : (() => { try { const u = productUrl(x, entry.market, entry.brand); if (/^https?:\/\//i.test(String(u || ''))) return u; } catch (_) { /* store */ } return facts.store ? `https://${facts.store}` : shopUrl; })());
  const _otherPrice = (x) => { const n = Number(x.price); if (!Number.isFinite(n) || n <= 0) return ''; try { return require('./brand-locale.js').money(n, _b, entry.market) || ''; } catch (_) { return ''; } };
  const _otherImg = (x) => { if (x.image) return x.image; try { return (catalogImage.imagesFor(x, entry.market, { width: 600, brand: entry.brand }) || [])[0] || ''; } catch (_) { return ''; } };
  const _othersAnyImg = _others.some((x) => _otherImg(x));
  // A brand with no other product on this send still names what it offers,
  // from its own record (2026-10-17 audit: a publisher's page was the name
  // three times, one bullet and the end). Never an offering it does not list.
  const _heroName = String((entry.heroProduct && entry.heroProduct.title) || '').trim().toLowerCase();
  const _offerList = (Array.isArray(_b.offerings) ? _b.offerings : [])
    .filter((o) => o && o.name && String(o.name).trim().toLowerCase() !== _heroName && !/^\[DATA REQUIRED/.test(String(o.name)))
    .slice(0, 6).map((o) => ({ name: String(o.name), url: /^https?:\/\//.test(String(o.url || '')) ? String(o.url) : '' }));
  // ── THE LONG-FORM SALES PAGE (2026-10-24) ─────────────────────────────────
  // The operator, with a tea brand's own landing pages and section library: "ensure
  // proper well thought of structure of landing pages ... understand what type
  // of content ... and implement it for any brand". The pattern those pages
  // follow: an offer bar, the hero with a reassurance line and trust pills, the
  // product's reasons as numbered rows with pictures, what is inside, a buy box
  // (price against the compare-at, per-serving, pack, checklist), the reviews,
  // who the brand is, the questions, the buy box again, the legal footer and a
  // sticky bar. Each section is drawn ONLY from what the brand or its catalogue
  // states: no figure, rating, countdown, stock level, gift or study is ever
  // supplied for it, and a section with nothing to say is left out.
  const _hp = entry.heroProduct && !entry.heroProduct.placeholder ? entry.heroProduct : null;
  const _money = (n) => { const v = Number(n); if (!Number.isFinite(v) || v <= 0) return ''; try { return require('./brand-locale.js').money(v, _b, entry.market) || ''; } catch (_) { return ''; } };
  const _svcRe = /ship|deliver|dispatch|return|refund|guarantee|warrant|exchange|cancel|trial|cash on delivery|\bcod\b/i;
  const _svcAll = bClaimsAll.concat(_appClaims).map(String).filter((c) => _svcRe.test(c) && c.length <= 90).filter((c, i, a) => a.indexOf(c) === i);
  const _annClaim = _svcAll.find((c) => /ship|deliver/i.test(c)) || '';
  // The bar says the shipping promise; the checklist (or the reassurance line)
  // says the others, so no promise is printed twice.
  const _svcClaims = _svcAll.filter((c) => c !== _annClaim).slice(0, 3);
  const _offerPct = Number(entry.offer && entry.offer.pct) || 0;
  const _annc = [_offerPct > 0 ? `${_offerPct}% off` : '', _annClaim].filter(Boolean);
  const anncBar = _annc.length ? `<div class="annc">${_annc.map(esc).join(' · ')}</div>` : '';
  // The claims the reasons do not carry, as pills under the hero's button
  // (they used to be a strip under the hero as well: said twice).
  const _pillItems = _stripItems.filter((c) => !/^★/.test(c) && String(c).length <= 40);
  const heroPills = _pillItems.length ? `<div class="pills">${_pillItems.map((c) => `<span>✓ ${esc(c)}</span>`).join('')}</div>` : '';
  const _hasBuy = !!(entry.heroProduct && !entry.heroProduct.placeholder && Number(entry.heroProduct.price) > 0);
  const heroAssure = _svcClaims.length && !_hasBuy ? `<p class="assure">${_svcClaims.slice(0, 2).map(esc).join(' · ')}</p>` : '';
  // The product's own photographs, for the numbered rows.
  const _gallery = (() => { if (!_hp) return []; let g = []; try { g = catalogImage.imagesFor(_hp, entry.market, { width: 900, brand: entry.brand }) || []; } catch (_) { g = []; } if (!g.length && /^https:\/\//i.test(String(_hp.image || ''))) g = [String(_hp.image)]; return g.filter((u) => u && u !== creativeUrl); })();
  const _featItems = (L.why_bullets && L.why_bullets.length ? L.why_bullets : bClaims.slice(0, 3)).map(String).filter(Boolean).slice(0, 4);
  const featRows = (_featItems.length >= 2 && _gallery.length >= 1 && !_collection && !_listicle)
    ? `<section class="sec feats"><h2>${esc(cleanWhyTitle)}</h2>${_featItems.map((t, i) => `<div class="feat${i % 2 ? ' rev' : ''}"><img src="${esc(_gallery[i % _gallery.length])}" alt="${esc(_hp.title)}" loading="lazy"><div><span class="num">${String(i + 1).padStart(2, '0')}</span><h3>${esc(t)}</h3></div></div>`).join('')}</section>`
    : '';
  // THE LISTICLE (2026-10-25, from the landing-page benchmark,
  // data/benchmarks/landing-reference.json): for a cold or lapsed audience the
  // page argues the case reason by reason, the product enters at item two, and
  // a button follows every reason; the buy box closes it. Every reason is a line
  // the brand states (listicleReasons), never one written for the page.
  const _boxImg0 = () => (creativeUrl || (_hp && /^https:\/\//i.test(String(_hp.image || '')) ? _hp.image : '')) || '';
  const _lReasons = _listicle ? listicleReasons(entry, copy) : [];
  const listicleSec = _listicle && _lReasons.length >= 3 ? (() => {
    const card = _hp ? `<div class="lcard">${_gallery[0] || _boxImg0() ? `<img src="${esc(_gallery[0] || _boxImg0())}" alt="${esc(_hp.title)}" loading="lazy">` : ''}<div><h3>${esc(_hp.title)}</h3>${priceLabel ? `<p class="lprice">${esc(priceLabel)}</p>` : ''}<a href="${esc(shopUrl)}" class="btn">${cta}</a></div></div>` : '';
    return `<section class="sec listicle" data-format="listicle"><ol class="lreasons">${_lReasons.map((t, i) => `<li><span class="num">${i + 1}</span><div><h3>${esc(t)}</h3>${i ? `<a class="lnext" href="${esc(shopUrl)}">${cta} &rarr;</a>` : ''}</div></li>${i === 0 ? card : ''}`).join('')}</ol></section>`;
  })() : '';
  // What is inside / the details: only the facts the store states.
  const _det = _hp ? [
    _hp.unit_spec ? ['Size', _hp.unit_spec] : null,
    _hp.piece_count ? ['In the box', String(_hp.piece_count) + ' pieces'] : null,
    _hp.servings ? ['Servings', String(_hp.servings)] : null,
    _cat ? ['Type', _cat] : null,
  ].filter(Boolean) : [];
  const _desc = _hp ? require('./mailer-format.js').productLine(_hp.description || '', _hp.title || '', bName) : '';
  const detailSec = (_det.length || _desc) && !_collection
    ? `<section class="sec details"><h2>The details</h2>${_desc ? `<p class="lede">${esc(_desc)}</p>` : ''}${_det.length ? `<div class="dgrid">${_det.map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div>` : ''}</section>`
    : '';
  // The buy box: the store's price against its own compare-at (the saving is
  // that arithmetic, nothing more), per serving when the pack states servings.
  const _pNum = _hp ? Number(_hp.price) : NaN;
  const _cNum = _hp ? Number(_hp.compare_at) : NaN;
  const _save = Number.isFinite(_pNum) && Number.isFinite(_cNum) && _cNum > _pNum && _pNum > 0 ? Math.round(((_cNum - _pNum) / _cNum) * 100) : 0;
  const _perServ = _hp && Number(_hp.servings) > 1 && Number.isFinite(_pNum) && _pNum > 0 ? _money(_pNum / Number(_hp.servings)) : '';
  const _boxImg = (_gallery[0] || creativeUrl || (_hp && /^https:\/\//i.test(String(_hp.image || '')) ? _hp.image : '')) || '';
  const buyBox = (tag) => (_hp && _money(_pNum)) ? `<section class="sec buy"${tag ? ` data-buy="${tag}"` : ''}><div class="buybox">${_boxImg ? `<img src="${esc(_boxImg)}" alt="${esc(_hp.title)}" loading="lazy">` : ''}<div class="bb">
      ${_offerPct > 0 ? `<span class="deal">${_offerPct}% off</span>` : ''}
      <h3>${esc(_hp.title)}</h3>
      <p class="bbprice"><b>${esc(_money(_pNum))}</b>${_save ? ` <s>${esc(_money(_cNum))}</s> <span class="off">${_save}% off</span>` : ''}</p>
      ${_perServ ? `<p class="per">${esc(_perServ)} per serving</p>` : ''}
      ${[_hp.unit_spec, _hp.servings ? _hp.servings + ' servings' : ''].filter(Boolean).length ? `<p class="pack">${esc([_hp.unit_spec, _hp.servings ? _hp.servings + ' servings' : ''].filter(Boolean).join(' · '))}</p>` : ''}
      <a href="${esc(shopUrl)}" class="btn big">${cta}</a>
      ${_svcClaims.length ? `<ul class="chk">${_svcClaims.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    </div></div></section>` : '';
  // More than one review: the rest of them as cards (the first leads the page).
  const _moreReviews = _proofPool.slice(1, 4).filter((r) => r && r.quote);
  const reviewCards = _moreReviews.length ? `<section class="sec revs"><h2>What customers say</h2><div class="rgrid">${_moreReviews.map((r) => `<figure><blockquote>“${esc(r.quote)}”</blockquote>${r.author ? `<figcaption>${esc(r.author)}</figcaption>` : ''}</figure>`).join('')}</div></section>` : '';
  // Who the brand is, in its own words from its own record.
  const _bd = (_b && _b.brand_data) || {};
  const _about = String(_b.description || _bd.description || (_bd.brand_extraction && _bd.brand_extraction.applied && _bd.brand_extraction.applied.description && _bd.brand_extraction.applied.description.value) || '').trim();
  const aboutSec = _about && _about.length > 40 ? `<section class="sec about"><h2>About ${esc(bName)}</h2><p>${esc(_about.slice(0, 600))}</p></section>` : '';
  const _legal = (() => { const le = _b.legal_entity || _bd.legal_entity; if (!le) return ''; if (typeof le === 'string') return /^\[DATA REQUIRED/.test(le) ? '' : le; return [le.name, le.address].filter(Boolean).join(' · '); })();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(eliminatePlaceholders(L.hero_headline || entry.heroProduct?.title || bName, entry))}</title>
<style>
:root{--moss:${P};--moss-deep:${P};--moss-near:${P};--chalk:${SURF};--chalk-warm:${SURF2};--lava:${ACC};--ink:${INKC};--ink-dim:#4a4a4a;--on-moss:${ON_P};--on-lava:${ON_ACC};--head:${HEADF};--body:${BODYF}}
*{box-sizing:border-box}
body{margin:0;background:var(--chalk);color:var(--ink);font-family:var(--body);line-height:1.6;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
img{max-width:100%;height:auto;display:block}
.bar{background:var(--chalk);color:var(--ink);text-align:center;font-size:15px;font-weight:700;letter-spacing:.04em;padding:14px 16px;border-bottom:1px solid var(--chalk-warm)}
.bar-logo{height:28px;width:auto;max-width:100%;margin:0 auto;display:block}
.wrap{max-width:920px;margin:0 auto;padding:0 22px}
h1,h2,h3{font-family:var(--head);line-height:1.15;margin:0 0 14px}
.hero{background:var(--moss);color:var(--on-moss);text-align:center;padding:34px 20px 38px}
.hero-grid{max-width:1080px;margin:0 auto;display:grid;gap:24px;align-items:center}
.hero--media-left .hero-media,.hero--media-top .hero-media{order:-1}
.hero-media img{width:100%;height:280px;object-fit:cover;border-radius:12px;display:block}
@media(min-width:900px){.hero{padding:56px 32px}.hero-grid.has-media{grid-template-columns:1fr 1fr;text-align:left;gap:48px}.hero-grid.has-media.hero--media-top{grid-template-columns:1fr;text-align:center;max-width:760px}.hero-grid.has-media.hero--media-top h1,.hero-grid.has-media.hero--media-top p{margin-left:auto;margin-right:auto}.hero-grid.has-media h1,.hero-grid.has-media p{margin-left:0;margin-right:0}.hero-media img{height:420px}}
.others{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),260px));gap:14px}
.others.four{grid-template-columns:repeat(4,minmax(0,1fr))}
@media(max-width:900px){.others.four{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:640px){.others,.others.four{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.other span{padding:10px 10px;font-size:14px}.other .op{padding:0 10px 12px;font-size:14px}}
.other .ph{display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:4/3;padding:0;background:var(--chalk-warm);color:var(--ink);font-family:var(--head);font-size:44px}
.offers{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(220px,100%),1fr));gap:12px;padding:0;margin:0;list-style:none}
.offers li{border:1px solid var(--ink-dim);border-radius:12px;padding:14px 16px;background:var(--chalk-warm)}
.offers a{color:var(--ink);font-weight:700}
.other{display:block;text-decoration:none;color:var(--ink);background:var(--chalk);border:1px solid var(--chalk-warm);border-radius:12px;overflow:hidden}
.other img{width:100%;aspect-ratio:4/3;object-fit:cover}
.other span{display:block;padding:12px 14px;font-family:var(--head);font-size:16px;line-height:1.3}
.other .op{display:flex;justify-content:space-between;align-items:center;padding:0 14px 14px;font-family:var(--body);font-size:15px}
.other .op u{color:var(--moss);font-weight:700}
body{padding-bottom:4px}
.hero .eyebrow{color:var(--on-moss);letter-spacing:.2em;text-transform:uppercase;font-size:12px;margin:0 auto 12px}
.hero h1{font-size:34px;max-width:680px;margin:0 auto 12px}
.hero p{max-width:540px;margin:0 auto 20px;color:var(--on-moss);font-size:15px}
.btn{display:inline-flex;align-items:center;justify-content:center;background:var(--lava);color:var(--on-lava);font-weight:700;text-decoration:none;padding:12px 28px;min-height:44px;border-radius:6px;border:0;cursor:pointer;font-size:15px;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:opacity .15s ease}
${HERO_BTN !== ACC && !_ds.present ? `.hero .btn{background:${HERO_BTN};color:${ON_HERO_BTN}}` : ''}
.btn:hover{opacity:.92}
.btn-dark{background:var(--moss);color:var(--on-moss)}
.trust{display:flex;flex-wrap:wrap;justify-content:center;gap:12px 24px;background:var(--chalk-warm);padding:12px 18px;font-size:12px;color:var(--ink-dim);text-align:center}
.sec{padding:26px 0}
.sec h2{font-size:26px;margin:0 0 12px}
.why li{list-style:none;margin:8px 0;padding-left:6px${_ds.present ? '' : ';font-size:14px'}}
.tick{color:var(--moss);font-weight:800;margin-right:8px}
.annc{background:var(--moss);color:var(--on-moss);text-align:center;font-size:13px;font-weight:700;letter-spacing:.04em;padding:9px 14px}
.pills{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:14px 0 0}
.pills span{display:inline-block;padding:6px 12px;border-radius:999px;background:var(--chalk);color:var(--ink);font-size:12px;font-weight:600}
.assure{font-size:13px;margin:10px 0 0;opacity:1}
${_ds.present ? '' : '.btn.big,.hero .btn{border-radius:999px;padding:15px 34px;font-size:16px}'}
.feats h2,.details h2,.revs h2,.about h2{font-size:26px}
.feat{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:center;margin:22px 0}
.feat img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:14px}
.feat.rev img{order:2}
.feat .num{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:var(--moss);color:var(--on-moss);font-weight:800;font-size:13px;margin-bottom:10px}
.feat h3{font-size:20px;line-height:1.3;margin:0}
.lreasons{list-style:none;padding:0;margin:0;counter-reset:none}.lreasons>li{display:flex;gap:16px;align-items:flex-start;padding:22px 0;border-bottom:1px solid var(--chalk-warm)}
.lreasons .num{flex:0 0 40px;height:40px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:var(--moss);color:var(--on-moss);font-weight:800}
.lreasons h3{font-size:22px;line-height:1.3;margin:6px 0 8px}.lnext{font-weight:700;color:var(--moss-text,var(--ink));text-decoration:underline}
.lcard{display:grid;grid-template-columns:200px minmax(0,1fr);gap:20px;align-items:center;border:2px solid var(--moss);border-radius:16px;padding:18px;margin:18px 0;background:var(--chalk)}
.lcard img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px}.lcard h3{margin:0 0 6px;font-size:20px}.lprice{font-family:var(--head);font-size:22px;margin:0 0 12px}
@media(max-width:560px){.lcard{grid-template-columns:110px minmax(0,1fr);gap:14px;padding:14px}.lcard h3{font-size:17px}.lreasons h3{font-size:19px}}
.details .lede{color:var(--ink);font-size:16px;max-width:680px}
.dgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px;margin-top:12px}
.dgrid div{background:var(--chalk);border:1px solid var(--chalk-warm);border-radius:12px;padding:14px}
.dgrid b{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-dim);margin-bottom:4px}
.buybox{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:center;border:2px solid var(--moss);border-radius:18px;padding:24px;background:var(--chalk)}
.buybox img,.feat img,.lcard img{min-width:0;max-width:100%}
.buybox img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px}
.bb{text-align:center}.bb h3{font-size:22px;margin:8px 0}
.deal{display:inline-block;background:var(--moss);color:var(--on-moss);font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:5px 12px;border-radius:999px}
.bbprice{font-family:var(--head);margin:6px 0}.bbprice b{font-size:34px;color:var(--moss)}.bbprice s{color:var(--ink-dim);font-size:18px;margin-left:8px}
.off{display:inline-block;background:var(--moss);color:var(--on-moss);font-size:12px;font-weight:800;padding:3px 8px;border-radius:6px;margin-left:6px;vertical-align:middle}
.per,.pack{color:var(--ink-dim);font-size:14px;margin:2px 0}
.bb .btn{margin:16px 0 10px;width:100%;max-width:360px}
.buy .btn,.endcta .btn{background:var(--moss);color:var(--on-moss)}
.chk{list-style:none;padding:0;margin:8px auto 0;text-align:left;max-width:360px}.chk li{padding:4px 0 4px 24px;position:relative;font-size:14px}.chk li::before{content:"✓";position:absolute;left:0;color:var(--moss);font-weight:800}
.rgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:14px}
.rgrid figure{margin:0;background:var(--chalk);border:1px solid var(--chalk-warm);border-radius:14px;padding:18px}
.rgrid blockquote{margin:0 0 10px;font-size:15px;line-height:1.55}.rgrid figcaption{font-weight:700;color:var(--moss);font-size:13px}
.about p{font-size:16px;line-height:1.65;max-width:760px}
.endcta{text-align:center;padding:30px 18px}
@media(max-width:760px){.feat,.buybox{grid-template-columns:minmax(0,1fr)}.feat.rev img{order:0}.bbprice b{font-size:28px}}
.why ul{padding:0;margin:0}
.reveal{background:var(--chalk);border:1px solid var(--chalk-warm);border-radius:12px;padding:20px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between}
.reveal .price{font-family:var(--head);font-size:26px;color:var(--moss)}
.proof{background:var(--moss-near);color:var(--on-moss);text-align:center}
.proof blockquote{font-family:var(--head);font-size:22px;max-width:640px;margin:0 auto;line-height:1.35}
.proof .who{color:var(--lava);font-weight:700;margin-top:12px}
.proof .proofshot{width:120px;border-radius:10px;margin:0 auto 14px}
/* Missing approved proof is PRINTED, not silently dropped. Deliberately styled
   as a build note on a light surface (dark ink on chalk-warm, AA) so nobody can
   mistake it for customer-facing content, and so the reviewer sees the gap. */
.datareq-band{padding:18px 0}
.datareq{margin:0;text-align:center;font-family:var(--body);font-size:12px;line-height:1.45;color:var(--ink);background:var(--chalk-warm);border:1px dashed var(--ink-dim);border-radius:8px;padding:10px 14px}
.faq{border-top:1px solid rgba(171,135,67,.3);padding:12px 0}
.faq summary{font-weight:700;cursor:pointer;font-size:16px;list-style:none;display:flex;align-items:center;justify-content:space-between}
.faq summary::-webkit-details-marker{display:none}
.faq summary::marker{display:none}
.faq summary::after{content:'+';font-size:18px;font-weight:400;margin-left:10px}
.faq[open] summary::after{content:'−'}
.faq p{color:var(--ink-dim);margin:8px 0 0;line-height:1.5;font-size:14px}
.sec-head{text-align:center;max-width:640px;margin:0 auto 20px}
.sec-eyebrow{color:var(--ink-dim);font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;margin:0 0 6px;display:block}
.sec-head h2{font-size:26px;line-height:1.2;margin:4px 0 8px}
.sec-sub{color:var(--ink-dim);font-size:14px;margin:0;line-height:1.45}
.friction-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:16px}
.f-card{background:var(--chalk);border:1px solid var(--chalk-warm);border-radius:12px;padding:18px;box-shadow:0 3px 12px rgba(0,0,0,0.02);text-align:left}
.f-badge{display:inline-block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:3px 8px;border-radius:99px;background:var(--chalk-warm);color:var(--ink);margin-bottom:10px;border:1px solid rgba(0,0,0,0.12)}
.f-card h3{font-size:16px;margin:0 0 6px;color:var(--ink)}
.f-card p{font-size:13px;color:var(--ink-dim);margin:0 0 12px;line-height:1.45}
.f-mockup{background:var(--chalk-warm);border-radius:8px;padding:8px 12px;border:1px solid rgba(0,0,0,0.06)}
.f-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:5px 0;border-bottom:1px solid rgba(0,0,0,0.06)}
.f-row:last-child{border-bottom:0}
.f-pill{padding:2px 7px;border-radius:4px;font-size:12px;font-weight:700;letter-spacing:.03em}
.f-warn{background:rgba(255,193,7,0.2);color:#856404}
.f-err{background:rgba(220,53,69,0.15);color:#b02a37}

.timeline{display:flex;flex-direction:column;gap:12px;max-width:620px;margin:18px auto 0;position:relative;padding-left:48px}
.timeline::before{content:"";position:absolute;left:16px;top:12px;bottom:12px;width:2px;background:var(--moss);opacity:0.35}
.t-step{position:relative;background:var(--chalk);border:1px solid var(--chalk-warm);border-radius:12px;padding:14px 18px;box-shadow:0 2px 8px rgba(0,0,0,0.02);text-align:left}
.t-num{position:absolute;left:-48px;top:12px;width:34px;height:34px;border-radius:50%;background:var(--moss);color:var(--on-moss);font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.1)}
.t-step h3{font-size:15px;margin:0 0 4px;color:var(--ink)}
.t-step p{font-size:13px;color:var(--ink-dim);margin:0;line-height:1.45}

.metrics-card{background:var(--chalk);border:1px solid var(--chalk-warm);border-radius:12px;overflow:hidden;box-shadow:0 3px 12px rgba(0,0,0,0.03);margin-top:16px}
.m-card-header{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--chalk-warm);border-bottom:1px solid rgba(0,0,0,0.06);font-size:12px}
.m-badge{font-size:12px;font-weight:700;color:var(--ink);background:var(--chalk-warm);border:1px solid rgba(0,0,0,0.12);padding:3px 8px;border-radius:4px;letter-spacing:.04em}
.m-table-wrap{overflow-x:auto}
.m-table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}
.m-table th{padding:8px 14px;color:var(--ink-dim);font-size:12px;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--chalk-warm)}
.m-table td{padding:9px 14px;border-bottom:1px solid var(--chalk-warm);color:var(--ink)}
.m-pill{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.m-ok{background:rgba(40,167,69,0.15);color:#1e7e34}
.m-info{background:rgba(23,162,184,0.15);color:#117a8b}

.guarantee{background:var(--chalk-warm);text-align:center;border-radius:12px;padding:20px;margin:18px 0}
.sticky{position:-webkit-sticky;position:sticky;bottom:0;z-index:100;background:var(--chalk);border-top:1px solid var(--chalk-warm);display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 18px;padding-bottom:max(10px,env(safe-area-inset-bottom,10px));box-shadow:0 -4px 18px rgba(0,0,0,.06);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.sticky .btn{background:var(--moss);color:var(--on-moss)}
.sticky .info{font-size:13px;min-width:0;flex:1 1 auto}.sticky .info b{display:block;font-family:var(--head);font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sticky .btn{flex:0 0 auto;white-space:nowrap}
/* The footer was a near-black band (var(--ink) is #111111 for tenant zero),
   which the design rules forbid for any section. It is the brand primary now,
   with the contrast-adjusted on-primary text rather than a 60%-opacity cream
   that was only legible because the ground behind it was black. */
footer{background:var(--moss);color:var(--on-moss);text-align:center;padding:18px 18px;padding-bottom:max(18px,env(safe-area-inset-bottom,18px));font-size:12px}
@media(max-width:640px){.hero{padding:22px 14px 24px}.hero h1{font-size:22px;margin-bottom:8px}.hero p{font-size:13px;margin-bottom:14px}.sec{padding:14px 0}.sec h2{font-size:19px}.sec-head{margin-bottom:14px}.sec-head h2{font-size:19px}.friction-grid{gap:8px;margin-top:10px}.f-card{padding:12px 14px}.f-card p{margin-bottom:8px;font-size:12px}.f-mockup{padding:6px 10px}.timeline{padding-left:36px;gap:8px;margin-top:10px}.timeline::before{left:12px}.t-step{padding:10px 14px}.t-num{left:-36px;width:26px;height:26px;font-size:12px;top:8px}.metrics-card{margin-top:10px}.m-table th,.m-table td{padding:6px 10px;font-size:12px}.reveal{flex-direction:column;align-items:flex-start;padding:14px;gap:12px}.reveal > div{width:100%;text-align:left!important}.reveal .btn{width:100%;margin-top:8px}.guarantee{padding:14px;margin:12px 0}.sticky{padding:8px 14px;padding-bottom:max(8px,env(safe-area-inset-bottom,8px))}.sticky .info .sub{display:none}.btn{padding:12px 18px;font-size:14px;min-height:44px}.hero-media img{height:220px}}
</style>${_ds.fonts.googleHref ? `<link rel="stylesheet" href="${esc(_ds.fonts.googleHref)}">` : ''}${_ds.present ? `<style id="ds">${_ds.fonts.faces}\n${_dsCss.css}</style>` : (_ds.fonts.faces ? `<style id="brand-fonts">${_ds.fonts.faces}</style>` : '')}</head>
<body>
${_dsLogo ? `<header class="ds-header" data-ds="header"><a href="${esc(shopUrl)}">${_dsLogo}</a></header>` : ''}
${anncBar}<div class="bar">${(() => { const home = /^https?:\/\//i.test(String(_b.website || '')) ? String(_b.website) : shopUrl; const lg = /^https:\/\//i.test(String(_b.logo_url || '')) && !_dsLogo ? String(_b.logo_url) : ''; return `<a href="${esc(home)}" style="color:inherit;text-decoration:none;display:block">${lg ? `<img class="bar-logo" src="${esc(lg)}" alt="${esc(bName)}">` : esc(bName)}</a>`; })()}</div>
<section class="hero" data-recipe="${esc(_lpRecipe.id)}">
  <div class="hero-grid${creativeUrl ? ' has-media' : ''} hero--${esc(_lpRecipe.hero)}">
    <div class="hero-copy">
      ${(() => {
        const hp = entry.heroProduct || {};
        // A badge only from what the store states (its own popularity rank,
        // a stated rating, stated reads); a stored badge is not trusted.
        let b = null;
        try { b = require('./offering-intelligence.js').enrich(Object.assign({ title: hp.title, product_url: hp.product_url }, hp)).badge; } catch (_) { b = null; }
        return b ? `<div class="hero-badge" style="display:inline-block;background:var(--lava);color:var(--on-lava);font-size:12px;font-weight:700;letter-spacing:.05em;padding:4px 10px;border-radius:99px;margin-bottom:10px">${esc(b)}</div>` : '';
      })()}
      <p class="eyebrow">${esc((() => { const t = entry.heroProduct && !entry.heroProduct.placeholder ? String(entry.heroProduct.title || '') : ''; const h = String(L.hero_headline || ''); return t && h && h.toLowerCase().indexOf(t.toLowerCase()) < 0 ? t : (_cat || bName); })())}</p>
      <h1 data-ds="h1">${esc(listicleSec ? listicleHeadline(entry, _lReasons.length, bName) : (L.hero_headline || entry.heroProduct?.title || bName))}</h1>
      ${(() => { const sub = L.hero_sub || _b.tagline || ((copy.email || {}).intro_paragraph) || ''; return sub ? `<p data-ds="hero-body">${esc(sub)}</p>` : ''; })()}
      ${priceLabel && !listicleSec ? `<p class="hero-price" style="font-family:var(--head);font-size:22px;margin:0 auto 18px">${esc(priceLabel)}</p>` : ''}
      <a href="${esc(shopUrl)}" class="btn" data-ds="button-primary">${cta}</a>
      ${heroAssure}${listicleSec ? '' : heroPills}
    </div>
    ${creativeUrl ? `<div class="hero-media"><img class="hero-asset" src="${esc(creativeUrl)}" alt="${esc(entry.heroProduct && !entry.heroProduct.placeholder ? entry.heroProduct.title : bName)}"></div>` : ''}
  </div>
</section>
${_appRating ? `<div class="trust"><span>${esc(`★★★★★ Rated ${String(_appRating)}/5`)}</span></div>` : ''}
<div class="wrap" data-ds="wrap">
  ${listicleSec}
  ${featRows}
  ${(!listicleSec && !featRows && (bullets || fallbackBullets)) ? `<section class="sec why">
    <h2>${esc(cleanWhyTitle)}</h2>
    <ul data-ds="body">${bullets || fallbackBullets}</ul>
  </section>` : ''}
  ${_ds.present ? `<section class="sec">
    <div class="reveal" data-ds="card">
      ${_cardImg ? `<img class="ds-card-img" data-ds="card-image" src="${esc(_cardImg)}" alt="${esc(entry.heroProduct?.title || '')}" style="flex-basis:100%">` : ''}
      <div>
        <h3 class="ds-card-title" data-ds="card-title" style="margin:0 0 6px">${esc((entry.heroProduct && !entry.heroProduct.placeholder && entry.heroProduct.title) || bName)}</h3>
        <p style="margin:0;color:var(--ink-dim)">${esc(_cat || (entry.offering && entry.offering.kind) || '')}</p>
      </div>
      <div style="text-align:right">
        ${priceLabel ? `<div class="price" data-ds="card-price">${esc(priceLabel)}</div>` : ''}
        <a href="${esc(shopUrl)}" class="btn btn-dark">${cta}</a>
      </div>
    </div>
  </section>` : ''}
  ${detailSec}
  ${_collection ? '' : buyBox('main')}
  ${_others.length ? `<section class="sec"><h2>${_collection ? 'Pick yours' : `Also from ${esc(bName)}`}</h2><div class="others${_others.length === 4 ? ' four' : ''}">${_others.map((x) => { const im = _otherImg(x); return `<a class="other" href="${esc(_otherHref(x))}">${im ? `<img src="${esc(im)}" alt="${esc(x.title)}" loading="lazy">` : (_othersAnyImg ? `<span class="ph" aria-hidden="true">${esc(String(x.title).trim().charAt(0).toUpperCase())}</span>` : '')}<span>${esc(x.title)}</span>${_otherPrice(x) ? `<span class="op"><b>${esc(_otherPrice(x))}</b><u>View</u></span>` : `<span class="op"><u>View</u></span>`}</a>`; }).join('')}</div></section>` : ''}
  ${(!_others.length && _offerList.length) ? `<section class="sec"><h2>What ${esc(bName)} offers</h2><ul class="offers">${_offerList.map((o) => `<li>${o.url ? `<a href="${esc(o.url)}">${esc(o.name)}</a>` : `<b>${esc(o.name)}</b>`}</li>`).join('')}</ul></section>` : ''}
</div>
${proofSection}
<div class="wrap">
  ${reviewCards}
  ${aboutSec}
  ${faq ? `<section class="sec"><h2>Questions, answered</h2>${faq}</section>` : ''}
  ${_svcAll.indexOf(_guaranteeText) >= 0 && (_hasBuy || _annClaim === _guaranteeText) ? '' : guaranteeBlock}
  <section class="endcta"><a href="${esc(shopUrl)}" class="btn big">${cta}</a></section>
</div>
<div class="sticky">
  <div class="info"><b>${esc(entry.heroProduct?.title || bName)}</b><span class="sub">${esc(priceLabel)}</span></div>
  <a href="${esc(shopUrl)}" class="btn">${cta}</a>
</div>
<footer data-ds="footer" data-campaign="${esc(campaignId)}">${_legal ? `${esc(_legal)}<br>` : ''}© ${esc(String(_b.legal_entity || '').split(',')[0].trim() || bName)}${(() => { const home = /^https?:\/\//i.test(String(_b.website || '')) ? String(_b.website) : ''; return home ? ` · <a href="${esc(home)}" style="color:inherit">${esc(home.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''))}</a>` : ''; })()}</footer>
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
/* Is this slot tenant zero's? The SERVER's answer (owns_shipped, stamped from
   the oldest workspace by brand-runtime.resolve and workspace-scope
   .brandForWorkspace), never the slug a workspace's owner wrote: a workspace
   that merely carried "knickgasm" got tenant zero's store, collections and
   handles (2026-10-05). A record that cannot be decided is NOT tenant zero;
   with no brand at all the generation's pinned catalogue decides, and with
   neither the slot is nobody's, so it is not tenant zero's. */
function slotIsTenantZero(entry) {
  const b = entry && entry.brand;
  if (b) {
    const z = catalogServer.isTenantZeroBrand(b);
    if (z !== null) return z;
    if (b.id) return false;
  }
  const scope = catalogServer.currentScope();
  if (scope) return scope.source === 'shipped';
  return false;
}
/* The gap a link is left with when the brand publishes no store for this market. */
function storeGap(brand, market) {
  const name = String((brand && brand.name) || 'this brand');
  return `[DATA REQUIRED BEFORE LAUNCH: region store URL, ${name}, ${market || 'all'}]`;
}
/* The brand's own store for a market: its region's store_url, else its website. */
function brandStore(brand, market) {
  let f = null;
  try { f = require('./brand-runtime.js').regionFacts(brand, market); } catch (_) { f = null; }
  return f && f.store ? `https://${f.store}` : String((brand && brand.website) || '').replace(/\/$/, '');
}
function slotLinks(entry) {
  // A non-tenant-zero brand's links come from ITS OWN record: its regional
  // store, the offering's own URL, the hero row's own product page. Tenant
  // zero keeps the catalogue-mapped collection logic below.
  if (!slotIsTenantZero(entry)) {
    const bStore = entry.brand ? brandStore(entry.brand, entry.market) : '';
    let off = entry.heroOffering || entry.offering || {};
    const hp = entry.heroProduct || {};
    const own = /^https?:\/\//i.test(String(hp.product_url || hp.url || '')) ? String(hp.product_url || hp.url) : '';
    // An information brand sells a subscription, not a cart: with no offering
    // on the slot and no product page, its button goes to the subscription the
    // record names (its own URL), not the homepage (asset-playbooks: the news
    // presell's whole job is the subscribe step).
    if (!off.url && !own && entry.brand && Array.isArray(entry.brand.offerings)) {
      let model = '';
      try { model = require('./asset-playbooks.js').businessModel(entry.brand); } catch (_) { model = ''; }
      if (/^(news_media|market_data|subscription)$/.test(model)) {
        const named = entry.brand.offerings.find((o) => o && /^https?:\/\//i.test(String(o.url || '')));
        if (named) off = named;
      }
    }
    const target = off.url || own || bStore || storeGap(entry.brand, entry.market);
    // `pdp` is what the renderers read; `pdpUrl` stays for older callers.
    return { store: bStore || target, collectionUrl: off.url || bStore || target, pdp: target, pdpUrl: target };
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
  // Another brand's product links to ITS OWN page (the row's product_url),
  // else its handle on its OWN store. This built every brand's supporting
  // product links on tenant zero's store (2026-10-05).
  if (!slotIsTenantZero({ brand })) {
    const own = String((product && (product.product_url || product.url)) || '');
    if (/^https?:\/\//i.test(own)) return own;
    let row = null;
    try { row = catalogImage.match(product, market, { brand }); } catch (_) { row = null; }
    if (row && /^https?:\/\//i.test(String(row.product_url || ''))) return row.product_url;
    const base = brand ? brandStore(brand, market) : '';
    let h = null;
    try { h = catalogImage.handleFor(product, market, { brand }); } catch (_) { h = null; }
    if (!h) h = (product && (product.handle || product.h)) || null;
    return base ? (h ? `${base}/products/${h}` : base) : storeGap(brand, market);
  }
  const facts = regionFacts(market);
  const store = `https://${facts.store || 'knickgasm.com'}`;
  let handle = null;
  try { handle = catalogImage.handleFor(product, market, { brand }); } catch (_) { handle = null; }
  handle = handle || (product && (product.handle || product.h)) || null;
  return handle ? `${store}/products/${handle}` : store;
}
function renderVariant(entry, copy, style, img, direction) {
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
  // The card is the PRODUCT's: only its own catalogue photos. It used to fall
  // back to the hero picture, so a product with no photo wore the brand's promo
  // banner as its product shot (Parwah, 2026-10-17); it renders a plain tile now.
  const _hpOwn = (entry.heroProduct && !entry.heroProduct.placeholder && /^https:\/\//i.test(String(entry.heroProduct.image || ''))) ? String(entry.heroProduct.image) : undefined;
  const heroCardImg = heroGallery.find((u) => baseKey(u) !== baseKey(heroImgUrl)) || heroGallery[1] || heroGallery[0] || _hpOwn;
  // Grid = hero + any bundled supporting products, each with its OWN real HD photo
  // and real catalog content (subtitle / design notes), linking to its own real
  // product page (never a fabricated handle).
  const supporting = Array.isArray(entry.supportingProducts) ? entry.supportingProducts : [];
  const catRow = (p) => { try { return catalogImage.match({ handle: p.handle || p.h, title: p.title || p.n }, entry.market, { brand: entry.brand }); } catch (_) { return null; } };
  const products = withGrid && entry.heroProduct
    ? [
        { title: entry.heroProduct.title, handle: entry.heroProduct.handle, image: heroCardImg, price: entry.heroProduct.price, url: links.pdp, note: (catRow(entry.heroProduct) || {}).subtitle || (catRow(entry.heroProduct) || {}).tasting_notes || '', description: entry.heroProduct.description || (catRow(entry.heroProduct) || {}).description || '' },
        ...supporting.map((p) => { const row = catRow(p) || {}; return { title: p.title, handle: p.handle, price: p.price, url: productUrl(p, entry.market, entry.brand), image: catalogImage.imagesFor(p, entry.market, { width: 900, brand: entry.brand })[0] || (/^https:\/\//i.test(String(p.image || '')) ? String(p.image) : undefined), note: row.subtitle || row.tasting_notes || '', description: p.description || row.description || '' }; }),
      ]
    : undefined;
  // NOT TOO MUCH TEXT (2026-10-17). Blocks are taken in order of what they
  // do for the reader - the opening line, the three benefits, the second
  // paragraph, the P.S., the guarantee - while the mail stays inside its word
  // budget (asset-contracts.MAIL_WORDS: the visual mailer says less, its
  // picture carries part of the message). A block that would break the budget
  // is left out WHOLE; no sentence is ever cut.
  const MW = require('./asset-contracts.js').MAIL_WORDS;
  const wc = (t) => String(t || '').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  const budget = style === 'visual' ? MW.visual : MW.text;
  let used = wc(E.hero_headline || E.subject) + wc(E.subheadline || E.preheader) + wc(E.cta);
  const candidates = [
    E.intro_paragraph ? { heading: '', body: E.intro_paragraph, at: 0 } : null,
    (Array.isArray(E.benefits) && E.benefits.length)
      ? { heading: 'What you get', body: E.benefits.slice(0, MW.benefits).map((b) => `✦ ${b}`).join('\n\n'), at: 2 }
      : null,
    E.body_paragraph ? { heading: '', body: E.body_paragraph, at: 1 } : null,
    E.ps ? { heading: '', body: /^\s*p\.?\s*s\b/i.test(E.ps) ? E.ps : `P.S. ${E.ps}`, at: 4 } : null,
    E.guarantee ? { heading: 'Our Guarantee', body: E.guarantee, at: 3 } : null,
  ].filter(Boolean);
  const keep = new Set();
  for (const blk of candidates) {
    const n = wc(blk.heading) + wc(blk.body);
    if (used + n <= budget || keep.size === 0) { keep.add(blk); used += n; }
  }
  // Printed in reading order, whichever survived.
  const bodyBlocks = candidates.filter((blk) => keep.has(blk)).sort((x, y) => x.at - y.at).map(({ heading, body }) => ({ heading, body }));

  // The shared renderer carries no proof slot, so the brand's REAL testimonials
  // (and, when there are none, the marker) are composed onto its output.
  return injectProofBlock(renderTextVariant({
    // The ACTIVE brand travels with the render options: the shared renderer
    // derives wordmark, store URL, claims and the legal sender block from it.
    brand: entry.brand || null,
    style, subject: E.subject, preheader: E.preheader,
    hero_headline: E.hero_headline || E.subject || heroProduct,
    // A subline that is only the hero's price ("₹759") says nothing on its own
    // when the Text mail lists every product with its price below.
    hero_subline: (() => { const sl = E.subheadline || E.preheader || ''; return ((!withGrid || direction === 'brand') && entry.heroProduct && !/[A-Za-z]/.test(String(sl))) ? '' : sl; })(),
    body_blocks: bodyBlocks,
    // Real PDP/collection destinations (no merge-tag literal) so every CTA
    // redirects; matches the flagship mailer's link + grid logic.
    cta_text: E.cta || 'Shop the edit', cta_url: links.pdp,
    market: entry.market, hero_product: heroProduct, hero_image_url: img || undefined,
    // A second button only to a DIFFERENT page: for a brand with no catalogue
    // collection the "collection" was the same address as the main CTA.
    products,
    // The Text variants list what they sell, in words (2026-10-24): each
    // product of the slot with its own page and price, no photographs.
    product_list: withGrid ? undefined : [entry.heroProduct].concat(supporting).filter((p) => p && p.title && !p.placeholder && !/^\[DATA REQUIRED/.test(String(p.title)))
      .map((p, i) => ({ title: require('./mailer-format.js').displayName(p.title) || p.title, price: p.price, url: i === 0 ? links.pdp : productUrl(p, entry.market, entry.brand) })),
    collection_url: (links.collectionUrl && links.collectionUrl !== links.pdp && links.collectionUrl !== links.store) ? links.collectionUrl : undefined,
    offer_bar: (withGrid && (E.offer || (copy.landing && copy.landing.offer_bar))) || undefined,
    // The studied layout, composed differently for each slot and variant
    // (asset-style.js): the brand's look stays, the arrangement moves.
    layout: require('./asset-style.js').mailLayout(entry.__mailStudy && entry.__mailStudy.layout, require('./asset-style.js').recipe(entry, `mail:${style}${direction ? ':' + direction : ''}`)),
  }), entry, style);
}
// Four variants in the SAME taxonomy as the Mailer Calendar: 2 Text + 2 Text +
// Visual, each labelled by its copy framework, with copyA driving the A-slots and
// copyB the B-slots so the two directions read genuinely differently.
// How many products of the slot carry a photograph of their own. The
// collection layouts (landing B, the brand-led mail) show the products as
// pictured cards instead of one hero picture, so they are chosen only when at
// least two products can be pictured; otherwise the slot's picture leads.
function ownPhotoCount(entry) {
  const ps = [entry && entry.heroProduct].concat(Array.isArray(entry && entry.supportingProducts) ? entry.supportingProducts : []);
  return ps.filter((p) => p && !p.placeholder && /^https:\/\//i.test(String(p.image || ''))).length;
}

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
    // Brand-led leads with the brand, not the photo (2026-10-24: it was the
    // product-led mail again): the headline on the brand's own ground, then
    // every product of the slot side by side, the hero's card among them.
    { key: 'visual_b', type: 'Text + Visual', label: `Text + Visual · ${nB}`, framework: fwB && fwB.key, ...variantMeta(copyB), html: ownPhotoCount(entry) >= 2 ? renderVariant(entry, copyB, 'visual', null, 'brand') : renderVariant(entry, copyB, 'visual', heroImg) },
  ];
}

function emailHtml(entry, copy, creativeUrl) {
  const E = copy.email;
  // Brand-derived: this renders for whichever brand owns the slot, so the
  // wordmark, palette, CTA and footer must come from its record, not a fixed
  // tenant's. (This path only runs when an LLM produced the copy, which is why
  // it survived the first sweep.)
  const b = (() => { try { return require('./brand-runtime.js').scopedBrand(entry.brand); } catch (_) { return {}; } })();
  const bName = b.name || '';
  const pal = require('./brand-runtime.js').paletteOf(b);
  const _ef = require('./brand-runtime.js').fontStacks(b);
  const INK = pal.ink;
  const SURF = pal.surface;
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
    ? `<img data-mail-hero src="${img}" alt="${String(E.hero_headline || entry.heroProduct?.title || bName).replace(/"/g, '')}" style="width:100%;display:block;max-height:440px;object-fit:cover"/>`
    : '';

  const benefitsHtml = (Array.isArray(E.benefits) && E.benefits.length)
    ? `<div style="margin:24px 0;padding:20px 22px;background:${pal.surface_alt || '#f7f6f2'};border-radius:6px;border-left:3px solid ${ACC}">
        <p style="font-family:${_ef.head};font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 10px;color:${P}">What you get</p>
        <ul style="margin:0;padding-left:18px;line-height:1.7;color:${INK}">
          ${E.benefits.map((b) => `<li style="margin-bottom:6px">${esc(b)}</li>`).join('')}
        </ul>
      </div>`
    : '';

  const guaranteeHtml = E.guarantee
    ? `<div style="margin:20px 0;padding:12px 16px;background:${pal.surface_alt || '#f7f6f2'};border-radius:4px;text-align:center;font-size:13px;line-height:1.5;color:${INK}">
        <strong style="color:${P}">Our Promise:</strong> ${esc(E.guarantee)}
      </div>`
    : '';

  const psHtml = E.ps
    ? `<p data-mail-body style="font-size:13.5px;line-height:1.6;color:${INK};margin:24px 0 0;padding-top:16px;border-top:1px solid ${pal.line || '#e8e4dc'};${require('./mailer-format.js').JUSTIFY}"><strong>P.S.</strong> ${esc(E.ps)}</p>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${E.subject}</title>${require('./mailer-format.js').MOBILE_CSS}</head>
<body style="margin:0;background:${SURF};color:${INK};font-family:${_ef.body}">
<main style="max-width:680px;margin:auto;background:${SURF}">
  <header data-mail-logo style="background:${SURF};text-align:center;padding:20px 24px">${require('./mailer-format.js').logoMark({ brand: b, store: brandStore(b, entry.market), color: INK, font: _ef.head }).html}</header>
  <section style="background:${P};color:${onP};padding:44px 36px;text-align:center">
    <h1 style="font-family:${_ef.head};font-size:32px;line-height:1.15;margin:0">${E.hero_headline}</h1>
  </section>
  ${heroImg}
  <section style="padding:36px">
    <p data-mail-body style="line-height:1.7;${require('./mailer-format.js').JUSTIFY}">${E.intro_paragraph}</p>
    <p data-mail-body style="line-height:1.7;${require('./mailer-format.js').JUSTIFY}">${E.body_paragraph}</p>
    ${benefitsHtml}
    ${guaranteeHtml}
    <p style="text-align:center;margin:32px 0 8px"><a href="${slotLinks(entry).pdp}" style="background:${ACC};color:${onACC};padding:15px 28px;text-decoration:none;border-radius:4px;font-weight:700;display:inline-block">${E.cta || entry.cta || 'See more'}</a></p>
    ${psHtml}
  </section>
  ${proofBlockHtml(entry)}
  <footer data-mail-footer style="background:${P};color:${onP};text-align:center;padding:22px;font-size:11px">You're receiving this because you subscribed${bName ? ` to ${bName}` : ''}. Manage preferences or unsubscribe from your account settings.</footer>
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
  let rounds = ROUNDS;
  try { if (await require('./llm.js').keylessOnly()) rounds = ROUNDS.slice(-1); } catch (_) { /* keep both */ }
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
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
      return { copy: json, provider: res.provider, model: res.model, output_check: OC.validate(json, copyOutputSpec(entry)) };
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
/**
 * No placeholder reaches a customer, and no fact is invented to replace one
 * (2026-10-23). The first version of this pass (#318) swapped each marker for
 * a made-up value: a discount marker became "WELCOME10", an offer "10% OFF",
 * the legal sender "<Brand> Official Store", the review library "verified by
 * <brand> quality standards". Those are fabricated offers and claims.
 *
 * Now a placeholder is replaced only by the brand's OWN value when the record
 * holds it (its name, its real hero product, its real website). Any other
 * placeholder takes the SENTENCE it sits in with it: the copy says less, never
 * something untrue. The gap itself stays in the campaign's data_gaps / checks.
 */
const MARKER_RX = /\[DATA REQUIRED BEFORE LAUNCH:[^\]]*\]/gi;
function dropSentencesWith(s, rx) {
  // Split into sentences (keeping their ends) and lines; drop any that still
  // hold a placeholder. A string that is nothing but a placeholder is ''.
  const parts = String(s).split(/(?<=[.!?])\s+|\n/);
  const kept = parts.filter((p) => { rx.lastIndex = 0; return !rx.test(p); });
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}
function eliminatePlaceholders(text, entry = {}) {
  if (text == null) return text;
  let s = String(text);
  if (!s.includes('[') && !s.includes('{{') && !s.includes('TBD') && !s.includes('Lorem')) return s;
  // Liquid / Jinja-style merge fields an ESP fills ({{ first_name }}) and our
  // own {{landing_page_url}} are not placeholders here: they are resolved where
  // the asset is assembled.
  const brand = (entry && entry.brand) || {};
  const bName = String(brand.name || '').trim();
  const hp = entry && entry.heroProduct;
  const heroName = hp && !hp.placeholder && hp.title && !/^\[DATA REQUIRED/.test(hp.title) ? String(hp.title) : '';
  const site = /^https?:\/\//i.test(String(brand.website || '')) ? String(brand.website) : '';
  // True substitutions only.
  if (heroName) s = s.replace(/\[DATA REQUIRED BEFORE LAUNCH:\s*(?:product catalogue|hero product)[^\]]*\]/gi, heroName);
  if (site) s = s.replace(/\[DATA REQUIRED BEFORE LAUNCH:\s*(?:region store URL|destination URL)[^\]]*\]/gi, site);
  if (bName) s = s.replace(/\[(?:Brand\s*Name|Your\s*Brand|Company\s*Name)\]/gi, bName);
  if (heroName) s = s.replace(/\[(?:Product\s*Name|Item\s*Name|Hero\s*Product)\]/gi, heroName);
  if (site) s = s.replace(/\[(?:URL|Link|Store\s*URL|Website)\]/gi, site);
  // Everything else: the sentence goes.
  if (MARKER_RX.test(s)) s = dropSentencesWith(s, MARKER_RX);
  MARKER_RX.lastIndex = 0;
  const tagRx = /\[(?:[A-Z][A-Za-z0-9_\s/-]{1,30})\]|\bLorem ipsum\b|\bTBD\b/g;
  if (tagRx.test(s)) s = dropSentencesWith(s, tagRx);
  return s;
}

function scrubCopyDeep(o, entry = {}) {
  const clean = (s) => {
    try {
      const sanitized = SM.sanitizeBrand(String(s));
      return eliminatePlaceholders(sanitized, entry);
    } catch (_) {
      return eliminatePlaceholders(s, entry);
    }
  };
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
    // The slot's brand, a carried device brand or the unresolved placeholder
    // included (2026-10-10): `.id` alone read the placeholder as "no brand",
    // and a spec with no brand is painted in tenant zero's palette and given
    // its audio bed. Only the shipped default (no request, no workspace) keeps
    // the no-brand path, which is tenant zero's own build.
    let brand = null;
    try {
      const sb = require('./brand-runtime.js').scopedBrand(entry && entry.brand, { allowTenantZero: true });
      brand = (sb && (sb.id || sb.carried === true || sb.unresolved === true)) ? sb : null;
    } catch (_) { brand = null; }
    const images = (Array.isArray(pool) ? pool : []).filter(Boolean);
    // ON-SCREEN TEXT IS CUSTOMER COPY (2026-10-14). The beats used to print
    // the storyboard's production directions ("HOOK: extreme close-up of ...,
    // sound-on stinger") with the timecode ("0-2s") under them, so every video
    // ad, on every platform, showed a viewer its own shot list. The storyboard
    // stays the brief for whoever films it (motion_brief, ad.storyboard); what
    // the viewer reads is the ad's hook, then its own copy sentence by sentence,
    // then the product, and the CTA card closes it.
    const words = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const sentences = words(ad.primary_text || ad.caption).split(/(?<=[.!?])\s+/).map(words)
      .filter((x) => x.length >= 8 && x.length <= 90);
    const product = words(entry.heroProduct && !entry.heroProduct.placeholder && entry.heroProduct.title);
    const bName = (brand && brand.name) || '';
    const lines = [];
    const push = (t) => { const v = words(t).slice(0, 90); if (v && !lines.some((x) => x.toLowerCase() === v.toLowerCase())) lines.push(v); };
    // The hook as the ad wrote it (2026-10-23): no suffix templates ("Daily
    // Intelligence & Industry Analysis", "Curated Fresh by <brand>") that the
    // brand never said.
    push(ad.hook || ad.headline);
    sentences.forEach(push);
    if (product) push(product);
    // A badge only when the store STATES it (its own popularity rank, a stated
    // rating): never "BESTSELLER" on every first scene, which the compliance
    // gate rightly blocked as an unsubstantiated superlative.
    let proofBadge = '';
    try { proofBadge = require('./offering-intelligence.js').enrich(Object.assign({ title: product, product_url: entry.heroProduct && entry.heroProduct.product_url }, entry.heroProduct || {})).badge || ''; } catch (_) { proofBadge = ''; }
    const nBeats = Math.max(1, Math.min(3, (Array.isArray(ad.storyboard) ? ad.storyboard.length : 3) - 1));
    const beats = lines.slice(0, nBeats).map((line, i) => {
      // The sub line is a DIFFERENT sentence from the headline, or none.
      const sub = sentences.find((x, j) => j >= i && x.toLowerCase() !== line.toLowerCase()) || '';
      return {
        image: images.length ? images[i % images.length] : '',
        headline: line,
        sub: lines.some((l, k) => k !== i && l.toLowerCase() === sub.toLowerCase() && k < nBeats) ? '' : sub,
        badge: i === 0 && proofBadge ? proofBadge : '',
        seconds: 2.6,
      };
    });
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
      layout: require('./asset-style.js').recipe(entry, `ad:${ad.platform || ''}:${ad.creative_type || ''}`),
    };
    // THE STORY VARIANT (2026-10-24, the operator: "proper video ads upto
    // 30 s ... keep this variant too"): beside the transitional creative, a
    // timed story up to 30 seconds - the hook, each product of the send on its
    // own photograph with its name and price, the ad's own lines, the end
    // card - drawn on a canvas so the reviewer can save it as a video file.
    let story = null;
    try {
      const SA = require('../../scripts/lib/story-ad.js');
      const rt = require('./brand-runtime.js');
      const core = _wsCore();
      const pal = rt.paletteOf(brand || {});
      const ground = core && core.sectionGround ? core.sectionGround(pal.primary, pal.accent, pal.surface) : pal.primary;
      const fs = rt.fontStacks(brand || {});
      const money = (n) => { const v = Number(n); if (!Number.isFinite(v) || v <= 0) return ''; try { return require('./brand-locale.js').money(v, brand || {}, entry.market) || ''; } catch (_) { return ''; } };
      const prods = [entry.heroProduct].concat(Array.isArray(entry.supportingProducts) ? entry.supportingProducts : [])
        .filter((p) => p && p.title && !p.placeholder && !/^\[DATA REQUIRED/.test(String(p.title)))
        .map((p, i) => ({ title: p.title, price_text: money(p.price), image: (/^https:\/\//i.test(String(p.image || '')) ? String(p.image) : '') || images[i % Math.max(1, images.length)] || '' }));
      let store = '';
      try { store = (slotLinks(entry) || {}).store || (brand && brand.website) || ''; } catch (_) { store = (brand && brand.website) || ''; }
      // Units as a person says them ("100 watts"), as on every other asset.
      const U = require('./unit-words.js');
      let uLoc = ''; try { uLoc = rt.homeRegion(brand); } catch (_) { uLoc = ''; }
      const say = (t) => (typeof t === 'string' && /\d/.test(t) ? U.spellUnits(t, { locale: uLoc }) : t);
      prods.forEach((p) => { p.title = say(p.title); });
      const sspec = {
        brand, brandName: bName, hook: say(ad.hook || ad.headline || ''), lines: sentences.map(say), products: prods, images,
        cta: ad.cta || entry.cta || 'Shop now', store, endLine: say(ad.headline || ''),
        palette: { primary: ground, on_primary: core && core.textOn ? core.textOn(ground, pal.surface, pal.ink) : pal.surface,
          accent: pal.surface, on_accent: core && core.readableAsText ? core.readableAsText(ground, pal.surface, 4.5) : pal.ink, surface: pal.surface, ink: pal.ink },
        fonts: { head: String(fs.head).replace(/"/g, "'"), body: String(fs.body).replace(/"/g, "'") },
      };
      story = { html: SA.renderStoryAd(sspec), brief: SA.storyBrief(sspec) };
    } catch (e) { story = { error: String((e && e.message) || e).slice(0, 160) }; }
    ad.creative = Object.assign({}, ad.creative, {
      motion_html: motion.renderMotionAd(spec),
      motion_brief: motion.motionBrief(spec),
      story_html: story && story.html ? story.html : null,
      story_brief: story && story.brief ? story.brief : null,
      story_error: story && story.error ? story.error : undefined,
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

// Held to the brand's own words before anything is judged or rendered
// (2026-10-17): a benefit or sentence that states a quality the brand and its
// catalogue never state is dropped (copy-grounding.js), and the campaign says
// what. It runs BEFORE the brand guard: one invented line ("Award-winning
// service") used to make the guard discard the whole answer - mailer, landing
// page and every ad - when only that line was the problem.
function groundModelCopy(campaign, entry, copyA, copyB) {
  // No model code in a line a person reads first (the subject, the preheader,
  // the headlines): services.stripModelCode, on both directions.
  try {
    const { stripModelCode, sayableProduct } = require('../../lib/smart-brain/services.js');
    const hp = (entry && entry.heroProduct && entry.heroProduct.title) || '';
    const instead = hp ? sayableProduct(entry, hp) : '';
    const say = instead && instead !== hp ? instead : '';
    for (const c of [copyA, copyB]) {
      if (!c || !c.email) continue;
      for (const k of ['subject', 'preheader', 'hero_headline', 'cta']) if (c.email[k]) c.email[k] = stripModelCode(c.email[k], say);
      for (const k of ['hero_headline', 'cta']) if (c.landing && c.landing[k]) c.landing[k] = stripModelCode(c.landing[k], say);
    }
  } catch (_) { /* never stops a build */ }
  try {
    let row = null;
    try { row = catalogImage.match(entry, entry.market, { brand: entry.brand }); } catch (_) { row = null; }
    const product = Object.assign({}, entry.heroProduct || {}, row || {});
    const grounding = require('./copy-grounding.js');
    let dropped = grounding.groundCopy(copyA, entry.brand, product).concat(copyB && copyB !== copyA ? grounding.groundCopy(copyB, entry.brand, product) : []);
    const seen = new Set((campaign.copy_grounding && campaign.copy_grounding.dropped || []).map((d) => d.field + '|' + d.text));
    const fresh = dropped.filter((d) => { const k = d.field + '|' + d.text; if (seen.has(k)) return false; seen.add(k); return true; });
    if (fresh.length) dropped = (campaign.copy_grounding && campaign.copy_grounding.dropped || []).concat(fresh);
    else dropped = (campaign.copy_grounding && campaign.copy_grounding.dropped) || [];
    if (dropped.length) campaign.copy_grounding = { dropped, note: `${dropped.length} line(s) the model wrote were left out: they state something the brand's own record and catalogue do not.` };
  } catch (_) { /* grounding must never stop a build */ }
}

function applyCopy(campaign, entry, copyA, copyB, fwA, fwB, creatives = {}, runId = null) {
  groundModelCopy(campaign, entry, copyA, copyB);
  const briefFor = (copy, k) => ({ brief: (k && copy.ads?.[k]?.image_brief) || '', image: null, provider: null });
  // Distinct real gallery pool for this slot (hero product + supporting), HD.
  // B-variants draw an ALTERNATE real photo (not the email hero) so the A/B
  // pair is visually distinct while every image stays a real catalog shot.
  const pool = slotImagePool(entry, 1400);
  const heroReal = pool[0] || catalogImage.imageFor(entry, entry.market, { width: 1400, brand: entry.brand }) || null;
  const altReal = pool.find((u) => u !== heroReal) || heroReal;
  if (campaign.assets.email) {
    campaign.assets.email.subject = copyA.email.subject || campaign.assets.email.subject;
    campaign.assets.email.preheader = copyA.email.preheader || campaign.assets.email.preheader;
    campaign.assets.email.creative = creatives.email || { brief: copyA.email.image_brief || '', image: null, provider: null };
    // The slot's own picture when no creative was generated: the product's
    // catalogue photo, else the brand's own imagery (2026-10-17).
    const heroImg = campaign.assets.email.creative.image || heroReal || null;
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
    lp.creative = { brief: (copy.landing && copy.landing.image_brief) || '', image: img, provider: isB ? (poolSource(entry) || 'catalog') : ((creatives.landing && creatives.landing.provider) || poolSource(entry) || 'catalog') };
    lp.format = landingFormat(entry, copy, lp.variant);
    lp.html = lp.format === 'direct-offer' ? lpHtml(entry, copy, campaign.campaign_id, img) : lpHtml(entry, copy, campaign.campaign_id, lp.format === 'listicle' ? img : null, { layout: lp.format });
    lp.path = isB ? `/lp/${campaign.campaign_id}?v=b` : `/lp/${campaign.campaign_id}`;
  });
  for (const ad of campaign.assets.ads || []) {
    const isB = ad.variant === 'B';
    // BOTH variants take real LLM copy now: A from copyA, B from copyB (the two
    // framework directions). No static template strings repeated across slots.
    const copy = isB ? copyB : copyA;
    if (ad.platform === 'meta' && copy.ads.meta) Object.assign(ad, { primary_text: copy.ads.meta.primary_text || ad.primary_text, headline: copy.ads.meta.headline || ad.headline, description: copy.ads.meta.description || ad.description });
    // The preview draws overlay.headline; it stayed the template's while the ad
    // carried the model's, so the reviewed creative and the copy disagreed.
    if (ad.platform === 'meta' && ad.overlay && ad.headline) ad.overlay.headline = ad.headline;
    // The model's lines first, then the template's own lines (the brand's
    // names, tagline, claims and action) up to Google's 15 / 4: a model that
    // wrote 3 headlines left Google no choice to make, and the template path
    // already offers more. A line over Google's limit is left out, never cut
    // (google-ads-adapter.js drops it anyway).
    if (ad.platform === 'google' && copy.ads.google) {
      const ac = require('./asset-contracts.js');
      const fit = (list, slot, max) => {
        const lim = ac.slotLimit('ad.google.rsa', slot);
        const out = [];
        for (const t of list) {
          const s = String(t || '').trim();
          if (!s || (Number(lim) > 0 && s.length > Number(lim)) || out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
          out.push(s);
          if (out.length >= max) break;
        }
        return out;
      };
      const mh = (copy.ads.google.headlines || []).filter(Boolean);
      const md = (copy.ads.google.descriptions || []).filter(Boolean);
      Object.assign(ad, {
        headlines: mh.length ? fit(mh.concat(ad.headlines || []), 'headlines', 15) : ad.headlines,
        descriptions: md.length ? fit(md.concat(ad.descriptions || []), 'descriptions', 4) : ad.descriptions,
      });
    }
    if (ad.platform === 'tiktok' && copy.ads.tiktok) Object.assign(ad, { script: copy.ads.tiktok.script || ad.script, caption: copy.ads.tiktok.caption || ad.caption });
    // Per-AD creative (see generateCreatives): the static and the video of one
    // platform are two different ads and no longer share one photo, and youtube
    // and pinterest are no longer unkeyed and imageless. `<platform>` is still
    // accepted as a fallback so a persisted bundle built before this change
    // still resolves.
    const adKey = `${ad.platform}:${ad.creative_type}`;
    if (isB) {
      const catImg = altReal;
      ad.creative = catImg ? { brief: ad.creative_brief || '', image: catImg, provider: poolSource(entry) || 'catalog' } : (creatives[adKey] || creatives[ad.platform] || briefFor(copy, ad.platform));
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
/*
 * The brand safety and regulatory compliance gate runs in the SAME pass
 * (compliance-lint.js), so the review panel reads one verdict per asset and
 * the copywriter was briefed with the same rules (copyPrompt). Its findings
 * join the asset's contract violations, each carrying its rule id, the words
 * it matched and the regulation it enforces; nothing is rewritten.
 *
 * Which brand the assets are judged as is the brand they were RENDERED as:
 * the slot's own; else the brand pinned for this generation or request;
 * else, ASKED FOR BY NAME (allowTenantZero), tenant zero - which is exactly
 * what the template builders rendered with no brand on the slot
 * (lib/smart-brain/services.js entryBrand), so judge and renderer agree.
 */
function complianceContext(campaign, entry) {
  const e = entry || {};
  const stamped = (e.brand && (e.brand.id || e.brand.slug || e.brand.unresolved === true)) ? e.brand
    : (campaign && campaign.brand && typeof campaign.brand === 'object' ? campaign.brand : null);
  let brand = stamped;
  try { brand = stamped || require('./brand-runtime.js').scopedBrand(null, { allowTenantZero: true }); } catch (_) { brand = stamped; }
  let skuClaims = [];
  if (entry) { try { skuClaims = approvedProof(Object.assign({}, entry, { brand })).claims || []; } catch (_) { skuClaims = []; } }
  const offer = e.offer || (e.decision && e.decision.offer) || (campaign && campaign.offer) || null;
  return require('./compliance-lint.js').contextFor({
    brand,
    market: e.market || (campaign && campaign.market) || '',
    approvedClaims: skuClaims,
    offer,
    // A deadline line is read on the slot's SEND date, not the build date.
    now: e.date || null,
  });
}

/**
 * The offer a campaign was built with, stamped on the campaign record, so the
 * dispatch gate can read it SERVER-SIDE from smart_generated_campaigns when a
 * job names the campaign, instead of trusting an offer in a request body.
 */
function offerOf(entry) {
  const o = entry && (entry.offer || (entry.decision && entry.decision.offer));
  return o && typeof o === 'object' ? JSON.parse(JSON.stringify(o)) : null;
}

function checkAssetContracts(campaign, entry) {
  const contracts = require('./asset-contracts.js');
  const compliance = require('./compliance-lint.js');
  // `warnings` are findings about how an asset was BUILT; `data_gaps` are
  // findings about what the brand's record lacks (a logo, a photo), which the
  // operator fills and the builder cannot (2026-10-17). Both are listed.
  const summary = { checked: 0, blocking: 0, warnings: 0, data_gaps: 0, by_contract: {}, violations: [] };
  const ctx = complianceContext(campaign, entry);
  const comp = {
    checked: 0, blocking: 0, warnings: 0, verdict: 'pass',
    packs: ctx.selection.packs, selection: ctx.selection, limits: ctx.limits, findings: [],
  };
  summary.compliance = comp;
  const selectionSeen = new Set();

  const judge = (asset, label) => {
    if (!asset) return;
    const verdict = contracts.check(asset);
    asset.contract_check = verdict;
    // Compliance reads every asset, governed by a contract or not.
    const cl = compliance.lint(asset, ctx);
    asset.compliance_check = cl;
    if (cl.fields) comp.checked += 1;
    for (const f of cl.findings) {
      const level = f.severity === 'BLOCK' ? 'block' : 'warn';
      const v = {
        level, slot: f.field || 'compliance', rule: f.id, compliance: true,
        message: `${f.title}${f.matched ? ` ("${f.matched}")` : ''}: ${f.fix}`,
        matched: f.matched, offsets: f.offsets, citation: f.citation, offer: f.offer, marker: f.marker,
      };
      if (f.scope === 'selection') {
        // What could not be checked is one fact about the campaign, not one per asset.
        if (selectionSeen.has(f.id)) continue;
        selectionSeen.add(f.id);
        summary.violations.push({ asset: 'campaign', contract: 'compliance', ...v });
      } else {
        verdict.violations.push(v);
        if (level === 'block') { verdict.blocking += 1; verdict.ok = false; }
        summary.violations.push({ asset: label, contract: verdict.contract || 'compliance', ...v });
      }
      if (level === 'block') { summary.blocking += 1; comp.blocking += 1; } else { summary.warnings += 1; comp.warnings += 1; }
      comp.findings.push(Object.assign({ asset: f.scope === 'selection' ? 'campaign' : label }, f));
    }
    if (!verdict.contract) return;             // nothing governs this type yet
    summary.checked += 1;
    summary.by_contract[verdict.contract] = (summary.by_contract[verdict.contract] || 0) + 1;
    for (const v of verdict.violations) {
      if (v.compliance) continue;              // counted above
      if (v.level === 'block') summary.blocking += 1; else if (v.data_gap) summary.data_gaps += 1; else summary.warnings += 1;
      summary.violations.push({ asset: label, contract: verdict.contract, ...v });
    }
  };

  judge(campaign.assets && campaign.assets.email, 'email');
  // Each mailer variant is judged as its own type (2026-10-17): a Text mail
  // must carry no picture but the logo, a Text + Visual one must carry one.
  const _em = campaign.assets && campaign.assets.email;
  (Array.isArray(_em && _em.variants) ? _em.variants : []).forEach((vr) => {
    const as = { contract: 'email.mailer', subject: vr.subject_line, preheader: vr.preview_text, html: vr.html, mailer_type: /visual/i.test(String(vr.type || vr.key)) ? 'text_visual' : 'text' };
    judge(as, `email:${vr.key || vr.type}`);
    vr.contract_check = as.contract_check;
    vr.compliance_check = as.compliance_check;
  });
  ((campaign.assets && campaign.assets.ads) || []).forEach((ad, i) =>
    judge(ad, `ad:${ad.platform}:${ad.creative_type || 'static'}:${ad.variant || 'A'}#${i}`));
  ((campaign.assets && campaign.assets.landing_pages) || []).forEach((lp, i) =>
    judge(lp, `landing:${lp.variant || 'A'}#${i}`));
  ((campaign.assets && campaign.assets.messages) || []).forEach((m, i) =>
    judge(m, `message:${m.channel}#${i}`));

  comp.verdict = comp.blocking ? 'block' : (comp.warnings ? 'warn' : 'pass');
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
  // The slot's own product photo, as the planner read it off this brand's
  // catalogue row (2026-10-17: a named hero with its image on the entry gave
  // the Text + Visual mailers no picture when the catalogue lookup missed).
  const hp = entry.heroProduct;
  if (hp && !hp.placeholder && /^https:\/\//i.test(String(hp.image || '')) && !/^\[DATA REQUIRED/.test(String(hp.title || ''))) push([String(hp.image)]);
  try { push(catalogImage.imagesFor(entry.heroProduct || entry, market, { width, brand: entry.brand })); } catch (_) {}
  const supporting = Array.isArray(entry.supportingProducts) ? entry.supportingProducts : [];
  for (const p of supporting) { try { push(catalogImage.imagesFor(p, market, { width, brand: entry.brand })); } catch (_) {} }
  return urls;
}

// A brand with no product photo is not an image-free brand (2026-10-17): its
// own site imagery, else one generated brand scene (brand-imagery.js), fills
// the same pool every channel draws from. Product photos always win.
const brandImagery = require('./brand-imagery.js');
const _scenes = new WeakMap();
function slotImagePool(entry, width) {
  const real = realImagePool(entry, width);
  if (real.length) return real;
  const own = brandImagery.ownImageUrls(entry && entry.brand);
  if (own.length) return own;
  const scene = entry && typeof entry === 'object' ? _scenes.get(entry) : null;
  return scene ? [scene.url] : [];
}
function poolSource(entry) {
  if (realImagePool(entry, 400).length) return 'catalog';
  if (brandImagery.ownImageUrls(entry && entry.brand).length) return 'brand-site';
  if (entry && typeof entry === 'object' && _scenes.get(entry)) return 'generated';
  return null;
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
  const pool = slotImagePool(entry, 1600);
  const out = {};
  activeSpecs.forEach(([key, rawBrief], i) => {
    const b = (rawBrief && String(rawBrief).trim()) || `${(entry.brand && entry.brand.name) || 'Brand'} ${entry.heroProduct?.title || 'catalogue item'} — real product photograph, on this brand's own palette.`;
    const image = pool.length ? pool[i % pool.length] : null;
    out[key] = { brief: b, image, provider: image ? (poolSource(entry) || 'catalog') : null };
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
/**
 * The brand the request being served already resolved (api/brain.js and
 * api/calendar.js put it on req.__brand): a workspace's row, the record a
 * mobile+PIN account carried, or the unresolved placeholder. Null outside a
 * request - the scheduler and the scripts - so the userless default keeps
 * applying there and only there.
 */
function requestBrand() {
  try {
    const rs = require('./request-scope.js');
    const req = rs.currentRequest && rs.currentRequest();
    const b = req && req.__brand;
    // A record that NAMES a brand: a workspace row (it has an id), a record a
    // phone account carried, or the unresolved placeholder. The shipped
    // default (no id - what brand-runtime.resolve() answers every userless
    // call with) is not an answer here, so a WORKSPACE_ID-pinned scheduler
    // run keeps resolving its own workspace's row below instead of being
    // stamped as tenant zero (2026-09-29, review).
    if (b && (b.id || b.carried === true || b.unresolved === true)) return b;
  } catch (_) { /* outside a wrapped handler */ }
  return null;
}

/** Is the request being served a PERSON's (session token present), not the scheduler's? */
function requestIsPerson() {
  try {
    const rs = require('./request-scope.js');
    const req = rs.currentRequest && rs.currentRequest();
    return !!(req && require('./workspace-scope.js').requestHasUser(req));
  } catch (_) { return false; }
}

async function stampBrand(entry, config) {
  if (!entry) return entry;
  // A STORED slot carries the brand object it was planned under, and that
  // record is history, not the brand (2026-10-11): a workspace renamed from
  // Mamaearth to DelhiChic kept mailing "The Mamaearth team" and Mamaearth's
  // legal footer, because this returned early whenever the slot had a brand.
  // The current record is resolved every time; the slot's own copy is kept
  // only when nothing can be resolved (no request, no database).
  // The request's own brand outranks a workspace lookup, and it is the ONLY
  // brand a request with no workspace may be stamped with: without this a
  // phone account's entries were stamped with the oldest workspace's brand,
  // because "no workspace" fell to defaultWorkspaceId() (2026-09-29).
  const carried = requestBrand();
  if (carried) { entry.brand = carried; return entry; }
  if (carried === null && requestIsPerson() && !(entry.workspace_id || (config && config.workspace_id))) {
    // A person with no workspace and no brand on the request: the slot's
    // remembered brand is not theirs to be stamped with.
    if (entry.brand) delete entry.brand;
    return entry;
  }
  try {
    const wsScope = require('./workspace-scope.js');
    const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
    if (!url || !key) return entry;
    const env = { url, key };
    // The oldest workspace is the SCHEDULER's default, never a person's: a
    // signed-in caller with no workspace is stamped with no brand here (the
    // prompt builder then marks the gap) rather than with tenant zero's.
    const wsId = entry.workspace_id || (config && config.workspace_id) || (requestIsPerson() ? null : await wsScope.defaultWorkspaceId(env));
    if (!wsId) return entry;
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
  // Another brand's products never reach a writer (2026-10-10): a slot planned
  // from a catalogue the coherence rule now calls another brand's is built
  // with the catalogue marker in the hero, not with that brand's product.
  scrubForeignProducts(entry);
  // A slot with no market is built for the brand's HOME market (2026-10-10),
  // never for none: an inline entry with no market came back with every
  // region-scoped fact, currency and marker reading "all".
  if (entry && !entry.market && entry.brand) {
    try { const home = require('./brand-runtime.js').homeRegion(entry.brand); if (home) entry.market = home; } catch (_) { /* leave it */ }
  }
  // Proof BEFORE copy: the copywriter is handed the brand's real testimonials to
  // quote verbatim, instead of being handed an example rating to complete.
  await loadBrandReviews(entry, config);
  const catalogCtx = {
    brand: (entry && entry.brand) || null,
    workspaceId: (entry && entry.workspace_id) || (config && config.workspace_id) || null,
  };
  // WHAT THE BRAND'S COMPETITORS' EMAILS ARE MADE OF (2026-10-18): the mail
  // the competitive benchmarking feature captured from this brand's own
  // competitor set, else the category reference set, measured as rendered.
  // It shapes the mail's layout and briefs the writer on line lengths; it is
  // never a source of facts. Kept off the stored entry (not enumerable).
  if (entry && typeof entry === 'object' && !entry.__mailStudy) {
    let st = null;
    try { st = await require('./competitor-mail-study.js').studyFor(entry.brand, { workspaceId: catalogCtx.workspaceId }); } catch (_) { st = null; }
    if (st) Object.defineProperty(entry, '__mailStudy', { value: st, enumerable: false, configurable: true });
  }
  const built = await catalogServer.withCatalog(catalogCtx, () => _buildCampaign(entry, config, opts));
  if (built && typeof built === 'object') {
    if (entry && entry.__mailStudy) {
      const st = entry.__mailStudy;
      built.mail_study = { basis: st.basis, emails: (st.patterns && st.patterns.emails) || 0, sources: (st.sources || []).slice(0, 12), layout: st.layout, why: st.why || '' };
    }
    built.brand_identity = brandIdentity(entry && entry.brand);
    built.brand_name = (entry && entry.brand && entry.brand.name) || null;
  }
  return built;
}

/** The identity of the brand this request plans for now (null: none resolvable). */
async function currentIdentity(config, db) {
  return (await currentBrandInfo(config, db)).ident;
}
/** The current record's fingerprint and name ({ ident: null } when none resolves). */
async function currentBrandInfo(config, db) {
  try {
    const pb = await planningBrand(config, db);
    // Tenant zero is fingerprinted from its shipped record whichever door it
    // is reached by (the scheduler has no workspace row in hand, a person has
    // one), so the two never re-plan each other's slots every day.
    if (pb.isZero) {
      const zero = Object.assign({}, require('./brand-runtime.js').defaultBrand(), { owns_shipped: true });
      return { ident: brandIdentity(zero), name: zero.name || '' };
    }
    if (pb.brand) return { ident: brandIdentity(pb.brand), name: pb.brand.name || '' };
  } catch (_) { /* unresolved */ }
  return { ident: null, name: '' };
}

/** A stored slot or campaign made for another brand record than the current one. */
function brandChangedError(what) {
  const e = new Error(`This ${what} was made for an earlier version of this brand's record (another name, website, legal sender or catalogue), so it is not shown, reused or approved. Run Daily Sync to re-plan it for the brand as it is now.`);
  e.status = 409; e.code = 'brand_changed';
  return e;
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

  // A slot planned before titles were cleaned still carries the store's
  // doubled name ("Bausch & Lomb Lacelle Bausch & Lomb Lacelle ..."): every
  // asset says it once (2026-10-24).
  if (entry && typeof entry === 'object') {
    const MFx = require('./mailer-format.js');
    const clean = (p) => (p && typeof p === 'object' && typeof p.title === 'string' ? { ...p, title: MFx.dedupeTitle(p.title) } : p);
    if (entry.heroProduct) entry.heroProduct = clean(entry.heroProduct);
    if (Array.isArray(entry.supportingProducts)) entry.supportingProducts = entry.supportingProducts.map(clean);
  }

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
  // No product photo and no image of its own: one generated brand scene (never
  // a product), labelled. BEFORE the template assets are built, so a send with
  // no model key at all still carries it: with no key and no storage the scene
  // is the free keyless one (brand-imagery.freeScene).
  // Every build, not only one that asks for creatives (2026-10-18): the /brain
  // View build asks for none, so a brand with no picture of its own saw none in
  // any asset. One scene per brand, kept: the View build waits a bounded time
  // for the free keyless scene, a full build may ask a keyed provider, and the
  // offline rebuild (noLLM) uses a scene already made and never waits.
  let scene = null;
  if (!_scenes.get(entry) && !realImagePool(entry, 400).length && !brandImagery.ownImageUrls(entry.brand).length) {
    scene = noLLM ? brandImagery.peekScene(entry.brand)
      : await brandImagery.sceneFor(entry.brand, { quick: !withCreatives, budgetMs: 25000 }).catch(() => null);
    if (scene) {
      _scenes.set(entry, scene);
      try { Object.defineProperty(entry, '__scene_url', { value: scene.url, enumerable: false, configurable: true }); } catch (_) { /* frozen entry: the pool still has it */ }
    }
  }
  const campaign = new GenerationService(config).generate(entry);
  campaign.offer = offerOf(entry);
  let copyMeta = { provider: 'template-fallback', model: null, creatives: 'none' };
  // The model's SMS / WhatsApp / push lines, when it wrote them (2026-10-23).
  let msgCopy = null;
  // Agent pipeline trace, surfaced in the console so the reviewer sees which
  // specialist agent produced each part of the mailer.
  const trace = [];
  if (scene) {
    campaign.generated_imagery = { url: scene.url, provider: scene.provider, keyless: !!scene.keyless, note: 'A generated brand scene: the brand has no product photo and no imagery of its own on record. It shows no product.' };
    trace.push({ agent: 'Asset Director', role: 'Brand scene', ok: true, provider: scene.provider, output: { url: scene.url } });
  }
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
    // With nothing but the keyless provider (one answer per 30 s), three calls
    // meant the copy was always refused; one copy call, no optional brief.
    let keylessOnly = false;
    try { keylessOnly = await require('./llm.js').keylessOnly(); } catch (_) { keylessOnly = false; }
    const sb = keylessOnly ? null : await strategyBrief(entry);
    const brief = sb ? { ...sb.brief, __provider: sb.provider } : null;
    if (sb) trace.push({ agent: 'Strategy Analyst', role: 'Head of Growth Strategy', ok: true, provider: sb.provider, output: { angle: sb.brief.angle, differentiator: sb.brief.differentiator, emotion: sb.brief.target_emotion } });

    // ── Agent 2 · Content Writer — two diverging copy frameworks (A/B), written
    // in parallel (same wall-clock as one call), each following the brief.
    const fwA = CF.pickCopyFramework({ play_key: entry.objective || '', cohort_key: (entry.cohort && (entry.cohort.key || entry.cohort.name)) || '', seed: entry.id || entry.date || '' });
    const otherKeys = Object.keys(CF.COPY_FRAMEWORKS).filter((k) => k !== fwA.key);
    const fwB = CF.frameworkByKey(otherKeys[CF.stableIndex(`${entry.id || entry.date || ''}|b`, otherKeys.length)]) || fwA;
    // Stagger the two copy directions by ~600ms so they don't hit the same
    // provider's per-minute limit in the exact same instant (reduces burst-429s).
    const [pA, pB] = keylessOnly
      ? await Promise.allSettled([writeCopyWithLLM(entry, fwA, brief), Promise.reject(new Error('one copy direction on the keyless provider'))])
      : await Promise.allSettled([
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
    let copyA = gateProof(scrubCopyDeep(rawA.copy, entry), entry);
    let copyB = gateProof(scrubCopyDeep(rawB.copy, entry), entry);
    groundModelCopy(campaign, entry, copyA, copyB);
    // …then the BRAND GUARD (brand-guard.js): an answer that invents a figure
    // or a claim, or names another company, is not used, whichever model wrote
    // it. One direction failing takes the other's copy; both failing falls to
    // the template assets, which say only what the brand's own record states.
    {
      const guard = require('./brand-guard.js');
      const gBrand = (() => { try { return require('./brand-runtime.js').scopedBrand(entry.brand) || entry.brand || {}; } catch (_) { return entry.brand || {}; } })();
      const allow = [entry.heroProduct && entry.heroProduct.title].concat((entry.supportingProducts || []).map((x) => x && x.title), [entry.offering && entry.offering.name]).filter(Boolean);
      const gA = guard.check(copyA, gBrand, { market: entry.market, allow });
      const gB = copyB === copyA ? gA : guard.check(copyB, gBrand, { market: entry.market, allow });
      const rejected = [];
      if (!gA.ok) rejected.push({ direction: 'A', provider: rawA.provider || null, violations: gA.violations });
      if (!gB.ok && copyB !== copyA) rejected.push({ direction: 'B', provider: rawB.provider || null, violations: gB.violations });
      if (rejected.length) {
        campaign.brand_guard = { rejected };
        trace.push({ agent: 'Brand Guard', role: 'Brand guidelines', ok: false, provider: 'rule-based', output: { rejected: rejected.map((r) => ({ direction: r.direction, provider: r.provider, violations: r.violations.map((v) => v.detail) })) } });
      }
      if (!gA.ok && !gB.ok) {
        const e = new Error('brand_guard: every copy direction broke the brand\'s rules; using the template assets');
        e.brandGuard = rejected;
        throw e;
      }
      if (!gA.ok) copyA = copyB;
      if (!gB.ok) copyB = copyA;
    }
    msgCopy = (copyA && copyA.messaging && typeof copyA.messaging === 'object') ? copyA.messaging : null;
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
  // BOTH MAILER TYPES ON EVERY PATH (2026-10-17). The operator: "Need both
  // types of mailers - 1. Text only 2. Text and visuals". Only the model path
  // built the four variants; a send built with no model (or with a model that
  // failed) shipped one mailer of neither type. The template's own facts go
  // through the same shared renderer: two Text, two Text + Visual, the visual
  // pair led by the slot's real picture (catalogue photo, the brand's own
  // imagery or the generated brand scene).
  try {
    const em = campaign.assets && campaign.assets.email;
    if (em && !Array.isArray(em.variants) && renderTextVariant) {
      const tc = require('../../lib/smart-brain/services.js').templateEmailCopy(entry, em);
      const pool = slotImagePool(entry, 1200);
      const heroImg = (scene && scene.url) || pool[0] || null;
      em.variants = emailVariants(entry, tc.A, tc.B, { key: 'product', name: 'Product-led' }, { key: 'brand', name: 'Brand-led' }, heroImg);
      // The landing pages on this path go through the SAME page builder as the
      // model path (2026-10-24: the template's own page had no logo, no copy
      // and B was A with "Why" in front): A leads with the slot's picture, B is
      // the collection page.
      (campaign.assets.landing_pages || []).forEach((lp) => {
        const isB = lp.variant === 'B';
        const copy = isB ? tc.B : tc.A;
        lp.format = landingFormat(entry, copy, lp.variant);
        lp.html = lp.format === 'direct-offer' ? lpHtml(entry, copy, campaign.campaign_id, heroImg) : lpHtml(entry, copy, campaign.campaign_id, lp.format === 'listicle' ? heroImg : null, { layout: lp.format });
      });
    }
  } catch (e) { console.warn('[smart-brain] template mail variants failed:', e && e.message); }
  // SMS, WHATSAPP AND PUSH (2026-10-23), on both paths, only for a slot that
  // plans them (the brand states it sends on them).
  attachMessaging(campaign, entry, msgCopy, trace);
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
      const pool = slotImagePool(entry, 1400);
      for (const ad of needsMotion) attachMotionCreative(ad, entry, pool);
    }
  } catch (_) { /* a motion build must never take a campaign down */ }
  // EVERY STATIC AD SHOWS THE PRODUCT, ON EVERY PATH (2026-10-14). The sales
  // audit found the template path gave no static ad a photo (the console said
  // "No approved photograph for this slot" beside a catalogue that had one),
  // and the model path fell back to an image-free brief whenever generation
  // missed. A static ad with no picture of what it sells does not sell it. Each
  // image-free static takes a DISTINCT real photo from this brand's own
  // catalogue (hero first, then supporting products); with none, it stays
  // image-free and the gap is already on campaign.data_gaps.
  try {
    const statics = (campaign.assets && campaign.assets.ads || [])
      .filter((ad) => ad.creative_type !== 'video' && !(ad.creative && ad.creative.image));
    if (statics.length) {
      const pool = slotImagePool(entry, 1200);
      const used = new Set((campaign.assets.ads || []).map((a) => a.creative && a.creative.image).filter(Boolean));
      const fresh = pool.filter((u) => !used.has(u));
      const order = fresh.length ? fresh : pool;
      statics.forEach((ad, i) => {
        if (!order.length) return;
        const image = order[i % order.length];
        ad.creative = Object.assign({ brief: ad.creative_brief || '' }, ad.creative || {}, { image, provider: poolSource(entry) || 'catalog' });
      });
    }
  } catch (_) { /* a photo assignment must never take a campaign down */ }
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
  attachDisclaimer(campaign, entry);
  attachPlacementCopy(campaign, entry);
  fillLandingUrl(campaign, entry);
  attachUnitWords(campaign, entry);
  // The review gap is in the checks even when nothing was dropped: the asset
  // shows no proof section, and the reviewer still sees why.
  if (!(Array.isArray(entry.__reviews) && entry.__reviews.length)) {
    campaign.data_gaps = [...new Set([...(Array.isArray(campaign.data_gaps) ? campaign.data_gaps : []), proofMarker(entry)])];
  }
  // A commercial mail needs the sender's legal name and postal address
  // (CAN-SPAM). The mail shows neither marker; the gap is listed here.
  {
    const b = (entry && entry.brand) || {};
    const legal = String(b.legal_entity || b.legal_name || (b.brand_data && (b.brand_data.legal_entity || b.brand_data.legal_name)) || '').trim();
    if (!legal || legal.split(',').length < 2) {
      const L = require('./brand-locale.js');
      campaign.data_gaps = [...new Set([...(Array.isArray(campaign.data_gaps) ? campaign.data_gaps : []), L.marker('legal sender name and postal address', b)])];
    }
  }
  // THE MARKETING TEAM (2026-10-20): UTM tags on every link to the brand's own
  // site, a tracked destination on every ad, the KPI and test plan for the send,
  // an SEO check of each landing page, and what each department did for it.
  let __target = '';
  try { __target = slotLinks(entry).pdp || ''; } catch (_) { __target = ''; }
  require('./marketing-team-server.js').applyToCampaign(campaign, entry, { target: __target });
  // MUSIC (2026-10-25): the brief for this send's track, in the brand's own
  // words, as long as its Story video (built above); composed on request.
  attachMusic(campaign, entry, null);
  campaign.build_version = ASSET_BUILD_VERSION;
  // Last, because it judges the FINISHED artefacts rather than the plan. The
  // entry names whose brand, which market and which offer they are judged as.
  checkAssetContracts(campaign, entry);
  return campaign;
}

// MUSIC FOR THE SLOT (2026-10-25, the operator: "add music creation in the
// smart brain"). brand-music.js writes the brief from the brand's own record:
// a sale when the slot carries an offer, the hero product when it has one,
// else the brand's anthem, as long as the Story video so the track scores it.
// No model is called here and nothing is charged; the preview's Compose button
// sends this brief to ?action=music-compose (Lyria first).
function musicOfferText(o) {
  if (!o || typeof o !== 'object') return '';
  const said = String(o.headline || o.label || o.text || '').trim();
  if (said) return said.slice(0, 80);
  const pct = Number(o.pct);
  if (Number.isFinite(pct) && pct > 0) return `${Math.round(pct)}% off${o.code ? ` with code ${String(o.code).slice(0, 24)}` : ''}`;
  return '';
}
function attachMusic(campaign, entry, trace) {
  try {
    if (!campaign || !campaign.assets) return null;
    const BM = require('./brand-music.js');
    const brand = (entry && entry.brand) || {};
    if (!brand.name) return null;
    const hero = entry && entry.heroProduct && !entry.heroProduct.placeholder && !/^\[DATA REQUIRED/.test(String(entry.heroProduct.title || '')) ? entry.heroProduct : null;
    const offer = musicOfferText(offerOf(entry));
    const ad = (campaign.assets.ads || []).find((a) => a && a.creative && a.creative.story_brief);
    const storySecs = ad && ad.creative.story_brief && Math.ceil(Number(ad.creative.story_brief.duration_s));
    const seconds = Number.isFinite(storySecs) && storySecs > 0 ? Math.round(storySecs) : 30;
    const p = BM.plan({ brand, purpose: offer ? 'sale' : (hero ? 'product' : 'anthem'), product: hero ? { title: hero.title } : null, offer, seconds, vocals: false });
    const image = hero && /^https:\/\//i.test(String(hero.image || '')) ? String(hero.image) : '';
    campaign.assets.music = Object.assign({}, p, { image_url: image, for: 'Story video and ads of this send' });
    if (Array.isArray(trace)) trace.push({ agent: 'Music Director', role: 'brand track brief', ok: true, provider: 'code', output: { purpose: p.purpose, genre: p.genre, seconds: p.seconds } });
    return campaign.assets.music;
  } catch (e) {
    console.warn('[smart-brain] music brief failed:', e && e.message);
    return null;
  }
}

// SMS, WhatsApp and push as finished assets (2026-10-23, messaging-assets.js).
// The model's line when it wrote one, else the brand's own lines; the builder
// adds the sender, the slot's own page and the opt-out. Scrubbed for the
// brand's banned words and dashes here; units, compliance and the contract run
// with every other asset below. A gap (no page, no legal sender) is said in
// data_gaps, never printed in the message.
function attachMessaging(campaign, entry, modelCopy, trace) {
  try {
    const M = require('./messaging-assets.js');
    if (!M.plannedOn(entry).length || !campaign || !campaign.assets) return null;
    let link = '';
    try { link = slotLinks(entry).pdp || ''; } catch (_) { link = ''; }
    const rt = require('./brand-runtime.js');
    const brand = (entry && entry.brand) || null;
    const scrub = (t) => { try { return rt.scrubForBrand(SM.sanitizeBrand ? SM.sanitizeBrand(String(t)) : String(t), brand); } catch (_) { return String(t); } };
    const built = M.build(entry, { copy: modelCopy, link, finish: scrub });
    for (const m of built.messages) {
      for (const k of ['text', 'line', 'headline', 'body', 'title', 'cta', 'footer']) if (typeof m[k] === 'string') m[k] = scrub(m[k]);
      M.syncTemplate(m);
    }
    campaign.assets.messages = built.messages;
    if (built.data_gaps.length) campaign.data_gaps = [...new Set((Array.isArray(campaign.data_gaps) ? campaign.data_gaps : []).concat(built.data_gaps))];
    if (Array.isArray(trace)) trace.push({ agent: 'Messaging Writer', role: 'SMS / WhatsApp / push', ok: true, provider: modelCopy ? 'model' : 'template', output: { channels: built.messages.map((m) => m.channel), gaps: built.data_gaps.length } });
    return built;
  } catch (e) {
    console.warn('[smart-brain] messaging assets failed:', e && e.message);
    return null;
  }
}

// A measurement is written as a person says it (2026-10-21, the operator: "the
// letter W ... means watts, so basically 100 watts, it shouldn't say 100 W").
// The store's spec line ("100W", "20000mAh", "500ml") reaches copy from the
// catalogue, the claims and the model; every finished asset is spelled here, in
// text only (never a URL, attribute, style or script), for the brand's home
// market. An ad field keeps its symbol only when the words would break the
// platform's character limit, and says so.
/**
 * `{{landing_page_url}}` is a real address in what is saved and sent
 * (2026-10-23): only the /brain download filled it, so an approved mail went
 * out with a button that pointed nowhere. It becomes this campaign's hosted
 * landing page (absolute, on this deployment) when it has one, else the
 * slot's own product or store page. With neither, the link is left out of the
 * text part and the button keeps the brand's website.
 */
function fillLandingUrl(campaign, entry) {
  if (!campaign || !campaign.assets) return null;
  let base = '';
  try { base = String(require('./self-url.js').selfBaseUrl() || '').replace(/\/$/, ''); } catch (_) { base = ''; }
  const hasLp = Array.isArray(campaign.assets.landing_pages) && campaign.assets.landing_pages.length && campaign.campaign_id;
  let target = hasLp && /^https?:\/\//.test(base) ? `${base}/lp/${campaign.campaign_id}` : '';
  if (!target) {
    let l = null;
    try { l = slotLinks(entry); } catch (_) { l = null; }
    const pdp = l && /^https?:\/\//.test(String(l.pdp || '')) ? String(l.pdp) : '';
    const site = entry && entry.brand && /^https?:\/\//.test(String(entry.brand.website || '')) ? String(entry.brand.website) : '';
    target = pdp || site;
  }
  const seen = new WeakSet();
  const fixHref = (v) => (target ? v.replace(/href=(["'])(?:\[DATA REQUIRED BEFORE LAUNCH:[^"']*|#)\1/g, (m, q) => `href=${q}${target}${q}`) : v);
  const walk = (v) => {
    if (typeof v === 'string') {
      // A link to a marker or to "#" goes where the button means to go.
      const w = /href=/.test(v) ? fixHref(v) : v;
      return w.indexOf('{{landing_page_url}}') < 0 ? w
        : (target ? w.split('{{landing_page_url}}').join(target) : w.replace(/[^\n]*\{\{landing_page_url\}\}[^\n]*\n?/g, ''));
    }
    if (!v || typeof v !== 'object' || seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = walk(v[i]); return v; }
    for (const k of Object.keys(v)) {
      if (target && /^(destination_url|final_url|url|link)$/.test(k) && typeof v[k] === 'string' && /^\[DATA REQUIRED BEFORE LAUNCH:/.test(v[k])) v[k] = target;
      else v[k] = walk(v[k]);
    }
    return v;
  };
  walk(campaign.assets);
  if (campaign.platform_ready) walk(campaign.platform_ready);
  campaign.landing_url = target || null;
  return target;
}

function attachUnitWords(campaign, entry) {
  const a = campaign && campaign.assets;
  if (!a) return null;
  const U = require('./unit-words.js');
  const ac = require('./asset-contracts.js');
  const brand = entry && entry.brand;
  let locale = '';
  try { locale = require('./brand-runtime.js').homeRegion(brand); } catch (_) { locale = ''; }
  const opts = { locale };
  const report = { spelled: 0, kept_for_limit: [] };
  const say = (v, html) => {
    if (typeof v !== 'string' || !/\d/.test(v)) return v;
    const out = html ? U.spellUnitsHtml(v, opts) : U.spellUnits(v, opts);
    if (out !== v) report.spelled += 1;
    return out;
  };
  const em = a.email;
  if (em && typeof em === 'object') deep(em);
  for (const lp of Array.isArray(a.landing_pages) ? a.landing_pages : []) deep(lp);
  for (const ad of Array.isArray(a.ads) ? a.ads : []) finishAd(ad);
  // SMS / WhatsApp / push (2026-10-23): an SMS keeps a symbol when the words
  // would send it as one more part; a template field keeps it past its limit.
  const MA = require('./messaging-assets.js');
  for (const m of Array.isArray(a.messages) ? a.messages : []) {
    if (!m || typeof m !== 'object') continue;
    const contract = ac.contractFor(m);
    for (const slot of ['text', 'line', 'headline', 'body', 'title', 'cta']) {
      const v = m[slot];
      if (typeof v !== 'string') continue;
      const out = say(v, false);
      if (out === v) continue;
      const lim = Number(contract ? ac.slotLimit(contract.id, slot) : 0) || 0;
      const moreParts = m.channel === 'sms' && slot === 'text' && MA.smsSegments(out).segments > MA.smsSegments(v).segments;
      if (moreParts || (lim && m.channel !== 'sms' && out.length > lim)) { report.kept_for_limit.push({ platform: m.channel, slot, text: v }); continue; }
      m[slot] = out;
    }
    MA.syncTemplate(m);
  }
  // The platform-ready copies of the same copy (services.platformAdObject).
  // An ad's `copy` there is the SAME object as the ad (2026-10-24 sweep): a
  // blind walk spelled "250g" in a Google headline the limit had kept, and
  // pushed it past 30. An ad goes through the limit-aware pass, the rest is read.
  const pr = campaign.platform_ready;
  if (pr && typeof pr === 'object') {
    for (const k of Object.keys(pr)) {
      const list = Array.isArray(pr[k]) ? pr[k] : [pr[k]];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        if (item.copy && typeof item.copy === 'object' && item.copy.platform) {
          finishAd(item.copy);
          for (const key of Object.keys(item)) if (key !== 'copy') item[key] = deep(item[key], key);
        } else deep(item);
      }
    }
  }
  campaign.unit_words = report;
  return report;
  function finishAd(ad) {
    if (!ad || typeof ad !== 'object') return;
    const contract = ac.contractFor(ad);
    const limitOf = (slot) => (contract ? ac.slotLimit(contract.id, slot) : null);
    const fit = (slot, v) => {
      const out = say(v, false);
      const lim = Number(limitOf(slot)) || 0;
      if (lim && out !== v && out.length > lim) { report.kept_for_limit.push({ platform: ad.platform, slot, text: v }); return v; }
      return out;
    };
    for (const slot of ['headline', 'primary_text', 'description', 'caption', 'cta', 'overlay', 'script', 'hook']) {
      if (typeof ad[slot] === 'string') ad[slot] = fit(slot === 'overlay' ? 'headline' : slot, ad[slot]);
    }
    if (Array.isArray(ad.headlines)) ad.headlines = ad.headlines.map((h) => fit('headlines', h));
    if (Array.isArray(ad.descriptions)) ad.descriptions = ad.descriptions.map((d) => fit('descriptions', d));
    if (ad.creative && typeof ad.creative === 'object' && typeof ad.creative.motion_html === 'string') ad.creative.motion_html = say(ad.creative.motion_html, true);
    // Every other line a viewer reads: the overlay, the video's on-screen words.
    deep(ad.overlay); if (ad.creative) deep(ad.creative.motion_brief);
    // The prompts a person copies into a model (no platform limit applies).
    if (Array.isArray(ad.prompts)) for (const pp of ad.prompts) if (pp && typeof pp.text === 'string') pp.text = say(pp.text, false);
    if (Array.isArray(ad.placements)) for (const pl of ad.placements) if (pl && typeof pl === 'object') {
      for (const k of Object.keys(pl)) if (typeof pl[k] === 'string' && !/url|safe|aspect|id$|^key$|^label$|^note$/i.test(k)) pl[k] = fit(k === 'on_screen' ? 'headline' : k, pl[k]);
    }
  }
  // A string a reader sees, anywhere in a node, but never a prompt, a URL or an id.
  function deep(node, key) {
    if (node == null) return node;
    if (typeof node === 'string') {
      if (/prompt|url|^id$|_id$|image|src|href|key|platform|type|aspect|format|path|slug|handle|sku|code|check|__/i.test(key || '')) return node;
      return say(node, /html$/i.test(key || ''));
    }
    if (Array.isArray(node)) { for (let i = 0; i < node.length; i += 1) node[i] = deep(node[i], key); return node; }
    if (typeof node === 'object') for (const k of Object.keys(node)) node[k] = deep(node[k], k);
    return node;
  }
}

// Copy for each placement an ad runs in (2026-10-17, the asset rating pass).
// A Meta ad was one primary text + one headline whatever it ran in, while
// Stories / Reels show neither: the viewer sees the frame, a short on-screen
// line and the CTA, inside safe zones asset-specs names. Each placement now
// carries what it shows: feeds the ad's own copy; Stories / Reels and TikTok's
// in-feed a short line CHOSEN (never cut) from lines the ad and the brand
// already have, within the headline limit, plus the safe zone; a carousel only
// when two or more products have their own photo (one card each). Nothing is
// written here that the copy or the record does not already say.
function attachPlacementCopy(campaign, entry) {
  try {
    const specs = require('./asset-specs.js').ADS;
    const ac = require('./asset-contracts.js');
    const b = (entry && entry.brand) || {};
    const lim = Number(ac.slotLimit('ad.meta.static', 'headline')) || 40;
    const sentences = (t) => String(t || '').match(/[^.!?]+[.!?]?/g) || [];
    const pick = (lines) => {
      const seen = new Set();
      for (const raw of lines) {
        const t = String(raw || '').replace(/\s+/g, ' ').trim().replace(/[.]$/, '');
        if (!t || /DATA REQUIRED/.test(t) || seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        if (t.length <= lim) return t;
      }
      return '';
    };
    const hp = entry && entry.heroProduct && !entry.heroProduct.placeholder ? entry.heroProduct : null;
    const cards = [hp].concat((entry && entry.supportingProducts) || []).filter((p) => p && p.title && (p.image || p.image_url))
      .map((p) => ({ headline: pick([p.title]), image: p.image || p.image_url, product: p.title }))
      .filter((c) => c.headline);
    for (const ad of (campaign.assets && campaign.assets.ads) || []) {
      const spec = specs[ad.platform];
      if (!spec || !Array.isArray(spec.placements)) continue;
      const overlay = pick([ad.headline, hp && hp.title, b.tagline, ...sentences(ad.primary_text), b.name]);
      const out = [];
      for (const pl of spec.placements) {
        const base = { key: pl.key, label: pl.note || pl.key, size: pl.size, ratio: pl.ratio };
        if (pl.safe) base.safe_zone = pl.safe;
        if (ad.platform === 'meta') {
          if (/^feed/.test(pl.key)) out.push(Object.assign(base, { primary_text: ad.primary_text || '', headline: ad.headline || '', description: ad.description || '', cta: ad.cta || '' }));
          else if (pl.key === 'story_reel') out.push(Object.assign(base, { on_screen: overlay, cta: ad.cta || '', note: 'Stories and Reels show the frame, this line and the button; keep the line inside the safe zone.' }));
          else if (pl.key === 'carousel' && ad.creative_type === 'static' && cards.length >= 2) out.push(Object.assign(base, { primary_text: ad.primary_text || '', cards: cards.slice(0, 10), cta: ad.cta || '' }));
        } else if (ad.platform === 'tiktok' && pl.key === 'in_feed') {
          out.push(Object.assign(base, { caption: ad.caption || '', on_screen: overlay, cta: ad.cta || '' }));
        }
      }
      if (out.length) ad.placements = out;
    }
  } catch (_) { /* placement copy is additive; never block a build */ }
}

// A market-data brand's mail and pages close with its regulatory disclaimer
// (asset-playbooks.withDisclaimer); every other business is left as built.
function attachDisclaimer(campaign, entry) {
  try {
    const ap = require('./asset-playbooks.js');
    const brand = require('./brand-runtime.js').scopedBrand(entry && entry.brand) || (entry && entry.brand) || {};
    const mk = entry && entry.market;
    if (!ap.disclaimerFor(brand, mk)) return;
    const a = (campaign && campaign.assets) || {};
    if (a.email) {
      if (a.email.html) a.email.html = ap.withDisclaimer(a.email.html, brand, mk);
      for (const v of a.email.variants || []) if (v && v.html) v.html = ap.withDisclaimer(v.html, brand, mk);
      if (a.email.text && !a.email.text.includes(ap.disclaimerFor(brand, mk))) a.email.text += `\n\n${ap.disclaimerFor(brand, mk)}`;
    }
    for (const lp of a.landing_pages || []) if (lp && lp.html) lp.html = ap.withDisclaimer(lp.html, brand, mk);
    campaign.disclaimer = ap.disclaimerFor(brand, mk);
  } catch (_) { /* never take a campaign down */ }
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
    // A catalogue excluded as another brand's is said on the campaign, with
    // the domain it came from, whether or not a photo slot was left empty.
    const excl = (entry && entry.catalog_excluded) || (scope && scope.catalog_excluded) || null;
    if (excl && excl.marker) {
      campaign.data_gaps = [...new Set((Array.isArray(campaign.data_gaps) ? campaign.data_gaps : []).concat([excl.marker, excl.sentence].filter(Boolean)))];
      campaign.catalog_excluded = { domain: excl.domain || '', marker: excl.marker, sentence: excl.sentence || '' };
    }
    const email = campaign.assets && campaign.assets.email;
    const hasImage = !!(email && ((email.creative && email.creative.image) || /<img\s/i.test(String(email.html || ''))));
    campaign.image_source = poolSource(entry);
    // A brand's own imagery or a generated scene is not a photo of the product:
    // the product-photo gap is still said.
    if (hasImage && campaign.image_source === 'catalog') return;
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

// One build per slot at a time (2026-10-17). Production: two requests for the
// same slot 8 s apart each spent ~72 s of model calls building the same bundle.
// A request that arrives while that slot is building waits for the same answer.
const PREVIEW_INFLIGHT = new Map();
function previewEntry(args = {}) {
  const e = args.entry || {};
  const cfg = args.config || {};
  const key = [cfg.workspace_id || cfg.workspaceId || '', args.id || e.id || '', e.__prebuilt ? 'p' : 'n'].join('|');
  if (!args.id && !e.id) return _previewEntry(args);
  const running = PREVIEW_INFLIGHT.get(key);
  if (running) return running;
  const p = _previewEntry(args).finally(() => { if (PREVIEW_INFLIGHT.get(key) === p) PREVIEW_INFLIGHT.delete(key); });
  PREVIEW_INFLIGHT.set(key, p);
  return p;
}
async function _previewEntry({ id, reviewer = null, config: cfg = {}, entry: inlineEntry = null } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const { entry, row } = await resolveEntry({ id, inlineEntry, config, db });
  if (!entry) throw new Error(`Calendar entry ${id || ''} not found — run a daily sync first or pass the entry inline.`);
  const ident = await currentIdentity(config, db);

  // A slot planned from a catalogue now judged another brand's (2026-10-10):
  // nothing saved for it is replayed - not a prebuilt bundle, not a final
  // campaign - because each names that brand's product. It is built again with
  // the catalogue marker in the hero, shown, and not stored over the old one.
  const foreign = await staleForeignSlot(entry, config);
  if (foreign) {
    const fc = await buildCampaign(effectiveEntry(entry), config, { id, withCreatives: false });
    fc.status = 'preview';
    fc.calendar_entry_id = entry.id || id || null;
    return {
      ok: true, preview: true, persisted: false, stale: true,
      catalog_excluded: { domain: foreign.domain, marker: foreign.marker, sentence: foreign.sentence },
      note: `${foreign.sentence} This slot was planned from that catalogue; run Daily Sync to re-plan it.`.trim(),
      campaign: fc, copywriter: fc.copywriter,
      email_html: fc.assets?.email?.html || null,
      email_variants: fc.assets?.email?.variants || null,
      landing_html: fc.assets?.landing_pages?.[0]?.html || null,
      ads: fc.assets?.ads || [],
    };
  }

  // Checked after the catalogue rule, whose answer names the excluded domain.
  await adoptCurrentSlot(entry, row, ident, db, config);
  if (slotForOtherRecord(entry, row, ident)) throw brandChangedError('slot');

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
    if (c && !identityMatches(c.brand_identity, ident)) throw brandChangedError('campaign');
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
  // A saved bundle made for another version of the record is never replayed
  // (2026-10-11): the sneaker hero under DelhiChic was a prebuilt campaign.
  if (campaign && !identityMatches(campaign.brand_identity, ident)) campaign = null;
  if (campaign && !currentBuild(campaign)) campaign = null;   // built by an earlier renderer
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

// ── Individual Asset Generation ─────────────────────────────────────────────
// Enables regenerating an isolated asset (mailer, landing page, ads, brief)
// directly for a slot without having to regenerate the entire bundle.
async function generateSingleAsset({ id, entry: inlineEntry = null, assetType = 'all', reviewer = null, config: cfg = {} } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const { entry, row } = await resolveEntry({ id, inlineEntry, config, db });
  if (!entry) throw new Error(`Calendar entry ${id || ''} not found.`);
  await stampBrand(entry, config);
  scrubForeignProducts(entry);

  const prev = await _previewEntry({ id, entry, reviewer, config: cfg });
  const campaign = prev.campaign || {};
  campaign.assets = campaign.assets || {};

  const normType = String(assetType || '').toLowerCase();

  if (normType === 'mailer' || normType === 'email') {
    const CF = require('./copy-frameworks.js');
    const fwA = CF.pickCopyFramework({ play_key: entry.objective || '', cohort_key: (entry.cohort && (entry.cohort.key || entry.cohort.name)) || '', seed: `${entry.id || entry.date || ''}_${Date.now()}` });
    const otherKeys = Object.keys(CF.COPY_FRAMEWORKS).filter((k) => k !== fwA.key);
    const fwB = CF.frameworkByKey(otherKeys[CF.stableIndex(`${entry.id || entry.date || ''}|b_${Date.now()}`, otherKeys.length)]) || fwA;
    try {
      const [pA, pB] = await Promise.allSettled([writeCopyWithLLM(entry, fwA, null), writeCopyWithLLM(entry, fwB, null)]);
      const rawA = pA.status === 'fulfilled' ? pA.value : null;
      const rawB = pB.status === 'fulfilled' ? pB.value : null;
      if (rawA && rawA.copy) {
        const copyA = gateProof(scrubCopyDeep(rawA.copy, entry), entry);
        const copyB = rawB && rawB.copy ? gateProof(scrubCopyDeep(rawB.copy, entry), entry) : copyA;
        applyCopy(campaign, entry, copyA, copyB, fwA, fwB, {}, _runId(entry));
      } else {
        throw new Error('LLM unavailable for single mailer generation');
      }
    } catch (_) {
      const tc = require('../../lib/smart-brain/services.js').templateEmailCopy(entry, campaign.assets?.email);
      const pool = slotImagePool(entry, 1200);
      campaign.assets.email = campaign.assets.email || {};
      campaign.assets.email.variants = emailVariants(entry, tc.A, tc.B, { key: 'product', name: 'Product-led' }, { key: 'brand', name: 'Brand-led' }, pool[0] || null);
    }
  } else if (normType === 'landing' || normType === 'landing_page') {
    // The same builder as the full build (2026-10-23): it called a function
    // services.js does not export, so "Regenerate landing" always failed.
    const fresh = await buildCampaign(Object.assign({}, entry), config, { withCreatives: 'hero' });
    if (fresh && fresh.assets && Array.isArray(fresh.assets.landing_pages) && fresh.assets.landing_pages.length) {
      campaign.assets.landing_pages = fresh.assets.landing_pages;
    }
  } else if (normType === 'ads' || normType === 'ad') {
    // New copy AND creatives, from the same builder as the full build: this
    // only re-attached pictures, so "Regenerate ads" changed no words.
    const fresh = await buildCampaign(Object.assign({}, entry), config, { withCreatives: 'lean' });
    if (fresh && fresh.assets && Array.isArray(fresh.assets.ads) && fresh.assets.ads.length) {
      campaign.assets.ads = fresh.assets.ads;
      if (fresh.platform_ready) campaign.platform_ready = fresh.platform_ready;
    }
  }

  // A regenerated asset gets the full build's finishing passes: the real
  // landing address, units in words, and fresh contract checks.
  try { fillLandingUrl(campaign, entry); } catch (_) { /* keep the asset */ }
  try { attachUnitWords(campaign, entry); } catch (_) { /* keep the asset */ }
  try { campaign.contract_check = undefined; checkAssetContracts(campaign, entry); } catch (_) { /* keep the asset */ }
  if (db.connected && row && campaign) {
    try {
      await persistCampaignAssets(db, config, campaign, { status: 'preview', origin: 'smart-brain-generate-asset', reviewer, mirror: false });
    } catch (_) {}
  }

  return {
    ok: true,
    asset_type: normType,
    campaign,
    copywriter: campaign.copywriter,
    email_html: campaign.assets?.email?.html || null,
    email_variants: campaign.assets?.email?.variants || null,
    landing_html: campaign.assets?.landing_pages?.[0]?.html || null,
    ads: campaign.assets?.ads || [],
  };
}

// ── Approve / reject ────────────────────────────────────────────────────────

async function approveEntry({ id, reviewer = null, config: cfg = {}, entry: inlineEntry = null } = {}) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const { entry, row } = await resolveEntry({ id, inlineEntry, config, db });
  if (!entry) throw new Error(`Calendar entry ${id || ''} not found — run a daily sync first or pass the entry inline.`);
  const ident = await currentIdentity(config, db);

  // Approving publishes; a slot that names another brand's product is not
  // published, built over, or re-approved (2026-10-10). Re-plan it first.
  const foreign = await staleForeignSlot(entry, config);
  if (foreign) {
    const e = new Error(`${foreign.sentence} This slot was planned from that catalogue, so it is not approved. Run Daily Sync to re-plan it from this brand's own record.`.trim());
    e.status = 409; e.code = 'catalogue_excluded';
    throw e;
  }

  await adoptCurrentSlot(entry, row, ident, db, config);
  if (slotForOtherRecord(entry, row, ident)) throw brandChangedError('slot');

  // IDEMPOTENCY: a slot already approved with a generated campaign must NOT be
  // regenerated — that would orphan the prior campaign + its ads/LP rows. Return
  // the existing campaign instead.
  if (db.connected && row && (row.status === 'approved' || row.status === 'final') && row.generated_campaign_id) {
    const prior = await db.select(config.tableNames.generatedCampaigns, { filters: { id: `eq.${row.generated_campaign_id}` }, limit: 1 }).catch(() => []);
    const existing = prior && prior[0] && prior[0].payload;
    if (existing && !identityMatches(existing.brand_identity, ident)) throw brandChangedError('campaign');
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
  if (campaign && !identityMatches(campaign.brand_identity, ident)) campaign = null;
  if (campaign && !currentBuild(campaign)) campaign = null;   // built by an earlier renderer
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
    rows = await selectAllRows(db, config.tableNames.calendarEntries, { filters: { date: `gte.${todayIso()}`, status: 'neq.archived' }, order: 'date.asc,id.asc' });
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
//
// The id is the capability, and it is looked up ACROSS workspaces (the guarded
// point lookup in SmartBrainDbAdapter.select): a /lp link is minted without a
// workspace, and scoping this read to the adapter's default workspace meant
// another tenant's persisted page was never found. The row that answers names
// its owner, and that is reported as `diag.workspace_id` so the caller can
// render the fallback for the RIGHT brand. When no campaign row exists yet, the
// calendar slot that advertises the id (generated_campaign_id) names it too.
async function landingPageResolve(id, cfg = {}, variant = null) {
  const config = smartConfig(cfg);
  const db = new SmartBrainDbAdapter(config);
  const diag = { id, dbConnected: !!db.connected, campaignFound: false, hasLpHtml: false, fallbackFound: false, calendarEntryFound: false, source: null, workspace_id: null, workspace_source: null };
  if (!db.connected) return { html: null, diag };
  const owned = (row, source) => { if (row && row.workspace_id && !diag.workspace_id) { diag.workspace_id = String(row.workspace_id); diag.workspace_source = source; } };
  const one = (table, filters) => db.select(table, { filters, limit: 1, anyWorkspace: true }).catch(() => []);
  // 1) generated campaign by row id, then 2) by payload.campaign_id.
  let camp = await one(config.tableNames.generatedCampaigns, { id: `eq.${id}` });
  if (camp && camp[0]) diag.source = 'generated_campaigns.id';
  else {
    camp = await one(config.tableNames.generatedCampaigns, { 'payload->>campaign_id': `eq.${id}` });
    if (camp && camp[0]) diag.source = 'generated_campaigns.campaign_id';
  }
  // A page made for ANOTHER version of the owner's brand record (renamed,
  // re-pointed at a new website, another sender, catalogue, palette...) is
  // not served as that brand's page (2026-10-11): the route answers with the
  // sentence instead, and the stored page is kept.
  const stale = async (stamp, madeFor) => {
    if (!diag.workspace_id) return false;
    const now = await currentBrandInfo({ ...config, workspace_id: diag.workspace_id }, db);
    if (!now.ident || require('./brand-identity.js').identityMatches(stamp, now.ident)) return false;
    diag.brand_changed = true;
    diag.message = require('./brand-identity.js').staleSentence('landing page', madeFor || '', now.name || '');
    return true;
  };
  if (camp && camp[0]) {
    diag.campaignFound = true;
    owned(camp[0], 'generated_campaigns');
    const lps = camp[0]?.payload?.assets?.landing_pages || [];
    // ?v=b serves the story-led B variant; default serves A (first LP). If B is
    // requested but only one LP was built, fall back rather than 404 a valid page.
    const want = /^b$/i.test(String(variant || '')) ? (lps.find((l) => l.variant === 'B') || lps[1] || lps[0]) : (lps.find((l) => l.variant === 'A') || lps[0]);
    if (want?.html && await stale(camp[0]?.payload?.brand_identity, camp[0]?.payload?.brand_name)) return { html: null, diag };
    if (want?.html) { diag.hasLpHtml = true; return { html: want.html, diag }; }
  }
  // 3) landing_pages_generated mirror (numeric id or campaign_id in payload).
  const filters = /^\d+$/.test(String(id)) ? { id: `eq.${id}` } : { 'payload->>campaign_id': `eq.${id}` };
  const lp = await one(config.tableNames.landingPagesGenerated, filters);
  if (lp?.[0]) owned(lp[0], 'landing_pages_generated');
  if (lp?.[0]?.payload?.html && await stale(lp[0]?.payload?.brand_identity, lp[0]?.payload?.brand_name)) return { html: null, diag };
  if (lp?.[0]?.payload?.html) { diag.fallbackFound = true; diag.source = 'landing_pages_generated'; return { html: lp[0].payload.html, diag }; }
  // 4) no page anywhere: the calendar slot that advertises this id still says
  //    whose campaign it is, so the fallback can be built for that brand.
  if (!diag.workspace_id) {
    const slot = await one(config.tableNames.calendarEntries, { generated_campaign_id: `eq.${id}` });
    if (slot?.[0]) { diag.calendarEntryFound = true; owned(slot[0], 'calendar_entries'); }
  }
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
// THE RENDERER THAT BUILT A SAVED BUNDLE (2026-10-17). Saved mailers, pages and
// ads were replayed forever, so production kept showing assets built by the
// renderers of weeks ago (the operator's screenshot: a tagline in spaced blue
// capitals under the wordmark, "The Transformation", a button only at the
// end) after every one of those was fixed. A bundle built by an earlier
// renderer is not reused: viewing rebuilds it, and the prebuild queue rebuilds
// it. A hand-kept version was never bumped (the Parwah mailer of 2026-10-17
// still showed invented benefits and a #0000EE divider a day after both were
// fixed), so the version is now the content of the code that renders and
// grounds the assets: change any of it and every saved bundle is rebuilt.
const ASSET_BUILD_VERSION = (() => {
  const files = [__filename, './calendar-trigger.js', './mailer-format.js', './copy-grounding.js', './brand-runtime.js', '../../lib/smart-brain/services.js', './marketing-team.js', './marketing-team-server.js', './unit-words.js', './asset-style.js', '../../scripts/lib/story-ad.js', '../../scripts/lib/motion-ad.js', './brand-music.js'];
  const h = require('crypto').createHash('sha256');
  for (const f of files) {
    try { h.update(require('fs').readFileSync(f === __filename ? f : require.resolve(f))); } catch (_) { h.update(f); }
  }
  return 'src.' + h.digest('hex').slice(0, 16);
})();
function currentBuild(campaign) { return !!(campaign && campaign.build_version === ASSET_BUILD_VERSION); }
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
  // A slot prebuilt by an earlier renderer is queued again.
  return !!(p && p.campaign_id && p.build_version === ASSET_BUILD_VERSION);
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
      // WHICH brand version this mirror row was made for (brand-identity.js):
      // /assets lists it only under that version (2026-10-11).
      reasoning: { brand_identity: campaign.brand_identity || null },
    }]).catch(() => null);   // never let a mailer-mirror failure block ads/LP/approval
  }
  const adRows = (campaign.assets.ads || []).map((ad) => ({
    channel: ad.platform, name: campaign.name, market: campaign.market, objective: campaign.objective,
    audience: campaign.audience?.name, copy: { ...ad, brand_identity: campaign.brand_identity || null }, creative_prompt: ad.creative_brief || ad.script || '', origin,
    user_email: reviewer || null,
  }));
  if (adRows.length) out.ads = await db.insert(config.tableNames.adsGenerated, adRows);
  const lp = campaign.assets.landing_pages?.[0];
  if (lp) out.landing = await db.insert(config.tableNames.landingPagesGenerated, [{
    paired_with: campaign.assets.email ? 'mailer' : (campaign.assets.ads?.[0]?.platform || 'meta'),
    name: lp.title || campaign.name, market: campaign.market,
    hero: lp.title || '', payload: { campaign_id: campaign.campaign_id, brand_identity: campaign.brand_identity || null, brand_name: campaign.brand_name || null, path: lp.path, html: lp.html, sections: lp.sections, master_prompt: lp.master_prompt },
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
  const rows = await selectAllRows(db, config.tableNames.calendarEntries, {
    filters: { date: `gte.${start}`, status: SYNC_WRITABLE_STATUSES },
    order: 'date.asc,id.asc',
  });
  const prebuildIdent = await currentIdentity(config, db);
  // A slot its own cap pass calls BLOCKED is never built (an older stored row
  // may still carry that status).
  const blocked = (r) => { const p = r.payload || {}; const fc = (p.reach && p.reach.frequency_cap) || {}; return fc.status === 'BLOCKED'; };
  const pending = rows.filter((r) => !isPrebuilt(r) && !blocked(r) && !!prebuildIdent && identityMatches((r.payload || {})[IDENTITY_KEY], prebuildIdent));
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
        payload[PREBUILD_MARKER] = { campaign_id: campaign.campaign_id, at: nowIso(), images: creativeCount(campaign), copy: campaign.copywriter?.provider || null, build_version: ASSET_BUILD_VERSION };
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
  attachUnitWords,
  // exported for tests/mailer-justified.spec.js: a saved bundle from other
  // renderer code is never replayed.
  ASSET_BUILD_VERSION, __test_currentBuild: currentBuild,
  // exported for scripts/test-brand-isolation.js only
  __test_emailHtml: emailHtml,
  // exported for tests/brand-data-scope.spec.js: the slot-id namespace is the
  // thing that stops two brands sharing a primary key, so it is asserted on
  // directly rather than inferred from a full sync.
  __test_offeringPlanEntries: offeringPlanEntries,
  __test_strategyPlanEntries: strategyPlanEntries,
  __test_withStrategyFallback: withStrategyFallback,
  __test_workspaceNs: workspaceNs,
  // Executed by tests/agents-review.spec.js inside a request scope: which
  // brand a slot is stamped with, and whether the plan is tenant zero's.
  __test_stampBrand: stampBrand,
  __test_brandIdentity: brandIdentity,
  currentBrandInfo,
  __test_slotForOtherRecord: slotForOtherRecord,
  // tests/review-leak-fixes.spec.js: which preset offerings a brand may take.
  __test_resolveBrandOfferings: _resolveBrandOfferings,
  // Executed by tests/catalog-provenance.spec.js: whose store a slot links to.
  __test_slotLinks: slotLinks,
  __test_productUrl: productUrl,
  __test_planningBrand: planningBrand,
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
  lpHtml,
  __test_generateCreatives: generateCreatives,
  __test_applyCopy: applyCopy,
  __test_attachMotionCreative: attachMotionCreative,
  // The contract check the builder runs on its own output, so a renderer that
  // lives outside this module (the html pipeline stage) can be judged by the
  // SAME summary shape rather than by a second walk that could drift from it.
  checkAssetContracts,
  syncDaily, getPlan, previewEntry, generateSingleAsset, approveEntry, rejectEntry, unrejectEntry, activateScenario, landingPageHtml, landingPageResolve, buildCampaign,
  // calendar.js stamps an inline entry before GenerationService builds it.
  stampBrand,
  prebuildAssets, healOrphans, dbCheck, syncStatus,
  // exported for unit testing (pure scenario helpers)
  attachScenarioLayer, promoteScenario, effectiveEntry, buildStandbyVariant,
};
