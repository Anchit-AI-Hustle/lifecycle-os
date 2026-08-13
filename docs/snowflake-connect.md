# Connecting the deployed app to Snowflake (read-only)

The Ads pages can read a Snowflake warehouse directly. In a Claude session that happens through the
per-user Snowflake MCP connector, which does not apply to the deployed app — Vercel needs its own
credentials. Until they are set, every ads endpoint returns an honest `{ connected: false,
would_query }` envelope carrying the exact SQL it would run, so no figure is ever invented.

> **What this document is not.** It is a connection runbook, not a description of a warehouse. An
> earlier version of this file enumerated a specific Snowflake account, a specific database and a
> registry of ad accounts with their spend, ROAS and retail sell-through — none of which were this
> brand's. They came in with the code when this repo was copied from a sibling lifecycle-OS project
> built for a different company, and the rebrand renamed the company without touching the accounts,
> the pipeline tables or the retail channels underneath it. KNICKGASM sells hand-painted custom
> sneakers through knickgasm.com; it does not run a mass-retail media programme, and no figure from
> that other business belongs in this repo. Everything account-specific below is therefore a value
> **you fill in for your own deployment**.

## 1. Connection values

Read these from your own Snowflake session (`SELECT CURRENT_ORGANIZATION_NAME(),
CURRENT_ACCOUNT_NAME(), CURRENT_USER(), CURRENT_WAREHOUSE(), CURRENT_DATABASE();`) and set them in
Vercel.

| Vercel env var | Value | Where it comes from |
|---|---|---|
| `SNOWFLAKE_ACCOUNT` | `[DATA REQUIRED BEFORE LAUNCH: Snowflake ORG-ACCOUNT identifier]` | `CURRENT_ORGANIZATION_NAME()` + `-` + `CURRENT_ACCOUNT_NAME()` |
| `SNOWFLAKE_USER` | `[DATA REQUIRED BEFORE LAUNCH: Snowflake service user]` | `CURRENT_USER()`, or a dedicated app user |
| `SNOWFLAKE_WAREHOUSE` | `[DATA REQUIRED BEFORE LAUNCH: warehouse]` | `CURRENT_WAREHOUSE()` |
| `SNOWFLAKE_DATABASE` | `[DATA REQUIRED BEFORE LAUNCH: database holding the ad tables]` | `CURRENT_DATABASE()` |
| `SNOWFLAKE_ROLE` | a read-only role you create (step 2) | — |
| `SNOWFLAKE_PAT` | *(secret — you generate it in step 2)* | — |
| `LIVE_CONNECTORS` | `on` | required; with it off the app never opens an outbound connection and the ads panels stay empty (there is no bundled snapshot to fall back to) |

Two identifier gotchas, both generic to Snowflake:

> **Do not use the account locator.** `<LOCATOR>.snowflakecomputing.com` returns **404** for the SQL
> API v2 statements endpoint — only the `ORG-ACCOUNT` form works. A **401** from the `ORG-ACCOUNT`
> host means the host is right and the token is wrong, which is a useful thing to be able to tell
> apart.

## 2. Create a read-only role and a PAT (run in Snowsight)

The app issues only `SELECT` / `SHOW` / `INFORMATION_SCHEMA` reads and refuses anything else in code
(`WRITE_RE` in `api/_shared/ads-snowflake-core.js`), but the grant should be read-only as well.

