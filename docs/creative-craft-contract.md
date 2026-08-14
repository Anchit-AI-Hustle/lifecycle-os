# Creative craft contract

The standing craft rules for everything this platform generates: landing pages,
mailers, static ads, video ads, imagery, GIFs, informative visuals and music.

`docs/campaign-orchestration-master-spec.md` governs WHAT may be said (zero
fabrication, closed source of truth, the launch gate). This governs HOW it is
built. Where the two overlap, the master spec wins.

**Nothing here names a brand.** Every colour, font, word, URL and claim comes
from the ACTIVE brand's own record — see `.claude/commands/brand-context.md`.
A rule that only works for one tenant is not in this document.

---

## 0. The brand block

Every generation prompt opens with the same block, filled from the brand record
(`data/brands/_default.json` shape) and never from memory:

```
BRAND: {{name}} — {{category}}. {{one_line_positioning}}.
       Primary market {{market}}, audience {{audience}}. Founded {{year}}, {{hq}}.
POSITIONING: {{archetype}}. {{why_credible}}.
TONE ALWAYS: {{three_adjectives}}.
TONE NEVER: {{three_anti_adjectives}}.
BANNED WORDS: {{voice.banned}}          PREFERRED WORDS: {{voice.preferred}}
SIGNATURE PHRASES: {{voice.signature}}
COLOUR — these {{n}} hex codes only, no others:
  {{hex}} — {{role}}   (one line per colour, role stated)
CONTRAST RULE: every text/background pair clears WCAG AA (4.5:1 body,
  3:1 large display). Name the pairs that pass. A pair that fails is restricted
  to large display, badges and icons — never body copy.
TYPOGRAPHY: headings {{display_font}} {{weights}}; body {{body_font}} {{weights}};
  eyebrow {{body_font}} {{size}}, {{tracking}}, uppercase.
URLS: {{regions[].store_url}}           SOCIAL: {{social}}
EVIDENCE RULE: every claim traces to supplied catalog, review or sourcing data.
  No invented numbers, awards or certifications. A number not supplied is a
  number not written.
```

Two properties are load-bearing and must not be softened:

- **A colour carries a ROLE, not just a value.** "Ink is body copy and dark type
  only, never a background" is what stops a dark-on-dark section. Roles come
  from `brand-workspace-core.tokens()`; `validatePalette()` blocks activation on
  dark-neutral surfaces or sub-AA contrast.
- **`voice.banned` is never machine-filled.** A brand's prohibitions are its
  own; a generated ban list is an invented brand fact.

Absent fields are written `[DATA REQUIRED BEFORE LAUNCH: field, product,
region]`. Never filled with a plausible value, never with another tenant's.

---

## 1. Landing pages

**Structure**, in order, no extra sections: announcement bar → sticky header
(single-row nav; horizontal scroll with arrow affordances rather than a second
row) → hero → 3-benefit value bar → the evidence section → how it works (3
numbered steps) → social proof → offer block → 5-question FAQ answering the five
real objections for this cohort → final CTA + footer.

**Motion law.** These are the rules that keep a reveal from eating the copy:

- Opt-in only, via data attributes. Never a bare tag or universal selector.
- **Transforms and opacity only.** No `clip-path`, no `mask-image`, no position
  changes — they clip copy and cause section overlap.
- The hidden state is written **by JS at runtime**, so with JS disabled the page
  renders fully readable at full opacity.
- **Touch parity**: where desktop uses hover or cursor parallax, mobile uses
  scroll position and `IntersectionObserver`. A hover-only reveal is content
  that does not exist on a phone.
- `@media (prefers-reduced-motion: reduce)` reveals everything instantly.

**Hard rules.** The brand's hex codes only. Mobile-first, 44px minimum hit
targets, no horizontal scroll at 360px (`minmax(min(Xpx,100%),1fr)`). Real URLs
— no `href="#"`, no lorem. No placeholder images: an unsupplied image is a
labelled empty slot stating what belongs there. `width`, `height`, `loading` and
`alt` on every image.

**Output**: the HTML file · a contrast table (element, foreground, background,
ratio, pass/fail) · an asset manifest (slot, subject, aspect ratio, pixel size)
· a change log.

---

## 2. Mailers

**Structure**: hidden preheader (extends the subject, never repeats it) →
announcement bar → brand header → trust badges → hero (editorial split for
offer-led, narrative full-width for story-led) → 4-cell benefit strip matched to
the campaign type, not boilerplate → product section (1 centred / 2 columns /
3–4 grid stacking to one column on mobile) → social proof → full-bleed lifestyle
image → specific offer bar → final CTA → footer with unsubscribe.

**Email HTML law.** 600px max width. **Tables only**, `role="presentation"`,
`cellpadding=0 cellspacing=0 border=0`. All CSS inline. `bgcolor` alongside
`background`. `width` attribute plus `display:block` and `border:0` on every
image. MSO conditional comments and VML buttons for Outlook. Mobile stacking
classes. **No** div layouts, flexbox, grid, CSS variables, external stylesheets,
JavaScript, SVG or `position:absolute`. No `href="#"`. UTM parameters on every
link, pointing at the market-correct domain.

