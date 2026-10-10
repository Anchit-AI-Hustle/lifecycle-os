/**
 * The built-in Brand Agent answers an ACCOUNT brand (2026-10-10).
 *
 * Production, a Google sign-in whose brand "Deli Chic" is a workspace row:
 * /agent offers "Deli Chic Agent" (the built-in `agent_brand`, which agent.html
 * shows whenever the workspace keeps no agent of its own), and asking it
 * anything answered "THE AGENT DID NOT ANSWER - The agent "agent_brand" does
 * not exist in this brand's workspace ... agent_not_found". No workspace has
 * that row and none could be seeded safely: `smart_agents.id` is the table's
 * primary key across EVERY workspace, so a seeded `agent_brand` would be one
 * row shared - and overwritten - by every brand.
 *
 * brain-agent.agentFor() answers the built-in id from the brand THIS request
 * resolved (as deviceChat() does for a device brand), never from a default and
 * never as tenant zero; a request with no brand is refused with a sentence.
 * The same review found "Create an agent" deriving the id from name + level
 * alone, so two brands' "Concierge" were one row and the second save moved the
 * first brand's agent into its own workspace: the workspace is in the id now.
 *
 * Executed through the SHIPPED api/brain.js router over tests/lib/fake-supabase.js
 * (an account workspace with no agent rows; its own brand_catalog_products), the
 * scripted model recording every prompt. "Oldest Brand" is the harness's oldest
 * workspace - tenant zero here - and must never be spoken for anyone else.
 */
const { test, expect } = require('@playwright/test');
const A = require('./agents-harness');
const H = require('./router-harness');

const DELI = { name: 'Deli Chic', slug: 'deli-chic', website: 'https://delichic.example', industry: 'food',
  palette: { primary: '#b8322a', accent: '#2a6fb8', surface: '#ffffff', ink: '#1f2937' }, typography: { heading: 'Arial', body: 'Arial' },
  voice: { tone: 'warm and appetising', banned: [] }, regions: [{ code: 'IN', name: 'India', currency: 'INR', store_url: 'https://delichic.example', home: true }] };
const BRAMBLE = { name: 'Brambleweld Larder', slug: 'brambleweld-larder', website: 'https://brambleweld.example', industry: 'food',
  palette: { primary: '#2f6b3a', accent: '#c58b2a', surface: '#ffffff', ink: '#1f2937' }, typography: { heading: 'Arial', body: 'Arial' },
  voice: { tone: 'plain', banned: [] }, regions: [{ code: 'UK', name: 'United Kingdom', currency: 'GBP', store_url: 'https://brambleweld.example', home: true }] };
const STRANGERS = /Oldest Brand|oldest\.example|knickgasm|sneaker|hand-painted|Brambleweld/i;

let w;
const tok = {};
test.beforeAll(async () => {
  w = await A.world();
  tok.deli = H.jwtShaped('user-deli');
  tok.bramble = H.jwtShaped('user-bramble');
  tok.nobody = H.jwtShaped('user-nobody');
  w.db.addUser(tok.deli, 'user-deli', 'owner@delichic.example').addWorkspace('ws-deli', 'user-deli', DELI).setActive('user-deli', 'ws-deli');
  w.db.addUser(tok.bramble, 'user-bramble', 'owner@brambleweld.example').addWorkspace('ws-bramble', 'user-bramble', BRAMBLE).setActive('user-bramble', 'ws-bramble');
  w.db.addUser(tok.nobody, 'user-nobody', 'nobody@example.test');
  for (const p of [['Chicken Salami', 349], ['Smoked Ham', 449]]) {
    const handle = p[0].toLowerCase().replace(/\s+/g, '-');
    w.db.insert('brand_catalog_products', { workspace_id: 'ws-deli', region: 'in', sku: handle, handle, title: p[0], product_type: 'Cold cuts', collections: [], price: p[1], currency: 'INR', image_url: '', product_url: 'https://delichic.example/products/' + handle, source_url: 'https://delichic.example/products/' + handle });
  }
  w.db.workspaces['ws-oldest'].created_at = '2026-01-01T00:00:00.000Z';
  w.db.syncIdentityTables();
  w.db.route((u) => u.startsWith('https://delichic.example') || u.startsWith('https://brambleweld.example'), () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => 'not found', json: async () => ({}) }));
});
test.afterAll(async () => { if (w) await w.close(); });

