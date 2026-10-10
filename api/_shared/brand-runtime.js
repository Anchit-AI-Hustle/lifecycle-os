'use strict';
/**
 * brand-runtime.js — the ACTIVE BRAND, resolved server-side.
 * ---------------------------------------------------------------------------
 * brand-context.js re-skins the browser, but that is only paint: the prompts
 * that actually generate mailers, ads, landing pages and calendars run on the
 * server, and they must be built from the caller's brand too — otherwise a
 * custom brand sees its own colours in the shell and tenant-zero content in the
 * output.
 *
 * This module is the server-side counterpart. Any generator can call
 *
 *     const brand = await brandRuntime.resolve(req);
 *     const block = brandRuntime.brandBlock(brand);
 *
 * and get a prompt block describing THAT brand: identity, voice, palette,
 * typography, logo, regions, preferred and banned vocabulary.
 *
 * Resolution order:
 *   1. an explicit `workspace_id` on the request (query or body), checked
 *      against the caller's own access, then
 *   2. the caller's active workspace (brand_user_prefs), then
 *   3. data/brands/_default.json — tenant zero, so every existing caller that
 *      has no session or no brand behaves exactly as it did before.
 *
 * Zero fabrication: a field the brand has not supplied is NOT invented and NOT
 * inherited from tenant zero. It is written into the prompt as
 *   [DATA REQUIRED BEFORE LAUNCH: <field>, all, <region>]
 * so the model is told to leave a gap rather than guess.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const brandCore = require('./brand-workspace-core.js');

const CACHE = new Map();          // token+workspace -> { brand, at }
const TTL = 30_000;

function isDefault(brand) { return !brand || !brand.id; }

/* ── the brand a GENERATOR should use ──────────────────────────────────────
 *
 * `defaultBrand()` means one specific thing: TENANT ZERO, the shipped record.
 * It is the right answer to "who owns the bundled catalogue" - brand-catalog-
 * server's tenantZeroSlug() reads its identity from exactly there - and it is
 * the WRONG answer to "which brand am I generating for", which is what ~26
 * call sites across the generators were using it for:
 *
 *     if (!b) { try { b = require('./brand-runtime.js').defaultBrand(); } ... }
 *
 * Every one of those turns a brand that failed to resolve into tenant zero, so
 * a workspace with no brand on the context generated tenant zero's products
 * under its own name. That is how /social produced posts about one company's
 * sneakers, with that company's real product URLs, inside another company's
 * workspace.
 *
 * `scopedBrand()` answers the generator's question honestly:
 *   1. the brand it was handed, if it is a real one;
 *   2. otherwise the brand PINNED for this generation (AsyncLocalStorage, so
 *      concurrent brands in one warm runtime cannot see each other);
 *   3. otherwise an UNRESOLVED brand - never tenant zero.
 *
 * An unresolved brand is deliberately usable: it is brand-shaped, so callers do
 * not crash, and every field a generator would print carries a DATA REQUIRED
 * marker. The output is visibly incomplete instead of quietly belonging to
 * somebody else. Silence about a missing brand is what shipped the bug.
 */

const UNRESOLVED_NOTE = 'brand could not be resolved for this request';

function unresolvedBrand(reason) {
  const why = String(reason || UNRESOLVED_NOTE);
  const mark = (field) => `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${why}]`;
  return {
    id: '', slug: '', unresolved: true, unresolved_reason: why,
    name: mark('brand name'),
    tagline: '', industry: '', website: '',
    // Empty, not tenant zero's. A renderer with no palette falls back to the
    // --brand-* tokens the page already carries; a renderer handed tenant
    // zero's palette paints another brand's colours and looks correct.
    palette: {}, typography: {}, voice: {}, regions: [],
    claims: [], offerings: [], competitors: [],
  };
}

/** True when this record is the unresolved placeholder rather than a brand. */
function isUnresolved(brand) { return !!(brand && brand.unresolved === true); }

/**
 * The brand this generation is for. NEVER tenant zero unless tenant zero is
 * genuinely what is in scope.
 */
/**
 * A record that NAMES the brand this generation is for: a workspace row or a
 * preset (id / slug), a record a phone account carried, or the unresolved
 * placeholder. The placeholder has no id on purpose, and before 2026-10-10 it
 * was therefore read as "no brand" here and the caller fell through to tenant
 * zero - the one answer the placeholder exists to prevent.
 */
function namesBrand(b) {
  return !!(b && typeof b === 'object' && (b.id || b.slug || b.carried === true || b.unresolved === true));
}

