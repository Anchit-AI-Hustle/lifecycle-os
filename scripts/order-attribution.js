#!/usr/bin/env node
'use strict';

/**
 * order-attribution.js — which day did email actually drive the most orders?
 *
 * Reads every order in the window straight from the Shopify Admin API, classifies
 * each one by its OWN recorded source (landing_site UTMs, referring_site
 * fallback), buckets by the shop's local date, and reports the peak email day.
 *
 * WHY THIS EXISTS AS A SECOND OPINION
 * Klaviyo reporting on Klaviyo's own performance cannot validate Klaviyo. This
 * path never touches the email platform: it counts orders that Shopify itself
 * recorded as arriving from an email click. If the two agree, the attribution is
 * trustworthy. If they disagree, the gap is the finding.
 *
 * Usage:
 *   SHOPIFY_STORE_DOMAIN=your-store.myshopify.com \
 *   SHOPIFY_ADMIN_TOKEN=shpat_xxx \
 *   LIVE_CONNECTORS=on \
 *   node scripts/order-attribution.js --market US --days 90
 *
 * Those env vars are the DEPLOYMENT fallback. In the app the credentials
 * resolve workspace-first, so the deployed route reads the ACTIVE brand's own
 * store and needs no local credentials at all:
 *   /api/brain?action=shopify&op=attribution&market=US&days=90
 */

const shopify = require('../api/_shared/shopify-core.js');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

(async () => {
  const market = String(arg('market', 'US')).toUpperCase();
  const days = Number(arg('days', 90));
  const top = Number(arg('top', 10));

  const out = await shopify.attribution({ market, days, maxPages: Number(arg('max-pages', 20)) });

  if (!out.ok) {
    // Never print a number we do not have. Print the exact call that was blocked.
    console.error(`\nNot connected — nothing was read, and nothing is estimated.\n`);
    if (out.blocker) console.error(`  Blocker: ${out.blocker}`);
    if (out.would_request) console.error(`  Would call: ${out.would_request.method} ${out.would_request.url}`);
    if (out.error) console.error(`  Error: ${JSON.stringify(out.error)}`);
    process.exit(1);
  }

  console.log(`\nOrder source attribution — ${out.market}, last ${out.window_days} days`);
  console.log(`  ${out.orders_read} orders across ${out.pages} page(s)${out.truncated ? '  ** TRUNCATED **' : ''}`);
  console.log(`  Dates bucketed in ${out.timezone} (${out.timezone_source})`);
  console.log(`  Method: ${out.method}\n`);

  const totals = Object.entries(out.channel_totals).sort((a, b) => b[1] - a[1]);
  console.log('  Channel                Orders     Share');
  for (const [ch, n] of totals) {
    const pct = out.orders_read ? ((n / out.orders_read) * 100).toFixed(1) : '0.0';
    console.log(`  ${pad(ch, 22)}${padL(n, 6)}${padL(pct + '%', 10)}`);
  }

  console.log('\n  ── Peak email day ──');
  if (!out.peak_email_day || !out.peak_email_day.email_orders) {
    console.log('  No email-attributed orders in this window.');
  } else {
    const p = out.peak_email_day;
    console.log(`  ${p.date}  —  ${p.email_orders} email orders, ${p.email_revenue} revenue, ${p.orders_that_day} orders total that day`);
    if (out.peak_is_tied_with.length > 1) {
      console.log(`  TIED with: ${out.peak_is_tied_with.join(', ')} — there is no single peak day.`);
    }
    console.log('\n  Evidence (first few email orders):');
    for (const e of out.email_examples) console.log(`    ${pad(e.order, 10)} ${e.at}  ${e.why}`);
  }

  const ranked = [...out.by_date].sort((a, b) => b.email - a.email).slice(0, top);
  if (ranked.length) {
    console.log(`\n  ── Top ${ranked.length} days by email orders ──`);
    console.log('  Date            Email   Revenue   All orders');
    for (const r of ranked) {
      console.log(`  ${pad(r.date, 14)}${padL(r.email, 5)}${padL(r.email_revenue, 10)}${padL(r.total, 13)}`);
    }
  }

  // The caveats are part of the answer, not a footnote — they bound what it is worth.
  console.log('\n  ── Read this before acting on the date ──');
  for (const c of out.caveats) console.log(`  • ${c}`);
  console.log('');
})().catch((e) => { console.error(e); process.exit(1); });
