#!/usr/bin/env bash
# 一次性: 生成 GPG 密钥对 (ed25519, 2 年过期)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="${CLOUD_APT_ROOT:-$SCRIPT_DIR}"
KEY_DIR="$REPO_ROOT/keys"

echo "→ GPG 密钥生成 (ed25519, 2 年过期)"
echo ""

# 已经 export 过就直接用, 否则才交互读 (read -rs 是 silent,
# 没 -p 提示符会让人以为卡住了)
if [[ -z "${GPG_PASSPHRASE:-}" ]]; then
    read -rsp "请输入 passphrase (私钥密码, 必须记住并备份): " GPG_PASSPHRASE
    echo ""
    if [[ -z "$GPG_PASSPHRASE" ]]; then
        echo "✗ passphrase 不能为空" >&2
        exit 1
    fi
else
    echo "(使用已 export 的 GPG_PASSPHRASE, 长度 ${#GPG_PASSPHRASE})"
fi

# M-12: 长度校验 (apply to both read + export paths)
if [[ ${#GPG_PASSPHRASE} -lt 12 ]]; then
    echo "✗ passphrase 太短 (${#GPG_PASSPHRASE} 字符, 至少 12), 请使用强密码" >&2
    exit 1
fi

# 询问邮箱 (会写入 reprepro.conf 的 SignWith)
read -rp "请输入 GPG 邮箱 (例如 apt@example.com): " GPG_EMAIL
if [[ -z "$GPG_EMAIL" ]]; then
    echo "✗ 邮箱不能为空" >&2
    exit 1
fi

# 防多 key 冲突: 如果 keyring 已经有该邮箱的私钥, 拒绝再次生成.
# (reprepro 默认用最新一把签 InRelease, push-key.sh 用第一把导出 pubkey,
#  两把不一致 → 客户端 apt update 报 "Missing key ...")
EXISTING=$(gpg --list-secret-keys --with-colons "$GPG_EMAIL" 2>/dev/null \
    | awk -F: '/^fpr:/ {print $10}' || true)
if [[ -n "$EXISTING" ]]; then
    echo "✗ keyring 已经有 <$GPG_EMAIL> 的私钥:" >&2
    echo "$EXISTING" | sed 's/^/    /' >&2
    echo "  如要重新生成, 先手动删除全部:" >&2
    echo "    for fpr in $EXISTING; do gpg --batch --yes --delete-secret-keys \"\$fpr\"; done" >&2
    echo "  然后重跑本脚本. (避免 'push 用 #1, 签用 #N' 的密钥错位)" >&2
    exit 1
fi

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

# I-2: 不再写 gpg-gen-key.conf 到磁盘, passphrase 通过 fd 3 传入.
# M-13: 跟踪 mktemp 临时文件, EXIT 时 shred 残留 (含 private.key).
TMP_FILES=()
cleanup() {
    local f
    for f in "${TMP_FILES[@]}"; do
        [[ -n "$f" && -e "$f" ]] && shred -u "$f" 2>/dev/null || rm -f "$f" 2>/dev/null || true
    done
    [[ -e "$KEY_DIR/private.key" ]] && shred -u "$KEY_DIR/private.key" 2>/dev/null || true
    unset GPG_PASSPHRASE
}
trap cleanup EXIT

gpgconf --kill gpg-agent 2>/dev/null || true

# I-2: 全部选项 inline 进 stdin (heredoc), passphrase 通过 fd 3 (here-string,
# 不落盘). gpg-gen-key.conf 不再写到磁盘.
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
    echo "✗ 密钥生成失败" >&2
    exit 1
fi

# M-13: 原子写 public.key (tmp + mv, 同 fs 保证原子)
tmp=$(mktemp "$KEY_DIR/.tmp.XXXX")
TMP_FILES+=("$tmp")
chmod 600 "$tmp"
gpg --export --armor "$FPR" > "$tmp"
mv -f "$tmp" "$KEY_DIR/public.key"

# M-13: 原子写 private.key
tmp=$(mktemp "$KEY_DIR/.tmp.XXXX")
TMP_FILES+=("$tmp")
chmod 600 "$tmp"
gpg --export-secret-keys --armor "$FPR" > "$tmp"
mv -f "$tmp" "$KEY_DIR/private.key"

# M-11: passphrase 同样走 fd 3, 不进 argv (避免 ps/top 可见)
gpg --batch --yes --pinentry-mode loopback \
    --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 \
    --output "$KEY_DIR/private.key.gpg" "$KEY_DIR/private.key" \
    3<<<"$GPG_PASSPHRASE"

shred -u "$KEY_DIR/private.key"
chmod 600 "$KEY_DIR/private.key.gpg" "$KEY_DIR/public.key"
unset GPG_PASSPHRASE

# M-13: 原子写 keyid.txt 供后续脚本用
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
    echo "✗ keyring 找不到 <$GPG_EMAIL> 的私钥, 生成疑似失败" >&2
    exit 1
fi
if [[ "$ACTUAL_FPR" != "$FPR" ]]; then
    echo "✗ 写盘后 FPR 自检失败 — keyid.txt=$FPR keyring=$ACTUAL_FPR" >&2
    echo "  通常说明 keys/ 被陈旧文件覆盖了, 检查:" >&2
    echo "    cat local-repo/keys/keyid.txt" >&2
    echo "    gpg --list-secret-keys --with-colons $GPG_EMAIL" >&2
    exit 1
fi

# 同步更新 conf/distributions 的 SignWith.
# 之前会被静默跳过 (conf/distributions 不存在时), 留一个 __GPG_EMAIL__
# 占位符让 build-and-push.sh 后面 fail, 用户摸不着头脑.
DIST_FILE="$REPO_ROOT/conf/distributions"
if [[ ! -f "$DIST_FILE" ]]; then
    echo "✗ $DIST_FILE 不存在" >&2
    echo "  请先跑 ./local-repo/scripts/setup-reprepro.sh 初始化仓库结构" >&2
    exit 1
fi
sed -i "s|SignWith:.*|SignWith: $GPG_EMAIL|" "$DIST_FILE"

# 校验替换真的生效 (防御 sed 静默失败 + 模板格式漂移)
if grep -q '^SignWith:.*__GPG_EMAIL__' "$DIST_FILE"; then
    echo "✗ SignWith 替换失败, 仍是占位符" >&2
    echo "  模板格式可能已变, 需要手动检查 $DIST_FILE" >&2
    exit 1
fi
echo "  ✓ 已更新 $DIST_FILE 的 SignWith"

echo ""
echo "✓ 密钥生成完成"
echo "  公钥: $KEY_DIR/public.key"
echo "  私钥 (加密): $KEY_DIR/private.key.gpg"
echo "  ⚠ 强烈建议把 $KEY_DIR/private.key.gpg 同步到密码管理器"