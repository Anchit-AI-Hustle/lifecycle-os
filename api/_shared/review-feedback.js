'use strict';
/**
 * review-feedback.js - one-tap star rating from a mail, the brand's own
 * feedback page, and its thank-you page (2026-10-24).
 * ---------------------------------------------------------------------------
 * The operator shared VAHDAM's "star rating widget with redirection logic"
 * mailer and its private-feedback / thank-you pages. The experience is built
 * here for any brand: five stars in the mail, each a link that opens this
 * brand's page with that rating already set; a line or two, what fell short,
 * whether they would order again and how to follow up; a thank-you that says
 * what happens next.
 *
 * WHAT IS NOT BUILT, ON PURPOSE: sending 4-5 star raters to a public review
 * site and keeping 1-3 star raters private. That is review gating, which the
 * FTC's Consumer Reviews and Testimonials rule (16 CFR 465, review
 * suppression) prohibits, as do Trustpilot's and Google's own review
 * guidelines. So the public review link, when the brand's record names one
 * (brand_data.review_url) or the product has its own page, is OFFERED TO EVERY
 * RATER, at every star level, on both pages.
 *
 * Mounted on public-config.js (?action=review-page|review-feedback; /review),
 * still 12/12 functions. Feedback is written by the service role only, into
 * brand_review_feedback (members read it through RLS), never with an email
 * address or phone number: the follow-up is matched by the order id the mail
 * carried. Pages are the brand's tokens; no script is needed to send.
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');

const ISSUES = ['Taste or flavour', 'Quality', 'Freshness', 'Delivery or shipping', 'Packaging', 'Price', 'Something else'];
const AGAIN = ['Yes', 'Maybe', 'No'];
const FOLLOW = { email: 'Email me', phone: 'Call me', none: "Don't follow up, just listen" };

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, n);
function ratingOf(v) { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 0; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The public review link offered to every rater, or ''. */
function publicReviewUrl(brand, productUrl) {
  const bd = (brand && brand.brand_data) || {};
  const u = String(brand && brand.review_url || bd.review_url || '').trim();
  if (/^https:\/\//i.test(u)) return u;
  if (/^https:\/\//i.test(String(productUrl || ''))) return String(productUrl).replace(/#.*$/, '') + '#reviews';
  return '';
}

/** The page address for one star of the mail ('' when this deployment has no public address or the brand no workspace). */
function starLink(base, workspaceId, rating, { product = '', order = '{{ order_id }}', name = '{{ first_name }}' } = {}) {
  if (!base || !UUID.test(String(workspaceId || ''))) return '';
  const q = `b=${encodeURIComponent(workspaceId)}&rating=${rating}${product ? `&product=${encodeURIComponent(product)}` : ''}&order=${order}&name=${name}`;
  return `${String(base).replace(/\/$/, '')}/review?${q}`;
}

/** The row of five stars for a mail: each a link (table layout, Outlook-safe). */
function starRowHtml(links, { color = '#333333', font = 'Arial,sans-serif' } = {}) {
  const cells = [1, 2, 3, 4, 5].map((n) => `<td align="center" style="padding:0 4px;"><a href="${esc(links[n - 1])}" target="_blank" title="${n} star${n > 1 ? 's' : ''}" style="display:block;text-decoration:none;font-family:${font};font-size:36px;line-height:44px;color:${color};">&#9733;</a><div style="font-family:${font};font-size:12px;color:${color};">${n}</div></td>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" align="center" data-star-row><tr>${cells}</tr></table>`;
}

function pageShell(brand, title, inner) {
  const rt = require('./brand-runtime.js');
  const core = (() => { try { return require('./brand-workspace-core.js'); } catch (_) { return null; } })();
  const pal = rt.paletteOf(brand || {});
  const fs = rt.fontStacks(brand || {});
  const P = core ? core.sectionGround(pal.primary, pal.accent, pal.surface) : pal.primary;
  const ON = core ? core.textOn(P, pal.surface, pal.ink) : pal.surface;
  const PT = core ? core.readableAsText(P, pal.surface, 4.5) : pal.ink;
  const name = (brand && brand.name) || '';
  const logo = /^https:\/\//i.test(String(brand && brand.logo_url || '')) ? brand.logo_url : '';
  const home = /^https?:\/\//i.test(String(brand && brand.website || '')) ? brand.website : '';
  let fontsHref = '';
  try { fontsHref = core && core.fontsHref ? core.fontsHref(brand) : ''; } catch (_) { fontsHref = ''; }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}${name ? ' - ' + esc(name) : ''}</title>${fontsHref ? `<link rel="stylesheet" href="${esc(fontsHref)}">` : ''}
<style>
:root{--p:${P};--on:${ON};--pt:${PT};--ink:${pal.ink};--s:${pal.surface};--s2:${pal.surface_alt || pal.surface};--line:${pal.line || '#e3e6ea'};--muted:${core ? core.readableAsText(pal.muted || pal.ink, pal.surface, 4.5) : pal.ink};--head:${String(fs.head).replace(/"/g, "'")};--body:${String(fs.body).replace(/"/g, "'")}}
*{box-sizing:border-box}body{margin:0;background:var(--s2);color:var(--ink);font-family:var(--body);line-height:1.55}
header{background:var(--s);text-align:center;padding:16px;border-bottom:1px solid var(--line)}header img{height:30px;width:auto}header b{font-family:var(--head);font-size:20px;color:var(--pt);letter-spacing:.06em}
main{max-width:560px;margin:28px auto;padding:0 16px}.card{background:var(--s);border:1px solid var(--line);border-radius:16px;padding:24px}
h1{font-family:var(--head);font-size:28px;line-height:1.2;margin:0 0 8px;color:var(--ink)}p.lead{margin:0 0 18px;color:var(--muted)}
.stars{display:flex;gap:6px;justify-content:center;margin:6px 0 4px}.stars label{cursor:pointer;font-size:40px;line-height:1;color:var(--line)}
.stars input{position:absolute;opacity:0;width:1px;height:1px}.stars label.on{color:var(--pt)}
.read{text-align:center;font-weight:700;color:var(--pt);margin:0 0 16px}
label.f{display:block;font-weight:700;font-size:14px;margin:16px 0 6px}textarea,select{width:100%;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--s);color:var(--ink)}
textarea{min-height:110px}.opts{display:flex;flex-wrap:wrap;gap:8px}.opts label{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;min-height:44px;border:1px solid var(--line);border-radius:999px;font-size:14px;cursor:pointer}
button,.btn{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:48px;margin-top:20px;border:0;border-radius:999px;background:var(--p);color:var(--on);font:700 16px var(--body);text-decoration:none;cursor:pointer}
.pub{margin-top:18px;text-align:center;font-size:14px;color:var(--muted)}.pub a{color:var(--pt);font-weight:700}
.small{font-size:13px;color:var(--muted);text-align:center;margin-top:14px}
footer{text-align:center;font-size:12px;color:var(--muted);padding:20px}footer a{color:var(--muted)}
</style></head><body>
<header>${home ? `<a href="${esc(home)}">` : ''}${logo ? `<img src="${esc(logo)}" alt="${esc(name)}">` : `<b>${esc(name)}</b>`}${home ? '</a>' : ''}</header>
<main>${inner}</main>
<footer>${esc(name)}${home ? ` · <a href="${esc(home)}">${esc(home.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''))}</a>` : ''}</footer>
</body></html>`;
}

/** The feedback page, the rating from the mail already set (and changeable). */
function feedbackPage(brand, { workspaceId, rating = 0, product = '', order = '', name = '', publicUrl = '', error = '' } = {}) {
  const r = ratingOf(rating);
  const first = clip(name, 40).replace(/^\{\{.*\}\}$/, '');
  const ord = clip(order, 60).replace(/^\{\{.*\}\}$/, '');
  const prod = clip(product, 160);
  const stars = [1, 2, 3, 4, 5].map((n) => `<input type="radio" name="rating" id="r${n}" value="${n}"${n === r ? ' checked' : ''} required><label for="r${n}" class="${n <= r ? 'on' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}">&#9733;</label>`).join('');
  const inner = `<div class="card">
  <h1>${first ? `Thanks, ${esc(first)}.` : 'Thanks for telling us.'} Now the rest.</h1>
  <p class="lead">Confirm your rating and add a line or two, so we can do something useful with it.${ord ? ` Order #${esc(ord)}.` : ''}</p>
  ${error ? `<p class="lead" role="alert">${esc(error)}</p>` : ''}
  <form method="post" action="/api/public-config?action=review-feedback">
    <input type="hidden" name="b" value="${esc(workspaceId)}"><input type="hidden" name="product" value="${esc(prod)}"><input type="hidden" name="order" value="${esc(ord)}"><input type="hidden" name="name" value="${esc(first)}">
    <div class="stars" role="radiogroup" aria-label="Your rating">${stars}</div>
    <p class="read" data-read>${r ? `${r} of 5` : 'Tap a star'}</p>
    <label class="f" for="comment">A line or two for us</label>
    <textarea id="comment" name="comment" maxlength="2000"></textarea>
    <label class="f" for="issue">What fell short? (optional)</label>
    <select id="issue" name="issue"><option value="">Choose one</option>${ISSUES.map((x) => `<option>${esc(x)}</option>`).join('')}</select>
    <label class="f">Would you order from us again?</label>
    <div class="opts">${AGAIN.map((x) => `<label><input type="radio" name="again" value="${esc(x)}"> ${esc(x)}</label>`).join('')}</div>
    <label class="f">Best way to follow up?</label>
    <div class="opts">${Object.entries(FOLLOW).map(([k, v]) => `<label><input type="radio" name="followup" value="${k}"${k === 'none' ? ' checked' : ''}> ${esc(v)}</label>`).join('')}</div>
    <button type="submit">Send feedback</button>
  </form>
  ${publicUrl ? `<p class="pub">Would you also like to post a public review? <a href="${esc(publicUrl)}" target="_blank" rel="noopener">Write one here</a>. It is open to everyone, whatever you rated.</p>` : ''}
  <p class="small">A real person reads every submission.</p>
</div>
<script>
(function(){var ls=[].slice.call(document.querySelectorAll('.stars label')),rd=document.querySelector('[data-read]');
function paint(n){ls.forEach(function(l,i){l.classList.toggle('on',i<n);});}
document.querySelectorAll('.stars input').forEach(function(i){i.addEventListener('change',function(){paint(+i.value);rd.textContent=i.value+' of 5';});});})();
</script>`;
  return pageShell(brand, 'Tell us how it went', inner);
}

function thanksPage(brand, { rating = 0, name = '', followup = '', publicUrl = '' } = {}) {
  const r = ratingOf(rating);
  const first = clip(name, 40);
  const when = followup === 'phone' ? 'We will call you within one to two working days.' : followup === 'email' ? 'You will hear from us by email within one to two working days.' : '';
  const inner = `<div class="card" style="text-align:center">
  <h1>${first ? `Got it, ${esc(first)}. Thank you.` : 'Got it. Thank you.'}</h1>
  ${r ? `<p class="read" aria-label="You rated ${r} of 5">${'&#9733;'.repeat(r)}${'&#9734;'.repeat(5 - r)} &nbsp;${r} of 5</p>` : ''}
  <p class="lead">${when || 'A real person on our team reads every one.'}</p>
  ${publicUrl ? `<p class="pub">Want others to hear it too? <a href="${esc(publicUrl)}" target="_blank" rel="noopener">Post a public review</a>.</p>` : ''}
  ${brand && /^https?:\/\//i.test(String(brand.website || '')) ? `<a class="btn" href="${esc(brand.website)}">Back to ${esc(brand.name || 'the store')}</a>` : ''}
</div>`;
  return pageShell(brand, 'Thank you', inner);
}

// A small per-instance limit on submissions (the public endpoint has no session).
const HITS = new Map();
function limited(ip) {
  const now = Date.now(); const k = String(ip || 'x');
  const arr = (HITS.get(k) || []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now); HITS.set(k, arr);
  if (HITS.size > 5000) HITS.clear();
  return arr.length > 8;
}

function env() {
  return { url: (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, ''), key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '' };
}

async function brandFor(workspaceId) {
  if (!UUID.test(String(workspaceId || ''))) return null;
  const e = env(); if (!e.url || !e.key) return null;
  try { return await require('./workspace-scope.js').brandForWorkspace(e, workspaceId); } catch (_) { return null; }
}

function productPage(brand, product) {
  if (!product) return '';
  if (/^https:\/\//i.test(product)) return product;
  return '';
}

async function handle(req, res) {
  const q = req.query || {};
  const action = q.action;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (action === 'review-page') {
    const brand = await brandFor(q.b);
    if (!brand) { res.statusCode = 404; res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(pageShell({}, 'Not found', '<div class="card"><h1>This page is not available.</h1><p class="lead">The link may be incomplete. Please use the link in your email again.</p></div>')); }
    const pub = publicReviewUrl(brand, productPage(brand, q.product));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (q.thanks) return res.end(thanksPage(brand, { rating: q.rating, name: q.name, followup: q.followup, publicUrl: pub }));
    return res.end(feedbackPage(brand, { workspaceId: q.b, rating: q.rating, product: q.product, order: q.order, name: q.name, publicUrl: pub }));
  }
  if (action === 'review-feedback') {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'post_only', message: 'Feedback is sent from the form.' });
    const b = typeof req.body === 'object' && req.body ? req.body : (() => { try { return Object.fromEntries(new URLSearchParams(String(req.body || ''))); } catch (_) { return {}; } })();
    const ws = String(b.b || '');
    const brand = await brandFor(ws);
    if (!brand) return res.status(404).json({ ok: false, error: 'brand_not_found', message: 'This feedback link is not available.' });
    const rating = ratingOf(b.rating);
    const pub = publicReviewUrl(brand, productPage(brand, b.product));
    const back = (error) => { res.statusCode = 400; res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(feedbackPage(brand, { workspaceId: ws, rating, product: b.product, order: b.order, name: b.name, publicUrl: pub, error })); };
    if (!rating) return back('Please choose a rating from one to five stars.');
    const ip = String((req.headers && (req.headers['x-forwarded-for'] || '')) || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
    if (limited(ip)) return back('Too many submissions from this connection in a few minutes. Please try again shortly.');
    const row = {
      workspace_id: ws, rating, comment: clip(b.comment, 2000) || null,
      issue: ISSUES.includes(String(b.issue)) ? String(b.issue) : null,
      order_again: AGAIN.includes(String(b.again)) ? String(b.again) : null,
      followup: Object.prototype.hasOwnProperty.call(FOLLOW, String(b.followup)) ? String(b.followup) : 'none',
      order_ref: clip(b.order, 60) || null, product_ref: clip(b.product, 160) || null,
      ip_hash: ip ? crypto.createHash('sha256').update(`review|${ws}|${ip}`).digest('hex').slice(0, 32) : null,
    };
    const e = env();
    try {
      const r = await fetch(`${e.url}/rest/v1/brand_review_feedback`, { method: 'POST', headers: { apikey: e.key, Authorization: `Bearer ${e.key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (!r.ok) return back('Your feedback could not be saved just now. Please try again in a moment.');
    } catch (_) { return back('Your feedback could not be saved just now. Please try again in a moment.'); }
    const to = `/review?b=${encodeURIComponent(ws)}&thanks=1&rating=${rating}&followup=${encodeURIComponent(row.followup)}${row.product_ref ? `&product=${encodeURIComponent(row.product_ref)}` : ''}${b.name ? `&name=${encodeURIComponent(clip(b.name, 40))}` : ''}`;
    res.statusCode = 303; res.setHeader('Location', to); return res.end();
  }
  return res.status(400).json({ ok: false, error: 'unknown_action' });
}

module.exports = { handle, feedbackPage, thanksPage, starLink, starRowHtml, publicReviewUrl, ratingOf, ISSUES, AGAIN, FOLLOW };
