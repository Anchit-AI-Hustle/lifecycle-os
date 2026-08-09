#!/usr/bin/env node
/*
 * migrate-domains.js — point each sibling Vercel project at a
 * <slug>.anchit-tandon.com custom domain, wherever it is not done yet.
 *
 * For every project it:
 *   1. reads the domains currently attached (Vercel API),
 *   2. skips it if it already has ANY *.anchit-tandon.com domain (idempotent),
 *   3. otherwise adds <slug>.anchit-tandon.com to the project and upserts the
 *      matching CNAME (-> cname.vercel-dns.com) in GoDaddy DNS.
 *
 * SAFE BY DEFAULT: dry-run unless you pass --apply. Dry-run only READS Vercel
 * and reports the plan; it never writes. This lets us confirm the subdomain
 * convention against already-migrated projects before touching anything.
 *
 * Credentials (env vars — this script cannot fetch them):
 *   VERCEL_TOKEN                 required (both modes: needed to list domains)
 *   VERCEL_TEAM_ID               optional (if the projects live under a team)
 *   GODADDY_KEY / GODADDY_SECRET required for --apply (DNS writes)
 *
 * Usage:
 *   node scripts/migrate-domains.js                 # dry-run, all 8 projects
 *   node scripts/migrate-domains.js --apply         # do it
 *   node scripts/migrate-domains.js --project=hey-yaara --apply
 *   ROOT_DOMAIN=anchit-tandon.com node scripts/migrate-domains.js
 *
 * OAUTH FOLLOW-THROUGH: a domain change breaks Google sign-in until the new
 * origin is reconciled (Supabase redirect allowlist + Google web-client JS
 * origin). This script hands each migrated project to scripts/migrate-oauth.js
 * automatically (same --apply / dry-run mode, same --project scope). Pass
 * --no-oauth to skip it. See that script for the full explanation of what
 * gcloud can and cannot change.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT_DOMAIN = process.env.ROOT_DOMAIN || 'anchit-tandon.com';
const VERCEL_CNAME = 'cname.vercel-dns.com'; // Vercel's canonical target for subdomains

const ALL_PROJECTS = [
  'lifecycle-os', 'personal-ai-os', 'the-third-eye', 'music-gen-ai',
  'hey-yaara', 'ai-tele-suite', 'th-life-engine', 'marketing-mailers-html-architect',
];

// Per-project subdomain overrides go here if the label should differ from the
// Vercel project slug. Default: <slug>.anchit-tandon.com.
const SUBDOMAIN = {
  // 'marketing-mailers-html-architect': 'mailers',
};

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const NO_OAUTH = args.includes('--no-oauth');
const only = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
const PROJECTS = only ? [only] : ALL_PROJECTS;

// ── credential guard (fail loudly) ───────────────────────────────────────────
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || '';
const GODADDY_KEY = process.env.GODADDY_KEY;
const GODADDY_SECRET = process.env.GODADDY_SECRET;

function die(msg) { console.error(`\nFAIL: ${msg}`); process.exit(1); }
if (!VERCEL_TOKEN) die('VERCEL_TOKEN is not set. Add it and re-run (see scripts/preflight-credentials.sh).');
if (APPLY && (!GODADDY_KEY || !GODADDY_SECRET)) {
  die('--apply needs GODADDY_KEY and GODADDY_SECRET for the DNS records. Run without --apply for a dry-run.');
}

// ── API helpers ──────────────────────────────────────────────────────────────
const teamQ = VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : '';
const teamQAmp = VERCEL_TEAM_ID ? `&teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : '';

async function vercel(path, init = {}) {
  const url = `https://api.vercel.com${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
}

async function godaddy(method, path, payload) {
  const res = await fetch(`https://api.godaddy.com/v1${path}`, {
    method,
    headers: { Authorization: `sso-key ${GODADDY_KEY}:${GODADDY_SECRET}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
}

// ── per-project work ─────────────────────────────────────────────────────────
async function listDomains(project) {
  const r = await vercel(`/v9/projects/${encodeURIComponent(project)}/domains${teamQ}`);
  if (r.status === 404) return { missing: true, domains: [] };
  if (!r.ok) throw new Error(`list domains ${project}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return { missing: false, domains: (r.body.domains || []).map((d) => d.name) };
}

async function addDomain(project, fqdn) {
  const r = await vercel(`/v10/projects/${encodeURIComponent(project)}/domains${teamQ}`, {
    method: 'POST', body: JSON.stringify({ name: fqdn }),
  });
  if (r.status === 409) return { already: true };            // already attached — fine
  if (!r.ok) throw new Error(`add ${fqdn} to ${project}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return { already: false, verified: !!r.body.verified, verification: r.body.verification || [] };
}

async function upsertCname(sub) {
  // PUT is an upsert on GoDaddy — safe to repeat.
  const r = await godaddy('PUT', `/domains/${ROOT_DOMAIN}/records/CNAME/${encodeURIComponent(sub)}`,
    [{ data: VERCEL_CNAME, ttl: 3600 }]);
  if (!r.ok) throw new Error(`GoDaddy CNAME ${sub}.${ROOT_DOMAIN}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return true;
}

function subFor(project) { return SUBDOMAIN[project] || project; }

async function run() {
  console.log(`Domain migration -> *.${ROOT_DOMAIN}  (${APPLY ? 'APPLY' : 'DRY-RUN'}${VERCEL_TEAM_ID ? ', team ' + VERCEL_TEAM_ID : ''})`);
  console.log('='.repeat(72));
  const summary = [];
  for (const project of PROJECTS) {
    const sub = subFor(project);
    const fqdn = `${sub}.${ROOT_DOMAIN}`;
    try {
      const { missing, domains } = await listDomains(project);
      if (missing) { summary.push([project, 'PROJECT NOT FOUND', '-']); console.log(`- ${project}: not found under this token/team`); continue; }
      const hasRoot = domains.some((d) => d.endsWith(`.${ROOT_DOMAIN}`) || d === ROOT_DOMAIN);
      const current = domains.join(', ') || '(none)';
      if (hasRoot) {
        summary.push([project, 'already done', domains.filter((d) => d.endsWith(ROOT_DOMAIN)).join(', ')]);
        console.log(`= ${project}: already on ${ROOT_DOMAIN} -> ${domains.filter((d) => d.endsWith(ROOT_DOMAIN)).join(', ')}`);
        continue;
      }
      if (!APPLY) {
        summary.push([project, 'WOULD ADD', fqdn]);
        console.log(`~ ${project}: has [${current}] -> would add ${fqdn} + GoDaddy CNAME ${sub} -> ${VERCEL_CNAME}`);
        continue;
      }
      const added = await addDomain(project, fqdn);
      await upsertCname(sub);
      summary.push([project, added.already ? 'domain existed, DNS set' : 'ADDED + DNS', fqdn]);
      console.log(`+ ${project}: ${added.already ? 'domain already attached' : 'added ' + fqdn}; GoDaddy CNAME ${sub} -> ${VERCEL_CNAME} set${added.verified ? '' : ' (verify pending DNS propagation)'}`);
    } catch (e) {
      summary.push([project, 'ERROR', String(e.message || e)]);
      console.log(`! ${project}: ${e.message || e}`);
    }
  }
  console.log('='.repeat(72));
  for (const [p, action, detail] of summary) console.log(`  ${p.padEnd(34)} ${action.padEnd(24)} ${detail}`);
  if (!APPLY) console.log('\nDry-run only. Re-run with --apply (and GoDaddy keys set) to make changes.');

  runOauthFollowThrough();
}

// After the DNS/domain work, reconcile the OAuth surfaces for the same scope so
// Google sign-in keeps working on the new origin. Delegates to migrate-oauth.js
// (inherits --apply / dry-run and --project). Best-effort: a failure here does
// not undo the domain migration, so we report and move on rather than throw.
function runOauthFollowThrough() {
  if (NO_OAUTH) {
    console.log('\n(--no-oauth) Skipping OAuth reconcile. Run scripts/migrate-oauth.js separately.');
    return;
  }
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    console.log('\nOAuth reconcile SKIPPED: SUPABASE_ACCESS_TOKEN not set. The domain is migrated but');
    console.log('Google sign-in will 400 on the new origin until the Supabase redirect allowlist is');
    console.log('updated. Set SUPABASE_ACCESS_TOKEN and run: node scripts/migrate-oauth.js' + (APPLY ? ' --apply' : ''));
    return;
  }
  console.log('\n' + '#'.repeat(72));
  console.log('# OAuth follow-through (Supabase allowlist + Google web-client plan)');
  console.log('#'.repeat(72));
  const oauthScript = path.join(__dirname, 'migrate-oauth.js');
  const passArgs = [oauthScript];
  if (APPLY) passArgs.push('--apply');
  if (only) passArgs.push(`--project=${only}`);
  const r = spawnSync(process.execPath, passArgs, { stdio: 'inherit' });
  if (r.error) {
    console.log(`! OAuth reconcile could not start: ${r.error.message}. Run it manually: node scripts/migrate-oauth.js${APPLY ? ' --apply' : ''}`);
  }
}

run().catch((e) => die(e.message || String(e)));
