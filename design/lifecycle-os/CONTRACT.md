# The Lifecycle OS surface contract

Every screen in Lifecycle OS is built from this file. It says, for every surface the app draws,
which token paints its ground, its text and its edge, and where that token's value comes from.
The values are the ACTIVE brand's: `brand-context.js` writes the `--brand-*` set that
`tokens()` derives (`api/_shared/brand-workspace-core.js`) onto `<html>`, and `theme.css`
resolves every `--vh-*` role through it. A page that follows this table re-skins to any brand
and stays readable for any palette `validatePalette()` accepts.

The operator's words (2026-10-05), on a screenshot of `/studio` with a red-primary brand active:
red side bands, dark brown and black panels, near-black prompt cards with dark grey text:
*"unreadable & keep theme of each page also when brand setup done as the brand theme"*. Each of
those is a page choosing its own colour instead of a role from this table.

Gated by `tests/design-system.spec.js` (executed: `/design-system` rendered in Chromium under the
six palettes in `palettes.json`, every text run measured against the pixels actually painted
behind it).

## The three rules

1. **No section ground is a dark neutral.** `isDarkNeutral()`: relative luminance under 0.12 and
   saturation under 0.25. A brand-coloured section paints `--vh-band`, which is
   `sectionGround(primary, accent, surface)`: the primary, else the accent, else the brand's own
   surface. A near-black primary therefore never becomes a black section. A **control** may be dark
   (a near-black brand gets a near-black primary button, as on its own site); a section may not.
   A scrim is not a section: it is `--vh-ink` at an opacity over the page it dims.
2. **Every text/ground pair meets WCAG AA for any palette** (4.5:1; 3:1 at 24px, or 18.66px bold;
   3:1 for focus rings and the dots that carry state). That holds by construction only if text is
   **derived for its ground**:
   - brand-coloured text uses a `*-text` token (`--vh-primary-text`, `--vh-accent-text`,
     `--vh-ok-text`, `--vh-warn-text`, `--vh-err-text`), each `readableAsText(colour, worst
     surface, TEXT_AA)` with `TEXT_AA = 4.9`, and only on the grounds it was adjusted for:
     `--vh-bg`, `--vh-panel`, `--vh-panel-2`;
   - text on a brand fill uses an `on-*` token: `--vh-on-primary` on `--vh-primary`,
     `--vh-on-band` on `--vh-band`;
   - on a tint (`--vh-tint`, `--brand-primary-soft`) only `--vh-ink`;
   - never `color: var(--brand-primary)` / `var(--brand-accent)` / `var(--vh-err)`: those are
     fills and edges.
3. **No colour literal in a component rule.** Every colour in a component is a token. A literal is
   a colour the file decided for itself, which is how one tenant's red reached every other
   tenant's rail. The only literals in the system are the mark's three neutrals (an SVG favicon
   cannot read the page) and the generated `BRAND-SYNC` fallbacks in `theme.css`.

**The app is light-only by design.** The ground is the brand's validated light surface
(`validatePalette()` refuses a dark-neutral surface), so there is no dark theme to switch to, and
none is defined here. Depth, motion and precision on the light surface carry the "futuristic"
character (the ambient field, frosted cards, the energy line), never a black console.

## How a page uses it

- Ground: `background: var(--vh-bg)` for the page, `var(--vh-panel)` for a panel,
  `var(--vh-panel-2)` for a sunken one, `.vh-band` for a brand section. Never a hex, never
  `--brand-primary` on a section.
- Text: `var(--vh-ink)`, `var(--vh-ink-dim)`, `var(--vh-heading)`, a `*-text` token, or the
  `on-*` token of the fill it sits on.
- Edges: `var(--vh-line)`, `var(--vh-line-hot)`, `var(--vh-accent)` (ordinary state),
  `var(--vh-warn)` (fix-it), `var(--vh-err)` (failure).
- Components: the `.vh-*` kit in `theme.css` (`/design-system` shows every one live). A page's
  own class may restyle layout freely; its colours come from this table.
- Legacy names keep working: `brand-context.js` maps `--ink`, `--bg`, `--panel`, `--line`,
  `--accent`, `--chalk` (= `--brand-on-primary`, text on a band) and the rest onto the brand
  tokens, and `--brand-font-heading` onto `--brand-font-head`. `--vh-ink-faint` is now an alias of
  `--vh-ink-dim` (a third, fainter step could not be AA for every palette).

