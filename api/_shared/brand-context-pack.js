'use strict';
/**
 * brand-context-pack.js — one record that IS a brand's context.
 * ---------------------------------------------------------------------------
 * When a brand is onboarded with a URL, the platform already knew how to read
 * two things off that URL: its identity (brand-extract.js) and its catalogue
 * (site-crawl.js via brand-workspace-core.importCatalog). Both are one-shot
 * reports that the operator looks at once and then loses.
 *
 * A CONTEXT PACK is the durable version, built once per brand and kept:
 *
 *   design.md   the brand's design system as a document a human reads - palette
 *               with the role the site gave each colour and the contrast it
 *               actually achieves, typography with stacks and observed usage,
 *               logo variants, radius/spacing/elevation/motion tokens, observed
 *               voice - with the page URL beside every single value.
 *   knowledge   every page of the brand's OWN site, filed into kb_knowledge,
 *               workspace-scoped, with its source URL. Same-origin only.
 *   catalog     through the existing importCatalog path, so a pack never grows
 *               a second product store.
 *   repos       a GitHub search for the brand's own repositories, with the
 *               reachability of that search recorded, so "we found none" and
 *               "we could not look" are never the same answer.
 *
 * ── KEYED TO THE URL **AND** THE NAME ──────────────────────────────────────
 * `packKey(website, name)` is `<host>|<folded name>`, unique per workspace:
 *   * re-running for the same brand UPDATES the pack, never duplicates it;
 *   * two workspaces whose brands share a name cannot collide, because the
 *     workspace is part of the key;
 *   * moving to a new domain, or renaming, starts a NEW pack rather than
 *     overwriting a report about a different site. A pack is a dated statement
 *     about one site; overwriting it would destroy the provenance that makes
 *     every value in it checkable.
 *
 * ── USER DATA WINS, STRUCTURALLY ───────────────────────────────────────────
 * "A field the user typed is never overwritten by a later automatic run" is a
 * claim about CALL ORDER unless it is written down somewhere a future caller
 * cannot route around. It is written down in `brand_field_provenance`, and the
 * ONLY door an automatic value may come through is the `brand_context_apply()`
 * SQL function, which refuses any field whose provenance says 'user'. This
 * module never PATCHes brand_workspaces directly. Neither may anything else
 * that is running automatically.
 *
 * The catalogue gets the same treatment under the pseudo-field `catalog`: an
 * operator who uploaded a CSV owns their catalogue, and the pack's automatic
 * import is skipped and says so.
 *
 * ── ZERO FABRICATION ───────────────────────────────────────────────────────
 * Nothing here paraphrases. The knowledge base stores each page's own declared
 * description VERBATIM and its own headings VERBATIM; it does not run an LLM
 * over the brand's pages to write a summary, because a paraphrase of a brand
 * fact is a new brand fact that nobody approved. A page that declares no
 * description gets a [DATA REQUIRED BEFORE LAUNCH: …] marker in its place.
 *
 * ── LONG WORK IS A QUEUE, NOT A LONG REQUEST ───────────────────────────────
 * A crawl + a catalogue import + a whole-site ingest does not fit one 120s
 * serverless invocation. The pack ROW is the queue: one stage advances per
 * call, `queue_state` carries the resumable cursor, and the worker re-fires
 * itself until it idles at `stage='done'` - the same convergent pattern as
 * smart-brain-plan.js prebuildAssets().
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * Mounted on the existing brand router: /api/brand?op=context-*.
 * ---------------------------------------------------------------------------
 */

const siteCrawl = require('./site-crawl.js');
const kbUrl = require('./kb-url.js');

const TABLE = 'brand_context_packs';
const PROV_TABLE = 'brand_field_provenance';
const KB_TABLE = 'kb_knowledge';

/** Stage order. `catalog` is first because it is the only stage that needs the
 *  operator's own token (RLS + the editor-role check inside importCatalog). */
const STAGES = ['catalog', 'extract', 'knowledge', 'repos', 'done'];

const DEFAULTS = {
  knowledgePagesPerBatch: 8,     // one batch fits comfortably inside 120s
  knowledgeMaxPages: 120,        // whole-pack cap, so one huge site cannot run forever
  knowledgeMaxDepth: 4,
  perRequestMs: 8000,
  knowledgeBatchMs: 60000,
  extractMaxPages: 14,
  rawTextChars: 40000,
  githubMs: 12000,
  userAgent: 'LifecycleOS-BrandContext/1.0 (+brand context pack; respects robots.txt)',
};

/** The spec's missing-data marker. Never a value, always a report. */
function MARKER(field, product, region) {
  return `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${product || 'all'}, ${region || 'all'}]`;
}

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 300);
const nowIso = () => new Date().toISOString();

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE KEY
   ═══════════════════════════════════════════════════════════════════════════ */

function hostOf(u) {
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (_) { return ''; }
}

/**
 * A brand name reduced to its identity. Case, punctuation, spacing and a
 * trailing company suffix are presentation, not identity: "Northwind Books",
 * "northwind books" and "Northwind Books Ltd." are one brand. Two genuinely
 * different brands ("Northwind" and "Northwind Books") still fold apart.
 */
function foldName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, '')
    .replace(/\b(?:ltd|limited|llc|inc|incorporated|plc|gmbh|pvt|private|co|corp|corporation|company)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 80);
}

/**
 * The pack key: host of the brand's URL, then its folded name.
 *
 * Both halves are required. Host alone would merge two brands sold from one
 * domain; name alone would merge two unrelated companies that picked the same
 * word, which is precisely the collision the brief calls out.
 */
