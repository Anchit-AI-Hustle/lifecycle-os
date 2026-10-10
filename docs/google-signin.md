# Sign in with Google (2026-10-10)

The owner's words: *"No signin with mobile number - only Google signin pls"*.

Sign-in is **Google, through Supabase Auth, and nothing else**. The mobile number + 4-digit
PIN sign-in that ran from 2026-09-28 (`docs/mobile-pin-signin.md`, now historical) is switched
**off**, not hidden. Gated by `tests/google-only-signin.spec.js` (executed: the shipped
handlers in Node, every page that loads `auth.js` in Chromium).

## The browser (`auth.js`)

- The rail's chip reads **Sign in with Google** (the "with Google" half hides in the collapsed
  rail). The brand gate's button says the same and calls the same function. There is no panel,
  no phone or PIN input, anywhere.
- A press runs `beginGoogleSignIn()`:
  1. waits for the boot to decide (the chip says "Checking sign-in…"), so a slow config fetch
     is never reported as a missing project;
  2. refuses, with the standing bar's own sentence and the host named, when the deployment has
     no `SUPABASE_URL` (`unconfigured`), the project does not answer `GET /auth/v1/health`
     (`unreachable` - paused, renamed or deleted look the same), or supabase-js did not load
     (`sdk`). **Nothing navigates to a host that is not there**;
  3. reads `GET /auth/v1/settings` and refuses when `external.google === false`
     (`provider-off`), naming the dashboard steps - GoTrue would otherwise answer the redirect
     with a bare 400 `validation_failed`. Unreadable settings fail open;
  4. remembers the page (`lc-return-to`) and calls
     `signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/, queryParams:
     { prompt: 'select_account' } } })`. `redirectTo` is the origin ROOT (the Site URL in
     production), so a missing wildcard cannot 400 the bounce; `restoreReturnTo()` sends the
     person back afterwards.
- The client is built with `persistSession:true, autoRefreshToken:true,
  detectSessionInUrl:true, flowType:'pkce'`. On a host that answers, `getSession()` restores a
  session; `onAuthStateChange` applies sign-in, refresh and sign-out. On a host that does not
  answer the session is not asked for (supabase-js retries the refresh for ~25 s first) and
  the page is signed out, said.
- `LifecycleAuth.apiToken()` is the Google access token (a Supabase JWT); the fetch wrapper
  sends it as `Authorization: Bearer` on same-origin `/api/` calls only.
  `LifecycleAuth.internal` is true only for a Google session.
- The profile chip shows the Google name (`user_metadata.name`/`full_name`), the picture
  (`avatar_url`, `referrerpolicy="no-referrer"`) and the email as its title.

### A phone session left in a browser

`endLegacyPhoneSession()` runs first on every boot:

| Key | What happens |
|---|---|
| `lifecycle.auth.session` | Removed. A server or Supabase phone session is also revoked (`op=signout`, best effort). |
| `lifecycle.auth.device.users` | Removed (device accounts: a name and a PBKDF2 hash of a 4-digit PIN). |
| `lifecycle.brand.device.workspaces.<phone account id>` (+ its `.catalog.`/`.pack.` side keys) | **Kept** where it is, never deleted, and **copied** into the unscoped key the signed-out wizard reads. |

The standing bar and a note under the chip (accent rule) say *"Mobile-number sign-in has ended.
Sign-in is with Google now ... The N brands it kept on this device are still here."* The old
token is never sent on anything but that revocation.

### Where brands live

- Signed out, project down or unconfigured: **this device** (`lifecycle.brand.device.workspaces`).
- Signed in with Google, project answering: **the account** (`brand_workspaces`, RLS). The
  per-account device namespace is `lifecycle.brand.device.workspaces.<Supabase user id>`.
- Signed in, the onboarding wizard **offers** to sync the account namespace's rows AND the
  unscoped ones (`BrandContext.device.syncable()`). Offering the unscoped rows exposes nothing:
  anyone at the browser sees them by signing out. Nothing is uploaded without a click.

## The server

- `public-config.js?action=auth` (`mobile-auth-core.handle`): `op=status` answers
  `{mode:'google', pin_signin:false}`; **`op=enter` answers 410 `pin_signin_removed`** for
  every method before any database, rate-limit or GoTrue call; `op=me` answers 401;
  `op=signout`/`signout_all` revoke what they still can and answer 200.
- `brand-workspace-core.verifyCaller()` (behind `requireUser()`, which every gate uses):
  - a token of the PIN shape (43 base64url, no dots) - a live Neon session, the old
    `mode:'device'` principal, a forgery - is refused **exactly like no token**:
    401 `sign_in_required`, decided before any lookup;
  - a Supabase JWT is verified at `/auth/v1/user`; a **Google** account (or an email account
    an operator made) is admitted; a **phone** account the PIN broker made, or any other OAuth
    provider, is refused like anonymous.
- The analytics operator gate (`data-analysis-core.authorize`) applies the same rule.
- Nothing downstream can see `provider:'mobile-pin'` or `mode:'device'` any more; the branches
  that keyed on them (credits' phone rules, TeleSuite's device store, brand-runtime's carried
  brand) are unreachable and were left in place. `CREDITS_COMP_PHONES` is moot and harmless.
  The three operator emails stay comp accounts (`COMP_ACCOUNT_HASHES`), now reached through
  their Google sign-in.

## What production needs before Google sign-in can complete

Production points at a **paused** Supabase project (org-wide billing hold). Until it answers,
the app is the `unreachable` signed-out state: every page opens, brands save to the device,
the bar names the host, and the Sign in chip says why and does not navigate.

1. **A reachable project.** Settle the org's invoices and restore the project, or point
   `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` on Vercel at a live one
   (`scripts/connect-supabase.sh`, `docs/self-hosted-supabase.md`).
2. **The Google provider ON** (Authentication → Sign In / Providers → Google) with a Client ID
   and Secret from a Google Cloud **Web application** OAuth client whose only Authorized
   redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`. Or set
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `_SECRET` and `supabase config push`
   (`supabase/config.toml` declares `[auth.external.google]`).
3. **The redirect allowlist**: Site URL `https://lifecycle-os.anchit-tandon.com`, Redirect URLs
   `https://lifecycle-os.anchit-tandon.com/**` (and `http://localhost:3001/**` for local work).
4. **Sign-ups on** at the project level (`[auth] enable_signup = true`): GoTrue refuses to
   create the user a FIRST Google sign-in brings when it is off, OAuth included. Email and
   phone sign-ups stay off per provider (`[auth.email]`, `[auth.sms]`).
5. Optional clean-up: delete or ban the phone users the PIN broker created in `auth.users`
   (their sessions are refused by the API either way, and the phone provider is off).
