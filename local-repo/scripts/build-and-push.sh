#!/usr/bin/env bash
# Usage: build-and-push.sh <path-to-deb> [codename]
#        build-and-push.sh --remove <package> [codename]
#        build-and-push.sh --sync [codename] | --resume [codename]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-config.sh
. "$SCRIPT_DIR/lib-config.sh"
load_config || { echo "missing config.env; run init.sh first" >&2; exit 1; }
export WORKER_URL ADMIN_PUSH_TOKEN
exec python3 "$SCRIPT_DIR/publish.py" "$@"