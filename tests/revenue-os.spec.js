const { test, expect } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODULE = path.join(ROOT, 'api', '_shared', 'revenue-os-core.js');
const revenue = require(MODULE);
const dataAnalysis = require('../api/_shared/data-analysis-core.js');
const supa = require('../api/_shared/supa.js');

function intelligence(actions) {
  return {
    coverage: { total: 7, connected: 5, blocked: 2, analysed: 5 },
    agents: [],
    action_queue: actions,
  };
}

function outcome(overrides) {
  return Object.assign({
    action_type: 'conversion',
    action_id: 'old_1',
    channel: 'meta',
    status: 'measured',
    baseline_metric: 'conversion_rate',
    baseline_value: 0.02,
    observed_metric: 'conversion_rate',
    observed_value: 0.024,
    incremental_revenue: 100,
    cost: 40,
    roi: 2.5,
    guardrail_breach: false,
    rolled_back: false,
    metadata: {},
  }, overrides || {});
}

test('Revenue OS models the full commercial loop with eight explicit roles', () => {
  expect(revenue.ROLES).toHaveLength(8);
  expect(revenue.ROLES.map((x) => x.id)).toEqual([
    'intelligence', 'strategy', 'creative', 'distribution',
    'conversion', 'conversations', 'analytics', 'controller',
  ]);
  expect(revenue.OPERATING_LOOP).toEqual([
    'demand', 'idea', 'content', 'distribution', 'engagement',
    'lead', 'conversion', 'revenue', 'attribution', 'learning',
  ]);
});

test('historical learning uses measured rows only and keeps unknowns unknown', () => {
  const l = revenue.buildLearning([
    outcome(),
    outcome({ action_id: 'old_2', incremental_revenue: -20, roi: 0.7 }),
    { action_type: 'conversion', action_id: 'pending', channel: 'meta', status: 'launched' },
  ]);
  expect(l.total_rows).toBe(3);
  expect(l.by_channel.meta.samples).toBe(3);
  expect(l.by_channel.meta.measured_samples).toBe(2);
  expect(l.by_channel.meta.win_rate).toBe(0.5);
  expect(l.by_channel.meta.avg_incremental_revenue).toBe(40);
});

test('measured success can raise priority but never becomes an expected-revenue forecast', () => {
  const learning = revenue.buildLearning([
    outcome({ action_id: 'a1' }),
    outcome({ action_id: 'a2', incremental_revenue: 160, roi: 3 }),
    outcome({ action_id: 'a3', incremental_revenue: 80, roi: 2 }),
  ]);
  const ranked = revenue.scoreOpportunity({
    platform_id: 'meta', platform: 'Meta Ads', action: 'Improve landing-page CTA',
    target_metric: 'conversion_rate', priority: 'P1', effort: 'low',
  }, learning);
  expect(ranked.score).toBeGreaterThan(68);
  expect(ranked.evidence_grade).toBe('B');

  const plan = revenue.buildPlan({
    market: 'US',
    intelligence: intelligence([{
      platform_id: 'meta', platform: 'Meta Ads', action: 'Improve landing-page CTA',
      why: 'Measured friction', target_metric: 'conversion_rate', priority: 'P1', effort: 'low',
    }]),
    outcomes: { kpis: { measured_actions: 3, realized_incremental_revenue: 340, realized_roi: 2.4 }, actions: [
      outcome({ action_id: 'a1' }),
      outcome({ action_id: 'a2', incremental_revenue: 160, roi: 3 }),
      outcome({ action_id: 'a3', incremental_revenue: 80, roi: 2 }),
    ] },
  });
  expect(plan.opportunity_queue[0].expected_revenue).toBeNull();
  expect(plan.opportunity_queue[0].expected_revenue_note).toMatch(/not estimated/i);
  expect(plan.controller.realised_incremental_revenue).toBe(340);
});

test('guardrail and rollback history reduce the controller score', () => {
  const action = {
    platform_id: 'meta', platform: 'Meta Ads', action: 'Increase spend',
    target_metric: 'roas', priority: 'P1', effort: 'low',
  };
  const clean = revenue.buildLearning([
    outcome({ action_id: 'g1' }), outcome({ action_id: 'g2' }), outcome({ action_id: 'g3' }),
  ]);
  const risky = revenue.buildLearning([
    outcome({ action_id: 'r1', guardrail_breach: true, rolled_back: true }),
    outcome({ action_id: 'r2', guardrail_breach: true, rolled_back: true }),
    outcome({ action_id: 'r3', guardrail_breach: true, rolled_back: false }),
  ]);
  expect(revenue.scoreOpportunity(action, risky).score)
    .toBeLessThan(revenue.scoreOpportunity(action, clean).score);
});

