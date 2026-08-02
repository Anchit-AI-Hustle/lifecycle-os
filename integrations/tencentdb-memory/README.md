# TencentDB-Agent-Memory ↔ Claude (MCP bridge)

Gives **any Claude client** persistent long-term memory backed by
[TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) —
Tencent's fully-local L0→L3 memory pyramid (raw conversation → atomic facts →
scenarios → persona) with a symbolic short-term layer.

## Why a bridge is needed

TencentDB-Agent-Memory ships **no MCP / Claude connector** — only an OpenClaw
plugin and a "Hermes" HTTP gateway (REST on `:8420`). Claude speaks **MCP**. So this
folder adds a tiny **MCP server** (`mcp-server.mjs`) that maps the gateway's REST
endpoints onto MCP tools. Nothing is fabricated — every tool call forwards to the
real gateway and returns exactly what it says; if the gateway is down the tool
returns the actual connection error.

```
Claude (Code CLI / Desktop / Web)
        │  MCP stdio (JSON-RPC)
        ▼
  mcp-server.mjs   ← this bridge (zero npm deps)
        │  HTTP REST
        ▼
  Hermes gateway :8420   ← TencentDB-Agent-Memory
        │
        ▼
  local SQLite  (persona · scenarios · atoms · conversations)
```

## Tools exposed to Claude

| Tool | Gateway route | Use |
|---|---|---|
| `memory_recall` | `POST /recall` | Load the `<memory-context>` for a query at **task start**. |
| `memory_capture` | `POST /capture` | Persist a user↔assistant turn (fire-and-forget distillation). |
| `memory_search` | `POST /search/memories` | Semantic search of distilled memories (`persona`/`episodic`/`instruction`). |
| `memory_search_conversations` | `POST /search/conversations` | Semantic search of raw past conversations. |
| `memory_session_end` | `POST /session/end` | Flush pending pipeline work when a task ends. |
| `memory_health` | `GET /health` | Gateway/vector-store health. |

## Setup

### 1. Start the gateway (fully local)

The gateway is local (SQLite). An LLM key is only needed for **distillation**
(turning raw turns into atoms/persona) — capture/recall themselves are local.

```bash
cd integrations/tencentdb-memory
cp gateway.env.example gateway.env      # set TDAI_LLM_API_KEY (OpenAI-compatible)
./setup.sh            # clone + install + start the gateway on :8420  (native node)
#   …or…
./setup.sh --docker   # run it via docker compose instead
curl localhost:8420/health              # -> {"status":"ok",...}
```

`setup.sh` clones the upstream gateway into `vendor/` (gitignored), installs it,
and starts `node --import tsx src/gateway/server.ts`.

### 2. Connect Claude

**a) Claude Code on THIS repo** — already wired. The repo's [`.mcp.json`](../../.mcp.json)
registers the `tencentdb-memory` server, so a Claude Code session opened on this
repo gets the memory tools automatically (approve the server on first use).

**b) Claude Code CLI (any project)** — one command:
```bash
claude mcp add tencentdb-memory -- node "$PWD/integrations/tencentdb-memory/mcp-server.mjs"
```

**c) Claude Desktop** — add to its MCP config (Settings → Developer → Edit Config):
```json
{
  "mcpServers": {
    "tencentdb-memory": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/knickgasm-lifecycle-os/integrations/tencentdb-memory/mcp-server.mjs"],
      "env": { "TDAI_GATEWAY_URL": "http://127.0.0.1:8420" }
    }
  }
}
```

### 3. Verify end-to-end
```bash
cd integrations/tencentdb-memory
npm run smoke     # capture → flush → recall → search against the live gateway
```

## Bridge configuration (env on the MCP server)

| Var | Default | Purpose |
|---|---|---|
| `TDAI_GATEWAY_URL` | `http://127.0.0.1:8420` | Where the gateway listens. |
| `TDAI_GATEWAY_API_KEY` | _(none)_ | Bearer token — set **only** if the gateway was started with one (must match `TDAI_GATEWAY_API_KEY` in `gateway.env`). |
| `TDAI_SESSION` | `claude-default` (repo: `knickgasm-lifecycle-os`) | Default session id when a call omits it. |
| `TDAI_HTTP_TIMEOUT_MS` | `20000` | Per-request timeout. |

## Using it well (suggested habit)

- **Start** of a task: call `memory_recall` with what you're about to do → inject the returned context.
- **After** a meaningful exchange or decision: call `memory_capture`.
- **End** of a task/thread: call `memory_session_end` so distillation completes.

## Notes & limits

- **Ephemeral cloud sessions** (Claude Code on the web) can run the bridge, but a
  gateway started inside that throwaway container is not reachable by your desktop
  app and its SQLite is lost when the container is reclaimed. For durable personal
  memory, run the gateway on a machine that stays up (your laptop, or a small VM)
  and point every Claude client's `TDAI_GATEWAY_URL` at it.
- The bridge has **zero runtime dependencies** (Node ≥18 built-ins only). The
  gateway needs Node ≥22.16.
- Nothing is ever written to an external service by the bridge; the gateway's only
  outbound calls are to the LLM you configure for distillation.
