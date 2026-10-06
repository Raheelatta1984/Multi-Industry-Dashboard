#!/bin/sh
# Reinstall the sandbox-guard login-shell hook.
#
# Why this exists: ~/.profile and ~/.bash_profile live OUTSIDE the repo, so a
# sandbox recycle wipes them — along with the self-healing hook. The repo (and
# therefore this installer) survives every recycle via the file patchset, and
# startup.sh calls this on revive so the trigger layer rebuilds itself.
#
# Idempotent: safe to run as often as you like.
set -eu

HOOK_START='# >>> meridian-sandbox-guard (self-heal after sandbox recycle) >>>'
HOOK_END='# <<< meridian-sandbox-guard <<<'

hook_body() {
  cat <<'HOOK'
# Runs on every login shell: instantly restores git state, deps and the dev
# server after a sandbox recycle. ~80ms when healthy. Pause with:
#   touch /tmp/.meridian-guard-paused
if command -v node >/dev/null 2>&1 && [ -f "$HOME/Multi-Industry-Dashboard/scripts/sandbox-guard.mjs" ]; then
  node "$HOME/Multi-Industry-Dashboard/scripts/sandbox-guard.mjs" --recover --with-server --quiet || true
fi
HOOK
}

for f in "$HOME/.profile" "$HOME/.bash_profile"; do
  # Strip any previous copy (including half-written ones), then append fresh.
  if [ -f "$f" ]; then
    sed -i '/meridian-sandbox-guard/d' "$f"
    # Drop the three stray non-marker lines a partial install can leave.
    sed -i '/^# Runs on every login shell: instantly restores git state/d' "$f"
    sed -i '/^# server after a sandbox recycle/d' "$f"
    sed -i '/^#   touch \/tmp\/\.meridian-guard-paused/d' "$f"
  fi
  {
    printf '\n%s\n' "$HOOK_START"
    hook_body
    printf '%s\n' "$HOOK_END"
  } >> "$f"
done

echo "sandbox-guard hook installed to ~/.profile and ~/.bash_profile"
