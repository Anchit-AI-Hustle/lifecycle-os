#!/usr/bin/env node
'use strict';
/**
 * selfhost-keys.js — every secret the self-hosted stack needs, from one JWT secret.
 * ---------------------------------------------------------------------------
 * THE PART PEOPLE GET WRONG: ANON_KEY and SERVICE_ROLE_KEY are not passwords.
 * They are JSON Web Tokens SIGNED WITH JWT_SECRET (HS256), and three services
 * read their claims:
 *
 *   - PostgREST verifies the signature with PGRST_JWT_SECRET and runs
 *     `SET ROLE <payload.role>` — so `role` must be exactly `anon` or
 *     `service_role`, the Postgres roles that exist.
 *   - GoTrue verifies with GOTRUE_JWT_SECRET and treats any token whose `role`
 *     is in GOTRUE_JWT_ADMIN_ROLES (`service_role`) as an admin call.
 *   - Kong never decodes them; it matches the literal string against the
 *     consumer key list, which is why the SAME bytes must land in .env, in
 *     Kong's environment and in the app's SUPABASE_ANON_KEY.
 *
 * Claim shape, byte-for-byte what upstream's utils/generate-keys.sh emits:
 *   {"role":"anon","iss":"supabase","iat":<now>,"exp":<now + 5 years>}
 *   {"role":"service_role","iss":"supabase","iat":<now>,"exp":<now + 5 years>}
 *
 * Header {"alg":"HS256","typ":"JWT"}; base64url without padding; signature is
 * HMAC-SHA256(secret, header + "." + payload). Node's crypto, no library.
 *
 * Usage:
 *   node scripts/selfhost-keys.js                 print a fresh set
 *   node scripts/selfhost-keys.js --write         write into selfhost/.env
 *                                                 (created from .env.example)
 *   node scripts/selfhost-keys.js --secret <s>    reuse an existing JWT_SECRET
 *   node scripts/selfhost-keys.js --decode <jwt>  show a token's claims and
 *                                                 whether JWT_SECRET signs it
 *
 * --write only fills a value that is empty or still the .env.example
 * placeholder; pass --rotate to replace existing secrets (every client
 * holding the old ANON_KEY then gets 401 until it is updated — that includes
 * the three Vercel env vars). POSTGRES_PASSWORD is never touched when
 * DB_MODE=external: that password belongs to your managed database.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FIVE_YEARS = 5 * 365 * 24 * 3600;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Sign `payload` (an object; key order preserved) with HS256. */
function signHS256(payload, secret) {
  if (!secret || String(secret).length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', String(secret)).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
}

function decodeJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('not a JWT: expected three dot-separated parts');
  return {
    header: JSON.parse(fromB64url(parts[0]).toString('utf8')),
    payload: JSON.parse(fromB64url(parts[1]).toString('utf8')),
    signature: parts[2],
    signingInput: `${parts[0]}.${parts[1]}`,
  };
}

