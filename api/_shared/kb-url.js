'use strict';
/**
 * kb-url.js — the ONE definition of a knowledge-base row's identity.
 *
 * `kb_knowledge` de-duplicates on (workspace_id, url_hash), and url_hash is
 * sha1 of the CANONICAL url. Two callers now write into that table: the manual
 * ingest in api/kb.js and the brand context pack's own-site ingest. If they
 * canonicalise differently, the same page lands twice under two hashes - once
 * from the operator pasting it and once from the automatic crawl - and neither
 * copy is wrong enough to notice.
 *
 * So the rule lives here and both require it.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 */

const crypto = require('crypto');

/** Params that identify a CAMPAIGN, not a page. Stripped before hashing. */
const TRACKING = /^(utm_|fbclid$|gclid$|mc_|_hsenc$|_hsmi$|hsCtaTracking$|ref$|source$)/i;

function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    [...u.searchParams.keys()].forEach((k) => { if (TRACKING.test(k)) u.searchParams.delete(k); });
    if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch (_) { return raw; }
}

function urlHash(url) {
  return crypto.createHash('sha1').update(canonicalUrl(url)).digest('hex');
}

module.exports = { canonicalUrl, urlHash, TRACKING };
