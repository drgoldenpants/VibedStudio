#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"commit message\" [-t vX.Y.Z|auto]"
  exit 1
fi

msg=""
tag=""

get_next_tag() {
  local latest
  latest=$(git tag --list "v*" | sort -V | tail -n 1)
  if [[ -z "$latest" ]]; then
    echo "v0.1.0"
    return
  fi
  local base="${latest#v}"
  local major minor patch
  IFS='.' read -r major minor patch <<< "$base"
  patch=$((patch + 1))
  echo "v${major}.${minor}.${patch}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t|--tag)
      shift
      tag="${1:-}"
      ;;
    *)
      if [[ -z "$msg" ]]; then
        msg="$1"
      else
        msg="${msg} $1"
      fi
      ;;
  esac
  shift || true
done

if [[ -z "$msg" ]]; then
  echo "Error: commit message is required."
  exit 1
fi

git status --short
git add -A
git commit -m "$msg"
git push

if [[ -n "$tag" ]]; then
  if [[ "$tag" == "auto" || "$tag" == "next" ]]; then
    tag=$(get_next_tag)
  fi
  git tag "$tag"
  git push origin "$tag"
fi
