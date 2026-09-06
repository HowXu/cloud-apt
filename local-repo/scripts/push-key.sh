#!/usr/bin/env bash
# 推送 GPG 公钥到 Worker
set -euo pipefail

REPO_ROOT="${CLOUD_APT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
KEY_FILE="$REPO_ROOT/keys/public.key"
: "${WORKER_URL:?需要设置 WORKER_URL (例如 https://apt.example.com)}"
: "${ADMIN_PUSH_TOKEN:?需要设置 ADMIN_PUSH_TOKEN}"

# Pass token via curl config file to keep it out of argv (visible to ps/e)
_CURL_CONF=$(mktemp)
chmod 600 "$_CURL_CONF"
printf 'header = "Authorization: Bearer %s"\n' "$ADMIN_PUSH_TOKEN" > "$_CURL_CONF"
trap 'shred -u "$_CURL_CONF" 2>/dev/null; rm -f "$_CURL_CONF"; unset ADMIN_PUSH_TOKEN' EXIT

if [[ ! -f "$KEY_FILE" ]]; then
    echo "✗ 找不到 $KEY_FILE, 请先跑 gen-key.sh" >&2
    exit 1
fi

echo "→ 推送公钥到 $WORKER_URL/api/upload/pubkey.asc"

curl -fsS -X PUT "$WORKER_URL/api/upload/pubkey.asc" \
    -K "$_CURL_CONF" \
    -H "Content-Type: text/plain" \
    --data-binary "@$KEY_FILE"

unset ADMIN_PUSH_TOKEN

echo ""
echo "✓ 公钥已推送"
echo "  客户端访问 https://${WORKER_URL#https://}/pubkey.asc 应能下载到"