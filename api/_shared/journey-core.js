'use strict';

/**
 * journey-core.js — link-by-link journey analysis across every platform.
 *
 * THE JOIN KEY IS THE LINK, because it is the only thing that actually exists on
 * every side. There is no shared identity graph between Meta, Google, Klaviyo,
 * WebEngage and Shopify in this stack: no common customer id, no cross-platform
 * click id we store. What every one of them DOES write is a destination URL with
 * UTM parameters, and Shopify records the one the buyer arrived on in the order's
 * `landing_site`. So the link is the join, and it is the honest one — anything
 * richer would require an identity resolution we do not have and would be
 * invented.
 *
 * WHAT THIS IS NOT, stated because the difference is easy to lose:
 *   - NOT multi-touch attribution. `landing_site` is the LAST click before the
 *     order. A journey with five touches shows up here as its final one. Shopify
 *     does expose a multi-touch customerJourneySummary, but it lives in GraphQL
 *     behind a different scope we do not hold; claiming multi-touch from
 *     last-click data would be the most seductive fabrication available here.
 *   - NOT the email platform's own attribution. Klaviyo counts a conversion by
 *     its own window and rules. This counts orders whose OWN record says they
 *     arrived from that link. When the two disagree, the gap is the finding, and
 *     it is reported rather than reconciled away.
 *
 * EVERY PLATFORM EITHER CONTRIBUTES ROWS OR CONTRIBUTES A BLOCKER. A platform
 * with no credential contributes neither zeros nor an absence — it contributes
 * the reason, so a link that looks unattributed is never mistaken for a link
 * that performed badly.
 *
 * HISTORICAL AND LIVE ARE LABELLED, NEVER BLENDED. The Shopify CSV exports are
 * real historical orders; the Admin API is current. Both are real, they cover
 * different windows, and silently concatenating them would double-count the
 * overlap and misdate the result. Each row carries `basis: 'historical'|'live'`.
 */

const shopify = require('./shopify-core.js');
const klaviyo = require('./klaviyo-core.js');
const webengage = require('./webengage-core.js');
const adInsights = require('./ad-insights-core.js');

// ── Link normalisation ──────────────────────────────────────────────────────
// Two links are the same touchpoint when they lead to the same place for the
// same reason. Host+path answers "where", the UTM tuple answers "why". Query
// params that are not UTMs (session ids, click ids, variant selectors) are
// dropped: keeping them would shatter one campaign into hundreds of unique
// "links" and make every aggregate meaningless.
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

function normaliseLink(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let u;
  try {
    u = new URL(s, s.startsWith('http') ? undefined : 'https://placeholder.invalid');
  } catch (_) { return null; }
  const utm = {};
  for (const k of UTM_KEYS) {
    const v = u.searchParams.get(k);
    if (v) utm[k] = v.toLowerCase().trim();
  }
  const rawHost = (u.hostname || '').replace(/^www\./, '').toLowerCase();
  // The placeholder host only exists because a relative URL needs a base to
  // parse; it is not a real host and must never reach the key or the display.
  const host = rawHost === 'placeholder.invalid' ? null : rawHost;
  // Trailing slash is not a different page.
  const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
  // THE KEY IS PATH + UTM, DELIBERATELY WITHOUT THE HOST.
  // Shopify writes `landing_site` as a RELATIVE path ("/collections/gifts?utm=…")
  // while an ad's destination URL is absolute ("https://<the brand's store host>/
  // collections/gifts?utm=…"). Including the host made those two keys differ, so the cost side
  // never joined the outcome side and every paid link rendered TWICE — once with
  // spend and no orders (flagged as a leak) and once with orders and no spend.
  // The ledger looked populated and was wrong in the most damaging direction:
  // it invented a leak for every campaign that was actually converting.
  // Cross-region collision is not a risk here because the ledger is built per
  // market, and the host is kept below for display.
  const key = [path, utm.utm_source || '-', utm.utm_medium || '-', utm.utm_campaign || '-', utm.utm_content || '-'].join('|');
  return {
    key,
    host: host || null,
    path,
    url: host ? `${u.protocol}//${host}${path}` : path,
    source: utm.utm_source || null,
    medium: utm.utm_medium || null,
    campaign: utm.utm_campaign || null,
    content: utm.utm_content || null,
    term: utm.utm_term || null,
    tagged: Object.keys(utm).length > 0,
  };
}

