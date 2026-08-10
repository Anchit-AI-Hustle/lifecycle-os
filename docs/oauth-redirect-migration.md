# OAuth redirect migration (domain moves)

When a sibling project moves to `<slug>.anchit-tandon.com` (via
`scripts/migrate-domains.*`), Google sign-in has to keep working on the new
origin. This doc explains exactly what must change, what is automated, and the
hard limit on the Google side.

## How this app signs in

The main app uses **Supabase-mediated Google OAuth** (`auth.js`):

```js
supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: location.origin + location.pathname },
});
```

The full-page flow is: **browser → Supabase Auth → Google → Supabase callback →
back to `redirectTo`**. That routing decides where the domain matters.

## What actually has to change on a domain move

| Surface | Value | Changes on domain move? | Automated? |
|---|---|---|---|
| **Google OAuth client — Authorized redirect URI** | `https://<ref>.supabase.co/auth/v1/callback` (the Supabase callback) | **No** — tied to the Supabase project, not the app domain | n/a |
| **Google OAuth client — Authorized JavaScript origin** | `https://<slug>.anchit-tandon.com` | Only if the project also does a *client-side* Google flow (GIS / One Tap). The Supabase full-page redirect does not need it, but adding it is harmless and future-proof | **No — Console only** (see below) |
| **Supabase Auth — Site URL / Redirect URLs allowlist** | `https://<slug>.anchit-tandon.com`, `https://<slug>.anchit-tandon.com/**` | **Yes** — `redirectTo` must be allowlisted or the post-login bounce-back 400s | **Yes** — via the Supabase Management API |
| **Gmail OAuth (competitor-intelligence-hub)** | `http://localhost:8765/cb` (bootstrap only; runtime uses a refresh token) | No — domain-independent | n/a |

**Takeaway:** the change that genuinely breaks sign-in on a new domain is the
**Supabase redirect allowlist**, and that is scriptable. The Google *web client*
needs nothing for the Supabase flow (its redirect URI is the fixed Supabase
callback); a JavaScript origin is optional and can only be added in the Console.

## This project (lifecycle-os) — canonical origin, verified 2026-07-12

The **canonical production origin is the custom domain**
`https://lifecycle-os.anchit-tandon.com`. The Vercel default
`https://knickgasm.vercel.app` **308-redirects** to it (confirmed via
`/api/health`), so users land on the custom domain and sign-in fires
`redirectTo: https://lifecycle-os.anchit-tandon.com/...`.

Required Supabase Auth config (Authentication → URL Configuration):
- **Site URL:** `https://lifecycle-os.anchit-tandon.com` (the canonical
  origin — not the `.vercel.app`, since that only redirects here).
- **Redirect URLs (allowlist):**
  - `https://lifecycle-os.anchit-tandon.com/**` (**required** — the
    canonical origin; without it `redirectTo` is rejected and Supabase falls
    back to Site URL, bouncing the user to the wrong origin / a redirect loop)
  - `https://knickgasm.vercel.app/**` (keep — direct `.vercel.app`
    visits before the 308)
  - `https://lifecycle-os-*.vercel.app/**` (optional — only if Google
    sign-in must work on PR **preview** deploys; not needed for production)

Common miss: allowlisting only `…vercel.app/**` while the app actually serves
from the custom domain. Auth then works on the bare `.vercel.app` but breaks for
everyone on the canonical domain. The Google web-client callback
(`https://<ref>.supabase.co/auth/v1/callback`) is unchanged — do not touch it.

> Stale-domain caveat: `knickgasm.vercel.app` is an OLD
> separate deployment (no current routes / Supabase) and is NOT this app — do not
> add it to any allowlist or treat it as live.

## The gcloud reality

**There is no `gcloud` command and no public Google API to edit a
"Web application" OAuth 2.0 client's redirect URIs or JavaScript origins.** This
is a long-standing, documented limitation
([google-cloud-go#10768](https://github.com/googleapis/google-cloud-go/issues/10768),
[Manage OAuth Clients](https://support.google.com/cloud/answer/15549257)). The
only programmatic surface, `gcloud iap oauth-clients`, manages *IAP-brand*
clients, which these apps do not use.

So the migration tooling does not pretend to mutate the web client. It:

1. **Auto-applies the Supabase allowlist change** (the required, scriptable part).
2. **Resolves the active gcloud account/project** and **prints an exact,
   idempotent plan** for the Google web client — the JavaScript origin to add
   and a Console deep-link to the client — so a human finishes it in seconds.

## Usage

```bash
# Dry-run everything (domains + OAuth plan), no writes:
node scripts/migrate-domains.js

# Apply: migrate domains AND reconcile the Supabase allowlist for each:
VERCEL_TOKEN=... GODADDY_KEY=... GODADDY_SECRET=... SUPABASE_ACCESS_TOKEN=... \
  node scripts/migrate-domains.js --apply

# Just the OAuth half (Supabase allowlist + Google plan), one project:
SUPABASE_ACCESS_TOKEN=... KNICKGASM_LIFECYCLE_OS_SUPABASE_PROJECT_REF=abcd \
  node scripts/migrate-oauth.js --project=lifecycle-os --apply

# Also promote the new domain to the Supabase Site URL (canonical origin):
node scripts/migrate-oauth.js --apply --promote-site-url

# Skip the OAuth follow-through during a domain run:
node scripts/migrate-domains.js --apply --no-oauth
```

Pure-curl mirrors (`no Node needed`): `scripts/migrate-oauth.sh` and
`scripts/migrate-domains.sh` accept the same flags. `npm run migrate:domains` /
`npm run migrate:oauth` wrap the Node versions.

## Credentials

`scripts/migrate-oauth.js` cannot fetch secrets — supply them as env vars
(see `.env.example`, management-only section):

- `SUPABASE_ACCESS_TOKEN` — `sbp_...` personal access token (Supabase → Account
  → Access Tokens). Required.
- `<SLUG>_SUPABASE_PROJECT_REF` — per-project Supabase ref (slug uppercased,
  non-alphanumerics → `_`); `SUPABASE_PROJECT_REF` is the fallback for the
  primary app. Same convention as `scripts/preflight-credentials.sh`.
- `GCP_PROJECT` *(optional)* — Console-link project; else read from gcloud. The
  plan links to the project's credentials list (the web client is one click
  away); it does not embed the client id in a logged URL.

Everything is **dry-run by default** and **idempotent**: re-running only adds
what is missing and reports `already done` once the new origin is covered.