function scopedBrand(candidate, opts) {
  const o = opts || {};
  if (namesBrand(candidate)) return candidate;

  // The catalogue scope pins {brand, workspaceId} for a generation subtree.
  try {
    const scope = require('./brand-catalog-server.js').currentScope();
    if (scope && namesBrand(scope.brand)) return scope.brand;
  } catch (_) { /* outside a pinned generation */ }

  // The request scope carries the HTTP request the handler is serving.
  try {
    const rs = require('./request-scope.js');
    const req = rs.currentRequest && rs.currentRequest();
    if (req && namesBrand(req.__brand)) return req.__brand;
  } catch (_) { /* outside a wrapped handler */ }

  // A caller that explicitly wants tenant zero asks for it by name.
  if (o.allowTenantZero === true) return defaultBrand();

  return unresolvedBrand(o.reason);
}

/**
 * Facts a brand carries that are NOT columns on `brand_workspaces`.
 *
 * The schema has a fixed set of columns (name, palette, typography, voice,
 * regions, catalog_source …) and one JSON column, `brand_data`, for everything
 * extensible. So a brand arrives here in one of two shapes that do not agree:
 *
 *   tenant zero and the presets are JSON files with these at the TOP LEVEL;
 *   a persisted workspace has them inside `brand_data`.
 *
 * Every generator in the OS reads the top level - `b.claims` in master-prompt,
 * lifecycle-mailer-build, social-core, calendar-trigger, landing-fallback. That
 * works perfectly for tenant zero and returns NOTHING for every brand a user
 * actually onboarded, so their verifiable claims never reached a single
 * generated asset and every one of them printed
 * "[DATA REQUIRED BEFORE LAUNCH: verifiable claims]" instead.
 *
 * The fix belongs at the boundary rather than at each of those call sites: this
 * is the one place a persisted row enters the system, so hoisting here fixes
 * every consumer at once, including the ones nobody has written yet.
 */
const HOISTED = ['offerings', 'claims', 'market_study', 'legal_entity', 'contact', 'social', 'asset_hosts'];

/**
 * Lift brand_data fields onto the brand, without ever shadowing a real column.
 * A genuine column always wins: brand_data is the overflow, not an override.
 */
function normalizeBrand(brand) {
  if (!brand || typeof brand !== 'object') return brand;
  const data = brand.brand_data;
  if (!data || typeof data !== 'object') return brand;

  let out = brand;
  for (const key of HOISTED) {
    const already = brand[key];
    const present = Array.isArray(already) ? already.length > 0 : (already !== undefined && already !== null);
    if (present) continue;
    if (data[key] === undefined || data[key] === null) continue;
    if (out === brand) out = { ...brand };      // copy only once, and only if needed
    out[key] = data[key];
  }
  const pend = pendingHostingOf(brand);
  if (pend.length) {
    if (out === brand) out = { ...brand };
    out.pending_hosting = pend;
  }
  return out;
}

/* ── A BRAND FILE THAT IS NOT HOSTED YET (2026-10-04) ─────────────────────
   The operator can upload a logo, an icon, a font or imagery as a FILE. With a
   database to host it, it is uploaded and its https URL goes on the record;
   with none (production now: device mode) it stays in the browser's IndexedDB,
   where the app shell and the previews use it - and where no email can.
   A generated mailer or ad must reference a HOSTED https URL: the email.mailer
   contract blocks embedded base64, and Gmail clips past ~102 KB. So such an
   asset carries, in its place, the spec's marker naming exactly what to do:
   [DATA REQUIRED BEFORE LAUNCH: hosted logo URL, <brand>] - never the bytes,
   never a blob: or data: URL, never nothing. */
const PENDING_KINDS = ['logo', 'icon', 'font', 'image'];
function httpsUrl(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s.slice(0, 500) : '';
}
/** What a server brand's record says is uploaded but not hosted yet. */
function pendingHostingOf(brand) {
  const files = brand && brand.brand_data && brand.brand_data.brand_files;
  if (!files || typeof files !== 'object') return [];
  const out = [];
  const unhosted = (f) => f && typeof f === 'object' && f.id && !httpsUrl(f.hosted_url);
  if (unhosted(files.logo) && !httpsUrl(brand.logo_url)) out.push('logo');
  if (unhosted(files.favicon) && !httpsUrl(brand.favicon_url)) out.push('icon');
  const fonts = files.fonts && typeof files.fonts === 'object' ? files.fonts : {};
  if (Object.keys(fonts).some((k) => unhosted(fonts[k]))) out.push('font');
  if (Array.isArray(files.images) && files.images.some(unhosted)) out.push('image');
  return out;
}
/** The marker for an uploaded file that is not hosted yet. */
function hostedMarker(kind, brand) {
  const what = kind === 'icon' ? 'app icon' : kind;
  return `[DATA REQUIRED BEFORE LAUNCH: hosted ${what} URL, ${(brand && brand.name) || 'this brand'}]`;
}