// Which platform a link most likely came from, read from the link ITSELF rather
// than guessed. Medium beats source: Klaviyo sends email and SMS under the same
// utm_source, so source alone would file every SMS click under email.
function channelOf(link) {
  const m = (link.medium || '').toLowerCase();
  const s = (link.source || '').toLowerCase();
  if (/^(cpc|ppc|paid|paid_social|paidsocial|display)$/.test(m)) {
    if (/facebook|meta|instagram|ig|fb/.test(s)) return 'meta';
    if (/google|adwords|gads/.test(s)) return 'google';
    if (/tiktok/.test(s)) return 'tiktok';
    if (/youtube|yt/.test(s)) return 'youtube';
    return 'paid_other';
  }
  if (/^(email|e-mail|newsletter)$/.test(m)) return 'email';
  if (/^(sms|text)$/.test(m)) return 'sms';
  if (/^push$/.test(m)) return 'push';
  if (/^(social|organic_social)$/.test(m)) {
    if (/instagram|ig/.test(s)) return 'instagram';
    if (/youtube|yt/.test(s)) return 'youtube';
    if (/facebook|fb/.test(s)) return 'facebook';
    return 'social_other';
  }
  if (/klaviyo/.test(s)) return 'email';
  if (/webengage/.test(s)) return 'push';
  if (!link.tagged) return 'untagged';
  return 'other';
}

// ── Per-platform collectors ────────────────────────────────────────────────
// Each returns { rows, blocker }. A blocker is a REASON, never an empty result
// dressed up as data.

async function outcomeSide({ market = 'US', days = 90, maxPages = 20 }) {
  // Shopify is the only side that knows revenue, so it anchors the ledger.
  //
  // Read orders directly rather than reusing attribution(): that function
  // aggregates by DATE and channel, which is the right shape for "best day to
  // send" and the wrong shape here — this needs one row per LINK. Same source,
  // same page walk, and deliberately the SAME exclusion filter (orderQuality),
  // so a revenue total here and the same total in the attribution report cannot
  // drift apart.
  let paged;
  try {
    paged = await shopify.readPagedOrders(market, { days, maxPages });
  } catch (e) {
    paged = { ok: false, error: String((e && e.message) || e) };
  }
  if (!paged || paged.ok === false || !Array.isArray(paged.orders)) {
    return {
      rows: [], basis: null,
      blocker: {
        platform: 'shopify',
        reason: (paged && (paged.blocker || paged.hint || paged.error)) || 'Shopify orders could not be read.',
        need_env: (paged && paged.need_env) || [],
        would_request: (paged && paged.would_request) || null,
        effect: 'No link can be tied to revenue, so every link below shows traffic-side figures only.',
      },
    };
  }

  const rows = [];
  let excluded = 0;
  for (const o of paged.orders) {
    const q = shopify.orderQuality(o);
    if (!q.counts) { excluded += 1; continue; }
    // landing_site is where the buyer ARRIVED; referring_site is only a fallback
    // for an untagged visit, and is marked as such so a referrer is never read
    // as a tagged campaign link.
    const link = normaliseLink(o.landing_site) || normaliseLink(o.referring_site);
    if (!link) continue;
    const rev = Number(o.total_price);
    rows.push({
      link,
      orders: 1,
      revenue: Number.isFinite(rev) ? rev : null,
      date: o.processed_at || o.created_at || null,
      from_referrer: !o.landing_site && !!o.referring_site,
    });
  }
  return {
    rows,
    basis: paged.basis || 'live',
    source_note: `${paged.orders.length} order(s) read across ${paged.pages || 1} page(s); ${excluded} excluded as test, cancelled or refunded.`,
    truncated: !!paged.truncated,
    blocker: null,
  };
}

