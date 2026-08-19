# Lifecycle OS

A **universal brand platform** for lifecycle and growth marketing. Any signed-in
operator onboards their own brand, and the whole application re-skins and
re-scopes to it: its palette, its typography, its voice, its catalogue, its
competitors, its connected platforms and its data.

Deployed as a single Vercel project (no framework, `outputDirectory: "."`).
KNICKGASM is tenant zero — the brand the repo ships with, and one tenant among
many, not a hardcoded owner.

> This README was rewritten on 2026-08-19. The previous one still described a
> three-stage single-brand tool ("Data Analysis → Calendar → Mailer Studio"),
> said automatic sending was **not** included, and named the palette by hues it
> does not contain. All three had stopped being true. If something here looks
> stale, `CLAUDE.md` is the living project memory and wins.

---

## What it does

```
        ┌──────────────────────────────────────────────────────────────┐
        │  /onboarding — the first screen. A brand, or a starter one.  │
        └──────────────────────────────┬───────────────────────────────┘
                                       │  brand_workspaces + RLS
   ┌───────────────────────────────────┼───────────────────────────────────┐
   │                                   │                                   │
   ▼                                   ▼                                   ▼
 UNDERSTAND                         CREATE                              SEND
 analytics, cohorts,        calendar, mailers, ads,            preflight → dispatch
 competitors, journey       landing pages, social,             → adapters → webhooks
 attribution, ad findings   video, logo briefs                 deliverability, warmup
```

Everything is scoped to the active brand. A workspace with nothing connected
gets honest empty states and demo examples from **invented** brands, never
another tenant's data.

---

## Start here

| Document | What it covers |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | **The living project memory.** Architecture decisions, standing rules, and why each exists. Read this first. |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | How it is built: the 12-function cap, the mailer pipeline, the provider cascade, the data layer. |
| [`docs/universal-brand-platform.md`](docs/universal-brand-platform.md) | The multi-tenant brand layer end to end. |
| [`docs/publishing-and-deliverability.md`](docs/publishing-and-deliverability.md) | The send pipeline and the gate in front of it. |
| [`docs/campaign-orchestration-master-spec.md`](docs/campaign-orchestration-master-spec.md) | The standing operating contract for all campaign and creative generation. |
| [`docs/asset-contracts.md`](docs/asset-contracts.md) | How each asset type is built to its own medium's rules, and checked. |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements and history. |

---

## The rules this codebase is built around

These are not aspirations. Each is enforced somewhere, and the enforcement is
named so you can check it.

**Zero fabrication.** No product fact, price, URL, image, rating, review, claim,
segment size or performance figure is ever invented. A missing value is written
as `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` and rendered as that
marker, because a gap that silently vanishes reads as a design choice.

**One brand's assets come from that brand.** `brand-catalog-server.js` is the
only place the server decides whose products these are, and the answer is the
workspace's own catalogue or *no asset at all*. There is no third option where
another brand's photo renders under a caveat. Gate: `npm run test:isolation`.

**A check that could not run is never a pass.** The deliverability preflight
returns `warn`, never `pass`, for anything it could not inspect. A refused
blocklist query is not "clean"; a DNS lookup that timed out is excluded from the
denominator rather than scored zero.

**Nothing leaves without three switches.** `LIVE_CONNECTORS=on` repo-wide, plus
per-workspace publishing, plus a per-platform write flag for the guarded ones.
Miss one and the job builds the exact request and stops, showing it.

**Every feature costs credits, and a missing price throws.** `credit-catalog.js`
is the single source; a feature key absent from it raises rather than running
free.

**Twelve serverless functions, permanently.** Vercel Hobby caps them there.
Logic lives in `api/_shared/` (excluded from the count) and is mounted on
existing routers by `?action=` / `?op=`. A CI step fails the build if the count
moves.

---

## Layout

```
api/                    12 serverless functions, and no more
  _shared/              all real logic (not counted against the cap)
    adapters/           Meta, Google Ads, Klaviyo, WebEngage, CRM hooks
data/brands/            tenant zero + the starter preset library
scripts/                build tools, generators, guards
tests/                  ~750 Playwright tests
docs/                   architecture, specs, runbooks
*.html                  self-contained pages sharing auth.js + brand-context.js
```

---

## Commands

```bash
npm run build            # build the product catalogue (runs at deploy)
npm test                 # the Playwright suite
npm run verify           # every CI gate, in one command — run before pushing
npm run brand:sync       # propagate tenant zero into theme.css / CLAUDE.md / seed
npm run brand:check      # fail on brand drift
npm run brand:presets    # regenerate the starter brand library
npm run test:isolation   # no cross-brand content in generated assets
npm run attribution      # order attribution from the store's own records
```

`npm run verify` exists because several gates ship in two forms: `check:foreign`
**reports** and always exits 0, while `check:foreign:ci` passes `--fail`. Reading
the exit code of the reporting variant is how a real finding once reached main.

---

## Environment

Set in Vercel, never in the repo. Full list in `.env.example`.

| Group | Variables |
|---|---|
| Text models | `OPENAI_API_KEY` (+`_2`/`_3`), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY` |
| Storage | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Per-workspace secrets | `CONNECTION_SECRET_KEY` (32 hex bytes). **Without it a key save is refused, not stored in the clear.** |
| Sending | `LIVE_CONNECTORS`, `<PLATFORM>_ALLOW_WRITES` |
| Cron | `CRON_SECRET` |

A workspace brings its own platform credentials and its own model keys, which
reach `llm.js` through an AsyncLocalStorage request scope — a module-level
variable would leak keys across concurrent requests.

---

## Brand constants (tenant zero)

Source of truth is [`data/brands/_default.json`](data/brands/_default.json). Run
`npm run brand:sync` after editing it; `npm run brand:check` fails the build on
drift.

Colours are named by **role**, not by hue, because the active brand supplies its
own palette and any hue word is wrong for almost every tenant:

| Role | Value |
|---|---|
| primary | `#D0473E` |
| accent | `#6A33D8` |
| ink | `#111111` |
| surface | `#FFFFFF` |

Headings `Montserrat`, body `Instrument Sans`. No em or en dashes in output copy
(`scrubDashes()` enforces it). Banned phrases and the six verifiable claims live
in the brand record and are enforced, not suggested.

---

## Deploy

`main` deploys to production automatically. To deploy by hand:

```bash
npm run verify && npm run build && vercel --prod
```

---

## Mobile

The OS ships as one installable PWA plus Android/iOS Capacitor shells
(`android/`, `ios/`, `mobile/`). The shells render the live deployment, so every
web deploy is also a mobile release. Builds are published by the **Mobile
Builds** workflow to the `mobile-latest` release tag.

---

## Offline engines

Run locally, not on Vercel:

- `ingest/` — Matrixify / Shopify Analytics / Klaviyo / WebEngage into DuckDB,
  then `sync_to_supabase.py`.
- `mailer_system/` — Python campaign trigger engine (thresholds in
  `targets.json`).
- `marketing_automation/` — React + Vite + Express campaign compiler.

---

## A branch that must never merge

`snowflake-streamlit-app` is a permanently separate distribution — the
Streamlit-in-Snowflake build, which reads warehouse tables directly with no
Vercel and no Supabase. It must **never** be merged into `main`, and a required
check (`.github/workflows/protect-main-from-sis.yml`) fails any PR that tries.
