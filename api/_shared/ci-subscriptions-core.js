'use strict';

/**
 * ci-subscriptions-core.js  (cap-free _shared module)
 *
 * User-facing competitor subscriptions: a logged-in user follows a competitor
 * brand and gets a REAL-TIME email for each NEW mailer and/or NEW ad captured
 * for that brand. Called from the capture insert points (ci-collect.js) so the
 * email fires the moment an asset is stored — no digest, no cron delay.
 *
 * Everything is fail-soft: a missing Supabase config, a missing email key, or any
 * error must NEVER break the capture pipeline. notifyNewAsset resolves quietly.
 */

const supa = require('./supa');

function brandKey({ brand_name, domain, brand_key } = {}) {
  if (brand_key) return String(brand_key).toLowerCase().trim();
  const base = String(brand_name || domain || '').toLowerCase().trim();
  return base.replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function configured() {
  try { const e = supa.env(); return !!(e && e.url && e.key); } catch (_) { return false; }
}

// ── subscription CRUD ───────────────────────────────────────────────────────
async function listForUser(userEmail) {
  if (!configured() || !userEmail) return [];
  try {
    return await supa.select('ci_user_subscriptions', {
      filters: { user_email: `eq.${userEmail}` }, order: 'brand_name.asc', limit: 1000,
    });
  } catch (_) { return []; }
}

async function setSub({ userEmail, brand_id = null, brand_name = '', domain = '', mailers = true, ads = true, active = true }) {
  if (!configured()) return { ok: false, error: 'supabase_not_configured' };
  if (!userEmail) return { ok: false, error: 'user_required' };
  const key = brandKey({ brand_name, domain });
  if (!key) return { ok: false, error: 'brand_required' };
  try {
    const row = {
      user_email: userEmail, brand_id: brand_id || null, brand_key: key,
      brand_name: brand_name || null, mailers: !!mailers, ads: !!ads, active: !!active,
      updated_at: new Date().toISOString(),
    };
    await supa.insert('ci_user_subscriptions', [row], { upsertOn: 'user_email,brand_key' });
    return { ok: true, subscription: row };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

// Users who follow this brand on a given channel ('mailers' | 'ads').
async function subscribersForBrand({ brand_id, brand_name, domain }, channel) {
  if (!configured()) return [];
  const key = brandKey({ brand_name, domain });
  const rows = [];
  try {
    if (brand_id) {
      const byId = await supa.select('ci_user_subscriptions', { filters: { brand_id: `eq.${brand_id}`, active: 'eq.true' }, limit: 1000 });
      rows.push(...byId);
    }
    if (key) {
      const byKey = await supa.select('ci_user_subscriptions', { filters: { brand_key: `eq.${key}`, active: 'eq.true' }, limit: 1000 });
      rows.push(...byKey);
    }
  } catch (_) { return []; }
  // de-dup by user_email, keep only those following this channel
  const seen = new Set();
  return rows.filter(r => {
    if (seen.has(r.user_email)) return false;
    seen.add(r.user_email);
    return channel === 'mailers' ? r.mailers !== false : r.ads !== false;
  });
}

// ── email send (minimal Resend, arbitrary recipient) ────────────────────────
function fromAddress() { return process.env.ALERT_FROM || process.env.RESEND_FROM || 'KNICKGASM Lifecycle OS <onboarding@resend.dev>'; }

async function sendEmailTo(to, subject, html, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, connected: false, would_send: { to, subject } };
  if (typeof fetch !== 'function') return { sent: false, error: 'fetch_unavailable' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromAddress(), to, subject, html, text: text || '' }),
    });
    const body = await r.json().catch(() => ({}));
    return { sent: r.ok, id: body && body.id, status: r.status };
  } catch (e) { return { sent: false, error: String(e && e.message || e) }; }
}

async function alreadySent(userEmail, assetType, assetId) {
  try {
    const rows = await supa.select('ci_notification_log', {
      filters: { user_email: `eq.${userEmail}`, asset_type: `eq.${assetType}`, asset_id: `eq.${assetId}` }, limit: 1,
    });
    return rows.length > 0;
  } catch (_) { return false; }
}

