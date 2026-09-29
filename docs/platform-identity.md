# The app chrome is Lifecycle OS's, never a tenant's (2026-09-29)

The operator's words, with a screenshot of the browser tab showing tenant zero's mark: *"ensure
website logo used everywhere is updated as per lifecycle os and does not use the knickgasm logo -
even in the website tab"*.

This is a universal brand platform. Any brand onboards and the whole app runs as that brand: its
palette, its fonts, its name, its copy, its catalogue. The standing gates hold that
(`cross-brand-leak`, the page audit). The **chrome** is something else: the browser-tab icon, the
touch icon, the PWA manifest, the share card, the service-worker precache, the rail mark and the
mobile launcher identify the TOOL a person is in, and they were tenant zero's logo (`favicon.png`)
on every page. `brand-context.js` then made it worse in a way that looked like a feature: it wrote
the active brand's `favicon_url || logo_url` onto `<link rel="icon">` and replaced the rail's mark
with the brand's logo outright. So the product had no mark of its own anywhere a person looks
first, and with tenant zero active the tab and the rail both wore that tenant's logo.

Gated by `tests/platform-identity.spec.js` (8 tests, executed: every app page is rendered in
Chromium under two brands, the manifest is fetched, `sw.js` is run in a vm, every raster's pixels
are read).

## Three kinds of mark, and where each may appear

| Kind | Where | Source |
|---|---|---|
| **Platform chrome** | tab icon, apple-touch-icon, manifest icons, `og:image` / `twitter:image`, the rail wordmark (`.lnav-brand`), the mobile bar, the service-worker precache, the Android launcher | `assets/lifecycle-os-mark.svg` and its rasters, always |
| **The active brand's logo** | the brand slot beneath the wordmark (`.lnav-brandlogo`, `data-brand-slot="logo"`), the onboarding review, `/premium`, a tenant artefact gated by `data-shipped-for` | that brand's OWN record (`brand.logo_url`); with none, a monogram of its name on a neutral chip, **never another tenant's file** |
| **Tenant zero's own artefacts** | the frozen `diff-version` snapshot (`auth.js IS_FROZEN_DIFF`, "must never change") | `favicon.png`, kept for that snapshot only; no app page may link it |

## The mark

