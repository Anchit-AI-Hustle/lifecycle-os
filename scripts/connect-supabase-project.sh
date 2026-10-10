#!/usr/bin/env bash
# scripts/connect-supabase-project.sh - point this deployment at a Supabase
# project, with the Supabase CLI and the Vercel CLI, in one run.
# ---------------------------------------------------------------------------
# WHY. Production answered "Local / Demo Mode ... the account service
# (fswdwmkgggzyxrdzabnh.supabase.co) is not answering": Vercel still named the
# PAUSED project. Switching is not one variable. The schema has to be on the new
# project first, its auth settings pushed, and the URL, the browser key and the
# server key changed together - a new URL beside the old project's service key
# is a deployment that answers every server call with 401.
#
#   bash scripts/connect-supabase-project.sh
#     Interactive. Each CLI opens your browser to sign in (supabase login,
#     vercel login); nothing is typed into a chat.
#
#   SUPABASE_ACCESS_TOKEN=... VERCEL_TOKEN=... bash scripts/connect-supabase-project.sh
#     Non-interactive (what .github/workflows/connect-supabase.yml runs).
#
# Steps, in order. Any step that fails stops the run before the next one, so a
# refused key never reaches Vercel and Vercel is never pointed at a project
# whose schema did not apply.
#   1. Supabase sign-in, then REFUSE unless this login can see the project.
#   2. supabase link; db push (the dry run is printed first); migration list.
#   3. supabase config push of supabase/config.toml, site_url = the deployment.
#   4. The project's keys. REFUSE unless the legacy service_role key is a JWT
#      issued for THIS project: the server sends it as a bearer to PostgREST,
#      which an sb_secret_ key is not accepted as (docs/mobile-pin-signin.md).
#   5. Vercel: SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY and
#      their NEXT_PUBLIC_ twins on production, preview and development.
#      MOBILE_PIN_PEPPER and CONNECTION_SECRET_KEY are created ONLY when absent -
#      rotating the pepper changes every PIN's password and rotating the
#      connection key makes every stored connection secret unreadable - and the
#      same value goes to production and preview, which share one project.
#   6. Redeploy the current production deployment and wait until
#      /api/public-config?action=auth&op=status answers mode "supabase".
#
# Secrets travel on stdin, never on a command line and never to the terminal;
# the only files that hold one live in a 0700 directory removed on exit.
#
# Overrides: SUPABASE_PROJECT_REF, VERCEL_PROJECT, VERCEL_TEAM, SITE_URL,
# CONNECT_WAIT_SECONDS, SUPABASE_BIN / VERCEL_BIN (a path to the CLI).
# ---------------------------------------------------------------------------
set -euo pipefail

REF="${SUPABASE_PROJECT_REF:-dypkppctdbmsiqclnhzx}"
VERCEL_PROJECT="${VERCEL_PROJECT:-lifecycle-os}"
VERCEL_TEAM="${VERCEL_TEAM:-anchit-ai-hustle}"
SITE_URL="${SITE_URL:-https://lifecycle-os.anchit-tandon.com}"
SITE_URL="${SITE_URL%/}"
WAIT_SECONDS="${CONNECT_WAIT_SECONDS:-600}"
SUPABASE_VERSION="2.119.0"
VERCEL_VERSION="62.2.0"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say()  { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nx %s\n' "$*" >&2; exit 1; }

[[ "$REF" =~ ^[a-z]{20}$ ]] || fail "SUPABASE_PROJECT_REF must be a 20-letter project ref; got '$REF'."
command -v node >/dev/null || fail "Node.js is required (it parses the CLIs' JSON without printing it)."

# The schema pushed is the one main's CI has proven (migrations from zero, the
# RLS isolation matrix). A branch's migrations have not been, so the run starts
# only from origin/main's commit unless ALLOW_NON_MAIN=1 says otherwise.
if [[ "${ALLOW_NON_MAIN:-}" != 1 ]]; then
  git fetch --quiet origin main 2>/dev/null || fail "Could not fetch origin/main to confirm this checkout is main."
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] \
    || fail "This checkout is not origin/main ($(git rev-parse --short HEAD) vs $(git rev-parse --short origin/main)). Run: git checkout main && git pull, then run this again."
  [[ -z "$(git status --porcelain -- supabase)" ]] || fail "supabase/ has local changes; the pushed schema must be main's exactly."
