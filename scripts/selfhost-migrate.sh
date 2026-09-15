#!/usr/bin/env bash
# selfhost-migrate.sh — apply this repo's schema to the self-hosted database.
# ---------------------------------------------------------------------------
# Order:
#   1. DB_MODE=external only: scripts/selfhost-bootstrap-db.sql (roles,
#      schemas, auth.uid() & co., the publication) — BEFORE anything else,
#      because a managed Postgres has none of it. Safe to re-run.
#   2. wait until storage-api and GoTrue have created storage.buckets and
#      auth.users (they do so at boot; the app migrations reference both).
#   3. supabase/migrations/*.sql in TIMESTAMP order — the order printed by
#      `node scripts/lib/selfhost-compose.js migrations`, which is the same
#      function the test suite executes. supabase/COMBINED_RUN_THIS.sql is
#      NOT used: measured on 2026-09-15 it holds 8 of the 58 migrations
#      (54 KB of 388 KB), so it is a stale bundle, not a source of truth.
#   4. supabase/seed/*.sql, by name.
#
# Idempotent by LEDGER: every file applied is recorded in
# selfhost.applied_files with its sha256, and a re-run skips it. (The
# Supabase CLI's schema_migrations table was not reused because its key is
# the numeric prefix alone and this repo has three prefixes used twice:
# 20260609, 20260610, 20260703.) Each file runs in one transaction with its
# ledger row, so a failure leaves neither a half-applied file nor a false
# record. No migration here carries its own BEGIN/COMMIT (checked).
#
# Flags:
#   --bootstrap   run step 1 only (external mode: do this before `up`)
#   --list        print the order and exit
#   --no-seed     skip step 4
#   --force       re-apply a file whose content changed since it was recorded
#   --no-wait     skip step 2 (you know the services have booted)
#
# psql: uses the host's psql when present; otherwise `docker compose exec db`
# in local mode or a throwaway postgres:17-alpine container in external mode.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIT="$ROOT/selfhost"
ENV_FILE="${SELFHOST_ENV:-$KIT/.env}"
LIB="$ROOT/scripts/lib/selfhost-compose.js"

BOOTSTRAP_ONLY=0; LIST=0; SEED=1; FORCE=0; WAIT=1
for a in "$@"; do
  case "$a" in
    --bootstrap) BOOTSTRAP_ONLY=1 ;;
    --list) LIST=1 ;;
    --no-seed) SEED=0 ;;
    --force) FORCE=1 ;;
    --no-wait) WAIT=0 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown flag: $a" >&2; exit 64 ;;
  esac
done

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — cp selfhost/.env.example selfhost/.env and run node scripts/selfhost-keys.js --write" >&2; exit 1; }
eval "$(SELFHOST_ENV="$ENV_FILE" node "$LIB" env)"
MODE="$(SELFHOST_ENV="$ENV_FILE" node "$LIB" mode)" || { echo "fix selfhost/.env before migrating" >&2; exit 2; }

if [ "$LIST" = 1 ]; then
  echo "# mode: $MODE"
  [ "$MODE" = external ] && echo "scripts/selfhost-bootstrap-db.sql"
  node "$LIB" migrations | sed 's|^|supabase/migrations/|'
  ls "$ROOT/supabase/seed"/*.sql | sed "s|^$ROOT/||"
  exit 0
fi

# ── how do we reach psql? ───────────────────────────────────────────────
URLENC_PW="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$POSTGRES_PASSWORD")"
if [ "$MODE" = external ]; then
  DBURL="postgres://${POSTGRES_USER}:${URLENC_PW}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=${POSTGRES_SSLMODE}"
else
  DBURL="postgres://${POSTGRES_USER}:${URLENC_PW}@127.0.0.1:${POSTGRES_HOST_PORT:-5432}/${POSTGRES_DB}?sslmode=disable"
fi

run_psql() {   # stdin = SQL; args = extra psql flags
  if [ -n "${PSQL:-}" ]; then
    "$PSQL" "$DBURL" -v ON_ERROR_STOP=1 -q "$@"
  elif command -v psql >/dev/null 2>&1; then
    psql "$DBURL" -v ON_ERROR_STOP=1 -q "$@"
  elif [ "$MODE" = local ]; then
    docker compose -f "$KIT/docker-compose.yml" --env-file "$ENV_FILE" --profile local-db exec -T db \
      psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q "$@"
  else
    docker run --rm -i postgres:17-alpine psql "$DBURL" -v ON_ERROR_STOP=1 -q "$@"
  fi
}

# ── 1. bootstrap (external) ─────────────────────────────────────────────
if [ "$MODE" = external ]; then
  echo "== bootstrap (DB_MODE=external): scripts/selfhost-bootstrap-db.sql"
  run_psql -v pw="$POSTGRES_PASSWORD" < "$ROOT/scripts/selfhost-bootstrap-db.sql"
  echo "   bootstrap applied (idempotent; warnings above name anything a non-superuser could not grant)"
else
  # the local image already ran upstream's init scripts; only the ledger is ours
  run_psql <<'SQL'
create schema if not exists selfhost;
create table if not exists selfhost.applied_files (filename text primary key, sha256 text not null, applied_at timestamptz not null default now());
SQL
fi
[ "$BOOTSTRAP_ONLY" = 1 ] && { echo "== bootstrap only; now: scripts/selfhost-up.sh, then re-run this script"; exit 0; }

# ── 2. wait for the services' own schemas ───────────────────────────────
if [ "$WAIT" = 1 ]; then
  echo "== waiting for storage-api (storage.buckets) and GoTrue (auth.users) to have created their tables"
  for i in $(seq 1 60); do
    ready="$(printf "select (to_regclass('storage.buckets') is not null and to_regclass('auth.users') is not null)::text;" | run_psql -tA || true)"
    [ "$ready" = "t" ] && break
    [ "$i" = 60 ] && { echo "   still missing after 120s. Is the stack up (scripts/selfhost-up.sh)? Check: docker compose -f selfhost/docker-compose.yml logs storage auth" >&2; exit 3; }
    sleep 2
  done
  echo "   ready"
fi

# ── 3 + 4. migrations in timestamp order, then seeds ────────────────────
apply_file() {   # rel path from ROOT
  local rel="$1" abs="$ROOT/$1" sum recorded
  sum="$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$abs")"
  recorded="$(printf "select sha256 from selfhost.applied_files where filename = '%s';" "$rel" | run_psql -tA)"
  if [ "$recorded" = "$sum" ]; then echo "   skip    $rel (applied)"; return 0; fi
  if [ -n "$recorded" ] && [ "$FORCE" != 1 ]; then
    echo "   CHANGED $rel — applied before with a different hash; --force to re-apply" >&2; return 0
  fi
  echo "   apply   $rel"
  {
    echo 'begin;'
    cat "$abs"
    printf "\ninsert into selfhost.applied_files (filename, sha256) values ('%s', '%s') on conflict (filename) do update set sha256 = excluded.sha256, applied_at = now();\ncommit;\n" "$rel" "$sum"
  } | run_psql
}

echo "== migrations (timestamp order)"
while IFS= read -r f; do apply_file "supabase/migrations/$f"; done < <(node "$LIB" migrations)

if [ "$SEED" = 1 ]; then
  echo "== seeds"
  for f in "$ROOT"/supabase/seed/*.sql; do apply_file "supabase/seed/$(basename "$f")"; done
fi

echo "== done. Next: node scripts/selfhost-buckets.js && node scripts/selfhost-check.js"
