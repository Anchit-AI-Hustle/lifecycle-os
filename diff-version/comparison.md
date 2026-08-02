# DIFF-VERSION comparison - the 3 Jul 2026 build vs the live app

Frozen snapshot: commit `2096289` (Merge PR #64), the close of the Friday 3 July 2026 Lifecycle OS V2 build.
This document compares the logic, approach and implementation of that day's creations against the rest of the app as it stands now, and records which learnings were carried forward. **The DIFF-VERSION files themselves are never edited** - every change described below was made to the live app, not to the frozen copy.

---

## 1. What the Friday build introduced

| Area | Friday artifact (frozen) | Live counterpart |
|---|---|---|
| Cohort calendar | `lifecycle-calendar.html` + `api/_shared/lifecycle-calendar-generate.js` | `/mailer-calendar` + evolved generator |
| Campaign hub | `uk-non-engagers.html` | `/uk-non-engagers` (live) |
| Social OS | `social-media.html` + `api/_shared/social-core.js` | `/social` + evolved engine |
| Cohorts + plays | `api/_shared/lifecycle-cohorts.js` | still the source of cohort/play defs |
| Mailer builder | `api/_shared/lifecycle-mailer-build.js` | same file, hardened (see below) |
| Product facts | `data/product-types.json` | unchanged, still canonical |
| Week-1 emails | 12 HTML in `lifecycle-campaigns/2026-07-03_week1/emails/` | header/footer-stripped live variants |
| Video cascade | `api/_shared/video-core.js` | tier-routed live cascade |

---

## 2. Logic and approach - side by side

### 2.1 Deterministic planning
- **Friday:** the planner used a `stableIndex` hash over `${date}_${cohort_key}` to rotate plays and products. No `Math.random()`, so the same inputs always produce the same plan.
- **Live:** the same discipline was extended into the V1 Plan Calendar asset picker (`pickAssetTypes` in `calendar-generate.js`) and is now the house rule for every generator.
- **Verdict:** carried forward. Determinism is the standard.

### 2.2 Persistence that never clobbers human work
- **Friday:** upsert guarded `WHERE status <> 'built'`, so a re-plan never overwrites a slot a human already built and approved.
- **Live:** same guard preserved in the live lifecycle persistence path.
- **Verdict:** carried forward.

### 2.3 Brand gates - one sanitizer, not many
- **Friday:** the mailer builder imported `sanitizeBrand()` / `assertNoBanned()` from `scenario-model.js` rather than re-declaring the banned-phrase list. One source of truth.
- **Live:** all generated copy (mailers, calendar-trigger, campaigns) routes through that single gate. It was then extended with two rules the Friday build did not yet have:
  - **no em/en dashes** - `scrubDashes()` folded into `sanitizeBrand()`.
  - **no founder voice** - enforced in briefs and verification.
- **Verdict:** carried forward and strengthened.

### 2.4 Token ceiling + JSON robustness
- **Friday:** `lifecycle-mailer-build.js` and `calendar-trigger.js` capped generation at ~1200 tokens, which truncated full-mailer JSON and produced "Could not parse JSON" failures.
- **Live:** ceilings raised to 3000, plus `repairTruncatedJSON()` in `llm.js` that closes open strings and balances brackets as a safety net.
- **Verdict:** carried forward. This was a genuine bug in the Friday approach, fixed live.

### 2.5 Model cascade
- **Friday:** a first tier-routed cascade (premium/standard/fast) across the provider waterfall.
- **Live:** extended in accuracy order with Ollama then Sakana tail rungs, and every LLM caller routed onto its blueprint tier. The Friday cascade was the seed; the live one is the full descending-accuracy chain.
- **Verdict:** carried forward and completed.

### 2.6 Separation of the two calendars
- **Friday:** deliberately kept the cohort-native lifecycle calendar separate from the V1 RFM Plan Calendar instead of merging them.
- **Live:** preserved. The two are the Draft 1 / Draft 2 pair documented in the Cohorts dashboard. Merging would have coupled two different planning models.
- **Verdict:** by design, held up.

### 2.7 Email document shape
- **Friday:** each email was a full HTML document with its own header and footer.
- **Live:** headers and footers stripped so the body pastes cleanly into Klaviyo templates (per the product owner's later instruction).
- **Verdict:** superseded live on purpose. The frozen emails keep the original full-document form as the record of the first approach.

---

## 3. Learnings NOT ported (and why)

- **Full-document email HTML** - intentionally not carried into the live program; Klaviyo templating wants body-only. Kept frozen as the original.
- **Lower token cap** - not carried; it was the cause of the JSON truncation bug.

---

## 4. Immutability contract

Everything under `diff-version/` is frozen at `2096289` and must not be edited. The live app is where behaviour changes land. This doc is the bridge between the two: it explains what the first day got right (most of it), what it got wrong (token cap), and what was a deliberate later change (email shape). When in doubt, read the frozen page and its live counterpart side by side from the DIFF-VERSION menu entry.
