#!/usr/bin/env bash
# cloud-apt 客户端一键卸载脚本
# 用法:
#   curl -fsSL https://<your-domain>/uninstall.sh | sudo bash
#   curl -fsSL https://<your-domain>/uninstall.sh | sudo CLOUD_APT_PURGE=hello,foo bash
#   curl -fsSL https://<your-domain>/uninstall.sh | sudo CLOUD_APT_PURGE=all bash
#
# 删除 /etc/apt/sources.list.d/cloud-apt.sources (deb822)
# 删除 /usr/share/keyrings/cloud-apt-archive-keyring.gpg
# 可选: 卸载从此仓库安装的包 (CLOUD_APT_PURGE=逗号分隔包名, 或 "all" 卸载所有)
set -euo pipefail

KEYRING=/usr/share/keyrings/cloud-apt-archive-keyring.gpg
SRC_DEB822=/etc/apt/sources.list.d/cloud-apt.sources
SRC_ONELINE=/etc/apt/sources.list.d/cloud-apt.list
LIST=/etc/apt/sources.list

echo "→ 卸载 cloud-apt 仓库"

# 1. 可选: 卸载包
if [[ -n "${CLOUD_APT_PURGE:-}" ]]; then
    if [[ "${CLOUD_APT_PURGE}" == "all" ]]; then
        echo "  找出从此仓库安装的所有包..."
        # 检查 sources 是否还在 (如果已删, 我们没法知道来源, 所以跳过)
        if [[ -f "$SRC_DEB822" || -f "$SRC_ONELINE" ]]; then
            mapfile -t PKGS < <(dpkg-query -W -f='${Package}\n' 2>/dev/null | while read -r p; do
                if apt-cache show "$p" 2>/dev/null | grep -q '^Origin: cloud-apt$'; then
                    echo "$p"
                fi
            done || true)
            if [[ ${#PKGS[@]} -gt 0 ]]; then
                echo "  候选卸载包: ${PKGS[*]}"
                if [[ "${YES:-}" != "1" ]]; then
                    read -rp "Confirm purge? [y/N] " ans
                    if [[ ! "$ans" =~ ^[Yy]$ ]]; then
                        echo "✗ 已取消"
                        exit 1
                    fi
                fi
                sudo apt purge -y "${PKGS[@]}"
            else
                echo "  没找到任何 cloud-apt 来源的包"
            fi
        else
            echo "  ⚠ sources 已删除, 无法判断包来源, 跳过"
        fi
    else
        mapfile -t PKGS < <(printf '%s\n' "${CLOUD_APT_PURGE//,/ }")
        echo "  卸载包: ${PKGS[*]}"
        sudo apt purge -y "${PKGS[@]}"
    fi
fi

# 2. 删除 sources (deb822 新格式)
if [[ -f "$SRC_DEB822" ]]; then
    echo "  删 $SRC_DEB822"
    sudo rm -f "$SRC_DEB822"
fi

# 3. 删除可能残留的旧式 sources.list 条目
if [[ -f "$SRC_ONELINE" ]]; then
    echo "  删 $SRC_ONELINE"
    sudo rm -f "$SRC_ONELINE"
fi

if [[ -f "$LIST" ]] && grep -q 'cloud-apt' "$LIST"; then
    echo "  ⚠ $LIST 含 cloud-apt 残留行, 需手动清理"
fi

# 4. 删除 keyring
if [[ -f "$KEYRING" ]]; then
    echo "  删 $KEYRING"
    sudo rm -f "$KEYRING"
fi

# 5. 刷新 apt 缓存 (sources 删了, 原 cloud-apt 仓库的包不会再出现)
sudo apt update || true

# 6. 清掉从此仓库下载的 deb 缓存 (无害, 不影响其它来源)
sudo apt-get clean

echo ""
echo "✓ cloud-apt 已卸载"
echo ""
if [[ -z "${CLOUD_APT_PURGE:-}" ]]; then
    echo "提示: 想同时卸载从此仓库装的包, 重跑时加:"
    echo "  curl -fsSL https://<your-domain>/uninstall.sh | sudo CLOUD_APT_PURGE=hello,foo bash"
    echo "  curl -fsSL https://<your-domain>/uninstall.sh | sudo CLOUD_APT_PURGE=all bash"
fi