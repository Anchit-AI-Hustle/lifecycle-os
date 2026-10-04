'use strict';

/**
 * brand-document-fetch.js - fetch a brand GUIDELINE DOCUMENT the operator
 * linked, for the browser to read.
 * ---------------------------------------------------------------------------
 * Mounted at /api/public-config?action=brand&op=document-fetch (still 12/12
 * functions). The onboarding wizard reads a brand book IN THE BROWSER
 * (brand-document.js): a PDF, a DOCX, a DESIGN.md, a token file. When the
 * operator pastes a LINK instead of choosing a file, the browser first asks the
 * host directly; most document hosts (a Google Drive share link, an S3 bucket,
 * a CMS media library) do not send CORS headers, so that read is refused and
 * the browser asks this op for the bytes instead.
 *
 * What it does, and nothing more:
 *   - normalises the share-link shapes that do not serve the file itself
 *     (Drive /file/d/<id>/view, Docs /document/d/<id>/edit, Dropbox ?dl=0,
 *     a GitHub /blob/ page) to the URL that does - each a documented public
 *     download form, nothing guessed;
 *   - runs assertPublicUrl() on EVERY hop (redirects are followed by hand,
 *     `redirect: 'manual'`), so a public host cannot bounce the fetch onto
 *     loopback, a private range or a cloud metadata address;
 *   - refuses anything over MAX_BYTES: a Vercel response is capped at 4.5 MB,
 *     so a larger brand book is the browser's to read as a FILE, and the
 *     sentence says exactly that;
 *   - returns the bytes. It parses nothing, stores nothing and calls no
 *     model. Reading the document happens in the operator's browser.
 */

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_HOPS = 5;
const DEADLINE_MS = 25000;
const UA = 'Mozilla/5.0 (compatible; LifecycleOS-BrandGuide/1.0; reads one document the operator linked)';

function fail(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/**
 * The public DOWNLOAD form of a share link, or the URL unchanged.
 * Each rewrite is the provider's own documented download URL for the same
 * object; an unrecognised shape is left alone rather than guessed at.
 */
function downloadUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (_) { return String(raw || '').trim(); }
  const host = u.hostname.toLowerCase();
  let m;
  if (host === 'drive.google.com') {
    m = /^\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname);
    const id = (m && m[1]) || (u.pathname === '/open' ? u.searchParams.get('id') : '');
    if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  if (host === 'docs.google.com') {
    m = /^\/(document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname);
    if (m) {
      const fmt = m[1] === 'document' ? 'docx' : (m[1] === 'presentation' ? 'pdf' : 'pdf');
      return `https://docs.google.com/${m[1]}/d/${m[2]}/export?format=${fmt}`;
    }
  }
  if ((host === 'www.dropbox.com' || host === 'dropbox.com') && u.searchParams.get('dl') === '0') {
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  if (host === 'github.com') {
    m = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(u.pathname);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  }
  return u.toString();
}

/** The file name a response declares, else the last path segment. */
function nameOf(res, url) {
  const cd = String((res.headers && res.headers.get && res.headers.get('content-disposition')) || '');
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd);
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  let n = '';
  try { n = star ? decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')) : (plain ? plain[1].trim() : ''); } catch (_) { n = plain ? plain[1].trim() : ''; }
  if (!n) {
    try { n = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); } catch (_) { n = ''; }
  }
  return n.replace(/[\\/\u0000-\u001f]/g, '').slice(0, 160) || 'document';
}

function tooLarge(what) {
  return fail(413, 'document_too_large', `That document is ${what}. A linked document can be at most ${MAX_BYTES / 1048576} MB, because it is passed through this server; download it and choose it with "Upload a file" instead - a file is read in your browser, with no size limit here.`);
}
/**
 * The body, STREAMED, and abandoned the moment it passes MAX_BYTES. A
 * Content-Length is a claim the server makes about itself, so it is used only
 * to refuse early; a server that omits or understates it is cut off at the cap
 * by counting what actually arrives (review finding: buffering first let one
 * response exhaust the function's memory).
 */
