/*
 * brand-music.js - the music brief for a brand, a product or a sale (2026-10-25).
 *
 * The operator: "integrate the music studio feature from the Third Eye Jarvis
 * agent repo ... so that it can be used to create music for brands in
 * particular. It could be for particular products, for particular sales,
 * anything. Also add music creation in the smart brain", with a Gemini-made
 * product video as the quality bar.
 *
 * From The Third Eye's Music Studio (frontend/src/lib/music): its four agents
 * (musicologist -> beat-smith + lyricist -> conductor) turn a request into a
 * genre-grounded brief, an arrangement with section tags, lyrics that fit the
 * sections, and ONE prompt for a text-to-music model; a structure per genre
 * family; a prompt that names genre, tempo, instruments, production and
 * structure rather than the bare description. Here the same parts are written
 * in code from the ACTIVE brand's own record, so a brand's track never carries a
 * word the brand did not state:
 *   - the PURPOSE (a product, a sale, a launch, the brand's anthem, a sonic
 *     logo, an ad bed, a Reels loop, a film underscore) sets the job, length,
 *     energy and ending;
 *   - the GENRE is the operator's pick, else one read off the brand's industry;
 *   - the LYRICS (only when vocals are asked for) are the brand's own lines:
 *     its name, tagline, the product's name and an offer only as the operator
 *     typed it. Nothing is invented, a banned phrase drops its line, no dashes;
 *   - the PROMPT closes by ruling out what the model must not do (an artist's
 *     voice, an existing song, a fade that cuts the ending).
 * The track itself is made by music-compose.js (Lyria first). This file has no
 * I/O and is byte-identical at /brand-music.js for the browser.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BrandMusic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PURPOSES = {
    product:    { label: 'A product',            seconds: 30, energy: 6, mood: 'confident, inviting, premium',            job: 'the music for a short film about one product: a clear motif from the first second, a lift when the product is revealed, and a clean ending on the last beat' },
    sale:       { label: 'A sale or offer',      seconds: 20, energy: 8, mood: 'energetic, celebratory, upbeat',          job: 'a promotional track for a sale: punchy from the first beat, a bright repeating hook, and a confident final hit' },
    launch:     { label: 'A new launch',         seconds: 30, energy: 7, mood: 'bold, anticipatory, fresh',               job: 'a launch track: a short build of anticipation, then a reveal moment, ending on a strong resolved chord' },
    jingle:     { label: 'Brand jingle with vocals', seconds: 30, energy: 7, mood: 'catchy, bright, confident', vocals: true, job: 'a short brand jingle with a sung hook that names the brand, easy to remember after one listen' },
    anthem:     { label: 'Brand anthem',         seconds: 60, energy: 6, mood: 'uplifting, proud, warm',                  job: 'the brand\'s anthem: a memorable melody that returns, a full arrangement that grows, and a proud resolved ending' },
    sonic_logo: { label: 'Sonic logo',           seconds: 6,  energy: 5, mood: 'memorable, warm, distinctive',            job: 'a sonic logo: a three to five note motif that is instantly memorable and resolves on the home note, with no intro' },
    ad_bed:     { label: 'Ad bed',               seconds: 15, energy: 7, mood: 'driving, modern, catchy',                 job: 'a music bed for a paid social ad: a hook inside the first second, room for a voiceover, and a clean button ending' },
    reel_loop:  { label: 'Reels or Shorts loop', seconds: 30, energy: 6, mood: 'feel-good, steady, modern',               job: 'a loop for vertical short video: a steady groove that loops seamlessly, the last bar leading straight back into the first' },
    film:       { label: 'Brand film underscore', seconds: 90, energy: 4, mood: 'emotive, cinematic, building',           job: 'an underscore for a brand film: it starts gently, builds through the middle and resolves warmly at the end' },
  };

  // Genre anchors (after The Third Eye's knowledge base): tempo range, the
  // instruments that make the genre recognisable, and how it is produced.
  var GENRES = {
    'modern pop':     { bpm: [100, 122], inst: 'punchy modern drums, warm synth bass, bright plucked synths, airy pads, hand claps', prod: 'polished, radio-ready pop mix with a wide stereo image' },
    'warm acoustic':  { bpm: [86, 104],  inst: 'fingerpicked acoustic guitar, upright piano, soft brushed percussion, hand claps, light strings', prod: 'warm, intimate and natural, like a sunlit kitchen' },
    'cafe jazz':      { bpm: [92, 118],  inst: 'brushed drums, walking upright bass, Rhodes electric piano, muted trumpet', prod: 'smooth and cosy with gentle vinyl warmth' },
    'lo-fi hip-hop':  { bpm: [72, 90],   inst: 'dusty swung drums, mellow Rhodes chords, deep round bass, soft vinyl texture', prod: 'relaxed, warm and slightly saturated' },
    'hip-hop':        { bpm: [86, 100],  inst: 'hard-hitting 808 bass, crisp snares, rolling hi-hats, dark synth lead', prod: 'street-ready, big low end, crisp top' },
    'house':          { bpm: [120, 126], inst: 'four-on-the-floor kick, off-beat open hats, deep rolling bassline, chord stabs, sidechained pads', prod: 'club-clean, energetic and bright' },
    'afrobeats':      { bpm: [100, 112], inst: 'syncopated percussion, shakers, warm guitar riffs, smooth bass, light log drums', prod: 'sunny, bouncy and danceable' },
    'electronic':     { bpm: [110, 128], inst: 'analog synth arpeggios, tight electronic drums, sub bass, sidechained pads, glassy leads', prod: 'sleek, futuristic and precise' },
    'cinematic':      { bpm: [70, 110],  inst: 'string ensemble, felt piano, taiko and orchestral percussion, brass swells', prod: 'epic, wide and emotional, film-score quality' },
    'bollywood pop':  { bpm: [95, 115],  inst: 'dhol, tabla, sitar riff, lush strings, modern pop drums and bass', prod: 'vibrant, festive Indian pop production' },
    'bhangra':        { bpm: [95, 110],  inst: 'dhol, tumbi, chimta, punchy bass, hand claps', prod: 'high-energy Punjabi celebration' },
    'synthwave':      { bpm: [90, 112],  inst: 'retro analog synths, gated reverb drums, pulsing bass, shimmering arps', prod: 'nostalgic 80s gloss' },
    'indie rock':     { bpm: [110, 140], inst: 'jangly electric guitars, driving bass, live drums, gang vocals feel', prod: 'raw but polished band sound' },
    'r&b':            { bpm: [68, 96],   inst: 'smooth keys, deep bass, crisp finger snaps, lush pads', prod: 'silky, intimate and modern' },
    'ambient':        { bpm: [60, 84],   inst: 'evolving pads, soft piano, gentle textures, subtle pulses', prod: 'calm, spacious and premium' },
    'latin pop':      { bpm: [92, 106],  inst: 'reggaeton dembow drums, nylon guitar, bright brass, warm bass', prod: 'sunny and rhythmic' },
  };

  // An industry's own words choose a genre the brand's buyers would expect.
  var BY_INDUSTRY = [
    [/bake|bread|cake|cookie|patisserie|dessert|sweet|chocolate/, 'warm acoustic'],
    [/coffee|cafe|café|tea|brew/, 'cafe jazz'],
    [/food|restaurant|kitchen|grocer|snack|meat|deli|organic/, 'warm acoustic'],
    [/sneaker|streetwear|apparel|fashion|footwear|shoe|clothing/, 'hip-hop'],
    [/beauty|skin|cosmetic|makeup|hair|fragrance|perfume/, 'r&b'],
    [/fitness|gym|sport|athlet|supplement|protein/, 'house'],
    [/tech|software|app|saas|electronic|gadget|phone|ai\b/, 'electronic'],
    [/news|media|finance|bank|invest|insur|market data|research/, 'cinematic'],
    [/jewel|luxury|watch/, 'ambient'],
    [/eyewear|optical|spectacle|sunglass|kid|toy|baby|pet/, 'modern pop'],
    [/travel|hotel|airline|holiday/, 'afrobeats'],
  ];

  var LANGUAGES = ['English', 'Hindi', 'Hinglish', 'Spanish', 'French', 'German', 'Portuguese', 'Arabic', 'Japanese', 'Korean', 'Tamil', 'Punjabi'];

  function str(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }
  function noDash(s) { return String(s || '').replace(/\s*[–—]\s*/g, ', ').replace(/,\s*,/g, ','); }
  function industryOf(brand) {
    var b = brand || {}, d = b.brand_data || {};
    var offer = (b.offerings || d.offerings || []).map(function (o) { return o && (o.kind || o.name) || ''; }).join(' ');
    return str(b.industry || d.industry || offer);
  }
  function genreFor(brand) {
    var hay = industryOf(brand).toLowerCase();
    for (var i = 0; i < BY_INDUSTRY.length; i++) if (BY_INDUSTRY[i][0].test(hay)) return BY_INDUSTRY[i][1];
    return 'modern pop';
  }
  function bannedOf(brand) {
    var b = brand || {}, v = b.voice || (b.brand_data && b.brand_data.voice) || {};
    return (Array.isArray(v.banned) ? v.banned : []).map(function (x) { return str(x).toLowerCase(); }).filter(Boolean);
  }
  function hasBanned(line, banned) {
    var l = String(line || '').toLowerCase();
    return banned.some(function (p) { return p && l.indexOf(p) >= 0; });
  }
  function toneOf(brand) {
    var b = brand || {}, v = b.voice || (b.brand_data && b.brand_data.voice) || {};
    return str(v.tone || (Array.isArray(v.adjectives) ? v.adjectives.join(', ') : ''));
  }
  // A store name like "Vincent Chase VC 5158/P" is the range, not the code.
  function sayable(name) {
    var n = str(name);
    var cut = n.replace(/\b[A-Z]{1,4}[- ]?\d[\w/.-]*\b.*$/, '').trim();
    return cut.length >= 3 ? cut : n;
  }

  function structureFor(seconds, purpose, vocals) {
    if (purpose === 'sonic_logo' || seconds <= 8) return 'Motif (a three to five note phrase) - Resolve';
    if (purpose === 'reel_loop') return 'Groove - Hook - Groove (seamless loop)';
    if (seconds <= 20) return vocals ? 'Intro (2 seconds) - Hook - Button ending' : 'Intro (2 seconds) - Main theme - Button ending';
    if (seconds <= 40) return vocals ? 'Intro - Verse - Hook - Outro' : 'Intro - Theme - Lift - Outro';
    if (seconds <= 80) return vocals ? 'Intro - Verse - Hook - Verse - Hook - Outro' : 'Intro - Theme - Build - Peak - Theme - Outro';
    return vocals ? 'Intro - Verse - Pre-chorus - Hook - Verse - Hook - Bridge - Hook - Outro' : 'Intro - Rise - Theme - Build - Climax - Resolution';
  }

  /**
   * Lyrics in the brand's own words, laid out on the structure's sections.
   * Returns '' when the brand has nothing to sing beyond its name.
   */
  function lyricsFor(o) {
    var brand = o.brand || {}, name = str(brand.name), banned = bannedOf(brand);
    if (!name) return '';
    var tagline = str(brand.tagline || (brand.brand_data && brand.brand_data.tagline));
    if (tagline.length > 70) tagline = '';
    var product = o.product ? sayable(o.product.title || o.product.name) : '';
    var offer = str(o.offer).slice(0, 80);
    var claims = (brand.claims || (brand.brand_data && brand.brand_data.claims) || []).map(str).filter(function (c) { return c && c.length <= 60; });
    var hook = [name + (tagline ? ', ' + tagline : (product ? ', ' + product : ''))];
    if (o.purpose === 'sale' && offer) hook.push(offer);
    hook.push(name);
    var verse = [];
    if (product) verse.push(product);
    if (claims[0]) verse.push(claims[0]);
    if (o.purpose !== 'sale' && offer) verse.push(offer);
    if (claims[1] && verse.length < 3) verse.push(claims[1]);
    var clean = function (lines) { return lines.map(noDash).filter(function (l) { return l && !hasBanned(l, banned); }); };
    hook = clean(hook); verse = clean(verse);
    if (!hook.length) return '';
    var secs = Number(o.seconds) || 30;
    var parts = [];
    if (o.purpose === 'sonic_logo' || secs <= 8) return '[Sung tag]\n' + name;
    if (secs > 20 && verse.length) parts.push('[Verse]\n' + verse.join('\n'));
    parts.push('[Hook]\n' + hook.join('\n'));
    if (secs > 40 && verse.length) parts.push('[Verse]\n' + verse.join('\n'), '[Hook]\n' + hook.join('\n'));
    parts.push('[Outro]\n' + name);
    return parts.join('\n\n');
  }

  /**
   * The plan for one track. `o`: { brand, purpose, genre, mood, seconds,
   * vocals, language, product: {title}, offer, notes, lyrics (the operator's
   * own, kept as typed), market }.
   */
  function plan(o) {
    o = o || {};
    var brand = o.brand || {};
    var purpose = PURPOSES[o.purpose] ? o.purpose : (o.offer ? 'sale' : (o.product ? 'product' : 'anthem'));
    var P = PURPOSES[purpose];
    var genre = GENRES[str(o.genre).toLowerCase()] ? str(o.genre).toLowerCase() : genreFor(brand);
    var G = GENRES[genre];
    var seconds = Math.round(Number(o.seconds) || P.seconds);
    seconds = Math.min(180, Math.max(5, seconds));
    var energy = P.energy;
    var span = G.bpm[1] - G.bpm[0];
    var bpm = Math.round(G.bpm[0] + span * Math.min(1, Math.max(0, (energy - 3) / 6)));
    var vocals = (o.vocals === undefined ? !!P.vocals : !!o.vocals) && purpose !== 'ad_bed' && purpose !== 'film';
    var language = LANGUAGES.indexOf(str(o.language)) >= 0 ? str(o.language) : 'English';
    var tone = toneOf(brand);
    var mood = str(o.mood) || P.mood;
    var typed = str(o.lyrics) ? String(o.lyrics).trim().slice(0, 1800) : '';
    var lyrics = vocals ? (typed || lyricsFor({ brand: brand, purpose: purpose, product: o.product, offer: o.offer, seconds: seconds })) : '';
    if (vocals && !lyrics) vocals = false;
    var structure = structureFor(seconds, purpose, vocals);
    var out = {
      purpose: purpose, purpose_label: P.label, seconds: seconds, genre: genre, bpm: bpm,
      mood: mood, tone: tone, instruments: G.inst, production: G.prod, structure: structure,
      vocals: vocals, language: language, lyrics: noDash(lyrics), lyrics_source: vocals ? (typed ? 'typed' : 'brand record') : 'none',
      loop: purpose === 'reel_loop',
      title: [str(brand.name), o.product ? sayable(o.product.title || o.product.name) : '', P.label.toLowerCase()].filter(Boolean).join(' - '),
    };
    out.title = noDash(out.title);
    out.prompt = promptFor(out, brand, o);
    return out;
  }

  function promptFor(p, brand, o) {
    var b = brand || {}, name = str(b.name), industry = industryOf(b);
    var P = PURPOSES[p.purpose];
    var lines = [];
    lines.push('Create an original ' + p.genre + ' track, about ' + p.seconds + ' seconds long.');
    if (name) lines.push('For the brand ' + name + (industry ? ' (' + industry + ')' : '') + '.');
    var tagline = str(b.tagline || (b.brand_data && b.brand_data.tagline));
    if (tagline && tagline.length <= 120) lines.push('The brand describes itself as: ' + tagline + '.');
    if (o && str(o.market)) lines.push('Home market: ' + str(o.market).toUpperCase() + '.');
    lines.push('Purpose: ' + P.job + '.');
    if (o && o.product) lines.push('It is for the product "' + sayable(o.product.title || o.product.name) + '".');
    if (o && str(o.offer) && p.purpose === 'sale') lines.push('It promotes this offer: ' + noDash(str(o.offer)).slice(0, 120) + '.');
    lines.push('Mood: ' + p.mood + (p.tone ? '; in the brand\'s voice: ' + p.tone : '') + '.');
    lines.push('Tempo: about ' + p.bpm + ' BPM. Instruments: ' + p.instruments + '.');
    lines.push('Production: ' + p.production + '; a professionally mixed and mastered, broadcast-ready track with a full, clear low end, a crisp top and no clipping.');
    lines.push('Structure: ' + p.structure + '.');
    lines.push(p.loop ? 'It must loop seamlessly: no fade in or out.' : 'It must end cleanly on the final beat or chord, never cut off and never a long fade.');
    if (o && str(o.notes)) lines.push('Also: ' + noDash(str(o.notes)).slice(0, 300) + '.');
    if (p.vocals) {
      lines.push('Vocals: a clear, catchy lead vocal in ' + p.language + '. Sing exactly these lyrics, in this order, and no others:');
      lines.push(p.lyrics);
    } else {
      lines.push('Instrumental only, no vocals.');
    }
    lines.push('Do not imitate any named artist, voice or existing song, and use no copyrighted lyrics or melodies.');
    return noDash(lines.join('\n')).slice(0, 4000);
  }

  return {
    PURPOSES: PURPOSES, GENRES: GENRES, LANGUAGES: LANGUAGES,
    plan: plan, genreFor: genreFor, lyricsFor: lyricsFor, structureFor: structureFor, sayable: sayable,
  };
});
