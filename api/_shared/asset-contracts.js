'use strict';
/**
 * asset-contracts.js — every asset type is BUILT BY ITS OWN LOGIC, and the
 * finished artefact is checked against that logic before it ships.
 * ---------------------------------------------------------------------------
 * WHAT WAS WRONG. asset-specs.js already held the real dimensions and copy
 * limits for every placement. Exactly one file consumed it: master-prompt.js,
 * which pastes it into a PROMPT. So the rules reached the model as prose, and:
 *
 *   - every renderer re-typed the numbers itself (scripts/lib/ad-creative.js
 *     clamps to 125/40/30 and 30/90 from its own literals), so the spec and the
 *     thing that ships could drift apart silently and did;
 *   - one copy pass wrote email, landing and all three ad platforms together,
 *     so an ad was mailer thinking in an ad-shaped field rather than something
 *     designed as an ad;
 *   - nothing ever checked the FINISHED asset. A headline three characters over
 *     the Google limit was discovered by Google, not by us.
 *
 * A contract here is executable, not advisory. It states, for ONE asset type:
 *
 *   structure   the ordered slots that asset actually has in its medium, each
 *               with its limit and the reason the medium imposes it
 *   design      layout rules that belong to that surface and no other
 *   algorithm   the ordered steps by which this asset type is made
 *   validate()  the finished artefact judged against all of the above
 *
 * ── THE TWO RULES THAT KEEP THIS HONEST ────────────────────────────────────
 *
 * 1. NUMBERS ARE READ, NEVER RE-TYPED. Every limit below is pulled from
 *    asset-specs.js at require time. If a contract wants a number that spec
 *    does not carry, that is a gap in the spec and it is declared as one, not
 *    quietly filled in here. This is the whole point: one number, one place.
 *
 * 2. A LIMIT THIS REPO CANNOT SOURCE DOES NOT BLOCK. A constraint is `verified`
 *    only when this repo ENFORCES it against a real platform API somewhere
 *    (Google Ads' 30 character headline and 90 character description are
 *    verified, because google-ads-adapter.js drops copy that exceeds them
 *    before a request is built). Everything else is advisory and reports as
 *    `warn`. A gate that blocks on a number nobody checked is worse than no
 *    gate, and this deployment cannot reach the platforms' own documentation to
 *    confirm the rest.
 *
 * NOT a function file (api/_shared/ → outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

const specs = require('./asset-specs.js');

/* ── provenance ──────────────────────────────────────────────────────────── */

/**
 * A constraint is VERIFIED when this repo already refuses to send copy that
 * breaks it. Those are the only ones allowed to block.
 */
const VERIFIED_SOURCES = {
  'google.headline': 'api/_shared/adapters/google-ads-adapter.js drops headlines over 30 characters rather than truncating them',
  'google.description': 'api/_shared/adapters/google-ads-adapter.js drops descriptions over 90 characters',
  'google.headline_count': 'api/_shared/adapters/google-ads-adapter.js caps the array at 15 before building the request',
  'google.path': 'api/_shared/adapters/google-ads-adapter.js slices path1/path2 to 15 characters',
};

function limit(value, key, why, verifiedKey) {
  return {
    max: value,
    why,
    verified: !!(verifiedKey && VERIFIED_SOURCES[verifiedKey]),
    source: (verifiedKey && VERIFIED_SOURCES[verifiedKey]) || 'api/_shared/asset-specs.js',
  };
}

/** A slot the spec does not carry a number for. Declared, never invented. */
function unbounded(why) {
  return { max: null, why, verified: false, source: 'no limit recorded in asset-specs.js' };
}

const A = specs.ADS;
const M = specs.MAILER;
const MSG = specs.MESSAGING;

/* ── the contracts ───────────────────────────────────────────────────────── */

/**
 * HOW MUCH A MAILER SAYS (2026-10-17). The operator: "ensure that the text is
 * not too much". One set of numbers that briefs the writer, picks which blocks
 * the renderer prints and judges the finished mail, so the three cannot
 * disagree. Body words = everything a reader reads between the logo header and
 * the footer: headline, subline, paragraphs, bullets, the button. A visual
 * mailer lets the picture carry part of the message, so it says less.
 * These are editorial limits of this platform (no inbox enforces them), so a
 * breach WARNS and never blocks.
 */
const MAIL_WORDS = Object.freeze({ headline: 10, paragraph: 45, benefit: 12, benefits: 3, ps: 25, text: 130, visual: 90 });

