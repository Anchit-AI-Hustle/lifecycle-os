'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Competitive Intelligence — COLLECTION core.
//
// Normalize → content-hash → dedup → store, with automatic version history and
// structured change-diffs for ads / emails / landing pages. This is the
// real-time competitor stream; it is kept strictly separate from own-data
// (kb_*) logic — nothing here ever reads or writes the Smart-Brain tables.
//
// Collectors (Playwright workers, IMAP sync, aggregator pulls) hand us already-
// fetched payloads; this module owns the persistence contract so dedup +
// versioning happen in exactly one place.
// ─────────────────────────────────────────────────────────────────────────────

const supa = require('./supa');
const offers = require('./ci-offers');

// Real-time subscriber fan-out (lazy require to avoid a load cycle). Fully
// detached: we never await it in the capture path and swallow all errors so a
// notification failure can never affect whether an asset is stored.
function notifyAsset(channel, assetRow) {
  try {
    const subs = require('./ci-subscriptions-core');
    Promise.resolve(subs.notifyNewAsset({ channel, asset: assetRow })).catch(() => {});
  } catch (_) { /* subscriptions module unavailable — ignore */ }
}

// ── URL canonicalization (mirror of kb.js so hashes are consistent) ──────────
function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    const TRACK = /^(utm_|fbclid$|gclid$|mc_|_hsenc$|_hsmi$|hsCtaTracking$|ref$|source$)/i;
    [...u.searchParams.keys()].forEach((k) => { if (TRACK.test(k)) u.searchParams.delete(k); });
    if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch { return raw || ''; }
}

function normalizeDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return (url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase(); }
}

// Resolve a brand row by name/domain; create a lightweight stub if unknown so a
// freshly-discovered advertiser never blocks collection.
async function resolveBrand({ brand_id, brand_name, domain }) {
  if (brand_id) {
    const rows = await supa.select('brands', { filters: { id: `eq.${brand_id}` }, limit: 1 });
    if (rows[0]) return rows[0];
  }
  const slug = (brand_name || normalizeDomain(domain) || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug) {
    const rows = await supa.select('brands', { filters: { slug: `eq.${slug}` }, limit: 1 });
    if (rows[0]) return rows[0];
  }
  if (!brand_name && !domain) return null;
  const [created] = await supa.insert('brands',
    [{ name: brand_name || normalizeDomain(domain), slug, domain: domain ? normalizeDomain(domain) : null }],
    { upsertOn: 'slug' });
  return created;
}

// ── Version history: snapshot the prior row + compute a field-level diff ──────
const DIFF_FIELDS = {
  ad:      ['headline', 'primary_copy', 'description', 'cta', 'landing_url', 'creative_type'],
  email:   ['subject', 'preheader', 'sender'],
  landing: ['url', 'parsed']
};

function computeDiff(assetType, prev, next) {
  const fields = DIFF_FIELDS[assetType] || [];
  const diff = {}; const changed = [];
  for (const f of fields) {
    const a = JSON.stringify(prev[f] ?? null);
    const b = JSON.stringify(next[f] ?? null);
    if (a !== b) { diff[f] = { from: prev[f] ?? null, to: next[f] ?? null }; changed.push(f); }
  }
  // Landing pages: surface the high-value semantic changes the brief asked for.
  if (assetType === 'landing' && prev.parsed && next.parsed) {
    for (const k of ['pricing', 'bundles', 'subscription', 'offer', 'headline', 'cta']) {
      const a = JSON.stringify(prev.parsed[k] ?? null);
      const b = JSON.stringify(next.parsed[k] ?? null);
      if (a !== b) { diff[`lp_${k}`] = { from: prev.parsed[k] ?? null, to: next.parsed[k] ?? null }; changed.push(`lp_${k}`); }
    }
  }
  return { diff, changed };
}

async function snapshotVersion(assetType, currentRow, incoming) {
  const { diff, changed } = computeDiff(assetType, currentRow, incoming);
  if (!changed.length) return { changed: [] };
  const prior = await supa.select('ci_asset_versions', {
    filters: { asset_type: `eq.${assetType}`, asset_id: `eq.${currentRow.id}` },
    order: 'version_no.desc', limit: 1
  });
  const version_no = (prior[0]?.version_no || 0) + 1;
  await supa.insert('ci_asset_versions', [{
    asset_type: assetType, asset_id: currentRow.id, version_no,
    content_hash: currentRow.content_hash, snapshot: currentRow, diff, changed_fields: changed
  }]);
  return { changed, version_no };
}