/**
 * The brand record a request CARRIES, for a caller whose brands are not in
 * the workspace database (a mobile+PIN account). Only the fields a generator
 * prints are taken, each bounded, and the id is rewritten to a `device:` id
 * so nothing downstream can mistake it for a brand_workspaces row or read a
 * server workspace by it. The palette is validated by the same rule the
 * wizard applies (validatePalette blocks dark-neutral surfaces); a palette
 * that fails is dropped, not painted. Nothing here is stored.
 */
function carriedBrand(body, auth) {
  const src = body && typeof body.brand === 'object' && body.brand && !Array.isArray(body.brand) ? body.brand : null;
  if (!src) return null;
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n || 200) : '');
  const list = (v, n, len) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, len || 300)).filter(Boolean).slice(0, n || 40) : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  // ONE level of short scalars, and nothing else (2026-09-29, review). The
  // first cut passed `typography` and `catalog_source` through as whatever
  // object arrived, so "bounded" held for the strings beside them and not for
  // these: a request could carry megabytes of nested JSON into every prompt
  // the turn built. A key is an identifier, a value a bounded string, a
  // finite number or a boolean; anything deeper is dropped.
  const flat = (v, n, len) => {
    const o = obj(v); const out = {};
    for (const k of Object.keys(o).slice(0, n || 12)) {
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) continue;
      const x = o[k];
      if (typeof x === 'string') out[k] = x.trim().slice(0, len || 200);
      else if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
      else if (typeof x === 'boolean') out[k] = x;
    }
    return out;
  };
  // A list whose entries are names, or small records such as an offering's
  // {kind, name, url} - the shape the presets and the wizard write, and the
  // one image-prompt, landing-page-core and growth-os read `kind` off.
  const records = (v, n, fields) => (Array.isArray(v) ? v.slice(0, n).map((x) => (
    typeof x === 'string' ? x.trim().slice(0, 200) : (x && typeof x === 'object' && !Array.isArray(x) ? flat(x, fields, 300) : null)
  )).filter((x) => x && (typeof x === 'string' ? x : Object.keys(x).length)) : []);
  const name = str(src.name, 120);
  if (!name) return null;
  let palette = flat(src.palette, 24, 40);
  try {
    const v = brandCore.validatePalette ? brandCore.validatePalette(palette) : { ok: true };
    if (v && v.ok === false) palette = {};
  } catch (_) { palette = {}; }
  const typo = obj(src.typography);
  const typography = {};
  for (const k of Object.keys(typo).slice(0, 8)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) continue;
    const x = typo[k];
    if (typeof x === 'string') typography[k] = x.trim().slice(0, 200);
    else if (x && typeof x === 'object' && !Array.isArray(x)) typography[k] = flat(x, 10, 200);
  }
  const cs = obj(src.catalog_source);
  const catalogSource = Object.assign(flat(cs, 8, 300), Array.isArray(cs.offering_kinds) ? { offering_kinds: list(cs.offering_kinds, 12, 40) } : {});
  const voice = obj(src.voice);
  const regions = (Array.isArray(src.regions) ? src.regions : []).filter((r) => r && typeof r === 'object').slice(0, 12).map((r) => ({
    code: str(r.code, 8), name: str(r.name, 60), currency: str(r.currency, 8), store_url: str(r.store_url, 300), home: r.home === true,
  }));
  const seed = String((auth && auth.user_id) || '') + '|' + name;
  const id = 'device:' + require('crypto').createHash('sha1').update(seed).digest('hex').slice(0, 16);
  return {
    // The SLUG is the device id, never the one the request sent (2026-09-29,
    // review). Tenant zero is recognised by its slug - brand-catalog-server's
    // isTenantZeroBrand(), smart-brain-plan's planningBrand(), brand-llm's
    // assistant name - so a carried `slug: "<tenant zero's slug>"` (any phone
    // account can send one; the KNICKGASM preset in the gallery carries it)
    // unlocked the shipped catalogue and planned over tenant zero's
    // assortment. A carried record is a device brand: it owns no server file.
    id, slug: id, storage: 'device', carried: true,
    name, tagline: str(src.tagline, 300), industry: str(src.industry, 120), website: str(src.website, 300),
    // https only: a generated email references this URL as-is, so a blob:,
    // data: or http: value is dropped here rather than embedded (2026-10-04).
    logo_url: httpsUrl(src.logo_url),
    // What the browser holds as an uploaded FILE that has no hosted URL yet -
    // an enum list, never the bytes. Generators print the hosted-URL marker
    // for each (hostedMarker()).
    pending_hosting: list(src.pending_hosting, 4, 12).filter((k) => PENDING_KINDS.includes(k)),
    palette, typography, voice: {
      tone: str(voice.tone, 300), preferred: list(voice.preferred, 40, 60), banned: list(voice.banned, 60, 80),
      no_em_dashes: voice.no_em_dashes !== false,
    },
    regions, claims: list(src.claims, 40, 300), offerings: records(src.offerings, 40, 10), competitors: records(src.competitors, 40, 8),
    // The sender identity a commercial email must carry (CAN-SPAM). It was
    // dropped here, so every device brand's mailer footer printed the marker
    // even when the record held its legal entity (2026-10-10).
    legal_entity: str(src.legal_entity || obj(src.brand_data).legal_entity, 300),
    // A device brand's catalogue is not on the server either, and nothing
    // here may reach the shipped files: the slug above is what the gate reads.
    catalog_source: catalogSource,
  };
}

