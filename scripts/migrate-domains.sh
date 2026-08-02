#!/usr/bin/env bash
# migrate-domains.sh — pure curl/bash version of migrate-domains.js (no Node
# needed; macOS/Linux ship curl). Points each sibling Vercel project at a
# <slug>.anchit-tandon.com custom domain, wherever it is not done yet:
#   1. reads the project's current domains (Vercel API),
#   2. skips it if it already has ANY *.anchit-tandon.com domain (idempotent),
#   3. else adds <slug>.anchit-tandon.com in Vercel and upserts the matching
#      CNAME (-> cname.vercel-dns.com) in GoDaddy.
#
# SAFE BY DEFAULT: dry-run unless you pass --apply.
#
# Env (this script cannot fetch secrets):
#   VERCEL_TOKEN                 required (both modes)
#   VERCEL_TEAM_ID               optional (if projects live under a team)
#   GODADDY_KEY / GODADDY_SECRET required for --apply
#   ROOT_DOMAIN                  optional (default anchit-tandon.com)
#
# Usage:
#   bash scripts/migrate-domains.sh                 # dry-run, all 8 projects
#   bash scripts/migrate-domains.sh --apply
#   bash scripts/migrate-domains.sh --project=hey-yaara --apply

set -uo pipefail

ROOT_DOMAIN="${ROOT_DOMAIN:-anchit-tandon.com}"
VERCEL_CNAME="cname.vercel-dns.com"
ALL_PROJECTS="knickgasm-lifecycle-os personal-ai-os the-third-eye music-gen-ai hey-yaara ai-tele-suite th-life-engine marketing-mailers-html-architect"

APPLY=0; ONLY=""; NO_OAUTH=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --project=*) ONLY="${a#*=}" ;;
    --no-oauth) NO_OAUTH=1 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done
PROJECTS="${ONLY:-$ALL_PROJECTS}"

die() { echo "" >&2; echo "FAIL: $*" >&2; exit 1; }
[ -n "${VERCEL_TOKEN:-}" ] || die "VERCEL_TOKEN is not set."
if [ "$APPLY" = "1" ] && { [ -z "${GODADDY_KEY:-}" ] || [ -z "${GODADDY_SECRET:-}" ]; }; then
  die "--apply needs GODADDY_KEY and GODADDY_SECRET. Run without --apply for a dry-run."
fi

TEAM_Q=""; [ -n "${VERCEL_TEAM_ID:-}" ] && TEAM_Q="?teamId=${VERCEL_TEAM_ID}"

vget()  { curl -sS --max-time 30 -H "Authorization: Bearer ${VERCEL_TOKEN}" "https://api.vercel.com$1"; }
vpost() { curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X POST \
            -H "Authorization: Bearer ${VERCEL_TOKEN}" -H "Content-Type: application/json" \
            -d "$2" "https://api.vercel.com$1"; }
gput()  { curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X PUT \
            -H "Authorization: sso-key ${GODADDY_KEY}:${GODADDY_SECRET}" -H "Content-Type: application/json" \
            -d "[{\"data\":\"${VERCEL_CNAME}\",\"ttl\":3600}]" \
            "https://api.godaddy.com/v1/domains/${ROOT_DOMAIN}/records/CNAME/$1"; }

echo "Domain migration -> *.${ROOT_DOMAIN}  ($([ "$APPLY" = 1 ] && echo APPLY || echo DRY-RUN))"
printf '%s\n' "------------------------------------------------------------------------"
fail=0
for p in $PROJECTS; do
  sub="$p"; fqdn="${sub}.${ROOT_DOMAIN}"
  body="$(vget "/v9/projects/${p}/domains${TEAM_Q}")"
  if printf '%s' "$body" | grep -q '"error"'; then
    if printf '%s' "$body" | grep -qi 'not_found\|not be found'; then
      echo "- ${p}: project not found under this token/team"; fail=1; continue
    fi
    echo "! ${p}: Vercel error: $(printf '%s' "$body" | head -c 160)"; fail=1; continue
  fi
  # Idempotency: already has any *.ROOT_DOMAIN domain?
  if printf '%s' "$body" | grep -Eqo "\"name\":\"[^\"]*\.${ROOT_DOMAIN//./\\.}\""; then
    have="$(printf '%s' "$body" | grep -Eo "\"name\":\"[^\"]*\.${ROOT_DOMAIN//./\\.}\"" | sed 's/"name":"//;s/"//' | tr '\n' ' ')"
    echo "= ${p}: already on ${ROOT_DOMAIN} -> ${have}"
    continue
  fi
  if [ "$APPLY" != "1" ]; then
    echo "~ ${p}: would add ${fqdn} + GoDaddy CNAME ${sub} -> ${VERCEL_CNAME}"
    continue
  fi
  code="$(vpost "/v10/projects/${p}/domains${TEAM_Q}" "{\"name\":\"${fqdn}\"}")"
  if [ "$code" = "200" ] || [ "$code" = "201" ] || [ "$code" = "409" ]; then
    gcode="$(gput "${sub}")"
    if [ "$gcode" = "200" ]; then
      echo "+ ${p}: $([ "$code" = 409 ] && echo 'domain existed' || echo "added ${fqdn}"); GoDaddy CNAME ${sub} set (verify pending DNS)"
    else
      echo "! ${p}: Vercel ok ($code) but GoDaddy CNAME failed (HTTP ${gcode})"; fail=1
    fi
  else
    echo "! ${p}: Vercel add domain failed (HTTP ${code})"; fail=1
  fi
done
printf '%s\n' "------------------------------------------------------------------------"
[ "$APPLY" = "1" ] || echo "Dry-run only. Re-run with --apply (and GoDaddy keys set) to make changes."

# ── OAuth follow-through ──────────────────────────────────────────────────────
# A domain change breaks Google sign-in until the new origin is reconciled.
# Hand the same scope/mode to migrate-oauth.sh (skip with --no-oauth).
if [ "$NO_OAUTH" = "1" ]; then
  echo ""
  echo "(--no-oauth) Skipping OAuth reconcile. Run scripts/migrate-oauth.sh separately."
elif [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo ""
  echo "OAuth reconcile SKIPPED: SUPABASE_ACCESS_TOKEN not set. Google sign-in will 400 on the"
  echo "new origin until the Supabase redirect allowlist is updated. Set it and run:"
  echo "  bash scripts/migrate-oauth.sh$([ "$APPLY" = 1 ] && echo ' --apply')"
else
  echo ""
  echo "########################################################################"
  echo "# OAuth follow-through (Supabase allowlist + Google web-client plan)"
  echo "########################################################################"
  OAUTH_ARGS=""
  [ "$APPLY" = "1" ] && OAUTH_ARGS="$OAUTH_ARGS --apply"
  [ -n "$ONLY" ] && OAUTH_ARGS="$OAUTH_ARGS --project=$ONLY"
  bash "$(dirname "$0")/migrate-oauth.sh" $OAUTH_ARGS || fail=1
fi

exit $fail
