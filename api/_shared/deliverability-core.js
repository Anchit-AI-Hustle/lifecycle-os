'use strict';
/**
 * deliverability-core.js — does this domain deserve the inbox?
 * ---------------------------------------------------------------------------
 * Four things, in the order they actually matter to a sender:
 *
 *   1. AUTHENTICATION   SPF, DKIM, DMARC, MX, BIMI - parsed, not just present.
 *                       "Has an SPF record" is nearly meaningless; "has an SPF
 *                       record that resolves in under 10 DNS lookups and does
 *                       not end in +all" is the thing that decides delivery.
 *   2. REPUTATION       public blocklists, and Google Postmaster / Microsoft
 *                       SNDS when the workspace has connected them.
 *   3. WARMUP           a ramp that a new domain can survive, with throttles
 *                       that stop it when the recipients say no.
 *   4. CONTENT          the spam signals in one specific message.
 *
 * ── TWO PLACES THIS REFUSES TO GUESS ───────────────────────────────────────
 *
 * BLOCKLISTS. Spamhaus (and others) refuse queries that arrive from a public
 * resolver, and they signal that refusal with a 127.255.255.x answer that looks
 * exactly like a listing to naive code. A checker that treats "query refused"
 * as "not listed" tells its user the single most dangerous lie available here.
 * `checkBlocklists()` detects the refusal codes and reports checked:false with
 * the reason. Serverless egress IPs are shared and almost always refused, so
 * this will usually be honest-unavailable rather than a result, and it says so.
 *
 * POSTMASTER / SNDS. Google Postmaster Tools and Microsoft SNDS both need the
 * DOMAIN OWNER to enrol and authorise; there is no way for this platform to
 * read reputation for a domain it has not been granted. Both are reported as
 * not-connected rather than filled with a plausible number.
 *
 * DNS RESOLUTION. Node's dns/promises first, because it is the real thing.
 * DNS-over-HTTPS (Cloudflare, then Google) as a fallback, because a serverless
 * sandbox often has no UDP path to port 53. The resolver that answered is
 * recorded on every record, since a DoH answer can differ from what the
 * sending host itself would see.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const dns = require('dns').promises;

const DOH = [
  { id: 'doh:cloudflare', url: (n, t) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(n)}&type=${t}` },
  { id: 'doh:google', url: (n, t) => `https://dns.google/resolve?name=${encodeURIComponent(n)}&type=${t}` },
];

/* ── resolution ───────────────────────────────────────────────────────────── */

/**
 * @returns {Promise<{ok:boolean, records:string[], resolver:string, error?:string}>}
 * TXT strings are joined per record: DNS splits anything over 255 bytes into
 * chunks, and a long DKIM key that is joined wrongly is unparseable.
 */
/**
 * "No such record" and "could not ask" are different answers and must never
 * collapse into each other: NXDOMAIN / ENODATA is a fact about the domain,
 * everything else is a fact about us. Only the former returns records:[].
 */
const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA']);
// Worth one retry: a large TXT RRset that needs TCP fallback times out on the
// first UDP try often enough to matter, and SPF records are exactly the large
// ones.
const TRANSIENT = new Set(['ETIMEOUT', 'ESERVFAIL', 'EREFUSED', 'ECONNREFUSED']);

async function systemQuery(name, kind, attempt) {
  try {
    if (kind === 'TXT') {
      const rows = await dns.resolveTxt(name);
      return { ok: true, records: rows.map((r) => (Array.isArray(r) ? r.join('') : String(r))), resolver: 'system' };
    }
    if (kind === 'MX') {
      const rows = await dns.resolveMx(name);
      return { ok: true, records: rows.map((r) => `${r.priority} ${r.exchange}`), resolver: 'system' };
    }
    return { ok: true, records: await dns.resolve4(name), resolver: 'system' };
  } catch (err) {
    const code = (err && err.code) || '';
    if (NO_RECORD.has(code)) return { ok: true, records: [], resolver: 'system' };
    if (TRANSIENT.has(code) && attempt < 1) {
      await new Promise((r) => setTimeout(r, 250));
      return systemQuery(name, kind, attempt + 1);
    }
    return { ok: false, records: [], resolver: 'system', error: `${code || 'DNS error'} for ${kind} ${name}` };
  }
}

async function resolveRecord(name, kind) {
  const sys = await systemQuery(name, kind, 0);
  if (sys.ok) return sys;
  const doh = await dohQuery(name, kind);
  // Carry the system error forward when DoH could not answer either, so the
  // reason shown is the first thing that went wrong rather than the last.
  return doh.ok ? doh : Object.assign({}, doh, { error: doh.error || sys.error });
}

const resolveTxt = (name) => resolveRecord(name, 'TXT');
const resolveMx = (name) => resolveRecord(name, 'MX');
const resolveA = (name) => resolveRecord(name, 'A');

