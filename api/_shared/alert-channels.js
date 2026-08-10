'use strict';

/**
 * Multi-channel anomaly delivery for Data Analysis.
 * Gmail is the primary email transport so alerts can originate from the
 * requested KNICKGASM mailbox. Google Chat and SMS are optional and independently
 * configurable. Missing credentials return an honest `would_send` envelope.
 */

// Global live-connector kill-switch (default OFF) + env-driven sender identity
// (no hardcoded personal mailbox).
const { liveConnectorsEnabled, senderIdentity } = require('./live-connectors.js');
const DEFAULT_SENDER = '';

function clean(v) { return String(v == null ? '' : v).trim(); }
function senderEmail() { return senderIdentity() || DEFAULT_SENDER; }
function b64url(v) { return Buffer.from(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

async function fetchJson(url, options, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...(options || {}), signal: ctrl.signal });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
    return { ok: r.ok, status: r.status, body };
  } finally { clearTimeout(timer); }
}

async function gmailAccessToken() {
  const clientId = clean(process.env.GMAIL_CLIENT_ID);
  const clientSecret = clean(process.env.GMAIL_CLIENT_SECRET);
  const refreshToken = clean(process.env.GMAIL_REFRESH_TOKEN);
  if (!clientId || !clientSecret || !refreshToken) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const r = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return r.ok && r.body && r.body.access_token ? r.body.access_token : null;
}

function mimeMessage({ to, subject, html, text }) {
  const from = senderEmail();
  const boundary = `knickgasm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: Lifecycle OS <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text || subject,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html || `<p>${esc(text || subject)}</p>`,
    '',
    `--${boundary}--`,
  ];
  return lines.join('\r\n');
}

async function sendGmail({ to, subject, html, text }) {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  const configured = liveConnectorsEnabled() && !!(clean(process.env.GMAIL_CLIENT_ID) && clean(process.env.GMAIL_CLIENT_SECRET) && clean(process.env.GMAIL_REFRESH_TOKEN));
  if (!configured) return { channel: 'gmail', sent: false, connected: false, live_connectors_disabled: !liveConnectorsEnabled(), would_send: { from: senderEmail(), to: recipients, subject } };
  const token = await gmailAccessToken();
  if (!token) return { channel: 'gmail', sent: false, connected: true, error: 'gmail_oauth_token_failed' };
  const results = [];
  for (const recipient of recipients) {
    const raw = b64url(mimeMessage({ to: recipient, subject, html, text }));
    const r = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    results.push({ to: recipient, sent: r.ok, status: r.status, id: r.body && r.body.id, error: r.ok ? null : r.body });
  }
  return { channel: 'gmail', connected: true, sent: results.length > 0 && results.every((x) => x.sent), from: senderEmail(), results };
}

async function sendResendFallback({ to, subject, html, text }) {
  const key = liveConnectorsEnabled() ? clean(process.env.RESEND_API_KEY) : '';
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!key) return { channel: 'resend', sent: false, connected: false, live_connectors_disabled: !liveConnectorsEnabled(), would_send: { from: senderEmail(), to: recipients, subject } };
  const r = await fetchJson('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: `Lifecycle OS <${senderEmail()}>`, to: recipients, subject, html, text: text || '' }),
  });
  return { channel: 'resend', connected: true, sent: r.ok, status: r.status, id: r.body && r.body.id, error: r.ok ? null : r.body };
}

async function sendEmail(payload) {
  const gmail = await sendGmail(payload);
  if (gmail.sent || gmail.connected) return gmail;
  return sendResendFallback(payload);
}

async function sendGoogleChat({ text }) {
  const url = liveConnectorsEnabled() ? clean(process.env.GOOGLE_CHAT_WEBHOOK_URL) : '';
  if (!url) return { channel: 'google_chat', sent: false, connected: false, live_connectors_disabled: !liveConnectorsEnabled(), would_send: { text } };
  const r = await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return { channel: 'google_chat', connected: true, sent: r.ok, status: r.status, error: r.ok ? null : r.body };
}

async function sendSms({ to, text }) {
  const live = liveConnectorsEnabled();
  const sid = live ? clean(process.env.TWILIO_ACCOUNT_SID) : '';
  const token = live ? clean(process.env.TWILIO_AUTH_TOKEN) : '';
  const from = live ? clean(process.env.TWILIO_FROM_NUMBER) : '';
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!sid || !token || !from) return { channel: 'sms', sent: false, connected: false, live_connectors_disabled: !live, would_send: { from, to: recipients, text } };
  const results = [];
  for (const recipient of recipients) {
    const body = new URLSearchParams({ To: recipient, From: from, Body: String(text || '').slice(0, 1500) });
    const r = await fetchJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    results.push({ to: recipient, sent: r.ok, status: r.status, sid: r.body && r.body.sid, error: r.ok ? null : r.body });
  }
  return { channel: 'sms', connected: true, sent: results.length > 0 && results.every((x) => x.sent), results };
}

async function dispatch({ subject, html, text, settings = {} }) {
  const channels = settings.channels || {};
  const recipients = settings.recipients || {};
  const tasks = [];
  if (channels.gmail !== false) tasks.push(sendEmail({ to: recipients.email || process.env.ALERT_EMAIL || DEFAULT_SENDER, subject, html, text }));
  if (channels.google_chat) tasks.push(sendGoogleChat({ text: text || subject }));
  if (channels.sms) tasks.push(sendSms({ to: recipients.sms || process.env.ALERT_SMS_TO || '', text: text || subject }));
  const results = await Promise.all(tasks.map((p) => p.catch((e) => ({ sent: false, error: String(e && e.message || e) }))));
  return {
    sender: senderEmail(),
    attempted: tasks.length,
    sent_any: results.some((r) => r && r.sent),
    results,
  };
}

module.exports = {
  DEFAULT_SENDER,
  senderEmail,
  sendEmail,
  sendGmail,
  sendGoogleChat,
  sendSms,
  dispatch,
};