/** The shipped brand. Never null — generators must always have something. */
function defaultBrand() {
  return brandCore.DEFAULT_BRAND || {
    name: 'this brand', palette: {}, typography: {}, voice: {}, regions: [],
  };
}

/**
 * Resolve the brand for this request. Never throws and never blocks a
 * generation: any failure falls back to tenant zero, because a brand lookup
 * problem must not take the whole app down.
 */
async function resolve(req, opts) {
  const o = opts || {};
  // Set once a PERSON is known to be asking. From then on no failure answers
  // tenant zero (2026-10-10): a signed-in account with no workspace, a row it
  // could not read and a lookup that threw all used to fall to defaultBrand(),
  // and every caller that took resolve() at its word (generate.js, the
  // landing-page agent, the mailer trigger, the image route, growth-os, the
  // pipeline) then wrote that person's asset as tenant zero. Only a call with
  // no verified person (the scheduler, a script) keeps the shipped default.
  let person = false;
  try {
    const q = (req && req.query) || {};
    const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
    const explicit = String(o.workspace_id || body.workspace_id || q.workspace_id || '');

    const auth = o.auth || await brandCore.requireUser(req);
    if (!auth || !auth.ok) return defaultBrand();
    person = true;

    // A MOBILE+PIN ACCOUNT HAS NO WORKSPACE ROW (2026-09-29). Its brands live
    // on the device it signed in on, so there is nothing here to look up -
    // and `activeWorkspaceId()` used to THROW for it (restAs refuses a phone
    // token), land in the catch below and hand back tenant zero. Every agent a
    // phone account reached then wrote as another company. Two honest answers
    // exist: the record the page CARRIED with the request (the device brand,
    // used for this request and stored nowhere), or the unresolved placeholder
    // whose every field is a DATA REQUIRED marker. Tenant zero is neither.
    // A phone account IN SUPABASE AUTH (mode 'supabase', 2026-10-03) has a
    // workspace row like any account, so it is resolved below through RLS.
    if (auth.provider === 'mobile-pin' && auth.mode !== 'supabase') return carriedBrand(body, auth) || unresolvedBrand('mobile-number account: the brand record is saved on the device, and this request did not carry it');

    // Resolve WHICH workspace first, then cache the workspace row against that
    // id. Caching against `<user>|<explicit>` instead would key every implicit
    // request as `<user>|`, so for the whole TTL after someone switched their
    // active brand they would keep generating with the previous brand's rules.
    // Existing generator clients send no workspace_id, so that is the common
    // path, not an edge case. The preference lookup is one cheap indexed read.
    const id = explicit || await brandCore.activeWorkspaceId(auth);
    if (!id) return unresolvedBrand('a signed-in account with no brand workspace');

    const key = `${auth.user_id}|${id}`;
    const hit = CACHE.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.brand;

    // Read with the CALLER'S token, so RLS decides whether they may use it.
    const ws = await brandCore.getWorkspace(auth, id);
    // Normalise BEFORE caching, so every consumer of the cached row sees the
    // same shape and the hoist cost is paid once per TTL rather than per read.
    if (!ws) return unresolvedBrand('the brand workspace could not be read for this account');
    const brand = normalizeBrand(ws);
    // Whether THIS workspace owns tenant zero's shipped material is the
    // server's determination (the oldest workspace), stamped on the record so
    // brand-catalog-server.isTenantZeroBrand() never reads it off the slug,
    // which the workspace's owner wrote (2026-10-05).
    if (ws && brand && brand.id) {
      try { brand.owns_shipped = await brandCore.ownsShipped(brand.id); } catch (_) { brand.owns_shipped = false; }
    }
    CACHE.set(key, { brand, at: Date.now() });
    return brand;
  } catch (_) {
    return person ? unresolvedBrand('the brand workspace could not be read for this account') : defaultBrand();
  }
}

