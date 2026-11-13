(function () {
  'use strict';
  const WB = window.MarketingWorkbench;
  const grid = document.getElementById('wb-grid');
  const detail = document.getElementById('wb-detail');
  if (!WB || !grid || !detail) return;

  function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }

  function button(label, fn, secondary = false) {
    const b = el('button', label, { type: 'button', class: secondary ? 'btn ghost' : 'btn' });
    b.addEventListener('click', fn);
    return b;
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    el('a', null, { href: url, download: name + '.md' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function controls(name, getText) {
    const row = el('div', null, { class: 'wb-actions' });
    row.append(button('Copy', async (event) => {
      const b = event.currentTarget;
      try { await navigator.clipboard.writeText(getText()); b.textContent = 'Copied'; }
      catch (_) { b.textContent = 'Copy unavailable'; }
    }, true), button('Download', () => download(name, getText()), true));
    return row;
  }

  function renderLibrary(item) {
    const entries = WB.prompts(item.id);
    const form = el('div', null, { class: 'wb-fields' });
    const label = el('label', 'Find a prompt', { class: 'field' });
    const search = el('input', null, { type: 'search', placeholder: 'Search by task or audience' });
    const select = el('select', null, { 'aria-label': 'Prompt' });
    const output = el('pre', null, { class: 'wb-pre' });
    const paint = () => {
      const q = search.value.toLowerCase().trim();
      select.replaceChildren(...entries.flatMap((p, i) => p.title.toLowerCase().includes(q) ? [el('option', p.title, { value: i })] : []));
      output.textContent = select.value ? entries[Number(select.value)].text : 'No matching prompts.';
    };
    search.addEventListener('input', paint);
    select.addEventListener('change', () => { output.textContent = entries[Number(select.value)].text; });
    label.append(search);
    form.append(label, select);
    detail.append(el('p', `${entries.length} prompts`), form, output, controls(item.id, () => output.textContent));
    paint();
  }

  function renderTemplate(item) {
    const form = el('div', null, { class: 'wb-fields' });
    const brand = window.BrandContext?.workspaceId?.() || window.BrandContext?.brand?.id;
    const market = window.RegionContext?.region || '';
    const key = brand ? `lifecycle.marketing-template.${brand}.${market}.${item.id}` : null;
    let values = {};
    try { if (key) values = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) {}
    function store(name, value) {
      values[name] = value;
      try { if (key) localStorage.setItem(key, JSON.stringify(values)); } catch (_) {}
    }
    item.fields.forEach((field) => {
      const label = el('label', field, { class: 'field' });
      const input = el('textarea', null, { rows: '2' });
      input.value = values[field] || '';
      input.addEventListener('input', () => store(field, input.value));
      label.append(input);
      form.append(label);
    });
    const checks = item.id === 'page-launch' ? WB.launchChecks : [];
    if (checks.length) {
      const checklist = el('div', null, { class: 'wb-checks' });
      for (const check of checks) {
        const input = el('input', null, { type: 'checkbox' });
        input.checked = values[check] === true;
        input.addEventListener('change', () => store(check, input.checked));
        const label = el('label');
        label.append(input, document.createTextNode(check));
        checklist.append(label);
      }
      form.append(checklist);
    }
    const markdown = () => [`# ${item.name}`, ...item.fields.map((f) => `## ${f}\n\n${values[f] || ''}`),
      ...checks.map((f) => `- [${values[f] ? 'x' : ' '}] ${f}`)].join('\n\n');
    if (key) detail.append(el('p', 'Drafts are saved in this browser for the active brand and market.', { class: 'muted' }));
    detail.append(form, controls(item.id, markdown));
  }

  function renderAgent(item) {
    const form = el('div', null, { class: 'wb-fields' });
    const label = el('label', 'Evidence and brief', { class: 'field' });
    const input = el('textarea', null, { rows: '6', maxlength: '22000', placeholder: item.source });
    const marketLabel = el('label', 'Market', { class: 'field' });
    const market = el('select');
    const rc = window.RegionContext;
    const fill = () => {
      const regions = rc?.regions || [];
      market.replaceChildren(...regions.map((r) => el('option', rc.label(r.code), { value: r.code })));
      market.value = rc?.region || '';
    };
    fill();
    if (rc && !rc.loaded) rc.ready().then(fill);
    const status = el('p', '', { role: 'status' });
    const output = el('pre', '', { class: 'wb-pre' });
    const exportRow = controls(item.id, () => output.textContent);
    exportRow.hidden = true;
    const run = button('Run', async () => {
      if (!input.value.trim() || !market.value) { status.textContent = 'Choose a market and add evidence first.'; return; }
      run.disabled = true;
      run.setAttribute('aria-busy', 'true');
      status.textContent = 'Working…';
      output.textContent = '';
      exportRow.hidden = true;
      try {
        const stop = await window.LifecycleStatus?.decide('Running this marketing tool', { metered: true });
        if (stop) { window.LifecycleStatus.show(status, stop); return; }
        const res = await fetch('/api/brain?action=marketing-team&op=run-tool', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: item.id, evidence: input.value, market: market.value }),
        });
        const result = await res.json();
        if (!res.ok || !result.ok) throw new Error(result.message || 'The tool did not finish.');
        const sources = result.sources || {};
        status.textContent = [market.options[market.selectedIndex]?.text, 'your evidence', sources.brand_context && 'brand context pack',
          sources.connected_ads && `${sources.connected_ads} connected ad records`].filter(Boolean).join(' · ');
        output.textContent = result.text;
        exportRow.hidden = false;
      } catch (e) { status.textContent = e.message; }
      finally { run.disabled = false; run.removeAttribute('aria-busy'); }
    });
    label.append(input);
    marketLabel.append(market);
    form.append(marketLabel, label);
    detail.append(el('p', item.source, { class: 'muted' }), form, run, status, output, exportRow);
  }

  function open(id) {
    const item = WB.find(id);
    detail.hidden = !item || item.type === 'tool';
    grid.hidden = !detail.hidden;
    detail.replaceChildren();
    if (detail.hidden) return;
    const h = el('h2', item.name, { tabindex: '-1' });
    detail.append(el('a', 'Back to workbench', { href: '#workbench' }), h);
    if (item.href) detail.append(el('a', 'Open related feature', { href: item.href }));
    if (item.type === 'guide') {
      const list = el('ol');
      list.append(...item.steps.map((step) => el('li', step)));
      detail.append(list, controls(item.id, () => `# ${item.name}\n\n${item.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`));
    }
    if (item.type === 'library') renderLibrary(item);
    if (item.type === 'template') renderTemplate(item);
    if (item.type === 'agent') renderAgent(item);
    h.focus();
  }

  for (const [group, items] of WB.groups) {
    const card = el('article', null, { class: 'card' });
    const list = el('ul');
    items.forEach((item) => {
      const row = el('li');
      row.append(el('a', item.name, { href: item.type === 'tool' ? item.href : `#workbench-${item.id}`, 'data-wb-item': item.id }));
      list.append(row);
    });
    card.append(el('h3', group), list);
    grid.append(card);
  }
  const hash = () => open(location.hash.slice(1).replace(/^workbench-/, ''));
  window.addEventListener('hashchange', hash);
  hash();
})();
