'use strict';
/**
 * brand-workspace-core.js — the multi-tenant brand layer of the platform.
 * ---------------------------------------------------------------------------
 * This is what turns a single-brand Lifecycle OS into a UNIVERSAL brand
 * marketing lifecycle platform: every logged-in user onboards their own brands
 * (identity + colour schema + typography + voice guardrails + regions +
 * catalog), picks one ACTIVE workspace, and the whole app — shell palette,
 * fonts, name, nav, and every generator — runs as that brand.
 *
 * NOT a function file (lives under api/_shared/ → excluded from the Hobby
 * 12-serverless-function cap). Routed from api/public-config.js ?action=brand.
 *
 * Zero-fabrication contract (docs/campaign-orchestration-master-spec.md):
 *   * Nothing is ever invented. Every stored value came from the operator or
 *     from a source they pointed at, and catalog rows keep `source` + `raw`.
 *   * Missing data is REPORTED, never filled: readiness() emits
 *       [DATA REQUIRED BEFORE LAUNCH: <field>, <product>, <region>]
 *   * Design HARD rules are enforced at save time, not at render time:
 *     no dark-neutral page surface, WCAG-AA contrast on every text/background
 *     pairing the shell will actually use.
 *
 * Auth model: any authenticated Supabase user may own workspaces (this is a
 * platform, not the single-tenant operator console), so this module does NOT
 * use data-analysis-core's `@knickgasm.com` domain gate. Reads/writes go
 * through PostgREST with the CALLER'S JWT so the RLS policies in
 * supabase/migrations/20260809120000_brand_workspaces.sql are the authority.
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const coherence = require('./brand-coherence.js');

const MAX_CATALOG_ROWS = 5000;      // per import, keeps a serverless call bounded
const MAX_UPLOAD_CHARS = 6e6;       // ~6MB of pasted/uploaded text

/* ── env ──────────────────────────────────────────────────────────────────── */

function env() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !(anon || service)) throw new Error('SUPABASE_URL or SUPABASE_*_KEY missing');
  return { url: String(url).replace(/\/$/, ''), anon: anon || service, service: service || '' };
}

function bearer(req) {
  const h = String((req && req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : '';
}

/**
 * Verify the caller is a signed-in Supabase user. No domain allowlist.
 *
 * ── AN ERROR CODE IS NOT AN ERROR MESSAGE ──────────────────────────────────
 * Every refusal here carries a `message`: a sentence naming the cause and what
 * the reader can do about it. It used to carry only `error` (a machine code)
 * plus a `hint`/`detail` aimed at whoever was calling the API — so the browser,
 * which surfaces whatever it is given, printed `session_verification_unavailable`
 * into the middle of the onboarding wizard as the entire explanation of why
 * reading a brand's own website had failed. The code is still there for code to
 * branch on; the sentence is there for the person reading the screen.
 *
 * ── "NOT SIGNED IN" AND "NO BACKEND TO SIGN IN TO" ARE DIFFERENT ───────────
 * `backend_unreachable` on the result separates them, and callers use it to
 * decide whether this gate is protecting anything at all:
 *
 *   sign_in_required / invalid_session          the backend ANSWERED and said
 *                                               no. There is a session to be
 *                                               had and this caller lacks it.
 *   supabase_not_configured / …_unavailable     the backend could not be
 *                                               reached, so there is no session
 *                                               ANYONE could present.
 *
 * That distinction is already computed here - it is the difference between a
 * response and a thrown fetch - and it was being flattened into one 503.
 *
 * ── ONE VERIFICATION PER REQUEST (2026-09-29) ─────────────────────────────
 * The answer is memoised on the request object. A brain.js request now asks
 * it up to four times - the attribution rule (is this token real, or only
 * present?), the credit meter, the brand resolve and a handler's own gate -
 * and each ask used to be a round trip to the session store. One request is
 * one caller: the token cannot change between the asks, so neither can the
 * answer.
 */
const AUTH_MEMO = new WeakMap();
function requireUser(req) {
  if (!req || typeof req !== 'object') return verifyCaller(req);
  const hit = AUTH_MEMO.get(req);
  if (hit) return hit;
  const p = verifyCaller(req);
  AUTH_MEMO.set(req, p);
  return p;
}

async function verifyCaller(req) {
  // ── GOOGLE IS THE ONLY SIGN-IN (2026-10-10) ─────────────────────────────────
  // The mobile number + PIN sign-in is switched off. A token of its shape (43
  // base64url characters, no dots - a Supabase JWT has two) is refused here
  // EXACTLY like no token at all: the same 401 sign_in_required, decided
  // before any lookup, so a Neon session, a leftover device session (the
  // `mode:'device'` principal of 2026-09-30) and a forgery are one answer.
  // Nothing downstream can see `provider:'mobile-pin'` or `mode:'device'` any
  // more; the branches that keyed on them are the signed-out branches now.
  const mobile = require('./mobile-auth-core.js');
  const own = mobile.tokenOf(req);
  if (own && mobile.looksLikeToken(own)) {
    return {
      ok: false, status: 401, error: 'sign_in_required',
      message: 'You are not signed in, so this could not run. Sign-in is with Google now; '
        + 'a mobile-number sign-in is no longer accepted. Sign in with Google and try again.',
      hint: 'Send Authorization: Bearer <Supabase access token> from a Google sign-in.',
      mobile_reason: 'pin_signin_removed',
    };
  }

  const token = bearer(req);
  if (!token) {
    return {
      ok: false, status: 401, error: 'sign_in_required',
      message: 'You are not signed in, so this could not be saved to your account.',
      hint: 'Send Authorization: Bearer <Supabase access token> from a Google sign-in.',
    };
  }
  let e;
  try { e = env(); } catch (err) {
    return {
      ok: false, status: 503, error: 'supabase_not_configured', backend_unreachable: true,
      message: 'This deployment has no database configured, so there is no account to sign in to.',
      detail: err.message,
    };
  }
  try {
    const r = await fetch(`${e.url}/auth/v1/user`, {
      headers: { apikey: e.anon, authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!r.ok) {
      return {
        ok: false, status: 401, error: 'invalid_session',
        message: 'Your sign-in has expired. Sign in again and retry.',
      };
    }
    const user = await r.json();
    if (!user || !user.id) {
      return {
        ok: false, status: 401, error: 'invalid_session',
        message: 'Your sign-in has expired. Sign in again and retry.',
      };
    }
    // WHO MAY BE A PRINCIPAL (2026-10-10). Sign-in is Google, so a Google
    // account is; an account the project holds by email (made by an operator
    // in the dashboard; public sign-ups are off) is, as it always was. Two are
    // NOT, read from the record GoTrue returns for the token (app_metadata,
    // which only the service role writes, and identities) - never from the
    // request: a phone account the PIN broker made (the switched-off sign-in;
    // its refresh tokens still work against GoTrue until they are revoked or
    // the users removed), and any other OAuth provider a dashboard switch
    // might turn on. Both get the anonymous refusal.
    const supaAuth = require('./mobile-auth-supabase.js');
    const oauth = supaAuth.oauthProvider(user);
    if (supaAuth.phoneIdentity(user) || (oauth && oauth !== 'google')) {
      return {
        ok: false, status: 401, error: 'sign_in_required',
        provider_refused: oauth || 'phone',
        message: 'You are not signed in, so this could not run. Sign-in is with Google; '
          + (oauth && oauth !== 'google' ? 'a ' + oauth + ' sign-in' : 'a mobile-number sign-in') + ' is not accepted. Sign in with Google and try again.',
      };
    }
    return { ok: true, token, user_id: user.id, email: String(user.email || '').toLowerCase(), mode: 'supabase' };
  } catch (err) {
    return {
      ok: false, status: 503, error: 'session_verification_unavailable', backend_unreachable: true,
      message: `The database this deployment points at (${hostOfUrl(e.url)}) is not answering, so sign-in cannot be checked. `
        + 'Its Supabase project has most likely been deleted, renamed or paused.',
      detail: err.message,
    };
  }
}

/** The host an operator has to change, printed rather than the whole URL. */
function hostOfUrl(u) {
  try { return new URL(u).hostname; } catch (_) { return String(u || 'the configured host'); }
}

/** PostgREST call made AS THE CALLER, so RLS decides what they can touch. */
async function restAs(token, pathAndQuery, { method = 'GET', body, prefer } = {}) {
  // ONE DOOR. Every read or write made "as the caller" comes through here, so
  // this is where a mobile+PIN account (2026-09-28) learns it has no Supabase
  // identity: RLS is keyed on auth.uid(), and a Neon account has none. Without
  // this, every such call answered with PostgREST's bare 401 - a sentence about
  // an expired sign-in for a person who signed in a moment ago.
  if (require('./mobile-auth-core.js').looksLikeToken(String(token || ''))) {
    const err = new Error('This is kept in the database beside an email account, and a mobile-number account has no record there. '
      + 'Brands, catalogues and connections for a mobile-number sign-in are saved on the device it signed in on.');
    err.status = 403;
    err.code = 'account_type_unsupported';
    throw err;
  }
  const e = env();
  const headers = { apikey: e.anon, authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${e.url}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store',
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!res.ok) {
    const msg = (json && (json.message || json.hint)) || text || res.statusText;
    const err = new Error(`supabase ${method} ${pathAndQuery} -> ${res.status}: ${msg}`);
    err.status = res.status === 401 || res.status === 403 ? res.status : 502;
    throw err;
  }
  return json;
}

/* ── colour maths (WCAG) ──────────────────────────────────────────────────── */

const HEX_RX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normHex(v) {
  let s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (!s.startsWith('#')) s = '#' + s;
  if (!HEX_RX.test(s)) return '';
  if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return s.toLowerCase();
}

function rgb(hex) {
  const h = normHex(hex) || '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function luminance(hex) {
  const chan = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

/** WCAG contrast ratio, 1..21. */
function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

function saturation(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const l = (mx + mn) / 2;
  return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
}

/** The spec's design HARD rule: no black / near-black / dark-neutral surfaces. */
function isDarkNeutral(hex) {
  const h = normHex(hex);
  if (!h) return false;
  return luminance(h) < 0.12 && saturation(h) < 0.25;
}

/** Mix `hex` toward white (t>0) or black (t<0) — used to derive shell tints. */
function shade(hex, t) {
  const target = t >= 0 ? 255 : 0;
  const amt = Math.abs(t);
  const out = rgb(hex).map((v) => Math.round(v + (target - v) * amt));
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Pick whichever of the brand's own text-capable colours reads best on `bg`.
 * Candidates are the ink, the PAGE surface and the card surface - all palette
 * colours the shell already renders text in. Excluding the page surface was a
 * real defect: a brand whose primary passes AA against its white page (a
 * symmetric pairing the validator itself reports) was still blocked because
 * only ink and the slightly-grey card colour were tried as button text.
 */
function readableOn(bg, ink, surface, surfaceAlt) {
  const candidates = [ink || '#111111', surface || '#ffffff', surfaceAlt]
    .filter(Boolean)
    .filter((c, i, a) => a.indexOf(c) === i);
  let best = candidates[0], bestC = -1;
  for (const c of candidates) {
    const r = contrast(bg, c);
    if (r > bestC) { bestC = r; best = c; }
  }
  return best;
}

/**
 * The first candidate that is ALLOWED to be a section ground.
 *
 * "Never black / #111111 / dark-neutral section backgrounds" is one of the
 * design HARD rules, and validatePalette() has enforced it on the page surface
 * since the beginning. It reached the ASSET renderers only as prose inside a
 * prompt, and they broke it three ways: a mailer colorway painting its hero
 * band with the INK token, a landing-page footer and a video letterbox doing
 * the same, and - the one no source sweep catches - a last-resort literal.
 * `pal.primary || '#111111'` renders a black email for any brand record that
 * has no palette yet.
 *
 * A deep BRAND colour is a legitimate dark ground; a near-neutral is not, which
 * is the distinction isDarkNeutral() already draws for the surface.
 *
 * This is for SECTIONS - bands, footers, page and stage grounds - which is what
 * the rule says and what validatePalette() gates (the surface, not the primary).
 * A BUTTON is a control, not a section: a brand whose accent is near-black gets
 * a black button, the same as it would on its own site, and what matters there
 * is that textOn() keeps the label readable. Gating a control here produced a
 * white button on a white page.
 *
 * Callers should end the chain with the brand's OWN surface. A literal from
 * some other brand's palette as the last resort is how one tenant's colour ends
 * up on another tenant's page.
 */
function sectionGround(...candidates) {
  for (const c of candidates) {
    const h = normHex(c);
    if (h && !isDarkNeutral(h)) return c;
  }
  return '#ffffff';
}

/**
 * Text that sits ON a brand colour, derived rather than assumed.
 *
 * Picked by eye, this is where the sub-AA pairings come from: ink on the accent
 * is 2.77:1 for tenant zero, and the accent on the primary is 1.51:1 - two
 * brand colours of similar weight reading as a smudge.
 *
 * readableOn() picks whichever of the brand's OWN text colours reads better on
 * the ground, so a light band gets the ink and a dark one gets the surface -
 * starting from the surface alone put ink-coloured text nowhere and near-white
 * text on a near-white fallback ground. readableAsText() then guarantees the
 * target, moving the chosen colour only as far as AA needs.
 */
function textOn(ground, surface, ink, target) {
  const want = target || 4.5;
  const start = readableOn(ground, ink || '#111111', surface || '#ffffff');
  const first = readableAsText(start, ground, want);
  if (contrast(first, ground) >= want) return first;
  // readableAsText() walks ONE way - away from a light ground, toward white on
  // a darker one - so on a MID-TONE ground (luminance just under 0.5, a
  // saturated magenta, a khaki) it walked a dark ink toward white and returned
  // a failing white. A seeded sweep of 4,000 valid palettes found 947 such
  // band pairings (tests/design-system.spec.js). Walk both ways and keep the
  // passing colour nearest the brand's own; on a ground where nothing reaches
  // `want` (the best a mid-tone allows is ~4.58:1) hold the 4.5 floor instead.
  return textBothWays(start, ground, want) || textBothWays(start, ground, Math.min(want, 4.5)) || first;
}

/** The nearest shade of `start`, darker or lighter, that clears `want` on `ground`. */
function textBothWays(start, ground, want) {
  const c = normHex(start) || '#111111';
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    for (const dir of [-1, 1]) {
      const cand = shade(c, dir * t);
      if (contrast(cand, ground) >= want) return cand;
    }
  }
  return '';
}

/**
 * The colour as TEXT on every one of `grounds`: readableAsText() against each
 * in turn, twice, so a step taken for one ground is re-checked on the others.
 * On light grounds every step darkens, so the result clears the target on all
 * of them; it is unchanged when it already does.
 */
function readableOnSurfaces(color, grounds, target) {
  let c = color;
  const gs = (grounds || []).filter(Boolean);
  for (let pass = 0; pass < 2; pass++) for (const g of gs) c = readableAsText(c, g, target);
  return c;
}

/**
 * The brand colour, darkened (or lightened) until it is READABLE AS TEXT on
 * `bg`.
 *
 * readableOn() answers the opposite question - what to write ON a brand-colour
 * fill - and there was no answer for the far more common case: the brand colour
 * used AS a text colour on the page. Pages write `color: var(--brand-primary)`
 * for a badge, a link, an active step, a stat; that is legible only while the
 * brand's primary happens to be dark. Onboard a brand with a light primary and
 * those elements render correctly and invisibly. That is exactly what happened
 * to the "ACTIVE" badge on the brand list and the completed steps in the
 * onboarding wizard: white-on-white, perfectly laid out, unreadable.
 *
 * The hue is preserved and only the lightness moves, so the result still reads
 * as the brand's colour rather than as a generic dark grey. It walks toward the
 * far end in small steps and stops at the first that clears the target, so a
 * colour that already passes is returned untouched.
 *
 * `target` is 4.5 for body text (WCAG AA). Large or bold text can use 3.0, but
 * the callers here cannot know the type size, so the stricter bar is the safe
 * default.
 */
function readableAsText(color, bg, target) {
  const want = target || 4.5;
  const c = normHex(color);
  const surface = normHex(bg) || '#ffffff';
  if (!c) return '#111111';
  if (contrast(c, surface) >= want) return c;

  // Move AWAY from the background: darken on a light surface, lighten on a
  // dark one. Going the wrong way can never reach the target.
  const dir = luminance(surface) > 0.5 ? -1 : 1;
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const candidate = shade(c, dir * t);
    if (contrast(candidate, surface) >= want) return candidate;
  }
  // Unreachable in practice - pure black or white always clears 4.5 against a
  // surface the palette validator has already accepted - but never return a
  // colour that fails.
  return dir < 0 ? '#000000' : '#ffffff';
}

/* ── brand normalisation ──────────────────────────────────────────────────── */

const DEFAULT_BRAND = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'brands', '_default.json'), 'utf8')); }
  catch (_) { return null; }
})();

function slugify(v) {
  return String(v == null ? '' : v).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function str(v, max) {
  const s = String(v == null ? '' : v).trim();
  return max ? s.slice(0, max) : s;
}

function arr(v, max) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '' && x != null).slice(0, max || 200);
}

function httpUrl(v) {
  const s = str(v, 500);
  if (!s) return '';
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString().replace(/\/$/, '') : '';
  } catch (_) { return ''; }
}

const PALETTE_ROLES = ['primary', 'accent', 'ink', 'surface', 'surface_alt', 'muted', 'ok', 'warn', 'err'];

