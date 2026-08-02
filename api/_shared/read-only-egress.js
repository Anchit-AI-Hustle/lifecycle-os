// ============================================================================
// read-only-egress.js — project-wide READ-ONLY guard for the source platforms.
//
// Standing rule: NOTHING in this project may write to Shopify, Klaviyo, or
// WebEngage. Only read / pull / fetch (GET / HEAD / OPTIONS) is allowed; every
// other verb (POST / PUT / PATCH / DELETE) is denied at runtime.
//
// This is the single, central place that rule is defined. Any code that calls
// one of these hosts must go through guardedFetch() (or call assertReadOnly()
// first) — klaviyo-core does. assertReadOnly() THROWS on a violation so a write
// can never silently go out; it does not fabricate a fake success.
//
// The ultimate guarantee is still the credential itself: use read-only-scoped
// keys at the source (a read key cannot write even if code tried). This runtime
// guard is defense-in-depth on top of that.
//
// Escape hatch (off by default, per-platform, intentional): set the matching
// <PLATFORM>_ALLOW_WRITES=1 env var to permit writes to that one platform.
// Leaving it unset (the default) denies all writes.
// ============================================================================

const READ_ONLY_PLATFORMS = [
  { id: 'klaviyo',   hosts: ['klaviyo.com'],                 allowEnv: 'KLAVIYO_ALLOW_WRITES' },
  { id: 'shopify',   hosts: ['myshopify.com', 'shopify.com'], allowEnv: 'SHOPIFY_ALLOW_WRITES' },
  { id: 'webengage', hosts: ['webengage.com'],               allowEnv: 'WEBENGAGE_ALLOW_WRITES' },
];

// READ IS GET, ALWAYS. Only GET (plus HEAD, a headerless GET) is permitted.
// Every other verb — including POST — mutates or is treated as a write and is
// denied. There is no "read-only POST" exception.
const SAFE_METHODS = new Set(['GET', 'HEAD']);

function platformFor(url) {
  let host;
  try { host = new URL(url).host.toLowerCase(); } catch (_) { return null; }
  return READ_ONLY_PLATFORMS.find((p) => p.hosts.some((dom) => host === dom || host.endsWith('.' + dom))) || null;
}

// Throws a READ-ONLY VIOLATION error for any write verb aimed at a guarded
// platform. No-op for reads and for hosts that are not one of the three.
function assertReadOnly(url, method = 'GET') {
  const p = platformFor(url);
  if (!p) return;
  const m = String(method || 'GET').toUpperCase();
  if (SAFE_METHODS.has(m)) return;
  if (process.env[p.allowEnv] === '1') return; // explicit, per-platform opt-out
  const err = new Error(
    `READ-ONLY VIOLATION: ${m} request to ${p.id} was blocked. ` +
    `Shopify, Klaviyo and WebEngage are fetch-only in this project — ` +
    `read/pull only, no write/update/delete. (Set ${p.allowEnv}=1 to override.)`
  );
  err.read_only_blocked = true;
  err.platform = p.id;
  throw err;
}

// Drop-in fetch wrapper that enforces the guard before the request leaves.
async function guardedFetch(url, opts = {}) {
  assertReadOnly(url, opts.method || 'GET');
  return fetch(url, opts);
}

module.exports = { assertReadOnly, guardedFetch, platformFor, READ_ONLY_PLATFORMS, SAFE_METHODS };
