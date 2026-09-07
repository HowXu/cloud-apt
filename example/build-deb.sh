#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

PKG=cloud-apt-hello
VERSION=0.2.0
RELEASE=1
ARCH=amd64
PREFIX="/opt/${PKG}-${VERSION}"
ARTIFACTS="$PWD/artifacts"

mkdir -p "$ARTIFACTS"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

make clean
make

make install "DESTDIR=$STAGE" "PREFIX=$PREFIX"


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