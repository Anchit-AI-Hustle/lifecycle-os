# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Lifecycle OS — Project Memory

## ⭐⭐ It is now a UNIVERSAL brand platform (2026-08-09) — read `docs/universal-brand-platform.md`
This is no longer a single-brand app. Any signed-in user onboards their own brand and the whole app
runs as that brand for them. Three layers, none of which added a serverless function (still 12/12 —
all logic in `api/_shared/`, mounted via `?action=` on `public-config.js` / `brain.js`):
- **Brand layer** — `/onboarding` is the FIRST SCREEN (brand data → colour schema → typography →
  voice → catalog → activate). `brand_workspaces` + `brand_user_prefs.active_workspace_id` (per
  user, RLS-private). `brand-context.js` writes `--brand-*` tokens onto `<html>`; **`theme.css`
  resolves every colour/font through them**, so all pages re-skin at once — never hardcode a brand
  colour or font in a new page, always go through the `--vh-*` / `--brand-*` tokens.
  `validatePalette()` BLOCKS activation on dark-neutral surfaces or sub-AA contrast.
  KNICKGASM is now just tenant zero (`data/brands/_default.json`).
  - **Read the brand off its own site** — `_shared/brand-extract.js` on `?op=extract` (still 12/12)
    extracts name, tagline, logo, palette, typography, observed voice, verbatim claims, social,
    legal entity and regions from the URL pasted on step 1. It rides the SAME crawl as the catalogue
    importer (`site-crawl.js` gained optional `onPage` + `rank` hooks) so there is one set of scope,
    robots and SSRF rules. **Every value is a CANDIDATE carrying its source URL and signal; nothing
    is applied until the operator presses Use**, and a field the site did not publish comes back as
    a `[DATA REQUIRED BEFORE LAUNCH: ...]` marker. Colours are never pooled by frequency: sightings
    are split into `identity` / `action` / `surface` / `ink` / `support` roles, `proposed.primary`
    comes ONLY from an identity signal (theme-color, manifest `theme_color`, a `--brand-*` token),
    and an identity-vs-action disagreement is reported as a conflict rather than resolved. No
    browser is available, so this is CSS/HTML parsing and its blind spots are returned in `limits[]`.
  - **The brand CONTEXT PACK** — `_shared/brand-context-pack.js` on `?op=context-*` (still 12/12),
    table `brand_context_packs`. One durable record per brand, built from its own URL and kept as its
    standing context: a **DESIGN.md** in the open `google-labs-code/design.md` format (Apache-2.0,
    version `alpha` — conform to it, do NOT invent a shape), a knowledge base from that domain ONLY
    (verbatim: each page's own declared description and headings, no LLM paraphrase — a paraphrase of
    a brand fact is a new brand fact nobody approved), the catalogue via the existing `importCatalog`,
    and a GitHub repo search. **Keyed to URL AND name** (`brand_key = <host>|<folded name>`, unique
    per workspace): re-running updates, lookalike names cannot collide, and a domain/name change
    starts a new pack instead of overwriting a report about a different site.
    - **DESIGN.md rules**: front matter `version/name/description/omitted/colors/typography/rounded/
      spacing`; the 8 spec sections in order, each exactly ONCE (a duplicate heading rejects the file).
      The spec's `omitted` key IS our zero-fabrication rule — an unpublished section is declared
      omitted *with a reason*, never filled. `primary` comes ONLY from an identity signal; `secondary`
      only when the action colour genuinely differs; **never promote a frequency-ranked colour**. Text
      tokens are the `readableAsText()`-adjusted values against the worst-case surface using
      `core.TEXT_AA` (never a raw brand colour as text), and every adjustment is printed with ratios.
    - **User data wins, structurally**: `brand_field_provenance` + the `brand_context_apply()` SQL
      function is the ONLY door an automatic value may come through, and it refuses any field whose
      origin is `user` — in the database, not in call order. `saveWorkspace()` calls
      `brand_fields_claim_user()` with the fields the operator actually sent. `voice.banned` can never
      be machine-filled.
    - **Only the exact correct option** (2026-08-13): `secondary` is emitted ONLY when
      `sources.accent.from_role === 'action'` — proposePalette's support-colour fallback is fine for a
      wizard where a human confirms and wrong for a token consumed without one. `sources.<role>` now
      carries `confidence` / `from_role` / `ranked_not_declared` (the wizard was hardcoding
      `'declared'` on every role). Typography emits only `declared`/`strong` candidates: **a family
      the page LOADS is not one it USES**, and a link-only candidate can otherwise fill an empty slot
      and become `[0]`. `site-crawl` now re-checks scope on the URL that ANSWERED — an in-scope path
      that 301s off-origin had its body ingested. Derived tokens (`on-primary`, `*-text`, adjusted
      `neutral`) are labelled `DERIVED from <input>`. `design.selection` records per field the value,
      signal, source URL, `rank_taken` of `candidates_considered` and `chosen_by`, and `applyPack()`
      marks an `operator-override` naming what the pack ranked first.
    - **GitHub degrades honestly**: `searched:false` (could not reach GitHub) is NEVER reported as
      "no repositories". A repo is the brand's only on evidence independent of its name (the site
      links to that owner, or the repo `homepage` is on the brand's domain); a name match is
      `unverified` and never counted.
    - Long work is a **convergent queue on the pack row** (`stage` + `queue_state`, self-firing via
      `op=context-step`), same pattern as `smart-brain-plan.js prebuildAssets()`.
- **Credits** — every feature costs credits. `api/_shared/credit-catalog.js` is the single source of
  truth for prices; **a feature key missing from it throws rather than running free**. Spend via
  `credits.meter()` hold → settle/release so a failed run is always refunded. The balance-moving SQL
  functions are REVOKEd from `authenticated` (service-role only). Live balance via Supabase Realtime.
  Mark any new UI action with `data-credit-feature="<key>"` and `credits.js` labels it automatically.
- **TeleSuite** — `/telesuite`, all 23 subfeatures of the AI-TeleSuite repo, rendered entirely from
  the `SUBFEATURES` registry in `_shared/telesuite-core.js`. Every dashboard is a filtered view of
  the one `telesuite_runs` table (shared source of truth), not its own store.
- **Connections + AI models** — `/connections` (and `/ai-models`), `brand-connections.html`, served by
  `_shared/workspace-connections-core.js` on `public-config.js?action=connections` (still 12/12
  functions). A workspace brings its OWN platform credentials and its OWN AI keys, and picks the
  provider/model PRIORITY ORDER that replaces the default cascade in `llm.js`. A workspace with
  nothing connected behaves exactly as before. Registry of connectable platforms is `PROVIDERS` in
  that module; a platform whose sign-in flow is not established carries a
  `[DATA REQUIRED BEFORE LAUNCH: ...]` marker instead of a fake OAuth button. **Never add a base URL,
  model id or auth flow there that this repo does not already call.**
  - **Secrets** live in `workspace_connection_secrets`, AES-256-GCM ciphertext under
    `CONNECTION_SECRET_KEY`. That table has RLS on and **no policy**, and is REVOKEd from
    `anon`/`authenticated`: only the service role reads it, and only after the module has verified
    the caller's JWT and workspace role. Nothing ever returns a secret to the browser, only
    `configured: true` plus the last four characters. With no `CONNECTION_SECRET_KEY` a save is
    REFUSED (503) rather than stored in the clear.
  - **How the key reaches `llm.js`**: `_shared/request-scope.js` (AsyncLocalStorage) carries the
    request, so the ~100 `callLLM` sites need no change. `api/brain.js`, `api/calendar.js`,
    `api/public-config.js`, `api/ai/generate.js` and `api/ai/image.js` are wrapped in it. A module
    level variable would leak keys across concurrent requests, which is why it is ALS.

