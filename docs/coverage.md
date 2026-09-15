# Line coverage — making "every line is tested" measurable

Until 2026-09-15 nothing in this repo reported which lines the Playwright suite
actually executes, so "every line is tested" could be neither asserted nor
improved. This page describes the instrument, what it measures, what it cannot,
and the current numbers. The untested-lines map it produces is
[`coverage/UNTESTED.md`](../coverage/UNTESTED.md) — the one coverage artefact
that is committed, because it is the input to the next round of test-writing.

## Run it

```bash
npm run coverage                 # full suite under coverage, then the report (~10 min)
npm run coverage:report          # re-generate report + UNTESTED.md from the last run's raw data (seconds)

npm run coverage -- tests/site-crawl.spec.js         # any playwright args pass through
COVERAGE_PROJECTS=desktop-1280 npm run coverage      # choose projects (default: desktop-1280,pixel-5)
LIFECYCLE_COVERAGE_DEBUG=1 npm run coverage          # log every browser flush from the preload
```

`npm run coverage` exits with Playwright's exit code, so a failing suite still
fails the command — but the report is written first either way.

Default projects are the two Chromium ones: `desktop-1280` runs every spec at
the width the app is designed around, `pixel-5` runs the responsive Studio
spec at phone width. `page.coverage` is Chromium-only, and the WebKit projects
(`iphone-se`, `iphone-12`, `ipad`) need a WebKit build that a plain
`npx playwright install chromium` environment does not have; they only run
`studio.spec.js`, whose Chromium coverage `pixel-5` already supplies.

## Outputs (all under `coverage/`, gitignored except `UNTESTED.md`)

| file | what |
|---|---|
| `UNTESTED.md` | **the deliverable** — every file's numbers ranked by score, and for the 25 worst files the uncovered line ranges with a note per range |
| `lcov.info` | one lcov for both runtimes: c8's Node-side records, then the inline-`<script>` records of every root page appended |
| `summary-combined.json` | one row per file, both kinds, with weight and score; browser attribution stats and the unattributed list |
| `coverage-summary.json`, `coverage-final.json` | c8's own per-file summary and per-line JSON (Node side + browser hits on external `.js`) |
| `run.json` | the exact Playwright command, exit code, duration and commit of the last run |
| `tmp/` | raw V8 process coverage — one file per Node process, plus `browser-*.json` re-emitted from page runs |
| `browser/` | raw page records (`entries/`) and content-addressed script sources (`sources/`) written by the preload |

## How it measures

Two runtimes, two instruments, one report. `scripts/coverage/run.js` drives it;
`scripts/coverage/report.js` merges and writes.

### Node side — `NODE_V8_COVERAGE` + `c8 report`

Most unit-style specs `require()` the `api/_shared` modules in-process inside a
Playwright **worker**. `run.js` sets `NODE_V8_COVERAGE=coverage/tmp` — exactly
what `c8` sets before spawning a command — and Playwright forks its workers with
`process.env`, so every worker writes its own V8 coverage file on exit. This was
verified before anything else was built: a probe run of
`storefront-and-sitemap.spec.js` produced worker files naming
`api/_shared/site-crawl.js`, `brand-extract.js` and `storefront-detect.js`, and
the report shows `storefront-detect.js` at 100% of its 426 lines — a module with
a known executed spec reports real coverage, which is the attribution check the
whole instrument rests on.

The run is not wrapped in `npx c8` because the browser records have to be
merged into the same directory *before* `c8 report` reads it. `.c8rc.json`
holds the configuration: `all: true` with explicit `include` globs
(`api/**`, `lib/**`, `scripts/lib/**`, root `*.js`) so a file no test loaded is
reported at 0% instead of omitted; `merge-async` because a full run leaves
dozens of multi-megabyte V8 files.

### Browser side — a preload that patches `playwright-core`