async function sendSide({ market = 'US' }) {
  const blockers = [];
  const rows = [];

  // Klaviyo: campaigns are the mailer-level unit. Link-level clicks need the
  // campaign's own link report, which requires the campaign to have sent.
  // The sibling asked klaviyo.hasKey(); this repo's client resolves the
  // WORKSPACE's own key first and exposes isConnected(). Same question, and the
  // answer here is per brand rather than per deployment.
  if (!klaviyo.isConnected()) {
    blockers.push({
      platform: 'klaviyo',
      reason: 'Connect Klaviyo for this brand on the Connections page, or set KLAVIYO_API_KEY for the platform\'s own account.',
      effect: 'No mailer-level sends, opens or clicks.',
    });
  } else {
    const camps = await klaviyo.getCampaigns({ channel: 'email', limit: 50 }).catch((e) => ({ ok: false, error: String(e && e.message || e) }));
    if (!camps || !camps.ok) {
      blockers.push({
        platform: 'klaviyo',
        reason: (camps && (camps.blocker || camps.hint || JSON.stringify(camps.error))) || 'Klaviyo read failed.',
        would_request: (camps && camps.would_request) || null,
        effect: 'No mailer-level sends, opens or clicks.',
      });
    } else {
      for (const c of (camps.data && camps.data.data) || []) {
        rows.push({
          platform: 'klaviyo', kind: 'campaign',
          id: c.id,
          name: (c.attributes && c.attributes.name) || c.id,
          sent_at: (c.attributes && (c.attributes.send_time || c.attributes.scheduled_at)) || null,
          status: (c.attributes && c.attributes.status) || null,
        });
      }
    }
  }

  // WebEngage: push/campaign engagement lives in a synced table.
  const we = await webengage.campaignPerformance({ market, hours: 24 * 30, top: 50 })
    .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  if (!we || we.ok === false) {
    blockers.push({ platform: 'webengage', reason: (we && (we.blocker || we.error)) || 'WebEngage report unavailable.', effect: 'No push-channel campaign rows.' });
  } else if (!(we.campaigns || []).length) {
    blockers.push({
      platform: 'webengage',
      reason: 'The webengage_events table is reachable but empty.',
      effect: 'Push campaigns cannot be listed. Run the sync (/api/cron/webengage) to populate it.',
    });
  } else {
    for (const c of we.campaigns || []) {
      rows.push({ platform: 'webengage', kind: 'campaign', id: c.campaign || c.name, name: c.campaign || c.name, events: c.events, users: c.users });
    }
  }
  return { rows, blockers };
}

async function costSide({ market = 'US', since, until }) {
  const rows = [];
  const blockers = [];
  const res = await adInsights.summary({ market, level: 'ad', since, until }).catch((e) => ({ platforms: [], error: String(e && e.message || e) }));
  for (const p of res.platforms || []) {
    if (p.connected === false || p.not_connected) {
      blockers.push({
        platform: p.platform,
        reason: p.hint || p.blocker || 'not connected',
        need_env: p.need_env || [],
        would_request: p.would_request || null,
        effect: 'Spend and clicks for this platform are absent, so its links show outcome-side figures only.',
      });
      continue;
    }
    for (const r of p.rows || []) {
      // Only a row that names where it sent people can join the ledger.
      const dest = r.destination_url || r.final_url || (Array.isArray(r.final_urls) ? r.final_urls[0] : null) || r.website_destination_url;
      const link = normaliseLink(dest);
      rows.push({
        platform: p.platform,
        name: r.ad_name || r.campaign_name || r.entity_id,
        link,
        spend: r.spend != null ? Number(r.spend) : null,
        clicks: r.clicks != null ? Number(r.clicks) : null,
        impressions: r.impressions != null ? Number(r.impressions) : null,
        // A row with no destination cannot be joined; say so rather than dropping
        // it silently, or spend disappears from the ledger with no explanation.
        unjoinable: !link,
      });
    }
  }
  return { rows, blockers };
}

