#!/bin/sh
# SessionStart auto-update notice: Claude Code does NOT auto-update plugins
# from third-party marketplaces by default, so a marketplace install of
# rubber-ducky silently pins to whatever commit it was installed from and
# bug fixes never arrive. This script detects that situation and, until
# acknowledged, prints a short context note asking the agent to tell the
# user how to enable auto-update (or update manually).
#
# Detection is conservative and fail-silent:
#   - dev installs (--plugin-dir checkouts outside plugins/cache/) are skipped;
#   - "autoUpdate": true inside this marketplace's entry in
#     known_marketplaces.json silences it;
#   - a missing or unreadable known_marketplaces.json is treated as the
#     default (auto-update off) and the notice shows — the ack file caps the
#     cost at one reminder ever.
# stdout from a SessionStart hook lands in the agent's context; this script
# always exits 0 so session start is never disturbed.

PLUGIN_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd) || exit 0

# Marketplace installs live at <config>/plugins/cache/<marketplace>/<plugin>/<version>.
PLUGIN_DIR=$(dirname "$PLUGIN_ROOT")
MARKETPLACE_DIR=$(dirname "$PLUGIN_DIR")
CACHE_DIR=$(dirname "$MARKETPLACE_DIR")
[ "$(basename "$CACHE_DIR")" = "cache" ] || exit 0
MARKETPLACE=$(basename "$MARKETPLACE_DIR")

ACK_ROOT=${RUBBER_DUCKY_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/rubber-ducky}
ACK_FILE="$ACK_ROOT/auto-update-notice-acked"
[ -f "$ACK_FILE" ] && exit 0

KNOWN=$(dirname "$CACHE_DIR")/known_marketplaces.json
if [ -f "$KNOWN" ]; then
  # Entry-scoped scan of machine-written, stably-indented JSON: from this
  # marketplace's key to the 2-space closing brace, look for an enabled
  # autoUpdate flag. Parse trouble falls through to showing the notice,
  # which matches the third-party default of auto-update off.
  if awk -v key="\"$MARKETPLACE\":" '
      index($0, key) { on = 1 }
      on && /"autoUpdate"[[:space:]]*:[[:space:]]*true/ { found = 1 }
      on && /^  }/ { on = 0 }
      END { exit found ? 0 : 1 }
    ' "$KNOWN" 2>/dev/null; then
    exit 0
  fi
fi

mkdir -p "$ACK_ROOT" 2>/dev/null || true
cat <<EOF
[rubber-ducky] Auto-update is OFF for the "$MARKETPLACE" plugin marketplace, so plugin bug fixes will not arrive on their own. At a natural moment early in this session (never mid-task), tell the user once, briefly: enable auto-update via /plugin -> Marketplaces -> $MARKETPLACE -> "Enable auto-update", or update manually anytime with /plugin marketplace update $MARKETPLACE followed by /reload-plugins. Those are user-typed commands — never run them yourself. After telling the user, run: touch "$ACK_FILE" so this notice never repeats.
EOF
exit 0
