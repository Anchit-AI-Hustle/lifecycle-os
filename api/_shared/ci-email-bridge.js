'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Sheet → ci_emails BRIDGE.
//
// The legacy competitor-email capture lands in a Google Sheet (IMAP sync, see
// competitor-core.js). This bridge mirrors those rows into the unified ci_emails
// table so emails sit alongside ads / landing pages / offers in the Brand View
// and feed funnel reconstruction + enrichment.
//
// One-way, idempotent: dedup is by ci-collect.collectEmail's content hash
// (sender+subject+send_date), so re-running only adds genuinely new mail. Offer
// extraction runs automatically inside collectEmail. The Sheet stays the system
// of record for capture; this is a read-mirror, not a migration that deletes.
//
// Runs server-side (the deployed function holds the Google creds) — no local
// worker required. Exposed at /api/competitor?action=ci-email-sync.
// ─────────────────────────────────────────────────────────────────────────────

const core = require('./competitor-core');
const ciCollect = require('./ci-collect');

const NONEISH = (v) => !v || v === 'NONE' || v === 'No screenshot' || v === '—';

function splitList(v) {
  if (NONEISH(v)) return [];
  return String(v).split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

function parsePromos(v) {
  if (NONEISH(v)) return [];
  return String(v).split(/[,;]+/).map(s => s.trim()).filter(Boolean).map(code => ({ code }));
}

function toIso(received) {
  if (!received) return null;
  const d = new Date(received);
  return isNaN(d.getTime()) ? String(received) : d.toISOString();
}

// Mirror every sheet email into ci_emails. opts: { limit, html=true }
async function sync(opts = {}) {
  const limit = Number(opts.limit || 0);
  const withHtml = opts.html !== false;
  let emails = await core.getAllEmails();
  if (limit) emails = emails.slice(0, limit);

  let mirrored = 0, seen = 0, errors = 0;
  for (const e of emails) {
    try {
      let html = '';
      if (withHtml) { try { html = await core.getEmailHtml(e.id); } catch { /* col K optional */ } }
      const res = await ciCollect.collectEmail({
        source: 'inbox',
        brand_name: e.brand && e.brand !== 'Unknown' ? e.brand : (e.senderEmail || null),
        sender: e.senderEmail || null,
        subject: e.subject || null,
        preheader: e.preview || null,
        send_date: toIso(e.receivedAt),
        plain_text: e.bodyText || null,
        html: html || null,
        promotions: parsePromos(e.promoCodes),
        images: splitList(e.inlineImageUrls),
        attachments: splitList(e.attachmentUrls).map(url => ({ url })),
        source_link: NONEISH(e.screenshotUrl) ? null : e.screenshotUrl
      });
      if (res.status === 'new') mirrored++; else seen++;
    } catch (err) {
      errors++;
      if (errors <= 5) console.warn('[ci-email-bridge] row', e.id, 'failed:', err.message);
    }
  }
  return { ok: true, scanned: emails.length, mirrored, already_present: seen, errors };
}

module.exports = { sync };
