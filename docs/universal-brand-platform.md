# Universal Brand Marketing Lifecycle Platform

This app used to be one brand's lifecycle OS. It is now a **platform**: any user signs in, onboards
their own brand (data, colour schema, typography, voice, catalog), and the entire app — shell,
generators and TeleSuite — runs as that brand for that user. Everything is metered in **credits**.

Three layers were added. They are independent: the brand layer works without credits, and credits
work without TeleSuite.

---

## 1. The brand layer (multi-tenant)

### First screen
`/onboarding` (also `/setup`, `/start`, `/brand`) is a six-step wizard with a live preview of the
app in the brand being defined:

| Step | What it captures |
|---|---|
| 1. Brand | name, tagline, industry, website, logo URL |
| 2. Colour schema | primary, accent, ink, page surface, card surface, secondary text |
| 3. Typography | heading + body family (Google or self-hosted) |
| 4. Voice | tone, preferred vocabulary, **banned phrases**, dash rule, notes |
| 5. Data & catalog | regions + store URLs, and a catalog import |
| 6. Review | readiness report, then **Activate** |

A signed-in user with no brand is sent here by `brand-context.js`. The wizard itself and the legal
pages are exempt, so there is no redirect loop.

### What "customised for the user logged in" means concretely
`brand_user_prefs.active_workspace_id` is per user. `brand-context.js` (loaded on every page by
`auth.js`) reads it and:

1. Writes the brand's `--brand-*` design tokens onto `<html>`. **`theme.css` resolves every colour
   and font through those tokens**, so all ~100 pages re-skin at once without being touched:
   ```css
   --vh-green: var(--brand-primary, #6A33D8);
   --vh-font-head: var(--brand-font-head, 'Lora', …);
   ```
   This covers both the `--vh-*` component tokens **and** the legacy aliases (`--bg`, `--panel`,
   `--surface`, `--ink`, `--muted`, `--green`, `--violet`, `--accent`, `--line`, `--head`) that most
   existing pages actually consume.
2. Sets those legacy aliases **inline on `<html>`** as well. Many pages declare their own
   `:root { --ink: …; --green: … }` block, which would beat a stylesheet rule — but `:root` *is* the
   html element, so an inline declaration wins. `--chalk` maps to the contrast-checked
   `--brand-on-primary` (its real role is text on a dark/primary band, not a surface) and `--lava`
   maps to the brand accent.
3. Loads the brand's Google Fonts.
4. Swaps `<title>`, favicon and `theme-color`.
5. Re-labels the shipped brand name in visible copy (text nodes only — never URLs, hosts or
   identifiers, and never inside `script`/`code`/`pre`/inputs or `[data-no-brand-swap]`).
6. Paints from a localStorage cache on the first frame, so there is no flash of the wrong brand.

Switching brands (step 6, or the **Switch Brand** nav item) re-skins immediately and switches the
wallet with it.

### The brand reaches the GENERATORS, not just the shell
Re-skinning the browser is only paint; the prompts that produce mailers, ads, landing pages and
calendars run on the server. `api/_shared/brand-runtime.js` is the server-side counterpart:
`resolve(req)` returns the caller's active workspace (explicit `workspace_id` → active workspace →
tenant zero), keyed in its short-lived cache by the **resolved** workspace id rather than the request
shape — so switching active brand takes effect on the next generation instead of after the TTL and `brandBlock(brand)` renders it as a prompt block carrying that brand's identity,
voice, palette, typography, logo and regions — with `[DATA REQUIRED BEFORE LAUNCH: …]` wherever the
brand has not supplied something, never a value inherited from tenant zero.

`buildMasterPrompt()` accepts a `brand` and builds the whole prompt from it. `/api/ai/generate`
resolves the brand per request, prepends the block to its (tenant-zero-authored) system prompts with
an explicit instruction that it **supersedes any brand named later**, and enforces the brand's own
banned-phrase list on the generated output as well as in the prompt. With no active brand every
prompt is byte-identical to before.

### Design rules are enforced at save time
`brand-workspace-core.validatePalette()` runs on the server (and mirrored live in the wizard) and
**blocks activation** when:

- the page or card surface is a black / near-black / dark neutral, or
- body text on the page or on cards is below WCAG AA 4.5:1, or
- nothing in the palette reaches 4.5:1 on the primary (buttons would be unreadable).

Below-3:1 primary, failing accent text and failing secondary text are warnings. A draft may be saved
with an incomplete palette; an **active** brand may not.

