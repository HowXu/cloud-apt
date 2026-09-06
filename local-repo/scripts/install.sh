#!/usr/bin/env bash
# cloud-apt 客户端一键安装脚本
# 部署到 Worker R2 的 scripts/install.sh, 客户端 curl 执行
# __CLOUD_APT_DOMAIN__ 由 push-install.sh 替换
set -euo pipefail
DOMAIN="__CLOUD_APT_DOMAIN__"
KEYRING=/usr/share/keyrings/cloud-apt-archive-keyring.gpg
SRC=/etc/apt/sources.list.d/cloud-apt.sources
DEFAULT_SUITE="kali-rolling"

if [[ -n "${CLOUD_APT_SUITE:-}" ]]; then
    SUITE="$CLOUD_APT_SUITE"
else
    SUITE="$DEFAULT_SUITE"
fi

if [[ ! "$SUITE" =~ ^[a-z0-9][a-z0-9.+~-]*$ ]]; then
    echo "✗ CLOUD_APT_SUITE 非法: '$SUITE'" >&2
    echo "  期望格式: 小写字母数字开头, 后续允许 . + ~ - (deb822 suite 规则)" >&2
    exit 1
fi

curl -fsSL "https://${DOMAIN}/pubkey.asc" | \
    sudo gpg --dearmor -o "$KEYRING"
sudo chmod 644 "$KEYRING"

cat <<EOF | sudo tee "$SRC"
Types: deb
URIs: https://${DOMAIN}
Suites: $SUITE
Components: main
Architectures: $(dpkg --print-architecture)
Signed-By: $KEYRING
EOF

sudo apt update
echo ""
echo "✓ cloud-apt 已配置 (suite=$SUITE, domain=$DOMAIN)"
echo "  用 apt install <package> 安装"