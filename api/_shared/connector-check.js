// Text-LLM connector diagnostics.
//
// A pre-flight check for the smart-brain generateAll pipeline: which text
// providers are actually usable *before* we start firing generation jobs, so
// the UI can tell the user exactly what's down and degrade gracefully instead
// of letting every job 429 in a cascade.
//
// Provider identity + env keys mirror api/_shared/llm.js EXACTLY — this module
// must stay in sync with the real cascade, so keep the key names identical.

const _clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");

// The text providers, in cascade order. `keys()` returns the configured env
// keys for each (OpenAI rotates across three).
const TEXT_PROVIDERS = [
  { id: "openai",   label: "OpenAI",   keys: () => [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_2, process.env.OPENAI_API_KEY_3].map(_clean).filter(Boolean) },
  { id: "anthropic",label: "Anthropic",keys: () => [process.env.ANTHROPIC_API_KEY].map(_clean).filter(Boolean) },
  { id: "gemini",   label: "Gemini",   keys: () => [process.env.GEMINI_API_KEY].map(_clean).filter(Boolean) },
  { id: "xai",      label: "Grok (xAI)", keys: () => [process.env.XAI_API_KEY].map(_clean).filter(Boolean) },
  { id: "groq",     label: "Groq",     keys: () => [process.env.GROQ_API_KEY].map(_clean).filter(Boolean) },
  { id: "cerebras", label: "Cerebras", keys: () => [process.env.CEREBRAS_API_KEY].map(_clean).filter(Boolean) },
  { id: "ollama",   label: "Ollama",   keys: () => (_clean(process.env.OLLAMA_BASE_URL) ? ["local"] : []) },
  { id: "sakana",   label: "Sakana",   keys: () => (_clean(process.env.SAKANA_BASE_URL) && _clean(process.env.SAKANA_API_KEY) ? ["configured"] : []) },
];

// Short-lived cache of quota state observed at runtime (populated by
// noteQuotaExhausted from the generation path). Lets the pre-flight report a
// provider as degraded even though its key is present.
const _quotaHits = new Map(); // providerId -> lastHitMs

/** Record that a provider just returned a 429/402 so the next pre-flight warns. */
function noteQuotaExhausted(providerId) {
  if (providerId) _quotaHits.set(providerId, Date.now());
}

const QUOTA_TTL_MS = 5 * 60 * 1000; // treat a quota hit as "recent" for 5 min

/**
 * Presence-based connector report. No tokens are spent — we report which
 * providers have keys and which recently hit quota. `live` opt-in would ping
 * each provider, but that itself costs quota, so it is off by default.
 *
 * @param {object} [opts]
 * @param {string} [opts.userGeminiKey] a per-request Gemini key (same override llm.js honours)
 * @returns {{ providers: Array, anyConfigured: boolean, configuredCount: number,
 *             degraded: string[], missing: string[], summary: string }}
 */
function checkTextProviders(opts = {}) {
  const now = Date.now();
  const userGemini = _clean(opts.userGeminiKey);
  const providers = TEXT_PROVIDERS.map((p) => {
    let keys = p.keys();
    if (p.id === "gemini" && userGemini && !keys.length) keys = ["request"];
    const configured = keys.length > 0;
    const lastQuota = _quotaHits.get(p.id);
    const recentlyExhausted = configured && lastQuota != null && now - lastQuota < QUOTA_TTL_MS;
    return {
      id: p.id,
      label: p.label,
      configured,
      keyCount: keys.length,
      status: !configured ? "missing" : recentlyExhausted ? "quota" : "ok",
      reason: !configured ? "No API key set" : recentlyExhausted ? "Recently hit 429/quota" : "",
    };
  });

  const usable = providers.filter((p) => p.status === "ok");
  const degraded = providers.filter((p) => p.status === "quota").map((p) => p.label);
  const missing = providers.filter((p) => p.status === "missing").map((p) => p.label);
  const anyConfigured = providers.some((p) => p.configured);
  const anyUsable = usable.length > 0;

  const summary = !anyConfigured
    ? "No text LLM provider is configured. Set at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, XAI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY."
    : !anyUsable
      ? `All configured providers recently hit quota (${degraded.join(", ")}). Generation will fall back to templates until they recover.`
      : `${usable.length} provider(s) ready: ${usable.map((p) => p.label).join(", ")}.` +
        (degraded.length ? ` Degraded: ${degraded.join(", ")}.` : "");

  return { providers, anyConfigured, anyUsable, configuredCount: providers.filter((p) => p.configured).length, degraded, missing, summary };
}

module.exports = { checkTextProviders, noteQuotaExhausted, TEXT_PROVIDERS };
