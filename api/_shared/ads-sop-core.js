'use strict';

/**
 * api/_shared/ads-sop-core.js — enforces the KNICKGASM Ad Campaign SOP against the
 * LIVE warehouse. READ ONLY.
 *
 * The SOP (docs/sop/KNICKGASM_Ad_Campaign_SOP.pdf, final, live from Monday) makes
 * the whole measurement chain depend on names:
 *     organic post URL -> videoid -> ad name -> ad code -> paid performance
 * An ad whose name omits the videoid still runs, but is excluded from the
 * organic-to-paid join, so the spend on it produces no learning. This module
 * reads the real campaign / ad set / ad names out of Snowflake and reports,
 * per rule, which live spend is currently outside the standard.
 *
 * Nothing here is advisory-only: every violation is attached to the actual
 * dollars behind it, so "spend at risk" is a measured figure, not an estimate.
 *
 * Source of truth: the master tracking sheet. This module mirrors the SOP's
 * published syntax, token values and rules; where the sheet changes, the SOP
 * changes and these constants are corrected to match.
 */

const snow = require('./ads-snowflake-core.js');

// ── SOP constants (mirrored from the final SOP; see data/ads/master-kb.json sop) ──
const TOKENS = {
  platform: ['meta', 'tiktok'],
  surface: ['instagram', 'facebook', 'tiktok'],
  objective: ['conv'],
  type: ['target', 'costco', 'd2c', 'ugc'],
  audience: ['over40', 'high-performer', 'over40-high-performer', 'broad-lookalike'],
  placement: ['ig-reels', 'ig-stories', 'fb-feed', 'tiktok-infeed', 'advantage-plus'],
  product: ['ashwa-coffee', 'embroidery-sneaker'],
  bucket: ['grail-drop', 'laces-vs-custom', 'target-shelf', 'anti-factory', 'paint-detail', 'over40-high-performer', 'target-instore'],
  hook: ['curiosity', 'problem-pain', 'age-stage', 'personal-discovery', 'comparison', 'callout-ifyou', 'lifestyle', 'paint-sensory'],
  lang: ['en', 'es', 'pt'],
};
// SOP Rule 1 — these characters break the URL, the query string or a CSV export.
const BANNED_CHARS = [' ', '/', ',', '&', '?', '%', '+', '#'];
const SCORING = {
  tiktok: { formula: '6-sec View % x 40% + Shares x 25% + (Likes + Comments) x 20% + Views x 15%',
    ad_recommended: 'Score >= 30 OR 6-sec view rate >= 25%', consider: 'Score >= 20 OR 6-sec >= 18% OR ER >= 8%' },
  instagram: { formula: 'Views x 40% + Likes x 35% + Comments x 15% (sums to 90%, under review)',
    ad_recommended: 'Score >= 20', consider: 'Score >= 13 OR likes/views >= 5%' },
  bands: [{ score: '70-100', label: 'Elite' }, { score: '50-69', label: 'High' }, { score: '30-49', label: 'Good' },
    { score: '20-29', label: 'Consider' }, { score: '0-19', label: 'Not ready' }],
  view_penalties: { tiktok: [['<50', 0.45], ['50-199', 0.70], ['200-499', 0.85], ['500+', 1]], instagram: [['<100', 0.50], ['100-499', 0.75], ['500+', 1]] },
  six_second_rule: 'A 6-sec view rate of 25% or above auto-qualifies a TikTok post regardless of total score.',
  run_gate: "No ad goes live unless Ads Activated reads 'Review before running ads'.",
};
const CAPS = { target_daily_usd: 1000, costco_daily_usd: 300,
  note: 'Target cap $1,000/day paced with automated Meta rules — the directive agreed with Bala after the $1,700 spike on 19 July.' };

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
    if (!TOKENS.platform.includes(String(p[1]).toLowerCase())) issues.push({ rule: 6, severity: 'medium', issue: `platform '${p[1]}' is not a permitted token (${TOKENS.platform.join(' ')})` });
    if (!TOKENS.objective.includes(String(p[2]).toLowerCase())) issues.push({ rule: 6, severity: 'low', issue: `objective '${p[2]}' is not a permitted token (${TOKENS.objective.join(' ')})` });
    if (!TOKENS.type.includes(String(p[3]).toLowerCase())) issues.push({ rule: 6, severity: 'medium', issue: `type '${p[3]}' is not a permitted token (${TOKENS.type.join(' ')})` });
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
    if (!TOKENS.audience.includes(String(p[1]).toLowerCase())) issues.push({ rule: 6, severity: 'medium', issue: `audience '${p[1]}' is not a permitted token` });
    if (!TOKENS.placement.includes(String(p[2]).toLowerCase())) issues.push({ rule: 6, severity: 'medium', issue: `placement '${p[2]}' is not a permitted token` });
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
    if (!TOKENS.type.includes(String(p[1]).toLowerCase())) issues.push({ rule: 6, severity: 'medium', issue: `type '${p[1]}' is not a permitted token` });
    if (!TOKENS.product.includes(String(p[2]).toLowerCase())) issues.push({ rule: 6, severity: 'low', issue: `product '${p[2]}' is not a permitted token` });
    if (!TOKENS.surface.includes(String(p[4]).toLowerCase())) issues.push({ rule: 6, severity: 'low', issue: `surface '${p[4]}' is not a permitted token` });
  }
  return Object.assign(out, { compliant: issues.length === 0, issues });
}

