'use strict';
/**
 * competitor-universe.js — the per-brand competitor set, without Google.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Competitor Benchmarking used to read its brand universe out of a Google
 * Sheet through a service account. Two things were wrong with that, and both
 * were visible in production:
 *
 *   1. It could not run at all. sheetsClient() throws "Google auth not
 *      configured" whenever neither the WIF pair nor the legacy JWT pair is in
 *      the environment, which is the state this deployment is in. So every
 *      brand saw "0 brands" and a credentials error where its competitors
 *      should be, and no amount of onboarding fixed it.
 *   2. One spreadsheet is one universe. There is nowhere in it to record WHICH
 *      brand a competitor belongs to, so a publisher and a sneaker studio would
 *      have shared a list. The platform is multi-tenant now; its competitor
 *      store has to be too.
 *
 * So the universe lives in Postgres (public.brand_competitors, migration
 * 20260813120000), scoped by workspace and protected by the same
 * is_brand_member RLS the rest of the brand content uses. The Google Sheet is
 * still supported as an EXPORT when credentials happen to be present, which is
 * what a spreadsheet is genuinely good for. Nothing requires it.
 *
 * ZERO FABRICATION (docs/campaign-orchestration-master-spec.md)
 *
 * A competitor name is a factual claim about a real company, and a domain is a
 * stronger one. This module therefore never writes a name, a domain or a
 * positioning line it cannot attribute:
 *
 *   * Seeding reads ONLY the brand's own record, so the facts were already
 *     stated by the operator or by that brand's own market study.
 *   * Discovery may propose a name and a homepage, and those land marked
 *     `verification:'unverified'` with a data gap saying so. It may NOT
 *     contribute a positioning line, because that is an opinion about another
 *     company that nobody has evidenced.
 *   * When neither path yields anything, the caller gets
 *     [DATA REQUIRED BEFORE LAUNCH: ...] instead of a plausible-looking list.
 *
 * ONE BRAND'S COMPETITORS ARE NEVER ANOTHER'S
 *
 * competitor-core.seedBrands() already refuses to seed its shipped list into
 * any workspace but tenant zero, on the grounds that the list is a fact about
 * ONE brand's market. The same rule is enforced here structurally rather than
 * by a check: seeding derives from the workspace's own record, and the record
 * is fetched by id with no fall back to the default brand. A workspace whose
 * record cannot be read gets a refusal, never tenant zero's market study.
 *
 * NOT a function file (api/_shared/ is outside the Hobby 12-function cap).
 * Mounted on the existing api/competitor.js ?action= router; the scheduled
 * refresh hangs off the existing daily cron in api/brain.js ?action=cron.
 * ---------------------------------------------------------------------------
 */

const TABLE = 'brand_competitors';
const REFRESH_TABLE = 'brand_competitor_refresh';
const MAX_UNIVERSE = 500;        // per workspace, keeps a serverless call bounded
const MAX_PER_DISCOVERY = 40;

/* ── small helpers ─────────────────────────────────────────────────────────── */

function str(v, max) {
  const s = String(v == null ? '' : v).trim();
  return max ? s.slice(0, max) : s;
}

function uniq(list) {
  return [...new Set((list || []).filter(Boolean))];
}

/** The spec's marker for a fact nobody has supplied. Reported, never filled. */
function gap(field, subject, region) {
  return `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${subject || 'all'}, ${region || 'all'}]`;
}

/** Registrable host, lowercased, no scheme, no "www.", no path. */
function normalizeDomain(url) {
  if (!url) return '';
  let u = String(url).trim().toLowerCase();
  u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '');
  return u.split('/')[0].split('?')[0].split('#')[0].split('@').pop().split(':')[0].trim();
}

/**
 * Hosts that belong to the brand ITSELF. A brand is not its own competitor,
 * and a discovery run that returns the brand's own site has found nothing.
 */
function ownDomains(brand) {
  const b = brand || {};
  const out = [];
  if (b.website) out.push(normalizeDomain(b.website));
  for (const h of (Array.isArray(b.asset_hosts) ? b.asset_hosts : [])) out.push(normalizeDomain(h));
  for (const r of (Array.isArray(b.regions) ? b.regions : [])) {
    if (r && r.store_url) out.push(normalizeDomain(r.store_url));
  }
  return uniq(out);
}

function isOwnDomain(domain, brand) {
  const d = normalizeDomain(domain);
  if (!d) return false;
  return ownDomains(brand).some((o) => o && (d === o || d.endsWith('.' + o)));
}

/** Region labels this brand actually operates in, for the gap markers. */
function regionCodes(brand) {
  const rs = (brand && Array.isArray(brand.regions)) ? brand.regions : [];
  return uniq(rs.map((r) => str(r && r.code).toUpperCase()));
}

/** The distinct kinds of thing this brand sells or publishes. */
function offeringKinds(brand) {
  const offs = (brand && Array.isArray(brand.offerings)) ? brand.offerings : [];
  return uniq(offs.map((o) => str(o && o.kind, 40).toLowerCase()));
}

/* ── derivation from the brand's OWN record ────────────────────────────────── */

/**
 * A tier that says outright it is not a competitor is not one. Tenant zero's
 * own study has exactly such a tier ("they supply the BLANK canvas ... they are
 * not competitors for the customisation job"), and reading names out of it
 * would put Nike in the brand's rival list.
 */
const NOT_A_COMPETITOR_RX = /\bnot\s+(?:a\s+)?(?:competitors?|rivals?|competing|competitive)\b/i;

/**
 * Names listed in a tier's prose note.
 *
 * The note is written by a human, so this is deliberately timid. It reads only
 * the clause that FOLLOWS a label ("Direct competitors: A, B, C.") and stops at
 * the end of that sentence, because everything after it is commentary. A
 * fragment that does not look like a company name is REJECTED rather than
 * cleaned up: "the official programmes Nike By You" is not a company, and
 * storing it would be inventing one. Rejects are returned so the caller can
 * report them instead of silently losing them.
 */
function namesFromNote(note) {
  const s = str(note);
  const names = [], rejected = [];
  const colon = s.indexOf(':');
  if (colon < 0) return { names, rejected };
  let clause = s.slice(colon + 1);
  const stop = clause.search(/[.;]/);
  if (stop >= 0) clause = clause.slice(0, stop);
  for (const raw of clause.split(/,|\band\b/i)) {
    const frag = raw.trim().replace(/\s{2,}/g, ' ');
    if (!frag) continue;
    // A company name in a list is capitalised and short. Anything else is
    // sentence prose that happened to sit between two commas.
    if (!/^[A-Z0-9]/.test(frag) || frag.split(/\s+/).length > 6 || frag.length > 80) {
      rejected.push(frag);
      continue;
    }
    names.push(frag);
  }
  return { names, rejected };
}

/** Every (region, tier) pair in a brand's market study, in one flat list. */
function studyTiers(brand) {
  const ms = brand && brand.market_study;
  if (!ms || typeof ms !== 'object') return [];
  const out = [];
  for (const [region, study] of Object.entries(ms)) {
    const tiers = (study && Array.isArray(study.tiers)) ? study.tiers : [];
    for (const tier of tiers) if (tier && typeof tier === 'object') out.push({ region, tier });
  }
  return out;
}

