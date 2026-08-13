'use strict';

/**
 * api/_shared/ads-sop-core.js — scores LIVE ad names against a naming standard.
 * READ ONLY.
 *
 * A naming standard is what makes the measurement chain joinable:
 *     organic post URL -> videoid -> ad name -> ad code -> paid performance
 * An ad whose name omits the videoid still runs, but is excluded from the
 * organic-to-paid join, so the spend on it produces no learning. This module
 * reads the real campaign / ad set / ad names out of the configured warehouse
 * and reports, per rule, which live spend is currently outside the standard.
 *
 * Nothing here is advisory-only: every violation is attached to the actual
 * spend behind it, so "spend at risk" is a measured figure, not an estimate.
 *
 * ── WHAT IS STRUCTURAL, AND WHAT IS A BRAND'S OWN POLICY ────────────────────
 *
 * The RULES are structural and hold for anyone: a name with a space or an
 * ampersand breaks a URL or a CSV export; mixed case splits one campaign across
 * report rows in a case-sensitive API; a missing videoid breaks the join. Those
 * stay.
 *
 * The permitted TOKEN VALUES are not. They are one advertiser's vocabulary —
 * its products, its audiences, its retail channels — and this module used to
 * ship one company's list as though it were the standard for every tenant of
 * this platform, alongside that company's daily budget caps and the internal
 * anecdote behind them. A workspace's own vocabulary is configured
 * (ADS_SOP_TOKENS, a JSON object of field -> allowed values); with none
 * configured the token checks simply do not run and say so, rather than
 * flagging a brand's real ad names against somebody else's dictionary.
 */

const snow = require('./ads-snowflake-core.js');

/**
 * Permitted token values per name field, as JSON in ADS_SOP_TOKENS, e.g.
 *   {"platform":["meta","tiktok"],"type":["prospecting","retargeting"]}
 * Empty by default: nothing is bundled. A field that is absent is not checked.
 */
function loadTokens() {
  const raw = String(process.env.ADS_SOP_TOKENS || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) out[k] = v.map((x) => String(x).toLowerCase());
    }
    return out;
  } catch (_) { return {}; }
}
const TOKENS = loadTokens();
// Rule 1 — these characters break the URL, the query string or a CSV export.
const BANNED_CHARS = [' ', '/', ',', '&', '?', '%', '+', '#'];
/**
 * Daily spend cap for pacing, from ads-snowflake-core's env-driven budget.
 * There is no bundled figure: a cap belongs to whoever runs the accounts.
 */
function caps() {
  const b = snow.budgets();
  return { daily_cap: b.daily_cap, currency: b.currency, configured: b.configured, note: b.note };
}

const ISO_D = /^\d{4}-\d{2}-\d{2}$/;
const ISO_M = /^\d{4}-\d{2}$/;

function bannedIn(s) { return BANNED_CHARS.filter((c) => String(s).includes(c)); }
function hasUpper(s) { return /[A-Z]/.test(String(s)); }

// A videoid is the trailing numeric id lifted from the organic post URL.
function extractVideoId(name) {
  const parts = String(name || '').split('_');
  const last = parts[parts.length - 1] || '';
  return /^\d{8,}$/.test(last) ? last : null;
}

/**
 * Rule 6 — the value in a name field must come from the workspace's own
 * permitted list. Returns null when no list is configured for that field, so an
 * unconfigured deployment reports nothing rather than judging real ad names
 * against a vocabulary that is not theirs.
 */
function tokenIssue(field, value, severity) {
  const allowed = TOKENS[field];
  if (!Array.isArray(allowed) || !allowed.length) return null;
  if (allowed.includes(String(value).toLowerCase())) return null;
  return { rule: 6, severity, issue: `${field} '${value}' is not a permitted token (${allowed.join(' ')})` };
}
function pushToken(issues, field, value, severity) {
  const i = tokenIssue(field, value, severity);
  if (i) issues.push(i);
}

