#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy this session's Mailer Studio work (unified Chat+Listen dock, futuristic
# polish, generate.js chat mode) from the canonical repo. Vercel auto-builds on
# push. Copies ONLY the two changed files from the iCloud working copy into the
# matching locations inside your repo, then commits + pushes.
#
# Run:  bash "deploy-copilot.sh"            (uses the repo path below)
#  or:  bash "deploy-copilot.sh" /repo/path  (override)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SRC="$HOME/Library/Mobile Documents/com~apple~CloudDocs/ANCHIT'S AI HUSTLE/Knickgasm-LifeCycle-OS"
CANON="${1:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/ANCHIT'S AI HUSTLE/Anchit-Work-Portfolio}"

echo "▸ Source (this session's edits): $SRC"
echo "▸ Canonical repo:                $CANON"
echo

[ -d "$CANON/.git" ] || { echo "✗ No git repo at: $CANON"; echo "  Re-run: bash deploy-copilot.sh /correct/repo/path"; exit 1; }
cd "$CANON"

echo "▸ Pulling latest…"
git pull --ff-only || { echo "✗ git pull failed — resolve, then re-run."; exit 1; }

DESTS=()
copy_in () {           # $1 = filename to find, $2 = source file
  local name="$1" src="$2" dest
  dest="$(find "$CANON" -name "$name" -not -path '*/.git/*' -not -path '*/node_modules/*' | head -n1)"
  if [ -z "$dest" ]; then
    echo "  ! $name not found in repo — placing at repo root."
    dest="$CANON/$name"; mkdir -p "$(dirname "$dest")"
  fi
  cp "$src" "$dest"
  DESTS+=("$dest")
  echo "  ✓ $name → ${dest#$CANON/}"
}

echo "▸ Copying changed files into the repo…"
copy_in "knickgasm_mailer_architect_v34.html" "$SRC/knickgasm_mailer_architect_v34.html"
copy_in "generate.js"                       "$SRC/api/ai/generate.js"

echo
echo "▸ Staged changes (only these two files):"
git add -- "${DESTS[@]}"
git --no-pager diff --cached --stat
echo

if git diff --cached --quiet; then
  echo "✓ Nothing to deploy — repo already matches. (Already pushed?)"; exit 0
fi

git commit -m "feat(studio): unified Chat+Listen dock + futuristic polish; mode:'chat' in generate.js

One common bottom dock: Listen + chat input + send always together; message
history expands above the same bar (collapsed or expanded). On-brand motion
(reduced-motion gated). New mode:'chat' in generate.js powers the assistant;
Listen uses the browser SpeechSynthesis API. Light/dark themed."

echo "▸ Pushing… (Vercel auto-builds)"
git push

echo
echo "✅ Pushed. Build: https://vercel.com/anchittandon-3589s-projects/knickgasm-lifecycle-os"
echo "   Live at /studio in ~1–2 min."
