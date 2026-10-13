// A brand's agent on the brand's OWN website (2026-10-14), EXECUTED.
//
// The operator: "brand will need to be able to export the agent and set it up
// on their official website - only then will it be of any use", and chose
// "brand's credits, daily cap". The widget could not answer anyone on a
// brand's site: every reply needed a signed-in caller. ?action=agent-public
// (_shared/agent-embed.js) is driven here through the SHIPPED brain router over
// the fake project (credit RPCs as the migration defines them, a scripted
// model): a visitor on the brand's website gets an answer and the brand's
// wallet pays the catalog price; another website, no Origin, another brand's
// agent, the daily limit and an empty wallet are each refused BEFORE the model
// with a sentence; a failed reply is refunded. The settings op is the owner's.
const { test, expect } = require('@playwright/test');
const path = require('path');
const A = require('./agents-harness');
const H = require('./router-harness');

let w;
test.beforeAll(async () => { w = await A.world({}); });
test.afterAll(async () => { await w.close(); });
test.beforeEach(() => {
  w.reset();
  require(path.join(A.ROOT, 'api/_shared/agent-embed.js'))._resetRate();
  const led = w.db.table('credit_ledger');
  for (let i = led.length - 1; i >= 0; i--) if (led[i].ref === 'website-agent') led.splice(i, 1);
  for (const row of [w.db.workspaces['ws-oldest']].concat(w.db.table('brand_workspaces').filter((r) => r.id === 'ws-oldest'))) {
    row.website = 'https://www.oldest.example';
    row.brand_data = Object.assign({}, row.brand_data || {});
    delete row.brand_data.agent_embed;
  }
  const rows = w.db.table('smart_agents');
  if (!rows.some((r) => r.id === 'agent_site')) rows.push({ id: 'agent_site', workspace_id: 'ws-oldest', level: 'brand', name: 'Site Agent', market: 'UK', persona: {}, catalog_scope: {}, greeting: 'Hi', voice: {}, active: true });
  if (!rows.some((r) => r.id === 'agent_other')) rows.push({ id: 'agent_other', workspace_id: 'ws-elsewhere', level: 'brand', name: 'Other Agent', market: 'US', persona: {}, catalog_scope: {}, greeting: 'Hi', voice: {}, active: true });
});

const visitor = (origin, json) => H.request(w.port, {
  method: 'POST', path: '/api/brain?action=agent-public',
  json: Object.assign({ workspace_id: 'ws-oldest', agent_id: 'agent_site', message: 'Which frame suits a round face?', page_url: 'https://www.oldest.example/frames' }, json || {}),
  headers: origin === null ? {} : { origin, referer: origin + '/frames' },
});
const holds = () => w.db.table('credit_ledger').filter((l) => l.kind === 'hold' && l.ref === 'website-agent');
const ownerWallet = () => w.db.table('credit_wallets').find((x) => x.user_id === 'user-owner' && x.workspace_id === 'ws-oldest');

test('a visitor on the brand\'s own website gets the agent\'s answer, and the brand\'s wallet pays the catalog price', async () => {
  const catalog = require(path.join(A.ROOT, 'api/_shared/credit-catalog.js'));
  const price = catalog.quote('assistant.chat', undefined, {}).total;
  const r = await visitor('https://www.oldest.example');
  expect(r.status, r.text.slice(0, 400)).toBe(200);
  expect(r.out.ok).toBe(true);
  expect(typeof r.out.reply).toBe('string');
  expect(r.out.reply.length).toBeGreaterThan(0);
  expect(w.llm.calls.length).toBeGreaterThan(0);
  expect(holds()).toHaveLength(1);
  expect(holds()[0].workspace_id).toBe('ws-oldest');
  expect(holds()[0].user_id).toBe('user-owner');
  const spend = w.db.table('credit_ledger').find((l) => l.kind === 'spend' && l.hold_id === holds()[0].hold_id);
  expect(spend, 'the reply was not settled').toBeTruthy();
  expect(-holds()[0].delta).toBe(price);
  expect(ownerWallet()).toBeTruthy();
  // A sibling domain of the same brand (oldest.com) is the same brand.
  const r2 = await visitor('https://shop.oldest.com');
  expect(r2.status, r2.text.slice(0, 300)).toBe(200);
});

