#!/usr/bin/env bash
# Remove files and one personal email address from EVERY commit of this repo.
# Run on your own machine (it needs a force-push, which an agent session may not do).
#
#   bash scripts/history-rewrite.sh            # dry run: rewrites a fresh mirror, reports, pushes nothing
#   bash scripts/history-rewrite.sh --push     # same, then force-pushes every branch and tag
#
# What it removes (edit the two lists below to change it):
#   - files removed from the tree on 2026-10-30 that stay readable in old commits
#   - the email address replaced in the tree on 2026-10-30
# Needs: git, git-filter-repo (brew install git-filter-repo / pipx install git-filter-repo).
# After --push: every clone (yours, CI caches, other sessions) must be re-cloned, open PRs
# re-based, and GitHub support asked to purge cached views if a secret was involved.
set -euo pipefail

PATHS=(
  "image.png"
  "update.ps1"
  "deploy-copilot.sh"
  "Raw Prompts/"
)
# Each line: literal==>replacement (git filter-repo --replace-text format).
REPLACE=$'ojhapraneet@gmail.com==>owner@example.com\nojhapraneet==>owner'

REMOTE="${REMOTE:-$(git config --get remote.origin.url)}"
command -v git-filter-repo >/dev/null || { echo "Install git-filter-repo first (brew install git-filter-repo)."; exit 1; }

WORK="$(mktemp -d)"
echo "Mirroring $REMOTE into $WORK ..."
git clone --mirror --quiet "$REMOTE" "$WORK/repo.git"
cd "$WORK/repo.git"

before_size=$(du -sk . | cut -f1)
args=()
for p in "${PATHS[@]}"; do args+=(--path "$p"); done
printf '%s\n' "$REPLACE" > "$WORK/replace.txt"

git filter-repo --force --invert-paths "${args[@]}" --replace-text "$WORK/replace.txt"

echo
echo "Left in history after the rewrite (should be empty):"
for p in "${PATHS[@]}"; do git log --all --oneline -- "$p" | head -3; done
git log --all --oneline -S ojhapraneet | head -3
echo "Size: ${before_size} KB -> $(du -sk . | cut -f1) KB"

if [ "${1:-}" = "--push" ]; then
  read -r -p "Force-push every branch and tag to $REMOTE? Type REWRITE to continue: " ok
  [ "$ok" = "REWRITE" ] || { echo "Not pushed."; exit 1; }
  git remote add origin "$REMOTE" 2>/dev/null || git remote set-url origin "$REMOTE"
  # --mirror would also try refs/pull/*, which GitHub refuses; push branches and tags.
  git push --force --all origin
  git push --force --tags origin
  echo "Pushed. Re-clone every working copy now."
else
  echo "Dry run only. The rewritten mirror is at $WORK/repo.git. Re-run with --push to publish it."
fi
