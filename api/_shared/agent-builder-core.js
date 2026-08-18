'use strict';

/**
 * agent-builder-core.js — expose the ACTIVE BRAND's growth stack to Google Vertex AI
 * Agent Builder as an OpenAPI tool.
 *
 * HOW AGENT BUILDER CONSUMES THIS
 * Agent Builder connects to your own APIs through a tool of type OPENAPI: you
 * paste an OpenAPI 3.0 spec, it derives callable operations, and the agent's LLM
 * picks operations by reading their `description`. So the spec IS the integration
 * — there is no SDK to install and nothing to run on Google's side.
 *
 * THE SPEC IS GENERATED FROM THE LIVE TOOL REGISTRY, NEVER HAND-WRITTEN.
 * The brand LLM (brand-llm.js, named by its own BRAND_LLM_NAME constant) already
 * registers every capability with a description
 * written for an LLM to read. Re-describing those by hand in a YAML file would
 * create a second source of truth that silently drifts the moment a tool changes
 * — the exact failure this codebase keeps hitting (nav INFO keys, the metric
 * catalog, the CI script list). One registry, two consumers.
 *
 * SAFETY — WHY WRITES ARE NOT EXPOSED
 * The registry contains four MUTATING tools (generate_calendar,
 * generate_assets_for_slot, run_agentic_campaign, generate_mailer_assets). An
 * external agent that can be steered by whoever is talking to it must not be able
 * to generate campaigns or spend model quota, so the spec is built from the
 * non-mutating tools ONLY. Writes require an explicit, separate opt-in
 * (AGENT_BUILDER_ALLOW_WRITES=on) and are still refused without it at execution
 * time, not merely omitted from the spec — a tool that is hidden but callable is
 * not protected.
 *
 * AUTH
 * A dedicated key (AGENT_BUILDER_API_KEY) sent as X-Agent-Key, compared in
 * constant time. With no key configured the bridge is CLOSED, not open: an
 * unauthenticated business-data endpoint is worse than no integration.
 *
 * Env:
 *   AGENT_BUILDER_API_KEY        required to enable the bridge at all
 *   AGENT_BUILDER_ALLOW_WRITES   'on' to also expose the mutating tools
 *   AGENT_BUILDER_PUBLIC_ORIGIN  absolute origin for the spec's servers[] entry
 */

const crypto = require('crypto');
const brandLlm = require('./brand-llm.js');

const HEADER = 'x-agent-key';

function configuredKey() {
  return String(process.env.AGENT_BUILDER_API_KEY || '').trim();
}
function writesAllowed() {
  return /^(on|1|true|yes|enabled)$/i.test(String(process.env.AGENT_BUILDER_ALLOW_WRITES || '').trim());
}