// ═══════════════════════════════════════════════════════════════════════════
// ADS
// ═══════════════════════════════════════════════════════════════════════════
async function collectAd(raw) {
  const brand = await resolveBrand(raw);
  const payloadForHash = {
    headline: raw.headline, primary_copy: raw.primary_copy, description: raw.description,
    cta: raw.cta, image_urls: raw.image_urls || [], video_urls: raw.video_urls || []
  };
  const content_hash = supa.sha1(`${raw.source}|${raw.ad_id || ''}|${supa.hashObj(payloadForHash)}`);

  const existing = await supa.select('ci_ads', { filters: { content_hash: `eq.${content_hash}` }, limit: 1 });
  const now = new Date().toISOString();

  if (existing[0]) {
    // Same creative — just refresh last_seen / active.
    await supa.update('ci_ads', { last_seen: now, active: true }, { id: `eq.${existing[0].id}` });
    return { id: existing[0].id, status: 'seen', content_hash };
  }

  // New creative. Is there a prior version under the same source+ad_id?
  let prior = null;
  if (raw.ad_id) {
    const rows = await supa.select('ci_ads', {
      filters: { source: `eq.${raw.source}`, ad_id: `eq.${raw.ad_id}` },
      order: 'created_at.desc', limit: 1
    });
    prior = rows[0] || null;
  }

  const row = {
    brand_id: brand?.id || null, brand_name: brand?.name || raw.brand_name || null,
    source: raw.source, ad_id: raw.ad_id || null, content_hash,
    first_seen: now, last_seen: now, active: true,
    creative_type: raw.creative_type || (raw.video_urls?.length ? 'video' : 'image'),
    image_urls: raw.image_urls || [], video_urls: raw.video_urls || [],
    primary_copy: raw.primary_copy || null, headline: raw.headline || null,
    description: raw.description || null, cta: raw.cta || null,
    landing_url: raw.landing_url ? canonicalUrl(raw.landing_url) : null,
    source_link: raw.source_link || null, raw_html: raw.raw_html || null, raw_json: raw.raw_json || null
  };
  const [created] = await supa.insert('ci_ads', [row]);

  let versioned = null;
  if (prior) {
    versioned = await snapshotVersion('ad', prior, created);
    await supa.update('ci_ads', { active: false }, { id: `eq.${prior.id}` }); // retire old creative
  }

  await offers.extractAndStore({ assetType: 'ad', assetId: created.id, brand, source: raw.source,
    text: [raw.headline, raw.primary_copy, raw.description, raw.cta].filter(Boolean).join(' \n ') });

  // Real-time fan-out: email every user who follows this brand's ads. New
  // creatives only (prior=changed still counts as a new asset the user hasn't
  // seen). Fire-and-forget — never blocks or fails the capture.
  notifyAsset('ads', created);

  return { id: created.id, status: prior ? 'changed' : 'new', content_hash, changed: versioned?.changed || [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// EMAILS  (links are stored but NEVER auto-clicked — see CTAs handling)
// ═══════════════════════════════════════════════════════════════════════════
async function collectEmail(raw) {
  const brand = await resolveBrand(raw);
  const content_hash = supa.sha1(`${raw.sender || ''}|${raw.subject || ''}|${raw.send_date || ''}`);
  const existing = await supa.select('ci_emails', { filters: { content_hash: `eq.${content_hash}` }, limit: 1 });
  if (existing[0]) return { id: existing[0].id, status: 'seen', content_hash };

  const row = {
    brand_id: brand?.id || null, brand_name: brand?.name || raw.brand_name || raw.sender || null,
    source: raw.source || 'inbox', content_hash,
    subject: raw.subject || null, preheader: raw.preheader || null, sender: raw.sender || null,
    send_date: raw.send_date || null, html: raw.html || null, plain_text: raw.plain_text || null,
    images: raw.images || [],
    ctas: (raw.ctas || []).map(c => ({ text: c.text || c.label || '', href: c.href || c.url || '', clicked: false })),
    promotions: raw.promotions || [], raw_mime: raw.raw_mime || null, attachments: raw.attachments || [],
    source_link: raw.source_link || null
  };
  const [created] = await supa.insert('ci_emails', [row]);

  await offers.extractAndStore({ assetType: 'email', assetId: created.id, brand, source: row.source,
    text: [raw.subject, raw.preheader, raw.plain_text].filter(Boolean).join(' \n ') });

  // Real-time fan-out: email every user who follows this brand's mailers.
  notifyAsset('mailers', created);

  return { id: created.id, status: 'new', content_hash };
}

// ═══════════════════════════════════════════════════════════════════════════
// LANDING PAGES
// ═══════════════════════════════════════════════════════════════════════════
async function collectLanding(raw) {
  const url = canonicalUrl(raw.url);
  const brand = await resolveBrand({ ...raw, domain: raw.domain || url });
  const url_hash = supa.sha1(url);
  const parsed = raw.parsed || {};
  const content_hash = supa.sha1(supa.hashObj({
    pricing: parsed.pricing, bundles: parsed.bundles, subscription: parsed.subscription,
    offer: parsed.offer, headline: parsed.headline, cta: parsed.cta
  }));

  const exact = await supa.select('ci_landing_pages', {
    filters: { url_hash: `eq.${url_hash}`, content_hash: `eq.${content_hash}` }, limit: 1
  });
  if (exact[0]) {
    await supa.update('ci_landing_pages', { captured_at: new Date().toISOString() }, { id: `eq.${exact[0].id}` });
    return { id: exact[0].id, status: 'seen', content_hash };
  }

  // Same URL, different content → a change. Snapshot the latest prior capture.
  const priorRows = await supa.select('ci_landing_pages', {
    filters: { url_hash: `eq.${url_hash}` }, order: 'captured_at.desc', limit: 1
  });
  const prior = priorRows[0] || null;

  const row = {
    brand_id: brand?.id || null, brand_name: brand?.name || raw.brand_name || normalizeDomain(url),
    source: raw.source || 'direct', url, url_hash, content_hash,
    raw_html: raw.raw_html || null, dom_snapshot: raw.dom_snapshot || null, parsed,
    source_link: raw.source_link || raw.url || null
  };
  const [created] = await supa.insert('ci_landing_pages', [row]);

  let versioned = null;
  if (prior) versioned = await snapshotVersion('landing', prior, created);

  if (parsed.offer || parsed.pricing) {
    await offers.extractAndStore({ assetType: 'landing', assetId: created.id, brand, source: row.source,
      text: [parsed.headline, JSON.stringify(parsed.offer || ''), parsed.cta].filter(Boolean).join(' \n ') });
  }

  return { id: created.id, status: prior ? 'changed' : 'new', content_hash, changed: versioned?.changed || [] };
}

module.exports = {
  canonicalUrl, normalizeDomain, resolveBrand,
  collectAd, collectEmail, collectLanding, snapshotVersion, computeDiff
};