async function dohQuery(name, type) {
  for (const p of DOH) {
    try {
      const res = await fetch(p.url(name, type), { headers: { accept: 'application/dns-json' }, cache: 'no-store' });
      if (!res.ok) continue;
      const j = await res.json();
      // NXDOMAIN (3) is a definitive "no such name", not a failure to look.
      if (j.Status === 3) return { ok: true, records: [], resolver: p.id };
      if (j.Status !== 0) continue;
      const answers = (j.Answer || []).filter((a) => a.data != null);
      return {
        ok: true,
        // DoH returns TXT already quoted and chunk-joined with `" "`.
        records: answers.map((a) => String(a.data).replace(/^"|"$/g, '').replace(/" "/g, '')),
        resolver: p.id,
      };
    } catch (_) { /* try the next resolver */ }
  }
  return { ok: false, records: [], resolver: 'none', error: `Could not resolve ${type} for ${name} by system DNS or DNS-over-HTTPS.` };
}

/**
 * The DNS lookup itself failed, so nothing is known about this record.
 *
 * This is NOT `passed:false`. Scoring an unreachable lookup as a failure marks
 * a correctly configured domain down for our own network trouble - the same
 * mistake as reporting a refused blocklist query as "clean", pointing the other
 * way. `unavailable` records are excluded from the score's denominator, so the
 * score always means "of what could be checked".
 */
function unavailable(type, r) {
  return {
    type,
    found: null,
    raw: null,
    parsed: null,
    passed: null,
    unavailable: true,
    resolver: r.resolver || 'none',
    findings: [{
      level: 'warn',
      message: `Could not look up ${type}: ${r.error || 'no resolver answered'}. This says nothing about the record - it says the lookup did not complete.`,
      remediation: 'Re-run the check. If it keeps failing, verify the domain name and that DNS-over-HTTPS is reachable from this deployment.',
    }],
  };
}

/* ── SPF ──────────────────────────────────────────────────────────────────── */

/** Mechanisms that cost a DNS lookup. The limit is 10 and exceeding it is a permerror. */
const SPF_LOOKUP_MECHANISMS = /^(?:\+|-|~|\?)?(include|a|mx|ptr|exists|redirect)(?:[:=]|$)/i;

async function auditSpf(domain) {
  const r = await resolveTxt(domain);
  const raw = (r.records || []).find((t) => /^v=spf1\b/i.test(t.trim())) || null;
  const findings = [];
  const spfRecords = (r.records || []).filter((t) => /^v=spf1\b/i.test(t.trim()));

  if (!r.ok) return unavailable('SPF', r);
  if (!raw) {
    return {
      type: 'SPF', found: false, raw: null, parsed: null, passed: false, resolver: r.resolver,
      findings: [{ level: 'fail', message: 'No SPF record.', remediation: 'Publish a TXT record at the domain root starting v=spf1, listing the services that send for you, ending in -all.' }],
    };
  }
  if (spfRecords.length > 1) {
    // Two SPF records is a permerror, and it is a common outcome of adding a
    // second ESP by publishing a second record instead of merging.
    findings.push({ level: 'fail', message: `${spfRecords.length} SPF records published. More than one is a permanent error and SPF will fail entirely.`, remediation: 'Merge them into a single v=spf1 record.' });
  }

  const lookups = await countSpfLookups(raw, domain, 0, new Set());
  const all = /[-~?+]all\s*$/i.exec(raw.trim());
  const allMech = all ? all[0].trim().toLowerCase() : '';

  if (lookups.count > 10) {
    findings.push({ level: 'fail', message: `SPF needs ${lookups.count} DNS lookups; the limit is 10, so evaluation returns permerror and SPF fails for every message.`, remediation: 'Flatten or remove includes. Each third-party sender you add costs at least one.' });
  } else if (lookups.count > 8) {
    findings.push({ level: 'warn', message: `SPF uses ${lookups.count} of the 10 permitted DNS lookups. Adding one more sender will break it.`, remediation: 'Consolidate includes before adding another provider.' });
  }
  if (lookups.truncated) {
    findings.push({ level: 'warn', message: 'The include chain was deeper than this checker follows, so the lookup count is a lower bound.' });
  }

  if (!allMech) findings.push({ level: 'warn', message: 'No "all" mechanism, so the record is neutral about everything it does not list.', remediation: 'End the record with -all once you are confident the list is complete.' });
  else if (allMech === '+all') findings.push({ level: 'fail', message: '+all authorises the entire internet to send as this domain. This is worse than having no SPF at all.', remediation: 'Change it to -all.' });
  else if (allMech === '?all') findings.push({ level: 'warn', message: '?all is neutral and gives receivers nothing to act on.', remediation: 'Move to ~all, then -all.' });
  else if (allMech === '~all') findings.push({ level: 'ok', message: '~all (softfail). Safe while you confirm every sender, and worth tightening to -all afterwards.' });
  else findings.push({ level: 'ok', message: '-all (fail). Unlisted senders are rejected, which is the strongest setting.' });

  const passed = spfRecords.length === 1 && lookups.count <= 10 && allMech !== '+all' && !!allMech;
  return {
    type: 'SPF', found: true, raw, resolver: r.resolver, passed,
    parsed: { lookups: lookups.count, lookups_truncated: lookups.truncated, all: allMech, records: spfRecords.length, includes: lookups.includes },
    findings,
  };
}

