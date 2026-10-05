'use strict';
/**
 * contact-ledger.js — who was contacted, on which channel, and when.
 * ---------------------------------------------------------------------------
 * The storage half of the one contact policy (the rules and the judge are
 * contact-fatigue.js, which does no I/O). One row per message that reached
 * one person, in `contact_touch_ledger`
 * (20261004093700_contact_ledger_fatigue.sql), fed by:
 *
 *   dispatch     a dispatch job the platform ACCEPTED for sending (scheduled
 *                or released - a Klaviyo campaign that was only CREATED has
 *                contacted nobody yet and is not recorded), for the recipients
 *                the job knew. dispatch-core.runJob calls recordDispatch().
 *   esp_event    ESP events a brand ingests (op=ingest): each carries its own
 *                channel and class, or its event name is mapped by the brand's
 *                own `event_map`. No ESP's event vocabulary is assumed.
 *
 * ── WHAT A ROW HOLDS ───────────────────────────────────────────────────────
 * The ESP's own profile id and/or a per-workspace salted SHA-256 of the
 * address or the number - the subscriber_engagement_scores pattern - and never
 * the address or the number. contact-fatigue.identityOf() hashes and DROPS
 * them before a row is built, and the table's CHECK constraints refuse a hash
 * column that is not 64 hex characters and a profile id that is an address or
 * a phone number, so the guarantee does not rest on this file alone.
 *
 * ── WHO WRITES, WHO READS ──────────────────────────────────────────────────
 * Writes are the SERVICE ROLE's (the table grants authenticated SELECT only and
 * has no write policy): a member cannot hand-edit what reached a customer. The
 * preflight gate and the planners read as the service role with an explicit
 * workspace filter (they run under the scheduler too) - and, inside a request,
 * only after requestMayRead() has established that the request is the
 * scheduler's or a VERIFIED MEMBER's of that workspace (RLS, as the caller).
 * A workspace id can arrive in a request body or a query string; reading the
 * ledger for whichever one was named would hand any caller another brand's
 * contact history in the shape of eligibility counts. The console's summary
 * reads as the caller, so RLS (`is_brand_member`) decides.
 *
 * ── ONE PERSON, SEVERAL IDENTIFIERS ────────────────────────────────────────
 * A dispatch row may carry a profile id, an address hash and a number hash;
 * an ingested SMS may carry the number alone. Reading only the recipient's
 * DIRECT identifiers missed every touch keyed by an identifier the ledger
 * itself links to them, so an email went out inside an SMS cool-down. load()
 * follows those links: rows holding the recipient's identifiers, then rows
 * holding the identifiers THOSE rows add, to LINK_HOPS rounds and LINK_KEYS
 * identifiers, over a link look-back LINK_LOOKBACK_DAYS longer than the
 * touch look-back. A walk the bound stopped says so (`links_incomplete`), and
 * the gate warns rather than passing a count it knows is a lower bound.
 *
 * ── UNAVAILABLE IS A STATE ─────────────────────────────────────────────────
 * No workspace (a brand kept on a device), no database configured, a store
 * that does not answer: each comes back `{ available:false, reason, note }`,
 * and the judge turns that into "eligibility unknown", never into 0 suppressed.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * Routed from api/brain.js ?action=contact-fatigue.
 * ---------------------------------------------------------------------------
 */

const fatigue = require('./contact-fatigue.js');

const TABLE = 'contact_touch_ledger';
const RULES_TABLE = 'contact_fatigue_rules';
const MAX_LOAD = 5000;          // rows read for one evaluation
const KEY_CHUNK = 80;           // identifiers per `in.(...)` filter
const MAX_RECIPIENTS = 10000;   // recipients one evaluation / one job carries
const LINK_HOPS = 4;            // rounds of linked identifiers followed beyond the recipients' own
const LINK_KEYS = 600;          // identifiers followed through links, per evaluation
const LINK_LOOKBACK_DAYS = 90;  // how much further back than the touch look-back a row may LINK identifiers
const DAY = 86400000;

/* ── storage ──────────────────────────────────────────────────────────────── */

function serviceEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url: String(url).replace(/\/$/, ''), key };
}
function hostOf(url) { try { return new URL(url).host; } catch (_) { return ''; } }

