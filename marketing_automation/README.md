# Campaign Hub (`marketing_automation/`)

A local React 19 + Vite + Express workspace over the Lifecycle OS **landing-page
compiler**. Pick a campaign angle and a funnel variant, and it compiles the
standalone HTML page, alongside the Meta/Google ad copy and the mailer pointers
that belong to that same angle.

This app is **not deployed**. It is listed in the repo's `.vercelignore`; the
compiler it wraps is what ships, as `api/_shared/lp-compiler.js` behind
`/lp/:id`.

## One record, three surfaces

`src/utils/compiler.ts` holds the `THEMES` and `FUNNEL_VARIANTS` records and is
kept field-for-field identical to `api/_shared/lp-compiler.js` (only the type
annotations differ). The ad tab and the mailer tab are **derived views** over
those same records via `adCopyForTheme()` — there is no second table of campaign
copy, so an ad cannot claim something the page it links to does not say.

Every product name, price, image and URL traces to
`data/catalog/products_{region}.json`. The only statements asserted as fact are
the brand's approved claims in `data/brands/_default.json`. Anything without an
approved source — review counts, star ratings, interest targeting, page-speed
benchmarks — renders as `[DATA REQUIRED BEFORE LAUNCH: ...]` rather than a
plausible-looking number.

## Run locally

**Prerequisites:** Node.js

```bash
npm install --legacy-peer-deps   # see "Known dependency conflict" below
npm run dev                      # tsx server.ts -> http://localhost:3000
npm run lint                     # tsc --noEmit
npm run build                    # vite build + esbuild bundle of server.ts
```

`server.ts` exposes `GET /api/metadata` (themes + variants) and
`POST /api/compile` (`{ themeId, variantCode }` → compiled HTML), and mirrors
the catalog images referenced by the theme records into `./public` on boot.

## Known dependency conflict

`@react-three/fiber@8` (used by `src/Knickgasm3DConnectorEngine.tsx`) declares a
peer of `react@>=18 <19`, while this app pins React 19. A plain `npm install`
therefore fails on `ERESOLVE`, and `npm run lint` reports JSX-namespace errors
inside the 3D engine. Both predate the current content and are a version-pinning
job, not a copy one.
