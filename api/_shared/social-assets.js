'use strict';
// SOCIAL POSTS AS A SEND'S OWN ASSET (2026-11-11).
//
// The operator: "For asset generation, also add assets like social media posts.
// Like we've kept ads, we've kept landing pages, keep social media posts also,
// and individually for Instagram, Meta, LinkedIn, and other platforms also to
// be included, like TikTok, etc."
//
// Every Smart Brain build now carries `campaign.assets.social_posts`: ONE
// organic post per platform, each in that platform's own shape (a caption, a
// first line, hashtags, a title where the platform has one, the picture or the
// video it goes out with). Organic posts are not ads: no budget, no targeting,
// and they read as the brand speaking on its own page.
//
// How each post is written:
//   - A post on the brand's own page is read by everyone, so it says only what
//     is true for everyone: the store's own sentences about the product
//     (product-story.js), its name and price, an article's headline and
//     standfirst, and the brand's own tagline and claims. The ads' text is
//     written to one cohort ("It has been a while") and is never used. No
//     model call: the copy call's time belongs to the mail, the page and the
//     ads (smart-brain-plan.copyTiming).
//   - Limits are READ from social-core.PLATFORM_SPECS (the table Social Media
//     OS already validates against), never typed again. A post that would not
//     fit loses whole lines from the end; a line is never cut.
//   - Hashtags are made only of words the record states (the brand's name, the
//     product's type and range, the industry, a publisher's sections). A
//     platform's range is a ceiling: nothing is invented to reach a minimum.
//   - Instagram and TikTok captions carry no link (a link in a caption is not
//     tappable there): they say "link in bio". Every other platform carries the
//     slot's own page, tagged for that platform.
//   - No page on record: no link line, and the gap is said in data_gaps.

