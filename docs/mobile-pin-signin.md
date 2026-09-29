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
hash a PIN and says so rather than storing one in the clear. A device token is meaningful
only in that browser and is **never sent**: `LifecycleAuth.apiToken()` answers `''` for it,
and the fetch wrapper, `brand-context.js` and `credits.js` all go through that.

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