function normalizePalette(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const role of PALETTE_ROLES) {
    const hex = normHex(src[role]);
    if (hex) out[role] = hex;
  }
  const extra = Array.isArray(src.extra) ? src.extra : [];
  const cleanExtra = [];
  for (const e of extra.slice(0, 12)) {
    const hex = normHex(e && e.hex);
    const name = str(e && e.name, 32);
    if (hex && name) cleanExtra.push({ name, hex });
  }
  if (cleanExtra.length) out.extra = cleanExtra;
  return out;
}

function normalizeFont(f, fallback) {
  const src = f && typeof f === 'object' ? f : {};
  const family = str(src.family, 64);
  if (!family) return null;
  // A stack is only ever built from the operator's own family + a generic
  // fallback; we never substitute a different brand's typeface.
  const stack = str(src.stack, 200) || `'${family}',${fallback}`;
  const out = {
    family,
    stack,
    google: src.google !== false,
    weights: str(src.weights, 40) || '400;600;700',
  };
  // A self-hosted family's FILE (2026-10-04): an https URL only, so a
  // generated page can declare @font-face for it (brand-runtime.fontImport).
  const file = str(src.src, 300);
  if (out.google === false && /^https:\/\/[^\s"'()<>]+$/i.test(file)) {
    out.src = file;
    const fmt = str(src.format, 12).toLowerCase();
    if (/^(woff2|woff|truetype|opentype|ttf|otf)$/.test(fmt)) out.format = fmt;
  }
  return out;
}

function normalizeTypography(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const heading = normalizeFont(src.heading, 'Georgia,serif');
  const body = normalizeFont(src.body, 'system-ui,-apple-system,Segoe UI,sans-serif');
  const mono = normalizeFont(src.mono, 'ui-monospace,SFMono-Regular,Menlo,monospace');
  if (heading) out.heading = heading;
  if (body) out.body = body;
  if (mono) out.mono = mono;
  return out;
}

function normalizeVoice(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    tone: str(src.tone, 400),
    preferred: arr(src.preferred, 80).map((s) => str(s, 60)),
    banned: arr(src.banned, 120).map((s) => str(s, 60)),
    no_em_dashes: src.no_em_dashes !== false,
    notes: str(src.notes, 2000),
  };
}

function normalizeRegions(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  // Exactly ONE home market, or none. `home` is a flag the operator confirmed
  // (or the wizard proposed from the site's own signals and the operator
  // pressed Use on); a second flag is dropped rather than resolved, because two
  // homes is not a state a brand can be in. No flag at all is a reported gap,
  // never silently promoted to the first row.
  let homeSeen = false;
  for (const r of input.slice(0, 24)) {
    const code = str(r && r.code, 12).toUpperCase();
    if (!code) continue;
    const home = r.home === true && !homeSeen;
    if (home) homeSeen = true;
    out.push({
      code,
      currency: str(r.currency, 8).toUpperCase(),
      symbol: str(r.symbol, 4),
      store_url: httpUrl(r.store_url),
      // Only what was stated: /products/{handle} is a Shopify URL scheme, and
      // filling it in for every brand put tenant zero's store shape on all of
      // them (2026-10-10). Nothing reads a pattern that is not there.
      pdp_pattern: str(r.pdp_pattern, 200),
      collection_pattern: str(r.collection_pattern, 200),
      home,
    });
  }
  return out;
}

function normalizeHosts(input, regions) {
  const set = new Set();
  for (const h of arr(input, 40)) {
    const host = str(h, 200).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (host) set.add(host);
  }
  // A region's own store host is, by definition, brand-owned.
  for (const r of regions || []) {
    if (!r.store_url) continue;
    try { set.add(new URL(r.store_url).host.toLowerCase()); } catch (_) { /* ignore */ }
  }
  return [...set];
}

/**
 * Validate a colour schema against the design HARD rules.
 * Returns { ok, errors:[], warnings:[], contrast:{} } — errors block save.
 */
function validatePalette(paletteInput) {
  const p = normalizePalette(paletteInput);
  const errors = [], warnings = [];

  for (const role of ['primary', 'ink', 'surface']) {
    if (!p[role]) errors.push({ field: role, message: `Missing required colour: ${role}.` });
  }
  for (const [k, v] of Object.entries(paletteInput || {})) {
    if (PALETTE_ROLES.includes(k) && v && !normHex(v)) {
      errors.push({ field: k, message: `"${v}" is not a valid hex colour (use #RGB or #RRGGBB).` });
    }
  }
  if (errors.length) return { ok: false, errors, warnings, palette: p, contrast: {} };

  const ratios = {
    ink_on_surface: contrast(p.ink, p.surface),
    ink_on_surface_alt: contrast(p.ink, p.surface_alt || '#ffffff'),
    primary_on_surface: contrast(p.primary, p.surface),
    onprimary: contrast(p.primary, readableOn(p.primary, p.ink, p.surface, p.surface_alt || '#ffffff')),
    accent_on_surface: p.accent ? contrast(p.accent, p.surface) : null,
    muted_on_surface: p.muted ? contrast(p.muted, p.surface) : null,
  };

  // HARD rule: never a black / near-black / dark-neutral page surface.
  if (isDarkNeutral(p.surface)) {
    errors.push({ field: 'surface', message: 'Page surface is a dark neutral (near-black). Use a light surface, or your brand primary as the dark ground — never black/#111111-style neutrals.' });
  }
  if (p.surface_alt && isDarkNeutral(p.surface_alt)) {
    errors.push({ field: 'surface_alt', message: 'Card surface is a dark neutral. Use a light surface or a brand-primary tint.' });
  }
  // HARD rule: WCAG-AA on every pairing the shell actually renders.
  if (ratios.ink_on_surface < 4.5) {
    errors.push({ field: 'ink', message: `Body text on the page surface is ${ratios.ink_on_surface}:1 — WCAG AA needs 4.5:1. Darken the ink or lighten the surface.` });
  }
  if (ratios.ink_on_surface_alt < 4.5) {
    errors.push({ field: 'surface_alt', message: `Body text on cards is ${ratios.ink_on_surface_alt}:1 — WCAG AA needs 4.5:1.` });
  }
  if (ratios.onprimary < 4.5) {
    errors.push({ field: 'primary', message: `Neither your ink nor your card colour reaches 4.5:1 on the primary (best is ${ratios.onprimary}:1). Buttons and primary bands would be unreadable.` });
  }
  if (ratios.primary_on_surface < 3) {
    warnings.push({ field: 'primary', message: `Primary on the page surface is ${ratios.primary_on_surface}:1 — below the 3:1 non-text minimum, so outlines, chips and icons in primary will be hard to see.` });
  }
  if (ratios.accent_on_surface != null && ratios.accent_on_surface < 4.5) {
    warnings.push({ field: 'accent', message: `Accent text on the surface is ${ratios.accent_on_surface}:1. Keep accent for fills and rules, not body copy.` });
  }
  if (ratios.muted_on_surface != null && ratios.muted_on_surface < 4.5) {
    warnings.push({ field: 'muted', message: `Muted text on the surface is ${ratios.muted_on_surface}:1 — secondary copy will fail AA.` });
  }
  if (p.primary && p.accent && contrast(p.primary, p.accent) < 1.4) {
    warnings.push({ field: 'accent', message: 'Primary and accent are nearly the same tone; the two will not read as distinct.' });
  }

  return { ok: errors.length === 0, errors, warnings, palette: p, contrast: ratios };
}

/**
 * The floor the brand-colour TEXT tokens are held to.
 *
 * Tuned with headroom rather than to exactly 4.5. These tokens do not only land
 * on the bare surface: the shell paints tinted STATES over it — an active nav
 * group, a hovered row, a selected chip — each a few percent darker. A colour
 * that clears 4.5 on the surface itself lands just under it on the tint, which
 * is how the active group header measured 3.98:1 while every other label
 * passed. The margin buys those states without pushing a brand's colour further
 * from what it chose than it has to be.
 *
 * Exported so the contrast tests assert against the SAME number the tokens are
 * built from. Restating it in a test is how the suite ended up asserting that a
 * 4.51:1 colour is left alone while this module was moving anything under 4.9.
 */
const TEXT_AA = 4.9;

/**
 * Derive the full CSS-variable set the shell paints with. Everything is derived
 * from the operator's own colours — no colour is introduced from outside the
 * supplied schema except pure white/black mixes of those colours.
 */
function tokens(brand) {
  const p = normalizePalette((brand && brand.palette) || {});
  const primary = p.primary || '#6A33D8';
  const accent = p.accent || primary;
  const requestedInk = p.ink || '#111111';
  const surface = p.surface || '#F7F5F2';
  const surfaceAlt = p.surface_alt || shade(surface, 0.6);
  const muted = p.muted || shade(requestedInk, 0.35);
  // Text tokens are measured against the WORST-CASE surface they can land
  // on, not the lightest. A brand's page surface is often a tint while its
  // cards are white, and the shared rail is tinted too; a colour tuned
  // against white still fails on the tint, which is precisely where the
  // nav group labels were landing at 3.6:1. Whichever of the two the brand
  // colour reads worse on is the one that has to pass.
  // Text tokens are held to TEXT_AA on BOTH surfaces (readableOnSurfaces).
  // They used to be tuned against whichever surface the RAW primary read worse
  // on - for a near-white primary that is the WHITE card, while the darkened
  // text it becomes reads worse on the tinted page: a random sweep of 17,006
  // valid palettes found primary-text at 4.28:1 on the brand's own page
  // surface (design/lifecycle-os/CONTRACT.md, tests/design-system.spec.js).
  // Brand records created before contrast validation may contain pale ink on
  // a pale surface. Keep their chosen palette when possible, but always paint
  // readable body copy (held on BOTH surfaces, like every text token).
  const ink = readableOnSurfaces(requestedInk, [surface, surfaceAlt], TEXT_AA);
  const t = brand && brand.typography ? brand.typography : {};
  const states = { ok: p.ok || '#1a7f37', warn: p.warn || '#c9a227', err: p.err || '#c0392b' };

  return Object.assign({
    '--brand-primary': primary,
    '--brand-primary-dark': shade(primary, -0.25),
    '--brand-primary-soft': shade(primary, 0.86),
    '--brand-primary-tint': shade(primary, 0.94),
    '--brand-on-primary': readableOn(primary, ink, surface, surfaceAlt),
    // The brand colour as a TEXT colour. --brand-on-primary answers what to
    // write on a primary fill; this answers the far more common case of the
    // brand colour written on the page. Any rule doing `color:var(--brand-
    // primary)` must use this instead, or it is legible only for brands whose
    // primary happens to be dark.
    '--brand-primary-text': readableOnSurfaces(primary, [surface, surfaceAlt], TEXT_AA),
    '--brand-accent': accent,
    '--brand-accent-soft': shade(accent, 0.88),
    '--brand-on-accent': readableOn(accent, ink, surface, surfaceAlt),
    '--brand-accent-text': readableOnSurfaces(accent, [surface, surfaceAlt], TEXT_AA),
    '--brand-ink': ink,
    // Secondary text still has to be READABLE. `shade(ink, .35)` is a fixed
    // 35% lift toward white with no floor, so a brand with a mid-grey ink got
    // a muted token that fails AA - and muted is the colour of most of the
    // small print on every page. AA for body text is the bar here too: this is
    // supporting copy, not decoration.
    '--brand-ink-muted': readableOnSurfaces(muted, [surface, surfaceAlt], TEXT_AA),
    '--brand-surface': surface,
    '--brand-surface-alt': surfaceAlt,
    '--brand-line': shade(ink, 0.84),
    '--brand-line-strong': shade(ink, 0.68),
    '--brand-ok': states.ok,
    '--brand-warn': states.warn,
    '--brand-err': states.err,
    '--brand-font-head': (t.heading && t.heading.stack) || "'Montserrat',Georgia,serif",
    '--brand-font-body': (t.body && t.body.stack) || "system-ui,-apple-system,Segoe UI,sans-serif",
    '--brand-font-mono': (t.mono && t.mono.stack) || 'ui-monospace,SFMono-Regular,Menlo,monospace',
  }, contractTokens({ primary, accent, ink, muted, surface, surfaceAlt, states }), componentTokens(brand));
}

/**
 * The Lifecycle OS design-system contract's DERIVED tokens (2026-10-05,
 * design/lifecycle-os/CONTRACT.md). Each answers a question a page used to
 * answer by eye, which is where every unreadable pairing in this app came from:
 *
 *   --brand-band / --brand-on-band     a brand-coloured SECTION ground, through
 *     sectionGround() so it is never a dark neutral, and the text on it through
 *     textOn() at TEXT_AA. A page that wants a brand band paints THIS, never
 *     --brand-primary directly: a brand whose primary is near-black would
 *     otherwise get a black section, which is a HARD rule.
 *   --brand-band-accent / --brand-on-band-accent   the same for the accent.
 *   --brand-{ok,warn,err}-text   a state colour used AS TEXT (a failure tag, a
 *     status word). The raw state colours are fills and edges; the default
 *     warn is 2.3:1 on white and fails as text for every brand.
 *   --brand-focus   the focus ring, at the 3:1 non-text minimum against the
 *     worst surface. A pale accent as a raw outline is invisible.
 *
 * brand-context.js carries the same function for the device path, and the
 * device/server parity test diffs every key.
 */
function contractTokens({ primary, accent, ink, muted, surface, surfaceAlt, states }) {
  const band = normHex(sectionGround(primary, accent, surface)) || '#ffffff';
  const bandAccent = normHex(sectionGround(accent, primary, surface)) || '#ffffff';
  const text = {
    ink,
    muted: readableOnSurfaces(muted || shade(ink, 0.35), [surface, surfaceAlt], TEXT_AA),
    primary: readableOnSurfaces(primary, [surface, surfaceAlt], TEXT_AA),
    accent: readableOnSurfaces(accent, [surface, surfaceAlt], TEXT_AA),
    ok: readableOnSurfaces(states.ok, [surface, surfaceAlt], TEXT_AA),
    warn: readableOnSurfaces(states.warn, [surface, surfaceAlt], TEXT_AA),
    err: readableOnSurfaces(states.err, [surface, surfaceAlt], TEXT_AA),
  };
  return {
    '--brand-surface-sunken': sunkenSurface(surface, surfaceAlt, Object.values(text)),
    '--brand-band': band,
    '--brand-on-band': textOn(band, surface, ink, TEXT_AA),
    '--brand-band-accent': bandAccent,
    '--brand-on-band-accent': textOn(bandAccent, surface, ink, TEXT_AA),
    '--brand-ok-text': readableOnSurfaces(states.ok, [surface, surfaceAlt], TEXT_AA),
    '--brand-warn-text': readableOnSurfaces(states.warn, [surface, surfaceAlt], TEXT_AA),
    '--brand-err-text': readableOnSurfaces(states.err, [surface, surfaceAlt], TEXT_AA),
    '--brand-focus': readableOnSurfaces(accent, [surface, surfaceAlt], 3),
  };
}

/**
 * The SUNKEN panel ground (status line, failure frame, notice bar, the mark's
 * tile): the darker of the two surfaces, darkened only as far as every text
 * token still clears 4.5:1 on it. It used to be the literal #f5f5f5 for every
 * brand: a cool grey on a cream or tinted surface, and a ground no text token
 * was ever measured against (a token tuned to exactly 4.9 on white would read
 * 4.49 on it). Stepped at 0.5%, capped at 4%; when even the surface itself is
 * the floor, the panel is not sunk at all.
 */
function sunkenSurface(surface, surfaceAlt, textColours) {
  const base = luminance(surface) <= luminance(surfaceAlt || surface) ? surface : surfaceAlt;
  let best = normHex(base) || '#ffffff';
  for (let t = 0.005; t <= 0.0401; t += 0.005) {
    const c = shade(base, -t);
    if (textColours.every((x) => contrast(x, c) >= 4.5)) best = c; else break;
  }
  return best;
}

/**
 * The shell's share of the brand's DESIGN SYSTEM (2026-10-04): the corner
 * radius of its controls and cards as its own site renders them, read by
 * theme.css through var(--brand-radius-*, <the shell's own value>). A brand
 * with no measured design system emits nothing, so the shell is unchanged.
 * brand-context.js carries the same function for the device path.
 */
