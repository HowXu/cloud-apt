#!/usr/bin/env bash
# Build hello-0.1.0 .deb locally (no act/podman needed).
# 输出: ./artifacts/hello_0.1.0-1_amd64.deb
set -euo pipefail

cd "$(dirname "$0")"

PKG=hello
VERSION=0.1.0
RELEASE=1
ARCH=amd64
PREFIX="/opt/${PKG}-${VERSION}"
ARTIFACTS="$PWD/artifacts"

mkdir -p "$ARTIFACTS"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# 1. 构建
make clean
make

# 2. 安装到 staging
make install "DESTDIR=$STAGE" "PREFIX=$PREFIX"

# 3. DEBIAN 元数据
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

# 4. 属主 (--root-owner-group 已能盖过, 显式再做一次保险)
chown -R 0:0 "$STAGE"

# 5. 打包
DEB="${ARTIFACTS}/${PKG}_${VERSION}-${RELEASE}_${ARCH}.deb"
dpkg-deb -Zgzip -z9 --root-owner-group --uniform-compression \
    --build "$STAGE" "$DEB"

echo
echo "==> Built: $DEB"
dpkg-deb -I "$DEB"