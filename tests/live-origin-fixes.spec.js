// @ts-check
/*
 * Found on production by origin testing (2026-10-20), each through the shipped
 * /api/brain over the fake project (tests/agents-harness.js), which answers a
 * column the live table does not have with 400 42703, as PostgREST does.
 *  - library / kb ordered smart_campaigns by started_at, a column it never had:
 *    both answered 500 for every signed-in brand.
 *  - the built-in agent, with no model answering, spoke canned sales copy for the
 *    OLDEST workspace ("2-4 weeks of a daily pair ... forty cents"), claims no
 *    brand ever made. It now says there is no reply, for every workspace.
 */
const { test, expect } = require('@playwright/test');
const A = require('./agents-harness');

let w;
test.beforeAll(async () => { w = await A.world(); });
test.afterAll(async () => { if (w) await w.close(); });
const owner = { authorization: 'Bearer tok-owner' };

test('library and kb read smart_campaigns by the columns it has, and answer', async () => {
  for (const action of ['library', 'kb']) {
    w.reset();
    const r = await w.request('/api/brain', { query: { action }, headers: owner });
    expect(r.status, `${action}: ${r.text.slice(0, 300)}`).toBe(200);
    expect(r.text).not.toMatch(/started_at|42703/);
  }
});

test('tenant zero\'s own agent with no model answering says so, and speaks no canned sales copy', async () => {
  // The stand-in reply was tenant zero's only, so the oldest workspace is made
  // tenant zero's brand here: the one case it used to be spoken in.
  const ws = w.db.workspaces['ws-oldest'];
  const saved = { name: ws.name, website: ws.website };
  ws.name = 'KNICKGASM'; ws.website = 'https://knickgasm.com';
  if (ws.brand_data) { ws.brand_data.name = 'KNICKGASM'; ws.brand_data.website = 'https://knickgasm.com'; }
  w.db.syncIdentityTables();
  w.reset();
  w.llm.down = true;
  const r = await w.request('/api/brain', { query: { action: 'agent-chat' }, json: { message: 'Which one?', agent_id: 'agent_brand' }, headers: owner });
  w.llm.down = false;
  Object.assign(ws, saved);
  expect(r.out.ok, r.text.slice(0, 300)).toBe(false);
  expect(String(r.out.message || '')).toMatch(/No language model answered/);
  expect(r.text).not.toMatch(/forty cents|2.4 weeks|origin-fresh|Happy to help/i);
});