function componentTokens(brand) {
  const ds = brand && brand.brand_data && brand.brand_data.design_system;
  const out = {};
  const comp = (ds && ds.components) || null;
  if (!comp) return out;
  const b = comp.button && comp.button.primary && comp.button.primary.desktop;
  const c = comp.card && comp.card.desktop && comp.card.desktop.box;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100) / 100}px` : '');
  if (b && n(b.radius)) out['--brand-radius-control'] = n(b.radius);
  if (c && n(c.radius)) out['--brand-radius-card'] = n(c.radius);
  return out;
}

/** Google Fonts stylesheet URL for whichever families are marked google:true. */
function fontsHref(brand) {
  const t = (brand && brand.typography) || {};
  const families = [];
  for (const slot of ['heading', 'body', 'mono']) {
    const f = t[slot];
    if (!f || !f.family || f.google === false) continue;
    const fam = String(f.family).trim().replace(/\s+/g, '+');
    const weights = String(f.weights || '400;600;700').replace(/[^0-9;]/g, '');
    if (!fam) continue;
    const spec = weights ? `family=${fam}:wght@${weights}` : `family=${fam}`;
    if (!families.includes(spec)) families.push(spec);
  }
  if (!families.length) return '';
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}

/* ── readiness (the zero-fabrication gate) ────────────────────────────────── */

/**
 * The zero-fabrication marker, in the spec's shape:
 *   [DATA REQUIRED BEFORE LAUNCH: <field>, <product>, <region>]
 *
 * The product and region slots are named only when they APPLY. A brand-level
 * gap used to render as "[DATA REQUIRED BEFORE LAUNCH: logo URL, all, all]",
 * and on the review step - a list of these, one per line - "all, all" read as
 * filler where a fact should be, which is the opposite of what a marker is
 * for. A gap that is the brand's names the brand; a gap that is one region's
 * names the region after it. brand-context.js carries the same builder for the
 * device path, and the wizard renders through it too.
 */
function launchMarker(field, ctx) {
  const c = ctx || {};
  const parts = [field, c.product || c.brand || 'this brand'];
  if (c.region) parts.push(c.region);
  return `[DATA REQUIRED BEFORE LAUNCH: ${parts.join(', ')}]`;
}

/**
 * What is still missing before this brand can launch anything. Reported, never
 * filled in. Marker format is launchMarker()'s.
 */
function readiness(brand, counts) {
  const missing = [];
  const b = brand || {};
  const add = (field, product, region) => missing.push({
    field, product: product || 'all', region: region || 'all',
    marker: launchMarker(field, { brand: str(b.name), product, region }),
  });
  if (!str(b.name)) add('brand name');
  if (!str(b.website)) add('brand website');
  if (!str(b.logo_url)) add('logo URL');

  const pv = validatePalette(b.palette || {});
  if (!pv.ok) for (const e of pv.errors) add(`palette.${e.field}`);

  const ty = b.typography || {};
  if (!ty.heading || !ty.heading.family) add('typography.heading');
  if (!ty.body || !ty.body.family) add('typography.body');

  const voice = b.voice || {};
  if (!str(voice.tone)) add('voice.tone');
  if (!arr(voice.banned).length) add('voice.banned phrases');

  const regions = Array.isArray(b.regions) ? b.regions : [];
  if (!regions.length) add('regions');
  // A brand with markets but no HOME market has every "no market given"
  // default fall to its first row, which is an ordering accident, not a
  // decision. Reported, not promoted.
  if (regions.length && !regions.some((r) => r && r.home === true)) add('home market');
  for (const r of regions) if (!r.store_url) add('region store URL', '', r.code);
  for (const r of regions) if (!r.currency) add('region currency', '', r.code);

  const productCount = counts && typeof counts.products === 'number' ? counts.products : null;
  if (productCount === 0) add('product catalog');

  const blocking = missing.filter((m) => /^(brand name|palette\.|typography\.|regions$|product catalog)/.test(m.field));
  return {
    ready: blocking.length === 0,
    missing,
    markers: missing.map((m) => m.marker),
    palette: { errors: pv.errors, warnings: pv.warnings, contrast: pv.contrast },
    products: productCount,
    // Mirrors the spec's launch-gate language rather than inventing a new one.
    status_line: blocking.length === 0
      ? 'BRAND READY'
      : 'NOT LAUNCH READY — DATA DEPENDENCY',
  };
}

/* ── catalog import ───────────────────────────────────────────────────────── */

/** RFC4180-ish CSV parser (quotes, escaped quotes, embedded newlines, CRLF). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

const COLUMN_ALIASES = {
  title: ['title', 'name', 'product', 'product name', 'product title', 'item'],
  handle: ['handle', 'slug', 'url handle', 'permalink'],
  sku: ['sku', 'variant sku', 'id', 'product id', 'item code', 'style code'],
  description: ['description', 'body', 'body (html)', 'body html', 'details'],
  product_type: ['type', 'product type', 'category', 'product category'],
  collections: ['collection', 'collections', 'category path', 'product collection'],
  price: ['price', 'variant price', 'selling price', 'mrp', 'amount'],
  compare_at: ['compare at price', 'compare_at_price', 'variant compare at price', 'was price', 'list price'],
  currency: ['currency', 'currency code'],
  image_url: ['image', 'image src', 'image url', 'featured image', 'img', 'image_link'],
  product_url: ['url', 'product url', 'link', 'product link'],
  in_stock: ['available', 'in stock', 'in_stock', 'status', 'stock'],
  tags: ['tags', 'tag', 'keywords'],
};

function mapHeaders(headers) {
  const map = {};
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    let idx = lower.findIndex((h) => aliases.includes(h));
    if (idx < 0) idx = lower.findIndex((h) => h && aliases.some((a) => h.includes(a)));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

function num(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}

function boolish(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return null;
  if (['true', 'yes', 'y', '1', 'active', 'in stock', 'available'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'draft', 'archived', 'out of stock', 'sold out'].includes(s)) return false;
  return null;
}

function splitList(v) {
  return String(v == null ? '' : v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
}

function rowsFromCsv(text, region) {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], columns: {}, skipped: 0 };
  const headers = grid[0];
  const map = mapHeaders(headers);
  if (map.title == null) {
    const err = new Error('Could not find a product title/name column in the CSV header.');
    err.status = 400;
    throw err;
  }
  const rows = [];
  let skipped = 0;
  for (const line of grid.slice(1, MAX_CATALOG_ROWS + 1)) {
    const get = (f) => (map[f] == null ? '' : line[map[f]]);
    const title = str(get('title'), 300);
    if (!title) { skipped++; continue; }
    const raw = {};
    headers.forEach((h, i) => { if (String(h || '').trim()) raw[String(h).trim()] = line[i] == null ? '' : String(line[i]); });
    rows.push({
      region,
      title,
      handle: str(get('handle'), 200) || slugify(title),
      sku: str(get('sku'), 120) || null,
      description: str(get('description'), 4000) || null,
      product_type: str(get('product_type'), 120) || null,
      collections: splitList(get('collections')),
      price: num(get('price')),
      compare_at: num(get('compare_at')),
      currency: str(get('currency'), 8).toUpperCase() || null,
      image_url: httpUrl(get('image_url')) || null,
      product_url: httpUrl(get('product_url')) || null,
      in_stock: boolish(get('in_stock')),
      tags: splitList(get('tags')),
      raw,
      source: 'csv',
    });
  }
  return { rows, columns: map, skipped };
}

function rowsFromJson(text, region) {
  let data;
  try { data = typeof text === 'string' ? JSON.parse(text) : text; }
  catch (_) { const e = new Error('That is not valid JSON.'); e.status = 400; throw e; }
  const list = Array.isArray(data) ? data
    : Array.isArray(data && data.products) ? data.products
    : Array.isArray(data && data.items) ? data.items : null;
  if (!list) { const e = new Error('Expected a JSON array of products, or an object with a "products" array.'); e.status = 400; throw e; }
  const rows = [];
  let skipped = 0;
  for (const p of list.slice(0, MAX_CATALOG_ROWS)) {
    if (!p || typeof p !== 'object') { skipped++; continue; }
    const title = str(p.title || p.name || p.n, 300);
    if (!title) { skipped++; continue; }
    rows.push({
      region,
      title,
      handle: str(p.handle || p.h || p.slug, 200) || slugify(title),
      sku: str(p.sku || p.id, 120) || null,
      description: str(p.description || p.body_html || p.body, 4000) || null,
      product_type: str(p.product_type || p.type || p.category, 120) || null,
      collections: Array.isArray(p.collections) ? arr(p.collections, 30).map((c) => str(typeof c === 'object' ? (c.title || c.handle) : c, 120)) : splitList(p.collections),
      price: num(p.price != null ? p.price : (Array.isArray(p.variants) && p.variants[0] ? p.variants[0].price : null)),
      compare_at: num(p.compare_at_price != null ? p.compare_at_price : (Array.isArray(p.variants) && p.variants[0] ? p.variants[0].compare_at_price : null)),
      currency: str(p.currency, 8).toUpperCase() || null,
      image_url: httpUrl(p.image_url || p.img || (p.image && (p.image.src || p.image.url)) || (Array.isArray(p.images) && p.images[0] && (p.images[0].src || p.images[0].url))) || null,
      product_url: httpUrl(p.product_url || p.url || p.link) || null,
      in_stock: typeof p.available === 'boolean' ? p.available : boolish(p.available != null ? p.available : p.status),
      tags: Array.isArray(p.tags) ? arr(p.tags, 30).map((t) => str(t, 60)) : splitList(p.tags),
      raw: p,
      source: 'json',
    });
  }
  return { rows, columns: {}, skipped };
}

/* ── SSRF guard for the storefront importer ───────────────────────────────────
   The importer fetches a URL supplied by any signed-in user, from inside the
   serverless runtime. Without a guard that is a server-side request forgery
   primitive against anything the runtime can reach (cloud metadata endpoints,
   internal services). Everything below is refused:
     * non-http(s) schemes and non-standard ports
     * loopback / private / link-local / CGNAT / unique-local literals
     * the cloud metadata addresses and *.internal / *.local style names
     * any hostname whose DNS resolution lands on one of those ranges
     * redirects (fetch is issued with redirect:'manual'), so a public host
       cannot bounce us onto an internal one
   DNS rebinding between the check and the connect is not fully preventable
   without pinning the socket to the resolved IP, which needs a custom agent;
   blocking redirects and re-validating every hop removes the practical paths. */

const BLOCKED_HOST_RX = /^(localhost|.*\.localhost|.*\.internal|.*\.local|.*\.home\.arpa|metadata|metadata\.google\.internal)$/i;

function isPrivateV4(octets) {
  const [a, b] = octets;
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  if (a === 0 || a === 10 || a === 127) return true;                    // this-host, private, loopback
  if (a === 169 && b === 254) return true;                              // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;                     // private
  if (a === 192 && b === 168) return true;                              // private
  if (a === 192 && b === 0) return true;                                // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true;                    // CGNAT
  if (a >= 224) return true;                                            // multicast + reserved
  return false;
}

/**
 * Expand an IPv6 literal to its eight 16-bit groups.
 * Returns null if it does not parse as IPv6.
 *
 * This matters because Node canonicalises `[::ffff:127.0.0.1]` to
 * `::ffff:7f00:1` — the loopback address written in HEX. A guard that only
 * strips a literal `::ffff:` prefix and hands the rest to an IPv4 parser sees
 * `7f00:1`, fails to parse it, and lets loopback through. The mapped address
 * has to be DECODED, not string-matched.
 */
function v6Groups(host) {
  let h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');  // strip zone id
  if (!/^[0-9a-f:.]*$/.test(h) || h.indexOf(':') < 0) return null;

  // A trailing dotted quad (::ffff:127.0.0.1) becomes two hex groups.
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (dotted) {
    const o = dotted.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    const hi = ((o[0] << 8) | o[1]).toString(16);
    const lo = ((o[2] << 8) | o[3]).toString(16);
    h = h.slice(0, dotted.index) + hi + ':' + lo;
  }

  const halves = h.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;

  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups = head.concat(Array(halves.length === 2 ? fill : 0).fill('0'), tail);
  if (groups.length !== 8) return null;

  const out = [];
  for (const g of groups) {
    if (g === '') return null;
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function isPrivateIp(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) return isPrivateV4(v4.slice(1).map(Number));

  const g = v6Groups(h);
  if (!g) return false;

  // Unspecified :: and loopback ::1
  if (g.every((x) => x === 0)) return true;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;

  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d — decode and
  // apply the IPv4 rules to the embedded address.
  const firstSixZero = g.slice(0, 5).every((x) => x === 0);
  if (firstSixZero && (g[5] === 0xffff || g[5] === 0)) {
    const o = [(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff];
    if (!(o[0] === 0 && o[1] === 0 && o[2] === 0 && o[3] === 0)) return isPrivateV4(o);
  }
  // NAT64 well-known prefix 64:ff9b::/96 also embeds an IPv4 address.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateV4([(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff]);
  }

  if ((g[0] & 0xfe00) === 0xfc00) return true;                          // unique-local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true;                          // link-local fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true;                          // multicast ff00::/8
  return false;
}

async function assertPublicUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch (_) { const e = new Error('That is not a valid URL.'); e.status = 400; throw e; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') { const e = new Error('Only http and https URLs can be imported.'); e.status = 400; throw e; }
  if (u.port && u.port !== '80' && u.port !== '443') { const e = new Error('Only the standard http and https ports can be imported.'); e.status = 400; throw e; }

  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOST_RX.test(host) || isPrivateIp(host)) {
    const e = new Error('That address is on a private or internal network, so it cannot be imported.');
    e.status = 400; throw e;
  }

  // Resolve the name and refuse if ANY answer is on an internal range.
  try {
    const dns = require('dns').promises;
    const answers = await dns.lookup(host, { all: true, verbatim: true });
    for (const a of answers) {
      if (isPrivateIp(a.address)) {
        const e = new Error('That hostname resolves to a private or internal address, so it cannot be imported.');
        e.status = 400; throw e;
      }
    }
  } catch (err) {
    if (err && err.status === 400) throw err;
    // A resolution failure is reported as unreachable, not silently allowed.
    const e = new Error(`Could not resolve ${host}.`);
    e.status = 400; throw e;
  }
  return u.toString().replace(/\/$/, '');
}

/**
 * A store URL, read WHOLE (2026-10-10): catalog-import.js decides the route
 * (Shopify's feed, the site's own sitemaps + each product page's JSON-LD, or
 * its linked pages), reads until this invocation's budget is spent, and hands
 * back the rows, a cursor to resume from, and the coverage in sentences.
 *
 * This replaced two readers that each read what one pass happened to reach: a
 * feed loop capped at 10 pages that refused any redirect and dropped every
 * variant and all but one image, and a 40-page crawl whose sitemaps and
 * robots.txt were fetched through a text/html-only fetcher (so neither was
 * ever read in production). See catalog-import.js for what was measured.
 *
 * The SSRF guard runs on EVERY request the importer makes (each redirect hop
 * included), with the answer for a host cached for the run.
 */
async function rowsFromStore(startUrl, region, scope, { cursor, budgetMs, strictScope } = {}) {
  const candidate = httpUrl(startUrl) || (scope && scope.website) || '';
  if (!candidate) { const e = new Error('A store URL is required.'); e.status = 400; throw e; }
  const base = await assertPublicUrl(candidate);
  const brand = Object.assign({}, scope || {});
  if (!brand.website) brand.website = base;
  const { allowedHosts, inScope } = require('./site-crawl.js');
  if (!inScope(base, allowedHosts(brand))) {
    if (strictScope) {
      const e = new Error('That URL is not on this brand\'s own domain. A catalogue may only be crawled from the brand\'s own site.');
      e.status = 400; throw e;
    }
    // The operator named this store as theirs: its host joins the scope.
    brand.asset_hosts = [].concat(Array.isArray(brand.asset_hosts) ? brand.asset_hosts : [], [new URL(base).hostname]);
  }
  const cleared = new Set();
  const guard = async (u) => {
    const h = new URL(u).hostname;
    if (cleared.has(h)) return;
    await assertPublicUrl(u);
    cleared.add(h);
  };
  const out = await require('./catalog-import.js').step({ url: base, region, brand, cursor, guard, budgetMs });
  return {
    // `base` is the store ACTUALLY read (2026-10-10). It was the URL asked for,
    // so a read the importer moved to a region's store recorded the brand's
    // own site as the source: catalog_source.url said delichic.co.in while
    // 734 rows came from nike.in. `start` is the URL asked for.
    rows: out.rows, base: (out.base || base).replace(/\/$/, ''), start: base.replace(/\/$/, ''), columns: {}, skipped: out.coverage.skipped.no_title || 0,
    storefront: out.coverage.platform
      ? { detected: true, platform: { id: out.coverage.platform.id, name: out.coverage.platform.name, why: out.coverage.platform.why, confidence: out.coverage.platform.confidence, source_url: out.coverage.platform.source_url }, catalog_route: { kind: out.coverage.platform.route, note: out.coverage.platform.route_note } }
      : { detected: false },
    coverage: out.coverage, cursor: out.cursor, complete: out.complete, run: out.run,
  };
}

/* ── workspace operations ─────────────────────────────────────────────────── */

/**
 * Every brand write goes through here so the in-memory caches downstream cannot
 * outlive the row they describe.
 *
 * brand-runtime caches the workspace for 30s and workspace-scope caches both the
 * workspace row and the user's active workspace for 60s. Nothing used to clear
 * either, so for that window after a save or a brand switch the generators kept
 * building from the previous brand: correct-looking assets carrying the wrong
 * identity, which nothing else in the system would ever notice.
 *
 * Required lazily because brand-runtime requires THIS module at load time; a
 * top-level require here would close the cycle.
 */
function invalidateBrandCaches({ userId, workspaceId } = {}) {
  try { require('./brand-runtime.js').invalidate(workspaceId); } catch (_) { /* cache clearing must never fail a write */ }
  try { require('./workspace-scope.js').invalidate({ userId, workspaceId }); } catch (_) { /* same */ }
}

const SELECT_COLS = 'id,slug,name,legal_name,tagline,industry,website,logo_url,favicon_url,palette,typography,voice,regions,asset_hosts,catalog_source,brand_data,status,onboarding_step,owner_id,created_at,updated_at';

async function listWorkspaces(auth) {
  const rows = await restAs(auth.token, `brand_workspaces?select=${SELECT_COLS}&order=updated_at.desc`);
  return Array.isArray(rows) ? rows : [];
}

/**
 * The brand a signed-in read is scored as: the WORKSPACE as it stands on the
 * server when the caller can read it (a device principal has none there), else
 * the draft the request carries. Either way through brand-render.scoringBrand,
 * so it is bounded the same way.
 */
async function scoringBrandFor(auth, body, q) {
  const render = require('./brand-render.js');
  const wsId = str((body && body.workspace_id) || (q && q.workspace_id));
  if (wsId && auth && auth.ok && auth.token && auth.mode !== 'device' && !/^local-/.test(wsId)) {
    try {
      const row = await module.exports.getWorkspace(auth, wsId);
      if (row) return render.scoringBrand(row);
    } catch (_) { /* unreadable: the carried draft below */ }
  }
  return render.scoringBrand(body && body.brand);
}

async function getWorkspace(auth, id) {
  const rows = await restAs(auth.token, `brand_workspaces?select=${SELECT_COLS}&id=eq.${encodeURIComponent(id)}&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * The products a brand has NOW: rows a complete re-import marked stale are not
 * counted. Paged, because PostgREST answers at most max_rows (1,000) whatever
 * `limit` asks - a single read said 1,000 for every larger catalogue.
 */