## Brand layer: one record, many derived sites, any brand
`data/brands/_default.json` is tenant zero and the SINGLE source of brand truth. Nothing else is
hand-maintained:
- `api/_shared/master-prompt.js` DERIVES `BRAND_BLOCK` at require-time via
  `brand-runtime.brandBlock(defaultBrand())` — it cannot drift.
- `scripts/brand-sync.js` regenerates the `theme.css` tokens, this file's Brand Constants block and
  the Supabase brand-kit seed between `BRAND-SYNC` markers. **Never hand-edit inside those markers.**
- `npm run brand:check` exits 1 on drift, runs first in `npm run build`, and is a required CI step.

**The mechanism is brand-agnostic, and that is demonstrable:**
```bash
npm run brand:presets                 # regenerate the starter library
npm run brand:sync                    # propagate tenant zero
node scripts/brand-sync.js --brand=apple   # re-skin the WHOLE suite to any preset
npm run brand:check                   # always validates tenant zero; fails on drift
```
`data/brands/presets/` ships starter profiles across deliberately different sectors — KNICKGASM
(D2C commerce), The Economic Times and The Times of India (news), TOI Health & Fitness (health
media, with medical-claim guardrails in its banned list) and Apple
(consumer tech). `/onboarding` renders them as a gallery above the "enter your own" form, served by
`/api/public-config?action=brand&op=presets` (unauthenticated, like `op=defaults`, because the
gallery must paint before a workspace exists).

**Preset provenance rule:** every palette/typography value was read from that brand's OWN live site
or stylesheet on its `verified_at` date, with the exact source recorded per preset. Voice is written
as OBSERVED from public output, never presented as a company's internal guidelines. Presets are
TEMPLATES for building and demos, not licences to use a third party's marks — each carries
`rights_note` saying so, and the gallery repeats it. Regenerate via `scripts/build-brand-presets.js`
(edit that file, not the generated JSON).

## ⭐ Publishing + deliverability (2026-08-18) — read `docs/publishing-and-deliverability.md`
The platform can now SEND, not just create. One pipeline, still 12/12 functions (everything in
`api/_shared/`, mounted on `brain.js` `?action=dispatch-*|deliverability-*|cohort-*` and
`public-config.js?action=connections&op=oauth-*`). UI at `/publishing`.
`asset → channel_mappings → preflight → dispatch_jobs → adapter → sync_log ← webhooks`.
- **Adapters** — `api/_shared/adapters/`: `BasePlatformAdapter` / `AdPlatformAdapter` /
  `CrmPlatformAdapter` (contract also written as real TypeScript in `types.d.ts`, and a test fails
  if it drifts). Meta (Graph + Marketing + `ads_archive`), Google Ads, Klaviyo, WebEngage, plus
  Braze / ActiveCampaign / Customer.io hooks. **Never add an endpoint a platform's docs did not give
  you**: every adapter carries `sources`, and an endpoint that could not be confirmed is
  `verified:false` and shows in the hub as "N unverified". Klaviyo's WRITE paths and all three hooks
  are currently unverified; the hooks refuse to send until `endpoints_confirmed` is set.
- **Three switches before anything leaves**: `LIVE_CONNECTORS=on` (repo-wide, off by default) AND
  per-workspace publishing (a deliberate toggle, not a form field) AND — for Klaviyo/Shopify/
  WebEngage only — `<PLATFORM>_ALLOW_WRITES=1`, because `read-only-egress.js` is a standing rule and
  an adapter does not get to decide it does not apply. Miss one and the job builds the EXACT request
  and stops, showing it.
- **The queue is a convergent row-based queue, not BullMQ** — Vercel Hobby has nowhere to run a
  worker. Same pattern as `smart-brain-plan.prebuildAssets`. Leases, exponential backoff with
  jitter, a platform's own `Retry-After` outranking our arithmetic, and a unique index on
  `(workspace_id, idempotency_key)` that is the actual anti-double-post guarantee.
- **The preflight gate can BLOCK.** Credential, scopes, mapping gaps, domain auth, blocklists,
  warmup cap, segment health, frequency cap, unsubscribe, content spam. **A check that could not run
  returns `warn`, NEVER `pass`** — a gate that approves what it could not inspect is worse than no
  gate. Blocks are overridable and the override is recorded with the operator's id and reason.
- **Three lies this domain invites, all refused in code**: a refused blocklist query is never
  "clean" (`isRefusalCode`, Spamhaus answers refusals with `127.255.255.x`); a DNS lookup that
  timed out is `unavailable` and EXCLUDED from the score's denominator rather than scored 0; and no
  send time is recommended without open history. Audience sizes are never invented.
- **No raw email addresses** — `subscriber_engagement_scores` holds a per-workspace-salted SHA-256
  plus the ESP's own profile id. Pseudonymisation, not anonymisation, so the table keeps brand RLS.
- **Warmup never widens past `engaged_60`** — adding lapsed contacts to a ramp collapses the
  engagement rate at exactly the moment the domain is building one.

## ⭐ Every asset is built to ITS OWN contract (2026-08-19) — read `docs/asset-contracts.md`
`api/_shared/asset-contracts.js`. `asset-specs.js` always held the real dimensions and copy limits,
and exactly ONE file consumed it: `master-prompt.js`, which pastes it into a PROMPT. So the rules
reached the model as prose, every renderer re-typed the numbers (`scripts/lib/ad-creative.js` clamped
to its own literal 125/40/30 and 30/90), one copy pass wrote email + landing + all three ad platforms
together, and **nothing ever checked the finished asset** — a Google headline three characters over
the limit was found by Google.
A contract states, per asset type: the `structure` it has IN ITS MEDIUM, the `design` rules that
belong to that surface and no other, the ordered `algorithm` by which it is made, and `validate()`.
Six: `email.mailer`, `ad.meta.static`, `ad.meta.video`, `ad.google.rsa`, `ad.tiktok.video`,
`landing.page`. A test asserts the mediums have not collapsed back into one set of rules relabelled —
email has no JS and must survive images-off; a landing page owns its scroll; a Google RSA has NO
layout because Google assembles the combination; a video ad is judged on its first second and on
whether an artefact exists to play.
- **Numbers are READ, never re-typed** — pulled from `asset-specs.js` at require time; a slot the spec
  has no number for is DECLARED unbounded rather than quietly given one.
- **A limit this repo cannot source does NOT block.** `verified` only where the repo already refuses
  to send copy that breaks it (Google's 30/90/15 — `google-ads-adapter.js` DROPS over-long copy before
  building a request). Everything else warns. A test walks every `verified` claim and fails if the
  file it names lacks the enforcement.
- **Validation never rewrites copy.** Truncating to fit is how a sentence becomes a fragment nobody
  wrote. `checkAssetContracts()` attaches `contract_check` per asset + a campaign summary; the
  copywriter is briefed with the SAME contracts, so writer and check cannot disagree.

