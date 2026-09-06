#!/usr/bin/env bash
# 一次性: 在项目内 local-repo/ 下创建运行时目录, 不污染 $HOME
# 默认 REPO_ROOT = 项目里的 local-repo/. 用 CLOUD_APT_ROOT 覆盖.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="${CLOUD_APT_ROOT:-$SCRIPT_DIR}"

echo "→ 初始化本地仓库: $REPO_ROOT"

# 运行时目录 (gitignore). conf/ 已存在 (有 distributions.template),
# 其它要现建
mkdir -p "$REPO_ROOT"/{incoming,pool,dists,keys,db}
chmod 700 "$REPO_ROOT/keys"

# 从模板克隆 conf/distributions (只在没有 live 文件时)
DIST="$REPO_ROOT/conf/distributions"
TEMPLATE="$REPO_ROOT/conf/distributions.template"
if [[ ! -f "$DIST" ]]; then
    if [[ ! -f "$TEMPLATE" ]]; then
        echo "✗ 模板 $TEMPLATE 缺失, 项目损坏" >&2
        exit 1
    fi
    cp "$TEMPLATE" "$DIST"
    echo "  ✓ 从模板克隆 conf/distributions (gen-key.sh 会替换 SignWith 占位符)"
fi

# scripts/ + dockerfiles/ 已经在 $REPO_ROOT, 不复制
echo ""
echo "✓ 仓库结构已就绪: $REPO_ROOT"
echo ""
echo "目录布局:"
echo "  $REPO_ROOT/"
echo "  ├── conf/"
echo "  │   ├── distributions.template    (git 跟踪, 初始模板)"
echo "  │   └── distributions            (gitignore, gen-key.sh 会修改)"
echo "  ├── scripts/                     (git 跟踪, 同时是模板 + 实时入口)"
echo "  ├── dockerfiles/                 (git 跟踪)"
echo "  ├── keys/                        (gitignore, GPG 私钥)"
echo "  ├── db/                          (gitignore, reprepro SQLite)"
echo "  ├── pool/                        (gitignore, 上传的 .deb)"
echo "  ├── dists/                       (gitignore, 签名的 Release/Packages)"
echo "  └── incoming/                    (gitignore, 临时入站)"
echo ""
echo "下一步:"
echo "  1. ./local-repo/scripts/gen-key.sh 生成 GPG 密钥"
echo "  2. ./local-repo/scripts/push-key.sh + push-install.sh 推送到 Worker"