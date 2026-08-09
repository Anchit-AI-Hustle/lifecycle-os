'use strict';

/**
 * competitor-core.js — self-contained Competitor Benchmarking engine.
 *
 * Everything the feature needs runs from THIS repo (no dependency on the
 * separate competitor-intelligence-hub deployment):
 *   - Google Sheets read/write (service account)   — the database
 *   - Gmail IMAP fetch + mailparser                 — ingestion
 *   - text extraction (brand / promo / body)        — structuring
 *   - HCTI full-length screenshot (hosted URL)      — image of each mail
 *   - raw HTML stored per mail (column K)            — exact, re-renderable
 *
 * Lives under api/_shared/ so Vercel does NOT count it as a Serverless
 * Function (underscore-prefixed paths are excluded). The single public
 * function is api/competitor.js, which dispatches to the helpers here.
 *
 * Storage model per mail (Google Sheet columns A–K):
 *   A Brand · B Sender · C Received · D Subject · E Preview · F Body text
 *   G Promo codes · H Screenshot URL · I Inline image links · J Attachment
 *   links · K Raw HTML (capped 49k)
 */

const { google } = require('googleapis');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

// ── Sentinels ──────────────────────────────────────────────────────────────
const NONE = 'None';
const NO_SCREENSHOT = 'No Screenshot';
const RAW_HTML_MAX = 49000;

const SHEET_COLUMNS = [
  'Brand', 'Sender Email', 'Received At', 'Subject', 'Preview', 'Body Text',
  'Promo Codes', 'Screenshot URL', 'Inline Image URLs', 'Attachment URLs', 'Raw HTML',
];

// ── Google auth / clients ────────────────────────────────────────────────────
//
// Two auth modes — Workload Identity Federation (PREFERRED) and legacy JWT.
//
// 1. WIF (no static keys, can't be "rotated to death"):
//      env: GCP_WORKLOAD_IDENTITY_PROVIDER  // full resource name of the provider
//           GCP_SERVICE_ACCOUNT_EMAIL       // the SA we impersonate
//           VERCEL_OIDC_TOKEN                // auto-injected per request by Vercel
//    Flow: Vercel mints a short-lived OIDC token → exchange at Google STS for a
//          federated token → use that to impersonate the SA via IAM Credentials
//          API → cached access token expires in 1h, auto-refreshed.
//
// 2. Legacy JWT (key-based, what we used before):
//      env: GOOGLE_SERVICE_ACCOUNT_EMAIL
//           GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
//    Used as a fallback when WIF env vars aren't set — so the existing
//    deployments keep working during the cutover.
//
// All sheetsClient() callers stay synchronous: the WIF token fetch is deferred
// into the auth client's getAccessToken/getRequestHeaders, which googleapis
// invokes lazily before each request and we cache + refresh internally.

let _sheets = null;
function sheetsClient() {
  if (_sheets) return _sheets;
  // Prefer WIF only when its env vars AND a live Vercel OIDC token are present.
  // If OIDC isn't injected yet (token absent), fall back to the key-based JWT
  // path so the feature keeps working — WIF auto-engages once the token shows
  // up, with no code change. If neither is usable, buildJwtAuth() throws a
  // precise "configure one of…" error.
  const wifReady = !!(process.env.GCP_WORKLOAD_IDENTITY_PROVIDER
    && process.env.GCP_SERVICE_ACCOUNT_EMAIL
    && process.env.VERCEL_OIDC_TOKEN);
  const auth = wifReady ? buildWifAuth() : buildJwtAuth();
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

function buildJwtAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      'Google auth not configured. Set EITHER ' +
      '(GCP_WORKLOAD_IDENTITY_PROVIDER + GCP_SERVICE_ACCOUNT_EMAIL) for keyless WIF, ' +
      'OR (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) for legacy JWT.'
    );
  }
  key = key.replace(/\\n/g, '\n').replace(/^["']|["']$/g, '');
  return new google.auth.JWT({
    email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function buildWifAuth() {
  const auth = new google.auth.OAuth2();
  let cachedToken = null;
  let cachedExpiry = 0;

  async function refreshIfNeeded() {
    const now = Date.now();
    if (cachedToken && cachedExpiry > now + 60_000) return cachedToken;
    const fresh = await fetchWifAccessToken();
    cachedToken = fresh.accessToken;
    cachedExpiry = fresh.expiresAt;
    return cachedToken;
  }

  // googleapis calls one of these to attach Authorization on each request.
  auth.getAccessToken = async () => {
    const token = await refreshIfNeeded();
    return { token, res: null };
  };
  auth.getRequestHeaders = async () => {
    const token = await refreshIfNeeded();
    return { Authorization: `Bearer ${token}` };
  };
  // Some googleapis internals call request() — proxy to ensure auth headers.
  const origRequest = auth.request.bind(auth);
  auth.request = async (opts) => {
    const headers = await auth.getRequestHeaders();
    return origRequest({ ...opts, headers: { ...(opts.headers || {}), ...headers } });
  };
  return auth;
}

/**
 * WIF token exchange: Vercel OIDC → Google STS → impersonated SA access token.
 * Returns { accessToken, expiresAt(ms epoch) }. Throws with a precise reason
 * on failure so the caller can surface it.
 */
async function fetchWifAccessToken() {
  const subjectToken = process.env.VERCEL_OIDC_TOKEN;
  if (!subjectToken) {
    throw new Error('VERCEL_OIDC_TOKEN not present. Enable OIDC tokens in Vercel project settings → Environment Variables → OIDC Tokens.');
  }
  const audience = process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;     // full resource name
  const saEmail  = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  if (!audience || !saEmail) throw new Error('GCP_WORKLOAD_IDENTITY_PROVIDER / GCP_SERVICE_ACCOUNT_EMAIL missing');

  // 1. STS exchange — Vercel OIDC JWT → federated GCP access token
  const stsRes = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    }),
  });
  if (!stsRes.ok) {
    const body = await stsRes.text().catch(() => '');
    throw new Error(`STS exchange failed (${stsRes.status}): ${body.slice(0, 300)}`);
  }
  const stsJson = await stsRes.json();

  // 2. IAM Credentials — impersonate the service account
  const impUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(saEmail)}:generateAccessToken`;
  const impRes = await fetch(impUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stsJson.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      scope: ['https://www.googleapis.com/auth/spreadsheets'],
      lifetime: '3600s',
    }),
  });
  if (!impRes.ok) {
    const body = await impRes.text().catch(() => '');
    throw new Error(`SA impersonation failed (${impRes.status}): ${body.slice(0, 300)}`);
  }
  const impJson = await impRes.json();
  return {
    accessToken: impJson.accessToken,
    expiresAt: new Date(impJson.expireTime).getTime(),
  };
}
function sheetId() {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('Missing GOOGLE_SHEET_ID');
  return id;
}
function sheetTab() { return process.env.GOOGLE_SHEET_TAB || 'Emails'; }

// ── Row <-> record mapping ────────────────────────────────────────────────────
function rowToRecord(row, rowNumber) {
  const get = (i) => (row[i] == null ? '' : String(row[i]));
  return {
    id: String(rowNumber),
    brand: get(0) || 'Unknown',
    senderEmail: get(1),
    receivedAt: get(2),
    subject: get(3),
    preview: get(4),
    bodyText: get(5),
    promoCodes: get(6) || NONE,
    screenshotUrl: get(7) || NONE,
    inlineImageUrls: get(8) || NONE,
    attachmentUrls: get(9) || NONE,
  };
}

// ── Sheet operations ──────────────────────────────────────────────────────────
async function ensureSheetTab() {
  const sheets = sheetsClient();
  const tab = sheetTab();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some((s) => s.properties && s.properties.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
}

async function ensureHeaderRow() {
  const sheets = sheetsClient();
  const tab = sheetTab();
  await ensureSheetTab();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${tab}!A1:K1` });
  if (!(res.data.values && res.data.values[0] && res.data.values[0][0])) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(), range: `${tab}!A1`, valueInputOption: 'RAW',
      requestBody: { values: [SHEET_COLUMNS] },
    });
  }
}

