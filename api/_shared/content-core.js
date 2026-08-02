'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// content-core.js — Content Intelligence shared core (framework Sections 1-3).
//
// The config layer + shared ContentCampaignRecord + imported-agent status. This
// is the honest scaffold: it does NOT claim the Daily Blog Agent / Creator Plan
// ChatGPT conversations were imported — it reports their real status from disk.
// Product facts NEVER come from imported conversations; they come from approved
// repo data + the official regional KNICKGASM page (enforced by callers).
//
// Not a function file (under api/_shared/ → excluded from the Hobby 12-fn cap).
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'content-intelligence.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

// Report the real import status of each specialist agent by inspecting the repo.
// not_found → no export present · found_not_parsed → export present, not yet
// distilled · parsed → a requirements.md is present alongside the conversation.
function importedAgentStatus() {
  const cfg = loadConfig();
  return (cfg.imported_agents || []).map((a) => {
    const paths = (a.repositoryPaths || []).map((p) => path.join(ROOT, p));
    const convo = paths.find((p) => /conversation\.md$/.test(p) && fs.existsSync(p));
    const reqs = paths.find((p) => /requirements\.md$/.test(p) && fs.existsSync(p));
    let importStatus = 'not_found';
    if (convo && reqs) importStatus = 'parsed';
    else if (convo) importStatus = 'found_not_parsed';
    return {
      agentId: a.agentId, agentName: a.agentName,
      repositoryPaths: a.repositoryPaths || [],
      importStatus,
      dataRequired: importStatus === 'not_found',
    };
  });
}

// True only when BOTH specialist agents have exports present.
function agentsImported() {
  const st = importedAgentStatus();
  return st.length > 0 && st.every((s) => s.importStatus !== 'not_found');
}

// The shared campaign-content record (framework Section 3). One approved idea
// fans out to blog / creator / social — each channel output adapted, never
// copy-pasted. Statuses default to 'pending'; assets/claims come from approved
// sources only.
function makeContentCampaignRecord(input = {}) {
  return {
    contentCampaignId: input.contentCampaignId || null,
    linkedCampaignId: input.linkedCampaignId || null,
    region: input.region || 'US',
    timezone: input.timezone || 'America/New_York',
    productIds: input.productIds || [],
    collectionIds: input.collectionIds || [],
    primaryObjective: input.primaryObjective || 'education',
    centralCampaignIdea: input.centralCampaignIdea || '',
    centralCustomerInsight: input.centralCustomerInsight || '',
    primaryProductTruth: input.primaryProductTruth || '',
    approvedClaims: input.approvedClaims || [],
    approvedAssets: input.approvedAssets || [],
    blogStatus: input.blogStatus || 'pending',
    creatorPlanStatus: input.creatorPlanStatus || 'pending',
    socialPostStatus: input.socialPostStatus || 'pending',
    sourceReferences: input.sourceReferences || [],
  };
}

// Delivery status string per framework Section 12.
function contentSystemStatus() {
  if (!agentsImported()) return 'CONTENT SYSTEM PARTIAL — IMPORTED CHAT REQUIREMENTS MISSING';
  return 'CONTENT SYSTEM COMPLETE — PUBLISHING CONNECTORS PENDING';
}

module.exports = {
  loadConfig, importedAgentStatus, agentsImported,
  makeContentCampaignRecord, contentSystemStatus, CONFIG_PATH,
};
