/**
 * Full-length email screenshot rendering via an external HTML-to-image API.
 *
 * Two providers supported, selected by SCREENSHOT_PROVIDER:
 *   - "hcti"   → htmlcsstoimage.com  (user id + api key, generous free tier)
 *   - "urlbox" → urlbox.com          (api key + secret)
 *
 * Both take raw HTML and return a hosted image URL; we then download that
 * image into a Buffer so it can be re-uploaded to Drive (single source of
 * truth = Drive, so links never expire when the render provider rotates URLs).
 *
 * Returns null on any failure — callers log "Failed" into the sheet and keep
 * going (PART 3: graceful degradation).
 */

/** Wrap an email's HTML so it renders at a sane email width with white bg. */
function wrapHtml(rawHtml: string): string {
  // If the email already has <html>, render as-is; otherwise wrap it.
  if (/<html[\s>]/i.test(rawHtml)) return rawHtml;
  return `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif;}
.__wrap{width:640px;margin:0 auto;}</style></head>
<body><div class="__wrap">${rawHtml}</div></body></html>`;
}

async function renderWithHcti(html: string): Promise<string> {
  const userId = process.env.HCTI_USER_ID;
  const apiKey = process.env.HCTI_API_KEY;
  if (!userId || !apiKey) throw new Error("Missing HCTI_USER_ID / HCTI_API_KEY");

  const auth = Buffer.from(`${userId}:${apiKey}`).toString("base64");
  const res = await fetch("https://hcti.io/v1/image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      // No viewport_width/height: HCTI captures the full natural size of the
      // content (our wrapHtml constrains it to 640px wide), so the screenshot
      // grows to the full email length. Specifying width without height 400s.
      html: wrapHtml(html),
      ms_delay: 500,
    }),
  });

  if (!res.ok) {
    throw new Error(`HCTI render failed: ${res.status} ${await safeText(res)}`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("HCTI render returned no url");
  return data.url;
}

async function renderWithUrlbox(html: string): Promise<string> {
  const key = process.env.URLBOX_API_KEY;
  const secret = process.env.URLBOX_API_SECRET;
  if (!key || !secret) throw new Error("Missing URLBOX_API_KEY / URLBOX_API_SECRET");

  // Urlbox POST render API returns the rendered binary directly, but to keep a
  // uniform "URL then download" flow we use the sync render endpoint that
  // returns a hosted result URL.
  const res = await fetch(`https://api.urlbox.com/v1/render/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      html: wrapHtml(html),
      format: "png",
      width: 640,
      full_page: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`URLBox render failed: ${res.status} ${await safeText(res)}`);
  }
  const data = (await res.json()) as { renderUrl?: string };
  if (!data.renderUrl) throw new Error("URLBox render returned no renderUrl");
  return data.renderUrl;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

export interface ScreenshotResult {
  buffer: Buffer;
  mimeType: string;
  /** The provider-hosted image URL — used as a fallback when Drive storage
   *  is unavailable (e.g. service accounts have no Drive quota). */
  hostedUrl: string;
}

/**
 * Render `html` to an image and return its bytes plus the hosted URL, or null
 * on failure. The buffer lets us store the image in Drive when possible; the
 * hostedUrl is a durable public link we fall back to otherwise.
 */
export async function renderEmailScreenshot(
  html: string
): Promise<ScreenshotResult | null> {
  if (!html || !html.trim()) return null;

  const provider = (process.env.SCREENSHOT_PROVIDER || "hcti").toLowerCase();

  try {
    const imageUrl =
      provider === "urlbox"
        ? await renderWithUrlbox(html)
        : await renderWithHcti(html);

    // Download the rendered image so we can store it permanently in Drive.
    const img = await fetch(imageUrl);
    if (!img.ok) throw new Error(`Failed to download render: ${img.status}`);

    const arrayBuf = await img.arrayBuffer();
    const mimeType = img.headers.get("content-type") || "image/png";
    return { buffer: Buffer.from(arrayBuf), mimeType, hostedUrl: imageUrl };
  } catch (err) {
    console.error("[screenshot] render failed:", err);
    return null;
  }
}
