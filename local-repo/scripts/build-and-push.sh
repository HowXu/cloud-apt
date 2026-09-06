#!/usr/bin/env bash
# 用法: ./build-and-push.sh <path-to-deb> [codename]
# 默认 codename=kali-rolling
set -euo pipefail

DEB="${1:?需要 .deb 文件路径}"
CODENAME="${2:-kali-rolling}"

REPO_ROOT="${CLOUD_APT_ROOT:-$HOME/cloud-apt}"
: "${WORKER_URL:?需要设置 WORKER_URL}"
: "${ADMIN_PUSH_TOKEN:?需要设置 ADMIN_PUSH_TOKEN}"
: "${GPG_PASSPHRASE:?需要设置 GPG_PASSPHRASE}"

# Pass token via curl config file to keep it out of argv (visible to ps/e)
_CURL_CONF=$(mktemp)
chmod 600 "$_CURL_CONF"
printf 'header = "Authorization: Bearer %s"\n' "$ADMIN_PUSH_TOKEN" > "$_CURL_CONF"
trap 'shred -u "$_CURL_CONF" 2>/dev/null; rm -f "$_CURL_CONF"; unset ADMIN_PUSH_TOKEN' EXIT

export GPG_PASSPHRASE

# 防御: 显式确认 conf/distributions 存在, 不依赖 'cd + 相对路径' 默认值
if [[ ! -f "$REPO_ROOT/conf/distributions" ]]; then
    echo "✗ $REPO_ROOT/conf/distributions 不存在" >&2
    echo "  请先跑 ./local-repo/scripts/setup-reprepro.sh + gen-key.sh" >&2
    exit 1
fi

# 防御: 检测 gen-key.sh 还没跑过的占位符
if grep -q '^SignWith:.*__GPG_EMAIL__' "$REPO_ROOT/conf/distributions"; then
    echo "✗ conf/distributions 仍是模板占位符 (SignWith: __GPG_EMAIL__)" >&2
    echo "  请先跑 ./local-repo/scripts/gen-key.sh 生成 GPG 密钥并替换占位符" >&2
    exit 1
fi

CONFDIR="$REPO_ROOT/conf"

cd "$REPO_ROOT"

# 1. 记下推送前的文件列表 (path + checksum)
BEFORE=$(find dists pool -type f -exec md5sum {} + 2>/dev/null | sort || true)

# 2. reprepro 吸收 + 重新签名. --confdir 显式指明配置目录,
#    即使将来脚本从其他 CWD 调用也不会去找 ./conf/distributions.
reprepro --confdir "$CONFDIR" includedeb "$CODENAME" "$DEB"
reprepro --confdir "$CONFDIR" export "$CODENAME"

# 3. diff 出新增/修改文件 (path 与 checksum 任一变化即视为变化)
AFTER=$(find dists pool -type f -exec md5sum {} + 2>/dev/null | sort || true)
TO_UPLOAD=$(comm -13 <(echo "$BEFORE") <(echo "$AFTER") | awk '{print $2}')

if [[ -z "$TO_UPLOAD" ]]; then
    echo "⚠ 没有需要上传的文件 (deb 可能未生效)"
    exit 1
fi

# 4. 推送每个文件
for f in $TO_UPLOAD; do
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
        echo "  ✗ 上传失败: $f" >&2
        exit 1
    fi
done

# 5. 通知 Worker 失效缓存
curl -fsS -X POST "$WORKER_URL/api/invalidate?suite=$CODENAME" \
    -K "$_CURL_CONF" || \
    echo "  ⚠ 缓存失效失败, 最多 5 分钟自动失效"

unset GPG_PASSPHRASE
unset ADMIN_PUSH_TOKEN

PKG_NAME=$(basename "$DEB" | sed 's/_.*//')
echo ""
echo "✓ 已推送: $DEB → $CODENAME"
echo "  安装: sudo apt update && sudo apt install $PKG_NAME"