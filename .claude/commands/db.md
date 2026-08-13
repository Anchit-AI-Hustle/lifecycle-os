---
name: db
description: Query, design, or migrate the Lifecycle OS Supabase (Postgres) database.
argument-hint: "[ask, e.g. 'show schema for smart_calendar_entries' or 'add column X to ads_generated']"
---

# Database — Supabase (Postgres)

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Handle: `$ARGUMENTS` using the **`supabase`** skill (and `supabase-postgres-best-practices` for tuning).

## Map
- Migrations: `supabase/migrations/` (timestamped). Apply-all bundle: `supabase/COMBINED_RUN_THIS.sql`. Seeds: `supabase/seed/`.
- Key tables: `smart_calendar_entries` (rolling 15-day plan), `ads_generated`, `landing_pages_generated`, KB tables, captured competitor emails, RFM/cohort data.
- Front-end gets URL + anon key from `/api/public-config`. **Service-role keys are NEVER exposed there** — keep it that way.

## Rules
- **Schema changes go through a new timestamped migration** in `supabase/migrations/` — never ad-hoc edits. Mirror into `COMBINED_RUN_THIS.sql` if that's the apply path.
- Reads/exploration are fine to run directly; **confirm before destructive DDL/DML.**
- Follow `supabase-postgres-best-practices` for indexing/RLS/query shape.

## Output
For queries: the SQL + results. For design: the migration file + rationale + rollback note. For architecture: an ER-level explanation grounded in the existing tables.
