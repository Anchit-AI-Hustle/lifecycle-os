import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn/ui class-merge helper. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Split a "a, b, c" sheet cell into a clean array, treating "None"/"Failed" as empty. */
export function splitLinks(value: string | undefined | null): string[] {
  if (!value) return [];
  const v = value.trim();
  if (!v || v === "None" || v === "Failed" || v === "Pending") return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Format an ISO timestamp for display, gracefully handling bad input. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Pull the file id out of any common Google Drive link shape. */
export function driveFileId(url: string): string | null {
  if (!url) return null;
  // .../file/d/<id>/view  OR  ...?id=<id>  OR  .../d/<id>
  const m =
    url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    url.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Embeddable iframe/preview URL for a Drive file (works for images + PDFs). */
export function drivePreviewUrl(url: string): string | null {
  const id = driveFileId(url);
  return id ? `https://drive.google.com/file/d/${id}/preview` : null;
}

/** Direct-content URL good for <img src> thumbnails. */
export function driveImageUrl(url: string, size = 1000): string | null {
  const id = driveFileId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w${size}` : null;
}

/** Derive a short filename label from a Drive link or fallback to an index. */
export function shortLabel(url: string, i: number): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last).slice(0, 28) : `File ${i + 1}`;
  } catch {
    return `File ${i + 1}`;
  }
}
