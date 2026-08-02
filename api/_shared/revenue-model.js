'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// revenue-model.js — deterministic email revenue math for the agentic calendar
// (correction module §3-§4). Turns cohort audience + conversion + AOV into
// per-send and per-DAY forecasts, and assigns an honest feasibility state
// against a daily target (default $1500). Never manipulates assumptions to pass.
//
// Pure + testable. Not a function file (under api/_shared/).
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  dailyTarget: 1500,   // USD attributed email revenue
  aov: 42.5,           // stated AOV band $42-$43
  clickRate: 0.015,    // unique click rate on delivered (1-2% band → mid 1.5%)
  closeRate: 0.03,     // click → purchase
};

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
  };
}

module.exports = { DEFAULTS, forecastSend, forecastDay, requiredReach, requiredOrders };