async function rest(env, pathAndQuery, { method = 'GET', body, prefer, range } = {}) {
  const headers = { apikey: env.key, authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  if (range) headers.Range = range;
  const res = await fetch(`${env.url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) {
    const err = new Error(`contact ledger ${method} -> ${res.status}: ${String((json && json.message) || text).slice(0, 200)}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return { json, range: res.headers && res.headers.get ? res.headers.get('content-range') : null };
}

function unavailable(reason, extra) {
  const notes = {
    no_workspace: 'this brand is kept on this device, and the contact ledger is kept in a brand workspace on the server',
    no_database: 'this deployment has no workspace database configured (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)',
    store_unreachable: `the workspace database${extra && extra.host ? ` (${extra.host})` : ''} did not answer`,
    not_supplied: 'no contact ledger was supplied to this check',
    unverified: 'unchecked: this request is not from a verified member of this brand\'s workspace, so its contact ledger and rules were not read',
    not_member: 'unchecked: the signed-in account is not a member of this brand\'s workspace, so its contact ledger and rules were not read',
  };
  return Object.assign({ available: false, reason, note: notes[reason] || reason, touches: [] }, extra || {});
}

/* ── rules ────────────────────────────────────────────────────────────────── */

/**
 * The brand's rules. A server workspace's are its saved row (defaults when it
 * has none); a brand kept on a device carries its own with the request (the
 * device KEEPS them, beside the brand). Whatever arrives is normalised to the
 * spec here, so a hand-written row cannot loosen a cap either.
 */
async function rulesFor({ workspaceId = null, carried = null } = {}) {
  if (workspaceId) {
    const env = serviceEnv();
    if (env) {
      try {
        const { json } = await rest(env, `${RULES_TABLE}?select=rules,updated_at,updated_by&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`);
        const row = Array.isArray(json) ? json[0] : null;
        if (row) {
          const n = fatigue.normaliseRules(row.rules);
          return { rules: n.rules, adjustments: n.adjustments, source: 'brand', updated_at: row.updated_at || null, updated_by: row.updated_by || null };
        }
        return { rules: fatigue.normaliseRules({}).rules, adjustments: [], source: 'default' };
      } catch (e) {
        return { rules: fatigue.normaliseRules({}).rules, adjustments: [], source: 'default',
          note: `This brand's saved rules could not be read (${hostOf(env.url)} did not answer), so the stated defaults apply.` };
      }
    }
  }
  if (carried && typeof carried === 'object') {
    const n = fatigue.normaliseRules(carried);
    return { rules: n.rules, adjustments: n.adjustments, source: 'device' };
  }
  return { rules: fatigue.normaliseRules({}).rules, adjustments: [], source: 'default' };
}

/**
 * Save a server brand's rules, as the caller (RLS: editors only), after the
 * code has checked the role so a viewer is told why rather than refused bare.
 */
async function saveRules(auth, workspaceId, input) {
  const brand = require('./brand-workspace-core.js');
  await brand.assertCanWrite(auth, workspaceId, 'change this brand\'s contact rules');
  const n = fatigue.normaliseRules(input);
  const row = { workspace_id: workspaceId, rules: n.rules, updated_by: auth.user_id || null, updated_at: new Date().toISOString() };
  await brand.restAs(auth.token, `${RULES_TABLE}?on_conflict=workspace_id`, {
    method: 'POST', body: [row], prefer: 'resolution=merge-duplicates,return=minimal',
  });
  return { rules: n.rules, adjustments: n.adjustments, source: 'brand', updated_at: row.updated_at };
}

/* ── reading the ledger ───────────────────────────────────────────────────── */

const COLS = 'id,provider,external_profile_id,email_hash,phone_hash,channel,message_class,occurred_at,cohort_key,region';

function quoteIn(list) {
  return `(${list.map((v) => `"${String(v).replace(/["\\]/g, '')}"`).join(',')})`;
}

/** Why there is no ledger to read, most fundamental cause first. */
function absent(workspaceId) {
  if (!serviceEnv()) return unavailable('no_database');
  if (!workspaceId) return unavailable('no_workspace');
  return null;
}

/** A person key ('p:<provider>:<id>' | 'e:<hash>' | 't:<hash>') as the column and value that find it. */
function columnOf(key) {
  const k = String(key || '');
  if (k.startsWith('e:')) return ['email_hash', k.slice(2)];
  if (k.startsWith('t:')) return ['phone_hash', k.slice(2)];
  const m = /^p:[^:]*:(.+)$/.exec(k);
  return m ? ['external_profile_id', m[1]] : null;
}

/** Rows holding any of these identifiers, added to `pool` (by row id). Returns the rows it added. */
async function fetchByKeys(env, ws, from, keys, pool) {
  const byCol = { external_profile_id: new Set(), email_hash: new Set(), phone_hash: new Set() };
  for (const k of keys) { const c = columnOf(k); if (c) byCol[c[0]].add(c[1]); }
  const fresh = [];
  let truncated = false;
  for (const col of Object.keys(byCol)) {
    const list = Array.from(byCol[col]);
    for (let i = 0; i < list.length; i += KEY_CHUNK) {
      const f = `${col}.in.${quoteIn(list.slice(i, i + KEY_CHUNK))}`;
      const { json } = await rest(env, `${TABLE}?select=${COLS}&${ws}${from}&or=(${encodeURIComponent(f)})&order=occurred_at.desc&limit=${MAX_LOAD}`);
      const rows = Array.isArray(json) ? json : [];
      if (rows.length >= MAX_LOAD) truncated = true;
      // A person known by a profile id AND an address is matched by both
      // filters: the same row twice would be counted as two touches.
      for (const r of rows) { const id = r.id || JSON.stringify(r); if (!pool.has(id)) { pool.set(id, r); fresh.push(r); } }
      if (pool.size >= MAX_LOAD * 2) return { fresh, truncated: true };
    }
  }
  return { fresh, truncated };
}

