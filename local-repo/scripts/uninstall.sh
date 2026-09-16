#!/usr/bin/env bash
# cloud-apt client one-shot uninstall script.
# Usage:
#   curl -fsSL https://<your-domain>/uninstall.sh | sudo bash
#   curl -fsSL https://<your-domain>/uninstall.sh | sudo CLOUD_APT_PURGE=hello,foo bash
#   curl -fsSL https://<your-domain>/uninstall.sh | sudo CLOUD_APT_PURGE=all bash
#
# Removes /etc/apt/sources.list.d/cloud-apt.sources (deb822).
# Removes /usr/share/keyrings/cloud-apt-archive-keyring.gpg.
# Optional: purges packages installed from this repo
# (CLOUD_APT_PURGE=comma-separated list, or "all" to remove everything).
set -euo pipefail

KEYRING=/usr/share/keyrings/cloud-apt-archive-keyring.gpg
SRC_DEB822=/etc/apt/sources.list.d/cloud-apt.sources
SRC_ONELINE=/etc/apt/sources.list.d/cloud-apt.list
LIST=/etc/apt/sources.list

echo "[INFO]  Uninstalling cloud-apt"

# 1. Optional: purge packages
if [[ -n "${CLOUD_APT_PURGE:-}" ]]; then
    if [[ "${CLOUD_APT_PURGE}" == "all" ]]; then
        echo "        Looking up every package installed from this repo..."
        # If the sources file is already gone, we cannot know the origin,
        # so skip.
        if [[ -f "$SRC_DEB822" || -f "$SRC_ONELINE" ]]; then
            mapfile -t PKGS < <(dpkg-query -W -f='${Package}\n' 2>/dev/null | while read -r p; do
                if apt-cache show "$p" 2>/dev/null | grep -q '^Origin: cloud-apt$'; then
                    echo "$p"
                fi
            done || true)
            if [[ ${#PKGS[@]} -gt 0 ]]; then
                echo "        Candidate packages to purge: ${PKGS[*]}"
                if [[ "${YES:-}" != "1" ]]; then
                    read -rp "Confirm purge? [y/N] " ans
                    if [[ ! "$ans" =~ ^[Yy]$ ]]; then
                        echo "Canceled"
                        exit 1
                    fi
                fi
                sudo apt purge -y "${PKGS[@]}"
            else
                echo "        No packages from cloud-apt were found"
            fi
        else
            echo "[WARN]  Sources file is already gone; cannot determine package origin, skipping"
        fi
    else
        mapfile -t PKGS < <(printf '%s\n' "${CLOUD_APT_PURGE//,/ }")
        echo "        Purging packages: ${PKGS[*]}"
        sudo apt purge -y "${PKGS[@]}"
    fi
fi

# 2. Remove sources (modern deb822)
if [[ -f "$SRC_DEB822" ]]; then
    echo "        Remove $SRC_DEB822"
    sudo rm -f "$SRC_DEB822"
fi

# 3. Remove any legacy one-line sources entry, if present.
if [[ -f "$SRC_ONELINE" ]]; then
    echo "        Remove $SRC_ONELINE"
    sudo rm -f "$SRC_ONELINE"
fi

if [[ -f "$LIST" ]] && grep -q 'cloud-apt' "$LIST"; then
    echo "[WARN]  $LIST still contains cloud-apt lines; clean it up manually"
fi

# 4. Remove the keyring.
if [[ -f "$KEYRING" ]]; then
    echo "        Remove $KEYRING"
    sudo rm -f "$KEYRING"
fi

# 5. Refresh apt cache (sources are gone, cloud-apt packages will no
# longer appear).
sudo apt update || true

# 6. Clean the downloaded .deb cache for this repo (harmless and does
# not affect other sources).
sudo apt-get clean

echo ""
echo "[OK]    cloud-apt has been uninstalled"
echo ""
if [[ -z "${CLOUD_APT_PURGE:-}" ]]; then
    echo "Tip: to also purge packages installed from this repo, re-run with:"
    echo "  curl -fsSL https://<your-domain>/uninstall.sh | sudo CLOUD_APT_PURGE=hello,foo bash"
    echo "  curl -fsSL https://<your-domain>/uninstall.sh | sudo CLOUD_APT_PURGE=all bash"
fi
