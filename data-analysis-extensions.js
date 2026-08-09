/* eslint-env browser */
(function () {
  'use strict';
  if (window.__KnickgasmDataAnalysisExtensions) return;
  window.__KnickgasmDataAnalysisExtensions = true;

  var API = '/api/public-config?action=data-analysis';
  var REFRESH_MS = 60000;
  var state = {
    tab: null,
    adsTimer: null,
    reviewIndex: 0,
    reviewFrame: null,
    reviewReady: false,
    lastPayload: {},
  };

  var REVIEW_TABS = [
    { id: 'review-insights', label: 'Review Insights', index: 0 },
    { id: 'review-overview', label: 'Executive Overview', index: 1 },
    { id: 'review-website', label: 'Website Performance', index: 2 },
    { id: 'review-customers', label: 'Customers & Reactivation', index: 3 },
    { id: 'review-catalog', label: 'Catalog & Pricing', index: 4 },
    { id: 'review-fulfilment', label: 'Fulfilment & Delivery', index: 5 },
    { id: 'review-support', label: 'Support & CX', index: 6 },
    { id: 'review-category', label: 'Category Performance', index: 7 },
    { id: 'review-coffee', label: 'Category Deep-dive', index: 8 },
    { id: 'review-access', label: 'Access Audit', index: 9 },
  ];
  var LIVE_TABS = [
    { id: 'live-ads', label: 'Live Ads' },
    { id: 'mailer-intelligence', label: 'Mailer Intelligence' },
    { id: 'landing-intelligence', label: 'Landing Pages & Experiments' },
    { id: 'action-outcomes', label: 'Actions & Outcomes' },
    { id: 'alert-settings', label: 'Alert Settings' },
  ];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }
  function fmt(v, digits) { return num(v).toLocaleString(undefined, { maximumFractionDigits: digits == null ? 0 : digits }); }
  function money(v) { return '$' + num(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function percent(v, digits) { return (num(v) * 100).toFixed(digits == null ? 1 : digits) + '%'; }
  function ratio(v, digits) { return num(v).toFixed(digits == null ? 2 : digits) + '×'; }
  function dateTime(v) {
    if (!v) return '—';
    var d = new Date(v); if (Number.isNaN(d.getTime())) return esc(v);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  function boolBadge(on, yes, no) {
    return '<span class="xbadge ' + (on ? 'ok' : 'off') + '">' + esc(on ? (yes || 'Connected') : (no || 'Not connected')) + '</span>';
  }
  function note(text, kind) { return '<div class="xnotice ' + (kind || '') + '">' + esc(text || '') + '</div>'; }
  function kpis(items) {
    return '<div class="xkpis">' + items.map(function (x) {
      return '<div class="xkpi"><div class="xkl">' + esc(x.label) + '</div><div class="xkv">' + esc(x.value) + '</div>' + (x.sub ? '<div class="xks">' + esc(x.sub) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function table(headers, rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return '<div class="xempty">No source-backed rows are available for this view yet.</div>';
    var limit = opts.limit || rows.length;
    return '<div class="xtable"><table><thead><tr>' + headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.slice(0, limit).map(function (r) {
      return '<tr>' + r.map(function (c) { return '<td>' + (c && c.__html != null ? c.__html : esc(c == null ? '—' : c)) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  }
  function panelTitle(title, subtitle, controls) {
    return '<div class="xhead"><div><h2>' + esc(title) + '</h2><p>' + esc(subtitle || '') + '</p></div>' + (controls || '') + '</div>';
  }
  function currentMarket() {
    var b = document.querySelector('#mktToggle button.on');
    return b ? String(b.getAttribute('data-mkt') || 'US').toUpperCase() : 'US';
  }
  function addDays(date, days) { var d = new Date(date); d.setDate(d.getDate() + days); return d; }
  function isoDate(d) { return d.toISOString().slice(0, 10); }
  function apiUrl(view, params) {
    var u = new URL(API, location.origin);
    u.searchParams.set('view', view);
    Object.keys(params || {}).forEach(function (k) { if (params[k] != null && params[k] !== '') u.searchParams.set(k, params[k]); });
    return u.pathname + u.search;
  }
  async function getJson(view, params) {
    var token = await userToken();
    var headers = token ? { authorization: 'Bearer ' + token } : {};
    var r = await fetch(apiUrl(view, params), { cache: 'no-store', credentials: 'same-origin', headers: headers });
    var body = await r.json().catch(function () { return null; });
    if (!r.ok || !body) throw new Error(body && (body.message || body.error) || ('Request failed (' + r.status + ')'));
    return body;
  }
  async function userToken() {
    try {
      if (window.LifecycleAuth && window.LifecycleAuth.session && window.LifecycleAuth.session.access_token) return window.LifecycleAuth.session.access_token;
      if (window.LifecycleAuth && window.LifecycleAuth.client) {
        var out = await window.LifecycleAuth.client.auth.getSession();
        return out && out.data && out.data.session && out.data.session.access_token || '';
      }
    } catch (_) {}
    return '';
  }
  async function postJson(op, payload) {
    var token = await userToken();
    if (!token) throw new Error('Sign in with an authorised KNICKGASM account to change or test alert settings.');
    var r = await fetch(API, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(Object.assign({ op: op }, payload || {})),
    });
    var body = await r.json().catch(function () { return null; });
    if (!r.ok || !body || body.ok === false) throw new Error(body && (body.message || body.error) || ('Request failed (' + r.status + ')'));
    return body;
  }
  function statusLine(id, text, kind) {
    var el = document.getElementById(id); if (!el) return;
    el.className = 'xstatus ' + (kind || ''); el.textContent = text || '';
  }
  function loader(title) {
    return panelTitle(title, 'Fetching source-backed data…') + '<div class="xloading"><span></span><span></span><span></span></div>';
  }
  function failure(title, err) {
    return panelTitle(title, 'The requested view could not be loaded.') + note(String(err && err.message || err), 'bad');
  }

  function injectCss() {
    if (document.getElementById('data-analysis-extension-css')) return;
    var style = document.createElement('style');
    style.id = 'data-analysis-extension-css';
    style.textContent = [
      '.vh-tab-group{align-self:center;padding:4px 8px 4px 12px;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);white-space:nowrap}',
      '#extendedAnalysisPanel{display:none;margin-top:14px}',
      '#extendedAnalysisPanel.on{display:block}',
      '.xpanel{min-height:220px}',
      '.xhead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:6px 0 16px}',
      '.xhead h2{font-size:24px!important;color:var(--head)!important}',
      '.xhead p{max-width:78ch;margin:5px 0 0;color:var(--soft);font-size:13px;line-height:1.55}',
      '.xcontrols{display:flex;align-items:end;gap:8px;flex-wrap:wrap}',
      '.xfield{display:flex;flex-direction:column;gap:4px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--soft)}',
      '.xfield input,.xfield select,.xinput{min-height:36px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);padding:7px 9px;font:600 12px Inter,Arial,sans-serif;text-transform:none;letter-spacing:0}',
      '.xbtn{min-height:36px;border:1px solid var(--lava);border-radius:8px;background:var(--violet);color:var(--chalk);padding:8px 12px;font:700 12px Inter,Arial,sans-serif;cursor:pointer}',
      '.xbtn.secondary{background:var(--surface);color:var(--violet)}.xbtn:disabled{opacity:.45;cursor:not-allowed}',
      '.xkpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:0 0 14px}',
      '.xkpi{background:var(--surface);border:1px solid var(--line);border-radius:11px;padding:12px 13px;min-width:0}',
      '.xkl{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--soft);font-weight:800}',
      '.xkv{font-family:"Montserrat",Georgia,serif;font-size:21px;line-height:1.15;color:var(--head);margin-top:4px;overflow-wrap:anywhere}',
      '.xks{font-size:10.5px;color:var(--soft);margin-top:4px;line-height:1.35}',
      '.xgrid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px;margin:12px 0}',
      '.xcard{grid-column:span 6;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:15px 16px;min-width:0}',
      '.xcard.span12{grid-column:span 12}.xcard.span4{grid-column:span 4}.xcard.span8{grid-column:span 8}',
      '.xcard h3{font-family:"Montserrat",Georgia,serif;font-size:16px;color:var(--head);margin:0 0 4px}',
      '.xcard p{font-size:12px;color:var(--soft);margin:0 0 10px;line-height:1.5}',
      '.xmeta{display:flex;gap:7px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--soft);margin:6px 0 12px}',
      '.xbadge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:800;background:#eef3f0;color:#14643e;border:1px solid #b9d8c7}',
      '.xbadge.off{background:#f5eee1;color:#855e18;border-color:#dfc997}.xbadge.bad{background:#fdeaea;color:#9d2929;border-color:#edbcbc}',
      '.xnotice{border:1px solid var(--line);border-left:4px solid var(--lava);background:var(--surface);border-radius:9px;padding:10px 12px;font-size:12.5px;color:var(--soft);line-height:1.5;margin:10px 0}',
      '.xnotice.bad{border-left-color:#a52a2a}.xnotice.good{border-left-color:#16814b}',
      '.xtable{overflow:auto;border:1px solid var(--line);border-radius:10px;max-height:560px;background:var(--surface)}',
      '.xtable table{min-width:820px;font-size:12px}.xtable th{position:sticky;top:0;z-index:1}.xtable td,.xtable th{padding:8px 10px;white-space:nowrap}',
      '.xempty{padding:28px 16px;text-align:center;color:var(--soft);border:1px dashed var(--line);border-radius:10px;background:var(--surface);font-size:12.5px}',
      '.xloading{display:flex;justify-content:center;gap:7px;padding:65px}.xloading span{width:9px;height:9px;border-radius:50%;background:var(--lava);animation:xblink 1.1s infinite}.xloading span:nth-child(2){animation-delay:.15s}.xloading span:nth-child(3){animation-delay:.3s}',
      '@keyframes xblink{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}',
      '.xstatus{font-size:12px;color:var(--soft);min-height:18px;margin-top:8px}.xstatus.good{color:#14643e}.xstatus.bad{color:#9d2929}',
      '.xsplit{display:grid;grid-template-columns:1fr 1fr;gap:12px}.xform-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
      '.xform-row{display:flex;gap:12px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding:9px 0;font-size:12.5px}.xform-row:last-child{border:0}',
      '.xswitch{display:inline-flex;align-items:center;gap:7px;font-weight:700;color:var(--head)}.xswitch input{width:17px;height:17px;accent-color:var(--violet)}',
      '.xreview-note{margin:0 0 10px}.xreview-frame{display:block;width:100%;border:1px solid var(--line);border-radius:12px;background:#FFFFFF;min-height:800px}',
      '.xplatform{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);font-size:12px}.xplatform:last-child{border:0}',
      '.xmetric-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.xmetric{border:1px solid var(--line);border-radius:9px;padding:9px 10px;font-size:12px}.xmetric b{color:var(--head)}',
      '@media(max-width:900px){.xcard,.xcard.span4,.xcard.span8{grid-column:span 12}.xsplit,.xform-grid{grid-template-columns:1fr}.xhead{align-items:stretch}.xcontrols{align-items:stretch}.xfield{flex:1 1 130px}}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function installPanel() {
    var dash = document.getElementById('dash');
    var k = document.getElementById('kpis');
    if (!dash || !k || document.getElementById('extendedAnalysisPanel')) return;
    var p = document.createElement('section');
    p.id = 'extendedAnalysisPanel'; p.className = 'xpanel';
    k.parentNode.insertBefore(p, k);
  }

  function removeSeparateReviewEntry() {
    var cta = document.getElementById('reviewCta'); if (cta) cta.remove();
    function remove() {
      document.querySelectorAll('a[href]').forEach(function (a) {
        var href = String(a.getAttribute('href') || '');
        if (/\/(d2c-review|business-review|usa-d2c-report|usa-d2c-dashboard)(?:$|[?#])/.test(href)) {
          var row = a.closest('.lnav-item,.lnav-row,li') || a;
          row.style.display = 'none';
          row.setAttribute('aria-hidden', 'true');
        }
      });
    }
    remove(); setTimeout(remove, 500); setTimeout(remove, 1800);
  }

  function addTabs() {
    var tabs = document.getElementById('anTabs');
    if (!tabs || tabs.querySelector('[data-ext-tab]')) return;
    function group(label) { var s = document.createElement('span'); s.className = 'vh-tab-group'; s.textContent = label; tabs.appendChild(s); }
    group('Live Intelligence');
    LIVE_TABS.forEach(function (t) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = t.label;
      b.setAttribute('data-ext-tab', t.id); b.addEventListener('click', function () { openTab(t.id); }); tabs.appendChild(b);
    });
    group('Business Review');
    REVIEW_TABS.forEach(function (t) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = t.label;
      b.setAttribute('data-ext-tab', t.id); b.addEventListener('click', function () { openTab(t.id); }); tabs.appendChild(b);
    });
    tabs.querySelectorAll('button[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { showNative(); setParentTab(b.getAttribute('data-tab') || 'control'); });
    });
  }

  function setParentTab(tab) {
    try {
      var u = new URL(parent.location.href); u.searchParams.set('tab', tab);
      parent.history.replaceState(null, '', u.pathname + u.search + u.hash);
    } catch (_) {}
  }
  function clearAdsTimer() { if (state.adsTimer) clearInterval(state.adsTimer); state.adsTimer = null; }
  function showNative() {
    clearAdsTimer(); state.tab = null;
    var panel = document.getElementById('extendedAnalysisPanel'); if (panel) { panel.classList.remove('on'); panel.innerHTML = ''; }
    ['kpis', 'signals', 'grid', 'footnote'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = ''; });
    document.querySelectorAll('#anTabs button[data-ext-tab]').forEach(function (b) { b.classList.remove('on'); });
  }
  function showExtension(id) {
    clearAdsTimer(); state.tab = id;
    ['kpis', 'signals', 'grid', 'footnote'].forEach(function (x) { var el = document.getElementById(x); if (el) el.style.display = 'none'; });
    var panel = document.getElementById('extendedAnalysisPanel'); panel.classList.add('on'); panel.innerHTML = '';
    document.querySelectorAll('#anTabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-ext-tab') === id); });
    setParentTab(id);
    return panel;
  }
  function openTab(id) {
    var panel = showExtension(id);
    if (id === 'live-ads') return renderAds(panel);
    if (id === 'mailer-intelligence') return renderMailer(panel);
    if (id === 'landing-intelligence') return renderLanding(panel);
    if (id === 'action-outcomes') return renderActions(panel);
    if (id === 'alert-settings') return renderAlerts(panel);
    var r = REVIEW_TABS.find(function (x) { return x.id === id; });
    if (r) return renderReview(panel, r);
  }

  function adsControls() {
    // Default to ALL available history so no year is hidden. The floor predates
    // all ad data (earliest live rows are 2024), Until is today. The previous
    // 30-day default hid everything older than the last month. Narrow via the
    // date pickers as needed.
    var until = isoDate(new Date()), since = '2020-01-01';
    return '<div class="xcontrols">' +
      '<label class="xfield">Level<select id="xAdsLevel"><option value="account">Account</option><option value="campaign">Campaign</option><option value="adgroup">Ad group / ad set</option><option value="ad" selected>Ad</option></select></label>' +
      '<label class="xfield">Since<input id="xAdsSince" type="date" value="' + since + '"></label>' +
      '<label class="xfield">Until<input id="xAdsUntil" type="date" value="' + until + '"></label>' +
      '<button class="xbtn" id="xAdsRefresh">Refresh now</button></div>';
  }
  async function renderAds(panel) {
    panel.innerHTML = panelTitle('Live Ads Intelligence', 'Ad-level through account-level reporting across Meta, Google and TikTok. The view fetches each platform on request, disables browser caching and refreshes every 60 seconds; source-platform processing and attribution latency still apply.', adsControls()) + '<div id="xAdsBody">' + loader('Loading ads') + '</div>';
    var refresh = document.getElementById('xAdsRefresh');
    async function load() {
      if (state.tab !== 'live-ads') return;
      var body = document.getElementById('xAdsBody'); if (!body) return;
      refresh.disabled = true; refresh.textContent = 'Refreshing…';
      try {
        var data = await getJson('ads', { market: currentMarket(), level: document.getElementById('xAdsLevel').value, since: document.getElementById('xAdsSince').value, until: document.getElementById('xAdsUntil').value });
        state.lastPayload.ads = data;
        var k = data.kpis || {};
        var platforms = (data.platforms || []).map(function (p) {
          return '<div class="xplatform"><span><b>' + esc(String(p.platform || '').toUpperCase()) + '</b><br><small>' + esc(p.rows.length + ' source rows' + (p.fetched_at ? ' · ' + dateTime(p.fetched_at) : '')) + '</small></span>' + boolBadge(p.connected && p.ok, 'Live', p.connected ? 'Error' : 'Connect') + '</div>' + (p.error ? '<div class="xnotice bad">' + esc(p.error) + '</div>' : '') + (!p.connected && p.need_env && p.need_env.length ? '<div class="xnotice">Required configuration: ' + esc(p.need_env.join(', ')) + '</div>' : '');
        }).join('');
        var rows = (data.rows || []).map(function (r) { return [r.platform, r.entity, r.campaign || '—', r.ad_group || '—', r.status || '—', money(r.spend), fmt(r.impressions), fmt(r.clicks), percent(r.ctr, 2), money(r.cpc), fmt(r.conversions, 2), money(r.cpa), money(r.revenue), ratio(r.roas)]; });
        body.innerHTML = kpis([
          { label: 'Spend', value: money(k.spend) }, { label: 'Revenue', value: money(k.revenue) }, { label: 'ROAS', value: ratio(k.roas) },
          { label: 'Impressions', value: fmt(k.impressions) }, { label: 'Clicks', value: fmt(k.clicks) }, { label: 'CTR', value: percent(k.ctr, 2) },
          { label: 'Conversions', value: fmt(k.conversions, 2) }, { label: 'CPA', value: money(k.cpa) }, { label: 'CVR', value: percent(k.conversion_rate, 2) },
        ]) + '<div class="xgrid"><div class="xcard span4"><h3>Connector status</h3><p>Only connected providers contribute figures.</p>' + platforms + '</div><div class="xcard span8"><h3>Reporting contract</h3><p>' + esc(data.freshness || '') + '</p>' + note(data.note || '', data.pending_platforms && data.pending_platforms.length ? '' : 'good') + '<div class="xmeta"><span>Market: <b>' + esc(data.market) + '</b></span><span>Level: <b>' + esc(data.level) + '</b></span><span>Window: <b>' + esc(data.window && data.window.since) + ' → ' + esc(data.window && data.window.until) + '</b></span><span>Generated: <b>' + esc(dateTime(data.generated_at)) + '</b></span></div></div></div>' +
          '<div class="xcard span12"><h3>Ads ranked by spend</h3><p>Campaign, ad-group/ad-set and ad identifiers are retained where each platform returns them.</p>' + table(['Platform','Entity','Campaign','Ad group / set','Status','Spend','Impressions','Clicks','CTR','CPC','Conversions','CPA','Revenue','ROAS'], rows, { limit: 250 }) + '</div>';
      } catch (e) { body.innerHTML = failure('Live Ads Intelligence', e); }
      finally { refresh.disabled = false; refresh.textContent = 'Refresh now'; }
    }
    refresh.addEventListener('click', load);
    document.getElementById('xAdsLevel').addEventListener('change', load);
    await load();
    state.adsTimer = setInterval(load, REFRESH_MS);
  }

  function mailerControls() {
    return '<div class="xcontrols"><label class="xfield">Window<select id="xMailerHours"><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option><option value="720" selected>30 days</option></select></label><button class="xbtn" id="xMailerRefresh">Refresh now</button></div>';
  }
  async function renderMailer(panel) {
    panel.innerHTML = panelTitle('Mailer Intelligence', 'Unified Klaviyo and WebEngage reporting: event mix, campaign engagement, audience coverage, conversions, attributed revenue and negative signals.', mailerControls()) + '<div id="xMailerBody">' + loader('Loading mailer data') + '</div>';
    var btn = document.getElementById('xMailerRefresh');
    async function load() {
      if (state.tab !== 'mailer-intelligence') return;
      btn.disabled = true; btn.textContent = 'Refreshing…';
      var body = document.getElementById('xMailerBody');
      try {
        var d = await getJson('mailer', { market: currentMarket(), hours: document.getElementById('xMailerHours').value });
        state.lastPayload.mailer = d; var k = d.kpis || {}, s = d.sources || {};
        var klOn = !!(s.klaviyo && s.klaviyo.connected), weOn = !!(s.webengage && s.webengage.connected);
        var connectBanner = (!klOn && !weOn)
          ? '<div class="xcard span12" style="border-left:4px solid var(--lava,#6A33D8)"><h3>No mailer source connected</h3><p>Klaviyo and WebEngage are not connected, so every figure below is zero (nothing is estimated). To populate this tab with real data, set <code>KLAVIYO_API_KEY</code> (and the WebEngage export vars) in Vercel, then refresh. Read only, never written back.</p></div>'
          : '';
        var campaigns = (d.campaigns || []).map(function (c) { return [c.source, c.campaign, c.status || '—', dateTime(c.sent_at), c.events == null ? '—' : fmt(c.events), c.opens == null ? '—' : fmt(c.opens), c.clicks == null ? '—' : fmt(c.clicks), c.conversions == null ? '—' : fmt(c.conversions), c.revenue == null ? '—' : money(c.revenue)]; });
        var segments = (d.segments || []).map(function (x) { return [x.name || x.id, fmt(x.profile_count), dateTime(x.synced_at || x.klaviyo_updated)]; });
        var mix = (d.event_mix || []).map(function (x) { return [x.event, fmt(x.count)]; });
        body.innerHTML = connectBanner + kpis([
          { label: 'Delivered', value: fmt(k.delivered) }, { label: 'Open rate', value: percent(k.open_rate, 2) }, { label: 'Click rate', value: percent(k.click_rate, 2) },
          { label: 'Click-to-open', value: percent(k.ctor, 2) }, { label: 'Conversions', value: fmt(k.conversions) }, { label: 'Mailer revenue', value: money(k.revenue) },
          { label: 'Revenue / recipient', value: money(k.revenue_per_recipient) }, { label: 'Unsubscribe rate', value: percent(k.unsubscribe_rate, 3) }, { label: 'Bounce rate', value: percent(k.bounce_rate, 3) },
          { label: 'Known campaigns', value: fmt(k.known_campaigns) }, { label: 'Known segments', value: fmt(k.known_segments) }, { label: 'Segment profiles', value: fmt(k.segment_profiles) },
        ]) + '<div class="xgrid"><div class="xcard"><h3>Source health</h3><div class="xplatform"><span><b>Klaviyo</b><br><small>' + esc((s.klaviyo && s.klaviyo.live_events || 0) + ' live events · ' + (s.klaviyo && s.klaviyo.mirrored_campaigns || 0) + ' mirrored campaigns') + '</small></span>' + boolBadge(s.klaviyo && s.klaviyo.connected) + '</div><div class="xplatform"><span><b>WebEngage</b><br><small>' + esc((s.webengage && s.webengage.events || 0) + ' events in window') + '</small></span>' + boolBadge(s.webengage && s.webengage.connected) + '</div>' + note(d.note || '') + '</div><div class="xcard"><h3>Event mix</h3>' + table(['Event','Count'], mix, { limit: 30 }) + '</div></div>' +
          '<div class="xcard span12"><h3>Campaign ledger</h3><p>Unavailable fields remain blank rather than inferred.</p>' + table(['Source','Campaign','Status','Sent','Events','Opens','Clicks','Conversions','Revenue'], campaigns, { limit: 150 }) + '</div>' +
          '<div class="xcard span12"><h3>Klaviyo audiences / segments</h3>' + table(['Segment','Profiles','Last synced'], segments, { limit: 100 }) + '</div>';
      } catch (e) { body.innerHTML = failure('Mailer Intelligence', e); }
      finally { btn.disabled = false; btn.textContent = 'Refresh now'; }
    }
    btn.addEventListener('click', load); document.getElementById('xMailerHours').addEventListener('change', load); await load();
  }

  async function renderLanding(panel) {
    panel.innerHTML = panelTitle('Landing Pages & Experiments', 'PageDeck own-page analytics, A/B-test results and competitor landing-page benchmarks. Data is read only from configured PageDeck exports or sanctioned Supabase mirrors; undocumented endpoints are never guessed.', '<div class="xcontrols"><button class="xbtn" id="xLandingRefresh">Refresh now</button></div>') + '<div id="xLandingBody">' + loader('Loading landing-page data') + '</div>';
    var btn = document.getElementById('xLandingRefresh');
    async function load() {
      if (state.tab !== 'landing-intelligence') return;
      btn.disabled = true; btn.textContent = 'Refreshing…'; var body = document.getElementById('xLandingBody');
      try {
        var d = await getJson('landing', { market: currentMarket() }); state.lastPayload.landing = d; var k = d.kpis || {};
        var pages = (d.pages || []).map(function (p) { return [p.name, p.status || '—', fmt(p.visitors), fmt(p.page_views), fmt(p.external_clicks), percent(p.ctr, 2), fmt(p.conversions), percent(p.conversion_rate, 2), money(p.revenue), money(p.aov), p.avg_view_duration ? fmt(p.avg_view_duration, 1) + 's' : '—', p.load_ms ? fmt(p.load_ms) + 'ms' : '—']; });
        var experiments = (d.experiments || []).map(function (e) { var variants = (e.variants || []).map(function (v) { return v.name + ': ' + fmt(v.visitors) + ' visitors / ' + percent(v.conversion_rate, 2); }).join(' · '); return [e.name, e.status, variants, e.winner || '—', e.lift == null ? '—' : percent(e.lift, 1), e.confidence ? percent(e.confidence, 1) : '—', e.significant ? 'Yes' : 'No', e.sample_ratio_mismatch ? 'FLAG' : 'No', money(e.revenue_impact)]; });
        var competitors = (d.competitors || []).map(function (c) { return [c.brand, c.page, c.page_type || '—', c.offer || '—', fmt(c.active_days), fmt(c.linked_ads), c.estimated_spend == null ? '—' : money(c.estimated_spend), c.conversion_rate == null ? '—' : percent(c.conversion_rate, 2), c.source || '—']; });
        var av = d.availability || {};
        body.innerHTML = kpis([
          { label: 'Pages tracked', value: fmt(k.pages) }, { label: 'Visitors', value: fmt(k.visitors) }, { label: 'Page views', value: fmt(k.page_views) },
          { label: 'LP CTR', value: percent(k.ctr, 2) }, { label: 'Conversions', value: fmt(k.conversions) }, { label: 'LP conversion rate', value: percent(k.conversion_rate, 2) },
          { label: 'Revenue', value: money(k.revenue) }, { label: 'Revenue / visitor', value: money(k.revenue_per_visitor) }, { label: 'AOV', value: money(k.aov) },
          { label: 'Live experiments', value: fmt(k.live_experiments) }, { label: 'Significant winners', value: fmt(k.significant_winners) }, { label: 'SRM flags', value: fmt(k.srm_flags) },
          { label: 'Competitor pages', value: fmt(k.competitor_pages) }, { label: 'Competitor brands', value: fmt(k.competitor_brands) },
        ]) + '<div class="xgrid"><div class="xcard span12"><h3>Connector & data coverage</h3><div class="xmeta">' + boolBadge(d.connector && d.connector.connected) + '<span>Sources: <b>' + esc((d.connector && d.connector.sources || []).join(' · ')) + '</b></span></div>' + note(d.connector && d.connector.note || '') + '<div class="xmetric-list"><div class="xmetric"><b>Own pages</b><br>' + esc((av.pages && av.pages.rows || 0) + ' rows') + '</div><div class="xmetric"><b>Experiments</b><br>' + esc((av.experiments && av.experiments.rows || 0) + ' rows') + '</div><div class="xmetric"><b>Competitors</b><br>' + esc((av.competitors && av.competitors.rows || 0) + ' rows') + '</div></div></div></div>' +
          '<div class="xcard span12"><h3>KNICKGASM landing-page performance</h3>' + table(['Page','Status','Visitors','Views','Clicks','CTR','Conversions','CVR','Revenue','AOV','Avg view','Load'], pages, { limit: 200 }) + '</div>' +
          '<div class="xcard span12"><h3>A/B experiments & result quality</h3><p>Includes lift, confidence, winner status, revenue impact and sample-ratio mismatch checks.</p>' + table(['Experiment','Status','Variants','Winner','Lift','Confidence','Significant','SRM','Revenue impact'], experiments, { limit: 150 }) + '</div>' +
          '<div class="xcard span12"><h3>Competitor landing-page benchmark</h3><p>Competitor numbers appear only where the authorised export provides them; unavailable estimates are left blank.</p>' + table(['Brand','Page','Type','Offer','Active days','Linked ads','Est. spend','CVR','Source'], competitors, { limit: 250 }) + '</div>';
      } catch (e) { body.innerHTML = failure('Landing Pages & Experiments', e); }
      finally { btn.disabled = false; btn.textContent = 'Refresh now'; }
    }
    btn.addEventListener('click', load); await load();
  }

  async function renderActions(panel) {
    panel.innerHTML = panelTitle('Actions & Outcomes', 'Evaluation of every Lifecycle OS action: execution, launch speed, measured lift, realised value, experimentation, guardrails, rollback and connector reliability.', '<div class="xcontrols"><button class="xbtn" id="xActionsRefresh">Refresh now</button></div>') + '<div id="xActionsBody">' + loader('Loading action outcomes') + '</div>';
    var btn = document.getElementById('xActionsRefresh');
    async function load() {
      if (state.tab !== 'action-outcomes') return;
      btn.disabled = true; btn.textContent = 'Refreshing…'; var body = document.getElementById('xActionsBody');
      try {
        var d = await getJson('actions'); state.lastPayload.actions = d; var k = d.kpis || {};
        var rows = (d.actions || []).map(function (a) { return [a.action_type || '—', a.action_id || a.id || '—', a.channel || '—', a.status || '—', dateTime(a.recommended_at), dateTime(a.launched_at), a.baseline_value == null ? '—' : fmt(a.baseline_value, 2), a.observed_value == null ? '—' : fmt(a.observed_value, 2), a.incremental_revenue == null ? '—' : money(a.incremental_revenue), a.roi == null ? '—' : ratio(a.roi), a.guardrail_breach ? 'BREACH' : '—', a.rolled_back ? 'Yes' : 'No']; });
        var runs = (d.connector_runs || []).map(function (r) { return [r.connector_id, r.trigger || '—', r.status, fmt(r.records_synced), dateTime(r.started_at), r.message || '—']; });
        var activity = (d.recent_activity || []).map(function (a) { return [dateTime(a.created_at), a.actor || 'system', a.action || '—', a.entity_type || '—', a.status || '—', a.summary || '—']; });
        body.innerHTML = kpis([
          { label: 'Actions tracked', value: fmt(k.actions_tracked) }, { label: 'Completed actions', value: fmt(k.completed_actions) }, { label: 'Completion rate', value: percent(k.completion_rate, 1) },
          { label: 'Failed / rolled back', value: fmt(k.failed_or_rolled_back) }, { label: 'Execution error rate', value: percent(k.error_rate, 1) }, { label: 'Median time to launch', value: fmt(k.median_time_to_launch_hours, 1) + 'h' },
          { label: 'Measured actions', value: fmt(k.measured_actions) }, { label: 'Incremental revenue', value: money(k.realized_incremental_revenue) }, { label: 'Realised ROI', value: ratio(k.realized_roi) },
          { label: 'Guardrail breaches', value: fmt(k.guardrail_breaches) }, { label: 'Rollback rate', value: percent(k.rollback_rate, 1) }, { label: 'Experiment win rate', value: percent(k.experiment_win_rate, 1) },
          { label: 'Pending reviews', value: fmt(k.pending_reviews) },
        ]) + note(d.note || '') + '<div class="xcard span12"><h3>Action outcome ledger</h3><p>Populate analytics_action_outcomes for recommendation-to-impact measurement; until then, activity records are shown without fabricated outcomes.</p>' + table(['Action','ID','Channel','Status','Recommended','Launched','Baseline','Observed','Incremental revenue','ROI','Guardrail','Rolled back'], rows, { limit: 250 }) + '</div>' +
          '<div class="xgrid"><div class="xcard"><h3>Connector runs</h3>' + table(['Connector','Trigger','Status','Records','Started','Message'], runs, { limit: 100 }) + '</div><div class="xcard"><h3>Recent system activity</h3>' + table(['Time','Actor','Action','Entity','Status','Summary'], activity, { limit: 100 }) + '</div></div>';
      } catch (e) { body.innerHTML = failure('Actions & Outcomes', e); }
      finally { btn.disabled = false; btn.textContent = 'Refresh now'; }
    }
    btn.addEventListener('click', load); await load();
  }

  function inputField(label, id, value, type, step) {
    return '<label class="xfield">' + esc(label) + '<input class="xinput" id="' + esc(id) + '" type="' + esc(type || 'number') + '" value="' + esc(value) + '"' + (step ? ' step="' + esc(step) + '"' : '') + '></label>';
  }
  function splitList(v) { return Array.isArray(v) ? v.join(', ') : String(v || ''); }
  async function renderAlerts(panel) {
    panel.innerHTML = panelTitle('Alert Settings', 'Configure hourly analysis, anomaly thresholds and delivery by Gmail, Google Chat and SMS. Live connectors are OFF by default — set LIVE_CONNECTORS=on to send for real. The sender identity is env-driven (ALERT_EMAIL); no mailbox is hardcoded.', '<div class="xcontrols"><button class="xbtn secondary" id="xAlertTest">Send test</button><button class="xbtn" id="xAlertSave">Save settings</button></div>') + '<div id="xAlertsBody">' + loader('Loading alert settings') + '</div>';
    try {
      var d = await getJson('alerts'), s = d.settings || {}, st = d.status || {}, c = st.connectors || {}, t = s.thresholds || {}, q = s.quiet_hours || {};
      var body = document.getElementById('xAlertsBody');
      body.innerHTML = '<div class="xgrid"><div class="xcard"><h3>Schedule & channels</h3>' +
        '<div class="xform-row"><span>Hourly data analysis enabled</span><label class="xswitch"><input type="checkbox" id="xEnabled" ' + (s.enabled ? 'checked' : '') + '>Enabled</label></div>' +
        '<div class="xform-row"><span>Gmail</span><label class="xswitch"><input type="checkbox" id="xGmail" ' + (s.channels && s.channels.gmail ? 'checked' : '') + '>Use channel</label></div>' +
        '<div class="xform-row"><span>Google Chat</span><label class="xswitch"><input type="checkbox" id="xChat" ' + (s.channels && s.channels.google_chat ? 'checked' : '') + '>Use channel</label></div>' +
        '<div class="xform-row"><span>SMS / message</span><label class="xswitch"><input type="checkbox" id="xSms" ' + (s.channels && s.channels.sms ? 'checked' : '') + '>Use channel</label></div>' +
        '<div class="xform-grid" style="margin-top:12px"><label class="xfield">Analysis cadence<select id="xCadence"><option value="1">Every hour</option><option value="2">Every 2 hours</option><option value="4">Every 4 hours</option><option value="6">Every 6 hours</option><option value="12">Every 12 hours</option><option value="24">Daily</option></select></label>' + inputField('Cooldown (minutes)', 'xCooldown', s.cooldown_minutes || 180, 'number', '1') + '</div></div>' +
        '<div class="xcard"><h3>Delivery identity & recipients</h3><div class="xform-grid"><label class="xfield">From email<input class="xinput" value="' + esc((s.sender_email) || '') + '" placeholder="(unset — set ALERT_EMAIL env)" disabled></label><label class="xfield">Email recipients<input class="xinput" id="xEmailRecipients" value="' + esc(splitList(s.recipients && s.recipients.email)) + '"></label><label class="xfield">SMS recipients<input class="xinput" id="xSmsRecipients" placeholder="+91…" value="' + esc(splitList(s.recipients && s.recipients.sms)) + '"></label><label class="xfield">Quiet-hours timezone<input class="xinput" id="xTimezone" value="' + esc(q.timezone || 'Asia/Kolkata') + '"></label></div><div class="xform-row"><span>Quiet hours</span><label class="xswitch"><input type="checkbox" id="xQuiet" ' + (q.enabled ? 'checked' : '') + '>Enabled</label></div><div class="xform-grid">' + inputField('Start hour', 'xQuietStart', q.start_hour == null ? 22 : q.start_hour, 'number', '1') + inputField('End hour', 'xQuietEnd', q.end_hour == null ? 7 : q.end_hour, 'number', '1') + '</div><div class="xform-row"><span>Critical alerts bypass quiet hours</span><label class="xswitch"><input type="checkbox" id="xCriticalBypass" ' + (q.critical_bypass ? 'checked' : '') + '>Bypass</label></div></div></div>' +
        '<div class="xcard span12"><h3>Anomaly thresholds</h3><div class="xform-grid">' +
        inputField('Minimum ad ROAS', 'xAdRoas', t.ad_roas_min, 'number', '.1') + inputField('Ad CTR drop fraction', 'xAdCtrDrop', t.ad_ctr_drop_pct, 'number', '.01') +
        inputField('Ad spend spike fraction', 'xSpendSpike', t.ad_spend_spike_pct, 'number', '.01') + inputField('Spend with no conversion ($)', 'xNoConvSpend', t.ad_spend_no_conversion, 'number', '1') +
        inputField('Minimum mailer open rate', 'xOpenMin', t.mailer_open_rate_min, 'number', '.001') + inputField('Minimum mailer click rate', 'xClickMin', t.mailer_click_rate_min, 'number', '.001') +
        inputField('Maximum unsubscribe rate', 'xUnsubMax', t.mailer_unsubscribe_rate_max, 'number', '.0001') + inputField('Minimum LP conversion rate', 'xLpMin', t.landing_conversion_rate_min, 'number', '.001') +
        inputField('Maximum action error rate', 'xActionError', t.action_error_rate_max, 'number', '.001') + inputField('Connector stale after hours', 'xStale', t.connector_stale_hours, 'number', '.5') + '</div></div>' +
        '<div class="xcard span12"><h3>Channel readiness</h3><div class="xmetric-list"><div class="xmetric"><b>Gmail</b><br>' + boolBadge(c.gmail && c.gmail.connected) + '<br><small>Sender: ' + esc((c.gmail && c.gmail.sender) || s.sender_email || '(unset)') + '</small></div><div class="xmetric"><b>Google Chat</b><br>' + boolBadge(c.google_chat && c.google_chat.connected) + '</div><div class="xmetric"><b>SMS</b><br>' + boolBadge(c.sms && c.sms.connected) + '</div><div class="xmetric"><b>PageDeck</b><br>' + boolBadge(c.pagedeck && c.pagedeck.connected) + '</div><div class="xmetric"><b>Klaviyo</b><br>' + boolBadge(c.klaviyo && c.klaviyo.connected) + '</div><div class="xmetric"><b>WebEngage</b><br>' + boolBadge(c.webengage && c.webengage.connected) + '</div></div>' + note(st.last_run ? ('Last hourly analysis: ' + dateTime(st.last_run.started_at) + ' · ' + (st.last_run.anomalies == null ? 'anomaly count unavailable' : st.last_run.anomalies + ' anomalies')) : 'No persisted hourly analysis run is available yet.') + '<div id="xAlertStatus" class="xstatus"></div></div>';
      document.getElementById('xCadence').value = String(s.cadence_hours || 1);
      function collect() {
        function n(id) { return Number(document.getElementById(id).value); }
        return { settings: {
          enabled: document.getElementById('xEnabled').checked,
          cadence_hours: n('xCadence'), cooldown_minutes: n('xCooldown'),
          channels: { gmail: document.getElementById('xGmail').checked, google_chat: document.getElementById('xChat').checked, sms: document.getElementById('xSms').checked },
          recipients: { email: document.getElementById('xEmailRecipients').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean), sms: document.getElementById('xSmsRecipients').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) },
          quiet_hours: { enabled: document.getElementById('xQuiet').checked, timezone: document.getElementById('xTimezone').value, start_hour: n('xQuietStart'), end_hour: n('xQuietEnd'), critical_bypass: document.getElementById('xCriticalBypass').checked },
          thresholds: { ad_roas_min: n('xAdRoas'), ad_ctr_drop_pct: n('xAdCtrDrop'), ad_spend_spike_pct: n('xSpendSpike'), ad_spend_no_conversion: n('xNoConvSpend'), mailer_open_rate_min: n('xOpenMin'), mailer_click_rate_min: n('xClickMin'), mailer_unsubscribe_rate_max: n('xUnsubMax'), landing_conversion_rate_min: n('xLpMin'), action_error_rate_max: n('xActionError'), connector_stale_hours: n('xStale') },
        } };
      }
      document.getElementById('xAlertSave').addEventListener('click', async function () {
        var b = this; b.disabled = true; statusLine('xAlertStatus', 'Saving…');
        try { var r = await postJson('save-alert-settings', collect()); statusLine('xAlertStatus', r.note || 'Alert settings saved.', 'good'); }
        catch (e) { statusLine('xAlertStatus', e.message, 'bad'); } finally { b.disabled = false; }
      });
      document.getElementById('xAlertTest').addEventListener('click', async function () {
        var b = this; b.disabled = true; statusLine('xAlertStatus', 'Sending delivery test…');
        try { var r = await postJson('test-alert', collect()); var result = r.result || r; statusLine('xAlertStatus', result.sent_any ? 'Test sent through at least one configured channel.' : 'No channel sent. Review connection status and the delivery result.', result.sent_any ? 'good' : 'bad'); }
        catch (e) { statusLine('xAlertStatus', e.message, 'bad'); } finally { b.disabled = false; }
      });
    } catch (e) { document.getElementById('xAlertsBody').innerHTML = failure('Alert Settings', e); }
  }

  function styleReviewFrame(frame, index) {
    try {
      var w = frame.contentWindow, d = frame.contentDocument;
      if (!d || !w) return;
      var style = d.getElementById('embedded-business-review-css') || d.createElement('style');
      style.id = 'embedded-business-review-css';
      style.textContent = '.topbar,.gtbar,footer{display:none!important}body{background:#FFFFFF!important}.tab{display:none!important}.tab.active{display:block!important}main{max-width:none!important;padding:18px 14px 50px!important}.modal{z-index:9999!important}.histpage{z-index:9999!important}';
      if (!style.parentNode) d.head.appendChild(style);
      if (typeof w.show === 'function') w.show(index);
      state.reviewReady = true;
      function resize() {
        try {
          var main = d.getElementById('main');
          var h = Math.max(760, (main && main.scrollHeight || 0) + 55, d.body.scrollHeight, d.documentElement.scrollHeight);
          frame.style.height = Math.min(h, 30000) + 'px';
        } catch (_) {}
      }
      resize(); setTimeout(resize, 150); setTimeout(resize, 650); setTimeout(resize, 1800);
      if (w.ResizeObserver) { var ro = new w.ResizeObserver(resize); ro.observe(d.body); }
    } catch (_) {}
  }
  function renderReview(panel, tab) {
    state.reviewIndex = tab.index;
    var market = currentMarket();
    panel.innerHTML = panelTitle(tab.label, 'Business Review data is now embedded as a Data Analysis tab instead of a separate feature.') +
      (market !== 'US' ? note('This retained deep-dive source is the verified US D2C Business Review. The native Data Analysis tabs and live connector tabs above remain market-aware for ' + market + '.', '') : '') +
      '<div class="xreview-note">' + note('All original Business Review charts, calculations, source notes and drill-downs remain available below. The old standalone route is retained only as a compatibility alias.', 'good') + '</div>' +
      '<iframe class="xreview-frame" id="xReviewFrame" title="Embedded KNICKGASM D2C Business Review" src="/knickgasm-usa-d2c-dashboard.html"></iframe>';
    var frame = document.getElementById('xReviewFrame'); state.reviewFrame = frame; state.reviewReady = false;
    frame.addEventListener('load', function () { styleReviewFrame(frame, state.reviewIndex); });
  }

  function applyInitialTab() {
    var requested = '';
    try { requested = new URL(parent.location.href).searchParams.get('tab') || ''; } catch (_) {}
    var ext = LIVE_TABS.concat(REVIEW_TABS).some(function (t) { return t.id === requested; });
    if (ext) return openTab(requested);
    if (requested && ['control', 'acq', 'ret', 'cohort'].indexOf(requested) >= 0) {
      var b = document.querySelector('#anTabs button[data-tab="' + requested + '"]'); if (b) b.click();
    }
  }

  function boot() {
    if (!document.getElementById('anTabs') || !document.getElementById('dash')) return setTimeout(boot, 80);
    injectCss(); installPanel(); removeSeparateReviewEntry(); addTabs();
    document.querySelectorAll('#mktToggle button').forEach(function (b) {
      b.addEventListener('click', function () { setTimeout(function () { if (state.tab) openTab(state.tab); }, 10); });
    });
    applyInitialTab();
  }
  boot();
})();