/**
 * Follow the identifiers the ledger links (2026-10-04, review). Starting from
 * `seeds` (person keys), read every row holding a known identifier and add the
 * identifiers that row carries, until no new one appears - or LINK_HOPS rounds
 * or LINK_KEYS identifiers, whichever stops it first, which is then REPORTED.
 * `requireFirst` is the recipients' own identifiers: that round is always
 * read, as it always was, whatever its size.
 */
async function linkWalk(env, ws, from, seeds, pool, { requireFirst = true } = {}) {
  const known = new Set(seeds);
  const queried = new Set();
  const rowsByKey = new Map();
  const grow = (rows) => {
    for (const row of rows) for (const k of fatigue.personKeys(row)) { if (!rowsByKey.has(k)) rowsByKey.set(k, []); rowsByKey.get(k).push(row); }
    const queue = [];
    for (const row of rows) for (const k of fatigue.personKeys(row)) if (known.has(k)) queue.push(k);
    const added = [];
    const seen = new Set();
    while (queue.length) {
      const k = queue.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      for (const row of rowsByKey.get(k) || []) {
        for (const k2 of fatigue.personKeys(row)) {
          if (!known.has(k2)) { known.add(k2); added.push(k2); }
          if (!seen.has(k2)) queue.push(k2);
        }
      }
    }
    return added;
  };
  grow(Array.from(pool.values()));
  let frontier = Array.from(known);
  let rounds = 0;
  let truncated = false;
  let cut = null;
  while (frontier.length) {
    if (rounds > LINK_HOPS) { cut = 'hops'; break; }
    if ((rounds > 0 || !requireFirst) && queried.size + frontier.length > LINK_KEYS) { cut = 'identifiers'; break; }
    for (const k of frontier) queried.add(k);
    const got = await fetchByKeys(env, ws, from, frontier, pool);
    if (got.truncated) truncated = true;
    frontier = grow(got.fresh).filter((k) => !queried.has(k));
    rounds += 1;
    if (truncated) { cut = cut || (frontier.length ? 'rows' : null); break; }
  }
  return {
    truncated,
    links_incomplete: !!cut && frontier.length > 0,
    link_hops: Math.max(0, rounds - 1),
    link_cut: frontier.length ? cut : null,
    identifiers_followed: queried.size,
  };
}

/**
 * Touches for one workspace from `since` on: those of the given recipients
 * and of every identifier the ledger links to them, or those tagged with the
 * given cohorts (and, likewise, of the identifiers linked to them), or
 * (neither) the workspace's most recent ones. Rows older than `since` that
 * LINK two identifiers come back as `links`, never as touches. Bounded; a
 * read that hit the bound says `truncated`, a link walk that did says
 * `links_incomplete`.
 */
