# Competitor Landing-Page Capture — Implementation Plan

> Status: spec only. UI shell exists at `competitor-benchmarking.html#landing`,
> Supabase table exists (`public.competitor_landing_pages` via
> `supabase/migrations/20260606_kb_storage_and_landing.sql`). This doc covers
> the backend Playwright pass that fills the table.

## Why

The competitor-intelligence-hub already syncs every competitor email into a
Google Sheet with HTML + screenshot. **But the page each mailer / ad links to
is where the real funnel decisions are made** — pricing, hero copy, social
proof, trust signals, cart UX. Capturing those landing pages turns benchmarking
from "what did they send?" into "what's their whole funnel?".

## Architecture

```
sync-emails  →  extract <a href> from each mailer's HTML
             →  dedupe by url_hash = sha1(canonicalize(url))
             →  enqueue NEW urls into the landing-page worker
             →  Playwright headless visit  → screenshot + first 10 KB HTML
             →  upload screenshot to Drive (same Drive folder as email shots)
             →  upsert row into public.competitor_landing_pages
```

The dashboard's `#landing` view reads from
`competitor_landing_pages` via Supabase REST (already wired in
`competitor-benchmarking.html`).

## Where the work lives

| File | Change | Effort |
|---|---|---|
| `competitor-intelligence-hub/lib/playwright.ts` | **new** — headless browser helper (install + visit + screenshot) | 1 hr |
| `competitor-intelligence-hub/lib/landing-extractor.ts` | **new** — pull `<a href>` from email HTML, canonicalize URLs (strip utm_*, fragments), sha1 hash | 30 min |
| `competitor-intelligence-hub/lib/supabase-server.ts` | **new** — service-role client for the worker | 15 min |
| `competitor-intelligence-hub/app/api/sync-emails/route.ts` | hook the extractor + worker call after each email is appended | 30 min |
| `competitor-intelligence-hub/app/api/landing-pages/route.ts` | **new** — GET endpoint mirroring `/api/emails` so the dashboard works even if Supabase REST is firewalled | 30 min |
| `competitor-intelligence-hub/package.json` | add `playwright-core` + `@sparticuz/chromium` | — |
| `competitor-intelligence-hub/vercel.json` | bump `maxDuration` of sync-emails to 300 s (page capture is slow) | 5 min |

**Total: ~3 hr of focused work + testing.**

## Why Playwright + Chromium-for-Lambda

Vercel Functions can't ship a full Chromium binary in the 250 MB unzipped
deployment limit. The combo to use:
- `playwright-core` — the library without bundled browsers
- `@sparticuz/chromium` — slimmed-down Chromium (~50 MB) built for Lambda /
  Vercel Functions. Provides the executable path at runtime.

```ts
// lib/playwright.ts
import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";

export async function renderLandingPage(url: string) {
  const browser = await pw.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (compatible; KnickgasmCompBot/1.0)",
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 25_000 });
    await page.waitForTimeout(800);                    // settle late paints
    const title = await page.title();
    const html = (await page.content()).slice(0, 10_240);
    const screenshot = await page.screenshot({ fullPage: true, type: "png" });
    const finalUrl = page.url();
    return { title, html, screenshot, finalUrl };
  } finally {
    await browser.close();
  }
}
```

## URL extraction + canonicalization

```ts
// lib/landing-extractor.ts
import crypto from "node:crypto";

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|_hsenc$|_hsmi$|hsCtaTracking$)/i;

export function canonicalize(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    [...u.searchParams.keys()].forEach((k) => {
      if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    });
    if (u.pathname.endsWith("/") && u.pathname !== "/") {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch { return raw; }
}

export function urlHash(url: string): string {
  return crypto.createHash("sha1").update(canonicalize(url)).digest("hex");
}

export function extractLinks(html: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (/^https?:\/\//i.test(href)) out.add(canonicalize(href));
  }
  return [...out];
}
```

## Hooking into sync-emails

```ts
// inside the per-email loop in sync-emails/route.ts, AFTER appendEmailRow:
const links = extractLinks(fullHtml).slice(0, 8);  // cap per email
for (const link of links) {
  await enqueueLanding({ url: link, brand, source_email_id: String(rowNumber), source_kind: 'mailer' });
}
```

`enqueueLanding` does an upsert-by-hash into `competitor_landing_pages` with
`status='queued'`, then triggers a separate `/api/capture-landing` route per URL
(or batches via Vercel Queues if you're on Pro). Keep capture out-of-line from
the email sync so a slow page doesn't blow the sync's max duration.

## Capture route

```ts
// app/api/capture-landing/route.ts
import { renderLandingPage } from "@/lib/playwright";
import { supabaseService } from "@/lib/supabase-server";
import { uploadToDrive, getFolders, SUBFOLDERS } from "@/lib/google-client";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Auth via CRON_SECRET
  // Body: { url, brand, source_email_id, source_kind }
  // 1. SELECT existing row by url_hash; if status != 'queued', return.
  // 2. renderLandingPage(url)
  // 3. uploadToDrive(screenshot, folderId = landing-pages folder)
  // 4. UPDATE row: title, html_snippet, screenshot_url, status='captured', captured_at=now()
  // 5. On failure: status='failed', error logged
}
```

## Dashboard wiring (already done)

`competitor-benchmarking.html` already:
- has a Landing Pages tab in the sub-nav
- has `loadLandingPages()` which hits Supabase REST directly:
  `${SUPABASE_URL}/rest/v1/competitor_landing_pages?select=*&order=captured_at.desc`
- renders cards with brand, screenshot, source kind, promo codes, "Open" link
- filters by brand + source kind + free-text search

No frontend changes needed when the worker ships.

## Ethical / ToS considerations

- Send a clear, identifiable User-Agent (`KnickgasmCompBot/1.0` above).
- Respect `robots.txt` — add a check before visiting.
- Cap visits per brand per day (e.g. 5 unique pages) to avoid pattern that
  looks like scraping.
- Don't follow form submissions or trigger checkout flows.
- Don't store payment-page HTML — strip via URL pattern match.
- Optional: add `disallow_brands` list of brands that have asked you to stop.

## Sequencing

1. Ship the Supabase migration (done — `20260606_kb_storage_and_landing.sql`)
2. Ship the dashboard UI (done — Landing Pages tab on competitor-benchmarking.html)
3. Add Playwright + @sparticuz/chromium deps to the hub
4. Write `lib/playwright.ts`, `lib/landing-extractor.ts`, `lib/supabase-server.ts`
5. Add hook into `sync-emails` + new `capture-landing` route
6. Deploy hub. Manually trigger sync. Verify rows appear in
   `competitor_landing_pages`. Dashboard should auto-render them.

That's the whole plan. Estimated total: half a day of focused work to ship,
including testing on a real inbox.
