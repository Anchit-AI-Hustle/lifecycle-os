/**
 * Google API client utilities — a thin, typed wrapper around Sheets v4 and
 * Drive v3 backed by a single service account.
 *
 * Auth model: the service account is shared (as Editor) on both the target
 * Google Sheet and the root Drive folder. No OAuth user-consent flow needed.
 *
 * All functions here are server-only (they read process.env secrets and use
 * the Node googleapis client). Never import this from a Client Component.
 */
import { google, type sheets_v4, type drive_v3 } from "googleapis";
import { Readable } from "node:stream";
import {
  type CompetitorEmail,
  SHEET_COLUMNS,
  NONE,
} from "./types";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

const ROOT_FOLDER_NAME = "Competitor_Benchmarking_Hub";

/** Sub-folders created under the root folder for organizing assets. */
export const SUBFOLDERS = {
  screenshots: "Screenshots",
  inlineImages: "Inline_Images",
  attachments: "Attachments",
} as const;

// ---------------------------------------------------------------------------
//  Auth
// ---------------------------------------------------------------------------

let _auth: InstanceType<typeof google.auth.JWT> | null = null;

function getAuth() {
  if (_auth) return _auth;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !key) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
    );
  }

  // Vercel stores the key as a single line with literal "\n" escapes.
  // Normalize both that form and accidental surrounding quotes.
  key = key.replace(/\\n/g, "\n").replace(/^["']|["']$/g, "");

  _auth = new google.auth.JWT({
    email,
    key,
    scopes: SCOPES,
  });
  return _auth;
}

function sheetsClient(): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: getAuth() });
}

function driveClient(): drive_v3.Drive {
  return google.drive({ version: "v3", auth: getAuth() });
}

// ---------------------------------------------------------------------------
//  Row <-> Record mapping  (column order defined by SHEET_COLUMNS)
// ---------------------------------------------------------------------------

/** Full payload appended to a row, including the lazy-loaded raw HTML (col K). */
export type AppendInput = Omit<CompetitorEmail, "id"> & { rawHtml: string };

function recordToRow(e: AppendInput): string[] {
  return [
    e.brand,
    e.senderEmail,
    e.receivedAt,
    e.subject,
    e.preview,
    e.bodyText,
    e.promoCodes,
    e.screenshotUrl,
    e.inlineImageUrls,
    e.attachmentUrls,
    e.rawHtml, // K
  ];
}

function rowToRecord(row: string[], rowNumber: number): CompetitorEmail {
  const get = (i: number) => (row[i] ?? "").toString();
  return {
    id: String(rowNumber),
    brand: get(0) || "Unknown",
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

// ---------------------------------------------------------------------------
//  Sheets
// ---------------------------------------------------------------------------

function sheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEET_ID");
  return id;
}

function sheetTab(): string {
  return process.env.GOOGLE_SHEET_TAB || "Emails";
}

/**
 * Ensure the target tab exists, creating it if missing. This makes the app
 * work against a brand-new blank spreadsheet regardless of how the first tab
 * is named (Google defaults it to "Sheet1", but GOOGLE_SHEET_TAB is "Emails").
 * Idempotent.
 */
export async function ensureSheetTab(): Promise<void> {
  const sheets = sheetsClient();
  const tab = sheetTab();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId(),
    fields: "sheets.properties.title",
  });
  const exists = (meta.data.sheets || []).some(
    (s) => s.properties?.title === tab
  );
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId(),
      requestBody: {
        requests: [{ addSheet: { properties: { title: tab } } }],
      },
    });
  }
}

/**
 * Ensure row 1 holds our header. Idempotent — only writes when the first
 * cell is empty, so we never clobber existing data. Also guarantees the tab
 * exists first.
 */
export async function ensureHeaderRow(): Promise<void> {
  const sheets = sheetsClient();
  const tab = sheetTab();
  await ensureSheetTab();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tab}!A1:K1`,
  });
  const firstCell = res.data.values?.[0]?.[0];
  if (!firstCell) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId(),
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [[...SHEET_COLUMNS]] },
    });
  }
}

/** Append one fully-formed email record (incl. raw HTML in col K) as a new row. */
export async function appendEmailRow(e: AppendInput): Promise<void> {
  const sheets = sheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${sheetTab()}!A:K`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [recordToRow(e)] },
  });
}