## ⭐ Governing spec: Campaign Orchestration Master Operating Contract
`docs/campaign-orchestration-master-spec.md` is the standing operating contract for all campaign
calendar, cohort, mailer, ad, dashboard, and creative generation work. When building or generating
any of those, obey it. Load-bearing rules (full detail in the doc):
- **Zero fabrication** — never invent product facts, prices, URLs, images, ratings, reviews, claims,
  segment sizes, or performance. Missing data -> `[DATA REQUIRED BEFORE LAUNCH: field, product, region]`.
- **Closed source-of-truth** — only the repo + the exact official KNICKGASM regional site for the exact
  product/region. No cross-region reuse of facts/assets/reviews/claims/URLs.
- **Design HARD rules** — never black/`#111111`/dark-neutral section backgrounds (use red or white); enforce
  WCAG-AA contrast (no dark-on-dark / light-on-light); equal-size aligned parallel cards; proofread all
  copy; source-map every fact.
- **Frequency** — promotional cap 2 (absolute 3) per rolling 7 days; do not assume all ~111k are
  contactable daily (preferred ~31.7k/day); reduce/delay/block when eligibility is short.
- **Reviews/ratings** — only approved review data; never round 4.9 to 5, never invent reviewers, never
  transfer across product/region.
- **Launch gate** — weighted >= 9.5/10, no critical dim < 9; otherwise
  `NOT LAUNCH READY — DATA/DESIGN/FACTUAL/TECHNICAL DEPENDENCY`.
- **Shared source of truth (spec §24b, design `docs/shared-source-of-truth.md`)** — the Email Calendar
  and every other feature (Content Calendar, Blog Agent, Creator Plan, Social Generator, Paid Media,
  Analytics, Publishing Queue) are synchronized VIEWS over ONE canonical data model; never separate
  duplicated campaign systems. One authoritative record per campaign/product/offer/price/inventory/
  claim/review/rating/image/asset/forecast, referenced by stable id. No independent feature copies of
  facts (a snapshot must reference the canonical row + show CURRENT/STALE). Canonical change → event
  propagation (recalc, revalidate, mark stale, regen, audit, status). Pre-launch sync gate blocks any
  launch from a stale snapshot. One record, many views — not many records that need reconciliation.
Known current gaps vs this spec (data feeds to wire before launch): approved review library, approved
claims library, approved URL map, real eligible-segment sizes, valid `SUPABASE_SERVICE_ROLE_KEY`.


A retention/lifecycle-marketing toolkit for KNICKGASM, deployed as a **single Vercel project** (no framework — `framework: null`, `outputDirectory: "."`). It started as the Mailer Studio (`lifecycle_mailer_architect_v34.html`) and grew into a multi-page suite: data analysis → marketing calendar → mailer creation → competitor intelligence → knowledge base → ad/landing-page generation.

Live: https://knickgasm.vercel.app/ (→ https://lifecycle-os.anchit-tandon.com/) — this is the project that receives `main` deploys (health `build:"lifecycle-os"`). · Canonical repo: github.com/anchittandon-create/KNICKGASM, working dir ~/KNICKGASM/lifecycle-os. Built 2026-08-03 by replicating the architecture of a sibling lifecycle-OS project, then rebranded end to end for KNICKGASM (custom sneakers). No product, catalogue, customer or performance data from that project is retained - see scripts/gen-demo-analytics.js and scripts/gen-demo-d2c-dashboard.js, which generate all sample data from the live knickgasm.com catalogue.

## Version taxonomy (V1 vs V2) — product-owner convention, 2026-07-03
- **V1 = the legacy base app**: everything that existed before 2026-07-03 (dashboard/analytics, /plan RFM calendar, Mailer Studio /studio, competitor, KB, ads, landing pages, KicksGPT, smart-brain).
- **V2 = the Lifecycle OS additions of 2026-07-03**: the cohort mailer-calendar system (/mailer-calendar), the UK non-engagers campaign hub (/uk-non-engagers) + week-1 campaign, tier-routed LLM/image cascades + video-core, Social Media OS (/social), knowledge/retention/ library, and the LHS-nav IA rule.
- V1 features are upgraded by customising the base version, and only where needed. Where a feature exposes both generations in menus/hubs, label the earlier build **"Option 1"/"Draft 1"** and the current one **"Option 2"/"Draft 2"** (V2 = the second draft).

## Mailer type taxonomy
Mailers come in exactly two named types:
1. **Text** — pure typographic (the `pure` render style).
2. **Text + Graphics** — text plus BUILT graphic elements only: brand-palette colors, buttons, labels, badges, dividers, price/receipt tables (CSS/table constructs — never photos; photos are optional slots the user fills). Any combination of such elements qualifies. Maps to the `visual`/`editorial` render styles.

## SiS distribution branch — NEVER merge into main
The branch **`snowflake-streamlit-app`** is a permanently separate distribution of this repo:
the Streamlit-in-Snowflake version (runs natively in Snowflake via `get_active_session()`,
reads warehouse tables directly — no Vercel, no Supabase, no HTML pages). It intentionally
diverges from main and **must NEVER be merged into main** (nor main into it wholesale; port
changes by hand when needed). Enforced by the required check
`.github/workflows/protect-main-from-sis.yml`, which fails any PR from that branch into main.
Deploy that branch from Snowsight (Git-linked workspace or paste `streamlit_app.py`).

## Commands
```bash
npm run build          # scripts/build-catalog.js → data/catalog/products_{us,uk,global}.json (runs at deploy via vercel.json buildCommand)
npm test               # playwright test (tests/ dir; config playwright.config.js)
npm run test:ui        # playwright test --ui
npm run test:install   # playwright install (first-time browser download)
npm run deploy         # vercel --prod
npx playwright test tests/<file>.spec.js   # run a single test file
```
There is no real `dev` server (the `dev` script is a no-op stub). For local serverless testing use `vercel dev`. CI (`.github/workflows/ci.yml`) only does an HTML smoke check + `npm run build` — there is no lint step.

## Architecture — the big picture

### Frontend: independent static HTML pages sharing one auth/nav shell
Each page is a **standalone, self-contained `.html` file** (inline CSS + JS, often huge — `lifecycle_mailer_architect_v34.html` is ~7700 lines / 700KB+). They are NOT a component tree; they share state via **localStorage** and a common script:

- **`auth.js`** — dropped into every page via `<script>`. It (1) boots a Supabase client from `window.__SUPABASE__` or `/api/public-config`, (2) forces one-time Google sign-in, (3) renders the shared top-bar / cross-step navigation, (4) registers the service worker (`sw.js`) for PWA install + aggressive cache self-healing, (5) exposes `window.LifecycleAuth.{client, session, signOut}`.
- Pages: `index.html` (home), `dashboard.html` (RFM/cohort analytics), `calendar.html` (30-day plan), `lifecycle_mailer_architect_v34.html` (Mailer Studio — the main app, served at `/studio`), `competitor-benchmarking.html`, `knowledge-base.html`, `ad-campaigns.html`, `landing-pages.html`, `cohort-definitions.html`.
- Friendly URLs are wired in `vercel.json` `rewrites` (e.g. `/studio`, `/analytics`, `/plan`, `/competitor`, `/kb`, `/ads`). When adding a page, add its rewrite there.
- Shared front-end helpers: `chart-enhance.js`, `table-sort.js`.