function candidate(fields) {
  const website = str(fields.website, 500);
  const domain = normalizeDomain(website);
  return {
    name: str(fields.name, 200),
    website: website || null,
    domain,
    category: str(fields.category, 200) || null,
    country: str(fields.country, 80) || null,
    positioning: str(fields.positioning, 300) || null,
    newsletter_url: str(fields.newsletter_url, 500) || null,
    source: fields.source || 'manual',
    evidence: str(fields.evidence, 600) || null,
    verification: fields.verification === 'verified' ? 'verified' : 'unverified',
    data_gaps: Array.isArray(fields.data_gaps) ? fields.data_gaps : [],
  };
}

/**
 * Competitor candidates derived from the brand's own record: the competitors
 * an operator typed in during onboarding, and the companies that brand's own
 * market study names tier by tier. Nothing here comes from outside the record,
 * which is what makes it safe to run automatically on activation.
 *
 * Returns { candidates, gaps, notes } — gaps carry the spec's marker for what
 * the record does not say (most often a competitor's website).
 */
function deriveFromBrandRecord(brand) {
  const b = brand || {};
  const candidates = [], gaps = [], notes = [];
  const regions = regionCodes(b).join('/') || 'all';

  // 1. Competitors the operator entered themselves. Highest trust: a human
  //    typed them for THIS brand.
  const declared = Array.isArray(b.competitors) ? b.competitors
    : (b.brand_data && Array.isArray(b.brand_data.competitors)) ? b.brand_data.competitors : [];
  for (const entry of declared.slice(0, MAX_UNIVERSE)) {
    const name = typeof entry === 'string' ? entry : str(entry && entry.name, 200);
    if (!name) continue;
    const website = typeof entry === 'object' ? str(entry.website || entry.url, 500) : '';
    if (website && isOwnDomain(website, b)) continue;              // the brand is not its own rival
    const c = candidate({
      name, website,
      category: typeof entry === 'object' ? entry.category : '',
      country: typeof entry === 'object' ? entry.country : '',
      // A positioning line is only carried when the record itself stated one.
      positioning: typeof entry === 'object' ? entry.positioning : '',
      source: 'brand_record',
      evidence: `Named as a competitor in ${b.name || 'this brand'}'s own brand record.`,
      verification: website ? 'verified' : 'unverified',
    });
    if (!c.website) c.data_gaps = [gap('competitor website', c.name, regions)];
    candidates.push(c);
  }

  // 2. The brand's own market study, tier by tier.
  for (const { region, tier } of studyTiers(b)) {
    const tierName = str(tier.name, 200);
    if (NOT_A_COMPETITOR_RX.test(str(tier.note))) {
      notes.push(`Skipped "${tierName}": this brand's own study says that tier does not compete with it.`);
      continue;
    }
    // Structured entries are preferred over prose, because they carry the URL
    // and the provenance the prose cannot.
    const structured = Array.isArray(tier.brands) ? tier.brands : [];
    if (structured.length) {
      for (const entry of structured) {
        const name = typeof entry === 'string' ? entry : str(entry && entry.name, 200);
        if (!name) continue;
        const website = typeof entry === 'object' ? str(entry.website, 500) : '';
        if (website && isOwnDomain(website, b)) continue;
        const src = typeof entry === 'object' ? str(entry.source, 400) : '';
        const c = candidate({
          name, website,
          category: tierName,
          country: typeof entry === 'object' && entry.country ? entry.country : region,
          source: 'brand_record',
          evidence: `${tierName} in ${b.name || 'this brand'}'s own market study (${region})${src ? `. Source: ${src}` : ''}`,
          // A URL plus a recorded source is what "checked" means here. A name
          // with neither is a real company nobody has resolved to a site yet.
          verification: website && src ? 'verified' : 'unverified',
        });
        if (!c.website) c.data_gaps = [gap('competitor website', c.name, region)];
        candidates.push(c);
      }
      continue;
    }
    const { names, rejected } = namesFromNote(tier.note);
    for (const name of names) {
      const c = candidate({
        name,
        category: tierName,
        country: region,
        source: 'brand_record',
        evidence: `Named under "${tierName}" in ${b.name || 'this brand'}'s own market study (${region}).`,
      });
      c.data_gaps = [gap('competitor website', c.name, region)];
      candidates.push(c);
    }
    for (const frag of rejected) {
      gaps.push(gap('competitor name (unreadable in market study prose)', frag.slice(0, 60), region));
    }
  }

  if (!candidates.length) {
    gaps.push(gap('competitor set', b.name || 'this brand', regions));
    notes.push(
      `${b.name || 'This brand'} has no competitors in its own record: neither a competitor list nor a market study naming any. `
      + 'Another brand\'s competitor set is never substituted, so the set stays empty until this brand\'s own competitors are added or a discovery run finds real ones.'
    );
  }
  return { candidates, gaps, notes };
}

/* ── de-duplication ────────────────────────────────────────────────────────── */

/**
 * The key a row is unique by WITHIN a workspace. Mirrors the generated column
 * in the migration exactly, so the in-process check and the database's unique
 * index can never disagree: domain when there is one, folded name otherwise.
 */
function dedupeKey(row) {
  const d = normalizeDomain((row && (row.domain || row.website)) || '');
  if (d) return d;
  return 'name:' + str(row && row.name).toLowerCase();
}

/**
 * Split incoming candidates into what is genuinely new, what already exists,
 * and what merely upgrades an existing row.
 *
 * The upgrade case is the interesting one. A name derived from a market study
 * has no domain, so it is keyed by name; when discovery later finds that
 * company's homepage, inserting it would create a SECOND row for one company.
 * It patches the existing row instead.
 */
function dedupe(existing, incoming) {
  const byKey = new Map();
  const byName = new Map();
  for (const row of (existing || [])) {
    const k = dedupeKey(row);
    byKey.set(k, row);
    const n = str(row.name).toLowerCase();
    if (n) byName.set(n, row);
  }

  const fresh = [], upgrades = [], skipped = [];
  for (const c of (incoming || [])) {
    if (!c || !str(c.name)) continue;
    const key = dedupeKey(c);
    if (byKey.has(key)) { skipped.push({ name: c.name, reason: 'duplicate', key }); continue; }

    const named = byName.get(str(c.name).toLowerCase());
    if (named && !normalizeDomain(named.domain || named.website) && normalizeDomain(c.domain || c.website)) {
      upgrades.push({ id: named.id, key: dedupeKey(named), patch: {
        website: c.website, domain: normalizeDomain(c.domain || c.website),
        verification: c.verification, evidence: c.evidence || named.evidence,
        data_gaps: (c.data_gaps || []).filter((g) => !/competitor website/.test(g)),
      } });
      byKey.set(key, Object.assign({}, named, { domain: normalizeDomain(c.domain || c.website) }));
      skipped.push({ name: c.name, reason: 'upgraded_existing', key });
      continue;
    }
    byKey.set(key, c);
    if (str(c.name)) byName.set(str(c.name).toLowerCase(), c);
    fresh.push(c);
  }
  return { fresh, upgrades, skipped };
}

