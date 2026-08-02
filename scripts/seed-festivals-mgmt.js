#!/usr/bin/env node
/**
 * Seeds data/festivals.json into lifecycle.plan_festivals using the
 * Supabase Management API's POST /v1/projects/{ref}/database/query
 * endpoint. Bypasses pg client / pooler / IPv6 issues from local.
 *
 *   SUPABASE_PROJECT_REF=xxx SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/seed-festivals-mgmt.js
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const ref = process.env.SUPABASE_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) { console.error('Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN.'); process.exit(1); }

  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'festivals.json'), 'utf-8'));
  delete data._doc;

  function esc(s) { return String(s).replace(/'/g, "''"); }
  function arr(a) { return '\'{' + (a || []).map((v) => '"' + esc(v) + '"').join(',') + '}\''; }

  const stmts = [];
  for (const [market, list] of Object.entries(data)) {
    for (const f of list) {
      stmts.push(`insert into lifecycle.plan_festivals
        (market, mmdd, name, weight, tags, archetype_hint, recommended_segments)
        values ('${esc(market)}','${esc(f.date)}','${esc(f.name)}',${+f.weight},${arr(f.tags)},'${esc(f.archetype_hint || '')}',${arr(f.recommended_segments)})
        on conflict (market, mmdd, name) do update set
          weight = excluded.weight,
          tags = excluded.tags,
          archetype_hint = excluded.archetype_hint,
          recommended_segments = excluded.recommended_segments`);
    }
  }
  const fullSql = stmts.join(';\n');

  console.log(`Posting ${stmts.length} upserts in one transaction…`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ query: fullSql }),
  });
  const body = await res.text();
  if (!res.ok) { console.error(`HTTP ${res.status}: ${body.slice(0, 500)}`); process.exit(1); }

  // Verify
  const verifyRes = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ query: 'select market, count(*) from lifecycle.plan_festivals group by market order by market' }),
  });
  console.log('Verify:', await verifyRes.text());
}
main().catch((e) => { console.error(e); process.exit(1); });
