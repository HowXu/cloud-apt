#!/usr/bin/env bash
# 公开入口: 上传 .deb 到 cloud-apt
# 用法: push.sh <path-to-deb> [codename]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-ui.sh
. "$SCRIPT_DIR/lib-ui.sh"
# shellcheck source=lib-config.sh
. "$SCRIPT_DIR/lib-config.sh"

DEB="${1:?用法: push.sh <path-to-deb> [codename]}"
CODENAME="${2:-kali-rolling}"

[[ -f "$DEB" ]] || die "找不到 .deb: $DEB"
[[ "$(realpath "$DEB")" == *.deb ]] || die "必须是 .deb 文件: $DEB"

load_config || die "未找到 $CONFIG_PATH, 请先运行 init.sh"
export WORKER_URL ADMIN_PUSH_TOKEN

trap 'unset GPG_PASSPHRASE' EXIT

# GPG passphrase 不写入 config.env, 由退出 trap 清理
while :; do
    read -rsp "GPG passphrase: " GPG_PASSPHRASE; echo
    [[ -n "$GPG_PASSPHRASE" ]] || { warn "passphrase 不能为空"; continue; }
    break
done
export GPG_PASSPHRASE

info "上传 $DEB → $CODENAME"
"$SCRIPT_DIR/build-and-push.sh" "$DEB" "$CODENAME"

ok "完成: $(basename "$DEB" | sed 's/_.*//')"
ok "安装: sudo apt update && sudo apt install $(basename "$DEB" | sed 's/_.*//')"
