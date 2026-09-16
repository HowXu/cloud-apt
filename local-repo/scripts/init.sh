#!/usr/bin/env bash
# Public entry: first-time initialization of the cloud-apt local repo.
# Flow: dependency check -> config -> directories -> GPG key -> upload
# public key + client install script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-ui.sh
. "$SCRIPT_DIR/lib-ui.sh"
# shellcheck source=lib-config.sh
. "$SCRIPT_DIR/lib-config.sh"

info "Initializing cloud-apt"

# 1. Dependency check
for cmd in curl gpg reprepro python3 mktemp sed; do
    command -v "$cmd" >/dev/null 2>&1 || die "Missing dependency: $cmd (apt install $cmd)"
done

# 2. Load or collect WORKER_URL / ADMIN_PUSH_TOKEN
WORKER_URL="${WORKER_URL:-}"
ADMIN_PUSH_TOKEN="${ADMIN_PUSH_TOKEN:-}"

if load_config; then
    info "Loaded existing config from $CONFIG_PATH"
else
    :
fi

# 2.5 Short-circuit if the local state already matches the Worker. After a
# successful migrate-import the GPG key, config, and Worker pubkey.asc are
# all in sync; re-running init.sh would only re-push the key and install
# script (no-ops but noisy), so detect and exit.
if [[ -n "$WORKER_URL" ]]; then
    KEY_DIR="$SCRIPT_DIR/../keys"
    if [[ -s "$KEY_DIR/public.key" && -s "$KEY_DIR/private.key.gpg" && -s "$KEY_DIR/keyid.txt" ]]; then
        local_sha=$(sha256sum "$KEY_DIR/public.key" | awk '{print $1}')
        remote_sha=$(curl -fsS "$WORKER_URL/pubkey.asc" 2>/dev/null | sha256sum | awk '{print $1}' || true)
        if [[ -n "$remote_sha" && "$local_sha" == "$remote_sha" ]]; then
            ok "Already initialized at $WORKER_URL; nothing to do."
            ok "Client: curl -fsSL ${WORKER_URL}/install.sh | sudo bash"
            ok "Upload: $SCRIPT_DIR/push.sh path/to/package.deb"
            exit 0
        fi
    fi
fi

if [[ -z "$WORKER_URL" ]]; then
    while :; do
        read -rp "Worker URL (e.g. https://apt.example.com): " WORKER_URL
        [[ "$WORKER_URL" == https://* ]] || { warn "URL must start with https://"; continue; }
        DOMAIN="${WORKER_URL#https://}"; DOMAIN="${DOMAIN%%/*}"
        [[ "$DOMAIN" =~ ^[A-Za-z0-9._-]+$ ]] || { warn "Invalid Worker URL domain"; continue; }
        if curl -fsS -o /dev/null "$WORKER_URL/api/status/health"; then
            break
        fi
        warn "Cannot reach $WORKER_URL/api/status/health -- is the Worker deployed?"
    done
fi

if [[ -z "$ADMIN_PUSH_TOKEN" ]]; then
    while :; do
        read -rsp "ADMIN_PUSH_TOKEN (Worker Secret value): " ADMIN_PUSH_TOKEN; echo
        [[ -n "$ADMIN_PUSH_TOKEN" ]] || { warn "Token cannot be empty"; continue; }
        if curl -fsS -o /dev/null \
            -H "Authorization: Bearer $ADMIN_PUSH_TOKEN" \
            "$WORKER_URL/api/status/health"; then
            break
        fi
        warn "Worker rejected the token (401/403), please retry"
    done
fi

write_config || die "Failed to write $CONFIG_PATH"

# 3. Local repo directories
export CLOUD_APT_ROOT="${CLOUD_APT_ROOT:-$SCRIPT_DIR/..}"
"$SCRIPT_DIR/setup-reprepro.sh"

# 4. GPG key (reuse or generate)
KEY_DIR="$CLOUD_APT_ROOT/keys"
have_full_key=0
[[ -s "$KEY_DIR/public.key" && -s "$KEY_DIR/private.key.gpg" && -s "$KEY_DIR/keyid.txt" ]] && have_full_key=1

if [[ "$have_full_key" -eq 0 ]]; then
    info "Generating GPG key (gen-key.sh will prompt for a passphrase)"
    "$SCRIPT_DIR/gen-key.sh"
else
    info "Reusing existing GPG key: $(awk -F= '$1=="FPR"{print $2}' "$KEY_DIR/keyid.txt")"
fi

# 5. Upload public key and client install script
export WORKER_URL ADMIN_PUSH_TOKEN
"$SCRIPT_DIR/push-key.sh"
"$SCRIPT_DIR/push-install.sh"

ok "Initialization complete"
ok "Client: curl -fsSL ${WORKER_URL}/install.sh | sudo bash"
ok "Upload: $SCRIPT_DIR/push.sh path/to/package.deb"
