# REPLICATION.md — Lifecycle OS

> **Purpose of this file.** A single, self-contained runbook that lets any developer (or an AI agent) **clone this application to its exact current state and progress**, and a master prompt + knowledge base to regenerate/extend it on the same quality bar. Every project in "Anchit's AI Hustle" carries a `REPLICATION.md` like this. Keep it updated whenever architecture, env, or product scope changes.

- **Last updated:** 2026-06-20
- **Live:** https://lifecycle-os.anchit-tandon.com/
- **Canonical repo:** github.com/anchittandon-create/KNICKGASM (working dir `~/KNICKGASM/lifecycle-os`)
- **Deploy target:** single Vercel project, `framework: null`, `outputDirectory: "."`

---

## 1. Current-state snapshot (what "done" means right now)

A retention/lifecycle-marketing toolkit for KNICKGASM. Multi-page static-HTML suite + Vercel serverless backend + Supabase, with a persistent daily "Smart Brain" loop.

**Working surfaces (routes via `vercel.json` rewrites):**
| Route | Page | Status |
|---|---|---|
| `/` | `index.html` home | live |
| `/analytics` | `dashboard.html` (RFM/cohort) | live |
| `/plan` | `calendar.html` (30-day plan) | live |
| `/studio` | `lifecycle_mailer_architect_v34.html` (Mailer Studio) | live |
| `/competitor` | `competitor-benchmarking.html` | live |
| `/kb` | `knowledge-base.html` | live |
| `/ads` | `ad-campaigns.html` | live |
| `/lp/:id` | generated landing pages (`api/calendar.js?action=lp`) | live |
| `/brain` | `smart-brain.html` console | live |
| `/agent` | `agent.html` (conversational + voice) | live |

**Backend (`api/`, ≤12 functions on Hobby — hard cap):** `ai/generate.js`, `ai/image.js`, `ai/pipeline/*`, `calendar.js` (router: generate / trigger-mailer / smart-brain-* / lp), `competitor.js`, `kb.js`, `brain.js`, `public-config.js`. Heavy logic in `api/_shared/` (underscore = not counted as a function).

**Most recent work (this branch):**
- Smart Brain write path hardened: optimistic-lock daily sync, idempotent approve, reject clears approval state, 30-day retention prune (`supabase/migrations/20260620_smart_brain_retention.sql`).
- `api/_shared/master-prompt.js` — portable per-asset master prompt (see §4).
- Mailers → **2 variants/region** (V1 text-only, V2 text+visual).
- Ads → real creatives (visual + on-creative text overlay) per Google/Meta/Instagram/TikTok, `creative_assets[]`.
- Landing pages → `try.knickgasm.*` presell style, served at `/lp/:id`, exportable (`?download=1`).
- Agent → answer-first prompt, voice `sessionReady` guard, `agent-analyze` exact-numbers path.

---

## 2. Clone-to-exact-state runbook

```bash
# 1. Get the code (canonical, NOT the iCloud copy)
git clone https://github.com/anchittandon-create/KNICKGASM.git && cd KNICKGASM

# 2. Install + build the product catalogs
npm install
npm run build            # scripts/build-catalog.js → data/catalog/products_{us,uk,global}.json

# 3. Configure env (Vercel project settings, NEVER hardcode) — see §3
#    Locally: vercel env pull .env.local

# 4. Apply database migrations (Supabase SQL editor)
#    Run every file in supabase/migrations/ in timestamp order,
#    OR run supabase/COMBINED_RUN_THIS.sql. Seeds in supabase/seed/.

# 5. Run
vercel dev               # there is NO real `dev` server; the npm dev script is a no-op stub
npm test                 # playwright smoke (tests/)

# 6. Deploy
npm run deploy           # vercel --prod  (build runs scripts/build-catalog.js via vercel.json)
```

**Definition of "replicated at the same level":** all routes in §1 load, `/api/health` returns ok, `npm run build` produces the three catalog JSONs, migrations applied, and a `smart-brain-sync-daily` call returns a plan. CI (`.github/workflows/ci.yml`) does an HTML smoke check + `npm run build` (no lint step).

---

## 3. Environment variables (Vercel only)