async function appendEmailRow(e) {
  const sheets = sheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(), range: `${sheetTab()}!A:K`,
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        e.brand, e.senderEmail, e.receivedAt, e.subject, e.preview, e.bodyText,
        e.promoCodes, e.screenshotUrl, e.inlineImageUrls, e.attachmentUrls,
        (e.rawHtml || '').slice(0, RAW_HTML_MAX),
      ]],
    },
  });
}

/**
 * Sort the Emails tab in DESCENDING order of column C (Received At).
 * Called after each sync batch (NOT per-row) so newest mail always sits
 * at the top of the sheet — what the user opens to see latest first.
 *
 * Best-effort: any failure (no rows, transient API error) just logs and
 * returns — never breaks the sync. The Sheets API needs the numeric
 * sheetId (not the spreadsheet ID), so we read the metadata once.
 */
async function sortEmailsByReceivedDesc() {
  const sheets = sheetsClient();
  const tab = sheetTab();
  try {
    // 1. Get the numeric sheet ID for our tab + the row count.
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: sheetId(),
      fields: 'sheets.properties(sheetId,title,gridProperties)',
    });
    const sheet = (meta.data.sheets || []).find((s) => s.properties && s.properties.title === tab);
    if (!sheet) return;
    const gridSheetId = sheet.properties.sheetId;
    const rowCount = (sheet.properties.gridProperties && sheet.properties.gridProperties.rowCount) || 0;
    if (rowCount < 3) return;       // header + 0 or 1 rows — nothing to sort

    // 2. SortRange: rows 1..end (0-indexed header excluded), all 11 columns,
    //    sortSpec on column C (index 2) descending.
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: {
        requests: [{
          sortRange: {
            range: {
              sheetId: gridSheetId,
              startRowIndex: 1,            // skip header row
              endRowIndex: rowCount,
              startColumnIndex: 0,
              endColumnIndex: 11,           // A..K inclusive
            },
            sortSpecs: [{ dimensionIndex: 2, sortOrder: 'DESCENDING' }],
          },
        }],
      },
    });
  } catch (err) {
    // Non-fatal — sync still succeeds even if sort fails.
    console.warn('[sortEmailsByReceivedDesc] skipped:', (err && err.message) || err);
  }
}

async function getAllEmails() {
  const sheets = sheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${sheetTab()}!A2:J` });
  } catch (err) {
    if (/Unable to parse range/i.test((err && err.message) || '')) return [];
    throw err;
  }
  const rows = res.data.values || [];
  return rows
    .map((row, i) => rowToRecord(row, i + 2))
    .filter((r) => r.senderEmail || r.subject || r.brand !== 'Unknown')
    // Hide system/transactional/personal noise (Google alerts, Sheets shares,
    // HCTI, the operator's own mail) from the competitor dashboard.
    .filter((r) => !isNoiseSender(r.senderEmail, r.brand))
    .reverse();
}

async function getEmailHtml(rowNumber) {
  const n = Number(rowNumber);
  if (!Number.isInteger(n) || n < 2) return '';
  const sheets = sheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${sheetTab()}!K${n}` });
    return (res.data.values && res.data.values[0] && res.data.values[0][0]) || '';
  } catch (e) { return ''; }
}

async function getExistingKeys() {
  const emails = await getAllEmails();
  return new Set(emails.map((e) => `${e.senderEmail}|${e.subject}|${e.receivedAt}`));
}

// ── Noise filter ──────────────────────────────────────────────────────────────
// System / transactional / personal mail that is NOT a competitor newsletter.
// Applied both at capture time (skip writing) and at read time (hide legacy
// rows already in the sheet). Matches on sender domain + a few name/subject cues.
// CONSERVATIVE: only clearly-non-competitor system / dev-tool / personal
// senders. Deliberately EXCLUDES amazon/amazonses/paypal/stripe — a real
// competitor brand can legitimately send marketing via SES or mention those,
// and in practice those rules matched 0 mails, so they're dropped to avoid
// any false positive that hides a genuine competitor newsletter.
const NOISE_DOMAINS = [
  'google.com', 'accounts.google.com', 'docs.google.com', 'drive.google.com',
  'mail.google.com', 'googlemail.com', 'youtube.com',
  'htmlcsstoimage.com', 'hcti.io', 'microlink.io',
  'vercel.com', 'github.com', 'supabase.io', 'supabase.com',
  'openai.com', 'anthropic.com', 'apple.com', 'icloud.com', 'microsoft.com',
  'notion.so', 'slack.com', 'zoom.us', 'calendly.com', 'linkedin.com',
];
const NOISE_NAME_RE = /\b(google|gmail|security alert|verification|2[-\s]?step|password|sign[-\s]?in|account|receipt|invoice|calendar|via google sheets|html\/?css to image)\b/i;
// The operator's own identity — never a competitor.
const SELF_HINTS = ['anchit', 'ojhapraneet', 'knickgasm'];

