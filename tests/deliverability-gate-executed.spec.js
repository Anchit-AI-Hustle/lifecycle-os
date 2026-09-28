// The deliverability gate, EXECUTED: real DNS parsing over a controllable
// resolver, and the preflight verdicts that come out of it.
//
// api/_shared/deliverability-core.js and preflight-core.js run unmodified.
// `require('dns').promises` is the module's only resolver seam, so its three
// methods are replaced with a zone table the test controls (records, errors
// with an error CODE, and a per-name failure count so a retry can succeed);
// DNS-over-HTTPS is global.fetch, which throws unless a case routes it. What
// the spec measures is the VERDICT and the numbers behind it, never a call
// having been made.
//
// The three lies this domain invites, each pinned by executing the path:
//
//   - "not listed"  when Spamhaus REFUSED the query (127.255.255.x): reported
//                   as refused, never as a listing and never as clean;
//   - "score 0/F"   when the lookup TIMED OUT: the record is `unavailable`,
//                   excluded from the denominator, and the gate WARNS - it
//                   neither passes what it could not see nor fails a domain
//                   for our network (the mutation that turns that warn into a
//                   pass fails here);
//   - "send at 10"  with no open history: no hour is recommended.
//
// Plus the parsing that decides delivery: SPF's ten-lookup limit and its
// `all` mechanism, DKIM key size and revocation, DMARC policy and coverage,
// the DoH fallback and which resolver answered, and the warmup cap and pause.
//
// Run: npx playwright test tests/deliverability-gate-executed.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const deliver = require(path.join(ROOT, 'api', '_shared', 'deliverability-core.js'));
const preflight = require(path.join(ROOT, 'api', '_shared', 'preflight-core.js'));
const cohorts = require(path.join(ROOT, 'api', '_shared', 'cohort-engine.js'));

/* ── the resolver ───────────────────────────────────────────────────────── */

const dnsPromises = require('dns').promises;
const REAL = { resolveTxt: dnsPromises.resolveTxt, resolveMx: dnsPromises.resolveMx, resolve4: dnsPromises.resolve4 };
const ZONE = { records: {}, errors: {}, calls: [] };

function dnsError(code, name) { const e = new Error(`query${code} ${name}`); e.code = code; return e; }
function stubbed(kind) {
  return async (name) => {
    ZONE.calls.push({ kind, name });
    const err = ZONE.errors[name] || ZONE.errors['*'];
    if (err && (!err.kind || err.kind === kind) && (err.times == null || err.times > 0)) {
      if (err.times != null) err.times -= 1;
      throw dnsError(err.code, name);
    }
    const rec = ZONE.records[name] && ZONE.records[name][kind];
    if (!rec) throw dnsError('ENOTFOUND', name);
    return rec;
  };
}
function zone(records, errors) { ZONE.records = records || {}; ZONE.errors = errors || {}; ZONE.calls = []; }
const lookups = (kind, name) => ZONE.calls.filter((c) => c.kind === kind && c.name === name).length;

let DOH = [];                              // [{ test(url), handler(url) -> body | Response }]
const doh = (t, h) => DOH.push({ test: t, handler: h });
let REAL_FETCH;

test.beforeAll(() => {
  REAL_FETCH = global.fetch;
  dnsPromises.resolveTxt = stubbed('TXT');
  dnsPromises.resolveMx = stubbed('MX');
  dnsPromises.resolve4 = stubbed('A');
  global.fetch = async (url) => {
    const r = DOH.find((x) => x.test(String(url)));
    if (!r) throw new Error(`unrouted network call escaped the resolver: ${url}`);
    const out = await r.handler(String(url));
    if (out && typeof out.json === 'function') return out;
    return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) };
  };
});
test.afterAll(() => {
  dnsPromises.resolveTxt = REAL.resolveTxt;
  dnsPromises.resolveMx = REAL.resolveMx;
  dnsPromises.resolve4 = REAL.resolve4;
  global.fetch = REAL_FETCH;
});
test.beforeEach(() => { zone({}, {}); DOH = []; });

/* ── fixtures ───────────────────────────────────────────────────────────── */

const D = 'brand.example.test';
const KEY_2048 = 'M'.repeat(392);
const KEY_1024 = 'M'.repeat(216);

