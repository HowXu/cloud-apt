#!/usr/bin/env bash
# 一次性: 初始化 ~/cloud-apt 仓库结构
set -euo pipefail

REPO_ROOT="${CLOUD_APT_ROOT:-$HOME/cloud-apt}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "→ 初始化本地仓库: $REPO_ROOT"

mkdir -p "$REPO_ROOT"/{conf,incoming,pool,dists,keys}
cp -n "$SCRIPT_DIR/conf/distributions" "$REPO_ROOT/conf/distributions"

mkdir -p "$REPO_ROOT/scripts" "$REPO_ROOT/dockerfiles"
cp "$SCRIPT_DIR/scripts/"*.sh "$REPO_ROOT/scripts/"
cp "$SCRIPT_DIR/dockerfiles/"* "$REPO_ROOT/dockerfiles/"
chmod +x "$REPO_ROOT/scripts/"*.sh

echo "✓ 仓库结构已创建: $REPO_ROOT"
echo ""
echo "下一步:"
echo "  1. 跑 $REPO_ROOT/scripts/gen-key.sh 生成 GPG 密钥"
echo "  2. 跑 push-key.sh + push-install.sh 推送到 Worker"
