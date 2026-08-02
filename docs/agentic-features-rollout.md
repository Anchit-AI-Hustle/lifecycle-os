# Agentic Features — Audit & Rollout

**Date:** 2026-07-18

Goal: every feature of the Lifecycle OS uses a single- or multi-agent implementation where it is relevant and improves the output. This documents the current state, the shared backbone, what shipped in this pass, and the queued increments.

## The shared backbone — `api/_shared/feature-agent.js`

One reusable, cap-free module (adds zero serverless functions) so features get agentic behavior from a **config**, not new code. It generalizes three patterns already in the repo (`quality-loop.js` critique→revise, `output-reasoning.js` grounding, `brand-llm.js` evidence contract). Two roles:

- **`analyst`** — read-only. Turns already-computed metrics into grounded insights, ranked hypotheses, target metric + expected impact. Every claim must quote an input figure (no invented numbers). Caveat-aware.
- **`critic`** — scores content against a passed rubric and, if below threshold, runs ONE bounded, time-boxed revision. Fully fail-soft. Ready-made rubrics: `RUBRICS.ad`, `RUBRICS.landing_page`.

Everything routes through the shared `llm.js` 6-provider cascade and fails soft: on any timeout/provider/parse error the caller's request still succeeds with the original input.

## Function-cap reality

`vercel.json functions` = exactly **12 = the Hobby cap, zero headroom**. Every agent addition routes through an existing `?action=` router (`brain.js`, `competitor.js`, `kb.js`, `public-config.js`) or a new `_shared/` module. No new top-level `api/*.js`.

## Feature map

| Feature (route) | Current agentic | Relevant | Status |
|---|---|---|---|
| Data Analysis / RFM (`/analytics`) | was deterministic | yes (high) | **Shipped** — analyst agent via `brain.js ?action=analysis-narrative`, caveat-aware. |
| Data-accuracy validation (`/usa-d2c-dashboard`) | none | yes (high) | **Shipped** — real-time validator `?action=validate-data`, live on the dashboard. |
| KicksGPT (`/kicksgpt`) | tool-calling loop | complete | **Shipped** — new tools `validate_data_accuracy`, `analyst_insights` registered. |
| Mailer Calendar V2 (`/mailer-calendar`) | single call | yes (med) | **Shipped** — critic parity in `lifecycle-mailer-build.js` (score→one revise). |
| Mailer Studio (`/studio`) | multi-agent pipeline + `quality-loop.js` | strong | Existing; add brand-compliance critic dimension (queued). |
| Ad Campaigns (`/ads`) | single call, no QA | yes (high) | **Queued** — wire `runCritic` + `RUBRICS.ad` into `brain-generate.js` (paid spend, highest ROI). |
| Landing Pages (`/lp/:id`) | single call | yes (med-high) | **Queued** — `runCritic` + `RUBRICS.landing_page`. |
| Competitor (`/competitor`) | per-item enrich | yes (med) | **Queued** — `ci-brief` strategist in `competitor.js`. |
| Cohort Definitions / Avatars | none | yes (med) | **Queued** — analyst-role cohort-discovery / persona-synthesis. |
| Knowledge Base (`/kb`) | single call | partial | Queued (optional) — pattern-extraction agent. |
| Smart Brain (`/brain`), Social OS (`/social`), Knickgasm Agent (`/agent`) | multi-agent | complete | No change needed. |
| Research / Playbook (static) | none | no | Out of scope (one-time artifacts). |

## Shipped in this pass

1. Real-time **data-accuracy validation agent** + live dashboard (`data-validation-core.js`, `public-config.js`, dashboard).
2. Shared **`feature-agent.js`** backbone (analyst + critic).
3. **Analyst agent** on `/analytics` (`brain.js ?action=analysis-narrative`) — grounded, caveat-aware.
4. **Mailer Calendar V2 critic parity** (`lifecycle-mailer-build.js`).
5. **KicksGPT tools**: `validate_data_accuracy`, `analyst_insights`.

## Queued increments (backbone ready, wire per-feature with verification)

Priority by impact ÷ effort: (1) Ads QA critic, (2) Landing-page conversion critic, (3) Competitive strategist brief, (4) Cohort-discovery + persona-synthesis (thin analyst configs), (5) brand-compliance critic dimension shared across studio/ads/LP. Each is a small, fail-soft wiring of `feature-agent.js`; they touch live generation paths, so each should be added and verified individually rather than in one sweep.
