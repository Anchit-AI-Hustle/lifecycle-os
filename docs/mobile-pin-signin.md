# Sign in with a mobile number and a 4-digit PIN (2026-09-28)

The operator's words: *"implement signin and signup like this ... and comment out all
other signin and signup - signin/signup with mobile number and a 4 digit password - save in
db (neon) or local browser cache whichever can be used - just like in parwah-hq"*.

This is the ONE sign-in now. Google/Supabase OAuth in `auth.js`, the gate's Google button
in `brand-context.js` and the Mailer Studio's own overlay login (`vhd_users` /
`vhd_session`) are **commented out, not deleted**, each under a dated banner. Nothing in the
browser can produce a Supabase session any more: the Supabase client `auth.js` builds is
anonymous (`persistSession:false`, `detectSessionInUrl:false`), the stale-token scans of
`sb-*-auth-token` are commented out, and the mobile+PIN session is the one session source.

Gated by `tests/mobile-pin-signin.spec.js` (24 tests, all executed: the core is driven with
an in-memory `sql` tagged template that runs statements one at a time, `api/public-config.js`
is executed with stubbed req/res, and the real pages run in Chromium on `127.0.0.1`).

## Supabase mode: phone accounts live in Supabase Auth (2026-10-03)

The operator's words: *"use supabase cli and remote host for supabase account creation"*, then
*"All features must work even with signin by number and pin"*.