test('another website, or no page at all, is refused before the model with a sentence, and nothing is charged', async () => {
  for (const origin of ['https://copycat.example', null]) {
    const r = await visitor(origin);
    expect(r.status).toBe(403);
    expect(r.out.error).toBe('origin_not_allowed');
    expect(String(r.out.message)).toMatch(/answers only/);
  }
  expect(w.llm.calls).toEqual([]);
  expect(holds()).toEqual([]);
});

test('another brand\'s agent, or a brand with no website, is refused before the model', async () => {
  const r = await visitor('https://www.oldest.example', { agent_id: 'agent_other' });
  expect(r.status).toBe(404);
  expect(r.out.error).toBe('agent_not_found');
  for (const row of [w.db.workspaces['ws-oldest']].concat(w.db.table('brand_workspaces').filter((x) => x.id === 'ws-oldest'))) row.website = '';
  const r2 = await visitor('https://www.oldest.example');
  expect(r2.status).toBe(403);
  expect(String(r2.out.message)).toMatch(/no website/);
  expect(w.llm.calls).toEqual([]);
  expect(holds()).toEqual([]);
});

test('the built-in brand agent answers on the website too', async () => {
  const r = await visitor('https://www.oldest.example', { agent_id: 'agent_brand' });
  expect(r.status, r.text.slice(0, 300)).toBe(200);
  expect(r.out.ok).toBe(true);
});

test('the daily limit stops answers for the day, before the model, with a sentence', async () => {
  for (const row of w.db.table('brand_workspaces').filter((x) => x.id === 'ws-oldest')) row.brand_data = Object.assign({}, row.brand_data, { agent_embed: { daily_cap: 1 } });
  const ok = await visitor('https://www.oldest.example');
  expect(ok.status, ok.text.slice(0, 300)).toBe(200);
  const calls = w.llm.calls.length;
  const r = await visitor('https://www.oldest.example');
  expect(r.status).toBe(429);
  expect(r.out.error).toBe('daily_cap_reached');
  expect(String(r.out.message)).toMatch(/1 questions for today/);
  expect(w.llm.calls.length).toBe(calls);
  expect(holds()).toHaveLength(1);
});

test('a brand with no credits left is told politely, nothing runs; a failed reply is refunded', async () => {
  const wal = ownerWallet() || (await visitor('https://www.oldest.example'), ownerWallet());
  w.llm.calls.length = 0;
  const before = holds().length;
  const keep = wal.balance; wal.balance = 0;
  const r = await visitor('https://www.oldest.example');
  expect(r.status).toBe(402);
  expect(r.out.error).toBe('brand_out_of_credits');
  expect(String(r.out.message)).not.toMatch(/credit/i);
  expect(w.llm.calls).toEqual([]);
  wal.balance = keep;
  w.llm.down = true;
  const r2 = await visitor('https://www.oldest.example');
  w.llm.down = false;
  expect(r2.status).toBeGreaterThanOrEqual(500);
  const last = holds().slice(before).pop();
  expect(last, 'no hold was taken for the failed reply').toBeTruthy();
  expect(w.db.table('credit_ledger').some((l) => l.kind === 'release' && l.hold_id === last.hold_id), 'the failed reply was charged').toBe(true);
});

test('the daily limit is set by the brand\'s owner, and a visitor cannot set it', async () => {
  const owner = { authorization: 'Bearer tok-owner', origin: A.ORIGIN, referer: A.ORIGIN + '/agent' };
  const g = await H.request(w.port, { method: 'GET', path: '/api/brain?action=agent-embed&op=settings&workspace_id=ws-oldest', headers: owner });
  expect(g.status, g.text.slice(0, 300)).toBe(200);
  expect(g.out.daily_cap).toBe(300);
  const p = await H.request(w.port, { method: 'POST', path: '/api/brain?action=agent-embed&op=settings', json: { workspace_id: 'ws-oldest', daily_cap: 50 }, headers: owner });
  expect(p.status, p.text.slice(0, 300)).toBe(200);
  expect(p.out.daily_cap).toBe(50);
  expect(w.db.table('brand_workspaces').find((x) => x.id === 'ws-oldest').brand_data.agent_embed.daily_cap).toBe(50);
  const anon = await H.request(w.port, { method: 'POST', path: '/api/brain?action=agent-embed&op=settings', json: { workspace_id: 'ws-oldest', daily_cap: 99999 }, headers: { origin: 'https://www.oldest.example' } });
  expect(anon.status).toBe(401);
  expect(w.db.table('brand_workspaces').find((x) => x.id === 'ws-oldest').brand_data.agent_embed.daily_cap).toBe(50);
});