async function productCount(auth, id) {
  try { return (await catalogCounts(auth, id)).live; } catch (_) { return 0; }
}

/**
 * How many of a brand's live products are ITS OWN, and how many came from
 * another brand's site (2026-10-10). "612 products in this workspace" on the
 * live record counted Nike's rows as the brand's catalogue and satisfied the
 * readiness check with them. Each row is judged exactly as the generators
 * judge it (brand-coherence.js catalogIdentity + catalogRowForeign, by the
 * row's own page), so the count and what a mailer may use cannot disagree.
 * { live, own, excluded, excluded_domains }
 */
async function productTally(auth, ws) {
  const out = { live: 0, own: 0, excluded: 0, excluded_domains: [] };
  if (!ws || !ws.id) return out;
  const verdict = coherence.catalogIdentity(ws);
  const page = async (cols, filter) => {
    const all = [];
    for (let offset = 0; offset < 200000; offset += 1000) {
      const rows = await restAs(auth.token, `brand_catalog_products?select=${cols}&workspace_id=eq.${encodeURIComponent(ws.id)}${filter}&order=id.asc&limit=1000&offset=${offset}`);
      const got = Array.isArray(rows) ? rows : [];
      if (!got.length) break;
      for (const r of got) all.push(r);
    }
    return all;
  };
  let rows;
  try { rows = await page('id,source_url,product_url', '&stale_at=is.null'); }
  catch (e) {
    // A database without 20261010002000 has no source_url / stale_at.
    if (!/stale_at|source_url|42703/.test(String(e && e.message))) return out;
    try { rows = await page('id,product_url', ''); } catch (_) { return out; }
  }
  for (const r of rows) {
    out.live += 1;
    if (coherence.catalogRowForeign(r, verdict)) {
      out.excluded += 1;
      const d = coherence.registrableDomain(coherence.hostOf(r.source_url || r.product_url || '')) || verdict.domain || '';
      if (d && out.excluded_domains.indexOf(d) < 0 && out.excluded_domains.length < 5) out.excluded_domains.push(d);
    } else out.own += 1;
  }
  return out;
}
/** The payload fields a tally adds: the own count is `products`. */
function tallyFields(t) {
  return { products: t.own, products_excluded: t.excluded, products_excluded_domains: t.excluded_domains };
}

/**
 * Does this workspace own tenant zero's SHIPPED material (the built catalogue,
 * the 3D storefront, the audio beds)? The server's answer, stamped on every
 * brand payload as `owns_shipped` so the browser never decides it from a slug:
 * `brand_workspaces.slug` is unique per OWNER only, so any owner can save
 * tenant zero's slug, and a slug was all brand-context.js and brand-catalog.js
 * read (2026-10-05). Same helper that gates the bundled sales export - the
 * oldest workspace - so the catalogue and the export cannot disagree.
 */
async function ownsShipped(wsId) {
  if (!wsId) return false;
  try { return !!(await require('./market-analytics.js').ownsBundledExport(wsId)); } catch (_) { return false; }
}

async function activeWorkspaceId(auth) {
  const rows = await restAs(auth.token, `brand_user_prefs?select=active_workspace_id&user_id=eq.${encodeURIComponent(auth.user_id)}&limit=1`);
  return (Array.isArray(rows) && rows[0] && rows[0].active_workspace_id) || null;
}

/**
 * Give a newly-live brand its own competitor universe.
 *
 * Competitor Benchmarking is one of the first screens a new brand opens, and it
 * used to open empty for everyone because the universe lived in a Google Sheet
 * nobody had credentials for. Activation is the natural moment to fill it: it
 * is the point at which the brand record is complete enough to describe its own
 * market.
 *
 * Deliberately narrow. It derives ONLY from this brand's own record (its
 * competitor list and its market study), it makes no LLM or third-party call so
 * activation cannot hang on a provider, and it does nothing at all if the brand
 * already has a universe. Every failure is swallowed: a competitor set is
 * useful, but it is never a reason to block a user from activating their brand.
 */
async function seedCompetitorsOnActivation(auth, ws) {
  try {
    if (!ws || !ws.id || ws.status !== 'active') return null;
    const universe = require('./competitor-universe.js');
    const brandRuntime = require('./brand-runtime.js');
    return await universe.seedForWorkspace(universe.userStore(auth.token), ws.id, {
      brand: brandRuntime.normalizeBrand(ws),
      // Switching back to a brand that is already set up must be a no-op.
      onlyIfEmpty: true,
    });
  } catch (err) {
    console.warn('[brand] competitor seed skipped:', (err && err.message) || err);
    return null;
  }
}