/**
 * Drop cached brand records after a write.
 *
 * The cache is keyed `<user>|<workspace>`, so a save or an activate has to
 * invalidate by workspace across every user who shares it. Without this, a
 * brand that was just saved kept generating from the PREVIOUS palette, voice
 * and claims for the rest of the TTL, and a brand switch kept using the old
 * brand for the same window. Both are stale reads that look like correct
 * output, which is the hardest kind to notice.
 *
 * Called with no id it clears everything, which is what a delete needs.
 */
function invalidate(workspaceId) {
  const id = workspaceId ? String(workspaceId) : '';
  if (!id) { CACHE.clear(); return; }
  for (const key of Array.from(CACHE.keys())) {
    if (key.slice(key.indexOf('|') + 1) === id) CACHE.delete(key);
  }
}

function missing(field, region) {
  return `[DATA REQUIRED BEFORE LAUNCH: ${field}, all, ${region || 'all'}]`;
}

function paletteLine(p) {
  const named = [
    ['primary', 'primary'], ['accent', 'accent'], ['ink', 'text'],
    ['surface', 'page surface'], ['surface_alt', 'card surface'],
  ].filter(([k]) => p && p[k]).map(([k, label]) => `${p[k]} ${label}`);
  if (!named.length) return missing('brand palette');
  const extra = Array.isArray(p.extra) ? p.extra.map((e) => `${e.hex} ${e.name}`) : [];
  return named.concat(extra).join(' · ');
}

function typographyLine(t) {
  const h = t && t.heading, b = t && t.body;
  if (!h && !b) return missing('brand typography');
  const parts = [];
  if (h && h.family) parts.push(`Headings = ${h.stack || `'${h.family}'`}`);
  else parts.push(`Headings = ${missing('typography.heading')}`);
  if (b && b.family) parts.push(`Body = ${b.stack || `'${b.family}'`}`);
  else parts.push(`Body = ${missing('typography.body')}`);
  return parts.join('. ');
}

/**
 * The CSS that loads the brand's fonts in a generated page or email: a Google
 * Fonts @import for Google families, and an @font-face for a self-hosted family
 * whose FILE the record names (typography[slot].src, an https URL - uploaded to
 * the brand's storage, or a URL the operator pasted; 2026-10-04). Without the
 * second, a family the brand serves itself reached every asset by name only and
 * rendered in the fallback. One place, so every renderer loads fonts the same
 * way: design-system.resolve() adds fontFaces() to the faces it read off the
 * rendered site, so the /lp page and every email built from it carry them too.
 */