## Derived tokens, and the function that computes each

| Token | Computed by | Guarantee |
|---|---|---|
| `--brand-on-primary` | `readableOn(primary, ink, surface, surface_alt)` | validatePalette blocks activation under 4.5:1 |
| `--brand-primary-text`, `--brand-accent-text`, `--brand-ink-muted` | `readableOnSurfaces(c, [surface, surface_alt], TEXT_AA)` | 4.9:1 on BOTH surfaces |
| `--brand-ok-text`, `--brand-warn-text`, `--brand-err-text` (NEW) | `readableOnSurfaces(state, [surface, surface_alt], TEXT_AA)` | 4.9:1 on both surfaces, so a state word or dot is readable |
| `--brand-surface-sunken` (NEW) | `sunkenSurface()`: the darker surface, darkened in 0.5% steps (cap 4%) while every text token keeps 4.5:1 | every text token is AA on the sunken panel |
| `--brand-band`, `--brand-band-accent` (NEW) | `sectionGround(primary, accent, surface)` / `sectionGround(accent, primary, surface)` | never a dark neutral |
| `--brand-on-band`, `--brand-on-band-accent` (NEW) | `textOn(band, surface, ink, TEXT_AA)`, walking both directions | 4.9:1 on the band, or 4.5:1 on a mid-tone band where 4.9 is unreachable (the best any colour reaches there is about 4.58:1) |
| `--brand-focus` (NEW) | `readableOnSurfaces(accent, [surface, surface_alt], 3)` | 3:1 non-text on both surfaces |

Two derivations changed here, each found by an EXECUTED sweep of 4,000 random valid palettes
(`tests/design-system.spec.js`), each mutation-verified: text tokens used to be tuned against
whichever surface the RAW primary read worse on, so a near-white primary on a tinted page left its
text at 4.28:1 on the page itself (`readableOnSurfaces()` holds both; 5,922 failing pairings without
it); and `textOn()` walked one way only, so on a mid-tone band it returned a failing white (947
failing pairings; it now walks both ways). The NEW tokens
are emitted by `contractTokens()` on the server and `contractTokensFor()` in `brand-context.js`
(the device path); the device/server parity test diffs every key. `scripts/brand-sync.js` writes
tenant zero's values of the same set into `theme.css` as the no-brand fallback.

## Known limits, said rather than hidden

- **No brand active means tenant zero's palette.** `theme.css` falls back to the shipped default
  record (`BRAND-SYNC`), the long-standing design. The platform's own identity (mark, wordmark,
  tab icon) is neutral and never a tenant's; the app's colours with no brand are the default
  record's.
- **A record with no palette** is painted with `tokens()`'s own fallbacks (primary `#6A33D8`,
  surface `#F7F5F2`). Such a record cannot be activated, but is painted while a draft is built;
  `#6A33D8` is also tenant zero's accent. Changing that fallback is a decision for the brand layer,
  recorded here, not made here.
- **The rendered gate measures one page.** `/design-system` exercises every component under six
  palettes; the other screens are held to the same table by the screens work and by
  `contrast-rendered.spec.js`.

<!-- >>> DESIGN-SYSTEM:generated by scripts/build-design-system.js, do not edit by hand -->
### Surface to token

