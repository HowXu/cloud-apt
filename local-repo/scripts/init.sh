#!/usr/bin/env bash
# 公开入口：cloud-apt 本地仓库首次初始化
# 流程: 依赖检查 -> 配置 -> 目录 -> GPG 密钥 -> 公钥/客户端脚本上传
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-ui.sh
. "$SCRIPT_DIR/lib-ui.sh"
# shellcheck source=lib-config.sh
. "$SCRIPT_DIR/lib-config.sh"

info "cloud-apt 初始化"

# 1. 依赖检查
for cmd in curl gpg reprepro mktemp sed; do
    command -v "$cmd" >/dev/null 2>&1 || die "缺少依赖: $cmd (apt install $cmd)"
done

# 2. 加载或收集 WORKER_URL / ADMIN_PUSH_TOKEN
WORKER_URL="${WORKER_URL:-}"
ADMIN_PUSH_TOKEN="${ADMIN_PUSH_TOKEN:-}"

if load_config; then
    info "已读取 $CONFIG_PATH"
    WORKER_URL="${WORKER_URL:-}"
    ADMIN_PUSH_TOKEN="${ADMIN_PUSH_TOKEN:-}"
else
    :
fi

if [[ -z "$WORKER_URL" ]]; then
    while :; do
        read -rp "Worker URL (例如 https://apt.example.com): " WORKER_URL
        [[ "$WORKER_URL" == https://* ]] || { warn "必须以 https:// 开头"; continue; }
        DOMAIN="${WORKER_URL#https://}"; DOMAIN="${DOMAIN%%/*}"
        [[ "$DOMAIN" =~ ^[A-Za-z0-9._-]+$ ]] || { warn "Worker URL 域名非法"; continue; }
        if curl -fsS -o /dev/null "$WORKER_URL/api/status/health"; then
            break
        fi
        warn "无法访问 $WORKER_URL/api/status/health, 请检查 Worker 是否已部署"
    done
fi

if [[ -z "$ADMIN_PUSH_TOKEN" ]]; then
    while :; do
        read -rsp "ADMIN_PUSH_TOKEN (Worker Secret 值): " ADMIN_PUSH_TOKEN; echo
        [[ -n "$ADMIN_PUSH_TOKEN" ]] || { warn "Token 不能为空"; continue; }
        break
    done
fi

write_config || die "写入 $CONFIG_PATH 失败"

# 3. 本地仓库目录
export CLOUD_APT_ROOT="${CLOUD_APT_ROOT:-$SCRIPT_DIR/..}"
"$SCRIPT_DIR/setup-reprepro.sh"

# 4. GPG 密钥 (复用已有或生成)
KEY_DIR="$CLOUD_APT_ROOT/keys"
have_full_key=0
[[ -s "$KEY_DIR/public.key" && -s "$KEY_DIR/private.key.gpg" && -s "$KEY_DIR/keyid.txt" ]] && have_full_key=1

if [[ "$have_full_key" -eq 0 ]]; then
    info "生成 GPG 密钥"
    export GPG_PASSPHRASE=""
    "$SCRIPT_DIR/gen-key.sh"
else
    info "复用已有 GPG 密钥: $(awk -F= '$1=="FPR"{print $2}' "$KEY_DIR/keyid.txt")"
fi

# 5. 上传公钥和客户端脚本
export WORKER_URL ADMIN_PUSH_TOKEN
"$SCRIPT_DIR/push-key.sh"
"$SCRIPT_DIR/push-install.sh"

ok "初始化完成"
ok "客户端: curl -fsSL ${WORKER_URL}/install.sh | sudo bash"
ok "上传:   $SCRIPT_DIR/push.sh path/to/package.deb"
