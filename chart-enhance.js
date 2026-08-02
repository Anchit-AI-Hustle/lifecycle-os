/* eslint-env browser */
/**
 * chart-enhance.js — universal chart upgrade layer.
 *
 * For every <div data-chart-host data-chart-title="…" data-chart-id="…">
 * placed in the page, this script:
 *   1. Renders an "Expand" icon button in the top-right of the host.
 *   2. Renders a "Chart / Table" toggle next to it.
 *   3. On click, opens a full-screen modal with:
 *        - the same chart re-rendered at 2x height
 *        - a "Chart view / Table view" toggle
 *        - 3 auto-generated insights (computed by a registered insight-fn)
 *        - a one-paragraph summary
 *        - a download CSV button
 *
 * To wire a chart up:
 *   1. Add data-chart-host, data-chart-title, data-chart-id to the
 *      container div that holds the existing ApexCharts canvas.
 *   2. Call ChartEnhance.register(chartId, {
 *        getData:    () => ({ rows: [...], columns: [...] }),  // for table view + CSV
 *        getInsights:() => [{ title, body }, ...],             // 3 insights
 *        getSummary: () => "one short paragraph",
 *        getApexConfig: () => apexConfigForExpandedRender,     // optional
 *      });
 *
 * The host's existing ApexChart instance keeps rendering normally;
 * we just decorate the host + drive an isolated 2x clone in the modal.
 */