function packKey(website, name) {
  const host = hostOf(website);
  const folded = foldName(name);
  return { site_host: host, folded_name: folded, brand_key: `${host}|${folded}`, ok: !!(host && folded) };
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. design.md
   Rendered from the brand-extract report. Not re-derived: this module reads
   what the extractor observed and lays it out, so there is exactly one place
   that decides what a colour role or a font signal MEANS.
   ═══════════════════════════════════════════════════════════════════════════ */

const md = {
  esc: (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim(),
  link: (u) => (u ? `[${String(u).replace(/^https?:\/\//, '').slice(0, 60)}](${u})` : '—'),
};

function mdTable(headers, rows) {
  if (!rows.length) return '';
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map((c) => (c == null || c === '' ? '—' : md.esc(c))).join(' | ')} |`),
  ].join('\n');
}

/** A candidate row: value, the signal that produced it, and where it was read. */
const candRow = (c) => [c.value, c.signal || '', c.confidence || '', md.link(c.source_url)];

function contrastLine(core, fg, bg, label) {
  if (!fg || !bg) return null;
  const ratio = core.contrast(fg, bg);
  const r = Math.round(ratio * 100) / 100;
  return `${label}: **${r}:1** — ${ratio >= 4.5 ? 'passes WCAG AA for body text' : ratio >= 3 ? 'passes AA for large text only' : 'FAILS WCAG AA'}`;
}

/**
 * The design system as a document.
 *
 * `report` is a brand-extract report. `brand` is the workspace row (used only
 * for its name and website, never as a source of design facts - a value the
 * operator typed is theirs, and this document is strictly what the SITE says).
 */
function renderDesignMd(report, brand, meta) {
  const core = require('./brand-workspace-core.js');
  const m = meta || {};
  const f = (report && report.fields) || {};
  const name = (f.name && f.name.value) || (brand && brand.name) || 'This brand';
  const site = (report && report.start) || (brand && brand.website) || '';
  const out = [];
  const markers = [];

  const push = (s) => out.push(s);
  const gap = (field, why) => {
    const marker = MARKER(field);
    markers.push(marker);
    push(`> ${marker}\n>\n> ${why}`);
  };

  push(`# ${name} — Design System`);
  push('');
  push(`_Observed from ${site || 'the brand\'s own site'} on ${(m.observed_at || nowIso()).slice(0, 10)}._`);
  push('');
  push('**How to read this.** Every value below was read from a page of this brand\'s own site '
    + 'and is printed with that page and with the SIGNAL that produced it. Nothing was chosen, '
    + 'averaged, lightened or inferred to fill a gap. Where the site publishes nothing, this '
    + 'document says so with a `[DATA REQUIRED BEFORE LAUNCH: …]` marker instead of a plausible value.');
  push('');
  push(mdTable(['', ''], [
    ['Brand', name],
    ['Site', site],
    ['Pack key', m.brand_key || packKey(site, name).brand_key],
    ['Pages read', `${(report && report.pages_visited) || 0}`],
    ['Stylesheets read', `${((report && report.stylesheets) || []).length}`],
    ['Inline style blocks', `${(report && report.inline_style_blocks) || 0}`],
    ['Method', 'HTML + CSS parsing on the server. No browser, so no computed styles.'],
  ]));
  push('');

  /* ── 1. Identity ─────────────────────────────────────────────────────── */
  push('## 1. Identity');
  push('');
  const idRows = [];
  for (const [label, key] of [['Name', 'name'], ['Tagline', 'tagline'], ['Logo', 'logo']]) {
    const fld = f[key];
    if (fld && fld.value) idRows.push([label, fld.value, fld.signal || '', md.link(fld.source_url)]);
  }
  const legal = (f.legal && f.legal.candidates && f.legal.candidates[0]) || null;
  if (legal) idRows.push(['Legal entity', legal.value, legal.signal || '', md.link(legal.source_url)]);
  if (idRows.length) push(mdTable(['Field', 'Value', 'Signal', 'Source'], idRows));
  else gap('brand identity (name, tagline, logo)', 'The site published no machine-readable name, tagline or logo mark on the pages that were read.');
  if (f.logo && f.logo.inline_svg) {
    push('');
    push(`**Inline logo mark.** ${md.esc(f.logo.inline_svg.note || 'An inline SVG mark is present on the page.')}`);
  }
  push('');

  /* ── 2. Colour ───────────────────────────────────────────────────────── */
  push('## 2. Colour');
  push('');
  push('A brand colour and a primary-button colour are different facts. Each sighting below is '
    + 'filed under the role the SITE gave it, and the roles are reported separately rather than '
    + 'pooled and frequency-ranked.');
  push('');
  const pal = f.palette || {};
  const proposed = pal.proposed || {};
  const sources = pal.sources || {};
  const palRows = [];
  for (const role of ['primary', 'accent', 'ink', 'surface', 'surface_alt', 'muted']) {
    const v = proposed[role];
    const s = sources[role] || {};
    if (v) palRows.push([role, v, s.signal || '', md.link(s.source_url)]);
  }
  push('### 2.1 Roles the site declared');
  push('');
  if (palRows.length) push(mdTable(['Role', 'Value', 'Signal', 'Source'], palRows));
  else push('_The site declared no colour in any role that could be read from its published HTML or CSS._');
  push('');

  const missing = (pal.markers || []);
  if (missing.length) {
    push('### 2.2 Not declared');
    push('');
    for (const mk of missing) { markers.push(mk); push(`> ${mk}`); }
    push('');
    for (const n of (pal.notes || [])) push(`- ${md.esc(n)}`);
    push('');
  }

  if ((pal.conflicts || []).length) {
    push('### 2.3 Conflicts the site did not resolve');
    push('');
    for (const c of pal.conflicts) {
      push(`- **${md.esc(c.kind)}** — ${md.esc(c.message)}`);
      if (c.identity) push(`  - identity: \`${md.esc(c.identity.value)}\` via ${md.esc(c.identity.signal)} (${md.link(c.identity.source_url)})`);
      if (c.action) push(`  - action: \`${md.esc(c.action.value)}\` via ${md.esc(c.action.signal)} (${md.link(c.action.source_url)})`);
    }
    push('');
  }

  push('### 2.4 Contrast');
  push('');
  const cl = [
    contrastLine(core, proposed.ink, proposed.surface, 'Body text on the page surface'),
    contrastLine(core, proposed.ink, proposed.surface_alt, 'Body text on the card surface'),
    contrastLine(core, proposed.muted, proposed.surface, 'Secondary text on the page surface'),
    contrastLine(core, '#ffffff', proposed.primary, 'White on the primary'),
    contrastLine(core, proposed.ink, proposed.primary, 'Ink on the primary'),
  ].filter(Boolean);
  if (cl.length) { for (const l of cl) push(`- ${l}`); }
  else push('_Not enough colours were declared to check a single text-on-background pairing._');
  const validation = pal.validation;
  if (validation) {
    push('');
    push(validation.ok
      ? '**Design-rule gate: PASSES.** This palette would be accepted at activation.'
      : '**Design-rule gate: BLOCKED.** This palette would be refused at activation:');
    for (const e of (validation.errors || [])) push(`- ${md.esc(e.field)}: ${md.esc(e.message)}`);
    for (const w of (validation.warnings || [])) push(`- (warning) ${md.esc(w.field)}: ${md.esc(w.message)}`);
  }
  push('');

  const roles = pal.roles || {};
  const roleRows = [];
  for (const [role, list] of Object.entries(roles)) {
    for (const c of (list || []).slice(0, 4)) roleRows.push([role, c.value, c.signal || '', md.link(c.source_url)]);
  }
  if (roleRows.length) {
    push('### 2.5 Every colour sighting, by the role the site gave it');
    push('');
    push(mdTable(['Role', 'Value', 'Signal', 'Source'], roleRows));
    push('');
  }

  /* ── 3. Typography ───────────────────────────────────────────────────── */
  push('## 3. Typography');
  push('');
  const typ = f.typography || {};
  for (const [label, key] of [['Heading', 'heading'], ['Body', 'body'], ['Monospace', 'mono']]) {
    const list = typ[key] || [];
    push(`### 3.${label === 'Heading' ? 1 : label === 'Body' ? 2 : 3} ${label}`);
    push('');
    if (list.length) {
      push(mdTable(['Family', 'Stack', 'Signal', 'Source'],
        list.slice(0, 6).map((c) => [c.value, c.stack || '', c.signal || '', md.link(c.source_url)])));
    } else if (key === 'mono') {
      push('_No monospace family was declared. That is normal; most brands do not have one._');
    } else {
      push(`_Nothing declared._`);
    }
    push('');
  }
  for (const mk of (typ.markers || [])) { markers.push(mk); push(`> ${mk}`); }
  if ((typ.font_faces || []).length) {
    push('');
    push('**Self-hosted faces (`@font-face`)**');
    push('');
    push(mdTable(['Family', 'Source'], typ.font_faces.map((c) => [c.value, md.link(c.source_url)])));
  }
  if ((typ.google_font_links || []).length) {
    push('');
    push('**Web fonts the page loads.** Loading a family proves it is available, not where it is used, '
      + 'so these are listed and not assigned to a role.');
    push('');
    push(mdTable(['Family', 'Weights', 'Loaded on'],
      typ.google_font_links.flatMap((l) => l.families.map((x) => [x.family, x.weights || '', md.link(l.source_url)]))));
  }
  push('');

  /* ── 4. Spacing, radius, elevation, motion ───────────────────────────── */
  push('## 4. Radius, spacing, elevation and motion');
  push('');
  const dt = (f.design_tokens && f.design_tokens.groups) || {};
  const dtRows = [];
  for (const [group, list] of Object.entries(dt)) {
    for (const c of (list || [])) dtRows.push([group, c.token || '', c.value, md.link(c.source_url)]);
  }
  if (dtRows.length) {
    push(mdTable(['Group', 'Token', 'Value', 'Source'], dtRows));
    push('');
    push(`_${md.esc((f.design_tokens && f.design_tokens.note) || '')}_`);
  } else {
    gap('design tokens (radius, spacing, elevation, motion)',
      'The site ships no CSS custom properties whose names declare a radius, spacing, elevation or '
      + 'motion scale. A padding measured off one rule is one measurement, not a scale, so nothing '
      + 'was inferred from usage.');
  }
  push('');

  /* ── 5. Voice ────────────────────────────────────────────────────────── */
  push('## 5. Voice, as OBSERVED');
  push('');
  push('This is a description of how this brand\'s public copy reads. It is **not** the company\'s '
    + 'voice guidelines, which are an internal document this platform has never seen and must never '
    + 'claim to quote.');
  push('');
  const voice = f.voice || {};
  if (voice.value && voice.value.tone) {
    push(mdTable(['', ''], [
      ['Tone', voice.value.tone],
      ['Vocabulary it actually uses', (voice.value.preferred || []).join(', ')],
      ['Notes', voice.value.notes || ''],
    ]));
    if ((voice.sources || []).length) {
      push('');
      push('Read from: ' + voice.sources.map((u) => md.link(u)).join(', '));
    }
    if ((voice.value.evidence || []).length) {
      push('');
      push('**Verbatim evidence**');
      push('');
      for (const q of voice.value.evidence.slice(0, 6)) push(`> ${md.esc(q)}`);
    }
  } else {
    const mk = voice.marker || MARKER('voice.tone');
    markers.push(mk);
    push(`> ${mk}`);
    push('>');
    push(`> ${md.esc(voice.note || 'No observable tone could be read from the copy on the pages that were fetched.')}`);
  }
  push('');
  const bannedMarker = MARKER('voice.banned phrases');
  markers.push(bannedMarker);
  push(`> ${bannedMarker}`);
  push('>');
  push('> A phrase a brand refuses to use cannot be observed from the phrases it did use. '
    + 'The banned list is always the operator\'s to write.');
  push('');

  /* ── 6. Claims ───────────────────────────────────────────────────────── */
  push('## 6. Sentences the site publishes as checkable facts');
  push('');
  const claims = (f.claims && f.claims.candidates) || [];
  if (claims.length) {
    push(`_${md.esc(f.claims.note || '')}_`);
    push('');
    push(mdTable(['Sentence', 'Source'], claims.slice(0, 20).map((c) => [c.value, md.link(c.source_url)])));
  } else {
    gap('verifiable claims', 'No sentence on the pages that were read is stated in a form that could be checked.');
  }
  push('');

  /* ── 7. Limits ───────────────────────────────────────────────────────── */
  push('## 7. What this method cannot see');
  push('');
  for (const l of ((report && report.limits) || [])) push(`- ${md.esc(l)}`);
  if (report && report.coverage_note) push(`- ${md.esc(report.coverage_note)}`);
  push('');

  /* ── 8. Markers ──────────────────────────────────────────────────────── */
  const all = [...new Set(markers.concat((report && report.markers) || []))];
  push('## 8. Data required before launch');
  push('');
  if (all.length) { for (const mk of all) push(`- \`${mk}\``); }
  else push('_Nothing outstanding from this read._');
  push('');

  return { markdown: out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n', markers: all };
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. KNOWLEDGE — the brand's own pages, VERBATIM
   ═══════════════════════════════════════════════════════════════════════════ */

function stripHtml(html) {
  let s = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<\/?[a-z][^>]*>/gi, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'");
  return s.replace(/\s+/g, ' ').trim();
}

const textOf = (html) => stripHtml(html);

function headingsOf(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const t = clip(stripHtml(m[2]), 200);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * One page of the brand's own site → one kb_knowledge row.
 *
 * Deliberately NO LLM. Every other ingest path in this repo summarises with a
 * model, which is right for a competitor's blog post and wrong here: a
 * paraphrase of the brand's OWN copy is a new brand fact that nobody approved,
 * and the operating spec forbids exactly that. So the summary is the page's own
 * declared description, VERBATIM, and the key points are the page's own
 * headings, VERBATIM. A page that declares no description gets a marker.
 *
 * The second reason is practical: an LLM call per page could not fit a
 * whole-site ingest into any number of serverless invocations a user will wait
 * through, so the honest version is also the only version that finishes.
 */
function knowledgeRecord(html, url, opts) {
  const o = opts || {};
  const meta = siteCrawl.metaTags(html);
  const canonical = kbUrl.canonicalUrl(url);
  const titleTag = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || '') || [])[1];
  const title = clip(meta['og:title'] || stripHtml(titleTag || ''), 240);
  const described = clip(meta.description || meta['og:description'], 2000);
  const headings = headingsOf(html);
  const raw = textOf(html).slice(0, o.rawTextChars || DEFAULTS.rawTextChars);

  // Declared tags only: the page's own article:tag / keywords. Never derived.
  const tags = [];
  for (const key of ['article:tag', 'keywords', 'news_keywords']) {
    for (const t of String(meta[key] || '').split(',')) {
      const v = clip(t, 40).toLowerCase();
      if (v && !tags.includes(v)) tags.push(v);
    }
  }
  tags.unshift('brand-site');

  return {
    row: {
      url: canonical,
      url_hash: kbUrl.urlHash(canonical),
      source_type: 'web',
      title: title || null,
      author: clip(meta.author || meta['article:author'], 120) || null,
      raw_text: raw || null,
      // VERBATIM or a marker. Never a generated sentence.
      summary: described || MARKER('page description', canonical),
      key_points: headings,
      tags: tags.slice(0, 8),
      status: described ? 'summarized' : 'fetched',
      added_by: 'brand-context-pack',
      processed_at: nowIso(),
    },
    declared_description: !!described,
    headings: headings.length,
    chars: raw.length,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. GITHUB — searched, or honestly not searched
   ═══════════════════════════════════════════════════════════════════════════ */

const GITHUB_API = 'https://api.github.com';

/** GitHub owner logins the brand's OWN site links to. This is the only thing
 *  that can make a repository "the brand's" rather than "named like it". */
function declaredGithubOwners(report, brand) {
  const out = [];
  const add = (u, source) => {
    const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\b/.exec(String(u || ''));
    if (!m) return;
    const login = m[1].toLowerCase();
    if (['orgs', 'features', 'about', 'pricing', 'topics', 'collections', 'sponsors', 'login', 'apps', 'marketplace'].includes(login)) return;
    if (!out.some((x) => x.login === login)) out.push({ login, source_url: source || '', declared_at: u });
  };
  for (const c of (((report || {}).fields || {}).social || {}).candidates || []) {
    if (c && c.platform === 'github') add(c.value, c.source_url);
  }
  for (const s of ((brand && brand.brand_data && brand.brand_data.social) || [])) {
    if (s && /github\.com/i.test(String(s.url || ''))) add(s.url, s.source_url || '');
  }
  return out;
}

/**
 * How, and whether, a repository can be tied to this brand.
 *
 * A name match is NOT evidence. "allbirds in:name" returns a Tailwind tutorial
 * and two student clones before it returns anything the company owns, and
 * presenting those as "the brand's repositories" is fabrication with a URL
 * attached. So a candidate is only ever `verified` when something INDEPENDENT
 * of its name ties it to the brand:
 *
 *   declared-owner   the brand's own site links to github.com/<owner>, and this
 *                    repository belongs to that owner.
 *   homepage-match   the repository's own `homepage` field points at a host the
 *                    brand has declared as its own.
 *
 * Everything else is reported as `unverified: name match only`, and never
 * counted as the brand's.
 */
function repoVerification(repo, { owners = [], hosts = [] } = {}) {
  const ownerLogin = String((repo && repo.owner && repo.owner.login) || (String(repo && repo.full_name || '').split('/')[0]) || '').toLowerCase();
  const declared = owners.find((o) => o.login === ownerLogin);
  if (declared) {
    return {
      verification: 'verified',
      basis: 'declared-owner',
      evidence: `This brand's own site links to github.com/${declared.login} (${declared.source_url || 'source page recorded on the social profile'}), and this repository belongs to that account.`,
    };
  }
  const home = hostOf(repo && repo.homepage);
  if (home && hosts.some((h) => home === h || home.endsWith('.' + h))) {
    return {
      verification: 'verified',
      basis: 'homepage-match',
      evidence: `The repository's own homepage field points at ${home}, which is this brand's declared domain.`,
    };
  }
  return {
    verification: 'unverified',
    basis: 'name-match',
    evidence: 'Matched on name only. A repository that merely shares a brand\'s name is very often a tutorial, a clone or an unrelated project, so this is NOT recorded as this brand\'s repository.',
  };
}

/** The searches to run, most specific first. */
function githubQueries(brand, owners) {
  const out = [];
  const host = hostOf(brand && brand.website);
  for (const o of owners) out.push({ q: `user:${o.login} fork:false`, why: `repositories owned by github.com/${o.login}, which this brand's own site links to` });
  const name = clip(brand && brand.name, 60);
  if (name) out.push({ q: `${JSON.stringify(name)} in:name,description fork:false`, why: 'repositories whose name or description contains the brand name (name match only, never treated as proof)' });
  if (host) out.push({ q: `${JSON.stringify(host)} in:readme,description fork:false`, why: `repositories that mention ${host}` });
  return out.slice(0, 3);
}

async function defaultGithubFetch(url, timeoutMs, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': DEFAULTS.userAgent, 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
    const body = await r.text();
    return { ok: r.ok, status: r.status, body, rate_remaining: r.headers.get('x-ratelimit-remaining') || '' };
  } catch (e) {
    return { ok: false, status: 0, body: '', error: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
}

/**
 * Search GitHub for this brand's repositories, and be explicit about whether
 * the search happened at all.
 *
 * The three outcomes are kept apart on purpose, because collapsing them is how
 * a tool comes to report "this brand has no public code" about a brand whose
 * repositories it simply could not reach:
 *
 *   searched:false, reachable:false   we could not talk to GitHub. NOT a finding.
 *   searched:true,  verified:[]       we looked, and nothing could be tied to
 *                                     this brand by anything but its name.
 *   searched:true,  verified:[…]      these belong to the brand, and here is why.
 */
async function searchGithubRepos(brand, report, opts) {
  const o = opts || {};
  const fetchImpl = o.fetchImpl || ((u, ms) => defaultGithubFetch(u, ms, o.token || process.env.GITHUB_TOKEN || ''));
  const owners = declaredGithubOwners(report, brand);
  const hosts = [...siteCrawl.allowedHosts(brand || {})];
  const queries = githubQueries(brand, owners);

  const base = {
    searched: false,
    reachable: false,
    provider: 'api.github.com/search/repositories',
    authenticated: !!(o.token || process.env.GITHUB_TOKEN),
    declared_owners: owners,
    queries: queries.map((q) => q.q),
    query_rationale: queries,
    candidates: [],
    verified: [],
    unverified: [],
    markers: [],
    note: '',
  };

  if (!queries.length) {
    base.note = 'No search was run: the brand record carries neither a name nor a website to search on.';
    base.markers.push(MARKER('GitHub repository search input (brand name or website)'));
    return base;
  }

  const seen = new Set();
  const failures = [];
  let anyOk = false;

  for (const q of queries) {
    const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(q.q)}&per_page=10&sort=updated&order=desc`;
    const r = await fetchImpl(url, o.timeoutMs || DEFAULTS.githubMs);
    if (!r || !r.ok) {
      failures.push({
        query: q.q,
        status: (r && r.status) || 0,
        reason: (r && r.status === 403) ? 'GitHub answered 403 (rate limited, or this deployment\'s egress does not permit api.github.com).'
          : (r && r.status === 401) ? 'GitHub answered 401 (GITHUB_TOKEN present but rejected).'
            : (r && r.status === 422) ? 'GitHub rejected the query as malformed.'
              : (r && r.error) ? `Request failed: ${clip(r.error, 120)}`
                : `GitHub answered ${(r && r.status) || 0}.`,
      });
      continue;
    }
    anyOk = true;
    let json; try { json = JSON.parse(r.body); } catch (_) { json = null; }
    for (const item of ((json && json.items) || [])) {
      const full = String(item.full_name || '');
      if (!full || seen.has(full.toLowerCase())) continue;
      seen.add(full.toLowerCase());
      const v = repoVerification(item, { owners, hosts });
      base.candidates.push({
        full_name: full,
        html_url: item.html_url || `https://github.com/${full}`,
        description: clip(item.description, 300),
        homepage: item.homepage || '',
        language: item.language || '',
        stars: item.stargazers_count || 0,
        archived: !!item.archived,
        fork: !!item.fork,
        updated_at: item.updated_at || '',
        matched_by: q.q,
        verification: v.verification,
        basis: v.basis,
        evidence: v.evidence,
      });
    }
  }

  base.searched = anyOk;
  base.reachable = anyOk;
  base.failures = failures;
  base.verified = base.candidates.filter((c) => c.verification === 'verified');
  base.unverified = base.candidates.filter((c) => c.verification !== 'verified');

  if (!anyOk) {
    base.note = 'NOT SEARCHED — no access. Every request to GitHub failed, so this pack contains no '
      + 'statement at all about this brand\'s repositories. This is not a finding that none exist. '
      + (failures[0] ? failures[0].reason : '')
      + ' Set GITHUB_TOKEN and re-run, or confirm the deployment may reach api.github.com.';
    base.markers.push(MARKER('GitHub repositories (search unreachable)'));
    return base;
  }

  if (!base.verified.length) {
    base.note = base.unverified.length
      ? `Searched. ${base.unverified.length} repositor${base.unverified.length === 1 ? 'y' : 'ies'} share this brand's name, and NONE could be tied to the brand by anything other than that name, so none are recorded as the brand's. A name match is routinely a tutorial, a clone or an unrelated project.`
      : 'Searched. GitHub returned nothing for this brand.';
    base.markers.push(MARKER('official GitHub repository (no verified match)'));
  } else {
    base.note = `Searched. ${base.verified.length} repositor${base.verified.length === 1 ? 'y is' : 'ies are'} tied to this brand by evidence independent of its name; ${base.unverified.length} further name match(es) are listed separately and are NOT treated as the brand's.`;
  }
  if (!owners.length) {
    base.note += ' This brand\'s own site does not link to a GitHub account, so no repository could be verified by declared ownership.';
  }
  return base;
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. STORES
   The pack work runs either as the signed-in operator (RLS is the authority) or
   with the service role plus an EXPLICIT workspace filter (the pattern the
   competitor-universe sweep already uses for background work). Both expose the
   same tiny interface, so there is one implementation of every stage.
   ═══════════════════════════════════════════════════════════════════════════ */

function supaEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url) { const e = new Error('SUPABASE_URL missing'); e.status = 503; throw e; }
  return { url: String(url).replace(/\/$/, ''), anon: anon || '', service: service || '' };
}

