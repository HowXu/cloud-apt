#!/usr/bin/env bash
# Bundle repo state into a portable .tar.gz for migration.
# Usage: migrate-export.sh [/path/to/out.tar.gz]   (INCLUDE_DISTS=0 to skip dists/)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/migrate.py" export "$@"