```sql
-- Substitute <APP_ROLE>, <WAREHOUSE>, <DATABASE>, <APP_USER>.
CREATE ROLE IF NOT EXISTS <APP_ROLE>;
GRANT USAGE ON WAREHOUSE <WAREHOUSE> TO ROLE <APP_ROLE>;

GRANT USAGE  ON DATABASE <DATABASE>                     TO ROLE <APP_ROLE>;
GRANT USAGE  ON ALL SCHEMAS    IN DATABASE <DATABASE>   TO ROLE <APP_ROLE>;
GRANT USAGE  ON FUTURE SCHEMAS IN DATABASE <DATABASE>   TO ROLE <APP_ROLE>;
GRANT SELECT ON ALL TABLES     IN DATABASE <DATABASE>   TO ROLE <APP_ROLE>;
GRANT SELECT ON FUTURE TABLES  IN DATABASE <DATABASE>   TO ROLE <APP_ROLE>;
GRANT SELECT ON ALL VIEWS      IN DATABASE <DATABASE>   TO ROLE <APP_ROLE>;
GRANT SELECT ON FUTURE VIEWS   IN DATABASE <DATABASE>   TO ROLE <APP_ROLE>;

-- Repeat the four DATABASE grants for any additional database your pipelines load into.

GRANT ROLE <APP_ROLE> TO USER <APP_USER>;

-- The token. Snowflake prints the secret ONCE — copy it straight into Vercel.
ALTER USER <APP_USER> ADD PROGRAMMATIC ACCESS TOKEN LIFECYCLE_OS_READONLY
  ROLE_RESTRICTION = '<APP_ROLE>'
  DAYS_TO_EXPIRY   = 90
  COMMENT          = 'lifecycle-os read-only ads dashboard';
```

If Snowflake refuses the token, the account usually requires a **network policy** before PATs are
allowed. Attach one to the user (or account) and retry — that is a Snowflake account setting, not an
app change.

## 3. Set the variables in Vercel

Project **lifecycle-os** → Settings → Environment Variables (Production *and* Preview), using the
values from step 1 plus the PAT from step 2, and `LIVE_CONNECTORS=on`. Then redeploy — env changes do
not apply to existing deployments.