// Constant-time compare so a wrong key cannot be found byte-by-byte through
// response timing. Length is compared first because timingSafeEqual throws on a
// length mismatch, and that throw would itself leak the length.
function keyMatches(supplied) {
  const expected = configuredKey();
  if (!expected) return false;
  const a = Buffer.from(String(supplied || ''), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authorize(req) {
  if (!configuredKey()) {
    return {
      ok: false, status: 503,
      error: 'agent_builder_not_configured',
      blocker: 'Set AGENT_BUILDER_API_KEY on this deployment to enable the Google Agent Builder bridge. It is closed by default - an unauthenticated business-data endpoint is worse than no integration.',
    };
  }
  const supplied = req && req.headers ? (req.headers[HEADER] || req.headers[HEADER.toUpperCase()]) : '';
  if (!keyMatches(supplied)) {
    return { ok: false, status: 401, error: 'invalid_agent_key', blocker: `Send the shared secret as the ${HEADER} header. In Agent Builder this is an API-key auth entry on the OpenAPI tool.` };
  }
  return { ok: true };
}

// ── Parameter schema ────────────────────────────────────────────────────────
// The registry describes params in prose (written for an LLM), so the spec
// declares the union of parameters the tools actually accept. Naming them
// explicitly - rather than accepting a free-form object - is what lets Agent
// Builder's model fill them correctly and stops it inventing keys we ignore.
const PARAMS = {
  market: { type: 'string', description: 'Market / region: US, UK, IN or Global. Defaults to US.' },
  question: { type: 'string', description: 'Natural-language question, for the analytics and analyst tools.' },
  query: { type: 'string', description: 'Keyword filter, e.g. a product name for catalog_products.' },
  platform: { type: 'string', description: 'Ad platform: meta, google or tiktok. Omit for all three.' },
  level: { type: 'string', description: 'Reporting level: account, campaign, adgroup/adset or ad.' },
  since: { type: 'string', description: 'Window start, YYYY-MM-DD.' },
  until: { type: 'string', description: 'Window end, YYYY-MM-DD.' },
  from: { type: 'string', description: 'Calendar start date, YYYY-MM-DD.' },
  op: { type: 'string', description: 'Sub-operation, where the tool documents one (e.g. campaigns or summary).' },
  event: { type: 'string', description: 'Event name, e.g. "Notification Clicked".' },
  hours: { type: 'integer', description: 'Look-back window in hours.' },
};

// toolManifest() renames the registry's internal `desc` to `description`. Read
// both: reading only one of them is how the first cut of this file produced a
// spec whose every operation had `description: undefined` — importable, and
// completely useless, because the description is the ONLY thing Agent Builder's
// model reads when deciding which operation to call.
function toolDescription(t) {
  return String((t && (t.description || t.desc)) || '').trim();
}

function exposedTools() {
  const all = brandLlm.toolManifest();
  const eligible = writesAllowed() ? all : all.filter((t) => !t.mutates);
  // A tool with no description is not exposed as a blind operation — the model
  // would either ignore it or call it at random. It is dropped and NAMED in
  // status(), so a description that goes missing is visible instead of silent.
  return eligible.filter((t) => toolDescription(t).length > 0);
}

function toolsMissingDescription() {
  const all = brandLlm.toolManifest();
  const eligible = writesAllowed() ? all : all.filter((t) => !t.mutates);
  return eligible.filter((t) => !toolDescription(t)).map((t) => t.name);
}

/**
 * Build the OpenAPI 3.0 document Agent Builder imports.
 *
 * 3.0, deliberately, not 3.1: Agent Builder's OpenAPI tool parser is documented
 * against 3.0 and rejects some 3.1-only constructs.
 */
function openApiSpec({ origin, brand } = {}) {
  // Whose stack this spec describes. Never defaulted to a brand: the title and
  // description are read by an LLM that will then speak as that brand.
  const runtime = require('./brand-runtime.js');
  const brandName = brand && !runtime.isUnresolved(brand) && brand.name ? String(brand.name) : '';
  // The server URL is what Agent Builder will actually CALL. The sibling
  // defaulted it to its own production deployment; carried over, this spec would
  // have pointed another company's agent at another company's infrastructure.
  // There is no safe default, so an unresolvable origin is refused rather than
  // guessed.
  const server = String(
    process.env.AGENT_BUILDER_PUBLIC_ORIGIN
    || origin
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    || process.env.PUBLIC_BASE_URL
    || '',
  ).replace(/\/$/, '');
  if (!server) {
    // Emitting a spec with no server, or with a guessed one, produces an agent
    // that calls the wrong host. Refusing is the only safe answer.
    return {
      ok: false,
      error: 'agent_builder_origin_unresolved',
      blocker: 'Set AGENT_BUILDER_PUBLIC_ORIGIN to this deployment\'s public URL. The OpenAPI spec tells Agent Builder which host to call, and there is no safe default for that.',
    };
  }
  const tools = exposedTools();
  const paths = {};
  for (const t of tools) {
    paths[`/api/agent-builder/run/${t.name}`] = {
      post: {
        // Agent Builder shows operationId in the console and the model uses the
        // description to decide when to call it, so the registry's own
        // LLM-facing description is passed through verbatim.
        operationId: t.name,
        summary: t.name.replace(/_/g, ' '),
        description: toolDescription(t),
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { type: 'object', properties: PARAMS, additionalProperties: false },
            },
          },
        },
        responses: {
          200: {
            description: 'Tool result. `ok:false` with a `blocker` means a data source is not connected - relay the blocker, never invent a figure.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    tool: { type: 'string' },
                    result: { type: 'object', description: 'Tool-specific payload.' },
                    blocker: { type: 'string', description: 'Why a source could not be read, when it could not.' },
                  },
                },
              },
            },
          },
          401: { description: 'Missing or wrong x-agent-key.' },
          503: { description: 'Bridge not configured (AGENT_BUILDER_API_KEY unset).' },
        },
        security: [{ AgentKey: [] }],
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: `${brandName || 'Lifecycle OS'} — growth tools`,
      version: '1.0.0',
      description: [
        `Read-only access to the growth data of ${brandName || 'the connected brand'}: real Shopify sales and audience figures, paid-ads reporting from Meta/Google/TikTok, lifecycle engagement, cohorts, the marketing calendar, competitor benchmarks and the product catalog.`,
        '',
        'GROUNDING CONTRACT — this matters more than any single figure:',
        '- Every number returned is read from a real source. Nothing is estimated.',
        '- When a source is not connected the response carries ok:false and a `blocker` naming the exact missing configuration. Relay that. Do NOT substitute an estimate, an average, or a figure from another market.',
        '- Product names, prices and URLs are valid ONLY as returned by catalog_products. Never edit a handle or domain.',
        '- Figures are market-specific. Never carry a US number into a UK answer.',
      ].join('\n'),
    },
    servers: [{ url: server }],
    components: {
      securitySchemes: {
        AgentKey: { type: 'apiKey', in: 'header', name: HEADER },
      },
    },
    security: [{ AgentKey: [] }],
    paths,
  };
}