async function setActive(auth, id) {
  const ws = await getWorkspace(auth, id);
  if (!ws) { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
  await restAs(auth.token, 'brand_user_prefs?on_conflict=user_id', {
    method: 'POST',
    body: [{ user_id: auth.user_id, active_workspace_id: id, updated_at: new Date().toISOString() }],
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  // Clear BEFORE the seeding call: everything downstream of this point resolves
  // the user's active workspace, and the cached answer is now the previous one.
  invalidateBrandCaches({ userId: auth.user_id, workspaceId: id });
  await seedCompetitorsOnActivation(auth, ws);
  return ws;
}

/**
 * A brand's slug FOLLOWS ITS NAME (2026-10-10). On creation it is made from
 * the name and nothing else: a slug the client sends is ignored, because the
 * gallery's KNICKGASM preset (and any template) used to hand its own slug to
 * the brand typed over it - the live record was "Mamaearth" slugged
 * "food-for-thought". On an update the stored slug is kept, unless the client
 * asks for the slug its CURRENT name makes (the coherence repair "Use
 * <slug>"); no other slug is accepted, so one brand's slug is never inherited
 * by another.
 */
function slugFor(b, prev, name) {
  const fromName = slugify(name);
  if (!prev || !prev.slug) return fromName || `brand-${Date.now().toString(36)}`;
  const asked = slugify(b && b.slug);
  if (asked && asked !== prev.slug && asked === fromName) return asked;
  return prev.slug;
}

/**
 * Activation is where a mixed record would start speaking for a brand, so it
 * is where a cross-domain IDENTITY mix blocks (2026-10-10). The person may
 * override, with a reason; the override is recorded on the record (who, when,
 * why, which conflicts) and the brand activates. Warnings never block.
 * setActive() itself stays unconditional: the first workspace a person
 * creates is made active by the save path, before they have seen anything.
 */
async function activateChecked(auth, id, override) {
  const ws = await getWorkspace(auth, id);
  if (!ws) { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
  const c = coherence.brandCoherence(ws);
  if (c.blocking) {
    const reason = str(override && override.reason, 500);
    if (!reason) {
      const e = new Error(`${ws.name || 'This brand'} mixes brands, so it was not activated: ${c.conflicts.filter((x) => x.severity === 'block').map((x) => x.message).join(' ')} Keep or clear each value in the review step, or activate anyway with a reason.`);
      e.status = 409; e.code = 'coherence_blocked'; e.details = c;
      throw e;
    }
    const bd = Object.assign({}, ws.brand_data || {});
    const coh = Object.assign({}, bd.coherence || {});
    coh.overrides = (Array.isArray(coh.overrides) ? coh.overrides : []).concat([{
      at: new Date().toISOString(), by: auth.user_id || null, reason,
      conflicts: c.conflicts.filter((x) => x.severity === 'block').map((x) => x.id),
    }]).slice(-20);
    bd.coherence = coh;
    await restAs(auth.token, `brand_workspaces?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { brand_data: bd }, prefer: 'return=minimal' });
  }
  return setActive(auth, id);
}

/** Build the exact row we persist — every field normalised, none invented. */
function buildRow(input, existing) {
  const b = input && typeof input === 'object' ? input : {};
  const prev = existing || {};
  const name = str(b.name, 120) || str(prev.name, 120);
  if (!name) { const e = new Error('Brand name is required.'); e.status = 400; throw e; }

  const regions = b.regions !== undefined ? normalizeRegions(b.regions) : (prev.regions || []);
  const row = {
    slug: slugFor(b, prev, name),
    name,
    legal_name: b.legal_name !== undefined ? str(b.legal_name, 200) : (prev.legal_name || null),
    tagline: b.tagline !== undefined ? str(b.tagline, 300) : (prev.tagline || null),
    industry: b.industry !== undefined ? str(b.industry, 120) : (prev.industry || null),
    website: b.website !== undefined ? httpUrl(b.website) : (prev.website || null),
    logo_url: b.logo_url !== undefined ? httpUrl(b.logo_url) : (prev.logo_url || null),
    favicon_url: b.favicon_url !== undefined ? httpUrl(b.favicon_url) : (prev.favicon_url || null),
    palette: b.palette !== undefined ? normalizePalette(b.palette) : (prev.palette || {}),
    typography: b.typography !== undefined ? normalizeTypography(b.typography) : (prev.typography || {}),
    voice: b.voice !== undefined ? normalizeVoice(b.voice) : (prev.voice || {}),
    regions,
    asset_hosts: normalizeHosts(b.asset_hosts !== undefined ? b.asset_hosts : (prev.asset_hosts || []), regions),
    catalog_source: b.catalog_source !== undefined && b.catalog_source && typeof b.catalog_source === 'object'
      ? b.catalog_source : (prev.catalog_source || {}),
    brand_data: b.brand_data !== undefined && b.brand_data && typeof b.brand_data === 'object'
      ? b.brand_data : (prev.brand_data || {}),
    status: ['draft', 'active', 'archived'].includes(str(b.status)) ? str(b.status) : (prev.status || 'draft'),
    onboarding_step: Number.isFinite(+b.onboarding_step) ? Math.max(1, Math.min(6, +b.onboarding_step)) : (prev.onboarding_step || 1),
  };

  // Colour schema is validated on save, so a broken palette can never reach the
  // shell. A DRAFT may still be saved with an incomplete palette (the wizard
  // saves as it goes); anything ACTIVE must pass — including an EMPTY palette,
  // which previously skipped the check entirely and let a direct API client
  // activate a brand with no colours at all, after which tokens() quietly
  // filled it with the shipped tenant's defaults.
  if (row.status === 'active') {
    const v = validatePalette(row.palette);
    if (!v.ok) { const e = new Error('Colour schema fails the design rules.'); e.status = 400; e.details = v.errors; throw e; }
  }
  return row;
}

/**
 * The dotted field paths an operator's save actually carried.
 *
 * This is the half of the precedence rule that makes the other half bite: an
 * automatic run is blocked from a field only because a human is recorded as
 * owning it, and a human is recorded as owning it only because a save said so.
 * Derived from the INPUT, not the stored row - what the operator sent is what
 * they touched, and re-saving an untouched form must not quietly claim the
 * whole record away from the automatic path.
 */
/* ── WHERE A FIELD'S VALUE CAME FROM (2026-10-04) ─────────────────────────
   One order, the same in SQL (brand_origin_rank, migration 20261004120000),
   here, and in brand-context.js's device store:
     user 50 > document 40 > site-render 30 > site-parse 20 (= auto) > preset 10
   `default` (a wizard placeholder nobody chose) ranks 0 and is recorded nowhere.
   The wizard's save carries, per field, the source its value came from in
   brand_data.field_origins; a field with no entry there is the operator's, as
   every save before this one was read. */
const ORIGIN_RANK = { user: 50, document: 40, 'site-render': 30, 'site-parse': 20, auto: 20, preset: 10, default: 0 };
const RECORDED_ORIGINS = new Set(['document', 'site-render', 'site-parse', 'preset']);

function fieldOriginOf(input, field) {
  const bd = input && input.brand_data;
  if (!bd || typeof bd !== 'object') return null;
  const okMap = (m) => (m && typeof m === 'object' && !Array.isArray(m) ? m : null);
  // Two shapes, one meaning: the wizard's per-field RECORD (field_origins:
  // origin + source, page, line, quote) and the rendered read's plain map
  // (field_origin: 'site-render' ...). The record is richer, so it is read
  // first; a save that carries only the map is honoured the same way. A field
  // in neither was typed, as every save before origins existed was read.
  const rec = okMap(bd.field_origins) ? bd.field_origins[field] : undefined;
  const plain = okMap(bd.field_origin) ? bd.field_origin[field] : undefined;
  const r = rec !== undefined ? rec : plain;
  const o = r && typeof r === 'object' ? String(r.origin || '') : (typeof r === 'string' ? r : '');
  return Object.prototype.hasOwnProperty.call(ORIGIN_RANK, o) ? Object.assign({}, r && typeof r === 'object' ? r : {}, { origin: o }) : null;
}

/**
 * The dotted fields a save CARRIED whose value came from somewhere other than
 * the operator's typing, mapped to the provenance row that says where. A
 * document's field cites the file (or URL), the page and the verbatim line.
 */
function recordedOrigins(input) {
  const out = {};
  for (const f of carriedFields(input)) {
    const r = fieldOriginOf(input, f);
    if (!r || !RECORDED_ORIGINS.has(r.origin)) continue;
    const where = [r.page ? `p.${r.page}` : '', r.line ? `l.${r.line}` : ''].filter(Boolean).join(' ');
    out[f] = {
      origin: r.origin,
      source_url: str(r.url || (r.source ? r.source + (r.page ? `#page=${r.page}` : '') : ''), 500),
      signal: str([where, r.quote ? `"${r.quote}"` : '', r.signal || ''].filter(Boolean).join(': '), 500),
      confidence: str(r.confidence || (r.origin === 'document' ? 'stated' : ''), 40),
      value_preview: str(r.value, 200),
    };
  }
  return out;
}

function claimedFields(input) {
  // A field whose value the save says came from a document, a site read or a
  // preset is not a TYPED field, so it is not claimed as the operator's; it is
  // recorded with its origin instead (recordedOrigins). A field with no origin
  // on the save is claimed, exactly as before.
  return carriedFields(input).filter((f) => {
    const r = fieldOriginOf(input, f);
    return !r || r.origin === 'user';
  });
}

/** Every dotted field path a save carried a non-empty value for. */
function carriedFields(input) {
  const b = (input && typeof input === 'object') ? input : {};
  const out = [];
  for (const k of ['name', 'tagline', 'legal_name', 'industry', 'website', 'logo_url', 'favicon_url']) {
    if (b[k] !== undefined && str(b[k])) out.push(k);
  }
  if (b.palette && typeof b.palette === 'object') {
    for (const k of ['primary', 'accent', 'ink', 'surface', 'surface_alt', 'muted']) {
      if (b.palette[k]) out.push(`palette.${k}`);
    }
  }
  if (b.typography && typeof b.typography === 'object') {
    for (const k of ['heading', 'body', 'mono']) if (b.typography[k]) out.push(`typography.${k}`);
  }
  if (b.voice && typeof b.voice === 'object') {
    for (const k of ['tone', 'preferred', 'notes', 'banned']) {
      const v = b.voice[k];
      if (v !== undefined && (Array.isArray(v) ? v.length : str(v))) out.push(`voice.${k}`);
    }
  }
  if (b.brand_data && typeof b.brand_data === 'object') {
    for (const k of ['claims', 'social', 'legal_entity']) {
      const v = b.brand_data[k];
      if (v !== undefined && (Array.isArray(v) ? v.length : str(v))) out.push(`brand_data.${k}`);
    }
  }
  if (Array.isArray(b.regions) && b.regions.length) out.push('regions');
  return out;
}

/**
 * Record the operator's ownership of the fields they just saved.
 *
 * Best-effort on purpose: a workspace save must never fail because the
 * provenance migration has not been applied yet. The consequence of it failing
 * is that an automatic run may later overwrite that field - which is the
 * behaviour that existed before any of this - not a corrupted record.
 */
async function claimUserOwnedFields(auth, workspaceId, input) {
  let n = 0;
  try {
    const fields = claimedFields(input);
    if (fields.length && workspaceId) {
      await restAs(auth.token, 'rpc/brand_fields_claim_user', {
        method: 'POST', body: { p_workspace: workspaceId, p_fields: fields },
      });
      n += fields.length;
    }
  } catch (err) {
    console.warn('[brand] field provenance not recorded:', (err && err.message) || err);
  }
  // The rest of the save's fields, with the origin each came from. The SQL
  // never demotes (a typed field stays typed), so this cannot take a field
  // away from a person.
  try {
    const rec = recordedOrigins(input);
    if (Object.keys(rec).length && workspaceId) {
      await restAs(auth.token, 'rpc/brand_fields_record_origin', {
        method: 'POST', body: { p_workspace: workspaceId, p_fields: rec },
      });
      n += Object.keys(rec).length;
    }
  } catch (err) {
    console.warn('[brand] field origins not recorded:', (err && err.message) || err);
  }
  return n;
}

/* ── A SAVE OF AN EXISTING BRAND (reviews of PRs #127 and #143, 2026-10-04) ──
   The save used to PATCH every field it carried and only then ask the
   database whose each one was. Two tabs: tab B saves a tagline the person
   typed; tab A, opened earlier, applies a brand guideline and saves. A's PATCH
   wrote the document's tagline over B's, the provenance check then (rightly)
   kept `user`, and the record said a person typed a value no person typed.
   A first fix split the save into a claim, a PATCH and an apply, and review
   found what splitting cost: a claim committed before a write that then
   failed; the wizard's placeholders (origin 'default') still riding the PATCH
   over another tab's document value; and the design rules judging the
   INCOMING palette rather than the one that would be stored. So it is ONE
   decision and ONE statement:
     1. Read the row and who owns each field.
     2. Work out the EFFECTIVE row: what the person typed; each value another
        source set (document > site-render > site-parse > preset) only where
        it ranks at least as high as the recorded owner; the row's OWN value
        everywhere else - every placeholder included.
     3. Check the design rules on THAT (buildRow), so a refused document
        colour cannot block a save and an applied one cannot slip through.
     4. brand_workspace_save() writes it, claims the typed fields and records
        each applied value's origin in one transaction under the row lock, and
        answers `stale` if the row or any owner the decision rested on moved
        since step 1 - then the save starts again from step 1. */
const SAVE_ATTEMPTS = 4;
/* Every dotted field a save can carry (the paths carriedFields() emits). */
const SAVE_FIELDS = ['name', 'tagline', 'legal_name', 'industry', 'website', 'logo_url', 'favicon_url',
  'palette.primary', 'palette.accent', 'palette.ink', 'palette.surface', 'palette.surface_alt', 'palette.muted',
  'typography.heading', 'typography.body', 'typography.mono',
  'voice.tone', 'voice.preferred', 'voice.notes', 'voice.banned',
  'brand_data.claims', 'brand_data.social', 'brand_data.legal_entity', 'regions'];

/** `input` with each listed field replaced by the row's own value (or removed when the row has none). */
function withRowValues(input, existing, fields) {
  const b = JSON.parse(JSON.stringify(input || {}));
  const prev = existing || {};
  for (const f of fields) {
    const dot = f.indexOf('.');
    if (dot < 0) {
      if (prev[f] !== undefined && prev[f] !== null) b[f] = JSON.parse(JSON.stringify(prev[f])); else delete b[f];
      continue;
    }
    const col = f.slice(0, dot), leaf = f.slice(dot + 1);
    const was = prev[col] && typeof prev[col] === 'object' ? prev[col][leaf] : undefined;
    b[col] = b[col] && typeof b[col] === 'object' ? Object.assign({}, b[col]) : {};
    if (was !== undefined && was !== null) b[col][leaf] = JSON.parse(JSON.stringify(was)); else delete b[col][leaf];
  }
  return b;
}

/** The fields the save says nobody chose: the wizard's placeholders. */
function placeholderFields(input) {
  return SAVE_FIELDS.filter((f) => { const r = fieldOriginOf(input, f); return !!r && r.origin === 'default'; });
}

/** Who owns each field of this brand now, as the database records it. */
async function fieldOwners(auth, id) {
  const rows = await restAs(auth.token, `brand_field_provenance?select=field,origin&workspace_id=eq.${encodeURIComponent(id)}`);
  const out = {};
  for (const r of (Array.isArray(rows) ? rows : [])) if (r && r.field) out[r.field] = String(r.origin || '');
  return out;
}

async function saveExisting(auth, id, input) {
  const typed = claimedFields(input);
  const others = recordedOrigins(input);
  const placeholders = placeholderFields(input);
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const existing = await getWorkspace(auth, id);
    if (!existing) { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
    const owners = await fieldOwners(auth, id);
    const seen = {}, applied = {}, keepRow = placeholders.slice();
    for (const [f, rec] of Object.entries(others)) {
      const have = owners[f] || '';
      seen[f] = have || null;
      if (!have || (ORIGIN_RANK[rec.origin] || 0) >= (ORIGIN_RANK[have] || 0)) applied[f] = rec;
      else keepRow.push(f);
    }
    // The design rules are checked HERE, on what will be stored.
    const row = buildRow(keepRow.length ? withRowValues(input, existing, keepRow) : input, existing);
    const out = await restAs(auth.token, 'rpc/brand_workspace_save', {
      method: 'POST',
      body: { p_workspace: id, p_expected: existing.updated_at || null, p_seen: seen, p_row: row, p_typed: typed, p_origins: applied },
    });
    if (out && out.ok && out.row) {
      invalidateBrandCaches({ userId: auth.user_id, workspaceId: id });
      return out.row;
    }
    if (out && out.error === 'not_found') { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
    if (!out || out.error !== 'stale') {
      const e = new Error(`The brand could not be saved (${(out && (out.error || out.message)) || 'no answer from the database'}). Nothing was changed.`);
      e.status = 502; throw e;
    }
    // Another save landed between the read and the write: decide again on the fresh row.
  }
  const e = new Error('This brand kept changing in another tab or window while it was being saved, so nothing here was written over it. Reload the brand and save again.');
  e.status = 409; e.code = 'save_conflict';
  throw e;
}

async function saveWorkspace(auth, input) {
  const id = str(input && input.id);
  if (id) return saveExisting(auth, id, input);
  const row = buildRow(input, null);
  row.owner_id = auth.user_id;
  const created = await restAs(auth.token, `brand_workspaces?select=${SELECT_COLS}`, {
    method: 'POST', body: [row], prefer: 'return=representation',
  });
  const ws = Array.isArray(created) ? created[0] : created;
  if (ws && ws.id) await claimUserOwnedFields(auth, ws.id, input);
  // First workspace a user creates becomes their active one automatically.
  if (ws && ws.id && !(await activeWorkspaceId(auth))) await setActive(auth, ws.id);
  invalidateBrandCaches({ userId: auth.user_id, workspaceId: ws && ws.id });
  return ws;
}

/**
 * Remove a brand, and only report it removed if a row actually went.
 *
 * This used to fire the DELETE with `return=minimal` and return
 * `{ok:true, deleted:id}` no matter what came back. RLS restricts deletion to
 * `owner_id = auth.uid()` ("workspace delete by owner"), so a member who is not
 * the owner - and anyone passing an id that does not exist - got a 204 with
 * ZERO rows removed and was told the brand was deleted. The brand was still
 * there on the next load. A destructive action that reports success it did not
 * have is worse than one that fails loudly.
 *
 * `return=representation` makes the answer checkable: the rows actually deleted
 * come back, so absence is distinguishable from success.
 */
async function deleteWorkspace(auth, id) {
  const wsId = str(id);
  if (!wsId) { const e = new Error('Which brand? No workspace id was supplied.'); e.status = 400; throw e; }

  // Read first, so "not yours" and "does not exist" get different answers. A
  // non-member cannot see the row at all, which is the correct RLS behaviour
  // and reads as "not found" - deliberately not "exists but is not yours".
  const ws = await getWorkspace(auth, wsId);
  if (!ws) { const e = new Error('Brand not found (or not yours).'); e.status = 404; throw e; }
  if (ws.owner_id && ws.owner_id !== auth.user_id) {
    const e = new Error('Only the owner can delete a brand. You can edit it, or ask the owner to remove it.');
    e.status = 403; throw e;
  }

  // The brand's HOSTED files go first, while the row still exists: the
  // bucket's delete policy asks is_brand_editor() of this very workspace.
  // Public objects left behind would stay readable (and billed) forever.
  const assets = await removeBrandAssets(auth, wsId);

  const gone = await restAs(auth.token, `brand_workspaces?id=eq.${encodeURIComponent(wsId)}&select=id,name`, {
    method: 'DELETE', prefer: 'return=representation',
  });
  const rows = Array.isArray(gone) ? gone : (gone ? [gone] : []);
  if (!rows.length) {
    // Reached only if the row vanished between the read and the delete, or a
    // policy refused it without erroring. Either way nothing was removed.
    const e = new Error('Nothing was deleted - the brand may have already been removed, or a policy refused it.');
    e.status = 409; throw e;
  }

  // Nothing survives a delete: the default-workspace cache is keyed on "oldest
  // row", which the delete may itself have removed.
  invalidateBrandCaches({ userId: auth.user_id, workspaceId: wsId });

  /* Every brand-owned TABLE cascades (connections, secrets, competitors,
     context packs, review library, credits, telesuite, payments). Storage does
     NOT: re-hosted review images live in the `brand-review-media` bucket under
     `<workspace_id>/...` and no foreign key reaches them, so they are reported
     rather than silently orphaned. */
  return {
    ok: true,
    deleted: wsId,
    name: (rows[0] && rows[0].name) || ws.name || null,
    storage_removed: assets.removed,
    storage_note: `Re-hosted media under brand-review-media/${wsId}/ is not removed by this delete and must be cleared separately.`
      + (assets.note ? ` ${assets.note}` : ''),
  };
}

/**
 * Remove every object a brand HOSTED in the public `brand-assets` bucket
 * (logo, app icon, fonts, imagery - migration 20261004120000), with the
 * caller's own token, under the workspace's prefix. Resolves
 * { removed, note }. Throws 502 when objects exist and could not be removed:
 * a brand is never deleted while its public files would be orphaned.
 */
async function removeBrandAssets(auth, wsId) {
  let e;
  try { e = env(); } catch (_) { return { removed: 0, note: '' }; }
  const base = `${e.url}/storage/v1/object`;
  const headers = { apikey: e.anon, authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' };
  // A listing that did not answer is NOT an empty folder: deleting the brand
  // on it would orphan every public file it could not see. So anything but a
  // readable list (or Storage saying the bucket itself does not exist, when no
  // file can be in it) stops the delete with a sentence.
  const refuse = (why) => {
    const er = new Error(`The hosted files of this brand (brand-assets/${wsId}/) could not be listed (${why}), so nothing was deleted: deleting the brand without knowing what it hosts could leave public files behind. Try again.`);
    er.status = 502;
    return er;
  };
  const PAGE = 1000;
  const paths = [];
  for (let offset = 0; ; offset += PAGE) {
    let listed;
    try {
      listed = await fetch(`${base}/list/brand-assets`, { method: 'POST', headers, body: JSON.stringify({ prefix: wsId, limit: PAGE, offset }), cache: 'no-store' });
    } catch (err) { throw refuse((err && err.message) || 'storage did not answer'); }
    let items = null;
    try { items = await listed.json(); } catch (_) { items = null; }
    if (!listed.ok) {
      const said = items && typeof items === 'object' ? String(items.error || items.message || '') : '';
      if ((listed.status === 400 || listed.status === 404) && /^bucket not found$/i.test(said.trim())) return { removed: 0, note: '' };
      throw refuse(`it answered ${listed.status}${said ? ': ' + said.slice(0, 120) : ''}`);
    }
    if (!Array.isArray(items)) throw refuse('its answer was not a list');
    for (const x of items) if (x && x.name && x.id !== null) paths.push(`${wsId}/${x.name}`);
    if (items.length < PAGE) break;
  }
  if (!paths.length) return { removed: 0, note: '' };
  let res;
  try {
    res = await fetch(`${base}/brand-assets`, { method: 'DELETE', headers, body: JSON.stringify({ prefixes: paths }), cache: 'no-store' });
  } catch (_) { res = null; }
  if (!res || !res.ok) {
    const er = new Error(`This brand has ${paths.length} hosted file(s) in brand-assets/${wsId}/ that could not be removed (${res ? res.status : 'storage did not answer'}), so nothing was deleted: deleting the brand now would leave them public. Try again.`);
    er.status = 502;
    throw er;
  }
  return { removed: paths.length, note: '' };
}

/** Owner or editor. A `viewer` may read a workspace but must not change it. */
async function assertCanWrite(auth, workspaceId, what) {
  const ws = await getWorkspace(auth, workspaceId);
  if (!ws) { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
  if (ws.owner_id === auth.user_id) return ws;
  let role = 'viewer';
  try {
    const rows = await restAs(auth.token, `brand_workspace_members?select=role&workspace_id=eq.${encodeURIComponent(workspaceId)}&user_id=eq.${encodeURIComponent(auth.user_id)}&limit=1`);
    if (Array.isArray(rows) && rows[0] && rows[0].role) role = String(rows[0].role);
  } catch (_) { /* least privilege on an unknown role */ }
  if (role !== 'owner' && role !== 'editor') {
    const e = new Error(`Your role on this brand is "${role}", which can view it but not ${what || 'change it'}. Ask the workspace owner for editor access.`);
    e.status = 403; throw e;
  }
  return ws;
}

/**
 * Read a catalogue SOURCE into rows: the store URL (catalog-import.js: feed,
 * sitemap + JSON-LD, or crawl - resumable), a pasted CSV, or a JSON export.
 * Writes nothing. Shared by the account import below and the device import
 * (2026-10-03), so the two read a catalogue identically and differ only in
 * where the rows are kept.
 *
 * `cursor` resumes a store read a previous invocation could not finish.
 */
async function readCatalogSource({ region, kind, text, url, scope, cursor, budgetMs }) {
  // Rows are filed under the region asked for, else the brand's HOME market
  // (its record's flag) - never a literal 'us' (2026-10-05). The wizard
  // already refuses without a home market; this is the same rule one layer
  // down, for every other caller.
  const reg = str(region, 12).toLowerCase() || require('./brand-locale.js').homeMarket(scope).toLowerCase();
  if (!reg) {
    const marker = require('./brand-locale.js').marker('home market', scope && scope.name ? scope : 'this brand');
    const e = new Error(`${marker} No region was named and the brand's record lists no market, so there is nowhere to file these products. Add its regions in Brand setup, then import.`);
    e.status = 400; e.code = 'region_required'; throw e;
  }
  const k = str(kind).toLowerCase();

  if (text && String(text).length > MAX_UPLOAD_CHARS) {
    const e = new Error(`That file is too large (max ${Math.round(MAX_UPLOAD_CHARS / 1e6)}MB of text per import).`);
    e.status = 413; throw e;
  }

  let parsed;
  if (k === 'storefront' || k === 'shopify_public' || k === 'site' || k === 'site_crawl') {
    parsed = await rowsFromStore(url, reg, scope, { cursor, budgetMs, strictScope: k === 'site' || k === 'site_crawl' });
  } else if (k === 'json') parsed = fileCoverage(rowsFromJson(text, reg), 'JSON export', reg);
  else if (k === 'csv') parsed = fileCoverage(rowsFromCsv(text, reg), 'CSV', reg);
  else { const e = new Error('kind must be one of: csv, json, storefront, site.'); e.status = 400; throw e; }

  if (!parsed.rows.length && parsed.complete !== false && !(parsed.coverage && parsed.coverage.found)) {
    // Say which routes were tried and what the store published, so the answer
    // is actionable rather than a dead end: the operator can paste a CSV
    // instead, or add structured data. Nothing here is a fault in their store.
    const sf = parsed && parsed.storefront;
    let tried = '';
    if (parsed.coverage && parsed.coverage.sentences) tried += ' ' + parsed.coverage.sentences.join(' ');
    if (sf && sf.detected) {
      tried += ` This site is ${sf.platform.name} (${sf.platform.why}). ${sf.catalog_route.note}`
        + ' Nothing here is a fault in your store: it means the pages that were read declare no structured product data, so add it, or import a CSV.';
    } else if (k !== 'csv' && k !== 'json') {
      tried += ' No commerce platform declared itself on the pages that were read, so there was no feed to prefer.';
    }
    const e = new Error('No usable product rows were found in that source.' + tried);
    e.status = 400; e.coverage = parsed.coverage || null; throw e;
  }
  return { parsed, reg, k };
}

/** A file import reads everything it was given in one call: its coverage says so. */
function fileCoverage(parsed, label, reg) {
  const R = String(reg || '').toUpperCase();
  const rows = parsed.rows || [];
  const noPrice = rows.filter((r) => r.price == null).length;
  const noImage = rows.filter((r) => !r.image_url).length;
  const s = [`Read ${rows.length.toLocaleString('en-US')} product row(s) from the ${label}.`];
  if (parsed.skipped) s.push(`${parsed.skipped} row(s) skipped because they state no title.`);
  if (noPrice) s.push(`${noPrice} product(s) state no price; they carry [DATA REQUIRED BEFORE LAUNCH: price, <product>, ${R}] rather than a number.`);
  if (noImage) s.push(`${noImage} product(s) state no image; they carry [DATA REQUIRED BEFORE LAUNCH: product image, <product>, ${R}].`);
  s.push('Complete: a file is read whole in one call.');
  return Object.assign({}, parsed, {
    complete: true, cursor: null, run: require('crypto').randomUUID(),
    coverage: {
      route: 'file', region: R, found: rows.length, complete: true, resume_available: false, stopped: null,
      by_source: { file: rows.length }, skipped: { no_title: parsed.skipped || 0 }, missing: { price: noPrice, image: noImage }, sentences: s,
    },
  });
}

/** The coverage a person reads, without the per-URL lists. */
function coverageSummary(c) {
  if (!c) return null;
  return {
    route: c.route, region: c.region, base: c.base || null, base_from: c.base_from || null, currency: c.currency || null,
    declared: c.declared ? { count: c.declared.count || null, urls: c.declared.urls || null, by: c.declared.by } : null,
    found: c.found, by_source: c.by_source, skipped: c.skipped, missing: c.missing,
    missing_examples: (c.missing_examples || []).slice(0, 5),
    complete: !!c.complete, resume_available: !!c.resume_available, stopped: c.stopped || null,
    sentences: (c.sentences || []).slice(0, 20),
  };
}

/** Where a catalogue came from, as recorded beside the brand. */
function catalogSourceRecord(parsed, k, url, rowCount, batch, reg) {
  const sf = parsed && parsed.storefront;
  const cov = coverageSummary(parsed && parsed.coverage);
  return {
    kind: k === 'storefront' ? 'shopify_public' : (k === 'site' ? 'site_crawl' : k),
    url: (k === 'storefront' || k === 'site' || k === 'site_crawl' || k === 'shopify_public') ? (parsed.base || httpUrl(url)) : '',
    imported_at: new Date().toISOString(),
    row_count: rowCount,
    batch,
    region: reg,
    columns: parsed.columns || {},
    // WHICH STORE THIS CAME FROM. Recorded on the workspace row the generators
    // read, so the answer is established once instead of re-derived by a failed
    // request on every import. Null when the site published no platform signal
    // — which is not the same as "no store".
    platform: sf && sf.detected
      ? { id: sf.platform.id, name: sf.platform.name, confidence: sf.platform.confidence, source_url: sf.platform.source_url, route: sf.catalog_route.kind }
      : null,
    // What the import read of what the source declares, in sentences, and
    // whether it finished. A partial import is never presented as the catalogue.
    complete: !!(parsed && parsed.complete),
    found: cov ? cov.found : rowCount,
    declared: cov && cov.declared ? cov.declared.count : null,
    coverage: cov,
    sitemap: cov && parsed.coverage && parsed.coverage.sitemap ? { found: !!parsed.coverage.sitemap.found, sources: (parsed.coverage.sitemap.sources || []).length } : null,
    coverage_note: cov ? cov.sentences.join(' ') : '',
  };
}

/* ── A CATALOGUE KEPT ON THE DEVICE (2026-10-03) ─────────────────────────────
   A mobile-number sign-in keeps its brands on the device it signed in on, so
   "Import catalog" was refused to it ("Not available on a mobile-number
   account"): the rows were filed under a brand in the workspace database, and
   restAs() refuses a phone token in every mode. But reading a store, a CSV or
   a JSON export needs no database at all - only FILING the rows did. So for
   that caller the same reader runs and the rows come back in the response, for
   the browser to keep beside the brand on the device (brand-context.js). The
   scope of a crawl is the brand the request carried, exactly as a workspace
   row would have supplied it; the SSRF guard and the site's own scope rules
   run unchanged. Nothing is written here.

   2026-10-10: one call returns ONE STEP of a store read - its rows, the cursor
   to resume from (null when the store is exhausted) and the coverage. The
   browser merges the rows into the catalogue it keeps (upsert by identity,
   stale marking once complete: brand-context.js mergeDeviceCatalog, the twin of
   catalog-import.mergeRows) and sends the cursor back on Continue import. */
const DEVICE_CATALOG_ROWS = 10000;
const DEVICE_ROW_FIELDS = ['region', 'sku', 'handle', 'title', 'description', 'product_type', 'collections', 'price',
  'compare_at', 'currency', 'image_url', 'image_urls', 'variants', 'product_url', 'in_stock', 'tags', 'source', 'source_url'];

/** A phone sign-in whose brands are on its DEVICE: Neon or device mode. A phone
 *  account in Supabase Auth (mode 'supabase', #119) has workspaces like any account. */
function isPhoneAuth(auth) { return !!(auth && auth.ok !== false && auth.provider === 'mobile-pin' && auth.mode !== 'supabase'); }

/** De-duplicate a step's rows on the catalogue's identity (region, handle, sku). */
function uniqueRows(rows) {
  const { rowKey } = require('./catalog-import.js');
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const key = rowKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function deviceCatalogImport(auth, { region = '', kind, text, url, brand, cursor, budgetMs }) {
  const b = brand && typeof brand === 'object' && !Array.isArray(brand) ? brand : {};
  const scope = {
    name: typeof b.name === 'string' ? b.name.slice(0, 120) : '',
    website: httpUrl(b.website) || httpUrl(url) || '',
    regions: Array.isArray(b.regions) ? b.regions.slice(0, 20) : [],
    asset_hosts: Array.isArray(b.asset_hosts) ? b.asset_hosts.filter((h) => typeof h === 'string').slice(0, 20) : [],
  };
  let resume = cursor && typeof cursor === 'object' ? cursor : null;
  // The twin of importCatalog's rule: a cursor for another URL, or for a store
  // on another brand's site, is discarded and the read starts again.
  let restarted = '';
  if (resume) {
    const ci = require('./catalog-import.js');
    const asked = httpUrl(url);
    const problem = ci.cursorProblem(resume, { region: str(region || resume.region, 12).toLowerCase(), url: asked || resume.start, identity: ci.identityOf(scope) });
    if (problem) {
      url = asked || scope.website || resume.start;
      restarted = `The unfinished import was not continued: ${problem}. This import reads ${String(url).replace(/\/$/, '')} from the beginning.`;
      resume = null;
      kind = 'storefront';
    }
  }
  const { parsed, reg, k } = await readCatalogSource({ region, kind: resume ? 'storefront' : kind, text, url: (resume && resume.start) || url, scope, cursor: resume, budgetMs });
  if (restarted && parsed.coverage && Array.isArray(parsed.coverage.sentences)) parsed.coverage.sentences.unshift(restarted);
  const products = [];
  for (const r of uniqueRows(parsed.rows)) {
    const row = {};
    for (const f of DEVICE_ROW_FIELDS) if (r[f] !== undefined) row[f] = r[f];
    products.push(row);
  }
  const kept = products.slice(0, DEVICE_CATALOG_ROWS);
  const batch = parsed.run || require('crypto').randomUUID();
  const source = catalogSourceRecord(parsed, resume ? 'storefront' : k, url, kept.length, batch, reg);
  return {
    ok: true,
    imported: kept.length,
    skipped: (parsed.skipped || 0) + (products.length - kept.length),
    region: reg,
    storage: 'device',
    products: kept,
    run: batch,
    complete: !!parsed.complete,
    resume_available: !parsed.complete,
    cursor: parsed.cursor || null,
    family: require('./catalog-import.js').familyOf(k),
    coverage: coverageSummary(parsed.coverage),
    source,
    note: products.length > kept.length
      ? `Kept the first ${kept.length} of ${products.length} products on this device; a browser holds a bounded amount. Nothing was invented for the rest.`
      : (parsed.complete ? 'Kept on this device, beside the brand. Nothing was written to a database.'
        : 'Kept on this device, beside the brand. The store was not read to the end in this call: Continue import resumes where it stopped.'),
  };
}

/**
 * One step of the merge into the workspace's catalogue, in chunks the request
 * size can carry. The state (cursor + coverage) and catalog_source ride the
 * LAST chunk, so they are recorded in the same transaction as the rows that
 * finish the step - for an editor as for the owner (the table's update policy
 * is owner-only, which silently dropped an editor's catalog_source PATCH).
 */
async function mergeIntoWorkspace(token, { workspace_id, reg, rows, run, complete, family, state, source }) {
  const CHUNK = 400;
  const out = { inserted: 0, updated: 0, staled: 0, live: null };
  const chunks = [];
  for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK));
  if (!chunks.length) chunks.push([]);
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    const r = await restAs(token, 'rpc/brand_catalog_merge', {
      method: 'POST',
      body: {
        p_workspace: workspace_id, p_region: reg, p_rows: chunks[i], p_run: run,
        p_complete: last && !!complete, p_family: family,
        p_state: last ? state : null, p_source: last ? source : null,
      },
    });
    out.inserted += (r && r.inserted) || 0;
    out.updated += (r && r.updated) || 0;
    out.staled += (r && r.staled) || 0;
    if (r && typeof r.live === 'number') out.live = r.live;
  }
  return out;
}

/**
 * Import (or continue importing) a catalogue into a workspace.
 *
 *   continue: true   resume the run recorded on the workspace (catalog_import.cursor)
 *   replace:  false  additive: rows are upserted and nothing is marked stale
 *
 * Every call upserts what it read - never a duplicate, never a delete - and a
 * run that has read its WHOLE source marks the rows that source no longer
 * lists as stale (kept, skipped by the generators).
 */
async function importCatalog(auth, { workspace_id, region = '', kind, text, url, replace = true, brand, cursor, continue: resume = false, budgetMs }) {
  // A mobile-number sign-in has no workspace row to file under: the rows go
  // back to its device instead (see deviceCatalogImport above).
  if (isPhoneAuth(auth)) return deviceCatalogImport(auth, { region, kind, text, url, brand, cursor, budgetMs });
  // An import writes the catalogue, so membership is not enough - this needs
  // write permission. brand_catalog_merge() checks it too.
  const ws = await assertCanWrite(auth, workspace_id, 'import or replace its catalog');

  let prior = null;
  let restarted = '';
  if (resume) {
    const rows = await restAs(auth.token, `brand_workspaces?select=catalog_import&id=eq.${encodeURIComponent(workspace_id)}&limit=1`).catch(() => null);
    prior = Array.isArray(rows) && rows[0] && rows[0].catalog_import && rows[0].catalog_import.cursor ? rows[0].catalog_import : null;
    if (!prior) {
      const e = new Error('There is no unfinished catalogue import on this brand to continue. Import it again to read it from the start.');
      e.status = 409; e.code = 'nothing_to_continue'; throw e;
    }
    region = prior.region || region;
    kind = prior.kind || 'storefront';
    // A cursor is a place in ONE source (2026-10-10). Continue import on the
    // live record resumed nike.in after the person had corrected the store to
    // the brand's own site: the URL in the import box is the source, and a
    // cursor for another URL, or for a store on another brand's site, is
    // discarded and the read starts again, said in a sentence.
    const asked = httpUrl(url);
    const priorStart = (prior.cursor && prior.cursor.start) || prior.start || prior.url || '';
    const problem = require('./catalog-import.js').cursorProblem(prior.cursor, { region: str(region, 12).toLowerCase(), url: asked || priorStart, identity: require('./catalog-import.js').identityOf(ws) });
    if (problem) {
      url = asked || ws.website || priorStart;
      restarted = `The unfinished import was not continued: ${problem}. This import reads ${String(url).replace(/\/$/, '')} from the beginning.`;
      prior = null;
    } else url = priorStart || url;
  }
  const { parsed, reg, k } = await readCatalogSource({ region, kind, text, url, scope: ws, cursor: prior ? prior.cursor : null, budgetMs });
  if (restarted && parsed.coverage && Array.isArray(parsed.coverage.sentences)) parsed.coverage.sentences.unshift(restarted);
  const rows = uniqueRows(parsed.rows);
  const run = parsed.run || require('crypto').randomUUID();
  const family = require('./catalog-import.js').familyOf(k);
  const complete = !!parsed.complete;
  const source = catalogSourceRecord(parsed, k, url, rows.length, run, reg);
  const state = {
    // `url` is the URL asked for (what Continue import resumes), `base` the
    // store actually read; they differ when a region's own store was read.
    run, kind: k, url: parsed.start || httpUrl(url) || '', base: parsed.base || '', region: reg,
    cursor: complete ? null : (parsed.cursor || null),
    coverage: coverageSummary(parsed.coverage),
    updated_at: new Date().toISOString(),
  };

  let merged;
  try {
    merged = await mergeIntoWorkspace(auth.token, { workspace_id, reg, rows, run, complete: complete && replace !== false, family, state, source });
  } catch (e) {
    // A database that has not been migrated (20261010002000) has no merge. A
    // complete one-call import can still land the old way, and says so; a
    // partial one cannot keep its place, and says that instead.
    if (!/brand_catalog_merge/.test(String(e && e.message)) || !/404|PGRST202|Could not find/i.test(String(e && e.message))) throw e;
    if (!complete) {
      const err = new Error('This database has not been migrated for resumable catalogue imports (migration 20261010002000), so a store that does not fit one call cannot keep its place. Apply the migration, or import a CSV.');
      err.status = 503; err.code = 'migration_missing'; throw err;
    }
    const out = await restAs(auth.token, 'rpc/brand_catalog_replace', {
      method: 'POST', body: { p_workspace: workspace_id, p_region: reg, p_rows: rows, p_batch: run },
    });
    await restAs(auth.token, `brand_workspaces?id=eq.${encodeURIComponent(workspace_id)}`, {
      method: 'PATCH', body: { catalog_source: source }, prefer: 'return=minimal',
    });
    merged = { inserted: (out && out.inserted) || rows.length, updated: 0, staled: 0, live: null, note: 'Replaced, not merged: migration 20261010002000 is not applied here, so products the store no longer lists were deleted rather than marked stale.' };
  }
  // catalog_source lives on the workspace row the generators read, and the
  // rows feed brand-catalog-server's cache: both are dropped here.
  invalidateBrandCaches({ userId: auth.user_id, workspaceId: workspace_id });
  try { require('./brand-catalog-server.js').invalidate(workspace_id); } catch (_) { /* never fails a write */ }
  let tally = null;
  try { tally = await productTally(auth, Object.assign({}, ws, { catalog_source: source })); } catch (_) { tally = null; }

  return {
    ok: true,
    imported: rows.length,
    skipped: parsed.skipped || 0,
    region: reg,
    run,
    complete,
    resume_available: !complete,
    inserted: merged.inserted, updated: merged.updated, staled: merged.staled, live: merged.live,
    // Of the live rows, how many are this brand's and how many another site's.
    own: tally ? tally.own : null, excluded: tally ? tally.excluded : null, excluded_domains: tally ? tally.excluded_domains : [],
    coverage: state.coverage,
    source,
    note: merged.note || undefined,
  };
}

async function listCatalog(auth, { workspace_id, region, limit = 60 }) {
  const lim = Math.max(1, Math.min(500, +limit || 60));
  const base = `brand_catalog_products?workspace_id=eq.${encodeURIComponent(workspace_id)}&order=title.asc&limit=${lim}`
    + (region ? `&region=eq.${encodeURIComponent(String(region).toLowerCase())}` : '');
  const cols = 'id,region,sku,handle,title,product_type,collections,price,compare_at,currency,image_url,product_url,in_stock,source';
  let rows;
  try { rows = await restAs(auth.token, `${base}&select=${cols},image_urls,variants,stale_at`); }
  catch (e) {
    // A database without 20261010002000 has no stale_at / image_urls / variants.
    if (!/stale_at|image_urls|variants|42703/.test(String(e && e.message))) throw e;
    rows = await restAs(auth.token, `${base}&select=${cols}`);
  }
  return Array.isArray(rows) ? rows : [];
}

/**
 * What the catalogue import of a workspace read, what it did not, and whether
 * it can continue - for /connections and the onboarding catalogue step.
 */
async function catalogStatus(auth, workspaceId) {
  const ws = await getWorkspace(auth, workspaceId);
  if (!ws) { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
  let imp = {};
  try {
    const rows = await restAs(auth.token, `brand_workspaces?select=catalog_import&id=eq.${encodeURIComponent(workspaceId)}&limit=1`);
    imp = (Array.isArray(rows) && rows[0] && rows[0].catalog_import) || {};
  } catch (_) { imp = {}; }
  const counts = await catalogCounts(auth, workspaceId);
  return {
    ok: true,
    workspace_id: workspaceId,
    source: ws.catalog_source || {},
    coverage: imp.coverage || (ws.catalog_source && ws.catalog_source.coverage) || null,
    resume_available: !!imp.cursor,
    region: imp.region || (ws.catalog_source && ws.catalog_source.region) || null,
    updated_at: imp.updated_at || null,
    live: counts.live,
    stale: counts.stale,
  };
}

/** Live and stale rows of a workspace, counted page by page (PostgREST answers at most max_rows per request). */
async function catalogCounts(auth, id) {
  const count = async (filter) => {
    let n = 0;
    for (let offset = 0; offset < 200000; offset += 1000) {
      const rows = await restAs(auth.token, `brand_catalog_products?select=id&workspace_id=eq.${encodeURIComponent(id)}${filter}&order=id.asc&limit=1000&offset=${offset}`);
      const got = Array.isArray(rows) ? rows.length : 0;
      n += got;
      if (!got) break;
    }
    return n;
  };
  try { return { live: await count('&stale_at=is.null'), stale: await count('&stale_at=not.is.null') }; }
  catch (e) {
    if (!/stale_at|42703/.test(String(e && e.message))) return { live: 0, stale: 0 };
    try { return { live: await count(''), stale: 0 }; } catch (_) { return { live: 0, stale: 0 }; }
  }
}

/** The payload the browser shell needs to become this brand. */
/** The brand-list badge: does this record describe one brand? (brand-coherence.js) */
function coherenceSummary(brand) {
  if (!brand || !brand.brand_data) return null;
  const c = coherence.brandCoherence(brand);
  return { ok: c.ok, blocking: c.blocking, count: c.conflicts.length, summary: c.summary };
}

/**
 * Whose catalogue this record carries, for GENERATION (2026-10-10): the
 * coherence rule's catalogue verdict, so a page (brand-catalog.js) never shows
 * or composes another brand's products under this brand's name. Mirrored by
 * catalogIdentityFor() in brand-context.js.
 */
function catalogIdentitySummary(brand) {
  if (!brand || typeof brand !== 'object') return null;
  const v = coherence.catalogIdentity(brand);
  return { excluded: v.excluded, domain: v.domain, allowed: v.allowed, marker: v.marker, sentence: v.sentence };
}

function shellPayload(brand, extra) {
  if (!brand) return null;
  return Object.assign({
    id: brand.id || null,
    slug: brand.slug || '',
    name: brand.name || '',
    tagline: brand.tagline || '',
    logo_url: brand.logo_url || '',
    favicon_url: brand.favicon_url || '',
    website: brand.website || '',
    status: brand.status || 'draft',
    onboarding_step: brand.onboarding_step || 1,
    palette: brand.palette || {},
    typography: brand.typography || {},
    voice: brand.voice || {},
    regions: brand.regions || [],
    tokens: tokens(brand),
    fonts_href: fontsHref(brand),
    files: filesSummary(brand),
    coherence: coherenceSummary(brand),
    catalog_identity: catalogIdentitySummary(brand),
  }, extra || {});
}

/**
 * What the shell needs to paint a brand's own FILES (2026-10-04): the id of an
 * uploaded logo / icon / font (kept in the browser's IndexedDB on a device,
 * brand-context.js) and its hosted https URL once it has one. Ids, family
 * names and https URLs only - never bytes. Mirrored by filesSummaryFor() in
 * brand-context.js.
 */
function filesSummary(brand) {
  const f = brand && brand.brand_data && brand.brand_data.brand_files;
  if (!f || typeof f !== 'object') return {};
  const https = (u) => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim().slice(0, 500) : '');
  const one = (x) => (x && typeof x === 'object' ? { id: str(x.id, 80), hosted_url: https(x.hosted_url), url: https(x.url) } : null);
  const out = {};
  if (one(f.logo)) out.logo = one(f.logo);
  if (one(f.favicon)) out.favicon = one(f.favicon);
  const fonts = f.fonts && typeof f.fonts === 'object' ? f.fonts : {};
  const fo = {};
  for (const slot of ['heading', 'body', 'mono']) {
    const x = fonts[slot];
    if (x && typeof x === 'object') fo[slot] = Object.assign(one(x), { family: str(x.family, 64), format: str(x.format, 16) });
  }
  if (Object.keys(fo).length) out.fonts = fo;
  return out;
}

/* ── the context-pack background chain ────────────────────────────────────
   Same mechanism as api/calendar.js firePrebuild(): fire the next step as an
   INDEPENDENT invocation and return as soon as it has started. The child keeps
   running on Vercel after this client connection drops, so the user's response
   is never held for 30-60s waiting on a crawl. A no-op when there is no base
   URL to call (local dev), which is exactly when the client-driven fallback in
   `context-build` takes over. */
function selfBaseUrl() {
  if (process.env.SELF_BASE_URL) return String(process.env.SELF_BASE_URL).replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return '';
}

async function fireContextChain(workspaceId, depth) {
  const base = selfBaseUrl();
  if (!base || typeof fetch !== 'function') return { fired: false, reason: 'no self base url' };
  // Without a service-role key the child cannot read the pack row at all, so
  // firing would only burn an invocation to return 503.
  if (!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY)) {
    return { fired: false, reason: 'no service-role key; the client drives the queue instead' };
  }
  const secret = process.env.CRON_SECRET || '';
  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    await fetch(`${base}/api/public-config?action=brand&op=context-step`, {
      method: 'POST', headers,
      body: JSON.stringify({ workspace_id: workspaceId, _depth: (depth || 0) + 1 }),
      signal: ctrl.signal,
    });
  } catch (_) { /* expected: the child outlives our 3s handoff window */ }
  finally { clearTimeout(timer); }
  return { fired: true };
}

/** The pack row, minus its bulky payloads, for a status response. */
function packSummary(p) {
  if (!p) return null;
  return {
    id: p.id, brand_key: p.brand_key, site_url: p.site_url, brand_name: p.brand_name,
    status: p.status, stage: p.stage, batches: p.batches, attempts: p.attempts,
    last_error: p.last_error || null,
    has_design_md: !!p.design_md,
    knowledge_ingested: (p.knowledge && p.knowledge.ingested) || 0,
    knowledge_queued: (p.knowledge && p.knowledge.queued) || 0,
    catalog_imported: (p.catalog && p.catalog.imported) || 0,
    catalog_skipped: (p.catalog && p.catalog.skipped) || null,
    repos_searched: !!(p.repos && p.repos.searched),
    repos_verified: ((p.repos && p.repos.verified) || []).length,
    markers: (p.markers || []).length,
    started_at: p.started_at, completed_at: p.completed_at, updated_at: p.updated_at,
  };
}

/* ── A REQUEST WITH NO TOKEN: could anyone have sent one? (2026-09-29) ───────
   requireUser() answers a request that carries no token `sign_in_required`
   BEFORE it looks at any backend - it has nothing to verify - so the
   `backend_unreachable` flag the extract open path waits for is never set for
   it. The open path could therefore only ever open for a caller who PRESENTED
   a token that could not be checked, and nobody presents one any more: Google
   sign-in is commented out, so no browser holds a Supabase JWT, and a
   device-mode mobile+PIN token is never sent (LifecycleAuth.apiToken()). A
   visitor and a person signed in on the device send the SAME request - no
   token - and on production (Supabase paused, no DATABASE_URL) both were
   answered 401. The 2026-09-15 tests sent 'a-stale-token' in every case, so
   the one request a browser actually makes was never driven.

   "A session exists to be had" is decided here for that request, from the two
   places this server can check a session:
     - the ACCOUNT store (mobile-auth-core status()): `server` means a mobile
       number and PIN signed in on this deployment get a token this server
       verifies - the gate is real, refuse. Unknown fails closed.
     - the Supabase auth host: requireUser() still verifies a Supabase JWT, so
       while that host ANSWERS a session exists to be had - refuse. Only an
       outright network refusal counts as down; a slow answer counts as an
       answer (fail closed on doubt, the rule auth.js applies to the same
       /auth/v1/health probe in the browser).
   Neither able to check anything -> nobody could present a session this
   server verifies -> the open path applies, voice OFF, exactly as it already
   did for an unverifiable token. */
const SESSION_PROBE_MS = 3000;

async function authHostAnswers(e) {
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve('late'), SESSION_PROBE_MS); });
  const probe = fetch(`${e.url}/auth/v1/health`, { headers: { apikey: e.anon }, cache: 'no-store' })
    .then(() => 'answered', () => 'refused');
  try { return (await Promise.race([probe, late])) !== 'refused'; }
  finally { clearTimeout(timer); }
}

