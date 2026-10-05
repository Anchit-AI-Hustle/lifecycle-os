/**
 * A feature does not default to tenant zero's catalogue, prompts, or name.
 * --------------------------------------------------------------------------
 * The region-wise Shopify export (`Knickgasm Product Catalog RegionWise/`)
 * and the operator uploads beside it are one brand's files. Smart Brain's
 * disconnected path used to read them for every caller and, when a row had
 * no title, invent `KNICKGASM Product N`. The build that turns those CSVs
 * into data/catalog/ is scripts/build-catalog.js. A feature with no project
 * cannot prove it is that workspace, so it gets an empty catalogue.
 *
 * The same rule on the generators: a workspace that merely saved the slug
 * `knickgasm` is not tenant zero (brand-catalog-server.isTenantZeroBrand),
 * so it does not receive KicksGPT, the campaign-hub pages, or the shipped
 * competitor seed.
 *
 * Run: npx playwright test tests/no-default-knickgasm.spec.js --project=desktop-1280
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

test('a disconnected Smart Brain does not read the region-wise Knickgasm export', async () => {
  const svc = require(path.join(ROOT, 'lib/smart-brain/services.js'));
  const adapter = new svc.SmartBrainDbAdapter(svc.smartConfig({}), null);
  adapter.url = '';
  adapter.key = '';
  expect(adapter.connected).toBe(false);
  const data = await adapter.ownData();
  expect(data.source).toBe('local-empty');
  expect(data.products).toEqual([]);
  expect(data.orders).toEqual([]);
  expect(data.campaigns).toEqual([]);
  expect(data.users).toEqual([]);
  expect(data.note).toMatch(/Another brand's product export is not used/);
  const blob = JSON.stringify(data);
  expect(blob).not.toMatch(/KNICKGASM Product/);
  expect(blob).not.toMatch(/Sneaker & Streetwear/);
  // The export is on disk. If the fallback started reading it again, the
  // product list would not be empty.
  const csv = path.join(ROOT, 'Knickgasm Product Catalog RegionWise', 'products_export_usa.csv');
  expect(fs.existsSync(csv)).toBe(true);
  expect(fs.statSync(csv).size).toBeGreaterThan(1000);
});

test('a workspace that only claims the knickgasm slug is not handed tenant zero\'s library', async () => {
  const catalog = require(path.join(ROOT, 'api/_shared/brand-catalog-server.js'));
  const brain = require(path.join(ROOT, 'api/_shared/brain-generate.js'));
  const llm = require(path.join(ROOT, 'api/_shared/brand-llm.js'));
  const competitor = require(path.join(ROOT, 'api/_shared/competitor-core.js'));
  const impostor = { id: 'ws-other', slug: 'knickgasm', name: 'Deli Chic', owns_shipped: false };
  expect(catalog.isTenantZeroBrand(impostor)).toBe(null);
  expect(catalog.isTenantZeroBrand({ is_default: true, name: 'KNICKGASM' })).toBe(true);
  expect(catalog.isTenantZeroBrand(null)).toBe(null);
  expect(brain.pickCampaignHubLP(
    { theme: 'grail-drop anime football custom hand-painted', angle: 'one-of-one' },
    [{ title: 'Air Force custom', tags: ['custom', 'hand-painted'] }],
    impostor,
  )).toBeNull();
  expect(llm.assistantNameFor(impostor)).toBe('Deli Chic Assistant');
  expect(llm.assistantNameFor(null)).toBe('Assistant');
  expect(llm.assistantNameFor({ is_default: true, name: 'KNICKGASM' })).toBe('KicksGPT');
  const seeded = await competitor.seedBrands(new Date().toISOString(), impostor);
  expect(seeded.skipped).toBe(true);
  expect(seeded.added).toBe(0);
});

test('the landing-page agent and the mail capture service do not name Knickgasm as their default', () => {
  const agent = fs.readFileSync(path.join(ROOT, 'landing-page-agent.html'), 'utf8');
  expect(agent).not.toMatch(/fetch\(\s*['"]\/data\/catalog\//);
  expect(agent).not.toMatch(/KNICKGASM/);
  const py = fs.readFileSync(path.join(ROOT, 'knickgasm_dtc_data_engine/src/api/mail_capture.py'), 'utf8');
  expect(py).not.toMatch(/Knickgasm/);
  expect(py).toMatch(/title="Inbound Email Capture"/);
});
