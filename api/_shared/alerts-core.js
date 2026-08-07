'use strict';
/**
 * alerts-core.js — revenue/number monitoring: anomaly detection, 2-hour progress
 * pulses, and an end-of-day (EOD) forecast, delivered by email.
 * ---------------------------------------------------------------------------
 * DEGRADES CLEANLY (nothing spams, nothing fabricates):
 *  - No RESEND_API_KEY  → sendEmail returns a {sent:false, would_send} stub.
 *  - Anomaly detection runs NOW on the REAL monthly market data (month-over-month
 *    vs a trailing baseline) — no live feed required.
 *  - Pulses + EOD forecast need INTRADAY data (Shopify/Klaviyo feeds, B3). Until
 *    that is wired they return a clear "waiting on live intraday feed" status and
 *    send nothing, rather than alerting on assumptions.
 * Recipient: ALERT_EMAIL env (unset by default — no hardcoded mailbox).
 * Live sending is gated by the LIVE_CONNECTORS kill-switch (default OFF): while
 * off, sendEmail always returns a would_send stub and never sends.
 * Wired to CRON_SECRET-guarded actions in api/brain.js:
 *   ?action=alerts-anomaly  (every ~15 min via GitHub Actions)
 *   ?action=alerts-pulse    (every 2 hours)
 *   ?action=alerts-eod      (once, end of day)
 * ---------------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const { liveConnectorsEnabled, senderIdentity } = require('./live-connectors.js');
const ALERT_EMAIL = () => (process.env.ALERT_EMAIL || senderIdentity() || '');
const ALERT_FROM = () => (process.env.ALERT_FROM || 'KNICKGASM Lifecycle OS <alerts@knickgasm.com>');

// Thresholds (fractional). A completed period must move beyond these vs the
// trailing baseline to raise an anomaly.
const TH = { revenue_drop: 0.20, revenue_spike: 0.40, orders_drop: 0.25, aov_drop: 0.12 };

// ── Email (Resend). Degrades to a stub when no key. ─────────────────────────
async function sendEmail(subject, html, text) {
  const key = liveConnectorsEnabled() ? process.env.RESEND_API_KEY : '';
  const to = ALERT_EMAIL();
  if (!key) return { sent: false, connected: false, live_connectors_disabled: !liveConnectorsEnabled(), would_send: { to, subject } };
  if (typeof fetch !== 'function') return { sent: false, connected: true, error: 'fetch unavailable' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ALERT_FROM(), to, subject, html, text: text || '' }),
    });
    const body = await r.json().catch(() => ({}));
    return { sent: r.ok, connected: true, id: body && body.id, status: r.status };
  } catch (e) { return { sent: false, connected: true, error: String(e.message || e) }; }
}

// Brand-styled email shell (green header, never a black background).
function emailShell(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:'Instrument Sans',Helvetica,Arial,sans-serif;color:#111111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #ece4d2;border-radius:10px;overflow:hidden">
  <tr><td style="background:#D0473E;color:#FFFFFF;padding:18px 22px;font-family:'Montserrat',Georgia,serif;font-size:18px">KNICKGASM Lifecycle OS · ${esc(title)}</td></tr>
  <tr><td style="padding:20px 22px;font-size:14px;line-height:1.6">${bodyHtml}</td></tr>
  <tr><td style="background:#D0473E;color:#FFFFFF99;padding:14px 22px;font-size:11px">Automated monitoring · sent to ${esc(ALERT_EMAIL())}</td></tr>
</table></td></tr></table></body></html>`;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

// ── Real market-data series (monthly), loaded from the built export. ────────
function loadMarkets() {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'data', 'analytics', 'market-data.js'), 'utf8');
    const json = raw.replace(/^[^=]*=\s*/, '').replace(/;\s*$/, '');
    const d = JSON.parse(json);
    return (d && d.markets) || {};
  } catch (_) { return {}; }
}

// A month is "partial" (incomplete export) if its sales are < 45% of the prior
// month — excluded from the completed-period comparison, same rule as the
// dashboard so alerts and the UI agree.
function completedMonthly(monthly) {
  const m = (monthly || []).slice();
  if (m.length >= 2) { const l = m[m.length - 1], p = m[m.length - 2]; if (p.sales > 0 && l.sales < p.sales * 0.45) m.pop(); }
  return m;
}

