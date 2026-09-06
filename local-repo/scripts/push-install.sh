#!/usr/bin/env bash
# 推送客户端 install.sh 到 Worker (带域名替换)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${WORKER_URL:?需要设置 WORKER_URL}"
: "${ADMIN_PUSH_TOKEN:?需要设置 ADMIN_PUSH_TOKEN}"

[[ "$WORKER_URL" == https://* ]] || { echo "✗ WORKER_URL 必须以 https:// 开头 (避免明文传 token)" >&2; exit 1; }

# Pass token via curl config file to keep it out of argv (visible to ps/e)
_CURL_CONF=$(mktemp)
chmod 600 "$_CURL_CONF"
printf 'header = "Authorization: Bearer %s"\n' "$ADMIN_PUSH_TOKEN" > "$_CURL_CONF"
trap 'shred -u "$_CURL_CONF" 2>/dev/null; rm -f "$_CURL_CONF"; unset ADMIN_PUSH_TOKEN' EXIT

# 从 WORKER_URL 提取域名
DOMAIN="${WORKER_URL#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%%/*}"

# 防止 WORKER_URL 中的 shell 元字符被 sed 解释 (I-6)
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "✗ WORKER_URL 解析出非法域名: '$DOMAIN'" >&2
    echo "  期望格式: https://your-worker.workers.dev" >&2
    echo "  域名仅允许字母、数字、点、连字符" >&2
    exit 1
fi

TMP=$(mktemp)
sed "s|__CLOUD_APT_DOMAIN__|$DOMAIN|g" "$SCRIPT_DIR/install.sh" > "$TMP"

echo "→ 推送 install.sh 到 $WORKER_URL/api/upload/scripts/install.sh (domain=$DOMAIN)"

curl -fsS -X PUT "$WORKER_URL/api/upload/scripts/install.sh" \
    -K "$_CURL_CONF" \
    -H "Content-Type: text/plain; charset=utf-8" \
    --data-binary "@$TMP"

rm -f "$TMP"

unset ADMIN_PUSH_TOKEN

echo ""
echo "✓ install.sh 已推送"
echo "  客户端: curl -fsSL https://$DOMAIN/install.sh | sudo bash"