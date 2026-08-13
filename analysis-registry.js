/* eslint-env browser, node */
/**
 * analysis-registry.js — the one place that says WHICH analysis lives WHERE.
 *
 * WHY THIS FILE EXISTS. The product had grown seven analysis surfaces that each
 * decided for themselves what they analysed, and several of them analysed the
 * same thing. The Business Review was a standalone page AND ten Data Analysis
 * tabs; the Market Study page carried an intraday revenue pacer that repeated
 * the Control Room; the RFM tool was matched by the Data Analysis nav group but
 * linked from nowhere inside it. Nothing in the codebase stated the intended
 * arrangement, so every drift was invisible until someone opened two pages side
 * by side.
 *
 * This module states it once. The Data Analysis page builds its tab bar from
 * TABS and its drill-down bar from DRILLDOWNS; each standalone analysis page
 * builds its "you are inside Data Analysis" breadcrumb from the same records;
 * and tests/data-analysis.spec.js asserts the invariants the arrangement exists
 * to guarantee: every analysis is reachable from Data Analysis, every retired
 * route still resolves, and no `analysis` key is claimed by two surfaces.
 *
 * It is a UMD module on purpose. The pages are standalone static HTML with no
 * build step, so they need a plain <script>; the Node test and any _shared
 * module need require(). Anything served from api/ is excluded from the static
 * output, which is why this sits at the repository root next to auth.js.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LifecycleAnalysisRegistry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * The Data Analysis tab bar, in order.
   *
   *   id        the `?tab=` value. STABLE: the shared nav and external links
   *             address tabs by it, so an id is aliased rather than renamed.
   *   analysis  the unit of analysis this tab owns. Exactly one surface in the
   *             whole product may own a given key; that is what "no duplicate
   *             pages for the same type of analysis" reduces to mechanically.
   *   kind      native   = rendered from the compiled market export in-page
   *             live     = rendered from a live connector read
   *             review   = the retained deep-dive report, embedded
   *             settings = configuration, not an analysis (owns no key)
   *   region    per-market  = the tab re-reads when the market toggle changes
   *             deployment  = the figures belong to the deployment's connected
   *                           accounts, not to one market, and say so
   */
  var TABS = [
    {
      id: 'control', label: 'Control Room', group: 'Business performance', kind: 'native',
      analysis: 'trading-performance', region: 'per-market',
      source: 'the active brand\'s market export, compiled by scripts/build-market-analytics.js',
      what: 'Revenue, orders, average order value, category and day-of-week mix for the selected market, against the sector funnel and north-star model.',
    },
    {
      id: 'acq', label: 'Acquisition', group: 'Business performance', kind: 'native',
      analysis: 'acquisition-mix', region: 'per-market',
      source: 'the active brand\'s market export',
      what: 'Where new customers and revenue come from: sales by channel and new-customer volume by month.',
    },
    {
      id: 'ret', label: 'Retention', group: 'Business performance', kind: 'native',
      analysis: 'retention-mix', region: 'per-market',
      source: 'the active brand\'s market export',
      what: 'New against returning customers, the returning-customer rate and discount exposure.',
    },
    {
      id: 'cohort', label: 'Cohorts', group: 'Business performance', kind: 'native',
      analysis: 'cohort-retention', region: 'per-market',
      source: 'the active brand\'s market export',
      what: 'First-purchase cohorts and how each one keeps ordering over the quarters that follow.',
    },
    {
      id: 'live-ads', label: 'Paid Media', group: 'Live connectors', kind: 'live', view: 'ads',
      analysis: 'paid-media-performance', region: 'deployment',
      source: '/api/public-config?action=data-analysis&view=ads',
      what: 'Spend, delivery, conversions and return on ad spend across Meta, Google and TikTok, from account level down to ad level.',
    },
    {
      id: 'mailer-intelligence', label: 'Owned Channels', group: 'Live connectors', kind: 'live', view: 'mailer',
      analysis: 'owned-channel-performance', region: 'deployment',
      source: '/api/public-config?action=data-analysis&view=mailer',
      what: 'Email and messaging performance from Klaviyo and WebEngage: delivery, open and click rates, conversions, attributed revenue and negative signals.',
    },
    {
      id: 'landing-intelligence', label: 'Landing & Experiments', group: 'Live connectors', kind: 'live', view: 'landing',
      analysis: 'landing-experiments', region: 'deployment',
      source: '/api/public-config?action=data-analysis&view=landing',
      what: 'Own landing-page performance, A/B experiment results with significance and sample-ratio checks, and the competitor landing-page benchmark.',
    },
    {
      id: 'action-outcomes', label: 'Actions & Outcomes', group: 'Live connectors', kind: 'live', view: 'actions',
      analysis: 'action-outcomes', region: 'deployment',
      source: '/api/public-config?action=data-analysis&view=actions',
      what: 'What the platform recommended, what shipped, how fast, what it measurably changed, and where a guardrail stopped it.',
    },
    {
      id: 'alert-settings', label: 'Alert Settings', group: 'Live connectors', kind: 'settings', view: 'alerts',
      analysis: null, region: 'deployment',
      source: '/api/public-config?action=data-analysis&view=alerts',
      what: 'Cadence, anomaly thresholds and delivery channels for the automated analysis run. Configuration, not an analysis.',
    },
    {
      id: 'review', label: 'Sales & Business Review', group: 'Deep dives', kind: 'review',
      analysis: 'd2c-business-review', region: 'per-market',
      source: '/lifecycle-usa-d2c-dashboard.html',
      what: 'The retained deep-dive review: historical website performance, customer cohorts and reactivation, catalog and price parity, fulfilment, support, category performance and the storefront access audit.',
    },
  ];

  /**
   * Analysis surfaces that stay on their own page and are ENTERED from a Data
   * Analysis tab. A page earns this treatment when it needs data the Data
   * Analysis workbench does not hold, so folding it in would mean either
   * duplicating the analysis or losing it. `parent` names the tab that owns the
   * entry point, which is what keeps every analysis reachable from one place.
   */
  var DRILLDOWNS = [
    {
      id: 'rfm', label: 'RFM & Segments', href: '/rfm', parent: 'cohort',
      analysis: 'rfm-segmentation',
      what: 'Recency, frequency and monetary scoring of a customer-level file into nine segments, with lifetime value, discount sensitivity, send-time behaviour and per-campaign engagement.',
      why: 'Data Analysis reads a compiled market export of aggregates, never customer rows, and scoring needs the rows. Where a view here also charts revenue or cohorts it is charting the file you loaded on this page, not the market export: the market export is reported once, in Data Analysis, so the two are never two answers to one question.',
    },
    {
      id: 'ads-warehouse', label: 'Paid Media, warehouse depth', href: '/ads-dashboard', parent: 'live-ads',
      analysis: 'paid-media-warehouse',
      what: 'The warehouse view of paid media: every column the platform returns, audience cohorts by age, gender, country, device and placement, naming-standard compliance and the metric-definition catalog.',
      why: 'It reads a Snowflake warehouse directly rather than the platform reporting APIs, and its compliance and catalog panels have no equivalent in the Paid Media tab. Note the scope difference: a warehouse is a DEPLOYMENT-level connection with no per-workspace credential, so the page labels its figures as such, while the Paid Media tab reads the ad accounts this workspace connected. Nothing is shown there until a deployment names its own tables.',
    },
    // There was a third ads drill-down here, "Paid Media knowledge base" at
    // /ads-master. It described "the programme record behind the numbers:
    // account register, budget caps, campaign calendar, creative learnings,
    // organic and user-generated coverage, and the handover source files" — and
    // every one of those was one advertiser's, carried over when this repo was
    // copied from a sibling project and rendered under whichever brand was
    // signed in. There is no per-workspace equivalent to point at: a workspace
    // that just onboarded has no handover record, and writing one would be
    // fabrication. The page and its data are deleted; /ads-master redirects to
    // the Paid Media tab, which reads the accounts the workspace connected.
    {
      id: 'market-study', label: 'Market Study', href: '/research', parent: 'control',
      analysis: 'external-market-study',
      what: 'Market sizing, competitive tiers and the strategic read per region, every figure carrying its published source.',
      why: 'It analyses the market OUTSIDE the brand. Data Analysis measures the brand\'s own trading, so the two never look at the same data.',
    },
    {
      id: 'app-audit', label: 'App Audit', href: '/audit', parent: 'control',
      analysis: 'product-surface-audit',
      what: 'Every feature of this platform scored on accuracy, implementation, execution and results, with the blocker board and roadmap.',
      why: 'Its subject is the product, not the brand\'s commercial data, so it is a separate surface reached from here rather than a tab.',
    },
  ];

  /**
   * Retired `?tab=` values. Every one of these shipped in a link somewhere, so
   * none is dropped: it resolves to the tab that now owns the analysis.
   * The ten review-* ids were ten tab buttons that all rendered the SAME report
   * behind the same iframe, which is the duplication this consolidation removes.
   */
  var TAB_ALIASES = {
    'review-insights': 'review',
    'review-overview': 'review',
    'review-website': 'review',
    'review-customers': 'review',
    'review-catalog': 'review',
    'review-fulfilment': 'review',
    'review-support': 'review',
    'review-category': 'review',
    'review-coffee': 'review',
    'review-access': 'review',
    ads: 'live-ads',
    mailer: 'mailer-intelligence',
    landing: 'landing-intelligence',
    actions: 'action-outcomes',
    alerts: 'alert-settings',
  };

  /**
   * A retired review-* link named a SECTION of the report, not a separate
   * analysis. Collapsing the ten buttons into one tab would otherwise lose that
   * precision, so the alias still carries the section index the embedded report
   * opens on.
   */
  var REVIEW_SECTIONS = {
    review: 0,
    'review-insights': 0,
    'review-overview': 1,
    'review-website': 2,
    'review-customers': 3,
    'review-catalog': 4,
    'review-fulfilment': 5,
    'review-support': 6,
    'review-category': 7,
    'review-coffee': 8,
    'review-access': 9,
  };

  var DEFAULT_TAB = 'control';

  function tab(id) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i];
    return null;
  }

  /** Canonical tab id for anything a link may carry. Never returns null. */
  function resolveTab(requested) {
    var raw = String(requested == null ? '' : requested).trim().toLowerCase();
    if (!raw) return DEFAULT_TAB;
    if (tab(raw)) return raw;
    if (Object.prototype.hasOwnProperty.call(TAB_ALIASES, raw)) return TAB_ALIASES[raw];
    return DEFAULT_TAB;
  }

  /** Section of the embedded review a link asked for; 0 when it asked for none. */
  function reviewSection(requested) {
    var raw = String(requested == null ? '' : requested).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(REVIEW_SECTIONS, raw) ? REVIEW_SECTIONS[raw] : 0;
  }

  function drilldown(id) {
    for (var i = 0; i < DRILLDOWNS.length; i++) if (DRILLDOWNS[i].id === id) return DRILLDOWNS[i];
    return null;
  }

  /** Drill-downs entered from one tab, in declaration order. */
  function drilldownsFor(tabId) {
    return DRILLDOWNS.filter(function (d) { return d.parent === tabId; });
  }

  /**
   * analysis key -> the one surface that owns it. Two owners for one key means
   * two surfaces render the same analysis, which the test treats as a failure.
   */
  function analysisOwners() {
    var owners = {};
    TABS.forEach(function (t) {
      if (!t.analysis) return;
      (owners[t.analysis] = owners[t.analysis] || []).push('data-analysis#' + t.id);
    });
    DRILLDOWNS.forEach(function (d) {
      (owners[d.analysis] = owners[d.analysis] || []).push(d.href);
    });
    return owners;
  }

  // ── Region-wise KPI measurement ───────────────────────────────────────────
  /**
   * The metric vocabulary is NOT defined here. It comes from
   * api/_shared/growth-os-core.js (KPI_MODELS), which chooses the north star and
   * its input metrics from what the brand sells. Defining a second list here is
   * exactly how a dashboard ends up disagreeing with the growth model it is
   * meant to serve.
   *
   * What this table adds is the only thing growth-os cannot know: which field of
   * THIS brand's market export measures that named metric, per market. A metric
   * appears here only when the export field means precisely it. The export's
   * returning-customer rate, for instance, is a trailing-window rate over all
   * customers and is deliberately NOT mapped onto "Repeat purchase rate, ninety
   * days" — passing one off as the other is the quiet kind of fabrication, and
   * an unset row that names its missing connection is more useful than a wrong
   * one that looks precise.
   */
  var KPI_SOURCES = {
    'Revenue per visitor': {
      unit: 'currency',
      connect: 'site analytics, sessions split by market',
      read: function (m) {
        var sessions = totalSessions(m);
        var sales = m && m.summary && m.summary.total_sales;
        return sessions && sales != null ? sales / sessions : null;
      },
    },
    'Conversion rate, all sessions': {
      unit: '%',
      connect: 'site analytics, sessions split by market',
      read: function (m) {
        var sessions = totalSessions(m);
        var orders = m && m.summary && m.summary.orders;
        return sessions && orders != null ? (orders / sessions) * 100 : null;
      },
    },
    'Average order value': {
      unit: 'currency',
      connect: 'the order export for this market',
      read: function (m) {
        var v = m && m.summary && m.summary.aov;
        return v > 0 ? v : null;
      },
    },
    'Repeat purchase rate, ninety days': {
      unit: '%',
      connect: 'order history with a customer key, so a ninety day window can be computed',
      read: function () { return null; },
    },
    'Subscription or repeat-plan share of orders': {
      unit: '%',
      connect: 'the subscription platform, or a sales-channel export that names it',
      read: function (m) {
        var rows = (m && m.channels) || [];
        var total = 0;
        var recurring = 0;
        for (var i = 0; i < rows.length; i++) {
          var orders = Number(rows[i].orders) || 0;
          total += orders;
          if (/subscription|recurring|loop|recharge|plan/i.test(String(rows[i].channel || ''))) recurring += orders;
        }
        return total && recurring ? (recurring / total) * 100 : null;
      },
    },
    'Twelve-month customer value': {
      unit: 'currency',
      connect: 'order history with a customer key, so twelve months of value can be summed',
      read: function () { return null; },
    },
  };

  function totalSessions(m) {
    var s = m && m.sessions;
    if (s == null) return 0;
    if (typeof s === 'number') return s > 0 ? s : 0;
    if (Array.isArray(s)) {
      var sum = 0;
      for (var i = 0; i < s.length; i++) sum += Number(s[i] && (s[i].sessions != null ? s[i].sessions : s[i].value)) || 0;
      return sum;
    }
    return 0;
  }

  /**
   * One KPI row, measured against this market's own export.
   *
   * `basis` follows growth-os-core exactly: measured is this brand's own number,
   * modelled is a sector range and never this brand's result, unset is nothing
   * to show plus the connection that would fill it. A row can carry a modelled
   * benchmark alongside an unset actual, which is the honest state for almost
   * every metric on day one.
   */
  function measureKpi(def, market) {
    var src = KPI_SOURCES[def && def.name];
    var actual = null;
    try { actual = src && market ? src.read(market) : null; } catch (_) { actual = null; }
    if (!(typeof actual === 'number' && isFinite(actual))) actual = null;
    return {
      name: (def && def.name) || '',
      why: (def && def.why) || '',
      note: (def && def.note) || '',
      unit: (src && src.unit) || (def && def.unit) || '',
      actual: actual,
      basis: actual != null ? 'measured' : 'unset',
      benchmark_label: (def && def.benchmark_label) || '',
      benchmark_basis: (def && def.benchmark_label) ? 'modelled' : '',
      connect: actual != null ? '' : ((src && src.connect) || (def && def.connect) || 'the source that measures it'),
    };
  }

  /**
   * The whole KPI band for one market: the north star first, then its inputs,
   * in the order the growth model puts them.
   */
  function marketKpis(model, market) {
    var out = [];
    if (model && model.north_star) {
      var ns = measureKpi(model.north_star, market);
      ns.role = 'north-star';
      out.push(ns);
    }
    ((model && model.inputs) || []).forEach(function (input) {
      var row = measureKpi(input, market);
      row.role = 'input';
      out.push(row);
    });
    return out;
  }

  // ── Drill-down breadcrumb ─────────────────────────────────────────────────
  /**
   * Puts the "you are inside Data Analysis" bar at the top of a drill-down page.
   *
   * WHY A SHARED RENDERER. Each of these pages used to open as a peer dashboard
   * with no statement of how it related to the workbench, which is precisely how
   * a reader concludes there are two competing answers to the same question.
   * The bar names the owning tab, the way back, and the reason the analysis is
   * not simply a tab, and it comes from the same record the tab bar is built
   * from so the two can never describe the relationship differently.
   */
  function mountBreadcrumb(id, doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    var entry = drilldown(id);
    if (!d || !entry || d.getElementById('lc-analysis-crumb')) return null;
    var parent = tab(entry.parent) || tab(DEFAULT_TAB);

    if (!d.getElementById('lc-analysis-crumb-css')) {
      var style = d.createElement('style');
      style.id = 'lc-analysis-crumb-css';
      // A single row that slides. The explanation sits below it so the row
      // itself never has to wrap.
      style.textContent = [
        '#lc-analysis-crumb{border-bottom:1px solid var(--line,rgba(171,135,67,.28));',
        'background:var(--surface,#FFFFFF);padding:9px 18px;font-family:Inter,"Instrument Sans",Arial,sans-serif}',
        '#lc-analysis-crumb .lc-crumb-row{display:flex;flex-wrap:nowrap;align-items:center;gap:8px;',
        'overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:thin;font-size:12.5px}',
        '#lc-analysis-crumb .lc-crumb-row > *{flex:0 0 auto;white-space:nowrap}',
        '#lc-analysis-crumb a{color:var(--brand-accent-text,#6A33D8);font-weight:700;text-decoration:none}',
        '#lc-analysis-crumb a:hover{text-decoration:underline}',
        '#lc-analysis-crumb .lc-crumb-sep,#lc-analysis-crumb .lc-crumb-here{color:var(--soft,#556059)}',
        '#lc-analysis-crumb .lc-crumb-here{font-weight:700}',
        '#lc-analysis-crumb .lc-crumb-why{margin:5px 0 0;font-size:11.5px;line-height:1.5;',
        'color:var(--soft,#556059);max-width:96ch}',
      ].join('');
      (d.head || d.documentElement).appendChild(style);
    }

    var bar = d.createElement('nav');
    bar.id = 'lc-analysis-crumb';
    bar.setAttribute('aria-label', 'Analysis location');
    var row = d.createElement('div');
    row.className = 'lc-crumb-row';

    var home = d.createElement('a');
    home.href = '/data-analysis';
    home.textContent = 'Data Analysis';
    row.appendChild(home);

    var sep1 = d.createElement('span');
    sep1.className = 'lc-crumb-sep'; sep1.textContent = '›';
    row.appendChild(sep1);

    var up = d.createElement('a');
    up.href = '/data-analysis?tab=' + parent.id;
    up.textContent = parent.label;
    row.appendChild(up);

    var sep2 = d.createElement('span');
    sep2.className = 'lc-crumb-sep'; sep2.textContent = '›';
    row.appendChild(sep2);

    var here = d.createElement('span');
    here.className = 'lc-crumb-here'; here.textContent = entry.label;
    row.appendChild(here);

    var why = d.createElement('p');
    why.className = 'lc-crumb-why';
    why.textContent = entry.what + ' ' + entry.why;

    bar.appendChild(row);
    bar.appendChild(why);
    if (d.body) d.body.insertBefore(bar, d.body.firstChild);
    return bar;
  }

  return {
    TABS: TABS,
    DRILLDOWNS: DRILLDOWNS,
    mountBreadcrumb: mountBreadcrumb,
    TAB_ALIASES: TAB_ALIASES,
    REVIEW_SECTIONS: REVIEW_SECTIONS,
    KPI_SOURCES: KPI_SOURCES,
    DEFAULT_TAB: DEFAULT_TAB,
    tab: tab,
    resolveTab: resolveTab,
    reviewSection: reviewSection,
    drilldown: drilldown,
    drilldownsFor: drilldownsFor,
    analysisOwners: analysisOwners,
    measureKpi: measureKpi,
    marketKpis: marketKpis,
  };
}));
