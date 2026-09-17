#!/usr/bin/env bash
# One-shot: generate a GPG key pair (ed25519, 2-year expiry).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="${CLOUD_APT_ROOT:-$SCRIPT_DIR}"
KEY_DIR="$REPO_ROOT/keys"

# M-3: a partial keys/ state (e.g. only public.key, missing
# private.key.gpg) is a corruption condition. Generating a new key
# blindly would create inconsistencies with the leftover files, so
# refuse and let the operator decide on a backup/cleanup strategy.
# Only proceed when keys/ is fully empty or all three files are present.
EXISTING_KEYS=()
[[ -s "$KEY_DIR/public.key" ]]     && EXISTING_KEYS+=("public.key")
[[ -s "$KEY_DIR/private.key.gpg" ]] && EXISTING_KEYS+=("private.key.gpg")
[[ -s "$KEY_DIR/keyid.txt" ]]       && EXISTING_KEYS+=("keyid.txt")
if [[ "${#EXISTING_KEYS[@]}" -gt 0 && "${#EXISTING_KEYS[@]}" -ne 3 ]]; then
    echo "[ERROR] $KEY_DIR already has a partial key set: ${EXISTING_KEYS[*]}" >&2
    echo "        This is a corrupt state: all three files must be present, or none." >&2
    echo "        To keep the existing material, do NOT re-run this script." >&2
    echo "        To regenerate from scratch, back up and remove them first:" >&2
    echo "          mkdir -p $KEY_DIR.bak && mv $KEY_DIR/*.key* $KEY_DIR/keyid.txt $KEY_DIR.bak/" >&2
    exit 1
fi

echo "[INFO]  Generating GPG key (ed25519, 2-year expiry)"
echo ""

# Reuse an already-exported passphrase if one is set; otherwise prompt.
# read -rs is silent, and without -p the prompt would make it look hung.
if [[ -z "${GPG_PASSPHRASE:-}" ]]; then
    read -rsp "Enter passphrase (private-key password, must be remembered and backed up): " GPG_PASSPHRASE
    echo ""
    if [[ -z "$GPG_PASSPHRASE" ]]; then
        echo "[ERROR] Passphrase cannot be empty" >&2
        exit 1
    fi
else
    echo "(Using already-exported GPG_PASSPHRASE, length ${#GPG_PASSPHRASE})"
fi