### Zero fabrication
No field is ever machine-filled. Missing data is reported, in the spec's own format:

```
[DATA REQUIRED BEFORE LAUNCH: <field>, <product>, <region>]
```

`readiness()` returns `BRAND READY` or `NOT LAUNCH READY — DATA DEPENDENCY` with the full marker
list. Catalog rows keep `source` (`csv` / `json` / `shopify_public` / `manual`) and the verbatim
`raw` row, so no product fact can be traced back to a guess.

### Read the whole brand off its own site

`/api/brand?op=extract` (`api/_shared/brand-extract.js`) reads a brand's **identity** from the URL
the operator pastes on step 1, not just its catalogue: name, tagline, logo, colour schema,
typography, the tone of its own copy, the sentences it publishes as checkable facts, its social
profiles, its legal entity and the regions it sells in.

It rides on the SAME crawl as the catalogue importer — `site-crawl.js` gained an optional
`onPage(html, url, depth)` observer and an optional `rank(url, depth)` queue ordering, so there is
one crawler with one set of scope, robots and SSRF rules rather than two that can drift apart.
Stylesheets and the web app manifest are fetched separately, because `crawlSite` refuses anything
that is not HTML and the palette lives in `.css`.

**Nothing is applied.** Every field comes back as a ranked list of candidates, each carrying the
page URL and the SIGNAL that produced it (`json-ld:Organization.name`, `meta:theme-color`,
`css:custom-property --brand-primary`, `html:footer copyright line`, …) and a confidence of
`declared` / `strong` / `weak`. The wizard renders them with their sources and applies one only when
the operator presses **Use**; applied values record their provenance into
`brand_data.brand_extraction.applied`. A field the site did not publish comes back with the spec's
`[DATA REQUIRED BEFORE LAUNCH: …]` marker instead of a plausible value.

**The brand-colour vs design-system-colour trap.** A company can use blue as its brand colour and
green for its primary button, and a tool that ranks hexes by frequency returns the two
undistinguished. Colours here are never pooled: each sighting is classified by the role the site
itself gave it — `identity` (theme-color, manifest `theme_color`, a `--brand-*` token, `mask-icon`
colour), `action` (`--primary`/`--accent`/`--cta`, and backgrounds on button/CTA selectors),
`surface`, `ink`, `support` — and the roles are reported separately. `proposed.primary` is filled
**only** from an identity signal; the action colour becomes the accent; a disagreement between them
is reported as a `conflicts` entry naming both values and both sources. With **no** identity signal
the primary stays empty with a marker: the most-used colour on a page is a different fact from the
brand colour. `validatePalette()` still runs on the proposal and still gates activation.

**Voice is OBSERVED, never asserted.** The LLM is given verbatim excerpts and told to return `null`
when the copy shows no observable tone; vocabulary it returns is dropped unless it appears verbatim
in those excerpts, and so is any evidence quote it did not actually take from them. A provider
outage produces a marker, not a generic tone. `voice.banned` is always empty — a phrase a brand
refuses to use cannot be observed from the phrases it did use.

**No browser.** Vercel serverless cannot run Playwright, so this is CSS/HTML parsing: it cannot see
computed styles, JS-injected themes, SPA-rendered headers, or which declaration actually wins the
cascade (that is approximated by property and selector weighting). Those limits are returned in
`limits[]` and shown in the wizard, so a thin report reads as "the site did not publish this" rather
than "the brand has none". `oklch()`/`oklab()` are converted to sRGB (Tailwind v4 ships whole
palettes in them); `lab()`, `lch()`, `color()` and `color-mix()` are counted and reported as
unresolved rather than dropped.

Budgets fit one 120s invocation: crawl 35s + assets 20s + one model call 25s, each reported in
`notes` when it runs out.

### The brand context pack — one durable record per brand

`op=extract` is a one-shot report the operator looks at once and loses. The **context pack**
(`api/_shared/brand-context-pack.js`, table `brand_context_packs`) is the durable version, built once
per brand from that brand's own URL and kept as its standing context:

| Part | What it is |
|---|---|
| `design_md` | a **DESIGN.md**, in the open [google-labs-code/design.md](https://github.com/google-labs-code/design.md) format (Apache-2.0, version `alpha`) |
| `knowledge` | every page of the brand's OWN site, filed into `kb_knowledge`, workspace-scoped, with its source URL |
| `catalog` | through the existing `importCatalog` path — a pack never grows a second product store |
| `repos` | a GitHub repository search, with the **reachability** of that search recorded |

**Keyed to the URL AND the name.** `brand_key` is `<host>|<folded name>`, unique per workspace. So
re-running for the same brand UPDATES its pack; two workspaces whose brands share a name cannot
collide; and moving domain or renaming starts a NEW pack rather than overwriting a report about a
different site. A pack is a dated statement about one site, and overwriting it would destroy the
provenance that makes every value in it checkable. A pack found under an old key is served with
`current: false` and a note, never silently as the current one.

**DESIGN.md is not a shape we invented.** Conforming means the official CLI (`npx @google/design.md`)
lints our output and exports it to Tailwind or W3C DTCG, and every agent that already reads a
DESIGN.md reads ours. Front matter: `version`, `name` (required), `description`, `omitted`, `colors`,
`typography`, `rounded`, `spacing`. Body sections in the spec's order — Overview, Colors, Typography,
Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts — each emitted exactly once, because a
duplicate heading rejects the whole file. Each token carries the page it was read from as a trailing
YAML comment, which keeps provenance inside a format that has no field for it.

**The spec's `omitted` key is our zero-fabrication rule.** A section the site did not publish is
declared `omitted` *with a reason* rather than filled with a plausible value, so the file is valid
against a third-party linter **and** honest by our own standard. The `[DATA REQUIRED BEFORE LAUNCH: …]`
markers stay in the prose and in `markers[]` for the rest of this pipeline.

**Getting the colour schema right is the load-bearing part.** The mapping is by SIGNAL, never by
frequency: our `identity` signal becomes the spec's `primary` and nothing else ever does; our `action`
signal becomes `secondary` **only when it genuinely differs**, and when it does, that disagreement is
the brand-vs-CTA conflict and is surfaced rather than collapsed. With no identity signal there is no
`primary`, the spec requires one, so the whole `colors` section is `omitted` with the reason — a
frequency-ranked support colour is never promoted. Text tokens (`primary-text`, `secondary-text`,
`neutral`) are the **contrast-adjusted** values from `readableAsText()` measured against the worst-case
surface, using the same `TEXT_AA` constant the live shell's tokens are built from; `primary` and
`secondary` stay raw because they are fills. Every adjustment is printed with its before/after ratio.

**Only the exact correct option, at every edge.** The core rule (identity-only `primary`) was already
right; these are the remaining places something plausible could have been picked:

- **`secondary` too.** `proposePalette()` falls back to the highest-weighted `support` colour when a
  site declares no action colour — correct for a wizard where a human confirms, wrong for a token
  consumed without one. The pack emits `secondary` only when `sources.accent.from_role === 'action'`;
  otherwise it reports the candidate under "considered and not emitted" with a marker.
- **The proposal now carries its own confidence.** `sources.<role>` gained `confidence`, `from_role`
  and `ranked_not_declared`. The wizard was hardcoding `confidence: 'declared'` on every proposed
  role, so a frequency-ranked leftover was shown with the same authority as the site's own
  `theme-color`. It now shows the real confidence, tags a ranked colour **ranked, not declared**, and
  presents an empty role as a first-class outcome rather than something reached by cancelling.
- **A conflict is a decision.** Brand-vs-CTA disagreement renders both values with their signals,
  their source URLs and a button each; whichever the operator picks is recorded as their resolution.
- **Loaded ≠ used.** A `fonts.googleapis.com` href or an `@font-face` proves a download; only a
  `font-family` rule on a matching selector proves anything renders in it. `brand-extract` ranks
  link-only candidates `weak` but lets one fill an empty slot, where it becomes candidate `[0]`. The
  pack emits only `declared`/`strong` candidates; the wizard tags the weak one **loaded, not shown to
  be used** and its button reads *Use anyway* on a dashed border.
- **An off-origin redirect is off-origin.** `site-crawl` checked scope on the URL requested and never
  on the one that answered, so an in-scope path 301'ing to a partner or a marketplace had that body
  parsed and filed as this brand's. It now compares `r.url` against the allowed hosts and skips with a
  note. This fixes the catalogue importer and `brand-extract` too, not just the pack.
- **Derived is labelled derived.** `on-primary`, `primary-text`, `on-secondary`, `secondary-text` and
  an adjusted `neutral` are computed, not read. Each carries `DERIVED from <input> — <how>` as its
  YAML comment and appears in a **Derived, not observed** table.
- **The pack records which option each field took.** `design.selection` holds, per field: the value,
  the signal, the source URL, the confidence, `rank_taken` out of `candidates_considered`, and
  `chosen_by` (`top-candidate` / `only-candidate` / `computed` / `refused` / `operator-override`).
  `applyPack()` rewrites it to `operator-override` naming what the pack had ranked first when a human
  reaches past it — so "the extraction was wrong" and "a person picked the wrong one of several"
  stay distinguishable afterwards.

**A stated limit:** a browser extension that reads a live page's COMPUTED CSS (`design-md-chrome`) is
strictly more accurate — it resolves the cascade and sees runtime themes. Vercel serverless cannot run
a browser, so this is a stylesheet parse, and that is said in `limits[]` and in the Overview prose so a
thin section reads as "not observable by this method" rather than "the brand has none".

**Knowledge is stored VERBATIM.** Each page keeps its own declared description and its own headings,
unparaphrased; a page with no description gets a marker instead of a written summary. No LLM runs over
the brand's own copy, because a paraphrase of a brand fact is a new brand fact nobody approved — and
because an LLM call per page could not finish a whole-site ingest in any number of invocations. It
also skips `ingest-guardrail.js`, whose lexicon is tenant zero's industry and which would drop a
publisher's own homepage as off-context.

**GitHub degrades honestly.** Three outcomes are kept apart: `searched:false` (could not reach GitHub
— *not* a finding), searched with nothing verified, and searched with verified repositories. A
repository is only ever the brand's on evidence INDEPENDENT of its name — the brand's own site links
to that GitHub owner, or the repo's `homepage` is on the brand's domain. A name match is recorded as
`unverified` and never counted, because a name match is routinely a tutorial or a clone. The pack also
looks for an already-published DESIGN.md, separating the brand's OWN (authoritative — prefer it over
anything derived) from a community library's (a third party's reading, recorded but never brand truth).

