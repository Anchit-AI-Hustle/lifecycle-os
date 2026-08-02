#!/usr/bin/env node
/**
 * End-to-end smoke test for the TencentDB memory chain.
 * Requires the gateway running (see setup.sh). Exercises the REAL endpoints:
 *   /health -> /capture -> /session/end -> /recall -> /search/memories
 * Prints PASS/FAIL per step. Zero fabrication: it only reports what the gateway
 * actually returns.
 *
 *   TDAI_GATEWAY_URL=http://127.0.0.1:8420 node scripts/smoke.mjs
 */
import { randomUUID } from 'node:crypto';
const BASE = (process.env.TDAI_GATEWAY_URL || 'http://127.0.0.1:8420').replace(/\/+$/, '');
const KEY = process.env.TDAI_GATEWAY_API_KEY || '';
// A throwaway session id for this run — cryptographically random, never from env.
const SESSION = 'smoke-' + randomUUID().slice(0, 8);

async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (KEY) headers.Authorization = 'Bearer ' + KEY;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) {}
  return { ok: res.ok, status: res.status, json, text };
}
const P = (n, ok, extra) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);

(async () => {
  let fails = 0;
  const h = await call('GET', '/health');
  const hok = h.ok && h.json && (h.json.status === 'ok' || h.json.status === 'degraded');
  P('health', hok, h.json ? `status=${h.json.status}` : `HTTP ${h.status}`); if (!hok) fails++;

  const cap = await call('POST', '/capture', {
    user_content: 'My favourite KNICKGASM sneaker is the Original Hand-painted Kicks and I drink it every morning.',
    assistant_content: 'Noted — Original Hand-painted Kicks, every morning. I will remember that preference.',
    session_key: SESSION,
  });
  P('capture', cap.ok, cap.json ? JSON.stringify(cap.json) : `HTTP ${cap.status}`); if (!cap.ok) fails++;

  const end = await call('POST', '/session/end', { session_key: SESSION });
  P('session/end (flush distillation)', end.ok, end.json ? JSON.stringify(end.json) : `HTTP ${end.status}`); if (!end.ok) fails++;

  const rec = await call('POST', '/recall', { query: 'What sneaker does the user like in the morning?', session_key: SESSION });
  const rok = rec.ok && rec.json && typeof rec.json.context === 'string';
  P('recall', rok, rec.json ? `memory_count=${rec.json.memory_count}` : `HTTP ${rec.status}`); if (!rok) fails++;

  const srch = await call('POST', '/search/memories', { query: 'morning sneaker preference', limit: 5 });
  P('search/memories', srch.ok, srch.json ? `total=${srch.json.total}` : `HTTP ${srch.status}`); if (!srch.ok) fails++;

  console.log(`\n${fails === 0 ? 'ALL PASSED' : fails + ' STEP(S) FAILED'} — gateway ${BASE}, session "${SESSION}".`);
  if (rok && rec.json.context) console.log('\nRecalled context:\n' + rec.json.context.slice(0, 600));
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error('smoke error:', e.message); process.exit(1); });