/**
 * Count the DNS lookups an SPF evaluation costs, following includes and
 * redirects. Bounded by depth and by a seen-set, because a misconfigured pair of
 * domains can include each other and this must not become the outage.
 */
async function countSpfLookups(record, domain, depth, seen) {
  let count = 0;
  let truncated = false;
  const includes = [];
  if (depth > 4) return { count: 0, truncated: true, includes };

  for (const term of String(record).trim().split(/\s+/).slice(1)) {
    const m = SPF_LOOKUP_MECHANISMS.exec(term);
    if (!m) continue;
    count += 1;
    const kind = m[1].toLowerCase();
    if (kind !== 'include' && kind !== 'redirect') continue;

    const target = term.split(/[:=]/).slice(1).join(':').trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    includes.push(target);

    const sub = await resolveTxt(target);
    const subRecord = (sub.records || []).find((t) => /^v=spf1\b/i.test(t.trim()));
    if (!subRecord) continue;
    const nested = await countSpfLookups(subRecord, target, depth + 1, seen);
    count += nested.count;
    truncated = truncated || nested.truncated;
  }
  return { count, truncated, includes };
}

/* ── DKIM ─────────────────────────────────────────────────────────────────── */

/**
 * DKIM cannot be discovered: a selector is chosen by whoever signs, and there is
 * no way to enumerate them from DNS. This checks the selectors it is GIVEN, plus
 * the well-known defaults of the ESPs this platform integrates with, and says
 * plainly that a miss is not proof of absence.
 */
const COMMON_SELECTORS = [
  { s: 'klaviyo', why: 'Klaviyo' },
  { s: 'kl', why: 'Klaviyo (alternate)' },
  { s: 'google', why: 'Google Workspace' },
  { s: 'selector1', why: 'Microsoft 365' },
  { s: 'selector2', why: 'Microsoft 365' },
  { s: 's1', why: 'SendGrid and others' },
  { s: 's2', why: 'SendGrid and others' },
  { s: 'default', why: 'generic' },
  { s: 'mail', why: 'generic' },
  { s: 'dkim', why: 'generic' },
];

async function auditDkim(domain, selectors) {
  const wanted = (Array.isArray(selectors) && selectors.length ? selectors.map((s) => ({ s: String(s), why: 'configured' })) : COMMON_SELECTORS);
  const found = [];
  let resolver = 'system';
  let failedLookups = 0;

  for (const cand of wanted) {
    const r = await resolveTxt(`${cand.s}._domainkey.${domain}`);
    resolver = r.resolver || resolver;
    if (!r.ok) { failedLookups += 1; continue; }
    const rec = (r.records || []).find((t) => /(^|;)\s*(v=DKIM1|k=|p=)/i.test(t));
    if (!rec) continue;
    const p = /(?:^|;)\s*p=([^;]*)/i.exec(rec);
    const key = p ? p[1].trim() : '';
    found.push({
      selector: cand.s,
      source: cand.why,
      revoked: key === '',
      // A 1024-bit RSA key is roughly 216 base64 characters; 2048-bit is ~392.
      key_bits_estimate: key ? (key.length > 300 ? 2048 : 1024) : 0,
      raw: rec.slice(0, 400),
    });
  }

  // Every selector lookup failed, so absence proves nothing here.
  if (!found.length && failedLookups === wanted.length) {
    return unavailable('DKIM', { resolver, error: `all ${wanted.length} selector lookups failed` });
  }

  const findings = [];
  const live = found.filter((f) => !f.revoked);
  if (failedLookups) {
    findings.push({ level: 'warn', message: `${failedLookups} of ${wanted.length} selector lookups did not complete, so this list may be incomplete.` });
  }
  if (!found.length) {
    findings.push({
      level: 'fail',
      message: `No DKIM key found at any of ${wanted.length} selectors that were tried.`,
      remediation: 'Publish the selector your sending platform gives you. Selectors cannot be enumerated from DNS, so if you sign with a custom one, add it to this domain profile and re-check.',
    });
  } else {
    for (const f of found.filter((x) => x.revoked)) {
      findings.push({ level: 'warn', message: `Selector ${f.selector} exists with an empty p= tag, which is a revoked key.`, remediation: 'Remove it if the sender is gone.' });
    }
    for (const f of live.filter((x) => x.key_bits_estimate === 1024)) {
      findings.push({ level: 'warn', message: `Selector ${f.selector} looks like a 1024-bit key.`, remediation: 'Rotate to 2048-bit where the provider supports it.' });
    }
    if (live.length) findings.push({ level: 'ok', message: `${live.length} live DKIM selector(s): ${live.map((f) => f.selector).join(', ')}.` });
  }

  return {
    type: 'DKIM', found: found.length > 0, raw: found.length ? found[0].raw : null, resolver,
    passed: live.length > 0,
    parsed: { selectors: found, tried: wanted.map((w) => w.s) },
    findings,
  };
}

