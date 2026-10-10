# The brand schema

What a brand IS to Lifecycle OS: one record per brand workspace, every field of it, where each
value may come from, which features read it, and what happens when it is missing. Read from the
code that holds it: the shape is `buildRow()` and the `normalize*()` functions in
`api/_shared/brand-workspace-core.js` (mirrored line for line by `buildDeviceRow()` in
`brand-context.js` for a brand kept on the device), tenant zero's record is
`data/brands/_default.json`, and `brand-runtime.normalizeBrand()` lifts the overflow fields out of
`brand_data`.

The design system's colours and type are DERIVED from this record (`CONTRACT.md`); nothing on a
screen is typed per brand.

## The record

| Field | Shape and normalisation | Read by | When missing |
|---|---|---|---|
| `id` | uuid (database), `local-*` (this device), `device:<hash>` (a record a phone sign-in carried to the server) | every scoped read; the device store key | n/a |
| `slug` | `slugify(name)`, 48 chars. A carried record's slug is its device id, so it can never claim to be tenant zero | `isTenantZero` (by slug), presets | derived from the name |
| `name` | text, 120 chars, **required** (save refuses without it) | the rail's brand slot and title, `relabel()`, the brand block every generator is briefed with, mailer and page footers | save refused; readiness `[DATA REQUIRED BEFORE LAUNCH: brand name, this brand]` (blocking) |
| `legal_name` | text, 200 | legal footers | omitted |
| `tagline` | text, 300 | brand block, DESIGN.md description, the onboarding review | omitted |
| `industry` | text, 120 | brand block, competitor discovery, Growth OS | omitted |
| `website` | http(s) URL | the context pack key (`host + folded name`), Read my site, the brand block | readiness marker `brand website` |
| `logo_url` | http(s) URL | the rail's brand slot (`fillBrandSlot`, else a monogram), the brand block's LOGO line, mailers and pages. **Never** the tab icon | readiness marker `logo URL`; generated assets carry the marker in the logo's place |
| `favicon_url` | http(s) URL | kept on the record; the tab icon is the PLATFORM's and never this | omitted |
| `palette` | `{primary, accent, ink, surface, surface_alt, muted, ok, warn, err, extra[]}`, each `normHex`; `extra` up to 12 `{name, hex}` | `tokens()` (every `--brand-*`), `validatePalette()`, the brand block's PALETTE line | ACTIVE requires a palette that passes `validatePalette()` (primary, ink, surface present; no dark-neutral surface; ink and on-primary AA); a draft may be incomplete and is painted from `tokens()`'s fallbacks |
| `typography` | `{heading, body, mono}` each `{family, stack, google, weights, src?, format?}`; the stack is only ever the brand's own family plus a generic fallback; `src` only for a self-hosted https file | `--brand-font-head/body/mono`, `fontsHref()` (Google Fonts), `@font-face` for a hosted file, the brand block | readiness markers `typography.heading`, `typography.body` (blocking); the shell falls back to `tokens()`'s stacks |
| `voice` | `{tone, preferred[], banned[], no_em_dashes (default true), notes}` | the brand block every writer is briefed with; `sanitizeBrand` / compliance lint scrub banned phrases and dashes | readiness markers `voice.tone`, `voice.banned phrases`; **`banned` can never be machine-filled** |
| `regions` | up to 24 `{code, currency, symbol, store_url, pdp_pattern, collection_pattern, home}`; exactly ONE `home:true` (a second flag is dropped) | `RegionContext` (every market control opens on `home`), store URLs, currency, the brand block's REGIONS line | readiness `regions` (blocking), `home market`, `region store URL, <brand>, <code>`, `region currency, <brand>, <code>`; never promoted from row one |
| `asset_hosts` | host list; every region's store host is added | asset provenance allowlist | derived from the regions |
| `catalog_source` | `{kind, url, ...}` | catalogue import and its re-runs | readiness `product catalog` when the catalogue has 0 rows (blocking) |
| `status` | `draft` / `active` / `archived` | activation paints the shell | `draft` |
| `onboarding_step` | 1 to 6 | the wizard resumes there | 1 |
| `brand_data` | object, the overflow (below) | see below | `{}` |

### `brand_data`, the overflow

`brand-runtime.normalizeBrand()` lifts `offerings`, `claims`, `market_study`, `legal_entity`,
`contact`, `social` and `asset_hosts` onto the brand when the column is empty; a real column always
wins.

