#!/usr/bin/env bash
# cloud-apt client one-shot install script.
# Deployed to the Worker's R2 bucket as scripts/install.sh and executed by
# clients via curl.
# __CLOUD_APT_DOMAIN__ is substituted at upload time by push-install.sh.
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
    echo "[ERROR] CLOUD_APT_SUITE is invalid: '$SUITE'" >&2
    echo "        Expected format: lowercase alnum first char, then . + ~ - allowed (deb822 suite rules)" >&2
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
echo "[OK]    cloud-apt is configured (suite=$SUITE, domain=$DOMAIN)"
echo "        Install packages with: sudo apt install <package>"
