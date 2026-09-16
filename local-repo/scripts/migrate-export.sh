#!/usr/bin/env bash
# Bundle the entire local apt repo (keys, conf, db, pool, dists) into a
# portable tar.gz with an EXPORT-MANIFEST.json at the top, so
# migrate-import.sh can validate the magic field.
#
# Usage:
#   ./migrate-export.sh                       # default: ~/cloud-apt/cloud-apt-export-<timestamp>.tar.gz
#   ./migrate-export.sh /path/to/out.tar.gz   # custom output
#   INCLUDE_DISTS=0 ./migrate-export.sh       # skip dists/ (smaller; re-run reprepro export to re-sign after import)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="${CLOUD_APT_ROOT:-$SCRIPT_DIR}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${1:-$REPO_ROOT/cloud-apt-export-$TS.tar.gz}"

# ---------- Preflight checks ----------
if [[ ! -d "$REPO_ROOT" ]]; then
    echo "[ERROR] REPO_ROOT does not exist: $REPO_ROOT" >&2
    echo "        Run setup-reprepro.sh first" >&2
    exit 1
fi

KEY_DIR="$REPO_ROOT/keys"
CONF_DIR="$REPO_ROOT/conf"
DB_DIR="$REPO_ROOT/db"
POOL_DIR="$REPO_ROOT/pool"
DISTS_DIR="$REPO_ROOT/dists"

for d in "$KEY_DIR" "$CONF_DIR" "$DB_DIR" "$POOL_DIR"; do
    if [[ ! -d "$d" ]]; then
        echo "[ERROR] Missing directory: $d" >&2
        echo "        Run setup-reprepro.sh + gen-key.sh first" >&2
        exit 1
    fi
done

if [[ ! -f "$KEY_DIR/private.key.gpg" ]]; then
    echo "[ERROR] Encrypted private key not found: $KEY_DIR/private.key.gpg" >&2
    echo "        Run gen-key.sh first" >&2
    exit 1
fi

if [[ ! -f "$KEY_DIR/keyid.txt" ]]; then
    echo "[ERROR] $KEY_DIR/keyid.txt not found" >&2
    exit 1
fi

# Explicitly parse EMAIL/FPR from keyid.txt (do not source it; that
# would allow arbitrary code execution).
EMAIL="$(grep '^EMAIL=' "$KEY_DIR/keyid.txt" | head -1 | cut -d= -f2-)"
FPR="$(grep '^FPR=' "$KEY_DIR/keyid.txt" | head -1 | cut -d= -f2-)"

if [[ -z "$EMAIL" || -z "$FPR" ]]; then
    echo "[ERROR] keyid.txt is missing the EMAIL= or FPR= field" >&2
    exit 1
fi

# ---------- Build the manifest ----------
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Use jq to safely JSON-escape hostname/whoami (guards against JSON
# injection, M-16).
if command -v jq >/dev/null 2>&1; then
    HOSTNAME_ESC=$(hostname | jq -Rs '.')
    USER_ESC=$(whoami | jq -Rs '.')
else
    HOSTNAME_ESC=$(hostname | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read().rstrip("\n")))')
    USER_ESC=$(whoami | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read().rstrip("\n")))')
fi

cat > "$STAGE/EXPORT-MANIFEST.json" <<EOF
{
  "magic": "CLOUD-APT-EXPORT-V1",
  "version": 1,
  "tool": "cloud-apt",
  "created_at": "$TS",
  "hostname": $HOSTNAME_ESC,
  "user": $USER_ESC,
  "gpg_email": "$EMAIL",
  "gpg_fpr": "$FPR",
  "include_dists": $([[ "${INCLUDE_DISTS:-1}" == "0" ]] && echo false || echo true)
}
EOF

# List the subdirectories to include (relative to REPO_ROOT).
SUBDIRS=()
for d in keys conf db pool; do
    [[ -d "$REPO_ROOT/$d" ]] && SUBDIRS+=("$d")
done
if [[ "${INCLUDE_DISTS:-1}" != "0" ]] && [[ -d "$DISTS_DIR" ]]; then
    SUBDIRS+=("dists")
fi

if [[ ${#SUBDIRS[@]} -eq 0 ]]; then
    echo "[ERROR] Nothing to bundle" >&2
    exit 1
fi

# ---------- Pack ----------
mkdir -p "$(dirname "$OUT")"

# Symlink each subdir into STAGE, then archive from STAGE in a single
# root. Multiple -C flags in tar are not reliable (GNU tar treats
# later -C as a filename), so use -h (dereference) to follow symlinks
# and write the real contents, not the symlinks themselves.
# EXPORT-MANIFEST.json in STAGE is a real file and must be the first
# entry (import reads it first), so it sits at the head of the array.
for d in "${SUBDIRS[@]}"; do
    ln -s "$REPO_ROOT/$d" "$STAGE/$d"
done
TAR_ARGS=(EXPORT-MANIFEST.json "${SUBDIRS[@]}")
(cd "$STAGE" && tar -czhf "$OUT" "${TAR_ARGS[@]}")

# ---------- Self-check ----------
ARCHIVE_SHA="$(sha256sum "$OUT" | awk '{print $1}')"
ARCHIVE_SIZE="$(stat -c %s "$OUT" 2>/dev/null || stat -f %z "$OUT")"
ARCHIVE_FILES="$(tar -tzf "$OUT" | wc -l)"

# Verify the tar contents
TAR_FIRST="$(tar -tzf "$OUT" | head -1)"
if [[ "$TAR_FIRST" != "EXPORT-MANIFEST.json" ]]; then
    echo "[ERROR] Archive looks wrong: first entry is '$TAR_FIRST', not EXPORT-MANIFEST.json" >&2
    rm -f "$OUT"
    exit 1
fi

echo ""
echo "[OK]    Export complete: $OUT"
echo "        Size:      $(du -h "$OUT" | awk '{print $1}') ($ARCHIVE_SIZE bytes)"
echo "        File count: $ARCHIVE_FILES"
echo "        SHA256:    $ARCHIVE_SHA"
echo "        GPG:       $EMAIL"
echo "        Contains:  ${SUBDIRS[*]}"
echo ""
echo "Migration steps:"
echo "  1. Transfer $OUT to the new host securely (scp / encrypted USB / password manager attachment)"
echo "  2. On the new host, run: ./local-repo/scripts/migrate-import.sh $OUT"
echo "  3. After import, export CLOUD_APT_ROOT=\$(default ~/cloud-apt)"
echo ""
echo "[WARN]  The private key in the bundle is still passphrase-encrypted (private.key.gpg); keep the passphrase safe"