### Backend: Vercel serverless functions under `api/`
**Hard constraint — Hobby plan caps Serverless Functions at 12.** The app sits at that limit, which dictates the structure:
- **Files under `api/_shared/` are NOT counted as functions** (underscore-prefixed paths are excluded). Heavy logic lives there and is `require()`d by the thin public endpoints.
- Multi-capability features are **single catch-all routers dispatched by `?action=`** rather than one file per capability:
  - `api/competitor.js` → `?action=list|html|poll|sync` (logic in `_shared/competitor-core.js`)
  - `api/kb.js` → `?action=ingest|list|top-emails|brands|classify-emails`
- Before adding a new `api/*.js` file, check the count in `vercel.json` `functions` — prefer extending an existing router.

| Endpoint | Purpose |
|---|---|
| `api/ai/generate.js` | Text generation: create_brief, concepts, mailer_full, suggested_prompts |
| `api/ai/image.js` | Image generation cascade (see below) |
| `api/ai/pipeline/*.js` | Multi-stage mailer pipeline: strategy → variant → images → html → score (+ health) |
| `api/calendar.js` | `?action=generate` (30-day plan) + `?action=trigger-mailer` + `?action=smart-brain-*` (plan/sync-daily/cron/approve/reject/run-daily/feedback…) + `?action=lp&id=` (serves generated landing pages at `/lp/:id`). Logic in `_shared/calendar-generate.js`, `_shared/calendar-trigger.js`, `_shared/smart-brain-plan.js`, `lib/smart-brain/services.js` |
| `api/competitor.js` | Competitor Benchmarking router. Competitor universe in Supabase (`_shared/competitor-universe.js`); mail capture via Gmail IMAP → Google Sheet, both optional |
| `api/kb.js` | Knowledge Base router (Supabase-backed) |
| `api/public-config.js` | Public config (Supabase URL + anon key) + `?health=1` health check; `/api/health` rewrites here. **Operator-only modes:** `?pipeline=1`, `?probe=1`, and the DETAILED `?health=1` payload require `Authorization: Bearer <operator Supabase token or CRON_SECRET>` (allowed domains via `ANALYTICS_ADMIN_DOMAINS`, default `knickgasm.com`) and drop wildcard CORS. Anonymous `?health=1` returns liveness only (`ok/build/ts`) — never provider, key, model, region or env state. `?probe=1` also spends provider quota, so it must never be anonymous. |

### Shared LLM caller — `api/_shared/llm.js`
6-provider text waterfall, de-duplicated: **OpenAI** (`OPENAI_API_KEY`/`_2`/`_3`) → **Anthropic** (claude-3-5-haiku) → **Gemini** (free tier) → **Grok/xAI** → **Groq** (free) → **Cerebras** (free). All callers should go through this rather than calling providers directly. Per-call provider override is supported (`'gemini'|'openai'|'anthropic'|'grok'`).

### Competitor universe — per brand, in Supabase, no Google needed (2026-08-13)
`api/_shared/competitor-universe.js` + `public.brand_competitors` (migration `20260813120000`) are the competitor set for the ACTIVE brand. It moved out of the Google Sheet because the sheet needed credentials this deployment does not hold (every brand saw "0 brands" and a raw `Google auth not configured` error) and because one spreadsheet cannot hold more than one tenant's universe. RLS is the same `is_brand_member` gate as the rest of the brand content; server paths use `restAs`-style calls as the caller, and the cron uses the service key with an explicit workspace filter. Unique per workspace on a generated `dedupe_key` = domain, else folded name, so **de-duplication is by domain**.
- **Seed on activation** — `brandCore.setActive()` calls `seedForWorkspace()`, which derives ONLY from that brand's own record (its `competitors` list and its `market_study` tiers, including the structured `tiers[].brands` entries in `data/brands/_default.json`). No LLM and no network, so activation cannot hang. A tier whose note says it does not compete is skipped. A brand whose record names nobody gets `[DATA REQUIRED BEFORE LAUNCH: competitor set, …]`, never another brand's list — the rule `competitor-core.seedBrands()` states is enforced structurally here: the brand record is fetched by id and there is NO fall back to the default brand.
- **Auto-update** — `refreshDueWorkspaces()` runs off the EXISTING daily cron (`/api/brain?action=cron`); no third Hobby cron. Three least-recently-refreshed active workspaces per run, tracked in `brand_competitor_refresh`. Discovery is prompted from that brand's own industry/offerings/regions; a candidate without a real-looking domain, or on a reserved name, is dropped and reported. Discovery may contribute a name and homepage marked `verification:'unverified'`, never a positioning line, category or rating.
- **Google Sheet is now an export only** — `exportToSheet()` and `?action=universe-export` run when credentials exist, and say `configured:false` when they do not. `core.sheetsConfigured()` gates every remaining sheet-backed action so an unconfigured deployment reports an honest empty state instead of a credentials error.

### Auth to Google Sheets — Workload Identity Federation (keyless)
The competitor MAIL ARCHIVE (not the universe, see above) lives in a Google Sheet. Auth has **two modes** (see `docs/workload-identity-federation.md` and `_shared/competitor-core.js`):
- **Mode A (preferred, keyless):** WIF — Vercel mints a per-request OIDC token (`VERCEL_OIDC_TOKEN`, enable "OIDC Tokens" in Vercel project settings), Google STS swaps it, code impersonates the SA. Set `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT_EMAIL`.
- **Mode B (legacy):** JSON key in `GOOGLE_SERVICE_ACCOUNT_*` env vars. Code prefers Mode A when `GCP_*` present; falls back to JWT when `VERCEL_OIDC_TOKEN` absent.

### Smart Brain (persistent daily loop)
`lib/smart-brain/services.js` (6 services: KB, Analysis, Competitor, Calendar, Generation, Review) + `api/_shared/smart-brain-plan.js` (persistent rolling **90-day** plan in `smart_calendar_entries`, diff-updated daily, human approve/reject). Daily Vercel Cron (03:30 UTC) hits `/api/cron/smart-brain` (rewrite → `?action=smart-brain-cron`, `CRON_SECRET`-protected). Console UI: `smart-brain.html` at `/brain`. Approving a slot LLM-writes mailer + Meta/Google/TikTok ads + landing page (served at `/lp/:campaignId`) and mirrors them into `ads_generated`/`landing_pages_generated`. Platform push stays Phase 2 (`push_status: not_integrated_phase_2`).

**90-day horizon + asset prebuild (2026-07-09).** The rolling window is 90 days (`calendarDays: 90` in `services.js`, `calendar.days: 90` in `brain-core.js`, V1 `calendar-generate.js` cap raised to 90). Every slot in the window is not just planned but has its **full asset bundle prebuilt** — LLM copy + generated images for mailer + ads + landing page. Because ~180 slots (90d × US/UK) cannot build in one serverless invocation, `prebuildAssets()` is a **convergent background queue**: `?action=smart-brain-prebuild` (CRON_SECRET-protected) builds one small batch (via `buildCampaign(..., {withCreatives:true})`), persists it to `smart_generated_campaigns` as a `prebuilt` draft (NOT mirrored to the ads/LP dashboards until approval), marks the slot with a `payload.__prebuilt` marker, then re-fires itself until `remaining` hits 0, then idles. It self-chains via a fire-and-forget `fetch` to `VERCEL_URL` (3s handoff; the child keeps running after the client aborts). Kicked automatically after `smart-brain-sync-daily`, off the existing `/api/brain?action=cron` daily run (no 3rd Hobby-limited cron added), and re-runnable by hand. `previewEntry`/`approveEntry` REUSE the prebuilt campaign (instant view, no regeneration; what the reviewer saw is what ships). A material re-plan of a slot on daily sync drops the marker → the queue rebuilds the now-stale assets. Idempotent + resumable; a total-failure batch stops the chain instead of hot-looping.