function baseIssues(name, kind) {
  const issues = [];
  const s = String(name == null ? '' : name);
  if (!s.trim()) { issues.push({ rule: 0, severity: 'high', issue: `${kind} name is empty` }); return issues; }
  const bad = bannedIn(s);
  if (bad.length) issues.push({ rule: 1, severity: 'high', issue: `Contains banned character(s): ${bad.map((c) => (c === ' ' ? 'space' : c)).join(' ')}` });
  if (hasUpper(s)) issues.push({ rule: 2, severity: 'medium', issue: 'Contains uppercase — GA4 and several platform APIs are case-sensitive, so mixed case splits one campaign across report rows' });
  return issues;
}

// campaign: yyyy-mm _ platform _ objective _ type
function parseCampaignName(name) {
  const s = String(name == null ? '' : name);
  const issues = baseIssues(s, 'Campaign');
  const p = s.split('_');
  const out = { name: s, kind: 'campaign', month: null, platform: null, objective: null, type: null };
  if (p.length < 4) {
    issues.push({ rule: 'pattern', severity: 'high', issue: 'Does not match yyyy-mm_platform_objective_type' });
  } else {
    out.month = p[0]; out.platform = p[1]; out.objective = p[2]; out.type = p[3];
    if (!ISO_M.test(p[0])) issues.push({ rule: 'pattern', severity: 'high', issue: `First field '${p[0]}' is not yyyy-mm` });
    pushToken(issues, 'platform', p[1], 'medium');
    pushToken(issues, 'objective', p[2], 'low');
    pushToken(issues, 'type', p[3], 'medium');
  }
  return Object.assign(out, { compliant: issues.length === 0, issues });
}

// ad set: yyyy-mm-dd _ audience _ placement
function parseAdSetName(name) {
  const s = String(name == null ? '' : name);
  const issues = baseIssues(s, 'Ad set');
  const p = s.split('_');
  const out = { name: s, kind: 'adset', date: null, audience: null, placement: null };
  if (p.length < 3) {
    issues.push({ rule: 'pattern', severity: 'high', issue: 'Does not match yyyy-mm-dd_audience_placement' });
  } else {
    out.date = p[0]; out.audience = p[1]; out.placement = p[2];
    if (!ISO_D.test(p[0])) issues.push({ rule: 'pattern', severity: 'high', issue: `First field '${p[0]}' is not yyyy-mm-dd` });
    pushToken(issues, 'audience', p[1], 'medium');
    pushToken(issues, 'placement', p[2], 'medium');
  }
  return Object.assign(out, { compliant: issues.length === 0, issues });
}

// ad: yyyy-mm-dd _ type _ product _ audience _ surface _ videoid
function parseAdName(name) {
  const s = String(name == null ? '' : name);
  const issues = baseIssues(s, 'Ad');
  const p = s.split('_');
  const out = { name: s, kind: 'ad', date: null, type: null, product: null, audience: null, surface: null, videoid: extractVideoId(s) };
  if (!out.videoid) {
    // Rule 3 is the one that costs measurement, so it is always reported.
    issues.push({ rule: 3, severity: 'high', issue: 'No videoid at the end of the ad name — the ad cannot be joined to its organic performance, so this spend produces no learning' });
  }
  if (p.length < 6) {
    issues.push({ rule: 'pattern', severity: 'high', issue: 'Does not match yyyy-mm-dd_type_product_audience_surface_videoid' });
  } else {
    out.date = p[0]; out.type = p[1]; out.product = p[2]; out.audience = p[3]; out.surface = p[4];
    if (!ISO_D.test(p[0])) issues.push({ rule: 'pattern', severity: 'high', issue: `First field '${p[0]}' is not yyyy-mm-dd` });
    pushToken(issues, 'type', p[1], 'medium');
    pushToken(issues, 'product', p[2], 'low');
    pushToken(issues, 'surface', p[4], 'low');
  }
  return Object.assign(out, { compliant: issues.length === 0, issues });
}

function severityRank(s) { return s === 'high' ? 3 : s === 'medium' ? 2 : 1; }

/**
 * Compliance over live spend. One row per (campaign, ad set, ad) with its real
 * spend, parsed against the SOP. Returns the summary, the rule tally, and the
 * worst offenders by spend so the biggest measurement leaks come first.
 */