/* ── DMARC ────────────────────────────────────────────────────────────────── */

async function auditDmarc(domain) {
  const r = await resolveTxt(`_dmarc.${domain}`);
  if (!r.ok) return unavailable('DMARC', r);
  const raw = (r.records || []).find((t) => /^v=DMARC1\b/i.test(t.trim())) || null;
  const findings = [];

  if (!raw) {
    return {
      type: 'DMARC', found: false, raw: null, parsed: null, passed: false, resolver: r.resolver,
      findings: [{
        level: 'fail',
        message: 'No DMARC record. Since 2024 both Google and Yahoo require one for bulk senders, so this is a delivery blocker, not a best practice.',
        remediation: 'Publish TXT at _dmarc with v=DMARC1; p=none; rua=mailto:you@yourdomain, then tighten to quarantine and reject once the reports are clean.',
      }],
    };
  }

  const tags = {};
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) tags[k.trim().toLowerCase()] = v.join('=').trim();
  }
  const policy = String(tags.p || '').toLowerCase();
  const pct = tags.pct === undefined ? 100 : Number(tags.pct);

  if (policy === 'none') {
    findings.push({ level: 'warn', message: 'p=none only monitors. It satisfies the bulk sender requirement and stops nobody from spoofing this domain.', remediation: 'Move to p=quarantine once your aggregate reports show all legitimate mail aligned.' });
  } else if (policy === 'quarantine') {
    findings.push({ level: 'ok', message: 'p=quarantine. Unaligned mail goes to spam.' });
  } else if (policy === 'reject') {
    findings.push({ level: 'ok', message: 'p=reject. The strongest policy.' });
  } else {
    findings.push({ level: 'fail', message: `Unrecognised policy "${tags.p || '(missing)'}".`, remediation: 'p must be none, quarantine or reject.' });
  }

  if (Number.isFinite(pct) && pct < 100 && policy !== 'none') {
    findings.push({ level: 'warn', message: `pct=${pct}, so the policy applies to only ${pct}% of mail. The rest is unprotected.`, remediation: 'Raise to 100 once you are confident.' });
  }
  if (!tags.rua) {
    findings.push({ level: 'warn', message: 'No rua address, so no aggregate reports are being collected.', remediation: 'Add rua=mailto:… — without reports you are tightening policy blind.' });
  }
  if (tags.sp && String(tags.sp).toLowerCase() === 'none' && policy !== 'none') {
    findings.push({ level: 'warn', message: 'sp=none leaves every subdomain unprotected while the parent is enforced. Subdomain spoofing is the common attack.', remediation: 'Remove sp, so subdomains inherit p.' });
  }

  const aspf = String(tags.aspf || 'r').toLowerCase();
  const adkim = String(tags.adkim || 'r').toLowerCase();
  if (aspf === 's' || adkim === 's') findings.push({ level: 'ok', message: `Strict alignment is on (aspf=${aspf}, adkim=${adkim}).` });

  return {
    type: 'DMARC', found: true, raw, resolver: r.resolver,
    passed: policy === 'quarantine' || policy === 'reject',
    parsed: { policy, pct: Number.isFinite(pct) ? pct : 100, rua: tags.rua || '', ruf: tags.ruf || '', sp: tags.sp || '', aspf, adkim },
    findings,
  };
}

/* ── MX and BIMI ──────────────────────────────────────────────────────────── */

async function auditMx(domain) {
  const r = await resolveMx(domain);
  if (!r.ok) return unavailable('MX', r);
  const findings = [];
  if (!r.records.length) {
    findings.push({ level: 'warn', message: 'No MX record, so this domain cannot receive mail.', remediation: 'A send-only domain still needs MX to receive bounces and to look legitimate to filters.' });
  } else {
    findings.push({ level: 'ok', message: `${r.records.length} MX host(s).` });
  }
  return { type: 'MX', found: r.records.length > 0, raw: r.records.join(' | ') || null, parsed: { hosts: r.records }, passed: r.records.length > 0, resolver: r.resolver, findings };
}