async function markSent(userEmail, assetType, assetId, ok) {
  try {
    await supa.insert('ci_notification_log',
      [{ user_email: userEmail, asset_type: assetType, asset_id: assetId, ok: !!ok }],
      { upsertOn: 'user_email,asset_type,asset_id' });
  } catch (_) { /* dedup index may race; ignore */ }
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function assetEmailHtml({ channel, brand, asset }) {
  const isAd = channel === 'ads';
  const title = isAd ? (asset.headline || asset.creative_type || 'New ad') : (asset.subject || 'New mailer');
  const platform = isAd ? (asset.source || 'ad') : 'mailer';
  const thumb = isAd
    ? ((asset.image_urls && asset.image_urls[0]) || '')
    : ((asset.images && asset.images[0]) || '');
  const links = [];
  if (asset.landing_url) links.push(`<a href="${esc(asset.landing_url)}" style="color:#6A33D8">Landing page</a>`);
  if (asset.source_link) links.push(`<a href="${esc(asset.source_link)}" style="color:#6A33D8">View ${esc(platform)}</a>`);
  return `<!doctype html><html><body style="margin:0;background:#FFFFFF;font-family:'Helvetica Neue',Arial,sans-serif;color:#111111">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#D0473E;color:#FFFFFF;padding:16px 20px;border-radius:12px 12px 0 0">
      <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#d9c9a3">Competitor update . ${esc(platform)}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(brand)}</div>
    </div>
    <div style="background:#fff;border:1px solid #e4dcc9;border-top:none;border-radius:0 0 12px 12px;padding:20px">
      <div style="font-size:16px;font-weight:700;margin-bottom:10px">${esc(title)}</div>
      ${thumb ? `<img src="${esc(thumb)}" alt="asset" style="max-width:100%;border-radius:8px;border:1px solid #eee"/>` : ''}
      ${asset.preview ? `<p style="color:#556059;font-size:14px">${esc(String(asset.preview).slice(0, 240))}</p>` : ''}
      <p style="font-size:13px;margin-top:14px">${links.join(' &nbsp;·&nbsp; ')}</p>
      <p style="font-size:11px;color:#8a8a80;margin-top:18px">You follow ${esc(brand)} in KNICKGASM Lifecycle OS Competitor Benchmarking. Real-time ${esc(channel)} updates.</p>
    </div>
  </div></body></html>`;
}

/**
 * notifyNewAsset — real-time fan-out for a freshly captured asset. Fire-and-forget
 * from the capture path; never throws.
 *   channel: 'mailers' | 'ads'
 *   asset:   the stored ci_emails / ci_ads row (must have id, brand fields)
 */
async function notifyNewAsset({ channel, asset }) {
  try {
    if (!asset || !asset.id) return { notified: 0 };
    const assetType = channel === 'ads' ? 'ad' : 'mailer';
    const brand = asset.brand_name || asset.brand || '';
    const subs = await subscribersForBrand({ brand_id: asset.brand_id, brand_name: brand }, channel);
    if (!subs.length) return { notified: 0 };
    const subject = channel === 'ads'
      ? `New ad from ${brand}`
      : `New mailer from ${brand}: ${String(asset.subject || '').slice(0, 80)}`;
    const html = assetEmailHtml({ channel, brand, asset });
    let notified = 0;
    for (const s of subs) {
      if (await alreadySent(s.user_email, assetType, asset.id)) continue;
      const r = await sendEmailTo(s.user_email, subject, html, '');
      await markSent(s.user_email, assetType, asset.id, r.sent);
      if (r.sent) notified++;
    }
    return { notified };
  } catch (e) {
    console.warn('[ci-subscriptions] notify skipped: ' + String(e && e.message || e).slice(0, 140));
    return { notified: 0, error: true };
  }
}

module.exports = { listForUser, setSub, subscribersForBrand, notifyNewAsset, sendEmailTo, brandKey };