fi

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The CLIs: an explicit path, else the repo's pinned devDependency, else one on
# PATH, else the pinned version through npx.
if [[ -n "${SUPABASE_BIN:-}" ]]; then SB=("$SUPABASE_BIN")
elif [[ -x node_modules/.bin/supabase ]]; then SB=(node_modules/.bin/supabase)
elif command -v supabase >/dev/null; then SB=(supabase)
else SB=(npx --yes "supabase@$SUPABASE_VERSION"); fi
if [[ -n "${VERCEL_BIN:-}" ]]; then VC=("$VERCEL_BIN")
elif command -v vercel >/dev/null; then VC=(vercel)
else VC=(npx --yes "vercel@$VERCEL_VERSION"); fi
VTOK=()
[[ -n "${VERCEL_TOKEN:-}" ]] && VTOK=(--token "$VERCEL_TOKEN")
# Every Vercel command runs from its own directory, so `vercel link` writes its
# .vercel/ (and anything it might pull) into $WORK, never into the repository.
mkdir -p "$WORK/vercel"
# ${VTOK[@]+...}: an empty array under `set -u` is an error in bash 3.2 (macOS).
vc() { "${VC[@]}" --cwd "$WORK/vercel" "$@" ${VTOK[@]+"${VTOK[@]}"}; }

# ---------------------------------------------------------------- 1. Supabase
step "1/6 Supabase: sign in and confirm this login can see $REF"
if ! "${SB[@]}" projects list -o json >"$WORK/projects.json" 2>"$WORK/sb.err"; then
  if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    cat "$WORK/sb.err" >&2
    fail "SUPABASE_ACCESS_TOKEN was refused. Create one at https://supabase.com/dashboard/account/tokens with the account that owns $REF."
  fi
  "${SB[@]}" login
  "${SB[@]}" projects list -o json >"$WORK/projects.json"
fi
node -e '
  const ref = process.argv[1];
  const raw = require("fs").readFileSync(process.argv[2], "utf8");
  let list; try { list = JSON.parse(raw); } catch (_) { list = null; }
  if (!Array.isArray(list)) { console.error("The Supabase CLI did not return a project list."); process.exit(2); }
  const hit = list.find((p) => p && (p.ref === ref || p.id === ref));
  if (!hit) {
    console.error("This Supabase login cannot see project " + ref + " (" + list.length + " project(s) visible). Sign in with the account that owns it: run `supabase logout`, then run this script again.");
    process.exit(3);
  }
  console.log("  project " + ref + (hit.name ? " (" + hit.name + ")" : "") + (hit.status ? ", status " + hit.status : ""));
' "$REF" "$WORK/projects.json" || fail "Stopped before touching anything."

# ------------------------------------------------------------ 2. the schema
step "2/6 Supabase: link and apply every migration in supabase/migrations"
# The database password comes from SUPABASE_DB_PASSWORD when set (the CLI reads
# it from the environment); otherwise link asks, or the CLI's own login role is used.
"${SB[@]}" link --project-ref "$REF"
say "  dry run - what will apply:"
"${SB[@]}" db push --linked --include-all --dry-run
"${SB[@]}" db push --linked --include-all --yes
"${SB[@]}" migration list --linked

