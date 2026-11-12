/**
 * The decision behind each asset of a send, written down (audit 2026-11-12).
 * ---------------------------------------------------------------------------
 * WHY. A build already resolved, for every asset, who it speaks to, what it
 * sells, where it leads, which contract it is held to, what it was shaped by
 * and how it will be judged. Those answers lived in ten places on the campaign
 * (cohort, objective, offer, design, mail_study, measurement, test_plan,
 * data_gaps, the evidence pack on the slot, each asset's contract check) and
 * nowhere as ONE record a reviewer can read beside the asset, or a later build
 * can be compared with.
 *
 * WHAT IT IS. A deterministic record compiled from the inputs THIS build used.
 * No model call, nothing invented: a field the build had no value for carries
 * the gap in words. It is written at the end of the build, from what the build
 * actually resolved, so it cannot disagree with the asset beside it.
 *
 * EVIDENCE IS LABELLED BY WHAT IT IS:
 *   measured  - this brand's own campaigns or ads, with the platform's figures;
 *   observed  - what competitors or a reference set were SEEN doing (a count, a
 *               date range); its effect on results is a hypothesis, never a
 *               finding. A public ad being visible says nothing about ROAS;
 *   standard  - the format contract the asset is held to, with its source.
 * With no measured evidence the record is PROVISIONAL and says which data is
 * missing; an asset is never called evidence-backed because a rule was read.
 *
 * IDS AND REVISIONS. Every asset gets a stable id
 *   <slot>:<type>:<placement>:<variant>
 * and a revision (the first 16 hex of the SHA-256 of what a person would
 * receive). manifest_digest is the SHA-256 of every id:revision in order: two
 * builds with the same digest shipped the same bytes.
 *
 * NOT a function file.
 */
'use strict';

const crypto = require('crypto');
const str = (v) => (v == null ? '' : String(v));
const sha = (s) => crypto.createHash('sha256').update(str(s)).digest('hex');
const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const MARKER = /\[DATA REQUIRED[^\]]*\]/;

/** What a person receives for one asset, as one string to hash. */
function bytesOf(a) {
  if (a == null) return '';
  if (typeof a === 'string') return a;
  if (a.html) return str(a.html);
  const o = {};
  for (const k of Object.keys(a).sort()) { if (/^(contract_check|compliance_check|prompts|design|decision|id)$/.test(k)) continue; o[k] = a[k]; }
  return JSON.stringify(o);
}

/** Every asset of a campaign, flat: { type, placement, variant, contract, node }. */
function assetsOf(campaign) {
  const A = (campaign && campaign.assets) || {};
  const out = [];
  const mail = A.email || null;
  if (mail) {
    const vars = Array.isArray(mail.variants) && mail.variants.length ? mail.variants : (mail.html ? [mail] : []);
    // What a recipient gets is the subject and preheader as well as the body
    // (review of #451): they are delivered beside the HTML, so they are hashed with it.
    vars.forEach((v, i) => out.push({ type: 'email', placement: 'inbox', variant: slug(v.key || v.label) || 'v' + (i + 1), contract: 'email.mailer', node: v, with: [str(v.subject || mail.subject), str(v.preheader || v.preview_text || mail.preheader || mail.preview_text)], cta: str(v.cta || mail.cta), channel: 'email' }));
  }
  (A.landing_pages || []).forEach((lp, i) => out.push({ type: 'landing', placement: 'page', variant: slug(lp.variant) || 'v' + (i + 1), contract: 'landing.page', node: lp, cta: str(lp.cta), channel: 'landing_page' }));
  const seen = {};
  (A.ads || []).forEach((ad) => {
    const pf = slug(ad.platform) || 'ad'; const ct = slug(ad.creative_type) || 'static';
    const k = pf + ':' + ct; seen[k] = (seen[k] || 0) + 1;
    out.push({ type: 'ad', placement: pf + '.' + ct, variant: slug(ad.variant) || 'v' + seen[k], contract: (ad.contract_check && ad.contract_check.contract) || null, node: ad, cta: str(ad.cta || ad.call_to_action), channel: pf, destination: str(ad.destination_url || ad.final_url) });
  });
  (A.social_posts || []).forEach((p) => p && out.push({ type: 'social', placement: slug(p.key), variant: 'v1', contract: 'social.' + str(p.key), node: p, cta: str(p.cta), channel: 'social', destination: str(p.link) }));
  (A.messages || []).forEach((m) => m && out.push({ type: 'message', placement: slug(m.channel || m.type), variant: 'v1', contract: (m.contract_check && m.contract_check.contract) || null, node: m, cta: str(m.cta), channel: slug(m.channel || m.type), destination: str(m.link || m.deep_link) }));
  Object.values(A.onsite || {}).forEach((o) => o && out.push({ type: 'onsite', placement: slug(o.key), variant: 'v1', contract: 'onsite.' + str(o.key), node: o, cta: str(o.cta), channel: 'onsite', destination: str(o.link) }));
  (A.display_banners || []).forEach((b) => b && out.push({ type: 'display', placement: slug(b.size), variant: 'v1', contract: 'display.banner', node: b, cta: str(b.cta), channel: 'display', destination: str(b.destination_url) }));
  if (A.google_display) out.push({ type: 'display', placement: 'google-responsive', variant: 'v1', contract: 'display.google.responsive', node: A.google_display, cta: '', channel: 'display', destination: str(A.google_display.final_url) });
  if (A.music) out.push({ type: 'music', placement: slug(A.music.purpose) || 'track', variant: 'v1', contract: null, node: A.music, cta: '', channel: 'music', brief_only: true });
  return out;
}