async function compliance({ since, until, platform = 'meta', account, limit = 4000 } = {}) {
  const t = snow.sources().meta.ads;
  const to = until || new Date().toISOString().slice(0, 10);
  const from = since || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  if (!t) return Object.assign(snow.noSources({ since: from, until: to, platform }), { sop: reference() });
  const sql = `select campaign_name, adset_name, ad_name, round(sum(spend),2) as spend, sum(impressions) as impressions
  from ${t}
 where date_start between '${from}' and '${to}'
 group by campaign_name, adset_name, ad_name
 order by spend desc nulls last limit ${Math.min(+limit || 4000, 10000)}`;

  if (!snow.isConfigured()) {
    return Object.assign({ ok: false, connected: false, not_connected: true, data_scope: snow.DATA_SCOPE,
      since: from, until: to, would_query: sql,
      hint: 'Set SNOWFLAKE_* (+ LIVE_CONNECTORS=on) to score live ad names against the standard. Until then the exact query is shown and no compliance figure is invented.' },
      { sop: reference() });
  }
  const r = await snow.runStatement(sql);
  const rows = (r.rows || []).map((x) => ({
    campaign: x.campaign_name, adset: x.adset_name, ad: x.ad_name,
    spend: Number(x.spend) || 0, impressions: Number(x.impressions) || 0,
  }));

  const tally = {};
  const bump = (key, label, spend) => {
    tally[key] = tally[key] || { rule: key, label, ads: 0, spend: 0 };
    tally[key].ads += 1; tally[key].spend = Math.round((tally[key].spend + spend) * 100) / 100;
  };
  let compliantAds = 0, compliantSpend = 0, totalSpend = 0, withVideoId = 0, videoIdSpend = 0;
  const detailed = rows.map((row) => {
    const c = parseCampaignName(row.campaign), a = parseAdSetName(row.adset), d = parseAdName(row.ad);
    const issues = c.issues.map((i) => Object.assign({ level: 'campaign' }, i))
      .concat(a.issues.map((i) => Object.assign({ level: 'adset' }, i)))
      .concat(d.issues.map((i) => Object.assign({ level: 'ad' }, i)));
    totalSpend = Math.round((totalSpend + row.spend) * 100) / 100;
    if (d.videoid) { withVideoId += 1; videoIdSpend = Math.round((videoIdSpend + row.spend) * 100) / 100; }
    if (!issues.length) { compliantAds += 1; compliantSpend = Math.round((compliantSpend + row.spend) * 100) / 100; }
    // Tally each distinct rule once per row so spend is not double counted.
    [...new Set(issues.map((i) => String(i.rule)))].forEach((rule) => {
      const first = issues.find((i) => String(i.rule) === rule);
      bump(rule, RULE_LABELS[rule] || first.issue, row.spend);
    });
    return Object.assign({}, row, {
      videoid: d.videoid, compliant: issues.length === 0,
      worst: issues.reduce((w, i) => (severityRank(i.severity) > severityRank(w) ? i.severity : w), 'low'),
      issues,
    });
  });

  return {
    ok: true, connected: true, source: 'snowflake', data_scope: snow.DATA_SCOPE,
    table: t, platform, account: account || null,
    since: from, until: to,
    summary: {
      ads_scored: detailed.length, spend_scored: totalSpend,
      compliant_ads: compliantAds, compliant_spend: compliantSpend,
      compliance_rate_pct: detailed.length ? Math.round(compliantAds / detailed.length * 1000) / 10 : null,
      spend_at_risk: Math.round((totalSpend - compliantSpend) * 100) / 100,
      ads_with_videoid: withVideoId, spend_joinable_to_organic: videoIdSpend,
      videoid_coverage_pct: detailed.length ? Math.round(withVideoId / detailed.length * 1000) / 10 : null,
    },
    by_rule: Object.values(tally).sort((x, y) => y.spend - x.spend),
    rows: detailed.sort((x, y) => y.spend - x.spend),
    note: 'Names created before a standard was adopted will predate it — this is the measured baseline, not a judgement on past work. Rule 3 (videoid) is the one that costs measurement: spend on an ad without it cannot be joined to organic performance.',
    sop: reference(),
  };
}
const RULE_LABELS = {
  0: 'Empty name',
  1: 'Rule 1 — banned character (space / , & ? % + #)',
  2: 'Rule 2 — uppercase present (lowercase only)',
  3: 'Rule 3 — videoid missing (breaks the organic-to-paid join)',
  6: 'Rule 6 — token value not from the permitted list',
  pattern: 'Pattern — does not match the naming syntax',
};