/** SPF, a 2048-bit DKIM key at Klaviyo's selector, DMARC at reject, MX, an A record. */
function healthyZone() {
  return {
    [D]: { TXT: [['v=spf1 include:_spf.esp.example.test -all']], MX: [{ priority: 10, exchange: 'mx1.example.test' }], A: ['203.0.113.10'] },
    '_spf.esp.example.test': { TXT: [['v=spf1 ip4:203.0.113.0/24 -all']] },
    // A key over 255 bytes arrives in chunks, which the resolver must join.
    [`klaviyo._domainkey.${D}`]: { TXT: [['v=DKIM1; k=rsa; p=' + KEY_2048.slice(0, 200), KEY_2048.slice(200)]] },
    [`_dmarc.${D}`]: { TXT: [['v=DMARC1; p=reject; rua=mailto:dmarc@brand.example.test; aspf=s']] },
  };
}

const CONN = { oauth_scopes: ['campaigns:write', 'templates:write'], config: { publishing_enabled: true }, secret_fields: ['access_token'], status: 'active' };
const CLEAN_HTML = '<p>' + 'word '.repeat(120) + '</p><a href="https://brand.example.test/u">Unsubscribe</a>';
function gate(extra) {
  return preflight.run(Object.assign({
    provider: 'klaviyo', channel: 'klaviyo_email', mode: 'publish', connection: CONN,
    payload: { subject: 'New drop', html: CLEAN_HTML }, mapping_missing: [], sending_domain: D,
  }, extra || {}));
}
const checkOf = (out, id) => out.checks.find((c) => c.id === id);

/* ── 1. a healthy domain ────────────────────────────────────────────────── */

test('a fully authenticated domain scores 100 from parsed records, and the preflight passes the sending domain', async () => {
  zone(healthyZone());
  const health = await deliver.auditDomain(D, { selectors: [] });
  expect(health.ok).toBe(true);
  expect(health.domain).toBe(D);
  expect(health.records.map((r) => r.type)).toEqual(['SPF', 'DKIM', 'DMARC', 'MX', 'BIMI']);
  const [spf, dkim, dmarc, mx, bimi] = health.records;

  expect(spf).toMatchObject({ found: true, passed: true, resolver: 'system' });
  expect(spf.parsed).toMatchObject({ lookups: 1, lookups_truncated: false, all: '-all', records: 1, includes: ['_spf.esp.example.test'] });
  expect(dkim).toMatchObject({ found: true, passed: true });
  expect(dkim.parsed.selectors).toEqual([expect.objectContaining({ selector: 'klaviyo', source: 'Klaviyo', revoked: false, key_bits_estimate: 2048 })]);
  expect(dkim.parsed.tried).toEqual(deliver.COMMON_SELECTORS.map((s) => s.s));
  expect(dmarc).toMatchObject({ found: true, passed: true });
  expect(dmarc.parsed).toMatchObject({ policy: 'reject', pct: 100, rua: 'mailto:dmarc@brand.example.test', aspf: 's', adkim: 'r' });
  expect(dmarc.findings.some((f) => /Strict alignment/.test(f.message))).toBe(true);
  expect(mx).toMatchObject({ found: true, passed: true, parsed: { hosts: ['10 mx1.example.test'] } });
  expect(bimi).toMatchObject({ found: false, passed: false });
  expect(bimi.findings[0].level).toBe('ok');                 // optional, never a failure

  expect(health.blacklists).toMatchObject({ checked: true, ips: ['203.0.113.10'], listed: [], refused: [] });
  expect(health.blacklists.note).toMatch(/Not listed on 3 blocklist/);
  expect(health.reputation.google_postmaster.connected).toBe(false);
  expect(health.reputation.microsoft_snds.connected).toBe(false);
  expect(health).toMatchObject({ score: 100, grade: 'A' });
  expect(health.score_breakdown).toMatchObject({ points: 100, max_possible: 100, coverage_pct: 100, partial: false, coverage_note: 'All checks completed.' });

  const out = await gate();
  expect(checkOf(out, 'domain_auth')).toMatchObject({ status: 'pass', detail: `${D} scores 100/100 (A).` });
  expect(checkOf(out, 'blocklist')).toBeUndefined();
  expect(out.verdict, 'no audience data: warned, not passed and not blocked').toBe('warn');
  expect(checkOf(out, 'segment_health').status).toBe('warn');

  // A cached audit is used as supplied rather than re-resolved.
  const before = ZONE.calls.length;
  const again = await gate({ domain_health: health });
  expect(checkOf(again, 'domain_auth').status).toBe('pass');
  expect(ZONE.calls.length).toBe(before);

  // Both reputation sources connected, reported as such.
  expect(deliver.reputationStatus({ google_postmaster: true, microsoft_snds: true })).toMatchObject({ google_postmaster: { connected: true }, microsoft_snds: { connected: true } });
});

