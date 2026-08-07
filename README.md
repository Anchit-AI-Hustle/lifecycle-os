# KNICKGASM Lifecycle OS

**Data Analysis + Marketing Calendar + Mailer Creator** — one workflow, three
stages, deployable as a single Vercel project.

Forked from
[`marketing_mailers__html_architect`](https://github.com/Anchit-s-AI-Hustle/marketing_mailers__html_architect)
so the original Mailer Studio stays untouched in production. This repo adds the
retention dashboard + calendar generator on top.

---

## 🛠 Development guide

- **How it's built (architecture + build narrative):** [`DEVELOPMENT.md`](DEVELOPMENT.md)
  — the 12-function Hobby-cap strategy, the think→lock→execute mailer pipeline, the
  8-provider LLM cascade, Smart Brain, the data layer, guardrails, mobile, CI, and
  a "where to make common changes" map.

## 📄 PRD & business deck

- **Complete PRD (v1.0):** [`docs/PRD.md`](docs/PRD.md) — vision, origin story, every
  feature (origin → need → purpose → how it works), architecture, milestones, roadmap.
- **15-slide business deck (with live screenshots):** [`docs/prd-deck.html`](docs/prd-deck.html)
  — served at [`/prd-deck`](https://knickgasm.vercel.app/prd-deck)
  on the live app. Self-contained single file; arrow keys / click to navigate.
- **PDF export of the deck:** [`docs/prd-deck.pdf`](docs/prd-deck.pdf) — served at
  [`/prd-deck.pdf`](https://knickgasm.vercel.app/prd-deck.pdf).
  Same 15 slides, widescreen (16:9), ready to send or print.

## 📱 Mobile super apps (Android / iOS)

The entire OS ships as **one mobile super app** — an installable PWA plus native
Android/iOS Capacitor shells (`android/`, `ios/`, `mobile/` — all code in this repo).
The shells render the live deployment, so **every web deploy is automatically a mobile
release** — no separate app updates needed.

Downloadable builds are published by the **Mobile Builds** workflow
(Actions → Mobile Builds → Run workflow) to the fixed release tag `mobile-latest`:

| Platform | Download |
|---|---|
| Android (APK, direct install) | https://github.com/Anchit-AI-Hustle/knickgasm-lifecycle-os/releases/download/mobile-latest/knickgasm-lifecycle-os.apk |
| iOS (unsigned IPA — sideload via AltStore/Sideloadly, or sign for TestFlight) | https://github.com/Anchit-AI-Hustle/knickgasm-lifecycle-os/releases/download/mobile-latest/knickgasm-lifecycle-os-ios-unsigned.ipa |
| All builds | https://github.com/Anchit-AI-Hustle/knickgasm-lifecycle-os/releases/tag/mobile-latest |

---

## The pipeline

```
┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Stage 01     │    │  Stage 02        │    │  Stage 03        │
│  Data         │──▶ │  Marketing       │──▶ │  Mailer Studio   │
│  Analysis     │    │  Calendar        │    │  (4 variants)    │
│  /dashboard   │    │  /calendar       │    │  /studio         │
└───────────────┘    └──────────────────┘    └──────────────────┘
```

### Stage 01 — Data Analysis (`/dashboard.html`)

- Upload CSV / XLSX (campaigns, customers, orders, products) or run on synthetic
  seed
- Computes 9 RFM segments, channel mix, retention cohorts, cross-sell affinity
- 10 auto-generated strategic insights (severity-ranked)
- Exports any view as CSV
- Source: ported from
  `knickgasm_dtc_data_engine/reports/retention-intelligence.html`

### Stage 02 — Marketing Calendar (`/calendar.html`)

- Reads the analytics state from localStorage (or generates a seed if missing)
- POSTs to `/api/calendar/generate` which returns a 30-day plan
- Plan is segment-aware, festival-aware, capacity-guarded
- Each calendar entry is one-click → buildable into 4 mailer variants
- Festivals data: `data/festivals.json` (US / UK / India / Global, ~100 cultural
  moments — incl. Diwali, Raksha Bandhan, Holi, Republic Day, Independence Day
  for IN)

### Stage 03 — Mailer Studio (`/studio`)

- The original `knickgasm_mailer_architect_v34.html`
- Now produces **4 variants** per send:
  - **A** — Image · Hero (close-up product photography)
  - **B** — Image · Lifestyle (wide editorial scene)
  - **T1** — Text · Editorial (no images, full editorial layout)
  - **T2** — Text · Founder note (warm, personal, one-CTA)
- Cascade unchanged: OpenAI → Anthropic → Gemini → xAI → Groq → Cerebras

---

## New API endpoints

| Endpoint                            | Purpose                                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/calendar/generate`       | Body: `{ days, markets, capacity_per_market_per_week, analytics }`. Returns a 30-day plan with per-send segment, archetype, content type, hero SKU, subject hint, festival, rationale. |
| `POST /api/calendar/trigger-mailer` | Body: `{ entry }` (one calendar row). Runs strategy stage via the LLM cascade, returns 4 variants (A / B / T1 / T2). Does **not** send.                                                |

---

## Deploy (2 commands once GitHub repo exists)

```bash
# 1. Push this directory to a new GitHub repo
gh repo create Anchit-s-AI-Hustle/knickgasm-lifecycle-os --public --source=. --remote=origin --push

# 2. Import to Vercel via dashboard, OR:
vercel link --yes
vercel --prod

# 3. Copy env vars from the original mailer project:
vercel link --yes --project marketing-mailers-html-architect
vercel env pull /tmp/mailer.env --environment=production
# then re-link to this project and bulk-add:
vercel link --yes --project knickgasm-lifecycle-os
cat /tmp/mailer.env | while IFS='=' read -r k v; do
  [ -z "$k" ] && continue
  v="${v%\"}"; v="${v#\"}"
  printf '%s' "$v" | vercel env add "$k" production --force
done
vercel --prod
```

---

## Brand + voice constraints

All inherited from the parent repo (see `CLAUDE.md`):

- Palette: `#D0473E` deep purple · `#6A33D8` lava · `#111111` ink · `#FFFFFF`
  chalk
- Type: Montserrat (headings) + Instrument Sans (body)
- Banned phrases enforced: "streetwear journey", "transform", "liquid lava",
  "LIMITED TIME", "hurry", "don't miss out"

---

## What's NOT included yet

- **Automatic send**. Calendar rows currently produce HTML variants — they don't
  fire emails. Adding a send queue (Klaviyo flow trigger / Postmark / SendGrid)
  is the next phase.
- **Image variants A & B** when triggered from the calendar UI: the brief is
  generated but the actual image render runs in the Mailer Studio. Inline image
  rendering from the calendar is a small extra wire-up.

---

## Merged Automation Modules

### 1. Data Ingestion Engine (`/ingest`)

Contains scripts to pull, parse, and ingest customer lifecycle and DTC
transaction records:

- `ingest_matrixify.py`: Matrixify raw Shopify exports loader.
- `ingest_shopify_analytics.py`: Shopify Analytics transactions loader.
- `ingest_klaviyo.py`: Klaviyo list and email engagement data loader.
- `ingest_webengage.py`: WebEngage customer CDP data loader.
- `sync_to_supabase.py`: Synchronizes the processed DuckDB database data back to
  Supabase.
- Master execution script: `run_all.py` (runs all four ingestion scripts
  sequentially).

### 2. Automated Campaign Trigger Engine (`/mailer_system`)

A Python-based automated campaign generator that runs on a metrics-driven
trigger sequence:

- Evaluates at-risk revenue, 90-day cohort retention, subscription share, and
  list health against threshold definitions in `targets.json`.
- Integrates with the Anthropic Claude API to generate formatted, occasion-aware
  brand emails.
- Saves campaign results dynamically to `outputs/` (HTML + metadata files) and
  logs historical run metadata to `campaign_log.json`.

### 3. Interactive Campaign Compiler (`/marketing_automation`)

An interactive React 19 + Tailwind CSS compiler SPA:

- Renders a visual workspace allowing you to select campaign themes and creative
  variants.
- Connects to an Express custom server (`server.ts`) to request and compile
  local static templates.
- Automatically scrapes and downloads static visual assets locally to guarantee
  offline asset hosting reliability.
