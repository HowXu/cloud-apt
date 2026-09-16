#!/usr/bin/env bash
# Public entry: upload a .deb to cloud-apt.
# Usage: push.sh <path-to-deb> [codename]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-ui.sh
. "$SCRIPT_DIR/lib-ui.sh"
# shellcheck source=lib-config.sh
. "$SCRIPT_DIR/lib-config.sh"

DEB="${1:?Usage: push.sh <path-to-deb> [codename]}"
CODENAME="${2:-kali-rolling}"

[[ -f "$DEB" ]] || die "Cannot find .deb: $DEB"
[[ "$(realpath "$DEB")" == *.deb ]] || die "Path must point to a .deb file: $DEB"

load_config || die "Missing $CONFIG_PATH, run init.sh first"
export WORKER_URL ADMIN_PUSH_TOKEN

trap 'unset GPG_PASSPHRASE' EXIT

# GPG passphrase is never written to config.env; cleared by the EXIT trap.
while :; do
    read -rsp "GPG passphrase: " GPG_PASSPHRASE; echo
    [[ -n "$GPG_PASSPHRASE" ]] || { warn "Passphrase cannot be empty"; continue; }
    break
done
export GPG_PASSPHRASE

info "Uploading $DEB to $CODENAME"
"$SCRIPT_DIR/build-and-push.sh" "$DEB" "$CODENAME"

ok "Done: $(basename "$DEB" | sed 's/_.*//')"
ok "Install: sudo apt update && sudo apt install $(basename "$DEB" | sed 's/_.*//')"