/**
 * Lazily read just the raw HTML (column K) for one row. Kept out of
 * getAllEmails so the table payload stays small — the detail view fetches
 * this on demand when a row is opened.
 */
export async function getEmailHtml(rowNumber: number): Promise<string> {
  if (!Number.isInteger(rowNumber) || rowNumber < 2) return "";
  const sheets = sheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: `${sheetTab()}!K${rowNumber}`,
    });
    return (res.data.values?.[0]?.[0] ?? "").toString();
  } catch {
    return "";
  }
}

/** Read all data rows (excluding the header) for the dashboard. */
export async function getAllEmails(): Promise<CompetitorEmail[]> {
  const sheets = sheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId(),
      range: `${sheetTab()}!A2:J`,
    });
  } catch (err) {
    // Before the first sync, the tab may not exist yet — that's an empty
    // dashboard, not an error. Re-throw anything else (auth, API disabled…).
    const msg = (err as Error).message || "";
    if (/Unable to parse range/i.test(msg)) return [];
    throw err;
  }
  const rows = res.data.values ?? [];
  // rowNumber starts at 2 because row 1 is the header.
  return rows
    .map((row, i) => rowToRecord(row as string[], i + 2))
    .filter((r) => r.senderEmail || r.subject || r.brand !== "Unknown")
    .reverse(); // newest appended rows first
}

/**
 * Cheap de-dupe key set: returns existing "senderEmail|subject|receivedAt"
 * keys so the sync route can skip emails already logged (belt-and-braces in
 * addition to marking messages read).
 */
export async function getExistingKeys(): Promise<Set<string>> {
  const emails = await getAllEmails();
  return new Set(
    emails.map((e) => `${e.senderEmail}|${e.subject}|${e.receivedAt}`)
  );
}

// ---------------------------------------------------------------------------
//  Drive
// ---------------------------------------------------------------------------

/** Find a folder by name under an optional parent, or create it. Returns its ID. */
async function findOrCreateFolder(
  name: string,
  parentId?: string
): Promise<string> {
  const drive = driveClient();
  const safeName = name.replace(/'/g, "\\'");
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `name='${safeName}'`,
    parentId ? `'${parentId}' in parents` : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const list = await drive.files.list({
    q,
    fields: "files(id,name)",
    spaces: "drive",
    pageSize: 1,
  });
  const existing = list.data.files?.[0]?.id;
  if (existing) return existing;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error(`Failed to create folder: ${name}`);
  return created.data.id;
}

/** Lazily resolved folder IDs, cached per cold start. */
let _folders: { root: string; sub: Record<string, string> } | null = null;

export async function getFolders() {
  if (_folders) return _folders;

  const root =
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ||
    (await findOrCreateFolder(ROOT_FOLDER_NAME));

  const sub: Record<string, string> = {};
  for (const key of Object.values(SUBFOLDERS)) {
    sub[key] = await findOrCreateFolder(key, root);
  }
  _folders = { root, sub };
  return _folders;
}

/**
 * Upload a buffer to a Drive folder, make it readable by "anyone with the
 * link", and return its webViewLink. Throws on failure (callers decide whether
 * to swallow into a "Failed" sentinel).
 */
export async function uploadToDrive(opts: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  folderId: string;
}): Promise<string> {
  const drive = driveClient();

  const created = await drive.files.create({
    requestBody: { name: opts.filename, parents: [opts.folderId] },
    media: { mimeType: opts.mimeType, body: Readable.from(opts.buffer) },
    fields: "id, webViewLink",
  });

  const fileId = created.data.id;
  if (!fileId) throw new Error("Drive upload returned no file id");

  // Anyone-with-the-link reader permission (PART 1 §3).
  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  // webViewLink is reliable; refetch if the create response omitted it.
  if (created.data.webViewLink) return created.data.webViewLink;
  const meta = await drive.files.get({ fileId, fields: "webViewLink" });
  return meta.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
}
