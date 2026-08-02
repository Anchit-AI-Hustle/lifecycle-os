# Go-Live Runbook — Marketing Automation on real data

The code is deployed and green. This is the exact sequence to take the Smart
Brain + Competitive Intelligence from "running on fallbacks" to "running on real
KNICKGASM data with the real logic path." Steps are ordered; each is idempotent.

## 1. Apply the schema (once)
Supabase → SQL Editor → paste & run:
```
supabase/APPLY_MARKETING_AUTOMATION.sql
```
Creates the `smart_*` (brain) + `ci_*` (competitive intelligence) tables. Safe to
re-run; safe on a project that already has the base Mailer-Studio schema.

## 2. Point the brain at the DB
The brain reads `data/linked-db.json` (URL + anon key) by default. For writes
(seeding, cron persistence) set a service-role key in Vercel env:
```
SMART_BRAIN_SUPABASE_URL=https://<project>.supabase.co
SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY=<service-role key>
```

## 3. Seed real products (have-it data)
```
npm run seed:products            # 376 real catalog products → smart_products
DRY_RUN=1 npm run seed:products  # preview mapping without writing
```

## 4. Load the rest of the linked data (your exports)
The brain's real logic needs these tables populated (the brand kit already uses
the correct built-in fallback, so it needs nothing):
| Table | Feeds | Source |
|---|---|---|
| `smart_campaigns` + `smart_campaign_metrics` | library scoring, "what worked", thresholds | historical campaign export |
| `smart_users` | cohort building (8 cohorts) | user/CRM export |
| `smart_orders`, `smart_events` | order/engagement signals | commerce export |
| `smart_sales_history` | festival/seasonal auto-extraction | sales-by-day export |
| `smart_competitor_campaigns` | benchmarking (read-only stream) | competitor capture |
| **post-purchase data** | cohorts + analysis enrichment | `postpurchase-tan` (see §7) |

Until these are loaded, the brain falls back to safe defaults; load them and the
real path activates automatically (no code change).

## 5. Turn on Competitive-Intelligence collection (off-Vercel)
```
# .env.local: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APIFY_TOKEN (optional)
# Supabase: create a public Storage bucket  ci-captures
npm run collect:ads      # Meta Ad Library (Apify) + Google/TikTok breadcrumbs
npm run collect:landing  # Playwright render + screenshots + parse
npm run collect:wayback  # historical landing snapshots
```
The Vercel daily cron then enriches + benchmarks whatever they deposit.

## 6. Automation (already wired)
- `vercel.json` crons: `/api/brain?action=cron` (03:30 UTC — daily analysis +
  calendar review + festival extraction) and `/api/competitor?action=ci-daily`
  (email mirror + enrichment). Vercel sends `Authorization: Bearer $CRON_SECRET`.
- Generation runs for **approved** slots only (HITL): `/api/brain?action=generate`.
- Voice: free by default (Pollinations + browser TTS). Optional premium:
  `ELEVENLABS_API_KEY`.

## 7. Post-purchase ingestion (pending access)
`postpurchase-tan` is not reachable from the build environment and isn't in this
session's repo scope. To wire it: **add its GitHub repo to this environment's
repository scope** (Claude Code web settings) — a scope change may require a new
session — then I'll read its schema and build the ingestion → cohorts/analysis.
Alternatives: load it into the linked Supabase DB (tell me the table) or paste
its schema + a sample.

## 8. What's intentionally NOT live (Phase 2)
Live push to Google/Meta/TikTok/Klaviyo/WebEngage. Generation already emits a
platform-ready `campaign_object` per channel, so Phase-2 adapters plug into the
same schema without a refactor — but no adapter is built (per the brief).

---
### One-look status
| Capability | State |
|---|---|
| Generation: mailers / ads / landing pages (premium) | ✅ real code |
| LP routing: Campaign-Hub themes ↔ LLM long-form | ✅ integrated |
| Daily analysis / calendar / festival / MVT / HITL | ✅ on `main` |
| Products on real data | ✅ via `npm run seed:products` |
| Campaigns / users / sales / competitor data | ⏳ load your exports (§4) |
| Post-purchase integration | ⛔ blocked on repo access (§7) |
| Live platform push | 🚫 Phase 2 (by design) |
