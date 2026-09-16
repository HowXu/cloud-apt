#!/usr/bin/env bash
# Push the client install.sh to the Worker (with the domain substituted in).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${WORKER_URL:?WORKER_URL must be set}"
: "${ADMIN_PUSH_TOKEN:?ADMIN_PUSH_TOKEN must be set}"

[[ "$WORKER_URL" == https://* ]] || { echo "[ERROR] WORKER_URL must start with https:// (avoids sending the token in plaintext)" >&2; exit 1; }

# Pass token via curl config file to keep it out of argv (visible to ps/e)
_CURL_CONF=$(mktemp)
chmod 600 "$_CURL_CONF"
printf 'header = "Authorization: Bearer %s"\n' "$ADMIN_PUSH_TOKEN" > "$_CURL_CONF"
trap 'shred -u "$_CURL_CONF" 2>/dev/null; rm -f "$_CURL_CONF"; unset ADMIN_PUSH_TOKEN' EXIT

# Extract the domain from WORKER_URL
DOMAIN="${WORKER_URL#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%%/*}"

# Guard against shell metacharacters in WORKER_URL being interpreted by sed
# (defense in depth, I-6).
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "[ERROR] WORKER_URL resolved to an invalid domain: '$DOMAIN'" >&2
    echo "        Expected format: https://your-worker.workers.dev" >&2
    echo "        Domain may only contain letters, digits, dots, and hyphens" >&2
    exit 1
fi

TMP=$(mktemp)
sed "s|__CLOUD_APT_DOMAIN__|$DOMAIN|g" "$SCRIPT_DIR/install.sh" > "$TMP"

echo "[INFO]  Pushing install.sh to $WORKER_URL/api/upload/scripts/install.sh (domain=$DOMAIN)"

curl -fsS -X PUT "$WORKER_URL/api/upload/scripts/install.sh" \
    -K "$_CURL_CONF" \
    -H "Content-Type: text/plain; charset=utf-8" \
    --data-binary "@$TMP"

rm -f "$TMP"

unset ADMIN_PUSH_TOKEN

echo ""
echo "[OK]    install.sh pushed"
echo "        Client: curl -fsSL https://$DOMAIN/install.sh | sudo bash"