/* ── 2. lookups that could not complete ─────────────────────────────────── */

test('every lookup timing out is unavailable, excluded from the denominator, and the gate warns rather than passes or fails', async () => {
  zone({}, { '*': { code: 'ETIMEOUT' } });
  const health = await deliver.auditDomain(D);
  expect(health.ok).toBe(true);
  for (const r of health.records) {
    expect(r.unavailable, r.type).toBe(true);
    expect(r.passed, r.type).toBeNull();
    expect(r.found, r.type).toBeNull();
    expect(r.findings[0].level, r.type).toBe('warn');
    expect(r.findings[0].message, r.type).toMatch(/says nothing about the record/);
  }
  expect(health.records[0].findings[0].message).toMatch(/SPF/);
  expect(health.records[1].findings[0].message).toMatch(/all 10 selector lookups failed/);
  expect(health.score).toBeNull();
  expect(health.grade).toBe('?');
  expect(health.score_breakdown).toMatchObject({ points: 0, max_possible: 0, partial: true });
  expect(health.score_breakdown.coverage_note).toMatch(/lookup failure, not a verdict/);
  expect(health.score_breakdown.breakdown.every((b) => b.max === 0 && /Not assessable/.test(b.why))).toBe(true);
  expect(health.blacklists.checked).toBe(false);
  // A transient code is retried once before it is given up on: two system
  // attempts per name, then DoH (which is unreachable here).
  expect(lookups('TXT', `_dmarc.${D}`)).toBe(2);

  const out = await gate();
  const domain = checkOf(out, 'domain_auth');
  expect(domain.status).toBe('warn');
  expect(domain.detail).toMatch(/lookup failure, not a verdict/);
  expect(checkOf(out, 'blocklist').status).toBe('warn');
  expect(out.verdict).toBe('warn');
  expect(out.checks.filter((c) => c.status === 'pass').map((c) => c.id)).not.toContain('domain_auth');
  expect(out.blocking).toEqual([]);
});

test('one transient failure is retried and answered by the system resolver; a partial audit is scored against what it could check and the gate says so', async () => {
  zone(healthyZone(), { [D]: { code: 'ETIMEOUT', kind: 'TXT', times: 1 }, [`_dmarc.${D}`]: { code: 'ESERVFAIL' } });
  const health = await deliver.auditDomain(D);
  const [spf, , dmarc] = health.records;
  expect(spf).toMatchObject({ found: true, passed: true, resolver: 'system' });
  expect(lookups('TXT', D)).toBe(2);
  expect(dmarc.unavailable).toBe(true);
  expect(health.score, 'perfect on everything that could be checked').toBe(100);
  expect(health.score_breakdown).toMatchObject({ partial: true, max_possible: 70, coverage_pct: 70 });
  expect(health.score_breakdown.coverage_note).toMatch(/70 of 100 possible points/);

  const out = await gate();
  expect(checkOf(out, 'domain_auth')).toMatchObject({ status: 'warn' });
  expect(checkOf(out, 'domain_auth').detail).toMatch(/70% of checks that completed/);
  expect(checkOf(out, 'domain_auth').remediation).toMatch(/Re-run the check/);
  expect(out.verdict).toBe('warn');
});

/* ── 3. blocklists ──────────────────────────────────────────────────────── */

