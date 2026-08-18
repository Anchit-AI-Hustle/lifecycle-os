'use strict';
/**
 * reference-intel.js — turn ANY reference an operator hands us into a plain-text
 * REFERENCE BRIEF that the text-only provider waterfall in _shared/llm.js can read.
 *
 * Why this exists: the ad + landing-page builders are supposed to work from
 * "an ad, a prompt, an image, a video — anything". `callLLM()` only takes a
 * string, and teaching all ten providers a multimodal message shape would be a
 * far riskier change than describing the media ONCE here and passing prose down
 * the existing cascade. So: media in, grounded prose out.
 *
 * NOT a serverless function (underscore-prefixed path is excluded from the
 * Vercel function count, which sits at the Hobby cap of 12).
 *
 * Zero fabrication (campaign-orchestration-master-spec):
 *   - We describe ONLY what is actually in the reference.
 *   - A reference we cannot read is reported as unreadable, with the reason.
 *     It NEVER degrades into an invented description, because a plausible
 *     hallucinated "the ad shows a 40% off badge" would be laundered into
 *     campaign copy as if it were observed fact.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Byte caps. Gemini's inline_data path is the binding constraint (~20MB total
// request), and an operator pasting a 200MB master file must fail fast and
// clearly rather than time the function out.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
const MAX_PAGE_BYTES = 1.5 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 12000;
const VISION_TIMEOUT_MS = 45000;

const clean = (s) => String(s == null ? '' : s).replace(/[﻿​‎]/g, '').trim();

function envKey(name) { return clean(process.env[name]); }

/** Only http(s). Blocks data:, file:, javascript: and SSRF-flavoured schemes. */
function isHttpUrl(u) {
  try { const p = new URL(String(u)); return p.protocol === 'http:' || p.protocol === 'https:'; }
  catch (_) { return false; }
}

/**
 * ⚠️ THE SCHEME CHECK ABOVE IS NOT ENOUGH ON ITS OWN.
 *
 * Every URL this module fetches is supplied by an OPERATOR - "here is a
 * competitor's ad, describe it" - and the fetch happens on the SERVER. A scheme
 * check accepts http://169.254.169.254/ (cloud metadata), http://localhost:5432
 * and anything on a private range, which makes this module a server-side
 * request forgery primitive aimed at the deployment's own network.
 *
 * The sibling this was ported from ran with the scheme check alone. This repo
 * already solved the same problem for the catalogue importer and for the
 * Ollama base URL, so the fix is to use that guard rather than write a second
 * one: it blocks private ranges AND re-resolves the hostname, so a name that
 * answers publicly once and privately on the retry is refused too.
 *
 * Returns a reason string on refusal so the caller reports it like any other
 * unreadable reference, rather than throwing into the middle of a brief.
 */
async function assertFetchable(url) {
  if (!isHttpUrl(url)) return 'not an http(s) URL';
  try {
    await require('./brand-workspace-core.js').assertPublicUrl(String(url));
    return null;
  } catch (e) {
    return String((e && e.message) || 'that address cannot be fetched');
  }
}

function isYouTube(u) {
  try {
    const h = new URL(String(u)).hostname.replace(/^www\./, '');
    return h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtu.be';
  } catch (_) { return false; }
}

/** Parse a `data:<mime>;base64,<payload>` URI into { mime, base64, bytes }. */
function parseDataUri(s) {
  const m = /^data:([^;,]+)(;[^,]*)?,(.*)$/is.exec(String(s || ''));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const isB64 = /;base64/i.test(m[2] || '');
  const base64 = isB64 ? m[3].replace(/\s/g, '') : Buffer.from(decodeURIComponent(m[3]), 'utf8').toString('base64');
  return { mime, base64, bytes: Math.floor(base64.length * 3 / 4) };
}

/**
 * Bounded byte fetch. Streams so an over-cap body is abandoned mid-flight
 * instead of being buffered in full first.
 */
