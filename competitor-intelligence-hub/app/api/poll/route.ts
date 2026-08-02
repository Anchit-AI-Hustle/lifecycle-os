/**
 * GET /api/poll  — public, rate-limited sync trigger for the dashboard.
 *
 * Why this exists: the daily Vercel cron at 09:00 UTC is not enough for
 * a "near-real-time" dashboard, and the opportunistic `unstable_after`
 * kick from /api/emails has been silently inert (zero POSTs to
 * /api/sync-emails in 7 days of production logs). This route fixes that:
 *
 *   browser  →  GET /api/poll               (no secret)
 *               ├─ throttle check (30s)
 *               ├─ POST /api/sync-emails    (with CRON_SECRET, server-side)
 *               └─ return sync stats
 *
 * The CRON_SECRET never leaves the server. The call is synchronous, so
 * by the time the response returns, new mail is already in the sheet.
 * Frontend then refreshes via /api/emails to pick up the new rows.
 *
 * Rate limit: hard 30s minimum between syncs per warm instance. Dashboard
 * polls every 60s, so this just smooths out hot-reloads and concurrent
 * tabs hammering the same instance.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const POLL_THROTTLE_MS = 30_000;
let lastPoll = 0;
let lastResult: unknown = null;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const now = Date.now();
  const sinceLast = now - lastPoll;

  // Throttled: return the previous result without re-syncing.
  if (sinceLast < POLL_THROTTLE_MS) {
    return NextResponse.json(
      {
        ok: true,
        throttled: true,
        msSinceLastSync: sinceLast,
        nextSyncInMs: POLL_THROTTLE_MS - sinceLast,
        last: lastResult,
      },
      { headers: CORS }
    );
  }

  lastPoll = now;
  const origin = req.nextUrl.origin;
  const secret = process.env.CRON_SECRET;

  try {
    const res = await fetch(`${origin}/api/sync-emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
    });
    const data = await res.json().catch(() => ({ ok: false, error: "non-json response" }));
    lastResult = data;
    return NextResponse.json(
      { ok: true, throttled: false, syncStatus: res.status, ...data },
      { headers: CORS }
    );
  } catch (err) {
    console.error("[api/poll] sync trigger failed:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500, headers: CORS }
    );
  }
}
