#!/usr/bin/env bash
# Usage: build-and-push.sh <path-to-deb> [codename]
#        build-and-push.sh --remove <package> [codename]
#        build-and-push.sh --sync [codename] | --resume [codename]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/publish.py" "$@"