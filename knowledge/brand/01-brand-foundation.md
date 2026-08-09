# KNICKGASM — Brand Foundation

The verbal and visual identity for KNICKGASM. This file governs how every mailer, ad, landing page, and message sounds and looks.

## Brand story

KNICKGASM is India's largest sneaker customiser: a premium, direct-to-consumer studio that hand-paints one-of-one artwork onto 100% original sneakers. Its founding idea is simple and unusually literal: the pair you already want, made into the only one of its kind on earth. Every commission starts as a genuine Nike Air Force 1, Air Jordan 1 Low, Dunk, Court Vision, Converse, or Adidas Samba. KNICKGASM customises originals; it never replicates a silhouette.

The work is made to order in a Mumbai studio by India's best sneaker artists and typically takes 10 to 15 days from order to dispatch. That wait is the product, not a delay. The range has grown out from painted sneakers into the surfaces around them: custom denim jackets, changeable embroidered swooshes, crystal and bling work, chunky rope laces, custom lace tags, and the Ultimate Sneaker Care Kit that keeps a finished pair looking studio-fresh. The through-line is unchanged: original base, hand-applied artwork, made for the person who will actually lace it up.

## Positioning

- **Single-studio, hand-painted in India.** Every pair is traced to a named artist and a Mumbai studio, not a print run or a factory colorway.
- **Original bases only.** The customisation sits on a 100% original Nike, Jordan, Adidas, or Converse sneaker. This is a genuine, provable differentiator against replica-based customs.
- **Made to order, one-of-one.** Nothing is stocked in duplicate. A design is painted once, for one buyer, and the 10 to 15 day build window is stated openly rather than hidden.
- **Craft with proof, not hype.** Durability claims (layered, sealed, cured; water and scratch resistant; flexes with the leather instead of cracking at the toe box) are framed with restraint. No miracle claims, ever.

Positioning line to hold in mind: KNICKGASM sells **origin and ritual**, not novelty. Copy should feel like an invitation into something crafted and lasting.

## Mission

Make hand-painted, one-of-one sneakers part of everyday life: connecting the artists who paint them directly to the people who wear them, and building daily rituals of restore and balance around a pair nobody else owns.

## Visual identity

### Palette — ONLY these four colors

| Role | Name | Hex |
|---|---|---|
| Primary | Lava red | `#D0473E` |
| Accent | Drip purple | `#6A33D8` |
| Ink | Near-black | `#111111` |
| Ground | Chalk | `#FFFFFF` |

Do **not** introduce off-palette tints. Known drift values that are banned: `#0f2a1c`, `#d4873a`, `#fdf6e8`, `#1a3a28`, `#1a1a1a`, `#faf8f4`. When a design needs contrast or depth, use opacity/spacing/typography — never a new hue.

### Typography — strict

- **Headings:** Montserrat, Regular and Bold. Fallback stack: `'Montserrat','Raleway',Georgia,serif`.
- **Body:** Instrument Sans. Fallback stack: `'Instrument Sans','Helvetica Neue',Arial,sans-serif`.

The style guide forbids any other font for emailers. Never use Raleway or DM Sans as the *primary* family (they exist only in the fallback chain). In JS template strings, never wrap font names in quotes in a way that breaks the literal — build the stack as a plain string.

## Verbal identity

### Banned phrases (never use)

`wellness journey`, `transform`, `liquid gold`, `game-changer`, `LIMITED TIME` (in caps), `hurry`, `don't miss out`, `last chance`, `while supplies last`.

> These strings are matched literally by `BANNED_RX` / `ALL_BANNED_RX` in `api/_shared/scenario-model.js`. Keep them verbatim here even where the wording reads oddly — the doc mirrors the code, not the other way round.

Also banned everywhere in output copy: **em dashes and en dashes**. Use commas, colons, or plain hyphens instead. (This is enforced programmatically by `scrubDashes()` / `sanitizeBrand()` in `api/_shared/scenario-model.js`.)

### Preferred lexicon

`ritual`, `restore`, `balance`, `origin`, `one-of-one`, `hand-painted`, `lace-up`, `heritage`, `crafted`.

> Mirrors `preferred_lexicon` in `api/_shared/brain-core.js` and the PREFERRED lists in the `api/ai/*` prompts. Do not edit here without editing those.

### Copy voice

Warm, sensory, emotionally resonant, story-driven. Testimonials read as tiny personal stories, not star-rating reviews. Copy leads with a felt moment, then earns the product. It respects the reader's intelligence: no false urgency, no hype, no exclamation-mark stacking.

## Approved brand claims

These are the only claims that may be carried into output copy. Everything else needs a source.

- Made on 100% original brand sneakers: Nike Air Force 1, Air Jordan, Dunk, Court Vision, Converse, Adidas Samba.
- Hand-painted one-of-one by India's best sneaker artists, made to order in Mumbai.
- Paint system is layered, sealed, and cured: water and scratch resistant, and it flexes with the leather.
- Typically 10 to 15 days from order to dispatch.
- Express worldwide shipping to 60+ countries.
- Worn organically by Samay Raina, Rohit Sharma, and Shraddha Kapoor.

## On-brand sample paragraphs

> There is a moment, just after the last coat cures, when the artist turns the pair under the studio light and the linework finally sits the way it did in their head. That is the moment we chase. Every KNICKGASM pair is hand-painted on a 100% original silhouette and shipped when it is ready, so the pair in your hands carries the hours that went into it.

> Mornings do not need to be loud to be good. A slow lace-up of a one-of-one Air Force 1, the rope laces pulled even, and a few unhurried minutes before the day begins. This is the ritual we paint for: not a reset, just a small return to balance.

> The sneaker you already love, with something of yours folded into it. Our coffee-ART collection lays hand-painted coffee motifs across an original base, from the cartoon-coffee Air Force 1 to the mocha-dip Adidas Sambas, so your usual pair carries a little more of you through the afternoon. Same ritual, steadier ground.
