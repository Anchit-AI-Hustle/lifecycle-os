// ============================================================================
// klaviyo-sync.js — read-only Klaviyo → Supabase sync adapter.
//
// Pulls segments (+ live profile_count), tracked metrics, and email campaigns
// from Klaviyo using ONLY read-only GET calls (via klaviyo-core, which blocks
// every non-GET), then upserts them into the klaviyo_* mirror tables in
// Supabase. Supabase is the sink: the app reads cohort sizes / metrics /
// campaign performance from those tables, never from Klaviyo at request time.
//
// NOT a serverless function (underscore-shared): required by os-backbone's
// syncConnector so both the manual sync and the daily job pull the same way.
// Idempotent (upsert on id); safe to run repeatedly; never fabricates.
// ============================================================================
const kl = require('./klaviyo-core.js');
const supa = require('./supa.js');

function nowIso() { return new Date().toISOString(); }

// Pull one Klaviyo collection and upsert the mapped rows into Supabase.
// Returns the row count written (0 on any read/shape failure — never throws up).
async function pull(table, fetchFn, mapRow) {
  const resp = await fetchFn().catch(() => null);
  const list = resp && resp.ok && resp.data && Array.isArray(resp.data.data) ? resp.data.data : [];
  if (!list.length) return 0;
  const syncedAt = nowIso();
  const rows = list.map((item) => mapRow(item, syncedAt)).filter(Boolean);
  if (!rows.length) return 0;
  await supa.insert(table, rows, { upsertOn: 'id' });   // service-role write into the sink
  return rows.length;
}

/**
 * `creds` are the workspace's OWN Klaviyo credentials.
 *
 * With no creds this used to fall through to KLAVIYO_API_KEY, the deployment's
 * key, and mirror THAT account's segments, metrics and campaigns into the
 * klaviyo_* tables - which the mailer dashboard then read as the brand's own
 * lifecycle performance. The mirror is only ever populated from an account the
 * workspace itself connected.
 */
async function run({ creds = null } = {}) {
  if (!creds) {
    return { ok: false, connected: false, records: 0, breakdown: {}, message: 'This brand has not connected a Klaviyo account. The deployment key belongs to another account and is never mirrored into this workspace.' };
  }
  if (!kl.isConnected(creds)) {
    return { ok: false, connected: false, records: 0, breakdown: {}, message: 'Klaviyo is connected for this brand but live connectors are disabled (LIVE_CONNECTORS is off) — nothing pulled.' };
  }
  const breakdown = {};
  try {
    breakdown.segments = await pull('klaviyo_segments', () => kl.getSegments({ limit: 100, creds }), (s, at) => ({
      id: s.id,
      name: (s.attributes && s.attributes.name) || null,
      profile_count: (s.attributes && s.attributes.profile_count != null) ? s.attributes.profile_count : null,
      klaviyo_created: (s.attributes && s.attributes.created) || null,
      klaviyo_updated: (s.attributes && s.attributes.updated) || null,
      raw: s, synced_at: at,
    }));

    breakdown.metrics = await pull('klaviyo_metrics', () => kl.getMetrics({ limit: 100, creds }), (m, at) => ({
      id: m.id,
      name: (m.attributes && m.attributes.name) || null,
      integration: (m.attributes && m.attributes.integration && m.attributes.integration.name) || null,
      raw: m, synced_at: at,
    }));

    breakdown.campaigns = await pull('klaviyo_campaigns', () => kl.getCampaigns({ channel: 'email', limit: 50, creds }), (c, at) => ({
      id: c.id,
      name: (c.attributes && c.attributes.name) || null,
      status: (c.attributes && c.attributes.status) || null,
      channel: 'email',
      send_time: (c.attributes && (c.attributes.send_time || c.attributes.scheduled_at)) || null,
      raw: c, synced_at: at,
    }));

    const records = Object.values(breakdown).reduce((a, b) => a + (b || 0), 0);
    const parts = Object.entries(breakdown).map(([k, v]) => `${k}:${v}`).join(', ');
    return { ok: true, connected: true, records, breakdown, message: `Klaviyo read-only sync: pulled ${records} records (${parts}) into Supabase.` };
  } catch (e) {
    return { ok: false, connected: true, records: 0, breakdown, message: `Klaviyo sync error: ${String(e && e.message || e).slice(0, 160)}` };
  }
}

module.exports = { run };