**User data wins, structurally.** `brand_field_provenance` records the origin of every brand field.
The ONLY door an automatic value may come through is the `brand_context_apply()` SQL function, which
refuses any field whose provenance says `user` — inside the database, not in call order. The other
half is `brand_fields_claim_user()`, called by `saveWorkspace()` with exactly the fields the operator's
save carried. A direct PostgREST update is still allowed and is correct: a direct write is a USER
write, and a user write is allowed to win. `voice.banned` can never be machine-filled at all. The
catalogue gets the same treatment under the pseudo-field `catalog`.

**Long work is a queue.** The pack ROW is the queue: `stage` advances one step per call, `queue_state`
carries the resumable cursor, and the worker re-fires itself until it idles at `stage='done'` — the
same convergent pattern as `smart-brain-plan.js prebuildAssets()`. `catalog` runs first because it is
the only stage needing the operator's own token. Without `SUPABASE_SERVICE_ROLE_KEY` there is no
background chain and the response says `next_step_required`, so the client drives the queue instead.

Ops: `context-build` · `context-step` (CRON_SECRET) · `context-pack` · `context-design` (`&format=md`
downloads the file) · `context-list` · `context-apply`. Also drivable from the KB router as
`/api/kb?action=ingest-site`.

### Catalog import
Three routes, all operator-supplied:
- **Storefront** — GETs `{store}/products.json` (Shopify and compatible), read-only, no credentials.
  Because the URL comes from any signed-in user and the fetch runs inside the serverless runtime, it
  is SSRF-guarded: non-http(s) schemes, non-standard ports, loopback / private / link-local / CGNAT /
  unique-local literals, cloud-metadata addresses and `*.internal`-style names are refused; the
  hostname is resolved and refused if **any** answer lands on an internal range; and the request is
  issued with `redirect: 'manual'` so a public host cannot bounce the import onto an internal one.
  IPv6 is fully parsed rather than string-matched, because Node canonicalises
  `[::ffff:127.0.0.1]` to `::ffff:7f00:1` — loopback written in hex — which a prefix-stripping check
  waves through. IPv4-mapped, IPv4-compatible and NAT64-embedded addresses are decoded and run
  through the IPv4 rules.
- **CSV** — RFC4180 parser (quotes, escaped quotes, embedded newlines) with automatic column
  matching for title/handle/sku/price/currency/image/url/type/collections/tags.
- **JSON / file upload** — an array of products, or `{products: […]}`.

