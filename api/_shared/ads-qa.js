// Ads QA Critic — a deterministic verification pass over generated ad creatives.
// (Queued from the agentic rollout: a critic that reviews the paid-social output.)
// Rule-based, so it ALWAYS runs, even when LLM/image providers are rate-limited.
//
// Contract per ad:
//  - exactly ONE creative type: static OR video (never text-only, never a hybrid);
//  - type-complete: static has an image brief + overlay; video has a >=3-scene
//    storyboard with the hook at 0-2s + a script (so nothing renders as a text block);
//  - one CTA; on-brand (no banned phrases, no en/em dashes);
//  - NO fabricated offer/claim (no invented % off, codes, guarantees) — flagged as
//    needing the approved offer/claims data, per the zero-fabrication spec;
//  - within platform char limits.
// Returns per-ad verdicts + a summary, and stamps each ad with `__qa` so the studio
// can badge it. buildCampaign attaches the summary + an "Ads QA Critic" trace step.

const BANNED = /wellness journey|\btransform\b|liquid gold|game[\s-]?changer|LIMITED TIME|hurry|don'?t miss out|last chance|while supplies last/i;
const DASH = /[–—]/; // en / em dash — brand forbids both
// Signals of an offer/claim we cannot invent (there is no approved offer/claims lib).
const OFFER = /\b\d{1,3}\s?%\s?off\b|\bcode[:\s]|\bpromo\b|\bcoupon\b|\bBOGO\b|\bmoney[\s-]?back\b|\bguarantee\b|\blowest price\b/i;
const LIMITS = {
  meta:      { headline: 40, primary_text: 125 },
  google:    { headline: 30, description: 90 },
  youtube:   { headline: 40 },
  tiktok:    { caption: 100 },
  pinterest: { headline: 40 },
};

function textParts(ad) {
  const p = [ad.headline, ad.primary_text, ad.caption, ad.hook, ad.script, ad.creative_brief, ad.description];
  (ad.headlines || []).forEach((h) => p.push(h));
  (ad.descriptions || []).forEach((d) => p.push(d));
  (ad.storyboard || []).forEach((s) => p.push(s && (s.scene || s.shot)));
  if (ad.overlay) p.push(ad.overlay.headline, ad.overlay.cta, ad.overlay.proof);
  return p.filter(Boolean).map(String);
}

function qaAd(ad) {
  const issues = [];
  const crit = (msg) => issues.push({ sev: 'critical', msg });
  const warn = (msg) => issues.push({ sev: 'warn', msg });
  const type = ad.creative_type;

  // 1) exactly one valid type
  if (type !== 'static' && type !== 'video') crit(`invalid ad type "${type || 'none'}" (must be static or video)`);
  if (type === 'static' && (ad.storyboard || ad.script)) crit('static ad carries video fields');
  // 2) type-complete (never text-only)
  if (type === 'static') {
    if (!ad.creative_brief) crit('static ad has no image brief (would render text-only)');
    if (!(ad.overlay && (ad.overlay.headline || ad.headline))) warn('static ad missing overlay headline');
    if (!ad.aspect) warn('static ad missing aspect ratio');
  }
  if (type === 'video') {
    const sb = ad.storyboard || [];
    if (sb.length < 3) crit(`video storyboard too thin (${sb.length} scenes; need >=3)`);
    if (!sb[0] || !/^0/.test(String(sb[0].t || ''))) warn('video hook not at 0-2s (weak first 1.5s)');
    if (!ad.script) warn('video ad missing script');
  }
  // 3) one CTA
  if (!ad.cta) warn('no CTA');
  // 4) brand safety + no fabrication
  textParts(ad).forEach((t) => {
    if (BANNED.test(t)) crit(`banned phrase near "${t.slice(0, 36)}"`);
    if (DASH.test(t)) warn(`en/em dash near "${t.slice(0, 36)}"`);
    if (OFFER.test(t)) crit(`unverifiable offer/claim near "${t.slice(0, 36)}" (needs approved data)`);
  });
  // 5) platform char limits
  const lim = LIMITS[ad.platform] || {};
  if (lim.headline && ad.headline && String(ad.headline).length > lim.headline) warn(`headline ${String(ad.headline).length}>${lim.headline} for ${ad.platform}`);
  if (lim.primary_text && ad.primary_text && String(ad.primary_text).length > lim.primary_text) warn(`primary_text over ${lim.primary_text}`);
  (ad.headlines || []).forEach((h) => { if (lim.headline && String(h).length > lim.headline) warn(`google headline over ${lim.headline}`); });
  (ad.descriptions || []).forEach((d) => { if (lim.description && String(d).length > lim.description) warn(`google description over ${lim.description}`); });

  const critical = issues.filter((i) => i.sev === 'critical').length;
  const warns = issues.filter((i) => i.sev === 'warn').length;
  const score = Math.max(0, 10 - critical * 3 - warns);
  const verdict = { ok: critical === 0, score, critical, warns, issues };
  try { ad.__qa = { ok: verdict.ok, score, issues: issues.map((i) => `${i.sev === 'critical' ? '✗' : '⚠'} ${i.msg}`) }; } catch (_) { /* frozen ad */ }
  return { id: ad.id, platform: ad.platform, type: type || null, ...verdict };
}

function qaAds(ads) {
  const results = (ads || []).map(qaAd);
  const critical = results.reduce((n, r) => n + r.critical, 0);
  const passed = results.every((r) => r.ok);
  const avg_score = results.length ? Math.round((results.reduce((s, r) => s + r.score, 0) / results.length) * 10) / 10 : 0;
  // Coverage: each channel should carry BOTH a static and a video creative.
  const byPlat = {};
  (ads || []).forEach((a) => { (byPlat[a.platform] = byPlat[a.platform] || {})[a.creative_type] = true; });
  const coverage = Object.keys(byPlat).map((p) => ({ platform: p, static: !!byPlat[p].static, video: !!byPlat[p].video }));
  const missing = coverage.filter((c) => !c.static || !c.video).map((c) => `${c.platform}:${!c.static ? 'no-static' : 'no-video'}`);
  return { passed, critical, avg_score, count: results.length, coverage, missing, results };
}

module.exports = { qaAd, qaAds };