function isNoiseSender(address, displayName) {
  const addr = (address || '').toLowerCase();
  const domain = addr.split('@')[1] || '';
  if (NOISE_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) return true;
  const nm = (displayName || '') + ' ' + addr;
  if (NOISE_NAME_RE.test(nm)) return true;
  if (SELF_HINTS.some((s) => nm.toLowerCase().includes(s))) return true;
  return false;
}

// ── Text extraction ───────────────────────────────────────────────────────────
function cleanBrandName(displayName, fromAddress) {
  let name = (displayName || '').trim().replace(/<[^>]*>/g, '').replace(/^["']+|["']+$/g, '').trim();
  name = name
    .replace(/\b(newsletter|team|email|mail|info|no[-\s]?reply|noreply|marketing|offers?|deals?|promotions?)\b/gi, '')
    .replace(/[|•·–—-]+\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
  if (name) return name;
  const domain = ((fromAddress || '').split('@')[1] || '').toLowerCase();
  const core = domain
    .replace(/\.(com|net|org|io|co|shop|store|email|mail)(\.[a-z]{2})?$/i, '')
    .split('.').filter((p) => !['www', 'email', 'mail', 'e', 'news', 'send', 'mkt', 'go', 'info'].includes(p)).pop();
  if (!core) return 'Unknown';
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|tr|table|h[1-6]|li|ul|ol|section|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&[a-z]+;/gi, ' ')
    .split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildPreview(bodyText, max) {
  max = max || 200;
  const oneLine = (bodyText || '').replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

const CONTEXT_RE = /(?:code|coupon|promo(?:tion)?|voucher|use|enter|apply|with)\s*(?:code)?\s*[:\-]?\s*["“']?\b([A-Z0-9][A-Z0-9._-]{2,18})\b/gi;
const SHAPE_RE = /\b([A-Z]{2,}[0-9]{1,4}|[A-Z]{3,}[0-9]+[A-Z0-9]*)\b/g;
const STOPWORDS = new Set(['SHOP', 'SALE', 'FREE', 'NEW', 'NOW', 'SAVE', 'OFF', 'GET', 'BUY', 'ONLY', 'TODAY', 'HERE', 'VIEW', 'OPEN', 'CLICK', 'SHIPPING', 'GIFT', 'THE', 'AND', 'FOR', 'YOU', 'YOUR', 'ALL', 'USD', 'EUR', 'GBP', 'INR', 'HTML', 'HTTPS', 'HTTP', 'WWW', 'COM', 'PNG', 'JPG', 'JPEG', 'GIF']);

function extractPromoCodes(text) {
  if (!text) return [];
  const found = new Set();
  for (const m of Array.from(text.matchAll(CONTEXT_RE))) {
    const code = m[1] && m[1].toUpperCase();
    if (!code || STOPWORDS.has(code)) continue;
    if (/[0-9]/.test(code) || code.length >= 5) found.add(code);
  }
  for (const m of Array.from(text.matchAll(SHAPE_RE))) {
    const code = m[1] && m[1].toUpperCase();
    if (code && !STOPWORDS.has(code)) found.add(code);
  }
  return Array.from(found).slice(0, 8);
}
const joinOrNone = (arr) => (arr && arr.length ? arr.join(', ') : NONE);

// ── Visual rendering — FREE full-page screenshot, no heavy deps ──────────────
// Headless Chromium can't be bundled into this serverless function without
// breaking its cold-start (it exceeds the size/init budget). Instead we render
// for free WITHOUT bundling a browser:
//   1. The full raw HTML of every mail is stored in the sheet (col K) and is
//      served as a standalone page at /api/competitor?action=raw&key=<b64>.
//   2. We store (col H) a screenshot URL = a free image API (Microlink) pointed
//      at that page, which renders a full-page PNG on demand — no API key, no
//      watermark. The dashboard <img>/download just uses that URL.
// The HTML is the archived source of truth; the screenshot is reproducible.

function wrapHtml(rawHtml) {
  if (/<html[\s>]/i.test(rawHtml)) return rawHtml;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}.__wrap{width:640px;margin:0 auto;}</style></head><body><div class="__wrap">${rawHtml}</div></body></html>`;
}

// Base URL of this deployment (for the public raw-HTML endpoint).
function appBaseUrl() {
  return (process.env.SCREENSHOT_BASE_URL || 'https://knickgasm.vercel.app').replace(/\/$/, '');
}
// Stable key for an email → used to look up its HTML at the raw endpoint.
function emailKey(address, subject, receivedAt) {
  return Buffer.from(`${address}|${subject}|${receivedAt}`).toString('base64');
}
// Free full-page screenshot URL (Microlink) of the raw-HTML page for this mail.
function screenshotUrlForKey(key) {
  const rawUrl = `${appBaseUrl()}/api/competitor?action=raw&key=${encodeURIComponent(key)}`;
  return `https://api.microlink.io/?url=${encodeURIComponent(rawUrl)}&screenshot=true&fullPage=true&meta=false&embed=screenshot.url`;
}

/** Return a standalone HTML page for one mail (by row id or base64 key). */
async function getRawHtml(opts) {
  opts = opts || {};
  let html = '';
  if (opts.id) {
    html = await getEmailHtml(Number(opts.id));
  } else if (opts.key) {
    let decoded = '';
    try { decoded = Buffer.from(String(opts.key), 'base64').toString('utf8'); } catch (e) { decoded = ''; }
    if (decoded) {
      const emails = await getAllEmails();
      const m = emails.find((e) => `${e.senderEmail}|${e.subject}|${e.receivedAt}` === decoded);
      if (m) html = await getEmailHtml(Number(m.id));
    }
  }
  return html ? wrapHtml(html) : '';
}

// ── IMAP ingestion ────────────────────────────────────────────────────────────
function imapConfig() {
  const user = process.env.GMAIL_IMAP_USER;
  const pass = process.env.GMAIL_IMAP_PASSWORD;
  if (!user || !pass) throw new Error('Missing GMAIL_IMAP_USER/PASSWORD');
  return {
    host: process.env.GMAIL_IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.GMAIL_IMAP_PORT || 993),
    secure: true, auth: { user, pass }, logger: false,
  };
}

async function fetchUnreadEmails(limit) {
  limit = limit || 25;
  const client = new ImapFlow(imapConfig());
  const out = [];
  await client.connect();
  // Scan the primary inbox AND the Spam folder. Competitor promos are often
  // mis-filed by Gmail as spam; the Promotions/Social/Updates tabs are already
  // part of INBOX over IMAP, so those need no separate scan. Spam is a distinct
  // mailbox ([Gmail]/Spam, localized name varies) that INBOX search never sees.
  const MAILBOXES = ['INBOX', '[Gmail]/Spam', '[Google Mail]/Spam'];
  let remaining = limit;
  for (const box of MAILBOXES) {
    if (remaining <= 0) break;
    let lock;
    try {
      lock = await client.getMailboxLock(box);
    } catch (err) {
      // Mailbox doesn't exist (e.g. the [Google Mail]/ variant) — skip quietly.
      continue;
    }
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (uids && uids.length) {
        for (const uid of uids.slice(0, remaining)) {
          try {
            const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
            if (!msg || !msg.source) continue;
            out.push(await simpleParser(msg.source));
            await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
            remaining--;
          } catch (err) { console.error(`[competitor] ${box} uid ${uid} failed`, err.message); }
        }
      }
    } finally {
      lock.release();
    }
  }
  await client.logout().catch(() => client.close());
  return out;
}

// ── Sync orchestration ────────────────────────────────────────────────────────
async function runSync(limit) {
  const started = Date.now();
  const errors = [];
  let appended = 0;
  await ensureHeaderRow();
  const existing = await getExistingKeys();
  const parsedList = await fetchUnreadEmails(limit || 25);

  for (const parsed of parsedList) {
    try {
      const from = (parsed.from && parsed.from.value && parsed.from.value[0]) || {};
      const address = (from.address || '').toLowerCase();
      // Skip system/transactional/personal mail — only competitor newsletters
      // belong in the benchmarking sheet.
      if (isNoiseSender(address, from.name || '')) continue;
      const brand = cleanBrandName(from.name || '', address);
      const subject = parsed.subject || '(no subject)';
      const receivedAt = (parsed.date || new Date()).toISOString();
      const fullHtml = parsed.html || parsed.textAsHtml || '';
      const bodyText = (parsed.text && parsed.text.trim()) || htmlToText(fullHtml);
      const preview = buildPreview(bodyText);
      const promoCodes = joinOrNone(extractPromoCodes(`${subject}\n${bodyText}`));

      const key = `${address}|${subject}|${receivedAt}`;
      if (existing.has(key)) continue;

      // FREE full-page screenshot URL (Microlink renders the stored HTML page
      // on demand). No browser bundled here. Raw HTML (col K) is the archive.
      const screenshotUrl = fullHtml ? screenshotUrlForKey(emailKey(address, subject, receivedAt)) : NONE;

      const inlineCount = (parsed.attachments || []).filter((a) => a.contentDisposition === 'inline' || a.cid || a.related).length;
      const attachCount = (parsed.attachments || []).length - inlineCount;

      await appendEmailRow({
        brand, senderEmail: address, receivedAt, subject, preview, bodyText, promoCodes,
        screenshotUrl,
        inlineImageUrls: inlineCount ? `${inlineCount} inline (in HTML)` : NONE,
        attachmentUrls: attachCount ? `${attachCount} attachment(s)` : NONE,
        rawHtml: fullHtml,
      });
      existing.add(key);
      appended++;
    } catch (err) {
      errors.push((err && err.message) || 'unknown');
    }
  }
  // Newest-first sort: only when we actually appended (cheap call, but no point
  // re-sorting on a no-op poll).
  if (appended > 0) { await sortEmailsByReceivedDesc(); }
  return { ok: true, processed: parsedList.length, appended, errors, durationMs: Date.now() - started };
}

/**
 * FREE capture path — no Gmail/IMAP botting required.
 *
 * A forwarder (Cloudflare Email Routing → n8n webhook, or any HTTP source)
 * POSTs a single captured newsletter here. We normalise it with the SAME
 * helpers as runSync() and append one row to the Emails sheet, de-duplicated
 * by the address|subject|receivedAt key.
 *
 * Accepted payload (all optional except one of html/text):
 *   { from, fromName, subject, html, text, receivedAt }
 *   - `from`     : sender email address (e.g. "news@brand.com")
 *   - `fromName` : display name (e.g. "Brand Newsletter")
 *   - `html`     : full raw HTML of the email
 *   - `text`     : plain-text body (used if html missing)
 *   - `receivedAt: ISO date string (defaults to now)
 *
 * Returns { ok, stored:boolean, reason?, brand?, key? }.
 */
async function ingestEmail(payload) {
  payload = payload || {};
  const address = String(payload.from || payload.sender || payload.fromAddress || '').toLowerCase().trim();
  const fromName = String(payload.fromName || payload.name || '').trim();
  if (!address) return { ok: false, stored: false, reason: 'missing_from' };

  // Same noise filter as the IMAP path — only competitor newsletters belong here.
  if (isNoiseSender(address, fromName)) return { ok: true, stored: false, reason: 'filtered_noise' };

  const subject = String(payload.subject || '(no subject)').slice(0, 998);
  const receivedAt = payload.receivedAt ? new Date(payload.receivedAt).toISOString() : new Date().toISOString();
  const fullHtml = payload.html || payload.rawHtml || '';
  const bodyText = (payload.text && String(payload.text).trim()) || htmlToText(fullHtml);
  if (!fullHtml && !bodyText) return { ok: false, stored: false, reason: 'empty_body' };

  const brand = cleanBrandName(fromName, address);
  const key = `${address}|${subject}|${receivedAt}`;

  await ensureHeaderRow();
  const existing = await getExistingKeys();
  if (existing.has(key)) return { ok: true, stored: false, reason: 'duplicate', brand, key };

  const preview = buildPreview(bodyText);
  const promoCodes = joinOrNone(extractPromoCodes(`${subject}\n${bodyText}`));
  const screenshotUrl = fullHtml ? screenshotUrlForKey(emailKey(address, subject, receivedAt)) : NONE;

  await appendEmailRow({
    brand, senderEmail: address, receivedAt, subject, preview, bodyText, promoCodes,
    screenshotUrl, inlineImageUrls: NONE, attachmentUrls: NONE, rawHtml: fullHtml,
  });
  await sortEmailsByReceivedDesc();
  return { ok: true, stored: true, brand, key };
}

/**
 * Pull a competitor's CURRENTLY-ACTIVE ads from the free Meta Ad Library.
 *
 * Tiered, all free:
 *   1. If APIFY_TOKEN is set → run the public Meta Ad Library scraper actor on
 *      Apify's free plan and return structured creatives (capped to keep within
 *      free monthly credits).
 *   2. Otherwise → return a deep-link into the public Meta Ad Library UI so the
 *      user can browse the same active ads manually (no key needed).
 *
 * @param {{brand:string, country?:string, limit?:number}} opts
 */
async function fetchMetaAds(opts) {
  const brand = String((opts && opts.brand) || '').trim();
  const country = String((opts && opts.country) || 'ALL').toUpperCase();
  const limit = Math.min(Number(opts && opts.limit) || 20, 50);
  if (!brand) return { ok: false, error: 'missing_brand' };

  const deepLink = 'https://www.facebook.com/ads/library/?' + new URLSearchParams({
    active_status: 'all', ad_type: 'all', country, q: brand,
    search_type: 'keyword_unordered', media_type: 'all',
  }).toString();

  const apifyToken = (process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || '').trim();
  if (!apifyToken) {
    return { ok: true, source: 'deep_link', brand, country, deepLink, ads: [],
      note: 'Set APIFY_TOKEN (free plan) to pull structured active creatives. Deep-link returned for manual browse.' };
  }

  // Apify "run-sync-get-dataset-items" — one HTTP call, returns the dataset.
  // Actor: curious_coder/facebook-ads-library-scraper (public). The exact actor
  // can be swapped via APIFY_META_ADS_ACTOR.
  const actor = (process.env.APIFY_META_ADS_ACTOR || 'curious_coder~facebook-ads-library-scraper').trim();
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}`;
  const input = {
    urls: [{ url: deepLink, method: 'GET' }],
    count: limit, scrapeAdDetails: false, 'searchTerms': [brand], 'country': country,
  };
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 200);
      return { ok: true, source: 'deep_link', brand, country, deepLink, ads: [], error: `apify_${r.status}`, detail };
    }
    const items = await r.json();
    const ads = (Array.isArray(items) ? items : []).slice(0, limit).map((a) => ({
      id: a.adArchiveID || a.ad_archive_id || a.id || '',
      page: a.pageName || a.page_name || brand,
      body: (a.adText || a.body || a.snapshot?.body?.text || '').slice(0, 400),
      image: a.imageUrl || a.snapshot?.images?.[0]?.original_image_url || '',
      startDate: a.startDate || a.start_date || '',
      link: a.url || a.snapshot?.link_url || deepLink,
    }));
    return { ok: true, source: 'apify', brand, country, deepLink, ads, count: ads.length };
  } catch (e) {
    return { ok: true, source: 'deep_link', brand, country, deepLink, ads: [], error: String(e && e.message || e).slice(0, 160) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PHASE 2 — Competitor BRAND database + discovery engine
//  Stored in a second tab ("Competitors") of the same spreadsheet.
// ═══════════════════════════════════════════════════════════════════════════

const callLLM = require('./llm');

function brandsTab() { return process.env.GOOGLE_BRANDS_TAB || 'Competitors'; }

// Column order for the Competitors tab (A–R).
const BRAND_COLUMNS = [
  'Brand Name', 'Website URL', 'Domain', 'Category', 'Country', 'Positioning',
  'Newsletter Signup URL', 'Popup Signup', 'SMS Signup', 'Blog URL',
  'Bestseller URL', 'New Arrivals URL', 'Subscription Status', 'Date Subscribed',
  'Confirmation Required', 'Confirmation Completed', 'Source', 'Added At',
];

// Our OWN brand domains — never treated as competitors (excluded from seed,
// discovery, and display).
const OWN_DOMAINS = ['knickgasm.com'];
function isOwnBrand(domainOrUrl) {
  const d = normalizeDomain(domainOrUrl);
  return OWN_DOMAINS.some((o) => d === o || d.endsWith('.' + o));
}

// Priority seed brands — the curated KNICKGASM competitive set, researched and
// URL-verified 2026-08-03. Direct competitors are India's custom-sneaker studios;
// retail/marketplaces and indie brands compete for the same sneakerhead wallet;
// the official programs (Nike By You, Converse By You) and custom-controller
// players are the global personalization benchmarks. KNICKGASM is the reference,
// NOT a competitor, so it is intentionally excluded. appendBrands() dedupes by
// domain, so re-seeding is idempotent.
const SEED_BRANDS = [
  // ── Custom-sneaker studios (direct competitors) ──
  { brandName: 'Cheeky Sneeky', websiteUrl: 'https://cheekysneeky.com', category: 'Custom Sneakers', country: 'India', positioning: 'Mid-market' },  // INR 9,499 – 17,499 across pre-made collections and customs, observed on cheekysneeky.com 2026-08-03
  { brandName: 'Courtside', websiteUrl: 'https://www.courtside.store', category: 'Custom Sneakers', country: 'India', positioning: 'Premium' },  // New Delhi · INR 9,490 – 27,990 for custom sneaker products (most items ₹13,990–₹19,990), prices scraped from courtside.store homepage 2026-08-03
  { brandName: 'Kickstradomis', websiteUrl: 'https://kickstradomis.com', category: 'Custom Sneakers', country: 'USA', positioning: 'Premium' },  // Los Angeles · Entry point of US$1,200 for custom paint work, plus the cost of the shoes (per Forbes interview, March 2021; no public price list on kickstradomis.com as of 2026-08-03)
  { brandName: 'MD Customs', websiteUrl: 'https://www.mdcustoms.in/en-us', category: 'Custom Sneakers', country: 'India', positioning: 'Premium' },  // New Delhi · Rs. 25,000 – 45,000 (e.g. 'TIFFANY AF1' Rs.25,000, 'LV Birkinstock' Rs.45,000), observed on mdcustoms.in 2026-08-03
  { brandName: 'Moreiarty', websiteUrl: 'https://www.moreiarty.in', category: 'Custom Sneakers', country: 'India', positioning: 'Premium' },  // New Delhi · INR 4,990 – 19,990+ per customization (Essential to Signature tiers; base shoe cost separate), observed on moreiarty.in 2026-08-03
  { brandName: 'Shoes Your Daddy', websiteUrl: 'https://www.shoesyourdaddy.in', category: 'Custom Sneakers', country: 'India', positioning: 'Premium' },  // New Delhi · Pre-designed sneakers Rs. 16,999 – 28,000, made-to-order with 2–3 week turnaround, observed on shoesyourdaddy.in 2026-08-03
  { brandName: 'Sneak Peek Shoes', websiteUrl: 'https://www.handpaintedsneaker.com', category: 'Custom Sneakers', country: 'India', positioning: 'Premium' },  // Mumbai · INR 10,999 – 24,999 (no cash-on-delivery), observed on handpaintedsneaker.com 2026-08-03
  { brandName: 'Sneakaboo', websiteUrl: 'https://www.instagram.com/sneakaboo.in', category: 'Custom Sneakers', country: 'India', positioning: 'Accessible' },  // Noida · INR 1,500 and up per LBB/Homegrown coverage (own website sneakaboo.in did not resolve when opened 2026-08-03; orders taken via Instagram/Facebook)
  { brandName: 'The Leather Works (TLW Art House)', websiteUrl: 'https://theleatherworks.in', category: 'Custom Sneakers', country: 'India', positioning: 'Premium' },  // Ahmedabad · INR 5,999 – 24,999 for custom sneaker art depending on complexity; sourced Nike AF1s approx INR 8,500 plus personalization, observed on theleatherworks.in/pages/custom-sneakers 2026-08-03
  { brandName: 'The Shoe Surgeon (SRGN)', websiteUrl: 'https://www.thesurgeon.com', category: 'Custom Sneakers', country: 'USA', positioning: 'Premium' },  // Los Angeles · USD $20 (paint pens/socks) to $10,000+ for 1-of-1 custom sneakers; most ready-made custom sneakers listed at US$5,000 (observed via thesurgeon.com Shopify catalog, 2026-08-03). Press reports bespoke commissions up to $200,000.
  // ── Sneaker retail & marketplaces (wallet-share competitors) ──
  { brandName: 'CrepDog Crew', websiteUrl: 'https://crepdogcrew.com', category: 'Sneaker Retail & Marketplace', country: 'India', positioning: 'Premium' },  // New Delhi · Sneakers INR 9,749-254,499; apparel from INR 1,509; catalog spans to INR 500,000+ (observed on crepdogcrew.com, 2026-08-03)
  { brandName: 'FindYourKicks India', websiteUrl: 'https://www.findyourkicks.com', category: 'Sneaker Retail & Marketplace', country: 'India', positioning: 'Premium' },  // Ludhiana · Not observable: site showed a 'Maintenance | Find Your Kicks' holding page when fetched on 2026-08-03
  { brandName: 'Hype Fly India', websiteUrl: 'https://hypefly.co.in', category: 'Sneaker Retail & Marketplace', country: 'India', positioning: 'Premium' },  // Mumbai · INR pricing across sneakers/streetwear (Yeezy, Jordan, Dunks, Essentials); specific prices not shown on homepage at fetch time (hypefly.co.in, 2026-08-03)
  { brandName: 'Mainstreet Marketplace', websiteUrl: 'https://marketplace.mainstreet.co.in', category: 'Sneaker Retail & Marketplace', country: 'India', positioning: 'Premium' },  // Mumbai · Premium hype resale (Yeezy/Jordan/Nike, luxury apparel); 7,000+ SKUs claimed; specific INR range not captured at fetch time (marketplace.mainstreet.co.in, 2026-08-03)
  { brandName: 'Superkicks', websiteUrl: 'https://www.superkicks.in', category: 'Sneaker Retail & Marketplace', country: 'India', positioning: 'Premium' },  // Mumbai · INR 449 (socks) to ~23,999; sneakers typically INR 6,599-19,995 (observed on superkicks.in, 2026-08-03)
  { brandName: 'VegNonVeg', websiteUrl: 'https://www.vegnonveg.com', category: 'Sneaker Retail & Marketplace', country: 'India', positioning: 'Premium' },  // New Delhi · INR ~1,300 (accessories) to ~42,000; sneakers typically INR 9,999-18,999 (observed on vegnonveg.com, 2026-08-03)
  // ── Indie / design-led sneaker brands ──
  { brandName: 'Banjaaran Studio', websiteUrl: 'https://banjaaran.in', category: 'Indie Sneaker Brand', country: 'India', positioning: 'Premium' },  // Delhi · INR ~4,999-6,999; e.g. Luna Bomber Sneakers ₹6,490, Maharaja Brogues ₹5,990 (observed on banjaaran.in men's collection, 2026-08-03; many styles marked Discontinued/made-to-order)
  { brandName: 'Comet', websiteUrl: 'https://www.wearcomet.com', category: 'Indie Sneaker Brand', country: 'India', positioning: 'Mid-market' },  // Bengaluru · INR 4,299 (X Lows Cortado) to INR 6,299 (Apex Onyx) observed on wearcomet.com, 2026-08-03
  { brandName: 'Gully Labs', websiteUrl: 'https://gullylabs.com', category: 'Indie Sneaker Brand', country: 'India', positioning: 'Mid-market' },  // New Delhi · INR 1,990-9,490; most popular styles INR 4,490-5,490 (observed on gullylabs.com, 2026-08-03)
  { brandName: 'Thaely', websiteUrl: 'https://thaely.com', category: 'Indie Sneaker Brand', country: 'India', positioning: 'Accessible' },  // Mumbai · Sneakers Rs 3,500-3,750 (Tech Tabi); accessories from Rs 900; free shipping across India, $30 international (observed on thaely.com, 2026-08-03)
  // ── Official brand customization programs ──
  { brandName: 'Converse By You', websiteUrl: 'https://www.converse.com/c/custom', category: 'Official Customization Program', country: 'USA', positioning: 'Accessible' },  // US$90-$120: Custom Chuck Taylor All Star By You from $90, Lift Platform By You from $105, Lift Platform Leather $115, Chuck 70 By You from $120 (converse.com pricing surfaced via search of converse.com product pages, observed 2026-08-03; site blocks direct bot fetch)
  { brandName: 'Nike By You', websiteUrl: 'https://www.nike.com/w/nike-by-you-6ealh', category: 'Official Customization Program', country: 'USA', positioning: 'Mid-market' },  // Roughly US$50-$319 across models; typical custom shoes US$120-$250 (e.g. Nike Cortez By You $120, Ja 3 By You $145 on nike.com, per pricing guide updated May 2026; nike.com blocks direct scraping so exact live prices observed via secondary source)
  { brandName: 'Vans Customs', websiteUrl: 'https://www.vans.com/en-us/customs', category: 'Official Customization Program', country: 'USA', positioning: 'Accessible' },  // Custom pairs from around US$90, most in the US$75-$125 band (vans.com pricing surfaced via search of vans.com custom pages, observed 2026-08-03; site blocks direct bot fetch)
  // ── Custom controllers & tech personalization ──
  { brandName: 'ColorWare', websiteUrl: 'https://www.colorware.com', category: 'Custom Controllers & Tech', country: 'USA', positioning: 'Premium' },  // Winona, Minnesota · US$124 (custom DualSense PS5 controller) to US$899 (custom Xbox Series X console); custom AirPods Pro 3 US$439-$499, AirPods Max 2 US$849, Sony WH-1000XM6 US$499 (observed via colorware.com Shopify product JSON, 2026-08-03)
  { brandName: 'Xbox Design Lab', websiteUrl: 'https://xboxdesignlab.xbox.com', category: 'Custom Controllers & Tech', country: 'USA', positioning: 'Mid-market' },  // Redmond, Washington · Custom Xbox Wireless Controller from US$79.99; Elite Series 2 from US$169.99 (per Windows Central review and 2025 coverage; official configurator at xboxdesignlab.xbox.com verified live 2026-08-03 but renders prices client-side)
];

function normalizeDomain(url) {
  if (!url) return '';
  let u = String(url).trim().toLowerCase();
  u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
  return u.split('/')[0].split('?')[0].trim();
}

async function ensureBrandsTab() {
  const sheets = sheetsClient();
  const tab = brandsTab();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId(), fields: 'sheets.properties.title' });
  const exists = (meta.data.sheets || []).some((s) => s.properties && s.properties.title === tab);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] },
    });
  }
  const head = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${tab}!A1:R1` });
  if (!(head.data.values && head.data.values[0] && head.data.values[0][0])) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(), range: `${tab}!A1`, valueInputOption: 'RAW',
      requestBody: { values: [BRAND_COLUMNS] },
    });
  }
}

