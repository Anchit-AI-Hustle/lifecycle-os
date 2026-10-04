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
  // ── A MOBILE + PIN SESSION (2026-09-28, standalone 2026-09-30) ─────────────
  // The one sign-in the browser has now. Its token is 43 base64url characters
  // with no dots (a Supabase JWT has two), so the two cannot be confused. A
  // SERVER-mode session is verified against app_sessions in the Neon database.
  // A DEVICE-mode token (no DATABASE_URL on this deployment) is admitted as
  // `mode:'device'` so features that do not need a ledger can run; its id is
  // `device:<hash>` of the token, never a phone number from the body. A raw
  // server-to-server call with only that token and no page Origin is still
  // anonymous: a well-shaped token is not a secret, and the 2026-09-29 review
  // closed "any token at all reaches a model". The page the person is on is
  // the attribution.
  const mobile = require('./mobile-auth-core.js');
  const own = mobile.tokenOf(req);
  if (own && mobile.looksLikeToken(own)) {
    const v = await mobile.verifyToken(own);
    if (v.ok) {
      const mode = v.mode === 'device' ? 'device' : 'server';
      if (mode === 'device') {
        const h = (req && req.headers) || {};
        if (!(h.origin || h.Origin || h.referer || h.Referer)) {
          return {
            ok: false, status: 401, error: 'sign_in_required',
            message: 'A sign-in kept on this device only can run features from this app\'s pages. This request did not come from a page, so it did not run.',
            hint: 'Send the device session as X-Lifecycle-Token from a same-origin page (Origin or Referer).',
            mobile_reason: 'device_unattributed',
          };
        }
      }
      return {
        ok: true, token: own, user_id: v.user.id, email: '',
        phone: v.user.phone, name: v.user.name, provider: 'mobile-pin',
        mode,
      };
    }
    if (v.reason === 'unreachable') {
      // The SAME distinction the header above draws for the Supabase path,
      // which this branch flattened (found 2026-09-29): a token of our shape
      // reaches the server ONLY from a server-mode sign-in (auth.js never
      // sends a device token), so when the database it lives in is not
      // answering, the account is in the database and the database is down.
      // Answering 401 "kept on this device only" told a person whose account
      // is in Neon that they were signed in on a device - the sentence the
      // browser's own mode line contradicts a few pixels away - and the 401
      // was the code every catch reads as "sign in again", which cannot help.
      return {
        ok: false, status: 503, error: 'backend_unreachable', backend_unreachable: true,
        message: 'The database your account is in (' + (v.host || 'the configured host') + ') is not answering, '
          + 'so your sign-in cannot be checked right now and this could not be saved. Nothing about your account has changed; try again once it answers.',
        hint: 'DATABASE_URL points at a host that did not answer the session lookup.',
        mobile_reason: v.reason,
        detail: v.detail,
      };
    }
    return {
      ok: false, status: 401, error: 'sign_in_required',
      message: 'You are not signed in, so this could not be saved to your account. '
        + (v.reason === 'no_database'
          ? 'A sign-in kept on this device only cannot be checked by the server.'
          : 'Your sign-in has expired or was signed out. Sign in again with your mobile number and PIN.'),
      hint: 'Send X-Lifecycle-Token: <session token> (or Authorization: Bearer <token>) from a server-mode sign-in.',
      mobile_reason: v.reason,
    };
  }

  const token = bearer(req);
  if (!token) {
    return {
      ok: false, status: 401, error: 'sign_in_required',
      message: 'You are not signed in, so this could not be saved to your account.',
      hint: 'Send X-Lifecycle-Token: <session token> from a mobile-number sign-in (Authorization: Bearer <token> is accepted too).',
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
    // A PHONE ACCOUNT IN SUPABASE AUTH (2026-10-03). The same verified user
    // record says whether this is a mobile-number account, read from
    // app_metadata - which only the service role can write - never from
    // anything the request says about itself. `provider:'mobile-pin'` keeps
    // the phone rules everywhere they are keyed (credits: an unlisted number
    // holds no wallet; a listed one holds a personal wallet), and
    // `mode:'supabase'` says this phone account HAS a Supabase identity, so
    // the paths that used to answer "your brands are on the device" for a
    // phone token (brand-runtime, TeleSuite) read its workspaces like any
    // account's, through RLS. Every principal verified here is mode
    // 'supabase': the project answered, so its ledger is the one to meter on.
    const phoneId = require('./mobile-auth-supabase.js').phoneIdentity(user);
    if (phoneId) {
      return {
        ok: true, token, user_id: user.id, email: '',
        phone: phoneId.e164, name: phoneId.name, provider: 'mobile-pin', mode: 'supabase',
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
  const start = readableOn(ground, ink || '#111111', surface || '#ffffff');
  return readableAsText(start, ground, target || 4.5);
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
      pdp_pattern: str(r.pdp_pattern, 200) || '{base}/products/{handle}',
      collection_pattern: str(r.collection_pattern, 200) || '{base}/collections/{slug}',
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
  const ink = p.ink || '#111111';
  const surface = p.surface || '#F7F5F2';
  const surfaceAlt = p.surface_alt || shade(surface, 0.6);
  const muted = p.muted || shade(ink, 0.35);
  // Text tokens are measured against the WORST-CASE surface they can land
  // on, not the lightest. A brand's page surface is often a tint while its
  // cards are white, and the shared rail is tinted too; a colour tuned
  // against white still fails on the tint, which is precisely where the
  // nav group labels were landing at 3.6:1. Whichever of the two the brand
  // colour reads worse on is the one that has to pass.
  const worstSurface = contrast(primary, surface) <= contrast(primary, surfaceAlt) ? surface : surfaceAlt;
  const t = brand && brand.typography ? brand.typography : {};

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
    '--brand-primary-text': readableAsText(primary, worstSurface, TEXT_AA),
    '--brand-accent': accent,
    '--brand-accent-soft': shade(accent, 0.88),
    '--brand-on-accent': readableOn(accent, ink, surface, surfaceAlt),
    '--brand-accent-text': readableAsText(accent, worstSurface, TEXT_AA),
    '--brand-ink': ink,
    // Secondary text still has to be READABLE. `shade(ink, .35)` is a fixed
    // 35% lift toward white with no floor, so a brand with a mid-grey ink got
    // a muted token that fails AA - and muted is the colour of most of the
    // small print on every page. AA for body text is the bar here too: this is
    // supporting copy, not decoration.
    '--brand-ink-muted': readableAsText(muted, worstSurface, TEXT_AA),
    '--brand-surface': surface,
    '--brand-surface-alt': surfaceAlt,
    '--brand-line': shade(ink, 0.84),
    '--brand-line-strong': shade(ink, 0.68),
    '--brand-ok': p.ok || '#1a7f37',
    '--brand-warn': p.warn || '#c9a227',
    '--brand-err': p.err || '#c0392b',
    '--brand-font-head': (t.heading && t.heading.stack) || "'Montserrat',Georgia,serif",
    '--brand-font-body': (t.body && t.body.stack) || "system-ui,-apple-system,Segoe UI,sans-serif",
    '--brand-font-mono': (t.mono && t.mono.stack) || 'ui-monospace,SFMono-Regular,Menlo,monospace',
  }, componentTokens(brand));
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
 * Import from a PUBLIC storefront the operator owns. Read-only: GET only, no
 * credentials, no redirects, only the standard Shopify public products feed,
 * and only after the SSRF guard above clears the destination. Facts are copied
 * verbatim from the store; nothing is synthesised.
 */
/**
 * Catalogue from the brand's OWN SITE, for every brand without a product feed.
 *
 * rowsFromStorefront can read exactly one thing: a Shopify /products.json. A
 * publisher, an events programme, a service, or any store not on Shopify had no
 * route in at all, so its assets fell back to DATA REQUIRED markers.
 *
 * This crawls the brand's interlinked pages and takes only what the site itself
 * DECLARES in structured data. See _shared/site-crawl.js for why nothing is
 * read out of prose.
 */
async function rowsFromSite(startUrl, region, brand) {
  const { crawlSite } = require('./site-crawl.js');
  const candidate = httpUrl(startUrl) || (brand && brand.website) || '';
  if (!candidate) { const e = new Error('A site URL is required to crawl.'); e.status = 400; throw e; }
  // Same SSRF guard the storefront import uses: a public host must not be able
  // to bounce this onto an internal one.
  const base = await assertPublicUrl(candidate);

  // The crawl is already reading every page; the platform the store runs on is
  // published on those same pages. Detecting it here costs no extra request and
  // turns "we tried /products.json and it 502'd" into a statement about the
  // store: a WooCommerce shop does not publish that feed and never will, and
  // telling its owner their feed is unavailable reads as a fault in their site.
  const storefrontPages = [];
  const out = await crawlSite(base, {
    brand: brand || { website: base },
    onPage: (html, url) => { if (storefrontPages.length < 12) storefrontPages.push([url, html]); },
  });
  if (!out.ok) {
    const e = new Error(out.error === 'start_url_out_of_scope'
      ? 'That URL is not on this brand\'s own domain. A catalogue may only be crawled from the brand\'s own site.'
      : 'The site crawl could not start.');
    e.status = 400; throw e;
  }

  const rows = [];
  for (const o of out.offerings) {
    const title = str(o.name, 300);
    if (!title) continue;
    rows.push({
      region,
      title,
      handle: slugify(title),
      sku: str(o.sku, 120) || null,
      description: str(o.description, 4000) || null,
      product_type: str(o.kind, 120) || null,
      collections: [],
      price: num(o.price),
      compare_at: null,
      currency: str(o.currency, 8).toUpperCase() || null,
      image_url: httpUrl(o.image) || null,
      product_url: httpUrl(o.url) || null,
      in_stock: null,
      tags: [],
      source: 'site_crawl',
    });
    if (rows.length >= MAX_CATALOG_ROWS) break;
  }

  return {
    rows, base,
    storefront: require('./storefront-detect.js').detectStorefront(storefrontPages),
    // Carried through so the caller can surface it rather than presenting a
    // partial crawl as the whole catalogue.
    crawl: {
      pages_visited: out.pages_visited, stopped: out.stopped,
      coverage_note: out.coverage_note, images: out.images, notes: out.notes,
      // What the site declared about its own URLs. "40 pages read" and "40 of
      // the 812 this site declares" are the same number and opposite claims.
      sitemap: out.sitemap || null,
    },
  };
}

async function rowsFromStorefront(storeUrl, region) {
  const candidate = httpUrl(storeUrl);
  if (!candidate) { const e = new Error('Store URL is not a valid http(s) URL.'); e.status = 400; throw e; }
  const base = await assertPublicUrl(candidate);
  const rows = [];
  let page = 1, skipped = 0;
  while (page <= 10 && rows.length < MAX_CATALOG_ROWS) {
    const url = `${base}/products.json?limit=250&page=${page}`;
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store', redirect: 'manual' });
    } catch (err) { const e = new Error(`Could not reach ${base}: ${err.message}`); e.status = 502; throw e; }
    if (res.status >= 300 && res.status < 400) {
      const e = new Error(`${base} redirected the request. Enter the store's canonical URL directly (redirects are not followed, so a public host cannot bounce the import onto an internal one).`);
      e.status = 400; throw e;
    }
    if (!res.ok) {
      if (page === 1) { const e = new Error(`${base}/products.json returned ${res.status}. Public product feed not available at that URL.`); e.status = 502; throw e; }
      break;
    }
    let json;
    try { json = await res.json(); } catch (_) { break; }
    const list = Array.isArray(json && json.products) ? json.products : [];
    if (!list.length) break;
    for (const p of list) {
      const parsed = rowsFromJson({ products: [p] }, region);
      for (const r of parsed.rows) {
        r.source = 'shopify_public';
        if (!r.product_url && r.handle) r.product_url = `${base}/products/${r.handle}`;
        rows.push(r);
      }
      skipped += parsed.skipped;
    }
    page++;
  }
  return { rows: rows.slice(0, MAX_CATALOG_ROWS), columns: {}, skipped, base };
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

async function getWorkspace(auth, id) {
  const rows = await restAs(auth.token, `brand_workspaces?select=${SELECT_COLS}&id=eq.${encodeURIComponent(id)}&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function productCount(auth, id) {
  try {
    const rows = await restAs(auth.token, `brand_catalog_products?select=id&workspace_id=eq.${encodeURIComponent(id)}&limit=${MAX_CATALOG_ROWS}`);
    return Array.isArray(rows) ? rows.length : 0;
  } catch (_) { return 0; }
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

/** Build the exact row we persist — every field normalised, none invented. */
function buildRow(input, existing) {
  const b = input && typeof input === 'object' ? input : {};
  const prev = existing || {};
  const name = str(b.name, 120) || str(prev.name, 120);
  if (!name) { const e = new Error('Brand name is required.'); e.status = 400; throw e; }

  const regions = b.regions !== undefined ? normalizeRegions(b.regions) : (prev.regions || []);
  const row = {
    slug: slugify(b.slug || prev.slug || name) || `brand-${Date.now().toString(36)}`,
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

async function saveWorkspace(auth, input) {
  const id = str(input && input.id);
  if (id) {
    const existing = await getWorkspace(auth, id);
    if (!existing) { const e = new Error('Workspace not found (or not yours).'); e.status = 404; throw e; }
    const row = buildRow(input, existing);
    const saved = await restAs(auth.token, `brand_workspaces?id=eq.${encodeURIComponent(id)}&select=${SELECT_COLS}`, {
      method: 'PATCH', body: row, prefer: 'return=representation',
    });
    // What a person typed is theirs from now on: no automatic run may overwrite
    // it, and the refusal lives in the database rather than in call order.
    await claimUserOwnedFields(auth, id, input);
    invalidateBrandCaches({ userId: auth.user_id, workspaceId: id });
    return Array.isArray(saved) ? saved[0] : saved;
  }
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
 * Read a catalogue SOURCE into rows: the store URL (feed first, then the site
 * crawl), a pasted CSV, or a JSON export. Writes nothing. Shared by the
 * account import below and the device import (2026-10-03), so the two read a
 * catalogue identically and differ only in where the rows are kept.
 */
async function readCatalogSource({ region, kind, text, url, scope }) {
  const reg = str(region, 12).toLowerCase() || 'us';
  const k = str(kind).toLowerCase();

  if (text && String(text).length > MAX_UPLOAD_CHARS) {
    const e = new Error(`That file is too large (max ${Math.round(MAX_UPLOAD_CHARS / 1e6)}MB of text per import).`);
    e.status = 413; throw e;
  }

  let parsed;
  if (k === 'storefront' || k === 'shopify_public') {
    // A store URL means "read my catalogue", not "read my /products.json".
    // Only Shopify and its compatibles publish that feed, so every other store
    // - and every Shopify store that has the endpoint disabled - got "No usable
    // product rows were found in that source" and no catalogue at all, which is
    // where the brand's generated assets then fall back to DATA REQUIRED
    // markers. The crawler reads what the site DECLARES in its own structured
    // data across its interlinked pages, so it does not care what the store
    // runs on.
    try {
      parsed = await rowsFromStorefront(url, reg);
    } catch (e) {
      // A missing feed is not an error to report, it is a reason to try the
      // other route. A refusal that is about the URL itself (private host,
      // out of scope) still has to surface.
      if (e && e.status && e.status !== 502 && e.status !== 404) throw e;
      parsed = { rows: [], source: null, note: e && e.message };
    }
    if (!parsed.rows.length) {
      const viaFeed = parsed.note || 'no rows in the product feed';
      parsed = await rowsFromSite(url, reg, scope);
      if (parsed && parsed.rows) parsed.fallback_from = viaFeed;
    }
  } else if (k === 'site' || k === 'site_crawl') parsed = await rowsFromSite(url, reg, scope);
  else if (k === 'json') parsed = rowsFromJson(text, reg);
  else if (k === 'csv') parsed = rowsFromCsv(text, reg);
  else { const e = new Error('kind must be one of: csv, json, storefront, site.'); e.status = 400; throw e; }

  if (!parsed.rows.length) {
    // Say which routes were tried, so the answer is actionable rather than a
    // dead end: the operator can paste a CSV instead, or fix the feed.
    //
    // And name the PLATFORM when the crawl identified one. "Public product feed
    // not available at that URL" is true of every WooCommerce, BigCommerce and
    // Magento store on earth and reads as a fault in the operator's site; the
    // useful sentence is which platform they are on and what that platform
    // actually publishes.
    const sf = parsed && parsed.storefront;
    let tried = (k === 'storefront' || k === 'shopify_public')
      ? ' Tried the public product feed and then crawled the site\'s own pages for declared product data.'
      : '';
    if (sf && sf.detected) {
      tried += ` This site is ${sf.platform.name} (${sf.platform.why}). ${sf.catalog_route.note}`
        + ' Nothing here is a fault in your store: it means the pages that were read declare no structured product data, so add it, or import a CSV.';
    } else if (k === 'storefront' || k === 'site' || k === 'site_crawl') {
      tried += ' No commerce platform declared itself on the pages that were read, so there was no feed to prefer and the site crawl was the only route.';
    }
    const e = new Error('No usable product rows were found in that source.' + tried);
    e.status = 400; throw e;
  }
  return { parsed, reg, k };
}

/** Where a catalogue came from, as recorded beside the brand. */
function catalogSourceRecord(parsed, k, url, rowCount, batch, reg) {
  const sf = parsed && parsed.storefront;
  return {
    kind: k === 'storefront' ? 'shopify_public' : (k === 'site' ? 'site_crawl' : k),
    url: (k === 'storefront' || k === 'site' || k === 'site_crawl') ? (parsed.base || httpUrl(url)) : '',
    imported_at: new Date().toISOString(),
    row_count: rowCount,
    batch,
    region: reg,
    columns: parsed.columns || {},
    // WHICH STORE THIS CAME FROM. Recorded on the workspace row the generators
    // read, so the answer is established once instead of re-derived by a failed
    // request on every import. Null when the crawl route was not taken or the
    // site published no platform signal — which is not the same as "no store".
    platform: sf && sf.detected
      ? { id: sf.platform.id, name: sf.platform.name, confidence: sf.platform.confidence, source_url: sf.platform.source_url, route: sf.catalog_route.kind }
      : null,
    sitemap: (parsed.crawl && parsed.crawl.sitemap) || null,
    coverage_note: (parsed.crawl && parsed.crawl.coverage_note) || '',
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
   run unchanged. Nothing is written here. */
const DEVICE_CATALOG_ROWS = 2000;
const DEVICE_ROW_FIELDS = ['region', 'sku', 'handle', 'title', 'description', 'product_type', 'collections', 'price',
  'compare_at', 'currency', 'image_url', 'product_url', 'in_stock', 'tags', 'source', 'source_url'];

/** A phone sign-in whose brands are on its DEVICE: Neon or device mode. A phone
 *  account in Supabase Auth (mode 'supabase', #119) has workspaces like any account. */
function isPhoneAuth(auth) { return !!(auth && auth.ok !== false && auth.provider === 'mobile-pin' && auth.mode !== 'supabase'); }

async function deviceCatalogImport(auth, { region = 'us', kind, text, url, brand }) {
  const b = brand && typeof brand === 'object' && !Array.isArray(brand) ? brand : {};
  const scope = {
    website: httpUrl(b.website) || httpUrl(url) || '',
    regions: Array.isArray(b.regions) ? b.regions.slice(0, 20) : [],
    asset_hosts: Array.isArray(b.asset_hosts) ? b.asset_hosts.filter((h) => typeof h === 'string').slice(0, 20) : [],
  };
  const { parsed, reg, k } = await readCatalogSource({ region, kind, text, url, scope });
  const seen = new Set();
  const products = [];
  for (const r of parsed.rows) {
    const key = `${r.region}|${r.handle || ''}|${r.sku || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = {};
    for (const f of DEVICE_ROW_FIELDS) if (r[f] !== undefined) row[f] = r[f];
    products.push(row);
  }
  const kept = products.slice(0, DEVICE_CATALOG_ROWS);
  const batch = require('crypto').randomUUID();
  return {
    ok: true,
    imported: kept.length,
    skipped: (parsed.skipped || 0) + (products.length - kept.length),
    region: reg,
    storage: 'device',
    products: kept,
    source: catalogSourceRecord(parsed, k, url, kept.length, batch, reg),
    note: products.length > kept.length
      ? `Kept the first ${kept.length} of ${products.length} products on this device; a browser holds a bounded amount. Nothing was invented for the rest.`
      : 'Kept on this device, beside the brand. Nothing was written to a database.',
  };
}

async function importCatalog(auth, { workspace_id, region = 'us', kind, text, url, replace = true, brand }) {
  // A mobile-number sign-in has no workspace row to file under: the rows go
  // back to its device instead (see deviceCatalogImport above).
  if (isPhoneAuth(auth)) return deviceCatalogImport(auth, { region, kind, text, url, brand });
  // A replacement import can destroy the whole catalog, so membership is not
  // enough — this needs write permission. The RLS policy enforces it too
  // (20260809150000), but failing here gives the user a real message.
  const ws = await assertCanWrite(auth, workspace_id, 'import or replace its catalog');
  const { parsed, reg, k } = await readCatalogSource({ region, kind, text, url, scope: ws });

  // De-dupe on the table's unique key before insert so one bad source row can't
  // abort the whole import.
  const batch = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : require('crypto').randomUUID();
  const seen = new Set();
  const payload = [];
  for (const r of parsed.rows) {
    const key = `${r.region}|${r.handle || ''}|${r.sku || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    payload.push(Object.assign({ workspace_id, import_batch: batch }, r));  // workspace_id/import_batch ignored by the RPC, used by the additive path
  }

  let inserted = 0;
  if (replace) {
    // ATOMIC REPLACE. Chunked upserts cannot be made all-or-nothing from here:
    // the unique key is (workspace_id, region, handle, sku), so an upsert
    // OVERWRITES a matching existing row in place, and a failure after the
    // first chunk would leave a mixture of old, overwritten and new rows that
    // skipping a final delete could not undo. The delete and the insert must
    // therefore happen in ONE database call, which is one transaction — that
    // is what brand_catalog_replace() does. A failure rolls the whole swap
    // back and the previous catalog survives untouched.
    const out = await restAs(auth.token, 'rpc/brand_catalog_replace', {
      method: 'POST',
      body: { p_workspace: workspace_id, p_region: reg, p_rows: payload, p_batch: batch },
    });
    inserted = (out && typeof out.inserted === 'number') ? out.inserted : payload.length;
  } else {
    // Additive import: no existing row is destroyed, so per-chunk failure is
    // recoverable by simply re-running it.
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500);
      await restAs(auth.token, 'brand_catalog_products?on_conflict=workspace_id,region,handle,sku', {
        method: 'POST', body: chunk, prefer: 'resolution=merge-duplicates,return=minimal',
      });
      inserted += chunk.length;
    }
  }

  const source = catalogSourceRecord(parsed, k, url, inserted, batch, reg);
  await restAs(auth.token, `brand_workspaces?id=eq.${encodeURIComponent(workspace_id)}`, {
    method: 'PATCH', body: { catalog_source: source }, prefer: 'return=minimal',
  });
  // catalog_source lives on the workspace row that the generators read, so an
  // import that is not followed by this keeps planning from the old catalogue.
  invalidateBrandCaches({ userId: auth.user_id, workspaceId: workspace_id });

  return { ok: true, imported: inserted, skipped: parsed.skipped || 0, region: reg, source };
}

async function listCatalog(auth, { workspace_id, region, limit = 60 }) {
  const lim = Math.max(1, Math.min(500, +limit || 60));
  let q = `brand_catalog_products?select=id,region,sku,handle,title,product_type,collections,price,compare_at,currency,image_url,product_url,in_stock,source&workspace_id=eq.${encodeURIComponent(workspace_id)}&order=title.asc&limit=${lim}`;
  if (region) q += `&region=eq.${encodeURIComponent(String(region).toLowerCase())}`;
  const rows = await restAs(auth.token, q);
  return Array.isArray(rows) ? rows : [];
}

/** The payload the browser shell needs to become this brand. */
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
  let store = null;
  try { store = await require('./mobile-auth-core.js').status(); } catch (_) { store = null; }
  if (!store || store.mode !== 'device') return { checkable: true };
  const accounts = store.reason === 'no_database_url'
    ? 'Accounts are kept on each device, because no DATABASE_URL is set.'
    : `Accounts are not in a database that answers (${store.host || 'the configured database'}).`;
  let e;
  try { e = env(); } catch (_) {
    return { checkable: false, message: `This deployment has no workspace database configured (SUPABASE_URL). ${accounts}` };
  }
  if (await authHostAnswers(e)) return { checkable: true };
  return {
    checkable: false,
    message: `The database this deployment points at (${hostOfUrl(e.url)}) is not answering, so no sign-in can be checked. `
      + `Its Supabase project has most likely been deleted, renamed or paused. ${accounts}`,
  };
}

/**
 * Answer `op=document-fetch` with the document's BYTES (not JSON), or a refusal
 * sentence as JSON. The browser reads the file; this only carries it past a
 * host that sends no CORS headers. See brand-document-fetch.js.
 */
async function sendDocument(res, body, q) {
  try {
    const out = await require('./brand-document-fetch.js').fetchDocument(str(body.url || q.url, 2000));
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

  if (openWithoutBackend && op === 'document-fetch') return sendDocument(res, body, q);
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
        { open: true, req, render: !renderOff() && body.render !== false },
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
        return res.status(200).json({ ok: true, workspaces: rows.map((w) => shellPayload(w)), active_id: active, user: { id: auth.user_id, email: auth.email } });
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
        const products = await productCount(auth, id);
        return res.status(200).json({
          ok: true,
          brand: shellPayload(ws, { readiness: readiness(ws, { products }), products }),
          needs_onboarding: false,
          user: { id: auth.user_id, email: auth.email },
        });
      }
      case 'get': {
        const ws = await getWorkspace(auth, str(q.id || body.id));
        if (!ws) return res.status(404).json({ ok: false, error: 'workspace_not_found' });
        const products = await productCount(auth, ws.id);
        return res.status(200).json({ ok: true, brand: Object.assign({}, ws, { tokens: tokens(ws), fonts_href: fontsHref(ws), readiness: readiness(ws, { products }), products }) });
      }
      case 'save': {
        const ws = await saveWorkspace(auth, body.brand || body);
        const products = ws && ws.id ? await productCount(auth, ws.id) : 0;
        return res.status(200).json({ ok: true, brand: Object.assign({}, ws, { tokens: tokens(ws), fonts_href: fontsHref(ws), readiness: readiness(ws, { products }), products }) });
      }
      case 'activate': {
        const ws = await setActive(auth, str(body.id || q.id));
        const products = await productCount(auth, ws.id);
        return res.status(200).json({ ok: true, brand: shellPayload(ws, { readiness: readiness(ws, { products }), products }) });
      }
      case 'delete': {
        return res.status(200).json(await deleteWorkspace(auth, str(body.id || q.id)));
      }
      case 'catalog-import': {
        return res.status(200).json(await importCatalog(auth, {
          workspace_id: str(body.workspace_id || q.workspace_id),
          region: body.region || q.region || 'us',
          kind: body.kind || q.kind,
          text: body.text,
          url: body.url || q.url,
          replace: body.replace !== false,
          // Read only for a caller whose brands are on its device (a phone
          // sign-in): the scope a workspace row would otherwise supply.
          brand: body.brand,
        }));
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
        return res.status(200).json({ ok: true, readiness: readiness(ws, { products: await productCount(auth, ws.id) }) });
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
        }, { open: false, req, render: !renderOff() && body.render !== false });
        const extra = (spend && wantsVoice) ? { voice_skipped: true, voice_note: VOICE_SKIPPED_NOTE } : {};
        return res.status(out && out.ok === false && out.error ? 400 : 200).json(Object.assign({}, out, extra));
      }
      // The bytes of a brand guideline document the operator LINKED, for the
      // browser to read (brand-document.js). See brand-document-fetch.js.
      case 'document-fetch': {
        return sendDocument(res, body, q);
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
          available: ['defaults', 'presets', 'list', 'active', 'get', 'save', 'activate', 'delete',
            'catalog-import', 'catalog', 'readiness', 'validate-palette', 'extract', 'suggest', 'document-fetch', 'render-probe',
            'context-build', 'context-step', 'context-pack', 'context-design', 'context-list', 'context-apply'],
        });
    }
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    return res.status(status).json({ ok: false, error: err.message || 'brand_operation_failed', details: err.details || undefined });
  }
}

module.exports = {
  handle,
  requireUser,
  restAs,
  // colour
  normHex, contrast, luminance, saturation, isDarkNeutral, shade, readableOn, readableAsText, validatePalette,
  sectionGround, textOn,
  TEXT_AA,
  // brand
  normalizePalette, normalizeTypography, normalizeVoice, normalizeRegions, tokens, fontsHref,
  readiness, launchMarker, shellPayload, slugify, DEFAULT_BRAND,
  // catalog
  parseCsv, rowsFromCsv, rowsFromJson, rowsFromStorefront, assertPublicUrl, isPrivateIp, BLOCKED_HOST_RX,
  // data access
  listWorkspaces, getWorkspace, activeWorkspaceId, setActive, saveWorkspace, deleteWorkspace,
  importCatalog, deviceCatalogImport, readCatalogSource, isPhoneAuth, DEVICE_CATALOG_ROWS, listCatalog, assertCanWrite, seedCompetitorsOnActivation,
  // context pack + field provenance
  claimedFields, claimUserOwnedFields, packSummary, fireContextChain,
  carriedFields, recordedOrigins, ORIGIN_RANK,
};