async function auditBimi(domain) {
  const r = await resolveTxt(`default._bimi.${domain}`);
  if (!r.ok) return unavailable('BIMI', r);
  const raw = (r.records || []).find((t) => /^v=BIMI1\b/i.test(t.trim())) || null;
  if (!raw) {
    return {
      type: 'BIMI', found: false, raw: null, parsed: null, passed: false, resolver: r.resolver,
      // Not a failure. BIMI is optional and needs DMARC enforcement first.
      findings: [{ level: 'ok', message: 'No BIMI record. BIMI is optional; it requires DMARC at quarantine or reject first, and a VMC for most inbox providers.' }],
    };
  }
  const l = /(?:^|;)\s*l=([^;]*)/i.exec(raw);
  const a = /(?:^|;)\s*a=([^;]*)/i.exec(raw);
  const findings = [{ level: 'ok', message: 'BIMI record published.' }];
  if (!a || !a[1].trim()) findings.push({ level: 'warn', message: 'No a= tag, so there is no Verified Mark Certificate. Gmail will not show the logo without one.', remediation: 'Obtain a VMC from a recognised authority.' });
  return { type: 'BIMI', found: true, raw, parsed: { logo: l ? l[1].trim() : '', vmc: a ? a[1].trim() : '' }, passed: true, resolver: r.resolver, findings };
}

/* ── blocklists ───────────────────────────────────────────────────────────── */

const DNSBLS = [
  { zone: 'zen.spamhaus.org', label: 'Spamhaus ZEN' },
  { zone: 'b.barracudacentral.org', label: 'Barracuda' },
  { zone: 'dnsbl.sorbs.net', label: 'SORBS' },
];

/**
 * 127.255.255.x from Spamhaus means "your query was refused" (open resolver,
 * over quota, or a blocked datacentre IP). Treating it as a listing is a false
 * alarm; treating it as clean is the dangerous lie. Both are reported as
 * "not checked", with the reason.
 */
function isRefusalCode(ip) { return /^127\.255\.255\./.test(String(ip)); }

async function checkBlocklists(domain) {
  const a = await resolveA(domain);
  if (!a.records.length) {
    return { checked: false, listed: [], note: `No A record for ${domain}, so there is no IP to look up on a blocklist. Blocklists list IP addresses; a domain with no A record is checked on domain blocklists only, which this does not query.`, ips: [] };
  }

  const ip = a.records[0];
  const reversed = String(ip).split('.').reverse().join('.');
  const listed = [];
  const refused = [];
  const errors = [];

  for (const bl of DNSBLS) {
    const r = await resolveA(`${reversed}.${bl.zone}`);
    if (!r.ok) { errors.push(bl.label); continue; }
    if (!r.records.length) continue;                       // genuinely not listed
    if (r.records.some(isRefusalCode)) { refused.push(bl.label); continue; }
    listed.push({ list: bl.label, zone: bl.zone, code: r.records[0] });
  }

  const usable = DNSBLS.length - refused.length - errors.length;
  return {
    checked: usable > 0,
    ips: [ip],
    listed,
    refused,
    note: refused.length
      ? `${refused.join(', ')} refused the query. Public and datacentre resolvers are blocked by these services, which is normal from a serverless environment: this is NOT a clean result, it is an unavailable one. Check from your own mail server, or use their web lookup.`
      : usable === 0
        ? 'No blocklist could be queried from this environment.'
        : listed.length
          ? `Listed on ${listed.length} of ${usable} blocklists that answered.`
          : `Not listed on ${usable} blocklist(s) that answered.`,
  };
}

/* ── reputation (Postmaster / SNDS) ───────────────────────────────────────── */

/**
 * Both of these need the domain owner to enrol and grant access, so there is
 * nothing to call for a domain this platform has not been authorised on. Said
 * rather than filled with a plausible number.
 */
function reputationStatus(connectionsPresent) {
  const c = connectionsPresent || {};
  return {
    google_postmaster: c.google_postmaster
      ? { connected: true, note: 'Reading domain reputation from Google Postmaster Tools.' }
      : { connected: false, note: 'Not connected. Google Postmaster Tools requires the domain owner to verify the domain in their own account and grant access; this platform cannot read reputation for a domain it has not been authorised on. Verify at postmaster.google.com, then connect it here.' },
    microsoft_snds: c.microsoft_snds
      ? { connected: true, note: 'Reading data from Microsoft SNDS.' }
      : { connected: false, note: 'Not connected. Microsoft SNDS is keyed to the sending IP ranges you register with them, which for a shared ESP belongs to the ESP rather than to you.' },
  };
}

/* ── the score ────────────────────────────────────────────────────────────── */

/**
 * 0-100, and every point is attributable. A score with no breakdown is a
 * number somebody has to trust; this one can be argued with.
 *
 * An UNAVAILABLE check scores neither full nor zero: it is excluded and the
 * maximum drops, so a domain is never punished for this platform's inability to
 * look, and never credited for it either. The returned `max_possible` says how
 * much was actually assessable.
 */
