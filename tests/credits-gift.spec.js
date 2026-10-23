// Gift credits to anyone by email (2026-10-23), executed through the shipped
// credits router (credits-core.handle) over the fake ledger, whose
// credit_gift_send / credit_gift_claim follow 20261023221000_credit_gifts.sql.
//
// Run: npx playwright test tests/credits-gift.spec.js --project=desktop-1280
const { test, expect } = require('@playwright/test');
const path = require('path');
const { FakeSupabase, installCreditsRpc, makeReq, makeRes, envScope, SERVICE_KEY, ANON_KEY, BASE } = require('./lib/fake-supabase.js');

const credits = require(path.join(path.resolve(__dirname, '..'), 'api', '_shared', 'credits-core.js'));

const ENV = envScope(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CREDIT_WELCOME_GRANT', 'CRON_SECRET']);
test.beforeEach(() => {
  ENV.save();
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.CREDIT_WELCOME_GRANT = '500';
  process.env.CRON_SECRET = 'cron-secret-for-gift-tests-0123456789';
});
test.afterEach(() => ENV.restore());

function world() {
  const db = new FakeSupabase();
  db.addUser('tok-a', 'user-a', 'a@example.test').addWorkspace('ws-a', 'user-a').setActive('user-a', 'ws-a')
    .addUser('tok-b', 'user-b', 'b@example.test').addWorkspace('ws-b', 'user-b').setActive('user-b', 'ws-b')
    .syncIdentityTables();
  installCreditsRpc(db);
  db.install();
  return db;
}
async function call(token, ws, op, body, headers) {
  const res = makeRes();
  await credits.handle(makeReq({ token, method: body ? 'POST' : 'GET', query: { op, workspace_id: ws }, body, headers }), res);
  return res;
}
const wallet = (db, u, ws) => db.find('credit_wallets', (w) => w.user_id === u && w.workspace_id === ws);

test('a person gifts from their own balance; the recipient receives it once, on their next balance read', async () => {
  const db = world();
  await call('tok-a', 'ws-a', 'balance');
  const sent = await call('tok-a', 'ws-a', 'gift', { email: 'B@Example.test', amount: 120, note: 'For the launch' });
  expect(sent.code).toBe(200);
  expect(sent.payload).toMatchObject({ ok: true, amount: 120, to: 'b***@example.test', balance: 380 });
  expect(wallet(db, 'user-a', 'ws-a').balance).toBe(380);
  const g = db.table('credit_gifts')[0];
  expect(g).toMatchObject({ status: 'pending', from_kind: 'user', amount: 120, to_email_hint: 'b***@example.test' });
  expect(JSON.stringify(g)).not.toContain('b@example.test');   // the address itself is never stored
  expect(db.table('credit_ledger').find((l) => l.kind === 'gift_sent')).toMatchObject({ delta: -120, ref: g.id });

  const first = await call('tok-b', 'ws-b', 'balance');
  expect(first.payload.gifts_received).toEqual({ count: 1, credits: 120 });
  expect(first.payload.wallet.balance).toBe(620);   // 500 welcome + 120 gift
  const again = await call('tok-b', 'ws-b', 'balance');
  expect(again.payload.gifts_received).toBeNull();
  expect(again.payload.wallet.balance).toBe(620);
  expect(db.table('credit_gifts')[0]).toMatchObject({ status: 'claimed', claimed_by: 'user-b' });

  const list = await call('tok-a', 'ws-a', 'gifts');
  expect(list.payload.gifts).toEqual([expect.objectContaining({ to_email_hint: 'b***@example.test', amount: 120, status: 'claimed' })]);
});

test('a gift larger than the balance, to yourself, or with a bad email or amount is refused, and nothing moves', async () => {
  const db = world();
  await call('tok-a', 'ws-a', 'balance');
  expect((await call('tok-a', 'ws-a', 'gift', { email: 'b@example.test', amount: 10000 })).code).toBe(402);
  expect((await call('tok-a', 'ws-a', 'gift', { email: 'A@example.test', amount: 5 })).payload.error).toBe('gift_to_self');
  expect((await call('tok-a', 'ws-a', 'gift', { email: 'not-an-email', amount: 5 })).payload.error).toBe('gift_email_invalid');
  expect((await call('tok-a', 'ws-a', 'gift', { email: 'b@example.test', amount: 2.5 })).payload.error).toBe('gift_amount_invalid');
  expect((await call('tok-a', 'ws-a', 'gift', { email: 'b@example.test', amount: 0 })).payload.error).toBe('gift_amount_invalid');
  expect(wallet(db, 'user-a', 'ws-a').balance).toBe(500);
  expect(db.table('credit_gifts')).toEqual([]);
});

test('the operator grants with the deployment secret and debits nobody; with neither a session nor the secret, nothing is sent', async () => {
  const db = world();
  const op = await call(null, null, 'gift', { email: 'new.person@example.test', amount: 250 }, { authorization: `Bearer ${process.env.CRON_SECRET}` });
  expect(op.code).toBe(200);
  expect(op.payload).toMatchObject({ ok: true, from: 'operator', amount: 250, to: 'n***@example.test' });
  expect(db.table('credit_gifts')[0]).toMatchObject({ from_kind: 'operator', from_user: null, status: 'pending' });
  expect(db.table('credit_ledger').filter((l) => l.kind === 'gift_sent')).toEqual([]);

  const anon = await call(null, null, 'gift', { email: 'b@example.test', amount: 5 });
  expect(anon.code).toBe(401);
  expect(db.table('credit_gifts').length).toBe(1);
});
