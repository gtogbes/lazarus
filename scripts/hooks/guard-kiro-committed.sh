#!/bin/sh
# Kiro PreToolUse hook: block git add/commit while .kiro/ is gitignored.
# The Kiroween rules disqualify submissions that leave .kiro/ out of the repo.
# Receives the tool call as JSON on stdin. Exit 2 blocks the call.
input=$(cat)
case "$input" in
  *"git commit"* | *"git add"*) ;;
  *) exit 0 ;;
esac
# --no-index: check the ignore rules even for files that are already tracked.
if git check-ignore -q --no-index .kiro/steering/product.md 2>/dev/null; then
  echo "Blocked: .kiro/ is gitignored. The hackathon rules require .kiro/ in the repo. Remove it from .gitignore first." >&2
  exit 2
fi
exit 0
