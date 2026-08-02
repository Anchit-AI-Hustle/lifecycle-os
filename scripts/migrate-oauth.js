#!/usr/bin/env node
/*
 * migrate-oauth.js — the OAuth half of the domain migration.
 *
 * When migrate-domains.js points a project at <slug>.anchit-tandon.com, Google
 * sign-in has to keep working on the new origin. This script reconciles the two
 * places that matter, per project:
 *
 *   1. SUPABASE AUTH REDIRECT ALLOWLIST  (auto-applied)
 *      The app signs in via Supabase-mediated Google OAuth:
 *        supabase.auth.signInWithOAuth({ provider:'google',
 *                                        redirectTo: location.origin+pathname })
 *      Supabase only bounces the browser back to a redirectTo that is in its
 *      allowlist. On a new domain that bounce-back 400s until the new origin is
 *      added to the project's Site URL / Additional Redirect URLs. This IS
 *      scriptable — via the Supabase Management API (Bearer SUPABASE_ACCESS_TOKEN)
 *      — so we do it here, idempotently.
 *
 *   2. GOOGLE OAUTH 2.0 WEB CLIENT  (plan only — see the hard truth below)
 *      The Google client's *authorized redirect URI* for this flow is the fixed
 *      Supabase callback  https://<ref>.supabase.co/auth/v1/callback  — it does
 *      NOT change when the app's public domain changes, so nothing is required
 *      there for the Supabase flow. What you MAY want to add is the new
 *      *Authorized JavaScript origin* (needed only if a project also does a
 *      client-side Google flow, e.g. GIS / One Tap) and, for any project that
 *      does direct (non-Supabase) Google OAuth to its own domain, the new
 *      app-domain redirect URI.
 *
 *      HARD TRUTH about gcloud: there is NO gcloud command and NO public Google
 *      API to edit a general "Web application" OAuth 2.0 client's redirect URIs
 *      or JavaScript origins. (gcloud iap oauth-clients only manages IAP-brand
 *      clients, which this is not.) See
 *      https://github.com/googleapis/google-cloud-go/issues/10768 . So for the
 *      web client we do what CAN be done from the CLI — resolve the active
 *      account/project via gcloud and print an exact, idempotent apply-plan +
 *      a Console deep-link to the client — and, where a client genuinely is
 *      IAP-managed, offer the gcloud iap path. We never pretend gcloud mutated
 *      a web client it can't touch.
 *
 * SAFE BY DEFAULT: dry-run unless you pass --apply. Dry-run only READS Supabase
 * config and prints the plan; it never writes.
 *
 * Credentials (env vars — this script cannot fetch them):
 *   SUPABASE_ACCESS_TOKEN                 required (sbp_... — Supabase Management API)
 *   <SLUG>_SUPABASE_PROJECT_REF           per-project Supabase ref (see below);
 *                                         SUPABASE_PROJECT_REF is the fallback
 *                                         for knickgasm-lifecycle-os.
 *   GCP_PROJECT / --gcp-project=          optional — GCP project for the Console
 *                                         link; else read from gcloud config.
 *
 * Per-project Supabase ref env var name = slug uppercased, non-alphanumerics
 * -> underscore (identical to scripts/preflight-credentials.sh), e.g.
 *   knickgasm-lifecycle-os -> KNICKGASM_LIFECYCLE_OS_SUPABASE_PROJECT_REF
 *
 * Usage:
 *   node scripts/migrate-oauth.js                        # dry-run, all projects
 *   node scripts/migrate-oauth.js --apply                # apply Supabase allowlist
 *   node scripts/migrate-oauth.js --project=hey-yaara --apply
 *   node scripts/migrate-oauth.js --promote-site-url --apply   # also set Site URL
 *   ROOT_DOMAIN=anchit-tandon.com node scripts/migrate-oauth.js
 */
'use strict';

const { execFileSync } = require('node:child_process');

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'anchit-tandon.com';

const ALL_PROJECTS = [
  'knickgasm-lifecycle-os', 'personal-ai-os', 'the-third-eye', 'music-gen-ai',
  'hey-yaara', 'ai-tele-suite', 'th-life-engine', 'marketing-mailers-html-architect',
];