async function load({ workspaceId = null, since = null, identities = null, cohortKeys = null } = {}) {
  const why = absent(workspaceId);
  if (why) return why;
  const env = serviceEnv();
  const ws = `workspace_id=eq.${encodeURIComponent(workspaceId)}`;
  const sinceMs = since != null && Number.isFinite(new Date(since).getTime()) ? new Date(since).getTime() : null;
  const from = sinceMs != null ? `&occurred_at=gte.${encodeURIComponent(new Date(sinceMs).toISOString())}` : '';
  const linkFrom = sinceMs != null ? `&occurred_at=gte.${encodeURIComponent(new Date(sinceMs - LINK_LOOKBACK_DAYS * DAY).toISOString())}` : '';
  try {
    // Does the ledger hold ANYTHING for this brand in the horizon? "No send
    // history" and "these recipients have none" are different statements.
    const head = await rest(env, `${TABLE}?select=id&${ws}${from}`, { prefer: 'count=exact', range: '0-0' });
    const total = Number(String(head.range || '').split('/')[1]);
    const workspaceTouches = Number.isFinite(total) ? total : (Array.isArray(head.json) ? head.json.length : 0);
    let rows = [];
    let links = [];
    let truncated = false;
    let walk = null;
    if (workspaceTouches > 0) {
      const order = '&order=occurred_at.desc';
      const pool = new Map();
      if (Array.isArray(identities) && identities.length) {
        const seeds = Array.from(new Set(identities.flatMap((id) => fatigue.personKeys(id))));
        walk = await linkWalk(env, ws, linkFrom, seeds, pool, { requireFirst: true });
      } else if (Array.isArray(cohortKeys) && cohortKeys.length) {
        const f = `cohort_key.in.${quoteIn(Array.from(new Set(cohortKeys)).slice(0, 200))}`;
        const { json } = await rest(env, `${TABLE}?select=${COLS}&${ws}${from}&or=(${encodeURIComponent(f)})${order}&limit=${MAX_LOAD}`);
        const tagged = Array.isArray(json) ? json : [];
        if (tagged.length >= MAX_LOAD) truncated = true;
        for (const r of tagged) pool.set(r.id || JSON.stringify(r), r);
        // The cohort's people are the seeds: their untagged touches (an SMS
        // keyed by the number alone) are theirs too.
        const seeds = Array.from(new Set(tagged.flatMap((r) => fatigue.personKeys(r))));
        walk = await linkWalk(env, ws, linkFrom, seeds, pool, { requireFirst: false });
      }
      if (walk) {
        truncated = truncated || walk.truncated;
        const all = Array.from(pool.values()).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
        rows = sinceMs != null ? all.filter((r) => Date.parse(r.occurred_at) >= sinceMs) : all;
        // Older rows only LINK: identifier columns, and only when they tie two together.
        const seenLink = new Set();
        for (const r of all) {
          if (sinceMs == null || Date.parse(r.occurred_at) >= sinceMs) continue;
          const keys = fatigue.personKeys(r);
          if (keys.length < 2) continue;
          const k = keys.join('|');
          if (seenLink.has(k)) continue;
          seenLink.add(k);
          links.push({ provider: r.provider || null, external_profile_id: r.external_profile_id || null, email_hash: r.email_hash || null, phone_hash: r.phone_hash || null });
        }
      } else {
        const { json } = await rest(env, `${TABLE}?select=${COLS}&${ws}${from}${order}&limit=${MAX_LOAD}`);
        rows = Array.isArray(json) ? json : [];
        truncated = workspaceTouches > rows.length;
      }
      if (rows.length > MAX_LOAD) { rows = rows.slice(0, MAX_LOAD); truncated = true; }
    }
    return {
      available: true, source: 'ledger', workspace_id: workspaceId, touches: rows, links, workspace_touches: workspaceTouches, truncated,
      links_incomplete: !!(walk && walk.links_incomplete), link_hops: walk ? walk.link_hops : null, link_cut: walk ? walk.link_cut : null,
      since: sinceMs != null ? new Date(sinceMs).toISOString() : null,
    };
  } catch (e) {
    return unavailable('store_unreachable', { host: hostOf(env.url), status: e.status || null, note: `the workspace database (${hostOf(env.url)}) did not answer` });
  }
}

/** Carried history (a device sign-in, an API caller): hashed on the way in, raw identifiers dropped. */
function sanitizeCarried(workspaceId, carried) {
  const c = carried && typeof carried === 'object' ? carried : {};
  const touches = (Array.isArray(c.touches) ? c.touches : []).slice(0, MAX_LOAD * 4).map((t) => {
    if (!t || typeof t !== 'object') return null;
    const id = fatigue.identityOf(workspaceId, t);
    const channel = fatigue.channelOf(t.channel);
    const when = t.occurred_at || t.at;
    if (!channel || !when || !Number.isFinite(Date.parse(when)) || !fatigue.hasIdentity(id)) return null;
    return Object.assign(id, { channel, message_class: fatigue.classOf(t.message_class), occurred_at: new Date(Date.parse(when)).toISOString() });
  }).filter(Boolean);
  let members = null;
  if (c.members && typeof c.members === 'object' && !Array.isArray(c.members)) {
    members = {};
    for (const k of Object.keys(c.members).slice(0, 200)) {
      if (Array.isArray(c.members[k])) members[k] = c.members[k].slice(0, MAX_RECIPIENTS).map((m) => fatigue.identityOf(workspaceId, m)).filter(fatigue.hasIdentity);
    }
  }
  return { available: true, source: 'request', touches, workspace_touches: touches.length, members, truncated: false };
}

/**
 * May the service role read THIS workspace's contact ledger and rules for the
 * request being served (2026-10-04, review)? A workspace id can be named in a
 * body or a query string by anyone, and several routers honour a named id, so
 * the read is decided here, before any query, on what the REQUEST is:
 *   - no request in scope (the scheduler's worker, a script): the documented
 *     userless process - yes;
 *   - the scheduler's own bearer (the cron, the prebuild chain): yes;
 *   - a verified caller who is a MEMBER of this workspace - asked as the
 *     caller, so RLS answers (the same door evaluateForCaller uses): yes;
 *   - anyone else - anonymous, a refused token, a member of another
 *     workspace naming this one: no, and the state is said as unchecked.
 */