function scoreDomain(records, blocklists) {
  const by = {};
  for (const r of records) by[r.type] = r;
  const breakdown = [];

  const add = (key, points, max, why) => breakdown.push({ key, points, max, why });
  /** An unassessable record scores 0 out of 0, so it moves the score neither way. */
  const skip = (key, rec) => {
    add(key, 0, 0, `Not assessable: ${(rec.findings && rec.findings[0] && rec.findings[0].message) || 'the lookup did not complete'}.`);
    return true;
  };

  const spf = by.SPF || {};
  if (spf.unavailable) skip('spf', spf);
  else {
    add('spf', spf.passed ? (spf.parsed && spf.parsed.all === '-all' ? 25 : 20) : (spf.found ? 8 : 0), 25,
      spf.passed ? (spf.parsed && spf.parsed.all === '-all' ? 'SPF valid and ends -all.' : 'SPF valid, softfail rather than fail.') : (spf.found ? 'SPF published but not valid.' : 'No SPF.'));
  }

  const dkim = by.DKIM || {};
  if (dkim.unavailable) skip('dkim', dkim);
  else add('dkim', dkim.passed ? 25 : 0, 25, dkim.passed ? `${(dkim.parsed && dkim.parsed.selectors || []).filter((s) => !s.revoked).length} live selector(s).` : 'No live DKIM key found at the selectors tried.');

  const dmarc = by.DMARC || {};
  if (dmarc.unavailable) skip('dmarc', dmarc);
  else {
    const dmarcPoints = !dmarc.found ? 0
      : dmarc.parsed.policy === 'reject' ? 30
        : dmarc.parsed.policy === 'quarantine' ? 24
          : 10;
    add('dmarc', dmarcPoints, 30, !dmarc.found ? 'No DMARC.' : `p=${dmarc.parsed.policy}${dmarc.parsed.rua ? ' with reporting' : ', no reporting'}.`);
  }

  const mx = by.MX || {};
  if (mx.unavailable) skip('mx', mx);
  else add('mx', mx.passed ? 10 : 0, 10, mx.passed ? 'MX present.' : 'No MX.');

  // Only counted when it could actually be checked.
  if (blocklists && blocklists.checked) {
    add('blocklist', blocklists.listed.length ? 0 : 10, 10, blocklists.listed.length ? `Listed on ${blocklists.listed.map((l) => l.list).join(', ')}.` : 'Not on the blocklists that answered.');
  } else {
    add('blocklist', 0, 0, `Not assessable: ${blocklists ? blocklists.note : 'no blocklist check ran'}.`);
  }

  const points = breakdown.reduce((s, b) => s + b.points, 0);
  const max = breakdown.reduce((s, b) => s + b.max, 0);
  // 130 is the denominator when everything is assessable. Below that, the score
  // is a percentage of a smaller question and the UI must say so rather than
  // present it as a full audit.
  const FULL_MAX = 100;
  const coverage = Math.round((max / FULL_MAX) * 100);
  const score = max > 0 ? Math.round((points / max) * 100) : null;
  const grade = score == null ? '?' : score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return {
    score,
    grade,
    breakdown,
    points,
    max_possible: max,
    coverage_pct: coverage,
    partial: max < FULL_MAX,
    coverage_note: max === 0
      ? 'Nothing could be checked, so there is no score. This is a lookup failure, not a verdict on the domain.'
      : max < FULL_MAX
        ? `Scored against ${max} of ${FULL_MAX} possible points: some checks could not be completed and were excluded rather than counted as failures.`
        : 'All checks completed.',
  };
}

/** The whole audit for one domain. */
async function auditDomain(domain, { selectors = [], connections: conns = {} } = {}) {
  const d = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) {
    return { ok: false, error: `"${domain}" is not a domain name.` };
  }

  const [spf, dkim, dmarc, mx, bimi] = await Promise.all([
    auditSpf(d), auditDkim(d, selectors), auditDmarc(d), auditMx(d), auditBimi(d),
  ]);
  const records = [spf, dkim, dmarc, mx, bimi];
  const blocklists = await checkBlocklists(d);
  const scored = scoreDomain(records, blocklists);

  return {
    ok: true,
    domain: d,
    records,
    blacklists: blocklists,
    reputation: reputationStatus(conns),
    score: scored.score,
    grade: scored.grade,
    score_breakdown: scored,
    checked_at: new Date().toISOString(),
  };
}

/* ── warmup ───────────────────────────────────────────────────────────────── */

/**
 * A ramp a new domain can survive.
 *
 * The shape is roughly geometric because that is what the receiving side
 * tolerates: a step from 50 to 10,000 in one day looks exactly like a
 * compromised account. Each day is capped at roughly 1.5x the previous, and the
 * early days are deliberately tiny.
 *
 * The COHORT assignment is the part most warmup plans miss. Sending day one's
 * volume to the least engaged contacts is how a warmup fails; the ramp starts
 * with the people most likely to open, because early engagement is the signal
 * being built.
 */
