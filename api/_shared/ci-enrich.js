'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Competitive Intelligence — AI ENRICHMENT pipeline.
//
// Takes a stored asset (ad / email / landing) and produces the structured
// enrichment the brief asked for, via the shared 6-provider LLM waterfall
// (api/_shared/llm.js). Enrichment is written back onto the row AND fanned out
// into ci_creative_tags so the UI can facet/filter without parsing JSONB.
//
// Idempotent: an already-enriched row is skipped unless force=true. Runs in
// batches off the queue so LLM cost is bounded.
// ─────────────────────────────────────────────────────────────────────────────

const supa = require('./supa');
const callLLM = require('./llm');

const TABLE = { ad: 'ci_ads', email: 'ci_emails', landing: 'ci_landing_pages' };

// The enrichment field set per asset type (exactly the brief's lists).
const SCHEMA = {
  ad: ['product', 'funnel_stage', 'awareness_stage', 'offer_type', 'creative_type', 'hook',
       'pain_point', 'desired_outcome', 'target_persona', 'emotional_triggers',
       'objections_addressed', 'why_might_be_winning'],
  email: ['campaign_type', 'funnel_stage', 'offer', 'discount', 'retention_vs_acquisition',
          'urgency', 'scarcity', 'product_focus', 'sequence_position', 'lifecycle_stage'],
  landing: ['primary_promise', 'core_offer', 'customer_problem', 'desired_outcome',
            'social_proof', 'trust_signals', 'conversion_strategy', 'cro_analysis']
};

// Which enrichment keys become facet tags (tag_type → enrichment key).
const TAG_KEYS = {
  ad:      { funnel_stage: 'funnel_stage', awareness: 'awareness_stage', offer_type: 'offer_type',
             creative_type: 'creative_type', hook: 'hook', persona: 'target_persona' },
  email:   { campaign_type: 'campaign_type', funnel_stage: 'funnel_stage', lifecycle: 'lifecycle_stage',
             intent: 'retention_vs_acquisition' },
  landing: { conversion_strategy: 'conversion_strategy' }
};

function buildPrompt(assetType, row) {
  const fields = SCHEMA[assetType];
  let material = '';
  if (assetType === 'ad') {
    material = `SOURCE: ${row.source}\nHEADLINE: ${row.headline || ''}\nPRIMARY COPY: ${row.primary_copy || ''}\nDESCRIPTION: ${row.description || ''}\nCTA: ${row.cta || ''}\nCREATIVE: ${row.creative_type} (${(row.image_urls||[]).length} img / ${(row.video_urls||[]).length} vid)`;
  } else if (assetType === 'email') {
    material = `SENDER: ${row.sender || ''}\nSUBJECT: ${row.subject || ''}\nPREHEADER: ${row.preheader || ''}\nBODY (truncated):\n${(row.plain_text || '').slice(0, 3000)}`;
  } else {
    material = `URL: ${row.url}\nPARSED:\n${JSON.stringify(row.parsed || {}, null, 0).slice(0, 3500)}`;
  }
  return {
    systemPrompt: `You are a senior DTC growth strategist analyzing a competitor ${assetType}. Return ONLY JSON with exactly these keys: ${fields.join(', ')}. Values are concise strings; for list-like fields use a short comma-free array of strings. Be specific and analytical, not generic.`,
    userMessage: material
  };
}

async function enrichOne(assetType, row, { force = false } = {}) {
  if (!force && row.enriched_at) return { id: row.id, skipped: true };
  const { systemPrompt, userMessage } = buildPrompt(assetType, row);
  const out = await callLLM({
    systemPrompt, userMessage, responseFormat: { type: 'json_object' },
    maxTokens: 900, temperature: 0.4, stage: `ci-enrich-${assetType}`
  });
  let data; try { data = JSON.parse(out.text); } catch { data = { _raw: out.text }; }

  await supa.update(TABLE[assetType],
    { enrichment: data, enriched_at: new Date().toISOString() },
    { id: `eq.${row.id}` });

  // Fan out facet tags.
  const tagMap = TAG_KEYS[assetType] || {};
  const tagRows = [];
  for (const [tagType, key] of Object.entries(tagMap)) {
    const v = data[key];
    if (!v) continue;
    const values = Array.isArray(v) ? v : String(v).split(',').map(s => s.trim());
    for (const tv of values.filter(Boolean).slice(0, 5))
      tagRows.push({ asset_type: assetType, asset_id: row.id, brand_id: row.brand_id || null,
        tag_type: tagType, tag_value: String(tv).slice(0, 80), confidence: 0.7 });
  }
  if (tagRows.length) { try { await supa.insert('ci_creative_tags', tagRows, { upsertOn: 'asset_type,asset_id,tag_type,tag_value' }); } catch {} }

  return { id: row.id, enrichment: data, provider: out.provider };
}

// Enrich a batch of un-enriched assets of a given type.
async function enrichBatch(assetType, { limit = 10, force = false } = {}) {
  const table = TABLE[assetType];
  if (!table) throw new Error(`unknown asset type ${assetType}`);
  const filters = force ? {} : { enriched_at: 'is.null' };
  const rows = await supa.select(table, { filters, order: 'created_at.desc', limit });
  const results = [];
  for (const row of rows) {
    try { results.push(await enrichOne(assetType, row, { force })); }
    catch (e) { results.push({ id: row.id, error: e.message }); }
  }
  return { assetType, processed: results.length, results };
}

module.exports = { SCHEMA, enrichOne, enrichBatch };
