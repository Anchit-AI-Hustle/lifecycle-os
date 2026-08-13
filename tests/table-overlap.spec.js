// A wide data table must not paint one column on top of the next.
//
// The Live Ads table has fourteen columns and campaign names long enough to
// fill several of them. Its stylesheet set min-width:820px, which let the
// browser compress columns below their content width, and white-space:nowrap
// then left the text nowhere to go: it overflowed its cell and rendered ON TOP
// of the neighbouring column. Campaign and Ad group came out as a single
// superimposed string - not merely ugly, unreadable, and on a table whose whole
// job is to identify which ad a number belongs to.
//
// Run: npx playwright test tests/table-overlap.spec.js
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = fs.readFileSync(path.join(ROOT, 'data-analysis-extensions.js'), 'utf8');

/* The real column set and the kind of identifier these platforms actually
   return - long, unbroken, and with no spaces to wrap at. */
const HEADERS = ['Platform', 'Entity', 'Campaign', 'Ad group / set', 'Status', 'Spend',
  'Impressions', 'Clicks', 'CTR', 'CPC', 'Conversions', 'CPA', 'Revenue', 'ROAS'];
const LONG = 'Conversion_Scale_Programme_NewBuyer_Prospecting_Broad_04072026_v3';

/* theme.css is what makes this a real reproduction rather than a mock. Its
   global `table{table-layout:fixed;width:100%}` is the other half of the bug:
   the fixed layout divides the card equally between fourteen columns and
   relies on its own overflow-wrap to keep long values in their cell, and the
   .xtable rules then set white-space:nowrap at higher specificity, defeating
   that wrap without opting out of the layout. Testing the .xtable rules alone
   passes on the broken code, because nothing is compressing the columns. */
const THEME = fs.readFileSync(path.join(ROOT, 'theme.css'), 'utf8');

/** Build the page the extensions script builds, in the real cascade. */
async function renderTable(page) {
  // Take the stylesheet the way the page does: the array of CSS strings the
  // extensions module injects. Reading it from the source rather than
  // restating it is the point - a rule that regresses there fails here.
  const css = (EXT.match(/'\.xtable[^']*'/g) || []).map((s) => s.slice(1, -1)).join('\n');
  expect(css, 'the .xtable rules must be readable from the source').toContain('.xtable table');
  expect(THEME, 'theme.css must still carry the global default this guards against')
    .toMatch(/table\s*\{[^}]*table-layout:\s*fixed/);

  const body = `<div class="xtable" style="width:900px"><table>
    <thead><tr>${HEADERS.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${[0, 1, 2].map((i) => `<tr>
      <td>Meta</td><td>KA_0${i}</td><td title="${LONG}">${LONG}</td>
      <td title="${LONG}_adset">${LONG}_adset</td><td>ACTIVE</td><td>$1,112.37</td>
      <td>28,176</td><td>402</td><td>1.43%</td><td>$2.77</td><td>60</td>
      <td>$18.54</td><td>$4,172.58</td><td>3.75x</td></tr>`).join('')}</tbody>
  </table></div>`;

  await page.setContent(`<!doctype html><meta charset="utf-8">
    <style>${THEME}</style>
    <style>:root{--line:#e6e6e6;--surface:#fff;--soft:#5a6169}
    body{margin:0;font-family:system-ui}${css}</style>${body}`);
}

test('a long cell does not paint over the next column', async ({ page }) => {
  await renderTable(page);

  const overlaps = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')];
    const bad = [];
    for (const tr of rows) {
      const cells = [...tr.children];
      for (let i = 0; i < cells.length - 1; i++) {
        const a = cells[i].getBoundingClientRect();
        const b = cells[i + 1].getBoundingClientRect();
        // A cell's painted content must stay inside its own box, and the boxes
        // must not overlap. scrollWidth > clientWidth is content that does not
        // fit; with overflow hidden that is clipped, without it, it spills.
        const spills = cells[i].scrollWidth > cells[i].clientWidth
          && getComputedStyle(cells[i]).overflowX === 'visible';
        if (spills || a.right > b.left + 0.5) {
          bad.push({ i, text: cells[i].textContent.slice(0, 30), spills, right: a.right, next: b.left });
        }
      }
    }
    return bad;
  });

  expect(overlaps, 'no cell may overflow into its neighbour').toEqual([]);
});

test('the table scrolls sideways instead of crushing its columns', async ({ page }) => {
  await renderTable(page);
  const m = await page.evaluate(() => {
    const wrap = document.querySelector('.xtable');
    const table = wrap.querySelector('table');
    return {
      scrollable: wrap.scrollWidth > wrap.clientWidth,
      overflow: getComputedStyle(wrap).overflowX,
      tableWider: table.getBoundingClientRect().width >= wrap.clientWidth,
    };
  });
  // Fourteen columns of real content do not fit in 900px. The honest outcome is
  // a table wider than its wrapper that the wrapper scrolls - not columns
  // squeezed until their contents collide.
  expect(m.tableWider).toBe(true);
  expect(m.scrollable).toBe(true);
  expect(m.overflow).toBe('auto');
});

test('a truncated cell keeps its full value on the title', async ({ page }) => {
  // Ellipsis is only acceptable because nothing is lost: the identifier is
  // still recoverable, which matters on a table whose job is to say which ad
  // a number belongs to.
  await renderTable(page);
  const cell = page.locator('tbody tr').first().locator('td').nth(2);
  await expect(cell).toHaveAttribute('title', LONG);

  // And the renderer, not just this fixture, sets it.
  expect(EXT).toContain('title="\' + esc(v) + \'"');
});

test('the sticky header is opaque, so rows do not scroll through it', async ({ page }) => {
  await renderTable(page);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('th')).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});
