/*
 * What each marketing department did for ONE Smart Brain slot, and the work this adds to every
 * build (2026-10-20). The registry and the pure tools are marketing-team.js; this file applies
 * them to a built campaign and runs the site audit.
 *
 * Added to every build (smart-brain-plan._buildCampaign, after the assets are final):
 *   attachTracking   - UTM tags on every link to the brand's OWN site (email, its variants and text,
 *                      landing pages, which also forward the visitor's incoming UTMs), and a tracked
 *                      destination on every ad (Google: final_url). A link that is a marker stays one.
 *   attachMeasurement- the primary KPI, the brand's own baseline for it (the median click rate of its
 *                      own campaigns the planner stamped on the slot), a planning target (10% above that
 *                      baseline, labelled as a target, never as a prediction) and the date to read it.
 *                      No baseline: the marker, and no target.
 *   attachTestPlan   - the A/B pair the slot already ships, the variable that differs, the sample per
 *                      variant needed to read a 20% relative lift, and whether the cohort can supply it.
 *   attachSeoChecks  - marketing-team.seoCheck on every landing page.
 *   attachDepartments- one row per per-slot step: 'done' with what it was, or 'gap' with why.
 * siteAudit(brand)   - the technical SEO audit of the brand's own website (robots, sitemap, each page).
 */
'use strict';

const MT = require('./marketing-team.js');

const marker = (field, brand, market) => `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${(brand && brand.name) || 'this brand'}${market ? ', ' + market : ''}]`;
const hostOf = (u) => { try { return new URL(String(u)).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; } };

/** The hosts that are the brand's own: its website, its regional stores, its offerings' pages. */
function ownHosts(brand) {
  const b = brand || {};
  const out = new Set();
  const add = (u) => { const h = hostOf(u); if (h) out.add(h); };
  add(b.website);
  for (const r of Array.isArray(b.regions) ? b.regions : []) if (r && r.store_url) add(/^https?:/i.test(r.store_url) ? r.store_url : 'https://' + r.store_url);
  for (const o of Array.isArray(b.offerings) ? b.offerings : []) if (o && o.url) add(o.url);
  return out;
}
function isOwnFor(brand) {
  const hosts = [...ownHosts(brand)];
  let C = null; try { C = require('./brand-coherence.js'); } catch (_) { C = null; }
  return (host) => {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!h) return false;
    return hosts.some((x) => x === h || (C && C.sameBrand && C.sameBrand(h, x)));
  };
}

/** utm_campaign for a slot: date, market and objective, the same on every asset of the send. */
function campaignTag(campaign, entry) {
  const e = entry || {};
  return MT.slug([e.date, e.market, (campaign && campaign.objective) || e.objective].filter(Boolean).join(' ')) || MT.slug(campaign && campaign.campaign_id);
}

// Copies the visitor's own incoming utm_* onto the page's links to the brand's site, so a sale
// made after the landing page is credited to the ad or mail that brought them, not to the page.
const FORWARD_UTM = '<script data-utm-forward>(function(){try{var q=new URLSearchParams(location.search),k=["utm_source","utm_medium","utm_campaign","utm_content","utm_term"],has=k.some(function(x){return q.get(x)});if(!has)return;document.querySelectorAll("a[href*=\\"utm_source=landing_page\\"]").forEach(function(a){var u=new URL(a.href);k.forEach(function(x){if(q.get(x))u.searchParams.set(x,q.get(x));});a.href=u.toString();});}catch(e){}})();</script>';