| Key | Holds | Read by |
|---|---|---|
| `claims[]` | the only statements an asset may present as fact | the brand block's VERIFIABLE CLAIMS line; without them a generator writes no proof line at all |
| `offerings[]` | `{kind, name, url}` records | planning, landing pages, Growth OS |
| `legal_entity`, `contact`, `social[]` | footer identity | mailer and page footers (CAN-SPAM sender identity) |
| `market_study` | sizing, tiers (with `brands[]`), reads, gaps | Market Study pages; the competitor universe seed |
| `competitors[]` | named competitors | `competitor-universe.seedForWorkspace()`; none named gives a marker, never another brand's list |
| `design_system` | the brand's own measured components (button and card radius per viewport) | `componentTokens()`: `--brand-radius-control`, `--brand-radius-card` |
| `brand_files` | references to uploaded files: `{logo, favicon, fonts:{heading, body, mono}, images[], document}` each `{id, name, type, size, sha256, hosted_url, url, source}`; never bytes | the shell paints from IndexedDB on the device; an asset carries `[DATA REQUIRED BEFORE LAUNCH: hosted logo URL, <brand>]` until a hosted https URL exists |
| `field_origins` / `field_origin` | per field, where its value came from (see provenance) | `claimUserOwnedFields()`, the device store's `mayReplace()` |
| `brand_extraction` | the last Read my site report and what was applied (`applied['regions.home']` records `origin:'user'` or `replaced`) | the wizard, the context pack |
| `imagery`, `brand_assets` | image references read off the brand's own site | asset provenance |

Tenant zero's record (`data/brands/_default.json`) also carries `offers` (its own discount codes, a
cap and banned codes) and `claims`, `contact`, `social`, `market_study`, `legal_entity` at the top
level; `scripts/brand-sync.js` generates `theme.css`'s no-brand fallbacks, the Brand Constants block
in `CLAUDE.md` and the Supabase brand-kit seed from it, and `npm run brand:check` fails on drift.

## Derived, never stored

`shellPayload()` (and `shellPayloadFor()` on the device) adds to what the browser receives:

- `tokens`: the full `--brand-*` set from `tokens()`, including the contract's derived tokens
  (`CONTRACT.md`);
- `fonts_href`: the Google Fonts URL for the `google:true` families;
- `files`: the ids and hosted URLs of the brand's uploaded files;
- `readiness` (on `active`): the markers below and `BRAND READY` /
  `NOT LAUNCH READY — DATA DEPENDENCY`.

## Where a value may come from: provenance

One order, the same in SQL (`brand_origin_rank()`), on the server (`ORIGIN_RANK`) and on the device:

| Origin | Rank | Meaning |
|---|---|---|
| `user` | 50 | the operator typed or confirmed it (pressed Use) |
| `document` | 40 | read from a brand guideline document the operator supplied |
| `site-render` | 30 | read off the brand's own site in a rendered browser (computed styles) |
| `site-parse` (= `auto`) | 20 | parsed from the site's HTML and CSS |
| `preset` | 10 | a starter preset from the gallery |
| `default` | 0 | a wizard placeholder nobody chose; recorded nowhere |

A value may replace another only when its origin ranks at least as high. An automatic run can
never overwrite a field a person owns: `brand_field_provenance` plus the `brand_context_apply()`
SQL function refuse it in the database, not in call order, and `saveWorkspace()` claims for the
operator exactly the fields their save carried. Every site-read value is a CANDIDATE carrying its
source URL and signal; nothing is applied until the operator presses Use.

## The brand's own DESIGN.md

The brand context pack (`api/_shared/brand-context-pack.js`, `?op=context-*`) emits each brand's
DESIGN.md in the open google-labs-code/design.md format, version `alpha` (validated against that
project's own linter by `npm run check:designmd`):

- front matter `version`, `name`, `description`, `omitted`, `colors`, `typography`, `rounded`,
  `spacing`; the 8 sections in order, each once;
- `primary` comes ONLY from an identity signal (theme-color, manifest `theme_color`, a
  `--brand-*` property); `secondary` only when the action colour genuinely differs; a
  frequency-ranked colour is never promoted;
- text tokens are the `readableAsText()`-adjusted values at `TEXT_AA`, every adjustment printed;
- a section the site did not publish goes in `omitted` WITH ITS REASON, never filled.

Lifecycle OS's own DESIGN.md (`design/lifecycle-os/DESIGN.md`) uses the same format for the
platform, and holds only the platform's values; a brand's values live in that brand's file.

## When a field is missing: the marker

`launchMarker(field, {brand, product, region})` renders the spec's
`[DATA REQUIRED BEFORE LAUNCH: <field>, <product or brand>, <region>]`, naming the product and the
region only where they apply (`[...: logo URL, Acme]`, `[...: region store URL, Acme, US]`). A
marker is shown, never padded and never replaced by a plausible value: in the app as `.vh-marker`
(`CONTRACT.md`), in a generated asset as the literal text in the slot.

`readiness()` reports, in this order: `brand name`, `brand website`, `logo URL`, each failing
`palette.<role>`, `typography.heading`, `typography.body`, `voice.tone`, `voice.banned phrases`,
`regions`, `home market`, each region's `region store URL` and `region currency`, and
`product catalog` when the catalogue is empty. The blocking ones (`brand name`, `palette.*`,
`typography.*`, `regions`, `product catalog`) hold the status at
`NOT LAUNCH READY — DATA DEPENDENCY`.