const as = (who, query, json) => w.request('/api/brain', { query, json, headers: { authorization: 'Bearer ' + tok[who] } });

test('an account workspace with no agent rows: the built-in agent answers as Deli Chic, from its own catalogue, never as tenant zero', async () => {
  w.reset();
  expect(w.db.where('smart_agents', (r) => r.workspace_id === 'ws-deli'), 'the fixture must start with no agent rows').toEqual([]);
  const list = await as('deli', { action: 'agents' });
  expect(list.status).toBe(200);
  expect(list.out.agents, 'the workspace lists no agents, so the page offers the built-in one').toEqual([]);

  const r = await as('deli', { action: 'agent-chat' }, { message: 'Which one should I pick for a picnic?', agent_id: 'agent_brand' });
  expect(r.status, r.text).toBe(200);
  expect(r.out.ok).toBe(true);
  expect(r.out.reply).toBeTruthy();
  expect(r.out.agent.id).toBe('agent_brand');
  expect(r.out.agent.name).toBe('Deli Chic Agent');
  expect(w.llm.calls.length, 'no model was asked').toBe(1);
  const prompt = w.llm.calls[0].prompt;
  expect(prompt).toContain('Deli Chic');
  expect(prompt, 'its own catalogue, in its own currency').toMatch(/Chicken Salami \| Cold cuts \| INR 349/);
  expect(prompt).not.toMatch(STRANGERS);
  expect(r.text).not.toMatch(STRANGERS);
  expect(r.text).not.toMatch(/agent_not_found/);
});

test('the built-in agent for a request with no brand is refused with a sentence, and no model is asked', async () => {
  w.reset();
  const r = await as('nobody', { action: 'agent-chat' }, { message: 'hello', agent_id: 'agent_brand' });
  expect(r.status).toBeGreaterThanOrEqual(400);
  expect(r.status).toBeLessThan(500);
  expect(String(r.out.message || '')).toMatch(/brand/i);
  expect(w.llm.calls.length).toBe(0);
  expect(r.text).not.toMatch(STRANGERS);
});

test('with no model answering, the built-in agent says so: no tenant zero sales copy stands in', async () => {
  w.reset();
  w.llm.down = true;
  const r = await as('deli', { action: 'agent-chat' }, { message: 'Which one?', agent_id: 'agent_brand' });
  w.llm.down = false;
  expect(r.status).not.toBe(200);
  expect(r.out.ok).toBe(false);
  expect(String(r.out.message || '')).toMatch(/No language model answered/);
  expect(r.text).not.toMatch(/colorway|streetwear|forty cents|\$/i);
});

test('Create an agent works for an account brand, and two brands\' agents of the same name are two rows', async () => {
  w.reset();
  const made = await as('deli', { action: 'agent-upsert' }, { name: 'Concierge', level: 'brand' });
  expect(made.status, made.text).toBe(200);
  const id = made.out.agent.id;
  expect(made.out.agent.market, 'an agent with no market serves the brand\'s home market').toBe('IN');
  const other = await as('bramble', { action: 'agent-upsert' }, { name: 'Concierge', level: 'brand' });
  expect(other.status, other.text).toBe(200);
  expect(other.out.agent.id, 'the same name in another workspace must be another row').not.toBe(id);
  const mine = w.db.where('smart_agents', (r) => r.id === id);
  expect(mine.length).toBe(1);
  expect(mine[0].workspace_id, 'Deli Chic\'s agent was moved into another workspace').toBe('ws-deli');

  const listed = await as('deli', { action: 'agents' });
  expect(listed.out.agents.map((a) => a.id)).toEqual([id]);

  w.reset();
  const chat = await as('deli', { action: 'agent-chat' }, { message: 'What do you recommend?', agent_id: id });
  expect(chat.status, chat.text).toBe(200);
  expect(chat.out.agent.name).toBe('Concierge');
  expect(w.llm.calls.length).toBe(1);
  expect(w.llm.calls[0].prompt).toContain('Deli Chic');
  expect(w.llm.calls[0].prompt).not.toMatch(STRANGERS);

  const nameless = await as('deli', { action: 'agent-upsert' }, { level: 'brand' });
  expect(nameless.status).toBe(400);
  expect(nameless.out.error).toBe('name_required');
});
