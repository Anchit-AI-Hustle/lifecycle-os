#!/usr/bin/env node
'use strict';
/**
 * selfhost-buckets.js — create the Storage buckets this app writes to.
 * ---------------------------------------------------------------------------
 * Enumerated by grepping `storage/v1`, `.storage.from(` and `storage.buckets`
 * across the repo (2026-09-15). Four are ALSO inserted by migrations
 * (`insert into storage.buckets … on conflict`), two exist only as names in
 * code, so the migrations alone leave the stack short of `ci-captures` and
 * `webengage-dumps`. This script reconciles all six through the Storage API,
 * which is idempotent: an existing bucket is updated to the settings below,
 * never recreated.
 *
 * Settings mirror what the migration or the code implies:
 *   public  = the code builds `/storage/v1/object/public/<bucket>/…` URLs
 *   private = only ever read back with the service key
 *
 * Usage: node scripts/selfhost-buckets.js            (reads selfhost/.env)
 *        SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/selfhost-buckets.js
 */

const fs = require('fs');
const lib = require('./lib/selfhost-compose.js');

const BUCKETS = [
  // migration 20260501150000_image_hosting.sql — hero/product images for mailers and ads
  { id: 'mailer-assets', public: true, file_size_limit: 10485760, allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    source: 'supabase/migrations/20260501150000_image_hosting.sql; lifecycle_mailer_architect_v34.html SUPABASE_BUCKET; ad-campaigns.html AD_BUCKET' },
  // migration 20260606_kb_storage_and_landing.sql — knowledge-base uploads, no limits
  { id: 'knowledge-base', public: true, file_size_limit: null, allowed_mime_types: null,
    source: 'supabase/migrations/20260606_kb_storage_and_landing.sql; knowledge-base.html' },
  // migration 20260619000000_smart_brain_creatives_bucket.sql — generated creatives
  { id: 'smart-brain-creatives', public: true, file_size_limit: null, allowed_mime_types: null,
    source: 'supabase/migrations/20260619000000_smart_brain_creatives_bucket.sql; api/_shared/creative-image.js; smart-brain-plan.js' },
  // migration 20260814120000_brand_review_library.sql — re-hosted review images
  { id: 'brand-review-media', public: true, file_size_limit: null, allowed_mime_types: null,
    source: 'supabase/migrations/20260814120000_brand_review_library.sql; api/_shared/brand-reviews.js' },
  // code only: workers upload screenshots and read them back by public URL
  { id: 'ci-captures', public: true, file_size_limit: null, allowed_mime_types: null,
    source: 'api/_shared/supa.js uploadObject ("create it public in Supabase once"); workers/collect-landing.js' },
  // code only: WebEngage export dumps, read with the service key, never linked publicly
  { id: 'webengage-dumps', public: false, file_size_limit: null, allowed_mime_types: null,
    source: 'api/_shared/webengage-core.js BUCKET (env WEBENGAGE_BUCKET)' },
];

async function ensureBuckets({ base, serviceKey, fetchImpl = fetch, log = console.log }) {
  const url = base.replace(/\/+$/, '');
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const results = [];
  for (const b of BUCKETS) {
    const body = { public: b.public, file_size_limit: b.file_size_limit, allowed_mime_types: b.allowed_mime_types };
    const existing = await fetchImpl(`${url}/storage/v1/bucket/${b.id}`, { headers });
    let action, res;
    if (existing.status === 200) {
      action = 'update';
      res = await fetchImpl(`${url}/storage/v1/bucket/${b.id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    } else {
      action = 'create';
      res = await fetchImpl(`${url}/storage/v1/bucket`, { method: 'POST', headers, body: JSON.stringify({ id: b.id, name: b.id, ...body }) });
    }
    const ok = res.status >= 200 && res.status < 300;
    const detail = ok ? '' : ` — ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`;
    log(`${ok ? 'OK  ' : 'FAIL'} ${action.padEnd(6)} ${b.id.padEnd(22)} ${b.public ? 'public ' : 'private'}${detail}`);
    results.push({ id: b.id, action, ok, status: res.status });
  }
  return results;
}

module.exports = { BUCKETS, ensureBuckets };

if (require.main === module) {
  (async () => {
    let base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) {
      const env = lib.loadKitEnv();
      base = base || env.SUPABASE_PUBLIC_URL;
      key = key || env.SERVICE_ROLE_KEY;
    }
    if (!base || !key) { console.error('need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or selfhost/.env with SUPABASE_PUBLIC_URL + SERVICE_ROLE_KEY)'); process.exit(1); }
    console.log(`buckets on ${base}`);
    const r = await ensureBuckets({ base, serviceKey: key });
    process.exit(r.every((x) => x.ok) ? 0 : 1);
  })().catch((e) => { console.error(e.message || e); process.exit(1); });
}
