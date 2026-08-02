#!/usr/bin/env bash
# One-command setup for the TencentDB-Agent-Memory <-> Claude bridge.
#
#   ./setup.sh            # clone + install the gateway, print the Claude MCP config
#   ./setup.sh --docker   # use docker compose instead of a local node process
#
# Nothing here writes to any external service. The gateway is fully local (SQLite);
# only memory DISTILLATION calls your configured LLM (TDAI_LLM_API_KEY in gateway.env).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

GATEWAY_REPO="https://github.com/TencentCloud/TencentDB-Agent-Memory.git"
VENDOR="$HERE/vendor"          # gitignored clone of the upstream gateway
PORT="${MEMORY_TENCENTDB_GATEWAY_PORT:-8420}"

log(){ printf '\033[0;32m[setup]\033[0m %s\n' "$*"; }
warn(){ printf '\033[0;33m[setup]\033[0m %s\n' "$*"; }

# 0) env file
if [ ! -f gateway.env ]; then
  cp gateway.env.example gateway.env
  warn "created gateway.env from the example — edit it and set TDAI_LLM_API_KEY before first use."
fi

if [ "${1:-}" = "--docker" ]; then
  log "starting gateway via docker compose ..."
  docker compose up -d
  log "waiting for health ..."
  for _ in $(seq 1 30); do
    if curl -fsS "localhost:${PORT}/health" >/dev/null 2>&1; then log "gateway healthy on :${PORT}"; break; fi
    sleep 3
  done
else
  # 1) clone / update the upstream gateway
  if [ ! -d "$VENDOR/.git" ]; then
    log "cloning gateway into vendor/ ..."
    git clone --depth 1 "$GATEWAY_REPO" "$VENDOR"
  else
    log "updating vendor/ ..."
    git -C "$VENDOR" pull --ff-only || warn "could not fast-forward vendor/ (local changes?) — continuing"
  fi
  # 2) install gateway deps
  log "installing gateway deps (this can take a minute) ..."
  ( cd "$VENDOR" && npm install --no-audit --no-fund )
  # 3) start it in the background
  log "starting gateway on :${PORT} ..."
  set -a; . "$HERE/gateway.env"; set +a
  ( cd "$VENDOR" && nohup node --import tsx src/gateway/server.ts > "$HERE/gateway.log" 2>&1 & echo $! > "$HERE/gateway.pid" )
  sleep 3
  if curl -fsS "localhost:${PORT}/health" >/dev/null 2>&1; then
    log "gateway healthy on :${PORT} (pid $(cat "$HERE/gateway.pid"), logs -> gateway.log)"
  else
    warn "gateway did not answer /health yet — check gateway.log. It may still be warming up."
  fi
fi

cat <<EOF

────────────────────────────────────────────────────────────────────────
 Gateway ready.  Now connect Claude to the bridge.

 • Claude Code (this repo): already wired via ./.mcp.json — just reopen the
   session; the "tencentdb-memory" tools appear automatically.

 • Claude Code CLI (any project) — run once:
     claude mcp add tencentdb-memory -- node "$HERE/mcp-server.mjs"

 • Claude Desktop — add to its MCP config:
     "tencentdb-memory": {
       "command": "node",
       "args": ["$HERE/mcp-server.mjs"],
       "env": { "TDAI_GATEWAY_URL": "http://127.0.0.1:${PORT}" }
     }

 Verify end-to-end:  npm run smoke
────────────────────────────────────────────────────────────────────────
EOF