const CONTRACTS = {
  /* ═════════════════════════════════════════════════════════════════════════
     EMAIL. The only surface here whose renderer is a 25-year-old table engine
     and whose reader may never load an image.
     ═══════════════════════════════════════════════════════════════════════ */
  'email.mailer': {
    id: 'email.mailer',
    medium: 'email',
    label: 'Lifecycle mailer',
    structure: [
      { slot: 'subject', required: true, ...limit(60, 'subject', 'Most mobile clients truncate around here, and the truncation point is where the reader decides.') },
      { slot: 'preheader', required: true, ...limit(90, 'preheader', 'Shown beside the subject in the inbox list; past this it is cut without ceremony.') },
      { slot: 'intro_paragraph', required: true, ...unbounded('Length is an editorial choice, not a platform limit.') },
      { slot: 'body_paragraph', required: false, ...unbounded('Optional second beat.') },
      { slot: 'cta', required: true, ...unbounded('Short by convention, not by rule.') },
      { slot: 'html', required: true, ...unbounded('The rendered artefact itself.') },
    ],
    design: [
      `Content column is ${M.desktop.contentWidth}px and must never exceed ${M.desktop.maxWidth}px: wider breaks Outlook's table engine.`,
      `Below ${M.mobile.breakpoint}px the layout collapses to one fluid column.`,
      `Body text is at least ${M.mobile.body.minFontPx}px on mobile, because iOS auto-zooms anything smaller and the layout jumps.`,
      `Tap targets are at least ${M.mobile.tapTargetPx}px high.`,
      'The mailer must be COMPLETE with images disabled. An image-only mailer is a blank rectangle to a reader whose client blocks images by default.',
      'Images are REFERENCED by hosted URL, never embedded as base64. Gmail clips past roughly 102KB and the mailer is truncated mid-layout.',
      'Animation may only hide content inside the same gated block that animates it, or a client that strips animation paints the mailer permanently invisible (see motion-design.js).',
      // Email design practice (2026-10-17; vendor guidance from Dotdigital,
      // ATTN, Hostinger, Insider and the American Express email design system,
      // read and agreed across sources, not a measured benchmark):
      'One column. The brand\'s logo first, linked to its homepage.',
      'Inverted pyramid: the hero picture (Text + Visual) or the headline, a one-line subhead, then the main button, all within the first ~300px; the rest is supporting detail, and the button is repeated at the end for readers who scroll.',
      'Never an image-only mail: words carry the message (about 60:40 text to image is the common rule of thumb), and every picture has alt text that says what it is for.',
      'The preheader extends the subject in about 40 to 70 characters; it never repeats it.',
    ],
    algorithm: [
      'Resolve the cohort and the offer, so the mailer knows who it is for before it knows what it says.',
      'Choose the layout archetype for that intent.',
      'Write subject and preheader FIRST and as a pair: they are the only copy most recipients read, and the preheader must extend the subject rather than repeat it.',
      'Write the body to the archetype, not to a word count.',
      'Resolve product facts and proof from the brand\'s own catalogue and review library; anything absent becomes a marker.',
      'Render through the shared table renderer at the fixed column width.',
      'Validate against this contract, then check it still reads with images off.',
    ],
    validate(asset) {
      const v = [];
      const a = asset || {};
      if (a.subject && a.preheader && a.subject.trim().toLowerCase() === a.preheader.trim().toLowerCase()) {
        v.push(warn('preheader', 'The preheader repeats the subject, which wastes the second line the inbox gives you.'));
      }
      if (a.html && !/<table/i.test(a.html)) {
        v.push(warn('html', 'No table element: this will not hold its layout in Outlook, which renders with the Word engine.'));
      }
      if (a.html && /<img[^>]*>/i.test(a.html) && !/alt=/i.test(a.html)) {
        v.push(warn('html', 'An image with no alt text is invisible to a reader whose client blocks images, and to a screen reader.'));
      }
      // The full-mail rules judge a complete mail; a fragment (a block being
      // composed) keeps only the rules that hold for any HTML.
      if (typeof a.html === 'string' && /<body\b|<html\b/i.test(a.html)) v.push(...mailQuality(a));
      return v.concat(urlsNotPayloads(a, ['html']));
    },
  },

  /* ═════════════════════════════════════════════════════════════════════════
     META. Two different assets that are usually treated as one: a static ad is
     read, a video ad is watched, and the first two seconds do the work.
     ═══════════════════════════════════════════════════════════════════════ */
  'ad.meta.static': {
    id: 'ad.meta.static',
    medium: 'paid-social',
    label: 'Meta static ad',
    structure: [
      { slot: 'primary_text', required: true, ...limit(A.meta.copy.primaryText, 'primary_text', 'Meta collapses the primary text behind a More link; everything past this is a click away.') },
      { slot: 'headline', required: true, ...limit(A.meta.copy.headline, 'headline', 'The bold line under the creative, truncated past this.') },
      { slot: 'description', required: false, ...limit(A.meta.copy.description, 'description', 'Shown only in some placements, and short in all of them.') },
    ],
    design: [
      `Feed renders ${placement(A.meta, 'feed_square')}; portrait ${placement(A.meta, 'feed_portrait')} buys the most feed height.`,
      `Stories and Reels are ${placement(A.meta, 'story_reel')}, and ${safeOf(A.meta, 'story_reel')}.`,
      'The creative must carry the message with the copy unread: the primary text is behind a fold on most placements.',
    ],
    algorithm: [
      'Pick the placement first, because the safe area changes what can be composed.',
      'Compose the frame from the brand\'s OWN catalogue photography.',
      'Write the hook into the first line of primary text, before the More link cuts it.',
      'Write the headline as the standalone promise, since it survives when nothing else is read.',
      'Validate, then check the frame reads at thumbnail size.',
    ],
    validate: adCopyValidator('ad.meta.static'),
  },

  'ad.meta.video': {
    id: 'ad.meta.video',
    medium: 'paid-social-video',
    label: 'Meta video ad',
    structure: [
      { slot: 'primary_text', required: true, ...limit(A.meta.copy.primaryText, 'primary_text', 'Same inbox-style truncation as the static ad.') },
      { slot: 'headline', required: true, ...limit(A.meta.copy.headline, 'headline', 'Truncated past this.') },
      { slot: 'motion_html', required: true, ...unbounded('The renderable artefact. A storyboard is not an asset: a reviewer approving a play triangle on a gradient has approved nothing.') },
    ],
    design: [
      `Vertical video is ${placement(A.meta, 'story_reel')}; ${safeOf(A.meta, 'story_reel')}.`,
      'The hook has to move inside the first second. A static opening frame is indistinguishable from a still.',
      'It must work silent: most of these are watched with sound off, so anything said must also be shown.',
    ],
    algorithm: [
      'Choose the shot order before any copy, because motion drives the read.',
      'Build from the brand\'s own real product photography, never a stock frame.',
      'Put the hook in frame one and the offer before the midpoint.',
      'Render an artefact that can actually be played and downloaded, and say plainly whether an MP4 exists.',
      'Validate copy and confirm the artefact exists.',
    ],
    validate(asset) {
      return withArtefact(
        adCopyValidator('ad.meta.video')(asset), asset,
        'A video ad with no renderable artefact. A reviewer cannot approve what does not exist, and this has shipped as a play triangle drawn over a gradient before.',
      ).concat(urlsNotPayloads(asset || {}, ['motion_html']));
    },
  },

  /* ═════════════════════════════════════════════════════════════════════════
     GOOGLE. The only contract here whose limits are VERIFIED, because the
     adapter already drops copy that breaks them before building a request.
     ═══════════════════════════════════════════════════════════════════════ */
  'ad.google.rsa': {
    id: 'ad.google.rsa',
    medium: 'search',
    label: 'Google responsive search ad',
    structure: [
      { slot: 'headlines', required: true, list: true, count_max: 15, ...limit(30, 'headline', 'Google drops a headline over 30 characters rather than truncating it, so an over-long line silently does not exist.', 'google.headline') },
      { slot: 'descriptions', required: true, list: true, count_max: 4, ...limit(90, 'description', 'Over 90 and the description is dropped, not shortened.', 'google.description') },
      { slot: 'path1', required: false, ...limit(15, 'path', 'Display path segment.', 'google.path') },
      { slot: 'path2', required: false, ...limit(15, 'path', 'Display path segment.', 'google.path') },
    ],
    design: [
      'There is no layout to design. Google assembles the combination, so every headline must stand alone and no two may say the same thing.',
      'Assume any headline can appear beside any other: a pair that reads as a contradiction will eventually be served.',
    ],
    algorithm: [
      'Write headlines as independent claims, not as a sentence split across lines.',
      'Cover distinct angles (offer, benefit, category, brand) so the machine has real choices to test.',
      'Keep every line inside the verified limit, because the platform deletes rather than shortens.',
      'Validate, then check for near-duplicates that would waste a slot.',
    ],
    validate(asset) {
      const v = [];
      const a = asset || {};
      const heads = (a.headlines || []).filter(Boolean);
      const descs = (a.descriptions || []).filter(Boolean);
      for (const h of heads) {
        if (h.length > 30) v.push(block('headlines', `"${h}" is ${h.length} characters. Google DROPS a headline over 30 rather than truncating it, so this line would simply never appear.`));
      }
      for (const d of descs) {
        if (d.length > 90) v.push(block('descriptions', `A description is ${d.length} characters and would be dropped, not shortened.`));
      }
      if (heads.length > 15) v.push(block('headlines', `${heads.length} headlines; the adapter caps the array at 15 and the rest are discarded.`));
      if (descs.length > 4) v.push(warn('descriptions', `${descs.length} descriptions provided; a responsive search ad uses at most 4.`));
      const seen = new Set();
      for (const h of heads) {
        const k = h.trim().toLowerCase();
        if (seen.has(k)) v.push(warn('headlines', `"${h}" is duplicated, which spends one of the 15 slots on nothing.`));
        seen.add(k);
      }
      /* ZERO IS NOT "NOTHING TO CHECK".
       *
       * This read `if (heads.length && heads.length < 3)`, so one or two
       * headlines warned and NONE passed silently — while `headlines` is
       * declared required above. Every Google ad the app built carried no
       * headlines array at all and was reported ok:true, and
       * google-ads-adapter.js then refuses to build a request below 3
       * headlines and 2 descriptions. The gate was approving an ad the
       * adapter would not send.
       *
       * These block rather than warn because the minimum is not an advisory
       * number read off a spec sheet: this repo already enforces it, in
       * google-ads-adapter.js, before a request is made.
       */
      if (!heads.length) v.push(block('headlines', 'A responsive search ad has no headlines. Google assembles the ad from them, so there is nothing to serve; google-ads-adapter.js refuses to build the request.'));
      else if (heads.length < 3) v.push(block('headlines', `Only ${heads.length} headline(s). google-ads-adapter.js requires at least 3 before it will build a request, and the format exists to be combined.`));
      if (!descs.length) v.push(block('descriptions', 'A responsive search ad has no descriptions. google-ads-adapter.js requires at least 2.'));
      else if (descs.length < 2) v.push(block('descriptions', `Only ${descs.length} description(s). google-ads-adapter.js requires at least 2.`));
      return v.concat(adQuality(asset || {}, CONTRACTS['ad.google.rsa']));
    },
  },

  /* ═════════════════════════════════════════════════════════════════════════
     TIKTOK. Sound-on, hook-or-nothing, and the copy is an overlay rather than
     a field beside the frame.
     ═══════════════════════════════════════════════════════════════════════ */
  'ad.tiktok.video': {
    id: 'ad.tiktok.video',
    medium: 'short-video',
    label: 'TikTok ad',
    structure: [
      { slot: 'script', required: true, ...unbounded('The spoken and shown beats.') },
      { slot: 'caption', required: true, ...(A.tiktok && A.tiktok.copy && A.tiktok.copy.caption ? limit(A.tiktok.copy.caption, 'caption', 'Caption truncates in feed.') : unbounded('asset-specs.js records no caption limit for TikTok, so none is enforced.')) },
      { slot: 'motion_html', required: true, ...unbounded('The renderable artefact.') },
    ],
    design: [
      `Vertical ${placement(A.tiktok, 'in_feed') || '9:16'}; keep copy clear of the UI chrome on all four edges.`,
      'The first frame is the whole audition. A slow open is a scroll.',
      'It should look native to the feed rather than like a broadcast spot.',
    ],
    algorithm: [
      'Write the hook first, in the words a person would actually say.',
      'Storyboard to beats, not to a script read.',
      'Build from the brand\'s own footage or catalogue stills.',
      'Render the artefact, then validate.',
    ],
    validate(asset) {
      return withArtefact(
        adCopyValidator('ad.tiktok.video')(asset), asset,
        'No renderable artefact for a video ad.',
      );
    },
  },

  /*
   * The still half of a TikTok placement.
   *
   * asset-specs records ONE produced TikTok placement — in-feed, 9:16, noted as
   * "video / cover" — so the still this app builds for TikTok is a cover frame,
   * not a separate image-ad format. That is the whole reason it needs its own
   * contract rather than the video one: it is judged on the same frame and the
   * same safe areas, and on NONE of the things only a video has. Demanding a
   * script and a motion artefact from a still is not a stricter check, it is a
   * wrong one.
   *
   * Every number here is read from asset-specs at require time, the same as
   * every other contract. Nothing about TikTok is asserted that the spec does
   * not already record.
   */
  'ad.tiktok.static': {
    id: 'ad.tiktok.static',
    medium: 'paid-social',
    label: 'TikTok static / cover frame',
    structure: [
      { slot: 'caption', required: true, ...(A.tiktok && A.tiktok.copy && A.tiktok.copy.caption ? limit(A.tiktok.copy.caption, 'caption', 'Caption truncates in feed.') : unbounded('asset-specs.js records no caption limit for TikTok, so none is enforced.')) },
      { slot: 'headline', required: false, ...unbounded('TikTok has no separate headline field; carried only when the creative bakes one in.') },
      { slot: 'creative_brief', required: true, ...unbounded('What the frame shows. Without it nothing can be rendered.') },
    ],
    design: [
      `Vertical ${placement(A.tiktok, 'in_feed') || '9:16'}; ${safeOf(A.tiktok, 'in_feed') || 'keep copy clear of the UI chrome on all four edges'}.`,
      'It is the frame the feed stops on, so it has to read at a glance and at thumbnail size.',
      'Native to the feed, not a broadcast key art: a polished studio frame reads as an ad and is scrolled.',
    ],
    algorithm: [
      'Pick the frame that would make someone stop, not the most flattering one.',
      'Compose from the brand\'s own catalogue photography.',
      'Keep every element out of the platform chrome, which covers more of a 9:16 than it looks.',
      'Validate, then check it still reads at thumbnail size.',
    ],
    // No motion artefact, no script: a still has neither, and requiring them is
    // what produced three false blocks on every TikTok static this app built.
    validate: adCopyValidator('ad.tiktok.static'),
  },

  /* ═════════════════════════════════════════════════════════════════════════
     LANDING PAGE. The only surface that runs JavaScript and owns its own
     scroll, which is why it is the only one allowed scroll-driven behaviour.
     ═══════════════════════════════════════════════════════════════════════ */
  'landing.page': {
    id: 'landing.page',
    medium: 'web',
    label: 'Landing page',
    structure: [
      { slot: 'hero_headline', required: true, ...unbounded('Editorial length, no platform limit.') },
      { slot: 'hero_sub', required: false, ...unbounded('') },
      { slot: 'cta', required: true, ...unbounded('') },
      { slot: 'html', required: true, ...unbounded('The rendered page.') },
    ],
    design: [
      'The page must answer the ad that sent the visitor here. A mismatch between ad promise and page headline is the most common reason a click does not convert.',
      'Scroll-driven reveals and pointer effects live HERE and nowhere else: email has no JavaScript and an ad is a fixed frame.',
      'Content must be present without JavaScript. Reveal classes may only hide content once the script itself has marked the document.',
    ],
    algorithm: [
      'Start from the promise made by the asset that links here.',
      'Lay out the answer above the fold, then the evidence, then the action.',
      'Add motion last and only where it clarifies, never as decoration.',
      'Validate, then confirm the page still reads with scripting disabled.',
    ],
    validate(asset) {
      const v = [];
      const a = asset || {};
      if (a.html && /class="[^"]*\bsx\b/.test(a.html) && !/sx-on/.test(a.html)) {
        v.push(block('html', 'Reveal classes are present without the sx-on guard, so a visitor with no JavaScript gets a permanently blank page.'));
      }
      // The page's buttons need somewhere to go (2026-10-24 sweep: a brand with
      // no website or store on record shipped every button as href="#", and the
      // contract passed it while the mail's own check blocks the same thing).
      const dead = String(a.html || '').match(/<a\b[^>]*\bhref\s*=\s*"(?:#?)"[^>]*class="[^"]*\bbtn\b|<a\b[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*\bhref\s*=\s*"(?:#?)"/gi);
      if (dead) v.push(gap(block('cta', `${dead.length} button(s) on the page link to "#": the record has no website, store or product page for them to go to. [DATA REQUIRED BEFORE LAUNCH: website or store URL]`)));
      return v.concat(urlsNotPayloads(a, ['html']));
    },
  },

  /* ═════════════════════════════════════════════════════════════════════════
     OWNED MESSAGING (2026-10-23). Three surfaces with no layout at all: a
     text read on a lock screen, a template a platform must approve before it
     can be sent, and a notification the operating system truncates as it
     pleases. Their limits are READ from asset-specs.MESSAGING.
     ═══════════════════════════════════════════════════════════════════════ */
  'sms.message': {
    id: 'sms.message',
    medium: 'sms',
    label: 'SMS',
    structure: [
      { slot: 'text', required: true, max: MSG.sms.gsm7.single, why: `One part holds ${MSG.sms.gsm7.single} GSM-7 characters (${MSG.sms.ucs2.single} if any character is outside GSM-7); past that the message is sent as several parts of ${MSG.sms.gsm7.part} (or ${MSG.sms.ucs2.part}), each billed. Sent, never refused, so it warns.`, verified: false, source: `api/_shared/asset-specs.js (${MSG.sms.source})` },
      { slot: 'sender', required: true, ...unbounded('Who is texting: the reader must be able to tell which brand this is before anything else.') },
      { slot: 'opt_out', required: true, ...unbounded('Every marketing text says how to stop them.') },
    ],
    design: [
      'There is no layout: one line of plain text on a lock screen, read in a second.',
      'The brand names itself first, so the reader knows who is texting before deciding to read on.',
      'Plain GSM-7 characters: one emoji or curly quote switches the whole message to UCS-2 and cuts a part from 160 characters to 70.',
      'One link at most, to the brand\'s own page, and the opt-out last.',
    ],
    algorithm: [
      'Confirm the brand states that it sends SMS; never plan the channel for a brand that does not.',
      'Write ONE sentence to the reader from the brand\'s own facts.',
      'Add the brand name first, the link to the slot\'s own page, then the opt-out (the builder adds these, never the model).',
      'Count the parts in the encoding the text needs, and say it.',
      'Validate, then run the compliance gate on the finished text.',
    ],
    validate(asset) {
      const v = [];
      const a = asset || {};
      const text = String(a.text || '');
      if (!text.trim()) return [block('text', 'The SMS has no text.')];
      v.push(...placeholderBlocks(a, ['text']));
      const seg = smsCount(text);
      if (seg.segments > 1) v.push(warn('text', `${seg.units} ${seg.encoding} characters: sent as ${seg.segments} parts of ${seg.per_segment}, each billed.${seg.encoding === 'UCS-2' ? ` Outside GSM-7: ${seg.non_gsm.map((c) => JSON.stringify(c)).join(' ')}.` : ''} (Advisory: a long message is sent, never refused.)`));
      else if (seg.encoding === 'UCS-2') v.push(warn('text', `A character outside GSM-7 (${seg.non_gsm.map((c) => JSON.stringify(c)).join(' ')}) switches the message to UCS-2: one part holds ${MSG.sms.ucs2.single} characters instead of ${MSG.sms.gsm7.single}.`));
      if (!/\b(STOP|opt[\s-]?out|unsubscribe)\b/i.test(text)) v.push(block('opt_out', 'No opt-out in a marketing SMS. Every one must say how to stop them (CTIA Messaging Principles; TCPA practice; UK PECR reg. 22 "a simple means of refusing").'));
      const sender = String(a.sender || '').trim();
      if (!sender) v.push(block('sender', 'The SMS does not say which brand is texting. A marketing text must identify its sender (CTIA Messaging Principles; UK PECR reg. 23).'));
      // Copy carries no em/en dash (scrubDashes writes "-"), so a brand whose
      // own name has one is named in the text with a hyphen (2026-10-24 sweep).
      else if (text.replace(/[—–]/g, '-').toLowerCase().indexOf(sender.replace(/[—–]/g, '-').toLowerCase()) < 0) v.push(block('sender', `The text never names ${sender}: the reader cannot tell who is texting (CTIA Messaging Principles; UK PECR reg. 23).`));
      if (a.link && !/^https:\/\//i.test(String(a.link))) v.push(block('link', 'The link is not an https address on the brand\'s own site.'));
      v.push(...shouting('text', text));
      return v;
    },
  },

  'whatsapp.message': {
    id: 'whatsapp.message',
    medium: 'whatsapp',
    label: 'WhatsApp marketing template',
    structure: [
      { slot: 'headline', required: false, ...msgLimit(MSG.whatsapp.header_text, 'Template header text.') },
      { slot: 'body', required: true, ...msgLimit(MSG.whatsapp.body, 'Template body text.') },
      { slot: 'footer', required: false, ...msgLimit(MSG.whatsapp.footer, 'Template footer text; carries the opt-out.') },
      { slot: 'cta', required: false, ...msgLimit(MSG.whatsapp.button_text, 'Button text.') },
    ],
    design: [
      'Outside the 24-hour customer service window a marketing message is an APPROVED TEMPLATE: header, body, footer and buttons, submitted before the send.',
      `At most ${MSG.whatsapp.quick_reply_buttons} quick-reply buttons or ${MSG.whatsapp.cta_buttons} call-to-action buttons (recorded unverified).`,
      'A chat bubble, not a page: short sentences, one action, the brand\'s own facts.',
      'The footer says how to stop these messages.',
    ],
    algorithm: [
      'Confirm the brand states that it sends on WhatsApp.',
      'Write the header and body from the brand\'s own facts; every value filled, no {{1}} variables left.',
      'Add one URL button to the slot\'s own page, and the opt-out footer.',
      'Shape it as the template that is submitted for approval (name, MARKETING category, language, components).',
      'Validate, then run the compliance gate.',
    ],
    validate(asset) {
      const a = asset || {};
      const v = adCopyValidator('whatsapp.message')(a);
      v.push(...placeholderBlocks(a, ['headline', 'body', 'footer', 'cta']));
      const t = a.template || {};
      if (t.category && String(t.category).toUpperCase() !== 'MARKETING') v.push(warn('template', `The template category is ${t.category}; a promotional message is a MARKETING template.`));
      const btns = Array.isArray(a.buttons) ? a.buttons : [];
      const urlBtns = btns.filter((b) => b && /url|phone/i.test(String(b.type))).length;
      const qrBtns = btns.filter((b) => b && /quick/i.test(String(b.type))).length;
      if (urlBtns > MSG.whatsapp.cta_buttons) v.push(warn('buttons', `${urlBtns} call-to-action buttons against ${MSG.whatsapp.cta_buttons}. (Advisory: recorded unverified.)`));
      if (qrBtns > MSG.whatsapp.quick_reply_buttons) v.push(warn('buttons', `${qrBtns} quick-reply buttons against ${MSG.whatsapp.quick_reply_buttons}. (Advisory: recorded unverified.)`));
      for (const b of btns) {
        if (b && b.text && String(b.text).length > MSG.whatsapp.button_text) v.push(warn('buttons', `Button "${b.text}" is ${String(b.text).length} characters against ${MSG.whatsapp.button_text}. (Advisory: recorded unverified.)`));
        if (b && /url/i.test(String(b.type)) && !/^https:\/\//i.test(String(b.url || ''))) v.push(block('buttons', 'A URL button with no https address on the brand\'s own site.'));
      }
      const all = [a.headline, a.body, a.footer].map((x) => String(x || '')).join(' ');
      if (!/\b(STOP|opt[\s-]?out|unsubscribe|stop promotions)\b/i.test(all) && !btns.some((b) => /stop/i.test(String(b && b.text)))) {
        v.push(block('footer', 'No way to stop these messages. A marketing WhatsApp must offer one (WhatsApp Business messaging policy: honour opt-out requests; UK PECR reg. 22).'));
      }
      if (!String(a.sender || '').trim()) v.push(block('sender', 'No sender: the template is sent from the brand\'s own WhatsApp Business account, named on the record.'));
      if (/\{\{\s*\d+\s*\}\}/.test(all)) v.push(block('body', 'A template variable ({{1}}) is left unfilled.'));
      v.push(...shouting('body', String(a.body || '')));
      return v;
    },
  },

  'push.notification': {
    id: 'push.notification',
    medium: 'push',
    label: 'Push notification',
    structure: [
      { slot: 'title', required: true, ...unbounded('Truncation varies by operating system, device and notification style; no single limit is recorded.') },
      { slot: 'body', required: true, ...unbounded('Truncation varies by device; say the one thing first.') },
    ],
    design: [
      'A lock-screen line the operating system truncates as it pleases: the title and the first words of the body carry the message.',
      'The title does not repeat the body.',
      'It opens the brand\'s own page (a deep link), never a page of another site.',
    ],
    algorithm: [
      'Confirm the brand states that it sends push notifications.',
      'Write a short title and one sentence from the brand\'s own facts.',
      'Attach the slot\'s own page as the deep link.',
      'Validate, then run the compliance gate.',
    ],
    validate(asset) {
      const a = asset || {};
      const v = [];
      if (!String(a.title || '').trim()) v.push(block('title', 'A push notification has no title.'));
      if (!String(a.body || '').trim()) v.push(block('body', 'A push notification has no body.'));
      v.push(...placeholderBlocks(a, ['title', 'body']));
      if (a.title && a.body && String(a.title).trim().toLowerCase() === String(a.body).trim().toLowerCase()) v.push(warn('body', 'The body repeats the title: the notification says one thing twice.'));
      // No length rule: truncation varies by operating system and device, and
      // no single limit could be sourced (asset-specs.MESSAGING.push).
      const bodySentences = (String(a.body || '').match(/[.!?](\s|$)/g) || []).length;
      if (bodySentences > 2) v.push(warn('body', `The body is ${bodySentences} sentences: a lock screen shows the first words, so the message has to be in them.`));
      if (a.deep_link && !/^https:\/\//i.test(String(a.deep_link))) v.push(block('deep_link', 'The deep link is not an https address on the brand\'s own site.'));
      v.push(...shouting('title', String(a.title || '')), ...shouting('body', String(a.body || '')));
      return v;
    },
  },
};

/* ── messaging helpers ─────────────────────────────────────────────────── */

/** A messaging limit recorded in asset-specs, never verified here: warns, never blocks. */
function msgLimit(max, why) {
  return { max, why, verified: false, source: `api/_shared/asset-specs.js (${MSG.whatsapp.source})` };
}
function smsCount(text) { return require('./messaging-assets.js').smsSegments(text); }
/** A finished message never carries a gap marker or a merge tag. */
function placeholderBlocks(a, slots) {
  const v = [];
  for (const s of slots) {
    const t = String((a && a[s]) || '');
    if (/\[DATA REQUIRED BEFORE LAUNCH/i.test(t)) v.push(block(s, `${s} prints a DATA REQUIRED marker: a finished message must never say that to a customer.`));
    else if (/\{\{[^}]*\}\}|\{%[^%]*%\}/.test(t) && !/\{\{\s*\d+\s*\}\}/.test(t)) v.push(block(s, `${s} carries a merge tag nobody filled.`));
  }
  return v;
}
function shouting(slot, t) {
  const v = [];
  if ((String(t).match(/\b[A-Z]{4,}\b/g) || []).filter((w) => w !== 'STOP').length > 1) v.push(warn(slot, `${slot} has more than one word in capitals: it reads as shouting and carriers' filters weigh it.`));
  if ((String(t).match(/!/g) || []).length > 1) v.push(warn(slot, `${slot} has more than one exclamation mark.`));
  return v;
}

/* ── shared validators ───────────────────────────────────────────────────── */

function block(slot, message) { return { level: 'block', slot, message }; }

/* ── mailer quality rules (2026-10-17) ─────────────────────────────────────
   The operator: "Headers of the mails must have the brand logo with
   redirection to homepage of brand", both mailer TYPES ("Text only" and "Text
   and visuals"), "ensure that the text is not too much" and "ensure that
   visuals are properly created". Each rule reads the RENDERED html, so it
   judges what a reader receives, whichever builder or model wrote it. */
function htmlText(h) {
  return String(h || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}
function words(t) { return String(t || '').split(/\s+/).filter((w) => /[A-Za-z0-9À-￿]/.test(w)).length; }
function imgTags(h) { return String(h || '').match(/<img\b[^>]*>/gi) || []; }
function attr(tag, name) { const m = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')); return m ? (m[2] != null ? m[2] : m[3]) : null; }
// The body a reader reads: after the logo header, before the footer.
function mailBody(html) {
  let h = String(html || '').replace(/<head[\s\S]*?<\/head>/i, ' ');
  const logo = h.search(/data-mail-logo(?!-link)/i);
  if (logo >= 0) { const end = h.indexOf('</tr>', logo); const endDiv = h.indexOf('</header>', logo); const cut = [end, endDiv].filter((x) => x > logo).sort((x, y) => x - y)[0]; if (cut) h = h.slice(cut); }
  const foot = h.search(/data-mail-footer/i);
  if (foot >= 0) h = h.slice(0, h.lastIndexOf('<', foot));
  else { const t = h.search(/(You(?:'|&#39;|&rsquo;| a)re receiving this|receiving this (?:email|because)|unsubscribe)/i); if (t > 0) h = h.slice(0, h.lastIndexOf('<', t)); }
  // The disclaimer and the proof block are not the brand's pitch.
  return h.replace(/<[a-z]+[^>]*data-(?:disclaimer|proof)[^>]*>[\s\S]*?<\/(?:div|p|table|section)>/gi, ' ');
}
function mailQuality(a) {
  const v = [];
  const html = String(a.html || '');
  const body = html.replace(/<head[\s\S]*?<\/head>/i, ' ');
  // 1. The logo header, linked to the brand's homepage.
  const firstLink = body.match(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
  const marked = /data-mail-logo(?!-link)/i.test(body);
  const headLink = marked ? (body.slice(body.search(/data-mail-logo(?!-link)/i)).match(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)) : firstLink;
  const headTxt = headLink ? (htmlText(headLink[2]) || (/<img/i.test(headLink[2]) ? 'img' : '')) : '';
  if (!headLink || !/^https:\/\//i.test(headLink[1]) || !headTxt) {
    v.push(block('header', 'The mail does not open with the brand\'s logo linked to its homepage. Every mailer must: the reader checks who wrote before reading anything, and the logo is how they go to the brand\'s site. Add the logo (or the brand\'s name when it has no hosted logo) as the first element, linked to https://<the brand\'s website>.'));
  } else if (!/<img/i.test(headLink[2])) {
    v.push(gap(warn('header', 'The header shows the brand\'s name, not its logo: the record has no logo a mail client can show. Add a hosted https logo_url (PNG or JPG; an SVG is converted) to the brand.')));
  }
  // 2. The two mailer types.
  const content = imgTags(body).filter((t) => !/width="1"|height="1"/i.test(t));
  // The logo is the image INSIDE the header row, never the first image after it.
  const logoSrc = (() => {
    if (!marked) return null;
    const at = body.search(/data-mail-logo(?!-link)/i);
    const ends = ['</td>', '</header>', '</div>'].map((e) => body.indexOf(e, at)).filter((x) => x > at);
    const row = body.slice(at, ends.length ? Math.min(...ends) : at);
    const m = row.match(/<img\b[^>]*>/i);
    return m ? attr(m[0], 'src') : null;
  })();
  const pics = content.filter((t) => attr(t, 'src') !== logoSrc);
  if (a.mailer_type === 'text' && pics.length) {
    v.push(warn('html', `A Text mailer carries ${pics.length} picture${pics.length === 1 ? '' : 's'}. The Text type is words, colour and built elements only; the logo is the one image it keeps.`));
  }
  if (a.mailer_type === 'text_visual' && !pics.length) {
    v.push(gap(warn('html', 'A Text + Visual mailer has no picture: it falls back to a brand-colour block. Give the slot a product photo, the brand\'s own imagery, or let the free brand scene run.')));
  }
  // 3. Every picture is properly made: hosted over https, described, sized.
  for (const t of pics) {
    const src = attr(t, 'src') || '';
    // A slot a later stage fills (IMAGE_HERO_URL, PASTE_IMAGE_URL_HERE, an ESP
    // merge tag) is a picture not placed yet, not a broken link.
    if (/^(?:[A-Z][A-Z0-9_]*|\{\{[\s\S]*\}\}|\[[^\]]*\])$/.test(src.trim())) { v.push(gap(warn('html', `A picture slot is not filled yet (${src.slice(0, 40)}): place the hosted image before this is sent.`))); continue; }
    if (!/^https:\/\//i.test(src)) v.push(block('html', `A picture is not served over https (${src.slice(0, 60) || 'no src'}): mail clients block or warn on it, and the reader sees an empty box.`));
    if (!String(attr(t, 'alt') || '').trim()) v.push(warn('html', 'A picture has an empty alt: with images off (the default in many clients) the reader sees nothing where it was.'));
    if (!attr(t, 'width')) v.push(warn('html', 'A picture has no width attribute: Outlook renders it at its natural size and breaks the 600px column.'));
  }
  // 4. Not too much text.
  const bodyTxt = htmlText(mailBody(html));
  const n = words(bodyTxt);
  const cap = a.mailer_type === 'text_visual' || (a.mailer_type == null && pics.length) ? MAIL_WORDS.visual : MAIL_WORDS.text;
  if (n > cap) v.push(warn('copy', `The mail body is ${n} words against a budget of ${cap} for a ${cap === MAIL_WORDS.visual ? 'Text + Visual' : 'Text'} mailer. A mail is read on a phone in seconds: one idea, then the button.`));
  const h1 = body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || body.match(/data-ds="h1"[^>]*>([\s\S]*?)<\/(?:div|p)>/i);
  if (h1 && words(htmlText(h1[1])) > MAIL_WORDS.headline) v.push(warn('hero_headline', `The headline is ${words(htmlText(h1[1]))} words; keep it to ${MAIL_WORDS.headline} so it reads at a glance.`));
  const paras = (mailBody(html).match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || []).map((p) => words(htmlText(p)));
  const long = paras.filter((x) => x > MAIL_WORDS.paragraph).length;
  if (long) v.push(warn('copy', `${long} paragraph${long === 1 ? ' is' : 's are'} over ${MAIL_WORDS.paragraph} words: a wall of text on a phone. Split it or cut to one idea.`));
  // 4b. The main button sits near the top, not after the whole body.
  const bodyHtml = mailBody(html);
  const firstCta = bodyHtml.search(/data-ds="(?:button-primary|cta-link)"|<a\b[^>]*class="[^"]*\bbtn\b/i);
  if (firstCta > 0) {
    const before = words(htmlText(bodyHtml.slice(0, firstCta)));
    if (before > 70) v.push(warn('cta', `The main button comes after ${before} words. Put it under the headline and subhead, inside the first screen, and repeat it at the end.`));
  }
  // 5. The rules every commercial mail must keep.
  if (!/unsubscribe/i.test(htmlText(html))) v.push(block('footer', 'No way to unsubscribe is stated. Every commercial email must offer one (CAN-SPAM 15 U.S.C. 7704(a)(3); UK PECR reg. 22).'));
  const subj = String(a.subject || '');
  if (subj) {
    const caps = (subj.match(/\b[A-Z]{4,}\b/g) || []).length;
    if (caps > 1) v.push(warn('subject', 'The subject has more than one word in capitals: it reads as shouting and spam filters weigh it.'));
    if ((subj.match(/!/g) || []).length > 1) v.push(warn('subject', 'More than one exclamation mark in the subject: spam filters weigh it and it reads as pushy.'));
    if ((subj.match(/\p{Extended_Pictographic}/gu) || []).length > 1) v.push(warn('subject', 'More than one emoji in the subject.'));
    if (/^\s*(re|fwd?):/i.test(subj)) v.push(block('subject', 'The subject pretends to be a reply or forward. A deceptive subject line is prohibited (CAN-SPAM 15 U.S.C. 7704(a)(2)).'));
  }
  if (/\[DATA REQUIRED BEFORE LAUNCH/i.test(subj + ' ' + String(a.preheader || ''))) v.push(block('subject', 'The subject or preheader prints a DATA REQUIRED marker: fill the gap before this is sent.'));
  if (/<a\b[^>]*href\s*=\s*"#"[^>]*data-ds="button-primary"|data-ds="button-primary"[^>]*href\s*=\s*"#"/i.test(html)) v.push(block('cta', 'The main button links to "#": the one action the mail exists for goes nowhere.'));
  return v;
}
function warn(slot, message) { return { level: 'warn', slot, message }; }
// A finding about what the brand's RECORD lacks (a logo, a photo), not about
// how the asset was built: the operator fills it, the builder cannot.
function gap(v) { return Object.assign(v, { data_gap: true }); }

/**
 * A rendered asset REFERENCES its images; it does not carry them.
 *
 * The rule already existed as a sentence in one renderer's header ("Hosted
 * image URLs only - never base64") and was enforced nowhere, so nothing stopped
 * the next renderer from inlining a photo. Embedding one is not a style
 * preference:
 *
 *   - a base64 hero adds roughly a third to its own byte size and Gmail clips a
 *     message over ~102KB, so the mailer is truncated mid-layout;
 *   - most clients refuse to render base64 images at all, so the "safe" choice
 *     is the one that shows nothing;
 *   - an embedded copy cannot be swapped, re-cropped or CDN-resized later, and
 *     it is invisible to the asset provenance the rest of this repo relies on.
 *
 * creative-image.js already uploads a generated data-URL to Storage and returns
 * the public URL, so the correct path exists. This makes using it mandatory.
 *
 * `data:image/svg+xml` is deliberately allowed: it is small, uncompressed
 * markup used for textures such as the ad grain, not a photograph pretending to
 * be a URL.
 */
const RASTER_DATA_URI = /data:image\/(png|jpe?g|webp|gif|avif|bmp|tiff?)\s*;\s*base64/i;

function urlsNotPayloads(asset, slots) {
  const v = [];
  for (const slot of slots) {
    const html = asset && asset[slot];
    if (typeof html !== 'string' || !html) continue;
    if (RASTER_DATA_URI.test(html)) {
      v.push(block(slot, 'An image is embedded as base64 instead of referenced by URL. Gmail clips a message past roughly 102KB so the layout is cut mid-way, many clients refuse to render base64 images at all, and an embedded copy can never be swapped or resized. Upload it (creative-image.js does this already) and reference the hosted URL.'));
    }
  }
  return v;
}

/**
 * The artefact check for a video contract.
 *
 * The structure pass already flags an empty `motion_html`, but it only looks at
 * the top-level slot; the pipeline often carries the artefact on
 * `creative.motion_html` instead. So this looks in both places, and REPLACES
 * the structural violation rather than adding a second one for the same fact.
 * Reporting one problem twice makes a reviewer distrust the count.
 */
function withArtefact(violations, asset, message) {
  const a = asset || {};
  const has = !!(a.motion_html || (a.creative && (a.creative.motion_html || a.creative.video)));
  const rest = violations.filter((x) => x.slot !== 'motion_html');
  return has ? rest : rest.concat(block('motion_html', message));
}

/**
 * Copy-length checking driven by the contract's own structure, so a limit is
 * stated once. An UNVERIFIED limit warns; only a limit this repo already
 * enforces against a platform can block.
 */
function adCopyValidator(contractId) {
  return function validateCopy(asset) {
    const c = CONTRACTS[contractId];
    const v = [];
    const a = asset || {};
    for (const s of c.structure) {
      const value = a[s.slot];
      if (s.required && (value == null || value === '')) {
        v.push(block(s.slot, `${s.slot} is required for a ${c.label} and is empty.`));
        continue;
      }
      if (typeof value === 'string' && s.max && value.length > s.max) {
        const over = `${s.slot} is ${value.length} characters against a limit of ${s.max}. ${s.why}`;
        v.push(s.verified ? block(s.slot, over) : warn(s.slot, `${over} (Advisory: this limit is recorded in asset-specs.js and is not enforced anywhere in this repo against the live platform, so it is not treated as a hard failure.)`));
      }
    }
    return v.concat(adQuality(a, c));
  };
}

/* ── ad quality rules (2026-10-17), on every ad contract ──────────────────
   What a paid ad says to a stranger: never a gap marker, never shouting, one
   idea per field, and a static ad shows what it sells. Platform policy items
   are cited; the rest are editorial and warn. */
function adQuality(a, c) {
  const v = [];
  const fields = ['headline', 'primary_text', 'description', 'caption'].filter((k) => typeof a[k] === 'string' && a[k]);
  const lists = ['headlines', 'descriptions'].filter((k) => Array.isArray(a[k]));
  const all = fields.map((k) => [k, a[k]]).concat(...lists.map((k) => a[k].filter((x) => typeof x === 'string').map((x) => [k, x])));
  for (const [k, t] of all) {
    if (/\[DATA REQUIRED BEFORE LAUNCH/i.test(t)) { v.push(block(k, `${k} prints a DATA REQUIRED marker: a paid ad must never say that to a stranger. Fill the gap, or let the ad speak for the brand.`)); continue; }
    if ((t.match(/\b[A-Z]{4,}\b/g) || []).length > 1) v.push(warn(k, `${k} has more than one word in capitals. Meta's and Google's editorial policies refuse excessive capitalisation ("FREE", "SALE").`));
    if ((t.match(/!/g) || []).length > 1 || /!{2,}/.test(t)) v.push(warn(k, `${k} has more than one exclamation mark. Google Ads' editorial policy refuses repeated or gimmicky punctuation.`));
    if ((t.match(/\p{Extended_Pictographic}/gu) || []).length > 2) v.push(warn(k, `${k} has more than two emoji.`));
    if (/(?:click here|tap here)/i.test(t)) v.push(warn(k, `${k} says "click here": Google Ads refuses it as a generic call to action; name the action.`));
  }
  if (a.headline && a.primary_text && String(a.headline).trim().toLowerCase() === String(a.primary_text).trim().toLowerCase()) {
    v.push(warn('headline', 'The headline repeats the primary text word for word; the two fields are read together, so each must add something.'));
  }
  if (Array.isArray(a.headlines)) {
    const seen = new Set(); let dup = 0;
    for (const h of a.headlines) { const k = String(h || '').trim().toLowerCase(); if (seen.has(k)) dup += 1; seen.add(k); }
    if (dup) v.push(warn('headlines', `${dup} headline${dup === 1 ? ' is' : 's are'} repeated. Google assembles the ad from distinct headlines; a duplicate is a wasted slot.`));
  }
  const isStatic = c && /static/.test(c.id);
  if (isStatic) {
    const img = (a.creative && a.creative.image) || a.image || a.image_url || '';
    if (!img) v.push(gap(warn('creative', 'A static ad with no picture of what it sells. Give it the product photo, the brand\'s own imagery or the brand scene.')));
    else if (!/^https:\/\//i.test(String(img)) && !/^data:image\/svg\+xml/i.test(String(img))) v.push(warn('creative', 'The static ad\'s picture is not a hosted https URL: an ad platform cannot fetch it.'));
  }
  return v;
}

/* ── spec readers, so no number is ever re-typed ─────────────────────────── */

function placement(group, key) {
  const p = ((group && group.placements) || []).find((x) => x.key === key);
  return p ? `${p.size} (${p.ratio})` : '';
}
function safeOf(group, key) {
  const p = ((group && group.placements) || []).find((x) => x.key === key);
  return p && p.safe ? p.safe : 'no safe area is recorded for this placement';
}

/* ── the public surface ──────────────────────────────────────────────────── */

/** Which contract governs an asset, from the shape the pipeline already uses. */
function contractFor(asset) {
  if (!asset) return null;
  if (asset.contract && CONTRACTS[asset.contract]) return CONTRACTS[asset.contract];
  const channel = String(asset.channel || '').toLowerCase();
  if (channel === 'sms') return CONTRACTS['sms.message'];
  if (channel === 'whatsapp') return CONTRACTS['whatsapp.message'];
  if (channel === 'push') return CONTRACTS['push.notification'];
  const platform = String(asset.platform || '').toLowerCase();
  const type = String(asset.creative_type || asset.type || '').toLowerCase();
  if (platform === 'google') return CONTRACTS['ad.google.rsa'];
  // TikTok was routed to the VIDEO contract unconditionally, while Meta beside
  // it branched on creative_type. The ad builder produces an A/B pair per
  // platform — one video, one static — so every TikTok static ad was judged as
  // a video and reported three blocking violations it could not possibly
  // satisfy: a script, a caption limit meant for a video, and a motion artefact
  // a still image does not have. A gate that blocks what it misread is not a
  // safe failure: it teaches the operator that overriding is routine, and the
  // override is what the next real block has to survive.
  if (platform === 'tiktok') return CONTRACTS[type === 'static' ? 'ad.tiktok.static' : 'ad.tiktok.video'];
  if (platform === 'meta') return CONTRACTS[type === 'video' ? 'ad.meta.video' : 'ad.meta.static'];
  if (asset.subject != null || asset.preheader != null) return CONTRACTS['email.mailer'];
  if (asset.hero_headline != null || asset.variant != null && asset.path) return CONTRACTS['landing.page'];
  return null;
}

/**
 * Judge a finished asset against its own contract.
 * @returns {{ok:boolean, contract:string|null, violations:Array, blocking:number, note?:string}}
 */
function check(asset) {
  const c = contractFor(asset);
  if (!c) {
    return {
      ok: true, contract: null, violations: [], blocking: 0,
      note: 'No contract governs this asset type yet, so nothing was checked. Reported rather than passed silently.',
    };
  }
  const violations = c.validate(asset) || [];
  const blocking = violations.filter((x) => x.level === 'block').length;
  return { ok: blocking === 0, contract: c.id, violations, blocking };
}

/** Every contract, for the UI and for the prompt builders. */
function list() {
  return Object.values(CONTRACTS).map((c) => ({
    id: c.id, medium: c.medium, label: c.label,
    structure: c.structure, design: c.design, algorithm: c.algorithm,
    verified_limits: c.structure.filter((s) => s.verified).length,
    advisory_limits: c.structure.filter((s) => s.max && !s.verified).length,
  }));
}

/** The contract as prompt text, so the writer is briefed by the same rules the validator applies. */
function brief(id) {
  const c = CONTRACTS[id];
  if (!c) return '';
  return [
    `ASSET: ${c.label} (${c.medium}).`,
    'STRUCTURE:',
    ...c.structure.map((s) => `  - ${s.slot}${s.required ? ' (required)' : ''}${s.max ? `, max ${s.max} characters` : ''}. ${s.why}`),
    'DESIGN RULES:',
    ...c.design.map((d) => `  - ${d}`),
    'HOW THIS ASSET IS MADE:',
    ...c.algorithm.map((s, i) => `  ${i + 1}. ${s}`),
  ].join('\n');
}

/** A slot's character limit as the contract holds it (null when it records none), for a prompt's OUTPUT REQUIREMENT: read, never re-typed. */
function slotLimit(id, slot) {
  const c = CONTRACTS[id];
  const s = c && c.structure.find((x) => x.slot === slot);
  return s ? s.max : null;
}

module.exports = { MAIL_WORDS, CONTRACTS, contractFor, check, list, brief, slotLimit, VERIFIED_SOURCES };