// SOP Rule 5 — Target and Costco naming must never mix (this has happened before).
function crossChannelLeak(campaign, adset, ad) {
  const blob = `${campaign} ${adset} ${ad}`.toLowerCase();
  const t = /\btarget\b/.test(blob), c = /\bcostco\b/.test(blob);
  return t && c ? { rule: 5, severity: 'high', issue: 'Name references BOTH target and costco — the SOP requires them kept strictly separate (Costco campaigns have previously been built using Target keywords)' } : null;
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
  const sql = `select campaign_name, adset_name, ad_name, round(sum(spend),2) as spend, sum(impressions) as impressions
  from ${t}
 where date_start between '${from}' and '${to}'
 group by campaign_name, adset_name, ad_name
 order by spend desc nulls last limit ${Math.min(+limit || 4000, 10000)}`;

  if (!snow.isConfigured()) {
    return Object.assign({ ok: false, connected: false, not_connected: true, since: from, until: to, would_query: sql,
      hint: 'Set SNOWFLAKE_* (+ LIVE_CONNECTORS=on) to score live ad names against the SOP. Until then the exact query is shown and no compliance figure is invented.' },
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
    const leak = crossChannelLeak(row.campaign, row.adset, row.ad);
    const issues = c.issues.map((i) => Object.assign({ level: 'campaign' }, i))
      .concat(a.issues.map((i) => Object.assign({ level: 'adset' }, i)))
      .concat(d.issues.map((i) => Object.assign({ level: 'ad' }, i)));
    if (leak) issues.push(Object.assign({ level: 'ad' }, leak));
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
    ok: true, connected: true, source: 'snowflake', table: t, platform, account: account || null,
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
    note: 'The SOP nomenclature is live from Monday, so historical names predate it — this is the measured baseline, not a judgement on past work. Rule 3 (videoid) is the one that costs measurement: spend on an ad without it cannot be joined to organic performance.',
    sop: reference(),
  };
}
const RULE_LABELS = {
  0: 'Empty name',
  1: 'Rule 1 — banned character (space / , & ? % + #)',
  2: 'Rule 2 — uppercase present (lowercase only)',
  3: 'Rule 3 — videoid missing (breaks the organic-to-paid join)',
  5: 'Rule 5 — Target and Costco names mixed',
  6: 'Rule 6 — token value not from the permitted list',
  pattern: 'Pattern — does not match the SOP syntax',
};

/**
 * Daily pacing against the SOP's spend caps. Flags any day over the cap for the
 * scope, which is exactly the check the $1,700 spike on 19 July prompted.
 */
async function pacing({ since, until, account } = {}) {
  const live = require('./ads-live-core.js');
  const series = await live.daily({ since, until, account });
  const cap = account === 'costco' ? CAPS.costco_daily_usd : account === 'target' ? CAPS.target_daily_usd
    : CAPS.target_daily_usd + CAPS.costco_daily_usd;
  if (!series.ok) return Object.assign({}, series, { cap_usd: cap, caps: CAPS });
  const days = (series.rows || []).map((d) => {
    const spend = Number(d.spend) || 0;
    return { date: d.day || d.date, spend, cap_usd: cap, over: spend > cap,
      over_by: spend > cap ? Math.round((spend - cap) * 100) / 100 : 0,
      pct_of_cap: cap ? Math.round(spend / cap * 1000) / 10 : null };
  });
  const over = days.filter((d) => d.over);
  return {
    ok: true, connected: true, source: series.source, since: series.since, until: series.until,
    cap_usd: cap, caps: CAPS, days,
    days_over_cap: over.length, worst_day: over.sort((a, b) => b.over_by - a.over_by)[0] || null,
    total_overspend: Math.round(over.reduce((s, d) => s + d.over_by, 0) * 100) / 100,
    note: `Cap applied: $${cap}/day for scope '${account || 'target+costco'}'. ${CAPS.note}`,
  };
}

// The SOP constants themselves, so the dashboard can show the standard beside
// the live numbers without duplicating them in the page.
function reference() {
  return { tokens: TOKENS, banned_characters: BANNED_CHARS, scoring: SCORING, caps: CAPS,
    patterns: {
      campaign: 'yyyy-mm _ platform _ objective _ type',
      adset: 'yyyy-mm-dd _ audience _ placement',
      ad: 'yyyy-mm-dd _ type _ product _ audience _ surface _ videoid',
      utm: { utm_source: 'platform-surface', utm_medium: 'paid-social', utm_campaign: 'campaign name', utm_term: 'ad set name', utm_content: 'ad name', acq_source: 'type_platform', acq_subsource: 'creator_bucket_hook' },
    },
    chain: 'organic post URL -> videoid -> ad name -> ad code -> paid performance',
    authority: 'The master tracking sheet is the source of truth; the SOP is corrected to match it.',
    sop_pdf: '/docs/sop/KNICKGASM_Ad_Campaign_SOP.pdf',
    master_sheet: 'https://docs.google.com/spreadsheets/d/SET_GOOGLE_SHEET_ID_FOR_KNICKGASM/edit' };
}

module.exports = { compliance, pacing, reference, parseAdName, parseAdSetName, parseCampaignName, extractVideoId, TOKENS, CAPS, SCORING };