function makeStore(kind, { token, apikey }) {
  const e = supaEnv();
  const call = async (pathAndQuery, { method = 'GET', body, prefer } = {}) => {
    const headers = { apikey: apikey || e.anon || token, authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    const r = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
    });
    const text = await r.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
    if (!r.ok) {
      const err = new Error(`supabase ${method} ${pathAndQuery} -> ${r.status}: ${(json && (json.message || json.hint)) || text}`);
      err.status = (r.status === 401 || r.status === 403) ? r.status : 502;
      throw err;
    }
    return json;
  };
  return { kind, call };
}

/** As the signed-in operator. RLS decides what they may touch. */
function userStore(token) { return makeStore('user', { token }); }

/** For the background chain, which has no user token. Every read and write it
 *  makes carries an explicit workspace filter, because the service role bypasses
 *  RLS and would otherwise happily touch another brand's pack. */
function serviceStore() {
  const e = supaEnv();
  if (!e.service) { const err = new Error('SUPABASE_SERVICE_ROLE_KEY missing'); err.status = 503; throw err; }
  return makeStore('service', { token: e.service, apikey: e.service });
}

/* ── pack row access (always workspace-filtered) ─────────────────────────── */

const PACK_COLS = 'id,workspace_id,site_url,site_host,brand_name,folded_name,brand_key,status,stage,'
  + 'queue_state,attempts,batches,last_error,design_md,design,knowledge,catalog,repos,sources,markers,limits,log,'
  + 'started_at,completed_at,created_at,updated_at';