/**
 * Could a session be checked here right now, for a caller that sent none?
 * `{ checkable: true }` keeps the gate; `{ checkable: false, message }` says,
 * in a sentence naming what an operator would change, why nobody could.
 */
async function sessionCheckable() {
  // Since 2026-10-10 a session exists in ONE place: the Supabase project
  // behind Google sign-in. The mobile-number account store is switched off,
  // so it no longer decides anything here.
  let e;
  try { e = env(); } catch (_) {
    return { checkable: false, message: 'This deployment has no workspace database configured (SUPABASE_URL), so there is no account to sign in to.' };
  }
  if (await authHostAnswers(e)) return { checkable: true };
  return {
    checkable: false,
    message: `The database this deployment points at (${hostOfUrl(e.url)}) is not answering, so no sign-in can be checked. `
      + 'Its Supabase project has most likely been deleted, renamed or paused.',
  };
}

/**
 * Answer `op=document-fetch` with the document's BYTES (not JSON), or a refusal
 * sentence as JSON. The browser reads the file; this only carries it past a
 * host that sends no CORS headers. See brand-document-fetch.js.
 */
async function sendDocument(res, body) {
  try {
    const out = await require('./brand-document-fetch.js').fetchDocument(str(body.url, 2000));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Document-Type', out.content_type);
    res.setHeader('X-Document-Name', encodeURIComponent(out.name));
    res.setHeader('X-Document-Url', encodeURIComponent(out.url));
    return res.status(200).send(out.bytes);
  } catch (err) {
    return res.status((err && err.status) || 500).json({
      ok: false,
      error: (err && err.code) || 'document_fetch_failed',
      message: (err && err.message) || 'That document could not be fetched.',
    });
  }
}

