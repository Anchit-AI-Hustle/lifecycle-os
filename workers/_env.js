'use strict';
// Shared .env.local loader for off-Vercel collectors (no dotenv dep).
// Mirrors workers/auto-subscribe.js so all workers read the same secrets:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (writes to ci_* + Storage)
//   APIFY_TOKEN (optional — structured Meta ads), INGEST_TOKEN (optional)
const fs = require('fs');
const path = require('path');

module.exports = function loadEnvLocal() {
  const p = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
};