Text LLMs: `OPENAI_API_KEY` (+`_2`/`_3`), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`.
Storage: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (+ service-role for Smart Brain writes; NEVER exposed to the browser).
Google Sheets (competitor data): `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB` (or legacy `GOOGLE_SERVICE_ACCOUNT_*`).
Cron: `CRON_SECRET`. Auto-set by Vercel: `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_OIDC_TOKEN`. Full list in `.env.example`.
Per-project Gemini key minted from GCP project `lifecycle-os`.

---

## 4. The master-prompt contract (regenerate any asset, anywhere)

`api/_shared/master-prompt.js` is the **single source of truth** for brand rules and produces ONE self-contained prompt per asset that yields top output on a blank ChatGPT / Claude / Gemini.

```js
const { buildMasterPrompt, BRAND_BLOCK, regionFacts } = require('./api/_shared/master-prompt.js');
buildMasterPrompt({
  assetType: 'mailer' | 'ad' | 'landing_page',
  market:   'US' | 'UK' | 'IN' | 'EU' | 'AU' | 'Global',
  brief:    'campaign brief / objective',
  products: [{ title, price, handle, category }],
  variant:  'V1' | 'V2',                 // mailer only: V1 = text-only, V2 = text+visual
  platform: 'google'|'meta'|'instagram'|'tiktok',  // ad only
  cohort:   'Champions' | ...,           // optional
  extra:    'any extra constraints',     // optional
}) // → string
```

- `generate.js` returns `master_prompt` (+ `master_prompt_v1`/`_v2` for mailers) on every response.
- Smart-brain approval attaches a `master_prompt` to every generated email/ad/LP.
- **Visual cascade (all visual assets, in order):** embed hosted media URL → auto-GIF/animated frames → AI-generated video (last resort).
- **Asset output shapes:** mailer V1 = pure copy; V2 = copy + per-section visual direction + ≥1 motion slot. Ad = platform text fields + per-size creative briefs with overlay + safe zones (`creative_assets:[{format,size,ar,url,text_overlay}]`). LP = try.knickgasm presell sections, regional store CTA, self-contained HTML.

---

## 5. Knowledge base (brand truth — never drift)

**Palette (ONLY four — from knickgasm.com live theme):** `#D0473E` deep purple · `#6A33D8` lava · `#111111` near-black · `#FFFFFF` chalk.
**Type (strict):** headings `'Montserrat'` (fallback Raleway, Georgia, serif); body `'Instrument Sans'` (fallback Helvetica Neue, Arial). No other primary fonts.
**Voice:** warm, sensory, story-driven. **Prefer:** ritual, restore, balance, origin, one-of-one, hand-painted, lace-up, heritage, crafted.
**Banned:** wellness journey, transform, liquid gold, game-changer, LIMITED TIME (caps), hurry, don't miss out, last chance, while supplies last. No medical claims, no fake scarcity, no off-palette tints.
**Catalogs:** US 436 · UK 436 · Global 436 active (full knickgasm.com Shopify catalog per region; fixed-rate USD/GBP conversion from INR). Built at deploy from `products_export_{usa,uk,global}.csv`.
**Store URLs:** US `knickgasm.com` · UK `knickgasm.com` · IN `knickgasm.com` · EU `knickgasm.com` · AU `knickgasm.com`. Presell: `knickgasm.com` / `knickgasm.com`. PDP `{base}/products/{handle}`.

---

## 6. Common pitfalls (carry forward)

1. Unescaped quotes/backticks inside giant inline-JS HTML files break the whole page — surgical edits, match quoting, validate `<script>` blocks parse.
2. `const` reassignment → use `let`.
3. De-duplicate Gemini model env vs hardcoded fallback.
4. Every serverless fn needs CORS headers.
5. Quota errors are HTTP **400** with billing keywords (not 429/402).
6. **12-function cap** on Hobby — extend a `?action=` router or move logic to `_shared/`, never add a 13th `api/*.js`.
7. `sw.js` must never cache `/api/*`; `.html`/`sw.js` are `must-revalidate`.
8. iCloud corrupts `.git` — develop from the canonical clone.

---

## 7. Where to look next

See `docs/UNIFIED-ARCHITECTURE.md` for the consolidation roadmap (single Lifecycle OS super-app: real-time + historical data, competitive benchmarking, automated calendar at day/week/month/year, marketing automation, and the dual-agent split — internal-employee agent vs user-facing sales personas — with the buyer-vs-internal data-classification matrix).
