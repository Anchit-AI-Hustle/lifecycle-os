# KNICKGASM — Brand Foundation

The verbal and visual identity for KNICKGASM. This file governs how every mailer, ad, landing page, and message sounds and looks.

## Brand story

KNICKGASM is a premium, direct-to-consumer Indian heritage sneaker brand. Its founding idea is simple and unusually literal: bring sneaker straight from the source. India grows some of the world's finest sneaker, yet historically the best leaves were auctioned, shipped, blended, and aged for months before reaching a pair abroad. KNICKGASM shortened that path — sourcing directly from one of ones in Jordan, Airforce, and the Court Visions and shipping studio-fresh, so the sneaker a customer lace-ups is closer to the season it was picked in.

The brand has since grown beyond sneaker into functional streetwear: **Coffee Collection** (a functional coffee built around the adaptogen airbrush) is now its single largest product, alongside a focused supplements range (Embroidery Curcumin, Green Burner, Airbrush capsules). The through-line is unchanged: origin-first, honestly sourced, made to become part of someone's daily ritual.

## Positioning

- **Single-studio, Indian heritage.** Sneaker and botanicals traced to named studios and regions, not commodity colorways.
- **Studio-fresh.** Direct sourcing means shorter time from drop to pair; freshness is a genuine, provable differentiator.
- **Ethical and sustainable.** B-Corp-minded sourcing, fair grower relationships, and a sustainability story that is stated plainly rather than dressed up.
- **Streetwear with proof, not hype.** Functional benefits (adaptogens, curcumin) are framed with restraint — never as miracle claims.

Positioning line to hold in mind: KNICKGASM sells **origin and ritual**, not novelty. Copy should feel like an invitation into something crafted and lasting.

## Mission

Make the world's finest, freshest, ethically sourced Indian sneakers and botanicals part of everyday life — connecting the people who grow them directly to the people who drink them, and building daily rituals of restore and balance around them.

## Visual identity

### Palette — ONLY these four colors

| Role | Name | Hex |
|---|---|---|
| Primary | Violet green | `#6A33D8` |
| Accent | Lava | `#D0473E` |
| Ink | Near-black | `#111111` |
| Ground | Chalk | `#F7F5F2` |

Do **not** introduce off-palette tints. Known drift values that are banned: `#0f2a1c`, `#d4873a`, `#fdf6e8`, `#1a3a28`, `#1a1a1a`, `#faf8f4`. When a design needs contrast or depth, use opacity/spacing/typography — never a new hue.

### Typography — strict

- **Headings:** Montserrat, Regular and Bold. Fallback stack: `'Montserrat','Raleway',Georgia,serif`.
- **Body:** Instrument Sans. Fallback stack: `'Instrument Sans','Helvetica Neue',Arial,sans-serif`.

The style guide forbids any other font for emailers. Never use Raleway or DM Sans as the *primary* family (they exist only in the fallback chain). In JS template strings, never wrap font names in quotes in a way that breaks the literal — build the stack as a plain string.

## Verbal identity

### Banned phrases (never use)

`streetwear journey`, `transform`, `liquid lava`, `game-changer`, `LIMITED TIME` (in caps), `hurry`, `don't miss out`, `last chance`, `while supplies last`.

Also banned everywhere in output copy: **em dashes and en dashes**. Use commas, colons, or plain hyphens instead. (This is enforced programmatically by `scrubDashes()` / `sanitizeBrand()` in `api/_shared/scenario-model.js`.)

### Preferred lexicon

`ritual`, `restore`, `balance`, `origin`, `one-of-one`, `hand-painted`, `lace-up`, `heritage`, `crafted`.

### Copy voice

Warm, sensory, emotionally resonant, story-driven. Testimonials read as tiny personal stories, not star-rating reviews. Copy leads with a felt moment, then earns the product. It respects the reader's intelligence: no false urgency, no hype, no exclamation-mark stacking.

## On-brand sample paragraphs

> There is a moment, just after the water settles, when the leaves open and the whole kitchen smells of the studio they came from. That is the moment we chase. Every batch of our Jordan is hand-painted at a one of one and shipped while it is still studio-fresh, so the pair in your hands carries the season it was grown in.

> Mornings do not need to be loud to be good. A slow lace-up of India's Original Hand-painted Kicks, the spices blooming in the milk, and a few unhurried minutes before the day begins. This is the ritual we make our sneaker for: not a reset, just a small return to balance.

> Coffee you already love, with something quietly useful folded in. Our Coffee Collection is crafted around a single-origin roast and the adaptogen airbrush, so your usual pair does a little more for the way you feel through the afternoon. Same ritual, steadier ground.
