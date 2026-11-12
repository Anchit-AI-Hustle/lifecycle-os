/**
 * What was approved is what is stored, shown, scheduled and reviewed.
 * ---------------------------------------------------------------------------
 * WHY (audit 2026-11-12). Four defects, each found by running the shipped code:
 *   1. the agentic run's reviewer answered { score: 7, pass: true } when no
 *      model reviewed anything, and the run reported "N of N passed";
 *   2. opening an APPROVED send whose saved campaign carried template copy
 *      rebuilt it with a model and saved it again as approved;
 *   3. opening an approved send whose saved campaign was missing rebuilt one
 *      and filed it as approved;
 *   4. asset kinds added to an approved send on view (social posts, on-site,
 *      display) were offered to the schedule as "ready", though nobody
 *      approved them.
 *
 * EXECUTED, no source read: the shipped planner, schedule planner and
 * orchestrator, over an in-memory store standing in for the database adapter
 * (its select / update / upsert / insert, by the filters the planner sends).
 *
 * Run: npx playwright test tests/approved-send-integrity.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const services = require(path.join(ROOT, 'lib', 'smart-brain', 'services.js'));
const SBP = require(path.join(ROOT, 'api', '_shared', 'smart-brain-plan.js'));
const BP = require(path.join(ROOT, 'api', '_shared', 'brain-publish.js'));

// Tenant zero's own record: with no workspace on the request the planner's
// "current brand" is the shipped one, so a slot stamped for it is current.
const ZERO = () => Object.assign(JSON.parse(JSON.stringify(require(path.join(ROOT, 'api', '_shared', 'brand-runtime.js')).defaultBrand())), { owns_shipped: true });
const IDENT = () => require(path.join(ROOT, 'api', '_shared', 'brand-identity.js')).brandIdentity(ZERO());
const HERO = { title: 'Custom Air Force 1 Sunset', handle: 'custom-af1-sunset', price: 14999, currency: 'INR', product_url: 'https://knickgasm.com/products/custom-af1-sunset', image_url: 'https://knickgasm.com/cdn/shop/files/af1-sunset.jpg', description: 'Hand-painted on an original pair, sealed to resist water and scratches.' };

let realFetch; let saved; let store; let proto;
const P = services.SmartBrainDbAdapter.prototype;
test.beforeEach(() => {
  realFetch = global.fetch;
  global.fetch = async (u) => { throw new Error('network blocked: ' + u); };
  saved = {};
  for (const k of Object.keys(process.env)) if (/_API_KEY|^AWS_|^ANTHROPIC_|^OLLAMA|^SUPABASE/.test(k)) { saved[k] = process.env[k]; delete process.env[k]; }
  store = { rows: {}, writes: [], failRead: null };
  proto = { connected: Object.getOwnPropertyDescriptor(P, 'connected'), select: P.select, update: P.update, upsert: P.upsert, insert: P.insert };
  const idOf = (f) => { const v = f && (f.id || f.campaign_id); return v ? String(v).replace(/^eq\./, '') : null; };
  Object.defineProperty(P, 'connected', { configurable: true, get() { return true; } });
  P.select = async function (table, params = {}) {
    if (store.failRead && store.failRead === table) throw new Error('store did not answer');
    const id = idOf(params.filters);
    const all = Object.values(store.rows[table] || {});
    // a database hands back a copy: what the planner changes in memory is not saved
    return JSON.parse(JSON.stringify(id ? all.filter((r) => String(r.id) === id) : []));
  };
  P.update = async function (table, filters, patch) { const id = idOf(filters); store.writes.push({ op: 'update', table, id, patch }); const t = (store.rows[table] = store.rows[table] || {}); if (t[id]) Object.assign(t[id], patch); return [t[id]].filter(Boolean); };
  P.upsert = async function (table, rows) { for (const r of [].concat(rows)) { store.writes.push({ op: 'upsert', table, id: r.id, status: r.status }); (store.rows[table] = store.rows[table] || {})[r.id] = Object.assign({}, (store.rows[table] || {})[r.id], r); } return rows; };
  P.insert = async function (table, rows) { for (const r of [].concat(rows)) store.writes.push({ op: 'insert', table, id: r.id }); return rows; };
});
test.afterEach(() => {
  global.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) process.env[k] = v;
  Object.defineProperty(P, 'connected', proto.connected); P.select = proto.select; P.update = proto.update; P.upsert = proto.upsert; P.insert = proto.insert;
});

const config = () => services.smartConfig({});
async function approvedSend({ strip = true, provider } = {}) {
  const brand = ZERO();
  const entry = { id: 'slot-1', date: '2026-11-14', market: 'IN', objective: 'reactivation', brand: JSON.parse(JSON.stringify(brand)), cohort: { name: 'At Risk', size: 1500, rules: ['no order in 90 days'] }, channels: ['email', 'meta', 'landing_page'], heroProduct: HERO, supportingProducts: [] };
  const campaign = await SBP.buildCampaign(entry, config(), { noLLM: true, withCreatives: false });
  const c = JSON.parse(JSON.stringify(campaign));
  if (strip) { delete c.assets.social_posts; delete c.assets.onsite; delete c.assets.display_banners; delete c.assets.google_display; }
  if (provider) c.copywriter = Object.assign({}, c.copywriter, { provider });
  const T = config().tableNames;
  // stamped for the record as it is now, as Daily Sync stamps a stored slot
  c.brand_identity = IDENT();
  store.rows[T.calendarEntries] = { 'slot-1': { id: 'slot-1', status: 'approved', generated_campaign_id: c.campaign_id, payload: Object.assign(JSON.parse(JSON.stringify(entry)), { __brand_identity: IDENT() }), change_log: [] } };
  store.rows[T.generatedCampaigns] = { [c.campaign_id]: { id: c.campaign_id, status: 'approved', payload: c } };
  return { entry, c, T };
}
const approvedBytes = (c) => JSON.stringify([c.assets.email, c.assets.landing_pages, c.assets.ads]);

test('a review nobody made is "review unavailable", never a 7 and a pass', async () => {
  const O = require(path.join(ROOT, 'api', '_shared', 'agentic-orchestrator.js'));
  // every provider is unreachable here (the network is blocked, no key is set)
  const r = await O._reviewStage({ subject: 'x' }, 'fast');
  expect(r.state).toBe('review_unavailable');
  expect(r.score).toBeNull();
  expect(r.pass).toBeNull();
  expect(r.reason).toBeTruthy();
});

test('opening an approved send returns it as saved, template copy and all, and writes nothing; its added kinds are listed as added, not saved', async () => {
  const { c, T } = await approvedSend({ provider: 'template-fallback' });
  const before = approvedBytes(c);
  const out = await SBP.previewEntry({ id: 'slot-1', config: {} });
  expect(out.persisted).toBe(true);
  expect(out.template_fallback).toBe(true);
  expect(out.healed).toBeUndefined();
  expect(approvedBytes(out.campaign)).toBe(before);
  expect(out.campaign.assets_added_on_view.sort()).toEqual(['display_banners', 'google_display', 'onsite', 'social_posts']);
  // nothing was written to the saved campaign, and it is still what was approved
  expect(store.writes.filter((w) => w.table === T.generatedCampaigns)).toEqual([]);
});

test('an approved send whose saved assets are missing becomes a NEW DRAFT that says so; a store that did not answer rebuilds nothing', async () => {
  const { c, T } = await approvedSend({});
  // the store does not answer: nothing is rebuilt
  store.failRead = T.generatedCampaigns;
  const refused = await SBP.previewEntry({ id: 'slot-1', config: {} }).catch((e) => e);
  expect(refused.code).toBe('approved_assets_unreadable');
  expect(store.writes).toEqual([]);
  store.failRead = null;
  // the campaign row is gone
  delete store.rows[T.generatedCampaigns][c.campaign_id];
  const out = await SBP.previewEntry({ id: 'slot-1', config: {}, noLLM: true });
  expect(out.approved_assets_missing).toBe(true);
  expect(out.note).toMatch(/new draft/);
  expect(out.campaign.recovered_draft).toBeTruthy();
  const filed = store.writes.filter((w) => w.table === T.generatedCampaigns);
  expect(filed.length).toBeGreaterThan(0);
  for (const w of filed) expect(w.status, 'a rebuilt draft was filed as approved').not.toBe('approved');
  // review of #451: the rebuilt campaign takes the SAME id, so the marker has
  // to be in the stored row, or the next view reads it back as the approval.
  const stored = Object.values(store.rows[T.generatedCampaigns])[0].payload;
  expect(stored.recovered_draft, 'the stored draft carries no recovery marker').toBeTruthy();
  const again = await SBP.previewEntry({ id: 'slot-1', config: {} });
  expect(again.approved_assets_missing).toBe(true);
  expect(again.note).toMatch(/new draft/);
  // the schedule does not treat it as approved, whatever the calendar row says
  const entry = store.rows[T.calendarEntries]['slot-1'].payload;
  const p = BP.plan(entry, again.campaign, entry.brand, { connections: { meta_ads: { status: 'active', config: {} } }, status: 'approved' });
  expect(p.approved).toBe(false);
  expect(p.rows.filter((r) => r.state === 'ready')).toEqual([]);
  // approving it approves THAT draft: same bytes, marker gone, digest recorded
  const AD = require(path.join(ROOT, 'api', '_shared', 'asset-decisions.js'));
  const draftDigest = AD.digestOf(again.campaign);
  const ok = await SBP.approveEntry({ id: 'slot-1', reviewer: 'op@example.test', config: {} });
  expect(ok.idempotent).toBeUndefined();
  const approvedNow = Object.values(store.rows[T.generatedCampaigns])[0].payload;
  expect(approvedNow.recovered_draft).toBeUndefined();
  expect(approvedNow.approved_digest.digest).toBe(draftDigest);
  expect(AD.digestOf(approvedNow)).toBe(draftDigest);
});

test('review of #451: a mail\'s subject and preheader are part of its revision, and only the mail\'s', async () => {
  const { c } = await approvedSend({ strip: false });
  const AD = require(path.join(ROOT, 'api', '_shared', 'asset-decisions.js'));
  const before = AD.build(c, { id: 'slot-1' });
  // a variant's own subject changes that variant's revision and nothing else
  const v = JSON.parse(JSON.stringify(c)); v.assets.email.variants[0].subject = 'A subject of its own';
  const after = AD.build(v, { id: 'slot-1' });
  expect(after.items[0].revision).not.toBe(before.items[0].revision);
  expect(after.items.slice(1).map((x) => x.revision)).toEqual(before.items.slice(1).map((x) => x.revision));
  expect(after.manifest_digest).not.toBe(before.manifest_digest);
  // the send's subject is delivered with every variant that has none of its own
  const m = JSON.parse(JSON.stringify(c)); m.assets.email.variants.forEach((x) => { delete x.subject; }); m.assets.email.subject = 'One';
  const m2 = JSON.parse(JSON.stringify(m)); m2.assets.email.subject = 'Two';
  expect(AD.build(m2, { id: 'slot-1' }).items.filter((x) => x.type === 'email').map((x) => x.revision)).not.toEqual(AD.build(m, { id: 'slot-1' }).items.filter((x) => x.type === 'email').map((x) => x.revision));
});

test('kinds added after approval are held out of the schedule until a reviewer approves them; approving saves them and leaves the approved mail, pages and ads byte for byte', async () => {
  const { c, entry, T } = await approvedSend({});
  const before = approvedBytes(c);
  const brand = entry.brand;
  const connections = { meta_ads: { status: 'active', external_account_label: 'Brand Page', config: {} } };
  const viewed = (await SBP.previewEntry({ id: 'slot-1', config: {} })).campaign;
  const held = BP.plan(entry, viewed, brand, { connections, status: 'approved' });
  expect(held.additions_pending.sort()).toEqual(['display_banners', 'google_display', 'onsite', 'social_posts']);
  const social = held.rows.filter((r) => r.kind === 'social');
  expect(social.length).toBeGreaterThan(3);
  expect(social.filter((r) => r.state === 'ready')).toEqual([]);
  expect(held.summary.ready).toBe(0);
  for (const r of social.filter((x) => x.state === 'awaiting_approval')) expect(r.message).toMatch(/not part of what was approved/);
  expect(held.rows.find((r) => r.kind === 'onsite').message).toMatch(/Added after this send was approved/);

  // a send that is not approved cannot have additions approved
  store.rows[T.calendarEntries]['slot-1'].status = 'tentative';
  expect((await SBP.approveAdditions({ id: 'slot-1', reviewer: 'op@example.test' }).catch((e) => e)).code).toBe('not_approved');
  store.rows[T.calendarEntries]['slot-1'].status = 'approved';

  const done = await SBP.approveAdditions({ id: 'slot-1', reviewer: 'op@example.test' });
  expect(done.added.sort()).toEqual(['display_banners', 'google_display', 'onsite', 'social_posts']);
  const savedNow = store.rows[T.generatedCampaigns][c.campaign_id].payload;
  expect(approvedBytes(savedNow)).toBe(before);
  expect(savedNow.assets_added_on_view).toBeUndefined();
  expect(savedNow.assets_added_approved.map((x) => x.kind).sort()).toEqual(done.added);
  expect(savedNow.assets_added_approved.every((x) => x.by === 'op@example.test' && x.at)).toBe(true);
  expect(store.rows[T.calendarEntries]['slot-1'].change_log.pop().kind).toBe('additions_approved');

  // now the schedule offers them, and a second press adds nothing
  const after = BP.plan(entry, (await SBP.previewEntry({ id: 'slot-1', config: {} })).campaign, brand, { connections, status: 'approved' });
  expect(after.additions_pending).toEqual([]);
  expect(after.rows.find((r) => r.id === 'social_facebook').state).toBe('ready');
  expect((await SBP.approveAdditions({ id: 'slot-1', reviewer: 'op@example.test' })).added).toEqual([]);
});

test('an approved send is not regenerated in place, and its approval names the bytes: the schedule refuses saved assets that differ from the digest', async () => {
  const { c, T } = await approvedSend({ strip: false });
  const AD = require(path.join(ROOT, 'api', '_shared', 'asset-decisions.js'));
  // Regenerate on an approved send is refused before anything is built or written
  const refused = await SBP.generateSingleAsset({ id: 'slot-1', assetType: 'mailer' }).catch((e) => e);
  expect(refused.code).toBe('approved_send_locked');
  expect(refused.status).toBe(409);
  expect(store.writes).toEqual([]);
  // the digest is of the assets, whatever id the send is filed under
  const d1 = AD.digestOf(c);
  expect(AD.digestOf(Object.assign({}, c, { calendar_entry_id: 'another-id', campaign_id: 'x' }))).toBe(d1);
  // one changed asset changes it
  const edited = JSON.parse(JSON.stringify(c)); edited.assets.social_posts[0].caption += ' Edited after approval.';
  expect(AD.digestOf(edited)).not.toBe(d1);
  // approving additions records the digest of everything approved
  const stripped = await approvedSend({});
  await SBP.approveAdditions({ id: 'slot-1', reviewer: 'op@example.test' });
  const savedNow = store.rows[stripped.T.generatedCampaigns][stripped.c.campaign_id].payload;
  expect(savedNow.approved_digest.digest).toBe(AD.digestOf(savedNow));
  expect(savedNow.approved_digest.by).toBe('op@example.test');
  expect(T).toBeTruthy();
});