/** The evidence this build had, each item labelled measured / observed / standard. */
function evidenceOf(campaign, entry) {
  const items = []; const gaps = [];
  let pack = null;
  try { pack = require('./creative-evidence.js').evidenceFor(entry || {}); } catch (_) { pack = null; }
  for (const w of ((pack && pack.wins) || [])) {
    items.push({ basis: 'measured', kind: 'own_campaign', label: str(w.name || 'an earlier campaign'), figures: str(w.metrics || w.line || ''), note: 'This brand\'s own send, with the figures its platform reported.' });
  }
  const ads = pack && pack.ads;
  if (ads && ads.imported) {
    for (const p of (ads.platforms || [])) {
      if (p && p.rated >= 3 && p.median != null) items.push({ basis: 'measured', kind: 'own_ads', label: `${str(p.label || p.provider)}: ${p.rated} rated ads`, figures: `median ${str(p.metric || p.basis) || 'click-through rate'} ${p.median}${p.currency ? ' ' + p.currency : ''}`, note: 'This brand\'s own ads, as its ad account reported them.' });
    }
  }
  if (!items.length) gaps.push(...(((pack && pack.gaps) || []).slice(0, 2)));
  const comp = pack && pack.competitor;
  if (comp && comp.searched && Array.isArray(comp.patterns) && comp.patterns.length) {
    items.push({ basis: 'observed', kind: 'competitor', label: `${comp.patterns.length} competitor pattern${comp.patterns.length === 1 ? '' : 's'}`, sample: comp.patterns.length, note: 'Seen in competitors\' assets. That they run it is observed; that it works is a hypothesis.' });
  } else if (comp && comp.searched === false) {
    gaps.push('Competitor assets could not be read for this send, which is not the same as there being none.');
  }
  const ms = campaign && campaign.mail_study;
  if (ms && ms.emails) {
    items.push({ basis: 'observed', kind: ms.basis === 'reference' ? 'reference_mail' : 'competitor_mail', label: `${ms.emails} ${ms.basis === 'reference' ? 'reference' : 'competitor'} emails measured as rendered`, sample: ms.emails, sources: (ms.sources || []).slice(0, 8), note: ms.basis === 'reference' ? 'A shipped reference set for this category, not this brand\'s named competitors. Shape only: never their words, offers or claims.' : 'This brand\'s own competitors\' captured mail. Shape only.' });
  }
  return { items, gaps, measured: items.some((x) => x.basis === 'measured') };
}

