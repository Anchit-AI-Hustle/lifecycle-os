# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Lifecycle OS — Project Memory

## ⭐ Replenishment triggers are MEASURED from the brand's own orders, never assumed (2026-10-04)
`api/_shared/replenishment-model.js` + `SmartBrainDbAdapter.orderHistory()` / `replenishmentEntries()` in
`lib/smart-brain/services.js` + `cohort-engine.triggerEligibility()`, gated by `tests/replenishment-model.spec.js`
(26 executed; 23 mutations each fail it). The roadmap's example assumed "1.5 cups/day": a consumption rate or a
pack size is a product fact, so neither is ever used.
- **Per (market, product)**: the empirical inter-purchase interval (median/p25/p75/n) from customers who bought
  it twice; SKU first, its product type when the SKU is thin. `MIN_REPEAT_CUSTOMERS = 30` (one number for every
  estimate) or the product reports `insufficient_history` WITH its count. Same-day orders are one occasion.
  Never pooled across markets (closed source-of-truth).
- **Per customer**: empirical-Bayes shrinkage on log intervals, `w(k) = tau2 / (tau2 + sigma2/k)`; `tau2 = 0`
  means customers do not differ and everyone gets the median. Quantity only when the line STATES it and a seeded
  bootstrap CI of the ratio excludes 1 (proportional only when it contains the mean quantity; otherwise the
  measured ratio). Trigger at the p25-equivalent point; past p75 a customer is LAPSING - reactivation's job.
- **The backtest decides** (last 26 weeks held out): the model ships only if its MAE improvement CI is above 0
  and its hit-rate is not lower; otherwise the baseline (product median for everyone) ships and says why. On the
  bundled export: `tau2 = 0`, MAE 217.9 vs baseline 217.5 days, hit-rate 0.317 vs 0.318 -> **baseline**.
- **Whose orders**: the workspace's own `smart_orders`; tenant zero's `data/matrixify` export ONLY through
  `ownsBundledExport()`, never for a request carrying a person with no workspace, never on the non-tenant-zero
  planner branch (`allowBundled:false`). No orders = `[DATA REQUIRED BEFORE LAUNCH: order history, this brand]`.
  That export is SAMPLE data (every email on example.com - detected from the file) and ends 2025-03-30, so as of
  today 0 customers are due and 3,570 have lapsed; the insight line says exactly that.
- **Planner**: weekly slots per market x {`Replenishment due: second order` -> `second-order activation`,
  `... repeat` -> `replenishment`}; audience = due customers passing the same engagement tiers and
  `frequencyCheck` (no send history = unchecked, never "inside the cap"), never widened to a floor; evidence on
  `entry.replenishment`; the same `enforceFrequencyCap` pass (now a named export). `predictions`/`contacts` on the
  analysis are non-enumerable: no customer list on the wire.