| Surface | Ground | Text | Edge / line | Shipped in |
|---|---|---|---|---|
| Page ground | vh-bg | vh-ink; secondary vh-ink-dim | none | every page body |
| Panel / card (opaque) | vh-panel | vh-ink; vh-ink-dim | vh-line | .panel, .vh-modal, .vh-empty |
| Raised card | vh-glass over the ambient field | vh-ink; vh-ink-dim | vh-line (hover vh-line-hot); 2px energy line vh-primary to vh-accent | .vh-card, .card, .tile, .kpi (futuristic layer) |
| Sunken panel | vh-panel-2 | vh-ink; any *-text token | vh-line | .vh-status, .vh-failure, .vh-notice, hover rows, mark tile |
| Brand band (section) | vh-band | vh-on-band | none | .vh-band; never var(--brand-primary) on a section |
| Accent band (section) | vh-band-accent | vh-on-band-accent | none | .vh-band-accent |
| Rail | vh-bg (never frosted) | rows vh-ink-dim, hover vh-ink, section labels vh-ink-dim | right edge vh-line | auth.js #lifecycle-nav |
| Rail: active row | vh-primary | vh-on-primary | none | .lnav-link.active |
| Rail: active group | vh-panel-2 | vh-primary-text | inset 3px vh-primary | .lnav-group.active-group .lnav-ghead |
| Chip | vh-panel | vh-ink-dim | vh-line | .vh-chip |
| Chip: selected | vh-primary | vh-on-primary | vh-primary | .vh-chip[aria-pressed=true], .rgn-chip[aria-pressed=true] |
| Badge | vh-panel | vh-accent-text | vh-line | .vh-badge |
| Status chip | vh-panel | vh-ink; dot vh-ok-text / vh-warn-text / vh-err-text / vh-focus | vh-line (error: vh-err-text) | .vh-state[data-state] |
| Button: primary | vh-primary (hover brand-primary-dark) | vh-on-primary | vh-primary | .vh-btn-primary (= .vh-btn-solid, .vh-btn-green) |
| Button: secondary | vh-panel | vh-primary-text | vh-line-hot | .vh-btn-secondary |
| Button: ghost | transparent (hover vh-panel-2) | vh-ink | vh-line (hover vh-line-hot) | .vh-btn-ghost |
| Input | vh-glass-strong over vh-panel-2 | vh-ink; placeholder vh-ink-dim | vh-line; focus ring vh-focus | .vh-input, .vh-select, .vh-textarea |
| Table | header vh-glass-strong; rows transparent, hover vh-panel-2 | th vh-ink-dim; td vh-ink | vh-line; header rule vh-line-hot | .vh-table |
| Modal | vh-panel over a scrim of vh-bg at .78 opacity | vh-ink | vh-line; elevation vh-lift-2 | .vh-modal, .vh-modal-backdrop, the ? info panel |
| Toast | vh-panel | vh-ink | inset 3px vh-accent (error vh-err-text) | .vh-toast |
| Notice bar | vh-panel-2 | vh-ink | top rule vh-accent (ordinary) or vh-warn (fix-it) | auth.js #lc-authnotice, .vh-notice |
| Status line | vh-panel-2 | vh-ink | left 4px vh-accent | LifecycleStatus, .vh-status |
| Failure frame | vh-panel-2 | message vh-ink; tag vh-err-text; code vh-ink-dim | left 4px vh-err | LifecycleFailure, .vh-failure |
| DATA REQUIRED marker | vh-marker-ground | vh-ink (mono) | dashed vh-marker-edge | .vh-marker, .vh-marker-block |
| Credit pill | vh-panel | vh-ink; dot vh-primary / vh-warn-text / vh-err-text | vh-line | credits.js .lc-credit-pill, .vh-credit |
| Local / Demo Mode | vh-panel-2 | vh-ink | inset 3px vh-accent | auth.js #lnav-umode, .vh-mode |
| Wizard step | vh-panel (current vh-primary) | vh-ink-dim (done vh-primary-text, current vh-on-primary) | vh-line (done vh-primary-text) | onboarding.html .step-pip, .vh-step |
| Skeleton | vh-panel-2 with a vh-glass-edge shimmer | none | none | .vh-skeleton |
| Empty state | vh-panel | title vh-heading; text vh-ink-dim; art vh-ill-* | dashed vh-line-hot | .vh-empty |
| Focus ring | none | none | outline 2px vh-focus + vh-glass-strong halo | :focus-visible |
| Link | none | vh-link, underlined | none | .vh-link, .vh-prose a |
| Heading | none | vh-heading in vh-font-head | none | .vh-h1, .vh-h2, .vh-h3 |
| Eyebrow / metadata | none | vh-accent-text (eyebrow) or vh-ink-dim, in vh-font-mono | none | .vh-eyebrow, .vh-section-label |
| Divider | gradient vh-fx-primary to vh-fx-accent at .38 | none | none | .vh-divider, hr |
| Chart | none | labels vh-ink; axis vh-ink-dim | grid vh-line | series vh-chart-1 to vh-chart-4 |

### App tokens (`--vh-*`) and the brand token each resolves through

