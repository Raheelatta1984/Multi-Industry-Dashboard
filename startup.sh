#!/bin/sh
# Meridian sandbox self-healing entry point.
#
# The platform re-runs this script when the sandbox is revived from a snapshot
# (see .grok/references/hibernate-revive.md). A revive can come back with the
# git branch pointer reset to the scaffold commit, node_modules wiped, and the
# dev server dead — scripts/sandbox-guard.mjs repairs all three before the
# preview is needed. Safe to run manually at any time.
set -eu
cd "$(dirname "$0")"

# :8081 is QA-only — a revive must never inherit a stale built-output preview.
node scripts/preview.mjs stop || true

# Heal git state (fetch + safe reset + rescue snapshot) and dependencies.
node scripts/sandbox-guard.mjs --recover --with-server --quiet || true

# Belt and braces: if the guard could not bring :8080 up, start Vite directly.
if curl -sf -o /dev/null --max-time 3 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
