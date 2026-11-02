'use strict';
/**
 * ad-patterns.js - what the brand's OWN imported ads are made of, counted
 * (2026-11-02, gap 4 against usefastlane.ai).
 * ---------------------------------------------------------------------------
 * Fastlane reads a brand's ad history and says which openings and formats it
 * leans on. ad-history.js already keeps the brand's own ads with the figures
 * each platform returned; this counts them, per platform (a platform's rates
 * are its own and are never pooled with another's):
 *   - hook pattern: the opening line of each ad's own copy, classified by the
 *     SAME rule Winning angles uses for competitor ads (ad-angle-lab
 *     hookPattern), so the two read one vocabulary;
 *   - with video / without video, where the platform returned the ad's format;
 *   - for each, the share stated as a count ("3 of 6"), and the median
 *     click-through rate of the ads in it that carry one. Under three rated
 *     ads a group has NO rate (`median_ctr: null`, with the reason): a median
 *     of two is a coin toss written as a figure.
 * An ad whose copy the platform did not return (Google Ads, read from its
 * metrics report) is counted apart as "copy not returned", never classified,
 * and an ad whose format was not returned is not put on either side of the
 * video split. Pure, no I/O.
 * ---------------------------------------------------------------------------
 */

const MIN_RATED = 3;
const LABEL = { meta: 'Meta', google_ads: 'Google Ads', tiktok_ads: 'TikTok', pinterest: 'Pinterest' };

const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function opening(a) {
  const t = String((a && (a.primary_text || a.headline)) || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^[^.!?\n]*[.!?]?/);
  return (m ? m[0] : t).slice(0, 160);
}

/** True / false where the platform returned the ad's format, null where it did not. */
function hasVideo(a) {
  if (a.has_video === true || a.has_video === false) return a.has_video;
  if (a.video_id || a.video_url) return true;
  if (a.image_url || a.primary_text || a.headline) return false;
  return null;
}

function group(list, of) {
  const rated = list.map((a) => num(a.metrics && a.metrics.ctr)).filter((v) => v != null);
  const rate = rated.length >= MIN_RATED ? median(rated) : null;
  return {
    count: list.length, of, share: of ? list.length / of : 0, share_text: `${list.length} of ${of}`,
    rated: rated.length, median_ctr: rate,
    rate_reason: rate == null ? `${rated.length} of these ${list.length} carry a reported click-through rate, under ${MIN_RATED}, so no rate is given.` : '',
  };
}

/** The pattern statistics of one brand's imported ads, per platform. */
function patternStats(ads) {
  const hookPattern = require('./ad-angle-lab.js').hookPattern;
  const byProvider = {};
  for (const a of (Array.isArray(ads) ? ads : [])) { if (a) (byProvider[a.provider || 'unknown'] = byProvider[a.provider || 'unknown'] || []).push(a); }
  const platforms = Object.keys(byProvider).sort().map((prov) => {
    const list = byProvider[prov];
    const withCopy = list.filter((a) => opening(a));
    const groups = {};
    for (const a of withCopy) (groups[hookPattern(opening(a))] = groups[hookPattern(opening(a))] || []).push(a);
    const patterns = Object.keys(groups).map((k) => Object.assign({ pattern: k }, group(groups[k], withCopy.length)))
      .sort((x, y) => y.count - x.count || x.pattern.localeCompare(y.pattern));
    const known = list.filter((a) => hasVideo(a) !== null);
    const vids = known.filter((a) => hasVideo(a) === true);
    const stills = known.filter((a) => hasVideo(a) === false);
    return {
      provider: prov, label: LABEL[prov] || prov, ads: list.length,
      copy_read: withCopy.length, copy_not_returned: list.length - withCopy.length,
      patterns,
      video: known.length ? { with: group(vids, known.length), without: group(stills, known.length), format_not_returned: list.length - known.length } : null,
      note: [
        withCopy.length < list.length ? `${list.length - withCopy.length} of ${list.length} ${LABEL[prov] || prov} ads came without their copy, so they are not classified.` : '',
        known.length < list.length ? `${list.length - known.length} of ${list.length} came without their format, so they are on neither side of the video split.` : '',
      ].filter(Boolean).join(' '),
    };
  });
  return { min_rated: MIN_RATED, metric: 'click-through rate (clicks / impressions, as the platform reported it)', platforms };
}

/** The lines a prompt carries for these statistics (creative-evidence OWN ADS). */
function briefLines(stats) {
  const out = [];
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  for (const pl of (stats && stats.platforms) || []) {
    if (!pl.copy_read && !pl.video) continue;
    const pats = pl.patterns.map((p) => `${p.pattern} ${p.share_text}${p.median_ctr != null ? ` (median ${pct(p.median_ctr)})` : ' (no rate: under 3 rated)'}`).join('; ');
    if (pats) out.push(`  ${pl.label} openings: ${pats}.`);
    if (pl.video) {
      const v = pl.video;
      out.push(`  ${pl.label} format: with video ${v.with.share_text}${v.with.median_ctr != null ? ` (median ${pct(v.with.median_ctr)})` : ' (no rate)'}, without video ${v.without.share_text}${v.without.median_ctr != null ? ` (median ${pct(v.without.median_ctr)})` : ' (no rate)'}.`);
    }
    if (pl.note) out.push(`  ${pl.note}`);
  }
  return out;
}

module.exports = { patternStats, briefLines, hasVideo, opening, MIN_RATED };
