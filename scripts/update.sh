#!/usr/bin/env bash
# Pull the latest code and report which build you are on.
#
# Both players run this before a session and compare the build id printed at
# the end. If those two strings match, the game will let you play together; if
# they do not, the join is refused with a message pointing back here.
#
#   ./scripts/update.sh

cd "$(dirname "$0")/.."
source scripts/lib.sh

before="$(build_id)"

bold "Pulling the latest code…"
if ! git pull --ff-only; then
  die "git pull could not fast-forward.
You have local commits or uncommitted changes. Sort those out first:
  git status
  git stash        # to shelve local edits"
fi

bold "Installing dependencies…"
npm install --silent

after="$(build_id)"

echo
rule
bold "  Build id:  $(build_id)"
dim  "  Commit:    $(git log -1 --format='%h  %s')"
rule
echo

if [ "$before" = "$after" ]; then
  dim "Already up to date."
else
  bold "Updated ${before} → ${after}"
fi

case "$after" in
  *-dirty)
    warn "
Your build id ends in -dirty: you have uncommitted changes under src/.
Your friend cannot match that, so co-op will refuse the join. Commit or
stash them before playing together."
    ;;
esac

echo
bold "Read that build id to the other player — you both need the same one."
dim  "If the game is already open, reload the tab: a running page keeps the old build."
