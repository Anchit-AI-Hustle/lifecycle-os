# KNICKGASM Lifecycle OS — Feature Quality Audit
**Date:** 2026-07-12 · **Bar for confidence:** every feature must reach **≥ 9.5 / 10**.
**Method:** 5 parallel deep code audits (/brain, /data-analysis, /studio, /ad-campaigns, /lp + /social) plus direct review of /assets, /kicksgpt, /agent, and the "Aman's version" (frozen 3 Jul 2026) build. Ratings are grounded in specific file:line findings, not impressions.

> How to read this: **Now** = today's state (after this session's fixes). **Ceiling** = the best this feature can reach without the shared blockers below. **To 9.5** = the concrete work to close the gap. A feature cannot exceed its ceiling until the systemic blockers are cleared.

## Update log (post-audit fixes shipped this session)
These landed AFTER the audit was first written and are reflected in the "Now" scores below:
- **/social** — code-level caption validators added (strip non-PDP URLs + supplement prices, flag medical claims, budget hashtags into the char cap). Prompt-only gate is now code-enforced. (6.5 → 7.5)
- **/ad-campaigns** — per-platform char-limit clamps enforced at save (Google 30/90, Meta 40/125, TikTok 100); the fabricated "65% OFF" default offer was already removed. The char-limit gap is **closed**. (6.5 → 7)
- **/lp** — the hardcoded 5-star trust bar, testimonial and guarantee are now routed through the B1 approved-facts gate (below). (7 → 7.5)
- **B1 infrastructure** — the approved-facts library + master gate now exists (`api/_shared/brand-facts.js`, `data/brand-facts/<region>.json`), shipping **dark** behind `REAL_FACTS_ONLY`. Flip the flag once the library is populated to make /lp (and, once wired, the rest) real-only. Data + flip still pending; `/studio` + flagship mailer wiring still to do.
- **Brand/other** — mailer + LP footers moved off near-black to deep purple (brand HARD rule); real-only product imagery, `/assets` real-mailer preview, `/kicksgpt`+`/agent` contrast, revenue-split + returning-rate corrections, fully-labeled Data Analysis charts, "Why this mail?" panel + rejected-slot recovery, the ad-calendar = Brain plan, low-rating review-recovery scheduling, and markdown→PDF downloads all shipped.

---

## 0. Three systemic blockers cap almost every feature

No feature reaches 9.5 while these are open, because they undermine *correctness* (the first-order quality axis):

| # | Blocker | What it breaks | Fix owner |
|---|---------|----------------|-----------|
| **B1** | **Fabricated facts** — invented reviews, ratings, reviewer names, testimonials, comparative/quant claims, and guessed prices are rendered into shipped mailers / LPs / ads | zero-fabrication contract violated across /studio, /brain, /lp, /ad-campaigns | **Build the approved-facts library** (reviews + claims + prices, keyed by SKU+region); render only from it, else omit + `[DATA REQUIRED]`. You chose this option. |
| **B2** | **Stale `SUPABASE_SERVICE_ROLE_KEY`** (HTTP 401 in prod) | dashboard counts, Created Assets rows, Brain persistence, KB all degrade to anon fallback | Rotate in Supabase → set in Vercel (Prod+Preview+Dev) → redeploy |
| **B3** | **Klaviyo / ESP + Shopify Admin feeds not wired** | real cohort sizes, open/click/conversion history, live stock/price all absent → confidence + frequency run on assumptions | Set `KLAVIYO_API_KEY` (read), add read-only Shopify token; adapters already scaffolded |

**Consequence:** the audited features currently sit at **5–7.5**. The *engineering* is largely 8–9 grade; the score is dragged down by B1–B3. Clear B1–B3 and most features jump to 9–9.5.

---

## 1. Scorecard

| Feature | Now | Ceiling once B1–B3 clear | Primary gap |
|---|:--:|:--:|---|
| `/brain` — Smart Brain calendar | 6.5 | 9.5 | B1 (fabricated reviews/claims), frequency cap enforced in code, reach from real counts |
| `/data-analysis` | 7.5 | 9.5 | Add MER/ROAS/LTV once ad+Shopify feeds land; partial-month heuristic; cohort labelling |
| `/studio` — Mailer Studio | 5 | 9.0 | B1 (reviews/prices), client-side brand-gate on the render path, palette allowlist |
| `/ad-campaigns` | 7 | 9.5 | char clamps DONE; B1 (claims) via the gate; URL builders already correct |
| `/lp/:id` landing pages | 7.5 | 9.5 | B1 gate wired (flag-off) — populate library + flip `REAL_FACTS_ONLY`; id handling safe |
| `/social` — Social OS | 7.5 | 9.5 | caption validators DONE (code-enforced); real-image + scrub already fixed |
| `/assets` | 7.5 | 9.5 | now renders real mailer; add ad/LP live previews + search facets |
| `/kicksgpt` | 7.5 | 9.5 | contrast fixed; add evidence-contract tests + tool-trace polish |
| `/agent` | 7 | 9.0 | contrast fixed; consolidate with KicksGPT or clarify distinct purpose |
| **Aman's version** (frozen) | 7 | n/a (frozen) | reference only — see §3 |
| **Not yet deep-audited** | — | — | /competitor, /kb, /cohorts, /landing-pages (builder), /avatars, /market-study, /master-dashboard, /retention-playbook, /frameworks, /connectors, /music — **recommend a second audit pass** |

