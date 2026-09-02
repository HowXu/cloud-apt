#!/usr/bin/env bash
# 推送 GPG 公钥到 Worker
set -euo pipefail

REPO_ROOT="${CLOUD_APT_ROOT:-$HOME/cloud-apt}"
KEY_FILE="$REPO_ROOT/keys/public.key"
: "${WORKER_URL:?需要设置 WORKER_URL (例如 https://apt.example.com)}"
: "${ADMIN_PUSH_TOKEN:?需要设置 ADMIN_PUSH_TOKEN}"

if [[ ! -f "$KEY_FILE" ]]; then
    echo "✗ 找不到 $KEY_FILE, 请先跑 gen-key.sh" >&2
    exit 1
fi

echo "→ 推送公钥到 $WORKER_URL/api/upload/pubkey.asc"

curl -fsS -X PUT "$WORKER_URL/api/upload/pubkey.asc" \
    -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" \
    -H "Content-Type: text/plain" \
    --data-binary "@$KEY_FILE"

echo ""
echo "✓ 公钥已推送"
echo "  客户端访问 https://${WORKER_URL#https://}/pubkey.asc 应能下载到"