function brandRowToRecord(row, n) {
  const g = (i) => (row[i] == null ? '' : String(row[i]));
  return {
    id: String(n),
    brandName: g(0), websiteUrl: g(1), domain: g(2), category: g(3), country: g(4),
    positioning: g(5), newsletterSignupUrl: g(6), popupSignup: g(7), smsSignup: g(8),
    blogUrl: g(9), bestsellerUrl: g(10), newArrivalsUrl: g(11),
    subscriptionStatus: g(12) || 'Not subscribed', dateSubscribed: g(13),
    confirmationRequired: g(14), confirmationCompleted: g(15), source: g(16), addedAt: g(17),
  };
}
function brandToRow(b, nowIso) {
  return [
    b.brandName || '', b.websiteUrl || '', normalizeDomain(b.websiteUrl), b.category || '',
    b.country || '', b.positioning || '', b.newsletterSignupUrl || '',
    b.popupSignup === true ? 'Yes' : (b.popupSignup === false ? 'No' : ''),
    b.smsSignup === true ? 'Yes' : (b.smsSignup === false ? 'No' : ''),
    b.blogUrl || '', b.bestsellerUrl || '', b.newArrivalsUrl || '',
    b.subscriptionStatus || 'Not subscribed', b.dateSubscribed || '',
    b.confirmationRequired || '', b.confirmationCompleted || '',
    b.source || 'discovery', nowIso || '',
  ];
}

