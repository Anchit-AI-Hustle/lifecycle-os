---
name: ship
description: Build and deploy the Lifecycle OS to Vercel.
argument-hint: "[optional: 'prod' to deploy to production]"
---

# Ship

## Before you start — resolve the brand

Run `/brand-context` first (or confirm it has already run this session). Every
fact, product, price, URL, claim, colour and product noun below must come from
the ACTIVE brand's own record, never from tenant zero. A field the brand has not
published is written `[DATA REQUIRED BEFORE LAUNCH: field, product, region]` -
never filled with a plausible value.


Deploy the project. Args: `$ARGUMENTS` (`prod`/`production` → production; otherwise preview).

## Pre-flight (this repo's hard constraints)
- **Function count:** Hobby plan caps Serverless Functions at **12** and the app sits at the limit. If a new `api/*.js` was added, deploy will break — extend a `?action=` router or move logic into `api/_shared/` instead. Check `vercel.json` `functions`.
- `npm run build` runs at deploy (`scripts/build-catalog.js` → catalog JSON). Run it locally first to catch errors.
- New page? Add its rewrite to `vercel.json` `rewrites`.
- Never cache `/api/*` in `sw.js`.

## Method
Use the **`vercel-plugin:deploy`** skill. For env work use `vercel-plugin:env`. Confirm before a production deploy — it's outward-facing.

Report the deployment URL and any build warnings.
