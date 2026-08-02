'use strict';

/**
 * api/_shared/live-connectors.js — central kill-switch for outbound LIVE connectors.
 *
 * Default is OFF. With the switch off (the default), the app never opens a live
 * external connection and never sends from a personal identity — every gated
 * connector falls back to its honest "not connected" / snapshot / would-send
 * path instead. This keeps the app fully functional on cached/snapshot data
 * without touching Snowflake, Klaviyo, PageDeck, Gmail/Resend, Twilio or Google
 * Chat, and without using anyone's work mailbox.
 *
 * Re-enable everything by setting  LIVE_CONNECTORS=on  (plus the relevant
 * provider keys) in the environment. Nothing is removed — this is a reversible
 * flag, not a deletion.
 *
 * The Supabase datastore is the app's own backing store (auth, settings,
 * cached mirrors) — it is infrastructure, not an outbound connector, and is
 * intentionally NOT gated here.
 */

function liveConnectorsEnabled() {
  const v = String(process.env.LIVE_CONNECTORS == null ? '' : process.env.LIVE_CONNECTORS).trim().toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes' || v === 'enabled';
}

// Sender/alert identity is env-driven with NO hardcoded personal default.
// Returns '' when unset — connectors treat an empty sender as "not configured".
function senderIdentity() {
  return String(process.env.ALERT_EMAIL || process.env.SENDER_EMAIL || '').trim();
}

module.exports = { liveConnectorsEnabled, senderIdentity };
