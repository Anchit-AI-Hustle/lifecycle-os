/**
 * The same words on two sends close together (2026-11-21).
 * ---------------------------------------------------------------------------
 * A reader who gets Monday's subject line again on Wednesday reads the second
 * mail as the first. Each send is built on its own, so nothing saw this. This
 * module only FINDS repeats among sends that are already built and says where
 * they are; it never rewrites copy (the words a send says are its builder's
 * and its reviewer's).
 *
 * A repeat is: the same market, two sends at most `days` apart (default 7, the
 * window the frequency cap is counted over), and the same subject line, mail
 * headline or first Meta primary text once case, spacing and punctuation are
 * folded. Sends to different markets are different readers and never compared.
 *
 * UMD: the page loads the byte-identical /copy-repeats.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CopyRepeats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FIELDS = [
    { key: 'subject', label: 'subject line' },
    { key: 'headline', label: 'mail headline' },
    { key: 'ad_text', label: 'ad text' }
  ];
  function fold(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/&[a-z#0-9]+;/g, ' ').replace(/[^a-z0-9À-￿]+/g, ' ').trim();
  }
  function dayOf(d) { var t = Date.parse(String(d || '').slice(0, 10) + 'T00:00:00Z'); return isFinite(t) ? Math.round(t / 86400000) : null; }
  /** What a built campaign says, in the three places a reader meets it first. */
  function linesOf(campaign) {
    var a = (campaign && campaign.assets) || {};
    var e = a.email || {};
    var ads = Array.isArray(a.ads) ? a.ads : [];
    var meta = ads.filter(function (x) { return x && /meta|facebook|instagram/i.test(String(x.platform || '')) && x.primary_text; })[0];
    return {
      subject: e.subject || (campaign && campaign.subject) || '',
      headline: e.headline || e.hero_headline || (campaign && campaign.copy && campaign.copy.hero_headline) || '',
      ad_text: (meta && meta.primary_text) || ''
    };
  }
  /**
   * @param sends [{ id, date, market, subject, headline, ad_text }]
   * @returns { repeats: [{ field, label, text, market, days_apart, a:{id,date}, b:{id,date} }], by_send: { id: [sentence] }, compared }
   */
  function find(sends, opts) {
    var days = Math.max(0, +((opts && opts.days) != null ? opts.days : 7));
    var list = (Array.isArray(sends) ? sends : []).map(function (s) { return Object.assign({}, s, { _day: dayOf(s && s.date), _m: String((s && s.market) || '').toUpperCase() }); })
      .filter(function (s) { return s.id != null && s._day != null; })
      .sort(function (x, y) { return x._day - y._day || String(x.id).localeCompare(String(y.id)); });
    var repeats = [], by = {};
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var x = list[i], y = list[j];
        if (x._m !== y._m) continue;
        var gap = y._day - x._day;
        if (gap > days) continue;
        for (var f = 0; f < FIELDS.length; f++) {
          var k = FIELDS[f].key, fx = fold(x[k]);
          if (!fx || fx.length < 4 || fx !== fold(y[k])) continue;
          repeats.push({ field: k, label: FIELDS[f].label, text: String(x[k]), market: x._m || null, days_apart: gap, a: { id: x.id, date: x.date }, b: { id: y.id, date: y.date } });
          (by[y.id] = by[y.id] || []).push('Same ' + FIELDS[f].label + ' as the send on ' + x.date + ': "' + String(x[k]).slice(0, 90) + '"');
          (by[x.id] = by[x.id] || []).push('Same ' + FIELDS[f].label + ' as the send on ' + y.date + ': "' + String(x[k]).slice(0, 90) + '"');
        }
      }
    }
    return { repeats: repeats, by_send: by, compared: list.length, window_days: days };
  }
  return { find: find, linesOf: linesOf, fold: fold, FIELDS: FIELDS };
});
