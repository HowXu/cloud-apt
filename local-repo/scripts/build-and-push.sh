#!/usr/bin/env bash
# 用法: ./build-and-push.sh <path-to-deb> [codename]
#      ./build-and-push.sh --remove <package> [codename]
#      ./build-and-push.sh --sync [codename]
set -euo pipefail

MODE="include"
case "${1:-}" in
    --remove)
        MODE="remove"
        REMOVE_PKG="${2:?--remove need <package>}"
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
        DEB="${1:?need .deb file path}"
        CODENAME="${2:-kali-rolling}"
        ;;
esac

REPO_ROOT="${CLOUD_APT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
: "${WORKER_URL:?need WORKER_URL}"
: "${ADMIN_PUSH_TOKEN:?need ADMIN_PUSH_TOKEN}"
: "${GPG_PASSPHRASE:?need GPG_PASSPHRASE}"

if [[ "$MODE" == "include" ]]; then
    DEB="$(realpath "$DEB")"
fi

# Pass token via curl config file to keep it out of argv (visible to ps/e)
_CURL_CONF=$(mktemp)
chmod 600 "$_CURL_CONF"
printf 'header = "Authorization: Bearer %s"\n' "$ADMIN_PUSH_TOKEN" > "$_CURL_CONF"
trap 'shred -u "$_CURL_CONF" 2>/dev/null; rm -f "$_CURL_CONF"; unset ADMIN_PUSH_TOKEN; unset GPG_PASSPHRASE' EXIT

export GPG_PASSPHRASE

if [[ ! -f "$REPO_ROOT/conf/distributions" ]]; then
    echo "✗ $REPO_ROOT/conf/distributions DO NOT EXIST" >&2
    echo "  run ./local-repo/scripts/setup-reprepro.sh + gen-key.sh" >&2
    exit 1
fi

if grep -q '^SignWith:.*__GPG_EMAIL__' "$REPO_ROOT/conf/distributions"; then
    echo "✗ conf/distributions keep (SignWith: __GPG_EMAIL__)" >&2
    echo "  run ./local-repo/scripts/gen-key.sh generate GPG secrets and replace __GPG_EMAIL__" >&2
    exit 1
fi

CONFDIR="$REPO_ROOT/conf"

cd "$REPO_ROOT"

BEFORE=$(find dists pool -type f -exec md5sum {} + 2>/dev/null | sort || true)

case "$MODE" in
    remove)
        if [[ "${YES:-}" != "1" ]]; then
            read -rp "Confirm remove $REMOVE_PKG from $CODENAME? [y/N] " ans
            if [[ ! "$ans" =~ ^[Yy]$ ]]; then
                echo "Canceled"
                exit 1
            fi
        fi
        echo "→ reprepro remove $CODENAME $REMOVE_PKG"
        reprepro --confdir "$CONFDIR" remove "$CODENAME" "$REMOVE_PKG"
        reprepro --confdir "$CONFDIR" export "$CODENAME"
        ;;
    sync)
        echo "→ reprepro export $CODENAME (sync only)"
        reprepro --confdir "$CONFDIR" export "$CODENAME"
        ;;
    include)
        reprepro --confdir "$CONFDIR" includedeb "$CODENAME" "$DEB"
        reprepro --confdir "$CONFDIR" export "$CODENAME"
        ;;
esac

AFTER=$(find dists pool -type f -exec md5sum {} + 2>/dev/null | sort || true)
TO_UPLOAD=$(comm -13 <(echo "$BEFORE") <(echo "$AFTER") | awk '{print $2}')

if [[ -z "$TO_UPLOAD" ]]; then
    echo "No file uploaded or the file is invaild"
    exit 1
fi

# 4. 推送每个文件
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    CT="application/octet-stream"
    case "$f" in
        *.deb)        CT="application/vnd.debian.binary-package" ;;
        *.gz)         CT="application/gzip" ;;
        *Release|*InRelease|*Packages) CT="text/plain" ;;
        *.asc)        CT="text/plain" ;;
    esac
    echo "  → PUT /api/upload/$f"
    if ! curl -fsS -X PUT "$WORKER_URL/api/upload/$f" \
        -K "$_CURL_CONF" \
        -H "Content-Type: $CT" \
        --data-binary "@$f"; then
        echo "Upload Failed: $f" >&2
        exit 1
    fi
done <<< "$TO_UPLOAD"

curl -fsS -X POST "$WORKER_URL/api/invalidate?suite=$CODENAME" \
    -K "$_CURL_CONF" || \
    echo "Cache is invaild. Automatically being invaild after 5 mins"

unset GPG_PASSPHRASE
unset ADMIN_PUSH_TOKEN

echo ""
case "$MODE" in
    include)
        PKG_NAME=$(basename "$DEB" | sed 's/_.*//')
        echo "Uploaded: $DEB → $CODENAME"
        echo "Install: sudo apt update && sudo apt install $PKG_NAME"
        ;;
    remove)
        echo "Removed from $CODENAME and push PKG: $REMOVE_PKG"
        ;;
    sync)
        echo "Sync Successfully: $CODENAME"
        ;;
esac