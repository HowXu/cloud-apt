#!/usr/bin/env bash
# Shared: read / write local-repo/config.env.
set -euo pipefail

CONFIG_PATH="${CLOUD_APT_CONFIG:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config.env}"

# Simple double-quote escaping: escape \" and \\.
quote_for_env() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    printf '"%s"' "$s"
}

# Load config.env (key=value) into the current shell; skip comments and
# blank lines.
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

# Atomically write WORKER_URL / ADMIN_PUSH_TOKEN from the current shell
# into config.env.
write_config() {
    local path="${1:-$CONFIG_PATH}"
    [[ -n "${WORKER_URL:-}" && -n "${ADMIN_PUSH_TOKEN:-}" ]] || {
        printf '%s\n' '[ERROR] write_config: WORKER_URL and ADMIN_PUSH_TOKEN must be set in the current shell' >&2
        return 1
    }
    local tmp
    tmp="$(mktemp "${path}.tmp.XXXXXX")"
    chmod 600 "$tmp"
    {
        printf '%s\n' '# cloud-apt local connection config (maintained by the scripts)'
        printf 'WORKER_URL=%s\n' "$(quote_for_env "$WORKER_URL")"
        printf 'ADMIN_PUSH_TOKEN=%s\n' "$(quote_for_env "$ADMIN_PUSH_TOKEN")"
    } > "$tmp"
    mv -f "$tmp" "$path"
    chmod 600 "$path"
}