A phone account kept in Neon or in the browser has no Supabase identity, so every feature
gated by RLS (brand workspaces, credits, connections, the agents' workspace scope) refused it
after a sign-in that had visibly worked. In **supabase mode** the account is a real
`auth.users` row and the browser holds a real Supabase session: `auth.uid()` names the person,
`requireUser()` answers `{provider:'mobile-pin', mode:'supabase', phone}`, `restAs()` reads
their workspaces through RLS, and onboarding saves brands to the account.

### Mode precedence (`op=status`)

| mode | when | accounts | brands |
|---|---|---|---|
| `supabase` | `SUPABASE_URL` + a server key set **and** `GET /auth/v1/health` answers | `auth.users` | the account (RLS) |
| `server` | a Neon `DATABASE_URL` that answers `select 1` | Neon `app_users` | this device |
| `device` | anything else (unchanged, including the 2026-09-30 device principal) | this browser | this device |

A configured project that does not answer falls through to the next mode and the answer says
so: `supabase: {configured:true, reachable:false, host}` beside the mode actually used. While
the project answers, a device-shaped token is **refused** (a device principal runs unmetered,
and that beside a working ledger would be a side door past the phone credit rules).

### The design: the server brokers sign-in, the PIN is never the password

Same panel, same state machine: one `enter` (new number -> name + PIN; known -> PIN; wrong ->
"N tries left"; five -> a 15-minute lock), the same 4-digit rules (weak list, straight runs).
GoTrue's minimum password length is 6, and a 4-digit password on the public
`/auth/v1/token?grant_type=password` endpoint would be ten thousand guesses for anyone holding
the anon key. So the password is **derived on the server**:

    password = "Pn1." + base64url(HMAC-SHA256(MOBILE_PIN_PEPPER, "lifecycle-os/mobile-pin/v1|" + E.164 + "|" + PIN))

Nobody without the pepper can produce a password the auth service accepts, so the only place
a PIN can be guessed is `api/_shared/mobile-auth-supabase.js`, behind the lockout. No pepper
(or one shorter than 32 characters) and `enter` refuses with 503 `pin_pepper_missing` before
**any** request is made. The plain PIN is never stored, logged or sent anywhere.

- **The lockout is decided in the database before any GoTrue call**:
  `mobile_pin_attempt()` reserves the try and sets the lock in ONE statement, so twenty wrong
  PINs at once evaluate at most five. A grant refusal counts as a wrong PIN unless it is 429,
  5xx / no answer, or `phone_provider_disabled` - listing the wrong-PIN codes instead would
  refund any code the service adds later. A refunded try is handed back with
  `mobile_pin_settle('void')`. The per-address budget (25 `enter` / 10 min) is
  `mobile_pin_rate_hit()`, keyed by a SHA-256 of the address.
- **Who is a phone account, trusted**: creation writes `app_metadata: {lifecycle_account:
  'mobile-pin', phone_e164}`. app_metadata is the metadata "the user should not be able to
  update" (raw_app_meta_data); only the service role writes it. A marker in `user_metadata`
  is ignored. So credits keep the phone rules: an unlisted number has no wallet and no welcome
  grant; a `CREDITS_COMP_PHONES` number holds one personal wallet, keyed to its Supabase user
  id, and recharges free; the operator emails in `COMP_ACCOUNT_HASHES` are unaffected.
- **The browser** stores `{token: access_token, refresh_token, expires_at, user, mode:'supabase'}`
  in `lifecycle.auth.session`; `LifecycleAuth.apiToken()` returns the access token; it is
  renewed a minute before expiry straight against the auth service with the anon key (so the
  per-IP refresh limit is the person's own address, not Vercel's); the supabase-js client gets
  it through `setSession()`; sign-out posts `op=signout`, which revokes it with
  `POST /auth/v1/logout?scope=local`. Google/OAuth stays commented out.
- **Device brands are OFFERED for sync, never uploaded unasked**: the onboarding sync offer
  appears for rows in this account's device namespace (`lifecycle.brand.device.workspaces.<user id>`),
  e.g. ones saved while the project was not answering. Anonymous rows are never adopted.
- **Resetting a PIN**: an operator clears `pin_set_at` on the person's
  `mobile_pin_accounts` row (SQL editor or `psql`); their next sign-in chooses a new PIN.
- **Rotating the pepper**: put the new value in `MOBILE_PIN_PEPPER` and the old one in
  `MOBILE_PIN_PEPPER_PREVIOUS`; a sign-in the new one does not open is retried with the old
  one and re-keyed on the spot (one reserved try for both). Remove the old value later.

### The session in the browser: one state, shared by every tab (review, 2026-10-03)

Nine review findings were one defect seen from nine paths: a tab deciding the session's state
from what IT had last seen. Now the stored record `lifecycle.auth.session` IS the session for
every tab, and every transition is written there first and applied from it (`storage` events
carry it to the other tabs):

| record | meaning | what the tab does |
|---|---|---|
| absent | signed out | drops its copy, signs supabase-js out locally, sends no token, shows Sign in |
| `state:'verified'` | checked with `op=me` since the last change | brands on the account, token sent |
| `state:'unverified'` | kept, but could not be checked or renewed | says so under the chip, brands on the device, no expired token sent, retried every minute |

- **Only a refusal ends a session.** A renewal that could not be made (no answer, 429, 5xx, no
  public config, an unrecognised refusal) keeps it, unverified; only `refresh_token_not_found`,
  `refresh_token_already_used`, `session_not_found`, `session_expired`, `user_not_found` and
  `user_banned` end it. That holds before and after `op=me` answers 401.
- **One renewal across tabs.** The refresh token is single-use: the renewal runs under a Web Lock
  (`navigator.locks`), re-reads the record inside it, and holds the lock 300 ms after writing
  (another tab's process sees localStorage a moment later). A refusal is checked against the
  record twice before it is believed, which is also the path without Web Locks. A tab that adopts
  a pair renewed elsewhere adopts its verified state and does not check again itself.
- **Another person signing in in another tab** replaces the whole session here (user, token,
  brand namespace), not just the token.
- **A device account when the project comes back.** A device session's token is refused while
  the project answers, so: same-origin calls made before the boot decides wait for it (the auth
  endpoint and the public config, which decide, never wait and carry no token meanwhile); the
  account keeps working on the device; its token is not sent; the mode line, a "Move this account
  to the database" button and the refusal sentence say to sign in again with the same number and
  PIN; doing so copies its device brands into the new account's device namespace, where onboarding
  offers them for sync. Nothing is uploaded unasked.

### The server: by the token, and only with a key the browser can hold

- **A Supabase JWT goes to the Supabase path whatever the moment's health probe said.** With Neon
  also configured, one failed probe used to send `op=me` to Neon's session table (401, session
  cleared); it now answers 503 `backend_unreachable` (kept).
- **The browser-visible key** is chosen in ONE place (`mobile-auth-supabase.publicKey()`: anon, else
  publishable; never `sb_secret_`, the service key itself, or a `service_role` JWT) and
  `/api/public-config` publishes exactly that. With none, `op=status` does not answer `supabase`
  (`supabase.reason: 'no_public_key'`): a session the browser cannot renew would go unverified
  after an hour.
- **The lockout covers adoption.** When the admin create answers `phone_exists`, the PIN is checked
  against an auth user this table never bound - and that check now reserves a try first, keyed by
  the phone, on a row a failure does not delete (`20261003142200_mobile_pin_lockout_covers_adoption.sql`:
  `mobile_pin_attempt(..., p_pending)`, `mobile_pin_unclaim` keeps a row carrying tries or a lock,
  `mobile_pin_claim` keeps the count on takeover and refuses while locked). Measured on a local
  Postgres 16: 30 concurrent pending attempts allow exactly 5.

### Follow-up after #119 (2026-10-03): reachable is not offerable; the device gate fails closed

- **Two questions, kept apart.** `supabaseStatus()` always probes `/auth/v1/health` when a URL and
  a server key are set (`reachable`), and separately says whether supabase mode can be OFFERED to
  browsers (`offerable`: reachable AND a browser-visible key). Folding the key into reachability
  answered "unreachable" for a live project with no public key, and `verifyToken()` then admitted
  leftover device tokens as UNMETERED principals beside a working ledger.
- **A device principal exists only when no ledger answers at all.** On the device path (no
  `DATABASE_URL`) a device token is refused while the project answers, or while its ledger's own
  `credit_prices` read answers even if the auth health check does not. A Neon session is still
  checked as before whenever supabase mode is not offered (it is metered, never a device principal).
- **The boot gate fails closed.** A stored device token is withheld from every same-origin call -
  including by `apiToken()`, so a caller that sets its own header gets nothing - until `init()` has
  DECIDED whether the server takes it. Waiting calls are released after 30 s at the latest, still
  without the token. (It used to release at 6 s while `op=status` was in flight, and send it.)
- The agents harness's device-mode world now models production's measured state including the
  ledger: a paused project answers nothing, so its `credit_prices` read fails there.

### Every endpoint called, and where it is documented

Shapes were read from the Auth server's own OpenAPI description (`github.com/supabase/auth`,
`openapi.yaml`) and the Supabase docs page beside each:

| call | made by | doc |
|---|---|---|
| `GET /auth/v1/health` | server (status) | OpenAPI `/health`; https://supabase.com/docs/guides/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR |
| `POST /auth/v1/admin/users` `{phone, password, phone_confirm, user_metadata, app_metadata}` | server, service key | https://supabase.com/docs/reference/javascript/auth-admin-createuser ; app_metadata vs user_metadata: https://supabase.com/docs/guides/platform/migrating-to-supabase/auth0 |
| `PUT /auth/v1/admin/users/{id}` `{password}` | server (reset, pepper rotation) | OpenAPI `/admin/users/{userId}` put; https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid |
| `POST /auth/v1/token?grant_type=password` `{phone, password}` | server | https://supabase.com/docs/guides/auth/passwords (HTTP tab, phone) |
| `POST /auth/v1/token?grant_type=refresh_token` `{refresh_token}` | browser, anon key | OpenAPI `/token` example; https://supabase.com/docs/reference/javascript/auth-refreshsession |
| `GET /auth/v1/user` | server (`requireUser`, `op=me`) | OpenAPI `/user`; https://supabase.com/docs/reference/javascript/auth-getuser |
| `POST /auth/v1/logout?scope=local\|global` | server (`op=signout`, `op=signout_all`) | OpenAPI `/logout`; https://supabase.com/docs/guides/auth/signout |
| `POST /rest/v1/rpc/mobile_pin_*` | server, service role | https://supabase.com/docs/reference/javascript/rpc |
| error codes (`invalid_credentials`, `phone_exists`, `over_request_rate_limit`, `phone_provider_disabled`) | server | https://supabase.com/docs/guides/auth/debugging/error-codes |
| `Sb-Forwarded-For` (only with a secret key) | server | https://supabase.com/docs/guides/auth/rate-limits |

### Schema: Supabase CLI migrations

- `supabase/migrations/20260929173555_mobile_pin_supabase_accounts.sql` (made with
  `supabase migration new`): `mobile_pin_accounts` (phone, user_id, name, pin_tries,
  locked_until, pin_set_at, claimed_at) and `mobile_pin_rate_limits`; RLS on with **no
  policy**, every privilege revoked from `anon`/`authenticated`; seven `SECURITY DEFINER`
  functions with an empty `search_path`, executable by `service_role` only. No PIN and no hash
  of one is stored: GoTrue holds the password hash.
- Three duplicate version prefixes (20260609, 20260610, 20260703) were given unique ones and the
  far-future `20261231090000_payment_gateway_connections.sql` was moved to `20260823180000_`,
  because `supabase db push` keys a migration by its version and refuses both shapes. Measured
  on 2026-09-29 with the CLI (2.118.0) against a local Postgres 16: all 59 migrations applied
  from zero; 10 and 40 concurrent `mobile_pin_attempt` calls each allowed exactly 5.
- `supabase` is a pinned devDependency, so `npx supabase` works; scripts: `db:link`,
  `db:migrations`, `db:push:dry`, `db:push`, `db:new`.

### Runbook: a new project named `lifecycle-os`

Every flag below was checked against `npx supabase <command> --help` (CLI 2.118.0).

1. **Log in.** `npx supabase login` (browser), or non-interactively
   `export SUPABASE_ACCESS_TOKEN=<personal access token>` (Account > Access Tokens), or
   `npx supabase login --token <token>`.
2. **An organisation with clean billing.** `npx supabase orgs list`. If the only org has unpaid
   invoices (restores and new projects are refused with `PaymentRequiredException`), settle
   them or create another: `npx supabase orgs create "<org name>"`, then note its id from
   `npx supabase orgs list`.
3. **Create the project.**
   `npx supabase projects create lifecycle-os --org-id <org-id> --region ap-south-1 --db-password '<strong password>'`
   (`--size` is optional). Note the ref from `npx supabase projects list`.
4. **Link this repo.** `npx supabase link --project-ref <project-ref>` (it asks for the database
   password, or pass `--password`). `npm run db:link -- <project-ref>` is the same.
5. **Apply the schema.** `npm run db:push:dry` (prints what would apply), then `npm run db:push`
   (`supabase db push --linked`). `npm run db:migrations` should then show no unapplied rows.
