'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// revenue-model.js — deterministic email revenue math for the agentic calendar
// (correction module §3-§4). Turns cohort audience + conversion + AOV into
// per-send and per-DAY forecasts, and assigns an honest feasibility state
// against a daily target (default $1500). Never manipulates assumptions to pass.
//
// Pure + testable. Not a function file (under api/_shared/).
// ─────────────────────────────────────────────────────────────────────────────

// ── EVERY NUMBER HERE IS A PLANNING ASSUMPTION, NOT A MEASUREMENT ───────────
// These are the spec's stated planning band (§9: "label as assumptions, replace
// with validated medians when available"). They are NOT any particular brand's
// figures, and at least one is contradicted by the repo's own measured data:
// tenant zero's Shopify export puts US AOV at 157.37 and UK at 133.79 against
// the 42.5 below, so a forecast built on the default understates revenue by
// roughly 3.7x. The defaults stay (this is a multi-brand platform and one
// brand's basket is not another's) but every output now carries the basis, so a
// caller cannot mistake a modelled forecast for a measured one.
const DEFAULTS = {
  dailyTarget: 1500,   // USD attributed email revenue
  aov: 42.5,           // stated AOV band $42-$43
  clickRate: 0.015,    // unique click rate on delivered (1-2% band → mid 1.5%)
  closeRate: 0.03,     // click → purchase
};
const DEFAULT_KEYS = ['aov', 'clickRate', 'closeRate'];
/** Which inputs the caller supplied, and which fell back to the planning band. */
function basisFor(send, d) {
  const overrides = DEFAULT_KEYS.filter((k) => send && send[k] != null);
  const fromDefaults = DEFAULT_KEYS.filter((k) => !(send && send[k] != null) && d[k] === DEFAULTS[k]);
  return {
    basis: fromDefaults.length ? 'modelled' : 'measured',
    measured_inputs: overrides,
    assumed_inputs: fromDefaults,
    note: fromDefaults.length
      ? `[DATA REQUIRED BEFORE LAUNCH: measured ${fromDefaults.join(', ')} for this brand and market. Until then this forecast uses the spec's planning band (aov ${DEFAULTS.aov}, click ${DEFAULTS.clickRate}, close ${DEFAULTS.closeRate}), which is not a measurement of any brand.]`
      : 'All rate and value inputs were supplied by the caller from measured data.',
  };
}

function round(n, d = 2) { const p = 10 ** d; return Math.round((Number(n) || 0) * p) / p; }

// One send slot → forecast. `recipients` = delivered emails to a mutually
// exclusive cohort. Rates/AOV may be overridden per cohort from real data.
function forecastSend(send, d = DEFAULTS) {
  const recipients = Math.max(0, Number(send.recipients) || 0);
  const clickRate = send.clickRate != null ? send.clickRate : d.clickRate;
  const closeRate = send.closeRate != null ? send.closeRate : d.closeRate;
  const aov = send.aov != null ? send.aov : d.aov;
  const clicks = recipients * clickRate;
  const orders = clicks * closeRate;
  const revenue = orders * aov;
  return {
    cohort: send.cohort || null,
    recipients, clickRate, closeRate, aov,
    forecast_clicks: round(clicks, 1),
    forecast_orders: round(orders, 2),
    forecast_revenue: round(revenue, 2),
    ...basisFor(send, d),
  };
}

// Reach (delivered emails) needed for a target revenue at given rates.
function requiredReach(target, d = DEFAULTS) {
  const perEmail = d.clickRate * d.closeRate * d.aov;
  return perEmail > 0 ? Math.ceil(target / perEmail) : Infinity;
}
function requiredOrders(target, aov = DEFAULTS.aov) { return Math.ceil(target / aov); }

// A day = up to 3 mutually-exclusive send slots. Combined revenue is the SUM;
// never evaluate each send against the full target independently (§4.3).
function forecastDay(day, opts = {}) {
  const d = Object.assign({}, DEFAULTS, opts);
  const sends = (day.sends || []).map((s) => forecastSend(s, d));
  const totalRecipients = sends.reduce((s, x) => s + x.recipients, 0);
  const totalOrders = round(sends.reduce((s, x) => s + x.forecast_orders, 0), 2);
  const totalRevenue = round(sends.reduce((s, x) => s + x.forecast_revenue, 0), 2);
  const target = d.dailyTarget;

  let state;
  const ratio = target > 0 ? totalRevenue / target : 1;
  if (totalRecipients > 0 && totalRecipients < 1000 && totalRevenue < target) {
    state = 'TARGET NOT FEASIBLE WITH CURRENT AUDIENCE';
  } else if (ratio >= 1.1) state = 'TARGET FEASIBLE — HIGH CONFIDENCE';
  else if (ratio >= 1) state = 'TARGET FEASIBLE';
  else if (sends.length < 3) state = 'TARGET REQUIRES MULTIPLE COHORTS';
  else state = 'TARGET REQUIRES MORE ELIGIBLE REACH';

  return {
    date: day.date || null,
    sends,
    slots: sends.length,
    total_recipients: totalRecipients,
    total_forecast_orders: totalOrders,
    total_forecast_revenue: totalRevenue,
    target,
    gap: round(Math.max(0, target - totalRevenue), 2),
    required_orders: requiredOrders(target, d.aov),
    required_reach_for_target: requiredReach(target, d),
    feasibility: state,
    // The feasibility verdict is only as real as the inputs behind it. A day
    // marked NOT FEASIBLE off the planning band is a statement about the band,
    // not about the audience, and must say so.
    ...(sends.length ? { basis: sends.every((x) => x.basis === 'measured') ? 'measured' : 'modelled', assumed_inputs: [...new Set(sends.flatMap((x) => x.assumed_inputs || []))] } : { basis: 'unset', assumed_inputs: [] }),
    target_basis: opts.dailyTarget != null ? 'caller-supplied' : `planning default ${DEFAULTS.dailyTarget} USD/day, not a target this brand set`,
  };
}

module.exports = { DEFAULTS, forecastSend, forecastDay, requiredReach, requiredOrders, basisFor };
