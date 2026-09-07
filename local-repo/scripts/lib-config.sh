#!/usr/bin/env bash
# 共用：读取 / 写入 local-repo/config.env
set -euo pipefail

CONFIG_PATH="${CLOUD_APT_CONFIG:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.env}"

# 简单的双引号转义: 把 \" 与 \\ 反斜杠转义
quote_for_env() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    printf '"%s"' "$s"
}

# 读取 config.env (key=value) 到当前 shell, 注释行/空行跳过
load_config() {
    local path="${1:-$CONFIG_PATH}"
    [[ -f "$path" ]] || return 1
    # shellcheck disable=SC1090
    set -a
    # shellcheck disable=SC1090
    . "$path"
    set +a
    [[ -n "${WORKER_URL:-}" && -n "${ADMIN_PUSH_TOKEN:-}" ]]
}

# 把当前 shell 中的 WORKER_URL / ADMIN_PUSH_TOKEN 原子写入 config.env
write_config() {
    local path="${1:-$CONFIG_PATH}"
    [[ -n "${WORKER_URL:-}" && -n "${ADMIN_PUSH_TOKEN:-}" ]] || {
        printf '%s\n' '✗ write_config: WORKER_URL / ADMIN_PUSH_TOKEN 必须在当前 shell 中设置' >&2
        return 1
    }
    local tmp
    tmp="$(mktemp "${path}.tmp.XXXXXX")"
    chmod 600 "$tmp"
    {
        printf '%s\n' '# cloud-apt 本地连接配置 (脚本自动维护)'
        printf 'WORKER_URL=%s\n' "$(quote_for_env "$WORKER_URL")"
        printf 'ADMIN_PUSH_TOKEN=%s\n' "$(quote_for_env "$ADMIN_PUSH_TOKEN")"
    } > "$tmp"
    mv -f "$tmp" "$path"
    chmod 600 "$path"
}