`assets/lifecycle-os-mark.svg`: a closed loop with an advancing arrowhead (the lifecycle that keeps
running) around a still core (the OS), on a rounded tile. Three colours, all neutral greys by the
SAME saturation rule the page audit applies to page CSS (`scripts/audit-pages.js` → `lowSat`,
now exported), asserted against tenant zero's palette. A favicon renders in isolation and cannot
read the page's brand tokens, which is why the file carries literals; the inline copy in `auth.js`
(`LOGO_SVG`, same geometry) carries **no hex at all**: glyph in `currentColor` (the rail's ink),
tile in `--vh-panel-2` with a `--vh-line` hairline. The gate asserts the rail mark's rendered stroke
equals the wordmark's ink and is neither the active brand's primary nor its accent, so a mark that
re-coloured itself per tenant fails.

**No `--` inside the SVG's comment.** XML forbids it, the file is then not well-formed, and every
consumer decodes it as nothing, silently. The first version of the file said `--brand-*` in prose;
only the executed raster test (`img.decode()` in Chromium) found it.

## The rasters

`scripts/build-platform-mark.js` renders every raster from the SVG. There is no pure-Node
rasteriser in this repo's dependencies (no sharp, resvg or canvas), so it uses Playwright's
Chromium, which the test suite already needs, and the outputs are **committed**: Vercel's build has
no browser. Re-run the script after editing the SVG; the gate checks the committed files.

Three shapes, because three consumers crop differently:

- **any** (rounded tile, transparent corners): `lifecycle-os-32.png` (favicon fallback), `-192`,
  `-512`, the legacy Android `ic_launcher`.
- **fullbleed** (tile to the edges, no transparency): `lifecycle-os-180.png` (iOS paints
  transparent touch-icon pixels BLACK and applies its own corner mask), `-512-maskable` (a
  launcher crops a maskable icon to a circle, squircle or rounded square and must find art in
  every corner).
- **glyph** (loop alone on transparency, inside the centre 66/108): the Android adaptive-icon
  foreground, whose background is the tile colour resource.

Plus the 1200×630 share card. The gate reads the pixels of each: not blank (ink pixels above 1%),
the corner rule of its kind, the core dot at the centre.

## What every app page links

```html
<link rel="icon" href="/assets/lifecycle-os-mark.svg" type="image/svg+xml">
<link rel="icon" href="/assets/lifecycle-os-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/lifecycle-os-180.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta property="og:site_name" content="Lifecycle OS">
<meta property="og:image" content="/assets/lifecycle-os-og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="/assets/lifecycle-os-og.png">
```

`index.html`, the one indexable page, declares its canonical origin and carries the share card as an
absolute URL on it; every other page carries it root-relative, so it is served from whatever origin
served the page and never from a tenant CDN. The gate accepts exactly those two hosts.

Inventory of the change: 59 root pages (every page carrying the shell, every page the audit
classifies as an app page, and every page that linked `favicon.png`) plus 37 generated
`reports/`, `growth-book/` and `playbook/` pages (their generators updated too). 16 pages had **no
icon at all** and got the browser default: `ads-masterclass`, `agent`, `app-audit`, `campaign`,
`connector-3d`, `kicksgpt`, `landing-page-agent`, `lifecycle-usa-july-calendar-mailer-studio`,
`premium-experience`, `privacy`, `retention-playbook`, `styleguide`, `team`, `template-gallery`,
`terms`, `uk-non-engagers`. `styleguide.html` also demonstrated its "dimensional icon" component
with tenant zero's icon beside the words "Lifecycle OS"; it demonstrates the platform mark now.
The seven generated tenant-zero artefacts with no shell (presells, coffee-collection landings, the
USA D2C dashboard) are untouched, as is the frozen `diff-version` set.

## The manifest and the service worker

`manifest.webmanifest` names Lifecycle OS, lists the four platform icons (192, 512, 512 maskable,
the SVG), and its `theme_color` / `background_color` are the tile neutral rather than a tenant's
primary. Its shortcut copy no longer names a tenant. `sw.js` is v20: the precache list carries the
platform files and not `/favicon.png`. The gate **executes** `sw.js` in a `vm` sandbox, fires its
`install` handler, and asserts the array it hands to `caches.addAll()`: every manifest icon is in
it, the retired file is not, every entry exists on disk.

## The brand slot

`brand-context.fillBrandSlot(brand)` is the only writer of `.lnav-brandlogo`: an `<img>` of
`brand.logo_url` when the record has one, else a monogram of the name. A logo the record names but
the host does not serve falls back to the monogram AND records the URL on
`data-brand-logo-failed`, so a broken record is visible rather than papered over. `.lnav-brandname`
still holds the brand's name as text (two existing tests read it).

## How the gate sweeps

The page list is derived from the repo with the audit's own `BRAND_ASSET` regex, **imported** from
`scripts/audit-pages.js` (its body is now `main()`, guarded by `require.main`): a copy would drift
the moment an entry was added. Each page is opened in Chromium with a mobile+PIN device session and
The Times of India active (the cross-brand-leak harness), then again with tenant zero active. The
two redirect stubs (`ad-campaigns-master`, `data-analysis-contrast`) are followed to where the tab
lands, through the deployment's own exact rewrites read from `vercel.json`, because the first run
measured a 404 body and reported "no icon at all". Cross-origin images are answered with a 1×1
PNG: the gate is about which URL an element resolved to, and an aborted load would trip the slot's
own broken-logo fallback and hide the URL under test.

Asserted per page, from the RESOLVED DOM: every `link[rel~=icon]`, `apple-touch-icon`, `manifest`
and share-image href is a platform file on this origin (never `favicon.png`, never a tenant host,
derived from the record's `website` and `logo_url`); the rail carries the inline SVG mark labelled
"Lifecycle OS" and the wordmark "Lifecycle OS", no `<img>` has replaced it, the mark's stroke is the
wordmark's ink; the slot names the active brand. Under The Times of India no image anywhere is
tenant zero's; under tenant zero its logo is in the slot on every rail (≥30) and in no image
outside a slot, and it is never the tab, touch or share icon. Floors first: ≥40 pages, ≥30 rails,
more icon links than pages. A check that inspects nothing passes everything.