/* ── discovery ─────────────────────────────────────────────────────────────── */

/* WHAT THE BRAND SAYS IT DOES, IN ITS OWN WORDS (2026-10-11)
 *
 * Discovery used to refuse unless `industry` or `offerings[].kind` was set,
 * and nothing in the platform fills `industry`: "Read my site" does not
 * propose one (a description is not an industry, and turning one into the
 * other would be the first fabrication in the chain). So competitor
 * benchmarking worked for no onboarded brand. Production,
 * /competitor-benchmarking#discover, brand "Deli Chic", market IN: "Nothing
 * added. [DATA REQUIRED BEFORE LAUNCH: brand industry or offerings, ...]" - on
 * a record whose tagline was its own site's description.
 *
 * The brief is now built from what the brand ITSELF publishes, quoted and
 * labelled, in this order: its declared industry; its offerings; its own
 * self-description (the tagline, or a description read off its own website -
 * judged by the coherence rule's sameBrand(), never a second domain
 * comparison, so a description read from another company's site is not this
 * brand's); the product types and a few titles of its OWN live catalogue rows
 * (catalogIdentity()/catalogRowForeign() decide which rows are its own, stale
 * rows are left out); and the declared page descriptions its context pack
 * filed from its own domain. Only when NONE of it exists is the run refused
 * with the marker. Nothing here is paraphrased into an industry. */

const SELF_DESCRIPTION_MAX = 400;

function coherence() {
  try { return require('./brand-coherence.js'); } catch (_) { return null; }
}
function isMarker(v) { return /^\s*\[DATA REQUIRED BEFORE LAUNCH/i.test(String(v || '')); }

/** The brand's own website domain, as the coherence rule identifies it, or ''. */
function identityDomain(brand) {
  const C = coherence();
  if (!C || !brand) return '';
  try { const v = C.brandCoherence(brand); return (v && v.identity && v.identity.domain) || ''; } catch (_) { return ''; }
}

/** Is this URL on the brand's own website (the coherence rule's sameBrand)? */
function onOwnSite(url, idDomain) {
  const C = coherence();
  if (!C || !idDomain || !url) return false;
  const host = C.hostOf(url);
  if (!host) return false;
  return C.sameBrand(idDomain, C.registrableDomain(host));
}

/**
 * The brand's own description(s) of itself: [{ text, where, url }].
 * where = 'site' (read off its own website, the page named) or 'record'
 * (typed by a person, a brand guidelines document, or a record saved before
 * origins existed - the record's own statement). A value read from another
 * site, a template's (preset) value and the wizard's placeholder are not this
 * brand describing itself, and are left out.
 */
function selfDescriptions(brand, idDomain) {
  const b = brand || {};
  const C = coherence();
  const out = [];
  const seen = new Set();
  const push = (text, where, url) => {
    const t = str(text, SELF_DESCRIPTION_MAX);
    if (!t || t.length < 8 || isMarker(t)) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ text: t, where, url: url || '' });
  };
  const tagline = str(b.tagline);
  if (tagline && !isMarker(tagline)) {
    let src = null;
    try { src = C ? C.sourceOf(b, 'tagline') : null; } catch (_) { src = null; }
    const bd = b.brand_data && typeof b.brand_data === 'object' ? b.brand_data : {};
    const fo = bd.field_origin && typeof bd.field_origin === 'object' ? str(bd.field_origin.tagline) : '';
    const origin = (src && src.origin) || fo;
    if (src && src.url) {
      if (onOwnSite(src.url, idDomain)) push(tagline, 'site', src.url);
    } else if (origin !== 'preset' && origin !== 'default' && !/^site-/.test(origin)) {
      push(tagline, 'record', '');
    }
  }
  // What "Read my site" recorded for the description, while it is the site's
  // own words on the brand's own domain.
  const ap = b.brand_data && b.brand_data.brand_extraction && b.brand_data.brand_extraction.applied;
  if (ap && typeof ap === 'object') {
    for (const key of ['tagline', 'description']) {
      const rec = ap[key];
      if (rec && typeof rec === 'object' && str(rec.value) && onOwnSite(rec.source_url, idDomain)) push(rec.value, 'site', str(rec.source_url));
    }
  }
  return out.slice(0, 3);
}

/**
 * The brand's OWN live catalogue rows, reduced to what describes its market:
 * product types (most common first) and a few titles, verbatim. A row the
 * coherence rule judges another brand's, or a stale row, is not counted.
 */
function catalogueEvidence(brand, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { types: [], titles: [], rows: 0, excluded: 0 };
  const C = coherence();
  let verdict = null;
  try { verdict = C ? C.catalogIdentity(brand || {}) : null; } catch (_) { verdict = null; }
  let excluded = 0;
  const own = list.filter((r) => {
    if (!r || typeof r !== 'object' || r.stale_at) return false;
    if (verdict && C.catalogRowForeign(r, verdict)) { excluded++; return false; }
    return true;
  });
  const counts = new Map();
  for (const r of own) {
    const t = str(r.product_type, 60);
    if (!t || isMarker(t)) continue;
    const k = t.toLowerCase();
    const c = counts.get(k) || { label: t, n: 0 };
    c.n++; counts.set(k, c);
  }
  const types = [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, 8).map((c) => c.label);
  const titles = uniq(own.map((r) => str(r.title, 100)).filter((t) => t && !isMarker(t))).slice(0, 5);
  return { types, titles, rows: own.length, excluded };
}

/** The declared page descriptions the context pack filed from the brand's own domain. */
function pageEvidence(rows, idDomain) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && str(r.summary) && !isMarker(r.summary) && onOwnSite(r.url, idDomain));
  const isHome = (u) => { try { return new URL(String(u)).pathname.replace(/\/+$/, '') === ''; } catch (_) { return false; } };
  list.sort((a, b) => (isHome(b.url) ? 1 : 0) - (isHome(a.url) ? 1 : 0));
  const seen = new Set();
  const out = [];
  for (const r of list) {
    const t = str(r.summary, SELF_DESCRIPTION_MAX);
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ text: t, url: str(r.url, 300), title: str(r.title, 120) });
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * What we can honestly tell a discovery run to look for, from what the brand
 * itself publishes. `evidence` = { catalogRows, knowledgeRows } read for this
 * workspace (refreshWorkspace loads them). Refused only when NONE exists:
 * guessing a market would be the first fabrication in the chain.
 */
