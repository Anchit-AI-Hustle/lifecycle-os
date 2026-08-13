---
name: brand-context
description: The foundation skill. Establishes WHICH brand the session is operating for, and loads that brand's own record - identity, offerings, audience, positioning, voice, palette, claims and regions. Every other skill in this repo reads it first. Use when the user says "set brand context", "which brand am I working on", "switch brand", "load brand", "brand profile", "work on <brand>", or at the START of any brand work when the active brand is not yet established. Run this before any skill that writes copy, generates creative, plans a campaign or reads analytics.
argument-hint: "[brand slug or name, e.g. 'times-of-india' - omit to use the active workspace]"
metadata:
  version: 1.0.0
---

# Brand Context

You are establishing **which brand this session is operating for**, and loading that
brand's own record before any other skill runs.

This repo is a multi-tenant brand platform. Every skill here used to name
tenant zero, because the app began as one brand's tool. It is not one any more:
a signed-in user onboards their own brand and the whole app runs as that brand.
A skill that assumes tenant zero will write another company's product into this
company's campaign, which is the single worst failure this platform can have.

## The rule this skill exists to enforce

> **A brand's assets, facts, copy and vocabulary come from ITS OWN record, or
> there is no asset.** There is no third option where another brand's material
> renders under a caveat.

## Step 1 — Resolve the active brand

In order, stop at the first that answers:

1. **An argument** to this skill (`/brand-context times-of-india`) - resolve it
   against `data/brands/presets/<slug>.json`, then against `brand_workspaces`.
2. **The live workspace**, if the user is asking about the running app:
   `GET /api/public-config?action=brand` returns the caller's active workspace
   via `brand_user_prefs.active_workspace_id`.
3. **`data/brands/_default.json`** - tenant zero. Use this ONLY when the user is
   working on the platform itself rather than on a customer's brand. Say so
   explicitly when you do; do not let it become a silent default.

Read the record with `api/_shared/brand-runtime.js` (`defaultBrand()`,
`normalizeBrand()`), never by hand-parsing the JSON.

**If no brand resolves, STOP and ask.** Do not proceed with tenant zero because
it is the file that happens to be there.

## Step 2 — Load the record, and know what is missing

From the resolved record, hold for the rest of the session:

| Field | Where it comes from | If absent |
|---|---|---|
| Name, tagline, legal entity | brand record | ask; never invent |
| Category / industry | `industry` | ask |
| Offerings + `kind` | `offerings[]` | the vocabulary below degrades to generic |
| Audience | brand record, or a slot's COHORT | `[DATA REQUIRED BEFORE LAUNCH: audience / persona definition, <brand>]` |
| Positioning, competitors | `market_study`, `brand_competitors` | `/competitor` seeds from the brand's OWN record |
| Voice, banned phrases | `voice` | never machine-fill `voice.banned` |
| Palette, typography | `palette`, `typography` | `--brand-*` tokens; never hardcode a colour |
| Claims | `claims` | assert NOTHING else as fact |
| Regions, currency, store URL | `regions[]` | no cross-region reuse |
| Catalogue | `brand_catalog_products` (its own) | image-free + a marker, never another brand's photo |

A field the brand has not published is written as
`[DATA REQUIRED BEFORE LAUNCH: field, product, region]`. It is **never** filled
with a plausible value, and never with tenant zero's.

## Step 3 — Speak the brand's vocabulary, not tenant zero's

Derive the nouns from `offerings[].kind` (the same mapping as
`growth-os-core.offeringNoun()` / `audienceNoun()`, exposed to pages as
`BrandContext.nouns()`):

| kind | the thing | the person |
|---|---|---|
| product | offer | buyer |
| section | section | reader |
| programme | programme | participant |
| plan | plan | subscriber |
| event | event | attendee |
| service | service | client |
| *(none declared)* | offer | customer |

A newspaper has readers and sections, not buyers and colorways. `/agent` shipped
telling The Times of India's readers to ask "whether a colorway is worth it"
because its copy was written for one tenant, so this is not hypothetical.

Never carry tenant zero's product words - sneakers, colorway, airbrush,
hand-painted, streetwear, grail - into another brand's output. `npm run
audit:pages` fails on them (`tenant-zero-vocabulary`), and
`tests/brand-nouns.spec.js` locks the behaviour.

## Step 4 — Derive what the brand has not typed, with provenance

Where the record is thin and the brand has a website, do NOT ask the user to
invent answers to a questionnaire. Read the brand's own site:

- `api/_shared/brand-extract.js` (`?op=extract`) reads name, tagline, logo,
  palette, typography, observed voice, verbatim claims, social, legal entity and
  regions from the brand's OWN pages.
- `api/_shared/brand-context-pack.js` (`?op=context-*`) builds the durable pack:
  a DESIGN.md in the open `google-labs-code/design.md` format, a knowledge base
  from that domain only, the catalogue, and a GitHub search.

Two properties matter and must not be traded away:

1. **Every value is a CANDIDATE** carrying its source URL and signal. Nothing is
   applied until the operator presses Use. A colour is promoted to `primary`
   only from an identity signal (theme-color, manifest `theme_color`, a
   `--brand-*` token) - never because it was the most frequent colour on a page.
2. **User data wins structurally.** `brand_field_provenance` +
   `brand_context_apply()` refuse any automatic value for a field whose origin
   is `user` - enforced in the database, not in call order.

## Step 5 — Report, then hand off

State plainly:

- which brand is active, and how it resolved (argument / live workspace / tenant zero)
- its offering kind and therefore the vocabulary in force
- which fields are present, and which are `[DATA REQUIRED BEFORE LAUNCH]`
- whether a catalogue exists for it (`brand-catalog-server.js` source:
  `brand` / `shipped` / `none`)

Then continue with the skill the user actually asked for.

## Related skills

Every skill in `.claude/commands/` reads this first. The ones that will produce
another brand's content if it is skipped: `/campaign-plan`, `/mailer`,
`/ad-creative`, `/landing-page`, `/email-flow`, `/competitor`, `/analytics`,
`/seo`, `/shopify`, `/design`.

## Verification

- `npm run test:isolation` - full funnel per preset, 0 foreign references
- `npm run audit:pages` - `hardcoded-brand`, `tenant-zero-vocabulary`
- `npm run check:foreign` - no foreign brand names or figures in the tree
- `npx playwright test tests/brand-nouns.spec.js tests/brand-catalog-scope.spec.js`
