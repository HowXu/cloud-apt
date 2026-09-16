#!/usr/bin/env bash
# Push the GPG public key to the Worker.
set -euo pipefail

REPO_ROOT="${CLOUD_APT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
KEY_FILE="$REPO_ROOT/keys/public.key"
: "${WORKER_URL:?WORKER_URL must be set (e.g. https://apt.example.com)}"
: "${ADMIN_PUSH_TOKEN:?ADMIN_PUSH_TOKEN must be set}"

[[ "$WORKER_URL" == https://* ]] || { echo "[ERROR] WORKER_URL must start with https:// (avoids sending the token in plaintext)" >&2; exit 1; }

# Extract the domain from WORKER_URL and validate its characters
# (mirrors push-install.sh, M-21).
DOMAIN="${WORKER_URL#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%%/*}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "[ERROR] WORKER_URL has an invalid domain: $DOMAIN" >&2; exit 1; }

# Pass token via curl config file to keep it out of argv (visible to ps/e)
_CURL_CONF=$(mktemp)
chmod 600 "$_CURL_CONF"
printf 'header = "Authorization: Bearer %s"\n' "$ADMIN_PUSH_TOKEN" > "$_CURL_CONF"
trap 'shred -u "$_CURL_CONF" 2>/dev/null; rm -f "$_CURL_CONF"; unset ADMIN_PUSH_TOKEN' EXIT

if [[ ! -f "$KEY_FILE" ]]; then
    echo "[ERROR] Cannot find $KEY_FILE; run gen-key.sh first" >&2
    exit 1
fi

echo "[INFO]  Pushing public key to $WORKER_URL/api/upload/pubkey.asc"

curl -fsS -X PUT "$WORKER_URL/api/upload/pubkey.asc" \
    -K "$_CURL_CONF" \
    -H "Content-Type: text/plain" \
    --data-binary "@$KEY_FILE"

unset ADMIN_PUSH_TOKEN

echo ""
echo "[OK]    Public key pushed"
echo "        Clients can fetch it from https://${WORKER_URL#https://}/pubkey.asc"
