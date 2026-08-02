#!/usr/bin/env bash
# migrate-oauth.sh — pure curl/bash mirror of migrate-oauth.js (no Node needed).
#
# The OAuth half of the domain migration. For each project it:
#   1. reconciles the SUPABASE AUTH REDIRECT ALLOWLIST (auto-applied) so the
#      post-login bounce-back to https://<slug>.anchit-tandon.com is accepted —
#      this is the change that actually breaks Google sign-in on a new domain,
#      and it IS scriptable via the Supabase Management API;
#   2. prints the GOOGLE OAUTH 2.0 WEB CLIENT plan (add the new JavaScript
#      origin; the redirect URI stays the fixed Supabase callback). There is NO
#      gcloud command / public API to edit a Web-application client, so this is
#      a Console deep-link + exact values, never an automated mutation. See
#      https://github.com/googleapis/google-cloud-go/issues/10768 .
#
# SAFE BY DEFAULT: dry-run unless you pass --apply.
#
# Env (this script cannot fetch secrets):
#   SUPABASE_ACCESS_TOKEN                 required (sbp_...)
#   <SLUG>_SUPABASE_PROJECT_REF           per-project ref (slug uppercased,
#                                         non-alphanumeric -> underscore);
#                                         SUPABASE_PROJECT_REF is the fallback
#                                         for knickgasm-lifecycle-os.
#   GCP_PROJECT                           optional — else read from gcloud config.
#   ROOT_DOMAIN                           optional (default anchit-tandon.com)
#
# Usage:
#   bash scripts/migrate-oauth.sh                   # dry-run, all projects
#   bash scripts/migrate-oauth.sh --apply
#   bash scripts/migrate-oauth.sh --project=hey-yaara --apply
#   PROMOTE_SITE_URL=1 bash scripts/migrate-oauth.sh --apply   # also set Site URL

set -uo pipefail

ROOT_DOMAIN="${ROOT_DOMAIN:-anchit-tandon.com}"
ALL_PROJECTS="knickgasm-lifecycle-os personal-ai-os the-third-eye music-gen-ai hey-yaara ai-tele-suite th-life-engine marketing-mailers-html-architect"
PROMOTE_SITE_URL="${PROMOTE_SITE_URL:-0}"

APPLY=0; ONLY=""
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --project=*) ONLY="${a#*=}" ;;
    --promote-site-url) PROMOTE_SITE_URL=1 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done
PROJECTS="${ONLY:-$ALL_PROJECTS}"

die() { echo "" >&2; echo "FAIL: $*" >&2; exit 1; }
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || die "SUPABASE_ACCESS_TOKEN is not set (sbp_...)."

# slug -> env-var prefix: uppercase, non-alphanumeric -> underscore.
slug_prefix() { printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_' | tr -c 'A-Z0-9' '_'; }

ref_for() {
  local p="$1" prefix var
  prefix="$(slug_prefix "$p")"
  var="${prefix}_SUPABASE_PROJECT_REF"
  if [ -n "${!var:-}" ]; then printf '%s' "${!var}"; return; fi
  if [ "$p" = "knickgasm-lifecycle-os" ] && [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
    printf '%s' "${SUPABASE_PROJECT_REF}"; return
  fi
  printf ''
}

GCP_PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
[ "$GCP_PROJECT" = "(unset)" ] && GCP_PROJECT=""

sget() { curl -sS --max-time 30 -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
           "https://api.supabase.com$1"; }
spatch() { curl -sS --max-time 30 -o /dev/null -w "%{http_code}" -X PATCH \
             -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" -H "Content-Type: application/json" \
             -d "$2" "https://api.supabase.com$1"; }

# Extract a top-level string field from the auth config JSON (no jq dependency).
json_str() { printf '%s' "$1" | grep -Eo "\"$2\":\"[^\"]*\"" | head -n1 | sed "s/\"$2\":\"//;s/\"$//"; }

echo "OAuth redirect migration -> *.${ROOT_DOMAIN}  ($([ "$APPLY" = 1 ] && echo APPLY || echo DRY-RUN))"
[ -n "$GCP_PROJECT" ] && echo "gcloud project: ${GCP_PROJECT}" || echo "gcloud project: (unknown — generic Console links)"
printf '%s\n' "------------------------------------------------------------------------"
fail=0
for p in $PROJECTS; do
  fqdn="${p}.${ROOT_DOMAIN}"
  ref="$(ref_for "$p")"
  if [ -z "$ref" ]; then
    echo "! ${p}: [supabase] ref MISSING — set $(slug_prefix "$p")_SUPABASE_PROJECT_REF"; fail=1
  else
    body="$(sget "/v1/projects/${ref}/config/auth")"
    if printf '%s' "$body" | grep -q '"message"' && ! printf '%s' "$body" | grep -q '"uri_allow_list"'; then
      echo "! ${p}: [supabase] ref ${ref} not visible to this token: $(printf '%s' "$body" | head -c 120)"; fail=1
    else
      allow="$(json_str "$body" uri_allow_list)"
      site="$(json_str "$body" site_url)"
      want1="https://${fqdn}"; want2="https://${fqdn}/**"
      merged="$allow"; added=""
      for u in "$want1" "$want2"; do
        case ",$merged," in
          *",$u,"*) : ;;
          *) [ -n "$merged" ] && merged="${merged},${u}" || merged="${u}"; added="${added} ${u}" ;;
        esac
      done
      want_site=""; site_change=0
      if [ "$PROMOTE_SITE_URL" = "1" ] && [ "$site" != "https://${fqdn}" ]; then
        want_site="https://${fqdn}"; site_change=1
      fi
      if [ -z "$added" ] && [ "$site_change" = "0" ]; then
        echo "= ${p}: [supabase] ref ${ref}: allowlist already covers ${fqdn}"
      elif [ "$APPLY" != "1" ]; then
        echo "~ ${p}: [supabase] ref ${ref}: would add [${added# }]$([ "$site_change" = 1 ] && echo "; Site URL -> ${want_site}")"
      else
        payload="{\"uri_allow_list\":\"${merged}\""
        [ "$site_change" = "1" ] && payload="${payload},\"site_url\":\"${want_site}\""
        payload="${payload}}"
        code="$(spatch "/v1/projects/${ref}/config/auth" "$payload")"
        if [ "$code" = "200" ]; then
          echo "+ ${p}: [supabase] ref ${ref}: allowlist updated${added:+ (+${added# })}$([ "$site_change" = 1 ] && echo "; Site URL -> ${want_site}")"
        else
          echo "! ${p}: [supabase] PATCH failed (HTTP ${code})"; fail=1
        fi
      fi
    fi
  fi

  # Google web OAuth client — plan only. Link to the project's credentials list
  # (not a per-client URL): the client id is user input and threading it into a
  # logged URL adds no real value; the list page is one click from the client.
  projq=""; [ -n "$GCP_PROJECT" ] && projq="?project=${GCP_PROJECT}"
  link="https://console.cloud.google.com/apis/credentials${projq}"
  echo "    [google oauth client] add Authorized JavaScript origin: https://${fqdn}"
  [ -n "$ref" ] && echo "      redirect URI stays the Supabase callback (unchanged): https://${ref}.supabase.co/auth/v1/callback"
  echo "      gcloud/API cannot edit a Web-application client — do it in Console: ${link}"
done
printf '%s\n' "------------------------------------------------------------------------"
[ "$APPLY" = "1" ] || echo "Dry-run only. Re-run with --apply (SUPABASE_ACCESS_TOKEN set) to write the allowlist."
exit $fail