test('a Spamhaus refusal is reported as refused, never as a listing and never as clean; a genuine listing blocks', async () => {
  const rev = '10.113.0.203';
  const refused = healthyZone();
  refused[`${rev}.zen.spamhaus.org`] = { A: ['127.255.255.254'] };
  zone(refused);
  let health = await deliver.auditDomain(D);
  expect(health.blacklists).toMatchObject({ checked: true, listed: [], refused: ['Spamhaus ZEN'] });
  expect(health.blacklists.note).toMatch(/refused the query/);
  expect(health.blacklists.note).toMatch(/NOT a clean result/);
  expect(health.score_breakdown.breakdown.find((b) => b.key === 'blocklist')).toMatchObject({ points: 10, max: 10 });
  let out = await gate();
  expect(out.verdict).not.toBe('block');
  expect(out.blocking).toEqual([]);

  // Every list refuses: nothing was checked, and the gate says so rather than passing.
  const allRefused = healthyZone();
  for (const bl of deliver.DNSBLS) allRefused[`${rev}.${bl.zone}`] = { A: ['127.255.255.252'] };
  zone(allRefused);
  health = await deliver.auditDomain(D);
  expect(health.blacklists).toMatchObject({ checked: false, listed: [] });
  expect(health.blacklists.refused).toEqual(deliver.DNSBLS.map((b) => b.label));
  expect(health.score_breakdown.breakdown.find((b) => b.key === 'blocklist')).toMatchObject({ points: 0, max: 0 });
  expect(health.score_breakdown.partial).toBe(true);
  out = await gate();
  expect(checkOf(out, 'blocklist')).toMatchObject({ status: 'warn' });
  expect(checkOf(out, 'blocklist').detail).toMatch(/refused the query/);
  expect(out.verdict).toBe('warn');

  // A real listing code is a listing, and it blocks.
  const listed = healthyZone();
  listed[`${rev}.dnsbl.sorbs.net`] = { A: ['127.0.0.2'] };
  zone(listed);
  health = await deliver.auditDomain(D);
  expect(health.blacklists.listed).toEqual([{ list: 'SORBS', zone: 'dnsbl.sorbs.net', code: '127.0.0.2' }]);
  expect(health.blacklists.note).toBe('Listed on 1 of 3 blocklists that answered.');
  expect(health.score).toBeLessThan(100);
  out = await gate();
  expect(checkOf(out, 'blocklist')).toMatchObject({ status: 'block' });
  expect(out.verdict).toBe('block');
  expect(out.blocking.join(' ')).toMatch(/Listed on SORBS/);

  // A list that could not be queried at all is neither refused nor listed.
  const broken = healthyZone();
  zone(broken, { [`${rev}.b.barracudacentral.org`]: { code: 'ETIMEOUT' } });
  health = await deliver.auditDomain(D);
  expect(health.blacklists).toMatchObject({ checked: true, listed: [], refused: [] });
  expect(health.blacklists.note).toBe('Not listed on 2 blocklist(s) that answered.');
});

/* ── 4. DNS-over-HTTPS ──────────────────────────────────────────────────── */

