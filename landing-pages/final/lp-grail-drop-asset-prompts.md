# KNICKGASM "Grail Drop" LP — Creative & Asset Prompt Book

Companion to the landing pages in this folder:

| Route | File |
|---|---|
| `/lp/agent` | `lp_all_in_one_agent_v2.html` (with the all-in-one narrate + ask voice agent) |
| `/lp/grail-drop-v1` | `knickgasm-uk-presell-grail-drop-v1.html` |
| `/lp/grail-drop-v2` | `knickgasm-uk-presell-grail-drop-v2.html` |

**The page's argument, in one line:** you keep losing the grail drop, so stop entering raffles for a
shoe ten thousand other people will also own, and have one painted that literally cannot be duplicated.

Every visual on the page maps to a numbered slot below. Each slot gives a ready-to-paste
generation prompt (image / video / icon). Drop the resulting file on a CDN and replace the
`src` in the HTML (most slots already point at live Shopify CDN URLs — these prompts let you
regenerate brand-correct replacements).

## Global brand constraints (apply to EVERY prompt)
- **Palette only:** lava red `#D0473E`, drip purple `#6A33D8`, ink `#111111`, white `#FFFFFF`.
- **Mood:** bold, street-culture, editorial, confident. NOT clinical, NOT neon, NOT stocky.
- **Subject:** sneaker buyers 18–40, UK/European, natural and un-retouched, real streets, studios and stairwells.
- **Product truth:** every shoe shown is a 100% ORIGINAL Nike / Jordan / Converse / Adidas silhouette
  with hand-painted artwork. Never generate a fake logo, a fake silhouette, or a "replica" look.
- **Typography in-image:** avoid baked-in text; the page supplies all copy. If text is unavoidable, Instrument Sans.
- **Banned visual clichés:** floating shoes on gradient blobs, price-tag graphics, fake stock smiles,
  and any health, supplement or beverage prop (this brand sells artwork on footwear, nothing else).
- **Aspect ratios** are noted per slot — generate at 2× the listed pixel size for retina.

---

## 1. Hero — "L to grail" visual  (`.bodydiag.has-hero-image`, square 1:1)
> A pair of hand-painted custom Air Force 1s held up at eye level against a white studio wall, one shoe
> turned to show the painted side panel, the owner's hands and forearms in frame, no face. Lava-red rim
> light from the left, ink shadows, white background. Editorial streetwear photography, shallow depth
> of field, confident and grounded. No text. Square crop.

## 2. Truth section — the L, in portrait  (`.truth-photo`, animated GIF, ~3:4)
> Short looping GIF: a person on a stairwell at night scrolling a phone full of resale listings, jaw set,
> then a small resigned shrug. Natural streetlight, white and ink tones, lava-red accent from a shop sign.
> Documentary feel, no captions, no readable app UI or brand marks on screen.

## 3. Failed-strategy illustration  (`.stress-illust`, portrait)
> Editorial illustration of a desk covered in the things they already tried to land a grail: raffle
> confirmation slips, a restock-alert phone, a resale invoice, a pair of stock white sneakers still in
> the box. Arranged like a quiet still life, muted white background, lava-red and drip-purple line
> accents. Hand-drawn editorial style. No text, no real brand marks.

## 4. Cycle illustration — "the grail-drop trap"  (`.cycle-illust`, square)
> A clean hand-drawn line illustration of a resale price curve that never comes back down: a rising
> jagged line on a white background, ink line, single lava-red highlight at the peak. Minimal,
> editorial, no labels.

## 5. Before / After pair  (`.crack-photo.before` + `.crack-photo.after`, each 3:4)
> Two photographs of the SAME pair of shoes, identical framing and lighting. BEFORE: a plain, unmodified
> original white low-top on a white surface, flat and anonymous. AFTER: the identical pair after our
> artist has hand-painted it, full colour artwork across the side panel and toe box. Honest and natural,
> no glamour retouching, no on-image text. This pair is the whole proof of the page: same shoe, one
> studio, one of one.

## 6. Enemy section — the brush on the leather  (`.enemy-photo`, animated GIF, 4:5)
> Looping GIF: an artist's hand drawing a fine brush line across the leather side panel of an original
> Air Force 1 clamped on a studio bench, paint pots and a palette in soft focus behind, single warm
> work light, ink background. Tactile, premium, no text, face out of frame.

## 7. Benefit icons ×6  (`.ben-card .ico-wrap img`, 44×44 line icons, lava red on transparent)
Generate as a matched set — thin lava-red (`#D0473E`) line icons, rounded, 1px-feel, transparent PNG.
Each maps to an approved brand claim, and to nothing else:
1. **100% original pair** — a shoe outline with a small verified tick.
2. **Hand-painted** — a paintbrush over a shoe profile.
3. **One of one** — the numeral 1 inside a circle, with a second faded circle crossed out.
4. **Water & scratch resistant** — a droplet deflecting off a panel.
5. **Made to order, 10 to 15 days** — a simple calendar with a brush mark.
6. **Express worldwide, 60+ countries** — a globe with a motion line.
> Prompt: "Minimal single-line lava-red icon of [X], thin even stroke, rounded corners, centred, transparent
> background, no fill, matched icon-set style." (Run once per item.)

