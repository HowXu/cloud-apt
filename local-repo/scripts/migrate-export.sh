#!/usr/bin/env bash
# 把整个本地 apt 仓库 (keys, conf, db, pool, dists) 打包成可迁移的 tar.gz,
# 顶部含 EXPORT-MANIFEST.json, 供 migrate-import.sh 校验 magic.
#
# 用法:
#   ./migrate-export.sh                       # 默认输出到 ~/cloud-apt/cloud-apt-export-<时间戳>.tar.gz
#   ./migrate-export.sh /path/to/out.tar.gz   # 自定义输出
#   INCLUDE_DISTS=0 ./migrate-export.sh       # 不打包 dists/ (体积更小, 导入后需 reprepro export 重签)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="${CLOUD_APT_ROOT:-$SCRIPT_DIR}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${1:-$REPO_ROOT/cloud-apt-export-$TS.tar.gz}"

# ---------- 前置校验 ----------
if [[ ! -d "$REPO_ROOT" ]]; then
    echo "✗ REPO_ROOT 不存在: $REPO_ROOT" >&2
    echo "  请先运行 setup-reprepro.sh 初始化" >&2
    exit 1
fi

KEY_DIR="$REPO_ROOT/keys"
CONF_DIR="$REPO_ROOT/conf"
DB_DIR="$REPO_ROOT/db"
POOL_DIR="$REPO_ROOT/pool"
DISTS_DIR="$REPO_ROOT/dists"

for d in "$KEY_DIR" "$CONF_DIR" "$DB_DIR" "$POOL_DIR"; do
    if [[ ! -d "$d" ]]; then
        echo "✗ 缺少目录: $d" >&2
        echo "  请先运行 setup-reprepro.sh + gen-key.sh" >&2
        exit 1
    fi
done

if [[ ! -f "$KEY_DIR/private.key.gpg" ]]; then
    echo "✗ 未找到加密私钥: $KEY_DIR/private.key.gpg" >&2
    echo "  请先运行 gen-key.sh" >&2
    exit 1
fi

if [[ ! -f "$KEY_DIR/keyid.txt" ]]; then
    echo "✗ 未找到 $KEY_DIR/keyid.txt" >&2
    exit 1
fi

# 从 keyid.txt 显式解析 EMAIL/FPR (不 source, 避免任意代码执行)
EMAIL="$(grep '^EMAIL=' "$KEY_DIR/keyid.txt" | head -1 | cut -d= -f2-)"
FPR="$(grep '^FPR=' "$KEY_DIR/keyid.txt" | head -1 | cut -d= -f2-)"

if [[ -z "$EMAIL" || -z "$FPR" ]]; then
    echo "✗ keyid.txt 缺少 EMAIL= 或 FPR= 字段" >&2
    exit 1
fi

# ---------- 准备清单 ----------
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cat > "$STAGE/EXPORT-MANIFEST.json" <<EOF
{
  "magic": "CLOUD-APT-EXPORT-V1",
  "version": 1,
  "tool": "cloud-apt",
  "created_at": "$TS",
  "hostname": "$(hostname)",
  "user": "$(whoami)",
  "gpg_email": "$EMAIL",
  "gpg_fpr": "$FPR",
  "include_dists": $([[ "${INCLUDE_DISTS:-1}" == "0" ]] && echo false || echo true)
}
EOF

# 列出要打包的子目录 (相对 REPO_ROOT)
SUBDIRS=()
for d in keys conf db pool; do
    [[ -d "$REPO_ROOT/$d" ]] && SUBDIRS+=("$d")
done
if [[ "${INCLUDE_DISTS:-1}" != "0" ]] && [[ -d "$DISTS_DIR" ]]; then
    SUBDIRS+=("dists")
fi

if [[ ${#SUBDIRS[@]} -eq 0 ]]; then
    echo "✗ 没有可打包的内容" >&2
    exit 1
fi

# ---------- 打包 ----------
mkdir -p "$(dirname "$OUT")"

# 把子目录软链到 STAGE, 然后从 STAGE 单一目录打包.
# tar 多个 -C 不可靠 (GNU tar 后面的 -C 会被当文件参数),
# 用 -h (dereference) 让 tar 跟踪 symlink, 把内容而不是 symlink 本身
# 写入 archive. EXPORT-MANIFEST.json 在 STAGE 里就是真文件, 必须是第一条目
# (import 时先读它), 所以写在数组最前.
for d in "${SUBDIRS[@]}"; do
    ln -s "$REPO_ROOT/$d" "$STAGE/$d"
done
TAR_ARGS=(EXPORT-MANIFEST.json "${SUBDIRS[@]}")
(cd "$STAGE" && tar -czhf "$OUT" "${TAR_ARGS[@]}")

# ---------- 自检 ----------
ARCHIVE_SHA="$(sha256sum "$OUT" | awk '{print $1}')"
ARCHIVE_SIZE="$(stat -c %s "$OUT" 2>/dev/null || stat -f %z "$OUT")"
ARCHIVE_FILES="$(tar -tzf "$OUT" | wc -l)"

# 验证 tar 内容
TAR_FIRST="$(tar -tzf "$OUT" | head -1)"
if [[ "$TAR_FIRST" != "EXPORT-MANIFEST.json" ]]; then
    echo "✗ 打包异常: 第一个条目是 '$TAR_FIRST', 不是 EXPORT-MANIFEST.json" >&2
    rm -f "$OUT"
    exit 1
fi

echo ""
echo "✓ 导出完成: $OUT"
echo "  大小:      $(du -h "$OUT" | awk '{print $1}') ($ARCHIVE_SIZE bytes)"
echo "  文件数:    $ARCHIVE_FILES"
echo "  SHA256:    $ARCHIVE_SHA"
echo "  GPG:       $EMAIL"
echo "  包含:      ${SUBDIRS[*]}"
echo ""
echo "迁移流程:"
echo "  1. 把 $OUT 安全传到新机器 (scp / 加密 U 盘 / password manager 附件)"
echo "  2. 新机器运行: ./local-repo/scripts/migrate-import.sh $OUT"
echo "  3. 导入后 export CLOUD_APT_ROOT=\$(默认 ~/cloud-apt)"
echo ""
echo "⚠ 私钥在包内仍是 passphrase 加密 (private.key.gpg), 务必保管好 passphrase"