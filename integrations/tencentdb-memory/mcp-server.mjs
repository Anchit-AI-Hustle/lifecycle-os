#!/usr/bin/env node
/**
 * TencentDB-Agent-Memory <-> Claude MCP bridge
 * ------------------------------------------------------------------------
 * TencentDB-Agent-Memory (https://github.com/TencentCloud/TencentDB-Agent-Memory)
 * ships NO native MCP/Claude connector — only an OpenClaw plugin and a "Hermes"
 * HTTP gateway (REST: /recall /capture /search/* /session/end /health on port
 * 8420). This file is a thin, dependency-light MCP server that maps that gateway
 * onto MCP tools so ANY Claude client (Claude Code CLI, the desktop app, or a
 * Claude Code web session on this repo) gets the project's L0-L3 long-term memory.
 *
 * It speaks the MCP stdio transport directly as newline-delimited JSON-RPC 2.0 —
 * ZERO npm dependencies, so it runs with just Node >= 18 (the gateway itself needs
 * Node >= 22.16). Every tool call forwards to the real gateway via fetch; nothing
 * is fabricated — if the gateway is down, the tool returns the actual error.
 *
 * Config (env):
 *   TDAI_GATEWAY_URL      base URL of the running gateway (default http://127.0.0.1:8420)
 *   TDAI_GATEWAY_API_KEY  Bearer token, only if the gateway was started with one
 *   TDAI_SESSION          default session_key used when a tool call omits it
 *                         (default "claude-default"). Lets single-shot calls work.
 *   TDAI_HTTP_TIMEOUT_MS  per-request timeout (default 20000)
 */

'use strict';

const GATEWAY = (process.env.TDAI_GATEWAY_URL || 'http://127.0.0.1:8420').replace(/\/+$/, '');
const API_KEY = process.env.TDAI_GATEWAY_API_KEY || '';
const DEFAULT_SESSION = process.env.TDAI_SESSION || 'claude-default';
const TIMEOUT_MS = parseInt(process.env.TDAI_HTTP_TIMEOUT_MS || '20000', 10);
const SERVER_INFO = { name: 'tencentdb-memory', version: '1.0.0' };
const PROTOCOL_VERSION = '2024-11-05';

