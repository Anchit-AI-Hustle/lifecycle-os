# Calendar-generation logic: our app vs. the reference July studio

A side-by-side of how the **automated mailer calendar in this app** builds a plan
versus how the **attached `lifecycle-usa-july-calendar-mailer-studio.html`** (the
`assemble_v2.py` artifact) was produced. Both target the same output — a US July
cohort calendar with per-send mailers — but they sit at different points on the
"static artifact ↔ live system" spectrum.

## TL;DR
- **Reference HTML** = a *baked, offline-computed* artifact. All decisions (cohorts,
  suppression depth, ESP-vs-Klaviyo routing, discount codes, frequency guardrails,
  scenario cadence, and per-mailer ChatGPT/Gemini/Claude/Image prompts) were resolved
  once by a Python assembler and frozen into embedded `DAYS[]` JSON + inlined mailer HTML.
- **Our app** = a *live pipeline*. `lifecycle-calendar-generate.js` derives rows from
  cohort/play/product/festival models at request time, then `lifecycle-mailer-build.js`
  writes copy through the 6-provider LLM waterfall and renders the 4 variants; Smart
  Brain keeps a rolling 90-day plan with human approve/reject and asset prebuild.

## Field-by-field

| Concern | Reference HTML (`DAYS[]`) | Our app |
|---|---|---|
| **Unit of plan** | one `day` → N `mailers` (21 days, 33 mailers) | one calendar `entry`/`slot` → 4 variants (`lifecycle_calendar_entries`) |
| **Cohort selection** | pre-baked string per mailer (`cohort`, `objective`, `rationale`) | `lifecycle-cohorts.js` `COHORTS` × `PLAYS`, scored against product-types + festivals in `lifecycle-calendar-generate.js` |
| **Audience sizing / routing** | `sizeChip` + `tier` (`esp`\|`klaviyo`), `klaviyo` segment string, computed offline | routing is Phase-2 (`push_status: not_integrated_phase_2`); Klaviyo scaffold in `klaviyo-core.js` returns request stubs until keyed |
| **Suppression** | `suppress` + `depth` integer per day, precomputed | cohort eligibility rules (`eligibleSegments`) + Smart-Brain plan diffing |
| **Offers / codes** | `code` (SUMMER15, HELLO10…) + `rate` per mailer, hard-coded | **no invented codes** — `brandGatesBlock()` forbids new discounts; only real product facts/prices |
| **Cadence model** | scenario cards A/B/C, `setScn('C')` default | `scenario-model.js` (`SCENARIO_PROFILES`, `scaleCadence`, `projectMetrics`) — same C=executed framing |
| **Copy** | frozen `subject`/`preheader` + full `mailer` HTML string, authored once | live `llm()` call per variant (`writeCopy`), `sanitizeBrand`/`assertNoBanned` gates, framework-driven (`copy-frameworks.js`) |
| **Variants** | one `layout` per mailer (e.g. "Typographic · Violet") | **4 per slot**: `text_a` pure, `text_b` editorial, `visual_a`/`visual_b` visual (`renderTextVariant`) |
| **Imagery** | referenced inside the baked mailer HTML | resolved live from origin-validated `brand_assets` (this PR); placeholder when unverifiable, never fabricated |
| **LLM prompts** | per-mailer `prompts{ChatGPT,Gemini,Claude,Image}` embedded for hand-running | prompts are internal to the pipeline; `master-prompt.js` builds a portable prompt, but generation is executed, not copy-pasted |
| **Persistence / lifecycle** | none (static file) | Supabase rows, `status` transitions (`built`), Smart-Brain 90-day rolling plan, approve/reject, `prebuildAssets()` |
| **Events** | `EVENTS[]` baked | festival model (`data/festivals.json`, `seed-festivals*.js`) + event hooks woven into the brief |

## What each is better at
- **Reference HTML** — instantly shippable, fully deterministic, shows the *human-runnable*
  multi-LLM prompts and the ops layer (ESP/Klaviyo routing, codes, suppression depth,
  guardrails) in one page. Great as a plan-of-record and prompt cookbook.
- **Our app** — regenerates on demand from live cohort/product/festival data, enforces the
  brand gates in code, produces the canonical 4-variant set, and threads into Smart Brain's
  rolling plan + approval + asset prebuild. Great as the *system* that keeps producing plans.

## How this repo's July artifact maps onto the reference
`scripts/build-july-mailers.js` runs the app's **exact** 4-variant render + brand-scrub path
over an authored US-July `CALENDAR[]` (12 cohort sends), and `scripts/build-july-studio.js`
presents them in a studio that mirrors the reference's UX (scenario cards, shared numbers
analysis, per-send expand, live preview, download) — with a **Card ↔ List** toggle whose top
block (forecast + stats + scenarios) is identical across both views. The main deltas versus
the reference remain, by brand policy and current integration state: **no invented discount
codes**, and **ESP/Klaviyo routing stays Phase-2**.