async function requestMayRead(workspaceId) {
  const rs = require('./request-scope.js');
  const req = rs.currentRequest();
  if (!req) return { ok: true, basis: 'server' };
  if (require('./require-caller.js').isCron(req)) return { ok: true, basis: 'scheduler' };
  return rs.once(`contact-ledger:may-read:${workspaceId}`, async () => {
    const brand = require('./brand-workspace-core.js');
    let auth = null;
    try { auth = await brand.requireUser(req); } catch (_) { auth = null; }
    if (!auth || !auth.ok) return { ok: false, reason: 'unverified' };
    let member = false;
    try { member = !!(await brand.getWorkspace(auth, workspaceId)); } catch (_) { member = false; }
    return member ? { ok: true, basis: 'member' } : { ok: false, reason: 'not_member' };
  });
}

/**
 * Carried touches ADDED to what the store holds, never in its place
 * (2026-10-04, review): a request that carried an empty history used to
 * REPLACE the ledger, so any member could turn a cool-down block into "no
 * send history" with no override recorded. A carried copy of a stored touch
 * (same channel, class and second, and an identifier in common) is the stored
 * touch, so it is not counted twice.
 */
function addCarried(led, extra) {
  const sec = (t) => { const ms = Date.parse(t.occurred_at); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };
  const bucket = new Map();
  for (const t of led.touches || []) {
    const k = `${fatigue.channelOf(t.channel)}|${fatigue.classOf(t.message_class)}|${sec(t)}`;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k).push(new Set(fatigue.personKeys(t)));
  }
  const offered = extra.touches || [];
  const added = offered.filter((t) => {
    const keys = fatigue.personKeys(t);
    return !(bucket.get(`${t.channel}|${t.message_class}|${sec(t)}`) || []).some((set) => keys.some((x) => set.has(x)));
  });
  return Object.assign(led, {
    touches: (led.touches || []).concat(added),
    workspace_touches: (Number(led.workspace_touches) || 0) + added.length,
    carried_added: added.length,
    carried_duplicates: offered.length - added.length,
    source: offered.length ? 'ledger+request' : led.source,
  });
}

/**
 * Everything a planner or the gate needs: the brand's rules and its ledger
 * (or the history the request carried). Never throws.
 *
 * WHICH HISTORY COUNTS. With a store this request may read, the STORE is the
 * truth and carried rows can only add to it. The history a request carried
 * stands on its own only where there is no store to read: a brand kept on a
 * device, a deployment with no database, the gate's pure path, or a request
 * that may not read this workspace (then it is the caller's own data, judged
 * for them, and nothing of the workspace's is read).
 */
async function contextFor({ workspaceId = null, carried = null, policy = null, since = null, identities = null, cohortKeys = null, members = null, readStore = true } = {}) {
  // readStore:false is the pure path: the rules the request carried (or the
  // stated defaults) over the history it carried, and nothing read from the
  // database. It is what the preflight gate uses on its own, because its
  // input - workspaceId included - can come straight from a request body.
  const hasCarried = !!(carried && typeof carried === 'object' && Array.isArray(carried.touches));
  let gate = { ok: false, reason: 'not_supplied' };
  if (readStore) {
    const why = absent(workspaceId);
    gate = why ? { ok: false, absent: why } : await requestMayRead(workspaceId);
  }
  const store = !!gate.ok;
  const r = store ? await rulesFor({ workspaceId, carried: policy }) : await rulesFor({ carried: policy });
  let led;
  if (store) {
    led = await load({ workspaceId, since: since || Date.now() - 9 * DAY, identities, cohortKeys });
    if (hasCarried && led.available) led = addCarried(led, sanitizeCarried(workspaceId, carried));
  } else if (hasCarried) {
    led = sanitizeCarried(workspaceId, carried);
  } else if (gate.absent) {
    led = gate.absent;
  } else {
    led = unavailable(gate.reason || 'not_supplied');
  }
  return Object.assign(led, {
    workspace_id: workspaceId || null,
    // A member list is the store's (server-supplied) on the store path; a
    // carried one stands only where the carried history does.
    members: (store ? null : led.members) || members || null,
    read_basis: store ? gate.basis : null,
    rules: r.rules, rules_source: r.source, rules_adjustments: r.adjustments, rules_note: r.note || null,
  });
}

/**
 * The contact-fatigue verdict for one send: what the preflight gate shows.
 * `recipients` may be raw (hashed here) or already-hashed identities.
 */
