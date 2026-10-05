# Revenue OS Operating Contract

## Why this exists

Lifecycle OS already has strong platform-specific analysts, content generation, publishing, landing-page intelligence, lifecycle tooling, analytics, and an action-outcome ledger. The missing layer was a commercial control loop.

A content factory optimises output. A Revenue OS optimises **measured business impact**.

The governing loop is:

```
Demand -> Idea -> Content -> Distribution -> Engagement -> Lead
       -> Conversion -> Revenue -> Attribution -> Learning -> Next Decision
```

The system must not collapse this into "idea -> draft -> CTA -> schedule". Production is only the middle of the loop.

## Eight roles

1. **Market Intelligence** — demand, competitors, audience questions, source readiness.
2. **Revenue Strategist** — offers, hypotheses, prioritisation, economic trade-offs.
3. **Creative Production** — hooks, scripts, mailers, ads, landing pages, variants.
4. **Distribution** — channel choice, scheduling, publishing, repurposing.
5. **Conversion** — CTA, offer, checkout, lead capture and landing-page improvement.
6. **Conversation & Support** — questions, objections, comments and support-derived insight.
7. **Measurement** — attribution, experiments, realised impact and guardrails.
8. **Growth Controller** — one ranked queue, stop/scale decisions, learning and approvals.

These are operating responsibilities, not eight independent agents that all call an LLM. Existing source-specific agents remain the evidence producers. The controller is deterministic wherever possible.

## North star

Primary:

**Realised incremental revenue / measured action cost**

Supporting metrics may include conversion rate, CAC, ROAS, CTR, opens, clicks, comments, views and reach, but these are not promoted to the north star merely because revenue attribution is missing.

Unknown remains unknown.

## Evidence contract

Revenue OS may rank an action only when it came from a grounded upstream agent or an explicit operator input.

It must never:

- invent a revenue forecast to fill a missing value;
- treat platform-attributed revenue as incremental revenue automatically;
- convert missing attribution into zero revenue;
- treat views or engagement as business impact;
- learn from an action that has no measured outcome;
- hide disconnected sources.

Historical outcomes may alter priority only after measurement. Small samples remain labelled as weak evidence.

## Recommendation -> outcome loop

Each recommendation receives a stable `action_id`.

The same id is used in `analytics_action_outcomes` to record:

- recommendation;
- approval;
- launch;
- baseline;
- observed result;
- incremental revenue;
- cost;
- realised ROI;
- experiment id;
- guardrail breach;
- rollback.

The controller reads those rows on the next run and updates its priors.

This is the core loop:

```
Evidence
  -> Recommendation
  -> Human approval where required
  -> Execution
  -> Measurement
  -> Outcome ledger
  -> Learned prior
  -> Next recommendation
```

## Approval policy

Analysis and ranking may run autonomously.

Explicit human approval remains required for actions that change external state, including:

- publishing or sending;
- media spend, bids or budgets;
- pricing, discounts or offers;
- customer-facing replies;
- account connections;
- destructive actions;
- claims or compliance-sensitive copy.

The system should be highly autonomous in deciding what deserves attention, but conservative about irreversible execution.

## Scoring contract

The controller score is deterministic. Inputs are:

- upstream priority;
- effort;
- whether a target metric exists;
- measured historical win rate when enough evidence exists;
- realised ROI when measured;
- guardrail-breach history;
- rollback history.

The score is **not a predicted revenue number**.

## API

### Run

```
GET /api/brain?action=revenue-os
```

Optional parameters:

- `market`
- `days`
- `hours`
- `since`
- `until`
- `question`
- `tier`
- `platforms`

The response contains the operating loop, role workload, source coverage, learned priors, measurement contract and ranked opportunity queue.

### Track outcome

```
POST /api/brain?action=revenue-os
Content-Type: application/json

{
  "op": "track",
  "action_id": "rev_0123456789abcdef",
  "status": "measured",
  "platform_id": "meta",
  "role_owner": "conversion",
  "baseline_metric": "conversion_rate",
  "baseline_value": 0.021,
  "observed_value": 0.026,
  "incremental_revenue": 4200,
  "cost": 1200,
  "guardrail_breach": false
}
```

Writes are workspace-scoped through `supa.js`; the caller cannot choose another workspace.

## Commercial principle

Do not sell "AI agents making content".

The valuable promise is:

> Lifecycle OS continuously finds, creates, distributes, measures and improves the work most likely to produce measurable business impact.

Service, productised implementation and SaaS can all sit on top of this same operating contract.
