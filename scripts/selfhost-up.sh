#!/usr/bin/env bash
# selfhost-up.sh — start (or stop) the stack in the mode selfhost/.env declares.
#
#   scripts/selfhost-up.sh            up -d   (adds --profile local-db when DB_MODE=local)
#   scripts/selfhost-up.sh down       stop
#   scripts/selfhost-up.sh ps|logs …  any other compose verb, mode-aware
#   --caddy as the first argument layers docker-compose.caddy.yml (TLS).
#
# It refuses to start when .env contradicts its own DB_MODE (an external mode
# still pointing at `db`, or missing sslmode=require) — the services would
# crash-loop with a message far less clear than this one.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIT="$ROOT/selfhost"
ENV_FILE="${SELFHOST_ENV:-$KIT/.env}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE — cp selfhost/.env.example selfhost/.env && node scripts/selfhost-keys.js --write" >&2; exit 1; }

MODE="$(SELFHOST_ENV="$ENV_FILE" node "$ROOT/scripts/lib/selfhost-compose.js" mode)" || exit 2

FILES=(-f "$KIT/docker-compose.yml")
if [ "${1:-}" = "--caddy" ]; then FILES+=(-f "$KIT/docker-compose.caddy.yml"); shift; fi
PROFILE=()
[ "$MODE" = local ] && PROFILE=(--profile local-db)

if [ $# -eq 0 ]; then set -- up -d; fi
echo "== docker compose (DB_MODE=$MODE) $*"
exec docker compose "${FILES[@]}" --env-file "$ENV_FILE" ${PROFILE[@]+"${PROFILE[@]}"} "$@"