function discoveryBrief(brand, evidence) {
  const b = brand || {};
  const e = evidence || {};
  const industry = str(b.industry, 200);
  const kinds = offeringKinds(b);
  const regions = regionCodes(b);
  const idDomain = identityDomain(b);
  const selfDesc = selfDescriptions(b, idDomain);
  const catalogue = catalogueEvidence(b, e.catalogRows);
  const pages = pageEvidence(e.knowledgeRows, idDomain)
    .filter((p) => !selfDesc.some((d) => d.text.toLowerCase() === p.text.toLowerCase()));
  const name = str(b.name, 200);
  const basis = [];
  if (industry) basis.push('declared industry');
  if (kinds.length) basis.push('offerings');
  if (selfDesc.length) basis.push(selfDesc.some((d) => d.where === 'site') ? 'own site\'s description of itself' : 'own description of itself');
  if (catalogue.types.length || catalogue.titles.length) basis.push('own catalogue');
  if (pages.length) basis.push('own site\'s page descriptions');
  if (!basis.length) {
    return {
      ok: false,
      error: 'discovery_brief_missing',
      gap: gap('brand industry or offerings', name || 'this brand', regions.join('/') || 'all'),
      note: `Competitor discovery needs to know what ${name || 'this brand'} sells, and its record does not say: no industry, no offerings, no description of itself from its own site, and no catalogue of its own. Say what it sells (the industry), or import its catalogue, and run it again.`
        + (catalogue.excluded ? ` ${catalogue.excluded} catalogue row(s) on this workspace come from another brand's site and were not used.` : ''),
    };
  }
  return {
    ok: true, industry, kinds, regions, name, website: str(b.website, 300),
    self_descriptions: selfDesc, catalogue, pages, basis,
    basis_line: `${name || 'this brand'}'s ${basis.join(', ')}`,
  };
}

/**
 * The prompt, built entirely from THIS brand's own fields. Nothing about any
 * other tenant's market appears in it - the old sheet-backed discovery hard
 * coded a sneaker category list and a set of sneaker exemplars, which would
 * have handed every brand on the platform sneaker competitors. The brand's own
 * words are QUOTED with where they were published; none is paraphrased.
 */
function discoveryPrompt(brand, opts) {
  const o = opts || {};
  const brief = discoveryBrief(brand, o.evidence);
  if (!brief.ok) return brief;
  const limit = Math.min(Math.max(Number(o.limit) || 20, 5), MAX_PER_DISCOVERY);
  const exclude = uniq([...(o.existingDomains || []), ...ownDomains(brand)]);
  const q = (t) => `"${String(t).replace(/"/g, '\'')}"`;

  const system = [
    'You are a competitor-research engine. You output strict JSON and nothing else.',
    'Every company you name must be a REAL, currently-operating company, returned with its REAL primary website.',
    'Never invent a company. Never invent or guess a domain. If you are not sure a company exists or not sure of its website, omit it entirely.',
    'Returning fewer companies, or none at all, is correct and expected. A short accurate list beats a long plausible one.',
  ].join(' ');

  const quoted = brief.self_descriptions.length || brief.pages.length || brief.catalogue.titles.length;
  const lines = [
    `Find up to ${limit} companies that compete with ${brief.name || 'this company'}${brief.website ? ` (${brief.website})` : ''}.`,
    brief.industry ? `Industry, as the company describes itself: ${brief.industry}.` : '',
    brief.kinds.length ? `What it offers: ${brief.kinds.join(', ')}.` : '',
    ...brief.self_descriptions.map((d) => (d.where === 'site'
      ? `How the company describes itself on its own site: ${q(d.text)} (${d.url}).`
      : `How the company describes itself in its own brand record: ${q(d.text)}.`)),
    brief.catalogue.types.length ? `Product types in its own catalogue: ${brief.catalogue.types.join(', ')}.` : '',
    brief.catalogue.titles.length ? `Some products in its own catalogue, titled as it titles them: ${brief.catalogue.titles.map(q).join(', ')}.` : '',
    ...brief.pages.map((p) => `A page of its own site describes itself as: ${q(p.text)} (${p.url}).`),
    quoted ? 'The quoted lines are the company\'s own words about itself. Use them to understand what it sells; they say nothing about any competitor.' : '',
    brief.regions.length ? `Markets it operates in: ${brief.regions.join(', ')}.` : '',
    exclude.length ? `EXCLUDE these domains, they are already known or belong to the company itself: ${exclude.slice(0, 200).join(', ')}.` : '',
    'Return the homepage only. Do not add positioning, pricing, ratings or any other commentary: those are claims we cannot verify and they will be discarded.',
  ].filter(Boolean);

  const user = require('./output-contract.js').append(lines.join('\n'), {
    id: 'competitor-universe.discover', kind: 'data', format: 'json', brand: brief.name || 'this company',
    missing: 'A company you are not sure exists, or whose website you are not sure of, is left out. With none known for certain the answer is {"brands":[]}.',
    returns: `ONE JSON object whose "brands" key holds up to ${limit} real competitors, name and homepage only.`,
    schema: { brands: { type: 'array', count: [0, limit], items: { type: 'object', of: {
      name: 'string', websiteUrl: { type: 'string', note: 'the real homepage, https://' } } } } } });
  return { ok: true, system, user, limit, exclude, basis: brief.basis, basis_line: brief.basis_line };
}

// Domains a model reaches for when it is filling a shape rather than reporting
// a fact: the names RFC 2606 reserves precisely so they can never belong to a
// real company, and the usual stand-ins. Any of these means the answer was
// fabricated, so it is dropped rather than stored as a competitor's homepage.
const PLACEHOLDER_DOMAIN_RX = /^(examples?|test|sample|domain|yourbrand|brandname|company|competitor|placeholder|acme|foo|bar)\.|(^|\.)(example|invalid|test|localhost|local)$|(^|\.)example\.(com|net|org)$/i;
const VALID_DOMAIN_RX = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/**
 * Read a discovery response. Everything that is not a real-looking company with
 * a real-looking homepage is REJECTED, with the reason kept, because a silent
 * drop and a silent accept look identical from the outside.
 *
 * Note what is NOT taken from the model: positioning, category, country,
 * pricing. Those are claims about another company that nobody has checked, and
 * the spec forbids storing them as facts.
 */
