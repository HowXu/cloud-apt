#!/usr/bin/env bash
# Public entry: upload a .deb to cloud-apt.
# Usage: push.sh <path-to-deb> [codename]
#        push.sh --sync [codename] | --resume [codename]
#        push.sh --remove <package> [codename]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-ui.sh
. "$SCRIPT_DIR/lib-ui.sh"
# shellcheck source=lib-config.sh
. "$SCRIPT_DIR/lib-config.sh"

load_config || die "Missing $CONFIG_PATH, run init.sh first"
export WORKER_URL ADMIN_PUSH_TOKEN

# Maintenance modes forward verbatim to publish.py; they never need a .deb or
# (for --sync) a GPG passphrase, so handle them before the .deb validation.
case "${1:-}" in
    --sync|--resume|--remove)
        "$SCRIPT_DIR/build-and-push.sh" "$@"
        exit $?
        ;;
esac

DEB="${1:?Usage: push.sh <path-to-deb> [codename] | --sync | --resume | --remove <pkg>}"
CODENAME="${2:-kali-rolling}"

[[ -f "$DEB" ]] || die "Cannot find .deb: $DEB"
[[ "$(realpath "$DEB")" == *.deb ]] || die "Path must point to a .deb file: $DEB"

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