/**
 * The operator's switch for the rendered read. Default ON. `BRAND_RENDER=off`
 * makes "Read my site" parse published HTML and CSS only - for a deployment
 * whose function cannot run the browser, and for test suites that exercise
 * the gate rather than the reader. Read at call time.
 */
function renderOff() { return /^(off|0|false|no)$/i.test(String(process.env.BRAND_RENDER || '')); }

/**
 * Did this request come from a page served by THIS deployment? The Origin
 * header (or, when a browser sends none, the Referer) must name the same host
 * the request was sent to. A browser always sends Origin on a cross-site POST
 * and a page cannot forge it, so another website cannot make its visitors'
 * browsers use an endpoint that answers this; a script outside a browser can
 * send any header it likes, which is what the per-address limit is for.
 */
function samePageRequest(req) {
  const h = (req && req.headers) || {};
  const own = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim().toLowerCase();
  if (!own) return false;
  const from = String(h.origin || h.referer || '').trim();
  if (!from || from === 'null') return false;
  try { return new URL(from).host.toLowerCase() === own; } catch (_) { return false; }
}

/**
 * The door rules for op=document-fetch, checked BEFORE anything is fetched
 * (2026-10-04, review). The op fetches a URL it is given and hands the bytes
 * back, so on a deployment where it opens without an account (no backend to
 * check one against) it must not become a free fetch proxy for the internet:
 *   - POST only: a link or an <img> cannot trigger it.
 *   - No CORS on this op at all: another site's script cannot read the bytes.
 *   - On the OPEN path, a same-site page only (samePageRequest), and the same
 *     per-address + per-instance limiter the open rendered read uses
 *     (brand-render.rateCheck, its own `document` budget).
 * Returns a refusal to send, or null to go on.
 */
function documentFetchRefusal(req, open) {
  if (String(req.method || 'GET').toUpperCase() !== 'POST') {
    return { status: 405, body: { ok: false, error: 'post_required', message: 'A linked brand guideline is fetched only when this app\'s page asks for it (a POST from the onboarding page); a link or an address typed into a browser does not fetch it.' } };
  }
  if (!open) return null;
  if (!samePageRequest(req)) {
    return { status: 403, body: { ok: false, error: 'same_site_page_required', message: 'Without a signed-in account, a linked document is fetched only for this app\'s own onboarding page. This request did not come from it, so nothing was fetched.' } };
  }
  const limited = require('./brand-render.js').rateCheck(req, Date.now(), 'document');
  if (limited) return { status: 429, body: { ok: false, error: 'rate_limited', message: limited } };
  return null;
}

/* ── the router (mounted at /api/public-config?action=brand) ──────────────── */

