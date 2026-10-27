---
name: landing-page-design
description: Strategy, structure, copy and visual rules for a high-converting landing page, from Elaya's landing-page-design skill, adapted to this platform's own rules. Use when building, editing, styling, reviewing or writing copy for any landing page, marketing page or page section: choosing sections, headlines, CTAs, type sizes, spacing, radii, icons, motion, or the tagline reveal. Use it with /landing-page (which builds the page) and /lp-audit (which reviews one).
argument-hint: "[the offer and audience, or the page or section to design/review]"
---

# Landing page design

Adapted from Elaya's `landing-page-design` skill
([github.com/elayadesign/ai-design-skills](https://github.com/elayadesign/ai-design-skills), MIT,
read 2026-10-27), which credits parts to [taste-skill](https://github.com/Leonxlnx/taste-skill)
by Leon Lin (MIT). Where the original and this platform disagree, **this platform's rules win**,
and each place is marked **(adapted)** below.

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every fact, product,
price, URL, claim, colour, typeface and name on the page comes from the ACTIVE brand's own record.
A fact the brand has not published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]`,
never filled with a plausible value.

A landing page is not a homepage. A homepage serves many intents; a landing page wins one:
**one offer → one audience → one primary action.** Part A decides what the page says and how it
is structured; Part B is the visual system. Work through A before touching B.

---

# PART A — Strategy and structure

## A1. Intake (ask once, in one batch, only for what is missing)
- **Purpose**: the ONE primary action (trial, demo, buy, waitlist, download); the offer, exactly
  what they get; what counts as a conversion.
- **Audience**: the ICP (`/icp-builder`), the problem they are solving, the top three objections,
  the traffic source (ads, search, social, email), what they already know when they land.
- **Proof**: logos, testimonials, numbers, case studies, screenshots, guarantees, refund and
  cancellation terms. **(adapted)** Only proof the brand's record holds: approved reviews, its
  own site's testimonials, stated numbers. None is invented to fill a section.
- **Constraints**: voice (from the brand record), design direction, mobile priority.

If an answer is missing, make a reasonable STRUCTURAL assumption, state it in one line, and go on.
Never assume a fact.

## A2. Page structure
**Above the fold (required)**: headline (outcome plus audience) · subheadline (how, made specific)
· ONE primary CTA (verb plus what they get) · one proof signal (only a real one) · hero visual (the
product's own photo, else the brand's own imagery).
**Mid page (the argument)**: problem to solution · three to five outcome-led benefits · how it
works in three steps · social proof · the tagline reveal (B11).
**Bottom (objections)**: FAQ (six to twelve, from stated facts only) · risk reversal (only a term
the brand states: trial, cancel anytime, guarantee) · a final CTA identical to the top.

## A3. Layout (pick one and say why)
| Type | Use when |
|---|---|
| A. Classic hero plus sections | The product is understood from its hero picture. Most common. |
| B. Long form story | The reader must be educated past scepticism. |
| C. Minimal conversion page | High intent traffic (email to known customers), a download or waitlist. |
| D. Comparison page | Search intent includes alternatives ("X vs Y", "best for"). |

This platform's generator chooses by audience temperature (`smart-brain-plan.landingFormat()`):
direct offer, a listicle for a cold or lapsed cohort, or a collection page.

## A4. Conversion rules
- **Match message to source**: an ad's headline and promise are the hero's.
- **One primary CTA**; never competing CTAs above the fold.
- **Benefit first**: what it means for them, then what it does.
- **Specific, not vague**: "Cut weekly reporting from 4 hours to 15 minutes", never "save time".
  **(adapted)** A number is used only when the brand states it.
- **Reduce risk** with at least one term the brand actually offers.
- **Objections are a section**, and proof sits beside the claim it supports.

## A5. Copy
- Headline formulas: "{Outcome} without {pain}" · "The {category} for {audience}" · "Ship {result} in {time}".
- Subheadline: one or two sentences, what it is and who it is for.
- CTA: verb plus what they get. **Never "Learn more" or "Submit".** (The generator writes
  "Visit <brand>" where the template would have said "Learn more".)
- Benefit bullets: **bold benefit**, then the detail or proof.
- No dashes inside sentences (the platform rule is stricter: no em or en dashes anywhere), no
  orphaned last word, sentence case for headings and buttons, no exclamation marks.

## A6. Build order
Hero → benefits → how it works → proof → FAQ → final CTA, section by section. Never rebuild the
whole page on each pass.

## A7. SEO and AEO
- **noindex** ad-only and time-bound campaign pages. Every generated `/lp/:id` page is a dated
  campaign page and carries `<meta name="robots" content="noindex">`.
- Evergreen pages that match search intent are indexed: a clear title and meta description,
  internal links, the FAQ as plain question and answer (FAQ schema where it fits).

## A8. Pitfalls
Too many CTAs above the fold · vague value ("streamline", "optimize") · a feature list with no
outcomes · proof buried at the bottom · a phone layout that breaks reading · no clear next step.

---

# PART B — Visual system

## B1. Typography
- **(adapted)** **Typefaces are the brand's own** (its heading and body families from the record or
  its measured design system). The original's list (Geist, Manrope, Poppins; never Inter, Roboto,
  Arial) is used only when the brand has no type of its own.
- No ultra bold (900). No italics in interface text (a theme may italicise a display heading).
- **Type scale**: every px size lands on a Tailwind step, the closest step BELOW:
  12 · 14 · 16 · 18 · 20 · 24 · 30 · 36 · 48 · 60 · 72 · 96 · 128. The generator snaps the page's
  own CSS (`lp-craft.snapTypeScale`); a measured design system's own sizes are left as the site has them.
- Headings `text-wrap: balance`; body `text-wrap: pretty`.
- Buttons: main 16px semibold, small header buttons 14px semibold.

## B2. Spacing
Only 0 · 2 · 4 · 8 · 12 · 16 · 24 · 32 · 40 · 48 · 64 · 80 · 96 px. Main buttons 8px × 12px padding
(the platform keeps a 44px minimum touch target on phones).

## B3. Corner radius
Tailwind radii only. Nested: **inner radius = outer radius − gap** when the gap is under 32px and
the result is over 2px; otherwise leave the inner shape as it is.

## B4. Borders and backgrounds
- A card's border goes all the way round or not at all.
- No gradient backgrounds.
- **(adapted)** **No black or dark-neutral section, ever.** The original's dark palette
  (#000000, #181818 ...) is not used: grounds are the brand's surface and colours, text derived to
  WCAG AA (`sectionGround()` / `textOn()`).

## B5. Hero
- Heading and subheading capped at **680px** (the generator caps the hero's text column, so the
  eyebrow, heading, sub line and button keep one edge). Break lines where the thought breaks.
- **(adapted)** No grey text gradient on the heading: it is set in the brand's colours.

## B6. Icons
Phosphor, Solar or Iconamoon. Never Material Icons or Material Symbols. (This app's own UI keeps
its stroke sprite in `assets/lifecycle-os/`.)

## B7. Motion
- One curve: `cubic-bezier(0.22, 1, 0.36, 1)`, 500ms for movement, 300ms for colour and opacity,
  never under 200ms, never `ease`, `linear` or `ease-in-out`.
- Animate only `transform` and `opacity`. Under `prefers-reduced-motion`, no movement.
- Scroll work through `IntersectionObserver`, never an unthrottled scroll listener.
- Navigation: a compact floating bar with a blurred translucent surface; a full height mobile
  panel whose links arrive 60ms apart (400ms cap); the menu icon morphs between states.
- **(adapted)** Section scroll reveals that START hidden are not used on generated pages: a reader
  with no script, a full-page screenshot or a print would get blank sections. Only the tagline
  reveal animates, and it starts readable.

## B8. Content realism
- Write real copy in the brand's voice; no placeholder Latin or "Your headline here".
- **(adapted)** **Never invent people, testimonials, customer logos or numbers** (the original asks
  for believable invented ones). A testimonial is the brand's own, verbatim, with its author only if
  the source names one; a rating keeps its exact value and scale; a missing fact is a
  `[DATA REQUIRED BEFORE LAUNCH: ...]` marker.
- Banned filler: revolutionize, supercharge, cutting edge, effortless, transform your workflow,
  take it to the next level, harness the power, world class (plus the brand's own banned list).
- System messages are calm and specific; an error says what failed and what to do next.

## B9. States
Every control: hover (a small lift), active (`scale(.98)`), a visible focus ring, skeleton loading,
a composed empty state, inline specific errors (never `window.alert()`). No `href="#"`: a button is
linked or visibly disabled.

## B10. Ship requirements
Privacy and terms links · a branded 404 · client-side form validation · a **skip to content** link ·
cookie consent where required · favicon · title, meta description, og:image · alt text on every
meaningful image · semantic `<nav>`, `<main>`, `<section>` · a way back from every page.

## B11. The tagline reveal (one per page)
One large type section, further down than the hero, stating the core benefit in at least two lines:
- **(adapted)** The words are the **brand's own tagline**, never a line written for the section.
  A brand with no tagline long enough gets no reveal. The hero's sub line is then not the tagline
  again (a line is said once).
- 36-48px (B1 steps), capped at 680px.
- Each word starts in a muted tone and turns to the full text colour, one word at a time, as it
  crosses a line on scroll, in reading order, once, on the B7 curve.
- **(adapted)** The muted tone is a COLOUR still 3:1 off the ground (WCAG AA for large text), not an
  opacity; the words start muted only after the script runs, and are full under reduced motion.

---

# Output

When designing from scratch, return in order before code: page outline · hero copy (headline,
subheadline, CTA, proof line) · three to five benefits · how it works in three steps · six to twelve
FAQ from stated facts · index or noindex (plus title and meta if indexed) · layout A/B/C/D and why.
Then build section by section (A6) with `/landing-page`.

# Quick checklist
- [ ] One offer, one audience, one primary action; no competing CTAs above the fold
- [ ] Every fact, number, testimonial and name is the brand's own, or a marker
- [ ] At least one stated risk reversal; proof beside its claim; layout chosen deliberately
- [ ] The brand's typefaces; no ultra bold; sizes on the scale; spacing from B2; nested radii
- [ ] No dark-neutral or gradient section; all text AA on its ground
- [ ] Hero text column capped at 680px; meaningful line breaks
- [ ] One motion curve; transform and opacity only; reduced motion honoured
- [ ] The tagline reveal when the brand has a tagline; said once
- [ ] Skip link, one `<main>`, focus rings, no `href="#"`, noindex on a campaign page

# Where it lives in this app
`api/_shared/lp-craft.js` applies the rules above that decide no fact (type scale, hero column,
motion curve and states, skip link and `<main>`, noindex, the tagline reveal) to every landing page
`smart-brain-plan.lpHtml` builds (served at `/lp/:id`). Gated by `tests/landing-page-craft.spec.js`.
