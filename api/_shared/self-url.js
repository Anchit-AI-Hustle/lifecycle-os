'use strict';
/**
 * self-url.js - the address this deployment calls ITSELF on, for the
 * background chains that fire their own next step (the catalogue import, the
 * context pack, the Smart Brain prebuild queue).
 *
 * 2026-10-13, production: every chain called `https://${VERCEL_URL}`, the
 * deployment's own generated *.vercel.app address. This project has Vercel
 * Standard Protection ("all except custom domains"), and Vercel's docs say
 * VERCEL_URL "cannot be used in conjunction with Standard Deployment
 * Protection": the self-call was answered by the protection page, the next
 * step never ran, and the import still said "It is continuing by itself"
 * while nothing moved. A chain started on an older deployment would also keep
 * calling THAT deployment (and its region) for good.
 *
 * Order, each a documented Vercel system variable or ours:
 *   1. SELF_BASE_URL - an explicit override.
 *   2. The host the CURRENT request arrived on, when it is not a generated
 *      *.vercel.app address: a person on the custom domain reached this
 *      function there, so it answers there; a chained step inherits the
 *      address its parent called, so the whole chain stays on it.
 *   3. VERCEL_PROJECT_PRODUCTION_URL on a production deployment: the
 *      project's production domain (it carries no scheme).
 *   4. VERCEL_URL, the old behaviour (preview / local).
 * `selfHeaders()` adds Vercel's `x-vercel-protection-bypass` header when the
 * project has Protection Bypass for Automation (VERCEL_AUTOMATION_BYPASS_SECRET),
 * so a generated address works too. Not a function file (api/_shared/).
 */

function clean(host) {
  return String(host || '').split(',')[0].trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function generated(host) {
  return /\.vercel\.app$/i.test(host);
}

function requestHost() {
  try {
    const req = require('./request-scope.js').currentRequest();
    const h = req && req.headers ? (req.headers['x-forwarded-host'] || req.headers.host) : '';
    return clean(h);
  } catch (_) { return ''; }
}

function selfBaseUrl() {
  if (process.env.SELF_BASE_URL) return String(process.env.SELF_BASE_URL).replace(/\/$/, '');
  const asked = requestHost();
  if (asked && !generated(asked) && !/^(localhost|127\.|\[::1\])/.test(asked)) return `https://${asked}`;
  if (String(process.env.VERCEL_ENV || '') === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${clean(process.env.VERCEL_PROJECT_PRODUCTION_URL)}`;
  if (process.env.VERCEL_URL) return `https://${clean(process.env.VERCEL_URL)}`;
  return '';
}

/** Headers every self-call sends (the bypass secret only when the project has one). */
function selfHeaders(extra) {
  const h = Object.assign({}, extra || {});
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) h['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return h;
}

module.exports = { selfBaseUrl, selfHeaders };