async function fetchBytes(url, cap) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'LifecycleOS-ReferenceReader/1.0 (+reference brief extraction)', Accept: '*/*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!r || !r.ok) return { ok: false, reason: `fetch returned ${r ? r.status : 'no response'}` };

    const declared = Number(r.headers.get('content-length') || 0);
    if (declared && declared > cap) {
      return { ok: false, reason: `file is ${(declared / 1048576).toFixed(1)}MB, over the ${(cap / 1048576).toFixed(0)}MB limit` };
    }
    const mime = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

    const chunks = [];
    let total = 0;
    // Node 18+ gives a web ReadableStream here; fall back to arrayBuffer if not.
    if (r.body && typeof r.body.getReader === 'function') {
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > cap) {
          try { await reader.cancel(); } catch (_) {}
          return { ok: false, reason: `file exceeds the ${(cap / 1048576).toFixed(0)}MB limit` };
        }
        chunks.push(Buffer.from(value));
      }
    } else {
      const ab = Buffer.from(await r.arrayBuffer());
      if (ab.length > cap) return { ok: false, reason: `file exceeds the ${(cap / 1048576).toFixed(0)}MB limit` };
      chunks.push(ab);
      total = ab.length;
    }
    return { ok: true, mime, bytes: total, base64: Buffer.concat(chunks).toString('base64') };
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'timed out' : (e && e.message) || String(e);
    return { ok: false, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ── Page references ────────────────────────────────────────────────────────
// A competitor ad or landing page pasted as a URL. We keep the structural
// signal (title, meta, headings, CTA labels) rather than only a flat text dump,
// because "mirror the structure" needs the structure.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// ONE pass over the string, so each entity is decoded exactly once. Chained
// per-entity replaces would double-unescape: "&amp;lt;" becomes "&lt;" on the
// &amp; pass and then "<" on the &lt; pass, inventing markup the page never
// contained. An unknown entity is left as written rather than guessed at.
function decodeEntities(s) {
  return String(s || '').replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g,
    (match, dec, hex, name) => {
      try {
        if (dec) return String.fromCodePoint(Number(dec));
        if (hex) return String.fromCodePoint(parseInt(hex, 16));
      } catch (_) { return ' '; }
      const key = String(name || '').toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : match;
    },
  );
}

function metaContent(html, re) {
  const m = re.exec(html);
  return m ? decodeEntities(m[1]).trim() : '';
}

function collectAll(html, re, cap) {
  const out = [];
  let m;
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = rx.exec(html)) && out.length < cap) {
    const t = decodeEntities(String(m[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (t && t.length < 220 && !out.includes(t)) out.push(t);
  }
  return out;
}

async function fetchPageBrief(url) {
  const refused = await assertFetchable(url);
  if (refused) return { ok: false, kind: 'page', url, reason: refused };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'LifecycleOS-ReferenceReader/1.0 (+reference brief extraction)', Accept: 'text/html,*/*' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!r || !r.ok) return { ok: false, kind: 'page', url, reason: `fetch returned ${r ? r.status : 'no response'}` };
    const raw = (await r.text()).slice(0, MAX_PAGE_BYTES);

    const title = metaContent(raw, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = metaContent(raw, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
      || metaContent(raw, /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
    const ogImage = metaContent(raw, /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']*)["']/i);
    const headings = collectAll(raw, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, 18);
    const ctas = collectAll(raw, /<(?:button|a)[^>]*class=["'][^"']*(?:btn|button|cta)[^"']*["'][^>]*>([\s\S]*?)<\/(?:button|a)>/gi, 12);

    // An end tag is `</name` followed EITHER by `>` directly, or by whitespace
    // and then any junk up to the `>` -- so `</script>`, `</script >` and
    // `</script\t\n bar>` are all the same end tag to a browser, while
    // `</scriptfoo>` is not one at all. Matching only `</script>` meant a page
    // written either of the looser ways dropped its whole script body into the
    // brief as if it were page copy.
    const endTag = (name) => new RegExp(`<${name}\\b[\\s\\S]*?<\\/${name}(?:\\s[^>]*)?>`, 'gi');
    const text = raw
      .replace(endTag('script'), ' ')
      .replace(endTag('style'), ' ')
      .replace(endTag('head'), ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);

    return { ok: true, kind: 'page', url, title, description, ogImage, headings, ctas, text };
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'timed out' : (e && e.message) || String(e);
    return { ok: false, kind: 'page', url, reason: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ── Media references (image / video) ───────────────────────────────────────

const VISION_INSTRUCTION = `You are a paid-media creative analyst. Describe the attached reference EXACTLY as it is, so a copywriter who cannot see it can build a same-shaped creative for a different brand.

Report ONLY what is genuinely observable. If something is unclear, say "not legible" or "not visible". Never guess a brand, price, discount, rating, review count or claim that you cannot actually read in the asset — an invented figure would be copied into a live campaign as fact.

Return plain text under these headings:
FORMAT: still image or video; aspect ratio; where it would run (feed, story/reel, search, display) if evident.
SUBJECT: what is physically shown — product, people, setting, packaging.
COMPOSITION: layout, focal point, negative space, where text sits, crop.
COLOUR & TREATMENT: palette, lighting, grade, texture.
ON-ASSET TEXT: every word baked into the asset, transcribed VERBATIM, in reading order. Write "none" if there is no text.
OFFER & CLAIMS: any price, discount, guarantee, rating or claim, transcribed verbatim. Write "none stated" if absent.
CTA: the call-to-action wording, verbatim.
MOTION (video only): shot-by-shot beats with rough timings, pacing, transitions, on-screen text timing, and any spoken words you can hear, transcribed verbatim.
WHY IT WORKS: the persuasion mechanic — the hook in the first beat, the promise, the proof, the ask.`;

async function visionGemini(item) {
  const key = envKey('GEMINI_API_KEY');
  if (!key) return null;
  const models = [clean(process.env.GEMINI_VISION_MODEL) || 'gemini-2.5-flash', 'gemini-2.0-flash'];

  const part = item.youtube
    ? { file_data: { file_uri: item.url } }
    : { inline_data: { mime_type: item.mime, data: item.base64 } };

  for (const model of models) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
    try {
      const r = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: VISION_INSTRUCTION }, part] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1400 },
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) continue;
      const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
      const text = (parts || []).map((p) => p && p.text).filter(Boolean).join('\n').trim();
      if (text) return { text, provider: 'gemini', model };
    } catch (_) { /* try next model */ } finally { clearTimeout(timer); }
  }
  return null;
}

async function visionOpenAI(item) {
  const key = envKey('OPENAI_API_KEY') || envKey('OPENAI_API_KEY_2') || envKey('OPENAI_API_KEY_3');
  if (!key || item.kind !== 'image') return null;   // OpenAI chat vision takes images, not raw video
  const model = clean(process.env.OPENAI_VISION_MODEL) || 'gpt-4o-mini';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1400,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: VISION_INSTRUCTION },
            { type: 'image_url', image_url: { url: `data:${item.mime};base64,${item.base64}` } },
          ],
        }],
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return null;
    const text = clean(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
    return text ? { text, provider: 'openai', model } : null;
  } catch (_) { return null; } finally { clearTimeout(timer); }
}