function build(campaign, entry) {
  if (!campaign || !campaign.assets) return null;
  const e = entry || {};
  const slot = slug(e.id || campaign.calendar_entry_id || campaign.campaign_id) || 'slot';
  const meas = campaign.measurement || {};
  const tests = (campaign.test_plan && campaign.test_plan.tests) || [];
  const gapsAll = Array.isArray(campaign.data_gaps) ? campaign.data_gaps : [];
  const design = campaign.design || {};
  const ev = evidenceOf(campaign, e);
  const hero = e.heroProduct || {};
  const heroTitle = str(hero.title || hero.name);
  const cohort = e.cohort || {};
  const offer = campaign.offer || e.offer || null;
  let pct = offer ? Number(offer.pct) : NaN; if (Number.isFinite(pct) && pct > 0 && pct < 1) pct *= 100;
  const shared = {
    audience: { cohort: str(cohort.name) || null, rules: Array.isArray(cohort.rules) ? cohort.rules.slice(0, 6) : [], size: Number(cohort.size) > 0 ? Number(cohort.size) : null, size_note: Number(cohort.size) > 0 ? '' : 'size not measured' },
    market: str(e.market || campaign.market) || null,
    purpose: str(e.objective || campaign.objective) || null,
    product: heroTitle && !MARKER.test(heroTitle) ? heroTitle : null,
    product_gap: heroTitle && !MARKER.test(heroTitle) ? '' : (heroTitle || '[DATA REQUIRED BEFORE LAUNCH: product, this send]'),
    offer: offer && Number.isFinite(pct) && Math.round(pct) > 0 ? `${Math.round(pct)}% off${offer.code ? ' with code ' + str(offer.code).slice(0, 24) : ''}` : null,
    offer_note: offer && Number.isFinite(pct) && Math.round(pct) > 0 ? 'the planner\'s offer for this cohort' : 'no offer on this send',
    destination: str(campaign.landing_url) || null,
    primary_kpi: str(meas.primary_kpi) || null,
    baseline: meas.baseline != null ? meas.baseline : null,
    baseline_gap: meas.baseline != null ? '' : str(meas.data_gap),
    read_on: str(meas.read_on) || null,
  };
  const designOf = (a) => {
    const d = (a.node && (a.node.design || (a.node.creative && a.node.creative.design) || a.node.look)) || null;
    if (d && (d.theme || d.template)) return d;
    const list = a.type === 'email' ? design.mail : a.type === 'landing' ? design.landing : null;
    if (Array.isArray(list)) return list.find((x) => slug(x.key) === a.variant) || null;
    return null;
  };
  const items = assetsOf(campaign).map((a) => {
    const d = designOf(a);
    const test = tests.find((t) => (a.type === 'email' && t.asset === 'email') || (a.type === 'landing' && t.asset === 'landing_page')) || null;
    const cc = a.node && a.node.contract_check;
    const failing = cc && cc.ok === false;
    return {
      asset_id: [slot, a.type, a.placement, a.variant].join(':'),
      revision: sha((a.with && a.with.some(Boolean) ? a.with.join('\n') + '\n' : '') + bytesOf(a.node)).slice(0, 16),
      type: a.type, placement: a.placement, variant: a.variant,
      contract: a.contract || null,
      cta: a.cta || null,
      destination: a.destination || shared.destination,
      format: d ? { theme: d.theme || null, template: d.template || null, why: str(d.why).slice(0, 240) || null } : null,
      // what was considered for the look and not taken, as the build recorded it
      rejected: d && Array.isArray(d.family) ? d.family.filter((t) => t !== d.theme).slice(0, 3).map((t) => ({ option: 'theme: ' + t, why: 'another of this brand\'s themes, not this send\'s turn in the rotation' })) : [],
      hypothesis: test ? `Arms ${(test.arms || []).join(' vs ')} differ by ${test.differs_by}.` : null,
      kpi: (meas.channel_kpis && (meas.channel_kpis[a.channel] || (a.type === 'ad' && meas.channel_kpis[a.placement.split('.')[0]]))) || null,
      expected_artifact: a.brief_only ? 'a brief (the track is composed on request)' : (a.type === 'ad' && /video/.test(a.placement) ? 'a playable creative and its script' : 'the finished asset'),
      check: cc ? (failing ? 'failed' : 'passed') : 'not checked',
      status: failing ? 'draft: contract not met' : (ev.measured ? 'draft' : 'provisional draft'),
    };
  });
  const digest = sha(items.map((x) => x.asset_id + '@' + x.revision).join('\n'));
  return {
    version: 'asset-decision.v1',
    made_at: new Date().toISOString(),
    build_version: campaign.build_version || null,
    state: ev.measured ? 'evidenced' : 'provisional',
    state_note: ev.measured ? 'Shaped by this brand\'s own measured results, with what was observed of others beside them.' : 'Provisional: built from the brand\'s verified facts and the format standards. No measured result of this brand\'s own was available for this send.',
    shared, evidence: ev.items, gaps: [...new Set([...ev.gaps, ...gapsAll])].slice(0, 12),
    items, count: items.length, manifest_digest: digest,
  };
}

/** The digest of a campaign as it stands now (after a top-up, an edit). */
function digestOf(campaign) {
  // A fixed slot label: the digest is of the assets, whatever id the send is filed under.
  const d = build(campaign, { id: 'send' });
  return d ? d.manifest_digest : null;
}

module.exports = { build, assetsOf, evidenceOf, digestOf, bytesOf };