// ── Anomaly detection (real, month-over-month vs trailing baseline). ────────
function detectAnomalies() {
  const markets = loadMarkets();
  const out = [];
  for (const [mkt, data] of Object.entries(markets)) {
    const mm = completedMonthly(data.monthly);
    if (mm.length < 4) continue; // need a baseline
    const latest = mm[mm.length - 1];
    const base = mm.slice(-4, -1); // trailing 3 completed months
    const avg = (k) => base.reduce((a, b) => a + (b[k] || 0), 0) / base.length;
    const chk = (k, lbl, dropTh, spikeTh) => {
      const b = avg(k); if (!b) return; const cur = latest[k] || 0; const d = (cur - b) / b;
      if (d <= -dropTh) out.push({ market: mkt, metric: lbl, severity: 'critical', direction: 'drop', pct: Math.round(d * 100), current: cur, baseline: Math.round(b), month: latest.month });
      else if (spikeTh && d >= spikeTh) out.push({ market: mkt, metric: lbl, severity: 'watch', direction: 'spike', pct: Math.round(d * 100), current: cur, baseline: Math.round(b), month: latest.month });
    };
    chk('sales', 'Revenue', TH.revenue_drop, TH.revenue_spike);
    chk('orders', 'Orders', TH.orders_drop, null);
    chk('aov', 'AOV', TH.aov_drop, null);
  }
  return out;
}

async function runAnomaly() {
  const anomalies = detectAnomalies();
  if (!anomalies.length) return { ok: true, kind: 'anomaly', anomalies: [], note: 'No anomalies vs the trailing baseline (real monthly market data).', email: { sent: false, reason: 'nothing to report' } };
  const rows = anomalies.map((a) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${esc(a.market)}</b></td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(a.metric)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;color:${a.direction === 'drop' ? '#c0392b' : '#D0473E'}">${a.pct >= 0 ? '+' : ''}${a.pct}% vs baseline</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(a.month)}</td></tr>`).join('');
  const html = emailShell('Revenue anomaly alert', `<p>${anomalies.length} metric(s) moved beyond the alert threshold vs the trailing 3-month baseline:</p><table style="border-collapse:collapse;width:100%;font-size:13px"><tr style="text-align:left;color:#7a6e5a"><th style="padding:6px 10px">Market</th><th style="padding:6px 10px">Metric</th><th style="padding:6px 10px">Move</th><th style="padding:6px 10px">Period</th></tr>${rows}</table><p style="color:#7a6e5a;font-size:12px;margin-top:14px">Computed from the real monthly market export. Intraday anomaly precision improves once the live Shopify/Klaviyo feed is wired.</p>`);
  const email = await sendEmail(`[KNICKGASM] Revenue anomaly: ${anomalies.length} flagged`, html);
  return { ok: true, kind: 'anomaly', anomalies, email };
}

// ── 2-hour pulse + EOD forecast — need intraday data (B3). Degrade honestly. ─
function intradayAvailable() {
  // A real intraday source (Shopify orders feed) is not wired yet. When it is,
  // this reads today's running totals; until then, pulses/EOD degrade.
  return String(process.env.INTRADAY_FEED_READY || '') === '1';
}
async function runPulse() {
  if (!intradayAvailable()) return { ok: true, kind: 'pulse', skipped: true, note: 'Waiting on the live intraday feed (Shopify orders). No pulse sent — pulses need real running totals, not assumptions.' };
  // (When INTRADAY_FEED_READY=1, compute running totals vs same-time-yesterday
  // and email a short progress line. Left as the integration point for B3.)
  return { ok: true, kind: 'pulse', note: 'Intraday feed flagged ready — wire the running-total source here.', email: { sent: false } };
}
async function runEod() {
  if (!intradayAvailable()) return { ok: true, kind: 'eod', skipped: true, note: 'Waiting on the live intraday feed (Shopify orders). No EOD forecast sent — a forecast needs real intraday pace.' };
  return { ok: true, kind: 'eod', note: 'Intraday feed flagged ready — wire the pace-based EOD projection here.', email: { sent: false } };
}

async function run(kind) {
  if (kind === 'anomaly') return runAnomaly();
  if (kind === 'pulse') return runPulse();
  if (kind === 'eod') return runEod();
  return { ok: false, error: `unknown alert kind: ${kind}` };
}

module.exports = { run, runAnomaly, runPulse, runEod, detectAnomalies, sendEmail, ALERT_EMAIL, TH };
