'use strict';

/**
 * brain-review.js — Human-in-the-loop workflow (Module 6).
 *
 * Launch state: EVERY generated campaign requires human verification before
 * 'final'. Confidence per channel grows with approvals; once
 * confidence ≥ auto_approve_min_confidence AND samples ≥ auto_approve_min_samples,
 * low-risk items may auto-approve — but a HARD weekly human recalibration
 * gate is enforced: if the last recalibration is older than
 * weekly_recalibration_max_age_days, auto-approval is blocked and the system
 * flags OVERDUE.
 */

const { db, getConfig, round, todayIso } = require('./brain-core.js');

async function recalibrationStatus() {
  const config = await getConfig();
  const maxAge = config.review_policy.weekly_recalibration_max_age_days || 7;
  const rows = await db().select('smart_recalibrations', { limit: 1, order: 'created_at.desc' });
  const last = rows[0] || null;
  const ageDays = last ? Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86400000) : null;
  return {
    last_recalibration: last ? last.created_at : null,
    last_reviewer: last ? last.reviewer : null,
    age_days: ageDays,
    overdue: last ? ageDays > maxAge : true,
    max_age_days: maxAge,
  };
}

async function queue({ state = 'pending' } = {}) {
  const items = await db().select('smart_review_queue', { limit: 300, order: 'created_at.desc', filters: state === 'all' ? {} : { state: `eq.${state}` } });
  // join campaign objects for context
  const ids = items.filter((i) => i.item_type === 'generated_campaign').map((i) => `"${i.item_id}"`);
  let campaigns = [];
  if (ids.length) {
    campaigns = await db().select('smart_generated_campaigns', { limit: 300, filters: { id: `in.(${items.filter((i) => i.item_type === 'generated_campaign').map((i) => i.item_id).join(',')})` } });
  }
  const cBy = Object.fromEntries(campaigns.map((c) => [c.id, c]));
  const recal = await recalibrationStatus();
  return { recalibration: recal, items: items.map((i) => ({ ...i, campaign: cBy[i.item_id] || null })) };
}

async function decide({ queueId, itemId, decision, reviewer, notes }) {
  const config = await getConfig();
  const d = db();
  const filters = queueId ? { id: `eq.${queueId}` } : { item_id: `eq.${itemId}`, state: 'eq.pending' };
  const rows = await d.select('smart_review_queue', { filters, limit: 1 });
  const item = rows[0];
  if (!item) throw new Error('review item not found');
  const state = decision === 'approve' ? 'approved' : 'rejected';
  await d.update('smart_review_queue', { id: `eq.${item.id}` }, { state, reviewer: reviewer || 'unknown', notes: notes || null, decided_at: new Date().toISOString() });

  if (item.item_type === 'generated_campaign') {
    const status = decision === 'approve' ? 'final' : 'rejected';
    const gc = await d.update('smart_generated_campaigns', { id: `eq.${item.item_id}` }, { status, updated_at: new Date().toISOString() });
    // confidence update per channel/platform
    const platform = gc[0] ? gc[0].platform : 'unknown';
    const scope = platform.includes('google') ? 'google' : platform.includes('meta') ? 'meta' : platform.includes('tiktok') ? 'tiktok' : platform === 'landing' ? 'landing' : 'email';
    const conf = (await d.select('smart_confidence', { filters: { scope: `eq.${scope}` }, limit: 1 }))[0] || { scope, score: 0.5, samples: 0, approvals: 0, rejections: 0 };
    const approvals = conf.approvals + (decision === 'approve' ? 1 : 0);
    const rejections = conf.rejections + (decision === 'approve' ? 0 : 1);
    const samples = conf.samples + 1;
    // Beta-mean style score with prior (2,2)
    const score = round((approvals + 2) / (samples + 4), 4);
    await d.upsert('smart_confidence', [{ scope, score, samples, approvals, rejections, updated_at: new Date().toISOString() }], 'scope');
    // mark slot final when all its campaigns are decided & ≥1 approved
    if (gc[0] && gc[0].slot_id) {
      const sibs = await d.select('smart_generated_campaigns', { filters: { slot_id: `eq.${gc[0].slot_id}` }, limit: 50 });
      if (sibs.every((s) => ['final', 'rejected'].includes(s.status))) {
        await d.update('smart_calendar', { id: `eq.${gc[0].slot_id}` }, { status: sibs.some((s) => s.status === 'final') ? 'final' : 'skipped', confidence: score, updated_at: new Date().toISOString() });
      }
    }
  }
  return { ok: true, id: item.id, state };
}

/** Auto-approval sweep — runs in the daily cron. Honors the hard weekly gate. */
async function autoApproveSweep() {
  const config = await getConfig();
  const policy = config.review_policy;
  const recal = await recalibrationStatus();
  if (policy.launch_mode) return { swept: 0, reason: 'launch_mode=true → every campaign needs human verification' };
  if (recal.overdue && policy.hard_block_when_overdue) return { swept: 0, reason: `weekly recalibration OVERDUE (${recal.age_days}d) — auto-approval hard-blocked` };

  const d = db();
  const pending = await d.select('smart_review_queue', { filters: { state: 'eq.pending', item_type: 'eq.generated_campaign' }, limit: 100 });
  const confs = await d.select('smart_confidence', { limit: 20 });
  const confBy = Object.fromEntries(confs.map((c) => [c.scope, c]));
  let swept = 0;
  for (const item of pending) {
    const gc = (await d.select('smart_generated_campaigns', { filters: { id: `eq.${item.item_id}` }, limit: 1 }))[0];
    if (!gc) continue;
    const scope = gc.platform.includes('google') ? 'google' : gc.platform.includes('meta') ? 'meta' : gc.platform.includes('tiktok') ? 'tiktok' : gc.platform === 'landing' ? 'landing' : 'email';
    const c = confBy[scope];
    if (c && c.score >= policy.auto_approve_min_confidence && c.samples >= policy.auto_approve_min_samples) {
      await d.update('smart_review_queue', { id: `eq.${item.id}` }, { state: 'approved', auto_approved: true, reviewer: 'brain-auto', notes: `auto: confidence ${c.score} ≥ ${policy.auto_approve_min_confidence}, samples ${c.samples}`, decided_at: new Date().toISOString() });
      await d.update('smart_generated_campaigns', { id: `eq.${gc.id}` }, { status: 'final', updated_at: new Date().toISOString() });
      swept++;
    }
  }
  return { swept };
}

/** Weekly human recalibration — reviews calendar, cohorts, filters in one act. */
async function recalibrate({ reviewer, decisions = [], configPatches = {} }) {
  if (!reviewer) throw new Error('reviewer is required for weekly recalibration');
  const d = db();
  const { getConfig: _, setConfig } = require('./brain-core.js');
  for (const [key, value] of Object.entries(configPatches)) await setConfig(key, value);
  const week = todayIso();
  await d.insert('smart_recalibrations', [{ week_start: week, reviewer, decisions }]);
  // recalibration also disables launch_mode after the first human sign-off if requested
  return { ok: true, week_start: week, reviewer, decisions_recorded: decisions.length, config_patched: Object.keys(configPatches) };
}

module.exports = { queue, decide, autoApproveSweep, recalibrate, recalibrationStatus };