/** True only when the signature is HMAC-SHA256 over the exact signing input with `secret`. */
function verifyHS256(token, secret) {
  const { signature, signingInput } = decodeJwt(token);
  const expected = b64url(crypto.createHmac('sha256', String(secret)).update(signingInput).digest());
  const a = Buffer.from(signature), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The two API keys GoTrue/PostgREST/Kong expect, for a given secret. */
function apiKeys(secret, { iat = Math.floor(Date.now() / 1000), exp = null } = {}) {
  const expiry = exp == null ? iat + FIVE_YEARS : exp;
  const claims = (role) => ({ role, iss: 'supabase', iat, exp: expiry });
  return {
    ANON_KEY: signHS256(claims('anon'), secret),
    SERVICE_ROLE_KEY: signHS256(claims('service_role'), secret),
    iat, exp: expiry,
  };
}

/** A complete secret set. Lengths follow upstream's generate-keys.sh. */
function generate({ secret = null } = {}) {
  const JWT_SECRET = secret || b64url(crypto.randomBytes(32));   // 43 chars, >= 32
  const keys = apiKeys(JWT_SECRET);
  return {
    JWT_SECRET,
    ANON_KEY: keys.ANON_KEY,
    SERVICE_ROLE_KEY: keys.SERVICE_ROLE_KEY,
    POSTGRES_PASSWORD: crypto.randomBytes(16).toString('hex'),        // URL-safe: it is embedded in connection strings
    DASHBOARD_PASSWORD: crypto.randomBytes(16).toString('hex'),       // alphanumeric: substituted into Kong's YAML
    SECRET_KEY_BASE: crypto.randomBytes(48).toString('base64'),      // >= 64 chars
    REALTIME_DB_ENC_KEY: crypto.randomBytes(8).toString('hex'),      // exactly 16 chars
    PG_META_CRYPTO_KEY: crypto.randomBytes(24).toString('base64'),   // >= 32 chars
    S3_PROTOCOL_ACCESS_KEY_ID: crypto.randomBytes(16).toString('hex'),
    S3_PROTOCOL_ACCESS_KEY_SECRET: crypto.randomBytes(32).toString('hex'),
  };
}

const PLACEHOLDER = /^(your-|this_password_is_insecure|super-secret|CHANGE)/i;

function writeEnv(envPath, values, { rotate = false } = {}) {
  const lib = require('./lib/selfhost-compose.js');
  if (!fs.existsSync(envPath)) fs.copyFileSync(lib.PATHS.envExample, envPath);
  const current = lib.parseEnv(fs.readFileSync(envPath, 'utf8'));
  const external = String(current.DB_MODE || 'local').toLowerCase() === 'external';
  let text = fs.readFileSync(envPath, 'utf8');
  const written = [], kept = [];
  for (const [k, v] of Object.entries(values)) {
    if (k === 'POSTGRES_PASSWORD' && external) { kept.push(k + ' (DB_MODE=external: the managed database owns it)'); continue; }
    const have = current[k];
    const filled = have !== undefined && have !== '' && !PLACEHOLDER.test(have);
    if (filled && !rotate) { kept.push(k); continue; }
    const re = new RegExp(`^${k}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : text + `\n${k}=${v}\n`;
    written.push(k);
  }
  fs.writeFileSync(envPath, text);
  return { written, kept };
}

module.exports = { signHS256, decodeJwt, verifyHS256, apiKeys, generate, writeEnv, FIVE_YEARS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] || true) : null; };
  const lib = require('./lib/selfhost-compose.js');
  const envPath = flag('--env-file') && flag('--env-file') !== true ? path.resolve(flag('--env-file')) : lib.PATHS.env;

  if (flag('--decode')) {
    const token = flag('--decode');
    const d = decodeJwt(token);
    let secret = flag('--secret');
    if (!secret && fs.existsSync(envPath)) secret = lib.parseEnv(fs.readFileSync(envPath, 'utf8')).JWT_SECRET;
    console.log(JSON.stringify({ header: d.header, payload: d.payload, signed_by_JWT_SECRET: secret ? verifyHS256(token, secret) : 'no secret given' }, null, 2));
    process.exit(0);
  }

  let secret = flag('--secret') && flag('--secret') !== true ? flag('--secret') : null;
  if (!secret && args.includes('--write') && !args.includes('--rotate') && fs.existsSync(envPath)) {
    const cur = lib.parseEnv(fs.readFileSync(envPath, 'utf8')).JWT_SECRET;
    if (cur && !PLACEHOLDER.test(cur) && cur.length >= 32) secret = cur;   // keep the secret; fill what is missing
  }
  const set = generate({ secret });

  if (args.includes('--write')) {
    const r = writeEnv(envPath, set, { rotate: args.includes('--rotate') });
    console.log(`wrote ${envPath}`);
    if (r.written.length) console.log('  set:  ' + r.written.join(', '));
    if (r.kept.length) console.log('  kept: ' + r.kept.join(', '));
    console.log('\nThe three values the app deployment needs (Vercel env):');
    const env = lib.parseEnv(fs.readFileSync(envPath, 'utf8'));
    console.log(`  SUPABASE_URL=${env.SUPABASE_PUBLIC_URL}`);
    console.log(`  SUPABASE_ANON_KEY=${env.ANON_KEY}`);
    console.log(`  SUPABASE_SERVICE_ROLE_KEY=${env.SERVICE_ROLE_KEY}`);
  } else {
    for (const [k, v] of Object.entries(set)) console.log(`${k}=${v}`);
    console.log('\n# Pass --write to put these into selfhost/.env');
  }
}