async function handle(req, res) {
  const q = (req && req.query) || {};
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const op = str(q.op || body.op).toLowerCase() || 'active';

  // `defaults` is the only unauthenticated op: it hands the sign-in screen the
  // shipped default brand so the shell is never unstyled before login.
  if (op === 'defaults') {
    const b = DEFAULT_BRAND;
    return res.status(200).json({ ok: true, brand: b ? shellPayload(b, { id: null, is_default: true }) : null });
  }
  // `presets` is unauthenticated like `defaults`: the onboarding gallery must
  // render before a workspace exists. Returns the starter brand library
  // (data/brands/presets), or one full record with ?slug=. These are TEMPLATES
  // built from each brand's own public site - never a licence to use the marks.
  if (op === 'presets') {
    try {
      const dir = path.join(process.cwd(), 'data', 'brands', 'presets');
      const slug = str(q.slug || body.slug).toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (slug) {
        const f = path.join(dir, `${slug}.json`);
        if (!fs.existsSync(f)) return res.status(404).json({ ok: false, error: 'preset_not_found' });
        return res.status(200).json({ ok: true, preset: JSON.parse(fs.readFileSync(f, 'utf8')) });
      }
      const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      return res.status(200).json({ ok: true, ...idx });
    } catch (e) {
      return res.status(200).json({ ok: true, count: 0, presets: [], error: e.message });
    }
  }

  if (op === 'validate-palette') {
    return res.status(200).json(Object.assign({ ok: true }, validatePalette(body.palette || q.palette || {})));
  }

  // `platform-rules` is unauthenticated like `defaults`: the cohort rules the
  // planner applies and the contract every asset type is built to, read from
  // the modules that apply them, for the brand knowledge documents
  // (/kb/brand/<doc>). Rules, not a tenant's data: no table, no model, no
  // fetch. The caller's own `offers` block (a device brand carries it) picks
  // the code per offer slot, or the slot reports the DATA REQUIRED marker.
  if (op === 'platform-rules') {
    const carried = body.brand && typeof body.brand === 'object' ? body.brand : null;
    return res.status(200).json(require('./brand-knowledge-rules.js').platformRules(carried));
  }

  // op=document-fetch answers WITHOUT CORS on every path: the router's
  // wildcard is taken off before anything else, so no other site's script can
  // read what it fetched (see documentFetchRefusal).
  if (op === 'document-fetch') {
    res.removeHeader('Access-Control-Allow-Origin');
    res.removeHeader('Access-Control-Allow-Headers');
    res.removeHeader('Access-Control-Allow-Methods');
    const early = documentFetchRefusal(req, false);
    if (early) return res.status(early.status).json(early.body);
  }

  // `render-probe` is unauthenticated, like `defaults`: it proves the browser
  // launches on THIS deployment by rendering a fixed page shipped with it
  // (nothing is fetched, so it is neither an SSRF vector nor a free crawler),
  // and its answer is cached per instance for five minutes so it cannot be
  // used to burn CPU. GET-only callers (a status check, a monitor) can read it.
  if (op === 'render-probe') {
    if (renderOff()) return res.status(200).json({ ok: false, renderer: 'unavailable', reason: 'BRAND_RENDER=off on this deployment: Read my site reads published HTML and CSS only.' });
    return res.status(200).json(await require('./brand-render.js').renderProbe());
  }

  const auth = await requireUser(req);

  // ── A GATE THAT DEFENDS NOTHING ────────────────────────────────────────────
  //
  // `extract` reads the PUBLIC WEBSITE the operator just typed and returns a
  // report. It writes nothing, it reads no table, and with `voice` off it calls
  // no language model - `runExtract`'s only use of `auth` is an optional
  // getWorkspace() to widen the crawl scope, already wrapped in a try/catch
  // that degrades. So when the Supabase host is not answering, requiring a
  // session here protects no data and no spend. It only guarantees that the
  // headline feature of the FIRST SCREEN returns a 503, which is exactly what
  // a signed-out operator met: they pasted their site, pressed the button, and
  // got `session_verification_unavailable` where the brand should have been.
  //
  // This is the 2026-08-30 "login wall that defends nothing" finding arriving
  // by the other door. That one was fixed in the browser; the server-side gate
  // on the same screen was not part of it.
  //
  // Two things keep this from becoming an open crawler or an open LLM proxy:
  //
  //   1. It opens ONLY when the backend is provably unreachable. A backend that
  //      ANSWERS and rejects the caller (sign_in_required, invalid_session)
  //      still refuses - a session exists to be had, so the gate is real. Same
  //      "fail closed on doubt" rule auth.js applies in the browser.
  //   2. Voice observation is FORCED OFF on this path. It is the single LLM
  //      call in the extractor, so leaving it on would turn an unreachable
  //      database into an unauthenticated LLM proxy spending real provider
  //      keys - the 2026-08-23 finding, re-introduced by way of a fix. The
  //      response says the voice was skipped and why, rather than returning a
  //      marker that reads like the site published no voice.
  //
  // assertPublicUrl() still runs inside runExtract, so an internal or private
  // host cannot be reached through this either way.
  //
  // A caller that sent NO token (2026-09-29) is `sign_in_required` whatever
  // the backend is doing, so for it the same question is asked of both places
  // a session could be checked - see sessionCheckable() above. That caller is
  // every browser there is now: signed out, or signed in on the device (whose
  // token is never sent).
  // `document-fetch` (2026-10-04) is the same kind of read as `extract`: one
  // public URL the operator pasted, fetched behind the same SSRF guard,
  // returned as bytes, nothing stored, no model. So it opens on exactly the
  // same rule, and nowhere else.
  const OPEN_READ = op === 'extract' || op === 'document-fetch';
  let openWithoutBackend = !auth.ok && auth.backend_unreachable === true && OPEN_READ;
  let noSession = null;
  if (!auth.ok && !openWithoutBackend && OPEN_READ && auth.error === 'sign_in_required') {
    noSession = await sessionCheckable();
    openWithoutBackend = !noSession.checkable;
  }

  if (!auth.ok && !openWithoutBackend) return res.status(auth.status || 401).json(auth);

  // WHO MAY SPEND ON A MODEL HERE (2026-10-03, review). A server-mode phone
  // number the operator has not listed (CREDITS_COMP_PHONES) has no wallet, so
  // it must never reach a provider - the faucet the list exists to shut. The
  // brand ops have three model steps: the voice observation inside extract and
  // inside the context pack's extract stage (each runs WITHOUT it, and says
  // so), and Suggest options (nothing but a model call, so refused). A device
  // principal and an email account are unaffected (spenderRefusal → null).
  const spend = auth.ok ? require('./credits-core.js').spenderRefusal(auth) : null;
  const VOICE_SKIPPED_NOTE = 'The tone of voice was not observed: that step is the only one that needs a language model, and this mobile-number sign-in has no credit wallet because its number is not on the operator\'s list. Everything else was read from the site exactly as always.';

  if (openWithoutBackend && op === 'document-fetch') {
    const refused = documentFetchRefusal(req, true);
    if (refused) return res.status(refused.status).json(refused.body);
    return sendDocument(res, body);
  }
  if (openWithoutBackend) {
    try {
      // RENDERED FIRST (2026-10-04): the site is opened in a headless browser
      // and measured as it renders; the parser runs alongside and is the
      // labelled fallback. On THIS path - no account the server can check -
      // the browser read is rate-limited per address and per instance, and it
      // calls no model whatever happens (voice stays OFF below).
      const out = await require('./brand-render.js').extractWithRender(
        { ok: false, token: '', user_id: '', email: '' },
        {
          url: str(body.url || q.url, 500),
          // No workspace can be read with no backend, so scope is the URL itself.
          workspace_id: '',
          voice: false,
          max_pages: body.max_pages || q.max_pages,
        },
        { open: true, req, render: !renderOff() && body.render !== false, brand: require('./brand-render.js').scoringBrand(body.brand) },
      );
      // Neutral about WHO is here: the server cannot tell a visitor from a
      // person signed in on the device (neither sends a token), and "read
      // without signing in" told the second one they were not signed in.
      const note = 'Read without an account the server could check, because '
        + (noSession ? 'nothing on this deployment can check a sign-in right now. ' : 'this deployment\'s database is not answering. ')
        + 'Nothing was saved, and the tone of voice was NOT observed: that step is the only one that needs a '
        + 'language model, and a deployment that cannot check a sign-in must not become a way to spend model credits without an account. '
        + 'Everything else below was read from your site exactly as it always is.';
      return res.status(out && out.ok === false && out.error ? 400 : 200).json(
        Object.assign({}, out, {
          signed_out: true,
          backend_unreachable: true,
          voice_skipped: true,
          note,
          backend_message: noSession ? noSession.message : (auth.message || ''),
        }),
      );
    } catch (err) {
      return res.status(err && err.status ? err.status : 500).json({
        ok: false,
        error: 'extract_failed',
        message: (err && err.message) || 'That site could not be read.',
      });
    }
  }

  try {
    switch (op) {
      case 'list': {
        const rows = await listWorkspaces(auth);
        const active = await activeWorkspaceId(auth);
        const owned = await Promise.all(rows.map((w) => ownsShipped(w.id)));
        return res.status(200).json({ ok: true, workspaces: rows.map((w, i) => shellPayload(w, { owns_shipped: owned[i] })), active_id: active, user: { id: auth.user_id, email: auth.email } });
      }
      case 'active': {
        const id = await activeWorkspaceId(auth);
        if (!id) {
          const all = await listWorkspaces(auth);
          // No active brand and nothing onboarded yet → the shell sends the user
          // to /onboarding. This is the "first screen asks for the brand" path.
          return res.status(200).json({ ok: true, brand: null, needs_onboarding: all.length === 0, workspaces: all.map((w) => shellPayload(w)), user: { id: auth.user_id, email: auth.email } });
        }
        const ws = await getWorkspace(auth, id);
        if (!ws) return res.status(200).json({ ok: true, brand: null, needs_onboarding: true, user: { id: auth.user_id, email: auth.email } });
        const tally = await productTally(auth, ws);
        const products = tally.own;
        return res.status(200).json({
          ok: true,
          brand: shellPayload(ws, Object.assign({ readiness: readiness(ws, { products }), owns_shipped: await ownsShipped(ws.id) }, tallyFields(tally))),
          needs_onboarding: false,
          user: { id: auth.user_id, email: auth.email },
        });
      }
      case 'get': {
        const ws = await getWorkspace(auth, str(q.id || body.id));
        if (!ws) return res.status(404).json({ ok: false, error: 'workspace_not_found' });
        const tally = await productTally(auth, ws);
        const products = tally.own;
        return res.status(200).json({ ok: true, brand: Object.assign({}, ws, { tokens: tokens(ws), fonts_href: fontsHref(ws), readiness: readiness(ws, { products }), owns_shipped: await ownsShipped(ws.id) }, tallyFields(tally)) });
      }
      case 'save': {
        const ws = await saveWorkspace(auth, body.brand || body);
        const tally = await productTally(auth, ws);
        const products = tally.own;
        // A save is never refused for a mixed record (the wizard saves as the
        // person types); it is TOLD, field by field, what disagrees.
        return res.status(200).json({ ok: true, brand: Object.assign({}, ws, { tokens: tokens(ws), fonts_href: fontsHref(ws), readiness: readiness(ws, { products }), owns_shipped: await ownsShipped(ws && ws.id), coherence: coherence.brandCoherence(ws || {}) }, tallyFields(tally)) });
      }
      case 'activate': {
        const ws = await activateChecked(auth, str(body.id || q.id), body.coherence_override);
        const tally = await productTally(auth, ws);
        const products = tally.own;
        return res.status(200).json({ ok: true, brand: shellPayload(ws, Object.assign({ readiness: readiness(ws, { products }), owns_shipped: await ownsShipped(ws.id) }, tallyFields(tally))) });
      }
      case 'delete': {
        return res.status(200).json(await deleteWorkspace(auth, str(body.id || q.id)));
      }
      case 'catalog-import': {
        return res.status(200).json(await importCatalog(auth, {
          workspace_id: str(body.workspace_id || q.workspace_id),
          region: body.region || q.region || '',
          kind: body.kind || q.kind,
          text: body.text,
          url: body.url || q.url,
          replace: body.replace !== false,
          // Read only for a caller whose brands are on its device (a phone
          // sign-in): the scope a workspace row would otherwise supply.
          brand: body.brand,
          // Continue import: the account path resumes from the cursor on the
          // workspace row; a device brand sends the cursor it keeps.
          continue: body.continue === true,
          cursor: body.cursor && typeof body.cursor === 'object' ? body.cursor : null,
        }));
      }
      case 'catalog-status': {
        return res.status(200).json(await catalogStatus(auth, str(q.workspace_id || body.workspace_id)));
      }
      case 'catalog': {
        const rows = await listCatalog(auth, {
          workspace_id: str(q.workspace_id || body.workspace_id),
          region: q.region || body.region,
          limit: q.limit || body.limit,
        });
        return res.status(200).json({ ok: true, products: rows, count: rows.length });
      }
      case 'readiness': {
        const ws = await getWorkspace(auth, str(q.id || body.id));
        if (!ws) return res.status(404).json({ ok: false, error: 'workspace_not_found' });
        return res.status(200).json({ ok: true, readiness: readiness(ws, { products: (await productTally(auth, ws)).own }) });
      }
      // Read the WHOLE brand off its own site: name, tagline, logo, colour
      // schema, typography, observed voice, verbatim claims, social profiles,
      // legal entity and regions - each as ranked CANDIDATES carrying the URL
      // and the signal that produced them, so the operator confirms rather
      // than inherits a guess. Nothing here writes to the workspace; the
      // wizard applies what the operator accepts through `save` as usual.
      // Requires a signed-in caller because it makes outbound fetches from the
      // serverless runtime (see runExtract's SSRF guard). Lazily required so
      // this module keeps loading when only its colour maths is wanted.
      /* ── the brand CONTEXT PACK ─────────────────────────────────────────
         One durable record per brand, keyed to its URL AND its name: a
         spec-conformant DESIGN.md (google-labs-code/design.md), a knowledge
         base built from that domain and nothing else, a catalogue through the
         existing importCatalog path, and a GitHub repository search whose
         REACHABILITY is recorded so "found none" and "could not look" are never
         the same answer.

         `context-build` advances the queue by one step and, when a service-role
         key is configured, hands the rest to a self-firing background chain -
         the same convergent pattern as the smart-brain prebuild queue. Without
         one it degrades to client-driven: the browser calls again per step.

         `context-apply` is the ONLY way a machine-observed value reaches the
         brand record, and it goes through the brand_context_apply() SQL
         function, which refuses any field a person already owns. */
      case 'context-build': {
        const pack = require('./brand-context-pack.js');
        const wsId = str(body.workspace_id || q.workspace_id);
        if (!wsId) return res.status(400).json({ ok: false, error: 'workspace_id is required.' });
        // A PHONE SIGN-IN keeps its brands, and so its pack, on its device
        // (2026-10-03). The same stages run over a one-request store seeded
        // with what the browser carried, and the whole row goes back to be
        // kept there; the browser is the queue. See devicePackStep().
        if (isPhoneAuth(auth)) {
          const out = await pack.devicePackStep({
            workspaceId: wsId,
            brand: body.brand && typeof body.brand === 'object' && !Array.isArray(body.brand) ? body.brand : null,
            pack: body.device_pack,
            refresh: body.refresh === true,
            catalogOwned: body.catalog_owned === true,
            auth,
            // The extract stage's voice observation is a model call.
            ctx: spend ? { voice: false } : {},
          });
          const step = out.step;
          return res.status(200).json({
            ok: true, storage: 'device', stage: step.stage, done: !!step.done, remaining: step.remaining,
            chained: false,
            next_step_required: step.remaining > 0,
            failed_stage: step.failed_stage, error: step.error,
            pack: packSummary(step.pack),
            device_pack: out.row,
            context: out.context,
            // Rows the catalogue stage read, for the device catalogue; null when
            // this step did not import (another stage, or a catalogue the
            // operator imported by hand and the run left alone).
            catalog_products: out.products,
            // A store read that did not finish in this step: the device keeps
            // the cursor beside its catalogue, and Continue import resumes it.
            catalog_cursor: out.catalog_cursor || null,
            catalog_run: out.catalog_run || null,
            ...(spend ? { voice_skipped: true, voice_note: VOICE_SKIPPED_NOTE } : {}),
          });
        }
        await assertCanWrite(auth, wsId, 'build its context pack');
        const store = pack.userStore(auth.token);
        const step = await pack.startPack(store, wsId, {
          auth,
          refresh: body.refresh === true || q.refresh === '1',
        });
        let chained = false;
        if (step.remaining > 0) chained = (await fireContextChain(wsId, 0)).fired;
        return res.status(200).json({
          ok: true, stage: step.stage, done: !!step.done, remaining: step.remaining,
          chained,
          // When nothing could be chained the client is the queue. Say so
          // plainly rather than leaving a pack stuck at stage 1 forever.
          next_step_required: step.remaining > 0 && !chained,
          failed_stage: step.failed_stage, error: step.error,
          pack: packSummary(step.pack),
        });
      }
      // The background worker. Authenticated by CRON_SECRET, never by a user
      // token: it runs with the service role and an EXPLICIT workspace filter.
      case 'context-step': {
        const pack = require('./brand-context-pack.js');
        const secret = process.env.CRON_SECRET || '';
        const authorized = secret
          ? (bearer(req) === secret || q.secret === secret)
          : (String(process.env.VERCEL_ENV) !== 'production');
        if (!authorized) return res.status(401).json({ ok: false, error: 'Unauthorized context-step call' });
        const wsId = str(body.workspace_id || q.workspace_id);
        if (!wsId) return res.status(400).json({ ok: false, error: 'workspace_id is required.' });
        const depth = Math.max(0, +(body._depth || q.depth || 0));
        const MAX_DEPTH = 60;      // backstop: catalog + extract + repos + ~15 knowledge batches
        let store;
        try { store = pack.serviceStore(); }
        catch (e) { return res.status(503).json({ ok: false, error: e.message, note: 'The background chain needs SUPABASE_SERVICE_ROLE_KEY. Without it the pack is built one step per client call.' }); }
        const row = await pack.getPackRow(store, wsId, str(body.brand_key || q.brand_key));
        if (!row) return res.status(404).json({ ok: false, error: 'no_pack_for_workspace' });
        const step = await pack.advancePack(store, row, {});
        let chained = false;
        // Chain only while making progress and inside the backstop, so a
        // permanently failing step stops instead of hot-looping.
        if (step.remaining > 0 && depth < MAX_DEPTH) chained = (await fireContextChain(wsId, depth)).fired;
        return res.status(200).json({ ok: true, stage: step.stage, done: !!step.done, depth, chained, pack: packSummary(step.pack) });
      }
      case 'context-pack': {
        const pack = require('./brand-context-pack.js');
        const wsId = str(q.workspace_id || body.workspace_id) || (await activeWorkspaceId(auth));
        if (!wsId) return res.status(200).json({ ok: true, pack: null, note: 'No active brand workspace on this request.' });
        const store = pack.userStore(auth.token);
        return res.status(200).json(await pack.contextFor(store, wsId, { brandKey: str(q.brand_key || body.brand_key) }));
      }
      case 'context-design': {
        // The raw DESIGN.md, servable as text/markdown so it can be downloaded
        // or handed straight to a coding agent.
        const pack = require('./brand-context-pack.js');
        const wsId = str(q.workspace_id || body.workspace_id) || (await activeWorkspaceId(auth));
        if (!wsId) return res.status(404).json({ ok: false, error: 'no_active_workspace' });
        const store = pack.userStore(auth.token);
        const row = await pack.getPackRow(store, wsId, str(q.brand_key || body.brand_key));
        if (!row || !row.design_md) {
          return res.status(404).json({ ok: false, error: 'no_design_md', note: 'No DESIGN.md has been built for this brand yet. Run op=context-build.' });
        }
        if (String(q.format || '') === 'md') {
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="DESIGN.md"`);
          return res.status(200).send(row.design_md);
        }
        return res.status(200).json({ ok: true, design_md: row.design_md, design: row.design || {}, brand_key: row.brand_key });
      }
      case 'context-list': {
        const pack = require('./brand-context-pack.js');
        const wsId = str(q.workspace_id || body.workspace_id) || (await activeWorkspaceId(auth));
        if (!wsId) return res.status(200).json({ ok: true, packs: [] });
        const store = pack.userStore(auth.token);
        const rows = await pack.listPackRows(store, wsId);
        return res.status(200).json({ ok: true, packs: rows.map(packSummary) });
      }
      case 'context-apply': {
        const pack = require('./brand-context-pack.js');
        const wsId = str(body.workspace_id || q.workspace_id);
        if (!wsId) return res.status(400).json({ ok: false, error: 'workspace_id is required.' });
        await assertCanWrite(auth, wsId, 'apply a context pack to it');
        const store = pack.userStore(auth.token);
        const out = await pack.applyPack(store, wsId, body.fields || {}, body.sources || {});
        invalidateBrandCaches({ userId: auth.user_id, workspaceId: wsId });
        return res.status(200).json(Object.assign({ ok: true }, out, {
          note: 'Fields listed under skipped_user_owned were left alone because a person supplied them. '
            + 'That refusal happens inside brand_context_apply() in the database, not here.',
        }));
      }
      case 'extract': {
        const wantsVoice = (body.voice !== undefined ? body.voice : q.voice) !== false && String(q.voice || '') !== 'false';
        const out = await require('./brand-render.js').extractWithRender(auth, {
          url: str(body.url || q.url, 500),
          workspace_id: str(body.workspace_id || q.workspace_id),
          voice: wantsVoice && !spend,
          max_pages: body.max_pages || q.max_pages,
        }, { open: false, req, render: !renderOff() && body.render !== false, brand: await module.exports.scoringBrandFor(auth, body, q) });
        const extra = (spend && wantsVoice) ? { voice_skipped: true, voice_note: VOICE_SKIPPED_NOTE } : {};
        return res.status(out && out.ok === false && out.error ? 400 : 200).json(Object.assign({}, out, extra));
      }
      // The bytes of a brand guideline document the operator LINKED, for the
      // browser to read (brand-document.js). See brand-document-fetch.js.
      case 'document-fetch': {
        return sendDocument(res, body);
      }
      case 'suggest': {
        // Options for ONE field, written from this brand's own record. Nothing
        // is written here: the response is candidates, and the operator's click
        // is what puts a value in the record (as their own, not the model's).
        // It is nothing BUT a model call, so a caller who may not spend is
        // refused with the sentence, before any provider is reached.
        if (spend) return res.status(spend.status || 403).json(spend);
        const ws = str(body.workspace_id || q.workspace_id);
        let brand = body.brand && typeof body.brand === 'object' ? body.brand : null;
        if (!brand && ws) {
          try { brand = await require('./workspace-scope.js').brandForWorkspace(ws); } catch (_) { brand = null; }
        }
        const out = await require('./brand-suggest.js').suggest(
          str(body.field || q.field, 40), brand, { count: Number(body.count || q.count) || 0 },
        );
        return res.status(out && out.ok === false && out.error === 'unknown_field' ? 400 : 200).json(out);
      }
      default:
        return res.status(400).json({
          ok: false, error: 'unknown_brand_operation',
          available: ['defaults', 'presets', 'platform-rules', 'list', 'active', 'get', 'save', 'activate', 'delete',
            'catalog-import', 'catalog-status', 'catalog', 'readiness', 'validate-palette', 'extract', 'suggest', 'document-fetch', 'render-probe',
            'context-build', 'context-step', 'context-pack', 'context-design', 'context-list', 'context-apply'],
        });
    }
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    if (err && err.code === 'coherence_blocked') {
      return res.status(status).json({ ok: false, error: err.code, code: err.code, message: err.message, coherence: err.details });
    }
    return res.status(status).json({ ok: false, error: err.message || 'brand_operation_failed', details: err.details || undefined });
  }
}

module.exports = {
  samePageRequest, documentFetchRefusal,
  handle,
  requireUser,
  restAs,
  // colour
  normHex, contrast, luminance, saturation, isDarkNeutral, shade, readableOn, readableAsText, readableOnSurfaces, validatePalette,
  sectionGround, textOn,
  TEXT_AA,
  // brand
  normalizePalette, normalizeTypography, normalizeVoice, normalizeRegions, tokens, contractTokens, fontsHref,
  readiness, launchMarker, shellPayload, slugify, slugFor, DEFAULT_BRAND, coherenceSummary, activateChecked,
  // catalog
  parseCsv, rowsFromCsv, rowsFromJson, rowsFromStore, assertPublicUrl, isPrivateIp, BLOCKED_HOST_RX,
  // data access
  listWorkspaces, getWorkspace, scoringBrandFor, activeWorkspaceId, setActive, saveWorkspace, deleteWorkspace,
  importCatalog, deviceCatalogImport, readCatalogSource, productTally, isPhoneAuth, DEVICE_CATALOG_ROWS, listCatalog, catalogStatus, catalogCounts, mergeIntoWorkspace, catalogSourceRecord, coverageSummary, assertCanWrite, seedCompetitorsOnActivation, ownsShipped,
  // context pack + field provenance
  claimedFields, claimUserOwnedFields, packSummary, fireContextChain,
  carriedFields, recordedOrigins, ORIGIN_RANK,
};
