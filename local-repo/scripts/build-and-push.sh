#!/usr/bin/env bash
# 用法: build-and-push.sh <package.deb> [suite]
#       build-and-push.sh --remove <package> [suite]
#       build-and-push.sh --sync [suite] | --resume [suite]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/publish.py" "$@"
