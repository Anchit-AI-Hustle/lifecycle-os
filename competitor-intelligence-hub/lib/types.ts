/**
 * Canonical shape of one competitor email row.
 *
 * This is the single source of truth for the data contract that flows:
 *   IMAP  →  extraction  →  Google Sheet row  →  dashboard table  →  detail modal
 *
 * The Google Sheet column order is defined by SHEET_COLUMNS below — keep the
 * two in sync. `rowToRecord` / `recordToRow` (in google-client.ts) do the mapping.
 */
export interface CompetitorEmail {
  /** 1-based row number in the sheet (used as a stable React key + for updates). */
  id: string;
  /** Cleaned brand/company name derived from the sender display name. */
  brand: string;
  /** Raw sender address, e.g. promo@competitor.com */
  senderEmail: string;
  /** ISO-8601 timestamp the email was received. */
  receivedAt: string;
  /** Email subject line. */
  subject: string;
  /** Short preview/snippet text (first ~200 chars of the body). */
  preview: string;
  /** Full plain-text body, stripped of HTML. */
  bodyText: string;
  /** Comma-separated promo codes found in the email, or "None". */
  promoCodes: string;
  /** Google Drive view link for the full-length screenshot, "Pending", or "Failed". */
  screenshotUrl: string;
  /** Comma-separated Drive links for inline images, or "None". */
  inlineImageUrls: string;
  /** Comma-separated Drive links for file attachments, or "None". */
  attachmentUrls: string;
}

/**
 * Sheet column order. Row 1 of the sheet must contain exactly these headers.
 * The sync route auto-writes this header row if the sheet is empty.
 */
export const SHEET_COLUMNS = [
  "Brand", // A
  "Sender Email", // B
  "Received At", // C
  "Subject", // D
  "Preview", // E
  "Body Text", // F
  "Promo Codes", // G
  "Screenshot URL", // H
  "Inline Image URLs", // I
  "Attachment URLs", // J
  "Raw HTML", // K — full email HTML, lazy-loaded into the detail view
] as const;

/**
 * Max characters of raw HTML stored per row. Google Sheets caps a cell at
 * 50,000 chars; we stay just under. Emails larger than this are truncated for
 * the inline view (the full-length screenshot still captures everything).
 */
export const RAW_HTML_MAX = 49000;

/** Sentinel values used when a field is empty or a step failed (Part 3 spec). */
export const NONE = "None";
export const FAILED = "Failed";
export const PENDING = "Pending";
/** Screenshot-specific sentinel: shown when rendering/upload fails. The row is
 *  still written in full — only this one column carries the sentinel. */
export const NO_SCREENSHOT = "No Screenshot";

/** Result summary returned by the sync route. */
export interface SyncResult {
  ok: boolean;
  processed: number;
  appended: number;
  errors: string[];
  durationMs: number;
}