# M-12: length check (applies to both the prompted and exported paths).
if [[ ${#GPG_PASSPHRASE} -lt 12 ]]; then
    echo "[ERROR] Passphrase is too short (${#GPG_PASSPHRASE} chars, need at least 12); use a strong password" >&2
    exit 1
fi

# Prompt for the GPG email; it will be written into reprepro.conf's SignWith.
read -rp "Enter GPG email (e.g. apt@example.com): " GPG_EMAIL
if [[ -z "$GPG_EMAIL" ]]; then
    echo "[ERROR] Email cannot be empty" >&2
    exit 1
fi

# Defend against multi-key collisions: if the keyring already has a
# private key for this email, refuse to generate again. reprepro
# defaults to signing InRelease with the newest key while push-key.sh
# exports the first key as pubkey, and a mismatch breaks apt update
# on the client with "Missing key ...".
EXISTING=$(gpg --list-secret-keys --with-colons "$GPG_EMAIL" 2>/dev/null \
    | awk -F: '/^fpr:/ {print $10}' || true)
if [[ -n "$EXISTING" ]]; then
    echo "[ERROR] Keyring already has a private key for <$GPG_EMAIL>:" >&2
    echo "$EXISTING" | sed 's/^/    /' >&2
    echo "        To regenerate, remove them all first:" >&2
    echo "          for fpr in $EXISTING; do gpg --batch --yes --delete-secret-keys \"\$fpr\"; done" >&2
    echo "        Then re-run this script. (Prevents the push-uses-#1, sign-uses-#N mismatch.)" >&2
    exit 1
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

# I-2: no gpg-gen-key.conf is written to disk; passphrase is supplied
# via fd 3.
# M-13: track mktemp temp files so the EXIT trap can shred any residue
# (including private.key).
TMP_FILES=()
cleanup() {
    local f
    for f in "${TMP_FILES[@]}"; do
        [[ -n "$f" && -e "$f" ]] && shred -u "$f" 2>/dev/null || rm -f "$f" 2>/dev/null || true
    done
    [[ -e "$KEY_DIR/private.key" ]] && shred -u "$KEY_DIR/private.key" 2>/dev/null || true
    unset GPG_PASSPHRASE
    gpgconf --kill gpg-agent 2>/dev/null || true
}
trap cleanup EXIT

gpgconf --kill gpg-agent 2>/dev/null || true

# I-2: all options are inlined into the heredoc; passphrase is supplied
# via fd 3 (here-string, never written to disk). gpg-gen-key.conf is
# never created.
gpg --batch --pinentry-mode loopback --passphrase-fd 3 \
    --gen-key 3<<<"$GPG_PASSPHRASE" <<EOF
%echo Generating cloud-apt signing key
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: sign
Name-Real: cloud-apt archive signing key
Name-Email: $GPG_EMAIL
Expire-Date: 2y
%commit
EOF

FPR=$(gpg --list-keys --with-colons "$GPG_EMAIL" | awk -F: '/^fpr:/ {print $10; exit}')

if [[ -z "$FPR" ]]; then
    echo "[ERROR] Key generation failed" >&2
    exit 1
fi

# Add an encryption subkey so config.env can be encrypted to this key in
# future archive exports. The primary remains sign-only (reprepro only
# needs to sign). Passphrase via fd 3 to keep it out of argv / disk.
gpg --batch --pinentry-mode loopback --passphrase-fd 3 \
    --quick-add-key "$FPR" cv25519 encr 0 \
    3<<<"$GPG_PASSPHRASE"

# M-13: atomic write of public.key (tmp + mv, same fs guarantees atomicity).
tmp=$(mktemp "$KEY_DIR/.tmp.XXXX")
TMP_FILES+=("$tmp")
chmod 600 "$tmp"
gpg --export --armor "$FPR" > "$tmp"
mv -f "$tmp" "$KEY_DIR/public.key"

# M-13: atomic write of private.key.
tmp=$(mktemp "$KEY_DIR/.tmp.XXXX")
TMP_FILES+=("$tmp")
chmod 600 "$tmp"
gpg --export-secret-keys --armor "$FPR" > "$tmp"
mv -f "$tmp" "$KEY_DIR/private.key"

# M-11: passphrase also flows through fd 3, never via argv (so it does
# not show up in ps/top).
gpg --batch --yes --pinentry-mode loopback \
    --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 \
    --output "$KEY_DIR/private.key.gpg" "$KEY_DIR/private.key" \
    3<<<"$GPG_PASSPHRASE"

shred -u "$KEY_DIR/private.key"
chmod 600 "$KEY_DIR/private.key.gpg" "$KEY_DIR/public.key"
unset GPG_PASSPHRASE

# M-13: atomic write of keyid.txt for downstream scripts.
tmp=$(mktemp "$KEY_DIR/.tmp.XXXX")
TMP_FILES+=("$tmp")
chmod 600 "$tmp"
cat >"$tmp" <<EOF
EMAIL=$GPG_EMAIL
FPR=$FPR
EOF
mv -f "$tmp" "$KEY_DIR/keyid.txt"
chmod 600 "$KEY_DIR/keyid.txt"

ACTUAL_FPR="$(gpg --list-secret-keys --with-colons "$GPG_EMAIL" 2>/dev/null | awk -F: '/^fpr:/ {print $10; exit}')"
if [[ -z "$ACTUAL_FPR" ]]; then
    echo "[ERROR] Keyring has no private key for <$GPG_EMAIL>; generation may have failed" >&2
    exit 1
fi
if [[ "$ACTUAL_FPR" != "$FPR" ]]; then
    echo "[ERROR] Post-write FPR self-check failed -- keyid.txt=$FPR keyring=$ACTUAL_FPR" >&2
    echo "        Usually this means keys/ was overwritten by stale files. Check:" >&2
    echo "          cat local-repo/keys/keyid.txt" >&2
    echo "          gpg --list-secret-keys --with-colons $GPG_EMAIL" >&2
    exit 1
fi

# Keep conf/distributions' SignWith in sync. Previously this was
# silently skipped when conf/distributions did not exist, leaving a
# __GPG_EMAIL__ placeholder that would later confuse build-and-push.sh.
DIST_FILE="$REPO_ROOT/conf/distributions"
if [[ ! -f "$DIST_FILE" ]]; then
    echo "[ERROR] $DIST_FILE does not exist" >&2
    echo "        Run ./local-repo/scripts/setup-reprepro.sh first to initialize the repo layout" >&2
    exit 1
fi
sed -i "s|SignWith:.*|SignWith: $GPG_EMAIL|" "$DIST_FILE"

# Defensive: confirm the replacement actually took effect (sed silent
# failure or template drift).
if grep -q '^SignWith:.*__GPG_EMAIL__' "$DIST_FILE"; then
    echo "[ERROR] SignWith replacement failed; placeholder is still present" >&2
    echo "        The template format may have changed; inspect $DIST_FILE manually" >&2
    exit 1
fi
echo "[OK]    Updated SignWith in $DIST_FILE"

echo ""
echo "[OK]    Key generation complete"
echo "        Public key:         $KEY_DIR/public.key"
echo "        Private key (encrypted): $KEY_DIR/private.key.gpg"
echo "[WARN]  Strongly consider syncing $KEY_DIR/private.key.gpg to your password manager"