async function readCapped(res) {
  const declared = +((res.headers && res.headers.get && res.headers.get('content-length')) || 0);
  if (declared && declared > MAX_BYTES) throw tooLarge(`${(declared / 1048576).toFixed(1)} MB`);
  if (!res.body || typeof res.body.getReader !== 'function') {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw tooLarge(`${(buf.length / 1048576).toFixed(1)} MB`);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      try { await reader.cancel(); } catch (_) { /* already closed */ }
      throw tooLarge(`more than ${MAX_BYTES / 1048576} MB (the read was stopped there)`);
    }
    parts.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(parts, total);
}

/**
 * Fetch one public document. Resolves { bytes, content_type, url, name,
 * requested } or throws an Error carrying `status`, `code` and a sentence.
 */
async function fetchDocument(rawUrl, opts) {
  const o = opts || {};
  const core = o.core || require('./brand-workspace-core.js');
  const fetchImpl = o.fetchImpl || global.fetch;
  const requested = String(rawUrl || '').trim();
  if (!requested) throw fail(400, 'url_required', 'Paste the address of your brand guidelines first.');
  // One deadline for every hop and the whole body: a host that trickles bytes
  // cannot hold the function open.
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), o.deadlineMs || DEADLINE_MS) : null;
  try {
    return await fetchHops(requested, core, fetchImpl, ctrl);
  } catch (e) {
    if (ctrl && ctrl.signal.aborted && !(e && e.status)) throw fail(504, 'document_too_slow', `That host did not finish sending the document within ${(o.deadlineMs || DEADLINE_MS) / 1000} seconds, so nothing was read.`);
    throw e;
  } finally { if (timer) clearTimeout(timer); }
}

async function fetchHops(requested, core, fetchImpl, ctrl) {
  let url = downloadUrl(requested);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    // Every hop, not only the first: a public host must not be able to
    // redirect this server onto an internal one.
    await core.assertPublicUrl(url);
    let res;
    try {
      res = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctrl ? ctrl.signal : undefined });
    } catch (e) {
      if (ctrl && ctrl.signal.aborted) throw e;
      throw fail(502, 'document_unreachable', `Could not reach ${(() => { try { return new URL(url).host; } catch (_) { return 'that host'; } })()}: ${(e && e.message) || 'the request failed'}.`);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers && res.headers.get && res.headers.get('location');
      if (!loc) throw fail(502, 'document_redirect_without_location', 'That address redirected without saying where to, so nothing was read.');
      url = new URL(loc, url).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw fail(403, 'document_not_public', `${new URL(url).host} refused to hand the document over (${res.status}). Share it publicly ("anyone with the link"), or download it and choose it with "Upload a file".`);
    }
    if (res.status === 404) throw fail(404, 'document_not_found', `Nothing was found at that address (${new URL(url).host} answered 404).`);
    if (!res.ok) throw fail(502, 'document_fetch_failed', `${new URL(url).host} answered ${res.status}, so nothing was read.`);
    const bytes = await readCapped(res);
    const ct = String((res.headers && res.headers.get && res.headers.get('content-type')) || '').split(';')[0].trim().toLowerCase();
    // A share page that asks you to sign in comes back as HTML. Say that,
    // rather than handing the browser a login page to "read".
    if (/^text\/html/.test(ct) && !/\.(md|txt|css|json)$/i.test(new URL(url).pathname)) {
      throw fail(415, 'document_is_a_web_page', `${new URL(url).host} returned a web page, not a document: the link most likely needs a sign-in, or points at a viewer rather than the file. Share it publicly, or download it and choose it with "Upload a file".`);
    }
    return { bytes, content_type: ct || 'application/octet-stream', url, name: nameOf(res, url), requested };
  }
  throw fail(502, 'document_too_many_redirects', `That address redirected more than ${MAX_HOPS} times, so nothing was read.`);
}

module.exports = { fetchDocument, downloadUrl, MAX_BYTES };