Inline scripts inside the `.html` pages never pass through Node, so c8 cannot
see them. Playwright's own `page.coverage.startJSCoverage()` can — but every
spec imports `test` straight from `@playwright/test`, Playwright has no
config-level fixture hook, and the task forbade touching the specs. So
`scripts/coverage/preload.js` is injected with `NODE_OPTIONS=--require` into
every process and, when `playwright-core` is first loaded in a worker, patches
the `BrowserType → Browser → BrowserContext → Page` prototypes once:
`startJSCoverage({ resetOnNavigation: false })` on every page as it is created
(`newPage`, popup, persistent context) and `stopJSCoverage()` before that page,
its context or its browser closes. Each flush writes `{ url, sha1, length,
functions }` rows with the script source stored once per hash — the Studio page
is ~700KB and dozens of tests open it. Measured cost on the heaviest spec:
`studio.spec.js` 14.9s → 19.3s, no test over its timeout.

**Attribution is by content, not URL.** The page specs serve the repo over
`http://127.0.0.1:<port>/` and route fake origins, so a script's URL rarely
names a file. `scripts/coverage/browser.js` hashes every tracked `.js` file and
every inline `<script>` block of every tracked `.html` page and matches records
by sha1; the URL path only breaks ties. Two outputs:

- **External `.js` the pages load** (`auth.js`, `brand-context.js`,
  `credits.js`, `motion.js`, `region-context.js`, …) are re-emitted as V8
  process coverage with a `file://` URL into `coverage/tmp/browser-*.json`, and
  c8 merges them with the Node-side hits of the same file through the same
  `@bcoe/v8-coverage` merge it uses for workers. A line executed in either
  runtime is covered; such rows are marked `node+browser`.
- **Inline `<script>` blocks** are converted block by block through
  `v8-to-istanbul` against the block's own text and shifted to the HTML file's
  line numbers. They cannot go through c8: `v8-to-istanbul` starts every line of
  a file at count 1 and only zeroes what V8's ranges say did not run, so feeding
  it an `.html` file would report every line of markup and CSS as covered. A
  page's "lines" figure is therefore the number of lines inside its inline
  script blocks, and the records are appended to `lcov.info` as `SF:<page>.html`.

**Which approach was achieved:** the full merge — per-line data for every
inline block of every root page, in the same `lcov.info` and the same ranked
table as the Node modules, not just executed-vs-total byte ratios.

## What it cannot see (stated, not hidden)

- **Line, not branch.** V8 block coverage gives 0/1 per range (Playwright
  starts the profiler with `callCount: false`); the map is by line. c8 counts
  physical lines the way V8 reports them, so blank and comment lines inside an
  executed function count as covered and inside an unexecuted one as uncovered —
  the percentages are consistent, not flattering.
- **`sw.js` is always 0%.** A service worker runs in its own context outside
  the page profiler. Nothing here can attribute it.
- **The Studio spec opens its page over `file://`**, and the page's
  `<script src="/auth.js">` includes are root-absolute, so they resolve to the
  filesystem root and never load in that spec. `auth.js`' browser coverage
  comes from the HTTP-served page specs; the Studio's own inline scripts are
  covered normally.
- **Anonymous scripts are skipped on purpose** — `addInitScript`, `evaluate`,
  `addScriptTag` without a URL are test code, not page code.
- **Inline handler attributes** (`onerror="this.style.display='none'"`) are
  compiled by V8 as their own tiny scripts under the page URL. They are not
  `<script>` blocks, so they land in the *unattributed* list with that reason.
- **Third-party bundles** (the supabase-js CDN build, chart libraries) are
  unattributed by design — they are not this repo's lines.
- **A worker killed with SIGKILL** (a hard hang) loses the flushes it had not
  written, exactly as Node's own `NODE_V8_COVERAGE` does.
- **Out of scope by the include globs:** `scripts/*.js` build tools (other than
  `scripts/lib/`), `workers/`, `data/*.js`, `integrations/`, `mailer_system/`,
  `marketing_automation/`. Widen `.c8rc.json` `include` to add them.
- **A test that spawns `node` with a clean `env`** produces a child that writes
  no coverage; a child that inherits `process.env` is measured normally.
- **A page served rewritten by a test route** (a fixture injecting
  `window.__SUPABASE__`) still attributes: untouched blocks match by hash, and a
  rewritten block is located by searching the tracked page for its text. Only a
  block whose text exists nowhere in the tree is listed as unattributed.

## Ranking in `UNTESTED.md`