**Motion**: clients strip animation. An animated GIF for the hero only, under
1MB, with a legible first frame — Outlook shows only that frame, so it must
carry the whole message.

**Output**: JSON with `subject_lines` (3, under 60 chars: one sensory, one
benefit-led, one curiosity or offer — no punctuation spam, no fake urgency),
`preheader`, `sections`, `cta_options` (3, max 3 words), `performance_notes`,
`html`, and a **`qa` checklist marked pass/fail per line**.

---

## 3. Static ads

Five concepts, each stating: angle in one sentence · hook (max 7 words) ·
support (max 12 words) · CTA (max 3 words) · layout and reading order · colour
assignment **with contrast ratios** · asset spec (subject, crop, pixel size).

Sizes 1080×1080, 1080×1350, 1080×1920, 1200×628 — **type re-set per size, never
letterboxed**. Type under 20% of frame. Hook readable at 15% zoom. One idea per
frame. Price and code only when supplied. Safe zones respected.

**Output**: 5 concepts · copy deck · asset manifest · contrast table.

---

## 4. Video ads

Three scripts as shot tables: timecode, visual, on-screen type, voiceover, sound
design, motion.

**Structure**: 0–2s hook stating the *tension*, not the brand → 2–5s the problem
in the audience's own words → 5–10s the mechanism **shown, not claimed** →
10–20s verbatim attributed proof → final 3s offer, CTA, wordmark.

**Craft**: legible muted, burned-in captions. Cuts on the audio beat, none over
2.5s in the first 10s. Motion is camera and product, **not flying type**. 9:16
master with specified 1:1 and 16:9 reframes. The first frame carries the hook
and doubles as the thumbnail.

**Output**: 3 shot tables · an SRT per script · reframe notes · asset manifest ·
audio brief.

---

## 5. Imagery, GIFs and informative visuals

**Prompt skeleton**: subject, material detail, setting, light direction and
quality, camera and lens, depth of field, palette named by hex ROLE, mood,
photographic, no text, no logo.

**Negative prompt**: text, watermark, logo, lettering, extra fingers, plastic
sheen, HDR halo, oversaturation, teal-orange grade, stock-photo smile, neon,
lens flare.

**The reality rule** — enforced in `api/_shared/image-prompt.js` (`NEVER`):

> Never render invented proof (ratings, review counts, award badges, price tags,
> certification marks, garbled lettering), and never *depict* the real things
> either — the brand's actual retail packaging, or a named or identifiable
> person. Those are photographed, not generated. A brief that needs one gets a
> labelled empty slot naming the shot required.

The two halves fail differently and both matter. An invented certification is a
fact nobody stated; a generated rendering of real packaging is a plausible fake
of a real object. A generator asked for either will produce something rather
than refuse, which is exactly why the refusal lives in the prompt.

**GIFs**: under 1MB, 12–18 frames, 2–4s seamless loop, first and last frame
matching, one movement only. The first frame carries the whole message.

**Informative visuals**: one takeaway per graphic, stated as the title. Chart
type follows the data (comparison → bars, composition → stacked, change over
time → line, process → numbered steps). **Position and length encodings only** —
no 3D, no shadows on data, no gradient bars. Primary hex is the data colour;
the accent highlights the one series that matters. Direct labels over legends.
Zero baseline for length encodings. Units and a source line always present.
Minimum 12pt print, 24px slide, 14px web.

---

## 6. Music and sonic identity

Four cuts, each with a generation prompt, a timecoded structure map and platform
notes: a 3s sonic logo usable as an end-stamp · a 15s ad bed (hook at 0s, lift
at 5s, resolve on the CTA frame) · a 30s loopable reel bed with a clean 15s edit
point · a 90s+ seamless long-form bed mixed to sit under voiceover.

**Prompt skeleton**: tempo BPM, mood, instrumental, lead over accompaniment,
percussion and sparsity, harmonic centre, room character, arc, no vocals, no
{{banned sonic elements}}.

**Mix**: −14 LUFS integrated, true peak −1 dBTP, one master for all platforms.
Stems for bed, percussion and accent. Voiceover ducks 6 dB by automation. Mono
fold-down check. The edit lands on visual beats so the cut reads muted.

**Rights**: generated or licensed only, licence recorded, **no interpolation of
existing recordings or artist styles**. State provenance per cut. Tenant zero's
audio beds are never lent to another brand — `video-core.audioBedFor()` returns
a marker instead.

---

## Where this is enforced

| Rule | Enforced by |
|---|---|
| Palette roles, AA contrast, no dark-neutral surface | `validatePalette()`, `tests/contrast-rendered.spec.js` |
| No tenant-zero vocabulary on an app surface | `npm run audit:pages` (`tenant-zero-vocabulary`), `tests/brand-nouns.spec.js` |
| No foreign brand names or figures | `npm run check:foreign` |
| Assets come from the brand's own catalogue or not at all | `brand-catalog-server.js`, `npm run test:isolation` |
| Imagery invents no proof and depicts no real packaging or person | `api/_shared/image-prompt.js` (`NEVER`) |
| Every skill resolves the active brand first | `npm run check:skills` |
| DESIGN.md conforms to the open spec | `npm run check:designmd` |

A rule in this document with no row in that table is a rule that will rot. When
adding one, add its check.
