#!/usr/bin/env bash
# Single-step local builder for cloud-apt-info (pure Python, no compile).
set -euo pipefail

cd "$(dirname "$0")"

PKG=cloud-apt-info
VERSION=0.1.0
RELEASE=1
ARCH=amd64
PREFIX="/opt/${PKG}-${VERSION}"
ARTIFACTS="${EXAMPLE_ARTIFACTS:-$PWD/artifacts}"

mkdir -p "$ARTIFACTS"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# Install the script under /opt so the .deb carries a /opt prefix similar to
# cloud-apt-hello's layout; this also makes the staging tree non-trivial for
# migrate-export to walk.
make install "DESTDIR=$STAGE" "PREFIX=$PREFIX"

# Debian package layout: /usr/bin (script), /etc/cloud-apt (config).
mkdir -p "$STAGE/usr/bin"
mkdir -p "$STAGE/etc/cloud-apt"
install -m 755 "$STAGE$PREFIX/bin/cloud-apt-info.py" "$STAGE/usr/bin/cloud-apt-info"

mkdir -p "$STAGE/DEBIAN"
cp debian/control     "$STAGE/DEBIAN/control"
cp debian/copyright   "$STAGE/DEBIAN/copyright"
cp debian/changelog   "$STAGE/DEBIAN/changelog"
gzip -9n -f "$STAGE/DEBIAN/changelog"
cp debian/postinst    "$STAGE/DEBIAN/postinst"
chmod 755 "$STAGE/DEBIAN/postinst"
cp debian/prerm       "$STAGE/DEBIAN/prerm"
chmod 755 "$STAGE/DEBIAN/prerm"

echo '2.0' > "$STAGE/DEBIAN/debian-binary"

DEB="${ARTIFACTS}/${PKG}_${VERSION}-${RELEASE}_${ARCH}.deb"
dpkg-deb -Zgzip -z9 --root-owner-group --uniform-compression \
    --build "$STAGE" "$DEB"

echo
echo "==> Built: $DEB"
dpkg-deb -I "$DEB"