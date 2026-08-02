/**
 * POST/GET /api/gmail-watch-refresh — daily cron to re-register the Gmail watch.
 *
 * Gmail's users.watch() registration expires every 7 days. We refresh daily
 * via Vercel Cron so we never let it lapse. Re-calling watch() is idempotent
 * (it just resets the expiration timer).
 *
 * Protected by CRON_SECRET so only Vercel Cron (or a manual `?secret=` call)
 * can trigger it.
 */
import { NextRequest, NextResponse } from "next/server";
import { registerWatch } from "@/lib/gmail-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[watch-refresh] CRON_SECRET not set — route is unprotected.");
    return true;
  }
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

async function refresh() {
  try {
    const result = await registerWatch();
    console.log(
      `[watch-refresh] re-armed, historyId=${result.historyId} expires=${result.expirationIso}`
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[watch-refresh] failed:", (err as Error).message);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  return refresh();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new NextResponse("unauthorized", { status: 401 });
  }
  return refresh();
}