const FONT_FMT = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', truetype: 'truetype', otf: 'opentype', opentype: 'opentype' };
function fontFaces(t) {
  const faces = [];
  for (const slot of ['heading', 'body']) {
    const f = t && t[slot];
    if (!f || !f.family || f.google !== false) continue;
    if (!/^https:\/\/[^\s"'()<>\\]+$/i.test(String(f.src || ''))) continue;
    const fam = String(f.family).replace(/['"\\<>{};]/g, '').trim();
    const fmt = FONT_FMT[String(f.format || '').toLowerCase()];
    const face = `@font-face{font-family:'${fam}';src:url('${f.src}')${fmt ? ` format('${fmt}')` : ''};font-display:swap}`;
    if (fam && !faces.includes(face)) faces.push(face);
  }
  return faces.join('');
}
function fontImport(t) {
  const fams = [];
  for (const slot of ['heading', 'body']) {
    const f = t && t[slot];
    if (f && f.family && f.google !== false) {
      fams.push(`family=${String(f.family).trim().replace(/\s+/g, '+')}:wght@${String(f.weights || '400;600;700').replace(/[^0-9;]/g, '')}`);
    }
  }
  const imp = fams.length ? `@import url('https://fonts.googleapis.com/css2?${fams.join('&')}&display=swap');` : '';
  return imp + fontFaces(t);
}

/**
 * The brand's HOME market: the region its own record flags `home: true`, else
 * the region the record leads with, else '' — never a literal.
 *
 * Every "slot with no market" used to fall to 'US', so a brand whose record
 * said IN, and only IN, still had its default campaign, export row, landing
 * page and assistant turn built for a market it does not serve. The empty
 * string is deliberate for a brand with no regions at all: a caller that needs
 * a market then has a gap to report, not a market to invent.
 */
function homeRegion(brand) {
  const list = (brand && Array.isArray(brand.regions)) ? brand.regions.filter((r) => r && r.code) : [];
  const flagged = list.find((r) => r.home === true);
  const pick = flagged || list[0];
  return pick ? String(pick.code).toUpperCase() : '';
}

function regionLines(regions) {
  const list = Array.isArray(regions) ? regions.filter((r) => r && r.code) : [];
  if (!list.length) return missing('regions and store URLs');
  const home = homeRegion({ regions: list });
  return list.map((r) =>
    `${r.code}${String(r.code).toUpperCase() === home ? ' (HOME market)' : ''}: store ${r.store_url || missing('region store URL', r.code)}` +
    `${r.currency ? ` · ${r.currency}` : ''}${r.symbol ? ` (${r.symbol})` : ''}`
  ).join(' | ');
}

/**
 * The brand constraint block, built from THIS brand. Same shape as the block in
 * master-prompt.js so every prompt site can swap one for the other.
 */
function brandBlock(brand) {
  const b = brand || defaultBrand();
  const v = b.voice || {};
  const p = b.palette || {};
  const t = b.typography || {};

  const lines = [];
  lines.push(`BRAND: ${b.name || missing('brand name')}${b.tagline ? ` — ${b.tagline}` : ''}${b.industry ? ` (${b.industry})` : ''}.`);
  if (b.website) lines.push(`WEBSITE: ${b.website}`);
  lines.push(`VOICE: ${v.tone || missing('voice.tone')}.${v.notes ? ` ${v.notes}` : ''}`);
  lines.push(`PALETTE (use ONLY these): ${paletteLine(p)}.`);
  lines.push('CONTRAST (strict): every text/background pairing must reach WCAG AA (4.5:1). Never place dark text on a dark ground or light text on a light ground. Never use a black or dark-neutral section background; use the brand primary where a dark ground is wanted.');
  lines.push(`TYPOGRAPHY (strict): ${typographyLine(t)}. Never introduce another family.`);
  const imp = fontImport(t);
  if (imp) lines.push(`For any HTML asset, inject this EXACT import into the <head> <style> before app rules:\n  ${imp}`);
  const pend = Array.isArray(b.pending_hosting) ? b.pending_hosting : [];
  const logo = httpsUrl(b.logo_url);
  lines.push(`LOGO (header, exact — never substitute): ${logo ? `<img src="${logo}" alt="${b.name || 'brand'}" /> at a restrained header height (~30px).`
    : pend.includes('logo') ? `${hostedMarker('logo', b)} - the logo exists only as an uploaded file on the operator's device. Write this marker where the logo goes; never embed an image as data:/base64 and never invent a URL.`
      : missing('logo URL')}`);
  if (pend.includes('font')) lines.push(`FONT FILES: ${hostedMarker('font', b)} - a brand font was uploaded as a file and has no hosted URL yet. Use the family name with its fallback stack; never embed the font as data:/base64.`);
  if (pend.includes('image')) lines.push(`BRAND IMAGERY: ${hostedMarker('image', b)} - uploaded brand images are not hosted yet. Never embed an image as data:/base64.`);
  lines.push('FOOTER: "Privacy Policy" and "Terms of Service" must be plain labels with href="#" and no target/onclick routing.');
  // The sender a commercial email must name (CAN-SPAM), from THIS record
  // (2026-10-10). The block never carried it, so a writer asked for a footer
  // had nothing of the brand's to put there.
  const legal = String(b.legal_entity || b.legal_name || '').trim();
  lines.push(`LEGAL SENDER (email footer, exact): ${legal || `[DATA REQUIRED BEFORE LAUNCH: legal sender name and postal address, ${b.name || 'this brand'}]`}`);
  // The block forbids fabricating a claim but never said what this brand may
  // actually assert, so a generator had nothing approved to reach for and every
  // proof line came out as a DATA REQUIRED marker even when the brand had
  // supplied claims. These are the only ones any asset may state as fact.
  const claims = Array.isArray(b.claims) ? b.claims.filter(Boolean) : [];
  lines.push(claims.length
    ? `VERIFIABLE CLAIMS (the ONLY statements that may be presented as fact; never assert anything else): ${claims.map((c) => `"${c}"`).join(' · ')}.`
    : `VERIFIABLE CLAIMS: ${missing('verifiable claims')}. Until they are supplied, write no proof, guarantee or credential line at all.`);
  if (Array.isArray(v.preferred) && v.preferred.length) lines.push(`PREFERRED words: ${v.preferred.join(', ')}.`);
  if (Array.isArray(v.banned) && v.banned.length) lines.push(`BANNED phrases (never use): ${v.banned.map((s) => `"${s}"`).join(', ')}.`);
  if (v.no_em_dashes !== false) lines.push('Never use em dashes or en dashes anywhere in output copy. Use commas, colons or plain hyphens.');
  lines.push(`REGIONS: ${regionLines(b.regions)}`);
  lines.push('NEVER: off-palette tints, fabricated product facts, prices, URLs, reviews, ratings, reviewer names, statistics or filenames. If a fact you need was not supplied, write [DATA REQUIRED BEFORE LAUNCH: field, product, region] in its place instead of inventing one.');

  return lines.join('\n');
}

/** Region facts for this brand, falling back to the shipped map. */
function regionFacts(brand, market) {
  const code = String(market || '').toUpperCase();
  const list = (brand && Array.isArray(brand.regions)) ? brand.regions : [];
  // No match (or no market asked for) falls to the brand's HOME market, which
  // is the region it declared, not merely the one listed first.
  const home = homeRegion(brand);
  const hit = list.find((r) => String(r.code).toUpperCase() === code)
    || list.find((r) => String(r.code).toUpperCase() === home) || list[0];
  if (hit) {
    return {
      store: (hit.store_url || '').replace(/^https?:\/\//, ''),
      presell: (hit.store_url || '').replace(/^https?:\/\//, ''),
      currency: hit.symbol || (hit.currency === 'GBP' ? '£' : hit.currency === 'EUR' ? '€' : hit.currency === 'INR' ? '₹' : '$'),
      locale: 'en',
      code: hit.code,
    };
  }
  return null;
}

/**
 * Brand-aware banned-phrase scrubber. scenario-model.sanitizeBrand enforces
 * tenant zero's list; this additionally strips whatever THIS brand banned.
 * Returns the string unchanged when the brand declared no banned phrases.
 */
function scrubForBrand(str, brand) {
  const v = (brand && brand.voice) || {};
  let s = String(str == null ? '' : str);
  if (v.no_em_dashes !== false) s = s.replace(/[—–]/g, ', ');
  const banned = Array.isArray(v.banned) ? v.banned.filter(Boolean) : [];
  if (!banned.length) return s;
  // Drop the offending phrase and tidy the seam, rather than leaving it in.
  // The prompt already forbids these; this is the last-resort net, so it aims
  // for "readable without the phrase", not for a clever substitution it might
  // get wrong. Leading conjunctions and doubled punctuation are cleaned up.
  for (const phrase of banned) {
    try {
      const rx = new RegExp(String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      s = s.replace(rx, '');
    } catch (_) { /* a phrase that will not compile is skipped, not fatal */ }
  }
  return s
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([.,;:!?])\1+/g, '$1')
    .replace(/(^|[.!?]\s+)(is|a|an|the|and|but)\b[,\s]+/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The same banned-phrase net, for a whole HTML DOCUMENT.
 *
 * scrubForBrand is a PROSE normaliser: it finishes by collapsing every
 * whitespace run to a single space so a sentence reads cleanly once a phrase is
 * cut out. Run that over a document and it collapses newlines too, which turns
 *
 *     // set up the pointer parallax
 *     startInteractions();
 *
 * into one line where the call sits inside the comment. The page still renders,
 * still validates, and quietly does nothing when the user moves the pointer.
 * Whitespace also carries meaning inside <pre> and <textarea>.
 *
 * So this variant removes the phrases and stops. It tidies only the horizontal
 * run left behind by the excision, and never touches a line terminator.
 */
function scrubHtmlForBrand(html, brand) {
  const v = (brand && brand.voice) || {};
  let s = String(html == null ? '' : html);
  if (v.no_em_dashes !== false) s = s.replace(/[—–]/g, ', ');
  const banned = Array.isArray(v.banned) ? v.banned.filter(Boolean) : [];
  if (!banned.length) return s;
  for (const phrase of banned) {
    try {
      const rx = new RegExp(String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      s = s.replace(rx, '');
    } catch (_) { /* a phrase that will not compile is skipped, not fatal */ }
  }
  // Horizontal whitespace only: [^\S\r\n] is "space-like but not a newline".
  return s.replace(/[^\S\r\n]{2,}/g, ' ');
}

/* ── one brand's facts, for a renderer or a prompt (2026-10-10) ─────────────
 *
 * Every renderer and prompt builder used to carry its own fallback for a brand
 * that had not supplied a value, and nearly every one of those fallbacks was
 * TENANT ZERO's value: its two font stacks, its four hexes, its banned list.
 * A brand with no typography got another company's typefaces and looked
 * finished. These are the one place a fallback is decided, and none of them
 * is anybody's brand: a generic system stack, a neutral palette that passes
 * the design rules, and a DATA REQUIRED marker wherever a PROMPT would state
 * the fact.
 */
const NEUTRAL_FONTS = Object.freeze({
  head: "Georgia,'Times New Roman',serif",
  body: "system-ui,-apple-system,'Segoe UI',Arial,sans-serif",
});
// Not a brand colour: a mid blue chosen to pass the section-ground and AA
// rules with white text, used only where a record has no palette at all.
const NEUTRAL_PALETTE = Object.freeze({
  primary: '#2B4C7E', accent: '#2B4C7E', ink: '#1F2328', surface: '#FFFFFF', surface_alt: '#F6F7F9', line: '#E3E6EA', muted: '#5B6470',
});

function familyOf(slot) {
  if (!slot) return '';
  if (typeof slot === 'string') return slot.replace(/['"\\<>;{}]/g, '').split(',')[0].trim();
  return String(slot.family || '').replace(/['"\\<>;{}]/g, '').trim();
}
function stackOfSlot(slot, generic) {
  if (!slot) return '';
  const own = typeof slot === 'object' ? String(slot.stack || '').trim() : '';
  const fam = familyOf(slot);
  const s = own || (fam ? `'${fam}'` : '');
  if (!s) return '';
  return /(?:^|,)\s*(?:serif|sans-serif|monospace|system-ui|cursive)\s*$/i.test(s) ? s : `${s},${generic}`;
}

/** The brand's own heading/body stacks, else a generic system stack - never another brand's family. */
function fontStacks(brand) {
  const t = (brand && brand.typography) || {};
  const head = stackOfSlot(t.heading, 'Georgia,serif');
  const body = stackOfSlot(t.body, 'Arial,sans-serif');
  return {
    head: head || body || NEUTRAL_FONTS.head,
    body: body || head || NEUTRAL_FONTS.body,
    headFamily: familyOf(t.heading), bodyFamily: familyOf(t.body),
    declared: { head: !!head, body: !!body },
  };
}

/** The brand's palette over the neutral one: a missing key is neutral, never another brand's hex. */
function paletteOf(brand) {
  const p = (brand && brand.palette) || {};
  const out = Object.assign({}, NEUTRAL_PALETTE);
  for (const k of Object.keys(p)) if (typeof p[k] === 'string' && /^#[0-9a-f]{3,8}$/i.test(p[k].trim())) out[k] = p[k].trim();
  if (!p.accent && p.primary) out.accent = out.primary;
  out.declared = !!(p.primary || p.accent);
  return out;
}

/**
 * The facts a PROMPT states about this brand, each its own value or a marker.
 * One derivation for every prompt builder, so no builder can keep a private
 * copy of tenant zero's identity paragraph.
 */
function promptFacts(brand) {
  const b = brand || {};
  const tag = b.name || 'this brand';
  const v = b.voice || {};
  const fonts = fontStacks(b);
  const pal = b.palette || {};
  const hexes = ['primary', 'accent', 'ink', 'surface'].map((k) => pal[k]).filter(Boolean);
  return {
    name: b.name || missing('brand name'),
    descriptor: [b.industry, b.tagline].filter(Boolean).join(' - ') || `[DATA REQUIRED BEFORE LAUNCH: brand descriptor, ${tag}]`,
    palette: hexes.length ? hexes.join(' / ') : `[DATA REQUIRED BEFORE LAUNCH: brand palette, ${tag}]`,
    typography: (fonts.declared.head || fonts.declared.body)
      ? `${fonts.headFamily || fonts.bodyFamily} (headings), ${fonts.bodyFamily || fonts.headFamily} (body)`
      : `[DATA REQUIRED BEFORE LAUNCH: brand typography, ${tag}]`,
    tone: v.tone || `[DATA REQUIRED BEFORE LAUNCH: voice.tone, ${tag}]`,
    preferred: Array.isArray(v.preferred) ? v.preferred.filter(Boolean) : [],
    banned: Array.isArray(v.banned) ? v.banned.filter(Boolean) : [],
    claims: Array.isArray(b.claims) ? b.claims.filter(Boolean) : [],
    legal: b.legal_entity || b.legal_name || '',
    home: homeRegion(b),
  };
}

module.exports = {
  NEUTRAL_FONTS, NEUTRAL_PALETTE, fontStacks, paletteOf, promptFacts, namesBrand,
  scopedBrand, unresolvedBrand, isUnresolved, carriedBrand,
  resolve, brandBlock, regionFacts, homeRegion, scrubForBrand, scrubHtmlForBrand,
  defaultBrand, isDefault, normalizeBrand, invalidate, HOISTED,
  httpsUrl, pendingHostingOf, hostedMarker,
  // The font import the brand block already prints, for a renderer that has to
  // put the SAME line into a <style> (pipeline-core.tokens): one derivation,
  // not two that drift.
  fontImport,
  fontFaces,
};
