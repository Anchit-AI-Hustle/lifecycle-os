'use strict';
/**
 * credit-catalog.js — what every feature in the platform costs, in one place.
 * ---------------------------------------------------------------------------
 * This is the VERSIONED source of truth for credit pricing. The server charges
 * from it, the UI labels every button from it, and the wallet page groups usage
 * by it — so a feature can never cost something the user was not shown.
 *
 * A price may be overridden without a deploy via the `credit_prices` table
 * (see supabase/migrations/20260809130000_credits.sql); a missing row means
 * "use the price declared here".
 *
 * Each entry:
 *   key        stable id, also the ledger's feature_key — never renamed
 *   label      what the user sees
 *   group      section it belongs to in the UI
 *   cost       credits per unit
 *   unit       what one unit IS ('per mailer', 'per minute of audio', ...)
 *   metered    true  -> final charge = cost x actual units, settled after the
 *                       run (a reservation is taken up-front from `estimate`)
 *              false -> flat charge
 *   estimate   units reserved up-front for a metered feature
 *   why        one line on what consumes the credits (shown in the cost popover)
 *
 * Cost scale: 1 credit is roughly one small model call. Nothing here is a
 * fabricated market price — it is the platform's own internal unit.
 * ---------------------------------------------------------------------------
 */

const FEATURES = [
  /* ── Free: looking at things never costs credits ─────────────────────── */
  { key: 'app.browse',            label: 'Browse the app',              group: 'Included', cost: 0, unit: 'always free', why: 'Navigation, dashboards and reading saved work are free.' },
  { key: 'brand.onboard',         label: 'Brand onboarding',            group: 'Included', cost: 0, unit: 'always free', why: 'Setting up a brand, its colour schema and typography is free.' },
  { key: 'brand.catalog_import',  label: 'Catalog import',              group: 'Included', cost: 0, unit: 'always free', why: 'Importing your own product data is free; only generation costs credits.' },
  { key: 'dashboard.view',        label: 'Dashboards and reports',      group: 'Included', cost: 0, unit: 'always free', why: 'Viewing analytics already computed is free.' },

  /* ── Analytics & planning ────────────────────────────────────────────── */
  { key: 'analytics.run',         label: 'Run data analysis',           group: 'Analytics', cost: 8,  unit: 'per run',       why: 'Cohort/RFM computation plus an LLM narrative over the result.' },
  { key: 'analytics.narrative',   label: 'Analysis narrative',          group: 'Analytics', cost: 5,  unit: 'per narrative', why: 'One long-form model call over your metrics.' },
  { key: 'analytics.report',      label: 'Performance report',          group: 'Analytics', cost: 12, unit: 'per report',    why: 'Multi-section report: pulls metrics, then writes each section.' },

  { key: 'calendar.generate',     label: 'Generate marketing calendar', group: 'Planning', cost: 25, unit: 'per 30-day plan', why: 'Plans every slot in the window with cohort reasoning.' },
  { key: 'calendar.scenario',     label: 'Calendar scenario',           group: 'Planning', cost: 10, unit: 'per scenario',    why: 'Re-plans the window under a different frequency model.' },
  { key: 'campaign.plan',         label: 'Campaign plan',               group: 'Planning', cost: 15, unit: 'per campaign',    why: 'Strategy, cohort targeting, offer and measurement plan.' },
  { key: 'brain.slot_prebuild',   label: 'Prebuild campaign assets',    group: 'Planning', cost: 40, unit: 'per slot',        why: 'Builds the full bundle for one slot: mailer, ads and landing page.' },

  /* ── Creation ────────────────────────────────────────────────────────── */
  { key: 'mailer.brief',          label: 'Mailer brief',                group: 'Creation', cost: 3,  unit: 'per brief',     why: 'One model call to turn your inputs into a creative brief.' },
  { key: 'mailer.concepts',       label: 'Mailer concepts',             group: 'Creation', cost: 5,  unit: 'per concept set', why: 'Generates the competing concept directions.' },
  { key: 'mailer.generate',       label: 'Generate mailer',             group: 'Creation', cost: 20, unit: 'per mailer',    why: 'Strategy, copy, layout and final HTML for one mailer.' },
  { key: 'mailer.variant',        label: 'Extra mailer variant',        group: 'Creation', cost: 12, unit: 'per variant',   why: 'A structurally different variant of the same brief.' },
  { key: 'mailer.score',          label: 'Score a mailer',              group: 'Creation', cost: 4,  unit: 'per score',     why: 'Runs the quality rubric over the built mailer.' },

  { key: 'ads.generate',          label: 'Generate ad set',             group: 'Creation', cost: 18, unit: 'per ad set',    why: 'Meta, Google and TikTok copy from one brief.' },
  { key: 'ads.copy_matrix',       label: 'Ad copy matrix',              group: 'Creation', cost: 14, unit: 'per matrix',    why: '20 variations across angles and awareness levels.' },
  { key: 'landing.generate',      label: 'Generate landing page',       group: 'Creation', cost: 22, unit: 'per page',      why: 'Full brand-compliant page built from your catalog.' },
  { key: 'social.post',           label: 'Social post',                 group: 'Creation', cost: 6,  unit: 'per post',      why: 'Copy plus hooks and hashtags for one platform.' },
  { key: 'social.daily_run',      label: 'Social daily run',            group: 'Creation', cost: 30, unit: 'per day',       why: 'The 7-agent daily pipeline across every platform.' },
  { key: 'email.sequence',        label: 'Email sequence',              group: 'Creation', cost: 16, unit: 'per sequence',  why: 'A full nurture flow with timing and exit rules.' },
  { key: 'content.repurpose',     label: 'Repurpose content',           group: 'Creation', cost: 6,  unit: 'per source post', why: 'Turns one post into a thread, an email and hooks.' },
  { key: 'creative.brief',        label: 'Creative brief',              group: 'Creation', cost: 5,  unit: 'per brief',     why: 'A designer-ready brief from one angle.' },

  { key: 'image.generate',        label: 'Generate image',              group: 'Media', cost: 25,  unit: 'per image',   why: 'One image through the generation cascade.' },
  { key: 'image.reels',           label: 'Reels-grade still',           group: 'Media', cost: 35,  unit: 'per image',   why: 'Cinematic 9:16 still built with depth layers for animation.' },
  { key: 'video.generate',        label: 'Generate video',              group: 'Media', cost: 200, unit: 'per clip',     why: 'Image-to-video through the video model cascade — the most expensive call in the app.' },
  { key: 'audio.tts',             label: 'Text to speech',              group: 'Media', cost: 2,   unit: 'per 1,000 characters', metered: true, estimate: 1, why: 'Charged on the characters actually synthesised.' },

  /* ── Intelligence ────────────────────────────────────────────────────── */
  { key: 'competitor.sync',       label: 'Sync competitor intel',       group: 'Intelligence', cost: 10, unit: 'per sync',      why: 'Pulls, dedupes and classifies newly captured competitor emails.' },
  { key: 'competitor.teardown',   label: 'Competitor teardown',         group: 'Intelligence', cost: 12, unit: 'per teardown',  why: 'Reads a rival page or ad and extracts angles to beat it.' },
  { key: 'kb.ingest',             label: 'Knowledge base ingest',       group: 'Intelligence', cost: 3,  unit: 'per document',  why: 'Parses, classifies and indexes one document.' },
  { key: 'kb.search',             label: 'Knowledge base search',       group: 'Intelligence', cost: 1,  unit: 'per query',     why: 'One retrieval pass over your indexed library.' },
  { key: 'seo.audit',             label: 'SEO / AEO audit',             group: 'Intelligence', cost: 14, unit: 'per page',      why: 'Crawls the page and scores it against the audit rubric.' },
  { key: 'assistant.chat',        label: 'Brand assistant message',     group: 'Intelligence', cost: 2,  unit: 'per message',   metered: true, estimate: 1, why: 'One reply; a reply that calls tools charges per tool step.' },
  { key: 'assistant.tool_step',   label: 'Assistant tool step',         group: 'Intelligence', cost: 2,  unit: 'per tool call', why: 'Each tool the assistant runs on your behalf.' },

  /* ── TeleSuite ───────────────────────────────────────────────────────── */
  { key: 'telesuite.product_description', label: 'Product description',      group: 'TeleSuite', cost: 3,  unit: 'per product',   why: 'Writes one product description from your catalog entry.' },
  { key: 'telesuite.kb_ingest',           label: 'TeleSuite KB entry',       group: 'TeleSuite', cost: 2,  unit: 'per entry',     why: 'Summarises and categorises one knowledge base entry.' },
  { key: 'telesuite.pitch',               label: 'AI pitch generator',       group: 'TeleSuite', cost: 6,  unit: 'per pitch',     why: 'Builds a structured sales pitch grounded in your KB.' },
  { key: 'telesuite.rebuttal',            label: 'AI rebuttal assistant',    group: 'TeleSuite', cost: 4,  unit: 'per objection', why: 'Acknowledge / Bridge / Benefit / Clarify response to one objection.' },
  { key: 'telesuite.transcription',       label: 'Audio transcription',      group: 'TeleSuite', cost: 4,  unit: 'per minute of audio', metered: true, estimate: 5, why: 'Charged on the audio duration actually transcribed.' },
  { key: 'telesuite.call_scoring',        label: 'AI call scoring',          group: 'TeleSuite', cost: 30, unit: 'per call',      why: 'Scores one transcript against the full rubric.' },
  { key: 'telesuite.combined_analysis',   label: 'Combined call analysis',   group: 'TeleSuite', cost: 25, unit: 'per batch',     why: 'Synthesises trends across a batch of scored calls.' },
  { key: 'telesuite.optimized_pitches',   label: 'Optimised pitches',        group: 'TeleSuite', cost: 12, unit: 'per set',       why: 'Data-driven scripts written from a combined analysis.' },
  { key: 'telesuite.voice_sales',         label: 'AI voice sales agent',     group: 'TeleSuite', cost: 12, unit: 'per minute of call', metered: true, estimate: 3, why: 'Charged per minute of live conversation (ASR, reasoning and TTS).' },
  { key: 'telesuite.voice_support',       label: 'AI voice support agent',   group: 'TeleSuite', cost: 12, unit: 'per minute of call', metered: true, estimate: 3, why: 'Charged per minute of live conversation (ASR, reasoning and TTS).' },
  { key: 'telesuite.training_deck',       label: 'Training material creator', group: 'TeleSuite', cost: 15, unit: 'per deck',     why: 'Generates the full structured training document.' },
  { key: 'telesuite.data_analysis',       label: 'AI data analyst',          group: 'TeleSuite', cost: 10, unit: 'per analysis',  why: 'One analyst pass over the data description you supply.' },
  { key: 'telesuite.batch_audio',         label: 'Batch audio downloader',   group: 'TeleSuite', cost: 0,  unit: 'always free',   why: 'Runs entirely in your browser; no model calls.' },
  { key: 'telesuite.activity_log',        label: 'Global activity log',      group: 'TeleSuite', cost: 0,  unit: 'always free',   why: 'Reading your own run history is free.' },
  { key: 'telesuite.clone_app',           label: 'Clone full app',           group: 'TeleSuite', cost: 0,  unit: 'always free',   why: 'Packaging source and docs costs no model calls.' },
  { key: 'telesuite.n8n_workflow',        label: 'n8n workflow export',      group: 'TeleSuite', cost: 0,  unit: 'always free',   why: 'Generates a JSON workflow file locally.' },
];

