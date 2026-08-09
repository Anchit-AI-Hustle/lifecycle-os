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

`defaults` · `list` · `active` · `get` · `save` · `activate` · `delete` · `catalog-import` ·
`catalog` · `readiness` · `validate-palette`

Reads and writes go through PostgREST **with the caller's JWT**, so the RLS policies in
`supabase/migrations/20260809120000_brand_workspaces.sql` are the authority. Unlike the older
single-tenant tables, a workspace is private to its owner and members — not world-readable.

---

## 2. Credits

### Model
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
generated on the server. Barge-in (customer speech cancels playback), turn-taking and automatic
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