6. **Auth settings.** `supabase/config.toml` declares them: `[auth] enable_signup = false`
   (public sign-ups off; the server's admin calls are unaffected) and `[auth.sms] enable_signup =
   true`, `enable_confirmations = false` (the Phone provider on, no SMS). Set `[auth] site_url`
   to the deployment's origin, review with `npx supabase config diff`, then
   `npx supabase config push`. The same in the dashboard: Authentication > Sign In / Providers >
   Phone **on** with phone confirmations **off**, and "Allow new users to sign up" **off**.
   Leave the minimum password length at its default (the derived password is 47 characters).
   Checked against the Auth server's source (`supabase/auth`, `internal/api/admin.go`
   `adminUserCreate`: merges `app_metadata`, applies `phone_confirm`, and does not consult the
   sign-up switch; `internal/api/token.go`: a phone password grant with the Phone provider off
   is refused `422 phone_provider_disabled`, which this module reports as a configuration
   fault and never counts against the PIN).
   Optional: Authentication > Rate Limits > IP Address Forwarding **on**, with
   `SUPABASE_SECRET_KEY` set below.
7. **Keys.** `npx supabase projects api-keys --project-ref <project-ref>` (add `--reveal` to see
   secret keys in full). Use the `anon` key and the `service_role` key: the rest of the server
   sends the service key as a bearer, which the new secret keys do not support.
8. **Vercel environment** (Production, then Preview if wanted):
   `SUPABASE_URL=https://<project-ref>.supabase.co`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `MOBILE_PIN_PEPPER` (`openssl rand -base64 48`), optionally
   `SUPABASE_SECRET_KEY` and `CREDITS_COMP_PHONES`. `DATABASE_URL` is not needed in this mode.
9. **Redeploy**, then check `GET /api/public-config?action=auth&op=status`: it should answer
   `{"mode":"supabase", "pin_ready": true, ...}`. `pin_ready:false` means the pepper is missing.

### What the CLI could and could not do from the session that built this

`npx supabase --version` (2.118.0), `migration new`, every `--help` above, and a config parse
check (`supabase status` gets past `config.toml` to the missing Docker daemon; a broken value
fails with `CliConfigParseError`). It could not reach a remote: there was no
`SUPABASE_ACCESS_TOKEN`, the egress policy blocks `api.supabase.com` and `*.supabase.co`, and
the only organisation has unpaid invoices, so no project was created, restored or modified.

Gated by `tests/supabase-phone-accounts.spec.js` (32 tests, executed against
`tests/supabase-auth-fake.js`, a fake of exactly the endpoints above that throws on anything
else). Every security and session check is mutation-verified (19 + 7 + 9 + 10 mutations).

## The pieces

| Where | What |
|---|---|
| `api/_shared/phone-rules.js` | Dependency-free E.164 normalisation with per-country shapes (India +91 ten digits starting 6-9 is the home market; +1, +44, +971, ...). `phoneError(cc)` names the country and its shape. |
| `api/_shared/mobile-auth-core.js` | PIN rules, scrypt hashing, sessions, the per-IP budget, `status`, `enter`, `me`, `signout`, `signout_all`, `verifyToken`. Requires the neon driver **lazily**, so it loads on a clone with nothing installed. |
| `api/public-config.js?action=auth&op=...` | The mount. No new serverless function: the Hobby cap is 12 and the project is at it. |
| `auth.js` (the `MAUTH` block before `init()`) | The rail panel, the device-mode state machine (a mirror of the server's), session storage and boot validation. |
| `brand-context.js` | Routes a phone account's brand ops to the device store and builds the one sentence for that state. |
| `.env.example` | `DATABASE_URL` (also `NEON_DATABASE_URL`, `POSTGRES_URL`). |

Tables, created idempotently on first use in the **Neon** database: `app_users` (phone,
phone_cc, phone_local, name, pin_hash, pin_salt, pin_set_at, pin_tries, locked_until),
`app_sessions` (token_hash primary key, user_id, device, expires_at, last_used_at),
`app_rate_limits` (bucket, k, window_start, n). **Not** the Supabase `public.app_users` the
commented-out profile modal read: different database, different schema, no relation.

## The two modes, chosen honestly

`op=status` answers `{mode:'server'}` **only** when a database URL is set **and** `select 1`
answers within 4 s. Anything else is `{mode:'device', reason, host, message}`:

| reason | sentence |
|---|---|
| `no_database_url` | Saved on this device only: no database is configured. |
| `database_unreachable` | Saved on this device only: the database (`<host>`) is not answering. |

The panel asks once per page load and prints the sentence in the `.vh-status` style before
anything is typed. On the server the driver is built **once per URL** for the life of the
warm instance (a module-level map keyed by the URL string, so a test's injected `sql` never
touches it and a rotated URL gets a fresh client), the schema is therefore ensured once, and
the status answer is cached per URL: a "server" answer for 30 s, a "device" one for 5 s, so a
stream of gated requests costs neither the four DDL statements nor a `select 1` each. After sign-in the same sentence sits under the name in the rail
(`#lnav-umode`), or "Account saved in the database." in server mode.

**Server mode.** The panel posts to `op=enter`; the account is a row in `app_users`; the
session is `{token, user:{id,name,phone}, mode:'server', expires}` in
`localStorage['lifecycle.auth.session']`. Every boot validates it with `op=me`:

- 200 → signed in, the name refreshed from the record;
- 401 → cleared, and a note under the Sign in chip says the sign-in expired or was signed out elsewhere;
- 503 / no answer → **kept**, marked `verified:false`, and the mode line says *"Account in the
  database (`<host>`), which is not answering right now: nothing there can be checked or saved
  until it does."* A person who signed up in the database is never shown a device sign-up as if
  it were the same account: if they open the panel in that state, its sentence adds *"If you
  already have an account in the database, it cannot be used until the database answers;
  signing up here makes a separate account on this device only."*

**Device mode.** The browser runs the same state machine itself. Accounts live in
`localStorage['lifecycle.auth.device.users']`, keyed by E.164: name, a PBKDF2-SHA256 hash of
the PIN via WebCrypto (120,000 iterations, a random 16-byte salt), `tries`, `lockedUntil`.
The same weak-PIN list, the same five tries and fifteen minutes. WebCrypto's `subtle` API
exists only in a secure context (https, or localhost); on plain http the browser refuses to
hash a PIN and says so rather than storing one in the clear.

**Standalone device mode (2026-09-30).** A device token used to be **never sent**:
`LifecycleAuth.apiToken()` answered `''` for it, so every agent and every metered button
said *"this sign-in is saved on this device only"* and nothing ran — production's state,
with model keys set and no `DATABASE_URL`. The page now **sends** the token on same-origin
`/api/` calls. With no database URL, `verifyToken()` admits a well-shaped token as
`mode:'device'`, `user.id` = `device:<sha256 of the token>`, no phone invented from the
body. `requireUser()` still refuses that token without an `Origin`/`Referer` (a well-shaped
token is not a secret; a raw server-to-server call stays anonymous). Features run
unmetered (`credits.meter` short-circuits; the pill says *Local / Demo Mode*). A
deployment that **has** a database still refuses a token that is not in `app_sessions`.
An anonymous caller still cannot reach a model. TeleSuite still refuses a phone account
(no email identity there). Gated by `tests/standalone-no-database.spec.js`.

The browser's copy of the phone table, the weak-PIN list and `pinError()` is held to the
server's by the parity test, over the same inputs, so the copies cannot drift unnoticed.

## The state machine (`op=enter`, one action for both directions)

| you send | you get |
|---|---|
| unknown number, no name | `200 {exists:false}` → the panel shows the name row and the PIN row |
| unknown number, name + weak PIN | `200 {exists:false, needPin:true, error:'pin_invalid', message}` |
| unknown number, name + PIN | `200 {exists:true, created:true, token, expires, mode:'server', user}` |
| known number, no PIN | `200 {exists:true, needPin:true, name}` |
| known number, wrong PIN | `401 {wrongPin:true, left, error:'pin_wrong', message}` (5 tries, counted by ONE `update ... returning` statement, so five at once are five) |
| known number, 5th wrong PIN | `429 {locked:true, error:'pin_locked', until, message}` (15 minutes; the right PIN does not open a locked account) |
| two first sign-ups for one new number at once | one creates the account; the other is a **sign-in** to it and is held to the PIN check (`wrongPin` unless the PINs match) |
| known number with no PIN on record | `200 {exists:true, setPin:true, name}` → choose a new PIN (see Reset) |
| 26th `enter` from one IP in 10 minutes | `429 {error:'rate_limited'}` |

PIN rules: exactly `^\d{4}$`; the first-guessed PINs are refused (`0000` ... `9999`, `1234`,
`4321`, `2580`, `0852`, `1212`, `2121`, `1122`, `2211`, `1010`, `0101`, `2020`, `2000`,
`2001`, `1004`, `6969`, `0007`, `4200`) and so is any straight run up or down. scrypt
(N=16384, r=8, p=1) with a per-user salt, compared with `timingSafeEqual`. Four digits is the
operator's spec, which makes the lockout matter **more**: ten thousand PINs, five guesses,
then fifteen minutes, counted on the row so it holds across serverless instances.

Sessions: a random 32-byte base64url token of which **only the sha256** is stored, 90 days,
touched (`last_used_at`) rather than rotated. The token travels in `X-Lifecycle-Token`
(the body is accepted too); `auth.js` also sends it as `Authorization: Bearer` so every gate
that already reads a bearer sees it. A Supabase JWT has two dots and our token has none, so
`looksLikeToken()` never confuses them.

**Reset.** There is no SMS. An operator clears `pin_hash`/`pin_salt` on the row in Neon; the
next sign-in on that number answers `setPin:true` and the person chooses a new PIN. In device
mode the same happens by clearing `hash` on the entry in `lifecycle.auth.device.users`.

Every refusal carries `error` (a code) **and** `message` (a sentence). The panel renders
refusals through `LifecycleFailure.html()` in the failure frame; it never opens a dialog.

## What a phone account can and cannot reach

A phone account has **no Supabase identity**: `brand_workspaces`, credits, connections and
payments are all gated by `auth.uid()` / RLS, and a Neon uuid is nobody there.

- **Brands and workspaces: on the device, in both modes, under the ACCOUNT's own key.**
  `brand-context.js` routes `list|active|get|save|activate|delete` to the device store whenever
  the session is `provider:'mobile-pin'`. The store is namespaced per signed-in account
  (2026-09-29): `lifecycle.brand.device.workspaces.<user id>`. The unscoped
  `lifecycle.brand.device.workspaces` is used ONLY when nobody is signed in (no database, a
  database that is not answering, signed out), so onboarding without a backend keeps working; a
  sign-in never adopts those anonymous rows and a sign-out never deletes them. A browser is
  shared - with one key for everyone, person B signing in saw person A's brands. The id is read
  from `LifecycleAuth.session` once auth.js has booted, else from the stored session, because
  `brand-context.js` paints the first frame before auth.js runs; when auth.js changes the
  session mid-visit (a sign-in in the panel, a 401 on boot) the listener re-reads because the
  NAMESPACE changed, not only when the mode did. `BrandContext.device.key()` answers the key in
  use. The onboarding panel says, in the accent rule: *"Signed in as `<name>` · workspaces are
  saved on this device"* (server mode adds *"· account in the database"*). No sync offer is
  rendered and `syncDeviceToAccount()` refuses with `account_type_unsupported`: there is no
  workspace record to sync to.
- **Server gates.** `brand-workspace-core.requireUser()` accepts a **server-mode** token
  (verified against `app_sessions`) and returns
  `{ok:true, user_id, phone, name, email:'', provider:'mobile-pin'}`. A device-mode token, an
  unknown token or a token with no database behind it is refused **exactly like an anonymous
  call** (`401 sign_in_required`) and nothing about it is trusted from the body.
  `require-caller.js` (the AI routes) therefore admits a server-mode phone account.
- **`restAs()`** - the one door every "as the caller" Supabase read goes through - refuses a
  mobile token with `403 account_type_unsupported` and a sentence, instead of PostgREST's bare
  401. So connections, payments, TeleSuite and the brand router's server ops answer a phone
  account with a sentence naming why.
- **Extract** (`?op=extract`, reading a brand's own site) is **open** to a server-mode phone
  session, because `requireUser()` can check it; a device-mode session cannot be checked, so
  the wizard disables the control with that reason. With Supabase unreachable the existing
  open path applies as before.
- **Credits: a phone account has no wallet.** `credits.meter()` refuses it with
  `403 credits_require_account` **before** any wallet exists - a phone sign-up is free and
  unverified (no SMS), and a welcome grant per number would be an unlimited faucet on the
  deployment's provider budget. `op=balance` answers 200 with `wallet:null` and the reason so
  the header pill shows "Credits" quietly rather than a failure on every page. On a deployment
  where the meter is **unconfigured** (no `SUPABASE_SERVICE_ROLE_KEY`), the metered routes run
  unmetered for any signed-in caller, as they always have - which now includes a server-mode
  phone account. Stated plainly: with no OTP, a phone account is self-asserted; the PIN and the
  lockouts make the number not the whole key, but a deployment that opens paid features to
  phone accounts is opening them to anyone with a browser, bounded by the per-IP budget and
  `require-caller`'s per-instance brake.
- **Comp accounts** (`CREDITS_COMP_ACCOUNTS`) are keyed by the **verified session email**. A
  phone account carries none, so it can never be a comp account; do not add phone numbers to
  that list, and nothing reads it for them.
- **`LifecycleAuth.internal` stays `false`.** It is keyed on a verified email domain
  (`applyAccessMode` for a Supabase user); a phone account has no email, so no phone account
  is "internal". Nothing invents one.
- **Operator-only modes** (`?pipeline=1`, `?probe=1`, the detailed health payload, data-analysis
  writes) still go through `data-analysis-core.authorize()`, which checks a Supabase user on an
  allowed email domain or `CRON_SECRET`. A phone account is never an operator.

## What auth.js publishes

- `LifecycleAuth.session = {provider:'mobile-pin', mode, access_token, user:{id,phone,name}, expires, verified}`
- `LifecycleAuth.user = {id, phone, name, provider:'mobile-pin', mode}`
- `LifecycleAuth.backend = {kind:'signed-in', session:{provider, mode, name, phone, verified}, supabase: unconfigured|unreachable|reachable|sdk, ...}` -
  for a phone account "who is here" and "is the workspace database there" are two facts, carried separately.
- `LifecycleAuth.openSignIn()` opens the panel on the current page (the brand gate's button calls it).
- `LifecycleAuth.apiToken()` is the only token any same-origin request carries.
- `LifecycleAuth.mobile.rules` exposes the browser's copy of the rules for the parity test.

The four signed-out sentences in the standing bar (`unconfigured`, `unreachable`, `sdk`,
`signed-out`) now describe what the Supabase state means for **data** and say that signing in
with a mobile number is unaffected; none of them blocks sign-in any more.

## Tests re-targeted by this change

`signed-out-usable`, `signin-config`, `no-native-dialogs`, `nav-rail-everywhere`,
`error-presentation`, `onboarding-without-backend` and `cross-brand-leak` all signed in through
a `supabase.auth.getSession` stub or asserted a Google redirect. Each now seeds a mobile+PIN
session (or drives the panel) and asserts the claim that still holds. Two changed meaning
deliberately, and their headers say so: `onboarding-without-backend`'s signed-in cases no longer
assert a server brand path (no browser session can take it), and `error-presentation`'s "Your
brands" cases drive the localhost preview, the one state in which the wizard still asks the
server and can be refused. `nav-rail-everywhere`'s late-session case now asserts `internal:false`
where it asserted `true` for a Supabase user.

## Found by running it

A lock that had expired left `locked_until` set after a correct sign-in, because locking zeroes
`pin_tries` and only `pin_tries` triggered the reset; the browser mirror reset on either field.
The parity test is there for exactly this class.

## Review findings (2026-09-29), each reproduced with an executed test before it was fixed

- **The loser of a sign-up race was handed the winner's account.** Two first sign-ups for the
  same new number in flight at once: both read "no row", both insert, the unique index refuses
  the second with `23505`, and the catch reloaded the winner's row - but `isNew` stayed `true`,
  so the PIN branch was skipped and a session was issued for an account whose PIN the loser
  never typed. `isNew` is now set to `false` in that catch, so the loser is a sign-in and is held
  to the PIN check. The test fires two `enter()`s with different PINs through the in-memory
  store and asserts the loser gets `wrongPin` and no token; with matching PINs both sign in.
- **N concurrent wrong PINs consumed ONE attempt.** `pin_tries` was read, incremented in
  JavaScript and written back, so five wrong PINs at once all read 0, all wrote 1, and the lock
  never fired - five guesses at a time, for ever. It is now ONE statement:
  `update ... set pin_tries = case when pin_tries + 1 >= 5 then 0 else pin_tries + 1 end,
  locked_until = case when ... then <until> else locked_until end ... returning pin_tries,
  locked_until`, and locked / tries-left is decided from the RETURNED row. The in-memory store
  runs statements one at a time (a promise chain) so the interleaving is a database's; five
  concurrent wrong PINs lock the account, ten report four `wrongPin` and six `locked`.
- **One device store for every account on a shared browser** (above, "under the ACCOUNT's own
  key"). The test signs A up through the real panel, saves a brand, signs out, signs B up and
  asserts an empty list and nothing of A's on screen, then signs A back in and asserts her brand
  is back and painted; an anonymous draft typed before either signed in stays under the
  unscoped key throughout. `tests/cross-brand-leak.spec.js` and
  `tests/onboarding-without-backend.spec.js` seed the account's key now.
- **`privacy.html` said Google authenticates and Supabase Auth holds the session.** Rewritten
  for the sign-in that exists: what is collected (number, name, a salted PIN hash - scrypt in
  Neon, PBKDF2 in the browser - sessions as a SHA-256 digest, the attempt counter, the
  per-address limit), where it lives in each mode, retention (90-day sessions, ten-minute
  limit rows), and that brand workspaces are kept under a key private to the account. The
  Google text is under a section marked `data-historical` that says the sign-in was withdrawn
  on 28 September 2026. The test reads the rendered page and asserts Google is named nowhere
  else.

All four are mutation-verified: restoring each defect fails its test.

## Verified on production (2026-09-29)

**Where and what.** Production is `https://lifecycle-os.anchit-tandon.com` (`knickgasm.vercel.app`
is a 308 onto it). Vercel reports the live production deployment as
`dpl_8AEwJP1NWLjyvxvSB7yuLmZzSiB9`, built from `main` at commit
`2b2a992bcfa89d6ccc021a9b2df5724589cd7efc` (PR #105), created 2026-09-29 07:09 UTC. `main`'s head
`d9ac6a7` is not deployed yet (the free-tier daily deployment quota was spent); both commits carry
the mobile+PIN sign-in, and `auth.js` differs between them only by the 2026-09-29 `serverActions`
block, `credits.js` by its two `refusalFor` calls.

**The status endpoint, read from production itself** (through the Vercel connector, because the
container's egress policy denies the host):

```
GET /api/public-config?action=auth&op=status
200 {"ok":true,"mode":"device","reason":"no_database_url","host":"",
     "message":"Saved on this device only: no database is configured. Set DATABASE_URL to keep accounts in a database."}
access-control-allow-headers: Authorization, Content-Type, X-Lifecycle-Token · cache-control: no-store
```

So production runs **device mode**: no `DATABASE_URL` / `NEON_DATABASE_URL` / `POSTGRES_URL` is
set, accounts live in the browser, PBKDF2 via WebCrypto. `/api/public-config` (no action) still
names the Supabase project (`fswdwmkgggzyxrdzabnh.supabase.co`, paused) and its anon key, which
this sign-in does not use.

**The deployed bytes, verified.** `auth.js` (251,081 bytes), `brand-context.js`, `smart-brain.html`
and `onboarding.html` were fetched from production and are byte-identical to `git show
2b2a992:<file>`; `credits.js`, `theme.css` and `index.html` match through Vercel's ETag, which is
the md5 of the body (all seven md5s agree). The deployed `auth.js` carries the panel (`#lnav-mauth`,
`mauthOpenPanel`, `LifecycleAuth.openSignIn`); its only two `signInWithOAuth` occurrences are
comment lines under the `DISABLED 2026-09-28` banners, and "Sign in with Google" appears nowhere in
it. The deployed `brand-context.js` names Google only inside the commented-out gate button.

**The browser drive was against production's deployed bytes, served locally.** The container cannot
open the production host: the egress proxy answers 403 to CONNECT for both hostnames (curl:
`CONNECT tunnel failed, response 403`; Chromium: `net::ERR_TUNNEL_CONNECTION_FAILED`), and likewise
for the supabase-js CDN and the paused Supabase host. So `git archive 2b2a992` (the same bytes as
the fetched files) was served from `127.0.0.1`, a secure context in which WebCrypto's `subtle`
exists exactly as on https; `/api/public-config` and `?action=auth&op=status` answered production's
exact JSON; every other `/api/` route answered 503 with a sentence; the SDK was stubbed with an
anonymous client and the auth-host probe aborted, which is the state production is in anyway (the
project is paused, its host does not resolve). Script and record:
`scratchpad/mobile-pin/drive-prod-bytes.js`, `observations.json`, `screenshots/01..14`. Viewport
1280x800, fixture number `+91 98765 43210` (nobody's), name "Asha Test", PIN 7391.

What was observed on the deployed bytes, on `/onboarding` and then `/brain`:

- signed out: the Sign in chip, no session, no Google control, no `signInWithOAuth` call;
- the panel opens on the same page, no navigation; its mode line is exactly production's status
  sentence; `data-mode="device"`;
- `+91 5876543210` → *A India number has 10 digits after the country code. Please check it.*;
  `+1 1015550123` → *A USA / Canada number has 10 digits after the country code. Please check it.*;
  both in the failure frame, nothing sent;
- `+91 98765 43210` → *This number is new here, so we will set you up. Already have an account? Check
  the number above.*, button *Create my account and continue*; PINs `1234` and `0000` → *That PIN is
  one of the first anyone would try. Please pick another.* with no account stored; `123` → *Your PIN
  is 4 digits.*;
- PIN 7391 → the rail reads **Asha Test** with *Saved on this device only: no database is
  configured…* under it; the panel closes; `LifecycleAuth.session` is `{provider:'mobile-pin',
  mode:'device', user:{id:'dev-…', phone:'+919876543210'}}`, `internal:false`, backend kind
  `signed-in`; `BrandContext.storage().account_sentence` is *Signed in as Asha Test · workspaces are
  saved on this device* and `server_open:false`; the device store holds `salt` (32 hex), `hash`
  (64 hex), `iterations:120000`, `tries:0`, `lockedUntil:null` and no value equal to the PIN; no
  `op=enter` or `op=me` left the browser and no request carried a token;
- the wizard: typing a brand name and pressing *Colour schema →* writes the draft under
  `lifecycle.brand.device.workspaces.dev-…` (the account's key, `BrandContext.device.key()`); the
  unscoped key is not written; the review step shows the account sentence above the row;
- reload keeps the session with no `op=me`; `/brain` shows the same name, key and sentence;
- sign out reloads: the chip is back, `lifecycle.auth.session` is gone, the account row and the
  brand under the account key are both kept, the device key is the unscoped one again;
- sign in again: *Welcome back, Asha Test. Type your PIN.*, button *Sign in*; 7391 signs in as the
  same id and the brand is listed again;
- five wrong PINs: *That PIN is not right. 4 tries left.*, then 3, 2, *1 try left*, then *Too many
  wrong PINs. Try again in 15 minutes.* with `data-state="locked"` and `lockedUntil` set; the right
  PIN while locked is refused with the lock sentence and no session;
- no native dialog, no page error.

**Found on the deployed bytes, fixed in this branch** (each reproduced by an executed test before
the fix, and mutation-verified):

- **The page went dim after Sign in on a desktop and stayed dim after signing in.**
  `mauthOpenPanel()` added `open` to `#lifecycle-nav` unconditionally ("the rail is a drawer on a
  phone"), and the drawer's backdrop, a 55% black pointer-catching sheet, is not scoped to the phone
  breakpoint. At 1280px the rail is always visible, so the only effect was the backdrop: the wizard's
  own *Colour schema →* button could not be pressed (Playwright: `#lnav-backdrop intercepts pointer
  events`, screenshot `07a-next-click-blocked-by-backdrop.png`), and nothing said that clicking the
  dark area or pressing Escape was the way out. The panel now opens the drawer only when the burger
  is displayed (the rail IS a drawer) and only if it was closed, and closes what it opened when the
  panel goes (sign-in or Cancel); a drawer the person opened themselves is left as they had it.
  Test: *the panel opens the rail drawer only where the rail IS a drawer…*, driven at 1280px and at
  390px.
- **A server-mode account whose database is down was told it was signed in on a device.**
  `requireUser()` flattened `verifyToken()`'s `unreachable` (a URL is set, the lookup threw) and
  `no_database` into one `401 sign_in_required` reading *a sign-in kept on this device only cannot be
  checked by the server*. A token of our shape reaches the server only from a server-mode sign-in
  (a device token is never sent), so the sentence contradicted the rail's own mode line, and the 401
  is the code every catch reads as "sign in again", which cannot help while the database is down.
  It is `503 backend_unreachable` now, naming the host, with `backend_unreachable:true` so
  `require-caller` passes the 503 through. `no_database` keeps the 401 and the device sentence.
- **On a phone the signed-out notice sat on top of the menu button.** The standing bar (*"Sign in
  with your mobile number and a 4-digit PIN (the Sign in chip in the menu)"*) is `position:sticky;
  top:0; z-index:120`, inserted as the body's first child; the rail's mobile top bar is fixed at
  `z-index:100`. At 390px the notice covered the burger that opens the menu the sentence points at,
  so the first press landed on the notice and the way to Sign in was to find Dismiss first (the
  drawer test hung on exactly that press: `#lc-authnotice intercepts pointer events`). The bar now
  sticks at `top: var(--ltb-h, 0px)` (the rail's own published mobile-bar height, 0 on a desktop) and
  is inserted after `#lifecycle-nav`, whose spacer reserves that height in flow. Nothing changes on a
  desktop, and the notice is still shown, below the bar. The two halves do different jobs: the
  sticky offset alone keeps the burger clear at rest but leaves the bar painted over the first
  50px of what follows it (it still occupies its old place in flow), and the insertion alone keeps
  it clear at rest but lets it slide over the top bar on scroll; the mutation that fails the test
  is the deployed state, both reverted together (`Received: "lc-authnotice"` at the burger's
  centre), and either half alone passes the at-rest check.

**Coverage added** (`tests/mobile-pin-signin.spec.js`, 29 tests, all executed): a device session
signed in on one page is the session on `/onboarding`, `/index` and `/dashboard` after navigation,
from the first frame, with no `op=me`; `op=me` refuses a forged, a malformed, a JWT-shaped and an
absent token with 401 through the shipped handler, `signout_all` invalidates the real one, and a
page booting with a forged stored session clears it, says so under the chip, and opens no device
namespace for it; five concurrent wrong PINs through the SHIPPED handler each count and lock the
row; and the two findings above.
