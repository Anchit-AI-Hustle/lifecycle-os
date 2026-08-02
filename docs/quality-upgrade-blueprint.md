# AI Quality Upgrade Blueprint — July 2026
Repo-wide upgrade of every AI-powered feature EXCEPT the finished lifecycle mailer-calendar system (`api/_shared/lifecycle-*`, `lifecycle-calendar.html`, `uk-non-engagers.html` — do not touch).

## Why
The audit (2026-07-03) found the AI engines running on stale/dead rungs and no live quality loop:
- `llm.js` Anthropic budget rung `claude-3-5-haiku-20241022` **retired Feb 2026 → 404s silently**; Groq rung `mixtral-8x7b-32768` **decommissioned**; Grok on 3-series; OpenAI on 4o-series.
- `api/ai/generate.js` re-implements the 6-provider cascade inline (drifting duplicate of `llm.js`).
- `pipeline/score.js` — a complete 4-dimension critique/revise loop (threshold 7/10) — is **dead code**: nothing calls it. No verify pass runs anywhere in production.
- `pipeline/images.js` + `.env.example` still reference a `gpt-image-2` default that was "de-bogused" in `image.js` but never propagated; `pipeline/strategy.js` prompt hardcodes it.
- `calendar-trigger.js` runs copy on the cheapest tier and never actually generates an image despite advertising a "visual" variant.
- No video generation exists anywhere.
- `GROQ_API_KEY`/`CEREBRAS_API_KEY` used in code, missing from `.env.example`.

## Model research (verified 2026-07-03; official docs where reachable)
- **Text**: OpenAI `gpt-5.5` / `gpt-5-mini` / `gpt-5-nano`; Anthropic `claude-opus-4-8` / `claude-sonnet-5` / `claude-haiku-4-5`; Gemini `gemini-3.1-pro` / `gemini-3.5-flash` / free floor `gemini-2.5-flash`; xAI `grok-4.3` / `grok-4.1-fast`; Groq+Cerebras free floor `openai/gpt-oss-120b`, `llama-3.3-70b`.
- **Image**: `gpt-image-2` (best instruction-following; auto-demote to `gpt-image-1` if the account 404s it) → `gemini-3-pro-image-preview` (Nano Banana Pro) → `imagen-4.0-*` → `gemini-2.5-flash-image` (free ~500/day) → Pollinations flux (free floor). Ideogram 3 optional for text-in-image banners (`IDEOGRAM_API_KEY`).
- **Video** (new capability): Veo 3.1 `veo-3.1-generate-preview` via Gemini API (reuses `GEMINI_API_KEY`, paid tier) → Sora 2 `sora-2` (OpenAI; note API sunset 2026-09-24) → Higgsfield Cloud REST ($0.10/s, `HIGGSFIELD_API_KEY`, paid plans) → Runway Gen-4 Turbo ($0.05/s floor, `RUNWAY_API_KEY`). **OpenArt has no public API — excluded.** All video rungs stub gracefully (`{connected:false, would_request}` — Klaviyo pattern) until keys exist.
- **Demotion rules** (all cascades): HTTP 429/402/5xx, timeout, or 400 whose body matches `insufficient_quota|quota|billing|credit|balance` (plain 400 = request bug, do NOT demote). Model-not-found (404/400 model error) demotes within-provider first.

## Task tiers (replace budget/maxpower semantics, back-compat preserved)
| Tier | Use | Text entry chain |
|---|---|---|
| `premium` (legacy `maxpower`) | hero copy, mailer_full, KicksGPT, smart-brain copy, strategist narratives | claude-opus-4-8 → gpt-5.5 → claude-sonnet-5 → gemini-3.1-pro → grok-4.3 → fast chain |
| `standard` (legacy `budget`/default) | variants, briefs, calendars, autofill | claude-sonnet-5 → gpt-5-mini → gemini-3.5-flash → grok-4.1-fast → fast chain |
| `fast` (new) | classification, tagging, scoring | claude-haiku-4-5 → gpt-5-nano → gemini-2.5-flash (free) → groq gpt-oss-120b → cerebras gpt-oss-120b |
All IDs env-overridable via existing `*_TEXT_MODEL(_MAX)` vars + new `*_TEXT_MODEL_FAST`.

## Phases
- **B — engines**: rewrite model tables + tier routing in `llm.js`; image cascade reorder + gpt-image-2-with-demotion in `api/ai/image.js`; propagate to `pipeline/images.js` + `pipeline/strategy.js` prompt; NEW `api/_shared/video-core.js` (cascade + poll + stubs) exposed as `?action=video-generate|video-status` on an existing router; `.env.example` completed.
- **C — agentic loops at callers**: `generate.js` de-duplicated onto `llm.js` + one bounded critique→revise pass (reusing `pipeline/score.js` logic in-process, time-boxed, skip-on-timeout) for `mailer_full`; `calendar-trigger.js` → premium tier + real hero image via `creative-image.js`; tier assignments everywhere (KicksGPT/smart-brain copy → premium; kb-ingest/competitor benchmarks → fast).
- **D — verification**: `node --check` all touched files; handler smoke tests with mock req/res (no network); `npm run build`; function count unchanged (12-cap); PR.

## Constraints
Vercel Hobby: 12 function cap (no new `api/*.js` files — extend routers), 90s maxDuration (loops bounded to ONE revision, time-boxed), no new keys assumed present (everything degrades gracefully).
