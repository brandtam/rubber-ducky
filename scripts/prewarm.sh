#!/bin/sh
# SessionStart pre-warm: make sure the platform binary is cached before the
# first real `rubber-ducky` invocation, so users never pay first-call download
# latency mid-task.
#
# The download runs in the background (stdio detached) and this script exits 0
# immediately — session start is never blocked on the network. When the binary
# is already cached the backgrounded bootstrap is a no-op that exits in
# milliseconds. A failed pre-warm is silent by design: the first real call
# either finds the binary (a later pre-warm succeeded) or surfaces the real
# download error with context.
PLUGIN_ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
WRAPPER="$PLUGIN_ROOT/bin/rubber-ducky"
[ -x "$WRAPPER" ] || exit 0
RUBBER_DUCKY_BOOTSTRAP_ONLY=1 "$WRAPPER" >/dev/null 2>&1 </dev/null &
exit 0
