/* eslint-env browser */
/**
 * table-sort.js — drop-in column sorting for any <table>.
 *
 * Usage in HTML:
 *   <table data-sortable>
 *     <thead><tr>
 *       <th>Name</th>
 *       <th data-sort="number">Revenue</th>
 *       <th data-sort="number">Open %</th>
 *       <th data-sort="date">Sent</th>
 *       <th data-no-sort>Actions</th>
 *     </tr></thead>
 *     <tbody> ... </tbody>
 *   </table>
 *
 * - Click a header to sort asc; click again to flip; click again to clear.
 * - Numeric / date / string / pct detection is automatic if you don't set data-sort.
 * - Works on dynamically re-rendered tables: just call window.attachTableSort()
 *   after re-rendering or rely on the MutationObserver auto-attach.
 *
 * Opt-in row filter: add data-filterable to a <table> and a search box is
 * inserted above it (above its .tbl-wrap scroll container when present) that
 * hides non-matching tbody rows as you type. Survives re-renders: when the
 * container persists across innerHTML swaps the existing box is rebound to
 * the new table and its current query re-applied.
 */
(function () {
  'use strict';

  if (window.attachTableSort) return;

  function parseCell(text, type) {
    if (type === 'number' || type === 'currency' || type === 'pct') {
      const n = parseFloat(String(text).replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? -Infinity : n;
    }
    if (type === 'date') {
      const t = Date.parse(text);
      return isNaN(t) ? -Infinity : t;
    }
    return String(text).trim().toLowerCase();
  }

  function detectType(values) {
    let numeric = 0, date = 0, total = 0;
    for (const v of values) {
      const s = String(v).trim();
      if (!s) continue;
      total++;
      if (/^[\-+]?[$£€₹]?[\d,]+(\.\d+)?(%|k|m|cr)?$/i.test(s.replace(/\s/g, ''))) numeric++;
      else if (!isNaN(Date.parse(s)) && /\d/.test(s)) date++;
    }
    if (numeric / Math.max(1, total) > 0.65) return 'number';
    if (date / Math.max(1, total) > 0.65) return 'date';
    return 'string';
  }

  function applySort(table, colIndex, type, direction) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll(':scope > tr'));
    if (!rows.length) return;
    rows.sort((a, b) => {
      const av = parseCell(a.cells[colIndex]?.dataset.sortValue ?? a.cells[colIndex]?.innerText ?? '', type);
      const bv = parseCell(b.cells[colIndex]?.dataset.sortValue ?? b.cells[colIndex]?.innerText ?? '', type);
      if (av < bv) return direction === 'asc' ? -1 : 1;
      if (av > bv) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    const frag = document.createDocumentFragment();
    rows.forEach((r) => frag.appendChild(r));
    tbody.appendChild(frag);
  }

  function injectStylesOnce() {
    if (document.getElementById('table-sort-styles')) return;
    const css = document.createElement('style');
    css.id = 'table-sort-styles';
    css.textContent = `
      th[data-sortable-col] {
        cursor: pointer; user-select: none; position: relative;
        transition: color .12s;
      }
      th[data-sortable-col]:hover { color: #FFFFFF; }
      /* Sort affordance is ALWAYS visible (both chevrons) so every column
         reads as sortable without hovering; the active column shows one solid
         arrow in lava. Opacity .72 keeps it legible on the green header. */
      th[data-sortable-col] .ts-arrow {
        display: inline-block; margin-left: 5px; opacity: 0.72;
        font-size: 0.8em; line-height: 1; transition: opacity .12s, color .12s;
        font-family: ui-monospace, 'JetBrains Mono', monospace;
      }
      th[data-sortable-col] .ts-arrow::before { content: '⇅'; }
      th[data-sortable-col]:hover .ts-arrow { opacity: 1; }
      th[data-sort-direction] .ts-arrow { opacity: 1; color: #F0D9A6; }
      th[data-sort-direction="asc"]  .ts-arrow::before { content: '▲'; }
      th[data-sort-direction="desc"] .ts-arrow::before { content: '▼'; }
      input.ts-filter {
        display: block; margin: 6px 0 6px; padding: 6px 10px;
        font: inherit; font-size: 12.5px; color: inherit;
        background: rgba(251,245,234,.55); border: 1px solid #CBB98C;
        border-radius: 8px; min-width: 220px; max-width: 340px;
      }
    `;
    document.head.appendChild(css);
  }

  // ── Opt-in per-table row filter (<table data-filterable>) ────────────────
  function attachTableFilter(root) {
    injectStylesOnce();
    const scope = root || document;
    const tables = scope.querySelectorAll('table[data-filterable]:not([data-filter-attached])');
    tables.forEach((table) => {
      table.dataset.filterAttached = '1';
      const host = table.closest('.tbl-wrap') || table;
      // Reuse a box left behind by a previous render of the same container
      // (hosts like a persistent .tbl-wrap div keep their siblings across
      // innerHTML swaps) — otherwise every re-render would stack a new input.
      let input = host.previousElementSibling && host.previousElementSibling.classList &&
        host.previousElementSibling.classList.contains('ts-filter') ? host.previousElementSibling : null;
      if (!input) {
        input = document.createElement('input');
        input.type = 'search';
        input.placeholder = 'Filter rows…';
        input.className = 'ts-filter';
        input.setAttribute('aria-label', 'Filter table rows');
        host.parentNode.insertBefore(input, host);
      }
      const apply = () => {
        const q = input.value.trim().toLowerCase();
        Array.from((table.tBodies[0] || {}).rows || []).forEach((r) => {
          r.style.display = !q || r.innerText.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
        });
      };
      input.oninput = apply; // rebind (not addEventListener) so re-renders never double-fire
      if (input.value) apply();
    });
  }

  // Sorting is now the DEFAULT for every real data table on every page: any
  // <table> with a <thead> and at least two body rows is made sortable unless
  // it opts out with data-no-sortable (layout/e-mail tables). data-sortable is
  // still honoured explicitly and forces attachment regardless of row count.
  function sortableTables(scope) {
    const out = [];
    scope.querySelectorAll('table:not([data-sort-attached])').forEach((t) => {
      if (t.hasAttribute('data-no-sortable')) return;
      if (t.hasAttribute('data-sortable')) { out.push(t); return; }
      const headCells = t.querySelectorAll('thead th');
      const bodyRows = t.tBodies[0] ? t.tBodies[0].rows.length : 0;
      if (headCells.length >= 2 && bodyRows >= 2) out.push(t);
    });
    return out;
  }

  function attachTableSort(root) {
    injectStylesOnce();
    const scope = root || document;
    const tables = sortableTables(scope);
    tables.forEach((table) => {
      table.dataset.sortAttached = '1';
      const headers = table.querySelectorAll('thead th');
      headers.forEach((th, i) => {
        if (th.hasAttribute('data-no-sort')) return;
        th.dataset.sortableCol = String(i);
        if (!th.querySelector('.ts-arrow')) {
          const arrow = document.createElement('span');
          arrow.className = 'ts-arrow';
          th.appendChild(arrow);
        }
        th.addEventListener('click', () => {
          const current = th.dataset.sortDirection;
          const next = current === 'asc' ? 'desc' : current === 'desc' ? null : 'asc';
          // Clear other headers
          headers.forEach((h) => { if (h !== th) delete h.dataset.sortDirection; });
          if (!next) { delete th.dataset.sortDirection; return; }
          th.dataset.sortDirection = next;
          // Detect type
          let type = th.dataset.sort;
          if (!type) {
            const sample = Array.from(table.tBodies[0]?.rows || []).slice(0, 20).map((r) => r.cells[i]?.innerText || '');
            type = detectType(sample);
          }
          applySort(table, i, type, next);
        });
      });
    });
  }

  // Re-attach when DOM updates (any dashboard re-render).
  const observer = new MutationObserver((mutations) => {
    let needsAttach = false;
    for (const m of mutations) {
      if (m.addedNodes.length) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && (n.matches?.('table') || n.querySelector?.('table'))) {
            needsAttach = true; break;
          }
        }
      }
    }
    if (needsAttach) { attachTableSort(); attachTableFilter(); }
  });

  function boot() {
    attachTableSort();
    attachTableFilter();
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.attachTableSort = attachTableSort;
  window.attachTableFilter = attachTableFilter;
})();
