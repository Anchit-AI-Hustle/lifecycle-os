'use strict';
/**
 * tests/asset-playbooks.spec.js
 *
 * Comprehensive test suite verifying:
 * 1. Multi-model business classification (market_data, news_media, commerce, etc.)
 * 2. Visual asset rules & image prompt policies (information and stock market integrity)
 * 3. Asset design & structure playbooks across business models
 * 4. Regulatory financial compliance disclaimers (SEBI, SEC, FCA)
 * 5. Master prompt generation with benchmarked playbooks & AI-choice copy instructions
 * 6. Mailer design strategy & archetypes (de-leaked founder note, news/market archetypes)
 * 7. Knowledge base audit script and observed benchmarks
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const playbooks = require(path.join(ROOT, 'api', '_shared', 'asset-playbooks.js'));
const imagePrompt = require(path.join(ROOT, 'api', '_shared', 'image-prompt.js'));
const masterPrompt = require(path.join(ROOT, 'api', '_shared', 'master-prompt.js'));
const mailerStrategy = require(path.join(ROOT, 'api', '_shared', 'mailer-design-strategy.js'));

/* ═══ 1. Business Model Classification ═════════════════════════════════════ */

test('businessModel classifies stock market & financial data brands correctly', () => {
  const stockBrand1 = {
    name: 'Dalal Street Alpha',
    industry: 'Financial Intelligence & Stock Market Analytics',
    description: 'Real-time equity research, Nifty 50 sector rotation models, and trading insights.',
  };
  expect(playbooks.businessModel(stockBrand1)).toBe('market_data');

  const stockBrand2 = {
    name: 'MacroPulse Research',
    offerings: [
      { name: 'Daily Market Briefing', kind: 'programme', topics: 'equities, bonds, central bank policy, crypto' },
      { name: 'Institutional Terminal', kind: 'plan' },
    ],
  };
  expect(playbooks.businessModel(stockBrand2)).toBe('market_data');
});

test('businessModel classifies news media & journalism publications correctly', () => {
  const newsBrand1 = {
    name: 'The Daily Chronicle',
    industry: 'News & Media Publishing',
    description: 'Investigative city desk journalism and daily morning briefings.',
  };
  expect(playbooks.businessModel(newsBrand1)).toBe('news_media');

  const newsBrand2 = {
    name: 'Metropolitan Dispatch',
    offerings: [
      { name: 'City Morning Digest', kind: 'programme', cadence: 'daily' },
      { name: 'Culture & Tech Section', kind: 'section' },
    ],
  };
  expect(playbooks.businessModel(newsBrand2)).toBe('news_media');
});

test('businessModel classifies physical commerce brands correctly', () => {
  const commerceBrand = {
    name: 'Studio Kicks',
    industry: 'Footwear & Streetwear Apparel',
    offerings: [{ name: 'Custom Sneaker', kind: 'product', price: 180 }],
  };
  expect(playbooks.businessModel(commerceBrand)).toBe('commerce');
});

/* ═══ 2. Regulatory Financial Disclaimers ══════════════════════════════════ */

test('financialDisclaimer provides accurate regulatory compliance by region', () => {
  const brand = { name: 'Alpha Signals' };

  const inDisclaimer = playbooks.financialDisclaimer('IN', brand);
  expect(inDisclaimer).toContain('SEBI (Research Analysts) Regulations');
  expect(inDisclaimer).toContain('Securities markets are subject to market risks');

  const usDisclaimer = playbooks.financialDisclaimer('US', brand);
  expect(usDisclaimer).toContain('informational and educational purposes only');
  expect(usDisclaimer).toContain('Past performance is not indicative of future results');

  const ukDisclaimer = playbooks.financialDisclaimer('UK', brand);
  expect(ukDisclaimer).toContain('Financial Conduct Authority (FCA)');
  expect(ukDisclaimer).toContain('Capital at risk');
});

/* ═══ 3. Image Sourcing & Visual Policies for Information Brands ═══════════ */

test('subjectFor gives market data brands high-end financial mood stills without fake charts', () => {
  const stockBrand = {
    name: 'Capital Terminal',
    industry: 'Financial Market Intelligence',
    offerings: [{ name: 'Markets Wire', kind: 'programme' }],
  };
  const sub = imagePrompt.subjectFor(stockBrand);
  expect(sub.scene).toContain('financial intelligence');
  expect(sub.scene).toContain('NO fake charts or tickers');
  expect(sub.ambient).toContain('terminal backdrop');
  expect(sub.caution).toContain('NEVER render fake candlestick charts');
  expect(sub.caution).toContain('fabricated ticker symbols');
});

test('subjectFor gives news media brands documentary stills without fake breaking news', () => {
  const newsBrand = {
    name: 'Metro Gazette',
    industry: 'News Media Journalism',
    offerings: [{ name: 'Daily Brief', kind: 'programme' }],
  };
  const sub = imagePrompt.subjectFor(newsBrand);
  expect(sub.scene).toContain('editorial documentary photograph');
  expect(sub.caution).toContain('NEVER render fake breaking news banners');
});

test('image-prompt NEVER policy strictly bans synthetic charts and hallucinated tickers', () => {
  expect(imagePrompt.NEVER).toContain('NEVER render fake candlestick charts');
  expect(imagePrompt.NEVER).toContain('synthetic portfolio balances');
  expect(imagePrompt.NEVER).toContain('simulated price tickers');
});

/* ═══ 4. Playbooks & Section Architecture ══════════════════════════════════ */