*Ratings are honest current-state. I did not invent scores for features I have not audited at file:line depth.*

---

## 2. Per-feature: mistakes found → what reaches 9.5

### `/brain` — Smart Brain automatic calendar — **6.5**
Solid engineering (bounded prebuild queue, deterministic ids, idempotent resume, no runaway/billing risk; real-image pivot confirmed — no diffusion path for product shots). Held down by:
- **B1** — `brain-generate.js` `fallbackCopy` and the copy schema emit invented testimonials ("Sarah, Austin"), competitor claims, "1M+ pairs poured", "≈50 pairs/box". → source from approved library or omit.
- **Frequency cap is documented, not enforced** (`services.js`): 2/3-per-rolling-7-days lives in comments; no per-profile cross-cohort counter → a profile in overlapping cohorts can be over-mailed. → add a plan-time per-profile 7-day counter; reduce/delay/block.
- **Invented reach** — `planned_recipients` hardcodes 20k/30k regardless of real eligible base. → derive from real counts (needs B3).
- **Fixed this session:** image dedup regression, "Why this mail?" panel, rejected-slot recovery, quieter pipeline, prebuild double-run noted.
- **To 9.5:** B1 + frequency engine + real reach.

### `/data-analysis` — **7.5** (highest today)
Genuinely real-data-only, honestly gates unavailable metrics, decomposition now reconciles to real revenue, returning-rate comparable across markets, charts fully labeled (this session).
- Remaining: partial-month drop is a `<45%` revenue heuristic (can hide a real seasonal low) → gate on an actual as-of/day-count; cohort heatmap Q0 is trivially 100% → label per-quarter repeat vs cumulative; add MER/ROAS/LTV/CAC once ad+Shopify feeds land (B3).
- **To 9.5:** completeness-based partial-month gate + the acquisition-economics widgets once B3 lands.

### `/studio` — Mailer Studio — **5** (lowest)
Excellent plumbing (cascade fallthrough, key rotation, OpenAI-400 quota detection, A/B archetype-family divergence). Disqualifying correctness gaps:
- **B1** — invents reviewer names, testimonial quotes, `4.8/50,000+ reviews`, and **guesses prices** (name-heuristic FX) with fake SAVE badges when catalog price is missing.
- **Brand gates run only on LLM text, not the deterministic render path** — "LIMITED TIME ONLY" and em/en-dashes leak into shipped copy. → port `sanitizeBrand`/`scrubDashes` to the client render step.
- **Palette check is a 6-item denylist** → make it a 4-colour allowlist.
- **`design` image mode** bakes a full email (garbled text/price/reviews) into the hero → restrict to text-free photography.
- **To 9.0:** B1 + client brand-gate + palette allowlist + drop design-mode hero.

### `/ad-campaigns` — **6.5**
Ad-library URLs for Google / Meta / TikTok verified correct (TikTok fix confirmed); text-free-image + native-copy architecture correct.
- **Fixed this session:** hardcoded "65% OFF" fabricated offer removed + pill skipped when no real offer.
- Remaining: **char limits are advisory only** in the interactive builder → clamp on save/autofill (Google 30/90, Meta 40/125, TikTok ~100); `ad-creative.js` hardcodes "Free US shipping over $59" market-agnostic → parameterise + source from approved facts (B1).
- **To 9.5:** char clamps + claim sourcing.

### `/lp/:id` landing pages — **7**
Robust: unknown/garbage ids 404 cleanly, no injection, images real-catalog-only, links region-correct PDPs, copy brand-scrubbed at build.
- Remaining: **B1** — every LP hardcodes a 5-star trust bar, "– A KNICKGASM regular" proof, and a guarantee claim not sourced from an approved library; add the CORS header on the `lp` branch; `?v=b` fallback should use `lps[0]`.
- **To 9.5:** B1 gating of the trust/proof/guarantee blocks.