**Whose audience, whose proof, and whether you can SEE it (2026-08-14).** Four things the fork
inherited from the sibling project reached customers through this path, and all four are now closed
in `smart-brain-plan.js` + `smart-brain.html` (tests: `tests/smart-brain-assets.spec.js`):
- **Audience** — the ad art-direction line hardcoded the sibling company's persona and art-directed
  EVERY tenant's imagery with it. `audienceBrief(entry)` now derives it from the slot's COHORT (a
  behavioural segment from the brand's own data, name + rules) plus any audience stated on the brand
  record; with neither, the brief carries `[DATA REQUIRED BEFORE LAUNCH: audience / persona
  definition, <brand>]` and FORBIDS assuming an age, gender or life stage. Never substitute one.
- **Proof** — the JSON shape handed the model `"rating": {"value": 4.9, "count": "250,000+"}` and an
  author templated as `"first name, initial"`. Seeding a shape with values IS an instruction to
  invent them (`mailer_system/brand_prompt.py` had the same defect). Proof is now EXTRACTED, not
  written: **`api/_shared/brand-reviews.js`** reads the brand's OWN testimonials off its OWN site,
  verbatim, riding the EXISTING `site-crawl.js` (`onPage` + `rank`) — no second crawler, no LLM in
  the path. Author only if the page names one; rating only if the page states one, kept as TEXT with
  its scale so 4.9 is never rounded and a /10 is never read as a /5. Stored in
  `brand_review_library`, filtered on workspace AND region so a review cannot transfer between
  brands, regions or products. Review IMAGES are fetched and re-hosted into the `brand-review-media`
  Storage bucket (key `<workspace_id>/<sha256 of source url>` — workspace-scoped by the path segment
  the storage policy checks, idempotent by the hash) and the mailer carries THAT url, never a
  hotlink; the original url is kept beside it. `brand_review_scan` records zero-result scans so the
  ~180-slot prebuild queue cannot re-crawl a brand's origin once per slot. Migration:
  `20260814120000_brand_review_library.sql`. **Nothing is fabricated to fill a gap**: `gateProof()`
  strips any rating/review/reviewer/badge/guarantee with no approved source behind it, and an absent
  proof block RENDERS the marker rather than vanishing (silence reads as a design choice).
- **Video ads had no artefact** — the console drew a play triangle on a gradient over a storyboard;
  nothing was generated, so the reviewer approved something they had never seen. Every video ad now
  carries `creative.motion_html` (a self-contained animated 9:16 creative built by
  `scripts/lib/motion-ad.js` over the brand's own REAL catalogue photos, now brand-parameterised via
  `spec.brand`) plus `creative.motion_brief`, and `creative.video` states plainly whether an MP4
  exists. The console previews the artefact's EXACT bytes via a Blob URL (the `/july-studio`
  precedent) and downloads those same bytes. Tenant zero's audio beds are never lent to another
  brand — `video-core.audioBedFor()` returns a marker instead.
- **One creative key per AD, not per platform** — the map had 5 keys for 8 ads, so a platform's
  static and video shared one photo and the youtube/pinterest ads matched no key and shipped with no
  image at all. Keys are now `<platform>:<creative_type>`.
Also fixed here: `applyCopy()` referenced `__run` from `_buildCampaign`'s scope, throwing on the last
line of every SUCCESSFUL copy application. The mutations had already landed so assets were fine, but
the throw was swallowed and every campaign reported `copywriter.provider: 'template-fallback'`,
creatives `none`, and the console's "no LLM provider answered" banner — on copy an LLM had just
written.

### KicksGPT — the brand LLM (conversational tool-calling over the whole stack)
`api/_shared/brand-llm.js` is the brand's own "Claude-for-Knickgasm": a provider-agnostic **tool-calling loop** that lets the LLM actually OPERATE the growth stack instead of just chatting. The model emits a strict JSON action each turn (`{action:'tool',...}` — single tool or a `tools:[…]` batch of up to 3 run in parallel — / `{action:'final',...}`); the server executes against the existing `_shared` cores and feeds results back, looping (default 5 steps). Speed: the loop pins the first provider that answers (per-call `preferProvider` in `llm.js`) so later steps skip dead keys, dedupes repeated tool+args calls, 20s per-provider timeout. Quality: the system prompt enforces an **evidence contract** — every recommendation quotes exact tool-sourced figures, names the target metric + expected impact, states a complete hypothesis, and quotes competitor benchmarks. Because tool-calls are plain JSON (not a provider-specific function-calling API), it works across the **entire 6-provider waterfall in `llm.js`**, including the free tiers — no extra keys. Tools registered: `ask_analytics`, `run_analysis`, `list_cohorts`, `get_calendar`, `get_competitor_benchmarks`, `search_knowledge_base`, `list_campaigns`, `generate_calendar`*, `generate_assets_for_slot`*, `run_agentic_campaign`*, `klaviyo` (*=writes/generates, only on explicit ask). Each reuses the SAME logic the `/api/brain ?action=` routes use. Endpoints: `?action=brand-chat` (the loop), `?action=brand-tools` (manifest + klaviyo status). UI: `kicksgpt.html` at `/kicksgpt` (also `/kicks`, `/ask`) — Claude-style chat that shows the tool trace. Rename the product via the single `BRAND_LLM_NAME` constant in `brand-llm.js`.

### Klaviyo integration (scaffolded — no keys yet)
`api/_shared/klaviyo-core.js` mirrors Klaviyo's public JSON:API REST endpoints (profiles, lists, segments, metrics, events, campaigns, flows, templates, subscribe, track-event, campaign reporting). Auth via `KLAVIYO_API_KEY` (+ optional `KLAVIYO_PUBLIC_KEY`, `KLAVIYO_REVISION`). **Until a key is set**, every op returns a structured `{connected:false, would_request:{method,url,body}}` stub so the chat + tool-calling work end-to-end and only need a key to go live. Exposed at `?action=klaviyo` (`/api/klaviyo`, `op=` + params) and as the `klaviyo` KicksGPT tool.

### Persistence
- **Supabase** (Postgres) — cross-device storage, auth, KB, captured competitor emails. Migrations in `supabase/migrations/` (timestamped). `supabase/COMBINED_RUN_THIS.sql` is the apply-all bundle; seeds in `supabase/seed/`. Front-end gets URL+anon key from `/api/public-config` (service-role keys NEVER exposed there).
- **localStorage** — analytics state passed between dashboard → calendar → studio.
- **Google Sheet** — the competitor-email "database" (columns A–K defined in `competitor-core.js`).