function parseDiscovery(text, brand, opts) {
  const o = opts || {};
  const b = brand || {};
  const rejected = [];
  let parsed;
  try {
    const raw = str(text).replace(/^```(?:json)?\s*|\s*```$/g, '');
    parsed = JSON.parse(raw);
  } catch (_) {
    return {
      candidates: [], rejected,
      gap: gap('competitor discovery result', b.name || 'this brand', regionCodes(b).join('/') || 'all'),
      error: 'unparseable_discovery_response',
    };
  }

  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed && parsed.brands) ? parsed.brands : []);
  const existing = new Set((o.existingDomains || []).map(normalizeDomain).filter(Boolean));
  const seen = new Set();
  const out = [];
  const when = o.now ? new Date(o.now).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const via = [o.provider, o.model].filter(Boolean).join('/') || 'the discovery model';

  for (const item of list.slice(0, MAX_PER_DISCOVERY)) {
    const name = str(item && (item.name || item.brandName), 200);
    const website = str(item && (item.websiteUrl || item.website || item.url), 500);
    const domain = normalizeDomain(website);
    if (!name || name.length < 2) { rejected.push({ item, reason: 'no_name' }); continue; }
    if (!domain) { rejected.push({ name, reason: 'no_website' }); continue; }
    if (!VALID_DOMAIN_RX.test(domain) || PLACEHOLDER_DOMAIN_RX.test(domain)) { rejected.push({ name, domain, reason: 'not_a_real_domain' }); continue; }
    if (isOwnDomain(domain, b)) { rejected.push({ name, domain, reason: 'own_brand' }); continue; }
    if (existing.has(domain) || seen.has(domain)) { rejected.push({ name, domain, reason: 'duplicate' }); continue; }
    seen.add(domain);
    out.push(candidate({
      name, website: /^https?:\/\//i.test(website) ? website : `https://${domain}`,
      // The only classification we are entitled to is our OWN reason for
      // searching, which is this brand's declared industry - and with none
      // declared there is no category at all, never one made up from a
      // description.
      category: str(b.industry, 200),
      source: 'discovery',
      evidence: str(b.industry)
        ? `Proposed by ${via} on ${when} as a competitor in "${str(b.industry, 120)}". The website has not been checked.`
        : `Proposed by ${via} on ${when} as a competitor, searched from ${str(o.basis_line, 200) || 'this brand\'s own published description'}. The website has not been checked.`,
      verification: 'unverified',
      data_gaps: [gap('competitor website verification', name, regionCodes(b).join('/') || 'all')],
    }));
    if (out.length >= (o.limit || MAX_PER_DISCOVERY)) break;
  }

  const result = { candidates: out, rejected };
  if (!out.length) {
    result.gap = gap('competitor set', b.name || 'this brand', regionCodes(b).join('/') || 'all');
    result.note = 'The discovery run returned no company that could be verified as real, so nothing was stored. An unverifiable name is a fabricated competitor, and the gap is reported instead.';
  }
  return result;
}

/* ── storage ports ─────────────────────────────────────────────────────────── */

function env() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !(anon || service)) { const e = new Error('SUPABASE_URL or SUPABASE_*_KEY missing'); e.status = 503; throw e; }
  return { url: String(url).replace(/\/$/, ''), anon: anon || service, service: service || '' };
}

async function rest(pathAndQuery, { method = 'GET', body, prefer, apikey, token } = {}) {
  const e = env();
  const headers = { apikey: apikey || e.anon, authorization: `Bearer ${token || apikey || e.anon}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) {
    const msg = (json && (json.message || json.hint)) || text || res.statusText;
    const err = new Error(`supabase ${method} ${pathAndQuery} -> ${res.status}: ${msg}`);
    err.status = (res.status === 401 || res.status === 403 || res.status === 404) ? res.status : 502;
    throw err;
  }
  return json;
}

const COLS_BASE = 'id,workspace_id,name,website,domain,category,country,positioning,newsletter_url,source,evidence,verification,data_gaps,subscription_status,date_subscribed,confirmation_required,confirmation_completed,is_active,first_seen,last_seen';
const COLS = COLS_BASE + ',brand_identity';

/* WHICH BRAND A STORED COMPETITOR WAS FOUND FOR (2026-10-11)
 *
 * A row belongs to a workspace, and a workspace can be renamed into a
 * different brand: the live workspace that was "Deli Chic" is "Lenskart" now,
 * and its competitor list was still a deli's. Each row is stamped with the
 * identity it was found for (migration 20261011120000, `brand_identity`):
 * the website's registrable domain (the coherence rule's) and the folded
 * name. A row made for another identity - or saved before rows carried one -
 * is HIDDEN from the list and the benchmark, never deleted, and the answer
 * says how many and why. Seeding or discovery for the current brand runs
 * fresh; a company the current brand also names takes its old row back,
 * re-stamped (the table's unique key would refuse a second one). */
function competitorIdentity(brand) {
  if (!brand || typeof brand !== 'object') return null;
  const C = coherence();
  const fold = (v) => String(v == null ? '' : v).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
  let domain = '';
  try { domain = C ? C.registrableDomain(C.hostOf(brand.website || '')) : normalizeDomain(brand.website); } catch (_) { domain = normalizeDomain(brand.website); }
  const name = fold(brand.name);
  if (!domain && !name) return null;
  return 'ci1:' + require('crypto').createHash('sha256').update(`${domain}\u0001${name}`).digest('hex').slice(0, 24);
}

/** A PostgREST refusal that says the identity column does not exist (the migration is not applied). */
function missingIdentityColumn(err) {
  const m = String((err && err.message) || '');
  return /brand_identity/.test(m) && /does not exist|42703|PGRST204|could not find/i.test(m);
}

/**
 * One store, built over whichever credential the caller has. Both variants
 * filter by workspace_id on EVERY query, including the service one: the
 * service key bypasses RLS entirely, so it has to scope itself - the same
 * obligation workspace-scope.js exists to enforce elsewhere.
 */
function makeStore(kind, call) {
  return {
    kind,
    // false once the database has said it has no brand_identity column: rows
    // then cannot be judged, and the answer says so instead of hiding them all.
    identityColumn: true,
    async list(workspaceId) {
      const q = (cols) => `${TABLE}?select=${cols}&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=name.asc&limit=${MAX_UNIVERSE}`;
      let rows;
      try { rows = await call(q(this.identityColumn ? COLS : COLS_BASE)); }
      catch (err) {
        if (!this.identityColumn || !missingIdentityColumn(err)) throw err;
        this.identityColumn = false;
        rows = await call(q(COLS_BASE));
      }
      return Array.isArray(rows) ? rows : [];
    },
    /** The workspace's own catalogue rows (live ones), for the discovery brief. */
    async catalogRows(workspaceId) {
      const ws = encodeURIComponent(workspaceId);
      try {
        const rows = await call(`brand_catalog_products?select=title,product_type,source_url,product_url,stale_at&workspace_id=eq.${ws}&stale_at=is.null&order=title.asc&limit=200`);
        return Array.isArray(rows) ? rows : [];
      } catch (err) {
        // A database without the catalogue-merge migration has no source_url /
        // stale_at: read what it has (every row there is live).
        if (!/source_url|stale_at/.test(String(err && err.message))) throw err;
        const rows = await call(`brand_catalog_products?select=title,product_type,product_url&workspace_id=eq.${ws}&order=title.asc&limit=200`);
        return Array.isArray(rows) ? rows : [];
      }
    },
    /** The page descriptions the context pack filed from the brand's own site (verbatim). */
    async knowledgeRows(workspaceId) {
      const rows = await call(`kb_knowledge?select=url,title,summary&workspace_id=eq.${encodeURIComponent(workspaceId)}&added_by=eq.brand-context-pack&status=eq.summarized&limit=60`);
      return Array.isArray(rows) ? rows : [];
    },
    async insert(workspaceId, incoming) {
      if (!incoming.length) return [];
      const shape = () => incoming.map((r) => {
        const c = Object.assign({}, r, { workspace_id: workspaceId });
        if (!this.identityColumn) delete c.brand_identity;
        return c;
      });
      const post = (b) => call(`${TABLE}?select=${this.identityColumn ? COLS : COLS_BASE}`, { method: 'POST', body: b, prefer: 'return=representation' });
      try {
        let out;
        try { out = await post(shape()); }
        catch (err) {
          if (!this.identityColumn || !missingIdentityColumn(err)) throw err;
          this.identityColumn = false;
          out = await post(shape());
        }
        return Array.isArray(out) ? out : [];
      } catch (err) {
        // The caller de-duplicates against what it read, but two runs can
        // overlap (an activation and the daily sweep), and then the unique
        // index rejects the WHOLE batch for one row. Retry row by row so the
        // rest still lands: batches here are tens of rows, not thousands.
        if (!/duplicate key|23505|409/.test(String(err && err.message))) throw err;
        const kept = [];
        for (const row of shape()) {
          try {
            const one = await post([row]);
            if (Array.isArray(one) && one[0]) kept.push(one[0]);
          } catch (e) {
            if (!/duplicate key|23505|409/.test(String(e && e.message))) throw e;
          }
        }
        return kept;
      }
    },
    async patch(workspaceId, id, patchBody) {
      const b = Object.assign({}, patchBody);
      if (!this.identityColumn) delete b.brand_identity;
      return call(`${TABLE}?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`, {
        method: 'PATCH', body: b, prefer: 'return=minimal',
      });
    },
    async workspace(workspaceId) {
      const rows = await call(`brand_workspaces?select=*&id=eq.${encodeURIComponent(workspaceId)}&limit=1`);
      return (Array.isArray(rows) && rows[0]) || null;
    },
    async setRefresh(workspaceId, row) {
      return call(`${REFRESH_TABLE}?on_conflict=workspace_id`, {
        method: 'POST', body: [Object.assign({ workspace_id: workspaceId }, row)],
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    },
    // Only the sweep needs to enumerate brands, and only the service credential
    // can see past its own membership to do it.
    async activeWorkspaces(limit) {
      const rows = await call(`brand_workspaces?select=id,name,slug,status,updated_at&status=eq.active&order=updated_at.desc&limit=${Number(limit) || 50}`);
      return Array.isArray(rows) ? rows : [];
    },
    async refreshState() {
      const rows = await call(`${REFRESH_TABLE}?select=workspace_id,last_run_at,last_added,last_source`);
      return Array.isArray(rows) ? rows : [];
    },
  };
}

/** Reads and writes AS THE CALLER, so the RLS policies are the authority. */
function userStore(token) {
  return makeStore('user', (p, o) => rest(p, Object.assign({ token }, o || {})));
}

/** The service-role store, for the scheduled sweep, which has no user token. */
function serviceStore() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!key) { const e = new Error('SUPABASE_SERVICE_ROLE_KEY missing'); e.status = 503; throw e; }
  return makeStore('service', (p, o) => rest(p, Object.assign({ apikey: key, token: key }, o || {})));
}

/**
 * The brand record for a workspace, read STRICTLY by id.
 *
 * brand-runtime.resolve() falls back to tenant zero when it cannot resolve a
 * brand, which is right for a generator (something must render) and wrong here:
 * falling back would seed tenant zero's market study into somebody else's
 * workspace, the exact leak this feature must not have. So a miss returns null
 * and the caller refuses.
 */
async function brandForWorkspace(store, workspaceId) {
  const row = await store.workspace(workspaceId);
  if (!row || String(row.id) !== String(workspaceId)) return null;
  try { return require('./brand-runtime.js').normalizeBrand(row); }
  catch (_) { return row; }
}

/* ── operations ────────────────────────────────────────────────────────────── */

function toApiShape(row) {
  return {
    id: String(row.id || ''),
    brandName: row.name || '',
    websiteUrl: row.website || (row.domain ? `https://${row.domain}` : ''),
    domain: row.domain || '',
    category: row.category || '',
    country: row.country || '',
    positioning: row.positioning || '',
    newsletterSignupUrl: row.newsletter_url || '',
    subscriptionStatus: row.subscription_status || 'Not subscribed',
    dateSubscribed: row.date_subscribed || '',
    source: row.source || '',
    evidence: row.evidence || '',
    verification: row.verification || 'unverified',
    dataGaps: Array.isArray(row.data_gaps) ? row.data_gaps : [],
    addedAt: row.first_seen || '',
  };
}