/**
 * The link-by-link ledger. One row per link, carrying whichever sides could be
 * read and naming the sides that could not.
 */
async function linkLedger({ market = 'US', days = 90, since, until } = {}) {
  const [outcome, send, cost] = await Promise.all([
    outcomeSide({ market, days }),
    sendSide({ market }),
    costSide({ market, since, until }),
  ]);

  const byKey = new Map();
  const touch = (link) => {
    if (!byKey.has(link.key)) {
      byKey.set(link.key, {
        ...link, channel: channelOf(link),
        orders: 0, revenue: null, spend: null, clicks: null, impressions: null,
        ad_rows: 0, sides: [],
      });
    }
    return byKey.get(link.key);
  };

  for (const r of outcome.rows) {
    const e = touch(r.link);
    e.orders += r.orders || 0;
    if (r.revenue != null) e.revenue = (e.revenue || 0) + r.revenue;
    if (!e.sides.includes('outcome')) e.sides.push('outcome');
  }
  for (const r of cost.rows) {
    if (!r.link) continue;
    const e = touch(r.link);
    if (r.spend != null) e.spend = (e.spend || 0) + r.spend;
    if (r.clicks != null) e.clicks = (e.clicks || 0) + r.clicks;
    if (r.impressions != null) e.impressions = (e.impressions || 0) + r.impressions;
    e.ad_rows += 1;
    if (!e.sides.includes('cost')) e.sides.push('cost');
  }

  const links = [...byKey.values()].map((e) => ({
    ...e,
    // Only computable where BOTH sides are present. A link with revenue and no
    // spend has no ROAS — it does not have a ROAS of infinity, and it does not
    // have a ROAS of zero.
    roas: (e.revenue != null && e.spend) ? e.revenue / e.spend : null,
    cost_per_order: (e.spend != null && e.orders) ? e.spend / e.orders : null,
    // The single most useful flag on this table: money going out with nothing
    // coming back, which is only meaningful when the outcome side actually read.
    leak: (e.spend != null && e.spend > 0 && e.orders === 0 && !outcome.blocker),
  })).sort((a, b) => (b.revenue || 0) - (a.revenue || 0) || (b.spend || 0) - (a.spend || 0));

  const blockers = [...(outcome.blocker ? [outcome.blocker] : []), ...send.blockers, ...cost.blockers];
  const unjoinableSpend = cost.rows.filter((r) => r.unjoinable).reduce((s, r) => s + (r.spend || 0), 0);

  return {
    ok: true,
    market, window: { days, since: since || null, until: until || null },
    fetched_at: new Date().toISOString(),
    basis: outcome.basis,
    method: 'Last-click, read from each order\'s own landing_site UTM parameters. NOT multi-touch, and NOT the email platform\'s self-reported attribution.',
    links,
    mailers: send.rows,
    blockers,
    coverage: {
      links: links.length,
      with_outcome: links.filter((l) => l.sides.includes('outcome')).length,
      with_cost: links.filter((l) => l.sides.includes('cost')).length,
      both_sides: links.filter((l) => l.sides.length === 2).length,
      // Spend that names no destination cannot be attributed to any link. It is
      // reported, not dropped, or the ledger would silently understate spend.
      unjoinable_spend: unjoinableSpend || 0,
      unjoinable_note: unjoinableSpend ? 'This spend is on ad rows that carry no destination URL, so it cannot be tied to any link. It is excluded from the rows above and shown here so the total is not silently understated.' : null,
    },
  };
}

module.exports = { linkLedger, normaliseLink, channelOf, outcomeSide, sendSide, costSide };
