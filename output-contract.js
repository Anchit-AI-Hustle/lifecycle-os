/**
 * output-contract.js - what a model is asked to RETURN, stated once, read twice.
 * ===========================================================================
 * The operator's words (2026-10-11): "ENSURE PROMPT QUALITY FOR AI CLEARLY
 * DEFINES THE OUTPUT REQUIREMENT AND FORMAT TOO".
 *
 * Every prompt this app builds for a model - server or browser, sent or copied
 * - ends with ONE block, rendered from ONE spec, that states:
 *   (a) the deliverable: exactly what to return ("ONE JSON object ...",
 *       "ONE complete HTML email ...", "ONE reply in plain text ...");
 *   (b) the format: the container, and for JSON every key with its type and
 *       its limits (limits READ from asset-specs / asset-contracts by the
 *       caller, never re-typed here);
 *   (c) what NOT to return (fences, commentary, a plan or outline in place of
 *       the deliverable, an image where text was asked, base64, extra keys);
 *   (d) how to mark missing data: the DATA REQUIRED marker, never a guess.
 *
 * And the SAME spec is what the caller parses and validates the answer with
 * (`parse`, `validate`), so the prompt and the parser cannot disagree about
 * which keys exist: the list the model was shown is the list that is read.
 *
 * Kinds (docs/asset-and-element-prompts.md):
 *   asset    the complete artefact (an email, a page, an ad unit)
 *   element  ONE part of an asset (a photograph, a headline)
 *   data     machine-read by the caller (JSON a function parses)
 *   reply    read by a person (a chat answer, a narrative)
 *
 * UMD: the browser loads this same file (`window.OutputContract`), so a prompt
 * a page builds for an operator to paste ends with the same block.
 *
 * Deliberately NOT here: example VALUES. Seeding a shape with values is an
 * instruction to invent them (CLAUDE.md, 2026-08-14) - the schema says the
 * type, the limit and what the field is for, and nothing that reads as a fact.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.OutputContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  const OPEN = '=== OUTPUT REQUIREMENT ===';
  const CLOSE = '=== END OUTPUT REQUIREMENT ===';
  const KINDS = ['asset', 'element', 'data', 'reply'];

  const KIND_LINE = {
    asset: 'asset - the complete, usable artefact itself, not a description, plan or picture of it',
    element: 'element - ONE part of an asset, not the asset itself',
    data: 'data - machine-read by the software that sent this prompt; anything outside the format below breaks it',
    reply: 'reply - read by a person',
  };

  const FORMATS = {
    json: {
      label: 'JSON',
      rule: 'ONE JSON object. The first character is { and the last character is }. Valid JSON: double-quoted keys and strings, no trailing commas, no comments, no NaN.',
      forbid: ['markdown code fences (```)', 'any text before or after the JSON object', 'keys that are not in the schema below', 'a JSON array at the top level'],
    },
    html: {
      label: 'HTML',
      rule: 'ONE HTML document. It starts with <!doctype html> and ends with </html>.',
      forbid: ['markdown code fences (```)', 'any text before <!doctype html> or after </html>', 'an image, a screenshot or a description of the page in place of the HTML', 'base64 or data: URIs (images are hosted URLs)'],
    },
    text: {
      label: 'plain text',
      rule: 'Plain text only.',
      forbid: ['JSON', 'HTML', 'markdown headings or code fences', 'a preamble ("Here is ...") or a sign-off'],
    },
    markdown: {
      label: 'Markdown',
      rule: 'Markdown text.',
      forbid: ['a code fence around the whole answer', 'HTML', 'a preamble ("Here is ...") or a sign-off'],
    },
    sections: {
      label: 'labelled sections',
      rule: 'Plain text in the labelled sections listed below, in that order, each starting with its label on its own line.',
      forbid: ['a code fence around the whole answer', 'sections that are not listed', 'a preamble or a sign-off'],
    },
    image: {
      label: 'image',
      rule: 'ONE image (one frame).',
      forbid: ['text, words or letters baked into the image', 'a watermark, logo or border', 'a collage or grid of options', 'an email, an ad unit or a web page'],
    },
    video: {
      label: 'video',
      rule: 'ONE video clip.',
      forbid: ['burned-in captions unless asked', 'a watermark', 'an email, an ad unit or a web page'],
    },
  };

  // The spec each contract id last rendered, so a test (or a scripted model)
  // can answer a prompt with exactly the shape it asked for. Keyed by id, so
  // it holds one entry per contract, never one per request.
  const LAST = new Map();
  function lastSpec(id) { return LAST.get(id) || null; }

  // A measurement is written as a person says it (unit-words.js carries the same
  // rule and enforces it on finished copy): every prompt with words a person reads.
  const UNITS_LINE = 'Units: write every unit of measure the way a person says it, never as its symbol ("100 watts", "a 100-watt charger", "500 millilitres", "25 degrees Celsius", not "100 W", "100W", "500ml", "25°C"); a model name or product code stays exactly as written.';

  const BASE_FORBID = ['a plan, an outline or a description of the deliverable in place of the deliverable itself', 'follow-up questions'];

  /* ── the marker ──────────────────────────────────────────────────────── */

  function marker(field, brand, region) {
    const parts = [String(field || 'field')];
    if (brand) parts.push(String(brand));
    if (region) parts.push(String(region));
    return `[DATA REQUIRED BEFORE LAUNCH: ${parts.join(', ')}]`;
  }

  function missingLine(spec) {
    const m = spec.missing;
    if (m === false) return '';
    if (m === 'say') return 'Missing data: when a fact you would need is not in the input, say plainly that it is not known and what is needed. Never invent a figure, price, date, rating, review, claim, name or URL.';
    if (typeof m === 'string') return 'Missing data: ' + m;
    const brand = (m && m.brand) || spec.brand || '<brand>';
    const region = (m && (m.region !== undefined ? m.region : null)) || spec.region || '';
    const tpl = region ? marker('<field>', brand, region) : marker('<field>', brand);
    return `Missing data: where the input does not supply a fact a field needs, put ${tpl} in that field (name the field). Never invent a price, discount, code, date, rating, review, reviewer, claim, statistic, product, URL or image.`;
  }

  /* ── the schema ──────────────────────────────────────────────────────── */

  /** Normalise a field spec ('string' shorthand, or an object). */
  function field(f) {
    if (typeof f === 'string') return { type: f };
    return f || { type: 'string' };
  }

  function countText(c) {
    if (c === undefined || c === null) return '';
    if (typeof c === 'number') return `exactly ${c} item${c === 1 ? '' : 's'}`;
    if (Array.isArray(c)) {
      const [lo, hi] = c;
      if (lo != null && hi != null) return lo === hi ? `exactly ${lo} items` : `${lo}-${hi} items`;
      if (lo != null && lo > 0) return `at least ${lo} items`;
      if (hi != null) return `at most ${hi} items`;
    }
    return '';
  }

  function describe(f) {
    const s = field(f);
    const bits = [];
    if (s.type === 'array') {
      const it = s.items ? field(s.items) : { type: 'string' };
      bits.push(it.type === 'any' ? 'array' : `array of ${it.type === 'object' ? 'objects' : it.type + 's'}`);
      const ct = countText(s.count);
      if (ct) bits.push(ct);
      if (it.max) bits.push(`each <= ${it.max} characters`);
      if (it.enum) bits.push(`each one of: ${it.enum.join(' | ')}`);
    } else {
      bits.push(s.type || 'string');
      if (s.enum) bits.push(`one of: ${s.enum.join(' | ')}`);
      if (s.max != null && (s.type === 'string' || !s.type)) bits.push(`<= ${s.max} characters`);
      if (s.min != null && (s.type === 'string' || !s.type)) bits.push(`>= ${s.min} characters`);
      if (s.max != null && (s.type === 'number' || s.type === 'integer')) bits.push(`<= ${s.max}`);
      if (s.min != null && (s.type === 'number' || s.type === 'integer')) bits.push(`>= ${s.min}`);
    }
    if (s.required === false) bits.push('optional');
    return bits.join(', ');
  }

  function schemaLines(schema, depth) {
    const out = [];
    const pad = '  '.repeat(depth);
    for (const k of Object.keys(schema || {})) {
      const s = field(schema[k]);
      out.push(`${pad}- "${k}" (${describe(s)})${s.note ? ': ' + s.note : ''}`);
      const nested = s.type === 'object' ? s.of : (s.type === 'array' && s.items && field(s.items).type === 'object' ? field(s.items).of : null);
      if (nested) out.push(...schemaLines(nested, depth + 1));
    }
    return out;
  }

  /* ── the block ───────────────────────────────────────────────────────── */

  function check(spec) {
    if (!spec || typeof spec !== 'object') throw new Error('output-contract: a spec is required');
    if (!spec.id) throw new Error('output-contract: spec.id is required');
    if (!spec.returns) throw new Error(`output-contract ${spec.id}: spec.returns (the deliverable) is required`);
    if (!FORMATS[spec.format]) throw new Error(`output-contract ${spec.id}: unknown format "${spec.format}"`);
    if (spec.kind && !KINDS.includes(spec.kind)) throw new Error(`output-contract ${spec.id}: unknown kind "${spec.kind}"`);
    if (spec.format === 'json' && !spec.shape && (!spec.schema || !Object.keys(spec.schema).length)) throw new Error(`output-contract ${spec.id}: a JSON contract names its keys (schema or shape)`);
    if (spec.shape && !shapeKeys(spec.shape).length) throw new Error(`output-contract ${spec.id}: the shape names no top-level key`);
    return spec;
  }

  /**
   * The block every prompt ends with. Order is deliberate: the deliverable
   * first, the format and its schema LAST, so a long prompt closes by pinning
   * the container (the asset-prompt rule).
   */
  function block(spec) {
    check(spec);
    LAST.set(spec.id, spec);
    const fmt = FORMATS[spec.format];
    const kind = spec.kind || (spec.format === 'json' ? 'data' : 'reply');
    const forbid = [...new Set([...(spec.forbid || []), ...fmt.forbid, ...BASE_FORBID])];
    const lines = [OPEN, `Contract: ${spec.id}`, `Kind: ${KIND_LINE[kind]}`, `Return: ${spec.returns}`];
    const ml = missingLine(spec);
    if (ml) lines.push(ml);
    lines.push(`Do NOT return: ${forbid.join('; ')}.`);
    lines.push(`Format: ${fmt.label}. ${spec.formatRule || fmt.rule}`);
    if (kind !== 'element') lines.push(UNITS_LINE);
    for (const l of (spec.lines || [])) if (l) lines.push(l);
    if (spec.format === 'json' && spec.shape) {
      lines.push('Shape (exactly these keys, every one required; each value shows the TYPE, limit or allowed values to return, never an example to copy):');
      lines.push(String(spec.shape).trim());
    } else if (spec.format === 'json') {
      lines.push(`Schema (${spec.extraKeys ? 'these keys' : 'exactly these keys'}; every key is required unless marked optional; a string limit is a hard maximum, never truncate a sentence to fit, rewrite it):`);
      lines.push(...schemaLines(spec.schema, 0));
    }
    lines.push(CLOSE);
    return lines.join('\n');
  }

  /**
   * The top-level keys of an annotated shape (a JSON-like skeleton whose
   * values are type notes, so it is not itself valid JSON): every "key": at
   * depth one of the outer object.
   */
  function shapeKeys(shape) {
    const s = String(shape || '');
    const out = [];
    let depth = 0; let inStr = false; let esc = false; let buf = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') {
          inStr = false;
          if (depth === 1 && /^\s*:/.test(s.slice(i + 1))) out.push(buf);
          continue;
        }
        buf += c; continue;
      }
      if (c === '"') { inStr = true; buf = ''; continue; }
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
    }
    return [...new Set(out)];
  }

  /** `text` + the block, separated by a blank line. */
  function append(text, spec) {
    const t = String(text == null ? '' : text).replace(/\s+$/, '');
    return (t ? t + '\n\n' : '') + block(spec);
  }

  /* ── reading a block back (tests, scripted models, the browser) ──────── */

  function read(prompt) {
    const s = String(prompt || '');
    const end = s.lastIndexOf(CLOSE);
    const start = end >= 0 ? s.lastIndexOf(OPEN, end) : -1;
    if (start < 0 || end < 0) return null;
    const body = s.slice(start + OPEN.length, end);
    const line = (label) => { const m = new RegExp('^' + label + ':\\s*(.+)$', 'm').exec(body); return m ? m[1].trim() : ''; };
    const formatLabel = line('Format').split('.')[0].trim();
    const format = Object.keys(FORMATS).find((k) => FORMATS[k].label === formatLabel) || '';
    const kindText = line('Kind');
    const kind = KINDS.find((k) => kindText.startsWith(k)) || '';
    const shapeAt = body.indexOf("\nShape (");
    const keys = shapeAt >= 0 ? shapeKeys(body.slice(body.indexOf("\n", shapeAt + 1))) : [...body.matchAll(/^- "([^"]+)"/gm)].map((m) => m[1]);
    return {
      id: line('Contract'), kind, returns: line('Return'), format, keys,
      missing: line('Missing data'), forbid: line('Do NOT return'),
      trailing: s.slice(end + CLOSE.length).trim(),
      text: s.slice(start, end + CLOSE.length),
    };
  }

  /* ── parsing and validating what came back ───────────────────────────── */

  function stripFences(t) {
    return String(t == null ? '' : t).trim().replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }

  function parseJsonLoose(t) {
    const s = stripFences(t);
    try { return JSON.parse(s); } catch (_) { /* fall through */ }
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { /* fall through */ } }
    return null;
  }

  /**
   * Parse a model's answer by the spec it was briefed with.
   * json -> the object (null when there is none); html -> the document
   * (doctype to </html>, or the text when it has neither); everything else ->
   * trimmed text with a stray fence removed.
   */
  function parse(text, spec) {
    const f = spec && spec.format;
    if (f === 'json') {
      const v = parseJsonLoose(text);
      return v && typeof v === 'object' ? v : null;
    }
    if (f === 'html') {
      const s = stripFences(text);
      const a = s.search(/<!doctype html/i);
      const b = s.toLowerCase().lastIndexOf('</html>');
      if (a >= 0 && b > a) return s.slice(a, b + 7);
      return s;
    }
    return stripFences(text);
  }

  function typeOk(v, t) {
    if (t === 'array') return Array.isArray(v);
    if (t === 'object') return !!v && typeof v === 'object' && !Array.isArray(v);
    if (t === 'integer') return Number.isInteger(v);
    if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
    if (t === 'boolean') return typeof v === 'boolean';
    if (t === 'any') return v !== undefined;
    return typeof v === 'string';
  }

  function validateAgainst(v, schema, at, out) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { out.push(`${at || 'the answer'} is not an object`); return out; }
    for (const k of Object.keys(schema || {})) {
      const s = field(schema[k]);
      const p = at ? `${at}.${k}` : k;
      if (v[k] === undefined || v[k] === null) { if (s.required !== false) out.push(`${p} is missing`); continue; }
      if (!typeOk(v[k], s.type || 'string')) { out.push(`${p} is not a ${s.type || 'string'}`); continue; }
      if ((s.type || 'string') === 'string' && s.max != null && v[k].length > s.max) out.push(`${p} is ${v[k].length} characters, over ${s.max}`);
      if (s.enum && !s.enum.includes(v[k])) out.push(`${p} is "${v[k]}", not one of ${s.enum.join('|')}`);
      if (s.type === 'array') {
        const it = s.items ? field(s.items) : null;
        const n = v[k].length;
        const c = s.count;
        if (typeof c === 'number' && n !== c) out.push(`${p} has ${n} items, not ${c}`);
        if (Array.isArray(c) && ((c[0] != null && n < c[0]) || (c[1] != null && n > c[1]))) out.push(`${p} has ${n} items, outside ${c.join('-')}`);
        if (it) v[k].forEach((x, i) => {
          if (!typeOk(x, it.type || 'string')) { out.push(`${p}[${i}] is not a ${it.type || 'string'}`); return; }
          if ((it.type || 'string') === 'string' && it.max != null && x.length > it.max) out.push(`${p}[${i}] is ${x.length} characters, over ${it.max}`);
          if (it.type === 'object' && it.of) validateAgainst(x, it.of, `${p}[${i}]`, out);
        });
      }
      if (s.type === 'object' && s.of) validateAgainst(v[k], s.of, p, out);
    }
    return out;
  }

  /** Problems with a parsed answer, as sentences. Never rewrites it. */
  function validate(value, spec) {
    if (!spec) return [];
    if (spec.format === 'json' && spec.shape) { const o = {}; for (const k of shapeKeys(spec.shape)) o[k] = 'any'; return validateAgainst(value, o, '', []); }
    if (spec.format === 'json') return validateAgainst(value, spec.schema, '', []);
    const s = String(value == null ? '' : value);
    if (!s.trim()) return ['the answer is empty'];
    if (spec.format === 'html' && !/^<!doctype html/i.test(s.trim())) return ['the answer is not an HTML document starting with <!doctype html>'];
    return [];
  }

  /**
   * The schema of an object the model is asked to return REVISED in the same
   * shape: every key it has, with the type it has (two levels deep). Used where
   * the shape is the caller's input, not a fixed spec.
   */
  function schemaOf(value, depth) {
    const d = depth == null ? 2 : depth;
    const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null || v === undefined ? 'any' : typeof v === 'object' ? 'object' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string');
    const out = {};
    for (const k of Object.keys(value || {})) {
      const v = value[k];
      const t = typeOf(v);
      if (t === 'object' && d > 1) out[k] = { type: 'object', of: schemaOf(v, d - 1) };
      else if (t === 'array') {
        const first = v.find((x) => x !== null && x !== undefined);
        const it = first === undefined ? 'any' : typeOf(first);
        out[k] = { type: 'array', items: it === 'object' && d > 1 ? { type: 'object', of: schemaOf(first, d - 1) } : { type: it }, count: [0, null] };
      } else out[k] = { type: t, required: t !== 'any' };
    }
    return out;
  }

  /** A minimal answer that satisfies a spec (tests; never shown to a person). */
  function sample(spec) {
    const one = (f) => {
      const s = field(f);
      if (s.enum) return s.enum[0];
      if (s.type === 'integer' || s.type === 'number') return s.min != null ? s.min : 1;
      if (s.type === 'boolean') return true;
      if (s.type === 'any') return 'sample';
      if (s.type === 'object') return s.of ? obj(s.of) : {};
      if (s.type === 'array') {
        const c = s.count;
        const n = typeof c === 'number' ? c : (Array.isArray(c) && c[0] != null ? c[0] : 1);
        return Array.from({ length: n }, () => one(s.items || 'string'));
      }
      return String('sample ' + (s.max ? '' : 'value')).slice(0, Math.max(1, s.max || 12)).trim() || 's';
    };
    const obj = (schema) => { const o = {}; for (const k of Object.keys(schema)) o[k] = one(schema[k]); return o; };
    if (spec.format === 'json' && spec.shape) { const o = {}; for (const k of shapeKeys(spec.shape)) o[k] = 'sample'; return JSON.stringify(o); }
    if (spec.format === 'json') return JSON.stringify(obj(spec.schema));
    if (spec.format === 'html') return '<!doctype html><html><head><meta charset="utf-8"><title>sample</title></head><body><p>sample</p></body></html>';
    return 'sample';
  }

  return {
    OPEN, CLOSE, KINDS, FORMATS,
    block, append, read, parse, validate, sample, schemaOf, shapeKeys, marker, check, lastSpec,
    // A liveness probe (a key check, the provider probe): its deliverable is one word.
    PROBE: { id: 'probe.liveness', kind: 'data', format: 'text', missing: false, returns: 'the single word: ok' },
    stripFences, parseJsonLoose,
  };
});
