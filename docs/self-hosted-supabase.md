# Self-hosted Supabase for Lifecycle OS

**What this is.** A one-command replacement for the hosted Supabase project, using
the same open-source services Supabase itself runs (Apache-2.0): Postgres,
PostgREST, GoTrue (auth), Storage API, Realtime, postgres-meta and Studio behind a
Kong gateway. The app keeps every one of its 77 PostgREST call sites, 195 RLS
policies (74 `is_brand_member`), 21 SQL functions, 20 Storage references and 5
Realtime references **unchanged**, because the protocol is identical: change
three environment variables on Vercel and the app talks to your box instead.

**Why not something else.** Only self-hosted Supabase keeps `auth.uid()`-based RLS,
PostgREST's URL grammar, `/storage/v1` and `/realtime/v1` working with zero app
changes. Neon on its own is only the Postgres piece (no PostgREST, no GoTrue, no
Storage, no Realtime) — which is exactly why it fits as the *database underneath*
these services, see [Path B](#path-b-neon--services-on-a-small-box). A document
store is not an option: this codebase is relational SQL end to end and a rewrite
of the data and authorization layer is not what "replace the hosting" means.

Everything lives in `selfhost/` and `scripts/selfhost-*`. Nothing in `api/` or the
pages changed for this beyond the hardcode sweep in the last section.

---

## Two paths, side by side

| | **A. Everything on one box** | **B. Neon + the services on a small box** |
|---|---|---|
| What runs where | Postgres + all services in one compose (`DB_MODE=local`) | Postgres on Neon (free managed); PostgREST/GoTrue/Storage/Realtime/Kong/Studio/meta in the compose (`DB_MODE=external`) |
| RAM you need | **~4 GB** for the full compose (Supabase's own stated minimum; Studio + Realtime + Postgres are the heavy three). 2 GB works without Studio and Realtime. | **~1–2 GB**: no Postgres process on the box. |
| Data safety | **You** run `pg_dump` (cron line below). Disk failure = data loss without it. | Neon keeps the data, with 6 h of instant restore history and 1 manual snapshot on Free. Scheduled backups are NOT on the Free plan. |
| Cold starts | None. | Neon Free suspends compute after **5 minutes idle, fixed** — the first query after that pays a wake-up (typically hundreds of ms to a few seconds). Every service holds a pool, so the whole stack feels it. |
| Free-tier limits | Oracle Always Free is genuinely free with no expiry, but capacity in popular regions is scarce. | Neon Free: 100 CU-hours/project/month, **0.5 GB storage/project**, 5 GB egress/month, 10 branches, 100 projects. Exceeding storage makes writes fail (nothing is deleted). |
| Role separation | Upstream's roles (`supabase_auth_admin`, `supabase_storage_admin`, superuser `supabase_admin`). | One owner role for every service. Neon has **no superuser**; SQL-created roles cannot get `REPLICATION`, `BYPASSRLS` or `SUPERUSER`. |
| `service_role` bypasses RLS | Yes (image creates it with `bypassrls`). | **Probably not** — Postgres only lets a superuser create a `bypassrls` role. The bootstrap tries, falls back, and warns; `selfhost-check.js` reports it. See [service_role on a managed Postgres](#service_role-on-a-managed-postgres). |
| Realtime | Works. | **Confirm on your Neon project.** Neon supports logical replication (below), but Realtime's own README says its migrations need a superuser, and its self-host seed hardcodes a non-TLS CDC connection. Expect to run without it: the app degrades gracefully (below). |
| TLS to the database | n/a (loopback) | Required: every connection string carries `sslmode=require`. |
| Verified here | Structure only (see [What was and was not tested](#what-was-and-was-not-tested)). | Structure only; no Neon project was reachable from where this was written. |

**Recommendation: Path A on an Oracle Cloud Always Free ARM instance** (4 OCPU /
24 GB RAM is free, far more than the 4 GB needed), with the `pg_dump` cron below
and the dump copied off the box. It is the only configuration in which every
feature — including Realtime and the service-role bypass — behaves exactly as on
hosted Supabase, and it was possible to validate its wiring end to end against
upstream's own files. Choose Path B when you cannot get an ARM instance (capacity
is region-dependent) or you would rather not own backups; accept the cold starts,
the 0.5 GB cap and a Realtime that you must confirm yourself, and read the
`service_role` section before relying on any server-side path.

---

## Where to host

- **Oracle Cloud Always Free** — VM.Standard.A1.Flex, up to 4 OCPUs / 24 GB RAM,
  200 GB block storage, no time limit. The genuinely free option with enough RAM.
  Caveats: "Out of capacity" errors in busy regions (retry, or pick a less popular
  home region at sign-up); the account needs a card for identity; idle Always Free
  instances on the *trial-converted* tier can be reclaimed — keep it busy and
  upgrade to Pay-As-You-Go (still $0 for Always Free shapes) to avoid that.
- **Hetzner CX22** (2 vCPU / 4 GB RAM / 40 GB) — the cheap non-free option, about
  EUR 4/month, exactly at the 4 GB minimum. Works for Path A with Studio; drop
  Studio if memory is tight (`docker compose stop studio meta`).
- Path B needs only a 1–2 GB box: the smallest Hetzner (CX22 is still the
  smallest x86) or Oracle's 1 GB AMD micro instance (also Always Free) is enough.

RAM stated honestly: Supabase's self-hosting doc puts the **minimum at 4 GB and
recommends 8 GB** for the full upstream compose. This kit drops Logflare, Vector,
edge-runtime, Supavisor and imgproxy, which is where most of that headroom went;
measured needs are Postgres (~300 MB idle, grows with cache), Realtime (~250 MB),
Studio (~300 MB), the rest under 100 MB each.

---

## Install (both paths)

```bash
# 0. on the box: Docker Engine + compose plugin (Ubuntu/Debian; ARM is fine)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # then log out/in
sudo apt-get install -y git nodejs npm postgresql-client   # node >= 20; psql is optional

# 1. the repo (only selfhost/, scripts/ and supabase/ are used on the box)
git clone https://github.com/anchittandon-create/KNICKGASM lifecycle-os && cd lifecycle-os

# 2. configuration
cp selfhost/.env.example selfhost/.env
node scripts/selfhost-keys.js --write      # JWT_SECRET + ANON_KEY + SERVICE_ROLE_KEY + every other secret
$EDITOR selfhost/.env                      # the lines marked EDIT: URLs, DB_MODE, Google client
```

`selfhost-keys.js` is the part people get wrong, so it is explicit: `ANON_KEY` and
`SERVICE_ROLE_KEY` are **JWTs signed with `JWT_SECRET`** (HS256), payload
`{"role":"anon"|"service_role","iss":"supabase","iat":<now>,"exp":<now+5y>}` —
byte-for-byte the claims upstream's `generate-keys.sh` emits. PostgREST reads `role`
to `SET ROLE`, GoTrue treats `service_role` as admin, Kong matches the literal key
string to its consumer list. `node scripts/selfhost-keys.js --decode <jwt>` shows a
token's claims and whether the current secret signs it.

### Path A: everything on one box

```bash
# selfhost/.env: DB_MODE=local (default), POSTGRES_HOST=db, POSTGRES_SSLMODE=disable
scripts/selfhost-up.sh                  # = docker compose --profile local-db up -d
scripts/selfhost-migrate.sh             # waits for storage/auth to create their tables,
                                        # then supabase/migrations/*.sql in timestamp order, then seeds
node scripts/selfhost-buckets.js        # the six Storage buckets the app uses
node scripts/selfhost-check.js          # PASS/FAIL per check
```

### Path B: Neon + services on a small box

1. Create a Neon project. Copy the connection string: it gives `POSTGRES_HOST`
   (`ep-….neon.tech`), `POSTGRES_USER` (e.g. `neondb_owner`), `POSTGRES_PASSWORD`,
   `POSTGRES_DB`. Use a role created in the **Neon Console** (the default one is),
   not one created with SQL — only console/API-created roles are members of
   `neon_superuser`, which carries `CREATEROLE`, `CREATEDB`, `BYPASSRLS` and
   `REPLICATION`. The services all log in as this role.
2. If you want to try Realtime: **Project settings → Logical Replication → Enable**
   (permanent; restarts compute). Verify with `SHOW wal_level;` → `logical`.
3. `selfhost/.env`:
   ```
   DB_MODE=external
   POSTGRES_HOST=ep-….aws.neon.tech   POSTGRES_USER=neondb_owner   POSTGRES_PASSWORD=…
   POSTGRES_SSLMODE=require           REALTIME_DB_SSL=true
   AUTH_DB_USER=neondb_owner  STORAGE_DB_USER=neondb_owner  REALTIME_DB_USER=neondb_owner
   META_DB_USER=neondb_owner  STUDIO_DB_USER=neondb_owner   STORAGE_DB_SUPER_USER=neondb_owner
   STORAGE_DB_INSTALL_ROLES=false
   ```
   `scripts/selfhost-up.sh` refuses to start if any of these contradict `DB_MODE`
   (the services would otherwise crash-loop with a far worse message).
4. ```bash
   scripts/selfhost-migrate.sh --bootstrap   # scripts/selfhost-bootstrap-db.sql: roles, schemas,
                                             # auth.uid() & co., the publication — BEFORE anything else
   scripts/selfhost-up.sh                    # = docker compose up -d   (no db container)
   scripts/selfhost-migrate.sh               # the app's migrations + seeds
   node scripts/selfhost-buckets.js
   node scripts/selfhost-check.js            # prints "mode: external — POSTGRES_HOST=… sslmode=require"
   ```

What the bootstrap creates, and what it cannot, is written at the top and bottom of
`scripts/selfhost-bootstrap-db.sql`. Neon's compatibility notes, read from Neon's
own docs source: `pgcrypto`, `uuid-ossp`, `pgjwt` and `pg_graphql` are supported
extensions; `pg_net`, `pgsodium` and `supabase_vault` are not (nothing in this
app uses them); `pg_cron` needs enabling and only runs while compute is awake.

---

## Switching the app over (the actual cutover)

Three Vercel environment variables, Production (+ Preview if you use it), then a
redeploy:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `SUPABASE_PUBLIC_URL` from `selfhost/.env`, e.g. `https://db.example.org` |
| `SUPABASE_ANON_KEY` | `ANON_KEY` from `selfhost/.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` from `selfhost/.env` |

`node scripts/selfhost-keys.js --write` prints these three at the end. Everything
else the app derives from `SUPABASE_URL`: `/rest/v1`, `/auth/v1` (`auth.js`
probes `<SUPABASE_URL>/auth/v1/health`), `/storage/v1` (`api/_shared/supa.js`,
`webengage-core.js`, the Studio and KB pages), `/realtime/v1` (supabase-js builds
the WebSocket URL from the client's base URL; `credits.js` and
`reports/dashboard.html` go through that client). Verified by
`tests/self-hosted-supabase.spec.js`, which boots `auth.js` against
`https://db.example.org` and records every request.

`SMART_BRAIN_SUPABASE_URL` / `SMART_BRAIN_SUPABASE_KEY` are optional overrides for a
*separate* Smart Brain project; leave them unset so the brain uses the same box.

### Google sign-in

`auth.js` signs in with `supabase.auth.signInWithOAuth({ provider: 'google' })`, so
the flow is browser → **your** GoTrue → Google → **your** GoTrue callback → back to
`redirectTo`. Two things change from the hosted setup described in
`docs/oauth-redirect-migration.md` (which is about *domain* moves and still holds
for the app side):

1. **Google Cloud Console → OAuth client (Web application) → Authorized redirect
   URIs** — the hosted value was `https://<ref>.supabase.co/auth/v1/callback`; it
   becomes **`https://<your-host>/auth/v1/callback`** (GoTrue registers
   `${API_EXTERNAL_URL}/callback`, and `API_EXTERNAL_URL` is
   `SUPABASE_PUBLIC_URL + /auth/v1`). Add the new one; keep the old while both run.
   This is Console-only — there is no API for a Web-application client's redirect
   URIs, as that doc records.
2. **The Supabase redirect allowlist** is now `SITE_URL` + `ADDITIONAL_REDIRECT_URLS`
   in `selfhost/.env` (`https://lifecycle-os.anchit-tandon.com/**`), instead of the
   Management-API call `scripts/migrate-oauth.js` makes. That script targets hosted
   projects only; it is not needed here.

Put the client id/secret in `GOOGLE_CLIENT_ID` / `GOOGLE_SECRET`, keep
`GOOGLE_ENABLED=true`, restart `auth`. Google refuses `http://` redirect URIs on
non-localhost hosts, so TLS is a prerequisite, not a nicety.

### TLS: Caddy in front (one block)

```bash
# selfhost/.env: PROXY_DOMAIN=db.example.org  (DNS A/AAAA record → this box; ports 80/443 open)
scripts/selfhost-up.sh --caddy            # layers docker-compose.caddy.yml
```

`selfhost/volumes/proxy/Caddyfile` is the entire configuration:

```
{$PROXY_DOMAIN} {
	encode zstd gzip
	reverse_proxy kong:8000
}
```

Caddy obtains and renews the Let's Encrypt certificate, proxies WebSockets, and
Kong's host ports are withdrawn so the only way in is via 443. Set
`SUPABASE_PUBLIC_URL=https://db.example.org` and `API_EXTERNAL_URL=https://db.example.org/auth/v1`.

### Backups (Path A — you run them)

```
# /etc/cron.d/lifecycle-pgdump — nightly, keep 14 days; copy the dumps OFF the box
15 3 * * * root docker exec supabase-db pg_dump -U postgres -Fc postgres > /var/backups/lifecycle-$(date +\%F).dump && find /var/backups -name 'lifecycle-*.dump' -mtime +14 -delete
```

Storage objects live in the `storage-data` volume (`docker volume inspect
lifecycle-selfhost_storage-data`), not in Postgres; back that directory up too.
Restore: `docker exec -i supabase-db pg_restore -U postgres -d postgres --clean --if-exists < file.dump`.

---

## What each script does

| | |
|---|---|
| `selfhost/docker-compose.yml` | The compose. Images pinned to the set upstream shipped together on 2026-09-15 (`supabase/postgres:17.6.1.136`, `postgrest/postgrest:v14.17`, `supabase/gotrue:v2.196.0`, `supabase/realtime:v2.134.10`, `supabase/storage-api:v1.74.0`, `supabase/postgres-meta:v0.99.0`, `supabase/studio:2026.09.07-sha-7996410`, `kong:2.8.1`). `db` sits behind the `local-db` profile; every other service's `depends_on: db` is `required: false`, which is what lets one file serve both modes. |
| `selfhost/.env.example` | Every variable the compose references, commented. A test fails if the two drift. |
| `scripts/selfhost-keys.js` | The secrets, from one JWT secret (above). |
| `scripts/selfhost-up.sh` | Mode-aware `docker compose`: adds `--profile local-db` for local, refuses an inconsistent `.env`. |
| `scripts/selfhost-migrate.sh` | External mode: the bootstrap first. Then waits for `storage.buckets` and `auth.users` (storage-api and GoTrue create their own tables at boot; the app's migrations reference both), then `supabase/migrations/*.sql` in **timestamp order**, then `supabase/seed/*.sql`. Each file once, recorded with its sha256 in `selfhost.applied_files`, each in one transaction with its ledger row. `--list` prints the plan. |
| `scripts/selfhost-bootstrap-db.sql` | What the `supabase/postgres` image's init scripts do, rewritten to run as a non-superuser and fully guarded. |
| `scripts/selfhost-buckets.js` | Creates/updates `mailer-assets`, `knowledge-base`, `smart-brain-creatives`, `brand-review-media`, `ci-captures`, `webengage-dumps` with the public/private setting the code or migration implies. |
| `scripts/selfhost-check.js` | PASS/FAIL: mode, `/auth/v1/health`, `/rest/v1/` with the anon key, a service-role select, RLS on (`[]` for anon AND `pg_class.relrowsecurity`), `service_role` bypassrls, a Realtime WebSocket heartbeat plus `wal_level`/publication, the bucket list. Structural checks go through postgres-meta (`/pg/query`), so no psql is needed. |

**Migration order.** The files carry two prefix shapes, `20260429120000_` (14
digits) and `20260527_` (8 digits, midnight implied). Plain name order sorts
`20260719_ci_subscriptions.sql` *after* `20260719140000_…` because `_` sorts above
digits; timestamp order puts it first. The kit pads short prefixes to 14 digits.
(Checked: nothing in that day's three files depends on the other two, so both
orders apply cleanly; the timestamp order is simply the one the names mean.)

**`COMBINED_RUN_THIS.sql` drifts and is not used.** Measured on 2026-09-15: it
represents 8 of the 58 migrations (54 KB of 388 KB) — the original two-table
Mailer Studio schema plus the seven `202608091*` files appended to it. The
individual files are the truth; a test pins that the bundle has not quietly
become complete. `supabase/APPLY_*.sql` are older one-off bundles of the same kind.

**Why not the Supabase CLI's `schema_migrations`?** Its key is the numeric prefix
alone, and this repo uses `20260609`, `20260610` and `20260703` twice each. The
ledger is keyed by file name instead.

---

## Realtime: what the app uses it for, and what degrades without it

Five references, all optional at runtime:

| Where | What | Without Realtime |
|---|---|---|
| `credits.js` (`subscribeRealtime`) | `postgres_changes` on `public.credit_wallets` for the signed-in user — the **live credit balance** pill updates the moment a run debits credits | Falls back by design: `refresh()` after every API call plus a 60-second poll (`setInterval` guarded by `realtimeUp`). Balance is at most 60 s stale. |
| `reports/dashboard.html` | `postgres_changes` on five `dtc.*` fact tables and `sync_log` — the DTC data-engine report re-pulls a section when its table changes | Its own 5-minute `refreshAll()` and 30-second `loadLastSync()` timers keep it current. |
| `supabase/migrations/20260527_init_lifecycle_os.sql` | `alter publication supabase_realtime add table lifecycle.*` (6 tables) | Needs the publication to EXIST (the bootstrap creates it empty); harmless without a Realtime consumer. |
| `supabase/migrations/20260621000000_dtc_data_engine_schema.sql` | Guarded `add table dtc.*` to the same publication | Same. |
| `supabase/migrations/20260609_smart_brain.sql` and neighbours | Comments describing live updates | n/a |

Nothing else subscribes: the Smart Brain console, the calendar and every dashboard
poll their `/api/*` routes.

**Neon and logical replication, from Neon's own docs (read 2026-09-15):** logical
replication is available and enabled per project (Console → Settings → Logical
Replication → Enable; also via CLI/API). It changes `wal_level` to `logical`
permanently and restarts all computes. Limits: `max_replication_slots` and
`max_wal_senders` are 10; **inactive replication slots are removed after ~40
hours** (a stopped Realtime for two days loses its slot; Realtime recreates it on
the next start); branch restores drop all slots. The plan comparison lists no
Free-plan exclusion for it, and the docs say egress via logical replication counts
against the 5 GB/month transfer allowance — so I read it as available on Free,
**but confirm on your project** (the page does not say "Free" in as many words).
`REPLICATION` is carried by `neon_superuser` membership; SQL-created roles cannot
receive it, which is why `REALTIME_DB_USER` must be your console-created role.

**Why Realtime is "confirm", not "works", in external mode** — three facts that were
verifiable from source, none of which a Neon project was available to try:
1. Realtime's README (Postgres compatibility table) states, for Postgres 15.14+/16/17:
   *"Requires superuser to run migrations, no superuser needed for tenant grants."*
   Neon has no superuser.
2. Realtime's self-host seed (`priv/repo/seeds.exs`) creates the tenant's CDC
   connection with `"ssl_enforced" => false` — Neon refuses plaintext connections.
3. Its migrations create the `realtime` schema and grant on it as the connecting
   user, which must therefore own the database. Your console role does.

If `selfhost-check.js` reports `realtime FAIL` on Neon, the app still works; only
the two live-update paths above fall back to polling.

---

## `service_role` on a managed Postgres

Postgres allows only a **superuser** to create a role with `BYPASSRLS` (`user.c`:
"must be superuser to create bypassrls users"). The upstream image does it as
superuser. On Neon the bootstrap's attempt fails, it creates `service_role` without
the attribute and **raises a warning**; `selfhost-check.js` prints
`bypassrls WARN service_role.rolbypassrls=false`.

Consequence: with `SUPABASE_SERVICE_ROLE_KEY` the server code is still
RLS-filtered. The ~40 service-role call sites that read across a workspace
without a user session (`api/_shared/supa.js`, `brain-core.js`, the cron paths)
see zero rows where the policies require `auth.uid()`.

Workaround, not yet implemented in this kit: sign the service key for a
console-created Neon role instead. Create a role `supabase_service` in the Neon
Console (it gets `BYPASSRLS` from `neon_superuser` membership), then in SQL
`grant service_role to supabase_service; grant supabase_service to authenticator;`,
generate the key with `role: "supabase_service"`, and add that name to
`GOTRUE_JWT_ADMIN_ROLES` and storage's `DB_SERVICE_ROLE`. It is a plausible
design that was not executed against a live project, so it is written here as a
lead rather than shipped as a switch. Path A does not have this problem.

---

## What was and was not tested

Docker (29.3.1) and Compose (v5.1.1) were present where this kit was written, but
**the stack was not brought up**: image pulls were denied by the network egress
policy (the registry index answered; the blob CDN `production.cloudfront.docker.com`
returned 403). No Neon project was reachable either (neon.com is egress-blocked;
Neon's and Supabase's documentation was read from their public GitHub sources).
So, honestly:

- **Executed:** `docker compose config` on all three file combinations (local
  profile off, `--profile local-db`, `+caddy`) — Compose accepts them; the kit's
  own YAML parser renders the compose **byte-identically to Docker Compose's own
  `config --format json`** for every environment value of every service (a test
  cross-checks this whenever docker is present); the key generator's tokens
  verified with independent Node crypto, and **upstream's shipped demo keys
  verify under upstream's demo secret with this kit's verifier**; the migration
  ordering on the real directory; `selfhost-migrate.sh --list` in both modes;
  the bootstrap SQL's guard analysis with mutations; `selfhost-buckets.js`
  against a fake Storage API; `auth.js` booted in Chromium against
  `https://db.example.org` with every request recorded.
- **Not executed:** any container, any migration against a real database,
  GoTrue/storage-api/Realtime migrating as a non-superuser owner, Kong routing,
  the Google OAuth round trip, TLS. The first person to run `selfhost-check.js`
  on a real box is running it for the first time.

---

## What is NOT covered

- **No managed backups.** Path A: the cron line above is the backup. Path B: Neon
  Free has 6 h of restore history and no scheduled backups; take manual snapshots
  or `pg_dump` from the box.
- **No dashboard billing, no support, no SLA.** You run the box: OS updates,
  Docker updates, disk space (Storage objects and Postgres share the disk), the
  certificate (Caddy renews it, if port 80 stays reachable).
- **No Edge Functions, Logflare/Vector logs, Supavisor pooler, imgproxy** — dropped
  on purpose (reasons at the top of the compose). `docker compose logs -f <service>`
  is the log viewer.
- **Studio's Database Webhooks page** needs the `supabase_functions` schema; it is
  created in local mode (`webhooks.sql`) and not on a managed Postgres.
- **Opaque `sb_publishable_…` keys** (2026 upstream) are not wired; the app and
  Kong use the HS256 JWT keys.
- **Upgrades.** Image tags are pinned; bump them together from a later upstream
  `docker/` tree, never one at a time, and re-run the check script.

---

## The hosted-Supabase hardcode sweep (what changed in the app)

Grep targets: `supabase.co`, the old project ref, and `[a-z]{20}\.supabase`. Every
hit in runtime code was a defect for this work; docs/comments/tests were not.

| Hit | Verdict | Change |
|---|---|---|
| `api/public-config.js` — `url: ldb.url \|\| process.env.SUPABASE_URL` | **Defect.** The checked-in `data/linked-db.json` outranked the deployment's env, so every browser was handed the pinned hosted project no matter what `SUPABASE_URL` said (brain-core.js had the same defect, already fixed there). | Env first, file last. Executed test plants a pinned file and asserts the env wins; mutation-verified. |
| `data/linked-db.json` — pinned `fswdw….supabase.co` + anon key | **Defect.** A runtime data file read by four modules, naming a paused project. Third baked-in ref in the repo's history. | Ships empty (`url`/`anonKey`/`project_ref` = `""`). `tests/signin-config.spec.js` updated: the no-env last resort is now `''`, not a hosted host. |
| `lib/smart-brain/services.js` — `SMART_BRAIN_SUPABASE_URL \|\| linked.url \|\| SUPABASE_URL` | **Defect.** File outranked env; and the file's anon key outranked the env's, so an env URL could be paired with a file key (401). | Env URL and env keys before the file, as a matched pair. |
| `api/_shared/os-backbone.js` — key order `linked.anonKey \|\| SUPABASE_ANON_KEY` | **Defect** (URL was env-first, key was file-first: mismatched pair). | Env anon key before the file's. |
| `auth.js` reachability probe (`<url>/auth/v1/health`) | Derived from `SUPABASE_URL`; no hardcode. | Message wording made host-neutral ("…or the self-hosted stack is down"). |
| `brand-context.js` callback hint | Derived (`(window.__SUPABASE__).url + '/auth/v1/callback'`). | None. |
| `sw.js` | Passes every cross-origin request through by `url.origin !== self.location.origin`; no host names. | None. |
| `vercel.json` | No CSP / `connect-src`; headers name no host. | None. |
| `dashboard.html` "Link database" placeholder `https://xxxx.supabase.co` | Cosmetic (a placeholder attribute; no validation regex). | Placeholder reads "hosted or self-hosted". |
| `lifecycle_mailer_architect_v34.html` comment | Comment. | Comment mentions both. |
| `scripts/migrate-oauth.js` / `.sh` — `https://${ref}.supabase.co/auth/v1/callback` | Management tooling for the hosted platform (Supabase Management API), not app runtime. | Untouched; documented above as not applicable to self-hosting. |
| `docs/*`, `workers/README.md`, `supabase/*.sql` comments, tests | Prose and fixtures. | `docs/SMART_BRAIN.md` no longer claims a pinned project. |

Gate: `tests/self-hosted-supabase.spec.js` — the boot test records every request
`auth.js` and the page make with `SUPABASE_URL=https://db.example.org` and fails
on any request to a `*.supabase.co` host; a file check fails on any 20-letter
project ref in `auth.js`, `brand-context.js`, `sw.js`, `credits.js`,
`brand-catalog.js`, `vercel.json`, `data/linked-db.json`, `api/**` and `lib/**`.
