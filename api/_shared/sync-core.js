'use strict';
/**
 * sync-core.js — the shared-source-of-truth + continuous-synchronization engine
 * (governing spec §24b; design in docs/shared-source-of-truth.md).
 * ---------------------------------------------------------------------------
 * The rule this enforces: every feature is a synchronized VIEW over ONE
 * canonical record set. A feature output (a generated mailer / ad / landing
 * page) may keep a versioned SNAPSHOT for audit, but it must reference the
 * canonical source version and be able to say whether it is CURRENT or STALE.
 *
 * This module is under api/_shared/ so it is NOT counted against the Hobby
 * 12-function limit. It is provider-agnostic and stateless: persistence is
 * OPTIONAL — pass a connected db adapter (lib/smart-brain/services.js
 * SmartBrainDbAdapter) and it writes sync_state + sync_audit_log; with no db it
 * degrades to an in-memory store so the pure logic still runs (and unit tests
 * need no network). Propagation is synchronous within the request that made the
 * canonical change, plus a reconcile pass (the daily sync) that catches the
 * rest — the correct model for a serverless deployment with no always-on queue.
 * ---------------------------------------------------------------------------
 */

// Freshness statuses (exact strings from the contract).
const STATUS = {
  CURRENT: 'CURRENT',
  SYNCING: 'SYNCING',
  STALE: 'STALE — REGENERATION REQUIRED',
  BLOCKED_CONFLICT: 'BLOCKED — SOURCE CONFLICT',
  BLOCKED_UNAVAILABLE: 'BLOCKED — SOURCE UNAVAILABLE',
  VALIDATION_REQUIRED: 'VALIDATION REQUIRED',
  SYNC_FAILED: 'SYNC FAILED',
};

// The canonical record kinds each generated asset depends on. A change to any of
// these for a referenced product/region/cohort makes dependent assets stale.
const LAUNCH_CRITICAL = ['product', 'region', 'price', 'offer', 'inventory', 'claim', 'review', 'rating', 'image', 'url', 'audience'];

// Which asset kinds are affected by a change to each canonical record kind.
const DEPENDENTS = {
  product: ['mailer', 'ad', 'landing_page', 'social', 'blog', 'forecast'],
  price: ['mailer', 'ad', 'landing_page', 'social', 'forecast'],
  inventory: ['mailer', 'ad', 'landing_page', 'social'],
  offer: ['mailer', 'ad', 'landing_page', 'social', 'forecast'],
  claim: ['mailer', 'ad', 'landing_page', 'social', 'blog'],
  review: ['mailer', 'ad', 'landing_page', 'social'],
  rating: ['mailer', 'ad', 'landing_page', 'social'],
  image: ['mailer', 'ad', 'landing_page', 'social'],
  audience: ['forecast', 'mailer'],
  campaign: ['mailer', 'ad', 'landing_page', 'social', 'blog', 'forecast'],
};

function nowIso() { try { return new Date().toISOString(); } catch (_) { return ''; } }