/**
 * Daily pacing against the configured spend cap. Flags any day over it. With no
 * cap configured (the default) the series is returned with the days unjudged,
 * because a cap this product invented is not a cap anyone agreed to.
 */
async function pacing({ since, until, account } = {}) {
  const live = require('./ads-live-core.js');
  const series = await live.daily({ since, until, account });
  const c = caps();
  const cap = c.daily_cap;
  if (!series.ok) return Object.assign({}, series, { cap_usd: cap, caps: c });
  const days = (series.rows || []).map((d) => {
    const spend = Number(d.spend) || 0;
    return { date: d.day || d.date, spend, cap_usd: cap, over: cap != null && spend > cap,
      over_by: (cap != null && spend > cap) ? Math.round((spend - cap) * 100) / 100 : 0,
      pct_of_cap: cap ? Math.round(spend / cap * 1000) / 10 : null };
  });
  const over = days.filter((d) => d.over);
  return {
    ok: true, connected: true, source: series.source, data_scope: snow.DATA_SCOPE,
    since: series.since, until: series.until,
    cap_usd: cap, caps: c, days,
    days_over_cap: over.length, worst_day: over.sort((a, b) => b.over_by - a.over_by)[0] || null,
    total_overspend: Math.round(over.reduce((s, d) => s + d.over_by, 0) * 100) / 100,
    note: cap == null
      ? `${c.note} Daily spend is shown unjudged: no day can be "over cap" until a cap exists.`
      : `Cap applied: ${c.currency} ${cap}/day${account ? ` for scope '${account}'` : ''}.`,
  };
}

// The standard itself, so a dashboard can show it beside the live numbers
// without duplicating it in the page. Token values come from the workspace's
// own ADS_SOP_TOKENS; none are bundled.
function reference() {
  const configured = Object.keys(TOKENS).filter((k) => Array.isArray(TOKENS[k]) && TOKENS[k].length);
  return { tokens: TOKENS, tokens_configured: configured,
    banned_characters: BANNED_CHARS, caps: caps(),
    patterns: {
      campaign: 'yyyy-mm _ platform _ objective _ type',
      adset: 'yyyy-mm-dd _ audience _ placement',
      ad: 'yyyy-mm-dd _ type _ product _ audience _ surface _ videoid',
      utm: { utm_source: 'platform-surface', utm_medium: 'paid-social', utm_campaign: 'campaign name', utm_term: 'ad set name', utm_content: 'ad name' },
    },
    chain: 'organic post URL -> videoid -> ad name -> ad code -> paid performance',
    rules: [
      'Rule 1 — no space / , & ? % + # : each breaks a URL, a query string or a CSV export.',
      'Rule 2 — lowercase only: several platform APIs and GA4 are case-sensitive, so mixed case splits one campaign across report rows.',
      'Rule 3 — the ad name ends in the videoid: without it the ad cannot be joined to its organic performance, so the spend produces no learning.',
      'Rule 6 — token values come from the permitted list for that field, when one is configured.',
    ],
    tokens_note: configured.length
      ? `Token values checked for: ${configured.join(', ')}. Set ADS_SOP_TOKENS to change them.`
      : '[DATA REQUIRED BEFORE LAUNCH: permitted token values] No vocabulary is configured, so rule 6 is not applied. The structural rules (1, 2, 3 and the syntax patterns) still are. Set ADS_SOP_TOKENS to a JSON object of field -> allowed values, e.g. {"platform":["meta","tiktok"]}. Nothing is bundled: a permitted-value list is a brand\'s own policy, not this product\'s.',
  };
}

module.exports = { compliance, pacing, reference, caps, parseAdName, parseAdSetName, parseCampaignName, extractVideoId, TOKENS };