// Every core in this repo signals "I could not read a real source" the same few
// ways. Recognise all of them and turn them into one sentence the agent can
// relay verbatim, naming the exact missing configuration.
function notConnectedBlocker(result) {
  if (!result || typeof result !== 'object') return '';
  const dead = result.ok === false || result.connected === false || result.not_connected === true;
  if (!dead) return '';
  const parts = [];
  if (result.blocker) parts.push(String(result.blocker));
  else if (result.hint) parts.push(String(result.hint));
  else if (result.error) parts.push(typeof result.error === 'string' ? result.error : JSON.stringify(result.error));
  if (Array.isArray(result.need_env) && result.need_env.length) parts.push(`Missing configuration: ${result.need_env.join(', ')}.`);
  const w = result.would_request || result.would_query;
  if (w && w.url) parts.push(`The call that was blocked: ${w.method || 'GET'} ${w.url}`);
  parts.push('No figure is available from this source. Say so - do NOT substitute an estimate, an average, or a number from another market or platform.');
  return parts.join(' ');
}

/**
 * Execute one tool by name. Auth and the write-gate are enforced HERE, not just
 * by omission from the spec — a caller who guesses a hidden tool name must still
 * be refused.
 */
async function runTool(req, name, args) {
  const auth = authorize(req);
  if (!auth.ok) return auth;

  const manifest = brandLlm.toolManifest();
  const tool = manifest.find((t) => t.name === name);
  if (!tool) {
    return { ok: false, status: 404, error: 'unknown_tool', available: exposedTools().map((t) => t.name) };
  }
  if (tool.mutates && !writesAllowed()) {
    return {
      ok: false, status: 403, error: 'tool_is_write_gated',
      blocker: `${name} mutates state (it generates campaigns/assets). External agents are read-only unless AGENT_BUILDER_ALLOW_WRITES=on is set deliberately.`,
    };
  }
  // Execute through the SAME registry entry the brand LLM chat loop uses, and
  // apply the same market defaulting it applies, so a question answered here and
  // the same question answered in chat cannot return different numbers.
  const entry = brandLlm.TOOLS[name];
  const a = args || {};
  const runArgs = (a.market != null && String(a.market).trim()) ? a : { ...a, market: 'US' };
  try {
    const result = await entry.run(runArgs);
    // HOIST the not-connected signal to the top level. The cores report it
    // INSIDE the payload (result.ok:false / connected:false / not_connected with
    // a hint + would_request), but the spec promises the agent that top-level
    // ok:false + blocker is how a dead source announces itself. Left unhoisted,
    // an unconnected platform returns ok:true and a Google-hosted model reads
    // "success" over a payload containing no figures at all — which is exactly
    // the moment a model invents one.
    const b = notConnectedBlocker(result);
    if (b) return { ok: false, tool: name, market: runArgs.market, blocker: b, result };
    return { ok: true, tool: name, market: runArgs.market, result };
  } catch (e) {
    return { ok: false, status: 500, tool: name, error: 'tool_failed', message: (e && e.message) || String(e) };
  }
}

function status() {
  return {
    ok: true,
    configured: !!configuredKey(),
    writes_allowed: writesAllowed(),
    exposed_tools: exposedTools().map((t) => t.name),
    withheld_write_tools: brandLlm.toolManifest().filter((t) => t.mutates).map((t) => t.name),
    // Should always be empty. If it is not, a registry tool lost its description
    // and has silently dropped out of the integration - fix the registry.
    omitted_no_description: toolsMissingDescription(),
    openapi_url: '/api/agent-builder/openapi.json',
    run_url: '/api/agent-builder/run/{tool}',
    auth_header: HEADER,
  };
}

module.exports = { openApiSpec, runTool, authorize, status, exposedTools, toolsMissingDescription, HEADER };