# ------------------------------------------------------- 3. auth settings
step "3/6 Supabase: push the auth settings in supabase/config.toml (site_url $SITE_URL)"
mkdir -p "$WORK/config/supabase"
node -e '
  const fs = require("fs");
  const [from, to, site] = process.argv.slice(1);
  const toml = fs.readFileSync(from, "utf8");
  if (!/^site_url\s*=.*$/m.test(toml)) { console.error("supabase/config.toml has no [auth] site_url line."); process.exit(2); }
  fs.writeFileSync(to, toml.replace(/^site_url\s*=.*$/m, "site_url = " + JSON.stringify(site)));
' supabase/config.toml "$WORK/config/supabase/config.toml" "$SITE_URL"
"${SB[@]}" config push --workdir "$WORK/config" --project-ref "$REF" --yes

# --------------------------------------------------------------- 4. the keys
step "4/6 Supabase: read the project's API keys (never printed)"
mkdir -p "$WORK/secrets"
"${SB[@]}" projects api-keys --project-ref "$REF" --reveal -o json | node -e '
  const fs = require("fs");
  const [ref, dir] = process.argv.slice(1);
  let raw = "";
  process.stdin.on("data", (d) => { raw += d; }).on("end", () => {
    let list; try { list = JSON.parse(raw); } catch (_) { list = null; }
    if (list && !Array.isArray(list)) list = list.keys || list.api_keys || null;
    if (!Array.isArray(list)) { console.error("The Supabase CLI did not return a key list."); process.exit(2); }
    const keys = list.map((e) => e && (e.api_key || e.apiKey)).filter((k) => typeof k === "string");
    const isJwt = (k) => /^eyJ[\w-]*\.[\w-]+\.[\w-]*$/.test(k);
    const claims = (k) => { try { return JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString("utf8")); } catch (_) { return {}; } };
    const legacy = (role) => keys.filter(isJwt).filter((k) => claims(k).role === role);
    const service = legacy("service_role");
    if (!service.length) {
      console.error("No legacy service_role key on " + ref + ". The server sends its key as a bearer, which an sb_secret_ key is not accepted as. Turn legacy API keys on (Project Settings > API Keys > Legacy API keys), then run this script again. Nothing was written to Vercel.");
      process.exit(4);
    }
    const mine = service.filter((k) => claims(k).ref === ref);
    if (!mine.length) {
      console.error("The service_role key returned was issued for project " + (claims(service[0]).ref || "(none named)") + ", not " + ref + ". Nothing was written to Vercel.");
      process.exit(5);
    }
    const anon = legacy("anon").find((k) => claims(k).ref === ref) || keys.find((k) => /^sb_publishable_/.test(k));
    if (!anon) { console.error("No anon or publishable key on " + ref + ". Nothing was written to Vercel."); process.exit(6); }
    fs.writeFileSync(dir + "/service", mine[0], { mode: 0o600 });
    fs.writeFileSync(dir + "/anon", anon, { mode: 0o600 });
    console.log("  service_role: a legacy JWT for " + ref);
    console.log("  browser key:  " + (isJwt(anon) ? "the legacy anon JWT" : "the publishable key"));
  });
' "$REF" "$WORK/secrets" || fail "Stopped before writing anything to Vercel."
printf '%s' "https://$REF.supabase.co" >"$WORK/secrets/url"

# -------------------------------------------------------------- 5. Vercel
step "5/6 Vercel: write the environment of $VERCEL_TEAM/$VERCEL_PROJECT"
vc whoami >/dev/null 2>&1 || {
  [[ -n "${VERCEL_TOKEN:-}" ]] && fail "VERCEL_TOKEN was refused. Create one at https://vercel.com/account/tokens with access to the $VERCEL_TEAM team."
  "${VC[@]}" login
}
vc link --yes --team "$VERCEL_TEAM" --project "$VERCEL_PROJECT" >/dev/null