async function evaluateSend({ workspaceId = null, channel, message_class, at = null, recipients = null, carried = null, policy = null, provider = null, region = null, readStore = true } = {}) {
  const at0 = at && Number.isFinite(Date.parse(at)) ? Date.parse(at) : Date.now();
  const list = Array.isArray(recipients) ? recipients.slice(0, MAX_RECIPIENTS) : null;
  // An empty list is not "everyone checked": it is no list.
  const ids = list && list.length ? list.map((x) => {
    const id = fatigue.identityOf(workspaceId, x, { provider });
    if (!id.region && region) id.region = String(region).toUpperCase();
    return id;
  }) : null;
  const ctx = await contextFor({
    workspaceId, carried, policy, readStore,
    // The look-back: the rolling window plus the longest cool-down.
    since: at0 - (fatigue.WINDOW_DAYS + 7) * DAY,
    identities: ids ? ids.filter(fatigue.hasIdentity) : null,
  });
  const ev = fatigue.evaluate({
    rules: ctx.rules, touches: ctx.touches, links: ctx.links, candidates: ids, workspaceId,
    send: { channel, message_class, at: new Date(at0).toISOString() },
    ledger: {
      available: ctx.available, reason: ctx.reason, note: ctx.note, workspace_touches: ctx.workspace_touches, truncated: ctx.truncated, source: ctx.source,
      links_incomplete: ctx.links_incomplete, link_hops: ctx.link_hops,
    },
  });
  if (list && Array.isArray(recipients) && recipients.length > MAX_RECIPIENTS) {
    ev.note += ` Only the first ${MAX_RECIPIENTS} of ${recipients.length} recipients were checked; the rest are not judged here.`;
    ev.recipients_unchecked = recipients.length - MAX_RECIPIENTS;
  }
  ev.rules_source = ctx.rules_source;
  return ev;
}

/**
 * The server ledger for a VERIFIED caller, only for a workspace they belong to
 * (RLS answers the membership question: the caller reads the workspace row as
 * themselves). Anyone else - a device brand, a workspace named that is not
 * theirs - is judged over the history the request carried, never the store.
 */
async function evaluateForCaller(auth, workspaceId, input) {
  const i = input || {};
  let member = false;
  if (workspaceId && auth && auth.ok) {
    try { member = !!(await require('./brand-workspace-core.js').getWorkspace(auth, workspaceId)); } catch (_) { member = false; }
  }
  return evaluateSend(Object.assign({}, i, { workspaceId: workspaceId || null, readStore: member }));
}

/* ── writing the ledger ───────────────────────────────────────────────────── */

function rowFor(workspaceId, t, { source, sourceRef, jobId }) {
  const id = fatigue.identityOf(workspaceId, t);
  const channel = fatigue.channelOf(t.channel);
  const when = t.occurred_at || t.at;
  if (!fatigue.hasIdentity(id) || !channel || !when || !Number.isFinite(Date.parse(when))) return null;
  return {
    workspace_id: workspaceId,
    provider: id.provider,
    external_profile_id: id.external_profile_id,
    email_hash: id.email_hash,
    phone_hash: id.phone_hash,
    channel,
    message_class: fatigue.classOf(t.message_class),
    occurred_at: new Date(Date.parse(when)).toISOString(),
    cohort_key: id.cohort_key,
    region: id.region,
    source,
    source_ref: String(sourceRef || '').slice(0, 200),
    subject_key: fatigue.subjectKey(id),
    dispatch_job_id: jobId || null,
  };
}

/**
 * Record touches. Idempotent: the unique index (workspace, source, source_ref,
 * subject_key) answers a re-delivery with nothing, so an event ingested twice
 * or a job reconciled twice is one touch.
 */
