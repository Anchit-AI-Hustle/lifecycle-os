#!/usr/bin/env node
'use strict';

/**
 * Wayback collector — pulls historical snapshots of competitor landing pages
 * from the Internet Archive (web.archive.org) so the repository has version
 * history that predates our own monitoring. Pure HTTP, no browser.
 *
 * Uses the CDX API to enumerate snapshots, fetches the archived HTML (id_ raw
 * mode — original bytes, no Wayback chrome), parses a lightweight content blob,
 * and persists via ci-collect.collectLanding with source='wayback'. The
 * content-hash dedup means re-runs are cheap and each materially-different
 * snapshot becomes a version.
 *
 * URL SOURCES:
 *   URLS="https://brand.com/pages/sale"   explicit, OR
 *   default: distinct landing_url values already on ci_ads.
 *
 * USAGE:
 *   npm run collect:wayback
 *   URLS="https://knickgasm.com/pages/sale" LIMIT=8 npm run collect:wayback
 */

require('./_env')();
const ciCollect = require('../api/_shared/ci-collect');
const supa = require('../api/_shared/supa');

const PER_URL = Number(process.env.LIMIT || 6);   // snapshots per URL
const FROM = process.env.FROM || '';               // YYYYMMDD lower bound (optional)

function stripTags(html) {
  return (html || '')
    // End tags allow any whitespace/junk before '>' (e.g. "</script >" or
    // "</script\t\n foo>") so the filter can't be bypassed — CodeQL
    // js/bad-tag-filter. \b keeps "</scriptx>" from matching a different tag.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseHtml(html) {
  const text = stripTags(html);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const h1 = stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  const prices = Array.from(new Set((text.match(/(?:[$£€₹])\s?\d[\d,]*(?:\.\d{2})?/g) || []).slice(0, 30)));
  const offer = (text.match(/(\d{1,2}\s*%\s*off|free\s+(gift|shipping)|save\s+(?:[$£€₹])?\d+|buy\s+one\s+get\s+one|subscribe\s*&?\s*save)/i) || [])[0] || null;
  const subscription = /subscribe\s*&?\s*save|subscription|auto[-\s]?ship/i.test(text);
  return { headline: h1 || stripTags(title), pricing: prices, offer, subscription,
    bundles: Array.from(new Set((text.match(/\b(bundle|kit|sampler|trio|duo)\b/gi) || []))).slice(0, 8) };
}

async function snapshots(url) {
  const params = new URLSearchParams({ url, output: 'json', fl: 'timestamp,original,statuscode',
    filter: 'statuscode:200', collapse: 'timestamp:6', limit: String(PER_URL) });
  if (FROM) params.set('from', FROM);
  const r = await fetch(`https://web.archive.org/cdx/search/cdx?${params}`);
  if (!r.ok) return [];
  const rows = await r.json();
  return rows.slice(1).map(([ts, original]) => ({ ts, original })); // row 0 is the header
}

async function urlList() {
  if (process.env.URLS) return process.env.URLS.split(',').map(s => s.trim()).filter(Boolean);
  const ads = await supa.select('ci_ads', { filters: { landing_url: 'not.is.null' }, order: 'last_seen.desc', limit: 200 });
  return Array.from(new Set(ads.map(a => ciCollect.canonicalUrl(a.landing_url)))).slice(0, 30);
}

(async () => {
  const urls = await urlList();
  if (!urls.length) { console.log('[wayback] no URLs to backfill.'); return; }
  console.log(`[wayback] backfilling ${urls.length} URL(s), up to ${PER_URL} snapshots each`);

  let total = 0, stored = 0;
  for (const url of urls) {
    let snaps = [];
    try { snaps = await snapshots(url); } catch (e) { console.warn(`  ✗ cdx ${url}: ${e.message}`); continue; }
    for (const s of snaps) {
      total++;
      const archived = `https://web.archive.org/web/${s.ts}id_/${s.original}`;
      try {
        const r = await fetch(archived, { headers: { 'User-Agent': 'KnickgasmCIBot/1.0' } });
        if (!r.ok) continue;
        const html = await r.text();
        const res = await ciCollect.collectLanding({
          source: 'wayback', url,
          source_link: `https://web.archive.org/web/${s.ts}/${s.original}`,
          raw_html: html, parsed: parseHtml(html)
        });
        if (res.status !== 'seen') stored++;
      } catch (e) { /* skip a bad snapshot */ }
    }
    console.log(`  ✓ ${url}: ${snaps.length} snapshot(s)`);
  }
  console.log(`[wayback] done — fetched=${total} new/changed=${stored}`);
})().catch(e => { console.error('[wayback] fatal:', e); process.exit(1); });
