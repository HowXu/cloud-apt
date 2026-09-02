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

export GPG_PASSPHRASE

cd "$REPO_ROOT"

# 1. 记下推送前的文件列表 (path + checksum)
BEFORE=$(find dists pool -type f -exec md5sum {} + 2>/dev/null | sort || true)

# 2. reprepro 吸收 + 重新签名
reprepro includedeb "$CODENAME" "$DEB"
reprepro export "$CODENAME"

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
        -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" \
        -H "Content-Type: $CT" \
        --data-binary "@$f"; then
        echo "  ✗ 上传失败: $f" >&2
        exit 1
    fi
done

# 5. 通知 Worker 失效缓存
curl -fsS -X POST "$WORKER_URL/api/invalidate?suite=$CODENAME" \
    -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" || \
    echo "  ⚠ 缓存失效失败, 最多 5 分钟自动失效"

unset GPG_PASSPHRASE

PKG_NAME=$(basename "$DEB" | sed 's/_.*//')
echo ""
echo "✓ 已推送: $DEB → $CODENAME"
echo "  安装: sudo apt update && sudo apt install $PKG_NAME"