# Which names production already holds - read from JSON piped straight into
# node, so no value is ever on the terminal.
vc env ls production --json 2>/dev/null | node -e '
  let raw = "";
  process.stdin.on("data", (d) => { raw += d; }).on("end", () => {
    const names = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        if (typeof v.key === "string") names.add(v.key);
        Object.values(v).forEach(walk);
      }
    };
    try { walk(JSON.parse(raw)); } catch (_) { console.error("Could not read the production variable list."); process.exit(2); }
    process.stdout.write([...names].join("\n"));
  });
' >"$WORK/existing" || fail "Could not list the production environment of $VERCEL_PROJECT."
has_env() { grep -qx "$1" "$WORK/existing"; }

put_env() { # NAME FILE TARGET...
  local name="$1" file="$2" target flag
  shift 2
  for target in "$@"; do
    # Vercel keeps a secret only on production and preview; development
    # variables are readable config by design.
    if [[ "$target" == development ]]; then flag=--no-sensitive; else flag=--sensitive; fi
    if ! vc env add "$name" "$target" "$flag" --force --yes <"$file" >/dev/null 2>"$WORK/vc.err"; then
      cat "$WORK/vc.err" >&2
      fail "Could not write $name to $target."
    fi
    say "  $name -> $target"
  done
}

ALL=(production preview development)
put_env SUPABASE_URL "$WORK/secrets/url" "${ALL[@]}"
put_env NEXT_PUBLIC_SUPABASE_URL "$WORK/secrets/url" "${ALL[@]}"
put_env SUPABASE_ANON_KEY "$WORK/secrets/anon" "${ALL[@]}"
put_env NEXT_PUBLIC_SUPABASE_ANON_KEY "$WORK/secrets/anon" "${ALL[@]}"
put_env SUPABASE_SERVICE_ROLE_KEY "$WORK/secrets/service" "${ALL[@]}"

if has_env MOBILE_PIN_PEPPER; then
  say "  MOBILE_PIN_PEPPER already set - kept (a new pepper would change every PIN's password)"
else
  node -e 'process.stdout.write(require("crypto").randomBytes(48).toString("base64"))' >"$WORK/secrets/pepper"
  put_env MOBILE_PIN_PEPPER "$WORK/secrets/pepper" production preview
fi
if has_env CONNECTION_SECRET_KEY; then
  say "  CONNECTION_SECRET_KEY already set - kept (a new key makes stored connection secrets unreadable)"
else
  node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))' >"$WORK/secrets/connkey"
  put_env CONNECTION_SECRET_KEY "$WORK/secrets/connkey" production preview
fi

# ------------------------------------------------------ 6. redeploy + check
step "6/6 Vercel: redeploy production and wait for it to answer in Supabase mode"
host="${SITE_URL#*://}"
deployment="$(vc inspect "$host" --json 2>/dev/null | node -e '
  let raw = "";
  process.stdin.on("data", (d) => { raw += d; }).on("end", () => {
    try { const j = JSON.parse(raw); process.stdout.write(String(j.id || j.uid || j.url || "")); } catch (_) {}
  });
' || true)"
vc redeploy "${deployment:-$host}" --target production

node -e '
  const [url, waitS] = process.argv.slice(1);
  const until = Date.now() + Number(waitS) * 1000;
  let last = "no answer yet";
  (async function poll() {
    while (Date.now() < until) {
      try {
        const r = await fetch(url + "/api/public-config?action=auth&op=status", { cache: "no-store" });
        const j = await r.json();
        last = "mode " + j.mode + (j.reason ? " (" + j.reason + ")" : "");
        if (j.mode === "supabase") { console.log("  " + url + " answers " + last + "."); return; }
      } catch (e) { last = String(e && e.message || e); }
      await new Promise((ok) => setTimeout(ok, 5000));
    }
    console.error("The deployment did not answer in Supabase mode within " + waitS + " s; last answer: " + last + ".");
    process.exit(7);
  })();
' "$SITE_URL" "$WAIT_SECONDS" || fail "Redeployed, but the check did not pass."

say ""
say "Done: $SITE_URL now uses Supabase project $REF."
