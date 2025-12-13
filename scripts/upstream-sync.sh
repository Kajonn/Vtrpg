#!/usr/bin/env bash
set -euo pipefail

REMOTE_NAME="${REMOTE_NAME:-origin}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-main}"
BUNDLE_PATH="${UPSTREAM_BUNDLE:-upstream.bundle}"

if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  echo "Fetching $REMOTE_NAME/$UPSTREAM_BRANCH ..."
  git fetch "$REMOTE_NAME" "$UPSTREAM_BRANCH"
  echo
  echo "Fetched $REMOTE_NAME/$UPSTREAM_BRANCH. Merge with:"
  echo "  git merge --no-commit --no-ff $REMOTE_NAME/$UPSTREAM_BRANCH"
  exit 0
fi

if [[ -f "$BUNDLE_PATH" ]]; then
  echo "No remote named '$REMOTE_NAME' configured; using bundle at $BUNDLE_PATH instead."
  git fetch "$BUNDLE_PATH" "$UPSTREAM_BRANCH:refs/remotes/upstream/$UPSTREAM_BRANCH"
  echo
  echo "Fetched upstream/$UPSTREAM_BRANCH from bundle. Merge with:"
  echo "  git merge --no-commit --no-ff upstream/$UPSTREAM_BRANCH"
  exit 0
fi

echo "Neither remote '$REMOTE_NAME' nor bundle '$BUNDLE_PATH' is available."
echo "Add a remote (e.g., git remote add origin <url>) or provide an upstream.bundle file, then re-run."
exit 1
