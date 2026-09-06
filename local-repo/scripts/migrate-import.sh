#!/usr/bin/env bash
# 从 cloud-apt-export-<ts>.tar.gz 还原本地 apt 仓库.
# 通过 EXPORT-MANIFEST.json 里的 magic 字段拒绝非 cloud-apt 包.
#
# 用法:
#   ./migrate-import.sh <archive.tar.gz>
#   ./migrate-import.sh <archive.tar.gz> /custom/target/path
set -euo pipefail

ARCHIVE="${1:?需要 .tar.gz 导出包路径}"
DEFAULT_TARGET="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${2:-${CLOUD_APT_ROOT:-$DEFAULT_TARGET}}"

# ---------- 校验 archive 本身 ----------
if [[ ! -f "$ARCHIVE" ]]; then
    echo "✗ 导出包不存在: $ARCHIVE" >&2
    exit 1
fi

case "$ARCHIVE" in
    *.tar.gz|*.tgz) ;;
    *) echo "✗ 不是 .tar.gz / .tgz 文件: $ARCHIVE" >&2; exit 1 ;;
esac

# 拒绝危险路径 (-- 顶部 manifest 之外)
# 现代 tar 默认拒绝绝对路径和 '..', 但显式列出会更早 fail
echo "→ 校验 archive 路径..."
if tar -tzf "$ARCHIVE" | grep -E '(^|/)\.\.(/|$)|(^/)' -q; then
    echo "✗ archive 含危险路径 (绝对路径或 '..'), 拒绝解包" >&2
    tar -tzf "$ARCHIVE" | grep -E '(^|/)\.\.(/|$)|(^/)' | head -5 >&2
    exit 1
fi

# ---------- 读 magic ----------
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "→ 读取 manifest..."
if ! tar -xzf "$ARCHIVE" -C "$STAGE" EXPORT-MANIFEST.json 2>/dev/null; then
    echo "✗ archive 不含 EXPORT-MANIFEST.json, 不是 cloud-apt 导出包" >&2
    exit 1
fi

if [[ ! -f "$STAGE/EXPORT-MANIFEST.json" ]]; then
    echo "✗ archive 顶部不含 EXPORT-MANIFEST.json" >&2
    exit 1
fi

# 解析 magic (避免 jq 依赖)
MAGIC="$(grep -o '"magic"[[:space:]]*:[[:space:]]*"[^"]*"' "$STAGE/EXPORT-MANIFEST.json" \
    | head -1 | sed -E 's/.*"([^"]*)"$/\1/')"

EXPECTED="CLOUD-APT-EXPORT-V1"
if [[ "$MAGIC" != "$EXPECTED" ]]; then
    echo "✗ magic 不匹配: '$MAGIC' (期望 '$EXPECTED')" >&2
    echo "  → 此 archive 不是 cloud-apt 导出包, 拒绝导入" >&2
    exit 1
fi

# ---------- 显示 manifest ----------
echo ""
echo "✓ Manifest 通过校验:"
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

# ---------- 处理 target 已存在 ----------
if [[ -e "$TARGET" ]]; then
    if [[ -d "$TARGET" ]] && [[ -n "$(ls -A "$TARGET" 2>/dev/null)" ]]; then
        echo "⚠ 目标已存在且非空: $TARGET"
        read -rp "  继续将覆盖现有文件 (不删除不相关文件), 旧目录备份到 ${TARGET}.bak.<ts>. 确认? [y/N] " CONFIRM
        if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
            echo "已取消"
            exit 1
        fi
        BACKUP="${TARGET}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
        mv "$TARGET" "$BACKUP"
        echo "  旧目录已备份: $BACKUP"
    fi
fi

mkdir -p "$TARGET"

# ---------- 解包 ----------
echo "→ 解包到 $TARGET ..."
tar -xzf "$ARCHIVE" -C "$TARGET"

# ---------- 权限还原 ----------
KEYS_DIR="$TARGET/keys"
if [[ -d "$KEYS_DIR" ]]; then
    chmod 700 "$KEYS_DIR"
    [[ -f "$KEYS_DIR/private.key.gpg" ]] && chmod 600 "$KEYS_DIR/private.key.gpg"
    [[ -f "$KEYS_DIR/private.key" ]]      && chmod 600 "$KEYS_DIR/private.key"
    [[ -f "$KEYS_DIR/public.key" ]]       && chmod 644 "$KEYS_DIR/public.key"
    [[ -f "$KEYS_DIR/keyid.txt" ]]        && chmod 600 "$KEYS_DIR/keyid.txt"
fi
# reprepro 配置通常 root-only 写, 内容公开
[[ -f "$TARGET/conf/distributions" ]] && chmod 644 "$TARGET/conf/distributions"

# ---------- GPG 健康检查 ----------
if command -v gpg >/dev/null 2>&1 && [[ -f "$KEYS_DIR/public.key" ]]; then
    echo "→ GPG 公钥检查..."
    if gpg --list-keys "$GPG_EMAIL" >/dev/null 2>&1; then
        echo "  ✓ 公钥已在 keyring"
    else
        echo "  ⚠ 公钥不在 keyring — 第一次 push 时 reprepro 会自动 import,"
        echo "    或手动: gpg --import $KEYS_DIR/public.key"
    fi
fi

echo ""
echo "✓ 导入完成: $TARGET"
echo ""
echo "下一步:"
echo "  export CLOUD_APT_ROOT=$TARGET"
echo "  export GPG_PASSPHRASE=<你的 passphrase>"
echo "  export WORKER_URL=https://<your-worker>.workers.dev"
echo "  export ADMIN_PUSH_TOKEN=<你的 token>"
echo "  ./local-repo/scripts/build-and-push.sh <some>.deb"