test('playbookFor returns structured sections and revenue levers for market data mailers', () => {
  const brand = { name: 'QuantWire', industry: 'Stock Market Analytics' };
  const pb = playbooks.playbookFor(brand, 'mailer_v2');

  expect(pb.businessModel).toBe('market_data');
  expect(pb.revenueJob).toContain('Habitual daily engagement leading to Pro Subscription');
  expect(pb.exemplars).toContain('Bloomberg Daily Quint');
  expect(pb.exemplars).toContain('Seeking Alpha Wall Street Breakfast');

  const sectionIds = pb.sections.map((s) => s.id);
  expect(sectionIds).toContain('masthead');
  expect(sectionIds).toContain('market_pulse');
  expect(sectionIds).toContain('lead_story');
  expect(sectionIds).toContain('sector_watchlist');
  expect(sectionIds).toContain('pro_monetization_card');
  expect(sectionIds).toContain('disclaimer_footer');
});

test('structureChecklist enforces regulatory disclaimers and no-hallucination checks for finance', () => {
  const brand = { name: 'QuantWire', industry: 'Stock Market Analytics' };
  const checklist = playbooks.structureChecklist(brand, 'mailer_v2');
  const checklistIds = checklist.map((c) => c.id);

  expect(checklistIds).toContain('compliance_disclaimer');
  expect(checklistIds).toContain('no_synthetic_charts');
});

/* ═══ 5. Master Prompt Generation & Multi-Model Contracts ══════════════════ */

test('buildMasterPrompt for market data brand includes financial disclaimers and no-fake-data rules', () => {
  const brand = {
    id: 'brand-finance-test',
    name: 'Nifty Alpha Desk',
    industry: 'Stock Market Analysis',
    region: 'IN',
    offerings: [{ name: 'Morning Bell Memo', kind: 'programme' }],
  };

  const prompt = masterPrompt.buildMasterPrompt({
    brand,
    assetType: 'mailer',
    variant: 'V2',
    market: 'IN',
    brief: 'Pre-market briefing on IT sector earnings',
  });

  expect(prompt).toContain('ASSET: Email mailer — VARIANT V2');
  expect(prompt).toContain('Executive Terminal Masthead');
  expect(prompt).toContain('Market Pulse & Benchmark Bar');
  expect(prompt).toContain('SEBI (Research Analysts) Regulations');
  expect(prompt).toContain('NEVER hallucinate fake charts or fictional tickers');
  expect(prompt).toContain('COMPETITIVE BENCHMARK PLAYBOOK');
});

test('buildMasterPrompt for news publisher includes editorial Smart Brevity structure', () => {
  const brand = {
    id: 'brand-news-test',
    name: 'Daily Global Chronicle',
    industry: 'News Media Publisher',
    offerings: [{ name: 'Morning Briefing', kind: 'programme' }],
  };

  const prompt = masterPrompt.buildMasterPrompt({
    brand,
    assetType: 'mailer',
    variant: 'V2',
    market: 'US',
    brief: 'Top stories in clean energy policy',
  });

  expect(prompt).toContain('ASSET: Email mailer — VARIANT V2');
  expect(prompt).toContain('Lead Story');
  expect(prompt).toContain('Why it matters');
  expect(prompt).toContain('Bulletin Radar');
  expect(prompt).toContain('COMPETITIVE BENCHMARK PLAYBOOK');
  expect(prompt).not.toContain('Shop the edit');
});

test('promptsFor provides clear AI-choice instructions for each asset prompt', () => {
  const asset = {
    master_prompt_v2: 'Deliverable: complete email...',
    master_prompt_v1: 'Deliverable: complete text email...',
    creative_brief: 'A shot of modern trading room...',
  };

  const list = masterPrompt.promptsFor(asset, 'mailer');
  expect(list.length).toBeGreaterThanOrEqual(2);

  const mainPrompt = list.find((p) => p.id === 'master_prompt_v2');
  expect(mainPrompt).toBeDefined();
  expect(mainPrompt.kind).toBe('asset');
});

/* ═══ 6. Mailer Design Strategy & Archetype De-leaking ══════════════════════ */

test('mailer design strategy does not leak KNICKGASM founder for external brands', () => {
  const brand = { name: 'Acme Coffee Co.' };
  const strat = mailerStrategy.strategyFor({ cohort_name: 'post_purchase nurture' }, brand);
  expect(strat.influencerAngle).not.toContain('KNICKGASM founder');
  expect(strat.influencerAngle).toContain('Acme Coffee Co. founder');
});

test('mailer design strategy selects financial and news archetypes for information brands', () => {
  const financeBrand = { name: 'Alpha Finance', industry: 'Financial Market Intelligence' };
  const stratF = mailerStrategy.strategyFor({ theme: 'daily market catalyst roundup' }, financeBrand);
  expect(['data-snapshot', 'top-story-lead', 'briefing-digest', 'explainer', 'paywall-upsell']).toContain(stratF.key);

  const newsBrand = { name: 'Evening Press', industry: 'News Journalism' };
  const stratN = mailerStrategy.strategyFor({ theme: 'daily news digest' }, newsBrand);
  expect(['briefing-digest', 'top-story-lead', 'explainer', 'paywall-upsell']).toContain(stratN.key);
});

/* ═══ 7. Living Knowledge Base Observed Data ═══════════════════════════════ */

test('observed benchmarks file exists, has valid structure, and surveyed brands', () => {
  const observedFile = path.join(ROOT, 'data', 'kb', 'asset-benchmarks.observed.json');
  expect(fs.existsSync(observedFile)).toBe(true);

  const data = JSON.parse(fs.readFileSync(observedFile, 'utf8'));
  expect(data.version).toBeDefined();
  expect(data.last_refreshed_at).toBeDefined();
  expect(data.survey_scope.total_brands_surveyed).toBeGreaterThan(0);
  expect(data.observed_metrics.market_data).toBeDefined();
  expect(data.observed_metrics.news_media).toBeDefined();
  expect(data.observed_metrics.commerce).toBeDefined();
});
