/**
 * POST /api/gmail-push — Pub/Sub Push webhook.
 *
 * Gmail calls users.watch() once, then pushes a notification to our
 * Pub/Sub topic whenever a message lands in INBOX. The topic's push
 * subscription forwards the notification here as a signed JWT.
 *
 * We:
 *   1. Verify the JWT (audience = this URL, issuer = expected SA).
 *   2. Decode the notification (purely for logging — IMAP sync is idempotent).
 *   3. Ack 200 immediately.
 *   4. Trigger /api/sync-emails in the background via unstable_after.
 *
 * The actual mail processing reuses the existing IMAP sync. The webhook is
 * just a real-time wake-up signal — no logic duplication.
 */
import { NextRequest, NextResponse } from "next/server";
import { decodePubSubMessage, verifyPubSubJwt } from "@/lib/gmail-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Ack fast — Pub/Sub retries if we take >30s. Sync runs after the response.
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  // 1. Verify the request came from Pub/Sub.
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  try {
    await verifyPubSubJwt(token);
  } catch (err) {
    console.warn(
      "[gmail-push] JWT verification failed:",
      (err as Error).message
    );
    // 200 to stop Pub/Sub from retrying on permanent auth failures —
    // we don't want a misconfigured SA to wedge the subscription.
    return NextResponse.json({ ok: false, reason: "auth" });
  }

  // 2. Decode for logging only. The IMAP sync uses \Seen to find new mail,
  //    so we don't need the historyId.
  const body = await req.json().catch(() => null);
  const decoded = decodePubSubMessage(body);
  console.log(
    `[gmail-push] notification ${decoded.emailAddress || "?"} historyId=${
      decoded.historyId || "?"
    }`
  );

  // 3. Nudge the existing sync. Next 14.2 has no `after()`, so this is a
  //    fire-and-forget call — we don't await it, keeping the Pub/Sub ack fast.
  //    Auth via the same CRON_SECRET that protects /api/sync-emails so the
  //    secret never leaves the server. If this best-effort call is cut short,
  //    /api/poll and the dashboard's polling provide redundant sync paths.
  const origin = new URL(req.url).origin;
  const secret = process.env.CRON_SECRET;
  void fetch(`${origin}/api/sync-emails`, {
    method: "POST",
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
  })
    .then((resp) => console.log("[gmail-push] sync triggered, status:", resp.status))
    .catch((err) => console.error("[gmail-push] sync trigger failed:", (err as Error).message));

  return NextResponse.json({ ok: true });
}

// Pub/Sub never sends GET, but a manual GET is useful for verifying the
// route is alive (returns 200 with a hint).
export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST-only webhook. Configure a Pub/Sub push subscription to deliver here.",
  });
}