/**
 * Split a workspace's rows into those found for THIS brand identity and those
 * that were not (another identity, or none recorded). With no identity
 * column, or no brand to judge by, nothing can be judged: every row is shown
 * and `check` says why.
 */
function splitByIdentity(store, rows, identity) {
  const list = Array.isArray(rows) ? rows : [];
  if (store && store.identityColumn === false) return { current: list, other: [], check: 'unavailable', reason: 'no_identity_column' };
  if (!identity) return { current: list, other: [], check: 'unavailable', reason: 'no_brand_record' };
  const current = [], other = [];
  for (const r of list) (r && r.brand_identity === identity ? current : other).push(r);
  return { current, other, check: 'applied' };
}

/** The sentence for rows hidden because they were found for another brand identity. */
function hiddenNote(n, brand) {
  if (!n) return '';
  const name = str(brand && brand.name) || 'this brand';
  return `${n} competitor${n === 1 ? '' : 's'} in this workspace ${n === 1 ? 'was' : 'were'} found for another brand (a different name or website on this workspace), or before the list recorded which brand ${n === 1 ? 'it was' : 'they were'} for, so ${n === 1 ? 'it is' : 'they are'} hidden here. Nothing was deleted. Seed or Find builds ${name}'s own list; a company ${name} also names comes back.`;
}

/** Resolve the identity a call works under: the one passed, else the workspace's own record's. */
async function identityFor(store, workspaceId, opts) {
  const o = opts || {};
  if (o.identity !== undefined) return o.identity;
  let brand = o.brand || null;
  if (!brand && store && typeof store.workspace === 'function') {
    try { brand = await brandForWorkspace(store, workspaceId); } catch (_) { brand = null; }
  }
  return { identity: competitorIdentity(brand), brand };
}

/** This workspace's universe for its CURRENT brand, in the shape the dashboard already renders. */
async function listUniverse(store, workspaceId, opts) {
  const o = opts || {};
  const rows = await store.list(workspaceId);
  const who = o.identity !== undefined ? { identity: o.identity, brand: o.brand || null } : await identityFor(store, workspaceId, o);
  const split = splitByIdentity(store, rows, who.identity);
  const brands = split.current.filter((r) => r.is_active !== false).map(toApiShape);
  const gaps = uniq(split.current.flatMap((r) => (Array.isArray(r.data_gaps) ? r.data_gaps : [])));
  const out = { brands, total: brands.length, gaps };
  out.identity_check = split.check;
  if (split.other.length) out.hidden = { count: split.other.length, reason: 'other_brand_identity', note: hiddenNote(split.other.length, who.brand) };
  if (split.check === 'unavailable' && split.reason === 'no_identity_column') {
    out.identity_note = 'This database has no record of which brand each competitor was found for (migration 20261011120000 is not applied), so every row on this workspace is shown.';
  }
  return out;
}