## 8. Material cards ×5  (`.ing-card .iimg img`, ~300px PNG, transparent)
Photoreal macro cut-outs on transparent background, soft top light, lava-red radial glow behind.
These are the surfaces our artists work on, not ingredients:
1. **Original leather upper** — a clean white leather panel with visible grain and stitching.
2. **Suede overlay** — a swatch of brushed suede at a raking light angle.
3. **Canvas** — the woven canvas of a Converse-style upper, close enough to count threads.
4. **Embroidery** — a densely stitched embroidered patch, thread texture raised.
5. **Crystal work** — a cluster of hand-set crystals catching a single light source.
> Prompt: "Studio macro of [material], on pure transparent background, warm directional light,
> ultra-sharp, premium footwear-materials photography, no props, no text."

## 9. UGC video reviews ×7  (`.ugc-card video`, vertical 9:16 .mp4)
Authentic talking-head testimonials, phone-shot feel, real sneaker buyers 18–40, UK accents.
One point each, all about the product itself (captions optional, burned-in bottom-third in white):
1. "Nobody else has this pair"  2. "It's a real AF1, they just painted it"  3. "Paint held up in the rain"
4. "The unboxing genuinely got me"  5. "Worth the two-week wait"  6. "Wore them to a wedding"
7. "Second pair, gifted the first"
> Brief: "15–25s vertical UGC selfie video, street or bedroom, natural light, conversational, holding or
> wearing the pair at the end. Honest, unscripted tone."
> **Sourcing rule:** use real customer footage only. Synthetic avatars must be disclosed on screen, and
> no claim may be scripted that the customer did not actually make.
> `[DATA REQUIRED BEFORE LAUNCH: signed UGC releases, per clip]`

## 10. Finishing-pieces pack shot  (sticky bar `.pack-mini`, square)
> The three finishing pieces arranged on a white surface: a coiled set of chunky rope laces, a pair of
> custom metal lace tags, and the sneaker care kit with its brushes and bottle. Lava-red and ink accents,
> soft daylight, premium e-commerce hero. No text overlay.
> Catalog reference (UK, `data/catalog/products_uk.json`): Chunky Rope Laces For Sneakers £6.29 ·
> Lace Tags (Custom) £7.27 · Ultimate Sneaker Care Kit £13.63.

## 11. Text-only blocks (no image generation — copywriting reference)
- **Testimonials carousel** — 5 reviews, UK cities, first-name + initial.
  `[DATA REQUIRED BEFORE LAUNCH: approved review library, region UK]`. Never invent a reviewer,
  a rating, or a review count, and never move a review between products or regions.
- **Comparison table** — KNICKGASM one-of-one vs a stock retail pair vs a resale grail, 10 rows,
  ✓ / ✕ / ?. Rows must compare only verifiable attributes: originality of the base pair, how many
  exist, who made it, wait time, whether the price is set by a reseller, aftercare.
- **Featured-in** — organic wears only, no paid-endorsement or partnership implication:
  worn by Samay Raina, Rohit Sharma, Shraddha Kapoor. Do not add press logos without a licence
  `[DATA REQUIRED BEFORE LAUNCH: press logo licences]`.

---

## 12. All-in-one voice agent — scripts & behaviour  (`lp_all_in_one_agent_v2.html`)
The agent **asks the visitor up front** how they want to engage and supports **narration and interaction
together** — neither is exclusive.

**Opening question (spoken + on screen):**
> "👋 Hi, I'm your KNICKGASM guide. I can do both: narrate this page for you, and answer anything you ask, by
> text or voice. How would you like to start?"
> Buttons: **✨ Narrate & let me ask** · **🔊 Just narrate** · **💬 Just chat / talk**

**Narration walkthrough** (British voice, scrolls the page section-by-section; interruptible at any point —
typing or tapping the mic pauses it, answers, then offers "▶ Resume the walkthrough"):
1. Hero — the grail you lost was mass produced anyway; this one cannot be.
2. The L — raffles, bots, restock alerts, resale mark-ups. It is the drop model, not you.
3. Why everything failed — all of it chases a shoe that thousands of people will also get.
4. The build — a 100% original Nike, Jordan, Converse or Adidas pair, hand-painted by India's best
   artists, water and scratch resistant, one of one.
5. Proof — worn organically by Samay Raina, Rohit Sharma and Shraddha Kapoor; shipped express to
   60+ countries. `[DATA REQUIRED BEFORE LAUNCH: approved review + rating figures]`
6. Offer — the pair, its catalog price and its catalog compare-at price, plus the optional finishing
   pieces at their own prices. Painted after you order, 10 to 15 days in the studio, then express
   shipping. No invented discount, no countdown, no guarantee claim beyond published policy.
   `[DATA REQUIRED BEFORE LAUNCH: published returns/exchange policy wording]`

**Interaction knowledge base** (typed or spoken; answered in voice + text): help-me-choose, which base
silhouette, sizing, is-it-a-real-Nike, how the paint holds up, how long it takes, custom design briefs,
gifting, shipping and duties, aftercare. Voice input via Web Speech `SpeechRecognition`; voice output
via `speechSynthesis` (British female/male selectable).

**Agent guard-rails:** the agent may state only the approved brand claims and figures that exist in the
catalog file. If asked something it does not have, it says so and offers the contact route. It must never
quote a discount, a rating, a review count, a delivery date, or any health-related statement.

> ⚠️ Deploy note: the agent's microphone needs `Permissions-Policy: microphone=(self)` (set in `vercel.json`).
> Browsers also require HTTPS + a user gesture before mic/voice will start.