async function getPackRow(store, workspaceId, brandKey) {
  const q = `${TABLE}?select=${PACK_COLS}&workspace_id=eq.${encodeURIComponent(workspaceId)}`
    + (brandKey ? `&brand_key=eq.${encodeURIComponent(brandKey)}` : '')
    + '&order=updated_at.desc&limit=1';
  const rows = await store.call(q);
  return (Array.isArray(rows) && rows[0]) || null;
}

async function listPackRows(store, workspaceId) {
  const rows = await store.call(`${TABLE}?select=${PACK_COLS}&workspace_id=eq.${encodeURIComponent(workspaceId)}&order=updated_at.desc&limit=20`);
  return Array.isArray(rows) ? rows : [];
}

async function patchPack(store, pack, patch) {
  // Both the id AND the workspace. Naming only the id is one refactor away from
  // writing to another brand's row, and the filter costs nothing.
  const rows = await store.call(
    `${TABLE}?id=eq.${encodeURIComponent(pack.id)}&workspace_id=eq.${encodeURIComponent(pack.workspace_id)}&select=${PACK_COLS}`,
    { method: 'PATCH', body: Object.assign({ updated_at: nowIso() }, patch), prefer: 'return=representation' },
  );
  return (Array.isArray(rows) && rows[0]) || Object.assign({}, pack, patch);
}