function attachTracking(campaign, entry, opts) {
  const a = campaign && campaign.assets;
  if (!a) return null;
  const brand = (entry && entry.brand) || null;
  const own = isOwnFor(brand);
  const tag = campaignTag(campaign, entry);
  const report = { utm_campaign: tag, tagged: 0, skipped_other_sites: 0, ads_with_destination: 0, ads_without_destination: 0 };
  const tagHtml = (html, channel, content) => {
    const r = MT.tagLinks(html, MT.utmFor(channel, tag, content), own);
    report.tagged += r.tagged; report.skipped_other_sites += r.skipped;
    return r.html;
  };
  const em = a.email;
  if (em && typeof em === 'object') {
    if (em.html) em.html = tagHtml(em.html, 'email', 'email');
    for (const v of Array.isArray(em.variants) ? em.variants : []) {
      if (v && v.html) v.html = tagHtml(v.html, 'email', 'email-' + (v.key || v.label || 'variant'));
    }
    if (em.text) {
      em.text = String(em.text).replace(/https?:\/\/[^\s<>"')]+/g, (u) => (own(hostOf(u)) ? MT.utmUrl(u, MT.utmFor('email', tag, 'email-text')) : u));
    }
  }
  for (const lp of Array.isArray(a.landing_pages) ? a.landing_pages : []) {
    if (!lp || !lp.html) continue;
    let html = tagHtml(lp.html, 'landing_page', 'landing-' + (lp.variant || 'a'));
    if (/utm_source=landing_page/.test(html) && !/data-utm-forward/.test(html)) html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, FORWARD_UTM + '</body>') : html + FORWARD_UTM;
    lp.html = html;
  }
  // The page this send leads to, as the build resolved it (smart-brain-plan.slotLinks().pdp).
  const target = String((opts && opts.target) || '');
  for (const ad of Array.isArray(a.ads) ? a.ads : []) {
    if (!ad || typeof ad !== 'object') continue;
    const dest = MT.taggable(target) && own(hostOf(target))
      ? MT.utmUrl(target, MT.utmFor(ad.platform, tag, `${ad.platform}-${ad.creative_type || ad.variant || 'ad'}`))
      : (target || marker('destination URL (the brand\'s own page for this send)', brand, entry && entry.market));
    ad.destination_url = dest;
    if (ad.platform === 'google') ad.final_url = dest;
    if (/^https?:/i.test(dest)) report.ads_with_destination += 1; else report.ads_without_destination += 1;
  }
  campaign.tracking = report;
  return report;
}

/** The median of the brand's OWN campaigns' click rates the planner put on this slot. */
function ownBaseline(entry) {
  const e = entry || {};
  const pool = (e.ownEvidence && Array.isArray(e.ownEvidence.campaigns) && e.ownEvidence.campaigns.length)
    ? e.ownEvidence.campaigns : (e.ownDataReference ? [e.ownDataReference] : []);
  const rates = pool.map((c) => Number(c && c.performance && c.performance.clickRate)).filter((n) => Number.isFinite(n) && n > 0).sort((x, y) => x - y);
  if (!rates.length) return null;
  const mid = Math.floor(rates.length / 2);
  // Stored as a fraction (0.034) or a percentage (3.4): read both, keep a fraction.
  let m = rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
  if (m > 1) m /= 100;
  return { rate: m, campaigns: rates.length };
}

const CHANNEL_KPI = {
  email: 'unique click rate (unique clicks / delivered)',
  meta: 'link click-through rate and cost per landing-page view',
  google: 'click-through rate and conversion rate',
  youtube: 'view rate and click-through rate',
  tiktok: '2-second view rate and click-through rate',
  landing_page: 'conversion rate (call-to-action clicks / sessions)',
};

function attachMeasurement(campaign, entry) {
  const e = entry || {};
  const an = (campaign && campaign.analysis) || {};
  const metric = (an.expected_impact && an.expected_impact.metric) || 'conversion rate';
  const channels = (Array.isArray(e.channels) && e.channels.length ? e.channels : Object.keys(CHANNEL_KPI)).filter((c) => CHANNEL_KPI[c]);
  const base = ownBaseline(e);
  const readOn = (() => { const d = new Date(String(e.date || '') + 'T00:00:00Z'); if (isNaN(d)) return null; d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })();
  const m = {
    primary_kpi: metric,
    channel_kpis: Object.fromEntries(channels.map((c) => [c, CHANNEL_KPI[c]])),
    baseline: base ? { metric: 'email click rate', value: base.rate, basis: `median of ${base.campaigns} of the brand's own campaigns` } : null,
    target: base ? { metric: 'email click rate', value: Number((base.rate * 1.1).toFixed(4)), basis: '10% above the brand\'s own baseline: a planning target, not a prediction' } : null,
    data_gap: base ? null : marker('baseline click rate (no own campaign history on this slot)', e.brand, e.market),
    read_on: readOn,
    tracking: (campaign && campaign.tracking && campaign.tracking.utm_campaign) ? { utm_campaign: campaign.tracking.utm_campaign } : null,
  };
  campaign.measurement = m;
  return m;
}

function attachTestPlan(campaign, entry) {
  const e = entry || {};
  const a = (campaign && campaign.assets) || {};
  const variants = Array.isArray(a.email && a.email.variants) ? a.email.variants : [];
  const lps = Array.isArray(a.landing_pages) ? a.landing_pages : [];
  const base = ownBaseline(e);
  const lift = 0.2;
  const perVariant = base ? MT.sampleSize(base.rate, lift) : null;
  const size = Number(e.cohort && e.cohort.size);
  const arms = [];
  if (variants.length >= 2) arms.push({ asset: 'email', arms: variants.slice(0, 2).map((v) => v.key || v.label), differs_by: (variants[0].framework && variants[1].framework && variants[0].framework !== variants[1].framework) ? 'copy framework' : 'layout' });
  if (lps.length >= 2) arms.push({ asset: 'landing_page', arms: lps.slice(0, 2).map((l) => l.variant), differs_by: 'page structure' });
  const plan = {
    tests: arms,
    variables_from_learning: Array.isArray(e.mvtPlan) ? e.mvtPlan.map((v) => v.variable) : [],
    minimum_detectable_lift: lift,
    per_variant: perVariant,
    basis: base ? `baseline ${(base.rate * 100).toFixed(2)}% from the brand's own campaigns; 95% confidence, 80% power` : null,
    data_gap: base ? null : marker('baseline click rate to size the test', e.brand, e.market),
    readable: perVariant && Number.isFinite(size) && size > 0 ? size >= 2 * perVariant : null,
    note: perVariant && Number.isFinite(size) && size > 0 && size < 2 * perVariant
      ? `The cohort (${size.toLocaleString('en')}) is smaller than the ${(2 * perVariant).toLocaleString('en')} the test needs: read the result as directional.` : '',
  };
  campaign.test_plan = plan;
  return plan;
}

const escAttr = (v) => String(v || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (h) => String(h || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/**
 * The SEO department's work on a landing page: a meta description, Open Graph and schema.org
 * Organization data, each only when the page does not already declare it and only from the brand's
 * OWN lines (tagline, claims, the page's own sentences), CHOSEN to fit 50-160 characters, never cut.
 */
function seoHead(html, entry) {
  let h = String(html || '');
  if (!/<head[^>]*>/i.test(h)) return h;
  const brand = (entry && entry.brand) || {};
  const add = [];
  const titleM = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? plain(titleM[1]) : (brand.name || '');
  const own = [brand.tagline, ...(Array.isArray(brand.claims) ? brand.claims : [])].map((x) => String(x || '').trim());
  const pageLines = (plain((h.match(/<body[\s\S]*$/i) || [''])[0]).match(/[^.!?]+[.!?]/g) || []).map((x) => x.trim());
  const fits = (x) => x.length >= 50 && x.length <= 160 && !/DATA REQUIRED/i.test(x);
  let desc = [...own, ...pageLines].find(fits) || '';
  if (!desc) { const joined = own.filter(Boolean).join('. '); if (fits(joined)) desc = joined; }
  if (desc && !/<meta[^>]+name\s*=\s*["']description["']/i.test(h)) add.push(`<meta name="description" content="${escAttr(desc)}">`);
  if (!/property\s*=\s*["']og:title["']/i.test(h) && title) {
    add.push(`<meta property="og:type" content="website">`, `<meta property="og:title" content="${escAttr(title)}">`);
    if (desc) add.push(`<meta property="og:description" content="${escAttr(desc)}">`);
    const img = (h.match(/<img\b[^>]*\ssrc\s*=\s*["'](https:\/\/[^"']+)["']/i) || [])[1];
    if (img) add.push(`<meta property="og:image" content="${escAttr(img)}">`);
  }
  if (!/application\/ld\+json/i.test(h) && brand.name) {
    const org = { '@context': 'https://schema.org', '@type': 'Organization', name: String(brand.name) };
    if (/^https?:\/\//i.test(String(brand.website || ''))) org.url = String(brand.website);
    if (/^https:\/\//i.test(String(brand.logo_url || ''))) org.logo = String(brand.logo_url);
    if (brand.legal_entity) org.legalName = String(brand.legal_entity).split(',')[0].trim();
    add.push(`<script type="application/ld+json">${JSON.stringify(org).replace(/</g, '\\u003c')}</script>`);
  }
  if (!add.length) return h;
  return h.replace(/<\/title>/i, (m) => m + add.join('')) === h ? h.replace(/<head[^>]*>/i, (m) => m + add.join('')) : h.replace(/<\/title>/i, (m) => m + add.join(''));
}

function attachSeoChecks(campaign, entry) {
  for (const lp of (campaign && campaign.assets && Array.isArray(campaign.assets.landing_pages)) ? campaign.assets.landing_pages : []) {
    if (lp && lp.html) lp.html = seoHead(lp.html, entry);
  }
  const lps = (campaign && campaign.assets && Array.isArray(campaign.assets.landing_pages)) ? campaign.assets.landing_pages : [];
  const out = lps.filter((lp) => lp && lp.html).map((lp) => {
    const c = MT.seoCheck(lp.html);
    lp.seo_check = { fixes: c.fixes, improves: c.improves, findings: c.findings };
    return { variant: lp.variant, fixes: c.fixes, improves: c.improves };
  });
  campaign.seo = out;
  return out;
}

/* ── the per-slot record ───────────────────────────────────────────── */
const has = (v) => (Array.isArray(v) ? v.length > 0 : !!v);

function attachDepartments(campaign, entry) {
  const c = campaign || {};
  const e = entry || {};
  const a = c.assets || {};
  const an = c.analysis || {};
  const brand = e.brand || {};
  const ads = Array.isArray(a.ads) ? a.ads : [];
  const lps = Array.isArray(a.landing_pages) ? a.landing_pages : [];
  const variants = Array.isArray(a.email && a.email.variants) ? a.email.variants : [];
  const n = (x, word) => `${x} ${word}${x === 1 ? '' : 's'}`;
  const R = {
    'marketing-strategy': [has(an.hypothesis), an.hypothesis, 'No hypothesis was written for this slot.'],
    'goal-setting': [has(c.measurement), c.measurement && `KPI: ${c.measurement.primary_kpi}${c.measurement.target ? `; target ${(c.measurement.target.value * 100).toFixed(2)}% (${c.measurement.target.basis})` : ''}; read on ${c.measurement.read_on || 'the send date + 7 days'}.`, 'No measurement plan.'],
    'channel-planning': [has(an.channel_logic), (an.channel_logic || []).map((x) => `${x.channel}: ${x.role}`).join(' · '), 'No channel roles.'],
    'icp': [has(e.cohort && e.cohort.name), e.cohort && `${e.cohort.name}${Number(e.cohort.size) > 0 ? ` (${Number(e.cohort.size).toLocaleString('en')} people)` : ''}: ${(c.audience && c.audience.inclusion_rules || []).join('; ') || 'the cohort\'s own rules'}.`, 'No cohort on the slot.'],
    'competitor-analysis': [has(c.mail_study) || has(an.evidence && an.evidence.competitor), c.mail_study ? `Mail shaped by ${c.mail_study.emails} competitor or category emails (${c.mail_study.basis}).` : 'Competitor angles briefed to the writer.', 'No competitor mail or ads were read for this brand.'],
    'customer-insights': [has(e.cohort), e.cohort && `Cohort ${e.cohort.name}; objective ${c.objective}.`, 'No cohort.'],
    'review-mining': [!(Array.isArray(c.data_gaps) && c.data_gaps.some((g) => /review|testimonial|proof/i.test(g))), 'Proof only from the brand\'s own reviews.', 'No approved reviews on record: proof blocks carry the marker.'],
    'positioning': [has(brand.tagline) || has(brand.claims), [brand.tagline, ...(brand.claims || []).slice(0, 2)].filter(Boolean).join(' · '), marker('tagline or claims', brand)],
    'messaging': [true, c.copy_grounding ? c.copy_grounding.note : 'Every line held to the brand\'s own words.', ''],
    'offer-development': [has(c.offer), c.offer && (c.offer.depth && c.offer.depth !== 'none' ? `${c.offer.depth}${c.offer.pct ? ` (${c.offer.pct}%)` : ''}${c.offer.code ? `, code ${c.offer.code}` : ''}` : 'No discount for this cohort.'), 'No offer decision.'],
    'content-strategy': [has(c.objective), `Objective: ${c.objective}.`, 'No objective.'],
    'content-creation': [has(a.email) || ads.length || lps.length, [variants.length && n(variants.length, 'mail variant'), lps.length && n(lps.length, 'landing page'), ads.length && n(ads.length, 'ad')].filter(Boolean).join(', '), 'No assets built.'],
    'content-distribution': [true, [a.email && (a.email.platform_targets || []).join(' / '), ads.length && [...new Set(ads.map((x) => x.platform))].join(' / ')].filter(Boolean).join('; ') || 'Owned channels.', ''],
    'video-motion': [!ads.some((x) => x.creative_type === 'video') || ads.filter((x) => x.creative_type === 'video').every((x) => x.creative && (x.creative.motion_html || x.creative.video)), `${ads.filter((x) => x.creative_type === 'video').length} video ad(s), each with a playable motion creative.`, 'A video ad has nothing to play.'],
    'seo-aeo': [(c.seo || []).every((s) => s.fixes === 0), (c.seo || []).map((s) => `Landing ${s.variant}: ${s.fixes} to fix, ${s.improves} to improve`).join(' · ') || 'No landing page on this slot.', (c.seo || []).map((s) => `Landing ${s.variant}: ${s.fixes} to fix`).join(' · ')],
    'content-optimisation': [true, (lps[0] && lps[0].seo_check && lps[0].seo_check.findings.filter((f) => f.level !== 'ok').map((f) => f.says).join(' ')) || 'Nothing to change.', ''],
    'social-strategy': [ads.some((x) => Array.isArray(x.placements) && x.placements.length), 'Copy written per placement (feed, story/reel, carousel).', 'No placement copy.'],
    'paid-strategy': [ads.length > 0, `${[...new Set(ads.map((x) => x.platform))].join(', ')} carry this send.`, 'No paid channel on this slot.'],
    'campaign-creation': [ads.length > 0 && ads.every((x) => /^https?:/i.test(String(x.destination_url || ''))), `${n(ads.length, 'ad')}, each with a tracked destination.`, `${ads.filter((x) => !/^https?:/i.test(String(x.destination_url || ''))).length} ad(s) have no destination on the brand's own site.`],
    'audience-targeting': [has(c.audience), c.audience && `Include: ${(c.audience.inclusion_rules || []).join('; ') || c.audience.name}. Exclude: ${(c.audience.exclusions || []).join('; ')}.${c.similarAudienceLogic ? ` Lookalike: ${c.similarAudienceLogic.similarity} of ${c.similarAudienceLogic.seed}.` : ''}`, 'No audience.'],
    'optimisation': [has(c.ads_qa), c.ads_qa && `Ad QA ${c.ads_qa.avg_score}/10${c.ads_qa.critical ? `, ${c.ads_qa.critical} critical` : ''}.`, 'No ad QA.'],
    'email-strategy': [has(a.email), `${e.cohort && e.cohort.name || 'Cohort'} on ${e.date || 'the slot date'}.`, 'No mail on this slot.'],
    'email-creation': [variants.length > 0 || has(a.email && a.email.html), `${n(variants.length || 1, 'mail variant')}${c.mail_study ? ', shaped by the studied mail' : ''}.`, 'No mail.'],
    'automation': [has(a.email && a.email.platform_targets), `Sent through ${(a.email && a.email.platform_targets || []).join(' / ')} via the dispatch queue.`, 'No sending platform.'],
    'contact-fatigue': [has(e.frequency_cap) || has(e.eligibility), e.frequency_cap ? `Cap ${e.frequency_cap.preferred || 2}/${e.frequency_cap.absolute || 3} per 7 days${e.eligibility && e.eligibility.status ? `; ${e.eligibility.status}` : ''}.` : 'Judged at dispatch preflight.', ''],
    'funnel-design': [has(c.funnel && c.funnel.steps), (c.funnel && c.funnel.steps || []).map((s) => `${s.step}: ${s.goal}`).join(' → '), 'No funnel.'],
    'landing-pages': [lps.length > 0, lps.map((l) => `${l.variant} at ${l.path}`).join(', '), 'No landing page on this slot.'],
    'conversion-optimisation': [lps.length >= 2 && lps.every((l) => /href="https?:/i.test(l.html || '')), `${n(lps.length, 'landing page')} as an A/B pair, each call to action links to a real page.`, 'A landing page has no working call to action, or there is no A/B pair.'],
    'tracking': [c.tracking && c.tracking.tagged > 0, c.tracking && `${c.tracking.tagged} link(s) tagged utm_campaign=${c.tracking.utm_campaign}.`, 'No link to the brand\'s own site to tag.'],
    'performance-analysis': [has(an.evidence && an.evidence.own_campaign) || !!ownBaseline(e), ownBaseline(e) ? `Briefed with ${ownBaseline(e).campaigns} of the brand's own campaigns.` : 'Briefed with the brand\'s own winners.', 'No own campaign history yet: the writer is told there is none.'],
    'ab-testing': [has(c.test_plan && c.test_plan.tests), c.test_plan && `${c.test_plan.tests.map((t) => `${t.asset} ${t.arms.join(' vs ')} (${t.differs_by})`).join('; ')}${c.test_plan.per_variant ? `; ${c.test_plan.per_variant.toLocaleString('en')} per variant to read a 20% lift` : ''}.`, 'No A/B pair on this slot.'],
  };
  const depts = MT.DEPARTMENTS.map((d) => ({
    id: d.id, n: d.n, name: d.name,
    steps: d.steps.filter((s) => s.per_slot).map((s) => {
      const r = R[s.id];
      if (!r) return { id: s.id, name: s.name, state: 'done', says: s.does };
      const ok = !!r[0];
      return { id: s.id, name: s.name, state: ok ? 'done' : 'gap', says: String((ok ? r[1] : r[2]) || r[1] || '').slice(0, 400) };
    }),
  })).filter((d) => d.steps.length);
  const all = depts.flatMap((d) => d.steps);
  c.departments = { departments: depts, done: all.filter((s) => s.state === 'done').length, gaps: all.filter((s) => s.state === 'gap').length, steps: all.length };
  return c.departments;
}

/** Everything above, in order. Never throws: a build is never lost to its own bookkeeping. */
function applyToCampaign(campaign, entry, opts) {
  for (const f of [attachTracking, attachSeoChecks, attachMeasurement, attachTestPlan, attachDepartments]) {
    try { f(campaign, entry, opts); } catch (_) { /* advisory */ }
  }
  return campaign;
}

/* ── the technical SEO audit of the brand's own site ───────────────── */
const STOP = new Set('the and for with your you our are was this that from have has not but all any can will more about into over out off new now get how why what when who its it\'s a an of to in on at by or is be as we us'.split(' '));

/**
 * Read the brand's own website (its record's website, never a URL a caller names) and judge each
 * page it reaches. `opts.fetchImpl` / `assetFetch` are for tests.
 */
async function siteAudit(brand, opts) {
  const o = opts || {};
  const site = String((brand && brand.website) || '').trim();
  if (!/^https?:\/\//i.test(site)) {
    return { ok: false, error: 'website_required', message: `${(brand && brand.name) || 'This brand'} has no website on its record, so there is no site to audit. Add it in brand setup.` };
  }
  const crawl = require('./site-crawl.js');
  const pages = [];
  const res = await crawl.crawlSite(site, {
    brand, maxPages: Math.min(Number(o.maxPages) || 25, 60), maxDepth: 2, totalMs: Math.min(Number(o.totalMs) || 40000, 50000),
    fetchImpl: o.fetchImpl, assetFetch: o.assetFetch,
    onPage: (html, url) => { if (pages.length < 60) pages.push({ url, check: MT.seoCheck(html, { expectCanonical: true }) }); },
  });
  if (!res || res.ok === false) return { ok: false, error: (res && res.error) || 'crawl_failed', message: 'The site could not be read from here.' };
  const titles = new Map(); const descs = new Map();
  for (const p of pages) {
    if (p.check.title) titles.set(p.check.title, (titles.get(p.check.title) || 0) + 1);
    if (p.check.description) descs.set(p.check.description, (descs.get(p.check.description) || 0) + 1);
  }
  const dupTitles = [...titles].filter(([, k]) => k > 1).map(([t, k]) => ({ title: t, pages: k }));
  const dupDescs = [...descs].filter(([, k]) => k > 1).length;
  const terms = new Map();
  for (const p of pages) {
    for (const w of `${p.check.title} ${p.check.h1}`.toLowerCase().split(/[^a-z0-9À-ɏ]+/)) {
      if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
      terms.set(w, (terms.get(w) || 0) + 1);
    }
  }
  const sum = (id, level) => pages.filter((p) => p.check.findings.some((f) => f.id === id && f.level === level)).length;
  const issues = [
    ['title', 'fix', 'pages with no title'], ['title', 'improve', 'titles longer than 60 or shorter than 10 characters'],
    ['description', 'fix', 'pages with no meta description'], ['description', 'improve', 'descriptions outside 50-160 characters'],
    ['h1', 'fix', 'pages with no H1'], ['h1', 'improve', 'pages with more than one H1'],
    ['alt', 'fix', 'pages with images missing alt text'], ['canonical', 'improve', 'pages with no canonical link'],
    ['structured_data', 'improve', 'pages with no structured data'], ['viewport', 'fix', 'pages with no viewport meta'],
    ['lang', 'improve', 'pages with no declared language'], ['open_graph', 'improve', 'pages with no Open Graph title'],
  ].map(([id, level, label]) => ({ id, level, label, pages: sum(id, level) })).filter((x) => x.pages > 0);
  const schema = [...new Set(pages.flatMap((p) => p.check.schema_types))];
  return {
    ok: true, site, pages_read: pages.length, coverage: res.coverage_note,
    robots: { read: true, disallowed_examples: (res.notes || []).filter((n) => /robots/i.test(String(n))).slice(0, 3) },
    sitemap: res.sitemap ? { found: !!res.sitemap.found, declared: res.sitemap.declared || 0 } : { found: false, declared: 0 },
    issues, duplicate_titles: dupTitles.slice(0, 10), duplicate_descriptions: dupDescs,
    schema_types: schema,
    answer_engines: {
      organization: schema.some((t) => /^(Organization|Corporation|LocalBusiness|NewsMediaOrganization|Store)$/i.test(t)),
      faq: schema.some((t) => /^FAQPage$/i.test(t)),
      product: schema.some((t) => /^(Product|ProductGroup)$/i.test(t)),
      article: schema.some((t) => /Article$/i.test(t)),
    },
    top_terms: [...terms].sort((x, y) => y[1] - x[1]).slice(0, 20).map(([term, count]) => ({ term, pages: count })),
    terms_note: 'The words the site\'s own titles and H1s use most. No search volume: that needs a keyword data source, which is not connected.',
    pages: pages.map((p) => ({ url: p.url, title: p.check.title, fixes: p.check.fixes, improves: p.check.improves, findings: p.check.findings.filter((f) => f.level !== 'ok') })),
  };
}

module.exports = { seoHead, applyToCampaign, attachTracking, attachMeasurement, attachTestPlan, attachSeoChecks, attachDepartments, siteAudit, ownBaseline, ownHosts, campaignTag, FORWARD_UTM };