function buildWarmupPlan({ startOn, targetDaily, days = 30 }) {
  const target = Math.max(Number(targetDaily) || 1000, 10);
  const start = startOn ? new Date(startOn) : new Date();
  const plan = [];

  // Build the volume curve first, so the audience widening can be expressed as
  // a fraction of the ramp rather than as fixed day numbers. A ramp to 5,000
  // converges in 13 days and one to 500,000 takes 25; hardcoded day thresholds
  // would leave the fast ramp never widening at all and the slow one widening
  // far too early.
  const caps = [];
  let cap = Math.min(50, Math.floor(target / 20) || 10);
  for (let day = 1; day <= days; day += 1) {
    caps.push(Math.min(cap, target));
    if (cap >= target) break;
    cap = Math.ceil(cap * 1.5);
  }

  const total = caps.length;
  for (let i = 0; i < total; i += 1) {
    const day = i + 1;
    const progress = total === 1 ? 1 : day / total;
    // Warmup NEVER widens past the 60-day engaged tier. Adding lapsed contacts
    // to a ramp is the single most common way a warmup fails: the volume looks
    // right and the engagement rate collapses, which is precisely the signal
    // the ramp is trying to build. Re-engaging the slipping tier is a separate
    // campaign, run after the domain has a reputation to spend.
    const tier = progress <= 0.35 ? 'champions' : progress <= 0.7 ? 'engaged_30' : 'engaged_60';
    plan.push({
      day,
      date: new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10),
      cap: caps[i],
      cohort_tier: tier,
      why: tier === 'champions'
        ? 'Openers only. Early engagement is the signal the ramp exists to build.'
        : tier === 'engaged_30'
          ? 'Widening to contacts who opened in the last 30 days.'
          : 'Widening to 60-day engagement, which is as far as a warmup should reach. Lapsed contacts belong in a re-engagement campaign, not in a ramp.',
    });
  }
  return plan;
}

/**
 * The safety throttle. Bounce over 2% or complaints over 0.08% and the ramp
 * pauses: those are not arbitrary numbers, they are close to where the major
 * inbox providers start filtering, and Google's published bulk-sender guidance
 * puts the spam-rate line at 0.30% with 0.10% as the level to stay under.
 * This uses the tighter 0.08% so a pause happens BEFORE the damage.
 */
function evaluateWarmupSafety(stats, limits) {
  const s = stats || {};
  const l = Object.assign({ bounce: 0.02, complaint: 0.0008 }, limits || {});
  const sent = Number(s.sent || 0);
  if (sent < 100) {
    return { verdict: 'insufficient_data', pause: false, note: `Only ${sent} messages measured. Rates on a sample this small are noise, so no ramp decision is made from them.` };
  }
  const bounce = Number(s.bounced || 0) / sent;
  const complaint = Number(s.complained || 0) / sent;
  const reasons = [];
  if (bounce > l.bounce) reasons.push(`Bounce rate ${(bounce * 100).toFixed(2)}% is over the ${(l.bounce * 100).toFixed(2)}% limit.`);
  if (complaint > l.complaint) reasons.push(`Complaint rate ${(complaint * 100).toFixed(3)}% is over the ${(l.complaint * 100).toFixed(3)}% limit.`);

  return {
    verdict: reasons.length ? 'pause' : 'continue',
    pause: reasons.length > 0,
    bounce_rate: bounce,
    complaint_rate: complaint,
    reasons,
    note: reasons.length
      ? `${reasons.join(' ')} The ramp is paused. Clean the list before resuming: continuing at this rate damages the domain for months, and reputation recovers far more slowly than it degrades.`
      : `Bounce ${(bounce * 100).toFixed(2)}%, complaints ${(complaint * 100).toFixed(3)}%. Both inside limits.`,
  };
}

/* ── content spam analysis ────────────────────────────────────────────────── */

/**
 * Heuristics only, deliberately. A "spam score" that claims to predict
 * SpamAssassin without running it is a made-up number, so this reports SIGNALS
 * with weights and says what it did not check.
 */
