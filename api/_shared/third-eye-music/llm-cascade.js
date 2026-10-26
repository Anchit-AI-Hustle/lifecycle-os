'use strict';
// LIFECYCLE: The Third Eye's agents call its own `llmCascade`; here the same
// call goes to this app's free-first cascade (api/_shared/llm.js), resolved at
// CALL time so a scripted model in require.cache reaches agents loaded earlier.
// Shape kept: { system, messages, jsonMode, maxTokens, temperature, stage }
// -> { text, provider, model }.
// Which agents a model actually answered for (a plan whose every agent fell
// back is said to be the fallback plan, not "planned by the agents").
const { AsyncLocalStorage } = require('async_hooks');
const track = new AsyncLocalStorage();
async function llmCascade(o) {
  const callLLM = require('../llm.js');
  const out = await callLLM({
    systemPrompt: o.system || '',
    userMessage: (o.messages || []).map((m) => m.content).join('\n\n'),
    responseFormat: o.jsonMode ? { type: 'json_object' } : null,
    maxTokens: o.maxTokens || 900,
    temperature: o.temperature == null ? 0.7 : o.temperature,
    timeoutMs: o.timeoutMs || 15000,
    budgetMs: o.budgetMs || 20000,
    stage: o.stage || 'music',
  });
  const t = track.getStore();
  const text = String((out && out.text) || '');
  let usable = !!text.trim();
  if (usable && o.jsonMode) { const a = text.indexOf('{'), b = text.lastIndexOf('}'); try { JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : text); } catch (_) { usable = false; } }
  if (t && usable) t.answered.push(o.stage || 'music');
  return { text: String((out && out.text) || ''), provider: out && out.provider, model: out && out.model };
}
module.exports = { llmCascade, track };