### API
`/api/brand` → `/api/public-config?action=brand&op=…`

`defaults` · `presets` · `list` · `active` · `get` · `save` · `activate` · `delete` ·
`catalog-import` · `catalog` · `readiness` · `validate-palette` · `extract` ·
`context-build` · `context-step` · `context-pack` · `context-design` · `context-list` · `context-apply`

Reads and writes go through PostgREST **with the caller's JWT**, so the RLS policies in
`supabase/migrations/20260809120000_brand_workspaces.sql` are the authority. Unlike the older
single-tenant tables, a workspace is private to its owner and members — not world-readable.

### The data rule: a brand sees its own numbers, or none

Re-skinning and prompt-scoping are only half of "runs as that brand". The other half is that
every feature must **resolve the active workspace and show that brand's own data, or an honest empty
state naming what to connect**. Falling back to another brand is obviously wrong; falling back to
**tenant zero** is equally wrong, and so is rendering a **deployment-level** dataset under a caveat —
the table paints either way, and a note under a number nobody reads is how the wrong number gets
acted on.

Three service-role Supabase clients exist and all three bypass RLS, so the scoping lives in them
rather than at ~40 call sites that would each have to remember:

| Client | Used by | Behaviour |
|---|---|---|
| `_shared/supa.js` | CI collectors, Klaviyo mirror, PageDeck, the dashboards | filters scoped reads, stamps scoped writes, **refuses** an unattributable write |
| `_shared/brain-core.js` `LinkedDb` | every `/api/brain` route and KicksGPT tool | same |
| `lib/smart-brain/services.js` adapter | the daily loop, prebuild, approve | same, including `update`/`delete` |

They all read one list — `SCOPED_TABLES` in `_shared/workspace-scope.js` — and
`tests/brand-data-scope.spec.js` re-derives that list **from the migration files** and fails the build
when the two drift. `currentWorkspaceId()` finds the request through the same AsyncLocalStorage the
LLM key lookup uses, so a module with no `req` can still scope itself. Outside a request (cron,
`workers/`, seed scripts) it resolves the oldest workspace; `WORKSPACE_ID` pins a different one, and
never overrides a signed-in user.

Consequences worth knowing:

- **Deployment credentials are never spent on a brand's behalf.** `KLAVIYO_API_KEY`,
  `PAGEDECK_*` and the WebEngage bucket describe the deployment's own accounts. Data Analysis reads
  the workspace's OWN connection (`/connections`) or reports `data_scope.level: 'unconnected'` with
  the connection to make. PageDeck has no per-brand connection yet, so only its workspace-scoped
  mirror tables are read.
- **The bundled Shopify export is tenant zero's.** `market-analytics.ownsBundledExport()` gates it;
  another workspace asking KicksGPT for its best seller is told which store to connect.
- **Ids that used to be global are now per brand.** `smart_calendar_entries.id` carries a workspace
  namespace (empty for tenant zero, whose `/lp/<campaign_id>` URLs are already published), and every
  dedupe key — `kb_knowledge.url_hash`, `competitor_brands (name, region)`, the `ci_*` content
  hashes, `brands.slug`, `kb_daily_digest.digest_date` — is unique per workspace instead of globally.
- **`lifecycle_brand_kit` is no longer a singleton.** It was `id INT PRIMARY KEY CHECK (id = 1)` with
  a `USING (true)` read policy, so every brand read and overwrote one row. It is one row per
  workspace, and a brand with no saved kit is seeded from its own onboarding record.

---

## 2. Credits

### Model
- The welcome grant is **per account, not per wallet**. Wallets are per (user, workspace) and anyone
  can create unlimited workspaces, so a per-wallet trial was an unlimited credit faucet. A second
  workspace's wallet starts empty; the uniqueness is enforced by a partial unique index on
  `credit_ledger (user_id)`.
- One wallet per **(user, brand workspace)**, so per-brand cost is visible. When a request does not
  name a workspace — which every pre-existing generator client does — the meter resolves the
  caller's **active** workspace before holding, so the wallet charged is always the one the header
  pill is showing.
- `credit_ledger` is append-only truth; the wallet balance is derived state.
- Spending is **hold → settle**, never a bare decrement:

  ```js
  const m = await credits.meter(req, 'mailer.generate', { units: 1 });
  if (!m.ok) return res.status(402).json(m);
  try   { const out = await work(); await m.settle(actualUnits); }
  catch (e) { await m.release(); throw e; }
  ```

  A failed run is always refunded. A metered feature reserves an estimate and returns the unused
  part on settle. `credit_settle` can never charge more than was reserved.
