#!/usr/bin/env bash
# Preflight credential check for KNICKGASM Lifecycle OS (and sibling apps).
#
# Purpose: before any per-project management operation (Vercel deploy/env,
# GoDaddy DNS, Supabase management), confirm the required credentials are
# present in the environment. This script can only DETECT what is missing and
# tell you where to get it. It cannot mint or fetch secrets — those must be
# injected as environment variables (Claude Code on the web env config, or your
# shell / CI). It exits non-zero (fails loudly) when a required var is missing,
# so it is safe to gate a deploy/migration behind it.
#
# Usage:
#   bash scripts/preflight-credentials.sh                 # check all projects
#   PROJECTS="knickgasm-lifecycle-os" bash scripts/preflight-credentials.sh
#   REQUIRE_GODADDY=1 bash scripts/preflight-credentials.sh   # also require DNS keys
#   npm run preflight
#
# Per-project Supabase refs are read from a per-project env var built from the
# project slug, e.g.  KNICKGASM_LIFECYCLE_OS_SUPABASE_PROJECT_REF=abcd1234
# (slug uppercased, non-alphanumerics -> underscore). A single shared
# SUPABASE_PROJECT_REF is used as the fallback for the primary app.

set -uo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
# The projects this repo family deploys as separate Vercel projects (see
# CLAUDE.md). Override with the PROJECTS env var (space-separated) to scope it.
DEFAULT_PROJECTS="knickgasm-lifecycle-os personal-ai-os the-third-eye music-gen-ai hey-yaara ai-tele-suite th-life-engine marketing-mailers-html-architect"
PROJECTS="${PROJECTS:-$DEFAULT_PROJECTS}"

# Shared, account-level credentials. VERCEL_TOKEN + SUPABASE_ACCESS_TOKEN are
# always required for management ops; GoDaddy keys only when doing DNS work.
REQUIRED_SHARED="VERCEL_TOKEN SUPABASE_ACCESS_TOKEN"
GODADDY_VARS="GODADDY_KEY GODADDY_SECRET"
REQUIRE_GODADDY="${REQUIRE_GODADDY:-0}"

# Where to obtain each shared credential (printed on failure).
declare -A SOURCE=(
  [VERCEL_TOKEN]="vercel.com -> Account Settings -> Tokens"
  [SUPABASE_ACCESS_TOKEN]="supabase.com -> Account -> Access Tokens (sbp_...)"
  [GODADDY_KEY]="developer.godaddy.com -> API Keys (Production)"
  [GODADDY_SECRET]="developer.godaddy.com -> API Keys (paired with GODADDY_KEY)"
)

# ── Helpers ──────────────────────────────────────────────────────────────────
GREEN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
missing=0
warn=0

is_set() { printenv "$1" >/dev/null 2>&1 && [ -n "${!1:-}" ]; }

# slug -> env-var prefix: uppercase, non-alphanumeric -> underscore.
# printf (not echo) so no trailing newline is folded into a stray underscore.
slug_prefix() { printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_' | tr -c 'A-Z0-9_' '_'; }

check_shared() {
  local v="$1" required="$2"
  if is_set "$v"; then
    printf '  %s%-24s set%s\n' "$GREEN" "$v" "$RST"
  elif [ "$required" = "1" ]; then
    printf '  %s%-24s MISSING%s  %s(%s)%s\n' "$RED" "$v" "$RST" "$DIM" "${SOURCE[$v]:-?}" "$RST"
    missing=$((missing + 1))
  else
    printf '  %s%-24s missing (optional)%s  %s(%s)%s\n' "$YEL" "$v" "$RST" "$DIM" "${SOURCE[$v]:-?}" "$RST"
    warn=$((warn + 1))
  fi
}

# ── 1. Shared credentials ────────────────────────────────────────────────────
echo "Shared credentials:"
for v in $REQUIRED_SHARED; do check_shared "$v" 1; done
for v in $GODADDY_VARS;   do check_shared "$v" "$REQUIRE_GODADDY"; done

# ── 2. Per-project credentials ───────────────────────────────────────────────
echo ""
echo "Per-project credentials (Supabase project ref):"
for p in $PROJECTS; do
  prefix="$(slug_prefix "$p")"
  ref_var="${prefix}_SUPABASE_PROJECT_REF"
  # Fallback: the primary app may use the un-prefixed SUPABASE_PROJECT_REF.
  if is_set "$ref_var"; then
    printf '  %s%-34s%s ref via %s%s%s\n' "$GREEN" "$p" "$RST" "$DIM" "$ref_var" "$RST"
  elif [ "$p" = "knickgasm-lifecycle-os" ] && is_set "SUPABASE_PROJECT_REF"; then
    printf '  %s%-34s%s ref via %sSUPABASE_PROJECT_REF (shared)%s\n' "$GREEN" "$p" "$RST" "$DIM" "$RST"
  else
    printf '  %s%-34s ref MISSING%s  %sset %s%s\n' "$YEL" "$p" "$RST" "$DIM" "$ref_var" "$RST"
    warn=$((warn + 1))
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [ "$missing" -gt 0 ]; then
  echo "${RED}FAIL${RST}: $missing required credential(s) missing, $warn warning(s)."
  echo "${DIM}Add them as environment variables, then re-run. This script cannot fetch secrets.${RST}"
  exit 1
fi
if [ "$warn" -gt 0 ]; then
  echo "${YEL}OK with warnings${RST}: required shared credentials present; $warn optional/per-project value(s) unset."
  exit 0
fi
echo "${GREEN}OK${RST}: all required credentials present."
