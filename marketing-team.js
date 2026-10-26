/*
 * The marketing team: ten departments, each step tied to the feature that does it (2026-10-20).
 *
 * The operator, with "The Ultimate GPT-6 Astra Marketing Team" (10 departments, 4 steps each):
 * "ensure each step mentioned in here is followed and integrated appropriately as per relevance
 * for our smart brain and other features too. Don't limit to Astra 6 though". So this is the
 * screenshot's 40 steps plus the steps this platform already does beyond them, each with:
 *   - `where`: the page(s) that do it (a test resolves every path against vercel.json and the files),
 *   - `status`: built | partial | not_built, and for anything short of built, the reason in a sentence,
 *   - `per_slot`: true when Smart Brain performs it for EVERY slot it builds (marketing-team-server
 *     .attachDepartments records what it did, read off the built campaign).
 * Nothing here claims a step the code does not do: a step with no feature says so.
 *
 * Also the pure tools the page and the server share, one implementation each:
 *   utmUrl / tagLinks   - UTM tags on the brand's own links (never on a marker, mailto, placeholder)
 *   abTest              - two-proportion z-test (the significance calculator)
 *   sampleSize          - visitors per variant to read a stated lift at 95% / 80% power
 *   seoCheck            - the on-page SEO and answer-engine checks of one HTML page
 *
 * UMD: Node requires it; the browser loads the byte-identical root /marketing-team.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketingTeam = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const S = (id, name, does, where, extra) => Object.assign({ id, name, does, where, status: 'built', per_slot: false }, extra || {});

  const DEPARTMENTS = [
    { id: 'strategy', n: 1, name: 'Marketing Strategy & Planning', steps: [
      S('marketing-strategy', 'Marketing strategy', 'A hypothesis per send: who, what, why now, and the result it should move.', ['/brain', '/growth-os'], { per_slot: true }),
      S('goal-setting', 'Goal setting', 'A primary KPI per send, the brand\'s own baseline for it, a planning target and the date to read it.', ['/brain'], { per_slot: true }),
      S('channel-planning', 'Channel planning', 'The job each channel does in the send, and a budget split across paid ad sets.', ['/brain', '/publishing?tab=launch'], { per_slot: true }),
      S('growth-roadmap', 'Growth roadmap', 'A rolling 90-day plan per market, re-planned daily, every slot built ahead.', ['/brain', '/plan']),
      S('budget-allocation', 'Budget allocation', 'A total daily budget split into ad sets by test share, exact to the currency\'s smallest unit.', ['/publishing?tab=launch']),
      S('market-moments', 'Market moments', 'Festivals and dates from the brand\'s own markets placed in the plan.', ['/plan', '/brain']),
    ] },
    { id: 'intel', n: 2, name: 'Market & Customer Intelligence', steps: [
      S('market-research', 'Market research', 'A study per market: categories, competitors and the moments that matter there.', ['/research']),
      S('icp', 'ICP development', 'Personas from the brand\'s own customers; each send names the customer it is for and why now.', ['/avatars', '/cohort-definitions'], { per_slot: true }),
      S('competitor-analysis', 'Competitor analysis', 'The brand\'s competitor set, their emails and ads; each mail is shaped by what competitors\' mail is made of.', ['/competitor-benchmarking', '/competitor-benchmarking#discover'], { per_slot: true }),
      S('customer-insights', 'Customer insights', 'RFM segments, cohorts, repeat intervals and revenue by market from the brand\'s own orders.', ['/rfm', '/data-analysis', '/revenue-by-region'], { per_slot: true }),
      S('review-mining', 'Review mining', 'The brand\'s own testimonials read off its own site, verbatim, as the only proof a send may quote.', ['/brain'], { per_slot: true }),
    ] },
    { id: 'brand', n: 3, name: 'Brand & Messaging', steps: [
      S('brand-strategy', 'Brand strategy', 'One brand record: name, website, markets, offerings, claims, voice, palette, type.', ['/onboarding', '/brand-context']),
      S('positioning', 'Positioning', 'The brand\'s own tagline and claims lead every asset; nothing it does not state.', ['/onboarding'], { per_slot: true }),
      S('messaging', 'Messaging', 'Every model line held to the brand\'s own words; a line it does not back is dropped.', ['/onboarding', '/frameworks'], { per_slot: true }),
      S('offer-development', 'Offer development', 'An offer depth per cohort from the brand\'s own code registry; none invented.', ['/brain'], { per_slot: true }),
      S('brand-identity', 'Brand identity', 'Colours, type and components read off the brand\'s rendered site or its guidelines document.', ['/onboarding', '/design-system']),
      S('brand-knowledge', 'Brand knowledge', 'The brand\'s foundation, catalogue, cohorts, offers, creative and market documents.', ['/kb/brand']),
    ] },
    { id: 'content', n: 4, name: 'Content Marketing & Copywriting', steps: [
      S('content-strategy', 'Content strategy', 'An objective per slot from the cohort\'s own job (activation, reactivation, retention...).', ['/brain', '/plan'], { per_slot: true }),
      S('content-creation', 'Content creation', 'Mail (text and text + visual), landing pages, static and video ads, social posts.', ['/brain', '/studio', '/landing-pages', '/ads', '/social'], { per_slot: true }),
      S('content-distribution', 'Content distribution', 'Each asset mapped to the platforms that carry it, and sent through the dispatch queue.', ['/publishing'], { per_slot: true }),
      S('thought-leadership', 'Thought leadership', 'A daily theme across social and a blog post in Social Media OS.', ['/social'], { status: 'partial', gap: 'There is no long-form article writer or byline programme yet; the blog post is one of the daily social formats.' }),
      S('video-motion', 'Video and motion', 'A playable 9:16 motion ad over the brand\'s own photos for every video ad, and music beds.', ['/brain', '/music'], { per_slot: true }),
      S('localisation', 'Localisation', 'One build per ticked market, in that market\'s currency, time zone and store.', ['/brain', '/plan']),
    ] },
    { id: 'seo', n: 5, name: 'SEO, AEO & AI Search Visibility', steps: [
      S('seo-aeo', 'SEO & AEO', 'Every landing page checked for title, description, one H1, language, alt text and answer-ready structured data.', ['/brain', '/marketing-team?tool=seo'], { per_slot: true }),
      S('keyword-research', 'Keyword research', 'The terms the brand\'s own pages use most in titles and headings, read by the site audit.', ['/marketing-team?tool=seo'], { status: 'partial', gap: 'No search volume or difficulty: that needs a keyword data source (for example Google Ads Keyword Planner), which is not connected.' }),
      S('content-optimisation', 'Content optimisation', 'What to fix on each generated landing page, from the same checks.', ['/brain'], { per_slot: true }),
      S('technical-seo', 'Technical SEO', 'An audit of the brand\'s own site: robots.txt, sitemap, titles, descriptions, H1s, canonicals, alt text, structured data.', ['/marketing-team?tool=seo']),
      S('structured-data', 'Structured data', 'Which schema.org types the brand\'s pages declare (Organization, Product, FAQPage...).', ['/marketing-team?tool=seo']),
    ] },
    { id: 'social', n: 6, name: 'Social Media & LinkedIn Growth', steps: [
      S('social-strategy', 'Social media strategy', 'A daily theme and a post per platform in the brand\'s voice, and per-placement copy on every ad.', ['/social'], { per_slot: true }),
      S('linkedin-growth', 'LinkedIn growth', 'A LinkedIn post per day in Social Media OS, pushed to the company page when its token is set.', ['/social'], { status: 'partial', gap: 'Posting needs LINKEDIN_ACCESS_TOKEN and LINKEDIN_ORG_URN; LinkedIn ads and LinkedIn analytics are not built.' }),
      S('community-building', 'Community building', 'Comments and mentions from connected platforms in one inbox.', ['/publishing?tab=gateway']),
      S('influencer-pr', 'Influencer & PR', 'Any creator or endorsement line is checked for disclosure (16 CFR 255.5) before it can be sent.', ['/brain'], { status: 'partial', gap: 'No creator database, outreach or PR contact list is connected; only the disclosure check exists.' }),
      S('social-performance', 'Social performance', 'Posts below the brand\'s own median are flagged and a regeneration is offered.', ['/publishing?tab=gateway']),
    ] },
    { id: 'paid', n: 7, name: 'Paid Advertising & Customer Acquisition', steps: [
      S('paid-strategy', 'Paid ads strategy', 'Competitor ads that keep running turned into angles, a hook bank, briefs and a test plan.', ['/ads#angles', '/ads'], { per_slot: true }),
      S('campaign-creation', 'Campaign creation', 'Meta, Google, YouTube and TikTok ads per slot, each with a tracked destination; Meta built step by step.', ['/brain', '/publishing?tab=launch'], { per_slot: true }),
      S('audience-targeting', 'Audience targeting', 'Inclusion and exclusion rules, a lookalike seed and retargeting windows per slot.', ['/brain', '/publishing?tab=launch'], { per_slot: true }),
      S('optimisation', 'Optimisation', 'An ad QA score per slot; underperformers flagged against the brand\'s own median; budgets re-split.', ['/publishing?tab=gateway', '/publishing?tab=launch', '/ads-dashboard'], { per_slot: true }),
    ] },
    { id: 'email', n: 8, name: 'Email Marketing, CRM & Automation', steps: [
      S('email-strategy', 'Email strategy', 'A cohort, an objective and a send date per slot, under one fatigue cap across channels.', ['/brain', '/mailer-calendar'], { per_slot: true }),
      S('email-creation', 'Email creation', 'Text and text + visual mail, shaped by the category\'s best mail, held to the brand\'s words.', ['/brain', '/studio'], { per_slot: true }),
      S('automation', 'Automation', 'Triggered flows and scheduled sends through the brand\'s ESP via the dispatch queue.', ['/publishing', '/brain'], { per_slot: true }),
      S('retention-expansion', 'Retention & expansion', 'Replenishment timing measured from the brand\'s own repeat orders; reactivation and winback cohorts.', ['/retention-playbook', '/brain']),
      S('deliverability', 'Deliverability', 'Domain authentication, blocklists, warmup and a preflight gate before anything sends.', ['/publishing?tab=deliverability']),
      S('contact-fatigue', 'Contact fatigue', 'At most 2 (absolute 3) marketing touches per person per 7 days across channels.', ['/brain', '/publishing'], { per_slot: true }),
    ] },
    { id: 'conversion', n: 9, name: 'Lead Generation, Funnels & Conversion', steps: [
      S('lead-generation', 'Lead generation', 'The brand\'s agent on its own website answers visitors in its voice.', ['/agent'], { status: 'partial', gap: 'No lead form or capture into the brand\'s ESP is built; the website agent answers but does not collect contacts.' }),
      S('funnel-design', 'Funnel design', 'Creative, landing page and follow-up mail per slot, each with its job.', ['/brain'], { per_slot: true }),
      S('landing-pages', 'Landing pages', 'An A and B landing page per slot, served at /lp/<id>, plus the landing page builder.', ['/brain', '/landing-pages'], { per_slot: true }),
      S('conversion-optimisation', 'Conversion optimisation', 'Each landing page checked for a working call to action, proof and an A/B pair.', ['/brain', '/marketing-team?tool=ab'], { per_slot: true }),
      S('tracking', 'Tracking links', 'UTM tags on every link to the brand\'s own site, so each sale is read back to the send.', ['/brain', '/marketing-team?tool=utm'], { per_slot: true }),
    ] },
    { id: 'analytics', n: 10, name: 'Analytics, Reporting & Optimisation', steps: [
      S('analytics-reporting', 'Analytics & reporting', 'Sales, cohorts, channels and revenue per market from the brand\'s own data.', ['/data-analysis', '/revenue-by-region', '/rfm']),
      S('performance-analysis', 'Performance analysis', 'Which of the brand\'s own campaigns worked and which are tiring, briefed to the writer.', ['/brain', '/ads-dashboard'], { per_slot: true }),
      S('ab-testing', 'A/B testing', 'A test plan per slot with the sample it needs, and a significance calculator for the result.', ['/brain', '/marketing-team?tool=ab'], { per_slot: true }),
      S('forecasting', 'Forecasting', 'Calendar scenarios, replenishment timing and revenue models from the brand\'s own history.', ['/brain', '/revenue-by-region']),
    ] },
  ];

  /* ── UTM ───────────────────────────────────────────────────────────── */
  const CHANNEL_UTM = {
    email: { source: 'email', medium: 'email' },
    meta: { source: 'meta', medium: 'paid_social' },
    facebook: { source: 'facebook', medium: 'paid_social' },
    instagram: { source: 'instagram', medium: 'paid_social' },
    tiktok: { source: 'tiktok', medium: 'paid_social' },
    pinterest: { source: 'pinterest', medium: 'paid_social' },
    linkedin: { source: 'linkedin', medium: 'paid_social' },
    google: { source: 'google', medium: 'cpc' },
    youtube: { source: 'youtube', medium: 'paid_video' },
    landing_page: { source: 'landing_page', medium: 'referral' },
    social: { source: 'social', medium: 'organic_social' },
    sms: { source: 'sms', medium: 'sms' },
    whatsapp: { source: 'whatsapp', medium: 'messaging' },
    push: { source: 'push', medium: 'push' },
  };
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

  /** The UTM parameters for one channel, or null for a channel nobody named. */
  function utmFor(channel, campaign, content, term) {
    const c = CHANNEL_UTM[String(channel || '').toLowerCase()];
    if (!c || !slug(campaign)) return null;
    const p = { utm_source: c.source, utm_medium: c.medium, utm_campaign: slug(campaign) };
    if (slug(content)) p.utm_content = slug(content);
    if (slug(term)) p.utm_term = slug(term);
    return p;
  }

  /** Is this a link we may tag? Only an absolute http(s) URL, never a placeholder, marker or anchor. */
  function taggable(u) {
    const s = String(u || '').trim();
    if (!/^https?:\/\/[^\s"'<>{}]+$/i.test(s)) return false;
    if (/DATA REQUIRED/i.test(s) || /\{\{|%7B%7B/i.test(s)) return false;
    if (/[?&]utm_source=/i.test(s)) return false;          // already tagged by someone: theirs
    if (/unsubscribe|optout|opt-out|preferences|manage-subscription/i.test(s)) return false;
    return true;
  }

  /** `url` with the UTM params appended (an existing query and fragment kept). */
  function utmUrl(url, params) {
    if (!params || !taggable(url)) return String(url || '');
    const s = String(url);
    const hashAt = s.indexOf('#');
    const base = hashAt >= 0 ? s.slice(0, hashAt) : s;
    const hash = hashAt >= 0 ? s.slice(hashAt) : '';
    const q = Object.keys(params).filter((k) => params[k]).map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
    if (!q) return s;
    return base + (base.includes('?') ? (/[?&]$/.test(base) ? '' : '&') : '?') + q + hash;
  }

  /**
   * Tag every href in `html` whose host `isOwn(host)` accepts. Returns { html, tagged, skipped }.
   * `&` is written `&amp;` inside the attribute, as HTML requires.
   */
  function tagLinks(html, params, isOwn) {
    let tagged = 0; let skipped = 0;
    const out = String(html || '').replace(/(\shref\s*=\s*)(["'])([^"']*)\2/gi, (m, pre, q, raw) => {
      const url = raw.replace(/&amp;/g, '&');
      let host = '';
      try { host = new URL(url).hostname.toLowerCase(); } catch (_) { host = ''; }
      if (!host || !taggable(url) || (typeof isOwn === 'function' && !isOwn(host))) { if (host) skipped += 1; return m; }
      tagged += 1;
      return pre + q + utmUrl(url, params).replace(/&/g, '&amp;') + q;
    });
    return { html: out, tagged, skipped };
  }

  /* ── A/B maths ─────────────────────────────────────────────────────── */
  // Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf), accurate to ~1e-7.
  function normCdf(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
    return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }

  /**
   * Two-proportion z-test, two-sided. a/b = { conversions, visitors }.
   * Never rounds a result into significance: `significant` is p < alpha, stated with the p-value.
   */
  function abTest(a, b, alpha) {
    const al = Number(alpha) > 0 && Number(alpha) < 1 ? Number(alpha) : 0.05;
    const na = Math.floor(Number(a && a.visitors)); const nb = Math.floor(Number(b && b.visitors));
    const xa = Math.floor(Number(a && a.conversions)); const xb = Math.floor(Number(b && b.conversions));
    if (!(na > 0 && nb > 0) || !(xa >= 0 && xb >= 0) || xa > na || xb > nb) {
      return { ok: false, error: 'invalid_counts', message: 'Each variant needs visitors above 0 and conversions between 0 and its visitors.' };
    }
    const pa = xa / na; const pb = xb / nb;
    const pool = (xa + xb) / (na + nb);
    const se0 = Math.sqrt(pool * (1 - pool) * (1 / na + 1 / nb));
    const z = se0 > 0 ? (pb - pa) / se0 : 0;
    const p = se0 > 0 ? 2 * (1 - normCdf(Math.abs(z))) : 1;
    const se = Math.sqrt(pa * (1 - pa) / na + pb * (1 - pb) / nb);
    const zc = 1.959963984540054;
    const lift = pa > 0 ? (pb - pa) / pa : null;
    const significant = p < al;
    return {
      ok: true, rate_a: pa, rate_b: pb, difference: pb - pa, relative_lift: lift, z, p_value: p, alpha: al, significant,
      ci_difference: [pb - pa - zc * se, pb - pa + zc * se],
      winner: significant ? (pb > pa ? 'B' : 'A') : null,
      verdict: significant
        ? `${pb > pa ? 'B' : 'A'} converts better (p = ${p.toFixed(4)}, below ${al}).`
        : `No difference you can act on yet (p = ${p.toFixed(4)}, not below ${al}). Keep the test running or treat it as a tie.`,
    };
  }

  /** Visitors per variant to detect a relative `lift` on baseline rate `p` (two-sided 95%, 80% power). */
  function sampleSize(p, lift) {
    const b = Number(p); const l = Number(lift);
    if (!(b > 0 && b < 1) || !(l > 0)) return null;
    const p2 = Math.min(0.999, b * (1 + l));
    const za = 1.959963984540054; const zb = 0.8416212335729143;
    return Math.ceil(((za + zb) ** 2) * (b * (1 - b) + p2 * (1 - p2)) / ((p2 - b) ** 2));
  }

  /* ── on-page SEO / AEO ─────────────────────────────────────────────── */
  const text = (h) => String(h || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const attr = (tag, name) => { const m = String(tag).match(new RegExp('\\s' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i')); return m ? m[2] : null; };

  /**
   * The on-page checks of one HTML page. Each finding: { id, level: 'fix'|'improve'|'ok', says }.
   * Lengths follow what search results show (title ~60 characters, description 50-160).
   */
  function seoCheck(html, opts) {
    const o = opts || {};
    const h = String(html || '');
    const f = [];
    const add = (id, level, says) => f.push({ id, level, says });
    const titleM = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleM ? text(titleM[1]) : '';
    if (!title) add('title', 'fix', 'The page has no <title>.');
    else if (title.length > 60) add('title', 'improve', `The title is ${title.length} characters; search results cut it near 60.`);
    else if (title.length < 10) add('title', 'improve', `The title is only ${title.length} characters.`);
    else add('title', 'ok', `Title (${title.length} characters).`);
    const metas = h.match(/<meta\b[^>]*>/gi) || [];
    const descTag = metas.find((t) => /name\s*=\s*["']description["']/i.test(t));
    const desc = descTag ? (attr(descTag, 'content') || '').trim() : '';
    if (!desc) add('description', 'fix', 'No meta description: search results will pick a sentence for you.');
    else if (desc.length < 50 || desc.length > 160) add('description', 'improve', `The meta description is ${desc.length} characters; 50-160 shows in full.`);
    else add('description', 'ok', `Meta description (${desc.length} characters).`);
    const h1s = h.match(/<h1\b[\s\S]*?<\/h1>/gi) || [];
    if (!h1s.length) add('h1', 'fix', 'No H1 heading.');
    else if (h1s.length > 1) add('h1', 'improve', `${h1s.length} H1 headings; one says what the page is about.`);
    else add('h1', 'ok', 'One H1.');
    if (!/<html[^>]*\slang\s*=\s*["'][a-z]/i.test(h)) add('lang', 'improve', 'The page does not declare its language (<html lang>).');
    else add('lang', 'ok', 'Language declared.');
    if (!metas.some((t) => /name\s*=\s*["']viewport["']/i.test(t))) add('viewport', 'fix', 'No viewport meta: phones lay the page out at desktop width.');
    const imgs = h.match(/<img\b[^>]*>/gi) || [];
    const noAlt = imgs.filter((t) => attr(t, 'alt') === null).length;
    if (noAlt) add('alt', 'fix', `${noAlt} of ${imgs.length} image(s) have no alt text.`);
    else if (imgs.length) add('alt', 'ok', `All ${imgs.length} image(s) have alt text.`);
    if (o.expectCanonical) {
      if (!/<link[^>]+rel\s*=\s*["']canonical["']/i.test(h)) add('canonical', 'improve', 'No canonical link.');
      else add('canonical', 'ok', 'Canonical link.');
    }
    const ld = (h.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []).join(' ');
    const types = [...new Set((ld.match(/"@type"\s*:\s*"([^"]+)"/g) || []).map((s) => s.replace(/.*"([^"]+)"$/, '$1')))];
    if (!types.length) add('structured_data', 'improve', 'No structured data (schema.org JSON-LD): answer engines and rich results read it.');
    else add('structured_data', 'ok', `Structured data: ${types.join(', ')}.`);
    if (!metas.some((t) => /property\s*=\s*["']og:title["']/i.test(t))) add('open_graph', 'improve', 'No Open Graph title: a shared link shows no card title.');
    const words = text(h).split(' ').filter(Boolean).length;
    const fixes = f.filter((x) => x.level === 'fix').length;
    const improves = f.filter((x) => x.level === 'improve').length;
    return { title, description: desc, h1: h1s.length ? text(h1s[0]) : '', schema_types: types, words, findings: f, fixes, improves };
  }

  /** The registry (the route's op=map answer). */
  function map() { return DEPARTMENTS; }

  /** Every `where` path the registry names (for the routing test and the page). */
  function paths() {
    const out = new Set();
    for (const d of DEPARTMENTS) for (const s of d.steps) for (const w of s.where) out.add(w);
    return [...out];
  }

  /* ── The B2B marketing department picture (2026-10-26): its fifty roles, ten
     departments of five, and what does each one here: an agent of the team that
     builds every send (marketing-agents.js; `pair` names it), a code check, a
     page, a skill run in Claude Code, or nothing, with the reason. */
  const A = (pair) => ({ by: 'agent', pair });
  const C = (where, note) => ({ by: 'code', where, note });
  const F = (where, note) => ({ by: 'feature', where, note });
  const N = (note) => ({ by: 'none', note });
  const K = (where, note) => ({ by: 'skill', where, note });
  const ROSTER = [
    { n: 1, department: 'Strategy & Planning', roles: [
      ['Marketing Strategist', A('strategy')],
      ['Quarterly Planning Lead', F('/brain', 'The rolling 90-day plan per market, re-planned daily.')],
      ['Budget Allocation Planner', F('/publishing?tab=launch', 'Paid launch splits a daily budget across ad sets by test share.')],
      ['Go-to-Market Planner', F('/plan', 'Market moments and launches placed in the plan.')],
      ['Marketing Priorities Reviewer', A('strategy')],
    ] },
    { n: 2, department: 'Customer & Market Intelligence', roles: [
      ['Customer Interview Analyst', N('No interview transcripts are collected; review text is mined instead (Owner\'s Desk).')],
      ['Market Research Analyst', F('/research', 'A study per market.')],
      ['Competitor Intelligence Analyst', F('/competitor-benchmarking', 'The brand\'s competitor set, their mail and long-running ads.')],
      ['Customer Proof Auditor', C('api/_shared/brand-reviews.js', 'Only the brand\'s own published reviews, verbatim; the proof gate drops anything else.')],
      ['Win-Loss Researcher', N('B2B deal outcomes: this product has no sales pipeline to read.')],
    ] },
    { n: 3, department: 'Segments & Buying Journeys', roles: [
      ['Segmentation Strategist', C('api/_shared/rfm-core.js', 'Cohorts computed from the brand\'s own orders.')],
      ['ICP Definition Lead', K('.claude/commands/icp-builder.md', 'The ICP builder skill (run in Claude Code, not in the app).')],
      ['Buying Group Mapper', N('B2B buying committees: not applicable to consumer sends.')],
      ['Buyer Journey Designer', F('/mailer-calendar', 'Lifecycle journeys per cohort.')],
      ['Buying Situation Analyst', A('strategy')],
    ] },
    { n: 4, department: 'Positioning & Messaging', roles: [
      ['Positioning Strategist', A('messaging')],
      ['Value Proposition Designer', A('messaging')],
      ['Messaging Architect', A('messaging')],
      ['Objection Narrative Lead', A('messaging')],
      ['Message Consistency Reviewer', A('copy')],
    ] },
    { n: 5, department: 'Content & Creative', roles: [
      ['Content Strategist', A('brief')],
      ['Editorial Planning Lead', F('/brain', 'One send per slot on the calendar, each with its own angle.')],
      ['Creative Brief Writer', A('brief')],
      ['Campaign Copywriter', A('copy')],
      ['Content Quality Reviewer', A('copy')],
    ] },
    { n: 6, department: 'Campaigns & Distribution', roles: [
      ['Campaign Planner', F('/brain', 'Every slot planned with channels, cohort and date.')],
      ['Channel Mix Strategist', A('brief')],
      ['Distribution Coordinator', F('/publishing', 'The dispatch queue to each platform.')],
      ['Paid Media Brief Writer', A('brief')],
      ['Partner Campaign Planner', N('No partner or affiliate data is connected.')],
    ] },
    { n: 7, department: 'Search & Demand Capture', roles: [
      ['Search Demand Analyst', N('Keyword volumes need a source that is not connected (Ahrefs or Search Console).')],
      ['Keyword Intent Mapper', N('Same: no keyword source is connected.')],
      ['SEO Content Planner', F('/marketing-team', 'Every landing page gets its own meta description and SEO checks.')],
      ['Technical SEO Reviewer', C('api/_shared/marketing-team.js', 'seoCheck on every landing page; the site audit on /marketing-team.')],
      ['Demand Capture Strategist', A('brief')],
    ] },
    { n: 8, department: 'Website & Lifecycle Conversion', roles: [
      ['Landing Page Reviewer', C('api/_shared/asset-contracts.js', 'The landing page contract: one goal, a working button, every link resolved.')],
      ['Conversion Copywriter', A('copy')],
      ['Form Friction Analyst', N('The landing pages carry no forms; the button goes to the product page.')],
      ['Lifecycle Journey Planner', F('/mailer-calendar', 'Cohort journeys and frequency caps.')],
      ['Email Nurture Designer', K('.claude/commands/email-flow.md', 'The email-flow skill designs a flow and builds it in Klaviyo when connected.')],
    ] },
    { n: 9, department: 'Marketing Ops & Sales Alignment', roles: [
      ['Marketing Operations Planner', C('api/_shared/contact-fatigue.js', 'One contact ledger and fatigue policy across channels.')],
      ['Lead Routing Designer', N('B2B lead routing: no sales team flow in this product.')],
      ['CRM Data Quality Reviewer', C('api/_shared/brand-coherence.js', 'The brand record and catalogue are checked to describe one brand.')],
      ['Sales Handoff Coordinator', N('B2B: no sales handoff.')],
      ['Sales Enablement Brief Writer', N('B2B: no sales team to brief.')],
    ] },
    { n: 10, department: 'Measurement & Experimentation', roles: [
      ['Funnel Performance Analyst', F('/data-analysis', 'Funnels and channel performance from the brand\'s own data.')],
      ['Campaign Measurement Lead', C('api/_shared/marketing-team-server.js', 'A KPI, the brand\'s own baseline and a read date on every send.')],
      ['Attribution Evidence Reviewer', C('api/_shared/creative-evidence.js', 'Only campaigns with the figures that qualified them count as evidence.')],
      ['Experiment Designer', C('api/_shared/marketing-team-server.js', 'An A/B pair per send with the sample each variant needs.')],
      ['Learning Review Facilitator', F('/brain', 'Daily Sync feeds results back into the next plan.')],
    ] },
  ];

  return { DEPARTMENTS, ROSTER, map, CHANNEL_UTM, utmFor, utmUrl, taggable, tagLinks, normCdf, abTest, sampleSize, seoCheck, paths, slug };
});