- Left as found, on purpose: `lifecycle-cohorts.COHORTS` (a new key changes the UK planner's default rotation);
  the copywriter is not briefed with the interval (generator files are other PRs'); per-contact `sends_7d` is the
  cap input until the omnichannel fatigue ledger lands.
## ⭐ The Social Integration Gateway: view and update, draft first (2026-10-04)
`api/_shared/social-gateway-core.js` on `brain.js ?action=social-gateway&op=status|read|inbox|underperformance|
flags|thresholds|thresholds-save|regen-approve|flag-dismiss|live-approve` (still 12/12, still two crons), the
"Social gateway" tab on `/publishing`. Adapters: `meta-adapter.js` (extended: Instagram + Facebook Page comments,
mentions, insights, Page feed, ad insights, activation), `tiktok-adapter.js` (`tiktok` organic + `tiktok_ads`),
`pinterest-adapter.js`, `youtube-adapter.js`, and `google-ads-adapter.js` (gained an ad-metrics reader). Gated by
`tests/social-gateway-executed.spec.js` (33) + `tests/social-gateway-console.spec.js` (4, the page driven over the
shipped core) over `tests/lib/fake-social-platforms.js`, which answers exactly the documented endpoints and THROWS
on anything else.
- **Every call is a row in the adapter's `endpointTable`** with its doc URL; `callEndpoint()` is the one door.
  `verified:false` REFUSES with the exact request, whatever the switches say, and the hub counts it. Unverified
  today: all of TikTok Ads (only the SDK was readable; its default status is ENABLE), Pinterest `ad_create` (PAUSED
  is confirmed for campaigns only) and `campaign_update` (the docs conflict). Google ROAS is not read (the field
  was not confirmed); YouTube and Pinterest webhooks are refused (no signature scheme confirmed).
- **The third switch is per platform now**: `META_/TIKTOK_/PINTEREST_/YOUTUBE_/GOOGLE_ADS_ALLOW_WRITES=1`, beside
  `LIVE_CONNECTORS` and the brand's toggle (`publishAllowance` → `platform_writes_off`). A READ needs only
  `LIVE_CONNECTORS`. A write that needs a read first (TikTok `creator_info`, YouTube's media bytes) asks
  `writeRefusal()` BEFORE the read, so a withheld write shows the write, and nothing leaves.
- **Paid is created PAUSED / DISABLE / private**; going live is its own `<platform>_live_approval` job, and
  dispatch-core stamps `approved_by` from the SESSION (a request's own claim is overwritten). YouTube activation
  re-sends every writable status field, because `videos.update` deletes what it omits.
- **Tokens never leave**: `would_request` URLs are redacted (`access_token`, `appsecret_proof`), and that was a
  real leak into `dispatch_jobs.result` before this. Refresh rides the existing daily cron
  (`refreshDueTokens({withinDays:7})`): a refusal marks `needs_reauth` (and `ensureFreshToken` then refuses), a
  platform that did not answer is retried.
- **Webhooks**: verified over the raw bytes, recorded once per event id (`social_inbound_events` unique on
  provider + event id), routed only to the ONE workspace whose connection names the account, logged to
  `platform_sync_log`. Migration `20261004150000_social_gateway.sql`.
- **Underperformance** is below the brand's OWN median per platform (3+ creatives, else said) or below an
  operator's OWN threshold; an absent metric is never a zero; units are never mixed across platforms. A flag
  OFFERS a metered regeneration (`ads.generate` / `social.post`); approving records who and spends nothing.
- 21 mutations, each failing the spec (ACTIVE paid writes on three platforms, both signatures uncompared, a
  switch ignored, an unverified endpoint sent, the approver taken from the request, a duplicate re-processed,
  YouTube public, absent read as zero, a refused refresh left active, ...).
- Left as found: `connections` `oauth-start` answers `connections_router_failed` for a phone device session
  (pre-existing for every OAuth platform); a Google Ads ad is turned on in Google Ads (no enable call confirmed).

## ⭐ A brand's guidelines are uploaded, and every asset is a file OR a URL (2026-10-04) — read `docs/universal-brand-platform.md` ("Brand guidelines document")
The operator's words: *"ensure user can upload a document for the design schema to be followed too with
all details like logo file or url, etc - keep options for files and urls both where either are
required"*. `brand-document.js` (browser) + `onboarding.html` step 1 "Upload my brand guidelines" +
`brand-context.js` (`BrandContext.files`, `.provenance`) + `api/_shared/brand-document-fetch.js` on
`?action=brand&op=document-fetch` (still 12/12) + migration `20261004120000_brand_document_origin.sql`.
Gated by `tests/brand-guide-upload.spec.js` (15, Chromium, documents built byte by byte in
`tests/brand-guide-fixtures.js`) and `tests/brand-document-origin-sql.spec.js` (6, the migration
EXECUTED on PGlite - real Postgres in WebAssembly, a devDependency).
- **Read in the browser, never paraphrased.** PDF via pdf.js 4.10.38 from jsdelivr (the same CDN the pages
  use; `isEvalSupported:false`, so CVE-2024-4367's font-eval path is closed), DOCX unzipped with the
  browser's own `DecompressionStream`, DESIGN.md (our own format), W3C DTCG / Style Dictionary / Tokens
  Studio / Figma-variables JSON, CSS custom properties + `@font-face`, SVG text + labelled swatches, and
  an image (no text layer: says so, offers it as the logo). Every value carries file or URL, page, line
  and the verbatim line. Vercel caps a request body at 4.5 MB and brand books are bigger, so a FILE is
  never uploaded to be parsed; only a LINKED document whose host sends no CORS goes through the server
  op, behind `assertPublicUrl` on EVERY hop (`redirect:'manual'`), capped at 4 MB, opened on the same rule
  as `extract` and nowhere else.
- **Zero fabrication, in the rules themselves.** A role takes a STATED screen value only: a hex, or an
  RGB triple (its notation). CMYK/Pantone-only colours are `print_only` - a conversion is offered labelled
  `DERIVED from CMYK …` and is never applied by Apply; Pantone gets no computed hex at all. A colour named
  in prose ("a soft grey colour") is `named_without_value` with the marker. A line that states a
  COMPONENT colour ("Buttons: background #1A6B3C") feeds the component, never a palette role - the first
  cut let "Buttons background" become the page surface. DESIGN.md tokens marked DERIVED (and `on-*` /
  `*-text`) are skipped, not taken as stated.
- **One order of origins, in three places** (SQL `brand_origin_rank()`, `brand-workspace-core
  ORIGIN_RANK`, `brand-context.js ORIGIN_RANK`): `user 50 > document 40 > site-render 30 > site-parse 20
  (= auto) > preset 10 > default 0`. The wizard keeps them per field in `brand_data.field_origins`
  (typing → `user`, captured before the wizard's own handler; an explicit choice between two sources →
  `user`). `saveWorkspace()` claims only `user`/unknown fields as typed and records the rest through
  `brand_fields_record_origin()`, which NEVER demotes; `brand_context_apply()` (the automatic door) now
  refuses every origin that outranks the site parser, by rank. A brand saved before origins existed has
  none recorded, so everything filled on it is treated as typed (conservative).
- **Apply / Revert.** Apply fills every field the document states except a typed one, lists each outcome
  (`applied`, `kept, you typed it` with a "Use the document's" button, `already this`, `added to yours`,
  `not in the document`), stores the logo the document puts beside the word "logo" and the guide itself
  as files, writes `brand_data.design_components` (DESIGN.md component shape: `button-primary`
  `{backgroundColor,textColor,rounded,padding,textTransform}`, `container.width`, `logo.clearSpace`,
  `rounded`, `spacing`, `rules` + a parallel `provenance`), and shows the hard rules: exact colours as
  tokens, AA text tokens `DERIVED from <exact>` with both ratios, a dark-neutral surface as a hard-rule
  conflict (never swapped). Revert restores the pre-apply snapshot and removes the files it added.
- **A later "Read my site" never overwrites a document value silently.** `docGuard()` runs FIRST in every
  `render()`: a document-owned field changed by anything but typing (a site Use, a preset) is restored and
  both values are shown side by side with a button each. It needs no edit to the site-read code, which
  another branch is rewriting.
- **File OR URL**: logo, app icon (`favicon_url`, now loaded and saved by the wizard), brand imagery,
  heading/body fonts (WOFF2/WOFF/TTF/OTF file, a font URL, or a Google Fonts link) and the guide itself.
  "Upload a file" is a LABEL around a hidden input (no dead click for the sweep); refusals are sentences
  (type, size, < 32 px logo, non-square icon, a file the browser cannot load as a font). An uploaded SVG is
  sanitised (scripts, `foreignObject`, `on*`, `javascript:`/external hrefs removed) and only ever shown as
  `<img>`. A DELIVERY asset (logo, icon, fonts, imagery) is HOSTED for an account with a reachable
  project (`brand-assets` bucket, PUBLIC read, `<workspace_id>/<sha256>.<ext>`, editor-scoped writes) and
  otherwise kept in IndexedDB (localStorage caps ~5 MB) under `deviceKey()` - another person on the
  browser sees none, deleting the brand deletes them, and a file chosen before the brand had an id moves
  to it on first save (`files.adopt`). **The brand book itself is private and is never hosted**, for any
  account: `files.host()` refuses every slot but the delivery ones (review, 2026-10-04 - the first cut
  sent the whole PDF into the public bucket). Deleting an account brand removes its `brand-assets/<ws>/`
  objects FIRST (the delete policy needs the row) and refuses rather than orphan public files.
- **Review round 1, each reproduced by an executed test first and mutation-verified**: the brand book
  in the public bucket (above); `op=document-fetch` buffered the whole body before checking the cap, so a
  host omitting or falsifying Content-Length could exhaust the function - it now streams, cancels at
  4 MB, and has one 25 s deadline; a typed value the document repeated flipped to `document` (equal is
  unchanged now); `voice.no_em_dashes` was untracked, so unticking it was not the operator's.
- **Review round 2 (Codex + the coordinator's own review), executed tests that failed first, mutation-
  verified**: a self-hosted font now reaches every asset (`typography[slot].src` → `brand-runtime.
  fontFaces()`, which `design-system.resolve()` adds to the faces the rendered read found, so the mailer,
  `/lp/:id` and the fallback landing page all declare `@font-face`); a `brand-assets` LISTING that does
  not answer stops the delete (only "Bucket not found" means nothing to orphan); Apply is all or
  nothing (a device-store refusal part-way restores the snapshot and removes the kept files); a logo or
  icon URL that does not load puts the previous value back; the browser streams a CORS download and
  cancels it at the cap. **`op=document-fetch` is not a fetch proxy**: production opens it without an
  account, and `/api/public-config` answers `Access-Control-Allow-Origin: *`, so as first shipped any
  caller could GET any public URL through it. Now POST only (405 sentence), no CORS on that op on any
  path (the wildcard is removed before anything runs), and on the OPEN path a page of THIS deployment
  only (`samePageRequest()`: Origin, else Referer, host === the request's host; the device-principal
  rule still checks presence only) plus the open rendered read's limiter (`brand-render.rateCheck`, its
  own `document` budget: 6 per address, 40 per instance, per 10 minutes, 429 sentence). Merging #128:
  `field_origins` (this reader's records) and `field_origin` (the rendered read's map) are written
  together and read by both sides; a filled field with no recorded origin is the person's on every
  path; an automatic source never demotes a document value, the person's own pick does.
- **Never base64 in a generated asset.** `carry()` sends `pending_hosting:['logo'|'icon'|'font'|'image']`
  (names only) and drops a non-https `logo_url`; `brand-runtime` keeps `logo_url` https-only and prints
  `[DATA REQUIRED BEFORE LAUNCH: hosted logo URL, <brand>]`; the pipeline html stage's own renderer writes
  that marker in the header. Executed: the shipped html stage, every provider down, for a carried brand
  whose logo is on the device - no `;base64,`/`data:image`/`blob:` in the mailer.
- **Found by running it**: Playwright's `route.fulfill` answers a cross-origin read permissively, so the
  "host sends no CORS" case read the PDF directly and never reached the server op - modelled as the
  failure a browser sees (`route.abort`). A second account was invisible to the namespace test until the
  device user map held both people (auth.js rejects a session whose user is not on the device).
- **Known limits, said not hidden**: no OCR (a raster style sheet's colours are not tied to roles); a
  logo drawn as vector paths in a PDF is not lifted out; colour swatches DRAWN in a PDF are not read
  (pdf.js converts CMYK fills to RGB before the operator list, so a drawn value cannot be told from a
  derived one); the optional LLM structuring pass was not built (rule-based only); a pasted URL on a host
  the brand has not declared is said, not blocked; per-row product images on the catalogue step stay URL
  columns in the CSV/JSON; Brand Input (`brand.html`, the legacy brand kit) keeps its URL-only guide field.

## ⭐ Read my site RENDERS the site, and scores what WE generate against it (2026-10-04) — read `docs/universal-brand-platform.md`
The operator's words, with a screenshot of `/onboarding` → "Read my brand from my website": *"read my site
should actually be fetching the exact styling and branding of the website entered and apply that complete
accurately"*, then *"understand the end goal"*: everything this platform generates for a brand must look
like it came from the brand's own site, with proof. `op=extract` now opens the site in a headless Chromium
and measures it; the parser (`brand-extract.js`) runs beside it and is the LABELLED fallback
(`read.method: 'rendered' | 'parsed'`, `read.renderer: 'chromium' | 'unavailable' | 'blocked' |
'timeout'`). Still 12/12 functions. Gated by `tests/rendered-brand-read.spec.js`,
`tests/rendered-read-security.spec.js`, `tests/rendered-read-wizard.spec.js` (all executed).
- **Modules** (all `api/_shared/`): `render-browser.js` (one launcher: `@sparticuz/chromium` on serverless
  Linux, preinstalled/registry Chromium locally, says which), `render-net.js` (the browser's ONLY network),
  `render-capture.js` (measured BY ROLE on the rendered page, never by selector name), `brand-render.js`
  (the manifest; **`readRendered(url, { browser, viewports, maxPages, deadlineMs })` is the stable entry
  point** for other callers, e.g. a CI job with Playwright's own Chromium), `design-system.js` (manifest →
  `brand_data.design_system` + the ONE field patch the wizard and the regression both apply; what every
  renderer reads), `render-regression.js` (scores OUR renderers against the site).
- **The "site generator" is our real renderers**, not a throwaway clone: `smart-brain-plan.lpHtml` (served
  at `/lp/:id`), `calendar-trigger.renderTextVariant` (mailer) and `scripts/lib/motion-ad.js` (ad) consume
  buttons (default/hover/focus), heading scale, body copy, header + logo, product card, footer and section
  rhythm at desktop AND phone width. No design system on the record → byte-identical output, so the asset
  gates measure what they always measured. Shell: `--brand-radius-control` / `--brand-radius-card`.
- **Found by RUNNING it, none visible in the source**: (1) Chromium FOLLOWS A FULFILLED 3xx WITHOUT CALLING
  THE ROUTE HANDLER AGAIN - a canary on 127.0.0.1 took 3 connections from a page that only asked a public
  host for `/bounce`, and the browser opened its own background connections too. Redirects are followed in
  Node, hop by hop, each hop re-checked; the browser never sees a 3xx; a dead proxy (`127.0.0.1:9`,
  loopback not bypassed) is the floor. Canary now: 0. (2) With `--single-process` (required on Lambda)
  CLOSING A CONTEXT KILLS THE BROWSER - a fresh browser per read, pages closed, browser closed in `finally`.
  (3) `lpHtml` painted tenant zero's two font families for EVERY brand (`FONT_HEAD`/`FONT_BODY` literals).
  (4) `motion-ad.fontsOf()` put a typography OBJECT into CSS: every onboarded brand's video ad declared
  `--head:[object Object]`. (5) `applyTokens` never removed an optional token, so reverting left the
  previous brand's radius on `<html>`. (6) A regression that compares our output with the MANIFEST can
  never see a wrong manifest value (it is on both sides): the site side is the measurement kept immutable,
  and repair re-measures the live page. (7) A specimen at a different sub-pixel phase diffed 6-38% on a
  pixel-identical button; at the source's phase, 0%. (8) A page without a viewport meta is laid out at
  980px on a phone and its TEXT IS BOOSTED (a 36px heading measured 53.7px): said in `notes`.
  (9) `readableAsText()` walks one way, so on a mid-tone ground it can return a failing white:
  `textOnGround()` falls back to `textOn()`.
- **Colour roles keep the parser's model**: `primary` only from an IDENTITY signal (theme-color, manifest,
  a `--brand*` property AS COMPUTED on `:root` - runtime-set themes included - a chromatic header or logo
  fill as rendered); the rendered CTA is ACTION; a disagreement is a conflict, never resolved. A site whose
  only brand colour is its CTA gets that as primary with `from_role: 'action'`.
- **The score, defined in code**: tokens within tolerance (CIEDE2000 ≤ 2.3; sizes ±0.5px; letter-spacing
  ±0.1px; weight/case/family exact; padding ±1px; aspect ±0.03) + pixelmatch on specimens of OUR primary
  button and display heading (our computed styles, the site's text/width/ground/sub-pixel phase) vs the
  site's element screenshot. `mismatch = 0.7·tokens-off/tokens + 0.3·regions>3%/regions`, DONE ≤ 0.05.
  Exempt (listed, not counted): text DERIVED for AA, a dark-neutral section swapped by `sectionGround`.
  **Repair only RE-MEASURES the source** (computed → text-carrier → filled ancestor → ground); what every
  re-measure confirms is UNMATCHED with its value and reason. A pixel region over its limit sends every
  token of that component to be re-measured. **Email is token-only at the site's PHONE values**, a family
  counts only with a generic fallback, Outlook's dropped radius is said.
- **Applied completely, reversibly**: the wizard applies the whole patch except fields a person set -
  `brand_data.field_origin`, precedence `user > document > site-render > site-parse > preset` (compatible
  with the brand-guide upload branch); `claimedFields()` no longer claims a machine-set field. The panel:
  score per surface/component, side-by-side screenshots (site vs OUR landing page, mailer, ad), applied,
  KEPT, hard-rule decisions with both ratios, repairs, unmatched; one-click revert. Device, phone-device
  and server states all ride the existing save paths. A rendered extract also returns `design_md` through
  the context pack's own renderer (0 errors / 0 warnings on the official linter, measured).
- **Security**: GET/HEAD only; no WebSocket/EventSource/beacon/media; documents only on the brand's hosts
  and allowed by robots.txt; every subresource through `checkUrl` (assertPublicUrl's rules) with the socket
  PINNED to the checked address (DNS rebinding has nowhere to go); service workers blocked; no downloads,
  no permissions; byte/request budgets. Open path: 4 reads/address and 24/instance per 10 min, refusal in a
  sentence, voice forced off, no model reached (tested). `brand.extract` stays free (setup).
  `BRAND_RENDER=off` is the operator switch; the gate/parser specs use it and say why.
- **Measured**: function bundle ~116 MB traced (`@vercel/nft` + the `includeFiles` binary pack; gate 220 MB
  of Vercel's 250). `@sparticuz/chromium` 153 launches under playwright-core 1.63 in this container.
  `GET /api/brand?op=render-probe` renders a fixed shipped page (no fetch), cached 5 min per instance.
- **Two review rounds on #128, each finding reproduced by an executed test first and mutation-verified**
  (the security and data-loss half merged in #128 at `d720cb0`; the rest is its follow-up PR):
  ONE byte budget per read, taken chunk by chunk with every in-flight download aborted at the cap (ten
  concurrent 8 MB chunked streams against 4 MB: kept ≤ 4 MB, labelled partial); EVERY transport hop
  (1 + 5 redirects per route, and robots/start/manifest outside any route) charged to the request budget
  before its socket opens (the server counts ≤ 12 on a 12-connection read of ten five-hop images);
  robots.txt read for EVERY document origin before its first document (a cached promise per origin; no
  rules read = refused, never allow-all); a brand saved BEFORE `field_origin` existed keeps every non-empty
  value (no recorded origin = the person's), shown beside the site's value with "Use your site's"; the
  wizard's starting palette/type are origin `default`, a template's `preset`. Follow-up: the read is
  SCORED AS IT WILL BE APPLIED (the workspace on the server path, the bounded draft + origins the wizard
  carries otherwise; `regression.applied_as`); the regression compares the face each surface DREW (CDP
  `CSS.getPlatformFontsForNode`), which found two more defects on the spot - the email button's computed
  stack (`"Erica One", Georgia`) closed its own `style="..."` attribute and dropped family, size and
  radius in every mailer style, and the ad set its CTA in the body face; all four mailer styles read the
  design system and are scored; both full-page screenshots pinned (Playwright 1.63 trims `clip` to the
  full-page rect, measured); `engines.node` `24.x`, CI on Node 24 (`npm ci --engine-strict` and 458 specs
  run on 24.21.0 here).
- **The adopted reference items (2026-10-04), each executed and mutation-verified**: (A) ONE
  `render-stabilise.js` for the site AND our clone - Date/performance.now/Math.random pinned by an init
  script (clocks ADVANCE 1 ms per read, so a busy-wait still ends), network idle + fonts bounded, every
  animation/transition zeroed and the running ones finished or cancelled; a CTA running an infinite
  colour animation reads as its declared colour, and both sides report the same pinned clock. (B) each
  part is shot twice ~500 ms apart, on both sides; what changed is LIVE content and is masked. (C) TWO
  scores with their reasoning in code: STRUCTURAL (tokens; limit 0.95) and PERCEPTUAL (pixelmatch with
  text boxes and live pixels masked; 1 − worst region; limit 0.97); approval needs both; the panel shows
  both. (D) MONOTONIC repair: a set of re-measured values is kept only if the composite strictly improves,
  otherwise every value is put back and logged in `reverted` (a re-measure of a page that changed after
  it was read does not get kept). (E) FONT LEGAL GATE: a family and its source URLs are recorded and
  loaded BY REFERENCE to measure and preview; a generated email never carries a site's font files (no
  `@font-face`); a non-Google family is `<family> (brand font)` with its fallback stack, and the email's
  drawn fallback is listed EXEMPT with that reason. Consent overlays (fixed/sticky, named or worded as
  consent, or a known CMP container) are HIDDEN in the throwaway context, never clicked: no consent is
  given on anyone's behalf and a banner's colours never become the brand's. Measured while building it:
  the engine reports a drawn face by the FILE's own name, not the CSS alias (a brand font is recognised
  by the role's declared family), and pixelmatch's default threshold cannot see a dark hue shift
  (`#123456` vs `#0f5132` reads identical) - the structural ΔE channel is what catches colour.
  Rejected on purpose: frequency-ranked colour clustering, preset spacing buckets, an LLM patch step,
  a separate template builder, a TypeScript/Next.js restructure.
- **Known limits, said not hidden**: our landing page carries the button's SHAPE at phone width and its
  desktop fill (a site whose CTA changes colour on phones is reported unmatched, tested); the landing page
  has no nav row to compare; `flagship-mailer.js`, `landing-page.js`, `ad-creative.js` (tenant-zero build
  scripts), the pipeline `html` stage and the Studio do not read the design system yet; the context pack's
  own extract stage still parses; a site's font files are hotlinked by our assets and need that host's
  CORS; local system fonts are what the SERVER's browser has.

## ⭐ The starter brands are read from their own RENDERED sites, or say why not (2026-10-04)
The operator, with a screenshot of `/onboarding`'s starter-brand gallery: *"styles need to be correct
for these too"*. 22 of 40 presets wore the grey placeholder, and several that HAD been read were wrong
(a red telecom as `#000000`, four type lines `system-ui`, a primary equal to its accent). Now every
preset is read by the platform's ONE rendered reader, `api/_shared/brand-render.js` `readSite()`
(headless Chromium, computed styles by element role, per-value page/role/selector/viewport, its own
SSRF + robots rules, its honest user agent, the visual regression of our renderers against the site).
`scripts/harvest-presets.js` only SCHEDULES reads (one browser per read in a child process, 3 at a
time, a per-site deadline plus a hard stop) and `scripts/lib/preset-observation.js` only MAPS the
manifest. `scripts/observe-preset-brands.js` - a second, older browser reader - is deleted: two
readers drift. Gated by `tests/preset-harvest.spec.js` (executed: fixture sites on 127.0.0.1 through
the real reader in Chromium, the real builder, the real gallery).
- **Runs on GitHub, not here; a PR only READS, a dispatch PUBLISHES (2026-10-04).** This container
  has no egress to brand hosts; GitHub's runners do. `.github/workflows/harvest-presets.yml` on a
  same-repo PR touching the harvester, mapping, builder, reader or itself reads every site and
  reports (run summary + `preset-harvest-<run id>` artifact: screenshots, our renderers' shots, the
  manifest and a report per brand) with a read-only token, failing only on a gate. It used to commit
  40 brands' data back onto the PR - #131, a document-fetch lockdown, got 5c06501 - and that bot push
  produced `action_required` runs. Only `workflow_dispatch` from the default branch publishes: a
  separate job (the only one with write scopes) commits the data onto `claude/harvest-presets-<run
  id>` and opens its own PR; dispatched elsewhere it reads and says why it did not publish. The data
  commit carries `[skip ci]`, so no run starts for it and auto-merge (which fires on CI completing)
  cannot land it: a human reviews, then pushes any commit to start CI. GitHub matches the marker ANYWHERE in the
  head commit message, so a human commit that quotes it skips CI too - this change's own first commit
  did, and started no run at all. Gated by
  `tests/harvest-workflow.spec.js`, which runs the publish script in a real clone of a real local
  remote and asserts which refs moved (mutation-verified six ways).
- **A blocked read is an observation, not an empty one.** `renderer: rendered|blocked|timeout|
  unavailable` + the reason + `read_attempt`; no palette, type or logo. The preset keeps the neutral
  default and the card says one sentence (`<host> blocked an automated read on <date>.`). No stealth,
  no borrowed user agent, no colour from memory or a "brand colours" site. A failure of THIS
  environment (no browser, reader missing) is not a fact about a brand: nothing is written, the run
  fails. The builder refuses a palette from any read that did not render, even a file that carries one.
- **Every hex is measured or DERIVED from a measured one, labelled, exact value kept.** A dark site
  (`#121212` page) gets a white surface and a darkened ink, both `derived:true` with the exact
  values; a monochrome site keeps its black call to action as the primary (`from_role:'action'`);
  a site that renders no colour at all gets none. A brand's own web font is named and marked
  `loadable:false` - the card reads `<family> (brand font, shown in fallback)` and sets the name in
  the site's own fallback stack; only Google families are loaded.
- **Found by the first real harvest**: the reader's "brand colour" was, on three sites, a TINT of the
  page (the palest step of a token scale, `--hds-color-core-brand-25` = #f5f5ff; a pale tab; a pale
  chat pill), and one accent came off a cookie-consent button. The mapping passes over a colour under
  1.5:1 against the page or measured on a consent banner, takes the next one the site renders in the
  reader's own order, and records each `passed_over` with why; body copy measured white on a light
  page gives way to the heading/nav text the site renders before anything is derived.
- **What the read produced (run 37223429183, on the reader with #128 and #130)**: 21 of 40 sites
  rendered; 12 templates now carry the palette and families their site renders (airtel is
  `#d40000`, no longer `#000000`) and the 5 hand-verified palettes are kept; 4 rendered with no
  colour a preset can use (amazon, boat, samsung, spotify) and stay default with that reason; 14
  refused it (eight HTTP 403s, a Kasada, two Cloudflare and one AWS WAF challenge page, a robots.txt
  disallow, and a maintenance page the reader labels blocked) and 5 did not answer the reader's
  first-document request in time. Every one of those 23 says so on its card. An earlier run
  (37222438100, 14 minutes before) agreed on all 40 verdicts but Netflix (timeout there).
- **The card paints four NAMED roles** (primary/accent/surface/ink, `*` when derived) and its text is
  measured at AA in Chromium through every ancestor's opacity - the step fades in, and a measurement
  taken mid-fade reads 1:1.

## ⭐ Signing in with a phone never turns a feature off (2026-10-03)
The operator's words, with a phone screenshot of production `/onboarding` after signing in with a
mobile number and PIN: *"All features must work even with signin by number and pin"* (earlier: *"not
working after signin"*). Production is DEVICE mode (no `DATABASE_URL`, Supabase paused). #115 made
the server admit a device token from a page; the PAGES and several handlers never caught up, so a
person who had just signed in met "Not available on a mobile-number account", 403/404/409 sentences,
or an empty plan. Gated by `tests/phone-signin-features.spec.js`, `tests/phone-signin-everywhere.spec.js`
and the device-session state of `tests/signed-out-actions.spec.js` — every one EXECUTED against the
shipped routers, every fix mutation-verified.
- **The rule: what the server would answer, never the account type.** A phone sign-in (either mode)
  is ON. OFF only for a visitor with no session (remedy: sign in with mobile + PIN) and for a device
  sign-in on a deployment that NOW keeps accounts in a database (its token is not in `app_sessions`;
  remedy: sign in again). `brand-context.js` `readSite()` / `serverActions()`; `onboarding.html`
  `actionsOff()`. Never tell a signed-in person to sign in.
- **The server READS, the device KEEPS.** Anything that was refused because it was *filed* in a
  workspace table is read by the server and handed back: `deviceCatalogImport()` (one reader,
  `readCatalogSource()`, shared with the account import), `devicePackStep()` (the SAME context-pack
  stages over a one-request `memoryStore`, the browser drives the queue and carries its row),
  TeleSuite (`restOf(ctx)` → `deviceStore`: every op is the same code over what the request carries,
  writes come back as `device`), the concierge (`deviceChat`, agents kept on the device), Smart Brain
  decisions (`calendar.js DEVICE_DECISIONS`: approve builds exactly as preview, nothing persisted).
  The browser keeps each beside the brand under the per-account namespace, so another person on the
  same browser sees none of it, and deleting the brand deletes them.
- **The device brand travels with every request.** `brand-context.js` carries `BrandContext.carry()`
  on every JSON POST to `/api/brain|calendar|ai/*` for a phone sign-in — the device twin of the
  `workspace_id` stamp. Without it Daily Sync planned for an UNRESOLVED brand and came back empty, and
  Generate plan failed `markets_required`. Pages no longer remember it call site by call site.
- **A page's FIRST request left signed out.** `auth.js` loads deferred and wraps `fetch` later, and a
  device brand's requests went out through `brand-context.js`'s captured native fetch: the stored
  phone token is attached there now (`deviceSend()`/`phoneToken()`).
- **A model of the server cannot find what the server does.** The sweep's device-session state used
  to answer every gated op "ok", so TeleSuite's 403, the concierge's 404, Smart Brain's 409 and two
  long-standing bugs for EVERY caller were invisible to it: `Credits.api('usage&days=30')`
  URL-encoded the whole string (the usage and ledger panels never loaded), and `ad-campaigns.html`
  read the plan from `/api/brain`, which has no `smart-brain-*` action. Run on the real routers that
  state reports 13 defects on main and 0 here.
- **Not opened, on purpose**: no token, a forged JWT, and a device token with no Origin still reach
  no model and read no store (`phone-signin-features` executes all three for every op it opened).
  The concierge for a phone sign-in does NOT use `chat()`: that prompt is tenant zero's (craft facts,
  guardrails), and running another brand's customers through it would put one company's claims in
  another's assistant. Data-analysis views answer a phone sign-in's honest "not connected" state,
  never the deployment's connectors, and a delivery test is not sent through the operator's channels.
- **Known limits, said not hidden**: a device catalogue is not yet carried to the GENERATORS
  (ads / landing pages / mailers render their DATA REQUIRED marker for product imagery); sending
  (dispatch) and platform connections need encrypted secrets a device does not hold; Smart Brain's
  plan-maintenance actions (heal, activate-scenario, recalibrate) still refuse — the console calls none.


## ⭐ Phone accounts live in Supabase Auth (2026-10-03) — read `docs/mobile-pin-signin.md` ("Supabase mode")
The operator's words: "use supabase cli and remote host for supabase account creation", "All features must
work even with signin by number and pin" (and: the new project is `lifecycle-os`, never named after a tenant). A phone account in
Neon or the browser has no Supabase identity, so every RLS-gated feature refused it after a sign-in that had
visibly worked. Now `op=status` answers **`supabase` first** (SUPABASE_URL + a server key set AND
`GET /auth/v1/health` answers) > `server` (Neon) > `device` (unchanged, incl. #115's device principal); a
configured project that does not answer falls through and says so (`supabase:{reachable:false, host}`).
`api/_shared/mobile-auth-supabase.js` brokers every op in that mode (still 12/12 functions).
- **The PIN is never the GoTrue password.** GoTrue's minimum is 6, and 4 digits on the public password grant
  is 10,000 guesses for anyone with the anon key. Password = `"Pn1." + base64url(HMAC-SHA256(MOBILE_PIN_PEPPER,
  "lifecycle-os/mobile-pin/v1|" + E.164 + "|" + PIN))`, derived only on the server. No pepper (or < 32 chars):
  `enter` is refused 503 `pin_pepper_missing` before ANY request. Rotation via `MOBILE_PIN_PEPPER_PREVIOUS`.
- **Lockout before GoTrue, in one statement**: `mobile_pin_attempt()` reserves the try (and sets the lock) under
  the row lock, so 20 concurrent wrong PINs evaluate at most 5. **A grant refusal counts as a wrong PIN unless it
  is 429, 5xx/no answer or `phone_provider_disabled`** - whitelisting `invalid_credentials` instead would refund
  any code the service adds later (fail closed). Per-address budget: `mobile_pin_rate_hit()`, hashed address.
- **Trusted marker in `app_metadata`** (`lifecycle_account:'mobile-pin', phone_e164`), which only the service
  role writes; a marker in `user_metadata` is ignored (tested with a forger). `requireUser()` answers
  `{provider:'mobile-pin', mode:'supabase', phone}`, so credits keep the phone rules (unlisted: no wallet, no
  welcome grant; `CREDITS_COMP_PHONES`: one personal wallet keyed to the Supabase uid, free recharge; the
  operator emails unaffected), while `brand-runtime`/TeleSuite read its workspaces through RLS like any account.
  **Every GoTrue-verified principal is `mode:'supabase'` and never takes the meter's standalone bypass**, and a
  device-shaped token is refused while the project answers - otherwise "no DATABASE_URL" would run every phone
  account unmetered beside a live ledger.
- **Browser**: `lifecycle.auth.session` holds `{token, refresh_token, expires_at, mode:'supabase'}`;
  `apiToken()` = the access token; renewed a minute before expiry straight against
  `/auth/v1/token?grant_type=refresh_token` with the ANON key (per-IP limit = the person's address, not
  Vercel's), one renewal at a time across tabs; handed to supabase-js via `setSession()`; sign-out revokes via
  `POST /auth/v1/logout`. brand-context sends a VERIFIED Supabase phone session down the server path (brands
  saved to the account); unverified stays on the device; device rows are offered for sync, never uploaded.
- **Every endpoint is cited** (docs page + the Auth server's OpenAPI; `adminUserCreate` read in its source to
  confirm it ignores the sign-up switch). **Schema is CLI migrations**: `20260929173555_mobile_pin_supabase_accounts.sql`;
  duplicate/future version prefixes renamed so `supabase db push` accepts the set (measured from zero on a local
  Postgres 16). `supabase/config.toml`: `project_id = "lifecycle-os"`, public sign-ups off, Phone provider on.
  Runbook targets a NEW project `lifecycle-os` (`<project-ref>`); no remote was touched (no access token, egress
  blocks supabase hosts, the org has unpaid invoices).
- **The spec waits on events, never on the runner's clock (2026-10-04).** Two of its tests timed out in CI
  with a bare "Test timeout" - what Playwright prints for a NODE-side await, and here the error that failed
  first was lost with it: `finally` awaited `server.close()`, which keeps a socket the still-open page was
  using and serves it on keep-alive until it goes quiet. `stopApp()` ends every connection; every wait is
  bounded and names what it waited for (`within()`, `expect.poll` messages); op=status is HELD by the test
  and the PAGE clock is moved past the old 6-second release (`page.clock`), not slept towards; a fetch
  recorder in `wire()` says what the page sent at the moment it sent it. CI now uploads `test-results/`
  (traces) on failure - `--reporter=list` meant `tests/report/` was never written.
- Gated by `tests/supabase-phone-accounts.spec.js` (18 executed, incl. Chromium against the shipped handler)
  over `tests/supabase-auth-fake.js` (exactly the endpoints called; throws on anything else). 19 mutations of
  the security checks each fail it. The ten tests that were red on main at the time are fixed by #118's
  `claude/main-ci-green`, merged here; with it the meter is keyed on the principal (only a device principal is
  unmetered), which a Supabase-verified user never is.
- **Follow-up after #119 (fourth round):** `reachable` (the project answers - always probed) is kept apart
  from `offerable` (also has a browser-visible key); a device principal exists ONLY when no ledger answers at
  all (auth health OR the ledger's own `credit_prices` read), so a live project with no public key can no longer
  run leftover device tokens unmetered; a Neon session is still admitted (metered) when supabase mode is not
  offered. The boot gate withholds a stored device token (also from `apiToken()`) until `init()` DECIDES - no
  6-second release. Agents harness device worlds model the paused ledger. 36 tests.
- **Second and third review rounds (32 tests): ONE session state shared by every tab.** The stored record carries
  `state` (`verified`/`unverified`) and every transition is written there first and applied from it: another
  tab signing out ends the session here; another person signing in replaces it whole; an adopted renewal carries
  its verified state; a scheduled renewal that cannot be made marks it unverified (no dead token sent, brands on
  the device). A device account made while the project was down keeps working when it returns, sends no token
  the server refuses (pre-boot calls WAIT for the decision; the config and auth calls, which decide, never wait),
  and is offered the move (same number + PIN; device brands offered for sync). Server: a Supabase JWT is routed
  by the TOKEN (never to Neon's session table on one failed probe); `/api/public-config` publishes the one public
  key the broker accepts (never a server key) and no key means no supabase mode; and **the adoption path
  (`phone_exists`) reserves a lockout try first** - migration `20261003142200_mobile_pin_lockout_covers_adoption.sql`,
  measured: 30 concurrent pending attempts allow exactly 5. CI caught a test reading a save's status before
  the response finished; it now waits for the answer.
- **Review findings, both reproduced first** (25 tests then): a renewal that could not be MADE (host down, 429,
  5xx, no config, an unrecognised refusal) no longer ends the session - only the documented refusals
  (`refresh_token_not_found`/`_already_used`, `session_not_found`/`_expired`, `user_not_found`, `user_banned`)
  do; the session is kept unverified, said, retried, and re-verified when a retry succeeds. And two tabs no
  longer spend one single-use refresh token: the renewal runs under a Web Lock, re-reads storage inside it, holds
  the lock briefly after writing (another tab's process sees localStorage a moment later - measured: without the
  hold, 1 in 5 races still spent the token twice), and checks storage twice before believing a refusal.
## ⭐ Main was red for three days, and every cause was real (2026-10-03)
PR #115 (`e67304a`) and PR #116 (`05d0e42`) were merged with failing CI; production deployed anyway.
52 Playwright tests and the brand-isolation build step were red. None was flaky:
- **The meter keyed on the PROCESS, not the principal.** `credits-core.meter()`/`handle()` skipped
  metering when `standaloneMode()` - DATABASE_URL, the Neon phone-SESSION store, is unset. The
  credit ledger is the workspace Supabase project, so a caller whose Supabase JWT had just verified
  against a live project ran every paid feature free, and a server-mode phone account skipped the
  listed-number refusal. 45 credit tests failed because CI has no DATABASE_URL either. Only a
  device principal (which exists only when there is no DATABASE_URL) is unmetered now. `metered()`
  also returned early for any unmetered gate, dropping the device receipt (`charged: 0`) the
  standalone spec asserts.
- **Running a thing finds what blocking it hid.** Once a device session could complete the agentic
  run, every row of Smart Brain's "Assets by day" read `[object Object]` - the orchestrator put the
  cohort RECORD in a summary cell. `agentic-orchestrator.js` now emits its name.
- **A test aimed at the whole page caught the feature's own status line.** agents-pages looked for
  "saved on this device only" anywhere in the body; PR #115 made the rail SAY that
  (`#lnav-umode`, "Local / Demo Mode. ..."). The rail line is asserted on its own and excluded from
  the refusal check. A poll on the RESPONSE of a run with its own 15 s asset budget used a 15 s
  timeout; it now waits for the request to leave, then for the answer.
- **A harness that is not the server.** signed-out-actions answered brand-chat with a generic
  `{ok:true}` for a device session, and KicksGPT rightly said "answered without a reply". The
  harness reads `MODEL_FEATURE` from `api/brain.js` now instead of a hand-kept list.
- **A presets directory holds presets.** PR #116 wrote 40 `<slug>.observed.json` sidecars into
  `data/brands/presets/`; every reader there treats each `*.json` but `index.json` as a brand, so
  the isolation gate rendered 39 nameless brands from tenant zero's defaults (`assets · undefined`).
  They live in `data/brands/observed/`, and the gate refuses a non-brand file by name.
- **A real photograph is not a placeholder line's picture.** The same build dealt each home page's
  images out to placeholder catalogue rows in order ("Signature Blend 01" got a touch icon). The
  photographs stay in `brand_assets` with their page; placeholder rows stay image-free (tested).
- Local runs cannot download WebKit, so the 24 `studio.spec.js` tests on iphone-se/iphone-12/ipad
  run only in CI. Do not merge on red: the rule is every push and deployment green.

## ⭐ Features run without DATABASE_URL (2026-09-30) — read `docs/mobile-pin-signin.md`, `docs/agents-status.md`
Production is device mode (`no_database_url`) with model keys and no Neon. Until this date
`LifecycleStatus.refusal()` blocked every server action for a device-mode sign-in, `apiToken()`
never sent the token, `verifyToken()` returned `no_database`, and the credit meter 503'd against
the paused ledger — so no feature ran. A well-shaped device token **from a page** (Origin/Referer)
is now a `mode:'device'` principal (`user.id` = `device:<hash>`, no phone from the body); features
run unmetered (*Local / Demo Mode*). Anonymous (no token), a forged JWT, and a token with no
Origin still do not reach a model. A deployment that HAS a database still refuses a token that
is not in `app_sessions`. TeleSuite still refuses a phone account. Gated by
`tests/standalone-no-database.spec.js`.

## ⭐ Every agent answers a phone account, and only a listed number spends (2026-09-29) — read `docs/agents-status.md`
PR #112 (`48dfa26`, `3425ff7`) executed every agent action in three states and fixed what running them
found: a phone token fell through `workspace-scope.resolve()` as USERLESS and was scoped to the oldest
workspace, so KicksGPT answered a phone account as tenant zero; `brand-runtime.resolve()` threw for it and
fell back to tenant zero's record; the TeleSuite registry, brand-tools, the Agent Builder spec and jarvis got
the demo envelope, so the hub could not start signed out; every chat action got an envelope with no `reply`
and the pages printed "undefined"; `telesuite context()` threw restAs's 403 out as a 500; brain.js's catch
flattened a refusal, a store outage and a crash into one 500. A phone request now runs as the brand record
it CARRIED (`brand-runtime.carriedBrand()`, re-keyed to a `device:` id) or the unresolved placeholder.
- **`CREDITS_COMP_PHONES`, and why no migration.** A phone sign-up is free, unverified and unlimited, so a
  wallet per number is an unlimited faucet on the provider budget: an UNLISTED number is refused before any
  wallet row or welcome grant exists. A listed number (E.164 through `phone-rules.normPhone`, hashed, matched
  WHOLE - a prefix, a suffix or another country code is not it) holds one PERSONAL wallet and is metered on
  it; its recharge is `comp_account`, never a payment. `credit_wallets.user_id` has no foreign key and every
  ledger function takes `p_user uuid`, so a Neon `app_users.id` (a v4 uuid) is a valid owner as the schema
  stands; `workspace_id` IS a foreign key to `brand_workspaces`, so a phone wallet is always personal. The
  three operator emails (`COMP_ACCOUNT_HASHES`) are unchanged and their executed tests pass.
- **#112 merged 16 seconds after it was opened, before review or CI.** CI failed on it and on main
  (`contrast-rendered` onboarding, below). The review ran afterwards, as a reviewer who wanted defects,
  through the SHIPPED routers: every brain.js action (enumerated from its own case labels) x GET/POST x
  seven caller shapes, and every calendar.js smart-brain action, with a scripted `llm.js` and a fetch that
  throws on unclaimed hosts (`tests/agents-review.spec.js`, 20 tests: the first 19 all FAIL against main's
  sources, and 21 mutations - each restoring one defect - fail the test that names them).
- **An open model proxy on the router with the most of them.** The browser-attribution rule counted a
  header's PRESENCE, so a forged bearer or a device-mode token (the one the browser never sends) stepped
  past it; an anonymous POST with no Origin needed nothing at all. Both reached brand-chat, console-chat,
  team-chat, agent-analyze, access-narrative, agentic-run (26 model calls and a crawl of tenant zero's
  site), social-run-daily and a video provider. Now: a token attributes only if the backend did not refuse
  it, and a refused one gets its own 401 sentence; the 14 model actions (`MODEL_FEATURE` in brain.js) are
  metered at existing catalog keys - the meter refuses anonymous (401) and unlisted (403) before the
  handler - and gated again in the handler for a deployment whose meter is unconfigured. The scheduler's
  bearer is free. `requireUser()` is memoised per request, so four gates cost one verification.
- **"Only a listed number spends" was true for the credits router and nowhere else.** An unlisted phone
  account ran every brain agent unmetered, and generate.js too wherever `SUPABASE_SERVICE_ROLE_KEY` is
  unset (enforce's `optional` path). `credits-core.spenderRefusal()` applies the list in require-caller,
  brain.js and calendar.js whatever the meter's state.
- **A phone account touched tenant zero's rows, twice over.** `workspace-scope.resolve()` honoured a
  caller-named `workspace_id` before it asked whether the caller was a phone account (reads of another
  workspace's agents, calendar and campaigns; PATCHes of its social posts; `ownsBundledExport` true, so the
  bundled sales export reached the analyst). And `SmartBrainDbAdapter.workspace()` turned the router's
  correct `null` back into the OLDEST workspace one layer down - team-chat, agent-analyze and the whole
  smart-brain plan read tenant zero's products, campaigns and metrics with no injection at all. The #112
  test asserted `config.workspace_id === null` on a STUB, which is exactly the value the adapter then
  replaced: a stub stands in for the layer where the defect was. calendar.js never set `req.__brand`, so
  preview/approve stamped tenant zero's brand; preview/approve built a campaign from a CALLER-SUPPLIED
  entry for anyone; sync/feedback/approve wrote rows with no `workspace_id`. Now the oldest-workspace
  default is the scheduler's only (`requestHasUser()`), the adapter refuses an unstamped scoped row, a
  person with no workspace computes but never persists, approve/reject/feedback are `409 no_workspace`, and
  the built-catalogue fallback is `ownsBundledExport`'s alone.
- **A carried record could claim to be tenant zero.** Its slug was the client's, and tenant zero is
  recognised BY SLUG (`isTenantZeroBrand`, `planningBrand`, the assistant's name) - `slug:"knickgasm"`, which
  the KNICKGASM preset in the gallery carries, pinned the shipped catalogue. The slug is the device id now;
  typography, palette and catalog_source were arbitrary nested objects ("bounded" held for the strings beside
  them) and are one level of short scalars; offerings keep their `{kind,name,url}` records, which the first
  cut dropped as non-strings.
- **Public means for nobody.** jarvis and the Agent Builder spec, made public for a signed-out page, were
  answered as the DEFAULT workspace (scoping had already resolved it): tenant zero's storefront and name.
- **A `CRON_SECRET` of 64 hex characters has a phone token's shape** (`[A-Za-z0-9_-]{40,90}`), so the cron
  read as a phone account with no workspace. The scheduler's own bearer is excluded, constant-time.
- **CI's red on `5d2ad8c` was a real defect that looked like a flake.** The credit chip ("— cr") is appended
  ~1.5 s after the brand paints, and the page-wide contrast probe usually ran first. Its text was
  `--brand-primary-dark` - a hover shade nobody adjusted for text - on a 12% tint over the wizard's primary
  button: 1.76:1, and the FREE state 2.94:1. The chip paints its own surface now with the AA-adjusted text
  token; three deterministic cases WAIT for the chip, in the placeholder, free and paid states.
- **A store that does not answer is said as such.** With the agents metered, a paused ledger answered every
  listed account `502 credit_check_failed` whose message was a PostgREST URL; it is `503
  backend_unreachable` naming the host.
- **Recorded, not changed**: an anonymous SERVER-TO-SERVER caller can still WRITE through agent-upsert,
  analyze, calendar-generate, calendar-review, config, feedback, mvt, os-run-daily-job, social-approve and
  social-skip, and a caller-named `workspace_id` is still trusted for an anonymous caller - the ungated
  posture of 2026-09-28, now measured as writes and pinned by name. None of them reaches a model any more.
- **Production is `2b2a992`** (no deployment exists for #108 onward), in device mode (`no_database_url`),
  with four model-provider variables set and no `DATABASE_URL` or `CREDITS_COMP_PHONES`. On that commit the
  anonymous model routes above are open; they were not probed, because probing them spends the keys.
  `docs/agents-status.md` has every surface, what it needs, what production answered and what unblocks it.

## ⭐ An agent branch does not spend the team's deploy budget (2026-09-29)
`vercel.json` → `"git": { "deploymentEnabled": { "claude/**": false } }`, gated by
`tests/vercel-deploy-quota.spec.js` (4 tests, executed with the real `minimatch`). Vercel refused the
last two pushes to main, `d9ac6a7` (07:24 UTC) and `61e34fc` (09:05 UTC): *"Deployment rate limited -
retry in 24 hours"*. Nothing was wrong with either commit.
- **The cap is the TEAM's, not this project's.** Hobby allows 100 deployments per rolling day across
  every project in the team. Measured at 09:10 UTC: 95 READY in the previous 24 hours - lifecycle-os
  38, anchit-work-portfolio 22, parwah 17, airpane-ar-browser 6, anchor-autopilot 4, parwah-hq 4,
  predict-natural-disasters 4. Of this project's 38, 17 were production (main) and **21 were PREVIEWS,
  every one of a `claude/<something>` branch**. Once the cap is reached, production is refused for
  EVERY project in the team, not only for the one that spent it.
- **A preview spends exactly what production needs.** An agent branch is pushed many times (merges of
  main, fix-ups, review rounds) and each push was one of the 100. Nobody opened those previews: review
  happens on the diff and on CI.
- **The same cause blocked merges.** A rate-limited preview posts a FAILED Vercel status on the PR
  head, and `auto-merge.yml` refuses any PR with a failed commit status. A MISSING status blocks
  nothing - the script refuses only `failure`/`error` statuses and failed or pending check runs, and
  the happy-path case in `workflows-guarantees.spec.js` already merges a head that carries no Vercel
  status at all.
- **CI is the build check for a PR, not a preview.** `ci.yml` runs `npm run build` and the full
  Playwright suite on every PR. A preview proved only that Vercel could build the branch, which the
  production build of main proves again on merge.
- **Vercel reads `vercel.json` from the commit being deployed**, so an EXISTING agent branch keeps
  spending previews until its head carries this change (merge main into it). `main`, `final-product`,
  `snowflake-streamlit-app` and every human branch are untouched: a branch no key matches deploys.
- **A human who wants a preview of one agent branch** runs `vercel deploy` from that checkout (`/ship`
  without `prod`) or creates a deployment from the dashboard: `git.deploymentEnabled` governs only
  Git-triggered deployments. That spends one of the same 100, so it is a choice, not a default - as is
  the deploy hook `deploy-guarantee.yml` fires after an auto-merge once `VERCEL_DEPLOY_HOOK_URL` is set
  (no two of the window's 17 production deploys share a commit, so it added none then).
- **The test models Vercel, then checks the model.** It evaluates the rule under the documented
  semantics (exact names and minimatch globs; a branch several rules match deploys when at least one
  is true; an unmatched branch deploys), and first runs that evaluator over the docs' own examples, so
  a wrong model of Vercel cannot make the config look right. `claude/*` passes a text check and still
  deploys `claude/a/b`; the spec fails on it. It also asserts every other top-level key equals main's
  (the merge-base with `origin/main`), skipping when there is no `origin/main` (CI's shallow checkout)
  and retiring once main carries the rule, so a later rewrite is never pinned by it. Mutation-verified:
  removing the rule, narrowing it to `claude/*`, widening it to `**` and changing `buildCommand` each
  fail it. `minimatch` is a declared devDependency now; it was only present through `c8` and
  `@capacitor/cli`.

## ⭐ Every action works signed out, or says what needs sign-in, in ONE sentence (2026-09-29)
`tests/signed-out-actions.spec.js` + `auth.js` → `window.LifecycleStatus` (`refusal` / `decide` / `show`).
2026-08-30 proved every page OPENS signed out and 2026-09-15 proved the wizard's commands work on the
device; nobody had pressed the rest of the product's buttons in the state the ordinary visitor is in.
The sweep drives every visible control on every page that loads auth.js (50 pages, ~325 activations
per state after de-duplication by signature) in THREE states - a reachable backend with no session,
an unreachable one, and a mobile+PIN session kept on this device - with the Times of India preset
active from the device store, and classifies each activation: worked locally (a DOM change, a
download, a blob, a window, the clipboard, the device store), said what needs sign-in (`.vh-status`,
accent rule), or disabled with its reason. A dialog, a page error, a failure frame for the ordinary
state, a raw code, a 401 rendered as an error, a silent 401 or a dead click is a defect.
- **The same shape on nine pages**: the handler asked the server FIRST, the server answered 401
  `sign_in_required` exactly as it should, and the page painted it red - `calendar.html` did so ON
  LOAD (`autoPlanOnce` → `generatePlan`), so the first thing every signed-out visitor saw was
  *"Failed to generate the plan {"ok":false,"error":"sign_in_required"...}"*. Also `credits.html`
  (usage + ledger + the three period buttons), `brand-connections.html`, all five
  `data-analysis.html` tabs, `publishing.html`'s dispatch log, `telesuite.html`, `lifecycle-calendar`;
  `payments.html` printed `(sign_in_required)` inside a sentence. Being signed out is the most
  ordinary state there is, and a fault frame for it teaches people the frame means nothing.
- **One decision, before anything is sent, one sentence per state.** `LifecycleStatus.refusal(what,
  {metered})` reads the record auth.js already publishes and answers null (a verified server-mode
  session, the localhost preview, an undecided boot - the server judges) or an Error carrying the
  state's sentence: `signed-out`, `unreachable` (names the host), `unconfigured`, `device-session`
  (the server cannot verify an account that exists only in this browser; its token is never sent),
  `unverified-session`, `no-wallet` (a phone account asked for a metered feature - credits-core's own
  refusal, said before the request). Pages throw it from their request helper, so every existing
  `catch` → `LifecycleFailure.show()` renders the status line: `LifecycleFailure.html()` recognises an
  ordinary refusal - its own, or the server's `sign_in_required` / `credits_require_account` /
  `account_type_unsupported` - and hands it to `LifecycleStatus`. A 503 from a paused backend on a
  request that WAS made stays the failure frame; that is what the frame is for.
- **Decide after auth.js has decided.** `brand-connections.html` still opened red in the UNREACHABLE
  state only: its `load()` ran before the reachability probe had failed, `refusal()` saw `pending`,
  answered null, and the 503 came back as a frame. `decide()` awaits `LifecycleAuth.backendState()`
  (bounded by the gate's 8 s). A live host answers faster than a dead one fails, which is why the
  signed-out run passed and the unreachable one did not.
- **A dead click is a defect even when the box is empty**: Ask / Send / the Studio copilot's ➤ with
  nothing typed did nothing at all. "Type a question first." beside the box, in the accent rule.
- **Two pages threw on load under any brand but tenant zero**: `premium-experience.html`'s
  `renderMailer()` wrote to a rating badge the brand layer had already stripped, and
  `connector-3d.html`'s engine called `render()` back into a wrap `gateShipped` had replaced with the
  marker. A missing node is a state a render tolerates; a gated demo stops rendering.
- **The harness had to earn its verdicts**: a ticker mutates in two consecutive windows, a load-time
  settle in one - only the intersection is excluded, or the calendar's day chips (re-synced once by
  `region-context.js`) read as dead; a read 150 ms after a press sees "Generating…" and misses the
  frame the 401 then draws, so the read waits for the press's own API requests to settle; the credit
  pill's balance poll landing inside a click window is not that click's 401; `.chip`/`.tab` spans with
  no handler are badges, not controls; a `<select>` is an input whose value changing IS the outcome;
  blocked CDN globals (`Chart`, `Papa`, `JSZip`…) are stubbed so a page is measured on its own code.
- **Tests that asserted the frame for a request the page no longer makes moved to the state where it
  still does**: `error-presentation`'s ledger and TeleSuite cases drive the localhost preview (the
  2026-09-28 precedent). Mutation-verified: restoring the server-first calendar handler, the silent
  Ask, or a native `alert` each fails the sweep on that row.

## ⭐ Whose brand a bare /lp link wears, and what a gated block is exempt from (2026-09-29)
Four post-merge review findings on PRs #102/#103, each reproduced by an EXECUTED test first
(`tests/router-calendar.spec.js` over the harness, `tests/audit-pages.spec.js` driving
`scripts/audit-pages.js` as a module) and each mutation-verified.
- **The /lp/:id FALLBACK wore tenant zero's brand on another tenant's campaign.** An ordinary
  `/lp/<id>` link carries no `workspace_id` (that is how `smart-brain-plan.js` and `smart-brain.html`
  mint them), so `brandForWorkspace` was skipped and `buildFallbackLanding` fell through to its
  `defaultBrand()` door. Executing it found the defect one layer deeper: `SmartBrainDbAdapter`
  scoped the lookup to the DEFAULT workspace, so another tenant's PERSISTED page was never found
  either - every bare link fell to the fallback, and the fallback was tenant zero's. The id is the
  capability (the database already serves the row to `anon` by id for exactly this route), so it is
  now a **guarded point lookup across workspaces** (`anyWorkspace`, refused unless by id with
  `limit 1`), the row's own `workspace_id` rides `diag` and decides the brand, a calendar slot that
  advertises the id names it when no row exists yet, and with no record the page is **NEUTRAL** with
  a `[DATA REQUIRED BEFORE LAUNCH: brand and landing page, campaign <id>]` marker - system colours,
  nobody's palette. `buildFallbackLanding` no longer reaches for `defaultBrand()`; the shipped
  record is used only when the record itself is tenant zero's (the oldest workspace), and a link's
  `?workspace_id=` is ignored, because reading it would let any link name any brand. The fake
  PostgREST in the spec APPLIES the URL's filters, so a lookup carrying the wrong workspace finds
  nothing exactly as the real database would.
- **`force` is a boolean and a query string carries strings.** `!!(body.force || q.force)` read
  `?force=false` and `?force=0` as true and skipped `buildLifecycleMailer`'s retrieve-first path: two
  LLM calls and the persisted mailer overwritten, on a request that said not to. `1`/`true`/`yes`,
  any case, enable; nothing else does.
- **A gated block is exempt from the CHROME rules, not from the rules that apply everywhere.**
  `data-ms-built-for` / `data-shipped-for` blocks were stripped once, up front, before every text
  rule - so a fabricated rating, a banned phrase or a dash inside one was never inspected, though the
  owning tenant reads it and rule 2 says "everywhere". Two texts now: `text` (code stripped, nothing
  else) for the everywhere rules, `chrome` (gated blocks removed) for every `!isAsset` rule - the
  same split the page-level BRAND_ASSET classification already makes. 66 pages, still 0 blockers.
- **The balanced walk ran on RAW html and failed OPEN.** `<!-- <div data-shipped-for="x"> -->` (or
  the same in a script string) has no close, so the walk advanced to EOF and everything after it -
  blockers included - was skipped. Comments, scripts and styles are stripped in ONE left-to-right
  pass (three separate regex passes have an order-dependent hole either way round), the walk runs on
  the result, and an unbalanced gate now strips NOTHING and is reported as `gated-unbalanced`: a
  malformed gate earns no exemption. The comment tests assert the blocker AND the absence of that
  warning, because the fail-closed half alone would keep the blocker and add noise nobody reads.
- Left as found: the `X-KNICKGASM-LP` header and `knickgasm-lp-<id>.html` download name on the lp
  path are tenant-zero literals that predate this round; the router spec still asserts them by name.

## ⭐ The app chrome is Lifecycle OS's mark, never a tenant's - even in the tab (2026-09-29) — read `docs/platform-identity.md`
`assets/lifecycle-os-mark.svg` + `scripts/build-platform-mark.js`, gated by `tests/platform-identity.spec.js`
(8 tests, executed: 45 app pages rendered in Chromium under TWO brands, the manifest fetched, `sw.js` run
in a vm, every raster's pixels read). A screenshot of the browser tab showed tenant zero's logo. The app IS
the active brand in its palette, fonts, name and copy; it is NOT the brand in the tab, the touch icon, the
manifest, the share card, the rail wordmark or the launcher - those identify the TOOL, and every one of
them was `favicon.png` (tenant zero's mark). `brand-context.js` then wrote the active brand's
`favicon_url || logo_url` onto `<link rel=icon>` and REPLACED the rail mark with the brand's logo, so the
product had no mark of its own anywhere a person looks first.
- **Three kinds of mark, three sources.** PLATFORM chrome = the mark, always. The ACTIVE brand's logo =
  ITS record (`brand.logo_url`) in the brand slot beneath the wordmark (`.lnav-brandlogo`, written only by
  `brand-context.fillBrandSlot()`), else a monogram of its name - never another tenant's file. Tenant
  zero's OWN artefacts = the frozen `diff-version` snapshot, the only remaining referrer of `favicon.png`.
- **One SVG, every raster rendered from it** (no pure-Node rasteriser is installed; Chromium is, so the
  PNGs are committed - Vercel's build has no browser). Three shapes because three consumers crop
  differently: `any` (rounded, transparent corners), `fullbleed` (iOS paints transparent touch-icon
  pixels BLACK; a maskable icon is cropped to a circle), `glyph` (the Android adaptive foreground, inside
  the centre 66/108). The mark's three colours are neutral by the audit's OWN `lowSat` rule, now exported
  from `scripts/audit-pages.js` together with `BRAND_ASSET`, whose body became `main()` so a spec can
  import the classification instead of copying it.
- **The inline rail mark carries NO hex**: glyph in `currentColor`, tile in `--vh-panel-2`. The gate
  asserts its rendered stroke equals the wordmark's ink and is neither the brand's primary nor its accent,
  so a mark that re-colours itself per tenant fails.
- **Found by RUNNING it, not by reading it**: the SVG's comment said `--brand-*`, and `--` inside an XML
  comment makes the file malformed - every consumer decodes it as nothing, silently; only `img.decode()`
  in Chromium reported it. Two app pages are `meta refresh` stubs, and a harness with no rewrites measured
  a 404 body as "no icon at all" - it reads the deployment's exact rewrites from `vercel.json` now. And the
  harness's aborted cross-origin image loads tripped the slot's own broken-logo fallback (monogram +
  `data-brand-logo-failed`), hiding the URL under test: images are answered with a 1x1 PNG.
- **`sw.js` is asserted by executing its install handler** and reading the array it hands to
  `caches.addAll()`, not by a regex over the file. 59 root pages + 37 generated `reports/growth-book/
  playbook` pages carry the same identity block; 16 pages had no icon at all and got the browser default.

## ⭐ The money and send paths are EXECUTED, and four of them were wrong (2026-09-28)
`tests/lib/fake-supabase.js` + `credits-meter-executed`, `dispatch-queue-executed`,
`oauth-handshake-executed`, `deliverability-gate-executed` (57 tests). `coverage/UNTESTED.md` ranked
the queue, the vault, the meter and the gate among the worst load-bearing files: every test on them
was a pure-function test, and nothing ran a hold, a lease, a callback or a resolver. The modules now
run UNMODIFIED against an in-memory GoTrue + PostgREST that enforces the two facts their correctness
rests on instead of trusting the caller - the `dispatch_jobs (workspace_id, idempotency_key)` UNIQUE
INDEX answers a second insert with 23505, and RLS shows a user's token only its own workspaces - with
the ledger RPCs re-implemented from `20260809130000_credits.sql`, `global.fetch` throwing on any URL a
case did not route, and `dns.promises` a zone table controlled per name, code and retry count. Every
assertion is on what was held, settled, refused, leased, stored, redirected or scored; none reads
source, so the executed-tests ratchet is untouched (178, 45 files). Eleven mutations verified.
- **`?op=fulfil` could never be reached.** The operator confirms an off-platform payment with
  `CRON_SECRET`; the op sat below `requireUser()`, which verifies the bearer against `/auth/v1/user`,
  then compared the SAME bearer to the secret. No token satisfies both, so every real purchase (not
  comp, not `CREDITS_ALLOW_SELF_SERVE`) stayed `pending` for good. The case read as correct; only
  driving the router showed it. The operator branch now runs first, compared in constant time.
- **A sign-in could START on a deployment that could not store its result.** With no
  `CONNECTION_SECRET_KEY` the operator consented at Klaviyo, the code was exchanged, and
  `persistGrant()` threw 503 out of `handleCallback()` - OUTSIDE the router's try/catch - so a
  browser navigation ended on a JSON 500 with the code spent and the token dropped. `oauth-start`
  refuses 503 up front and writes no state; the callback re-checks BEFORE the exchange
  (`reason=vault_unavailable`); a throw in the callback is a redirect with a reason, never a body.
  And `safeReturnTo()` keeps a query on purpose, so `/publishing?tab=hub` landed on
  `tab=hub?oauth=connected` and the page could not say the connection had succeeded (`landing()`).
- **A PAUSED warmup never blocked.** The paused branch was nested INSIDE `status === 'active'`, so
  the send went out at exactly the moment the throttle had said stop. A DNS outage on the A lookup
  was reported as "No A record for <domain>" - a fact about us stated as a fact about the domain, the
  confusion the module's own header refuses. `resolveRecord()` promised to carry the system error and
  `doh.error || sys.error` dropped it every time. A Facebook caption was scored for lacking a subject
  and an unsubscribe link (bulk EMAIL law): `analyzeContent({ emailRules })`, default unchanged.
- **The fake is faithful where it matters and nowhere else.** A fake that accepted a second identical
  row would pass a queue that double-posts; one that answered every URL would pass a send that
  escaped the kill switch. Column defaults, `Prefer: count=exact` and `resolution=merge-duplicates`
  are modelled because the modules read them; nothing else is.
- Coverage (`npm run coverage`, both Chromium projects, `3f1de02` → this branch): credits-core
  417/736 → 761/766 lines, dispatch-core 169/543 → 539/543, oauth-core 174/515 → 557/557,
  deliverability-core 454/764 → 780/782, preflight-core 168/250 → 256/262,
  workspace-connections-core 877/1141 → 994/1152; combined 56.0% → 58.0% (`coverage/UNTESTED.md`).

## ⭐ The four ?action= routers are EXECUTED, and executing them found what reading never did (2026-09-28)
`tests/router-{brain,calendar,competitor,kb}.spec.js` over `tests/router-harness.js`. `api/brain.js`,
`api/calendar.js`, `api/competitor.js` and `api/kb.js` front almost every feature; until now no test
loaded three of them and only half of the fourth ran (`coverage/UNTESTED.md`: brain 0/1205, competitor
0/560, calendar 0/458, kb 431/862). Each spec requires the SHIPPED module - `credits.metered` and
`request-scope` wrappers included - and drives it over a real `http.Server` with the Vercel request
shape (the same drained-and-restored stream replica `meta-webhook-raw-body.spec.js` mirrors from
@vercel/node), so a request arrives the way an attacker's does. Measured with `npm run coverage`,
same command, same machine, clean `3f1de02` vs the same tree plus these specs and fixes: brain
310/1226 → 1220/1228, calendar 0/458 → 462/468, competitor 0/560 → 567/567, kb 431/862 → 850/862;
combined 57,631/102,459 (56.2%) → 60,699/102,478 (59.2%), 1738 tests, 0 failed.
- **Every action is enumerated from the router's own labels, and a table entry is mandatory.** A new
  `case` with no test fails the enumeration, and a floor on the count means a gutted enumeration cannot
  pass. Per action: the admitted request reaches its core with the arguments the router BUILT (the
  home market from the brand record, the workspace from the session, the caller's own token to a
  PostgREST store); where a gate exists, an anonymous request and a forged bearer are refused BEFORE
  the core, with no network call beyond the router's scoping lookups and no credit hold. `global.fetch`
  throws on any host the fake project does not claim, so a refusal that had already spent money shows
  up as an escaped call rather than a silent 401.
- **A stub on a name a module does not export intercepts nothing** (the 2026-09-15 finding, made
  structural): `Stubs.on()` refuses it. And a router that binds a dependency at LOAD time (brain.js
  binds `llm.js`; calendar.js destructures `lib/smart-brain/services.js` and binds the two modules
  that export the function itself) needs its cache entry swapped and the router re-required, or the
  stub is a key nobody reads.
- **Four defects, none visible in the source, each pinned by the test that found it:**
  `?action=lifecycle-build-mailer` answered **500 "q is not defined"** on every request without
  `force:true` (`q` was declared inside the `lifecycle-list` branch); the `/lp/:id` FALLBACK page never
  resolved the workspace's brand (`body` exists only inside `smartBrain()`/`lifecycle()`, and the
  ReferenceError was swallowed by a catch); `api/competitor.js` had **no OPTIONS branch**, so a
  cross-origin preflight for `?action=poll` RAN the IMAP poll; and `?action=snowflake-metrics`
  answered 501 with `ok:true` because `Object.assign({ ok:false }, out)` let the core's `ok` win.
  Against the pristine routers the specs fail on exactly those tests and nowhere else.
- **The ungated set is pinned by NAME.** 63 brain.js actions carry no caller gate: the only rule on
  them is browser attribution (an Origin with neither session nor `workspace_id` is refused or served
  demo data BEFORE the switch), so an anonymous non-browser caller with an explicit `workspace_id`
  - or none, which resolves to the DEFAULT workspace, tenant zero - reaches the core. Several of those
  cores reach a model or a paid provider (`console-chat`, `access-narrative`, `brand-chat`,
  `agent-chat`, `team-chat`, `agentic-run`, `generate`, `video-generate`, `mailer-assets`, `tts`,
  `calendar-scenarios`, `analysis-narrative`, `social-run-daily` POST). Each is PROVEN admitted for
  an anonymous server-to-server request, which is what makes the list a measurement: a gate added to
  one fails its admitted test and the pin shrinks; a NEW ungated action fails the pin and has to be
  argued for. Recorded here, not changed here - `agent-chat` is the buyer-facing widget and the
  cron/worker paths are userless by design, so the fix is a decision, not a one-liner.
- **The credit meter is not stubbed.** `calendar.js`'s metered actions prove, against the fake
  project, that an anonymous POST is refused with no hold, a session takes a hold that settles for the
  CATALOG price (the fake `credit_settle` echoes `p_actual`, so the receipt assertion is about the
  price list, not the fake), a 4xx from the generator RELEASES it, and the scheduler's bearer is free.
- **Two harness lessons.** The comment stripper used to enumerate the switch ate ~500 lines because
  `api/*.js` inside a `//` comment read as a block-comment opener (full-line `//` first, then
  `/* */`). And `workspace-scope`'s per-user preference cache survives a swapped network guard: a test
  that primes it and then pretends the user has no workspace must `invalidate()` or it reads a table
  the new guard never claimed and reports a 500.
- **The coverage tooling needs a git checkout** (`browser.js` uses `git ls-files`), so a copied tree
  cannot be measured; a clean baseline is taken in the worktree with the changed files reverted and
  the new specs moved out until Playwright has collected. And the scratchpad is SHARED between agent
  sessions on this repo: two runs writing one log name interleave, and the "exit=0" you read may be
  the other session's. Prefix scratch files with the task.
- Left as found, named so they are argued for rather than forgotten: brain.js's default "Unknown
  action" reply advertises 57 of the 89 actions it dispatches (the test asserts advertised ⊆ real);
  `mailer-assets` defaults `market` to the literal `'UK'` and competitor.js's `benchmark` to `'US'`
  (the 2026-09-15 home-market sweep missed both); `agent-sync` defaults to tenant zero's agent id.

## ⭐ The one sign-in is a mobile number and a 4-digit PIN (2026-09-28) — read `docs/mobile-pin-signin.md`
`api/_shared/mobile-auth-core.js` + `phone-rules.js` on `public-config.js?action=auth&op=status|enter|me|
signout|signout_all` (still 12/12), the `MAUTH` block in `auth.js`, gated by `tests/mobile-pin-signin.spec.js`
(24 tests, executed). The operator's words: "signin/signup with mobile number and a 4 digit password - save in
db (neon) or local browser cache whichever can be used - just like in parwah-hq", and "comment out all other
signin and signup". Mirrors parwah-hq's shape: ONE `enter` does sign-up and sign-in (number → PIN row → name
row for a new number → one Continue button whose label changes), inline in the rail, on the current page.
- **Commented out, not deleted, each under a dated banner**: `signInWithOAuth` and the whole Supabase session
  flow in `auth.js` (`getSession`, `onAuthStateChange`, the OAuth callback helpers, the profile modal), the
  brand gate's Google button in `brand-context.js`, the Studio's `vhd_users`/`vhd_session` overlay, and the
  `sb-*-auth-token` localStorage scans. The Supabase client `auth.js` builds is ANONYMOUS
  (`persistSession:false`, `detectSessionInUrl:false`): nothing can produce a Supabase session any more, so
  the mobile+PIN session is the one session source.
- **Four digits is the spec, so the lockout matters MORE**: the first-guessed PINs and any straight run are
  refused, scrypt + per-user salt + `timingSafeEqual`, 5 tries → 15-minute lock counted on the row, a per-IP
  budget of 25 `enter`/10 min counted in the database, sessions store ONLY the sha256 of a 32-byte token,
  90 days, `X-Lifecycle-Token` (the bearer is sent too so the gates that read one see it; a JWT has two dots,
  ours has none, so `looksLikeToken()` cannot confuse them).
- **Two stores, chosen honestly.** `op=status` answers `server` only when a URL is set AND `select 1` answers;
  else `device` with the REASON (no URL / unreachable + host). In device mode the browser runs the same state
  machine against localStorage (`lifecycle.auth.device.users`, PBKDF2-SHA256 via WebCrypto, 120k iterations)
  and a parity test holds its copy of the rules to the server's. A server session is validated with `op=me`
  on every boot: 401 clears it; a database that is not answering KEEPS it, marks it unverified, and the mode
  line says so - a person whose account is in the database is never shown a device sign-up as the same account.
- **A device token proves nothing to anyone but that browser, so it is never sent** (`LifecycleAuth.apiToken()`
  is the one source every same-origin request uses), and the server refuses one EXACTLY like an anonymous
  call. `requireUser()` accepts a server-mode token as `{provider:'mobile-pin'}`; `restAs()` - the one door
  every as-the-caller Supabase read goes through - refuses a phone account with a sentence instead of
  PostgREST's 401; the credit meter refuses it BEFORE a wallet exists (a phone sign-up is free and unverified,
  so a welcome grant per number would be an unlimited faucet). `internal` stays false: keyed on an email domain.
- **A phone account has no Supabase identity, so its workspaces live on the device in BOTH modes**, and the
  wizard says both halves in one accent-rule sentence: "Signed in as <name> · workspaces are saved on this
  device" (+ "· account in the database" in server mode). Never "sign in" to a person who just did.
- **The device store is PER ACCOUNT** (review, 2026-09-29): `lifecycle.brand.device.workspaces.<user id>`;
  the unscoped key serves ONLY the no-session states. A browser is shared, and with one key person B signing
  in saw person A's brands. A sign-in adopts no anonymous rows, a sign-out deletes none, and brand-context's
  backend listener re-reads when the NAMESPACE changes, not only the mode (on a device with no database a
  sign-in leaves the mode at `device`, so a mode-only listener left the previous person's brand on screen).
- **Three more review findings, each reproduced by an executed test before the fix**: the LOSER of a
  sign-up race (two first sign-ups for one number, `23505` on the second insert) kept `isNew` and was issued a
  session for the winner's account - it is a sign-in now and is held to the PIN check; `pin_tries` was
  read-increment-write in JavaScript, so five concurrent wrong PINs consumed ONE attempt and the lock never
  fired - it is one `update ... case ... returning` statement and the lock is decided from the RETURNED row
  (the in-memory store runs statements one at a time so the race is real in the test); and `privacy.html`
  still said a Google profile authenticates and Supabase Auth holds the session - rewritten for the sign-in
  that exists, Google under a `data-historical` section. All mutation-verified.
- **Tests that signed in through a `getSession` stub were re-targeted, and two changed meaning on purpose**:
  `onboarding-without-backend`'s signed-in cases no longer assert a server brand path (no browser session can
  take it), and `error-presentation`'s "Your brands" cases drive the LOCALHOST PREVIEW, the one state left in
  which the wizard asks the server and can be refused. Their headers say why. `WebCrypto.subtle` exists only
  in a secure context, so the device flow is driven from `127.0.0.1`, not the `app.example.test` fixture.
- **Found by running it**: an expired lock left `locked_until` set after a correct sign-in (locking zeroes
  `pin_tries`, and only `pin_tries` triggered the reset); and the onboarding activation test read
  `BrandContext.mode` ~200 ms before it is decided, which failed identically against main's own tree here.

### Verified on production (2026-09-29) — the drive, the two findings, the coverage
- **Production runs DEVICE mode**, read from production itself: `?action=auth&op=status` answers
  `{"mode":"device","reason":"no_database_url",...}` — no `DATABASE_URL` on Vercel. The live deployment is
  `dpl_8AEwJP1NWLjyvxvSB7yuLmZzSiB9` at `2b2a992` (`d9ac6a7` waits on the free-tier deploy quota). The
  deployed `auth.js`, `brand-context.js`, `smart-brain.html`, `onboarding.html` are byte-identical to that
  commit; `credits.js`/`theme.css`/`index.html` match through Vercel's ETag (= md5 of the body). The MAUTH
  panel ships; both `signInWithOAuth` lines are comments under the dated banners; no Google control anywhere.
- **The browser drive was against production's deployed bytes served from 127.0.0.1**, because the container's
  egress policy denies the production host (403 on CONNECT for curl and Chromium alike), the supabase-js CDN
  and the paused Supabase host. The status endpoint's JSON was production's own. Full flow driven and
  screenshotted: sign-up with a fixture number, weak PINs `1234`/`0000` refused, invalid +91/+1 numbers refused
  with the country sentence, reload keeps the session, `/brain` sees it, sign-out keeps the account and the
  brand, sign-in again, 4/3/2/1 tries left then the 15-minute lock, the right PIN refused while locked, and the
  wizard writing under `lifecycle.brand.device.workspaces.<user id>`. Record in `docs/mobile-pin-signin.md`.
- **Finding 1, on the deployed bytes: the page went DIM after Sign in on a desktop and stayed dim after
  signing in.** `mauthOpenPanel()` added `open` to `#lifecycle-nav` unconditionally and the drawer backdrop is
  not scoped to the phone breakpoint, so at 1280px the only effect was a 55% black pointer-catching sheet over
  the page: the wizard's own Next button was unclickable and nothing said Escape was the way out. The panel now
  opens the drawer only when the burger is DISPLAYED (computed style, not a breakpoint copied from the CSS) and
  only if it was closed, and closes what it opened when the panel goes; a drawer the person opened stays.
  **The existing suite could not see it**: after sign-in it only ever `evaluate`d clicks and API calls, never a
  real click on page content. Driven at 1280px and 390px now, with `click({trial:true})` — the same
  actionability check that reported the defect.
- **Finding 2: `requireUser()` told a server-mode account whose database is DOWN that it was "kept on this
  device only"** (401). A token of our shape only ever comes from a server-mode sign-in, so `unreachable` is
  the database being down, not the person being signed out: `503 backend_unreachable` naming the host now,
  `require-caller` passes the 503 through, `no_database` keeps the 401. Same distinction the file's own header
  draws for the Supabase path, flattened one branch below it.
- **Finding 3, at 390px: the signed-out notice sat ON the menu button.** The bar that says "the Sign in chip in
  the menu" is sticky at `top:0`, z-index 120, over the rail's fixed mobile bar (z 100), so on a phone the burger
  that opens that menu was under it and Sign in was reachable only after Dismiss. It sticks at
  `top:var(--ltb-h)` now (the rail's published mobile-bar height, 0 on a desktop) and is inserted after the
  rail, whose spacer reserves that height in flow. Found because the drawer test's burger press hung on
  `#lc-authnotice intercepts pointer events` — a hang, not a failure, because a click has no default timeout.
- **Five executed tests added** (29 total): cross-page session after navigation; forged/malformed/JWT-shaped/
  absent tokens at `op=me` through the shipped handler plus a forged STORED session cleared on boot with the
  note; the concurrent-lockout race through the shipped handler; and the two findings. Both fixes are
  mutation-verified.

## ⭐ Five functions nobody had ever called (2026-09-28)
`api/_shared/pipeline-core.js` + `api/ai/pipeline/{strategy,variant,images,html,score}.js`, gated by
`tests/pipeline-executed.spec.js` (15 tests, executed). `coverage/UNTESTED.md` listed the five
pipeline stages at **0%**: five of this deployment's TWELVE serverless functions, never loaded by
any test. Loading them and sending each one request found six things, none of them visible from
reading the two files beside them (`generate.js`, `image.js`) that had been fixed and looked complete:
- **The 2026-08-23 finding was still open on five routes.** Each stage opened with `corsHeaders()`
  (a wildcard) and went straight to `callLLM`. A grep for `requireCaller` under `api/ai/` returned
  two hits and stopped looking. **No meter** either (a mailer that costs credits through
  `generate.js` was free through the pipeline) and **no request scope** (a workspace's own keys and
  model order were ignored; the platform's keys were spent). Deleting a wall means auditing every
  route that enforced the same rule elsewhere; so does ADDING one.
- **One tenant's prompt for every tenant, and underneath it a tea brand's.** The system prompts named
  tenant zero, its hexes, fonts, logo URL, store domains and legal footer, and under a
  search-and-replace rebrand still read "first-flush", "7,000 feet", "farm direct", "steaming pair",
  "the finest ... I've ever tasted". A brand onboarded yesterday got a mailer built from all of it.
- **Instructions to fabricate, as mandatory content.** "⭐⭐⭐⭐⭐ ([N] reviews)", "🔥 [N] units sold in
  the last 24 hours (N: 25-90)", "4.8/5 · 50K+ REVIEWS", a templated testimonial, an invented code
  and a shipping threshold, per product card. None of it reachable by `gateProof()`. Seeding a shape
  with values IS an instruction to invent them (the 2026-08-14 finding), and here the range to
  invent from was written down.
- **A black section in the html stage's own fallback** (`#0a1f13` on two Variant B bands), which
  `asset-no-black-background.spec.js` could not see because this renderer was not on its list. The
  gate only sees what it is pointed at; a renderer that is never executed is not pointed at.
- **One door now.** `admit()` (caller gate, body, the brand resolved for THIS request); `briefing()`
  (the brand block + the `email.mailer` contract brief + the evidence block or its explicit
  no-evidence state, in every writing prompt); `tokens()` (a section palette through
  `sectionGround()`/`textOn()`, so no ground is a dark neutral and no text is under AA for ANY
  record); `mount()` (`credits.metered` then `request-scope.wrap`, with the `image.js` refund rule: a
  heuristic fallback, a placeholder or a skipped score releases the hold). `llm.js` is resolved at
  CALL time, because the module IS the function and a scripted model in `require.cache` must reach
  a stage that was loaded earlier. `mailer_type: 'text'` renders the TEXT type of the taxonomy.
- **The gate's own first run found the next defect.** The accent used as a SECTION (announcement bar,
  offer banner) was the raw control colour, so a brand whose accent is `#0d0d0d` got a black band
  from a token that was correct for its buttons. A control may be dark; a band goes through
  `sectionGround`. `accentBand`/`onAccentBand` sit beside `accent`/`onAccent` now.
- **Refusal is asserted in BOTH meter configurations.** With the meter configured, the credits
  wrapper's own session check refuses first, so a bypass of the stage's caller gate is invisible to
  a test that only runs the metered shape. The unmetered case is where the mutation fails.
- **A scorer carries the brand's name, not its block**: it writes no copy. Asserting the block on
  every prompt was the test being wrong, not the code.
- **What the images stage returns is not what goes in the mailer.** The data URLs are the provider's
  payload for review; `hosting_note` says to upload through `creative-image.js` and place the HOSTED
  url, because the mailer contract BLOCKS embedded base64. The old header comment said the client
  pastes the data URLs in, which would have shipped a mailer its own contract refuses.
- Also fixed on the way: `brand-placeholder.js` painted tenant zero's name and hexes for every
  caller (with a tea-brand subtitle); it paints the brand it is given. `?pipeline=1` health said
  `text_model: gpt-4o-mini (default)` on a deployment with no key at all; it says `unconfigured`,
  and the model it names when keyed is read from `llm.js`, not re-typed.
- Four mutations, each restored: discarding the gate's refusal fails the unmetered refusal test;
  dropping the evidence block fails the prompt assertion; painting the footer with the ink token
  fails the rendered gate (26 dark grounds); charging a fallen-back stage fails the ledger assertion.
- Measured with `npm run coverage` before and after (`docs/coverage.md`): the five stages went from
  0% each to 90-99% (`html` 503/514, `variant` 364/383, `strategy` 283/291, `images` 205/228,
  `score` 196/198; `pipeline-core` 287/302), combined **56.1% → 58.3%**. One different test failed
  in each full run (`workflows-guarantees:418` before, `contrast-rendered:203` after); each passes
  alone, neither touches the pipeline.

## ⭐ A brand has a HOME market, and no control opens on US (2026-09-15)
`region-context.js` (`home`, `options()`, `resolve()`), `brand-extract.js` → `homeMarket()`,
`brand-runtime.homeRegion()`, gated by `tests/brand-regions.spec.js` (17 tests, executed). Live
screenshot, active brand = The Times of India: the rail said "Market: India (IN)" while `/research`
opened on a US study, `/retention-playbook` filtered to US, the Studio offered seven typed markets
with US on, and `/plan` planned a US calendar. **Every control carried its own typed list and its
own typed default, and the record had no way to say which market is home.** Found: `research.html`
(two tab rows + `ORDER` + `show(q||"us")`), `retention-playbook.html`, `calendar.html`,
`lifecycle_mailer_architect_v34.html` (7 chips + 25 `||'US'` fallbacks), `dashboard.html`,
`knowledge-base.html`, `landing-pages.html` (4 groups), `onboarding.html` (a NEW brand started with a
US row), and on the server `brain.js` (10 sites), `calendar-generate` (a shipped 4-market list),
`calendar-export`, `landing-page-core`, `master-prompt`, `brand-llm`, `smart-brain-plan`,
`brand-context-pack`, `public-config` (`app.regions`).
- **`home:true` on exactly one region.** `normalizeRegions` keeps the first flag and drops any second;
  none is a reported `[DATA REQUIRED BEFORE LAUNCH: home market]`, never a promotion of row one.
  `homeRegion(brand)` = the flag, else the row the record leads with, else `''` — a gap, not a
  literal. Tenant zero's home is IN (its legal address is Mumbai); presets declare theirs.
- **Derived from what the site publishes, strong signals only**: `hreflang="x-default"` whose URL a
  regional alternate shares; the host's ccTLD from a DATA table (`.com/.co/.io/.ai/.me/.eu` are
  deliberately absent); the legal entity's `addressCountry`; the currency the HOME PAGE's own offers
  declare (EUR names a zone, not a country, so it never proposes); Shopify's own `Shopify.country`
  captured by `storefront-detect`. `<html lang>` and `og:locale` are WEAK and only corroborate — a
  language is not a market, and a test mutates that to strong and fails. **Two strong signals that
  disagree are a conflict with both sides shown, resolved by nobody here.** A single-market `.in`
  site used to report NO regions; its own suffix, prices and address now make it a candidate.
- **Every page control is built from `RegionContext.options()`** and opens on `home`; a brand with no
  regions renders the marker, never a list. Chips and records are matched by FAMILY (`India`/IN,
  `GB`/UK, `Global`/GLOBAL) — `codeOf()` used to compare raw strings, so the India chips on four
  pages were never bridged at all. Aggregating pages (dashboard, knowledge base) keep All as default.
- **`$$` in a JS replacement string is one `$`, and `$'` is the rest of the file.** Two of the sweep
  edits were mangled by `String.replace` patterns before a function replacer was used; the second
  appended 240 lines of the preset builder to its own end. Split/join for literal edits.
- **Four review findings on the first cut, each real (2026-09-28).** USD is NOT country-unique - it is
  the pricing currency of global `.com` storefronts - so it left `CURRENCY_COUNTRY` and joined
  `CURRENCY_ZONE` with EUR: a weak corroborator for US, never a proposal, never a conflict beside a
  real ccTLD. `sameUrl()` dropped the query string, so `/?country=US` vs `/?country=GB` read as the
  same page and the x-default matched nothing (or the wrong region); it now compares sorted params.
  The wizard's catalogue import still fell to `region:"us"` for a brand with no regions (a NEW brand
  starts with none), filing rows under a market it never declared: it is a disabled control carrying
  the `home market` marker in the accent rule, and the handler refuses even if the control is forced.
  And a re-read whose report proposed no home set `home:false` on every row, discarding the
  operator-confirmed home; the existing flag (and its row) is kept unless a NEW proposal explicitly
  replaces it, and `brand_extraction.applied['regions.home']` records `origin:'user'` or `replaced`.
  All four are executed tests in the same spec (21 now) and each is mutation-verified.
- Left as found: `auth.js` NAV `research-us/uk/global/india` rows (static rail model, deep links now
  fall to the brand's home), `reports/retention-intelligence.html` (no shell, no brand), analytics
  cores whose `'US'` names the bundled export's own market rather than a slot.

## ⭐ Hosted Supabase is a deployment choice, not an assumption (2026-09-15) — read `docs/self-hosted-supabase.md`
`selfhost/` + `scripts/selfhost-*` run the same open-source services Supabase hosts (Postgres,
PostgREST, GoTrue, Storage, Realtime, postgres-meta, Studio, behind Kong 2.8.1), pinned to the image
set upstream shipped together on 2026-09-15, trimmed to what this app calls (no Logflare/Vector,
edge-runtime, Supavisor or imgproxy). Switching is three Vercel env vars (`SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) plus the Google OAuth redirect URI
`https://<host>/auth/v1/callback`. ONE compose serves two modes: `DB_MODE=local` (the `db` service,
behind a `local-db` profile) or `DB_MODE=external` (Neon as the database; `depends_on: db` is
`required: false` so the file needs no editing). Gated by `tests/self-hosted-supabase.spec.js`.
- **`ANON_KEY`/`SERVICE_ROLE_KEY` are JWTs signed with `JWT_SECRET`**, claims
  `{role, iss:"supabase", iat, exp}` — `scripts/selfhost-keys.js`, verified with independent Node
  crypto and against upstream's own shipped demo keys. A "random string" here is a silent 401.
- **A checked-in constant outranked the environment in the browser-facing route.**
  `api/public-config.js` read `ldb.url || process.env.SUPABASE_URL`, so every visitor was handed
  the paused hosted project no matter what the deployment said — the defect `brain-core.js` had
  already fixed on the server, arriving through the other door. `services.js` and `os-backbone.js`
  paired an env URL with the FILE's key (a guaranteed 401). Env first everywhere; `data/linked-db.json`
  now ships EMPTY (third baked-in ref to go stale here). The test PLANTS a pinned file via
  `process.cwd()` to prove the env wins — with the shipped empty file a regression is invisible.
- **Timestamp order is not name order.** `20260719_ci_subscriptions.sql` (8-digit prefix, midnight)
  sorts AFTER `20260719140000_…` by name because `_` > any digit. The applier pads to 14 digits;
  the ledger is keyed by file name because three prefixes (`20260609`, `20260610`, `20260703`) are
  used twice, which rules out the CLI's `schema_migrations`. `COMBINED_RUN_THIS.sql` holds 8 of 58
  migrations — measured, pinned, not used.
- **A managed Postgres has no superuser, and that is the whole shape of external mode.** Postgres lets
  only a superuser create a `BYPASSRLS` role, so on Neon `service_role` is RLS-filtered (the bootstrap
  warns, `selfhost-check.js` reports it, the runbook gives the lead). Realtime's README says its
  migrations need a superuser and its self-host seed hardcodes `ssl_enforced: false`, so Realtime on
  Neon is "confirm on your project" — the app degrades to polling (`credits.js` 60 s,
  `reports/dashboard.html` 5 min). PostgREST with `PGRST_DB_USE_LEGACY_GUCS=false` sets
  `request.jwt.claims`, NOT `request.jwt.claim.sub`; the upstream init-script `auth.uid()` reads
  only the latter and would deny everyone — the bootstrap reads both.
- **Nothing was booted.** Docker was present but image pulls were denied by egress policy and no Neon
  project was reachable; the runbook says exactly what was executed (compose validated by Docker
  Compose itself, byte-identical to the kit's own parser; keys; ordering; guards; auth.js in
  Chromium against `https://db.example.org`) and what was not (any container, any real database).

## ⭐⭐ It is now a UNIVERSAL brand platform (2026-08-09) — read `docs/universal-brand-platform.md`
This is no longer a single-brand app. Any signed-in user onboards their own brand and the whole app
runs as that brand for them. Three layers, none of which added a serverless function (still 12/12 —
all logic in `api/_shared/`, mounted via `?action=` on `public-config.js` / `brain.js`):
- **Brand layer** — `/onboarding` is the FIRST SCREEN (brand data → colour schema → typography →
  voice → catalog → activate). `brand_workspaces` + `brand_user_prefs.active_workspace_id` (per
  user, RLS-private). `brand-context.js` writes `--brand-*` tokens onto `<html>`; **`theme.css`
  resolves every colour/font through them**, so all pages re-skin at once — never hardcode a brand
  colour or font in a new page, always go through the `--vh-*` / `--brand-*` tokens.
  `validatePalette()` BLOCKS activation on dark-neutral surfaces or sub-AA contrast.
  KNICKGASM is now just tenant zero (`data/brands/_default.json`).
  - **Read the brand off its own site** — `_shared/brand-extract.js` on `?op=extract` (still 12/12)
    extracts name, tagline, logo, palette, typography, observed voice, verbatim claims, social,
    legal entity and regions from the URL pasted on step 1. It rides the SAME crawl as the catalogue
    importer (`site-crawl.js` gained optional `onPage` + `rank` hooks) so there is one set of scope,
    robots and SSRF rules. **Every value is a CANDIDATE carrying its source URL and signal; nothing
    is applied until the operator presses Use**, and a field the site did not publish comes back as
    a `[DATA REQUIRED BEFORE LAUNCH: ...]` marker. Colours are never pooled by frequency: sightings
    are split into `identity` / `action` / `surface` / `ink` / `support` roles, `proposed.primary`
    comes ONLY from an identity signal (theme-color, manifest `theme_color`, a `--brand-*` token),
    and an identity-vs-action disagreement is reported as a conflict rather than resolved. No
    browser is available, so this is CSS/HTML parsing and its blind spots are returned in `limits[]`.
  - **The brand CONTEXT PACK** — `_shared/brand-context-pack.js` on `?op=context-*` (still 12/12),
    table `brand_context_packs`. One durable record per brand, built from its own URL and kept as its
    standing context: a **DESIGN.md** in the open `google-labs-code/design.md` format (Apache-2.0,
    version `alpha` — conform to it, do NOT invent a shape), a knowledge base from that domain ONLY
    (verbatim: each page's own declared description and headings, no LLM paraphrase — a paraphrase of
    a brand fact is a new brand fact nobody approved), the catalogue via the existing `importCatalog`,
    and a GitHub repo search. **Keyed to URL AND name** (`brand_key = <host>|<folded name>`, unique
    per workspace): re-running updates, lookalike names cannot collide, and a domain/name change
    starts a new pack instead of overwriting a report about a different site.
    - **DESIGN.md rules**: front matter `version/name/description/omitted/colors/typography/rounded/
      spacing`; the 8 spec sections in order, each exactly ONCE (a duplicate heading rejects the file).
      The spec's `omitted` key IS our zero-fabrication rule — an unpublished section is declared
      omitted *with a reason*, never filled. `primary` comes ONLY from an identity signal; `secondary`
      only when the action colour genuinely differs; **never promote a frequency-ranked colour**. Text
      tokens are the `readableAsText()`-adjusted values against the worst-case surface using
      `core.TEXT_AA` (never a raw brand colour as text), and every adjustment is printed with ratios.
    - **User data wins, structurally**: `brand_field_provenance` + the `brand_context_apply()` SQL
      function is the ONLY door an automatic value may come through, and it refuses any field whose
      origin is `user` — in the database, not in call order. `saveWorkspace()` calls
      `brand_fields_claim_user()` with the fields the operator actually sent. `voice.banned` can never
      be machine-filled.
    - **Only the exact correct option** (2026-08-13): `secondary` is emitted ONLY when
      `sources.accent.from_role === 'action'` — proposePalette's support-colour fallback is fine for a
      wizard where a human confirms and wrong for a token consumed without one. `sources.<role>` now
      carries `confidence` / `from_role` / `ranked_not_declared` (the wizard was hardcoding
      `'declared'` on every role). Typography emits only `declared`/`strong` candidates: **a family
      the page LOADS is not one it USES**, and a link-only candidate can otherwise fill an empty slot
      and become `[0]`. `site-crawl` now re-checks scope on the URL that ANSWERED — an in-scope path
      that 301s off-origin had its body ingested. Derived tokens (`on-primary`, `*-text`, adjusted
      `neutral`) are labelled `DERIVED from <input>`. `design.selection` records per field the value,
      signal, source URL, `rank_taken` of `candidates_considered` and `chosen_by`, and `applyPack()`
      marks an `operator-override` naming what the pack ranked first.
    - **GitHub degrades honestly**: `searched:false` (could not reach GitHub) is NEVER reported as
      "no repositories". A repo is the brand's only on evidence independent of its name (the site
      links to that owner, or the repo `homepage` is on the brand's domain); a name match is
      `unverified` and never counted.
    - Long work is a **convergent queue on the pack row** (`stage` + `queue_state`, self-firing via
      `op=context-step`), same pattern as `smart-brain-plan.js prebuildAssets()`.
- **Credits** — every feature costs credits. `api/_shared/credit-catalog.js` is the single source of
  truth for prices; **a feature key missing from it throws rather than running free**. Spend via
  `credits.meter()` hold → settle/release so a failed run is always refunded. The balance-moving SQL
  functions are REVOKEd from `authenticated` (service-role only). Live balance via Supabase Realtime.
  Mark any new UI action with `data-credit-feature="<key>"` and `credits.js` labels it automatically.
- **TeleSuite** — `/telesuite`, all 23 subfeatures of the AI-TeleSuite repo, rendered entirely from
  the `SUBFEATURES` registry in `_shared/telesuite-core.js`. Every dashboard is a filtered view of
  the one `telesuite_runs` table (shared source of truth), not its own store.
- **Connections + AI models** — `/connections` (and `/ai-models`), `brand-connections.html`, served by
  `_shared/workspace-connections-core.js` on `public-config.js?action=connections` (still 12/12
  functions). A workspace brings its OWN platform credentials and its OWN AI keys, and picks the
  provider/model PRIORITY ORDER that replaces the default cascade in `llm.js`. A workspace with
  nothing connected behaves exactly as before. Registry of connectable platforms is `PROVIDERS` in
  that module; a platform whose sign-in flow is not established carries a
  `[DATA REQUIRED BEFORE LAUNCH: ...]` marker instead of a fake OAuth button. **Never add a base URL,
  model id or auth flow there that this repo does not already call.**
  - **Secrets** live in `workspace_connection_secrets`, AES-256-GCM ciphertext under
    `CONNECTION_SECRET_KEY`. That table has RLS on and **no policy**, and is REVOKEd from
    `anon`/`authenticated`: only the service role reads it, and only after the module has verified
    the caller's JWT and workspace role. Nothing ever returns a secret to the browser, only
    `configured: true` plus the last four characters. With no `CONNECTION_SECRET_KEY` a save is
    REFUSED (503) rather than stored in the clear.
  - **How the key reaches `llm.js`**: `_shared/request-scope.js` (AsyncLocalStorage) carries the
    request, so the ~100 `callLLM` sites need no change. `api/brain.js`, `api/calendar.js`,
    `api/public-config.js`, `api/ai/generate.js` and `api/ai/image.js` are wrapped in it. A module
    level variable would leak keys across concurrent requests, which is why it is ALS.

## Brand layer: one record, many derived sites, any brand
`data/brands/_default.json` is tenant zero and the SINGLE source of brand truth. Nothing else is
hand-maintained:
- `api/_shared/master-prompt.js` DERIVES `BRAND_BLOCK` at require-time via
  `brand-runtime.brandBlock(defaultBrand())` — it cannot drift.
- `scripts/brand-sync.js` regenerates the `theme.css` tokens, this file's Brand Constants block and
  the Supabase brand-kit seed between `BRAND-SYNC` markers. **Never hand-edit inside those markers.**
- `npm run brand:check` exits 1 on drift, runs first in `npm run build`, and is a required CI step.

**The mechanism is brand-agnostic, and that is demonstrable:**
```bash
npm run brand:presets                 # regenerate the starter library
npm run brand:sync                    # propagate tenant zero
node scripts/brand-sync.js --brand=apple   # re-skin the WHOLE suite to any preset
npm run brand:check                   # always validates tenant zero; fails on drift
```
`data/brands/presets/` ships starter profiles across deliberately different sectors — KNICKGASM
(D2C commerce), The Economic Times and The Times of India (news), TOI Health & Fitness (health
media, with medical-claim guardrails in its banned list) and Apple
(consumer tech). `/onboarding` renders them as a gallery above the "enter your own" form, served by
`/api/public-config?action=brand&op=presets` (unauthenticated, like `op=defaults`, because the
gallery must paint before a workspace exists).

**Preset provenance rule:** every palette/typography value was read from that brand's OWN live site
or stylesheet on its `verified_at` date, with the exact source recorded per preset. Voice is written
as OBSERVED from public output, never presented as a company's internal guidelines. Presets are
TEMPLATES for building and demos, not licences to use a third party's marks — each carries
`rights_note` saying so, and the gallery repeats it. Regenerate via `scripts/build-brand-presets.js`
(edit that file, not the generated JSON).

## ⭐ Publishing + deliverability (2026-08-18) — read `docs/publishing-and-deliverability.md`
The platform can now SEND, not just create. One pipeline, still 12/12 functions (everything in
`api/_shared/`, mounted on `brain.js` `?action=dispatch-*|deliverability-*|cohort-*` and
`public-config.js?action=connections&op=oauth-*`). UI at `/publishing`.
`asset → channel_mappings → preflight → dispatch_jobs → adapter → sync_log ← webhooks`.
- **Adapters** — `api/_shared/adapters/`: `BasePlatformAdapter` / `AdPlatformAdapter` /
  `CrmPlatformAdapter` (contract also written as real TypeScript in `types.d.ts`, and a test fails
  if it drifts). Meta (Graph + Marketing + `ads_archive`), Google Ads, Klaviyo, WebEngage, plus
  Braze / ActiveCampaign / Customer.io hooks. **Never add an endpoint a platform's docs did not give
  you**: every adapter carries `sources`, and an endpoint that could not be confirmed is
  `verified:false` and shows in the hub as "N unverified". Klaviyo's WRITE paths and all three hooks
  are currently unverified; the hooks refuse to send until `endpoints_confirmed` is set.
- **Three switches before anything leaves**: `LIVE_CONNECTORS=on` (repo-wide, off by default) AND
  per-workspace publishing (a deliberate toggle, not a form field) AND — for Klaviyo/Shopify/
  WebEngage only — `<PLATFORM>_ALLOW_WRITES=1`, because `read-only-egress.js` is a standing rule and
  an adapter does not get to decide it does not apply. Miss one and the job builds the EXACT request
  and stops, showing it.
- **The queue is a convergent row-based queue, not BullMQ** — Vercel Hobby has nowhere to run a
  worker. Same pattern as `smart-brain-plan.prebuildAssets`. Leases, exponential backoff with
  jitter, a platform's own `Retry-After` outranking our arithmetic, and a unique index on
  `(workspace_id, idempotency_key)` that is the actual anti-double-post guarantee.
- **The preflight gate can BLOCK.** Credential, scopes, mapping gaps, domain auth, blocklists,
  warmup cap, segment health, frequency cap, unsubscribe, content spam. **A check that could not run
  returns `warn`, NEVER `pass`** — a gate that approves what it could not inspect is worse than no
  gate. Blocks are overridable and the override is recorded with the operator's id and reason.
- **Three lies this domain invites, all refused in code**: a refused blocklist query is never
  "clean" (`isRefusalCode`, Spamhaus answers refusals with `127.255.255.x`); a DNS lookup that
  timed out is `unavailable` and EXCLUDED from the score's denominator rather than scored 0; and no
  send time is recommended without open history. Audience sizes are never invented.
- **No raw email addresses** — `subscriber_engagement_scores` holds a per-workspace-salted SHA-256
  plus the ESP's own profile id. Pseudonymisation, not anonymisation, so the table keeps brand RLS.
- **Warmup never widens past `engaged_60`** — adding lapsed contacts to a ramp collapses the
  engagement rate at exactly the moment the domain is building one.

## ⭐ Every asset is built to ITS OWN contract (2026-08-19) — read `docs/asset-contracts.md`
`api/_shared/asset-contracts.js`. `asset-specs.js` always held the real dimensions and copy limits,
and exactly ONE file consumed it: `master-prompt.js`, which pastes it into a PROMPT. So the rules
reached the model as prose, every renderer re-typed the numbers (`scripts/lib/ad-creative.js` clamped
to its own literal 125/40/30 and 30/90), one copy pass wrote email + landing + all three ad platforms
together, and **nothing ever checked the finished asset** — a Google headline three characters over
the limit was found by Google.
A contract states, per asset type: the `structure` it has IN ITS MEDIUM, the `design` rules that
belong to that surface and no other, the ordered `algorithm` by which it is made, and `validate()`.
Six: `email.mailer`, `ad.meta.static`, `ad.meta.video`, `ad.google.rsa`, `ad.tiktok.video`,
`landing.page`. A test asserts the mediums have not collapsed back into one set of rules relabelled —
email has no JS and must survive images-off; a landing page owns its scroll; a Google RSA has NO
layout because Google assembles the combination; a video ad is judged on its first second and on
whether an artefact exists to play.
- **Numbers are READ, never re-typed** — pulled from `asset-specs.js` at require time; a slot the spec
  has no number for is DECLARED unbounded rather than quietly given one.
- **A limit this repo cannot source does NOT block.** `verified` only where the repo already refuses
  to send copy that breaks it (Google's 30/90/15 — `google-ads-adapter.js` DROPS over-long copy before
  building a request). Everything else warns. A test walks every `verified` claim and fails if the
  file it names lacks the enforcement.
- **Validation never rewrites copy.** Truncating to fit is how a sentence becomes a fragment nobody
  wrote. `checkAssetContracts()` attaches `contract_check` per asset + a campaign summary; the
  copywriter is briefed with the SAME contracts, so writer and check cannot disagree.
- **Routing is per CREATIVE TYPE, not per platform** (2026-08-19). `contractFor()` sent every TikTok
  ad to `ad.tiktok.video` while Meta beside it branched correctly, so every TikTok STILL (the builder
  ships an A/B pair per platform) was reported with three violations it could not satisfy. A false
  block is not a safe failure: blocks are overridable by design, so a gate that routinely blocks what
  it misread teaches the operator that overriding is routine. `ad.tiktok.static` is built from the
  same `asset-specs` numbers as everything else.
- **The app builds to its own contracts** (2026-08-19). Running one campaign through the real
  builders on the noLLM path reported 7 blocking + 1 warning against the app's OWN output; all five
  causes were real and had shipped. The template mailer was `<main>`/`<section>` with `max-width` and
  an inline-block `<a>` — Outlook renders with the WORD engine, which honours neither, so the email
  spanned the window and the CTA lost its button. The landing page's CTA was a `<button>` with no
  handler. Video ads had no `primary_text`/`headline` (Meta requires both on video exactly as on
  static). `attachMotionCreative` ran only inside the LLM branch, so every noLLM build shipped video
  ads with nothing to play — despite the artefact needing no model. Now **0 blocking, 0 warnings**,
  asserted by `tests/generation-quality.spec.js`, which BUILDS a campaign rather than reading source.

## ⭐ Generation is grounded in EVIDENCE, not only rules (2026-08-19) — read `docs/creative-evidence.md`
`api/_shared/creative-evidence.js`. The planner already worked out which of the brand's own campaigns
cleared its thresholds, pulled their hooks and stamped the winner on the slot as `ownDataReference` —
it reached the confidence score, the rationale and the review panel, and **never reached the
copywriter**. Both prompt builders briefed the writer with market, cohort, product, offer and a flat
list of COMPETITOR hooks, so every send was written from rules and other people's angles while the
evidence sat one field away. Now `briefFor(entry)` renders three separated blocks into both prompts:
**WORKED** (own campaigns with the figures that qualified them, build on the PATTERN not the wording),
**TIRING** (below the brand's own median click rate), **COMPETITOR** (grouped + counted, awareness only).
- **A win carries its numbers or it is not a win.** "Top performer" with nothing behind it reads as
  evidence and IS a claim; a campaign with no metrics is dropped, never promoted on its name.
- **ROAS is null for owned email, not zero** — a lifecycle send has no spend, and printing 0 reads as
  a campaign that lost money.
- **No evidence is a STATE, not an empty string.** A new brand is told there is no history and told
  explicitly not to invent a campaign, result, benchmark or figure. An omitted section is an invitation.
- **Fatigue is measured against what we HAVE.** "CTR down 20% from peak" needs a per-creative time
  series this repo does not store, so it is never claimed; a campaign below the brand's OWN median is
  what gets reported, in those words. Under three campaigns there is no median and fatigue reports
  `available:false` with the reason.
- **A competitor set that could not be read is not an empty one** — same rule as the competitor universe.
- **Two defects found by RUNNING it**: a campaign appeared in WORKED and TIRING at once (the writer was
  told to build on the angle it was told not to re-run), and summing `competitorContext` counts across
  channel rows — which all carry the SAME global hook list — turned 4 sightings into "seen 16x".
  Inflating evidence is the same defect as inventing it.
- **What this repo will not pretend**: Meta's `ads_archive` covers social/electoral/political ads only
  outside the EU (`meta-adapter.js` says so), so competitor creative evidence comes from the competitor
  universe, the captured email archive and channel benchmarks — never labelled as full ad-library coverage.

## ⭐ An asset prompt and an element prompt are different things (2026-08-19) — read `docs/asset-and-element-prompts.md`
An operator copied the prompt `smart-brain.html` offers, pasted it into Gemini and got a product
photograph instead of an email. Nothing was broken in the model: the only prompt the console ever
surfaced was an ad's `creative_brief` — an IMAGE brief, doing exactly what it says — while
`master_prompt`, which has produced the finished artefact since the beginning, was never rendered on
that page at all. Neither prompt announced its kind.
- **ASSET prompt** returns the complete artefact (`master_prompt`, `master_prompt_v{1,2}`). It OPENS
  by naming the deliverable and CLOSES by pinning the container, so a model reading only the first
  and last paragraph still builds the right thing. The three things Gemini returned instead — a plan,
  an outline, a hero image — are ruled out BY NAME. Every asset prompt forbids base64: Gmail clips
  past ~102KB and the mailer arrives cut in half.
- **ELEMENT prompt** returns one part (`creative_brief`, `script`), wrapped by `buildElementPrompt()`
  so its first line says so. Deliberately NOT wrapped in the brand block — this goes to an image
  model, and burying a shot description under typography rules is how a hero comes back with text
  baked into it. An empty brief yields no prompt at all.
- **`promptsFor(asset, type)`** is the index the UI renders, whole-asset prompts FIRST — ordering is
  the fix, not decoration, because the operator copies the first thing that looks like the job. An
  asset row carries `from` (the field already holding the text) instead of a copy: ~700 bytes vs
  ~11KB, across a ~180-slot prebuild queue. Element rows carry `text`, which exists nowhere else.
- The console shows both kinds together, the kind as a chip INSIDE the button (an operator in a hurry
  reads the button, never the title attribute). Tests stub the clipboard and assert what actually
  lands there.

## ⭐ An effect the author's desktop has and the reader's phone does not (2026-08-21)
`tests/mobile-effects.spec.js` + `tests/motion-ad-mobile.spec.js`. "Effects missing when opened on
mobile" had four independent causes, and they share a shape: **a CSS feature that is dropped
SILENTLY by the engine that lacks it**. Nothing errors, the declaration is simply discarded and the
effect is absent — and it never shows up in review, because review happens on the desktop.
- **`color-mix()` is dropped WHOLE, it does not fall back.** iOS Safari shipped it in 16.2. Every
  scrim, text-shadow and CTA ground in `motion-ad.js` used it, so on an older phone the veil, both
  shadows and the card's ground vanished at once, leaving white type on a bright photograph. The
  inputs were known colours and fixed percentages, so there was nothing the engine needed to compute:
  they are mixed at render time (`mix()`/`alpha()`) and emitted as plain `rgba()`/hex. **Resolving it
  is better than a fallback stack** — the problem stops existing rather than being papered over.
- **`backdrop-filter` needs `-webkit-`** or the blur is absent on almost every iPhone. 33 unpaired
  declarations across 12 pages, while `storefront-3d.html` and part of `competitor-benchmarking.html`
  already carried it — inconsistency, not a decision.
- **`100vh` on mobile Safari is the LARGE viewport height**: it counts the space the URL bar occupies,
  so the 9:16 creative ran off the bottom and took the CTA and progress bar with it. `100svh` now,
  inside `@supports` so an engine without it keeps the `vh` rule.
- **Reduced motion must mean LESS motion, not NO AD.** iOS turns `prefers-reduced-motion` on in Low
  Power Mode as well as from the accessibility setting, so a large share of phones land in that
  branch — and `.cta` is `inset:0`, so pinning it to `opacity:1` there covered the whole frame and
  hid the shot and the type. The viewer got a static end card and nothing else. It now composes the
  frame the viewer would have seen at the end: opening shot with its type, CTA as a bottom band.
  The gate asserts the REVERSE case too — that the ad still animates for everyone who did not ask for
  less — because a fix that turns the creative into a poster for all viewers would otherwise pass.
- WebKit is not installed in CI, so the phone-viewport tests run in Chromium with the media feature
  emulated; the `color-mix` and prefix checks are assertions about the OUTPUT, which is
  engine-independent and is the actual fix.

## ⭐ No section is ever black, and text on a brand colour is DERIVED (2026-08-21)
`api/_shared/brand-workspace-core.js` → `sectionGround()` + `textOn()`, gated by
`tests/asset-no-black-background.spec.js`. A rendered mailer came back with near-black bands. "Never
black / `#111111` / dark-neutral section backgrounds" has been a design HARD rule all along, and
`validatePalette()` has enforced it on the page SURFACE since the beginning — but for generated
ASSETS it was enforced nowhere. It lived as prose in a spec that reaches the model as a prompt, and
**prose is not a gate**.
- **The ink token is the brand's TEXT colour, and four renderers painted a section with it** —
  flagship-mailer's `midnight` colorway (`heroBg: PAL.ink`), the `/lp/:id` footer and the video
  creative's letterbox (`background: var(--ink)`).
- **The fallback was the defect, not the data.** `emailHtml`'s palette fallback was
  `pal.primary || '#111111'`, and every band, the button and the footer on that mailer are painted
  with it — so a brand record with no palette shipped a BLACK EMAIL. No source sweep finds this;
  rendering it does.
- **A chain must end at the brand's OWN surface**, never at a literal from tenant zero's palette.
  `sectionGround(primary, accent, surface)`. One tenant's red on another tenant's page is the same
  defect class as one tenant's photo.
- **A control is not a section.** The rule says section backgrounds, and `validatePalette` gates the
  surface, not the primary — so a brand whose accent is near-black gets a black BUTTON, as on its own
  site. Gating it produced a white button on a white page. What matters on a control is its LABEL.
- **Contrast defects fell out of the same sweep**, each pairing two colours that look deliberate.
  The ACCENT with INK text is **2.77:1** — mailer CTA, landing CTA, video CTA, ad price pill and
  the mailer offer bar: **five files, one habit**. An accent eyebrow, pill, claims strip or offer
  line on a PRIMARY band is **1.51:1**, including the DEFAULT colorway. Faded text is the same defect
  wearing a different hat: an 85% eyebrow at 3.67:1, a 70% video disclaimer at 2.97:1, and — worst —
  the **CAN-SPAM sender identity at 60% opacity, 2.54:1**, the one line a commercial email is legally
  required to carry. Plus two hardcoded literals from no brand's palette: a cream at 82% (3.29:1) and
  a warm grey (3.18:1). `textOn()` runs `readableOn()` (pick the brand's better text colour for this
  ground) then `readableAsText()` (guarantee AA).
- **A comment asserting a rule is not the rule being kept.** `calendar-trigger`'s footer comment said
  "chalk + lava text stay high-contrast on it" while the code two lines below rendered 1.51:1 and
  2.54:1. That renderer's palette was also four tenant-zero literals sitting beside `_brand(o)`,
  `brandNameOf(o)`, `brandStore(o)` and `brandOrg(o)` — all carefully derived — so a second brand's
  mailer carried its own name, links and legal entity in another company's colours.
- **The gate RENDERS and MEASURES.** Two tests build a real campaign and read `getComputedStyle` in
  Chromium, so the tokens, the cascade, the inherited colour and **CSS `opacity`** are all resolved —
  that is what found the black `emailHtml` fallback and an 85%-faded eyebrow AFTER the source sweep
  had "finished". Each asserts it measured a non-trivial number of grounds and text runs first: **a
  check that inspects nothing passes everything.** One test renders for a brand whose own record
  carries a near-black primary, which tenant zero never exercises.
- **Every renderer that reaches a customer is in the gate**: both landing-page branches, both mailer
  branches, all three shared mailer variants (`calendar-trigger.renderTextVariant`), the video
  creative, the `/lp/:id` fallback page and the **Mailer Studio** (loaded and driven as the real
  page). Adding a renderer to the list is how each round of defects was found — the gate only sees
  what it is pointed at.
- **Drive every ARCHETYPE, not every brief.** The Studio gate first typed one brief and measured the
  result; mutating `countdownBlock`'s ground back to black did NOT fail it, because that section
  lives only in the `limited-drop-countdown` flow, which the brief never selected. A gate driven by
  whichever brief someone typed has holes in the shape of the briefs nobody typed. It renders all 11
  archetypes × 2 variants now (`window._ARCH_FLOW` is exported so the list cannot drift from a copy),
  which immediately found four more accent-on-primary sections the single brief never reached.
- **A validator that hardcodes one tenant is worse than none.** The Studio's own `brandPaletteCheck`
  allowlisted tenant zero's four hexes, so the moment the renderer became brand-derived it would have
  told every OTHER brand its own colours were off-brand — teaching the operator that the checker is
  noise. It reads the active brand's palette and typography.
- Every fix is mutation-verified: restoring each defect fails the gate.

## ⭐ A test that reads the source is not a test of the behaviour (2026-08-23)
`scripts/check-executed-tests.js`, CI step `npm run check:executed:ci`. The two tests guarding the
UNAUTHENTICATED LLM PROXY finding both asserted on source text: that `requireCaller(req, res)`
appears in the handler, and that its index is below the first provider call. Changing
`if (!(await requireCaller(req, res))) return;` to `await requireCaller(req, res);` puts the open
proxy straight back - the gate runs, its refusal is discarded, and the six-provider cascade spends
real keys for an anonymous caller. **Both source tests still PASSED.** Only the executed ones failed.
- **Executed now**: `api/ai/generate.js` and `api/ai/image.js` are `require`d and CALLED - the shipped
  entry point with its `credits.metered` and `request-scope` wrappers, which is what an attacker
  reaches. An anonymous POST and a forged bearer are both refused, and `global.fetch` is replaced with
  one that throws, so **no provider call escapes the gate** - a 401 that had already made the call
  would still have cost money.
- **A source assertion is NOT automatically wrong.** "A comp account's address must not appear in a
  file the browser downloads", "a foreign brand's product names must not appear in the deployed
  output", "a migration must contain the revoke" - those are file properties and a file check is the
  RIGHT tool. No script can tell them apart; the judgement is whether the claim is about the FILE or
  about what the code DOES.
- So the gate is a **ratchet, not a ban**: a per-file count that fails when one RISES, and says
  nothing when one falls. Baseline **177 across 44 files**. Largest debts: `brand-asset-content` 13,
  `brand-context-pack` 13, `brand-data-scope` 11, `brand-suggest` 11, `journey-join` 8.
- **It counts CODE, not comments** (2026-08-25). A test that replaces a source assertion explains
  itself by QUOTING the assertion it replaced — the most useful thing its header can say — and the
  raw scan then counted the explanation and reported the file as having gained the debt it had just
  paid off (`no-substitute-data.spec.js` scored +4 for describing the four it converted). Same
  `codeOnly` shape as `asset-contracts.spec.js`, whose comment records the same trap. Third time.
- Related: run the WHOLE suite after a change, not the files you touched. The credit-pricing guard
  broke three tests in `credits-comp-accounts.spec.js` and CI found them, because the local run had
  covered only the two suites the diff named.

## ⭐ The app looks like an instrument, without turning the lights off (2026-08-25)
The **futuristic layer** at the end of `theme.css`, gated by `tests/futuristic-layer.spec.js`. One
block re-skins ~50 self-contained pages, because `auth.js` appends `theme.css` with `defer` — it
lands AFTER each page's inline `<style>`, so at equal specificity it wins. Nothing raises specificity
and nothing uses `!important`, so a page that needs its own treatment still overrides it.
- **The obvious idiom is forbidden here, and that shaped the whole design.** "Futuristic" usually
  means a black neon console; dark-neutral section backgrounds are a HARD rule, `validatePalette()`
  BLOCKS activation on them and `asset-no-black-background.spec.js` fails them. So the future comes
  from DEPTH, MOTION and PRECISION on the brand's own light surface: an ambient aurora built from the
  active brand's primary and accent, a technical grid, frosted surfaces, a brand-gradient **energy
  line** along the top edge of every card, monospace tabular metadata, spring easing. It is also the
  only version that is multi-tenant — a neon palette would be one brand's, imposed on all of them.
- **No colour literal, anywhere in the layer.** Two aliases (`--vh-fx-primary` / `--vh-fx-accent`)
  are the only place a default appears, and each repo's default is its OWN token. Porting the block
  to the sibling repo carried tenant zero's red and purple in as inline fallbacks, so every card in a
  green-and-gold app drew another company's colours. The gate asserts ZERO hexes in the block —
  stricter than "no tenant-zero hex", because any hex is a colour the layer decided for itself.
  Mask gradients are excluded on purpose: a mask uses only the ALPHA channel, so `#000` there is a
  shape, not a colour, and counting it would train the next person to add exceptions until the check
  means nothing.
- **`backdrop-filter` on the wrong element MOVED THE WHOLE NAV RAIL.** `#lifecycle-nav` is a static,
  zero-height container; the visible rail is `.lnav-side`, a `position:fixed` CHILD. A
  backdrop-filter — like a `filter` or a `transform` — makes its element a containing block for fixed
  descendants, so the rail stopped being anchored to the viewport and floated into the middle of the
  page over the content. The CSS is entirely valid; only rendering shows it. The gate measures the
  rail's rect and walks its ancestors for anything that creates a containing block.
- **The rail is never frosted**, and its own source comment says why: its text tokens are
  contrast-adjusted against `--brand-surface`, and painting it any other tint put the group labels
  and every `?` chip at **4.44:1**. A translucent rail would let the ambient field through and tint
  it — the same defect arriving by a new route. It takes only `box-shadow`, which cannot change the
  colour behind text.
- **`color-mix()` is not used**, deliberately. Engines that lack it drop the declaration WHOLE rather
  than degrading (the 2026-08-21 finding). Brand tint is carried as full-strength colour on a layer
  with low `opacity`, which every engine supports.
- **Every `backdrop-filter` carries its `-webkit-` pair** and sits behind `@supports`; the gate fails
  on an unpaired one. Text colours are NOT touched at all — surfaces move a percent or two of
  luminance and the ink tokens are untouched, so the rendered-contrast gates hold by construction
  (36 contrast/nav/black-background tests pass unchanged).
- **The sheen's opacity lives in the @keyframes, not on `:hover`.** On the hover rule the animation
  ends, the transform reverts, and the bar snaps back to the card's left edge and SITS there at full
  strength until the cursor leaves — a white slab over the content.
- Every one of those four defects is mutation-verified: restoring it fails the gate.

## ⭐ A brand is saved to the account, or to THIS DEVICE - never to an error (2026-09-15)
`brand-context.js` -> the device store (`lifecycle.brand.device.workspaces` for the no-session states,
`.<user id>` per signed-in account since 2026-09-29, ids `local-*`, rows
stamped `storage:'device'`) + `auth.js` -> `LifecycleAuth.backend` / `backendState()`; gated by
`tests/onboarding-without-backend.spec.js` (7 tests). Found on the LIVE deployment at
`/onboarding?step=6` with the project paused: the operator typed a brand, reached "Review and
activate", and "Your brands" was a red YOUR BRANDS COULD NOT BE LOADED block, "Save as draft" and
"Activate" both toasted "The database is unreachable ... nothing has been saved", and "Brand context
pack" said "Save this brand first" on a brand that could not be saved. **Every command on the first
screen ended in an error, and nothing was being protected** - the 2026-08-30 finding one layer up:
the app opened, said so, and then threw the operator's own typing away.
- **The decision is auth.js's, published once, and consumed.** auth.js already answered "is there a
  backend, and am I signed in to it" for the notice bar (its probe, its session). It now publishes
  that as `LifecycleAuth.backend = {kind, reachable, signedIn, host}` (`unconfigured | unreachable |
  sdk | signed-out | signed-in | local`), an event, and a first-decision promise. brand-context.js
  reads it and routes the six brand ops (`list|active|get|save|activate|delete`) to the device store
  for the first four kinds and to the server for the last two; a page with no auth.js at all takes
  the server path exactly as before. **No second probe** - two implementations of one question drift,
  and the bar would say one thing while the wizard did another.
- **Three states, and what every wizard command does in each.** *Unreachable / unconfigured:* save,
  activate, switch, edit and delete all work on the device; "Read my site" stays ON (the server's own
  open path); context pack, catalogue import and Suggest options render **DISABLED with their reason**
  in the accent rule - a disabled control with a reason is not an error and never wears `.vh-failure`.
  *Reachable + signed out:* the same, except "Read my site" is off too, because the server correctly
  REFUSES extract when a session exists to be had - so the control says "sign in" rather than sending a
  request known to be refused. *Reachable + signed in:* the server, byte-for-byte as before, and if
  device rows exist they are OFFERED for sync ("Sync N brands to your account") through the ordinary
  save op - never uploaded unasked, the device copy removed only after the account row exists, a
  refused upload shown per brand in the failure frame.
- **The panel says ONE sentence, in the accent rule**: "Saved on this device only. Once a database is
  reachable and you sign in, they can be synced to your account" (or "Sign in and they can be synced",
  when signing in IS the remedy - a sentence about reaching a database would send the reader to fix the
  thing that is not broken). The standing bar has already stated the cause; the panel does not repeat
  it as an error. Device rows carry a quiet "on this device" chip and nothing else changes. The gate
  measures the rule's computed colour against the page's own `--accent` token and asserts it is neither
  the warn nor the error colour.
- **The device path paints what the server would have painted.** `tokens()`, `validatePalette()`,
  `fontsHref()`, `readiness()`, `buildRow()`'s normalisation and `shellPayload()` are ported
  line-for-line, and the gate drives BOTH - the real page in Chromium and the real server module in
  Node - over four palettes (tenant zero, a pale primary, an incomplete one, an empty one) and diffs
  every token. Activation on the device is gated by the same design rules: an active brand with a
  dark-neutral surface is refused with the server's sentence, a draft with the same palette saves.
- **What is asserted about the network is the absence of traffic.** In both device states the request
  log must contain zero brand ops; a save that "worked" by falling through to a 503 would still render
  the failure this exists to prevent. In the signed-in state the request BODY is asserted and the
  device key must be null. `page.on('dialog')` is registered first: any dialog fails.
- **`?step=N` only resumes when boot() has a brand to load**; with no active brand the wizard stays on
  step 1. A fixture that seeds device rows under a signed-in session therefore reaches review by the
  pip, the way a person does.
- **`error-presentation.spec.js`'s "Your brands" cases moved to a SIGNED-IN fixture**, and correctly
  so: with no account there is no request to refuse and the panel is not a failure. The state in which
  that panel still asks the server and can be refused is a session whose server then answers 503/500
  (a session from before the pause, a function that errored) - a real shape, and the one the failure
  frame was always for. The auth.js-absent "floor" case is unchanged: its stubbed `list()` throws, and
  a thrown `list()` is a refusal whatever the network looks like.
- **A marker is never padded.** `readiness()` on the server (`launchMarker()`) and in the wizard emitted
  `[DATA REQUIRED BEFORE LAUNCH: logo URL, all, all]` - the `field, product, region` template with
  "all, all" where a fact should be, one per line on the review step. Product and region are named only
  when they APPLY: `[...: logo URL, <brand>]`, `[...: region store URL, <brand>, US]`, and a
  product-level gap still names the product in the product's slot.
- Mutation-verified, each on the assertion it should hit: making the device `save` fall through to the
  dead host fails on "the draft ... is not listed"; dropping the accent sentence fails on the sentence;
  rendering the device state in `.vh-failure` fails on "rendered a FAILURE for an ordinary state".
  `signed-out-usable.spec.js` passes unchanged: `LifecycleAuth.internal` stays false, RLS untouched.

## ⭐ The login wall that defends nothing, on the SERVER this time (2026-09-15)
`api/_shared/brand-workspace-core.js` -> `requireUser()` + the `openWithoutBackend` branch, and
`brand-context.js`'s error line. Gated by `tests/extract-without-backend.spec.js` (9 tests). Found on
the LIVE deployment, not in the source: the Supabase project is paused, the app correctly opens
signed-out and SAYS so - and then the headline control of the FIRST SCREEN, "Read my brand from my
website", answered **`session_verification_unavailable`**. Two independent defects, one screenshot.
- **`?op=extract` sat below `requireUser()`, and needs no database.** It reads the public website the
  operator just typed and returns a report: writes nothing, reads no table, and `runExtract`'s only
  use of `auth` is an optional `getWorkspace()` to widen crawl scope, already wrapped in a try/catch
  that degrades. With the auth host unreachable the gate protected no data and no spend - it only
  guaranteed a 503. **This is the 2026-08-30 finding arriving through the other door**: that fix
  opened the PAGES in the browser and left the server-side gate behind them. Deleting a wall means
  auditing everything that enforced the same rule elsewhere, not just the wall.
- **"Not signed in" and "no backend to sign in to" are different**, and that distinction was already
  computed - it is the difference between a response and a thrown fetch - then flattened into one
  503. `backend_unreachable` now carries it, and only the unreachable case opens. A backend that
  ANSWERS and rejects the caller still refuses: a session exists to be had, so the gate is real.
  Same "fail closed on doubt" rule `auth.js` applies in the browser.
- **Voice observation is FORCED OFF on the open path.** It is the single LLM call in the extractor, so
  leaving it on turns an unreachable database into an unauthenticated LLM proxy spending real
  provider keys - the 2026-08-23 finding, re-introduced by way of a fix. The response says the voice
  was skipped and why, rather than a marker reading like the site published no voice.
- **AN ERROR CODE IS NOT AN ERROR MESSAGE.** Every refusal carried `error` (a machine code) plus a
  `hint`/`detail` written for whoever was calling the API, and **no sentence at all**; `brand-context.js`
  then read `json.error || json.message` - the CODE first. One line, and **every** failure in the app
  funnels through it, so an operator was shown an identifier where the explanation should be. Every
  refusal now carries a `message` naming the cause and the host to change; the code stays on `e.code`
  for anything that branches on it.
- **The gate's own first version missed the worst mutation.** Turning `voice:false` into `voice:true` -
  the open-LLM-proxy case - PASSED. Two reasons, both worth knowing: `llm.js` does
  `module.exports = async function callLLM(...)`, so **the module IS the function** and stubbing a
  `.callLLM` property replaced a key that does not exist; and the test asserted `voice_skipped`, a flag
  the handler sets ITSELF, which only proves a handler can set its own flag. It now intercepts
  `require.cache` and asserts the note the EXTRACTOR produced. **A check that inspects nothing passes
  everything** - the same lesson as the rendered-contrast gate, reached from a new direction.
- The SSRF guard (`assertPublicUrl`) is driven for real against loopback, link-local metadata and a
  non-standard port, because opening an endpoint to unauthenticated callers makes that guard matter
  more, not less.
- All four fixes are mutation-verified, including both directions that must NOT open (an auth bypass
  on any auth failure, and an open LLM proxy).

## ⭐ Which store is this, and did we read all of it (2026-09-13)
`api/_shared/storefront-detect.js` + `site-crawl.js` -> `robotsInfo()`/`readSitemaps()`, gated by
`tests/storefront-and-sitemap.spec.js` (15 tests). Setup-from-URL could read a brand's colours,
typography, voice, claims, logo, icons, imagery, legal entity and regions. It could not answer the
one question every competing onboarding flow opens with, and the one an operator checks first:
**which store is this.** Three defects, all found by RUNNING the pipeline, none visible from reading it.
- **The platform was never detected.** A fixture declaring Shopify FOUR ways - `<meta
  name="generator" content="Shopify">`, `Shopify.shop = "…myshopify.com"`, a `cdn.shopify.com`
  script and `class="shopify-section"` - produced a report containing the string "shopify" **zero
  times**. Not cosmetic: `importCatalog` established the catalogue route by firing `/products.json`
  and reading the failure, so every non-Shopify store paid a wasted request and its owner was told
  *"Public product feed not available at that URL"* - a sentence true of every WooCommerce,
  BigCommerce and Magento store on earth, which reads as a fault in their site. Now 14 platforms from
  what the site PUBLISHES about itself (generator tag, the platform's own global object, its own CDN
  host, its own namespaced classes), each with source URL and confidence. **A platform name in PROSE
  is not a declaration** - a blog post titled "why we left Shopify" would otherwise make every agency
  site a Shopify store. A CMS is reported BESIDE the commerce platform, never instead of it: a
  WooCommerce site is a WordPress site, and collapsing them routes its import as if it had no store.
  Two commerce platforms at once is reported as a conflict, not resolved.
- **Detecting a platform does not conjure a feed for it.** Only Shopify's `/products.json` is an
  endpoint this repo may call, and it already calls it; every other platform routes to the site crawl
  and `catalogRouteFor()` says so in a sentence that does not imply the operator's store is broken.
  Same rule as an unverified adapter endpoint: never add one a platform's docs did not give you.
- **The site's own URL list was fetched and thrown away.** `site-crawl` fetched `robots.txt` on every
  run and its parser read `user-agent` and `disallow` and discarded the rest - including the
  `Sitemap:` directive pointing at the site's own declaration of its own pages. Measured on a
  20-product fixture whose home page links ONE product (the normal shape of a store: the rest live
  behind a paginated grid a depth-limited walk never unrolls): **1 of 20 products found, then 20 of
  20.** `Sitemap:` is GROUP-INDEPENDENT in the spec and conventionally sits ABOVE the first
  `User-agent` line, so reading it inside the `inStar` gate - right beside `disallow`, where it looks
  correct - discards it on the commonest robots.txt layout there is.
- **A page count is not coverage.** "14 pages read" is excellent coverage of a 14-page site and 2% of
  a 700-page one. `coverage_note` now states both, and `sitemap.checked:false` (a resumed batch) is
  kept distinct from `found:false` (the site publishes none).
- **`brand-extract` had never honoured robots.txt.** It wraps its fetcher to keep non-HTML out of the
  page reader - correct, and necessary, so a stylesheet is never parsed as a page. `robots.txt` is
  `text/plain`, so every robots.txt read as unreachable, the disallow list came back empty, and the
  user-agent this module sends ("respects robots.txt") was not true for it. Nothing errored; the rule
  simply stopped applying one layer above where it was implemented. **`robots.txt` and `sitemap.xml`
  are not pages**, so they take their own `assetFetch` parameter, defaulting to `fetchImpl` - which
  is byte-for-byte what every existing caller already got.
- **Scope is re-checked on the sitemap URLs THEMSELVES.** `robots.txt` may legally declare a sitemap
  on another host; fetching one would take another company's URL list as this brand's, the same
  worst-case as following an off-site link, arrived at without following one. A `Disallow` still
  applies to a sitemap-declared URL, as a prefix rule - a sitemap is the site saying "these are my
  pages", not the site withdrawing a Disallow.
- One crawl serves both readers: `robots.txt` and `sitemap.xml` are fetched exactly once, and the
  platform is detected from the pages the crawl already read. No second crawler, no extra request.
- All four fixes are mutation-verified: restoring each defect fails the gate.

## ⭐ A brand's typography is its SCALE, not two family names (2026-08-27)
`api/_shared/brand-extract.js` → `typeScaleCandidates()`, gated by `tests/brand-type-scale.spec.js`.
Setup-from-URL read font FAMILIES and stopped. Both the extractor and the context pack said so in as
many words — *"Font size, weight, line-height and letter-spacing cannot be read reliably from a
stylesheet parse"* — and shipped a `[DATA REQUIRED BEFORE LAUNCH: typography scale]` marker. **That
was an honest sentence about a limit that did not exist.** A `font-size` on `h1` is published in the
same rule, in the same stylesheet, as the `font-family` beside it; the module never read the
property. An existing test asserted the defect (`expect(Object.keys(tok)).toEqual(['fontFamily'])`),
which is why it survived so long.
- **Now read, per slot** (h1–h6, body, link, button): size, weight, line-height, letter-spacing,
  text-transform, font-style and the **text colour** — the last being what an operator actually means
  by "font colours". Plus the site's own NAMED scales (`--text-lg`, `--leading-tight`, `--tracking-*`).
  Same confidence model as families: `declared` (named token) → `strong` (simple selector) → `weak`.
- **`rem` is resolved against the root the SITE declared**, never a guessed 16. A site using the
  standard `html{font-size:62.5%}` trick has a 10px root, so its `1.6rem` body is 16px — reporting
  25.6px would be a fabricated number wearing a unit. `em` is deliberately NOT converted: it is
  relative to a parent, and this module builds no box tree. An assumed root is labelled assumed.
- **`html` is the root, `body` is the body.** Collapsing them into one slot let `html{font-size:62.5%}`
  win the body slot, and the brand was recorded as having 62.5% body text.
- **Strength is the SHAPE of the selector, not whether it is an element.** Marking every class `weak`
  was wrong in a way that mattered: `.vh-h1` is the site NAMING its heading style. Reading only bare
  `h1`..`h6` returned **two rows from 197KB** of this repo's own Mailer Studio CSS, because it — like
  most of the web — styles `.vh-h1` and never `h1`. What genuinely weakens a rule is being SCOPED:
  `.hero .title` is a title inside a hero, not the brand's h1. Simple selector → strong, compound → weak.
- **A component prefix disqualifies a class outright**, and the role word must END the class name.
  Without both, `.nav-title` took the h1 slot and `.copy-preview-hl` took the body slot.
- **A row earns its place with a size, a weight OR a colour.** Requiring a size dropped the link row
  entirely, and `a { color: … }` almost never carries one.
- **The honest limit is recorded, not implied**: attribution is by SELECTOR, so a utility-first site
  (`text-2xl`) publishes no rule attributable to a heading and reads as having no scale — which is a
  different statement from having one that could not be seen. Closing that needs either real cascade
  resolution (specificity + order) or a headless browser, and Chromium does not fit the Hobby
  serverless path.
- Catalogue was already covered and was NOT rebuilt: it is stage one of the pack
  (`STAGES = ['catalog','extract','knowledge','repos','done']`), through the existing `importCatalog`,
  and blocks activation until it has rows.
- Every one of the five defects above was found by RUNNING the extractor over real stylesheets in
  this repo, not by reading the parser, and each is mutation-verified.

## ⭐ Signed out is a usable state, not a locked one (2026-08-30, supersedes the section below)
(See the CORRECTION in the section below: the backend was PAUSED by an org-wide billing hold, not
deleted. What follows is unaffected — an unreachable backend is unreachable whatever the cause.)

`auth.js` -> the login wall is GONE. `gateSignedOut()` opens every page for a signed-out visitor
whether or not the backend is reachable; `injectSignedOutNotice(kind)` explains which of four states
this is. Gated by `tests/signed-out-usable.spec.js` (9 tests) in both repos.
- **Why this is not an auth bypass, which is the obvious objection.** The wall was never the security
  boundary and could not have been: the anon key it gated is PUBLIC by design — it ships in the
  browser and `/api/public-config` hands it to anyone who asks — so anything the wall "protected" was
  always one curl away. **RLS is the boundary**: 74 `is_brand_member` policies and 135 `auth.uid()`
  checks. With no session `auth.uid()` is null, every one fails, and a signed-out caller reads
  nothing. Even the four aggregate views granted to `anon` are `security_invoker=on`. Removing the
  wall changes what the UI SHOWS, never what the database RETURNS.
- **The test moved to the real boundary.** The old guard asserted "a configured deployment still
  walls" — a UX proxy for security. It is replaced by three that check the thing that actually
  matters: the app never fabricates a signed-in state (`LifecycleAuth.internal` stays false, and that
  flag is what grants full live access), the RLS policy counts have not thinned out, and **no NEW
  object is granted to `anon`**. A wall is a proxy for a boundary; test the boundary.
- **What the anon ratchet found, and it is worth knowing**: `smart_generated_campaigns` and
  `smart_brain_runs` carry `using (true)` policies AND anon grants, on purpose since
  `20260719120000`, so `/lp/:id` can serve a generated landing page on the anon key when
  `SUPABASE_SERVICE_ROLE_KEY` is unset. Pre-existing, unaffected by this change in either direction,
  and now pinned by name so a new one has to be argued for.
- **Four states, four sentences, and only three are anyone's to fix**: `unconfigured` (no env var),
  `unreachable` (a project deleted/renamed/paused — its host is printed, because that is the value
  that has to change), `sdk` (the supabase-js CDN was blocked), and `signed-out` (everything works;
  this visitor has no session). The last one takes the ACCENT rule, not the warn rule: being signed
  out is an ordinary state, and a normal state wearing a warning colour teaches people to ignore the
  bar. An empty panel with no explanation reads as "no data" rather than "not signed in".
- **The SDK-failure path would have gone silent.** `boot()`'s catch called `showAuthBackendNotice`,
  which wrote into the wall's own `#llw-notice` slot — with no wall there is no slot, so it rendered
  into nothing. It routes through the standing bar now. Deleting a component means auditing what
  wrote INTO it, not just what called it.
- The sweep drives **all 66 pages x BOTH configurations** (no backend, and live backend signed out).
  Only one was ever swept before, and the live one is where the wall used to appear on every page.
- Mutation-verified: restoring the wall for a live backend fails 2 tests.

## ⭐ A login wall that defends nothing (2026-08-30)
`auth.js` -> `gateSignedOut()` + `injectNoBackendNotice()`, gated by `tests/signed-out-usable.spec.js`
(both repos). `<ref>.supabase.co` went NXDOMAIN, so every page that is not the homepage, a legal page
or the Studio showed a login wall nobody could get past: getting past it needs the very project that
was not answering. **The whole product became unreachable, not gated.**

**CORRECTION (2026-09-12): the project was never deleted — it was PAUSED, and the whole org was.**
This section originally recorded "the Supabase project was deleted", concluded from the NXDOMAIN
result alone. Checked against the Supabase API on 2026-09-12: `fswdwmkgggzyxrdzabnh` exists, Postgres
17.6.1.155, `status: INACTIVE`, with every table, all 18 SQL functions and all 74 RLS policies intact.
**A paused project and a deleted one are indistinguishable from the network** — same NXDOMAIN, same
dead `/auth/v1/authorize` — which is exactly why `auth.js` says "deleted, renamed or paused" and
never picks one. The diagnosis was already correct IN THE CODE and was not applied to the
measurement. The actual cause is org-wide: `restore_project` returns `PaymentRequiredException` —
unpaid invoices on the Vercel-provisioned org (`vercel_icfg_…`), which is why all 8 projects paused
together rather than one timing out. **Nothing here needed migrating to Neon or anything else; it
needed an invoice settling.** The lesson is the one this file keeps recording: a signal that two
causes share does not identify either, and "the host does not resolve" is that kind of signal.
- **A wall keeps unauthorised people away from DATA.** With no reachable backend there is no session
  to obtain and no query that can succeed, so there is nothing on the other side to protect. It cost
  every feature and defended nothing. So the app opens, unauthenticated, on whatever local state it
  has, and SAYS so.
- **The case that mattered was the one that looked configured.** Two states reach the same dead end:
  no `SUPABASE_URL` at all, and — the state production was actually left in — the env var still SET
  and still naming a project that is not answering. In the second, `config` is truthy, so every "is it
  configured" check passed, the wall went up reading *"Sign in to continue"* with no cause named, and
  the button navigated the browser to a host that does not resolve. **Fixing only the unconfigured
  branch would have left the live deployment exactly as broken as it was found** — and the first
  version of this fix did exactly that, which is only visible by booting the app against a dead host.
- **Fail CLOSED on doubt.** A timeout counts as REACHABLE, so a slow network keeps the wall; only an
  outright DNS/network refusal opens the app. `mode:'no-cors'` because a CORS refusal and a dead host
  both reject a normal fetch, and blocking sign-in on a healthy project would be a worse bug than the
  one being fixed. Nothing is latched: the wall returns by itself once the host answers.
- **The notice names the CAUSE and the HOST**, because that is the value the operator has to change.
  Brand tokens only and never a dark ground (`--vh-panel-2` surface, `--vh-warn` inset) — a banner
  that hardcoded its colours would be the one element ignoring the active brand.
- **One probe, not two.** The sibling repo had already solved reachability (`authBackendReachable`,
  with offline/timeout/unreachable reasons and a remedy per reason). Porting a second, weaker probe
  next to it would have left two implementations to drift apart — the same defect class as one
  brand's colour or one project ref. `gateSignedOut` there reuses the existing one.
- **A dead constant shipped in the browser.** `PUBLIC_SUPABASE_FALLBACK` held a hardcoded project ref
  as last-resort config; it is now empty and a deployment that needs one sets
  `window.__SUPABASE_FALLBACK__` in its own HTML. This was the SECOND time a baked-in ref went stale
  here — the Mailer Studio's own comment records being repointed off "a stale third project".
- **The fixture lied, and the auth-bypass guard failed because of it.** The spec's catch-all route
  aborted the `/auth/v1/health` probe, so the "live backend" case read as unreachable and the app
  opened — reported as the app dropping its wall. Reachability is now stated per case. A harness that
  manufactures a failure is the same problem as one that manufactures a pass.
- **CI could not have caught the related parse error.** `data/design-intelligence.js` had an
  unescaped apostrophe (`the brand's`) closing a single-quoted string; the whole file failed to
  parse, so `/design-intelligence` ran none of its JavaScript — and CI was green, because the syntax
  check walked `api lib workers scripts` plus a HAND-KEPT list of four root files. It is
  `git ls-files '*.js'` now (287 files, all parsing): a hand-kept list is a list that gets forgotten.
- Three mutations verified in both repos: making the opening unconditional (an auth bypass) fails the
  gate, restoring the unpassable wall fails it, and making `gateSignedOut` always wall fails it.

## ⭐ Governing spec: Campaign Orchestration Master Operating Contract
`docs/campaign-orchestration-master-spec.md` is the standing operating contract for all campaign
calendar, cohort, mailer, ad, dashboard, and creative generation work. When building or generating
any of those, obey it. Load-bearing rules (full detail in the doc):
- **Zero fabrication** — never invent product facts, prices, URLs, images, ratings, reviews, claims,
  segment sizes, or performance. Missing data -> `[DATA REQUIRED BEFORE LAUNCH: field, product, region]`.
- **Closed source-of-truth** — only the repo + the exact official KNICKGASM regional site for the exact
  product/region. No cross-region reuse of facts/assets/reviews/claims/URLs.
- **Design HARD rules** — never black/`#111111`/dark-neutral section backgrounds (use the brand colour or the
  surface); enforce WCAG-AA contrast (no dark-on-dark / light-on-light); equal-size aligned parallel cards;
  proofread all copy; source-map every fact. The first two are ENFORCED for generated assets since 2026-08-21
  — see the section below.
- **Frequency** — promotional cap 2 (absolute 3) per rolling 7 days; do not assume all ~111k are
  contactable daily (preferred ~31.7k/day); reduce/delay/block when eligibility is short.
- **Reviews/ratings** — only approved review data; never round 4.9 to 5, never invent reviewers, never
  transfer across product/region.
- **Launch gate** — weighted >= 9.5/10, no critical dim < 9; otherwise
  `NOT LAUNCH READY — DATA/DESIGN/FACTUAL/TECHNICAL DEPENDENCY`.
- **Shared source of truth (spec §24b, design `docs/shared-source-of-truth.md`)** — the Email Calendar
  and every other feature (Content Calendar, Blog Agent, Creator Plan, Social Generator, Paid Media,
  Analytics, Publishing Queue) are synchronized VIEWS over ONE canonical data model; never separate
  duplicated campaign systems. One authoritative record per campaign/product/offer/price/inventory/
  claim/review/rating/image/asset/forecast, referenced by stable id. No independent feature copies of
  facts (a snapshot must reference the canonical row + show CURRENT/STALE). Canonical change → event
  propagation (recalc, revalidate, mark stale, regen, audit, status). Pre-launch sync gate blocks any
  launch from a stale snapshot. One record, many views — not many records that need reconciliation.
Known current gaps vs this spec (data feeds to wire before launch): approved review library, approved
claims library, approved URL map, real eligible-segment sizes, valid `SUPABASE_SERVICE_ROLE_KEY`.


A retention/lifecycle-marketing toolkit for KNICKGASM, deployed as a **single Vercel project** (no framework — `framework: null`, `outputDirectory: "."`). It started as the Mailer Studio (`lifecycle_mailer_architect_v34.html`) and grew into a multi-page suite: data analysis → marketing calendar → mailer creation → competitor intelligence → knowledge base → ad/landing-page generation.

Live: https://knickgasm.vercel.app/ (→ https://lifecycle-os.anchit-tandon.com/) — this is the project that receives `main` deploys (health `build:"lifecycle-os"`). · Canonical repo: github.com/anchittandon-create/KNICKGASM, working dir ~/KNICKGASM/lifecycle-os. Built 2026-08-03 by replicating the architecture of a sibling lifecycle-OS project, then rebranded end to end for KNICKGASM (custom sneakers). No product, catalogue, customer or performance data from that project is retained - see scripts/gen-demo-analytics.js and scripts/gen-demo-d2c-dashboard.js, which generate all sample data from the live knickgasm.com catalogue.

## Version taxonomy (V1 vs V2) — product-owner convention, 2026-07-03
- **V1 = the legacy base app**: everything that existed before 2026-07-03 (dashboard/analytics, /plan RFM calendar, Mailer Studio /studio, competitor, KB, ads, landing pages, KicksGPT, smart-brain).
- **V2 = the Lifecycle OS additions of 2026-07-03**: the cohort mailer-calendar system (/mailer-calendar), the UK non-engagers campaign hub (/uk-non-engagers) + week-1 campaign, tier-routed LLM/image cascades + video-core, Social Media OS (/social), knowledge/retention/ library, and the LHS-nav IA rule.
- V1 features are upgraded by customising the base version, and only where needed. Where a feature exposes both generations in menus/hubs, label the earlier build **"Option 1"/"Draft 1"** and the current one **"Option 2"/"Draft 2"** (V2 = the second draft).

## Mailer type taxonomy
Mailers come in exactly two named types:
1. **Text** — pure typographic (the `pure` render style).
2. **Text + Graphics** — text plus BUILT graphic elements only: brand-palette colors, buttons, labels, badges, dividers, price/receipt tables (CSS/table constructs — never photos; photos are optional slots the user fills). Any combination of such elements qualifies. Maps to the `visual`/`editorial` render styles.

## SiS distribution branch — NEVER merge into main
The branch **`snowflake-streamlit-app`** is a permanently separate distribution of this repo:
the Streamlit-in-Snowflake version (runs natively in Snowflake via `get_active_session()`,
reads warehouse tables directly — no Vercel, no Supabase, no HTML pages). It intentionally
diverges from main and **must NEVER be merged into main** (nor main into it wholesale; port
changes by hand when needed). Enforced by the required check
`.github/workflows/protect-main-from-sis.yml`, which fails any PR from that branch into main.
Deploy that branch from Snowsight (Git-linked workspace or paste `streamlit_app.py`).

## Commands
```bash
npm run build          # scripts/build-catalog.js → data/catalog/products_{us,uk,global}.json (runs at deploy via vercel.json buildCommand)
npm test               # playwright test (tests/ dir; config playwright.config.js)
npm run test:ui        # playwright test --ui
npm run test:install   # playwright install (first-time browser download)
npm run deploy         # vercel --prod
npx playwright test tests/<file>.spec.js   # run a single test file
```
There is no real `dev` server (the `dev` script is a no-op stub). For local serverless testing use `vercel dev`. CI (`.github/workflows/ci.yml`) only does an HTML smoke check + `npm run build` — there is no lint step.

## Architecture — the big picture

### Frontend: independent static HTML pages sharing one auth/nav shell
Each page is a **standalone, self-contained `.html` file** (inline CSS + JS, often huge — `lifecycle_mailer_architect_v34.html` is ~7700 lines / 700KB+). They are NOT a component tree; they share state via **localStorage** and a common script:

- **`auth.js`** — dropped into every page via `<script>`. It (1) boots a Supabase client from `window.__SUPABASE__` or `/api/public-config`, (2) forces one-time Google sign-in, (3) renders the shared top-bar / cross-step navigation, (4) registers the service worker (`sw.js`) for PWA install + aggressive cache self-healing, (5) exposes `window.LifecycleAuth.{client, session, signOut}`.
- Pages: `index.html` (home), `dashboard.html` (RFM/cohort analytics), `calendar.html` (30-day plan), `lifecycle_mailer_architect_v34.html` (Mailer Studio — the main app, served at `/studio`), `competitor-benchmarking.html`, `knowledge-base.html`, `ad-campaigns.html`, `landing-pages.html`, `cohort-definitions.html`.
- Friendly URLs are wired in `vercel.json` `rewrites` (e.g. `/studio`, `/analytics`, `/plan`, `/competitor`, `/kb`, `/ads`). When adding a page, add its rewrite there.
- Shared front-end helpers: `chart-enhance.js`, `table-sort.js`.

### Backend: Vercel serverless functions under `api/`
**Hard constraint — Hobby plan caps Serverless Functions at 12.** The app sits at that limit, which dictates the structure:
- **Files under `api/_shared/` are NOT counted as functions** (underscore-prefixed paths are excluded). Heavy logic lives there and is `require()`d by the thin public endpoints.
- Multi-capability features are **single catch-all routers dispatched by `?action=`** rather than one file per capability:
  - `api/competitor.js` → `?action=list|html|poll|sync` (logic in `_shared/competitor-core.js`)
  - `api/kb.js` → `?action=ingest|list|top-emails|brands|classify-emails`
- Before adding a new `api/*.js` file, check the count in `vercel.json` `functions` — prefer extending an existing router.

| Endpoint | Purpose |
|---|---|
| `api/ai/generate.js` | Text generation: create_brief, concepts, mailer_full, suggested_prompts |
| `api/ai/image.js` | Image generation cascade (see below) |
| `api/ai/pipeline/*.js` | Multi-stage mailer pipeline: strategy → variant → images → html → score (+ health) |
| `api/calendar.js` | `?action=generate` (30-day plan) + `?action=trigger-mailer` + `?action=smart-brain-*` (plan/sync-daily/cron/approve/reject/run-daily/feedback…) + `?action=lp&id=` (serves generated landing pages at `/lp/:id`). Logic in `_shared/calendar-generate.js`, `_shared/calendar-trigger.js`, `_shared/smart-brain-plan.js`, `lib/smart-brain/services.js` |
| `api/competitor.js` | Competitor Benchmarking router. Competitor universe in Supabase (`_shared/competitor-universe.js`); mail capture via Gmail IMAP → Google Sheet, both optional |
| `api/kb.js` | Knowledge Base router (Supabase-backed) |
| `api/public-config.js` | Public config (Supabase URL + anon key) + `?health=1` health check; `/api/health` rewrites here. **Operator-only modes:** `?pipeline=1`, `?probe=1`, and the DETAILED `?health=1` payload require `Authorization: Bearer <operator Supabase token or CRON_SECRET>` (allowed domains via `ANALYTICS_ADMIN_DOMAINS`, default `knickgasm.com`) and drop wildcard CORS. Anonymous `?health=1` returns liveness only (`ok/build/ts`) — never provider, key, model, region or env state. `?probe=1` also spends provider quota, so it must never be anonymous. |

### Shared LLM caller — `api/_shared/llm.js`
6-provider text waterfall, de-duplicated: **OpenAI** (`OPENAI_API_KEY`/`_2`/`_3`) → **Anthropic** (claude-3-5-haiku) → **Gemini** (free tier) → **Grok/xAI** → **Groq** (free) → **Cerebras** (free). All callers should go through this rather than calling providers directly. Per-call provider override is supported (`'gemini'|'openai'|'anthropic'|'grok'`).

### Competitor universe — per brand, in Supabase, no Google needed (2026-08-13)
`api/_shared/competitor-universe.js` + `public.brand_competitors` (migration `20260813120000`) are the competitor set for the ACTIVE brand. It moved out of the Google Sheet because the sheet needed credentials this deployment does not hold (every brand saw "0 brands" and a raw `Google auth not configured` error) and because one spreadsheet cannot hold more than one tenant's universe. RLS is the same `is_brand_member` gate as the rest of the brand content; server paths use `restAs`-style calls as the caller, and the cron uses the service key with an explicit workspace filter. Unique per workspace on a generated `dedupe_key` = domain, else folded name, so **de-duplication is by domain**.
- **Seed on activation** — `brandCore.setActive()` calls `seedForWorkspace()`, which derives ONLY from that brand's own record (its `competitors` list and its `market_study` tiers, including the structured `tiers[].brands` entries in `data/brands/_default.json`). No LLM and no network, so activation cannot hang. A tier whose note says it does not compete is skipped. A brand whose record names nobody gets `[DATA REQUIRED BEFORE LAUNCH: competitor set, …]`, never another brand's list — the rule `competitor-core.seedBrands()` states is enforced structurally here: the brand record is fetched by id and there is NO fall back to the default brand.
- **Auto-update** — `refreshDueWorkspaces()` runs off the EXISTING daily cron (`/api/brain?action=cron`); no third Hobby cron. Three least-recently-refreshed active workspaces per run, tracked in `brand_competitor_refresh`. Discovery is prompted from that brand's own industry/offerings/regions; a candidate without a real-looking domain, or on a reserved name, is dropped and reported. Discovery may contribute a name and homepage marked `verification:'unverified'`, never a positioning line, category or rating.
- **Google Sheet is now an export only** — `exportToSheet()` and `?action=universe-export` run when credentials exist, and say `configured:false` when they do not. `core.sheetsConfigured()` gates every remaining sheet-backed action so an unconfigured deployment reports an honest empty state instead of a credentials error.

### Auth to Google Sheets — Workload Identity Federation (keyless)
The competitor MAIL ARCHIVE (not the universe, see above) lives in a Google Sheet. Auth has **two modes** (see `docs/workload-identity-federation.md` and `_shared/competitor-core.js`):
- **Mode A (preferred, keyless):** WIF — Vercel mints a per-request OIDC token (`VERCEL_OIDC_TOKEN`, enable "OIDC Tokens" in Vercel project settings), Google STS swaps it, code impersonates the SA. Set `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT_EMAIL`.
- **Mode B (legacy):** JSON key in `GOOGLE_SERVICE_ACCOUNT_*` env vars. Code prefers Mode A when `GCP_*` present; falls back to JWT when `VERCEL_OIDC_TOKEN` absent.

### Smart Brain (persistent daily loop)
`lib/smart-brain/services.js` (6 services: KB, Analysis, Competitor, Calendar, Generation, Review) + `api/_shared/smart-brain-plan.js` (persistent rolling **90-day** plan in `smart_calendar_entries`, diff-updated daily, human approve/reject). Daily Vercel Cron (03:30 UTC) hits `/api/cron/smart-brain` (rewrite → `?action=smart-brain-cron`, `CRON_SECRET`-protected). Console UI: `smart-brain.html` at `/brain`. Approving a slot LLM-writes mailer + Meta/Google/TikTok ads + landing page (served at `/lp/:campaignId`) and mirrors them into `ads_generated`/`landing_pages_generated`. Platform push stays Phase 2 (`push_status: not_integrated_phase_2`).

**90-day horizon + asset prebuild (2026-07-09).** The rolling window is 90 days (`calendarDays: 90` in `services.js`, `calendar.days: 90` in `brain-core.js`, V1 `calendar-generate.js` cap raised to 90). Every slot in the window is not just planned but has its **full asset bundle prebuilt** — LLM copy + generated images for mailer + ads + landing page. Because ~180 slots (90d × US/UK) cannot build in one serverless invocation, `prebuildAssets()` is a **convergent background queue**: `?action=smart-brain-prebuild` (CRON_SECRET-protected) builds one small batch (via `buildCampaign(..., {withCreatives:true})`), persists it to `smart_generated_campaigns` as a `prebuilt` draft (NOT mirrored to the ads/LP dashboards until approval), marks the slot with a `payload.__prebuilt` marker, then re-fires itself until `remaining` hits 0, then idles. It self-chains via a fire-and-forget `fetch` to `VERCEL_URL` (3s handoff; the child keeps running after the client aborts). Kicked automatically after `smart-brain-sync-daily`, off the existing `/api/brain?action=cron` daily run (no 3rd Hobby-limited cron added), and re-runnable by hand. `previewEntry`/`approveEntry` REUSE the prebuilt campaign (instant view, no regeneration; what the reviewer saw is what ships). A material re-plan of a slot on daily sync drops the marker → the queue rebuilds the now-stale assets. Idempotent + resumable; a total-failure batch stops the chain instead of hot-looping.

**Whose audience, whose proof, and whether you can SEE it (2026-08-14).** Four things the fork
inherited from the sibling project reached customers through this path, and all four are now closed
in `smart-brain-plan.js` + `smart-brain.html` (tests: `tests/smart-brain-assets.spec.js`):
- **Audience** — the ad art-direction line hardcoded the sibling company's persona and art-directed
  EVERY tenant's imagery with it. `audienceBrief(entry)` now derives it from the slot's COHORT (a
  behavioural segment from the brand's own data, name + rules) plus any audience stated on the brand
  record; with neither, the brief carries `[DATA REQUIRED BEFORE LAUNCH: audience / persona
  definition, <brand>]` and FORBIDS assuming an age, gender or life stage. Never substitute one.
- **Proof** — the JSON shape handed the model `"rating": {"value": 4.9, "count": "250,000+"}` and an
  author templated as `"first name, initial"`. Seeding a shape with values IS an instruction to
  invent them (`mailer_system/brand_prompt.py` had the same defect). Proof is now EXTRACTED, not
  written: **`api/_shared/brand-reviews.js`** reads the brand's OWN testimonials off its OWN site,
  verbatim, riding the EXISTING `site-crawl.js` (`onPage` + `rank`) — no second crawler, no LLM in
  the path. Author only if the page names one; rating only if the page states one, kept as TEXT with
  its scale so 4.9 is never rounded and a /10 is never read as a /5. Stored in
  `brand_review_library`, filtered on workspace AND region so a review cannot transfer between
  brands, regions or products. Review IMAGES are fetched and re-hosted into the `brand-review-media`
  Storage bucket (key `<workspace_id>/<sha256 of source url>` — workspace-scoped by the path segment
  the storage policy checks, idempotent by the hash) and the mailer carries THAT url, never a
  hotlink; the original url is kept beside it. `brand_review_scan` records zero-result scans so the
  ~180-slot prebuild queue cannot re-crawl a brand's origin once per slot. Migration:
  `20260814120000_brand_review_library.sql`. **Nothing is fabricated to fill a gap**: `gateProof()`
  strips any rating/review/reviewer/badge/guarantee with no approved source behind it, and an absent
  proof block RENDERS the marker rather than vanishing (silence reads as a design choice).
- **Video ads had no artefact** — the console drew a play triangle on a gradient over a storyboard;
  nothing was generated, so the reviewer approved something they had never seen. Every video ad now
  carries `creative.motion_html` (a self-contained animated 9:16 creative built by
  `scripts/lib/motion-ad.js` over the brand's own REAL catalogue photos, now brand-parameterised via
  `spec.brand`) plus `creative.motion_brief`, and `creative.video` states plainly whether an MP4
  exists. The console previews the artefact's EXACT bytes via a Blob URL (the `/july-studio`
  precedent) and downloads those same bytes. Tenant zero's audio beds are never lent to another
  brand — `video-core.audioBedFor()` returns a marker instead.
- **One creative key per AD, not per platform** — the map had 5 keys for 8 ads, so a platform's
  static and video shared one photo and the youtube/pinterest ads matched no key and shipped with no
  image at all. Keys are now `<platform>:<creative_type>`.
Also fixed here: `applyCopy()` referenced `__run` from `_buildCampaign`'s scope, throwing on the last
line of every SUCCESSFUL copy application. The mutations had already landed so assets were fine, but
the throw was swallowed and every campaign reported `copywriter.provider: 'template-fallback'`,
creatives `none`, and the console's "no LLM provider answered" banner — on copy an LLM had just
written.

**Whose cohort, and is it the right campaign for them (2026-08-19).** Four more defects, all found by
EXECUTING the planner rather than reading it (`tests/brain-cohort-planning.spec.js` runs it over
every segment `rfm-core` can emit, derived by walking the quintile space so a new segment arrives
automatically):
- **`objectiveFor()` matched almost nothing.** It tested `/winback|at-risk/i` — hyphenated — while
  `rfm-core.segmentFor()` emits **"At Risk"** with a SPACE. Nor did "Can't Lose Them", "Hibernating",
  "Lost", "About to Sleep", "Need Attention" or "Promising" contain any of the four literals it
  looked for. **Eight of the eleven canonical segments fell through to the default, and the default
  is the objective written for someone who has never bought.** The objective briefs the copywriter,
  sets offer depth and shapes every asset on the slot, so a customer weeks from churning was being
  sent an introduction to the brand — and the reviewer saw a coherent campaign and approved it. Now
  an ordered table on the segments' own words: `can't lose` → high-value reactivation; `at risk /
  hibernating / lapsed` → reactivation; `lost` → last-chance; `about to sleep / need attention` →
  pre-lapse retention; `new / promising / potential` → second-order activation (BEFORE the loyalty
  rule, because "Potential Loyalist" contains "Loyal" and would otherwise be upsold); `champion /
  loyal` → premium bundle expansion.
- **The hero fallback was tenant zero's own assortment**, so a brand with no product scores got a
  90-day calendar in which every slot in every market planned a campaign for another company's
  product. Now `placeholderHero(brand)` — a marker naming the gap and the brand, `placeholder:true`
  carried onto the slot so nothing downstream has to string-match a title.
- **`entry.heroProduct.title` threw** a bare TypeError on a slot with no hero, killing the whole
  generation with a message naming neither brand nor missing data. `heroTitleOf(entry)` states the
  gap instead.
- **`competitorContext()` read `.byChannel` off an absent benchmark.** A brand whose record names no
  competitors gets an empty universe BY DESIGN, so one unconfigured feature took down every market's
  calendar.

### KicksGPT — the brand LLM (conversational tool-calling over the whole stack)
`api/_shared/brand-llm.js` is the brand's own "Claude-for-Knickgasm": a provider-agnostic **tool-calling loop** that lets the LLM actually OPERATE the growth stack instead of just chatting. The model emits a strict JSON action each turn (`{action:'tool',...}` — single tool or a `tools:[…]` batch of up to 3 run in parallel — / `{action:'final',...}`); the server executes against the existing `_shared` cores and feeds results back, looping (default 5 steps). Speed: the loop pins the first provider that answers (per-call `preferProvider` in `llm.js`) so later steps skip dead keys, dedupes repeated tool+args calls, 20s per-provider timeout. Quality: the system prompt enforces an **evidence contract** — every recommendation quotes exact tool-sourced figures, names the target metric + expected impact, states a complete hypothesis, and quotes competitor benchmarks. Because tool-calls are plain JSON (not a provider-specific function-calling API), it works across the **entire 6-provider waterfall in `llm.js`**, including the free tiers — no extra keys. Tools registered: `ask_analytics`, `run_analysis`, `list_cohorts`, `get_calendar`, `get_competitor_benchmarks`, `search_knowledge_base`, `list_campaigns`, `generate_calendar`*, `generate_assets_for_slot`*, `run_agentic_campaign`*, `klaviyo` (*=writes/generates, only on explicit ask). Each reuses the SAME logic the `/api/brain ?action=` routes use. Endpoints: `?action=brand-chat` (the loop), `?action=brand-tools` (manifest + klaviyo status). UI: `kicksgpt.html` at `/kicksgpt` (also `/kicks`, `/ask`) — Claude-style chat that shows the tool trace. Rename the product via the single `BRAND_LLM_NAME` constant in `brand-llm.js`.

### Klaviyo integration (scaffolded — no keys yet)
`api/_shared/klaviyo-core.js` mirrors Klaviyo's public JSON:API REST endpoints (profiles, lists, segments, metrics, events, campaigns, flows, templates, subscribe, track-event, campaign reporting). Auth via `KLAVIYO_API_KEY` (+ optional `KLAVIYO_PUBLIC_KEY`, `KLAVIYO_REVISION`). **Until a key is set**, every op returns a structured `{connected:false, would_request:{method,url,body}}` stub so the chat + tool-calling work end-to-end and only need a key to go live. Exposed at `?action=klaviyo` (`/api/klaviyo`, `op=` + params) and as the `klaviyo` KicksGPT tool.

### Persistence
- **Supabase** (Postgres) — cross-device storage, auth, KB, captured competitor emails. Migrations in `supabase/migrations/` (timestamped). `supabase/COMBINED_RUN_THIS.sql` is the apply-all bundle; seeds in `supabase/seed/`. Front-end gets URL+anon key from `/api/public-config` (service-role keys NEVER exposed there).
- **localStorage** — analytics state passed between dashboard → calendar → studio.
- **Google Sheet** — the competitor-email "database" (columns A–K defined in `competitor-core.js`).

### Offline Python data engines (run locally, not on Vercel)
- `ingest/` — `run_all.py` runs `ingest_{matrixify,shopify_analytics,klaviyo,webengage}.py` into DuckDB (`LIFECYCLE_DuckDB_DDL.sql`), then `sync_to_supabase.py`.
- `mailer_system/` — Python Claude-API campaign trigger engine (thresholds in `targets.json`, outputs to `outputs/`).
- `marketing_automation/` — React 19 + Vite + Express (`server.ts`) interactive campaign compiler (its own `package.json`).
- `scripts/` — mix of JS build tools (`build-catalog.js`, `seed-festivals*.js`) and Python `_*.py` HTML/codegen patchers used during development.

## ⭐ Asset provenance: a brand's assets come from its OWN catalogue, or there is no asset (2026-08-14)
`api/_shared/brand-catalog-server.js` is the ONLY place the server decides whose products these are.
It is the server twin of the browser's `brand-catalog.js` and the rule is the same in both:
**an asset for brand X uses brand X's own catalogue, or NO asset at all** — there is no third option
where another brand's photo renders under a caveat.
- Sources, in order: **`brand`** = the workspace's own `brand_catalog_products` rows (filtered by
  `workspace_id`, service-role); **`shipped`** = `data/catalog/products_{us,uk,global}.json` **only for
  tenant zero** — those files are one tenant's 436 products, gated by the SAME
  `market-analytics.ownsBundledExport()` helper that gates the bundled sales export (now takes an
  optional explicit workspace, so a cron/prebuild job generating FOR a workspace gets that
  workspace's answer); **`none`** = empty list + a `reason`, which callers turn into
  `[DATA REQUIRED BEFORE LAUNCH: product image, <product>, <region>]` and render image-free.
- **Never read `data/catalog/` from a new module** — `tests/brand-catalog-scope.spec.js` fails any
  `api/_shared/*.js` that does. Go through `catalog-image.js` (which delegates here).
- The resolvers stay SYNC because ~21 render sites are sync. Two halves: `withCatalog({brand,
  workspaceId}, fn)` resolves the workspace's rows ONCE at a generation entry point and pins them via
  **AsyncLocalStorage** (never a module variable — a warm runtime serves concurrent brands from one
  process); `productsFor(market, {brand})` answers synchronously from that scope, and applies the
  BRAND GATE even with no scope, so a named non-tenant-zero brand can never reach the shipped files.
  Every cache is keyed by workspace id. Pass `{ brand }` (or an `entry` carrying `.brand`) at every
  `catalogImage.*` call site.
- `buildCampaign()` pins the catalogue for the whole build and reports unfilled image slots on
  `campaign.data_gaps` + `campaign.catalog_source`, so an image-free asset is never silently so.
- Gate: `npm run test:isolation` (it derives tenant zero's CDN signature from the built catalogue, so
  an ASSET leak fails it the way a COPY leak already did) plus
  `npx playwright test tests/brand-catalog-scope.spec.js`. `data/catalog/` is gitignored, so the
  asset half of the isolation gate reports **DEGRADED** until `npm run build` has run (CI runs it first).

## Approved-assets service + USA July calendar (2026-07-11)
- **`brand_assets` table** (`supabase/migrations/20260711120000_brand_assets.sql`) is the origin-validated asset store: `sku_key, asset_type, url, alt, w/h, source_pdp, origin_validated, status(verified|placeholder), region`. Logic in `api/_shared/brand-assets-core.js` (not a function file): PREFIX-match allowlist (`knickgasm.com`, `knickgasm.com`, `knickgasm.com`, `try.knickgasm.*`), rewrites a Shopify store-CDN URL to the brand host (`www.knickgasm.com/cdn/shop/files/…`, byte-identical asset) so it validates, and NEVER fabricates a URL — an unverifiable slot is stored `status='placeholder'`. Seed with `npm run seed:assets` (`scripts/seed-brand-assets.js`): resolves the US SKU→handle map from the built catalog, writes `data/brand-assets/us.json` + `supabase/seed/brand_assets_us.sql`, and upserts live when Supabase env is present.
- **USA July calendar + mailers** (`npm run build:july`): `scripts/build-july-mailers.js` keeps the automated-calendar 4-variant STRUCTURE (2 Text + 2 Text+Visual, framework A/B) and the same `sanitizeBrand`/`assertNoBanned` gates (`scenario-model.js`), but renders each variant in the **flagship design system** (`scripts/lib/flagship-mailer.js`: web fonts, green utility bar, colorway hero band — violet/midnight/daylight, price pill, MSO-safe CTA, trust badges, "Made on 100% original brand sneakers · Worn by Samay Raina & Rohit Sharma" proof bar, non-clickable footer). Hosted image URLs only (never base64). 12 cohort sends × 4 = 48 files in `mailers/usa-july/`; hero images come ONLY from verified `brand_assets` rows (image-free otherwise, never a fake URL). The same pass also renders, per send, a paid-social **ad set** (Meta/Google/TikTok, `scripts/lib/ad-creative.js` → `ads/usa-july/`) and a flagship **landing page** (`scripts/lib/landing-page.js` → `landing-pages/usa-july/`), all from the same scrubbed copy + verified assets (no invented discount codes). `scripts/build-july-studio.js` assembles `lifecycle-usa-july-calendar-mailer-studio.html` (served at `/july-studio` · `/usa-july`): Card/List toggle, scenario tabs (C = executed model, 2-3 emails/user/week), per-send **Mailers / Ads / Landing** tabs whose preview = the exact embedded downloadable file (Blob URL, no `srcdoc`), plus the data-grounded reasoning per row. Manifest: `data/calendar/usa-july-2026.json`. Event hooks wired into reasoning: WC Final Jul 19 @ MetLife, National Ice Cream Day Jul 19, Parents' Day Jul 26, Int'l Day of Friendship Jul 30, National Streetwear Month (Aug) ramp.
- **Selected-collection coverage rule:** `SELECTED_COLLECTIONS` in `build-july-mailers.js` (default: kicks-sneakers, samplers, gifts, best-sellers) MUST each be represented by ≥1 send — the build **hard-fails** if any is uncovered, so a selected collection is never silently dropped. Each slot carries `collections` + a `collection_cta`; the collection is wired into asset generation (landing-page "Explore all {collection}" CTA) and surfaced in the studio (chips + a "Collections covered" stat). `manifest.selected_collections` lists each with its covering send dates.

## Agent memory (TencentDB-Agent-Memory bridge, 2026-07-19)
`integrations/tencentdb-memory/` gives Claude persistent long-term memory (TencentDB-Agent-Memory's
local L0->L3 pyramid: conversation -> atoms -> scenarios -> persona). That project has NO native
MCP/Claude connector — only a "Hermes" REST gateway (`:8420`) — so `mcp-server.mjs` is a **zero-dependency
MCP bridge** mapping the gateway (`/recall /capture /search/* /session/end /health`) onto MCP tools
(`memory_recall`, `memory_capture`, `memory_search`, `memory_search_conversations`, `memory_session_end`,
`memory_health`). Wired into this repo's Claude Code sessions via root `.mcp.json`. Start the gateway with
`integrations/tencentdb-memory/setup.sh` (clones the upstream gateway into gitignored `vendor/`, needs an
LLM key for distillation only), verify with `npm run smoke`. Full setup (repo + CLI + Desktop) in that
folder's README. Habit: `memory_recall` at task start, `memory_capture` after meaningful turns.

## Product Catalogs
US: 436 · UK: 436 · Global: 436 active products (full knickgasm.com catalog in every region file; USD @₹87.5 and GBP @₹110 fixed-rate conversions from INR list prices). Built at deploy from `products_export_{usa,uk,global}.csv` via `scripts/build-catalog.js` → `data/catalog/products_{region}.json` (served with CORS + cache headers per `vercel.json`).

## Market-Specific Store URLs (VERIFIED)
US → knickgasm.com | UK → knickgasm.com | IN → knickgasm.com | EU → knickgasm.com | AU → knickgasm.com | Global/ME → knickgasm.com
- PDP: `{base}/products/{handle}` (handle = catalog JSON `h` field) · Collection: `{base}/collections/{slug}` (via `heroMap` in `collectionUrl()`)

## Brand Constants (source of truth: `Brand style guide.pdf`)
<!-- >>> BRAND-SYNC:constants -->
- **Source of truth:** `data/brands/_default.json`. Run `npm run brand:sync` after editing it; `npm run brand:check` fails the build on drift.
- **Palette (ONLY these four)**: `#D0473E` primary accent · `#6A33D8` secondary · `#111111` ink (text + primary buttons) · `#FFFFFF` background
- **Typography (STRICT)**: Headings **Montserrat** — `'Montserrat','Raleway',Arial,sans-serif`; Body **Instrument Sans** — `'Instrument Sans','Helvetica Neue',Arial,sans-serif`
- **Voice**: bold, energetic, youth street-culture; confident and playful, never corporate. Testimonials read like a friend flexing a new pair, not a review. Never imply the pairs are replicas: they are hand-painted on 100% original brand sneakers.
- **PREFERRED**: custom, hand-painted, one-of-one, grail, canvas, colorway, drop, rotation, crafted, original
- **BANNED phrases**: wellness journey, transform, liquid gold, game-changer, LIMITED TIME, hurry, don't miss out, last chance, while supplies last, replica, knock-off, first copy, fake pair
- **No em/en dashes anywhere in output copy** - use commas, colons, or plain hyphens. (Enforced by `scrubDashes()`/`sanitizeBrand()` in `api/_shared/scenario-model.js`.)
- **Verifiable claims** (never assert anything else as fact): India's largest sneaker customisers · Made on 100% original brand sneakers · Hand-painted by India's best artists · Water and scratch resistant designs · Express shipping worldwide to 60+ countries · Free shipping in India and worldwide
- **Legal entity**: KNICKGASM PRIVATE LIMITED, Ghatkopar West, Mumbai 400086, India
<!-- <<< BRAND-SYNC:constants -->

## Mailer Studio specifics (`lifecycle_mailer_architect_v34.html`)
- 5-step wizard: Brief → Products → Generation → Review & Refine → Final HTML.
- Produces **4 variants**: A (Image · Hero close-up), B (Image · Lifestyle wide), T1 (Text · Editorial), T2 (Text · Founder note). Structural divergence forced via `_alternateArchetypeForVariantB()`.
- 11 layout archetypes: hero-led-editorial, product-grid-conversion, storytelling-narrative, single-product-spotlight, gift-bundle-showcase, ritual-journey, comparison-discovery, founder-note, editorial-trend-roundup, limited-drop-countdown, subscription-anchor.
- Output mailers are compact (~1200–1500px, two scrolls).
- **Image cascade** (`api/ai/image.js`): Gemini native (`generateContent` + `responseModalities:['IMAGE','TEXT']`) → Gemini Imagen (paid only) → OpenAI (gpt-image-2 → gpt-image-1) → Pollinations (flux-pro → flux-realism → flux, free, "NO text" instruction). `buildDesignPromptFromCatalog()` injects real catalog data; region-aware currency symbols.

## Environment Variables (Vercel only — never hardcode)
Text: `OPENAI_API_KEY`(+`_2`/`_3`), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`. Storage: `SUPABASE_URL`, `SUPABASE_ANON_KEY`. Lifecycle (Klaviyo): `KLAVIYO_API_KEY` (+ optional `KLAVIYO_PUBLIC_KEY`, `KLAVIYO_REVISION`) — integration is scaffolded and returns request stubs until set. Voice: `ELEVENLABS_API_KEY`. Google Sheets: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB` (or legacy `GOOGLE_SERVICE_ACCOUNT_*`). Cron: `CRON_SECRET` (protects `?action=sync`). Per-workspace connections: `CONNECTION_SECRET_KEY` (32 random bytes as hex, `openssl rand -hex 32`) encrypts every user-supplied API key before storage — without it no key can be saved at all, and rotating it makes existing stored keys unreadable so they must be re-entered. Auto-set by Vercel: `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_OIDC_TOKEN`. Full docs in `.env.example`. Each sibling app has its own restricted per-project Gemini key minted from its own GCP project (see "API Keys 2026-05-30" note below).

## Common Bugs to Watch
1. **Unescaped quotes / apostrophes** inside single-quoted JS strings — these pages are giant inline-JS files; a stray backtick in a CSS comment once broke a template literal and killed the sidebar.
2. **`const` reassignment** — use `let` when reassigned later.
3. **Gemini model duplication** — env var can duplicate a hardcoded fallback; always de-duplicate.
4. **CORS headers** — every serverless function needs `Access-Control-Allow-Origin`.
5. **Font stack in JS** — never use quoted font names inside JS template strings.
6. **Quota errors return HTTP 400, not 429/402** — OpenAI `billing_hard_limit_reached` and Anthropic "credit balance too low" both 400; quota detection must check status 400 + billing keywords.
7. **PowerShell BOM corruption** — piping keys via PowerShell `echo` adds UTF-8 BOM; use `cmd /c "type file | vercel env add"`.
8. **Gemini Imagen predict API** — paid plans only (free tier → 400).
9. **Function-count limit (12 on Hobby)** — adding an `api/*.js` file can break deploy; extend a `?action=` router or move logic to `_shared/`.
10. **Service worker caching** — `sw.js` must never cache `/api/*` responses; `.html` and `sw.js` are served `must-revalidate`.

## Domain + OAuth migration (`scripts/migrate-domains.*` + `scripts/migrate-oauth.*`)
Each sibling project moves to `<slug>.anchit-tandon.com`. `migrate-domains` adds the Vercel domain + GoDaddy CNAME, then hands the same scope to `migrate-oauth` so Google sign-in survives the move (skip with `--no-oauth`). Sign-in is **Supabase-mediated** (`signInWithOAuth({provider:'google', redirectTo: origin+pathname})`), so the change that actually matters is the **Supabase Auth redirect allowlist** (Site URL + Redirect URLs) — auto-applied via the Supabase Management API (`SUPABASE_ACCESS_TOKEN` + per-project `<SLUG>_SUPABASE_PROJECT_REF`). The Google OAuth client's redirect URI is the fixed `https://<ref>.supabase.co/auth/v1/callback` and does NOT change on a domain move; the only web-client tweak (a new JavaScript origin) is **Console-only** — there is no gcloud command or public API to edit a Web-application OAuth client, so the tooling emits an exact plan + Console deep-link rather than faking a mutation. Dry-run by default; `--apply` to write. Full detail in `docs/oauth-redirect-migration.md`.

## API Keys (2026-05-30) — per-project Gemini via gcloud
Each app has its OWN restricted Gemini key minted from its own GCP project, pushed to Vercel (Production+Development): lifecycle-os ← GCP lifecycle-os (others: personal-ai-os, the-third-eye, music-gen-ai, hey-yaara, ai-tele-suite, th-life-engine, marketing-mailers-html-architect). Other providers left as-is.

## Marketing skills pack + reels-grade creative standard (2026-07-24)
Ten job-complete marketing skills in `.claude/commands/` (mega-prompt discipline: clear,
highly specific, template-driven, evidence-quoting; skill = a real job run end-to-end):
`/campaign-audit` `/lp-audit` `/ab-test` `/competitor-teardown` `/utm` `/email-sequence`
`/content-repurposer` `/icp-builder` `/ad-copy-matrix` `/creative-brief`. All enforce the
Brand Constants + zero fabrication.
**Reels-grade creative standard**: stills built to animate via `api/ai/image.js`
`mode:'reels'` (cinematic 9:16, depth layers for parallax, negative space for type, no baked
text); real motion via Higgsfield image-to-video; instant no-API preview + generator handoff
via `scripts/lib/motion-ad.js` (`renderMotionAd` = self-contained animated HTML creative,
`motionBrief` = shot-by-shot brief so the shipped MP4 matches). Quality bar in
`.claude/commands/ad-creative.md`: hook moves in 0.8s, word-staggered kinetic type, one
filmic grade, real SKU packaging only, <15s, safe-areas.

## Growth OS — integrated team (slash commands + connectors + skills)
This repo ships project slash commands in `.claude/commands/` that operate the brand as a full growth team for a custom sneakers + lifestyle D2C brand. Start anything with **`/growth-team`** (the router) or jump to a vertical:

| Vertical | Command | Connectors + Skills it routes to |
|---|---|---|
| Strategy/planning | `/campaign-plan` | `marketing:campaign-plan` + Shopify + Klaviyo + competitor KB |
| Email/SMS lifecycle | `/email-flow` | **Klaviyo** connector + `marketing:email-sequence` |
| Mailers (HTML) | `/mailer` | `anthropic-skills:knickgasm-d2c-mailer` + Mailer Studio contract |
| Ad creatives (img/video/gif) | `/ad-creative` | `higgsfield-product-photoshoot` / `higgsfield-generate` / `higgsfield-soul-id` |
| Landing pages (HTML) | `/landing-page` | brand asset code engine + `/lp/:id` contract |
| Design (static/social) | `/design` | **Canva**, **Figma**, Adobe Express skills |
| Commerce data | `/shopify` | Public storefront scrape (US/UK/Global) — `/products.json` etc. **No Admin connector** |
| Analytics/reporting | `/analytics` | Supabase + `marketing:performance-report` + Amplitude/Supermetrics |
| Competitor intel | `/competitor` | competitor router + `marketing:competitive-brief` + SimilarWeb/Ahrefs |
| SEO/AEO | `/seo` | `marketing:seo-audit` + Ahrefs |
| Database | `/db` | `supabase` + `supabase-postgres-best-practices` + `supabase/migrations/` |
| Ship | `/ship` | `vercel-plugin:deploy` / `:env` |

**Every command resolves the ACTIVE brand first (2026-08-13).** `.claude/commands/brand-context.md`
is the FOUNDATION skill and every other skill references it before acting; `npm run check:skills`
(CI gate) fails any skill that names tenant zero, carries its product vocabulary in an example, or
skips the foundation. Structure follows the open **Agent Skills spec** (`agentskills.io`): `name`
matching the filename plus a trigger-phrase `description`, so these work beyond Claude Code slash
commands. The pattern came from `github.com/arnabbagxd/brand-building-skills` (MIT), whose
`brand-context` foundation this repo lacked; ours differs where it matters - theirs is a
questionnaire hand-filled into a markdown file, ours resolves the real workspace and can DERIVE from
the brand's own site with per-field provenance, so a brand fact is never something typed from memory.
Byte-exact carve-outs (real store URLs, `KNICKGASM_DB`, `anthropic-skills:knickgasm-d2c-mailer`) are
preserved by the guard, the same way `brand-context.js` refuses to rewrite a text node holding a URL.

### Connecting the connectors (hosted OAuth MCP — connect once per account)
These are not in `.mcp.json` (hosted OAuth servers, account-scoped). Connect via each server's `authenticate` → `complete_authentication` tool, or in the Claude **Connectors** UI:
- **Shopify** — ⚠️ Admin connector NOT authorized; use public storefront scraping via `/shopify` (US/UK/Global) instead. **Klaviyo** — `mcp__plugin_marketing_klaviyo__authenticate`. **Canva** — `mcp__plugin_marketing_canva__authenticate`. **Figma** — `mcp__plugin_marketing_figma__authenticate`. **Ahrefs / SimilarWeb / Supermetrics / Amplitude** — `mcp__plugin_marketing_<name>__authenticate`. **Higgsfield** — connected (generation MCP). Commands degrade gracefully and tell you what to connect if a tool is missing.

## LHS navigation IA rule
The shared LHS menu (`auth.js`, element `#lifecycle-nav`; model exposed as `window.__LC_NAV` / `window.__LC_NAV_INFO`) follows a standing IA rule:
- **Every feature carries the SAME five "know about this feature" questions, in this exact order:** 1. What does it do? · 2. Who is it for? (cohort / cohort definition) · 3. How does it work? (modes/steps/logic) · 4. Input · 5. Step-by-Step Working. Because they are identical in shape for every feature, they do NOT live inline in the rail — a quiet `?` chip beside each feature/group label opens a popup that presents all five as headings with their content. The rail itself shows only the real feature links and their group sub-sections.
- **Sub-item 5 for content-producing features presents the multi-agent pipeline steps:** Ideology → Data analysis + review + hypothesis → Business & strategy decisions → Content → Design + layout + structure → Audio/Video (where applicable) → Coding → Final compilation + presentation — noting `Runs via: <endpoint>` wherever a live endpoint exists. (Social Media OS uses its own 7-agent variant: Ideology, Data & Hypothesis, Strategy, Content, Design, Audio/Video, Compilation — runs via `/api/brain?action=social-run-daily`.)
- **Menu items carry the V1/V2 taxonomy badge** (see "Version taxonomy" above); where both generations of a capability exist they are labelled **Draft 1 / Draft 2** (Plan V1 = Draft 1 vs Mailer Calendar V2 = Draft 2 of calendaring; Mailer Studio V1 = Draft 1 vs Mailer Calendar built mailers = Draft 2 of mailer creation).
- Content lives in `auth.js` (`NAV`, `SUBQ`, `INFO`). String rules there: double-quoted strings only (apostrophes fine; never a double quote or backtick inside), text positions only. The nav must render signed-out too and degrade gracefully when Supabase/config fetches fail.
- **Sanctioned rendering (2026-07-09):** the five common questions render in a **`?`-triggered popup/modal** (`#lnav-ipanel`), all five shown at once as headings (`.lnav-ipanel-q`) with their content, Step-by-Step Working as a numbered list with `Runs via:` lines; content is written via `textContent` (no HTML-escaping needed). The rail no longer carries an inline five-item accordion — it lists the real feature links and their group sub-sections (groups start collapsed except the active group). Sections follow the sequential marketer workflow: Research & Benchmark → Plan → Design & Create → Share & Track → Assistants; rows show only the quiet V1/V2 chip (Draft 1/2 lives in tooltips + the `?` popup). Superseded the 2026-07-04 inline-accordion rendering.
- **NOTHING IN THE RAIL IS OFFERED TWICE (2026-08-19).** Five duplicates were live at once, each of a different kind, so the gate
  (`tests/nav-no-duplicates.spec.js`) checks each kind separately and measures the RENDERED rail with every group expanded:
  - **One destination, one row.** Compare rows by where they LAND, not by their href. `/ads-master` is a **redirect** (`vercel.json`
    `redirects`, not `rewrites`) onto `/data-analysis?tab=live-ads`, which Data Analysis already listed as "Paid Media" — two rows, one
    page, invisible to any check that reads raw hrefs or only reads `rewrites`. The top-level row is gone and its `?` content moved to
    the row that survives. The ONLY allowed pair is the wordmark and the Home row: a logo linking home is chrome, not a menu item.
  - **A `gid` is not an `id`.** A `?` chip renders for any `id` OR `gid` carrying an `INFO` entry, so the two namespaces must not
    collide. `Market Study` (gid `research`) and its first row (id `research`) rendered the SAME panel twice, one under the other; the
    row is now `research-all`, matching the `research-us`/`research-uk` rows beside it.
  - **A group describes itself.** The 3D group carried gid `landing`, so its chip opened the LANDING PAGES description and the
    storefront had none of its own. Now `storefront3d` + its own `INFO` entry. (The sibling repo hit this exact defect and its fix
    comment says so.)
  - **Two features, two groups.** `3D Storefront & Websites` held the storefront AND every landing-page feature, so the builder's own
    sub-pages sat under a heading that never says "landing page" while "Landing Pages" appeared as a row under both Competitor
    Benchmarking and Knowledge Base. Split into `3D Storefront & Websites` + `Landing Pages`, matching the sibling's IA.
  - **A nested row never repeats an always-visible top-level row.** TeleSuite's first row was "Home", the same word as the top-level
    Home pointing elsewhere; it is "Overview (all tools)" now. Repeats BETWEEN nested rows are fine when the heading disambiguates
    them — "Meta Ads" under Competitor Benchmarking / Knowledge Base / Ad Campaigns are three different things and the sibling keeps
    them bare too, so the test allows exactly that set and fails on any NEW repeat.
  - **Nothing ships unreachable.** `/landing-pages` (the builder root — only its four `#anchor` rows existed) and `/rfm` (serves
    `dashboard.html`; no row at all) are now in the rail, and every rail destination must resolve to a rewrite, a redirect or a file.