// Small deterministic hash (djb2 → base36). No crypto; stable across runs so two
// identical inputs always produce the same version string.
function stableHash(input) {
  const s = typeof input === 'string' ? input : JSON.stringify(input == null ? '' : input);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Version of a canonical record: prefer an explicit numeric/string `version`,
// else `updated_at`, else a stable hash of the whole record.
function versionOf(record) {
  if (record == null) return null;
  if (record.version != null) return String(record.version);
  if (record.updated_at != null) return String(record.updated_at);
  return stableHash(record);
}

// Compute the source-version map for the inputs an asset was built from. Pass
// whatever canonical snapshots you have (missing ones are simply absent, which
// preLaunchGate reports as BLOCKED — SOURCE UNAVAILABLE, never fabricated).
//   sources = { product, price, offer, inventory, claim, review, rating, image, audience, campaign }
function sourceVersions(sources) {
  const out = {};
  for (const k of Object.keys(sources || {})) {
    const v = sources[k];
    if (v === undefined) continue;
    out[k] = v === null ? null : versionOf(typeof v === 'object' ? v : { version: v });
  }
  return out;
}

// Stamp an asset with freshness metadata. Mutates + returns the asset. `_sync`
// is the versioned-snapshot reference back to the canonical sources.
function stamp(asset, { sources, campaignVersion, status } = {}) {
  if (!asset || typeof asset !== 'object') return asset;
  const sv = sourceVersions(sources || {});
  asset._sync = {
    status: status || STATUS.CURRENT,
    synced_at: nowIso(),
    validated_at: nowIso(),
    source_version: sv,
    campaign_version: campaignVersion != null ? String(campaignVersion) : (asset._sync && asset._sync.campaign_version) || null,
  };
  return asset;
}

// Compare an asset's stored source versions to the current ones. Returns the
// list of dependency kinds that differ (empty = fresh). Kinds present in
// `current` but absent from the asset's stamp count as changed (new dependency).
function diffSources(asset, currentSources) {
  const stored = (asset && asset._sync && asset._sync.source_version) || {};
  const current = sourceVersions(currentSources || {});
  const changed = [];
  for (const k of Object.keys(current)) {
    if (String(stored[k]) !== String(current[k])) changed.push(k);
  }
  return changed;
}

// Is the asset stale vs the current canonical inputs?
function isStale(asset, currentSources) {
  if (!asset || !asset._sync) return true; // never stamped → treat as stale
  return diffSources(asset, currentSources).length > 0;
}

// Optimistic-concurrency check: a write carries the base version it read; a
// mismatch means someone else moved the record → conflict (do NOT overwrite).
function checkVersion(baseVersion, currentVersion) {
  return { conflict: baseVersion != null && String(baseVersion) !== String(currentVersion) };
}

// ── Event bus ──────────────────────────────────────────────────────────────
// Synchronous in-process dispatch. Handlers registered per event run in order;
// each returns a summary the caller can log.
const EVENTS = [
  'campaign.updated', 'product.updated', 'price.updated', 'inventory.updated',
  'offer.updated', 'claim.updated', 'review.updated', 'rating.updated',
  'asset.updated', 'audience.updated', 'forecast.updated', 'approval.updated',
  'publication.updated', 'source_conflict.detected',
];
const _handlers = Object.create(null);
function on(event, fn) { (_handlers[event] = _handlers[event] || []).push(fn); return () => { _handlers[event] = (_handlers[event] || []).filter((h) => h !== fn); }; }
async function emit(event, payload, ctx = {}) {
  const hs = _handlers[event] || [];
  const results = [];
  for (const h of hs) { try { results.push(await h(payload, ctx)); } catch (e) { results.push({ ok: false, error: e && e.message }); } }
  return results;
}

// In-memory fallback store (per process) so the engine works with no db.
const _mem = { state: new Map(), audit: [] };

// Persist a sync_state row (canonical or asset freshness). Uses the db when
// connected, else memory. Never throws — sync must not break the caller.
async function writeState(record, { db, config } = {}) {
  const row = {
    record_type: record.record_type,
    record_id: String(record.record_id),
    version: record.version != null ? String(record.version) : null,
    source_version: record.source_version || {},
    status: record.status || STATUS.CURRENT,
    dependencies: record.dependencies || {},
    synced_at: nowIso(),
    validated_at: record.validated_at || nowIso(),
  };
  const key = `${row.record_type}:${row.record_id}`;
  try {
    if (db && db.connected && config && config.tableNames) {
      await db.upsert('sync_state', [row], 'record_type,record_id');
    } else { _mem.state.set(key, row); }
  } catch (_) { _mem.state.set(key, row); }
  return row;
}

// Append an audit entry (previous → new, source, initiator, actor, reason,
// affected outputs, regeneration + validation result).
async function audit(entry, { db, config } = {}) {
  const row = {
    at: nowIso(),
    record_type: entry.record_type || null,
    record_id: entry.record_id != null ? String(entry.record_id) : null,
    previous_value: entry.previous_value ?? null,
    new_value: entry.new_value ?? null,
    source: entry.source || null,
    initiated_by: entry.initiated_by || null,
    actor: entry.actor || 'system',
    reason: entry.reason || null,
    affected_outputs: entry.affected_outputs || [],
    regeneration_result: entry.regeneration_result || null,
    validation_result: entry.validation_result || null,
  };
  try {
    if (db && db.connected && config && config.tableNames) { await db.insert('sync_audit_log', [row]); }
    else { _mem.audit.push(row); }
  } catch (_) { _mem.audit.push(row); }
  return row;
}

// Propagate a canonical change: identify dependent asset kinds, let a supplied
// finder resolve the actual affected assets, mark them stale, audit, and return
// a summary. `findAssets(kinds, payload)` is provided by the caller (it knows
// how to query smart_generated_campaigns etc.); markStale(asset) persists.
async function propagate(event, payload, { db, config, findAssets, markStale, actor = 'system' } = {}) {
  const kind = String(event).split('.')[0]; // 'price.updated' → 'price'
  const affectedKinds = DEPENDENTS[kind] || [];
  let assets = [];
  if (typeof findAssets === 'function') { try { assets = (await findAssets(affectedKinds, payload)) || []; } catch (_) { assets = []; } }
  const marked = [];
  for (const a of assets) {
    try {
      if (typeof markStale === 'function') await markStale(a);
      marked.push(a.id || a.record_id || a.campaign_id || null);
    } catch (_) { /* keep going */ }
  }
  await audit({
    record_type: kind, record_id: payload && (payload.id || payload.sku || payload.record_id),
    new_value: payload && payload.version, source: 'sync-core.propagate', initiated_by: event, actor,
    reason: `${event}: marked ${marked.length} dependent asset(s) stale`, affected_outputs: marked,
    regeneration_result: 'marked_stale', validation_result: null,
  }, { db, config });
  await emit(event, payload, { db, config });
  return { event, affectedKinds, affected: marked.length, ids: marked };
}

// Pre-launch synchronization gate. Compares the asset's stamped source versions
// to the CURRENT canonical versions and blocks launch on a differing
// launch-critical dependency. A dependency the caller could not resolve (its
// snapshot is undefined in currentSources) → BLOCKED — SOURCE UNAVAILABLE
// (advisory, never a fabricated "fresh"). Returns {ok, status, blockers, stale}.
function preLaunchGateSync(asset, currentSources = {}, { requireCritical = false } = {}) {
  if (!asset || !asset._sync) {
    return { ok: false, status: STATUS.VALIDATION_REQUIRED, blockers: ['asset was never stamped — cannot verify against source'], stale: [] };
  }
  const changed = diffSources(asset, currentSources);
  const criticalChanged = changed.filter((k) => LAUNCH_CRITICAL.includes(k));
  // A launch-critical source the caller has NO snapshot for is unavailable.
  const unavailable = LAUNCH_CRITICAL.filter((k) => (asset._sync.source_version || {})[k] !== undefined && currentSources[k] === undefined);
  if (criticalChanged.length) {
    return { ok: false, status: STATUS.STALE, blockers: criticalChanged.map((k) => `${k} changed since this asset was built`), stale: changed };
  }
  if (requireCritical && unavailable.length) {
    return { ok: false, status: STATUS.BLOCKED_UNAVAILABLE, blockers: unavailable.map((k) => `${k} source could not be verified (unavailable)`), stale: changed };
  }
  return { ok: changed.length === 0, status: changed.length === 0 ? STATUS.CURRENT : STATUS.STALE, blockers: [], stale: changed };
}
async function preLaunchGate({ asset, currentSources = {}, requireCritical = true } = {}) {
  return preLaunchGateSync(asset, currentSources, { requireCritical });
}

// Read-only snapshot of the in-memory store (for tests / status when no db).
function _memorySnapshot() { return { state: Array.from(_mem.state.values()), audit: _mem.audit.slice() }; }

module.exports = {
  STATUS, EVENTS, LAUNCH_CRITICAL, DEPENDENTS,
  stableHash, versionOf, sourceVersions, stamp, diffSources, isStale, checkVersion,
  on, emit, propagate, writeState, audit, preLaunchGate, preLaunchGateSync, _memorySnapshot,
};
