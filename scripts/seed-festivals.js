#!/usr/bin/env node
/**
 * scripts/seed-festivals.js
 *
 * Reads data/festivals.json and upserts into lifecycle.plan_festivals.
 *
 *   SUPABASE_DATABASE_URL=postgres://... node scripts/seed-festivals.js
 *
 * Idempotent — uses primary key (market, mmdd, name) on conflict do update.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const url = process.env.SUPABASE_DATABASE_URL;
  if (!url) {
    console.error('SUPABASE_DATABASE_URL not set — point this at the new Supabase project DB connection string.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'festivals.json'), 'utf-8'));
  delete data._doc;

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let total = 0;
  for (const [market, list] of Object.entries(data)) {
    for (const f of list) {
      await client.query(
        `insert into lifecycle.plan_festivals
           (market, mmdd, name, weight, tags, archetype_hint, recommended_segments)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (market, mmdd, name) do update set
           weight = excluded.weight,
           tags = excluded.tags,
           archetype_hint = excluded.archetype_hint,
           recommended_segments = excluded.recommended_segments`,
        [
          market, f.date, f.name, f.weight,
          f.tags || [], f.archetype_hint || null,
          f.recommended_segments || [],
        ],
      );
      total++;
    }
    console.log(`  · ${market}: ${list.length} festivals seeded`);
  }
  await client.end();
  console.log(`done · ${total} festival rows total`);
}
main().catch((e) => { console.error(e); process.exit(1); });
