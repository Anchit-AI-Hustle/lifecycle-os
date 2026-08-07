# KNICKGASM Lifecycle OS — Consolidated Project Status

**As of:** 2026-07-17 · **Live:** https://knickgasm.vercel.app (→ knickgasm-lifecycle-os.anchit-tandon.com)
**Scope of this doc:** a single reconciled snapshot of everything built across all sessions. The
**repository is the source of truth** — every merged PR from every session is reflected here
(53 app pages, 71 `api/_shared` modules, 38 Supabase migrations, 60+ friendly routes, 12 serverless
functions at the Hobby cap). Governed by `docs/campaign-orchestration-master-spec.md` (zero
fabrication, closed source-of-truth, design HARD rules, launch gate).

---

## 1. Data integration & live connectors

| Platform | State | How | Blocker to go fully live |
|---|---|---|---|
| **Klaviyo** | ✅ Live | `/api/klaviyo` router (segments/events/metrics/lists/profiles, cursor-paginated); fixed for revision 2024-10-15 | — (`KLAVIYO_API_KEY` set) |
| **Supabase** | ✅ Live | Service role; all stored tables + reads | — |
| **Shopify** | ⚠️ Read via exports | Public storefront scrape + real CSV market exports (`data/market/*`) power `/analytics` + KicksGPT | **`SHOPIFY_STORE_DOMAIN` + read-scoped `SHOPIFY_ADMIN_TOKEN`** |
| **WebEngage** | ⚠️ Built, empty | `webengage_events` table + reads + KicksGPT tool; 12h sync ready | **`WEBENGAGE_EXPORT_URL`+`WEBENGAGE_API_KEY`** or the `webengage-dumps` bucket |
| **Snowflake** | Scaffolded | `?action=snowflake-sync` / `snowflake-metrics` | creds |

- **Pure-GET 12h polling pipeline** — `ingest/poll_12h_ingest.py` pulls the last 12h from Shopify (Admin, Link-pagination), Klaviyo (`/events`, cursor), WebEngage (data-export) into **isolated tables** `shopify_orders` / `klaviyo_events` / `webengage_events` (platform-id unique → idempotent upsert; GIN+B-Tree indexes). Read-only, per-platform try/except, 429 backoff.
- **Live health probe:** `GET /api/connectors-health` does a real round-trip per platform → `{live, latency_ms, sample, blocker}`. Never fabricates.
- **Read-only egress guard** (`read-only-egress.js`): Shopify/Klaviyo/WebEngage are structurally fetch-only — writes throw before they leave. **Nothing is ever written back to those platforms.**

## 2. KicksGPT / SteepSense — the brand LLM
Provider-agnostic tool-calling loop over the 6-provider `llm.js` waterfall. Tools:
`catalog_products · market_performance · ask_analytics · webengage_performance · run_analysis ·
validate_data_accuracy · analyst_insights · list_cohorts · get_calendar · get_competitor_benchmarks ·
search_knowledge_base · list_campaigns · generate_calendar* · generate_assets_for_slot* ·
run_agentic_campaign* · generate_mailer_assets* · klaviyo` (*=writes, explicit ask only).
- **Full-LLM behavior:** answers general/strategic/how-to questions directly (own reasoning), not just tool/KB lookups.
- **Asks when ambiguous** (region/product/cohort/goal/window) and **remembers the choice** (sticky region context) for the rest of the chat.
- **Real numbers:** `market_performance` reads the real Shopify CSV exports (top products, MoM, run-rate projection) — no more `$0`.
- Evidence contract, zero fabrication, brand-voice + banned-phrase enforcement.

## 3. Campaign generation & the calendar brain
- **Smart Brain (`/brain`):** rolling 90-day plan, 3–4 cohort sends/day/market, prebuilt asset bundles (mailer + Meta/Google/TikTok ads + landing page), human approve/reject.
  - **Preview persistence:** a slot is built **once**, persisted, then View/Download load instantly (no regeneration). Approve reuses only full `__prebuilt` (never hero-only preview).
  - **Bulk actions:** Generate all · **Approve all** · Download all (nested ZIP), stacked CTAs.
  - **Region-aware revenue target:** US = **$1,000/day**, others $1,500 (feasibility per slot).
  - Confidence variance (no flat 0.7), plan-time rolling-7-day frequency cap, honest reach (no fabricated ~20k).
- **Mailer Studio (`/studio`)** · **Mailer Calendar (`/mailer-calendar`)** · **USA July calendar (`/july-studio`)** · flagship renderer with verified `brand_assets` only.
- **Ads:** Static + Video creatives per channel (Meta/Google/YouTube/TikTok/Pinterest) + an **Ads QA Critic** verification pass.
- **Social Media OS (`/social`)**, **KicksGPT (`/kicksgpt`)**, competitor benchmarking (`/competitor`, real landing pages + brand detail), Design Intelligence (`/design-intel`).

