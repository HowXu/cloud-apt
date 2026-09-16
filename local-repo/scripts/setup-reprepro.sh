#!/usr/bin/env bash
# One-shot: create runtime directories under local-repo/ without touching
# $HOME. Default REPO_ROOT is the project-local local-repo/; override with
# CLOUD_APT_ROOT.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="${CLOUD_APT_ROOT:-$SCRIPT_DIR}"

echo "[INFO]  Initializing local repository at: $REPO_ROOT"

# Runtime directories (gitignored). conf/ already exists (it ships
# distributions.template); create the rest.
mkdir -p "$REPO_ROOT"/{incoming,pool,dists,keys,db}
chmod 700 "$REPO_ROOT/keys"

# Clone conf/distributions from the template only when no live file exists.
DIST="$REPO_ROOT/conf/distributions"
TEMPLATE="$SCRIPT_DIR/conf/distributions.template"
if [[ ! -f "$DIST" ]]; then
    if [[ ! -f "$TEMPLATE" ]]; then
        echo "[ERROR] Template $TEMPLATE is missing; the project tree looks broken" >&2
        exit 1
    fi
    cp "$TEMPLATE" "$DIST"
    echo "[OK]    Cloned conf/distributions from template (gen-key.sh will replace the SignWith placeholder)"
fi

# scripts/ and dockerfiles/ already live under $REPO_ROOT, so do not copy them.
echo ""
echo "[OK]    Repository structure ready at: $REPO_ROOT"
