'use strict';
/**
 * domain-intel.js — suggest a domain, verify it properly, and say what sending
 * from it would take.
 * ---------------------------------------------------------------------------
 * Adapted from the domain-naming step in Google's ADK `marketing-agency` sample
 * (google/adk-samples, Apache-2.0). The FEATURE is a real gap here: this
 * platform onboards a brand, reads its site and audits its sending domain, and
 * had nothing for a brand that does not have a domain yet.
 *
 * ── WHAT WAS NOT TAKEN, AND WHY ────────────────────────────────────────────
 * The sample checks availability by GOOGLE-SEARCHING the domain and treating a
 * thin result page as "available". That is unsound in both directions and this
 * codebase cannot ship it:
 *
 *   false AVAILABLE  a registered domain that is parked, or held defensively,
 *                    or simply has no content, returns nothing useful from a
 *                    search — and would be reported as free. An operator then
 *                    builds a brand on a name they cannot register.
 *   false TAKEN      a domain that is unregistered but shares a name with an
 *                    established company returns a page full of results, and
 *                    a genuinely available name is discarded.
 *
 * Registration state is not a search-engine question. It is answered by RDAP
 * (RFC 7482/9082), the IANA-standardised successor to WHOIS that registries
 * serve as JSON. `rdap.org` bootstraps to the authoritative registry for the
 * TLD. So:
 *
 *   RDAP 200          the domain is REGISTERED. Definitive.
 *   RDAP 404          the domain is UNREGISTERED. Definitive, per RFC 7480 §5.3.
 *   anything else     UNKNOWN. Reported as unknown, never as available.
 *
 * That last line is the same discipline the blocklist and DNS checks in
 * deliverability-core follow: a lookup that did not complete is not a result.
 * Telling an operator a name is free when we could not check is how somebody
 * designs a logo for a domain they will never own.
 *
 * DNS is used only as CORROBORATION, and only in one direction: records that
 * resolve prove the domain is registered. Their ABSENCE proves nothing, because
 * a freshly registered or parked domain routinely publishes none.
 *
 * ── WHAT THIS ADDS THAT THE SAMPLE DOES NOT ────────────────────────────────
 * 1. Candidates come from the BRAND'S OWN RECORD - its name, industry,
 *    offerings and regions - not from free-text keywords. The platform already
 *    knows who the brand is; asking again would be worse than not asking.
 * 2. A chosen domain is handed straight to deliverability-core, so the operator
 *    sees what sending from it would require BEFORE they buy it. A domain is a
 *    sending asset here, not just an address.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const runtime = require('./brand-runtime.js');

const RDAP_BOOTSTRAP = 'https://rdap.org/domain/';
const TIMEOUT_MS = 8000;

/* ── candidate generation ─────────────────────────────────────────────────── */

/**
 * Word parts worth combining, taken from what the brand has already told us.
 * Deliberately NOT an LLM call: this runs on every suggestion request, the
 * inputs are short, and a model would add latency and a fabrication surface to
 * a step that is really string handling.
 */
function seedWords(brand) {
  const b = brand && !runtime.isUnresolved(brand) ? brand : null;
  const out = [];
  const push = (v) => {
    for (const w of String(v || '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 3 && w.length <= 12 && !STOP.has(w) && out.indexOf(w) < 0) out.push(w);
    }
  };
  if (b) {
    push(b.name);
    push(b.industry);
    push(b.positioning);
    for (const o of (b.offerings || []).slice(0, 6)) push(typeof o === 'string' ? o : (o && (o.name || o.kind)));
    for (const c of (b.claims || []).slice(0, 4)) push(typeof c === 'string' ? c : (c && c.text));
  }
  return out;
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'you', 'your', 'our',
  'are', 'was', 'has', 'have', 'not', 'all', 'any', 'can', 'will', 'own',
  'com', 'www', 'http', 'https', 'ltd', 'inc', 'llc', 'pvt', 'limited',
  'private', 'best', 'top', 'new', 'now', 'get', 'buy', 'shop', 'store',
]);