function appendLog(pack, stage, detail, extra) {
  const log = Array.isArray(pack.log) ? pack.log.slice(-40) : [];
  log.push(Object.assign({ at: nowIso(), stage, detail: clip(detail, 400) }, extra || {}));
  return log;
}

/* ── provenance ──────────────────────────────────────────────────────────── */

async function fieldOrigins(store, workspaceId) {
  try {
    const rows = await store.call(`${PROV_TABLE}?select=field,origin,source_url,signal,confidence,set_at&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=400`);
    const out = new Map();
    for (const r of (Array.isArray(rows) ? rows : [])) out.set(r.field, r);
    return out;
  } catch (_) { return new Map(); }
}

/**
 * Is this field the user's? The pack asks BEFORE doing automatic work, purely so
 * it can say "skipped, you own this" instead of doing the work and having the
 * database refuse it. The database refusing it is still the guarantee.
 */
async function isUserOwned(store, workspaceId, field) {
  const origins = await fieldOrigins(store, workspaceId);
  const row = origins.get(field);
  return !!(row && row.origin === 'user');
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. THE STAGES
   Each returns { stage_result, next } and NEVER throws for a data reason - a
   stage that could not do its job records why and moves on, because a pack that
   is 80% built and honest about the other 20% is worth more than no pack.
   ═══════════════════════════════════════════════════════════════════════════ */

async function brandRow(store, workspaceId) {
  const rows = await store.call(`brand_workspaces?select=*&id=eq.${encodeURIComponent(workspaceId)}&limit=1`);
  return (Array.isArray(rows) && rows[0]) || null;
}

/**
 * STAGE catalog — through the EXISTING importCatalog path, never a second one.
 *
 * Needs the operator's own token: importCatalog checks the editor role and
 * writes through RLS. The background chain has no token, so this is the one
 * stage that only advances on a user-authenticated call - which is why it is
 * first in the order, where the starting call always is one.
 */
async function stageCatalog(store, pack, ctx) {
  const { auth, brand } = ctx;
  if (await isUserOwned(store, pack.workspace_id, 'catalog')) {
    return {
      catalog: {
        ran: false, skipped: 'user_owned',
        note: 'Skipped: this workspace\'s catalogue was supplied by a person (an upload, or a source they '
          + 'chose), and an automatic run never replaces that. Delete the catalogue, or import again by hand, '
          + 'to hand it back to the automatic path.',
      },
    };
  }
  if (!auth || !auth.token || !auth.user_id) {
    return {
      catalog: {
        ran: false, skipped: 'no_operator_token',
        note: 'Not attempted: importing a catalogue writes as the operator (it checks their editor role and '
          + 'goes through RLS), and this run had no operator token. Open the brand and press Build again, '
          + 'signed in as an editor.',
      },
    };
  }
  const core = require('./brand-workspace-core.js');
  const url = (brand && brand.website) || pack.site_url;
  const region = (((brand && brand.regions) || [])[0] || {}).code || 'us';
  try {
    const out = await core.importCatalog(auth, {
      workspace_id: pack.workspace_id,
      region: String(region).toLowerCase(),
      kind: 'storefront',            // feed first, then the site crawl — importCatalog's own fallback
      url,
      replace: true,
    });
    await store.call('rpc/brand_context_apply', {
      method: 'POST',
      body: { p_workspace: pack.workspace_id, p_fields: {}, p_source: {} },
    }).catch(() => null);            // no-op: only here to surface an unapplied migration early
    return { catalog: Object.assign({ ran: true, region: String(region).toLowerCase(), url }, out) };
  } catch (e) {
    return {
      catalog: {
        ran: true, ok: false, url, region: String(region).toLowerCase(),
        error: clip(e && e.message, 400),
        note: 'The catalogue could not be read from this site. Nothing was written, and no product was '
          + 'invented to stand in for one. Import a CSV or a JSON export instead.',
      },
      markers: [MARKER('product catalog', 'all', String(region).toLowerCase())],
    };
  }
}

/**
 * STAGE extract — read the brand off its own site, then render design.md.
 * Uses brand-extract as the input; it does not re-derive a single design fact.
 */
async function stageExtract(store, pack, ctx) {
  const bx = require('./brand-extract.js');
  const core = require('./brand-workspace-core.js');
  const brand = ctx.brand || {};
  const scope = {
    website: pack.site_url,
    regions: brand.regions,
    asset_hosts: [].concat(brand.asset_hosts || [], [pack.site_host]).filter(Boolean),
  };
  const report = await bx.extractBrand(pack.site_url, {
    brand: scope,
    voice: ctx.voice !== false,
    maxPages: ctx.extractMaxPages || DEFAULTS.extractMaxPages,
    fetchImpl: ctx.fetchImpl,
    llm: ctx.llm,
  });

  if (!report || report.ok === false) {
    return {
      design: { ok: false, error: (report && report.error) || 'crawl_failed', message: (report && report.message) || '' },
      design_md: null,
      markers: [MARKER('design system (site could not be read)')],
      limits: (report && report.limits) || [],
      log: `Extraction failed: ${(report && report.message) || 'the site could not be read'}.`,
    };
  }

  // The palette proposal goes through the SAME gate that blocks activation, so
  // design.md prints the real verdict rather than a proposal that would be
  // refused two steps later.
  try {
    const p = (report.fields.palette && report.fields.palette.proposed) || {};
    const filled = Object.fromEntries(Object.entries(p).filter(([, v]) => v));
    report.fields.palette.validation = Object.keys(filled).length
      ? core.validatePalette(filled)
      : { ok: false, errors: [{ field: 'primary', message: 'Nothing was extracted to validate.' }], warnings: [], contrast: {} };
  } catch (_) { /* a validation failure must not lose the whole report */ }

  const doc = renderDesignMd(report, brand, { brand_key: pack.brand_key, observed_at: nowIso() });

  return {
    design: {
      ok: true,
      observed_at: nowIso(),
      start: report.start,
      pages: report.pages,
      pages_visited: report.pages_visited,
      stylesheets: report.stylesheets,
      manifest_url: report.manifest_url,
      stopped: report.stopped,
      coverage_note: report.coverage_note,
      fields: report.fields,
    },
    design_md: doc.markdown,
    markers: doc.markers,
    limits: report.limits || [],
    sources: (report.pages || []).concat(report.stylesheets || []),
    log: `Read ${report.pages_visited} page(s) and ${(report.stylesheets || []).length} stylesheet(s); design.md rendered (${doc.markdown.length} chars, ${doc.markers.length} marker(s)).`,
  };
}

/**
 * STAGE knowledge — the brand's own site, one batch at a time.
 *
 * Same-origin only, and that is not this module's choice to make: it rides on
 * site-crawl's scope, robots and SSRF rules, so a page on any other host is
 * unreachable from here by construction rather than by convention.
 */
async function stageKnowledge(store, pack, ctx) {
  const brand = ctx.brand || {};
  const qs = (pack.queue_state && typeof pack.queue_state === 'object') ? pack.queue_state : {};
  const state = qs.knowledge || { seen: [], frontier: [], ingested: 0, skipped: 0, pages: [] };
  const seen = new Set(state.seen || []);
  const maxPages = ctx.knowledgeMaxPages || DEFAULTS.knowledgeMaxPages;

  if (state.ingested >= maxPages) {
    return {
      knowledge: knowledgeSummary(state, `Stopped at the ${maxPages}-page cap for one pack.`),
      queue_state: Object.assign({}, qs, { knowledge: state }),
      done_stage: true,
    };
  }

  const scope = {
    website: pack.site_url,
    regions: brand.regions,
    asset_hosts: [].concat(brand.asset_hosts || [], [pack.site_host]).filter(Boolean),
  };
  const captured = [];
  const crawl = await siteCrawl.crawlSite(pack.site_url, {
    brand: scope,
    fetchImpl: ctx.fetchImpl,
    frontier: state.frontier || [],
    skip: (u) => seen.has(u),
    maxPages: Math.min(ctx.knowledgePagesPerBatch || DEFAULTS.knowledgePagesPerBatch, maxPages - state.ingested),
    maxDepth: ctx.knowledgeMaxDepth || DEFAULTS.knowledgeMaxDepth,
    perRequestMs: ctx.perRequestMs || DEFAULTS.perRequestMs,
    totalMs: ctx.knowledgeBatchMs || DEFAULTS.knowledgeBatchMs,
    userAgent: DEFAULTS.userAgent,
    onPage: (html, url) => { captured.push({ html, url }); },
  });

  if (!crawl.ok) {
    return {
      knowledge: knowledgeSummary(state, `The site could not be crawled: ${crawl.error || 'unknown'}.`),
      markers: [MARKER('knowledge base (site could not be crawled)')],
      queue_state: Object.assign({}, qs, { knowledge: state }),
      done_stage: true,
    };
  }

  const built = [];
  for (const { html, url } of captured) {
    seen.add(url);
    const rec = knowledgeRecord(html, url, ctx);
    if (!rec.row.title && !rec.row.raw_text) { state.skipped = (state.skipped || 0) + 1; continue; }
    built.push(rec);
  }

  let stored = 0;
  let storeError = '';
  if (built.length) {
    try {
      const rows = built.map((b) => Object.assign({ workspace_id: pack.workspace_id }, b.row));
      await store.call(`${KB_TABLE}?on_conflict=workspace_id,url_hash`, {
        method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal',
      });
      stored = rows.length;
    } catch (e) {
      // Report it. A knowledge base that silently stored nothing is worse than
      // one that says it stored nothing.
      storeError = clip(e && e.message, 300);
    }
  }

  state.seen = [...seen].slice(-1500);
  state.frontier = (crawl.frontier_remaining || []).slice(0, 400);
  state.ingested = (state.ingested || 0) + stored;
  state.pages = (state.pages || []).concat(built.map((b) => ({
    url: b.row.url, title: b.row.title, declared_description: b.declared_description,
    headings: b.headings, chars: b.chars,
  }))).slice(-200);
  if (storeError) state.errors = (state.errors || []).concat([storeError]).slice(-5);

  const more = state.frontier.length > 0 && state.ingested < maxPages;
  return {
    knowledge: knowledgeSummary(state, more
      ? `In progress: ${state.ingested} page(s) filed, ${state.frontier.length} still queued.`
      : `Complete: ${state.ingested} page(s) of this brand's own site filed.`),
    queue_state: Object.assign({}, qs, { knowledge: state }),
    sources: built.map((b) => b.row.url),
    done_stage: !more,
    log: `Knowledge batch: ${captured.length} page(s) fetched, ${stored} filed${storeError ? `, store failed: ${storeError}` : ''}.`,
  };
}

function knowledgeSummary(state, note) {
  const pages = state.pages || [];
  const undescribed = pages.filter((p) => !p.declared_description).length;
  return {
    scope: 'same-origin only — this brand\'s own site and the hosts it declares, enforced by site-crawl',
    table: KB_TABLE,
    ingested: state.ingested || 0,
    queued: (state.frontier || []).length,
    skipped_empty: state.skipped || 0,
    verbatim: true,
    method: 'Each page is filed with its own declared description and its own headings, VERBATIM. No model '
      + 'writes a summary of this brand\'s copy, because a paraphrase of a brand fact is a new brand fact '
      + 'nobody approved.',
    pages: pages.slice(-60),
    pages_without_declared_description: undescribed,
    markers: undescribed ? [MARKER(`page description, ${undescribed} page(s)`)] : [],
    errors: state.errors || [],
    note,
  };
}

/** STAGE repos — GitHub, with reachability recorded. */
async function stageRepos(store, pack, ctx) {
  const brand = Object.assign({}, ctx.brand || {}, { website: pack.site_url, name: pack.brand_name });
  const report = { fields: (pack.design && pack.design.fields) || {} };
  const repos = await searchGithubRepos(brand, report, {
    fetchImpl: ctx.githubFetch, token: ctx.githubToken, timeoutMs: ctx.githubMs,
  });
  return {
    repos,
    markers: repos.markers || [],
    sources: (repos.verified || []).map((r) => r.html_url),
    log: repos.searched
      ? `GitHub searched: ${repos.verified.length} verified, ${repos.unverified.length} name-match only.`
      : 'GitHub NOT searched — no access. Recorded as unsearched, not as "no repositories".',
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. THE QUEUE
   ═══════════════════════════════════════════════════════════════════════════ */

const STAGE_FN = { catalog: stageCatalog, extract: stageExtract, knowledge: stageKnowledge, repos: stageRepos };

function nextStage(stage) {
  const i = STAGES.indexOf(stage);
  return i < 0 ? 'done' : (STAGES[i + 1] || 'done');
}

/**
 * Advance the pack by exactly ONE step and persist the result.
 *
 * One step is one stage, except for `knowledge`, which is one BATCH of pages and
 * stays on its own stage until its frontier is empty. `remaining` is what the
 * caller re-fires on; a step that made no progress returns remaining 0 so a
 * failing chain stops instead of hot-looping.
 */
async function advancePack(store, pack, ctx) {
  const c = ctx || {};
  if (pack.stage === 'done') return { ok: true, pack, stage: 'done', remaining: 0, done: true };

  const fn = STAGE_FN[pack.stage];
  if (!fn) {
    const patched = await patchPack(store, pack, { stage: 'done', status: 'complete', completed_at: nowIso() });
    return { ok: true, pack: patched, stage: 'done', remaining: 0, done: true };
  }

  const brand = c.brand || (await brandRow(store, pack.workspace_id).catch(() => null));
  let out;
  try {
    out = await fn(store, pack, Object.assign({}, c, { brand }));
  } catch (e) {
    const patched = await patchPack(store, pack, {
      status: 'running',
      stage: nextStage(pack.stage),
      attempts: (pack.attempts || 0) + 1,
      last_error: clip(`${pack.stage}: ${e && e.message}`, 400),
      log: appendLog(pack, pack.stage, `Stage failed and was skipped: ${clip(e && e.message, 200)}`),
    });
    // A failed stage is recorded and stepped over rather than retried forever:
    // a pack that is missing one section and says which is usable; a chain that
    // retries a permanently broken stage is not.
    return { ok: true, pack: patched, stage: patched.stage, remaining: patched.stage === 'done' ? 0 : 1, failed_stage: pack.stage, error: clip(e && e.message, 200) };
  }

  const stayOnStage = pack.stage === 'knowledge' && out.done_stage === false;
  const patch = {
    status: 'running',
    batches: (pack.batches || 0) + 1,
    stage: stayOnStage ? pack.stage : nextStage(pack.stage),
    log: appendLog(pack, pack.stage, out.log || `${pack.stage} complete.`),
  };
  for (const k of ['design', 'design_md', 'knowledge', 'catalog', 'repos', 'queue_state']) {
    if (out[k] !== undefined) patch[k] = out[k];
  }
  if (out.markers) patch.markers = [...new Set([].concat(pack.markers || [], out.markers))].slice(0, 120);
  if (out.limits) patch.limits = [...new Set([].concat(pack.limits || [], out.limits))].slice(0, 40);
  if (out.sources) patch.sources = [...new Set([].concat(pack.sources || [], out.sources))].slice(0, 400);
  if (patch.stage === 'done') { patch.status = 'complete'; patch.completed_at = nowIso(); }

  const patched = await patchPack(store, pack, patch);
  return {
    ok: true, pack: patched, stage: patched.stage,
    remaining: patched.stage === 'done' ? 0 : 1,
    done: patched.stage === 'done',
  };
}

/**
 * Create or refresh the pack for a workspace, run the first (operator-token)
 * stage, and hand the rest to the background chain.
 */
async function startPack(store, workspaceId, { brand, auth, refresh = false, ctx = {} } = {}) {
  const b = brand || (await brandRow(store, workspaceId));
  if (!b) { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
  if (!b.website) {
    const e = new Error('This brand has no website on its record, and a context pack is built from the brand\'s own URL. Add the website first.');
    e.status = 400; throw e;
  }
  const key = packKey(b.website, b.name);
  if (!key.ok) {
    const e = new Error('A context pack is keyed to the brand\'s URL and its name, and one of them is missing.');
    e.status = 400; throw e;
  }

  const existing = await getPackRow(store, workspaceId, key.brand_key);
  let pack;
  if (existing && !refresh && existing.stage !== 'done') {
    pack = existing;                          // resume, never restart
  } else {
    const row = {
      workspace_id: workspaceId,
      site_url: b.website, site_host: key.site_host,
      brand_name: b.name, folded_name: key.folded_name,
      status: 'running', stage: STAGES[0],
      queue_state: { requested_by: (auth && auth.user_id) || null, started_at: nowIso() },
      attempts: 0, batches: 0, last_error: null,
      markers: [], limits: [], sources: [], log: [],
      started_at: nowIso(), completed_at: null,
    };
    // Upsert on the key, so a re-run of the same brand updates one row.
    const saved = await store.call(`${TABLE}?on_conflict=workspace_id,brand_key&select=${PACK_COLS}`, {
      method: 'POST', body: [row], prefer: 'resolution=merge-duplicates,return=representation',
    });
    pack = Array.isArray(saved) ? saved[0] : saved;
  }

  const step = await advancePack(store, pack, Object.assign({ brand: b, auth }, ctx));
  return step;
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. READING THE PACK BACK — the brand's standing context
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * What a feature should know about this brand, and where every part of it came
 * from. User-supplied values are marked as such, so a caller can see at a glance
 * which parts of the context a person owns and which a machine observed.
 */
async function contextFor(store, workspaceId, { brandKey } = {}) {
  const brand = await brandRow(store, workspaceId).catch(() => null);
  const key = brand && brand.website ? packKey(brand.website, brand.name) : null;
  const pack = await getPackRow(store, workspaceId, brandKey || (key && key.ok ? key.brand_key : '')).catch(() => null);
  const origins = await fieldOrigins(store, workspaceId);

  if (!pack) {
    return {
      ok: true, workspace_id: workspaceId, pack: null,
      brand: brand ? { name: brand.name, website: brand.website } : null,
      note: brand && brand.website
        ? 'No context pack has been built for this brand yet. Build one from the brand screen; it reads the brand\'s own site and nothing else.'
        : 'This brand has no website on its record, so there is nothing to read a context pack from.',
      markers: [MARKER('brand context pack')],
    };
  }

  // The pack is a report about ONE site. If the brand has since moved or been
  // renamed, say so rather than presenting a stale report as current.
  const stale = key && key.ok && key.brand_key !== pack.brand_key;

  return {
    ok: true,
    workspace_id: workspaceId,
    brand: brand ? { name: brand.name, website: brand.website } : null,
    pack: {
      id: pack.id, brand_key: pack.brand_key, site_url: pack.site_url, brand_name: pack.brand_name,
      status: pack.status, stage: pack.stage, batches: pack.batches,
      started_at: pack.started_at, completed_at: pack.completed_at, updated_at: pack.updated_at,
    },
    current: !stale,
    stale_note: stale
      ? `This pack describes ${pack.site_url} as "${pack.brand_name}". The brand record now says `
        + `${brand.website} / "${brand.name}", so this pack is a report about a different site or name. `
        + 'Build again to produce a pack for the current one; this one is kept, not overwritten.'
      : '',
    design_md: pack.design_md || null,
    design: pack.design || {},
    knowledge: pack.knowledge || {},
    catalog: pack.catalog || {},
    repositories: pack.repos || {},
    sources: pack.sources || [],
    limits: pack.limits || [],
    markers: pack.markers || [],
    precedence: [...origins.values()].map((r) => ({
      field: r.field, origin: r.origin, source_url: r.source_url || '', signal: r.signal || '', set_at: r.set_at,
    })),
    precedence_note: 'origin "user" means a person supplied or confirmed that field, and no automatic run may '
      + 'overwrite it — brand_context_apply() refuses it in the database, not in the caller.',
  };
}

/**
 * The pack rendered as a prompt block, for generators.
 *
 * Deliberately compact and deliberately hedged: it tells the model what the
 * brand's own site says and tells it, in the same breath, that an unmarked
 * absence is an absence of DATA and not a licence to fill one in.
 */
function contextBlock(context) {
  if (!context || !context.pack) return '';
  const L = [];
  L.push('=== BRAND CONTEXT PACK (read from this brand\'s OWN site; nothing here is invented) ===');
  L.push(`Brand: ${context.brand ? context.brand.name : context.pack.brand_name}`);
  L.push(`Site: ${context.pack.site_url}`);
  L.push(`Pack key: ${context.pack.brand_key} (keyed to this URL and this name)`);
  if (context.stale_note) L.push(`STALE: ${context.stale_note}`);
  const k = context.knowledge || {};
  L.push(`Knowledge base: ${k.ingested || 0} page(s) of this brand's own site, stored VERBATIM. Same-origin only.`);
  const c = context.catalog || {};
  L.push(`Catalog: ${c.ran === false ? `not imported automatically (${c.skipped || 'not attempted'})` : `${c.imported || 0} row(s) from ${c.url || 'the brand site'}`}.`);
  const r = context.repositories || {};
  L.push(`Repositories: ${r.searched ? `${(r.verified || []).length} verified as this brand's` : 'NOT SEARCHED (no access) — do not state that this brand has no public code'}.`);
  if ((context.markers || []).length) {
    L.push('OUTSTANDING DATA REQUIREMENTS (never fill these in; reproduce the marker):');
    for (const m of context.markers.slice(0, 20)) L.push(`  ${m}`);
  }
  L.push('If a fact you need is not in this pack, emit [DATA REQUIRED BEFORE LAUNCH: <field>, <product>, <region>] instead of supplying one.');
  L.push('=== END BRAND CONTEXT PACK ===');
  return L.join('\n');
}

/**
 * Apply what the operator accepted from the pack to the brand record.
 *
 * Goes through `brand_context_apply()`, which is the only door an automatic
 * value has and which refuses every field a person already owns. The operator
 * pressing "use" does NOT make the value theirs: they accepted a machine
 * reading, and it is recorded as one. Typing over it in the wizard is what makes
 * it theirs, and that claim wins from then on.
 */
async function applyPack(store, workspaceId, fields, sources) {
  const out = await store.call('rpc/brand_context_apply', {
    method: 'POST',
    body: { p_workspace: workspaceId, p_fields: fields || {}, p_source: sources || {} },
  });
  return out;
}

/** Record that a person supplied these fields. Called on every operator save. */
async function claimUserFields(store, workspaceId, fields) {
  const list = (Array.isArray(fields) ? fields : []).filter(Boolean);
  if (!list.length) return { ok: true, claimed: 0 };
  const n = await store.call('rpc/brand_fields_claim_user', {
    method: 'POST', body: { p_workspace: workspaceId, p_fields: list },
  });
  return { ok: true, claimed: n };
}

module.exports = {
  // key
  packKey, foldName, hostOf,
  // design.md
  renderDesignMd, mdTable,
  // knowledge
  knowledgeRecord, headingsOf, stripHtml,
  // github
  searchGithubRepos, repoVerification, githubQueries, declaredGithubOwners,
  // stores
  userStore, serviceStore, supaEnv,
  // pack rows
  getPackRow, listPackRows, patchPack, brandRow, fieldOrigins, isUserOwned,
  // queue
  startPack, advancePack, nextStage, STAGES, STAGE_FN,
  // read back
  contextFor, contextBlock, applyPack, claimUserFields,
  // constants
  TABLE, PROV_TABLE, KB_TABLE, DEFAULTS, MARKER,
};