⚠️ On Windows, pipe secrets with `cmd /c "type file | vercel env add"` — PowerShell `echo` prepends a
UTF-8 BOM and the token will fail auth (see CLAUDE.md, Common Bugs #7).

## 4. Point it at your tables

Credentials alone read nothing. Each source table is named by its own env var, and **there are no
defaults**: an unset feed simply does not exist, `sources()` reports it as `null`, and the endpoint
returns a `{ no_sources: true }` envelope naming the variable to set.

That is deliberate. `sources()` in `api/_shared/ads-snowflake-core.js` used to carry a full set of
"starting guess" table names, and they were not a guess — they were the other company's warehouse
layout, with the brand token in the database name rewritten by the rebrand and the loader schemas
and table names left intact. A wrong default is worse than no default, because a wrong default
renders.

| Env var | What it should name |
|---|---|
| `SF_META_ADS_TABLE` | the Meta ad-insights table (spend, impressions, clicks, link clicks, by day) |
| `SF_META_AGE_GENDER_TABLE` | Meta age × gender delivery breakdown (Cohorts tab) |
| `SF_META_DEVICE_TABLE` | Meta platform / device delivery breakdown (Cohorts tab) |
| `SF_META_CREATIVES_TABLE` | Meta ad creatives |
| `SF_GOOGLE_ADS_TABLE`, `SF_GOOGLE_ADGROUP_AD_TABLE` | Google Ads performance reports |
| `SF_TIKTOK_{ADS,CAMPAIGN,ADGROUP,AD,AGE_GENDER,COUNTRY}_TABLE` | the TikTok reports, per level |

A value of the form `SCHEMA.TABLE` is prefixed with `SNOWFLAKE_DATABASE`; a three-part
`DB.SCHEMA.TABLE` is used as given. The Streamlit-in-Snowflake app in `snowflake/streamlit/` reads
the same variable names and, where one is unset, discovers the table by name against
`INFORMATION_SCHEMA` in the session's current database.

Column names are resolved per PLATFORM (Meta's bare upper-case identifiers, Google's dotted
lower-case GAQL fields with cost in micros, TikTok's report columns), and every live query
re-resolves them from `INFORMATION_SCHEMA`, so a loader that names things differently is detected
rather than assumed.

**Meta conversions and revenue.** Meta returns purchases and revenue as nested `actions` /
`action_values` arrays, and an Airbyte-normalised load unnests them into sibling tables
`<STREAM>_ACTIONS` and `<STREAM>_ACTION_VALUES`, joined on `_AIRBYTE_<STREAM>_HASHID`. Set
`SF_META_ACTION_TABLES=on` if your load follows that convention (optionally `SF_META_ACTION_TYPE`,
default `purchase`). Without it the base table is read on its own and conversions and revenue come
back **`null`, meaning "not tracked here" — never `0`**.

Optional, all unset by default and none guessed: `ADS_DAILY_BUDGET_CAP` (+ `ADS_BUDGET_CURRENCY`)
for spend pacing, `ADS_REPORT_TZ` for the account's reporting timezone (defaults to `UTC`),
`ADS_LIVE_ACCOUNTS` to narrow which feeds the live view unions, and `ADS_SOP_TOKENS` (a JSON object
of name-field → permitted values) for naming compliance.

## 5. Verify (in this order)

| Check | Expected |
|---|---|
| `/api/brain?action=ads-snowflake&op=ping` | `reachable: true`, a `latency_ms`, and your own `account_host` |
| `/api/brain?action=ads-snowflake&op=status` | `configured: true` **and** `has_sources: true` |
| `/api/brain?action=ads-live&op=status` | `snowflake.configured: true`, `snowflake.has_sources: true` |
| `/api/brain?action=ads-live&op=today` | `source: "snowflake"`, today's partial-day rows |
| `/ads-dashboard` → **Source & connection** | green `reachable` chip; each configured feed shows its table, each unset one shows `not set` beside the variable that would name it |
| `/ads-dashboard` → **Naming compliance** | a real compliance rate and spend-at-risk instead of the not-reachable notice |

Failure modes the ping distinguishes for you: `not connected` (vars missing, it names which),
`unreachable` + HTTP 401/403 (bad or expired PAT, or the role cannot use the warehouse), and
`unreachable` + other (wrong account identifier or network). A separate `no_sources: true` response
means the credentials are fine but no ad table has been named yet — see step 4.

## 6. Reading the numbers once it is live

Two rules survive from the original notes because they are about measurement, not about any
particular advertiser:

1. **Accounts are not comparable on one KPI.** Where a pixel or a Google conversion is tracked,
   revenue / ROAS / CPA are real. Where the checkout happens somewhere the ad cannot be attributed
   to, no purchase can ever be recorded, so those accounts must return `null` rather than `0` and be
   judged on CTR, CPC, CPM and reach. A 0.00x ROAS on such an account is a measurement artefact, not
   a result — ranking on ROAS would report every one of those campaigns as a total failure.
2. **Never sum across currencies.** A feed reporting GBP or INR cannot be added to a USD feed, and a
   dashboard that does it produces a number that is wrong in a way nobody can see.

And one parsing trap worth keeping: CSV-loaded feeds (Airbyte and similar) often carry **two date
formats in one column** — `DD-MM-YYYY` on older rows and `DD-MM-YYYY H:MI` on newer ones — and money
as text with a currency symbol and thousands separators. Parsing only the bare date form silently
drops the newest rows and makes a live feed look stale. Split on the space before parsing
(`try_to_date(split_part(col,' ',1),'DD-MM-YYYY')`), and strip `$` and `,` before casting a money
column to a number.

## 6b. Scope: this is a DEPLOYMENT connection, not a workspace one

There is no per-workspace Snowflake credential in `workspace-connections-core.js`, so anything read
here belongs to whoever runs the deployment, not to the brand signed in. Every payload therefore
carries `data_scope: { level: 'deployment' }`, and `/ads-dashboard` renders that statement above the
figures rather than leaving a reader to assume they are their own.

A **workspace's own** paid media comes from the ad accounts it connected under `/connections`
(Meta Ads, Google Ads, TikTok Ads) and is reported at `/data-analysis?tab=live-ads`, via
`api/_shared/ad-insights-core.js`. That is the per-brand path. This one is the warehouse drill-down,
and until a deployment names its own tables it shows nothing at all.

## 7. Security note

Use the PAT above, never a personal account password, and keep access per-user so a token can be
revoked without locking anyone else out. If a credential is ever shared in plain text — in an email
thread, a ticket or a chat — rotate it rather than relying on the thread being private.
