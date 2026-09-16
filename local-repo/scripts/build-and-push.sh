#!/usr/bin/env bash
# Usage: ./build-and-push.sh <path-to-deb> [codename]
#        ./build-and-push.sh --remove <package> [codename]
#        ./build-and-push.sh --sync [codename]
set -euo pipefail

MODE="include"
case "${1:-}" in
    --remove)
        MODE="remove"
        REMOVE_PKG="${2:?--remove requires <package>}"
        CODENAME="${3:-kali-rolling}"
        shift 2
        ;;
    --sync)
        MODE="sync"
        CODENAME="${2:-kali-rolling}"
        shift
        ;;
    --help|-h)
        sed -n '2,4p' "$0"
        exit 0
        ;;
    *)
        DEB="${1:?Requires a .deb file path}"
        CODENAME="${2:-kali-rolling}"
        ;;
esac

REPO_ROOT="${CLOUD_APT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
: "${WORKER_URL:?WORKER_URL must be set}"
: "${ADMIN_PUSH_TOKEN:?ADMIN_PUSH_TOKEN must be set}"
: "${GPG_PASSPHRASE:?GPG_PASSPHRASE must be set}"

if [[ "$MODE" == "include" ]]; then
    # Resolve the DEB path to an absolute one up front; after the cd below,
    # reprepro would otherwise look for it under REPO_ROOT.
    DEB="$(realpath "$DEB")"
fi

# Pass token via curl config file to keep it out of argv (visible to ps/e)
_CURL_CONF=$(mktemp)
chmod 600 "$_CURL_CONF"
printf 'header = "Authorization: Bearer %s"\n' "$ADMIN_PUSH_TOKEN" > "$_CURL_CONF"
trap 'shred -u "$_CURL_CONF" 2>/dev/null; rm -f "$_CURL_CONF"; unset ADMIN_PUSH_TOKEN; unset GPG_PASSPHRASE' EXIT

export GPG_PASSPHRASE

# Defensive: require conf/distributions to exist; do not rely on a
# 'cd into REPO_ROOT and pray' default.
if [[ ! -f "$REPO_ROOT/conf/distributions" ]]; then
    echo "[ERROR] $REPO_ROOT/conf/distributions does not exist" >&2
    echo "        run ./local-repo/scripts/setup-reprepro.sh + gen-key.sh first" >&2
    exit 1
fi

# Defensive: detect a placeholder left over by an aborted gen-key.sh.
if grep -q '^SignWith:.*__GPG_EMAIL__' "$REPO_ROOT/conf/distributions"; then
    echo "[ERROR] conf/distributions still has the placeholder (SignWith: __GPG_EMAIL__)" >&2
    echo "        run ./local-repo/scripts/gen-key.sh to generate a key and replace it" >&2
    exit 1
fi

CONFDIR="$REPO_ROOT/conf"

cd "$REPO_ROOT"

# 1. Snapshot files (path + checksum) before the reprepro run.
BEFORE=$(find dists pool -type f -exec md5sum {} + 2>/dev/null | sort || true)

# 2. Run reprepro in the selected mode. --confdir is explicit so the
#    script behaves the same regardless of the caller's CWD.
case "$MODE" in
    remove)
        if [[ "${YES:-}" != "1" ]]; then
            read -rp "Confirm remove $REMOVE_PKG from $CODENAME? [y/N] " ans
            if [[ ! "$ans" =~ ^[Yy]$ ]]; then
                echo "Canceled"
                exit 1
            fi
        fi
        echo "[INFO]  reprepro remove $CODENAME $REMOVE_PKG"
        reprepro --confdir "$CONFDIR" remove "$CODENAME" "$REMOVE_PKG"
        reprepro --confdir "$CONFDIR" export "$CODENAME"
        ;;
    sync)
        echo "[INFO]  reprepro export $CODENAME (sync only)"
        reprepro --confdir "$CONFDIR" export "$CODENAME"
        ;;
    include)
        reprepro --confdir "$CONFDIR" includedeb "$CODENAME" "$DEB"
        reprepro --confdir "$CONFDIR" export "$CODENAME"
        ;;
esac

# 3. Diff to find newly added or changed files (either path or checksum).
AFTER=$(find dists pool -type f -exec md5sum {} + 2>/dev/null | sort || true)
TO_UPLOAD=$(comm -13 <(echo "$BEFORE") <(echo "$AFTER") | awk '{print $2}')

if [[ -z "$TO_UPLOAD" ]]; then
    echo "[ERROR] No files to upload (deb may not have been applied)" >&2
    exit 1
fi

# 4. Upload each file
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    CT="application/octet-stream"
    case "$f" in
        *.deb)        CT="application/vnd.debian.binary-package" ;;
        *.gz)         CT="application/gzip" ;;
        *Release|*InRelease|*Packages) CT="text/plain" ;;
        *.asc)        CT="text/plain" ;;
    esac
    echo "[INFO]  PUT /api/upload/$f"
    if ! curl -fsS -X PUT "$WORKER_URL/api/upload/$f" \
        -K "$_CURL_CONF" \
        -H "Content-Type: $CT" \
        --data-binary "@$f"; then
        echo "[ERROR] Upload failed: $f" >&2
        exit 1
    fi
done <<< "$TO_UPLOAD"

curl -fsS -X POST "$WORKER_URL/api/invalidate?suite=$CODENAME" \
    -K "$_CURL_CONF" || \
    echo "[WARN]  Cache invalidation failed; entries expire automatically within ~5 minutes"

unset GPG_PASSPHRASE
unset ADMIN_PUSH_TOKEN

echo ""
case "$MODE" in
    include)
        PKG_NAME=$(basename "$DEB" | sed 's/_.*//')
        echo "[OK]    Uploaded: $DEB to $CODENAME"
        echo "        Install: sudo apt update && sudo apt install $PKG_NAME"
        ;;
    remove)
        echo "[OK]    Removed from $CODENAME and pushed signed index: $REMOVE_PKG"
        ;;
    sync)
        echo "[OK]    Synced and pushed signed index: $CODENAME"
        ;;
esac