`score = uncovered lines × weight`. Weight is **2** for a file on the
credits / auth / dispatch / preflight / SSRF path — the `LOAD_BEARING` list at
the top of `scripts/coverage/report.js` (credits and payments; `auth.js`,
`require-caller`, `oauth-core`, `request-scope`, `workspace-scope`, `supa.js`,
`public-config`, the connections module, the `api/` routers and `api/ai/*`
proxies; `dispatch-core`, every adapter, `live-connectors`, `read-only-egress`,
`social-push-core`; `preflight-core`, `deliverability-core`; `site-crawl`,
`kb-url`, `storefront-detect`) — and **1** otherwise. The console table printed
by `coverage:report` is sorted by raw uncovered lines; the file is ranked by
score. Both say so where they appear.

Range notes are derived, never typed: the innermost enclosing function from V8's
own function ranges, and, when the range is only part of that function, its
first line of code. A file no test loaded gets its top-level declarations
instead. That is enough for a follow-up to write one executed test per range
without re-deriving the map.

## Current numbers

First measurement, 2026-09-15, commit `254e599`, `playwright test --project=desktop-1280 --project=pixel-5`
— 1036 passed, 0 failed, 391s under coverage.

| scope | files | lines | covered | uncovered | covered % |
|---|---:|---:|---:|---:|---:|
| Node-side modules (`api/`, `lib/`, `scripts/lib/`, root `.js`) — c8 | 169 | 69,220 | 38,136 | 31,084 | **55.1%** |
| Inline `<script>` in root `.html` pages — Playwright JS coverage | 66 | 27,092 | 11,838 | 15,254 | **43.7%** |
| Combined | 235 | 96,312 | 49,974 | 46,338 | **51.9%** |

c8's own summary for the Node side: statements 55.09%, branches 61.5%
(6,758/10,987), functions 57.73% (1,422/2,463), lines 55.09%.

Browser attribution over the run: 193 page flushes, 2,377 script records →
1,718 hits on 16 external `.js` files (13 merged into `node+browser` rows;
`assets/knickgasm3d-bridge.js`, `data/analytics/market-data.js` and
`data/design-intelligence.js` are outside the include scope), 470 inline-block
hits, 189 unattributed records of 25 distinct scripts — every one classified in
the ledger at the end of `UNTESTED.md`: CDN bundles and test-routed stubs on CDN
URLs, three stubs a spec served as `brand-catalog.js`, a fixture served as
`legacy.html` (not a tracked page), and inline handler attributes on the Studio
and Smart Brain pages.

**Never loaded by any test (0%), the load-bearing ones first:** `api/brain.js`
(1,205 lines — the router that mounts dispatch, deliverability, cohorts and the
cron), `api/ai/pipeline/{html,variant,strategy,images}.js`, `api/competitor.js`,
`api/calendar.js`, `api/public-config.js`, `api/_shared/social-core.js`,
`api/_shared/calendar-generate.js`. Four of the five `api/*.js` routers were
never required by a spec at all (`api/kb.js` is at 50%); the auth-gated proxies
`api/ai/generate.js` and `api/ai/image.js` are required (41.6% and 40.5%
covered), which is where the executed-tests ratchet already moved the security
tests.

**Best covered of the heavy files:** `api/_shared/storefront-detect.js` 100%,
`api/_shared/site-crawl.js` 98.9% (627/634), `auth.js` 85.3% (2,077/2,436,
both runtimes), `api/_shared/workspace-connections-core.js` 76.9%,
`api/_shared/deliverability-core.js` 59.4%, `api/_shared/credits-core.js` 57.1%.

The worst 25 by score, with their uncovered ranges, are in
[`coverage/UNTESTED.md`](../coverage/UNTESTED.md).

## Not in CI (yet)

The full run costs ~10 minutes on top of the suite CI already runs, so this is
a local/ad-hoc instrument for now. The cheapest CI shape when it is wanted: run
`npm run coverage` in the existing `e2e` job instead of `npx playwright test`,
upload `coverage/` as an artifact, and ratchet `totals.all.pct` in
`summary-combined.json` the way `check-executed-tests.js` ratchets source
assertions — fail when it falls, say nothing when it rises.
