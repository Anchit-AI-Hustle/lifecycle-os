/**
 * POST/GET /api/sync-emails  — the backend automation engine (PART 1).
 *
 * Triggered by Vercel Cron (see vercel.json) or manually. Sequential logic:
 *   1. Connect to Gmail IMAP, fetch UNSEEN messages, mark them \Seen.
 *   2. Extract brand, sender, timestamp, subject, preview, body text, promo codes.
 *   3. Upload inline images + attachments to Google Drive (anyone-with-link).
 *   4. Render a full-length screenshot of the HTML and store it in Drive.
 *   5. Append one row per email to the Google Sheet.
 *
 * Every per-email step is wrapped so one failure logs a sentinel ("None"/"Failed")
 * and the loop continues (PART 3: robust, non-breaking error handling).
 */
import { NextRequest, NextResponse } from "next/server";
import {
  appendEmailRow,
  ensureHeaderRow,
  getExistingKeys,
  getFolders,
  uploadToDrive,
  SUBFOLDERS,
} from "@/lib/google-client";
import {
  extractAssets,
  extractSender,
  fetchUnreadEmails,
} from "@/lib/imap";
import {
  buildPreview,
  cleanBrandName,
  extractPromoCodes,
  htmlToText,
  joinOrNone,
} from "@/lib/extract";
import { renderEmailScreenshot } from "@/lib/screenshot";
import { NO_SCREENSHOT, RAW_HTML_MAX, type SyncResult } from "@/lib/types";

// imapflow + googleapis + mailparser require the Node.js runtime (not Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reject unauthorized callers. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret configured, allow (useful for local dev) but warn.
  if (!secret) {
    console.warn("[sync] CRON_SECRET not set — route is unprotected.");
    return true;
  }
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  // Also accept ?secret= for manual browser triggering.
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

async function runSync(): Promise<SyncResult> {
  const started = Date.now();
  const errors: string[] = [];
  let appended = 0;

  // Ensure the sheet has its header and resolve Drive folders up front.
  await ensureHeaderRow();
  const [folders, existingKeys] = await Promise.all([
    getFolders(),
    getExistingKeys(),
  ]);

  const emails = await fetchUnreadEmails(25);

  for (const { parsed } of emails) {
    try {
      // --- 2. Extract core text fields ---------------------------------
      const { displayName, address } = extractSender(parsed);
      const brand = cleanBrandName(displayName, address);
      const subject = parsed.subject || "(no subject)";
      const receivedAt = (parsed.date || new Date()).toISOString();

      // The full HTML of the email — used for the screenshot AND stored (capped)
      // so the dashboard can render the message exactly as it was received.
      const fullHtml = parsed.html || parsed.textAsHtml || "";
      const bodyText =
        (parsed.text && parsed.text.trim()) || htmlToText(fullHtml);
      const preview = buildPreview(bodyText);
      const promoCodes = joinOrNone(
        extractPromoCodes(`${subject}\n${bodyText}`)
      );

      // Belt-and-braces de-dupe (in case a message wasn't marked read).
      const dedupeKey = `${address}|${subject}|${receivedAt}`;
      if (existingKeys.has(dedupeKey)) {
        continue;
      }

      // --- 3. Drive asset management -----------------------------------
      const assets = extractAssets(parsed);
      const inlineLinks: string[] = [];
      const attachmentLinks: string[] = [];

      for (const asset of assets) {
        try {
          const folderId = asset.inline
            ? folders.sub[SUBFOLDERS.inlineImages]
            : folders.sub[SUBFOLDERS.attachments];
          const link = await uploadToDrive({
            buffer: asset.buffer,
            filename: `${brand.replace(/[^\w]+/g, "_")}_${asset.filename}`,
            mimeType: asset.mimeType,
            folderId,
          });
          (asset.inline ? inlineLinks : attachmentLinks).push(link);
        } catch (err) {
          // A single bad asset shouldn't fail the email.
          console.error("[sync] asset upload failed:", err);
          errors.push(`asset upload (${brand}): ${(err as Error).message}`);
        }
      }

      // --- 4. Screenshot generation ------------------------------------
      // Default to the "No Screenshot" sentinel. Whatever happens to the
      // screenshot, the row below is still appended in full — a failed render
      // never blocks the rest of the data from being written to the sheet.
      let screenshotUrl = NO_SCREENSHOT;
      try {
        const shot = await renderEmailScreenshot(fullHtml);
        if (shot) {
          try {
            // Prefer Drive storage (durable, owned by you).
            screenshotUrl = await uploadToDrive({
              buffer: shot.buffer,
              filename: `${brand.replace(/[^\w]+/g, "_")}_${Date.now()}.png`,
              mimeType: shot.mimeType,
              folderId: folders.sub[SUBFOLDERS.screenshots],
            });
          } catch (driveErr) {
            // Drive unavailable (e.g. service accounts have no storage quota on
            // personal Google accounts) — fall back to the provider-hosted URL
            // so the screenshot is still viewable. Never block the row.
            console.warn("[sync] screenshot Drive upload failed, using hosted URL:", driveErr);
            screenshotUrl = shot.hostedUrl;
          }
        }
      } catch (err) {
        console.error("[sync] screenshot failed:", err);
        errors.push(`screenshot (${brand}): ${(err as Error).message}`);
        screenshotUrl = NO_SCREENSHOT;
      }

      // --- 5. Append to Google Sheet -----------------------------------
      await appendEmailRow({
        brand,
        senderEmail: address,
        receivedAt,
        subject,
        preview,
        bodyText,
        promoCodes,
        screenshotUrl,
        inlineImageUrls: joinOrNone(inlineLinks),
        attachmentUrls: joinOrNone(attachmentLinks),
        rawHtml: fullHtml.slice(0, RAW_HTML_MAX),
      });

      existingKeys.add(dedupeKey);
      appended++;
    } catch (err) {
      // Top-level guard: never let one email break the whole batch.
      console.error("[sync] failed to process email:", err);
      errors.push((err as Error).message || "unknown error");
    }
  }

  return {
    ok: true,
    processed: emails.length,
    appended,
    errors,
    durationMs: Date.now() - started,
  };
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSync();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // A hard failure (e.g. bad credentials) — surface it but with 500.
    console.error("[sync] fatal:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message || "sync failed" } satisfies Partial<SyncResult> & { error: string },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