test('the DoH fallback answers when the system resolver cannot, records which resolver answered, and NXDOMAIN there is a fact about the domain', async () => {
  zone(healthyZone(), { [`_dmarc.${D}`]: { code: 'ESERVFAIL' } });
  doh((u) => u.startsWith('https://cloudflare-dns.com/dns-query?name=_dmarc.brand.example.test&type=TXT'),
    () => ({ Status: 0, Answer: [{ data: '"v=DMARC1; p=quarantine; rua=mailto:a@b.example.test"' }] }));
  let dmarc = await deliver.auditDmarc(D);
  expect(dmarc).toMatchObject({ found: true, passed: true, resolver: 'doh:cloudflare' });
  expect(dmarc.parsed.policy).toBe('quarantine');

  // Cloudflare fails, Google says NXDOMAIN: no record, from a resolver that answered.
  DOH = [];
  doh((u) => u.includes('cloudflare-dns.com'), () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' }));
  doh((u) => u.startsWith('https://dns.google/resolve?name=_dmarc.brand.example.test&type=TXT'), () => ({ Status: 3 }));
  dmarc = await deliver.auditDmarc(D);
  expect(dmarc).toMatchObject({ found: false, passed: false, resolver: 'doh:google' });
  const out = await gate();
  expect(checkOf(out, 'domain_auth')).toMatchObject({ status: 'block' });
  expect(checkOf(out, 'domain_auth').detail).toMatch(/fails DMARC/);
  expect(out.verdict).toBe('block');

  // Chunked TXT arrives quoted and space-joined over DoH, and is reassembled.
  DOH = [];
  zone({}, { [`s1._domainkey.${D}`]: { code: 'ESERVFAIL' } });
  doh((u) => u.includes('cloudflare-dns.com') && u.includes('s1._domainkey'), () => ({ Status: 0, Answer: [{ data: '"v=DKIM1; k=rsa; p=' + KEY_2048.slice(0, 100) + '" "' + KEY_2048.slice(100) + '"' }] }));
  const dkim = await deliver.auditDkim(D, ['s1']);
  expect(dkim).toMatchObject({ found: true, passed: true, resolver: 'doh:cloudflare' });
  expect(dkim.parsed.selectors[0]).toMatchObject({ selector: 's1', source: 'configured', key_bits_estimate: 2048 });

  // A DoH status that is neither an answer nor NXDOMAIN is not an answer.
  DOH = [];
  zone({}, { [`_dmarc.${D}`]: { code: 'ESERVFAIL' } });
  doh((u) => u.includes('cloudflare-dns.com'), () => ({ Status: 2 }));
  doh((u) => u.includes('dns.google'), () => ({ Status: 5 }));
  expect((await deliver.auditDmarc(D)).unavailable).toBe(true);
});

/* ── 5. SPF ─────────────────────────────────────────────────────────────── */

test('SPF is judged on what decides delivery: the all mechanism, a single record, and the ten-lookup limit counted through includes', async () => {
  const cases = [
    { txt: ['v=spf1 include:_spf.esp.example.test +all'], passed: false, level: 'fail', msg: /\+all authorises the entire internet/, all: '+all' },
    { txt: ['v=spf1 ip4:203.0.113.1'], passed: false, level: 'warn', msg: /No "all" mechanism/, all: '' },
    { txt: ['v=spf1 ip4:203.0.113.1 ?all'], passed: true, level: 'warn', msg: /\?all is neutral/, all: '?all' },
    { txt: ['v=spf1 ip4:203.0.113.1 ~all'], passed: true, level: 'ok', msg: /softfail/, all: '~all' },
    { txt: ['v=spf1 ip4:203.0.113.1 -all', 'v=spf1 include:other.example.test -all'], passed: false, level: 'fail', msg: /2 SPF records published/, all: '-all' },
  ];
  for (const c of cases) {
    zone({ [D]: { TXT: c.txt.map((t) => [t]) }, '_spf.esp.example.test': { TXT: [['v=spf1 ip4:203.0.113.0/24 -all']] } });
    const spf = await deliver.auditSpf(D);
    expect(spf.passed, c.txt.join(' | ')).toBe(c.passed);
    expect(spf.parsed.all, c.txt.join(' | ')).toBe(c.all);
    expect(spf.findings.some((f) => f.level === c.level && c.msg.test(f.message)), c.txt.join(' | ')).toBe(true);
  }

  // Eleven lookups, counted through nested includes, is a permerror; nine warns.
  const many = (n) => {
    const recs = { [D]: { TXT: [['v=spf1 ' + Array.from({ length: n }, (_, i) => `include:i${i}.example.test`).join(' ') + ' -all']] } };
    for (let i = 0; i < n; i += 1) recs[`i${i}.example.test`] = { TXT: [['v=spf1 ip4:203.0.113.0/24 -all']] };
    return recs;
  };
  zone(many(11));
  let spf = await deliver.auditSpf(D);
  expect(spf.parsed.lookups).toBe(11);
  expect(spf.passed).toBe(false);
  expect(spf.findings.some((f) => f.level === 'fail' && /needs 11 DNS lookups/.test(f.message))).toBe(true);
  zone(many(9));
  spf = await deliver.auditSpf(D);
  expect(spf.parsed.lookups).toBe(9);
  expect(spf.passed).toBe(true);
  expect(spf.findings.some((f) => f.level === 'warn' && /9 of the 10 permitted/.test(f.message))).toBe(true);

  // A nested chain counts its children; a chain deeper than the checker follows is a lower bound, said so.
  const chain = { [D]: { TXT: [['v=spf1 include:c0.example.test -all']] } };
  for (let i = 0; i < 7; i += 1) chain[`c${i}.example.test`] = { TXT: [[`v=spf1 a include:c${i + 1}.example.test -all`]] };
  chain['c7.example.test'] = { TXT: [['v=spf1 -all']] };
  zone(chain);
  spf = await deliver.auditSpf(D);
  expect(spf.parsed.lookups_truncated).toBe(true);
  expect(spf.findings.some((f) => /lower bound/.test(f.message))).toBe(true);
  expect(spf.parsed.lookups).toBeGreaterThanOrEqual(6);

  zone({ [D]: { TXT: [['some other txt']] } });
  spf = await deliver.auditSpf(D);
  expect(spf).toMatchObject({ found: false, passed: false });
  expect(spf.findings[0]).toMatchObject({ level: 'fail', message: 'No SPF record.' });
});

/* ── 6. DKIM ────────────────────────────────────────────────────────────── */

test('DKIM: configured selectors are the ones tried, a revoked key and a 1024-bit key warn, absence is not proof, and one failed lookup is admitted', async () => {
  zone({
    [`s1._domainkey.${D}`]: { TXT: [['v=DKIM1; k=rsa; p=']] },
    [`custom._domainkey.${D}`]: { TXT: [['k=rsa; p=' + KEY_1024]] },
  });
  let dkim = await deliver.auditDkim(D, ['s1', 'custom']);
  expect(dkim.parsed.tried).toEqual(['s1', 'custom']);
  expect(dkim.parsed.selectors).toEqual([
    expect.objectContaining({ selector: 's1', source: 'configured', revoked: true, key_bits_estimate: 0 }),
    expect.objectContaining({ selector: 'custom', source: 'configured', revoked: false, key_bits_estimate: 1024 }),
  ]);
  expect(dkim.passed).toBe(true);
  expect(dkim.findings.some((f) => f.level === 'warn' && /revoked key/.test(f.message))).toBe(true);
  expect(dkim.findings.some((f) => f.level === 'warn' && /1024-bit/.test(f.message))).toBe(true);
  expect(dkim.findings.some((f) => f.level === 'ok' && /1 live DKIM selector/.test(f.message))).toBe(true);
  expect(lookups('TXT', `klaviyo._domainkey.${D}`), 'the defaults are not tried when selectors are given').toBe(0);

  zone({});
  dkim = await deliver.auditDkim(D, []);
  expect(dkim).toMatchObject({ found: false, passed: false });
  expect(dkim.findings[0]).toMatchObject({ level: 'fail' });
  expect(dkim.findings[0].message).toMatch(/any of 10 selectors/);
  expect(dkim.findings[0].remediation).toMatch(/cannot be enumerated/);

  zone({ [`s1._domainkey.${D}`]: { TXT: [['v=DKIM1; p=' + KEY_2048]] } }, { [`custom._domainkey.${D}`]: { code: 'ETIMEOUT' } });
  dkim = await deliver.auditDkim(D, ['s1', 'custom']);
  expect(dkim.passed).toBe(true);
  expect(dkim.findings.some((f) => f.level === 'warn' && /1 of 2 selector lookups did not complete/.test(f.message))).toBe(true);
});

/* ── 7. DMARC, MX, BIMI ─────────────────────────────────────────────────── */

test('DMARC: p=none satisfies the rule and protects nobody, partial pct and sp=none and no rua each warn, and an unknown policy fails', async () => {
  zone({ [`_dmarc.${D}`]: { TXT: [['v=DMARC1; p=none; rua=mailto:x@y.example.test']] } });
  let dmarc = await deliver.auditDmarc(D);
  expect(dmarc).toMatchObject({ found: true, passed: false });
  expect(dmarc.findings[0]).toMatchObject({ level: 'warn' });
  expect(dmarc.findings[0].message).toMatch(/stops nobody from spoofing/);

  zone({ [`_dmarc.${D}`]: { TXT: [['v=DMARC1; p=quarantine; pct=50; sp=none']] } });
  dmarc = await deliver.auditDmarc(D);
  expect(dmarc.passed).toBe(true);
  expect(dmarc.parsed).toMatchObject({ policy: 'quarantine', pct: 50, sp: 'none', rua: '' });
  const msgs = dmarc.findings.map((f) => f.message).join(' ');
  expect(msgs).toMatch(/pct=50, so the policy applies to only 50%/);
  expect(msgs).toMatch(/No rua address/);
  expect(msgs).toMatch(/sp=none leaves every subdomain unprotected/);

  zone({ [`_dmarc.${D}`]: { TXT: [['v=DMARC1; p=bogus']] } });
  dmarc = await deliver.auditDmarc(D);
  expect(dmarc.passed).toBe(false);
  expect(dmarc.findings.some((f) => f.level === 'fail' && /Unrecognised policy "bogus"/.test(f.message))).toBe(true);

  zone({});
  dmarc = await deliver.auditDmarc(D);
  expect(dmarc).toMatchObject({ found: false, passed: false });
  expect(dmarc.findings[0].message).toMatch(/Since 2024 both Google and Yahoo require one/);
});

test('MX absence warns and BIMI is optional, with the VMC named as what Gmail needs', async () => {
  zone({});
  const mx = await deliver.auditMx(D);
  expect(mx).toMatchObject({ found: false, passed: false, raw: null });
  expect(mx.findings[0]).toMatchObject({ level: 'warn' });
  expect(mx.findings[0].message).toMatch(/cannot receive mail/);

  zone({ [`default._bimi.${D}`]: { TXT: [['v=BIMI1; l=https://brand.example.test/logo.svg;']] } });
  let bimi = await deliver.auditBimi(D);
  expect(bimi).toMatchObject({ found: true, passed: true, parsed: { logo: 'https://brand.example.test/logo.svg', vmc: '' } });
  expect(bimi.findings.some((f) => f.level === 'warn' && /Verified Mark Certificate/.test(f.message))).toBe(true);

  zone({ [`default._bimi.${D}`]: { TXT: [['v=BIMI1; l=https://brand.example.test/logo.svg; a=https://brand.example.test/vmc.pem']] } });
  bimi = await deliver.auditBimi(D);
  expect(bimi.parsed.vmc).toBe('https://brand.example.test/vmc.pem');
  expect(bimi.findings.every((f) => f.level === 'ok')).toBe(true);
});

/* ── 8. the input ───────────────────────────────────────────────────────── */

test('a domain is normalised before it is looked up, and something that is not a domain is refused before any lookup', async () => {
  const bad = await deliver.auditDomain('not a domain');
  expect(bad).toMatchObject({ ok: false });
  expect(bad.error).toMatch(/is not a domain name/);
  expect(ZONE.calls).toHaveLength(0);
  expect((await deliver.auditDomain('')).ok).toBe(false);

  zone(healthyZone());
  const ok = await deliver.auditDomain('HTTPS://Brand.Example.Test/some/path');
  expect(ok.domain).toBe(D);
  expect(ok.score).toBe(100);

  // Through the gate, a bad domain is a warn with the reason, never a pass.
  const out = await gate({ sending_domain: 'nope' });
  expect(checkOf(out, 'domain_auth')).toMatchObject({ status: 'warn' });
  expect(checkOf(out, 'domain_auth').detail).toMatch(/is not a domain name/);
});

/* ── 9. the rest of the gate ────────────────────────────────────────────── */

test('the warmup cap blocks a send that exceeds today\'s ramp, and passes one inside it', async () => {
  zone(healthyZone());
  const today = new Date().toISOString().slice(0, 10);
  const warmup = { status: 'active', plan: [{ date: today, cap: 100 }] };
  let out = await gate({ warmup, audience_size: 500 });
  expect(checkOf(out, 'warmup')).toMatchObject({ status: 'block' });
  expect(checkOf(out, 'warmup').detail).toMatch(/500 recipients and today's warmup cap is 100/);
  expect(out.verdict).toBe('block');
  out = await gate({ warmup, segment: { size: 50 } });
  expect(checkOf(out, 'warmup')).toMatchObject({ status: 'pass', detail: "50 recipients, inside today's cap of 100." });
  out = await gate({ warmup: { status: 'active', plan: [] }, audience_size: 5000 });
  expect(checkOf(out, 'warmup')).toMatchObject({ status: 'pass', detail: 'Warmup active; no cap for today.' });
});

test('segment health, the frequency cap and the sunset share come from the audience the gate is handed; a non-email channel skips the domain entirely', async () => {
  zone(healthyZone());
  const NOW = Date.now();
  const ago = (d) => new Date(NOW - d * 86400000).toISOString();
  const contacts = [];
  for (let i = 0; i < 40; i += 1) contacts.push({ external_profile_id: 'hot' + i, last_open_at: ago(3), orders_count: 5, total_spend: 300, sends_7d: i < 20 ? 3 : 0 });
  for (let i = 0; i < 15; i += 1) contacts.push({ external_profile_id: 'cold' + i, last_open_at: ago(400), orders_count: 1, total_spend: 20, sends_7d: 0, sends_30d: 12 });
  const out = await gate({ contacts });
  expect(checkOf(out, 'segment_health').detail).toMatch(/55 contacts/);
  expect(checkOf(out, 'frequency')).toMatchObject({ status: 'block' });   // 36% already over the cap
  expect(checkOf(out, 'frequency').detail).toMatch(/20 of 55 contacts have already had 2 or more touches/);
  expect(checkOf(out, 'sunset')).toMatchObject({ status: 'warn' });
  expect(out.verdict).toBe('block');

  // A non-email channel is judged without any domain lookup.
  ZONE.calls = [];
  const social = await preflight.run({
    provider: 'meta', channel: 'facebook_page', mode: 'publish',
    connection: { oauth_scopes: ['pages_manage_posts'], config: { publishing_enabled: true }, secret_fields: ['access_token'], status: 'active' },
    payload: { caption: 'Grail drop this Friday' }, mapping_missing: [], sending_domain: D,
  });
  expect(ZONE.calls).toHaveLength(0);
  expect(checkOf(social, 'domain_auth')).toBeUndefined();
  expect(checkOf(social, 'segment_health')).toBeUndefined();

  // A channel the adapter has not implemented is a block, not a silent no-op.
  const unsupported = await preflight.run({
    provider: 'webengage', channel: 'webengage_email', mode: 'draft',
    connection: { oauth_scopes: [], config: {}, secret_fields: ['api_key'], status: 'active' },
    payload: { subject: 'x', html: CLEAN_HTML }, mapping_missing: [],
  });
  expect(checkOf(unsupported, 'channel_support')).toMatchObject({ status: 'block' });
  expect(unsupported.blocking.join(' ')).toMatch(/not implemented for WebEngage/);
});

test('no send time is recommended without open history, and a recommendation carries its sample and its confidence', () => {
  const NOW = Date.now();
  const opened = Array.from({ length: 120 }, (_, i) => ({ external_profile_id: 'p' + i, last_open_at: new Date(NOW - 86400000).toISOString(), orders_count: 2, total_spend: 50 }));
  let out = cohorts.analyseAudience(opened, { now: NOW });
  expect(out.computed).toBe(true);
  expect(out.send_time).toMatchObject({ hour: null, confidence: 'none', sample: 0 });
  expect(out.send_time.note).toMatch(/will not label it as one/);

  const withHours = opened.map((c) => Object.assign({}, c, { open_hour_histogram: { 10: 6, 14: 1 } }));
  out = cohorts.analyseAudience(withHours, { now: NOW });
  expect(out.send_time).toMatchObject({ hour: 10, confidence: 'medium', sample: 120 });
  expect(out.send_time.note).toMatch(/120 contacts have enough open history/);

  const tooFew = opened.map((c) => Object.assign({}, c, { open_hour_histogram: { 10: 2 } }));
  expect(cohorts.analyseAudience(tooFew, { now: NOW }).send_time.hour, 'two opens per contact is not a peak').toBeNull();
});

test('content links that all point away from the sending domain are a signal, and aligned ones are not', () => {
  const links = (host) => `<p>${'word '.repeat(80)}</p><a href="https://${host}/a">a</a><a href="https://${host}/b">b</a><a href="https://${host}/c">c</a><a href="https://${host}/u">unsubscribe</a>`;
  const off = deliver.analyzeContent({ subject: 'Hello', html: links('tracker.example.net'), fromDomain: D });
  expect(off.signals.some((s) => /Every link points away from example.test/.test(s.signal))).toBe(true);
  const on = deliver.analyzeContent({ subject: 'Hello', html: links('shop.brand.example.test'), fromDomain: D });
  expect(on.signals.some((s) => /points away/.test(s.signal))).toBe(false);
  expect(on.links).toBe(4);
});

/* ═══ found by running it ═════════════════════════════════════════════════ */

// checkBlocklists() tested `!a.records.length` and never `a.ok`, so a DNS
// outage on the A lookup was reported as "No A record for <domain>" - a fact
// about the domain, stated from a fact about us, the exact confusion the
// module's own header says it refuses. And resolveRecord() promised to carry
// the system resolver's error forward when DoH failed too, but dohQuery always
// sets its own error, so `doh.error || sys.error` dropped the system code
// every time.
test('a blocklist check whose A lookup failed says so and never "no A record"; an unavailable record names the system resolver\'s error first', async () => {
  zone(healthyZone(), { [D]: { code: 'ETIMEOUT', kind: 'A' } });
  const bl = await deliver.checkBlocklists(D);
  expect(bl).toMatchObject({ checked: false, listed: [], refused: [], ips: [] });
  expect(bl.note).toMatch(/Could not look up the A record/);
  expect(bl.note).toMatch(/ETIMEOUT/);
  expect(bl.note).toMatch(/lookup failure, not a clean result/);
  expect(bl.note).not.toMatch(/No A record/);
  const out = await gate();
  expect(checkOf(out, 'blocklist')).toMatchObject({ status: 'warn' });
  expect(checkOf(out, 'blocklist').detail).not.toMatch(/No A record/);
  expect(out.verdict).toBe('warn');

  // The genuine absence is still reported as absence.
  const noA = healthyZone();
  delete noA[D].A;
  zone(noA);
  expect((await deliver.checkBlocklists(D)).note).toMatch(/No A record/);

  // The system resolver's own error is the first thing named, then DoH's.
  zone({}, { [`_dmarc.${D}`]: { code: 'ESERVFAIL' } });
  const dmarc = await deliver.auditDmarc(D);
  expect(dmarc.unavailable).toBe(true);
  expect(dmarc.findings[0].message).toMatch(/Could not look up DMARC: ESERVFAIL for TXT _dmarc\.brand\.example\.test; Could not resolve TXT/);
});
