# Workload Identity Federation — Vercel ↔ Google Cloud

Goal: remove the static `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` env var entirely.
Vercel mints a short-lived OIDC token per request, Google STS exchanges it for
an impersonation token of your service account. **No keys to rotate, nothing
that can be "deleted" by Google's expiry policies, nothing leaked.**

If a teammate ever deletes the SA again, you re-grant federation access in 2 min
— no JSON file to safeguard.

---

## One-time GCP setup (~10 minutes)

Run from your local machine where `gcloud` is authenticated to the
`knickgasm-lifecycle-os` project.

```bash
# Variables you need
export PROJECT_ID="knickgasm-lifecycle-os"
export PROJECT_NUMBER="$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')"
export POOL_ID="vercel-pool"
export PROVIDER_ID="vercel-provider"
export SA_NAME="lifecycle-os-bot"
export VERCEL_TEAM_SLUG="anchittandon-3589s-projects"   # your team slug
export VERCEL_PROJECT="knickgasm-lifecycle-os"             # this project's slug
```

### 1. Enable the APIs

```bash
gcloud services enable \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  iam.googleapis.com \
  sheets.googleapis.com \
  --project $PROJECT_ID
```

### 2. Create (or re-use) the service account

```bash
gcloud iam service-accounts create $SA_NAME \
  --display-name="Lifecycle OS — Sheets" \
  --project $PROJECT_ID

# Capture the email for later
export SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
```

> Note: this SA gets impersonated by federation. We **never create a key for it**.
> That's the whole point — there's no key file anywhere.

### 3. Create the Workload Identity Pool + Provider

```bash
# Pool — a container for external identity providers
gcloud iam workload-identity-pools create $POOL_ID \
  --location=global \
  --display-name="Vercel deployments" \
  --project $PROJECT_ID

# Provider — describes the issuer (Vercel's OIDC endpoint) + how to map claims
gcloud iam workload-identity-pools providers create-oidc $PROVIDER_ID \
  --location=global \
  --workload-identity-pool=$POOL_ID \
  --issuer-uri="https://oidc.vercel.com/${VERCEL_TEAM_SLUG}" \
  --allowed-audiences="https://vercel.com/${VERCEL_TEAM_SLUG}" \
  --attribute-mapping="google.subject=assertion.sub,attribute.aud=assertion.aud,attribute.project=assertion.project,attribute.environment=assertion.environment" \
  --attribute-condition="assertion.project=='${VERCEL_PROJECT}'" \
  --project $PROJECT_ID
```

> The `attribute-condition` is a hard guardrail: only OIDC tokens whose
> `project` claim matches `knickgasm-lifecycle-os` can use this provider.
> A token from a different Vercel project on the same team gets rejected.

### 4. Bind the SA so federation principals can impersonate it

```bash
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.project/${VERCEL_PROJECT}" \
  --project $PROJECT_ID
```

This says: *"any workload from Vercel project `knickgasm-lifecycle-os` can call
generateAccessToken on this service account."* That's the federation grant.

### 5. Share the Google Sheet with the SA

In the Google Sheet → Share → add `lifecycle-os-bot@knickgasm-lifecycle-os.iam.gserviceaccount.com`
as **Editor**. (Same step as before — only the auth mechanism changes, not the
sheet's permission model.)

### 6. Print the full provider name (paste into Vercel env in next step)

```bash
echo "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
# → projects/123456789012/locations/global/workloadIdentityPools/vercel-pool/providers/vercel-provider
```

---

## Vercel setup (~3 minutes)

### 1. Enable OIDC tokens for this project

Vercel Dashboard → **Project Settings → OIDC Tokens** → enable. This injects
`VERCEL_OIDC_TOKEN` into every server function's environment automatically.

### 2. Add the two new env vars

```bash
# Both keys are PUBLIC config — safe to commit (but Vercel env is fine too)
vercel env add GCP_WORKLOAD_IDENTITY_PROVIDER production
# Paste: projects/123456789012/locations/global/workloadIdentityPools/vercel-pool/providers/vercel-provider

vercel env add GCP_SERVICE_ACCOUNT_EMAIL production
# Paste: lifecycle-os-bot@knickgasm-lifecycle-os.iam.gserviceaccount.com
```

### 3. Remove the old key-based env vars (after WIF is confirmed working)

Do NOT delete these yet — the code falls back to JWT if WIF env vars are
absent, so leaving both during the cutover means zero downtime.

After you've confirmed `/api/competitor?action=list` returns data on the
WIF-only deployment, then:

```bash
vercel env rm GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY production
# Keep GOOGLE_SERVICE_ACCOUNT_EMAIL — harmless, the WIF path ignores it.
```

### 4. Deploy

```bash
vercel --prod
```

---

## How to verify it's actually using WIF

After the first deploy with the new env vars:

```bash
curl -s "https://knickgasm-lifecycle-os-anchittandon-3589s-projects.vercel.app/api/competitor?action=list" \
  | jq '.emails | length'
# Should return your row count, not 0 / error.
```

Then check Vercel runtime logs for the `sts.googleapis.com` and
`iamcredentials.googleapis.com` outbound calls (one pair per cold-start, then
cached for ~58 min).

---

## What this gives you long-term

| Problem with the old setup | How WIF removes it |
|---|---|
| A teammate / org policy / automation deletes the SA → API returns 500 forever | The SA can still be deleted, but **recreating it** doesn't require touching Vercel env or rotating any key. Just re-run step 4 above. |
| Keys silently expire if an org policy enforces 90-day rotation | There are no keys. The policy can't bite you. |
| JSON key leaks through a build log / git mistake | There's no JSON key file. The OIDC token leaks only the *short-lived* federation grant for one request. |
| Local laptop has prod keys lying around | You never download a key. Local dev runs against a Google ADC user account or a separate dev SA. |

The migration is **fully backward-compatible** — the code prefers WIF when its
env vars are set, falls back to the legacy JWT path otherwise. Switch when
you're ready. Roll back by deleting the two WIF env vars and re-adding the
private key.
