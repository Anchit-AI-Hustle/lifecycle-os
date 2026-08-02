# Knickgasm Lifecycle OS — Unified Architecture & Consolidation Blueprint

> **Goal.** Collapse the separate Knickgasm apps (data engine, mailer studio, calendar, competitor benchmarking, super-app) into **one** application: **Knickgasm Lifecycle OS**. One auth shell, one nav, one Supabase, one deploy. This doc is the north star + the phased build plan.

- **Last updated:** 2026-06-20
- **Absorbs these sibling projects:** `knickgasm_dtc_data_engine`, `marketing_mailers__html_architect`, `Knickgasm-Super-App`, `Data Analysis + Mailer Calendar Creation + Mailer Generation`.
- **Hard constraint:** Vercel Hobby = **12 serverless functions**. Consolidation MUST stay within it (see §6).

---

## 1. The single app, at a glance

```
                         ┌─────────────────────────────────────────────┐
                         │            KNICKGASM LIFECYCLE OS               │
                         │   one auth shell (auth.js) · one nav · PWA   │
                         └─────────────────────────────────────────────┘
   ┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
   │  SUPER APP   │ DATA & INSIGHT│  COMPETITIVE │  CALENDAR &  │  MARKETING   │
   │  (home/hub)  │  (RT + hist.) │  BENCHMARKING│  AUTOMATION  │  STUDIO      │
   └──────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
          │              │              │              │              │
          └──────────────┴──────┬───────┴──────────────┴──────────────┘
                                 │
                  ┌──────────────┴───────────────┐
                  │   TWO AGENTS, ONE BRAIN       │
                  │  • Internal Employee Agent    │  (full data + catalog + ops)
                  │  • User Persona Agents        │  (buyer-safe data only, sales)
                  └──────────────────────────────┘
                                 │
                  ┌──────────────┴───────────────┐
                  │  data-classification layer    │  (buyer-safe ⟷ internal-only)
                  └──────────────────────────────┘
```

---

## 2. Modules & what each must do

