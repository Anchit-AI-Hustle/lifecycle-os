/*
 * unit-words.js - a measurement is written the way a person says it (2026-10-21).
 *
 * The operator: "there must be basic understanding, like the letter W ... it means
 * watts, so basically 100 watts, it shouldn't say 100 W ... It could be based on any
 * brand ... for another brand it could be any other spectrum." A store's spec line
 * ("100W", "20000mAh", "500ml", "25°C") travelled into copy as a symbol a reader has
 * to decode. Copy says "100 watts", and before a noun "100-watt charger".
 *
 * Only symbols that are UNAMBIGUOUS right after a number are expanded here; the
 * model is told the rule for everything else (`RULE`, carried by every prompt).
 * Deliberately not expanded: m (metres, minutes or million), s, h, A (amps or a
 * flat number), L (litres or a size), in, K (4K), G (5G), p (1080p), x (2x).
 *
 * UMD: Node (`require`) and the browser (`window.UnitWords`).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UnitWords = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // symbol -> [singular, plural, kind]. kind 'simple' takes the attributive form
  // before a noun ("100-watt charger"); 'phrase' units (rates, degrees) never do.
  // `re` (metre) words are spelled per locale: en-US -er, everywhere else -re.
  const TABLE = [
    ['kWh', 'kilowatt-hour', 'kilowatt-hours'], ['Wh', 'watt-hour', 'watt-hours'],
    ['mAh', 'milliamp-hour', 'milliamp-hours'], ['Ah', 'amp-hour', 'amp-hours'],
    ['kW', 'kilowatt', 'kilowatts'], ['MW', 'megawatt', 'megawatts'], ['mW', 'milliwatt', 'milliwatts'], ['W', 'watt', 'watts'],
    ['kV', 'kilovolt', 'kilovolts'], ['mV', 'millivolt', 'millivolts'], ['V', 'volt', 'volts'],
    ['mA', 'milliamp', 'milliamps'],
    ['GHz', 'gigahertz', 'gigahertz'], ['MHz', 'megahertz', 'megahertz'], ['kHz', 'kilohertz', 'kilohertz'], ['Hz', 'hertz', 'hertz'],
    ['dB', 'decibel', 'decibels'],
    ['TB', 'terabyte', 'terabytes'], ['GB', 'gigabyte', 'gigabytes'], ['MB', 'megabyte', 'megabytes'], ['KB', 'kilobyte', 'kilobytes'],
    ['Gbps', 'gigabit per second', 'gigabits per second', 'phrase'], ['Mbps', 'megabit per second', 'megabits per second', 'phrase'],
    ['km/h', 'kilo@ per hour', 'kilo@s per hour', 'phrase'], ['kmph', 'kilo@ per hour', 'kilo@s per hour', 'phrase'],
    ['mph', 'mile per hour', 'miles per hour', 'phrase'], ['rpm', 'revolution per minute', 'revolutions per minute', 'phrase'],
    ['km', 'kilo@', 'kilo@s'], ['cm', 'centi@', 'centi@s'], ['mm', 'milli@', 'milli@s'],
    ['kg', 'kilogram', 'kilograms'], ['mg', 'milligram', 'milligrams'], ['g', 'gram', 'grams'],
    ['ml', 'milli#', 'milli#s'], ['mL', 'milli#', 'milli#s'],
    ['lbs', 'pound', 'pounds'], ['lb', 'pound', 'pounds'], ['oz', 'ounce', 'ounces'],
    ['sq ft', 'square foot', 'square feet'], ['ft', 'foot', 'feet'],
    ['°C', 'degree Celsius', 'degrees Celsius', 'phrase'], ['°F', 'degree Fahrenheit', 'degrees Fahrenheit', 'phrase'],
    ['hrs', 'hour', 'hours'], ['hr', 'hour', 'hours'], ['mins', 'minute', 'minutes'], ['min', 'minute', 'minutes'],
    ['secs', 'second', 'seconds'], ['sec', 'second', 'seconds'], ['ms', 'millisecond', 'milliseconds'],
  ];
  const BY_SYM = new Map(TABLE.map((r) => [r[0], r]));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  // Longest symbol first so "kWh" is not read as "kW" + "h".
  const SYMS = TABLE.map((r) => r[0]).sort((a, b) => b.length - a.length).map(esc).join('|');
  // A number not glued to a word, a code or a URL ("VC5158W", "#100W", "/100W"),
  // then an optional space, the symbol, and no further letter or digit.
  const RX = new RegExp('(?<![\\p{L}\\p{N}#/._])(?<![\\p{L}]-)(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?([ \\u00a0\\u202f]?)(' + SYMS + ')(?![\\p{L}\\p{N}])', 'gu');
  // Words after which the unit is not before a noun ("100 W of power", "100W and up").
  const FUNCTION = new Set('of and or to in on at with for per from by as than that which who is are was were be it its this these those the a an up down out off into over under so but if then when while because'.split(' '));

  function spell(word, locale) {
    const us = /^en-US$/i.test(String(locale || '')) || /^US$/i.test(String(locale || ''));
    return word.replace(/@/g, us ? 'meter' : 'metre').replace(/#/g, us ? 'liter' : 'litre');
  }

  function spellUnits(text, opts) {
    const o = opts || {};
    const s = String(text == null ? '' : text);
    if (!/\d/.test(s)) return s;
    return s.replace(RX, (all, int, frac, gap, sym, offset, whole) => {
      const row = BY_SYM.get(sym);
      if (!row) return all;
      // "g" glued to a small number is the network generation as often as grams ("5g").
      if (sym === 'g' && !gap && !frac && /^[2-6]$/.test(int)) return all;
      const n = Number(String(int).replace(/,/g, '') + (frac || ''));
      const one = n === 1 && !frac;
      const after = whole.slice(offset + all.length);
      const next = (after.match(/^[  ]+([\p{L}][\p{L}'-]*)/u) || [])[1] || '';
      const attributive = row[3] !== 'phrase' && next && !FUNCTION.has(next.toLowerCase()) && /^\p{Ll}/u.test(next);
      if (attributive) return `${int}${frac || ''}-${spell(row[1], o.locale)}`;
      return `${int}${frac || ''} ${spell(one ? row[1] : row[2], o.locale)}`;
    });
  }

  // Text between tags only: never an attribute, a URL, a style or a script.
  function spellUnitsHtml(html, opts) {
    const s = String(html == null ? '' : html);
    if (!/\d/.test(s)) return s;
    // A comment carries text a mail client reads (the SUBJECT / PREHEADER header);
    // an Outlook conditional block ([if mso]) is markup and is left alone.
    return s.split(/(<!--[\s\S]*?-->)/).map((chunk) => {
      if (chunk.indexOf('<!--') === 0) return /^<!--\s*\[/.test(chunk) ? chunk : '<!--' + spellUnits(chunk.slice(4, -3), opts) + '-->';
      return spellTags(chunk, opts);
    }).join('');
  }

  function spellTags(s, opts) {
    let skip = 0;
    return s.split(/(<[^>]*>)/).map((part) => {
      if (part.charAt(0) === '<') {
        if (/^<(style|script)\b/i.test(part)) skip += 1;
        else if (/^<\/(style|script)\b/i.test(part)) skip = Math.max(0, skip - 1);
        return part;
      }
      return skip ? part : spellUnits(part, opts);
    }).join('');
  }

  // The same rule, for the model: what reaches every prompt (and so every prompt an
  // operator copies into ChatGPT, Gemini or Claude).
  const RULE = 'UNITS: write every unit of measure the way a person says it, never as its symbol: "100 watts" (not "100 W" or "100W"), '
    + '"a 100-watt charger" before a noun, "20,000 milliamp-hours", "500 millilitres", "25 degrees Celsius", "60 miles per hour". '
    + 'Read a spec line for what it measures (W is power in watts, mAh battery capacity, GB storage) and say it in words; keep a model name or product code exactly as written.';

  return { spellUnits, spellUnitsHtml, RULE, TABLE };
}));