async function visionAnthropic(item) {
  const key = envKey('ANTHROPIC_API_KEY');
  if (!key || item.kind !== 'image') return null;   // Anthropic messages take images, not video
  const model = clean(process.env.ANTHROPIC_VISION_MODEL) || 'claude-3-5-sonnet-latest';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VISION_TIMEOUT_MS);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: item.mime, data: item.base64 } },
            { type: 'text', text: VISION_INSTRUCTION },
          ],
        }],
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return null;
    const text = clean((j && j.content || []).map((c) => c && c.text).filter(Boolean).join('\n'));
    return text ? { text, provider: 'anthropic', model } : null;
  } catch (_) { return null; } finally { clearTimeout(timer); }
}

/**
 * Describe one image or video reference.
 * Accepts { kind, url } or { kind, data_uri } (uploads arrive as data URIs).
 * Gemini leads because it is the only rung that reads video; OpenAI and
 * Anthropic back it up for stills.
 */
async function describeMedia(input) {
  const raw = input || {};
  const kind = String(raw.kind || '').toLowerCase() === 'video' ? 'video' : 'image';
  const label = String(raw.label || '').slice(0, 120);
  const cap = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

  const item = { kind, label, mime: '', base64: '', url: '', youtube: false };

  if (raw.data_uri) {
    const parsed = parseDataUri(raw.data_uri);
    if (!parsed) return { ok: false, kind, label, reason: 'the upload was not a readable data URI' };
    if (parsed.bytes > cap) {
      return { ok: false, kind, label, reason: `the upload is ${(parsed.bytes / 1048576).toFixed(1)}MB, over the ${(cap / 1048576).toFixed(0)}MB limit` };
    }
    item.mime = parsed.mime;
    item.base64 = parsed.base64;
  } else if (raw.url) {
    const refusedMedia = await assertFetchable(raw.url);
    if (refusedMedia) return { ok: false, kind, label, reason: refusedMedia };
    item.url = String(raw.url);
    if (kind === 'video' && isYouTube(item.url)) {
      // Gemini reads a YouTube URL directly — no download, no size cap.
      item.youtube = true;
    } else {
      const got = await fetchBytes(item.url, cap);
      if (!got.ok) return { ok: false, kind, label, url: item.url, reason: got.reason };
      item.mime = got.mime || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
      item.base64 = got.base64;
    }
  } else {
    return { ok: false, kind, label, reason: 'no url and no upload supplied' };
  }

  // A URL that answered with an HTML error page is not a creative. Catch it
  // here rather than shipping a page of markup to a vision model.
  if (!item.youtube && /^text\/html/i.test(item.mime)) {
    return { ok: false, kind, label, url: item.url, reason: 'that URL returned a web page, not an image or video file' };
  }
  if (!item.youtube && item.mime && !new RegExp(`^${kind}/`).test(item.mime)) {
    return { ok: false, kind, label, url: item.url, reason: `that URL returned ${item.mime}, not ${kind} content` };
  }

  const rungs = [visionGemini, visionOpenAI, visionAnthropic];
  for (const rung of rungs) {
    let out = null;
    try { out = await rung(item); } catch (_) { out = null; }
    if (out && out.text) {
      return { ok: true, kind, label, url: item.url || '', provider: out.provider, model: out.model, description: out.text };
    }
  }

  const why = kind === 'video'
    ? 'no vision provider could read it — video analysis needs GEMINI_API_KEY'
    : 'no vision provider could read it — set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY';
  return { ok: false, kind, label, url: item.url || '', reason: why };
}