const MARKER = /\[\s*DATA REQUIRED/i;

// The platforms a send posts on, in the order they are shown. `link` says
// whether a caption there carries a tappable link.
const POSTS = [
  { key: 'instagram_feed', label: 'Instagram post', link: false },
  { key: 'instagram_reels', label: 'Instagram Reel', link: false },
  { key: 'facebook', label: 'Facebook post', link: true },
  { key: 'linkedin', label: 'LinkedIn post', link: true },
  { key: 'tiktok', label: 'TikTok video', link: false },
  { key: 'x', label: 'X post', link: true },
  { key: 'pinterest', label: 'Pinterest pin', link: true },
  { key: 'youtube_shorts', label: 'YouTube Short', link: true },
  { key: 'threads', label: 'Threads post', link: true },
];

const str = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const fold = (t) => str(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stop = (t) => { const s = str(t); return s && !/[.!?]$/.test(s) ? s + '.' : s; };
const ok = (t) => { const s = str(t); return s && !MARKER.test(s) && !/\{\{/.test(s) ? s : ''; };

function specs() { return require('./social-core.js').PLATFORM_SPECS; }

// A hashtag from words the record states: letters and digits only, CamelCase.
function tagOf(words) {
  const parts = str(words).replace(/&/g, ' and ').split(/[^A-Za-z0-9À-￿]+/).filter(Boolean);
  if (!parts.length) return '';
  const t = parts.map((w) => (/^[A-Z0-9]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  return t.length >= 3 && t.length <= 30 && /[A-Za-z]/.test(t) ? '#' + t : '';
}
const GENERIC = new Set(['product', 'products', 'pick', 'general', 'other', 'misc', 'default', 'and', 'the', 'for', 'with', 'digital', 'online', 'retail', 'store', 'shop', 'brand']);

function hashtagsFor(entry, name) {
  const b = (entry && entry.brand) || {};
  const hp = entry && entry.heroProduct && !entry.heroProduct.placeholder ? entry.heroProduct : null;
  const out = [];
  const add = (w) => { const t = tagOf(w); if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t); };
  add(b.name);
  const cat = hp && ok(hp.category) && !/[,;|]/.test(String(hp.category)) ? String(hp.category) : '';
  if (cat && !GENERIC.has(cat.toLowerCase())) add(cat);
  // The range a product belongs to ("Kay Beauty", "Vincent Chase"): the first
  // two words of its own name, when the name has more than those.
  const nm = str(name).split(' ');
  if (hp && nm.length >= 3 && nm[0].length >= 2 && /^[A-Z]/.test(nm[0]) && /^[A-Z]/.test(nm[1])) add(nm.slice(0, 2).join(' '));
  for (const w of str(b.industry).split(/[\/,;&]+|\band\b/i)) { const s = str(w); if (s && s.split(' ').length <= 3 && !s.split(' ').every((x) => GENERIC.has(x.toLowerCase()))) add(s); }
  if (!hp) for (const o of Array.isArray(b.offerings) ? b.offerings.slice(0, 4) : []) { const n = ok(o && o.name); if (n && n.length <= 24) add(n); }
  return out;
}

// Lines, each once (a line an earlier one already says is left out), joined,
// inside `max` characters by dropping whole lines from the end.
function compose(lines, max, sep) {
  const kept = [];
  const said = [];
  for (const raw of lines) {
    const l = String(raw == null ? '' : raw).split('\n').map(ok).filter(Boolean).join('\n');
    if (!l) continue;
    const f = fold(l);
    if (!f || said.some((s) => s.indexOf(f) >= 0 || (f.indexOf(s) >= 0 && s.split(' ').length >= 4))) continue;
    said.push(f);
    kept.push(l);
  }
  const joiner = sep == null ? '\n\n' : sep;
  while (kept.length > 1 && max && kept.join(joiner).length > max) kept.pop();
  const out = kept.join(joiner);
  return max && out.length > max ? '' : out;
}

/**
 * build(entry, campaign, { link, finish, spell }) -> { posts, data_gaps }
 *   link    the slot's own page (smart-brain-plan.slotLinks().pdp), or ''
 *   finish  (text) => text: the brand's scrub (banned words, dashes)
 *   spell   (text) => text: units as words (unit-words.js)
 */
function build(entry, campaign, opts = {}) {
  const S = specs();
  const b = (entry && entry.brand) || {};
  const bName = str(b.name);
  const gaps = [];
  if (!bName) return { posts: [], data_gaps: gaps };
  const svc = require('../../lib/smart-brain/services.js');
  const MF = require('./mailer-format.js');
  const MT = require('./marketing-team.js');
  const fin1 = (t) => { let s = str(t); try { if (opts.spell) s = opts.spell(s); if (opts.finish) s = opts.finish(s); } catch (_) { /* as written */ } return str(s); };
  // Line breaks are part of a caption: each line is finished on its own.
  const fin = (t) => String(t == null ? '' : t).split('\n').map(fin1).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const hp = entry && entry.heroProduct && !entry.heroProduct.placeholder && !MARKER.test(String(entry.heroProduct.title || '')) ? entry.heroProduct : null;
  const ads = (campaign && campaign.assets && Array.isArray(campaign.assets.ads)) ? campaign.assets.ads : [];
  const adOf = (p, type) => ads.find((a) => a && a.platform === p && String(a.creative_type || '').toLowerCase() === type) || ads.find((a) => a && a.platform === p) || null;
  const metaS = adOf('meta', 'static') || {};
  const metaV = adOf('meta', 'video') || {};
  const tik = adOf('tiktok', 'video') || {};
  let pf = {};
  try { pf = (hp && svc.productFacts(entry)) || {}; } catch (_) { pf = {}; }
  const st = pf.story || { what: '', benefits: [], inside: [], how: [] };
  const story = !!st.article;
  const name = hp ? (story ? str(hp.title) : (MF.shortName(hp.title) || str(hp.title))) : bName;
  const priceSaid = pf.price ? `${pf.price}${pf.compare ? `, was ${pf.compare}` : ''}` : '';
  const reasons = (story ? [] : [].concat(st.benefits || [], st.inside || [])).map(str).filter(Boolean);
  const what = story ? '' : str(st.what);
  // How to use it is worth saying in a post; how to store it is not.
  const how = str((st.how || []).find((h) => !require('./product-story.js').isStorage(h)) || '');
  const tagline = ok(b.tagline);
  const claims = (Array.isArray(b.claims) ? b.claims : []).map(ok).filter(Boolean);
  const cta = str((entry && entry.cta) || metaS.cta || svc.defaultCta(entry));
  // A post on the brand's own page is read by EVERYONE, so it says only what is
  // true for everyone: the product's own facts and the brand's own lines. The
  // ads' text is written to one cohort ("It has been a while", "Thank you for
  // your first order") and is never used here.
  const headline = story ? name : '';
  const lead = (story ? stop(st.what) : '') || stop(reasons[0]) || stop(what) || stop(claims[0]) || stop(tagline) || '';
  const second = reasons[1] ? stop(reasons[1]) : '';
  const namePrice = hp && !story ? stop(`${name}${priceSaid ? `, ${priceSaid}` : ''}`) : '';
  const offered = !hp ? (Array.isArray(b.offerings) ? b.offerings : []).map((o) => ok(o && o.name)).filter((n) => n && n.length <= 24).slice(0, 5) : [];
  const offeredLine = offered.length >= 2 ? offered.join(' · ') : '';
  const short = (story ? [name] : [reasons[0], reasons[1], namePrice, tagline, claims[0]]).map(ok).find((x) => x && x.length <= 110) || '';
  const brandLine = [tagline].concat(claims).map(ok).find((x) => x && fold(lead).indexOf(fold(x)) < 0) || '';
  const page = /^https?:\/\//i.test(String(opts.link || '')) ? String(opts.link) : '';
  if (!page) gaps.push(require('./brand-locale.js').marker('page to link from social posts', b, entry && entry.market));
  let tag = '';
  try { tag = require('./marketing-team-server.js').campaignTag(campaign, entry); } catch (_) { tag = ''; }
  // An organic post's link says so: medium `social`, never the paid medium an ad carries.
  const linkFor = (platform, key) => { if (!page) return ''; try { return MT.taggable(page) ? MT.utmUrl(page, { utm_source: platform, utm_medium: 'social', utm_campaign: tag, utm_content: 'social-' + key.replace(/_/g, '-') }) : page; } catch (_) { return page; } };
  const tagsAll = hashtagsFor(entry, hp ? str(hp.title) : '');
  const photo = (() => {
    let u = '';
    try { u = hp ? (require('./catalog-image.js').url(hp, entry.market, { width: 1080, brand: entry.brand }) || '') : ''; } catch (_) { u = ''; }
    if (!u && hp && /^https:\/\//i.test(String(hp.image || ''))) u = String(hp.image);
    return /^https:\/\//i.test(u) ? u : '';
  })();
  const stat = metaS.creative || {};
  const hasStory = ads.some((a) => a && a.creative && a.creative.story_html);
  const bullets = reasons.filter((r) => fold(lead).indexOf(fold(r)) < 0).slice(0, 3).map((r) => '• ' + r.replace(/[.!]$/, ''));
  const bio = `${cta}: link in bio.`;
  const posts = [];
  for (const P of POSTS) {
    const sp = S[P.key];
    if (!sp) continue;
    const url = P.link ? linkFor(sp.platform, P.key) : '';
    const go = P.link ? (url ? `${cta}: ${url}` : '') : bio;
    let lines; let sep = '\n\n'; let title = '';
    switch (P.key) {
      case 'instagram_feed': lines = [headline, lead, what, bullets.join('\n'), how, namePrice, offeredLine, go]; break;
      case 'instagram_reels': lines = [headline, second || lead, namePrice, go]; break;
      case 'facebook': lines = [headline, lead, what, namePrice, offeredLine, go]; break;
      case 'linkedin': lines = [headline, brandLine ? stop(brandLine) : '', what || lead, lead, bullets.join('\n'), namePrice, offeredLine, go]; break;
      case 'tiktok': lines = [short || lead, namePrice]; sep = ' '; break;
      case 'x': lines = [short || lead, namePrice, url]; sep = ' '; break;
      case 'pinterest': title = name; lines = [what || lead, lead, how]; sep = ' '; break;
      case 'youtube_shorts': title = [`${name}: ${str(reasons[0]).replace(/[.!]$/, '')}`, name].find((t) => t && !/: $/.test(t) && t.length <= (sp.title_limit || 100)) || name; lines = [lead, how, namePrice, go]; break;
      default: lines = [headline, lead, second, namePrice, url]; break;
    }
    // Hashtags: at most the platform's ceiling, and only while the post still fits.
    const maxTags = Array.isArray(sp.hashtags) ? sp.hashtags[1] : 0;
    let hashtags = tagsAll.slice(0, maxTags);
    let caption = compose(lines.map(fin), sp.char_limit, sep);
    if (!caption) caption = compose([short, name, bName].map(fin), sp.char_limit, sep);
    while (hashtags.length && sp.char_limit && (caption + '\n\n' + hashtags.join(' ')).length > sp.char_limit) hashtags = hashtags.slice(0, -1);
    const hook = caption.split(/\n/)[0].split(/(?<=[.!?])\s+/)[0] || caption;
    const video = sp.media === 'video';
    const post = {
      id: `${(campaign && campaign.campaign_id) || (entry && entry.id) || 'send'}_social_${P.key}`,
      type: 'social_post', key: P.key, platform: sp.platform, format: sp.format, label: P.label,
      caption, hook, hashtags,
      ...(title ? { title: fin(title).slice(0, sp.title_limit || 100) } : {}),
      ...(url ? { link: url } : {}),
      cta,
      media: video
        ? { kind: 'video', aspect: sp.aspect, dims: sp.dims, source: hasStory ? 'this send\'s Story video (the 9:16 video ad, saved as MP4)' : '', ...(photo ? { cover_image: photo } : {}) }
        : { kind: 'image', aspect: sp.aspect, dims: sp.dims, ...(photo ? { image_url: photo } : {}), ...(stat.static_png_url ? { designed_static: stat.static_png_url } : {}), source: photo ? 'the product\'s own catalogue photo' : '' },
      alt_text: fin(hp ? (story ? name : `${name} from ${bName}`) : bName),
      limits: { caption: sp.char_limit || null, hashtags: sp.hashtags || null, ...(sp.title_limit ? { title: sp.title_limit } : {}) },
      best_time_local: sp.best_time_utc || null,
      organic: true,
      by: 'brand_lines',
    };
    if (!photo && !video) post.media.gap = require('./brand-locale.js').marker('image for social posts', b, entry && entry.market);
    if (video && !hasStory) post.media.gap = require('./brand-locale.js').marker('video for social posts', b, entry && entry.market);
    posts.push(post);
  }
  if (posts.some((p) => p.media && p.media.gap && p.media.kind === 'image')) gaps.push(require('./brand-locale.js').marker('image for social posts', b, entry && entry.market));
  return { posts, data_gaps: gaps };
}

// What the finished post must satisfy, judged on the post itself (never
// rewritten): inside its platform's limits, no marker or unfilled tag, a link
// only where the platform makes one tappable.
function check(post) {
  const S = specs();
  const sp = S[post.key] || {};
  const out = [];
  const add = (level, slot, message) => out.push({ level, slot, message });
  const cap = String(post.caption || '');
  if (!cap.trim()) add('block', 'caption', 'The post has no caption.');
  if (sp.char_limit && (cap + (post.hashtags && post.hashtags.length ? '\n\n' + post.hashtags.join(' ') : '')).length > sp.char_limit) add('block', 'caption', `The caption and hashtags are over ${sp.platform}'s ${sp.char_limit} characters.`);
  if (MARKER.test(cap) || /\{\{|\}\}/.test(cap)) add('block', 'caption', 'The caption carries a marker or an unfilled tag.');
  if (sp.title_limit && post.title && String(post.title).length > sp.title_limit) add('block', 'title', `The title is over ${sp.title_limit} characters.`);
  if (Array.isArray(sp.hashtags) && (post.hashtags || []).length > sp.hashtags[1]) add('warn', 'hashtags', `More than ${sp.hashtags[1]} hashtags for ${sp.platform}.`);
  if ((post.key === 'instagram_feed' || post.key === 'instagram_reels' || post.key === 'tiktok') && /https?:\/\//i.test(cap)) add('warn', 'caption', 'A link in this caption is not tappable on this platform.');
  if (post.link && !/^https:\/\//i.test(String(post.link))) add('block', 'link', 'The link is not https.');
  return out;
}

// The post as plain text, for Copy and for a .txt download.
function plain(post) {
  return [post.title ? post.title : '', post.caption, (post.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
}

module.exports = { build, check, plain, hashtagsFor, POSTS };
