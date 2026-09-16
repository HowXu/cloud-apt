#!/usr/bin/env bash
# Restore repo state from a cloud-apt export bundle.
# Usage: migrate-import.sh <archive.tar.gz> [/custom/target/path]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/migrate.py" import "$@"