// ── gateway HTTP client ───────────────────────────────────────────────────
async function gateway(method, path, body) {
  const url = GATEWAY + path;
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = 'Bearer ' + API_KEY;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* non-JSON */ }
    if (!res.ok) {
      const detail = (json && (json.error || json.message)) || text || res.statusText;
      throw new Error(`gateway ${method} ${path} -> HTTP ${res.status}: ${String(detail).slice(0, 500)}`);
    }
    return json !== null ? json : text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`gateway ${method} ${path} timed out after ${TIMEOUT_MS}ms (is it running at ${GATEWAY}?)`);
    if (e.cause && (e.cause.code === 'ECONNREFUSED' || e.cause.code === 'ENOTFOUND')) {
      throw new Error(`cannot reach the TencentDB memory gateway at ${GATEWAY} — start it (see integrations/tencentdb-memory/README.md) then retry. (${e.cause.code})`);
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ── tool definitions (JSON-Schema input) + handlers ───────────────────────
const TOOLS = [
  {
    name: 'memory_recall',
    description: 'Recall relevant long-term memory (persona + episodic + instructions) for the current query, as a ready-to-inject <memory-context> block. Call this at the START of a task to load what is already known about the user/project before answering.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you are about to work on / the user question, used to retrieve relevant memory.' },
        session_key: { type: 'string', description: 'Conversation/session id. Defaults to the configured session.' },
      },
      required: ['query'],
    },
    run: (a) => gateway('POST', '/recall', { query: a.query, session_key: a.session_key || DEFAULT_SESSION }),
  },
  {
    name: 'memory_capture',
    description: 'Persist a completed user<->assistant exchange into long-term memory (fire-and-forget; the pipeline distills it into atoms/scenarios/persona). Call after a meaningful turn so future sessions remember it.',
    inputSchema: {
      type: 'object',
      properties: {
        user_content: { type: 'string', description: 'What the user said this turn.' },
        assistant_content: { type: 'string', description: 'What the assistant answered this turn.' },
        session_key: { type: 'string', description: 'Conversation/session id. Defaults to the configured session.' },
        session_id: { type: 'string', description: 'Optional secondary session identifier.' },
      },
      required: ['user_content', 'assistant_content'],
    },
    run: (a) => gateway('POST', '/capture', {
      user_content: a.user_content,
      assistant_content: a.assistant_content,
      session_key: a.session_key || DEFAULT_SESSION,
      ...(a.session_id ? { session_id: a.session_id } : {}),
    }),
  },
  {
    name: 'memory_search',
    description: 'Search distilled long-term memories (persona / episodic / instruction) by semantic query. Use when you need specific known facts, preferences, or past decisions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Semantic search query.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Max results (1-20, default 5).' },
        type: { type: 'string', enum: ['persona', 'episodic', 'instruction'], description: 'Restrict to a memory layer.' },
        scene: { type: 'string', description: 'Optional scene/scenario filter.' },
      },
      required: ['query'],
    },
    run: (a) => gateway('POST', '/search/memories', {
      query: a.query,
      ...(a.limit ? { limit: a.limit } : {}),
      ...(a.type ? { type: a.type } : {}),
      ...(a.scene ? { scene: a.scene } : {}),
    }),
  },
  {
    name: 'memory_search_conversations',
    description: 'Search raw past conversations (L0) by semantic query, optionally within a session.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Semantic search query.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Max results (1-20, default 5).' },
        session_key: { type: 'string', description: 'Restrict to a session.' },
      },
      required: ['query'],
    },
    run: (a) => gateway('POST', '/search/conversations', {
      query: a.query,
      ...(a.limit ? { limit: a.limit } : {}),
      ...(a.session_key ? { session_key: a.session_key } : {}),
    }),
  },
  {
    name: 'memory_session_end',
    description: 'Flush any pending memory-pipeline work for a session (call when a task/conversation is finished so distillation completes).',
    inputSchema: {
      type: 'object',
      properties: {
        session_key: { type: 'string', description: 'Session to flush. Defaults to the configured session.' },
      },
    },
    run: (a) => gateway('POST', '/session/end', { session_key: a.session_key || DEFAULT_SESSION }),
  },
  {
    name: 'memory_health',
    description: 'Check the memory gateway health (vector store + embedding service). Returns status ok/degraded.',
    inputSchema: { type: 'object', properties: {} },
    run: () => gateway('GET', '/health'),
  },
];
const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

// ── minimal MCP stdio JSON-RPC 2.0 server (newline-delimited) ─────────────
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg || {};
  // notifications (no id) — never reply
  if (id === undefined || id === null) {
    return; // e.g. notifications/initialized, notifications/cancelled
  }
  try {
    if (method === 'initialize') {
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'Long-term agent memory backed by TencentDB-Agent-Memory. Call memory_recall at task start to load known context; memory_capture after meaningful turns to persist them.',
      });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') {
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    }
    if (method === 'tools/call') {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const tool = TOOL_BY_NAME[name];
      if (!tool) return replyError(id, -32602, `Unknown tool: ${name}`);
      try {
        const out = await tool.run(args);
        const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
        return reply(id, { content: [{ type: 'text', text }] });
      } catch (e) {
        // Tool-level failure: report as tool result (isError) so the model sees it.
        return reply(id, { content: [{ type: 'text', text: 'ERROR: ' + (e && e.message ? e.message : String(e)) }], isError: true });
      }
    }
    return replyError(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    return replyError(id, -32603, 'Internal error: ' + (e && e.message ? e.message : String(e)));
  }
}

// line-buffered stdin reader
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { continue; }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// startup banner on stderr (stdout is reserved for protocol)
process.stderr.write(`[tencentdb-memory] MCP bridge ready -> ${GATEWAY} (session "${DEFAULT_SESSION}"${API_KEY ? ', bearer auth' : ''})\n`);