async function getBrands() {
  await ensureBrandsTab();
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${brandsTab()}!A2:R` });
  const rows = res.data.values || [];
  return rows
    .map((r, i) => brandRowToRecord(r, i + 2))
    .filter((b) => (b.brandName || b.domain) && !isOwnBrand(b.domain || b.websiteUrl));
}

/** Append brands, de-duplicated by domain against what's already stored. */
async function appendBrands(list, nowIso) {
  if (!list || !list.length) return { added: 0, skipped: 0, total: (await getBrands()).length };
  const existing = await getBrands();
  const seen = new Set(existing.map((b) => b.domain).filter(Boolean));
  const fresh = [];
  for (const b of list) {
    const d = normalizeDomain(b.websiteUrl);
    if (!d || seen.has(d) || isOwnBrand(d)) continue; // skip dupes + our own brand
    seen.add(d);
    fresh.push(brandToRow(b, nowIso));
  }
  if (fresh.length) {
    await sheetsClient().spreadsheets.values.append({
      spreadsheetId: sheetId(), range: `${brandsTab()}!A:R`,
      valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: fresh },
    });
  }
  return { added: fresh.length, skipped: list.length - fresh.length, total: existing.length + fresh.length };
}

/** Insert the priority seed brands (idempotent via domain dedupe). */
// SEED_BRANDS is TENANT ZERO's competitive set: India's custom-sneaker studios,
// sneaker retail, and the global customisation benchmarks. It is a fact about
// one brand's market, so seeding it into any other workspace would hand a
// publisher or a health vertical a sneaker competitor list. Seeding is
// therefore refused for any brand that is not tenant zero; that brand's own
// competitors must be added or discovered for it.
async function seedBrands(nowIso, brand) {
  const slug = String((brand && (brand.slug || brand.name)) || '').toLowerCase();
  const isTenantZero = !brand || slug === 'knickgasm';
  if (!isTenantZero) {
    return {
      ok: true, skipped: true, added: 0,
      reason: `The shipped seed list is KNICKGASM's competitive set and does not describe ${brand.name || 'this brand'}. `
            + 'Add this brand\'s own competitors, or run discovery for it - another brand\'s competitor list is never seeded.',
    };
  }
  return appendBrands(SEED_BRANDS.map((b) => ({ ...b, source: 'seed' })), nowIso);
}