| App token | Resolves through | Use |
|---|---|---|
| `--vh-bg` | `--brand-surface` | Page ground; the rail. |
| `--vh-panel` | `--brand-surface-alt` | Opaque panel, card, modal, input on a sunken ground. |
| `--vh-panel-2` | `--brand-surface-sunken` | Sunken panel (also --vh-sunken). |
| `--vh-band` | `--brand-band` | Brand-coloured section (.vh-band). |
| `--vh-on-band` | `--brand-on-band` | Text on a brand band. |
| `--vh-band-accent` | `--brand-band-accent` | Accent section (.vh-band-accent). |
| `--vh-on-band-accent` | `--brand-on-band-accent` | Text on an accent band. |
| `--vh-tint` | `--brand-primary-tint` | Decorative tint; ink text only. |
| `--vh-ink` | `--brand-ink` | Body text, icons. |
| `--vh-heading` | `--brand-ink` | Headings (via --vh-ink), in --vh-font-head. |
| `--vh-ink-dim` | `--brand-ink-muted` | Secondary text. --vh-ink-faint is an alias of it now. |
| `--vh-primary-text` | `--brand-primary-text` | Primary as text. |
| `--vh-link` | `--brand-primary-text` | Links (via --vh-primary-text). |
| `--vh-accent-text` | `--brand-accent-text` | Accent as text: eyebrows, badges. |
| `--vh-ok-text` | `--brand-ok-text` | Success as text, status dots. |
| `--vh-warn-text` | `--brand-warn-text` | Warning as text, the marker edge. |
| `--vh-err-text` | `--brand-err-text` | Error as text: the failure tag. |
| `--vh-primary` | `--brand-primary` | Primary control fill. |
| `--vh-on-primary` | `--brand-on-primary` | Label on a primary fill. |
| `--vh-accent` | `--brand-accent` | Ordinary-state edge, rules, energy line. |
| `--vh-on-accent` | `--brand-on-accent` | Label on an accent fill. |
| `--vh-ok` | `--brand-ok` | Success fill or edge. |
| `--vh-warn` | `--brand-warn` | Warning fill or edge (fix-it notice rule). |
| `--vh-err` | `--brand-err` | Error edge (failure frame). |
| `--vh-line` | `--brand-line` | Hairlines and borders. |
| `--vh-line-hot` | `--brand-line-strong` | Emphasised borders, hover. |
| `--vh-focus` | `--brand-focus` | Focus ring. |
| `--vh-chart-1` | `--brand-primary` | Chart series 1. |
| `--vh-chart-2` | `--brand-accent` | Chart series 2. |
| `--vh-chart-3` | `--brand-ink-muted` | Chart series 3. |
| `--vh-chart-4` | `--brand-primary-dark` | Chart series 4. A fifth series labels directly instead. |
| `--vh-marker-ground` | `--brand-surface-sunken` | The DATA REQUIRED marker ground. |
| `--vh-marker-edge` | `--brand-warn-text` | The DATA REQUIRED marker edge. |

### Brand tokens (`--brand-*`) and how `tokens()` derives each

