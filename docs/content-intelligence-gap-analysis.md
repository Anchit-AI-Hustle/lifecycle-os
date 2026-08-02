# Our execution vs. the ChatGPT "Content Intelligence" framework

A gap analysis of what this repo does today against the proposed master-prompt module
(Daily Blog Agent + KNICKGASM Creator Plan + Social Media Post Generator + content
orchestration). Status legend: ✅ done · 🟡 partial · ⬜ not built.

> **[DATA REQUIRED: EXPORT DAILY BLOG AGENT AND KNICKGASM CREATOR PLAN CHATGPT CONVERSATIONS INTO THE PROJECT REPOSITORY]**
> The framework's Section 1 requires importing two existing ChatGPT conversations. Neither
> is present — `knowledge/agents/daily-blog-agent/` and `knowledge/agents/knickgasm-creator-plan/`
> do not exist, and no matching files were found. Per the framework's own rule, the historical
> workflows are **not imported**; we can build the generic feature framework but must not claim
> those requirements were reconciled.

## Where we already align (the shared foundations the framework assumes)

| Framework requirement | Our execution | Status |
|---|---|---|
| Shared verified product/region data; no fabricated facts | `data/catalog/products_*.json` (built from real exports) + `brand_assets` origin-validation; renderers embed only hosted, verified URLs | ✅ |
| Approved-asset governance, no invented URLs | `api/_shared/brand-assets-core.js` (allowlist prefix-match, placeholder when unverifiable) | ✅ |
| Brand/compliance gates (palette, banned phrases, no em/en dashes) | `scenario-model.js` `sanitizeBrand`/`assertNoBanned`, enforced on every generated string | ✅ |
| Campaign calendar as the spine | `data/calendar/usa-july-2026.json` + the automated lifecycle calendar (`lifecycle-calendar-generate.js`) + Smart Brain 90-day plan | ✅ |
| Cross-channel packaging from one campaign idea | July build: one scrubbed copy set per send → **mailer (4 variants) + ad set (Meta/Google/TikTok) + landing page**, shared hero/facts | 🟡 (mailers/ads/LP done; blog/social not yet) |
| Region-correct store URLs + product facts | US store `knickgasm.com`, real prices/handles/design notes | ✅ |
| Honest publishing state (never claim a live push) | Ads/LP are previews; mailer push stays Phase-2 (`push_status: not_integrated_phase_2`); Klaviyo scaffolded as request-stubs | ✅ |

## Section-by-section gap

| Framework section | Status | Notes |
|---|---|---|
| 1. Import ChatGPT workflows | ⬜ | Exports absent → flagged above. Need the two `conversation.md`/`requirements.md`. |
| 2. Workflow config model (`ImportedAgentSource`, `*Config`) | ⬜ | No typed config layer yet. Repo is JS/serverless, not TS/React — types would land as JSON config + validators. |
| 3. Shared `ContentCampaignRecord` | 🟡 | We have per-slot campaign records in the calendar manifest + Smart Brain entries, but not the exact unified `ContentCampaignRecord` shape spanning blog/creator/social. |
| 4. Daily Blog Agent (Shopify `body_html`, SEO, media package, adapter) | ⬜ | Not built. No blog generator, no Shopify publishing adapter. |
| 5. KNICKGASM Creator Plan (TikTok US/UK, Reels, full video prompts, exhausted-pattern control) | 🟡 | Ad-creative gives TikTok/Meta/Google previews + copy, but not the full daily creator slate, timestamped scripts, or the exhausted-pattern registry. |
| 6. Social Media Post Generator (10 channels, per-channel copy, hashtag/char validation, previews, publish workflow) | 🟡 | We generate Meta/Google/TikTok ad copy; not IG carousel/stories/Pinterest/LinkedIn/X/YouTube, no hashtag/character validators, no per-channel preview frames. |
| 7. Content repurposing engine | 🟡 | July build repurposes one copy set into mailer+ad+LP (adapted, not duplicated). Blog→social chain not built. |
| 8. Content calendar integration (all content types + readiness columns) | 🟡 | Calendar covers email/ads/LP; blog + the 9 social channels + readiness/approval columns not yet. |
| 9. Components/services (React `components/`, `lib/`) | ⬜ | Repo is standalone HTML + serverless `_shared`, not a React tree — would map to new `_shared` cores + static pages, not `.tsx`. |
| 10. Mandatory tests | 🟡 | CI runs HTML smoke + JS syntax + function-count + Playwright; no content-specific test suite (Shopify HTML validity, hashtag rules, carousel consistency, etc.). |
| 11. Feature validation | 🟡 | Brand/compliance validation exists for mailers/ads/LP (palette, dashes, hosted images); blog/creator/social validations not built. |
| 12. Final delivery status | — | Current honest status: **CONTENT SYSTEM PARTIAL — IMPORTED CHAT REQUIREMENTS MISSING** (foundations + mailer/ad/LP done; blog/creator/social + ChatGPT imports outstanding). |
| Dashboard nav "Content Intelligence" tree | ⬜ | Not added to `auth.js` nav yet. |

## Deliberate divergences (brand/policy, not gaps to "fix")
- **No invented discount codes.** The reference 21-day studio bakes in `SUMMER15`/`HELLO10`; our brand gates forbid fabricated codes, so our ads/LPs omit them until real codes are supplied.
- **Ink (`#111111`) footer/hero.** The framework says "no black/ink section backgrounds"; our brand palette explicitly includes ink `#111111` and uses it for footers. Kept as brand-correct; can be swapped to green/chalk if you want to honor the framework rule literally.
- **JS/serverless, not TS/React.** The framework's `components/*.tsx` + `lib/*.ts` map onto this repo as `api/_shared/*` cores + standalone HTML pages (the established architecture), not a React component tree.

## Recommended next phase (if you want to close the gaps)
1. Drop the two ChatGPT exports into `knowledge/agents/**` → parse into a JSON config layer (Section 2).
2. Build `api/_shared/content-core.js` (shared `ContentCampaignRecord`) + a Daily Blog Agent core emitting validated Shopify `body_html` + media-package prompts.
3. Extend the ad/creator layer to a full Creator Plan (timestamped scripts, exhausted-pattern registry) and a Social Post Generator across the 10 channels with hashtag/character validators and per-channel previews.
4. Add the "Content Intelligence" nav group to `auth.js` and the content-specific tests to CI.

Each is its own PR-sized unit; none should be claimed done without the ChatGPT imports and real per-channel validation.