// Per-project subdomain overrides (must match migrate-domains.js).
const SUBDOMAIN = {
  // 'marketing-mailers-html-architect': 'mailers',
};

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PROMOTE_SITE_URL = args.includes('--promote-site-url');
const only = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
const gcpProjectArg = (args.find((a) => a.startsWith('--gcp-project=')) || '').split('=')[1];
const PROJECTS = only ? [only] : ALL_PROJECTS;

// ── credential guard (fail loudly) ───────────────────────────────────────────
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

function die(msg) { console.error(`\nFAIL: ${msg}`); process.exit(1); }
if (!SUPABASE_ACCESS_TOKEN) {
  die('SUPABASE_ACCESS_TOKEN is not set (sbp_... from supabase.com -> Account -> Access Tokens). ' +
      'Add it and re-run (see scripts/preflight-credentials.sh).');
}

// ── helpers ──────────────────────────────────────────────────────────────────
function subFor(project) { return SUBDOMAIN[project] || project; }
function fqdnFor(project) { return `${subFor(project)}.${ROOT_DOMAIN}`; }

// slug -> env-var prefix: uppercase, non-alphanumeric -> underscore.
// Identical rule to scripts/preflight-credentials.sh slug_prefix().
function slugPrefix(slug) {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function supabaseRefFor(project) {
  const perProject = process.env[`${slugPrefix(project)}_SUPABASE_PROJECT_REF`];
  if (perProject) return perProject;
  if (project === 'knickgasm-lifecycle-os' && process.env.SUPABASE_PROJECT_REF) {
    return process.env.SUPABASE_PROJECT_REF;
  }
  return '';
}

// Best-effort gcloud reads. Never throws — degrades to '' if gcloud is absent.
function gcloudValue(prop) {
  try {
    const out = execFileSync('gcloud', ['config', 'get-value', prop], {
      stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000, encoding: 'utf8',
    }).trim();
    return out && out !== '(unset)' ? out : '';
  } catch { return ''; }
}

const GCP_PROJECT = gcpProjectArg || process.env.GCP_PROJECT || gcloudValue('project');
const GCLOUD_ACCOUNT = gcloudValue('account');

// ── Supabase Management API ──────────────────────────────────────────────────
async function supabase(method, path, payload) {
  const res = await fetch(`https://api.supabase.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
}

async function getAuthConfig(ref) {
  const r = await supabase('GET', `/v1/projects/${ref}/config/auth`);
  if (r.status === 404) return { missing: true };
  if (!r.ok) throw new Error(`get auth config: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return { missing: false, config: r.body };
}

async function patchAuthConfig(ref, patch) {
  const r = await supabase('PATCH', `/v1/projects/${ref}/config/auth`, patch);
  if (!r.ok) throw new Error(`patch auth config: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}

// Supabase stores uri_allow_list as a comma-separated string. Compute the URLs
// the new domain needs and merge them in without dropping anything existing.
function desiredAllowUris(fqdn) {
  return [`https://${fqdn}`, `https://${fqdn}/**`];
}

function mergeAllowList(existing, additions) {
  const have = String(existing || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set(have);
  const added = [];
  for (const uri of additions) {
    if (!set.has(uri)) { set.add(uri); added.push(uri); }
  }
  return { merged: Array.from(set).join(','), added };
}

// ── per-project work ─────────────────────────────────────────────────────────
async function reconcileSupabase(project, fqdn) {
  const ref = supabaseRefFor(project);
  if (!ref) {
    return { status: 'ref MISSING', detail: `set ${slugPrefix(project)}_SUPABASE_PROJECT_REF` };
  }
  const { missing, config } = await getAuthConfig(ref);
  if (missing) return { status: 'PROJECT NOT FOUND', detail: `ref ${ref} not visible to this token` };

  const { merged, added } = mergeAllowList(config.uri_allow_list, desiredAllowUris(fqdn));
  const wantSiteUrl = PROMOTE_SITE_URL ? `https://${fqdn}` : null;
  const siteUrlChanges = wantSiteUrl && config.site_url !== wantSiteUrl;

  if (added.length === 0 && !siteUrlChanges) {
    return { status: 'already done', detail: `ref ${ref}: allowlist already covers ${fqdn}` };
  }

  if (!APPLY) {
    const bits = [];
    if (added.length) bits.push(`add [${added.join(', ')}] to redirect allowlist`);
    if (siteUrlChanges) bits.push(`set Site URL -> ${wantSiteUrl} (was ${config.site_url || '(none)'})`);
    return { status: 'WOULD UPDATE', detail: `ref ${ref}: ${bits.join('; ')}` };
  }

  const patch = { uri_allow_list: merged };
  if (siteUrlChanges) patch.site_url = wantSiteUrl;
  await patchAuthConfig(ref, patch);
  const bits = [];
  if (added.length) bits.push(`+${added.length} redirect URL(s)`);
  if (siteUrlChanges) bits.push(`Site URL -> ${wantSiteUrl}`);
  return { status: 'UPDATED', detail: `ref ${ref}: ${bits.join('; ')}` };
}

// Google web OAuth client: gcloud/API cannot mutate it — emit the exact,
// idempotent plan + a Console deep-link so a human can finish it in seconds.
// We link to the project's credentials LIST (not a per-client URL): the OAuth
// client id, while not a true secret, is user-controlled input, and threading
// it into a logged URL trips clear-text-logging scanners for no real gain —
// the list page lands on the right project and the client is one click away.
function googleClientPlan(project, fqdn) {
  const ref = supabaseRefFor(project);
  const projQ = GCP_PROJECT ? `?project=${GCP_PROJECT}` : '';
  const consoleLink = `https://console.cloud.google.com/apis/credentials${projQ}`;
  return {
    jsOrigin: `https://${fqdn}`,
    supabaseCallback: ref ? `https://${ref}.supabase.co/auth/v1/callback` : '(unknown — Supabase ref not set)',
    consoleLink,
  };
}

async function run() {
  console.log(`OAuth redirect migration -> *.${ROOT_DOMAIN}  (${APPLY ? 'APPLY' : 'DRY-RUN'})`);
  if (GCP_PROJECT || GCLOUD_ACCOUNT) {
    console.log(`gcloud: account=${GCLOUD_ACCOUNT || '(unknown)'} project=${GCP_PROJECT || '(unknown)'}`);
  } else {
    console.log('gcloud: not detected on PATH — Google-client plan will use generic Console links.');
  }
  console.log('='.repeat(72));

  const summary = [];
  for (const project of PROJECTS) {
    const fqdn = fqdnFor(project);
    // 1) Supabase allowlist — the part we can (and must) automate.
    let sb;
    try {
      sb = await reconcileSupabase(project, fqdn);
    } catch (e) {
      sb = { status: 'ERROR', detail: String(e.message || e) };
    }
    summary.push([project, sb.status, sb.detail]);
    const mark = { 'UPDATED': '+', 'WOULD UPDATE': '~', 'already done': '=' }[sb.status] || '!';
    console.log(`${mark} ${project}: [supabase] ${sb.detail}`);

    // 2) Google web OAuth client — plan only (gcloud cannot mutate it).
    const g = googleClientPlan(project, fqdn);
    console.log(`    [google oauth client] add Authorized JavaScript origin: ${g.jsOrigin}`);
    console.log(`      redirect URI stays the Supabase callback (unchanged): ${g.supabaseCallback}`);
    console.log(`      gcloud/API cannot edit a Web-application client — do it in Console:`);
    console.log(`        ${g.consoleLink}`);
  }

  console.log('='.repeat(72));
  for (const [p, action, detail] of summary) {
    console.log(`  ${p.padEnd(34)} ${action.padEnd(18)} ${detail}`);
  }
  console.log('\nGoogle OAuth 2.0 Web-application clients can only be edited in the Cloud');
  console.log('Console (no gcloud command / public API exists). The Supabase redirect');
  console.log('allowlist above is what actually gates the post-login bounce-back and is');
  console.log('applied automatically with --apply.');
  if (!APPLY) console.log('\nDry-run only. Re-run with --apply (SUPABASE_ACCESS_TOKEN set) to write the allowlist.');
}

run().catch((e) => die(e.message || String(e)));