- `credit_hold` takes `SELECT … FOR UPDATE` on the wallet, so two concurrent runs cannot overdraw.
- An **explicit zero** unit count quotes and settles as free, so a run that did no billable work
  (a hand-pasted transcript) is never charged the reservation estimate.
- The welcome grant is idempotent through a partial unique index
  (`credit_ledger_welcome_once_idx`), not just an application check, so two simultaneous first
  touches cannot double-grant.
- Recharge fulfilment is **one transaction** (`credit_fulfil_order()`): the pending → paid
  compare-and-set and the ledger grant happen together. Splitting them was wrong in both directions
  — without the CAS two callers could each grant the pack; with the CAS alone, a grant that failed
  after the status flip left the order permanently `paid` with no credits and every retry
  short-circuiting. Inside one function a failed grant rolls the status back to `pending`, so the
  retry works. A partial unique index on `ref` where `kind='topup'` is the backstop.
- Voice minutes are **claimed before they are charged**: the session's billed total is moved by a
  compare-and-set, so two overlapping turns cannot bill the same interval twice, and a claim whose
  charge fails is handed back.

### Security
`credit_grant`, `credit_hold`, `credit_settle`, `credit_release` and `credit_wallet_id` are
`SECURITY DEFINER` and are **REVOKEd from `anon` and `authenticated`** — only `service_role` may
execute them. `credits-core.js` verifies the caller's JWT first, then calls them with the service
role. A signed-in browser cannot grant itself credits or cancel its own charge. `credit_wallets` has
a select-only policy and no insert/update policy at all.

### Where the meter is actually applied
Declaring a price does not charge anything, so the endpoints are wrapped:

| Endpoint | Charged as |
|---|---|
| `/api/ai/generate` | by mode: `mailer.brief`, `mailer.concepts`, `mailer.generate`, `landing.generate`, `ads.generate`, `analytics.narrative`, `assistant.chat` |
| `/api/ai/image` | `image.generate`, or `image.reels` in reels mode |
| `/api/calendar` | `calendar.generate` on the generating actions, `mailer.generate` on mailer builds; cron-authenticated runs are never metered |
| `/api/brain?action=telesuite` | per subfeature, from the registry |

`credits.metered(handler, featureFor, unitsFor, opts)` reserves before the handler runs and watches
the response: a 2xx settles the hold into a spend and gets a `credits` receipt attached to its
payload; anything else releases the reservation in full. Because the balance moves at **hold** time,
the user's balance is already correct the moment a run starts.

The wrapper **buffers** the response body and awaits settlement before writing it. A serverless
instance can be frozen the moment the handler resolves, so a fire-and-forget settle can be lost —
leaving a successful run permanently holding credits, or a failed one debited instead of refunded.
The ledger write is bounded (8s) so a hung call cannot hang the user's response.

`opts.successIf(payload)` covers endpoints that answer 200 with a degraded result. `/api/ai/image`
deliberately never 502s — when every provider fails it returns the on-brand placeholder — so it
declares the placeholder as a failure and the reservation is **refunded**. The user is never charged
25 credits for an image they did not get.

**Existing callers did not send a session token.** The meter identifies the caller from a Supabase
bearer token, and dozens of pages call `/api/ai/generate`, `/api/ai/image` and `/api/calendar` with
only a `Content-Type` header, so metering them would have returned `401 sign_in_required` to every
signed-in user. Rather than editing every call site, `auth.js` wraps `fetch` once: a **same-origin**
request to `/api/…` gets the current access token attached, only when the caller has not set an
`Authorization` header itself (so `CRON_SECRET` callers still win). Cross-origin requests are never
touched — attaching the token to a third party would leak the session.

### Prices are declared once
`api/_shared/credit-catalog.js` is the versioned source of truth (51 features). The server charges
from it, the UI labels every button from it, and the wallet page groups usage by it — so a feature
can never cost something the user was not shown. `credit_prices` allows a per-feature override
without a deploy.

A feature key that is not in the catalog **throws** rather than running for free — an unpriced
feature is a bug, not a discount.

### Real-time
`credit_wallets` is published to `supabase_realtime`. The header pill subscribes to this user's
wallet row, so a debit from any tab or a scheduled job moves the number immediately. Fallbacks, in
order: every API response carrying a balance is folded in via `Credits.applyReceipt()`, plus a
60-second poll if Realtime is unavailable.