## 4. Analytics, accuracy & alerts
- **`/analytics`** (data-analysis) — real US/UK market data, WoW/MoM/YoY selector, **hover tooltips show the exact metric at each point**, CSV export.
- **USA D2C Dashboard (`/usa-d2c-dashboard`)** — the two-view (Executive + Task-by-Task) enterprise report.
- **Data-accuracy validation agent** — re-derives every metric from live data vs the canonical report; flags PASS/MISMATCH/MISSING/MISLEADING so no recommendation is built on a bad figure.
- **Red-alert / alerts-core** — revenue/orders/AOV anomaly detection, emails the `ALERT_EMAIL` recipient (env-driven; no hardcoded mailbox) via `RESEND_API_KEY`. Gated by the `LIVE_CONNECTORS` kill-switch (default off — sends are stubbed until set to `on`).

## 5. Knowledge base & daily learning
- **Ingest guardrail** (2-phase): Phase 1 deterministic (brand whitelist, US/UK/IN/Global geo + $/£/₹, relevance lexicon, junk blocklist) → Phase 2 strict LLM gatekeeper (`{is_actionable_context, rejection_reason}`); junk never enters the KB.
- **Zero-drift tags** `{market, vertical}` on every row (RAG-filterable). **Daily D2C Digest** synthesises the clean 24h log into one operational lesson. Seeded with the `.in`-vs-`.com` strategic teardown.

## 6. Design & storefront (3D)
- **3D storefront variations** `/3d/us · /3d/uk · /3d/global` — full-page 3D-design homes from **real catalog + real prices/ratings**, every product links to its real PDP, `try.knickgasm.*` canonical. Reproducible via `scripts/build-storefront-3d.js`.
- **Knickgasm3D Connector Engine** (`/3d-connector`, `/spatial-store`) — region routing + dual-data + Meta-lander engine.
- **Template gallery** (`/templates`), **Website Designs** (`/website-designs`, Shopify metric-justification CRO layer), **Official Designs** (`/official-designs`).
- **Global 3D depth layer** (`theme.css`) — app-wide elevation shadows + hover lift/tilt + 3D buttons; hover-only, reduced-motion safe, nav excluded.
- **One light theme** across the whole suite (white backgrounds, dark text); contrast sweeps applied.

## 7. Platform & governance
- Single Vercel project, `framework:null`; 12 serverless functions (Hobby cap) — multi-capability routers via `?action=`; heavy logic in `api/_shared/` (not counted).
- Auth: Supabase-mediated Google sign-in via `auth.js` shell + LHS nav IA.
- Brand constants enforced (palette #D0473E/#6A33D8/#111111/#FFFFFF, Montserrat/Proxima, banned phrases, no em/en dashes).
- CI: HTML smoke + `npm run build` + Playwright visual/invariant tests + CodeQL.

---

## 8. Requested items — completed this session
- ✅ `/brain` **Approve all** + stacked bulk CTAs; View/Download **never regenerate** (persisted).
- ✅ Klaviyo connected + read-op fixes + cursor pagination; **full real audience enumerated**.
- ✅ **US = $1,000/day** feasibility recalibration.
- ✅ `/analytics` **hover tooltips**.
- ✅ KicksGPT **real sales answers** (market_performance) + **full-LLM upgrade** (ask-for-region, sticky context, general answers).
- ✅ **KB ingest guardrail** (Phase 1/2/3) + `{market,vertical}` tags + Daily Digest + teardown seed.
- ✅ **WebEngage integration** + **pure-GET 12h polling pipeline** (Shopify/Klaviyo/WebEngage) into isolated tables.
- ✅ **Connector live-probe** (`/api/connectors-health`) + 3 review-bug fixes (market coercion, approve-reuse, WebEngage data-loss).
- ✅ **3D storefronts** (US/UK/Global, real data) + **global 3D depth layer** across the app.
- ✅ Copy-resilience (token bump) to reduce template-fallback.

## 9. Open — waiting on credentials / decisions
1. **Shopify read Admin token** (`SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ADMIN_TOKEN`) → live orders/customers/inventory + the D2C dashboard's blocked tasks. **Biggest unlock.**
2. **WebEngage** export URL+key (or the Storage bucket) → live push/campaign data.
3. **Funded LLM key** (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) → ends template-fallback, powers KicksGPT narrative reliably.
4. **US Klaviyo segments** (US Consented / Engaged 90d / Buyers / Non-buyers) → exact US sizing for the 21-day plan.
5. Schedule the 12h poller on the cron; point analytics reads at the stored ingestion tables.

## 10. Next build increments (queued)
- Landing-page clones under `try.knickgasm.co*` (same real-data generator).
- Deeper category/PDP pages per region.
- Wire the D2C dashboard's live tasks once Shopify is connected.