/**
 * Record a brand's newsletter-subscription outcome in the Brands tab.
 * Matches by normalized domain (falls back to websiteUrl), then updates the
 * four status columns M:P — Subscription Status, Date Subscribed,
 * Confirmation Required, Confirmation Completed — on that one row. Idempotent:
 * re-running just overwrites the same cells. Written by the local auto-subscribe
 * worker via POST /api/competitor?action=mark-subscribed.
 */
async function markBrandSubscribed(opts) {
  opts = opts || {};
  const target = normalizeDomain(opts.domain || opts.websiteUrl || '');
  if (!target) return { ok: false, error: 'domain (or websiteUrl) required' };
  await ensureBrandsTab();
  const sheets = sheetsClient();
  const tab = brandsTab();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId(), range: `${tab}!A2:R` });
  const rows = res.data.values || [];
  let rowNum = -1, current = null;
  for (let i = 0; i < rows.length; i++) {
    const d = normalizeDomain((rows[i] && (rows[i][2] || rows[i][1])) || '');
    if (d && d === target) { rowNum = i + 2; current = rows[i]; break; }
  }
  if (rowNum < 0) return { ok: false, error: 'brand not found', domain: target };
  const status = opts.status || 'Subscribed';
  const dateSubscribed = opts.dateSubscribed || new Date().toISOString();
  const confReq = opts.confirmationRequired != null ? opts.confirmationRequired : ((current && current[14]) || '');
  const confDone = opts.confirmationCompleted != null ? opts.confirmationCompleted : ((current && current[15]) || '');
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId(), range: `${tab}!M${rowNum}:P${rowNum}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[status, dateSubscribed, confReq, confDone]] },
  });
  return { ok: true, domain: target, row: rowNum, status, dateSubscribed };
}

// Categories mirror the SEED_BRANDS taxonomy above so discovered brands slot
// into the same competitive set.
const DISCOVERY_CATEGORIES = ['Custom Sneakers', 'Sneaker Customisation Studio', 'Sneaker Retail & Marketplace', 'Indie Sneaker Brand', 'Official Customization Program', 'Sneaker Care & Restoration', 'Streetwear'];
const DISCOVERY_GEOS = ['India', 'United States', 'United Kingdom', 'Canada', 'Australia', 'Europe', 'Global DTC Brands'];

/**
 * Ask the LLM waterfall for a batch of real competitor brands, excluding
 * domains already in the DB. Returns parsed brand objects (not yet stored).
 */
async function discoverBrands(opts) {
  opts = opts || {};
  const categories = (opts.categories && opts.categories.length ? opts.categories : DISCOVERY_CATEGORIES);
  const geographies = (opts.geographies && opts.geographies.length ? opts.geographies : DISCOVERY_GEOS);
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 5), 50);

  const existing = await getBrands();
  const excludeDomains = [...new Set([...existing.map((b) => b.domain).filter(Boolean), ...OWN_DOMAINS])];

  const system = 'You are a competitor-intelligence research engine specializing in custom sneakers and streetwear (hand-painted one-of-one sneaker studios, official brand customisation programs, sneaker retail and resale marketplaces, indie sneaker labels, sneaker care and restoration). You only output strict JSON. Use REAL, currently-operating brands with their REAL primary website domains. Never invent brands or fake domains.';
  const user = [
    `Find up to ${limit} high-quality competitor brands similar to KNICKGASM and to: The Shoe Surgeon, Kickstradomis, Shoes Your Daddy, Moreiarty, MD Customs, Nike By You, Vans Customs. Do NOT include KNICKGASM itself (we are KNICKGASM — it is not a competitor).`,
    `Categories to cover: ${categories.join(', ')}.`,
    `Geographies: ${geographies.join(', ')}.`,
    excludeDomains.length ? `EXCLUDE these domains already in our database (do not return them): ${excludeDomains.slice(0, 200).join(', ')}.` : '',
    'Return STRICT JSON of the shape: {"brands":[{"brandName":"","websiteUrl":"https://...","category":"","country":"","positioning":"Premium|Mass|Luxury","newsletterSignupUrl":"","popupSignup":true,"smsSignup":false,"blogUrl":"","bestsellerUrl":"","newArrivalsUrl":""}]}',
    'Prefer well-known, real DTC brands. websiteUrl must be the real homepage. If unsure of a sub-URL, leave it as an empty string rather than guessing.',
  ].filter(Boolean).join('\n');

  const res = await callLLM({
    systemPrompt: system,
    userMessage: user,
    responseFormat: { type: 'json_object' },
    maxTokens: 3500,
    temperature: 0.5,
    timeoutMs: 45000,
    stage: 'competitor_discovery',
    tier: 'fast',
  });

  let parsed;
  try {
    const txt = (res.text || '').trim().replace(/^```json\s*|\s*```$/g, '');
    parsed = JSON.parse(txt);
  } catch (e) {
    throw new Error('Discovery LLM returned unparseable JSON: ' + (e.message || ''));
  }
  const brands = Array.isArray(parsed) ? parsed : (parsed.brands || []);
  return { brands, provider: res.provider, model: res.model };
}

module.exports = {
  getAllEmails, getEmailHtml, getRawHtml, runSync, ensureHeaderRow,
  sortEmailsByReceivedDesc, ingestEmail, fetchMetaAds,
  getBrands, appendBrands, seedBrands, discoverBrands, markBrandSubscribed,
  DISCOVERY_CATEGORIES, DISCOVERY_GEOS,
  NONE, NO_SCREENSHOT,
};
