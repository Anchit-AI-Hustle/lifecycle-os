# Publishing & Deliverability Engine

The half of Lifecycle OS that **sends**. Everything else in this repo creates an
asset; this maps one onto the platforms a brand has connected, decides whether
sending it is safe, and dispatches it.

Two briefs produced this — an omnichannel integration/publishing engine and a
reach/deliverability/audience engine. They are built as **one pipeline**, because
a send that lands in spam is not a send: the deliverability gate belongs *in
front of* the dispatcher, not beside it.

```
asset  →  channel_mappings   how this asset becomes a Meta ad / Klaviyo campaign
       →  preflight_audits   domain auth + segment health + spam   → pass|warn|block
       →  dispatch_jobs      queued, with an idempotency key
       →  dispatch_attempts  every try, its error class, its backoff
       →  platform_sync_log  what the platform said
       ←  platform_webhook_events   what it said later, unprompted
```

---

## Deviations from the briefs, and why

The briefs specified a stack this deployment does not have. Each deviation below
is deliberate; the *capability* asked for is delivered in every case.

| Asked for | Built | Why |
|---|---|---|
| TypeScript interfaces | JSDoc typedefs + `adapters/types.d.ts` | The repo is plain CommonJS with **no build step** (`framework: null`). Adding `.ts` means a transpiler in the request path or a second runtime. The declaration file is real TypeScript, checkable with `tsc --noEmit`, and a test fails if it drifts from the JS. |
| Prisma schema | Supabase SQL migration | The repo's persistence is Supabase with timestamped SQL migrations and RLS. Prisma would be a second, unenforced source of truth alongside the policies that actually gate access. |
| BullMQ / Temporal / Celery | Convergent queue on the job row | All three need a worker process that outlives a request. This is Vercel serverless on the Hobby plan — there is nowhere to run one. The repo already solved this twice (`smart-brain-plan.prebuildAssets`, `brand-context-pack`): state on the row, drain a batch, re-fire until empty. |
| React/Tailwind components | Vanilla HTML through `--brand-*` tokens | Every page here is standalone HTML and re-skins per tenant through `theme.css`. A React island would not inherit the brand tokens and would be the only page that needs a build. |
| `POST /api/integrations/connect/:platform` etc. | `?action=`/`?op=` on existing routers | **Hobby caps serverless functions at 12 and this deployment is at 12.** Every module added lives under `api/_shared/`, which Vercel excludes from the count. A test asserts the cap still holds. |

---

## What is real, and what is scaffolding

This is the part worth reading before a first live send.

### Verified against documentation (2026-08-18)

- **Meta** — OAuth dialog `https://www.facebook.com/<ver>/dialog/oauth`, token
  exchange `https://graph.facebook.com/<ver>/oauth/access_token`, scopes
  `ads_management` / `ads_read`. Graph endpoints (`act_<id>/insights`, IG
  `/media` + `/media_publish`, Page `/photos`) were **already called by this
  repo** before this feature.
- **Klaviyo** — authorize `https://www.klaviyo.com/oauth/authorize` with **PKCE
  S256 required**, token `https://a.klaviyo.com/oauth/token` via HTTP Basic and
  a form body, space-separated scopes. Access tokens live **~10 minutes**;
  refresh tokens are revoked after 90 days unused and refresh is capped at 10
  calls/minute.
- **Google Ads** — `googleads.googleapis.com` and `oauth2.googleapis.com/token`
  were already called by this repo; scope `…/auth/adwords`.

### Implemented but NOT verified — confirm before first live use

Marked `verified: false` in each adapter's endpoint table and surfaced in the
Integration Hub as an "N unverified" chip. The docs hosts are unreachable from
the build environment, so these follow each platform's conventions rather than a
page read while writing them:

- **Klaviyo writes** — `create_template`, `create_campaign`, `send_campaign`,
  `assign_template`, `suppress`. (`track_event` **is** verified — the read side
  of `/events/` is already exercised by `klaviyo-core.js`.)
- **Braze, ActiveCampaign, Customer.io** — every path. These refuse to send at
  all until an operator sets `endpoints_confirmed` on the connection.

### Genuinely unavailable

- **Google Ads Transparency Center** has no public API. `searchAdLibrary()`
  returns `{ok:false, searched:false}` with the reason — never an empty array,
  which would read as "this advertiser runs no ads". Meta's `ads_archive` *is*
  real and is implemented.
- **Meta Ad Library** outside the EU covers only social-issue, electoral and
  political ads, and needs an identity-confirmed app. Empty results say so.
- **WebEngage campaign composition** — unverified, so those channels are
  `supported: false`. The **event** path is implemented and is the integration
  shape WebEngage documents for product triggers anyway.
- **Google Postmaster / Microsoft SNDS** need the *domain owner* to enrol and
  grant access. Reported as not-connected rather than filled with a number.

---

## Three switches before anything leaves

A stored credential is permission to **read**. Sending as somebody's brand is a
separate decision, and it takes all three:

1. `LIVE_CONNECTORS=on` — the repo-wide kill switch, off by default.
2. **Per-workspace publishing** — toggled in the Integration Hub, confirmed by a
   dialog, recorded with who turned it on and when.
3. For Klaviyo / Shopify / WebEngage only: `<PLATFORM>_ALLOW_WRITES=1` — these
   three are covered by the standing read-only rule in `read-only-egress.js`,
   and an adapter is not entitled to decide that rule does not apply to it.

Miss any one and the job builds the **exact request** and stops, showing it.

---

## The preflight gate

Five checks. The verdict is the worst status any of them returned.

