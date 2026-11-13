/* Marketing Team workbench. Shared by the browser and the agent endpoint. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketingWorkbench = factory();
})(typeof self === 'undefined' ? this : self, function () {
  'use strict';

  const tool = (id, name, href) => ({ id, name, href, type: 'tool' });
  const guide = (id, name, steps, href) => ({ id, name, steps, href, type: 'guide' });
  const template = (id, name, fields, href) => ({ id, name, fields, href, type: 'template' });
  const agent = (id, name, source, output, href) => ({ id, name, source, output, href, type: 'agent' });
  const library = (id, name) => ({ id, name, type: 'library' });

  const groups = [
    ['Plan and Research', [
      tool('marketing-plan', 'Marketing Plan', '/plan'),
      tool('market-research', 'Market Research', '/research'),
      agent('customer-insight', 'Customer Insight', 'Paste sourced review excerpts, interview notes or cohort findings.', 'Group recurring needs, triggers and objections. Cite the excerpt for each finding. Distinguish small-sample signals from conclusions.', '/data-analysis'),
      tool('icp', 'ICP Builder', '/avatars'),
      tool('segments', 'Segment Finder', '/cohort-definitions'),
      agent('positioning', 'Positioning', 'Add the target buyer and verified alternatives or competitor findings.', 'Draft positioning options with buyer, category, outcome, differentiator and proof. State which option to test and how.', '/brand-context'),
      tool('competitor-teardown', 'Competitor Teardown', '/competitor-benchmarking'),
      tool('budget', 'Budget Planner', '/publishing?tab=launch'),
    ]],
    ['Create and Launch', [
      tool('brand-voice', 'Brand Voice', '/onboarding'),
      agent('offer-builder', 'Offer Builder', 'Provide the product or service, allowed prices or incentives, and commercial limits.', 'Draft a clear offer, terms, proof, CTA and a test. Label suggestions and leave any missing price or eligibility term blank.', '/brain'),
      agent('content-engine', 'Content Engine', 'Provide the audience, topics, channels and dates for a 30-day content plan.', 'Produce a 30-day calendar with one original post per day. Include platform, hook, draft, CTA, source and any production dependency.', '/social'),
      agent('linkedin-writer', 'LinkedIn Writer', 'Paste a source, point of view or approved experience and state whether the author is a person or the brand.', 'Draft a LinkedIn post with a specific opening, one defensible point, the author’s voice, and a closing that invites a relevant response.', '/social'),
      tool('landing-writer', 'Landing Page Writer', '/landing-pages'),
      agent('email-sequence', 'Email Sequence Writer', 'Provide the lifecycle trigger, audience and approved offer or destination.', 'Draft a sequence with timing, exclusion rules, subject, preheader, body and CTA for each email. Use distinct reasons to act. Include a fatigue check.', '/studio'),
      agent('ad-writer', 'Ad Creative Writer', 'Supply the approved offer, buyer, placements and benchmark references.', 'Write ten distinct creative angles. For each, include its hypothesis, hook, copy, CTA, visual concept, evidence and test metric. Keep public competitor observations separate from performance.', '/ads#angles'),
      agent('video-script', 'Video Script Writer', 'Provide a source brief, product footage and the intended placement.', 'Write a timed script with scene, voiceover, on-screen text and visual direction. End with one CTA. Mark footage still needed.', '/ads'),
    ]],
    ['Guides and Playbooks', [
      guide('strategy-guide', 'Strategy Playbook', ['Record the baseline, audience, market and measurable objective.', 'Choose a channel for each funnel job using customer evidence.', 'Plan production, budget, milestones and approval owners.', 'Set the reporting date, stop criteria and next decision.'], '/growth-os'),
      guide('positioning-guide', 'Positioning Guide', ['List the alternatives customers actually consider.', 'Select the buyer and buying trigger.', 'Pair every differentiator with proof.', 'Test the claim against the same buyer and offer.'], '/brand-context'),
      guide('content-guide', 'Content Playbook', ['Pull topics from customer questions and recurring objections.', 'Assign each piece an audience, funnel stage, source and CTA.', 'Adapt the opening and format to each channel.', 'Track quality, distribution and resulting actions.'], '/social'),
      guide('seo-guide', 'SEO and AEO Guide', ['Start with specific questions buyers ask and inspect the existing pages.', 'Use descriptive titles, one primary heading, clear answers and sources.', 'Check canonical URLs, sitemap, crawl directives, structured data and accessibility.', 'Measure clicks, impressions and sourced AI mentions in the target market.'], '/marketing-team?tool=seo'),
      guide('crm-guide', 'Email and CRM Playbook', ['Confirm consent, sender authentication and deliverability.', 'Map triggers, segments, exclusions and suppression lists.', 'Write and review the sequence before scheduling; check overlapping sends.', 'Monitor clicks, conversions, unsubscribes and complaints.'], '/retention-playbook'),
      guide('paid-guide', 'Paid Ads Playbook', ['Record the audience, offer, placement and destination.', 'Assign a distinct hypothesis and success metric to each test.', 'Build paused, verify tracking and confirm budget before launch.', 'Compare within a platform and currency after sufficient volume.'], '/publishing?tab=launch'),
      guide('conversion-guide', 'Conversion Playbook', ['Find the funnel step with measured drop-off.', 'Review the page and audience source for the likely objection.', 'Write one hypothesis and determine the sample needed.', 'Ship only when the result and guardrail metrics support it.'], '/marketing-team?tool=ab'),
      guide('attribution-guide', 'Attribution Guide', ['Define conversion events and a common reporting window.', 'Apply consistent UTMs and verify attribution in test traffic.', 'Reconcile ad-platform and first-party results separately.', 'Use incrementality evidence for budget decisions where available.'], '/marketing-team?tool=utm'),
    ]],
    ['Skill Libraries and Prompts', [
      library('copy-library', 'Copywriting Library'), library('seo-library', 'SEO Content Library'),
      library('aeo-library', 'AEO Library'), library('social-library', 'Social Library'), library('ad-library', 'Ad Testing Library'),
      agent('case-study', 'Case Study Writer', 'Provide approved customer quotes, the project timeline and evidence of results.', 'Draft the customer problem, intervention, result and lesson. Attach the source to each result and leave unapproved quotes out.'),
      library('marketing-prompts', '250 Marketing Prompts'), library('research-prompts', '50 Research Prompts'),
    ]],
    ['Marketing Agents', [
      agent('trend-scout', 'Trend Scout', 'Provide recent dated sources for the market or select a topic to compare with existing competitor evidence.', 'Report repeated themes with dates and citations, rank opportunities by evidence, and propose one test per theme.', '/research'),
      agent('competitor-watch', 'Competitor Watch', 'Supply prior and current competitor snapshots or notes for a specific time window.', 'Compare offers, ads and pages. Report changes with links and dates. Separate observed activity from performance.', '/competitor-benchmarking'),
      agent('seo-monitor', 'SEO Monitor', 'Paste Search Console or rank export rows with page, query, country, date and metrics.', 'Report query and page changes, with comparable windows and actionable priorities.', '/marketing-team?tool=seo'),
      agent('ai-search', 'AI Search Tracker', 'Paste dated observations with engine, exact query, answer and citation URLs.', 'Record mentions and citations by engine and query. Compare against earlier observations if supplied.', '/marketing-team?tool=seo'),
      agent('repurposer', 'Content Repurposer', 'Paste the source article or video transcript.', 'Create ten individually useful posts with distinct hooks and platform formats. Keep source facts intact and avoid repeated copy.', '/social'),
      agent('ad-performance', 'Ad Performance Agent', 'Add the dates and KPI to evaluate. Use connected paid history if present, or paste an account export.', 'Compare like metrics by platform and currency. Name measured winners and losers only where the sample supports it. Propose the next test.', '/ads-dashboard'),
      agent('lead-nurture', 'Lead Nurture Agent', 'Provide the opted-in segment, qualifying event, approved CTA and current cadence. Omit personal contact data.', 'Draft the next nurture steps, delays, exit rules and exclusions. Keep each message tied to the trigger and flag consent gaps.', '/retention-playbook'),
      agent('weekly-report', 'Weekly Report', 'Provide the week, prior-week comparison, targets and actual channel metrics.', 'Write a one-page report with movement against target, what changed, source coverage and actions with owners.', '/data-analysis'),
    ]],
    ['Templates and Trackers', [
      template('one-page-plan', 'One-Page Plan', ['Objective and KPI target', 'Audience and buying trigger', 'Offer and proof', 'Channels and budget', 'Milestones and measurement'], '/plan'),
      template('content-tracker', 'Content Tracker', ['Asset and campaign', 'Channel and format', 'Owner', 'Due date', 'Status', 'Published link and results'], '/social'),
      template('campaign-brief', 'Campaign Brief', ['Objective and deadline', 'Audience and stage', 'Core message and proof', 'Channel and deliverables', 'Budget and dependencies', 'KPI and reporting date'], '/brain'),
      template('ad-test-tracker', 'Ad Test Tracker', ['Test name and hypothesis', 'Control and variant', 'Placement and audience', 'Budget and KPI', 'Sample and decision date', 'Result and action'], '/marketing-team?tool=ab'),
      template('page-launch', 'Page Launch Checklist', ['Page and owner'], '/landing-pages'),
      template('email-calendar', 'Email Calendar', ['Send date and time zone', 'Campaign and segment', 'Trigger or message', 'Exclusions and suppression', 'Approver and status', 'Tracking link and KPI'], '/mailer-calendar'),
      template('kpi-dashboard', 'KPI Dashboard', ['Date range and market', 'Metric and definition', 'Source and currency', 'Baseline', 'Target', 'Actual and action'], '/data-analysis'),
      template('four-week-launch', 'Four-Week Launch Plan', ['Week 1 — research and offer', 'Week 2 — production and setup', 'Week 3 — QA and launch', 'Week 4 — measurement and follow-up'], '/growth-os'),
    ]],
  ];

  const launchChecks = [
    'Correct brand and market', 'Offer terms match the approved brief', 'Prices and currency match the storefront', 'Claims have proof', 'CTA matches the ad and offer',
    'All destination links resolve', 'Tracking parameters preserved', 'Analytics events tested', 'Consent and privacy controls verified', 'Form validation tested',
    'Form confirmation tested', 'Lead routing verified', 'Mobile layout checked', 'Keyboard navigation works', 'Text contrast checked',
    'Image alt text present', 'Media loads with a useful fallback', 'Page title and description set', 'One primary heading', 'Canonical URL correct',
    'Indexing rules correct', 'Structured data validated', 'Load performance measured', 'Approval recorded', 'Rollback URL or version recorded',
  ];

  const marketing = [
    ['copy-library', 'Homepage headline', 'Provide five headline and subhead pairs; lead with an outcome and attach a proof point.'],
    ['copy-library', 'Offer CTA', 'Write five distinct calls to action with what happens after each click.'],
    ['copy-library', 'Email opening', 'Draft three subject, preheader and opening combinations that advance the same promise.'],
    ['copy-library', 'Objection handling', 'Address the three most relevant objections with a direct answer and evidence.'],
    ['copy-library', 'Product comparison', 'Compare buyer-fit criteria and state where an alternative is a better fit.'],
    ['seo-library', 'Search content brief', 'Map intent and queries to a title, outline, internal links and first-party proof.'],
    ['seo-library', 'Product page rewrite', 'Write a descriptive title, introduction, specifications and FAQ from approved product details.'],
    ['seo-library', 'Content refresh', 'Specify which sections to retain, update or remove and why; include a tracking plan.'],
    ['seo-library', 'Topic cluster', 'Propose one hub and distinct supporting pages with intent and links for each.'],
    ['seo-library', 'Technical SEO triage', 'Rank supplied issues by affected pages, user impact, fix and verification.'],
    ['aeo-library', 'Direct answer', 'Write a short answer followed by a cited explanation and any exceptions.'],
    ['aeo-library', 'Question inventory', 'Group real questions by task and link each to the strongest existing answer.'],
    ['aeo-library', 'Entity description', 'Write a consistent organization description using verified names, services and references.'],
    ['aeo-library', 'Citation audit', 'Compare provided answers with their linked sources and flag any unsupported sentences.'],
    ['aeo-library', 'Answer-ready comparison', 'Structure comparable criteria, definitions and sources in a concise table.'],
    ['social-library', 'LinkedIn point of view', 'Write a first-person post with a specific observation, evidence and a conversation starter.'],
    ['social-library', 'Instagram carousel', 'Write slide-by-slide copy and image direction with a clear opening and payoff.'],
    ['social-library', 'Short video hook', 'Write three opening shots with spoken and on-screen lines, then a timed script.'],
    ['social-library', 'X thread', 'Write a compact thread in which each post adds a new piece of evidence or advice.'],
    ['social-library', 'Social content calendar', 'Plan ten posts with distinct ideas, intended action and format.'],
    ['ad-library', 'Creative angle test', 'Write a control and two variations that test one angle each, with one metric and stop rule.'],
    ['ad-library', 'Paid search ads', 'Draft distinct headlines and descriptions for a single intent cluster and matching landing page.'],
    ['ad-library', 'Ad and landing match', 'Check offer, CTA, product and audience consistency; propose one repair and a validation check.'],
    ['ad-library', 'Static concept', 'Give a visual hierarchy, short headline and approved imagery for the requested placement.'],
    ['ad-library', 'Creative fatigue review', 'Compare results with the relevant baseline and propose refreshes that preserve the proven promise.'],
  ];
  const audiences = ['first-time visitors', 'returning prospects', 'existing customers', 'lapsed customers', 'referral prospects'];
  const marketingContexts = ['learn the value', 'make a decision'];
  const research = [
    ['Market demand', 'Find the problems people repeatedly describe, with frequency, date and source.'],
    ['Competitor offer', 'Compare terms, eligibility, claims and price when published, using each original page.'],
    ['Buying criteria', 'Extract the criteria customers used and group evidence by buying stage.'],
    ['Message patterns', 'Record observed hooks and proof across ads or emails. Keep performance separate.'],
    ['Channel discovery', 'Trace where the audience discovers options and compare evidence quality.'],
    ['Customer objections', 'Quote the exact phrases used, explain where they appear, and flag contradictory evidence.'],
    ['Local constraints', 'Check local product availability, price, language and sales channels with dates and links.'],
    ['Search intent', 'Group actual queries and result examples by task and decision stage.'],
    ['Creative formats', 'Record format, CTA, offer and source date for each example. Note gaps in coverage.'],
    ['Measurement baseline', 'Identify first-party baselines and define which tests can answer remaining questions.'],
  ];

  function prompts(id) {
    if (id === 'research-prompts') return research.flatMap(([name, task]) => audiences.map((audience) => ({
      title: `${name} · ${audience}`, text: `Investigate ${name.toLowerCase()} for ${audience} in [market] for [brand/category]. ${task} Return a source table with link, date and observed fact, then hypotheses, limitations and the next research step.`,
    })));
    return marketing.filter(([category]) => id === 'marketing-prompts' || category === id)
      .flatMap(([, name, task]) => audiences.flatMap((audience) => marketingContexts.map((goal) => ({
        title: `${name} · ${audience} · ${goal}`, text: `Create a ${name.toLowerCase()} for [brand] in [market]. Help ${audience} ${goal}. Use [approved brand facts], [offer terms] and [research links]. ${task} Distinguish verified claims from proposed angles, and name any inputs still needed before use.`,
      }))));
  }

  const items = groups.flatMap(([, group]) => group);
  function find(id) { return items.find((item) => item.id === id); }
  return { groups, items, find, prompts, launchChecks };
});
