/**
 * Pure text-extraction helpers. No I/O — easy to unit test.
 * Given a parsed email (from mailparser), pull out the structured fields
 * described in PART 1 §2 of the spec.
 */
import { NONE } from "./types";

/**
 * Clean a sender display name into a tidy brand name.
 * Examples:
 *   "Nike <promo@nike.com>"            -> "Nike"
 *   "\"H&M Newsletter\""               -> "H&M Newsletter"
 *   "" (no display name)               -> "nike" (from promo@nike.com domain)
 */
export function cleanBrandName(displayName: string, fromAddress: string): string {
  let name = (displayName || "").trim();

  // Strip surrounding quotes and any trailing "<addr>" fragment.
  name = name.replace(/<[^>]*>/g, "").trim();
  name = name.replace(/^["']+|["']+$/g, "").trim();

  // Drop common newsletter suffixes/noise so the brand groups cleanly.
  name = name
    .replace(/\b(newsletter|team|email|mail|info|no[-\s]?reply|noreply|marketing|offers?|deals?|promotions?)\b/gi, "")
    .replace(/[|•·–—-]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (name) return name;

  // Fallback: derive from the email domain (e.g. promo@shop.nike.com -> "Nike").
  const domain = (fromAddress.split("@")[1] || "").toLowerCase();
  const core = domain
    .replace(/\.(com|net|org|io|co|shop|store|email|mail)(\.[a-z]{2})?$/i, "")
    .split(".")
    .filter((p) => !["www", "email", "mail", "e", "news", "send", "mkt", "go", "info"].includes(p))
    .pop();

  if (!core) return "Unknown";
  return core.charAt(0).toUpperCase() + core.slice(1);
}

/**
 * Convert an HTML email body to a clean, readable plain-text string.
 * mailparser already gives us `.text` most of the time, but marketing emails
 * are frequently HTML-only — this is the robust fallback.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  return html
    // Remove non-content blocks entirely.
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Turn structural tags into line breaks so paragraphs survive.
    .replace(/<\/(p|div|tr|table|h[1-6]|li|ul|ol|section|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Drop all remaining tags.
    .replace(/<[^>]+>/g, " ")
    // Decode the most common HTML entities.
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&[a-z]+;/gi, " ")
    // Collapse whitespace: trim each line, drop blank-line runs.
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && arr[i - 1].length > 0))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Build a short preview/snippet from the cleaned body. */
export function buildPreview(bodyText: string, max = 200): string {
  const oneLine = bodyText.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/**
 * Detect promo / discount codes.
 *
 * Strategy: look for codes that appear near discount-context words
 * (code, coupon, promo, use, save, off…) OR that match the classic
 * "ALLCAPS + digits" shape (e.g. FLASH20, SAVE15, WELCOME10). We then
 * filter out generic ALLCAPS words (SHOP, SALE, FREE…) to cut false positives.
 */
const CONTEXT_RE =
  /(?:code|coupon|promo(?:tion)?|voucher|use|enter|apply|with)\s*(?:code)?\s*[:\-]?\s*["“']?\b([A-Z0-9][A-Z0-9._-]{2,18})\b/gi;
const SHAPE_RE = /\b([A-Z]{2,}[0-9]{1,4}|[A-Z]{3,}[0-9]+[A-Z0-9]*)\b/g;

const STOPWORDS = new Set([
  "SHOP", "SALE", "FREE", "NEW", "NOW", "SAVE", "OFF", "GET", "BUY", "ONLY",
  "TODAY", "HERE", "VIEW", "OPEN", "CLICK", "SHIPPING", "GIFT", "THE", "AND",
  "FOR", "YOU", "YOUR", "ALL", "USD", "EUR", "GBP", "INR", "HTML", "HTTPS",
  "HTTP", "WWW", "COM", "PNG", "JPG", "JPEG", "GIF",
]);

export function extractPromoCodes(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();

  for (const m of Array.from(text.matchAll(CONTEXT_RE))) {
    const code = m[1]?.toUpperCase();
    if (!code || STOPWORDS.has(code)) continue;
    // Context-matched codes are trusted if they contain a digit OR are reasonably long.
    if (/[0-9]/.test(code) || code.length >= 5) found.add(code);
  }

  for (const m of Array.from(text.matchAll(SHAPE_RE))) {
    const code = m[1]?.toUpperCase();
    if (code && !STOPWORDS.has(code)) found.add(code);
  }

  return Array.from(found).slice(0, 8);
}

/** Join extracted codes for the sheet cell, or the "None" sentinel. */
export function joinOrNone(values: string[]): string {
  return values.length ? values.join(", ") : NONE;
}