const BY_KEY = Object.create(null);
for (const f of FEATURES) {
  BY_KEY[f.key] = Object.assign({ metered: false, estimate: 1, group: 'Other' }, f);
}

/** Signup / trial grant. An operator can change it with CREDIT_WELCOME_GRANT. */
function welcomeGrant() {
  const n = parseInt(process.env.CREDIT_WELCOME_GRANT || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 500;
}

/** Recharge packs. Amounts are the platform's own credit bundles. */
const PACKS = [
  { key: 'starter',  label: 'Starter',  credits: 500,    bonus: 0,    blurb: 'Enough to plan a month and build a few mailers.' },
  { key: 'growth',   label: 'Growth',   credits: 2500,   bonus: 250,  blurb: 'A full campaign cycle with creative and ads.' },
  { key: 'scale',    label: 'Scale',    credits: 10000,  bonus: 1500, blurb: 'Multi-brand, multi-region, video included.' },
  { key: 'agency',   label: 'Agency',   credits: 50000,  bonus: 10000, blurb: 'Team-wide usage across every brand workspace.' },
];

function pack(key) { return PACKS.find((p) => p.key === String(key || '').toLowerCase()) || null; }

function get(key) { return BY_KEY[key] || null; }

function list() { return FEATURES.map((f) => Object.assign({}, BY_KEY[f.key])); }

/** Catalog grouped for the pricing UI. */
function grouped() {
  const out = {};
  for (const f of list()) { (out[f.group] = out[f.group] || []).push(f); }
  return out;
}

/**
 * Cost of one run. `units` only matters for metered features.
 * Returns { key, label, unit, cost, units, total, metered, unknown }.
 * An unknown feature key costs 0 and is flagged — a typo must never silently
 * charge the user, and it must never silently run for free unnoticed either.
 */
function quote(key, units, overrides) {
  const f = get(key);
  if (!f) return { key: String(key || ''), label: String(key || ''), unit: '', cost: 0, units: 0, total: 0, metered: false, unknown: true };
  const override = overrides && overrides[key];
  const cost = override && Number.isFinite(+override.cost) ? +override.cost : f.cost;
  const unit = (override && override.unit_label) || f.unit;
  // An EXPLICIT zero means the caller knows this run does no billable work
  // (e.g. a transcript pasted by hand rather than transcribed) — it must quote
  // as free, not fall back to the reservation estimate. Only undefined/null
  // means "we do not know yet, reserve the estimate".
  const asked = Number(units);
  const n = !f.metered ? 1
    : (units != null && Number.isFinite(asked) && asked <= 0) ? 0
    : Math.max(1, Math.ceil(asked > 0 ? asked : f.estimate));
  return { key: f.key, label: f.label, group: f.group, unit, why: f.why, cost, units: n, total: cost * n, metered: !!f.metered, estimate: f.estimate };
}

module.exports = { FEATURES, PACKS, get, list, grouped, quote, pack, welcomeGrant };
