#!/usr/bin/env bash
# 一次性: 生成 GPG 密钥对 (ed25519, 2 年过期)
set -euo pipefail

REPO_ROOT="${CLOUD_APT_ROOT:-$HOME/cloud-apt}"
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

# 询问邮箱 (会写入 reprepro.conf 的 SignWith)
read -rp "请输入 GPG 邮箱 (例如 apt@example.com): " GPG_EMAIL
if [[ -z "$GPG_EMAIL" ]]; then
    echo "✗ 邮箱不能为空" >&2
    exit 1
fi
export GPG_PASSPHRASE

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

cat >"$KEY_DIR/gpg-gen-key.conf" <<EOF
%echo Generating cloud-apt signing key
Key-Type: eddsa
Key-Curve: ed25519
Key-Usage: sign
Name-Real: cloud-apt archive signing key
Name-Email: $GPG_EMAIL
Expire-Date: 2y
Passphrase: $GPG_PASSPHRASE
EOF

chmod 600 "$KEY_DIR/gpg-gen-key.conf"
gpgconf --kill gpg-agent 2>/dev/null || true

gpg --batch --pinentry-mode loopback --gen-key "$KEY_DIR/gpg-gen-key.conf"

FPR=$(gpg --list-keys --with-colons "$GPG_EMAIL" | awk -F: '/^fpr:/ {print $10; exit}')

if [[ -z "$FPR" ]]; then
    echo "✗ 密钥生成失败" >&2
    exit 1
fi

# 导出公钥 (明文, 待 push)
gpg --export --armor "$FPR" > "$KEY_DIR/public.key"

# 导出私钥 (受 passphrase 保护)
gpg --export-secret-keys --armor "$FPR" > "$KEY_DIR/private.key"

# 对称加密双保险
gpg --batch --yes --pinentry-mode loopback \
    --passphrase "$GPG_PASSPHRASE" \
    --symmetric --cipher-algo AES256 \
    --output "$KEY_DIR/private.key.gpg" "$KEY_DIR/private.key"

shred -u "$KEY_DIR/private.key" "$KEY_DIR/gpg-gen-key.conf"
chmod 600 "$KEY_DIR/private.key.gpg" "$KEY_DIR/public.key"
unset GPG_PASSPHRASE

# 写入 keyid.txt 供后续脚本用
cat >"$KEY_DIR/keyid.txt" <<EOF
EMAIL=$GPG_EMAIL
FPR=$FPR
EOF
chmod 600 "$KEY_DIR/keyid.txt"

# 同步更新 conf/distributions 的 SignWith
DIST_FILE="$REPO_ROOT/conf/distributions"
if [[ -f "$DIST_FILE" ]]; then
    sed -i "s|SignWith:.*|SignWith: $GPG_EMAIL|" "$DIST_FILE"
    echo "  ✓ 已更新 $DIST_FILE 的 SignWith"
fi

echo ""
echo "✓ 密钥生成完成"
echo "  公钥: $KEY_DIR/public.key"
echo "  私钥 (加密): $KEY_DIR/private.key.gpg"
echo "  ⚠ 强烈建议把 $KEY_DIR/private.key.gpg 同步到密码管理器"