### `/social` — Social OS — **6.5**
Excellent pipeline hygiene (single bounded run, full fallbacks, no fan-out, honest degradation, no XSS).
- **Fixed this session:** diffused fake-box hero → real catalog photo; scrub no longer flattens blog/caption paragraphs.
- Remaining: caption/blog claim gates are **prompt-only** → add code validators (no invented price/discount, no medical claim, PDP-only URLs); hashtags not budgeted into char limit; hardcoded "best time UTC" reads as data.
- **To 9.5:** code-level content validators + honest labelling.

### `/assets` — **7.5** · `/kicksgpt` — **7.5** · `/agent` — **7**
All three had their reported bugs fixed this session (assets showed a product image instead of the mailer → now renders the real mailer; kicksgpt + agent white-on-white → contrast fixed).
- **To 9.5:** /assets — add live ad + LP previews and search facets; /kicksgpt — evidence-contract regression tests; /agent — consolidate with KicksGPT or state a distinct purpose (two chat assistants is confusing).

### Not yet deep-audited — **recommend a second pass**
`/competitor`, `/kb`, `/cohorts`, `/landing-pages` (builder), `/avatars`, `/market-study`, `/master-dashboard`, `/retention-playbook`, `/frameworks`, `/connectors`, `/music`. I have not rated these at file:line depth and will not guess. A second audit sweep should cover them before you can claim the whole app is ≥9.5.

---

## 3. "Aman's version" (frozen 3 Jul 2026) vs the current version

"Aman's version" (a.k.a. "Aman's code") = the frozen `diff-version/` snapshot at commit `2096289`, now **hidden from the LHS menu but kept in code** (reachable at `/diff-version`; uncomment two lines in `auth.js` to restore the menu entry).

| Dimension | Aman's version (frozen) | Current version | Winner |
|---|---|---|---|
| **Planning logic** | Deterministic `stableIndex` hash; no `Math.random()` | Same discipline, extended to every generator | Tie (current carried it forward) |
| **Persistence** | Upsert guarded `status<>'built'` | Same guard preserved | Tie |
| **Brand gate** | Single `sanitizeBrand` (good), but **no dash scrub, no founder-voice rule** | Same gate + `scrubDashes` + founder-voice + deep-scrub every string | **Current** |
| **Token / JSON** | ~1200-token cap → truncated JSON, parse failures (a real bug) | 3000 + `repairTruncatedJSON` | **Current** |
| **Theme** | Correct 4 colours + Montserrat / Instrument Sans | Same, enforced harder | Tie |
| **Content** | Strong, story-driven editorial copy (genuinely excellent voice) | Same voice + A/B framework divergence | Tie (Aman's copy quality is high) |
| **Email shape** | Full HTML document w/ header+footer | Body-only for Klaviyo paste | Current (per your later instruction) — Aman's is the original record |
| **Assets / imagery** | **Hero = paste-URL placeholder + a generation prompt** (relies on a generated image; carries em-dashes in copy) | **Real Shopify catalog pack-shots only, HD, distinct; no diffusion for product** | **Current** |
| **Reviews / claims** | Present in the era's approach (unverified) | Still a gap (B1) — but flagged and being closed | Tie (both need the library) |

**Ratings:** Aman's version **7/10** — outstanding copy voice and clean deterministic foundations, but a real token-cap bug, no dash/founder gates, and placeholder/generated hero imagery. Current version **on logic + theme + assets = 8.5/10 today** (9.5 once B1 lands) — it carried forward everything Aman's got right and fixed what it got wrong, most importantly the move to **real-only product imagery**.

**Verdict:** the current version is strictly ahead on logic, gates, and asset authenticity; Aman's version remains the better *reference for copy voice* and is worth keeping frozen for exactly that. The comparison doc lives at `diff-version/comparison.md`.

---

## 4. Prioritised roadmap to get every feature ≥ 9.5

1. **B2 — rotate `SUPABASE_SERVICE_ROLE_KEY`** (5 min, unblocks persistence everywhere).
2. **B1 — approved-facts library** (reviews + claims + prices by SKU+region). Single highest-value correctness fix; lifts /studio, /brain, /lp, /ad-campaigns together. *Needs your approved data.*
3. **B3 — wire Klaviyo (read) + read-only Shopify token** → real cohort sizes, send history, live stock → calibrates confidence + frequency and unlocks MER/ROAS/LTV in /data-analysis.
4. **Frequency engine** in /brain (per-profile rolling-7-day counter).
5. **Client brand-gate + palette allowlist** in /studio; **char-limit clamps** in /ad-campaigns; **caption validators** in /social.
6. **Second audit pass** over the 11 not-yet-audited features.

Once 1–5 land, the audited features move to 9–9.5. Step 6 is required before you can state the *whole* app clears the bar.