/** Suffixes that read as a brand rather than as a description. */
const SUFFIXES = ['hq', 'lab', 'labs', 'co', 'works', 'studio', 'supply', 'club', 'kit'];
const PREFIXES = ['go', 'try', 'get', 'the', 'join'];

/**
 * Build candidates. Pure and deterministic for a given brand + tld list, so the
 * same brand sees a stable set rather than a reshuffle on every visit.
 *
 * @returns {{ok:boolean, candidates:Array<{domain:string,label:string,why:string}>, note?:string}}
 */
function suggest(brand, { tlds = ['com'], count = 12 } = {}) {
  const words = seedWords(brand);
  if (!words.length) {
    return {
      ok: false,
      candidates: [],
      // The same rule the rest of the platform follows: say what is missing
      // rather than inventing a brand to name.
      note: '[DATA REQUIRED BEFORE LAUNCH: brand name, industry or offerings] '
        + 'No brand words are recorded, so there is nothing to build a name from. '
        + 'Fill in the brand on the onboarding form, or read it from the brand\'s own site, and try again.',
    };
  }

  const seen = new Set();
  const out = [];
  const add = (stem, why) => {
    const clean = String(stem).replace(/[^a-z0-9-]/g, '');
    if (clean.length < 3 || clean.length > 24) return;
    for (const tld of tlds) {
      const domain = `${clean}.${String(tld).replace(/^\./, '')}`;
      if (seen.has(domain)) continue;
      seen.add(domain);
      out.push({ domain, label: clean, why });
    }
  };

  const primary = words[0];
  add(primary, 'the brand name itself');
  for (const s of SUFFIXES) add(primary + s, `the brand name with a brandable suffix (-${s})`);
  for (const p of PREFIXES) add(p + primary, `the brand name with a familiar prefix (${p}-)`);
  for (const w of words.slice(1, 6)) {
    add(primary + w, 'the brand name compounded with a word it already uses');
    add(w + primary, 'a word the brand already uses, compounded with its name');
  }

  return {
    ok: true,
    candidates: out.slice(0, Math.max(1, Math.min(Number(count) || 12, 60))),
    derived_from: words.slice(0, 8),
    note: 'Candidates are built from this brand\'s own record. None has been checked yet - availability is a separate, authoritative step.',
  };
}

/* ── availability, done properly ──────────────────────────────────────────── */

/**
 * @returns {Promise<{domain:string, state:'registered'|'available'|'unknown', method:string, detail:string, checked_at:string, registrar?:string, expires?:string}>}
 */
async function availability(domain) {
  const d = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const at = new Date().toISOString();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) {
    return { domain: d, state: 'unknown', method: 'none', detail: 'That is not a domain name.', checked_at: at };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(RDAP_BOOTSTRAP + encodeURIComponent(d), {
      headers: { accept: 'application/rdap+json' },
      signal: ctrl.signal,
      redirect: 'follow',
      cache: 'no-store',
    });

    // RFC 7480 §5.3: 404 means the registry holds no such object. For a domain
    // query that is the definition of unregistered.
    if (res.status === 404) {
      return { domain: d, state: 'available', method: 'rdap', detail: 'The registry reports no record for this domain.', checked_at: at };
    }
    if (res.ok) {
      let body = null;
      try { body = await res.json(); } catch (_) { body = null; }
      const events = (body && body.events) || [];
      const expiry = events.find((e) => /expiration/i.test(String(e.eventAction || '')));
      const registrar = ((body && body.entities) || [])
        .find((e) => (e.roles || []).some((r) => /registrar/i.test(r)));
      return {
        domain: d,
        state: 'registered',
        method: 'rdap',
        detail: 'The registry holds a record for this domain.',
        registrar: registrar ? nameOf(registrar) : undefined,
        expires: expiry ? expiry.eventDate : undefined,
        checked_at: at,
      };
    }

    // 429 and 5xx are the registry rate-limiting or failing. Neither is an
    // answer about the domain.
    return {
      domain: d,
      state: 'unknown',
      method: 'rdap',
      detail: `The registry answered ${res.status}, which says nothing about whether the domain is registered. This is not the same as available.`,
      checked_at: at,
    };
  } catch (err) {
    // Fall back to DNS, which can only ever prove the POSITIVE.
    const dnsSays = await registeredByDns(d);
    if (dnsSays) {
      return {
        domain: d, state: 'registered', method: 'dns',
        detail: 'RDAP could not be reached, but the domain resolves, so it is certainly registered.',
        checked_at: at,
      };
    }
    return {
      domain: d,
      state: 'unknown',
      method: 'none',
      detail: `RDAP could not be reached (${String((err && err.message) || err).slice(0, 80)}), and DNS silence does not mean a domain is free - parked and newly registered domains routinely publish no records. Check with a registrar before relying on this.`,
      checked_at: at,
    };
  } finally {
    clearTimeout(timer);
  }
}

