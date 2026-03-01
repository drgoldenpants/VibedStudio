#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"commit message\""
  exit 1
fi

msg="$1"

git status --short
git add -A
git commit -m "$msg"
git push