async function record(workspaceId, touches, { source, sourceRef, jobId = null } = {}) {
  if (!workspaceId) return { recorded: 0, skipped: (touches || []).length, reason: 'no_workspace' };
  const env = serviceEnv();
  if (!env) return { recorded: 0, skipped: (touches || []).length, reason: 'no_database' };
  const rows = []; const skipped = [];
  (Array.isArray(touches) ? touches : []).forEach((t, i) => {
    const ref = sourceRef != null ? sourceRef : (t && (t.event_id || t.source_ref));
    const row = ref ? rowFor(workspaceId, t, { source, sourceRef: ref, jobId }) : null;
    if (row) rows.push(row); else skipped.push(i);
  });
  for (let i = 0; i < rows.length; i += 500) {
    await rest(env, `${TABLE}?on_conflict=workspace_id,source,source_ref,subject_key`, {
      method: 'POST', body: rows.slice(i, i + 500), prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  }
  return { recorded: rows.length, skipped: skipped.length, skipped_index: skipped.slice(0, 50) };
}

/**
 * The touch a dispatch job is about to make, captured at enqueue so the job
 * row carries it: the channel the subscriber experiences, the class, and the
 * recipients it knows - HASHED. A campaign to a list the platform resolves
 * knows none, and says so (`recipients_known:false`).
 */
function touchSpecFor({ workspaceId, channel, spec, payload, provider }) {
  const s = spec || {};
  const ch = fatigue.channelOf(s.message_channel || channel);
  const cls = fatigue.classOf(s.message_class || s.message_priority || fatigue.defaultClassFor(channel));
  let raw = Array.isArray(s.recipients) ? s.recipients : null;
  // A single-profile trigger names its person in the payload itself.
  if (!raw && payload && typeof payload === 'object') {
    if (payload.profile && typeof payload.profile === 'object') raw = [payload.profile];
    else if (payload.userId || payload.user_id) raw = [{ user_id: payload.userId || payload.user_id }];
  }
  const ids = raw ? raw.slice(0, MAX_RECIPIENTS).map((r) => fatigue.identityOf(workspaceId, r, { provider })).filter(fatigue.hasIdentity) : [];
  return {
    channel: ch,
    message_class: cls,
    cohort_key: s.cohort_key ? String(s.cohort_key).slice(0, 80) : null,
    region: s.region ? String(s.region).toUpperCase().slice(0, 6) : null,
    recipients: ids,
    recipients_known: !!raw,
    recipients_truncated: raw ? Math.max(0, raw.length - MAX_RECIPIENTS) : 0,
  };
}

/**
 * After a dispatch the platform accepted: one touch per known recipient. A
 * dry run, a refusal, or a campaign that was only CREATED (not released, not
 * scheduled) contacted nobody and records nothing.
 */
async function recordDispatch(job, result) {
  const ct = job && job.contact_touch;
  if (!ct || !ct.channel || !Array.isArray(ct.recipients) || !ct.recipients.length) return { recorded: 0, reason: 'no_known_recipients' };
  if (job.dry_run || !result || result.ok !== true || result.sent === false) return { recorded: 0, reason: 'not_sent' };
  const status = String(result.status || '').toLowerCase();
  if (status === 'created' || status === 'draft') return { recorded: 0, reason: 'not_released' };
  const p = job.payload || {};
  const when = status === 'scheduled' ? (p.send_at || job.scheduled_for || new Date().toISOString()) : new Date().toISOString();
  const touches = ct.recipients.map((r) => Object.assign({}, r, {
    channel: ct.channel, message_class: ct.message_class, occurred_at: when,
    cohort_key: r.cohort_key || ct.cohort_key || null, region: r.region || ct.region || null,
  }));
  return record(job.workspace_id, touches, { source: 'dispatch', sourceRef: job.id, jobId: job.id });
}

/**
 * ESP events a brand pushes in. Each needs a channel and a class, stated on
 * the event or mapped from its name by the brand's own `event_map`; an event
 * this platform cannot place is skipped and counted, not guessed.
 */
async function ingest(auth, workspaceId, events) {
  await require('./brand-workspace-core.js').assertCanWrite(auth, workspaceId, 'record contact history');
  const { rules } = await rulesFor({ workspaceId });
  const list = Array.isArray(events) ? events.slice(0, 5000) : [];
  const placed = []; const unplaced = [];
  list.forEach((e, i) => {
    if (!e || typeof e !== 'object') { unplaced.push({ index: i, why: 'not an event' }); return; }
    const mapped = e.event_name && rules.event_map[e.event_name] ? rules.event_map[e.event_name] : null;
    const channel = fatigue.channelOf(e.channel || (mapped && mapped.channel));
    const cls = e.message_class || (mapped && mapped.message_class);
    if (!channel || !cls) { unplaced.push({ index: i, why: 'no channel and class, and its event name is not in this brand\'s event map' }); return; }
    if (!e.event_id) { unplaced.push({ index: i, why: 'no event_id, so a re-delivery could not be told from a new send' }); return; }
    placed.push(Object.assign({}, e, { channel, message_class: cls }));
  });
  const out = await record(workspaceId, placed, { source: 'esp_event' });
  return { recorded: out.recorded, skipped: unplaced.length + (out.skipped || 0), unplaced: unplaced.slice(0, 50), reason: out.reason || null };
}

/** The console's view of the ledger, read AS THE CALLER (RLS decides). */
async function summary(auth, workspaceId) {
  const env = serviceEnv();
  const anon = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!env && !anon) return unavailable('no_database', { touches: undefined });
  if (!workspaceId) return unavailable('no_workspace', { touches: undefined });
  const since = new Date(Date.now() - (fatigue.WINDOW_DAYS + 2) * DAY).toISOString();
  try {
    const rows = await require('./brand-workspace-core.js').restAs(auth.token,
      `${TABLE}?select=channel,message_class,occurred_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&occurred_at=gte.${encodeURIComponent(since)}&order=occurred_at.desc&limit=${MAX_LOAD}`);
    const list = Array.isArray(rows) ? rows : [];
    const by = {};
    for (const r of list) by[r.channel] = (by[r.channel] || 0) + 1;
    return {
      available: true, since, touches_in_window: list.length, truncated: list.length >= MAX_LOAD, by_channel: by,
      last_touch_at: list[0] ? list[0].occurred_at : null,
      note: list.length
        ? `${list.length} touch(es) recorded since ${since.slice(0, 10)}.`
        : 'No send history recorded for this brand yet, so every slot and every send reads "eligibility unknown" until there is some.',
    };
  } catch (e) {
    if (Number(e.status) === 403 && e.code === 'account_type_unsupported') return unavailable('no_workspace', { touches: undefined });
    return unavailable('store_unreachable', { touches: undefined, host: hostOf((env && env.url) || anon) });
  }
}

/* ── the router's one entry point ─────────────────────────────────────────── */

/**
 * ?action=contact-fatigue&op=rules|rules-save|evaluate|summary|ingest.
 * Returns { status, body }. A brand with no server workspace (a phone
 * sign-in's device brand) gets the device path: its rules are KEPT on the
 * device and carried with each request, and evaluation runs over the history
 * the request carries - the ledger itself is said to be unavailable.
 */
async function handle(op, { auth, workspaceId, body }) {
  const b = body || {};
  const o = String(op || 'rules').toLowerCase();
  const device = !workspaceId;
  // Every server read below is the service role's, so it is only made for a
  // workspace the caller can read as themselves.
  if (!device) {
    let ws = null;
    try { ws = await require('./brand-workspace-core.js').getWorkspace(auth, workspaceId); } catch (_) { ws = null; }
    if (!ws) return { status: 404, body: { ok: false, error: 'workspace_not_found', message: 'That brand workspace was not found among yours, so its contact rules and history were not read.' } };
  }
  const noLedger = () => Object.assign(absent(null) || unavailable('no_workspace'), { touches: undefined });
  if (o === 'rules') {
    const r = await rulesFor({ workspaceId, carried: b.contact_policy || b.rules });
    return { status: 200, body: {
      ok: true, rules: r.rules, defaults: fatigue.normaliseRules({}).rules, describe: fatigue.describeRules(r.rules),
      adjustments: r.adjustments, source: r.source, note: r.note || null,
      storage: device ? 'device' : 'workspace',
      ledger: device ? noLedger() : await summary(auth, workspaceId),
    } };
  }
  if (o === 'rules-save') {
    if (device) {
      // The server READS, the device KEEPS (2026-10-03): normalised to the spec
      // here, kept beside the brand by the page, carried with each request.
      const n = fatigue.normaliseRules(b.rules || b.contact_policy);
      return { status: 200, body: { ok: true, saved: false, storage: 'device', rules: n.rules, adjustments: n.adjustments, describe: fatigue.describeRules(n.rules),
        note: 'Kept on this device beside the brand: this brand has no workspace on the server to save them to. They travel with each request this brand makes.' } };
    }
    const r = await saveRules(auth, workspaceId, b.rules || b.contact_policy);
    return { status: 200, body: { ok: true, saved: true, storage: 'workspace', rules: r.rules, adjustments: r.adjustments, describe: fatigue.describeRules(r.rules), updated_at: r.updated_at } };
  }
  if (o === 'evaluate') {
    const ev = await evaluateSend({
      workspaceId, channel: b.channel, message_class: b.message_class || b.message_priority, at: b.at || b.scheduled_for,
      recipients: b.recipients || b.contacts || null, carried: b.contact_ledger || null, policy: b.contact_policy || null, provider: b.provider || null, region: b.region || null,
    });
    return { status: 200, body: Object.assign({ ok: true }, ev) };
  }
  if (o === 'summary') {
    return { status: 200, body: Object.assign({ ok: true }, device ? noLedger() : await summary(auth, workspaceId)) };
  }
  if (o === 'ingest') {
    if (device) {
      return { status: 409, body: { ok: false, error: 'ledger_unavailable', storage: 'device',
        message: 'Nothing was recorded: the contact ledger is kept in a brand workspace on the server, and this brand is kept on this device. Its rules still evaluate over any send history a request carries (op=evaluate).' } };
    }
    const out = await ingest(auth, workspaceId, b.events);
    return { status: 200, body: Object.assign({ ok: true }, out) };
  }
  return { status: 400, body: { ok: false, error: 'unknown_op', message: 'Use op=rules, rules-save, evaluate, summary or ingest.' } };
}

module.exports = {
  TABLE, RULES_TABLE, MAX_RECIPIENTS, LINK_HOPS, LINK_KEYS, LINK_LOOKBACK_DAYS,
  rulesFor, saveRules, load, contextFor, evaluateSend, evaluateForCaller, record, recordDispatch, touchSpecFor, ingest, summary, handle,
  sanitizeCarried, requestMayRead, addCarried,
};
