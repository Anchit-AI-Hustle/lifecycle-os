'use strict';
// THE BRAND'S TOOLS OVER MCP (2026-11-27). Part of the built-in kit: an MCP
// client (Claude, an IDE, another agent) can list and call the assistant's own
// READ tools for the workspace the caller is a member of, and nothing else.
//
// Model Context Protocol, JSON-RPC 2.0 over one HTTP POST (the Streamable HTTP
// transport's request/response form, no stream): initialize, ping, tools/list,
// tools/call; a notification is answered 202 with no body.
//
// What keeps it inside what the caller may touch:
//   - the caller is a verified, signed-in person (the router checks before
//     this runs) and the workspace is the one the router resolved for them;
//   - only tools on READ below are listed or callable: none writes, generates
//     or calls a model, so nothing is spent and nothing leaves;
//   - every call runs with that workspace's brand and catalogue pinned
//     (brand-catalog-server.withCatalog), as a chat turn does;
//   - a result is cut to a bounded size.

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const READ = ['catalog_products', 'market_performance', 'audience_base', 'list_cohorts', 'get_calendar', 'get_competitor_benchmarks', 'search_knowledge_base', 'list_campaigns', 'ad_insights', 'remember'];

function toolList(TOOLS) {
  return READ.filter((n) => TOOLS[n]).map((n) => ({
    name: n,
    description: String(TOOLS[n].desc || n),
    inputSchema: { type: 'object', properties: n === 'search_knowledge_base' ? { query: { type: 'string' }, limit: { type: 'number' } } : n === 'remember' ? { text: { type: 'string' }, kind: { type: 'string' }, shared: { type: 'boolean' } } : n === 'catalog_products' ? { query: { type: 'string' }, market: { type: 'string' } } : { market: { type: 'string' } }, additionalProperties: true },
    annotations: { readOnlyHint: n !== 'remember' },
  }));
}

const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id: id == null ? null : id, error: { code, message } });

/**
 * handle(req, res, { auth, workspaceId, brand, body, market })
 */
async function handle(req, res, ctx = {}) {
  if (String(req.method || 'POST').toUpperCase() !== 'POST') return res.status(405).json(rpcErr(null, -32600, 'This MCP endpoint takes a JSON-RPC request as a POST.'));
  const m = ctx.body;
  if (Array.isArray(m)) return res.status(400).json(rpcErr(null, -32600, 'Send one JSON-RPC message per request.'));
  if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return res.status(400).json(rpcErr(m && m.id, -32600, 'Not a JSON-RPC 2.0 request.'));
  if (m.id === undefined) return res.status(202).end();   // a notification
  const brandLlm = require('./brand-llm.js');
  const TOOLS = brandLlm.TOOLS;
  if (m.method === 'initialize') {
    const asked = m.params && m.params.protocolVersion;
    return res.status(200).json({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'lifecycle-os', version: '1.0.0' }, instructions: `Read tools for ${(ctx.brand && ctx.brand.name) || 'the active brand'}. Each call answers for that brand's own workspace only.` } });
  }
  if (m.method === 'ping') return res.status(200).json({ jsonrpc: '2.0', id: m.id, result: {} });
  if (m.method === 'tools/list') return res.status(200).json({ jsonrpc: '2.0', id: m.id, result: { tools: toolList(TOOLS) } });
  if (m.method === 'tools/call') {
    const name = m.params && m.params.name;
    if (!READ.includes(name) || !TOOLS[name]) return res.status(200).json(rpcErr(m.id, -32602, `Unknown tool: ${String(name).slice(0, 60)}. Call tools/list for the tools this endpoint offers.`));
    const args = (m.params && m.params.arguments && typeof m.params.arguments === 'object') ? m.params.arguments : {};
    // Nothing the client sends names the brand, the workspace or the person.
    const clean = {};
    for (const k of Object.keys(args)) if (!/^__|^brand$|^workspace/i.test(k)) clean[k] = args[k];
    const brand = ctx.brand || null;
    let result; let isError = false;
    try {
      result = await require('./brand-catalog-server.js').withCatalog({ brand, workspaceId: ctx.workspaceId || null }, () => TOOLS[name].run(Object.assign({ market: ctx.market || '' }, clean, { brand, __workspaceId: ctx.workspaceId || null, __userId: (ctx.auth && ctx.auth.user_id) || null, __memories: [], __kept: [] })));
    } catch (e) { isError = true; result = { error: String((e && e.message) || e).slice(0, 300) }; }
    let text = '';
    try { text = JSON.stringify(result); } catch (_) { text = String(result); }
    if (text.length > 20000) text = text.slice(0, 20000) + '... [cut at 20,000 characters]';
    return res.status(200).json({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }], isError } });
  }
  return res.status(200).json(rpcErr(m.id, -32601, `Method not found: ${m.method.slice(0, 60)}`));
}

module.exports = { handle, toolList, READ, VERSIONS };