function nameOf(entity) {
  const v = (entity && entity.vcardArray && entity.vcardArray[1]) || [];
  const fn = v.find((row) => Array.isArray(row) && row[0] === 'fn');
  return fn ? String(fn[3] || '') : '';
}

/** True only when DNS proves the domain exists. Never used to prove absence. */
async function registeredByDns(domain) {
  try {
    const dns = require('dns').promises;
    const [ns, a] = await Promise.allSettled([dns.resolveNs(domain), dns.resolve4(domain)]);
    return (ns.status === 'fulfilled' && ns.value.length > 0)
      || (a.status === 'fulfilled' && a.value.length > 0);
  } catch (_) { return false; }
}

/**
 * Check a list, in series with a small gap. RDAP registries rate-limit, and a
 * burst returns 429s that this module would honestly report as `unknown` -
 * which is useless to the operator. Slower and answered beats fast and blank.
 */
async function checkMany(domains, { limit = 12, gapMs = 120 } = {}) {
  const list = (Array.isArray(domains) ? domains : []).slice(0, limit);
  const out = [];
  for (const d of list) {
    out.push(await availability(d));
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
  }
  return {
    ok: true,
    results: out,
    summary: {
      available: out.filter((r) => r.state === 'available').length,
      registered: out.filter((r) => r.state === 'registered').length,
      unknown: out.filter((r) => r.state === 'unknown').length,
    },
    note: out.some((r) => r.state === 'unknown')
      ? 'Some lookups did not complete. Those are reported as unknown, not as available: a name nobody could check is not a name you can register.'
      : 'Every lookup completed against the registry.',
  };
}

/* ── what sending from it would take ──────────────────────────────────────── */

/**
 * The connection this platform can make and the sample could not: a domain here
 * is a SENDING asset. Once a name is chosen the operator should learn, before
 * they buy it, what publishing from it requires.
 */
async function sendingReadiness(domain) {
  const deliver = require('./deliverability-core.js');
  const audit = await deliver.auditDomain(domain);
  if (!audit.ok) return { ok: false, domain, error: audit.error };

  const by = {};
  for (const r of audit.records) by[r.type] = r;
  const missing = ['SPF', 'DKIM', 'DMARC'].filter((t) => by[t] && by[t].unavailable !== true && by[t].passed === false);

  return {
    ok: true,
    domain: audit.domain,
    score: audit.score,
    grade: audit.grade,
    partial: !!(audit.score_breakdown && audit.score_breakdown.partial),
    records: audit.records.map((r) => ({ type: r.type, found: r.found, passed: r.passed, unavailable: !!r.unavailable })),
    to_do: missing.length
      ? missing.map((t) => ({
        record: t,
        why: t === 'DMARC'
          ? 'Google and Yahoo require DMARC from bulk senders; without it mail is filtered rather than delivered.'
          : t === 'SPF'
            ? 'Names the services allowed to send as this domain.'
            : 'Signs each message so a receiver can verify it was not altered.',
      }))
      : [],
    verdict: missing.length
      ? `${audit.domain} is not ready to send from: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing or failing.`
      : audit.score == null
        ? `Nothing could be checked for ${audit.domain}, so its readiness is unknown.`
        : `${audit.domain} authenticates correctly (${audit.score}/100).`,
  };
}

module.exports = { suggest, availability, checkMany, sendingReadiness, seedWords, registeredByDns, RDAP_BOOTSTRAP };