| Brand token | Derivation | Use |
|---|---|---|
| `--brand-primary` | palette.primary | The brand colour as a FILL: primary button, selected chip, active rail row. May be dark (a control). |
| `--brand-primary-dark` | shade(primary, -0.25) | Hover state of a primary fill. Never text. |
| `--brand-primary-soft` | shade(primary, 0.86) | Text selection, soft tints. Only ink text on it. |
| `--brand-primary-tint` | shade(primary, 0.94) | Illustration ground, decorative tint. Only ink text on it. |
| `--brand-on-primary` | readableOn(primary, ink, surface, surface_alt) | Text and icons ON a primary fill. validatePalette() blocks activation below 4.5:1. |
| `--brand-primary-text` | readableOnSurfaces(primary, [surface, surface_alt], TEXT_AA) | The primary AS TEXT: links, active labels, a selected step. Never write var(--brand-primary) as a text colour. |
| `--brand-accent` | palette.accent, else primary | Edges and rules for ordinary states, the energy line, the ambient field. Never text. |
| `--brand-accent-soft` | shade(accent, 0.88) | Illustration soft fill. |
| `--brand-on-accent` | readableOn(accent, ink, surface, surface_alt) | Text on an accent fill (rare; prefer the band tokens). |
| `--brand-accent-text` | readableOnSurfaces(accent, [surface, surface_alt], TEXT_AA) | The accent AS TEXT: eyebrows, badges, the info panel eyebrow. |
| `--brand-ink` | palette.ink | Body text, headings, icons. |
| `--brand-ink-muted` | readableOnSurfaces(palette.muted or shade(ink, .35), [surface, surface_alt], TEXT_AA) | Secondary text. Never under AA: muted is still text. |
| `--brand-surface` | palette.surface | Page ground and the rail. validatePalette() refuses a dark neutral. |
| `--brand-surface-alt` | palette.surface_alt, else shade(surface, 0.6) | Panels and cards. |
| `--brand-surface-sunken` | sunkenSurface(): the darker surface, darkened while every text token keeps 4.5:1 | Sunken panel: status line, failure frame, notice bar, hover rows, the mark tile. |
| `--brand-line` | shade(ink, 0.84) | Hairlines, card and input borders. |
| `--brand-line-strong` | shade(ink, 0.68) | Emphasised borders: hover, table header rule, the ? chip ring. |
| `--brand-band` | sectionGround(primary, accent, surface) | A brand-coloured SECTION ground. Never a dark neutral: a near-black primary falls through to the accent, then the surface. |
| `--brand-on-band` | textOn(band, surface, ink, TEXT_AA): both directions, the 4.5 floor on a mid-tone band | Text on --brand-band. |
| `--brand-band-accent` | sectionGround(accent, primary, surface) | The accent as a section ground (announcement strip). |
| `--brand-on-band-accent` | textOn(band-accent, surface, ink, TEXT_AA) | Text on --brand-band-accent. |
| `--brand-ok` | palette.ok, else the code default | Success fill, edge or dot. Never text. |
| `--brand-warn` | palette.warn, else the code default | Warning fill or edge (the fix-it notice rule). Never text. |
| `--brand-err` | palette.err, else the code default | Error edge (the failure frame). Never text. |
| `--brand-ok-text` | readableOnSurfaces(ok, [surface, surface_alt], TEXT_AA) | A success word, a status dot. |
| `--brand-warn-text` | readableOnSurfaces(warn, [surface, surface_alt], TEXT_AA) | A warning word, the marker edge. |
| `--brand-err-text` | readableOnSurfaces(err, [surface, surface_alt], TEXT_AA) | The failure tag, an error word. |
| `--brand-focus` | readableOnSurfaces(accent, [surface, surface_alt], 3) | The keyboard focus ring: the accent held to the 3:1 non-text minimum. |

### The derived tokens, computed for every gate palette

| Palette | `primary` | `on-primary` | `primary-text` | `accent-text` | `ink-muted` | `surface-sunken` | `band` | `on-band` | `err-text` | `focus` |
|---|---|---|---|---|---|---|---|---|---|---|
| Lifecycle OS neutral | `#24292e` | `#ffffff` | `#24292e` | `#24292e` | `#66696b` | `#ebecee` | `#ffffff` | `#24292e` | `#c0392b` | `#24292e` |
| Example brand (tenant zero) | `#d0473e` | `#ffffff` | `#c6433b` | `#6a33d8` | `#666666` | `#f5f5f5` | `#d0473e` | `#ffffff` | `#c0392b` | `#6a33d8` |
| Red primary, deep brown accent | `#c8102e` | `#ffffff` | `#c8102e` | `#5b3a29` | `#6d6a68` | `#f5eee8` | `#c8102e` | `#ffffff` | `#c0392b` | `#5b3a29` |
| Pale primary and accent | `#f3b6b1` | `#1a1a1a` | `#866461` | `#606e7b` | `#6e7072` | `#f5f5f5` | `#f3b6b1` | `#1a1a1a` | `#926460` | `#7c8f9f` |
| Near-black primary | `#16161a` | `#ffffff` | `#16161a` | `#2b2b30` | `#646464` | `#eeeeef` | `#ffffff` | `#111111` | `#c0392b` | `#2b2b30` |
| Bare brand (no palette) | `#6A33D8` | `#fcfbfa` | `#6a33d8` | `#6a33d8` | `#646464` | `#edebe8` | `#6a33d8` | `#f7f5f2` | `#c0392b` | `#6a33d8` |

<!-- <<< DESIGN-SYSTEM:generated -->
