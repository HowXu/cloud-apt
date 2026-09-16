#!/usr/bin/env bash
# Restore a local apt repo from a cloud-apt-export-<ts>.tar.gz bundle.
# The magic field in EXPORT-MANIFEST.json is used to reject bundles
# that did not come from this tool.
#
# Usage:
#   ./migrate-import.sh <archive.tar.gz>
#   ./migrate-import.sh <archive.tar.gz> /custom/target/path
set -euo pipefail

ARCHIVE="${1:?Requires a path to a .tar.gz export bundle}"
DEFAULT_TARGET="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${2:-${CLOUD_APT_ROOT:-$DEFAULT_TARGET}}"

# ---------- Validate the archive itself ----------
if [[ ! -f "$ARCHIVE" ]]; then
    echo "[ERROR] Archive does not exist: $ARCHIVE" >&2
    exit 1
fi

case "$ARCHIVE" in
    *.tar.gz|*.tgz) ;;
    *) echo "[ERROR] Not a .tar.gz / .tgz file: $ARCHIVE" >&2; exit 1 ;;
esac

# Reject dangerous paths (anything outside the top-level manifest).
# Modern tar refuses absolute paths and '..' by default, but listing
# them explicitly surfaces the issue earlier.
echo "[INFO]  Scanning archive paths..."
if tar -tzf "$ARCHIVE" | grep -E '(^|/)\.\.(/|$)|(^/)' -q; then
    echo "[ERROR] Archive contains dangerous paths (absolute paths or '..'); refusing to extract" >&2
    tar -tzf "$ARCHIVE" | grep -E '(^|/)\.\.(/|$)|(^/)' | head -5 >&2
    exit 1
fi

# ---------- Read the magic ----------
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "[INFO]  Reading manifest..."
if ! tar -xzf "$ARCHIVE" -C "$STAGE" EXPORT-MANIFEST.json 2>/dev/null; then
    echo "[ERROR] Archive does not contain EXPORT-MANIFEST.json; not a cloud-apt export bundle" >&2
    exit 1
fi

if [[ ! -f "$STAGE/EXPORT-MANIFEST.json" ]]; then
    echo "[ERROR] Archive top level is missing EXPORT-MANIFEST.json" >&2
    exit 1
fi

# Parse the magic (avoids depending on jq).
MAGIC="$(grep -o '"magic"[[:space:]]*:[[:space:]]*"[^"]*"' "$STAGE/EXPORT-MANIFEST.json" \
    | head -1 | sed -E 's/.*"([^"]*)"$/\1/')"

EXPECTED="CLOUD-APT-EXPORT-V1"
if [[ "$MAGIC" != "$EXPECTED" ]]; then
    echo "[ERROR] Magic mismatch: '$MAGIC' (expected '$EXPECTED')" >&2
    echo "        This archive is not a cloud-apt export bundle; refusing to import" >&2
    exit 1
fi

# ---------- Show the manifest ----------
echo ""
echo "[OK]    Manifest validated:"
echo "---"
cat "$STAGE/EXPORT-MANIFEST.json"
echo "---"

GPG_EMAIL="$(grep -o '"gpg_email"[[:space:]]*:[[:space:]]*"[^"]*"' "$STAGE/EXPORT-MANIFEST.json" \
    | head -1 | sed -E 's/.*"([^"]*)"$/\1/')"
GPG_FPR="$(grep -o '"gpg_fpr"[[:space:]]*:[[:space:]]*"[^"]*"' "$STAGE/EXPORT-MANIFEST.json" \
    | head -1 | sed -E 's/.*"([^"]*)"$/\1/')"

echo ""
echo "  GPG: $GPG_EMAIL"
echo "  FPR: $GPG_FPR"
echo ""

# ---------- Handle an existing target ----------
if [[ -e "$TARGET" ]]; then
    if [[ -d "$TARGET" ]] && [[ -n "$(ls -A "$TARGET" 2>/dev/null)" ]]; then
        echo "[WARN]  Target already exists and is not empty: $TARGET"
        read -rp "        Continue and overwrite existing files (unrelated files are left alone); old dir will be backed up to ${TARGET}.bak.<ts>. Proceed? [y/N] " CONFIRM
        if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
            echo "Canceled"
            exit 1
        fi
        BACKUP="${TARGET}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
        mv "$TARGET" "$BACKUP"
        echo "        Old directory backed up to: $BACKUP"
    fi
fi

mkdir -p "$TARGET"

# ---------- Extract ----------
echo "[INFO]  Extracting to $TARGET ..."
tar -xzf "$ARCHIVE" -C "$TARGET"

# ---------- Restore permissions ----------
KEYS_DIR="$TARGET/keys"
if [[ -d "$KEYS_DIR" ]]; then
    chmod 700 "$KEYS_DIR"
    [[ -f "$KEYS_DIR/private.key.gpg" ]] && chmod 600 "$KEYS_DIR/private.key.gpg"
    [[ -f "$KEYS_DIR/private.key" ]]      && chmod 600 "$KEYS_DIR/private.key"
    [[ -f "$KEYS_DIR/public.key" ]]       && chmod 644 "$KEYS_DIR/public.key"
    [[ -f "$KEYS_DIR/keyid.txt" ]]        && chmod 600 "$KEYS_DIR/keyid.txt"
fi
# reprepro config is usually world-readable but root-writable; content is public.
[[ -f "$TARGET/conf/distributions" ]] && chmod 644 "$TARGET/conf/distributions"

# ---------- GPG health check ----------
if command -v gpg >/dev/null 2>&1 && [[ -f "$KEYS_DIR/public.key" ]]; then
    echo "[INFO]  Checking GPG public key..."
    if gpg --list-keys "$GPG_EMAIL" >/dev/null 2>&1; then
        echo "[OK]    Public key is already in the keyring"
    else
        echo "[WARN]  Public key is not in the keyring -- reprepro will import it on the first push,"
        echo "        or do it manually: gpg --import $KEYS_DIR/public.key"
    fi
fi

echo ""
echo "[OK]    Import complete: $TARGET"
echo ""
echo "Next steps:"
echo "  export CLOUD_APT_ROOT=$TARGET"
echo "  export GPG_PASSPHRASE=<your passphrase>"
echo "  export WORKER_URL=https://<your-worker>.workers.dev"
echo "  export ADMIN_PUSH_TOKEN=<your token>"
echo "  ./local-repo/scripts/build-and-push.sh <some>.deb"