(function () {
  'use strict';
  if (window.ChartEnhance) return;

  const registry = {};

  /* ─── Styles (injected once) ─────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('chart-enhance-styles')) return;
    const s = document.createElement('style');
    s.id = 'chart-enhance-styles';
    s.textContent = `
      .ce-tools {
        position: absolute; top: 8px; right: 8px; z-index: 5;
        display: inline-flex; gap: 4px; opacity: 0.55; transition: opacity .15s;
      }
      .ce-tools:hover, [data-chart-host]:hover .ce-tools { opacity: 1; }
      .ce-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 26px; height: 26px; border-radius: 6px;
        background: rgba(20,40,34,0.85); border: 1px solid rgba(171,135,67,0.25);
        color: #556059; cursor: pointer; transition: all .15s;
        font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 0;
      }
      .ce-btn:hover { color: #F7F5F2; border-color: #D0473E; background: rgba(20,40,34,0.95); }
      .ce-btn.active { background: #D0473E; color: #ffffff; border-color: #D0473E; }
      .ce-btn svg { width: 13px; height: 13px; }
      [data-chart-host] { position: relative; }
      [data-chart-host][data-ce-mode="table"] > :not(.ce-tools):not(.ce-table) { display: none !important; }

      .ce-table { width: 100%; max-height: 280px; overflow: auto; font-size: 11.5px; }
      .ce-table table { width: 100%; border-collapse: collapse; }
      .ce-table th { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #48524c; font-weight: 500; padding: 8px 6px; border-bottom: 1px solid rgba(171,135,67,0.15); background: #ffffff; position: sticky; top: 0; }
      .ce-table td { padding: 7px 6px; border-bottom: 1px solid rgba(171,135,67,0.05); color: #111111; }
      .ce-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
      .ce-table tr:hover td { background: rgba(171,135,67,0.04); }

      /* ─── Expand modal ─────────────────────────────────────────────── */
      #ce-modal-backdrop {
        position: fixed; inset: 0; z-index: 9500;
        background: rgba(0,0,0,0.78); backdrop-filter: blur(8px);
        display: none; align-items: center; justify-content: center;
        padding: 4vh 4vw; font-family: 'Inter', system-ui, sans-serif;
      }
      #ce-modal-backdrop.open { display: flex; }
      #ce-modal {
        background: #ffffff; border: 1px solid rgba(171,135,67,0.25);
        border-radius: 14px; box-shadow: 0 40px 100px rgba(0,0,0,0.7);
        width: 100%; max-width: 1200px; max-height: 92vh;
        display: flex; flex-direction: column; overflow: hidden;
      }
      #ce-modal-head {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 16px 22px; border-bottom: 1px solid rgba(171,135,67,0.18);
      }
      #ce-modal-head h2 {
        font-family: 'Lora','Inter',serif; font-size: 19px; color: #F7F5F2;
        font-weight: 600; letter-spacing: -0.01em; margin: 0;
      }
      #ce-modal-head h2 em { color: #D0473E; font-style: italic; }
      #ce-modal-head .right { display: inline-flex; gap: 6px; align-items: center; }
      #ce-modal-body {
        padding: 18px 22px; overflow: auto; display: grid; gap: 18px;
        grid-template-columns: 1fr; grid-template-rows: auto 1fr auto;
      }
      @media (min-width: 900px) {
        #ce-modal-body { grid-template-columns: 1.7fr 1fr; grid-template-rows: 1fr auto; }
        #ce-chart-zone { grid-row: 1 / 3; }
        #ce-insights   { grid-row: 1 / 2; }
        #ce-summary    { grid-row: 2 / 3; }
      }
      #ce-chart-zone {
        background: #ffffff; border: 1px solid rgba(171,135,67,0.12);
        border-radius: 10px; padding: 14px; min-height: 380px;
      }
      #ce-chart-canvas { min-height: 350px; }
      #ce-insights { display: flex; flex-direction: column; gap: 10px; }
      #ce-insights h3, #ce-summary h3 {
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em;
        color: #D0473E; font-weight: 700; margin: 0 0 6px;
      }
      .ce-insight {
        padding: 12px 14px; border-radius: 8px;
        background: #eef3f0; border: 1px solid rgba(171,135,67,0.18);
      }
      .ce-insight-title { font-size: 12.5px; font-weight: 600; color: #F7F5F2; margin: 0 0 4px; }
      .ce-insight-body  { font-size: 12px; line-height: 1.55; color: #556059; margin: 0; }
      #ce-summary {
        padding: 14px 16px; border-radius: 10px;
        background: rgba(171,135,67,0.06); border: 1px solid rgba(171,135,67,0.18);
        font-size: 12.5px; line-height: 1.6; color: #111111;
      }
      #ce-summary p { margin: 0; }
      .ce-modal-close {
        background: transparent; border: 1px solid rgba(171,135,67,0.25);
        color: #556059; cursor: pointer; padding: 6px 10px; border-radius: 6px;
        font-family: inherit; font-size: 11px; text-transform: uppercase;
        letter-spacing: 0.06em; font-weight: 600;
      }
      .ce-modal-close:hover { color: #F7F5F2; border-color: #D0473E; }

      /* mobile: stack everything vertically */
      @media (max-width: 700px) {
        #ce-modal { max-height: 100vh; border-radius: 0; }
        #ce-modal-body { padding: 12px 14px; }
        #ce-chart-zone { min-height: 280px; padding: 8px; }
      }
    `;
    document.head.appendChild(s);
  }

  /* ─── Public API ─────────────────────────────────────────────────── */
  const ChartEnhance = {
    register(id, opts) {
      registry[id] = opts || {};
      const host = document.querySelector(`[data-chart-id="${id}"]`);
      if (host && !host.dataset.ceWired) attachTools(host);
    },
    rerender() {
      document.querySelectorAll('[data-chart-host]:not([data-ce-wired])').forEach(attachTools);
    },
    // For programmatic open
    expand(id) { openModal(id); },
  };
  window.ChartEnhance = ChartEnhance;

  /* ─── Tool icons on each host ────────────────────────────────────── */
  function attachTools(host) {
    if (host.dataset.ceWired) return;
    host.dataset.ceWired = '1';

    const id = host.dataset.chartId;
    const tools = document.createElement('div');
    tools.className = 'ce-tools';
    tools.innerHTML = `
      <button class="ce-btn ce-view-chart active" data-view="chart" title="Chart view">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>
      </button>
      <button class="ce-btn ce-view-table" data-view="table" title="Table view">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
      </button>
      <button class="ce-btn ce-expand" title="Expand · insights · summary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      </button>
    `;
    host.appendChild(tools);

    tools.querySelector('.ce-view-chart').onclick = () => setMode(host, 'chart');
    tools.querySelector('.ce-view-table').onclick = () => setMode(host, 'table');
    tools.querySelector('.ce-expand').onclick = () => openModal(id);
  }

  function setMode(host, mode) {
    const id = host.dataset.chartId;
    host.dataset.ceMode = mode;
    host.querySelectorAll('.ce-btn[data-view]').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === mode),
    );
    if (mode === 'table') {
      if (!host.querySelector('.ce-table')) {
        const t = document.createElement('div');
        t.className = 'ce-table';
        t.innerHTML = buildTableHtml(id);
        host.appendChild(t);
      }
    } else {
      const t = host.querySelector('.ce-table');
      if (t) t.remove();
    }
  }

  function buildTableHtml(id) {
    const def = registry[id] || autoExtract(id);
    if (!def?.getData) return '<div style="color:#48524c;padding:14px">No data registered for this chart.</div>';
    const { rows = [], columns = [] } = def.getData() || {};
    if (!rows.length) return '<div style="color:#48524c;padding:14px">No rows yet.</div>';
    const head = columns.map((c) => `<th class="${c.num ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('');
    const body = rows.slice(0, 250).map((r) =>
      '<tr>' + columns.map((c) => `<td class="${c.num ? 'num' : ''}">${formatCell(r[c.key], c)}</td>`).join('') + '</tr>',
    ).join('');
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
      + (rows.length > 250 ? `<div style="padding:8px;color:#48524c;font-size:10px">+ ${rows.length - 250} more rows (export to see all)</div>` : '');
  }

  // ─── Auto-extract chart data from a global window.charts[key] ApexCharts instance ─
  // Falls back to introspecting the chart's own series + xaxis.categories so
  // every chart in the page gets a Table view + insights without per-chart
  // registration code.
  function autoExtract(id) {
    const charts = window.charts || {};
    const chart = charts[id] || charts[id.replace(/^chart/i, '')] || findByCanvas(id);
    if (!chart || !chart.w) return null;
    const cfg = chart.w.config || {};
    const series = cfg.series || [];
    const cats = cfg.xaxis?.categories || [];
    const isMultiSeries = Array.isArray(series) && series.length > 1 && series[0]?.data != null;
    const isPie = cfg.chart?.type && /^(pie|donut|radialBar)$/.test(cfg.chart.type);

    let rows, columns;
    if (isPie) {
      const labels = cfg.labels || [];
      rows = labels.map((label, i) => ({ label, value: series[i] }));
      columns = [
        { key: 'label', label: 'Label' },
        { key: 'value', label: 'Value', num: true, fmt: 'int' },
      ];
    } else if (isMultiSeries) {
      // Pivot: each cat is a row; each series is a column.
      rows = cats.map((cat, i) => {
        const r = { label: cat };
        series.forEach((s) => { r[s.name || 'series'] = (s.data || [])[i]; });
        return r;
      });
      columns = [{ key: 'label', label: cfg.xaxis?.title?.text || '—' }]
        .concat(series.map((s) => ({ key: s.name || 'series', label: s.name || 'series', num: true, fmt: 'int' })));
    } else if (series[0]?.data) {
      // Single series — could be xy pairs or category-aligned
      const data = series[0].data;
      if (Array.isArray(data) && typeof data[0] === 'object' && 'x' in data[0]) {
        rows = data.map((d) => ({ label: d.x, value: d.y, ...(d.z != null ? { size: d.z } : {}) }));
        columns = [
          { key: 'label', label: 'x' },
          { key: 'value', label: 'y', num: true, fmt: 'int' },
          ...(data[0].z != null ? [{ key: 'size', label: 'size', num: true, fmt: 'int' }] : []),
        ];
      } else {
        rows = cats.map((cat, i) => ({ label: cat, value: data[i] }));
        columns = [{ key: 'label', label: cfg.xaxis?.title?.text || '—' }, { key: 'value', label: series[0].name || 'value', num: true, fmt: 'int' }];
      }
    } else {
      return null;
    }
    return {
      getData: () => ({ rows, columns, primaryNumber: 'value' }),
      getApexConfig: () => JSON.parse(JSON.stringify(cfg)),
    };
  }

  function findByCanvas(id) {
    // Match by container DOM id — works even if window.charts uses a different key.
    const host = document.querySelector(`[data-chart-id="${id}"]`);
    if (!host) return null;
    const apex = host.querySelector('.apexcharts-canvas');
    if (!apex) return null;
    const charts = window.charts || {};
    for (const k of Object.keys(charts)) {
      try { if (charts[k]?.el === host || charts[k]?.w?.globals?.dom?.baseEl === apex) return charts[k]; } catch {}
    }
    return null;
  }

  function formatCell(v, col) {
    if (v == null || v === '') return '<span style="color:#48524c">—</span>';
    if (col.url && typeof v === 'object' && v.label && v.url) {
      return `<a href="${escapeAttr(v.url)}" target="_blank" rel="noopener" style="color:#D0473E;text-decoration:underline">${escapeHtml(v.label)} ↗</a>`;
    }
    if (col.fmt === 'currency') return '$' + Math.round(Number(v)).toLocaleString();
    if (col.fmt === 'pct')      return (Number(v) * 100).toFixed(1) + '%';
    if (col.fmt === 'int')      return Math.round(Number(v)).toLocaleString();
    return escapeHtml(String(v));
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }
  function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }

  /* ─── Expand modal ───────────────────────────────────────────────── */
  let modalEl, modalChart;
  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'ce-modal-backdrop';
    modalEl.innerHTML = `
      <div id="ce-modal" role="dialog" aria-modal="true">
        <div id="ce-modal-head">
          <h2 id="ce-modal-title"></h2>
          <div class="right">
            <button class="ce-btn ce-view-chart active" data-mview="chart" title="Chart view">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>
            </button>
            <button class="ce-btn ce-view-table" data-mview="table" title="Table view">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
            </button>
            <button class="ce-btn ce-download" title="Download CSV">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="ce-modal-close">Close</button>
          </div>
        </div>
        <div id="ce-modal-body">
          <div id="ce-chart-zone">
            <div id="ce-chart-canvas"></div>
            <div id="ce-table-canvas" style="display:none" class="ce-table"></div>
          </div>
          <div id="ce-insights">
            <h3>Key insights</h3>
            <div id="ce-insight-list"></div>
          </div>
          <div id="ce-summary">
            <h3>Summary</h3>
            <p id="ce-summary-text"></p>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
    modalEl.querySelector('.ce-modal-close').onclick = closeModal;
    modalEl.querySelector('.ce-view-chart').onclick = () => setModalMode('chart');
    modalEl.querySelector('.ce-view-table').onclick = () => setModalMode('table');
    modalEl.querySelector('.ce-download').onclick = () => downloadCsv(modalEl.dataset.activeId);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalEl.classList.contains('open')) closeModal(); });
    return modalEl;
  }

  function openModal(id) {
    const def = registry[id] || autoExtract(id);
    if (!def) return console.warn('[chart-enhance] no registration for', id);
    const host = document.querySelector(`[data-chart-id="${id}"]`);
    ensureModal();
    modalEl.dataset.activeId = id;

    document.getElementById('ce-modal-title').innerHTML =
      `<em>${escapeHtml(host?.dataset.chartTitle || 'Chart').split('·')[0].trim()}</em> · ${escapeHtml((host?.dataset.chartTitle || '').split('·').slice(1).join('·').trim() || 'detailed view')}`;

    // Insights
    const insights = (def.getInsights && def.getInsights()) || autoInsightsFromData(def);
    document.getElementById('ce-insight-list').innerHTML = insights.slice(0, 4).map((i) => `
      <div class="ce-insight">
        <h4 class="ce-insight-title">${escapeHtml(i.title)}</h4>
        <p class="ce-insight-body">${i.body}</p>
      </div>
    `).join('') || '<div style="color:#48524c;font-size:12px">No insights yet — feed more data.</div>';

    // Summary
    const summary = (def.getSummary && def.getSummary()) || autoSummaryFromData(def);
    document.getElementById('ce-summary-text').textContent = summary || 'No summary available.';

    setModalMode('chart');
    modalEl.classList.add('open');
  }

  function setModalMode(mode) {
    const id = modalEl.dataset.activeId;
    const def = registry[id];
    modalEl.querySelectorAll('.ce-btn[data-mview]').forEach((b) =>
      b.classList.toggle('active', b.dataset.mview === mode),
    );
    const canvas = document.getElementById('ce-chart-canvas');
    const tableC = document.getElementById('ce-table-canvas');
    if (mode === 'chart') {
      tableC.style.display = 'none';
      canvas.style.display = '';
      renderModalChart(id, def);
    } else {
      if (modalChart) { try { modalChart.destroy(); } catch {} modalChart = null; }
      canvas.style.display = 'none';
      tableC.style.display = '';
      tableC.innerHTML = buildTableHtml(id);
    }
  }

  function renderModalChart(id, def) {
    const canvas = document.getElementById('ce-chart-canvas');
    canvas.innerHTML = '';
    if (modalChart) { try { modalChart.destroy(); } catch {} modalChart = null; }
    const cfg = def.getApexConfig ? def.getApexConfig() : null;
    if (!cfg) {
      canvas.innerHTML = '<div style="color:#48524c;padding:20px;text-align:center">Chart preview not available for this view — switch to Table.</div>';
      return;
    }
    cfg.chart = Object.assign({}, cfg.chart || {}, { height: 460, background: 'transparent', foreColor: '#556059', toolbar: { show: true, tools: { download: true, selection: false, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } } });
    modalChart = new ApexCharts(canvas, cfg);
    modalChart.render();
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove('open');
    if (modalChart) { try { modalChart.destroy(); } catch {} modalChart = null; }
  }

  /* ─── CSV download ───────────────────────────────────────────────── */
  function downloadCsv(id) {
    const def = registry[id];
    if (!def?.getData) return;
    const { rows = [], columns = [] } = def.getData();
    const head = columns.map((c) => '"' + (c.label || c.key).replace(/"/g, '""') + '"').join(',');
    const lines = rows.map((r) => columns.map((c) => {
      const v = r[c.key];
      if (v == null) return '';
      if (typeof v === 'object' && v.label) return '"' + String(v.label).replace(/"/g, '""') + '"';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? '"' + s + '"' : s;
    }).join(','));
    const csv = [head, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${id}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  /* ─── Auto-insights from data ────────────────────────────────────── */
  function autoInsightsFromData(def) {
    const out = [];
    if (!def.getData) return out;
    const { rows = [], columns = [], primaryNumber } = def.getData() || {};
    if (!rows.length) return out;

    const numCol = primaryNumber || columns.find((c) => c.num)?.key;
    if (numCol) {
      const vals = rows.map((r) => Number(r[numCol]) || 0).filter((v) => !isNaN(v));
      if (vals.length) {
        const total = vals.reduce((s, v) => s + v, 0);
        const avg   = total / vals.length;
        const max   = Math.max(...vals);
        const min   = Math.min(...vals);
        const top   = [...rows].sort((a, b) => (Number(b[numCol]) || 0) - (Number(a[numCol]) || 0))[0];
        const labelCol = columns.find((c) => !c.num)?.key;
        out.push({
          title: 'Top performer',
          body: top && labelCol
            ? `<b>${escapeHtml(String(top[labelCol]))}</b> leads at <b>${fmt(max, columns.find((c)=>c.key===numCol))}</b>` + (avg ? ` — ${((max/avg).toFixed(1))}× the average.` : '.')
            : `Peak value: <b>${fmt(max, columns.find((c)=>c.key===numCol))}</b>`,
        });
        out.push({
          title: 'Distribution',
          body: `${rows.length} rows · average <b>${fmt(avg, columns.find((c)=>c.key===numCol))}</b> · range <b>${fmt(min)}</b> → <b>${fmt(max)}</b>.`,
        });
        if (max && min && max > min * 5) {
          out.push({
            title: 'Wide spread',
            body: `Top is ${(max/Math.max(min,0.0001)).toFixed(1)}× the bottom — investigate the long tail.`,
          });
        }
      }
    }
    return out;
  }
  function autoSummaryFromData(def) {
    const { rows = [] } = (def.getData && def.getData()) || {};
    if (!rows.length) return 'No data in window.';
    return `Rendering ${rows.length} rows. Switch to table view to explore raw numbers, or download CSV for offline analysis.`;
  }
  function fmt(v, col) {
    if (v == null || isNaN(v)) return '—';
    if (col?.fmt === 'currency') return '$' + Math.round(Number(v)).toLocaleString();
    if (col?.fmt === 'pct')      return (Number(v) * 100).toFixed(1) + '%';
    return Math.round(Number(v)).toLocaleString();
  }

  /* ─── Boot ───────────────────────────────────────────────────────── */
  function boot() {
    injectStyles();
    document.querySelectorAll('[data-chart-host]').forEach(attachTools);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
