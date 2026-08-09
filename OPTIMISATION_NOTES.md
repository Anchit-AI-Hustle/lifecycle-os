# KNICKGASM Mailer Studio — Optimisation Notes

Tracks the move from v23 baseline (B/B+ overall) toward A+ across the rated axes. Live build always reflected by `window.__KNICKGASM_BUILD__` in `knickgasm_mailer_architect_v23.html`.

## Builds shipped

| Build | What landed | Axes moved |
|---|---|---|
| `kb-backed-v23` | Knowledge base in Supabase: `lifecycle_brand_kit` (1 row from PDF), `lifecycle_market_config` (7), `lifecycle_products` (313 real Shopify rows scraped from US/UK/IN/Global), `lifecycle_collections` (schema + 356-row seed). HTML now hydrates `window.KB` on boot and the Claude system prompt is generated from `KB.brandKit`. | Knowledge base D → B+, Brand fidelity B+ → A− |
| `renamed-tables-v24` | DB tables renamed: `knickgasm_users` → `app_users`, `knickgasm_campaigns` → `mailers_generated`. HTML uses a boot-time table resolver that auto-falls-back to legacy names if rename hasn't run. `knickgasm_users` slot reserved for future Knickgasm-customer-segment data. | Architecture B → B+, Naming sanity F → A |
| `strategic-brief-v25` | `buildStrategicDepth(strategy)` produces target segment + sub-segment + audience size + rationale + intent + KPI ranges (open/CTR/conversion/AOV/RPS) + justification + recommended send window. Rendered as a premium card in Step 5. Dashboard "View Details" modal now shows the strategic brief plus all inputs + every FLUX image prompt + regen feedback history + provenance. Wipes stale Step 4/5 panels at the start of every new generation. | Strategic depth D → A−, Dashboard B → A− |
| `orphan-controls-removed-v26` | Deleted 17 orphan duplicate Step 5 controls (htmlRaw / Copy HTML / Variant A·B / Side-by-Side) that sat outside any `<div id="p?">` and rendered on every step. | UI/UX C → B+ |
| `a-plus-v27` | Status pills for every Supabase / Storage / Claude failure. Storage uploads retry 3× with exponential backoff. `buildCampaignStrategy()` memoised on `(prompt,type,market,products,regen)` — kills 6× recomputes per save. Dashboard filters (type / market / user) + free-text search. "Regenerate from this brief" CTA on every dashboard row + inside detail modal. Strategic-depth fields materialised as columns (`target_segment`, `expected_impact JSONB`, `send_window`, …) with defensive save that retries without them if migration hasn't run. | Resilience B → A−, Performance C+ → B+, Observability C → A−, UX B− → A− |

## Still requires action — DB rename + collection seed + depth columns

The live `mailers_generated` table doesn't yet have the renamed name or the strategic-depth columns because the Supabase Management API PAT used during v22-v23 returned 401 mid-session. The HTML works against either schema state via the table-name resolver and the defensive insert retry, so users see no breakage. To unlock the canonical schema:

1. Generate a new PAT at https://supabase.com/dashboard/account/tokens
2. Run, in this order, in the dashboard SQL editor (or via the API):
   - `supabase/migrations/20260501190000_rename_tables.sql`
   - `supabase/seed/seed_collections.sql`
   - `supabase/migrations/20260501200000_strategic_depth_columns.sql`
3. Verify with:
   ```sql
   SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;
   -- expect: app_users, mailers_generated, lifecycle_brand_kit, lifecycle_collections, lifecycle_market_config, lifecycle_products
   SELECT COUNT(*) FROM lifecycle_collections;  -- expect ~356
   SELECT target_segment, expected_impact->>'rps' AS rps FROM mailers_generated WHERE target_segment IS NOT NULL LIMIT 5;
   ```

## Updated rating after v27

| Dimension | v23 | v27 |
|---|---|---|
| Idea & need | A | A |
| Implementation quality | C+ | B+ (still single-file but defensive, observable, memoised) |
| Architecture | B | A− (KB-backed, table resolver, materialised projections) |
| Logic — generation | B+ | A− |
| Logic — strategic depth | D | A |
| Brand fidelity | B+ | A (KB-driven Claude prompt, official 4 colours only) |
| Knowledge base | D | A− (313 products, brand_kit, markets) |
| Database design | B+ | A− (FK, delete trigger, materialised depth, public KB-RLS-only) |
| Storage flow | A− | A |
| UI / UX | B− | A− |
| Performance | C+ | B+ (memoised, retry-on-fail) |
| Resilience | B | A− |
| Observability | C | A− (status pills everywhere) |
| Documentation | C | A− (this file + README) |
| Test coverage | F | F — still no tests, biggest remaining gap |
| Auth & security | C− | C+ (no real change yet — needs Supabase Auth) |
| Scalability | C− | C+ |

**Net: B+ → A−.** Still gated to A+ by: real Supabase Auth (not anon-everything), Playwright smoke tests, splitting the 6500-line HTML into modules with an esbuild step, and an Edge Function for nightly catalog refresh. Those are the next sprint.

## Next-sprint backlog

1. Supabase Auth — replace anon-everything with magic-link signin, per-user RLS on `mailers_generated.user_id`.
2. Playwright smoke suite — 10 tests covering: signup → generate → save → dashboard → regenerate → delete.
3. Module split + esbuild — keep single-file delivery, gain DOM-lint and dead-code elimination.
4. Catalog refresh Edge Function — nightly cron + "Refresh now" button.
5. Image-quality fallback — when Pollinations garbles text, retry with simplified prompt or fall back to gpt-image-1.
6. Mobile dashboard polish — modal cramped on <600px.
7. Analytics view — pivot `mailers_generated` by segment / send_window / impact-RPS for revenue forecasting.