### Cost shown per feature
Any element can declare its feature:

```html
<button data-credit-feature="mailer.generate">Generate</button>
```

`credits.js` appends a cost chip with a popover explaining what consumes the credits, turns the chip
red when the balance is short, and re-decorates on DOM mutation so dynamically rendered UIs are
covered. `Credits.guard(key)` opens the recharge panel instead of letting the user hit a 402.

### Wallet page
`/credits` (also `/wallet`, `/billing`, `/pricing`): balance, live indicator, recharge packs, the
full price list, usage by feature over 7/30/90 days, and the ledger.

### Recharge
No payment processor is wired up. `recharge` records a **pending** order; `fulfilOrder()` (operator
only, `CRON_SECRET`) marks it paid and grants the credits. Set `CREDITS_ALLOW_SELF_SERVE=1` to
fulfil immediately for dev/staging. New wallets get `CREDIT_WELCOME_GRANT` (default 500), once.

---

## 3. TeleSuite

Every feature from [AI-TeleSuite](https://github.com/Anchit-AI-Hustle/AI-TeleSuite), ported into
this platform as one feature with 23 subfeatures at `/telesuite`.

| Group | Subfeatures |
|---|---|
| Core | TeleSuite Home · Products · Knowledge Base |
| Sales & Support Tools | AI Pitch Generator · AI Rebuttal Assistant |
| Analysis & Reporting | Audio Transcription · Transcription DB · AI Call Scoring · Call Scoring DB · Combined Call Analysis · Combined Analysis DB |
| Voice Agents | AI Voice Sales Agent · Voice Sales DB · AI Voice Support Agent · Voice Support DB |
| Content & Data Tools | Training Material Creator · Material DB · AI Data Analyst · Data Analysis DB · Batch Audio Downloader |
| System | Global Activity Log · Clone Full App · n8n Workflow |

### Deliberate changes from the original
| Original | Here |
|---|---|
| Genkit / Gemini only | the repo's 6-provider waterfall (`_shared/llm.js`); Gemini multimodal only for audio |
| `localStorage` | per-workspace Supabase tables — work is shared and survives a device change |
| Seven separate dashboard stores | filtered views of one `telesuite_runs` table (shared source of truth) |
| Single hardcoded tenant | every run scoped to the active brand and its voice guardrails |
| Unmetered | credit-metered, with the price on the button before the run |

Browser `SpeechRecognition` and `speechSynthesis` still run client-side; only the agent turn is
generated on the server. The site-wide `Permissions-Policy` sends `microphone=()`, which would block
that outright, so `vercel.json` grants `microphone=(self)` on the TeleSuite paths only. Barge-in (customer speech cancels playback), turn-taking and automatic
post-call scoring are preserved.

**Voice calls are billed incrementally, per minute, by the server.** The price is per minute of
call, and turns arrive one request at a time, so neither "charge every turn" nor "charge only at the
end" is correct: the first over-charges a three-turn call inside one minute, the second lets a client
take unlimited free turns by never finishing. Instead a server-side session (`voiceSession` /
`billElapsed`, stored in `telesuite_runs`) owns the clock, and each turn charges only the minutes
that have elapsed since the last charge. A three-turn call inside one minute costs one minute; an
abandoned call still pays for the minutes it consumed; and the client cannot understate elapsed time
because the server's own `created_at` is authoritative. `voice_finish` tops up the final part-minute
and short-circuits on a duplicate `call_id` — matching only a completed `voice_sales`/`voice_support`
run, never the billing session row, which carries the same `call_id` and would otherwise make every
finish look like a duplicate.

**Roles are enforced server-side and in RLS.** `is_brand_member()` is true for every member,
including a `viewer`, so it is a READ test only. `is_brand_editor()` (owner or editor) is the write
test, and the catalog, TeleSuite items and TeleSuite runs policies now use it for writes while
keeping member reads. TeleSuite additionally checks the role in `context()` because its writes run
with the service role and bypass RLS entirely, and `catalog-import` checks it too — a viewer could
otherwise replace a workspace's whole catalog.

**Catalog replacement is one transaction.** Chunked upserts cannot be made all-or-nothing from the
API layer: the unique key is `(workspace_id, region, handle, sku)`, so an upsert *overwrites* a
matching existing row in place, and a failure after the first chunk leaves a mixture of old,
overwritten and new rows that no subsequent delete can undo. A replacement import therefore goes
through the `brand_catalog_replace()` function, where the delete and the insert run in a single
database call — one transaction. A failure rolls the whole swap back and the previous catalog
survives untouched. (An *additive* import still uses chunked upserts, since it destroys nothing and
is safe to re-run.) The function is `SECURITY DEFINER`, so it checks `is_brand_editor()` itself.

The page renders **entirely from the `SUBFEATURES` registry** in `telesuite-core.js`, so adding a
subfeature is a one-object change and its cost can never drift out of sync with the UI.

### API
`/api/telesuite` → `/api/brain?action=telesuite&op=…`

`registry` · `items` · `item-save` · `item-delete` · `items-seed` · `runs` · `run-delete` ·
`summary` · `clone` · `n8n` · and one op per generator (`pitch`, `rebuttal`, `transcription`,
`call_scoring`, `combined_analysis`, `optimized_pitches`, `training_deck`, `data_analysis`,
`voice_turn`, `voice_finish`, `product_description`, `kb_ingest`).

### Honesty rules kept in the prompts
- Call scoring must quote **verbatim** transcript evidence for every dimension.
- The data analyst must mark each finding `computed_from: "rows" | "description"` and say plainly
  when nothing was actually processed.
- Combined analysis must report real counts and state the sample size in its caveats.
- The rebuttal assistant has a deterministic fallback if every provider is down — it contains no
  product claims, only the DATA REQUIRED marker.
- A pasted transcript settles at **zero** units: nothing was generated, so nothing is charged.

---

## Serverless function budget

The Hobby plan caps Serverless Functions at 12 and the repo is **at** the cap. Nothing here adds a
function file:

- brand → mounted on `api/public-config.js` (`?action=brand`)
- credits → mounted on `api/public-config.js` (`?action=credits`)
- TeleSuite → mounted on `api/brain.js` (`?action=telesuite`)

All logic lives under `api/_shared/`, which Vercel excludes from the count. Friendly `/api/brand`,
`/api/credits` and `/api/telesuite` paths are `vercel.json` rewrites, not files.

---

## Files

| File | Role |
|---|---|
| `supabase/migrations/20260809120000_brand_workspaces.sql` | workspaces, members, catalog, per-user active brand |
| `supabase/migrations/20260809130000_credits.sql` | wallets, ledger, prices, orders, hold/settle/release/grant/usage |
| `supabase/migrations/20260809140000_telesuite.sql` | TeleSuite items + runs |
| `api/_shared/brand-workspace-core.js` | brand CRUD, palette validation, catalog import, readiness, tokens |
| `api/_shared/brand-extract.js` | **read the whole brand off its own site** — candidates with sources, never a guess |
| `api/_shared/brand-context-pack.js` | **the per-brand context pack** — DESIGN.md, own-site knowledge, catalogue, GitHub |
| `api/_shared/kb-url.js` | the ONE definition of a knowledge row's identity, so the two writers cannot drift |
| `supabase/migrations/20260814100000_brand_context_packs.sql` | the pack, the field provenance, and the SQL that refuses to overwrite a user's field |
| `api/_shared/site-crawl.js` | the one crawler the catalogue import, the brand extraction and the pack all ride on |
| `api/_shared/credit-catalog.js` | **what every feature costs** |
| `api/_shared/credits-core.js` | the meter: hold / settle / release / grant / usage |
| `api/_shared/telesuite-core.js` | TeleSuite registry + every operation |
| `brand-context.js` | client re-skin, onboarding gate, brand switching |
| `credits.js` | live balance pill, per-feature cost chips, guard, recharge |
| `onboarding.html` | the first screen |
| `credits.html` | wallet, prices, usage, ledger |
| `telesuite.html` | the TeleSuite hub |
| `data/brands/_default.json` | tenant zero — the shipped brand, so nothing regresses |

## Environment

Nothing new is required. Optional:

| Var | Effect |
|---|---|
| `CREDIT_WELCOME_GRANT` | starting credits for a new wallet (default 500) |
| `CREDITS_ALLOW_SELF_SERVE` | `1` fulfils recharge orders immediately (dev/staging) |
| `SUPABASE_SERVICE_ROLE_KEY` | **required** for the credit meter — without it paid features are disabled and say so |
| `GEMINI_API_KEY` | required for TeleSuite audio transcription; pasting a transcript works without it |