| # | Module | Capabilities | Built on |
|---|---|---|---|
| 1 | **Knickgasm Super App (Home/Hub)** | Single landing + global nav into every module; status tiles (today's plan, pending approvals, alerts). | `index.html` + `auth.js` nav |
| 2 | **Data & Insight** | **Real-time** (DB sync) **+ historical** analysis; two ingestion modes: (a) live Supabase sync, (b) **file upload** (CSV/Matrixify/Klaviyo/WebEngage). Exact-number answers via the analyze path. | `dashboard.html`, `lib/smart-brain/services.js` AnalysisService, new upload endpoint, `ingest/` |
| 3 | **Competitive Benchmarking** | Real-time competitor email capture (Gmail IMAP → Sheet/Supabase), trending hooks, by-channel benchmarks. | `competitor.js`, `competitor-benchmarking.html` |
| 4 | **Calendar & Automation** | Real-time calendar creation + **daily review + daily updation**; generate **day / week / month / year** automatically, for **all campaign types** (mailers, ads [Meta/TikTok/Google], landing pages), each with full detail. Human approve/reject. | `calendar.js` smart-brain-*, `smart-brain-plan.js` |
| 5 | **Marketing Studio (manual)** | Manually generate any single asset on demand: mailer (2 variants/region), ads (real creatives), landing pages (try.knickgasm style). | `/studio`, `/ads`, `/landing-pages` |
| 6 | **Internal Employee Agent** | ChatGPT/Claude/Gemini-style assistant for Knickgasm staff. Full access: all data, catalog, ops, generation tools. Task execution for growth work. | new `internal-agent.html` + `brain-agent.js` (internal scope) |
| 7 | **User Persona Agents** | Buyer-facing sales advisors (distinct personas). Drive sales: identify need, explain benefits, why-vs-competitor, taste/health fit. **Buyer-safe data only.** | `agent.html` + `brain-agent.js` (buyer scope) |

---

## 3. Navigation (information architecture)

Top-bar (rendered by `auth.js`) grouped into 4 sections + 2 agents. Proposed routes (add to `vercel.json` rewrites):

```
HOME            /                     Super-app hub
─ INSIGHT
   Analytics    /analytics            dashboard.html (RT + historical)
   Data Sources /data                 NEW: live-sync status + file upload
   Competitors  /competitor           competitor-benchmarking.html
─ PLAN & AUTOMATE
   Calendar     /plan                 calendar.html (day/week/month/year)
   Daily Review /brain                smart-brain.html (approve/reject)
   Automation   /automation           NEW: run granularity + campaign-type matrix
─ CREATE (manual studio)
   Mailers      /studio               knickgasm_mailer_architect_v34.html
   Ads          /ads                  ad-campaigns.html
   Landing Pages/landing-pages        landing-pages.html
   Knowledge    /kb                   knowledge-base.html
─ AGENTS
   Ask Knickgasm   /agent                User persona agents (buyer-safe)
   Team Copilot /team                 NEW: internal employee agent (full access)
```

Every page must show the same nav, highlight the active item, and be reachable in ≤2 clicks from Home. Agent routes are visually separated (buyer vs internal) to avoid leaking internal tools to buyer personas.

---

## 4. Data-classification matrix (buyer-safe ⟷ internal-only)

The two agents MUST draw from different data scopes. Implemented as `api/_shared/data-classification.js` — a single allow/deny map every data fetch passes through.

| Data | Internal Employee Agent | User Persona Agent (buyer) |
|---|---|---|
| Product catalog (names, prices, descriptions, origin, benefits) | ✅ | ✅ |
| Public reviews / ratings, certifications, crafting guidance | ✅ | ✅ |
| Competitor *public* positioning (for "why us") | ✅ | ✅ (framed, never disparaging) |
| Revenue, AOV, margins, ROAS, spend | ✅ | ❌ |
| Customer PII, emails, order history, RFM cohorts | ✅ | ❌ |
| Campaign performance, A/B results, internal benchmarks | ✅ | ❌ |
| Competitor *captured emails*, internal strategy, calendar plan | ✅ | ❌ |
| Generation tooling / approvals / ops actions | ✅ | ❌ |

**Rule:** buyer agents only ever receive a `buyerSafe(...)` projection (catalog + public proof + brand facts). Internal agents get the full set. Default-deny: anything not explicitly buyer-safe is internal-only.

---

## 5. Dual-agent design

- **Shared brain:** both run through `brain-agent.js` + `llm.js` waterfall, but with a `scope: 'internal' | 'buyer'` flag that selects (a) the data projection (§4), (b) the system prompt, (c) the allowed tools.
- **Internal Employee Agent** (`/team`): system prompt = "Knickgasm growth copilot for staff"; tools = analyze (exact numbers), generate assets, query calendar, draft campaigns; full data. Like ChatGPT/Claude for internal ops.
- **User Persona Agents** (`/agent`): multiple personas (e.g. sneaker sommelier, streetwear guide); system prompt = honest sales advisor (current behaviour); buyer-safe data only; goal = need identification → benefit → why-Knickgasm → taste/health fit. No internal numbers, ever.

---

## 6. Function-budget plan (stay ≤12)

Do NOT add one function per new feature. Route new capabilities through existing `?action=` routers:
- **Data upload / sync** → add `?action=upload|sync-data` to a data router (or extend `kb.js`).
- **Automation granularity** (day/week/month/year) → `calendar.js?action=automate&granularity=...&types=...`.
- **Internal agent** → `brain.js?action=team-chat` (reuse, scope flag) — no new file.
Keep heavy logic in `api/_shared/`.

---

## 7. Phased roadmap

**Phase 0 — Foundation (decision-light, start now):**
- `api/_shared/data-classification.js` (the §4 matrix + `buyerSafe()` projection).
- Wire existing buyer agent to buyer-safe scope; add internal scope flag.
- Unified nav in `auth.js` reflecting §3.

**Phase 1 — Data & Automation:**
- `/data` page: file upload (CSV/Matrixify/Klaviyo) → Supabase + live-sync status.
- `calendar.js?action=automate`: generate day/week/month/year for all campaign types in one run.

**Phase 2 — Agents:**
- `/team` internal employee agent (full-access copilot, task execution).
- Multi-persona buyer agents on `/agent`.

**Phase 3 — Super-app polish:**
- Home hub tiles (today's plan, pending approvals, alerts), cross-module deep links, PWA install.

**Phase 4 — Retire siblings:**
- Migrate any unique logic from `knickgasm_dtc_data_engine` / `marketing_mailers__html_architect` / `Knickgasm-Super-App`, redirect their domains here, archive the repos.

---

## 8. Migration notes from sibling projects

| Sibling | Bring over | Into |
|---|---|---|
| `knickgasm_dtc_data_engine` | ingestion pipelines, DuckDB DDL, sync-to-supabase | `/data` + `ingest/` |
| `marketing_mailers__html_architect` | any mailer archetypes/templates not already here | `/studio` |
| `Knickgasm-Super-App` | super-app shell/nav ideas | Home hub `/` |
| "Data Analysis + Mailer Calendar…" | calendar/analysis logic | `/analytics` + `/plan` |