const TRIGGER_PHRASES = [
  { rx: /\b(free|100% free)\b.{0,20}\b(money|cash|gift|trial)\b/i, w: 3, why: 'free + money pairing' },
  { rx: /\bact now\b|\blimited time\b|\bhurry\b|\bdon'?t miss out\b|\blast chance\b/i, w: 2, why: 'false urgency' },
  { rx: /\bguarantee(d)?\b.{0,20}\b(income|results|weight|money)\b/i, w: 3, why: 'guaranteed outcome' },
  { rx: /\bno (credit check|obligation|catch)\b/i, w: 2, why: 'classic filter phrase' },
  { rx: /\b(viagra|casino|crypto|forex|bitcoin)\b/i, w: 4, why: 'high-risk vertical' },
  { rx: /\bclick here\b/i, w: 1, why: 'generic anchor text' },
  { rx: /\$\$\$|!!!|\?\?\?/, w: 2, why: 'repeated punctuation' },
  { rx: /\bwinner\b|\bcongratulations\b.{0,20}\b(won|selected)\b/i, w: 3, why: 'prize language' },
];

function analyzeContent({ subject = '', html = '', text = '', fromDomain = '', recentSubjects = [] } = {}) {
  const signals = [];
  const body = String(html || text || '');
  const plain = body.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  for (const t of TRIGGER_PHRASES) {
    if (t.rx.test(subject) || t.rx.test(plain)) signals.push({ weight: t.w, signal: t.why, where: t.rx.test(subject) ? 'subject' : 'body' });
  }

  // ALL CAPS subject
  const letters = subject.replace(/[^A-Za-z]/g, '');
  if (letters.length > 6 && letters === letters.toUpperCase()) signals.push({ weight: 2, signal: 'Subject is entirely capitals.', where: 'subject' });
  if (subject.length > 70) signals.push({ weight: 1, signal: `Subject is ${subject.length} characters; most clients truncate near 50.`, where: 'subject' });
  if (!subject.trim()) signals.push({ weight: 4, signal: 'No subject line.', where: 'subject' });

  // Image-to-text ratio. An image-only email is the oldest filter evasion there
  // is, and filters still treat it as one.
  const images = (body.match(/<img\b/gi) || []).length;
  const words = plain ? plain.split(/\s+/).length : 0;
  if (images > 0 && words < 30) signals.push({ weight: 4, signal: `${images} image(s) and only ${words} words of text. An image-only email is a strong spam signal and is unreadable when images are blocked, which is the default in several clients.`, where: 'body' });
  else if (images > 0 && words < 100) signals.push({ weight: 1, signal: `Low text-to-image ratio (${words} words, ${images} images).`, where: 'body' });

  // Missing unsubscribe. This is a legal exposure, not a taste question.
  const hasUnsub = /unsubscribe|list-unsubscribe|opt.?out|{{\s*unsubscribe/i.test(body);
  if (!hasUnsub) signals.push({ weight: 5, signal: 'No unsubscribe link found. Required by CAN-SPAM, by the GDPR in practice, and by Google and Yahoo bulk sender rules, which also require one-click List-Unsubscribe headers.', where: 'body' });

  // Links: bare IPs, shorteners, and mismatched anchor text.
  const links = [...body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const shorteners = links.filter((h) => /(^|\/\/)(bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly)/i.test(h));
  if (shorteners.length) signals.push({ weight: 3, signal: `${shorteners.length} shortened link(s). Filters cannot see the destination and score them accordingly.`, where: 'links' });
  const ipLinks = links.filter((h) => /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(h));
  if (ipLinks.length) signals.push({ weight: 4, signal: 'A link points at a bare IP address.', where: 'links' });
  const insecure = links.filter((h) => /^http:\/\//i.test(h));
  if (insecure.length) signals.push({ weight: 1, signal: `${insecure.length} link(s) use http rather than https.`, where: 'links' });

  // Link domain alignment: links that all point somewhere unrelated to the
  // sending domain read as a hijacked template.
  if (fromDomain && links.length) {
    const root = String(fromDomain).split('.').slice(-2).join('.');
    const offDomain = links.filter((h) => /^https?:\/\//i.test(h) && !h.includes(root));
    if (links.length >= 3 && offDomain.length === links.length) {
      signals.push({ weight: 2, signal: `Every link points away from ${root}. Filters expect at least some alignment between the sending domain and the destinations.`, where: 'links' });
    }
  }

  // Subject fatigue: the same angle again and again trains people to ignore it.
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z ]/g, '').trim();
  const repeats = (recentSubjects || []).filter((s) => norm(s) === norm(subject)).length;
  if (repeats > 0) signals.push({ weight: 2, signal: `This exact subject was used ${repeats} time(s) recently.`, where: 'subject' });

  const score = signals.reduce((s, x) => s + x.weight, 0);
  return {
    score,
    // Bands, not a fake SpamAssassin number.
    band: score >= 10 ? 'high' : score >= 5 ? 'medium' : score > 0 ? 'low' : 'clean',
    signals: signals.sort((a, b) => b.weight - a.weight),
    has_unsubscribe: hasUnsub,
    words,
    images,
    links: links.length,
    not_checked: [
      'The actual SpamAssassin ruleset was not run: it is not available in this runtime, and a number that pretends to be one would be invented.',
      'Inbox placement was not tested. That needs seed-list delivery to real mailboxes at each provider.',
      'Image content was not analysed, only counted.',
    ],
  };
}

module.exports = {
  auditDomain, auditSpf, auditDkim, auditDmarc, auditMx, auditBimi,
  checkBlocklists, reputationStatus, scoreDomain,
  buildWarmupPlan, evaluateWarmupSafety,
  analyzeContent,
  // seams
  resolveTxt, resolveMx, resolveA, countSpfLookups, isRefusalCode, DNSBLS, COMMON_SELECTORS,
};