### Offline Python data engines (run locally, not on Vercel)
- `ingest/` — `run_all.py` runs `ingest_{matrixify,shopify_analytics,klaviyo,webengage}.py` into DuckDB (`LIFECYCLE_DuckDB_DDL.sql`), then `sync_to_supabase.py`.
- `mailer_system/` — Python Claude-API campaign trigger engine (thresholds in `targets.json`, outputs to `outputs/`).
- `marketing_automation/` — React 19 + Vite + Express (`server.ts`) interactive campaign compiler (its own `package.json`).
- `scripts/` — mix of JS build tools (`build-catalog.js`, `seed-festivals*.js`) and Python `_*.py` HTML/codegen patchers used during development.

## ⭐ Asset provenance: a brand's assets come from its OWN catalogue, or there is no asset (2026-08-14)
`api/_shared/brand-catalog-server.js` is the ONLY place the server decides whose products these are.
It is the server twin of the browser's `brand-catalog.js` and the rule is the same in both:
**an asset for brand X uses brand X's own catalogue, or NO asset at all** — there is no third option
where another brand's photo renders under a caveat.
- Sources, in order: **`brand`** = the workspace's own `brand_catalog_products` rows (filtered by
  `workspace_id`, service-role); **`shipped`** = `data/catalog/products_{us,uk,global}.json` **only for
  tenant zero** — those files are one tenant's 436 products, gated by the SAME
  `market-analytics.ownsBundledExport()` helper that gates the bundled sales export (now takes an
  optional explicit workspace, so a cron/prebuild job generating FOR a workspace gets that
  workspace's answer); **`none`** = empty list + a `reason`, which callers turn into
  `[DATA REQUIRED BEFORE LAUNCH: product image, <product>, <region>]` and render image-free.
- **Never read `data/catalog/` from a new module** — `tests/brand-catalog-scope.spec.js` fails any
  `api/_shared/*.js` that does. Go through `catalog-image.js` (which delegates here).
- The resolvers stay SYNC because ~21 render sites are sync. Two halves: `withCatalog({brand,
  workspaceId}, fn)` resolves the workspace's rows ONCE at a generation entry point and pins them via
  **AsyncLocalStorage** (never a module variable — a warm runtime serves concurrent brands from one
  process); `productsFor(market, {brand})` answers synchronously from that scope, and applies the
  BRAND GATE even with no scope, so a named non-tenant-zero brand can never reach the shipped files.
  Every cache is keyed by workspace id. Pass `{ brand }` (or an `entry` carrying `.brand`) at every
  `catalogImage.*` call site.
- `buildCampaign()` pins the catalogue for the whole build and reports unfilled image slots on
  `campaign.data_gaps` + `campaign.catalog_source`, so an image-free asset is never silently so.
- Gate: `npm run test:isolation` (it derives tenant zero's CDN signature from the built catalogue, so
  an ASSET leak fails it the way a COPY leak already did) plus
  `npx playwright test tests/brand-catalog-scope.spec.js`. `data/catalog/` is gitignored, so the
  asset half of the isolation gate reports **DEGRADED** until `npm run build` has run (CI runs it first).

## Approved-assets service + USA July calendar (2026-07-11)
- **`brand_assets` table** (`supabase/migrations/20260711120000_brand_assets.sql`) is the origin-validated asset store: `sku_key, asset_type, url, alt, w/h, source_pdp, origin_validated, status(verified|placeholder), region`. Logic in `api/_shared/brand-assets-core.js` (not a function file): PREFIX-match allowlist (`knickgasm.com`, `knickgasm.com`, `knickgasm.com`, `try.knickgasm.*`), rewrites a Shopify store-CDN URL to the brand host (`www.knickgasm.com/cdn/shop/files/…`, byte-identical asset) so it validates, and NEVER fabricates a URL — an unverifiable slot is stored `status='placeholder'`. Seed with `npm run seed:assets` (`scripts/seed-brand-assets.js`): resolves the US SKU→handle map from the built catalog, writes `data/brand-assets/us.json` + `supabase/seed/brand_assets_us.sql`, and upserts live when Supabase env is present.
- **USA July calendar + mailers** (`npm run build:july`): `scripts/build-july-mailers.js` keeps the automated-calendar 4-variant STRUCTURE (2 Text + 2 Text+Visual, framework A/B) and the same `sanitizeBrand`/`assertNoBanned` gates (`scenario-model.js`), but renders each variant in the **flagship design system** (`scripts/lib/flagship-mailer.js`: web fonts, green utility bar, colorway hero band — violet/midnight/daylight, price pill, MSO-safe CTA, trust badges, "Made on 100% original brand sneakers · Worn by Samay Raina & Rohit Sharma" proof bar, non-clickable footer). Hosted image URLs only (never base64). 12 cohort sends × 4 = 48 files in `mailers/usa-july/`; hero images come ONLY from verified `brand_assets` rows (image-free otherwise, never a fake URL). The same pass also renders, per send, a paid-social **ad set** (Meta/Google/TikTok, `scripts/lib/ad-creative.js` → `ads/usa-july/`) and a flagship **landing page** (`scripts/lib/landing-page.js` → `landing-pages/usa-july/`), all from the same scrubbed copy + verified assets (no invented discount codes). `scripts/build-july-studio.js` assembles `lifecycle-usa-july-calendar-mailer-studio.html` (served at `/july-studio` · `/usa-july`): Card/List toggle, scenario tabs (C = executed model, 2-3 emails/user/week), per-send **Mailers / Ads / Landing** tabs whose preview = the exact embedded downloadable file (Blob URL, no `srcdoc`), plus the data-grounded reasoning per row. Manifest: `data/calendar/usa-july-2026.json`. Event hooks wired into reasoning: WC Final Jul 19 @ MetLife, National Ice Cream Day Jul 19, Parents' Day Jul 26, Int'l Day of Friendship Jul 30, National Streetwear Month (Aug) ramp.
- **Selected-collection coverage rule:** `SELECTED_COLLECTIONS` in `build-july-mailers.js` (default: kicks-sneakers, samplers, gifts, best-sellers) MUST each be represented by ≥1 send — the build **hard-fails** if any is uncovered, so a selected collection is never silently dropped. Each slot carries `collections` + a `collection_cta`; the collection is wired into asset generation (landing-page "Explore all {collection}" CTA) and surfaced in the studio (chips + a "Collections covered" stat). `manifest.selected_collections` lists each with its covering send dates.

## Agent memory (TencentDB-Agent-Memory bridge, 2026-07-19)
`integrations/tencentdb-memory/` gives Claude persistent long-term memory (TencentDB-Agent-Memory's
local L0->L3 pyramid: conversation -> atoms -> scenarios -> persona). That project has NO native
MCP/Claude connector — only a "Hermes" REST gateway (`:8420`) — so `mcp-server.mjs` is a **zero-dependency
MCP bridge** mapping the gateway (`/recall /capture /search/* /session/end /health`) onto MCP tools
(`memory_recall`, `memory_capture`, `memory_search`, `memory_search_conversations`, `memory_session_end`,
`memory_health`). Wired into this repo's Claude Code sessions via root `.mcp.json`. Start the gateway with
`integrations/tencentdb-memory/setup.sh` (clones the upstream gateway into gitignored `vendor/`, needs an
LLM key for distillation only), verify with `npm run smoke`. Full setup (repo + CLI + Desktop) in that
folder's README. Habit: `memory_recall` at task start, `memory_capture` after meaningful turns.

## Product Catalogs
US: 436 · UK: 436 · Global: 436 active products (full knickgasm.com catalog in every region file; USD @₹87.5 and GBP @₹110 fixed-rate conversions from INR list prices). Built at deploy from `products_export_{usa,uk,global}.csv` via `scripts/build-catalog.js` → `data/catalog/products_{region}.json` (served with CORS + cache headers per `vercel.json`).

## Market-Specific Store URLs (VERIFIED)
US → knickgasm.com | UK → knickgasm.com | IN → knickgasm.com | EU → knickgasm.com | AU → knickgasm.com | Global/ME → knickgasm.com
- PDP: `{base}/products/{handle}` (handle = catalog JSON `h` field) · Collection: `{base}/collections/{slug}` (via `heroMap` in `collectionUrl()`)

## Brand Constants (source of truth: `Brand style guide.pdf`)
<!-- >>> BRAND-SYNC:constants -->
- **Source of truth:** `data/brands/_default.json`. Run `npm run brand:sync` after editing it; `npm run brand:check` fails the build on drift.
- **Palette (ONLY these four)**: `#D0473E` primary accent · `#6A33D8` secondary · `#111111` ink (text + primary buttons) · `#FFFFFF` background
- **Typography (STRICT)**: Headings **Montserrat** — `'Montserrat','Raleway',Arial,sans-serif`; Body **Instrument Sans** — `'Instrument Sans','Helvetica Neue',Arial,sans-serif`
- **Voice**: bold, energetic, youth street-culture; confident and playful, never corporate. Testimonials read like a friend flexing a new pair, not a review. Never imply the pairs are replicas: they are hand-painted on 100% original brand sneakers.
- **PREFERRED**: custom, hand-painted, one-of-one, grail, canvas, colorway, drop, rotation, crafted, original
- **BANNED phrases**: wellness journey, transform, liquid gold, game-changer, LIMITED TIME, hurry, don't miss out, last chance, while supplies last, replica, knock-off, first copy, fake pair
- **No em/en dashes anywhere in output copy** - use commas, colons, or plain hyphens. (Enforced by `scrubDashes()`/`sanitizeBrand()` in `api/_shared/scenario-model.js`.)
- **Verifiable claims** (never assert anything else as fact): India's largest sneaker customisers · Made on 100% original brand sneakers · Hand-painted by India's best artists · Water and scratch resistant designs · Express shipping worldwide to 60+ countries · Free shipping in India and worldwide
- **Legal entity**: KNICKGASM PRIVATE LIMITED, Ghatkopar West, Mumbai 400086, India
<!-- <<< BRAND-SYNC:constants -->

## Mailer Studio specifics (`lifecycle_mailer_architect_v34.html`)
- 5-step wizard: Brief → Products → Generation → Review & Refine → Final HTML.
- Produces **4 variants**: A (Image · Hero close-up), B (Image · Lifestyle wide), T1 (Text · Editorial), T2 (Text · Founder note). Structural divergence forced via `_alternateArchetypeForVariantB()`.
- 11 layout archetypes: hero-led-editorial, product-grid-conversion, storytelling-narrative, single-product-spotlight, gift-bundle-showcase, ritual-journey, comparison-discovery, founder-note, editorial-trend-roundup, limited-drop-countdown, subscription-anchor.
- Output mailers are compact (~1200–1500px, two scrolls).
- **Image cascade** (`api/ai/image.js`): Gemini native (`generateContent` + `responseModalities:['IMAGE','TEXT']`) → Gemini Imagen (paid only) → OpenAI (gpt-image-2 → gpt-image-1) → Pollinations (flux-pro → flux-realism → flux, free, "NO text" instruction). `buildDesignPromptFromCatalog()` injects real catalog data; region-aware currency symbols.

## Environment Variables (Vercel only — never hardcode)
Text: `OPENAI_API_KEY`(+`_2`/`_3`), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`. Storage: `SUPABASE_URL`, `SUPABASE_ANON_KEY`. Lifecycle (Klaviyo): `KLAVIYO_API_KEY` (+ optional `KLAVIYO_PUBLIC_KEY`, `KLAVIYO_REVISION`) — integration is scaffolded and returns request stubs until set. Voice: `ELEVENLABS_API_KEY`. Google Sheets: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB` (or legacy `GOOGLE_SERVICE_ACCOUNT_*`). Cron: `CRON_SECRET` (protects `?action=sync`). Per-workspace connections: `CONNECTION_SECRET_KEY` (32 random bytes as hex, `openssl rand -hex 32`) encrypts every user-supplied API key before storage — without it no key can be saved at all, and rotating it makes existing stored keys unreadable so they must be re-entered. Auto-set by Vercel: `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_OIDC_TOKEN`. Full docs in `.env.example`. Each sibling app has its own restricted per-project Gemini key minted from its own GCP project (see "API Keys 2026-05-30" note below).

## Common Bugs to Watch
1. **Unescaped quotes / apostrophes** inside single-quoted JS strings — these pages are giant inline-JS files; a stray backtick in a CSS comment once broke a template literal and killed the sidebar.
2. **`const` reassignment** — use `let` when reassigned later.
3. **Gemini model duplication** — env var can duplicate a hardcoded fallback; always de-duplicate.
4. **CORS headers** — every serverless function needs `Access-Control-Allow-Origin`.
5. **Font stack in JS** — never use quoted font names inside JS template strings.
6. **Quota errors return HTTP 400, not 429/402** — OpenAI `billing_hard_limit_reached` and Anthropic "credit balance too low" both 400; quota detection must check status 400 + billing keywords.
7. **PowerShell BOM corruption** — piping keys via PowerShell `echo` adds UTF-8 BOM; use `cmd /c "type file | vercel env add"`.
8. **Gemini Imagen predict API** — paid plans only (free tier → 400).
9. **Function-count limit (12 on Hobby)** — adding an `api/*.js` file can break deploy; extend a `?action=` router or move logic to `_shared/`.
10. **Service worker caching** — `sw.js` must never cache `/api/*` responses; `.html` and `sw.js` are served `must-revalidate`.

## Domain + OAuth migration (`scripts/migrate-domains.*` + `scripts/migrate-oauth.*`)
Each sibling project moves to `<slug>.anchit-tandon.com`. `migrate-domains` adds the Vercel domain + GoDaddy CNAME, then hands the same scope to `migrate-oauth` so Google sign-in survives the move (skip with `--no-oauth`). Sign-in is **Supabase-mediated** (`signInWithOAuth({provider:'google', redirectTo: origin+pathname})`), so the change that actually matters is the **Supabase Auth redirect allowlist** (Site URL + Redirect URLs) — auto-applied via the Supabase Management API (`SUPABASE_ACCESS_TOKEN` + per-project `<SLUG>_SUPABASE_PROJECT_REF`). The Google OAuth client's redirect URI is the fixed `https://<ref>.supabase.co/auth/v1/callback` and does NOT change on a domain move; the only web-client tweak (a new JavaScript origin) is **Console-only** — there is no gcloud command or public API to edit a Web-application OAuth client, so the tooling emits an exact plan + Console deep-link rather than faking a mutation. Dry-run by default; `--apply` to write. Full detail in `docs/oauth-redirect-migration.md`.

## API Keys (2026-05-30) — per-project Gemini via gcloud
Each app has its OWN restricted Gemini key minted from its own GCP project, pushed to Vercel (Production+Development): lifecycle-os ← GCP lifecycle-os (others: personal-ai-os, the-third-eye, music-gen-ai, hey-yaara, ai-tele-suite, th-life-engine, marketing-mailers-html-architect). Other providers left as-is.

## Marketing skills pack + reels-grade creative standard (2026-07-24)
Ten job-complete marketing skills in `.claude/commands/` (mega-prompt discipline: clear,
highly specific, template-driven, evidence-quoting; skill = a real job run end-to-end):
`/campaign-audit` `/lp-audit` `/ab-test` `/competitor-teardown` `/utm` `/email-sequence`
`/content-repurposer` `/icp-builder` `/ad-copy-matrix` `/creative-brief`. All enforce the
Brand Constants + zero fabrication.
**Reels-grade creative standard**: stills built to animate via `api/ai/image.js`
`mode:'reels'` (cinematic 9:16, depth layers for parallax, negative space for type, no baked
text); real motion via Higgsfield image-to-video; instant no-API preview + generator handoff
via `scripts/lib/motion-ad.js` (`renderMotionAd` = self-contained animated HTML creative,
`motionBrief` = shot-by-shot brief so the shipped MP4 matches). Quality bar in
`.claude/commands/ad-creative.md`: hook moves in 0.8s, word-staggered kinetic type, one
filmic grade, real SKU packaging only, <15s, safe-areas.

## Growth OS — integrated team (slash commands + connectors + skills)
This repo ships project slash commands in `.claude/commands/` that operate the brand as a full growth team for a custom sneakers + lifestyle D2C brand. Start anything with **`/growth-team`** (the router) or jump to a vertical:

| Vertical | Command | Connectors + Skills it routes to |
|---|---|---|
| Strategy/planning | `/campaign-plan` | `marketing:campaign-plan` + Shopify + Klaviyo + competitor KB |
| Email/SMS lifecycle | `/email-flow` | **Klaviyo** connector + `marketing:email-sequence` |
| Mailers (HTML) | `/mailer` | `anthropic-skills:knickgasm-d2c-mailer` + Mailer Studio contract |
| Ad creatives (img/video/gif) | `/ad-creative` | `higgsfield-product-photoshoot` / `higgsfield-generate` / `higgsfield-soul-id` |
| Landing pages (HTML) | `/landing-page` | brand asset code engine + `/lp/:id` contract |
| Design (static/social) | `/design` | **Canva**, **Figma**, Adobe Express skills |
| Commerce data | `/shopify` | Public storefront scrape (US/UK/Global) — `/products.json` etc. **No Admin connector** |
| Analytics/reporting | `/analytics` | Supabase + `marketing:performance-report` + Amplitude/Supermetrics |
| Competitor intel | `/competitor` | competitor router + `marketing:competitive-brief` + SimilarWeb/Ahrefs |
| SEO/AEO | `/seo` | `marketing:seo-audit` + Ahrefs |
| Database | `/db` | `supabase` + `supabase-postgres-best-practices` + `supabase/migrations/` |
| Ship | `/ship` | `vercel-plugin:deploy` / `:env` |

**Every command resolves the ACTIVE brand first (2026-08-13).** `.claude/commands/brand-context.md`
is the FOUNDATION skill and every other skill references it before acting; `npm run check:skills`
(CI gate) fails any skill that names tenant zero, carries its product vocabulary in an example, or
skips the foundation. Structure follows the open **Agent Skills spec** (`agentskills.io`): `name`
matching the filename plus a trigger-phrase `description`, so these work beyond Claude Code slash
commands. The pattern came from `github.com/arnabbagxd/brand-building-skills` (MIT), whose
`brand-context` foundation this repo lacked; ours differs where it matters - theirs is a
questionnaire hand-filled into a markdown file, ours resolves the real workspace and can DERIVE from
the brand's own site with per-field provenance, so a brand fact is never something typed from memory.
Byte-exact carve-outs (real store URLs, `KNICKGASM_DB`, `anthropic-skills:knickgasm-d2c-mailer`) are
preserved by the guard, the same way `brand-context.js` refuses to rewrite a text node holding a URL.

### Connecting the connectors (hosted OAuth MCP — connect once per account)
These are not in `.mcp.json` (hosted OAuth servers, account-scoped). Connect via each server's `authenticate` → `complete_authentication` tool, or in the Claude **Connectors** UI:
- **Shopify** — ⚠️ Admin connector NOT authorized; use public storefront scraping via `/shopify` (US/UK/Global) instead. **Klaviyo** — `mcp__plugin_marketing_klaviyo__authenticate`. **Canva** — `mcp__plugin_marketing_canva__authenticate`. **Figma** — `mcp__plugin_marketing_figma__authenticate`. **Ahrefs / SimilarWeb / Supermetrics / Amplitude** — `mcp__plugin_marketing_<name>__authenticate`. **Higgsfield** — connected (generation MCP). Commands degrade gracefully and tell you what to connect if a tool is missing.

## LHS navigation IA rule
The shared LHS menu (`auth.js`, element `#lifecycle-nav`; model exposed as `window.__LC_NAV` / `window.__LC_NAV_INFO`) follows a standing IA rule:
- **Every feature carries the SAME five "know about this feature" questions, in this exact order:** 1. What does it do? · 2. Who is it for? (cohort / cohort definition) · 3. How does it work? (modes/steps/logic) · 4. Input · 5. Step-by-Step Working. Because they are identical in shape for every feature, they do NOT live inline in the rail — a quiet `?` chip beside each feature/group label opens a popup that presents all five as headings with their content. The rail itself shows only the real feature links and their group sub-sections.
- **Sub-item 5 for content-producing features presents the multi-agent pipeline steps:** Ideology → Data analysis + review + hypothesis → Business & strategy decisions → Content → Design + layout + structure → Audio/Video (where applicable) → Coding → Final compilation + presentation — noting `Runs via: <endpoint>` wherever a live endpoint exists. (Social Media OS uses its own 7-agent variant: Ideology, Data & Hypothesis, Strategy, Content, Design, Audio/Video, Compilation — runs via `/api/brain?action=social-run-daily`.)
- **Menu items carry the V1/V2 taxonomy badge** (see "Version taxonomy" above); where both generations of a capability exist they are labelled **Draft 1 / Draft 2** (Plan V1 = Draft 1 vs Mailer Calendar V2 = Draft 2 of calendaring; Mailer Studio V1 = Draft 1 vs Mailer Calendar built mailers = Draft 2 of mailer creation).
- Content lives in `auth.js` (`NAV`, `SUBQ`, `INFO`). String rules there: double-quoted strings only (apostrophes fine; never a double quote or backtick inside), text positions only. The nav must render signed-out too and degrade gracefully when Supabase/config fetches fail.
- **Sanctioned rendering (2026-07-09):** the five common questions render in a **`?`-triggered popup/modal** (`#lnav-ipanel`), all five shown at once as headings (`.lnav-ipanel-q`) with their content, Step-by-Step Working as a numbered list with `Runs via:` lines; content is written via `textContent` (no HTML-escaping needed). The rail no longer carries an inline five-item accordion — it lists the real feature links and their group sub-sections (groups start collapsed except the active group). Sections follow the sequential marketer workflow: Research & Benchmark → Plan → Design & Create → Share & Track → Assistants; rows show only the quiet V1/V2 chip (Draft 1/2 lives in tooltips + the `?` popup). Superseded the 2026-07-04 inline-accordion rendering.