| Check | Blocks when |
|---|---|
| Credential | not connected, revoked, disabled, or expired with no refresh token |
| Scopes | the grant is missing what this action needs |
| Asset mapping | a required field resolved to a `[DATA REQUIRED BEFORE LAUNCH: …]` marker |
| Domain auth | SPF, DKIM or DMARC actually fails (Google/Yahoo bulk-sender rules make these hard requirements) |
| Blocklist | listed on a list that answered |
| Warmup | today's ramp cap is exceeded, or the ramp is paused |
| Segment health | majority-inactive list, or >3% estimated bounce risk, on a promotional send |
| Frequency | >25% of the audience is already over the cross-channel cap |
| Unsubscribe | bulk promotional email with no unsubscribe link |
| Content | spam signal score ≥10 |

**A check that could not run returns `warn`, never `pass`.** That is the whole
discipline of the file: a gate that silently approves what it could not inspect
converts absence of information into a green light. A block is overridable, and
the override is recorded against the operator's user id with their reason.

---

## Honesty rules that shaped the code

Three specific lies this domain invites, and where each is refused:

**"Not listed"** when a blocklist refused the query. Spamhaus answers a refused
query (public/datacentre resolver) with `127.255.255.x`, which naive code reads
as a listing and lazy code reads as clean. `isRefusalCode()` detects it and
reports `checked: false` with the reason. From serverless egress this is usually
*unavailable*, and it says so.

**"Score 40/F"** when the DNS lookup timed out rather than the record failing.
An `unavailable` record is **excluded from the score's denominator**, so a
correctly configured domain is never marked down for our network trouble — and
never credited for it either. The result carries `coverage_pct` and `partial`.

**"Send at 10am"** with no open history. `optimalSendTime()` returns `null` and
says a time somebody picked from habit is a decision, not an optimisation.

Plus: **audience sizes are never invented** (spec §zero-fabrication) — an empty
contact set returns `computed: false` with a `[DATA REQUIRED BEFORE LAUNCH]`
marker, and the gate turns that into a warning rather than a green light.

---

## Data protection

`subscriber_engagement_scores` stores a **salted SHA-256 hash** plus the ESP's
own profile id — never a raw email address. Both are sufficient for everything
the engine does (suppress, cap, cohort), and neither is a mailing list if the
table leaks. The salt is per-workspace, so one tenant cannot confirm another's
membership by comparing hashes.

This is pseudonymisation, not anonymisation — a known address can still be
confirmed by hashing it — so the table keeps brand RLS and is revoked from
`anon`. It is blast-radius reduction, not a licence to treat the contents as
non-personal data. (Written this way because of the 17 Aug audit, which found
26,677 real customer records committed to a sibling repository.)

---

## Files

```
api/_shared/adapters/
  base-adapter.js      BasePlatformAdapter / AdPlatformAdapter / CrmPlatformAdapter,
                       the publish gate, error classification, redaction
  types.d.ts           the contract as real TypeScript
  registry.js          id → adapter, channel → adapter, the hub's view
  meta-adapter.js      Graph + Marketing + ads_archive
  google-ads-adapter.js  Google Ads mutate; transparency refusal
  klaviyo-adapter.js   templates, campaigns, flows, suppression
  webengage-adapter.js events + users; campaign composition unverified
  extensible-crm.js    Braze / ActiveCampaign / Customer.io hooks

api/_shared/oauth-core.js          handshake, PKCE, refresh, scope validation
api/_shared/dispatch-core.js       enqueue, lease, drain, backoff, webhooks
api/_shared/deliverability-core.js DNS, blocklists, warmup, content
api/_shared/cohort-engine.js       RFM, sunset, segment health, STO, caps
api/_shared/preflight-core.js      the gate

supabase/migrations/20260818140000_dispatch_and_deliverability.sql
publishing.html                    → /publishing (hub, publisher, domain, log)
tests/dispatch-engine.spec.js      19 tests
tests/deliverability-cohorts.spec.js  23 tests
tests/oauth-adapters.spec.js       20 tests
```

## Endpoints

All mounted on existing routers — **no thirteenth serverless function**.

```
/api/public-config?action=connections&op=publish-registry   what can be sent where (public)
                                     &op=oauth-start        begin a handshake
                                     &op=oauth-callback     the redirect target (unauthenticated by necessity)
                                     &op=oauth-disconnect
                                     &op=publishing         the live-publishing switch

/api/brain?action=dispatch-enqueue          preflight, then queue
                 dispatch-drain             run the queue (cron or an editor, own workspace only)
                 dispatch-list | -detail | -cancel
                 dispatch-webhook           platform callbacks (signature-verified)
                 deliverability-domain      full domain audit, persisted
                 deliverability-preflight   the gate, standalone
                 deliverability-warmup      build a ramp / evaluate safety
                 cohort-optimize            RFM, cohorts, sunset proposals
```

## Environment

New, all optional — absent means that platform reports itself unconfigured:

```
META_APP_ID, META_APP_SECRET                          Meta OAuth + webhook signatures
GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET        Google OAuth
GOOGLE_ADS_DEVELOPER_TOKEN                            every Google Ads request
KLAVIYO_OAUTH_CLIENT_ID, KLAVIYO_OAUTH_CLIENT_SECRET  Klaviyo OAuth
CONTACT_HASH_SALT                                     per-deployment salt for contact hashes
LIVE_CONNECTORS=on                                    the kill switch
KLAVIYO_ALLOW_WRITES=1 / WEBENGAGE_ALLOW_WRITES=1     the read-only escape hatch
```

Each platform also needs a **one-time app registration** the operator cannot
self-serve (Meta App Review for `ads_management`, a Google Ads developer token
application, a Klaviyo public app review). `platform_prereq` on each adapter
states exactly what and where, and the hub shows it.