/**
 * Insert what is new, upgrade what gained a domain, report what was skipped.
 * Rows are judged against the CURRENT brand's rows only; a candidate whose key
 * matches a row found for another identity takes that row back, re-stamped,
 * because the table's unique key would refuse a second one.
 */
async function addCompetitors(store, workspaceId, candidates, opts) {
  const o = opts || {};
  const identity = o.identity !== undefined ? o.identity : (await identityFor(store, workspaceId, o)).identity;
  const all = await store.list(workspaceId);
  if (all.length >= MAX_UNIVERSE) {
    return { added: 0, skipped: (candidates || []).length, upgraded: 0, total: all.length, note: `This workspace already holds the maximum of ${MAX_UNIVERSE} competitors.` };
  }
  const split = splitByIdentity(store, all, identity);
  const existing = split.current;
  const hiddenByKey = new Map(split.other.map((r) => [dedupeKey(r), r]));
  const room = MAX_UNIVERSE - all.length;
  const { fresh, upgrades, skipped } = dedupe(existing, candidates);
  const stamp = (c) => (identity ? Object.assign({}, c, { brand_identity: identity }) : c);

  const restore = [], toInsertAll = [];
  for (const c of fresh) {
    const hit = hiddenByKey.get(dedupeKey(c));
    if (hit) restore.push({ row: hit, c }); else toInsertAll.push(c);
  }
  const toInsert = toInsertAll.slice(0, room);

  for (const u of upgrades) {
    try { await store.patch(workspaceId, u.id, u.patch); } catch (_) { /* an upgrade is best effort; the row is already usable */ }
  }
  let restored = 0;
  for (const { row, c } of restore) {
    try {
      await store.patch(workspaceId, row.id, {
        name: c.name, website: c.website, domain: c.domain, category: c.category, country: c.country,
        positioning: c.positioning, source: c.source, evidence: c.evidence, verification: c.verification,
        data_gaps: c.data_gaps, is_active: true, brand_identity: identity || null,
      });
      restored++;
    } catch (_) { /* best effort, like an upgrade */ }
  }
  const inserted = toInsert.length ? await store.insert(workspaceId, toInsert.map(stamp)) : [];
  const added = (Array.isArray(inserted) ? inserted.length : toInsert.length) + restored;

  return {
    added,
    restored,
    upgraded: upgrades.length,
    skipped: skipped.length + (toInsertAll.length - toInsert.length),
    total: existing.length + added,
    skippedDetail: skipped.slice(0, 50),
  };
}

/**
 * Seed a workspace from its OWN record. Runs on activation, so it must be
 * fast, deterministic and network-free: no LLM call, no third-party fetch.
 *
 * Safe to run repeatedly - addCompetitors de-duplicates - and it is MEANT to
 * be, because a brand record grows. An operator who adds three competitors to
 * their brand data next month should get them on the next run rather than
 * having to clear the universe first. `onlyIfEmpty` is for the activation hook,
 * where the point is to do nothing at all to a brand that is already set up -
 * set up AS THIS BRAND: rows found for another identity do not count.
 */
async function seedForWorkspace(store, workspaceId, opts) {
  const o = opts || {};
  const brand = o.brand || await brandForWorkspace(store, workspaceId);
  if (!brand) {
    return {
      ok: false, added: 0, error: 'brand_record_unavailable',
      note: 'The brand record for this workspace could not be read, so nothing was seeded. Another brand\'s competitor set is never used as a stand-in.',
    };
  }
  const identity = competitorIdentity(brand);
  const split = splitByIdentity(store, await store.list(workspaceId), identity);
  const existing = split.current;
  const hidden = split.other.length ? { count: split.other.length, reason: 'other_brand_identity', note: hiddenNote(split.other.length, brand) } : undefined;
  if (existing.length && o.onlyIfEmpty) {
    return { ok: true, added: 0, skipped: existing.length, total: existing.length, note: 'This brand already has a competitor universe; seeding left it untouched.' };
  }

  const derived = deriveFromBrandRecord(brand);
  if (!derived.candidates.length) {
    return {
      ok: true, added: 0, total: existing.length,
      gaps: derived.gaps, notes: derived.notes, hidden,
      // Reported as a gap, not filled with plausible names.
      status_line: 'NOT LAUNCH READY - DATA DEPENDENCY',
    };
  }
  const stored = await addCompetitors(store, workspaceId, derived.candidates, { identity, brand });
  return Object.assign({ ok: true, source: 'brand_record', gaps: derived.gaps, notes: derived.notes, hidden }, stored);
}

/**
 * What the brand publishes about itself beyond its record, read for THIS
 * workspace only: its own catalogue rows and the page descriptions its context
 * pack filed. A store that cannot read one (a memory store, a table that does
 * not answer) gives none of it; discovery then works from the record alone.
 */
async function discoveryEvidence(store, workspaceId) {
  const out = { catalogRows: [], knowledgeRows: [], unread: [] };
  if (store && typeof store.catalogRows === 'function') {
    try { out.catalogRows = await store.catalogRows(workspaceId); } catch (_) { out.unread.push('catalogue'); }
  }
  if (store && typeof store.knowledgeRows === 'function') {
    try { out.knowledgeRows = await store.knowledgeRows(workspaceId); } catch (_) { out.unread.push('context pack pages'); }
  }
  return out;
}

/**
 * Discovery pass: ask the LLM waterfall for real competitors in THIS brand's
 * market, keep only what survives validation, and add whatever is new.
 * De-duplicated by domain against the workspace's existing rows for this brand.
 */
async function refreshWorkspace(store, workspaceId, opts) {
  const o = opts || {};
  const brand = o.brand || await brandForWorkspace(store, workspaceId);
  if (!brand) {
    return { ok: false, added: 0, error: 'brand_record_unavailable', note: 'The brand record for this workspace could not be read, so discovery did not run.' };
  }
  const identity = competitorIdentity(brand);

  // Seeding first means a brand that was activated before this shipped still
  // gets its own record's competitors, and discovery then only has to find
  // what the record does not already name.
  const seeded = await seedForWorkspace(store, workspaceId, { brand });

  const split = splitByIdentity(store, await store.list(workspaceId), identity);
  const existing = split.current;
  const hidden = split.other.length ? { count: split.other.length, reason: 'other_brand_identity', note: hiddenNote(split.other.length, brand) } : undefined;
  const existingDomains = existing.map((r) => normalizeDomain(r.domain || r.website)).filter(Boolean);
  const evidence = await discoveryEvidence(store, workspaceId);
  const prompt = discoveryPrompt(brand, { existingDomains, limit: o.limit, evidence });
  if (!prompt.ok) {
    return { ok: true, added: 0, seeded, total: existing.length, gaps: [prompt.gap], note: prompt.note, error: prompt.error, needs: 'industry', brand_name: str(brand.name, 200), hidden };
  }

  const callLLM = o.llm || require('./llm.js');
  let res;
  try {
    res = await callLLM({
      systemPrompt: prompt.system,
      userMessage: prompt.user,
      responseFormat: { type: 'json_object' },
      maxTokens: 2000,
      temperature: 0.2,          // this is a recall task, not a creative one
      timeoutMs: 45000,
      stage: 'competitor_discovery',
      tier: 'fast',
    });
  } catch (err) {
    return {
      ok: true, added: 0, seeded, total: existing.length, basis: prompt.basis, hidden,
      gaps: [gap('competitor set', brand.name || 'this brand', regionCodes(brand).join('/') || 'all')],
      note: `Discovery could not run (${str(err && err.message, 200) || 'no provider answered'}). Nothing was invented to fill the gap.`,
    };
  }

  const parsed = parseDiscovery(res && res.text, brand, {
    existingDomains, limit: o.limit, provider: res && res.provider, model: res && res.model, now: o.now, basis_line: prompt.basis_line,
  });
  if (!parsed.candidates.length) {
    return { ok: true, added: 0, seeded, total: existing.length, provider: res && res.provider, basis: prompt.basis, hidden, gaps: parsed.gap ? [parsed.gap] : [], rejected: parsed.rejected.length, note: parsed.note };
  }
  const stored = await addCompetitors(store, workspaceId, parsed.candidates, { identity, brand });
  return Object.assign({ ok: true, source: 'discovery', seeded, provider: res && res.provider, basis: prompt.basis, hidden, rejected: parsed.rejected.length }, stored);
}