test('stable action ids let the recommendation close the outcome loop', () => {
  const action = {
    platform_id: 'google', platform: 'Google Ads', action: 'Test offer message',
    target_metric: 'conversion_rate', priority: 'P1', effort: 'med',
  };
  const one = revenue.opportunityId('UK', action);
  const two = revenue.opportunityId('UK', Object.assign({}, action));
  const other = revenue.opportunityId('US', action);
  expect(one).toMatch(/^rev_[a-f0-9]{16}$/);
  expect(one).toBe(two);
  expect(one).not.toBe(other);
});

test('customer-facing or money-moving actions require approval', () => {
  const plan = revenue.buildPlan({
    market: 'US',
    intelligence: intelligence([
      { platform_id: 'meta', platform: 'Meta Ads', action: 'Increase ad budget', target_metric: 'roas', priority: 'P0', effort: 'low' },
      { platform_id: 'shopify', platform: 'Shopify', action: 'Analyse repeat-purchase cohort', target_metric: 'repeat_rate', priority: 'P1', effort: 'low' },
    ]),
    outcomes: { kpis: {}, actions: [] },
  });
  const budget = plan.opportunity_queue.find((x) => /budget/i.test(x.action));
  const analysis = plan.opportunity_queue.find((x) => /analyse/i.test(x.action));
  expect(budget.human_approval_required).toBe(true);
  expect(analysis.human_approval_required).toBe(false);
  expect(budget.execution_mode).toBe('recommend_only');
});

test('run accepts injected grounded snapshots and makes no connector or model dependency mandatory', async () => {
  const plan = await revenue.run({
    market: 'IN',
    brand: { name: 'Test Brand', industry: 'commerce' },
    platformSnapshot: intelligence([{
      platform_id: 'pagedeck', platform: 'Landing Pages (PageDeck)',
      action: 'Test CTA hierarchy', target_metric: 'conversion_rate', priority: 'P1', effort: 'low',
    }]),
    outcomeSnapshot: { kpis: { measured_actions: 0, realized_incremental_revenue: 0, realized_roi: null }, actions: [] },
  });
  expect(plan.ok).toBe(true);
  expect(plan.market).toBe('IN');
  expect(plan.brand.name).toBe('Test Brand');
  expect(plan.opportunity_queue).toHaveLength(1);
  expect(plan.opportunity_queue[0].role_owner).toBe('conversion');
});

test('outcome tracking executes a workspace-scoped upsert and preserves prior measurement state', async () => {
  const originalWorkspace = dataAnalysis.activeWorkspace;
  const originalSelect = supa.select;
  const originalInsert = supa.insert;
  const calls = { select: null, insert: null };

  dataAnalysis.activeWorkspace = async () => 'ws-a';
  supa.select = async (table, opts) => {
    calls.select = { table, opts };
    return [{
      action_id: 'rev_0123456789abcdef',
      action_type: 'conversion',
      channel: 'meta',
      market: 'US',
      owner: 'conversion',
      status: 'launched',
      recommended_at: '2026-10-01T00:00:00.000Z',
      launched_at: '2026-10-02T00:00:00.000Z',
      baseline_metric: 'conversion_rate',
      baseline_value: 0.02,
      experiment_id: 'exp-7',
      metadata: { platform_id: 'meta', original: true },
    }];
  };
  supa.insert = async (table, rows, opts) => {
    calls.insert = { table, rows, opts };
    return rows.map((row) => Object.assign({ workspace_id: 'ws-a' }, row));
  };

  try {
    const out = await revenue.trackOutcome({
      action_id: 'rev_0123456789abcdef',
      status: 'measured',
      workspace_id: 'ws-evil',
      observed_value: 0.026,
      incremental_revenue: 4200,
      cost: 1200,
      metadata: { measured_by: 'experiment' },
    });

    expect(calls.select.table).toBe('analytics_action_outcomes');
    expect(calls.select.opts.filters).toEqual({ action_id: 'eq.rev_0123456789abcdef' });
    expect(calls.insert.table).toBe('analytics_action_outcomes');
    expect(calls.insert.opts).toEqual({ upsertOn: 'workspace_id,action_id' });

    const row = calls.insert.rows[0];
    expect(row).not.toHaveProperty('workspace_id');
    expect(row.recommended_at).toBe('2026-10-01T00:00:00.000Z');
    expect(row.launched_at).toBe('2026-10-02T00:00:00.000Z');
    expect(row.baseline_metric).toBe('conversion_rate');
    expect(row.baseline_value).toBe(0.02);
    expect(row.experiment_id).toBe('exp-7');
    expect(row.observed_value).toBe(0.026);
    expect(row.incremental_revenue).toBe(4200);
    expect(row.roi).toBe(3.5);
    expect(row.metadata).toMatchObject({ original: true, platform_id: 'meta', measured_by: 'experiment', source: 'revenue-os' });
    expect(out.workspace_id).toBe('ws-a');
    expect(out.outcome.workspace_id).toBe('ws-a');
  } finally {
    dataAnalysis.activeWorkspace = originalWorkspace;
    supa.select = originalSelect;
    supa.insert = originalInsert;
  }
});