// ── Public entry point ─────────────────────────────────────────────────────

function renderPageSection(p) {
  if (!p.ok) return `REFERENCE PAGE (${p.url}) — COULD NOT BE READ: ${p.reason}. Do not describe or imitate it; work from the prompt alone.`;
  const bits = [`REFERENCE PAGE: ${p.url}`];
  if (p.title) bits.push(`Title: ${p.title}`);
  if (p.description) bits.push(`Meta description: ${p.description}`);
  if (p.headings.length) bits.push(`Headings in order: ${p.headings.join(' | ')}`);
  if (p.ctas.length) bits.push(`Buttons / CTAs: ${p.ctas.join(' | ')}`);
  if (p.text) bits.push(`Body copy:\n"""\n${p.text}\n"""`);
  bits.push('Mirror its STRUCTURE, voice, length and conversion logic. Do NOT copy its wording, its brand, or any of its factual claims.');
  return bits.join('\n');
}

function renderMediaSection(m, index) {
  const what = m.kind === 'video' ? 'VIDEO' : 'IMAGE';
  const tag = m.label ? ` "${m.label}"` : '';
  if (!m.ok) {
    return `REFERENCE ${what} ${index + 1}${tag} — COULD NOT BE READ: ${m.reason}. Do not describe or imitate it, and do not invent what it might have shown.`;
  }
  return `REFERENCE ${what} ${index + 1}${tag}${m.url ? ` (${m.url})` : ' (uploaded)'} — analysed by ${m.provider}:\n"""\n${m.description}\n"""`;
}

/**
 * buildReferenceBrief({ reference_url, media })
 *   media: [{ kind:'image'|'video', url? , data_uri?, label? }]  (max 4)
 *
 * Returns { text, sources, warnings, any } — `text` drops straight into a user
 * message; `warnings` lists every reference we could not read so the caller can
 * surface it in the UI instead of pretending the reference was used.
 */
async function buildReferenceBrief(opts) {
  const o = opts || {};
  const referenceUrl = clean(o.reference_url);
  const media = Array.isArray(o.media) ? o.media.slice(0, 4) : [];

  const jobs = [];
  if (referenceUrl) jobs.push(fetchPageBrief(referenceUrl).then((p) => ({ type: 'page', p })));
  media.forEach((m, i) => jobs.push(describeMedia(m).then((d) => ({ type: 'media', d, i }))));
  if (!jobs.length) return { text: '', sources: [], warnings: [], any: false };

  const settled = await Promise.all(jobs.map((j) => j.catch((e) => ({ type: 'error', error: (e && e.message) || String(e) }))));

  const sections = [];
  const sources = [];
  const warnings = [];

  for (const s of settled) {
    if (s.type === 'page') {
      sections.push(renderPageSection(s.p));
      if (s.p.ok) sources.push({ kind: 'page', url: s.p.url, title: s.p.title || '' });
      else warnings.push(`Reference page could not be read (${s.p.reason}).`);
    } else if (s.type === 'media') {
      sections.push(renderMediaSection(s.d, s.i));
      if (s.d.ok) sources.push({ kind: s.d.kind, url: s.d.url, provider: s.d.provider });
      else warnings.push(`Reference ${s.d.kind}${s.d.label ? ` "${s.d.label}"` : ''} could not be read (${s.d.reason}).`);
    } else if (s.type === 'error') {
      warnings.push(`A reference failed to process (${s.error}).`);
    }
  }

  return {
    text: sections.length ? sections.join('\n\n') : '',
    sources,
    warnings,
    any: sources.length > 0,
  };
}

module.exports = {
  buildReferenceBrief,
  describeMedia,
  fetchPageBrief,
  isHttpUrl,
  parseDataUri,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
};
