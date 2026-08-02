# B2 / B3 — Secrets runbook (local Supabase + Vercel CLI)

This is the operator recipe for clearing the two env/secret blockers on the `/audit` page:

- **B2 — Rotate `SUPABASE_SERVICE_ROLE_KEY`.** A stale/expired service-role key returns HTTP 401 in
  production, which silently degrades dashboard counts, Created Assets, Brain persistence, and the KB
  to the anon fallback. Rotating restores server-side reads/writes.
- **B3 — Set `KLAVIYO_API_KEY` (read) + a read-only Shopify token.** Without live feeds, real cohort
  sizes, open/click history, and live stock/price are absent, so frequency-safety and confidence run
  on assumptions instead of data.

> These steps require access to the Supabase, Klaviyo, Shopify, and Vercel dashboards for this project.
> The agent cannot execute them (it holds no secrets); this doc is the exact plan to run by hand or in
> CI. Nothing here should ever be committed with real values — only `.env.local` / Vercel env store.

---

## Prerequisites

```bash
npm i -g vercel                 # Vercel CLI
npm i -g supabase               # Supabase CLI (only needed for the local-DB path)
vercel login                    # once per machine
vercel link                     # run in repo root -> links to the knickgasm-lifecycle-os project
```

`vercel link` writes `.vercel/project.json` (git-ignored). Confirm you are on the right project before
touching env vars:

```bash
vercel project ls
vercel env ls                   # lists current env var NAMES (never prints values)
```

---

## B2 — Rotate the Supabase service-role key

### 1. Mint a fresh key

Supabase dashboard -> **Project Settings -> API -> Project API keys -> `service_role` -> Reset**.
(Resetting invalidates the old key immediately, so do steps 2-4 in one sitting.)

The `service_role` key bypasses RLS — it is server-only. It must live **only** in Vercel env (all three
targets) and never in any front-end bundle, `public-config`, or committed file.

### 2. Push it to all three Vercel environments

The app reads `SUPABASE_SERVICE_ROLE_KEY` (with `SMART_BRAIN_SUPABASE_SERVICE_ROLE_KEY` as an accepted
alias — see `api/_shared/brain-core.js`). Set the primary name in Production, Preview, and Development:

```bash
# Reads the value from stdin (no BOM — do NOT pipe via PowerShell echo; see CLAUDE.md bug #7).
printf '%s' 'PASTE_NEW_SERVICE_ROLE_KEY' | vercel env add SUPABASE_SERVICE_ROLE_KEY production
printf '%s' 'PASTE_NEW_SERVICE_ROLE_KEY' | vercel env add SUPABASE_SERVICE_ROLE_KEY preview
printf '%s' 'PASTE_NEW_SERVICE_ROLE_KEY' | vercel env add SUPABASE_SERVICE_ROLE_KEY development
```

If the name already exists, remove it first: `vercel env rm SUPABASE_SERVICE_ROLE_KEY production`.

### 3. Redeploy (env changes only take effect on a new build)

```bash
vercel --prod                   # or: npm run deploy
```

### 4. Verify

```bash
curl -s https://knickgasm-lifecycle-os.anchit-tandon.com/api/health | jq .
# Anonymous health returns liveness only: {ok, build, ts}.
# The DETAILED payload (providers/region/env) and the operator-only pipeline /
# probe modes need an operator bearer token (Supabase access token on an allowed
# domain, or CRON_SECRET). probe spends provider quota - operators only.
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://knickgasm-lifecycle-os.anchit-tandon.com/api/public-config?health=1" | jq .
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://knickgasm-lifecycle-os.anchit-tandon.com/api/public-config?pipeline=1" | jq .
```

A healthy response shows Supabase reachable and no 401. The `/audit` page's Master Dashboard / Created
Assets counts should populate on next load rather than falling back to localStorage.

### Local Supabase path (optional — for testing before you touch prod)

To validate migrations / server reads against a throwaway DB without risking prod:

```bash
supabase start                  # boots local Postgres + studio in Docker
supabase db reset               # applies supabase/migrations/* to the local DB
supabase status                 # prints local URL + local service_role key
```

Point a local run at it:

```bash
# .env.local (git-ignored) — LOCAL values only
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local anon key from `supabase status`>
SUPABASE_SERVICE_ROLE_KEY=<local service_role key from `supabase status`>

vercel dev                      # serverless functions locally against the local DB
```

When done: `supabase stop`. Never copy a local key into Vercel or a prod key into `.env.local`.

---

## B3 — Wire the live read-only feeds

### Klaviyo (read scope)

1. Klaviyo -> **Settings -> API keys -> Create Private API Key**. Grant **read** scopes only
   (Profiles, Segments, Lists, Metrics, Events, Campaigns, Flows — all read). Do not grant write.
2. Push to Vercel:

   ```bash
   printf '%s' 'pk_live_xxx' | vercel env add KLAVIYO_API_KEY production
   printf '%s' 'pk_live_xxx' | vercel env add KLAVIYO_API_KEY preview
   printf '%s' 'pk_live_xxx' | vercel env add KLAVIYO_API_KEY development
   # optional:
   # vercel env add KLAVIYO_PUBLIC_KEY ...   # 6-char public/site id, for client tracking
   # vercel env add KLAVIYO_REVISION ...     # JSON:API date, defaults to a pinned revision
   ```

3. Redeploy, then verify the integration flips from stub to live:

   ```bash
   curl -s "https://knickgasm-lifecycle-os.anchit-tandon.com/api/klaviyo?action=klaviyo&op=status" | jq .
   ```

   Until a key is set, `klaviyo-core.js` returns `{connected:false, would_request:{...}}` stubs — so the
   KicksGPT tool and chat keep working; the key only makes them live. `connected:true` confirms B3-Klaviyo.

### Shopify (read-only storefront/admin token)

This app uses **public storefront scraping** (`/products.json` per region), not an Admin connector — so
no Admin token is strictly required for catalog/price. If you want authenticated read access (real
inventory/stock beyond the public feed), mint a **read-only** token:

- Shopify Admin -> **Settings -> Apps and sales channels -> Develop apps -> Create app** -> Admin API
  scopes: grant only `read_products`, `read_inventory`, `read_orders` as needed. Install -> copy the
  Admin API access token.
- Store it as a Vercel env (do **not** put it in any client bundle). Keep it read-only; this app never
  needs write scopes.

---

## Rollback

- **B2:** if a rotation breaks something, reset the `service_role` key again in Supabase, re-add to the
  three Vercel envs, redeploy. The anon fallback keeps read-only pages alive in the meantime.
- **B3:** remove the key (`vercel env rm KLAVIYO_API_KEY <env>`) and redeploy — the app degrades back to
  the request-stub behaviour with no error.

## Where these are read in code

| Secret | Read in |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `api/kb.js`, `api/_shared/brain-core.js`, `api/_shared/smart-brain-plan.js`, `api/_shared/os-backbone.js` |
| `KLAVIYO_API_KEY` | `api/_shared/klaviyo-core.js` (via `?action=klaviyo`) |
| Shopify (read-only) | public storefront scrape in the `/shopify` skill; no committed token |