/**
 * The scheduled sweep, hung off the existing daily cron in api/brain.js rather
 * than a cron of its own (the Hobby plan allows two, and both are taken).
 *
 * The budget is small on purpose: each workspace costs one LLM call, and the
 * cron has the whole daily loop to get through. Workspaces are taken
 * least-recently-refreshed first, so over a few days every brand is covered
 * without any one of them monopolising the slot.
 */
async function refreshDueWorkspaces(opts) {
  const o = opts || {};
  const store = o.store || serviceStore();
  const max = Math.max(1, Math.min(Number(o.maxWorkspaces) || 3, 25));
  const minIntervalMs = (Number(o.minIntervalHours) || 20) * 3600e3;
  const now = o.now ? new Date(o.now).getTime() : Date.now();

  const workspaces = await store.activeWorkspaces(100);
  if (!workspaces.length) return { ok: true, refreshed: 0, workspaces: 0, note: 'No active brand workspaces.' };

  const state = new Map();
  try { for (const r of await store.refreshState()) state.set(String(r.workspace_id), r); } catch (_) { /* first run, no table rows yet */ }

  const due = workspaces
    .filter((w) => {
      const s = state.get(String(w.id));
      return !s || !s.last_run_at || (now - new Date(s.last_run_at).getTime()) >= minIntervalMs;
    })
    .sort((a, b) => {
      const at = state.get(String(a.id)); const bt = state.get(String(b.id));
      return new Date((at && at.last_run_at) || 0) - new Date((bt && bt.last_run_at) || 0);
    })
    .slice(0, max);

  const results = [];
  for (const w of due) {
    let out;
    try { out = await refreshWorkspace(store, w.id, { llm: o.llm, now: o.now, limit: o.limit }); }
    catch (err) { out = { ok: false, added: 0, error: str(err && err.message, 200) }; }
    results.push({ workspace_id: w.id, name: w.name, added: out.added || 0, error: out.error, note: out.note });
    try {
      await store.setRefresh(w.id, {
        last_run_at: new Date(now).toISOString(),
        last_source: out.source || (out.error ? 'error' : 'none'),
        last_added: out.added || 0,
        last_note: str(out.note || out.error, 400) || null,
      });
    } catch (_) { /* bookkeeping must never fail the sweep */ }
  }

  return { ok: true, workspaces: workspaces.length, due: due.length, refreshed: results.length, added: results.reduce((n, r) => n + r.added, 0), results };
}

/** Record a newsletter-subscription outcome against one competitor row. */
async function markSubscribed(store, workspaceId, opts) {
  const o = opts || {};
  const target = normalizeDomain(o.domain || o.websiteUrl || o.website || '');
  const name = str(o.name || o.brand_name, 200);
  if (!target && !name) return { ok: false, error: 'domain (or name) required' };
  const rows = await store.list(workspaceId);
  const hit = rows.find((r) => (target && normalizeDomain(r.domain || r.website) === target))
    || rows.find((r) => name && str(r.name).toLowerCase() === name.toLowerCase());
  if (!hit) return { ok: false, error: 'competitor not found in this brand\'s universe', domain: target || null, name: name || null };
  const patch = {
    subscription_status: str(o.status, 60) || 'Subscribed',
    date_subscribed: o.dateSubscribed || new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };
  if (o.confirmationRequired != null) patch.confirmation_required = str(o.confirmationRequired, 60);
  if (o.confirmationCompleted != null) patch.confirmation_completed = str(o.confirmationCompleted, 60);
  await store.patch(workspaceId, hit.id, patch);
  return { ok: true, id: hit.id, domain: normalizeDomain(hit.domain || hit.website) || null, status: patch.subscription_status };
}

/**
 * Mirror the universe into the legacy Google Sheet, IF and only if Google
 * credentials happen to be configured. This is an export, never a dependency:
 * any failure is swallowed, because the universe in Postgres is the record and
 * the sheet is a convenience copy.
 */
async function exportToSheet(rows) {
  const wif = process.env.GCP_WORKLOAD_IDENTITY_PROVIDER && process.env.GCP_SERVICE_ACCOUNT_EMAIL && process.env.VERCEL_OIDC_TOKEN;
  const jwt = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!(wif || jwt) || !process.env.GOOGLE_SHEET_ID) {
    return { ok: true, exported: 0, configured: false, note: 'No Google credentials configured, so the sheet export was skipped. The universe lives in Supabase and does not need it.' };
  }
  try {
    const core = require('./competitor-core.js');
    const out = await core.appendBrands((rows || []).map((r) => ({
      brandName: r.name, websiteUrl: r.website || (r.domain ? `https://${r.domain}` : ''),
      category: r.category, country: r.country, positioning: r.positioning,
      newsletterSignupUrl: r.newsletter_url, source: r.source,
    })), new Date().toISOString());
    return { ok: true, configured: true, exported: out.added || 0 };
  } catch (err) {
    return { ok: true, configured: true, exported: 0, error: str(err && err.message, 200) };
  }
}

module.exports = {
  // pure helpers (unit-testable with no network and no database)
  normalizeDomain, ownDomains, isOwnDomain, regionCodes, offeringKinds, gap,
  namesFromNote, studyTiers, deriveFromBrandRecord, dedupeKey, dedupe,
  discoveryBrief, discoveryPrompt, parseDiscovery, toApiShape,
  selfDescriptions, catalogueEvidence, pageEvidence, competitorIdentity, splitByIdentity, discoveryEvidence,
  // stores
  userStore, serviceStore, brandForWorkspace,
  // operations
  listUniverse, addCompetitors, seedForWorkspace, refreshWorkspace,
  refreshDueWorkspaces, markSubscribed, exportToSheet,
  TABLE, REFRESH_TABLE, MAX_UNIVERSE,
};
